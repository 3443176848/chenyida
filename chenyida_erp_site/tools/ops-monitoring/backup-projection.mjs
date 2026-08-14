import { OpsMonitoringError, monitoringSha256 } from "./contract.mjs";
import { validateMonitoringEvaluatorConfig } from "./delivery-contract.mjs";

export const MONITORING_BACKUP_PROJECTION_CONTRACT = "chenyida-erp-monitoring-backup-projection/v1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZERO_SHA256 = "0".repeat(64);

const ENUMS = Object.freeze({
  verification_status: new Set(["UNVERIFIED", "INVALID", "STALE", "LEGACY_LOCAL_ONLY", "LEGACY_V2_INNER_ONLY", "LEGACY_V3_NO_CLUSTER_SECURITY", "LOCAL_VERIFIED", "OFFHOST_VERIFIED", "RESTORE_VERIFIED", "RECOVERY_READY", "SYNTHETIC_ISOLATED_VERIFIED"]),
  evidence_scope: new Set(["NONE", "LEGACY_V1_LOCAL_ONLY", "LEGACY_V2_INNER_ONLY", "LEGACY_V3_NO_CLUSTER_SECURITY", "ACTUAL_OFFHOST", "SYNTHETIC_ISOLATED"]),
  transfer_status: new Set(["UNVERIFIED", "VERIFIED"]),
  encryption_status: new Set(["UNVERIFIED", "VERIFIED"]),
  cluster_transfer_status: new Set(["UNVERIFIED", "VERIFIED"]),
  cluster_security_status: new Set(["UNVERIFIED", "VERIFIED"]),
  credential_binding_status: new Set(["UNVERIFIED", "VERIFIED"]),
  tablespace_status: new Set(["UNVERIFIED", "VERIFIED"]),
  recovery_execution_status: new Set(["UNVERIFIED", "PUBLISHED"]),
  schedule_status: new Set(["UNCONFIGURED", "ON_TIME"]),
  retention_status: new Set(["UNCONFIGURED", "POLICY_VALID_DRY_RUN"]),
  identity_status: new Set(["UNCONFIGURED", "MISMATCH", "MATCHED"]),
  policy_status: new Set(["UNCONFIGURED", "MISMATCH", "MATCHED"]),
  assurance_status: new Set(["UNCONFIGURED", "MISMATCH", "MATCHED"]),
});

function reject(code) {
  throw new OpsMonitoringError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function digest(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) reject(code);
}

function identifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code);
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
}

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
}

function projectionBody(value) {
  const body = { ...value };
  delete body.projection_sha256;
  return body;
}

export function validateBackupProjection(value) {
  exactKeys(value, ["schema_version", "contract", "projection_id", "generation", "previous_projection_sha256", "projection_sha256", "producer", "published_at", "verified_at", "recovery_point_at", "expires_at", "release", "backup"], "MONITOR_BACKUP_PROJECTION_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_BACKUP_PROJECTION_CONTRACT) reject("MONITOR_BACKUP_PROJECTION_VERSION_INVALID");
  identifier(value.projection_id, "MONITOR_BACKUP_PROJECTION_ID_INVALID");
  integer(value.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_BACKUP_PROJECTION_GENERATION_INVALID");
  digest(value.previous_projection_sha256, "MONITOR_BACKUP_PROJECTION_GENERATION_INVALID");
  digest(value.projection_sha256, "MONITOR_BACKUP_PROJECTION_INTEGRITY_INVALID");
  if ((value.generation === 1) !== (value.previous_projection_sha256 === ZERO_SHA256) || monitoringSha256(projectionBody(value)) !== value.projection_sha256) reject("MONITOR_BACKUP_PROJECTION_INTEGRITY_INVALID");
  exactKeys(value.producer, ["bundle_sha256", "policy_sha256", "source_readiness_sha256"], "MONITOR_BACKUP_PRODUCER_FIELDS_INVALID");
  for (const field of ["bundle_sha256", "policy_sha256", "source_readiness_sha256"]) digest(value.producer[field], "MONITOR_BACKUP_PRODUCER_INVALID");
  for (const field of ["published_at", "verified_at", "recovery_point_at", "expires_at"]) iso(value[field], "MONITOR_BACKUP_PROJECTION_TIME_INVALID");
  const published = Date.parse(value.published_at);
  const verified = Date.parse(value.verified_at);
  const recovery = Date.parse(value.recovery_point_at);
  const expires = Date.parse(value.expires_at);
  if (recovery > verified || verified > published || expires <= published) reject("MONITOR_BACKUP_PROJECTION_TIME_INVALID");
  exactKeys(value.release, ["activation_id", "activated_at", "postdeploy_receipt_sha256", "release_manifest_sha256", "application_version", "git_commit"], "MONITOR_BACKUP_RELEASE_FIELDS_INVALID");
  identifier(value.release.activation_id, "MONITOR_BACKUP_RELEASE_INVALID");
  iso(value.release.activated_at, "MONITOR_BACKUP_RELEASE_INVALID");
  digest(value.release.postdeploy_receipt_sha256, "MONITOR_BACKUP_RELEASE_INVALID");
  digest(value.release.release_manifest_sha256, "MONITOR_BACKUP_RELEASE_INVALID");
  if (!VERSION.test(value.release.application_version || "") || !COMMIT.test(value.release.git_commit || "")) reject("MONITOR_BACKUP_RELEASE_INVALID");
  if ([recovery, verified, published].some((time) => time < Date.parse(value.release.activated_at))) reject("MONITOR_BACKUP_EVIDENCE_PREDATES_ACTIVATION");
  exactKeys(value.backup, ["verification_status", "evidence_scope", "transfer_status", "encryption_status", "cluster_transfer_status", "cluster_security_status", "credential_binding_status", "tablespace_status", "recovery_execution_status", "schedule_status", "retention_status", "identity_status", "policy_status", "assurance_status", "recovery_ready", "policy_id", "rpo_hours"], "MONITOR_BACKUP_STATUS_FIELDS_INVALID");
  for (const [field, allowed] of Object.entries(ENUMS)) if (!allowed.has(value.backup[field])) reject("MONITOR_BACKUP_STATUS_INVALID");
  if (typeof value.backup.recovery_ready !== "boolean") reject("MONITOR_BACKUP_STATUS_INVALID");
  identifier(value.backup.policy_id, "MONITOR_BACKUP_STATUS_INVALID");
  integer(value.backup.rpo_hours, 1, 168, "MONITOR_BACKUP_STATUS_INVALID");
  if (value.backup.recovery_ready && (value.backup.verification_status !== "RECOVERY_READY" || value.backup.evidence_scope !== "ACTUAL_OFFHOST" || value.backup.transfer_status !== "VERIFIED" || value.backup.encryption_status !== "VERIFIED" || value.backup.cluster_transfer_status !== "VERIFIED" || value.backup.cluster_security_status !== "VERIFIED" || value.backup.credential_binding_status !== "VERIFIED" || value.backup.tablespace_status !== "VERIFIED" || value.backup.recovery_execution_status !== "PUBLISHED" || value.backup.schedule_status !== "ON_TIME" || value.backup.retention_status !== "POLICY_VALID_DRY_RUN" || value.backup.identity_status !== "MATCHED" || value.backup.policy_status !== "MATCHED" || value.backup.assurance_status !== "MATCHED")) reject("MONITOR_BACKUP_READY_STATUS_INVALID");
  return value;
}

export function validateBackupProjectionForEvaluation(value, evaluatorConfig, previousWatermark = undefined, evaluationTime) {
  const projection = validateBackupProjection(value);
  const config = validateMonitoringEvaluatorConfig(evaluatorConfig);
  exactKeys(evaluationTime, ["observed_at", "max_clock_skew_seconds"], "MONITOR_BACKUP_EVALUATION_TIME_INVALID");
  iso(evaluationTime.observed_at, "MONITOR_BACKUP_EVALUATION_TIME_INVALID");
  integer(evaluationTime.max_clock_skew_seconds, 30, 600, "MONITOR_BACKUP_EVALUATION_TIME_INVALID");
  const latestAllowed = Date.parse(evaluationTime.observed_at) + evaluationTime.max_clock_skew_seconds * 1000;
  if ([projection.published_at, projection.verified_at, projection.recovery_point_at].some((field) => Date.parse(field) > latestAllowed)) reject("MONITOR_BACKUP_PROJECTION_FUTURE_DATED");
  if (projection.producer.bundle_sha256 !== config.evidence.backup_producer_bundle_sha256 || projection.release.activation_id !== config.evidence.release_activation_id || projection.release.activated_at !== config.evidence.release_activated_at || projection.release.postdeploy_receipt_sha256 !== config.evidence.postdeploy_receipt_sha256 || projection.release.release_manifest_sha256 !== config.monitoring.release_expectation.release_manifest_sha256 || projection.release.application_version !== config.monitoring.release_expectation.application_version || projection.release.git_commit !== config.monitoring.release_expectation.git_commit || projection.generation < config.evidence.minimum_backup_projection_generation) reject("MONITOR_BACKUP_PROJECTION_BINDING_INVALID");
  if (previousWatermark === null && (config.evidence.minimum_backup_projection_generation !== 1 || projection.generation !== 1 || projection.previous_projection_sha256 !== ZERO_SHA256)) reject("MONITOR_BACKUP_PROJECTION_BOOTSTRAP_ANCHOR_REQUIRED");
  if (previousWatermark !== null && previousWatermark !== undefined) {
    exactKeys(previousWatermark, ["generation", "projection_sha256", "published_at", "verified_at", "recovery_point_at"], "MONITOR_BACKUP_WATERMARK_INVALID");
    integer(previousWatermark.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_BACKUP_WATERMARK_INVALID");
    digest(previousWatermark.projection_sha256, "MONITOR_BACKUP_WATERMARK_INVALID");
    iso(previousWatermark.published_at, "MONITOR_BACKUP_WATERMARK_INVALID");
    iso(previousWatermark.verified_at, "MONITOR_BACKUP_WATERMARK_INVALID");
    iso(previousWatermark.recovery_point_at, "MONITOR_BACKUP_WATERMARK_INVALID");
    if (projection.generation < previousWatermark.generation || Date.parse(projection.published_at) < Date.parse(previousWatermark.published_at) || Date.parse(projection.verified_at) < Date.parse(previousWatermark.verified_at) || Date.parse(projection.recovery_point_at) < Date.parse(previousWatermark.recovery_point_at)) reject("MONITOR_BACKUP_PROJECTION_ROLLBACK");
    if (projection.generation === previousWatermark.generation) {
      if (projection.projection_sha256 !== previousWatermark.projection_sha256 || projection.published_at !== previousWatermark.published_at || projection.verified_at !== previousWatermark.verified_at || projection.recovery_point_at !== previousWatermark.recovery_point_at) reject("MONITOR_BACKUP_PROJECTION_REPLAY_MISMATCH");
    } else if (projection.generation !== previousWatermark.generation + 1 || projection.previous_projection_sha256 !== previousWatermark.projection_sha256) reject("MONITOR_BACKUP_PROJECTION_CHAIN_INVALID");
  }
  return projection;
}

export function backupProjectionWatermark(value) {
  const projection = validateBackupProjection(value);
  return Object.freeze({ generation: projection.generation, projection_sha256: projection.projection_sha256, published_at: projection.published_at, verified_at: projection.verified_at, recovery_point_at: projection.recovery_point_at });
}

export function backupProjectionObservation(value, observedAt, maxClockSkewSeconds) {
  const projection = validateBackupProjection(value);
  iso(observedAt, "MONITOR_BACKUP_OBSERVATION_TIME_INVALID");
  integer(maxClockSkewSeconds, 30, 600, "MONITOR_BACKUP_OBSERVATION_TIME_INVALID");
  const latestAllowed = Date.parse(observedAt) + maxClockSkewSeconds * 1000;
  if ([projection.published_at, projection.verified_at, projection.recovery_point_at].some((field) => Date.parse(field) > latestAllowed)) reject("MONITOR_BACKUP_PROJECTION_FUTURE_DATED");
  return Object.freeze({
    status: "AVAILABLE",
    observed_at: observedAt,
    verification_status: projection.backup.verification_status,
    evidence_scope: projection.backup.evidence_scope,
    transfer_status: projection.backup.transfer_status,
    encryption_status: projection.backup.encryption_status,
    cluster_transfer_status: projection.backup.cluster_transfer_status,
    cluster_security_status: projection.backup.cluster_security_status,
    credential_binding_status: projection.backup.credential_binding_status,
    tablespace_status: projection.backup.tablespace_status,
    recovery_execution_status: projection.backup.recovery_execution_status,
    schedule_status: projection.backup.schedule_status,
    retention_status: projection.backup.retention_status,
    identity_status: projection.backup.identity_status,
    policy_status: projection.backup.policy_status,
    assurance_status: projection.backup.assurance_status,
    recovery_ready: projection.backup.recovery_ready,
    recovery_point_at: projection.recovery_point_at,
    expires_at: projection.expires_at,
    policy_id: projection.backup.policy_id,
    rpo_hours: projection.backup.rpo_hours,
  });
}

export function createBackupProjection(value) {
  const projection = { ...value, projection_sha256: "" };
  projection.projection_sha256 = monitoringSha256(projectionBody(projection));
  return Object.freeze(validateBackupProjection(projection));
}
