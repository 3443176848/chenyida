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
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import { validateReleaseManifest } from "./release-manifest-contract.mjs";

export const UAT_PROMOTION_POLICY_CONTRACT = "chenyida-erp-uat-promotion-transaction-policy/v1";
export const UAT_PROMOTION_CONTEXT_CONTRACT = "chenyida-erp-uat-promotion-transaction-context/v1";
export const UAT_PROMOTION_INTENT_CONTRACT = "chenyida-erp-uat-promotion-intent/v1";
export const UAT_PROMOTION_RECEIPT_CONTRACT = "chenyida-erp-uat-promotion-checkpoint-receipt/v1";
export const UAT_PROMOTION_RECOVERY_CONTRACT = "chenyida-erp-uat-promotion-recovery/v1";
export const UAT_PROMOTION_QUARANTINE_CONTRACT = "chenyida-erp-uat-promotion-quarantine/v1";
export const UAT_PROMOTION_STATE_ROOT = "/var/lib/chenyida-erp/uat-promotion-transactions-v1";
export const UAT_PROMOTION_CURRENT_FILE = `${UAT_PROMOTION_STATE_ROOT}/current.json`;
export const UAT_PROMOTION_STATE_MARKER = ".chenyida-erp-uat-promotion-transactions-v1";
export const UAT_PROMOTION_STATE_MARKER_VALUE = "chenyida-erp-uat-promotion-transactions/v1\n";
export const UAT_PROMOTION_POLICY_RELATIVE = "operations/uat-promotion-transaction-policy-v1.json";
export const UAT_PROMOTION_POLICY_FILE_SHA256 = "e2c37a6b6afa5190e011e5a2a9d90b2266ccf551cdf51baf70ec54c813180bf8";
export const UAT_PROMOTION_POLICY_SHA256 = "eacca016cc6bffd2b57f5ac76f95797a22480823162e1925918846e90be38f44";
export const ZERO_SHA256 = "0".repeat(64);

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const SUPERVISOR_BUNDLE_ROOT = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const RELEASE_IDENTITY_FILE = "/var/lib/chenyida-erp/release-identity/release-identity.json";
const RELEASE_ARTIFACT_MARKER = ".chenyida-erp-release-artifact-root-v1";
const RELEASE_ARTIFACT_MARKER_VALUE = "chenyida-erp-release-artifact-root/v1\n";
const BACKUP_STATUS_FILE = "/var/lib/chenyida-erp/backup-status/recovery-readiness.json";
const BACKUP_STATUS_MARKER = ".chenyida-erp-receipt-root-v2";
const BACKUP_STATUS_MARKER_VALUE = "chenyida-erp-receipt-root/v2\n";
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
    "checkpoint_order", "initial_checkpoint", "adapters", "journal",
  ], "UAT_PROMOTION_POLICY_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_POLICY_CONTRACT
    || value.authority !== "ROOT_RELEASE_SUPERVISOR_ONE_TIME_AUTHORIZATION") reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.deployment, ["class", "id", "database", "database_marker"], "UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.deployment, { class: "UAT", id: "chenyida-erp", database: "chenyida_erp", database_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp" })) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.state, ["root", "marker", "marker_value", "directory_mode", "file_mode", "owner_uid", "owner_gid"], "UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.state, { root: UAT_PROMOTION_STATE_ROOT, marker: UAT_PROMOTION_STATE_MARKER, marker_value: UAT_PROMOTION_STATE_MARKER_VALUE, directory_mode: "0700", file_mode: "0400", owner_uid: 0, owner_gid: 0 })) reject("UAT_PROMOTION_POLICY_INVALID");
  exactKeys(value.authorization, ["contract", "maximum_window_minutes", "required_distinct_actors", "begin_operation", "recovery_operation"], "UAT_PROMOTION_POLICY_INVALID");
  if (value.authorization.contract !== "chenyida-erp-release-supervisor-authorization/v6"
    || value.authorization.maximum_window_minutes !== 60 || value.authorization.begin_operation !== "BEGIN_UAT_PROMOTION"
    || value.authorization.recovery_operation !== "RECOVER_UAT_PROMOTION"
    || !same(value.authorization.required_distinct_actors, ["requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256"])) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!same(value.checkpoint_order, CHECKPOINT_ORDER) || value.initial_checkpoint !== CHECKPOINT_ORDER[3]) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!Array.isArray(value.required_intent_bindings) || value.required_intent_bindings.length !== 16
    || new Set(value.required_intent_bindings).size !== value.required_intent_bindings.length) reject("UAT_PROMOTION_POLICY_INVALID");
  if (!Array.isArray(value.adapters) || value.adapters.length !== 7) reject("UAT_PROMOTION_POLICY_INVALID");
  const expectedAdapters = new Map([
    ["BEGIN_UAT_PROMOTION", "IMPLEMENTED"], ["CAPTURE_UAT_PROMOTION_SNAPSHOT", "NOT_IMPLEMENTED"],
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

export function validateUatPromotionContext(value) {
  exactKeys(value, CONTEXT_FIELDS, "UAT_PROMOTION_CONTEXT_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_CONTEXT_CONTRACT || value.operation !== "BEGIN"
    || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject("UAT_PROMOTION_CONTEXT_INVALID");
  identifier(value.operation_id, "UAT_PROMOTION_CONTEXT_ID_INVALID");
  identifier(value.execution_authorization_id, "UAT_PROMOTION_CONTEXT_ID_INVALID");
  iso(value.execution_created_at, "UAT_PROMOTION_CONTEXT_TIME_INVALID");
  for (const field of ["execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256"]) digest(value[field], "UAT_PROMOTION_CONTEXT_DIGEST_INVALID");
  validateUatPromotionParameters(value.parameters);
  if (value.operation_id !== value.parameters.promotion_id) reject("UAT_PROMOTION_CONTEXT_BINDING_INVALID");
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_id !== value.operation_id || value.execution_authorization_sha256 !== value.original_authorization_sha256
      || value.expected_intent_sha256 !== null || Math.abs(Date.parse(value.execution_created_at) - Date.parse(value.parameters.promotion_created_at)) > 5 * 60 * 1000) reject("UAT_PROMOTION_CONTEXT_BINDING_INVALID");
  } else {
    if (value.execution_authorization_id === value.operation_id || value.execution_authorization_sha256 === value.original_authorization_sha256
      || Date.parse(value.execution_created_at) < Date.parse(value.parameters.promotion_created_at)) reject("UAT_PROMOTION_CONTEXT_BINDING_INVALID");
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
      CAPTURE_UAT_PROMOTION_SNAPSHOT: "NOT_IMPLEMENTED",
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
    || value.adapter_statuses?.RECOVER_UAT_PROMOTION !== "IMPLEMENTED"
    || Object.entries(value.adapter_statuses ?? {}).filter(([operation]) => !new Set(["BEGIN_UAT_PROMOTION", "RECOVER_UAT_PROMOTION"]).has(operation)).some(([, status]) => status !== "NOT_IMPLEMENTED")
    || clusterSha256(bodyWithout(value, "intent_sha256")) !== value.intent_sha256) reject("UAT_PROMOTION_INTENT_BINDING_INVALID");
  return value;
}

function intentFile(paths, intent) { return path.join(paths.intents, `${intent.promotion_id}.${intent.intent_sha256}.json`); }
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

function recoveryPlan(context, decision, reason) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_RECOVERY_CONTRACT,
    execution_authorization_id: context.execution_authorization_id,
    execution_authorization_sha256: context.execution_authorization_sha256,
    prepared_at: context.execution_created_at,
    original_promotion_id: context.operation_id,
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
    "original_promotion_id", "original_authorization_sha256", "intent_sha256", "decision", "reason", "recovery_sha256",
  ], "UAT_PROMOTION_RECOVERY_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_RECOVERY_CONTRACT
    || !new Set(["RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"]).has(value.decision)
    || (value.decision === "QUARANTINE") !== (typeof value.reason === "string")) reject("UAT_PROMOTION_RECOVERY_INVALID");
  identifier(value.execution_authorization_id, "UAT_PROMOTION_RECOVERY_INVALID");
  identifier(value.original_promotion_id, "UAT_PROMOTION_RECOVERY_INVALID");
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
  ].some((prefix) => error.code.startsWith(prefix));
}

async function prepareRecovery(context, options) {
  await repositoryPolicy(options.siteRoot);
  const paths = await layout(options.filesystemRoot, false);
  let decision = "RESUME_PUBLICATION";
  let reason = null;
  try {
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
  return Object.freeze({ result: "RECOVERY_PREPARED", promotion_id: context.operation_id, intent_sha256: context.expected_intent_sha256, recovery_sha256: plan.recovery_sha256, decision });
}

async function loadRecoveryPlan(context, paths) {
  const names = await strictNames(paths.recoveries, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "UAT_PROMOTION_RECOVERY_ROOT_INVALID");
  const matches = names.filter((name) => name.startsWith(`${context.execution_authorization_id}.`));
  if (matches.length !== 1) reject("UAT_PROMOTION_RECOVERY_MISSING");
  const stored = await trustedJsonFile(path.join(paths.recoveries, matches[0]), 0o400, validateRecoveryPlan, "UAT_PROMOTION_RECOVERY_INVALID");
  if (!stored || stored.value.original_promotion_id !== context.operation_id
    || stored.value.original_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.execution_authorization_sha256 !== context.execution_authorization_sha256
    || stored.value.intent_sha256 !== context.expected_intent_sha256) reject("UAT_PROMOTION_RECOVERY_BINDING_INVALID");
  return stored.value;
}

function validateQuarantine(value) {
  exactKeys(value, [
    "schema_version", "contract", "status", "quarantined_at", "promotion_id", "intent_sha256", "recovery_sha256",
    "reason", "preservation", "quarantine_sha256",
  ], "UAT_PROMOTION_QUARANTINE_INVALID");
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_QUARANTINE_CONTRACT || value.status !== "QUARANTINED"
    || value.preservation !== "FILES_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE" || typeof value.reason !== "string" || value.reason.length < 4) reject("UAT_PROMOTION_QUARANTINE_INVALID");
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
    const intent = await loadIntent(context, paths);
    if (plan.decision === "RESUME_PUBLICATION") await verifyAuthorizedSources(context, options.filesystemRoot);
    const result = await commitIntent(context, intent, paths, options);
    return Object.freeze({ ...result, recovery_sha256: plan.recovery_sha256 });
  }
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_QUARANTINE_CONTRACT,
    status: "QUARANTINED",
    quarantined_at: plan.prepared_at,
    promotion_id: context.operation_id,
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
  return Object.freeze({ result: "QUARANTINED", promotion_id: context.operation_id, intent_sha256: plan.intent_sha256, recovery_sha256: plan.recovery_sha256, quarantine_sha256: quarantine.quarantine_sha256 });
}

export async function runUatPromotionTransactionPhase(contextInput, phase, options = {}) {
  const context = validateUatPromotionContext(contextInput);
  const filesystemRoot = path.resolve(options.filesystemRoot || "/");
  const siteRoot = path.resolve(options.siteRoot || SITE_ROOT);
  if ((filesystemRoot !== "/" || siteRoot !== SITE_ROOT) && options.allowTestRoot !== true) reject("UAT_PROMOTION_TEST_ROOT_NOT_EXPLICIT");
  const resolved = { filesystemRoot, siteRoot, fault: options.fault };
  if (phase === "prepare") {
    if (context.execution_mode !== "ORIGINAL") reject("UAT_PROMOTION_PHASE_INVALID");
    return prepareOriginal(context, resolved);
  }
  const paths = await layout(filesystemRoot, false);
  if (phase === "execute") {
    if (context.execution_mode !== "ORIGINAL") reject("UAT_PROMOTION_PHASE_INVALID");
    const intent = await loadIntent(context, paths);
    await verifyAuthorizedSources(context, filesystemRoot);
    return commitIntent(context, intent, paths, resolved);
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
