import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  OpsMonitoringError,
  canonicalMonitoringJson,
  monitoringSha256,
  parseMonitoringJson,
  validateMonitoringObservation,
  validateMonitoringPolicy,
  validateMonitoringState,
} from "./contract.mjs";
import { validateMonitoringEvaluatorConfig } from "./delivery-contract.mjs";

export const MONITORING_HOST_STATE_CONTRACT = "chenyida-erp-monitoring-host-state/v1";
export const MONITORING_HOST_STATE_MARKER = ".chenyida-erp-monitoring-host-state-v1";
export const MONITORING_HOST_STATE_MARKER_VALUE = "chenyida-erp-monitoring-host-state/v1\n";
export const MONITORING_HOST_STATE_FILE = "current.json";
export const MONITORING_HOST_STATE_LOCK = ".monitor.flock";
export const MONITORING_HOST_STATE_TRANSACTION = ".state-write-prepared.json";
export const MONITORING_HOST_STATE_TRANSACTION_TEMPORARY = /^\.state-write-prepared\.([0-9a-f]{64})\.tmp$/;
export const MONITORING_OBSERVATION_MARKER = ".chenyida-erp-monitoring-observation-v1";
export const MONITORING_OBSERVATION_MARKER_VALUE = "chenyida-erp-monitoring-observation/v1\n";
export const MONITORING_OBSERVATION_FILE = "current.json";

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZERO_SHA256 = "0".repeat(64);
const STATE_BYTES = 2 * 1024 * 1024;

function reject(code) {
  throw new OpsMonitoringError(code);
}

function owner() {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid < 0 || gid < 0) reject("MONITOR_HOST_STORE_IDENTITY_UNAVAILABLE");
  return { uid, gid };
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

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
}

function ownership(metadata, expected) {
  return expected === null || metadata.uid === expected.uid && metadata.gid === expected.gid;
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function safeRoot(root, mode, expectedOwner, code) {
  const resolved = path.resolve(root);
  if (root !== resolved || resolved === path.parse(resolved).root || await realpath(resolved).catch(() => "") !== resolved) reject(code);
  const metadata = await lstat(resolved).catch(() => reject(code));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o7777) !== mode || !ownership(metadata, expectedOwner)) reject(code);
  return resolved;
}

async function safeText(file, { mode, expectedOwner, maximumBytes, code }) {
  const before = await lstat(file).catch(() => reject(code));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o7777) !== mode || !ownership(before, expectedOwner) || before.size < 1 || before.size > maximumBytes) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) reject(`${code}_CHANGED`);
    const raw = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(file).catch(() => null);
    if (!pathAfter || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.nlink !== 1 || (pathAfter.mode & 0o7777) !== mode || !ownership(pathAfter, expectedOwner)) reject(`${code}_CHANGED`);
    return raw;
  } finally { await handle.close(); }
}

async function createRoot(root, mode, marker, markerValue, lockMode = null) {
  const resolved = path.resolve(root);
  const current = owner();
  if (root !== resolved || resolved === path.parse(resolved).root) reject("MONITOR_HOST_STORE_ROOT_INVALID");
  const parent = path.dirname(resolved);
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || parentMetadata.uid !== current.uid || parentMetadata.gid !== current.gid || (parentMetadata.mode & 0o022) !== 0) reject("MONITOR_HOST_STORE_PARENT_UNSAFE");
  await mkdir(resolved, { mode });
  let handle = await open(path.join(resolved, marker), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
  try { await handle.writeFile(markerValue, "utf8"); await handle.chmod(0o400); await handle.sync(); } finally { await handle.close(); }
  if (lockMode !== null) {
    handle = await open(path.join(resolved, MONITORING_HOST_STATE_LOCK), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, lockMode);
    try { await handle.writeFile("chenyida-erp-monitoring-flock/v1\n", "utf8"); await handle.chmod(lockMode); await handle.sync(); } finally { await handle.close(); }
  }
  await syncDirectory(resolved);
  return resolved;
}

export async function initializeMonitoringHostStateRoot(root) {
  return createRoot(root, 0o700, MONITORING_HOST_STATE_MARKER, MONITORING_HOST_STATE_MARKER_VALUE, 0o600);
}

export async function initializeMonitoringObservationRoot(root) {
  return createRoot(root, 0o700, MONITORING_OBSERVATION_MARKER, MONITORING_OBSERVATION_MARKER_VALUE);
}

function wrapperBody(value) {
  const body = { ...value };
  delete body.integrity_sha256;
  return body;
}

export function validateMonitoringHostState(value, evaluatorConfig, policy) {
  const config = validateMonitoringEvaluatorConfig(evaluatorConfig);
  validateMonitoringPolicy(policy);
  exactKeys(value, ["schema_version", "contract", "wrapper_sequence", "previous_wrapper_sha256", "config_id", "config_generation", "host_config_sha256", "installation_generation", "monitoring_bundle_sha256", "activation_id", "monitoring_state", "components_watermark", "backup_watermark", "delivery_ack_watermark", "acknowledged_event_count", "updated_at", "integrity_sha256"], "MONITOR_HOST_STATE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_HOST_STATE_CONTRACT) reject("MONITOR_HOST_STATE_VERSION_INVALID");
  integer(value.wrapper_sequence, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_STATE_SEQUENCE_INVALID");
  for (const field of ["previous_wrapper_sha256", "host_config_sha256", "monitoring_bundle_sha256", "delivery_ack_watermark", "integrity_sha256"]) digest(value[field], "MONITOR_HOST_STATE_INTEGRITY_INVALID");
  if (typeof value.config_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.config_id) || !Number.isSafeInteger(value.config_generation) || value.config_generation < 1 || !Number.isSafeInteger(value.installation_generation) || value.installation_generation < 1 || typeof value.activation_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.activation_id) || monitoringSha256(wrapperBody(value)) !== value.integrity_sha256) reject("MONITOR_HOST_STATE_BINDING_INVALID");
  validateMonitoringState(value.monitoring_state, config.monitoring, policy);
  if (value.components_watermark !== null) {
    exactKeys(value.components_watermark, ["generation", "projection_sha256", "published_at"], "MONITOR_HOST_STATE_COMPONENTS_WATERMARK_INVALID");
    integer(value.components_watermark.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_STATE_COMPONENTS_WATERMARK_INVALID");
    digest(value.components_watermark.projection_sha256, "MONITOR_HOST_STATE_COMPONENTS_WATERMARK_INVALID");
    iso(value.components_watermark.published_at, "MONITOR_HOST_STATE_COMPONENTS_WATERMARK_INVALID");
  }
  if (value.backup_watermark !== null) {
    exactKeys(value.backup_watermark, ["generation", "projection_sha256", "published_at", "verified_at", "recovery_point_at"], "MONITOR_HOST_STATE_BACKUP_WATERMARK_INVALID");
    integer(value.backup_watermark.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_STATE_BACKUP_WATERMARK_INVALID");
    digest(value.backup_watermark.projection_sha256, "MONITOR_HOST_STATE_BACKUP_WATERMARK_INVALID");
    iso(value.backup_watermark.published_at, "MONITOR_HOST_STATE_BACKUP_WATERMARK_INVALID");
    iso(value.backup_watermark.verified_at, "MONITOR_HOST_STATE_BACKUP_WATERMARK_INVALID");
    iso(value.backup_watermark.recovery_point_at, "MONITOR_HOST_STATE_BACKUP_WATERMARK_INVALID");
  }
  integer(value.acknowledged_event_count, 0, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_STATE_ACK_INVALID");
  iso(value.updated_at, "MONITOR_HOST_STATE_TIME_INVALID");
  return value;
}

export function assertMonitoringHostStateCurrent(value, evaluatorConfig, policy) {
  const state = validateMonitoringHostState(value, evaluatorConfig, policy);
  const config = validateMonitoringEvaluatorConfig(evaluatorConfig);
  if (state.config_id !== config.config_id || state.config_generation !== config.config_generation || state.host_config_sha256 !== config.host_config_sha256 || state.installation_generation !== config.installation.installation_generation || state.monitoring_bundle_sha256 !== config.installation.monitoring_bundle_sha256 || state.activation_id !== config.installation.activation_id) reject("MONITOR_HOST_STATE_NOT_CURRENT");
  return state;
}

export function createMonitoringHostState({ previous = null, evaluatorConfig, policy, monitoringState, componentsWatermark = undefined, backupWatermark = undefined, acknowledgedEventIds = [], updatedAt }) {
  const config = validateMonitoringEvaluatorConfig(evaluatorConfig);
  if (previous !== null) validateMonitoringHostState(previous, config, policy);
  if (previous !== null) {
    const sameConfiguration = previous.host_config_sha256 === config.host_config_sha256;
    if (sameConfiguration && (previous.config_id !== config.config_id || previous.config_generation !== config.config_generation) || !sameConfiguration && (config.config_id !== previous.config_id || config.config_generation !== previous.config_generation + 1 || config.previous_config_sha256 !== previous.host_config_sha256)) reject("MONITOR_HOST_CONFIG_TRANSITION_INVALID");
    if (config.installation.installation_generation < previous.installation_generation) reject("MONITOR_HOST_INSTALLATION_ROLLBACK_INVALID");
  }
  validateMonitoringState(monitoringState, config.monitoring, policy);
  if (!Array.isArray(acknowledgedEventIds) || new Set(acknowledgedEventIds).size !== acknowledgedEventIds.length || acknowledgedEventIds.some((eventId) => !SHA256.test(eventId || ""))) reject("MONITOR_HOST_STATE_ACK_INVALID");
  iso(updatedAt, "MONITOR_HOST_STATE_TIME_INVALID");
  const priorWatermark = previous?.delivery_ack_watermark || ZERO_SHA256;
  const ackWatermark = acknowledgedEventIds.length ? monitoringSha256({ previous: priorWatermark, event_ids: [...acknowledgedEventIds].sort() }) : priorWatermark;
  const resolvedComponentsWatermark = componentsWatermark === undefined ? previous?.components_watermark || null : componentsWatermark;
  const resolvedBackupWatermark = backupWatermark === undefined ? previous?.backup_watermark || null : backupWatermark;
  const value = {
    schema_version: 1,
    contract: MONITORING_HOST_STATE_CONTRACT,
    wrapper_sequence: (previous?.wrapper_sequence || 0) + 1,
    previous_wrapper_sha256: previous?.integrity_sha256 || ZERO_SHA256,
    config_id: config.config_id,
    config_generation: config.config_generation,
    host_config_sha256: config.host_config_sha256,
    installation_generation: config.installation.installation_generation,
    monitoring_bundle_sha256: config.installation.monitoring_bundle_sha256,
    activation_id: config.installation.activation_id,
    monitoring_state: monitoringState,
    components_watermark: resolvedComponentsWatermark,
    backup_watermark: resolvedBackupWatermark,
    delivery_ack_watermark: ackWatermark,
    acknowledged_event_count: (previous?.acknowledged_event_count || 0) + acknowledgedEventIds.length,
    updated_at: updatedAt,
    integrity_sha256: "",
  };
  value.integrity_sha256 = monitoringSha256(wrapperBody(value));
  return Object.freeze(validateMonitoringHostState(value, config, policy));
}

async function validateStateRoot(root, expectedOwner = owner(), allowTransaction = false) {
  const resolved = await safeRoot(root, 0o700, expectedOwner, "MONITOR_HOST_STATE_ROOT_UNSAFE");
  const marker = await safeText(path.join(resolved, MONITORING_HOST_STATE_MARKER), { mode: 0o400, expectedOwner, maximumBytes: 256, code: "MONITOR_HOST_STATE_MARKER_UNSAFE" });
  if (marker !== MONITORING_HOST_STATE_MARKER_VALUE) reject("MONITOR_HOST_STATE_MARKER_INVALID");
  await safeText(path.join(resolved, MONITORING_HOST_STATE_LOCK), { mode: 0o600, expectedOwner, maximumBytes: 256, code: "MONITOR_HOST_STATE_LOCK_UNSAFE" });
  const entries = await readdir(resolved);
  const allowed = new Set([MONITORING_HOST_STATE_MARKER, MONITORING_HOST_STATE_LOCK, MONITORING_HOST_STATE_FILE]);
  if (allowTransaction) {
    allowed.add(MONITORING_HOST_STATE_TRANSACTION);
    for (const entry of entries) if (/^\.current\.[1-9][0-9]*\.[0-9a-f]{64}\.tmp$/.test(entry)) allowed.add(entry);
    for (const entry of entries) if (MONITORING_HOST_STATE_TRANSACTION_TEMPORARY.test(entry)) allowed.add(entry);
  }
  if (entries.some((entry) => !allowed.has(entry))) reject("MONITOR_HOST_STATE_ROOT_ENTRY_INVALID");
  return resolved;
}

export function assertInheritedMonitoringLock(root, descriptor) {
  if (!Number.isSafeInteger(descriptor) || descriptor < 3 || process.env.ERP_MONITORING_HOST_LAUNCHED !== "YES" || process.env.ERP_MONITORING_LOCK_FD !== String(descriptor)) reject("MONITOR_HOST_LOCK_CONTEXT_INVALID");
  let opened;
  let named;
  try { opened = fstatSync(descriptor); named = lstatSync(path.join(root, MONITORING_HOST_STATE_LOCK)); } catch { reject("MONITOR_HOST_LOCK_INVALID"); }
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.dev !== named.dev || opened.ino !== named.ino || named.nlink !== 1 || (named.mode & 0o7777) !== 0o600) reject("MONITOR_HOST_LOCK_INVALID");
  let lockLines;
  try { lockLines = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:")); }
  catch { reject("MONITOR_HOST_LOCK_PROOF_UNAVAILABLE"); }
  if (lockLines.length !== 1 || !/^lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ /.test(lockLines[0])) reject("MONITOR_HOST_LOCK_NOT_HELD");
}

export async function readMonitoringHostState(root, evaluatorConfig, policy, options = {}) {
  const resolved = await validateStateRoot(root, options.expectedOwner ?? owner(), options.allowTransaction ?? false);
  const file = path.join(resolved, MONITORING_HOST_STATE_FILE);
  const exists = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject("MONITOR_HOST_STATE_FILE_UNSAFE"));
  if (exists === null) return null;
  const raw = await safeText(file, { mode: 0o600, expectedOwner: options.expectedOwner ?? owner(), maximumBytes: STATE_BYTES, code: "MONITOR_HOST_STATE_FILE_UNSAFE" });
  const value = validateMonitoringHostState(parseMonitoringJson(raw, STATE_BYTES), evaluatorConfig, policy);
  if (raw !== canonicalMonitoringJson(value)) reject("MONITOR_HOST_STATE_NOT_CANONICAL");
  return value;
}

async function transactionValue(root, expectedOwner) {
  const file = path.join(root, MONITORING_HOST_STATE_TRANSACTION);
  const exists = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject("MONITOR_HOST_STATE_TRANSACTION_UNSAFE"));
  if (exists === null) return null;
  const raw = await safeText(file, { mode: 0o600, expectedOwner, maximumBytes: 4096, code: "MONITOR_HOST_STATE_TRANSACTION_UNSAFE" });
  const value = parseMonitoringJson(raw, 4096);
  exactKeys(value, ["schema_version", "contract", "transaction_id", "temporary", "temporary_dev", "temporary_ino", "temporary_bytes", "previous_wrapper_sha256", "new_wrapper_sha256"], "MONITOR_HOST_STATE_TRANSACTION_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== "chenyida-erp-monitoring-state-write/v1") reject("MONITOR_HOST_STATE_TRANSACTION_INVALID");
  for (const field of ["transaction_id", "previous_wrapper_sha256", "new_wrapper_sha256"]) digest(value[field], "MONITOR_HOST_STATE_TRANSACTION_INVALID");
  if (!/^\.current\.[1-9][0-9]*\.[0-9a-f]{64}\.tmp$/.test(value.temporary)) reject("MONITOR_HOST_STATE_TRANSACTION_INVALID");
  for (const field of ["temporary_dev", "temporary_ino", "temporary_bytes"]) integer(value[field], 0, Number.MAX_SAFE_INTEGER, "MONITOR_HOST_STATE_TRANSACTION_INVALID");
  if (value.transaction_id !== monitoringSha256({ ...value, transaction_id: undefined }) || raw !== canonicalMonitoringJson(value)) reject("MONITOR_HOST_STATE_TRANSACTION_INTEGRITY_INVALID");
  return value;
}

export async function recoverMonitoringHostStateWrite(root, evaluatorConfig, policy, descriptor, options = {}) {
  const expectedOwner = options.expectedOwner ?? owner();
  const resolved = await validateStateRoot(root, expectedOwner, true);
  assertInheritedMonitoringLock(resolved, descriptor);
  const entries = await readdir(resolved);
  const temporaryFiles = entries.filter((entry) => /^\.current\.[1-9][0-9]*\.[0-9a-f]{64}\.tmp$/.test(entry));
  if (temporaryFiles.length > 1) reject("MONITOR_HOST_STATE_RECOVERY_AMBIGUOUS");
  const transactionTemporaries = entries.filter((entry) => MONITORING_HOST_STATE_TRANSACTION_TEMPORARY.test(entry));
  if (transactionTemporaries.length > 1 || transactionTemporaries.length === 1 && entries.includes(MONITORING_HOST_STATE_TRANSACTION)) reject("MONITOR_HOST_STATE_RECOVERY_AMBIGUOUS");
  if (transactionTemporaries.length === 1) {
    const transactionTemporaryPath = path.join(resolved, transactionTemporaries[0]);
    const metadata = await lstat(transactionTemporaryPath).catch(() => reject("MONITOR_HOST_STATE_TRANSACTION_TEMPORARY_UNSAFE"));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o7777) !== 0o600 || !ownership(metadata, expectedOwner) || metadata.size > 4096) reject("MONITOR_HOST_STATE_TRANSACTION_TEMPORARY_UNSAFE");
    await unlink(transactionTemporaryPath);
    if (temporaryFiles.length === 1) await unlink(path.join(resolved, temporaryFiles[0]));
    await syncDirectory(resolved);
    return readMonitoringHostState(resolved, evaluatorConfig, policy, { expectedOwner, allowTransaction: true });
  }
  const transaction = await transactionValue(resolved, expectedOwner);
  const current = await readMonitoringHostState(resolved, evaluatorConfig, policy, { expectedOwner, allowTransaction: true });
  if (transaction === null) {
    if (temporaryFiles.length === 0) return current;
    const temporary = temporaryFiles[0];
    const raw = await safeText(path.join(resolved, temporary), { mode: 0o600, expectedOwner, maximumBytes: STATE_BYTES, code: "MONITOR_HOST_STATE_TEMPORARY_UNSAFE" });
    const candidate = validateMonitoringHostState(parseMonitoringJson(raw, STATE_BYTES), evaluatorConfig, policy);
    if (raw !== canonicalMonitoringJson(candidate) || temporary !== `.current.${candidate.wrapper_sequence}.${candidate.integrity_sha256}.tmp` || candidate.previous_wrapper_sha256 !== (current?.integrity_sha256 || ZERO_SHA256)) reject("MONITOR_HOST_STATE_RECOVERY_AMBIGUOUS");
    await unlink(path.join(resolved, temporary));
    await syncDirectory(resolved);
    return current;
  }
  if (temporaryFiles.length === 1 && temporaryFiles[0] === transaction.temporary) {
    const temporaryPath = path.join(resolved, transaction.temporary);
    const metadata = await lstat(temporaryPath);
    const raw = await safeText(temporaryPath, { mode: 0o600, expectedOwner, maximumBytes: STATE_BYTES, code: "MONITOR_HOST_STATE_TEMPORARY_UNSAFE" });
    const candidate = validateMonitoringHostState(parseMonitoringJson(raw, STATE_BYTES), evaluatorConfig, policy);
    if (metadata.dev !== transaction.temporary_dev || metadata.ino !== transaction.temporary_ino || metadata.size !== transaction.temporary_bytes || candidate.integrity_sha256 !== transaction.new_wrapper_sha256 || candidate.previous_wrapper_sha256 !== transaction.previous_wrapper_sha256 || current?.integrity_sha256 !== transaction.previous_wrapper_sha256) reject("MONITOR_HOST_STATE_RECOVERY_AMBIGUOUS");
    await rename(temporaryPath, path.join(resolved, MONITORING_HOST_STATE_FILE));
    await syncDirectory(resolved);
  } else if (temporaryFiles.length !== 0 || current?.integrity_sha256 !== transaction.new_wrapper_sha256) reject("MONITOR_HOST_STATE_RECOVERY_AMBIGUOUS");
  await unlink(path.join(resolved, MONITORING_HOST_STATE_TRANSACTION));
  await syncDirectory(resolved);
  return readMonitoringHostState(resolved, evaluatorConfig, policy, { expectedOwner });
}

export async function writeMonitoringHostState(root, state, evaluatorConfig, policy, descriptor, options = {}) {
  const expectedOwner = options.expectedOwner ?? owner();
  const resolved = await validateStateRoot(root, expectedOwner, true);
  assertInheritedMonitoringLock(resolved, descriptor);
  await recoverMonitoringHostStateWrite(resolved, evaluatorConfig, policy, descriptor, { expectedOwner });
  validateMonitoringHostState(state, evaluatorConfig, policy);
  const current = await readMonitoringHostState(resolved, evaluatorConfig, policy, { expectedOwner });
  if (state.wrapper_sequence !== (current?.wrapper_sequence || 0) + 1 || state.previous_wrapper_sha256 !== (current?.integrity_sha256 || ZERO_SHA256)) reject("MONITOR_HOST_STATE_CHAIN_INVALID");
  const temporary = `.current.${state.wrapper_sequence}.${state.integrity_sha256}.tmp`;
  const temporaryPath = path.join(resolved, temporary);
  let handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(canonicalMonitoringJson(state), "utf8"); await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(resolved);
  const metadata = await lstat(temporaryPath);
  const transaction = {
    schema_version: 1,
    contract: "chenyida-erp-monitoring-state-write/v1",
    transaction_id: "",
    temporary,
    temporary_dev: metadata.dev,
    temporary_ino: metadata.ino,
    temporary_bytes: metadata.size,
    previous_wrapper_sha256: current?.integrity_sha256 || ZERO_SHA256,
    new_wrapper_sha256: state.integrity_sha256,
  };
  transaction.transaction_id = monitoringSha256({ ...transaction, transaction_id: undefined });
  const transactionTemporaryPath = path.join(resolved, `.state-write-prepared.${transaction.transaction_id}.tmp`);
  handle = await open(transactionTemporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(canonicalMonitoringJson(transaction), "utf8"); await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(resolved);
  await rename(transactionTemporaryPath, path.join(resolved, MONITORING_HOST_STATE_TRANSACTION));
  await syncDirectory(resolved);
  await rename(temporaryPath, path.join(resolved, MONITORING_HOST_STATE_FILE));
  await syncDirectory(resolved);
  await unlink(path.join(resolved, MONITORING_HOST_STATE_TRANSACTION));
  await syncDirectory(resolved);
  return readMonitoringHostState(resolved, evaluatorConfig, policy, { expectedOwner });
}

export async function publishMonitoringObservation(root, observation, options = {}) {
  const value = validateMonitoringObservation(observation);
  const expectedOwner = options.rootOwner ?? owner();
  const resolved = await safeRoot(root, options.rootMode ?? 0o700, expectedOwner, "MONITOR_OBSERVATION_ROOT_UNSAFE");
  const marker = await safeText(path.join(resolved, MONITORING_OBSERVATION_MARKER), { mode: 0o400, expectedOwner, maximumBytes: 256, code: "MONITOR_OBSERVATION_MARKER_UNSAFE" });
  if (marker !== MONITORING_OBSERVATION_MARKER_VALUE) reject("MONITOR_OBSERVATION_MARKER_INVALID");
  const entries = await readdir(resolved);
  for (const entry of entries) if (![MONITORING_OBSERVATION_MARKER, MONITORING_OBSERVATION_FILE].includes(entry) && !/^\.observation\.[0-9a-f]{32}\.tmp$/.test(entry)) reject("MONITOR_OBSERVATION_ROOT_ENTRY_INVALID");
  for (const entry of entries.filter((name) => /^\.observation\.[0-9a-f]{32}\.tmp$/.test(name))) {
    const raw = await safeText(path.join(resolved, entry), { mode: options.fileMode ?? 0o440, expectedOwner: options.fileOwner ?? expectedOwner, maximumBytes: STATE_BYTES, code: "MONITOR_OBSERVATION_TEMPORARY_UNSAFE" });
    validateMonitoringObservation(parseMonitoringJson(raw, STATE_BYTES));
    await unlink(path.join(resolved, entry));
  }
  const temporary = path.join(resolved, `.observation.${value.observation_id.slice(4)}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, options.fileMode ?? 0o440);
  try { await handle.writeFile(canonicalMonitoringJson(value), "utf8"); await handle.chmod(options.fileMode ?? 0o440); if (options.fileOwner) await handle.chown(options.fileOwner.uid, options.fileOwner.gid); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path.join(resolved, MONITORING_OBSERVATION_FILE));
  await syncDirectory(resolved);
  return value;
}

export async function readMonitoringObservation(root, options = {}) {
  const resolved = await safeRoot(root, options.rootMode ?? 0o700, options.rootOwner ?? owner(), "MONITOR_OBSERVATION_ROOT_UNSAFE");
  const marker = await safeText(path.join(resolved, MONITORING_OBSERVATION_MARKER), { mode: 0o400, expectedOwner: options.rootOwner ?? owner(), maximumBytes: 256, code: "MONITOR_OBSERVATION_MARKER_UNSAFE" });
  if (marker !== MONITORING_OBSERVATION_MARKER_VALUE) reject("MONITOR_OBSERVATION_MARKER_INVALID");
  const raw = await safeText(path.join(resolved, MONITORING_OBSERVATION_FILE), { mode: options.fileMode ?? 0o440, expectedOwner: options.fileOwner ?? options.rootOwner ?? owner(), maximumBytes: STATE_BYTES, code: "MONITOR_OBSERVATION_FILE_UNSAFE" });
  const value = validateMonitoringObservation(parseMonitoringJson(raw, STATE_BYTES));
  if (raw !== canonicalMonitoringJson(value)) reject("MONITOR_OBSERVATION_NOT_CANONICAL");
  return value;
}
