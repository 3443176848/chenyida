import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";

export const UAT_PROMOTION_MIGRATION_GRANT_CONTRACT = "chenyida-erp-uat-promotion-migration-execution-grant/v1";
export const UAT_PROMOTION_MIGRATION_ENGINE_RESULT_CONTRACT = "chenyida-erp-uat-promotion-migration-engine-result/v1";
export const UAT_PROMOTION_MIGRATION_FENCE_CONTRACT = "chenyida-erp-uat-promotion-migration-database-fence/v1";
export const UAT_PROMOTION_MIGRATION_RESULT_CONTRACT = "chenyida-erp-uat-promotion-migration-result/v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const ROLE = /^[a-z_][a-z0-9_$-]{0,62}$/u;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,29}$/u;
const OID = /^[1-9][0-9]{0,9}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const IMAGE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;
const MANAGED_ROLES = Object.freeze([
  "chenyida_erp_admin", "chenyida_erp_admin_priv", "chenyida_erp_backup", "chenyida_erp_backup_priv",
  "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_web_priv", "chenyida_erp_worker",
  "chenyida_erp_worker_priv",
]);
const LOGIN_ROLES = Object.freeze([
  "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_worker",
]);
const CONNECT_ROLES = Object.freeze(["chenyida_erp_owner"]);
const PLATFORM_SUPERUSER_ROLES = Object.freeze(["postgres"]);
export const UAT_PROMOTION_MIGRATION_ROLE_RECORDS = Object.freeze([
  { role: "chenyida_erp_admin", login: true, inherit: true, connection_limit: 1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_admin_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_backup", login: true, inherit: true, connection_limit: 2, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_backup_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_owner", login: true, inherit: false, connection_limit: 1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_web", login: true, inherit: true, connection_limit: 12, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_web_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_worker", login: true, inherit: true, connection_limit: 6, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
  { role: "chenyida_erp_worker_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
]);
export const UAT_PROMOTION_MIGRATION_MEMBERSHIPS = Object.freeze([
  { role: "chenyida_erp_admin_priv", member: "chenyida_erp_admin", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
  { role: "chenyida_erp_backup_priv", member: "chenyida_erp_backup", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
  { role: "chenyida_erp_web_priv", member: "chenyida_erp_web", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
  { role: "chenyida_erp_worker_priv", member: "chenyida_erp_worker", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
]);
export const UAT_PROMOTION_MIGRATION_DATABASE_OWNER_PRIVILEGES = Object.freeze(["CONNECT", "CREATE", "TEMPORARY"]);
const ROLE_RECORDS = UAT_PROMOTION_MIGRATION_ROLE_RECORDS;
const MEMBERSHIPS = UAT_PROMOTION_MIGRATION_MEMBERSHIPS;
const DATABASE_OWNER_PRIVILEGES = UAT_PROMOTION_MIGRATION_DATABASE_OWNER_PRIVILEGES;

export class UatPromotionMigrationExecutionError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionMigrationExecutionError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionMigrationExecutionError(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function string(value, pattern, code) { if (typeof value !== "string" || !pattern.test(value)) reject(code); return value; }
function digest(value, code) { return string(value, SHA256, code); }
function instant(value, code) {
  string(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function without(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }

export function migrationExecutionSha256(value) { return clusterSha256(value); }
export function canonicalMigrationExecutionJson(value) { return canonicalClusterJson(value); }

function validateDatabase(value, code) {
  exactKeys(value, [
    "deployment_class", "deployment_id", "database_name", "database_system_identifier", "database_oid",
    "database_marker", "migration_role", "control_role",
  ], code);
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp"
    || value.database_name !== "chenyida_erp"
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.migration_role !== "chenyida_erp_owner" || value.control_role !== "postgres") reject(code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  string(value.migration_role, ROLE, code);
  string(value.control_role, ROLE, code);
  return value;
}

export function validateUatPromotionMigrationGrant(value) {
  const code = "UAT_PROMOTION_MIGRATION_GRANT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "migration_approval_authorization_sha256",
    "migration_approval_receipt_sha256", "migration_authorization_binding_sha256",
    "promotion_intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "supervisor_bundle_sha256", "release_manifest_sha256",
    "worker_image", "migration_manifest_sha256", "expected_current_head", "target_head", "database",
    "created_at", "expires_at", "grant_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_MIGRATION_GRANT_CONTRACT
    || value.execution_scope !== "SUPERVISOR_CONTROLLED_UAT_MIGRATION") reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], IDENTIFIER, code);
  for (const field of [
    "execution_authorization_sha256", "migration_approval_authorization_sha256",
    "migration_approval_receipt_sha256", "migration_authorization_binding_sha256",
    "promotion_intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "supervisor_bundle_sha256", "release_manifest_sha256",
    "migration_manifest_sha256", "grant_sha256",
  ]) digest(value[field], code);
  if (value.execution_authorization_sha256 === value.migration_approval_authorization_sha256) reject(code);
  string(value.worker_image, IMAGE, code);
  if (value.expected_current_head !== "EMPTY") string(value.expected_current_head, MIGRATION, code);
  string(value.target_head, MIGRATION, code);
  validateDatabase(value.database, code);
  const created = Date.parse(instant(value.created_at, code));
  const expires = Date.parse(instant(value.expires_at, code));
  if (expires <= created || expires - created > 15 * 60 * 1000) reject(code);
  if (clusterSha256(without(value, "grant_sha256")) !== value.grant_sha256) reject(code);
  return value;
}

export function createUatPromotionMigrationGrant(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_MIGRATION_GRANT_CONTRACT, ...input };
  return Object.freeze(validateUatPromotionMigrationGrant({ ...body, grant_sha256: clusterSha256(body) }));
}

function validateFileResult(value, code) {
  exactKeys(value, ["filename", "sha256", "outcome"], code);
  string(value.filename, MIGRATION, code);
  digest(value.sha256, code);
  if (!new Set(["ALREADY_APPLIED", "APPLIED"]).has(value.outcome)) reject(code);
  return value;
}

export function validateUatPromotionMigrationEngineResult(value) {
  const code = "UAT_PROMOTION_MIGRATION_ENGINE_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "database_name", "database_system_identifier",
    "database_oid", "database_marker", "migration_role", "application_name", "current_head_before",
    "target_head", "started_at", "completed_at", "files", "final_migration_rows_sha256",
    "final_migration_rows_count", "other_backend_count_before", "other_backend_count_after",
    "database_default_transaction_read_only", "migration_transaction_read_only", "engine_result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_MIGRATION_ENGINE_RESULT_CONTRACT
    || value.status !== "MIGRATION_COMMITTED" || value.application_name !== "chenyida-erp-migration"
    || value.migration_role !== "chenyida_erp_owner" || value.database_name !== "chenyida_erp"
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.database_default_transaction_read_only !== "on"
    || value.migration_transaction_read_only !== "off") reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], IDENTIFIER, code);
  for (const field of ["execution_authorization_sha256", "grant_sha256", "final_migration_rows_sha256", "engine_result_sha256"]) digest(value[field], code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  string(value.migration_role, ROLE, code);
  if (value.current_head_before !== "EMPTY") string(value.current_head_before, MIGRATION, code);
  string(value.target_head, MIGRATION, code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  if (completed < started) reject(code);
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 10_000) reject(code);
  value.files.forEach((entry) => validateFileResult(entry, code));
  const names = value.files.map((entry) => entry.filename);
  if (new Set(names).size !== names.length || names.some((name, index) => index > 0 && name <= names[index - 1])) reject(code);
  integer(value.final_migration_rows_count, 1, 10_000, code);
  integer(value.other_backend_count_before, 0, 1_000_000, code);
  integer(value.other_backend_count_after, 0, 1_000_000, code);
  if (value.other_backend_count_before !== 0 || value.other_backend_count_after !== 0
    || value.final_migration_rows_count !== value.files.length
    || value.target_head !== value.files.at(-1).filename
    || clusterSha256(without(value, "engine_result_sha256")) !== value.engine_result_sha256) reject(code);
  return value;
}

export function createUatPromotionMigrationEngineResult(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_MIGRATION_ENGINE_RESULT_CONTRACT, status: "MIGRATION_COMMITTED", ...input };
  return Object.freeze(validateUatPromotionMigrationEngineResult({ ...body, engine_result_sha256: clusterSha256(body) }));
}

export function assertUatPromotionMigrationEngineResultMatchesGrant(resultInput, grantInput) {
  const result = validateUatPromotionMigrationEngineResult(resultInput);
  const grant = validateUatPromotionMigrationGrant(grantInput);
  if (result.promotion_id !== grant.promotion_id || result.migration_operation_id !== grant.migration_operation_id
    || result.execution_authorization_sha256 !== grant.execution_authorization_sha256
    || result.grant_sha256 !== grant.grant_sha256 || result.database_name !== grant.database.database_name
    || result.database_system_identifier !== grant.database.database_system_identifier
    || result.database_oid !== grant.database.database_oid || result.database_marker !== grant.database.database_marker
    || result.migration_role !== grant.database.migration_role || result.current_head_before !== grant.expected_current_head
    || result.target_head !== grant.target_head) reject("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_BINDING_INVALID");
  const currentIndex = grant.expected_current_head === "EMPTY"
    ? -1 : result.files.findIndex((entry) => entry.filename === grant.expected_current_head);
  if (grant.expected_current_head !== "EMPTY" && currentIndex < 0) {
    reject("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_BINDING_INVALID");
  }
  if (result.files.some((entry, index) => entry.outcome !== (index <= currentIndex ? "ALREADY_APPLIED" : "APPLIED"))) {
    reject("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_BINDING_INVALID");
  }
  return result;
}

export function assertUatPromotionMigrationEngineResultMatchesAllowlist(resultInput, entriesInput) {
  const result = validateUatPromotionMigrationEngineResult(resultInput);
  const code = "UAT_PROMOTION_MIGRATION_ENGINE_RESULT_ALLOWLIST_INVALID";
  if (!Array.isArray(entriesInput) || entriesInput.length !== result.files.length) reject(code);
  const rows = [];
  for (const [index, entry] of entriesInput.entries()) {
    exactKeys(entry, ["ordinal", "filename", "sha256"], code);
    integer(entry.ordinal, 1, 10_000, code);
    string(entry.filename, MIGRATION, code);
    digest(entry.sha256, code);
    const file = result.files[index];
    if (entry.ordinal !== index + 1 || file.filename !== entry.filename || file.sha256 !== entry.sha256) reject(code);
    rows.push({ version: entry.filename, checksum: entry.sha256 });
  }
  if (result.final_migration_rows_count !== entriesInput.length
    || result.final_migration_rows_sha256 !== clusterSha256(rows)) reject(code);
  return result;
}

export function validateUatPromotionMigrationFence(value) {
  const code = "UAT_PROMOTION_MIGRATION_FENCE_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "phase", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "database_name", "database_system_identifier", "database_oid",
    "database_marker", "control_role", "control_superuser", "default_transaction_read_only",
    "database_allow_connections", "database_setting_count", "database_connection_limit", "other_backend_count", "managed_roles",
    "login_roles", "connect_roles", "platform_superuser_roles", "public_connect", "public_temporary", "unknown_connect_acl_count",
    "unknown_connect_login_count", "prepared_transaction_count", "role_records", "memberships",
    "non_owner_database_acl", "database_owner_privileges", "observed_at", "fence_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_MIGRATION_FENCE_CONTRACT
    || !new Set(["BEFORE", "AFTER"]).has(value.phase) || value.database_name !== "chenyida_erp"
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.control_role !== "postgres" || value.control_superuser !== true
    || value.default_transaction_read_only !== "on" || value.database_setting_count !== 1
    || value.database_allow_connections !== (value.phase === "BEFORE")
    || value.database_connection_limit !== (value.phase === "BEFORE" ? 1 : 0)
    || value.other_backend_count !== 0 || !same(value.managed_roles, MANAGED_ROLES)
    || !same(value.login_roles, LOGIN_ROLES) || !same(value.connect_roles, CONNECT_ROLES)
    || !same(value.platform_superuser_roles, PLATFORM_SUPERUSER_ROLES)
    || value.public_connect !== false || value.public_temporary !== false
    || value.unknown_connect_acl_count !== 0 || value.unknown_connect_login_count !== 0
    || value.prepared_transaction_count !== 0 || !same(value.role_records, ROLE_RECORDS)
    || !same(value.memberships, MEMBERSHIPS) || !same(value.non_owner_database_acl, [])
    || !same(value.database_owner_privileges, DATABASE_OWNER_PRIVILEGES)) reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], IDENTIFIER, code);
  for (const field of ["execution_authorization_sha256", "fence_sha256"]) digest(value[field], code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  string(value.control_role, ROLE, code);
  integer(value.database_connection_limit, -1, 1_000_000, code);
  integer(value.unknown_connect_acl_count, 0, 1_000_000, code);
  integer(value.unknown_connect_login_count, 0, 1_000_000, code);
  integer(value.prepared_transaction_count, 0, 1_000_000, code);
  instant(value.observed_at, code);
  if (clusterSha256(without(value, "fence_sha256")) !== value.fence_sha256) reject(code);
  return value;
}

export function createUatPromotionMigrationFence(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_MIGRATION_FENCE_CONTRACT, ...input };
  return Object.freeze(validateUatPromotionMigrationFence({ ...body, fence_sha256: clusterSha256(body) }));
}

export function validateUatPromotionMigrationResult(value) {
  const code = "UAT_PROMOTION_MIGRATION_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "migration_approval_receipt_sha256",
    "migration_authorization_binding_sha256", "fence_before", "engine_result", "fence_after",
    "database_fence_binding_sha256", "migration_result_binding_sha256", "committed_at", "result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_MIGRATION_RESULT_CONTRACT
    || value.status !== "MIGRATION_COMMITTED") reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], IDENTIFIER, code);
  for (const field of [
    "execution_authorization_sha256", "grant_sha256", "migration_approval_receipt_sha256",
    "migration_authorization_binding_sha256", "database_fence_binding_sha256",
    "migration_result_binding_sha256", "result_sha256",
  ]) digest(value[field], code);
  const before = validateUatPromotionMigrationFence(value.fence_before);
  const engine = validateUatPromotionMigrationEngineResult(value.engine_result);
  const after = validateUatPromotionMigrationFence(value.fence_after);
  if (before.phase !== "BEFORE" || after.phase !== "AFTER"
    || before.promotion_id !== value.promotion_id || after.promotion_id !== value.promotion_id
    || engine.promotion_id !== value.promotion_id
    || before.migration_operation_id !== value.migration_operation_id
    || after.migration_operation_id !== value.migration_operation_id
    || engine.migration_operation_id !== value.migration_operation_id
    || before.execution_authorization_sha256 !== value.execution_authorization_sha256
    || after.execution_authorization_sha256 !== value.execution_authorization_sha256
    || engine.execution_authorization_sha256 !== value.execution_authorization_sha256
    || engine.grant_sha256 !== value.grant_sha256
    || before.database_name !== engine.database_name || after.database_name !== engine.database_name
    || before.database_system_identifier !== engine.database_system_identifier
    || after.database_system_identifier !== engine.database_system_identifier
    || before.database_oid !== engine.database_oid || after.database_oid !== engine.database_oid
    || before.database_marker !== engine.database_marker || after.database_marker !== engine.database_marker
    || value.database_fence_binding_sha256 !== clusterSha256({ before: before.fence_sha256, after: after.fence_sha256 })
    || value.migration_result_binding_sha256 !== engine.engine_result_sha256) reject(code);
  const committed = Date.parse(instant(value.committed_at, code));
  if (Date.parse(before.observed_at) > Date.parse(engine.started_at)
    || Date.parse(engine.completed_at) > Date.parse(after.observed_at)
    || committed < Date.parse(after.observed_at)
    || clusterSha256(without(value, "result_sha256")) !== value.result_sha256) reject(code);
  return value;
}

export function createUatPromotionMigrationResult(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_MIGRATION_RESULT_CONTRACT,
    status: "MIGRATION_COMMITTED",
    ...input,
    database_fence_binding_sha256: clusterSha256({ before: input.fence_before.fence_sha256, after: input.fence_after.fence_sha256 }),
    migration_result_binding_sha256: input.engine_result.engine_result_sha256,
  };
  return Object.freeze(validateUatPromotionMigrationResult({ ...body, result_sha256: clusterSha256(body) }));
}

export function assertUatPromotionMigrationResultMatchesGrant(resultInput, grantInput) {
  const result = validateUatPromotionMigrationResult(resultInput);
  const grant = validateUatPromotionMigrationGrant(grantInput);
  assertUatPromotionMigrationEngineResultMatchesGrant(result.engine_result, grant);
  if (result.promotion_id !== grant.promotion_id || result.migration_operation_id !== grant.migration_operation_id
    || result.execution_authorization_sha256 !== grant.execution_authorization_sha256
    || result.grant_sha256 !== grant.grant_sha256
    || result.migration_approval_receipt_sha256 !== grant.migration_approval_receipt_sha256
    || result.migration_authorization_binding_sha256 !== grant.migration_authorization_binding_sha256
    || Date.parse(result.fence_before.observed_at) < Date.parse(grant.created_at)
    || Date.parse(result.engine_result.started_at) < Date.parse(grant.created_at)
    || Date.parse(result.engine_result.completed_at) >= Date.parse(grant.expires_at)
    || Date.parse(result.fence_after.observed_at) >= Date.parse(grant.expires_at)
    || Date.parse(result.committed_at) >= Date.parse(grant.expires_at)) {
    reject("UAT_PROMOTION_MIGRATION_RESULT_BINDING_INVALID");
  }
  return result;
}
