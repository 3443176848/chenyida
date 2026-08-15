import { constants, type Stats } from "node:fs";
import { open, readFile } from "node:fs/promises";
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
import { CONTROLLED_MIGRATION_SEARCH_PATH } from "./postgresql-session-profile.ts";
import {
  canonicalMigrationExecutionJson,
  validateUatPromotionMigrationGrant,
} from "./uat-promotion-migration-execution-contract.mjs";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const DATABASE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const ROLE = /^[a-z_][a-z0-9_$-]{0,62}$/;
const SYSTEM_IDENTIFIER = /^\d{10,24}$/;
const OID = /^\d{1,10}$/;
const MIGRATION_EXECUTION_GRANT_FILE = "/run/chenyida-erp-promotion/migration-execution-grant.json";
const MAX_GRANT_BYTES = 512 * 1024;

export type MigrationRuntimeConfig = {
  environment: string;
  deploymentClass: string;
};

export type ReleaseAuthorization = {
  manifest: Awaited<ReturnType<typeof loadReleaseManifest>>;
  expectedCurrentHead: string;
  grant: ReturnType<typeof validateUatPromotionMigrationGrant> | null;
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

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink
    && left.uid === right.uid && left.gid === right.gid && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function loadMigrationExecutionGrant(file: string, expectedSha256: string) {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject("MIGRATION_EXECUTION_GRANT_INVALID"); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0 || before.gid !== 0
      || before.nlink !== 1 || (before.mode & 0o7777) !== 0o440 || before.size < 2 || before.size > MAX_GRANT_BYTES) {
      reject("MIGRATION_EXECUTION_GRANT_INVALID");
    }
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after) || sha256(raw) !== expectedSha256) reject("MIGRATION_EXECUTION_GRANT_INVALID");
    let grant;
    try { grant = validateUatPromotionMigrationGrant(parseStrictJson(raw.toString("utf8"), MAX_GRANT_BYTES)); }
    catch { reject("MIGRATION_EXECUTION_GRANT_INVALID"); }
    if (raw.toString("utf8") !== canonicalMigrationExecutionJson(grant)) reject("MIGRATION_EXECUTION_GRANT_INVALID");
    const now = Date.now();
    if (now < Date.parse(grant.created_at) - 5 * 1000 || now >= Date.parse(grant.expires_at)) {
      reject("MIGRATION_EXECUTION_GRANT_EXPIRED");
    }
    return grant;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function loadReleaseAuthorization(
  config: MigrationRuntimeConfig,
  directory: string,
  options: Readonly<{
    testGrantFile?: string;
    migrationEntries?: ReadonlyArray<Readonly<{ filename: string; sha256: string }>>;
  }> = {},
): Promise<ReleaseAuthorization | null> {
  const deploymentClass = config.deploymentClass.toUpperCase();
  const controlled = (["UAT", "PRODUCTION"] as const).includes(deploymentClass as "UAT" | "PRODUCTION");
  if (config.environment === "production" && !controlled) reject("MIGRATION_CONTROLLED_DEPLOYMENT_CLASS_REQUIRED");
  if (!controlled) return null;
  if (config.environment !== "production") reject("MIGRATION_CONTROLLED_ENVIRONMENT_REQUIRED");
  // Legacy variables may select and validate evidence, but never authorize SQL; runMigrationWorkflow
  // remains fail-closed unless the checkpoint-8 Supervisor execution adapter supplies a fenced grant.
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
  if (options.migrationEntries) {
    if (options.migrationEntries.length !== manifest.migrations.entries.length
      || options.migrationEntries.some((entry, index) => entry.filename !== manifest.migrations.entries[index].filename
        || entry.sha256 !== manifest.migrations.entries[index].sha256)) reject("MIGRATION_DIRECTORY_NOT_EXACT_RELEASE_ALLOWLIST");
  } else {
    await verifyMigrationFilesAgainstManifest(manifest, directory);
  }
  const target = {
    deploymentClass: deploymentClass as "UAT" | "PRODUCTION", deploymentId, databaseName,
    systemIdentifier, databaseOid, marker, migrationRole,
  };
  // Direct evidence inspection remains non-executing for compatibility. The production workflow always passes a
  // stable source bundle and cannot reach a pool until the content-addressed execution grant below is valid.
  if (!options.migrationEntries) return { manifest, expectedCurrentHead, grant: null, target };
  const expectedGrantSha256 = required(
    "ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256", SHA256, "MIGRATION_EXECUTION_GRANT_SHA256_INVALID",
  );
  const grantFile = options.testGrantFile ?? MIGRATION_EXECUTION_GRANT_FILE;
  if (options.testGrantFile !== undefined && process.env.NODE_ENV !== "test") reject("MIGRATION_TEST_GRANT_PATH_FORBIDDEN");
  if (options.testGrantFile === undefined && grantFile !== MIGRATION_EXECUTION_GRANT_FILE) reject("MIGRATION_EXECUTION_GRANT_PATH_INVALID");
  const grant = await loadMigrationExecutionGrant(grantFile, expectedGrantSha256);
  const executionAuthorizationSha256 = required(
    "ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256", SHA256,
    "MIGRATION_EXECUTION_AUTHORIZATION_SHA256_INVALID",
  );
  const supervisorBundleSha256 = required(
    "ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256", SHA256, "MIGRATION_SUPERVISOR_BUNDLE_SHA256_INVALID",
  );
  if (grant.execution_authorization_sha256 !== executionAuthorizationSha256
    || grant.supervisor_bundle_sha256 !== supervisorBundleSha256
    || grant.release_manifest_sha256 !== manifestSha256
    || grant.worker_image !== manifest.images.worker.image_reference
    || grant.migration_manifest_sha256 !== manifest.migrations.allowlist_sha256
    || grant.expected_current_head !== expectedCurrentHead
    || grant.target_head !== manifest.migrations.head
    || grant.database.deployment_class !== deploymentClass
    || grant.database.deployment_id !== deploymentId
    || grant.database.database_name !== databaseName
    || grant.database.database_system_identifier !== systemIdentifier
    || grant.database.database_oid !== databaseOid
    || grant.database.database_marker !== marker
    || grant.database.migration_role !== migrationRole) reject("MIGRATION_EXECUTION_GRANT_BINDING_INVALID");
  return {
    manifest, expectedCurrentHead, grant,
    target,
  };
}

export function loadIsolatedAuthorization(config: MigrationRuntimeConfig, databaseUrlValue: string): IsolatedAuthorization {
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
  const databaseUrl = databaseUrlValue.match(new RegExp(`^postgresql://postgres@/([A-Za-z_][A-Za-z0-9_$-]{0,62})\\?host=(${socketPattern})$`));
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

export type ReleaseMigrationFenceEvidence = {
  database_name: string; system_identifier: string; database_oid: string; marker: string | null;
  current_role_name: string; session_role_name: string; application_name: string;
  database_default_transaction_read_only: string; database_setting_count: number;
  database_allow_connections: boolean; database_connection_limit: number; other_backend_count: number;
  managed_roles: string[]; login_roles: string[]; connect_roles: string[]; platform_superuser_roles: string[];
  public_connect: boolean; public_temporary: boolean; unknown_connect_acl_count: number;
  unknown_connect_login_count: number; prepared_transaction_count: number;
  role_records: Array<Record<string, unknown>>; memberships: Array<Record<string, unknown>>;
  non_owner_database_acl: Array<Record<string, unknown>>; database_owner_privileges: string[];
};

export async function assertTargetIdentity(
  client: MigrationQueryClient,
  authorization: ReleaseAuthorization,
  databaseState: "RELEASED" | "MIGRATION_FENCED" = "RELEASED",
): Promise<void> {
  const result = await client.query<{
    database_name: string; system_identifier: string; database_oid: string; marker: string | null;
    current_role_name: string; session_role_name: string; database_owner_matches: boolean; role_login: boolean;
    role_superuser: boolean; role_create_role: boolean; role_create_database: boolean; role_replication: boolean;
    role_bypass_rls: boolean; role_pg_monitor: boolean; role_memberships_absent: boolean; role_settings_absent: boolean;
    role_inherit: boolean; role_connection_limit: number; role_valid_until_absent: boolean;
    database_settings_absent: boolean; database_read_only_fence_valid: boolean; search_path_exact: boolean;
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
           r.rolinherit as role_inherit,
           r.rolconnlimit as role_connection_limit,
           r.rolvaliduntil is null as role_valid_until_absent,
           pg_catalog.pg_has_role(r.rolname, 'pg_monitor', 'MEMBER') as role_pg_monitor,
           not exists (select 1 from pg_catalog.pg_auth_members m where m.member=r.oid or m.roleid=r.oid) as role_memberships_absent,
           r.rolconfig is null and not exists (select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid) as role_settings_absent,
           not exists (select 1 from pg_catalog.pg_db_role_setting s where s.setdatabase=d.oid and s.setrole in (0,r.oid)) as database_settings_absent,
           (select count(*)=1 and bool_and(s.setrole=0 and s.setconfig=ARRAY['default_transaction_read_only=on']::text[])
              from pg_catalog.pg_db_role_setting s where s.setdatabase=d.oid) as database_read_only_fence_valid,
           pg_catalog.current_setting('search_path')=$1 as search_path_exact,
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
  `, [CONTROLLED_MIGRATION_SEARCH_PATH]);
  if (result.rows.length !== 1) reject("MIGRATION_TARGET_IDENTITY_INCOMPLETE");
  const actual = result.rows[0]; const expected = authorization.target;
  if (actual.database_name !== expected.databaseName || actual.system_identifier !== expected.systemIdentifier || actual.database_oid !== expected.databaseOid || actual.marker !== expected.marker) reject("MIGRATION_TARGET_IDENTITY_MISMATCH");
  if (actual.current_role_name !== expected.migrationRole || actual.session_role_name !== expected.migrationRole || actual.database_owner_matches !== true || actual.role_login !== true
    || actual.role_superuser !== false || actual.role_create_role !== false || actual.role_create_database !== false || actual.role_replication !== false || actual.role_bypass_rls !== false || actual.role_pg_monitor !== false
    || actual.role_inherit !== false || actual.role_connection_limit !== 1 || actual.role_valid_until_absent !== true
    || actual.role_memberships_absent !== true || actual.role_settings_absent !== true) reject("MIGRATION_ROLE_IDENTITY_INVALID");
  if (actual.search_path_exact !== true
    || databaseState === "RELEASED" && actual.database_settings_absent !== true
    || databaseState === "MIGRATION_FENCED" && (actual.database_settings_absent !== false || actual.database_read_only_fence_valid !== true)) {
    reject("MIGRATION_DATABASE_SETTINGS_INVALID");
  }
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

async function assertNoUntrackedEmptyTargetState(client: MigrationQueryClient): Promise<void> {
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
      union all
      select 1 from pg_catalog.pg_namespace n where n.nspname not in ('information_schema','pg_catalog','pg_toast','public')
      union all
      select 1 from pg_catalog.pg_event_trigger
      union all
      select 1 from pg_catalog.pg_default_acl
      union all
      select 1 from pg_catalog.pg_largeobject_metadata
      union all
      select 1 from pg_catalog.pg_foreign_data_wrapper
      union all
      select 1 from pg_catalog.pg_foreign_server
      union all
      select 1 from pg_catalog.pg_user_mappings
      union all
      select 1 from pg_catalog.pg_publication
      union all
      select 1 from pg_catalog.pg_subscription
      union all
      select 1 where (select pg_catalog.array_agg(e.extname order by e.extname) from pg_catalog.pg_extension e) is distinct from ARRAY['plpgsql']::pg_catalog.name[]
      union all
      select 1 from pg_catalog.pg_language l where l.lanname not in ('c','internal','plpgsql','sql')
      union all
      select 1 from pg_catalog.pg_db_role_setting s where s.setdatabase=(select d.oid from pg_catalog.pg_database d where d.datname=pg_catalog.current_database())
    ) as present
  `);
  if (result.rows.length !== 1) reject("MIGRATION_EMPTY_TARGET_PROBE_FAILED");
  if (result.rows[0].present) reject("MIGRATION_EMPTY_TARGET_HAS_UNTRACKED_OBJECTS");
}

export async function assertReleaseDatabasePreflight(
  client: MigrationQueryClient,
  authorization: ReleaseAuthorization,
  databaseState: "RELEASED" | "MIGRATION_FENCED" = "RELEASED",
): Promise<void> {
  await assertTargetIdentity(client, authorization, databaseState);
  const present = await migrationHistoryPresent(client);
  let rows: Array<{ version: string; checksum: string }> = [];
  if (authorization.expectedCurrentHead === "EMPTY") {
    if (present) reject("MIGRATION_EMPTY_TARGET_HISTORY_PRESENT");
    await assertNoUntrackedEmptyTargetState(client);
  } else if (present) rows = await readPresentMigrationHistory(client);
  validateAppliedMigrationRows(rows, authorization.manifest.migrations.entries, authorization.expectedCurrentHead);
}

export async function assertReleaseMigrationFence(
  client: MigrationQueryClient,
  authorization: ReleaseAuthorization,
): Promise<ReleaseMigrationFenceEvidence> {
  const result = await client.query<ReleaseMigrationFenceEvidence>(`
    with target as (
      select d.oid,d.datacl,d.datdba from pg_catalog.pg_database d where d.datname=pg_catalog.current_database()
    ), expected_roles as (
      select unnest(ARRAY[
        'chenyida_erp_admin','chenyida_erp_admin_priv','chenyida_erp_backup','chenyida_erp_backup_priv',
        'chenyida_erp_owner','chenyida_erp_web','chenyida_erp_web_priv','chenyida_erp_worker','chenyida_erp_worker_priv'
      ]::text[]) as rolname
    ), expanded as (
      select a.grantor,a.grantee,a.privilege_type,a.is_grantable from target t
      cross join lateral pg_catalog.aclexplode(coalesce(t.datacl,pg_catalog.acldefault('d',t.datdba))) a
    )
    select pg_catalog.current_database()::text as database_name,
           (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,
           t.oid::text as database_oid,
           pg_catalog.shobj_description(t.oid,'pg_database') as marker,
           current_user::text as current_role_name,
           session_user::text as session_role_name,
           pg_catalog.current_setting('application_name')::text as application_name,
           t.datallowconn as database_allow_connections,
           coalesce((select split_part(v,'=',2) from pg_catalog.pg_db_role_setting s
             cross join lateral unnest(s.setconfig) v where s.setdatabase=t.oid and s.setrole=0
             and v like 'default_transaction_read_only=%'), 'RESET')::text as database_default_transaction_read_only,
           (select count(*)::integer from pg_catalog.pg_db_role_setting s
             cross join lateral unnest(s.setconfig) value where s.setdatabase=t.oid) as database_setting_count,
           (select d.datconnlimit::integer from pg_catalog.pg_database d where d.oid=t.oid) as database_connection_limit,
           (select count(*)::integer from pg_catalog.pg_stat_activity a where a.datid=t.oid and a.pid<>pg_catalog.pg_backend_pid()) as other_backend_count,
           (select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname) as managed_roles,
           (select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname where r.rolcanlogin) as login_roles,
           (select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname where r.rolcanlogin and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')) as connect_roles,
           (select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r where r.rolsuper) as platform_superuser_roles,
           exists (select 1 from expanded e where e.grantee=0 and e.privilege_type='CONNECT') as public_connect,
           exists (select 1 from expanded e where e.grantee=0 and e.privilege_type='TEMPORARY') as public_temporary,
           (select count(*)::integer from expanded e where e.grantee<>0 and e.privilege_type='CONNECT'
             and not exists (select 1 from pg_catalog.pg_roles r join expected_roles x on x.rolname=r.rolname where r.oid=e.grantee)) as unknown_connect_acl_count,
           (select count(*)::integer from pg_catalog.pg_roles r where r.rolcanlogin and not r.rolsuper
             and not exists (select 1 from expected_roles e where e.rolname=r.rolname)
             and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')) as unknown_connect_login_count,
           (select count(*)::integer from pg_catalog.pg_prepared_xacts x where x.database=pg_catalog.current_database()) as prepared_transaction_count
           ,coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
             'role',r.rolname::text,'login',r.rolcanlogin,'inherit',r.rolinherit,
             'connection_limit',r.rolconnlimit::integer,'superuser',r.rolsuper,'create_role',r.rolcreaterole,
             'create_database',r.rolcreatedb,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
             'valid_until_absent',r.rolvaliduntil is null,
             'settings_absent',r.rolconfig is null and not exists(
               select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid
             )) order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname),'[]'::json) as role_records
           ,coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
             'role',granted.rolname::text,'member',member.rolname::text,'grantor',grantor.rolname::text,
             'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option
           ) order by granted.rolname,member.rolname) from pg_catalog.pg_auth_members m
             join pg_catalog.pg_roles granted on granted.oid=m.roleid
             join pg_catalog.pg_roles member on member.oid=m.member
             join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
             where granted.rolname in (select rolname from expected_roles)
                or member.rolname in (select rolname from expected_roles)),'[]'::json) as memberships
           ,coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
             'grantee',pg_catalog.pg_get_userbyid(e.grantee)::text,
             'grantor',pg_catalog.pg_get_userbyid(e.grantor)::text,
             'privilege',e.privilege_type::text,'grantable',e.is_grantable
           ) order by pg_catalog.pg_get_userbyid(e.grantee),e.privilege_type)
             from expanded e where e.grantee<>t.datdba and e.grantee<>0),'[]'::json) as non_owner_database_acl
           ,array[
             case when pg_catalog.has_database_privilege(t.datdba,t.oid,'CONNECT') then 'CONNECT' end,
             case when pg_catalog.has_database_privilege(t.datdba,t.oid,'CREATE') then 'CREATE' end,
             case when pg_catalog.has_database_privilege(t.datdba,t.oid,'TEMPORARY') then 'TEMPORARY' end
           ]::text[] as database_owner_privileges
      from target t
  `);
  if (result.rows.length !== 1) reject("MIGRATION_DATABASE_FENCE_INCOMPLETE");
  const actual = result.rows[0];
  const expected = authorization.target;
  const managedRoles = [
    "chenyida_erp_admin", "chenyida_erp_admin_priv", "chenyida_erp_backup", "chenyida_erp_backup_priv",
    "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_web_priv", "chenyida_erp_worker",
    "chenyida_erp_worker_priv",
  ];
  const loginRoles = ["chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_worker"];
  const roleRecords = [
    { role: "chenyida_erp_admin", login: true, inherit: true, connection_limit: 1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_admin_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_backup", login: true, inherit: true, connection_limit: 2, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_backup_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_owner", login: true, inherit: false, connection_limit: 1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_web", login: true, inherit: true, connection_limit: 12, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_web_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_worker", login: true, inherit: true, connection_limit: 6, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    { role: "chenyida_erp_worker_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  ];
  const memberships = [
    { role: "chenyida_erp_admin_priv", member: "chenyida_erp_admin", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
    { role: "chenyida_erp_backup_priv", member: "chenyida_erp_backup", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
    { role: "chenyida_erp_web_priv", member: "chenyida_erp_web", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
    { role: "chenyida_erp_worker_priv", member: "chenyida_erp_worker", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
  ];
  if (actual.database_name !== expected.databaseName || actual.system_identifier !== expected.systemIdentifier
    || actual.database_oid !== expected.databaseOid || actual.marker !== expected.marker
    || actual.current_role_name !== expected.migrationRole || actual.session_role_name !== expected.migrationRole
    || actual.application_name !== "chenyida-erp-migration"
    || actual.database_allow_connections !== true
    || actual.database_default_transaction_read_only !== "on" || actual.database_setting_count !== 1
    || actual.database_connection_limit !== 1
    || actual.other_backend_count !== 0 || JSON.stringify(actual.managed_roles) !== JSON.stringify(managedRoles)
    || JSON.stringify(actual.login_roles) !== JSON.stringify(loginRoles)
    || JSON.stringify(actual.connect_roles) !== JSON.stringify(["chenyida_erp_owner"])
    || JSON.stringify(actual.platform_superuser_roles) !== JSON.stringify(["postgres"])
    || actual.public_connect !== false || actual.public_temporary !== false
    || actual.unknown_connect_acl_count !== 0 || actual.unknown_connect_login_count !== 0
    || actual.prepared_transaction_count !== 0
    || JSON.stringify(actual.role_records) !== JSON.stringify(roleRecords)
    || JSON.stringify(actual.memberships) !== JSON.stringify(memberships)
    || JSON.stringify(actual.non_owner_database_acl) !== JSON.stringify([])
    || JSON.stringify(actual.database_owner_privileges) !== JSON.stringify(["CONNECT", "CREATE", "TEMPORARY"])) {
    reject("MIGRATION_DATABASE_FENCE_INVALID");
  }
  return actual;
}
