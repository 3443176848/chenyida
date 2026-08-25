import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";

export const ISOLATED_UAT_MIGRATION_GRANT_CONTRACT = "chenyida-erp-isolated-uat-migration-execution-grant/v1";
export const ISOLATED_UAT_MIGRATION_ENGINE_RESULT_CONTRACT = "chenyida-erp-isolated-uat-migration-engine-result/v1";
export const ISOLATED_UAT_MIGRATION_EXECUTION_SCOPE = "DEDICATED_ISOLATED_UAT_MIGRATION";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const DEPLOYMENT_ID = /^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$/u;
const DATABASE_MARKER = /^chenyida-erp-deployment\/v2:UAT:chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const ROLE = /^[a-z_][a-z0-9_$-]{0,62}$/u;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,23}$/u;
const OID = /^[1-9][0-9]{0,9}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const IMAGE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;

export class IsolatedUatMigrationExecutionError extends Error {
  constructor(code) {
    super(code);
    this.name = "IsolatedUatMigrationExecutionError";
    this.code = code;
  }
}

function reject(code) { throw new IsolatedUatMigrationExecutionError(code); }
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

export function canonicalIsolatedUatMigrationExecutionJson(value) { return canonicalClusterJson(value); }
export function isolatedUatMigrationExecutionSha256(value) { return clusterSha256(value); }

function validateDatabase(value, code) {
  exactKeys(value, [
    "deployment_class", "deployment_id", "database_name", "database_system_identifier", "database_oid",
    "database_marker", "migration_role", "control_role",
  ], code);
  if (value.deployment_class !== "UAT" || value.database_name !== "chenyida_erp"
    || value.migration_role !== "chenyida_erp_owner" || value.control_role !== "postgres") reject(code);
  string(value.deployment_id, DEPLOYMENT_ID, code);
  if (value.database_marker !== `chenyida-erp-deployment/v2:UAT:${value.deployment_id}`) reject(code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  string(value.database_marker, DATABASE_MARKER, code);
  string(value.migration_role, ROLE, code);
  string(value.control_role, ROLE, code);
  return value;
}

export function validateIsolatedUatMigrationGrant(value) {
  const code = "ISOLATED_UAT_MIGRATION_GRANT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "root_operations_package_sha256", "release_manifest_sha256",
    "worker_image", "migration_manifest_sha256", "expected_current_head", "target_head", "database",
    "created_at", "expires_at", "grant_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_MIGRATION_GRANT_CONTRACT
    || value.execution_scope !== ISOLATED_UAT_MIGRATION_EXECUTION_SCOPE
    || value.expected_current_head !== "EMPTY") reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], IDENTIFIER, code);
  for (const field of [
    "execution_authorization_sha256", "root_operations_package_sha256", "release_manifest_sha256",
    "migration_manifest_sha256", "grant_sha256",
  ]) digest(value[field], code);
  string(value.worker_image, IMAGE, code);
  string(value.target_head, MIGRATION, code);
  validateDatabase(value.database, code);
  const created = Date.parse(instant(value.created_at, code));
  const expires = Date.parse(instant(value.expires_at, code));
  if (expires <= created || expires - created > 15 * 60 * 1000) reject(code);
  if (clusterSha256(without(value, "grant_sha256")) !== value.grant_sha256) reject(code);
  return value;
}

export function createIsolatedUatMigrationGrant(input) {
  const body = {
    schema_version: 1,
    contract: ISOLATED_UAT_MIGRATION_GRANT_CONTRACT,
    execution_scope: ISOLATED_UAT_MIGRATION_EXECUTION_SCOPE,
    ...input,
  };
  return Object.freeze(validateIsolatedUatMigrationGrant({ ...body, grant_sha256: clusterSha256(body) }));
}

function validateFileResult(value, code) {
  exactKeys(value, ["filename", "sha256", "outcome"], code);
  string(value.filename, MIGRATION, code);
  digest(value.sha256, code);
  if (value.outcome !== "APPLIED") reject(code);
  return value;
}

export function validateIsolatedUatMigrationEngineResult(value) {
  const code = "ISOLATED_UAT_MIGRATION_ENGINE_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "database_name", "database_system_identifier",
    "database_oid", "database_marker", "migration_role", "application_name", "current_head_before",
    "target_head", "started_at", "completed_at", "files", "final_migration_rows_sha256",
    "final_migration_rows_count", "other_backend_count_before", "other_backend_count_after",
    "database_default_transaction_read_only", "migration_transaction_read_only", "engine_result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== ISOLATED_UAT_MIGRATION_ENGINE_RESULT_CONTRACT
    || value.status !== "MIGRATION_COMMITTED" || value.application_name !== "chenyida-erp-migration"
    || value.migration_role !== "chenyida_erp_owner" || value.database_name !== "chenyida_erp"
    || value.current_head_before !== "EMPTY"
    || value.database_default_transaction_read_only !== "on"
    || value.migration_transaction_read_only !== "off") reject(code);
  for (const field of ["promotion_id", "migration_operation_id"]) string(value[field], IDENTIFIER, code);
  for (const field of [
    "execution_authorization_sha256", "grant_sha256", "final_migration_rows_sha256", "engine_result_sha256",
  ]) digest(value[field], code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  string(value.database_marker, DATABASE_MARKER, code);
  string(value.migration_role, ROLE, code);
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
  const migrationRows = value.files.map((entry) => ({ version: entry.filename, checksum: entry.sha256 }));
  if (value.other_backend_count_before !== 0 || value.other_backend_count_after !== 0
    || value.final_migration_rows_count !== value.files.length
    || value.final_migration_rows_sha256 !== clusterSha256(migrationRows)
    || value.target_head !== value.files.at(-1).filename
    || clusterSha256(without(value, "engine_result_sha256")) !== value.engine_result_sha256) reject(code);
  return value;
}

export function createIsolatedUatMigrationEngineResult(input) {
  const body = {
    schema_version: 1,
    contract: ISOLATED_UAT_MIGRATION_ENGINE_RESULT_CONTRACT,
    status: "MIGRATION_COMMITTED",
    ...input,
  };
  return Object.freeze(validateIsolatedUatMigrationEngineResult({
    ...body,
    engine_result_sha256: clusterSha256(body),
  }));
}

export function assertIsolatedUatMigrationEngineResultMatchesGrant(resultInput, grantInput) {
  const result = validateIsolatedUatMigrationEngineResult(resultInput);
  const grant = validateIsolatedUatMigrationGrant(grantInput);
  if (result.promotion_id !== grant.promotion_id
    || result.migration_operation_id !== grant.migration_operation_id
    || result.execution_authorization_sha256 !== grant.execution_authorization_sha256
    || result.grant_sha256 !== grant.grant_sha256
    || result.database_name !== grant.database.database_name
    || result.database_system_identifier !== grant.database.database_system_identifier
    || result.database_oid !== grant.database.database_oid
    || result.database_marker !== grant.database.database_marker
    || result.migration_role !== grant.database.migration_role
    || result.current_head_before !== grant.expected_current_head
    || result.target_head !== grant.target_head
    || Date.parse(result.started_at) < Date.parse(grant.created_at)
    || Date.parse(result.completed_at) >= Date.parse(grant.expires_at)) {
    reject("ISOLATED_UAT_MIGRATION_ENGINE_RESULT_BINDING_INVALID");
  }
  return result;
}
