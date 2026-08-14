import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readFileSync } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalMonitoringJson,
  monitoringSha256,
} from "../tools/ops-monitoring/contract.mjs";
import { validateMonitoringNotifierConfig } from "../tools/ops-monitoring/delivery-contract.mjs";
import {
  NOTIFIER_EGRESS_ACTIVATION_VIEW,
  NOTIFIER_EGRESS_CURRENT_FILE,
  NOTIFIER_EGRESS_DROPIN_TARGET,
  NOTIFIER_EGRESS_POLICY_TARGET,
  NOTIFIER_EGRESS_STATE_ROOT,
  NOTIFIER_EGRESS_UNIT_FRAGMENT,
  ZERO_SHA256,
  createNotifierEgressActivationReceipt,
  createNotifierEgressDropIn,
  createNotifierEgressPolicy,
  notifierEgressTemplateLogicalSha256,
  validateNotifierEgressActivationReceipt,
  validateNotifierEgressPolicy,
  validateNotifierEgressTemplate,
} from "../tools/ops-monitoring/notifier-egress-contract.mjs";
import { parseStrictMonitoringJson } from "../tools/ops-monitoring/strict-json.mjs";

export const NOTIFIER_EGRESS_CONTEXT_CONTRACT = "chenyida-erp-monitoring-notifier-egress-activation-context/v1";
export const NOTIFIER_EGRESS_INTENT_CONTRACT = "chenyida-erp-monitoring-notifier-egress-activation-intent/v1";
export const NOTIFIER_EGRESS_RECOVERY_CONTRACT = "chenyida-erp-monitoring-notifier-egress-activation-recovery/v1";
export const NOTIFIER_EGRESS_QUARANTINE_CONTRACT = "chenyida-erp-monitoring-notifier-egress-activation-quarantine/v1";
export const NOTIFIER_EGRESS_STATE_MARKER = ".chenyida-erp-monitoring-notifier-egress-v1";
export const NOTIFIER_EGRESS_STATE_MARKER_VALUE = "chenyida-erp-monitoring-notifier-egress-activation/v1\n";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const TEMPLATE_RELATIVE = "operations/monitoring-notifier-egress-policy-v1.json";
const GLOBAL_RELEASE_LOCK = "/run/lock/chenyida-erp-release-gate-v1.lock";
const MAX_JSON_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SOURCE_FIELDS = Object.freeze(["path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink"]);
const PARAMETER_FIELDS = Object.freeze([
  "policy_state_root", "policy_target", "activation_view", "dropin_target", "activation_id", "environment",
  "egress_generation", "previous_policy_sha256", "previous_activation_receipt_sha256",
  "rollback_target_activation_receipt_sha256", "deployment_id", "target_id", "target_generation", "endpoint",
  "allowed_addresses", "monitoring_bundle_sha256", "adapter_id", "adapter_sha256", "credential_sha256",
  "credential_generation", "oncall_roster_generation", "escalation_table_sha256", "notifier_gid",
  "template_file_sha256", "template_policy_sha256", "approval_reference_sha256",
  "responsible_operator_identity_sha256", "approver_identity_sha256", "activated_at", "expires_at",
  "notifier_config_source", "base_unit_source", "current_policy_source", "current_activation_source",
  "rollback_policy_source", "rollback_activation_source",
]);
const CONTEXT_FIELDS = Object.freeze([
  "schema_version", "contract", "operation_id", "operation", "execution_mode", "execution_authorization_id",
  "execution_authorization_sha256", "execution_created_at", "original_authorization_sha256",
  "supervisor_bundle_sha256", "expected_intent_sha256", "parameters",
]);

export class NotifierEgressPublisherError extends Error {
  constructor(code) { super(code); this.name = "NotifierEgressPublisherError"; this.code = code; }
}

function reject(code) { throw new NotifierEgressPublisherError(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort(), wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function digest(value, code, allowZero = false) { if (typeof value !== "string" || !SHA256.test(value) || !allowZero && value === ZERO_SHA256) reject(code); return value; }
function identifier(value, code) { if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code); return value; }
function integer(value, minimum, maximum, code) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code); return value; }
function iso(value, code) { if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code); return value; }
function rawSha256(raw) { return createHash("sha256").update(raw).digest("hex"); }
function bodyWithout(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function modeOf(metadata) { return Number(metadata.mode & 0o7777n); }

function validateSource(value, { expectedPath = null, expectedMode, expectedGid = null, code }) {
  exactKeys(value, SOURCE_FIELDS, code);
  if (typeof value.path !== "string" || !path.isAbsolute(value.path) || value.path !== path.normalize(value.path)
    || expectedPath !== null && value.path !== expectedPath || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes)
    || value.bytes < 2 || value.bytes > MAX_JSON_BYTES || typeof value.device !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value.device)
    || typeof value.inode !== "string" || !/^[1-9][0-9]*$/u.test(value.inode) || value.uid !== 0
    || !Number.isSafeInteger(value.gid) || value.gid < 0 || value.gid > 2_147_483_647 || expectedGid !== null && value.gid !== expectedGid
    || value.mode !== expectedMode || value.nlink !== 1) reject(code);
  digest(value.sha256, code);
  return value;
}

export function validateNotifierEgressActivationParameters(operation, value) {
  exactKeys(value, PARAMETER_FIELDS, "MONITOR_EGRESS_ACTIVATION_PARAMETERS_INVALID");
  if (!new Set(["ACTIVATE", "ROLLBACK"]).has(operation)) reject("MONITOR_EGRESS_ACTIVATION_OPERATION_INVALID");
  if (value.policy_state_root !== NOTIFIER_EGRESS_STATE_ROOT || value.policy_target !== NOTIFIER_EGRESS_POLICY_TARGET
    || value.activation_view !== NOTIFIER_EGRESS_ACTIVATION_VIEW || value.dropin_target !== NOTIFIER_EGRESS_DROPIN_TARGET) reject("MONITOR_EGRESS_ACTIVATION_PATH_INVALID");
  identifier(value.activation_id, "MONITOR_EGRESS_ACTIVATION_ID_INVALID");
  if (!new Set(["UAT", "PRODUCTION"]).has(value.environment)) reject("MONITOR_EGRESS_ACTIVATION_ENVIRONMENT_INVALID");
  integer(value.egress_generation, 1, 1_000_000, "MONITOR_EGRESS_ACTIVATION_GENERATION_INVALID");
  integer(value.target_generation, 1, 1_000_000, "MONITOR_EGRESS_ACTIVATION_TARGET_INVALID");
  integer(value.credential_generation, 1, 1_000_000, "MONITOR_EGRESS_ACTIVATION_CREDENTIAL_INVALID");
  integer(value.oncall_roster_generation, 1, 1_000_000, "MONITOR_EGRESS_ACTIVATION_ONCALL_INVALID");
  integer(value.notifier_gid, 1, 2_147_483_647, "MONITOR_EGRESS_ACTIVATION_NOTIFIER_GID_INVALID");
  identifier(value.deployment_id, "MONITOR_EGRESS_ACTIVATION_DEPLOYMENT_INVALID");
  identifier(value.target_id, "MONITOR_EGRESS_ACTIVATION_TARGET_INVALID");
  if (value.adapter_id !== "HTTPS_JSON_ACK_V1") reject("MONITOR_EGRESS_ACTIVATION_ADAPTER_INVALID");
  for (const field of ["previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256"]) digest(value[field], "MONITOR_EGRESS_ACTIVATION_DIGEST_INVALID", true);
  for (const field of ["monitoring_bundle_sha256", "adapter_sha256", "credential_sha256", "escalation_table_sha256", "template_file_sha256", "template_policy_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256"]) digest(value[field], "MONITOR_EGRESS_ACTIVATION_DIGEST_INVALID");
  if (new Set([value.approval_reference_sha256, value.responsible_operator_identity_sha256, value.approver_identity_sha256]).size !== 3) reject("MONITOR_EGRESS_ACTIVATION_ACTORS_INVALID");
  iso(value.activated_at, "MONITOR_EGRESS_ACTIVATION_TIME_INVALID"); iso(value.expires_at, "MONITOR_EGRESS_ACTIVATION_TIME_INVALID");
  if (Date.parse(value.expires_at) <= Date.parse(value.activated_at) || Date.parse(value.expires_at) - Date.parse(value.activated_at) > 24 * 60 * 60 * 1000) reject("MONITOR_EGRESS_ACTIVATION_TIME_INVALID");
  if (value.egress_generation === 1) {
    if (value.previous_policy_sha256 !== ZERO_SHA256 || value.previous_activation_receipt_sha256 !== ZERO_SHA256
      || value.current_policy_source !== null || value.current_activation_source !== null) reject("MONITOR_EGRESS_ACTIVATION_GENERATION_INVALID");
  } else {
    if (value.previous_policy_sha256 === ZERO_SHA256 || value.previous_activation_receipt_sha256 === ZERO_SHA256
      || value.current_policy_source === null || value.current_activation_source === null) reject("MONITOR_EGRESS_ACTIVATION_GENERATION_INVALID");
    validateSource(value.current_policy_source, { expectedPath: NOTIFIER_EGRESS_POLICY_TARGET, expectedMode: "0440", expectedGid: value.notifier_gid, code: "MONITOR_EGRESS_ACTIVATION_CURRENT_SOURCE_INVALID" });
    validateSource(value.current_activation_source, { expectedPath: NOTIFIER_EGRESS_ACTIVATION_VIEW, expectedMode: "0440", expectedGid: value.notifier_gid, code: "MONITOR_EGRESS_ACTIVATION_CURRENT_SOURCE_INVALID" });
    if (value.current_policy_source.sha256 !== value.previous_policy_sha256) reject("MONITOR_EGRESS_ACTIVATION_CURRENT_SOURCE_INVALID");
  }
  const notifier = validateSource(value.notifier_config_source, { expectedMode: "0440", expectedGid: value.notifier_gid, code: "MONITOR_EGRESS_ACTIVATION_NOTIFIER_SOURCE_INVALID" });
  if (!/^\/etc\/chenyida-erp\/monitoring-v1\/views\/[0-9a-f]{64}\.notifier\.json$/u.test(notifier.path)) reject("MONITOR_EGRESS_ACTIVATION_NOTIFIER_SOURCE_INVALID");
  validateSource(value.base_unit_source, { expectedPath: NOTIFIER_EGRESS_UNIT_FRAGMENT, expectedMode: "0444", expectedGid: 0, code: "MONITOR_EGRESS_ACTIVATION_BASE_UNIT_INVALID" });
  if (operation === "ACTIVATE") {
    if (value.rollback_target_activation_receipt_sha256 !== ZERO_SHA256 || value.rollback_policy_source !== null || value.rollback_activation_source !== null) reject("MONITOR_EGRESS_ACTIVATION_ROLLBACK_INVALID");
  } else {
    if (value.egress_generation < 3 || value.rollback_target_activation_receipt_sha256 === ZERO_SHA256
      || value.rollback_policy_source === null || value.rollback_activation_source === null) reject("MONITOR_EGRESS_ACTIVATION_ROLLBACK_INVALID");
    validateSource(value.rollback_policy_source, { expectedMode: "0400", expectedGid: 0, code: "MONITOR_EGRESS_ACTIVATION_ROLLBACK_INVALID" });
    validateSource(value.rollback_activation_source, { expectedMode: "0400", expectedGid: 0, code: "MONITOR_EGRESS_ACTIVATION_ROLLBACK_INVALID" });
    if (!new RegExp(`^${NOTIFIER_EGRESS_STATE_ROOT}/history/[0-9]{16}\\.[0-9a-f]{64}\\.json$`, "u").test(value.rollback_policy_source.path)
      || !new RegExp(`^${NOTIFIER_EGRESS_STATE_ROOT}/receipts/[0-9]{16}\\.[0-9a-f]{64}\\.json$`, "u").test(value.rollback_activation_source.path)) reject("MONITOR_EGRESS_ACTIVATION_ROLLBACK_INVALID");
  }
  return value;
}

export function validateNotifierEgressActivationContext(value) {
  exactKeys(value, CONTEXT_FIELDS, "MONITOR_EGRESS_ACTIVATION_CONTEXT_INVALID");
  if (value.schema_version !== 1 || value.contract !== NOTIFIER_EGRESS_CONTEXT_CONTRACT
    || !new Set(["ACTIVATE", "ROLLBACK"]).has(value.operation) || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject("MONITOR_EGRESS_ACTIVATION_CONTEXT_INVALID");
  identifier(value.operation_id, "MONITOR_EGRESS_ACTIVATION_CONTEXT_INVALID"); identifier(value.execution_authorization_id, "MONITOR_EGRESS_ACTIVATION_CONTEXT_INVALID");
  iso(value.execution_created_at, "MONITOR_EGRESS_ACTIVATION_CONTEXT_INVALID");
  for (const field of ["execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256"]) digest(value[field], "MONITOR_EGRESS_ACTIVATION_CONTEXT_INVALID");
  validateNotifierEgressActivationParameters(value.operation, value.parameters);
  if (value.parameters.activation_id !== value.operation_id) reject("MONITOR_EGRESS_ACTIVATION_CONTEXT_BINDING_INVALID");
  if (value.execution_mode === "ORIGINAL") {
    if (value.execution_authorization_id !== value.operation_id || value.execution_authorization_sha256 !== value.original_authorization_sha256 || value.expected_intent_sha256 !== null
      || Math.abs(Date.parse(value.parameters.activated_at) - Date.parse(value.execution_created_at)) > 5 * 60 * 1000
      || Date.parse(value.execution_created_at) >= Date.parse(value.parameters.expires_at)) reject("MONITOR_EGRESS_ACTIVATION_CONTEXT_BINDING_INVALID");
  } else {
    if (value.execution_authorization_id === value.operation_id || value.execution_authorization_sha256 === value.original_authorization_sha256) reject("MONITOR_EGRESS_ACTIVATION_CONTEXT_BINDING_INVALID");
    digest(value.expected_intent_sha256, "MONITOR_EGRESS_ACTIVATION_CONTEXT_BINDING_INVALID");
  }
  return value;
}

function physicalPath(logical, filesystemRoot) {
  if (filesystemRoot === "/") return logical;
  if (!path.isAbsolute(filesystemRoot) || !path.isAbsolute(logical) || logical === "/") reject("MONITOR_EGRESS_FILESYSTEM_ROOT_INVALID");
  return path.join(filesystemRoot, logical.slice(1));
}

async function syncDirectory(directory, code) {
  let handle;
  try { handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); await handle.sync(); }
  catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
}

async function trustedDirectory(directory, modes, code, uid = 0, gid = 0) {
  const metadata = await lstat(directory).catch(() => reject(code));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== gid
    || !modes.has(metadata.mode & 0o7777) || await realpath(directory) !== directory) reject(code);
  return directory;
}

async function ensureDirectory(directory, parent, mode, code, uid = 0, gid = 0) {
  await trustedDirectory(parent, new Set([0o700, 0o750, 0o755]), code);
  let created = false;
  try { await mkdir(directory, { mode }); created = true; }
  catch (error) { if (error?.code !== "EEXIST") reject(code); }
  if (created) {
    await chown(directory, uid, gid).catch(() => reject(code)); await chmod(directory, mode).catch(() => reject(code)); await syncDirectory(parent, code);
  }
  await trustedDirectory(directory, new Set([mode]), code, uid, gid);
  return directory;
}

function stableIdentity(value) { return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs]; }

async function trustedBytes(file, mode, uid, gid, maximum, code) {
  const before = await lstat(file, { bigint: true }).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  if (before === null) return null;
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== BigInt(uid) || before.gid !== BigInt(gid) || before.nlink !== 1n
    || modeOf(before) !== mode || before.size < 1n || before.size > BigInt(maximum)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat({ bigint: true });
    if (stableIdentity(opened).some((entry, index) => entry !== stableIdentity(before)[index])) reject(`${code}_CHANGED`);
    const raw = await handle.readFile(), after = await handle.stat({ bigint: true }), named = await lstat(file, { bigint: true });
    if (stableIdentity(after).some((entry, index) => entry !== stableIdentity(opened)[index])
      || stableIdentity(named).some((entry, index) => entry !== stableIdentity(opened)[index])) reject(`${code}_CHANGED`);
    return Object.freeze({ raw, metadata: opened });
  } finally { await handle.close(); }
}

async function trustedJson(file, mode, uid, gid, validator, code) {
  const stored = await trustedBytes(file, mode, uid, gid, MAX_JSON_BYTES, code);
  if (stored === null) return null;
  let parsed, value;
  try { parsed = parseStrictMonitoringJson(stored.raw.toString("utf8"), MAX_JSON_BYTES); value = validator(parsed); }
  catch { reject(code); }
  if (stored.raw.toString("utf8") !== canonicalMonitoringJson(value)) reject(code);
  return Object.freeze({ ...stored, value });
}

async function readAuthorizedSource(spec, filesystemRoot, validator, code, json = true) {
  const file = physicalPath(spec.path, filesystemRoot);
  const stored = json
    ? await trustedJson(file, Number.parseInt(spec.mode, 8), spec.uid, spec.gid, validator, code)
    : await trustedBytes(file, Number.parseInt(spec.mode, 8), spec.uid, spec.gid, MAX_JSON_BYTES, code);
  if (!stored || stored.raw.length !== spec.bytes || rawSha256(stored.raw) !== spec.sha256
    || String(stored.metadata.dev) !== spec.device || String(stored.metadata.ino) !== spec.inode) reject(code);
  return stored;
}

async function ensureRawFile(file, raw, mode, uid, gid, validator, code, json = true) {
  const existing = await trustedBytes(file, mode, uid, gid, Math.max(raw.length, 1), code);
  if (existing !== null) {
    if (!existing.raw.equals(raw)) reject(code);
    if (json) {
      try { validator(parseStrictMonitoringJson(existing.raw.toString("utf8"), MAX_JSON_BYTES)); }
      catch { reject(code); }
    }
    return;
  }
  let handle;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(raw); await handle.chown(uid, gid); await handle.chmod(mode); await handle.sync();
  } catch { reject(code); }
  finally { await handle?.close().catch(() => undefined); }
  const stored = json ? await trustedJson(file, mode, uid, gid, validator, code) : await trustedBytes(file, mode, uid, gid, raw.length, code);
  if (!stored?.raw.equals(raw)) reject(code);
}

async function atomicAlias(file, temporary, raw, mode, uid, gid, validator, expectedPrevious, code, json = true, beforeRename = null) {
  await ensureRawFile(temporary, raw, mode, uid, gid, validator, `${code}_TEMP_INVALID`, json);
  const before = await trustedBytes(file, mode, uid, gid, MAX_JSON_BYTES, `${code}_CURRENT_INVALID`);
  if (expectedPrevious === null ? before !== null : before === null || !before.raw.equals(expectedPrevious)) reject(`${code}_CURRENT_CHANGED`);
  await beforeRename?.();
  await rename(temporary, file).catch(() => reject(`${code}_RENAME_FAILED`));
  await syncDirectory(path.dirname(file), `${code}_SYNC_FAILED`);
  const stored = await trustedBytes(file, mode, uid, gid, MAX_JSON_BYTES, `${code}_CURRENT_INVALID`);
  if (!stored?.raw.equals(raw)) reject(`${code}_CURRENT_INVALID`);
}

async function ensureMarker(file, allowCreate, code) {
  const raw = Buffer.from(NOTIFIER_EGRESS_STATE_MARKER_VALUE, "utf8");
  const existing = await trustedBytes(file, 0o400, 0, 0, raw.length, code);
  if (existing === null) {
    if (!allowCreate) reject(code);
    await ensureRawFile(file, raw, 0o400, 0, 0, () => true, code, false);
    await syncDirectory(path.dirname(file), code);
  } else if (!existing.raw.equals(raw)) reject(code);
}

async function strictNames(directory, expression, allowed, code) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => reject(code));
  const names = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !expression.test(entry.name) || allowed.has(entry.name)) reject(code);
    names.push(entry.name);
  }
  return names.sort();
}

async function layout(filesystemRoot, allowCreate, recoveryOperationId = null) {
  const stateRoot = physicalPath(NOTIFIER_EGRESS_STATE_ROOT, filesystemRoot);
  const stateParent = path.dirname(stateRoot);
  await trustedDirectory(stateParent, new Set([0o700, 0o750, 0o755]), "MONITOR_EGRESS_STATE_PARENT_INVALID");
  const stateExists = await lstat(stateRoot).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("MONITOR_EGRESS_STATE_ROOT_INVALID"));
  if (!stateExists && !allowCreate) reject("MONITOR_EGRESS_STATE_ROOT_INVALID");
  if (!stateExists) await ensureDirectory(stateRoot, stateParent, 0o700, "MONITOR_EGRESS_STATE_ROOT_INVALID");
  else await trustedDirectory(stateRoot, new Set([0o700]), "MONITOR_EGRESS_STATE_ROOT_INVALID");
  const result = {
    stateRoot,
    history: path.join(stateRoot, "history"),
    intents: path.join(stateRoot, "intents"),
    quarantine: path.join(stateRoot, "quarantine"),
    receipts: path.join(stateRoot, "receipts"),
    recoveries: path.join(stateRoot, "recoveries"),
    current: physicalPath(NOTIFIER_EGRESS_CURRENT_FILE, filesystemRoot),
    target: physicalPath(NOTIFIER_EGRESS_POLICY_TARGET, filesystemRoot),
    activationView: physicalPath(NOTIFIER_EGRESS_ACTIVATION_VIEW, filesystemRoot),
    targetRoot: path.dirname(physicalPath(NOTIFIER_EGRESS_POLICY_TARGET, filesystemRoot)),
    dropin: physicalPath(NOTIFIER_EGRESS_DROPIN_TARGET, filesystemRoot),
    dropinRoot: path.dirname(physicalPath(NOTIFIER_EGRESS_DROPIN_TARGET, filesystemRoot)),
    systemdRoot: path.dirname(physicalPath(NOTIFIER_EGRESS_UNIT_FRAGMENT, filesystemRoot)),
  };
  for (const name of ["history", "intents", "quarantine", "receipts", "recoveries"]) {
    const exists = await lstat(result[name]).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("MONITOR_EGRESS_STATE_ROOT_INVALID"));
    if (!exists && !allowCreate) reject("MONITOR_EGRESS_STATE_ROOT_INVALID");
    if (!exists) await ensureDirectory(result[name], stateRoot, 0o700, "MONITOR_EGRESS_STATE_ROOT_INVALID");
    else await trustedDirectory(result[name], new Set([0o700]), "MONITOR_EGRESS_STATE_ROOT_INVALID");
  }
  await ensureMarker(path.join(stateRoot, NOTIFIER_EGRESS_STATE_MARKER), allowCreate, "MONITOR_EGRESS_STATE_MARKER_INVALID");
  const stateEntries = (await readdir(stateRoot)).sort();
  const expected = [NOTIFIER_EGRESS_STATE_MARKER, "history", "intents", "quarantine", "receipts", "recoveries"];
  if (await lstat(result.current).then(() => true).catch(() => false)) expected.push("current.json");
  if (recoveryOperationId !== null) {
    identifier(recoveryOperationId, "MONITOR_EGRESS_RECOVERY_TEMP_INVALID");
    const prefix = `.current.${recoveryOperationId}.`;
    const temporaries = stateEntries.filter((name) => name.startsWith(prefix) && SHA256.test(name.slice(prefix.length, -4)) && name.endsWith(".tmp"));
    if (temporaries.length > 1) reject("MONITOR_EGRESS_RECOVERY_TEMP_INVALID");
    expected.push(...temporaries);
  }
  if (canonicalMonitoringJson(stateEntries.sort()) !== canonicalMonitoringJson(expected.sort())) reject("MONITOR_EGRESS_STATE_ROOT_INVALID");
  await trustedDirectory(result.targetRoot, new Set([0o755]), "MONITOR_EGRESS_VIEW_ROOT_INVALID");
  await trustedDirectory(result.systemdRoot, new Set([0o755]), "MONITOR_EGRESS_SYSTEMD_ROOT_INVALID");
  const dropinRootExists = await lstat(result.dropinRoot).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
  if (dropinRootExists) await trustedDirectory(result.dropinRoot, new Set([0o755]), "MONITOR_EGRESS_DROPIN_ROOT_INVALID");
  return Object.freeze({ ...result, dropinRootExists });
}

async function ensureDropinRoot(paths) {
  if (!paths.dropinRootExists) await ensureDirectory(paths.dropinRoot, paths.systemdRoot, 0o755, "MONITOR_EGRESS_DROPIN_ROOT_INVALID");
  const names = await readdir(paths.dropinRoot, { withFileTypes: true }).catch(() => reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
  const allowed = new Set([path.basename(paths.dropin), paths.recoveryDropinTemporary].filter(Boolean));
  if (names.some((entry) => !allowed.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) reject("MONITOR_EGRESS_UNKNOWN_DROPIN_PRESENT");
}

async function repositoryTemplate(siteRoot) {
  const file = path.join(siteRoot, TEMPLATE_RELATIVE);
  const raw = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).then(async (handle) => {
    try { return await handle.readFile(); } finally { await handle.close(); }
  }).catch(() => reject("MONITOR_EGRESS_TEMPLATE_INVALID"));
  let template;
  try { template = validateNotifierEgressTemplate(parseStrictMonitoringJson(raw.toString("utf8"), MAX_JSON_BYTES)); }
  catch { reject("MONITOR_EGRESS_TEMPLATE_INVALID"); }
  return Object.freeze({ template, raw });
}

async function committedChain(paths, stagedHistoryName = null, stagedReceiptName = null) {
  const allHistoryNames = await strictNames(paths.history, /^[0-9]{16}\.[0-9a-f]{64}\.json$/u, new Set(), "MONITOR_EGRESS_HISTORY_ROOT_INVALID");
  const allReceiptNames = await strictNames(paths.receipts, /^[0-9]{16}\.[0-9a-f]{64}\.json$/u, new Set(), "MONITOR_EGRESS_RECEIPT_ROOT_INVALID");
  const historyNames = allHistoryNames.filter((name) => name !== stagedHistoryName);
  const receiptNames = allReceiptNames.filter((name) => name !== stagedReceiptName);
  if (allHistoryNames.length - historyNames.length > 1 || allReceiptNames.length - receiptNames.length > 1) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
  if (historyNames.length !== receiptNames.length) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
  const policies = [], receipts = [];
  for (let index = 0; index < historyNames.length; index += 1) {
    const policy = await trustedJson(path.join(paths.history, historyNames[index]), 0o400, 0, 0, validateNotifierEgressPolicy, "MONITOR_EGRESS_HISTORY_INVALID");
    const receipt = await trustedJson(path.join(paths.receipts, receiptNames[index]), 0o400, 0, 0, (value) => validateNotifierEgressActivationReceipt(value, policy.value), "MONITOR_EGRESS_RECEIPT_INVALID");
    const generation = index + 1;
    if (policy.value.generation !== generation || receipt.value.generation !== generation
      || historyNames[index] !== path.basename(receipt.value.history_file)
      || receiptNames[index] !== `${String(generation).padStart(16, "0")}.${receipt.value.receipt_sha256}.json`
      || policy.value.previous_policy_sha256 !== (index === 0 ? ZERO_SHA256 : receipts[index - 1].value.policy_sha256)
      || receipt.value.previous_activation_receipt_sha256 !== (index === 0 ? ZERO_SHA256 : receipts[index - 1].value.receipt_sha256)) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
    if (index > 0) {
      const previous = policies[index - 1].value;
      if (policy.value.environment !== previous.environment || policy.value.deployment_id !== previous.deployment_id) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
      if (policy.value.operation === "ACTIVATE") {
        const targetChanged = canonicalMonitoringJson({ target_id: previous.target.target_id, endpoint: previous.target.endpoint, addresses: previous.network.allowed_addresses })
          !== canonicalMonitoringJson({ target_id: policy.value.target.target_id, endpoint: policy.value.target.endpoint, addresses: policy.value.network.allowed_addresses });
        const highWatermark = Math.max(...policies.map((entry) => entry.value.target.target_generation));
        const expectedTargetGeneration = targetChanged ? highWatermark + 1 : previous.target.target_generation;
        if (policy.value.target.target_generation !== expectedTargetGeneration) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
      } else {
        const rollbackIndex = index - 2;
        if (rollbackIndex < 0 || policy.value.rollback_target_activation_receipt_sha256 !== receipts[rollbackIndex].value.receipt_sha256
          || !exactRollbackBinding(policy.value, policies[rollbackIndex].value)) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
      }
    }
    policies.push(policy); receipts.push(receipt);
  }
  const current = await trustedJson(paths.current, 0o400, 0, 0, validateNotifierEgressActivationReceipt, "MONITOR_EGRESS_CURRENT_INVALID");
  if (receipts.length === 0) {
    if (current !== null) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
    return Object.freeze({ policies, receipts, current: null, currentPolicy: null });
  }
  const latestPolicy = policies.at(-1), latestReceipt = receipts.at(-1);
  if (!current || !current.raw.equals(latestReceipt.raw)) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
  return Object.freeze({ policies, receipts, current, currentPolicy: latestPolicy });
}

async function verifyPublicChain(chain, paths, notifierGid) {
  if (chain.current === null) {
    const policy = await trustedBytes(paths.target, 0o440, 0, notifierGid, MAX_JSON_BYTES, "MONITOR_EGRESS_PUBLIC_POLICY_INVALID");
    const activation = await trustedBytes(paths.activationView, 0o440, 0, notifierGid, MAX_JSON_BYTES, "MONITOR_EGRESS_PUBLIC_ACTIVATION_INVALID");
    if (policy !== null || activation !== null) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
    return Object.freeze({ policy: null, activation: null });
  }
  const policy = await trustedJson(paths.target, 0o440, 0, notifierGid, validateNotifierEgressPolicy, "MONITOR_EGRESS_PUBLIC_POLICY_INVALID");
  const activation = await trustedJson(paths.activationView, 0o440, 0, notifierGid, (value) => validateNotifierEgressActivationReceipt(value, chain.currentPolicy.value), "MONITOR_EGRESS_PUBLIC_ACTIVATION_INVALID");
  if (!policy?.raw.equals(chain.currentPolicy.raw) || !activation?.raw.equals(chain.current.raw)) reject("MONITOR_EGRESS_COMMITTED_CHAIN_INVALID");
  return Object.freeze({ policy, activation });
}

async function verifyCommittedDropin(chain, paths) {
  const dropinRootExists = await lstat(paths.dropinRoot).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
  if (!dropinRootExists) {
    if (chain.current !== null) reject("MONITOR_EGRESS_DROPIN_MISSING");
    return null;
  }
  const names = await readdir(paths.dropinRoot, { withFileTypes: true }).catch(() => reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
  if (names.some((entry) => entry.name !== path.basename(paths.dropin) || !entry.isFile() || entry.isSymbolicLink())) reject("MONITOR_EGRESS_UNKNOWN_DROPIN_PRESENT");
  const stored = await trustedBytes(paths.dropin, 0o444, 0, 0, 64 * 1024, "MONITOR_EGRESS_DROPIN_INVALID");
  if (chain.current === null) {
    if (stored !== null) reject("MONITOR_EGRESS_DROPIN_INVALID");
    return null;
  }
  const expected = createNotifierEgressDropIn(chain.currentPolicy.value);
  if (!stored?.raw.equals(expected) || rawSha256(stored.raw) !== chain.currentPolicy.value.systemd.dropin_sha256) reject("MONITOR_EGRESS_DROPIN_INVALID");
  return stored;
}

async function verifyAuthorizedSources(context, filesystemRoot) {
  const parameters = context.parameters;
  const configSource = await readAuthorizedSource(parameters.notifier_config_source, filesystemRoot, validateMonitoringNotifierConfig, "MONITOR_EGRESS_NOTIFIER_SOURCE_INVALID");
  const config = configSource.value;
  if (config.deployment.class !== parameters.environment || config.deployment.id !== parameters.deployment_id
    || config.installation.monitoring_bundle_sha256 !== parameters.monitoring_bundle_sha256
    || config.installation.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || config.notification.target_id !== parameters.target_id || config.notification.target_generation !== parameters.target_generation
    || canonicalMonitoringJson(config.notification.endpoint) !== canonicalMonitoringJson(parameters.endpoint)
    || config.notification.adapter.id !== parameters.adapter_id || config.notification.adapter.source_sha256 !== parameters.adapter_sha256
    || config.notification.credential.sha256 !== parameters.credential_sha256 || config.notification.credential.generation !== parameters.credential_generation
    || config.notification.oncall_roster_generation !== parameters.oncall_roster_generation
    || config.notification.escalation_table_sha256 !== parameters.escalation_table_sha256) reject("MONITOR_EGRESS_NOTIFIER_BINDING_INVALID");
  const baseUnit = await readAuthorizedSource(parameters.base_unit_source, filesystemRoot, null, "MONITOR_EGRESS_BASE_UNIT_INVALID", false);
  if (context.parameters.base_unit_source.sha256 !== rawSha256(baseUnit.raw)) reject("MONITOR_EGRESS_BASE_UNIT_INVALID");
  if (parameters.egress_generation > 1) {
    const currentPolicy = await readAuthorizedSource(parameters.current_policy_source, filesystemRoot, validateNotifierEgressPolicy, "MONITOR_EGRESS_CURRENT_SOURCE_INVALID");
    const currentActivation = await readAuthorizedSource(parameters.current_activation_source, filesystemRoot, (value) => validateNotifierEgressActivationReceipt(value, currentPolicy.value), "MONITOR_EGRESS_CURRENT_SOURCE_INVALID");
    if (currentPolicy.value.generation + 1 !== parameters.egress_generation || currentPolicy.value.environment !== parameters.environment
      || currentActivation.value.receipt_sha256 !== parameters.previous_activation_receipt_sha256) reject("MONITOR_EGRESS_CURRENT_SOURCE_INVALID");
  }
  if (context.operation === "ROLLBACK") {
    const rollbackPolicy = await readAuthorizedSource(parameters.rollback_policy_source, filesystemRoot, validateNotifierEgressPolicy, "MONITOR_EGRESS_ROLLBACK_SOURCE_INVALID");
    const rollbackActivation = await readAuthorizedSource(parameters.rollback_activation_source, filesystemRoot, (value) => validateNotifierEgressActivationReceipt(value, rollbackPolicy.value), "MONITOR_EGRESS_ROLLBACK_SOURCE_INVALID");
    if (rollbackActivation.value.receipt_sha256 !== parameters.rollback_target_activation_receipt_sha256) reject("MONITOR_EGRESS_ROLLBACK_SOURCE_INVALID");
  }
  return Object.freeze({ config, configSource, baseUnit });
}

function exactRollbackBinding(candidate, target) {
  const left = {
    target: candidate.target,
    network: candidate.network,
    adapter_id: candidate.binding.adapter_id,
    adapter_sha256: candidate.binding.adapter_sha256,
    credential_sha256: candidate.binding.credential_sha256,
    credential_generation: candidate.binding.credential_generation,
    oncall_roster_generation: candidate.binding.oncall_roster_generation,
    escalation_table_sha256: candidate.binding.escalation_table_sha256,
  };
  const right = {
    target: target.target,
    network: target.network,
    adapter_id: target.binding.adapter_id,
    adapter_sha256: target.binding.adapter_sha256,
    credential_sha256: target.binding.credential_sha256,
    credential_generation: target.binding.credential_generation,
    oncall_roster_generation: target.binding.oncall_roster_generation,
    escalation_table_sha256: target.binding.escalation_table_sha256,
  };
  return canonicalMonitoringJson(left) === canonicalMonitoringJson(right);
}

async function candidateFor(context, paths, siteRoot) {
  const repository = await repositoryTemplate(siteRoot), parameters = context.parameters;
  if (rawSha256(repository.raw) !== parameters.template_file_sha256
    || notifierEgressTemplateLogicalSha256(repository.template) !== parameters.template_policy_sha256) reject("MONITOR_EGRESS_TEMPLATE_BINDING_INVALID");
  const chain = await committedChain(paths);
  await verifyPublicChain(chain, paths, parameters.notifier_gid);
  await verifyCommittedDropin(chain, paths);
  const expectedGeneration = chain.current === null ? 1 : chain.current.value.generation + 1;
  const expectedPreviousPolicy = chain.current === null ? ZERO_SHA256 : chain.current.value.policy_sha256;
  const expectedPreviousReceipt = chain.current === null ? ZERO_SHA256 : chain.current.value.receipt_sha256;
  if (parameters.egress_generation !== expectedGeneration || parameters.previous_policy_sha256 !== expectedPreviousPolicy
    || parameters.previous_activation_receipt_sha256 !== expectedPreviousReceipt
    || chain.current !== null && (parameters.environment !== chain.current.value.environment
      || parameters.deployment_id !== chain.current.value.deployment_id)) reject("MONITOR_EGRESS_ACTIVATION_GENERATION_MISMATCH");
  const policy = createNotifierEgressPolicy({
    template: repository.template,
    parameters: {
      operation: context.operation,
      environment: parameters.environment,
      egress_generation: parameters.egress_generation,
      previous_policy_sha256: parameters.previous_policy_sha256,
      previous_activation_receipt_sha256: parameters.previous_activation_receipt_sha256,
      rollback_target_activation_receipt_sha256: parameters.rollback_target_activation_receipt_sha256,
      deployment_id: parameters.deployment_id,
      target_id: parameters.target_id,
      target_generation: parameters.target_generation,
      endpoint: parameters.endpoint,
      allowed_addresses: parameters.allowed_addresses,
      monitoring_bundle_sha256: parameters.monitoring_bundle_sha256,
      supervisor_bundle_sha256: context.supervisor_bundle_sha256,
      notifier_config_sha256: parameters.notifier_config_source.sha256,
      adapter_id: parameters.adapter_id,
      adapter_sha256: parameters.adapter_sha256,
      credential_sha256: parameters.credential_sha256,
      credential_generation: parameters.credential_generation,
      oncall_roster_generation: parameters.oncall_roster_generation,
      escalation_table_sha256: parameters.escalation_table_sha256,
      base_unit_sha256: parameters.base_unit_source.sha256,
      template_file_sha256: parameters.template_file_sha256,
      template_policy_sha256: parameters.template_policy_sha256,
      authorization_sha256: context.original_authorization_sha256,
      approval_reference_sha256: parameters.approval_reference_sha256,
      responsible_operator_identity_sha256: parameters.responsible_operator_identity_sha256,
      approver_identity_sha256: parameters.approver_identity_sha256,
      activated_at: parameters.activated_at,
      expires_at: parameters.expires_at,
    },
  });
  if (chain.currentPolicy === null && policy.target.target_generation !== 1) {
    reject("MONITOR_EGRESS_TARGET_GENERATION_MISMATCH");
  }
  if (chain.currentPolicy !== null && context.operation === "ACTIVATE") {
    const previous = chain.currentPolicy.value;
    const targetChanged = canonicalMonitoringJson({ target_id: previous.target.target_id, endpoint: previous.target.endpoint, addresses: previous.network.allowed_addresses })
      !== canonicalMonitoringJson({ target_id: policy.target.target_id, endpoint: policy.target.endpoint, addresses: policy.network.allowed_addresses });
    const highWatermark = Math.max(...chain.policies.map((entry) => entry.value.target.target_generation));
    const expectedTargetGeneration = targetChanged ? highWatermark + 1 : previous.target.target_generation;
    if (policy.target.target_generation !== expectedTargetGeneration) reject("MONITOR_EGRESS_TARGET_GENERATION_MISMATCH");
  }
  if (context.operation === "ROLLBACK") {
    if (chain.receipts.length < 2) reject("MONITOR_EGRESS_ROLLBACK_INVALID");
    const targetReceipt = chain.receipts.at(-2), targetPolicy = chain.policies.at(-2);
    if (parameters.rollback_target_activation_receipt_sha256 !== targetReceipt.value.receipt_sha256
      || parameters.rollback_activation_source.path !== `${NOTIFIER_EGRESS_STATE_ROOT}/receipts/${String(targetReceipt.value.generation).padStart(16, "0")}.${targetReceipt.value.receipt_sha256}.json`
      || parameters.rollback_activation_source.sha256 !== rawSha256(targetReceipt.raw)
      || parameters.rollback_policy_source.path !== targetReceipt.value.history_file || parameters.rollback_policy_source.sha256 !== rawSha256(targetPolicy.raw)
      || !exactRollbackBinding(policy, targetPolicy.value)) reject("MONITOR_EGRESS_ROLLBACK_INVALID");
  }
  const receipt = createNotifierEgressActivationReceipt({ policy, activationId: context.operation_id });
  return Object.freeze({ policy, receipt, chain });
}

async function assertNoForeignActiveIntent(paths, candidateIntent) {
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "MONITOR_EGRESS_INTENT_ROOT_INVALID");
  if (names.length === 0) return;
  const chain = await committedChain(paths);
  const committedReceipts = new Set(chain.receipts.map((entry) => entry.value.receipt_sha256));
  for (const name of names) {
    const stored = await trustedJson(path.join(paths.intents, name), 0o400, 0, 0, validateIntent, "MONITOR_EGRESS_INTENT_INVALID");
    if (!committedReceipts.has(stored.value.receipt.receipt_sha256) && stored.value.intent_sha256 !== candidateIntent.intent_sha256) reject("MONITOR_EGRESS_ACTIVE_INTENT_PRESENT");
  }
}

function createIntent(context, candidate) {
  const body = {
    schema_version: 1,
    contract: NOTIFIER_EGRESS_INTENT_CONTRACT,
    operation_id: context.operation_id,
    operation: context.operation,
    created_at: context.parameters.activated_at,
    original_authorization_sha256: context.original_authorization_sha256,
    supervisor_bundle_sha256: context.supervisor_bundle_sha256,
    parameters: context.parameters,
    policy: candidate.policy,
    receipt: candidate.receipt,
  };
  return Object.freeze({ ...body, intent_sha256: monitoringSha256(body) });
}

function validateIntent(value) {
  exactKeys(value, ["schema_version", "contract", "operation_id", "operation", "created_at", "original_authorization_sha256", "supervisor_bundle_sha256", "parameters", "policy", "receipt", "intent_sha256"], "MONITOR_EGRESS_INTENT_INVALID");
  if (value.schema_version !== 1 || value.contract !== NOTIFIER_EGRESS_INTENT_CONTRACT) reject("MONITOR_EGRESS_INTENT_INVALID");
  identifier(value.operation_id, "MONITOR_EGRESS_INTENT_INVALID"); iso(value.created_at, "MONITOR_EGRESS_INTENT_INVALID");
  digest(value.original_authorization_sha256, "MONITOR_EGRESS_INTENT_INVALID"); digest(value.supervisor_bundle_sha256, "MONITOR_EGRESS_INTENT_INVALID"); digest(value.intent_sha256, "MONITOR_EGRESS_INTENT_INVALID");
  validateNotifierEgressActivationParameters(value.operation, value.parameters);
  const policy = validateNotifierEgressPolicy(value.policy), receipt = validateNotifierEgressActivationReceipt(value.receipt, policy);
  if (value.operation_id !== value.parameters.activation_id || receipt.activation_id !== value.operation_id || receipt.operation !== value.operation
    || receipt.authorization_sha256 !== value.original_authorization_sha256 || receipt.supervisor_bundle_sha256 !== value.supervisor_bundle_sha256
    || monitoringSha256(bodyWithout(value, "intent_sha256")) !== value.intent_sha256) reject("MONITOR_EGRESS_INTENT_INVALID");
  return value;
}

function intentFile(paths, intent) { return path.join(paths.intents, `${intent.operation_id}.${intent.intent_sha256}.json`); }
function historyFile(paths, receipt) { return path.join(paths.history, path.basename(receipt.history_file)); }
function receiptFile(paths, receipt) { return path.join(paths.receipts, `${String(receipt.generation).padStart(16, "0")}.${receipt.receipt_sha256}.json`); }

async function loadIntent(context, paths) {
  const names = await strictNames(paths.intents, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "MONITOR_EGRESS_INTENT_ROOT_INVALID");
  const matches = names.filter((name) => name.startsWith(`${context.operation_id}.`));
  if (matches.length !== 1) reject("MONITOR_EGRESS_INTENT_MISSING");
  const stored = await trustedJson(path.join(paths.intents, matches[0]), 0o400, 0, 0, validateIntent, "MONITOR_EGRESS_INTENT_INVALID");
  if (!stored || context.expected_intent_sha256 !== null && stored.value.intent_sha256 !== context.expected_intent_sha256
    || stored.value.original_authorization_sha256 !== context.original_authorization_sha256 || stored.value.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || stored.value.operation !== context.operation || canonicalMonitoringJson(stored.value.parameters) !== canonicalMonitoringJson(context.parameters)) reject("MONITOR_EGRESS_INTENT_BINDING_INVALID");
  return stored.value;
}

async function recoveryPaths(paths, intent) {
  const policyRaw = Buffer.from(canonicalMonitoringJson(intent.policy));
  const receiptRaw = Buffer.from(canonicalMonitoringJson(intent.receipt));
  const dropinRaw = createNotifierEgressDropIn(intent.policy);
  const currentTemporary = path.join(paths.stateRoot, `.current.${intent.operation_id}.${intent.receipt.receipt_sha256}.tmp`);
  const dropinTemporary = path.join(paths.dropinRoot, `.${intent.operation_id}.${intent.policy.systemd.dropin_sha256}.tmp`);
  const policyTemporary = path.join(paths.targetRoot, `.${intent.operation_id}.${intent.receipt.policy_sha256}.policy.tmp`);
  const activationTemporary = path.join(paths.targetRoot, `.${intent.operation_id}.${intent.receipt.receipt_sha256}.activation.tmp`);
  const stateTemporaries = (await readdir(paths.stateRoot)).filter((name) => name.startsWith(`.current.${intent.operation_id}.`));
  if (stateTemporaries.some((name) => name !== path.basename(currentTemporary))) reject("MONITOR_EGRESS_RECOVERY_CURRENT_TEMP_INVALID");
  const viewTemporaries = (await readdir(paths.targetRoot)).filter((name) => name.startsWith(`.${intent.operation_id}.`) && name.endsWith(".tmp"));
  const expectedViewTemporaries = new Set([path.basename(policyTemporary), path.basename(activationTemporary)]);
  if (viewTemporaries.some((name) => !expectedViewTemporaries.has(name))) reject("MONITOR_EGRESS_RECOVERY_VIEW_TEMP_INVALID");
  for (const [file, raw, mode, gid, code, maximum] of [
    [currentTemporary, receiptRaw, 0o400, 0, "MONITOR_EGRESS_RECOVERY_CURRENT_TEMP_INVALID", MAX_JSON_BYTES],
    [dropinTemporary, dropinRaw, 0o444, 0, "MONITOR_EGRESS_RECOVERY_DROPIN_TEMP_INVALID", 64 * 1024],
    [policyTemporary, policyRaw, 0o440, intent.parameters.notifier_gid, "MONITOR_EGRESS_RECOVERY_POLICY_TEMP_INVALID", MAX_JSON_BYTES],
    [activationTemporary, receiptRaw, 0o440, intent.parameters.notifier_gid, "MONITOR_EGRESS_RECOVERY_ACTIVATION_TEMP_INVALID", MAX_JSON_BYTES],
  ]) {
    const stored = await trustedBytes(file, mode, 0, gid, maximum, code);
    if (stored !== null && !stored.raw.equals(raw)) reject(code);
  }
  if (await lstat(paths.dropinRoot).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"))) {
    const allowed = new Set([path.basename(paths.dropin), path.basename(dropinTemporary)]);
    const names = await readdir(paths.dropinRoot, { withFileTypes: true }).catch(() => reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
    if (names.some((entry) => !allowed.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) reject("MONITOR_EGRESS_UNKNOWN_DROPIN_PRESENT");
  }
  return Object.freeze({ ...paths, recoveryDropinTemporary: path.basename(dropinTemporary) });
}

async function candidateState(paths, intent) {
  const policyRaw = Buffer.from(canonicalMonitoringJson(intent.policy)), receiptRaw = Buffer.from(canonicalMonitoringJson(intent.receipt));
  const hName = path.basename(intent.receipt.history_file), rName = path.basename(receiptFile(paths, intent.receipt));
  const currentRaw = await trustedBytes(paths.current, 0o400, 0, 0, MAX_JSON_BYTES, "MONITOR_EGRESS_CURRENT_INVALID");
  if (currentRaw?.raw.equals(receiptRaw)) {
    const chain = await committedChain(paths);
    await verifyPublicChain(chain, paths, intent.parameters.notifier_gid);
    await verifyCommittedDropin(chain, paths);
    if (!chain.currentPolicy.raw.equals(policyRaw)) reject("MONITOR_EGRESS_COMMITTED_MISMATCH");
    return Object.freeze({ committed: true, history: true, receipt: true, dropin: true, policyView: true, activationView: true, current: true, policyRaw, receiptRaw, chain });
  }
  const chain = await committedChain(paths, hName, rName);
  if ((chain.current?.value.receipt_sha256 || ZERO_SHA256) !== intent.receipt.previous_activation_receipt_sha256) reject("MONITOR_EGRESS_CURRENT_CHANGED");
  const history = await trustedBytes(historyFile(paths, intent.receipt), 0o400, 0, 0, MAX_JSON_BYTES, "MONITOR_EGRESS_HISTORY_INVALID");
  const receipt = await trustedBytes(receiptFile(paths, intent.receipt), 0o400, 0, 0, MAX_JSON_BYTES, "MONITOR_EGRESS_RECEIPT_INVALID");
  const historyDone = history?.raw.equals(policyRaw) || false, receiptDone = receipt?.raw.equals(receiptRaw) || false;
  if (history !== null && !historyDone || receipt !== null && !receiptDone || receiptDone && !historyDone) reject("MONITOR_EGRESS_CANDIDATE_CONFLICT");
  const basePolicyRaw = chain.currentPolicy?.raw || null, baseReceiptRaw = chain.current?.raw || null;
  const dropinRootExists = await lstat(paths.dropinRoot).then(() => true).catch((error) => error?.code === "ENOENT" ? false : reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
  let dropin = null;
  if (dropinRootExists) {
    const names = await readdir(paths.dropinRoot, { withFileTypes: true }).catch(() => reject("MONITOR_EGRESS_DROPIN_ROOT_INVALID"));
    const allowed = new Set([path.basename(paths.dropin), paths.recoveryDropinTemporary].filter(Boolean));
    if (names.some((entry) => !allowed.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) reject("MONITOR_EGRESS_UNKNOWN_DROPIN_PRESENT");
    dropin = await trustedBytes(paths.dropin, 0o444, 0, 0, 64 * 1024, "MONITOR_EGRESS_DROPIN_INVALID");
  }
  const candidateDropin = createNotifierEgressDropIn(intent.policy), baseDropin = chain.currentPolicy === null ? null : createNotifierEgressDropIn(chain.currentPolicy.value);
  const dropinDone = dropin?.raw.equals(candidateDropin) || false, dropinBase = baseDropin === null ? dropin === null : dropin?.raw.equals(baseDropin) || false;
  if (!dropinDone && !dropinBase) reject("MONITOR_EGRESS_DROPIN_CONFLICT");
  const policyView = await trustedBytes(paths.target, 0o440, 0, intent.parameters.notifier_gid, MAX_JSON_BYTES, "MONITOR_EGRESS_PUBLIC_POLICY_INVALID");
  const activationView = await trustedBytes(paths.activationView, 0o440, 0, intent.parameters.notifier_gid, MAX_JSON_BYTES, "MONITOR_EGRESS_PUBLIC_ACTIVATION_INVALID");
  const policyDone = policyView?.raw.equals(policyRaw) || false, policyBase = basePolicyRaw === null ? policyView === null : policyView?.raw.equals(basePolicyRaw) || false;
  const activationDone = activationView?.raw.equals(receiptRaw) || false, activationBase = baseReceiptRaw === null ? activationView === null : activationView?.raw.equals(baseReceiptRaw) || false;
  if (!policyDone && !policyBase || !activationDone && !activationBase || activationDone && !policyDone
    || policyDone && !dropinDone || dropinDone && !receiptDone) reject("MONITOR_EGRESS_PUBLICATION_STAGE_INVALID");
  return Object.freeze({ committed: false, history: historyDone, receipt: receiptDone, dropin: dropinDone, policyView: policyDone, activationView: activationDone, current: false, policyRaw, receiptRaw, candidateDropin, chain });
}

function phaseResult(result, intent, extra = {}) {
  return Object.freeze({
    result,
    operation_id: intent.operation_id,
    intent_sha256: intent.intent_sha256,
    policy_sha256: intent.receipt.policy_sha256,
    receipt_sha256: intent.receipt.receipt_sha256,
    dropin_sha256: intent.policy.systemd.dropin_sha256,
    effective_unit_sha256: intent.policy.systemd.effective_unit_sha256,
    ...extra,
  });
}

async function prepareOriginal(context, options) {
  const paths = await layout(options.filesystemRoot, true);
  if ((await readdir(paths.quarantine)).length !== 0) reject("MONITOR_EGRESS_QUARANTINE_PRESENT");
  await verifyAuthorizedSources(context, options.filesystemRoot);
  const candidate = await candidateFor(context, paths, options.siteRoot);
  const intent = createIntent(context, candidate), raw = Buffer.from(canonicalMonitoringJson(intent)), file = intentFile(paths, intent);
  await assertNoForeignActiveIntent(paths, intent);
  await ensureRawFile(file, raw, 0o400, 0, 0, validateIntent, "MONITOR_EGRESS_INTENT_CONFLICT");
  await syncDirectory(paths.intents, "MONITOR_EGRESS_INTENT_SYNC_FAILED");
  return phaseResult("PREPARED", intent);
}

async function verifyRecoveryRuntimeSources(context, filesystemRoot) {
  const parameters = context.parameters;
  const configSource = await readAuthorizedSource(parameters.notifier_config_source, filesystemRoot, validateMonitoringNotifierConfig, "MONITOR_EGRESS_NOTIFIER_SOURCE_INVALID");
  const config = configSource.value;
  if (config.deployment.class !== parameters.environment || config.deployment.id !== parameters.deployment_id
    || config.installation.monitoring_bundle_sha256 !== parameters.monitoring_bundle_sha256
    || config.installation.supervisor_bundle_sha256 !== context.supervisor_bundle_sha256
    || config.notification.target_id !== parameters.target_id || config.notification.target_generation !== parameters.target_generation
    || canonicalMonitoringJson(config.notification.endpoint) !== canonicalMonitoringJson(parameters.endpoint)
    || config.notification.adapter.id !== parameters.adapter_id || config.notification.adapter.source_sha256 !== parameters.adapter_sha256
    || config.notification.credential.sha256 !== parameters.credential_sha256 || config.notification.credential.generation !== parameters.credential_generation
    || config.notification.oncall_roster_generation !== parameters.oncall_roster_generation
    || config.notification.escalation_table_sha256 !== parameters.escalation_table_sha256) reject("MONITOR_EGRESS_NOTIFIER_BINDING_INVALID");
  await readAuthorizedSource(parameters.base_unit_source, filesystemRoot, null, "MONITOR_EGRESS_BASE_UNIT_INVALID", false);
}

async function applyIntent(context, intent, paths, options, recovery = false) {
  let state = await candidateState(paths, intent);
  if (state.committed) return phaseResult("ALREADY_COMMITTED", intent);
  if (recovery) await verifyRecoveryRuntimeSources(context, options.filesystemRoot);
  else if (!state.policyView) await verifyAuthorizedSources(context, options.filesystemRoot);
  if (!state.history) {
    await ensureRawFile(historyFile(paths, intent.receipt), state.policyRaw, 0o400, 0, 0, validateNotifierEgressPolicy, "MONITOR_EGRESS_HISTORY_CONFLICT");
    await syncDirectory(paths.history, "MONITOR_EGRESS_HISTORY_SYNC_FAILED");
    await options.fault?.("AFTER_HISTORY");
  }
  state = await candidateState(paths, intent);
  if (!state.receipt) {
    await ensureRawFile(receiptFile(paths, intent.receipt), state.receiptRaw, 0o400, 0, 0, (value) => validateNotifierEgressActivationReceipt(value, intent.policy), "MONITOR_EGRESS_RECEIPT_CONFLICT");
    await syncDirectory(paths.receipts, "MONITOR_EGRESS_RECEIPT_SYNC_FAILED");
    await options.fault?.("AFTER_RECEIPT");
  }
  state = await candidateState(paths, intent);
  if (!state.dropin) {
    await ensureDropinRoot(paths);
    const temporary = path.join(paths.dropinRoot, `.${intent.operation_id}.${intent.policy.systemd.dropin_sha256}.tmp`);
    const previous = state.chain.currentPolicy === null ? null : createNotifierEgressDropIn(state.chain.currentPolicy.value);
    await atomicAlias(paths.dropin, temporary, state.candidateDropin, 0o444, 0, 0, () => true, previous, "MONITOR_EGRESS_DROPIN", false, () => options.fault?.("BEFORE_DROPIN_RENAME"));
    await options.fault?.("AFTER_DROPIN");
  }
  state = await candidateState(paths, intent);
  if (!state.dropin || !state.history || !state.receipt) reject("MONITOR_EGRESS_APPLY_INCOMPLETE");
  return phaseResult("APPLIED", intent);
}

async function finalizeIntent(context, intent, paths, options, recovery = false) {
  let state = await candidateState(paths, intent);
  if (state.committed) return phaseResult("ALREADY_COMMITTED", intent);
  if (!state.dropin || !state.history || !state.receipt) reject("MONITOR_EGRESS_EFFECTIVE_POLICY_NOT_APPLIED");
  if (typeof options.effectiveUnitSha256 !== "string" || options.effectiveUnitSha256 !== intent.policy.systemd.effective_unit_sha256) reject("MONITOR_EGRESS_EFFECTIVE_UNIT_NOT_VERIFIED");
  if (recovery) await verifyRecoveryRuntimeSources(context, options.filesystemRoot);
  else if (!state.policyView) await verifyAuthorizedSources(context, options.filesystemRoot);
  if (!state.policyView) {
    const temporary = path.join(paths.targetRoot, `.${intent.operation_id}.${intent.receipt.policy_sha256}.policy.tmp`);
    await atomicAlias(paths.target, temporary, state.policyRaw, 0o440, 0, intent.parameters.notifier_gid, validateNotifierEgressPolicy, state.chain.currentPolicy?.raw || null, "MONITOR_EGRESS_POLICY_VIEW", true, () => options.fault?.("BEFORE_POLICY_VIEW_RENAME"));
    await options.fault?.("AFTER_POLICY_VIEW");
  }
  state = await candidateState(paths, intent);
  if (!state.activationView) {
    const temporary = path.join(paths.targetRoot, `.${intent.operation_id}.${intent.receipt.receipt_sha256}.activation.tmp`);
    await atomicAlias(paths.activationView, temporary, state.receiptRaw, 0o440, 0, intent.parameters.notifier_gid, (value) => validateNotifierEgressActivationReceipt(value, intent.policy), state.chain.current?.raw || null, "MONITOR_EGRESS_ACTIVATION_VIEW", true, () => options.fault?.("BEFORE_ACTIVATION_VIEW_RENAME"));
    await options.fault?.("AFTER_ACTIVATION_VIEW");
  }
  state = await candidateState(paths, intent);
  if (!state.current) {
    const temporary = path.join(paths.stateRoot, `.current.${intent.operation_id}.${intent.receipt.receipt_sha256}.tmp`);
    await atomicAlias(paths.current, temporary, state.receiptRaw, 0o400, 0, 0, (value) => validateNotifierEgressActivationReceipt(value, intent.policy), state.chain.current?.raw || null, "MONITOR_EGRESS_CURRENT", true, () => options.fault?.("BEFORE_CURRENT_RENAME"));
    await options.fault?.("AFTER_CURRENT");
  }
  state = await candidateState(paths, intent);
  if (!state.committed) reject("MONITOR_EGRESS_FINALIZE_INCOMPLETE");
  return phaseResult("COMMITTED", intent);
}

function recoveryPlan(context, intent, decision, reason) {
  const body = {
    schema_version: 1,
    contract: NOTIFIER_EGRESS_RECOVERY_CONTRACT,
    execution_authorization_id: context.execution_authorization_id,
    execution_authorization_sha256: context.execution_authorization_sha256,
    prepared_at: context.execution_created_at,
    original_operation_id: context.operation_id,
    original_authorization_sha256: context.original_authorization_sha256,
    intent_sha256: intent.intent_sha256,
    decision,
    reason,
  };
  return Object.freeze({ ...body, recovery_sha256: monitoringSha256(body) });
}

function validateRecoveryPlan(value) {
  exactKeys(value, ["schema_version", "contract", "execution_authorization_id", "execution_authorization_sha256", "prepared_at", "original_operation_id", "original_authorization_sha256", "intent_sha256", "decision", "reason", "recovery_sha256"], "MONITOR_EGRESS_RECOVERY_INVALID");
  if (value.schema_version !== 1 || value.contract !== NOTIFIER_EGRESS_RECOVERY_CONTRACT || !new Set(["RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"]).has(value.decision)
    || (value.decision === "QUARANTINE") !== (typeof value.reason === "string" && value.reason.length > 0)) reject("MONITOR_EGRESS_RECOVERY_INVALID");
  identifier(value.execution_authorization_id, "MONITOR_EGRESS_RECOVERY_INVALID"); identifier(value.original_operation_id, "MONITOR_EGRESS_RECOVERY_INVALID"); iso(value.prepared_at, "MONITOR_EGRESS_RECOVERY_INVALID");
  for (const field of ["execution_authorization_sha256", "original_authorization_sha256", "intent_sha256", "recovery_sha256"]) digest(value[field], "MONITOR_EGRESS_RECOVERY_INVALID");
  if (monitoringSha256(bodyWithout(value, "recovery_sha256")) !== value.recovery_sha256) reject("MONITOR_EGRESS_RECOVERY_INVALID");
  return value;
}

async function prepareRecovery(context, options) {
  let paths = await layout(options.filesystemRoot, false, context.operation_id);
  const intent = await loadIntent(context, paths);
  let decision = "RESUME_PUBLICATION", reason = null;
  try {
    paths = await recoveryPaths(paths, intent);
    const state = await candidateState(paths, intent);
    if (state.committed) decision = "ALREADY_COMMITTED";
    else if (Date.parse(context.execution_created_at) >= Date.parse(context.parameters.expires_at)) {
      decision = "QUARANTINE"; reason = "MONITOR_EGRESS_POLICY_EXPIRED";
    } else await verifyRecoveryRuntimeSources(context, options.filesystemRoot);
  } catch (error) {
    const recoverable = error instanceof NotifierEgressPublisherError && (error.code.startsWith("MONITOR_EGRESS_") && !new Set([
      "MONITOR_EGRESS_STATE_ROOT_INVALID", "MONITOR_EGRESS_STATE_MARKER_INVALID", "MONITOR_EGRESS_INTENT_INVALID", "MONITOR_EGRESS_INTENT_MISSING",
    ]).has(error.code));
    if (!recoverable) throw error;
    decision = "QUARANTINE"; reason = error.code;
  }
  const plan = recoveryPlan(context, intent, decision, reason), raw = Buffer.from(canonicalMonitoringJson(plan));
  const file = path.join(paths.recoveries, `${context.execution_authorization_id}.${plan.recovery_sha256}.json`);
  await ensureRawFile(file, raw, 0o400, 0, 0, validateRecoveryPlan, "MONITOR_EGRESS_RECOVERY_CONFLICT");
  await syncDirectory(paths.recoveries, "MONITOR_EGRESS_RECOVERY_SYNC_FAILED");
  return Object.freeze({ result: "RECOVERY_PREPARED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, recovery_sha256: plan.recovery_sha256, decision });
}

async function loadRecoveryPlan(context, paths) {
  const names = await strictNames(paths.recoveries, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$/u, new Set(), "MONITOR_EGRESS_RECOVERY_ROOT_INVALID");
  const matches = names.filter((name) => name.startsWith(`${context.execution_authorization_id}.`));
  if (matches.length !== 1) reject("MONITOR_EGRESS_RECOVERY_MISSING");
  const stored = await trustedJson(path.join(paths.recoveries, matches[0]), 0o400, 0, 0, validateRecoveryPlan, "MONITOR_EGRESS_RECOVERY_INVALID");
  if (!stored || stored.value.original_operation_id !== context.operation_id || stored.value.original_authorization_sha256 !== context.original_authorization_sha256
    || stored.value.execution_authorization_sha256 !== context.execution_authorization_sha256 || stored.value.intent_sha256 !== context.expected_intent_sha256) reject("MONITOR_EGRESS_RECOVERY_BINDING_INVALID");
  return stored.value;
}

async function quarantineIntent(context, intent, paths, plan) {
  const body = {
    schema_version: 1,
    contract: NOTIFIER_EGRESS_QUARANTINE_CONTRACT,
    status: "QUARANTINED",
    quarantined_at: plan.prepared_at,
    original_operation_id: intent.operation_id,
    intent_sha256: intent.intent_sha256,
    recovery_sha256: plan.recovery_sha256,
    reason: plan.reason,
    preservation: "FILES_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE_OR_NETWORK_CHANGE",
  };
  const value = Object.freeze({ ...body, quarantine_sha256: monitoringSha256(body) });
  const validator = (input) => {
    exactKeys(input, [...Object.keys(body), "quarantine_sha256"], "MONITOR_EGRESS_QUARANTINE_INVALID");
    if (canonicalMonitoringJson(input) !== canonicalMonitoringJson(value)) reject("MONITOR_EGRESS_QUARANTINE_INVALID");
    return input;
  };
  const raw = Buffer.from(canonicalMonitoringJson(value)), file = path.join(paths.quarantine, `${intent.operation_id}.${value.quarantine_sha256}.json`);
  await ensureRawFile(file, raw, 0o400, 0, 0, validator, "MONITOR_EGRESS_QUARANTINE_CONFLICT");
  await syncDirectory(paths.quarantine, "MONITOR_EGRESS_QUARANTINE_SYNC_FAILED");
  return Object.freeze({ result: "QUARANTINED", operation_id: intent.operation_id, intent_sha256: intent.intent_sha256, recovery_sha256: plan.recovery_sha256, quarantine_sha256: value.quarantine_sha256 });
}

async function executeRecoveryPhase(context, phase, options) {
  let paths = await layout(options.filesystemRoot, false, context.operation_id);
  const intent = await loadIntent(context, paths);
  const plan = await loadRecoveryPlan(context, paths);
  if (plan.decision === "QUARANTINE") return quarantineIntent(context, intent, paths, plan);
  paths = await recoveryPaths(paths, intent);
  if (plan.decision === "ALREADY_COMMITTED") {
    const state = await candidateState(paths, intent);
    if (!state.committed) reject("MONITOR_EGRESS_RECOVERY_DECISION_INVALID");
    return Object.freeze({ ...phaseResult("ALREADY_COMMITTED", intent), recovery_sha256: plan.recovery_sha256 });
  }
  const result = phase === "recover-apply"
    ? await applyIntent(context, intent, paths, options, true)
    : await finalizeIntent(context, intent, paths, options, true);
  return Object.freeze({ ...result, recovery_sha256: plan.recovery_sha256 });
}

export async function runNotifierEgressActivationPhase(contextInput, phase, options = {}) {
  const context = validateNotifierEgressActivationContext(contextInput);
  const resolved = {
    filesystemRoot: path.resolve(options.filesystemRoot || "/"),
    siteRoot: path.resolve(options.siteRoot || SITE_ROOT),
    effectiveUnitSha256: options.effectiveUnitSha256 || null,
    fault: options.fault,
  };
  if (phase === "prepare") {
    if (context.execution_mode !== "ORIGINAL") reject("MONITOR_EGRESS_PHASE_INVALID");
    return prepareOriginal(context, resolved);
  }
  if (phase === "recover-prepare") {
    if (context.execution_mode !== "RECOVERY") reject("MONITOR_EGRESS_PHASE_INVALID");
    return prepareRecovery(context, resolved);
  }
  if (new Set(["recover-apply", "recover-finalize"]).has(phase)) {
    if (context.execution_mode !== "RECOVERY") reject("MONITOR_EGRESS_PHASE_INVALID");
    return executeRecoveryPhase(context, phase, resolved);
  }
  const paths = await layout(resolved.filesystemRoot, false), intent = await loadIntent(context, paths);
  if (phase === "apply") {
    if (context.execution_mode !== "ORIGINAL") reject("MONITOR_EGRESS_PHASE_INVALID");
    return applyIntent(context, intent, paths, resolved);
  }
  if (phase === "finalize") {
    if (context.execution_mode !== "ORIGINAL") reject("MONITOR_EGRESS_PHASE_INVALID");
    return finalizeIntent(context, intent, paths, resolved);
  }
  reject("MONITOR_EGRESS_PHASE_INVALID");
}

function assertSupervisorControl(context, phase) {
  const consumed = new Set(["apply", "finalize", "recover-apply", "recover-finalize"]).has(phase) ? "YES" : "NO";
  if (process.getuid?.() !== 0 || process.env.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES" || process.env.ERP_RELEASE_GATE_LOCK_HELD !== "YES"
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED !== consumed
    || process.env.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256 !== context.supervisor_bundle_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256 !== context.execution_authorization_sha256
    || process.env.ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED !== (context.execution_mode === "RECOVERY" ? "YES" : "NO")
    || process.env.ERP_RELEASE_SUPERVISOR_SITE_ROOT !== SITE_ROOT) reject("MONITOR_EGRESS_SUPERVISOR_CONTROL_INVALID");
  const bundleRoot = path.dirname(SITE_ROOT), supervisorBundleRoot = "/usr/local/libexec/chenyida-erp-release-supervisor/bundles";
  if (path.dirname(bundleRoot) !== supervisorBundleRoot || path.basename(bundleRoot) !== context.supervisor_bundle_sha256) reject("MONITOR_EGRESS_SUPERVISOR_CONTROL_INVALID");
  const descriptorText = process.env.ERP_RELEASE_GATE_LOCK_FD;
  if (!/^(?:[3-9]|[1-5][0-9]|6[0-3])$/u.test(descriptorText || "")) reject("MONITOR_EGRESS_GLOBAL_LOCK_INVALID");
  const descriptor = Number(descriptorText);
  let opened, named, lockLines;
  try {
    opened = fstatSync(descriptor, { bigint: true }); named = lstatSync(GLOBAL_RELEASE_LOCK, { bigint: true });
    lockLines = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8").split("\n").filter((line) => line.startsWith("lock:"));
  } catch { reject("MONITOR_EGRESS_GLOBAL_LOCK_INVALID"); }
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || named.uid !== 0n || named.gid !== 0n || named.nlink !== 1n || modeOf(named) !== 0o600
    || opened.dev !== named.dev || opened.ino !== named.ino || lockLines.length !== 1 || !/^lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ /u.test(lockLines[0])) reject("MONITOR_EGRESS_GLOBAL_LOCK_INVALID");
}

async function readContext() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 256 * 1024) reject("MONITOR_EGRESS_CONTEXT_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return parseStrictMonitoringJson(Buffer.concat(chunks).toString("utf8"), 256 * 1024); }
  catch { reject("MONITOR_EGRESS_CONTEXT_INVALID"); }
}

async function main(argumentsList) {
  const confirmations = {
    prepare: "PREPARE_NOTIFIER_EGRESS_ACTIVATION_INTENT",
    apply: "APPLY_NOTIFIER_EGRESS_AFTER_AUTHORIZATION",
    finalize: "FINALIZE_NOTIFIER_EGRESS_AFTER_EFFECTIVE_VERIFICATION",
    "recover-prepare": "PREPARE_NOTIFIER_EGRESS_ACTIVATION_RECOVERY",
    "recover-apply": "APPLY_NOTIFIER_EGRESS_ACTIVATION_RECOVERY_AFTER_AUTHORIZATION",
    "recover-finalize": "FINALIZE_NOTIFIER_EGRESS_ACTIVATION_RECOVERY_AFTER_EFFECTIVE_VERIFICATION",
  };
  if (argumentsList.length !== 2 || confirmations[argumentsList[0]] !== argumentsList[1]) reject("MONITOR_EGRESS_USAGE_INVALID");
  const context = validateNotifierEgressActivationContext(await readContext());
  assertSupervisorControl(context, argumentsList[0]);
  const effectiveUnitSha256 = new Set(["finalize", "recover-finalize"]).has(argumentsList[0])
    ? process.env.ERP_MONITORING_NOTIFIER_EGRESS_EFFECTIVE_UNIT_SHA256
    : null;
  process.stdout.write(canonicalMonitoringJson(await runNotifierEgressActivationPhase(context, argumentsList[0], { effectiveUnitSha256 })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "MONITOR_EGRESS_FAILED"}\n`);
    process.exitCode = 1;
  });
}
