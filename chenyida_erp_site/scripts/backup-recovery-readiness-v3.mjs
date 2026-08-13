import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseStrictJson,
  sha256File,
  validateReceipt,
} from "./backup-recovery-contract.mjs";
import {
  backupOperationsPolicySha256,
  backupOperationsSha256,
  validateBackupOperationsObservation,
  validateBackupOperationsPolicy,
  validateBackupRetentionPlan,
} from "./backup-operations-policy.mjs";
import {
  canonicalTransferJson,
  verifyOffhostTransferEvidence,
} from "./offhost-transfer-contract.mjs";

export const BACKUP_RECOVERY_READINESS_CONTRACT = "chenyida-erp-backup-verification/v3";
export const BACKUP_RECOVERY_READY_RESULT = "RECOVERY_READY";
export const BACKUP_RECOVERY_SYNTHETIC_RESULT = "SYNTHETIC_ISOLATED_VERIFIED";
export const BACKUP_RECOVERY_READINESS_FILE = "recovery-readiness.json";
export const BACKUP_RECOVERY_READINESS_ROOT_MARKER = ".chenyida-erp-receipt-root-v2";
export const BACKUP_RECOVERY_READINESS_ROOT_MARKER_VALUE = "chenyida-erp-receipt-root/v2\n";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_JSON_BYTES = 1024 * 1024;
const SAFE_PATH = "/usr/bin:/bin";

export class BackupRecoveryReadinessError extends Error {
  constructor(code) {
    super(code);
    this.name = "BackupRecoveryReadinessError";
    this.code = code;
  }
}

function reject(code) {
  throw new BackupRecoveryReadinessError(code);
}

function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code) {
  const actual = Object.keys(object(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function text(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function iso(value, code) {
  text(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function readinessBody(value) {
  const { readiness_sha256: _sha, ...body } = value;
  return body;
}

async function safeJson(file, code) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.size < 2 || before.size > MAX_JSON_BYTES || (before.mode & 0o022) !== 0) reject(code);
    const source = await handle.readFile("utf8");
    const after = await handle.stat();
    const pointed = await lstat(file).catch(() => reject(code));
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || pointed.dev !== after.dev || pointed.ino !== after.ino || pointed.nlink !== 1) reject(code);
    try { return parseStrictJson(source); } catch { reject(code); }
  } finally { await handle.close(); }
}

async function safeText(file, code, maxBytes = MAX_JSON_BYTES) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.size < 1 || before.size > maxBytes || (before.mode & 0o022) !== 0) reject(code);
    const source = await handle.readFile("utf8");
    const after = await handle.stat();
    const pointed = await lstat(file).catch(() => reject(code));
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || pointed.dev !== after.dev || pointed.ino !== after.ino || pointed.nlink !== 1) reject(code);
    return source;
  } finally { await handle.close(); }
}

export function validateBackupRecoveryReadiness(value) {
  exactKeys(value, ["schema_version", "contract", "result", "evidence_scope", "backup_id", "created_at", "verified_at", "expires_at", "inner_restore", "transfer", "operations", "attestation", "readiness_sha256"], "READINESS_FIELDS_INVALID");
  if (value.schema_version !== 3 || value.contract !== BACKUP_RECOVERY_READINESS_CONTRACT
    || !new Set([BACKUP_RECOVERY_READY_RESULT, BACKUP_RECOVERY_SYNTHETIC_RESULT]).has(value.result)
    || !new Set(["ACTUAL_OFFHOST", "SYNTHETIC_ISOLATED"]).has(value.evidence_scope)) reject("READINESS_VERSION_INVALID");
  if ((value.result === BACKUP_RECOVERY_READY_RESULT) !== (value.evidence_scope === "ACTUAL_OFFHOST")) reject("READINESS_SCOPE_INVALID");
  text(value.backup_id, IDENTIFIER, "READINESS_IDENTITY_INVALID");
  iso(value.created_at, "READINESS_TIME_INVALID");
  iso(value.verified_at, "READINESS_TIME_INVALID");
  iso(value.expires_at, "READINESS_TIME_INVALID");
  if (Date.parse(value.created_at) > Date.parse(value.verified_at) || Date.parse(value.verified_at) > Date.parse(value.expires_at)) reject("READINESS_TIME_INVALID");

  exactKeys(value.inner_restore, ["receipt_file_sha256", "receipt_canonical_sha256", "receipt"], "READINESS_INNER_RESTORE_INVALID");
  text(value.inner_restore.receipt_file_sha256, SHA256, "READINESS_INNER_RESTORE_INVALID");
  text(value.inner_restore.receipt_canonical_sha256, SHA256, "READINESS_INNER_RESTORE_INVALID");
  const restore = validateReceipt(value.inner_restore.receipt);
  if (restore.result !== "RESTORE_VERIFIED" || restore.backup_id !== value.backup_id || restore.created_at !== value.created_at || restore.expires_at !== value.expires_at
    || backupOperationsSha256(restore) !== value.inner_restore.receipt_canonical_sha256) reject("READINESS_INNER_RESTORE_INVALID");

  exactKeys(value.transfer, ["transfer_id", "envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "offhost_receipt_sha256", "payload_algorithm", "key_agreement", "key_derivation", "signature_algorithm", "source_location_id", "source_machine_identity_sha256", "receiver_location_id", "receiver_machine_identity_sha256", "receiver_identity_sha256", "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint"], "READINESS_TRANSFER_INVALID");
  for (const key of ["transfer_id", "source_location_id", "receiver_location_id"]) text(value.transfer[key], IDENTIFIER, "READINESS_TRANSFER_INVALID");
  for (const key of ["envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "offhost_receipt_sha256", "source_machine_identity_sha256", "receiver_machine_identity_sha256", "receiver_identity_sha256", "source_signing_key_fingerprint", "receiver_encryption_key_fingerprint", "receiver_receipt_key_fingerprint"]) text(value.transfer[key], SHA256, "READINESS_TRANSFER_INVALID");
  if (value.transfer.payload_algorithm !== "AES-256-GCM" || value.transfer.key_agreement !== "X25519" || value.transfer.key_derivation !== "HKDF-SHA256" || value.transfer.signature_algorithm !== "Ed25519"
    || value.transfer.source_location_id === value.transfer.receiver_location_id || value.transfer.source_machine_identity_sha256 === value.transfer.receiver_machine_identity_sha256) reject("READINESS_TRANSFER_INVALID");

  exactKeys(value.operations, ["policy_id", "policy_sha256", "policy_scope", "schedule_observation_sha256", "schedule_status", "rpo_status", "scheduler_installation_status", "retention_plan_sha256", "retention_status", "retention_execution"], "READINESS_OPERATIONS_INVALID");
  text(value.operations.policy_id, IDENTIFIER, "READINESS_OPERATIONS_INVALID");
  for (const key of ["policy_sha256", "schedule_observation_sha256", "retention_plan_sha256"]) text(value.operations[key], SHA256, "READINESS_OPERATIONS_INVALID");
  if (!new Set(["SYNTHETIC_TEST_ONLY", "TEST", "UAT", "PRODUCTION"]).has(value.operations.policy_scope)
    || value.operations.schedule_status !== "ON_TIME" || value.operations.rpo_status !== "WITHIN_RPO"
    || value.operations.retention_status !== "POLICY_VALID_DRY_RUN" || value.operations.retention_execution !== "DRY_RUN_DELETION_FORBIDDEN") reject("READINESS_OPERATIONS_INVALID");
  if (value.evidence_scope === "ACTUAL_OFFHOST") {
    if (!new Set(["UAT", "PRODUCTION"]).has(value.operations.policy_scope) || value.operations.scheduler_installation_status !== "INSTALLED_AND_OBSERVED") reject("READINESS_OPERATIONS_INVALID");
  } else if (!new Set(["SYNTHETIC_TEST_ONLY", "TEST"]).has(value.operations.policy_scope) || value.operations.scheduler_installation_status !== "REPOSITORY_EVALUATOR_ONLY") reject("READINESS_OPERATIONS_INVALID");
  if (value.transfer.source_location_id !== restore.evidence.source_location_id
    || value.transfer.receiver_location_id !== restore.evidence.offhost_location_id
    || value.transfer.receiver_identity_sha256 !== restore.evidence.offhost_receiver_identity_sha256
    || value.transfer.offhost_receipt_sha256 !== restore.evidence.offhost_receipt_sha256) reject("READINESS_TRANSFER_RESTORE_MISMATCH");
  if (value.evidence_scope === "ACTUAL_OFFHOST") {
    if (value.operations.policy_scope !== restore.deployment.class) reject("READINESS_POLICY_DEPLOYMENT_MISMATCH");
  } else if (restore.deployment.class !== "TEST") reject("READINESS_POLICY_DEPLOYMENT_MISMATCH");
  if (value.attestation !== "ROOT_PUBLISHED_INNER_V2_RESTORE_SIGNED_ENCRYPTED_OFFHOST_AND_OPERATIONS_POLICY_VERIFIED") reject("READINESS_ATTESTATION_INVALID");
  text(value.readiness_sha256, SHA256, "READINESS_INTEGRITY_INVALID");
  if (createHash("sha256").update(canonicalTransferJson(readinessBody(value))).digest("hex") !== value.readiness_sha256) reject("READINESS_INTEGRITY_INVALID");
  return value;
}

export async function createBackupRecoveryReadiness(options) {
  const policy = validateBackupOperationsPolicy(options.policy);
  const observation = validateBackupOperationsObservation(options.observation, policy);
  const retentionPlan = validateBackupRetentionPlan(options.retentionPlan, policy);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) reject("READINESS_TIME_INVALID");
  const chain = await verifyOffhostTransferEvidence({
    receiverPackageDirectory: options.receiverPackageDirectory,
    acceptanceFile: options.acceptanceFile,
    receiverKeyRoot: options.receiverKeyRoot,
    receiverEncryptionPrivateKey: options.receiverEncryptionPrivateKey,
    trustedSourceSigningPublicKey: options.trustedSourceSigningPublicKey,
    receiverReceiptPublicKey: options.receiverReceiptPublicKey,
    policy,
    now,
  });
  const restoreReceiptFile = options.restoreReceiptFile;
  const restore = validateReceipt(await safeJson(restoreReceiptFile, "RESTORE_RECEIPT_INVALID"));
  const restoreSha = await sha256File(restoreReceiptFile);
  if ([restore.verified_at, observation.observed_at, retentionPlan.generated_at, chain.acceptance.accepted_at]
    .some((value) => Date.parse(value) > now.getTime())) reject("READINESS_TIME_INVALID");
  if (restore.result !== "RESTORE_VERIFIED" || restore.backup_id !== chain.envelope.backup_id
    || restore.manifest_sha256 !== chain.envelope.inner.manifest_sha256 || restore.expires_at !== chain.envelope.inner.expires_at
    || restore.deployment.class !== chain.envelope.inner.deployment_class || restore.deployment.id !== chain.envelope.inner.deployment_id
    || restore.consistency.recovery_point_at !== chain.envelope.inner.recovery_point_at
    || restore.evidence.source_location_id !== chain.envelope.source.location_id
    || restore.evidence.offhost_location_id !== chain.envelope.receiver.location_id
    || restore.evidence.offhost_receiver_identity_sha256 !== chain.offhostReceipt.evidence.receiver_identity_sha256
    || restore.evidence.offhost_receipt_sha256 !== chain.receiverReceipt.offhost_receipt_sha256) reject("READINESS_RESTORE_CHAIN_INVALID");
  if (observation.schedule_status !== "ON_TIME" || observation.rpo_status !== "WITHIN_RPO" || observation.global_lock_status !== "AVAILABLE"
    || observation.last_attempt_status !== "SUCCEEDED" || observation.last_success_transfer_id !== chain.envelope.transfer_id
    || observation.last_success_backup_id !== chain.envelope.backup_id || observation.last_success_envelope_sha256 !== chain.envelopeSha
    || observation.last_success_receiver_receipt_sha256 !== chain.receiverReceiptSha || observation.last_success_acceptance_sha256 !== chain.acceptanceSha) reject("READINESS_SCHEDULE_CHAIN_INVALID");
  const retention = retentionPlan.decisions.find((item) => item.backup_id === chain.envelope.backup_id);
  if (!retention || retention.decision !== "KEEP" || retention.envelope_sha256 !== chain.envelopeSha
    || retention.receiver_receipt_sha256 !== chain.receiverReceiptSha || retention.acceptance_sha256 !== chain.acceptanceSha) reject("READINESS_RETENTION_CHAIN_INVALID");
  const actual = new Set(["UAT", "PRODUCTION"]).has(policy.scope);
  const scheduler = options.schedulerInstallationStatus || (actual ? null : "REPOSITORY_EVALUATOR_ONLY");
  if (actual && scheduler !== "INSTALLED_AND_OBSERVED") reject("READINESS_SCHEDULER_NOT_INSTALLED");
  const body = {
    schema_version: 3,
    contract: BACKUP_RECOVERY_READINESS_CONTRACT,
    result: actual ? BACKUP_RECOVERY_READY_RESULT : BACKUP_RECOVERY_SYNTHETIC_RESULT,
    evidence_scope: actual ? "ACTUAL_OFFHOST" : "SYNTHETIC_ISOLATED",
    backup_id: restore.backup_id,
    created_at: restore.created_at,
    verified_at: now.toISOString(),
    expires_at: restore.expires_at,
    inner_restore: { receipt_file_sha256: restoreSha, receipt_canonical_sha256: backupOperationsSha256(restore), receipt: restore },
    transfer: {
      transfer_id: chain.envelope.transfer_id,
      envelope_sha256: chain.envelopeSha,
      receiver_receipt_sha256: chain.receiverReceiptSha,
      acceptance_sha256: chain.acceptanceSha,
      offhost_receipt_sha256: chain.receiverReceipt.offhost_receipt_sha256,
      payload_algorithm: chain.envelope.encryption.payload_algorithm,
      key_agreement: chain.envelope.encryption.key_agreement,
      key_derivation: chain.envelope.encryption.key_derivation,
      signature_algorithm: "Ed25519",
      source_location_id: chain.envelope.source.location_id,
      source_machine_identity_sha256: chain.envelope.source.machine_identity_sha256,
      receiver_location_id: chain.envelope.receiver.location_id,
      receiver_machine_identity_sha256: chain.offhostReceipt.evidence.receiver_machine_identity_sha256,
      receiver_identity_sha256: chain.offhostReceipt.evidence.receiver_identity_sha256,
      source_signing_key_fingerprint: chain.envelope.source.signing_key_fingerprint,
      receiver_encryption_key_fingerprint: chain.envelope.receiver.encryption_key_fingerprint,
      receiver_receipt_key_fingerprint: chain.envelope.receiver.receipt_key_fingerprint,
    },
    operations: {
      policy_id: policy.policy_id,
      policy_sha256: backupOperationsPolicySha256(policy),
      policy_scope: policy.scope,
      schedule_observation_sha256: backupOperationsSha256(observation),
      schedule_status: observation.schedule_status,
      rpo_status: observation.rpo_status,
      scheduler_installation_status: scheduler,
      retention_plan_sha256: retentionPlan.plan_sha256,
      retention_status: "POLICY_VALID_DRY_RUN",
      retention_execution: retentionPlan.execution,
    },
    attestation: "ROOT_PUBLISHED_INNER_V2_RESTORE_SIGNED_ENCRYPTED_OFFHOST_AND_OPERATIONS_POLICY_VERIFIED",
  };
  return validateBackupRecoveryReadiness({
    ...body,
    readiness_sha256: createHash("sha256").update(canonicalTransferJson(body)).digest("hex"),
  });
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch(() => reject("READINESS_ROOT_UNSAFE"));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function validateReadinessRoot(root, readerGid) {
  if (!Number.isSafeInteger(readerGid) || readerGid < 0) reject("READINESS_READER_GID_INVALID");
  const resolved = path.resolve(root);
  const metadata = await lstat(resolved).catch(() => reject("READINESS_ROOT_UNSAFE"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.gid !== readerGid || (metadata.mode & 0o7777) !== 0o2750) reject("READINESS_ROOT_UNSAFE");
  const marker = path.join(resolved, BACKUP_RECOVERY_READINESS_ROOT_MARKER);
  const markerMetadata = await lstat(marker).catch(() => reject("READINESS_ROOT_UNSAFE"));
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink() || markerMetadata.nlink !== 1 || markerMetadata.uid !== metadata.uid
    || markerMetadata.gid !== readerGid || ![0o400, 0o440].includes(markerMetadata.mode & 0o7777)
    || await safeText(marker, "READINESS_ROOT_UNSAFE", 256) !== BACKUP_RECOVERY_READINESS_ROOT_MARKER_VALUE) reject("READINESS_ROOT_UNSAFE");
  return resolved;
}

async function acquireReadinessLock(root) {
  const lockFile = path.join(root, ".recovery-readiness-v3.lock");
  try {
    const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile("chenyida-erp-recovery-readiness-lock/v3\n", "utf8");
      await handle.chmod(0o600);
      await handle.sync();
    } finally { await handle.close(); }
    await syncDirectory(root);
  } catch (error) {
    if (error?.code !== "EEXIST") reject("READINESS_LOCK_UNSAFE");
  }
  const before = await lstat(lockFile).catch(() => reject("READINESS_LOCK_UNSAFE"));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o7777) !== 0o600 || before.size < 1 || before.size > 256) reject("READINESS_LOCK_UNSAFE");
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
  if (!acquired) { child.kill("SIGKILL"); reject("READINESS_LOCK_BUSY"); }
  return async () => {
    child.stdin.end("release\n");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("close", resolve));
    const after = await lstat(lockFile).catch(() => reject("READINESS_LOCK_UNSAFE"));
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1 || after.uid !== before.uid || (after.mode & 0o7777) !== 0o600) reject("READINESS_LOCK_CHANGED");
  };
}

async function writeReadinessFile(file, source, readerGid, conflictCode) {
  try {
    const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o640);
    try {
      await handle.writeFile(source, "utf8");
      await handle.chown(process.getuid?.() ?? 0, readerGid);
      await handle.chmod(0o640);
      await handle.sync();
    } finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== "EEXIST") reject("READINESS_PUBLICATION_FAILED");
    const metadata = await lstat(file).catch(() => reject(conflictCode));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.() || metadata.gid !== readerGid || (metadata.mode & 0o7777) !== 0o640) reject(conflictCode);
    if (await safeText(file, conflictCode) !== source) reject(conflictCode);
  }
}

async function readPublishedReadiness(file, readerGid) {
  const metadata = await lstat(file).catch(() => reject("READINESS_ALIAS_UNSAFE"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.() || metadata.gid !== readerGid || (metadata.mode & 0o7777) !== 0o640) reject("READINESS_ALIAS_UNSAFE");
  const source = await safeText(file, "READINESS_ALIAS_UNSAFE");
  let value;
  try { value = validateBackupRecoveryReadiness(parseStrictJson(source)); } catch { reject("READINESS_ALIAS_INVALID"); }
  if (source !== canonicalTransferJson(value)) reject("READINESS_ALIAS_INVALID");
  return value;
}

export async function publishBackupRecoveryReadiness({ readiness, receiptRoot, receiptReaderGid, confirm }) {
  const validated = validateBackupRecoveryReadiness(readiness);
  if (validated.result === BACKUP_RECOVERY_READY_RESULT && process.getuid?.() !== 0) reject("READINESS_ACTUAL_ROOT_REQUIRED");
  const requiredConfirmation = validated.result === BACKUP_RECOVERY_READY_RESULT
    ? "PUBLISH_ACTUAL_OFFHOST_RECOVERY_READINESS"
    : "PUBLISH_SYNTHETIC_ISOLATED_RECOVERY_EVIDENCE";
  if (confirm !== requiredConfirmation) reject("READINESS_PUBLICATION_CONFIRMATION_REQUIRED");
  const root = await validateReadinessRoot(receiptRoot, receiptReaderGid);
  const release = await acquireReadinessLock(root);
  const source = canonicalTransferJson(validated);
  const immutableFile = path.join(root, `${validated.backup_id}.${validated.transfer.transfer_id}.recovery-readiness-v3.json`);
  const aliasFile = path.join(root, BACKUP_RECOVERY_READINESS_FILE);
  const temporary = path.join(root, `.recovery-readiness.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeReadinessFile(immutableFile, source, receiptReaderGid, "READINESS_HISTORY_CONFLICT");
    const existingMetadata = await lstat(aliasFile).catch((error) => error?.code === "ENOENT" ? null : reject("READINESS_ALIAS_UNSAFE"));
    if (existingMetadata) {
      const existing = await readPublishedReadiness(aliasFile, receiptReaderGid);
      if (existing.readiness_sha256 === validated.readiness_sha256) return { immutableFile, aliasFile };
      if (existing.result === BACKUP_RECOVERY_READY_RESULT && validated.result !== BACKUP_RECOVERY_READY_RESULT) reject("READINESS_ALIAS_DOWNGRADE_FORBIDDEN");
      if (Date.parse(existing.verified_at) >= Date.parse(validated.verified_at)) reject("READINESS_ALIAS_REGRESSION");
    }
    await writeReadinessFile(temporary, source, receiptReaderGid, "READINESS_TEMP_CONFLICT");
    await rename(temporary, aliasFile);
    await syncDirectory(root);
    const published = await readPublishedReadiness(aliasFile, receiptReaderGid);
    if (published.readiness_sha256 !== validated.readiness_sha256) reject("READINESS_PUBLICATION_FAILED");
    return { immutableFile, aliasFile };
  } finally {
    await unlink(temporary).catch(() => {});
    await release();
  }
}

function cliArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || index + 1 >= argv.length || result[argv[index].slice(2)] !== undefined) reject("ARGUMENT_INVALID");
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const input = cliArgs(rest);
  if (command !== "publish" || Object.keys(input).sort().join(",") !== ["confirm", "readiness", "receipt-reader-gid", "receipt-root"].sort().join(",")) reject("ARGUMENT_SET_INVALID");
  const readiness = validateBackupRecoveryReadiness(await safeJson(path.resolve(input.readiness), "READINESS_INPUT_INVALID"));
  const readerGid = Number(input["receipt-reader-gid"]);
  await publishBackupRecoveryReadiness({ readiness, receiptRoot: input["receipt-root"], receiptReaderGid: readerGid, confirm: input.confirm });
  process.stdout.write(`${readiness.backup_id} ${readiness.result}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof BackupRecoveryReadinessError && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`backup recovery readiness rejected: ${code}\n`);
    process.exitCode = 1;
  });
}
