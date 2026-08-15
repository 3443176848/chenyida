import path from "node:path";

import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";

export const UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-execution-package/v1";
export const UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-stage-intent/v1";
export const UAT_PROMOTION_ROLLBACK_STAGE_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-stage-result/v1";
export const UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-check-intent/v1";
export const UAT_PROMOTION_ROLLBACK_CHECK_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-check-result/v1";
export const UAT_PROMOTION_ROLLBACK_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-result/v1";
export const UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-postverify-result/v1";

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
  "predecessor_postdeploy_receipt",
  "predecessor_release_manifest",
  "candidate_deployment_result",
  "candidate_postdeploy_identity",
  "compose_file",
  "compose_release_file",
  "deployment_environment",
  "runtime_policy",
]);

export const UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES = Object.freeze({
  database: "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
  file_domains: "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
  runtime: "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
});

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^0\.1\.0-alpha\.\d+$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
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

export function validateUatPromotionRollbackExecutionPackage(value) {
  const code = "UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "promotion_id", "promotion_generation", "rollback_operation_id",
    "created_at", "execution_deadline", "snapshot_readiness_sha256", "snapshot_objects_sha256",
    "predecessor_sha256", "database_snapshot_sha256", "protected_resources_sha256",
    "compose_project", "compose_project_root", "restore_strategies", "sources",
    "source_set_sha256", "package_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_CONTRACT
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
    "database_snapshot_sha256", "protected_resources_sha256", "source_set_sha256", "package_sha256",
  ]) digest(value[field], code);
  exactKeys(value.restore_strategies, Object.keys(UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES), code);
  if (!same(value.restore_strategies, UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES)) reject(code);
  exactKeys(value.sources, UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES, code);
  const paths = new Set();
  for (const role of UAT_PROMOTION_ROLLBACK_PACKAGE_SOURCE_ROLES) {
    validateUatPromotionRollbackSourceSpec(value.sources[role], code);
    if (paths.has(value.sources[role].path)) reject(code);
    paths.add(value.sources[role].path);
  }
  if (value.source_set_sha256 !== clusterSha256(value.sources)
    || value.package_sha256 !== clusterSha256(without(value, "package_sha256"))) reject(code);
  return value;
}

export function createUatPromotionRollbackExecutionPackage(input) {
  const body = {
    schema_version: 1,
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
    || value.snapshot_objects_sha256 !== clusterSha256(parameters.snapshot_objects)
    || value.predecessor_sha256 !== clusterSha256(parameters.predecessor)
    || value.database_snapshot_sha256 !== clusterSha256(parameters.database)
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
  integer(value.restart_count, 0, Number.MAX_SAFE_INTEGER, code);
}

function validateStageEvidence(stage, value, code) {
  record(value, code);
  if (stage === "PRECONDITION_RECHECK") {
    exactKeys(value, [
      "execution_package_sha256", "source_set_sha256", "checkpoint_receipt_sha256",
      "snapshot_intent_sha256", "finalization_intent_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (stage === "WRITER_CONTAINMENT") {
    exactKeys(value, [
      "database_fence_sha256", "candidate_service_set_sha256", "web_container_id",
      "worker_container_id", "stopped",
    ], code);
    for (const field of ["database_fence_sha256", "candidate_service_set_sha256"]) digest(value[field], code);
    for (const field of ["web_container_id", "worker_container_id"]) string(value[field], CONTAINER_ID, code);
    if (value.stopped !== true) reject(code);
  } else if (stage === "POSTGRESQL_RESTORE") {
    exactKeys(value, [
      "strategy", "source_sha256", "source_bytes", "snapshot_database_oid",
      "restored_database_oid", "restored_database_name", "system_identifier", "migration_head",
      "content_sha256", "candidate_database_quarantine_name",
    ], code);
    if (value.strategy !== UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES.database
      || value.restored_database_name !== "chenyida_erp") reject(code);
    for (const field of ["source_sha256", "content_sha256"]) digest(value[field], code);
    integer(value.source_bytes, 1, Number.MAX_SAFE_INTEGER, code);
    for (const field of ["snapshot_database_oid", "restored_database_oid"]) string(value[field], /^[1-9][0-9]{0,9}$/u, code);
    string(value.system_identifier, /^[1-9][0-9]{9,29}$/u, code);
    string(value.migration_head, MIGRATION, code);
    string(value.candidate_database_quarantine_name, IDENTIFIER, code);
  } else if (new Set(["UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE"]).has(stage)) {
    exactKeys(value, [
      "strategy", "source_sha256", "source_bytes", "source_entries", "target_volume",
      "retained_candidate_volume", "content_sha256",
    ], code);
    if (value.strategy !== UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES.file_domains) reject(code);
    for (const field of ["source_sha256", "content_sha256"]) digest(value[field], code);
    integer(value.source_bytes, 1, Number.MAX_SAFE_INTEGER, code);
    integer(value.source_entries, 0, Number.MAX_SAFE_INTEGER, code);
    for (const field of ["target_volume", "retained_candidate_volume"]) string(value[field], IDENTIFIER, code);
    if (value.target_volume === value.retained_candidate_volume) reject(code);
  } else if (stage === "RUNTIME_CONFIGURATION_RESTORE") {
    exactKeys(value, [
      "compose_file_sha256", "compose_release_file_sha256", "deployment_environment_sha256",
      "runtime_policy_sha256", "runtime_configuration_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (stage === "WEB_WORKER_PREDECESSOR_ACTIVATION") {
    exactKeys(value, ["strategy", "web", "worker", "caddy", "postgres", "release_identity_sha256"], code);
    if (value.strategy !== UAT_PROMOTION_ROLLBACK_RESTORE_STRATEGIES.runtime) reject(code);
    validateServiceObservation(value.web, "image_reference", IMAGE_REFERENCE, code);
    validateServiceObservation(value.worker, "image_reference", IMAGE_REFERENCE, code);
    validateServiceObservation(value.caddy, "image_digest", IMAGE_DIGEST, code);
    validateServiceObservation(value.postgres, "image_digest", IMAGE_DIGEST, code);
    digest(value.release_identity_sha256, code);
  } else if (stage === "PROTECTED_RESOURCE_RECHECK") {
    exactKeys(value, ["before_sha256", "after_sha256"], code);
    digest(value.before_sha256, code); digest(value.after_sha256, code);
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
    exactKeys(value, ["content_sha256", "source_sha256", "bytes", "entries"], code);
    digest(value.content_sha256, code); digest(value.source_sha256, code);
    integer(value.bytes, 1, Number.MAX_SAFE_INTEGER, code);
    if (check === "POSTGRESQL_CONTENT") {
      if (value.entries !== null) reject(code);
    } else integer(value.entries, 0, Number.MAX_SAFE_INTEGER, code);
  } else if (check === "MIGRATION_HEAD") {
    exactKeys(value, ["migration_head", "migration_manifest_sha256"], code);
    string(value.migration_head, MIGRATION, code); digest(value.migration_manifest_sha256, code);
  } else if (new Set(["CADDY_IDENTITY", "POSTGRES_IDENTITY"]).has(check)) {
    validateServiceObservation(value, "image_digest", IMAGE_DIGEST, code);
  } else if (new Set(["WEB_IDENTITY", "WORKER_IDENTITY"]).has(check)) {
    exactKeys(value, [
      "container_id", "image_reference", "application_version", "git_commit", "running", "healthy",
      "restart_count", "oom_killed",
    ], code);
    string(value.container_id, CONTAINER_ID, code); string(value.image_reference, IMAGE_REFERENCE, code);
    string(value.application_version, VERSION, code); string(value.git_commit, COMMIT, code);
    if (value.running !== true || value.healthy !== true || value.oom_killed !== false) reject(code);
    integer(value.restart_count, 0, Number.MAX_SAFE_INTEGER, code);
  } else if (check === "RUNTIME_CONFIGURATION") {
    exactKeys(value, ["runtime_configuration_sha256", "deployment_environment_sha256"], code);
    digest(value.runtime_configuration_sha256, code); digest(value.deployment_environment_sha256, code);
  } else if (check === "STRICT_RELEASE_IDENTITY") {
    exactKeys(value, [
      "release_identity_sha256", "release_manifest_sha256", "postdeploy_receipt_sha256",
    ], code);
    Object.values(value).forEach((item) => digest(item, code));
  } else if (check === "HEALTH") {
    exactKeys(value, ["status", "health_sha256"], code);
    if (value.status !== "HEALTHY") reject(code);
    digest(value.health_sha256, code);
  } else if (check === "PROTECTED_RESOURCES") {
    exactKeys(value, ["before_sha256", "after_sha256"], code);
    digest(value.before_sha256, code); digest(value.after_sha256, code);
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
    "execution_package_sha256", "ordinal", labelField, "previous_result_sha256",
    "input_sha256", "prepared_at", digestField,
  ], code);
  const expectedContract = kind === "stage"
    ? UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT : UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT;
  if (value.schema_version !== 1 || value.contract !== expectedContract || value.status !== "PREPARED") reject(code);
  for (const field of ["promotion_id", "operation_id"]) string(value[field], IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  integer(value.ordinal, 1, labels.length, code);
  if (value[labelField] !== labels[value.ordinal - 1]) reject(code);
  for (const field of [
    "execution_authorization_sha256", "rollback_plan_sha256", "execution_package_sha256",
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
    "execution_package_sha256", "ordinal", labelField, "previous_result_sha256",
    intentField, "evidence", "started_at", "completed_at", resultField,
  ], code);
  const expectedContract = kind === "stage"
    ? UAT_PROMOTION_ROLLBACK_STAGE_RESULT_CONTRACT : UAT_PROMOTION_ROLLBACK_CHECK_RESULT_CONTRACT;
  const expectedStatus = kind === "stage" ? "COMMITTED" : "VERIFIED";
  if (value.schema_version !== 1 || value.contract !== expectedContract || value.status !== expectedStatus) reject(code);
  for (const field of ["promotion_id", "operation_id"]) string(value[field], IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  integer(value.ordinal, 1, labels.length, code);
  if (value[labelField] !== labels[value.ordinal - 1]) reject(code);
  for (const field of [
    "execution_authorization_sha256", "rollback_plan_sha256", "execution_package_sha256",
    "previous_result_sha256", intentField, resultField,
  ]) digest(value[field], code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  if (completed < started) reject(code);
  if (kind === "stage") validateStageEvidence(value.stage, value.evidence, code);
  else validateCheckEvidence(value.check, value.evidence, code);
  if (clusterSha256(without(value, resultField)) !== value[resultField]) reject(code);
  return value;
}

export function createUatPromotionRollbackStageIntent(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT, status: "PREPARED", ...input };
  return Object.freeze(validateUatPromotionRollbackStageIntent({
    ...body, stage_intent_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackStageIntent(value) {
  return validateRecordIntent(value, UAT_PROMOTION_ROLLBACK_STAGES, "stage", "UAT_PROMOTION_ROLLBACK_STAGE_INTENT_INVALID");
}
export function createUatPromotionRollbackStageResult(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_ROLLBACK_STAGE_RESULT_CONTRACT, status: "COMMITTED", ...input };
  return Object.freeze(validateUatPromotionRollbackStageResult({
    ...body, stage_result_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackStageResult(value) {
  return validateRecordResult(value, UAT_PROMOTION_ROLLBACK_STAGES, "stage", "UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID");
}
export function createUatPromotionRollbackCheckIntent(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT, status: "PREPARED", ...input };
  return Object.freeze(validateUatPromotionRollbackCheckIntent({
    ...body, check_intent_sha256: clusterSha256(body),
  }));
}
export function validateUatPromotionRollbackCheckIntent(value) {
  return validateRecordIntent(value, UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS, "check", "UAT_PROMOTION_ROLLBACK_CHECK_INTENT_INVALID");
}
export function createUatPromotionRollbackCheckResult(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_ROLLBACK_CHECK_RESULT_CONTRACT, status: "VERIFIED", ...input };
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
    "execution_package_sha256", "source_set_sha256", "promotion_snapshot_binding_sha256",
    "snapshot_readiness_sha256", "snapshot_backup_id", "snapshot_restore_run_id", "snapshot_objects",
    "predecessor", "database", "restored_database", "compose_project", "compose_project_root",
    "boundary", "protected_resources_before_sha256", "protected_resources_after_sha256",
    "stage_result_sha256_chain", "stages", "started_at", "completed_at", "result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_RESULT_CONTRACT
    || value.status !== "ROLLBACK_EXECUTION_COMMITTED" || value.compose_project !== "chenyida-erp") reject(code);
  normalizedAbsolute(value.compose_project_root, code);
  for (const field of ["promotion_id", "rollback_operation_id", "snapshot_backup_id", "snapshot_restore_run_id"]) {
    string(value[field], IDENTIFIER, code);
  }
  integer(value.promotion_generation, 1, 1_000_000, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "checkpoint_13_receipt_sha256",
    "rollback_intent_sha256", "rollback_plan_sha256", "execution_package_sha256", "source_set_sha256",
    "promotion_snapshot_binding_sha256", "snapshot_readiness_sha256",
    "protected_resources_before_sha256", "protected_resources_after_sha256",
    "stage_result_sha256_chain", "result_sha256",
  ]) digest(value[field], code);
  if (value.protected_resources_before_sha256 !== value.protected_resources_after_sha256) reject(code);
  validateUatPromotionRollbackSnapshotObjects(value.snapshot_objects, code);
  validateUatPromotionRollbackPredecessor(value.predecessor, code);
  validateUatPromotionRollbackDatabase(value.database, code);
  validateUatPromotionRollbackDatabase(value.restored_database, code);
  validateUatPromotionRollbackBoundary(value.boundary, code);
  const chain = validateRecordChain(value.stages, UAT_PROMOTION_ROLLBACK_STAGES, "stage", code);
  if (chain !== value.stage_result_sha256_chain) reject(code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  if (completed < started || value.stages[0].started_at !== value.started_at
    || value.stages.at(-1).completed_at !== value.completed_at
    || value.stages.some((item) => item.promotion_id !== value.promotion_id
      || item.promotion_generation !== value.promotion_generation
      || item.operation_id !== value.rollback_operation_id
      || item.execution_authorization_sha256 !== value.execution_authorization_sha256
      || item.rollback_plan_sha256 !== value.rollback_plan_sha256
      || item.execution_package_sha256 !== value.execution_package_sha256)
    || value.stages.some((item, index) => index > 0
      && Date.parse(item.started_at) < Date.parse(value.stages[index - 1].completed_at))
    || value.stages.at(-1).evidence.after_sha256 !== value.protected_resources_after_sha256
    || value.stages[2].evidence.restored_database_oid !== value.restored_database.oid
    || value.stages[2].evidence.system_identifier !== value.restored_database.system_identifier
    || clusterSha256(without(value, "result_sha256")) !== value.result_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackResult(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_ROLLBACK_RESULT_CONTRACT, status: "ROLLBACK_EXECUTION_COMMITTED", ...input };
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
    "postverify_intent_sha256", "postverify_plan_sha256", "snapshot_objects", "predecessor",
    "database", "restored_database", "boundary", "check_result_sha256_chain", "checks",
    "verified_at", "result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_CONTRACT
    || value.status !== "ROLLBACK_POSTVERIFY_COMMITTED") reject(code);
  for (const field of ["promotion_id", "postverify_operation_id", "rollback_operation_id"]) string(value[field], IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "checkpoint_14_receipt_sha256",
    "rollback_intent_sha256", "rollback_result_sha256", "rollback_plan_sha256",
    "execution_package_sha256", "postverify_intent_sha256", "postverify_plan_sha256",
    "check_result_sha256_chain", "result_sha256",
  ]) digest(value[field], code);
  validateUatPromotionRollbackSnapshotObjects(value.snapshot_objects, code);
  validateUatPromotionRollbackPredecessor(value.predecessor, code);
  validateUatPromotionRollbackDatabase(value.database, code);
  validateUatPromotionRollbackDatabase(value.restored_database, code);
  validateUatPromotionRollbackBoundary(value.boundary, code);
  const chain = validateRecordChain(value.checks, UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS, "check", code);
  if (chain !== value.check_result_sha256_chain
    || value.checks.some((item) => item.promotion_id !== value.promotion_id
      || item.promotion_generation !== value.promotion_generation
      || item.operation_id !== value.postverify_operation_id
      || item.execution_authorization_sha256 !== value.execution_authorization_sha256
      || item.rollback_plan_sha256 !== value.rollback_plan_sha256
      || item.execution_package_sha256 !== value.execution_package_sha256)
    || value.checks.at(-1).completed_at !== value.verified_at) reject(code);
  instant(value.verified_at, code);
  if (clusterSha256(without(value, "result_sha256")) !== value.result_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackPostverifyResult(input) {
  const body = { schema_version: 1, contract: UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_CONTRACT, status: "ROLLBACK_POSTVERIFY_COMMITTED", ...input };
  return Object.freeze(validateUatPromotionRollbackPostverifyResult({ ...body, result_sha256: clusterSha256(body) }));
}

export function assertUatPromotionRollbackPostverifyResultMatchesIntent(resultInput, intentInput, rollbackResultInput) {
  const result = validateUatPromotionRollbackPostverifyResult(resultInput);
  const rollback = validateUatPromotionRollbackResult(rollbackResultInput);
  const code = "UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_BINDING_INVALID";
  const intent = record(intentInput, code);
  const parameters = record(intent.parameters, code);
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
    || result.postverify_intent_sha256 !== intent.postverify_intent_sha256
    || result.postverify_plan_sha256 !== intent.postverify_plan_sha256
    || !same(result.snapshot_objects, rollback.snapshot_objects)
    || !same(result.predecessor, rollback.predecessor)
    || !same(result.database, rollback.database)
    || !same(result.restored_database, rollback.restored_database)
    || !same(result.boundary, rollback.boundary)
    || Date.parse(result.verified_at) < Date.parse(intent.created_at)
    || Date.parse(result.verified_at) >= Date.parse(intent.expires_at)) reject(code);
  return result;
}
