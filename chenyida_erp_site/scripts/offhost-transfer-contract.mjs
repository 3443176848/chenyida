import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  parseStrictJson,
  sha256File,
  validateManifest,
  validateReceipt,
  verifyOffhostBackup,
} from "./backup-recovery-contract.mjs";

export const OFFHOST_TRANSFER_CONTRACT = "chenyida-erp-offhost-transfer/v1";
export const OFFHOST_RECEIPT_CONTRACT = "chenyida-erp-offhost-transfer-receipt/v1";
export const OFFHOST_ACCEPTANCE_CONTRACT = "chenyida-erp-offhost-transfer-acceptance/v1";
export const OFFHOST_MATERIALIZATION_CONTRACT = "chenyida-erp-offhost-materialization/v1";
export const OUTBOX_ROOT_MARKER = ".chenyida-erp-transfer-outbox-v1";
export const OUTBOX_ROOT_MARKER_VALUE = "chenyida-erp-transfer-outbox/v1\n";
export const RECEIVER_ROOT_MARKER = ".chenyida-erp-transfer-receiver-v1";
export const RECEIVER_ROOT_MARKER_VALUE = "chenyida-erp-transfer-receiver/v1\n";
export const KEY_ROOT_MARKER = ".chenyida-erp-offhost-key-root-v1";
export const KEY_ROOT_MARKER_VALUE = "chenyida-erp-offhost-key-root/v1\n";
export const OFFHOST_MATERIALIZATION_ROOT_MARKER = ".chenyida-erp-offhost-root-v2";
export const OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE = "chenyida-erp-offhost-root/v2\n";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const INNER_FILES = Object.freeze([
  "attachments.tar.gz",
  "backup-status.tar.gz",
  "manifest.json",
  "migrations.txt",
  "postgresql.dump",
  "reconciliation.json",
  "uploads.tar.gz",
]);
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export class OffhostTransferError extends Error {
  constructor(code) {
    super(code);
    this.name = "OffhostTransferError";
    this.code = code;
  }
}

function reject(code) {
  throw new OffhostTransferError(code);
}

function object(value, code = "OBJECT_REQUIRED") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code = "UNKNOWN_OR_MISSING_FIELD") {
  const actual = Object.keys(object(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function boundedString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) reject(code);
  return value;
}

function iso(value, code) {
  boundedString(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function bufferFromBase64(value, expectedBytes, code) {
  boundedString(value, BASE64, code);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) reject(code);
  return decoded;
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) reject("CANONICAL_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  reject("CANONICAL_VALUE_INVALID");
}

export function canonicalTransferJson(value) {
  return `${canonicalValue(value)}\n`;
}

export function transferSha256(value) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : canonicalTransferJson(value));
  return createHash("sha256").update(source).digest("hex");
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function safeDirectory(directoryPath, code = "DIRECTORY_UNSAFE") {
  const metadata = await lstat(directoryPath).catch(() => reject(code));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o022) !== 0) reject(code);
  return metadata;
}

async function safeRegularFile(file, { maxBytes = Number.MAX_SAFE_INTEGER, allowEmpty = false, ownerOnly = false, code = "FILE_UNSAFE" } = {}) {
  const metadata = await lstat(file).catch(() => reject(code));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.()
    || (!allowEmpty && metadata.size <= 0) || metadata.size > maxBytes || (metadata.mode & 0o022) !== 0
    || (ownerOnly && ![0o400, 0o600].includes(metadata.mode & 0o777))) reject(code);
  return metadata;
}

async function safeReadRecord(file, options = {}) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(options.code || "FILE_UNSAFE"));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.()
      || (!options.allowEmpty && before.size <= 0) || before.size > (options.maxBytes ?? Number.MAX_SAFE_INTEGER)
      || (before.mode & 0o022) !== 0 || (options.ownerOnly && ![0o400, 0o600].includes(before.mode & 0o777))) reject(options.code || "FILE_UNSAFE");
    const value = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) reject("FILE_CHANGED_DURING_READ");
    const pointed = await lstat(file).catch(() => reject("FILE_CHANGED_DURING_READ"));
    if (pointed.dev !== after.dev || pointed.ino !== after.ino || pointed.size !== after.size || pointed.mtimeMs !== after.mtimeMs) reject("FILE_CHANGED_DURING_READ");
    return { value, identity: `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${transferSha256(value)}` };
  } finally {
    await handle.close();
  }
}

async function safeRead(file, options = {}) {
  return (await safeReadRecord(file, options)).value;
}

async function safeJson(file, code = "JSON_FILE_INVALID") {
  const source = await safeRead(file, { maxBytes: MAX_JSON_BYTES, code });
  try {
    return parseStrictJson(source.toString("utf8"));
  } catch (error) {
    if (error?.code === "JSON_DUPLICATE_KEY") reject("JSON_DUPLICATE_KEY");
    reject(code);
  }
}

async function safeCanonicalJson(file, code = "JSON_FILE_INVALID") {
  const source = await safeRead(file, { maxBytes: MAX_JSON_BYTES, code });
  let value;
  try { value = parseStrictJson(source.toString("utf8")); } catch (error) {
    if (error?.code === "JSON_DUPLICATE_KEY") reject("JSON_DUPLICATE_KEY");
    reject(code);
  }
  if (source.toString("utf8") !== canonicalTransferJson(value)) reject("JSON_NOT_CANONICAL");
  return value;
}

async function syncDirectory(directoryPath) {
  const handle = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncFile(file) {
  await safeRegularFile(file, { allowEmpty: true });
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function durableTree(root) {
  await safeDirectory(root);
  const stack = [[path.resolve(root), false]];
  while (stack.length > 0) {
    const [current, visited] = stack.pop();
    if (visited) { await syncDirectory(current); continue; }
    await safeDirectory(current);
    stack.push([current, true]);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push([child, false]);
      else if (entry.isFile() && !entry.isSymbolicLink()) await syncFile(child);
      else reject("TREE_ENTRY_UNSAFE");
    }
  }
  await syncDirectory(path.dirname(path.resolve(root)));
}

async function atomicNoClobberJson(file, value, mode, conflictCode) {
  const parent = path.dirname(path.resolve(file));
  await safeDirectory(parent, "OUTPUT_ROOT_UNSAFE");
  const source = canonicalTransferJson(value);
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    await handle.writeFile(source, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = null;
    try { await link(temporary, file); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    await syncDirectory(parent);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
  const existing = await safeRead(file, { maxBytes: MAX_JSON_BYTES, code: conflictCode });
  if (existing.toString("utf8") !== source) reject(conflictCode);
  return file;
}

async function writeExclusiveFile(file, source, mode = 0o600) {
  const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try {
    await handle.writeFile(source);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function validateDedicatedRoot(root, markerName, markerValue, code) {
  const resolved = path.resolve(root);
  const metadata = await safeDirectory(resolved, code);
  if (![0o700, 0o750, 0o2750].includes(metadata.mode & 0o7777)) reject(code);
  const marker = path.join(resolved, markerName);
  const markerMetadata = await safeRegularFile(marker, { maxBytes: 256, ownerOnly: true, code });
  if (markerMetadata.uid !== metadata.uid || (await safeRead(marker, { maxBytes: 256, ownerOnly: true, code })).toString("utf8") !== markerValue) reject(code);
  return resolved;
}

async function acquireFilesystemLock(root, name) {
  const lockFile = path.join(root, name);
  let created = false;
  try {
    const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile("chenyida-erp-offhost-operation-lock/v1\n", "utf8");
      await handle.chmod(0o600);
      await handle.sync();
      created = true;
    } finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== "EEXIST") reject("OPERATION_LOCK_UNSAFE");
  }
  if (created) await syncDirectory(root);
  const metadata = await safeRegularFile(lockFile, { maxBytes: 256, ownerOnly: true, code: "OPERATION_LOCK_UNSAFE" });
  const child = spawn("flock", ["-n", lockFile, "sh", "-c", "printf 'LOCKED\\n'; IFS= read -r release"], {
    env: { PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const acquired = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.once("error", () => finish(false));
    child.once("close", () => finish(false));
    child.stdout.once("data", (chunk) => finish(chunk.toString("utf8") === "LOCKED\n"));
  });
  if (!acquired) {
    child.kill("SIGKILL");
    reject("OPERATION_LOCK_BUSY");
  }
  return async () => {
    child.stdin.end("release\n");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("close", resolve));
    const after = await safeRegularFile(lockFile, { maxBytes: 256, ownerOnly: true, code: "OPERATION_LOCK_UNSAFE" });
    if (after.dev !== metadata.dev || after.ino !== metadata.ino) reject("OPERATION_LOCK_CHANGED");
  };
}

async function validateKeyFile(keyRoot, file, expectedType, visibility) {
  const resolvedRoot = await validateDedicatedRoot(keyRoot, KEY_ROOT_MARKER, KEY_ROOT_MARKER_VALUE, "KEY_ROOT_UNSAFE");
  const rootMetadata = await lstat(resolvedRoot);
  if ((rootMetadata.mode & 0o7777) !== 0o700) reject("KEY_ROOT_UNSAFE");
  const resolvedFile = path.resolve(file);
  if (!isInside(resolvedFile, resolvedRoot) || resolvedFile === path.join(resolvedRoot, KEY_ROOT_MARKER)) reject("KEY_FILE_OUTSIDE_ROOT");
  let cursor = path.dirname(resolvedFile);
  while (true) {
    await safeDirectory(cursor, "KEY_ANCESTOR_UNSAFE");
    if (cursor === resolvedRoot) break;
    const parent = path.dirname(cursor);
    if (parent === cursor || !isInside(parent, resolvedRoot)) reject("KEY_ANCESTOR_UNSAFE");
    cursor = parent;
  }
  const record = await safeReadRecord(resolvedFile, { maxBytes: 64 * 1024, ownerOnly: true, code: "KEY_FILE_UNSAFE" });
  const source = record.value;
  let key;
  try { key = visibility === "private" ? createPrivateKey(source) : createPublicKey(source); } catch { reject("KEY_PARSE_FAILED"); }
  if (key.asymmetricKeyType !== expectedType || (visibility === "private" && key.type !== "private") || (visibility === "public" && key.type !== "public")) reject("KEY_TYPE_INVALID");
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  return { key, file: resolvedFile, identity: record.identity, fingerprint: publicKeyFingerprint(publicKey) };
}

async function fileIdentity(file) {
  return (await safeReadRecord(file, { maxBytes: 64 * 1024, ownerOnly: true, code: "KEY_FILE_UNSAFE" })).identity;
}

async function assertKeyUnchanged(record) {
  if (await fileIdentity(record.file) !== record.identity) reject("KEY_CHANGED_DURING_OPERATION");
}

function publicKeyFingerprint(key) {
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

function encodePublicKey(key) {
  return key.export({ format: "der", type: "spki" }).toString("base64");
}

function parsePublicDer(value, expectedType, code) {
  let key;
  try { key = createPublicKey({ key: Buffer.from(boundedString(value, BASE64, code), "base64"), format: "der", type: "spki" }); } catch { reject(code); }
  if (key.asymmetricKeyType !== expectedType) reject(code);
  return key;
}

function envelopeAadProjection(value) {
  return {
    schema_version: value.schema_version,
    contract: value.contract,
    status: value.status,
    transfer_id: value.transfer_id,
    backup_id: value.backup_id,
    created_at: value.created_at,
    source: value.source,
    receiver: value.receiver,
    inner: value.inner,
    algorithms: {
      payload: value.encryption.payload_algorithm,
      agreement: value.encryption.key_agreement,
      derivation: value.encryption.key_derivation,
      signature: "Ed25519",
    },
    payload: { file: value.payload.file, format: value.payload.format },
  };
}

function wrapAadProjection(value) {
  return {
    contract: OFFHOST_TRANSFER_CONTRACT,
    transfer_id: value.transfer_id,
    backup_id: value.backup_id,
    source_signing_key_fingerprint: value.source.signing_key_fingerprint,
    receiver_encryption_key_fingerprint: value.receiver.encryption_key_fingerprint,
  };
}

function envelopeSigningBody(value) {
  const { signature: _signature, ...body } = value;
  return body;
}

function receiptSigningBody(value) {
  const { signature: _signature, ...body } = value;
  return body;
}

function acceptanceSigningBody(value) {
  const { signature: _signature, ...body } = value;
  return body;
}

function validateSignature(value, expectedFingerprint, code) {
  exactKeys(value, ["algorithm", "key_fingerprint", "value_base64"], code);
  if (value.algorithm !== "Ed25519" || value.key_fingerprint !== expectedFingerprint) reject(code);
  bufferFromBase64(value.value_base64, 64, code);
  return value;
}

export function validateTransferEnvelope(value) {
  exactKeys(value, ["schema_version", "contract", "status", "transfer_id", "backup_id", "created_at", "source", "receiver", "inner", "encryption", "payload", "signature"], "ENVELOPE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== OFFHOST_TRANSFER_CONTRACT || value.status !== "SEALED") reject("ENVELOPE_VERSION_INVALID");
  boundedString(value.transfer_id, IDENTIFIER, "TRANSFER_ID_INVALID");
  boundedString(value.backup_id, IDENTIFIER, "BACKUP_ID_INVALID");
  iso(value.created_at, "ENVELOPE_TIME_INVALID");
  exactKeys(value.source, ["location_id", "machine_identity_sha256", "signing_key_fingerprint"], "ENVELOPE_SOURCE_INVALID");
  boundedString(value.source.location_id, IDENTIFIER, "ENVELOPE_SOURCE_INVALID");
  for (const key of ["machine_identity_sha256", "signing_key_fingerprint"]) boundedString(value.source[key], SHA256, "ENVELOPE_SOURCE_INVALID");
  exactKeys(value.receiver, ["location_id", "encryption_key_fingerprint", "receipt_key_fingerprint"], "ENVELOPE_RECEIVER_INVALID");
  boundedString(value.receiver.location_id, IDENTIFIER, "ENVELOPE_RECEIVER_INVALID");
  if (value.receiver.location_id === value.source.location_id) reject("TRANSFER_LOCATION_NOT_DISTINCT");
  for (const key of ["encryption_key_fingerprint", "receipt_key_fingerprint"]) boundedString(value.receiver[key], SHA256, "ENVELOPE_RECEIVER_INVALID");
  exactKeys(value.inner, ["manifest_sha256", "local_receipt_sha256", "deployment_class", "deployment_id", "policy_id", "rpo_hours", "recovery_point_at", "expires_at"], "ENVELOPE_INNER_INVALID");
  for (const key of ["manifest_sha256", "local_receipt_sha256"]) boundedString(value.inner[key], SHA256, "ENVELOPE_INNER_INVALID");
  if (!new Set(["TEST", "UAT", "PRODUCTION"]).has(value.inner.deployment_class)) reject("ENVELOPE_INNER_INVALID");
  boundedString(value.inner.deployment_id, IDENTIFIER, "ENVELOPE_INNER_INVALID");
  boundedString(value.inner.policy_id, IDENTIFIER, "ENVELOPE_INNER_INVALID");
  positiveInteger(value.inner.rpo_hours, "ENVELOPE_INNER_INVALID");
  if (value.inner.rpo_hours > 168) reject("ENVELOPE_INNER_INVALID");
  iso(value.inner.recovery_point_at, "ENVELOPE_INNER_INVALID");
  iso(value.inner.expires_at, "ENVELOPE_INNER_INVALID");
  if (Date.parse(value.inner.expires_at) !== Date.parse(value.inner.recovery_point_at) + value.inner.rpo_hours * 3_600_000) reject("ENVELOPE_INNER_INVALID");
  exactKeys(value.encryption, ["payload_algorithm", "key_agreement", "key_derivation", "ephemeral_public_key_der_base64", "salt_base64", "wrapped_key", "payload_nonce_base64", "payload_tag_base64", "aad_sha256"], "ENVELOPE_ENCRYPTION_INVALID");
  if (value.encryption.payload_algorithm !== "AES-256-GCM" || value.encryption.key_agreement !== "X25519" || value.encryption.key_derivation !== "HKDF-SHA256") reject("ENVELOPE_ENCRYPTION_INVALID");
  const ephemeral = parsePublicDer(value.encryption.ephemeral_public_key_der_base64, "x25519", "ENVELOPE_ENCRYPTION_INVALID");
  if (Buffer.from(value.encryption.ephemeral_public_key_der_base64, "base64").toString("base64") !== value.encryption.ephemeral_public_key_der_base64) reject("ENVELOPE_ENCRYPTION_INVALID");
  bufferFromBase64(value.encryption.salt_base64, 32, "ENVELOPE_ENCRYPTION_INVALID");
  bufferFromBase64(value.encryption.payload_nonce_base64, 12, "ENVELOPE_ENCRYPTION_INVALID");
  bufferFromBase64(value.encryption.payload_tag_base64, 16, "ENVELOPE_ENCRYPTION_INVALID");
  boundedString(value.encryption.aad_sha256, SHA256, "ENVELOPE_ENCRYPTION_INVALID");
  exactKeys(value.encryption.wrapped_key, ["algorithm", "nonce_base64", "ciphertext_base64", "tag_base64"], "ENVELOPE_WRAPPED_KEY_INVALID");
  if (value.encryption.wrapped_key.algorithm !== "AES-256-GCM") reject("ENVELOPE_WRAPPED_KEY_INVALID");
  bufferFromBase64(value.encryption.wrapped_key.nonce_base64, 12, "ENVELOPE_WRAPPED_KEY_INVALID");
  bufferFromBase64(value.encryption.wrapped_key.ciphertext_base64, 32, "ENVELOPE_WRAPPED_KEY_INVALID");
  bufferFromBase64(value.encryption.wrapped_key.tag_base64, 16, "ENVELOPE_WRAPPED_KEY_INVALID");
  exactKeys(value.payload, ["file", "format", "sha256", "bytes"], "ENVELOPE_PAYLOAD_INVALID");
  if (value.payload.file !== "payload.enc" || value.payload.format !== "POSIX_TAR_V1") reject("ENVELOPE_PAYLOAD_INVALID");
  boundedString(value.payload.sha256, SHA256, "ENVELOPE_PAYLOAD_INVALID");
  positiveInteger(value.payload.bytes, "ENVELOPE_PAYLOAD_INVALID");
  if (value.payload.bytes > MAX_PAYLOAD_BYTES) reject("ENVELOPE_PAYLOAD_INVALID");
  const aad = Buffer.from(canonicalTransferJson(envelopeAadProjection(value)));
  if (transferSha256(aad) !== value.encryption.aad_sha256) reject("ENVELOPE_AAD_INVALID");
  validateSignature(value.signature, value.source.signing_key_fingerprint, "ENVELOPE_SIGNATURE_INVALID");
  return { value, ephemeral, aad };
}

export function validateTransferReceipt(value) {
  exactKeys(value, ["schema_version", "contract", "status", "transfer_id", "backup_id", "received_at", "source_location_id", "receiver_location_id", "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint", "envelope_sha256", "payload_sha256", "payload_bytes", "inner_manifest_sha256", "local_receipt_sha256", "offhost_receipt_sha256", "retention_policy_id", "retention_status", "attestation", "signature"], "TRANSFER_RECEIPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== OFFHOST_RECEIPT_CONTRACT || value.status !== "OFFHOST_VERIFIED") reject("TRANSFER_RECEIPT_VERSION_INVALID");
  for (const key of ["transfer_id", "backup_id", "source_location_id", "receiver_location_id", "retention_policy_id"]) boundedString(value[key], IDENTIFIER, "TRANSFER_RECEIPT_INVALID");
  if (value.source_location_id === value.receiver_location_id) reject("TRANSFER_LOCATION_NOT_DISTINCT");
  iso(value.received_at, "TRANSFER_RECEIPT_INVALID");
  for (const key of ["source_signing_key_fingerprint", "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint", "envelope_sha256", "payload_sha256", "inner_manifest_sha256", "local_receipt_sha256", "offhost_receipt_sha256"]) boundedString(value[key], SHA256, "TRANSFER_RECEIPT_INVALID");
  positiveInteger(value.payload_bytes, "TRANSFER_RECEIPT_INVALID");
  if (value.payload_bytes > MAX_PAYLOAD_BYTES || value.retention_status !== "PLANNED_NO_DELETION" || value.attestation !== "SIGNED_SOURCE_ENVELOPE_AEAD_INNER_V2_AND_DISTINCT_RECEIVER_VERIFIED") reject("TRANSFER_RECEIPT_INVALID");
  validateSignature(value.signature, value.receiver_receipt_key_fingerprint, "TRANSFER_RECEIPT_SIGNATURE_INVALID");
  return value;
}

export function validateTransferAcceptance(value) {
  exactKeys(value, ["schema_version", "contract", "status", "transfer_id", "backup_id", "accepted_at", "source_location_id", "receiver_location_id", "source_signing_key_fingerprint", "receiver_receipt_key_fingerprint", "envelope_sha256", "receiver_receipt_sha256", "attestation", "signature"], "TRANSFER_ACCEPTANCE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== OFFHOST_ACCEPTANCE_CONTRACT || value.status !== "RECEIVER_RECEIPT_ACCEPTED") reject("TRANSFER_ACCEPTANCE_VERSION_INVALID");
  for (const key of ["transfer_id", "backup_id", "source_location_id", "receiver_location_id"]) boundedString(value[key], IDENTIFIER, "TRANSFER_ACCEPTANCE_INVALID");
  if (value.source_location_id === value.receiver_location_id) reject("TRANSFER_LOCATION_NOT_DISTINCT");
  iso(value.accepted_at, "TRANSFER_ACCEPTANCE_INVALID");
  for (const key of ["source_signing_key_fingerprint", "receiver_receipt_key_fingerprint", "envelope_sha256", "receiver_receipt_sha256"]) boundedString(value[key], SHA256, "TRANSFER_ACCEPTANCE_INVALID");
  if (value.attestation !== "SOURCE_VERIFIED_SIGNED_RECEIVER_ACKNOWLEDGEMENT") reject("TRANSFER_ACCEPTANCE_INVALID");
  validateSignature(value.signature, value.source_signing_key_fingerprint, "TRANSFER_ACCEPTANCE_SIGNATURE_INVALID");
  return value;
}

export function validateMaterializationReceipt(value) {
  exactKeys(value, ["schema_version", "contract", "status", "transfer_id", "backup_id", "materialized_at", "envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "policy_sha256", "manifest_sha256", "attestation", "integrity_sha256"], "MATERIALIZATION_RECEIPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== OFFHOST_MATERIALIZATION_CONTRACT || value.status !== "MATERIALIZED_FOR_RESTORE") reject("MATERIALIZATION_RECEIPT_VERSION_INVALID");
  for (const key of ["transfer_id", "backup_id"]) boundedString(value[key], IDENTIFIER, "MATERIALIZATION_RECEIPT_INVALID");
  iso(value.materialized_at, "MATERIALIZATION_RECEIPT_INVALID");
  for (const key of ["envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "policy_sha256", "manifest_sha256", "integrity_sha256"]) boundedString(value[key], SHA256, "MATERIALIZATION_RECEIPT_INVALID");
  if (value.attestation !== "SIGNED_ENCRYPTED_OFFHOST_CHAIN_VERIFIED_BEFORE_TRANSIENT_MATERIALIZATION") reject("MATERIALIZATION_RECEIPT_INVALID");
  const { integrity_sha256: integrity, ...body } = value;
  if (transferSha256(body) !== integrity) reject("MATERIALIZATION_RECEIPT_INTEGRITY_INVALID");
  return value;
}

function verifyObjectSignature(value, key, bodyProjection, code) {
  const signature = Buffer.from(value.signature.value_base64, "base64");
  if (!verify(null, Buffer.from(canonicalTransferJson(bodyProjection(value))), key, signature)) reject(code);
}

async function validateEnvelopeWithKey(envelope, keyRecord) {
  const validated = validateTransferEnvelope(envelope);
  if (validated.value.source.signing_key_fingerprint !== keyRecord.fingerprint) reject("SOURCE_SIGNING_KEY_NOT_APPROVED");
  verifyObjectSignature(validated.value, keyRecord.key, envelopeSigningBody, "ENVELOPE_SIGNATURE_INVALID");
  return validated;
}

async function readInnerBundle(backupDirectory, localReceiptFile, now = new Date()) {
  const resolvedBackup = path.resolve(backupDirectory);
  await safeDirectory(resolvedBackup, "BACKUP_DIRECTORY_UNSAFE");
  const entries = await readdir(resolvedBackup, { withFileTypes: true });
  if (entries.length !== INNER_FILES.length || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !INNER_FILES.includes(entry.name))) reject("BACKUP_FILE_SET_INVALID");
  for (const name of INNER_FILES) await safeRegularFile(path.join(resolvedBackup, name), { code: "BACKUP_FILE_UNSAFE" });
  const manifestFile = path.join(resolvedBackup, "manifest.json");
  const manifest = validateManifest(await safeJson(manifestFile, "MANIFEST_INVALID"));
  if (path.basename(resolvedBackup) !== manifest.backup_id) reject("BACKUP_ID_PATH_MISMATCH");
  const localReceiptPath = path.resolve(localReceiptFile);
  if (path.basename(localReceiptPath) !== `${manifest.backup_id}.local.json`) reject("LOCAL_RECEIPT_PATH_INVALID");
  const localReceipt = validateReceipt(await safeJson(localReceiptPath, "LOCAL_RECEIPT_INVALID"));
  if (localReceipt.result !== "LOCAL_VERIFIED" || localReceipt.backup_id !== manifest.backup_id) reject("LOCAL_RECEIPT_INVALID");
  const manifestSha = await sha256File(manifestFile);
  if (localReceipt.manifest_sha256 !== manifestSha) reject("LOCAL_RECEIPT_MANIFEST_MISMATCH");
  for (const key of ["deployment", "application", "migration", "policy", "consistency", "reconciliation", "artifacts"]) {
    if (canonicalTransferJson(localReceipt[key]) !== canonicalTransferJson(manifest[key])) reject("LOCAL_RECEIPT_MANIFEST_MISMATCH");
  }
  if (await sha256File(path.join(resolvedBackup, "migrations.txt")) !== manifest.migration.manifest_sha256
    || await sha256File(path.join(resolvedBackup, "reconciliation.json")) !== manifest.reconciliation.sha256) reject("INNER_METADATA_SHA_MISMATCH");
  for (const artifact of Object.values(manifest.artifacts)) {
    const file = path.join(resolvedBackup, artifact.file);
    const metadata = await safeRegularFile(file, { code: "BACKUP_FILE_UNSAFE" });
    if (metadata.size !== artifact.bytes || await sha256File(file) !== artifact.sha256) reject("INNER_ARTIFACT_MISMATCH");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) reject("NOW_INVALID");
  if (Date.parse(manifest.created_at) > now.getTime() + MAX_CLOCK_SKEW_MS) reject("BACKUP_FROM_FUTURE");
  if (now.getTime() > Date.parse(localReceipt.expires_at)) reject("BACKUP_STALE");
  return {
    backupDirectory: resolvedBackup,
    localReceiptFile: localReceiptPath,
    manifest,
    localReceipt,
    manifestSha,
    localReceiptSha: await sha256File(localReceiptPath),
  };
}

function preparedProjection(bundle, options, sourceKey, receiverEncryptionKey, receiverReceiptKey, createdAt) {
  return {
    schema_version: 1,
    contract: "chenyida-erp-offhost-transfer-intent/v1",
    status: "PREPARED",
    transfer_id: options.transferId,
    backup_id: bundle.manifest.backup_id,
    created_at: createdAt,
    source_location_id: bundle.localReceipt.location_id,
    receiver_location_id: options.receiverLocationId,
    source_signing_key_fingerprint: sourceKey.fingerprint,
    receiver_encryption_key_fingerprint: receiverEncryptionKey.fingerprint,
    receiver_receipt_key_fingerprint: receiverReceiptKey.fingerprint,
    manifest_sha256: bundle.manifestSha,
    local_receipt_sha256: bundle.localReceiptSha,
  };
}

async function waitChild(child, code) {
  const stderr = [];
  let bytes = 0;
  child.stderr.on("data", (chunk) => { if (bytes < 64 * 1024) { stderr.push(chunk); bytes += chunk.length; } });
  const status = child.exitCode !== null || child.signalCode !== null
    ? { exitCode: child.exitCode, signal: child.signalCode }
    : await new Promise((resolve, rejectPromise) => {
      child.once("error", rejectPromise);
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    }).catch(() => reject(code));
  if (status.exitCode !== 0 || status.signal) reject(code);
}

async function moveDirectoryNoClobber(source, destination, code) {
  const before = await safeDirectory(source, code);
  const child = spawn("mv", ["-T", "-n", "--", source, destination], {
    env: { PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await waitChild(child, code);
  const sourceAfter = await lstat(source).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  const destinationAfter = await safeDirectory(destination, code);
  if (sourceAfter || destinationAfter.dev !== before.dev || destinationAfter.ino !== before.ino) reject(code);
}

async function encryptTarBundle(bundle, stage, contentKey, nonce, aad) {
  const payloadFile = path.join(stage, "payload.enc");
  const tar = spawn("tar", [
    "--create", "--format=posix", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--mode=u+rwX,go-rwx", "--file=-",
    "--directory", path.dirname(bundle.backupDirectory), path.basename(bundle.backupDirectory),
    "--directory", path.dirname(bundle.localReceiptFile), path.basename(bundle.localReceiptFile),
  ], { env: { PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  const cipher = createCipheriv("aes-256-gcm", contentKey, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  let bytes = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_PAYLOAD_BYTES) return callback(new OffhostTransferError("PAYLOAD_TOO_LARGE"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await Promise.all([
      pipeline(tar.stdout, cipher, meter, createWriteStream(payloadFile, { flags: "wx", mode: 0o600 })),
      waitChild(tar, "TAR_CREATE_FAILED"),
    ]);
    await syncFile(payloadFile);
  } catch (error) {
    tar.kill("SIGKILL");
    await unlink(payloadFile).catch(() => {});
    if (error instanceof OffhostTransferError) throw error;
    reject("PAYLOAD_ENCRYPTION_FAILED");
  }
  return { payloadFile, bytes, sha256: hash.digest("hex"), tag: cipher.getAuthTag() };
}

async function safeRemoveStage(root, stage, prefix) {
  const resolvedRoot = path.resolve(root);
  const resolvedStage = path.resolve(stage);
  if (!isInside(resolvedStage, resolvedRoot) || path.dirname(resolvedStage) !== resolvedRoot || !path.basename(resolvedStage).startsWith(prefix)) reject("STAGE_PATH_UNSAFE");
  const metadata = await lstat(resolvedStage).catch((error) => error?.code === "ENOENT" ? null : reject("STAGE_PATH_UNSAFE"));
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()) reject("STAGE_PATH_UNSAFE");
  await chmod(resolvedStage, 0o700).catch(() => {});
  await rm(resolvedStage, { recursive: true, force: false });
  await syncDirectory(resolvedRoot);
}

async function packageEnvelope(packageDirectory, expectedFiles = ["envelope.json", "payload.enc"]) {
  const resolved = path.resolve(packageDirectory);
  await safeDirectory(resolved, "TRANSFER_PACKAGE_UNSAFE");
  const entries = await readdir(resolved, { withFileTypes: true });
  if (entries.length !== expectedFiles.length || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !expectedFiles.includes(entry.name))) reject("TRANSFER_PACKAGE_FILE_SET_INVALID");
  const envelopeFile = path.join(resolved, "envelope.json");
  const payloadFile = path.join(resolved, "payload.enc");
  const envelope = validateTransferEnvelope(await safeCanonicalJson(envelopeFile, "ENVELOPE_INVALID")).value;
  const metadata = await safeRegularFile(payloadFile, { code: "PAYLOAD_UNSAFE" });
  if (metadata.size !== envelope.payload.bytes || await sha256File(payloadFile) !== envelope.payload.sha256) reject("PAYLOAD_IDENTITY_MISMATCH");
  return { packageDirectory: resolved, envelopeFile, payloadFile, envelope, envelopeSha: await sha256File(envelopeFile) };
}

function assertNoRootOverlap(entries) {
  const resolved = entries.filter(Boolean).map((entry) => path.resolve(entry));
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      if (isInside(resolved[left], resolved[right]) || isInside(resolved[right], resolved[left])) reject("TRANSFER_ROOTS_OVERLAP");
    }
  }
}

function failAt(options, point) {
  if (options.failAt === point) {
    if (process.env.NODE_ENV !== "test") reject("FAILURE_INJECTION_FORBIDDEN");
    reject(`INJECTED_${point}`);
  }
}

async function sealOffhostTransferUnlocked(options) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const createdAt = iso(options.createdAt || now.toISOString(), "ENVELOPE_TIME_INVALID");
  if (Math.abs(now.getTime() - Date.parse(createdAt)) > MAX_CLOCK_SKEW_MS) reject("ENVELOPE_TIME_INVALID");
  const transferId = boundedString(options.transferId || `tr-${randomBytes(16).toString("hex")}`, IDENTIFIER, "TRANSFER_ID_INVALID");
  if (process.env.NODE_ENV !== "test" && !/^tr-[0-9a-f]{32}$/.test(transferId)) reject("TRANSFER_ID_ENTROPY_INVALID");
  const receiverLocationId = boundedString(options.receiverLocationId, IDENTIFIER, "RECEIVER_LOCATION_INVALID");
  const outboxRoot = await validateDedicatedRoot(options.outboxRoot, OUTBOX_ROOT_MARKER, OUTBOX_ROOT_MARKER_VALUE, "OUTBOX_ROOT_UNSAFE");
  assertNoRootOverlap([outboxRoot, options.sourceKeyRoot, options.backupDirectory]);
  const bundle = await readInnerBundle(options.backupDirectory, options.localReceiptFile, now);
  if (bundle.localReceipt.location_id === receiverLocationId) reject("TRANSFER_LOCATION_NOT_DISTINCT");
  const sourceKey = await validateKeyFile(options.sourceKeyRoot, options.sourceSigningPrivateKey, "ed25519", "private");
  const receiverEncryptionKey = await validateKeyFile(options.sourceKeyRoot, options.receiverEncryptionPublicKey, "x25519", "public");
  const receiverReceiptKey = await validateKeyFile(options.sourceKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  if (sourceKey.fingerprint === receiverReceiptKey.fingerprint) reject("KEY_USAGE_NOT_SEPARATED");
  if (!options.policy && process.env.NODE_ENV !== "test") reject("BACKUP_OPERATIONS_POLICY_REQUIRED");
  const intent = preparedProjection(bundle, { transferId, receiverLocationId }, sourceKey, receiverEncryptionKey, receiverReceiptKey, createdAt);
  const preparedFile = path.join(outboxRoot, `${transferId}.prepared.json`);
  await atomicNoClobberJson(preparedFile, intent, 0o400, "TRANSFER_INTENT_CONFLICT");
  failAt(options, "AFTER_PREPARED");
  const finalPackage = path.join(outboxRoot, transferId);
  const existing = await lstat(finalPackage).catch((error) => error?.code === "ENOENT" ? null : reject("TRANSFER_PACKAGE_UNSAFE"));
  if (existing) {
    const packaged = await packageEnvelope(finalPackage);
    if (packaged.envelope.transfer_id !== transferId || packaged.envelope.backup_id !== bundle.manifest.backup_id
      || packaged.envelope.inner.manifest_sha256 !== bundle.manifestSha || packaged.envelope.inner.local_receipt_sha256 !== bundle.localReceiptSha
      || packaged.envelope.receiver.location_id !== receiverLocationId || packaged.envelope.source.signing_key_fingerprint !== sourceKey.fingerprint
      || packaged.envelope.receiver.encryption_key_fingerprint !== receiverEncryptionKey.fingerprint
      || packaged.envelope.receiver.receipt_key_fingerprint !== receiverReceiptKey.fingerprint) reject("TRANSFER_PACKAGE_CONFLICT");
    await validateEnvelopeWithKey(packaged.envelope, { ...sourceKey, key: createPublicKey(sourceKey.key) });
    await Promise.all([assertKeyUnchanged(sourceKey), assertKeyUnchanged(receiverEncryptionKey), assertKeyUnchanged(receiverReceiptKey)]);
    return packaged;
  }
  const stage = path.join(outboxRoot, `.staging-${transferId}`);
  await safeRemoveStage(outboxRoot, stage, `.staging-${transferId}`);
  await mkdir(stage, { mode: 0o700 });
  await chmod(stage, 0o700);
  let contentKey;
  let sharedSecret;
  let wrappingKey;
  try {
    contentKey = randomBytes(32);
    const payloadNonce = randomBytes(12);
    const salt = randomBytes(32);
    const ephemeral = generateKeyPairSync("x25519");
    sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: receiverEncryptionKey.key });
    wrappingKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`chenyida-erp-offhost-transfer/v1:${transferId}`), 32));
    const wrapNonce = randomBytes(12);
    const baseEnvelope = {
    schema_version: 1,
    contract: OFFHOST_TRANSFER_CONTRACT,
    status: "SEALED",
    transfer_id: transferId,
    backup_id: bundle.manifest.backup_id,
    created_at: createdAt,
    source: {
      location_id: bundle.localReceipt.location_id,
      machine_identity_sha256: bundle.localReceipt.evidence.source_machine_identity_sha256,
      signing_key_fingerprint: sourceKey.fingerprint,
    },
    receiver: {
      location_id: receiverLocationId,
      encryption_key_fingerprint: receiverEncryptionKey.fingerprint,
      receipt_key_fingerprint: receiverReceiptKey.fingerprint,
    },
    inner: {
      manifest_sha256: bundle.manifestSha,
      local_receipt_sha256: bundle.localReceiptSha,
      deployment_class: bundle.manifest.deployment.class,
      deployment_id: bundle.manifest.deployment.id,
      policy_id: bundle.manifest.policy.id,
      rpo_hours: bundle.manifest.policy.rpo_hours,
      recovery_point_at: bundle.manifest.consistency.recovery_point_at,
      expires_at: bundle.localReceipt.expires_at,
    },
    encryption: {
      payload_algorithm: "AES-256-GCM",
      key_agreement: "X25519",
      key_derivation: "HKDF-SHA256",
      ephemeral_public_key_der_base64: encodePublicKey(ephemeral.publicKey),
      salt_base64: salt.toString("base64"),
      wrapped_key: null,
      payload_nonce_base64: payloadNonce.toString("base64"),
      payload_tag_base64: "",
      aad_sha256: "",
    },
    payload: { file: "payload.enc", format: "POSIX_TAR_V1", sha256: "", bytes: 1 },
    signature: null,
    };
    if (options.policy) {
      const { assertBackupOperationsKeyApproved, assertBackupOperationsPolicyMatchesEnvelope } = await import("./backup-operations-policy.mjs");
      assertBackupOperationsPolicyMatchesEnvelope(options.policy, baseEnvelope);
      assertBackupOperationsKeyApproved(options.policy, "source_signing", sourceKey.fingerprint, createdAt);
      assertBackupOperationsKeyApproved(options.policy, "receiver_encryption", receiverEncryptionKey.fingerprint, createdAt);
      assertBackupOperationsKeyApproved(options.policy, "receiver_receipt", receiverReceiptKey.fingerprint, createdAt);
    }
    const aad = Buffer.from(canonicalTransferJson(envelopeAadProjection(baseEnvelope)));
    baseEnvelope.encryption.aad_sha256 = transferSha256(aad);
    const wrapCipher = createCipheriv("aes-256-gcm", wrappingKey, wrapNonce, { authTagLength: 16 });
    wrapCipher.setAAD(Buffer.from(canonicalTransferJson(wrapAadProjection(baseEnvelope))));
    const wrappedKey = Buffer.concat([wrapCipher.update(contentKey), wrapCipher.final()]);
    baseEnvelope.encryption.wrapped_key = {
      algorithm: "AES-256-GCM",
      nonce_base64: wrapNonce.toString("base64"),
      ciphertext_base64: wrappedKey.toString("base64"),
      tag_base64: wrapCipher.getAuthTag().toString("base64"),
    };
    const encrypted = await encryptTarBundle(bundle, stage, contentKey, payloadNonce, aad);
    failAt(options, "AFTER_CIPHERTEXT");
    baseEnvelope.encryption.payload_tag_base64 = encrypted.tag.toString("base64");
    baseEnvelope.payload = { file: "payload.enc", format: "POSIX_TAR_V1", sha256: encrypted.sha256, bytes: encrypted.bytes };
    const signature = sign(null, Buffer.from(canonicalTransferJson(envelopeSigningBody(baseEnvelope))), sourceKey.key);
    const envelope = validateTransferEnvelope({
      ...baseEnvelope,
      signature: { algorithm: "Ed25519", key_fingerprint: sourceKey.fingerprint, value_base64: signature.toString("base64") },
    }).value;
    await writeExclusiveFile(path.join(stage, "envelope.json"), canonicalTransferJson(envelope), 0o600);
    await durableTree(stage);
    failAt(options, "AFTER_ENVELOPE");
    await moveDirectoryNoClobber(stage, finalPackage, "TRANSFER_PACKAGE_PROMOTION_CONFLICT");
    await syncDirectory(outboxRoot);
    failAt(options, "AFTER_PROMOTION");
    await Promise.all([assertKeyUnchanged(sourceKey), assertKeyUnchanged(receiverEncryptionKey), assertKeyUnchanged(receiverReceiptKey)]);
    return packageEnvelope(finalPackage);
  } finally {
    contentKey?.fill(0); wrappingKey?.fill(0); sharedSecret?.fill(0);
  }
}

export async function sealOffhostTransfer(options) {
  const root = await validateDedicatedRoot(options.outboxRoot, OUTBOX_ROOT_MARKER, OUTBOX_ROOT_MARKER_VALUE, "OUTBOX_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root, ".offhost-transfer-v1.lock");
  try { return await sealOffhostTransferUnlocked(options); } finally { await release(); }
}

async function copyVerifiedFile(source, target) {
  const sourceMetadata = await safeRegularFile(source, { code: "INCOMING_FILE_UNSAFE" });
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const output = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const before = await input.stat();
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (bytesRead <= 0) reject("INCOMING_FILE_CHANGED");
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten <= 0) reject("INCOMING_COPY_FAILED");
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await output.chmod(0o600);
    await output.sync();
    const after = await input.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.size !== sourceMetadata.size) reject("INCOMING_FILE_CHANGED");
  } finally {
    await input.close().catch(() => {});
    await output.close().catch(() => {});
  }
}

async function decryptPayload(packageInfo, receiverPrivateKey, targetTar) {
  const validated = validateTransferEnvelope(packageInfo.envelope);
  if (validated.value.receiver.encryption_key_fingerprint !== receiverPrivateKey.fingerprint) reject("RECEIVER_DECRYPTION_KEY_NOT_APPROVED");
  let sharedSecret;
  let wrappingKey;
  let contentKey;
  try {
    const salt = Buffer.from(validated.value.encryption.salt_base64, "base64");
    sharedSecret = diffieHellman({ privateKey: receiverPrivateKey.key, publicKey: validated.ephemeral });
    wrappingKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`chenyida-erp-offhost-transfer/v1:${validated.value.transfer_id}`), 32));
    const wrapped = validated.value.encryption.wrapped_key;
    const unwrap = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(wrapped.nonce_base64, "base64"), { authTagLength: 16 });
    unwrap.setAAD(Buffer.from(canonicalTransferJson(wrapAadProjection(validated.value))));
    unwrap.setAuthTag(Buffer.from(wrapped.tag_base64, "base64"));
    try { contentKey = Buffer.concat([unwrap.update(Buffer.from(wrapped.ciphertext_base64, "base64")), unwrap.final()]); } catch { reject("CONTENT_KEY_UNWRAP_FAILED"); }
    if (contentKey.length !== 32) reject("CONTENT_KEY_UNWRAP_FAILED");
    const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(validated.value.encryption.payload_nonce_base64, "base64"), { authTagLength: 16 });
    decipher.setAAD(validated.aad);
    decipher.setAuthTag(Buffer.from(validated.value.encryption.payload_tag_base64, "base64"));
    try {
      await pipeline(createReadStream(packageInfo.payloadFile, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), decipher, createWriteStream(targetTar, { flags: "wx", mode: 0o600 }));
      await syncFile(targetTar);
    } catch {
      await unlink(targetTar).catch(() => {});
      reject("PAYLOAD_AUTHENTICATION_FAILED");
    }
  } finally {
    contentKey?.fill(0); wrappingKey?.fill(0); sharedSecret?.fill(0);
  }
}

async function command(binary, args, code) {
  const child = spawn(binary, args, { env: { PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  let bytes = 0;
  child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes <= 16 * 1024 * 1024) chunks.push(chunk); });
  await waitChild(child, code);
  if (bytes > 16 * 1024 * 1024) reject(code);
  return Buffer.concat(chunks).toString("utf8");
}

async function extractInnerTar(tarFile, target, backupId) {
  const listing = (await command("tar", ["--list", "--file", tarFile], "TAR_LIST_FAILED")).split("\n").filter(Boolean);
  const expected = new Set([`${backupId}/`, ...INNER_FILES.map((name) => `${backupId}/${name}`), `${backupId}.local.json`]);
  if (listing.length !== expected.size || listing.some((name) => !expected.has(name))) reject("TAR_FILE_SET_INVALID");
  const verbose = (await command("tar", ["--list", "--verbose", "--numeric-owner", "--file", tarFile], "TAR_LIST_FAILED")).split("\n").filter(Boolean);
  if (verbose.length !== listing.length || verbose.some((line) => !["-", "d"].includes(line[0]) || /[sStT]/.test(line.slice(0, 10)))) reject("TAR_ENTRY_UNSAFE");
  await command("tar", ["--extract", "--file", tarFile, "--directory", target, "--no-same-owner", "--no-same-permissions"], "TAR_EXTRACT_FAILED");
  const backupDirectory = path.join(target, backupId);
  const localReceiptFile = path.join(target, `${backupId}.local.json`);
  await chmod(backupDirectory, 0o700);
  for (const name of INNER_FILES) await chmod(path.join(backupDirectory, name), 0o600);
  await chmod(localReceiptFile, 0o600);
  await durableTree(target);
  return { backupDirectory, localReceiptFile };
}

function verificationOptionsFromManifest(manifest) {
  return {
    expectedDeploymentClass: manifest.deployment.class,
    expectedDeploymentId: manifest.deployment.id,
    expectedDatabaseName: manifest.deployment.database,
    expectedDatabaseSystemIdentifier: manifest.deployment.database_system_identifier,
    expectedDatabaseOid: manifest.deployment.database_oid,
    expectedDatabaseMarker: manifest.deployment.database_marker,
    expectedDatabaseBytes: manifest.deployment.database_bytes,
    expectedDatabaseServerMajor: manifest.deployment.database_server_major,
    expectedDatabaseEncoding: manifest.deployment.database_encoding,
    expectedDatabaseCollate: manifest.deployment.database_collate,
    expectedDatabaseCtype: manifest.deployment.database_ctype,
    expectedDatabaseLocaleProvider: manifest.deployment.database_locale_provider,
    expectedDatabaseCollationVersion: manifest.deployment.database_collation_version,
    expectedApplicationVersion: manifest.application.version,
    expectedGitCommit: manifest.application.git_commit,
    expectedWebImageDigest: manifest.application.web_image_digest,
    expectedWorkerImageDigest: manifest.application.worker_image_digest,
    expectedMigrationHead: manifest.migration.head,
    expectedPolicyId: manifest.policy.id,
    expectedRpoHours: manifest.policy.rpo_hours,
  };
}

async function materializeInto(packageInfo, receiverPrivateKey, plaintextRoot) {
  const filesystem = await statfs(plaintextRoot, { bigint: true }).catch(() => reject("MATERIALIZATION_CAPACITY_UNAVAILABLE"));
  const availableBytes = filesystem.bavail * filesystem.bsize;
  const reserveBytes = process.env.NODE_ENV === "test" && packageInfo.envelope.inner.deployment_class === "TEST" ? 67_108_864n : 1_073_741_824n;
  const requiredBytes = BigInt(packageInfo.envelope.payload.bytes) * 2n + reserveBytes;
  if (availableBytes < requiredBytes) reject("MATERIALIZATION_CAPACITY_INSUFFICIENT");
  const tarFile = path.join(plaintextRoot, "payload.tar");
  await decryptPayload(packageInfo, receiverPrivateKey, tarFile);
  const extracted = await extractInnerTar(tarFile, plaintextRoot, packageInfo.envelope.backup_id);
  await unlink(tarFile);
  await syncDirectory(plaintextRoot);
  const bundle = await readInnerBundle(extracted.backupDirectory, extracted.localReceiptFile, new Date(packageInfo.envelope.created_at));
  if (bundle.manifestSha !== packageInfo.envelope.inner.manifest_sha256 || bundle.localReceiptSha !== packageInfo.envelope.inner.local_receipt_sha256
    || bundle.manifest.deployment.class !== packageInfo.envelope.inner.deployment_class || bundle.manifest.deployment.id !== packageInfo.envelope.inner.deployment_id
    || bundle.manifest.policy.id !== packageInfo.envelope.inner.policy_id || bundle.manifest.policy.rpo_hours !== packageInfo.envelope.inner.rpo_hours
    || bundle.manifest.consistency.recovery_point_at !== packageInfo.envelope.inner.recovery_point_at || bundle.localReceipt.expires_at !== packageInfo.envelope.inner.expires_at) reject("INNER_ENVELOPE_MISMATCH");
  return { ...extracted, bundle };
}

async function verifyFinalReceiverPackage(packageDirectory, keys) {
  const packaged = await packageEnvelope(packageDirectory, ["envelope.json", "payload.enc", "offhost-receipt.json", "receiver-receipt.json"]);
  await validateEnvelopeWithKey(packaged.envelope, keys.sourceSigningPublic);
  const offhostReceiptFile = path.join(packaged.packageDirectory, "offhost-receipt.json");
  const receiverReceiptFile = path.join(packaged.packageDirectory, "receiver-receipt.json");
  const offhostReceipt = validateReceipt(await safeJson(offhostReceiptFile, "OFFHOST_RECEIPT_INVALID"));
  const receiverReceipt = validateTransferReceipt(await safeCanonicalJson(receiverReceiptFile, "TRANSFER_RECEIPT_INVALID"));
  if (offhostReceipt.result !== "OFFHOST_VERIFIED" || offhostReceipt.backup_id !== packaged.envelope.backup_id
    || offhostReceipt.manifest_sha256 !== packaged.envelope.inner.manifest_sha256
    || offhostReceipt.location_id !== packaged.envelope.receiver.location_id
    || offhostReceipt.evidence.transfer_id !== packaged.envelope.transfer_id
    || offhostReceipt.evidence.source_location_id !== packaged.envelope.source.location_id
    || offhostReceipt.evidence.source_machine_identity_sha256 !== packaged.envelope.source.machine_identity_sha256
    || offhostReceipt.evidence.local_receipt_sha256 !== packaged.envelope.inner.local_receipt_sha256
    || receiverReceipt.transfer_id !== packaged.envelope.transfer_id || receiverReceipt.backup_id !== packaged.envelope.backup_id
    || receiverReceipt.source_location_id !== packaged.envelope.source.location_id
    || receiverReceipt.receiver_location_id !== packaged.envelope.receiver.location_id
    || receiverReceipt.envelope_sha256 !== packaged.envelopeSha || receiverReceipt.payload_sha256 !== packaged.envelope.payload.sha256
    || receiverReceipt.payload_bytes !== packaged.envelope.payload.bytes || receiverReceipt.inner_manifest_sha256 !== packaged.envelope.inner.manifest_sha256
    || receiverReceipt.local_receipt_sha256 !== packaged.envelope.inner.local_receipt_sha256
    || receiverReceipt.offhost_receipt_sha256 !== await sha256File(offhostReceiptFile)
    || receiverReceipt.source_signing_key_fingerprint !== keys.sourceSigningPublic.fingerprint
    || receiverReceipt.receiver_receipt_key_fingerprint !== keys.receiverReceiptPublic.fingerprint
    || receiverReceipt.receiver_encryption_key_fingerprint !== keys.receiverEncryptionPrivate.fingerprint
    || Date.parse(receiverReceipt.received_at) < Date.parse(packaged.envelope.created_at)
    || Date.parse(receiverReceipt.received_at) > Date.parse(packaged.envelope.inner.expires_at)) reject("RECEIVER_PACKAGE_CHAIN_INVALID");
  verifyObjectSignature(receiverReceipt, keys.receiverReceiptPublic.key, receiptSigningBody, "TRANSFER_RECEIPT_SIGNATURE_INVALID");
  return { ...packaged, offhostReceiptFile, offhostReceipt, receiverReceiptFile, receiverReceipt };
}

function verifyAcceptanceAgainstChain(acceptance, acceptanceSha, chain, sourceSigningPublic) {
  validateTransferAcceptance(acceptance);
  verifyObjectSignature(acceptance, sourceSigningPublic.key, acceptanceSigningBody, "TRANSFER_ACCEPTANCE_SIGNATURE_INVALID");
  if (acceptance.source_signing_key_fingerprint !== sourceSigningPublic.fingerprint
    || acceptance.transfer_id !== chain.envelope.transfer_id || acceptance.backup_id !== chain.envelope.backup_id
    || acceptance.source_location_id !== chain.envelope.source.location_id
    || acceptance.receiver_location_id !== chain.envelope.receiver.location_id
    || acceptance.receiver_receipt_key_fingerprint !== chain.envelope.receiver.receipt_key_fingerprint
    || acceptance.envelope_sha256 !== chain.envelopeSha
    || acceptance.receiver_receipt_sha256 !== chain.receiverReceiptSha
    || Date.parse(acceptance.accepted_at) < Date.parse(chain.receiverReceipt.received_at)
    || Date.parse(acceptance.accepted_at) > Date.parse(chain.envelope.inner.expires_at)) reject("TRANSFER_ACCEPTANCE_CHAIN_INVALID");
  return { acceptance, acceptanceSha };
}

export async function verifyOffhostTransferEvidence(options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  assertNoRootOverlap([options.receiverPackageDirectory, options.receiverKeyRoot]);
  const sourceSigningPublic = await validateKeyFile(options.receiverKeyRoot, options.trustedSourceSigningPublicKey, "ed25519", "public");
  const receiverEncryptionPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverEncryptionPrivateKey, "x25519", "private");
  const receiverReceiptPublic = await validateKeyFile(options.receiverKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  const receiver = await verifyFinalReceiverPackage(options.receiverPackageDirectory, { receiverEncryptionPrivate, sourceSigningPublic, receiverReceiptPublic });
  receiver.receiverReceiptSha = await sha256File(receiver.receiverReceiptFile);
  const acceptanceFile = path.resolve(options.acceptanceFile);
  const acceptance = validateTransferAcceptance(await safeCanonicalJson(acceptanceFile, "TRANSFER_ACCEPTANCE_INVALID"));
  const result = verifyAcceptanceAgainstChain(acceptance, await sha256File(acceptanceFile), receiver, sourceSigningPublic);
  if (options.policy) {
    const { assertBackupOperationsKeyApproved, assertBackupOperationsPolicyMatchesEnvelope } = await import("./backup-operations-policy.mjs");
    assertBackupOperationsPolicyMatchesEnvelope(options.policy, receiver.envelope);
    const policyTime = options.requireFresh === false ? new Date(receiver.envelope.created_at) : now;
    assertBackupOperationsKeyApproved(options.policy, "source_signing", sourceSigningPublic.fingerprint, policyTime);
    assertBackupOperationsKeyApproved(options.policy, "receiver_encryption", receiverEncryptionPrivate.fingerprint, policyTime);
    assertBackupOperationsKeyApproved(options.policy, "receiver_receipt", receiverReceiptPublic.fingerprint, policyTime);
  }
  if (options.requireFresh !== false && now.getTime() > Date.parse(receiver.envelope.inner.expires_at)) reject("TRANSFER_EVIDENCE_STALE");
  await Promise.all([assertKeyUnchanged(sourceSigningPublic), assertKeyUnchanged(receiverEncryptionPrivate), assertKeyUnchanged(receiverReceiptPublic)]);
  return { ...receiver, ...result };
}

async function receiveOffhostTransferUnlocked(options) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const receiverLocationId = boundedString(options.receiverLocationId, IDENTIFIER, "RECEIVER_LOCATION_INVALID");
  const retentionPolicyId = boundedString(options.retentionPolicyId, IDENTIFIER, "RETENTION_POLICY_INVALID");
  const incoming = await packageEnvelope(options.incomingPackageDirectory);
  if (Date.parse(incoming.envelope.created_at) > now.getTime() + MAX_CLOCK_SKEW_MS || now.getTime() > Date.parse(incoming.envelope.inner.expires_at)) reject("TRANSFER_STALE_OR_FUTURE");
  if (incoming.envelope.receiver.location_id !== receiverLocationId) reject("RECEIVER_LOCATION_MISMATCH");
  const receiverRoot = await validateDedicatedRoot(options.receiverRoot, RECEIVER_ROOT_MARKER, RECEIVER_ROOT_MARKER_VALUE, "RECEIVER_ROOT_UNSAFE");
  assertNoRootOverlap([receiverRoot, options.receiverKeyRoot, options.incomingPackageDirectory, options.migrationsDirectory]);
  const receiverEncryptionPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverEncryptionPrivateKey, "x25519", "private");
  const sourceSigningPublic = await validateKeyFile(options.receiverKeyRoot, options.trustedSourceSigningPublicKey, "ed25519", "public");
  const receiverReceiptPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverReceiptPrivateKey, "ed25519", "private");
  const receiverReceiptPublic = { ...receiverReceiptPrivate, key: createPublicKey(receiverReceiptPrivate.key) };
  if (sourceSigningPublic.fingerprint === receiverReceiptPrivate.fingerprint) reject("KEY_USAGE_NOT_SEPARATED");
  if (!options.policy && process.env.NODE_ENV !== "test") reject("BACKUP_OPERATIONS_POLICY_REQUIRED");
  await validateEnvelopeWithKey(incoming.envelope, sourceSigningPublic);
  const finalPackage = path.join(receiverRoot, incoming.envelope.transfer_id);
  const existing = await lstat(finalPackage).catch((error) => error?.code === "ENOENT" ? null : reject("RECEIVER_PACKAGE_UNSAFE"));
  if (existing) {
    const verified = await verifyFinalReceiverPackage(finalPackage, { receiverEncryptionPrivate, sourceSigningPublic, receiverReceiptPublic });
    if (verified.envelopeSha !== incoming.envelopeSha || verified.envelope.payload.sha256 !== incoming.envelope.payload.sha256
      || verified.receiverReceipt.retention_policy_id !== retentionPolicyId || verified.receiverReceipt.receiver_location_id !== receiverLocationId) reject("RECEIVER_PACKAGE_CONFLICT");
    await Promise.all([assertKeyUnchanged(receiverEncryptionPrivate), assertKeyUnchanged(sourceSigningPublic), assertKeyUnchanged(receiverReceiptPrivate)]);
    return verified;
  }
  const stage = path.join(receiverRoot, `.incoming-${incoming.envelope.transfer_id}`);
  await safeRemoveStage(receiverRoot, stage, `.incoming-${incoming.envelope.transfer_id}`);
  await mkdir(stage, { mode: 0o700 });
  await copyVerifiedFile(incoming.envelopeFile, path.join(stage, "envelope.json"));
  await copyVerifiedFile(incoming.payloadFile, path.join(stage, "payload.enc"));
  await durableTree(stage);
  failAt(options, "AFTER_RECEIVE_COPY");
  const stagePackage = await packageEnvelope(stage);
  await validateEnvelopeWithKey(stagePackage.envelope, sourceSigningPublic);
  if (stagePackage.envelopeSha !== incoming.envelopeSha
    || stagePackage.envelope.receiver.location_id !== receiverLocationId
    || stagePackage.envelope.receiver.encryption_key_fingerprint !== receiverEncryptionPrivate.fingerprint
    || stagePackage.envelope.receiver.receipt_key_fingerprint !== receiverReceiptPrivate.fingerprint) reject("RECEIVER_KEY_MISMATCH");
  if (options.policy) {
    const { assertBackupOperationsKeyApproved, assertBackupOperationsPolicyMatchesEnvelope } = await import("./backup-operations-policy.mjs");
    assertBackupOperationsPolicyMatchesEnvelope(options.policy, stagePackage.envelope);
    assertBackupOperationsKeyApproved(options.policy, "source_signing", sourceSigningPublic.fingerprint, now);
    assertBackupOperationsKeyApproved(options.policy, "receiver_encryption", receiverEncryptionPrivate.fingerprint, now);
    assertBackupOperationsKeyApproved(options.policy, "receiver_receipt", receiverReceiptPrivate.fingerprint, now);
  }
  const plaintextRoot = path.join(stage, ".plaintext");
  await mkdir(plaintextRoot, { mode: 0o700 });
  try {
    const materialized = await materializeInto(stagePackage, receiverEncryptionPrivate, plaintextRoot);
    failAt(options, "AFTER_DECRYPT");
    if (options.machineIdentityFile && (process.env.NODE_ENV !== "test" || materialized.bundle.manifest.deployment.class !== "TEST")) reject("MACHINE_IDENTITY_OVERRIDE_FORBIDDEN");
    const offhostReceipt = await verifyOffhostBackup({
      backupDirectory: materialized.backupDirectory,
      migrationsDirectory: options.migrationsDirectory,
      localReceiptFile: materialized.localReceiptFile,
      transferId: incoming.envelope.transfer_id,
      receiverRoot,
      locationId: receiverLocationId,
      machineIdentityFile: options.machineIdentityFile,
      now,
      ...verificationOptionsFromManifest(materialized.bundle.manifest),
    });
    failAt(options, "AFTER_INNER_VERIFY");
    const offhostReceiptFile = path.join(stage, "offhost-receipt.json");
    // The V2 inner contract intentionally compares its manifest projection with
    // JSON insertion order; preserve that stable legacy serialization here.
    await writeExclusiveFile(offhostReceiptFile, `${JSON.stringify(offhostReceipt)}\n`, 0o600);
    const receiptBody = {
      schema_version: 1,
      contract: OFFHOST_RECEIPT_CONTRACT,
      status: "OFFHOST_VERIFIED",
      transfer_id: incoming.envelope.transfer_id,
      backup_id: stagePackage.envelope.backup_id,
      received_at: now.toISOString(),
      source_location_id: stagePackage.envelope.source.location_id,
      receiver_location_id: receiverLocationId,
      source_signing_key_fingerprint: sourceSigningPublic.fingerprint,
      receiver_encryption_key_fingerprint: receiverEncryptionPrivate.fingerprint,
      receiver_receipt_key_fingerprint: receiverReceiptPrivate.fingerprint,
      envelope_sha256: stagePackage.envelopeSha,
      payload_sha256: stagePackage.envelope.payload.sha256,
      payload_bytes: stagePackage.envelope.payload.bytes,
      inner_manifest_sha256: stagePackage.envelope.inner.manifest_sha256,
      local_receipt_sha256: stagePackage.envelope.inner.local_receipt_sha256,
      offhost_receipt_sha256: await sha256File(offhostReceiptFile),
      retention_policy_id: retentionPolicyId,
      retention_status: "PLANNED_NO_DELETION",
      attestation: "SIGNED_SOURCE_ENVELOPE_AEAD_INNER_V2_AND_DISTINCT_RECEIVER_VERIFIED",
    };
    const receiverReceipt = validateTransferReceipt({
      ...receiptBody,
      signature: {
        algorithm: "Ed25519",
        key_fingerprint: receiverReceiptPrivate.fingerprint,
        value_base64: sign(null, Buffer.from(canonicalTransferJson(receiptBody)), receiverReceiptPrivate.key).toString("base64"),
      },
    });
    await writeExclusiveFile(path.join(stage, "receiver-receipt.json"), canonicalTransferJson(receiverReceipt), 0o600);
    failAt(options, "AFTER_RECEIPT");
  } finally {
    await safeRemoveStage(stage, plaintextRoot, ".plaintext");
  }
  const authoritative = await readdir(stage, { withFileTypes: true });
  const authoritativeNames = ["envelope.json", "offhost-receipt.json", "payload.enc", "receiver-receipt.json"];
  if (authoritative.length !== authoritativeNames.length
    || authoritative.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !authoritativeNames.includes(entry.name))) reject("RECEIVER_STAGE_FILE_SET_INVALID");
  await verifyFinalReceiverPackage(stage, { receiverEncryptionPrivate, sourceSigningPublic, receiverReceiptPublic });
  await durableTree(stage);
  await moveDirectoryNoClobber(stage, finalPackage, "RECEIVER_PACKAGE_PROMOTION_CONFLICT");
  await syncDirectory(receiverRoot);
  failAt(options, "AFTER_RECEIVER_PROMOTION");
  await Promise.all([assertKeyUnchanged(receiverEncryptionPrivate), assertKeyUnchanged(sourceSigningPublic), assertKeyUnchanged(receiverReceiptPrivate)]);
  return verifyFinalReceiverPackage(finalPackage, { receiverEncryptionPrivate, sourceSigningPublic, receiverReceiptPublic });
}

export async function receiveOffhostTransfer(options) {
  const root = await validateDedicatedRoot(options.receiverRoot, RECEIVER_ROOT_MARKER, RECEIVER_ROOT_MARKER_VALUE, "RECEIVER_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root, ".offhost-transfer-v1.lock");
  try { return await receiveOffhostTransferUnlocked(options); } finally { await release(); }
}

async function acceptOffhostTransferReceiptUnlocked(options) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const sourcePackage = await packageEnvelope(options.sourcePackageDirectory);
  const sourceSigningPrivate = await validateKeyFile(options.sourceKeyRoot, options.sourceSigningPrivateKey, "ed25519", "private");
  const receiverReceiptPublic = await validateKeyFile(options.sourceKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  if (!options.policy && process.env.NODE_ENV !== "test") reject("BACKUP_OPERATIONS_POLICY_REQUIRED");
  await validateEnvelopeWithKey(sourcePackage.envelope, { ...sourceSigningPrivate, key: createPublicKey(sourceSigningPrivate.key) });
  if (options.policy) {
    const { assertBackupOperationsKeyApproved, assertBackupOperationsPolicyMatchesEnvelope } = await import("./backup-operations-policy.mjs");
    assertBackupOperationsPolicyMatchesEnvelope(options.policy, sourcePackage.envelope);
    assertBackupOperationsKeyApproved(options.policy, "source_signing", sourceSigningPrivate.fingerprint, now);
    assertBackupOperationsKeyApproved(options.policy, "receiver_encryption", sourcePackage.envelope.receiver.encryption_key_fingerprint, now);
    assertBackupOperationsKeyApproved(options.policy, "receiver_receipt", receiverReceiptPublic.fingerprint, now);
  }
  const receiverReceiptFile = path.resolve(options.receiverReceiptFile);
  const receiverReceipt = validateTransferReceipt(await safeCanonicalJson(receiverReceiptFile, "TRANSFER_RECEIPT_INVALID"));
  verifyObjectSignature(receiverReceipt, receiverReceiptPublic.key, receiptSigningBody, "TRANSFER_RECEIPT_SIGNATURE_INVALID");
  if (receiverReceipt.receiver_receipt_key_fingerprint !== receiverReceiptPublic.fingerprint
    || receiverReceipt.receiver_receipt_key_fingerprint !== sourcePackage.envelope.receiver.receipt_key_fingerprint
    || receiverReceipt.source_signing_key_fingerprint !== sourceSigningPrivate.fingerprint
    || receiverReceipt.transfer_id !== sourcePackage.envelope.transfer_id || receiverReceipt.backup_id !== sourcePackage.envelope.backup_id
    || receiverReceipt.source_location_id !== sourcePackage.envelope.source.location_id
    || receiverReceipt.receiver_encryption_key_fingerprint !== sourcePackage.envelope.receiver.encryption_key_fingerprint
    || receiverReceipt.envelope_sha256 !== sourcePackage.envelopeSha || receiverReceipt.payload_sha256 !== sourcePackage.envelope.payload.sha256
    || receiverReceipt.payload_bytes !== sourcePackage.envelope.payload.bytes || receiverReceipt.receiver_location_id !== sourcePackage.envelope.receiver.location_id
    || receiverReceipt.inner_manifest_sha256 !== sourcePackage.envelope.inner.manifest_sha256
    || receiverReceipt.local_receipt_sha256 !== sourcePackage.envelope.inner.local_receipt_sha256
    || Date.parse(receiverReceipt.received_at) < Date.parse(sourcePackage.envelope.created_at)
    || Date.parse(receiverReceipt.received_at) > Date.parse(sourcePackage.envelope.inner.expires_at)) reject("TRANSFER_RECEIPT_CHAIN_INVALID");
  const acceptedAt = (options.acceptedAt || now.toISOString());
  iso(acceptedAt, "TRANSFER_ACCEPTANCE_TIME_INVALID");
  if (Date.parse(acceptedAt) < Date.parse(receiverReceipt.received_at) || Date.parse(acceptedAt) > now.getTime() + MAX_CLOCK_SKEW_MS) reject("TRANSFER_ACCEPTANCE_TIME_INVALID");
  const body = {
    schema_version: 1,
    contract: OFFHOST_ACCEPTANCE_CONTRACT,
    status: "RECEIVER_RECEIPT_ACCEPTED",
    transfer_id: sourcePackage.envelope.transfer_id,
    backup_id: sourcePackage.envelope.backup_id,
    accepted_at: acceptedAt,
    source_location_id: sourcePackage.envelope.source.location_id,
    receiver_location_id: sourcePackage.envelope.receiver.location_id,
    source_signing_key_fingerprint: sourceSigningPrivate.fingerprint,
    receiver_receipt_key_fingerprint: receiverReceiptPublic.fingerprint,
    envelope_sha256: sourcePackage.envelopeSha,
    receiver_receipt_sha256: await sha256File(receiverReceiptFile),
    attestation: "SOURCE_VERIFIED_SIGNED_RECEIVER_ACKNOWLEDGEMENT",
  };
  const acceptance = validateTransferAcceptance({
    ...body,
    signature: { algorithm: "Ed25519", key_fingerprint: sourceSigningPrivate.fingerprint, value_base64: sign(null, Buffer.from(canonicalTransferJson(body)), sourceSigningPrivate.key).toString("base64") },
  });
  const outboxRoot = path.dirname(sourcePackage.packageDirectory);
  await validateDedicatedRoot(outboxRoot, OUTBOX_ROOT_MARKER, OUTBOX_ROOT_MARKER_VALUE, "OUTBOX_ROOT_UNSAFE");
  const acceptanceFile = path.join(outboxRoot, `${sourcePackage.envelope.transfer_id}.accepted.json`);
  await atomicNoClobberJson(acceptanceFile, acceptance, 0o400, "TRANSFER_ACCEPTANCE_CONFLICT");
  await Promise.all([assertKeyUnchanged(sourceSigningPrivate), assertKeyUnchanged(receiverReceiptPublic)]);
  return { acceptance, acceptanceFile };
}

export async function acceptOffhostTransferReceipt(options) {
  const sourcePackage = path.resolve(options.sourcePackageDirectory);
  const root = await validateDedicatedRoot(path.dirname(sourcePackage), OUTBOX_ROOT_MARKER, OUTBOX_ROOT_MARKER_VALUE, "OUTBOX_ROOT_UNSAFE");
  if (path.dirname(sourcePackage) !== root) reject("TRANSFER_PACKAGE_UNSAFE");
  const release = await acquireFilesystemLock(root, ".offhost-transfer-v1.lock");
  try { return await acceptOffhostTransferReceiptUnlocked(options); } finally { await release(); }
}

async function materializeOffhostTransferForRestoreUnlocked(options) {
  const transferId = boundedString(options.transferId, IDENTIFIER, "TRANSFER_ID_INVALID");
  const backupId = boundedString(options.backupId, IDENTIFIER, "BACKUP_ID_INVALID");
  const destinationRoot = await validateDedicatedRoot(options.destinationRoot, OFFHOST_MATERIALIZATION_ROOT_MARKER, OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE, "MATERIALIZATION_ROOT_UNSAFE");
  assertNoRootOverlap([destinationRoot, options.receiverPackageDirectory, options.receiverKeyRoot]);
  const receiverEncryptionPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverEncryptionPrivateKey, "x25519", "private");
  const sourceSigningPublic = await validateKeyFile(options.receiverKeyRoot, options.trustedSourceSigningPublicKey, "ed25519", "public");
  const receiverReceiptPublic = await validateKeyFile(options.receiverKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  if (!options.acceptanceFile || !options.policy) reject("MATERIALIZATION_PROVENANCE_REQUIRED");
  const packageInfo = await verifyOffhostTransferEvidence({
    receiverPackageDirectory: options.receiverPackageDirectory,
    acceptanceFile: options.acceptanceFile,
    receiverKeyRoot: options.receiverKeyRoot,
    trustedSourceSigningPublicKey: options.trustedSourceSigningPublicKey,
    receiverEncryptionPrivateKey: options.receiverEncryptionPrivateKey,
    receiverReceiptPublicKey: options.receiverReceiptPublicKey,
    policy: options.policy,
    now: options.now,
    requireFresh: options.requireFresh,
  });
  if (packageInfo.envelope.transfer_id !== transferId || packageInfo.envelope.backup_id !== backupId) reject("MATERIALIZATION_IDENTITY_MISMATCH");
  const finalBackup = path.join(destinationRoot, backupId);
  const stage = path.join(destinationRoot, `.materializing-${transferId}`);
  const materializationReceiptFile = path.join(destinationRoot, `${backupId}.${transferId}.materialization.json`);
  if (await lstat(finalBackup).catch((error) => error?.code === "ENOENT" ? null : reject("MATERIALIZATION_TARGET_UNSAFE"))) {
    await safeRemoveStage(destinationRoot, stage, `.materializing-${transferId}`);
    const verified = await verifyMaterializedOffhostTransferUnlocked(options);
    return { backupDirectory: verified.backupDirectory, offhostReceiptFile: packageInfo.offhostReceiptFile, receiverReceiptFile: packageInfo.receiverReceiptFile, envelopeSha256: packageInfo.envelopeSha, materializationReceiptFile };
  }
  await safeRemoveStage(destinationRoot, stage, `.materializing-${transferId}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const materialized = await materializeInto(packageInfo, receiverEncryptionPrivate, stage);
    if (materialized.bundle.manifestSha !== packageInfo.receiverReceipt.inner_manifest_sha256
      || materialized.bundle.localReceiptSha !== packageInfo.receiverReceipt.local_receipt_sha256) reject("MATERIALIZATION_CHAIN_INVALID");
    failAt(options, "AFTER_RESTORE_DECRYPT");
    const { backupOperationsPolicySha256 } = await import("./backup-operations-policy.mjs");
    const materializedAt = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(materializedAt.getTime())) reject("NOW_INVALID");
    const receiptBody = {
      schema_version: 1,
      contract: OFFHOST_MATERIALIZATION_CONTRACT,
      status: "MATERIALIZED_FOR_RESTORE",
      transfer_id: transferId,
      backup_id: backupId,
      materialized_at: materializedAt.toISOString(),
      envelope_sha256: packageInfo.envelopeSha,
      receiver_receipt_sha256: packageInfo.receiverReceiptSha,
      acceptance_sha256: packageInfo.acceptanceSha,
      policy_sha256: backupOperationsPolicySha256(options.policy),
      manifest_sha256: packageInfo.envelope.inner.manifest_sha256,
      attestation: "SIGNED_ENCRYPTED_OFFHOST_CHAIN_VERIFIED_BEFORE_TRANSIENT_MATERIALIZATION",
    };
    const materializationReceipt = validateMaterializationReceipt({ ...receiptBody, integrity_sha256: transferSha256(receiptBody) });
    await atomicNoClobberJson(materializationReceiptFile, materializationReceipt, 0o400, "MATERIALIZATION_RECEIPT_CONFLICT");
    await moveDirectoryNoClobber(materialized.backupDirectory, finalBackup, "MATERIALIZATION_PROMOTION_CONFLICT");
    await syncDirectory(destinationRoot);
    await safeRemoveStage(destinationRoot, stage, `.materializing-${transferId}`);
    await Promise.all([assertKeyUnchanged(receiverEncryptionPrivate), assertKeyUnchanged(sourceSigningPublic), assertKeyUnchanged(receiverReceiptPublic)]);
    return {
      backupDirectory: finalBackup,
      offhostReceiptFile: packageInfo.offhostReceiptFile,
      receiverReceiptFile: packageInfo.receiverReceiptFile,
      envelopeSha256: packageInfo.envelopeSha,
      materializationReceiptFile,
    };
  } catch (error) {
    try { await safeRemoveStage(destinationRoot, stage, `.materializing-${transferId}`); } catch { reject("MATERIALIZATION_CLEANUP_FAILED"); }
    throw error;
  }
}

export async function materializeOffhostTransferForRestore(options) {
  const root = await validateDedicatedRoot(options.destinationRoot, OFFHOST_MATERIALIZATION_ROOT_MARKER, OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE, "MATERIALIZATION_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root, ".offhost-transfer-v1.lock");
  try { return await materializeOffhostTransferForRestoreUnlocked(options); } finally { await release(); }
}

async function verifyMaterializedOffhostTransferUnlocked(options) {
  const transferId = boundedString(options.transferId, IDENTIFIER, "TRANSFER_ID_INVALID");
  const backupId = boundedString(options.backupId, IDENTIFIER, "BACKUP_ID_INVALID");
  const destinationRoot = await validateDedicatedRoot(options.destinationRoot, OFFHOST_MATERIALIZATION_ROOT_MARKER, OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE, "MATERIALIZATION_ROOT_UNSAFE");
  const chain = await verifyOffhostTransferEvidence({
    receiverPackageDirectory: options.receiverPackageDirectory,
    acceptanceFile: options.acceptanceFile,
    receiverKeyRoot: options.receiverKeyRoot,
    receiverEncryptionPrivateKey: options.receiverEncryptionPrivateKey,
    trustedSourceSigningPublicKey: options.trustedSourceSigningPublicKey,
    receiverReceiptPublicKey: options.receiverReceiptPublicKey,
    policy: options.policy,
    now: options.now,
    requireFresh: options.requireFresh,
  });
  const receiptFile = path.join(destinationRoot, `${backupId}.${transferId}.materialization.json`);
  const receipt = validateMaterializationReceipt(await safeCanonicalJson(receiptFile, "MATERIALIZATION_RECEIPT_INVALID"));
  const { backupOperationsPolicySha256 } = await import("./backup-operations-policy.mjs");
  const backupDirectory = path.join(destinationRoot, backupId);
  const manifestFile = path.join(backupDirectory, "manifest.json");
  await safeDirectory(backupDirectory, "MATERIALIZATION_TARGET_UNSAFE");
  if (receipt.transfer_id !== transferId || receipt.backup_id !== backupId || chain.envelope.transfer_id !== transferId || chain.envelope.backup_id !== backupId
    || receipt.envelope_sha256 !== chain.envelopeSha || receipt.receiver_receipt_sha256 !== chain.receiverReceiptSha
    || receipt.acceptance_sha256 !== chain.acceptanceSha || receipt.policy_sha256 !== backupOperationsPolicySha256(options.policy)
    || receipt.manifest_sha256 !== chain.envelope.inner.manifest_sha256 || await sha256File(manifestFile) !== receipt.manifest_sha256) reject("MATERIALIZATION_CHAIN_INVALID");
  return { backupDirectory, materializationReceiptFile: receiptFile, chain };
}

export async function verifyMaterializedOffhostTransfer(options) {
  const root = await validateDedicatedRoot(options.destinationRoot, OFFHOST_MATERIALIZATION_ROOT_MARKER, OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE, "MATERIALIZATION_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root, ".offhost-transfer-v1.lock");
  try { return await verifyMaterializedOffhostTransferUnlocked(options); } finally { await release(); }
}

export async function cleanupMaterializedOffhostTransfer(options) {
  if (options.confirm !== "REMOVE_EXACT_VERIFIED_MATERIALIZATION") reject("MATERIALIZATION_CLEANUP_CONFIRMATION_REQUIRED");
  const root = await validateDedicatedRoot(options.destinationRoot, OFFHOST_MATERIALIZATION_ROOT_MARKER, OFFHOST_MATERIALIZATION_ROOT_MARKER_VALUE, "MATERIALIZATION_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root, ".offhost-transfer-v1.lock");
  try {
    const verified = await verifyMaterializedOffhostTransferUnlocked({ ...options, requireFresh: false });
    const entries = await readdir(verified.backupDirectory, { withFileTypes: true });
    if (entries.length !== INNER_FILES.length || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !INNER_FILES.includes(entry.name))) reject("MATERIALIZATION_TARGET_UNSAFE");
    const rootMetadata = await lstat(root);
    const backupMetadata = await lstat(verified.backupDirectory);
    if (backupMetadata.dev !== rootMetadata.dev || backupMetadata.uid !== rootMetadata.uid) reject("MATERIALIZATION_TARGET_UNSAFE");
    await chmod(verified.backupDirectory, 0o700);
    await rm(verified.backupDirectory, { recursive: true, force: false });
    await unlink(verified.materializationReceiptFile);
    await syncDirectory(root);
    return true;
  } finally { await release(); }
}

function cliArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || index + 1 >= argv.length || result[key.slice(2)] !== undefined) reject("ARGUMENT_INVALID");
    result[key.slice(2)] = argv[index + 1];
  }
  return result;
}

function only(input, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(input).some((key) => !allowed.has(key)) || required.some((key) => input[key] === undefined)) reject("ARGUMENT_SET_INVALID");
}

async function operationsPolicyFile(file) {
  const { validateBackupOperationsPolicy } = await import("./backup-operations-policy.mjs");
  return validateBackupOperationsPolicy(await safeJson(path.resolve(file), "BACKUP_OPERATIONS_POLICY_INVALID"));
}

async function main(argv) {
  const [commandName, ...rest] = argv;
  const input = cliArgs(rest);
  if (commandName === "seal") {
    only(input, ["backup", "local-receipt", "outbox-root", "source-key-root", "source-signing-private-key", "receiver-encryption-public-key", "receiver-receipt-public-key", "receiver-location-id", "created-at", "policy"], ["transfer-id"]);
    const result = await sealOffhostTransfer({ backupDirectory: input.backup, localReceiptFile: input["local-receipt"], outboxRoot: input["outbox-root"], sourceKeyRoot: input["source-key-root"], sourceSigningPrivateKey: input["source-signing-private-key"], receiverEncryptionPublicKey: input["receiver-encryption-public-key"], receiverReceiptPublicKey: input["receiver-receipt-public-key"], transferId: input["transfer-id"], receiverLocationId: input["receiver-location-id"], createdAt: input["created-at"], policy: await operationsPolicyFile(input.policy) });
    process.stdout.write(`${result.envelope.transfer_id} SEALED\n`);
    return;
  }
  if (commandName === "receive") {
    only(input, ["incoming-package", "receiver-root", "receiver-key-root", "receiver-encryption-private-key", "trusted-source-signing-public-key", "receiver-receipt-private-key", "migrations", "receiver-location-id", "retention-policy-id", "policy"], ["machine-identity-file"]);
    const result = await receiveOffhostTransfer({ incomingPackageDirectory: input["incoming-package"], receiverRoot: input["receiver-root"], receiverKeyRoot: input["receiver-key-root"], receiverEncryptionPrivateKey: input["receiver-encryption-private-key"], trustedSourceSigningPublicKey: input["trusted-source-signing-public-key"], receiverReceiptPrivateKey: input["receiver-receipt-private-key"], migrationsDirectory: input.migrations, receiverLocationId: input["receiver-location-id"], retentionPolicyId: input["retention-policy-id"], machineIdentityFile: input["machine-identity-file"], policy: await operationsPolicyFile(input.policy) });
    process.stdout.write(`${result.envelope.transfer_id} OFFHOST_VERIFIED\n`);
    return;
  }
  if (commandName === "accept-receipt") {
    only(input, ["source-package", "receiver-receipt", "source-key-root", "source-signing-private-key", "receiver-receipt-public-key", "accepted-at", "policy"]);
    const result = await acceptOffhostTransferReceipt({ sourcePackageDirectory: input["source-package"], receiverReceiptFile: input["receiver-receipt"], sourceKeyRoot: input["source-key-root"], sourceSigningPrivateKey: input["source-signing-private-key"], receiverReceiptPublicKey: input["receiver-receipt-public-key"], acceptedAt: input["accepted-at"], policy: await operationsPolicyFile(input.policy) });
    process.stdout.write(`${result.acceptance.transfer_id} RECEIVER_RECEIPT_ACCEPTED\n`);
    return;
  }
  if (commandName === "materialize-for-restore") {
    only(input, ["receiver-package", "acceptance", "receiver-key-root", "receiver-encryption-private-key", "trusted-source-signing-public-key", "receiver-receipt-public-key", "destination-root", "transfer-id", "backup-id", "policy"]);
    await materializeOffhostTransferForRestore({ receiverPackageDirectory: input["receiver-package"], acceptanceFile: input.acceptance, receiverKeyRoot: input["receiver-key-root"], receiverEncryptionPrivateKey: input["receiver-encryption-private-key"], trustedSourceSigningPublicKey: input["trusted-source-signing-public-key"], receiverReceiptPublicKey: input["receiver-receipt-public-key"], destinationRoot: input["destination-root"], transferId: input["transfer-id"], backupId: input["backup-id"], policy: await operationsPolicyFile(input.policy) });
    process.stdout.write(`${input["transfer-id"]} MATERIALIZED_FOR_RESTORE\n`);
    return;
  }
  if (commandName === "verify-materialized-for-restore") {
    only(input, ["receiver-package", "acceptance", "receiver-key-root", "receiver-encryption-private-key", "trusted-source-signing-public-key", "receiver-receipt-public-key", "destination-root", "transfer-id", "backup-id", "policy"]);
    await verifyMaterializedOffhostTransfer({ receiverPackageDirectory: input["receiver-package"], acceptanceFile: input.acceptance, receiverKeyRoot: input["receiver-key-root"], receiverEncryptionPrivateKey: input["receiver-encryption-private-key"], trustedSourceSigningPublicKey: input["trusted-source-signing-public-key"], receiverReceiptPublicKey: input["receiver-receipt-public-key"], destinationRoot: input["destination-root"], transferId: input["transfer-id"], backupId: input["backup-id"], policy: await operationsPolicyFile(input.policy) });
    process.stdout.write(`${input["transfer-id"]} MATERIALIZATION_VERIFIED\n`);
    return;
  }
  if (commandName === "cleanup-materialized-for-restore") {
    only(input, ["receiver-package", "acceptance", "receiver-key-root", "receiver-encryption-private-key", "trusted-source-signing-public-key", "receiver-receipt-public-key", "destination-root", "transfer-id", "backup-id", "policy", "confirm"]);
    await cleanupMaterializedOffhostTransfer({ receiverPackageDirectory: input["receiver-package"], acceptanceFile: input.acceptance, receiverKeyRoot: input["receiver-key-root"], receiverEncryptionPrivateKey: input["receiver-encryption-private-key"], trustedSourceSigningPublicKey: input["trusted-source-signing-public-key"], receiverReceiptPublicKey: input["receiver-receipt-public-key"], destinationRoot: input["destination-root"], transferId: input["transfer-id"], backupId: input["backup-id"], policy: await operationsPolicyFile(input.policy), confirm: input.confirm });
    process.stdout.write(`${input["transfer-id"]} MATERIALIZATION_REMOVED\n`);
    return;
  }
  reject("COMMAND_INVALID");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof OffhostTransferError && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`offhost transfer rejected: ${code}\n`);
    process.exitCode = 1;
  });
}
