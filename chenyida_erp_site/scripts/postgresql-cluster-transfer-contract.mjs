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
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  KEY_ROOT_MARKER,
  KEY_ROOT_MARKER_VALUE,
  canonicalTransferJson,
  transferSha256,
  validateTransferAcceptance,
  validateTransferEnvelope,
  validateTransferReceipt,
} from "./offhost-transfer-contract.mjs";
import {
  canonicalClusterJson,
  validateClusterRecoveryPolicy,
  validateClusterSnapshot,
} from "./postgresql-cluster-recovery-contract.mjs";

export const CLUSTER_CAPSULE_CONTRACT = "chenyida-erp-postgresql-cluster-capsule/v1";
export const CLUSTER_CAPSULE_RECEIPT_CONTRACT = "chenyida-erp-postgresql-cluster-capsule-receipt/v1";
export const CLUSTER_CAPSULE_ACCEPTANCE_CONTRACT = "chenyida-erp-postgresql-cluster-capsule-acceptance/v1";
export const JOINT_TRANSFER_CONTRACT = "chenyida-erp-joint-offhost-transfer/v2";
export const CLUSTER_OUTBOX_ROOT_MARKER = ".chenyida-erp-cluster-transfer-outbox-v1";
export const CLUSTER_OUTBOX_ROOT_MARKER_VALUE = "chenyida-erp-cluster-transfer-outbox/v1\n";
export const CLUSTER_RECEIVER_ROOT_MARKER = ".chenyida-erp-cluster-transfer-receiver-v1";
export const CLUSTER_RECEIVER_ROOT_MARKER_VALUE = "chenyida-erp-cluster-transfer-receiver/v1\n";
export const JOINT_TRANSFER_ROOT_MARKER = ".chenyida-erp-joint-transfer-root-v2";
export const JOINT_TRANSFER_ROOT_MARKER_VALUE = "chenyida-erp-joint-transfer-root/v2\n";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PG_MAJOR = /^(?:1[0-9]|[2-9][0-9])$/;
const EVIDENCE_SCOPES = new Set(["ACTUAL_CONTROLLED", "SYNTHETIC_TEST_ONLY"]);
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = MAX_JSON_BYTES;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export class ClusterTransferError extends Error {
  constructor(code) {
    super(code);
    this.name = "ClusterTransferError";
    this.code = code;
  }
}

function reject(code) {
  throw new ClusterTransferError(code);
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

function string(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function positiveInteger(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) reject(code);
  return value;
}

function iso(value, code) {
  string(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function evidenceScope(value, code) {
  if (!EVIDENCE_SCOPES.has(value)) reject(code);
  return value;
}

function assertActualOperationRoot(scope) {
  if (scope === "ACTUAL_CONTROLLED" && process.getuid?.() !== 0) reject("ACTUAL_CLUSTER_TRANSFER_REQUIRES_ROOT");
}

function bufferFromBase64(value, expectedBytes, code) {
  string(value, BASE64, code);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) reject(code);
  return decoded;
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function publicKeyFingerprint(key) {
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

function encodePublicKey(key) {
  return key.export({ format: "der", type: "spki" }).toString("base64");
}

function parsePublicDer(value, expectedType, code) {
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(string(value, BASE64, code), "base64"), format: "der", type: "spki" });
  } catch {
    reject(code);
  }
  if (key.asymmetricKeyType !== expectedType
    || key.export({ format: "der", type: "spki" }).toString("base64") !== value) reject(code);
  return key;
}

function asKey(value, visibility, expectedType, code) {
  let key;
  try {
    key = value?.type && value?.asymmetricKeyType
      ? value
      : visibility === "private" ? createPrivateKey(value) : createPublicKey(value);
  } catch {
    reject(code);
  }
  if (key.asymmetricKeyType !== expectedType || key.type !== visibility) reject(code);
  return key;
}

function signature(value, expectedFingerprint, code) {
  exactKeys(value, ["algorithm", "key_fingerprint", "value_base64"], code);
  if (value.algorithm !== "Ed25519" || value.key_fingerprint !== expectedFingerprint) reject(code);
  bufferFromBase64(value.value_base64, 64, code);
  return value;
}

function signingBody(value) {
  const body = { ...value };
  delete body.signature;
  return body;
}

function signDocument(body, key, fingerprint) {
  return {
    ...body,
    signature: {
      algorithm: "Ed25519",
      key_fingerprint: fingerprint,
      value_base64: sign(null, Buffer.from(canonicalTransferJson(body)), key).toString("base64"),
    },
  };
}

function verifyDocument(value, key, code) {
  const valid = verify(
    null,
    Buffer.from(canonicalTransferJson(signingBody(value))),
    key,
    Buffer.from(value.signature.value_base64, "base64"),
  );
  if (!valid) reject(code);
}

function capsuleAadProjection(value) {
  return {
    schema_version: value.schema_version,
    contract: value.contract,
    status: value.status,
    cluster_transfer_id: value.cluster_transfer_id,
    backup_id: value.backup_id,
    created_at: value.created_at,
    evidence_scope: value.evidence_scope,
    source: value.source,
    receiver: value.receiver,
    inner: value.inner,
    encryption: {
      payload_algorithm: value.encryption.payload_algorithm,
      key_agreement: value.encryption.key_agreement,
      key_derivation: value.encryption.key_derivation,
      ephemeral_public_key_der_base64: value.encryption.ephemeral_public_key_der_base64,
      salt_base64: value.encryption.salt_base64,
      nonce_base64: value.encryption.nonce_base64,
    },
    payload: { file: value.payload.file, format: value.payload.format },
  };
}

export function validateClusterCapsule(value) {
  exactKeys(value, [
    "schema_version", "contract", "status", "cluster_transfer_id", "backup_id", "created_at", "evidence_scope",
    "source", "receiver", "inner", "encryption", "payload", "signature",
  ], "CLUSTER_CAPSULE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_CAPSULE_CONTRACT || value.status !== "SEALED") reject("CLUSTER_CAPSULE_VERSION_INVALID");
  string(value.cluster_transfer_id, IDENTIFIER, "CLUSTER_TRANSFER_ID_INVALID");
  string(value.backup_id, IDENTIFIER, "CLUSTER_CAPSULE_BACKUP_ID_INVALID");
  iso(value.created_at, "CLUSTER_CAPSULE_TIME_INVALID");
  evidenceScope(value.evidence_scope, "CLUSTER_CAPSULE_SCOPE_INVALID");
  exactKeys(value.source, ["location_id", "machine_identity_sha256", "signing_key_fingerprint"], "CLUSTER_CAPSULE_SOURCE_INVALID");
  string(value.source.location_id, IDENTIFIER, "CLUSTER_CAPSULE_SOURCE_INVALID");
  for (const key of ["machine_identity_sha256", "signing_key_fingerprint"]) string(value.source[key], SHA256, "CLUSTER_CAPSULE_SOURCE_INVALID");
  exactKeys(value.receiver, ["location_id", "encryption_key_fingerprint", "receipt_key_fingerprint"], "CLUSTER_CAPSULE_RECEIVER_INVALID");
  string(value.receiver.location_id, IDENTIFIER, "CLUSTER_CAPSULE_RECEIVER_INVALID");
  if (value.receiver.location_id === value.source.location_id) reject("CLUSTER_TRANSFER_LOCATION_NOT_DISTINCT");
  for (const key of ["encryption_key_fingerprint", "receipt_key_fingerprint"]) string(value.receiver[key], SHA256, "CLUSTER_CAPSULE_RECEIVER_INVALID");
  exactKeys(value.inner, [
    "snapshot_sha256", "policy_id", "policy_sha256", "manifest_sha256", "local_receipt_sha256",
    "recovery_point_at", "expires_at", "postgresql_major",
  ], "CLUSTER_CAPSULE_INNER_INVALID");
  for (const key of ["snapshot_sha256", "policy_sha256", "manifest_sha256", "local_receipt_sha256"]) string(value.inner[key], SHA256, "CLUSTER_CAPSULE_INNER_INVALID");
  string(value.inner.policy_id, IDENTIFIER, "CLUSTER_CAPSULE_INNER_INVALID");
  string(value.inner.postgresql_major, PG_MAJOR, "CLUSTER_CAPSULE_INNER_INVALID");
  iso(value.inner.recovery_point_at, "CLUSTER_CAPSULE_INNER_INVALID");
  iso(value.inner.expires_at, "CLUSTER_CAPSULE_INNER_INVALID");
  if (Date.parse(value.inner.recovery_point_at) > Date.parse(value.created_at)
    || Date.parse(value.created_at) >= Date.parse(value.inner.expires_at)) reject("CLUSTER_CAPSULE_TIME_CHAIN_INVALID");
  exactKeys(value.encryption, [
    "payload_algorithm", "key_agreement", "key_derivation", "ephemeral_public_key_der_base64",
    "salt_base64", "nonce_base64", "tag_base64", "aad_sha256",
  ], "CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  if (value.encryption.payload_algorithm !== "AES-256-GCM" || value.encryption.key_agreement !== "X25519"
    || value.encryption.key_derivation !== "HKDF-SHA256") reject("CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  const ephemeral = parsePublicDer(value.encryption.ephemeral_public_key_der_base64, "x25519", "CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  bufferFromBase64(value.encryption.salt_base64, 32, "CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  bufferFromBase64(value.encryption.nonce_base64, 12, "CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  bufferFromBase64(value.encryption.tag_base64, 16, "CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  string(value.encryption.aad_sha256, SHA256, "CLUSTER_CAPSULE_ENCRYPTION_INVALID");
  exactKeys(value.payload, ["file", "format", "sha256", "bytes"], "CLUSTER_CAPSULE_PAYLOAD_INVALID");
  if (value.payload.file !== "cluster-snapshot.enc" || value.payload.format !== "CANONICAL_JSON_AES_256_GCM_V1") reject("CLUSTER_CAPSULE_PAYLOAD_INVALID");
  string(value.payload.sha256, SHA256, "CLUSTER_CAPSULE_PAYLOAD_INVALID");
  positiveInteger(value.payload.bytes, MAX_PAYLOAD_BYTES, "CLUSTER_CAPSULE_PAYLOAD_INVALID");
  const aad = Buffer.from(canonicalTransferJson(capsuleAadProjection(value)));
  if (transferSha256(aad) !== value.encryption.aad_sha256) reject("CLUSTER_CAPSULE_AAD_INVALID");
  signature(value.signature, value.source.signing_key_fingerprint, "CLUSTER_CAPSULE_SIGNATURE_INVALID");
  return { value, ephemeral, aad };
}

export function validateClusterCapsuleReceipt(value) {
  exactKeys(value, [
    "schema_version", "contract", "status", "cluster_transfer_id", "backup_id", "received_at", "evidence_scope",
    "source_location_id", "receiver_location_id", "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint",
    "receiver_receipt_key_fingerprint", "capsule_sha256", "payload_sha256", "payload_bytes", "snapshot_sha256",
    "policy_sha256", "manifest_sha256", "local_receipt_sha256", "recovery_point_at", "expires_at",
    "retention_policy_id", "retention_status", "attestation", "signature",
  ], "CLUSTER_CAPSULE_RECEIPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_CAPSULE_RECEIPT_CONTRACT || value.status !== "CLUSTER_CAPSULE_VERIFIED") reject("CLUSTER_CAPSULE_RECEIPT_VERSION_INVALID");
  for (const key of ["cluster_transfer_id", "backup_id", "source_location_id", "receiver_location_id", "retention_policy_id"]) string(value[key], IDENTIFIER, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  if (value.source_location_id === value.receiver_location_id) reject("CLUSTER_TRANSFER_LOCATION_NOT_DISTINCT");
  iso(value.received_at, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  iso(value.recovery_point_at, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  iso(value.expires_at, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  if (Date.parse(value.received_at) < Date.parse(value.recovery_point_at)
    || Date.parse(value.received_at) > Date.parse(value.expires_at)) reject("CLUSTER_CAPSULE_RECEIPT_TIME_INVALID");
  evidenceScope(value.evidence_scope, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  for (const key of [
    "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint",
    "capsule_sha256", "payload_sha256", "snapshot_sha256", "policy_sha256", "manifest_sha256", "local_receipt_sha256",
  ]) string(value[key], SHA256, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  positiveInteger(value.payload_bytes, MAX_PAYLOAD_BYTES, "CLUSTER_CAPSULE_RECEIPT_INVALID");
  if (value.retention_status !== "PLANNED_NO_DELETION"
    || value.attestation !== "SIGNED_ENCRYPTED_CLUSTER_SNAPSHOT_DECRYPTED_AND_VALIDATED_AT_DISTINCT_RECEIVER") reject("CLUSTER_CAPSULE_RECEIPT_INVALID");
  signature(value.signature, value.receiver_receipt_key_fingerprint, "CLUSTER_CAPSULE_RECEIPT_SIGNATURE_INVALID");
  return value;
}

export function validateClusterCapsuleAcceptance(value) {
  exactKeys(value, [
    "schema_version", "contract", "status", "cluster_transfer_id", "backup_id", "accepted_at", "evidence_scope",
    "source_location_id", "receiver_location_id", "source_signing_key_fingerprint", "receiver_receipt_key_fingerprint",
    "capsule_sha256", "receiver_receipt_sha256", "snapshot_sha256", "policy_sha256", "manifest_sha256",
    "local_receipt_sha256", "recovery_point_at", "expires_at", "attestation", "signature",
  ], "CLUSTER_CAPSULE_ACCEPTANCE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_CAPSULE_ACCEPTANCE_CONTRACT
    || value.status !== "CLUSTER_RECEIVER_RECEIPT_ACCEPTED") reject("CLUSTER_CAPSULE_ACCEPTANCE_VERSION_INVALID");
  for (const key of ["cluster_transfer_id", "backup_id", "source_location_id", "receiver_location_id"]) string(value[key], IDENTIFIER, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  if (value.source_location_id === value.receiver_location_id) reject("CLUSTER_TRANSFER_LOCATION_NOT_DISTINCT");
  iso(value.accepted_at, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  iso(value.recovery_point_at, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  iso(value.expires_at, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  if (Date.parse(value.accepted_at) < Date.parse(value.recovery_point_at)
    || Date.parse(value.accepted_at) > Date.parse(value.expires_at)) reject("CLUSTER_CAPSULE_ACCEPTANCE_TIME_INVALID");
  evidenceScope(value.evidence_scope, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  for (const key of [
    "source_signing_key_fingerprint", "receiver_receipt_key_fingerprint", "capsule_sha256", "receiver_receipt_sha256",
    "snapshot_sha256", "policy_sha256", "manifest_sha256", "local_receipt_sha256",
  ]) string(value[key], SHA256, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  if (value.attestation !== "SOURCE_VERIFIED_SIGNED_CLUSTER_RECEIVER_ACKNOWLEDGEMENT") reject("CLUSTER_CAPSULE_ACCEPTANCE_INVALID");
  signature(value.signature, value.source_signing_key_fingerprint, "CLUSTER_CAPSULE_ACCEPTANCE_SIGNATURE_INVALID");
  return value;
}

function jointBindingProjection(value) {
  return {
    backup_id: value.backup_id,
    evidence_scope: value.evidence_scope,
    source_location_id: value.source_location_id,
    receiver_location_id: value.receiver_location_id,
    source_machine_identity_sha256: value.source_machine_identity_sha256,
    source_signing_key_fingerprint: value.source_signing_key_fingerprint,
    receiver_encryption_key_fingerprint: value.receiver_encryption_key_fingerprint,
    receiver_receipt_key_fingerprint: value.receiver_receipt_key_fingerprint,
    data: value.data,
    cluster: value.cluster,
  };
}

export function validateJointTransferV2(value) {
  exactKeys(value, [
    "schema_version", "contract", "status", "backup_id", "accepted_at", "evidence_scope", "source_location_id",
    "receiver_location_id", "source_machine_identity_sha256", "source_signing_key_fingerprint",
    "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint", "data", "cluster", "binding_sha256",
    "attestation", "signature",
  ], "JOINT_TRANSFER_FIELDS_INVALID");
  if (value.schema_version !== 2 || value.contract !== JOINT_TRANSFER_CONTRACT
    || value.status !== "DATA_AND_CLUSTER_RECEIVER_ACKNOWLEDGEMENTS_ACCEPTED") reject("JOINT_TRANSFER_VERSION_INVALID");
  for (const key of ["backup_id", "source_location_id", "receiver_location_id"]) string(value[key], IDENTIFIER, "JOINT_TRANSFER_INVALID");
  if (value.source_location_id === value.receiver_location_id) reject("JOINT_TRANSFER_LOCATION_NOT_DISTINCT");
  iso(value.accepted_at, "JOINT_TRANSFER_INVALID");
  evidenceScope(value.evidence_scope, "JOINT_TRANSFER_INVALID");
  for (const key of [
    "source_machine_identity_sha256", "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint",
    "receiver_receipt_key_fingerprint", "binding_sha256",
  ]) string(value[key], SHA256, "JOINT_TRANSFER_INVALID");
  exactKeys(value.data, [
    "transfer_id", "envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "manifest_sha256",
    "local_receipt_sha256", "recovery_point_at", "expires_at", "deployment_class",
  ], "JOINT_TRANSFER_DATA_INVALID");
  string(value.data.transfer_id, IDENTIFIER, "JOINT_TRANSFER_DATA_INVALID");
  if (!["TEST", "UAT", "PRODUCTION"].includes(value.data.deployment_class)) reject("JOINT_TRANSFER_DATA_INVALID");
  for (const key of ["envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "manifest_sha256", "local_receipt_sha256"]) string(value.data[key], SHA256, "JOINT_TRANSFER_DATA_INVALID");
  iso(value.data.recovery_point_at, "JOINT_TRANSFER_DATA_INVALID");
  iso(value.data.expires_at, "JOINT_TRANSFER_DATA_INVALID");
  exactKeys(value.cluster, [
    "transfer_id", "capsule_sha256", "receiver_receipt_sha256", "acceptance_sha256", "snapshot_sha256",
    "policy_sha256", "manifest_sha256", "local_receipt_sha256", "recovery_point_at", "expires_at",
  ], "JOINT_TRANSFER_CLUSTER_INVALID");
  string(value.cluster.transfer_id, IDENTIFIER, "JOINT_TRANSFER_CLUSTER_INVALID");
  for (const key of [
    "capsule_sha256", "receiver_receipt_sha256", "acceptance_sha256", "snapshot_sha256", "policy_sha256",
    "manifest_sha256", "local_receipt_sha256",
  ]) string(value.cluster[key], SHA256, "JOINT_TRANSFER_CLUSTER_INVALID");
  iso(value.cluster.recovery_point_at, "JOINT_TRANSFER_CLUSTER_INVALID");
  iso(value.cluster.expires_at, "JOINT_TRANSFER_CLUSTER_INVALID");
  if (value.data.manifest_sha256 !== value.cluster.manifest_sha256
    || value.data.local_receipt_sha256 !== value.cluster.local_receipt_sha256
    || value.data.recovery_point_at !== value.cluster.recovery_point_at
    || value.data.expires_at !== value.cluster.expires_at) reject("JOINT_TRANSFER_RECOVERY_POINT_MISMATCH");
  if (Date.parse(value.accepted_at) < Date.parse(value.data.recovery_point_at)
    || Date.parse(value.accepted_at) > Date.parse(value.data.expires_at)) reject("JOINT_TRANSFER_TIME_INVALID");
  if ((value.evidence_scope === "SYNTHETIC_TEST_ONLY") !== (value.data.deployment_class === "TEST")) reject("JOINT_TRANSFER_SCOPE_MISMATCH");
  if (transferSha256(jointBindingProjection(value)) !== value.binding_sha256) reject("JOINT_TRANSFER_BINDING_INVALID");
  if (value.attestation !== "SOURCE_CROSS_BOUND_DATA_V1_AND_CLUSTER_CAPSULE_V1_RECEIVER_ACKNOWLEDGEMENTS") reject("JOINT_TRANSFER_INVALID");
  signature(value.signature, value.source_signing_key_fingerprint, "JOINT_TRANSFER_SIGNATURE_INVALID");
  return value;
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

async function safeCanonicalJson(file, code) {
  const source = await safeRead(file, { maxBytes: MAX_JSON_BYTES, code });
  let value;
  try {
    value = parseStrictJson(source.toString("utf8"));
  } catch (error) {
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

async function validateDedicatedRoot(root, markerName, markerValue, code) {
  const resolved = path.resolve(root);
  const metadata = await safeDirectory(resolved, code);
  if (![0o700, 0o750, 0o2750].includes(metadata.mode & 0o7777)) reject(code);
  const markerMetadata = await safeRegularFile(path.join(resolved, markerName), { maxBytes: 256, ownerOnly: true, code });
  const marker = await safeRead(path.join(resolved, markerName), { maxBytes: 256, ownerOnly: true, code });
  if (markerMetadata.uid !== metadata.uid || marker.toString("utf8") !== markerValue) reject(code);
  return resolved;
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
  const key = asKey(record.value, visibility, expectedType, "KEY_TYPE_INVALID");
  return { key, file: resolvedFile, identity: record.identity, fingerprint: publicKeyFingerprint(key.type === "public" ? key : createPublicKey(key)) };
}

async function assertKeyUnchanged(record) {
  const current = await safeReadRecord(record.file, { maxBytes: 64 * 1024, ownerOnly: true, code: "KEY_FILE_UNSAFE" });
  if (current.identity !== record.identity) reject("KEY_CHANGED_DURING_OPERATION");
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

async function copyVerifiedFile(source, target) {
  const expected = await safeRegularFile(source, { maxBytes: MAX_PAYLOAD_BYTES, code: "INCOMING_CLUSTER_FILE_UNSAFE" });
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const output = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const before = await input.stat();
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (bytesRead <= 0) reject("INCOMING_CLUSTER_FILE_CHANGED");
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten <= 0) reject("INCOMING_CLUSTER_COPY_FAILED");
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await output.chmod(0o600);
    await output.sync();
    const after = await input.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.size !== expected.size) reject("INCOMING_CLUSTER_FILE_CHANGED");
  } finally {
    await input.close().catch(() => {});
    await output.close().catch(() => {});
  }
}

async function safeRemoveStage(root, stage, prefix) {
  const resolvedRoot = path.resolve(root), resolvedStage = path.resolve(stage);
  if (!isInside(resolvedStage, resolvedRoot) || path.dirname(resolvedStage) !== resolvedRoot
    || !path.basename(resolvedStage).startsWith(prefix)) reject("CLUSTER_STAGE_PATH_UNSAFE");
  const metadata = await lstat(resolvedStage).catch((error) => error?.code === "ENOENT" ? null : reject("CLUSTER_STAGE_PATH_UNSAFE"));
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()) reject("CLUSTER_STAGE_PATH_UNSAFE");
  await chmod(resolvedStage, 0o700).catch(() => {});
  await rm(resolvedStage, { recursive: true, force: false });
  await syncDirectory(resolvedRoot);
}

async function waitChild(child, code) {
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
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitChild(child, code);
  const sourceAfter = await lstat(source).catch((error) => error?.code === "ENOENT" ? null : reject(code));
  const destinationAfter = await safeDirectory(destination, code);
  if (sourceAfter || destinationAfter.dev !== before.dev || destinationAfter.ino !== before.ino) reject(code);
}

async function acquireFilesystemLock(root) {
  const lockFile = path.join(root, ".cluster-transfer-v1.lock");
  let created = false;
  try {
    const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile("chenyida-erp-cluster-transfer-lock/v1\n"); await handle.sync(); created = true; } finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== "EEXIST") reject("CLUSTER_OPERATION_LOCK_UNSAFE");
  }
  if (created) await syncDirectory(root);
  const metadata = await safeRegularFile(lockFile, { maxBytes: 256, ownerOnly: true, code: "CLUSTER_OPERATION_LOCK_UNSAFE" });
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
  if (!acquired) { child.kill("SIGKILL"); reject("CLUSTER_OPERATION_LOCK_BUSY"); }
  return async () => {
    child.stdin.end("release\n");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("close", resolve));
    const after = await safeRegularFile(lockFile, { maxBytes: 256, ownerOnly: true, code: "CLUSTER_OPERATION_LOCK_UNSAFE" });
    if (after.dev !== metadata.dev || after.ino !== metadata.ino) reject("CLUSTER_OPERATION_LOCK_CHANGED");
  };
}

function assertNoRootOverlap(entries) {
  const resolved = entries.filter(Boolean).map((entry) => path.resolve(entry));
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      if (isInside(resolved[left], resolved[right]) || isInside(resolved[right], resolved[left])) reject("CLUSTER_TRANSFER_ROOTS_OVERLAP");
    }
  }
}

async function readClusterPackage(packageDirectory, expectedFiles = ["capsule.json", "cluster-snapshot.enc"]) {
  const resolved = path.resolve(packageDirectory);
  await safeDirectory(resolved, "CLUSTER_PACKAGE_UNSAFE");
  const entries = await readdir(resolved, { withFileTypes: true });
  if (entries.length !== expectedFiles.length
    || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !expectedFiles.includes(entry.name))) reject("CLUSTER_PACKAGE_FILE_SET_INVALID");
  const capsuleFile = path.join(resolved, "capsule.json"), payloadFile = path.join(resolved, "cluster-snapshot.enc");
  const capsule = validateClusterCapsule(await safeCanonicalJson(capsuleFile, "CLUSTER_CAPSULE_INVALID")).value;
  const payload = await safeRegularFile(payloadFile, { maxBytes: MAX_PAYLOAD_BYTES, code: "CLUSTER_PAYLOAD_UNSAFE" });
  if (payload.size !== capsule.payload.bytes || transferSha256(await safeRead(payloadFile, { maxBytes: MAX_PAYLOAD_BYTES, code: "CLUSTER_PAYLOAD_UNSAFE" })) !== capsule.payload.sha256) reject("CLUSTER_PAYLOAD_IDENTITY_MISMATCH");
  return { packageDirectory: resolved, capsuleFile, payloadFile, capsule, capsuleSha: transferSha256(await safeRead(capsuleFile, { maxBytes: MAX_JSON_BYTES, code: "CLUSTER_CAPSULE_INVALID" })) };
}

function verifyCapsuleSignature(capsule, sourcePublicKey) {
  const key = asKey(sourcePublicKey, "public", "ed25519", "SOURCE_SIGNING_KEY_INVALID");
  const fingerprint = publicKeyFingerprint(key);
  if (capsule.source.signing_key_fingerprint !== fingerprint) reject("SOURCE_SIGNING_KEY_NOT_APPROVED");
  verifyDocument(capsule, key, "CLUSTER_CAPSULE_SIGNATURE_INVALID");
  return { key, fingerprint };
}

function assertSnapshotBindings(snapshot, policy, capsule) {
  validateClusterSnapshot(snapshot, policy);
  if (snapshot.snapshot_sha256 !== capsule.inner.snapshot_sha256
    || snapshot.policy_id !== capsule.inner.policy_id
    || snapshot.policy_sha256 !== capsule.inner.policy_sha256
    || snapshot.binding.backup_id !== capsule.backup_id
    || snapshot.binding.manifest_sha256 !== capsule.inner.manifest_sha256
    || snapshot.binding.local_receipt_sha256 !== capsule.inner.local_receipt_sha256
    || snapshot.binding.recovery_point_at !== capsule.inner.recovery_point_at
    || snapshot.binding.source.postgresql_major !== capsule.inner.postgresql_major) reject("CLUSTER_CAPSULE_SNAPSHOT_BINDING_INVALID");
}

function decryptClusterPayload(packageInfo, receiverPrivateKey, policy) {
  const validated = validateClusterCapsule(packageInfo.capsule);
  const privateKey = asKey(receiverPrivateKey, "private", "x25519", "RECEIVER_DECRYPTION_KEY_INVALID");
  if (publicKeyFingerprint(createPublicKey(privateKey)) !== packageInfo.capsule.receiver.encryption_key_fingerprint) reject("RECEIVER_DECRYPTION_KEY_NOT_APPROVED");
  let sharedSecret, contentKey, plaintext;
  try {
    sharedSecret = diffieHellman({ privateKey, publicKey: validated.ephemeral });
    contentKey = Buffer.from(hkdfSync(
      "sha256",
      sharedSecret,
      Buffer.from(packageInfo.capsule.encryption.salt_base64, "base64"),
      Buffer.from(`${CLUSTER_CAPSULE_CONTRACT}:${packageInfo.capsule.cluster_transfer_id}`),
      32,
    ));
    const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(packageInfo.capsule.encryption.nonce_base64, "base64"), { authTagLength: 16 });
    decipher.setAAD(validated.aad);
    decipher.setAuthTag(Buffer.from(packageInfo.capsule.encryption.tag_base64, "base64"));
    try {
      plaintext = Buffer.concat([decipher.update(packageInfo.payload), decipher.final()]);
    } catch {
      reject("CLUSTER_CAPSULE_DECRYPTION_FAILED");
    }
    if (plaintext.length > MAX_PAYLOAD_BYTES) reject("CLUSTER_SNAPSHOT_PAYLOAD_TOO_LARGE");
    let snapshot;
    try { snapshot = parseStrictJson(plaintext.toString("utf8")); } catch { reject("CLUSTER_SNAPSHOT_PAYLOAD_INVALID"); }
    if (canonicalClusterJson(snapshot) !== plaintext.toString("utf8")) reject("CLUSTER_SNAPSHOT_PAYLOAD_NOT_CANONICAL");
    assertSnapshotBindings(snapshot, policy, packageInfo.capsule);
    return snapshot;
  } finally {
    sharedSecret?.fill(0);
    contentKey?.fill(0);
    plaintext?.fill(0);
  }
}

async function approveKeys(policy, records, at) {
  if (!policy) {
    if (process.env.NODE_ENV !== "test") reject("BACKUP_OPERATIONS_POLICY_REQUIRED");
    return;
  }
  const { assertBackupOperationsKeyApproved } = await import("./backup-operations-policy.mjs");
  assertBackupOperationsKeyApproved(policy, "source_signing", records.source.fingerprint, at);
  assertBackupOperationsKeyApproved(policy, "receiver_encryption", records.encryption.fingerprint, at);
  assertBackupOperationsKeyApproved(policy, "receiver_receipt", records.receipt.fingerprint, at);
}

async function sealClusterCapsuleUnlocked(options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const createdAt = iso(options.createdAt || now.toISOString(), "CLUSTER_CAPSULE_TIME_INVALID");
  if (Math.abs(now.getTime() - Date.parse(createdAt)) > MAX_CLOCK_SKEW_MS) reject("CLUSTER_CAPSULE_TIME_INVALID");
  const transferId = string(options.clusterTransferId || `ctr-${randomBytes(16).toString("hex")}`, IDENTIFIER, "CLUSTER_TRANSFER_ID_INVALID");
  if (process.env.NODE_ENV !== "test" && !/^ctr-[0-9a-f]{32}$/.test(transferId)) reject("CLUSTER_TRANSFER_ID_ENTROPY_INVALID");
  const scope = evidenceScope(options.evidenceScope, "CLUSTER_CAPSULE_SCOPE_INVALID");
  assertActualOperationRoot(scope);
  const sourceLocationId = string(options.sourceLocationId, IDENTIFIER, "CLUSTER_SOURCE_LOCATION_INVALID");
  const receiverLocationId = string(options.receiverLocationId, IDENTIFIER, "CLUSTER_RECEIVER_LOCATION_INVALID");
  if (sourceLocationId === receiverLocationId) reject("CLUSTER_TRANSFER_LOCATION_NOT_DISTINCT");
  const machineIdentitySha = string(options.sourceMachineIdentitySha256, SHA256, "CLUSTER_SOURCE_MACHINE_INVALID");
  const expiresAt = iso(options.expiresAt, "CLUSTER_CAPSULE_EXPIRY_INVALID");
  const recoveryPolicy = validateClusterRecoveryPolicy(options.clusterPolicy);
  const snapshot = validateClusterSnapshot(options.snapshot, recoveryPolicy);
  if (Date.parse(snapshot.captured_at) > Date.parse(createdAt) || Date.parse(expiresAt) <= Date.parse(createdAt)) reject("CLUSTER_CAPSULE_TIME_CHAIN_INVALID");
  const outboxRoot = await validateDedicatedRoot(options.outboxRoot, CLUSTER_OUTBOX_ROOT_MARKER, CLUSTER_OUTBOX_ROOT_MARKER_VALUE, "CLUSTER_OUTBOX_ROOT_UNSAFE");
  assertNoRootOverlap([outboxRoot, options.sourceKeyRoot]);
  const source = await validateKeyFile(options.sourceKeyRoot, options.sourceSigningPrivateKey, "ed25519", "private");
  const encryption = await validateKeyFile(options.sourceKeyRoot, options.receiverEncryptionPublicKey, "x25519", "public");
  const receipt = await validateKeyFile(options.sourceKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  if (source.fingerprint === receipt.fingerprint) reject("KEY_USAGE_NOT_SEPARATED");
  await approveKeys(options.operationsPolicy, { source, encryption, receipt }, createdAt);
  const finalPackage = path.join(outboxRoot, transferId);
  if (await lstat(finalPackage).catch((error) => error?.code === "ENOENT" ? null : reject("CLUSTER_PACKAGE_UNSAFE"))) {
    const existing = await readClusterPackage(finalPackage);
    verifyCapsuleSignature(existing.capsule, createPublicKey(source.key));
    const capsule = existing.capsule;
    if (capsule.cluster_transfer_id !== transferId || capsule.backup_id !== snapshot.binding.backup_id
      || capsule.created_at !== createdAt || capsule.evidence_scope !== scope
      || capsule.source.location_id !== sourceLocationId || capsule.source.machine_identity_sha256 !== machineIdentitySha
      || capsule.source.signing_key_fingerprint !== source.fingerprint || capsule.receiver.location_id !== receiverLocationId
      || capsule.receiver.encryption_key_fingerprint !== encryption.fingerprint || capsule.receiver.receipt_key_fingerprint !== receipt.fingerprint
      || capsule.inner.snapshot_sha256 !== snapshot.snapshot_sha256 || capsule.inner.policy_id !== snapshot.policy_id
      || capsule.inner.policy_sha256 !== snapshot.policy_sha256 || capsule.inner.manifest_sha256 !== snapshot.binding.manifest_sha256
      || capsule.inner.local_receipt_sha256 !== snapshot.binding.local_receipt_sha256
      || capsule.inner.recovery_point_at !== snapshot.binding.recovery_point_at || capsule.inner.expires_at !== expiresAt
      || capsule.inner.postgresql_major !== snapshot.binding.source.postgresql_major) reject("CLUSTER_PACKAGE_CONFLICT");
    await Promise.all([assertKeyUnchanged(source), assertKeyUnchanged(encryption), assertKeyUnchanged(receipt)]);
    return existing;
  }
  const stage = path.join(outboxRoot, `.staging-${transferId}`);
  await safeRemoveStage(outboxRoot, stage, `.staging-${transferId}`);
  await mkdir(stage, { mode: 0o700 });
  await chmod(stage, 0o700);
  let sharedSecret, contentKey, plaintext;
  try {
    const ephemeral = generateKeyPairSync("x25519"), salt = randomBytes(32), nonce = randomBytes(12);
    sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: encryption.key });
    contentKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${CLUSTER_CAPSULE_CONTRACT}:${transferId}`), 32));
    const base = {
      schema_version: 1,
      contract: CLUSTER_CAPSULE_CONTRACT,
      status: "SEALED",
      cluster_transfer_id: transferId,
      backup_id: snapshot.binding.backup_id,
      created_at: createdAt,
      evidence_scope: scope,
      source: { location_id: sourceLocationId, machine_identity_sha256: machineIdentitySha, signing_key_fingerprint: source.fingerprint },
      receiver: { location_id: receiverLocationId, encryption_key_fingerprint: encryption.fingerprint, receipt_key_fingerprint: receipt.fingerprint },
      inner: {
        snapshot_sha256: snapshot.snapshot_sha256,
        policy_id: snapshot.policy_id,
        policy_sha256: snapshot.policy_sha256,
        manifest_sha256: snapshot.binding.manifest_sha256,
        local_receipt_sha256: snapshot.binding.local_receipt_sha256,
        recovery_point_at: snapshot.binding.recovery_point_at,
        expires_at: expiresAt,
        postgresql_major: snapshot.binding.source.postgresql_major,
      },
      encryption: {
        payload_algorithm: "AES-256-GCM",
        key_agreement: "X25519",
        key_derivation: "HKDF-SHA256",
        ephemeral_public_key_der_base64: encodePublicKey(ephemeral.publicKey),
        salt_base64: salt.toString("base64"),
        nonce_base64: nonce.toString("base64"),
        tag_base64: "",
        aad_sha256: "",
      },
      payload: { file: "cluster-snapshot.enc", format: "CANONICAL_JSON_AES_256_GCM_V1", sha256: "", bytes: 1 },
      signature: null,
    };
    const aad = Buffer.from(canonicalTransferJson(capsuleAadProjection(base)));
    base.encryption.aad_sha256 = transferSha256(aad);
    plaintext = Buffer.from(canonicalClusterJson(snapshot));
    if (plaintext.length > MAX_PAYLOAD_BYTES) reject("CLUSTER_SNAPSHOT_PAYLOAD_TOO_LARGE");
    const cipher = createCipheriv("aes-256-gcm", contentKey, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const payload = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    base.encryption.tag_base64 = cipher.getAuthTag().toString("base64");
    base.payload.sha256 = transferSha256(payload);
    base.payload.bytes = payload.length;
    const capsule = validateClusterCapsule(signDocument(signingBody(base), source.key, source.fingerprint)).value;
    await writeExclusiveFile(path.join(stage, "cluster-snapshot.enc"), payload, 0o600);
    await writeExclusiveFile(path.join(stage, "capsule.json"), canonicalTransferJson(capsule), 0o600);
    await syncDirectory(stage);
    await moveDirectoryNoClobber(stage, finalPackage, "CLUSTER_PACKAGE_PROMOTION_CONFLICT");
    await syncDirectory(outboxRoot);
    await Promise.all([assertKeyUnchanged(source), assertKeyUnchanged(encryption), assertKeyUnchanged(receipt)]);
    return readClusterPackage(finalPackage);
  } finally {
    sharedSecret?.fill(0);
    contentKey?.fill(0);
    plaintext?.fill(0);
    await safeRemoveStage(outboxRoot, stage, `.staging-${transferId}`);
  }
}

export async function sealClusterCapsule(options) {
  const root = await validateDedicatedRoot(options.outboxRoot, CLUSTER_OUTBOX_ROOT_MARKER, CLUSTER_OUTBOX_ROOT_MARKER_VALUE, "CLUSTER_OUTBOX_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root);
  try { return await sealClusterCapsuleUnlocked(options); } finally { await release(); }
}

function receiptMatchesCapsule(receipt, packageInfo) {
  const capsule = packageInfo.capsule;
  return receipt.cluster_transfer_id === capsule.cluster_transfer_id
    && receipt.backup_id === capsule.backup_id
    && receipt.evidence_scope === capsule.evidence_scope
    && receipt.source_location_id === capsule.source.location_id
    && receipt.receiver_location_id === capsule.receiver.location_id
    && receipt.source_signing_key_fingerprint === capsule.source.signing_key_fingerprint
    && receipt.receiver_encryption_key_fingerprint === capsule.receiver.encryption_key_fingerprint
    && receipt.receiver_receipt_key_fingerprint === capsule.receiver.receipt_key_fingerprint
    && receipt.capsule_sha256 === packageInfo.capsuleSha
    && receipt.payload_sha256 === capsule.payload.sha256
    && receipt.payload_bytes === capsule.payload.bytes
    && receipt.snapshot_sha256 === capsule.inner.snapshot_sha256
    && receipt.policy_sha256 === capsule.inner.policy_sha256
    && receipt.manifest_sha256 === capsule.inner.manifest_sha256
    && receipt.local_receipt_sha256 === capsule.inner.local_receipt_sha256
    && receipt.recovery_point_at === capsule.inner.recovery_point_at
    && receipt.expires_at === capsule.inner.expires_at;
}

async function verifyFinalReceiverPackage(packageDirectory, keys, clusterPolicy) {
  const packaged = await readClusterPackage(packageDirectory, ["capsule.json", "cluster-receiver-receipt.json", "cluster-snapshot.enc"]);
  verifyCapsuleSignature(packaged.capsule, keys.sourcePublic.key);
  const payload = await safeRead(packaged.payloadFile, { maxBytes: MAX_PAYLOAD_BYTES, code: "CLUSTER_PAYLOAD_UNSAFE" });
  decryptClusterPayload({ ...packaged, payload }, keys.receiverPrivate.key, clusterPolicy);
  payload.fill(0);
  const receiptFile = path.join(packaged.packageDirectory, "cluster-receiver-receipt.json");
  const receipt = validateClusterCapsuleReceipt(await safeCanonicalJson(receiptFile, "CLUSTER_CAPSULE_RECEIPT_INVALID"));
  if (!receiptMatchesCapsule(receipt, packaged)
    || Date.parse(receipt.received_at) < Date.parse(packaged.capsule.created_at)
    || Date.parse(receipt.received_at) > Date.parse(packaged.capsule.inner.expires_at)) reject("CLUSTER_CAPSULE_RECEIPT_CHAIN_INVALID");
  if (receipt.receiver_receipt_key_fingerprint !== keys.receiptPublic.fingerprint) reject("RECEIVER_RECEIPT_KEY_NOT_APPROVED");
  verifyDocument(receipt, keys.receiptPublic.key, "CLUSTER_CAPSULE_RECEIPT_SIGNATURE_INVALID");
  return { ...packaged, receiverReceipt: receipt, receiverReceiptFile: receiptFile, receiverReceiptSha: transferSha256(await safeRead(receiptFile, { maxBytes: MAX_JSON_BYTES, code: "CLUSTER_CAPSULE_RECEIPT_INVALID" })) };
}

async function receiveClusterCapsuleUnlocked(options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const receivedAt = iso(options.receivedAt || now.toISOString(), "CLUSTER_CAPSULE_RECEIVED_TIME_INVALID");
  const receiverLocationId = string(options.receiverLocationId, IDENTIFIER, "CLUSTER_RECEIVER_LOCATION_INVALID");
  const retentionPolicyId = string(options.retentionPolicyId, IDENTIFIER, "CLUSTER_RETENTION_POLICY_INVALID");
  const incoming = await readClusterPackage(options.incomingPackageDirectory);
  assertActualOperationRoot(incoming.capsule.evidence_scope);
  if (incoming.capsule.receiver.location_id !== receiverLocationId) reject("CLUSTER_RECEIVER_LOCATION_MISMATCH");
  if (Date.parse(incoming.capsule.created_at) > now.getTime() + MAX_CLOCK_SKEW_MS
    || Date.parse(receivedAt) < Date.parse(incoming.capsule.created_at)
    || Date.parse(receivedAt) > Date.parse(incoming.capsule.inner.expires_at)) reject("CLUSTER_TRANSFER_STALE_OR_FUTURE");
  const receiverRoot = await validateDedicatedRoot(options.receiverRoot, CLUSTER_RECEIVER_ROOT_MARKER, CLUSTER_RECEIVER_ROOT_MARKER_VALUE, "CLUSTER_RECEIVER_ROOT_UNSAFE");
  assertNoRootOverlap([receiverRoot, options.receiverKeyRoot, options.incomingPackageDirectory]);
  const sourcePublic = await validateKeyFile(options.receiverKeyRoot, options.trustedSourceSigningPublicKey, "ed25519", "public");
  const receiverPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverEncryptionPrivateKey, "x25519", "private");
  const receiptPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverReceiptPrivateKey, "ed25519", "private");
  const receiptPublic = { ...receiptPrivate, key: createPublicKey(receiptPrivate.key) };
  if (sourcePublic.fingerprint === receiptPrivate.fingerprint) reject("KEY_USAGE_NOT_SEPARATED");
  await approveKeys(options.operationsPolicy, { source: sourcePublic, encryption: receiverPrivate, receipt: receiptPrivate }, receivedAt);
  verifyCapsuleSignature(incoming.capsule, sourcePublic.key);
  const incomingPayload = await safeRead(incoming.payloadFile, { maxBytes: MAX_PAYLOAD_BYTES, code: "CLUSTER_PAYLOAD_UNSAFE" });
  decryptClusterPayload({ ...incoming, payload: incomingPayload }, receiverPrivate.key, options.clusterPolicy);
  incomingPayload.fill(0);
  const finalPackage = path.join(receiverRoot, incoming.capsule.cluster_transfer_id);
  const existing = await lstat(finalPackage).catch((error) => error?.code === "ENOENT" ? null : reject("CLUSTER_RECEIVER_PACKAGE_UNSAFE"));
  if (existing) {
    const verified = await verifyFinalReceiverPackage(finalPackage, { sourcePublic, receiverPrivate, receiptPublic }, options.clusterPolicy);
    if (verified.capsuleSha !== incoming.capsuleSha || verified.receiverReceipt.retention_policy_id !== retentionPolicyId) reject("CLUSTER_RECEIVER_PACKAGE_CONFLICT");
    return verified;
  }
  const stage = path.join(receiverRoot, `.incoming-${incoming.capsule.cluster_transfer_id}`);
  await safeRemoveStage(receiverRoot, stage, `.incoming-${incoming.capsule.cluster_transfer_id}`);
  await mkdir(stage, { mode: 0o700 });
  await chmod(stage, 0o700);
  try {
    await copyVerifiedFile(incoming.capsuleFile, path.join(stage, "capsule.json"));
    await copyVerifiedFile(incoming.payloadFile, path.join(stage, "cluster-snapshot.enc"));
    const body = {
      schema_version: 1,
      contract: CLUSTER_CAPSULE_RECEIPT_CONTRACT,
      status: "CLUSTER_CAPSULE_VERIFIED",
      cluster_transfer_id: incoming.capsule.cluster_transfer_id,
      backup_id: incoming.capsule.backup_id,
      received_at: receivedAt,
      evidence_scope: incoming.capsule.evidence_scope,
      source_location_id: incoming.capsule.source.location_id,
      receiver_location_id: receiverLocationId,
      source_signing_key_fingerprint: sourcePublic.fingerprint,
      receiver_encryption_key_fingerprint: receiverPrivate.fingerprint,
      receiver_receipt_key_fingerprint: receiptPrivate.fingerprint,
      capsule_sha256: incoming.capsuleSha,
      payload_sha256: incoming.capsule.payload.sha256,
      payload_bytes: incoming.capsule.payload.bytes,
      snapshot_sha256: incoming.capsule.inner.snapshot_sha256,
      policy_sha256: incoming.capsule.inner.policy_sha256,
      manifest_sha256: incoming.capsule.inner.manifest_sha256,
      local_receipt_sha256: incoming.capsule.inner.local_receipt_sha256,
      recovery_point_at: incoming.capsule.inner.recovery_point_at,
      expires_at: incoming.capsule.inner.expires_at,
      retention_policy_id: retentionPolicyId,
      retention_status: "PLANNED_NO_DELETION",
      attestation: "SIGNED_ENCRYPTED_CLUSTER_SNAPSHOT_DECRYPTED_AND_VALIDATED_AT_DISTINCT_RECEIVER",
    };
    const receiptDocument = validateClusterCapsuleReceipt(signDocument(body, receiptPrivate.key, receiptPrivate.fingerprint));
    await writeExclusiveFile(path.join(stage, "cluster-receiver-receipt.json"), canonicalTransferJson(receiptDocument), 0o600);
    await syncDirectory(stage);
    await verifyFinalReceiverPackage(stage, { sourcePublic, receiverPrivate, receiptPublic }, options.clusterPolicy);
    await moveDirectoryNoClobber(stage, finalPackage, "CLUSTER_RECEIVER_PROMOTION_CONFLICT");
    await syncDirectory(receiverRoot);
    await Promise.all([assertKeyUnchanged(sourcePublic), assertKeyUnchanged(receiverPrivate), assertKeyUnchanged(receiptPrivate)]);
    return verifyFinalReceiverPackage(finalPackage, { sourcePublic, receiverPrivate, receiptPublic }, options.clusterPolicy);
  } finally {
    await safeRemoveStage(receiverRoot, stage, `.incoming-${incoming.capsule.cluster_transfer_id}`);
  }
}

export async function receiveClusterCapsule(options) {
  const root = await validateDedicatedRoot(options.receiverRoot, CLUSTER_RECEIVER_ROOT_MARKER, CLUSTER_RECEIVER_ROOT_MARKER_VALUE, "CLUSTER_RECEIVER_ROOT_UNSAFE");
  const release = await acquireFilesystemLock(root);
  try { return await receiveClusterCapsuleUnlocked(options); } finally { await release(); }
}

function acceptanceMatches(receipt, acceptance, packageInfo) {
  return receiptMatchesCapsule(receipt, packageInfo)
    && acceptance.cluster_transfer_id === receipt.cluster_transfer_id
    && acceptance.backup_id === receipt.backup_id
    && acceptance.evidence_scope === receipt.evidence_scope
    && acceptance.source_location_id === receipt.source_location_id
    && acceptance.receiver_location_id === receipt.receiver_location_id
    && acceptance.source_signing_key_fingerprint === receipt.source_signing_key_fingerprint
    && acceptance.receiver_receipt_key_fingerprint === receipt.receiver_receipt_key_fingerprint
    && acceptance.capsule_sha256 === receipt.capsule_sha256
    && acceptance.receiver_receipt_sha256 === transferSha256(receipt)
    && acceptance.snapshot_sha256 === receipt.snapshot_sha256
    && acceptance.policy_sha256 === receipt.policy_sha256
    && acceptance.manifest_sha256 === receipt.manifest_sha256
    && acceptance.local_receipt_sha256 === receipt.local_receipt_sha256
    && acceptance.recovery_point_at === receipt.recovery_point_at
    && acceptance.expires_at === receipt.expires_at
    && Date.parse(acceptance.accepted_at) >= Date.parse(receipt.received_at)
    && Date.parse(acceptance.accepted_at) <= Date.parse(receipt.expires_at);
}

async function acceptClusterCapsuleReceiptUnlocked(options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const acceptedAt = iso(options.acceptedAt || now.toISOString(), "CLUSTER_ACCEPTANCE_TIME_INVALID");
  const packaged = await readClusterPackage(options.sourcePackageDirectory);
  assertActualOperationRoot(packaged.capsule.evidence_scope);
  const source = await validateKeyFile(options.sourceKeyRoot, options.sourceSigningPrivateKey, "ed25519", "private");
  const receiptPublic = await validateKeyFile(options.sourceKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  if (source.fingerprint === receiptPublic.fingerprint) reject("KEY_USAGE_NOT_SEPARATED");
  verifyCapsuleSignature(packaged.capsule, createPublicKey(source.key));
  const receiptFile = path.resolve(options.receiverReceiptFile);
  const receiptDocument = validateClusterCapsuleReceipt(await safeCanonicalJson(receiptFile, "CLUSTER_CAPSULE_RECEIPT_INVALID"));
  if (!receiptMatchesCapsule(receiptDocument, packaged)
    || receiptDocument.receiver_receipt_key_fingerprint !== receiptPublic.fingerprint) reject("CLUSTER_CAPSULE_RECEIPT_CHAIN_INVALID");
  verifyDocument(receiptDocument, receiptPublic.key, "CLUSTER_CAPSULE_RECEIPT_SIGNATURE_INVALID");
  if (Date.parse(acceptedAt) < Date.parse(receiptDocument.received_at)
    || Date.parse(acceptedAt) > now.getTime() + MAX_CLOCK_SKEW_MS
    || Date.parse(acceptedAt) > Date.parse(receiptDocument.expires_at)) reject("CLUSTER_ACCEPTANCE_TIME_INVALID");
  await approveKeys(options.operationsPolicy, { source, encryption: { fingerprint: packaged.capsule.receiver.encryption_key_fingerprint }, receipt: receiptPublic }, acceptedAt);
  const body = {
    schema_version: 1,
    contract: CLUSTER_CAPSULE_ACCEPTANCE_CONTRACT,
    status: "CLUSTER_RECEIVER_RECEIPT_ACCEPTED",
    cluster_transfer_id: packaged.capsule.cluster_transfer_id,
    backup_id: packaged.capsule.backup_id,
    accepted_at: acceptedAt,
    evidence_scope: packaged.capsule.evidence_scope,
    source_location_id: packaged.capsule.source.location_id,
    receiver_location_id: packaged.capsule.receiver.location_id,
    source_signing_key_fingerprint: source.fingerprint,
    receiver_receipt_key_fingerprint: receiptPublic.fingerprint,
    capsule_sha256: packaged.capsuleSha,
    receiver_receipt_sha256: transferSha256(receiptDocument),
    snapshot_sha256: packaged.capsule.inner.snapshot_sha256,
    policy_sha256: packaged.capsule.inner.policy_sha256,
    manifest_sha256: packaged.capsule.inner.manifest_sha256,
    local_receipt_sha256: packaged.capsule.inner.local_receipt_sha256,
    recovery_point_at: packaged.capsule.inner.recovery_point_at,
    expires_at: packaged.capsule.inner.expires_at,
    attestation: "SOURCE_VERIFIED_SIGNED_CLUSTER_RECEIVER_ACKNOWLEDGEMENT",
  };
  const acceptance = validateClusterCapsuleAcceptance(signDocument(body, source.key, source.fingerprint));
  const acceptanceFile = path.join(path.dirname(packaged.packageDirectory), `${packaged.capsule.cluster_transfer_id}.accepted.json`);
  await atomicNoClobberJson(acceptanceFile, acceptance, 0o400, "CLUSTER_ACCEPTANCE_CONFLICT");
  await Promise.all([assertKeyUnchanged(source), assertKeyUnchanged(receiptPublic)]);
  return { ...packaged, receiverReceipt: receiptDocument, receiverReceiptFile: receiptFile, receiverReceiptSha: transferSha256(receiptDocument), acceptance, acceptanceFile, acceptanceSha: transferSha256(acceptance) };
}

export async function acceptClusterCapsuleReceipt(options) {
  const sourcePackage = path.resolve(options.sourcePackageDirectory);
  const root = await validateDedicatedRoot(path.dirname(sourcePackage), CLUSTER_OUTBOX_ROOT_MARKER, CLUSTER_OUTBOX_ROOT_MARKER_VALUE, "CLUSTER_OUTBOX_ROOT_UNSAFE");
  if (path.dirname(sourcePackage) !== root) reject("CLUSTER_PACKAGE_UNSAFE");
  const release = await acquireFilesystemLock(root);
  try { return await acceptClusterCapsuleReceiptUnlocked(options); } finally { await release(); }
}

export async function verifyClusterTransferEvidence(options) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) reject("NOW_INVALID");
  const sourcePublic = await validateKeyFile(options.receiverKeyRoot, options.trustedSourceSigningPublicKey, "ed25519", "public");
  const receiverPrivate = await validateKeyFile(options.receiverKeyRoot, options.receiverEncryptionPrivateKey, "x25519", "private");
  const receiptPublic = await validateKeyFile(options.receiverKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  const chain = await verifyFinalReceiverPackage(options.receiverPackageDirectory, { sourcePublic, receiverPrivate, receiptPublic }, options.clusterPolicy);
  const acceptanceFile = path.resolve(options.acceptanceFile);
  const acceptance = validateClusterCapsuleAcceptance(await safeCanonicalJson(acceptanceFile, "CLUSTER_CAPSULE_ACCEPTANCE_INVALID"));
  if (!acceptanceMatches(chain.receiverReceipt, acceptance, chain)) reject("CLUSTER_CAPSULE_ACCEPTANCE_CHAIN_INVALID");
  verifyDocument(acceptance, sourcePublic.key, "CLUSTER_CAPSULE_ACCEPTANCE_SIGNATURE_INVALID");
  if (options.requireFresh !== false && now.getTime() > Date.parse(chain.capsule.inner.expires_at)) reject("CLUSTER_TRANSFER_EVIDENCE_STALE");
  await approveKeys(options.operationsPolicy, { source: sourcePublic, encryption: receiverPrivate, receipt: receiptPublic }, options.requireFresh === false ? chain.capsule.created_at : now.toISOString());
  await Promise.all([assertKeyUnchanged(sourcePublic), assertKeyUnchanged(receiverPrivate), assertKeyUnchanged(receiptPublic)]);
  return { ...chain, acceptance, acceptanceFile, acceptanceSha: transferSha256(acceptance) };
}

function verifyDataAcknowledgementChain(dataEvidence, sourcePublic, receiptPublic) {
  const envelope = validateTransferEnvelope(object(dataEvidence, "JOINT_DATA_EVIDENCE_INVALID").envelope).value;
  const receiptDocument = validateTransferReceipt(dataEvidence.receiverReceipt);
  const acceptance = validateTransferAcceptance(dataEvidence.acceptance);
  if (envelope.source.signing_key_fingerprint !== sourcePublic.fingerprint
    || envelope.receiver.receipt_key_fingerprint !== receiptPublic.fingerprint) reject("JOINT_DATA_KEY_MISMATCH");
  verifyDocument(envelope, sourcePublic.key, "JOINT_DATA_ENVELOPE_SIGNATURE_INVALID");
  verifyDocument(receiptDocument, receiptPublic.key, "JOINT_DATA_RECEIPT_SIGNATURE_INVALID");
  verifyDocument(acceptance, sourcePublic.key, "JOINT_DATA_ACCEPTANCE_SIGNATURE_INVALID");
  const envelopeSha = transferSha256(envelope), receiptSha = transferSha256(receiptDocument), acceptanceSha = transferSha256(acceptance);
  if (receiptDocument.transfer_id !== envelope.transfer_id || receiptDocument.backup_id !== envelope.backup_id
    || receiptDocument.source_location_id !== envelope.source.location_id || receiptDocument.receiver_location_id !== envelope.receiver.location_id
    || receiptDocument.source_signing_key_fingerprint !== envelope.source.signing_key_fingerprint
    || receiptDocument.receiver_encryption_key_fingerprint !== envelope.receiver.encryption_key_fingerprint
    || receiptDocument.receiver_receipt_key_fingerprint !== envelope.receiver.receipt_key_fingerprint
    || receiptDocument.envelope_sha256 !== envelopeSha || receiptDocument.payload_sha256 !== envelope.payload.sha256
    || receiptDocument.payload_bytes !== envelope.payload.bytes || receiptDocument.inner_manifest_sha256 !== envelope.inner.manifest_sha256
    || receiptDocument.local_receipt_sha256 !== envelope.inner.local_receipt_sha256
    || acceptance.transfer_id !== envelope.transfer_id || acceptance.backup_id !== envelope.backup_id
    || acceptance.source_location_id !== envelope.source.location_id || acceptance.receiver_location_id !== envelope.receiver.location_id
    || acceptance.source_signing_key_fingerprint !== envelope.source.signing_key_fingerprint
    || acceptance.receiver_receipt_key_fingerprint !== envelope.receiver.receipt_key_fingerprint
    || acceptance.envelope_sha256 !== envelopeSha || acceptance.receiver_receipt_sha256 !== receiptSha
    || Date.parse(receiptDocument.received_at) < Date.parse(envelope.created_at)
    || Date.parse(acceptance.accepted_at) < Date.parse(receiptDocument.received_at)
    || Date.parse(acceptance.accepted_at) > Date.parse(envelope.inner.expires_at)) reject("JOINT_DATA_CHAIN_INVALID");
  return { envelope, receiverReceipt: receiptDocument, acceptance, envelopeSha, receiverReceiptSha: receiptSha, acceptanceSha };
}

function verifyClusterAcknowledgementChain(clusterEvidence, sourcePublic, receiptPublic) {
  const capsule = validateClusterCapsule(object(clusterEvidence, "JOINT_CLUSTER_EVIDENCE_INVALID").capsule).value;
  const receiptDocument = validateClusterCapsuleReceipt(clusterEvidence.receiverReceipt);
  const acceptance = validateClusterCapsuleAcceptance(clusterEvidence.acceptance);
  if (capsule.source.signing_key_fingerprint !== sourcePublic.fingerprint
    || capsule.receiver.receipt_key_fingerprint !== receiptPublic.fingerprint) reject("JOINT_CLUSTER_KEY_MISMATCH");
  verifyDocument(capsule, sourcePublic.key, "JOINT_CLUSTER_CAPSULE_SIGNATURE_INVALID");
  verifyDocument(receiptDocument, receiptPublic.key, "JOINT_CLUSTER_RECEIPT_SIGNATURE_INVALID");
  verifyDocument(acceptance, sourcePublic.key, "JOINT_CLUSTER_ACCEPTANCE_SIGNATURE_INVALID");
  const packageInfo = { capsule, capsuleSha: transferSha256(capsule) };
  if (!receiptMatchesCapsule(receiptDocument, packageInfo) || !acceptanceMatches(receiptDocument, acceptance, packageInfo)
    || Date.parse(acceptance.accepted_at) > Date.parse(capsule.inner.expires_at)) reject("JOINT_CLUSTER_CHAIN_INVALID");
  return {
    capsule,
    receiverReceipt: receiptDocument,
    acceptance,
    capsuleSha: packageInfo.capsuleSha,
    receiverReceiptSha: transferSha256(receiptDocument),
    acceptanceSha: transferSha256(acceptance),
  };
}

export function createJointTransferV2({ dataEvidence, clusterEvidence, sourceSigningPrivateKey, receiverReceiptPublicKey, acceptedAt, evidenceScope: scopeInput }) {
  const sourcePrivate = asKey(sourceSigningPrivateKey, "private", "ed25519", "JOINT_SOURCE_SIGNING_KEY_INVALID");
  const sourcePublic = { key: createPublicKey(sourcePrivate), fingerprint: publicKeyFingerprint(createPublicKey(sourcePrivate)) };
  const receiptKey = asKey(receiverReceiptPublicKey, "public", "ed25519", "JOINT_RECEIVER_RECEIPT_KEY_INVALID");
  const receiptPublic = { key: receiptKey, fingerprint: publicKeyFingerprint(receiptKey) };
  if (sourcePublic.fingerprint === receiptPublic.fingerprint) reject("KEY_USAGE_NOT_SEPARATED");
  const data = verifyDataAcknowledgementChain(dataEvidence, sourcePublic, receiptPublic);
  const cluster = verifyClusterAcknowledgementChain(clusterEvidence, sourcePublic, receiptPublic);
  const scope = evidenceScope(scopeInput, "JOINT_TRANSFER_SCOPE_INVALID");
  assertActualOperationRoot(scope);
  const accepted = iso(acceptedAt, "JOINT_TRANSFER_TIME_INVALID");
  if (data.envelope.backup_id !== cluster.capsule.backup_id
    || data.envelope.source.location_id !== cluster.capsule.source.location_id
    || data.envelope.receiver.location_id !== cluster.capsule.receiver.location_id
    || data.envelope.source.machine_identity_sha256 !== cluster.capsule.source.machine_identity_sha256
    || data.envelope.receiver.encryption_key_fingerprint !== cluster.capsule.receiver.encryption_key_fingerprint
    || data.envelope.inner.manifest_sha256 !== cluster.capsule.inner.manifest_sha256
    || data.envelope.inner.local_receipt_sha256 !== cluster.capsule.inner.local_receipt_sha256
    || data.envelope.inner.recovery_point_at !== cluster.capsule.inner.recovery_point_at
    || data.envelope.inner.expires_at !== cluster.capsule.inner.expires_at
    || cluster.capsule.evidence_scope !== scope) reject("JOINT_TRANSFER_CHAIN_MISMATCH");
  if (Date.parse(accepted) < Math.max(Date.parse(data.acceptance.accepted_at), Date.parse(cluster.acceptance.accepted_at))
    || Date.parse(accepted) > Date.parse(data.envelope.inner.expires_at)) reject("JOINT_TRANSFER_TIME_INVALID");
  const body = {
    schema_version: 2,
    contract: JOINT_TRANSFER_CONTRACT,
    status: "DATA_AND_CLUSTER_RECEIVER_ACKNOWLEDGEMENTS_ACCEPTED",
    backup_id: data.envelope.backup_id,
    accepted_at: accepted,
    evidence_scope: scope,
    source_location_id: data.envelope.source.location_id,
    receiver_location_id: data.envelope.receiver.location_id,
    source_machine_identity_sha256: data.envelope.source.machine_identity_sha256,
    source_signing_key_fingerprint: sourcePublic.fingerprint,
    receiver_encryption_key_fingerprint: data.envelope.receiver.encryption_key_fingerprint,
    receiver_receipt_key_fingerprint: receiptPublic.fingerprint,
    data: {
      transfer_id: data.envelope.transfer_id,
      envelope_sha256: data.envelopeSha,
      receiver_receipt_sha256: data.receiverReceiptSha,
      acceptance_sha256: data.acceptanceSha,
      manifest_sha256: data.envelope.inner.manifest_sha256,
      local_receipt_sha256: data.envelope.inner.local_receipt_sha256,
      recovery_point_at: data.envelope.inner.recovery_point_at,
      expires_at: data.envelope.inner.expires_at,
      deployment_class: data.envelope.inner.deployment_class,
    },
    cluster: {
      transfer_id: cluster.capsule.cluster_transfer_id,
      capsule_sha256: cluster.capsuleSha,
      receiver_receipt_sha256: cluster.receiverReceiptSha,
      acceptance_sha256: cluster.acceptanceSha,
      snapshot_sha256: cluster.capsule.inner.snapshot_sha256,
      policy_sha256: cluster.capsule.inner.policy_sha256,
      manifest_sha256: cluster.capsule.inner.manifest_sha256,
      local_receipt_sha256: cluster.capsule.inner.local_receipt_sha256,
      recovery_point_at: cluster.capsule.inner.recovery_point_at,
      expires_at: cluster.capsule.inner.expires_at,
    },
    binding_sha256: "",
    attestation: "SOURCE_CROSS_BOUND_DATA_V1_AND_CLUSTER_CAPSULE_V1_RECEIVER_ACKNOWLEDGEMENTS",
  };
  body.binding_sha256 = transferSha256(jointBindingProjection(body));
  return validateJointTransferV2(signDocument(body, sourcePrivate, sourcePublic.fingerprint));
}

export function verifyJointTransferV2({ joint, dataEvidence, clusterEvidence, sourceSigningPublicKey, receiverReceiptPublicKey }) {
  const sourceKey = asKey(sourceSigningPublicKey, "public", "ed25519", "JOINT_SOURCE_SIGNING_KEY_INVALID");
  const sourcePublic = { key: sourceKey, fingerprint: publicKeyFingerprint(sourceKey) };
  const receiptKey = asKey(receiverReceiptPublicKey, "public", "ed25519", "JOINT_RECEIVER_RECEIPT_KEY_INVALID");
  const receiptPublic = { key: receiptKey, fingerprint: publicKeyFingerprint(receiptKey) };
  const value = validateJointTransferV2(joint);
  if (value.source_signing_key_fingerprint !== sourcePublic.fingerprint
    || value.receiver_receipt_key_fingerprint !== receiptPublic.fingerprint) reject("JOINT_TRANSFER_KEY_MISMATCH");
  verifyDocument(value, sourcePublic.key, "JOINT_TRANSFER_SIGNATURE_INVALID");
  const data = verifyDataAcknowledgementChain(dataEvidence, sourcePublic, receiptPublic);
  const cluster = verifyClusterAcknowledgementChain(clusterEvidence, sourcePublic, receiptPublic);
  const expected = {
    backup_id: data.envelope.backup_id,
    evidence_scope: cluster.capsule.evidence_scope,
    source_location_id: data.envelope.source.location_id,
    receiver_location_id: data.envelope.receiver.location_id,
    source_machine_identity_sha256: data.envelope.source.machine_identity_sha256,
    source_signing_key_fingerprint: sourcePublic.fingerprint,
    receiver_encryption_key_fingerprint: data.envelope.receiver.encryption_key_fingerprint,
    receiver_receipt_key_fingerprint: receiptPublic.fingerprint,
    data: {
      transfer_id: data.envelope.transfer_id,
      envelope_sha256: data.envelopeSha,
      receiver_receipt_sha256: data.receiverReceiptSha,
      acceptance_sha256: data.acceptanceSha,
      manifest_sha256: data.envelope.inner.manifest_sha256,
      local_receipt_sha256: data.envelope.inner.local_receipt_sha256,
      recovery_point_at: data.envelope.inner.recovery_point_at,
      expires_at: data.envelope.inner.expires_at,
      deployment_class: data.envelope.inner.deployment_class,
    },
    cluster: {
      transfer_id: cluster.capsule.cluster_transfer_id,
      capsule_sha256: cluster.capsuleSha,
      receiver_receipt_sha256: cluster.receiverReceiptSha,
      acceptance_sha256: cluster.acceptanceSha,
      snapshot_sha256: cluster.capsule.inner.snapshot_sha256,
      policy_sha256: cluster.capsule.inner.policy_sha256,
      manifest_sha256: cluster.capsule.inner.manifest_sha256,
      local_receipt_sha256: cluster.capsule.inner.local_receipt_sha256,
      recovery_point_at: cluster.capsule.inner.recovery_point_at,
      expires_at: cluster.capsule.inner.expires_at,
    },
  };
  for (const key of [
    "backup_id", "evidence_scope", "source_location_id", "receiver_location_id", "source_machine_identity_sha256",
    "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint",
  ]) if (value[key] !== expected[key]) reject("JOINT_TRANSFER_EVIDENCE_MISMATCH");
  if (canonicalTransferJson(value.data) !== canonicalTransferJson(expected.data)
    || canonicalTransferJson(value.cluster) !== canonicalTransferJson(expected.cluster)) reject("JOINT_TRANSFER_EVIDENCE_MISMATCH");
  if (Date.parse(value.accepted_at) < Math.max(Date.parse(data.acceptance.accepted_at), Date.parse(cluster.acceptance.accepted_at))
    || Date.parse(value.accepted_at) > Date.parse(data.envelope.inner.expires_at)) reject("JOINT_TRANSFER_TIME_INVALID");
  return value;
}

export async function writeJointTransferV2(options) {
  const root = await validateDedicatedRoot(options.jointRoot, JOINT_TRANSFER_ROOT_MARKER, JOINT_TRANSFER_ROOT_MARKER_VALUE, "JOINT_TRANSFER_ROOT_UNSAFE");
  assertNoRootOverlap([root, options.sourceKeyRoot]);
  const source = await validateKeyFile(options.sourceKeyRoot, options.sourceSigningPrivateKey, "ed25519", "private");
  const receipt = await validateKeyFile(options.sourceKeyRoot, options.receiverReceiptPublicKey, "ed25519", "public");
  const joint = createJointTransferV2({
    dataEvidence: options.dataEvidence,
    clusterEvidence: options.clusterEvidence,
    sourceSigningPrivateKey: source.key,
    receiverReceiptPublicKey: receipt.key,
    acceptedAt: options.acceptedAt,
    evidenceScope: options.evidenceScope,
  });
  if (options.operationsPolicy) {
    const { assertBackupOperationsPolicyMatchesEnvelope } = await import("./backup-operations-policy.mjs");
    assertBackupOperationsPolicyMatchesEnvelope(options.operationsPolicy, options.dataEvidence.envelope);
  }
  await approveKeys(options.operationsPolicy, { source, encryption: { fingerprint: joint.receiver_encryption_key_fingerprint }, receipt }, joint.accepted_at);
  const jointFile = path.join(root, `${joint.backup_id}.joint-v2.json`);
  await atomicNoClobberJson(jointFile, joint, 0o400, "JOINT_TRANSFER_CONFLICT");
  await Promise.all([assertKeyUnchanged(source), assertKeyUnchanged(receipt)]);
  return { joint, jointFile, jointSha: transferSha256(joint) };
}
