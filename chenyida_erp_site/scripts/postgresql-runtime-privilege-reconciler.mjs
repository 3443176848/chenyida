import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import {
  RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH,
  parseRuntimePrivilegeCatalogReport,
  validateRuntimePrivilegeCompiledCatalog,
} from "./postgresql-runtime-privilege-catalog.mjs";
import { createRuntimePrivilegePolicy, validateRuntimePrivilegePolicy } from "./postgresql-runtime-privilege-policy.mjs";
import {
  RUNTIME_PRIVILEGE_ACCESS_PATH,
  validateRuntimePrivilegeAccessDocument,
} from "./postgresql-runtime-privilege-source.mjs";

export const RUNTIME_PRIVILEGE_STATE_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-state/v2";
export const RUNTIME_PRIVILEGE_RECONCILIATION_PLAN_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-reconciliation-plan/v2";
export const RUNTIME_PRIVILEGE_RECONCILIATION_INTENT_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-reconciliation-intent/v2";

const MAX_STATE_BYTES = 4 * 1024 * 1024;
const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHA256 = /^[0-9a-f]{64}$/;
const OID = /^[1-9][0-9]{0,9}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const MANAGED_ROLE = /^chenyida_erp_[a-z0-9_]{1,50}$/;
const ACCESS_SERVICES = Object.freeze(["ADMIN", "BACKUP", "WEB", "WORKER"]);
const ROLE_STATE_FIELDS = Object.freeze(["name", "superuser", "inherit", "create_role", "create_database", "can_login", "replication", "connection_limit", "valid_until", "bypass_rls"]);
const ACL_FIELDS = Object.freeze(["kind", "identity", "owner", "grantor", "grantee", "privilege_type", "is_grantable"]);
const ACL_PRIVILEGES = Object.freeze({
  DATABASE: Object.freeze(["CONNECT", "CREATE", "TEMPORARY"]),
  SCHEMA: Object.freeze(["CREATE", "USAGE"]),
  TABLE: Object.freeze(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]),
  SEQUENCE: Object.freeze(["SELECT", "UPDATE", "USAGE"]),
  ROUTINE: Object.freeze(["EXECUTE"]),
  TYPE: Object.freeze(["USAGE"]),
  TABLESPACE: Object.freeze(["CREATE"]),
  LARGE_OBJECT: Object.freeze(["SELECT", "UPDATE"]),
});
const INTENT_STATES = Object.freeze(["INTENT_DURABLE", "TRANSACTION_DISPATCHED", "POSTCOMMIT_CAPTURED", "VERIFIED", "QUARANTINED"]);

export class RuntimePrivilegeReconcilerError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegeReconcilerError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegeReconcilerError(code);
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

function same(left, right) {
  return canonicalClusterJson(left) === canonicalClusterJson(right);
}

function text(value, code, pattern = null) {
  if (typeof value !== "string" || !value || value !== value.normalize("NFC") || value.includes("\u0000") || (pattern && !pattern.test(value))) reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function orderedUnique(records, identity, code) {
  if (!Array.isArray(records)) reject(code);
  let previous = null;
  for (const record of records) {
    const current = identity(record);
    if (typeof current !== "string" || (previous !== null && previous >= current)) reject(code);
    previous = current;
  }
  return records;
}

function compareC(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function normalizeRole(role) {
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

function aclKey(record) {
  return `${record.kind}\u0001${record.identity}\u0001${record.grantee}\u0001${record.privilege_type}\u0001${record.grantor}`;
}

function membershipKey(record) {
  return `${record.role}\u0001${record.member}\u0001${record.grantor}`;
}

function defaultScopeKey(record) {
  return `${record.owner}\u0001${record.schema}\u0001${record.object_kind}`;
}

function defaultPrivilegeKey(record) {
  return `${defaultScopeKey(record)}\u0001${record.grantee}\u0001${record.privilege_type}\u0001${record.grantor}`;
}

function storageKey(record) {
  return `${record.kind}\u0001${record.identity}`;
}

function expectedRoles(policy) {
  return policy.roles.map(normalizeRole).sort((left, right) => compareC(left.name, right.name));
}

function privilegeGroups(policy) {
  return ACCESS_SERVICES.map((service) => policy.service_bindings[service].privilege_group);
}

function loginRoles(policy) {
  return ACCESS_SERVICES.map((service) => policy.service_bindings[service].login);
}

function objectOwners(policy, catalog) {
  const result = new Map();
  result.set(`DATABASE\u0001${policy.database.name}`, policy.database.owner);
  result.set(`SCHEMA\u0001${policy.schema.name}`, policy.schema.owner);
  for (const item of catalog.catalog.tables) result.set(`TABLE\u0001public.${item.name}`, item.owner === "MIGRATION_OWNER" ? policy.identities.migration_owner : item.owner);
  for (const item of catalog.catalog.sequences) result.set(`SEQUENCE\u0001public.${item.name}`, item.owner === "MIGRATION_OWNER" ? policy.identities.migration_owner : item.owner);
  for (const item of catalog.catalog.routines) result.set(`ROUTINE\u0001${item.identity}`, item.owner === "MIGRATION_OWNER" ? policy.identities.migration_owner : item.owner);
  for (const item of catalog.catalog.standalone_types) result.set(`TYPE\u0001${item.identity}`, item.owner === "MIGRATION_OWNER" ? policy.identities.migration_owner : item.owner);
  for (const tablespace of policy.tablespaces.built_in) result.set(`TABLESPACE\u0001${tablespace}`, "PLATFORM_OWNER");
  return result;
}

function validateTarget(value) {
  exactKeys(value, ["database_oid", "system_identifier_sha256", "marker_sha256"], "RUNTIME_PRIVILEGE_STATE_TARGET_INVALID");
  text(value.database_oid, "RUNTIME_PRIVILEGE_STATE_TARGET_INVALID", OID);
  text(value.system_identifier_sha256, "RUNTIME_PRIVILEGE_STATE_TARGET_INVALID", SHA256);
  text(value.marker_sha256, "RUNTIME_PRIVILEGE_STATE_TARGET_INVALID", SHA256);
  return value;
}

function validateRoleRecords(records, policy, mode) {
  orderedUnique(records, (item) => item?.name, "RUNTIME_PRIVILEGE_STATE_ROLE_ORDER_INVALID");
  const expected = new Map(expectedRoles(policy).map((role) => [role.name, role]));
  for (const role of records) {
    exactKeys(role, ROLE_STATE_FIELDS, "RUNTIME_PRIVILEGE_STATE_ROLE_INVALID");
    if (!MANAGED_ROLE.test(role.name) || !expected.has(role.name)) reject("RUNTIME_PRIVILEGE_STATE_UNKNOWN_MANAGED_ROLE");
    exact(role, expected.get(role.name), "RUNTIME_PRIVILEGE_STATE_ROLE_DRIFT");
  }
  if (mode === "final") exact(records, [...expected.values()], "RUNTIME_PRIVILEGE_STATE_ROLE_SET_MISMATCH");
}

function validateMembershipRecords(records, policy, mode) {
  orderedUnique(records, membershipKey, "RUNTIME_PRIVILEGE_STATE_MEMBERSHIP_ORDER_INVALID");
  const expected = new Map(policy.memberships.map((item) => [membershipKey(item), item]));
  for (const record of records) {
    exactKeys(record, ["role", "member", "grantor", "admin_option", "inherit_option", "set_option"], "RUNTIME_PRIVILEGE_STATE_MEMBERSHIP_INVALID");
    const wanted = expected.get(membershipKey(record));
    if (!wanted) reject("RUNTIME_PRIVILEGE_STATE_UNKNOWN_MEMBERSHIP");
    exact(record, wanted, "RUNTIME_PRIVILEGE_STATE_MEMBERSHIP_DRIFT");
  }
  if (mode === "final") exact(records, policy.memberships, "RUNTIME_PRIVILEGE_STATE_MEMBERSHIP_SET_MISMATCH");
}

function validateAclRecords(records, policy, catalog, mode, expectedFinal) {
  orderedUnique(records, aclKey, "RUNTIME_PRIVILEGE_STATE_ACL_ORDER_INVALID");
  const owners = objectOwners(policy, catalog);
  const allowedGrantees = new Set(["PUBLIC", ...privilegeGroups(policy)]);
  const forbiddenLogins = new Set(loginRoles(policy));
  for (const record of records) {
    exactKeys(record, ACL_FIELDS, "RUNTIME_PRIVILEGE_STATE_ACL_INVALID");
    const owner = owners.get(`${record.kind}\u0001${record.identity}`);
    if (!owner) reject(`RUNTIME_PRIVILEGE_STATE_UNKNOWN_ACL_OBJECT_${record.kind}_${runtimePrivilegeRawSha256(record.identity).slice(0, 12).toUpperCase()}`);
    if (record.owner !== owner || record.grantor !== owner) reject("RUNTIME_PRIVILEGE_STATE_ACL_OWNER_DRIFT");
    if (forbiddenLogins.has(record.grantee)) reject("RUNTIME_PRIVILEGE_STATE_DIRECT_LOGIN_ACL");
    if (!allowedGrantees.has(record.grantee)) reject("RUNTIME_PRIVILEGE_STATE_UNKNOWN_ACL_ENDPOINT");
    if (!ACL_PRIVILEGES[record.kind]?.includes(record.privilege_type)) reject("RUNTIME_PRIVILEGE_STATE_ACL_PRIVILEGE_INVALID");
    if (record.is_grantable !== false) reject("RUNTIME_PRIVILEGE_STATE_GRANT_OPTION_FORBIDDEN");
  }
  if (mode === "final") exact(records, expectedFinal, "RUNTIME_PRIVILEGE_STATE_ACL_SET_MISMATCH");
}

function expectedAclStorage(policy, catalog, desiredAcl) {
  const owners = objectOwners(policy, catalog);
  const grantees = new Map();
  for (const record of desiredAcl) {
    const key = `${record.kind}\u0001${record.identity}`;
    const current = grantees.get(key) || new Set();
    current.add(record.grantee);
    grantees.set(key, current);
  }
  return [...owners.entries()].map(([key, owner]) => {
    const separator = key.indexOf("\u0001");
    const kind = key.slice(0, separator);
    const identity = key.slice(separator + 1);
    return Object.freeze({
      kind,
      identity,
      owner,
      acl_state: "EXPLICIT",
      acl_item_count: 1 + (grantees.get(key)?.size || 0),
      owner_privileges: Object.freeze(ACL_PRIVILEGES[kind].map((privilegeType) => Object.freeze({ privilege_type: privilegeType, is_grantable: false }))),
    });
  }).sort((left, right) => compareC(storageKey(left), storageKey(right)));
}

function validateAclStorage(records, policy, catalog, mode, expectedFinal) {
  orderedUnique(records, storageKey, "RUNTIME_PRIVILEGE_STATE_ACL_STORAGE_ORDER_INVALID");
  const owners = objectOwners(policy, catalog);
  if (records.length !== owners.size) reject("RUNTIME_PRIVILEGE_STATE_ACL_STORAGE_OBJECT_SET_MISMATCH");
  for (const record of records) {
    exactKeys(record, ["kind", "identity", "owner", "acl_state", "acl_item_count", "owner_privileges"], "RUNTIME_PRIVILEGE_STATE_ACL_STORAGE_INVALID");
    const owner = owners.get(storageKey(record));
    if (!owner || record.owner !== owner || !["NULL", "EMPTY", "EXPLICIT"].includes(record.acl_state)) reject("RUNTIME_PRIVILEGE_STATE_ACL_STORAGE_DRIFT");
    integer(record.acl_item_count, 0, 16, "RUNTIME_PRIVILEGE_STATE_ACL_STORAGE_INVALID");
    const allowedOwner = new Set(ACL_PRIVILEGES[record.kind] || []);
    orderedUnique(record.owner_privileges, (item) => item?.privilege_type, "RUNTIME_PRIVILEGE_STATE_OWNER_ACL_ORDER_INVALID");
    for (const privilege of record.owner_privileges) {
      exactKeys(privilege, ["privilege_type", "is_grantable"], "RUNTIME_PRIVILEGE_STATE_OWNER_ACL_INVALID");
      if (!allowedOwner.has(privilege.privilege_type) || privilege.is_grantable !== false) reject("RUNTIME_PRIVILEGE_STATE_OWNER_ACL_DRIFT");
    }
  }
  if (mode === "final") exact(records, expectedFinal, "RUNTIME_PRIVILEGE_STATE_ACL_STORAGE_SET_MISMATCH");
}

function allowedDefaultScopes(policy) {
  return policy.default_privileges.map((item) => Object.freeze({
    owner: item.owner,
    schema: item.schema === null ? "ALL" : item.schema,
    object_kind: item.object_kind,
  })).sort((left, right) => compareC(defaultScopeKey(left), defaultScopeKey(right)));
}

function expectedDefaultScopes(policy) {
  return allowedDefaultScopes(policy).filter((item) => ["ROUTINE", "TYPE"].includes(item.object_kind));
}

function validateDefaultPrivileges(state, policy, mode) {
  const allowedScopes = new Map(allowedDefaultScopes(policy).map((item) => [defaultScopeKey(item), item]));
  orderedUnique(state.default_privilege_scopes, defaultScopeKey, "RUNTIME_PRIVILEGE_STATE_DEFAULT_SCOPE_ORDER_INVALID");
  for (const scope of state.default_privilege_scopes) {
    exactKeys(scope, ["owner", "schema", "object_kind"], "RUNTIME_PRIVILEGE_STATE_DEFAULT_SCOPE_INVALID");
    if (!allowedScopes.has(defaultScopeKey(scope))) reject("RUNTIME_PRIVILEGE_STATE_UNKNOWN_DEFAULT_SCOPE");
  }
  orderedUnique(state.default_privileges, defaultPrivilegeKey, "RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_ORDER_INVALID");
  const allowedGrantees = new Set(["PUBLIC", ...privilegeGroups(policy)]);
  const forbiddenLogins = new Set(loginRoles(policy));
  for (const record of state.default_privileges) {
    exactKeys(record, ["owner", "schema", "object_kind", "grantor", "grantee", "privilege_type", "is_grantable"], "RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_INVALID");
    if (!allowedScopes.has(defaultScopeKey(record)) || record.grantor !== record.owner) reject("RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_OWNER_DRIFT");
    if (forbiddenLogins.has(record.grantee)) reject("RUNTIME_PRIVILEGE_STATE_DIRECT_LOGIN_DEFAULT_ACL");
    if (!allowedGrantees.has(record.grantee)) reject("RUNTIME_PRIVILEGE_STATE_UNKNOWN_DEFAULT_ACL_ENDPOINT");
    if (!ACL_PRIVILEGES[record.object_kind]?.includes(record.privilege_type) || record.is_grantable !== false) reject("RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_INVALID");
  }
  integer(state.default_privilege_row_count, 0, 4, "RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_COUNT_INVALID");
  if (mode === "final") {
    exact(state.default_privilege_scopes, expectedDefaultScopes(policy), "RUNTIME_PRIVILEGE_STATE_DEFAULT_SCOPE_SET_MISMATCH");
    exact(state.default_privileges, [], "RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_SET_MISMATCH");
    if (state.default_privilege_row_count !== 2) reject("RUNTIME_PRIVILEGE_STATE_DEFAULT_ACL_COUNT_MISMATCH");
  }
}

function validateEmptyUnsupportedState(state) {
  if (state.column_acl_object_count !== 0 || state.column_acl.length !== 0) reject("RUNTIME_PRIVILEGE_STATE_COLUMN_ACL_FORBIDDEN");
  if (state.parameter_acl_row_count !== 0 || state.parameter_acl.length !== 0) reject("RUNTIME_PRIVILEGE_STATE_PARAMETER_ACL_FORBIDDEN");
  if (state.custom_tablespace_count !== 0 || state.custom_tablespaces.length !== 0) reject("RUNTIME_PRIVILEGE_STATE_CUSTOM_TABLESPACE_FORBIDDEN");
  if (state.large_object_count !== 0) reject("RUNTIME_PRIVILEGE_STATE_LARGE_OBJECT_FORBIDDEN");
}

function validateSources(policy, access, catalog) {
  let validatedAccess;
  let validatedCatalog;
  let validatedPolicy;
  try {
    validatedAccess = validateRuntimePrivilegeAccessDocument(access);
    validatedCatalog = validateRuntimePrivilegeCompiledCatalog(catalog, { access: validatedAccess });
    validatedPolicy = validateRuntimePrivilegePolicy(policy, { access: validatedAccess, catalog: validatedCatalog });
  } catch {
    reject("RUNTIME_PRIVILEGE_RECONCILER_SOURCE_INVALID");
  }
  return { policy: validatedPolicy, access: validatedAccess, catalog: validatedCatalog };
}

export function parseRuntimePrivilegeState(source) {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") < 2 || Buffer.byteLength(source, "utf8") > MAX_STATE_BYTES || source.includes("\u0000") || source.includes("\r")) reject("RUNTIME_PRIVILEGE_STATE_JSON_INVALID");
  try { return parseStrictJson(source, MAX_STATE_BYTES); }
  catch { reject("RUNTIME_PRIVILEGE_STATE_JSON_INVALID"); }
}

export function validateRuntimePrivilegeState(value, { policy, access, catalog, expectedTarget = null, mode = "baseline", expectedFinal = null } = {}) {
  const sources = validateSources(policy, access, catalog);
  if (!["baseline", "final"].includes(mode)) reject("RUNTIME_PRIVILEGE_STATE_MODE_INVALID");
  exactKeys(value, [
    "schema_version", "contract", "target", "engine", "database", "schema", "roles", "memberships", "role_settings",
    "object_acl", "object_acl_storage", "column_acl", "column_acl_object_count", "default_privilege_scopes", "default_privileges",
    "default_privilege_row_count", "parameter_acl", "parameter_acl_row_count", "custom_tablespaces",
    "custom_tablespace_count", "large_object_count",
  ], "RUNTIME_PRIVILEGE_STATE_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== RUNTIME_PRIVILEGE_STATE_CONTRACT) reject("RUNTIME_PRIVILEGE_STATE_IDENTITY_INVALID");
  validateTarget(value.target);
  if (expectedTarget !== null) exact(value.target, expectedTarget, "RUNTIME_PRIVILEGE_STATE_TARGET_MISMATCH");
  exact(value.engine, {
    server_version_num: sources.policy.source_binding.engine_binding.server_version_num,
    encoding: sources.policy.database.encoding,
    locale_provider: sources.policy.database.locale_provider,
    collate: sources.policy.database.collate,
    ctype: sources.policy.database.ctype,
    collation_version: sources.policy.database.collation_version,
  }, "RUNTIME_PRIVILEGE_STATE_ENGINE_MISMATCH");
  const expectedDatabase = {
    name: sources.policy.database.name,
    owner: sources.policy.database.owner,
    allow_connect: sources.policy.database.allow_connect,
    connection_limit: sources.policy.database.connection_limit,
    default_tablespace: sources.policy.database.default_tablespace,
  };
  exactKeys(value.database, Object.keys(expectedDatabase), "RUNTIME_PRIVILEGE_STATE_DATABASE_INVALID");
  if (mode === "baseline") {
    if (value.database.name !== expectedDatabase.name || value.database.owner !== expectedDatabase.owner || value.database.allow_connect !== true
      || value.database.default_tablespace !== expectedDatabase.default_tablespace || !Number.isSafeInteger(value.database.connection_limit)
      || value.database.connection_limit < -1 || value.database.connection_limit > expectedDatabase.connection_limit) reject("RUNTIME_PRIVILEGE_STATE_DATABASE_DRIFT");
  } else exact(value.database, expectedDatabase, "RUNTIME_PRIVILEGE_STATE_DATABASE_DRIFT");
  exact(value.schema, { name: sources.policy.schema.name, owner: sources.policy.schema.owner }, "RUNTIME_PRIVILEGE_STATE_SCHEMA_DRIFT");
  validateRoleRecords(value.roles, sources.policy, mode);
  validateMembershipRecords(value.memberships, sources.policy, mode);
  if (!Array.isArray(value.role_settings) || value.role_settings.length !== 0) reject("RUNTIME_PRIVILEGE_STATE_ROLE_SETTING_DRIFT");
  const desired = expectedFinal || (mode === "final" ? createRuntimePrivilegeDesiredState(value, sources) : null);
  validateAclRecords(value.object_acl, sources.policy, sources.catalog, mode, desired?.object_acl || []);
  validateAclStorage(value.object_acl_storage, sources.policy, sources.catalog, mode, desired?.object_acl_storage || []);
  if (!Array.isArray(value.column_acl) || !Array.isArray(value.parameter_acl) || !Array.isArray(value.custom_tablespaces)) reject("RUNTIME_PRIVILEGE_STATE_UNSUPPORTED_FIELDS_INVALID");
  validateDefaultPrivileges(value, sources.policy, mode);
  validateEmptyUnsupportedState(value);
  return value;
}

function addAcl(records, kind, identity, owner, grantee, privilegeType) {
  records.push(Object.freeze({ kind, identity, owner, grantor: owner, grantee, privilege_type: privilegeType, is_grantable: false }));
}

function catalogOwner(value, policy) {
  return value === "MIGRATION_OWNER" ? policy.identities.migration_owner : value;
}

export function createRuntimePrivilegeDesiredState(baseline, { policy, access, catalog } = {}) {
  const sources = validateSources(policy, access, catalog);
  const records = [];
  for (const service of ACCESS_SERVICES) {
    const group = sources.policy.service_bindings[service].privilege_group;
    addAcl(records, "DATABASE", sources.policy.database.name, sources.policy.database.owner, group, "CONNECT");
    addAcl(records, "SCHEMA", sources.policy.schema.name, sources.policy.schema.owner, group, "USAGE");
    const serviceAccess = sources.access.services[service];
    for (const [privilege, objects] of Object.entries(serviceAccess.table_privileges)) {
      for (const object of objects) {
        const item = sources.catalog.catalog.tables.find((candidate) => candidate.name === object);
        if (!item) reject("RUNTIME_PRIVILEGE_DESIRED_TABLE_MISSING");
        addAcl(records, "TABLE", `public.${object}`, catalogOwner(item.owner, sources.policy), group, privilege);
      }
    }
    for (const [privilege, objects] of Object.entries(serviceAccess.sequence_privileges)) {
      for (const object of objects) {
        const item = sources.catalog.catalog.sequences.find((candidate) => candidate.name === object);
        if (!item) reject("RUNTIME_PRIVILEGE_DESIRED_SEQUENCE_MISSING");
        addAcl(records, "SEQUENCE", `public.${object}`, catalogOwner(item.owner, sources.policy), group, privilege);
      }
    }
    for (const identity of [...serviceAccess.routine_execute.APPLICATION, ...serviceAccess.routine_execute.EXTENSION]) {
      const item = sources.catalog.catalog.routines.find((candidate) => candidate.identity === identity);
      if (!item) reject("RUNTIME_PRIVILEGE_DESIRED_ROUTINE_MISSING");
      addAcl(records, "ROUTINE", identity, catalogOwner(item.owner, sources.policy), group, "EXECUTE");
    }
  }
  records.sort((left, right) => compareC(aclKey(left), aclKey(right)));
  const unique = new Set(records.map(aclKey));
  if (unique.size !== records.length) reject("RUNTIME_PRIVILEGE_DESIRED_ACL_DUPLICATE");
  const counts = Object.fromEntries(Object.keys(ACL_PRIVILEGES).map((kind) => [kind, records.filter((record) => record.kind === kind).length]));
  exact(counts, { DATABASE: 4, SCHEMA: 4, TABLE: 813, SEQUENCE: 411, ROUTINE: 29, TYPE: 0, TABLESPACE: 0, LARGE_OBJECT: 0 }, "RUNTIME_PRIVILEGE_DESIRED_ACL_COUNT_MISMATCH");
  if (records.length !== sources.policy.acl_summary.tuple_counts.total) reject("RUNTIME_PRIVILEGE_DESIRED_ACL_COUNT_MISMATCH");
  const coverage = {
    table: new Set(records.filter((record) => record.kind === "TABLE").map((record) => record.identity)).size,
    sequence: new Set(records.filter((record) => record.kind === "SEQUENCE").map((record) => record.identity)).size,
    routine: new Set(records.filter((record) => record.kind === "ROUTINE").map((record) => record.identity)).size,
  };
  exact(coverage, sources.policy.acl_summary.object_coverage, "RUNTIME_PRIVILEGE_DESIRED_ACL_COVERAGE_MISMATCH");
  const objectAclStorage = expectedAclStorage(sources.policy, sources.catalog, records);
  return Object.freeze({
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_STATE_CONTRACT,
    target: baseline.target,
    engine: baseline.engine,
    database: {
      name: sources.policy.database.name,
      owner: sources.policy.database.owner,
      allow_connect: sources.policy.database.allow_connect,
      connection_limit: sources.policy.database.connection_limit,
      default_tablespace: sources.policy.database.default_tablespace,
    },
    schema: { name: sources.policy.schema.name, owner: sources.policy.schema.owner },
    roles: expectedRoles(sources.policy),
    memberships: sources.policy.memberships,
    role_settings: Object.freeze([]),
    object_acl: Object.freeze(records),
    object_acl_storage: Object.freeze(objectAclStorage),
    column_acl: Object.freeze([]),
    column_acl_object_count: 0,
    default_privilege_scopes: Object.freeze(expectedDefaultScopes(sources.policy)),
    default_privileges: Object.freeze([]),
    default_privilege_row_count: 2,
    parameter_acl: Object.freeze([]),
    parameter_acl_row_count: 0,
    custom_tablespaces: Object.freeze([]),
    custom_tablespace_count: 0,
    large_object_count: 0,
  });
}

function surface(records) {
  return Object.freeze({ count: records.length, sha256: clusterSha256(records.map((record) => canonicalClusterJson(record)).join("")) });
}

export function validateRuntimePrivilegeStructuralReport(reportSource, { policy, access, catalog, expectedDefaultPrivilegeCount = 2 } = {}) {
  const sources = validateSources(policy, access, catalog);
  let report;
  try { report = parseRuntimePrivilegeCatalogReport(reportSource); }
  catch { reject("RUNTIME_PRIVILEGE_STRUCTURE_REPORT_INVALID"); }
  exact(report.meta, {
    contract: "chenyida-erp-postgresql-runtime-privilege-catalog-report/v1",
    database: sources.policy.database.name,
    schema: sources.policy.schema.name,
    server_major: sources.catalog.engine_binding.server_major,
    server_version_num: sources.catalog.engine_binding.server_version_num,
    encoding: sources.catalog.engine_binding.encoding,
    locale_provider: sources.catalog.engine_binding.locale_provider,
    collate: sources.catalog.engine_binding.collate,
    ctype: sources.catalog.engine_binding.ctype,
    collation_version: sources.catalog.engine_binding.collation_version,
    database_owner: "MIGRATION_OWNER",
    schema_owner: sources.policy.schema.owner,
  }, "RUNTIME_PRIVILEGE_STRUCTURE_META_MISMATCH");
  exact(report.tables, sources.catalog.catalog.tables, "RUNTIME_PRIVILEGE_STRUCTURE_TABLE_MISMATCH");
  exact(report.sequences, sources.catalog.catalog.sequences, "RUNTIME_PRIVILEGE_STRUCTURE_SEQUENCE_MISMATCH");
  exact(report.routines, sources.catalog.catalog.routines, "RUNTIME_PRIVILEGE_STRUCTURE_ROUTINE_MISMATCH");
  exact(report.types, sources.catalog.catalog.standalone_types, "RUNTIME_PRIVILEGE_STRUCTURE_TYPE_MISMATCH");
  exact(report.extensions, sources.catalog.catalog.extensions, "RUNTIME_PRIVILEGE_STRUCTURE_EXTENSION_MISMATCH");
  for (const field of ["columns", "constraints", "indexes", "triggers"]) exact(surface(report[field]), sources.catalog.catalog.structural_surfaces[field], "RUNTIME_PRIVILEGE_STRUCTURE_SURFACE_MISMATCH");
  if (surface(report.migrations).sha256 !== sources.catalog.source_binding.migrations.applied_ledger_sha256
    || report.migrations.length !== sources.catalog.source_binding.migrations.count
    || report.migrations.at(-1)?.version !== sources.catalog.source_binding.migrations.head) reject("RUNTIME_PRIVILEGE_STRUCTURE_MIGRATION_MISMATCH");
  for (const [field, count] of Object.entries(report.unsupported)) {
    if (field === "default_privilege_count") {
      if (![0, 2].includes(expectedDefaultPrivilegeCount) || count !== expectedDefaultPrivilegeCount) reject("RUNTIME_PRIVILEGE_STRUCTURE_DEFAULT_ACL_COUNT_MISMATCH");
    } else if (count !== 0) reject("RUNTIME_PRIVILEGE_STRUCTURE_UNSUPPORTED_PRESENT");
  }
  return report;
}

function quoteIdentifier(value) {
  text(value, "RUNTIME_PRIVILEGE_PLAN_IDENTIFIER_INVALID", IDENTIFIER);
  return `"${value}"`;
}

function quoteQualified(identity) {
  const parts = identity.split(".");
  if (parts.length !== 2) reject("RUNTIME_PRIVILEGE_PLAN_IDENTIFIER_INVALID");
  return `${quoteIdentifier(parts[0])}.${quoteIdentifier(parts[1])}`;
}

function roleCreateStatement(role) {
  return `CREATE ROLE ${quoteIdentifier(role.name)} WITH ${role.can_login ? "LOGIN" : "NOLOGIN"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${role.inherit ? "INHERIT" : "NOINHERIT"} CONNECTION LIMIT ${role.connection_limit}`;
}

function groupedAclStatements(desired, kind, objectKeyword, quoteObject) {
  const byObject = new Map();
  for (const record of desired.object_acl.filter((item) => item.kind === kind)) {
    const key = `${record.identity}\u0001${record.grantee}`;
    const current = byObject.get(key) || { identity: record.identity, grantee: record.grantee, privileges: [] };
    current.privileges.push(record.privilege_type);
    byObject.set(key, current);
  }
  return [...byObject.values()].sort((left, right) => compareC(`${left.identity}\u0001${left.grantee}`, `${right.identity}\u0001${right.grantee}`)).map((item) =>
    `GRANT ${item.privileges.sort().join(", ")} ON ${objectKeyword} ${quoteObject(item.identity)} TO ${quoteIdentifier(item.grantee)}`);
}

export function createRuntimePrivilegeReconciliationPlan(baseline, { policy, access, catalog, allowRoleBootstrap = false } = {}) {
  const sources = validateSources(policy, access, catalog);
  validateRuntimePrivilegeState(baseline, { ...sources, mode: "baseline" });
  const desired = createRuntimePrivilegeDesiredState(baseline, sources);
  const statements = [];
  const present = new Set(baseline.roles.map((role) => role.name));
  const missingRoles = desired.roles.filter((role) => !present.has(role.name));
  if (missingRoles.length > 0 && !allowRoleBootstrap) reject("RUNTIME_PRIVILEGE_ROLE_BOOTSTRAP_REQUIRED");
  const noOp = same(baseline, desired);
  if (!noOp) {
    statements.push("SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint)");
    for (const role of missingRoles) statements.push(roleCreateStatement(role));
    statements.push(`ALTER DATABASE ${quoteIdentifier(sources.policy.database.name)} CONNECTION LIMIT ${sources.policy.database.connection_limit}`);
    for (const membership of sources.policy.memberships) {
      if (!baseline.memberships.some((item) => membershipKey(item) === membershipKey(membership))) {
        statements.push(`GRANT ${quoteIdentifier(membership.role)} TO ${quoteIdentifier(membership.member)} WITH INHERIT TRUE, SET FALSE`);
      }
    }
    const endpoints = ["PUBLIC", ...privilegeGroups(sources.policy), ...loginRoles(sources.policy)];
    const endpointSql = endpoints.map((item) => item === "PUBLIC" ? "PUBLIC" : quoteIdentifier(item)).join(", ");
    const objectEndpointSql = `${endpointSql}, ${quoteIdentifier(sources.policy.identities.migration_owner)}, ${quoteIdentifier("pg_database_owner")}, CURRENT_USER`;
    statements.push(`REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(sources.policy.database.name)} FROM ${objectEndpointSql}`);
    statements.push(`REVOKE ALL PRIVILEGES ON SCHEMA ${quoteIdentifier(sources.policy.schema.name)} FROM ${objectEndpointSql}`);
    statements.push(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${quoteIdentifier(sources.policy.schema.name)} FROM ${objectEndpointSql}`);
    statements.push(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${quoteIdentifier(sources.policy.schema.name)} FROM ${objectEndpointSql}`);
    for (const routine of sources.catalog.catalog.routines) statements.push(`REVOKE ALL PRIVILEGES ON ROUTINE ${routine.identity} FROM ${objectEndpointSql}`);
    for (const type of sources.catalog.catalog.standalone_types) statements.push(`REVOKE ALL PRIVILEGES ON TYPE ${quoteQualified(type.identity)} FROM ${objectEndpointSql}`);
    for (const tablespace of sources.policy.tablespaces.built_in) statements.push(`REVOKE ALL PRIVILEGES ON TABLESPACE ${quoteIdentifier(tablespace)} FROM ${objectEndpointSql}`);
    for (const item of sources.policy.default_privileges) {
      const scope = item.scope === "SCHEMA" ? ` IN SCHEMA ${quoteIdentifier(item.schema)}` : "";
      const keyword = item.object_kind === "ROUTINE" ? "ROUTINES" : `${item.object_kind}S`;
      statements.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(item.owner)}${scope} REVOKE ALL PRIVILEGES ON ${keyword} FROM ${endpointSql}`);
    }
    statements.push(`GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(sources.policy.database.name)} TO ${quoteIdentifier(sources.policy.database.owner)}`);
    statements.push(`GRANT ALL PRIVILEGES ON SCHEMA ${quoteIdentifier(sources.policy.schema.name)} TO ${quoteIdentifier("pg_database_owner")}`);
    statements.push(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${quoteIdentifier(sources.policy.schema.name)} TO ${quoteIdentifier(sources.policy.identities.migration_owner)}`);
    statements.push(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${quoteIdentifier(sources.policy.schema.name)} TO ${quoteIdentifier(sources.policy.identities.migration_owner)}`);
    for (const routine of sources.catalog.catalog.routines) {
      const ownerSql = routine.owner === "MIGRATION_OWNER" ? quoteIdentifier(sources.policy.identities.migration_owner) : "CURRENT_USER";
      statements.push(`GRANT ALL PRIVILEGES ON ROUTINE ${routine.identity} TO ${ownerSql}`);
    }
    for (const type of sources.catalog.catalog.standalone_types) statements.push(`GRANT ALL PRIVILEGES ON TYPE ${quoteQualified(type.identity)} TO CURRENT_USER`);
    for (const tablespace of sources.policy.tablespaces.built_in) statements.push(`GRANT ALL PRIVILEGES ON TABLESPACE ${quoteIdentifier(tablespace)} TO CURRENT_USER`);
    statements.push(...groupedAclStatements(desired, "DATABASE", "DATABASE", quoteIdentifier));
    statements.push(...groupedAclStatements(desired, "SCHEMA", "SCHEMA", quoteIdentifier));
    statements.push(...groupedAclStatements(desired, "TABLE", "TABLE", quoteQualified));
    statements.push(...groupedAclStatements(desired, "SEQUENCE", "SEQUENCE", quoteQualified));
    statements.push(...groupedAclStatements(desired, "ROUTINE", "ROUTINE", (value) => value));
  }
  const body = Object.freeze({
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_RECONCILIATION_PLAN_CONTRACT,
    policy_sha256: sources.policy.policy_sha256,
    target: baseline.target,
    baseline_state_sha256: clusterSha256(baseline),
    desired_state_sha256: clusterSha256(desired),
    no_op: noOp,
    role_bootstrap: missingRoles.length > 0,
    statements: Object.freeze(statements),
  });
  return Object.freeze({ ...body, plan_sha256: clusterSha256(body), desired });
}

export function createRuntimePrivilegeBootstrapPlan(baseline, sources = {}) {
  return createRuntimePrivilegeReconciliationPlan(baseline, { ...sources, allowRoleBootstrap: true });
}

export function createRuntimePrivilegeReconciliationIntent(plan, createdAt) {
  exactKeys(plan, ["schema_version", "contract", "policy_sha256", "target", "baseline_state_sha256", "desired_state_sha256", "no_op", "role_bootstrap", "statements", "plan_sha256", "desired"], "RUNTIME_PRIVILEGE_PLAN_INVALID");
  if (plan.schema_version !== 2 || plan.contract !== RUNTIME_PRIVILEGE_RECONCILIATION_PLAN_CONTRACT || !SHA256.test(plan.policy_sha256)
    || !SHA256.test(plan.baseline_state_sha256) || !SHA256.test(plan.desired_state_sha256) || !SHA256.test(plan.plan_sha256)
    || typeof plan.no_op !== "boolean" || typeof plan.role_bootstrap !== "boolean" || plan.no_op) reject("RUNTIME_PRIVILEGE_PLAN_INVALID");
  text(createdAt, "RUNTIME_PRIVILEGE_INTENT_TIMESTAMP_INVALID");
  const body = Object.freeze({
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_RECONCILIATION_INTENT_CONTRACT,
    state: "INTENT_DURABLE",
    target: plan.target,
    policy_sha256: plan.policy_sha256,
    baseline_state_sha256: plan.baseline_state_sha256,
    desired_state_sha256: plan.desired_state_sha256,
    plan_sha256: plan.plan_sha256,
    created_at: createdAt,
  });
  return Object.freeze({ ...body, intent_sha256: clusterSha256(body) });
}

export function transitionRuntimePrivilegeIntent(intent, nextState) {
  if (!INTENT_STATES.includes(nextState)) reject("RUNTIME_PRIVILEGE_INTENT_STATE_INVALID");
  const transitions = Object.freeze({
    INTENT_DURABLE: ["TRANSACTION_DISPATCHED", "QUARANTINED"],
    TRANSACTION_DISPATCHED: ["POSTCOMMIT_CAPTURED", "QUARANTINED"],
    POSTCOMMIT_CAPTURED: ["VERIFIED", "QUARANTINED"],
    VERIFIED: [],
    QUARANTINED: [],
  });
  if (!transitions[intent.state]?.includes(nextState)) reject("RUNTIME_PRIVILEGE_INTENT_TRANSITION_INVALID");
  const { intent_sha256: ignored, ...current } = intent;
  void ignored;
  const body = Object.freeze({ ...current, state: nextState });
  return Object.freeze({ ...body, intent_sha256: clusterSha256(body) });
}

export function decideRuntimePrivilegeInterruptedRecovery(intent, currentState) {
  if (!["INTENT_DURABLE", "TRANSACTION_DISPATCHED", "POSTCOMMIT_CAPTURED"].includes(intent.state)) reject("RUNTIME_PRIVILEGE_INTENT_RECOVERY_STATE_INVALID");
  const digest = clusterSha256(currentState);
  if (digest === intent.desired_state_sha256) return "FINISH_VERIFICATION";
  if (digest === intent.baseline_state_sha256) return "RETRY_TRANSACTION";
  return "QUARANTINE";
}

export function runtimePrivilegeRawSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readIsolatedTestFile(file, maximumBytes, code) {
  const absolute = path.resolve(file);
  if (process.env.NODE_ENV !== "test" || process.env.ERP_RUNTIME_PRIVILEGE_RECONCILER_POSTGRES_CONTAINER_MODE !== "YES"
    || !absolute.startsWith("/tmp/cyd-runtime-privilege-catalog-postgres.")) reject("RUNTIME_PRIVILEGE_ISOLATED_CLI_FORBIDDEN");
  const before = await lstat(absolute).catch(() => null);
  if (!before?.isFile()) reject(`${code}_NOT_REGULAR`);
  if (before.isSymbolicLink()) reject(`${code}_SYMLINK`);
  if (before.nlink !== 1) reject(`${code}_LINK_COUNT_INVALID`);
  if (before.size < 1) reject(`${code}_EMPTY`);
  if (before.size > maximumBytes) reject(`${code}_TOO_LARGE`);
  if ((before.mode & 0o022) !== 0) reject(`${code}_MODE_INVALID`);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) reject(`${code}_OPEN_INVALID`);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) reject(`${code}_IDENTITY_INVALID`);
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) reject(`${code}_RACE_INVALID`);
    return raw.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function isolatedSources() {
  const access = validateRuntimePrivilegeAccessDocument(parseStrictJson(await readFile(path.join(SITE_ROOT, RUNTIME_PRIVILEGE_ACCESS_PATH), "utf8")));
  const catalog = validateRuntimePrivilegeCompiledCatalog(parseStrictJson(await readFile(path.join(SITE_ROOT, RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH), "utf8")), { access });
  const policy = await createRuntimePrivilegePolicy({ siteRoot: SITE_ROOT });
  return { policy, access, catalog };
}

function renderIsolatedPsql(plan) {
  if (plan.no_op || plan.statements.length < 2) reject("RUNTIME_PRIVILEGE_ISOLATED_PLAN_EMPTY");
  const [lock, ...statements] = plan.statements;
  return [
    "\\set ON_ERROR_STOP on",
    "\\set QUIET on",
    "BEGIN;",
    `${lock} AS migration_lock_acquired`,
    "\\gset",
    "\\if :migration_lock_acquired",
    ...statements.map((statement) => `${statement};`),
    "COMMIT;",
    "\\else",
    "  \\echo 'RUNTIME_PRIVILEGE_MIGRATION_LOCK_UNAVAILABLE'",
    "  ROLLBACK;",
    "  \\quit 3",
    "\\endif",
    "",
  ].join("\n");
}

async function isolatedMain(args) {
  if (args.length !== 2 || !["render-isolated-bootstrap-psql", "verify-isolated-state", "verify-isolated-structure-baseline", "verify-isolated-structure", "assert-isolated-noop"].includes(args[0])) {
    process.stderr.write("usage: postgresql-runtime-privilege-reconciler.mjs render-isolated-bootstrap-psql|verify-isolated-state|verify-isolated-structure-baseline|verify-isolated-structure|assert-isolated-noop FILE\n");
    process.exitCode = 2;
    return;
  }
  const sources = await isolatedSources();
  const source = await readIsolatedTestFile(args[1], args[0].startsWith("verify-isolated-structure") ? 32 * 1024 * 1024 : MAX_STATE_BYTES, "RUNTIME_PRIVILEGE_ISOLATED_INPUT_INVALID");
  if (["verify-isolated-structure-baseline", "verify-isolated-structure"].includes(args[0])) {
    const report = validateRuntimePrivilegeStructuralReport(source, { ...sources, expectedDefaultPrivilegeCount: args[0] === "verify-isolated-structure-baseline" ? 0 : 2 });
    process.stdout.write(`RUNTIME_PRIVILEGE_STRUCTURE_VERIFIED tables=${report.tables.length} sequences=${report.sequences.length} routines=${report.routines.length}\n`);
    return;
  }
  const state = parseRuntimePrivilegeState(source);
  if (args[0] === "render-isolated-bootstrap-psql") {
    validateRuntimePrivilegeState(state, { ...sources, mode: "baseline" });
    process.stdout.write(renderIsolatedPsql(createRuntimePrivilegeBootstrapPlan(state, sources)));
    return;
  }
  const desired = createRuntimePrivilegeDesiredState(state, sources);
  validateRuntimePrivilegeState(state, { ...sources, mode: "final", expectedTarget: state.target, expectedFinal: desired });
  if (args[0] === "assert-isolated-noop") {
    const plan = createRuntimePrivilegeReconciliationPlan(state, sources);
    if (!plan.no_op || plan.role_bootstrap || plan.statements.length !== 0) reject("RUNTIME_PRIVILEGE_ISOLATED_NOOP_MISMATCH");
    process.stdout.write(`RUNTIME_PRIVILEGE_RECONCILIATION_NOOP sha256=${plan.desired_state_sha256}\n`);
  } else process.stdout.write(`RUNTIME_PRIVILEGE_STATE_VERIFIED sha256=${clusterSha256(state)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  isolatedMain(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof RuntimePrivilegeReconcilerError ? error.code : "RUNTIME_PRIVILEGE_RECONCILER_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
