import path from "node:path";

import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { validatePostDeployReadiness } from "./postdeploy-release-contract.mjs";

const HEALTH_DATABASE_TIME_MAX_SKEW_MS = 5_000;

export const UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-execution-package/v3";
export const UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-stage-intent/v2";
export const UAT_PROMOTION_ROLLBACK_STAGE_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-stage-result/v6";
export const UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-check-intent/v2";
export const UAT_PROMOTION_ROLLBACK_CHECK_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-check-result/v6";
export const UAT_PROMOTION_ROLLBACK_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-result/v6";
export const UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-postverify-result/v6";

export const UAT_PROMOTION_ROLLBACK_STAGES = Object.freeze([
  "PRECONDITION_RECHECK",
  "WRITER_CONTAINMENT",
  "POSTGRESQL_RESTORE",
  "UPLOADS_RESTORE",
  "ATTACHMENTS_RESTORE",
  "BACKUP_STATUS_RESTORE",
  "RUNTIME_CONFIGURATION_RESTORE",
  "WEB_WORKER_PREDECESSOR_ACTIVATION",
  "PROTECTED_RESOURCE_RECHECK",
]);

export const UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS = Object.freeze([
  "POSTGRESQL_CONTENT",
  "UPLOADS_CONTENT",
  "ATTACHMENTS_CONTENT",
  "BACKUP_STATUS_CONTENT",
  "MIGRATION_HEAD",
  "CADDY_IDENTITY",
  "POSTGRES_IDENTITY",
  "WEB_IDENTITY",
  "WORKER_IDENTITY",
  "RUNTIME_CONFIGURATION",
  "STRICT_RELEASE_IDENTITY",
  "HEALTH",
  "PROTECTED_RESOURCES",
]);

export const UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES = Object.freeze([
  "snapshot_readiness",
  "snapshot_manifest",
  "snapshot_migrations",
  "snapshot_reconciliation",
  "snapshot_postgresql",
  "snapshot_uploads",
  "snapshot_attachments",
  "snapshot_backup_status",
  "snapshot_policy",
  "snapshot_policy_activation",
  "snapshot_runtime_privilege_access",
  "snapshot_runtime_privilege_compiled_catalog",
  "snapshot_runtime_privilege_policy",
  "snapshot_runtime_privilege_operator_policy",
  "predecessor_postdeploy_receipt",
  "predecessor_release_manifest",
  "candidate_deployment_result",
  "candidate_postdeploy_identity",
  "compose_file",
  "compose_release_file",
  "deployment_environment",
  "runtime_policy",
  "runtime_adapter_activation",
]);

export const UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES = Object.freeze({
  database: "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
  file_domains: "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
  runtime: "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
});
export const UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION =
  "RESTORED_HISTORICAL_EVIDENCE_REQUIRES_NEW_POST_ROLLBACK_BACKUP";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^0\.1\.0-alpha\.\d+$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const NUMERIC = /^(?:0|[1-9][0-9]*)$/u;
const SOURCE_FIELDS = Object.freeze([
  "path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink",
]);
const SNAPSHOT_FILES = Object.freeze({
  postgresql: "postgresql.dump",
  uploads: "uploads.tar.gz",
  attachments: "attachments.tar.gz",
  backup_status: "backup-status.tar.gz",
});
const ZERO_SHA256 = "0".repeat(64);
const RESTORED_STAGING_MARKER =
  /^chenyida-erp-uat-rollback\/v1:[A-Za-z0-9][A-Za-z0-9._-]{0,119}:RESTORED_STAGING$/u;
const CANDIDATE_QUARANTINE_MARKER =
  /^chenyida-erp-uat-rollback\/v1:[A-Za-z0-9][A-Za-z0-9._-]{0,119}:CANDIDATE_QUARANTINE$/u;

export class UatPromotionRollbackError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionRollbackError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionRollbackError(code); }
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
function nonZeroDigest(value, code) {
  digest(value, code);
  if (value === ZERO_SHA256) reject(code);
  return value;
}
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
function normalizedAbsolute(value, code) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value
    || value === "/" || value.includes("\u0000")) reject(code);
  return value;
}

export function rollbackSha256(value) { return clusterSha256(value); }
export function canonicalRollbackJson(value) { return canonicalClusterJson(value); }

export function validateUatPromotionRollbackSourceSpec(
  value, code = "UAT_PROMOTION_ROLLBACK_SOURCE_INVALID",
) {
  exactKeys(value, SOURCE_FIELDS, code);
  normalizedAbsolute(value.path, code);
  digest(value.sha256, code);
  integer(value.bytes, 1, Number.MAX_SAFE_INTEGER, code);
  for (const field of ["device", "inode"]) string(value[field], NUMERIC, code);
  if (value.device === "0" || value.inode === "0" || value.uid !== 0 || value.nlink !== 1
    || !Number.isSafeInteger(value.gid) || value.gid < 0 || value.gid > 0x7fffffff
    || !new Set(["0400", "0440", "0444"]).has(value.mode)) reject(code);
  return value;
}

export function validateUatPromotionRollbackSnapshotObjects(
  value, code = "UAT_PROMOTION_ROLLBACK_SNAPSHOT_OBJECTS_INVALID",
) {
  exactKeys(value, Object.keys(SNAPSHOT_FILES), code);
  for (const [domain, file] of Object.entries(SNAPSHOT_FILES)) {
    const object = record(value[domain], code);
    exactKeys(object, ["file", "sha256", "bytes", "entries"], code);
    if (object.file !== file) reject(code);
    digest(object.sha256, code);
    integer(object.bytes, 1, Number.MAX_SAFE_INTEGER, code);
    if (domain === "postgresql") {
      if (object.entries !== null) reject(code);
    } else integer(object.entries, 0, Number.MAX_SAFE_INTEGER, code);
  }
  return value;
}

export function validateUatPromotionRollbackPredecessor(
  value, code = "UAT_PROMOTION_ROLLBACK_PREDECESSOR_INVALID",
) {
  exactKeys(value, [
    "git_commit", "git_tree", "application_version", "release_manifest_sha256",
    "web_image", "worker_image", "migration_head", "migration_manifest_sha256",
    "runtime_configuration_sha256",
  ], code);
  string(value.git_commit, COMMIT, code);
  string(value.git_tree, COMMIT, code);
  string(value.application_version, VERSION, code);
  string(value.web_image, IMAGE_REFERENCE, code);
  string(value.worker_image, IMAGE_REFERENCE, code);
  string(value.migration_head, MIGRATION, code);
  for (const field of [
    "release_manifest_sha256", "migration_manifest_sha256", "runtime_configuration_sha256",
  ]) digest(value[field], code);
  return value;
}

export function validateUatPromotionRollbackDatabase(
  value, code = "UAT_PROMOTION_ROLLBACK_DATABASE_INVALID",
) {
  exactKeys(value, ["name", "system_identifier", "oid", "marker"], code);
  if (value.name !== "chenyida_erp"
    || value.marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || typeof value.system_identifier !== "string" || !/^[1-9][0-9]{9,29}$/u.test(value.system_identifier)
    || typeof value.oid !== "string" || !/^[1-9][0-9]{0,9}$/u.test(value.oid)) reject(code);
  return value;
}

function validateCandidateDatabaseQuarantine(value, code) {
  exactKeys(value, ["name", "oid"], code);
  string(value.name, DATABASE_IDENTIFIER, code);
  string(value.oid, /^[1-9][0-9]{0,9}$/u, code);
  if (value.name === "chenyida_erp") reject(code);
  return value;
}

export function validateUatPromotionRollbackBoundary(
  value, code = "UAT_PROMOTION_ROLLBACK_BOUNDARY_INVALID",
) {
  exactKeys(value, [
    "environment_restore", "posted_business_reversal", "down_migration", "direct_sql_correction",
    "business_fact_deletion", "automatic_business_compensation",
  ], code);
  if (value.environment_restore !== "EXACT_PREUPGRADE_SNAPSHOT_AND_PREDECESSOR_RUNTIME_ONLY"
    || value.posted_business_reversal !== "NOT_PERFORMED_REQUIRES_SEPARATE_BUSINESS_AUTHORIZATION"
    || value.down_migration !== false || value.direct_sql_correction !== false
    || value.business_fact_deletion !== false || value.automatic_business_compensation !== false) reject(code);
  return value;
}

export function validateUatPromotionRollbackContentReconciliation(
  value, code = "UAT_PROMOTION_ROLLBACK_CONTENT_RECONCILIATION_INVALID",
) {
  exactKeys(value, [
    "source_reconciliation_sha256", "database", "files", "binding_sha256",
  ], code);
  digest(value.source_reconciliation_sha256, code);
  exactKeys(value.database, ["report_sha256"], code);
  digest(value.database.report_sha256, code);
  exactKeys(value.files, ["uploads", "attachments", "backup_status"], code);
  for (const domain of ["uploads", "attachments", "backup_status"]) {
    exactKeys(value.files[domain], ["tree_sha256", "entries"], code);
    digest(value.files[domain].tree_sha256, code);
    integer(value.files[domain].entries, 0, Number.MAX_SAFE_INTEGER, code);
  }
  digest(value.binding_sha256, code);
  if (clusterSha256(without(value, "binding_sha256")) !== value.binding_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackContentReconciliation(input) {
  const body = { ...input };
  return Object.freeze(validateUatPromotionRollbackContentReconciliation({
    ...body,
    binding_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionRollbackExecutionPackage(value) {
  const code = "UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "promotion_id", "promotion_generation", "rollback_operation_id",
    "created_at", "execution_deadline", "snapshot_readiness_sha256", "snapshot_objects",
    "snapshot_objects_sha256", "predecessor", "predecessor_sha256", "database",
    "database_snapshot_sha256", "boundary", "content_reconciliation",
    "protected_resources_sha256", "runtime_plan_sha256",
    "compose_project", "compose_project_root", "restore_strategies", "sources",
    "source_set_sha256", "package_sha256",
  ], code);
  if (value.schema_version !== 3 || value.contract !== UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_CONTRACT
    || value.compose_project !== "chenyida-erp") reject(code);
  string(value.promotion_id, IDENTIFIER, code);
  string(value.rollback_operation_id, IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  const created = Date.parse(instant(value.created_at, code));
  const deadline = Date.parse(instant(value.execution_deadline, code));
  if (deadline <= created || deadline - created > 2 * 60 * 60 * 1000) reject(code);
  normalizedAbsolute(value.compose_project_root, code);
  for (const field of [
    "snapshot_readiness_sha256", "snapshot_objects_sha256", "predecessor_sha256",
    "database_snapshot_sha256", "protected_resources_sha256", "runtime_plan_sha256",
    "source_set_sha256", "package_sha256",
  ]) digest(value[field], code);
  validateUatPromotionRollbackSnapshotObjects(value.snapshot_objects, code);
  validateUatPromotionRollbackPredecessor(value.predecessor, code);
  validateUatPromotionRollbackDatabase(value.database, code);
  validateUatPromotionRollbackBoundary(value.boundary, code);
  validateUatPromotionRollbackContentReconciliation(value.content_reconciliation, code);
  exactKeys(value.restore_strategies, Object.keys(UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES), code);
  if (!same(value.restore_strategies, UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES)) reject(code);
  exactKeys(value.sources, UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES, code);
  const paths = new Set();
  for (const role of UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES) {
    validateUatPromotionRollbackSourceSpec(value.sources[role], code);
    if (paths.has(value.sources[role].path)) reject(code);
    paths.add(value.sources[role].path);
  }
  if (value.snapshot_objects_sha256 !== clusterSha256(value.snapshot_objects)
    || value.predecessor_sha256 !== clusterSha256(value.predecessor)
    || value.database_snapshot_sha256 !== clusterSha256(value.database)
    || value.content_reconciliation.source_reconciliation_sha256
      !== value.sources.snapshot_reconciliation.sha256
    || ["uploads", "attachments", "backup_status"].some((domain) => (
      value.content_reconciliation.files[domain].entries !== value.snapshot_objects[domain].entries
    ))
    || value.source_set_sha256 !== clusterSha256(value.sources)
    || value.package_sha256 !== clusterSha256(without(value, "package_sha256"))) reject(code);
  return value;
}

export function createUatPromotionRollbackExecutionPackage(input) {
  const body = {
    schema_version: 3,
    contract: UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_CONTRACT,
    ...input,
  };
  return Object.freeze(validateUatPromotionRollbackExecutionPackage({
    ...body, package_sha256: clusterSha256(body),
  }));
}

export function assertUatPromotionRollbackExecutionPackageMatchesParameters(packageInput, parameters) {
  const value = validateUatPromotionRollbackExecutionPackage(packageInput);
  const code = "UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_BINDING_INVALID";
  if (value.promotion_id !== parameters.promotion_id
    || value.promotion_generation !== parameters.promotion_generation
    || value.rollback_operation_id !== parameters.rollback_id
    || value.created_at !== parameters.rollback_created_at
    || value.execution_deadline !== parameters.execution_deadline
    || value.snapshot_readiness_sha256 !== parameters.snapshot_readiness_sha256
    || !same(value.snapshot_objects, parameters.snapshot_objects)
    || value.snapshot_objects_sha256 !== clusterSha256(parameters.snapshot_objects)
    || !same(value.predecessor, parameters.predecessor)
    || value.predecessor_sha256 !== clusterSha256(parameters.predecessor)
    || !same(value.database, parameters.database)
    || value.database_snapshot_sha256 !== clusterSha256(parameters.database)
    || !same(value.boundary, parameters.boundary)
    || value.compose_project !== parameters.compose_project
    || value.compose_project_root !== parameters.compose_project_root
    || value.sources.predecessor_postdeploy_receipt.sha256
      !== parameters.predecessor_postdeploy_receipt_sha256
    || value.sources.predecessor_release_manifest.sha256
      !== parameters.predecessor_release_manifest_sha256
    || value.package_sha256 !== parameters.execution_package_sha256) reject(code);
  return value;
}

function validateServiceObservation(value, imageField, imagePattern, code) {
  exactKeys(value, [
    "container_id", imageField, "running", "healthy", "restart_count", "oom_killed",
  ], code);
  string(value.container_id, CONTAINER_ID, code);
  string(value[imageField], imagePattern, code);
  if (value.running !== true || value.healthy !== true || value.oom_killed !== false) reject(code);
  if (value.restart_count !== 0) reject(code);
}

function validateApplicationServiceObservation(value, code) {
  exactKeys(value, [
    "container_id", "image_reference", "image_config_digest", "running", "healthy",
    "restart_count", "oom_killed",
  ], code);
  string(value.container_id, CONTAINER_ID, code);
  string(value.image_reference, IMAGE_REFERENCE, code);
  string(value.image_config_digest, IMAGE_DIGEST, code);
  if (value.running !== true || value.healthy !== true || value.oom_killed !== false
    || value.restart_count !== 0) reject(code);
}

function validatePreactivationContentProof(value, code) {
  exactKeys(value, [
    "schema_version", "contract", "binding_sha256", "runtime_plan_sha256",
    "source_reconciliation_sha256", "source_database_report_sha256",
    "live_database_report_sha256", "migration_head", "migration_ledger_file_sha256",
    "migration_allowlist_sha256", "migration_ledger_sha256", "live_security_state_sha256",
    "active_allowed_session_role_set_sha256", "active_session_client_policy_sha256",
    "active_session_observation_sha256", "active_writer_session_count",
    "active_database_identity_sha256", "restored_database_oid",
    "restored_database_marker", "system_identifier", "active_allow_connections",
    "active_connection_limit", "active_default_transaction_read_only",
    "active_prepared_xacts", "candidate_database_quarantine_name",
    "candidate_database_quarantine_oid", "candidate_database_quarantine_marker",
    "candidate_database_quarantine_allow_connections",
    "candidate_database_quarantine_connection_limit",
    "candidate_database_quarantine_sessions",
    "candidate_database_quarantine_prepared_xacts", "before_observation_sha256",
    "after_observation_sha256", "proof_sha256",
  ], code);
  if (value.schema_version !== 1
    || value.contract !== "chenyida-erp-uat-promotion-rollback-preactivation-content-proof/v2"
    || value.source_database_report_sha256 !== value.live_database_report_sha256
    || value.active_allow_connections !== true
    || value.active_default_transaction_read_only !== false
    || value.candidate_database_quarantine_allow_connections !== false
    || value.restored_database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp") reject(code);
  for (const field of [
    "binding_sha256", "runtime_plan_sha256", "source_reconciliation_sha256",
    "source_database_report_sha256", "live_database_report_sha256",
    "migration_ledger_file_sha256", "migration_allowlist_sha256",
    "migration_ledger_sha256", "live_security_state_sha256",
    "active_allowed_session_role_set_sha256", "active_session_client_policy_sha256",
    "active_session_observation_sha256", "active_database_identity_sha256",
    "before_observation_sha256", "after_observation_sha256", "proof_sha256",
  ]) nonZeroDigest(value[field], code);
  string(value.migration_head, MIGRATION, code);
  string(value.restored_database_oid, /^[1-9][0-9]{0,9}$/u, code);
  string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
  string(value.candidate_database_quarantine_name, DATABASE_IDENTIFIER, code);
  string(value.candidate_database_quarantine_oid, /^[1-9][0-9]{0,9}$/u, code);
  string(value.candidate_database_quarantine_marker, CANDIDATE_QUARANTINE_MARKER, code);
  integer(value.active_writer_session_count, 0, 0, code);
  integer(value.active_connection_limit, 64, 64, code);
  integer(value.active_prepared_xacts, 0, 0, code);
  integer(value.candidate_database_quarantine_connection_limit, 0, 0, code);
  integer(value.candidate_database_quarantine_sessions, 0, 0, code);
  integer(value.candidate_database_quarantine_prepared_xacts, 0, 0, code);
  if (clusterSha256(without(value, "proof_sha256")) !== value.proof_sha256) reject(code);
}

function validateStagingContentProof(value, code) {
  exactKeys(value, [
    "schema_version", "contract", "binding_sha256", "base_spec_sha256",
    "runtime_plan_sha256", "source_reconciliation_sha256",
    "source_database_report_sha256", "live_database_report_sha256",
    "migration_head", "migration_ledger_file_sha256", "migration_allowlist_sha256",
    "migration_ledger_sha256", "live_security_state_sha256",
    "staging_allowed_session_role_set_sha256", "staging_session_client_policy_sha256",
    "staging_session_observation_sha256", "staging_writer_session_count",
    "staging_database_identity_sha256", "staging_database_name", "staging_database_oid",
    "staging_database_marker", "system_identifier", "staging_allow_connections",
    "staging_connection_limit", "staging_default_transaction_read_only",
    "staging_prepared_xacts", "candidate_database_name", "candidate_database_oid",
    "candidate_database_marker", "candidate_database_allow_connections",
    "candidate_database_connection_limit", "candidate_database_sessions",
    "candidate_database_prepared_xacts", "before_observation_sha256",
    "after_observation_sha256", "proof_sha256",
  ], code);
  if (value.schema_version !== 1
    || value.contract !== "chenyida-erp-uat-promotion-rollback-staging-content-proof/v1"
    || value.source_database_report_sha256 !== value.live_database_report_sha256
    || value.staging_writer_session_count !== 0
    || value.staging_allow_connections !== true
    || value.staging_connection_limit !== 0
    || value.staging_default_transaction_read_only !== true
    || value.staging_prepared_xacts !== 0
    || value.candidate_database_name !== "chenyida_erp"
    || value.candidate_database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.candidate_database_allow_connections !== false
    || value.candidate_database_connection_limit !== 0
    || value.candidate_database_sessions !== 0
    || value.candidate_database_prepared_xacts !== 0
    || value.staging_database_name === value.candidate_database_name
    || value.staging_database_oid === value.candidate_database_oid) reject(code);
  for (const field of [
    "binding_sha256", "base_spec_sha256", "runtime_plan_sha256",
    "source_reconciliation_sha256", "source_database_report_sha256",
    "live_database_report_sha256", "migration_ledger_file_sha256",
    "migration_allowlist_sha256", "migration_ledger_sha256",
    "live_security_state_sha256", "staging_allowed_session_role_set_sha256",
    "staging_session_client_policy_sha256", "staging_session_observation_sha256",
    "staging_database_identity_sha256", "before_observation_sha256",
    "after_observation_sha256", "proof_sha256",
  ]) nonZeroDigest(value[field], code);
  string(value.migration_head, MIGRATION, code);
  string(value.staging_database_name, DATABASE_IDENTIFIER, code);
  string(value.staging_database_oid, /^[1-9][0-9]{0,9}$/u, code);
  string(value.staging_database_marker, RESTORED_STAGING_MARKER, code);
  string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
  string(value.candidate_database_oid, /^[1-9][0-9]{0,9}$/u, code);
  integer(value.staging_writer_session_count, 0, 0, code);
  integer(value.staging_connection_limit, 0, 0, code);
  integer(value.staging_prepared_xacts, 0, 0, code);
  integer(value.candidate_database_connection_limit, 0, 0, code);
  integer(value.candidate_database_sessions, 0, 0, code);
  integer(value.candidate_database_prepared_xacts, 0, 0, code);
  if (value.staging_database_identity_sha256 !== clusterSha256({
    name: value.staging_database_name,
    system_identifier: value.system_identifier,
    oid: value.staging_database_oid,
    marker: value.staging_database_marker,
  }) || clusterSha256(without(value, "proof_sha256")) !== value.proof_sha256) reject(code);
  return value;
}

function validateRestorePreconditionProof(value, code) {
  exactKeys(value, [
    "schema_version", "contract", "base_spec_sha256", "opcode_spec_sha256",
    "binding_sha256", "create_receipt_sha256", "dump_inventory_sha256",
    "system_identifier", "server_version_num", "database",
    "database_identity_sha256", "profile", "profile_sha256",
    "empty_projection", "empty_projection_sha256", "raw_observation_sha256",
    "restore_precondition_sha256",
  ], code);
  exactKeys(value.database, [
    "name", "oid", "marker", "owner", "allow_connections", "connection_limit",
    "default_transaction_read_only", "sessions", "prepared_xacts",
  ], code);
  exactKeys(value.profile, [
    "encoding", "locale_provider", "collate", "ctype", "collation_version",
    "default_tablespace",
  ], code);
  exactKeys(value.empty_projection, [
    "user_schema_count", "relation_count", "sequence_count", "routine_count",
    "standalone_type_count", "unexpected_extension_count", "large_object_count",
    "schema_migrations_present",
  ], code);
  if (value.schema_version !== 1
    || value.contract !== "chenyida-erp-uat-rollback-postgresql-restore-precondition/v1"
    || value.binding_sha256 !== value.create_receipt_sha256
    || value.database.owner !== "postgres"
    || value.database.allow_connections !== true
    || value.database.connection_limit !== 0
    || value.database.default_transaction_read_only !== true
    || value.database.sessions !== 0
    || value.database.prepared_xacts !== 0
    || value.profile.locale_provider !== "libc"
    || value.profile.default_tablespace !== "pg_default"
    || value.empty_projection.user_schema_count !== 0
    || value.empty_projection.relation_count !== 0
    || value.empty_projection.sequence_count !== 0
    || value.empty_projection.routine_count !== 0
    || value.empty_projection.standalone_type_count !== 0
    || value.empty_projection.unexpected_extension_count !== 0
    || value.empty_projection.large_object_count !== 0
    || value.empty_projection.schema_migrations_present !== false) reject(code);
  for (const field of [
    "base_spec_sha256", "opcode_spec_sha256", "binding_sha256",
    "create_receipt_sha256", "dump_inventory_sha256", "database_identity_sha256",
    "profile_sha256", "empty_projection_sha256", "raw_observation_sha256",
    "restore_precondition_sha256",
  ]) nonZeroDigest(value[field], code);
  string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
  string(value.server_version_num, /^17[0-9]{4}$/u, code);
  string(value.database.name, DATABASE_IDENTIFIER, code);
  string(value.database.oid, /^[1-9][0-9]{0,9}$/u, code);
  string(value.database.marker, RESTORED_STAGING_MARKER, code);
  for (const field of [
    "encoding", "locale_provider", "collate", "ctype", "default_tablespace",
  ]) {
    if (typeof value.profile[field] !== "string"
      || value.profile[field].length < 1 || value.profile[field].length > 120) reject(code);
  }
  if (value.profile.collation_version !== null
    && (typeof value.profile.collation_version !== "string"
      || value.profile.collation_version.length < 1
      || value.profile.collation_version.length > 120)) reject(code);
  if (clusterSha256(value.empty_projection) !== value.empty_projection_sha256
    || clusterSha256(value.profile) !== value.profile_sha256
    || clusterSha256({ system_identifier: value.system_identifier, ...value.database })
      !== value.database_identity_sha256
    || clusterSha256(without(value, "restore_precondition_sha256"))
      !== value.restore_precondition_sha256) reject(code);
  return value;
}

function validateTerminalSideEffectReceipt(value, code) {
  exactKeys(value, [
    "schema_version", "contract", "status", "operation_id", "label",
    "side_effect_name", "intent_sha256", "before_identity_sha256",
    "after_identity_sha256", "argv_template_sha256", "recovery_observation_sha256",
    "daemon_state", "completed_at", "receipt_sha256",
  ], code);
  if (value.schema_version !== 2
    || value.contract !== "chenyida-erp-uat-promotion-rollback-side-effect-receipt/v2"
    || !new Set(["COMMITTED", "RECOVERED_COMMITTED"]).has(value.status)
    || value.label !== "POSTGRESQL_RESTORE"
    || value.side_effect_name !== "DATABASE_SWITCH"
    || value.daemon_state !== "COMPLETED_NO_UNTRACKED_PROCESS") reject(code);
  string(value.operation_id, IDENTIFIER, code);
  for (const field of [
    "intent_sha256", "before_identity_sha256", "after_identity_sha256",
    "argv_template_sha256", "recovery_observation_sha256", "receipt_sha256",
  ]) digest(value[field], code);
  nonZeroDigest(value.after_identity_sha256, code);
  if (value.status === "COMMITTED" && value.recovery_observation_sha256 !== ZERO_SHA256
    || value.status === "RECOVERED_COMMITTED"
      && value.recovery_observation_sha256 === ZERO_SHA256) reject(code);
  instant(value.completed_at, code);
  if (clusterSha256(without(value, "receipt_sha256")) !== value.receipt_sha256) reject(code);
  return value;
}

function validateStageEvidence(stage, value, code) {
  record(value, code);
  if (stage === "PRECONDITION_RECHECK") {
    exactKeys(value, [
      "execution_package_sha256", "source_set_sha256", "checkpoint_receipt_sha256",
      "snapshot_intent_sha256", "finalization_intent_sha256", "runtime_plan_sha256",
      "runtime_activation_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (stage === "WRITER_CONTAINMENT") {
    exactKeys(value, [
      "database_fence_sha256", "candidate_service_set_sha256", "web_container_id",
      "worker_container_id", "database_oid", "system_identifier", "stopped", "sealed",
      "runtime_plan_sha256",
    ], code);
    for (const field of [
      "database_fence_sha256", "candidate_service_set_sha256", "runtime_plan_sha256",
    ]) digest(value[field], code);
    for (const field of ["web_container_id", "worker_container_id"]) string(value[field], CONTAINER_ID, code);
    string(value.database_oid, /^[1-9][0-9]{0,9}$/u, code);
    string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
    if (value.stopped !== true || value.sealed !== true) reject(code);
  } else if (stage === "POSTGRESQL_RESTORE") {
    exactKeys(value, [
      "strategy", "source_artifact_sha256", "source_artifact_bytes",
      "source_reconciliation_sha256", "target_content_sha256", "snapshot_database_oid",
      "restored_database_oid", "restored_database_name", "system_identifier", "migration_head",
      "restored_database_marker", "staging_database_name", "candidate_database_quarantine_name",
      "candidate_database_quarantine_oid", "runtime_plan_sha256", "manifest_sha256",
      "migration_ledger_file_sha256", "migration_manifest_sha256",
      "writer_containment_stage_result_sha256",
      "postgres_container_id", "postgres_image_config_digest", "database_profile_sha256",
      "postgres_base_spec_sha256", "staging_create_receipt_sha256", "restore_receipt_sha256",
      "privilege_reconcile_receipt_sha256", "restore_precondition_opcode_spec_sha256",
      "restore_precondition_sha256", "dump_inventory_sha256", "empty_projection_sha256",
      "restore_precondition",
      "pre_switch_content_proof_sha256", "pre_switch_content_proof",
      "runtime_privilege_access_sha256",
      "runtime_privilege_catalog_sha256", "runtime_privilege_catalog_artifact_sha256",
      "runtime_privilege_policy_sha256", "runtime_privilege_operator_policy_sha256",
      "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
      "sealed_security_projection_sha256", "staging_database_marker",
      "candidate_database_quarantine_marker", "guarded_switch_opcode_spec_sha256",
      "guarded_switch_sql_sha256", "guarded_switch_runner_argv_template_sha256",
      "guarded_switch_state_sha256", "guarded_switch_expected_identity_sha256",
      "switch_receipt_sha256",
      "switch_effect_identity_sha256", "switch_receipt",
      "restored_database_allow_connections_at_commit",
      "restored_database_connection_limit_at_commit",
      "restored_database_sessions_at_commit", "restored_database_prepared_xacts_at_commit",
      "candidate_database_quarantine_allow_connections_at_commit",
      "candidate_database_quarantine_connection_limit_at_commit",
      "candidate_database_quarantine_sessions_at_commit",
      "candidate_database_quarantine_prepared_xacts_at_commit",
    ], code);
    if (value.strategy !== UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES.database
      || value.restored_database_name !== "chenyida_erp"
      || value.restored_database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp") reject(code);
    for (const field of [
      "source_artifact_sha256", "source_reconciliation_sha256", "target_content_sha256",
      "runtime_plan_sha256", "manifest_sha256", "migration_ledger_file_sha256",
      "migration_manifest_sha256", "pre_switch_content_proof_sha256",
      "writer_containment_stage_result_sha256", "database_profile_sha256",
      "postgres_base_spec_sha256", "privilege_reconcile_receipt_sha256",
      "restore_precondition_opcode_spec_sha256", "restore_precondition_sha256",
      "dump_inventory_sha256", "empty_projection_sha256",
      "runtime_privilege_access_sha256", "runtime_privilege_catalog_sha256",
      "runtime_privilege_catalog_artifact_sha256", "runtime_privilege_policy_sha256",
      "runtime_privilege_operator_policy_sha256", "uat_reconciliation_authority_sha256",
      "uat_reconciliation_activation_sha256", "sealed_security_projection_sha256",
      "guarded_switch_opcode_spec_sha256", "guarded_switch_sql_sha256",
      "guarded_switch_runner_argv_template_sha256", "guarded_switch_state_sha256",
      "guarded_switch_expected_identity_sha256",
      "switch_receipt_sha256", "switch_effect_identity_sha256",
    ]) digest(value[field], code);
    nonZeroDigest(value.staging_create_receipt_sha256, code);
    nonZeroDigest(value.restore_receipt_sha256, code);
    const restoreProof = validateRestorePreconditionProof(value.restore_precondition, code);
    const stagingProof = validateStagingContentProof(value.pre_switch_content_proof, code);
    const switchReceipt = validateTerminalSideEffectReceipt(value.switch_receipt, code);
    integer(value.source_artifact_bytes, 1, Number.MAX_SAFE_INTEGER, code);
    for (const field of [
      "snapshot_database_oid", "restored_database_oid", "candidate_database_quarantine_oid",
    ]) string(value[field], /^[1-9][0-9]{0,9}$/u, code);
    string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
    string(value.migration_head, MIGRATION, code);
    string(value.postgres_container_id, CONTAINER_ID, code);
    string(value.postgres_image_config_digest, IMAGE_DIGEST, code);
    string(value.staging_database_marker, RESTORED_STAGING_MARKER, code);
    string(value.candidate_database_quarantine_marker, CANDIDATE_QUARANTINE_MARKER, code);
    for (const field of [
      "restored_database_connection_limit_at_commit",
      "restored_database_sessions_at_commit", "restored_database_prepared_xacts_at_commit",
      "candidate_database_quarantine_connection_limit_at_commit",
      "candidate_database_quarantine_sessions_at_commit",
      "candidate_database_quarantine_prepared_xacts_at_commit",
    ]) integer(value[field], 0, 0, code);
    for (const field of ["staging_database_name", "candidate_database_quarantine_name"]) {
      string(value[field], /^[a-z][a-z0-9_]{0,62}$/u, code);
    }
    if (value.staging_database_name === value.candidate_database_quarantine_name
      || value.staging_database_name === value.restored_database_name
      || value.candidate_database_quarantine_name === value.restored_database_name
      || value.candidate_database_quarantine_oid !== value.snapshot_database_oid
      || value.candidate_database_quarantine_oid === value.restored_database_oid
      || value.switch_receipt_sha256 !== switchReceipt.receipt_sha256
      || value.switch_effect_identity_sha256 !== switchReceipt.after_identity_sha256
      || switchReceipt.before_identity_sha256 !== stagingProof.proof_sha256
      || switchReceipt.argv_template_sha256
        !== clusterSha256({
          opcode: "PG_RB_GUARDED_SWITCH_V3",
          opcode_spec_sha256: value.guarded_switch_opcode_spec_sha256,
          sql_sha256: value.guarded_switch_sql_sha256,
          runner_argv_template_sha256: value.guarded_switch_runner_argv_template_sha256,
        })
      || value.guarded_switch_state_sha256 !== clusterSha256({
        source_reconciliation_sha256: stagingProof.source_reconciliation_sha256,
        expected_content_report_sha256: stagingProof.source_database_report_sha256,
        migration_ledger_file_sha256: stagingProof.migration_ledger_file_sha256,
        migration_allowlist_sha256: stagingProof.migration_allowlist_sha256,
        expected_security_state_sha256: stagingProof.live_security_state_sha256,
        staging_content_proof_sha256: stagingProof.proof_sha256,
        staging_oid: stagingProof.staging_database_oid,
      })
      || value.guarded_switch_expected_identity_sha256 !== clusterSha256({
        active_name: value.restored_database_name,
        active_oid: value.restored_database_oid,
        quarantine_name: value.candidate_database_quarantine_name,
        quarantine_oid: value.candidate_database_quarantine_oid,
        state: "NEW_SEALED",
      })
      || value.restore_precondition_sha256 !== restoreProof.restore_precondition_sha256
      || value.restore_precondition_opcode_spec_sha256 !== restoreProof.opcode_spec_sha256
      || value.dump_inventory_sha256 !== restoreProof.dump_inventory_sha256
      || value.empty_projection_sha256 !== restoreProof.empty_projection_sha256
      || restoreProof.base_spec_sha256 !== value.postgres_base_spec_sha256
      || restoreProof.binding_sha256 !== value.staging_create_receipt_sha256
      || restoreProof.create_receipt_sha256 !== value.staging_create_receipt_sha256
      || restoreProof.system_identifier !== value.system_identifier
      || restoreProof.database.name !== value.staging_database_name
      || restoreProof.database.oid !== value.restored_database_oid
      || restoreProof.database.marker !== value.staging_database_marker
      || restoreProof.profile_sha256 !== value.database_profile_sha256
      || value.pre_switch_content_proof_sha256 !== stagingProof.proof_sha256
      || stagingProof.binding_sha256 !== value.privilege_reconcile_receipt_sha256
      || stagingProof.base_spec_sha256 !== value.postgres_base_spec_sha256
      || stagingProof.runtime_plan_sha256 !== value.runtime_plan_sha256
      || stagingProof.source_reconciliation_sha256 !== value.source_reconciliation_sha256
      || stagingProof.source_database_report_sha256 !== value.target_content_sha256
      || stagingProof.live_database_report_sha256 !== value.target_content_sha256
      || stagingProof.migration_head !== value.migration_head
      || stagingProof.migration_ledger_file_sha256 !== value.migration_ledger_file_sha256
      || stagingProof.migration_allowlist_sha256 !== value.migration_manifest_sha256
      || stagingProof.staging_database_name !== value.staging_database_name
      || stagingProof.staging_database_oid !== value.restored_database_oid
      || stagingProof.staging_database_marker !== value.staging_database_marker
      || stagingProof.system_identifier !== value.system_identifier
      || stagingProof.candidate_database_name !== value.restored_database_name
      || stagingProof.candidate_database_oid !== value.snapshot_database_oid
      || stagingProof.candidate_database_marker !== value.restored_database_marker
      || value.restored_database_allow_connections_at_commit !== false
      || value.candidate_database_quarantine_allow_connections_at_commit !== false) reject(code);
  } else if (new Set(["UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE"]).has(stage)) {
    const domain = {
      UPLOADS_RESTORE: "uploads",
      ATTACHMENTS_RESTORE: "attachments",
      BACKUP_STATUS_RESTORE: "backup_status",
    }[stage];
    const fields = [
      "strategy", "source_artifact_sha256", "source_artifact_bytes", "source_entries",
      "source_reconciliation_sha256", "target_content_sha256", "target_volume",
      "target_volume_identity_sha256", "retained_candidate_volume",
      "retained_candidate_volume_identity_sha256", "runtime_plan_sha256", "domain",
      "manifest_sha256", "expected_tree_sha256", "target_volume_marker_sha256",
      "target_root_identity_sha256", "metadata_policy_sha256", "metadata_state_sha256",
      "capacity_receipt_sha256", "volume_restore_receipt_sha256", "helper_image_reference",
      "helper_image_config_digest", "archive_inventory_sha256",
    ];
    if (stage === "BACKUP_STATUS_RESTORE") fields.push(
      "backup_status_disposition", "current_backup_readiness", "post_rollback_backup_required",
    );
    exactKeys(value, fields, code);
    if (value.strategy !== UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES.file_domains
      || value.domain !== domain || value.expected_tree_sha256 !== value.target_content_sha256) reject(code);
    for (const field of [
      "source_artifact_sha256", "source_reconciliation_sha256", "target_content_sha256",
      "target_volume_identity_sha256", "retained_candidate_volume_identity_sha256",
      "runtime_plan_sha256", "manifest_sha256", "expected_tree_sha256",
      "target_volume_marker_sha256", "target_root_identity_sha256", "metadata_policy_sha256",
      "metadata_state_sha256", "archive_inventory_sha256",
    ]) digest(value[field], code);
    nonZeroDigest(value.capacity_receipt_sha256, code);
    nonZeroDigest(value.volume_restore_receipt_sha256, code);
    string(value.helper_image_reference, IMAGE_REFERENCE, code);
    string(value.helper_image_config_digest, IMAGE_DIGEST, code);
    integer(value.source_artifact_bytes, 1, Number.MAX_SAFE_INTEGER, code);
    integer(value.source_entries, 0, Number.MAX_SAFE_INTEGER, code);
    for (const field of ["target_volume", "retained_candidate_volume"]) string(value[field], IDENTIFIER, code);
    if (value.target_volume === value.retained_candidate_volume) reject(code);
    if (stage === "BACKUP_STATUS_RESTORE"
      && (value.backup_status_disposition !== UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION
        || value.current_backup_readiness !== false
        || value.post_rollback_backup_required !== true)) reject(code);
  } else if (stage === "RUNTIME_CONFIGURATION_RESTORE") {
    exactKeys(value, [
      "compose_file_sha256", "compose_release_file_sha256", "deployment_environment_sha256",
      "runtime_policy_sha256", "predecessor_runtime_configuration_sha256",
      "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
      "rollback_runtime_configuration_sha256", "runtime_plan_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (stage === "WEB_WORKER_PREDECESSOR_ACTIVATION") {
    exactKeys(value, [
      "strategy", "web", "worker", "caddy", "postgres", "rollback_postdeploy_receipt_sha256",
      "rollback_postdeploy_receipt_json", "release_identity_sha256", "release_identity_json",
      "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
      "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
      "protected_resources_sha256", "runtime_plan_sha256",
      "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
      "sealed_security_projection_sha256", "database_unseal_receipt_sha256",
      "compose_invocation_receipt_sha256", "active_database_allow_connections",
      "active_database_connection_limit", "candidate_database_quarantine_allow_connections",
      "candidate_database_quarantine_connection_limit", "preactivation_content_proof",
    ], code);
    if (value.strategy !== UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES.runtime) reject(code);
    validateApplicationServiceObservation(value.web, code);
    validateApplicationServiceObservation(value.worker, code);
    validateServiceObservation(value.caddy, "image_digest", IMAGE_DIGEST, code);
    validateServiceObservation(value.postgres, "image_digest", IMAGE_DIGEST, code);
    for (const field of [
      "rollback_postdeploy_receipt_sha256", "release_identity_sha256",
      "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
      "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
      "protected_resources_sha256", "runtime_plan_sha256",
      "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
      "sealed_security_projection_sha256",
    ]) digest(value[field], code);
    nonZeroDigest(value.database_unseal_receipt_sha256, code);
    nonZeroDigest(value.compose_invocation_receipt_sha256, code);
    integer(value.active_database_connection_limit, 64, 64, code);
    integer(value.candidate_database_quarantine_connection_limit, 0, 0, code);
    if (value.active_database_allow_connections !== true
      || value.candidate_database_quarantine_allow_connections !== false) reject(code);
    validatePreactivationContentProof(value.preactivation_content_proof, code);
    for (const field of ["rollback_postdeploy_receipt_json", "release_identity_json"]) {
      if (typeof value[field] !== "string" || !value[field].endsWith("\n")
        || Buffer.byteLength(value[field]) > 1024 * 1024) reject(code);
    }
  } else if (stage === "PROTECTED_RESOURCE_RECHECK") {
    exactKeys(value, ["before_sha256", "after_sha256", "runtime_plan_sha256", "observation_sha256"], code);
    digest(value.before_sha256, code); digest(value.after_sha256, code);
    digest(value.runtime_plan_sha256, code); digest(value.observation_sha256, code);
    if (value.before_sha256 !== value.after_sha256) reject(code);
  } else reject(code);
  return value;
}

function validateCheckEvidence(check, value, code) {
  record(value, code);
  const contentDomains = new Set([
    "POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT", "BACKUP_STATUS_CONTENT",
  ]);
  if (contentDomains.has(check)) {
    const fields = [
      "source_artifact_sha256", "source_artifact_bytes", "source_reconciliation_sha256",
      "target_content_sha256", "target_identity_sha256", "stage_result_sha256", "entries",
    ];
    if (check === "POSTGRESQL_CONTENT") fields.push(
      "candidate_database_quarantine_name", "candidate_database_quarantine_oid",
      "candidate_database_quarantine_present", "runtime_plan_sha256", "restored_database_oid",
      "restored_database_marker", "system_identifier", "migration_head",
      "migration_ledger_file_sha256", "migration_manifest_sha256",
      "restore_receipt_sha256", "runtime_privilege_access_sha256",
      "runtime_privilege_catalog_sha256", "runtime_privilege_catalog_artifact_sha256",
      "runtime_privilege_policy_sha256", "runtime_privilege_operator_policy_sha256",
      "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
      "sealed_security_projection_sha256", "live_security_state_sha256",
      "active_allow_connections", "active_connection_limit",
      "active_default_transaction_read_only", "active_allowed_session_role_set_sha256",
      "active_session_observation_sha256", "active_session_client_policy_sha256",
      "active_writer_session_count",
      "active_unexpected_session_count", "active_prepared_xacts",
      "candidate_database_quarantine_marker",
      "candidate_database_quarantine_allow_connections",
      "candidate_database_quarantine_connection_limit",
      "candidate_database_quarantine_sessions",
      "candidate_database_quarantine_prepared_xacts",
    );
    else fields.push(
      "candidate_volume_name", "candidate_volume_identity_sha256", "candidate_volume_present",
      "domain", "runtime_plan_sha256", "target_volume", "target_volume_marker_sha256",
      "expected_tree_sha256", "target_root_identity_sha256", "metadata_policy_sha256",
      "metadata_state_sha256", "volume_restore_receipt_sha256", "helper_image_config_digest",
    );
    if (check === "BACKUP_STATUS_CONTENT") fields.push(
      "backup_status_disposition", "current_backup_readiness", "post_rollback_backup_required",
    );
    exactKeys(value, fields, code);
    for (const field of [
      "source_artifact_sha256", "source_reconciliation_sha256", "target_content_sha256",
      "target_identity_sha256", "stage_result_sha256",
    ]) digest(value[field], code);
    integer(value.source_artifact_bytes, 1, Number.MAX_SAFE_INTEGER, code);
    if (check === "POSTGRESQL_CONTENT") {
      string(value.candidate_database_quarantine_name, DATABASE_IDENTIFIER, code);
      string(value.candidate_database_quarantine_oid, /^[1-9][0-9]{0,9}$/u, code);
      string(value.restored_database_oid, /^[1-9][0-9]{0,9}$/u, code);
      string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
      string(value.migration_head, MIGRATION, code);
      string(value.candidate_database_quarantine_marker, CANDIDATE_QUARANTINE_MARKER, code);
      for (const field of [
        "runtime_plan_sha256", "migration_ledger_file_sha256",
        "migration_manifest_sha256", "runtime_privilege_access_sha256",
        "runtime_privilege_catalog_sha256", "runtime_privilege_catalog_artifact_sha256",
        "runtime_privilege_policy_sha256", "runtime_privilege_operator_policy_sha256",
        "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
        "sealed_security_projection_sha256", "live_security_state_sha256",
        "active_allowed_session_role_set_sha256", "active_session_observation_sha256",
        "active_session_client_policy_sha256",
      ]) digest(value[field], code);
      nonZeroDigest(value.restore_receipt_sha256, code);
      integer(value.active_connection_limit, 64, 64, code);
      integer(value.active_writer_session_count, 0, 14, code);
      integer(value.active_unexpected_session_count, 0, 0, code);
      integer(value.active_prepared_xacts, 0, 0, code);
      integer(value.candidate_database_quarantine_connection_limit, 0, 0, code);
      integer(value.candidate_database_quarantine_sessions, 0, 0, code);
      integer(value.candidate_database_quarantine_prepared_xacts, 0, 0, code);
      if (value.entries !== null || value.candidate_database_quarantine_present !== true
        || value.restored_database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
        || value.active_allow_connections !== true
        || value.active_default_transaction_read_only !== false
        || value.candidate_database_quarantine_allow_connections !== false) reject(code);
    } else {
      const domain = {
        UPLOADS_CONTENT: "uploads",
        ATTACHMENTS_CONTENT: "attachments",
        BACKUP_STATUS_CONTENT: "backup_status",
      }[check];
      integer(value.entries, 0, Number.MAX_SAFE_INTEGER, code);
      string(value.candidate_volume_name, IDENTIFIER, code);
      string(value.target_volume, IDENTIFIER, code);
      digest(value.candidate_volume_identity_sha256, code);
      for (const field of [
        "runtime_plan_sha256", "target_volume_marker_sha256", "expected_tree_sha256",
        "target_root_identity_sha256", "metadata_policy_sha256", "metadata_state_sha256",
      ]) digest(value[field], code);
      nonZeroDigest(value.volume_restore_receipt_sha256, code);
      string(value.helper_image_config_digest, IMAGE_DIGEST, code);
      if (value.candidate_volume_present !== true || value.domain !== domain
        || value.expected_tree_sha256 !== value.target_content_sha256) reject(code);
      if (check === "BACKUP_STATUS_CONTENT"
        && (value.backup_status_disposition !== UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION
          || value.current_backup_readiness !== false
          || value.post_rollback_backup_required !== true)) reject(code);
    }
  } else if (check === "MIGRATION_HEAD") {
    exactKeys(value, [
      "migration_head", "migration_ledger_file_sha256", "migration_manifest_sha256",
      "database_identity_sha256", "postgresql_stage_result_sha256",
    ], code);
    string(value.migration_head, MIGRATION, code);
    for (const field of [
      "migration_ledger_file_sha256", "migration_manifest_sha256",
      "database_identity_sha256", "postgresql_stage_result_sha256",
    ]) digest(value[field], code);
  } else if (new Set(["CADDY_IDENTITY", "POSTGRES_IDENTITY"]).has(check)) {
    validateServiceObservation(value, "image_digest", IMAGE_DIGEST, code);
  } else if (new Set(["WEB_IDENTITY", "WORKER_IDENTITY"]).has(check)) {
    exactKeys(value, [
      "container_id", "image_reference", "image_config_digest", "application_version", "git_commit",
      "running", "healthy", "restart_count", "oom_killed",
    ], code);
    string(value.container_id, CONTAINER_ID, code); string(value.image_reference, IMAGE_REFERENCE, code);
    string(value.image_config_digest, IMAGE_DIGEST, code);
    string(value.application_version, VERSION, code); string(value.git_commit, COMMIT, code);
    if (value.running !== true || value.healthy !== true || value.oom_killed !== false) reject(code);
    if (value.restart_count !== 0) reject(code);
  } else if (check === "RUNTIME_CONFIGURATION") {
    exactKeys(value, [
      "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
      "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
      "deployment_environment_sha256",
      "activation_stage_result_sha256", "runtime_plan_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (check === "STRICT_RELEASE_IDENTITY") {
    exactKeys(value, [
      "release_identity_sha256", "release_manifest_sha256", "rollback_postdeploy_receipt_sha256",
      "activation_stage_result_sha256", "predecessor_runtime_configuration_sha256",
      "rollback_runtime_configuration_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (check === "HEALTH") {
    exactKeys(value, [
      "status", "checked_at", "health_sha256", "readiness_sha256", "readiness",
      "services", "service_set_sha256", "release_identity_sha256",
      "runtime_configuration_sha256", "backup_status_disposition",
      "current_backup_readiness", "post_rollback_backup_required",
    ], code);
    if (value.status !== "HEALTHY"
      || value.backup_status_disposition !== UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION
      || value.current_backup_readiness !== false
      || value.post_rollback_backup_required !== true) reject(code);
    const checkedAt = Date.parse(instant(value.checked_at, code));
    let readiness;
    try { readiness = validatePostDeployReadiness(value.readiness); }
    catch { reject(code); }
    const databaseTime = Date.parse(readiness.database_time);
    if (!Number.isFinite(checkedAt) || !Number.isFinite(databaseTime)
      || Math.abs(checkedAt - databaseTime) > HEALTH_DATABASE_TIME_MAX_SKEW_MS) reject(code);
    exactKeys(value.services, ["caddy", "postgres", "web", "worker"], code);
    validateServiceObservation(value.services.caddy, "image_digest", IMAGE_DIGEST, code);
    validateServiceObservation(value.services.postgres, "image_digest", IMAGE_DIGEST, code);
    validateApplicationServiceObservation(value.services.web, code);
    validateApplicationServiceObservation(value.services.worker, code);
    for (const field of [
      "health_sha256", "readiness_sha256", "service_set_sha256",
      "release_identity_sha256", "runtime_configuration_sha256",
    ]) digest(value[field], code);
    if (clusterSha256(readiness) !== value.readiness_sha256
      || clusterSha256(value.services) !== value.service_set_sha256
      || clusterSha256(without(value, "health_sha256")) !== value.health_sha256) reject(code);
  } else if (check === "PROTECTED_RESOURCES") {
    exactKeys(value, [
      "before_sha256", "after_sha256", "protected_recheck_stage_result_sha256",
      "runtime_plan_sha256",
    ], code);
    for (const item of Object.values(value)) digest(item, code);
    if (value.before_sha256 !== value.after_sha256) reject(code);
  } else reject(code);
  return value;
}

function validateRecordIntent(value, labels, kind, code) {
  const labelField = kind === "stage" ? "stage" : "check";
  const digestField = kind === "stage" ? "stage_intent_sha256" : "check_intent_sha256";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "promotion_generation",
    "operation_id", "execution_authorization_sha256", "rollback_plan_sha256",
    "execution_package_sha256", "runtime_plan_sha256", "ordinal", labelField, "previous_result_sha256",
    "input_sha256", "prepared_at", digestField,
  ], code);
  const expectedContract = kind === "stage"
    ? UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT : UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT;
  if (value.schema_version !== 2 || value.contract !== expectedContract || value.status !== "PREPARED") reject(code);
  for (const field of ["promotion_id", "operation_id"]) string(value[field], IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  integer(value.ordinal, 1, labels.length, code);
  if (value[labelField] !== labels[value.ordinal - 1]) reject(code);
  for (const field of [
    "execution_authorization_sha256", "rollback_plan_sha256", "execution_package_sha256", "runtime_plan_sha256",
    "previous_result_sha256", "input_sha256", digestField,
  ]) digest(value[field], code);
  instant(value.prepared_at, code);
  if (clusterSha256(without(value, digestField)) !== value[digestField]) reject(code);
  return value;
}

function validateRecordResult(value, labels, kind, code) {
  const labelField = kind === "stage" ? "stage" : "check";
  const intentField = kind === "stage" ? "stage_intent_sha256" : "check_intent_sha256";
  const resultField = kind === "stage" ? "stage_result_sha256" : "check_result_sha256";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "promotion_generation",
    "operation_id", "execution_authorization_sha256", "rollback_plan_sha256",
    "execution_package_sha256", "runtime_plan_sha256", "ordinal", labelField, "previous_result_sha256",
    intentField, "side_effect_receipts_sha256", "evidence", "started_at", "completed_at", resultField,
  ], code);
  const expectedContract = kind === "stage"
    ? UAT_PROMOTION_ROLLBACK_STAGE_RESULT_CONTRACT : UAT_PROMOTION_ROLLBACK_CHECK_RESULT_CONTRACT;
  const expectedStatus = kind === "stage" ? "COMMITTED" : "VERIFIED";
  if (value.schema_version !== 6 || value.contract !== expectedContract || value.status !== expectedStatus) reject(code);
  for (const field of ["promotion_id", "operation_id"]) string(value[field], IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  integer(value.ordinal, 1, labels.length, code);
  if (value[labelField] !== labels[value.ordinal - 1]) reject(code);
  for (const field of [
    "execution_authorization_sha256", "rollback_plan_sha256", "execution_package_sha256", "runtime_plan_sha256",
    "previous_result_sha256", intentField, resultField,
  ]) digest(value[field], code);
  nonZeroDigest(value.side_effect_receipts_sha256, code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  if (completed < started) reject(code);
  if (kind === "stage") validateStageEvidence(value.stage, value.evidence, code);
  else validateCheckEvidence(value.check, value.evidence, code);
  if (clusterSha256(without(value, resultField)) !== value[resultField]) reject(code);
  return value;
}

export function createUatPromotionRollbackStageIntent(input) {
  const body = { schema_version: 2, contract: UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT, status: "PREPARED", ...input };
  return Object.freeze(validateUatPromotionRollbackStageIntent({
    ...body, stage_intent_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackStageIntent(value) {
  return validateRecordIntent(value, UAT_PROMOTION_ROLLBACK_STAGES, "stage", "UAT_PROMOTION_ROLLBACK_STAGE_INTENT_INVALID");
}
export function createUatPromotionRollbackStageResult(input) {
  const body = { schema_version: 6, contract: UAT_PROMOTION_ROLLBACK_STAGE_RESULT_CONTRACT, status: "COMMITTED", ...input };
  return Object.freeze(validateUatPromotionRollbackStageResult({
    ...body, stage_result_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackStageResult(value) {
  return validateRecordResult(value, UAT_PROMOTION_ROLLBACK_STAGES, "stage", "UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID");
}
export function createUatPromotionRollbackCheckIntent(input) {
  const body = { schema_version: 2, contract: UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT, status: "PREPARED", ...input };
  return Object.freeze(validateUatPromotionRollbackCheckIntent({
    ...body, check_intent_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackCheckIntent(value) {
  return validateRecordIntent(value, UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS, "check", "UAT_PROMOTION_ROLLBACK_CHECK_INTENT_INVALID");
}
export function createUatPromotionRollbackCheckResult(input) {
  const body = { schema_version: 6, contract: UAT_PROMOTION_ROLLBACK_CHECK_RESULT_CONTRACT, status: "VERIFIED", ...input };
  return Object.freeze(validateUatPromotionRollbackCheckResult({
    ...body, check_result_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackCheckResult(value) {
  return validateRecordResult(value, UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS, "check", "UAT_PROMOTION_ROLLBACK_CHECK_RESULT_INVALID");
}

function validateRecordChain(records, labels, kind, code) {
  if (!Array.isArray(records) || records.length !== labels.length) reject(code);
  let previous = ZERO_SHA256;
  for (const [index, item] of records.entries()) {
    const value = kind === "stage"
      ? validateUatPromotionRollbackStageResult(item) : validateUatPromotionRollbackCheckResult(item);
    const labelField = kind === "stage" ? "stage" : "check";
    const resultField = kind === "stage" ? "stage_result_sha256" : "check_result_sha256";
    if (value.ordinal !== index + 1 || value[labelField] !== labels[index]
      || value.previous_result_sha256 !== previous) reject(code);
    previous = value[resultField];
  }
  return previous;
}

export function validateUatPromotionRollbackResult(value) {
  const code = "UAT_PROMOTION_ROLLBACK_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "promotion_generation",
    "rollback_operation_id", "execution_authorization_sha256", "supervisor_bundle_sha256",
    "checkpoint_13_receipt_sha256", "rollback_intent_sha256", "rollback_plan_sha256",
    "execution_package_sha256", "runtime_plan_sha256", "source_set_sha256", "promotion_snapshot_binding_sha256",
    "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
    "sealed_security_projection_sha256",
    "snapshot_readiness_sha256", "snapshot_backup_id", "snapshot_restore_run_id", "snapshot_objects",
    "predecessor", "database", "restored_database", "candidate_database_quarantine",
    "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
    "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
    "compose_project", "compose_project_root",
    "boundary", "protected_resources_before_sha256", "protected_resources_after_sha256",
    "stage_result_sha256_chain", "stages", "started_at", "completed_at", "result_sha256",
  ], code);
  if (value.schema_version !== 6 || value.contract !== UAT_PROMOTION_ROLLBACK_RESULT_CONTRACT
    || value.status !== "ROLLBACK_EXECUTION_COMMITTED" || value.compose_project !== "chenyida-erp") reject(code);
  normalizedAbsolute(value.compose_project_root, code);
  for (const field of ["promotion_id", "rollback_operation_id", "snapshot_backup_id", "snapshot_restore_run_id"]) {
    string(value[field], IDENTIFIER, code);
  }
  integer(value.promotion_generation, 1, 1_000_000, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "checkpoint_13_receipt_sha256",
    "rollback_intent_sha256", "rollback_plan_sha256", "execution_package_sha256", "runtime_plan_sha256", "source_set_sha256",
    "promotion_snapshot_binding_sha256", "snapshot_readiness_sha256",
    "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
    "sealed_security_projection_sha256",
    "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
    "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
    "protected_resources_before_sha256", "protected_resources_after_sha256",
    "stage_result_sha256_chain", "result_sha256",
  ]) digest(value[field], code);
  if (value.protected_resources_before_sha256 !== value.protected_resources_after_sha256) reject(code);
  validateUatPromotionRollbackSnapshotObjects(value.snapshot_objects, code);
  validateUatPromotionRollbackPredecessor(value.predecessor, code);
  validateUatPromotionRollbackDatabase(value.database, code);
  validateUatPromotionRollbackDatabase(value.restored_database, code);
  validateCandidateDatabaseQuarantine(value.candidate_database_quarantine, code);
  validateUatPromotionRollbackBoundary(value.boundary, code);
  const chain = validateRecordChain(value.stages, UAT_PROMOTION_ROLLBACK_STAGES, "stage", code);
  if (chain !== value.stage_result_sha256_chain) reject(code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  const restoredVolumes = value.stages.slice(3, 6).map((item) => item.evidence);
  const targetVolumes = new Set(restoredVolumes.map((item) => item.target_volume));
  const targetVolumeIdentities = new Set(
    restoredVolumes.map((item) => item.target_volume_identity_sha256),
  );
  const candidateVolumes = new Set(restoredVolumes.map((item) => item.retained_candidate_volume));
  const candidateVolumeIdentities = new Set(
    restoredVolumes.map((item) => item.retained_candidate_volume_identity_sha256),
  );
  if (completed < started || value.stages[0].started_at !== value.started_at
    || value.stages.at(-1).completed_at !== value.completed_at
    || value.stages.some((item) => item.promotion_id !== value.promotion_id
      || item.promotion_generation !== value.promotion_generation
      || item.operation_id !== value.rollback_operation_id
      || item.execution_authorization_sha256 !== value.execution_authorization_sha256
      || item.rollback_plan_sha256 !== value.rollback_plan_sha256
      || item.execution_package_sha256 !== value.execution_package_sha256
      || item.runtime_plan_sha256 !== value.runtime_plan_sha256)
    || value.stages.some((item, index) => index > 0
      && Date.parse(item.started_at) < Date.parse(value.stages[index - 1].completed_at))
    || value.stages.at(-1).evidence.after_sha256 !== value.protected_resources_after_sha256
    || value.stages[2].evidence.restored_database_oid !== value.restored_database.oid
    || value.stages[2].evidence.system_identifier !== value.restored_database.system_identifier
    || value.stages[2].evidence.migration_head !== value.predecessor.migration_head
    || value.stages[2].evidence.migration_manifest_sha256
      !== value.predecessor.migration_manifest_sha256
    || value.stages[2].evidence.writer_containment_stage_result_sha256
      !== value.stages[1].stage_result_sha256
    || value.stages[2].evidence.uat_reconciliation_authority_sha256
      !== value.uat_reconciliation_authority_sha256
    || value.stages[2].evidence.uat_reconciliation_activation_sha256
      !== value.uat_reconciliation_activation_sha256
    || value.stages[2].evidence.sealed_security_projection_sha256
      !== value.sealed_security_projection_sha256
    || value.candidate_database_quarantine.name
      !== value.stages[2].evidence.candidate_database_quarantine_name
    || value.candidate_database_quarantine.oid
      !== value.stages[2].evidence.candidate_database_quarantine_oid
    || value.candidate_database_quarantine.oid !== value.database.oid
    || value.candidate_database_quarantine.oid === value.restored_database.oid
    || value.predecessor_runtime_configuration_sha256 !== value.predecessor.runtime_configuration_sha256
    || value.stages[6].evidence.predecessor_runtime_configuration_sha256
      !== value.predecessor_runtime_configuration_sha256
    || value.stages[6].evidence.rollback_runtime_configuration_sha256
      !== value.rollback_runtime_configuration_sha256
    || value.stages[6].evidence.rollback_runtime_projection_sha256
      !== value.rollback_runtime_projection_sha256
    || value.stages[6].evidence.compose_rollback_overlay_sha256
      !== value.compose_rollback_overlay_sha256
    || value.stages[7].evidence.predecessor_runtime_configuration_sha256
      !== value.predecessor_runtime_configuration_sha256
    || value.stages[7].evidence.rollback_runtime_configuration_sha256
      !== value.rollback_runtime_configuration_sha256
    || value.stages[7].evidence.uat_reconciliation_authority_sha256
      !== value.uat_reconciliation_authority_sha256
    || value.stages[7].evidence.uat_reconciliation_activation_sha256
      !== value.uat_reconciliation_activation_sha256
    || value.stages[7].evidence.sealed_security_projection_sha256
      !== value.sealed_security_projection_sha256
    || value.stages[7].evidence.web.image_reference !== value.predecessor.web_image
    || value.stages[7].evidence.worker.image_reference !== value.predecessor.worker_image
    || targetVolumes.size !== 3 || targetVolumeIdentities.size !== 3
    || candidateVolumes.size !== 3 || candidateVolumeIdentities.size !== 3
    || restoredVolumes.some((item) => candidateVolumes.has(item.target_volume)
      || candidateVolumeIdentities.has(item.target_volume_identity_sha256))
    || clusterSha256(without(value, "result_sha256")) !== value.result_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackResult(input) {
  const body = { schema_version: 6, contract: UAT_PROMOTION_ROLLBACK_RESULT_CONTRACT, status: "ROLLBACK_EXECUTION_COMMITTED", ...input };
  return Object.freeze(validateUatPromotionRollbackResult({ ...body, result_sha256: clusterSha256(body) }));
}

export function assertUatPromotionRollbackResultMatchesIntent(resultInput, intentInput) {
  const result = validateUatPromotionRollbackResult(resultInput);
  const code = "UAT_PROMOTION_ROLLBACK_RESULT_BINDING_INVALID";
  const intent = record(intentInput, code);
  const parameters = record(intent.parameters, code);
  if (result.promotion_id !== intent.promotion_id
    || result.promotion_generation !== intent.promotion_generation
    || result.rollback_operation_id !== intent.rollback_operation_id
    || result.execution_authorization_sha256 !== intent.execution_authorization_sha256
    || result.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256
    || result.checkpoint_13_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || result.rollback_intent_sha256 !== intent.rollback_intent_sha256
    || result.rollback_plan_sha256 !== intent.rollback_plan_sha256
    || result.execution_package_sha256 !== parameters.execution_package_sha256
    || result.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || result.snapshot_readiness_sha256 !== parameters.snapshot_readiness_sha256
    || result.snapshot_backup_id !== parameters.snapshot_backup_id
    || result.snapshot_restore_run_id !== parameters.snapshot_restore_run_id
    || !same(result.snapshot_objects, parameters.snapshot_objects)
    || !same(result.predecessor, parameters.predecessor)
    || !same(result.database, parameters.database)
    || result.candidate_database_quarantine.oid !== parameters.database.oid
    || result.compose_project !== parameters.compose_project
    || result.compose_project_root !== parameters.compose_project_root
    || !same(result.boundary, parameters.boundary)
    || Date.parse(result.started_at) < Date.parse(intent.created_at)
    || Date.parse(result.completed_at) > Date.parse(parameters.execution_deadline)) reject(code);
  return result;
}

export function validateUatPromotionRollbackPostverifyResult(value) {
  const code = "UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "promotion_id", "promotion_generation",
    "postverify_operation_id", "execution_authorization_sha256", "supervisor_bundle_sha256",
    "checkpoint_14_receipt_sha256", "rollback_operation_id", "rollback_intent_sha256",
    "rollback_result_sha256", "rollback_plan_sha256", "execution_package_sha256",
    "runtime_plan_sha256", "postverify_intent_sha256", "postverify_plan_sha256", "snapshot_objects", "predecessor",
    "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
    "sealed_security_projection_sha256",
    "database", "restored_database", "candidate_database_quarantine", "boundary",
    "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
    "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
    "check_result_sha256_chain", "checks",
    "verified_at", "result_sha256",
  ], code);
  if (value.schema_version !== 6 || value.contract !== UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_CONTRACT
    || value.status !== "ROLLBACK_POSTVERIFY_COMMITTED") reject(code);
  for (const field of ["promotion_id", "postverify_operation_id", "rollback_operation_id"]) string(value[field], IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "checkpoint_14_receipt_sha256",
    "rollback_intent_sha256", "rollback_result_sha256", "rollback_plan_sha256",
    "execution_package_sha256", "runtime_plan_sha256", "postverify_intent_sha256", "postverify_plan_sha256",
    "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
    "sealed_security_projection_sha256",
    "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
    "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
    "check_result_sha256_chain", "result_sha256",
  ]) digest(value[field], code);
  validateUatPromotionRollbackSnapshotObjects(value.snapshot_objects, code);
  validateUatPromotionRollbackPredecessor(value.predecessor, code);
  validateUatPromotionRollbackDatabase(value.database, code);
  validateUatPromotionRollbackDatabase(value.restored_database, code);
  validateCandidateDatabaseQuarantine(value.candidate_database_quarantine, code);
  validateUatPromotionRollbackBoundary(value.boundary, code);
  const chain = validateRecordChain(value.checks, UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS, "check", code);
  if (chain !== value.check_result_sha256_chain
    || value.checks.some((item) => item.promotion_id !== value.promotion_id
      || item.promotion_generation !== value.promotion_generation
      || item.operation_id !== value.postverify_operation_id
      || item.execution_authorization_sha256 !== value.execution_authorization_sha256
      || item.rollback_plan_sha256 !== value.rollback_plan_sha256
      || item.execution_package_sha256 !== value.execution_package_sha256
      || item.runtime_plan_sha256 !== value.runtime_plan_sha256)
    || value.checks.at(-1).completed_at !== value.verified_at) reject(code);
  const postgresql = value.checks[0].evidence;
  if (value.candidate_database_quarantine.name !== postgresql.candidate_database_quarantine_name
    || value.candidate_database_quarantine.oid !== postgresql.candidate_database_quarantine_oid
    || postgresql.candidate_database_quarantine_present !== true
    || postgresql.runtime_plan_sha256 !== value.runtime_plan_sha256
    || postgresql.target_identity_sha256 !== clusterSha256(value.restored_database)
    || postgresql.restored_database_oid !== value.restored_database.oid
    || postgresql.restored_database_marker !== value.restored_database.marker
    || postgresql.system_identifier !== value.restored_database.system_identifier
    || postgresql.migration_head !== value.predecessor.migration_head
    || postgresql.migration_manifest_sha256 !== value.predecessor.migration_manifest_sha256
    || value.checks[4].evidence.migration_head !== postgresql.migration_head
    || value.checks[4].evidence.migration_ledger_file_sha256
      !== postgresql.migration_ledger_file_sha256
    || value.checks[4].evidence.migration_manifest_sha256
      !== postgresql.migration_manifest_sha256
    || postgresql.uat_reconciliation_authority_sha256
      !== value.uat_reconciliation_authority_sha256
    || postgresql.uat_reconciliation_activation_sha256
      !== value.uat_reconciliation_activation_sha256
    || postgresql.sealed_security_projection_sha256
      !== value.sealed_security_projection_sha256
    || value.checks.slice(1, 4).some((item) => (
      item.evidence.runtime_plan_sha256 !== value.runtime_plan_sha256
    ))
    || value.predecessor_runtime_configuration_sha256 !== value.predecessor.runtime_configuration_sha256
    || value.checks[9].evidence.predecessor_runtime_configuration_sha256
      !== value.predecessor_runtime_configuration_sha256
    || value.checks[9].evidence.rollback_runtime_configuration_sha256
      !== value.rollback_runtime_configuration_sha256
    || value.checks[9].evidence.rollback_runtime_projection_sha256
      !== value.rollback_runtime_projection_sha256
    || value.checks[9].evidence.compose_rollback_overlay_sha256
      !== value.compose_rollback_overlay_sha256
    || value.checks[10].evidence.predecessor_runtime_configuration_sha256
      !== value.predecessor_runtime_configuration_sha256
    || value.checks[10].evidence.rollback_runtime_configuration_sha256
      !== value.rollback_runtime_configuration_sha256
    || value.checks[7].evidence.image_reference !== value.predecessor.web_image
    || value.checks[8].evidence.image_reference !== value.predecessor.worker_image
    || value.checks[11].evidence.runtime_configuration_sha256
      !== value.rollback_runtime_configuration_sha256) reject(code);
  instant(value.verified_at, code);
  if (clusterSha256(without(value, "result_sha256")) !== value.result_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackPostverifyResult(input) {
  const body = { schema_version: 6, contract: UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_CONTRACT, status: "ROLLBACK_POSTVERIFY_COMMITTED", ...input };
  return Object.freeze(validateUatPromotionRollbackPostverifyResult({ ...body, result_sha256: clusterSha256(body) }));
}

export function assertUatPromotionRollbackPostverifyResultMatchesIntent(resultInput, intentInput, rollbackResultInput) {
  const result = validateUatPromotionRollbackPostverifyResult(resultInput);
  const rollback = validateUatPromotionRollbackResult(rollbackResultInput);
  const code = "UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_BINDING_INVALID";
  const intent = record(intentInput, code);
  const parameters = record(intent.parameters, code);
  const postgresqlContent = result.checks[0].evidence;
  const postgresqlRestore = rollback.stages[2].evidence;
  const postgresqlSharedFields = [
    "source_artifact_sha256", "source_artifact_bytes", "source_reconciliation_sha256",
    "target_content_sha256", "runtime_plan_sha256", "restored_database_oid",
    "restored_database_marker", "system_identifier", "migration_head",
    "migration_ledger_file_sha256", "migration_manifest_sha256",
    "restore_receipt_sha256", "runtime_privilege_access_sha256",
    "runtime_privilege_catalog_sha256", "runtime_privilege_catalog_artifact_sha256",
    "runtime_privilege_policy_sha256", "runtime_privilege_operator_policy_sha256",
    "uat_reconciliation_authority_sha256", "uat_reconciliation_activation_sha256",
    "sealed_security_projection_sha256",
    "candidate_database_quarantine_name", "candidate_database_quarantine_oid",
    "candidate_database_quarantine_marker",
  ];
  const retainedDomainRecords = [[1, 3], [2, 4], [3, 5]];
  if (result.promotion_id !== intent.promotion_id
    || result.promotion_generation !== intent.promotion_generation
    || result.postverify_operation_id !== intent.postverify_operation_id
    || result.execution_authorization_sha256 !== intent.execution_authorization_sha256
    || result.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256
    || result.checkpoint_14_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || result.rollback_operation_id !== parameters.rollback_operation_id
    || result.rollback_intent_sha256 !== parameters.rollback_intent_sha256
    || result.rollback_result_sha256 !== rollback.result_sha256
    || result.rollback_result_sha256 !== parameters.rollback_result_sha256
    || result.rollback_plan_sha256 !== rollback.rollback_plan_sha256
    || result.execution_package_sha256 !== rollback.execution_package_sha256
    || result.runtime_plan_sha256 !== rollback.runtime_plan_sha256
    || result.uat_reconciliation_authority_sha256
      !== rollback.uat_reconciliation_authority_sha256
    || result.uat_reconciliation_activation_sha256
      !== rollback.uat_reconciliation_activation_sha256
    || result.sealed_security_projection_sha256
      !== rollback.sealed_security_projection_sha256
    || result.predecessor_runtime_configuration_sha256
      !== rollback.predecessor_runtime_configuration_sha256
    || result.rollback_runtime_configuration_sha256 !== rollback.rollback_runtime_configuration_sha256
    || result.rollback_runtime_projection_sha256 !== rollback.rollback_runtime_projection_sha256
    || result.compose_rollback_overlay_sha256 !== rollback.compose_rollback_overlay_sha256
    || !same(result.candidate_database_quarantine, rollback.candidate_database_quarantine)
    || result.postverify_intent_sha256 !== intent.postverify_intent_sha256
    || result.postverify_plan_sha256 !== intent.postverify_plan_sha256
    || !same(result.snapshot_objects, rollback.snapshot_objects)
    || !same(result.predecessor, rollback.predecessor)
    || !same(result.database, rollback.database)
    || !same(result.restored_database, rollback.restored_database)
    || !same(result.boundary, rollback.boundary)
    || postgresqlContent.stage_result_sha256 !== rollback.stages[2].stage_result_sha256
    || postgresqlContent.target_identity_sha256 !== clusterSha256(rollback.restored_database)
    || postgresqlContent.candidate_database_quarantine_allow_connections
      !== postgresqlRestore.candidate_database_quarantine_allow_connections_at_commit
    || postgresqlContent.candidate_database_quarantine_connection_limit
      !== postgresqlRestore.candidate_database_quarantine_connection_limit_at_commit
    || postgresqlContent.candidate_database_quarantine_sessions
      !== postgresqlRestore.candidate_database_quarantine_sessions_at_commit
    || postgresqlContent.candidate_database_quarantine_prepared_xacts
      !== postgresqlRestore.candidate_database_quarantine_prepared_xacts_at_commit
    || postgresqlSharedFields.some((field) => (
      postgresqlContent[field] !== postgresqlRestore[field]
    ))
    || result.checks[7].evidence.image_config_digest
      !== rollback.stages[7].evidence.web.image_config_digest
    || result.checks[8].evidence.image_config_digest
      !== rollback.stages[7].evidence.worker.image_config_digest
    || retainedDomainRecords.some(([checkIndex, stageIndex]) => (
      result.checks[checkIndex].evidence.candidate_volume_present !== true
      || result.checks[checkIndex].evidence.candidate_volume_name
        !== rollback.stages[stageIndex].evidence.retained_candidate_volume
      || result.checks[checkIndex].evidence.candidate_volume_identity_sha256
        !== rollback.stages[stageIndex].evidence.retained_candidate_volume_identity_sha256
      || result.checks[checkIndex].evidence.stage_result_sha256
        !== rollback.stages[stageIndex].stage_result_sha256
      || result.checks[checkIndex].evidence.target_identity_sha256
        !== rollback.stages[stageIndex].evidence.target_volume_identity_sha256
      || result.checks[checkIndex].evidence.entries
        !== rollback.stages[stageIndex].evidence.source_entries
      || [
        "domain", "runtime_plan_sha256", "source_artifact_sha256", "source_artifact_bytes",
        "source_reconciliation_sha256", "target_content_sha256", "target_volume",
        "target_volume_marker_sha256", "expected_tree_sha256", "target_root_identity_sha256",
        "metadata_policy_sha256", "metadata_state_sha256", "volume_restore_receipt_sha256",
        "helper_image_config_digest",
      ].some((field) => (
        result.checks[checkIndex].evidence[field]
          !== rollback.stages[stageIndex].evidence[field]
      ))
    ))
    || Date.parse(result.verified_at) < Date.parse(intent.created_at)
    || Date.parse(result.verified_at) >= Date.parse(intent.expires_at)) reject(code);
  return result;
}
