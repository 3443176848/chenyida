import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseStrictJson } from "./backup-recovery-contract.mjs";

export const CLUSTER_POLICY_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy/v1";
export const CLUSTER_SNAPSHOT_CONTRACT = "chenyida-erp-postgresql-cluster-snapshot/v1";
export const TABLESPACE_MAP_CONTRACT = "chenyida-erp-postgresql-tablespace-map/v1";
export const CREDENTIAL_FILE_CONTRACT = "chenyida-erp-postgresql-credential-binding/v1";
export const CLUSTER_SECURITY_RECEIPT_CONTRACT = "chenyida-erp-postgresql-cluster-security-receipt/v1";
export const TABLESPACE_RECEIPT_CONTRACT = "chenyida-erp-postgresql-tablespace-receipt/v1";
export const CREDENTIAL_RECEIPT_CONTRACT = "chenyida-erp-postgresql-credential-receipt/v1";
export const RECOVERY_INTENT_CONTRACT = "chenyida-erp-postgresql-recovery-intent/v1";
export const RECOVERY_STATE_CONTRACT = "chenyida-erp-postgresql-recovery-state/v1";
export const CREDENTIAL_ROOT_MARKER = ".chenyida-erp-postgresql-credential-root-v1";
export const CREDENTIAL_ROOT_MARKER_VALUE = "chenyida-erp-postgresql-credential-root/v1\n";
export const RECOVERY_STATE_ROOT_MARKER = ".chenyida-erp-postgresql-recovery-state-root-v1";
export const RECOVERY_STATE_ROOT_MARKER_VALUE = "chenyida-erp-postgresql-recovery-state-root/v1\n";

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PG_MAJOR = /^(?:1[0-9]|[2-9][0-9])$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const ACL_STATES = new Set(["NULL", "EMPTY", "EXPLICIT"]);
const POLICY_SCOPES = new Set(["PRODUCTION_BASELINE", "UAT_BASELINE", "SYNTHETIC_TEST_ONLY"]);
const EVIDENCE_SCOPES = new Set(["ACTUAL_CONTROLLED", "SYNTHETIC_TEST_ONLY"]);
const ROLE_PURPOSES = new Set(["MIGRATION_OWNER", "RUNTIME", "PRIVILEGE_GROUP"]);
const EXTENSION_KINDS = new Set(["APPLICATION", "PLATFORM"]);
const FIXED_REFERENCES = new Set(["PUBLIC", "pg_database_owner"]);
const INDEX_KINDS = new Set(["INDEX_PLACEMENT", "PARTITIONED_INDEX_PLACEMENT"]);
const ACL_KINDS = Object.freeze([
  "DATABASE", "SCHEMA", "TABLE", "PARTITIONED_TABLE", "VIEW", "MATERIALIZED_VIEW",
  "SEQUENCE", "COLUMN", "ROUTINE", "TYPE", "LARGE_OBJECT", "TABLESPACE",
]);
const KNOWN_PRIVILEGES = Object.freeze({
  DATABASE: new Set(["CONNECT", "CREATE", "TEMPORARY"]),
  SCHEMA: new Set(["CREATE", "USAGE"]),
  TABLE: new Set(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]),
  PARTITIONED_TABLE: new Set(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]),
  VIEW: new Set(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]),
  MATERIALIZED_VIEW: new Set(["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]),
  SEQUENCE: new Set(["SELECT", "UPDATE", "USAGE"]),
  COLUMN: new Set(["INSERT", "REFERENCES", "SELECT", "UPDATE"]),
  ROUTINE: new Set(["EXECUTE"]),
  TYPE: new Set(["USAGE"]),
  LARGE_OBJECT: new Set(["SELECT", "UPDATE"]),
  TABLESPACE: new Set(["CREATE"]),
});
const UNSUPPORTED_COUNTERS = Object.freeze([
  "access_methods", "capture_role_conflicts", "casts", "collations", "conversions", "event_triggers", "external_database_settings", "foreign_data_wrappers", "foreign_servers",
  "foreign_tables", "operator_classes", "operator_families", "operators", "parameter_acl_entries",
  "policy_role_endpoints", "replication_origins", "row_security_policies", "security_labels", "statistics_extensions",
  "subscriptions", "text_search_objects", "transforms", "unapproved_languages", "unapproved_settings", "unsupported_relations", "user_mappings",
]);
const SECRET_BINDINGS = new WeakMap();

export class ClusterRecoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "ClusterRecoveryError";
    this.code = code;
  }
}

function reject(code) {
  throw new ClusterRecoveryError(code);
}

function record(value, code = "OBJECT_REQUIRED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code = "UNKNOWN_OR_MISSING_FIELD") {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function array(value, code) {
  if (!Array.isArray(value)) reject(code);
  return value;
}

function boolean(value, code) {
  if (typeof value !== "boolean") reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function string(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function enumValue(value, allowed, code) {
  if (typeof value !== "string" || !allowed.has(value)) reject(code);
  return value;
}

function nullableString(value, code) {
  if (value === null) return value;
  return pgText(value, code);
}

function pgText(value, code) {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > 512 || /[\u0000-\u001f\u007f]/u.test(value)) reject(code);
  return value;
}

function iso(value, code) {
  string(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function nullableIso(value, code) {
  return value === null ? null : iso(value, code);
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) reject("CANONICAL_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  reject("CANONICAL_VALUE_INVALID");
}

export function canonicalClusterJson(value) {
  return `${canonicalValue(value)}\n`;
}

export function clusterSha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : canonicalClusterJson(value));
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalClone(value) {
  return parseStrictJson(canonicalClusterJson(value));
}

function withoutKeys(value, keys) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

function orderedUnique(values, code, key = (item) => canonicalClusterJson(item)) {
  let previous = null;
  for (const value of values) {
    const current = key(value);
    if (previous !== null && current <= previous) reject(code);
    previous = current;
  }
}

function normalizeArray(values) {
  return [...values].map(canonicalClone).sort((left, right) => {
    const leftText = canonicalClusterJson(left), rightText = canonicalClusterJson(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  });
}

function validateStringList(value, code, { exact = null, pattern = null } = {}) {
  const values = array(value, code);
  for (const item of values) {
    if (pattern) string(item, pattern, code);
    else pgText(item, code);
  }
  orderedUnique(values, code, (item) => item);
  if (exact && (values.length !== exact.length || values.some((item, index) => item !== exact[index]))) reject(code);
  return values;
}

function validatePolicyRole(value) {
  exactKeys(value, ["name", "purpose", "intended_login", "inherit", "connection_limit", "valid_until"], "CLUSTER_POLICY_ROLE_INVALID");
  pgText(value.name, "CLUSTER_POLICY_ROLE_INVALID");
  enumValue(value.purpose, ROLE_PURPOSES, "CLUSTER_POLICY_ROLE_INVALID");
  boolean(value.intended_login, "CLUSTER_POLICY_ROLE_INVALID");
  boolean(value.inherit, "CLUSTER_POLICY_ROLE_INVALID");
  integer(value.connection_limit, -1, 10_000, "CLUSTER_POLICY_ROLE_INVALID");
  nullableIso(value.valid_until, "CLUSTER_POLICY_ROLE_INVALID");
  if (!value.intended_login && value.connection_limit !== -1) reject("CLUSTER_POLICY_NOLOGIN_LIMIT_INVALID");
  return value;
}

function validateMembership(value, code = "CLUSTER_MEMBERSHIP_INVALID") {
  exactKeys(value, ["role", "member", "grantor", "admin_option", "inherit_option", "set_option"], code);
  pgText(value.role, code);
  pgText(value.member, code);
  pgText(value.grantor, code);
  boolean(value.admin_option, code);
  boolean(value.inherit_option, code);
  boolean(value.set_option, code);
  return value;
}

function validateSetting(value, policy, code = "CLUSTER_SETTING_INVALID") {
  exactKeys(value, ["role_scope", "database_scope", "key", "value"], code);
  if (value.role_scope !== "ALL" && !policy.roles.some((role) => role.name === value.role_scope)) reject(code);
  if (!new Set(["ALL", "DATABASE"]).has(value.database_scope)) reject(code);
  pgText(value.key, code);
  pgText(value.value, code);
  if (!policy.settings.allowed_keys.includes(value.key)) reject("CLUSTER_SETTING_KEY_NOT_ALLOWED");
  return value;
}

function validateAclRuleMap(value, code) {
  exactKeys(value, ACL_KINDS, code);
  for (const kind of ACL_KINDS) {
    const allowed = validateStringList(value[kind], code);
    for (const privilege of allowed) if (!KNOWN_PRIVILEGES[kind].has(privilege)) reject(code);
  }
  return value;
}

export function validateClusterRecoveryPolicy(value) {
  exactKeys(value, [
    "schema_version", "contract", "policy_id", "scope", "postgresql_major", "database", "identities",
    "roles", "memberships", "settings", "acl", "supported_object_kinds", "extensions", "unsupported_catalog_counters",
    "tablespaces", "credential_binding",
  ], "CLUSTER_POLICY_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_POLICY_CONTRACT) reject("CLUSTER_POLICY_CONTRACT_INVALID");
  string(value.policy_id, IDENTIFIER, "CLUSTER_POLICY_ID_INVALID");
  enumValue(value.scope, POLICY_SCOPES, "CLUSTER_POLICY_SCOPE_INVALID");
  string(value.postgresql_major, PG_MAJOR, "CLUSTER_POLICY_POSTGRESQL_MAJOR_INVALID");

  exactKeys(value.database, ["name", "owner", "default_tablespace", "allow_connect", "connection_limit", "public_connect"], "CLUSTER_POLICY_DATABASE_INVALID");
  pgText(value.database.name, "CLUSTER_POLICY_DATABASE_INVALID");
  pgText(value.database.owner, "CLUSTER_POLICY_DATABASE_INVALID");
  pgText(value.database.default_tablespace, "CLUSTER_POLICY_DATABASE_INVALID");
  boolean(value.database.allow_connect, "CLUSTER_POLICY_DATABASE_INVALID");
  integer(value.database.connection_limit, -1, 10_000, "CLUSTER_POLICY_DATABASE_INVALID");
  boolean(value.database.public_connect, "CLUSTER_POLICY_DATABASE_INVALID");

  exactKeys(value.identities, ["migration_owner", "runtime_login", "privilege_group", "backup_capture", "restore_admin", "unauthorized_probe"], "CLUSTER_POLICY_IDENTITIES_INVALID");
  for (const identity of Object.values(value.identities)) pgText(identity, "CLUSTER_POLICY_IDENTITIES_INVALID");
  const identityValues = Object.values(value.identities);
  if (new Set(identityValues).size !== identityValues.length) reject("CLUSTER_POLICY_IDENTITIES_DUPLICATE");

  for (const role of array(value.roles, "CLUSTER_POLICY_ROLES_INVALID")) validatePolicyRole(role);
  orderedUnique(value.roles, "CLUSTER_POLICY_ROLES_NOT_CANONICAL", (role) => role.name);
  if (value.roles.length !== 3 || new Set(value.roles.map((role) => role.purpose)).size !== 3) reject("CLUSTER_POLICY_ROLE_PURPOSES_INVALID");
  const roleNames = new Set(value.roles.map((role) => role.name));
  for (const key of ["migration_owner", "runtime_login", "privilege_group"]) if (!roleNames.has(value.identities[key])) reject("CLUSTER_POLICY_ROLE_IDENTITY_MISMATCH");
  if (value.database.owner !== value.identities.migration_owner) reject("CLUSTER_POLICY_DATABASE_OWNER_INVALID");
  if (!value.roles.find((role) => role.name === value.identities.migration_owner)?.intended_login
    || !value.roles.find((role) => role.name === value.identities.runtime_login)?.intended_login
    || value.roles.find((role) => role.name === value.identities.privilege_group)?.intended_login) reject("CLUSTER_POLICY_LOGIN_INTENT_INVALID");

  for (const membership of array(value.memberships, "CLUSTER_POLICY_MEMBERSHIPS_INVALID")) {
    validateMembership(membership, "CLUSTER_POLICY_MEMBERSHIP_INVALID");
    if (!roleNames.has(membership.role) || !roleNames.has(membership.member)
      || membership.grantor !== value.identities.restore_admin || membership.admin_option || !membership.inherit_option || membership.set_option) reject("CLUSTER_POLICY_MEMBERSHIP_UNSAFE");
  }
  orderedUnique(value.memberships, "CLUSTER_POLICY_MEMBERSHIPS_NOT_CANONICAL");
  if (value.memberships.length !== 1 || value.memberships[0].role !== value.identities.privilege_group
    || value.memberships[0].member !== value.identities.runtime_login) reject("CLUSTER_POLICY_MEMBERSHIP_SET_INVALID");

  exactKeys(value.settings, ["allowed_keys", "required"], "CLUSTER_POLICY_SETTINGS_INVALID");
  validateStringList(value.settings.allowed_keys, "CLUSTER_POLICY_SETTING_KEYS_INVALID");
  for (const setting of array(value.settings.required, "CLUSTER_POLICY_REQUIRED_SETTINGS_INVALID")) validateSetting(setting, value, "CLUSTER_POLICY_REQUIRED_SETTING_INVALID");
  orderedUnique(value.settings.required, "CLUSTER_POLICY_REQUIRED_SETTINGS_NOT_CANONICAL");
  if (value.settings.required.some((setting) => setting.role_scope === value.identities.migration_owner)) reject("CLUSTER_POLICY_MIGRATION_OWNER_SETTING_FORBIDDEN");

  exactKeys(value.acl, ["fixed_semantic_references", "allowed_grantors", "allowed_grantees", "grantable_roles", "public_allowed_privileges", "non_owner_allowed_privileges"], "CLUSTER_POLICY_ACL_INVALID");
  validateStringList(value.acl.fixed_semantic_references, "CLUSTER_POLICY_ACL_REFERENCES_INVALID", { exact: [...FIXED_REFERENCES].sort() });
  validateStringList(value.acl.allowed_grantors, "CLUSTER_POLICY_ACL_GRANTORS_INVALID");
  validateStringList(value.acl.allowed_grantees, "CLUSTER_POLICY_ACL_GRANTEES_INVALID");
  validateStringList(value.acl.grantable_roles, "CLUSTER_POLICY_ACL_GRANTABLE_INVALID");
  const endpointAllowlist = new Set([...roleNames, ...FIXED_REFERENCES, value.identities.restore_admin]);
  for (const endpoint of [...value.acl.allowed_grantors, ...value.acl.allowed_grantees, ...value.acl.grantable_roles]) {
    if (!endpointAllowlist.has(endpoint) || (endpoint.startsWith("pg_") && endpoint !== "pg_database_owner")) reject("CLUSTER_POLICY_ACL_ENDPOINT_INVALID");
  }
  if (!value.acl.grantable_roles.includes(value.identities.migration_owner)
    || value.acl.grantable_roles.some((role) => role !== value.identities.migration_owner)) reject("CLUSTER_POLICY_GRANTABLE_ROLE_INVALID");
  const expectedGrantors = [value.identities.migration_owner, "pg_database_owner"].sort();
  if (value.acl.allowed_grantors.length !== expectedGrantors.length
    || value.acl.allowed_grantors.some((role, index) => role !== expectedGrantors[index])) reject("CLUSTER_POLICY_ACL_GRANTORS_INVALID");
  validateAclRuleMap(value.acl.public_allowed_privileges, "CLUSTER_POLICY_PUBLIC_ACL_INVALID");
  validateAclRuleMap(value.acl.non_owner_allowed_privileges, "CLUSTER_POLICY_NON_OWNER_ACL_INVALID");
  if (!value.database.public_connect && value.acl.public_allowed_privileges.DATABASE.includes("CONNECT")) reject("CLUSTER_POLICY_PUBLIC_CONNECT_INVALID");

  validateStringList(value.supported_object_kinds, "CLUSTER_POLICY_OBJECT_KINDS_INVALID");
  const requiredKinds = ["SCHEMA", "TABLE", "PARTITIONED_TABLE", "VIEW", "MATERIALIZED_VIEW", "SEQUENCE", "INDEX_PLACEMENT", "PARTITIONED_INDEX_PLACEMENT", "COLUMN", "ROUTINE", "TYPE", "LARGE_OBJECT"].sort();
  if (value.supported_object_kinds.length !== requiredKinds.length || value.supported_object_kinds.some((kind, index) => kind !== requiredKinds[index])) reject("CLUSTER_POLICY_OBJECT_KINDS_INVALID");
  exactKeys(value.extensions, ["allowed", "required"], "CLUSTER_POLICY_EXTENSIONS_INVALID");
  for (const extension of array(value.extensions.allowed, "CLUSTER_POLICY_EXTENSIONS_INVALID")) {
    exactKeys(extension, ["name", "schema", "owner", "kind"], "CLUSTER_POLICY_EXTENSION_INVALID");
    pgText(extension.name, "CLUSTER_POLICY_EXTENSION_INVALID");
    pgText(extension.schema, "CLUSTER_POLICY_EXTENSION_INVALID");
    pgText(extension.owner, "CLUSTER_POLICY_EXTENSION_INVALID");
    enumValue(extension.kind, EXTENSION_KINDS, "CLUSTER_POLICY_EXTENSION_INVALID");
    if (extension.kind === "APPLICATION" && extension.owner !== value.identities.migration_owner
      || extension.kind === "PLATFORM" && extension.owner !== value.identities.restore_admin) reject("CLUSTER_POLICY_EXTENSION_OWNER_INVALID");
  }
  orderedUnique(value.extensions.allowed, "CLUSTER_POLICY_EXTENSIONS_NOT_CANONICAL", (extension) => extension.name);
  validateStringList(value.extensions.required, "CLUSTER_POLICY_REQUIRED_EXTENSIONS_INVALID");
  if (value.extensions.required.some((name) => !value.extensions.allowed.some((extension) => extension.name === name))) reject("CLUSTER_POLICY_REQUIRED_EXTENSION_NOT_ALLOWED");
  validateStringList(value.unsupported_catalog_counters, "CLUSTER_POLICY_UNSUPPORTED_COUNTERS_INVALID", { exact: [...UNSUPPORTED_COUNTERS] });

  exactKeys(value.tablespaces, ["allow_custom", "maximum_custom", "owner"], "CLUSTER_POLICY_TABLESPACES_INVALID");
  boolean(value.tablespaces.allow_custom, "CLUSTER_POLICY_TABLESPACES_INVALID");
  integer(value.tablespaces.maximum_custom, 0, 64, "CLUSTER_POLICY_TABLESPACES_INVALID");
  pgText(value.tablespaces.owner, "CLUSTER_POLICY_TABLESPACES_INVALID");
  if (value.tablespaces.owner !== value.identities.migration_owner) reject("CLUSTER_POLICY_TABLESPACE_OWNER_INVALID");

  exactKeys(value.credential_binding, ["login_roles", "minimum_password_bytes", "maximum_password_bytes"], "CLUSTER_POLICY_CREDENTIAL_BINDING_INVALID");
  validateStringList(value.credential_binding.login_roles, "CLUSTER_POLICY_CREDENTIAL_ROLES_INVALID");
  integer(value.credential_binding.minimum_password_bytes, 16, 1024, "CLUSTER_POLICY_CREDENTIAL_LIMIT_INVALID");
  integer(value.credential_binding.maximum_password_bytes, value.credential_binding.minimum_password_bytes, 4096, "CLUSTER_POLICY_CREDENTIAL_LIMIT_INVALID");
  const expectedLogins = value.roles.filter((role) => role.intended_login).map((role) => role.name).sort();
  if (value.credential_binding.login_roles.length !== expectedLogins.length
    || value.credential_binding.login_roles.some((role, index) => role !== expectedLogins[index])) reject("CLUSTER_POLICY_CREDENTIAL_ROLES_INVALID");
  return value;
}

export function clusterPolicySha256(policy) {
  return clusterSha256(validateClusterRecoveryPolicy(policy));
}

function validatePrivilegeTuple(value, kind, owner, policy, code) {
  exactKeys(value, ["grantor", "grantee", "privilege_type", "is_grantable"], code);
  pgText(value.grantor, code);
  pgText(value.grantee, code);
  pgText(value.privilege_type, code);
  boolean(value.is_grantable, code);
  if (!KNOWN_PRIVILEGES[kind]?.has(value.privilege_type)) reject("CLUSTER_ACL_PRIVILEGE_UNKNOWN");
  if (!policy.acl.allowed_grantors.includes(value.grantor) || !policy.acl.allowed_grantees.includes(value.grantee)) reject("CLUSTER_ACL_ENDPOINT_NOT_ALLOWED");
  if (value.grantor !== owner) reject("CLUSTER_ACL_GRANTOR_NOT_OWNER");
  if (value.grantor.startsWith("pg_") && value.grantor !== "pg_database_owner") reject("CLUSTER_ACL_BUILTIN_ENDPOINT_FORBIDDEN");
  if (value.grantee.startsWith("pg_") && value.grantee !== "pg_database_owner") reject("CLUSTER_ACL_BUILTIN_ENDPOINT_FORBIDDEN");
  if ((value.grantor === "pg_database_owner" || value.grantee === "pg_database_owner") && owner !== "pg_database_owner") reject("CLUSTER_ACL_DATABASE_OWNER_REFERENCE_INVALID");
  const ownerSemantic = value.grantee === owner || (owner === "pg_database_owner" && value.grantee === "pg_database_owner");
  if (value.is_grantable && (!ownerSemantic || !policy.acl.grantable_roles.includes(value.grantee) && value.grantee !== "pg_database_owner")) reject("CLUSTER_ACL_GRANT_OPTION_FORBIDDEN");
  if (value.grantee === "PUBLIC" && !policy.acl.public_allowed_privileges[kind].includes(value.privilege_type)) reject("CLUSTER_ACL_PUBLIC_PRIVILEGE_FORBIDDEN");
  if (!ownerSemantic && value.grantee !== "PUBLIC" && !policy.acl.non_owner_allowed_privileges[kind].includes(value.privilege_type)) reject("CLUSTER_ACL_NON_OWNER_PRIVILEGE_FORBIDDEN");
  return value;
}

function validateAcl(value, kind, owner, policy, code) {
  exactKeys(value, ["acl_state", "explicit_privileges", "effective_privileges"], code);
  enumValue(value.acl_state, ACL_STATES, code);
  for (const key of ["explicit_privileges", "effective_privileges"]) {
    for (const privilege of array(value[key], code)) validatePrivilegeTuple(privilege, kind, owner, policy, code);
    orderedUnique(value[key], "CLUSTER_ACL_NOT_CANONICAL");
  }
  if (value.acl_state !== "EXPLICIT" && value.explicit_privileges.length !== 0) reject("CLUSTER_ACL_STATE_INVALID");
  if (value.acl_state === "EXPLICIT" && value.explicit_privileges.length === 0) reject("CLUSTER_ACL_STATE_INVALID");
  return value;
}

function validateRoleSnapshot(value, policy) {
  exactKeys(value, ["name", "purpose", "superuser", "inherit", "create_role", "create_database", "can_login", "replication", "connection_limit", "valid_until", "bypass_rls"], "CLUSTER_ROLE_INVALID");
  const expected = policy.roles.find((role) => role.name === value.name);
  if (!expected || value.purpose !== expected.purpose || value.inherit !== expected.inherit
    || value.can_login !== expected.intended_login || value.connection_limit !== expected.connection_limit
    || value.valid_until !== expected.valid_until) reject("CLUSTER_ROLE_POLICY_MISMATCH");
  for (const key of ["superuser", "inherit", "create_role", "create_database", "can_login", "replication", "bypass_rls"]) boolean(value[key], "CLUSTER_ROLE_INVALID");
  integer(value.connection_limit, -1, 10_000, "CLUSTER_ROLE_INVALID");
  nullableIso(value.valid_until, "CLUSTER_ROLE_INVALID");
  if (value.superuser || value.create_role || value.create_database || value.replication || value.bypass_rls) reject("CLUSTER_ROLE_DANGEROUS_ATTRIBUTE");
  return value;
}

function validateDatabase(value, policy) {
  exactKeys(value, ["name", "owner", "default_tablespace", "allow_connect", "connection_limit", "acl_state", "explicit_privileges", "effective_privileges"], "CLUSTER_DATABASE_INVALID");
  pgText(value.name, "CLUSTER_DATABASE_INVALID");
  pgText(value.owner, "CLUSTER_DATABASE_INVALID");
  pgText(value.default_tablespace, "CLUSTER_DATABASE_INVALID");
  boolean(value.allow_connect, "CLUSTER_DATABASE_INVALID");
  integer(value.connection_limit, -1, 10_000, "CLUSTER_DATABASE_INVALID");
  if (value.name !== policy.database.name || value.owner !== policy.database.owner
    || value.default_tablespace !== policy.database.default_tablespace || value.allow_connect !== policy.database.allow_connect
    || value.connection_limit !== policy.database.connection_limit) reject("CLUSTER_DATABASE_POLICY_MISMATCH");
  validateAcl({ acl_state: value.acl_state, explicit_privileges: value.explicit_privileges, effective_privileges: value.effective_privileges }, "DATABASE", value.owner, policy, "CLUSTER_DATABASE_ACL_INVALID");
  const publicConnect = value.effective_privileges.some((item) => item.grantee === "PUBLIC" && item.privilege_type === "CONNECT");
  if (publicConnect !== policy.database.public_connect) reject("CLUSTER_DATABASE_PUBLIC_CONNECT_MISMATCH");
  return value;
}

function validateObject(value, policy) {
  exactKeys(value, ["kind", "schema", "name", "identity_arguments", "parent_identity", "owner", "tablespace", "extension", "acl_state", "explicit_privileges", "effective_privileges"], "CLUSTER_OBJECT_INVALID");
  if (!policy.supported_object_kinds.includes(value.kind)) reject("CLUSTER_OBJECT_KIND_UNSUPPORTED");
  nullableString(value.schema, "CLUSTER_OBJECT_INVALID");
  pgText(value.name, "CLUSTER_OBJECT_INVALID");
  nullableString(value.parent_identity, "CLUSTER_OBJECT_INVALID");
  pgText(value.owner, "CLUSTER_OBJECT_INVALID");
  nullableString(value.tablespace, "CLUSTER_OBJECT_INVALID");
  nullableString(value.extension, "CLUSTER_OBJECT_INVALID");
  const publicSchema = value.kind === "SCHEMA" && value.name === "public";
  const expectedOwner = publicSchema ? "pg_database_owner" : policy.identities.migration_owner;
  if (value.owner !== expectedOwner || value.owner === policy.identities.runtime_login) reject("CLUSTER_OBJECT_OWNER_POLICY_MISMATCH");
  if (value.kind === "SCHEMA" && value.schema !== null || value.kind !== "SCHEMA" && value.schema === null && value.kind !== "LARGE_OBJECT") reject("CLUSTER_OBJECT_IDENTITY_INVALID");
  if (value.kind === "ROUTINE") {
    if (!Array.isArray(value.identity_arguments) || value.identity_arguments.length > 100) reject("CLUSTER_OBJECT_ROUTINE_IDENTITY_INVALID");
    for (const argument of value.identity_arguments) {
      exactKeys(argument, ["schema", "name"], "CLUSTER_OBJECT_ROUTINE_IDENTITY_INVALID");
      pgText(argument.schema, "CLUSTER_OBJECT_ROUTINE_IDENTITY_INVALID");
      pgText(argument.name, "CLUSTER_OBJECT_ROUTINE_IDENTITY_INVALID");
    }
  } else if (value.identity_arguments !== null) reject("CLUSTER_OBJECT_ROUTINE_IDENTITY_INVALID");
  if ((value.kind === "COLUMN" || INDEX_KINDS.has(value.kind)) !== (value.parent_identity !== null)) reject("CLUSTER_OBJECT_PARENT_IDENTITY_INVALID");
  if (value.kind === "LARGE_OBJECT" && !/^lo:[1-9][0-9]{0,19}$/u.test(value.name)) reject("CLUSTER_OBJECT_LARGE_OBJECT_IDENTITY_INVALID");
  if (INDEX_KINDS.has(value.kind)) {
    if (value.acl_state !== "NULL" || value.explicit_privileges.length !== 0 || value.effective_privileges.length !== 0) reject("CLUSTER_INDEX_ACL_INVALID");
  } else {
    validateAcl({ acl_state: value.acl_state, explicit_privileges: value.explicit_privileges, effective_privileges: value.effective_privileges }, value.kind, value.owner, policy, "CLUSTER_OBJECT_ACL_INVALID");
  }
  return value;
}

function validateDefaultPrivilege(value, policy) {
  exactKeys(value, ["owner", "schema", "object_kind", "acl_state", "explicit_privileges", "effective_privileges"], "CLUSTER_DEFAULT_PRIVILEGE_INVALID");
  if (value.owner !== policy.identities.migration_owner) reject("CLUSTER_DEFAULT_PRIVILEGE_OWNER_INVALID");
  nullableString(value.schema, "CLUSTER_DEFAULT_PRIVILEGE_INVALID");
  if (!new Set(["TABLE", "SEQUENCE", "ROUTINE", "TYPE", "SCHEMA", "LARGE_OBJECT"]).has(value.object_kind)) reject("CLUSTER_DEFAULT_PRIVILEGE_KIND_INVALID");
  validateAcl({ acl_state: value.acl_state, explicit_privileges: value.explicit_privileges, effective_privileges: value.effective_privileges }, value.object_kind, value.owner, policy, "CLUSTER_DEFAULT_PRIVILEGE_ACL_INVALID");
  return value;
}

function validateTablespace(value, policy) {
  exactKeys(value, ["name", "owner", "options", "source_location_sha256", "acl_state", "explicit_privileges", "effective_privileges"], "CLUSTER_TABLESPACE_INVALID");
  pgText(value.name, "CLUSTER_TABLESPACE_INVALID");
  if (new Set(["pg_default", "pg_global"]).has(value.name) || value.name.startsWith("pg_")) reject("CLUSTER_TABLESPACE_NAME_FORBIDDEN");
  if (!policy.tablespaces.allow_custom || value.owner !== policy.tablespaces.owner) reject("CLUSTER_TABLESPACE_POLICY_MISMATCH");
  validateStringList(value.options, "CLUSTER_TABLESPACE_OPTIONS_INVALID");
  if (value.options.length !== 0) reject("CLUSTER_TABLESPACE_OPTIONS_UNSUPPORTED");
  string(value.source_location_sha256, SHA256, "CLUSTER_TABLESPACE_LOCATION_SHA256_INVALID");
  validateAcl({ acl_state: value.acl_state, explicit_privileges: value.explicit_privileges, effective_privileges: value.effective_privileges }, "TABLESPACE", value.owner, policy, "CLUSTER_TABLESPACE_ACL_INVALID");
  return value;
}

function validateExtension(value, policy) {
  exactKeys(value, ["name", "version", "schema", "owner", "member_fingerprint"], "CLUSTER_EXTENSION_INVALID");
  pgText(value.name, "CLUSTER_EXTENSION_INVALID");
  pgText(value.version, "CLUSTER_EXTENSION_INVALID");
  pgText(value.schema, "CLUSTER_EXTENSION_INVALID");
  const expected = policy.extensions.allowed.find((extension) => extension.name === value.name);
  if (!expected || value.owner !== expected.owner || value.schema !== expected.schema) reject("CLUSTER_EXTENSION_POLICY_MISMATCH");
  string(value.member_fingerprint, SHA256, "CLUSTER_EXTENSION_FINGERPRINT_INVALID");
  return value;
}

function validatePublication(value, policy) {
  exactKeys(value, ["name", "owner", "all_tables", "publish_insert", "publish_update", "publish_delete", "publish_truncate", "publish_via_partition_root", "table_fingerprint"], "CLUSTER_PUBLICATION_INVALID");
  pgText(value.name, "CLUSTER_PUBLICATION_INVALID");
  if (value.owner !== policy.identities.migration_owner) reject("CLUSTER_PUBLICATION_OWNER_INVALID");
  for (const key of ["all_tables", "publish_insert", "publish_update", "publish_delete", "publish_truncate", "publish_via_partition_root"]) boolean(value[key], "CLUSTER_PUBLICATION_INVALID");
  string(value.table_fingerprint, SHA256, "CLUSTER_PUBLICATION_FINGERPRINT_INVALID");
  return value;
}

function validateParameterPrivilege(value, policy) {
  exactKeys(value, ["parameter", "grantor", "grantee", "privilege_type", "is_grantable"], "CLUSTER_PARAMETER_ACL_INVALID");
  pgText(value.parameter, "CLUSTER_PARAMETER_ACL_INVALID");
  validatePrivilegeTuple({ grantor: value.grantor, grantee: value.grantee, privilege_type: value.privilege_type, is_grantable: value.is_grantable }, "TYPE", policy.identities.migration_owner, policy, "CLUSTER_PARAMETER_ACL_INVALID");
  reject("CLUSTER_PARAMETER_ACL_UNSUPPORTED");
}

export function normalizeClusterCatalog(value) {
  const source = canonicalClone(record(value, "CLUSTER_CATALOG_INVALID"));
  for (const aclContainer of [source.database, ...(source.objects || []), ...(source.default_privileges || []), ...(source.tablespaces || [])]) {
    if (!aclContainer || !Array.isArray(aclContainer.explicit_privileges) || !Array.isArray(aclContainer.effective_privileges)) reject("CLUSTER_CATALOG_INVALID");
    aclContainer.explicit_privileges = normalizeArray(aclContainer.explicit_privileges);
    aclContainer.effective_privileges = normalizeArray(aclContainer.effective_privileges);
  }
  for (const tablespace of source.tablespaces || []) {
    if (!Array.isArray(tablespace.options)) reject("CLUSTER_CATALOG_INVALID");
    tablespace.options = [...tablespace.options].sort();
  }
  for (const key of ["roles", "memberships", "settings", "objects", "default_privileges", "tablespaces", "extensions", "publications", "parameter_privileges"]) {
    if (!Array.isArray(source[key])) reject("CLUSTER_CATALOG_INVALID");
  }
  const compareName = (left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  source.roles = [...source.roles].sort(compareName);
  source.memberships = normalizeArray(source.memberships);
  source.settings = normalizeArray(source.settings);
  source.objects = normalizeArray(source.objects);
  source.default_privileges = normalizeArray(source.default_privileges);
  source.tablespaces = [...source.tablespaces].sort(compareName);
  source.extensions = [...source.extensions].sort(compareName);
  source.publications = [...source.publications].sort(compareName);
  source.parameter_privileges = normalizeArray(source.parameter_privileges);
  return source;
}

export function validateClusterCatalog(value, policyInput) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  exactKeys(value, ["database", "roles", "memberships", "settings", "objects", "default_privileges", "tablespaces", "extensions", "publications", "parameter_privileges", "unsupported"], "CLUSTER_CATALOG_INVALID");
  validateDatabase(value.database, policy);
  for (const role of array(value.roles, "CLUSTER_ROLES_INVALID")) validateRoleSnapshot(role, policy);
  orderedUnique(value.roles, "CLUSTER_ROLES_NOT_CANONICAL", (role) => role.name);
  if (value.roles.length !== policy.roles.length || value.roles.some((role, index) => role.name !== policy.roles[index].name)) reject("CLUSTER_ROLE_SET_MISMATCH");
  for (const membership of array(value.memberships, "CLUSTER_MEMBERSHIPS_INVALID")) validateMembership(membership);
  orderedUnique(value.memberships, "CLUSTER_MEMBERSHIPS_NOT_CANONICAL");
  if (canonicalClusterJson(value.memberships) !== canonicalClusterJson(policy.memberships)) reject("CLUSTER_MEMBERSHIP_POLICY_MISMATCH");
  for (const setting of array(value.settings, "CLUSTER_SETTINGS_INVALID")) validateSetting(setting, policy);
  orderedUnique(value.settings, "CLUSTER_SETTINGS_NOT_CANONICAL");
  if (canonicalClusterJson(value.settings) !== canonicalClusterJson(policy.settings.required)) reject("CLUSTER_SETTING_POLICY_MISMATCH");
  if (value.settings.some((setting) => setting.role_scope === policy.identities.migration_owner)) reject("CLUSTER_MIGRATION_OWNER_SETTING_FORBIDDEN");
  for (const objectValue of array(value.objects, "CLUSTER_OBJECTS_INVALID")) validateObject(objectValue, policy);
  orderedUnique(value.objects, "CLUSTER_OBJECTS_NOT_CANONICAL");
  for (const privilege of array(value.default_privileges, "CLUSTER_DEFAULT_PRIVILEGES_INVALID")) validateDefaultPrivilege(privilege, policy);
  orderedUnique(value.default_privileges, "CLUSTER_DEFAULT_PRIVILEGES_NOT_CANONICAL");
  for (const tablespace of array(value.tablespaces, "CLUSTER_TABLESPACES_INVALID")) validateTablespace(tablespace, policy);
  orderedUnique(value.tablespaces, "CLUSTER_TABLESPACES_NOT_CANONICAL", (item) => item.name);
  if (value.tablespaces.length > policy.tablespaces.maximum_custom) reject("CLUSTER_TABLESPACE_LIMIT_EXCEEDED");
  for (const extension of array(value.extensions, "CLUSTER_EXTENSIONS_INVALID")) validateExtension(extension, policy);
  orderedUnique(value.extensions, "CLUSTER_EXTENSIONS_NOT_CANONICAL", (item) => item.name);
  if (policy.extensions.required.some((name) => !value.extensions.some((extension) => extension.name === name))) reject("CLUSTER_REQUIRED_EXTENSION_MISSING");
  for (const publication of array(value.publications, "CLUSTER_PUBLICATIONS_INVALID")) validatePublication(publication, policy);
  orderedUnique(value.publications, "CLUSTER_PUBLICATIONS_NOT_CANONICAL", (item) => item.name);
  for (const parameterPrivilege of array(value.parameter_privileges, "CLUSTER_PARAMETER_ACL_INVALID")) validateParameterPrivilege(parameterPrivilege, policy);
  if (value.parameter_privileges.length !== 0) reject("CLUSTER_PARAMETER_ACL_UNSUPPORTED");
  exactKeys(value.unsupported, policy.unsupported_catalog_counters, "CLUSTER_UNSUPPORTED_COUNTERS_INVALID");
  for (const counter of policy.unsupported_catalog_counters) if (integer(value.unsupported[counter], 0, Number.MAX_SAFE_INTEGER, "CLUSTER_UNSUPPORTED_COUNTER_INVALID") !== 0) reject("CLUSTER_UNSUPPORTED_CATALOG_PRESENT");
  return value;
}

export function clusterCatalogSha256(catalog, policy) {
  return clusterSha256(validateClusterCatalog(catalog, policy));
}

export function compareClusterCatalogCaptures(beforeInput, afterInput, policy) {
  const before = normalizeClusterCatalog(beforeInput);
  const after = normalizeClusterCatalog(afterInput);
  validateClusterCatalog(before, policy);
  validateClusterCatalog(after, policy);
  const beforeSha256 = clusterSha256(before);
  const afterSha256 = clusterSha256(after);
  if (beforeSha256 !== afterSha256) reject("CLUSTER_CATALOG_DRIFT");
  return Object.freeze({ catalog: before, catalogSha256: beforeSha256 });
}

function validateSnapshotBinding(value, policy) {
  exactKeys(value, ["backup_id", "manifest_sha256", "local_receipt_sha256", "recovery_point_at", "source", "application"], "CLUSTER_SNAPSHOT_BINDING_INVALID");
  string(value.backup_id, IDENTIFIER, "CLUSTER_SNAPSHOT_BACKUP_ID_INVALID");
  string(value.manifest_sha256, SHA256, "CLUSTER_SNAPSHOT_MANIFEST_SHA256_INVALID");
  string(value.local_receipt_sha256, SHA256, "CLUSTER_SNAPSHOT_RECEIPT_SHA256_INVALID");
  iso(value.recovery_point_at, "CLUSTER_SNAPSHOT_RECOVERY_POINT_INVALID");
  exactKeys(value.source, ["system_identifier", "database_oid", "database_marker", "postgresql_major"], "CLUSTER_SNAPSHOT_SOURCE_INVALID");
  string(value.source.system_identifier, DECIMAL, "CLUSTER_SNAPSHOT_SYSTEM_IDENTIFIER_INVALID");
  string(value.source.database_oid, DECIMAL, "CLUSTER_SNAPSHOT_DATABASE_OID_INVALID");
  string(value.source.database_marker, IDENTIFIER, "CLUSTER_SNAPSHOT_DATABASE_MARKER_INVALID");
  if (value.source.postgresql_major !== policy.postgresql_major) reject("CLUSTER_SNAPSHOT_POSTGRESQL_MAJOR_MISMATCH");
  exactKeys(value.application, ["git_commit", "version", "migration_head", "migration_manifest_sha256"], "CLUSTER_SNAPSHOT_APPLICATION_INVALID");
  string(value.application.git_commit, GIT_SHA, "CLUSTER_SNAPSHOT_GIT_COMMIT_INVALID");
  string(value.application.version, VERSION, "CLUSTER_SNAPSHOT_VERSION_INVALID");
  string(value.application.migration_head, MIGRATION, "CLUSTER_SNAPSHOT_MIGRATION_HEAD_INVALID");
  string(value.application.migration_manifest_sha256, SHA256, "CLUSTER_SNAPSHOT_MIGRATION_MANIFEST_INVALID");
  return value;
}

export function createClusterSnapshot({ snapshotId, capturedAt, binding, policy: policyInput, beforeCatalog, afterCatalog }) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  string(snapshotId, IDENTIFIER, "CLUSTER_SNAPSHOT_ID_INVALID");
  iso(capturedAt, "CLUSTER_SNAPSHOT_CAPTURED_AT_INVALID");
  validateSnapshotBinding(binding, policy);
  const compared = compareClusterCatalogCaptures(beforeCatalog, afterCatalog, policy);
  const body = {
    schema_version: 1,
    contract: CLUSTER_SNAPSHOT_CONTRACT,
    snapshot_id: snapshotId,
    captured_at: capturedAt,
    policy_id: policy.policy_id,
    policy_sha256: clusterPolicySha256(policy),
    binding: canonicalClone(binding),
    catalog: compared.catalog,
    catalog_sha256: compared.catalogSha256,
  };
  return validateClusterSnapshot({ ...body, snapshot_sha256: clusterSha256(body) }, policy);
}

export function validateClusterSnapshot(value, policyInput) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  exactKeys(value, ["schema_version", "contract", "snapshot_id", "captured_at", "policy_id", "policy_sha256", "binding", "catalog", "catalog_sha256", "snapshot_sha256"], "CLUSTER_SNAPSHOT_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_SNAPSHOT_CONTRACT) reject("CLUSTER_SNAPSHOT_CONTRACT_INVALID");
  string(value.snapshot_id, IDENTIFIER, "CLUSTER_SNAPSHOT_ID_INVALID");
  iso(value.captured_at, "CLUSTER_SNAPSHOT_CAPTURED_AT_INVALID");
  if (value.policy_id !== policy.policy_id || value.policy_sha256 !== clusterPolicySha256(policy)) reject("CLUSTER_SNAPSHOT_POLICY_MISMATCH");
  validateSnapshotBinding(value.binding, policy);
  validateClusterCatalog(value.catalog, policy);
  if (value.catalog_sha256 !== clusterSha256(value.catalog)) reject("CLUSTER_SNAPSHOT_CATALOG_SHA256_MISMATCH");
  string(value.snapshot_sha256, SHA256, "CLUSTER_SNAPSHOT_SHA256_INVALID");
  const body = withoutKeys(value, ["snapshot_sha256"]);
  if (value.snapshot_sha256 !== clusterSha256(body)) reject("CLUSTER_SNAPSHOT_SHA256_MISMATCH");
  return value;
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return isInside(left, right) || isInside(right, left);
}

async function noFollowPathComponents(target, { syntheticTmpAllowed = false, code = "PATH_UNSAFE" } = {}) {
  const resolved = path.resolve(target);
  if (!path.isAbsolute(target) || resolved === path.parse(resolved).root) reject(code);
  const root = path.parse(resolved).root;
  const relative = path.relative(root, resolved);
  let current = root;
  const results = [];
  const rootMetadata = await lstat(root).catch(() => reject(code));
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) reject(code);
  results.push({ path: root, metadata: rootMetadata });
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = await lstat(current).catch(() => reject(code));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) reject(code);
    const stickyTmpException = syntheticTmpAllowed && path.resolve(current) === path.resolve(os.tmpdir()) && (metadata.mode & 0o1000) !== 0;
    if ((metadata.mode & 0o022) !== 0 && !stickyTmpException) reject(code);
    results.push({ path: current, metadata });
  }
  return results;
}

async function revalidatePathComponents(components, code) {
  for (const component of components) {
    const current = await lstat(component.path).catch(() => reject(code));
    if (!current.isDirectory() || current.isSymbolicLink()) reject(code);
    for (const key of ["dev", "ino", "uid", "gid", "mode"]) if (current[key] !== component.metadata[key]) reject(code);
  }
}

function pathIdentity(metadata) {
  return `${metadata.dev}:${metadata.ino}:${metadata.uid}:${metadata.gid}:${metadata.mode & 0o7777}`;
}

function validateMapDocument(value, snapshot, expectedScope) {
  exactKeys(value, ["schema_version", "contract", "map_id", "snapshot_sha256", "evidence_scope", "approved_host_root", "approved_server_root", "namespace_identity_sha256", "entries"], "TABLESPACE_MAP_INVALID");
  if (value.schema_version !== 1 || value.contract !== TABLESPACE_MAP_CONTRACT) reject("TABLESPACE_MAP_CONTRACT_INVALID");
  string(value.map_id, IDENTIFIER, "TABLESPACE_MAP_ID_INVALID");
  if (value.snapshot_sha256 !== snapshot.snapshot_sha256) reject("TABLESPACE_MAP_SNAPSHOT_MISMATCH");
  if (value.evidence_scope !== expectedScope) reject("TABLESPACE_MAP_SCOPE_MISMATCH");
  enumValue(value.evidence_scope, EVIDENCE_SCOPES, "TABLESPACE_MAP_SCOPE_INVALID");
  if (!path.isAbsolute(value.approved_host_root) || !path.isAbsolute(value.approved_server_root)) reject("TABLESPACE_MAP_ROOT_INVALID");
  string(value.namespace_identity_sha256, SHA256, "TABLESPACE_NAMESPACE_IDENTITY_INVALID");
  for (const entry of array(value.entries, "TABLESPACE_MAP_ENTRIES_INVALID")) {
    exactKeys(entry, ["name", "host_path", "server_path"], "TABLESPACE_MAP_ENTRY_INVALID");
    pgText(entry.name, "TABLESPACE_MAP_ENTRY_INVALID");
    if (!path.isAbsolute(entry.host_path) || !path.isAbsolute(entry.server_path)) reject("TABLESPACE_MAP_ENTRY_PATH_INVALID");
  }
  orderedUnique(value.entries, "TABLESPACE_MAP_ENTRIES_NOT_CANONICAL", (entry) => entry.name);
  return value;
}

export function validateTablespaceMapDocument({ map: mapInput, snapshot: snapshotInput, policy: policyInput, evidenceScope = "SYNTHETIC_TEST_ONLY" }) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  const map = validateMapDocument(mapInput, snapshot, evidenceScope);
  const expectedNames = snapshot.catalog.tablespaces.map((item) => item.name);
  if (map.entries.length !== expectedNames.length || map.entries.some((entry, index) => entry.name !== expectedNames[index])) reject("TABLESPACE_MAP_NAME_SET_MISMATCH");
  return map;
}

export async function validateTablespaceMap({
  map: mapInput,
  snapshot: snapshotInput,
  policy: policyInput,
  expectedUid,
  expectedGid,
  prohibitedRoots = [],
  expectedNamespaceIdentitySha256,
  evidenceScope = "SYNTHETIC_TEST_ONLY",
}) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  const map = validateTablespaceMapDocument({ map: mapInput, snapshot, policy, evidenceScope });
  integer(expectedUid, 0, 2 ** 31 - 1, "TABLESPACE_EXPECTED_UID_INVALID");
  integer(expectedGid, 0, 2 ** 31 - 1, "TABLESPACE_EXPECTED_GID_INVALID");
  if (!Array.isArray(prohibitedRoots) || prohibitedRoots.some((root) => typeof root !== "string" || !path.isAbsolute(root))) reject("TABLESPACE_PROHIBITED_ROOT_INVALID");
  string(expectedNamespaceIdentitySha256, SHA256, "TABLESPACE_NAMESPACE_IDENTITY_INVALID");
  if (map.namespace_identity_sha256 !== expectedNamespaceIdentitySha256) reject("TABLESPACE_NAMESPACE_IDENTITY_MISMATCH");
  const synthetic = evidenceScope === "SYNTHETIC_TEST_ONLY";
  if (!synthetic && (process.getuid?.() !== 0 || isInside(map.approved_host_root, os.tmpdir()))) reject("TABLESPACE_ACTUAL_ROOT_REQUIRED");

  const hostRoot = path.resolve(map.approved_host_root);
  const serverRoot = path.resolve(map.approved_server_root);
  const rootComponents = await noFollowPathComponents(hostRoot, { syntheticTmpAllowed: synthetic, code: "TABLESPACE_ROOT_UNSAFE" });
  const rootMetadata = rootComponents.at(-1).metadata;
  if (rootMetadata.uid !== expectedUid || rootMetadata.gid !== expectedGid || (rootMetadata.mode & 0o777) !== 0o700) reject("TABLESPACE_ROOT_IDENTITY_MISMATCH");
  if (await realpath(hostRoot) !== hostRoot) reject("TABLESPACE_ROOT_REALPATH_MISMATCH");
  for (const prohibitedRoot of prohibitedRoots.map((item) => path.resolve(item))) if (pathsOverlap(hostRoot, prohibitedRoot)) reject("TABLESPACE_ROOT_PROHIBITED");

  const seenRealpaths = new Set();
  const identities = [];
  for (const entry of map.entries) {
    const hostPath = path.resolve(entry.host_path);
    const serverPath = path.resolve(entry.server_path);
    if (path.dirname(hostPath) !== hostRoot || path.dirname(serverPath) !== serverRoot
      || path.basename(hostPath) !== entry.name || path.basename(serverPath) !== entry.name) reject("TABLESPACE_MAP_ENTRY_BOUNDARY_INVALID");
    for (const prohibitedRoot of prohibitedRoots.map((item) => path.resolve(item))) if (pathsOverlap(hostPath, prohibitedRoot)) reject("TABLESPACE_PATH_PROHIBITED");
    const components = await noFollowPathComponents(hostPath, { syntheticTmpAllowed: synthetic, code: "TABLESPACE_PATH_UNSAFE" });
    const metadata = components.at(-1).metadata;
    if (metadata.uid !== expectedUid || metadata.gid !== expectedGid || (metadata.mode & 0o777) !== 0o700) reject("TABLESPACE_PATH_IDENTITY_MISMATCH");
    if ((await readdir(hostPath)).length !== 0) reject("TABLESPACE_PATH_NOT_EMPTY");
    const resolvedRealpath = await realpath(hostPath);
    if (resolvedRealpath !== hostPath || seenRealpaths.has(resolvedRealpath)) reject("TABLESPACE_PATH_ALIAS");
    await revalidatePathComponents(components, "TABLESPACE_PATH_CHANGED");
    for (const existing of seenRealpaths) if (pathsOverlap(existing, resolvedRealpath)) reject("TABLESPACE_PATH_OVERLAP");
    seenRealpaths.add(resolvedRealpath);
    identities.push({
      name: entry.name,
      host_identity_sha256: clusterSha256(pathIdentity(metadata)),
      server_path_sha256: clusterSha256(serverPath),
    });
  }
  await revalidatePathComponents(rootComponents, "TABLESPACE_ROOT_CHANGED");
  const entrySetSha256 = clusterSha256(identities);
  return Object.freeze({
    phase: "PREFLIGHT_EMPTY",
    evidenceScope,
    mapId: map.map_id,
    mapSha256: clusterSha256(map),
    namespaceIdentitySha256: map.namespace_identity_sha256,
    entryCount: identities.length,
    entrySetSha256,
    identities: Object.freeze(identities.map((item) => Object.freeze(item))),
    rootIdentitySha256: clusterSha256(pathIdentity(rootMetadata)),
  });
}

export async function verifyTablespaceMapAfterCreate({
  map: mapInput,
  snapshot: snapshotInput,
  policy: policyInput,
  preflightValidation,
  targetCatalog: targetCatalogInput,
  expectedUid,
  expectedGid,
  prohibitedRoots = [],
  expectedNamespaceIdentitySha256,
  evidenceScope = "SYNTHETIC_TEST_ONLY",
}) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  const map = validateTablespaceMapDocument({ map: mapInput, snapshot, policy, evidenceScope });
  integer(expectedUid, 0, 2 ** 31 - 1, "TABLESPACE_EXPECTED_UID_INVALID");
  integer(expectedGid, 0, 2 ** 31 - 1, "TABLESPACE_EXPECTED_GID_INVALID");
  if (!Array.isArray(prohibitedRoots) || prohibitedRoots.some((root) => typeof root !== "string" || !path.isAbsolute(root))) reject("TABLESPACE_PROHIBITED_ROOT_INVALID");
  string(expectedNamespaceIdentitySha256, SHA256, "TABLESPACE_NAMESPACE_IDENTITY_INVALID");
  if (!preflightValidation || preflightValidation.phase !== "PREFLIGHT_EMPTY" || preflightValidation.evidenceScope !== evidenceScope
    || preflightValidation.mapId !== map.map_id || preflightValidation.mapSha256 !== clusterSha256(map)
    || preflightValidation.namespaceIdentitySha256 !== expectedNamespaceIdentitySha256
    || preflightValidation.entryCount !== map.entries.length || !Array.isArray(preflightValidation.identities)
    || preflightValidation.identities.length !== map.entries.length) reject("TABLESPACE_PREFLIGHT_BINDING_INVALID");
  const targetCatalog = normalizeClusterCatalog(targetCatalogInput);
  validateClusterCatalog(targetCatalog, policy);
  if (targetCatalog.tablespaces.length !== map.entries.length) reject("TABLESPACE_TARGET_CATALOG_MISMATCH");
  const synthetic = evidenceScope === "SYNTHETIC_TEST_ONLY";
  if (!synthetic && (process.getuid?.() !== 0 || isInside(map.approved_host_root, os.tmpdir()))) reject("TABLESPACE_ACTUAL_ROOT_REQUIRED");
  const hostRoot = path.resolve(map.approved_host_root);
  const serverRoot = path.resolve(map.approved_server_root);
  const prohibited = prohibitedRoots.map((item) => path.resolve(item));
  const rootComponents = await noFollowPathComponents(hostRoot, { syntheticTmpAllowed: synthetic, code: "TABLESPACE_ROOT_UNSAFE" });
  const rootMetadata = rootComponents.at(-1).metadata;
  if (rootMetadata.uid !== expectedUid || rootMetadata.gid !== expectedGid || (rootMetadata.mode & 0o777) !== 0o700
    || clusterSha256(pathIdentity(rootMetadata)) !== preflightValidation.rootIdentitySha256 || await realpath(hostRoot) !== hostRoot) reject("TABLESPACE_ROOT_CHANGED");
  for (const prohibitedRoot of prohibited) if (pathsOverlap(hostRoot, prohibitedRoot)) reject("TABLESPACE_ROOT_PROHIBITED");
  const postCreateIdentities = [];
  for (const [index, entry] of map.entries.entries()) {
    const hostPath = path.resolve(entry.host_path), serverPath = path.resolve(entry.server_path);
    if (path.dirname(hostPath) !== hostRoot || path.dirname(serverPath) !== serverRoot
      || path.basename(hostPath) !== entry.name || path.basename(serverPath) !== entry.name) reject("TABLESPACE_MAP_ENTRY_BOUNDARY_INVALID");
    for (const prohibitedRoot of prohibited) if (pathsOverlap(hostPath, prohibitedRoot)) reject("TABLESPACE_PATH_PROHIBITED");
    const components = await noFollowPathComponents(hostPath, { syntheticTmpAllowed: synthetic, code: "TABLESPACE_PATH_UNSAFE" });
    const metadata = components.at(-1).metadata;
    const identity = preflightValidation.identities[index];
    const targetTablespace = targetCatalog.tablespaces[index];
    if (metadata.uid !== expectedUid || metadata.gid !== expectedGid || (metadata.mode & 0o777) !== 0o700
      || await realpath(hostPath) !== hostPath || (await readdir(hostPath)).length === 0
      || identity.name !== entry.name || identity.host_identity_sha256 !== clusterSha256(pathIdentity(metadata))
      || identity.server_path_sha256 !== clusterSha256(serverPath) || targetTablespace.name !== entry.name
      || targetTablespace.source_location_sha256 !== clusterSha256(serverPath)) reject("TABLESPACE_POST_CREATE_IDENTITY_MISMATCH");
    await revalidatePathComponents(components, "TABLESPACE_PATH_CHANGED");
    postCreateIdentities.push({ name: entry.name, host_identity_sha256: identity.host_identity_sha256, server_path_sha256: identity.server_path_sha256, target_location_sha256: targetTablespace.source_location_sha256 });
  }
  await revalidatePathComponents(rootComponents, "TABLESPACE_ROOT_CHANGED");
  return Object.freeze({
    ...preflightValidation,
    phase: "POST_CREATE_VERIFIED",
    targetTablespaceCatalogSha256: clusterSha256(targetCatalog.tablespaces),
    postCreateEntrySetSha256: clusterSha256(postCreateIdentities),
  });
}

async function readStableFile(file, { maxBytes, expectedUid, allowedModes, code }) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== expectedUid || !allowedModes.includes(before.mode & 0o777)
      || before.size <= 0 || before.size > maxBytes) reject(code);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pointed = await lstat(file).catch(() => reject("FILE_CHANGED_DURING_READ"));
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "uid", "gid", "mode", "nlink"]) {
      if (before[key] !== after[key] || after[key] !== pointed[key]) reject("FILE_CHANGED_DURING_READ");
    }
    return { bytes, metadata: after };
  } finally {
    await handle.close();
  }
}

async function validatePrivateRoot(rootInput, markerName, markerValue, { syntheticTmpAllowed, expectedUid, code }) {
  const root = path.resolve(rootInput);
  if (!syntheticTmpAllowed && isInside(root, os.tmpdir())) reject(code);
  const components = await noFollowPathComponents(root, { syntheticTmpAllowed, code });
  const metadata = components.at(-1).metadata;
  if (metadata.uid !== expectedUid || (metadata.mode & 0o777) !== 0o700 || await realpath(root) !== root) reject(code);
  if (components.some((component) => component.metadata.uid !== 0 && component.metadata.uid !== expectedUid)) reject(code);
  const marker = path.join(root, markerName);
  const markerRecord = await readStableFile(marker, { maxBytes: 256, expectedUid, allowedModes: [0o400], code });
  if (markerRecord.bytes.toString("utf8") !== markerValue) reject(code);
  await revalidatePathComponents(components, code);
  return { root, metadata };
}

export async function readCredentialBindingFile({ credentialRoot, credentialFile, policy: policyInput, evidenceScope = "SYNTHETIC_TEST_ONLY" }) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  enumValue(evidenceScope, EVIDENCE_SCOPES, "CREDENTIAL_SCOPE_INVALID");
  const synthetic = evidenceScope === "SYNTHETIC_TEST_ONLY";
  if (!synthetic && process.getuid?.() !== 0) reject("CREDENTIAL_ROOT_PRIVILEGE_REQUIRED");
  const root = await validatePrivateRoot(credentialRoot, CREDENTIAL_ROOT_MARKER, CREDENTIAL_ROOT_MARKER_VALUE, {
    syntheticTmpAllowed: synthetic,
    expectedUid: 0,
    code: "CREDENTIAL_ROOT_UNSAFE",
  });
  const file = path.resolve(credentialFile);
  if (path.dirname(file) !== root.root) reject("CREDENTIAL_FILE_BOUNDARY_INVALID");
  const loaded = await readStableFile(file, { maxBytes: 64 * 1024, expectedUid: 0, allowedModes: [0o400, 0o600], code: "CREDENTIAL_FILE_UNSAFE" });
  let parsed;
  try {
    parsed = parseStrictJson(loaded.bytes.toString("utf8"));
  } catch (error) {
    if (error?.code === "JSON_DUPLICATE_KEY") reject("CREDENTIAL_FILE_DUPLICATE_KEY");
    reject("CREDENTIAL_FILE_JSON_INVALID");
  }
  if (loaded.bytes.toString("utf8") !== canonicalClusterJson(parsed)) reject("CREDENTIAL_FILE_NOT_CANONICAL");
  exactKeys(parsed, ["schema_version", "contract", "credential_generation_id", "roles"], "CREDENTIAL_FILE_INVALID");
  if (parsed.schema_version !== 1 || parsed.contract !== CREDENTIAL_FILE_CONTRACT) reject("CREDENTIAL_FILE_CONTRACT_INVALID");
  string(parsed.credential_generation_id, IDENTIFIER, "CREDENTIAL_GENERATION_ID_INVALID");
  const secrets = new Map();
  for (const entry of array(parsed.roles, "CREDENTIAL_ROLES_INVALID")) {
    exactKeys(entry, ["role", "password"], "CREDENTIAL_ROLE_INVALID");
    pgText(entry.role, "CREDENTIAL_ROLE_INVALID");
    if (typeof entry.password !== "string" || /[\u0000\r\n]/u.test(entry.password)) reject("CREDENTIAL_PASSWORD_INVALID");
    const passwordBytes = Buffer.byteLength(entry.password, "utf8");
    if (passwordBytes < policy.credential_binding.minimum_password_bytes || passwordBytes > policy.credential_binding.maximum_password_bytes) reject("CREDENTIAL_PASSWORD_LENGTH_INVALID");
    if (secrets.has(entry.role)) reject("CREDENTIAL_ROLE_DUPLICATE");
    secrets.set(entry.role, entry.password);
  }
  const roleNames = [...secrets.keys()].sort();
  if (roleNames.length !== policy.credential_binding.login_roles.length
    || roleNames.some((role, index) => role !== policy.credential_binding.login_roles[index])) reject("CREDENTIAL_ROLE_SET_MISMATCH");
  if (new Set(secrets.values()).size !== secrets.size) reject("CREDENTIAL_PASSWORD_REUSE_FORBIDDEN");
  const binding = Object.freeze({
    credentialGenerationId: parsed.credential_generation_id,
    roleSetSha256: clusterSha256(roleNames),
    roleCount: roleNames.length,
    evidenceScope,
    rootEnforced: !synthetic,
  });
  SECRET_BINDINGS.set(binding, {
    secrets,
    file,
    identity: pathIdentity(loaded.metadata),
    size: loaded.metadata.size,
    mtimeMs: loaded.metadata.mtimeMs,
    ctimeMs: loaded.metadata.ctimeMs,
  });
  loaded.bytes.fill(0);
  return binding;
}

export function credentialPassword(binding, role) {
  const privateBinding = SECRET_BINDINGS.get(binding);
  if (!privateBinding || typeof role !== "string" || !privateBinding.secrets.has(role)) reject("CREDENTIAL_BINDING_ROLE_INVALID");
  return privateBinding.secrets.get(role);
}

export async function assertCredentialBindingUnchanged(binding) {
  const privateBinding = SECRET_BINDINGS.get(binding);
  if (!privateBinding) reject("CREDENTIAL_BINDING_INVALID");
  const metadata = await lstat(privateBinding.file).catch(() => reject("CREDENTIAL_FILE_CHANGED"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || pathIdentity(metadata) !== privateBinding.identity || metadata.size !== privateBinding.size
    || metadata.mtimeMs !== privateBinding.mtimeMs || metadata.ctimeMs !== privateBinding.ctimeMs) reject("CREDENTIAL_FILE_CHANGED");
  return true;
}

function validateRecoveryIntentInput(input) {
  exactKeys(input, [
    "restore_run_id", "backup_id", "created_at", "evidence_scope", "policy_sha256", "snapshot_sha256",
    "data_transfer_acceptance_sha256", "cluster_transfer_acceptance_sha256", "joint_transfer_sha256",
    "target_system_identifier_sha256", "target_empty_state_sha256", "credential_generation_id",
    "credential_role_set_sha256", "tablespace_map_sha256", "custom_tablespace_identity_sha256",
  ], "RECOVERY_INTENT_INPUT_INVALID");
  string(input.restore_run_id, IDENTIFIER, "RECOVERY_INTENT_RUN_ID_INVALID");
  string(input.backup_id, IDENTIFIER, "RECOVERY_INTENT_BACKUP_ID_INVALID");
  iso(input.created_at, "RECOVERY_INTENT_CREATED_AT_INVALID");
  enumValue(input.evidence_scope, EVIDENCE_SCOPES, "RECOVERY_INTENT_SCOPE_INVALID");
  for (const key of ["policy_sha256", "snapshot_sha256", "data_transfer_acceptance_sha256", "cluster_transfer_acceptance_sha256", "joint_transfer_sha256", "target_system_identifier_sha256", "target_empty_state_sha256", "credential_role_set_sha256", "tablespace_map_sha256"]) string(input[key], SHA256, "RECOVERY_INTENT_SHA256_INVALID");
  string(input.credential_generation_id, IDENTIFIER, "RECOVERY_INTENT_CREDENTIAL_GENERATION_INVALID");
  validateStringList(input.custom_tablespace_identity_sha256, "RECOVERY_INTENT_TABLESPACE_IDENTITIES_INVALID", { pattern: SHA256 });
  return input;
}

export function createRecoveryIntent(input) {
  validateRecoveryIntentInput(input);
  const body = { schema_version: 1, contract: RECOVERY_INTENT_CONTRACT, ...canonicalClone(input) };
  return { ...body, intent_sha256: clusterSha256(body) };
}

export function validateRecoveryIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "restore_run_id", "backup_id", "created_at", "evidence_scope", "policy_sha256",
    "snapshot_sha256", "data_transfer_acceptance_sha256", "cluster_transfer_acceptance_sha256", "joint_transfer_sha256",
    "target_system_identifier_sha256", "target_empty_state_sha256", "credential_generation_id",
    "credential_role_set_sha256", "tablespace_map_sha256", "custom_tablespace_identity_sha256", "intent_sha256",
  ], "RECOVERY_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== RECOVERY_INTENT_CONTRACT) reject("RECOVERY_INTENT_CONTRACT_INVALID");
  const input = withoutKeys(value, ["schema_version", "contract", "intent_sha256"]);
  validateRecoveryIntentInput(input);
  const body = { schema_version: 1, contract: RECOVERY_INTENT_CONTRACT, ...canonicalClone(input) };
  if (value.intent_sha256 !== clusterSha256(body)) reject("RECOVERY_INTENT_SHA256_MISMATCH");
  return value;
}

const RECOVERY_PHASES = new Set([
  "INTENT_DURABLE", "ROLE_SKELETON_APPLIED", "TABLESPACE_COMMAND_DISPATCHED", "TABLESPACE_RECONCILED_APPLIED",
  "TABLESPACE_VERIFIED", "DATABASE_COMMAND_DISPATCHED", "DATABASE_RECONCILED_APPLIED", "DATABASE_VERIFIED",
  "DATA_APPLIED", "SECURITY_VERIFIED", "CREDENTIALS_VERIFIED", "ACTIVATE_PREPARED", "PREPARED", "PUBLISHED",
  "QUARANTINED", "COMPENSATED",
]);
const NONTRANSACTIONAL_PHASES = new Set([
  "TABLESPACE_COMMAND_DISPATCHED", "TABLESPACE_RECONCILED_APPLIED", "TABLESPACE_VERIFIED",
  "DATABASE_COMMAND_DISPATCHED", "DATABASE_RECONCILED_APPLIED", "DATABASE_VERIFIED",
]);

function validateRecoveryOperation(value, phase) {
  if (value === null) {
    if (NONTRANSACTIONAL_PHASES.has(phase)) reject("RECOVERY_STATE_OPERATION_REQUIRED");
    return value;
  }
  exactKeys(value, ["kind", "resource_identity_sha256", "payload_sha256"], "RECOVERY_STATE_OPERATION_INVALID");
  if (!new Set(["TABLESPACE", "DATABASE"]).has(value.kind)) reject("RECOVERY_STATE_OPERATION_INVALID");
  string(value.resource_identity_sha256, SHA256, "RECOVERY_STATE_OPERATION_INVALID");
  string(value.payload_sha256, SHA256, "RECOVERY_STATE_OPERATION_INVALID");
  if (phase.startsWith("TABLESPACE_") !== (value.kind === "TABLESPACE") || phase.startsWith("DATABASE_") !== (value.kind === "DATABASE")) reject("RECOVERY_STATE_OPERATION_KIND_MISMATCH");
  return value;
}

export function validateRecoveryState(value, intentInput = null) {
  exactKeys(value, ["schema_version", "contract", "restore_run_id", "intent_sha256", "sequence", "phase", "operation", "verified_tablespaces", "previous_state_sha256", "recorded_at", "state_sha256"], "RECOVERY_STATE_INVALID");
  if (value.schema_version !== 1 || value.contract !== RECOVERY_STATE_CONTRACT) reject("RECOVERY_STATE_CONTRACT_INVALID");
  string(value.restore_run_id, IDENTIFIER, "RECOVERY_STATE_RUN_ID_INVALID");
  string(value.intent_sha256, SHA256, "RECOVERY_STATE_INTENT_SHA256_INVALID");
  integer(value.sequence, 0, 1_000_000, "RECOVERY_STATE_SEQUENCE_INVALID");
  enumValue(value.phase, RECOVERY_PHASES, "RECOVERY_STATE_PHASE_INVALID");
  validateRecoveryOperation(value.operation, value.phase);
  validateStringList(value.verified_tablespaces, "RECOVERY_STATE_TABLESPACES_INVALID", { pattern: SHA256 });
  if (value.previous_state_sha256 !== null) string(value.previous_state_sha256, SHA256, "RECOVERY_STATE_PREVIOUS_SHA256_INVALID");
  if ((value.sequence === 0) !== (value.previous_state_sha256 === null) || (value.sequence === 0) !== (value.phase === "INTENT_DURABLE")) reject("RECOVERY_STATE_INITIAL_INVALID");
  iso(value.recorded_at, "RECOVERY_STATE_RECORDED_AT_INVALID");
  string(value.state_sha256, SHA256, "RECOVERY_STATE_SHA256_INVALID");
  const body = withoutKeys(value, ["state_sha256"]);
  if (value.state_sha256 !== clusterSha256(body)) reject("RECOVERY_STATE_SHA256_MISMATCH");
  if (intentInput) {
    const intent = validateRecoveryIntent(intentInput);
    if (value.restore_run_id !== intent.restore_run_id || value.intent_sha256 !== intent.intent_sha256
      || value.verified_tablespaces.some((identity) => !intent.custom_tablespace_identity_sha256.includes(identity))) reject("RECOVERY_STATE_INTENT_MISMATCH");
  }
  return value;
}

export function createInitialRecoveryState(intentInput, recordedAt) {
  const intent = validateRecoveryIntent(intentInput);
  iso(recordedAt, "RECOVERY_STATE_RECORDED_AT_INVALID");
  const body = {
    schema_version: 1,
    contract: RECOVERY_STATE_CONTRACT,
    restore_run_id: intent.restore_run_id,
    intent_sha256: intent.intent_sha256,
    sequence: 0,
    phase: "INTENT_DURABLE",
    operation: null,
    verified_tablespaces: [],
    previous_state_sha256: null,
    recorded_at: recordedAt,
  };
  return validateRecoveryState({ ...body, state_sha256: clusterSha256(body) }, intent);
}

function sameOperation(left, right) {
  return canonicalClusterJson(left) === canonicalClusterJson(right);
}

export function transitionRecoveryState(previousInput, intentInput, { phase, operation = null, recordedAt }) {
  const intent = validateRecoveryIntent(intentInput);
  const previous = validateRecoveryState(previousInput, intent);
  enumValue(phase, RECOVERY_PHASES, "RECOVERY_STATE_PHASE_INVALID");
  iso(recordedAt, "RECOVERY_STATE_RECORDED_AT_INVALID");
  validateRecoveryOperation(operation, phase);
  if (phase === previous.phase) {
    if (sameOperation(operation, previous.operation)) return previous;
    reject("RECOVERY_STATE_IDEMPOTENCY_CONFLICT");
  }
  if (Date.parse(recordedAt) < Date.parse(previous.recorded_at)) reject("RECOVERY_STATE_CLOCK_ROLLBACK");
  const verified = [...previous.verified_tablespaces];
  const allTablespacesVerified = () => verified.length === intent.custom_tablespace_identity_sha256.length
    && verified.every((identity, index) => identity === intent.custom_tablespace_identity_sha256[index]);
  let allowed = false;
  if (phase === "QUARANTINED" && !new Set(["PUBLISHED", "COMPENSATED"]).has(previous.phase)) allowed = true;
  else if (previous.phase === "QUARANTINED" && phase === "COMPENSATED") allowed = true;
  else if (previous.phase === "INTENT_DURABLE" && phase === "ROLE_SKELETON_APPLIED") allowed = true;
  else if (new Set(["ROLE_SKELETON_APPLIED", "TABLESPACE_VERIFIED"]).has(previous.phase) && phase === "TABLESPACE_COMMAND_DISPATCHED") {
    allowed = !verified.includes(operation.resource_identity_sha256)
      && intent.custom_tablespace_identity_sha256.includes(operation.resource_identity_sha256);
  } else if (previous.phase === "TABLESPACE_COMMAND_DISPATCHED" && phase === "TABLESPACE_RECONCILED_APPLIED") allowed = sameOperation(previous.operation, operation);
  else if (previous.phase === "TABLESPACE_RECONCILED_APPLIED" && phase === "TABLESPACE_VERIFIED") {
    allowed = sameOperation(previous.operation, operation);
    if (allowed) {
      verified.push(operation.resource_identity_sha256);
      verified.sort();
    }
  } else if (new Set(["ROLE_SKELETON_APPLIED", "TABLESPACE_VERIFIED"]).has(previous.phase) && phase === "DATABASE_COMMAND_DISPATCHED") {
    allowed = allTablespacesVerified() && operation.resource_identity_sha256 === intent.target_system_identifier_sha256;
  }
  else if (previous.phase === "DATABASE_COMMAND_DISPATCHED" && phase === "DATABASE_RECONCILED_APPLIED") allowed = sameOperation(previous.operation, operation);
  else if (previous.phase === "DATABASE_RECONCILED_APPLIED" && phase === "DATABASE_VERIFIED") allowed = sameOperation(previous.operation, operation);
  else {
    const linear = new Map([
      ["DATABASE_VERIFIED", "DATA_APPLIED"],
      ["DATA_APPLIED", "SECURITY_VERIFIED"],
      ["SECURITY_VERIFIED", "CREDENTIALS_VERIFIED"],
      ["CREDENTIALS_VERIFIED", "ACTIVATE_PREPARED"],
      ["ACTIVATE_PREPARED", "PREPARED"],
      ["PREPARED", "PUBLISHED"],
    ]);
    allowed = linear.get(previous.phase) === phase && operation === null;
  }
  if (!allowed) reject("RECOVERY_STATE_TRANSITION_INVALID");
  const body = {
    schema_version: 1,
    contract: RECOVERY_STATE_CONTRACT,
    restore_run_id: intent.restore_run_id,
    intent_sha256: intent.intent_sha256,
    sequence: previous.sequence + 1,
    phase,
    operation: operation === null ? null : canonicalClone(operation),
    verified_tablespaces: verified,
    previous_state_sha256: previous.state_sha256,
    recorded_at: recordedAt,
  };
  return validateRecoveryState({ ...body, state_sha256: clusterSha256(body) }, intent);
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicNoClobberCanonical(file, value, mode, conflictCode) {
  const parent = path.dirname(path.resolve(file));
  const source = canonicalClusterJson(value);
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    await handle.writeFile(source, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = null;
    try { await link(temporary, file); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    await syncDirectory(parent);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
  const existing = await readStableFile(file, { maxBytes: 1024 * 1024, expectedUid: process.getuid?.() ?? 0, allowedModes: [mode], code: conflictCode });
  if (existing.bytes.toString("utf8") !== source) reject(conflictCode);
  return file;
}

async function readCanonicalRecoveryFile(file, validator, code) {
  const loaded = await readStableFile(file, { maxBytes: 1024 * 1024, expectedUid: process.getuid?.() ?? 0, allowedModes: [0o400], code });
  let parsed;
  try { parsed = parseStrictJson(loaded.bytes.toString("utf8")); } catch { reject(code); }
  if (loaded.bytes.toString("utf8") !== canonicalClusterJson(parsed)) reject(code);
  return validator(parsed);
}

async function recoveryStateRoot(root) {
  return validatePrivateRoot(root, RECOVERY_STATE_ROOT_MARKER, RECOVERY_STATE_ROOT_MARKER_VALUE, {
    syntheticTmpAllowed: true,
    expectedUid: process.getuid?.() ?? 0,
    code: "RECOVERY_STATE_ROOT_UNSAFE",
  });
}

export async function writeRecoveryIntent({ stateRoot, intent: intentInput }) {
  const intent = validateRecoveryIntent(intentInput);
  const root = await recoveryStateRoot(stateRoot);
  const file = path.join(root.root, `intent-${intent.restore_run_id}.json`);
  await atomicNoClobberCanonical(file, intent, 0o400, "RECOVERY_INTENT_CONFLICT");
  return file;
}

export async function writeRecoveryState({ stateRoot, state: stateInput, intent: intentInput }) {
  const intent = validateRecoveryIntent(intentInput);
  const state = validateRecoveryState(stateInput, intent);
  const root = await recoveryStateRoot(stateRoot);
  const intentFile = path.join(root.root, `intent-${intent.restore_run_id}.json`);
  const persistedIntent = await readCanonicalRecoveryFile(intentFile, validateRecoveryIntent, "RECOVERY_INTENT_NOT_DURABLE");
  if (persistedIntent.intent_sha256 !== intent.intent_sha256) reject("RECOVERY_INTENT_CONFLICT");
  if (state.sequence > 0) {
    const previousFile = path.join(root.root, `state-${state.restore_run_id}-${String(state.sequence - 1).padStart(8, "0")}.json`);
    const previous = await readCanonicalRecoveryFile(previousFile, (value) => validateRecoveryState(value, intent), "RECOVERY_PREVIOUS_STATE_MISSING");
    if (previous.state_sha256 !== state.previous_state_sha256) reject("RECOVERY_STATE_CHAIN_MISMATCH");
  }
  const file = path.join(root.root, `state-${state.restore_run_id}-${String(state.sequence).padStart(8, "0")}.json`);
  await atomicNoClobberCanonical(file, state, 0o400, "RECOVERY_STATE_CONFLICT");
  return file;
}

export function createClusterSecurityReceipt({
  snapshot: snapshotInput,
  targetCatalog: targetInput,
  policy: policyInput,
  tablespaceMap: mapInput,
  tablespaceReceipt: tablespaceReceiptInput,
  credentialReceipt: credentialReceiptInput,
  restoreRunId,
  verifiedAt,
  evidenceScope,
  targetSystemIdentifierSha256,
}) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  const snapshot = validateClusterSnapshot(snapshotInput, policy);
  string(restoreRunId, IDENTIFIER, "CLUSTER_RECEIPT_RUN_ID_INVALID");
  iso(verifiedAt, "CLUSTER_RECEIPT_VERIFIED_AT_INVALID");
  enumValue(evidenceScope, EVIDENCE_SCOPES, "CLUSTER_RECEIPT_SCOPE_INVALID");
  string(targetSystemIdentifierSha256, SHA256, "CLUSTER_RECEIPT_TARGET_ID_INVALID");
  const targetRaw = normalizeClusterCatalog(targetInput);
  validateClusterCatalog(targetRaw, policy);
  const tablespaceReceipt = validateTablespaceReceipt(tablespaceReceiptInput);
  const credentialReceipt = validateCredentialBindingReceipt(credentialReceiptInput);
  const tablespaceMap = validateTablespaceMapDocument({ map: mapInput, snapshot, policy, evidenceScope });
  if (targetRaw.tablespaces.length !== snapshot.catalog.tablespaces.length) reject("CLUSTER_RECEIPT_TABLESPACE_TARGET_MISMATCH");
  const target = canonicalClone(targetRaw);
  for (const [index, sourceTablespace] of snapshot.catalog.tablespaces.entries()) {
    const targetTablespace = target.tablespaces[index], mapEntry = tablespaceMap.entries[index];
    if (targetTablespace.name !== sourceTablespace.name || mapEntry.name !== sourceTablespace.name
      || targetTablespace.source_location_sha256 !== clusterSha256(mapEntry.server_path)) reject("CLUSTER_RECEIPT_TABLESPACE_TARGET_MISMATCH");
    targetTablespace.source_location_sha256 = sourceTablespace.source_location_sha256;
  }
  if (tablespaceReceipt.backup_id !== snapshot.binding.backup_id || tablespaceReceipt.restore_run_id !== restoreRunId
    || tablespaceReceipt.map_sha256 !== clusterSha256(tablespaceMap) || tablespaceReceipt.evidence_scope !== evidenceScope
    || tablespaceReceipt.custom_tablespace_count !== snapshot.catalog.tablespaces.length
    || tablespaceReceipt.target_tablespace_catalog_sha256 !== clusterSha256(targetRaw.tablespaces)) reject("CLUSTER_RECEIPT_TABLESPACE_BINDING_MISMATCH");
  if (credentialReceipt.backup_id !== snapshot.binding.backup_id || credentialReceipt.restore_run_id !== restoreRunId
    || credentialReceipt.evidence_scope !== evidenceScope || credentialReceipt.role_set_sha256 !== clusterSha256(policy.credential_binding.login_roles)
    || credentialReceipt.role_count !== policy.credential_binding.login_roles.length) reject("CLUSTER_RECEIPT_CREDENTIAL_BINDING_MISMATCH");
  const targetSha256 = clusterSha256(target);
  if (targetSha256 !== snapshot.catalog_sha256) reject("CLUSTER_RECEIPT_SOURCE_TARGET_MISMATCH");
  const body = {
    schema_version: 1,
    contract: CLUSTER_SECURITY_RECEIPT_CONTRACT,
    backup_id: snapshot.binding.backup_id,
    restore_run_id: restoreRunId,
    snapshot_sha256: snapshot.snapshot_sha256,
    policy_id: policy.policy_id,
    policy_sha256: clusterPolicySha256(policy),
    source_catalog_sha256: snapshot.catalog_sha256,
    target_raw_catalog_sha256: clusterSha256(targetRaw),
    target_catalog_sha256: targetSha256,
    tablespace_map_sha256: clusterSha256(tablespaceMap),
    tablespace_receipt_sha256: tablespaceReceipt.receipt_sha256,
    credential_receipt_sha256: credentialReceipt.receipt_sha256,
    credential_role_set_sha256: credentialReceipt.role_set_sha256,
    target_system_identifier_sha256: targetSystemIdentifierSha256,
    verified_at: verifiedAt,
    evidence_scope: evidenceScope,
    policy_status: "VERIFIED",
    source_equivalence_status: "VERIFIED",
    result: evidenceScope === "ACTUAL_CONTROLLED" ? "VERIFIED" : "SYNTHETIC_ISOLATED_VERIFIED",
  };
  return validateClusterSecurityReceipt({ ...body, receipt_sha256: clusterSha256(body) }, policy);
}

export function validateClusterSecurityReceipt(value, policyInput) {
  const policy = validateClusterRecoveryPolicy(policyInput);
  exactKeys(value, [
    "schema_version", "contract", "backup_id", "restore_run_id", "snapshot_sha256", "policy_id", "policy_sha256", "source_catalog_sha256",
    "target_raw_catalog_sha256", "target_catalog_sha256", "tablespace_map_sha256", "tablespace_receipt_sha256", "credential_receipt_sha256",
    "credential_role_set_sha256", "target_system_identifier_sha256", "verified_at", "evidence_scope", "policy_status", "source_equivalence_status",
    "result", "receipt_sha256",
  ], "CLUSTER_RECEIPT_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_SECURITY_RECEIPT_CONTRACT) reject("CLUSTER_RECEIPT_CONTRACT_INVALID");
  string(value.backup_id, IDENTIFIER, "CLUSTER_RECEIPT_INVALID");
  string(value.restore_run_id, IDENTIFIER, "CLUSTER_RECEIPT_INVALID");
  for (const key of [
    "snapshot_sha256", "policy_sha256", "source_catalog_sha256", "target_raw_catalog_sha256", "target_catalog_sha256", "tablespace_map_sha256",
    "tablespace_receipt_sha256", "credential_receipt_sha256", "credential_role_set_sha256", "target_system_identifier_sha256", "receipt_sha256",
  ]) string(value[key], SHA256, "CLUSTER_RECEIPT_INVALID");
  if (value.policy_id !== policy.policy_id || value.policy_sha256 !== clusterPolicySha256(policy)) reject("CLUSTER_RECEIPT_POLICY_MISMATCH");
  if (value.source_catalog_sha256 !== value.target_catalog_sha256 || value.policy_status !== "VERIFIED" || value.source_equivalence_status !== "VERIFIED") reject("CLUSTER_RECEIPT_NOT_VERIFIED");
  if (value.credential_role_set_sha256 !== clusterSha256(policy.credential_binding.login_roles)) reject("CLUSTER_RECEIPT_CREDENTIAL_BINDING_MISMATCH");
  iso(value.verified_at, "CLUSTER_RECEIPT_INVALID");
  enumValue(value.evidence_scope, EVIDENCE_SCOPES, "CLUSTER_RECEIPT_INVALID");
  const expectedResult = value.evidence_scope === "ACTUAL_CONTROLLED" ? "VERIFIED" : "SYNTHETIC_ISOLATED_VERIFIED";
  if (value.result !== expectedResult) reject("CLUSTER_RECEIPT_RESULT_INVALID");
  const body = withoutKeys(value, ["receipt_sha256"]);
  if (value.receipt_sha256 !== clusterSha256(body)) reject("CLUSTER_RECEIPT_SHA256_MISMATCH");
  return value;
}

export function createTablespaceReceipt({ validation, backupId, restoreRunId, verifiedAt }) {
  string(backupId, IDENTIFIER, "TABLESPACE_RECEIPT_BACKUP_ID_INVALID");
  string(restoreRunId, IDENTIFIER, "TABLESPACE_RECEIPT_RUN_ID_INVALID");
  iso(verifiedAt, "TABLESPACE_RECEIPT_VERIFIED_AT_INVALID");
  if (!validation || !EVIDENCE_SCOPES.has(validation.evidenceScope) || !SHA256.test(validation.mapSha256)
    || !SHA256.test(validation.entrySetSha256) || !SHA256.test(validation.namespaceIdentitySha256)
    || !SHA256.test(validation.targetTablespaceCatalogSha256) || !SHA256.test(validation.postCreateEntrySetSha256)
    || validation.phase !== "POST_CREATE_VERIFIED" || !Number.isSafeInteger(validation.entryCount)) reject("TABLESPACE_VALIDATION_INVALID");
  const body = {
    schema_version: 1,
    contract: TABLESPACE_RECEIPT_CONTRACT,
    backup_id: backupId,
    restore_run_id: restoreRunId,
    map_sha256: validation.mapSha256,
    entry_set_sha256: validation.entrySetSha256,
    post_create_entry_set_sha256: validation.postCreateEntrySetSha256,
    target_tablespace_catalog_sha256: validation.targetTablespaceCatalogSha256,
    namespace_identity_sha256: validation.namespaceIdentitySha256,
    custom_tablespace_count: validation.entryCount,
    verified_at: verifiedAt,
    evidence_scope: validation.evidenceScope,
    namespace_status: "VERIFIED",
    path_identity_status: "VERIFIED",
    post_create_status: "VERIFIED",
    result: validation.evidenceScope === "ACTUAL_CONTROLLED" ? "VERIFIED" : "SYNTHETIC_ISOLATED_VERIFIED",
  };
  return validateTablespaceReceipt({ ...body, receipt_sha256: clusterSha256(body) });
}

export function validateTablespaceReceipt(value) {
  exactKeys(value, ["schema_version", "contract", "backup_id", "restore_run_id", "map_sha256", "entry_set_sha256", "post_create_entry_set_sha256", "target_tablespace_catalog_sha256", "namespace_identity_sha256", "custom_tablespace_count", "verified_at", "evidence_scope", "namespace_status", "path_identity_status", "post_create_status", "result", "receipt_sha256"], "TABLESPACE_RECEIPT_INVALID");
  if (value.schema_version !== 1 || value.contract !== TABLESPACE_RECEIPT_CONTRACT) reject("TABLESPACE_RECEIPT_CONTRACT_INVALID");
  string(value.backup_id, IDENTIFIER, "TABLESPACE_RECEIPT_INVALID");
  string(value.restore_run_id, IDENTIFIER, "TABLESPACE_RECEIPT_INVALID");
  for (const key of ["map_sha256", "entry_set_sha256", "post_create_entry_set_sha256", "target_tablespace_catalog_sha256", "namespace_identity_sha256", "receipt_sha256"]) string(value[key], SHA256, "TABLESPACE_RECEIPT_INVALID");
  integer(value.custom_tablespace_count, 0, 64, "TABLESPACE_RECEIPT_INVALID");
  iso(value.verified_at, "TABLESPACE_RECEIPT_INVALID");
  enumValue(value.evidence_scope, EVIDENCE_SCOPES, "TABLESPACE_RECEIPT_INVALID");
  if (value.namespace_status !== "VERIFIED" || value.path_identity_status !== "VERIFIED" || value.post_create_status !== "VERIFIED") reject("TABLESPACE_RECEIPT_NOT_VERIFIED");
  const expected = value.evidence_scope === "ACTUAL_CONTROLLED" ? "VERIFIED" : "SYNTHETIC_ISOLATED_VERIFIED";
  if (value.result !== expected) reject("TABLESPACE_RECEIPT_RESULT_INVALID");
  const body = withoutKeys(value, ["receipt_sha256"]);
  if (value.receipt_sha256 !== clusterSha256(body)) reject("TABLESPACE_RECEIPT_SHA256_MISMATCH");
  return value;
}

export function createCredentialBindingReceipt({ binding, backupId, restoreRunId, boundAt }) {
  if (!SECRET_BINDINGS.has(binding)) reject("CREDENTIAL_BINDING_INVALID");
  string(backupId, IDENTIFIER, "CREDENTIAL_RECEIPT_BACKUP_ID_INVALID");
  string(restoreRunId, IDENTIFIER, "CREDENTIAL_RECEIPT_RUN_ID_INVALID");
  iso(boundAt, "CREDENTIAL_RECEIPT_BOUND_AT_INVALID");
  const body = {
    schema_version: 1,
    contract: CREDENTIAL_RECEIPT_CONTRACT,
    backup_id: backupId,
    restore_run_id: restoreRunId,
    credential_generation_id: binding.credentialGenerationId,
    role_set_sha256: binding.roleSetSha256,
    role_count: binding.roleCount,
    bound_at: boundAt,
    evidence_scope: binding.evidenceScope,
    root_enforced: binding.rootEnforced,
    result: binding.evidenceScope === "ACTUAL_CONTROLLED" ? "VERIFIED" : "SYNTHETIC_ISOLATED_VERIFIED",
  };
  return validateCredentialBindingReceipt({ ...body, receipt_sha256: clusterSha256(body) });
}

export function validateCredentialBindingReceipt(value) {
  exactKeys(value, ["schema_version", "contract", "backup_id", "restore_run_id", "credential_generation_id", "role_set_sha256", "role_count", "bound_at", "evidence_scope", "root_enforced", "result", "receipt_sha256"], "CREDENTIAL_RECEIPT_INVALID");
  if (value.schema_version !== 1 || value.contract !== CREDENTIAL_RECEIPT_CONTRACT) reject("CREDENTIAL_RECEIPT_CONTRACT_INVALID");
  string(value.backup_id, IDENTIFIER, "CREDENTIAL_RECEIPT_INVALID");
  string(value.restore_run_id, IDENTIFIER, "CREDENTIAL_RECEIPT_INVALID");
  string(value.credential_generation_id, IDENTIFIER, "CREDENTIAL_RECEIPT_INVALID");
  string(value.role_set_sha256, SHA256, "CREDENTIAL_RECEIPT_INVALID");
  integer(value.role_count, 1, 64, "CREDENTIAL_RECEIPT_INVALID");
  iso(value.bound_at, "CREDENTIAL_RECEIPT_INVALID");
  enumValue(value.evidence_scope, EVIDENCE_SCOPES, "CREDENTIAL_RECEIPT_INVALID");
  boolean(value.root_enforced, "CREDENTIAL_RECEIPT_INVALID");
  if (value.root_enforced !== (value.evidence_scope === "ACTUAL_CONTROLLED")) reject("CREDENTIAL_RECEIPT_ROOT_STATUS_INVALID");
  const expected = value.evidence_scope === "ACTUAL_CONTROLLED" ? "VERIFIED" : "SYNTHETIC_ISOLATED_VERIFIED";
  if (value.result !== expected) reject("CREDENTIAL_RECEIPT_RESULT_INVALID");
  const body = withoutKeys(value, ["receipt_sha256"]);
  if (value.receipt_sha256 !== clusterSha256(body)) reject("CREDENTIAL_RECEIPT_SHA256_MISMATCH");
  return value;
}
