import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod, chown, lstat, mkdir, open, readFile, realpath, rename,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalClusterJson } from "./postgresql-cluster-recovery-contract.mjs";
import {
  UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG,
  UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256,
  UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE,
  UAT_ROLLBACK_RUNTIME_CURRENT_FILE,
  UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE,
  UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE,
  UAT_ROLLBACK_RUNTIME_STATE_ROOT,
  UAT_ROLLBACK_ZERO_SHA256,
  createUatRollbackRuntimeActivationIntent,
  createUatRollbackRuntimeActivationObjects,
  uatRollbackActivationPaths,
  validateUatRollbackRuntimeActivationAlias,
  validateUatRollbackRuntimeActivationIntent,
} from "./uat-promotion-rollback-fixed-executor-contract.mjs";

export const UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-activation-context/v2";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_STATE_MARKER =
  ".chenyida-erp-uat-rollback-runtime-activation-v2";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_STATE_MARKER_VALUE =
  "chenyida-erp-uat-promotion-rollback-runtime-activation-state/v2\n";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const BUNDLE_ROOT = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
const GLOBAL_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_EXECUTOR_BYTES = 2 * 1024 * 1024;
const SUBDIRECTORIES = Object.freeze([
  "intents", "executors", "plans", "history", "receipts", "recoveries", "quarantine",
]);

export class UatRollbackRuntimeActivationPublisherError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatRollbackRuntimeActivationPublisherError";
    this.code = code;
  }
}

function reject(code) { throw new UatRollbackRuntimeActivationPublisherError(code); }
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }
function sha256(raw) { return createHash("sha256").update(raw).digest("hex"); }
function exactKeys(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [...fields].sort())) reject(code);
}
function digest(value, code, allowZero = false) {
  if (typeof value !== "string" || !SHA256.test(value)
    || !allowZero && value === UAT_ROLLBACK_ZERO_SHA256) reject(code);
  return value;
}
function identifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code);
  return value;
}
function instant(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}
function physical(logical, filesystemRoot) {
  if (filesystemRoot === "/") return logical;
  if (!path.isAbsolute(filesystemRoot) || !path.isAbsolute(logical) || logical === "/") {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_FILESYSTEM_ROOT_INVALID");
  }
  return path.join(filesystemRoot, logical.slice(1));
}
function modeOf(metadata) { return metadata.mode & 0o7777; }

export function validateUatRollbackRuntimeActivationContext(value) {
  const code = "UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "operation_id", "execution_mode",
    "execution_authorization_id", "execution_created_at",
    "execution_authorization_sha256", "original_authorization_sha256",
    "supervisor_bundle_sha256", "expected_intent_sha256", "parameters",
  ], code);
  if (value.schema_version !== 2 || value.contract !== UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_CONTRACT
    || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject(code);
  identifier(value.operation_id, code);
  identifier(value.execution_authorization_id, code);
  instant(value.execution_created_at, code);
  for (const field of [
    "execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256",
  ]) digest(value[field], code);
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_sha256 !== value.original_authorization_sha256
      || value.execution_authorization_id !== value.operation_id
      || value.expected_intent_sha256 !== null) reject(code);
  } else {
    digest(value.expected_intent_sha256, code);
    if (value.execution_authorization_sha256 === value.original_authorization_sha256
      || value.execution_authorization_id === value.operation_id) reject(code);
  }
  const parameters = value.parameters;
  exactKeys(parameters, [
    "state_root", "activation_file", "current_file", "executor_file", "activation_id",
    "generation", "operation", "approved_at", "expires_at", "requester_identity_sha256",
    "approver_identity_sha256", "previous_activation_receipt_sha256",
    "rollback_target_activation_receipt_sha256", "executor_source", "plan",
  ], code);
  if (parameters.state_root !== UAT_ROLLBACK_RUNTIME_STATE_ROOT
    || parameters.activation_file !== UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE
    || parameters.current_file !== UAT_ROLLBACK_RUNTIME_CURRENT_FILE
    || parameters.executor_file !== UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE
    || parameters.activation_id !== value.operation_id
    || !Number.isSafeInteger(parameters.generation) || parameters.generation < 1
    || parameters.generation > 1_000_000
    || !new Set(["INSTALL", "UPGRADE", "ROLLBACK"]).has(parameters.operation)) reject(code);
  identifier(parameters.activation_id, code);
  for (const field of ["requester_identity_sha256", "approver_identity_sha256"]) {
    digest(parameters[field], code);
  }
  digest(parameters.previous_activation_receipt_sha256, code, true);
  digest(parameters.rollback_target_activation_receipt_sha256, code, true);
  instant(parameters.approved_at, code);
  instant(parameters.expires_at, code);
  const source = parameters.executor_source;
  exactKeys(source, ["path", "sha256", "bytes", "uid", "gid", "mode", "nlink"], code);
  const expectedSource = `${BUNDLE_ROOT}/${value.supervisor_bundle_sha256}/${UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE}`;
  if (source.path !== expectedSource || !SHA256.test(source.sha256 ?? "")
    || !Number.isSafeInteger(source.bytes) || source.bytes < 2 || source.bytes > MAX_EXECUTOR_BYTES
    || source.uid !== 0 || source.gid !== 0 || source.mode !== "0555" || source.nlink !== 1
    || parameters.plan?.toolchain?.executor?.sha256 !== source.sha256) reject(code);
  if (value.execution_mode === "RECOVERY" && value.expected_intent_sha256 === null) reject(code);
  return value;
}

async function syncDirectory(directory, code) {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
}

async function trustedDirectory(directory, modes, code) {
  const metadata = await lstat(directory).catch(() => reject(code));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || !modes.has(modeOf(metadata)) || await realpath(directory) !== directory) reject(code);
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
}

async function trustedRaw(file, mode, maximum, code) {
  const metadata = await lstat(file, { bigint: true }).catch((error) => (
    error?.code === "ENOENT" ? null : reject(code)
  ));
  if (metadata === null) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0n || metadata.gid !== 0n
    || metadata.nlink !== 1n || Number(metadata.mode & 0o7777n) !== mode
    || metadata.size < 2n || metadata.size > BigInt(maximum)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = (item) => [item.dev, item.ino, item.size, item.mtimeNs, item.ctimeNs];
    if (identity(opened).some((item, index) => item !== identity(metadata)[index])) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true }).catch(() => reject(`${code}_CHANGED`));
    if (identity(after).some((item, index) => item !== identity(opened)[index])
      || identity(named).some((item, index) => item !== identity(opened)[index])) reject(`${code}_CHANGED`);
    return Object.freeze({ raw, metadata: opened });
  } finally { await handle.close(); }
}

async function trustedJson(file, mode, validator, code) {
  const stored = await trustedRaw(file, mode, 4 * 1024 * 1024, code);
  if (stored === null) return null;
  let value;
  try { value = JSON.parse(stored.raw.toString("utf8")); value = validator(value); }
  catch { reject(code); }
  if (stored.raw.toString("utf8") !== canonicalClusterJson(value)) reject(code);
  return Object.freeze({ ...stored, value });
}

async function ensureRaw(file, raw, mode, validator, code) {
  const existing = await trustedRaw(file, mode, Math.max(raw.length, 2), code);
  if (existing !== null) {
    if (!existing.raw.equals(raw)) reject(code);
    if (validator !== null) {
      let value;
      try { value = validator(JSON.parse(raw.toString("utf8"))); }
      catch { reject(code); }
      if (canonicalClusterJson(value) !== raw.toString("utf8")) reject(code);
    }
    return;
  }
  let handle;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(raw); await handle.chown(0, 0); await handle.chmod(mode); await handle.sync();
  } catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
  await syncDirectory(path.dirname(file), code);
  const stored = await trustedRaw(file, mode, Math.max(raw.length, 2), code);
  if (!stored?.raw.equals(raw)) reject(code);
}

async function atomicAlias(file, temporary, raw, mode, expectedPrevious, validator, code) {
  await ensureRaw(temporary, raw, mode, validator, `${code}_TEMP_INVALID`);
  const before = await trustedRaw(file, mode, Math.max(raw.length, expectedPrevious?.length ?? 2), `${code}_CURRENT_INVALID`);
  if (expectedPrevious === null ? before !== null : before === null || !before.raw.equals(expectedPrevious)) {
    reject(`${code}_CURRENT_CHANGED`);
  }
  await rename(temporary, file).catch(() => reject(`${code}_RENAME_FAILED`));
  await syncDirectory(path.dirname(file), `${code}_SYNC_FAILED`);
  const stored = await trustedRaw(file, mode, Math.max(raw.length, 2), `${code}_CURRENT_INVALID`);
  if (!stored?.raw.equals(raw)) reject(`${code}_CURRENT_INVALID`);
}

async function ensureLayout(filesystemRoot) {
  const stateRoot = physical(UAT_ROLLBACK_RUNTIME_STATE_ROOT, filesystemRoot);
  await ensureDirectory(stateRoot, path.dirname(stateRoot), 0o700, "UAT_ROLLBACK_RUNTIME_ACTIVATION_STATE_INVALID");
  const marker = path.join(stateRoot, UAT_ROLLBACK_RUNTIME_ACTIVATION_STATE_MARKER);
  const markerRaw = Buffer.from(UAT_ROLLBACK_RUNTIME_ACTIVATION_STATE_MARKER_VALUE);
  await ensureRaw(marker, markerRaw, 0o400, null, "UAT_ROLLBACK_RUNTIME_ACTIVATION_MARKER_INVALID");
  for (const name of SUBDIRECTORIES) {
    await ensureDirectory(path.join(stateRoot, name), stateRoot, 0o700,
      "UAT_ROLLBACK_RUNTIME_ACTIVATION_STATE_INVALID");
  }
  const executorParent = path.dirname(physical(UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE, filesystemRoot));
  await ensureDirectory(executorParent, path.dirname(executorParent), 0o755,
    "UAT_ROLLBACK_RUNTIME_EXECUTOR_PARENT_INVALID");
  return stateRoot;
}

async function loadExecutor(context, filesystemRoot) {
  const source = context.parameters.executor_source;
  const file = physical(source.path, filesystemRoot);
  const stored = await trustedRaw(file, 0o555, MAX_EXECUTOR_BYTES,
    "UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE_INVALID");
  if (!stored || stored.raw.length !== source.bytes || sha256(stored.raw) !== source.sha256) {
    reject("UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE_INVALID");
  }
  return stored.raw;
}

async function existingAliases(filesystemRoot) {
  const activation = await trustedJson(
    physical(UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE, filesystemRoot), 0o400,
    (value) => validateUatRollbackRuntimeActivationAlias(value),
    "UAT_ROLLBACK_RUNTIME_ACTIVATION_CURRENT_INVALID",
  );
  const current = await trustedRaw(
    physical(UAT_ROLLBACK_RUNTIME_CURRENT_FILE, filesystemRoot), 0o400, 4 * 1024 * 1024,
    "UAT_ROLLBACK_RUNTIME_ACTIVATION_CURRENT_INVALID",
  );
  const executor = await trustedRaw(
    physical(UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE, filesystemRoot), 0o555, MAX_EXECUTOR_BYTES,
    "UAT_ROLLBACK_RUNTIME_EXECUTOR_CURRENT_INVALID",
  );
  return { activation, current, executor };
}

function buildIntent(context, executorRaw) {
  const parameters = context.parameters;
  return createUatRollbackRuntimeActivationIntent({
    activation_id: parameters.activation_id,
    generation: parameters.generation,
    operation: parameters.operation,
    approved_at: parameters.approved_at,
    expires_at: parameters.expires_at,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    authorization_sha256: context.original_authorization_sha256,
    requester_identity_sha256: parameters.requester_identity_sha256,
    approver_identity_sha256: parameters.approver_identity_sha256,
    previous_activation_receipt_sha256: parameters.previous_activation_receipt_sha256,
    rollback_target_activation_receipt_sha256: parameters.rollback_target_activation_receipt_sha256,
    executor_source_sha256: sha256(executorRaw),
    plan: parameters.plan,
  });
}

function buildRecovery(context, intent) {
  if (context.execution_mode !== "RECOVERY") return null;
  const body = {
    schema_version: 2,
    contract: "chenyida-erp-uat-promotion-rollback-runtime-activation-recovery/v2",
    status: "AUTHORIZED_RESUME",
    activation_id: intent.activation_id,
    generation: intent.generation,
    recovery_authorization_id: context.execution_authorization_id,
    recovery_authorization_sha256: context.execution_authorization_sha256,
    original_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.intent_sha256,
    prepared_at: context.execution_created_at,
    decision: "RESUME_EXACT_KNOWN_PUBLICATION_ONLY",
  };
  return Object.freeze({
    ...body, recovery_sha256: sha256(Buffer.from(canonicalClusterJson(body))),
  });
}

function validateRecovery(value) {
  const code = "UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "activation_id", "generation",
    "recovery_authorization_id", "recovery_authorization_sha256",
    "original_authorization_sha256", "intent_sha256", "prepared_at", "decision",
    "recovery_sha256",
  ], code);
  if (value.schema_version !== 2
    || value.contract !== "chenyida-erp-uat-promotion-rollback-runtime-activation-recovery/v2"
    || value.status !== "AUTHORIZED_RESUME"
    || value.decision !== "RESUME_EXACT_KNOWN_PUBLICATION_ONLY"
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || value.generation > 1_000_000) reject(code);
  identifier(value.activation_id, code);
  identifier(value.recovery_authorization_id, code);
  instant(value.prepared_at, code);
  for (const field of [
    "recovery_authorization_sha256", "original_authorization_sha256", "intent_sha256",
  ]) digest(value[field], code);
  if (sha256(Buffer.from(canonicalClusterJson(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "recovery_sha256")),
  ))) !== value.recovery_sha256) reject(code);
  return value;
}

function recoveryFile(stateRoot, recovery) {
  return recovery === null ? null : path.join(
    stateRoot, "recoveries", `${recovery.recovery_authorization_id}.${recovery.recovery_sha256}.json`,
  );
}

async function verifyRollbackTarget(context, filesystemRoot) {
  const parameters = context.parameters;
  if (parameters.operation === "ROLLBACK") {
    const rollbackPath = uatRollbackActivationPaths(
      parameters.generation - 2, parameters.rollback_target_activation_receipt_sha256,
    ).receipt;
    const receipt = await trustedRaw(physical(rollbackPath, filesystemRoot), 0o400,
      4 * 1024 * 1024, "UAT_ROLLBACK_RUNTIME_ACTIVATION_ROLLBACK_TARGET_INVALID");
    if (storedSelfHash(receipt, "receipt_sha256",
      "UAT_ROLLBACK_RUNTIME_ACTIVATION_ROLLBACK_TARGET_INVALID")
      !== parameters.rollback_target_activation_receipt_sha256) {
      reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_ROLLBACK_TARGET_INVALID");
    }
  }
}

function rawEquals(stored, raw) { return stored !== null && stored.raw.equals(raw); }

function storedSelfHash(stored, field, code) {
  if (stored === null) return null;
  let value;
  try { value = JSON.parse(stored.raw.toString("utf8")); }
  catch { reject(code); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || stored.raw.toString("utf8") !== canonicalClusterJson(value)) reject(code);
  digest(value[field], code);
  if (sha256(Buffer.from(canonicalClusterJson(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)),
  ))) !== value[field]) reject(code);
  return value[field];
}

function verifyPublicationState(context, aliases, objects, executorRaw) {
  const parameters = context.parameters;
  const desiredActivation = Buffer.from(canonicalClusterJson(objects.alias));
  const desiredCurrent = Buffer.from(canonicalClusterJson(objects.current));
  const desiredExecutor = executorRaw;
  let previousActivation = null;
  let previousCurrent = null;
  let previousExecutor = null;
  if (parameters.generation === 1) {
    if (parameters.previous_activation_receipt_sha256 !== UAT_ROLLBACK_ZERO_SHA256) {
      reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_GENERATION_INVALID");
    }
  } else if (!rawEquals(aliases.activation, desiredActivation)) {
    if (aliases.activation === null
      || aliases.activation.value.generation !== parameters.generation - 1
      || aliases.activation.value.receipt_sha256 !== parameters.previous_activation_receipt_sha256) {
      reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_GENERATION_INVALID");
    }
    previousActivation = aliases.activation.raw;
    if (storedSelfHash(aliases.current, "current_sha256",
      "UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN")
      === aliases.activation.value.current_sha256) {
      previousCurrent = aliases.current.raw;
    } else if (!rawEquals(aliases.current, desiredCurrent)) {
      reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN");
    }
    if (aliases.executor !== null
      && sha256(aliases.executor.raw) === aliases.activation.value.installed_executor_sha256) {
      previousExecutor = aliases.executor.raw;
    } else if (!rawEquals(aliases.executor, desiredExecutor)) {
      reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN");
    }
  }
  const activationKnown = aliases.activation === null && previousActivation === null
    || rawEquals(aliases.activation, desiredActivation)
    || previousActivation !== null && aliases.activation.raw.equals(previousActivation);
  const currentKnown = aliases.current === null && previousCurrent === null
    || rawEquals(aliases.current, desiredCurrent)
    || previousCurrent !== null && aliases.current.raw.equals(previousCurrent);
  const executorKnown = aliases.executor === null && previousExecutor === null
    || rawEquals(aliases.executor, desiredExecutor)
    || previousExecutor !== null && aliases.executor.raw.equals(previousExecutor);
  if (!activationKnown || !currentKnown || !executorKnown
    || rawEquals(aliases.activation, desiredActivation)
      && (!rawEquals(aliases.current, desiredCurrent) || !rawEquals(aliases.executor, desiredExecutor))
    || rawEquals(aliases.current, desiredCurrent) && !rawEquals(aliases.executor, desiredExecutor)) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN");
  }
}

export async function prepareUatRollbackRuntimeActivation(contextInput, options = {}) {
  const context = validateUatRollbackRuntimeActivationContext(contextInput);
  const filesystemRoot = options.filesystemRoot ?? "/";
  const executorRaw = await loadExecutor(context, filesystemRoot);
  const intent = buildIntent(context, executorRaw);
  const recovery = buildRecovery(context, intent);
  if (context.execution_mode === "RECOVERY" && context.expected_intent_sha256 !== intent.intent_sha256) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_INTENT_MISMATCH");
  }
  if (UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.capability_status !== "SUPPORTED"
    && options.allowBlockedFixture !== true) {
    return Object.freeze({
      result: "BLOCKED_CAPABILITY_UNAVAILABLE",
      operation_id: context.operation_id,
      catalog_sha256: UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256,
      unavailable_capabilities: UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.unavailable_capabilities,
    });
  }
  const stateRoot = await ensureLayout(filesystemRoot);
  const aliases = await existingAliases(filesystemRoot);
  const objects = createUatRollbackRuntimeActivationObjects(intent, intent.approved_at);
  verifyPublicationState(context, aliases, objects, executorRaw);
  await verifyRollbackTarget(context, filesystemRoot);
  const intentFile = path.join(stateRoot, "intents",
    `${String(intent.generation).padStart(16, "0")}.${intent.intent_sha256}.json`);
  await ensureRaw(intentFile, Buffer.from(canonicalClusterJson(intent)), 0o400,
    validateUatRollbackRuntimeActivationIntent, "UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_CONFLICT");
  if (recovery !== null) {
    await ensureRaw(recoveryFile(stateRoot, recovery), Buffer.from(canonicalClusterJson(recovery)),
      0o400, validateRecovery, "UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_CONFLICT");
  }
  return Object.freeze({ result: context.execution_mode === "RECOVERY" ? "RECOVERY_PREPARED" : "PREPARED",
    operation_id: context.operation_id, intent_sha256: intent.intent_sha256,
    ...(recovery === null ? {} : { recovery_sha256: recovery.recovery_sha256 }) });
}

export async function executeUatRollbackRuntimeActivation(contextInput, options = {}) {
  const context = validateUatRollbackRuntimeActivationContext(contextInput);
  const filesystemRoot = options.filesystemRoot ?? "/";
  if (UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.capability_status !== "SUPPORTED"
    && options.allowBlockedFixture !== true) reject("UAT_ROLLBACK_RUNTIME_CAPABILITY_UNAVAILABLE");
  const executorRaw = await loadExecutor(context, filesystemRoot);
  const intent = buildIntent(context, executorRaw);
  const recovery = buildRecovery(context, intent);
  if (context.execution_mode === "RECOVERY" && context.expected_intent_sha256 !== intent.intent_sha256) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_INTENT_MISMATCH");
  }
  const stateRoot = await ensureLayout(filesystemRoot);
  const aliases = await existingAliases(filesystemRoot);
  const objects = createUatRollbackRuntimeActivationObjects(intent, intent.approved_at);
  verifyPublicationState(context, aliases, objects, executorRaw);
  await verifyRollbackTarget(context, filesystemRoot);
  const intentFile = path.join(stateRoot, "intents",
    `${String(intent.generation).padStart(16, "0")}.${intent.intent_sha256}.json`);
  const storedIntent = await trustedJson(intentFile, 0o400,
    validateUatRollbackRuntimeActivationIntent, "UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_MISSING");
  if (!storedIntent || !storedIntent.raw.equals(Buffer.from(canonicalClusterJson(intent)))) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_MISSING");
  }
  if (recovery !== null) {
    const storedRecovery = await trustedJson(recoveryFile(stateRoot, recovery), 0o400,
      validateRecovery, "UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_MISSING");
    if (!storedRecovery
      || !storedRecovery.raw.equals(Buffer.from(canonicalClusterJson(recovery)))) {
      reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_MISSING");
    }
  }
  if (aliases.activation?.value.activation_id === intent.activation_id
    && aliases.activation.value.intent_sha256 === intent.intent_sha256) {
    return Object.freeze({ result: "ALREADY_COMMITTED", operation_id: context.operation_id,
      intent_sha256: intent.intent_sha256, activation_sha256: aliases.activation.value.activation_sha256,
      receipt_sha256: aliases.activation.value.receipt_sha256,
      ...(recovery === null ? {} : { recovery_sha256: recovery.recovery_sha256 }) });
  }
  const paths = uatRollbackActivationPaths(intent.generation, objects.receipt.receipt_sha256,
    objects.history.history_sha256);
  const executorContent = path.join(stateRoot, "executors", `${intent.installed_executor_sha256}.py`);
  const planContent = path.join(stateRoot, "plans", `${intent.runtime_plan_sha256}.json`);
  await ensureRaw(executorContent, executorRaw, 0o555, null,
    "UAT_ROLLBACK_RUNTIME_EXECUTOR_CONTENT_CONFLICT");
  await options.fault?.("AFTER_EXECUTOR_CONTENT");
  await ensureRaw(planContent, Buffer.from(canonicalClusterJson(intent.plan)), 0o400, null,
    "UAT_ROLLBACK_RUNTIME_PLAN_CONTENT_CONFLICT");
  await options.fault?.("AFTER_PLAN_CONTENT");
  await ensureRaw(physical(paths.history, filesystemRoot), Buffer.from(canonicalClusterJson(objects.history)),
    0o400, null, "UAT_ROLLBACK_RUNTIME_ACTIVATION_HISTORY_CONFLICT");
  await options.fault?.("AFTER_HISTORY");
  const executorTarget = physical(UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE, filesystemRoot);
  await atomicAlias(executorTarget, `${executorTarget}.${intent.intent_sha256}.tmp`, executorRaw, 0o555,
    aliases.executor?.raw ?? null, null, "UAT_ROLLBACK_RUNTIME_EXECUTOR_ALIAS");
  await options.fault?.("AFTER_EXECUTOR_ALIAS");
  await ensureRaw(physical(paths.receipt, filesystemRoot), Buffer.from(canonicalClusterJson(objects.receipt)),
    0o400, null, "UAT_ROLLBACK_RUNTIME_ACTIVATION_RECEIPT_CONFLICT");
  await options.fault?.("AFTER_RECEIPT");
  const currentRaw = Buffer.from(canonicalClusterJson(objects.current));
  const currentTarget = physical(UAT_ROLLBACK_RUNTIME_CURRENT_FILE, filesystemRoot);
  await atomicAlias(currentTarget, `${currentTarget}.${intent.intent_sha256}.tmp`, currentRaw, 0o400,
    aliases.current?.raw ?? null, null, "UAT_ROLLBACK_RUNTIME_CURRENT_ALIAS");
  await options.fault?.("AFTER_CURRENT");
  const activationRaw = Buffer.from(canonicalClusterJson(objects.alias));
  const activationTarget = physical(UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE, filesystemRoot);
  await atomicAlias(activationTarget, `${activationTarget}.${intent.intent_sha256}.tmp`, activationRaw, 0o400,
    aliases.activation?.raw ?? null, (value) => validateUatRollbackRuntimeActivationAlias(value),
    "UAT_ROLLBACK_RUNTIME_ACTIVATION_ALIAS");
  await options.fault?.("AFTER_ACTIVATION_ALIAS");
  return Object.freeze({ result: "COMMITTED", operation_id: context.operation_id,
    intent_sha256: intent.intent_sha256, activation_sha256: objects.alias.activation_sha256,
    receipt_sha256: objects.receipt.receipt_sha256,
    ...(recovery === null ? {} : { recovery_sha256: recovery.recovery_sha256 }) });
}

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_INVALID");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let value;
  try { value = JSON.parse(raw); }
  catch { reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_INVALID"); }
  if (raw !== canonicalClusterJson(value)) reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_INVALID");
  return value;
}

async function cli() {
  const [phase, confirmation] = process.argv.slice(2);
  const confirmations = {
    prepare: "PREPARE_UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT",
    execute: "COMMIT_UAT_ROLLBACK_RUNTIME_ACTIVATION_AFTER_AUTHORIZATION",
    "recover-prepare": "PREPARE_UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY",
    "recover-execute": "EXECUTE_UAT_ROLLBACK_RUNTIME_ACTIVATION_RECOVERY_AFTER_AUTHORIZATION",
  };
  if (confirmations[phase] !== confirmation || process.getuid?.() !== 0
    || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES"
    || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_GATE_LOCK_FD === undefined
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED
      !== (new Set(["execute", "recover-execute"]).has(phase) ? "YES" : "NO")) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_SUPERVISOR_INVALID");
  }
  const lockPath = `/proc/self/fd/${process.env.ERP_RELEASE_GATE_LOCK_FD}`;
  if (await realpath(lockPath).catch(() => null) !== GLOBAL_LOCK) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_SUPERVISOR_INVALID");
  }
  const context = await readStdin();
  if (process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256
      !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED
      !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || new Set(["recover-prepare", "recover-execute"]).has(phase)
      !== (context.execution_mode === "RECOVERY")) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_SUPERVISOR_INVALID");
  }
  const result = new Set(["prepare", "recover-prepare"]).has(phase)
    ? await prepareUatRollbackRuntimeActivation(context)
    : await executeUatRollbackRuntimeActivation(context);
  process.stdout.write(canonicalClusterJson(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    const code = error instanceof UatRollbackRuntimeActivationPublisherError
      ? error.code : "UAT_ROLLBACK_RUNTIME_ACTIVATION_PUBLISHER_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
