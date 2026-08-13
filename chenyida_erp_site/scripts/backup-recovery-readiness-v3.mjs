import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

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

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_JSON_BYTES = 1024 * 1024;

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
