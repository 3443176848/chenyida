import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./release-identity-contract.mjs";
import {
  canonicalJson,
  loadReleaseManifest,
  sha256,
  validateAppliedMigrationRows,
  validateOfficialReleaseGatePlan,
  validateOfficialVulnerabilityPolicy,
  verifyMigrationFilesAgainstManifest,
} from "./release-manifest-contract.mjs";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const DATABASE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const ROLE = /^[a-z_][a-z0-9_$-]{0,62}$/;
const SYSTEM_IDENTIFIER = /^\d{10,24}$/;
const OID = /^\d{1,10}$/;

export type MigrationRuntimeConfig = {
  environment: string;
  deploymentClass: string;
  databaseUrl: string;
};

export type ReleaseAuthorization = {
  manifest: Awaited<ReturnType<typeof loadReleaseManifest>>;
  expectedCurrentHead: string;
  target: {
    deploymentClass: "UAT" | "PRODUCTION";
    deploymentId: string;
    databaseName: string;
    systemIdentifier: string;
    databaseOid: string;
    marker: string;
    migrationRole: string;
  };
};

export type IsolatedAuthorization = {
  harness: "RELEASE_MIGRATION" | "BACKUP_RECOVERY";
  runId: string;
  target: {
    databaseName: string;
    systemIdentifier: string;
    databaseOid: string;
    marker: string;
  };
};

export class MigrationGuardError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "MigrationGuardError";
    this.code = code;
  }
}

function reject(code: string): never {
  throw new MigrationGuardError(code);
}

function required(name: string, pattern: RegExp, code: string): string {
  const value = process.env[name] || "";
  if (!pattern.test(value)) reject(code);
  return value;
}

export async function loadReleaseAuthorization(config: MigrationRuntimeConfig, directory: string): Promise<ReleaseAuthorization | null> {
  const deploymentClass = config.deploymentClass.toUpperCase();
  const controlled = (["UAT", "PRODUCTION"] as const).includes(deploymentClass as "UAT" | "PRODUCTION");
  if (config.environment === "production" && !controlled) reject("MIGRATION_CONTROLLED_DEPLOYMENT_CLASS_REQUIRED");
  if (!controlled) return null;
  if (config.environment !== "production") reject("MIGRATION_CONTROLLED_ENVIRONMENT_REQUIRED");
  if (process.env.ERP_ALLOW_PRODUCTION_MIGRATION !== "YES") reject("MIGRATION_EXPLICIT_PRODUCTION_PERMISSION_REQUIRED");
  if (process.env.ERP_MIGRATION_CONFIRM !== "MIGRATE_EXACT_RELEASE_MANIFEST") reject("MIGRATION_EXACT_CONFIRMATION_REQUIRED");
  const manifestFile = process.env.ERP_RELEASE_MANIFEST_FILE || "";
  if (manifestFile !== resolve(manifestFile) || manifestFile === "/") reject("MIGRATION_RELEASE_MANIFEST_PATH_INVALID");
  const manifestSha256 = required("ERP_RELEASE_MANIFEST_SHA256", SHA256, "MIGRATION_RELEASE_MANIFEST_SHA256_INVALID");
  const manifest = await loadReleaseManifest({ file: manifestFile, expectedSha256: manifestSha256, requireEligible: true, trusted: true });
  const bakedPlanPath = fileURLToPath(new URL("../release/release-gate-plan-v2.json", import.meta.url));
  const bakedPlan = validateOfficialReleaseGatePlan(parseStrictJson(await readFile(bakedPlanPath, "utf8")));
  if (sha256(canonicalJson(bakedPlan)) !== manifest.gate.plan_sha256) reject("MIGRATION_RELEASE_GATE_PLAN_MISMATCH");
  const bakedPolicyPath = fileURLToPath(new URL("../release/vulnerability-policy-v1.json", import.meta.url));
  const bakedPolicyRaw = await readFile(bakedPolicyPath, "utf8");
  validateOfficialVulnerabilityPolicy(parseStrictJson(bakedPolicyRaw), bakedPolicyRaw);
  if (!manifest.allowed_deployment_classes.includes(deploymentClass)) reject("MIGRATION_DEPLOYMENT_CLASS_NOT_ALLOWED");
  const deploymentId = required("ERP_RELEASE_EXPECTED_DEPLOYMENT_ID", IDENTIFIER, "MIGRATION_DEPLOYMENT_ID_INVALID");
  const databaseName = required("ERP_MIGRATION_EXPECTED_DATABASE", DATABASE, "MIGRATION_DATABASE_NAME_INVALID");
  const systemIdentifier = required("ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER", SYSTEM_IDENTIFIER, "MIGRATION_SYSTEM_IDENTIFIER_INVALID");
  const databaseOid = required("ERP_MIGRATION_EXPECTED_DATABASE_OID", OID, "MIGRATION_DATABASE_OID_INVALID");
  const marker = process.env.ERP_MIGRATION_EXPECTED_DATABASE_MARKER || "";
  if (marker !== `chenyida-erp-deployment/v2:${deploymentClass}:${deploymentId}`) reject("MIGRATION_DATABASE_MARKER_INVALID");
  const migrationRole = required("ERP_MIGRATION_EXPECTED_ROLE", ROLE, "MIGRATION_ROLE_NAME_INVALID");
  const expectedCurrentHead = process.env.ERP_MIGRATION_EXPECTED_CURRENT_HEAD || "";
  if (expectedCurrentHead !== "EMPTY" && !MIGRATION_FILE.test(expectedCurrentHead)) reject("MIGRATION_EXPECTED_CURRENT_HEAD_INVALID");
  if (process.env.ERP_MIGRATION_EXPECTED_TARGET_HEAD !== manifest.migrations.head) reject("MIGRATION_EXPECTED_TARGET_HEAD_MISMATCH");
  if (process.env.ERP_RELEASE_EXPECTED_VERSION !== manifest.source.package_version || process.env.ERP_RUNTIME_BUILD_VERSION !== manifest.source.package_version) reject("MIGRATION_RELEASE_VERSION_MISMATCH");
  if (process.env.ERP_RELEASE_EXPECTED_GIT_COMMIT !== manifest.source.git_commit || process.env.ERP_RUNTIME_GIT_COMMIT !== manifest.source.git_commit) reject("MIGRATION_RELEASE_COMMIT_MISMATCH");
  if (process.env.ERP_RUNTIME_IMAGE_REFERENCE !== manifest.images.worker.image_reference) reject("MIGRATION_RELEASE_IMAGE_REFERENCE_MISMATCH");
  if (process.env.ERP_RUNTIME_IMAGE_CONFIG_DIGEST !== manifest.images.worker.image_digest) reject("MIGRATION_RELEASE_IMAGE_MISMATCH");
  await verifyMigrationFilesAgainstManifest(manifest, directory);
  return { manifest, expectedCurrentHead, target: { deploymentClass: deploymentClass as "UAT" | "PRODUCTION", deploymentId, databaseName, systemIdentifier, databaseOid, marker, migrationRole } };
}

export function loadIsolatedAuthorization(config: MigrationRuntimeConfig): IsolatedAuthorization {
  if (config.environment !== "test" || config.deploymentClass !== "test") reject("MIGRATION_RELEASE_AUTHORIZATION_REQUIRED");
  if (process.env.ERP_ALLOW_ISOLATED_MIGRATION !== "YES") reject("MIGRATION_ISOLATED_PERMISSION_REQUIRED");
  if (process.env.ERP_RELEASE_TEST_MODE !== "YES") reject("MIGRATION_ISOLATED_TEST_MODE_REQUIRED");
  if (process.env.ERP_MIGRATION_CONFIRM !== "MIGRATE_EXACT_ISOLATED_TEST_DATABASE") reject("MIGRATION_ISOLATED_CONFIRMATION_REQUIRED");
  const harness = process.env.ERP_MIGRATION_TEST_HARNESS || "";
  if (harness !== "RELEASE_MIGRATION" && harness !== "BACKUP_RECOVERY") reject("MIGRATION_TEST_HARNESS_INVALID");
  const runId = required("ERP_MIGRATION_TEST_RUN_ID", IDENTIFIER, "MIGRATION_TEST_RUN_ID_INVALID");
  const databaseName = required("ERP_MIGRATION_EXPECTED_DATABASE", DATABASE, "MIGRATION_DATABASE_NAME_INVALID");
  const releaseHarness = harness === "RELEASE_MIGRATION";
  if (releaseHarness ? !/^cyd_[a-z0-9_]+_release_test$/.test(databaseName) : databaseName !== "cyd_backup_dashboard_test_release_test") reject("MIGRATION_TEST_DATABASE_NAME_REQUIRED");
  const socketPattern = releaseHarness
    ? "/tmp/cyd-release-migration-postgres\\.[A-Za-z0-9]+/socket"
    : "/tmp/cyd-backup-v2-postgres\\.[A-Za-z0-9]+/target-socket";
  const databaseUrl = config.databaseUrl.match(new RegExp(`^postgresql://postgres@/([A-Za-z_][A-Za-z0-9_$-]{0,62})\\?host=(${socketPattern})$`));
  if (!databaseUrl || databaseUrl[1] !== databaseName) reject("MIGRATION_DATABASE_URL_TARGET_MISMATCH");
  const systemIdentifier = required("ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER", SYSTEM_IDENTIFIER, "MIGRATION_SYSTEM_IDENTIFIER_INVALID");
  const databaseOid = required("ERP_MIGRATION_EXPECTED_DATABASE_OID", OID, "MIGRATION_DATABASE_OID_INVALID");
  const marker = process.env.ERP_MIGRATION_EXPECTED_DATABASE_MARKER || "";
  if (marker !== `chenyida-erp-isolated-migration-test/v1:${runId}`) reject("MIGRATION_TEST_DATABASE_MARKER_INVALID");
  return { harness, runId, target: { databaseName, systemIdentifier, databaseOid, marker } };
}

export type MigrationQueryClient = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

export async function assertTargetIdentity(client: MigrationQueryClient, authorization: ReleaseAuthorization): Promise<void> {
  const result = await client.query<{
    database_name: string; system_identifier: string; database_oid: string; marker: string | null;
    current_role_name: string; session_role_name: string; database_owner_matches: boolean; role_login: boolean;
    role_superuser: boolean; role_create_role: boolean; role_create_database: boolean; role_replication: boolean;
    role_bypass_rls: boolean; role_pg_monitor: boolean; role_memberships_absent: boolean; role_settings_absent: boolean;
    public_schema_owner_valid: boolean; public_schema_create_acl_valid: boolean;
  }>(`
    select pg_catalog.current_database()::text as database_name,
           (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,
           d.oid::text as database_oid,
           pg_catalog.shobj_description(d.oid, 'pg_database') as marker,
           current_user::text as current_role_name,
           session_user::text as session_role_name,
           d.datdba=r.oid as database_owner_matches,
           r.rolcanlogin as role_login,
           r.rolsuper as role_superuser,
           r.rolcreaterole as role_create_role,
           r.rolcreatedb as role_create_database,
           r.rolreplication as role_replication,
           r.rolbypassrls as role_bypass_rls,
           pg_catalog.pg_has_role(r.rolname, 'pg_monitor', 'MEMBER') as role_pg_monitor,
           not exists (select 1 from pg_catalog.pg_auth_members m where m.member=r.oid or m.roleid=r.oid) as role_memberships_absent,
           r.rolconfig is null and not exists (select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid) as role_settings_absent,
           exists (select 1 from pg_catalog.pg_namespace n where n.nspname='public' and n.nspowner=(select owner_role.oid from pg_catalog.pg_roles owner_role where owner_role.rolname='pg_database_owner')) as public_schema_owner_valid,
           not exists (
             select 1
               from pg_catalog.pg_namespace n
               cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
              where n.nspname='public' and a.privilege_type='CREATE'
                and a.grantee not in (r.oid,(select owner_role.oid from pg_catalog.pg_roles owner_role where owner_role.rolname='pg_database_owner'))
           ) as public_schema_create_acl_valid
      from pg_catalog.pg_database d
      join pg_catalog.pg_roles r on r.rolname=current_user
     where d.datname=pg_catalog.current_database()
  `);
  if (result.rows.length !== 1) reject("MIGRATION_TARGET_IDENTITY_INCOMPLETE");
  const actual = result.rows[0]; const expected = authorization.target;
  if (actual.database_name !== expected.databaseName || actual.system_identifier !== expected.systemIdentifier || actual.database_oid !== expected.databaseOid || actual.marker !== expected.marker) reject("MIGRATION_TARGET_IDENTITY_MISMATCH");
  if (actual.current_role_name !== expected.migrationRole || actual.session_role_name !== expected.migrationRole || actual.database_owner_matches !== true || actual.role_login !== true
    || actual.role_superuser !== false || actual.role_create_role !== false || actual.role_create_database !== false || actual.role_replication !== false || actual.role_bypass_rls !== false || actual.role_pg_monitor !== false
    || actual.role_memberships_absent !== true || actual.role_settings_absent !== true) reject("MIGRATION_ROLE_IDENTITY_INVALID");
  if (actual.public_schema_owner_valid !== true || actual.public_schema_create_acl_valid !== true) reject("MIGRATION_PUBLIC_SCHEMA_PRIVILEGE_INVALID");
}

export async function assertIsolatedTargetIdentity(client: MigrationQueryClient, authorization: IsolatedAuthorization): Promise<void> {
  const result = await client.query<{ database_name: string; system_identifier: string; database_oid: string; marker: string | null }>(`
    select pg_catalog.current_database()::text as database_name,
           (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,
           d.oid::text as database_oid,
           pg_catalog.shobj_description(d.oid, 'pg_database') as marker
      from pg_catalog.pg_database d
     where d.datname = pg_catalog.current_database()
  `);
  if (result.rows.length !== 1) reject("MIGRATION_TARGET_IDENTITY_INCOMPLETE");
  const actual = result.rows[0]; const expected = authorization.target;
  if (actual.database_name !== expected.databaseName || actual.system_identifier !== expected.systemIdentifier || actual.database_oid !== expected.databaseOid || actual.marker !== expected.marker) reject("MIGRATION_ISOLATED_TARGET_IDENTITY_MISMATCH");
}

async function assertMigrationHistoryStructure(client: MigrationQueryClient): Promise<void> {
  const result = await client.query<{ valid: boolean }>(`
    select c.relkind='r' and c.relpersistence='p' and not c.relispartition
       and c.relowner=(select r.oid from pg_catalog.pg_roles r where r.rolname=current_user)
       and c.relacl is null
       and not c.relrowsecurity and not c.relforcerowsecurity
       and not exists (select 1 from pg_catalog.pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid)
       and (select count(*)=3 and bool_and(
              (a.attnum=1 and a.attname='version' and a.atttypid='text'::pg_catalog.regtype and a.attnotnull and a.attidentity='' and a.attgenerated='' and a.attacl is null and d.adrelid is null)
           or (a.attnum=2 and a.attname='checksum' and a.atttypid='text'::pg_catalog.regtype and a.attnotnull and a.attidentity='' and a.attgenerated='' and a.attacl is null and d.adrelid is null)
           or (a.attnum=3 and a.attname='applied_at' and a.atttypid='timestamptz'::pg_catalog.regtype and a.attnotnull and a.attidentity='' and a.attgenerated='' and a.attacl is null and pg_catalog.pg_get_expr(d.adbin,d.adrelid,true)='now()')
         ) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)
       and (select count(*)=1 and bool_and(i.indisprimary and i.indisunique and i.indisvalid and i.indisready and i.indislive and i.indkey::text='1') from pg_catalog.pg_index i where i.indrelid=c.oid)
       and (select count(*)=1 and bool_and(k.contype='p' and k.conkey=ARRAY[1]::smallint[]) from pg_catalog.pg_constraint k where k.conrelid=c.oid)
       and not exists (select 1 from pg_catalog.pg_rewrite r where r.ev_class=c.oid and r.rulename<>'_RETURN')
       and not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
       as valid
      from pg_catalog.pg_class c
     where c.oid='public.schema_migrations'::pg_catalog.regclass
  `);
  if (result.rows.length !== 1 || result.rows[0].valid !== true) reject("MIGRATION_HISTORY_STRUCTURE_INVALID");
}

async function migrationHistoryPresent(client: MigrationQueryClient): Promise<boolean> {
  const relation = await client.query<{ present: boolean }>("select pg_catalog.to_regclass('public.schema_migrations') is not null as present");
  if (relation.rows.length !== 1) reject("MIGRATION_HISTORY_PROBE_FAILED");
  return relation.rows[0].present;
}

async function readPresentMigrationHistory(client: MigrationQueryClient): Promise<Array<{ version: string; checksum: string }>> {
  await assertMigrationHistoryStructure(client);
  const result = await client.query<{ version: string; checksum: string }>("select version::text, checksum::text from only public.schema_migrations order by version");
  return result.rows;
}

export async function readMigrationHistory(client: MigrationQueryClient): Promise<{ present: boolean; rows: Array<{ version: string; checksum: string }> }> {
  if (!await migrationHistoryPresent(client)) return { present: false, rows: [] };
  return { present: true, rows: await readPresentMigrationHistory(client) };
}

export async function readAppliedMigrations(client: MigrationQueryClient): Promise<Array<{ version: string; checksum: string }>> {
  return (await readMigrationHistory(client)).rows;
}

async function assertNoUntrackedPublicObjects(client: MigrationQueryClient): Promise<void> {
  const result = await client.query<{ present: boolean }>(`
    select exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname not in ('schema_migrations','schema_migrations_pkey')
      union all
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
       where n.nspname='public' and t.typtype in ('b','c','d','e','m','r')
      union all
      select 1 from pg_catalog.pg_collation o join pg_catalog.pg_namespace n on n.oid=o.collnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_operator o join pg_catalog.pg_namespace n on n.oid=o.oprnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_opclass o join pg_catalog.pg_namespace n on n.oid=o.opcnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_opfamily o join pg_catalog.pg_namespace n on n.oid=o.opfnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_conversion o join pg_catalog.pg_namespace n on n.oid=o.connamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_ts_config o join pg_catalog.pg_namespace n on n.oid=o.cfgnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_ts_dict o join pg_catalog.pg_namespace n on n.oid=o.dictnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_ts_parser o join pg_catalog.pg_namespace n on n.oid=o.prsnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_ts_template o join pg_catalog.pg_namespace n on n.oid=o.tmplnamespace where n.nspname='public'
      union all
      select 1 from pg_catalog.pg_extension o join pg_catalog.pg_namespace n on n.oid=o.extnamespace where n.nspname='public'
    ) as present
  `);
  if (result.rows.length !== 1) reject("MIGRATION_EMPTY_TARGET_PROBE_FAILED");
  if (result.rows[0].present) reject("MIGRATION_EMPTY_TARGET_HAS_UNTRACKED_OBJECTS");
}

export async function assertReleaseDatabasePreflight(client: MigrationQueryClient, authorization: ReleaseAuthorization): Promise<void> {
  await assertTargetIdentity(client, authorization);
  const present = await migrationHistoryPresent(client);
  let rows: Array<{ version: string; checksum: string }> = [];
  if (authorization.expectedCurrentHead === "EMPTY") {
    if (present) reject("MIGRATION_EMPTY_TARGET_HISTORY_PRESENT");
    await assertNoUntrackedPublicObjects(client);
  } else if (present) rows = await readPresentMigrationHistory(client);
  validateAppliedMigrationRows(rows, authorization.manifest.migrations.entries, authorization.expectedCurrentHead);
}
