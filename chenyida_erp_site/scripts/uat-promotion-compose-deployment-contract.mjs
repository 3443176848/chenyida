import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";

export const UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-compose-deployment-result/v1";
export const UAT_PROMOTION_ACTIVE_MIGRATION_FENCE_CONTRACT =
  "chenyida-erp-uat-promotion-active-migration-fence/v1";
export const UAT_PROMOTION_DATABASE_HANDOFF_CONTRACT =
  "chenyida-erp-uat-promotion-database-runtime-handoff/v1";
export const UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_CONTRACT =
  "chenyida-erp-uat-promotion-active-fence-transfer/v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,29}$/u;
const OID = /^[1-9][0-9]{0,9}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EXPECTED_CONNECT_ROLES = Object.freeze([
  "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web",
  "chenyida_erp_worker",
]);

export class UatPromotionComposeDeploymentError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionComposeDeploymentError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionComposeDeploymentError(code); }
function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function string(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}
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
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }

export function composeDeploymentSha256(value) { return clusterSha256(value); }
export function canonicalComposeDeploymentJson(value) { return canonicalClusterJson(value); }

export function validateUatPromotionActiveMigrationFence(value) {
  const code = "UAT_PROMOTION_ACTIVE_MIGRATION_FENCE_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "database_name",
    "database_system_identifier", "database_oid", "database_marker",
    "released_baseline_sha256", "fence_before_sha256", "activated_at", "active_fence_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ACTIVE_MIGRATION_FENCE_CONTRACT
    || value.status !== "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION"
    || value.database_name !== "chenyida_erp"
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp") reject(code);
  string(value.promotion_id, IDENTIFIER, code);
  string(value.migration_operation_id, IDENTIFIER, code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  for (const field of [
    "execution_authorization_sha256", "grant_sha256", "released_baseline_sha256",
    "fence_before_sha256", "active_fence_sha256",
  ]) digest(value[field], code);
  instant(value.activated_at, code);
  if (clusterSha256(without(value, "active_fence_sha256")) !== value.active_fence_sha256) reject(code);
  return value;
}

function validateService(value, expectedService, code) {
  exactKeys(value, [
    "service", "container_id", "container_name", "image_id", "image_reference",
    "compose_config_sha256", "running", "health", "restart_count", "oom_killed",
  ], code);
  if (value.service !== expectedService || value.container_name !== `chenyida-erp-${expectedService}-1`
    || value.running !== true || value.health !== "healthy" || value.oom_killed !== false) reject(code);
  string(value.container_id, CONTAINER_ID, code);
  string(value.image_id, IMAGE_ID, code);
  string(value.image_reference, IMAGE_REFERENCE, code);
  digest(value.compose_config_sha256, code);
  integer(value.restart_count, 0, 1_000_000, code);
  if (value.restart_count !== 0) reject(code);
  return value;
}

function validateUnchangedService(value, expectedService, code) {
  exactKeys(value, [
    "service", "container_id", "container_name", "image_id", "image_reference",
    "compose_config_sha256", "pre_identity_sha256", "post_identity_sha256",
    "restart_count", "oom_killed", "running", "health",
  ], code);
  if (value.service !== expectedService || value.container_name !== `chenyida-erp-${expectedService}-1`
    || value.running !== true || value.oom_killed !== false) reject(code);
  if (expectedService === "postgres" && value.health !== "healthy"
    || expectedService === "caddy" && value.health !== "none") reject(code);
  string(value.container_id, CONTAINER_ID, code);
  string(value.image_id, IMAGE_ID, code);
  string(value.image_reference, IMAGE_REFERENCE, code);
  for (const field of ["compose_config_sha256", "pre_identity_sha256", "post_identity_sha256"]) {
    digest(value[field], code);
  }
  if (value.pre_identity_sha256 !== value.post_identity_sha256) reject(code);
  integer(value.restart_count, 0, 1_000_000, code);
  return value;
}

export function validateUatPromotionDatabaseHandoff(value) {
  const code = "UAT_PROMOTION_DATABASE_HANDOFF_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "deployment_operation_id",
    "database_name", "database_system_identifier", "database_oid", "database_marker",
    "active_fence_sha256", "released_baseline_sha256", "sealed_probe_sha256",
    "runtime_probe_sha256", "database_allow_connections", "database_connection_limit",
    "default_transaction_read_only", "connect_roles", "unknown_connect_login_count",
    "prepared_transaction_count", "handed_off_at", "handoff_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_DATABASE_HANDOFF_CONTRACT
    || value.status !== "RUNTIME_BASELINE_RESTORED_UNDER_DEPLOYMENT_CONTROL"
    || value.database_name !== "chenyida_erp"
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.database_allow_connections !== true || value.database_connection_limit !== 64
    || value.default_transaction_read_only !== "RESET"
    || !same(value.connect_roles, EXPECTED_CONNECT_ROLES)
    || value.unknown_connect_login_count !== 0 || value.prepared_transaction_count !== 0) reject(code);
  string(value.promotion_id, IDENTIFIER, code);
  string(value.deployment_operation_id, IDENTIFIER, code);
  string(value.database_system_identifier, SYSTEM_IDENTIFIER, code);
  string(value.database_oid, OID, code);
  for (const field of [
    "active_fence_sha256", "released_baseline_sha256", "sealed_probe_sha256",
    "runtime_probe_sha256", "handoff_sha256",
  ]) digest(value[field], code);
  instant(value.handed_off_at, code);
  if (clusterSha256(without(value, "handoff_sha256")) !== value.handoff_sha256) reject(code);
  return value;
}

export function createUatPromotionDatabaseHandoff(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_DATABASE_HANDOFF_CONTRACT,
    status: "RUNTIME_BASELINE_RESTORED_UNDER_DEPLOYMENT_CONTROL",
    ...input,
  };
  return Object.freeze(validateUatPromotionDatabaseHandoff({
    ...body,
    handoff_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionComposeDeploymentResult(value) {
  const code = "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "deployment_operation_id",
    "execution_authorization_sha256", "supervisor_bundle_sha256", "release_manifest_sha256",
    "migration_operation_id", "migration_execution_authorization_sha256", "migration_grant_sha256",
    "migration_result_sha256", "active_fence_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "deployment_plan_sha256", "compose_project",
    "compose_project_root", "old_runtime_sha256", "created_runtime_sha256",
    "committed_runtime_sha256", "protected_resources_before_sha256",
    "protected_resources_after_sha256", "runtime_configuration_sha256", "readiness_sha256",
    "database_handoff", "services", "unchanged_services", "started_at", "completed_at",
    "result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_CONTRACT
    || value.status !== "COMPOSE_DEPLOYMENT_COMMITTED" || value.compose_project !== "chenyida-erp"
    || typeof value.compose_project_root !== "string" || !value.compose_project_root.startsWith("/")) reject(code);
  for (const field of ["promotion_id", "deployment_operation_id", "migration_operation_id"]) {
    string(value[field], IDENTIFIER, code);
  }
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "release_manifest_sha256",
    "migration_execution_authorization_sha256", "migration_grant_sha256", "migration_result_sha256",
    "active_fence_sha256", "migration_fence_binding_sha256", "migration_result_binding_sha256",
    "deployment_plan_sha256", "old_runtime_sha256", "created_runtime_sha256",
    "committed_runtime_sha256", "protected_resources_before_sha256",
    "protected_resources_after_sha256", "runtime_configuration_sha256", "readiness_sha256",
    "result_sha256",
  ]) digest(value[field], code);
  if (value.protected_resources_before_sha256 !== value.protected_resources_after_sha256) reject(code);
  validateUatPromotionDatabaseHandoff(value.database_handoff);
  if (!Array.isArray(value.services) || value.services.length !== 2
    || !Array.isArray(value.unchanged_services) || value.unchanged_services.length !== 2) reject(code);
  validateService(value.services[0], "web", code);
  validateService(value.services[1], "worker", code);
  validateUnchangedService(value.unchanged_services[0], "caddy", code);
  validateUnchangedService(value.unchanged_services[1], "postgres", code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  if (completed < started || value.database_handoff.promotion_id !== value.promotion_id
    || value.database_handoff.deployment_operation_id !== value.deployment_operation_id
    || value.database_handoff.active_fence_sha256 !== value.active_fence_sha256
    || clusterSha256(without(value, "result_sha256")) !== value.result_sha256) reject(code);
  return value;
}

export function createUatPromotionComposeDeploymentResult(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_CONTRACT,
    status: "COMPOSE_DEPLOYMENT_COMMITTED",
    ...input,
  };
  return Object.freeze(validateUatPromotionComposeDeploymentResult({
    ...body,
    result_sha256: clusterSha256(body),
  }));
}

export function assertUatPromotionComposeDeploymentResultMatchesIntent(resultInput, intentInput) {
  const result = validateUatPromotionComposeDeploymentResult(resultInput);
  const code = "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_BINDING_INVALID";
  const intent = record(intentInput, code);
  const parameters = record(intent.parameters, code);
  if (result.promotion_id !== intent.promotion_id
    || result.deployment_operation_id !== intent.deployment_operation_id
    || result.execution_authorization_sha256 !== intent.execution_authorization_sha256
    || result.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256
    || result.release_manifest_sha256 !== parameters.release_manifest_sha256
    || result.migration_operation_id !== parameters.migration_operation_id
    || result.migration_execution_authorization_sha256 !== parameters.migration_execution_authorization_sha256
    || result.migration_grant_sha256 !== parameters.migration_grant_sha256
    || result.migration_result_sha256 !== parameters.migration_result_sha256
    || result.active_fence_sha256 !== parameters.active_migration_fence_sha256
    || result.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || result.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || result.deployment_plan_sha256 !== intent.deployment_plan_sha256
    || result.compose_project !== parameters.compose_project
    || result.compose_project_root !== parameters.compose_project_root
    || result.database_handoff.database_name !== parameters.database_name
    || result.database_handoff.database_system_identifier !== parameters.database_system_identifier
    || result.database_handoff.database_oid !== parameters.database_oid
    || result.database_handoff.database_marker !== parameters.database_marker
    || result.database_handoff.released_baseline_sha256 !== intent.released_baseline_sha256
    || result.database_handoff.sealed_probe_sha256 !== intent.sealed_database_fence_sha256
    || result.services[0].image_reference !== parameters.web_image
    || result.services[1].image_reference !== parameters.worker_image
    || Date.parse(result.started_at) < Date.parse(intent.created_at)
    || Date.parse(result.completed_at) >= Date.parse(intent.expires_at)) reject(code);
  return result;
}

export function validateUatPromotionActiveFenceTransfer(value) {
  const code = "UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "deployment_operation_id", "migration_execution_authorization_sha256",
    "deployment_authorization_sha256", "active_fence_sha256", "migration_result_sha256",
    "deployment_result_sha256", "database_handoff_sha256", "runtime_configuration_sha256",
    "transferred_at", "transfer_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_CONTRACT
    || value.status !== "TRANSFERRED_TO_CHECKPOINT_9_COMPOSE_DEPLOYMENT") reject(code);
  for (const field of ["promotion_id", "migration_operation_id", "deployment_operation_id"]) {
    string(value[field], IDENTIFIER, code);
  }
  for (const field of [
    "migration_execution_authorization_sha256", "deployment_authorization_sha256",
    "active_fence_sha256", "migration_result_sha256", "deployment_result_sha256",
    "database_handoff_sha256", "runtime_configuration_sha256", "transfer_sha256",
  ]) digest(value[field], code);
  instant(value.transferred_at, code);
  if (clusterSha256(without(value, "transfer_sha256")) !== value.transfer_sha256) reject(code);
  return value;
}

export function createUatPromotionActiveFenceTransfer(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_CONTRACT,
    status: "TRANSFERRED_TO_CHECKPOINT_9_COMPOSE_DEPLOYMENT",
    ...input,
  };
  return Object.freeze(validateUatPromotionActiveFenceTransfer({
    ...body,
    transfer_sha256: clusterSha256(body),
  }));
}

export function assertUatPromotionActiveFenceTransferMatchesResult(transferInput, resultInput, intentInput) {
  const transfer = validateUatPromotionActiveFenceTransfer(transferInput);
  const result = validateUatPromotionComposeDeploymentResult(resultInput);
  const code = "UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_BINDING_INVALID";
  const intent = record(intentInput, code);
  const parameters = record(intent.parameters, code);
  if (transfer.promotion_id !== result.promotion_id
    || transfer.promotion_id !== intent.promotion_id
    || transfer.migration_operation_id !== result.migration_operation_id
    || transfer.migration_operation_id !== parameters.migration_operation_id
    || transfer.deployment_operation_id !== result.deployment_operation_id
    || transfer.deployment_operation_id !== intent.deployment_operation_id
    || transfer.migration_execution_authorization_sha256 !== result.migration_execution_authorization_sha256
    || transfer.deployment_authorization_sha256 !== result.execution_authorization_sha256
    || transfer.active_fence_sha256 !== result.active_fence_sha256
    || transfer.migration_result_sha256 !== result.migration_result_sha256
    || transfer.deployment_result_sha256 !== result.result_sha256
    || transfer.database_handoff_sha256 !== result.database_handoff.handoff_sha256
    || transfer.runtime_configuration_sha256 !== result.runtime_configuration_sha256
    || Date.parse(transfer.transferred_at) < Date.parse(result.completed_at)
    || Date.parse(transfer.transferred_at) >= Date.parse(intent.expires_at)) reject(code);
  return transfer;
}
