import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_IDENTITY_PUBLISH_LOCK,
  RELEASE_IDENTITY_ROOT_MARKER,
  RELEASE_IDENTITY_ROOT_MARKER_VALUE,
  parseStrictJson,
  validateReleaseIdentity,
} from "./release-identity-contract.mjs";
import { validateBackupRecoveryReadinessV4 } from "./backup-recovery-readiness-v4.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import {
  CLUSTER_POLICY_ACTIVATION_CURRENT_FILE,
  CLUSTER_POLICY_ACTIVATION_STATE_ROOT,
  CLUSTER_POLICY_TARGET_FILE,
  validateClusterRecoveryPolicyActivationReceipt,
} from "./postgresql-cluster-recovery-policy-v2-activation-contract.mjs";
import {
  readinessPolicySha256,
  validateClusterRecoveryPolicyForReadiness,
} from "./postgresql-cluster-recovery-policy-v2-contract.mjs";
import { validateReleaseManifest } from "./release-manifest-contract.mjs";
import {
  assertUatPromotionMigrationEngineResultMatchesAllowlist,
  assertUatPromotionMigrationResultMatchesGrant,
  createUatPromotionMigrationGrant,
  validateUatPromotionMigrationGrant,
  validateUatPromotionMigrationResult,
} from "./uat-promotion-migration-execution-contract.mjs";
import {
  assertUatPromotionActiveFenceTransferMatchesResult,
  assertUatPromotionComposeDeploymentResultMatchesIntent,
  validateUatPromotionActiveMigrationFence,
  validateUatPromotionActiveFenceTransfer,
  validateUatPromotionComposeDeploymentResult,
} from "./uat-promotion-compose-deployment-contract.mjs";
import {
  canonicalRuntimeConfigurationProbeJson,
  validateRuntimeConfigurationProbeReceipt,
} from "./postdeploy-runtime-configuration-probe.mjs";
import {
  buildReleaseIdentityFromPostDeployReceipt,
  validatePostDeployReceipt,
} from "./postdeploy-release-contract.mjs";
import {
  UAT_PROMOTION_CROSS_ROLE_RESULT_MARKER,
  UAT_PROMOTION_CROSS_ROLE_RESULT_MARKER_VALUE,
  UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT,
  canonicalUatPromotionCrossRoleResultJson,
  validateCrossRoleUatTemplate,
  validateUatPromotionCrossRoleResult,
} from "./uat-promotion-cross-role-evidence-contract.mjs";
import { canonicalJson as canonicalReleaseJson } from "./release-manifest-contract.mjs";

export const UAT_PROMOTION_POLICY_CONTRACT = "chenyida-erp-uat-promotion-transaction-policy/v1";
export const UAT_PROMOTION_CONTEXT_CONTRACT = "chenyida-erp-uat-promotion-transaction-context/v1";
export const UAT_PROMOTION_INTENT_CONTRACT = "chenyida-erp-uat-promotion-intent/v1";
export const UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT = "chenyida-erp-uat-promotion-snapshot-intent/v1";
export const UAT_PROMOTION_QUIESCE_INTENT_CONTRACT = "chenyida-erp-uat-promotion-quiesce-intent/v1";
export const UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT = "chenyida-erp-uat-promotion-migration-authorization-intent/v1";
export const UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT = "chenyida-erp-uat-promotion-migration-execution-intent/v1";
export const UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_CONTRACT = "chenyida-erp-uat-promotion-compose-deployment-intent/v1";
export const UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT = "chenyida-erp-uat-promotion-postdeploy-runtime-intent/v1";
export const UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_CONTRACT = "chenyida-erp-uat-promotion-postdeploy-identity-intent/v1";
export const UAT_PROMOTION_CROSS_ROLE_INTENT_CONTRACT = "chenyida-erp-uat-promotion-cross-role-intent/v1";
export const UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_CONTRACT = "chenyida-erp-uat-promotion-postdeploy-identity-evidence/v1";
export const UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONTRACT = "chenyida-erp-uat-promotion-postdeploy-containment/v1";
export const UAT_PROMOTION_RECEIPT_CONTRACT = "chenyida-erp-uat-promotion-checkpoint-receipt/v1";
export const UAT_PROMOTION_RECOVERY_CONTRACT = "chenyida-erp-uat-promotion-recovery/v3";
export const UAT_PROMOTION_QUARANTINE_CONTRACT = "chenyida-erp-uat-promotion-quarantine/v3";
export const UAT_PROMOTION_STATE_ROOT = "/var/lib/chenyida-erp/uat-promotion-transactions-v1";
export const UAT_PROMOTION_CURRENT_FILE = `${UAT_PROMOTION_STATE_ROOT}/current.json`;
export const UAT_PROMOTION_STATE_MARKER = ".chenyida-erp-uat-promotion-transactions-v1";
export const UAT_PROMOTION_STATE_MARKER_VALUE = "chenyida-erp-uat-promotion-transactions/v1\n";
export const UAT_PROMOTION_POLICY_RELATIVE = "operations/uat-promotion-transaction-policy-v1.json";
export const UAT_PROMOTION_POLICY_FILE_SHA256 = "a78d551ffe8496d31ef3cfb6c961c464748ec0b6badf733951bf57194a4b2bae";
export const UAT_PROMOTION_POLICY_SHA256 = "5ade8772ad9dd4961c128c8eca1bdeec7b4909f79a5b275b6be14ab4961caf37";
export const ZERO_SHA256 = "0".repeat(64);

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const SUPERVISOR_BUNDLE_ROOT = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const RELEASE_IDENTITY_FILE = "/var/lib/chenyida-erp/release-identity/release-identity.json";
const RELEASE_ARTIFACT_MARKER = ".chenyida-erp-release-artifact-root-v1";
const RELEASE_ARTIFACT_MARKER_VALUE = "chenyida-erp-release-artifact-root/v1\n";
const BACKUP_STATUS_FILE = "/var/lib/chenyida-erp/backup-status/recovery-readiness.json";
const BACKUP_STATUS_ROOT = path.dirname(BACKUP_STATUS_FILE);
const BACKUP_STATUS_MARKER = ".chenyida-erp-receipt-root-v2";
const BACKUP_STATUS_MARKER_VALUE = "chenyida-erp-receipt-root/v2\n";
const CLUSTER_POLICY_TARGET_MARKER = ".chenyida-erp-postgresql-cluster-recovery-policy-v2";
const CLUSTER_POLICY_TARGET_MARKER_VALUE = "chenyida-erp-postgresql-cluster-recovery-policy-target/v1\n";
const CLUSTER_POLICY_STATE_MARKER = ".chenyida-erp-postgresql-cluster-recovery-policy-v2";
const CLUSTER_POLICY_STATE_MARKER_VALUE = "chenyida-erp-postgresql-cluster-recovery-policy-activation/v1\n";
const ACTIVE_MIGRATION_FENCES_ROOT = `${UAT_PROMOTION_STATE_ROOT}/active-fences`;
const FENCE_TRANSFERS_ROOT = `${UAT_PROMOTION_STATE_ROOT}/fence-transfers`;
const RUNTIME_PROBE_ROOT = "/var/lib/chenyida-erp/runtime-probes";
const RUNTIME_PROBE_MARKER = ".chenyida-erp-runtime-probe-root-v1";
const RUNTIME_PROBE_MARKER_VALUE = "chenyida-erp-runtime-probe-root/v1\n";
const POSTDEPLOY_ROOT = "/var/lib/chenyida-erp/postdeploy";
const CROSS_ROLE_UAT_CONTRACT_RELATIVE = "chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json";
const UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONTRACT = "chenyida-erp-uat-promotion-postdeploy-control-binding/v1";
const POSTDEPLOY_RUNTIME_GUARD_CONTRACT = "chenyida-erp-release-runtime-guard/v1";
const POSTDEPLOY_RUNTIME_GUARD_MODE = "POST_DEPLOY_CURRENT_RUNTIME_STRICT";
const POSTDEPLOY_RUNTIME_POLICY_SHA256 = "e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^0\.1\.0-alpha\.\d+$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const IMAGE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const POSTDEPLOY_FAILURE_CODES = Object.freeze({
  POST_AUTHORIZATION_SOURCE_RECHECK: "UAT_PROMOTION_POSTDEPLOY_POST_AUTHORIZATION_SOURCE_RECHECK_FAILED",
  EXTERNAL_CONTROL: "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
  JOURNAL_EXECUTION: "UAT_PROMOTION_POSTDEPLOY_JOURNAL_EXECUTION_FAILED",
  RESULT_CROSSCHECK: "UAT_PROMOTION_POSTDEPLOY_RESULT_CROSSCHECK_FAILED",
});

function validatePostdeployFailure(stage, code) {
  if (!Object.hasOwn(POSTDEPLOY_FAILURE_CODES, stage) || POSTDEPLOY_FAILURE_CODES[stage] !== code) {
    reject("UAT_PROMOTION_POSTDEPLOY_FAILURE_CLASSIFICATION_INVALID");
  }
  return Object.freeze({ stage, code });
}
const ROLE = /^[a-z_][a-z0-9_$-]{0,62}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const BACKUP_ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const COMPOSE_CONFIG_HASH = /^[0-9a-f]{64}$/u;
const DOCKER_BINARY = "/usr/bin/docker";
const SOURCE_FIELDS = Object.freeze(["path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink"]);
const CHECKPOINT_ORDER = Object.freeze([
  "CANDIDATE_SOURCE_SNAPSHOT",
  "ELIGIBLE_RELEASE_MANIFEST",
  "PRE_DEPLOY_RUNTIME_STABILITY",
  "PROMOTION_INTENT_AND_DURABLE_JOURNAL",
  "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT",
  "WRITER_QUIESCE_RECEIPT",
  "ONE_TIME_MIGRATION_AUTHORIZATION",
  "MIGRATION_COMMIT_RECEIPT",
  "COMPOSE_DEPLOYMENT_RECEIPT",
  "POST_DEPLOY_RUNTIME_CONFIGURATION",
  "POST_DEPLOY_IDENTITY",
  "CROSS_ROLE_UAT_EXECUTION",
  "PROMOTION_FINAL_RECEIPT",
  "ROLLBACK_TO_UAT_EXECUTOR",
  "ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT",
]);
const PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_promotion_receipt_sha256",
  "repository_root", "git_commit", "git_tree", "candidate_snapshot_receipt", "candidate_snapshot_receipt_sha256",
  "candidate_snapshot_source", "test_runtime_root", "application_version", "release_manifest",
  "release_manifest_sha256", "release_manifest_source", "web_image", "worker_image", "migration_head",
  "migration_manifest_sha256", "current_runtime_identity_source", "recovery_readiness_source",
  "preupgrade_recovery_readiness_sha256", "preupgrade_recovery_snapshot_sha256", "database_name", "database_oid",
  "database_system_identifier", "database_marker", "promotion_created_at", "promotion_expires_at",
  "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256",
  "policy_sha256", "current_promotion_source",
]);
const CONTEXT_FIELDS = Object.freeze([
  "schema_version", "contract", "operation_id", "operation", "execution_mode", "execution_authorization_id",
  "execution_authorization_sha256", "execution_created_at", "original_authorization_sha256",
  "supervisor_bundle_sha256", "expected_intent_sha256", "parameters",
]);
const SNAPSHOT_OBJECT_FIELDS = Object.freeze(["file", "sha256", "bytes", "entries"]);
const SNAPSHOT_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256", "candidate_binding_sha256",
  "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
  "current_checkpoint_source", "runtime_identity_source", "snapshot_readiness", "snapshot_readiness_file_sha256",
  "snapshot_readiness_sha256", "snapshot_readiness_source", "snapshot_policy", "snapshot_policy_file_sha256",
  "snapshot_policy_sha256", "snapshot_policy_source", "snapshot_policy_activation",
  "snapshot_policy_activation_file_sha256", "snapshot_policy_activation_receipt_sha256",
  "snapshot_policy_activation_source", "snapshot_backup_id", "snapshot_restore_run_id", "snapshot_objects",
  "snapshot_created_at", "snapshot_expires_at", "requester_identity_sha256", "approver_identity_sha256",
  "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
]);
const QUIESCE_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256", "snapshot_operation_id",
  "snapshot_intent_sha256", "snapshot_intent_source", "candidate_binding_sha256", "database_binding_sha256",
  "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
  "current_checkpoint_source", "runtime_identity_source", "deployment_class", "deployment_id", "compose_project",
  "compose_project_root", "web_container", "web_container_id", "worker_container", "worker_container_id",
  "quiesce_created_at", "quiesce_expires_at", "requester_identity_sha256", "approver_identity_sha256",
  "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
]);
const MIGRATION_AUTHORIZATION_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256", "quiesce_operation_id",
  "quiesce_intent_sha256", "quiesce_intent_source", "candidate_binding_sha256", "database_binding_sha256",
  "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
  "writer_quiesce_binding_sha256", "current_checkpoint_source", "runtime_identity_source", "release_manifest",
  "release_manifest_sha256", "release_manifest_source", "deployment_class", "deployment_id", "database_name",
  "database_oid", "database_system_identifier", "database_marker", "expected_current_migration_head",
  "target_migration_head", "migration_manifest_sha256", "migration_role", "authorization_created_at",
  "authorization_expires_at", "requester_identity_sha256", "approver_identity_sha256",
  "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
]);
const MIGRATION_EXECUTION_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256",
  "migration_authorization_operation_id", "migration_authorization_intent_sha256",
  "migration_authorization_intent_source", "migration_approval_authorization_sha256",
  "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
  "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
  "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
  "current_checkpoint_source", "runtime_identity_source", "release_manifest", "release_manifest_sha256",
  "release_manifest_source", "deployment_class", "deployment_id", "database_name", "database_oid",
  "database_system_identifier", "database_marker", "expected_current_migration_head", "target_migration_head",
  "migration_manifest_sha256", "migration_role", "control_role", "worker_image", "postgres_container",
  "postgres_container_id", "postgres_image_digest", "backend_network", "execution_created_at",
  "execution_expires_at", "requester_identity_sha256", "approver_identity_sha256",
  "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
]);
const COMPOSE_DEPLOYMENT_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256", "migration_operation_id",
  "migration_execution_intent_sha256", "migration_execution_intent_source",
  "migration_execution_authorization_sha256", "migration_grant_sha256", "migration_result_sha256",
  "migration_result_source", "active_migration_fence_sha256", "active_migration_fence_source",
  "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
  "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
  "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
  "migration_fence_binding_sha256", "migration_result_binding_sha256", "current_checkpoint_source",
  "runtime_identity_source", "release_manifest", "release_manifest_sha256", "release_manifest_source",
  "deployment_class", "deployment_id", "compose_project", "compose_project_root",
  "compose_file_source", "compose_release_file_source", "deployment_environment",
  "deployment_environment_sha256", "deployment_environment_source", "web_image", "worker_image",
  "web_container", "old_web_container_id", "old_web_image_digest", "worker_container",
  "old_worker_container_id", "old_worker_image_digest", "postgres_container", "postgres_container_id",
  "postgres_image_digest", "caddy_container", "caddy_container_id", "caddy_image_digest",
  "backend_network", "edge_network", "reader_gid", "database_name", "database_oid",
  "database_system_identifier", "database_marker", "control_role", "deployment_created_at",
  "deployment_expires_at", "requester_identity_sha256", "approver_identity_sha256",
  "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
]);
const POSTDEPLOY_COMMON_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256", "candidate_binding_sha256",
  "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
  "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
  "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
  "migration_result_binding_sha256", "compose_deployment_binding_sha256", "current_checkpoint_source",
  "deployment_operation_id", "deployment_result_sha256", "deployment_result_source",
  "fence_transfer_sha256", "fence_transfer_source", "release_manifest", "release_manifest_sha256",
  "release_manifest_source", "deployment_class", "deployment_id", "compose_project",
  "compose_project_root", "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256",
  "reader_gid", "caddy_container", "postgres_container", "web_container", "worker_container",
  "verification_created_at", "verification_expires_at", "requester_identity_sha256",
  "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
]);
const POSTDEPLOY_RUNTIME_PARAMETER_FIELDS = Object.freeze([
  ...POSTDEPLOY_COMMON_PARAMETER_FIELDS, "probe_root", "probe_id",
]);
const POSTDEPLOY_IDENTITY_PARAMETER_FIELDS = Object.freeze([
  ...POSTDEPLOY_COMMON_PARAMETER_FIELDS, "runtime_probe_operation_id", "runtime_probe_intent_sha256",
  "runtime_probe_intent_source", "runtime_probe_result_sha256", "runtime_probe_result_source",
  "runtime_probe_receipt", "runtime_probe_receipt_sha256", "runtime_probe_receipt_source",
  "runtime_configuration_sha256", "postdeploy_root", "identity_root", "run_id",
]);
const CROSS_ROLE_UAT_PARAMETER_FIELDS = Object.freeze([
  "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
  "promotion_intent_sha256", "promotion_original_authorization_sha256", "candidate_binding_sha256",
  "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
  "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
  "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
  "migration_result_binding_sha256", "compose_deployment_binding_sha256", "current_checkpoint_source",
  "postdeploy_identity_operation_id", "postdeploy_identity_intent_sha256",
  "postdeploy_identity_intent_source", "postdeploy_identity_evidence_sha256",
  "postdeploy_identity_evidence_source", "release_identity_sha256", "release_identity_source",
  "cross_role_contract", "cross_role_contract_file_sha256", "cross_role_contract_artifact_sha256",
  "cross_role_contract_source", "authorization_matrix_artifact_sha256",
  "authorization_matrix_source_manifest_sha256", "cross_role_result_root", "result_id",
  "cross_role_result", "cross_role_result_file_sha256", "cross_role_result_sha256",
  "cross_role_result_source", "verification_created_at", "verification_expires_at",
  "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256",
  "policy_file_sha256", "policy_sha256",
]);
const WRITER_CAPTURE_FIELDS = Object.freeze([
  "deployment_class", "deployment_id", "compose_project", "snapshot_recovery_point_at", "snapshot_writer_verified_at",
  "application_version", "git_commit", "migration_head", "migration_manifest_sha256", "web", "worker",
]);
const CAPTURED_WRITER_FIELDS = Object.freeze(["container_name", "container_id", "image_digest"]);
const QUIESCED_WRITER_FIELDS = Object.freeze([
  "container_name", "container_id", "service", "image_digest", "compose_project", "compose_project_root",
  "compose_config_hash", "created_at", "last_started_at", "last_finished_at", "restart_count", "exit_code",
  "status", "running", "restarting", "paused", "dead", "oom_killed", "oneoff", "container_number",
  "application_version", "git_commit",
]);

export class UatPromotionTransactionError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionTransactionError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionTransactionError(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function digest(value, code, allowZero = false) {
  if (typeof value !== "string" || !SHA256.test(value) || (!allowZero && value === ZERO_SHA256)) reject(code);
  return value;
}
function identifier(value, code) { if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code); return value; }
function integer(value, minimum, maximum, code) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code); return value; }
function iso(value, code) { if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code); return value; }
function backupInstant(value, code) {
  if (typeof value !== "string" || !BACKUP_ISO_UTC.test(value)) reject(code);
  const normalized = value.replace(/\.(\d{3})\d+Z$/u, ".$1Z");
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) reject(code);
  return parsed;
}
function sha256(raw) { return createHash("sha256").update(raw).digest("hex"); }
function modeOf(metadata) { return Number(metadata.mode & 0o7777n); }
function bodyWithout(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }
function operationArtifactMatches(name, operationId) {
  const match = /^(.+)\.([0-9a-f]{64})\.json$/u.exec(name);
  return match !== null && match[1] === operationId;
}

function validatePolicy(value) {
  exactKeys(value, [
    "schema_version", "contract", "authority", "deployment", "state", "authorization", "required_intent_bindings",
    "snapshot_writer_dependency", "checkpoint_order", "initial_checkpoint", "adapters", "journal",
  ], "UAT_PROMOTION_POLICY_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POLICY_CONTRACT
    || value.authority !== "ROOT_RELEASE_SUPERVISOR_ONE_TIME_AUTHORIZATION") reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.deployment, ["class", "id", "database", "database_marker"], "UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.deployment, { class: "UAT", id: "chenyida-erp", database: "chenyida_erp", database_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp" })) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.state, ["root", "marker", "marker_value", "directory_mode", "file_mode", "owner_uid", "owner_gid"], "UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.state, { root: UAT_PROMOTION_STATE_ROOT, marker: UAT_PROMOTION_STATE_MARKER, marker_value: UAT_PROMOTION_STATE_MARKER_VALUE, directory_mode: "0700", file_mode: "0400", owner_uid: 0, owner_gid: 0 })) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.authorization, ["contract", "maximum_window_minutes", "required_distinct_actors", "begin_operation", "snapshot_operation", "quiesce_operation", "migration_authorization_operation", "migration_execution_operation", "compose_deployment_operation", "postdeploy_runtime_configuration_operation", "postdeploy_identity_operation", "cross_role_uat_operation", "recovery_operation"], "UAT_PROMOTION_POLICY_INVALID");
  if (value.authorization.contract !== "chenyida-erp-release-supervisor-authorization/v6"
    || value.authorization.maximum_window_minutes !== 60 || value.authorization.begin_operation !== "BEGIN_UAT_PROMOTION"
    || value.authorization.snapshot_operation !== "CAPTURE_UAT_PROMOTION_SNAPSHOT"
    || value.authorization.quiesce_operation !== "QUIESCE_UAT_WRITERS"
    || value.authorization.migration_authorization_operation !== "AUTHORIZE_UAT_PROMOTION_MIGRATION"
    || value.authorization.migration_execution_operation !== "RUN_UAT_PROMOTION_MIGRATION"
    || value.authorization.compose_deployment_operation !== "DEPLOY_UAT_RELEASE"
    || value.authorization.postdeploy_runtime_configuration_operation !== "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION"
    || value.authorization.postdeploy_identity_operation !== "VERIFY_UAT_POSTDEPLOY_IDENTITY"
    || value.authorization.cross_role_uat_operation !== "VERIFY_UAT_CROSS_ROLE_EXECUTION"
    || value.authorization.recovery_operation !== "RECOVER_UAT_PROMOTION"
    || !same(value.authorization.required_distinct_actors, ["requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256"])) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.snapshot_writer_dependency, [
    "backup_capture_precondition", "snapshot_checkpoint", "postcapture_quiesce_checkpoint", "checkpoint_order_decision",
    "continued_quiesce_proof", "compose_inventory_scope", "external_writer_boundary",
  ], "UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.snapshot_writer_dependency, {
    backup_capture_precondition: "EXACT_COMPOSE_WEB_WORKER_STOPPED",
    snapshot_checkpoint: "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT",
    postcapture_quiesce_checkpoint: "WRITER_QUIESCE_RECEIPT",
    checkpoint_order_decision: "CAPTURE_EMBEDS_WRITER_STOP_PROOF_AND_NEXT_CHECKPOINT_PROVES_CONTINUED_QUIESCE",
    continued_quiesce_proof: "SAME_CAPTURED_CONTAINER_IDS_STOPPED_WITH_LAST_START_AND_FINISH_NOT_AFTER_CAPTURE_VERIFY",
    compose_inventory_scope: "EXACT_PROJECT_AND_WORKING_DIRECTORY_NO_REPLACEMENT",
    external_writer_boundary: "NOT_PROVEN_UNTIL_ONE_TIME_MIGRATION_DATABASE_FENCE",
  })) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.checkpoint_order, CHECKPOINT_ORDER) || value.initial_checkpoint !== CHECKPOINT_ORDER[3]) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!Array.isArray(value.required_intent_bindings) || value.required_intent_bindings.length !== 16
    || new Set(value.required_intent_bindings).size !== value.required_intent_bindings.length) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!Array.isArray(value.adapters) || value.adapters.length !== 11) reject("UAT_PROMOTION_POLICY_INVALID");
  const expectedAdapters = new Map([
    ["BEGIN_UAT_PROMOTION", "IMPLEMENTED"], ["CAPTURE_UAT_PROMOTION_SNAPSHOT", "IMPLEMENTED"],
    ["QUIESCE_UAT_WRITERS", "IMPLEMENTED"], ["RUN_UAT_PROMOTION_MIGRATION", "IMPLEMENTED"],
    ["AUTHORIZE_UAT_PROMOTION_MIGRATION", "IMPLEMENTED"],
    ["DEPLOY_UAT_RELEASE", "IMPLEMENTED"],
    ["VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION", "IMPLEMENTED"],
    ["VERIFY_UAT_POSTDEPLOY_IDENTITY", "IMPLEMENTED"],
    ["VERIFY_UAT_CROSS_ROLE_EXECUTION", "IMPLEMENTED"],
    ["ROLLBACK_UAT_RELEASE", "NOT_IMPLEMENTED"],
    ["RECOVER_UAT_PROMOTION", "IMPLEMENTED"],
  ]);
  for (const adapter of value.adapters) {
    exactKeys(adapter, ["operation", "status", "checkpoints"], "UAT_PROMOTION_POLICY_INVALID");
    if (expectedAdapters.get(adapter.operation) !== adapter.status || !Array.isArray(adapter.checkpoints)
      || adapter.checkpoints.some((checkpoint) => !CHECKPOINT_ORDER.includes(checkpoint))) reject("UAT_PROMOTION_POLICY_INVALID");
    expectedAdapters.delete(adapter.operation);
  }
  if (expectedAdapters.size !== 0) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.journal, [
    "initial_completed_checkpoint_count", "initial_status", "terminal_statuses", "blocking_statuses",
    "require_previous_receipt_sha256", "require_same_candidate_database_snapshot_and_intent", "allow_checkpoint_skip",
    "allow_overwrite", "quarantine_preservation",
  ], "UAT_PROMOTION_POLICY_INVALID");
  if (value.journal.initial_completed_checkpoint_count !== 4 || value.journal.initial_status !== "IN_PROGRESS"
    || value.journal.require_previous_receipt_sha256 !== true || value.journal.require_same_candidate_database_snapshot_and_intent !== true
    || value.journal.allow_checkpoint_skip !== false || value.journal.allow_overwrite !== false
    || value.journal.quarantine_preservation !== "FILES_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE") reject("UAT_PROMOTION_POLICY_INVALID");
  return value;
}

async function repositoryPolicy(siteRoot) {
  const file = path.join(siteRoot, UAT_PROMOTION_POLICY_RELATIVE);
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject("UAT_PROMOTION_POLICY_REPLACED"); }
  let raw;
  try { raw = await handle.readFile(); } finally { await handle.close(); }
  if (sha256(raw) !== UAT_PROMOTION_POLICY_FILE_SHA256) reject("UAT_PROMOTION_POLICY_REPLACED");
  let policy;
  try { policy = validatePolicy(parseStrictJson(raw.toString("utf8"), MAX_JSON_BYTES)); }
  catch { reject("UAT_PROMOTION_POLICY_INVALID"); }
  if (clusterSha256(policy) !== UAT_PROMOTION_POLICY_SHA256) reject("UAT_PROMOTION_POLICY_REPLACED");
  return Object.freeze({ policy, fileSha256: sha256(raw), policySha256: clusterSha256(policy) });
}

function validateSourceSpec(value, expectedPath, allowedModes, code, expectedGid = null) {
  exactKeys(value, SOURCE_FIELDS, code);
  if (typeof value.path !== "string" || !path.isAbsolute(value.path) || path.normalize(value.path) !== value.path
    || expectedPath !== null && value.path !== expectedPath || !Number.isSafeInteger(value.bytes) || value.bytes < 2 || value.bytes > MAX_JSON_BYTES
    || typeof value.device !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value.device)
    || typeof value.inode !== "string" || !/^[1-9][0-9]*$/u.test(value.inode)
    || value.uid !== 0 || !Number.isSafeInteger(value.gid) || value.gid < 0 || value.gid > 2_147_483_647
    || expectedGid !== null && value.gid !== expectedGid || !allowedModes.has(value.mode) || value.nlink !== 1) reject(code);
  digest(value.sha256, code);
  return value;
}

export function validateUatPromotionParameters(value) {
  exactKeys(value, PARAMETER_FIELDS, "UAT_PROMOTION_PARAMETERS_INVALID");
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_ID_INVALID");
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_GENERATION_INVALID");
  digest(value.previous_promotion_receipt_sha256, "UAT_PROMOTION_CHAIN_DIGEST_INVALID", true);
  for (const field of ["repository_root", "candidate_snapshot_receipt", "test_runtime_root", "release_manifest"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field]) || path.normalize(value[field]) !== value[field] || value[field] === "/") reject("UAT_PROMOTION_PATH_INVALID");
  }
  if (!COMMIT.test(value.git_commit) || !COMMIT.test(value.git_tree) || !VERSION.test(value.application_version)
    || !IMAGE.test(value.web_image) || !IMAGE.test(value.worker_image) || value.web_image === value.worker_image
    || !MIGRATION.test(value.migration_head)) reject("UAT_PROMOTION_CANDIDATE_INVALID");
  for (const field of [
    "candidate_snapshot_receipt_sha256", "release_manifest_sha256", "migration_manifest_sha256",
    "preupgrade_recovery_readiness_sha256", "preupgrade_recovery_snapshot_sha256", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], "UAT_PROMOTION_DIGEST_INVALID");
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256 || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  const actors = new Set([value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256]);
  if (actors.size !== 3 || actors.has(ZERO_SHA256)) reject("UAT_PROMOTION_ACTORS_INVALID");
  if (value.database_name !== "chenyida_erp" || !/^[1-9][0-9]{0,9}$/u.test(value.database_oid)
    || !/^[1-9][0-9]{9,29}$/u.test(value.database_system_identifier)
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp") reject("UAT_PROMOTION_DATABASE_INVALID");
  const created = Date.parse(iso(value.promotion_created_at, "UAT_PROMOTION_TIME_INVALID"));
  const expires = Date.parse(iso(value.promotion_expires_at, "UAT_PROMOTION_TIME_INVALID"));
  if (expires <= created || expires - created > 60 * 60 * 1000) reject("UAT_PROMOTION_TIME_INVALID");
  validateSourceSpec(value.candidate_snapshot_source, value.candidate_snapshot_receipt, new Set(["0400"]), "UAT_PROMOTION_CANDIDATE_SOURCE_INVALID", 0);
  validateSourceSpec(value.release_manifest_source, value.release_manifest, new Set(["0440"]), "UAT_PROMOTION_MANIFEST_SOURCE_INVALID", 0);
  validateSourceSpec(value.current_runtime_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), "UAT_PROMOTION_RUNTIME_SOURCE_INVALID");
  validateSourceSpec(value.recovery_readiness_source, BACKUP_STATUS_FILE, new Set(["0400", "0440"]), "UAT_PROMOTION_RECOVERY_SOURCE_INVALID");
  if (value.candidate_snapshot_source.sha256 !== value.candidate_snapshot_receipt_sha256
    || value.release_manifest_source.sha256 !== value.release_manifest_sha256) reject("UAT_PROMOTION_SOURCE_BINDING_INVALID");
  if (value.promotion_generation === 1) {
    if (value.previous_promotion_receipt_sha256 !== ZERO_SHA256 || value.current_promotion_source !== null) reject("UAT_PROMOTION_GENERATION_INVALID");
  } else {
    if (value.previous_promotion_receipt_sha256 === ZERO_SHA256 || value.current_promotion_source === null) reject("UAT_PROMOTION_GENERATION_INVALID");
    validateSourceSpec(value.current_promotion_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), "UAT_PROMOTION_CURRENT_SOURCE_INVALID", 0);
  }
  return value;
}

function validateSnapshotObjects(value) {
  exactKeys(value, ["postgresql", "uploads", "attachments", "backup_status"], "UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID");
  const expectedFiles = {
    postgresql: "postgresql.dump",
    uploads: "uploads.tar.gz",
    attachments: "attachments.tar.gz",
    backup_status: "backup-status.tar.gz",
  };
  for (const [domain, expectedFile] of Object.entries(expectedFiles)) {
    const object = value[domain];
    exactKeys(object, SNAPSHOT_OBJECT_FIELDS, "UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID");
    if (object.file !== expectedFile || !Number.isSafeInteger(object.bytes) || object.bytes < 1) reject("UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID");
    digest(object.sha256, "UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID");
    if (domain === "postgresql" ? object.entries !== null : !Number.isSafeInteger(object.entries) || object.entries < 0) {
      reject("UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID");
    }
  }
  return value;
}

export function validateUatPromotionSnapshotParameters(value) {
  exactKeys(value, SNAPSHOT_PARAMETER_FIELDS, "UAT_PROMOTION_SNAPSHOT_PARAMETERS_INVALID");
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_ID_INVALID");
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_GENERATION_INVALID");
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "snapshot_readiness_file_sha256", "snapshot_readiness_sha256", "snapshot_policy_file_sha256",
    "snapshot_policy_sha256", "snapshot_policy_activation_file_sha256", "snapshot_policy_activation_receipt_sha256",
    "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], "UAT_PROMOTION_SNAPSHOT_DIGEST_INVALID");
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256 || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) {
    reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  }
  const actors = new Set([value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256]);
  if (actors.size !== 3 || actors.has(ZERO_SHA256)) reject("UAT_PROMOTION_ACTORS_INVALID");
  identifier(value.snapshot_backup_id, "UAT_PROMOTION_SNAPSHOT_ID_INVALID");
  identifier(value.snapshot_restore_run_id, "UAT_PROMOTION_SNAPSHOT_ID_INVALID");
  const created = Date.parse(iso(value.snapshot_created_at, "UAT_PROMOTION_SNAPSHOT_TIME_INVALID"));
  const expires = Date.parse(iso(value.snapshot_expires_at, "UAT_PROMOTION_SNAPSHOT_TIME_INVALID"));
  if (expires <= created || expires - created > 60 * 60 * 1000) reject("UAT_PROMOTION_SNAPSHOT_TIME_INVALID");
  for (const field of ["snapshot_readiness", "snapshot_policy", "snapshot_policy_activation"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field]) || path.normalize(value[field]) !== value[field]) reject("UAT_PROMOTION_SNAPSHOT_PATH_INVALID");
  }
  if (path.dirname(value.snapshot_readiness) !== BACKUP_STATUS_ROOT
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.recovery-readiness-v4\.json$/u.test(path.basename(value.snapshot_readiness))
    || value.snapshot_policy !== CLUSTER_POLICY_TARGET_FILE
    || value.snapshot_policy_activation !== CLUSTER_POLICY_ACTIVATION_CURRENT_FILE) reject("UAT_PROMOTION_SNAPSHOT_PATH_INVALID");
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), "UAT_PROMOTION_SNAPSHOT_CURRENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), "UAT_PROMOTION_SNAPSHOT_RUNTIME_SOURCE_INVALID");
  validateSourceSpec(value.snapshot_readiness_source, value.snapshot_readiness, new Set(["0640"]), "UAT_PROMOTION_SNAPSHOT_READINESS_SOURCE_INVALID");
  validateSourceSpec(value.snapshot_policy_source, value.snapshot_policy, new Set(["0440"]), "UAT_PROMOTION_SNAPSHOT_POLICY_SOURCE_INVALID", 0);
  validateSourceSpec(value.snapshot_policy_activation_source, value.snapshot_policy_activation, new Set(["0400"]), "UAT_PROMOTION_SNAPSHOT_POLICY_ACTIVATION_SOURCE_INVALID", 0);
  if (value.runtime_identity_source.sha256 !== value.runtime_binding_sha256
    || value.snapshot_readiness_source.sha256 !== value.snapshot_readiness_file_sha256
    || value.snapshot_policy_source.sha256 !== value.snapshot_policy_file_sha256
    || value.snapshot_policy_activation_source.sha256 !== value.snapshot_policy_activation_file_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_SOURCE_BINDING_INVALID");
  }
  validateSnapshotObjects(value.snapshot_objects);
  return value;
}

function validateCapturedWriter(value) {
  exactKeys(value, CAPTURED_WRITER_FIELDS, "UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  if (!CONTAINER_NAME.test(value.container_name) || !CONTAINER_ID.test(value.container_id)
    || !IMAGE_DIGEST.test(value.image_digest)) reject("UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  return value;
}

function validateWriterCapture(value) {
  exactKeys(value, WRITER_CAPTURE_FIELDS, "UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp" || value.compose_project !== "chenyida-erp"
    || !VERSION.test(value.application_version) || !COMMIT.test(value.git_commit) || !MIGRATION.test(value.migration_head)) {
    reject("UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  }
  digest(value.migration_manifest_sha256, "UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  const recoveryPoint = backupInstant(value.snapshot_recovery_point_at, "UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  const verifiedAfter = backupInstant(value.snapshot_writer_verified_at, "UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  if (verifiedAfter < recoveryPoint) reject("UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  validateCapturedWriter(value.web);
  validateCapturedWriter(value.worker);
  if (value.web.container_name === value.worker.container_name || value.web.container_id === value.worker.container_id) {
    reject("UAT_PROMOTION_WRITER_CAPTURE_INVALID");
  }
  return value;
}

export function validateUatPromotionQuiesceParameters(value) {
  exactKeys(value, QUIESCE_PARAMETER_FIELDS, "UAT_PROMOTION_QUIESCE_PARAMETERS_INVALID");
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  for (const field of ["promotion_id", "snapshot_operation_id"]) identifier(value[field], "UAT_PROMOTION_QUIESCE_IDENTIFIER_INVALID");
  if (value.snapshot_operation_id === value.promotion_id) reject("UAT_PROMOTION_QUIESCE_IDENTIFIER_INVALID");
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_GENERATION_INVALID");
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
    "snapshot_intent_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], "UAT_PROMOTION_QUIESCE_DIGEST_INVALID");
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256 || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) {
    reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  }
  const actors = new Set([value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256]);
  if (actors.size !== 3 || actors.has(ZERO_SHA256)) reject("UAT_PROMOTION_ACTORS_INVALID");
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp" || value.compose_project !== "chenyida-erp") {
    reject("UAT_PROMOTION_QUIESCE_DEPLOYMENT_INVALID");
  }
  if (typeof value.compose_project_root !== "string" || !path.isAbsolute(value.compose_project_root)
    || path.normalize(value.compose_project_root) !== value.compose_project_root || value.compose_project_root === "/") {
    reject("UAT_PROMOTION_QUIESCE_PROJECT_ROOT_INVALID");
  }
  if (!CONTAINER_NAME.test(value.web_container) || !CONTAINER_NAME.test(value.worker_container)
    || value.web_container === value.worker_container || !CONTAINER_ID.test(value.web_container_id)
    || !CONTAINER_ID.test(value.worker_container_id) || value.web_container_id === value.worker_container_id) {
    reject("UAT_PROMOTION_QUIESCE_CONTAINER_INVALID");
  }
  const created = Date.parse(iso(value.quiesce_created_at, "UAT_PROMOTION_QUIESCE_TIME_INVALID"));
  const expires = Date.parse(iso(value.quiesce_expires_at, "UAT_PROMOTION_QUIESCE_TIME_INVALID"));
  if (expires <= created || expires - created > 60 * 60 * 1000) reject("UAT_PROMOTION_QUIESCE_TIME_INVALID");
  const snapshotIntentPath = `${UAT_PROMOTION_STATE_ROOT}/intents/${value.snapshot_operation_id}.${value.snapshot_intent_sha256}.json`;
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), "UAT_PROMOTION_QUIESCE_CURRENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.snapshot_intent_source, snapshotIntentPath, new Set(["0400"]), "UAT_PROMOTION_QUIESCE_SNAPSHOT_INTENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), "UAT_PROMOTION_QUIESCE_RUNTIME_SOURCE_INVALID");
  if (value.runtime_identity_source.sha256 !== value.runtime_binding_sha256) reject("UAT_PROMOTION_QUIESCE_SOURCE_BINDING_INVALID");
  return value;
}

export function validateUatPromotionMigrationAuthorizationParameters(value) {
  exactKeys(value, MIGRATION_AUTHORIZATION_PARAMETER_FIELDS, "UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETERS_INVALID");
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  for (const field of ["promotion_id", "quiesce_operation_id"]) {
    identifier(value[field], "UAT_PROMOTION_MIGRATION_AUTHORIZATION_IDENTIFIER_INVALID");
  }
  if (value.promotion_id === value.quiesce_operation_id) reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_IDENTIFIER_INVALID");
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_GENERATION_INVALID");
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
    "quiesce_intent_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "release_manifest_sha256", "migration_manifest_sha256", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], "UAT_PROMOTION_MIGRATION_AUTHORIZATION_DIGEST_INVALID");
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256 || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) {
    reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  }
  const actors = new Set([value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256]);
  if (actors.size !== 3 || actors.has(ZERO_SHA256)) reject("UAT_PROMOTION_ACTORS_INVALID");
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp"
    || value.database_name !== "chenyida_erp" || !/^[1-9][0-9]{0,9}$/u.test(value.database_oid)
    || !/^[1-9][0-9]{9,29}$/u.test(value.database_system_identifier)
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp") {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_DATABASE_INVALID");
  }
  if (!MIGRATION.test(value.expected_current_migration_head) || !MIGRATION.test(value.target_migration_head)
    || typeof value.migration_role !== "string" || !ROLE.test(value.migration_role)) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_TARGET_INVALID");
  }
  if (typeof value.release_manifest !== "string" || !path.isAbsolute(value.release_manifest)
    || path.normalize(value.release_manifest) !== value.release_manifest || value.release_manifest === "/") {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_PATH_INVALID");
  }
  const created = Date.parse(iso(value.authorization_created_at, "UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID"));
  const expires = Date.parse(iso(value.authorization_expires_at, "UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID"));
  if (expires <= created || expires - created > 60 * 60 * 1000) reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID");
  const quiesceIntentPath = `${UAT_PROMOTION_STATE_ROOT}/intents/${value.quiesce_operation_id}.${value.quiesce_intent_sha256}.json`;
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), "UAT_PROMOTION_MIGRATION_AUTHORIZATION_CURRENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.quiesce_intent_source, quiesceIntentPath, new Set(["0400"]), "UAT_PROMOTION_MIGRATION_AUTHORIZATION_QUIESCE_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), "UAT_PROMOTION_MIGRATION_AUTHORIZATION_RUNTIME_SOURCE_INVALID");
  validateSourceSpec(value.release_manifest_source, value.release_manifest, new Set(["0440"]), "UAT_PROMOTION_MIGRATION_AUTHORIZATION_MANIFEST_SOURCE_INVALID", 0);
  if (value.runtime_identity_source.sha256 !== value.runtime_binding_sha256
    || value.release_manifest_source.sha256 !== value.release_manifest_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_SOURCE_BINDING_INVALID");
  }
  return value;
}

export function validateUatPromotionMigrationExecutionParameters(value) {
  exactKeys(value, MIGRATION_EXECUTION_PARAMETER_FIELDS, "UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETERS_INVALID");
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  for (const field of ["promotion_id", "migration_authorization_operation_id"]) {
    identifier(value[field], "UAT_PROMOTION_MIGRATION_EXECUTION_IDENTIFIER_INVALID");
  }
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_GENERATION_INVALID");
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
    "migration_authorization_intent_sha256", "migration_approval_authorization_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256", "release_manifest_sha256",
    "migration_manifest_sha256", "postgres_container_id", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], "UAT_PROMOTION_MIGRATION_EXECUTION_DIGEST_INVALID");
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256 || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) {
    reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  }
  const actors = new Set([value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256]);
  if (actors.size !== 3 || actors.has(ZERO_SHA256)) reject("UAT_PROMOTION_ACTORS_INVALID");
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp"
    || value.database_name !== "chenyida_erp" || !/^[1-9][0-9]{0,9}$/u.test(value.database_oid)
    || !/^[1-9][0-9]{9,29}$/u.test(value.database_system_identifier)
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.migration_role !== "chenyida_erp_owner" || value.control_role !== "postgres") {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_DATABASE_INVALID");
  }
  if (!MIGRATION.test(value.expected_current_migration_head) || !MIGRATION.test(value.target_migration_head)
    || !ROLE.test(value.migration_role) || !ROLE.test(value.control_role) || !IMAGE.test(value.worker_image)
    || !CONTAINER_NAME.test(value.postgres_container) || !CONTAINER_ID.test(value.postgres_container_id)
    || !IMAGE_DIGEST.test(value.postgres_image_digest) || value.backend_network !== "chenyida-erp_backend") {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_TARGET_INVALID");
  }
  if (typeof value.release_manifest !== "string" || !path.isAbsolute(value.release_manifest)
    || path.normalize(value.release_manifest) !== value.release_manifest || value.release_manifest === "/") {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_PATH_INVALID");
  }
  const created = Date.parse(iso(value.execution_created_at, "UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID"));
  const expires = Date.parse(iso(value.execution_expires_at, "UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID"));
  if (expires <= created || expires - created > 15 * 60 * 1000) reject("UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID");
  const approvalIntentPath = `${UAT_PROMOTION_STATE_ROOT}/intents/${value.migration_authorization_operation_id}.${value.migration_authorization_intent_sha256}.json`;
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), "UAT_PROMOTION_MIGRATION_EXECUTION_CURRENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.migration_authorization_intent_source, approvalIntentPath, new Set(["0400"]), "UAT_PROMOTION_MIGRATION_EXECUTION_APPROVAL_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), "UAT_PROMOTION_MIGRATION_EXECUTION_RUNTIME_SOURCE_INVALID");
  validateSourceSpec(value.release_manifest_source, value.release_manifest, new Set(["0440"]), "UAT_PROMOTION_MIGRATION_EXECUTION_MANIFEST_SOURCE_INVALID", 0);
  if (value.runtime_identity_source.sha256 !== value.runtime_binding_sha256
    || value.release_manifest_source.sha256 !== value.release_manifest_sha256) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_SOURCE_BINDING_INVALID");
  }
  return value;
}

export function validateUatPromotionComposeDeploymentParameters(value) {
  exactKeys(value, COMPOSE_DEPLOYMENT_PARAMETER_FIELDS, "UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETERS_INVALID");
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  for (const field of ["promotion_id", "migration_operation_id"]) {
    identifier(value[field], "UAT_PROMOTION_COMPOSE_DEPLOYMENT_IDENTIFIER_INVALID");
  }
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_GENERATION_INVALID");
  integer(value.reader_gid, 1, 2_147_483_647, "UAT_PROMOTION_COMPOSE_DEPLOYMENT_READER_GID_INVALID");
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256",
    "promotion_original_authorization_sha256", "migration_execution_intent_sha256",
    "migration_execution_authorization_sha256", "migration_grant_sha256", "migration_result_sha256",
    "active_migration_fence_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "release_manifest_sha256", "deployment_environment_sha256",
    "old_web_container_id", "old_worker_container_id", "postgres_container_id", "caddy_container_id",
    "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256",
    "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], "UAT_PROMOTION_COMPOSE_DEPLOYMENT_DIGEST_INVALID");
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256
    || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  const actors = new Set([
    value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256,
  ]);
  if (actors.size !== 3 || actors.has(ZERO_SHA256)) reject("UAT_PROMOTION_ACTORS_INVALID");
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp"
    || value.compose_project !== "chenyida-erp" || value.database_name !== "chenyida_erp"
    || !/^[1-9][0-9]{0,9}$/u.test(value.database_oid)
    || !/^[1-9][0-9]{9,29}$/u.test(value.database_system_identifier)
    || value.database_marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.control_role !== "postgres") reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_DATABASE_INVALID");
  const expectedContainers = {
    web_container: "chenyida-erp-web-1", worker_container: "chenyida-erp-worker-1",
    postgres_container: "chenyida-erp-postgres-1", caddy_container: "chenyida-erp-caddy-1",
  };
  if (Object.entries(expectedContainers).some(([field, expected]) => value[field] !== expected)
    || !IMAGE.test(value.web_image) || !IMAGE.test(value.worker_image)
    || !IMAGE_DIGEST.test(value.old_web_image_digest) || !IMAGE_DIGEST.test(value.old_worker_image_digest)
    || !IMAGE_DIGEST.test(value.postgres_image_digest) || !IMAGE_DIGEST.test(value.caddy_image_digest)
    || value.backend_network !== "chenyida-erp_backend" || value.edge_network !== "chenyida-erp_edge") {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_TARGET_INVALID");
  }
  for (const field of ["compose_project_root", "release_manifest", "deployment_environment"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field])
      || path.normalize(value[field]) !== value[field] || value[field] === "/") {
      reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_PATH_INVALID");
    }
  }
  const created = Date.parse(iso(value.deployment_created_at, "UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID"));
  const expires = Date.parse(iso(value.deployment_expires_at, "UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID"));
  if (expires <= created || expires - created > 15 * 60 * 1000) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID");
  }
  const migrationIntentPath = `${UAT_PROMOTION_STATE_ROOT}/intents/${value.migration_operation_id}.${value.migration_execution_intent_sha256}.json`;
  const migrationResultPath = `${UAT_PROMOTION_STATE_ROOT}/results/${value.migration_operation_id}.${value.migration_result_sha256}.json`;
  const activeFencePath = `${ACTIVE_MIGRATION_FENCES_ROOT}/${value.migration_operation_id}.${value.active_migration_fence_sha256}.json`;
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_CURRENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.migration_execution_intent_source, migrationIntentPath, new Set(["0400"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MIGRATION_INTENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.migration_result_source, migrationResultPath, new Set(["0400"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MIGRATION_RESULT_SOURCE_INVALID", 0);
  validateSourceSpec(value.active_migration_fence_source, activeFencePath, new Set(["0400"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_ACTIVE_FENCE_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RUNTIME_SOURCE_INVALID");
  validateSourceSpec(value.release_manifest_source, value.release_manifest, new Set(["0440"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MANIFEST_SOURCE_INVALID", 0);
  validateSourceSpec(value.compose_file_source, path.join(value.compose_project_root, "compose.yml"), new Set(["0444"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMPOSE_SOURCE_INVALID", 0);
  validateSourceSpec(value.compose_release_file_source, path.join(value.compose_project_root, "compose.release.yml"), new Set(["0444"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMPOSE_SOURCE_INVALID", 0);
  validateSourceSpec(value.deployment_environment_source, value.deployment_environment, new Set(["0400"]), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_ENVIRONMENT_SOURCE_INVALID", 0);
  if (value.runtime_identity_source.sha256 !== value.runtime_binding_sha256
    || value.release_manifest_source.sha256 !== value.release_manifest_sha256
    || value.deployment_environment_source.sha256 !== value.deployment_environment_sha256) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_BINDING_INVALID");
  }
  return value;
}

function validatePostdeployCommonParameters(value, expectedFields, code) {
  exactKeys(value, expectedFields, code);
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT) reject("UAT_PROMOTION_STATE_PATH_INVALID");
  for (const field of ["promotion_id", "deployment_operation_id"]) identifier(value[field], code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  integer(value.reader_gid, 1, 2_147_483_647, code);
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256",
    "promotion_original_authorization_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256",
    "compose_deployment_binding_sha256", "deployment_result_sha256", "fence_transfer_sha256",
    "release_manifest_sha256", "runtime_policy_sha256", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], code);
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256
    || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256
    || value.runtime_guard_contract !== POSTDEPLOY_RUNTIME_GUARD_CONTRACT
    || value.runtime_guard_mode !== POSTDEPLOY_RUNTIME_GUARD_MODE
    || value.runtime_policy_sha256 !== POSTDEPLOY_RUNTIME_POLICY_SHA256) reject("UAT_PROMOTION_POSTDEPLOY_POLICY_INVALID");
  if (new Set([
    value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256,
  ]).size !== 3) reject("UAT_PROMOTION_ACTORS_INVALID");
  if (value.deployment_class !== "UAT" || value.deployment_id !== "chenyida-erp"
    || value.compose_project !== "chenyida-erp") reject("UAT_PROMOTION_POSTDEPLOY_DEPLOYMENT_INVALID");
  const expectedContainers = {
    caddy_container: "chenyida-erp-caddy-1", postgres_container: "chenyida-erp-postgres-1",
    web_container: "chenyida-erp-web-1", worker_container: "chenyida-erp-worker-1",
  };
  if (Object.entries(expectedContainers).some(([field, expected]) => value[field] !== expected)) {
    reject("UAT_PROMOTION_POSTDEPLOY_SELECTORS_INVALID");
  }
  for (const field of ["release_manifest", "compose_project_root"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field])
      || path.normalize(value[field]) !== value[field] || value[field] === "/") {
      reject("UAT_PROMOTION_POSTDEPLOY_PATH_INVALID");
    }
  }
  const created = Date.parse(iso(value.verification_created_at, "UAT_PROMOTION_POSTDEPLOY_TIME_INVALID"));
  const expires = Date.parse(iso(value.verification_expires_at, "UAT_PROMOTION_POSTDEPLOY_TIME_INVALID"));
  if (expires <= created || expires - created > 15 * 60 * 1000) reject("UAT_PROMOTION_POSTDEPLOY_TIME_INVALID");
  const deploymentResultPath = `${UAT_PROMOTION_STATE_ROOT}/results/${value.deployment_operation_id}.${value.deployment_result_sha256}.json`;
  const transferPath = `${FENCE_TRANSFERS_ROOT}/${value.deployment_operation_id}.${value.fence_transfer_sha256}.json`;
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), `${code}_CURRENT_SOURCE_INVALID`, 0);
  validateSourceSpec(value.deployment_result_source, deploymentResultPath, new Set(["0400"]), `${code}_DEPLOYMENT_SOURCE_INVALID`, 0);
  validateSourceSpec(value.fence_transfer_source, transferPath, new Set(["0400"]), `${code}_TRANSFER_SOURCE_INVALID`, 0);
  validateSourceSpec(value.release_manifest_source, value.release_manifest, new Set(["0440"]), `${code}_MANIFEST_SOURCE_INVALID`, 0);
  if (value.release_manifest_source.sha256 !== value.release_manifest_sha256
    || new Set([
      value.current_checkpoint_source.path, value.deployment_result_source.path,
      value.fence_transfer_source.path, value.release_manifest_source.path,
    ]).size !== 4) reject("UAT_PROMOTION_POSTDEPLOY_SOURCE_BINDING_INVALID");
  return value;
}

export function validateUatPromotionPostdeployRuntimeParameters(value) {
  validatePostdeployCommonParameters(
    value, POSTDEPLOY_RUNTIME_PARAMETER_FIELDS, "UAT_PROMOTION_POSTDEPLOY_RUNTIME_PARAMETERS_INVALID",
  );
  identifier(value.probe_id, "UAT_PROMOTION_POSTDEPLOY_RUNTIME_IDENTIFIER_INVALID");
  if (value.probe_id.length > 101 || value.probe_root !== RUNTIME_PROBE_ROOT) {
    reject("UAT_PROMOTION_POSTDEPLOY_RUNTIME_PATH_INVALID");
  }
  return value;
}

export function validateUatPromotionPostdeployIdentityParameters(value) {
  validatePostdeployCommonParameters(
    value, POSTDEPLOY_IDENTITY_PARAMETER_FIELDS, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_PARAMETERS_INVALID",
  );
  for (const field of ["runtime_probe_operation_id", "run_id"]) {
    identifier(value[field], "UAT_PROMOTION_POSTDEPLOY_IDENTITY_IDENTIFIER_INVALID");
  }
  for (const field of [
    "runtime_probe_intent_sha256", "runtime_probe_result_sha256", "runtime_probe_receipt_sha256",
    "runtime_configuration_sha256",
  ]) digest(value[field], "UAT_PROMOTION_POSTDEPLOY_IDENTITY_DIGEST_INVALID");
  if (value.run_id.length > 101 || value.postdeploy_root !== `${POSTDEPLOY_ROOT}/${value.run_id}`
    || value.identity_root !== path.dirname(RELEASE_IDENTITY_FILE)
    || value.runtime_probe_receipt !== `${RUNTIME_PROBE_ROOT}/${value.runtime_probe_operation_id}.runtime-configuration-probe.json`
    || value.runtime_probe_receipt_sha256 !== value.runtime_probe_result_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_PATH_INVALID");
  }
  const runtimeIntentPath = `${UAT_PROMOTION_STATE_ROOT}/intents/${value.runtime_probe_operation_id}.${value.runtime_probe_intent_sha256}.json`;
  const runtimeResultPath = `${UAT_PROMOTION_STATE_ROOT}/results/${value.runtime_probe_operation_id}.${value.runtime_probe_result_sha256}.json`;
  validateSourceSpec(value.runtime_probe_intent_source, runtimeIntentPath, new Set(["0400"]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_INTENT_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_probe_result_source, runtimeResultPath, new Set(["0400"]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_RESULT_SOURCE_INVALID", 0);
  validateSourceSpec(value.runtime_probe_receipt_source, value.runtime_probe_receipt, new Set(["0400"]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_RECEIPT_SOURCE_INVALID", 0);
  if (value.runtime_probe_result_source.sha256 !== value.runtime_probe_result_sha256
    || value.runtime_probe_receipt_source.sha256 !== value.runtime_probe_receipt_sha256
    || new Set([
      value.runtime_probe_intent_source.path, value.runtime_probe_result_source.path,
      value.runtime_probe_receipt_source.path, value.current_checkpoint_source.path,
    ]).size !== 4) reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_SOURCE_BINDING_INVALID");
  return value;
}

export function validateUatPromotionCrossRoleParameters(value) {
  const code = "UAT_PROMOTION_CROSS_ROLE_PARAMETERS_INVALID";
  exactKeys(value, CROSS_ROLE_UAT_PARAMETER_FIELDS, code);
  if (value.promotion_state_root !== UAT_PROMOTION_STATE_ROOT
    || value.cross_role_result_root !== UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT) {
    reject("UAT_PROMOTION_STATE_PATH_INVALID");
  }
  for (const field of ["promotion_id", "postdeploy_identity_operation_id", "result_id"]) {
    identifier(value[field], code);
  }
  if (new Set([value.promotion_id, value.postdeploy_identity_operation_id, value.result_id]).size !== 3) reject(code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  for (const field of [
    "previous_checkpoint_receipt_sha256", "promotion_intent_sha256",
    "promotion_original_authorization_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256",
    "compose_deployment_binding_sha256", "postdeploy_identity_intent_sha256",
    "postdeploy_identity_evidence_sha256", "release_identity_sha256",
    "cross_role_contract_file_sha256", "cross_role_contract_artifact_sha256",
    "authorization_matrix_artifact_sha256", "authorization_matrix_source_manifest_sha256",
    "cross_role_result_file_sha256", "cross_role_result_sha256", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
  ]) digest(value[field], code);
  if (value.policy_file_sha256 !== UAT_PROMOTION_POLICY_FILE_SHA256
    || value.policy_sha256 !== UAT_PROMOTION_POLICY_SHA256) reject("UAT_PROMOTION_POLICY_BINDING_INVALID");
  if (new Set([
    value.requester_identity_sha256, value.approver_identity_sha256, value.executor_identity_sha256,
  ]).size !== 3) reject("UAT_PROMOTION_ACTORS_INVALID");
  for (const field of ["cross_role_contract", "cross_role_result"]) {
    if (typeof value[field] !== "string" || !path.isAbsolute(value[field])
      || path.normalize(value[field]) !== value[field] || value[field] === "/") reject(code);
  }
  const contractRelative = path.relative(SUPERVISOR_BUNDLE_ROOT, value.cross_role_contract);
  const contractParts = contractRelative.split(path.sep);
  if (contractParts.length !== 4 || !SHA256.test(contractParts[0])
    || contractParts.slice(1).join("/") !== CROSS_ROLE_UAT_CONTRACT_RELATIVE
    || value.cross_role_result !== `${UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT}/${value.result_id}.cross-role-uat-result.json`) {
    reject(code);
  }
  const created = Date.parse(iso(value.verification_created_at, code));
  const expires = Date.parse(iso(value.verification_expires_at, code));
  if (expires <= created || expires - created > 15 * 60 * 1000) reject(code);
  const identityIntentPath = `${UAT_PROMOTION_STATE_ROOT}/intents/${value.postdeploy_identity_operation_id}.${value.postdeploy_identity_intent_sha256}.json`;
  const identityEvidencePath = `${UAT_PROMOTION_STATE_ROOT}/results/${value.postdeploy_identity_operation_id}.${value.postdeploy_identity_evidence_sha256}.json`;
  validateSourceSpec(value.current_checkpoint_source, UAT_PROMOTION_CURRENT_FILE, new Set(["0400"]), `${code}_CURRENT_SOURCE_INVALID`, 0);
  validateSourceSpec(value.postdeploy_identity_intent_source, identityIntentPath, new Set(["0400"]), `${code}_IDENTITY_INTENT_SOURCE_INVALID`, 0);
  validateSourceSpec(value.postdeploy_identity_evidence_source, identityEvidencePath, new Set(["0400"]), `${code}_IDENTITY_EVIDENCE_SOURCE_INVALID`, 0);
  validateSourceSpec(value.release_identity_source, RELEASE_IDENTITY_FILE, new Set(["0440"]), `${code}_RELEASE_IDENTITY_SOURCE_INVALID`);
  validateSourceSpec(value.cross_role_contract_source, value.cross_role_contract, new Set(["0444"]), `${code}_CONTRACT_SOURCE_INVALID`, 0);
  validateSourceSpec(value.cross_role_result_source, value.cross_role_result, new Set(["0400"]), `${code}_RESULT_SOURCE_INVALID`, 0);
  if (value.release_identity_source.sha256 !== value.release_identity_sha256
    || value.cross_role_contract_source.sha256 !== value.cross_role_contract_file_sha256
    || value.cross_role_result_source.sha256 !== value.cross_role_result_file_sha256
    || new Set([
      value.current_checkpoint_source.path, value.postdeploy_identity_intent_source.path,
      value.postdeploy_identity_evidence_source.path, value.release_identity_source.path,
      value.cross_role_contract_source.path, value.cross_role_result_source.path,
    ]).size !== 6) reject("UAT_PROMOTION_CROSS_ROLE_SOURCE_BINDING_INVALID");
  return value;
}

export function validateUatPromotionContext(value) {
  exactKeys(value, CONTEXT_FIELDS, "UAT_PROMOTION_CONTEXT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_CONTEXT_CONTRACT || !new Set(["BEGIN", "CAPTURE_SNAPSHOT", "QUIESCE_WRITERS", "MIGRATION_AUTHORIZATION", "MIGRATION_EXECUTION", "COMPOSE_DEPLOYMENT", "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY", "CROSS_ROLE_UAT"]).has(value.operation)
    || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject("UAT_PROMOTION_CONTEXT_INVALID");
  identifier(value.operation_id, "UAT_PROMOTION_CONTEXT_ID_INVALID");
  identifier(value.execution_authorization_id, "UAT_PROMOTION_CONTEXT_ID_INVALID");
  iso(value.execution_created_at, "UAT_PROMOTION_CONTEXT_TIME_INVALID");
  for (const field of ["execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256"]) digest(value[field], "UAT_PROMOTION_CONTEXT_DIGEST_INVALID");
  if (value.operation === "BEGIN") validateUatPromotionParameters(value.parameters);
  else if (value.operation === "CAPTURE_SNAPSHOT") validateUatPromotionSnapshotParameters(value.parameters);
  else if (value.operation === "QUIESCE_WRITERS") validateUatPromotionQuiesceParameters(value.parameters);
  else if (value.operation === "MIGRATION_AUTHORIZATION") validateUatPromotionMigrationAuthorizationParameters(value.parameters);
  else if (value.operation === "MIGRATION_EXECUTION") validateUatPromotionMigrationExecutionParameters(value.parameters);
  else if (value.operation === "COMPOSE_DEPLOYMENT") validateUatPromotionComposeDeploymentParameters(value.parameters);
  else if (value.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION") validateUatPromotionPostdeployRuntimeParameters(value.parameters);
  else if (value.operation === "POSTDEPLOY_IDENTITY") validateUatPromotionPostdeployIdentityParameters(value.parameters);
  else validateUatPromotionCrossRoleParameters(value.parameters);
  const operationCreatedAt = value.operation === "BEGIN" ? value.parameters.promotion_created_at
    : value.operation === "CAPTURE_SNAPSHOT" ? value.parameters.snapshot_created_at
      : value.operation === "QUIESCE_WRITERS" ? value.parameters.quiesce_created_at
        : value.operation === "MIGRATION_AUTHORIZATION" ? value.parameters.authorization_created_at
          : value.operation === "MIGRATION_EXECUTION" ? value.parameters.execution_created_at
            : value.operation === "COMPOSE_DEPLOYMENT" ? value.parameters.deployment_created_at
              : value.parameters.verification_created_at;
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_id !== value.operation_id || value.execution_authorization_sha256 !== value.original_authorization_sha256
      || value.expected_intent_sha256 !== null || Math.abs(Date.parse(value.execution_created_at) - Date.parse(operationCreatedAt)) > 5 * 60 * 1000
      || value.operation === "BEGIN" && value.operation_id !== value.parameters.promotion_id
      || value.operation !== "BEGIN" && value.operation_id === value.parameters.promotion_id
      || value.operation === "MIGRATION_AUTHORIZATION" && value.operation_id === value.parameters.quiesce_operation_id
      || value.operation === "MIGRATION_EXECUTION" && (value.operation_id === value.parameters.migration_authorization_operation_id
        || value.execution_authorization_sha256 === value.parameters.migration_approval_authorization_sha256)
      || value.operation === "COMPOSE_DEPLOYMENT" && (value.operation_id === value.parameters.migration_operation_id
        || value.execution_authorization_sha256 === value.parameters.migration_execution_authorization_sha256)
      || value.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION" && (value.operation_id !== value.parameters.probe_id
        || value.operation_id === value.parameters.deployment_operation_id)
      || value.operation === "POSTDEPLOY_IDENTITY" && (value.operation_id !== value.parameters.run_id
        || value.operation_id === value.parameters.deployment_operation_id
        || value.operation_id === value.parameters.runtime_probe_operation_id)
      || value.operation === "CROSS_ROLE_UAT" && (value.operation_id !== value.parameters.result_id
        || value.operation_id === value.parameters.postdeploy_identity_operation_id)) {
      reject("UAT_PROMOTION_CONTEXT_BINDING_INVALID");
    }
  } else {
    if (value.execution_authorization_id === value.operation_id || value.execution_authorization_sha256 === value.original_authorization_sha256
      || Date.parse(value.execution_created_at) < Date.parse(operationCreatedAt)) reject("UAT_PROMOTION_CONTEXT_BINDING_INVALID");
    digest(value.expected_intent_sha256, "UAT_PROMOTION_CONTEXT_DIGEST_INVALID");
  }
  return value;
}

function candidateBinding(parameters) {
  return clusterSha256({
    git_commit: parameters.git_commit, git_tree: parameters.git_tree, application_version: parameters.application_version,
    candidate_snapshot_receipt_sha256: parameters.candidate_snapshot_receipt_sha256,
    release_manifest_sha256: parameters.release_manifest_sha256, web_image: parameters.web_image,
    worker_image: parameters.worker_image, migration_head: parameters.migration_head,
    migration_manifest_sha256: parameters.migration_manifest_sha256,
  });
}

function databaseBinding(parameters) {
  return clusterSha256({
    deployment_class: "UAT", deployment_id: "chenyida-erp", database_name: parameters.database_name,
    database_oid: parameters.database_oid, database_system_identifier: parameters.database_system_identifier,
    database_marker: parameters.database_marker,
  });
}

function recoveryBinding(parameters) {
  return clusterSha256({
    source_file_sha256: parameters.recovery_readiness_source.sha256,
    readiness_sha256: parameters.preupgrade_recovery_readiness_sha256,
    snapshot_sha256: parameters.preupgrade_recovery_snapshot_sha256,
    database_identity_sha256: databaseBinding(parameters),
  });
}

function snapshotObjectsFromReadiness(readiness) {
  const artifacts = readiness?.data_readiness?.receipt?.inner_restore?.receipt?.artifacts;
  const project = (value, entries) => ({
    file: value?.file,
    sha256: value?.sha256,
    bytes: value?.bytes,
    entries,
  });
  const objects = {
    postgresql: project(artifacts?.postgresql_dump, null),
    uploads: project(artifacts?.uploads, artifacts?.uploads?.entries),
    attachments: project(artifacts?.attachments, artifacts?.attachments?.entries),
    backup_status: project(artifacts?.backup_status, artifacts?.backup_status?.entries),
  };
  return validateSnapshotObjects(objects);
}

function writerCaptureFromReadiness(readiness) {
  const restore = readiness?.data_readiness?.receipt?.inner_restore?.receipt;
  const consistency = restore?.consistency;
  const application = restore?.application;
  return validateWriterCapture({
    deployment_class: restore?.deployment?.class,
    deployment_id: restore?.deployment?.id,
    compose_project: restore?.deployment?.id,
    snapshot_recovery_point_at: consistency?.recovery_point_at,
    snapshot_writer_verified_at: consistency?.verified_after,
    application_version: application?.version,
    git_commit: application?.git_commit,
    migration_head: restore?.migration?.head,
    migration_manifest_sha256: restore?.migration?.manifest_sha256,
    web: {
      container_name: consistency?.web_container,
      container_id: consistency?.web_container_id,
      image_digest: application?.web_image_digest,
    },
    worker: {
      container_name: consistency?.worker_container,
      container_id: consistency?.worker_container_id,
      image_digest: application?.worker_image_digest,
    },
  });
}

function promotionSnapshotBinding(parameters, readiness, policy, activation, identity, objects, writerCapture) {
  const restore = readiness.data_readiness.receipt.inner_restore.receipt;
  const finalState = readiness.recovery_execution.states.at(-1);
  return clusterSha256({
    contract: "chenyida-erp-uat-promotion-snapshot-binding/v1",
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    readiness_file_sha256: parameters.snapshot_readiness_file_sha256,
    readiness_sha256: readiness.readiness_sha256,
    backup_id: readiness.backup_id,
    restore_run_id: readiness.restore_run_id,
    recovery_point_at: restore.consistency.recovery_point_at,
    policy_sha256: readinessPolicySha256(policy),
    policy_activation_receipt_sha256: activation.receipt_sha256,
    release_identity_sha256: parameters.runtime_identity_source.sha256,
    release_identity_control: {
      application_version: identity.application_version,
      git_commit: identity.git_commit,
      migration_head: identity.migration_head,
      migration_manifest_sha256: identity.migration_manifest_sha256,
      web_image_digest: identity.web_image_digest,
      worker_image_digest: identity.worker_image_digest,
    },
    objects,
    writer_capture: writerCapture,
    recovery_proof: {
      inner_restore_receipt_sha256: readiness.data_readiness.receipt.inner_restore.receipt_canonical_sha256,
      joint_transfer_receipt_sha256: readiness.joint_transfer.receipt_sha256,
      cluster_security_receipt_sha256: readiness.cluster_security.receipt_sha256,
      credential_binding_receipt_sha256: readiness.credential_binding.receipt_sha256,
      tablespace_receipt_sha256: readiness.tablespace.receipt_sha256,
      recovery_final_state_sha256: finalState.state_sha256,
      policy_activation_receipt_sha256: readiness.policy_activation.receipt_sha256,
    },
  });
}

function validatePromotionSnapshotEvidence(parameters, previous, promotionIntent, identity, policy, activation, readiness) {
  if (previous.promotion_id !== parameters.promotion_id || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_ordinal !== 4 || previous.checkpoint_id !== "PROMOTION_INTENT_AND_DURABLE_JOURNAL"
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== ZERO_SHA256
    || previous.writer_quiesce_binding_sha256 !== ZERO_SHA256) reject("UAT_PROMOTION_SNAPSHOT_CURRENT_MISMATCH");
  if (promotionIntent.promotion_id !== previous.promotion_id || promotionIntent.promotion_generation !== previous.promotion_generation
    || promotionIntent.intent_sha256 !== previous.intent_sha256 || promotionIntent.original_authorization_sha256 !== previous.original_authorization_sha256
    || promotionIntent.candidate_binding_sha256 !== previous.candidate_binding_sha256
    || promotionIntent.database_binding_sha256 !== previous.database_binding_sha256
    || promotionIntent.runtime_binding_sha256 !== previous.runtime_binding_sha256
    || promotionIntent.recovery_binding_sha256 !== previous.recovery_binding_sha256) reject("UAT_PROMOTION_SNAPSHOT_INTENT_MISMATCH");
  if (identity.deployment_class !== "UAT" || identity.deployment_id !== "chenyida-erp"
    || parameters.runtime_identity_source.sha256 !== parameters.runtime_binding_sha256) reject("UAT_PROMOTION_SNAPSHOT_RUNTIME_MISMATCH");
  if (policy?.schema_version !== 2 || policy?.activation?.status !== "ACTIVATED" || policy?.activation?.environment !== "UAT"
    || readinessPolicySha256(policy) !== parameters.snapshot_policy_sha256
    || activation.status !== "COMMITTED" || activation.receipt_sha256 !== parameters.snapshot_policy_activation_receipt_sha256
    || activation.release_identity_sha256 !== parameters.runtime_binding_sha256
    || activation.policy_sha256 !== parameters.snapshot_policy_sha256
    || canonicalClusterJson(readiness.policy_activation.receipt) !== canonicalClusterJson(activation)) reject("UAT_PROMOTION_SNAPSHOT_POLICY_MISMATCH");
  const restore = readiness?.data_readiness?.receipt?.inner_restore?.receipt;
  const transfer = readiness?.data_readiness?.receipt?.transfer;
  if (readiness.schema_version !== 4 || readiness.contract !== "chenyida-erp-backup-verification/v4"
    || readiness.result !== "RECOVERY_READY" || readiness.evidence_scope !== "ACTUAL_OFFHOST"
    || readiness.readiness_sha256 !== parameters.snapshot_readiness_sha256
    || readiness.backup_id !== parameters.snapshot_backup_id || readiness.restore_run_id !== parameters.snapshot_restore_run_id
    || path.basename(parameters.snapshot_readiness) !== `${readiness.backup_id}.${readiness.restore_run_id}.recovery-readiness-v4.json`
    || readiness.recovery_execution?.states?.at(-1)?.phase !== "PUBLISHED"
    || restore?.result !== "RESTORE_VERIFIED" || restore?.evidence?.kind !== "ISOLATED_RESTORE_VERIFICATION"
    || restore?.consistency?.writer_boundary !== "EXACT_COMPOSE_WEB_WORKER_STOPPED"
    || restore?.consistency?.method !== "QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION"
    || restore?.consistency?.database_snapshot !== "PG_DUMP_CONSISTENT_SNAPSHOT") reject("UAT_PROMOTION_SNAPSHOT_READINESS_INVALID");
  const requiredStatus = {
    data_restore: "VERIFIED", data_transfer: "VERIFIED", cluster_transfer: "VERIFIED", cluster_security: "VERIFIED",
    credential_binding: "VERIFIED", tablespace: "VERIFIED", recovery_execution: "PUBLISHED", schedule: "ON_TIME",
    retention: "POLICY_VALID_DRY_RUN", runtime_privilege: "VERIFIED", policy_activation: "VERIFIED",
  };
  if (Object.entries(requiredStatus).some(([field, expected]) => readiness.status?.[field] !== expected)
    || !String(readiness.attestation ?? "").startsWith("ROOT_PUBLISHED_DATA_V3_JOINT_TRANSFER_V2_CLUSTER_SECURITY_CREDENTIAL_TABLESPACE")) {
    reject("UAT_PROMOTION_SNAPSHOT_READINESS_INVALID");
  }
  const source = restore.deployment;
  const expectedDatabase = promotionIntent.parameters;
  if (source.class !== "UAT" || source.id !== "chenyida-erp" || source.database !== expectedDatabase.database_name
    || source.database_oid !== expectedDatabase.database_oid || source.database_system_identifier !== expectedDatabase.database_system_identifier
    || source.database_marker !== expectedDatabase.database_marker
    || restore.application?.version !== identity.application_version || restore.application?.git_commit !== identity.git_commit
    || restore.application?.web_image_digest !== identity.web_image_digest || restore.application?.worker_image_digest !== identity.worker_image_digest
    || restore.migration?.head !== identity.migration_head || restore.migration?.manifest_sha256 !== identity.migration_manifest_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_DATABASE_MISMATCH");
  }
  if (transfer?.source_location_id === transfer?.receiver_location_id
    || transfer?.source_machine_identity_sha256 === transfer?.receiver_machine_identity_sha256
    || source.database_system_identifier === restore.evidence.target?.database_system_identifier) reject("UAT_PROMOTION_SNAPSHOT_OFFHOST_INVALID");
  const created = Date.parse(parameters.snapshot_created_at), expires = Date.parse(parameters.snapshot_expires_at);
  const backupCreated = Date.parse(readiness.created_at), verified = Date.parse(readiness.verified_at);
  if (Number.isNaN(backupCreated) || Number.isNaN(verified) || backupCreated < created || verified < backupCreated
    || verified >= expires || verified >= Date.parse(previous.promotion_expires_at) || Date.parse(readiness.expires_at) < expires
    || Date.parse(activation.expires_at) < expires) reject("UAT_PROMOTION_SNAPSHOT_WINDOW_INVALID");
  const objects = snapshotObjectsFromReadiness(readiness);
  if (!same(objects, parameters.snapshot_objects)) reject("UAT_PROMOTION_SNAPSHOT_OBJECTS_MISMATCH");
  const writerCapture = writerCaptureFromReadiness(readiness);
  if (writerCapture.web.container_id !== identity.web_container_id || writerCapture.worker.container_id !== identity.worker_container_id
    || writerCapture.web.image_digest !== identity.web_image_digest || writerCapture.worker.image_digest !== identity.worker_image_digest
    || writerCapture.application_version !== identity.application_version || writerCapture.git_commit !== identity.git_commit
    || writerCapture.migration_head !== identity.migration_head
    || writerCapture.migration_manifest_sha256 !== identity.migration_manifest_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_WRITER_CAPTURE_MISMATCH");
  }
  const binding = promotionSnapshotBinding(parameters, readiness, policy, activation, identity, objects, writerCapture);
  digest(binding, "UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID");
  return Object.freeze({ objects, writerCapture, binding, recordedAt: readiness.verified_at });
}

function validateCandidateReceipt(value, parameters) {
  if (value?.schema_version !== 1 || value?.state !== "PREPARED" || value?.candidate?.commit !== parameters.git_commit
    || value?.candidate?.tree !== parameters.git_tree || value?.source_repository?.root !== parameters.repository_root
    || value?.test_runtime?.root !== parameters.test_runtime_root) reject("UAT_PROMOTION_CANDIDATE_SOURCE_INVALID");
  return value;
}

function validateRecoveryReadiness(value, parameters) {
  if (value?.schema_version !== 4 || value?.contract !== "chenyida-erp-backup-verification/v4"
    || value?.result !== "RECOVERY_READY" || value?.evidence_scope !== "ACTUAL_OFFHOST"
    || value?.readiness_sha256 !== parameters.preupgrade_recovery_readiness_sha256
    || clusterSha256(bodyWithout(value, "readiness_sha256")) !== value.readiness_sha256
    || value?.cluster_security?.snapshot_sha256 !== parameters.preupgrade_recovery_snapshot_sha256
    || Date.parse(value?.verified_at) > Date.parse(parameters.promotion_created_at) + 5 * 60 * 1000
    || Date.parse(value?.expires_at) < Date.parse(parameters.promotion_expires_at)
    || !String(value?.attestation ?? "").startsWith("ROOT_PUBLISHED_DATA_V3_JOINT_TRANSFER_V2_CLUSTER_SECURITY_CREDENTIAL_TABLESPACE")
    || value?.cluster_security?.status !== "VERIFIED"
    || value?.recovery_execution?.states?.at?.(-1)?.phase !== "PUBLISHED") reject("UAT_PROMOTION_RECOVERY_SOURCE_INVALID");
  const requiredStatus = {
    data_restore: "VERIFIED", data_transfer: "VERIFIED", cluster_transfer: "VERIFIED", cluster_security: "VERIFIED",
    credential_binding: "VERIFIED", tablespace: "VERIFIED", recovery_execution: "PUBLISHED", schedule: "ON_TIME",
    retention: "POLICY_VALID_DRY_RUN",
  };
  if (Object.entries(requiredStatus).some(([key, expected]) => value?.status?.[key] !== expected)) reject("UAT_PROMOTION_RECOVERY_SOURCE_INVALID");
  const dataReadiness = value?.data_readiness?.receipt;
  if (dataReadiness?.result !== "RECOVERY_READY" || dataReadiness?.evidence_scope !== "ACTUAL_OFFHOST") reject("UAT_PROMOTION_RECOVERY_SOURCE_INVALID");
  const source = value?.data_readiness?.receipt?.inner_restore?.receipt?.deployment;
  if (source?.class !== "UAT" || source?.id !== "chenyida-erp" || source?.database !== parameters.database_name
    || source?.database_oid !== parameters.database_oid || source?.database_system_identifier !== parameters.database_system_identifier
    || source?.database_marker !== parameters.database_marker) reject("UAT_PROMOTION_RECOVERY_DATABASE_MISMATCH");
  return value;
}

function physicalPath(logical, filesystemRoot) {
  if (filesystemRoot === "/") return logical;
  if (!path.isAbsolute(filesystemRoot) || !path.isAbsolute(logical) || logical === "/") reject("UAT_PROMOTION_FILESYSTEM_ROOT_INVALID");
  return path.join(filesystemRoot, logical.slice(1));
}

async function syncDirectory(directory, code) {
  let handle;
  try { handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); await handle.sync(); }
  catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
}

async function trustedDirectory(directory, modes, code, expectedGid = 0) {
  let metadata;
  try { metadata = await lstat(directory); }
  catch { reject(code); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== expectedGid
    || !modes.has(metadata.mode & 0o7777) || await realpath(directory) !== directory) reject(code);
  return metadata;
}

async function trustedAncestors(logical, filesystemRoot, code) {
  const root = path.resolve(filesystemRoot);
  const rootMetadata = await lstat(root).catch(() => reject(code));
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || rootMetadata.uid !== 0 || rootMetadata.gid !== 0
    || rootMetadata.mode & 0o022 || await realpath(root) !== root) reject(code);
  const target = physicalPath(logical, root);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) reject(code);
  let current = root;
  const pieces = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < pieces.length; index += 1) {
    current = path.join(current, pieces[index]);
    const metadata = await lstat(current).catch(() => reject(code));
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
      || metadata.mode & 0o022 || await realpath(current) !== current) reject(code);
  }
  return target;
}

async function trustedMarker(file, raw, mode, gid, code) {
  const metadata = await lstat(file, { bigint: true }).catch(() => reject(code));
  const allowedModes = mode instanceof Set ? mode : new Set([mode]);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== BigInt(gid)
    || metadata.nlink !== 1n || !allowedModes.has(modeOf(metadata)) || metadata.size !== BigInt(raw.length)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const value = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    const identity = (entry) => [entry.dev, entry.ino, entry.size, entry.mtimeNs, entry.ctimeNs];
    if (!value.equals(raw) || identity(opened).some((entry, index) => entry !== identity(metadata)[index])
      || identity(after).some((entry, index) => entry !== identity(opened)[index])
      || identity(named).some((entry, index) => entry !== identity(opened)[index])
      || named.nlink !== 1n || named.uid !== 0n || named.gid !== BigInt(gid) || !allowedModes.has(modeOf(named))) reject(code);
  } finally { await handle.close(); }
}

async function trustedJsonFile(
  file, mode, validator, code, expectedGid = 0, requireCanonical = true,
  canonicalizer = canonicalClusterJson,
) {
  const metadata = await lstat(file, { bigint: true }).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata === null) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== BigInt(expectedGid)
    || metadata.nlink !== 1n || modeOf(metadata) !== mode || metadata.size < 2n || metadata.size > BigInt(MAX_JSON_BYTES)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = (entry) => [entry.dev, entry.ino, entry.size, entry.mtimeNs, entry.ctimeNs];
    if (identity(opened).some((entry, index) => entry !== identity(metadata)[index]) || opened.nlink !== 1n
      || opened.uid !== 0n || opened.gid !== BigInt(expectedGid) || modeOf(opened) !== mode) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (identity(after).some((entry, index) => entry !== identity(opened)[index])
      || identity(named).some((entry, index) => entry !== identity(opened)[index])
      || named.nlink !== 1n || named.uid !== 0n || named.gid !== BigInt(expectedGid) || modeOf(named) !== mode) reject(`${code}_CHANGED`);
    let parsed, value;
    try { parsed = parseStrictJson(raw.toString("utf8"), MAX_JSON_BYTES); value = validator(parsed); }
    catch { reject(code); }
    if (requireCanonical && raw.toString("utf8") !== canonicalizer(value)) reject(code);
    return Object.freeze({ raw, value, metadata: opened });
  } finally { await handle.close(); }
}

async function readAuthorizedSource(spec, filesystemRoot, validator, code) {
  await trustedAncestors(path.dirname(spec.path), filesystemRoot, code);
  const file = physicalPath(spec.path, filesystemRoot);
  const stored = await trustedJsonFile(file, Number.parseInt(spec.mode, 8), validator, code, spec.gid, false);
  if (!stored || stored.raw.length !== spec.bytes || sha256(stored.raw) !== spec.sha256
    || String(stored.metadata.dev) !== spec.device || String(stored.metadata.ino) !== spec.inode) reject(code);
  return stored;
}

async function readAuthorizedRawSource(spec, filesystemRoot, code) {
  await trustedAncestors(path.dirname(spec.path), filesystemRoot, code);
  const file = physicalPath(spec.path, filesystemRoot);
  const metadata = await lstat(file, { bigint: true }).catch(() => reject(code));
  const expectedMode = Number.parseInt(spec.mode, 8);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n
    || metadata.gid !== BigInt(spec.gid) || metadata.nlink !== 1n || modeOf(metadata) !== expectedMode
    || metadata.size !== BigInt(spec.bytes) || metadata.size < 2n || metadata.size > BigInt(MAX_JSON_BYTES)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = (entry) => [entry.dev, entry.ino, entry.size, entry.mtimeNs, entry.ctimeNs];
    if (identity(opened).some((entry, index) => entry !== identity(metadata)[index])
      || opened.uid !== 0n || opened.gid !== BigInt(spec.gid) || opened.nlink !== 1n
      || modeOf(opened) !== expectedMode) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (identity(after).some((entry, index) => entry !== identity(opened)[index])
      || identity(named).some((entry, index) => entry !== identity(opened)[index])
      || named.uid !== 0n || named.gid !== BigInt(spec.gid) || named.nlink !== 1n
      || modeOf(named) !== expectedMode || sha256(raw) !== spec.sha256
      || String(opened.dev) !== spec.device || String(opened.ino) !== spec.inode) reject(code);
    return Object.freeze({ raw, metadata: opened });
  } finally { await handle.close(); }
}

async function verifyAuthorizedSources(context, filesystemRoot) {
  const parameters = context.parameters;
  const candidate = await readAuthorizedSource(
    parameters.candidate_snapshot_source, filesystemRoot,
    (value) => validateCandidateReceipt(value, parameters), "UAT_PROMOTION_CANDIDATE_SOURCE_INVALID",
  );
  if (sha256(candidate.raw) !== parameters.candidate_snapshot_receipt_sha256) reject("UAT_PROMOTION_CANDIDATE_SOURCE_INVALID");

  const releaseRoot = physicalPath(path.dirname(parameters.release_manifest), filesystemRoot);
  await trustedMarker(path.join(releaseRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE), 0o440, 0, "UAT_PROMOTION_MANIFEST_ROOT_INVALID");
  const manifest = await readAuthorizedSource(
    parameters.release_manifest_source, filesystemRoot,
    (value) => validateReleaseManifest(value, { now: new Date(parameters.promotion_created_at), requireEligible: true }),
    "UAT_PROMOTION_MANIFEST_SOURCE_INVALID",
  );
  const release = manifest.value;
  if (release.allowed_deployment_classes.length !== 1 || release.allowed_deployment_classes[0] !== "UAT"
    || release.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || release.source.git_commit !== parameters.git_commit || release.source.git_tree !== parameters.git_tree
    || release.source.package_version !== parameters.application_version
    || release.images.web.image_reference !== parameters.web_image || release.images.worker.image_reference !== parameters.worker_image
    || release.migrations.head !== parameters.migration_head || release.migrations.allowlist_sha256 !== parameters.migration_manifest_sha256) reject("UAT_PROMOTION_MANIFEST_BINDING_INVALID");

  const identityRoot = physicalPath(path.dirname(RELEASE_IDENTITY_FILE), filesystemRoot);
  await trustedMarker(
    path.join(identityRoot, RELEASE_IDENTITY_ROOT_MARKER), Buffer.from(RELEASE_IDENTITY_ROOT_MARKER_VALUE),
    0o440, parameters.current_runtime_identity_source.gid, "UAT_PROMOTION_RUNTIME_ROOT_INVALID",
  );
  const identity = await readAuthorizedSource(
    parameters.current_runtime_identity_source, filesystemRoot, validateReleaseIdentity, "UAT_PROMOTION_RUNTIME_SOURCE_INVALID",
  );
  if (identity.value.deployment_class !== "UAT" || identity.value.deployment_id !== "chenyida-erp"
    || Date.parse(identity.value.generated_at) > Date.parse(parameters.promotion_created_at) + 5 * 60 * 1000) reject("UAT_PROMOTION_RUNTIME_BINDING_INVALID");

  const readinessRoot = physicalPath(path.dirname(BACKUP_STATUS_FILE), filesystemRoot);
  await trustedMarker(
    path.join(readinessRoot, BACKUP_STATUS_MARKER), Buffer.from(BACKUP_STATUS_MARKER_VALUE),
    new Set([0o400, 0o440]), parameters.recovery_readiness_source.gid,
    "UAT_PROMOTION_RECOVERY_ROOT_INVALID",
  );
  await readAuthorizedSource(
    parameters.recovery_readiness_source, filesystemRoot,
    (value) => validateRecoveryReadiness(value, parameters), "UAT_PROMOTION_RECOVERY_SOURCE_INVALID",
  );

  if (parameters.promotion_generation > 1) {
    const current = await readAuthorizedSource(
      parameters.current_promotion_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_CURRENT_SOURCE_INVALID",
    );
    if (current.value.receipt_sha256 !== parameters.previous_promotion_receipt_sha256
      || current.value.promotion_generation !== parameters.promotion_generation - 1
      || !new Set(["COMMITTED", "ROLLED_BACK"]).has(current.value.journal_status)) reject("UAT_PROMOTION_CURRENT_SOURCE_INVALID");
  }
}

async function readAuthorizedRootSource(spec, logicalRoot, directoryModes, markerName, markerValue, markerModes, validator, filesystemRoot, code) {
  await trustedAncestors(path.dirname(logicalRoot), filesystemRoot, code);
  const root = physicalPath(logicalRoot, filesystemRoot);
  await trustedDirectory(root, directoryModes, code, spec.gid);
  await trustedMarker(path.join(root, markerName), Buffer.from(markerValue), markerModes, spec.gid, code);
  const file = physicalPath(spec.path, filesystemRoot);
  const stored = await trustedJsonFile(file, Number.parseInt(spec.mode, 8), validator, code, spec.gid, false);
  if (!stored || stored.raw.length !== spec.bytes || sha256(stored.raw) !== spec.sha256
    || String(stored.metadata.dev) !== spec.device || String(stored.metadata.ino) !== spec.inode) reject(code);
  return stored;
}

async function verifySnapshotAuthorizedSources(context, filesystemRoot, options) {
  const parameters = context.parameters;
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_SNAPSHOT_CURRENT_SOURCE_INVALID",
  );
  const promotionIntentPath = path.join(
    physicalPath(`${UAT_PROMOTION_STATE_ROOT}/intents`, filesystemRoot),
    `${parameters.promotion_id}.${parameters.promotion_intent_sha256}.json`,
  );
  const promotionIntent = await trustedJsonFile(
    promotionIntentPath, 0o400, validateUatPromotionIntent, "UAT_PROMOTION_SNAPSHOT_PROMOTION_INTENT_INVALID",
  );
  if (!promotionIntent || promotionIntent.value.intent_sha256 !== parameters.promotion_intent_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_PROMOTION_INTENT_INVALID");
  }
  const identity = await readAuthorizedRootSource(
    parameters.runtime_identity_source, path.dirname(RELEASE_IDENTITY_FILE), new Set([0o750]),
    RELEASE_IDENTITY_ROOT_MARKER, RELEASE_IDENTITY_ROOT_MARKER_VALUE, 0o440, validateReleaseIdentity,
    filesystemRoot, "UAT_PROMOTION_SNAPSHOT_RUNTIME_SOURCE_INVALID",
  );
  const policyValidator = options.snapshotPolicyValidator ?? validateClusterRecoveryPolicyForReadiness;
  const policy = await readAuthorizedRootSource(
    parameters.snapshot_policy_source, path.dirname(CLUSTER_POLICY_TARGET_FILE), new Set([0o755]),
    CLUSTER_POLICY_TARGET_MARKER, CLUSTER_POLICY_TARGET_MARKER_VALUE, 0o400, policyValidator,
    filesystemRoot, "UAT_PROMOTION_SNAPSHOT_POLICY_SOURCE_INVALID",
  );
  const activationValidator = options.snapshotActivationValidator
    ? (value) => options.snapshotActivationValidator(value, policy.value)
    : (value) => validateClusterRecoveryPolicyActivationReceipt(value, policy.value);
  const activation = await readAuthorizedRootSource(
    parameters.snapshot_policy_activation_source, CLUSTER_POLICY_ACTIVATION_STATE_ROOT, new Set([0o700]),
    CLUSTER_POLICY_STATE_MARKER, CLUSTER_POLICY_STATE_MARKER_VALUE, 0o400, activationValidator,
    filesystemRoot, "UAT_PROMOTION_SNAPSHOT_POLICY_ACTIVATION_SOURCE_INVALID",
  );
  const readinessValidator = options.snapshotReadinessValidator
    ? (value) => options.snapshotReadinessValidator(value, policy.value)
    : (value) => validateBackupRecoveryReadinessV4(value, policy.value);
  const readiness = await readAuthorizedRootSource(
    parameters.snapshot_readiness_source, BACKUP_STATUS_ROOT, new Set([0o750, 0o2750]),
    BACKUP_STATUS_MARKER, BACKUP_STATUS_MARKER_VALUE, new Set([0o400, 0o440]), readinessValidator,
    filesystemRoot, "UAT_PROMOTION_SNAPSHOT_READINESS_SOURCE_INVALID",
  );
  return Object.freeze({
    previous: current.value,
    promotionIntent: promotionIntent.value,
    identity: identity.value,
    policy: policy.value,
    activation: activation.value,
    readiness: readiness.value,
    evidence: validatePromotionSnapshotEvidence(
      parameters, current.value, promotionIntent.value, identity.value, policy.value, activation.value, readiness.value,
    ),
  });
}

function dockerBinaryIdentity() {
  let metadata;
  try { metadata = lstatSync(DOCKER_BINARY, { bigint: true }); }
  catch { reject("UAT_PROMOTION_QUIESCE_DOCKER_BINARY_INVALID"); }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== 0n
    || metadata.nlink !== 1n || modeOf(metadata) & 0o022 || metadata.size < 1n) {
    reject("UAT_PROMOTION_QUIESCE_DOCKER_BINARY_INVALID");
  }
  return Object.freeze({
    path: DOCKER_BINARY, device: String(metadata.dev), inode: String(metadata.ino), bytes: String(metadata.size),
    mode: modeOf(metadata).toString(8).padStart(4, "0"),
  });
}

function runDockerMetadata(args, code) {
  const before = dockerBinaryIdentity();
  const result = spawnSync(DOCKER_BINARY, args, {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent" },
    timeout: 30_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
  });
  const after = dockerBinaryIdentity();
  if (!same(before, after) || result.error || result.signal !== null || result.status !== 0 || result.stderr !== ""
    || typeof result.stdout !== "string" || result.stdout.includes("\0") || Buffer.byteLength(result.stdout) > 512 * 1024) reject(code);
  return Object.freeze({ stdout: result.stdout.trimEnd(), binary: before });
}

function jsonCells(line, expected, code) {
  const cells = line.split("\t");
  if (cells.length !== expected) reject(code);
  try { return cells.map((cell) => JSON.parse(cell)); }
  catch { reject(code); }
}

function dockerInfoSnapshot() {
  const template = '{{json .ID}}\t{{json .ServerVersion}}\t{{json .Driver}}';
  const result = runDockerMetadata(["info", "--format", template], "UAT_PROMOTION_QUIESCE_DOCKER_INFO_INVALID");
  const [daemonId, serverVersion, storageDriver] = jsonCells(result.stdout, 3, "UAT_PROMOTION_QUIESCE_DOCKER_INFO_INVALID");
  if (![daemonId, serverVersion, storageDriver].every((value) => typeof value === "string" && value.length >= 1 && value.length <= 160)) {
    reject("UAT_PROMOTION_QUIESCE_DOCKER_INFO_INVALID");
  }
  return Object.freeze({
    daemon_id_sha256: sha256(Buffer.from(daemonId)), server_version: serverVersion, storage_driver: storageDriver,
    client_identity_sha256: clusterSha256(result.binary),
  });
}

function dockerIdsSnapshot() {
  const raw = runDockerMetadata(["container", "ls", "--all", "--no-trunc", "--quiet"], "UAT_PROMOTION_QUIESCE_DOCKER_INVENTORY_INVALID").stdout;
  const ids = raw === "" ? [] : raw.split("\n");
  if (ids.length > 256 || ids.some((item) => !CONTAINER_ID.test(item)) || new Set(ids).size !== ids.length) {
    reject("UAT_PROMOTION_QUIESCE_DOCKER_INVENTORY_INVALID");
  }
  return ids.sort();
}

function dockerContainerRecords(ids) {
  if (ids.length === 0) reject("UAT_PROMOTION_QUIESCE_DOCKER_INVENTORY_INVALID");
  const template = [
    "{{json .Id}}", "{{json .Name}}", "{{json .Image}}", "{{json .Created}}", "{{json .State.Running}}",
    "{{json .State.Restarting}}", "{{json .State.Paused}}", "{{json .State.Dead}}", "{{json .State.OOMKilled}}",
    "{{json .State.Status}}", "{{json .State.ExitCode}}", "{{json .RestartCount}}", "{{json .State.StartedAt}}",
    "{{json .State.FinishedAt}}", '{{json (index .Config.Labels "com.docker.compose.project")}}',
    '{{json (index .Config.Labels "com.docker.compose.service")}}',
    '{{json (index .Config.Labels "com.docker.compose.project.working_dir")}}',
    '{{json (index .Config.Labels "com.docker.compose.config-hash")}}',
    '{{json (index .Config.Labels "com.docker.compose.container-number")}}',
    '{{json (index .Config.Labels "com.docker.compose.oneoff")}}',
    '{{json (index .Config.Labels "org.opencontainers.image.version")}}',
    '{{json (index .Config.Labels "org.opencontainers.image.revision")}}',
  ].join("\t");
  const raw = runDockerMetadata(["container", "inspect", "--format", template, ...ids], "UAT_PROMOTION_QUIESCE_DOCKER_INSPECT_INVALID").stdout;
  const lines = raw === "" ? [] : raw.split("\n");
  if (lines.length !== ids.length) reject("UAT_PROMOTION_QUIESCE_DOCKER_INSPECT_INVALID");
  return lines.map((line) => {
    const [id, rawName, imageDigest, createdAt, running, restarting, paused, dead, oomKilled, status, exitCode,
      restartCount, startedAt, finishedAt, project, service, workingDirectory, configHash, containerNumber, oneoff,
      applicationVersion, gitCommit] = jsonCells(line, 22, "UAT_PROMOTION_QUIESCE_DOCKER_INSPECT_INVALID");
    const name = typeof rawName === "string" && rawName.startsWith("/") ? rawName.slice(1) : rawName;
    if (!CONTAINER_ID.test(id) || !CONTAINER_NAME.test(name) || !IMAGE_DIGEST.test(imageDigest)
      || ![running, restarting, paused, dead, oomKilled].every((value) => typeof value === "boolean")
      || !Number.isSafeInteger(exitCode) || !Number.isSafeInteger(restartCount) || restartCount < 0
      || typeof status !== "string" || status.length < 1 || status.length > 32
      || ![createdAt, startedAt, finishedAt].every((value) => typeof value === "string" && value.length >= 20 && value.length <= 40)) {
      reject("UAT_PROMOTION_QUIESCE_DOCKER_INSPECT_INVALID");
    }
    return Object.freeze({
      id, name, image_digest: imageDigest, created_at: createdAt, running, restarting, paused, dead,
      oom_killed: oomKilled, status, exit_code: exitCode, restart_count: restartCount, last_started_at: startedAt,
      last_finished_at: finishedAt, project, service, working_directory: workingDirectory, config_hash: configHash,
      container_number: containerNumber, oneoff, application_version: applicationVersion, git_commit: gitCommit,
    });
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function stableDockerInventory() {
  const infoBefore = dockerInfoSnapshot();
  const idsBefore = dockerIdsSnapshot();
  const recordsBefore = dockerContainerRecords(idsBefore);
  const idsAfter = dockerIdsSnapshot();
  const recordsAfter = dockerContainerRecords(idsAfter);
  const idsFinal = dockerIdsSnapshot();
  const infoAfter = dockerInfoSnapshot();
  if (!same(infoBefore, infoAfter) || !same(idsBefore, idsAfter) || !same(idsAfter, idsFinal)
    || !same(recordsBefore, recordsAfter)) reject("UAT_PROMOTION_QUIESCE_DOCKER_CHANGED");
  return Object.freeze({ info: infoBefore, records: recordsBefore });
}

function writerStateFromRecord(record, service, parameters, capture) {
  const expectedName = parameters[`${service}_container`];
  const expectedId = parameters[`${service}_container_id`];
  const expectedCapture = capture[service];
  if (record.id !== expectedId || record.name !== expectedName || expectedCapture.container_id !== expectedId
    || expectedCapture.container_name !== expectedName || record.service !== service
    || record.project !== parameters.compose_project || record.working_directory !== parameters.compose_project_root
    || record.image_digest !== expectedCapture.image_digest || record.application_version !== capture.application_version
    || record.git_commit !== capture.git_commit || !COMPOSE_CONFIG_HASH.test(record.config_hash)
    || record.container_number !== "1" || record.oneoff !== "False") reject("UAT_PROMOTION_QUIESCE_WRITER_IDENTITY_INVALID");
  if (record.running !== false || record.restarting !== false || record.paused !== false || record.dead !== false
    || record.oom_killed !== false || record.status !== "exited" || record.exit_code !== 0 || record.restart_count !== 0) {
    reject("UAT_PROMOTION_QUIESCE_WRITER_RUNNING");
  }
  const created = backupInstant(record.created_at, "UAT_PROMOTION_QUIESCE_WRITER_TIME_INVALID");
  const started = backupInstant(record.last_started_at, "UAT_PROMOTION_QUIESCE_WRITER_TIME_INVALID");
  const finished = backupInstant(record.last_finished_at, "UAT_PROMOTION_QUIESCE_WRITER_TIME_INVALID");
  const snapshotVerified = backupInstant(capture.snapshot_writer_verified_at, "UAT_PROMOTION_QUIESCE_WRITER_TIME_INVALID");
  if (created > started || started > finished || finished > snapshotVerified) reject("UAT_PROMOTION_QUIESCE_WRITER_RESTARTED");
  return Object.freeze({
    container_name: record.name, container_id: record.id, service, image_digest: record.image_digest,
    compose_project: record.project, compose_project_root: record.working_directory, compose_config_hash: record.config_hash,
    created_at: record.created_at, last_started_at: record.last_started_at, last_finished_at: record.last_finished_at,
    restart_count: record.restart_count, exit_code: record.exit_code, status: record.status, running: record.running,
    restarting: record.restarting, paused: record.paused, dead: record.dead, oom_killed: record.oom_killed,
    oneoff: false, container_number: 1, application_version: record.application_version, git_commit: record.git_commit,
  });
}

export function validateWriterQuiesceEvidence(value, expected) {
  exactKeys(value, [
    "contract", "status", "checked_at", "snapshot_writer_verified_at", "docker_client_identity_sha256",
    "docker_daemon_id_sha256", "docker_server_version", "docker_storage_driver", "compose_project",
    "compose_project_root", "project_container_count", "project_inventory_sha256", "allowed_running_services",
    "writer_scope", "web", "worker",
  ], "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  if (value.contract !== "chenyida-erp-uat-writer-quiesce-evidence/v1" || value.status !== "CONTINUED_QUIESCE_VERIFIED"
    || value.checked_at !== expected.checkedAt || value.snapshot_writer_verified_at !== expected.capture.snapshot_writer_verified_at
    || value.compose_project !== expected.parameters.compose_project || value.compose_project_root !== expected.parameters.compose_project_root
    || value.project_container_count !== 4 || !same(value.allowed_running_services, ["caddy", "postgres"])
    || value.writer_scope !== "EXACT_COMPOSE_PROJECT_AND_WORKING_DIRECTORY_ONLY_EXTERNAL_CLIENTS_DEFERRED_TO_MIGRATION_FENCE") {
    reject("UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  }
  iso(value.checked_at, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  backupInstant(value.snapshot_writer_verified_at, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  for (const field of ["docker_client_identity_sha256", "docker_daemon_id_sha256", "project_inventory_sha256"]) {
    digest(value[field], "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  }
  if (![value.docker_server_version, value.docker_storage_driver].every((item) => typeof item === "string" && item.length >= 1 && item.length <= 160)) {
    reject("UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  }
  for (const [service, writer] of [["web", value.web], ["worker", value.worker]]) {
    exactKeys(writer, QUIESCED_WRITER_FIELDS, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
    if (writer.service !== service || writer.container_name !== expected.parameters[`${service}_container`]
      || writer.container_id !== expected.parameters[`${service}_container_id`] || writer.compose_project !== value.compose_project
      || writer.compose_project_root !== value.compose_project_root || writer.running !== false || writer.restarting !== false
      || writer.paused !== false || writer.dead !== false || writer.oom_killed !== false || writer.oneoff !== false
      || writer.container_number !== 1 || writer.restart_count !== 0 || writer.exit_code !== 0 || writer.status !== "exited"
      || writer.image_digest !== expected.capture[service].image_digest || writer.application_version !== expected.capture.application_version
      || writer.git_commit !== expected.capture.git_commit || !COMPOSE_CONFIG_HASH.test(writer.compose_config_hash)) {
      reject("UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
    }
    const created = backupInstant(writer.created_at, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
    const started = backupInstant(writer.last_started_at, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
    const finished = backupInstant(writer.last_finished_at, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
    const snapshotVerified = backupInstant(value.snapshot_writer_verified_at, "UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
    if (created > started || started > finished || finished > snapshotVerified) reject("UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  }
  if (value.web.container_id === value.worker.container_id || value.web.container_name === value.worker.container_name) {
    reject("UAT_PROMOTION_QUIESCE_EVIDENCE_INVALID");
  }
  return value;
}

export function probeDockerWriterQuiesce(expected) {
  const inventory = stableDockerInventory();
  const parameters = expected.parameters;
  const relevantByRoot = inventory.records.filter((entry) => entry.working_directory === parameters.compose_project_root);
  const project = inventory.records.filter((entry) => entry.project === parameters.compose_project);
  if (project.length !== 4 || relevantByRoot.length !== 4 || !same(project.map((entry) => entry.id), relevantByRoot.map((entry) => entry.id))
    || !same(project.map((entry) => entry.service).sort(), ["caddy", "postgres", "web", "worker"])
    || project.some((entry) => entry.working_directory !== parameters.compose_project_root || !COMPOSE_CONFIG_HASH.test(entry.config_hash)
      || entry.container_number !== "1" || entry.oneoff !== "False")) {
    reject("UAT_PROMOTION_QUIESCE_REPLACEMENT_WRITER_PRESENT");
  }
  const webRecord = project.find((entry) => entry.service === "web");
  const workerRecord = project.find((entry) => entry.service === "worker");
  if (!webRecord || !workerRecord) reject("UAT_PROMOTION_QUIESCE_REPLACEMENT_WRITER_PRESENT");
  const projectedInventory = project.map((entry) => ({
    id: entry.id, name: entry.name, service: entry.service, image_digest: entry.image_digest, project: entry.project,
    working_directory: entry.working_directory, config_hash: entry.config_hash, container_number: entry.container_number,
    oneoff: entry.oneoff, running: entry.running, restarting: entry.restarting, paused: entry.paused, dead: entry.dead,
    oom_killed: entry.oom_killed, status: entry.status, restart_count: entry.restart_count,
  })).sort((left, right) => left.service.localeCompare(right.service));
  const body = {
    contract: "chenyida-erp-uat-writer-quiesce-evidence/v1",
    status: "CONTINUED_QUIESCE_VERIFIED",
    checked_at: expected.checkedAt,
    snapshot_writer_verified_at: expected.capture.snapshot_writer_verified_at,
    docker_client_identity_sha256: inventory.info.client_identity_sha256,
    docker_daemon_id_sha256: inventory.info.daemon_id_sha256,
    docker_server_version: inventory.info.server_version,
    docker_storage_driver: inventory.info.storage_driver,
    compose_project: parameters.compose_project,
    compose_project_root: parameters.compose_project_root,
    project_container_count: project.length,
    project_inventory_sha256: clusterSha256(projectedInventory),
    allowed_running_services: ["caddy", "postgres"],
    writer_scope: "EXACT_COMPOSE_PROJECT_AND_WORKING_DIRECTORY_ONLY_EXTERNAL_CLIENTS_DEFERRED_TO_MIGRATION_FENCE",
    web: writerStateFromRecord(webRecord, "web", parameters, expected.capture),
    worker: writerStateFromRecord(workerRecord, "worker", parameters, expected.capture),
  };
  return Object.freeze(validateWriterQuiesceEvidence(body, expected));
}

function writerQuiesceBinding(parameters, snapshotIntent, promotionIntent, identity, evidence) {
  return clusterSha256({
    contract: "chenyida-erp-uat-writer-quiesce-binding/v1",
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    snapshot_operation_id: parameters.snapshot_operation_id,
    snapshot_intent_sha256: parameters.snapshot_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    snapshot_writer_capture: snapshotIntent.writer_capture,
    promotion_database_identity: {
      database_name: promotionIntent.parameters.database_name,
      database_oid: promotionIntent.parameters.database_oid,
      database_system_identifier: promotionIntent.parameters.database_system_identifier,
      database_marker: promotionIntent.parameters.database_marker,
    },
    runtime_identity_control: {
      application_version: identity.application_version, git_commit: identity.git_commit,
      migration_head: identity.migration_head, migration_manifest_sha256: identity.migration_manifest_sha256,
      web_container_id: identity.web_container_id, web_image_digest: identity.web_image_digest,
      worker_container_id: identity.worker_container_id, worker_image_digest: identity.worker_image_digest,
    },
    evidence,
  });
}

async function verifyQuiesceAuthorizedSources(context, filesystemRoot, options) {
  const parameters = context.parameters;
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_QUIESCE_CURRENT_SOURCE_INVALID",
  );
  const snapshotIntent = await readAuthorizedSource(
    parameters.snapshot_intent_source, filesystemRoot, validateUatPromotionSnapshotIntent,
    "UAT_PROMOTION_QUIESCE_SNAPSHOT_INTENT_SOURCE_INVALID",
  );
  const promotionIntentPath = path.join(
    physicalPath(`${UAT_PROMOTION_STATE_ROOT}/intents`, filesystemRoot),
    `${parameters.promotion_id}.${parameters.promotion_intent_sha256}.json`,
  );
  const promotionIntent = await trustedJsonFile(
    promotionIntentPath, 0o400, validateUatPromotionIntent, "UAT_PROMOTION_QUIESCE_PROMOTION_INTENT_INVALID",
  );
  if (!promotionIntent || promotionIntent.value.intent_sha256 !== parameters.promotion_intent_sha256) {
    reject("UAT_PROMOTION_QUIESCE_PROMOTION_INTENT_INVALID");
  }
  const identity = await readAuthorizedRootSource(
    parameters.runtime_identity_source, path.dirname(RELEASE_IDENTITY_FILE), new Set([0o750]),
    RELEASE_IDENTITY_ROOT_MARKER, RELEASE_IDENTITY_ROOT_MARKER_VALUE, 0o440, validateReleaseIdentity,
    filesystemRoot, "UAT_PROMOTION_QUIESCE_RUNTIME_SOURCE_INVALID",
  );
  const previous = current.value;
  const capture = snapshotIntent.value.writer_capture;
  if (previous.promotion_id !== parameters.promotion_id || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_id !== "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT" || previous.checkpoint_ordinal !== 5
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.checkpoint_evidence_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== ZERO_SHA256) reject("UAT_PROMOTION_QUIESCE_CURRENT_MISMATCH");
  if (snapshotIntent.value.snapshot_operation_id !== parameters.snapshot_operation_id
    || snapshotIntent.value.snapshot_intent_sha256 !== parameters.snapshot_intent_sha256
    || snapshotIntent.value.promotion_id !== parameters.promotion_id
    || snapshotIntent.value.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || snapshotIntent.value.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || snapshotIntent.value.previous_checkpoint_receipt_sha256 !== previous.previous_checkpoint_receipt_sha256
    || snapshotIntent.value.execution_authorization_sha256 !== previous.checkpoint_authorization_sha256
    || snapshotIntent.value.execution_authorization_sha256 === context.original_authorization_sha256) {
    reject("UAT_PROMOTION_QUIESCE_SNAPSHOT_INTENT_MISMATCH");
  }
  if (promotionIntent.value.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || promotionIntent.value.database_binding_sha256 !== parameters.database_binding_sha256
    || promotionIntent.value.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || promotionIntent.value.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || identity.value.deployment_class !== parameters.deployment_class || identity.value.deployment_id !== parameters.deployment_id
    || identity.value.web_container_id !== parameters.web_container_id || identity.value.worker_container_id !== parameters.worker_container_id
    || capture.compose_project !== parameters.compose_project || capture.web.container_name !== parameters.web_container
    || capture.web.container_id !== parameters.web_container_id || capture.worker.container_name !== parameters.worker_container
    || capture.worker.container_id !== parameters.worker_container_id || capture.web.image_digest !== identity.value.web_image_digest
    || capture.worker.image_digest !== identity.value.worker_image_digest || capture.application_version !== identity.value.application_version
    || capture.git_commit !== identity.value.git_commit || capture.migration_head !== identity.value.migration_head
    || capture.migration_manifest_sha256 !== identity.value.migration_manifest_sha256) {
    reject("UAT_PROMOTION_QUIESCE_BINDING_MISMATCH");
  }
  const checkedAt = Date.parse(parameters.quiesce_created_at);
  if (checkedAt < Date.parse(previous.recorded_at) || checkedAt < backupInstant(capture.snapshot_writer_verified_at, "UAT_PROMOTION_QUIESCE_TIME_INVALID")
    || Date.parse(parameters.quiesce_expires_at) > Date.parse(previous.promotion_expires_at)) reject("UAT_PROMOTION_QUIESCE_TIME_INVALID");
  const expected = Object.freeze({ parameters, capture, checkedAt: parameters.quiesce_created_at });
  const provider = options.writerQuiesceValidator ?? probeDockerWriterQuiesce;
  const evidence = validateWriterQuiesceEvidence(await provider(expected), expected);
  const binding = writerQuiesceBinding(parameters, snapshotIntent.value, promotionIntent.value, identity.value, evidence);
  digest(binding, "UAT_PROMOTION_QUIESCE_BINDING_INVALID");
  return Object.freeze({ previous, snapshotIntent: snapshotIntent.value, promotionIntent: promotionIntent.value, identity: identity.value, evidence, binding });
}

function migrationAuthorizationBinding(context, parameters, previous, quiesceIntent, promotionIntent, identity, manifest) {
  return clusterSha256({
    contract: "chenyida-erp-uat-promotion-migration-authorization-binding/v1",
    execution_scope: "APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE",
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    authorization_operation_id: context.operation_id,
    execution_authorization_sha256: context.original_authorization_sha256,
    previous_checkpoint_receipt_sha256: previous.receipt_sha256,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    quiesce_operation_id: parameters.quiesce_operation_id,
    quiesce_intent_sha256: parameters.quiesce_intent_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    release_manifest_sha256: parameters.release_manifest_sha256,
    release_id: manifest.release_id,
    candidate: {
      git_commit: promotionIntent.parameters.git_commit,
      git_tree: promotionIntent.parameters.git_tree,
      application_version: promotionIntent.parameters.application_version,
      web_image: promotionIntent.parameters.web_image,
      worker_image: promotionIntent.parameters.worker_image,
    },
    runtime: {
      application_version: identity.application_version,
      git_commit: identity.git_commit,
      migration_head: identity.migration_head,
      migration_manifest_sha256: identity.migration_manifest_sha256,
      web_container_id: identity.web_container_id,
      worker_container_id: identity.worker_container_id,
    },
    database: {
      deployment_class: parameters.deployment_class,
      deployment_id: parameters.deployment_id,
      database_name: parameters.database_name,
      database_oid: parameters.database_oid,
      database_system_identifier: parameters.database_system_identifier,
      database_marker: parameters.database_marker,
      migration_role: parameters.migration_role,
    },
    migration: {
      expected_current_head: parameters.expected_current_migration_head,
      target_head: parameters.target_migration_head,
      manifest_sha256: parameters.migration_manifest_sha256,
    },
    actors: {
      requester_identity_sha256: parameters.requester_identity_sha256,
      approver_identity_sha256: parameters.approver_identity_sha256,
      executor_identity_sha256: parameters.executor_identity_sha256,
    },
    authorization_window: {
      created_at: parameters.authorization_created_at,
      expires_at: parameters.authorization_expires_at,
    },
    quiesce_evidence_sha256: quiesceIntent.writer_quiesce_binding_sha256,
  });
}

async function verifyMigrationAuthorizationSources(context, filesystemRoot) {
  const parameters = context.parameters;
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_CURRENT_SOURCE_INVALID",
  );
  const quiesce = await readAuthorizedSource(
    parameters.quiesce_intent_source, filesystemRoot, validateUatPromotionQuiesceIntent,
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_QUIESCE_SOURCE_INVALID",
  );
  const promotionIntentPath = path.join(
    physicalPath(`${UAT_PROMOTION_STATE_ROOT}/intents`, filesystemRoot),
    `${parameters.promotion_id}.${parameters.promotion_intent_sha256}.json`,
  );
  const promotion = await trustedJsonFile(
    promotionIntentPath, 0o400, validateUatPromotionIntent,
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_PROMOTION_INTENT_INVALID",
  );
  if (!promotion || promotion.value.intent_sha256 !== parameters.promotion_intent_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_PROMOTION_INTENT_INVALID");
  }
  const identity = await readAuthorizedRootSource(
    parameters.runtime_identity_source, path.dirname(RELEASE_IDENTITY_FILE), new Set([0o750]),
    RELEASE_IDENTITY_ROOT_MARKER, RELEASE_IDENTITY_ROOT_MARKER_VALUE, 0o440, validateReleaseIdentity,
    filesystemRoot, "UAT_PROMOTION_MIGRATION_AUTHORIZATION_RUNTIME_SOURCE_INVALID",
  );
  const releaseRoot = physicalPath(path.dirname(parameters.release_manifest), filesystemRoot);
  await trustedMarker(
    path.join(releaseRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE),
    0o440, 0, "UAT_PROMOTION_MIGRATION_AUTHORIZATION_MANIFEST_ROOT_INVALID",
  );
  const release = await readAuthorizedSource(
    parameters.release_manifest_source, filesystemRoot,
    (value) => validateReleaseManifest(value, { now: new Date(parameters.authorization_created_at), requireEligible: true }),
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_MANIFEST_SOURCE_INVALID",
  );
  const previous = current.value;
  const quiesceIntent = quiesce.value;
  const promotionIntent = promotion.value;
  const runtimeIdentity = identity.value;
  const manifest = release.value;
  if (previous.promotion_id !== parameters.promotion_id || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_id !== "WRITER_QUIESCE_RECEIPT" || previous.checkpoint_ordinal !== 6
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || previous.checkpoint_evidence_sha256 !== parameters.quiesce_intent_sha256
    || previous.migration_authorization_binding_sha256 !== ZERO_SHA256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_CURRENT_MISMATCH");
  }
  if (quiesceIntent.quiesce_operation_id !== parameters.quiesce_operation_id
    || quiesceIntent.quiesce_intent_sha256 !== parameters.quiesce_intent_sha256
    || quiesceIntent.promotion_id !== parameters.promotion_id
    || quiesceIntent.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || quiesceIntent.previous_checkpoint_receipt_sha256 !== previous.previous_checkpoint_receipt_sha256
    || quiesceIntent.execution_authorization_sha256 !== previous.checkpoint_authorization_sha256
    || quiesceIntent.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || quiesceIntent.database_binding_sha256 !== parameters.database_binding_sha256
    || quiesceIntent.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || quiesceIntent.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || quiesceIntent.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || quiesceIntent.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_QUIESCE_MISMATCH");
  }
  if (promotionIntent.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || promotionIntent.database_binding_sha256 !== parameters.database_binding_sha256
    || promotionIntent.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || promotionIntent.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || promotionIntent.parameters.release_manifest_sha256 !== parameters.release_manifest_sha256
    || promotionIntent.parameters.migration_manifest_sha256 !== parameters.migration_manifest_sha256
    || promotionIntent.parameters.migration_head !== parameters.target_migration_head
    || promotionIntent.parameters.database_name !== parameters.database_name
    || promotionIntent.parameters.database_oid !== parameters.database_oid
    || promotionIntent.parameters.database_system_identifier !== parameters.database_system_identifier
    || promotionIntent.parameters.database_marker !== parameters.database_marker) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_PROMOTION_MISMATCH");
  }
  if (runtimeIdentity.deployment_class !== parameters.deployment_class
    || runtimeIdentity.deployment_id !== parameters.deployment_id
    || runtimeIdentity.migration_head !== parameters.expected_current_migration_head
    || runtimeIdentity.web_container_id !== quiesceIntent.snapshot_writer_capture.web.container_id
    || runtimeIdentity.worker_container_id !== quiesceIntent.snapshot_writer_capture.worker.container_id) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_RUNTIME_MISMATCH");
  }
  if (manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== "UAT"
    || manifest.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || manifest.source.git_commit !== promotionIntent.parameters.git_commit
    || manifest.source.git_tree !== promotionIntent.parameters.git_tree
    || manifest.source.package_version !== promotionIntent.parameters.application_version
    || manifest.images.web.image_reference !== promotionIntent.parameters.web_image
    || manifest.images.worker.image_reference !== promotionIntent.parameters.worker_image
    || manifest.migrations.head !== parameters.target_migration_head
    || manifest.migrations.allowlist_sha256 !== parameters.migration_manifest_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_MANIFEST_MISMATCH");
  }
  const created = Date.parse(parameters.authorization_created_at);
  if (created < Date.parse(previous.recorded_at)
    || Date.parse(parameters.authorization_expires_at) > Date.parse(previous.promotion_expires_at)) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID");
  }
  const binding = migrationAuthorizationBinding(
    context, parameters, previous, quiesceIntent, promotionIntent, runtimeIdentity, manifest,
  );
  digest(binding, "UAT_PROMOTION_MIGRATION_AUTHORIZATION_BINDING_INVALID");
  return Object.freeze({ previous, quiesceIntent, promotionIntent, identity: runtimeIdentity, manifest, binding });
}

async function verifyMigrationExecutionSources(context, filesystemRoot) {
  const parameters = context.parameters;
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_MIGRATION_EXECUTION_CURRENT_SOURCE_INVALID",
  );
  const approval = await readAuthorizedSource(
    parameters.migration_authorization_intent_source, filesystemRoot,
    validateUatPromotionMigrationAuthorizationIntent, "UAT_PROMOTION_MIGRATION_EXECUTION_APPROVAL_SOURCE_INVALID",
  );
  const identity = await readAuthorizedRootSource(
    parameters.runtime_identity_source, path.dirname(RELEASE_IDENTITY_FILE), new Set([0o750]),
    RELEASE_IDENTITY_ROOT_MARKER, RELEASE_IDENTITY_ROOT_MARKER_VALUE, 0o440, validateReleaseIdentity,
    filesystemRoot, "UAT_PROMOTION_MIGRATION_EXECUTION_RUNTIME_SOURCE_INVALID",
  );
  const releaseRoot = physicalPath(path.dirname(parameters.release_manifest), filesystemRoot);
  await trustedMarker(
    path.join(releaseRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE),
    0o440, 0, "UAT_PROMOTION_MIGRATION_EXECUTION_MANIFEST_ROOT_INVALID",
  );
  const release = await readAuthorizedSource(
    parameters.release_manifest_source, filesystemRoot,
    (value) => validateReleaseManifest(value, { now: new Date(parameters.execution_created_at), requireEligible: true }),
    "UAT_PROMOTION_MIGRATION_EXECUTION_MANIFEST_SOURCE_INVALID",
  );
  const previous = current.value;
  const approvalIntent = approval.value;
  const runtimeIdentity = identity.value;
  const manifest = release.value;
  if (previous.promotion_id !== parameters.promotion_id || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_id !== "ONE_TIME_MIGRATION_AUTHORIZATION" || previous.checkpoint_ordinal !== 7
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.checkpoint_authorization_sha256 !== parameters.migration_approval_authorization_sha256
    || previous.checkpoint_evidence_sha256 !== parameters.migration_authorization_intent_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || previous.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || previous.migration_fence_binding_sha256 !== ZERO_SHA256
    || previous.migration_result_binding_sha256 !== ZERO_SHA256
    || previous.authorization_sha256_chain.includes(context.original_authorization_sha256)) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_CURRENT_MISMATCH");
  }
  if (approvalIntent.migration_authorization_operation_id !== parameters.migration_authorization_operation_id
    || approvalIntent.migration_authorization_intent_sha256 !== parameters.migration_authorization_intent_sha256
    || approvalIntent.execution_authorization_sha256 !== parameters.migration_approval_authorization_sha256
    || approvalIntent.promotion_id !== parameters.promotion_id
    || approvalIntent.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || approvalIntent.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || approvalIntent.database_binding_sha256 !== parameters.database_binding_sha256
    || approvalIntent.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || approvalIntent.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || approvalIntent.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || approvalIntent.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || approvalIntent.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_APPROVAL_MISMATCH");
  }
  if (runtimeIdentity.deployment_class !== parameters.deployment_class
    || runtimeIdentity.deployment_id !== parameters.deployment_id
    || runtimeIdentity.migration_head !== parameters.expected_current_migration_head
    || runtimeIdentity.postgres_container_id !== parameters.postgres_container_id
    || runtimeIdentity.postgres_image_digest !== parameters.postgres_image_digest) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_RUNTIME_MISMATCH");
  }
  if (manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== "UAT"
    || manifest.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || manifest.images.worker.image_reference !== parameters.worker_image
    || manifest.migrations.head !== parameters.target_migration_head
    || manifest.migrations.allowlist_sha256 !== parameters.migration_manifest_sha256
    || manifest.migrations.entries.find((entry) => entry.filename === parameters.expected_current_migration_head) === undefined) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_MANIFEST_MISMATCH");
  }
  const created = Date.parse(parameters.execution_created_at);
  const expires = Date.parse(parameters.execution_expires_at);
  if (created < Date.parse(previous.recorded_at) || Date.parse(parameters.execution_expires_at) > Date.parse(previous.promotion_expires_at)) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID");
  }
  if (created < Date.parse(approvalIntent.created_at) || expires > Date.parse(approvalIntent.expires_at)) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_APPROVAL_EXPIRED");
  }
  return Object.freeze({ previous, approvalIntent, identity: runtimeIdentity, manifest });
}

function composeDeploymentPlanBinding(parameters, previous, migrationIntent, migrationResult, activeFence, identity, manifest) {
  return clusterSha256({
    contract: "chenyida-erp-uat-promotion-compose-deployment-plan/v1",
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    previous_checkpoint_receipt_sha256: previous.receipt_sha256,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    migration_operation_id: migrationIntent.migration_operation_id,
    migration_execution_intent_sha256: migrationIntent.migration_execution_intent_sha256,
    migration_execution_authorization_sha256: migrationIntent.execution_authorization_sha256,
    migration_grant_sha256: migrationIntent.grant_sha256,
    migration_result_sha256: migrationResult.result_sha256,
    active_migration_fence_sha256: activeFence.active_fence_sha256,
    release_manifest_sha256: parameters.release_manifest_sha256,
    release_manifest_candidate: {
      git_commit: manifest.source.git_commit,
      git_tree: manifest.source.git_tree,
      package_version: manifest.source.package_version,
      web_image: manifest.images.web.image_reference,
      worker_image: manifest.images.worker.image_reference,
      migration_head: manifest.migrations.head,
      migration_manifest_sha256: manifest.migrations.allowlist_sha256,
    },
    compose: {
      project: parameters.compose_project,
      project_root: parameters.compose_project_root,
      compose_file_sha256: parameters.compose_file_source.sha256,
      compose_release_file_sha256: parameters.compose_release_file_source.sha256,
      deployment_environment_sha256: parameters.deployment_environment_sha256,
    },
    old_runtime: {
      runtime_binding_sha256: parameters.runtime_binding_sha256,
      release_manifest_sha256: identity.release_manifest_sha256,
      web_container_id: parameters.old_web_container_id,
      web_image_digest: parameters.old_web_image_digest,
      worker_container_id: parameters.old_worker_container_id,
      worker_image_digest: parameters.old_worker_image_digest,
      postgres_container_id: parameters.postgres_container_id,
      postgres_image_digest: parameters.postgres_image_digest,
      caddy_container_id: parameters.caddy_container_id,
      caddy_image_digest: parameters.caddy_image_digest,
    },
    protected_runtime: {
      postgres_container: parameters.postgres_container,
      caddy_container: parameters.caddy_container,
      backend_network: parameters.backend_network,
      edge_network: parameters.edge_network,
    },
    target_runtime: { web_image: parameters.web_image, worker_image: parameters.worker_image },
    database: {
      name: parameters.database_name,
      system_identifier: parameters.database_system_identifier,
      oid: parameters.database_oid,
      marker: parameters.database_marker,
    },
  });
}

async function verifyComposeDeploymentSources(context, filesystemRoot) {
  const parameters = context.parameters;
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_CURRENT_SOURCE_INVALID",
  );
  const migrationIntentSource = await readAuthorizedSource(
    parameters.migration_execution_intent_source, filesystemRoot,
    validateUatPromotionMigrationExecutionIntent,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MIGRATION_INTENT_SOURCE_INVALID",
  );
  const migrationResultSource = await readAuthorizedSource(
    parameters.migration_result_source, filesystemRoot, validateUatPromotionMigrationResult,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MIGRATION_RESULT_SOURCE_INVALID",
  );
  const activeFenceSource = await readAuthorizedSource(
    parameters.active_migration_fence_source, filesystemRoot, validateUatPromotionActiveMigrationFence,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_ACTIVE_FENCE_SOURCE_INVALID",
  );
  const identitySource = await readAuthorizedRootSource(
    parameters.runtime_identity_source, path.dirname(RELEASE_IDENTITY_FILE), new Set([0o750]),
    RELEASE_IDENTITY_ROOT_MARKER, RELEASE_IDENTITY_ROOT_MARKER_VALUE, 0o440, validateReleaseIdentity,
    filesystemRoot, "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RUNTIME_SOURCE_INVALID",
  );
  const releaseRoot = physicalPath(path.dirname(parameters.release_manifest), filesystemRoot);
  await trustedMarker(
    path.join(releaseRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE),
    0o440, 0, "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MANIFEST_ROOT_INVALID",
  );
  const releaseSource = await readAuthorizedSource(
    parameters.release_manifest_source, filesystemRoot,
    (value) => validateReleaseManifest(value, { now: new Date(parameters.deployment_created_at), requireEligible: true }),
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_MANIFEST_SOURCE_INVALID",
  );
  const [composeSource, releaseComposeSource] = await Promise.all([
    readAuthorizedRawSource(
      parameters.compose_file_source, filesystemRoot,
      "UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMPOSE_SOURCE_INVALID",
    ),
    readAuthorizedRawSource(
      parameters.compose_release_file_source, filesystemRoot,
      "UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMPOSE_SOURCE_INVALID",
    ),
  ]);
  await readAuthorizedRawSource(
    parameters.deployment_environment_source, filesystemRoot,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_ENVIRONMENT_SOURCE_INVALID",
  );

  const previous = current.value;
  const migrationIntent = migrationIntentSource.value;
  const migrationResult = migrationResultSource.value;
  const activeFence = activeFenceSource.value;
  const identity = identitySource.value;
  const manifest = releaseSource.value;
  if (previous.promotion_id !== parameters.promotion_id
    || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_id !== "MIGRATION_COMMIT_RECEIPT" || previous.checkpoint_ordinal !== 8
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.checkpoint_authorization_sha256 !== parameters.migration_execution_authorization_sha256
    || previous.checkpoint_evidence_sha256 !== parameters.migration_result_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || previous.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || previous.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || previous.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || previous.compose_deployment_binding_sha256 !== ZERO_SHA256
    || previous.authorization_sha256_chain.includes(context.original_authorization_sha256)) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_CURRENT_MISMATCH");
  }
  if (migrationIntent.migration_operation_id !== parameters.migration_operation_id
    || migrationIntent.migration_execution_intent_sha256 !== parameters.migration_execution_intent_sha256
    || migrationIntent.execution_authorization_sha256 !== parameters.migration_execution_authorization_sha256
    || migrationIntent.grant_sha256 !== parameters.migration_grant_sha256
    || migrationIntent.promotion_id !== parameters.promotion_id
    || migrationIntent.promotion_generation !== parameters.promotion_generation
    || migrationIntent.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || migrationIntent.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || migrationIntent.database_binding_sha256 !== parameters.database_binding_sha256
    || migrationIntent.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || migrationIntent.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || migrationIntent.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || migrationIntent.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || migrationIntent.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_MIGRATION_INTENT_MISMATCH");
  }
  if (migrationResult.promotion_id !== parameters.promotion_id
    || migrationResult.migration_operation_id !== parameters.migration_operation_id
    || migrationResult.execution_authorization_sha256 !== parameters.migration_execution_authorization_sha256
    || migrationResult.grant_sha256 !== parameters.migration_grant_sha256
    || migrationResult.result_sha256 !== parameters.migration_result_sha256
    || migrationResult.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || migrationResult.database_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || migrationResult.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_MIGRATION_RESULT_MISMATCH");
  }
  if (activeFence.promotion_id !== parameters.promotion_id
    || activeFence.migration_operation_id !== parameters.migration_operation_id
    || activeFence.execution_authorization_sha256 !== parameters.migration_execution_authorization_sha256
    || activeFence.grant_sha256 !== parameters.migration_grant_sha256
    || activeFence.active_fence_sha256 !== parameters.active_migration_fence_sha256
    || activeFence.fence_before_sha256 !== migrationResult.fence_before.fence_sha256
    || activeFence.database_name !== parameters.database_name
    || activeFence.database_system_identifier !== parameters.database_system_identifier
    || activeFence.database_oid !== parameters.database_oid || activeFence.database_marker !== parameters.database_marker) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_ACTIVE_FENCE_MISMATCH");
  }
  if (identity.deployment_class !== parameters.deployment_class || identity.deployment_id !== parameters.deployment_id
    || identity.web_container_id !== parameters.old_web_container_id
    || identity.web_image_digest !== parameters.old_web_image_digest
    || identity.worker_container_id !== parameters.old_worker_container_id
    || identity.worker_image_digest !== parameters.old_worker_image_digest
    || identity.postgres_container_id !== parameters.postgres_container_id
    || identity.postgres_image_digest !== parameters.postgres_image_digest
    || identity.caddy_container_id !== parameters.caddy_container_id
    || identity.caddy_image_digest !== parameters.caddy_image_digest
    || identity.migration_head !== migrationIntent.parameters.expected_current_migration_head) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_RUNTIME_MISMATCH");
  }
  if (manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== "UAT"
    || manifest.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || manifest.images.web.image_reference !== parameters.web_image
    || manifest.images.worker.image_reference !== parameters.worker_image
    || manifest.migrations.head !== migrationIntent.parameters.target_migration_head
    || manifest.migrations.allowlist_sha256 !== migrationIntent.parameters.migration_manifest_sha256
    || manifest.source.compose_sha256 !== sha256(composeSource.raw)
    || manifest.source.release_compose_sha256 !== sha256(releaseComposeSource.raw)) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_MANIFEST_MISMATCH");
  }
  const created = Date.parse(parameters.deployment_created_at);
  const expires = Date.parse(parameters.deployment_expires_at);
  if (created < Date.parse(previous.recorded_at) || created < Date.parse(migrationResult.committed_at)
    || expires > Date.parse(previous.promotion_expires_at)) reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID");
  const deploymentPlanSha256 = composeDeploymentPlanBinding(
    parameters, previous, migrationIntent, migrationResult, activeFence, identity, manifest,
  );
  return Object.freeze({
    previous, migrationIntent, migrationResult, activeFence, identity, manifest, deploymentPlanSha256,
  });
}

function assertPostdeployDeploymentArtifacts(parameters, previous, deploymentResult, transfer, manifest, context) {
  const binding = clusterSha256({
    deployment_result_sha256: deploymentResult.result_sha256,
    fence_transfer_sha256: transfer.transfer_sha256,
  });
  if (deploymentResult.promotion_id !== parameters.promotion_id
    || deploymentResult.deployment_operation_id !== parameters.deployment_operation_id
    || deploymentResult.result_sha256 !== parameters.deployment_result_sha256
    || deploymentResult.release_manifest_sha256 !== parameters.release_manifest_sha256
    || deploymentResult.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || deploymentResult.compose_project !== parameters.compose_project
    || deploymentResult.compose_project_root !== parameters.compose_project_root
    || deploymentResult.runtime_configuration_sha256 !== transfer.runtime_configuration_sha256
    || transfer.promotion_id !== parameters.promotion_id
    || transfer.deployment_operation_id !== parameters.deployment_operation_id
    || transfer.deployment_result_sha256 !== deploymentResult.result_sha256
    || transfer.transfer_sha256 !== parameters.fence_transfer_sha256
    || transfer.database_handoff_sha256 !== deploymentResult.database_handoff.handoff_sha256
    || binding !== parameters.compose_deployment_binding_sha256
    || previous.compose_deployment_binding_sha256 !== binding
    || previous.authorization_sha256_chain.includes(context.original_authorization_sha256)) {
    reject("UAT_PROMOTION_POSTDEPLOY_DEPLOYMENT_BINDING_INVALID");
  }
  if (manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== "UAT"
    || manifest.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || manifest.source.git_commit.length !== 40 || manifest.source.git_tree.length !== 40
    || manifest.images.web.image_reference !== deploymentResult.services[0].image_reference
    || manifest.images.worker.image_reference !== deploymentResult.services[1].image_reference) {
    reject("UAT_PROMOTION_POSTDEPLOY_MANIFEST_BINDING_INVALID");
  }
}

function expectedRuntimeServices(deploymentResult) {
  const byService = new Map([
    ...deploymentResult.services.map((item) => [item.service, item]),
    ...deploymentResult.unchanged_services.map((item) => [item.service, item]),
  ]);
  return ["caddy", "postgres", "web", "worker"].map((service) => {
    const item = byService.get(service);
    return Object.freeze({
      service,
      container_id: item.container_id,
      image_id: item.image_id,
      image_reference: item.image_reference,
      restart_count: item.restart_count,
      oom_killed: item.oom_killed,
      running: item.running,
      health: item.health,
    });
  });
}

function assertRuntimeProbeBinding(
  probe, parameters, context, deploymentResult, transfer, manifest, now,
  minimumProbedAt = parameters.verification_created_at,
  maximumProbedAt = parameters.verification_expires_at,
) {
  try { validateRuntimeConfigurationProbeReceipt(probe, { now }); }
  catch { reject("UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_INVALID"); }
  const expectedServices = expectedRuntimeServices(deploymentResult);
  if ((probe.probe_id !== parameters.runtime_probe_operation_id && probe.probe_id !== parameters.probe_id)
    || probe.control.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || probe.control.authorization_sha256 !== context.original_authorization_sha256
    || !same(probe.deployment, { class: "UAT", id: parameters.deployment_id, compose_project: parameters.compose_project })
    || probe.release.manifest_sha256 !== parameters.release_manifest_sha256
    || probe.release.git_commit !== manifest.source.git_commit
    || probe.release.package_version !== manifest.source.package_version
    || !same(probe.runtime_guard, { contract: parameters.runtime_guard_contract, mode: parameters.runtime_guard_mode })
    || probe.runtime_policy_sha256 !== parameters.runtime_policy_sha256
    || probe.runtime_configuration_sha256 !== deploymentResult.runtime_configuration_sha256
    || probe.runtime_configuration_sha256 !== transfer.runtime_configuration_sha256
    || probe.compose_project_root_sha256 !== sha256(Buffer.from(parameters.compose_project_root, "utf8"))
    || !same(probe.selectors, {
      caddy: parameters.caddy_container, postgres: parameters.postgres_container,
      web: parameters.web_container, worker: parameters.worker_container,
    })
    || probe.services.some((item, index) => {
      const expected = expectedServices[index];
      return item.service !== expected.service || item.container_id !== expected.container_id
        || item.image_id !== expected.image_id || item.image_reference !== expected.image_reference
        || item.restart_count !== expected.restart_count || item.oom_killed !== expected.oom_killed
        || item.running !== expected.running || item.health !== expected.health;
    })
    || Date.parse(probe.probed_at) < Date.parse(deploymentResult.completed_at)
    || Date.parse(probe.probed_at) < Date.parse(transfer.transferred_at)
    || Date.parse(probe.probed_at) < Date.parse(minimumProbedAt)
    || Date.parse(probe.probed_at) >= Date.parse(maximumProbedAt)) {
    reject("UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_BINDING_INVALID");
  }
  return probe;
}

async function verifyPostdeployCommonSources(context, filesystemRoot, expectedCheckpoint) {
  const parameters = context.parameters;
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_POSTDEPLOY_CURRENT_SOURCE_INVALID",
  );
  const deployment = await readAuthorizedSource(
    parameters.deployment_result_source, filesystemRoot, validateUatPromotionComposeDeploymentResult,
    "UAT_PROMOTION_POSTDEPLOY_DEPLOYMENT_SOURCE_INVALID",
  );
  const transfer = await readAuthorizedSource(
    parameters.fence_transfer_source, filesystemRoot, validateUatPromotionActiveFenceTransfer,
    "UAT_PROMOTION_POSTDEPLOY_TRANSFER_SOURCE_INVALID",
  );
  const releaseRoot = physicalPath(path.dirname(parameters.release_manifest), filesystemRoot);
  await trustedMarker(
    path.join(releaseRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE),
    0o440, 0, "UAT_PROMOTION_POSTDEPLOY_MANIFEST_ROOT_INVALID",
  );
  const release = await readAuthorizedSource(
    parameters.release_manifest_source, filesystemRoot,
    (value) => validateReleaseManifest(value, { now: new Date(parameters.verification_created_at), requireEligible: true }),
    "UAT_PROMOTION_POSTDEPLOY_MANIFEST_SOURCE_INVALID",
  );
  if (release.raw.toString("utf8") !== canonicalReleaseJson(release.value)) {
    reject("UAT_PROMOTION_POSTDEPLOY_MANIFEST_SOURCE_INVALID");
  }
  const previous = current.value;
  if (previous.promotion_id !== parameters.promotion_id
    || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_id !== expectedCheckpoint
    || previous.checkpoint_ordinal !== (expectedCheckpoint === "COMPOSE_DEPLOYMENT_RECEIPT" ? 9 : 10)
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || previous.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || previous.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || previous.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || Date.parse(parameters.verification_created_at) < Date.parse(previous.recorded_at)
    || Date.parse(parameters.verification_expires_at) > Date.parse(previous.promotion_expires_at)) {
    reject("UAT_PROMOTION_POSTDEPLOY_CURRENT_MISMATCH");
  }
  assertPostdeployDeploymentArtifacts(parameters, previous, deployment.value, transfer.value, release.value, context);
  return Object.freeze({
    previous, deploymentResult: deployment.value, transfer: transfer.value, manifest: release.value,
  });
}

async function verifyPostdeployRuntimeSources(context, filesystemRoot) {
  return verifyPostdeployCommonSources(context, filesystemRoot, "COMPOSE_DEPLOYMENT_RECEIPT");
}

async function verifyPostdeployIdentitySources(context, filesystemRoot) {
  const sources = await verifyPostdeployCommonSources(context, filesystemRoot, "POST_DEPLOY_RUNTIME_CONFIGURATION");
  const parameters = context.parameters;
  const runtimeIntent = await readAuthorizedSource(
    parameters.runtime_probe_intent_source, filesystemRoot, validateUatPromotionPostdeployRuntimeIntent,
    "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_INTENT_SOURCE_INVALID",
  );
  const runtimeResult = await readAuthorizedSource(
    parameters.runtime_probe_result_source, filesystemRoot,
    (value) => validateRuntimeConfigurationProbeReceipt(value, { now: new Date(parameters.verification_created_at) }),
    "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_RESULT_SOURCE_INVALID",
  );
  const runtimeReceipt = await readAuthorizedSource(
    parameters.runtime_probe_receipt_source, filesystemRoot,
    (value) => validateRuntimeConfigurationProbeReceipt(value, { now: new Date(parameters.verification_created_at) }),
    "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_RECEIPT_SOURCE_INVALID",
  );
  if (!runtimeResult.raw.equals(runtimeReceipt.raw)
    || runtimeResult.raw.toString("utf8") !== canonicalRuntimeConfigurationProbeJson(runtimeResult.value)
    || runtimeIntent.value.verification_operation_id !== parameters.runtime_probe_operation_id
    || runtimeIntent.value.postdeploy_runtime_intent_sha256 !== parameters.runtime_probe_intent_sha256
    || runtimeIntent.value.execution_authorization_sha256 !== sources.previous.checkpoint_authorization_sha256
    || runtimeIntent.value.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || runtimeIntent.value.promotion_id !== parameters.promotion_id
    || runtimeIntent.value.promotion_generation !== parameters.promotion_generation
    || runtimeIntent.value.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || runtimeIntent.value.previous_checkpoint_receipt_sha256 !== sources.previous.previous_checkpoint_receipt_sha256
    || runtimeIntent.value.deployment_operation_id !== parameters.deployment_operation_id
    || runtimeIntent.value.deployment_result_sha256 !== parameters.deployment_result_sha256
    || runtimeIntent.value.fence_transfer_sha256 !== parameters.fence_transfer_sha256
    || runtimeIntent.value.runtime_configuration_sha256 !== parameters.runtime_configuration_sha256
    || runtimeIntent.value.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || runtimeIntent.value.database_binding_sha256 !== parameters.database_binding_sha256
    || runtimeIntent.value.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || runtimeIntent.value.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || runtimeIntent.value.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || runtimeIntent.value.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || runtimeIntent.value.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || runtimeIntent.value.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || runtimeIntent.value.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || runtimeIntent.value.compose_deployment_binding_sha256 !== parameters.compose_deployment_binding_sha256
    || sources.previous.checkpoint_evidence_sha256 !== parameters.runtime_probe_result_sha256
    || parameters.runtime_configuration_sha256 !== runtimeResult.value.runtime_configuration_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_RUNTIME_BINDING_INVALID");
  }
  const probeContext = { ...context, original_authorization_sha256: runtimeIntent.value.execution_authorization_sha256 };
  assertRuntimeProbeBinding(
    runtimeResult.value, parameters, probeContext, sources.deploymentResult, sources.transfer,
    sources.manifest, new Date(parameters.verification_created_at),
    runtimeIntent.value.created_at, runtimeIntent.value.expires_at,
  );
  return Object.freeze({ ...sources, runtimeIntent: runtimeIntent.value, runtimeProbe: runtimeResult.value });
}

async function verifyCrossRoleSources(context, filesystemRoot, options = {}) {
  const parameters = context.parameters;
  const observedAt = options.now ?? new Date();
  if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
    reject("UAT_PROMOTION_CROSS_ROLE_TIME_INVALID");
  }
  const current = await readAuthorizedSource(
    parameters.current_checkpoint_source, filesystemRoot, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_CROSS_ROLE_CURRENT_SOURCE_INVALID",
  );
  const identityIntent = await readAuthorizedSource(
    parameters.postdeploy_identity_intent_source, filesystemRoot,
    validateUatPromotionPostdeployIdentityIntent,
    "UAT_PROMOTION_CROSS_ROLE_IDENTITY_INTENT_SOURCE_INVALID",
  );
  const identityEvidence = await readAuthorizedSource(
    parameters.postdeploy_identity_evidence_source, filesystemRoot,
    validatePostdeployIdentityEvidence,
    "UAT_PROMOTION_CROSS_ROLE_IDENTITY_EVIDENCE_SOURCE_INVALID",
  );
  const releaseIdentity = await readAuthorizedRootSource(
    parameters.release_identity_source, path.dirname(RELEASE_IDENTITY_FILE), new Set([0o750]),
    RELEASE_IDENTITY_ROOT_MARKER, RELEASE_IDENTITY_ROOT_MARKER_VALUE, 0o440,
    validateReleaseIdentity, filesystemRoot, "UAT_PROMOTION_CROSS_ROLE_RELEASE_IDENTITY_SOURCE_INVALID",
  );
  const contract = await readAuthorizedSource(
    parameters.cross_role_contract_source, filesystemRoot, validateCrossRoleUatTemplate,
    "UAT_PROMOTION_CROSS_ROLE_CONTRACT_SOURCE_INVALID",
  );
  const result = await readAuthorizedRootSource(
    parameters.cross_role_result_source, UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT, new Set([0o700]),
    UAT_PROMOTION_CROSS_ROLE_RESULT_MARKER, UAT_PROMOTION_CROSS_ROLE_RESULT_MARKER_VALUE, 0o400,
    (value) => validateUatPromotionCrossRoleResult(value, { template: contract.value, now: observedAt }),
    filesystemRoot, "UAT_PROMOTION_CROSS_ROLE_RESULT_SOURCE_INVALID",
  );
  if (current.raw.toString("utf8") !== canonicalClusterJson(current.value)
    || identityIntent.raw.toString("utf8") !== canonicalClusterJson(identityIntent.value)
    || identityEvidence.raw.toString("utf8") !== canonicalPostdeployIdentityEvidenceJson(identityEvidence.value)
    || releaseIdentity.raw.toString("utf8") !== canonicalReleaseJson(releaseIdentity.value)
    || result.raw.toString("utf8") !== canonicalUatPromotionCrossRoleResultJson(result.value)) {
    reject("UAT_PROMOTION_CROSS_ROLE_SOURCE_CANONICAL_INVALID");
  }
  const previous = current.value;
  if (previous.promotion_id !== parameters.promotion_id
    || previous.promotion_generation !== parameters.promotion_generation
    || previous.checkpoint_id !== "POST_DEPLOY_IDENTITY" || previous.checkpoint_ordinal !== 11
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== parameters.promotion_intent_sha256
    || previous.original_authorization_sha256 !== parameters.promotion_original_authorization_sha256
    || previous.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || previous.database_binding_sha256 !== parameters.database_binding_sha256
    || previous.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || previous.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || previous.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || previous.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || previous.compose_deployment_binding_sha256 !== parameters.compose_deployment_binding_sha256
    || previous.authorization_sha256_chain.includes(context.original_authorization_sha256)
    || Date.parse(parameters.verification_created_at) < Date.parse(previous.recorded_at)
    || Date.parse(parameters.verification_expires_at) > Date.parse(previous.promotion_expires_at)
    || context.execution_mode === "ORIGINAL"
      && (observedAt.getTime() < Date.parse(parameters.verification_created_at)
        || observedAt.getTime() >= Date.parse(parameters.verification_expires_at))) {
    reject("UAT_PROMOTION_CROSS_ROLE_CURRENT_MISMATCH");
  }
  const upstreamIntent = identityIntent.value;
  if (upstreamIntent.verification_operation_id !== parameters.postdeploy_identity_operation_id
    || upstreamIntent.postdeploy_identity_intent_sha256 !== parameters.postdeploy_identity_intent_sha256
    || upstreamIntent.execution_authorization_sha256 !== previous.checkpoint_authorization_sha256
    || upstreamIntent.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || upstreamIntent.promotion_id !== parameters.promotion_id
    || upstreamIntent.promotion_generation !== parameters.promotion_generation
    || upstreamIntent.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || upstreamIntent.previous_checkpoint_receipt_sha256 !== previous.previous_checkpoint_receipt_sha256
    || upstreamIntent.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || upstreamIntent.database_binding_sha256 !== parameters.database_binding_sha256
    || upstreamIntent.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || upstreamIntent.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || upstreamIntent.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || upstreamIntent.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || upstreamIntent.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || upstreamIntent.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || upstreamIntent.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || upstreamIntent.compose_deployment_binding_sha256 !== parameters.compose_deployment_binding_sha256) {
    reject("UAT_PROMOTION_CROSS_ROLE_IDENTITY_INTENT_BINDING_INVALID");
  }
  const upstreamEvidence = identityEvidence.value;
  if (upstreamEvidence.promotion_id !== parameters.promotion_id
    || upstreamEvidence.verification_operation_id !== parameters.postdeploy_identity_operation_id
    || upstreamEvidence.execution_authorization_sha256 !== previous.checkpoint_authorization_sha256
    || upstreamEvidence.evidence_sha256 !== parameters.postdeploy_identity_evidence_sha256
    || previous.checkpoint_evidence_sha256 !== upstreamEvidence.evidence_sha256
    || previous.recorded_at !== upstreamEvidence.postdeploy_receipt.generated_at
    || upstreamEvidence.release_identity_sha256 !== parameters.release_identity_sha256
    || sha256(releaseIdentity.raw) !== parameters.release_identity_sha256
    || !same(upstreamEvidence.release_identity, releaseIdentity.value)) {
    reject("UAT_PROMOTION_CROSS_ROLE_IDENTITY_EVIDENCE_BINDING_INVALID");
  }
  const evidence = result.value;
  if (parameters.cross_role_contract
      !== `${SUPERVISOR_BUNDLE_ROOT}/${context.supervisor_bundle_sha256}/${CROSS_ROLE_UAT_CONTRACT_RELATIVE}`
    || contract.value.artifact_sha256 !== parameters.cross_role_contract_artifact_sha256
    || sha256(contract.raw) !== parameters.cross_role_contract_file_sha256
    || sha256(result.raw) !== parameters.cross_role_result_file_sha256
    || evidence.result_sha256 !== parameters.cross_role_result_sha256
    || evidence.result_id !== parameters.result_id
    || evidence.verification_operation_id !== context.operation_id
    || evidence.promotion_id !== parameters.promotion_id
    || evidence.promotion_generation !== parameters.promotion_generation
    || evidence.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || evidence.previous_checkpoint_receipt_sha256 !== previous.receipt_sha256
    || evidence.postdeploy_identity_evidence_sha256 !== upstreamEvidence.evidence_sha256
    || evidence.release_identity_sha256 !== parameters.release_identity_sha256
    || evidence.cross_role_contract_artifact_sha256 !== parameters.cross_role_contract_artifact_sha256
    || evidence.authorization_matrix_artifact_sha256 !== parameters.authorization_matrix_artifact_sha256
    || evidence.authorization_matrix_source_manifest_sha256
      !== parameters.authorization_matrix_source_manifest_sha256
    || evidence.human_execution_authorization_sha256 === context.original_authorization_sha256
    || previous.authorization_sha256_chain.includes(evidence.human_execution_authorization_sha256)
    || Date.parse(evidence.execution_started_at) < Date.parse(previous.recorded_at)
    || Date.parse(evidence.signoff_completed_at) > Date.parse(parameters.verification_created_at)
    || Date.parse(evidence.signoff_completed_at) >= Date.parse(previous.promotion_expires_at)) {
    reject("UAT_PROMOTION_CROSS_ROLE_RESULT_BINDING_INVALID");
  }
  return Object.freeze({
    previous, identityIntent: upstreamIntent, identityEvidence: upstreamEvidence,
    releaseIdentity: releaseIdentity.value, contract: contract.value, result: evidence,
    resultRaw: result.raw,
  });
}

async function ensureDirectory(directory, parent, mode, code) {
  await trustedDirectory(parent, new Set([0o700, 0o750, 0o755]), code);
  let created = false;
  try { await mkdir(directory, { mode }); created = true; }
  catch (error) { if (error?.code !== "EEXIST") reject(code); }
  if (created) {
    await chown(directory, 0, 0).catch(() => reject(code));
    await chmod(directory, mode).catch(() => reject(code));
    await syncDirectory(parent, code);
  }
  await trustedDirectory(directory, new Set([mode]), code);
  return Object.freeze({ directory, created });
}

async function ensureMarker(file, raw, allowCreate, code) {
  const existing = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (existing === null) {
    if (!allowCreate) reject(code);
    let handle;
    try {
      handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(raw); await handle.chown(0, 0); await handle.chmod(0o400); await handle.sync();
    } catch { reject(code); }
    finally { await handle?.close().catch(() => undefined); }
    await syncDirectory(path.dirname(file), code);
  }
  await trustedMarker(file, raw, 0o400, 0, code);
}

async function ensureRawFile(file, raw, finalMode, validator, code, canonicalizer = canonicalClusterJson) {
  let metadata = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata !== null && metadata.isFile() && !metadata.isSymbolicLink() && metadata.uid === 0 && metadata.gid === 0
    && metadata.nlink === 1 && new Set([0o600, finalMode]).has(metadata.mode & 0o7777)
    && metadata.size >= 0 && metadata.size <= raw.length) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
    let existing;
    try { existing = await handle.readFile(); } finally { await handle.close(); }
    if (raw.subarray(0, existing.length).equals(existing)) {
      if (existing.length === raw.length && (metadata.mode & 0o7777) === finalMode) {
        const trusted = await trustedJsonFile(file, finalMode, validator, code, 0, true, canonicalizer);
        if (trusted?.raw.equals(raw)) return;
      }
      await unlink(file).catch(() => reject(code));
      await syncDirectory(path.dirname(file), code);
      metadata = null;
    }
  }
  if (metadata !== null) reject(code);
  let handle;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(raw); await handle.chown(0, 0); await handle.chmod(finalMode); await handle.sync();
  } catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
  const stored = await trustedJsonFile(file, finalMode, validator, code, 0, true, canonicalizer);
  if (!stored?.raw.equals(raw)) reject(code);
}

async function atomicAlias(file, temporary, raw, mode, validator, expectedPrevious, code) {
  await ensureRawFile(temporary, raw, mode, validator, `${code}_TEMP_INVALID`);
  const before = await trustedJsonFile(file, mode, validator, `${code}_CURRENT_INVALID`);
  if (expectedPrevious === null ? before !== null : before === null || !before.raw.equals(expectedPrevious)) reject(`${code}_CURRENT_CHANGED`);
  await rename(temporary, file).catch(() => reject(`${code}_RENAME_FAILED`));
  await syncDirectory(path.dirname(file), `${code}_SYNC_FAILED`);
  const stored = await trustedJsonFile(file, mode, validator, `${code}_CURRENT_INVALID`);
  if (!stored?.raw.equals(raw)) reject(`${code}_CURRENT_INVALID`);
}

async function layout(filesystemRoot, initialize) {
  await trustedAncestors("/var/lib/chenyida-erp", filesystemRoot, "UAT_PROMOTION_STATE_ANCESTOR_INVALID");
  const stateRoot = physicalPath(UAT_PROMOTION_STATE_ROOT, filesystemRoot);
  const stateParent = path.dirname(stateRoot);
  if (initialize) {
    const state = await ensureDirectory(stateRoot, stateParent, 0o700, "UAT_PROMOTION_STATE_ROOT_INVALID");
    await ensureMarker(path.join(stateRoot, UAT_PROMOTION_STATE_MARKER), Buffer.from(UAT_PROMOTION_STATE_MARKER_VALUE), state.created, "UAT_PROMOTION_STATE_MARKER_INVALID");
    for (const name of ["generations", "history", "receipts", "intents", "grants", "results", "executions", "active-fences", "fence-transfers", "recoveries", "postdeploy-control-bindings", "containments", "quarantine"]) {
      await ensureDirectory(path.join(stateRoot, name), stateRoot, 0o700, "UAT_PROMOTION_STATE_ROOT_INVALID");
    }
  } else {
    await trustedDirectory(stateRoot, new Set([0o700]), "UAT_PROMOTION_STATE_ROOT_INVALID");
    for (const name of ["generations", "history", "receipts", "intents", "recoveries", "quarantine"]) {
      await trustedDirectory(path.join(stateRoot, name), new Set([0o700]), "UAT_PROMOTION_STATE_ROOT_INVALID");
    }
    for (const name of ["grants", "results", "executions", "active-fences", "fence-transfers", "postdeploy-control-bindings", "containments"]) {
      await ensureDirectory(path.join(stateRoot, name), stateRoot, 0o700, "UAT_PROMOTION_STATE_ROOT_INVALID");
    }
    await ensureMarker(path.join(stateRoot, UAT_PROMOTION_STATE_MARKER), Buffer.from(UAT_PROMOTION_STATE_MARKER_VALUE), false, "UAT_PROMOTION_STATE_MARKER_INVALID");
  }
  return Object.freeze({
    stateRoot,
    generations: path.join(stateRoot, "generations"), history: path.join(stateRoot, "history"),
    receipts: path.join(stateRoot, "receipts"), intents: path.join(stateRoot, "intents"),
    grants: path.join(stateRoot, "grants"), results: path.join(stateRoot, "results"),
    executions: path.join(stateRoot, "executions"), activeFences: path.join(stateRoot, "active-fences"),
    fenceTransfers: path.join(stateRoot, "fence-transfers"),
    recoveries: path.join(stateRoot, "recoveries"),
    postdeployControlBindings: path.join(stateRoot, "postdeploy-control-bindings"),
    containments: path.join(stateRoot, "containments"),
    quarantine: path.join(stateRoot, "quarantine"),
    current: physicalPath(UAT_PROMOTION_CURRENT_FILE, filesystemRoot),
  });
}

async function strictNames(directory, pattern, allowed, code) {
  const names = await readdir(directory).catch(() => reject(code));
  if (names.length > 20_000 || names.some((name) => !pattern.test(name))) reject(code);
  return names.filter((name) => !allowed.has(name)).sort();
}

export function validateUatPromotionCheckpointReceipt(value) {
  exactKeys(value, [
    "schema_version", "contract", "promotion_id", "promotion_generation", "journal_sequence", "checkpoint_id",
    "checkpoint_ordinal", "completed_checkpoints", "checkpoint_status", "journal_status", "recorded_at",
    "promotion_expires_at", "intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256", "compose_deployment_binding_sha256",
    "previous_promotion_receipt_sha256", "previous_checkpoint_receipt_sha256", "original_authorization_sha256",
    "checkpoint_authorization_sha256", "authorization_sha256_chain", "authorization_chain_sha256",
    "checkpoint_evidence_sha256", "receipt_sha256",
  ], "UAT_PROMOTION_RECEIPT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_RECEIPT_CONTRACT) reject("UAT_PROMOTION_RECEIPT_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_RECEIPT_INVALID");
  integer(value.promotion_generation, 1, 1_000_000, "UAT_PROMOTION_RECEIPT_INVALID");
  integer(value.checkpoint_ordinal, 4, CHECKPOINT_ORDER.length, "UAT_PROMOTION_RECEIPT_INVALID");
  if (value.journal_sequence !== value.checkpoint_ordinal - 3 || value.checkpoint_id !== CHECKPOINT_ORDER[value.checkpoint_ordinal - 1]
    || !same(value.completed_checkpoints, CHECKPOINT_ORDER.slice(0, value.checkpoint_ordinal))) reject("UAT_PROMOTION_RECEIPT_SEQUENCE_INVALID");
  if (!new Set(["COMMITTED", "UNKNOWN", "PARTIAL"]).has(value.checkpoint_status)
    || !new Set(["IN_PROGRESS", "UNKNOWN", "PARTIAL", "COMMITTED", "ROLLBACK_IN_PROGRESS", "ROLLED_BACK", "QUARANTINED"]).has(value.journal_status)) reject("UAT_PROMOTION_RECEIPT_STATUS_INVALID");
  if (value.checkpoint_status === "UNKNOWN" && value.journal_status !== "UNKNOWN"
    || value.checkpoint_status === "PARTIAL" && value.journal_status !== "PARTIAL"
    || value.checkpoint_status === "COMMITTED" && value.checkpoint_ordinal < 13 && value.journal_status !== "IN_PROGRESS"
    || value.checkpoint_status === "COMMITTED" && value.checkpoint_ordinal === 13 && value.journal_status !== "COMMITTED"
    || value.checkpoint_status === "COMMITTED" && value.checkpoint_ordinal === 14 && value.journal_status !== "ROLLBACK_IN_PROGRESS"
    || value.checkpoint_status === "COMMITTED" && value.checkpoint_ordinal === 15 && value.journal_status !== "ROLLED_BACK") reject("UAT_PROMOTION_RECEIPT_STATUS_INVALID");
  iso(value.recorded_at, "UAT_PROMOTION_RECEIPT_TIME_INVALID");
  iso(value.promotion_expires_at, "UAT_PROMOTION_RECEIPT_TIME_INVALID");
  if (Date.parse(value.recorded_at) >= Date.parse(value.promotion_expires_at)) reject("UAT_PROMOTION_RECEIPT_TIME_INVALID");
  for (const field of [
    "intent_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "recovery_binding_sha256", "original_authorization_sha256", "checkpoint_authorization_sha256",
    "authorization_chain_sha256", "checkpoint_evidence_sha256", "receipt_sha256",
  ]) digest(value[field], "UAT_PROMOTION_RECEIPT_DIGEST_INVALID");
  if (!Array.isArray(value.authorization_sha256_chain)
    || value.authorization_sha256_chain.length !== value.journal_sequence
    || value.authorization_sha256_chain.some((item) => typeof item !== "string" || !SHA256.test(item) || item === ZERO_SHA256)
    || new Set(value.authorization_sha256_chain).size !== value.authorization_sha256_chain.length
    || value.authorization_sha256_chain[0] !== value.original_authorization_sha256
    || value.authorization_sha256_chain.at(-1) !== value.checkpoint_authorization_sha256
    || clusterSha256(value.authorization_sha256_chain) !== value.authorization_chain_sha256) reject("UAT_PROMOTION_RECEIPT_AUTHORIZATION_CHAIN_INVALID");
  for (const field of [
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "compose_deployment_binding_sha256",
    "previous_promotion_receipt_sha256", "previous_checkpoint_receipt_sha256",
  ]) {
    digest(value[field], "UAT_PROMOTION_RECEIPT_DIGEST_INVALID", true);
  }
  if (value.checkpoint_ordinal === 4 && value.previous_checkpoint_receipt_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal > 4 && value.previous_checkpoint_receipt_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 5 && value.promotion_snapshot_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 5 && value.promotion_snapshot_binding_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 6 && value.writer_quiesce_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 6 && value.writer_quiesce_binding_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 7 && value.migration_authorization_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 7 && value.migration_authorization_binding_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 8 && value.migration_fence_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 8 && value.migration_fence_binding_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 8 && value.migration_result_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 8 && value.migration_result_binding_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 9 && value.compose_deployment_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 9 && value.compose_deployment_binding_sha256 === ZERO_SHA256
    || clusterSha256(bodyWithout(value, "receipt_sha256")) !== value.receipt_sha256) reject("UAT_PROMOTION_RECEIPT_BINDING_INVALID");
  return value;
}

function createInitialReceipt(context, intent) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_RECEIPT_CONTRACT,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    journal_sequence: 1,
    checkpoint_id: CHECKPOINT_ORDER[3],
    checkpoint_ordinal: 4,
    completed_checkpoints: CHECKPOINT_ORDER.slice(0, 4),
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: parameters.promotion_created_at,
    promotion_expires_at: parameters.promotion_expires_at,
    intent_sha256: intent.intent_sha256,
    candidate_binding_sha256: intent.candidate_binding_sha256,
    database_binding_sha256: intent.database_binding_sha256,
    runtime_binding_sha256: intent.runtime_binding_sha256,
    recovery_binding_sha256: intent.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: ZERO_SHA256,
    writer_quiesce_binding_sha256: ZERO_SHA256,
    migration_authorization_binding_sha256: ZERO_SHA256,
    migration_fence_binding_sha256: ZERO_SHA256,
    migration_result_binding_sha256: ZERO_SHA256,
    compose_deployment_binding_sha256: ZERO_SHA256,
    previous_promotion_receipt_sha256: parameters.previous_promotion_receipt_sha256,
    previous_checkpoint_receipt_sha256: ZERO_SHA256,
    original_authorization_sha256: context.original_authorization_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    authorization_sha256_chain: [context.original_authorization_sha256],
    authorization_chain_sha256: clusterSha256([context.original_authorization_sha256]),
    checkpoint_evidence_sha256: intent.intent_sha256,
  };
  return Object.freeze(validateUatPromotionCheckpointReceipt({ ...body, receipt_sha256: clusterSha256(body) }));
}

export function createNextUatPromotionCheckpointReceipt(previousInput, input) {
  const previous = validateUatPromotionCheckpointReceipt(previousInput);
  exactKeys(input, [
    "checkpoint_id", "checkpoint_status", "journal_status", "recorded_at", "checkpoint_evidence_sha256",
    "checkpoint_authorization_sha256", "intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256", "compose_deployment_binding_sha256",
  ], "UAT_PROMOTION_CHECKPOINT_INPUT_INVALID");
  const nextOrdinal = previous.checkpoint_ordinal + 1;
  if (nextOrdinal > CHECKPOINT_ORDER.length || input.checkpoint_id !== CHECKPOINT_ORDER[nextOrdinal - 1]) reject("UAT_PROMOTION_CHECKPOINT_SKIP_FORBIDDEN");
  if (!new Set(["IN_PROGRESS", "COMMITTED"]).has(previous.journal_status)
    || previous.journal_status === "COMMITTED" && nextOrdinal !== 14
    || previous.checkpoint_status !== "COMMITTED") reject("UAT_PROMOTION_CHECKPOINT_PREVIOUS_BLOCKED");
  for (const field of ["intent_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256", "recovery_binding_sha256"]) {
    digest(input[field], "UAT_PROMOTION_CHECKPOINT_BINDING_INVALID");
    if (input[field] !== previous[field]) reject("UAT_PROMOTION_CHECKPOINT_BINDING_INVALID");
  }
  digest(input.checkpoint_evidence_sha256, "UAT_PROMOTION_CHECKPOINT_EVIDENCE_INVALID");
  digest(input.checkpoint_authorization_sha256, "UAT_PROMOTION_CHECKPOINT_AUTHORIZATION_INVALID");
  digest(input.promotion_snapshot_binding_sha256, "UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID", nextOrdinal < 5);
  digest(input.writer_quiesce_binding_sha256, "UAT_PROMOTION_CHECKPOINT_QUIESCE_INVALID", nextOrdinal < 6);
  digest(input.migration_authorization_binding_sha256, "UAT_PROMOTION_CHECKPOINT_MIGRATION_AUTHORIZATION_INVALID", nextOrdinal < 7);
  digest(input.migration_fence_binding_sha256, "UAT_PROMOTION_CHECKPOINT_MIGRATION_FENCE_INVALID", nextOrdinal < 8);
  digest(input.migration_result_binding_sha256, "UAT_PROMOTION_CHECKPOINT_MIGRATION_RESULT_INVALID", nextOrdinal < 8);
  digest(input.compose_deployment_binding_sha256, "UAT_PROMOTION_CHECKPOINT_COMPOSE_DEPLOYMENT_INVALID", nextOrdinal < 9);
  if (previous.authorization_sha256_chain.includes(input.checkpoint_authorization_sha256)) reject("UAT_PROMOTION_CHECKPOINT_AUTHORIZATION_REUSED");
  if (nextOrdinal === 5) {
    if (input.promotion_snapshot_binding_sha256 === ZERO_SHA256) reject("UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID");
  } else if (input.promotion_snapshot_binding_sha256 !== previous.promotion_snapshot_binding_sha256) {
    reject("UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID");
  }
  if (nextOrdinal === 6) {
    if (input.writer_quiesce_binding_sha256 === ZERO_SHA256) reject("UAT_PROMOTION_CHECKPOINT_QUIESCE_INVALID");
  } else if (input.writer_quiesce_binding_sha256 !== previous.writer_quiesce_binding_sha256) {
    reject("UAT_PROMOTION_CHECKPOINT_QUIESCE_INVALID");
  }
  if (nextOrdinal === 7) {
    if (input.migration_authorization_binding_sha256 === ZERO_SHA256) {
      reject("UAT_PROMOTION_CHECKPOINT_MIGRATION_AUTHORIZATION_INVALID");
    }
  } else if (input.migration_authorization_binding_sha256 !== previous.migration_authorization_binding_sha256) {
    reject("UAT_PROMOTION_CHECKPOINT_MIGRATION_AUTHORIZATION_INVALID");
  }
  if (nextOrdinal === 8) {
    if (input.migration_fence_binding_sha256 === ZERO_SHA256 || input.migration_result_binding_sha256 === ZERO_SHA256) {
      reject("UAT_PROMOTION_CHECKPOINT_MIGRATION_RESULT_INVALID");
    }
  } else if (input.migration_fence_binding_sha256 !== previous.migration_fence_binding_sha256
    || input.migration_result_binding_sha256 !== previous.migration_result_binding_sha256) {
    reject("UAT_PROMOTION_CHECKPOINT_MIGRATION_RESULT_INVALID");
  }
  if (nextOrdinal === 9) {
    if (input.compose_deployment_binding_sha256 === ZERO_SHA256) {
      reject("UAT_PROMOTION_CHECKPOINT_COMPOSE_DEPLOYMENT_INVALID");
    }
  } else if (input.compose_deployment_binding_sha256 !== previous.compose_deployment_binding_sha256) {
    reject("UAT_PROMOTION_CHECKPOINT_COMPOSE_DEPLOYMENT_INVALID");
  }
  iso(input.recorded_at, "UAT_PROMOTION_CHECKPOINT_TIME_INVALID");
  if (Date.parse(input.recorded_at) < Date.parse(previous.recorded_at) || Date.parse(input.recorded_at) >= Date.parse(previous.promotion_expires_at)) reject("UAT_PROMOTION_CHECKPOINT_TIME_INVALID");
  const body = {
    ...bodyWithout(previous, "receipt_sha256"),
    journal_sequence: previous.journal_sequence + 1,
    checkpoint_id: input.checkpoint_id,
    checkpoint_ordinal: nextOrdinal,
    completed_checkpoints: CHECKPOINT_ORDER.slice(0, nextOrdinal),
    checkpoint_status: input.checkpoint_status,
    journal_status: input.journal_status,
    recorded_at: input.recorded_at,
    promotion_snapshot_binding_sha256: input.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: input.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: input.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: input.migration_fence_binding_sha256,
    migration_result_binding_sha256: input.migration_result_binding_sha256,
    compose_deployment_binding_sha256: input.compose_deployment_binding_sha256,
    previous_checkpoint_receipt_sha256: previous.receipt_sha256,
    checkpoint_authorization_sha256: input.checkpoint_authorization_sha256,
    authorization_sha256_chain: [...previous.authorization_sha256_chain, input.checkpoint_authorization_sha256],
    authorization_chain_sha256: clusterSha256([...previous.authorization_sha256_chain, input.checkpoint_authorization_sha256]),
    checkpoint_evidence_sha256: input.checkpoint_evidence_sha256,
  };
  return Object.freeze(validateUatPromotionCheckpointReceipt({ ...body, receipt_sha256: clusterSha256(body) }));
}

function createIntent(context) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_INTENT_CONTRACT,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.promotion_created_at,
    expires_at: parameters.promotion_expires_at,
    original_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    candidate_binding_sha256: candidateBinding(parameters),
    database_binding_sha256: databaseBinding(parameters),
    runtime_binding_sha256: parameters.current_runtime_identity_source.sha256,
    recovery_binding_sha256: recoveryBinding(parameters),
    checkpoint_order: [...CHECKPOINT_ORDER],
    adapter_statuses: {
      BEGIN_UAT_PROMOTION: "IMPLEMENTED",
      CAPTURE_UAT_PROMOTION_SNAPSHOT: "IMPLEMENTED",
      QUIESCE_UAT_WRITERS: "IMPLEMENTED",
      AUTHORIZE_UAT_PROMOTION_MIGRATION: "IMPLEMENTED",
      RUN_UAT_PROMOTION_MIGRATION: "IMPLEMENTED",
      DEPLOY_UAT_RELEASE: "IMPLEMENTED",
      VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION: "IMPLEMENTED",
      VERIFY_UAT_POSTDEPLOY_IDENTITY: "IMPLEMENTED",
      VERIFY_UAT_CROSS_ROLE_EXECUTION: "IMPLEMENTED",
      ROLLBACK_UAT_RELEASE: "NOT_IMPLEMENTED",
      RECOVER_UAT_PROMOTION: "IMPLEMENTED",
    },
  };
  return Object.freeze({ ...body, intent_sha256: clusterSha256(body) });
}

export function validateUatPromotionIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "promotion_id", "promotion_generation", "created_at", "expires_at",
    "original_authorization_sha256", "supervisor_bundle_sha256", "parameters", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "recovery_binding_sha256", "checkpoint_order",
    "adapter_statuses", "intent_sha256",
  ], "UAT_PROMOTION_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_INTENT_CONTRACT) reject("UAT_PROMOTION_INTENT_INVALID");
  validateUatPromotionParameters(value.parameters);
  for (const field of [
    "original_authorization_sha256", "supervisor_bundle_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "recovery_binding_sha256", "intent_sha256",
  ]) digest(value[field], "UAT_PROMOTION_INTENT_INVALID");
  if (value.promotion_id !== value.parameters.promotion_id || value.promotion_generation !== value.parameters.promotion_generation
    || value.created_at !== value.parameters.promotion_created_at || value.expires_at !== value.parameters.promotion_expires_at
    || value.candidate_binding_sha256 !== candidateBinding(value.parameters)
    || value.database_binding_sha256 !== databaseBinding(value.parameters)
    || value.runtime_binding_sha256 !== value.parameters.current_runtime_identity_source.sha256
    || value.recovery_binding_sha256 !== recoveryBinding(value.parameters)
    || !same(value.checkpoint_order, CHECKPOINT_ORDER)
    || !same(value.adapter_statuses, {
      BEGIN_UAT_PROMOTION: "IMPLEMENTED",
      CAPTURE_UAT_PROMOTION_SNAPSHOT: "IMPLEMENTED",
      QUIESCE_UAT_WRITERS: "IMPLEMENTED",
      AUTHORIZE_UAT_PROMOTION_MIGRATION: "IMPLEMENTED",
      RUN_UAT_PROMOTION_MIGRATION: "IMPLEMENTED",
      DEPLOY_UAT_RELEASE: "IMPLEMENTED",
      VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION: "IMPLEMENTED",
      VERIFY_UAT_POSTDEPLOY_IDENTITY: "IMPLEMENTED",
      VERIFY_UAT_CROSS_ROLE_EXECUTION: "IMPLEMENTED",
      ROLLBACK_UAT_RELEASE: "NOT_IMPLEMENTED",
      RECOVER_UAT_PROMOTION: "IMPLEMENTED",
    })
    || clusterSha256(bodyWithout(value, "intent_sha256")) !== value.intent_sha256) reject("UAT_PROMOTION_INTENT_BINDING_INVALID");
  return value;
}

function createSnapshotIntent(context, sources) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT,
    snapshot_operation_id: context.operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.snapshot_created_at,
    expires_at: parameters.snapshot_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: sources.evidence.binding,
    snapshot_recorded_at: sources.evidence.recordedAt,
    snapshot_objects: sources.evidence.objects,
    writer_capture: sources.evidence.writerCapture,
  };
  return Object.freeze({ ...body, snapshot_intent_sha256: clusterSha256(body) });
}

export function validateUatPromotionSnapshotIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "snapshot_operation_id", "promotion_id", "promotion_generation", "created_at", "expires_at",
    "execution_authorization_sha256", "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "snapshot_recorded_at", "snapshot_objects",
    "writer_capture", "snapshot_intent_sha256",
  ], "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT) reject("UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  identifier(value.snapshot_operation_id, "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  validateUatPromotionSnapshotParameters(value.parameters);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "snapshot_intent_sha256",
  ]) digest(value[field], "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  iso(value.snapshot_recorded_at, "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  validateSnapshotObjects(value.snapshot_objects);
  validateWriterCapture(value.writer_capture);
  if (value.snapshot_operation_id === value.promotion_id || value.promotion_id !== value.parameters.promotion_id
    || value.promotion_generation !== value.parameters.promotion_generation
    || value.created_at !== value.parameters.snapshot_created_at || value.expires_at !== value.parameters.snapshot_expires_at
    || value.promotion_intent_sha256 !== value.parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== value.parameters.previous_checkpoint_receipt_sha256
    || value.candidate_binding_sha256 !== value.parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== value.parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== value.parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== value.parameters.preupgrade_recovery_binding_sha256
    || !same(value.snapshot_objects, value.parameters.snapshot_objects)
    || clusterSha256(bodyWithout(value, "snapshot_intent_sha256")) !== value.snapshot_intent_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_INTENT_BINDING_INVALID");
  }
  return value;
}

function createQuiesceIntent(context, sources) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_QUIESCE_INTENT_CONTRACT,
    quiesce_operation_id: context.operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.quiesce_created_at,
    expires_at: parameters.quiesce_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    snapshot_operation_id: parameters.snapshot_operation_id,
    snapshot_intent_sha256: parameters.snapshot_intent_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    snapshot_writer_capture: sources.snapshotIntent.writer_capture,
    quiesce_checked_at: sources.evidence.checked_at,
    quiesce_evidence: sources.evidence,
    writer_quiesce_binding_sha256: sources.binding,
  };
  return Object.freeze({ ...body, quiesce_intent_sha256: clusterSha256(body) });
}

export function validateUatPromotionQuiesceIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "quiesce_operation_id", "promotion_id", "promotion_generation", "created_at",
    "expires_at", "execution_authorization_sha256", "supervisor_bundle_sha256", "parameters",
    "promotion_intent_sha256", "previous_checkpoint_receipt_sha256", "snapshot_operation_id", "snapshot_intent_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "snapshot_writer_capture",
    "quiesce_checked_at", "quiesce_evidence", "writer_quiesce_binding_sha256", "quiesce_intent_sha256",
  ], "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_QUIESCE_INTENT_CONTRACT) {
    reject("UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  }
  identifier(value.quiesce_operation_id, "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  identifier(value.snapshot_operation_id, "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  validateUatPromotionQuiesceParameters(value.parameters);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "snapshot_intent_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256", "quiesce_intent_sha256",
  ]) digest(value[field], "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  validateWriterCapture(value.snapshot_writer_capture);
  iso(value.quiesce_checked_at, "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  validateWriterQuiesceEvidence(value.quiesce_evidence, {
    parameters: value.parameters,
    capture: value.snapshot_writer_capture,
    checkedAt: value.quiesce_checked_at,
  });
  if (value.quiesce_operation_id === value.promotion_id || value.quiesce_operation_id === value.snapshot_operation_id
    || value.promotion_id !== value.parameters.promotion_id
    || value.promotion_generation !== value.parameters.promotion_generation
    || value.created_at !== value.parameters.quiesce_created_at || value.expires_at !== value.parameters.quiesce_expires_at
    || value.execution_authorization_sha256 === value.parameters.promotion_original_authorization_sha256
    || value.promotion_intent_sha256 !== value.parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== value.parameters.previous_checkpoint_receipt_sha256
    || value.snapshot_operation_id !== value.parameters.snapshot_operation_id
    || value.snapshot_intent_sha256 !== value.parameters.snapshot_intent_sha256
    || value.candidate_binding_sha256 !== value.parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== value.parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== value.parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== value.parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== value.parameters.promotion_snapshot_binding_sha256
    || value.snapshot_writer_capture.compose_project !== value.parameters.compose_project
    || value.snapshot_writer_capture.web.container_name !== value.parameters.web_container
    || value.snapshot_writer_capture.web.container_id !== value.parameters.web_container_id
    || value.snapshot_writer_capture.worker.container_name !== value.parameters.worker_container
    || value.snapshot_writer_capture.worker.container_id !== value.parameters.worker_container_id
    || value.quiesce_checked_at !== value.parameters.quiesce_created_at
    || clusterSha256(bodyWithout(value, "quiesce_intent_sha256")) !== value.quiesce_intent_sha256) {
    reject("UAT_PROMOTION_QUIESCE_INTENT_BINDING_INVALID");
  }
  return value;
}

function createMigrationAuthorizationIntent(context, sources) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT,
    migration_authorization_operation_id: context.operation_id,
    execution_scope: "APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE",
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.authorization_created_at,
    expires_at: parameters.authorization_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    quiesce_operation_id: parameters.quiesce_operation_id,
    quiesce_intent_sha256: parameters.quiesce_intent_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: sources.binding,
  };
  return Object.freeze({ ...body, migration_authorization_intent_sha256: clusterSha256(body) });
}

export function validateUatPromotionMigrationAuthorizationIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "migration_authorization_operation_id", "execution_scope", "promotion_id",
    "promotion_generation", "created_at", "expires_at", "execution_authorization_sha256",
    "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256", "previous_checkpoint_receipt_sha256",
    "quiesce_operation_id", "quiesce_intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_authorization_intent_sha256",
  ], "UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT
    || value.execution_scope !== "APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE") {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_INVALID");
  }
  for (const field of ["migration_authorization_operation_id", "promotion_id", "quiesce_operation_id"]) {
    identifier(value[field], "UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_INVALID");
  }
  validateUatPromotionMigrationAuthorizationParameters(value.parameters);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "quiesce_intent_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_authorization_intent_sha256",
  ]) digest(value[field], "UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_INVALID");
  if (value.migration_authorization_operation_id === value.promotion_id
    || value.migration_authorization_operation_id === value.quiesce_operation_id
    || value.promotion_id !== value.parameters.promotion_id
    || value.promotion_generation !== value.parameters.promotion_generation
    || value.created_at !== value.parameters.authorization_created_at
    || value.expires_at !== value.parameters.authorization_expires_at
    || value.promotion_intent_sha256 !== value.parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== value.parameters.previous_checkpoint_receipt_sha256
    || value.quiesce_operation_id !== value.parameters.quiesce_operation_id
    || value.quiesce_intent_sha256 !== value.parameters.quiesce_intent_sha256
    || value.candidate_binding_sha256 !== value.parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== value.parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== value.parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== value.parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== value.parameters.promotion_snapshot_binding_sha256
    || value.writer_quiesce_binding_sha256 !== value.parameters.writer_quiesce_binding_sha256
    || clusterSha256(bodyWithout(value, "migration_authorization_intent_sha256")) !== value.migration_authorization_intent_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_BINDING_INVALID");
  }
  return value;
}

function migrationGrantInput(context, parameters, previous) {
  return {
    execution_scope: "SUPERVISOR_CONTROLLED_UAT_MIGRATION",
    promotion_id: parameters.promotion_id,
    migration_operation_id: context.operation_id,
    execution_authorization_sha256: context.original_authorization_sha256,
    migration_approval_authorization_sha256: parameters.migration_approval_authorization_sha256,
    migration_approval_receipt_sha256: previous.receipt_sha256,
    migration_authorization_binding_sha256: parameters.migration_authorization_binding_sha256,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    release_manifest_sha256: parameters.release_manifest_sha256,
    worker_image: parameters.worker_image,
    migration_manifest_sha256: parameters.migration_manifest_sha256,
    expected_current_head: parameters.expected_current_migration_head,
    target_head: parameters.target_migration_head,
    database: {
      deployment_class: parameters.deployment_class,
      deployment_id: parameters.deployment_id,
      database_name: parameters.database_name,
      database_system_identifier: parameters.database_system_identifier,
      database_oid: parameters.database_oid,
      database_marker: parameters.database_marker,
      migration_role: parameters.migration_role,
      control_role: parameters.control_role,
    },
    created_at: parameters.execution_created_at,
    expires_at: parameters.execution_expires_at,
  };
}

function createMigrationExecutionArtifacts(context, sources) {
  const parameters = context.parameters;
  const grant = createUatPromotionMigrationGrant(migrationGrantInput(context, parameters, sources.previous));
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT,
    execution_scope: "DATABASE_FENCE_AND_EXACT_ALLOWLIST_MIGRATION",
    migration_operation_id: context.operation_id,
    migration_authorization_operation_id: parameters.migration_authorization_operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.execution_created_at,
    expires_at: parameters.execution_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    migration_approval_authorization_sha256: parameters.migration_approval_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    migration_authorization_intent_sha256: parameters.migration_authorization_intent_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: parameters.migration_authorization_binding_sha256,
    grant_sha256: grant.grant_sha256,
  };
  const intent = Object.freeze({ ...body, migration_execution_intent_sha256: clusterSha256(body) });
  return Object.freeze({ intent: validateUatPromotionMigrationExecutionIntent(intent), grant });
}

export function validateUatPromotionMigrationExecutionIntent(value) {
  const code = "UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "migration_operation_id",
    "migration_authorization_operation_id", "promotion_id", "promotion_generation", "created_at", "expires_at",
    "execution_authorization_sha256", "migration_approval_authorization_sha256", "supervisor_bundle_sha256",
    "parameters", "promotion_intent_sha256", "previous_checkpoint_receipt_sha256",
    "migration_authorization_intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256", "grant_sha256",
    "migration_execution_intent_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT
    || value.execution_scope !== "DATABASE_FENCE_AND_EXACT_ALLOWLIST_MIGRATION") reject(code);
  for (const field of ["migration_operation_id", "migration_authorization_operation_id", "promotion_id"]) identifier(value[field], code);
  validateUatPromotionMigrationExecutionParameters(value.parameters);
  for (const field of [
    "execution_authorization_sha256", "migration_approval_authorization_sha256", "supervisor_bundle_sha256",
    "promotion_intent_sha256", "previous_checkpoint_receipt_sha256", "migration_authorization_intent_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256", "grant_sha256",
    "migration_execution_intent_sha256",
  ]) digest(value[field], code);
  const syntheticContext = {
    operation_id: value.migration_operation_id,
    original_authorization_sha256: value.execution_authorization_sha256,
    supervisor_bundle_sha256: value.supervisor_bundle_sha256,
  };
  const previous = { receipt_sha256: value.previous_checkpoint_receipt_sha256 };
  const grant = createUatPromotionMigrationGrant(migrationGrantInput(syntheticContext, value.parameters, previous));
  if (value.migration_operation_id === value.migration_authorization_operation_id
    || value.execution_authorization_sha256 === value.migration_approval_authorization_sha256
    || value.promotion_id !== value.parameters.promotion_id
    || value.promotion_generation !== value.parameters.promotion_generation
    || value.created_at !== value.parameters.execution_created_at || value.expires_at !== value.parameters.execution_expires_at
    || value.migration_authorization_operation_id !== value.parameters.migration_authorization_operation_id
    || value.migration_approval_authorization_sha256 !== value.parameters.migration_approval_authorization_sha256
    || value.promotion_intent_sha256 !== value.parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== value.parameters.previous_checkpoint_receipt_sha256
    || value.migration_authorization_intent_sha256 !== value.parameters.migration_authorization_intent_sha256
    || value.candidate_binding_sha256 !== value.parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== value.parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== value.parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== value.parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== value.parameters.promotion_snapshot_binding_sha256
    || value.writer_quiesce_binding_sha256 !== value.parameters.writer_quiesce_binding_sha256
    || value.migration_authorization_binding_sha256 !== value.parameters.migration_authorization_binding_sha256
    || value.grant_sha256 !== grant.grant_sha256
    || clusterSha256(bodyWithout(value, "migration_execution_intent_sha256")) !== value.migration_execution_intent_sha256) reject(code);
  return value;
}

function createComposeDeploymentIntent(context, sources) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_CONTRACT,
    execution_scope: "EXACT_WEB_WORKER_REPLACEMENT_WITH_PROTECTED_RUNTIME_AND_FENCE_HANDOFF",
    deployment_operation_id: context.operation_id,
    migration_operation_id: parameters.migration_operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.deployment_created_at,
    expires_at: parameters.deployment_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    migration_execution_authorization_sha256: parameters.migration_execution_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    migration_execution_intent_sha256: parameters.migration_execution_intent_sha256,
    migration_grant_sha256: parameters.migration_grant_sha256,
    migration_result_sha256: parameters.migration_result_sha256,
    active_migration_fence_sha256: parameters.active_migration_fence_sha256,
    released_baseline_sha256: sources.activeFence.released_baseline_sha256,
    sealed_database_fence_sha256: sources.migrationResult.fence_after.fence_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: parameters.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: parameters.migration_fence_binding_sha256,
    migration_result_binding_sha256: parameters.migration_result_binding_sha256,
    deployment_plan_sha256: sources.deploymentPlanSha256,
  };
  return Object.freeze(validateUatPromotionComposeDeploymentIntent({
    ...body,
    compose_deployment_intent_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionComposeDeploymentIntent(value) {
  const code = "UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "deployment_operation_id",
    "migration_operation_id", "promotion_id", "promotion_generation", "created_at", "expires_at",
    "execution_authorization_sha256", "migration_execution_authorization_sha256",
    "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "migration_execution_intent_sha256",
    "migration_grant_sha256", "migration_result_sha256", "active_migration_fence_sha256",
    "released_baseline_sha256", "sealed_database_fence_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256",
    "deployment_plan_sha256", "compose_deployment_intent_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_CONTRACT
    || value.execution_scope !== "EXACT_WEB_WORKER_REPLACEMENT_WITH_PROTECTED_RUNTIME_AND_FENCE_HANDOFF") reject(code);
  for (const field of ["deployment_operation_id", "migration_operation_id", "promotion_id"]) identifier(value[field], code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  validateUatPromotionComposeDeploymentParameters(value.parameters);
  for (const field of [
    "execution_authorization_sha256", "migration_execution_authorization_sha256",
    "supervisor_bundle_sha256", "promotion_intent_sha256", "previous_checkpoint_receipt_sha256",
    "migration_execution_intent_sha256", "migration_grant_sha256", "migration_result_sha256",
    "active_migration_fence_sha256", "released_baseline_sha256", "sealed_database_fence_sha256",
    "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "deployment_plan_sha256", "compose_deployment_intent_sha256",
  ]) digest(value[field], code);
  iso(value.created_at, code);
  iso(value.expires_at, code);
  const parameters = value.parameters;
  if (value.deployment_operation_id === value.migration_operation_id
    || value.execution_authorization_sha256 === value.migration_execution_authorization_sha256
    || value.promotion_id !== parameters.promotion_id
    || value.promotion_generation !== parameters.promotion_generation
    || value.created_at !== parameters.deployment_created_at || value.expires_at !== parameters.deployment_expires_at
    || value.migration_operation_id !== parameters.migration_operation_id
    || value.migration_execution_authorization_sha256 !== parameters.migration_execution_authorization_sha256
    || value.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || value.migration_execution_intent_sha256 !== parameters.migration_execution_intent_sha256
    || value.migration_grant_sha256 !== parameters.migration_grant_sha256
    || value.migration_result_sha256 !== parameters.migration_result_sha256
    || value.active_migration_fence_sha256 !== parameters.active_migration_fence_sha256
    || value.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || value.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || value.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || value.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || value.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || clusterSha256(bodyWithout(value, "compose_deployment_intent_sha256")) !== value.compose_deployment_intent_sha256) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_BINDING_INVALID");
  }
  return value;
}

function postdeployPlanBinding(parameters, operation, extra = {}) {
  return clusterSha256({
    operation,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    deployment_operation_id: parameters.deployment_operation_id,
    deployment_result_sha256: parameters.deployment_result_sha256,
    fence_transfer_sha256: parameters.fence_transfer_sha256,
    compose_deployment_binding_sha256: parameters.compose_deployment_binding_sha256,
    release_manifest_sha256: parameters.release_manifest_sha256,
    compose_project_root_sha256: sha256(Buffer.from(parameters.compose_project_root, "utf8")),
    runtime_policy_sha256: parameters.runtime_policy_sha256,
    selectors: {
      caddy: parameters.caddy_container, postgres: parameters.postgres_container,
      web: parameters.web_container, worker: parameters.worker_container,
    },
    ...extra,
  });
}

function createPostdeployRuntimeIntent(context, sources) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT,
    execution_scope: "FRESH_FOUR_SERVICE_RUNTIME_CONFIGURATION_PROBE_ONLY",
    verification_operation_id: context.operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.verification_created_at,
    expires_at: parameters.verification_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    deployment_operation_id: parameters.deployment_operation_id,
    deployment_result_sha256: parameters.deployment_result_sha256,
    fence_transfer_sha256: parameters.fence_transfer_sha256,
    runtime_configuration_sha256: sources.deploymentResult.runtime_configuration_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: parameters.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: parameters.migration_fence_binding_sha256,
    migration_result_binding_sha256: parameters.migration_result_binding_sha256,
    compose_deployment_binding_sha256: parameters.compose_deployment_binding_sha256,
    verification_plan_sha256: postdeployPlanBinding(parameters, "POSTDEPLOY_RUNTIME_CONFIGURATION", {
      probe_id: parameters.probe_id,
      probe_path: `${parameters.probe_root}/${parameters.probe_id}.runtime-configuration-probe.json`,
      runtime_configuration_sha256: sources.deploymentResult.runtime_configuration_sha256,
    }),
  };
  return Object.freeze(validateUatPromotionPostdeployRuntimeIntent({
    ...body, postdeploy_runtime_intent_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionPostdeployRuntimeIntent(value) {
  const code = "UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "verification_operation_id", "promotion_id",
    "promotion_generation", "created_at", "expires_at", "execution_authorization_sha256",
    "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "deployment_operation_id", "deployment_result_sha256",
    "fence_transfer_sha256", "runtime_configuration_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "compose_deployment_binding_sha256",
    "verification_plan_sha256", "postdeploy_runtime_intent_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT
    || value.execution_scope !== "FRESH_FOUR_SERVICE_RUNTIME_CONFIGURATION_PROBE_ONLY") reject(code);
  validateUatPromotionPostdeployRuntimeParameters(value.parameters);
  for (const field of ["verification_operation_id", "promotion_id", "deployment_operation_id"]) identifier(value[field], code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  iso(value.created_at, code); iso(value.expires_at, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "deployment_result_sha256", "fence_transfer_sha256",
    "runtime_configuration_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256",
    "compose_deployment_binding_sha256", "verification_plan_sha256", "postdeploy_runtime_intent_sha256",
  ]) digest(value[field], code);
  const parameters = value.parameters;
  if (value.verification_operation_id !== parameters.probe_id
    || value.promotion_id !== parameters.promotion_id
    || value.promotion_generation !== parameters.promotion_generation
    || value.created_at !== parameters.verification_created_at || value.expires_at !== parameters.verification_expires_at
    || value.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || value.deployment_operation_id !== parameters.deployment_operation_id
    || value.deployment_result_sha256 !== parameters.deployment_result_sha256
    || value.fence_transfer_sha256 !== parameters.fence_transfer_sha256
    || value.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || value.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || value.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || value.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || value.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || value.compose_deployment_binding_sha256 !== parameters.compose_deployment_binding_sha256
    || value.verification_plan_sha256 !== postdeployPlanBinding(parameters, "POSTDEPLOY_RUNTIME_CONFIGURATION", {
      probe_id: parameters.probe_id,
      probe_path: `${parameters.probe_root}/${parameters.probe_id}.runtime-configuration-probe.json`,
      runtime_configuration_sha256: value.runtime_configuration_sha256,
    })
    || clusterSha256(bodyWithout(value, "postdeploy_runtime_intent_sha256")) !== value.postdeploy_runtime_intent_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_BINDING_INVALID");
  }
  return value;
}

function createPostdeployIdentityIntent(context, sources) {
  const parameters = context.parameters;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_CONTRACT,
    execution_scope: "POSTDEPLOY_RECEIPT_AND_RELEASE_IDENTITY_PUBLICATION_ONLY",
    verification_operation_id: context.operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.verification_created_at,
    expires_at: parameters.verification_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    deployment_operation_id: parameters.deployment_operation_id,
    deployment_result_sha256: parameters.deployment_result_sha256,
    fence_transfer_sha256: parameters.fence_transfer_sha256,
    runtime_probe_operation_id: parameters.runtime_probe_operation_id,
    runtime_probe_intent_sha256: parameters.runtime_probe_intent_sha256,
    runtime_probe_result_sha256: parameters.runtime_probe_result_sha256,
    runtime_configuration_sha256: sources.runtimeProbe.runtime_configuration_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: parameters.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: parameters.migration_fence_binding_sha256,
    migration_result_binding_sha256: parameters.migration_result_binding_sha256,
    compose_deployment_binding_sha256: parameters.compose_deployment_binding_sha256,
    verification_plan_sha256: postdeployPlanBinding(parameters, "POSTDEPLOY_IDENTITY", {
      runtime_probe_operation_id: parameters.runtime_probe_operation_id,
      runtime_probe_intent_sha256: parameters.runtime_probe_intent_sha256,
      runtime_probe_result_sha256: parameters.runtime_probe_result_sha256,
      runtime_configuration_sha256: sources.runtimeProbe.runtime_configuration_sha256,
      postdeploy_receipt_path: `${parameters.postdeploy_root}/${parameters.run_id}.postdeploy-receipt.json`,
      release_identity_path: RELEASE_IDENTITY_FILE,
    }),
  };
  return Object.freeze(validateUatPromotionPostdeployIdentityIntent({
    ...body, postdeploy_identity_intent_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionPostdeployIdentityIntent(value) {
  const code = "UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "verification_operation_id", "promotion_id",
    "promotion_generation", "created_at", "expires_at", "execution_authorization_sha256",
    "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "deployment_operation_id", "deployment_result_sha256",
    "fence_transfer_sha256", "runtime_probe_operation_id", "runtime_probe_intent_sha256",
    "runtime_probe_result_sha256", "runtime_configuration_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "compose_deployment_binding_sha256",
    "verification_plan_sha256", "postdeploy_identity_intent_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_CONTRACT
    || value.execution_scope !== "POSTDEPLOY_RECEIPT_AND_RELEASE_IDENTITY_PUBLICATION_ONLY") reject(code);
  validateUatPromotionPostdeployIdentityParameters(value.parameters);
  for (const field of [
    "verification_operation_id", "promotion_id", "deployment_operation_id", "runtime_probe_operation_id",
  ]) identifier(value[field], code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  iso(value.created_at, code); iso(value.expires_at, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "deployment_result_sha256", "fence_transfer_sha256",
    "runtime_probe_intent_sha256", "runtime_probe_result_sha256", "runtime_configuration_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256",
    "compose_deployment_binding_sha256", "verification_plan_sha256", "postdeploy_identity_intent_sha256",
  ]) digest(value[field], code);
  const parameters = value.parameters;
  if (value.verification_operation_id !== parameters.run_id || value.promotion_id !== parameters.promotion_id
    || value.promotion_generation !== parameters.promotion_generation
    || value.created_at !== parameters.verification_created_at || value.expires_at !== parameters.verification_expires_at
    || value.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || value.deployment_operation_id !== parameters.deployment_operation_id
    || value.deployment_result_sha256 !== parameters.deployment_result_sha256
    || value.fence_transfer_sha256 !== parameters.fence_transfer_sha256
    || value.runtime_probe_operation_id !== parameters.runtime_probe_operation_id
    || value.runtime_probe_intent_sha256 !== parameters.runtime_probe_intent_sha256
    || value.runtime_probe_result_sha256 !== parameters.runtime_probe_result_sha256
    || value.runtime_configuration_sha256 !== parameters.runtime_configuration_sha256
    || value.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || value.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || value.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || value.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || value.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || value.compose_deployment_binding_sha256 !== parameters.compose_deployment_binding_sha256
    || value.verification_plan_sha256 !== postdeployPlanBinding(parameters, "POSTDEPLOY_IDENTITY", {
      runtime_probe_operation_id: parameters.runtime_probe_operation_id,
      runtime_probe_intent_sha256: parameters.runtime_probe_intent_sha256,
      runtime_probe_result_sha256: parameters.runtime_probe_result_sha256,
      runtime_configuration_sha256: value.runtime_configuration_sha256,
      postdeploy_receipt_path: `${parameters.postdeploy_root}/${parameters.run_id}.postdeploy-receipt.json`,
      release_identity_path: RELEASE_IDENTITY_FILE,
    })
    || clusterSha256(bodyWithout(value, "postdeploy_identity_intent_sha256")) !== value.postdeploy_identity_intent_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_BINDING_INVALID");
  }
  return value;
}

function crossRolePlanBinding(parameters, result) {
  return clusterSha256({
    operation: "CROSS_ROLE_UAT",
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    postdeploy_identity_operation_id: parameters.postdeploy_identity_operation_id,
    postdeploy_identity_intent_sha256: parameters.postdeploy_identity_intent_sha256,
    postdeploy_identity_evidence_sha256: parameters.postdeploy_identity_evidence_sha256,
    release_identity_sha256: parameters.release_identity_sha256,
    cross_role_contract_file_sha256: parameters.cross_role_contract_file_sha256,
    cross_role_contract_artifact_sha256: parameters.cross_role_contract_artifact_sha256,
    authorization_matrix_artifact_sha256: parameters.authorization_matrix_artifact_sha256,
    authorization_matrix_source_manifest_sha256: parameters.authorization_matrix_source_manifest_sha256,
    cross_role_result_file_sha256: parameters.cross_role_result_file_sha256,
    cross_role_result_sha256: result.result_sha256,
    result_id: result.result_id,
  });
}

function createCrossRoleIntent(context, sources) {
  const parameters = context.parameters;
  const result = sources.result;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_CROSS_ROLE_INTENT_CONTRACT,
    execution_scope: "PREEXISTING_HUMAN_UAT_EVIDENCE_INGEST_ONLY",
    verification_operation_id: context.operation_id,
    promotion_id: parameters.promotion_id,
    promotion_generation: parameters.promotion_generation,
    created_at: parameters.verification_created_at,
    expires_at: parameters.verification_expires_at,
    execution_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters,
    promotion_intent_sha256: parameters.promotion_intent_sha256,
    previous_checkpoint_receipt_sha256: parameters.previous_checkpoint_receipt_sha256,
    postdeploy_identity_operation_id: parameters.postdeploy_identity_operation_id,
    postdeploy_identity_intent_sha256: parameters.postdeploy_identity_intent_sha256,
    postdeploy_identity_evidence_sha256: parameters.postdeploy_identity_evidence_sha256,
    release_identity_sha256: parameters.release_identity_sha256,
    candidate_binding_sha256: parameters.candidate_binding_sha256,
    database_binding_sha256: parameters.database_binding_sha256,
    runtime_binding_sha256: parameters.runtime_binding_sha256,
    preupgrade_recovery_binding_sha256: parameters.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: parameters.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: parameters.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: parameters.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: parameters.migration_fence_binding_sha256,
    migration_result_binding_sha256: parameters.migration_result_binding_sha256,
    compose_deployment_binding_sha256: parameters.compose_deployment_binding_sha256,
    cross_role_contract_file_sha256: parameters.cross_role_contract_file_sha256,
    cross_role_contract_artifact_sha256: parameters.cross_role_contract_artifact_sha256,
    authorization_matrix_artifact_sha256: parameters.authorization_matrix_artifact_sha256,
    authorization_matrix_source_manifest_sha256: parameters.authorization_matrix_source_manifest_sha256,
    cross_role_result_file_sha256: parameters.cross_role_result_file_sha256,
    cross_role_result_sha256: result.result_sha256,
    verification_plan_sha256: crossRolePlanBinding(parameters, result),
  };
  return Object.freeze(validateUatPromotionCrossRoleIntent({
    ...body, cross_role_intent_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionCrossRoleIntent(value) {
  const code = "UAT_PROMOTION_CROSS_ROLE_INTENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "execution_scope", "verification_operation_id", "promotion_id",
    "promotion_generation", "created_at", "expires_at", "execution_authorization_sha256",
    "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "postdeploy_identity_operation_id",
    "postdeploy_identity_intent_sha256", "postdeploy_identity_evidence_sha256",
    "release_identity_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "compose_deployment_binding_sha256",
    "cross_role_contract_file_sha256", "cross_role_contract_artifact_sha256",
    "authorization_matrix_artifact_sha256", "authorization_matrix_source_manifest_sha256",
    "cross_role_result_file_sha256", "cross_role_result_sha256", "verification_plan_sha256",
    "cross_role_intent_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_CROSS_ROLE_INTENT_CONTRACT
    || value.execution_scope !== "PREEXISTING_HUMAN_UAT_EVIDENCE_INGEST_ONLY") reject(code);
  validateUatPromotionCrossRoleParameters(value.parameters);
  for (const field of ["verification_operation_id", "promotion_id", "postdeploy_identity_operation_id"]) {
    identifier(value[field], code);
  }
  integer(value.promotion_generation, 1, 1_000_000, code);
  iso(value.created_at, code); iso(value.expires_at, code);
  for (const field of [
    "execution_authorization_sha256", "supervisor_bundle_sha256", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "postdeploy_identity_intent_sha256",
    "postdeploy_identity_evidence_sha256", "release_identity_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "compose_deployment_binding_sha256",
    "cross_role_contract_file_sha256", "cross_role_contract_artifact_sha256",
    "authorization_matrix_artifact_sha256", "authorization_matrix_source_manifest_sha256",
    "cross_role_result_file_sha256", "cross_role_result_sha256", "verification_plan_sha256",
    "cross_role_intent_sha256",
  ]) digest(value[field], code);
  const parameters = value.parameters;
  if (value.verification_operation_id !== parameters.result_id
    || value.promotion_id !== parameters.promotion_id
    || value.promotion_generation !== parameters.promotion_generation
    || value.created_at !== parameters.verification_created_at
    || value.expires_at !== parameters.verification_expires_at
    || value.promotion_intent_sha256 !== parameters.promotion_intent_sha256
    || value.previous_checkpoint_receipt_sha256 !== parameters.previous_checkpoint_receipt_sha256
    || value.postdeploy_identity_operation_id !== parameters.postdeploy_identity_operation_id
    || value.postdeploy_identity_intent_sha256 !== parameters.postdeploy_identity_intent_sha256
    || value.postdeploy_identity_evidence_sha256 !== parameters.postdeploy_identity_evidence_sha256
    || value.release_identity_sha256 !== parameters.release_identity_sha256
    || value.candidate_binding_sha256 !== parameters.candidate_binding_sha256
    || value.database_binding_sha256 !== parameters.database_binding_sha256
    || value.runtime_binding_sha256 !== parameters.runtime_binding_sha256
    || value.preupgrade_recovery_binding_sha256 !== parameters.preupgrade_recovery_binding_sha256
    || value.promotion_snapshot_binding_sha256 !== parameters.promotion_snapshot_binding_sha256
    || value.writer_quiesce_binding_sha256 !== parameters.writer_quiesce_binding_sha256
    || value.migration_authorization_binding_sha256 !== parameters.migration_authorization_binding_sha256
    || value.migration_fence_binding_sha256 !== parameters.migration_fence_binding_sha256
    || value.migration_result_binding_sha256 !== parameters.migration_result_binding_sha256
    || value.compose_deployment_binding_sha256 !== parameters.compose_deployment_binding_sha256
    || value.cross_role_contract_file_sha256 !== parameters.cross_role_contract_file_sha256
    || value.cross_role_contract_artifact_sha256 !== parameters.cross_role_contract_artifact_sha256
    || value.authorization_matrix_artifact_sha256 !== parameters.authorization_matrix_artifact_sha256
    || value.authorization_matrix_source_manifest_sha256 !== parameters.authorization_matrix_source_manifest_sha256
    || value.cross_role_result_file_sha256 !== parameters.cross_role_result_file_sha256
    || value.cross_role_result_sha256 !== parameters.cross_role_result_sha256
    || value.verification_plan_sha256 !== crossRolePlanBinding(parameters, {
      result_sha256: value.cross_role_result_sha256, result_id: parameters.result_id,
    })
    || clusterSha256(bodyWithout(value, "cross_role_intent_sha256")) !== value.cross_role_intent_sha256) {
    reject("UAT_PROMOTION_CROSS_ROLE_INTENT_BINDING_INVALID");
  }
  return value;
}

function intentFile(paths, intent) { return path.join(paths.intents, `${intent.promotion_id}.${intent.intent_sha256}.json`); }
function snapshotIntentFile(paths, intent) { return path.join(paths.intents, `${intent.snapshot_operation_id}.${intent.snapshot_intent_sha256}.json`); }
function quiesceIntentFile(paths, intent) { return path.join(paths.intents, `${intent.quiesce_operation_id}.${intent.quiesce_intent_sha256}.json`); }
function migrationAuthorizationIntentFile(paths, intent) {
  return path.join(paths.intents, `${intent.migration_authorization_operation_id}.${intent.migration_authorization_intent_sha256}.json`);
}
function migrationExecutionIntentFile(paths, intent) {
  return path.join(paths.intents, `${intent.migration_operation_id}.${intent.migration_execution_intent_sha256}.json`);
}
function composeDeploymentIntentFile(paths, intent) {
  return path.join(paths.intents, `${intent.deployment_operation_id}.${intent.compose_deployment_intent_sha256}.json`);
}
function postdeployRuntimeIntentFile(paths, intent) {
  return path.join(paths.intents, `${intent.verification_operation_id}.${intent.postdeploy_runtime_intent_sha256}.json`);
}
function postdeployIdentityIntentFile(paths, intent) {
  return path.join(paths.intents, `${intent.verification_operation_id}.${intent.postdeploy_identity_intent_sha256}.json`);
}
function crossRoleIntentFile(paths, intent) {
  return path.join(paths.intents, `${intent.verification_operation_id}.${intent.cross_role_intent_sha256}.json`);
}
function migrationGrantFile(paths, operationId, grantSha256) {
  return path.join(paths.grants, `${operationId}.${grantSha256}.json`);
}
function generationName(intent) { return `${String(intent.promotion_generation).padStart(16, "0")}.${intent.intent_sha256}.json`; }
function receiptName(receipt) { return `${String(receipt.promotion_generation).padStart(16, "0")}.${String(receipt.journal_sequence).padStart(2, "0")}.${receipt.receipt_sha256}.json`; }
function generationFile(paths, intent) { return path.join(paths.generations, generationName(intent)); }
function historyFile(paths, receipt) { return path.join(paths.history, receiptName(receipt)); }
function receiptFile(paths, receipt) { return path.join(paths.receipts, receiptName(receipt)); }

async function committedChain(paths, allowed = {}) {
  const allowedGenerations = allowed.generations ?? new Set();
  const allowedHistory = allowed.history ?? new Set();
  const allowedReceipts = allowed.receipts ?? new Set();
  const current = await trustedJsonFile(paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID");
  const generationNames = await strictNames(paths.generations, /^[0-9]{16}\.[0-9a-f]{64}\.json$/u, allowedGenerations, "UAT_PROMOTION_GENERATIONS_INVALID");
  const historyNames = await strictNames(paths.history, /^[0-9]{16}\.[0-9]{2}\.[0-9a-f]{64}\.json$/u, allowedHistory, "UAT_PROMOTION_HISTORY_INVALID");
  const receiptNames = await strictNames(paths.receipts, /^[0-9]{16}\.[0-9]{2}\.[0-9a-f]{64}\.json$/u, allowedReceipts, "UAT_PROMOTION_RECEIPTS_INVALID");
  if (!same(historyNames, receiptNames)) reject("UAT_PROMOTION_HISTORY_RECEIPT_MISMATCH");
  if (current === null) {
    if (generationNames.length !== 0 || historyNames.length !== 0) reject("UAT_PROMOTION_BOOTSTRAP_STATE_INVALID");
    return Object.freeze({ current: null, intents: [], receipts: [] });
  }
  if (generationNames.length < 1 || historyNames.length < generationNames.length) reject("UAT_PROMOTION_CHAIN_INVALID");
  const intents = [];
  for (let index = 0; index < generationNames.length; index += 1) {
    const generation = index + 1;
    const stored = await trustedJsonFile(path.join(paths.generations, generationNames[index]), 0o400, validateUatPromotionIntent, "UAT_PROMOTION_GENERATION_INVALID");
    if (!stored || stored.value.promotion_generation !== generation || generationNames[index] !== generationName(stored.value)) reject("UAT_PROMOTION_GENERATION_INVALID");
    intents.push(stored);
  }
  const receipts = [];
  for (let index = 0; index < receiptNames.length; index += 1) {
    const history = await trustedJsonFile(path.join(paths.history, historyNames[index]), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID");
    const receipt = await trustedJsonFile(path.join(paths.receipts, receiptNames[index]), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID");
    if (!history || !receipt || !history.raw.equals(receipt.raw) || receiptNames[index] !== receiptName(receipt.value)) reject("UAT_PROMOTION_HISTORY_RECEIPT_MISMATCH");
    const intent = intents[receipt.value.promotion_generation - 1]?.value;
    if (!intent || receipt.value.promotion_id !== intent.promotion_id || receipt.value.intent_sha256 !== intent.intent_sha256
      || receipt.value.candidate_binding_sha256 !== intent.candidate_binding_sha256
      || receipt.value.database_binding_sha256 !== intent.database_binding_sha256
      || receipt.value.runtime_binding_sha256 !== intent.runtime_binding_sha256
      || receipt.value.recovery_binding_sha256 !== intent.recovery_binding_sha256
      || receipt.value.original_authorization_sha256 !== intent.original_authorization_sha256) reject("UAT_PROMOTION_RECEIPT_INTENT_MISMATCH");
    const sameGeneration = receipts.filter((entry) => entry.value.promotion_generation === receipt.value.promotion_generation);
    if (sameGeneration.length === 0) {
      const priorGeneration = receipts.at(-1)?.value ?? null;
      if (receipt.value.journal_sequence !== 1 || receipt.value.checkpoint_ordinal !== 4
        || receipt.value.previous_checkpoint_receipt_sha256 !== ZERO_SHA256
        || receipt.value.previous_promotion_receipt_sha256 !== (priorGeneration?.receipt_sha256 ?? ZERO_SHA256)
        || receipt.value.checkpoint_evidence_sha256 !== intent.intent_sha256
        || priorGeneration !== null && !new Set(["COMMITTED", "ROLLED_BACK"]).has(priorGeneration.journal_status)) reject("UAT_PROMOTION_GENERATION_CHAIN_INVALID");
    } else {
      const previous = sameGeneration.at(-1).value;
      if (receipt.value.journal_sequence !== previous.journal_sequence + 1
        || receipt.value.checkpoint_ordinal !== previous.checkpoint_ordinal + 1
        || receipt.value.previous_checkpoint_receipt_sha256 !== previous.receipt_sha256
        || receipt.value.previous_promotion_receipt_sha256 !== previous.previous_promotion_receipt_sha256
        || receipt.value.promotion_snapshot_binding_sha256 !== previous.promotion_snapshot_binding_sha256
          && receipt.value.checkpoint_ordinal !== 5
      || receipt.value.writer_quiesce_binding_sha256 !== previous.writer_quiesce_binding_sha256
          && receipt.value.checkpoint_ordinal !== 6
        || receipt.value.migration_authorization_binding_sha256 !== previous.migration_authorization_binding_sha256
          && receipt.value.checkpoint_ordinal !== 7) reject("UAT_PROMOTION_CHECKPOINT_CHAIN_INVALID");
    }
    receipts.push(receipt);
  }
  if (intents.some((intent) => !receipts.some((receipt) => receipt.value.intent_sha256 === intent.value.intent_sha256))
    || !current.raw.equals(receipts.at(-1)?.raw ?? Buffer.alloc(0))) reject("UAT_PROMOTION_CURRENT_INVALID");
  return Object.freeze({ current, intents, receipts });
}

function stagedNames(intent, receipt) {
  return Object.freeze({ generation: generationName(intent), history: receiptName(receipt), receipt: receiptName(receipt) });
}

async function candidateState(paths, intent, receipt) {
  const names = stagedNames(intent, receipt);
  const intentRaw = Buffer.from(canonicalClusterJson(intent));
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID");
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (!chain.intents.at(-1)?.raw.equals(intentRaw)) reject("UAT_PROMOTION_COMMITTED_STATE_MISMATCH");
    return Object.freeze({ committed: true, generation: true, history: true, receipt: true, current: true, intentRaw, receiptRaw, chain });
  }
  const chain = await committedChain(paths, {
    generations: new Set([names.generation]), history: new Set([names.history]), receipts: new Set([names.receipt]),
  });
  const previous = chain.current?.value ?? null;
  if (intent.promotion_generation !== (previous?.promotion_generation ?? 0) + 1
    || intent.parameters.previous_promotion_receipt_sha256 !== (previous?.receipt_sha256 ?? ZERO_SHA256)) reject("UAT_PROMOTION_GENERATION_MISMATCH");
  const generation = await trustedJsonFile(generationFile(paths, intent), 0o400, validateUatPromotionIntent, "UAT_PROMOTION_GENERATION_INVALID");
  const history = await trustedJsonFile(historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID");
  const storedReceipt = await trustedJsonFile(receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID");
  const generationDone = generation?.raw.equals(intentRaw) ?? false;
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (generation !== null && !generationDone || history !== null && !historyDone || storedReceipt !== null && !receiptDone) reject("UAT_PROMOTION_PUBLICATION_CONFLICT");
  if (historyDone && !generationDone || receiptDone && (!generationDone || !historyDone)) reject("UAT_PROMOTION_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, generation: generationDone, history: historyDone, receipt: receiptDone, current: false, intentRaw, receiptRaw, chain });
}

async function prepareOriginal(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, true);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  await verifyAuthorizedSources(context, options.filesystemRoot);
  const intent = createIntent(context);
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, intent.promotion_id));
  if (matches.length > 1 || matches.length === 1 && matches[0] !== path.basename(intentFile(paths, intent))) reject("UAT_PROMOTION_INTENT_ID_REUSED");
  if (matches.length === 1) {
    const existing = await trustedJsonFile(intentFile(paths, intent), 0o400, validateUatPromotionIntent, "UAT_PROMOTION_INTENT_INVALID");
    if (!existing?.raw.equals(Buffer.from(canonicalClusterJson(intent)))) reject("UAT_PROMOTION_INTENT_CONFLICT");
    const receipt = createInitialReceipt(context, intent);
    return Object.freeze({ result: "ALREADY_PREPARED", promotion_id: intent.promotion_id, intent_sha256: intent.intent_sha256, receipt_sha256: receipt.receipt_sha256 });
  }
  const chain = await committedChain(paths);
  const expectedGeneration = (chain.current?.value.promotion_generation ?? 0) + 1;
  const expectedPrevious = chain.current?.value.receipt_sha256 ?? ZERO_SHA256;
  if (context.parameters.promotion_generation !== expectedGeneration
    || context.parameters.previous_promotion_receipt_sha256 !== expectedPrevious
    || chain.current !== null && !new Set(["COMMITTED", "ROLLED_BACK"]).has(chain.current.value.journal_status)) reject("UAT_PROMOTION_GENERATION_MISMATCH");
  const raw = Buffer.from(canonicalClusterJson(intent));
  await ensureRawFile(intentFile(paths, intent), raw, 0o400, validateUatPromotionIntent, "UAT_PROMOTION_INTENT_CONFLICT");
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  const receipt = createInitialReceipt(context, intent);
  return Object.freeze({
    result: "PREPARED",
    promotion_id: intent.promotion_id,
    intent_sha256: intent.intent_sha256,
    receipt_sha256: receipt.receipt_sha256,
  });
}

async function loadIntent(context, paths, allowInvalid = false) {
  const expected = createIntent(context);
  if (context.expected_intent_sha256 !== null && context.expected_intent_sha256 !== expected.intent_sha256) reject("UAT_PROMOTION_INTENT_BINDING_INVALID");
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1 || matches[0] !== path.basename(intentFile(paths, expected))) reject("UAT_PROMOTION_INTENT_MISSING");
  const stored = await trustedJsonFile(path.join(paths.intents, matches[0]), 0o400, validateUatPromotionIntent, "UAT_PROMOTION_INTENT_INVALID");
  if (!stored || !stored.raw.equals(Buffer.from(canonicalClusterJson(expected)))) reject("UAT_PROMOTION_INTENT_BINDING_INVALID");
  return allowInvalid ? Object.freeze({ expected, stored }) : stored.value;
}

async function commitIntent(context, intent, paths, options) {
  const receipt = createInitialReceipt(context, intent);
  let state = await candidateState(paths, intent, receipt);
  if (state.committed) return Object.freeze({ result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id, intent_sha256: intent.intent_sha256, receipt_sha256: receipt.receipt_sha256 });
  if (!state.generation) {
    await ensureRawFile(generationFile(paths, intent), state.intentRaw, 0o400, validateUatPromotionIntent, "UAT_PROMOTION_GENERATION_CONFLICT");
    await syncDirectory(paths.generations, "UAT_PROMOTION_GENERATION_SYNC_FAILED");
    await options.fault?.("AFTER_GENERATION");
  }
  state = await candidateState(paths, intent, receipt);
  if (!state.history) {
    await ensureRawFile(historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_CONFLICT");
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_HISTORY");
  }
  state = await candidateState(paths, intent, receipt);
  if (!state.receipt) {
    await ensureRawFile(receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_CONFLICT");
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_RECEIPT");
  }
  state = await candidateState(paths, intent, receipt);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${intent.promotion_id}.${receipt.receipt_sha256}.tmp`);
    await atomicAlias(paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION");
    await options.fault?.("AFTER_CURRENT");
  }
  state = await candidateState(paths, intent, receipt);
  if (!state.committed) reject("UAT_PROMOTION_COMMIT_INCOMPLETE");
  return Object.freeze({ result: "COMMITTED", promotion_id: intent.promotion_id, intent_sha256: intent.intent_sha256, receipt_sha256: receipt.receipt_sha256 });
}

function createSnapshotCheckpointReceipt(context, snapshotIntent, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: snapshotIntent.snapshot_recorded_at,
    checkpoint_evidence_sha256: snapshotIntent.promotion_snapshot_binding_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: snapshotIntent.promotion_intent_sha256,
    candidate_binding_sha256: snapshotIntent.candidate_binding_sha256,
    database_binding_sha256: snapshotIntent.database_binding_sha256,
    runtime_binding_sha256: snapshotIntent.runtime_binding_sha256,
    recovery_binding_sha256: snapshotIntent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: snapshotIntent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: ZERO_SHA256,
    migration_authorization_binding_sha256: ZERO_SHA256,
    migration_fence_binding_sha256: ZERO_SHA256,
    migration_result_binding_sha256: ZERO_SHA256,
    compose_deployment_binding_sha256: ZERO_SHA256,
  });
}

async function checkpointCandidateState(paths, snapshotIntent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID");
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) reject("UAT_PROMOTION_SNAPSHOT_COMMITTED_STATE_MISMATCH");
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== snapshotIntent.promotion_intent_sha256
    || chain.current.value.checkpoint_ordinal !== 4) reject("UAT_PROMOTION_SNAPSHOT_PREVIOUS_CHANGED");
  const history = await trustedJsonFile(historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID");
  const storedReceipt = await trustedJsonFile(receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID");
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) reject("UAT_PROMOTION_SNAPSHOT_PUBLICATION_CONFLICT");
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_SNAPSHOT_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

async function prepareSnapshot(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  const sources = await verifySnapshotAuthorizedSources(context, options.filesystemRoot, options);
  const intent = createSnapshotIntent(context, sources);
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length > 1 || matches.length === 1 && matches[0] !== path.basename(snapshotIntentFile(paths, intent))) {
    reject("UAT_PROMOTION_SNAPSHOT_OPERATION_ID_REUSED");
  }
  const receipt = createSnapshotCheckpointReceipt(context, intent, sources.previous);
  await checkpointCandidateState(paths, intent, sources.previous, receipt);
  const raw = Buffer.from(canonicalClusterJson(intent));
  if (matches.length === 1) {
    const existing = await trustedJsonFile(snapshotIntentFile(paths, intent), 0o400, validateUatPromotionSnapshotIntent, "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
    if (!existing?.raw.equals(raw)) reject("UAT_PROMOTION_SNAPSHOT_INTENT_CONFLICT");
    return Object.freeze({ result: "ALREADY_PREPARED", promotion_id: intent.promotion_id, intent_sha256: intent.snapshot_intent_sha256, receipt_sha256: receipt.receipt_sha256 });
  }
  await ensureRawFile(snapshotIntentFile(paths, intent), raw, 0o400, validateUatPromotionSnapshotIntent, "UAT_PROMOTION_SNAPSHOT_INTENT_CONFLICT");
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  return Object.freeze({ result: "PREPARED", promotion_id: intent.promotion_id, intent_sha256: intent.snapshot_intent_sha256, receipt_sha256: receipt.receipt_sha256 });
}

async function loadStoredSnapshotIntent(context, paths) {
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1 || !matches[0].endsWith(`.${context.expected_intent_sha256}.json`)) reject("UAT_PROMOTION_SNAPSHOT_INTENT_MISSING");
  const stored = await trustedJsonFile(path.join(paths.intents, matches[0]), 0o400, validateUatPromotionSnapshotIntent, "UAT_PROMOTION_SNAPSHOT_INTENT_INVALID");
  if (!stored || stored.value.snapshot_intent_sha256 !== context.expected_intent_sha256
    || stored.value.snapshot_operation_id !== context.operation_id
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadSnapshotIntent(context, paths, sources) {
  const expected = createSnapshotIntent(context, sources);
  if (context.expected_intent_sha256 !== null && context.expected_intent_sha256 !== expected.snapshot_intent_sha256) {
    reject("UAT_PROMOTION_SNAPSHOT_INTENT_BINDING_INVALID");
  }
  const stored = await loadStoredSnapshotIntent({ ...context, expected_intent_sha256: expected.snapshot_intent_sha256 }, paths);
  if (canonicalClusterJson(stored) !== canonicalClusterJson(expected)) reject("UAT_PROMOTION_SNAPSHOT_INTENT_BINDING_INVALID");
  return stored;
}

async function commitSnapshot(context, intent, sources, paths, options) {
  const receipt = createSnapshotCheckpointReceipt(context, intent, sources.previous);
  let state = await checkpointCandidateState(paths, intent, sources.previous, receipt);
  if (state.committed) return Object.freeze({ result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id, intent_sha256: intent.snapshot_intent_sha256, receipt_sha256: receipt.receipt_sha256 });
  if (!state.history) {
    await ensureRawFile(historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_CONFLICT");
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_SNAPSHOT_HISTORY");
  }
  state = await checkpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_CONFLICT");
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_SNAPSHOT_RECEIPT");
  }
  state = await checkpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${intent.snapshot_operation_id}.${receipt.receipt_sha256}.tmp`);
    await atomicAlias(paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION");
    await options.fault?.("AFTER_SNAPSHOT_CURRENT");
  }
  state = await checkpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_SNAPSHOT_COMMIT_INCOMPLETE");
  return Object.freeze({ result: "COMMITTED", promotion_id: intent.promotion_id, intent_sha256: intent.snapshot_intent_sha256, receipt_sha256: receipt.receipt_sha256 });
}

function createQuiesceCheckpointReceipt(context, quiesceIntent, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: "WRITER_QUIESCE_RECEIPT",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: quiesceIntent.quiesce_checked_at,
    checkpoint_evidence_sha256: quiesceIntent.quiesce_intent_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: quiesceIntent.promotion_intent_sha256,
    candidate_binding_sha256: quiesceIntent.candidate_binding_sha256,
    database_binding_sha256: quiesceIntent.database_binding_sha256,
    runtime_binding_sha256: quiesceIntent.runtime_binding_sha256,
    recovery_binding_sha256: quiesceIntent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: quiesceIntent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: quiesceIntent.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: ZERO_SHA256,
    migration_fence_binding_sha256: ZERO_SHA256,
    migration_result_binding_sha256: ZERO_SHA256,
    compose_deployment_binding_sha256: ZERO_SHA256,
  });
}

async function quiesceCandidateState(paths, quiesceIntent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID");
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) {
      reject("UAT_PROMOTION_QUIESCE_COMMITTED_STATE_MISMATCH");
    }
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== quiesceIntent.promotion_intent_sha256
    || chain.current.value.promotion_snapshot_binding_sha256 !== quiesceIntent.promotion_snapshot_binding_sha256
    || chain.current.value.writer_quiesce_binding_sha256 !== ZERO_SHA256
    || chain.current.value.checkpoint_ordinal !== 5) reject("UAT_PROMOTION_QUIESCE_PREVIOUS_CHANGED");
  const history = await trustedJsonFile(historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID");
  const storedReceipt = await trustedJsonFile(receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID");
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) {
    reject("UAT_PROMOTION_QUIESCE_PUBLICATION_CONFLICT");
  }
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_QUIESCE_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

async function prepareQuiesce(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  const sources = await verifyQuiesceAuthorizedSources(context, options.filesystemRoot, options);
  const intent = createQuiesceIntent(context, sources);
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length > 1 || matches.length === 1 && matches[0] !== path.basename(quiesceIntentFile(paths, intent))) {
    reject("UAT_PROMOTION_QUIESCE_OPERATION_ID_REUSED");
  }
  const receipt = createQuiesceCheckpointReceipt(context, intent, sources.previous);
  await quiesceCandidateState(paths, intent, sources.previous, receipt);
  const raw = Buffer.from(canonicalClusterJson(intent));
  if (matches.length === 1) {
    const existing = await trustedJsonFile(quiesceIntentFile(paths, intent), 0o400, validateUatPromotionQuiesceIntent, "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
    if (!existing?.raw.equals(raw)) reject("UAT_PROMOTION_QUIESCE_INTENT_CONFLICT");
    return Object.freeze({
      result: "ALREADY_PREPARED", promotion_id: intent.promotion_id,
      intent_sha256: intent.quiesce_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    });
  }
  await ensureRawFile(quiesceIntentFile(paths, intent), raw, 0o400, validateUatPromotionQuiesceIntent, "UAT_PROMOTION_QUIESCE_INTENT_CONFLICT");
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  return Object.freeze({
    result: "PREPARED", promotion_id: intent.promotion_id,
    intent_sha256: intent.quiesce_intent_sha256, receipt_sha256: receipt.receipt_sha256,
  });
}

async function loadStoredQuiesceIntent(context, paths) {
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1 || !matches[0].endsWith(`.${context.expected_intent_sha256}.json`)) {
    reject("UAT_PROMOTION_QUIESCE_INTENT_MISSING");
  }
  const stored = await trustedJsonFile(path.join(paths.intents, matches[0]), 0o400, validateUatPromotionQuiesceIntent, "UAT_PROMOTION_QUIESCE_INTENT_INVALID");
  if (!stored || stored.value.quiesce_intent_sha256 !== context.expected_intent_sha256
    || stored.value.quiesce_operation_id !== context.operation_id
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256) {
    reject("UAT_PROMOTION_QUIESCE_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadQuiesceIntent(context, paths, sources) {
  const expected = createQuiesceIntent(context, sources);
  if (context.expected_intent_sha256 !== null && context.expected_intent_sha256 !== expected.quiesce_intent_sha256) {
    reject("UAT_PROMOTION_QUIESCE_INTENT_BINDING_INVALID");
  }
  const stored = await loadStoredQuiesceIntent({ ...context, expected_intent_sha256: expected.quiesce_intent_sha256 }, paths);
  if (canonicalClusterJson(stored) !== canonicalClusterJson(expected)) reject("UAT_PROMOTION_QUIESCE_INTENT_BINDING_INVALID");
  return stored;
}

async function commitQuiesce(context, intent, sources, paths, options) {
  const receipt = createQuiesceCheckpointReceipt(context, intent, sources.previous);
  let state = await quiesceCandidateState(paths, intent, sources.previous, receipt);
  if (state.committed) {
    return Object.freeze({
      result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
      intent_sha256: intent.quiesce_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    });
  }
  if (!state.history) {
    await ensureRawFile(historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_CONFLICT");
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_QUIESCE_HISTORY");
  }
  state = await quiesceCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_CONFLICT");
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_QUIESCE_RECEIPT");
  }
  state = await quiesceCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${intent.quiesce_operation_id}.${receipt.receipt_sha256}.tmp`);
    await atomicAlias(paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt, state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION");
    await options.fault?.("AFTER_QUIESCE_CURRENT");
  }
  state = await quiesceCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_QUIESCE_COMMIT_INCOMPLETE");
  return Object.freeze({
    result: "COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.quiesce_intent_sha256, receipt_sha256: receipt.receipt_sha256,
  });
}

function createMigrationAuthorizationCheckpointReceipt(context, intent, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: "ONE_TIME_MIGRATION_AUTHORIZATION",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: intent.created_at,
    checkpoint_evidence_sha256: intent.migration_authorization_intent_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.promotion_intent_sha256,
    candidate_binding_sha256: intent.candidate_binding_sha256,
    database_binding_sha256: intent.database_binding_sha256,
    runtime_binding_sha256: intent.runtime_binding_sha256,
    recovery_binding_sha256: intent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: intent.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: intent.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: ZERO_SHA256,
    migration_result_binding_sha256: ZERO_SHA256,
    compose_deployment_binding_sha256: ZERO_SHA256,
  });
}

async function migrationAuthorizationCandidateState(paths, intent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) {
      reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_COMMITTED_STATE_MISMATCH");
    }
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== intent.promotion_intent_sha256
    || chain.current.value.promotion_snapshot_binding_sha256 !== intent.promotion_snapshot_binding_sha256
    || chain.current.value.writer_quiesce_binding_sha256 !== intent.writer_quiesce_binding_sha256
    || chain.current.value.migration_authorization_binding_sha256 !== ZERO_SHA256
    || chain.current.value.checkpoint_ordinal !== 6) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_PREVIOUS_CHANGED");
  }
  const history = await trustedJsonFile(
    historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID",
  );
  const storedReceipt = await trustedJsonFile(
    receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID",
  );
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_PUBLICATION_CONFLICT");
  }
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

async function prepareMigrationAuthorization(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  const sources = await verifyMigrationAuthorizationSources(context, options.filesystemRoot);
  const intent = createMigrationAuthorizationIntent(context, sources);
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length > 1 || matches.length === 1 && matches[0] !== path.basename(migrationAuthorizationIntentFile(paths, intent))) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_OPERATION_ID_REUSED");
  }
  const receipt = createMigrationAuthorizationCheckpointReceipt(context, intent, sources.previous);
  await migrationAuthorizationCandidateState(paths, intent, sources.previous, receipt);
  const raw = Buffer.from(canonicalClusterJson(intent));
  if (matches.length === 1) {
    const existing = await trustedJsonFile(
      migrationAuthorizationIntentFile(paths, intent), 0o400, validateUatPromotionMigrationAuthorizationIntent,
      "UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_INVALID",
    );
    if (!existing?.raw.equals(raw)) reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONFLICT");
    return Object.freeze({
      result: "ALREADY_PREPARED", promotion_id: intent.promotion_id,
      intent_sha256: intent.migration_authorization_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    });
  }
  await ensureRawFile(
    migrationAuthorizationIntentFile(paths, intent), raw, 0o400, validateUatPromotionMigrationAuthorizationIntent,
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONFLICT",
  );
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  return Object.freeze({
    result: "PREPARED", promotion_id: intent.promotion_id,
    intent_sha256: intent.migration_authorization_intent_sha256, receipt_sha256: receipt.receipt_sha256,
  });
}

async function loadStoredMigrationAuthorizationIntent(context, paths) {
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1 || !matches[0].endsWith(`.${context.expected_intent_sha256}.json`)) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_MISSING");
  }
  const stored = await trustedJsonFile(
    path.join(paths.intents, matches[0]), 0o400, validateUatPromotionMigrationAuthorizationIntent,
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_INVALID",
  );
  if (!stored || stored.value.migration_authorization_intent_sha256 !== context.expected_intent_sha256
    || stored.value.migration_authorization_operation_id !== context.operation_id
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadMigrationAuthorizationIntent(context, paths, sources) {
  const expected = createMigrationAuthorizationIntent(context, sources);
  if (context.expected_intent_sha256 !== null
    && context.expected_intent_sha256 !== expected.migration_authorization_intent_sha256) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_BINDING_INVALID");
  }
  const stored = await loadStoredMigrationAuthorizationIntent(
    { ...context, expected_intent_sha256: expected.migration_authorization_intent_sha256 }, paths,
  );
  if (canonicalClusterJson(stored) !== canonicalClusterJson(expected)) {
    reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_BINDING_INVALID");
  }
  return stored;
}

async function commitMigrationAuthorization(context, intent, sources, paths, options) {
  const receipt = createMigrationAuthorizationCheckpointReceipt(context, intent, sources.previous);
  let state = await migrationAuthorizationCandidateState(paths, intent, sources.previous, receipt);
  if (state.committed) {
    return Object.freeze({
      result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
      intent_sha256: intent.migration_authorization_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    });
  }
  if (!state.history) {
    await ensureRawFile(
      historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_HISTORY_CONFLICT",
    );
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_MIGRATION_AUTHORIZATION_HISTORY");
  }
  state = await migrationAuthorizationCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(
      receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_RECEIPT_CONFLICT",
    );
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_MIGRATION_AUTHORIZATION_RECEIPT");
  }
  state = await migrationAuthorizationCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(
      paths.stateRoot, `.current.${intent.migration_authorization_operation_id}.${receipt.receipt_sha256}.tmp`,
    );
    await atomicAlias(
      paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION",
    );
    await options.fault?.("AFTER_MIGRATION_AUTHORIZATION_CURRENT");
  }
  state = await migrationAuthorizationCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_COMMIT_INCOMPLETE");
  return Object.freeze({
    result: "COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.migration_authorization_intent_sha256, receipt_sha256: receipt.receipt_sha256,
  });
}

async function prepareMigrationExecution(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  const sources = await verifyMigrationExecutionSources(context, options.filesystemRoot);
  const artifacts = createMigrationExecutionArtifacts(context, sources);
  const intentNames = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const intentMatches = intentNames.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (intentMatches.length > 1 || intentMatches.length === 1
    && intentMatches[0] !== path.basename(migrationExecutionIntentFile(paths, artifacts.intent))) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_OPERATION_ID_REUSED");
  }
  const grantNames = await strictNames(
    paths.grants, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_MIGRATION_GRANT_ROOT_INVALID",
  );
  const grantMatches = grantNames.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (grantMatches.length > 1 || grantMatches.length === 1
    && grantMatches[0] !== path.basename(migrationGrantFile(paths, context.operation_id, artifacts.grant.grant_sha256))) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_OPERATION_ID_REUSED");
  }
  const intentRaw = Buffer.from(canonicalClusterJson(artifacts.intent));
  const grantRaw = Buffer.from(canonicalClusterJson(artifacts.grant));
  if (intentMatches.length === 1) {
    const existing = await trustedJsonFile(
      migrationExecutionIntentFile(paths, artifacts.intent), 0o400, validateUatPromotionMigrationExecutionIntent,
      "UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_INVALID",
    );
    if (!existing?.raw.equals(intentRaw)) reject("UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONFLICT");
  } else {
    await ensureRawFile(
      migrationExecutionIntentFile(paths, artifacts.intent), intentRaw, 0o400,
      validateUatPromotionMigrationExecutionIntent, "UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONFLICT",
    );
    await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  }
  if (grantMatches.length === 1) {
    const existing = await trustedJsonFile(
      migrationGrantFile(paths, context.operation_id, artifacts.grant.grant_sha256), 0o440,
      validateUatPromotionMigrationGrant, "UAT_PROMOTION_MIGRATION_GRANT_INVALID",
    );
    if (!existing?.raw.equals(grantRaw)) reject("UAT_PROMOTION_MIGRATION_GRANT_CONFLICT");
  } else {
    await ensureRawFile(
      migrationGrantFile(paths, context.operation_id, artifacts.grant.grant_sha256), grantRaw, 0o440,
      validateUatPromotionMigrationGrant, "UAT_PROMOTION_MIGRATION_GRANT_CONFLICT",
    );
    await syncDirectory(paths.grants, "UAT_PROMOTION_MIGRATION_GRANT_SYNC_FAILED");
  }
  return Object.freeze({
    result: intentMatches.length === 1 && grantMatches.length === 1 ? "ALREADY_PREPARED" : "PREPARED",
    promotion_id: artifacts.intent.promotion_id,
    intent_sha256: artifacts.intent.migration_execution_intent_sha256,
    grant_sha256: artifacts.grant.grant_sha256,
  });
}

async function loadStoredMigrationExecutionIntent(context, paths) {
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1 || !matches[0].endsWith(`.${context.expected_intent_sha256}.json`)) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_MISSING");
  }
  const stored = await trustedJsonFile(
    path.join(paths.intents, matches[0]), 0o400, validateUatPromotionMigrationExecutionIntent,
    "UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_INVALID",
  );
  if (!stored || stored.value.migration_execution_intent_sha256 !== context.expected_intent_sha256
    || stored.value.migration_operation_id !== context.operation_id
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadMigrationExecutionArtifacts(context, paths, sources) {
  const expected = createMigrationExecutionArtifacts(context, sources);
  if (context.expected_intent_sha256 !== null
    && context.expected_intent_sha256 !== expected.intent.migration_execution_intent_sha256) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_BINDING_INVALID");
  }
  const intent = await loadStoredMigrationExecutionIntent(
    { ...context, expected_intent_sha256: expected.intent.migration_execution_intent_sha256 }, paths,
  );
  if (canonicalClusterJson(intent) !== canonicalClusterJson(expected.intent)) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_BINDING_INVALID");
  }
  const grant = await loadStoredMigrationExecutionGrant(paths, intent);
  if (canonicalClusterJson(grant) !== canonicalClusterJson(expected.grant)) {
    reject("UAT_PROMOTION_MIGRATION_GRANT_BINDING_INVALID");
  }
  return Object.freeze({ intent, grant });
}

async function loadStoredMigrationExecutionGrant(paths, intent) {
  const names = await strictNames(
    paths.grants, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_MIGRATION_GRANT_ROOT_INVALID",
  );
  const expectedName = path.basename(
    migrationGrantFile(paths, intent.migration_operation_id, intent.grant_sha256),
  );
  const matches = names.filter((name) => operationArtifactMatches(name, intent.migration_operation_id));
  if (matches.length !== 1 || matches[0] !== expectedName) reject("UAT_PROMOTION_MIGRATION_GRANT_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.grants, expectedName), 0o440, validateUatPromotionMigrationGrant,
    "UAT_PROMOTION_MIGRATION_GRANT_INVALID",
  );
  if (!stored || stored.value.grant_sha256 !== intent.grant_sha256
    || stored.value.migration_operation_id !== intent.migration_operation_id
    || stored.value.execution_authorization_sha256 !== intent.execution_authorization_sha256) {
    reject("UAT_PROMOTION_MIGRATION_GRANT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadMigrationExecutionResult(paths, intent, grant, migrationEntries = null) {
  const names = await strictNames(
    paths.results, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_MIGRATION_RESULT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, intent.migration_operation_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_MIGRATION_RESULT_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.results, matches[0]), 0o400, validateUatPromotionMigrationResult,
    "UAT_PROMOTION_MIGRATION_RESULT_INVALID",
  );
  if (!stored || !matches[0].endsWith(`.${stored.value.result_sha256}.json`)) {
    reject("UAT_PROMOTION_MIGRATION_RESULT_INVALID");
  }
  try { assertUatPromotionMigrationResultMatchesGrant(stored.value, grant); }
  catch { reject("UAT_PROMOTION_MIGRATION_RESULT_BINDING_INVALID"); }
  if (migrationEntries !== null) {
    try { assertUatPromotionMigrationEngineResultMatchesAllowlist(stored.value.engine_result, migrationEntries); }
    catch { reject("UAT_PROMOTION_MIGRATION_RESULT_ALLOWLIST_INVALID"); }
  }
  if (Date.parse(stored.value.committed_at) < Date.parse(intent.created_at)
    || Date.parse(stored.value.committed_at) >= Date.parse(intent.parameters.execution_expires_at)) {
    reject("UAT_PROMOTION_MIGRATION_RESULT_TIME_INVALID");
  }
  return stored.value;
}

function createMigrationExecutionCheckpointReceipt(context, intent, result, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: "MIGRATION_COMMIT_RECEIPT",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: result.committed_at,
    checkpoint_evidence_sha256: result.result_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.promotion_intent_sha256,
    candidate_binding_sha256: intent.candidate_binding_sha256,
    database_binding_sha256: intent.database_binding_sha256,
    runtime_binding_sha256: intent.runtime_binding_sha256,
    recovery_binding_sha256: intent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: intent.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: intent.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: result.database_fence_binding_sha256,
    migration_result_binding_sha256: result.migration_result_binding_sha256,
    compose_deployment_binding_sha256: ZERO_SHA256,
  });
}

async function migrationExecutionCandidateState(paths, intent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) {
      reject("UAT_PROMOTION_MIGRATION_EXECUTION_COMMITTED_STATE_MISMATCH");
    }
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== intent.promotion_intent_sha256
    || chain.current.value.migration_authorization_binding_sha256 !== intent.migration_authorization_binding_sha256
    || chain.current.value.migration_fence_binding_sha256 !== ZERO_SHA256
    || chain.current.value.migration_result_binding_sha256 !== ZERO_SHA256
    || chain.current.value.checkpoint_ordinal !== 7) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_PREVIOUS_CHANGED");
  }
  const history = await trustedJsonFile(
    historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID",
  );
  const storedReceipt = await trustedJsonFile(
    receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID",
  );
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) {
    reject("UAT_PROMOTION_MIGRATION_EXECUTION_PUBLICATION_CONFLICT");
  }
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_MIGRATION_EXECUTION_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

async function commitMigrationExecution(context, intent, result, sources, paths, options) {
  const receipt = createMigrationExecutionCheckpointReceipt(context, intent, result, sources.previous);
  let state = await migrationExecutionCandidateState(paths, intent, sources.previous, receipt);
  if (state.committed) return Object.freeze({
    result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.migration_execution_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    migration_result_sha256: result.result_sha256,
  });
  if (!state.history) {
    await ensureRawFile(
      historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_HISTORY_CONFLICT",
    );
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_MIGRATION_EXECUTION_HISTORY");
  }
  state = await migrationExecutionCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(
      receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_RECEIPT_CONFLICT",
    );
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_MIGRATION_EXECUTION_RECEIPT");
  }
  state = await migrationExecutionCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${intent.migration_operation_id}.${receipt.receipt_sha256}.tmp`);
    await atomicAlias(
      paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION",
    );
    await options.fault?.("AFTER_MIGRATION_EXECUTION_CURRENT");
  }
  state = await migrationExecutionCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_MIGRATION_EXECUTION_COMMIT_INCOMPLETE");
  return Object.freeze({
    result: "COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.migration_execution_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    migration_result_sha256: result.result_sha256,
  });
}

async function prepareComposeDeployment(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  const sources = await verifyComposeDeploymentSources(context, options.filesystemRoot);
  const intent = createComposeDeploymentIntent(context, sources);
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length > 1 || matches.length === 1
    && matches[0] !== path.basename(composeDeploymentIntentFile(paths, intent))) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_OPERATION_ID_REUSED");
  }
  const resultNames = await strictNames(
    paths.results, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_ROOT_INVALID",
  );
  const transferNames = await strictNames(
    paths.fenceTransfers, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_ROOT_INVALID",
  );
  if (resultNames.some((name) => operationArtifactMatches(name, context.operation_id))
    || transferNames.some((name) => operationArtifactMatches(name, context.operation_id))) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_OPERATION_ID_REUSED");
  }
  const raw = Buffer.from(canonicalClusterJson(intent));
  if (matches.length === 1) {
    const existing = await trustedJsonFile(
      composeDeploymentIntentFile(paths, intent), 0o400, validateUatPromotionComposeDeploymentIntent,
      "UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_INVALID",
    );
    if (!existing?.raw.equals(raw)) reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_CONFLICT");
    return Object.freeze({
      result: "ALREADY_PREPARED", promotion_id: intent.promotion_id,
      intent_sha256: intent.compose_deployment_intent_sha256,
      deployment_plan_sha256: intent.deployment_plan_sha256,
    });
  }
  await ensureRawFile(
    composeDeploymentIntentFile(paths, intent), raw, 0o400, validateUatPromotionComposeDeploymentIntent,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_CONFLICT",
  );
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  return Object.freeze({
    result: "PREPARED", promotion_id: intent.promotion_id,
    intent_sha256: intent.compose_deployment_intent_sha256,
    deployment_plan_sha256: intent.deployment_plan_sha256,
  });
}

async function loadStoredComposeDeploymentIntent(context, paths) {
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1 || !matches[0].endsWith(`.${context.expected_intent_sha256}.json`)) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_MISSING");
  }
  const stored = await trustedJsonFile(
    path.join(paths.intents, matches[0]), 0o400, validateUatPromotionComposeDeploymentIntent,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_INVALID",
  );
  if (!stored || stored.value.compose_deployment_intent_sha256 !== context.expected_intent_sha256
    || stored.value.deployment_operation_id !== context.operation_id
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadComposeDeploymentIntent(context, paths, sources) {
  const expected = createComposeDeploymentIntent(context, sources);
  if (context.expected_intent_sha256 !== null
    && context.expected_intent_sha256 !== expected.compose_deployment_intent_sha256) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_BINDING_INVALID");
  }
  const stored = await loadStoredComposeDeploymentIntent(
    { ...context, expected_intent_sha256: expected.compose_deployment_intent_sha256 }, paths,
  );
  if (canonicalClusterJson(stored) !== canonicalClusterJson(expected)) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_BINDING_INVALID");
  }
  return stored;
}

async function loadComposeDeploymentResult(paths, intent) {
  const names = await strictNames(
    paths.results, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, intent.deployment_operation_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.results, matches[0]), 0o400, validateUatPromotionComposeDeploymentResult,
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_INVALID",
  );
  if (!stored || !matches[0].endsWith(`.${stored.value.result_sha256}.json`)) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_INVALID");
  }
  try { assertUatPromotionComposeDeploymentResultMatchesIntent(stored.value, intent); }
  catch { reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_BINDING_INVALID"); }
  return stored.value;
}

async function loadComposeDeploymentFenceTransfer(paths, intent, result) {
  const names = await strictNames(
    paths.fenceTransfers, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, intent.deployment_operation_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.fenceTransfers, matches[0]), 0o400, validateUatPromotionActiveFenceTransfer,
    "UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_INVALID",
  );
  if (!stored || !matches[0].endsWith(`.${stored.value.transfer_sha256}.json`)) {
    reject("UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_INVALID");
  }
  try { assertUatPromotionActiveFenceTransferMatchesResult(stored.value, result, intent); }
  catch { reject("UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_BINDING_INVALID"); }
  return stored.value;
}

function composeDeploymentBinding(result, transfer) {
  return clusterSha256({
    deployment_result_sha256: result.result_sha256,
    fence_transfer_sha256: transfer.transfer_sha256,
  });
}

function createComposeDeploymentCheckpointReceipt(context, intent, result, transfer, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: "COMPOSE_DEPLOYMENT_RECEIPT",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: transfer.transferred_at,
    checkpoint_evidence_sha256: result.result_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.promotion_intent_sha256,
    candidate_binding_sha256: intent.candidate_binding_sha256,
    database_binding_sha256: intent.database_binding_sha256,
    runtime_binding_sha256: intent.runtime_binding_sha256,
    recovery_binding_sha256: intent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: intent.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: intent.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: intent.migration_fence_binding_sha256,
    migration_result_binding_sha256: intent.migration_result_binding_sha256,
    compose_deployment_binding_sha256: composeDeploymentBinding(result, transfer),
  });
}

async function composeDeploymentCandidateState(paths, intent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) {
      reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMMITTED_STATE_MISMATCH");
    }
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== intent.promotion_intent_sha256
    || chain.current.value.migration_fence_binding_sha256 !== intent.migration_fence_binding_sha256
    || chain.current.value.migration_result_binding_sha256 !== intent.migration_result_binding_sha256
    || chain.current.value.compose_deployment_binding_sha256 !== ZERO_SHA256
    || chain.current.value.checkpoint_ordinal !== 8) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_PREVIOUS_CHANGED");
  }
  const history = await trustedJsonFile(
    historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_HISTORY_INVALID",
  );
  const storedReceipt = await trustedJsonFile(
    receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_RECEIPT_INVALID",
  );
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) {
    reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_PUBLICATION_CONFLICT");
  }
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

async function commitComposeDeployment(context, intent, result, transfer, sources, paths, options) {
  const receipt = createComposeDeploymentCheckpointReceipt(context, intent, result, transfer, sources.previous);
  let state = await composeDeploymentCandidateState(paths, intent, sources.previous, receipt);
  if (state.committed) return Object.freeze({
    result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.compose_deployment_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    deployment_result_sha256: result.result_sha256, fence_transfer_sha256: transfer.transfer_sha256,
  });
  if (!state.history) {
    await ensureRawFile(
      historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_HISTORY_CONFLICT",
    );
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_COMPOSE_DEPLOYMENT_HISTORY");
  }
  state = await composeDeploymentCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(
      receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_RECEIPT_CONFLICT",
    );
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_COMPOSE_DEPLOYMENT_RECEIPT");
  }
  state = await composeDeploymentCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(
      paths.stateRoot, `.current.${intent.deployment_operation_id}.${receipt.receipt_sha256}.tmp`,
    );
    await atomicAlias(
      paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION",
    );
    await options.fault?.("AFTER_COMPOSE_DEPLOYMENT_CURRENT");
  }
  state = await composeDeploymentCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMMIT_INCOMPLETE");
  return Object.freeze({
    result: "COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.compose_deployment_intent_sha256, receipt_sha256: receipt.receipt_sha256,
    deployment_result_sha256: result.result_sha256, fence_transfer_sha256: transfer.transfer_sha256,
  });
}

function postdeployIntentDigest(intent) {
  return intent.postdeploy_runtime_intent_sha256 ?? intent.postdeploy_identity_intent_sha256;
}

function postdeployIntentFile(paths, intent) {
  return intent.contract === UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT
    ? postdeployRuntimeIntentFile(paths, intent) : postdeployIdentityIntentFile(paths, intent);
}

function postdeployIntentValidator(operation) {
  return operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? validateUatPromotionPostdeployRuntimeIntent : validateUatPromotionPostdeployIdentityIntent;
}

function validateAnyUatPromotionIntent(value) {
  const validators = new Map([
    [UAT_PROMOTION_INTENT_CONTRACT, validateUatPromotionIntent],
    [UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT, validateUatPromotionSnapshotIntent],
    [UAT_PROMOTION_QUIESCE_INTENT_CONTRACT, validateUatPromotionQuiesceIntent],
    [UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT, validateUatPromotionMigrationAuthorizationIntent],
    [UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT, validateUatPromotionMigrationExecutionIntent],
    [UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTENT_CONTRACT, validateUatPromotionComposeDeploymentIntent],
    [UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT, validateUatPromotionPostdeployRuntimeIntent],
    [UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_CONTRACT, validateUatPromotionPostdeployIdentityIntent],
    [UAT_PROMOTION_CROSS_ROLE_INTENT_CONTRACT, validateUatPromotionCrossRoleIntent],
  ]);
  const validator = validators.get(value?.contract);
  if (!validator) reject("UAT_PROMOTION_INTENT_INVALID");
  return validator(value);
}

async function assertNoOtherPendingPostdeployIntent(paths, current, context) {
  const expectedContract = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT : UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_CONTRACT;
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  for (const name of names) {
    const stored = await trustedJsonFile(
      path.join(paths.intents, name), 0o400, validateAnyUatPromotionIntent,
      "UAT_PROMOTION_INTENT_INVALID",
    );
    const intent = stored.value;
    if (intent.contract === expectedContract
      && intent.promotion_id === current.promotion_id
      && intent.promotion_generation === current.promotion_generation
      && intent.previous_checkpoint_receipt_sha256 === current.receipt_sha256
      && intent.verification_operation_id !== context.operation_id) {
      reject("UAT_PROMOTION_POSTDEPLOY_RECOVERY_REQUIRED");
    }
  }
}

async function assertNoCommittedPostdeployAnomaly(paths) {
  const names = await strictNames(
    paths.containments, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_ROOT_INVALID",
  );
  for (const name of names) {
    const stored = await trustedJsonFile(
      path.join(paths.containments, name), 0o400, validatePostdeployContainment,
      "UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_INVALID",
    );
    if (name !== `${stored.value.operation_id}.${stored.value.containment_sha256}.json`) {
      reject("UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_INVALID");
    }
    if (stored.value.status === "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY") {
      reject("UAT_PROMOTION_POSTDEPLOY_ANOMALY_REQUIRES_REVIEW");
    }
  }
}

async function preparePostdeployCheckpoint(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  await assertNoCommittedPostdeployAnomaly(paths);
  const sources = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? await verifyPostdeployRuntimeSources(context, options.filesystemRoot)
    : await verifyPostdeployIdentitySources(context, options.filesystemRoot);
  await assertNoOtherPendingPostdeployIntent(paths, sources.previous, context);
  const intent = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? createPostdeployRuntimeIntent(context, sources) : createPostdeployIdentityIntent(context, sources);
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length > 1 || matches.length === 1 && matches[0] !== path.basename(postdeployIntentFile(paths, intent))) {
    reject("UAT_PROMOTION_POSTDEPLOY_OPERATION_ID_REUSED");
  }
  const chain = await committedChain(paths);
  if (chain.current?.value.receipt_sha256 !== sources.previous.receipt_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_PREVIOUS_CHANGED");
  }
  const raw = Buffer.from(canonicalClusterJson(intent));
  if (matches.length === 1) {
    const existing = await trustedJsonFile(
      postdeployIntentFile(paths, intent), 0o400, postdeployIntentValidator(context.operation),
      "UAT_PROMOTION_POSTDEPLOY_INTENT_INVALID",
    );
    if (!existing?.raw.equals(raw)) reject("UAT_PROMOTION_POSTDEPLOY_INTENT_CONFLICT");
    return Object.freeze({
      result: "ALREADY_PREPARED", promotion_id: intent.promotion_id,
      intent_sha256: postdeployIntentDigest(intent), verification_plan_sha256: intent.verification_plan_sha256,
    });
  }
  await ensureRawFile(
    postdeployIntentFile(paths, intent), raw, 0o400, postdeployIntentValidator(context.operation),
    "UAT_PROMOTION_POSTDEPLOY_INTENT_CONFLICT",
  );
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  return Object.freeze({
    result: "PREPARED", promotion_id: intent.promotion_id,
    intent_sha256: postdeployIntentDigest(intent), verification_plan_sha256: intent.verification_plan_sha256,
  });
}

async function loadStoredPostdeployIntent(context, paths) {
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_POSTDEPLOY_INTENT_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.intents, matches[0]), 0o400, postdeployIntentValidator(context.operation),
    "UAT_PROMOTION_POSTDEPLOY_INTENT_INVALID",
  );
  const expectedDigest = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? stored?.value.postdeploy_runtime_intent_sha256 : stored?.value.postdeploy_identity_intent_sha256;
  if (!stored || matches[0] !== `${context.operation_id}.${expectedDigest}.json`
    || expectedDigest !== (context.expected_intent_sha256 ?? expectedDigest)
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || !same(stored.value.parameters, context.parameters)) {
    reject("UAT_PROMOTION_POSTDEPLOY_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadPostdeployIntent(context, paths, sources) {
  const expected = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? createPostdeployRuntimeIntent(context, sources) : createPostdeployIdentityIntent(context, sources);
  const stored = await loadStoredPostdeployIntent(context, paths);
  if (postdeployIntentDigest(stored) !== postdeployIntentDigest(expected)
    || !same(stored, expected)) reject("UAT_PROMOTION_POSTDEPLOY_INTENT_BINDING_INVALID");
  return stored;
}

async function assertNoOtherPendingCrossRoleIntent(paths, current, context) {
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  for (const name of names) {
    const stored = await trustedJsonFile(
      path.join(paths.intents, name), 0o400, validateAnyUatPromotionIntent,
      "UAT_PROMOTION_INTENT_INVALID",
    );
    const intent = stored.value;
    if (intent.contract === UAT_PROMOTION_CROSS_ROLE_INTENT_CONTRACT
      && intent.promotion_id === current.promotion_id
      && intent.promotion_generation === current.promotion_generation
      && intent.previous_checkpoint_receipt_sha256 === current.receipt_sha256
      && intent.verification_operation_id !== context.operation_id) {
      reject("UAT_PROMOTION_CROSS_ROLE_RECOVERY_REQUIRED");
    }
  }
}

async function prepareCrossRoleCheckpoint(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  if ((await readdir(paths.quarantine)).length !== 0) reject("UAT_PROMOTION_QUARANTINE_PRESENT");
  await assertNoCommittedPostdeployAnomaly(paths);
  const sources = await verifyCrossRoleSources(context, options.filesystemRoot, options);
  await assertNoOtherPendingCrossRoleIntent(paths, sources.previous, context);
  const intent = createCrossRoleIntent(context, sources);
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length > 1 || matches.length === 1
    && matches[0] !== path.basename(crossRoleIntentFile(paths, intent))) {
    reject("UAT_PROMOTION_CROSS_ROLE_OPERATION_ID_REUSED");
  }
  const chain = await committedChain(paths);
  if (chain.current?.value.receipt_sha256 !== sources.previous.receipt_sha256) {
    reject("UAT_PROMOTION_CROSS_ROLE_PREVIOUS_CHANGED");
  }
  const raw = Buffer.from(canonicalClusterJson(intent));
  if (matches.length === 1) {
    const existing = await trustedJsonFile(
      crossRoleIntentFile(paths, intent), 0o400, validateUatPromotionCrossRoleIntent,
      "UAT_PROMOTION_CROSS_ROLE_INTENT_INVALID",
    );
    if (!existing?.raw.equals(raw)) reject("UAT_PROMOTION_CROSS_ROLE_INTENT_CONFLICT");
    return Object.freeze({
      result: "ALREADY_PREPARED", promotion_id: intent.promotion_id,
      intent_sha256: intent.cross_role_intent_sha256,
      verification_plan_sha256: intent.verification_plan_sha256,
      cross_role_result_sha256: intent.cross_role_result_sha256,
    });
  }
  await ensureRawFile(
    crossRoleIntentFile(paths, intent), raw, 0o400, validateUatPromotionCrossRoleIntent,
    "UAT_PROMOTION_CROSS_ROLE_INTENT_CONFLICT",
  );
  await syncDirectory(paths.intents, "UAT_PROMOTION_INTENT_SYNC_FAILED");
  return Object.freeze({
    result: "PREPARED", promotion_id: intent.promotion_id,
    intent_sha256: intent.cross_role_intent_sha256,
    verification_plan_sha256: intent.verification_plan_sha256,
    cross_role_result_sha256: intent.cross_role_result_sha256,
  });
}

async function loadStoredCrossRoleIntent(context, paths) {
  const names = await strictNames(
    paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_INTENT_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_CROSS_ROLE_INTENT_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.intents, matches[0]), 0o400, validateUatPromotionCrossRoleIntent,
    "UAT_PROMOTION_CROSS_ROLE_INTENT_INVALID",
  );
  if (!stored || matches[0] !== `${context.operation_id}.${stored.value.cross_role_intent_sha256}.json`
    || stored.value.cross_role_intent_sha256 !== (context.expected_intent_sha256
      ?? stored.value.cross_role_intent_sha256)
    || stored.value.execution_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || !same(stored.value.parameters, context.parameters)) {
    reject("UAT_PROMOTION_CROSS_ROLE_INTENT_BINDING_INVALID");
  }
  return stored.value;
}

async function loadCrossRoleIntent(context, paths, sources) {
  const expected = createCrossRoleIntent(context, sources);
  const stored = await loadStoredCrossRoleIntent(context, paths);
  if (stored.cross_role_intent_sha256 !== expected.cross_role_intent_sha256
    || !same(stored, expected)) reject("UAT_PROMOTION_CROSS_ROLE_INTENT_BINDING_INVALID");
  return stored;
}

async function loadRuntimeProbeResult(context, intent, filesystemRoot, now) {
  const parameters = intent.parameters;
  const logical = `${parameters.probe_root}/${parameters.probe_id}.runtime-configuration-probe.json`;
  await trustedAncestors(parameters.probe_root, filesystemRoot, "UAT_PROMOTION_POSTDEPLOY_RUNTIME_ROOT_INVALID");
  const root = physicalPath(parameters.probe_root, filesystemRoot);
  await trustedDirectory(root, new Set([0o700]), "UAT_PROMOTION_POSTDEPLOY_RUNTIME_ROOT_INVALID");
  await trustedMarker(
    path.join(root, RUNTIME_PROBE_MARKER), Buffer.from(RUNTIME_PROBE_MARKER_VALUE),
    0o400, 0, "UAT_PROMOTION_POSTDEPLOY_RUNTIME_ROOT_INVALID",
  );
  const stored = await trustedJsonFile(
    physicalPath(logical, filesystemRoot), 0o400,
    (value) => validateRuntimeConfigurationProbeReceipt(value, { now }),
    "UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_INVALID", 0, false,
  );
  if (!stored || stored.raw.toString("utf8") !== canonicalRuntimeConfigurationProbeJson(stored.value)) {
    reject("UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_INVALID");
  }
  assertRuntimeProbeBinding(
    stored.value, parameters, context, context._deploymentResult, context._transfer,
    context._manifest, now,
  );
  return Object.freeze({ ...stored, sha256: sha256(stored.raw) });
}

function validatePostdeployIdentityEvidence(value) {
  const code = "UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "promotion_id", "verification_operation_id",
    "execution_authorization_sha256", "runtime_probe_result_sha256", "deployment_result_sha256",
    "fence_transfer_sha256", "postdeploy_receipt_sha256", "release_identity_sha256",
    "postdeploy_receipt", "release_identity", "evidence_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_CONTRACT) reject(code);
  for (const field of ["promotion_id", "verification_operation_id"]) identifier(value[field], code);
  for (const field of [
    "execution_authorization_sha256", "runtime_probe_result_sha256", "deployment_result_sha256",
    "fence_transfer_sha256", "postdeploy_receipt_sha256", "release_identity_sha256", "evidence_sha256",
  ]) digest(value[field], code);
  validatePostDeployReceipt(value.postdeploy_receipt);
  validateReleaseIdentity(value.release_identity);
  if (sha256(Buffer.from(canonicalReleaseJson(value.postdeploy_receipt))) !== value.postdeploy_receipt_sha256
    || sha256(Buffer.from(canonicalReleaseJson(value.release_identity))) !== value.release_identity_sha256
    || clusterSha256(bodyWithout(value, "evidence_sha256")) !== value.evidence_sha256) reject(code);
  return value;
}

function canonicalPostdeployIdentityEvidenceJson(value) {
  return canonicalReleaseJson(value);
}

function assertPostdeployReceiptAndIdentityBinding(receipt, identity, intent, sources) {
  const parameters = intent.parameters;
  const expectedIdentity = buildReleaseIdentityFromPostDeployReceipt({
    receipt, receiptSha256: sha256(Buffer.from(canonicalReleaseJson(receipt))),
  });
  if (!same(identity, expectedIdentity)
    || receipt.run_id !== parameters.run_id
    || receipt.result !== "PASS"
    || receipt.control.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256
    || receipt.control.authorization_sha256 !== intent.execution_authorization_sha256
    || !same(receipt.deployment, { class: "UAT", id: parameters.deployment_id, compose_project: parameters.compose_project })
    || receipt.release.manifest_sha256 !== parameters.release_manifest_sha256
    || receipt.source.application_version !== sources.manifest.source.package_version
    || receipt.source.git_commit !== sources.manifest.source.git_commit
    || receipt.source.git_tree !== sources.manifest.source.git_tree
    || receipt.migrations.head !== sources.manifest.migrations.head
    || receipt.migrations.manifest_sha256 !== sources.manifest.migrations.allowlist_sha256
    || receipt.runtime_policy_sha256 !== parameters.runtime_policy_sha256
    || receipt.runtime_configuration_sha256 !== parameters.runtime_configuration_sha256
    || !same(receipt.services, sources.runtimeProbe.services)
    || receipt.readiness.migration_head !== sources.manifest.migrations.head
    || receipt.readiness.migration_manifest_sha256 !== sources.manifest.migrations.allowlist_sha256
    || Date.parse(receipt.generated_at) < Date.parse(sources.runtimeProbe.probed_at)
    || Date.parse(receipt.generated_at) < Date.parse(parameters.verification_created_at)
    || Date.parse(receipt.generated_at) >= Date.parse(parameters.verification_expires_at)) {
    reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_RESULT_BINDING_INVALID");
  }
}

async function loadPostdeployIdentityEvidence(context, intent, sources, filesystemRoot) {
  const parameters = intent.parameters;
  const receiptLogical = `${parameters.postdeploy_root}/${parameters.run_id}.postdeploy-receipt.json`;
  await trustedAncestors(POSTDEPLOY_ROOT, filesystemRoot, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_ROOT_INVALID");
  const postdeployRoot = physicalPath(parameters.postdeploy_root, filesystemRoot);
  await trustedDirectory(postdeployRoot, new Set([0o750]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_ROOT_INVALID");
  await trustedMarker(
    path.join(postdeployRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE),
    0o440, 0, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_ROOT_INVALID",
  );
  const receipt = await trustedJsonFile(
    physicalPath(receiptLogical, filesystemRoot), 0o440, validatePostDeployReceipt,
    "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RECEIPT_INVALID", 0, false,
  );
  const identityRoot = physicalPath(parameters.identity_root, filesystemRoot);
  await trustedAncestors(path.dirname(parameters.identity_root), filesystemRoot, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID");
  await trustedDirectory(
    identityRoot, new Set([0o750]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID",
    parameters.reader_gid,
  );
  await trustedMarker(
    path.join(identityRoot, RELEASE_IDENTITY_ROOT_MARKER), Buffer.from(RELEASE_IDENTITY_ROOT_MARKER_VALUE),
    0o440, parameters.reader_gid, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID",
  );
  const identityStored = await trustedJsonFile(
    physicalPath(RELEASE_IDENTITY_FILE, filesystemRoot), 0o440, validateReleaseIdentity,
    "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID", parameters.reader_gid, false,
  );
  if (!receipt || !identityStored
    || receipt.raw.toString("utf8") !== canonicalReleaseJson(receipt.value)
    || identityStored.raw.toString("utf8") !== canonicalReleaseJson(identityStored.value)) {
    reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_RESULT_INVALID");
  }
  assertPostdeployReceiptAndIdentityBinding(receipt.value, identityStored.value, intent, sources);
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_CONTRACT,
    promotion_id: intent.promotion_id,
    verification_operation_id: intent.verification_operation_id,
    execution_authorization_sha256: intent.execution_authorization_sha256,
    runtime_probe_result_sha256: intent.runtime_probe_result_sha256,
    deployment_result_sha256: intent.deployment_result_sha256,
    fence_transfer_sha256: intent.fence_transfer_sha256,
    postdeploy_receipt_sha256: sha256(receipt.raw),
    release_identity_sha256: sha256(identityStored.raw),
    postdeploy_receipt: receipt.value,
    release_identity: identityStored.value,
  };
  return Object.freeze(validatePostdeployIdentityEvidence({ ...body, evidence_sha256: clusterSha256(body) }));
}

function createPostdeployCheckpointReceipt(context, intent, evidenceSha256, recordedAt, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
      ? "POST_DEPLOY_RUNTIME_CONFIGURATION" : "POST_DEPLOY_IDENTITY",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: recordedAt,
    checkpoint_evidence_sha256: evidenceSha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.promotion_intent_sha256,
    candidate_binding_sha256: intent.candidate_binding_sha256,
    database_binding_sha256: intent.database_binding_sha256,
    runtime_binding_sha256: intent.runtime_binding_sha256,
    recovery_binding_sha256: intent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: intent.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: intent.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: intent.migration_fence_binding_sha256,
    migration_result_binding_sha256: intent.migration_result_binding_sha256,
    compose_deployment_binding_sha256: intent.compose_deployment_binding_sha256,
  });
}

async function postdeployCheckpointCandidateState(paths, intent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) {
      reject("UAT_PROMOTION_POSTDEPLOY_COMMITTED_STATE_MISMATCH");
    }
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== intent.promotion_intent_sha256
    || chain.current.value.checkpoint_ordinal !== (receipt.checkpoint_ordinal - 1)) {
    reject("UAT_PROMOTION_POSTDEPLOY_PREVIOUS_CHANGED");
  }
  const history = await trustedJsonFile(
    historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_HISTORY_INVALID",
  );
  const storedReceipt = await trustedJsonFile(
    receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_RECEIPT_INVALID",
  );
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) {
    reject("UAT_PROMOTION_POSTDEPLOY_PUBLICATION_CONFLICT");
  }
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_POSTDEPLOY_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

function validatePostdeployControlBinding(value) {
  const code = "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "operation", "operation_id", "promotion_id",
    "intent_sha256", "execution_authorization_sha256", "expected_result_kind",
    "expected_result_sha256", "binding_sha256",
  ], code);
  const runtime = value.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONTRACT
    || value.status !== "BOUND_BEFORE_CHECKPOINT_PUBLICATION"
    || !new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(value.operation)
    || value.expected_result_kind !== (runtime ? "RUNTIME_CONFIGURATION_PROBE_SHA256" : "POSTDEPLOY_RECEIPT_SHA256")) {
    reject(code);
  }
  identifier(value.operation_id, code);
  identifier(value.promotion_id, code);
  for (const field of [
    "intent_sha256", "execution_authorization_sha256", "expected_result_sha256", "binding_sha256",
  ]) digest(value[field], code);
  if (clusterSha256(bodyWithout(value, "binding_sha256")) !== value.binding_sha256) reject(code);
  return value;
}

function createPostdeployControlBinding(context, intent, expectedResultSha256) {
  digest(expectedResultSha256, "UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_INVALID");
  const runtime = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONTRACT,
    status: "BOUND_BEFORE_CHECKPOINT_PUBLICATION",
    operation: context.operation,
    operation_id: context.operation_id,
    promotion_id: intent.promotion_id,
    intent_sha256: postdeployIntentDigest(intent),
    execution_authorization_sha256: intent.execution_authorization_sha256,
    expected_result_kind: runtime ? "RUNTIME_CONFIGURATION_PROBE_SHA256" : "POSTDEPLOY_RECEIPT_SHA256",
    expected_result_sha256: expectedResultSha256,
  };
  return Object.freeze(validatePostdeployControlBinding({
    ...body, binding_sha256: clusterSha256(body),
  }));
}

function assertPostdeployControlBinding(context, intent, binding) {
  const runtime = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  if (binding.operation !== context.operation || binding.operation_id !== context.operation_id
    || binding.promotion_id !== intent.promotion_id
    || binding.intent_sha256 !== postdeployIntentDigest(intent)
    || binding.execution_authorization_sha256 !== intent.execution_authorization_sha256
    || binding.expected_result_kind !== (runtime ? "RUNTIME_CONFIGURATION_PROBE_SHA256" : "POSTDEPLOY_RECEIPT_SHA256")) {
    reject("UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_MISMATCH");
  }
  return binding;
}

async function persistPostdeployControlBinding(context, intent, paths, expectedResultSha256) {
  const binding = createPostdeployControlBinding(context, intent, expectedResultSha256);
  const names = await strictNames(
    paths.postdeployControlBindings, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  const expectedName = `${context.operation_id}.${binding.binding_sha256}.json`;
  if (matches.length > 1 || matches.length === 1 && matches[0] !== expectedName) {
    reject("UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONFLICT");
  }
  await ensureRawFile(
    path.join(paths.postdeployControlBindings, expectedName),
    Buffer.from(canonicalClusterJson(binding)), 0o400, validatePostdeployControlBinding,
    "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONFLICT",
  );
  await syncDirectory(
    paths.postdeployControlBindings, "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_SYNC_FAILED",
  );
  return binding;
}

async function loadPostdeployControlBinding(context, intent, paths) {
  const names = await strictNames(
    paths.postdeployControlBindings, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u,
    new Set(), "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_ROOT_INVALID",
  );
  const matches = names.filter((name) => operationArtifactMatches(name, context.operation_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_MISSING");
  const stored = await trustedJsonFile(
    path.join(paths.postdeployControlBindings, matches[0]), 0o400, validatePostdeployControlBinding,
    "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_INVALID",
  );
  if (!stored || matches[0] !== `${context.operation_id}.${stored.value.binding_sha256}.json`) {
    reject("UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_INVALID");
  }
  return assertPostdeployControlBinding(context, intent, stored.value);
}

function assertPostdeployEvidenceMatchesControlBinding(context, evidence, binding) {
  const actual = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? evidence.sha256 : evidence.postdeploy_receipt_sha256;
  if (actual !== binding.expected_result_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_MISMATCH");
  }
}

async function commitPostdeployCheckpoint(context, intent, sources, evidence, paths, options) {
  const runtime = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  const evidenceSha256 = runtime ? evidence.sha256 : evidence.evidence_sha256;
  const recordedAt = runtime ? evidence.value.probed_at : evidence.postdeploy_receipt.generated_at;
  const receipt = createPostdeployCheckpointReceipt(context, intent, evidenceSha256, recordedAt, sources.previous);
  const resultRaw = runtime ? evidence.raw : Buffer.from(canonicalPostdeployIdentityEvidenceJson(evidence));
  const resultValidator = runtime
    ? (value) => validateRuntimeConfigurationProbeReceipt(value, { now: options.now ?? new Date() })
    : validatePostdeployIdentityEvidence;
  const resultFile = path.join(paths.results, `${context.operation_id}.${evidenceSha256}.json`);
  await ensureRawFile(
    resultFile, resultRaw, 0o400, resultValidator, "UAT_PROMOTION_POSTDEPLOY_RESULT_CONFLICT",
    runtime ? canonicalClusterJson : canonicalPostdeployIdentityEvidenceJson,
  );
  await syncDirectory(paths.results, "UAT_PROMOTION_POSTDEPLOY_RESULT_SYNC_FAILED");
  await options.fault?.(runtime ? "AFTER_POSTDEPLOY_RUNTIME_RESULT" : "AFTER_POSTDEPLOY_IDENTITY_RESULT");
  let state = await postdeployCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.history) {
    await ensureRawFile(
      historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_HISTORY_CONFLICT",
    );
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.(runtime ? "AFTER_POSTDEPLOY_RUNTIME_HISTORY" : "AFTER_POSTDEPLOY_IDENTITY_HISTORY");
  }
  state = await postdeployCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(
      receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_RECEIPT_CONFLICT",
    );
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.(runtime ? "AFTER_POSTDEPLOY_RUNTIME_RECEIPT" : "AFTER_POSTDEPLOY_IDENTITY_RECEIPT");
  }
  state = await postdeployCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${context.operation_id}.${receipt.receipt_sha256}.tmp`);
    await atomicAlias(
      paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION",
    );
    await options.fault?.(runtime ? "AFTER_POSTDEPLOY_RUNTIME_CURRENT" : "AFTER_POSTDEPLOY_IDENTITY_CURRENT");
  }
  state = await postdeployCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_POSTDEPLOY_COMMIT_INCOMPLETE");
  const common = {
    result: "COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: postdeployIntentDigest(intent), receipt_sha256: receipt.receipt_sha256,
  };
  return runtime ? Object.freeze({ ...common, runtime_probe_result_sha256: evidenceSha256 })
    : Object.freeze({
      ...common, postdeploy_identity_evidence_sha256: evidenceSha256,
      postdeploy_receipt_sha256: evidence.postdeploy_receipt_sha256,
      release_identity_sha256: evidence.release_identity_sha256,
    });
}

async function executePostdeployCheckpoint(context, options) {
  const paths = await layout(options.filesystemRoot, false);
  const sources = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? await verifyPostdeployRuntimeSources(context, options.filesystemRoot)
    : await verifyPostdeployIdentitySources(context, options.filesystemRoot);
  const intent = await loadPostdeployIntent(context, paths, sources);
  const binding = context.execution_mode === "ORIGINAL"
    ? await persistPostdeployControlBinding(
      context, intent, paths, options.expectedPostdeployResultSha256,
    )
    : await loadPostdeployControlBinding(context, intent, paths);
  if (context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION") {
    const resultContext = Object.freeze({ ...context,
      _deploymentResult: sources.deploymentResult, _transfer: sources.transfer, _manifest: sources.manifest,
    });
    const evidence = await loadRuntimeProbeResult(
      resultContext, intent, options.filesystemRoot, options.now ?? new Date(),
    );
    assertPostdeployEvidenceMatchesControlBinding(context, evidence, binding);
    return commitPostdeployCheckpoint(context, intent, sources, evidence, paths, options);
  }
  const evidence = await loadPostdeployIdentityEvidence(context, intent, sources, options.filesystemRoot);
  assertPostdeployEvidenceMatchesControlBinding(context, evidence, binding);
  return commitPostdeployCheckpoint(context, intent, sources, evidence, paths, options);
}

function createCrossRoleCheckpointReceipt(context, intent, result, previous) {
  return createNextUatPromotionCheckpointReceipt(previous, {
    checkpoint_id: "CROSS_ROLE_UAT_EXECUTION",
    checkpoint_status: "COMMITTED",
    journal_status: "IN_PROGRESS",
    recorded_at: result.signoff_completed_at,
    checkpoint_evidence_sha256: result.result_sha256,
    checkpoint_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.promotion_intent_sha256,
    candidate_binding_sha256: intent.candidate_binding_sha256,
    database_binding_sha256: intent.database_binding_sha256,
    runtime_binding_sha256: intent.runtime_binding_sha256,
    recovery_binding_sha256: intent.preupgrade_recovery_binding_sha256,
    promotion_snapshot_binding_sha256: intent.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: intent.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: intent.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: intent.migration_fence_binding_sha256,
    migration_result_binding_sha256: intent.migration_result_binding_sha256,
    compose_deployment_binding_sha256: intent.compose_deployment_binding_sha256,
  });
}

async function crossRoleCheckpointCandidateState(paths, intent, previous, receipt) {
  const name = receiptName(receipt);
  const receiptRaw = Buffer.from(canonicalClusterJson(receipt));
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (current?.value.receipt_sha256 === receipt.receipt_sha256) {
    const chain = await committedChain(paths);
    if (chain.current?.value.receipt_sha256 !== receipt.receipt_sha256) {
      reject("UAT_PROMOTION_CROSS_ROLE_COMMITTED_STATE_MISMATCH");
    }
    return Object.freeze({ committed: true, history: true, receipt: true, current: true, receiptRaw, chain });
  }
  const chain = await committedChain(paths, { history: new Set([name]), receipts: new Set([name]) });
  if (chain.current?.value.receipt_sha256 !== previous.receipt_sha256
    || chain.current.value.intent_sha256 !== intent.promotion_intent_sha256
    || chain.current.value.checkpoint_ordinal !== 11) {
    reject("UAT_PROMOTION_CROSS_ROLE_PREVIOUS_CHANGED");
  }
  const history = await trustedJsonFile(
    historyFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_HISTORY_INVALID",
  );
  const storedReceipt = await trustedJsonFile(
    receiptFile(paths, receipt), 0o400, validateUatPromotionCheckpointReceipt,
    "UAT_PROMOTION_RECEIPT_INVALID",
  );
  const historyDone = history?.raw.equals(receiptRaw) ?? false;
  const receiptDone = storedReceipt?.raw.equals(receiptRaw) ?? false;
  if (history !== null && !historyDone || storedReceipt !== null && !receiptDone) {
    reject("UAT_PROMOTION_CROSS_ROLE_PUBLICATION_CONFLICT");
  }
  if (receiptDone && !historyDone) reject("UAT_PROMOTION_CROSS_ROLE_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, current: false, receiptRaw, chain });
}

async function commitCrossRoleCheckpoint(context, intent, sources, paths, options) {
  const result = sources.result;
  const resultFile = path.join(paths.results, `${context.operation_id}.${result.result_sha256}.json`);
  await ensureRawFile(
    resultFile, sources.resultRaw, 0o400,
    (value) => validateUatPromotionCrossRoleResult(value, { template: sources.contract }),
    "UAT_PROMOTION_CROSS_ROLE_RESULT_CONFLICT", canonicalUatPromotionCrossRoleResultJson,
  );
  await syncDirectory(paths.results, "UAT_PROMOTION_CROSS_ROLE_RESULT_SYNC_FAILED");
  await options.fault?.("AFTER_CROSS_ROLE_RESULT");
  const receipt = createCrossRoleCheckpointReceipt(context, intent, result, sources.previous);
  let state = await crossRoleCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.history) {
    await ensureRawFile(
      historyFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_HISTORY_CONFLICT",
    );
    await syncDirectory(paths.history, "UAT_PROMOTION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_CROSS_ROLE_HISTORY");
  }
  state = await crossRoleCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.receipt) {
    await ensureRawFile(
      receiptFile(paths, receipt), state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      "UAT_PROMOTION_RECEIPT_CONFLICT",
    );
    await syncDirectory(paths.receipts, "UAT_PROMOTION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_CROSS_ROLE_RECEIPT");
  }
  state = await crossRoleCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${context.operation_id}.${receipt.receipt_sha256}.tmp`);
    await atomicAlias(
      paths.current, temporary, state.receiptRaw, 0o400, validateUatPromotionCheckpointReceipt,
      state.chain.current?.raw ?? null, "UAT_PROMOTION_CURRENT_PUBLICATION",
    );
    await options.fault?.("AFTER_CROSS_ROLE_CURRENT");
  }
  state = await crossRoleCheckpointCandidateState(paths, intent, sources.previous, receipt);
  if (!state.committed) reject("UAT_PROMOTION_CROSS_ROLE_COMMIT_INCOMPLETE");
  return Object.freeze({
    result: "COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.cross_role_intent_sha256,
    receipt_sha256: receipt.receipt_sha256,
    cross_role_result_sha256: result.result_sha256,
    evidence_subject_sha256: result.evidence_subject_sha256,
    approval_subject_sha256: result.approval.approval_subject_sha256,
  });
}

async function executeCrossRoleCheckpoint(context, options) {
  const paths = await layout(options.filesystemRoot, false);
  const sources = await verifyCrossRoleSources(context, options.filesystemRoot, options);
  const intent = await loadCrossRoleIntent(context, paths, sources);
  return commitCrossRoleCheckpoint(context, intent, sources, paths, options);
}

function recoveryPlan(context, decision, reason) {
  const body = {
    schema_version: 3,
    contract: UAT_PROMOTION_RECOVERY_CONTRACT,
    execution_authorization_id: context.execution_authorization_id,
    execution_authorization_sha256: context.execution_authorization_sha256,
    prepared_at: context.execution_created_at,
    original_operation: context.operation,
    original_operation_id: context.operation_id,
    promotion_id: context.parameters.promotion_id,
    original_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: context.expected_intent_sha256,
    decision,
    reason,
  };
  return Object.freeze({ ...body, recovery_sha256: clusterSha256(body) });
}

function validateRecoveryPlan(value) {
  exactKeys(value, [
    "schema_version", "contract", "execution_authorization_id", "execution_authorization_sha256", "prepared_at",
    "original_operation", "original_operation_id", "promotion_id", "original_authorization_sha256", "intent_sha256",
    "decision", "reason", "recovery_sha256",
  ], "UAT_PROMOTION_RECOVERY_INVALID");
  if (value.schema_version !== 3 || value.contract !== UAT_PROMOTION_RECOVERY_CONTRACT
    || !new Set(["BEGIN", "CAPTURE_SNAPSHOT", "QUIESCE_WRITERS", "MIGRATION_AUTHORIZATION", "MIGRATION_EXECUTION", "COMPOSE_DEPLOYMENT", "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY", "CROSS_ROLE_UAT"]).has(value.original_operation)
    || !new Set(["RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"]).has(value.decision)
    || (value.decision === "QUARANTINE") !== (typeof value.reason === "string")) reject("UAT_PROMOTION_RECOVERY_INVALID");
  identifier(value.execution_authorization_id, "UAT_PROMOTION_RECOVERY_INVALID");
  identifier(value.original_operation_id, "UAT_PROMOTION_RECOVERY_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_RECOVERY_INVALID");
  iso(value.prepared_at, "UAT_PROMOTION_RECOVERY_INVALID");
  for (const field of ["execution_authorization_sha256", "original_authorization_sha256", "intent_sha256", "recovery_sha256"]) digest(value[field], "UAT_PROMOTION_RECOVERY_INVALID");
  if (clusterSha256(bodyWithout(value, "recovery_sha256")) !== value.recovery_sha256) reject("UAT_PROMOTION_RECOVERY_INVALID");
  return value;
}

function recoverableStateFailure(error) {
  return error instanceof UatPromotionTransactionError && [
    "UAT_PROMOTION_INTENT_INVALID", "UAT_PROMOTION_INTENT_BINDING_INVALID", "UAT_PROMOTION_PUBLICATION_CONFLICT",
    "UAT_PROMOTION_INTENT_ROOT_INVALID",
    "UAT_PROMOTION_PUBLICATION_STAGE_ORDER_INVALID", "UAT_PROMOTION_GENERATION_INVALID", "UAT_PROMOTION_HISTORY_INVALID",
    "UAT_PROMOTION_RECEIPT_INVALID", "UAT_PROMOTION_CURRENT_INVALID", "UAT_PROMOTION_HISTORY_RECEIPT_MISMATCH",
    "UAT_PROMOTION_CHAIN_INVALID", "UAT_PROMOTION_GENERATION_CHAIN_INVALID", "UAT_PROMOTION_CHECKPOINT_CHAIN_INVALID",
    "UAT_PROMOTION_CANDIDATE_SOURCE_INVALID", "UAT_PROMOTION_MANIFEST_SOURCE_INVALID", "UAT_PROMOTION_MANIFEST_BINDING_INVALID",
    "UAT_PROMOTION_RUNTIME_SOURCE_INVALID", "UAT_PROMOTION_RUNTIME_BINDING_INVALID", "UAT_PROMOTION_RECOVERY_SOURCE_INVALID",
    "UAT_PROMOTION_RECOVERY_DATABASE_MISMATCH", "UAT_PROMOTION_CURRENT_SOURCE_INVALID",
    "UAT_PROMOTION_SNAPSHOT_", "UAT_PROMOTION_CURRENT_INVALID", "UAT_PROMOTION_HISTORY_INVALID",
    "UAT_PROMOTION_QUIESCE_",
    "UAT_PROMOTION_MIGRATION_AUTHORIZATION_",
    "UAT_PROMOTION_MIGRATION_EXECUTION_", "UAT_PROMOTION_MIGRATION_GRANT_", "UAT_PROMOTION_MIGRATION_RESULT_",
    "UAT_PROMOTION_COMPOSE_DEPLOYMENT_", "UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_",
    "UAT_PROMOTION_POSTDEPLOY_", "RUNTIME_CONFIGURATION_PROBE_", "POSTDEPLOY_", "RELEASE_",
    "UAT_PROMOTION_CROSS_ROLE_",
  ].some((prefix) => error.code.startsWith(prefix));
}

async function alreadyCommittedPostdeployResult(context, paths, intent) {
  const chain = await committedChain(paths);
  const current = chain.current?.value;
  const runtime = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  const binding = await loadPostdeployControlBinding(context, intent, paths);
  const expectedCheckpoint = runtime ? "POST_DEPLOY_RUNTIME_CONFIGURATION" : "POST_DEPLOY_IDENTITY";
  if (current?.checkpoint_id !== expectedCheckpoint
    || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
    || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
    || current.compose_deployment_binding_sha256 !== intent.compose_deployment_binding_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_COMMITTED_STATE_MISMATCH");
  }
  const resultFile = path.join(paths.results, `${intent.verification_operation_id}.${current.checkpoint_evidence_sha256}.json`);
  if (runtime) {
    const stored = await trustedJsonFile(
      resultFile, 0o400,
      (value) => validateRuntimeConfigurationProbeReceipt(value, { now: new Date(value.probed_at) }),
      "UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_INVALID", 0, false,
    );
    if (!stored || sha256(stored.raw) !== current.checkpoint_evidence_sha256
      || stored.raw.toString("utf8") !== canonicalRuntimeConfigurationProbeJson(stored.value)) {
      reject("UAT_PROMOTION_POSTDEPLOY_RUNTIME_RESULT_INVALID");
    }
    assertPostdeployEvidenceMatchesControlBinding(
      context, { sha256: current.checkpoint_evidence_sha256 }, binding,
    );
    return Object.freeze({
      result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
      intent_sha256: postdeployIntentDigest(intent), receipt_sha256: current.receipt_sha256,
      runtime_probe_result_sha256: current.checkpoint_evidence_sha256,
    });
  }
  const stored = await trustedJsonFile(
    resultFile, 0o400, validatePostdeployIdentityEvidence,
    "UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_INVALID", 0, true,
    canonicalPostdeployIdentityEvidenceJson,
  );
  if (!stored || stored.value.evidence_sha256 !== current.checkpoint_evidence_sha256) {
    reject("UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_INVALID");
  }
  assertPostdeployEvidenceMatchesControlBinding(context, stored.value, binding);
  return Object.freeze({
    result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: postdeployIntentDigest(intent), receipt_sha256: current.receipt_sha256,
    postdeploy_identity_evidence_sha256: stored.value.evidence_sha256,
    postdeploy_receipt_sha256: stored.value.postdeploy_receipt_sha256,
    release_identity_sha256: stored.value.release_identity_sha256,
  });
}

async function assessPostdeployRecovery(context, paths, options) {
  const storedIntent = await loadStoredPostdeployIntent(context, paths);
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  const expectedCheckpoint = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? "POST_DEPLOY_RUNTIME_CONFIGURATION" : "POST_DEPLOY_IDENTITY";
  if (current?.value.checkpoint_id === expectedCheckpoint
    && current.value.previous_checkpoint_receipt_sha256 === storedIntent.previous_checkpoint_receipt_sha256
    && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
    && current.value.compose_deployment_binding_sha256 === storedIntent.compose_deployment_binding_sha256) {
    await alreadyCommittedPostdeployResult(context, paths, storedIntent);
    return "ALREADY_COMMITTED";
  }
  if ((options.now ?? new Date()).getTime() >= Date.parse(context.parameters.verification_expires_at)) {
    reject("UAT_PROMOTION_POSTDEPLOY_AUTHORIZATION_WINDOW_EXPIRED");
  }
  const sources = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? await verifyPostdeployRuntimeSources(context, options.filesystemRoot)
    : await verifyPostdeployIdentitySources(context, options.filesystemRoot);
  const intent = await loadPostdeployIntent(context, paths, sources);
  const binding = await loadPostdeployControlBinding(context, intent, paths);
  let evidence;
  if (context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION") {
    const resultContext = Object.freeze({ ...context,
      _deploymentResult: sources.deploymentResult, _transfer: sources.transfer, _manifest: sources.manifest,
    });
    evidence = await loadRuntimeProbeResult(
      resultContext, intent, options.filesystemRoot, options.now ?? new Date(),
    );
  } else {
    evidence = await loadPostdeployIdentityEvidence(context, intent, sources, options.filesystemRoot);
  }
  assertPostdeployEvidenceMatchesControlBinding(context, evidence, binding);
  const evidenceSha256 = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? evidence.sha256 : evidence.evidence_sha256;
  const recordedAt = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
    ? evidence.value.probed_at : evidence.postdeploy_receipt.generated_at;
  const receipt = createPostdeployCheckpointReceipt(context, intent, evidenceSha256, recordedAt, sources.previous);
  const state = await postdeployCheckpointCandidateState(paths, intent, sources.previous, receipt);
  return state.committed ? "ALREADY_COMMITTED" : "RESUME_PUBLICATION";
}

async function loadDurableCrossRoleResult(intent, paths, filesystemRoot) {
  const contract = await readAuthorizedSource(
    intent.parameters.cross_role_contract_source, filesystemRoot,
    validateCrossRoleUatTemplate, "UAT_PROMOTION_CROSS_ROLE_CONTRACT_SOURCE_INVALID",
  );
  if (sha256(contract.raw) !== intent.cross_role_contract_file_sha256
    || contract.value.artifact_sha256 !== intent.cross_role_contract_artifact_sha256) {
    reject("UAT_PROMOTION_CROSS_ROLE_STORED_RESULT_MISMATCH");
  }
  const resultFile = path.join(
    paths.results, `${intent.verification_operation_id}.${intent.cross_role_result_sha256}.json`,
  );
  const stored = await trustedJsonFile(
    resultFile, 0o400,
    (value) => validateUatPromotionCrossRoleResult(value, { template: contract.value }),
    "UAT_PROMOTION_CROSS_ROLE_RESULT_INVALID", 0, true,
    canonicalUatPromotionCrossRoleResultJson,
  );
  if (stored === null) return null;
  const result = stored.value;
  if (sha256(stored.raw) !== intent.cross_role_result_file_sha256
    || stored.value.result_sha256 !== intent.cross_role_result_sha256
    || result.result_id !== intent.parameters.result_id
    || result.verification_operation_id !== intent.verification_operation_id
    || result.promotion_id !== intent.promotion_id
    || result.promotion_generation !== intent.promotion_generation
    || result.supervisor_bundle_sha256 !== intent.supervisor_bundle_sha256
    || result.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
    || result.postdeploy_identity_evidence_sha256 !== intent.postdeploy_identity_evidence_sha256
    || result.release_identity_sha256 !== intent.release_identity_sha256
    || result.cross_role_contract_artifact_sha256 !== intent.cross_role_contract_artifact_sha256
    || result.authorization_matrix_artifact_sha256 !== intent.authorization_matrix_artifact_sha256
    || result.authorization_matrix_source_manifest_sha256
      !== intent.authorization_matrix_source_manifest_sha256
    || result.human_execution_authorization_sha256 === intent.execution_authorization_sha256
    || result.evidence_subject_sha256 === ZERO_SHA256
    || result.approval.approval_subject_sha256 === ZERO_SHA256) {
    reject("UAT_PROMOTION_CROSS_ROLE_STORED_RESULT_MISMATCH");
  }
  return Object.freeze({ contract: contract.value, result, resultRaw: stored.raw });
}

async function loadCrossRolePreviousCheckpoint(intent, paths) {
  const stored = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  const previous = stored?.value;
  if (!stored || stored.raw.toString("utf8") !== canonicalClusterJson(previous)
    || previous.promotion_id !== intent.promotion_id
    || previous.promotion_generation !== intent.promotion_generation
    || previous.checkpoint_id !== "POST_DEPLOY_IDENTITY" || previous.checkpoint_ordinal !== 11
    || previous.checkpoint_status !== "COMMITTED" || previous.journal_status !== "IN_PROGRESS"
    || previous.receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
    || previous.intent_sha256 !== intent.promotion_intent_sha256
    || previous.original_authorization_sha256 !== intent.parameters.promotion_original_authorization_sha256
    || previous.checkpoint_evidence_sha256 !== intent.postdeploy_identity_evidence_sha256
    || previous.candidate_binding_sha256 !== intent.candidate_binding_sha256
    || previous.database_binding_sha256 !== intent.database_binding_sha256
    || previous.runtime_binding_sha256 !== intent.runtime_binding_sha256
    || previous.recovery_binding_sha256 !== intent.preupgrade_recovery_binding_sha256
    || previous.promotion_snapshot_binding_sha256 !== intent.promotion_snapshot_binding_sha256
    || previous.writer_quiesce_binding_sha256 !== intent.writer_quiesce_binding_sha256
    || previous.migration_authorization_binding_sha256 !== intent.migration_authorization_binding_sha256
    || previous.migration_fence_binding_sha256 !== intent.migration_fence_binding_sha256
    || previous.migration_result_binding_sha256 !== intent.migration_result_binding_sha256
    || previous.compose_deployment_binding_sha256 !== intent.compose_deployment_binding_sha256
    || previous.authorization_sha256_chain.includes(intent.execution_authorization_sha256)
    || Date.parse(intent.created_at) < Date.parse(previous.recorded_at)
    || Date.parse(intent.expires_at) > Date.parse(previous.promotion_expires_at)) {
    reject("UAT_PROMOTION_CROSS_ROLE_PREVIOUS_CHANGED");
  }
  return previous;
}

async function alreadyCommittedCrossRoleResult(context, paths, intent, filesystemRoot) {
  const chain = await committedChain(paths);
  const current = chain.current?.value;
  if (current?.checkpoint_id !== "CROSS_ROLE_UAT_EXECUTION" || current.checkpoint_ordinal !== 12
    || current.journal_status !== "IN_PROGRESS"
    || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
    || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
    || current.checkpoint_evidence_sha256 !== intent.cross_role_result_sha256
    || current.compose_deployment_binding_sha256 !== intent.compose_deployment_binding_sha256) {
    reject("UAT_PROMOTION_CROSS_ROLE_COMMITTED_STATE_MISMATCH");
  }
  const durable = await loadDurableCrossRoleResult(intent, paths, filesystemRoot);
  if (durable === null || durable.result.signoff_completed_at !== current.recorded_at) {
    reject("UAT_PROMOTION_CROSS_ROLE_COMMITTED_RESULT_MISMATCH");
  }
  return Object.freeze({
    result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
    intent_sha256: intent.cross_role_intent_sha256, receipt_sha256: current.receipt_sha256,
    cross_role_result_sha256: durable.result.result_sha256,
    evidence_subject_sha256: durable.result.evidence_subject_sha256,
    approval_subject_sha256: durable.result.approval.approval_subject_sha256,
  });
}

async function assessCrossRoleRecovery(context, paths, options) {
  const storedIntent = await loadStoredCrossRoleIntent(context, paths);
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (current?.value.checkpoint_id === "CROSS_ROLE_UAT_EXECUTION"
    && current.value.previous_checkpoint_receipt_sha256
      === storedIntent.previous_checkpoint_receipt_sha256
    && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
    && current.value.checkpoint_evidence_sha256 === storedIntent.cross_role_result_sha256) {
    await alreadyCommittedCrossRoleResult(context, paths, storedIntent, options.filesystemRoot);
    return "ALREADY_COMMITTED";
  }
  const durable = await loadDurableCrossRoleResult(
    storedIntent, paths, options.filesystemRoot,
  );
  if (durable !== null) {
    const previous = await loadCrossRolePreviousCheckpoint(storedIntent, paths);
    const receipt = createCrossRoleCheckpointReceipt(context, storedIntent, durable.result, previous);
    const state = await crossRoleCheckpointCandidateState(paths, storedIntent, previous, receipt);
    return state.committed ? "ALREADY_COMMITTED" : "RESUME_PUBLICATION";
  }
  const sources = await verifyCrossRoleSources(context, options.filesystemRoot, options);
  const intent = await loadCrossRoleIntent(context, paths, sources);
  const receipt = createCrossRoleCheckpointReceipt(context, intent, sources.result, sources.previous);
  const state = await crossRoleCheckpointCandidateState(paths, intent, sources.previous, receipt);
  return state.committed ? "ALREADY_COMMITTED" : "RESUME_PUBLICATION";
}

async function prepareRecovery(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  let decision = "RESUME_PUBLICATION";
  let reason = null;
  try {
    if (context.operation === "BEGIN") {
      const intent = await loadIntent(context, paths);
      const receipt = createInitialReceipt(context, intent);
      const state = await candidateState(paths, intent, receipt);
      if (state.committed) decision = "ALREADY_COMMITTED";
      else if (Date.parse(context.execution_created_at) >= Date.parse(context.parameters.promotion_expires_at)) {
        decision = "QUARANTINE";
        reason = "UAT_PROMOTION_AUTHORIZATION_WINDOW_EXPIRED";
      } else {
        await verifyAuthorizedSources(context, options.filesystemRoot);
      }
    } else if (context.operation === "CAPTURE_SNAPSHOT") {
      const storedIntent = await loadStoredSnapshotIntent(context, paths);
      const current = await trustedJsonFile(paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID");
      if (current?.value.checkpoint_id === "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT"
        && current.value.previous_checkpoint_receipt_sha256 === storedIntent.previous_checkpoint_receipt_sha256
        && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
        && current.value.promotion_snapshot_binding_sha256 === storedIntent.promotion_snapshot_binding_sha256) {
        await committedChain(paths);
        decision = "ALREADY_COMMITTED";
      } else {
        const sources = await verifySnapshotAuthorizedSources(context, options.filesystemRoot, options);
        const intent = await loadSnapshotIntent(context, paths, sources);
        const receipt = createSnapshotCheckpointReceipt(context, intent, sources.previous);
        const state = await checkpointCandidateState(paths, intent, sources.previous, receipt);
        if (state.committed) decision = "ALREADY_COMMITTED";
        else if (Date.parse(context.execution_created_at) >= Date.parse(context.parameters.snapshot_expires_at)
          && !state.history && !state.receipt) {
          decision = "QUARANTINE";
          reason = "UAT_PROMOTION_SNAPSHOT_AUTHORIZATION_WINDOW_EXPIRED";
        }
      }
    } else if (context.operation === "QUIESCE_WRITERS") {
      const storedIntent = await loadStoredQuiesceIntent(context, paths);
      const current = await trustedJsonFile(paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID");
      if (current?.value.checkpoint_id === "WRITER_QUIESCE_RECEIPT"
        && current.value.previous_checkpoint_receipt_sha256 === storedIntent.previous_checkpoint_receipt_sha256
        && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
        && current.value.promotion_snapshot_binding_sha256 === storedIntent.promotion_snapshot_binding_sha256
        && current.value.writer_quiesce_binding_sha256 === storedIntent.writer_quiesce_binding_sha256
        && current.value.checkpoint_evidence_sha256 === storedIntent.quiesce_intent_sha256) {
        await committedChain(paths);
        decision = "ALREADY_COMMITTED";
      } else {
        const sources = await verifyQuiesceAuthorizedSources(context, options.filesystemRoot, options);
        const intent = await loadQuiesceIntent(context, paths, sources);
        const receipt = createQuiesceCheckpointReceipt(context, intent, sources.previous);
        const state = await quiesceCandidateState(paths, intent, sources.previous, receipt);
        if (state.committed) decision = "ALREADY_COMMITTED";
        else if (Date.parse(context.execution_created_at) >= Date.parse(context.parameters.quiesce_expires_at)
          && !state.history && !state.receipt) {
          decision = "QUARANTINE";
          reason = "UAT_PROMOTION_QUIESCE_AUTHORIZATION_WINDOW_EXPIRED";
        }
      }
    } else if (context.operation === "MIGRATION_AUTHORIZATION") {
      const storedIntent = await loadStoredMigrationAuthorizationIntent(context, paths);
      const current = await trustedJsonFile(
        paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
      );
      if (current?.value.checkpoint_id === "ONE_TIME_MIGRATION_AUTHORIZATION"
        && current.value.previous_checkpoint_receipt_sha256 === storedIntent.previous_checkpoint_receipt_sha256
        && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
        && current.value.migration_authorization_binding_sha256 === storedIntent.migration_authorization_binding_sha256
        && current.value.checkpoint_evidence_sha256 === storedIntent.migration_authorization_intent_sha256) {
        await committedChain(paths);
        decision = "ALREADY_COMMITTED";
      } else {
        const sources = await verifyMigrationAuthorizationSources(context, options.filesystemRoot);
        const intent = await loadMigrationAuthorizationIntent(context, paths, sources);
        const receipt = createMigrationAuthorizationCheckpointReceipt(context, intent, sources.previous);
        const state = await migrationAuthorizationCandidateState(paths, intent, sources.previous, receipt);
        if (state.committed) decision = "ALREADY_COMMITTED";
        else if (Date.parse(context.execution_created_at) >= Date.parse(context.parameters.authorization_expires_at)
          && !state.history && !state.receipt) {
          decision = "QUARANTINE";
          reason = "UAT_PROMOTION_MIGRATION_AUTHORIZATION_WINDOW_EXPIRED";
        }
      }
    } else if (context.operation === "MIGRATION_EXECUTION") {
      const storedIntent = await loadStoredMigrationExecutionIntent(context, paths);
      const storedGrant = await loadStoredMigrationExecutionGrant(paths, storedIntent);
      const result = await loadMigrationExecutionResult(paths, storedIntent, storedGrant);
      const current = await trustedJsonFile(
        paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
      );
      if (current?.value.checkpoint_id === "MIGRATION_COMMIT_RECEIPT"
        && current.value.previous_checkpoint_receipt_sha256 === storedIntent.previous_checkpoint_receipt_sha256
        && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
        && current.value.checkpoint_evidence_sha256 === result.result_sha256
        && current.value.migration_authorization_binding_sha256 === storedIntent.migration_authorization_binding_sha256
        && current.value.migration_fence_binding_sha256 === result.database_fence_binding_sha256
        && current.value.migration_result_binding_sha256 === result.migration_result_binding_sha256) {
        await committedChain(paths);
        decision = "ALREADY_COMMITTED";
      } else {
        const sources = await verifyMigrationExecutionSources(context, options.filesystemRoot);
        const artifacts = await loadMigrationExecutionArtifacts(context, paths, sources);
        try { assertUatPromotionMigrationEngineResultMatchesAllowlist(result.engine_result, sources.manifest.migrations.entries); }
        catch { reject("UAT_PROMOTION_MIGRATION_RESULT_ALLOWLIST_INVALID"); }
        const receipt = createMigrationExecutionCheckpointReceipt(context, artifacts.intent, result, sources.previous);
        const state = await migrationExecutionCandidateState(
          paths, artifacts.intent, sources.previous, receipt,
        );
        if (state.committed) decision = "ALREADY_COMMITTED";
      }
    } else if (context.operation === "CROSS_ROLE_UAT") {
      decision = await assessCrossRoleRecovery(context, paths, options);
    } else if (new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(context.operation)) {
      decision = await assessPostdeployRecovery(context, paths, options);
    } else {
      const storedIntent = await loadStoredComposeDeploymentIntent(context, paths);
      const result = await loadComposeDeploymentResult(paths, storedIntent);
      const transfer = await loadComposeDeploymentFenceTransfer(paths, storedIntent, result);
      const current = await trustedJsonFile(
        paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
      );
      const binding = composeDeploymentBinding(result, transfer);
      if (current?.value.checkpoint_id === "COMPOSE_DEPLOYMENT_RECEIPT"
        && current.value.previous_checkpoint_receipt_sha256 === storedIntent.previous_checkpoint_receipt_sha256
        && current.value.checkpoint_authorization_sha256 === storedIntent.execution_authorization_sha256
        && current.value.checkpoint_evidence_sha256 === result.result_sha256
        && current.value.migration_fence_binding_sha256 === storedIntent.migration_fence_binding_sha256
        && current.value.migration_result_binding_sha256 === storedIntent.migration_result_binding_sha256
        && current.value.compose_deployment_binding_sha256 === binding) {
        await committedChain(paths);
        decision = "ALREADY_COMMITTED";
      } else {
        const sources = await verifyComposeDeploymentSources(context, options.filesystemRoot);
        const intent = await loadComposeDeploymentIntent(context, paths, sources);
        const receipt = createComposeDeploymentCheckpointReceipt(
          context, intent, result, transfer, sources.previous,
        );
        const state = await composeDeploymentCandidateState(paths, intent, sources.previous, receipt);
        if (state.committed) decision = "ALREADY_COMMITTED";
      }
    }
  } catch (error) {
    if (!recoverableStateFailure(error)) throw error;
    decision = "QUARANTINE";
    reason = error.code;
  }
  const plan = recoveryPlan(context, decision, reason);
  const raw = Buffer.from(canonicalClusterJson(plan));
  const file = path.join(paths.recoveries, `${context.execution_authorization_id}.${plan.recovery_sha256}.json`);
  await ensureRawFile(file, raw, 0o400, validateRecoveryPlan, "UAT_PROMOTION_RECOVERY_CONFLICT");
  await syncDirectory(paths.recoveries, "UAT_PROMOTION_RECOVERY_SYNC_FAILED");
  return Object.freeze({ result: "RECOVERY_PREPARED", promotion_id: context.parameters.promotion_id, intent_sha256: context.expected_intent_sha256, recovery_sha256: plan.recovery_sha256, decision });
}

async function loadRecoveryPlan(context, paths) {
  const names = await strictNames(paths.recoveries, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_RECOVERY_ROOT_INVALID");
  const matches = names.filter((name) => operationArtifactMatches(name, context.execution_authorization_id));
  if (matches.length !== 1) reject("UAT_PROMOTION_RECOVERY_MISSING");
  const stored = await trustedJsonFile(path.join(paths.recoveries, matches[0]), 0o400, validateRecoveryPlan, "UAT_PROMOTION_RECOVERY_INVALID");
  if (!stored || stored.value.original_operation !== context.operation || stored.value.original_operation_id !== context.operation_id
    || stored.value.promotion_id !== context.parameters.promotion_id
    || stored.value.original_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.execution_authorization_sha256 !== context.execution_authorization_sha256
    || stored.value.intent_sha256 !== context.expected_intent_sha256) reject("UAT_PROMOTION_RECOVERY_BINDING_INVALID");
  return stored.value;
}

function validateQuarantine(value) {
  exactKeys(value, [
    "schema_version", "contract", "status", "quarantined_at", "operation", "operation_id", "promotion_id",
    "intent_sha256", "recovery_sha256", "reason", "preservation", "quarantine_sha256",
  ], "UAT_PROMOTION_QUARANTINE_INVALID");
  if (value.schema_version !== 3 || value.contract !== UAT_PROMOTION_QUARANTINE_CONTRACT || value.status !== "QUARANTINED"
    || !new Set(["BEGIN", "CAPTURE_SNAPSHOT", "QUIESCE_WRITERS", "MIGRATION_AUTHORIZATION", "MIGRATION_EXECUTION", "COMPOSE_DEPLOYMENT", "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY", "CROSS_ROLE_UAT"]).has(value.operation)
    || value.preservation !== "FILES_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE" || typeof value.reason !== "string" || value.reason.length < 4) reject("UAT_PROMOTION_QUARANTINE_INVALID");
  identifier(value.operation_id, "UAT_PROMOTION_QUARANTINE_INVALID");
  identifier(value.promotion_id, "UAT_PROMOTION_QUARANTINE_INVALID");
  iso(value.quarantined_at, "UAT_PROMOTION_QUARANTINE_INVALID");
  for (const field of ["intent_sha256", "recovery_sha256", "quarantine_sha256"]) digest(value[field], "UAT_PROMOTION_QUARANTINE_INVALID");
  if (clusterSha256(bodyWithout(value, "quarantine_sha256")) !== value.quarantine_sha256) reject("UAT_PROMOTION_QUARANTINE_INVALID");
  return value;
}

async function executeRecovery(context, options) {
  const paths = await layout(options.filesystemRoot, false);
  const plan = await loadRecoveryPlan(context, paths);
  if (plan.decision !== "QUARANTINE") {
    let result;
    if (context.operation === "BEGIN") {
      const intent = await loadIntent(context, paths);
      if (plan.decision === "RESUME_PUBLICATION") await verifyAuthorizedSources(context, options.filesystemRoot);
      result = await commitIntent(context, intent, paths, options);
    } else if (context.operation === "CAPTURE_SNAPSHOT") {
      if (plan.decision === "ALREADY_COMMITTED") {
        const intent = await loadStoredSnapshotIntent(context, paths);
        const chain = await committedChain(paths);
        const current = chain.current?.value;
        if (current?.checkpoint_id !== "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT"
          || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
          || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
          || current.promotion_snapshot_binding_sha256 !== intent.promotion_snapshot_binding_sha256) reject("UAT_PROMOTION_SNAPSHOT_COMMITTED_STATE_MISMATCH");
        result = Object.freeze({ result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id, intent_sha256: intent.snapshot_intent_sha256, receipt_sha256: current.receipt_sha256 });
      } else {
        const sources = await verifySnapshotAuthorizedSources(context, options.filesystemRoot, options);
        const intent = await loadSnapshotIntent(context, paths, sources);
        result = await commitSnapshot(context, intent, sources, paths, options);
      }
    } else if (context.operation === "QUIESCE_WRITERS") {
      if (plan.decision === "ALREADY_COMMITTED") {
        const intent = await loadStoredQuiesceIntent(context, paths);
        const chain = await committedChain(paths);
        const current = chain.current?.value;
        if (current?.checkpoint_id !== "WRITER_QUIESCE_RECEIPT"
          || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
          || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
          || current.promotion_snapshot_binding_sha256 !== intent.promotion_snapshot_binding_sha256
          || current.writer_quiesce_binding_sha256 !== intent.writer_quiesce_binding_sha256
          || current.checkpoint_evidence_sha256 !== intent.quiesce_intent_sha256) {
          reject("UAT_PROMOTION_QUIESCE_COMMITTED_STATE_MISMATCH");
        }
        result = Object.freeze({
          result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
          intent_sha256: intent.quiesce_intent_sha256, receipt_sha256: current.receipt_sha256,
        });
      } else {
        const sources = await verifyQuiesceAuthorizedSources(context, options.filesystemRoot, options);
        const intent = await loadQuiesceIntent(context, paths, sources);
        result = await commitQuiesce(context, intent, sources, paths, options);
      }
    } else if (context.operation === "MIGRATION_AUTHORIZATION" && plan.decision === "ALREADY_COMMITTED") {
      const intent = await loadStoredMigrationAuthorizationIntent(context, paths);
      const chain = await committedChain(paths);
      const current = chain.current?.value;
      if (current?.checkpoint_id !== "ONE_TIME_MIGRATION_AUTHORIZATION"
        || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
        || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
        || current.migration_authorization_binding_sha256 !== intent.migration_authorization_binding_sha256
        || current.checkpoint_evidence_sha256 !== intent.migration_authorization_intent_sha256) {
        reject("UAT_PROMOTION_MIGRATION_AUTHORIZATION_COMMITTED_STATE_MISMATCH");
      }
      result = Object.freeze({
        result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
        intent_sha256: intent.migration_authorization_intent_sha256, receipt_sha256: current.receipt_sha256,
      });
    } else if (context.operation === "MIGRATION_AUTHORIZATION") {
      const sources = await verifyMigrationAuthorizationSources(context, options.filesystemRoot);
      const intent = await loadMigrationAuthorizationIntent(context, paths, sources);
      result = await commitMigrationAuthorization(context, intent, sources, paths, options);
    } else if (context.operation === "MIGRATION_EXECUTION" && plan.decision === "ALREADY_COMMITTED") {
      const intent = await loadStoredMigrationExecutionIntent(context, paths);
      const grant = await loadStoredMigrationExecutionGrant(paths, intent);
      const migrationResult = await loadMigrationExecutionResult(paths, intent, grant);
      const chain = await committedChain(paths);
      const current = chain.current?.value;
      if (current?.checkpoint_id !== "MIGRATION_COMMIT_RECEIPT"
        || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
        || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
        || current.checkpoint_evidence_sha256 !== migrationResult.result_sha256
        || current.migration_authorization_binding_sha256 !== intent.migration_authorization_binding_sha256
        || current.migration_fence_binding_sha256 !== migrationResult.database_fence_binding_sha256
        || current.migration_result_binding_sha256 !== migrationResult.migration_result_binding_sha256) {
        reject("UAT_PROMOTION_MIGRATION_EXECUTION_COMMITTED_STATE_MISMATCH");
      }
      result = Object.freeze({
        result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
        intent_sha256: intent.migration_execution_intent_sha256,
        receipt_sha256: current.receipt_sha256, migration_result_sha256: migrationResult.result_sha256,
      });
    } else if (context.operation === "MIGRATION_EXECUTION") {
      const sources = await verifyMigrationExecutionSources(context, options.filesystemRoot);
      const artifacts = await loadMigrationExecutionArtifacts(context, paths, sources);
      const migrationResult = await loadMigrationExecutionResult(
        paths, artifacts.intent, artifacts.grant, sources.manifest.migrations.entries,
      );
      result = await commitMigrationExecution(
        context, artifacts.intent, migrationResult, sources, paths, options,
      );
    } else if (context.operation === "CROSS_ROLE_UAT" && plan.decision === "ALREADY_COMMITTED") {
      const intent = await loadStoredCrossRoleIntent(context, paths);
      result = await alreadyCommittedCrossRoleResult(
        context, paths, intent, options.filesystemRoot,
      );
    } else if (context.operation === "CROSS_ROLE_UAT") {
      const storedIntent = await loadStoredCrossRoleIntent(context, paths);
      const durable = await loadDurableCrossRoleResult(
        storedIntent, paths, options.filesystemRoot,
      );
      const sources = durable === null
        ? await verifyCrossRoleSources(context, options.filesystemRoot, options)
        : Object.freeze({ ...durable, previous: await loadCrossRolePreviousCheckpoint(storedIntent, paths) });
      const intent = durable === null
        ? await loadCrossRoleIntent(context, paths, sources) : storedIntent;
      result = await commitCrossRoleCheckpoint(context, intent, sources, paths, options);
    } else if (new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(context.operation)
      && plan.decision === "ALREADY_COMMITTED") {
      const intent = await loadStoredPostdeployIntent(context, paths);
      result = await alreadyCommittedPostdeployResult(context, paths, intent);
    } else if (new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(context.operation)) {
      result = await executePostdeployCheckpoint(context, options);
    } else if (plan.decision === "ALREADY_COMMITTED") {
      const intent = await loadStoredComposeDeploymentIntent(context, paths);
      const deploymentResult = await loadComposeDeploymentResult(paths, intent);
      const transfer = await loadComposeDeploymentFenceTransfer(paths, intent, deploymentResult);
      const chain = await committedChain(paths);
      const current = chain.current?.value;
      if (current?.checkpoint_id !== "COMPOSE_DEPLOYMENT_RECEIPT"
        || current.previous_checkpoint_receipt_sha256 !== intent.previous_checkpoint_receipt_sha256
        || current.checkpoint_authorization_sha256 !== intent.execution_authorization_sha256
        || current.checkpoint_evidence_sha256 !== deploymentResult.result_sha256
        || current.migration_fence_binding_sha256 !== intent.migration_fence_binding_sha256
        || current.migration_result_binding_sha256 !== intent.migration_result_binding_sha256
        || current.compose_deployment_binding_sha256 !== composeDeploymentBinding(deploymentResult, transfer)) {
        reject("UAT_PROMOTION_COMPOSE_DEPLOYMENT_COMMITTED_STATE_MISMATCH");
      }
      result = Object.freeze({
        result: "ALREADY_COMMITTED", promotion_id: intent.promotion_id,
        intent_sha256: intent.compose_deployment_intent_sha256, receipt_sha256: current.receipt_sha256,
        deployment_result_sha256: deploymentResult.result_sha256,
        fence_transfer_sha256: transfer.transfer_sha256,
      });
    } else {
      const sources = await verifyComposeDeploymentSources(context, options.filesystemRoot);
      const intent = await loadComposeDeploymentIntent(context, paths, sources);
      const deploymentResult = await loadComposeDeploymentResult(paths, intent);
      const transfer = await loadComposeDeploymentFenceTransfer(paths, intent, deploymentResult);
      result = await commitComposeDeployment(
        context, intent, deploymentResult, transfer, sources, paths, options,
      );
    }
    return Object.freeze({ ...result, recovery_sha256: plan.recovery_sha256 });
  }
  const body = {
    schema_version: 3,
    contract: UAT_PROMOTION_QUARANTINE_CONTRACT,
    status: "QUARANTINED",
    quarantined_at: plan.prepared_at,
    operation: context.operation,
    operation_id: context.operation_id,
    promotion_id: context.parameters.promotion_id,
    intent_sha256: plan.intent_sha256,
    recovery_sha256: plan.recovery_sha256,
    reason: plan.reason,
    preservation: "FILES_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE",
  };
  const quarantine = Object.freeze({ ...body, quarantine_sha256: clusterSha256(body) });
  const raw = Buffer.from(canonicalClusterJson(quarantine));
  const file = path.join(paths.quarantine, `${context.operation_id}.${quarantine.quarantine_sha256}.json`);
  await ensureRawFile(file, raw, 0o400, validateQuarantine, "UAT_PROMOTION_QUARANTINE_CONFLICT");
  await syncDirectory(paths.quarantine, "UAT_PROMOTION_QUARANTINE_SYNC_FAILED");
  return Object.freeze({ result: "QUARANTINED", promotion_id: context.parameters.promotion_id, intent_sha256: plan.intent_sha256, recovery_sha256: plan.recovery_sha256, quarantine_sha256: quarantine.quarantine_sha256 });
}

function validatePostdeployContainment(value) {
  const code = "UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "contained_at", "operation", "operation_id",
    "promotion_id", "intent_sha256", "execution_authorization_sha256",
    "preserved_checkpoint_receipt_sha256", "deployment_result_sha256", "fence_transfer_sha256",
    "observed_checkpoint_id", "observed_checkpoint_ordinal", "external_artifact_state",
    "failure_stage", "failure_code", "preservation", "containment_sha256",
  ], code);
  const runtime = value.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  const contained = value.status === "POSTDEPLOY_FAILURE_CONTAINED_JOURNAL_UNCHANGED";
  const committedAnomaly = value.status === "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY";
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONTRACT
    || (!contained && !committedAnomaly)
    || !new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(value.operation)
    || !new Set(["ABSENT", "TRUSTED_FINAL_ARTIFACT_PRESENT", "UNTRUSTED_OR_PARTIAL"]).has(value.external_artifact_state)
    || contained && (value.observed_checkpoint_id !== (runtime ? "COMPOSE_DEPLOYMENT_RECEIPT" : "POST_DEPLOY_RUNTIME_CONFIGURATION")
      || value.observed_checkpoint_ordinal !== (runtime ? 9 : 10)
      || value.preservation !== "PREDECESSOR_CHECKPOINT_RESULT_TRANSFER_FENCE_AND_DATABASE_HANDOFF_LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION")
    || committedAnomaly && (value.observed_checkpoint_id !== (runtime ? "POST_DEPLOY_RUNTIME_CONFIGURATION" : "POST_DEPLOY_IDENTITY")
      || value.observed_checkpoint_ordinal !== (runtime ? 10 : 11)
      || value.preservation !== "COMMITTED_POSTDEPLOY_CHECKPOINT_LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION"
      || !new Set(["JOURNAL_EXECUTION", "RESULT_CROSSCHECK"]).has(value.failure_stage))
    || value.failure_stage === "RESULT_CROSSCHECK" && !committedAnomaly) reject(code);
  validatePostdeployFailure(value.failure_stage, value.failure_code);
  for (const field of ["operation_id", "promotion_id", "observed_checkpoint_id"]) identifier(value[field], code);
  iso(value.contained_at, code);
  for (const field of [
    "intent_sha256", "execution_authorization_sha256", "preserved_checkpoint_receipt_sha256",
    "deployment_result_sha256", "fence_transfer_sha256", "containment_sha256",
  ]) digest(value[field], code);
  if (clusterSha256(bodyWithout(value, "containment_sha256")) !== value.containment_sha256) reject(code);
  return value;
}

async function postdeployExternalArtifactState(context, intent, options) {
  try {
    if (context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION") {
      const sources = await verifyPostdeployRuntimeSources(context, options.filesystemRoot);
      const resultContext = Object.freeze({ ...context,
        _deploymentResult: sources.deploymentResult, _transfer: sources.transfer, _manifest: sources.manifest,
      });
      await loadRuntimeProbeResult(resultContext, intent, options.filesystemRoot, options.now ?? new Date());
      return "TRUSTED_FINAL_ARTIFACT_PRESENT";
    }
    const sources = await verifyPostdeployIdentitySources(context, options.filesystemRoot);
    await loadPostdeployIdentityEvidence(context, intent, sources, options.filesystemRoot);
    return "TRUSTED_FINAL_ARTIFACT_PRESENT";
  } catch (error) {
    const parameters = context.parameters;
    const logical = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION"
      ? `${parameters.probe_root}/${parameters.probe_id}.runtime-configuration-probe.json`
      : `${parameters.postdeploy_root}/${parameters.run_id}.postdeploy-receipt.json`;
    const metadata = await lstat(physicalPath(logical, options.filesystemRoot)).catch((failure) => {
      if (failure?.code === "ENOENT") return null;
      return Object.freeze({ present: true });
    });
    if (metadata !== null) return "UNTRUSTED_OR_PARTIAL";
    if (context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION") {
      try {
        await trustedAncestors(parameters.probe_root, options.filesystemRoot, "UAT_PROMOTION_POSTDEPLOY_RUNTIME_ROOT_INVALID");
        const probeRoot = physicalPath(parameters.probe_root, options.filesystemRoot);
        await trustedDirectory(probeRoot, new Set([0o700]), "UAT_PROMOTION_POSTDEPLOY_RUNTIME_ROOT_INVALID");
        await trustedMarker(
          path.join(probeRoot, RUNTIME_PROBE_MARKER), Buffer.from(RUNTIME_PROBE_MARKER_VALUE),
          0o400, 0, "UAT_PROMOTION_POSTDEPLOY_RUNTIME_ROOT_INVALID",
        );
      } catch { return "UNTRUSTED_OR_PARTIAL"; }
      const entries = await readdir(physicalPath(parameters.probe_root, options.filesystemRoot)).catch((failure) => (
        failure?.code === "ENOENT" ? [] : ["__UNTRUSTED_ROOT__"]
      ));
      return entries.some((name) => name.startsWith(`.${parameters.probe_id}.`) && name.endsWith(".tmp"))
        || entries.includes("__UNTRUSTED_ROOT__") ? "UNTRUSTED_OR_PARTIAL" : "ABSENT";
    }
    try {
      await trustedAncestors(parameters.postdeploy_root, options.filesystemRoot, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_ROOT_INVALID");
      const postdeployRoot = physicalPath(parameters.postdeploy_root, options.filesystemRoot);
      await trustedDirectory(postdeployRoot, new Set([0o750]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_ROOT_INVALID");
      await trustedMarker(
        path.join(postdeployRoot, RELEASE_ARTIFACT_MARKER), Buffer.from(RELEASE_ARTIFACT_MARKER_VALUE),
        0o440, 0, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_ROOT_INVALID",
      );
      await trustedAncestors(
        path.dirname(parameters.identity_root), options.filesystemRoot,
        "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID",
      );
      const identityRoot = physicalPath(parameters.identity_root, options.filesystemRoot);
      await trustedDirectory(
        identityRoot, new Set([0o750]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID",
        parameters.reader_gid,
      );
      await trustedMarker(
        path.join(identityRoot, RELEASE_IDENTITY_ROOT_MARKER), Buffer.from(RELEASE_IDENTITY_ROOT_MARKER_VALUE),
        0o440, parameters.reader_gid, "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID",
      );
    } catch { return "UNTRUSTED_OR_PARTIAL"; }
    const postdeployEntries = await readdir(
      physicalPath(parameters.postdeploy_root, options.filesystemRoot),
    ).catch(() => null);
    const preparedTemporaryPrefix = `.${parameters.run_id}.postdeploy-receipt.prepared.json.`;
    if (postdeployEntries === null || postdeployEntries.some((name) => (
      name.startsWith(preparedTemporaryPrefix) && name.endsWith(".publish.tmp")
    ))) return "UNTRUSTED_OR_PARTIAL";
    const preparedReceipt = `${parameters.postdeploy_root}/.${parameters.run_id}.postdeploy-receipt.prepared.json`;
    const transaction = `${parameters.identity_root}/${RELEASE_IDENTITY_PUBLISH_LOCK}`;
    const partialMetadata = await Promise.all([preparedReceipt, transaction].map(async (candidate) => (
      lstat(physicalPath(candidate, options.filesystemRoot)).catch((failure) => (
        failure?.code === "ENOENT" ? null : Object.freeze({ present: true })
      ))
    )));
    if (partialMetadata.some((item) => item !== null)) return "UNTRUSTED_OR_PARTIAL";
    try {
      const identityRoot = physicalPath(parameters.identity_root, options.filesystemRoot);
      await trustedDirectory(identityRoot, new Set([0o750]), "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID", parameters.reader_gid);
      const identity = await trustedJsonFile(
        physicalPath(RELEASE_IDENTITY_FILE, options.filesystemRoot), 0o440, validateReleaseIdentity,
        "UAT_PROMOTION_POSTDEPLOY_IDENTITY_RELEASE_IDENTITY_INVALID", parameters.reader_gid, false,
      );
      if (identity?.value.authorization_sha256 === intent.execution_authorization_sha256) {
        return "UNTRUSTED_OR_PARTIAL";
      }
    } catch { return "UNTRUSTED_OR_PARTIAL"; }
    return "ABSENT";
  }
}

async function recordPostdeployContainment(context, options) {
  if (context.execution_mode !== "ORIGINAL"
    || !new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(context.operation)) {
    reject("UAT_PROMOTION_PHASE_INVALID");
  }
  const paths = await layout(options.filesystemRoot, false);
  const intent = await loadStoredPostdeployIntent(context, paths);
  const current = await trustedJsonFile(
    paths.current, 0o400, validateUatPromotionCheckpointReceipt, "UAT_PROMOTION_CURRENT_INVALID",
  );
  if (!current) reject("UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CHECKPOINT_CHANGED");
  const runtime = context.operation === "POSTDEPLOY_RUNTIME_CONFIGURATION";
  const predecessor = current.value.receipt_sha256 === intent.previous_checkpoint_receipt_sha256
    && current.value.checkpoint_ordinal === (runtime ? 9 : 10)
    && current.value.checkpoint_id === (runtime ? "COMPOSE_DEPLOYMENT_RECEIPT" : "POST_DEPLOY_RUNTIME_CONFIGURATION");
  let status, preservation;
  if (predecessor) {
    status = "POSTDEPLOY_FAILURE_CONTAINED_JOURNAL_UNCHANGED";
    preservation = "PREDECESSOR_CHECKPOINT_RESULT_TRANSFER_FENCE_AND_DATABASE_HANDOFF_LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION";
  } else {
    await alreadyCommittedPostdeployResult(context, paths, intent);
    status = "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY";
    preservation = "COMMITTED_POSTDEPLOY_CHECKPOINT_LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION";
  }
  const failure = validatePostdeployFailure(options.failureStage, options.failureCode);
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONTRACT,
    status,
    contained_at: (options.now ?? new Date()).toISOString(),
    operation: context.operation,
    operation_id: context.operation_id,
    promotion_id: intent.promotion_id,
    intent_sha256: postdeployIntentDigest(intent),
    execution_authorization_sha256: context.original_authorization_sha256,
    preserved_checkpoint_receipt_sha256: current.value.receipt_sha256,
    deployment_result_sha256: intent.deployment_result_sha256,
    fence_transfer_sha256: intent.fence_transfer_sha256,
    observed_checkpoint_id: current.value.checkpoint_id,
    observed_checkpoint_ordinal: current.value.checkpoint_ordinal,
    external_artifact_state: await postdeployExternalArtifactState(context, intent, options),
    failure_stage: failure.stage,
    failure_code: failure.code,
    preservation,
  };
  const containment = Object.freeze(validatePostdeployContainment({
    ...body, containment_sha256: clusterSha256(body),
  }));
  await ensureRawFile(
    path.join(paths.containments, `${context.operation_id}.${containment.containment_sha256}.json`),
    Buffer.from(canonicalClusterJson(containment)), 0o400, validatePostdeployContainment,
    "UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONFLICT",
  );
  await syncDirectory(paths.containments, "UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_SYNC_FAILED");
  return Object.freeze({
    result: predecessor ? "CONTAINED" : "COMMITTED_ANOMALY_RECORDED", promotion_id: intent.promotion_id,
    intent_sha256: postdeployIntentDigest(intent), containment_sha256: containment.containment_sha256,
  });
}

export async function runUatPromotionTransactionPhase(contextInput, phase, options = {}) {
  const context = validateUatPromotionContext(contextInput);
  const filesystemRoot = path.resolve(options.filesystemRoot || "/");
  const siteRoot = path.resolve(options.siteRoot || SITE_ROOT);
  if ((filesystemRoot !== "/" || siteRoot !== SITE_ROOT) && options.allowTestRoot !== true) reject("UAT_PROMOTION_TEST_ROOT_NOT_EXPLICIT");
  const resolved = { filesystemRoot, siteRoot, fault: options.fault };
  if (phase === "contain") {
    const failure = validatePostdeployFailure(options.failureStage, options.failureCode);
    resolved.failureStage = failure.stage;
    resolved.failureCode = failure.code;
  } else if (options.failureStage !== undefined || options.failureCode !== undefined) {
    reject("UAT_PROMOTION_POSTDEPLOY_FAILURE_CLASSIFICATION_INVALID");
  }
  const postdeploy = new Set([
    "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY",
  ]).has(context.operation);
  if (phase === "execute" && postdeploy) {
    digest(
      options.expectedPostdeployResultSha256,
      "UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_INVALID",
    );
    resolved.expectedPostdeployResultSha256 = options.expectedPostdeployResultSha256;
  } else if (options.expectedPostdeployResultSha256 !== undefined) {
    reject("UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_INVALID");
  }
  if (options.now !== undefined) {
    if (options.allowTestRoot !== true || filesystemRoot === "/" || !(options.now instanceof Date)
      || Number.isNaN(options.now.getTime())) reject("UAT_PROMOTION_TEST_TIME_NOT_EXPLICIT");
    resolved.now = options.now;
  }
  if (options.snapshotPolicyValidator || options.snapshotActivationValidator || options.snapshotReadinessValidator) {
    if (options.allowTestRoot !== true || filesystemRoot === "/") reject("UAT_PROMOTION_TEST_VALIDATOR_NOT_EXPLICIT");
    resolved.snapshotPolicyValidator = options.snapshotPolicyValidator;
    resolved.snapshotActivationValidator = options.snapshotActivationValidator;
    resolved.snapshotReadinessValidator = options.snapshotReadinessValidator;
  }
  if (options.writerQuiesceValidator) {
    if (options.allowTestRoot !== true || filesystemRoot === "/") reject("UAT_PROMOTION_TEST_VALIDATOR_NOT_EXPLICIT");
    resolved.writerQuiesceValidator = options.writerQuiesceValidator;
  }
  if (phase === "prepare") {
    if (context.execution_mode !== "ORIGINAL") reject("UAT_PROMOTION_PHASE_INVALID");
    if (context.operation === "BEGIN") return prepareOriginal(context, resolved);
    if (context.operation === "CAPTURE_SNAPSHOT") return prepareSnapshot(context, resolved);
    if (context.operation === "QUIESCE_WRITERS") return prepareQuiesce(context, resolved);
    if (context.operation === "MIGRATION_AUTHORIZATION") return prepareMigrationAuthorization(context, resolved);
    if (context.operation === "MIGRATION_EXECUTION") return prepareMigrationExecution(context, resolved);
    if (context.operation === "COMPOSE_DEPLOYMENT") return prepareComposeDeployment(context, resolved);
    if (context.operation === "CROSS_ROLE_UAT") return prepareCrossRoleCheckpoint(context, resolved);
    return preparePostdeployCheckpoint(context, resolved);
  }
  const paths = await layout(filesystemRoot, false);
  if (phase === "execute") {
    if (context.execution_mode !== "ORIGINAL") reject("UAT_PROMOTION_PHASE_INVALID");
    if (context.operation === "BEGIN") {
      const intent = await loadIntent(context, paths);
      await verifyAuthorizedSources(context, filesystemRoot);
      return commitIntent(context, intent, paths, resolved);
    }
    if (context.operation === "CAPTURE_SNAPSHOT") {
      const sources = await verifySnapshotAuthorizedSources(context, filesystemRoot, resolved);
      const intent = await loadSnapshotIntent(context, paths, sources);
      return commitSnapshot(context, intent, sources, paths, resolved);
    }
    if (context.operation === "QUIESCE_WRITERS") {
      const sources = await verifyQuiesceAuthorizedSources(context, filesystemRoot, resolved);
      const intent = await loadQuiesceIntent(context, paths, sources);
      return commitQuiesce(context, intent, sources, paths, resolved);
    }
    if (context.operation === "MIGRATION_AUTHORIZATION") {
      const sources = await verifyMigrationAuthorizationSources(context, filesystemRoot);
      const intent = await loadMigrationAuthorizationIntent(context, paths, sources);
      return commitMigrationAuthorization(context, intent, sources, paths, resolved);
    }
    if (context.operation === "MIGRATION_EXECUTION") {
      const sources = await verifyMigrationExecutionSources(context, filesystemRoot);
      const artifacts = await loadMigrationExecutionArtifacts(context, paths, sources);
      const result = await loadMigrationExecutionResult(
        paths, artifacts.intent, artifacts.grant, sources.manifest.migrations.entries,
      );
      return commitMigrationExecution(context, artifacts.intent, result, sources, paths, resolved);
    }
    if (new Set(["POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"]).has(context.operation)) {
      return executePostdeployCheckpoint(context, resolved);
    }
    if (context.operation === "CROSS_ROLE_UAT") return executeCrossRoleCheckpoint(context, resolved);
    const sources = await verifyComposeDeploymentSources(context, filesystemRoot);
    const intent = await loadComposeDeploymentIntent(context, paths, sources);
    const result = await loadComposeDeploymentResult(paths, intent);
    const transfer = await loadComposeDeploymentFenceTransfer(paths, intent, result);
    return commitComposeDeployment(context, intent, result, transfer, sources, paths, resolved);
  }
  if (phase === "recover-prepare") {
    if (context.execution_mode !== "RECOVERY") reject("UAT_PROMOTION_PHASE_INVALID");
    return prepareRecovery(context, resolved);
  }
  if (phase === "recover-execute") {
    if (context.execution_mode !== "RECOVERY") reject("UAT_PROMOTION_PHASE_INVALID");
    return executeRecovery(context, resolved);
  }
  if (phase === "contain") return recordPostdeployContainment(context, resolved);
  reject("UAT_PROMOTION_PHASE_INVALID");
}

function assertSupervisorControl(context, phase) {
  const consumed = new Set(["execute", "recover-execute", "contain"]).has(phase) ? "YES" : "NO";
  if (process.getuid?.() !== 0 || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES"
    || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED !== consumed
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT) reject("UAT_PROMOTION_SUPERVISOR_CONTROL_INVALID");
  const bundleRoot = path.dirname(SITE_ROOT);
  if (path.dirname(bundleRoot) !== SUPERVISOR_BUNDLE_ROOT || path.basename(bundleRoot) !== context.supervisor_bundle_sha256) reject("UAT_PROMOTION_SUPERVISOR_CONTROL_INVALID");
  const descriptorText = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/u.test(descriptorText || "")) reject("UAT_PROMOTION_GLOBAL_LOCK_INVALID");
  const descriptor = Number(descriptorText);
  let opened, named, lockLines;
  try {
    opened = fstatSync(descriptor, { bigint: true });
    named = lstatSync(GLOBAL_RELEASE_LOCK, { bigint: true });
    lockLines = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:"));
  } catch { reject("UAT_PROMOTION_GLOBAL_LOCK_INVALID"); }
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || named.uid !== 0n || named.gid !== 0n
    || named.nlink !== 1n || modeOf(named) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino
    || lockLines.length !== 1 || !/^lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ /u.test(lockLines[0])) reject("UAT_PROMOTION_GLOBAL_LOCK_INVALID");
}

async function readContext() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 512 * 1024) reject("UAT_PROMOTION_CONTEXT_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return parseStrictJson(Buffer.concat(chunks).toString("utf8"), 512 * 1024); }
  catch { reject("UAT_PROMOTION_CONTEXT_INVALID"); }
}

async function main(argumentsList) {
  const confirmations = {
    prepare: "PREPARE_UAT_PROMOTION_DURABLE_INTENT",
    execute: "COMMIT_UAT_PROMOTION_JOURNAL_AFTER_AUTHORIZATION",
    "recover-prepare": "PREPARE_UAT_PROMOTION_RECOVERY",
    "recover-execute": "EXECUTE_UAT_PROMOTION_RECOVERY_AFTER_AUTHORIZATION",
    contain: "CONTAIN_FAILED_UAT_PROMOTION_POSTDEPLOY_OPERATION",
  };
  if (argumentsList.length !== 2 || confirmations[argumentsList[0]] !== argumentsList[1]) reject("UAT_PROMOTION_USAGE_INVALID");
  const context = validateUatPromotionContext(await readContext());
  assertSupervisorControl(context, argumentsList[0]);
  const options = {};
  if (argumentsList[0] === "contain") {
    options.failureStage = process.env.ERP_UAT_PROMOTION_POSTDEPLOY_FAILURE_STAGE;
    options.failureCode = process.env.ERP_UAT_PROMOTION_POSTDEPLOY_FAILURE_CODE;
  } else if (process.env.ERP_UAT_PROMOTION_POSTDEPLOY_FAILURE_STAGE !== undefined
    || process.env.ERP_UAT_PROMOTION_POSTDEPLOY_FAILURE_CODE !== undefined) {
    reject("UAT_PROMOTION_POSTDEPLOY_FAILURE_CLASSIFICATION_INVALID");
  }
  if (argumentsList[0] === "execute" && new Set([
    "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY",
  ]).has(context.operation)) {
    options.expectedPostdeployResultSha256 =
      process.env.ERP_UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_SHA256;
  } else if (process.env.ERP_UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_SHA256 !== undefined) {
    reject("UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_INVALID");
  }
  process.stdout.write(canonicalClusterJson(await runUatPromotionTransactionPhase(context, argumentsList[0], options)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "UAT_PROMOTION_FAILED"}\n`);
    process.exitCode = 1;
  });
}
