import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import {
  RUNTIME_PRIVILEGE_CATALOG_REPORT_CONTRACT,
  RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT,
  RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH,
  validateRuntimePrivilegeCompiledCatalog,
  verifyRuntimePrivilegeCompiledCatalogSources,
} from "./postgresql-runtime-privilege-catalog.mjs";
import {
  RUNTIME_PRIVILEGE_ACCESS_CONTRACT,
  RUNTIME_PRIVILEGE_ACCESS_PATH,
  createRuntimePrivilegeAccessDocument,
  validateRuntimePrivilegeAccessDocument,
} from "./postgresql-runtime-privilege-source.mjs";

export const RUNTIME_PRIVILEGE_POLICY_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-policy/v2";
export const RUNTIME_PRIVILEGE_POLICY_PATH = "operations/postgresql-runtime-privilege-policy-v2.json";
export const RUNTIME_PRIVILEGE_POLICY_COMPILER_PATHS = Object.freeze([
  "scripts/postgresql-runtime-privilege-policy.mjs",
  "scripts/postgresql-runtime-privilege-reconciler.mjs",
  "scripts/postgresql-runtime-privilege-state.sql",
]);

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_POLICY_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const SERVICES = Object.freeze(["ADMIN", "BACKUP", "MIGRATION", "WEB", "WORKER"]);
const ACCESS_SERVICES = Object.freeze(["ADMIN", "BACKUP", "WEB", "WORKER"]);
const OWNER = "chenyida_erp_owner";
const DATABASE = "chenyida_erp";
const ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({ name: "chenyida_erp_admin", purpose: "ADMIN_LOGIN", intended_login: true, inherit: true, connection_limit: 1 }),
  Object.freeze({ name: "chenyida_erp_admin_priv", purpose: "ADMIN_PRIVILEGE_GROUP", intended_login: false, inherit: true, connection_limit: -1 }),
  Object.freeze({ name: "chenyida_erp_backup", purpose: "BACKUP_LOGIN", intended_login: true, inherit: true, connection_limit: 2 }),
  Object.freeze({ name: "chenyida_erp_backup_priv", purpose: "BACKUP_PRIVILEGE_GROUP", intended_login: false, inherit: true, connection_limit: -1 }),
  Object.freeze({ name: OWNER, purpose: "MIGRATION_OWNER", intended_login: true, inherit: false, connection_limit: 1 }),
  Object.freeze({ name: "chenyida_erp_web", purpose: "WEB_LOGIN", intended_login: true, inherit: true, connection_limit: 12 }),
  Object.freeze({ name: "chenyida_erp_web_priv", purpose: "WEB_PRIVILEGE_GROUP", intended_login: false, inherit: true, connection_limit: -1 }),
  Object.freeze({ name: "chenyida_erp_worker", purpose: "WORKER_LOGIN", intended_login: true, inherit: true, connection_limit: 6 }),
  Object.freeze({ name: "chenyida_erp_worker_priv", purpose: "WORKER_PRIVILEGE_GROUP", intended_login: false, inherit: true, connection_limit: -1 }),
]);
const SERVICE_IDENTITIES = Object.freeze({
  ADMIN: Object.freeze({ login: "chenyida_erp_admin", privilege_group: "chenyida_erp_admin_priv", pool_max: 1 }),
  BACKUP: Object.freeze({ login: "chenyida_erp_backup", privilege_group: "chenyida_erp_backup_priv", pool_max: 1 }),
  MIGRATION: Object.freeze({ login: OWNER, privilege_group: null, pool_max: 1 }),
  WEB: Object.freeze({ login: "chenyida_erp_web", privilege_group: "chenyida_erp_web_priv", pool_max: 10 }),
  WORKER: Object.freeze({ login: "chenyida_erp_worker", privilege_group: "chenyida_erp_worker_priv", pool_max: 4 }),
});
const MEMBERSHIPS = Object.freeze(ACCESS_SERVICES.map((service) => Object.freeze({
  role: SERVICE_IDENTITIES[service].privilege_group,
  member: SERVICE_IDENTITIES[service].login,
  grantor: "PLATFORM_OWNER",
  admin_option: false,
  inherit_option: true,
  set_option: false,
})).sort((left, right) => Buffer.compare(Buffer.from(left.role), Buffer.from(right.role))));
const DEFAULT_PRIVILEGES = Object.freeze([
  Object.freeze({ owner: OWNER, scope: "SCHEMA", schema: "public", object_kind: "SEQUENCE", owner_privileges: Object.freeze(["SELECT", "UPDATE", "USAGE"]), public_privileges: Object.freeze([]), privilege_group_privileges: Object.freeze([]), materialized_row_required: false }),
  Object.freeze({ owner: OWNER, scope: "SCHEMA", schema: "public", object_kind: "TABLE", owner_privileges: Object.freeze(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]), public_privileges: Object.freeze([]), privilege_group_privileges: Object.freeze([]), materialized_row_required: false }),
  Object.freeze({ owner: OWNER, scope: "GLOBAL", schema: null, object_kind: "ROUTINE", owner_privileges: Object.freeze(["EXECUTE"]), public_privileges: Object.freeze([]), privilege_group_privileges: Object.freeze([]), materialized_row_required: true }),
  Object.freeze({ owner: OWNER, scope: "GLOBAL", schema: null, object_kind: "TYPE", owner_privileges: Object.freeze(["USAGE"]), public_privileges: Object.freeze([]), privilege_group_privileges: Object.freeze([]), materialized_row_required: true }),
]);
const EXPECTED_ACL_SUMMARY = Object.freeze({
  tuple_counts: Object.freeze({ database: 4, schema: 4, table: 813, sequence: 411, routine: 29, type: 0, tablespace: 0, large_object: 0, total: 1261 }),
  table_by_service: Object.freeze({ ADMIN: 11, BACKUP: 234, WEB: 487, WORKER: 81 }),
  sequence_by_service: Object.freeze({ ADMIN: 4, BACKUP: 211, WEB: 173, WORKER: 23 }),
  routine_by_service: Object.freeze({ ADMIN: 0, BACKUP: 1, WEB: 28, WORKER: 0 }),
  object_coverage: Object.freeze({ table: 234, sequence: 211, routine: 28 }),
});

export class RuntimePrivilegePolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegePolicyError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegePolicyError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function exact(left, right, code) {
  if (canonicalClusterJson(left) !== canonicalClusterJson(right)) reject(code);
}

function string(value, code, pattern = null) {
  if (typeof value !== "string" || !value || value !== value.normalize("NFC") || value.includes("\u0000") || (pattern && !pattern.test(value))) reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function validateCanonicalValue(value, currentPath = "ROOT") {
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0))) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateCanonicalValue(item, `${currentPath}_${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateCanonicalValue(item, `${currentPath}_${key}`);
    return;
  }
  reject(`RUNTIME_PRIVILEGE_POLICY_CANONICAL_VALUE_INVALID_${currentPath}`);
}

function sha256(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

async function readStrictFile(file, maximumBytes, code) {
  const before = await lstat(file).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > maximumBytes || (before.mode & 0o022) !== 0) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) reject(code);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) reject(code);
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) reject(code);
    return raw;
  } finally {
    await handle.close();
  }
}

function rolePolicy() {
  return ROLE_DEFINITIONS.map((role) => Object.freeze({
    ...role,
    superuser: false,
    create_role: false,
    create_database: false,
    replication: false,
    bypass_rls: false,
    valid_until: null,
  }));
}

function privilegeSet(service) {
  return Object.freeze({
    table_privileges: service.table_privileges,
    column_privileges: service.column_privileges,
    sequence_privileges: service.sequence_privileges,
    routine_execute: service.routine_execute,
    type_usage: Object.freeze([]),
    large_objects: Object.freeze([]),
    tablespaces: Object.freeze([]),
  });
}

function migrationPrivilegeSet() {
  return Object.freeze({
    database_owner: true,
    schema_owner_via_pg_database_owner: true,
    ddl_allowed: true,
    schema_migrations_write: true,
    object_privileges: "OWNER_IMPLICIT_ONLY",
  });
}

function privilegeSetSha256(serviceName, privileges) {
  try { return clusterSha256(privileges); }
  catch { reject(`RUNTIME_PRIVILEGE_POLICY_${serviceName}_PRIVILEGE_SET_INVALID`); }
}

function serviceBindings(access) {
  return Object.fromEntries(SERVICES.map((serviceName) => {
    const identity = SERVICE_IDENTITIES[serviceName];
    const role = ROLE_DEFINITIONS.find((item) => item.name === identity.login);
    const isMigration = serviceName === "MIGRATION";
    const privileges = isMigration ? migrationPrivilegeSet() : privilegeSet(access.services[serviceName]);
    return [serviceName, Object.freeze({
      access_service: isMigration ? null : serviceName,
      login: identity.login,
      privilege_group: identity.privilege_group,
      pool_max: identity.pool_max,
      role_connection_limit: role.connection_limit,
      database_privileges: isMigration ? Object.freeze(["CONNECT", "CREATE", "TEMPORARY"]) : Object.freeze(["CONNECT"]),
      schema_privileges: isMigration ? Object.freeze(["CREATE", "USAGE"]) : Object.freeze(["USAGE"]),
      temporary: isMigration,
      direct_login_acl: false,
      database_owner: isMigration,
      schema_owner_via_pg_database_owner: isMigration,
      ddl_allowed: isMigration,
      schema_migrations_write: isMigration,
      privilege_set_sha256: privilegeSetSha256(serviceName, privileges),
    })];
  }));
}

export function createRuntimePrivilegeServiceBindings(access) {
  return serviceBindings(validateRuntimePrivilegeAccessDocument(access));
}

function identities() {
  return Object.freeze({
    migration_owner: OWNER,
    platform_owner: "PLATFORM_OWNER",
    privilege_reconciler: "PLATFORM_OWNER",
    admin_login: SERVICE_IDENTITIES.ADMIN.login,
    admin_privilege_group: SERVICE_IDENTITIES.ADMIN.privilege_group,
    backup_login: SERVICE_IDENTITIES.BACKUP.login,
    backup_privilege_group: SERVICE_IDENTITIES.BACKUP.privilege_group,
    web_login: SERVICE_IDENTITIES.WEB.login,
    web_privilege_group: SERVICE_IDENTITIES.WEB.privilege_group,
    worker_login: SERVICE_IDENTITIES.WORKER.login,
    worker_privilege_group: SERVICE_IDENTITIES.WORKER.privilege_group,
    backup_control: "BACKUP_CONTROL",
    restore_bootstrap: "RESTORE_BOOTSTRAP",
    unauthorized_probe: "UNAUTHORIZED_PROBE",
  });
}

function resolutionEvidence(access, catalog) {
  const blockingCodes = access.blocking_reasons.map((item) => item.code);
  exact(blockingCodes, catalog.resolves, "RUNTIME_PRIVILEGE_POLICY_RESOLUTION_INVALID");
  return Object.freeze(catalog.resolves.map((code) => Object.freeze({
    code,
    evidence_contract: catalog.contract,
    evidence_catalog_sha256: catalog.catalog_sha256,
    evidence_artifact_sha256: catalog.artifact_sha256,
  })));
}

function countPrivileges(privileges) {
  return Object.values(privileges).reduce((total, objects) => total + objects.length, 0);
}

function aclSummary(access) {
  const tableByService = Object.fromEntries(ACCESS_SERVICES.map((service) => [service, countPrivileges(access.services[service].table_privileges)]));
  const sequenceByService = Object.fromEntries(ACCESS_SERVICES.map((service) => [service, countPrivileges(access.services[service].sequence_privileges)]));
  const routineByService = Object.fromEntries(ACCESS_SERVICES.map((service) => [service,
    access.services[service].routine_execute.APPLICATION.length + access.services[service].routine_execute.EXTENSION.length]));
  const table = Object.values(tableByService).reduce((total, count) => total + count, 0);
  const sequence = Object.values(sequenceByService).reduce((total, count) => total + count, 0);
  const routine = Object.values(routineByService).reduce((total, count) => total + count, 0);
  const summary = Object.freeze({
    tuple_counts: Object.freeze({
      database: 4,
      schema: 4,
      table,
      sequence,
      routine,
      type: 0,
      tablespace: 0,
      large_object: 0,
      total: 8 + table + sequence + routine,
    }),
    table_by_service: Object.freeze(tableByService),
    sequence_by_service: Object.freeze(sequenceByService),
    routine_by_service: Object.freeze(routineByService),
    object_coverage: Object.freeze({ table: access.catalog.tables.length, sequence: access.catalog.sequences.length, routine: 28 }),
  });
  exact(summary, EXPECTED_ACL_SUMMARY, "RUNTIME_PRIVILEGE_POLICY_ACL_SOURCE_COUNT_MISMATCH");
  return summary;
}

function objectConstraints(catalog) {
  return Object.freeze({
    managed_role_prefix: "chenyida_erp_",
    forbidden_managed_role_suffixes: Object.freeze(["_acl"]),
    unknown_managed_roles: "FAIL_CLOSED",
    unknown_acl_endpoints: "FAIL_CLOSED",
    unknown_memberships: "FAIL_CLOSED",
    grant_option_allowed: false,
    direct_login_acl_allowed: false,
    public_object_privileges: Object.freeze([]),
    column_acl_count: 0,
    large_object_count: 0,
    custom_tablespace_count: 0,
    table_count: catalog.catalog.tables.length,
    sequence_count: catalog.catalog.sequences.length,
    routine_count: catalog.catalog.routines.length,
    standalone_type_count: catalog.catalog.standalone_types.length,
    structural_surfaces: catalog.catalog.structural_surfaces,
    structural_report_contract: RUNTIME_PRIVILEGE_CATALOG_REPORT_CONTRACT,
  });
}

function validateRole(value, expected) {
  exactKeys(value, ["name", "purpose", "intended_login", "inherit", "connection_limit", "superuser", "create_role", "create_database", "replication", "bypass_rls", "valid_until"], "RUNTIME_PRIVILEGE_POLICY_ROLE_INVALID");
  exact(value, expected, "RUNTIME_PRIVILEGE_POLICY_ROLE_INVALID");
}

function validateServiceBinding(value, expected) {
  exactKeys(value, ["access_service", "login", "privilege_group", "pool_max", "role_connection_limit", "database_privileges", "schema_privileges", "temporary", "direct_login_acl", "database_owner", "schema_owner_via_pg_database_owner", "ddl_allowed", "schema_migrations_write", "privilege_set_sha256"], "RUNTIME_PRIVILEGE_POLICY_SERVICE_INVALID");
  exact(value, expected, "RUNTIME_PRIVILEGE_POLICY_SERVICE_INVALID");
}

function validateSourceBinding(value, access, catalog) {
  exactKeys(value, ["access_intent", "compiled_catalog", "migrations", "engine_binding", "compiler"], "RUNTIME_PRIVILEGE_POLICY_SOURCE_FIELDS_INVALID");
  exactKeys(value.access_intent, ["path", "contract", "access_sha256", "file_sha256"], "RUNTIME_PRIVILEGE_POLICY_ACCESS_SOURCE_INVALID");
  if (value.access_intent.path !== RUNTIME_PRIVILEGE_ACCESS_PATH || value.access_intent.contract !== RUNTIME_PRIVILEGE_ACCESS_CONTRACT || value.access_intent.access_sha256 !== access.access_sha256 || !SHA256.test(value.access_intent.file_sha256)) reject("RUNTIME_PRIVILEGE_POLICY_ACCESS_SOURCE_INVALID");
  exactKeys(value.compiled_catalog, ["path", "contract", "catalog_sha256", "artifact_sha256", "file_sha256"], "RUNTIME_PRIVILEGE_POLICY_CATALOG_SOURCE_INVALID");
  if (value.compiled_catalog.path !== RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH || value.compiled_catalog.contract !== RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT || value.compiled_catalog.catalog_sha256 !== catalog.catalog_sha256 || value.compiled_catalog.artifact_sha256 !== catalog.artifact_sha256 || !SHA256.test(value.compiled_catalog.file_sha256)) reject("RUNTIME_PRIVILEGE_POLICY_CATALOG_SOURCE_INVALID");
  exact(value.migrations, catalog.source_binding.migrations, "RUNTIME_PRIVILEGE_POLICY_MIGRATION_SOURCE_INVALID");
  exact(value.engine_binding, catalog.engine_binding, "RUNTIME_PRIVILEGE_POLICY_ENGINE_SOURCE_INVALID");
  if (!Array.isArray(value.compiler) || value.compiler.length !== RUNTIME_PRIVILEGE_POLICY_COMPILER_PATHS.length) reject("RUNTIME_PRIVILEGE_POLICY_COMPILER_SOURCE_INVALID");
  exact(value.compiler.map((item) => item.path), RUNTIME_PRIVILEGE_POLICY_COMPILER_PATHS, "RUNTIME_PRIVILEGE_POLICY_COMPILER_SOURCE_INVALID");
  for (const item of value.compiler) {
    exactKeys(item, ["path", "sha256"], "RUNTIME_PRIVILEGE_POLICY_COMPILER_SOURCE_INVALID");
    string(item.path, "RUNTIME_PRIVILEGE_POLICY_COMPILER_SOURCE_INVALID");
    string(item.sha256, "RUNTIME_PRIVILEGE_POLICY_COMPILER_SOURCE_INVALID", SHA256);
  }
}

export function validateRuntimePrivilegePolicy(value, { access, catalog } = {}) {
  let validatedAccess;
  let validatedCatalog;
  try {
    validatedAccess = validateRuntimePrivilegeAccessDocument(access);
    validatedCatalog = validateRuntimePrivilegeCompiledCatalog(catalog, { access: validatedAccess });
  } catch {
    reject("RUNTIME_PRIVILEGE_POLICY_SOURCE_INVALID");
  }
  exactKeys(value, ["schema_version", "contract", "policy_id", "artifact_class", "evidence_scope", "authorization_status", "deployment_authorized", "resolves", "source_binding", "database", "schema", "identities", "roles", "memberships", "service_bindings", "default_privileges", "extensions", "acl_summary", "object_constraints", "tablespaces", "policy_sha256"], "RUNTIME_PRIVILEGE_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RUNTIME_PRIVILEGE_POLICY_CONTRACT || value.policy_id !== "chenyida-erp-postgresql-runtime-privilege-v2" || value.artifact_class !== "EXACT_RUNTIME_ROLE_ACL_POLICY" || value.evidence_scope !== "SYNTHETIC_ISOLATED_ONLY" || value.authorization_status !== "ISOLATED_RECONCILIATION_ONLY" || value.deployment_authorized !== false) reject("RUNTIME_PRIVILEGE_POLICY_IDENTITY_INVALID");
  exact(value.resolves, resolutionEvidence(validatedAccess, validatedCatalog), "RUNTIME_PRIVILEGE_POLICY_RESOLUTION_INVALID");
  validateSourceBinding(value.source_binding, validatedAccess, validatedCatalog);
  exact(value.database, {
    name: DATABASE,
    owner: OWNER,
    allow_connect: true,
    connection_limit: 64,
    encoding: validatedCatalog.engine_binding.encoding,
    locale_provider: validatedCatalog.engine_binding.locale_provider,
    collate: validatedCatalog.engine_binding.collate,
    ctype: validatedCatalog.engine_binding.ctype,
    collation_version: validatedCatalog.engine_binding.collation_version,
    default_tablespace: "pg_default",
    public_privileges: [],
  }, "RUNTIME_PRIVILEGE_POLICY_DATABASE_INVALID");
  exact(value.schema, { name: "public", owner: "pg_database_owner", public_privileges: [] }, "RUNTIME_PRIVILEGE_POLICY_SCHEMA_INVALID");
  exact(value.identities, identities(), "RUNTIME_PRIVILEGE_POLICY_IDENTITIES_INVALID");
  const expectedRoles = rolePolicy();
  if (!Array.isArray(value.roles) || value.roles.length !== expectedRoles.length) reject("RUNTIME_PRIVILEGE_POLICY_ROLES_INVALID");
  value.roles.forEach((role, index) => validateRole(role, expectedRoles[index]));
  exact(value.memberships, MEMBERSHIPS, "RUNTIME_PRIVILEGE_POLICY_MEMBERSHIPS_INVALID");
  exactKeys(value.service_bindings, SERVICES, "RUNTIME_PRIVILEGE_POLICY_SERVICES_INVALID");
  const expectedBindings = serviceBindings(validatedAccess);
  for (const service of SERVICES) validateServiceBinding(value.service_bindings[service], expectedBindings[service]);
  exact(value.default_privileges, DEFAULT_PRIVILEGES, "RUNTIME_PRIVILEGE_POLICY_DEFAULT_PRIVILEGES_INVALID");
  exact(value.extensions, validatedCatalog.catalog.extensions, "RUNTIME_PRIVILEGE_POLICY_EXTENSIONS_INVALID");
  exact(value.acl_summary, aclSummary(validatedAccess), "RUNTIME_PRIVILEGE_POLICY_ACL_SUMMARY_INVALID");
  exact(value.object_constraints, objectConstraints(validatedCatalog), "RUNTIME_PRIVILEGE_POLICY_OBJECT_CONSTRAINTS_INVALID");
  exact(value.tablespaces, { built_in: ["pg_default", "pg_global"], custom: [], owner: "PLATFORM_OWNER", privileges: [] }, "RUNTIME_PRIVILEGE_POLICY_TABLESPACES_INVALID");
  string(value.policy_sha256, "RUNTIME_PRIVILEGE_POLICY_SHA256_INVALID", SHA256);
  const { policy_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.policy_sha256) reject("RUNTIME_PRIVILEGE_POLICY_SHA256_INVALID");
  return value;
}

async function loadSources(siteRoot) {
  const root = path.resolve(siteRoot);
  const accessRaw = await readStrictFile(path.join(root, RUNTIME_PRIVILEGE_ACCESS_PATH), MAX_POLICY_BYTES, "RUNTIME_PRIVILEGE_POLICY_ACCESS_FILE_INVALID");
  const catalogRaw = await readStrictFile(path.join(root, RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH), MAX_POLICY_BYTES, "RUNTIME_PRIVILEGE_POLICY_CATALOG_FILE_INVALID");
  let access;
  let catalog;
  try {
    access = validateRuntimePrivilegeAccessDocument(parseStrictJson(accessRaw.toString("utf8"), MAX_POLICY_BYTES));
    catalog = validateRuntimePrivilegeCompiledCatalog(parseStrictJson(catalogRaw.toString("utf8"), MAX_POLICY_BYTES), { access });
  } catch {
    reject("RUNTIME_PRIVILEGE_POLICY_SOURCE_INVALID");
  }
  const generatedAccess = await createRuntimePrivilegeAccessDocument({ siteRoot: root }).catch(() => reject("RUNTIME_PRIVILEGE_POLICY_ACCESS_SOURCE_INVALID"));
  exact(access, generatedAccess, "RUNTIME_PRIVILEGE_POLICY_ACCESS_SOURCE_STALE");
  await verifyRuntimePrivilegeCompiledCatalogSources(catalog, { siteRoot: root }).catch(() => reject("RUNTIME_PRIVILEGE_POLICY_CATALOG_SOURCE_STALE"));
  const compiler = [];
  for (const relative of RUNTIME_PRIVILEGE_POLICY_COMPILER_PATHS) {
    const raw = await readStrictFile(path.join(root, relative), MAX_POLICY_BYTES, "RUNTIME_PRIVILEGE_POLICY_COMPILER_FILE_INVALID");
    compiler.push({ path: relative, sha256: sha256(raw) });
  }
  return { root, access, accessRaw, catalog, catalogRaw, compiler };
}

export async function createRuntimePrivilegePolicy({ siteRoot = SITE_ROOT } = {}) {
  const { access, accessRaw, catalog, catalogRaw, compiler } = await loadSources(siteRoot);
  const body = {
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_POLICY_CONTRACT,
    policy_id: "chenyida-erp-postgresql-runtime-privilege-v2",
    artifact_class: "EXACT_RUNTIME_ROLE_ACL_POLICY",
    evidence_scope: "SYNTHETIC_ISOLATED_ONLY",
    authorization_status: "ISOLATED_RECONCILIATION_ONLY",
    deployment_authorized: false,
    resolves: resolutionEvidence(access, catalog),
    source_binding: {
      access_intent: { path: RUNTIME_PRIVILEGE_ACCESS_PATH, contract: access.contract, access_sha256: access.access_sha256, file_sha256: sha256(accessRaw) },
      compiled_catalog: { path: RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH, contract: catalog.contract, catalog_sha256: catalog.catalog_sha256, artifact_sha256: catalog.artifact_sha256, file_sha256: sha256(catalogRaw) },
      migrations: catalog.source_binding.migrations,
      engine_binding: catalog.engine_binding,
      compiler,
    },
    database: {
      name: DATABASE,
      owner: OWNER,
      allow_connect: true,
      connection_limit: 64,
      encoding: catalog.engine_binding.encoding,
      locale_provider: catalog.engine_binding.locale_provider,
      collate: catalog.engine_binding.collate,
      ctype: catalog.engine_binding.ctype,
      collation_version: catalog.engine_binding.collation_version,
      default_tablespace: "pg_default",
      public_privileges: [],
    },
    schema: { name: "public", owner: "pg_database_owner", public_privileges: [] },
    identities: identities(),
    roles: rolePolicy(),
    memberships: MEMBERSHIPS,
    service_bindings: serviceBindings(access),
    default_privileges: DEFAULT_PRIVILEGES,
    extensions: catalog.catalog.extensions,
    acl_summary: aclSummary(access),
    object_constraints: objectConstraints(catalog),
    tablespaces: { built_in: ["pg_default", "pg_global"], custom: [], owner: "PLATFORM_OWNER", privileges: [] },
  };
  validateCanonicalValue(body);
  return validateRuntimePrivilegePolicy({ ...body, policy_sha256: clusterSha256(body) }, { access, catalog });
}

export async function verifyRuntimePrivilegePolicySources(policy, { siteRoot = SITE_ROOT } = {}) {
  const expected = await createRuntimePrivilegePolicy({ siteRoot });
  exact(policy, expected, "RUNTIME_PRIVILEGE_POLICY_STALE");
  return expected;
}

export async function loadRuntimePrivilegePolicySources({ siteRoot = SITE_ROOT } = {}) {
  const sources = await loadSources(siteRoot);
  const policyRaw = await readStrictFile(path.join(path.resolve(siteRoot), RUNTIME_PRIVILEGE_POLICY_PATH), MAX_POLICY_BYTES, "RUNTIME_PRIVILEGE_POLICY_FILE_INVALID");
  let policy;
  try { policy = validateRuntimePrivilegePolicy(parseStrictJson(policyRaw.toString("utf8"), MAX_POLICY_BYTES), { access: sources.access, catalog: sources.catalog }); }
  catch { reject("RUNTIME_PRIVILEGE_POLICY_FILE_INVALID"); }
  const expected = await createRuntimePrivilegePolicy({ siteRoot });
  exact(policy, expected, "RUNTIME_PRIVILEGE_POLICY_STALE");
  return Object.freeze({ policy, access: sources.access, catalog: sources.catalog });
}

async function main(args) {
  if (args.length !== 1 || !["render", "verify"].includes(args[0])) {
    process.stderr.write("usage: postgresql-runtime-privilege-policy.mjs render|verify\n");
    process.exitCode = 2;
    return;
  }
  const expected = await createRuntimePrivilegePolicy();
  if (args[0] === "render") {
    process.stdout.write(`${JSON.stringify(expected, null, 2)}\n`);
    return;
  }
  const raw = await readFile(path.join(SITE_ROOT, RUNTIME_PRIVILEGE_POLICY_PATH), "utf8");
  if (raw !== `${JSON.stringify(expected, null, 2)}\n`) reject("RUNTIME_PRIVILEGE_POLICY_STALE");
  process.stdout.write(`RUNTIME_PRIVILEGE_POLICY_VERIFIED sha256=${expected.policy_sha256}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof RuntimePrivilegePolicyError ? error.code : "RUNTIME_PRIVILEGE_POLICY_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
