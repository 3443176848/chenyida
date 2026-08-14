import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_IDENTITY_CONTRACT,
  RELEASE_IDENTITY_ROOT_MARKER,
  RELEASE_IDENTITY_ROOT_MARKER_VALUE,
  parseStrictJson,
  validateReleaseIdentity,
} from "./release-identity-contract.mjs";
import {
  canonicalClusterJson,
  clusterSha256,
} from "./postgresql-cluster-recovery-contract.mjs";
import {
  clusterRecoveryPolicyV2Sha256,
  validateClusterRecoveryPolicyV2,
  ZERO_SHA256,
} from "./postgresql-cluster-recovery-policy-v2-contract.mjs";
import { activateClusterRecoveryPolicyV2 } from "./postgresql-cluster-recovery-policy-v2.mjs";
import {
  CLUSTER_POLICY_ACTIVATION_CURRENT_FILE,
  CLUSTER_POLICY_ACTIVATION_RECEIPT_CONTRACT,
  CLUSTER_POLICY_ACTIVATION_STATE_ROOT,
  CLUSTER_POLICY_TARGET_FILE,
  CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256,
  CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256,
  createClusterRecoveryPolicyActivationReceipt,
  validateClusterRecoveryPolicyActivationReceipt,
} from "./postgresql-cluster-recovery-policy-v2-activation-contract.mjs";

export const CLUSTER_POLICY_ACTIVATION_CONTEXT_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy-activation-context/v1";
export const CLUSTER_POLICY_ACTIVATION_INTENT_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy-activation-intent/v1";
export const CLUSTER_POLICY_ACTIVATION_RECOVERY_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy-activation-recovery/v1";
export const CLUSTER_POLICY_ACTIVATION_QUARANTINE_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy-activation-quarantine/v1";
export const CLUSTER_POLICY_ACTIVATION_STATE_MARKER = ".chenyida-erp-postgresql-cluster-recovery-policy-v2";
export const CLUSTER_POLICY_ACTIVATION_STATE_MARKER_VALUE = "chenyida-erp-postgresql-cluster-recovery-policy-activation/v1\n";
export const CLUSTER_POLICY_TARGET_MARKER = ".chenyida-erp-postgresql-cluster-recovery-policy-v2";
export const CLUSTER_POLICY_TARGET_MARKER_VALUE = "chenyida-erp-postgresql-cluster-recovery-policy-target/v1\n";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const TEMPLATE_RELATIVE = "operations/postgresql-cluster-recovery-policy-v2.json";
const SUPERVISOR_BUNDLE_ROOT = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const RELEASE_IDENTITY_FILE = "/var/lib/chenyida-erp/release-identity/release-identity.json";
const MAX_JSON_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SOURCE_FIELDS = Object.freeze(["path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink"]);
const PARAMETER_FIELDS = Object.freeze([
  "policy_state_root", "policy_target", "activation_id", "environment", "policy_generation",
  "previous_policy_sha256", "previous_activation_receipt_sha256", "template_file_sha256", "template_policy_sha256",
  "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256",
  "rpo_hours", "rto_minutes", "target_disposition", "activated_at", "policy_expires_at",
  "release_identity_source", "current_policy_source", "current_activation_source", "rollback_target_source",
]);
const CONTEXT_FIELDS = Object.freeze([
  "schema_version", "contract", "operation_id", "operation", "execution_mode", "execution_authorization_id",
  "execution_authorization_sha256", "execution_created_at", "original_authorization_sha256",
  "supervisor_bundle_sha256", "expected_intent_sha256", "parameters",
]);

export class ClusterRecoveryPolicyPublisherError extends Error {
  constructor(code) {
    super(code);
    this.name = "ClusterRecoveryPolicyPublisherError";
    this.code = code;
  }
}

function reject(code) { throw new ClusterRecoveryPolicyPublisherError(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function digest(value, code, allowZero = false) {
  if (typeof value !== "string" || !SHA256.test(value) || !allowZero && value === ZERO_SHA256) reject(code);
  return value;
}
function identifier(value, code) { if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code); return value; }
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}
function sha256(raw) { return createHash("sha256").update(raw).digest("hex"); }
function modeOf(metadata) { return Number(metadata.mode & 0o7777n); }
function bodyWithout(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }

function validateSourceSpec(value, expectedPath, expectedMode, code, expectedGid = 0) {
  exactKeys(value, SOURCE_FIELDS, code);
  if (value.path !== expectedPath || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 2 || value.bytes > MAX_JSON_BYTES
    || typeof value.device !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value.device)
    || typeof value.inode !== "string" || !/^[1-9][0-9]*$/u.test(value.inode)
    || value.uid !== 0 || !Number.isSafeInteger(value.gid) || value.gid < 0 || value.gid > 2_147_483_647
    || expectedGid !== null && value.gid !== expectedGid || value.mode !== expectedMode || value.nlink !== 1) reject(code);
  digest(value.sha256, code);
  return value;
}

export function validateClusterPolicyActivationParameters(operation, value) {
  exactKeys(value, PARAMETER_FIELDS, "CLUSTER_POLICY_ACTIVATION_PARAMETERS_INVALID");
  if (!new Set(["ACTIVATE", "ROLLBACK"]).has(operation)) reject("CLUSTER_POLICY_ACTIVATION_OPERATION_INVALID");
  if (value.policy_state_root !== CLUSTER_POLICY_ACTIVATION_STATE_ROOT || value.policy_target !== CLUSTER_POLICY_TARGET_FILE) reject("CLUSTER_POLICY_ACTIVATION_PATH_INVALID");
  identifier(value.activation_id, "CLUSTER_POLICY_ACTIVATION_ID_INVALID");
  if (!new Set(["UAT", "PRODUCTION"]).has(value.environment)) reject("CLUSTER_POLICY_ACTIVATION_ENVIRONMENT_INVALID");
  integer(value.policy_generation, 1, 1_000_000, "CLUSTER_POLICY_ACTIVATION_GENERATION_INVALID");
  integer(value.rpo_hours, 1, 168, "CLUSTER_POLICY_ACTIVATION_SLA_INVALID");
  integer(value.rto_minutes, 1, 10_080, "CLUSTER_POLICY_ACTIVATION_SLA_INVALID");
  for (const key of ["previous_policy_sha256", "previous_activation_receipt_sha256"]) digest(value[key], "CLUSTER_POLICY_ACTIVATION_DIGEST_INVALID", true);
  for (const key of ["template_file_sha256", "template_policy_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256"]) digest(value[key], "CLUSTER_POLICY_ACTIVATION_DIGEST_INVALID");
  if (value.template_file_sha256 !== CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256 || value.template_policy_sha256 !== CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256
    || value.approval_reference_sha256 === value.responsible_operator_identity_sha256
    || value.responsible_operator_identity_sha256 === value.approver_identity_sha256
    || value.approval_reference_sha256 === value.approver_identity_sha256) reject("CLUSTER_POLICY_ACTIVATION_BINDING_INVALID");
  iso(value.activated_at, "CLUSTER_POLICY_ACTIVATION_TIME_INVALID");
  iso(value.policy_expires_at, "CLUSTER_POLICY_ACTIVATION_TIME_INVALID");
  if (Date.parse(value.activated_at) >= Date.parse(value.policy_expires_at)
    || Date.parse(value.policy_expires_at) - Date.parse(value.activated_at) > 24 * 60 * 60 * 1000) reject("CLUSTER_POLICY_ACTIVATION_TIME_INVALID");
  if (!new Set(["DESTROY_AFTER_EVIDENCE", "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT"]).has(value.target_disposition)) reject("CLUSTER_POLICY_ACTIVATION_DISPOSITION_INVALID");
  validateSourceSpec(value.release_identity_source, RELEASE_IDENTITY_FILE, "0440", "CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID", null);
  if (value.policy_generation === 1) {
    if (value.previous_policy_sha256 !== ZERO_SHA256 || value.previous_activation_receipt_sha256 !== ZERO_SHA256
      || value.current_policy_source !== null || value.current_activation_source !== null) reject("CLUSTER_POLICY_ACTIVATION_GENERATION_INVALID");
  } else {
    if (value.previous_policy_sha256 === ZERO_SHA256 || value.previous_activation_receipt_sha256 === ZERO_SHA256
      || value.current_policy_source === null || value.current_activation_source === null) reject("CLUSTER_POLICY_ACTIVATION_GENERATION_INVALID");
    validateSourceSpec(value.current_policy_source, CLUSTER_POLICY_TARGET_FILE, "0440", "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
    validateSourceSpec(value.current_activation_source, CLUSTER_POLICY_ACTIVATION_CURRENT_FILE, "0400", "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
    if (value.current_policy_source.sha256 !== value.previous_policy_sha256) reject("CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
  }
  if (operation === "ACTIVATE") {
    if (value.rollback_target_source !== null) reject("CLUSTER_POLICY_ACTIVATION_ROLLBACK_INVALID");
  } else {
    if (value.policy_generation < 3 || value.rollback_target_source === null || typeof value.rollback_target_source?.path !== "string"
      || !new RegExp(`^${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/receipts/[0-9]{16}\\.[0-9a-f]{64}\\.json$`, "u").test(value.rollback_target_source.path)) {
      reject("CLUSTER_POLICY_ACTIVATION_ROLLBACK_INVALID");
    }
    validateSourceSpec(value.rollback_target_source, value.rollback_target_source.path, "0400", "CLUSTER_POLICY_ACTIVATION_ROLLBACK_INVALID");
  }
  return value;
}

export function validateClusterPolicyActivationContext(value) {
  exactKeys(value, CONTEXT_FIELDS, "CLUSTER_POLICY_ACTIVATION_CONTEXT_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_POLICY_ACTIVATION_CONTEXT_CONTRACT
    || !new Set(["ACTIVATE", "ROLLBACK"]).has(value.operation) || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject("CLUSTER_POLICY_ACTIVATION_CONTEXT_INVALID");
  identifier(value.operation_id, "CLUSTER_POLICY_ACTIVATION_CONTEXT_ID_INVALID");
  identifier(value.execution_authorization_id, "CLUSTER_POLICY_ACTIVATION_CONTEXT_ID_INVALID");
  iso(value.execution_created_at, "CLUSTER_POLICY_ACTIVATION_CONTEXT_TIME_INVALID");
  for (const key of ["execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256"]) digest(value[key], "CLUSTER_POLICY_ACTIVATION_CONTEXT_DIGEST_INVALID");
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_id !== value.operation_id || value.execution_authorization_sha256 !== value.original_authorization_sha256
      || value.expected_intent_sha256 !== null) reject("CLUSTER_POLICY_ACTIVATION_CONTEXT_BINDING_INVALID");
  } else if (value.execution_authorization_id === value.operation_id || value.execution_authorization_sha256 === value.original_authorization_sha256) {
    reject("CLUSTER_POLICY_ACTIVATION_CONTEXT_BINDING_INVALID");
  } else digest(value.expected_intent_sha256, "CLUSTER_POLICY_ACTIVATION_CONTEXT_DIGEST_INVALID");
  validateClusterPolicyActivationParameters(value.operation, value.parameters);
  const activatedAt = Date.parse(value.parameters.activated_at);
  const executionCreatedAt = Date.parse(value.execution_created_at);
  const expiresAt = Date.parse(value.parameters.policy_expires_at);
  const invalidOriginalTime = value.execution_mode === "ORIGINAL"
    && (Math.abs(activatedAt - executionCreatedAt) > 5 * 60 * 1000 || executionCreatedAt >= expiresAt);
  const invalidRecoveryTime = value.execution_mode === "RECOVERY"
    && executionCreatedAt < activatedAt;
  if (value.parameters.activation_id !== value.operation_id || invalidOriginalTime || invalidRecoveryTime) {
    reject("CLUSTER_POLICY_ACTIVATION_CONTEXT_BINDING_INVALID");
  }
  return value;
}

function physicalPath(logical, filesystemRoot) {
  if (filesystemRoot === "/") return logical;
  if (!path.isAbsolute(filesystemRoot) || logical === "/" || !logical.startsWith("/")) reject("CLUSTER_POLICY_ACTIVATION_FILESYSTEM_ROOT_INVALID");
  return path.join(filesystemRoot, logical.slice(1));
}

async function syncDirectory(directory, code) {
  let handle;
  try { handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); await handle.sync(); }
  catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
}

async function trustedDirectory(directory, modes, code) {
  return trustedOwnedDirectory(directory, 0, 0, modes, code);
}

async function trustedOwnedDirectory(directory, uid, gid, modes, code) {
  let metadata;
  try { metadata = await lstat(directory); }
  catch { reject(code); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== gid
    || !modes.has(metadata.mode & 0o7777) || await realpath(directory) !== directory) reject(code);
  return directory;
}

async function trustedMarker(file, raw, mode, gid, code) {
  const metadata = await lstat(file, { bigint: true }).catch(() => reject(code));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== BigInt(gid)
    || metadata.nlink !== 1n || modeOf(metadata) !== mode || metadata.size !== BigInt(raw.length)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const value = await handle.readFile();
    const after = await handle.stat({ bigint: true }), named = await lstat(file, { bigint: true });
    const identity = (entry) => [entry.dev, entry.ino, entry.size, entry.mtimeNs, entry.ctimeNs];
    if (!value.equals(raw) || identity(opened).some((entry, index) => entry !== identity(metadata)[index])
      || identity(after).some((entry, index) => entry !== identity(opened)[index])
      || identity(named).some((entry, index) => entry !== identity(opened)[index])
      || named.nlink !== 1n || named.uid !== 0n || named.gid !== BigInt(gid) || modeOf(named) !== mode) reject(code);
  } finally { await handle.close(); }
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

async function trustedFile(file, mode, validator, code, expectedGid = 0) {
  const metadata = await lstat(file, { bigint: true }).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata === null) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== BigInt(expectedGid) || metadata.nlink !== 1n
    || modeOf(metadata) !== mode || metadata.size < 2n || metadata.size > BigInt(MAX_JSON_BYTES)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = (value) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs];
    if (identity(opened).some((entry, index) => entry !== identity(metadata)[index]) || opened.nlink !== 1n || opened.uid !== 0n || opened.gid !== BigInt(expectedGid) || modeOf(opened) !== mode) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true }), named = await lstat(file, { bigint: true });
    if (identity(after).some((entry, index) => entry !== identity(opened)[index]) || identity(named).some((entry, index) => entry !== identity(opened)[index])
      || named.nlink !== 1n || named.uid !== 0n || named.gid !== BigInt(expectedGid) || modeOf(named) !== mode) reject(`${code}_CHANGED`);
    let parsed;
    try { parsed = parseStrictJson(raw.toString("utf8"), MAX_JSON_BYTES); }
    catch { reject(code); }
    let value;
    try { value = validator(parsed); }
    catch { reject(code); }
    if (raw.toString("utf8") !== canonicalClusterJson(value)) reject(code);
    return Object.freeze({ raw, value, metadata: opened });
  } finally { await handle.close(); }
}

async function readAuthorizedSource(spec, filesystemRoot, validator, code) {
  const file = physicalPath(spec.path, filesystemRoot);
  const stored = await trustedFile(file, Number.parseInt(spec.mode, 8), validator, code, spec.gid);
  if (!stored || stored.raw.length !== spec.bytes || sha256(stored.raw) !== spec.sha256
    || String(stored.metadata.dev) !== spec.device || String(stored.metadata.ino) !== spec.inode) reject(code);
  return stored;
}

async function ensureRawFile(file, raw, finalMode, validator, code) {
  let metadata = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (metadata !== null && metadata.isFile() && !metadata.isSymbolicLink() && metadata.uid === 0 && metadata.gid === 0 && metadata.nlink === 1
    && new Set([0o600, finalMode]).has(metadata.mode & 0o7777) && metadata.size >= 0 && metadata.size <= raw.length) {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
    let existing;
    try { existing = await handle.readFile(); } finally { await handle.close(); }
    if (raw.subarray(0, existing.length).equals(existing)) {
      if (existing.length === raw.length && (metadata.mode & 0o7777) === finalMode) {
        const trusted = await trustedFile(file, finalMode, validator, code);
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
  const stored = await trustedFile(file, finalMode, validator, code);
  if (!stored?.raw.equals(raw)) reject(code);
}

async function atomicAlias(file, temporary, raw, mode, validator, expectedPrevious, code) {
  await ensureRawFile(temporary, raw, mode, validator, `${code}_TEMP_INVALID`);
  const before = await trustedFile(file, mode, validator, `${code}_CURRENT_INVALID`);
  if (expectedPrevious === null ? before !== null : before === null || !before.raw.equals(expectedPrevious)) reject(`${code}_CURRENT_CHANGED`);
  await rename(temporary, file).catch(() => reject(`${code}_RENAME_FAILED`));
  await syncDirectory(path.dirname(file), `${code}_SYNC_FAILED`);
  const stored = await trustedFile(file, mode, validator, `${code}_CURRENT_INVALID`);
  if (!stored?.raw.equals(raw)) reject(`${code}_CURRENT_INVALID`);
}

async function ensureMarker(file, raw, allowCreate, code) {
  const existing = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (existing === null) {
    if (!allowCreate) reject(code);
    let handle;
    try { handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await handle.writeFile(raw); await handle.chown(0, 0); await handle.chmod(0o400); await handle.sync(); }
    catch { reject(code); }
    finally { await handle?.close().catch(() => undefined); }
    await syncDirectory(path.dirname(file), code);
  }
  const metadata = await lstat(file, { bigint: true }).catch(() => reject(code));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== 0n || metadata.nlink !== 1n || modeOf(metadata) !== 0o400) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try { if (!(await handle.readFile()).equals(raw)) reject(code); }
  finally { await handle.close(); }
}

async function layout(filesystemRoot, initialize) {
  const stateRoot = physicalPath(CLUSTER_POLICY_ACTIVATION_STATE_ROOT, filesystemRoot);
  const stateParent = path.dirname(stateRoot);
  const target = physicalPath(CLUSTER_POLICY_TARGET_FILE, filesystemRoot);
  const targetRoot = path.dirname(target), targetParent = path.dirname(targetRoot);
  if (initialize) {
    const state = await ensureDirectory(stateRoot, stateParent, 0o700, "CLUSTER_POLICY_ACTIVATION_STATE_ROOT_INVALID");
    await ensureMarker(path.join(stateRoot, CLUSTER_POLICY_ACTIVATION_STATE_MARKER), Buffer.from(CLUSTER_POLICY_ACTIVATION_STATE_MARKER_VALUE), state.created, "CLUSTER_POLICY_ACTIVATION_STATE_MARKER_INVALID");
    for (const name of ["history", "receipts", "intents", "recoveries", "quarantine"]) await ensureDirectory(path.join(stateRoot, name), stateRoot, 0o700, "CLUSTER_POLICY_ACTIVATION_STATE_ROOT_INVALID");
    const targetDirectory = await ensureDirectory(targetRoot, targetParent, 0o700, "CLUSTER_POLICY_ACTIVATION_TARGET_ROOT_INVALID");
    await ensureMarker(path.join(targetRoot, CLUSTER_POLICY_TARGET_MARKER), Buffer.from(CLUSTER_POLICY_TARGET_MARKER_VALUE), targetDirectory.created, "CLUSTER_POLICY_ACTIVATION_TARGET_MARKER_INVALID");
  } else {
    await trustedDirectory(stateRoot, new Set([0o700]), "CLUSTER_POLICY_ACTIVATION_STATE_ROOT_INVALID");
    for (const name of ["history", "receipts", "intents", "recoveries", "quarantine"]) await trustedDirectory(path.join(stateRoot, name), new Set([0o700]), "CLUSTER_POLICY_ACTIVATION_STATE_ROOT_INVALID");
    await ensureMarker(path.join(stateRoot, CLUSTER_POLICY_ACTIVATION_STATE_MARKER), Buffer.from(CLUSTER_POLICY_ACTIVATION_STATE_MARKER_VALUE), false, "CLUSTER_POLICY_ACTIVATION_STATE_MARKER_INVALID");
    await trustedDirectory(targetRoot, new Set([0o700]), "CLUSTER_POLICY_ACTIVATION_TARGET_ROOT_INVALID");
    await ensureMarker(path.join(targetRoot, CLUSTER_POLICY_TARGET_MARKER), Buffer.from(CLUSTER_POLICY_TARGET_MARKER_VALUE), false, "CLUSTER_POLICY_ACTIVATION_TARGET_MARKER_INVALID");
  }
  return Object.freeze({ stateRoot, targetRoot, target, history: path.join(stateRoot, "history"), receipts: path.join(stateRoot, "receipts"), intents: path.join(stateRoot, "intents"), recoveries: path.join(stateRoot, "recoveries"), quarantine: path.join(stateRoot, "quarantine"), current: physicalPath(CLUSTER_POLICY_ACTIVATION_CURRENT_FILE, filesystemRoot) });
}

async function strictNames(directory, pattern, allowed, code) {
  const names = await readdir(directory).catch(() => reject(code));
  if (names.length > 10_000 || names.some((name) => !pattern.test(name))) reject(code);
  return names.filter((name) => !allowed.has(name)).sort();
}

async function committedChain(paths, allowedHistory = new Set(), allowedReceipts = new Set(), allowedTargetRaw = null) {
  const current = await trustedFile(paths.current, 0o400, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_PUBLICATION_CURRENT_INVALID");
  const historyNames = await strictNames(paths.history, /^[0-9]{16}\.[0-9a-f]{64}\.json$/u, allowedHistory, "CLUSTER_POLICY_PUBLICATION_HISTORY_INVALID");
  const receiptNames = await strictNames(paths.receipts, /^[0-9]{16}\.[0-9a-f]{64}\.json$/u, allowedReceipts, "CLUSTER_POLICY_PUBLICATION_RECEIPTS_INVALID");
  const target = await trustedFile(paths.target, 0o440, validateClusterRecoveryPolicyV2, "CLUSTER_POLICY_PUBLICATION_TARGET_INVALID");
  if (current === null) {
    if (historyNames.length !== 0 || receiptNames.length !== 0 || target !== null && !allowedTargetRaw?.equals(target.raw)) reject("CLUSTER_POLICY_PUBLICATION_BOOTSTRAP_STATE_INVALID");
    return Object.freeze({ current: null, currentPolicy: null, receipts: [], policies: [], target });
  }
  const generation = current.value.generation;
  if (historyNames.length !== generation || receiptNames.length !== generation) reject("CLUSTER_POLICY_PUBLICATION_CHAIN_INVALID");
  const receipts = [], policies = [];
  for (let index = 0; index < generation; index += 1) {
    const expectedGeneration = index + 1;
    const receiptName = receiptNames[index], historyName = historyNames[index];
    if (!receiptName.startsWith(`${String(expectedGeneration).padStart(16, "0")}.`) || !historyName.startsWith(`${String(expectedGeneration).padStart(16, "0")}.`)) reject("CLUSTER_POLICY_PUBLICATION_CHAIN_INVALID");
    const receipt = await trustedFile(path.join(paths.receipts, receiptName), 0o400, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_PUBLICATION_RECEIPT_INVALID");
    const policy = await trustedFile(path.join(paths.history, historyName), 0o400, validateClusterRecoveryPolicyV2, "CLUSTER_POLICY_PUBLICATION_HISTORY_INVALID");
    if (!receipt || !policy || receipt.value.generation !== expectedGeneration || receipt.value.receipt_sha256 !== receiptName.slice(17, 81)
      || receipt.value.policy_sha256 !== clusterRecoveryPolicyV2Sha256(policy.value)
      || historyName !== path.basename(receipt.value.history_file) || !receipt.raw.equals(Buffer.from(canonicalClusterJson(receipt.value)))) reject("CLUSTER_POLICY_PUBLICATION_CHAIN_INVALID");
    validateClusterRecoveryPolicyActivationReceipt(receipt.value, policy.value);
    if (receipt.value.previous_policy_sha256 !== (index === 0 ? ZERO_SHA256 : receipts[index - 1].value.policy_sha256)
      || receipt.value.previous_activation_receipt_sha256 !== (index === 0 ? ZERO_SHA256 : receipts[index - 1].value.receipt_sha256)
      || index > 0 && receipt.value.environment !== receipts[index - 1].value.environment
      || receipt.value.operation === "ROLLBACK" && (index < 2
        || receipt.value.rollback_target_activation_receipt_sha256 !== receipts[index - 2].value.receipt_sha256
        || receipt.value.environment !== receipts[index - 2].value.environment
        || receipt.value.rpo_hours !== receipts[index - 2].value.rpo_hours
        || receipt.value.rto_minutes !== receipts[index - 2].value.rto_minutes
        || receipt.value.target_disposition !== receipts[index - 2].value.target_disposition)) reject("CLUSTER_POLICY_PUBLICATION_CHAIN_INVALID");
    receipts.push(receipt); policies.push(policy);
  }
  if (!current.raw.equals(receipts.at(-1).raw)) reject("CLUSTER_POLICY_PUBLICATION_CURRENT_INVALID");
  const currentRaw = policies.at(-1).raw;
  if (target === null || !target.raw.equals(currentRaw) && !allowedTargetRaw?.equals(target.raw)) reject("CLUSTER_POLICY_PUBLICATION_TARGET_INVALID");
  return Object.freeze({ current, currentPolicy: policies.at(-1), receipts, policies, target });
}

export async function readCommittedClusterPolicyActivation(policyInput = null, options = {}) {
  const filesystemRoot = path.resolve(options.filesystemRoot || "/");
  const paths = await layout(filesystemRoot, false);
  const expectedStateEntries = new Set([
    CLUSTER_POLICY_ACTIVATION_STATE_MARKER, "history", "receipts", "intents", "recoveries", "quarantine", "current.json",
  ]);
  const stateEntries = await readdir(paths.stateRoot).catch(() => reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_STATE_INVALID"));
  if (stateEntries.length !== expectedStateEntries.size || stateEntries.some((name) => !expectedStateEntries.has(name))) {
    reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_STATE_INVALID");
  }
  if ((await readdir(paths.quarantine).catch(() => reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_STATE_INVALID"))).length !== 0) {
    reject("CLUSTER_POLICY_ACTIVATION_QUARANTINE_PRESENT");
  }
  const targetEntries = await readdir(paths.targetRoot).catch(() => reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_STATE_INVALID"));
  if (targetEntries.some((name) => /^\..+\.tmp$/u.test(name))) reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_STATE_INVALID");
  const chain = await committedChain(paths);
  if (!chain.current || !chain.currentPolicy) reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_STATE_MISSING");
  const committedReceipts = new Set(chain.receipts.map((entry) => entry.value.receipt_sha256));
  const intentReceipts = new Set();
  const intentNames = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "CLUSTER_POLICY_ACTIVATION_INTENT_ROOT_INVALID");
  for (const name of intentNames) {
    const intent = await trustedFile(path.join(paths.intents, name), 0o400, validateIntent, "CLUSTER_POLICY_ACTIVATION_INTENT_INVALID");
    if (!intent || name !== `${intent.value.operation_id}.${intent.value.intent_sha256}.json`
      || !committedReceipts.has(intent.value.receipt.receipt_sha256)
      || intentReceipts.has(intent.value.receipt.receipt_sha256)) reject("CLUSTER_POLICY_ACTIVATION_UNRESOLVED_INTENT");
    intentReceipts.add(intent.value.receipt.receipt_sha256);
  }
  if (intentReceipts.size !== committedReceipts.size) reject("CLUSTER_POLICY_ACTIVATION_UNRESOLVED_INTENT");
  if (policyInput !== null) {
    const expectedPolicy = validateClusterRecoveryPolicyV2(policyInput);
    if (canonicalClusterJson(expectedPolicy) !== canonicalClusterJson(chain.currentPolicy.value)) reject("CLUSTER_POLICY_ACTIVATION_COMMITTED_POLICY_MISMATCH");
  }
  return Object.freeze({ policy: chain.currentPolicy.value, receipt: chain.current.value });
}

async function repositoryTemplate(siteRoot) {
  const file = path.join(siteRoot, TEMPLATE_RELATIVE);
  const raw = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).then(async (handle) => { try { return await handle.readFile(); } finally { await handle.close(); } }).catch(() => reject("CLUSTER_POLICY_ACTIVATION_TEMPLATE_INVALID"));
  if (sha256(raw) !== CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256) reject("CLUSTER_POLICY_ACTIVATION_TEMPLATE_REPLACED");
  let policy;
  try { policy = validateClusterRecoveryPolicyV2(parseStrictJson(raw.toString("utf8"), MAX_JSON_BYTES)); }
  catch { reject("CLUSTER_POLICY_ACTIVATION_TEMPLATE_INVALID"); }
  if (policy.activation.status !== "REPOSITORY_TEMPLATE" || clusterRecoveryPolicyV2Sha256(policy) !== CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256) reject("CLUSTER_POLICY_ACTIVATION_TEMPLATE_REPLACED");
  return policy;
}

async function verifyReleaseIdentitySource(context, filesystemRoot) {
  const parameters = context.parameters;
  const releaseIdentityRoot = physicalPath(path.dirname(RELEASE_IDENTITY_FILE), filesystemRoot);
  await trustedOwnedDirectory(releaseIdentityRoot, 0, parameters.release_identity_source.gid, new Set([0o750]), "CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID");
  await trustedMarker(
    path.join(releaseIdentityRoot, RELEASE_IDENTITY_ROOT_MARKER),
    Buffer.from(RELEASE_IDENTITY_ROOT_MARKER_VALUE), 0o440, parameters.release_identity_source.gid,
    "CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID",
  );
  const releaseIdentity = await readAuthorizedSource(
    parameters.release_identity_source, filesystemRoot, validateReleaseIdentity,
    "CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID",
  );
  if (releaseIdentity.value.contract !== RELEASE_IDENTITY_CONTRACT
    || releaseIdentity.value.deployment_class !== parameters.environment
    || Date.parse(releaseIdentity.value.generated_at) > Date.parse(parameters.activated_at) + 5 * 60 * 1000) {
    reject("CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID");
  }
}

async function verifyPolicySources(context, filesystemRoot) {
  const parameters = context.parameters;
  if (parameters.policy_generation === 1) {
    const target = physicalPath(CLUSTER_POLICY_TARGET_FILE, filesystemRoot), current = physicalPath(CLUSTER_POLICY_ACTIVATION_CURRENT_FILE, filesystemRoot);
    if (await lstat(target).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID"))
      || await lstat(current).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID"))) reject("CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
  } else {
    await readAuthorizedSource(parameters.current_policy_source, filesystemRoot, validateClusterRecoveryPolicyV2, "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
    const currentActivation = await readAuthorizedSource(parameters.current_activation_source, filesystemRoot, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
    if (currentActivation.value.receipt_sha256 !== parameters.previous_activation_receipt_sha256) reject("CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
  }
  if (context.operation === "ROLLBACK") {
    const rollbackTarget = await readAuthorizedSource(parameters.rollback_target_source, filesystemRoot, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_ACTIVATION_ROLLBACK_SOURCE_INVALID");
    if (rollbackTarget.value.receipt_sha256 === parameters.previous_activation_receipt_sha256) reject("CLUSTER_POLICY_ACTIVATION_ROLLBACK_SOURCE_INVALID");
  }
}

async function verifyAuthorizedSources(context, filesystemRoot) {
  await verifyReleaseIdentitySource(context, filesystemRoot);
  await verifyPolicySources(context, filesystemRoot);
}

async function candidateFor(context, paths, siteRoot) {
  const parameters = context.parameters;
  const template = await repositoryTemplate(siteRoot);
  const chain = await committedChain(paths);
  const expectedGeneration = chain.current === null ? 1 : chain.current.value.generation + 1;
  const expectedPreviousPolicy = chain.current === null ? ZERO_SHA256 : chain.current.value.policy_sha256;
  const expectedPreviousReceipt = chain.current === null ? ZERO_SHA256 : chain.current.value.receipt_sha256;
  if (parameters.policy_generation !== expectedGeneration || parameters.previous_policy_sha256 !== expectedPreviousPolicy
    || parameters.previous_activation_receipt_sha256 !== expectedPreviousReceipt
    || chain.current !== null && parameters.environment !== chain.current.value.environment) reject("CLUSTER_POLICY_ACTIVATION_GENERATION_MISMATCH");
  if (context.operation === "ROLLBACK") {
    if (chain.receipts.length < 2) reject("CLUSTER_POLICY_ACTIVATION_ROLLBACK_INVALID");
    const target = chain.receipts.at(-2);
    if (parameters.rollback_target_source.sha256 !== sha256(target.raw)
      || parameters.rollback_target_source.path !== `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/receipts/${String(target.value.generation).padStart(16, "0")}.${target.value.receipt_sha256}.json`
      || parameters.environment !== target.value.environment || parameters.rpo_hours !== target.value.rpo_hours
      || parameters.rto_minutes !== target.value.rto_minutes || parameters.target_disposition !== target.value.target_disposition) reject("CLUSTER_POLICY_ACTIVATION_ROLLBACK_INVALID");
  }
  const policy = activateClusterRecoveryPolicyV2(template, {
    environment: parameters.environment,
    generation: parameters.policy_generation,
    previous_policy_sha256: parameters.previous_policy_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    authorization_sha256: context.original_authorization_sha256,
    approval_reference_sha256: parameters.approval_reference_sha256,
    responsible_operator_identity_sha256: parameters.responsible_operator_identity_sha256,
    approver_identity_sha256: parameters.approver_identity_sha256,
    rpo_hours: parameters.rpo_hours,
    rto_minutes: parameters.rto_minutes,
    target_disposition: parameters.target_disposition,
    activated_at: parameters.activated_at,
    expires_at: parameters.policy_expires_at,
  });
  const receipt = createClusterRecoveryPolicyActivationReceipt({
    policy,
    activationId: context.operation_id,
    operation: context.operation,
    previousActivationReceiptSha256: parameters.previous_activation_receipt_sha256,
    releaseIdentitySha256: parameters.release_identity_source.sha256,
    rollbackTargetActivationReceiptSha256: context.operation === "ROLLBACK" ? chain.receipts.at(-2).value.receipt_sha256 : ZERO_SHA256,
  });
  return Object.freeze({ policy, receipt, chain });
}

function createIntent(context, candidate) {
  const body = {
    schema_version: 1,
    contract: CLUSTER_POLICY_ACTIVATION_INTENT_CONTRACT,
    operation_id: context.operation_id,
    operation: context.operation,
    created_at: context.parameters.activated_at,
    original_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters: context.parameters,
    policy: candidate.policy,
    receipt: candidate.receipt,
  };
  return Object.freeze({ ...body, intent_sha256: clusterSha256(body) });
}

function validateIntent(value) {
  exactKeys(value, ["schema_version", "contract", "operation_id", "operation", "created_at", "original_authorization_sha256", "supervisor_bundle_sha256", "parameters", "policy", "receipt", "intent_sha256"], "CLUSTER_POLICY_ACTIVATION_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_POLICY_ACTIVATION_INTENT_CONTRACT) reject("CLUSTER_POLICY_ACTIVATION_INTENT_INVALID");
  validateClusterPolicyActivationParameters(value.operation, value.parameters);
  const policy = validateClusterRecoveryPolicyV2(value.policy), receipt = validateClusterRecoveryPolicyActivationReceipt(value.receipt, policy);
  if (value.operation_id !== value.parameters.activation_id || receipt.activation_id !== value.operation_id
    || receipt.operation !== value.operation || receipt.authorization_sha256 !== value.original_authorization_sha256
    || receipt.supervisor_bundle_sha256 !== value.supervisor_bundle_sha256
    || receipt.release_identity_sha256 !== value.parameters.release_identity_source.sha256
    || clusterSha256(bodyWithout(value, "intent_sha256")) !== value.intent_sha256) reject("CLUSTER_POLICY_ACTIVATION_INTENT_INVALID");
  return value;
}

function intentFile(paths, intent) { return path.join(paths.intents, `${intent.operation_id}.${intent.intent_sha256}.json`); }
function historyFile(paths, receipt) { return path.join(paths.history, path.basename(receipt.history_file)); }
function receiptFile(paths, receipt) { return path.join(paths.receipts, `${String(receipt.generation).padStart(16, "0")}.${receipt.receipt_sha256}.json`); }

async function prepareOriginal(context, options) {
  const paths = await layout(options.filesystemRoot, true);
  if ((await readdir(paths.quarantine)).length !== 0) reject("CLUSTER_POLICY_ACTIVATION_QUARANTINE_PRESENT");
  await verifyAuthorizedSources(context, options.filesystemRoot);
  const candidate = await candidateFor(context, paths, options.siteRoot);
  const intent = createIntent(context, candidate), raw = Buffer.from(canonicalClusterJson(intent)), file = intentFile(paths, intent);
  await ensureRawFile(file, raw, 0o400, validateIntent, "CLUSTER_POLICY_ACTIVATION_INTENT_CONFLICT");
  await syncDirectory(paths.intents, "CLUSTER_POLICY_ACTIVATION_INTENT_SYNC_FAILED");
  return Object.freeze({ result: "PREPARED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, policy_sha256: intent.receipt.policy_sha256, receipt_sha256: intent.receipt.receipt_sha256 });
}

async function loadIntent(context, paths) {
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "CLUSTER_POLICY_ACTIVATION_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => name.startsWith(`${context.operation_id}.`));
  if (matches.length !== 1) reject("CLUSTER_POLICY_ACTIVATION_INTENT_MISSING");
  const stored = await trustedFile(path.join(paths.intents, matches[0]), 0o400, validateIntent, "CLUSTER_POLICY_ACTIVATION_INTENT_INVALID");
  if (!stored || context.expected_intent_sha256 !== null && stored.value.intent_sha256 !== context.expected_intent_sha256
    || stored.value.original_authorization_sha256 !== context.original_authorization_sha256 || stored.value.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || stored.value.operation !== context.operation || canonicalClusterJson(stored.value.parameters) !== canonicalClusterJson(context.parameters)) reject("CLUSTER_POLICY_ACTIVATION_INTENT_BINDING_INVALID");
  return stored.value;
}

async function candidateState(paths, intent) {
  const policyRaw = Buffer.from(canonicalClusterJson(intent.policy)), receiptRaw = Buffer.from(canonicalClusterJson(intent.receipt));
  const hName = path.basename(intent.receipt.history_file), rName = path.basename(receiptFile(paths, intent.receipt));
  const current = await trustedFile(paths.current, 0o400, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_PUBLICATION_CURRENT_INVALID");
  if (current?.value.receipt_sha256 === intent.receipt.receipt_sha256) {
    const committed = await committedChain(paths);
    if (!committed.currentPolicy.raw.equals(policyRaw)) reject("CLUSTER_POLICY_PUBLICATION_COMMITTED_MISMATCH");
    return Object.freeze({ committed: true, history: true, target: true, receipt: true, current: true, policyRaw, receiptRaw, chain: committed });
  }
  const chain = await committedChain(paths, new Set([hName]), new Set([rName]), policyRaw);
  if ((chain.current?.value.receipt_sha256 || ZERO_SHA256) !== intent.receipt.previous_activation_receipt_sha256) reject("CLUSTER_POLICY_PUBLICATION_CURRENT_CHANGED");
  const h = await trustedFile(historyFile(paths, intent.receipt), 0o400, validateClusterRecoveryPolicyV2, "CLUSTER_POLICY_PUBLICATION_HISTORY_INVALID");
  const r = await trustedFile(receiptFile(paths, intent.receipt), 0o400, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_PUBLICATION_RECEIPT_INVALID");
  const target = await trustedFile(paths.target, 0o440, validateClusterRecoveryPolicyV2, "CLUSTER_POLICY_PUBLICATION_TARGET_INVALID");
  const historyDone = h?.raw.equals(policyRaw) || false, receiptDone = r?.raw.equals(receiptRaw) || false, targetDone = target?.raw.equals(policyRaw) || false;
  if (h !== null && !historyDone || r !== null && !receiptDone || target !== null && !targetDone && !target.raw.equals(chain.currentPolicy?.raw || Buffer.alloc(0))) reject("CLUSTER_POLICY_PUBLICATION_CANDIDATE_CONFLICT");
  if (targetDone && !historyDone || receiptDone && (!historyDone || !targetDone)) reject("CLUSTER_POLICY_PUBLICATION_STAGE_ORDER_INVALID");
  return Object.freeze({ committed: false, history: historyDone, target: targetDone, receipt: receiptDone, current: false, policyRaw, receiptRaw, chain });
}

async function commitIntent(context, intent, paths, options) {
  let state = await candidateState(paths, intent);
  if (state.committed) return Object.freeze({ result: "ALREADY_COMMITTED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, policy_sha256: intent.receipt.policy_sha256, receipt_sha256: intent.receipt.receipt_sha256 });
  if (!state.history) {
    await ensureRawFile(historyFile(paths, intent.receipt), state.policyRaw, 0o400, validateClusterRecoveryPolicyV2, "CLUSTER_POLICY_PUBLICATION_HISTORY_CONFLICT");
    await syncDirectory(paths.history, "CLUSTER_POLICY_PUBLICATION_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_HISTORY");
  }
  state = await candidateState(paths, intent);
  if (!state.target) {
    const temporary = path.join(paths.targetRoot, `.${intent.operation_id}.${intent.receipt.policy_sha256}.tmp`);
    await atomicAlias(paths.target, temporary, state.policyRaw, 0o440, validateClusterRecoveryPolicyV2, state.chain.currentPolicy?.raw || null, "CLUSTER_POLICY_PUBLICATION_TARGET");
    await options.fault?.("AFTER_TARGET");
  }
  state = await candidateState(paths, intent);
  if (!state.receipt) {
    await ensureRawFile(receiptFile(paths, intent.receipt), state.receiptRaw, 0o400, validateClusterRecoveryPolicyActivationReceipt, "CLUSTER_POLICY_PUBLICATION_RECEIPT_CONFLICT");
    await syncDirectory(paths.receipts, "CLUSTER_POLICY_PUBLICATION_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_RECEIPT");
  }
  state = await candidateState(paths, intent);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${intent.operation_id}.${intent.receipt.receipt_sha256}.tmp`);
    await atomicAlias(paths.current, temporary, state.receiptRaw, 0o400, validateClusterRecoveryPolicyActivationReceipt, state.chain.current?.raw || null, "CLUSTER_POLICY_PUBLICATION_CURRENT");
    await options.fault?.("AFTER_CURRENT");
  }
  state = await candidateState(paths, intent);
  if (!state.committed) reject("CLUSTER_POLICY_PUBLICATION_COMMIT_INCOMPLETE");
  return Object.freeze({ result: "COMMITTED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, policy_sha256: intent.receipt.policy_sha256, receipt_sha256: intent.receipt.receipt_sha256 });
}

function recoveryPlan(context, intent, decision, reason) {
  const body = {
    schema_version: 1,
    contract: CLUSTER_POLICY_ACTIVATION_RECOVERY_CONTRACT,
    execution_authorization_id: context.execution_authorization_id,
    execution_authorization_sha256: context.execution_authorization_sha256,
    prepared_at: context.execution_created_at,
    original_operation_id: context.operation_id,
    original_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.intent_sha256,
    decision,
    reason,
  };
  return Object.freeze({ ...body, recovery_sha256: clusterSha256(body) });
}

function validateRecoveryPlan(value) {
  exactKeys(value, ["schema_version", "contract", "execution_authorization_id", "execution_authorization_sha256", "prepared_at", "original_operation_id", "original_authorization_sha256", "intent_sha256", "decision", "reason", "recovery_sha256"], "CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_POLICY_ACTIVATION_RECOVERY_CONTRACT || !new Set(["RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"]).has(value.decision)
    || value.decision === "QUARANTINE" !== (typeof value.reason === "string")) reject("CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID");
  identifier(value.execution_authorization_id, "CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID"); identifier(value.original_operation_id, "CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID"); iso(value.prepared_at, "CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID");
  for (const key of ["execution_authorization_sha256", "original_authorization_sha256", "intent_sha256", "recovery_sha256"]) digest(value[key], "CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID");
  if (clusterSha256(bodyWithout(value, "recovery_sha256")) !== value.recovery_sha256) reject("CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID");
  return value;
}

async function prepareRecovery(context, options) {
  const paths = await layout(options.filesystemRoot, false), intent = await loadIntent(context, paths);
  let decision = "RESUME_PUBLICATION", reason = null;
  try {
    const state = await candidateState(paths, intent);
    if (state.committed) decision = "ALREADY_COMMITTED";
    else if (Date.parse(context.execution_created_at) >= Date.parse(context.parameters.policy_expires_at)) {
      decision = "QUARANTINE"; reason = "CLUSTER_POLICY_ACTIVATION_POLICY_EXPIRED";
    } else {
      await verifyReleaseIdentitySource(context, options.filesystemRoot);
      if (!state.target) await verifyPolicySources(context, options.filesystemRoot);
    }
  }
  catch (error) {
    const recoverableDrift = error instanceof ClusterRecoveryPolicyPublisherError
      && (error.code.startsWith("CLUSTER_POLICY_PUBLICATION_")
        || new Set(["CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID", "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID", "CLUSTER_POLICY_ACTIVATION_ROLLBACK_SOURCE_INVALID"]).has(error.code));
    if (!recoverableDrift) throw error;
    decision = "QUARANTINE"; reason = error.code;
  }
  const plan = recoveryPlan(context, intent, decision, reason), raw = Buffer.from(canonicalClusterJson(plan));
  const file = path.join(paths.recoveries, `${context.execution_authorization_id}.${plan.recovery_sha256}.json`);
  await ensureRawFile(file, raw, 0o400, validateRecoveryPlan, "CLUSTER_POLICY_ACTIVATION_RECOVERY_CONFLICT");
  await syncDirectory(paths.recoveries, "CLUSTER_POLICY_ACTIVATION_RECOVERY_SYNC_FAILED");
  return Object.freeze({ result: "RECOVERY_PREPARED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, recovery_sha256: plan.recovery_sha256, decision });
}

async function loadRecoveryPlan(context, paths) {
  const names = await strictNames(paths.recoveries, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "CLUSTER_POLICY_ACTIVATION_RECOVERY_ROOT_INVALID");
  const matches = names.filter((name) => name.startsWith(`${context.execution_authorization_id}.`));
  if (matches.length !== 1) reject("CLUSTER_POLICY_ACTIVATION_RECOVERY_MISSING");
  const stored = await trustedFile(path.join(paths.recoveries, matches[0]), 0o400, validateRecoveryPlan, "CLUSTER_POLICY_ACTIVATION_RECOVERY_INVALID");
  if (!stored || stored.value.original_operation_id !== context.operation_id || stored.value.original_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.execution_authorization_sha256 !== context.execution_authorization_sha256 || stored.value.intent_sha256 !== context.expected_intent_sha256) reject("CLUSTER_POLICY_ACTIVATION_RECOVERY_BINDING_INVALID");
  return stored.value;
}

async function executeRecovery(context, options) {
  const paths = await layout(options.filesystemRoot, false), intent = await loadIntent(context, paths), plan = await loadRecoveryPlan(context, paths);
  if (plan.decision !== "QUARANTINE") {
    await verifyReleaseIdentitySource(context, options.filesystemRoot);
    const state = await candidateState(paths, intent);
    if (!state.committed && !state.target) await verifyPolicySources(context, options.filesystemRoot);
    const result = await commitIntent(context, intent, paths, options);
    return Object.freeze({ ...result, recovery_sha256: plan.recovery_sha256 });
  }
  const body = {
    schema_version: 1,
    contract: CLUSTER_POLICY_ACTIVATION_QUARANTINE_CONTRACT,
    status: "QUARANTINED",
    quarantined_at: plan.prepared_at,
    original_operation_id: intent.operation_id,
    intent_sha256: intent.intent_sha256,
    recovery_sha256: plan.recovery_sha256,
    reason: plan.reason,
    preservation: "FILES_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE",
  };
  const quarantine = Object.freeze({ ...body, quarantine_sha256: clusterSha256(body) });
  const raw = Buffer.from(canonicalClusterJson(quarantine)), file = path.join(paths.quarantine, `${intent.operation_id}.${quarantine.quarantine_sha256}.json`);
  const validator = (value) => {
    exactKeys(value, [...Object.keys(body), "quarantine_sha256"], "CLUSTER_POLICY_ACTIVATION_QUARANTINE_INVALID");
    if (clusterSha256(bodyWithout(value, "quarantine_sha256")) !== value.quarantine_sha256) reject("CLUSTER_POLICY_ACTIVATION_QUARANTINE_INVALID");
    return value;
  };
  await ensureRawFile(file, raw, 0o400, validator, "CLUSTER_POLICY_ACTIVATION_QUARANTINE_CONFLICT");
  await syncDirectory(paths.quarantine, "CLUSTER_POLICY_ACTIVATION_QUARANTINE_SYNC_FAILED");
  return Object.freeze({ result: "QUARANTINED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, recovery_sha256: plan.recovery_sha256, quarantine_sha256: quarantine.quarantine_sha256 });
}

export async function runClusterPolicyActivationPhase(contextInput, phase, options = {}) {
  const context = validateClusterPolicyActivationContext(contextInput);
  const resolved = {
    filesystemRoot: path.resolve(options.filesystemRoot || "/"),
    siteRoot: path.resolve(options.siteRoot || SITE_ROOT),
    fault: options.fault,
  };
  if (phase === "prepare") {
    if (context.execution_mode !== "ORIGINAL") reject("CLUSTER_POLICY_ACTIVATION_PHASE_INVALID");
    return prepareOriginal(context, resolved);
  }
  const paths = await layout(resolved.filesystemRoot, false);
  if (phase === "execute") {
    if (context.execution_mode !== "ORIGINAL") reject("CLUSTER_POLICY_ACTIVATION_PHASE_INVALID");
    const intent = await loadIntent(context, paths);
    const state = await candidateState(paths, intent);
    if (!state.committed && !state.target) await verifyAuthorizedSources(context, resolved.filesystemRoot);
    return commitIntent(context, intent, paths, resolved);
  }
  if (phase === "recover-prepare") {
    if (context.execution_mode !== "RECOVERY") reject("CLUSTER_POLICY_ACTIVATION_PHASE_INVALID");
    return prepareRecovery(context, resolved);
  }
  if (phase === "recover-execute") {
    if (context.execution_mode !== "RECOVERY") reject("CLUSTER_POLICY_ACTIVATION_PHASE_INVALID");
    return executeRecovery(context, resolved);
  }
  reject("CLUSTER_POLICY_ACTIVATION_PHASE_INVALID");
}

function assertSupervisorControl(context, phase) {
  const consumed = new Set(["execute", "recover-execute"]).has(phase) ? "YES" : "NO";
  if (process.getuid?.() !== 0 || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES" || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED !== consumed
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT) reject("CLUSTER_POLICY_ACTIVATION_SUPERVISOR_CONTROL_INVALID");
  const bundleRoot = path.dirname(SITE_ROOT);
  if (path.dirname(bundleRoot) !== SUPERVISOR_BUNDLE_ROOT || path.basename(bundleRoot) !== context.supervisor_bundle_sha256) reject("CLUSTER_POLICY_ACTIVATION_SUPERVISOR_CONTROL_INVALID");
  const descriptorText = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/u.test(descriptorText || "")) reject("CLUSTER_POLICY_ACTIVATION_GLOBAL_LOCK_INVALID");
  const descriptor = Number(descriptorText);
  let opened, named, lockLines;
  try {
    opened = fstatSync(descriptor, { bigint: true }); named = lstatSync(GLOBAL_RELEASE_LOCK, { bigint: true });
    lockLines = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:"));
  } catch { reject("CLUSTER_POLICY_ACTIVATION_GLOBAL_LOCK_INVALID"); }
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || named.uid !== 0n || named.gid !== 0n || named.nlink !== 1n || modeOf(named) !== 0o600
    || opened.dev !== named.dev || opened.ino !== named.ino || lockLines.length !== 1 || !/^lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ /u.test(lockLines[0])) reject("CLUSTER_POLICY_ACTIVATION_GLOBAL_LOCK_INVALID");
}

async function readContext() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 256 * 1024) reject("CLUSTER_POLICY_ACTIVATION_CONTEXT_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return parseStrictJson(Buffer.concat(chunks).toString("utf8"), 256 * 1024); }
  catch { reject("CLUSTER_POLICY_ACTIVATION_CONTEXT_INVALID"); }
}

async function main(argumentsList) {
  const confirmations = {
    prepare: "PREPARE_CLUSTER_POLICY_ACTIVATION_INTENT",
    execute: "COMMIT_CLUSTER_POLICY_ACTIVATION_AFTER_AUTHORIZATION",
    "recover-prepare": "PREPARE_CLUSTER_POLICY_ACTIVATION_RECOVERY",
    "recover-execute": "EXECUTE_CLUSTER_POLICY_ACTIVATION_RECOVERY_AFTER_AUTHORIZATION",
  };
  if (argumentsList.length !== 2 || confirmations[argumentsList[0]] !== argumentsList[1]) reject("CLUSTER_POLICY_ACTIVATION_USAGE_INVALID");
  const context = validateClusterPolicyActivationContext(await readContext());
  assertSupervisorControl(context, argumentsList[0]);
  process.stdout.write(canonicalClusterJson(await runClusterPolicyActivationPhase(context, argumentsList[0])));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "CLUSTER_POLICY_ACTIVATION_FAILED"}\n`);
    process.exitCode = 1;
  });
}
