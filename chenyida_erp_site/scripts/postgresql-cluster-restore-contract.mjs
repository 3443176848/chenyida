import { spawn } from "node:child_process";
import path from "node:path";

import {
  ClusterRecoveryError,
  assertCredentialBindingUnchanged,
  canonicalClusterJson,
  clusterPolicySha256,
  clusterSha256,
  credentialPassword,
  validateClusterRecoveryPolicy,
  validateClusterSnapshot,
  validateTablespaceMapDocument,
} from "./postgresql-cluster-recovery-contract.mjs";

export const CLUSTER_RESTORE_PLAN_CONTRACT = "chenyida-erp-postgresql-cluster-restore-plan/v1";

const PLAN_CLASSIFICATION = "PRIVATE_OPERATOR_PLAN";
const RECOVERY_MARKER_PREFIX = "chenyida-erp-postgresql-recovery/v1";
const DATA_RESTORE_ARGUMENTS = Object.freeze(["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"]);
const TABLE_KINDS = new Set(["TABLE", "PARTITIONED_TABLE", "VIEW", "MATERIALIZED_VIEW"]);
const SAFE_CONNECTION_ENVIRONMENT = new Set([
  "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGSERVICEFILE", "PGSERVICE", "PGCONNECT_TIMEOUT", "PGSSLMODE", "PGSSLROOTCERT",
]);

function reject(code) {
  throw new ClusterRecoveryError(code);
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function boundedText(value, code, maximumBytes = 1024) {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > maximumBytes || /[\u0000-\u001f\u007f]/u.test(value)) reject(code);
  return value;
}

export function quotePostgresIdentifier(value) {
  boundedText(value, "CLUSTER_RESTORE_IDENTIFIER_INVALID", 512);
  return `"${value.replaceAll('"', '""')}"`;
}

export function quotePostgresLiteral(value) {
  boundedText(value, "CLUSTER_RESTORE_LITERAL_INVALID", 4096);
  return `'${value.replaceAll("'", "''")}'`;
}

function roleSpecification(value) {
  return value === "PUBLIC" ? "PUBLIC" : quotePostgresIdentifier(value);
}

function qualified(schema, name) {
  return `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(name)}`;
}

function sqlDocument(lines) {
  const document = `${lines.join("\n")}\n`;
  if (/\u0000|\r/u.test(document)) reject("CLUSTER_RESTORE_SQL_INVALID");
  return document;
}

function sqlArtifact(sql) {
  return Object.freeze({ sql, sql_sha256: clusterSha256(sql) });
}

function validateDatabaseProfile(value, policy) {
  exactKeys(value, ["server_major", "encoding", "locale_provider", "collate", "ctype", "collation_version"], "CLUSTER_RESTORE_DATABASE_PROFILE_INVALID");
  if (value.server_major !== policy.postgresql_major || value.locale_provider !== "libc") reject("CLUSTER_RESTORE_DATABASE_PROFILE_UNSUPPORTED");
  if (typeof value.encoding !== "string" || !/^[A-Z0-9_-]{1,32}$/u.test(value.encoding)) reject("CLUSTER_RESTORE_DATABASE_PROFILE_INVALID");
  boundedText(value.collate, "CLUSTER_RESTORE_DATABASE_PROFILE_INVALID");
  boundedText(value.ctype, "CLUSTER_RESTORE_DATABASE_PROFILE_INVALID");
  if (value.collation_version !== null) boundedText(value.collation_version, "CLUSTER_RESTORE_DATABASE_PROFILE_INVALID");
  return value;
}

function recoveryResource({ kind, snapshot, policy, discriminator }) {
  const resourceIdentitySha256 = clusterSha256({
    contract: RECOVERY_MARKER_PREFIX,
    kind,
    snapshot_sha256: snapshot.snapshot_sha256,
    policy_sha256: clusterPolicySha256(policy),
    discriminator,
  });
  return Object.freeze({
    resource_identity_sha256: resourceIdentitySha256,
    recovery_marker: `${RECOVERY_MARKER_PREFIX}:${kind}:${resourceIdentitySha256}`,
  });
}

function roleSkeletonSql(snapshot, roles) {
  const lines = ["BEGIN;", "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';"];
  for (const [index, role] of snapshot.catalog.roles.entries()) {
    const attributes = [
      "NOSUPERUSER",
      role.inherit ? "INHERIT" : "NOINHERIT",
      "NOCREATEROLE",
      "NOCREATEDB",
      "NOLOGIN",
      "NOREPLICATION",
      `CONNECTION LIMIT ${role.connection_limit}`,
      "PASSWORD NULL",
      `VALID UNTIL ${quotePostgresLiteral(role.valid_until ?? "infinity")}`,
      "NOBYPASSRLS",
    ];
    lines.push(`CREATE ROLE ${quotePostgresIdentifier(role.name)} WITH ${attributes.join(" ")};`);
    lines.push(`COMMENT ON ROLE ${quotePostgresIdentifier(role.name)} IS ${quotePostgresLiteral(roles[index].recovery_marker)};`);
  }
  lines.push("COMMIT;");
  return sqlDocument(lines);
}

function tablespaceSql(tablespace, entry, recoveryMarker) {
  if (tablespace.options.length !== 0) reject("CLUSTER_RESTORE_TABLESPACE_OPTIONS_UNSUPPORTED");
  return sqlDocument([
    "SET lock_timeout = '5s';",
    "SET statement_timeout = '120s';",
    `CREATE TABLESPACE ${quotePostgresIdentifier(tablespace.name)} OWNER ${quotePostgresIdentifier(tablespace.owner)} LOCATION ${quotePostgresLiteral(entry.server_path)};`,
    `COMMENT ON TABLESPACE ${quotePostgresIdentifier(tablespace.name)} IS ${quotePostgresLiteral(recoveryMarker)};`,
  ]);
}

function databaseSql(snapshot, profile, recoveryMarker) {
  const database = snapshot.catalog.database;
  const options = [
    `OWNER ${quotePostgresIdentifier(database.owner)}`,
    "TEMPLATE template0",
    `ENCODING ${quotePostgresLiteral(profile.encoding)}`,
    "LOCALE_PROVIDER libc",
    `LC_COLLATE ${quotePostgresLiteral(profile.collate)}`,
    `LC_CTYPE ${quotePostgresLiteral(profile.ctype)}`,
    `TABLESPACE ${quotePostgresIdentifier(database.default_tablespace)}`,
    "CONNECTION LIMIT 0",
  ];
  if (profile.collation_version !== null && profile.collation_version !== "NONE") {
    options.push(`COLLATION_VERSION ${quotePostgresLiteral(profile.collation_version)}`);
  }
  return sqlDocument([
    "SET lock_timeout = '5s';",
    "SET statement_timeout = '120s';",
    `CREATE DATABASE ${quotePostgresIdentifier(database.name)} WITH ${options.join(" ")};`,
    `COMMENT ON DATABASE ${quotePostgresIdentifier(database.name)} IS ${quotePostgresLiteral(recoveryMarker)};`,
  ]);
}

function routineReference(objectValue) {
  const argumentsSql = objectValue.identity_arguments.map((argument) => qualified(argument.schema, argument.name)).join(", ");
  return `${qualified(objectValue.schema, objectValue.name)}(${argumentsSql})`;
}

function aclTarget(kind, value) {
  if (kind === "DATABASE") return { object: `DATABASE ${quotePostgresIdentifier(value.name)}`, column: null };
  if (kind === "SCHEMA") return { object: `SCHEMA ${quotePostgresIdentifier(value.name)}`, column: null };
  if (TABLE_KINDS.has(kind)) return { object: `TABLE ${qualified(value.schema, value.name)}`, column: null };
  if (kind === "SEQUENCE") return { object: `SEQUENCE ${qualified(value.schema, value.name)}`, column: null };
  if (kind === "COLUMN") return { object: `TABLE ${qualified(value.schema, value.parent_identity)}`, column: quotePostgresIdentifier(value.name) };
  if (kind === "ROUTINE") return { object: `ROUTINE ${routineReference(value)}`, column: null };
  if (kind === "TYPE") return { object: `TYPE ${qualified(value.schema, value.name)}`, column: null };
  if (kind === "LARGE_OBJECT") return { object: `LARGE OBJECT ${value.name.slice(3)}`, column: null };
  if (kind === "TABLESPACE") return { object: `TABLESPACE ${quotePostgresIdentifier(value.name)}`, column: null };
  reject("CLUSTER_RESTORE_ACL_KIND_UNSUPPORTED");
}

function revokeStatement(kind, value, grantee) {
  const target = aclTarget(kind, value);
  const privileges = target.column === null ? "ALL PRIVILEGES" : `ALL PRIVILEGES (${target.column})`;
  return `REVOKE ${privileges} ON ${target.object} FROM ${roleSpecification(grantee)};`;
}

function grantStatement(kind, value, privilege) {
  if (privilege.grantor !== value.owner) reject("CLUSTER_RESTORE_ACL_GRANTOR_UNSUPPORTED");
  const target = aclTarget(kind, value);
  const privilegeSql = target.column === null
    ? privilege.privilege_type
    : `${privilege.privilege_type} (${target.column})`;
  return `GRANT ${privilegeSql} ON ${target.object} TO ${roleSpecification(privilege.grantee)}${privilege.is_grantable ? " WITH GRANT OPTION" : ""};`;
}

function aclStatements(kind, value, policy) {
  if (value.acl_state === "NULL") return [];
  const lines = policy.acl.allowed_grantees.map((grantee) => revokeStatement(kind, value, grantee));
  for (const privilege of value.explicit_privileges) lines.push(grantStatement(kind, value, privilege));
  return lines;
}

function defaultPrivilegePrefix(value) {
  const schema = value.schema === null ? "" : ` IN SCHEMA ${quotePostgresIdentifier(value.schema)}`;
  if (value.object_kind === "SCHEMA" && value.schema !== null) reject("CLUSTER_RESTORE_DEFAULT_SCHEMA_SCOPE_INVALID");
  return `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotePostgresIdentifier(value.owner)}${schema}`;
}

function defaultPrivilegePlural(kind) {
  const names = { TABLE: "TABLES", SEQUENCE: "SEQUENCES", ROUTINE: "ROUTINES", TYPE: "TYPES", SCHEMA: "SCHEMAS" };
  if (!names[kind]) reject("CLUSTER_RESTORE_DEFAULT_PRIVILEGE_KIND_UNSUPPORTED");
  return names[kind];
}

function defaultPrivilegeStatements(value, policy) {
  if (value.acl_state === "NULL") reject("CLUSTER_RESTORE_DEFAULT_PRIVILEGE_STATE_UNSUPPORTED");
  const prefix = defaultPrivilegePrefix(value), plural = defaultPrivilegePlural(value.object_kind);
  const lines = policy.acl.allowed_grantees.map((grantee) => `${prefix} REVOKE ALL PRIVILEGES ON ${plural} FROM ${roleSpecification(grantee)};`);
  for (const privilege of value.explicit_privileges) {
    if (privilege.grantor !== value.owner) reject("CLUSTER_RESTORE_ACL_GRANTOR_UNSUPPORTED");
    lines.push(`${prefix} GRANT ${privilege.privilege_type} ON ${plural} TO ${roleSpecification(privilege.grantee)}${privilege.is_grantable ? " WITH GRANT OPTION" : ""};`);
  }
  return lines;
}

function containmentAssertions(snapshot) {
  const roleLiterals = snapshot.catalog.roles.map((role) => quotePostgresLiteral(role.name)).join(", ");
  const database = quotePostgresLiteral(snapshot.catalog.database.name);
  return [
    `SELECT 1 / CASE WHEN count(*) = ${snapshot.catalog.roles.length} AND bool_and(NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls) THEN 1 ELSE 0 END FROM pg_roles WHERE rolname IN (${roleLiterals});`,
    `SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname = ${database} AND datconnlimit = 0) THEN 1 ELSE 0 END;`,
  ];
}

function securitySql(snapshot, policy) {
  const lines = ["BEGIN;", "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';", ...containmentAssertions(snapshot)];
  lines.push(...aclStatements("DATABASE", snapshot.catalog.database, policy));
  for (const tablespace of snapshot.catalog.tablespaces) lines.push(...aclStatements("TABLESPACE", tablespace, policy));
  for (const objectValue of snapshot.catalog.objects) {
    if (objectValue.kind === "INDEX_PLACEMENT" || objectValue.kind === "PARTITIONED_INDEX_PLACEMENT") continue;
    lines.push(...aclStatements(objectValue.kind, objectValue, policy));
  }
  for (const defaultPrivilege of snapshot.catalog.default_privileges) lines.push(...defaultPrivilegeStatements(defaultPrivilege, policy));
  for (const membership of snapshot.catalog.memberships) {
    lines.push(`GRANT ${quotePostgresIdentifier(membership.role)} TO ${quotePostgresIdentifier(membership.member)} WITH ADMIN ${membership.admin_option ? "TRUE" : "FALSE"}, INHERIT ${membership.inherit_option ? "TRUE" : "FALSE"}, SET ${membership.set_option ? "TRUE" : "FALSE"} GRANTED BY CURRENT_USER;`);
  }
  for (const setting of snapshot.catalog.settings) {
    const role = setting.role_scope === "ALL" ? "ALL" : quotePostgresIdentifier(setting.role_scope);
    const database = setting.database_scope === "DATABASE" ? ` IN DATABASE ${quotePostgresIdentifier(snapshot.catalog.database.name)}` : "";
    lines.push(`ALTER ROLE ${role}${database} SET ${quotePostgresIdentifier(setting.key)} TO ${quotePostgresLiteral(setting.value)};`);
  }
  lines.push("COMMIT;");
  return sqlDocument(lines);
}

function activationSql(snapshot) {
  const lines = ["BEGIN;", "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '60s';", ...containmentAssertions(snapshot)];
  for (const role of snapshot.catalog.roles) {
    lines.push(`ALTER ROLE ${quotePostgresIdentifier(role.name)} ${role.can_login ? "LOGIN" : "NOLOGIN"};`);
  }
  lines.push(`ALTER DATABASE ${quotePostgresIdentifier(snapshot.catalog.database.name)} ALLOW_CONNECTIONS ${snapshot.catalog.database.allow_connect ? "true" : "false"};`);
  lines.push(`ALTER DATABASE ${quotePostgresIdentifier(snapshot.catalog.database.name)} CONNECTION LIMIT ${snapshot.catalog.database.connection_limit};`);
  lines.push("COMMIT;");
  return sqlDocument(lines);
}

function quarantineSql(snapshot) {
  const lines = ["BEGIN;", `ALTER DATABASE ${quotePostgresIdentifier(snapshot.catalog.database.name)} CONNECTION LIMIT 0;`];
  for (const role of snapshot.catalog.roles) lines.push(`ALTER ROLE ${quotePostgresIdentifier(role.name)} NOLOGIN;`);
  lines.push("COMMIT;");
  return sqlDocument(lines);
}

function buildPlanBody({ snapshot, policy, tablespaceMap, databaseProfile }) {
  const roles = snapshot.catalog.roles.map((role) => ({
    name: role.name,
    purpose: role.purpose,
    ...recoveryResource({ kind: "ROLE", snapshot, policy, discriminator: { name: role.name, purpose: role.purpose } }),
  }));
  const roleSql = roleSkeletonSql(snapshot, roles);
  const tableSpaces = snapshot.catalog.tablespaces.map((tablespace, index) => {
    const entry = tablespaceMap.entries[index];
    const resource = recoveryResource({
      kind: "TABLESPACE",
      snapshot,
      policy,
      discriminator: {
        name: tablespace.name,
        source_location_sha256: tablespace.source_location_sha256,
        target_server_path_sha256: clusterSha256(entry.server_path),
        tablespace_map_sha256: clusterSha256(tablespaceMap),
      },
    });
    const sql = tablespaceSql(tablespace, entry, resource.recovery_marker);
    return {
      name: tablespace.name,
      source_location_sha256: tablespace.source_location_sha256,
      target_server_path_sha256: clusterSha256(entry.server_path),
      ...resource,
      transactional: false,
      sql,
      sql_sha256: clusterSha256(sql),
    };
  });
  const databaseResource = recoveryResource({
    kind: "DATABASE",
    snapshot,
    policy,
    discriminator: {
      name: snapshot.catalog.database.name,
      database_profile_sha256: clusterSha256(databaseProfile),
      default_tablespace: snapshot.catalog.database.default_tablespace,
    },
  });
  const createDatabase = databaseSql(snapshot, databaseProfile, databaseResource.recovery_marker);
  const applySecurity = securitySql(snapshot, policy);
  const activate = activationSql(snapshot);
  const quarantine = quarantineSql(snapshot);
  return {
    schema_version: 1,
    contract: CLUSTER_RESTORE_PLAN_CONTRACT,
    classification: PLAN_CLASSIFICATION,
    backup_id: snapshot.binding.backup_id,
    snapshot_sha256: snapshot.snapshot_sha256,
    source_catalog_sha256: snapshot.catalog_sha256,
    policy_id: policy.policy_id,
    policy_sha256: clusterPolicySha256(policy),
    tablespace_map_sha256: clusterSha256(tablespaceMap),
    database_profile_sha256: clusterSha256(databaseProfile),
    restore_role: policy.identities.migration_owner,
    roles,
    role_skeleton: { transactional: true, ...sqlArtifact(roleSql) },
    tablespaces: tableSpaces,
    database: { name: snapshot.catalog.database.name, ...databaseResource, transactional: false, ...sqlArtifact(createDatabase) },
    data_restore: { role: policy.identities.migration_owner, required_arguments: [...DATA_RESTORE_ARGUMENTS] },
    security: { transactional: true, ...sqlArtifact(applySecurity) },
    credential_binding: { transport: "PSQL_META_PASSWORD_STDIN", role_set_sha256: clusterSha256(policy.credential_binding.login_roles), role_count: policy.credential_binding.login_roles.length },
    activation: { transactional: true, ...sqlArtifact(activate) },
    quarantine: { transactional: true, ...sqlArtifact(quarantine) },
  };
}

function validateSqlArtifact(value, code, transactional) {
  exactKeys(value, ["transactional", "sql", "sql_sha256"], code);
  if (value.transactional !== transactional || typeof value.sql !== "string" || !value.sql.endsWith("\n") || value.sql.includes("\r")
    || value.sql_sha256 !== clusterSha256(value.sql)) reject(code);
}

function validateRecoveryResource(value, kind, code) {
  if (typeof value.resource_identity_sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.resource_identity_sha256)
    || value.recovery_marker !== `${RECOVERY_MARKER_PREFIX}:${kind}:${value.resource_identity_sha256}`) reject(code);
}

export function validateClusterRestorePlan(plan, { snapshot: snapshotInput, policy: policyInput, tablespaceMap: mapInput, databaseProfile: profileInput } = {}) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  const tablespaceMap = validateTablespaceMapDocument({ map: mapInput, snapshot, policy, evidenceScope: mapInput?.evidence_scope });
  const databaseProfile = validateDatabaseProfile(profileInput, policy);
  exactKeys(plan, [
    "schema_version", "contract", "classification", "backup_id", "snapshot_sha256", "source_catalog_sha256", "policy_id", "policy_sha256",
    "tablespace_map_sha256", "database_profile_sha256", "restore_role", "roles", "role_skeleton", "tablespaces", "database", "data_restore",
    "security", "credential_binding", "activation", "quarantine", "plan_sha256",
  ], "CLUSTER_RESTORE_PLAN_INVALID");
  if (plan.schema_version !== 1 || plan.contract !== CLUSTER_RESTORE_PLAN_CONTRACT || plan.classification !== PLAN_CLASSIFICATION
    || plan.backup_id !== snapshot.binding.backup_id || plan.snapshot_sha256 !== snapshot.snapshot_sha256
    || plan.source_catalog_sha256 !== snapshot.catalog_sha256 || plan.policy_id !== policy.policy_id
    || plan.policy_sha256 !== clusterPolicySha256(policy) || plan.tablespace_map_sha256 !== clusterSha256(tablespaceMap)
    || plan.database_profile_sha256 !== clusterSha256(databaseProfile) || plan.restore_role !== policy.identities.migration_owner) reject("CLUSTER_RESTORE_PLAN_BINDING_MISMATCH");
  if (!Array.isArray(plan.roles) || plan.roles.length !== snapshot.catalog.roles.length) reject("CLUSTER_RESTORE_ROLE_PLAN_INVALID");
  for (const [index, value] of plan.roles.entries()) {
    exactKeys(value, ["name", "purpose", "resource_identity_sha256", "recovery_marker"], "CLUSTER_RESTORE_ROLE_PLAN_INVALID");
    if (value.name !== snapshot.catalog.roles[index].name || value.purpose !== snapshot.catalog.roles[index].purpose) reject("CLUSTER_RESTORE_ROLE_PLAN_INVALID");
    validateRecoveryResource(value, "ROLE", "CLUSTER_RESTORE_ROLE_PLAN_INVALID");
  }
  validateSqlArtifact(plan.role_skeleton, "CLUSTER_RESTORE_ROLE_PLAN_INVALID", true);
  if (!Array.isArray(plan.tablespaces) || plan.tablespaces.length !== snapshot.catalog.tablespaces.length) reject("CLUSTER_RESTORE_TABLESPACE_PLAN_INVALID");
  for (const [index, value] of plan.tablespaces.entries()) {
    exactKeys(value, ["name", "source_location_sha256", "target_server_path_sha256", "resource_identity_sha256", "recovery_marker", "transactional", "sql", "sql_sha256"], "CLUSTER_RESTORE_TABLESPACE_PLAN_INVALID");
    if (value.name !== snapshot.catalog.tablespaces[index].name || value.source_location_sha256 !== snapshot.catalog.tablespaces[index].source_location_sha256
      || value.target_server_path_sha256 !== clusterSha256(tablespaceMap.entries[index].server_path)) reject("CLUSTER_RESTORE_TABLESPACE_PLAN_INVALID");
    validateRecoveryResource(value, "TABLESPACE", "CLUSTER_RESTORE_TABLESPACE_PLAN_INVALID");
    validateSqlArtifact({ transactional: value.transactional, sql: value.sql, sql_sha256: value.sql_sha256 }, "CLUSTER_RESTORE_TABLESPACE_PLAN_INVALID", false);
  }
  exactKeys(plan.database, ["name", "resource_identity_sha256", "recovery_marker", "transactional", "sql", "sql_sha256"], "CLUSTER_RESTORE_DATABASE_PLAN_INVALID");
  if (plan.database.name !== snapshot.catalog.database.name) reject("CLUSTER_RESTORE_DATABASE_PLAN_INVALID");
  validateRecoveryResource(plan.database, "DATABASE", "CLUSTER_RESTORE_DATABASE_PLAN_INVALID");
  validateSqlArtifact({ transactional: plan.database.transactional, sql: plan.database.sql, sql_sha256: plan.database.sql_sha256 }, "CLUSTER_RESTORE_DATABASE_PLAN_INVALID", false);
  exactKeys(plan.data_restore, ["role", "required_arguments"], "CLUSTER_RESTORE_DATA_PLAN_INVALID");
  if (plan.data_restore.role !== policy.identities.migration_owner || canonicalClusterJson(plan.data_restore.required_arguments) !== canonicalClusterJson(DATA_RESTORE_ARGUMENTS)) reject("CLUSTER_RESTORE_DATA_PLAN_INVALID");
  validateSqlArtifact(plan.security, "CLUSTER_RESTORE_SECURITY_PLAN_INVALID", true);
  validateSqlArtifact(plan.activation, "CLUSTER_RESTORE_ACTIVATION_PLAN_INVALID", true);
  validateSqlArtifact(plan.quarantine, "CLUSTER_RESTORE_QUARANTINE_PLAN_INVALID", true);
  exactKeys(plan.credential_binding, ["transport", "role_set_sha256", "role_count"], "CLUSTER_RESTORE_CREDENTIAL_PLAN_INVALID");
  if (plan.credential_binding.transport !== "PSQL_META_PASSWORD_STDIN"
    || plan.credential_binding.role_set_sha256 !== clusterSha256(policy.credential_binding.login_roles)
    || plan.credential_binding.role_count !== policy.credential_binding.login_roles.length) reject("CLUSTER_RESTORE_CREDENTIAL_PLAN_INVALID");
  if (/\bPASSWORD\b/iu.test(`${plan.security.sql}\n${plan.activation.sql}\n${plan.quarantine.sql}`)
    || !/\bPASSWORD NULL\b/u.test(plan.role_skeleton.sql)) reject("CLUSTER_RESTORE_SECRET_BOUNDARY_INVALID");
  const body = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "plan_sha256"));
  if (plan.plan_sha256 !== clusterSha256(body)) reject("CLUSTER_RESTORE_PLAN_SHA256_MISMATCH");
  const expected = buildPlanBody({ snapshot, policy, tablespaceMap, databaseProfile });
  if (canonicalClusterJson(body) !== canonicalClusterJson(expected)) reject("CLUSTER_RESTORE_PLAN_DERIVATION_MISMATCH");
  return plan;
}

export function createClusterRestorePlan({ snapshot: snapshotInput, policy: policyInput, tablespaceMap: mapInput, databaseProfile: profileInput }) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  const tablespaceMap = validateTablespaceMapDocument({ map: mapInput, snapshot, policy, evidenceScope: mapInput?.evidence_scope });
  const databaseProfile = validateDatabaseProfile(profileInput, policy);
  const body = buildPlanBody({ snapshot, policy, tablespaceMap, databaseProfile });
  const plan = { ...body, plan_sha256: clusterSha256(body) };
  return validateClusterRestorePlan(plan, { snapshot, policy, tablespaceMap, databaseProfile });
}

function validatePsqlInvocation(psqlPath, psqlArguments, connectionEnvironment) {
  if (typeof psqlPath !== "string" || !path.isAbsolute(psqlPath) || /[\u0000\r\n]/u.test(psqlPath)) reject("CLUSTER_CREDENTIAL_PSQL_PATH_INVALID");
  if (!Array.isArray(psqlArguments) || psqlArguments.length > 64) reject("CLUSTER_CREDENTIAL_PSQL_ARGUMENT_INVALID");
  for (const argument of psqlArguments) {
    if (typeof argument !== "string" || Buffer.byteLength(argument, "utf8") > 4096 || /[\u0000\r\n]/u.test(argument)
      || /(?:password\s*=|pgpassword|postgres(?:ql)?:\/\/)/iu.test(argument)) reject("CLUSTER_CREDENTIAL_PSQL_ARGUMENT_INVALID");
  }
  record(connectionEnvironment, "CLUSTER_CREDENTIAL_PSQL_ENVIRONMENT_INVALID");
  for (const [key, value] of Object.entries(connectionEnvironment)) {
    if (!SAFE_CONNECTION_ENVIRONMENT.has(key) || typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4096
      || /[\u0000\r\n]/u.test(value)) reject("CLUSTER_CREDENTIAL_PSQL_ENVIRONMENT_INVALID");
  }
}

async function writeSecretInput(child, input) {
  return new Promise((resolve, rejectWrite) => {
    child.stdin.end(input, (error) => error ? rejectWrite(error) : resolve());
  });
}

async function waitForChild(child) {
  return new Promise((resolve, rejectSpawn) => {
    child.once("error", rejectSpawn);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function bindClusterCredentialsWithPsql({
  binding,
  policy: policyInput,
  psqlPath,
  psqlArguments = [],
  connectionEnvironment = {},
}) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  validatePsqlInvocation(psqlPath, psqlArguments, connectionEnvironment);
  await assertCredentialBindingUnchanged(binding);
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    PGPASSFILE: "/dev/null",
    PGSSLKEY: "/dev/null",
    PGSSLCERT: "/dev/null",
    ...connectionEnvironment,
  };
  const argumentsList = ["-X", "--no-password", "--quiet", "--set", "ON_ERROR_STOP=on", "--set", "VERBOSITY=terse", ...psqlArguments];
  for (const role of policy.credential_binding.login_roles) {
    const password = credentialPassword(binding, role);
    const publicInvocation = canonicalClusterJson({ psqlPath, argumentsList, environment });
    if (publicInvocation.includes(password)) reject("CLUSTER_CREDENTIAL_SECRET_PUBLICATION_FORBIDDEN");
    const input = Buffer.from(`\\set ON_ERROR_STOP on\n\\set VERBOSITY terse\n\\password ${quotePostgresIdentifier(role)}\n${password}\n${password}\n\\quit\n`, "utf8");
    const child = spawn(psqlPath, argumentsList, { env: environment, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    const exitPromise = waitForChild(child);
    let result;
    try {
      await writeSecretInput(child, input);
      result = await exitPromise;
    } catch {
      await exitPromise.catch(() => {});
      reject("CLUSTER_CREDENTIAL_PSQL_FAILED");
    } finally {
      input.fill(0);
    }
    if (result.code !== 0 || result.signal !== null) reject("CLUSTER_CREDENTIAL_PSQL_FAILED");
    await assertCredentialBindingUnchanged(binding);
  }
  return Object.freeze({
    roleCount: policy.credential_binding.login_roles.length,
    roleSetSha256: clusterSha256(policy.credential_binding.login_roles),
    transport: "PSQL_META_PASSWORD_STDIN",
  });
}
