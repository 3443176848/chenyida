import { createHash } from "node:crypto";

import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { validateRuntimePrivilegeCompiledCatalog } from "./postgresql-runtime-privilege-catalog.mjs";
import { buildRuntimePrivilegeOperatorTransactionInput } from "./postgresql-runtime-privilege-operator.mjs";
import { validateRuntimePrivilegePolicy } from "./postgresql-runtime-privilege-policy.mjs";
import {
  createRuntimePrivilegeReconciliationPlan,
  validateRuntimePrivilegeState,
  validateRuntimePrivilegeStructuralReport,
} from "./postgresql-runtime-privilege-reconciler.mjs";
import { validateRuntimePrivilegeAccessDocument } from "./postgresql-runtime-privilege-source.mjs";
import {
  migrationAllowlistDigest,
  validateAppliedMigrationRows,
  validateMigrationAllowlist,
} from "./release-manifest-contract.mjs";

export const ISOLATED_UAT_DATABASE_PROJECT = "chenyida-erp-uat-isolated";
export const ISOLATED_UAT_DATABASE_PROJECT_PATTERN = /^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$/;
export const ISOLATED_UAT_DATABASE_BOOTSTRAP_OBSERVATION_CONTRACT =
  "chenyida-erp-isolated-uat-database-bootstrap-observation/v1";
export const ISOLATED_UAT_DATABASE_BOOTSTRAP_PLAN_CONTRACT =
  "chenyida-erp-isolated-uat-database-bootstrap-plan/v1";
export const ISOLATED_UAT_DATABASE_BOOTSTRAP_RECEIPT_CONTRACT =
  "chenyida-erp-isolated-uat-database-bootstrap-receipt/v1";
export const ISOLATED_UAT_DATABASE_MIGRATION_RESULT_CONTRACT =
  "chenyida-erp-isolated-uat-database-migration-result/v1";
export const ISOLATED_UAT_DATABASE_MIGRATION_RECEIPT_CONTRACT =
  "chenyida-erp-isolated-uat-database-migration-receipt/v1";
export const ISOLATED_UAT_DATABASE_UNFENCE_PLAN_CONTRACT =
  "chenyida-erp-isolated-uat-database-unfence-plan/v1";
export const ISOLATED_UAT_DATABASE_UNFENCE_OBSERVATION_CONTRACT =
  "chenyida-erp-isolated-uat-database-unfence-observation/v1";
export const ISOLATED_UAT_DATABASE_UNFENCE_RECEIPT_CONTRACT =
  "chenyida-erp-isolated-uat-database-unfence-receipt/v1";
export const ISOLATED_UAT_DATABASE_FINAL_RECONCILIATION_CONTRACT =
  "chenyida-erp-isolated-uat-database-final-reconciliation/v1";
export const ISOLATED_UAT_DATABASE_FINAL_RECEIPT_CONTRACT =
  "chenyida-erp-isolated-uat-database-final-receipt/v1";

const DATABASE_NAME = "chenyida_erp";
const DEPLOYMENT_CLASS = "UAT";
const BOOTSTRAP_CONTROL_ROLE = "postgres";
const PUBLIC_SCHEMA_OWNER = "pg_database_owner";
const SHA256 = /^[0-9a-f]{64}$/;
const OPERATION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,23}$/;
const OID = /^[1-9][0-9]{0,9}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const MIGRATION_FILE = /^([0-9]{4})_[a-z0-9_]+\.sql$/;
const PASSWORD_BYTES = 43;
const PASSWORD_FINAL = new Set("AEIMQUYcgkosw048");
const MIGRATION_LOCK =
  "SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint)";
const WRITE_SESSION_GATE_ERROR = "ISOLATED_UAT_DATABASE_WRITE_SESSION_REQUIRED";
const OBSERVATION_FIELDS = Object.freeze([
  "schema_version", "contract", "phase", "project", "deployment_class", "database_name",
  "system_identifier", "database_oid", "marker", "database_owner", "database_connection_limit",
  "database_default_transaction_read_only", "database_setting_count", "public_schema_owner",
  "public_schema_public_privileges", "connect_roles", "roles", "memberships", "passworded_login_roles",
  "user_object_count", "migration_history_present", "other_backend_count", "prepared_transaction_count",
]);

export class IsolatedUatDatabaseOperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = "IsolatedUatDatabaseOperatorError";
    this.code = code;
  }
}

function reject(code) {
  throw new IsolatedUatDatabaseOperatorError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
  return value;
}

function exact(left, right, code) {
  if (canonicalClusterJson(left) !== canonicalClusterJson(right)) reject(code);
  return left;
}

function string(value, pattern, code) {
  if (typeof value !== "string" || !value || value !== value.normalize("NFC") || value.includes("\u0000")
    || (pattern && !pattern.test(value))) reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function quoteIdentifier(value) {
  string(value, ROLE, "ISOLATED_UAT_DATABASE_IDENTIFIER_INVALID");
  return `"${value}"`;
}

function quoteLiteral(value) {
  string(value, null, "ISOLATED_UAT_DATABASE_LITERAL_INVALID");
  if (/[^\x20-\x7e]/u.test(value)) reject("ISOLATED_UAT_DATABASE_LITERAL_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizedRole(role) {
  return Object.freeze({
    name: role.name,
    superuser: role.superuser,
    inherit: role.inherit,
    create_role: role.create_role,
    create_database: role.create_database,
    can_login: role.intended_login,
    replication: role.replication,
    connection_limit: role.connection_limit,
    valid_until: role.valid_until,
    bypass_rls: role.bypass_rls,
  });
}

function compareC(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function expectedRoles(policy) {
  return policy.roles.map(normalizedRole).sort((left, right) => compareC(left.name, right.name));
}

function loginRoles(policy) {
  return expectedRoles(policy).filter((role) => role.can_login).map((role) => role.name);
}

function validateSources(input) {
  const code = "ISOLATED_UAT_DATABASE_POLICY_INVALID";
  exactKeys(input, ["policy", "access", "catalog"], code);
  let access;
  let catalog;
  let policy;
  try {
    access = validateRuntimePrivilegeAccessDocument(input.access);
    catalog = validateRuntimePrivilegeCompiledCatalog(input.catalog, { access });
    policy = validateRuntimePrivilegePolicy(input.policy, { access, catalog });
  } catch {
    reject(code);
  }
  const migrations = policy.source_binding?.migrations;
  if (policy.database.name !== DATABASE_NAME || policy.identities.migration_owner !== "chenyida_erp_owner"
    || policy.schema.name !== "public" || policy.schema.owner !== PUBLIC_SCHEMA_OWNER
    || policy.roles.length !== 9 || policy.memberships.length !== 4 || loginRoles(policy).length !== 5
    || migrations?.count !== 46 || migrations?.head !== "0046_runtime_lock_privilege_boundary.sql"
    || !SHA256.test(migrations.allowlist_sha256 || "") || !SHA256.test(migrations.applied_ledger_sha256 || "")) {
    reject(code);
  }
  return Object.freeze({ policy, access, catalog });
}

function expectedMarker(project = ISOLATED_UAT_DATABASE_PROJECT) {
  string(project, ISOLATED_UAT_DATABASE_PROJECT_PATTERN, "ISOLATED_UAT_DATABASE_PROJECT_INVALID");
  return `chenyida-erp-deployment/v2:${DEPLOYMENT_CLASS}:${project}`;
}

function validateRawTarget(value) {
  exactKeys(value, [
    "project", "deployment_class", "database_name", "system_identifier", "database_oid", "marker",
  ], "ISOLATED_UAT_DATABASE_TARGET_INVALID");
  string(value.project, ISOLATED_UAT_DATABASE_PROJECT_PATTERN, "ISOLATED_UAT_DATABASE_TARGET_INVALID");
  if (value.deployment_class !== DEPLOYMENT_CLASS
    || value.database_name !== DATABASE_NAME || value.marker !== expectedMarker(value.project)) {
    reject("ISOLATED_UAT_DATABASE_TARGET_INVALID");
  }
  string(value.system_identifier, SYSTEM_IDENTIFIER, "ISOLATED_UAT_DATABASE_TARGET_INVALID");
  string(value.database_oid, OID, "ISOLATED_UAT_DATABASE_TARGET_INVALID");
  return value;
}

function rawTargetFromObservation(value) {
  return Object.freeze({
    project: value.project,
    deployment_class: value.deployment_class,
    database_name: value.database_name,
    system_identifier: value.system_identifier,
    database_oid: value.database_oid,
    marker: expectedMarker(value.project),
  });
}

export function isolatedUatRuntimePrivilegeTarget(targetInput) {
  const target = validateRawTarget(targetInput);
  return Object.freeze({
    database_oid: target.database_oid,
    system_identifier_sha256: createHash("sha256").update(target.system_identifier, "utf8").digest("hex"),
    marker_sha256: createHash("sha256").update(target.marker, "utf8").digest("hex"),
  });
}

function validateBootstrapObservation(value, sourcesInput, phase) {
  const sources = validateSources(sourcesInput);
  const code = phase === "EMPTY_PRE_BOOTSTRAP"
    ? "ISOLATED_UAT_DATABASE_EMPTY_BOOTSTRAP_OBSERVATION_INVALID"
    : "ISOLATED_UAT_DATABASE_BOOTSTRAP_RESULT_INVALID";
  exactKeys(value, OBSERVATION_FIELDS, code);
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_DATABASE_BOOTSTRAP_OBSERVATION_CONTRACT
    || value.phase !== phase || !ISOLATED_UAT_DATABASE_PROJECT_PATTERN.test(value.project)
    || value.deployment_class !== DEPLOYMENT_CLASS || value.database_name !== DATABASE_NAME) reject(code);
  string(value.system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  if (value.marker !== null) string(value.marker, null, code);
  string(value.database_owner, ROLE, code);
  integer(value.database_connection_limit, -1, sources.policy.database.connection_limit, code);
  if (!["off", "on"].includes(value.database_default_transaction_read_only)) reject(code);
  integer(value.database_setting_count, 0, 1, code);
  if (value.public_schema_owner !== PUBLIC_SCHEMA_OWNER || !Array.isArray(value.public_schema_public_privileges)
    || !Array.isArray(value.connect_roles) || !Array.isArray(value.roles) || !Array.isArray(value.memberships)
    || !Array.isArray(value.passworded_login_roles)) reject(code);
  integer(value.user_object_count, 0, 1_000_000, code);
  if (typeof value.migration_history_present !== "boolean") reject(code);
  integer(value.other_backend_count, 0, 1_000_000, code);
  integer(value.prepared_transaction_count, 0, 1_000_000, code);

  const commonEmpty = value.user_object_count === 0 && value.migration_history_present === false
    && value.other_backend_count === 0 && value.prepared_transaction_count === 0;
  if (!commonEmpty) reject("ISOLATED_UAT_DATABASE_EMPTY_TARGET_REQUIRED");
  if (phase === "EMPTY_PRE_BOOTSTRAP") {
    if (value.marker !== null || value.database_owner !== BOOTSTRAP_CONTROL_ROLE || value.database_connection_limit !== -1
      || value.database_default_transaction_read_only !== "off" || value.database_setting_count !== 0
      || canonicalClusterJson(value.public_schema_public_privileges) !== canonicalClusterJson(["USAGE"])
      || canonicalClusterJson(value.connect_roles) !== canonicalClusterJson(["PUBLIC"])
      || value.roles.length !== 0 || value.memberships.length !== 0 || value.passworded_login_roles.length !== 0) {
      reject(code);
    }
  } else {
    if (value.marker !== expectedMarker(value.project) || value.database_owner !== sources.policy.database.owner
      || value.database_connection_limit !== 1 || value.database_default_transaction_read_only !== "on"
      || value.database_setting_count !== 1 || value.public_schema_public_privileges.length !== 0
      || canonicalClusterJson(value.connect_roles) !== canonicalClusterJson([sources.policy.database.owner])
      || canonicalClusterJson(value.roles) !== canonicalClusterJson(expectedRoles(sources.policy))
      || canonicalClusterJson(value.memberships) !== canonicalClusterJson(sources.policy.memberships)
      || canonicalClusterJson(value.passworded_login_roles) !== canonicalClusterJson(loginRoles(sources.policy))) {
      reject(code);
    }
  }
  return Object.freeze({ value, sources, target: rawTargetFromObservation(value) });
}

export function renderIsolatedUatDatabaseObservationSql(input) {
  exactKeys(input, ["phase", "project"], "ISOLATED_UAT_DATABASE_OBSERVATION_INPUT_INVALID");
  const { phase, project } = input;
  if (!["EMPTY_PRE_BOOTSTRAP", "BOOTSTRAP_FENCED", "POST_MIGRATION_FENCED", "POST_MIGRATION_UNFENCED"].includes(phase)) {
    reject("ISOLATED_UAT_DATABASE_OBSERVATION_PHASE_INVALID");
  }
  expectedMarker(project);
  const phaseSql = quoteLiteral(phase);
  const projectSql = quoteLiteral(project);
  const postMigration = phase === "POST_MIGRATION_FENCED" || phase === "POST_MIGRATION_UNFENCED";
  const ledgerCtes = postMigration
    ? `, ledger_source as (
      select m.version::text as version,m.checksum::text as checksum
        from only public.schema_migrations m
    ), ledger_summary as (
      select coalesce(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('version',l.version,'checksum',l.checksum)
               order by l.version collate "C"
             ),'[]'::jsonb) as value,
             pg_catalog.count(*)::int as applied_count,
             pg_catalog.encode(public.digest(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
               '{"checksum":"' || l.checksum || '","version":"' || l.version || E'"}\\n',
               '' order by l.version collate "C"
             ),''),'UTF8'),'sha256'),'hex') as applied_ledger_sha256
        from ledger_source l
    ), ledger_head as (
      select l.version from ledger_source l order by l.version collate "C" desc limit 1
    )`
    : "";
  const defaultReadOnlySql = `coalesce((
          select pg_catalog.max(pg_catalog.substring(s.setting from 'default_transaction_read_only=(on|off)'))
            from database_settings s
           where s.setrole=0 and s.setting like 'default_transaction_read_only=%'
        ),'off')`;
  const observationSql = postMigration
    ? `pg_catalog.jsonb_build_object(
        'schema_version',1,
        'contract','${ISOLATED_UAT_DATABASE_UNFENCE_OBSERVATION_CONTRACT}',
        'phase',${phaseSql},
        'project',${projectSql},
        'deployment_class','${DEPLOYMENT_CLASS}',
        'database_name',d.datname,
        'system_identifier',d.system_identifier,
        'database_oid',d.oid::text,
        'marker',d.marker,
        'database_owner',pg_catalog.pg_get_userbyid(d.datdba),
        'database_connection_limit',d.datconnlimit,
        'database_default_transaction_read_only',${defaultReadOnlySql},
        'observed_head',(select h.version from ledger_head h),
        'applied_count',(select l.applied_count from ledger_summary l),
        'applied_ledger_sha256',(select l.applied_ledger_sha256 from ledger_summary l),
        'other_backend_count',(select pg_catalog.count(*)::int from pg_catalog.pg_stat_activity a where a.datid=d.oid and a.pid<>pg_catalog.pg_backend_pid()),
        'prepared_transaction_count',(select pg_catalog.count(*)::int from pg_catalog.pg_prepared_xacts x where x.database=d.datname)
      )`
    : `pg_catalog.jsonb_build_object(
        'schema_version',1,
        'contract','${ISOLATED_UAT_DATABASE_BOOTSTRAP_OBSERVATION_CONTRACT}',
        'phase',${phaseSql},
        'project',${projectSql},
        'deployment_class','${DEPLOYMENT_CLASS}',
        'database_name',d.datname,
        'system_identifier',d.system_identifier,
        'database_oid',d.oid::text,
        'marker',d.marker,
        'database_owner',pg_catalog.pg_get_userbyid(d.datdba),
        'database_connection_limit',d.datconnlimit,
        'database_default_transaction_read_only',${defaultReadOnlySql},
        'database_setting_count',(select pg_catalog.count(*)::int from database_settings),
        'public_schema_owner',pg_catalog.pg_get_userbyid(n.nspowner),
        'public_schema_public_privileges',p.value,
        'connect_roles',c.value,
        'roles',r.value,
        'memberships',m.value,
        'passworded_login_roles',w.value,
        'user_object_count',(select pg_catalog.count(*)::int from user_objects),
        'migration_history_present',pg_catalog.to_regclass('public.schema_migrations') is not null,
        'other_backend_count',(select pg_catalog.count(*)::int from pg_catalog.pg_stat_activity a where a.datid=d.oid and a.pid<>pg_catalog.pg_backend_pid()),
        'prepared_transaction_count',(select pg_catalog.count(*)::int from pg_catalog.pg_prepared_xacts x where x.database=d.datname)
      )`;
  const ledgerSql = postMigration ? "(select l.value from ledger_summary l)" : "'[]'::jsonb";
  return [
    "\\set ON_ERROR_STOP on",
    "\\set QUIET on",
    "\\pset format unaligned",
    "\\pset tuples_only on",
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    "SET LOCAL search_path=pg_catalog;",
    "SET LOCAL row_security=off;",
    "SET LOCAL statement_timeout='60s';",
    `with database_row as (
      select d.oid,d.datname,d.datdba,d.datconnlimit,d.datacl,
             pg_catalog.shobj_description(d.oid,'pg_database') as marker,
             c.system_identifier::text as system_identifier
        from pg_catalog.pg_database d
        cross join pg_catalog.pg_control_system() c
       where d.datname=pg_catalog.current_database()
    ), user_roles as (
      select r.oid,r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,
             r.rolcanlogin,r.rolreplication,r.rolconnlimit,r.rolvaliduntil,r.rolbypassrls
        from pg_catalog.pg_roles r
       where r.rolname !~ '^pg_' and r.rolname <> 'postgres'
    ), role_rows as (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name',r.rolname,'superuser',r.rolsuper,'inherit',r.rolinherit,
        'create_role',r.rolcreaterole,'create_database',r.rolcreatedb,
        'can_login',r.rolcanlogin,'replication',r.rolreplication,
        'connection_limit',r.rolconnlimit,'valid_until',r.rolvaliduntil::text,
        'bypass_rls',r.rolbypassrls
      ) order by r.rolname collate "C"),'[]'::jsonb) as value from user_roles r
    ), membership_rows as (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'role',granted.rolname,'member',member.rolname,
        'grantor',case when grantor.rolname='postgres' then 'PLATFORM_OWNER' else grantor.rolname end,
        'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option
      ) order by granted.rolname collate "C",member.rolname collate "C",
        (case when grantor.rolname='postgres' then 'PLATFORM_OWNER' else grantor.rolname end) collate "C"),'[]'::jsonb) as value
        from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles granted on granted.oid=m.roleid
        join pg_catalog.pg_roles member on member.oid=m.member
        join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
       where granted.oid in (select oid from user_roles) or member.oid in (select oid from user_roles)
    ), password_rows as (
      select coalesce(pg_catalog.jsonb_agg(a.rolname order by a.rolname collate "C"),'[]'::jsonb) as value
        from pg_catalog.pg_authid a
       where a.oid in (select oid from user_roles) and a.rolcanlogin
         and a.rolpassword like 'SCRAM-SHA-256$%'
    ), public_schema as (
      select n.oid,n.nspowner,n.nspacl from pg_catalog.pg_namespace n where n.nspname='public'
    ), public_schema_acl as (
      select coalesce(pg_catalog.jsonb_agg(a.privilege_type order by a.privilege_type collate "C"),'[]'::jsonb) as value
        from public_schema n
        cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
       where a.grantee=0
    ), connect_acl as (
      select coalesce(pg_catalog.jsonb_agg(x.grantee order by x.grantee collate "C"),'[]'::jsonb) as value
        from (
          select distinct case when a.grantee=0 then 'PUBLIC' else r.rolname end as grantee
            from database_row d
            cross join lateral pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
            left join pg_catalog.pg_roles r on r.oid=a.grantee
           where a.privilege_type='CONNECT'
             and case when a.grantee=0 then 'PUBLIC' else r.rolname end <> 'postgres'
        ) x
    ), user_objects as (
      select c.oid::text as identity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      union all select p.oid::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      union all select t.oid::text from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('b','c','d','e','m','r')
      union all select o.oid::text from pg_catalog.pg_collation o join pg_catalog.pg_namespace n on n.oid=o.collnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_operator o join pg_catalog.pg_namespace n on n.oid=o.oprnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_opclass o join pg_catalog.pg_namespace n on n.oid=o.opcnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_opfamily o join pg_catalog.pg_namespace n on n.oid=o.opfnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_conversion o join pg_catalog.pg_namespace n on n.oid=o.connamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_ts_config o join pg_catalog.pg_namespace n on n.oid=o.cfgnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_ts_dict o join pg_catalog.pg_namespace n on n.oid=o.dictnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_ts_parser o join pg_catalog.pg_namespace n on n.oid=o.prsnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_ts_template o join pg_catalog.pg_namespace n on n.oid=o.tmplnamespace where n.nspname='public'
      union all select o.oid::text from pg_catalog.pg_extension o join pg_catalog.pg_namespace n on n.oid=o.extnamespace where n.nspname='public'
      union all select n.oid::text from pg_catalog.pg_namespace n where n.nspname not in ('information_schema','pg_catalog','pg_toast','public')
      union all select e.oid::text from pg_catalog.pg_event_trigger e
      union all select d.oid::text from pg_catalog.pg_default_acl d
      union all select l.oid::text from pg_catalog.pg_largeobject_metadata l
      union all select f.oid::text from pg_catalog.pg_foreign_data_wrapper f
      union all select f.oid::text from pg_catalog.pg_foreign_server f
      union all select u.umid::text from pg_catalog.pg_user_mappings u
      union all select p.oid::text from pg_catalog.pg_publication p
      union all select s.oid::text from pg_catalog.pg_subscription s
      union all select l.oid::text from pg_catalog.pg_language l where l.lanname not in ('c','internal','plpgsql','sql')
      union all select e.oid::text from pg_catalog.pg_extension e where e.extname <> 'plpgsql'
    ), database_settings as (
      select s.setrole,item.setting
        from database_row d
        join pg_catalog.pg_db_role_setting s on s.setdatabase=d.oid
        cross join lateral pg_catalog.unnest(s.setconfig) item(setting)
    )${ledgerCtes}
    select pg_catalog.jsonb_build_object(
      'observation',${observationSql},
      'ledger',${ledgerSql}
    )::text
      from database_row d
      cross join public_schema n
      cross join public_schema_acl p
      cross join connect_acl c
      cross join role_rows r
      cross join membership_rows m
      cross join password_rows w;`,
    "COMMIT;",
    "",
  ].join("\n");
}

function roleCreateStatement(role) {
  return `CREATE ROLE ${quoteIdentifier(role.name)} WITH ${role.can_login ? "LOGIN" : "NOLOGIN"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${role.inherit ? "INHERIT" : "NOINHERIT"} CONNECTION LIMIT ${role.connection_limit}`;
}

function membershipStatement(value) {
  return `GRANT ${quoteIdentifier(value.role)} TO ${quoteIdentifier(value.member)} WITH INHERIT ${value.inherit_option ? "TRUE" : "FALSE"}, SET ${value.set_option ? "TRUE" : "FALSE"}`;
}

function bootstrapStatementGroups(policy, target) {
  const roles = expectedRoles(policy);
  const endpoints = ["PUBLIC", ...roles.map((role) => quoteIdentifier(role.name))].join(", ");
  const database = quoteIdentifier(policy.database.name);
  const owner = quoteIdentifier(policy.database.owner);
  const schema = quoteIdentifier(policy.schema.name);
  return Object.freeze({
    role_statements: Object.freeze(roles.map(roleCreateStatement)),
    password_roles: Object.freeze(loginRoles(policy)),
    membership_statements: Object.freeze(policy.memberships.map(membershipStatement)),
    database_statements: Object.freeze([
      `ALTER DATABASE ${database} OWNER TO ${owner}`,
      `COMMENT ON DATABASE ${database} IS ${quoteLiteral(target.marker)}`,
      `ALTER DATABASE ${database} CONNECTION LIMIT 1`,
      `ALTER DATABASE ${database} SET default_transaction_read_only = 'on'`,
      `REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${endpoints}`,
      `GRANT CONNECT ON DATABASE ${database} TO ${owner}`,
    ]),
    schema_statements: Object.freeze([
      `ALTER SCHEMA ${schema} OWNER TO ${quoteIdentifier(policy.schema.owner)}`,
      `REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${endpoints}`,
    ]),
  });
}

export function createIsolatedUatDatabaseBootstrapPlan(observation, sourcesInput) {
  const { value, sources, target } = validateBootstrapObservation(observation, sourcesInput, "EMPTY_PRE_BOOTSTRAP");
  const groups = bootstrapStatementGroups(sources.policy, target);
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_BOOTSTRAP_PLAN_CONTRACT,
    project: target.project,
    target,
    runtime_privilege_policy_sha256: sources.policy.policy_sha256,
    prebootstrap_observation_sha256: clusterSha256(value),
    ...groups,
  });
  return Object.freeze({ ...body, plan_sha256: clusterSha256(body) });
}

function validateBootstrapPlan(plan, sourcesInput) {
  const sources = validateSources(sourcesInput);
  const code = "ISOLATED_UAT_DATABASE_BOOTSTRAP_PLAN_INVALID";
  exactKeys(plan, [
    "schema_version", "contract", "project", "target", "runtime_privilege_policy_sha256",
    "prebootstrap_observation_sha256", "role_statements", "password_roles", "membership_statements",
    "database_statements", "schema_statements", "plan_sha256",
  ], code);
  validateRawTarget(plan.target);
  for (const digest of [plan.runtime_privilege_policy_sha256, plan.prebootstrap_observation_sha256, plan.plan_sha256]) {
    string(digest, SHA256, code);
  }
  if (plan.schema_version !== 1 || plan.contract !== ISOLATED_UAT_DATABASE_BOOTSTRAP_PLAN_CONTRACT
    || plan.project !== plan.target.project
    || plan.runtime_privilege_policy_sha256 !== sources.policy.policy_sha256) reject(code);
  const expected = bootstrapStatementGroups(sources.policy, plan.target);
  for (const field of ["role_statements", "password_roles", "membership_statements", "database_statements", "schema_statements"]) {
    exact(plan[field], expected[field], code);
  }
  const { plan_sha256: ignored, ...body } = plan;
  void ignored;
  if (clusterSha256(body) !== plan.plan_sha256) reject(code);
  return Object.freeze({ plan, sources });
}

function passwordValid(value) {
  if (!Buffer.isBuffer(value) || value.length !== PASSWORD_BYTES) return false;
  const seen = new Set();
  for (const byte of value) {
    if (!(byte >= 0x41 && byte <= 0x5a) && !(byte >= 0x61 && byte <= 0x7a)
      && !(byte >= 0x30 && byte <= 0x39) && byte !== 0x5f && byte !== 0x2d) return false;
    seen.add(byte);
  }
  return seen.size >= 16 && PASSWORD_FINAL.has(String.fromCharCode(value.at(-1)));
}

function append(parts, value) {
  parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"));
}

function wrapWriteEnabledTransaction(transaction) {
  if (!Buffer.isBuffer(transaction) || transaction.length < 1) {
    reject("ISOLATED_UAT_DATABASE_TRANSACTION_BUILDER_INVALID");
  }
  const prefix = Buffer.from([
    "\\set ON_ERROR_STOP on",
    "\\set QUIET on",
    "\\set VERBOSITY terse",
    "SET default_transaction_read_only=off;",
    "SELECT pg_catalog.current_setting('default_transaction_read_only')='off'",
    "   AND pg_catalog.current_setting('transaction_read_only')='off'",
    "   AND NOT pg_catalog.pg_is_in_recovery() AS isolated_uat_write_session_ready",
    "\\gset",
    "\\if :isolated_uat_write_session_ready",
    "",
  ].join("\n"), "utf8");
  const suffix = Buffer.from([
    "",
    "\\else",
    "DO $cyd_isolated_uat_write_gate_failure$",
    "BEGIN",
    `  RAISE EXCEPTION '${WRITE_SESSION_GATE_ERROR}';`,
    "END",
    "$cyd_isolated_uat_write_gate_failure$;",
    "\\endif",
    "",
  ].join("\n"), "utf8");
  try {
    return Buffer.concat([prefix, transaction, suffix]);
  } finally {
    prefix.fill(0);
    transaction.fill(0);
    suffix.fill(0);
  }
}

export async function buildIsolatedUatDatabaseBootstrapTransaction(planInput, sourcesInput, { passwordProvider } = {}) {
  const { plan } = validateBootstrapPlan(planInput, sourcesInput);
  if (typeof passwordProvider !== "function") reject("ISOLATED_UAT_DATABASE_PASSWORD_PROVIDER_REQUIRED");
  const passwords = new Map();
  const owned = [];
  try {
    for (const role of plan.password_roles) {
      let supplied;
      try { supplied = await passwordProvider(role); }
      catch { reject("ISOLATED_UAT_DATABASE_PASSWORD_INVALID"); }
      if (!Buffer.isBuffer(supplied)) reject("ISOLATED_UAT_DATABASE_PASSWORD_INVALID");
      const password = Buffer.from(supplied);
      owned.push(password);
      if (!passwordValid(password) || [...passwords.values()].some((current) => current.equals(password))) {
        reject("ISOLATED_UAT_DATABASE_PASSWORD_INVALID");
      }
      passwords.set(role, password);
    }
    const parts = [];
    append(parts, "\\set ON_ERROR_STOP on\n\\set QUIET on\n\\set VERBOSITY terse\nBEGIN TRANSACTION READ WRITE;\n");
    append(parts, "SET LOCAL log_statement='none';\nSET LOCAL log_min_error_statement='panic';\nSET LOCAL log_duration=off;\nSET LOCAL log_min_duration_statement=-1;\nSET LOCAL password_encryption='scram-sha-256';\n");
    append(parts, `${MIGRATION_LOCK} AS migration_lock_acquired\n\\gset\n\\if :migration_lock_acquired\n`);
    for (const statement of plan.role_statements) append(parts, `${statement};\n`);
    for (const role of plan.password_roles) {
      append(parts, `\\password ${quoteIdentifier(role)}\n`);
      append(parts, passwords.get(role));
      append(parts, "\n");
      append(parts, passwords.get(role));
      append(parts, "\n");
    }
    for (const field of ["membership_statements", "database_statements", "schema_statements"]) {
      for (const statement of plan[field]) append(parts, `${statement};\n`);
    }
    append(parts, "COMMIT;\n\\else\n  ROLLBACK;\nDO $cyd_isolated_uat_bootstrap_failure$\nBEGIN\n  RAISE EXCEPTION 'ISOLATED_UAT_DATABASE_MIGRATION_LOCK_UNAVAILABLE';\nEND\n$cyd_isolated_uat_bootstrap_failure$;\n\\endif\n");
    const result = Buffer.concat(parts);
    for (const part of parts) part.fill(0);
    return wrapWriteEnabledTransaction(result);
  } finally {
    for (const password of owned) password.fill(0);
    passwords.clear();
  }
}

export function disposeIsolatedUatDatabaseTransaction(value) {
  if (!Buffer.isBuffer(value)) return false;
  value.fill(0);
  return true;
}

export function verifyIsolatedUatDatabaseBootstrapResult(planInput, observation, sourcesInput) {
  const { plan, sources } = validateBootstrapPlan(planInput, sourcesInput);
  const verified = validateBootstrapObservation(observation, sources, "BOOTSTRAP_FENCED");
  exact(verified.target, plan.target, "ISOLATED_UAT_DATABASE_BOOTSTRAP_TARGET_MISMATCH");
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_BOOTSTRAP_RECEIPT_CONTRACT,
    status: "BOOTSTRAP_VERIFIED",
    project: plan.project,
    target: plan.target,
    runtime_privilege_policy_sha256: sources.policy.policy_sha256,
    bootstrap_plan_sha256: plan.plan_sha256,
    observation_sha256: clusterSha256(observation),
    role_set_sha256: clusterSha256(expectedRoles(sources.policy)),
    membership_set_sha256: clusterSha256(sources.policy.memberships),
  });
  return Object.freeze({ ...body, receipt_sha256: clusterSha256(body) });
}

function validateBootstrapReceipt(value, sourcesInput) {
  const sources = validateSources(sourcesInput);
  const code = "ISOLATED_UAT_DATABASE_BOOTSTRAP_RECEIPT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "project", "target", "runtime_privilege_policy_sha256",
    "bootstrap_plan_sha256", "observation_sha256", "role_set_sha256", "membership_set_sha256", "receipt_sha256",
  ], code);
  validateRawTarget(value.target);
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_DATABASE_BOOTSTRAP_RECEIPT_CONTRACT
    || value.status !== "BOOTSTRAP_VERIFIED" || value.project !== value.target.project
    || value.runtime_privilege_policy_sha256 !== sources.policy.policy_sha256
    || value.role_set_sha256 !== clusterSha256(expectedRoles(sources.policy))
    || value.membership_set_sha256 !== clusterSha256(sources.policy.memberships)) reject(code);
  for (const field of ["bootstrap_plan_sha256", "observation_sha256", "receipt_sha256"]) string(value[field], SHA256, code);
  const { receipt_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.receipt_sha256) reject(code);
  return Object.freeze({ receipt: value, sources });
}

function appliedLedgerSha256(rows) {
  const digest = createHash("sha256");
  for (const row of rows) digest.update(canonicalClusterJson(row), "utf8");
  return digest.digest("hex");
}

function validateExactMigrationEvidence(allowlist, ledger, sources) {
  const migrations = sources.policy.source_binding.migrations;
  try { validateMigrationAllowlist(allowlist, migrations.allowlist_sha256); }
  catch { reject("ISOLATED_UAT_DATABASE_MIGRATION_ALLOWLIST_INVALID"); }
  if (allowlist.length !== migrations.count || allowlist.at(-1)?.filename !== migrations.head
    || migrationAllowlistDigest(allowlist) !== migrations.allowlist_sha256) {
    reject("ISOLATED_UAT_DATABASE_MIGRATION_ALLOWLIST_INVALID");
  }
  if (!Array.isArray(ledger)) reject("ISOLATED_UAT_DATABASE_MIGRATION_LEDGER_INVALID");
  try { validateAppliedMigrationRows(ledger, allowlist, migrations.head); }
  catch (error) {
    if (error?.code === "APPLIED_MIGRATION_CHECKSUM_MISMATCH") {
      reject("ISOLATED_UAT_DATABASE_MIGRATION_LEDGER_CHECKSUM_MISMATCH");
    }
    reject("ISOLATED_UAT_DATABASE_MIGRATION_LEDGER_INVALID");
  }
  const digest = appliedLedgerSha256(ledger);
  if (digest !== migrations.applied_ledger_sha256) reject("ISOLATED_UAT_DATABASE_MIGRATION_LEDGER_INVALID");
  return Object.freeze({ allowlist_sha256: migrations.allowlist_sha256, applied_ledger_sha256: digest });
}

export function createIsolatedUatDatabaseMigrationResult(input) {
  const code = "ISOLATED_UAT_DATABASE_MIGRATION_RESULT_INVALID";
  exactKeys(input, [
    "status", "project", "target", "bootstrap_receipt_sha256", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "engine_result_sha256", "migration_role", "from_head", "to_head",
    "applied_count", "allowlist_sha256", "applied_ledger_sha256", "observed_head",
    "database_default_transaction_read_only", "migration_transaction_read_only",
    "other_backend_count_before", "other_backend_count_after",
  ], code);
  validateRawTarget(input.target);
  if (input.status !== "MIGRATION_COMMITTED" || input.project !== input.target.project
    || input.migration_role !== "chenyida_erp_owner" || input.from_head !== "EMPTY"
    || input.database_default_transaction_read_only !== "on" || input.migration_transaction_read_only !== "off"
    || input.other_backend_count_before !== 0 || input.other_backend_count_after !== 0) reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(input[field], OPERATION_IDENTIFIER, code);
  for (const field of [
    "bootstrap_receipt_sha256", "execution_authorization_sha256", "grant_sha256", "engine_result_sha256",
  ]) string(input[field], SHA256, code);
  string(input.to_head, MIGRATION_FILE, code);
  string(input.observed_head, MIGRATION_FILE, code);
  integer(input.applied_count, 1, 9999, code);
  string(input.allowlist_sha256, SHA256, code);
  string(input.applied_ledger_sha256, SHA256, code);
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_MIGRATION_RESULT_CONTRACT,
    ...structuredClone(input),
  });
  return Object.freeze({ ...body, result_sha256: clusterSha256(body) });
}

function validateMigrationResult(value) {
  const code = "ISOLATED_UAT_DATABASE_MIGRATION_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "project", "target", "bootstrap_receipt_sha256", "promotion_id",
    "migration_operation_id", "execution_authorization_sha256", "grant_sha256", "engine_result_sha256", "migration_role",
    "from_head", "to_head", "applied_count", "allowlist_sha256", "applied_ledger_sha256", "observed_head",
    "database_default_transaction_read_only", "migration_transaction_read_only", "other_backend_count_before",
    "other_backend_count_after", "result_sha256",
  ], code);
  const { schema_version: ignoredVersion, contract: ignoredContract, result_sha256: ignoredDigest, ...input } = value;
  void ignoredVersion; void ignoredContract; void ignoredDigest;
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_DATABASE_MIGRATION_RESULT_CONTRACT
    || canonicalClusterJson(createIsolatedUatDatabaseMigrationResult(input)) !== canonicalClusterJson(value)) reject(code);
  return value;
}

function validatePostMigrationObservation(value, targetInput, sources, phase) {
  const fenced = phase === "POST_MIGRATION_FENCED";
  const code = fenced
    ? "ISOLATED_UAT_DATABASE_FENCED_MIGRATION_OBSERVATION_INVALID"
    : "ISOLATED_UAT_DATABASE_UNFENCE_OBSERVATION_INVALID";
  const targetCode = fenced
    ? "ISOLATED_UAT_DATABASE_FENCED_MIGRATION_TARGET_MISMATCH"
    : "ISOLATED_UAT_DATABASE_UNFENCE_TARGET_MISMATCH";
  exactKeys(value, [
    "schema_version", "contract", "phase", "project", "deployment_class", "database_name", "system_identifier",
    "database_oid", "marker", "database_owner", "database_connection_limit",
    "database_default_transaction_read_only", "observed_head", "applied_count", "applied_ledger_sha256",
    "other_backend_count", "prepared_transaction_count",
  ], code);
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_DATABASE_UNFENCE_OBSERVATION_CONTRACT
    || value.phase !== phase || !ISOLATED_UAT_DATABASE_PROJECT_PATTERN.test(value.project)
    || value.deployment_class !== DEPLOYMENT_CLASS || value.database_name !== DATABASE_NAME) reject(code);
  string(value.system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  const target = rawTargetFromObservation(value);
  exact(target, targetInput, targetCode);
  const migrations = sources.policy.source_binding.migrations;
  if (value.marker !== target.marker || value.database_owner !== sources.policy.database.owner
    || value.database_connection_limit !== 1
    || value.database_default_transaction_read_only !== (fenced ? "on" : "off")
    || value.observed_head !== migrations.head || value.applied_count !== migrations.count
    || value.applied_ledger_sha256 !== migrations.applied_ledger_sha256
    || value.other_backend_count !== 0 || value.prepared_transaction_count !== 0) reject(code);
  return Object.freeze({ target, observation_sha256: clusterSha256(value) });
}

export function verifyIsolatedUatDatabaseMigration(
  { bootstrapReceipt, migrationResult, allowlist, ledger, observation },
  sourcesInput,
) {
  const { receipt: bootstrap, sources } = validateBootstrapReceipt(bootstrapReceipt, sourcesInput);
  const result = validateMigrationResult(migrationResult);
  const evidence = validateExactMigrationEvidence(allowlist, ledger, sources);
  const live = validatePostMigrationObservation(observation, bootstrap.target, sources, "POST_MIGRATION_FENCED");
  const migrations = sources.policy.source_binding.migrations;
  if (result.bootstrap_receipt_sha256 !== bootstrap.receipt_sha256
    || canonicalClusterJson(result.target) !== canonicalClusterJson(bootstrap.target)
    || result.to_head !== migrations.head || result.observed_head !== migrations.head
    || result.applied_count !== migrations.count || result.allowlist_sha256 !== evidence.allowlist_sha256
    || result.applied_ledger_sha256 !== evidence.applied_ledger_sha256
    || observation.observed_head !== result.observed_head
    || observation.applied_count !== result.applied_count
    || observation.applied_ledger_sha256 !== result.applied_ledger_sha256) {
    reject("ISOLATED_UAT_DATABASE_MIGRATION_BINDING_INVALID");
  }
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_MIGRATION_RECEIPT_CONTRACT,
    status: "MIGRATION_VERIFIED",
    project: bootstrap.project,
    target: bootstrap.target,
    bootstrap_receipt_sha256: bootstrap.receipt_sha256,
    migration_result_sha256: result.result_sha256,
    promotion_id: result.promotion_id,
    migration_operation_id: result.migration_operation_id,
    execution_authorization_sha256: result.execution_authorization_sha256,
    grant_sha256: result.grant_sha256,
    engine_result_sha256: result.engine_result_sha256,
    fenced_observation_sha256: live.observation_sha256,
    from_head: "EMPTY",
    to_head: migrations.head,
    applied_count: migrations.count,
    allowlist_sha256: evidence.allowlist_sha256,
    applied_ledger_sha256: evidence.applied_ledger_sha256,
  });
  return Object.freeze({ ...body, receipt_sha256: clusterSha256(body) });
}

function validateMigrationReceipt(value, sourcesInput) {
  const sources = validateSources(sourcesInput);
  const code = "ISOLATED_UAT_DATABASE_MIGRATION_RECEIPT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "project", "target", "bootstrap_receipt_sha256",
    "migration_result_sha256", "promotion_id", "migration_operation_id", "execution_authorization_sha256",
    "grant_sha256", "engine_result_sha256", "fenced_observation_sha256", "from_head", "to_head", "applied_count", "allowlist_sha256",
    "applied_ledger_sha256", "receipt_sha256",
  ], code);
  validateRawTarget(value.target);
  const migrations = sources.policy.source_binding.migrations;
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_DATABASE_MIGRATION_RECEIPT_CONTRACT
    || value.status !== "MIGRATION_VERIFIED" || value.project !== value.target.project
    || value.from_head !== "EMPTY" || value.to_head !== migrations.head || value.applied_count !== migrations.count
    || value.allowlist_sha256 !== migrations.allowlist_sha256
    || value.applied_ledger_sha256 !== migrations.applied_ledger_sha256) reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], OPERATION_IDENTIFIER, code);
  for (const field of [
    "bootstrap_receipt_sha256", "migration_result_sha256", "execution_authorization_sha256", "grant_sha256",
    "engine_result_sha256", "fenced_observation_sha256", "receipt_sha256",
  ]) string(value[field], SHA256, code);
  const { receipt_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.receipt_sha256) reject(code);
  return Object.freeze({ receipt: value, sources });
}

export function createIsolatedUatDatabaseUnfencePlan(migrationReceipt, sourcesInput) {
  const { receipt, sources } = validateMigrationReceipt(migrationReceipt, sourcesInput);
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_UNFENCE_PLAN_CONTRACT,
    status: "UNFENCE_AUTHORIZED_BY_VERIFIED_MIGRATION",
    project: receipt.project,
    target: receipt.target,
    migration_receipt_sha256: receipt.receipt_sha256,
    fenced_observation_sha256: receipt.fenced_observation_sha256,
    applied_ledger_sha256: receipt.applied_ledger_sha256,
    statement: `ALTER DATABASE ${quoteIdentifier(sources.policy.database.name)} RESET default_transaction_read_only`,
  });
  return Object.freeze({ ...body, plan_sha256: clusterSha256(body) });
}

function validateUnfencePlan(value, migrationReceipt, sourcesInput) {
  const expected = createIsolatedUatDatabaseUnfencePlan(migrationReceipt, sourcesInput);
  if (canonicalClusterJson(value) !== canonicalClusterJson(expected)) reject("ISOLATED_UAT_DATABASE_UNFENCE_PLAN_INVALID");
  return value;
}

export function buildIsolatedUatDatabaseUnfenceTransaction(planInput, migrationReceipt, sourcesInput) {
  const { receipt, sources } = validateMigrationReceipt(migrationReceipt, sourcesInput);
  const plan = validateUnfencePlan(planInput, receipt, sources);
  const target = receipt.target;
  const ledgerDigest = receipt.applied_ledger_sha256;
  return wrapWriteEnabledTransaction(Buffer.from([
    "\\set ON_ERROR_STOP on",
    "\\set QUIET on",
    "\\set VERBOSITY terse",
    "BEGIN TRANSACTION READ WRITE;",
    "SET LOCAL search_path=pg_catalog;",
    "SET LOCAL row_security=off;",
    "SET LOCAL statement_timeout='60s';",
    `${MIGRATION_LOCK} AS migration_lock_acquired`,
    "\\gset",
    "\\if :migration_lock_acquired",
    `with database_row as (
      select d.oid,d.datname,d.datdba,d.datconnlimit,
             pg_catalog.shobj_description(d.oid,'pg_database') as marker,
             c.system_identifier::text as system_identifier
        from pg_catalog.pg_database d
        cross join pg_catalog.pg_control_system() c
       where d.datname=pg_catalog.current_database()
    ), database_settings as (
      select s.setrole,item.setting
        from database_row d
        join pg_catalog.pg_db_role_setting s on s.setdatabase=d.oid
        cross join lateral pg_catalog.unnest(s.setconfig) item(setting)
    ), ledger_source as (
      select m.version::text as version,m.checksum::text as checksum
        from only public.schema_migrations m
    ), ledger_summary as (
      select pg_catalog.count(*)::int as applied_count,
             pg_catalog.max(l.version collate "C") as observed_head,
             pg_catalog.encode(public.digest(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
               '{"checksum":"' || l.checksum || '","version":"' || l.version || E'"}\\n',
               '' order by l.version collate "C"
             ),''),'UTF8'),'sha256'),'hex') as applied_ledger_sha256
        from ledger_source l
    )
    select (
      d.datname=${quoteLiteral(target.database_name)}
      and d.system_identifier=${quoteLiteral(target.system_identifier)}
      and d.oid::text=${quoteLiteral(target.database_oid)}
      and d.marker=${quoteLiteral(target.marker)}
      and pg_catalog.pg_get_userbyid(d.datdba)=${quoteLiteral(sources.policy.database.owner)}
      and d.datconnlimit=1
      and (select pg_catalog.count(*) from database_settings s
            where s.setrole=0 and s.setting like 'default_transaction_read_only=%')=1
      and (select pg_catalog.max(pg_catalog.substring(s.setting from 'default_transaction_read_only=(on|off)'))
             from database_settings s where s.setrole=0 and s.setting like 'default_transaction_read_only=%')='on'
      and l.observed_head=${quoteLiteral(receipt.to_head)}
      and l.applied_count=${receipt.applied_count}
      and l.applied_ledger_sha256=${quoteLiteral(ledgerDigest)}
      and (select pg_catalog.count(*) from pg_catalog.pg_stat_activity a
            where a.datid=d.oid and a.pid<>pg_catalog.pg_backend_pid())=0
      and (select pg_catalog.count(*) from pg_catalog.pg_prepared_xacts x where x.database=d.datname)=0
    ) as unfence_precondition_valid
      from database_row d cross join ledger_summary l`,
    "\\gset",
    "\\if :unfence_precondition_valid",
    `  ${plan.statement};`,
    "  COMMIT;",
    "\\else",
    "  ROLLBACK;",
    "DO $cyd_isolated_uat_unfence_precondition_failure$",
    "BEGIN",
    "  RAISE EXCEPTION 'ISOLATED_UAT_DATABASE_UNFENCE_PRECONDITION_CHANGED';",
    "END",
    "$cyd_isolated_uat_unfence_precondition_failure$;",
    "\\endif",
    "\\else",
    "  ROLLBACK;",
    "DO $cyd_isolated_uat_unfence_failure$",
    "BEGIN",
    "  RAISE EXCEPTION 'ISOLATED_UAT_DATABASE_MIGRATION_LOCK_UNAVAILABLE';",
    "END",
    "$cyd_isolated_uat_unfence_failure$;",
    "\\endif",
    "",
  ].join("\n"), "utf8"));
}

export function verifyIsolatedUatDatabaseUnfence(planInput, migrationReceipt, observation, sourcesInput) {
  const { receipt: migration, sources } = validateMigrationReceipt(migrationReceipt, sourcesInput);
  const plan = validateUnfencePlan(planInput, migration, sources);
  const { target } = validatePostMigrationObservation(
    observation, migration.target, sources, "POST_MIGRATION_UNFENCED",
  );
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_UNFENCE_RECEIPT_CONTRACT,
    status: "UNFENCE_VERIFIED",
    project: migration.project,
    target,
    migration_receipt_sha256: migration.receipt_sha256,
    unfence_plan_sha256: plan.plan_sha256,
    observation_sha256: clusterSha256(observation),
    applied_ledger_sha256: migration.applied_ledger_sha256,
  });
  return Object.freeze({ ...body, receipt_sha256: clusterSha256(body) });
}

function validateUnfenceReceipt(value, sourcesInput) {
  const sources = validateSources(sourcesInput);
  const code = "ISOLATED_UAT_DATABASE_UNFENCE_RECEIPT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "project", "target", "migration_receipt_sha256",
    "unfence_plan_sha256", "observation_sha256", "applied_ledger_sha256", "receipt_sha256",
  ], code);
  validateRawTarget(value.target);
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_DATABASE_UNFENCE_RECEIPT_CONTRACT
    || value.status !== "UNFENCE_VERIFIED" || value.project !== value.target.project
    || value.applied_ledger_sha256 !== sources.policy.source_binding.migrations.applied_ledger_sha256) reject(code);
  for (const field of ["migration_receipt_sha256", "unfence_plan_sha256", "observation_sha256", "receipt_sha256"]) {
    string(value[field], SHA256, code);
  }
  const { receipt_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.receipt_sha256) reject(code);
  return Object.freeze({ receipt: value, sources });
}

function validatePostMigrationBaseline(baseline, target, sources) {
  validateRuntimePrivilegeState(baseline, { ...sources, expectedTarget: target, mode: "baseline" });
  if (baseline.database.owner !== sources.policy.database.owner || baseline.database.connection_limit !== 1
    || canonicalClusterJson(baseline.roles) !== canonicalClusterJson(expectedRoles(sources.policy))
    || canonicalClusterJson(baseline.memberships) !== canonicalClusterJson(sources.policy.memberships)) {
    reject("ISOLATED_UAT_DATABASE_POST_MIGRATION_BASELINE_INVALID");
  }
  return baseline;
}

export function createIsolatedUatDatabaseFinalReconciliation(
  { unfenceReceipt, baselineState, structuralReport },
  sourcesInput,
  { structuralValidator = validateRuntimePrivilegeStructuralReport } = {},
) {
  const { receipt: unfence, sources } = validateUnfenceReceipt(unfenceReceipt, sourcesInput);
  const target = isolatedUatRuntimePrivilegeTarget(unfence.target);
  const baseline = validatePostMigrationBaseline(baselineState, target, sources);
  let structure;
  try {
    structure = structuralValidator(structuralReport, { ...sources, expectedDefaultPrivilegeCount: 0 });
  } catch (error) {
    if (error?.code) throw error;
    reject("ISOLATED_UAT_DATABASE_POST_MIGRATION_STRUCTURE_INVALID");
  }
  const runtimePlan = createRuntimePrivilegeReconciliationPlan(baseline, sources);
  if (runtimePlan.role_bootstrap) reject("ISOLATED_UAT_DATABASE_FINAL_ROLE_BOOTSTRAP_FORBIDDEN");
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_FINAL_RECONCILIATION_CONTRACT,
    status: "FINAL_RECONCILIATION_PLANNED",
    project: unfence.project,
    target: unfence.target,
    unfence_receipt_sha256: unfence.receipt_sha256,
    baseline_state_sha256: clusterSha256(baseline),
    baseline_structure_sha256: clusterSha256(structure),
    runtime_privilege_plan: runtimePlan,
  });
  return Object.freeze({ ...body, reconciliation_sha256: clusterSha256(body) });
}

function validateFinalReconciliation(value, input, sourcesInput, options) {
  const expected = createIsolatedUatDatabaseFinalReconciliation(input, sourcesInput, options);
  if (canonicalClusterJson(value) !== canonicalClusterJson(expected)) {
    reject("ISOLATED_UAT_DATABASE_FINAL_RECONCILIATION_INVALID");
  }
  return expected;
}

export function buildIsolatedUatDatabaseFinalReconciliationTransaction(
  reconciliationInput,
  input,
  sourcesInput,
  {
    structuralValidator = validateRuntimePrivilegeStructuralReport,
    transactionBuilder = buildRuntimePrivilegeOperatorTransactionInput,
    credentialBinding,
    passwordProvider,
  } = {},
) {
  const sources = validateSources(sourcesInput);
  const reconciliation = validateFinalReconciliation(
    reconciliationInput,
    input,
    sources,
    { structuralValidator },
  );
  if (typeof transactionBuilder !== "function") reject("ISOLATED_UAT_DATABASE_TRANSACTION_BUILDER_INVALID");
  const transaction = transactionBuilder(
    reconciliation.runtime_privilege_plan,
    credentialBinding,
    { baseline: input.baselineState, sources, operation: "RECONCILE", passwordProvider },
  );
  if (!Buffer.isBuffer(transaction) || transaction.length < 1) reject("ISOLATED_UAT_DATABASE_TRANSACTION_BUILDER_INVALID");
  return wrapWriteEnabledTransaction(transaction);
}

export function verifyIsolatedUatDatabaseFinalState(
  { reconciliation, unfenceReceipt, baselineState, baselineStructuralReport, finalState, finalStructuralReport },
  sourcesInput,
  { structuralValidator = validateRuntimePrivilegeStructuralReport } = {},
) {
  const sources = validateSources(sourcesInput);
  const planned = validateFinalReconciliation(
    reconciliation,
    { unfenceReceipt, baselineState, structuralReport: baselineStructuralReport },
    sources,
    { structuralValidator },
  );
  const target = isolatedUatRuntimePrivilegeTarget(planned.target);
  validateRuntimePrivilegeState(finalState, {
    ...sources,
    expectedTarget: target,
    mode: "final",
    expectedFinal: planned.runtime_privilege_plan.desired,
  });
  let structure;
  try {
    structure = structuralValidator(finalStructuralReport, { ...sources, expectedDefaultPrivilegeCount: 2 });
  } catch (error) {
    if (error?.code) throw error;
    reject("ISOLATED_UAT_DATABASE_FINAL_STRUCTURE_INVALID");
  }
  const body = Object.freeze({
    schema_version: 1,
    contract: ISOLATED_UAT_DATABASE_FINAL_RECEIPT_CONTRACT,
    status: "FINAL_DATABASE_PRIVILEGES_VERIFIED",
    project: planned.project,
    target: planned.target,
    reconciliation_sha256: planned.reconciliation_sha256,
    final_state_sha256: clusterSha256(finalState),
    final_structure_sha256: clusterSha256(structure),
    runtime_privilege_policy_sha256: sources.policy.policy_sha256,
  });
  return Object.freeze({ ...body, receipt_sha256: clusterSha256(body) });
}
