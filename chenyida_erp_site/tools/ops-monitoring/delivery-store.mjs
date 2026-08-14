import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { OpsMonitoringError, canonicalMonitoringJson, monitoringSha256, parseMonitoringJson } from "./contract.mjs";
import {
  MONITORING_DELIVERY_ACK_CONTRACT,
  MONITORING_DELIVERY_ATTEMPT_CONTRACT,
  MONITORING_DELIVERY_CLAIM_CONTRACT,
  MONITORING_DELIVERY_READINESS_CONTRACT,
  MONITORING_DELIVERY_RESULT_CONTRACT,
  ZERO_SHA256,
  validateDeliveryAck,
  validateDeliveryAttempt,
  validateDeliveryClaim,
  validateDeliveryEnvelope,
  validateDeliveryGrant,
  validateDeliveryReadiness,
  validateDeliveryResult,
  validateMonitoringNotifierConfig,
} from "./delivery-contract.mjs";

export const MONITORING_OUTBOX_MARKER = ".chenyida-erp-monitoring-outbox-v1";
export const MONITORING_OUTBOX_MARKER_VALUE = "chenyida-erp-monitoring-outbox/v1\n";
export const MONITORING_DELIVERY_MARKER = ".chenyida-erp-monitoring-delivery-v1";
export const MONITORING_DELIVERY_MARKER_VALUE = "chenyida-erp-monitoring-delivery/v1\n";

const SHA256 = /^[0-9a-f]{64}$/;
const PREPARED_FILE = /^\.prepare\.([0-9a-f]{64})\.([0-9a-f]{32})\.tmp$/;
const FILE_LIMIT = 4096;
const FILE_BYTES = 64 * 1024;
const OUTBOX_DIRECTORIES = Object.freeze(["events", "grants"]);
const DELIVERY_DIRECTORIES = Object.freeze(["claims", "attempts", "results", "acks", "readiness"]);

function reject(code) {
  throw new OpsMonitoringError(code);
}

function owner() {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid < 0 || gid < 0) reject("MONITOR_DELIVERY_IDENTITY_UNAVAILABLE");
  return { uid, gid };
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

function ownershipMatches(metadata, expected) {
  if (expected === null) return true;
  return metadata.uid === expected.uid && metadata.gid === expected.gid;
}

async function safeDirectory(directory, { mode, expectedOwner = owner(), code }) {
  const resolved = path.resolve(directory);
  if (directory !== resolved || resolved === path.parse(resolved).root || await realpath(resolved).catch(() => "") !== resolved) reject(code);
  const metadata = await lstat(resolved).catch(() => reject(code));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o7777) !== mode || !ownershipMatches(metadata, expectedOwner)) reject(code);
  return resolved;
}

async function safeFile(file, { mode, expectedOwner = owner(), maximumBytes = FILE_BYTES, code }) {
  const before = await lstat(file).catch(() => reject(code));
  if (!before.isFile() || before.isSymbolicLink() || ![1, 2].includes(before.nlink) || (before.mode & 0o7777) !== mode || !ownershipMatches(before, expectedOwner) || before.size < 2 || before.size > maximumBytes) reject(code);
  if (before.nlink === 2 && !await hasPreparedHardlink(file, before, mode, expectedOwner)) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) reject(`${code}_CHANGED`);
    const raw = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(file).catch(() => null);
    if (!pathAfter || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || ![1, 2].includes(pathAfter.nlink) || (pathAfter.mode & 0o7777) !== mode || !ownershipMatches(pathAfter, expectedOwner)) reject(`${code}_CHANGED`);
    if (pathAfter.nlink === 2 && !await hasPreparedHardlink(file, pathAfter, mode, expectedOwner, createHash("sha256").update(raw).digest("hex"))) reject(`${code}_CHANGED`);
    return raw;
  } finally {
    await handle.close();
  }
}

async function hasPreparedHardlink(file, metadata, mode, expectedOwner, expectedRawSha256 = null) {
  const matches = [];
  for (const filename of await readdir(path.dirname(file))) {
    const match = PREPARED_FILE.exec(filename);
    if (!match || expectedRawSha256 !== null && match[1] !== expectedRawSha256) continue;
    const candidate = await lstat(path.join(path.dirname(file), filename)).catch(() => null);
    if (candidate && candidate.isFile() && !candidate.isSymbolicLink() && candidate.dev === metadata.dev && candidate.ino === metadata.ino && candidate.nlink === 2 && (candidate.mode & 0o7777) === mode && ownershipMatches(candidate, expectedOwner)) matches.push(filename);
  }
  return matches.length === 1;
}

async function cleanupPreparedFiles(directory, { mode, expectedOwner, code }) {
  let changed = false;
  for (const filename of await readdir(directory)) {
    if (!PREPARED_FILE.test(filename)) continue;
    const file = path.join(directory, filename);
    const metadata = await lstat(file).catch(() => reject(`${code}_PREPARED_INVALID`));
    if (!metadata.isFile() || metadata.isSymbolicLink() || ![1, 2].includes(metadata.nlink) || (metadata.mode & 0o7777) !== mode || !ownershipMatches(metadata, expectedOwner) || metadata.size > FILE_BYTES) reject(`${code}_PREPARED_INVALID`);
    await unlink(file).catch(() => reject(`${code}_PREPARED_RECOVERY_FAILED`));
    changed = true;
  }
  if (changed) await syncDirectory(directory);
}

async function writeNoReplace(directory, filename, value, { mode = 0o400, expectedOwner = owner(), code = "MONITOR_DELIVERY_WRITE_FAILED" } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,220}$/.test(filename)) reject(code);
  const file = path.join(directory, filename);
  const raw = canonicalMonitoringJson(value);
  if (Buffer.byteLength(raw) > FILE_BYTES) reject(code);
  await cleanupPreparedFiles(directory, { mode, expectedOwner, code });
  const rawSha256 = createHash("sha256").update(raw).digest("hex");
  const prepared = path.join(directory, `.prepare.${rawSha256}.${randomBytes(16).toString("hex")}.tmp`);
  let handle;
  let preparedExists = false;
  try {
    handle = await open(prepared, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    preparedExists = true;
    await handle.writeFile(raw, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncDirectory(directory);
    await link(prepared, file);
    await syncDirectory(directory);
    await unlink(prepared);
    preparedExists = false;
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (preparedExists) await unlink(prepared).catch(() => undefined);
    if (error?.code === "EEXIST") {
      const existing = await safeFile(file, { mode, expectedOwner, maximumBytes: FILE_BYTES, code });
      if (existing === raw) return file;
      reject(`${code}_COLLISION`);
    }
    if (error instanceof OpsMonitoringError) throw error;
    reject(code);
  }
  return file;
}

async function writeCurrent(directory, filename, value, { mode = 0o400, expectedOwner = owner(), code = "MONITOR_DELIVERY_WRITE_FAILED" } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,220}$/.test(filename)) reject(code);
  const file = path.join(directory, filename);
  const raw = canonicalMonitoringJson(value);
  if (Buffer.byteLength(raw) > FILE_BYTES) reject(code);
  await cleanupPreparedFiles(directory, { mode, expectedOwner, code });
  const rawSha256 = createHash("sha256").update(raw).digest("hex");
  const prepared = path.join(directory, `.prepare.${rawSha256}.${randomBytes(16).toString("hex")}.tmp`);
  let handle;
  let preparedExists = false;
  try {
    handle = await open(prepared, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    preparedExists = true;
    await handle.writeFile(raw, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncDirectory(directory);
    await rename(prepared, file);
    preparedExists = false;
    await syncDirectory(directory);
    const stored = await safeFile(file, { mode, expectedOwner, maximumBytes: FILE_BYTES, code });
    if (stored !== raw) reject(`${code}_VERIFY_FAILED`);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (preparedExists) await unlink(prepared).catch(() => undefined);
    if (error instanceof OpsMonitoringError) throw error;
    reject(code);
  }
  return file;
}

async function initializeRoot(root, marker, markerValue, directories, mode) {
  const resolved = path.resolve(root);
  const current = owner();
  if (root !== resolved || resolved === path.parse(resolved).root) reject("MONITOR_DELIVERY_ROOT_INVALID");
  const parent = path.dirname(resolved);
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || parentMetadata.uid !== current.uid || parentMetadata.gid !== current.gid || (parentMetadata.mode & 0o022) !== 0) reject("MONITOR_DELIVERY_PARENT_UNSAFE");
  await mkdir(resolved, { mode });
  for (const directory of directories) await mkdir(path.join(resolved, directory), { mode });
  const handle = await open(path.join(resolved, marker), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
  try { await handle.writeFile(markerValue, "utf8"); await handle.chmod(0o400); await handle.sync(); } finally { await handle.close(); }
  for (const directory of directories) await syncDirectory(path.join(resolved, directory));
  await syncDirectory(resolved);
  return resolved;
}

export async function initializeMonitoringOutbox(root, mode = 0o700) {
  return initializeRoot(root, MONITORING_OUTBOX_MARKER, MONITORING_OUTBOX_MARKER_VALUE, OUTBOX_DIRECTORIES, mode);
}

export async function initializeMonitoringDeliveryRoot(root, mode = 0o700) {
  return initializeRoot(root, MONITORING_DELIVERY_MARKER, MONITORING_DELIVERY_MARKER_VALUE, DELIVERY_DIRECTORIES, mode);
}

async function validateRoot(root, { kind, rootMode = 0o700, rootOwner = owner(), fileOwner = rootOwner } = {}) {
  const outbox = kind === "outbox";
  const marker = outbox ? MONITORING_OUTBOX_MARKER : MONITORING_DELIVERY_MARKER;
  const markerValue = outbox ? MONITORING_OUTBOX_MARKER_VALUE : MONITORING_DELIVERY_MARKER_VALUE;
  const directories = outbox ? OUTBOX_DIRECTORIES : DELIVERY_DIRECTORIES;
  const resolved = await safeDirectory(root, { mode: rootMode, expectedOwner: rootOwner, code: "MONITOR_DELIVERY_ROOT_UNSAFE" });
  const markerRaw = await safeFile(path.join(resolved, marker), { mode: 0o400, expectedOwner: rootOwner, maximumBytes: 256, code: "MONITOR_DELIVERY_MARKER_UNSAFE" });
  if (markerRaw !== markerValue) reject("MONITOR_DELIVERY_MARKER_INVALID");
  const entries = await readdir(resolved, { withFileTypes: true });
  const expected = new Set([marker, ...directories]);
  if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry.name) || entry.isSymbolicLink() || (entry.name === marker ? !entry.isFile() : !entry.isDirectory()))) reject("MONITOR_DELIVERY_ROOT_ENTRY_INVALID");
  for (const directory of directories) {
    await safeDirectory(path.join(resolved, directory), { mode: rootMode, expectedOwner: fileOwner, code: "MONITOR_DELIVERY_DIRECTORY_UNSAFE" });
    const files = await readdir(path.join(resolved, directory), { withFileTypes: true });
    const published = files.filter((entry) => !PREPARED_FILE.test(entry.name));
    const prepared = files.filter((entry) => PREPARED_FILE.test(entry.name));
    if (published.length > FILE_LIMIT || prepared.length > 64 || files.some((entry) => !entry.isFile() || entry.isSymbolicLink())) reject("MONITOR_DELIVERY_DIRECTORY_ENTRY_INVALID");
  }
  return resolved;
}

export async function publishDeliveryEnvelope(root, value, options = {}) {
  const envelope = validateDeliveryEnvelope(value);
  const resolved = await validateRoot(root, { kind: "outbox", ...options });
  await writeNoReplace(path.join(resolved, "events"), `${envelope.event_id}.json`, envelope, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_OUTBOX_EVENT_WRITE_FAILED" });
  return envelope;
}

export async function publishDeliveryGrant(root, value, options = {}) {
  const grant = validateDeliveryGrant(value);
  const resolved = await validateRoot(root, { kind: "outbox", ...options });
  await writeNoReplace(path.join(resolved, "grants"), `${grant.event_id}.json`, grant, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_OUTBOX_GRANT_WRITE_FAILED" });
  return grant;
}

async function readJsonDirectory(directory, { pattern, mode = 0o400, expectedOwner = owner(), validator, code }) {
  const entries = (await readdir(directory)).filter((filename) => !PREPARED_FILE.test(filename)).sort();
  if (entries.length > FILE_LIMIT) reject(`${code}_LIMIT_EXCEEDED`);
  const values = [];
  for (const filename of entries) {
    if (!pattern.test(filename)) reject(`${code}_FILENAME_INVALID`);
    const raw = await safeFile(path.join(directory, filename), { mode, expectedOwner, maximumBytes: FILE_BYTES, code: `${code}_FILE_INVALID` });
    let value;
    try { value = validator(parseMonitoringJson(raw, FILE_BYTES)); } catch (error) { if (error instanceof OpsMonitoringError) throw error; reject(`${code}_JSON_INVALID`); }
    if (raw !== canonicalMonitoringJson(value)) reject(`${code}_NOT_CANONICAL`);
    values.push(value);
  }
  return values;
}

export async function readDeliveryEnvelopes(root, options = {}) {
  const resolved = await validateRoot(root, { kind: "outbox", ...options });
  const values = await readJsonDirectory(path.join(resolved, "events"), { pattern: /^[0-9a-f]{64}\.json$/, mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), validator: validateDeliveryEnvelope, code: "MONITOR_OUTBOX_EVENT" });
  return values.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.event_id.localeCompare(right.event_id));
}

export async function readDeliveryGrants(root, options = {}) {
  const resolved = await validateRoot(root, { kind: "outbox", ...options });
  return readJsonDirectory(path.join(resolved, "grants"), { pattern: /^[0-9a-f]{64}\.json$/, mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), validator: validateDeliveryGrant, code: "MONITOR_OUTBOX_GRANT" });
}

async function readLedger(root, type, options = {}) {
  const resolved = await validateRoot(root, { kind: "delivery", ...options });
  const definitions = {
    claims: [/^[0-9a-f]{64}\.[0-9]{1,2}\.json$/, validateDeliveryClaim],
    attempts: [/^[0-9a-f]{64}\.[0-9]{1,2}\.json$/, validateDeliveryAttempt],
    results: [/^[0-9a-f]{64}\.[0-9]{1,2}\.json$/, validateDeliveryResult],
    acks: [/^[0-9a-f]{64}\.json$/, validateDeliveryAck],
    readiness: [/^current\.json$/, validateDeliveryReadiness],
  };
  const [pattern, validator] = definitions[type];
  return { resolved, values: await readJsonDirectory(path.join(resolved, type), { pattern, mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), validator, code: `MONITOR_DELIVERY_${type.toUpperCase()}` }) };
}

export async function prepareDeliveryAttempt({ root, envelope, notifierConfig, now = new Date(), options = {} }) {
  validateDeliveryEnvelope(envelope);
  const config = validateMonitoringNotifierConfig(notifierConfig);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) reject("MONITOR_DELIVERY_TIME_INVALID");
  const configSha = monitoringSha256(config);
  if (envelope.target_id !== config.notification.target_id || envelope.target_generation !== config.notification.target_generation) reject("MONITOR_DELIVERY_TARGET_MIGRATION_REQUIRED");
  const { resolved, values: attempts } = await readLedger(root, "attempts", options);
  const { values: claims } = await readLedger(root, "claims", options);
  const { values: results } = await readLedger(root, "results", options);
  const { values: acks } = await readLedger(root, "acks", options);
  if (acks.some((ack) => ack.event_id === envelope.event_id)) reject("MONITOR_DELIVERY_ALREADY_ACKNOWLEDGED");
  const eventAttempts = attempts.filter((attempt) => attempt.event_id === envelope.event_id).sort((left, right) => left.attempt_no - right.attempt_no);
  const eventClaims = claims.filter((claim) => claim.event_id === envelope.event_id).sort((left, right) => left.attempt_no - right.attempt_no);
  const maximumAttempt = Math.max(0, ...eventAttempts.map((entry) => entry.attempt_no), ...eventClaims.map((entry) => entry.attempt_no));
  const latestClaim = eventClaims.at(-1);
  const latestResult = eventAttempts.length ? results.find((result) => result.attempt_id === eventAttempts.at(-1).attempt_id) : null;
  if (latestClaim && !latestResult && Date.parse(latestClaim.lease_expires_at) > now.getTime()) reject("MONITOR_DELIVERY_CLAIM_ACTIVE");
  if (latestResult && now.getTime() < Date.parse(latestResult.recorded_at) + config.notification.ack.retry_backoff_seconds * 1000) reject("MONITOR_DELIVERY_BACKOFF_ACTIVE");
  const attemptNo = maximumAttempt + 1;
  if (attemptNo > config.notification.ack.max_attempts) reject("MONITOR_DELIVERY_ATTEMPT_LIMIT_REACHED");
  const previousAttemptSha256 = eventAttempts.length ? eventAttempts.at(-1).attempt_id : ZERO_SHA256;
  const binding = {
    event_id: envelope.event_id,
    envelope_id: envelope.envelope_id,
    attempt_no: attemptNo,
    target_id: config.notification.target_id,
    target_generation: config.notification.target_generation,
    notifier_config_sha256: configSha,
    credential_sha256: config.notification.credential.sha256,
    credential_generation: config.notification.credential.generation,
    idempotency_key: envelope.event_id,
  };
  const claimedAt = now.toISOString();
  const claim = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_CLAIM_CONTRACT,
    claim_id: "",
    ...binding,
    claimed_at: claimedAt,
    lease_expires_at: new Date(now.getTime() + config.notification.ack.claim_ttl_seconds * 1000).toISOString(),
    previous_attempt_sha256: previousAttemptSha256,
  };
  claim.claim_id = monitoringSha256({ ...claim, claim_id: undefined });
  validateDeliveryClaim(claim);
  await writeNoReplace(path.join(resolved, "claims"), `${envelope.event_id}.${attemptNo}.json`, claim, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_DELIVERY_CLAIM_WRITE_FAILED" });
  const attempt = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_ATTEMPT_CONTRACT,
    attempt_id: "",
    claim_id: claim.claim_id,
    ...binding,
    prepared_at: claimedAt,
    previous_attempt_sha256: previousAttemptSha256,
    adapter_id: config.notification.adapter.id,
    adapter_version: config.notification.adapter.version,
    adapter_sha256: config.notification.adapter.source_sha256,
  };
  attempt.attempt_id = monitoringSha256({ ...attempt, attempt_id: undefined });
  validateDeliveryAttempt(attempt);
  await writeNoReplace(path.join(resolved, "attempts"), `${envelope.event_id}.${attemptNo}.json`, attempt, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_DELIVERY_ATTEMPT_WRITE_FAILED" });
  return Object.freeze({ claim: Object.freeze(claim), attempt: Object.freeze(attempt) });
}

export async function recordDeliveryResult(root, value, options = {}) {
  const result = validateDeliveryResult(value);
  const resolved = await validateRoot(root, { kind: "delivery", ...options });
  const attemptNo = options.attemptNo;
  if (!Number.isSafeInteger(attemptNo) || attemptNo < 1 || attemptNo > 32) reject("MONITOR_DELIVERY_RESULT_ATTEMPT_INVALID");
  await writeNoReplace(path.join(resolved, "results"), `${result.event_id}.${attemptNo}.json`, result, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_DELIVERY_RESULT_WRITE_FAILED" });
  return result;
}

export async function recordDeliveryAck(root, value, options = {}) {
  const ack = validateDeliveryAck(value);
  const resolved = await validateRoot(root, { kind: "delivery", ...options });
  await writeNoReplace(path.join(resolved, "acks"), `${ack.event_id}.json`, ack, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_DELIVERY_ACK_WRITE_FAILED" });
  return ack;
}

export async function recordDeliveryReadiness(root, value, options = {}) {
  const readiness = validateDeliveryReadiness(value);
  const resolved = await validateRoot(root, { kind: "delivery", ...options });
  await writeCurrent(path.join(resolved, "readiness"), "current.json", readiness, { mode: options.fileMode ?? 0o400, expectedOwner: options.fileOwner ?? owner(), code: "MONITOR_DELIVERY_READINESS_WRITE_FAILED" });
  return readiness;
}

export async function readDeliveryAcks(root, options = {}) {
  return (await readLedger(root, "acks", options)).values;
}

export async function readDeliveryAttempts(root, options = {}) {
  return (await readLedger(root, "attempts", options)).values;
}

export async function readDeliveryClaims(root, options = {}) {
  return (await readLedger(root, "claims", options)).values;
}

export async function readDeliveryResults(root, options = {}) {
  return (await readLedger(root, "results", options)).values;
}

export async function readDeliveryReadiness(root, notifierConfigSha256, options = {}) {
  if (!SHA256.test(notifierConfigSha256 || "")) reject("MONITOR_DELIVERY_READINESS_DIGEST_INVALID");
  const values = (await readLedger(root, "readiness", options)).values;
  if (values.length > 1) reject("MONITOR_DELIVERY_READINESS_CONFLICT");
  return values[0]?.notifier_config_sha256 === notifierConfigSha256 ? values[0] : null;
}
