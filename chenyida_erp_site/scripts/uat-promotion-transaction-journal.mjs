import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
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

export const UAT_PROMOTION_POLICY_CONTRACT = "chenyida-erp-uat-promotion-transaction-policy/v1";
export const UAT_PROMOTION_CONTEXT_CONTRACT = "chenyida-erp-uat-promotion-transaction-context/v1";
export const UAT_PROMOTION_INTENT_CONTRACT = "chenyida-erp-uat-promotion-intent/v1";
export const UAT_PROMOTION_SNAPSHOT_INTENT_CONTRACT = "chenyida-erp-uat-promotion-snapshot-intent/v1";
export const UAT_PROMOTION_RECEIPT_CONTRACT = "chenyida-erp-uat-promotion-checkpoint-receipt/v1";
export const UAT_PROMOTION_RECOVERY_CONTRACT = "chenyida-erp-uat-promotion-recovery/v2";
export const UAT_PROMOTION_QUARANTINE_CONTRACT = "chenyida-erp-uat-promotion-quarantine/v2";
export const UAT_PROMOTION_STATE_ROOT = "/var/lib/chenyida-erp/uat-promotion-transactions-v1";
export const UAT_PROMOTION_CURRENT_FILE = `${UAT_PROMOTION_STATE_ROOT}/current.json`;
export const UAT_PROMOTION_STATE_MARKER = ".chenyida-erp-uat-promotion-transactions-v1";
export const UAT_PROMOTION_STATE_MARKER_VALUE = "chenyida-erp-uat-promotion-transactions/v1\n";
export const UAT_PROMOTION_POLICY_RELATIVE = "operations/uat-promotion-transaction-policy-v1.json";
export const UAT_PROMOTION_POLICY_FILE_SHA256 = "fa719c27557b92054d5d1fd8f126a7a922b033170f4451d1f1e721ab079ef976";
export const UAT_PROMOTION_POLICY_SHA256 = "e727286687ffe9bdbddf3d8fcec6ef28bdc4f490093ea0eef150cd7b7724c45b";
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
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^0\.1\.0-alpha\.\d+$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const IMAGE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
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
function sha256(raw) { return createHash("sha256").update(raw).digest("hex"); }
function modeOf(metadata) { return Number(metadata.mode & 0o7777n); }
function bodyWithout(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }

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
  exactKeys(value.authorization, ["contract", "maximum_window_minutes", "required_distinct_actors", "begin_operation", "snapshot_operation", "recovery_operation"], "UAT_PROMOTION_POLICY_INVALID");
  if (value.authorization.contract !== "chenyida-erp-release-supervisor-authorization/v6"
    || value.authorization.maximum_window_minutes !== 60 || value.authorization.begin_operation !== "BEGIN_UAT_PROMOTION"
    || value.authorization.snapshot_operation !== "CAPTURE_UAT_PROMOTION_SNAPSHOT"
    || value.authorization.recovery_operation !== "RECOVER_UAT_PROMOTION"
    || !same(value.authorization.required_distinct_actors, ["requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256"])) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.snapshot_writer_dependency, [
    "backup_capture_precondition", "snapshot_checkpoint", "postcapture_quiesce_checkpoint", "checkpoint_order_decision",
  ], "UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.snapshot_writer_dependency, {
    backup_capture_precondition: "EXACT_COMPOSE_WEB_WORKER_STOPPED",
    snapshot_checkpoint: "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT",
    postcapture_quiesce_checkpoint: "WRITER_QUIESCE_RECEIPT",
    checkpoint_order_decision: "CAPTURE_EMBEDS_WRITER_STOP_PROOF_AND_NEXT_CHECKPOINT_PROVES_CONTINUED_QUIESCE",
  })) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.checkpoint_order, CHECKPOINT_ORDER) || value.initial_checkpoint !== CHECKPOINT_ORDER[3]) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!Array.isArray(value.required_intent_bindings) || value.required_intent_bindings.length !== 16
    || new Set(value.required_intent_bindings).size !== value.required_intent_bindings.length) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!Array.isArray(value.adapters) || value.adapters.length !== 7) reject("UAT_PROMOTION_POLICY_INVALID");
  const expectedAdapters = new Map([
    ["BEGIN_UAT_PROMOTION", "IMPLEMENTED"], ["CAPTURE_UAT_PROMOTION_SNAPSHOT", "IMPLEMENTED"],
    ["QUIESCE_UAT_WRITERS", "NOT_IMPLEMENTED"], ["RUN_UAT_PROMOTION_MIGRATION", "NOT_IMPLEMENTED"],
    ["DEPLOY_UAT_RELEASE", "NOT_IMPLEMENTED"], ["ROLLBACK_UAT_RELEASE", "NOT_IMPLEMENTED"],
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

export function validateUatPromotionContext(value) {
  exactKeys(value, CONTEXT_FIELDS, "UAT_PROMOTION_CONTEXT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_CONTEXT_CONTRACT || !new Set(["BEGIN", "CAPTURE_SNAPSHOT"]).has(value.operation)
    || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject("UAT_PROMOTION_CONTEXT_INVALID");
  identifier(value.operation_id, "UAT_PROMOTION_CONTEXT_ID_INVALID");
  identifier(value.execution_authorization_id, "UAT_PROMOTION_CONTEXT_ID_INVALID");
  iso(value.execution_created_at, "UAT_PROMOTION_CONTEXT_TIME_INVALID");
  for (const field of ["execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256"]) digest(value[field], "UAT_PROMOTION_CONTEXT_DIGEST_INVALID");
  if (value.operation === "BEGIN") validateUatPromotionParameters(value.parameters);
  else validateUatPromotionSnapshotParameters(value.parameters);
  const operationCreatedAt = value.operation === "BEGIN" ? value.parameters.promotion_created_at : value.parameters.snapshot_created_at;
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_id !== value.operation_id || value.execution_authorization_sha256 !== value.original_authorization_sha256
      || value.expected_intent_sha256 !== null || Math.abs(Date.parse(value.execution_created_at) - Date.parse(operationCreatedAt)) > 5 * 60 * 1000
      || value.operation === "BEGIN" && value.operation_id !== value.parameters.promotion_id
      || value.operation === "CAPTURE_SNAPSHOT" && value.operation_id === value.parameters.promotion_id) reject("UAT_PROMOTION_CONTEXT_BINDING_INVALID");
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

function promotionSnapshotBinding(parameters, readiness, policy, activation, identity, objects) {
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
    || previous.promotion_snapshot_binding_sha256 !== ZERO_SHA256) reject("UAT_PROMOTION_SNAPSHOT_CURRENT_MISMATCH");
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
  const binding = promotionSnapshotBinding(parameters, readiness, policy, activation, identity, objects);
  digest(binding, "UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID");
  return Object.freeze({ objects, binding, recordedAt: readiness.verified_at });
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

async function trustedJsonFile(file, mode, validator, code, expectedGid = 0, requireCanonical = true) {
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
    if (requireCanonical && raw.toString("utf8") !== canonicalClusterJson(value)) reject(code);
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

async function ensureRawFile(file, raw, finalMode, validator, code) {
  let metadata = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata !== null && metadata.isFile() && !metadata.isSymbolicLink() && metadata.uid === 0 && metadata.gid === 0
    && metadata.nlink === 1 && new Set([0o600, finalMode]).has(metadata.mode & 0o7777)
    && metadata.size >= 0 && metadata.size <= raw.length) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
    let existing;
    try { existing = await handle.readFile(); } finally { await handle.close(); }
    if (raw.subarray(0, existing.length).equals(existing)) {
      if (existing.length === raw.length && (metadata.mode & 0o7777) === finalMode) {
        const trusted = await trustedJsonFile(file, finalMode, validator, code);
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
  const stored = await trustedJsonFile(file, finalMode, validator, code);
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
    for (const name of ["generations", "history", "receipts", "intents", "recoveries", "quarantine"]) {
      await ensureDirectory(path.join(stateRoot, name), stateRoot, 0o700, "UAT_PROMOTION_STATE_ROOT_INVALID");
    }
  } else {
    await trustedDirectory(stateRoot, new Set([0o700]), "UAT_PROMOTION_STATE_ROOT_INVALID");
    for (const name of ["generations", "history", "receipts", "intents", "recoveries", "quarantine"]) {
      await trustedDirectory(path.join(stateRoot, name), new Set([0o700]), "UAT_PROMOTION_STATE_ROOT_INVALID");
    }
    await ensureMarker(path.join(stateRoot, UAT_PROMOTION_STATE_MARKER), Buffer.from(UAT_PROMOTION_STATE_MARKER_VALUE), false, "UAT_PROMOTION_STATE_MARKER_INVALID");
  }
  return Object.freeze({
    stateRoot,
    generations: path.join(stateRoot, "generations"), history: path.join(stateRoot, "history"),
    receipts: path.join(stateRoot, "receipts"), intents: path.join(stateRoot, "intents"),
    recoveries: path.join(stateRoot, "recoveries"), quarantine: path.join(stateRoot, "quarantine"),
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
  for (const field of ["promotion_snapshot_binding_sha256", "previous_promotion_receipt_sha256", "previous_checkpoint_receipt_sha256"]) {
    digest(value[field], "UAT_PROMOTION_RECEIPT_DIGEST_INVALID", true);
  }
  if (value.checkpoint_ordinal === 4 && value.previous_checkpoint_receipt_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal > 4 && value.previous_checkpoint_receipt_sha256 === ZERO_SHA256
    || value.checkpoint_ordinal < 5 && value.promotion_snapshot_binding_sha256 !== ZERO_SHA256
    || value.checkpoint_ordinal >= 5 && value.promotion_snapshot_binding_sha256 === ZERO_SHA256
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
  if (previous.authorization_sha256_chain.includes(input.checkpoint_authorization_sha256)) reject("UAT_PROMOTION_CHECKPOINT_AUTHORIZATION_REUSED");
  if (nextOrdinal === 5) {
    if (input.promotion_snapshot_binding_sha256 === ZERO_SHA256) reject("UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID");
  } else if (input.promotion_snapshot_binding_sha256 !== previous.promotion_snapshot_binding_sha256) {
    reject("UAT_PROMOTION_CHECKPOINT_SNAPSHOT_INVALID");
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
      QUIESCE_UAT_WRITERS: "NOT_IMPLEMENTED",
      RUN_UAT_PROMOTION_MIGRATION: "NOT_IMPLEMENTED",
      DEPLOY_UAT_RELEASE: "NOT_IMPLEMENTED",
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
    || value.adapter_statuses?.BEGIN_UAT_PROMOTION !== "IMPLEMENTED"
    || value.adapter_statuses?.CAPTURE_UAT_PROMOTION_SNAPSHOT !== "IMPLEMENTED"
    || value.adapter_statuses?.RECOVER_UAT_PROMOTION !== "IMPLEMENTED"
    || Object.entries(value.adapter_statuses ?? {}).filter(([operation]) => !new Set(["BEGIN_UAT_PROMOTION", "CAPTURE_UAT_PROMOTION_SNAPSHOT", "RECOVER_UAT_PROMOTION"]).has(operation)).some(([, status]) => status !== "NOT_IMPLEMENTED")
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
  };
  return Object.freeze({ ...body, snapshot_intent_sha256: clusterSha256(body) });
}

export function validateUatPromotionSnapshotIntent(value) {
  exactKeys(value, [
    "schema_version", "contract", "snapshot_operation_id", "promotion_id", "promotion_generation", "created_at", "expires_at",
    "execution_authorization_sha256", "supervisor_bundle_sha256", "parameters", "promotion_intent_sha256",
    "previous_checkpoint_receipt_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "snapshot_recorded_at", "snapshot_objects", "snapshot_intent_sha256",
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

function intentFile(paths, intent) { return path.join(paths.intents, `${intent.promotion_id}.${intent.intent_sha256}.json`); }
function snapshotIntentFile(paths, intent) { return path.join(paths.intents, `${intent.snapshot_operation_id}.${intent.snapshot_intent_sha256}.json`); }
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
        || receipt.value.promotion_snapshot_binding_sha256 !== previous.promotion_snapshot_binding_sha256 && receipt.value.checkpoint_ordinal !== 5) reject("UAT_PROMOTION_CHECKPOINT_CHAIN_INVALID");
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
  const matches = names.filter((name) => name.startsWith(`${intent.promotion_id}.`));
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
  const matches = names.filter((name) => name.startsWith(`${context.operation_id}.`));
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
  const matches = names.filter((name) => name.startsWith(`${context.operation_id}.`));
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
  const matches = names.filter((name) => name.startsWith(`${context.operation_id}.`));
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

function recoveryPlan(context, decision, reason) {
  const body = {
    schema_version: 2,
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
  if (value.schema_version !== 2 || value.contract !== UAT_PROMOTION_RECOVERY_CONTRACT
    || !new Set(["BEGIN", "CAPTURE_SNAPSHOT"]).has(value.original_operation)
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
  ].some((prefix) => error.code.startsWith(prefix));
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
    } else {
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
  const matches = names.filter((name) => name.startsWith(`${context.execution_authorization_id}.`));
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
  if (value.schema_version !== 2 || value.contract !== UAT_PROMOTION_QUARANTINE_CONTRACT || value.status !== "QUARANTINED"
    || !new Set(["BEGIN", "CAPTURE_SNAPSHOT"]).has(value.operation)
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
    } else if (plan.decision === "ALREADY_COMMITTED") {
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
    return Object.freeze({ ...result, recovery_sha256: plan.recovery_sha256 });
  }
  const body = {
    schema_version: 2,
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

export async function runUatPromotionTransactionPhase(contextInput, phase, options = {}) {
  const context = validateUatPromotionContext(contextInput);
  const filesystemRoot = path.resolve(options.filesystemRoot || "/");
  const siteRoot = path.resolve(options.siteRoot || SITE_ROOT);
  if ((filesystemRoot !== "/" || siteRoot !== SITE_ROOT) && options.allowTestRoot !== true) reject("UAT_PROMOTION_TEST_ROOT_NOT_EXPLICIT");
  const resolved = { filesystemRoot, siteRoot, fault: options.fault };
  if (options.snapshotPolicyValidator || options.snapshotActivationValidator || options.snapshotReadinessValidator) {
    if (options.allowTestRoot !== true || filesystemRoot === "/") reject("UAT_PROMOTION_TEST_VALIDATOR_NOT_EXPLICIT");
    resolved.snapshotPolicyValidator = options.snapshotPolicyValidator;
    resolved.snapshotActivationValidator = options.snapshotActivationValidator;
    resolved.snapshotReadinessValidator = options.snapshotReadinessValidator;
  }
  if (phase === "prepare") {
    if (context.execution_mode !== "ORIGINAL") reject("UAT_PROMOTION_PHASE_INVALID");
    return context.operation === "BEGIN" ? prepareOriginal(context, resolved) : prepareSnapshot(context, resolved);
  }
  const paths = await layout(filesystemRoot, false);
  if (phase === "execute") {
    if (context.execution_mode !== "ORIGINAL") reject("UAT_PROMOTION_PHASE_INVALID");
    if (context.operation === "BEGIN") {
      const intent = await loadIntent(context, paths);
      await verifyAuthorizedSources(context, filesystemRoot);
      return commitIntent(context, intent, paths, resolved);
    }
    const sources = await verifySnapshotAuthorizedSources(context, filesystemRoot, resolved);
    const intent = await loadSnapshotIntent(context, paths, sources);
    return commitSnapshot(context, intent, sources, paths, resolved);
  }
  if (phase === "recover-prepare") {
    if (context.execution_mode !== "RECOVERY") reject("UAT_PROMOTION_PHASE_INVALID");
    return prepareRecovery(context, resolved);
  }
  if (phase === "recover-execute") {
    if (context.execution_mode !== "RECOVERY") reject("UAT_PROMOTION_PHASE_INVALID");
    return executeRecovery(context, resolved);
  }
  reject("UAT_PROMOTION_PHASE_INVALID");
}

function assertSupervisorControl(context, phase) {
  const consumed = new Set(["execute", "recover-execute"]).has(phase) ? "YES" : "NO";
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
  };
  if (argumentsList.length !== 2 || confirmations[argumentsList[0]] !== argumentsList[1]) reject("UAT_PROMOTION_USAGE_INVALID");
  const context = validateUatPromotionContext(await readContext());
  assertSupervisorControl(context, argumentsList[0]);
  process.stdout.write(canonicalClusterJson(await runUatPromotionTransactionPhase(context, argumentsList[0])));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "UAT_PROMOTION_FAILED"}\n`);
    process.exitCode = 1;
  });
}
