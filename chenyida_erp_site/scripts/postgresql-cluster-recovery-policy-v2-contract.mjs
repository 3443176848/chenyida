import {
  CLUSTER_POLICY_CONTRACT,
  canonicalClusterJson,
  clusterPolicySha256 as baseClusterPolicySha256,
  clusterSha256,
  validateClusterRecoveryPolicy as validateBaseClusterRecoveryPolicy,
  validateRecoveryIntent as validateBaseRecoveryIntent,
} from "./postgresql-cluster-recovery-contract.mjs";

export const CLUSTER_POLICY_V2_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy/v2";
export const RECOVERY_CONTROL_INTENT_V2_CONTRACT = "chenyida-erp-postgresql-recovery-control-intent/v2";
export const ZERO_SHA256 = "0".repeat(64);

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PG_MAJOR = /^(?:1[0-9]|[2-9][0-9])$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const BASE_POLICY_PATH = "operations/postgresql-cluster-recovery-policy-v1.json";
export const BASE_CLUSTER_POLICY_V1_FILE_SHA256 = "7e24d900b3445ca6b4f406b7330919cc1269f34fdf6bef193eedacf0d2e5bd13";
const RUNTIME_POLICY_PATH = "operations/postgresql-runtime-privilege-policy-v2.json";
const OPERATOR_POLICY_PATH = "operations/postgresql-runtime-privilege-operator-policy-v1.json";
const ROLE_BINDINGS = Object.freeze([
  ["admin_login", "ADMIN_LOGIN", true],
  ["admin_privilege_group", "ADMIN_PRIVILEGE_GROUP", false],
  ["backup_login", "BACKUP_LOGIN", true],
  ["backup_privilege_group", "BACKUP_PRIVILEGE_GROUP", false],
  ["migration_owner", "MIGRATION_OWNER", true],
  ["web_login", "WEB_LOGIN", true],
  ["web_privilege_group", "WEB_PRIVILEGE_GROUP", false],
  ["worker_login", "WORKER_LOGIN", true],
  ["worker_privilege_group", "WORKER_PRIVILEGE_GROUP", false],
]);
const IDENTITY_KEYS = Object.freeze([
  "migration_owner", "platform_owner", "admin_login", "admin_privilege_group", "backup_login",
  "backup_privilege_group", "web_login", "web_privilege_group", "worker_login", "worker_privilege_group",
  "backup_control", "restore_bootstrap", "unauthorized_probe",
]);
const MEMBERSHIP_BINDINGS = Object.freeze([
  ["admin_privilege_group", "admin_login"],
  ["backup_privilege_group", "backup_login"],
  ["web_privilege_group", "web_login"],
  ["worker_privilege_group", "worker_login"],
]);
const ACL_KINDS = Object.freeze([
  "COLUMN", "DATABASE", "LARGE_OBJECT", "MATERIALIZED_VIEW", "PARTITIONED_TABLE", "ROUTINE",
  "SCHEMA", "SEQUENCE", "TABLE", "TABLESPACE", "TYPE", "VIEW",
]);
const OBJECT_KINDS = Object.freeze([
  "COLUMN", "INDEX_PLACEMENT", "LARGE_OBJECT", "MATERIALIZED_VIEW", "PARTITIONED_INDEX_PLACEMENT",
  "PARTITIONED_TABLE", "ROUTINE", "SCHEMA", "SEQUENCE", "TABLE", "TYPE", "VIEW",
]);
const UNSUPPORTED_COUNTERS = Object.freeze([
  "access_methods", "capture_role_conflicts", "casts", "collations", "conversions", "event_triggers",
  "external_database_settings", "foreign_data_wrappers", "foreign_servers", "foreign_tables", "operator_classes",
  "operator_families", "operators", "parameter_acl_entries", "policy_role_endpoints", "replication_origins",
  "row_security_policies", "security_labels", "statistics_extensions", "subscriptions", "text_search_objects",
  "transforms", "unapproved_languages", "unapproved_settings", "unsupported_relations", "user_mappings",
]);
const RUNTIME_BINDING_KEYS = Object.freeze([
  "path", "contract", "policy_id", "policy_sha256", "file_sha256", "access_sha256",
  "compiled_catalog_sha256", "compiled_catalog_artifact_sha256", "migration_head", "migration_count",
  "migration_source_set_sha256", "migration_allowlist_sha256", "engine_image_reference", "engine_server_version_num",
  "role_set_sha256", "membership_set_sha256", "login_role_set_sha256", "service_bindings_sha256",
  "default_privileges_sha256", "extensions_sha256", "acl_summary_sha256", "object_constraints_sha256", "tablespaces_sha256",
  "operator_policy_path", "operator_policy_contract", "operator_policy_sha256", "operator_policy_file_sha256",
]);
const EXPECTED_IDENTITIES = Object.freeze({
  migration_owner: "chenyida_erp_owner",
  platform_owner: "PLATFORM_OWNER",
  admin_login: "chenyida_erp_admin",
  admin_privilege_group: "chenyida_erp_admin_priv",
  backup_login: "chenyida_erp_backup",
  backup_privilege_group: "chenyida_erp_backup_priv",
  web_login: "chenyida_erp_web",
  web_privilege_group: "chenyida_erp_web_priv",
  worker_login: "chenyida_erp_worker",
  worker_privilege_group: "chenyida_erp_worker_priv",
  backup_control: "BACKUP_CONTROL",
  restore_bootstrap: "RESTORE_BOOTSTRAP",
  unauthorized_probe: "UNAUTHORIZED_PROBE",
});
const EXPECTED_EXTENSIONS = Object.freeze({
  allowed: [
    { name: "btree_gist", schema: "public", owner: "PLATFORM_OWNER", kind: "PLATFORM" },
    { name: "pgcrypto", schema: "public", owner: "PLATFORM_OWNER", kind: "PLATFORM" },
    { name: "plpgsql", schema: "pg_catalog", owner: "PLATFORM_OWNER", kind: "PLATFORM" },
  ],
  required: ["btree_gist", "pgcrypto", "plpgsql"],
});
const EXPECTED_RUNTIME_BINDING = Object.freeze({
  path: RUNTIME_POLICY_PATH,
  contract: "chenyida-erp-postgresql-runtime-privilege-policy/v2",
  policy_id: "chenyida-erp-postgresql-runtime-privilege-v2",
  policy_sha256: "1e147e55b5285fc548ba8bc473e044e9f4e6a4b80be6b3520ec257fcbc1c29f7",
  file_sha256: "2aba8ed96202117761ba88212fb84e3d475afbf19e5447fabe2f658bbe9d8a7c",
  access_sha256: "bcd714c9af16a634279eb38f01b665d3f927d16af41e64c1a065eea1ee17dd17",
  compiled_catalog_sha256: "e0070514bdaaa998f114583ed820047688ef8945aa5ea3cafdfb873e3df02e8c",
  compiled_catalog_artifact_sha256: "a386c38457e6e3e36f6409b90b08e6a0bac284c3fc97e139cceff5e9f125aa53",
  migration_head: "0046_runtime_lock_privilege_boundary.sql",
  migration_count: 46,
  migration_source_set_sha256: "c3392d8d8e8a0e63acead47c7a4b48b305c7eba456fa7511851494312d255a8f",
  migration_allowlist_sha256: "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed",
  engine_image_reference: "postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394",
  engine_server_version_num: "170010",
  role_set_sha256: "6b333ec626bb5c4d42a03a5151680cbfa4ed9b184c7c3ee27525af60ca7e86bf",
  membership_set_sha256: "7e779d56353829a28afebf8f19c0cb63a7623fbb02d60dd1bcc6c5c2e437a1d9",
  login_role_set_sha256: "2e4ff6593cf7b4fad5c90d25963b3ffb0c98dae71eb9ee666053e3638811fc41",
  service_bindings_sha256: "ae391904417222768554b9d0a7d63d83f374e5fefe9d6908536299f68e8cac58",
  default_privileges_sha256: "032febe601992c7a9c23c39a6ab2111a8e8c1104c3aa0d494f87430fe00ba316",
  extensions_sha256: "edf551a0dbcaf4d46f594604efcf3239584bd4d5e11e1e55281e1218d86ac787",
  acl_summary_sha256: "790766547eac4331fe46bc513316a1e8a1744dc939ef34966b46839ce4ee0a3c",
  object_constraints_sha256: "cf70c5c3921bace138f43b476bd777e20c45470bd394b174a3b4b244ea5532d4",
  tablespaces_sha256: "1a0db725c894f23de99fb5c7ccb907fcd0452e20da494aee092753b0b16ae738",
  operator_policy_path: OPERATOR_POLICY_PATH,
  operator_policy_contract: "chenyida-erp-postgresql-runtime-privilege-operator-policy/v1",
  operator_policy_sha256: "fe2b007b3ab3c18bf23f59fa5c65d5128de29d45b0cfce1544314cfb21dd4b06",
  operator_policy_file_sha256: "4767a070ed8695fc770052619c3e78c5474686378ef5d1a538c58db9f78eb9fa",
});
const CONTROL_KEYS = Object.freeze([
  "required_recovery_control_intent_contract", "required_runtime_privilege_receipt_contract",
  "required_runtime_privilege_operation", "required_runtime_guard_mode", "allowed_deployment_classes",
  "required_isolated_target_deployment_class", "required_data_domains", "required_target_bootstrap_state",
  "required_prepublication_connection_state", "source_overwrite_forbidden", "large_object_verification_required",
  "secret_rebinding_required", "target_disposition_required", "rpo_rto_activation_binding_required",
  "one_time_authorization_required", "approval_reference_sha256_required",
  "distinct_source_target_system_identifier_required", "distinct_source_target_machine_identity_required",
  "distinct_source_target_location_required", "root_credential_binding_required", "operations_policy_match_required",
  "runtime_release_identity_match_required",
]);

export class ClusterRecoveryPolicyV2Error extends Error {
  constructor(code) {
    super(code);
    this.name = "ClusterRecoveryPolicyV2Error";
    this.code = code;
  }
}

function reject(code) { throw new ClusterRecoveryPolicyV2Error(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort(), wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function exact(value, expected, code) { if (canonicalClusterJson(value) !== canonicalClusterJson(expected)) reject(code); }
function string(value, pattern, code) { if (typeof value !== "string" || !pattern.test(value)) reject(code); return value; }
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function iso(value, code) { string(value, ISO_UTC, code); if (Number.isNaN(Date.parse(value))) reject(code); return value; }
function nullableIso(value, code) { return value === null ? null : iso(value, code); }
function boolean(value, code) { if (typeof value !== "boolean") reject(code); return value; }
function text(value, code) {
  if (typeof value !== "string" || value.length < 1 || value !== value.normalize("NFC")
    || Buffer.byteLength(value, "utf8") > 512 || /[\u0000-\u001f\u007f]/u.test(value)) reject(code);
  return value;
}
function stringList(value, code, expected = null) {
  if (!Array.isArray(value)) reject(code);
  value.forEach((item) => text(item, code));
  if (value.some((item, index) => index > 0 && item <= value[index - 1])) reject(code);
  if (expected) exact(value, expected, code);
  return value;
}
function digest(value, code) { string(value, SHA256, code); if (value === ZERO_SHA256) reject(code); return value; }
function clone(value) { return JSON.parse(canonicalClusterJson(value)); }
function without(value, omitted) { const keys = new Set(omitted); return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key))); }

function validateActivation(value) {
  exactKeys(value, [
    "status", "environment", "generation", "previous_policy_sha256", "supervisor_bundle_sha256",
    "authorization_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256",
    "approver_identity_sha256", "rpo_hours", "rto_minutes", "target_disposition", "activated_at", "expires_at",
  ], "CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  if (!new Set(["REPOSITORY_TEMPLATE", "ACTIVATED"]).has(value.status)) reject("CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  integer(value.generation, 0, 1_000_000, "CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  for (const key of ["previous_policy_sha256", "supervisor_bundle_sha256", "authorization_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256"]) {
    string(value[key], SHA256, "CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  }
  if (value.status === "REPOSITORY_TEMPLATE") {
    if (value.environment !== null || value.generation !== 0 || value.previous_policy_sha256 !== ZERO_SHA256
      || value.supervisor_bundle_sha256 !== ZERO_SHA256 || value.authorization_sha256 !== ZERO_SHA256
      || value.approval_reference_sha256 !== ZERO_SHA256 || value.responsible_operator_identity_sha256 !== ZERO_SHA256
      || value.approver_identity_sha256 !== ZERO_SHA256 || value.rpo_hours !== null || value.rto_minutes !== null
      || value.target_disposition !== null || value.activated_at !== null || value.expires_at !== null) {
      reject("CLUSTER_POLICY_V2_TEMPLATE_ACTIVATION_INVALID");
    }
    return value;
  }
  if (!new Set(["PRODUCTION", "UAT"]).has(value.environment) || value.generation < 1
    || [value.supervisor_bundle_sha256, value.authorization_sha256, value.approval_reference_sha256,
      value.responsible_operator_identity_sha256, value.approver_identity_sha256].includes(ZERO_SHA256)
    || value.authorization_sha256 === value.approval_reference_sha256
    || value.responsible_operator_identity_sha256 === value.approver_identity_sha256) reject("CLUSTER_POLICY_V2_ACTIVATION_INVALID");
  integer(value.rpo_hours, 1, 168, "CLUSTER_POLICY_V2_ACTIVATION_SLA_INVALID");
  integer(value.rto_minutes, 1, 10_080, "CLUSTER_POLICY_V2_ACTIVATION_SLA_INVALID");
  if (!new Set(["DESTROY_AFTER_EVIDENCE", "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT"]).has(value.target_disposition)) reject("CLUSTER_POLICY_V2_ACTIVATION_DISPOSITION_INVALID");
  iso(value.activated_at, "CLUSTER_POLICY_V2_ACTIVATION_TIME_INVALID");
  iso(value.expires_at, "CLUSTER_POLICY_V2_ACTIVATION_TIME_INVALID");
  if (Date.parse(value.activated_at) >= Date.parse(value.expires_at)
    || Date.parse(value.expires_at) - Date.parse(value.activated_at) > 24 * 60 * 60 * 1000) reject("CLUSTER_POLICY_V2_ACTIVATION_TIME_INVALID");
  if (value.generation === 1 && value.previous_policy_sha256 !== ZERO_SHA256
    || value.generation > 1 && value.previous_policy_sha256 === ZERO_SHA256) reject("CLUSTER_POLICY_V2_ACTIVATION_GENERATION_INVALID");
  return value;
}

function validateBaseBinding(value) {
  exactKeys(value, ["path", "contract", "policy_id", "policy_sha256", "file_sha256", "policy"], "CLUSTER_POLICY_V2_BASE_POLICY_INVALID");
  let policy;
  try { policy = validateBaseClusterRecoveryPolicy(value.policy); }
  catch { reject("CLUSTER_POLICY_V2_BASE_POLICY_INVALID"); }
  if (value.path !== BASE_POLICY_PATH || value.contract !== CLUSTER_POLICY_CONTRACT || value.policy_id !== policy.policy_id
    || value.policy_sha256 !== baseClusterPolicySha256(policy)
    || value.file_sha256 !== BASE_CLUSTER_POLICY_V1_FILE_SHA256) reject("CLUSTER_POLICY_V2_BASE_POLICY_INVALID");
  return policy;
}

function validateRole(value) {
  exactKeys(value, ["name", "purpose", "intended_login", "inherit", "connection_limit", "valid_until"], "CLUSTER_POLICY_V2_ROLE_INVALID");
  text(value.name, "CLUSTER_POLICY_V2_ROLE_INVALID"); text(value.purpose, "CLUSTER_POLICY_V2_ROLE_INVALID");
  boolean(value.intended_login, "CLUSTER_POLICY_V2_ROLE_INVALID"); boolean(value.inherit, "CLUSTER_POLICY_V2_ROLE_INVALID");
  integer(value.connection_limit, -1, 10_000, "CLUSTER_POLICY_V2_ROLE_INVALID"); nullableIso(value.valid_until, "CLUSTER_POLICY_V2_ROLE_INVALID");
  if (!value.intended_login && value.connection_limit !== -1) reject("CLUSTER_POLICY_V2_ROLE_INVALID");
}

function validateRuntimeBinding(value, policy) {
  exactKeys(value, RUNTIME_BINDING_KEYS, "CLUSTER_POLICY_V2_RUNTIME_BINDING_INVALID");
  if (value.path !== RUNTIME_POLICY_PATH || value.contract !== "chenyida-erp-postgresql-runtime-privilege-policy/v2"
    || value.policy_id !== "chenyida-erp-postgresql-runtime-privilege-v2" || value.operator_policy_path !== OPERATOR_POLICY_PATH
    || value.operator_policy_contract !== "chenyida-erp-postgresql-runtime-privilege-operator-policy/v1") reject("CLUSTER_POLICY_V2_RUNTIME_BINDING_INVALID");
  for (const key of RUNTIME_BINDING_KEYS.filter((entry) => entry.endsWith("_sha256"))) digest(value[key], "CLUSTER_POLICY_V2_RUNTIME_BINDING_INVALID");
  string(value.migration_head, MIGRATION, "CLUSTER_POLICY_V2_RUNTIME_BINDING_INVALID");
  integer(value.migration_count, 1, 10_000, "CLUSTER_POLICY_V2_RUNTIME_BINDING_INVALID");
  if (!/^postgres@sha256:[0-9a-f]{64}$/u.test(value.engine_image_reference)
    || !/^[1-9][0-9]{5}$/u.test(value.engine_server_version_num)
    || !value.engine_server_version_num.startsWith(policy.postgresql_major)) reject("CLUSTER_POLICY_V2_RUNTIME_BINDING_INVALID");
  if (value.role_set_sha256 !== clusterSha256(policy.roles) || value.membership_set_sha256 !== clusterSha256(policy.memberships)
    || value.login_role_set_sha256 !== clusterSha256(policy.credential_binding.login_roles)) reject("CLUSTER_POLICY_V2_RUNTIME_PROJECTION_MISMATCH");
  exact(value, EXPECTED_RUNTIME_BINDING, "CLUSTER_POLICY_V2_RUNTIME_SOURCE_REPLACED");
}

export function validateClusterRecoveryPolicyV2(value) {
  exactKeys(value, [
    "schema_version", "contract", "policy_id", "policy_generation", "scope", "postgresql_major",
    "base_cluster_policy_binding", "database", "identities", "roles", "memberships", "settings", "acl",
    "supported_object_kinds", "extensions", "unsupported_catalog_counters", "tablespaces", "credential_binding",
    "runtime_privilege_binding", "actual_recovery_controls", "activation",
  ], "CLUSTER_POLICY_V2_INVALID");
  if (value.schema_version !== 2 || value.contract !== CLUSTER_POLICY_V2_CONTRACT
    || value.policy_id !== "chenyida-erp-postgresql-cluster-recovery-v2" || value.policy_generation !== 1
    || value.scope !== "PRODUCTION_BASELINE") reject("CLUSTER_POLICY_V2_IDENTITY_INVALID");
  string(value.postgresql_major, PG_MAJOR, "CLUSTER_POLICY_V2_IDENTITY_INVALID");
  const basePolicy = validateBaseBinding(value.base_cluster_policy_binding);
  if (value.postgresql_major !== basePolicy.postgresql_major) reject("CLUSTER_POLICY_V2_BASE_POLICY_INVALID");
  validateActivation(value.activation);
  exactKeys(value.identities, IDENTITY_KEYS, "CLUSTER_POLICY_V2_IDENTITIES_INVALID");
  Object.values(value.identities).forEach((identity) => text(identity, "CLUSTER_POLICY_V2_IDENTITIES_INVALID"));
  if (new Set(Object.values(value.identities)).size !== IDENTITY_KEYS.length) reject("CLUSTER_POLICY_V2_IDENTITIES_INVALID");
  exact(value.identities, EXPECTED_IDENTITIES, "CLUSTER_POLICY_V2_IDENTITIES_REPLACED");
  exact(value.database, { name: "chenyida_erp", owner: value.identities.migration_owner, default_tablespace: "pg_default", allow_connect: true, connection_limit: 64, public_connect: false }, "CLUSTER_POLICY_V2_DATABASE_INVALID");
  if (!Array.isArray(value.roles) || value.roles.length !== ROLE_BINDINGS.length) reject("CLUSTER_POLICY_V2_ROLE_SET_INVALID");
  value.roles.forEach(validateRole);
  if (value.roles.some((role, index) => index > 0 && role.name <= value.roles[index - 1].name)) reject("CLUSTER_POLICY_V2_ROLE_SET_INVALID");
  for (const [identityKey, purpose, login] of ROLE_BINDINGS) {
    const role = value.roles.find((entry) => entry.name === value.identities[identityKey]);
    if (!role || role.purpose !== purpose || role.intended_login !== login) reject("CLUSTER_POLICY_V2_ROLE_SET_INVALID");
  }
  const memberships = MEMBERSHIP_BINDINGS.map(([roleKey, memberKey]) => ({
    role: value.identities[roleKey], member: value.identities[memberKey], grantor: value.identities.platform_owner,
    admin_option: false, inherit_option: true, set_option: false,
  })).sort((left, right) => {
    const leftText = canonicalClusterJson(left), rightText = canonicalClusterJson(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  });
  exact(value.memberships, memberships, "CLUSTER_POLICY_V2_MEMBERSHIP_SET_INVALID");
  exact(value.settings, { allowed_keys: ["application_name", "idle_in_transaction_session_timeout", "lock_timeout", "statement_timeout"], required: [] }, "CLUSTER_POLICY_V2_SETTINGS_INVALID");
  exactKeys(value.acl, ["fixed_semantic_references", "allowed_grantors", "allowed_grantees", "grantable_roles", "public_allowed_privileges", "non_owner_allowed_privileges"], "CLUSTER_POLICY_V2_ACL_INVALID");
  exact(value.acl.fixed_semantic_references, ["PUBLIC", "pg_database_owner"], "CLUSTER_POLICY_V2_ACL_INVALID");
  exact(value.acl.allowed_grantors, [value.identities.migration_owner, "pg_database_owner"].sort(), "CLUSTER_POLICY_V2_ACL_INVALID");
  exact(value.acl.allowed_grantees, ["PUBLIC", value.identities.admin_privilege_group, value.identities.backup_privilege_group, value.identities.migration_owner, value.identities.web_privilege_group, value.identities.worker_privilege_group, "pg_database_owner"].sort(), "CLUSTER_POLICY_V2_ACL_INVALID");
  exact(value.acl.grantable_roles, [value.identities.migration_owner], "CLUSTER_POLICY_V2_ACL_INVALID");
  exactKeys(value.acl.public_allowed_privileges, ACL_KINDS, "CLUSTER_POLICY_V2_ACL_INVALID");
  exactKeys(value.acl.non_owner_allowed_privileges, ACL_KINDS, "CLUSTER_POLICY_V2_ACL_INVALID");
  exact(value.acl.public_allowed_privileges, Object.fromEntries(ACL_KINDS.map((kind) => [kind, []])), "CLUSTER_POLICY_V2_ACL_INVALID");
  exact(value.acl.non_owner_allowed_privileges, {
    DATABASE: ["CONNECT", "TEMPORARY"], SCHEMA: ["USAGE"], TABLE: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    PARTITIONED_TABLE: ["DELETE", "INSERT", "SELECT", "UPDATE"], VIEW: ["SELECT"], MATERIALIZED_VIEW: ["SELECT"],
    SEQUENCE: ["SELECT", "UPDATE", "USAGE"], COLUMN: ["INSERT", "REFERENCES", "SELECT", "UPDATE"],
    ROUTINE: ["EXECUTE"], TYPE: ["USAGE"], LARGE_OBJECT: [], TABLESPACE: [],
  }, "CLUSTER_POLICY_V2_ACL_INVALID");
  stringList(value.supported_object_kinds, "CLUSTER_POLICY_V2_OBJECT_KINDS_INVALID", [...OBJECT_KINDS]);
  exactKeys(value.extensions, ["allowed", "required"], "CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
  exact(value.extensions.required, ["btree_gist", "pgcrypto", "plpgsql"], "CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
  if (!Array.isArray(value.extensions.allowed) || value.extensions.allowed.length !== 3) reject("CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
  value.extensions.allowed.forEach((extension) => {
    exactKeys(extension, ["name", "schema", "owner", "kind"], "CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
    if (!value.extensions.required.includes(extension.name) || extension.owner !== value.identities.platform_owner || extension.kind !== "PLATFORM") reject("CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
    text(extension.schema, "CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
  });
  if (value.extensions.allowed.some((entry, index) => index > 0 && entry.name <= value.extensions.allowed[index - 1].name)) reject("CLUSTER_POLICY_V2_EXTENSIONS_INVALID");
  exact(value.extensions, EXPECTED_EXTENSIONS, "CLUSTER_POLICY_V2_EXTENSIONS_REPLACED");
  stringList(value.unsupported_catalog_counters, "CLUSTER_POLICY_V2_UNSUPPORTED_INVALID", [...UNSUPPORTED_COUNTERS]);
  exact(value.tablespaces, { allow_custom: false, maximum_custom: 0, owner: value.identities.platform_owner }, "CLUSTER_POLICY_V2_TABLESPACES_INVALID");
  exactKeys(value.credential_binding, ["login_roles", "minimum_password_bytes", "maximum_password_bytes"], "CLUSTER_POLICY_V2_CREDENTIAL_INVALID");
  const logins = value.roles.filter((role) => role.intended_login).map((role) => role.name).sort();
  exact(value.credential_binding, { login_roles: logins, minimum_password_bytes: 32, maximum_password_bytes: 64 }, "CLUSTER_POLICY_V2_CREDENTIAL_INVALID");
  validateRuntimeBinding(value.runtime_privilege_binding, value);
  exactKeys(value.actual_recovery_controls, CONTROL_KEYS, "CLUSTER_POLICY_V2_CONTROLS_INVALID");
  exact(value.actual_recovery_controls, {
    required_recovery_control_intent_contract: RECOVERY_CONTROL_INTENT_V2_CONTRACT,
    required_runtime_privilege_receipt_contract: "chenyida-erp-postgresql-runtime-privilege-operator-receipt/v1",
    required_runtime_privilege_operation: "BOOTSTRAP", required_runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
    allowed_deployment_classes: ["PRODUCTION", "UAT"], required_isolated_target_deployment_class: "TEST",
    required_data_domains: ["POSTGRESQL", "attachments", "backup_status", "uploads"], required_target_bootstrap_state: "EMPTY_NEW_CLUSTER",
    required_prepublication_connection_state: "NETWORK_FENCED_NO_APPLICATION_WRITERS", source_overwrite_forbidden: true,
    large_object_verification_required: true, secret_rebinding_required: true, target_disposition_required: true,
    rpo_rto_activation_binding_required: true, one_time_authorization_required: true, approval_reference_sha256_required: true,
    distinct_source_target_system_identifier_required: true, distinct_source_target_machine_identity_required: true,
    distinct_source_target_location_required: true, root_credential_binding_required: true, operations_policy_match_required: true,
    runtime_release_identity_match_required: true,
  }, "CLUSTER_POLICY_V2_CONTROLS_INVALID");
  return value;
}

export function clusterRecoveryPolicyV2Sha256(policy) { return clusterSha256(validateClusterRecoveryPolicyV2(policy)); }
export function isClusterRecoveryPolicyV2(value) { return value?.schema_version === 2 && value?.contract === CLUSTER_POLICY_V2_CONTRACT; }
export function validateClusterRecoveryPolicyForReadiness(value) {
  return isClusterRecoveryPolicyV2(value) ? validateClusterRecoveryPolicyV2(value) : validateBaseClusterRecoveryPolicy(value);
}
export function baseClusterRecoveryPolicy(policyInput) {
  const policy = validateClusterRecoveryPolicyForReadiness(policyInput);
  return isClusterRecoveryPolicyV2(policy) ? policy.base_cluster_policy_binding.policy : policy;
}
export function readinessPolicySha256(policyInput) {
  const policy = validateClusterRecoveryPolicyForReadiness(policyInput);
  return isClusterRecoveryPolicyV2(policy) ? clusterRecoveryPolicyV2Sha256(policy) : baseClusterPolicySha256(policy);
}

const CONTROL_INTENT_FIELDS = Object.freeze([
  "restore_run_id", "backup_id", "created_at", "evidence_scope", "policy_sha256", "base_policy_sha256",
  "base_recovery_intent_sha256", "deployment_class", "target_deployment_class", "source_location_id", "target_location_id",
  "target_disposition", "rpo_hours", "rto_minutes", "recovery_operator_identity_sha256", "recovery_approver_identity_sha256",
  "source_system_identifier_sha256", "target_system_identifier_sha256", "source_machine_identity_sha256",
  "target_machine_identity_sha256", "supervisor_bundle_sha256", "authorization_sha256", "approval_reference_sha256",
  "release_manifest_sha256", "runtime_configuration_sha256", "runtime_privilege_policy_sha256", "operations_policy_sha256",
  "runtime_credential_generation_id", "runtime_credential_role_set_sha256",
]);

function validateControlInput(input) {
  exactKeys(input, CONTROL_INTENT_FIELDS, "RECOVERY_CONTROL_INTENT_V2_INPUT_INVALID");
  string(input.restore_run_id, IDENTIFIER, "RECOVERY_CONTROL_INTENT_V2_ID_INVALID");
  string(input.backup_id, IDENTIFIER, "RECOVERY_CONTROL_INTENT_V2_ID_INVALID");
  string(input.runtime_credential_generation_id, IDENTIFIER, "RECOVERY_CONTROL_INTENT_V2_ID_INVALID");
  iso(input.created_at, "RECOVERY_CONTROL_INTENT_V2_TIME_INVALID");
  if (!new Set(["ACTUAL_CONTROLLED", "SYNTHETIC_TEST_ONLY"]).has(input.evidence_scope)) reject("RECOVERY_CONTROL_INTENT_V2_SCOPE_INVALID");
  if (!new Set(["PRODUCTION", "TEST", "UAT"]).has(input.deployment_class) || input.target_deployment_class !== "TEST") reject("RECOVERY_CONTROL_INTENT_V2_DEPLOYMENT_INVALID");
  if ((input.evidence_scope === "ACTUAL_CONTROLLED") !== new Set(["PRODUCTION", "UAT"]).has(input.deployment_class)
    || input.evidence_scope === "SYNTHETIC_TEST_ONLY" && input.deployment_class !== "TEST") reject("RECOVERY_CONTROL_INTENT_V2_SCOPE_INVALID");
  string(input.source_location_id, IDENTIFIER, "RECOVERY_CONTROL_INTENT_V2_LOCATION_INVALID");
  string(input.target_location_id, IDENTIFIER, "RECOVERY_CONTROL_INTENT_V2_LOCATION_INVALID");
  integer(input.rpo_hours, 1, 168, "RECOVERY_CONTROL_INTENT_V2_SLA_INVALID");
  integer(input.rto_minutes, 1, 10_080, "RECOVERY_CONTROL_INTENT_V2_SLA_INVALID");
  if (!new Set(["DESTROY_AFTER_EVIDENCE", "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT"]).has(input.target_disposition)) reject("RECOVERY_CONTROL_INTENT_V2_DISPOSITION_INVALID");
  for (const key of CONTROL_INTENT_FIELDS.filter((field) => field.endsWith("_sha256"))) digest(input[key], "RECOVERY_CONTROL_INTENT_V2_DIGEST_INVALID");
  if (input.source_location_id === input.target_location_id || input.source_system_identifier_sha256 === input.target_system_identifier_sha256
    || input.source_machine_identity_sha256 === input.target_machine_identity_sha256 || input.authorization_sha256 === input.approval_reference_sha256
    || input.recovery_operator_identity_sha256 === input.recovery_approver_identity_sha256) reject("RECOVERY_CONTROL_INTENT_V2_ISOLATION_INVALID");
  return input;
}

export function createRecoveryControlIntentV2(input) {
  validateControlInput(input);
  const body = { schema_version: 2, contract: RECOVERY_CONTROL_INTENT_V2_CONTRACT, ...clone(input) };
  return Object.freeze({ ...body, intent_sha256: clusterSha256(body) });
}

export function validateRecoveryControlIntentV2(value) {
  exactKeys(value, ["schema_version", "contract", ...CONTROL_INTENT_FIELDS, "intent_sha256"], "RECOVERY_CONTROL_INTENT_V2_INVALID");
  if (value.schema_version !== 2 || value.contract !== RECOVERY_CONTROL_INTENT_V2_CONTRACT) reject("RECOVERY_CONTROL_INTENT_V2_INVALID");
  const input = without(value, ["schema_version", "contract", "intent_sha256"]);
  const expected = createRecoveryControlIntentV2(input);
  exact(value, expected, "RECOVERY_CONTROL_INTENT_V2_INVALID");
  return value;
}

export function validateRecoveryControlIntentForPolicy(controlInput, policyInput, baseIntentInput) {
  const policy = validateClusterRecoveryPolicyV2(policyInput), control = validateRecoveryControlIntentV2(controlInput);
  const basePolicy = policy.base_cluster_policy_binding.policy;
  let baseIntent;
  try { baseIntent = validateBaseRecoveryIntent(baseIntentInput); }
  catch { reject("RECOVERY_CONTROL_INTENT_V2_BASE_INTENT_INVALID"); }
  if (control.policy_sha256 !== clusterRecoveryPolicyV2Sha256(policy)
    || control.base_policy_sha256 !== baseClusterPolicySha256(basePolicy)
    || control.base_recovery_intent_sha256 !== baseIntent.intent_sha256 || baseIntent.policy_sha256 !== control.base_policy_sha256
    || control.restore_run_id !== baseIntent.restore_run_id || control.backup_id !== baseIntent.backup_id
    || control.evidence_scope !== baseIntent.evidence_scope || control.target_system_identifier_sha256 !== baseIntent.target_system_identifier_sha256
    || control.runtime_privilege_policy_sha256 !== policy.runtime_privilege_binding.policy_sha256
    || control.runtime_credential_role_set_sha256 !== policy.runtime_privilege_binding.login_role_set_sha256) {
    reject("RECOVERY_CONTROL_INTENT_V2_BINDING_MISMATCH");
  }
  if (control.evidence_scope === "ACTUAL_CONTROLLED") {
    if (policy.activation.status !== "ACTIVATED" || policy.activation.environment !== control.deployment_class
      || policy.activation.supervisor_bundle_sha256 !== control.supervisor_bundle_sha256
      || policy.activation.rpo_hours !== control.rpo_hours || policy.activation.rto_minutes !== control.rto_minutes
      || policy.activation.target_disposition !== control.target_disposition
      || policy.activation.authorization_sha256 === control.authorization_sha256
      || policy.activation.approval_reference_sha256 === control.approval_reference_sha256
      || new Set([policy.activation.responsible_operator_identity_sha256, policy.activation.approver_identity_sha256,
        control.recovery_operator_identity_sha256, control.recovery_approver_identity_sha256]).size !== 4
      || Date.parse(control.created_at) < Date.parse(policy.activation.activated_at)
      || Date.parse(control.created_at) >= Date.parse(policy.activation.expires_at)) reject("RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH");
  } else if (policy.activation.status !== "REPOSITORY_TEMPLATE" || control.deployment_class !== "TEST") {
    reject("RECOVERY_CONTROL_INTENT_V2_ACTIVATION_MISMATCH");
  }
  return Object.freeze({ control, baseIntent });
}
