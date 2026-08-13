import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { link, lstat, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  canonicalTransferJson,
  verifyOffhostTransferEvidence,
} from "./offhost-transfer-contract.mjs";

export const BACKUP_OPERATIONS_POLICY_CONTRACT = "chenyida-erp-backup-operations-policy/v1";
export const BACKUP_OPERATIONS_STATE_CONTRACT = "chenyida-erp-backup-operations-state/v1";
export const BACKUP_OPERATIONS_OBSERVATION_CONTRACT = "chenyida-erp-backup-operations-observation/v1";
export const BACKUP_RETENTION_PLAN_CONTRACT = "chenyida-erp-backup-retention-plan/v1";
export const BACKUP_OPERATIONS_ROOT_MARKER = ".chenyida-erp-backup-operations-root-v1";
export const BACKUP_OPERATIONS_ROOT_MARKER_VALUE = "chenyida-erp-backup-operations-root/v1\n";
export const BACKUP_OPERATIONS_STATE_FILE = "state.json";
export const BACKUP_OPERATIONS_STATE_LOCK = ".state-write-v1.lock";
export const BACKUP_OPERATIONS_INITIALIZED_MARKER = ".state-initialized-v1";
export const BACKUP_OPERATIONS_INITIALIZED_VALUE = "chenyida-erp-backup-operations-state-initialized/v1\n";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ZERO_SHA256 = "0".repeat(64);
const SCOPES = new Set(["SYNTHETIC_TEST_ONLY", "TEST", "UAT", "PRODUCTION"]);
const ATTEMPT_STATUSES = new Set(["NEVER_RUN", "RUNNING", "SUCCEEDED", "FAILED", "DEFERRED"]);
const SCHEDULE_STATUSES = new Set(["ON_TIME", "DUE", "MISSED", "DEFERRED", "RUNNING", "STUCK", "FAILED"]);
const TRANSITION_TYPES = new Set(["START", "SUCCESS", "FAILURE", "DEFERRED", "RECOVER_STALE"]);
const MAX_GENERATIONS = 10_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const trustedSuccessEvents = new WeakSet();

export class BackupOperationsError extends Error {
  constructor(code) {
    super(code);
    this.name = "BackupOperationsError";
    this.code = code;
  }
}

function reject(code) {
  throw new BackupOperationsError(code);
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

function integer(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) reject(code);
  return value;
}

function iso(value, code) {
  boundedString(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}

function nullableIso(value, code) {
  if (value === null) return value;
  return iso(value, code);
}

function nullableIdentifier(value, code) {
  if (value === null) return value;
  return boundedString(value, IDENTIFIER, code);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function uniqueKeyRecords(values, code) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 32) reject(code);
  for (const value of values) {
    exactKeys(value, ["fingerprint", "status", "not_before", "not_after"], code);
    boundedString(value.fingerprint, SHA256, code);
    if (!new Set(["ACTIVE", "REVOKED"]).has(value.status)) reject(code);
    iso(value.not_before, code);
    iso(value.not_after, code);
    if (Date.parse(value.not_after) <= Date.parse(value.not_before)) reject(code);
  }
  const fingerprints = values.map((value) => value.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length || [...fingerprints].sort().some((value, index) => value !== fingerprints[index])) reject(code);
  return values;
}

export function backupOperationsSha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalTransferJson(value)).digest("hex");
}

export function backupOperationsPolicySha256(policy) {
  return backupOperationsSha256(validateBackupOperationsPolicy(policy));
}

export function assertBackupOperationsKeyApproved(policy, category, fingerprint, at) {
  const validated = validateBackupOperationsPolicy(policy);
  if (!new Set(["source_signing", "receiver_encryption", "receiver_receipt"]).has(category)) reject("BACKUP_POLICY_KEY_CATEGORY_INVALID");
  boundedString(fingerprint, SHA256, "BACKUP_POLICY_KEY_FINGERPRINT_INVALID");
  const current = validateNow(at);
  const record = validated.key_allowlist[category].find((item) => item.fingerprint === fingerprint);
  if (!record || record.status !== "ACTIVE" || current.getTime() < Date.parse(record.not_before) || current.getTime() > Date.parse(record.not_after)) reject("BACKUP_POLICY_KEY_NOT_APPROVED");
  return record;
}

export function validateBackupOperationsPolicy(value) {
  exactKeys(value, ["schema_version", "contract", "policy_id", "scope", "source_location_id", "receiver_location_id", "inner_policy_id", "schedule_anchor_at", "cadence_minutes", "rpo_minutes", "grace_minutes", "max_run_minutes", "max_clock_skew_seconds", "retention_days", "min_verified_generations", "min_restore_verified_generations", "key_allowlist"], "BACKUP_POLICY_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== BACKUP_OPERATIONS_POLICY_CONTRACT) reject("BACKUP_POLICY_VERSION_INVALID");
  boundedString(value.policy_id, IDENTIFIER, "BACKUP_POLICY_INVALID");
  if (!SCOPES.has(value.scope)) reject("BACKUP_POLICY_SCOPE_INVALID");
  boundedString(value.source_location_id, IDENTIFIER, "BACKUP_POLICY_LOCATION_INVALID");
  boundedString(value.receiver_location_id, IDENTIFIER, "BACKUP_POLICY_LOCATION_INVALID");
  boundedString(value.inner_policy_id, IDENTIFIER, "BACKUP_POLICY_INNER_POLICY_INVALID");
  if (value.source_location_id === value.receiver_location_id) reject("BACKUP_POLICY_LOCATION_INVALID");
  iso(value.schedule_anchor_at, "BACKUP_POLICY_SCHEDULE_INVALID");
  integer(value.cadence_minutes, 15, 10_080, "BACKUP_POLICY_SCHEDULE_INVALID");
  integer(value.rpo_minutes, value.cadence_minutes, 10_080, "BACKUP_POLICY_SCHEDULE_INVALID");
  integer(value.grace_minutes, 0, value.rpo_minutes, "BACKUP_POLICY_SCHEDULE_INVALID");
  integer(value.max_run_minutes, 1, value.rpo_minutes, "BACKUP_POLICY_SCHEDULE_INVALID");
  integer(value.max_clock_skew_seconds, 0, 300, "BACKUP_POLICY_SCHEDULE_INVALID");
  integer(value.retention_days, 1, 3650, "BACKUP_POLICY_RETENTION_INVALID");
  integer(value.min_verified_generations, 2, 3650, "BACKUP_POLICY_RETENTION_INVALID");
  integer(value.min_restore_verified_generations, 1, value.min_verified_generations, "BACKUP_POLICY_RETENTION_INVALID");
  exactKeys(value.key_allowlist, ["source_signing", "receiver_encryption", "receiver_receipt"], "BACKUP_POLICY_KEY_ALLOWLIST_INVALID");
  uniqueKeyRecords(value.key_allowlist.source_signing, "BACKUP_POLICY_KEY_ALLOWLIST_INVALID");
  uniqueKeyRecords(value.key_allowlist.receiver_encryption, "BACKUP_POLICY_KEY_ALLOWLIST_INVALID");
  uniqueKeyRecords(value.key_allowlist.receiver_receipt, "BACKUP_POLICY_KEY_ALLOWLIST_INVALID");
  return value;
}

export function assertBackupOperationsPolicyMatchesEnvelope(policy, envelope) {
  const validated = validateBackupOperationsPolicy(policy);
  if (envelope?.source?.location_id !== validated.source_location_id
    || envelope?.receiver?.location_id !== validated.receiver_location_id
    || envelope?.inner?.policy_id !== validated.inner_policy_id
    || envelope?.inner?.rpo_hours * 60 !== validated.rpo_minutes) reject("BACKUP_POLICY_ENVELOPE_MISMATCH");
  if (validated.scope === "SYNTHETIC_TEST_ONLY") {
    if (process.env.NODE_ENV !== "test" || envelope?.inner?.deployment_class !== "TEST") reject("BACKUP_POLICY_SCOPE_MISMATCH");
  } else if (envelope?.inner?.deployment_class !== validated.scope) reject("BACKUP_POLICY_SCOPE_MISMATCH");
  return envelope;
}

function validateActiveAttempt(value) {
  if (value === null) return value;
  exactKeys(value, ["attempt_id", "started_at", "boot_id_sha256", "owner_identity_sha256"], "BACKUP_STATE_ACTIVE_ATTEMPT_INVALID");
  boundedString(value.attempt_id, IDENTIFIER, "BACKUP_STATE_ACTIVE_ATTEMPT_INVALID");
  iso(value.started_at, "BACKUP_STATE_ACTIVE_ATTEMPT_INVALID");
  boundedString(value.boot_id_sha256, SHA256, "BACKUP_STATE_ACTIVE_ATTEMPT_INVALID");
  boundedString(value.owner_identity_sha256, SHA256, "BACKUP_STATE_ACTIVE_ATTEMPT_INVALID");
  return value;
}

function stateBody(value) {
  const { integrity_sha256: _integrity, ...body } = value;
  return body;
}

export function validateBackupOperationsState(value, policy = null) {
  exactKeys(value, ["schema_version", "contract", "policy_id", "policy_sha256", "sequence", "previous_state_sha256", "last_event_at", "last_attempt_status", "last_attempt_id", "last_success_at", "last_success_transfer_id", "last_success_backup_id", "last_success_recovery_point_at", "last_success_expires_at", "last_success_envelope_sha256", "last_success_receiver_receipt_sha256", "last_success_acceptance_sha256", "consumed_transfer_ids", "active_attempt", "integrity_sha256"], "BACKUP_STATE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== BACKUP_OPERATIONS_STATE_CONTRACT) reject("BACKUP_STATE_VERSION_INVALID");
  boundedString(value.policy_id, IDENTIFIER, "BACKUP_STATE_INVALID");
  boundedString(value.policy_sha256, SHA256, "BACKUP_STATE_INVALID");
  if (policy) {
    const validatedPolicy = validateBackupOperationsPolicy(policy);
    if (value.policy_id !== validatedPolicy.policy_id || value.policy_sha256 !== backupOperationsPolicySha256(validatedPolicy)) reject("BACKUP_STATE_POLICY_MISMATCH");
  }
  integer(value.sequence, 0, Number.MAX_SAFE_INTEGER, "BACKUP_STATE_INVALID");
  boundedString(value.previous_state_sha256, SHA256, "BACKUP_STATE_INVALID");
  nullableIso(value.last_event_at, "BACKUP_STATE_INVALID");
  if (!ATTEMPT_STATUSES.has(value.last_attempt_status)) reject("BACKUP_STATE_INVALID");
  nullableIdentifier(value.last_attempt_id, "BACKUP_STATE_INVALID");
  nullableIso(value.last_success_at, "BACKUP_STATE_INVALID");
  nullableIdentifier(value.last_success_transfer_id, "BACKUP_STATE_INVALID");
  nullableIdentifier(value.last_success_backup_id, "BACKUP_STATE_INVALID");
  nullableIso(value.last_success_recovery_point_at, "BACKUP_STATE_INVALID");
  nullableIso(value.last_success_expires_at, "BACKUP_STATE_INVALID");
  for (const key of ["last_success_envelope_sha256", "last_success_receiver_receipt_sha256", "last_success_acceptance_sha256"]) {
    if (value[key] !== null) boundedString(value[key], SHA256, "BACKUP_STATE_INVALID");
  }
  validateActiveAttempt(value.active_attempt);
  boundedString(value.integrity_sha256, SHA256, "BACKUP_STATE_INVALID");
  const successValues = [value.last_success_at, value.last_success_transfer_id, value.last_success_backup_id, value.last_success_recovery_point_at, value.last_success_expires_at,
    value.last_success_envelope_sha256, value.last_success_receiver_receipt_sha256, value.last_success_acceptance_sha256];
  if (!Array.isArray(value.consumed_transfer_ids) || value.consumed_transfer_ids.length > MAX_GENERATIONS) reject("BACKUP_STATE_INVALID");
  for (const item of value.consumed_transfer_ids) boundedString(item, IDENTIFIER, "BACKUP_STATE_INVALID");
  if (new Set(value.consumed_transfer_ids).size !== value.consumed_transfer_ids.length) reject("BACKUP_STATE_INVALID");
  if (value.last_success_transfer_id !== null && value.consumed_transfer_ids.at(-1) !== value.last_success_transfer_id) reject("BACKUP_STATE_INVALID");
  if (successValues.some((item) => item === null) && successValues.some((item) => item !== null)) reject("BACKUP_STATE_INVALID");
  if (value.last_success_recovery_point_at !== null && Date.parse(value.last_success_expires_at) <= Date.parse(value.last_success_recovery_point_at)) reject("BACKUP_STATE_INVALID");
  if ((value.last_attempt_status === "RUNNING") !== (value.active_attempt !== null)) reject("BACKUP_STATE_INVALID");
  if (value.sequence === 0) {
    if (value.previous_state_sha256 !== ZERO_SHA256 || value.last_event_at !== null || value.last_attempt_status !== "NEVER_RUN" || value.last_attempt_id !== null || value.active_attempt !== null || successValues.some((item) => item !== null)) reject("BACKUP_STATE_INITIAL_INVALID");
  } else if (value.last_event_at === null || value.last_attempt_id === null || value.last_attempt_status === "NEVER_RUN") reject("BACKUP_STATE_INVALID");
  if (value.active_attempt && (value.active_attempt.attempt_id !== value.last_attempt_id || value.active_attempt.started_at !== value.last_event_at)) reject("BACKUP_STATE_ACTIVE_ATTEMPT_INVALID");
  if (value.last_attempt_status === "SUCCEEDED" && value.last_success_at !== value.last_event_at) reject("BACKUP_STATE_INVALID");
  if (backupOperationsSha256(stateBody(value)) !== value.integrity_sha256) reject("BACKUP_STATE_INTEGRITY_INVALID");
  return value;
}

export function initialBackupOperationsState(policy) {
  const validated = validateBackupOperationsPolicy(policy);
  const value = {
    schema_version: 1,
    contract: BACKUP_OPERATIONS_STATE_CONTRACT,
    policy_id: validated.policy_id,
    policy_sha256: backupOperationsPolicySha256(validated),
    sequence: 0,
    previous_state_sha256: ZERO_SHA256,
    last_event_at: null,
    last_attempt_status: "NEVER_RUN",
    last_attempt_id: null,
    last_success_at: null,
    last_success_transfer_id: null,
    last_success_backup_id: null,
    last_success_recovery_point_at: null,
    last_success_expires_at: null,
    last_success_envelope_sha256: null,
    last_success_receiver_receipt_sha256: null,
    last_success_acceptance_sha256: null,
    consumed_transfer_ids: [],
    active_attempt: null,
    integrity_sha256: "",
  };
  value.integrity_sha256 = backupOperationsSha256(stateBody(value));
  return validateBackupOperationsState(value, validated);
}

function validateEvent(event) {
  exactKeys(event, ["type", "attempt_id", "boot_id_sha256", "owner_identity_sha256", "transfer_id", "backup_id", "recovery_point_at", "expires_at", "envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "offhost_status", "acceptance_status"], "BACKUP_EVENT_FIELDS_INVALID");
  if (!TRANSITION_TYPES.has(event.type)) reject("BACKUP_EVENT_TYPE_INVALID");
  boundedString(event.attempt_id, IDENTIFIER, "BACKUP_EVENT_INVALID");
  boundedString(event.boot_id_sha256, SHA256, "BACKUP_EVENT_INVALID");
  boundedString(event.owner_identity_sha256, SHA256, "BACKUP_EVENT_INVALID");
  if (event.type === "SUCCESS") {
    boundedString(event.transfer_id, IDENTIFIER, "BACKUP_EVENT_INVALID");
    boundedString(event.backup_id, IDENTIFIER, "BACKUP_EVENT_INVALID");
    iso(event.recovery_point_at, "BACKUP_EVENT_INVALID");
    iso(event.expires_at, "BACKUP_EVENT_INVALID");
    for (const key of ["envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256"]) boundedString(event[key], SHA256, "BACKUP_EVENT_INVALID");
    if (event.offhost_status !== "OFFHOST_VERIFIED" || event.acceptance_status !== "RECEIVER_RECEIPT_ACCEPTED") reject("BACKUP_SUCCESS_EVIDENCE_INVALID");
  } else if ([event.transfer_id, event.backup_id, event.recovery_point_at, event.expires_at, event.envelope_sha256, event.receiver_receipt_sha256,
    event.acceptance_sha256, event.offhost_status, event.acceptance_status].some((item) => item !== null)) reject("BACKUP_EVENT_INVALID");
  return event;
}

export async function buildSuccessfulBackupOperationsEvent({
  policy,
  receiverPackageDirectory,
  acceptanceFile,
  receiverKeyRoot,
  receiverEncryptionPrivateKey,
  trustedSourceSigningPublicKey,
  receiverReceiptPublicKey,
  attemptId,
  bootIdSha256,
  ownerIdentitySha256,
  now,
}) {
  const validatedPolicy = validateBackupOperationsPolicy(policy);
  const current = validateNow(now);
  const evidence = await verifyOffhostTransferEvidence({
    receiverPackageDirectory,
    acceptanceFile,
    receiverKeyRoot,
    receiverEncryptionPrivateKey,
    trustedSourceSigningPublicKey,
    receiverReceiptPublicKey,
    policy: validatedPolicy,
    now: current,
  });
  assertBackupOperationsPolicyMatchesEnvelope(validatedPolicy, evidence.envelope);
  const event = validateEvent({
    type: "SUCCESS",
    attempt_id: boundedString(attemptId, IDENTIFIER, "BACKUP_EVENT_INVALID"),
    boot_id_sha256: boundedString(bootIdSha256, SHA256, "BACKUP_EVENT_INVALID"),
    owner_identity_sha256: boundedString(ownerIdentitySha256, SHA256, "BACKUP_EVENT_INVALID"),
    transfer_id: evidence.envelope.transfer_id,
    backup_id: evidence.envelope.backup_id,
    recovery_point_at: evidence.envelope.inner.recovery_point_at,
    expires_at: evidence.envelope.inner.expires_at,
    envelope_sha256: evidence.envelopeSha,
    receiver_receipt_sha256: evidence.receiverReceiptSha,
    acceptance_sha256: evidence.acceptanceSha,
    offhost_status: evidence.receiverReceipt.status,
    acceptance_status: evidence.acceptance.status,
  });
  trustedSuccessEvents.add(event);
  return Object.freeze(event);
}

function validateNow(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) reject("BACKUP_NOW_INVALID");
  return value;
}

function activeIsStale(state, policy, now, bootIdSha256 = null) {
  if (!state.active_attempt) return false;
  const elapsed = now.getTime() - Date.parse(state.active_attempt.started_at);
  if (elapsed < -policy.max_clock_skew_seconds * 1000) reject("BACKUP_CLOCK_ROLLBACK");
  return elapsed >= policy.max_run_minutes * 60_000 || (bootIdSha256 !== null && bootIdSha256 !== state.active_attempt.boot_id_sha256);
}

export function transitionBackupOperationsState({ policy, previousState, event, now }) {
  const validatedPolicy = validateBackupOperationsPolicy(policy);
  const previous = validateBackupOperationsState(previousState, validatedPolicy);
  const input = validateEvent(event);
  if (input.type === "SUCCESS" && !trustedSuccessEvents.has(input)) reject("BACKUP_SUCCESS_EVIDENCE_NOT_VERIFIED");
  const current = validateNow(now);
  if (previous.last_event_at && current.getTime() < Date.parse(previous.last_event_at) - validatedPolicy.max_clock_skew_seconds * 1000) reject("BACKUP_CLOCK_ROLLBACK");
  let active = previous.active_attempt;
  let status;
  let successAt = previous.last_success_at;
  let successTransfer = previous.last_success_transfer_id;
  let successBackup = previous.last_success_backup_id;
  let successRecoveryPoint = previous.last_success_recovery_point_at;
  let successExpiresAt = previous.last_success_expires_at;
  let successEnvelope = previous.last_success_envelope_sha256;
  let successReceiverReceipt = previous.last_success_receiver_receipt_sha256;
  let successAcceptance = previous.last_success_acceptance_sha256;
  let consumedTransfers = previous.consumed_transfer_ids;
  if (input.type === "START") {
    if (active) reject("BACKUP_OPERATION_ALREADY_ACTIVE");
    active = { attempt_id: input.attempt_id, started_at: current.toISOString(), boot_id_sha256: input.boot_id_sha256, owner_identity_sha256: input.owner_identity_sha256 };
    status = "RUNNING";
  } else if (input.type === "DEFERRED") {
    if (active) reject("BACKUP_OPERATION_ALREADY_ACTIVE");
    status = "DEFERRED";
  } else {
    if (!active || active.attempt_id !== input.attempt_id) reject("BACKUP_ATTEMPT_FENCE_MISMATCH");
    if (input.type === "RECOVER_STALE") {
      if (!activeIsStale(previous, validatedPolicy, current, input.boot_id_sha256)) reject("BACKUP_ATTEMPT_NOT_STALE");
    } else if (active.boot_id_sha256 !== input.boot_id_sha256 || active.owner_identity_sha256 !== input.owner_identity_sha256) reject("BACKUP_ATTEMPT_FENCE_MISMATCH");
    if (input.type === "SUCCESS") {
      if (previous.consumed_transfer_ids.includes(input.transfer_id)) reject("BACKUP_SUCCESS_REPLAY");
      if (Date.parse(input.recovery_point_at) > current.getTime() + validatedPolicy.max_clock_skew_seconds * 1000
        || Date.parse(input.expires_at) !== Date.parse(input.recovery_point_at) + validatedPolicy.rpo_minutes * 60_000
        || current.getTime() > Date.parse(input.expires_at)) reject("BACKUP_SUCCESS_TIME_INVALID");
      status = "SUCCEEDED";
      successAt = current.toISOString();
      successTransfer = input.transfer_id;
      successBackup = input.backup_id;
      successRecoveryPoint = input.recovery_point_at;
      successExpiresAt = input.expires_at;
      successEnvelope = input.envelope_sha256;
      successReceiverReceipt = input.receiver_receipt_sha256;
      successAcceptance = input.acceptance_sha256;
      consumedTransfers = [...previous.consumed_transfer_ids, input.transfer_id];
    } else status = "FAILED";
    active = null;
  }
  const next = {
    schema_version: 1,
    contract: BACKUP_OPERATIONS_STATE_CONTRACT,
    policy_id: validatedPolicy.policy_id,
    policy_sha256: backupOperationsPolicySha256(validatedPolicy),
    sequence: previous.sequence + 1,
    previous_state_sha256: previous.integrity_sha256,
    last_event_at: current.toISOString(),
    last_attempt_status: status,
    last_attempt_id: input.attempt_id,
    last_success_at: successAt,
    last_success_transfer_id: successTransfer,
    last_success_backup_id: successBackup,
    last_success_recovery_point_at: successRecoveryPoint,
    last_success_expires_at: successExpiresAt,
    last_success_envelope_sha256: successEnvelope,
    last_success_receiver_receipt_sha256: successReceiverReceipt,
    last_success_acceptance_sha256: successAcceptance,
    consumed_transfer_ids: consumedTransfers,
    active_attempt: active,
    integrity_sha256: "",
  };
  next.integrity_sha256 = backupOperationsSha256(stateBody(next));
  return validateBackupOperationsState(next, validatedPolicy);
}

export function evaluateBackupSchedule({ policy, state, now, globalLockStatus, bootIdSha256 }) {
  const validatedPolicy = validateBackupOperationsPolicy(policy);
  const validatedState = validateBackupOperationsState(state, validatedPolicy);
  const current = validateNow(now);
  boundedString(bootIdSha256, SHA256, "BACKUP_BOOT_ID_INVALID");
  if (!new Set(["AVAILABLE", "BUSY"]).has(globalLockStatus)) reject("BACKUP_GLOBAL_LOCK_STATUS_INVALID");
  if (validatedState.last_event_at && Date.parse(validatedState.last_event_at) > current.getTime() + validatedPolicy.max_clock_skew_seconds * 1000) reject("BACKUP_CLOCK_ROLLBACK");
  let scheduleStatus;
  const scheduleBase = validatedState.last_success_at || validatedPolicy.schedule_anchor_at;
  const nextDueAt = validatedState.last_success_at
    ? new Date(Date.parse(scheduleBase) + validatedPolicy.cadence_minutes * 60_000).toISOString()
    : scheduleBase;
  const missedAt = new Date(Date.parse(nextDueAt) + validatedPolicy.grace_minutes * 60_000).toISOString();
  if (validatedState.active_attempt) scheduleStatus = activeIsStale(validatedState, validatedPolicy, current, bootIdSha256) ? "STUCK" : "RUNNING";
  else if (current.getTime() < Date.parse(nextDueAt)) scheduleStatus = "ON_TIME";
  else if (current.getTime() >= Date.parse(missedAt)) scheduleStatus = "MISSED";
  else if (globalLockStatus === "BUSY") scheduleStatus = "DEFERRED";
  else if (validatedState.last_attempt_status === "FAILED") scheduleStatus = "FAILED";
  else scheduleStatus = "DUE";
  const rpoStatus = validatedState.last_success_expires_at === null
    ? "NOT_ESTABLISHED"
    : current.getTime() <= Date.parse(validatedState.last_success_expires_at) ? "WITHIN_RPO" : "RPO_BREACHED";
  return validateBackupOperationsObservation(deepFreeze({
    schema_version: 1,
    contract: BACKUP_OPERATIONS_OBSERVATION_CONTRACT,
    policy_id: validatedPolicy.policy_id,
    policy_sha256: backupOperationsPolicySha256(validatedPolicy),
    observed_at: current.toISOString(),
    schedule_status: scheduleStatus,
    rpo_status: rpoStatus,
    global_lock_status: globalLockStatus,
    last_attempt_status: validatedState.last_attempt_status,
    last_success_at: validatedState.last_success_at,
    last_success_transfer_id: validatedState.last_success_transfer_id,
    last_success_backup_id: validatedState.last_success_backup_id,
    last_success_recovery_point_at: validatedState.last_success_recovery_point_at,
    last_success_expires_at: validatedState.last_success_expires_at,
    last_success_envelope_sha256: validatedState.last_success_envelope_sha256,
    last_success_receiver_receipt_sha256: validatedState.last_success_receiver_receipt_sha256,
    last_success_acceptance_sha256: validatedState.last_success_acceptance_sha256,
    next_due_at: nextDueAt,
    missed_at: missedAt,
    active_attempt_id: validatedState.active_attempt?.attempt_id || null,
  }), validatedPolicy);
}

export function validateBackupOperationsObservation(value, policy = null) {
  exactKeys(value, ["schema_version", "contract", "policy_id", "policy_sha256", "observed_at", "schedule_status", "rpo_status", "global_lock_status", "last_attempt_status", "last_success_at", "last_success_transfer_id", "last_success_backup_id", "last_success_recovery_point_at", "last_success_expires_at", "last_success_envelope_sha256", "last_success_receiver_receipt_sha256", "last_success_acceptance_sha256", "next_due_at", "missed_at", "active_attempt_id"], "BACKUP_OBSERVATION_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== BACKUP_OPERATIONS_OBSERVATION_CONTRACT) reject("BACKUP_OBSERVATION_VERSION_INVALID");
  boundedString(value.policy_id, IDENTIFIER, "BACKUP_OBSERVATION_INVALID");
  boundedString(value.policy_sha256, SHA256, "BACKUP_OBSERVATION_INVALID");
  if (policy && (value.policy_id !== validateBackupOperationsPolicy(policy).policy_id || value.policy_sha256 !== backupOperationsPolicySha256(policy))) reject("BACKUP_OBSERVATION_POLICY_MISMATCH");
  iso(value.observed_at, "BACKUP_OBSERVATION_INVALID");
  if (!SCHEDULE_STATUSES.has(value.schedule_status) || !new Set(["NOT_ESTABLISHED", "WITHIN_RPO", "RPO_BREACHED"]).has(value.rpo_status)
    || !new Set(["AVAILABLE", "BUSY"]).has(value.global_lock_status) || !ATTEMPT_STATUSES.has(value.last_attempt_status)) reject("BACKUP_OBSERVATION_INVALID");
  for (const key of ["last_success_at", "last_success_recovery_point_at", "last_success_expires_at", "next_due_at", "missed_at"]) nullableIso(value[key], "BACKUP_OBSERVATION_INVALID");
  for (const key of ["last_success_transfer_id", "last_success_backup_id", "active_attempt_id"]) nullableIdentifier(value[key], "BACKUP_OBSERVATION_INVALID");
  for (const key of ["last_success_envelope_sha256", "last_success_receiver_receipt_sha256", "last_success_acceptance_sha256"]) {
    if (value[key] !== null) boundedString(value[key], SHA256, "BACKUP_OBSERVATION_INVALID");
  }
  const successValues = [value.last_success_at, value.last_success_transfer_id, value.last_success_backup_id, value.last_success_recovery_point_at, value.last_success_expires_at,
    value.last_success_envelope_sha256, value.last_success_receiver_receipt_sha256, value.last_success_acceptance_sha256];
  if (successValues.some((item) => item === null) && successValues.some((item) => item !== null)) reject("BACKUP_OBSERVATION_INVALID");
  if ((value.rpo_status === "NOT_ESTABLISHED") !== (value.last_success_at === null)) reject("BACKUP_OBSERVATION_INVALID");
  if (value.last_success_at !== null) {
    const expectedRpo = Date.parse(value.observed_at) <= Date.parse(value.last_success_expires_at) ? "WITHIN_RPO" : "RPO_BREACHED";
    if (value.rpo_status !== expectedRpo) reject("BACKUP_OBSERVATION_INVALID");
  }
  if ((value.schedule_status === "RUNNING" || value.schedule_status === "STUCK") !== (value.active_attempt_id !== null)) reject("BACKUP_OBSERVATION_INVALID");
  return value;
}

function validateGeneration(value) {
  exactKeys(value, ["backup_id", "created_at", "recovery_point_at", "expires_at", "envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "transfer_status", "restore_status", "restore_receipt_sha256", "hold", "inflight"], "RETENTION_GENERATION_FIELDS_INVALID");
  boundedString(value.backup_id, IDENTIFIER, "RETENTION_GENERATION_INVALID");
  iso(value.created_at, "RETENTION_GENERATION_INVALID");
  iso(value.recovery_point_at, "RETENTION_GENERATION_INVALID");
  iso(value.expires_at, "RETENTION_GENERATION_INVALID");
  if (Date.parse(value.created_at) < Date.parse(value.recovery_point_at) || Date.parse(value.expires_at) <= Date.parse(value.recovery_point_at)) reject("RETENTION_GENERATION_INVALID");
  boundedString(value.envelope_sha256, SHA256, "RETENTION_GENERATION_INVALID");
  boundedString(value.receiver_receipt_sha256, SHA256, "RETENTION_GENERATION_INVALID");
  boundedString(value.acceptance_sha256, SHA256, "RETENTION_GENERATION_INVALID");
  if (value.restore_receipt_sha256 !== null) boundedString(value.restore_receipt_sha256, SHA256, "RETENTION_GENERATION_INVALID");
  if (value.transfer_status !== "RECEIVER_RECEIPT_ACCEPTED" || !new Set(["RESTORE_VERIFIED", "NOT_VERIFIED"]).has(value.restore_status)
    || typeof value.hold !== "boolean" || typeof value.inflight !== "boolean") reject("RETENTION_GENERATION_INVALID");
  if ((value.restore_status === "RESTORE_VERIFIED") !== (value.restore_receipt_sha256 !== null)) reject("RETENTION_GENERATION_INVALID");
  return value;
}

export function planBackupRetention({ policy, generations, now }) {
  const validatedPolicy = validateBackupOperationsPolicy(policy);
  const current = validateNow(now);
  if (!Array.isArray(generations) || generations.length === 0 || generations.length > MAX_GENERATIONS) reject("RETENTION_GENERATIONS_INVALID");
  const values = generations.map(validateGeneration).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || left.backup_id.localeCompare(right.backup_id));
  if (values.length < validatedPolicy.min_verified_generations) reject("RETENTION_VERIFIED_GENERATIONS_INSUFFICIENT");
  if (new Set(values.map((item) => item.backup_id)).size !== values.length) reject("RETENTION_GENERATION_DUPLICATE");
  for (const key of ["envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256"]) {
    if (new Set(values.map((item) => item[key])).size !== values.length) reject("RETENTION_EVIDENCE_REUSED");
  }
  if (values.some((item) => Date.parse(item.expires_at) !== Date.parse(item.recovery_point_at) + validatedPolicy.rpo_minutes * 60_000)) reject("RETENTION_GENERATION_POLICY_MISMATCH");
  if (values.some((item) => Date.parse(item.created_at) > current.getTime() + validatedPolicy.max_clock_skew_seconds * 1000)) reject("RETENTION_GENERATION_FROM_FUTURE");
  const protectedIds = new Map();
  const protect = (id, reason) => {
    const reasons = protectedIds.get(id) || new Set();
    reasons.add(reason);
    protectedIds.set(id, reasons);
  };
  const latestCreatedAt = values[0].created_at;
  for (const item of values.filter((entry) => entry.created_at === latestCreatedAt)) protect(item.backup_id, "LATEST_GENERATION");
  const verifiedBoundary = values[validatedPolicy.min_verified_generations - 1]?.created_at;
  for (const item of values.filter((entry) => Date.parse(entry.created_at) >= Date.parse(verifiedBoundary))) protect(item.backup_id, "MIN_VERIFIED_GENERATIONS");
  const restored = values.filter((item) => item.restore_status === "RESTORE_VERIFIED");
  if (restored.length < validatedPolicy.min_restore_verified_generations) reject("RETENTION_RESTORE_GENERATIONS_INSUFFICIENT");
  const restoredBoundary = restored[validatedPolicy.min_restore_verified_generations - 1].created_at;
  for (const item of restored.filter((entry) => Date.parse(entry.created_at) >= Date.parse(restoredBoundary))) protect(item.backup_id, "MIN_RESTORE_VERIFIED_GENERATIONS");
  for (const item of values) {
    if (item.hold) protect(item.backup_id, "HOLD");
    if (item.inflight) protect(item.backup_id, "INFLIGHT");
    if (current.getTime() <= Date.parse(item.expires_at)) protect(item.backup_id, "RPO_WINDOW");
    if (current.getTime() - Date.parse(item.created_at) <= validatedPolicy.retention_days * 86_400_000) protect(item.backup_id, "RETENTION_WINDOW");
  }
  const decisions = values.map((item) => {
    const reasons = [...(protectedIds.get(item.backup_id) || [])].sort();
    return {
      backup_id: item.backup_id,
      envelope_sha256: item.envelope_sha256,
      receiver_receipt_sha256: item.receiver_receipt_sha256,
      acceptance_sha256: item.acceptance_sha256,
      decision: reasons.length ? "KEEP" : "DELETE_CANDIDATE",
      reasons,
    };
  });
  const body = {
    schema_version: 1,
    contract: BACKUP_RETENTION_PLAN_CONTRACT,
    policy_id: validatedPolicy.policy_id,
    policy_sha256: backupOperationsPolicySha256(validatedPolicy),
    generated_at: current.toISOString(),
    execution: "DRY_RUN_DELETION_FORBIDDEN",
    generation_count: decisions.length,
    keep_count: decisions.filter((item) => item.decision === "KEEP").length,
    delete_candidate_count: decisions.filter((item) => item.decision === "DELETE_CANDIDATE").length,
    decisions,
  };
  return validateBackupRetentionPlan(deepFreeze({ ...body, plan_sha256: backupOperationsSha256(body) }), validatedPolicy);
}

export function validateBackupRetentionPlan(value, policy = null) {
  exactKeys(value, ["schema_version", "contract", "policy_id", "policy_sha256", "generated_at", "execution", "generation_count", "keep_count", "delete_candidate_count", "decisions", "plan_sha256"], "RETENTION_PLAN_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== BACKUP_RETENTION_PLAN_CONTRACT || value.execution !== "DRY_RUN_DELETION_FORBIDDEN") reject("RETENTION_PLAN_VERSION_INVALID");
  boundedString(value.policy_id, IDENTIFIER, "RETENTION_PLAN_INVALID");
  boundedString(value.policy_sha256, SHA256, "RETENTION_PLAN_INVALID");
  if (policy && (value.policy_id !== validateBackupOperationsPolicy(policy).policy_id || value.policy_sha256 !== backupOperationsPolicySha256(policy))) reject("RETENTION_PLAN_POLICY_MISMATCH");
  iso(value.generated_at, "RETENTION_PLAN_INVALID");
  integer(value.generation_count, 1, MAX_GENERATIONS, "RETENTION_PLAN_INVALID");
  integer(value.keep_count, 1, value.generation_count, "RETENTION_PLAN_INVALID");
  integer(value.delete_candidate_count, 0, value.generation_count, "RETENTION_PLAN_INVALID");
  if (!Array.isArray(value.decisions) || value.decisions.length !== value.generation_count || value.keep_count + value.delete_candidate_count !== value.generation_count) reject("RETENTION_PLAN_INVALID");
  const ids = [];
  for (const decision of value.decisions) {
    exactKeys(decision, ["backup_id", "envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256", "decision", "reasons"], "RETENTION_PLAN_DECISION_INVALID");
    ids.push(boundedString(decision.backup_id, IDENTIFIER, "RETENTION_PLAN_DECISION_INVALID"));
    for (const key of ["envelope_sha256", "receiver_receipt_sha256", "acceptance_sha256"]) boundedString(decision[key], SHA256, "RETENTION_PLAN_DECISION_INVALID");
    if (!new Set(["KEEP", "DELETE_CANDIDATE"]).has(decision.decision) || !Array.isArray(decision.reasons)
      || decision.reasons.some((item) => typeof item !== "string" || !IDENTIFIER.test(item))
      || new Set(decision.reasons).size !== decision.reasons.length || [...decision.reasons].sort().some((item, index) => item !== decision.reasons[index])
      || (decision.decision === "KEEP") !== (decision.reasons.length > 0)) reject("RETENTION_PLAN_DECISION_INVALID");
  }
  if (new Set(ids).size !== ids.length) reject("RETENTION_PLAN_INVALID");
  const { plan_sha256: planSha, ...body } = value;
  boundedString(planSha, SHA256, "RETENTION_PLAN_INVALID");
  if (backupOperationsSha256(body) !== planSha) reject("RETENTION_PLAN_INTEGRITY_INVALID");
  return value;
}

async function safeStateRoot(root) {
  const resolved = path.resolve(root);
  if (await realpath(resolved).catch(() => null) !== resolved) reject("BACKUP_STATE_ROOT_UNSAFE");
  const metadata = await lstat(resolved).catch(() => reject("BACKUP_STATE_ROOT_UNSAFE"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o700) reject("BACKUP_STATE_ROOT_UNSAFE");
  const marker = path.join(resolved, BACKUP_OPERATIONS_ROOT_MARKER);
  const markerMetadata = await lstat(marker).catch(() => reject("BACKUP_STATE_ROOT_UNSAFE"));
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink() || markerMetadata.nlink !== 1 || markerMetadata.uid !== metadata.uid || ![0o400, 0o600].includes(markerMetadata.mode & 0o777)) reject("BACKUP_STATE_ROOT_UNSAFE");
  const source = await readSafeFile(marker, 256);
  if (source !== BACKUP_OPERATIONS_ROOT_MARKER_VALUE) reject("BACKUP_STATE_ROOT_UNSAFE");
  return resolved;
}

async function readSafeFile(file, maxBytes) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject("BACKUP_STATE_FILE_UNSAFE"));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.size <= 0 || before.size > maxBytes || (before.mode & 0o022) !== 0) reject("BACKUP_STATE_FILE_UNSAFE");
    const source = await handle.readFile("utf8");
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) reject("BACKUP_STATE_FILE_CHANGED");
    return source;
  } finally { await handle.close(); }
}

async function syncDirectory(directoryPath) {
  const handle = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeImmutableStateRecord(root, state) {
  const file = path.join(root, `state-${String(state.sequence).padStart(10, "0")}.json`);
  const temporary = path.join(root, `.state-record.${process.pid}.${Date.now()}.tmp`);
  const source = canonicalTransferJson(state);
  let handle;
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400);
    await handle.writeFile(source, "utf8");
    await handle.chmod(0o400);
    await handle.sync();
    await handle.close();
    handle = null;
    try { await link(temporary, file); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    await syncDirectory(root);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
  if (await readSafeFile(file, MAX_JSON_BYTES) !== source) reject("BACKUP_STATE_HISTORY_CONFLICT");
}

async function readLatestHistoryState(root, policy) {
  const names = (await readdir(root)).filter((name) => /^state-\d{10}\.json$/.test(name)).sort();
  if (names.length === 0 || names.length > MAX_GENERATIONS) reject("BACKUP_STATE_HISTORY_MISSING");
  let previous = initialBackupOperationsState(policy);
  for (const [index, name] of names.entries()) {
    const expected = `state-${String(index + 1).padStart(10, "0")}.json`;
    if (name !== expected) reject("BACKUP_STATE_HISTORY_GAP");
    const current = validateBackupOperationsState(parseStrictJson(await readSafeFile(path.join(root, name), MAX_JSON_BYTES)), policy);
    if (current.sequence !== index + 1 || current.previous_state_sha256 !== previous.integrity_sha256) reject("BACKUP_STATE_HISTORY_CHAIN_INVALID");
    previous = current;
  }
  return previous;
}

async function acquireStateWriteLock(root) {
  const lockFile = path.join(root, BACKUP_OPERATIONS_STATE_LOCK);
  let created = false;
  try {
    const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile("chenyida-erp-backup-operations-state-lock/v1\n", "utf8");
      await handle.chmod(0o600);
      await handle.sync();
      created = true;
    } finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== "EEXIST") reject("BACKUP_STATE_WRITE_LOCK_UNSAFE");
  }
  if (created) await syncDirectory(root);
  const metadata = await lstat(lockFile).catch(() => reject("BACKUP_STATE_WRITE_LOCK_UNSAFE"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.()
    || (metadata.mode & 0o777) !== 0o600 || metadata.size < 1 || metadata.size > 256) reject("BACKUP_STATE_WRITE_LOCK_UNSAFE");
  const child = spawn("flock", ["-n", lockFile, "sh", "-c", "printf 'LOCKED\\n'; IFS= read -r release"], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
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
    reject("BACKUP_STATE_WRITE_LOCK_BUSY");
  }
  return async () => {
    child.stdin.end("release\n");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("close", resolve));
    const after = await lstat(lockFile).catch(() => reject("BACKUP_STATE_WRITE_LOCK_UNSAFE"));
    if (after.dev !== metadata.dev || after.ino !== metadata.ino || after.uid !== metadata.uid || after.nlink !== 1 || (after.mode & 0o777) !== 0o600) reject("BACKUP_STATE_WRITE_LOCK_CHANGED");
  };
}

export async function readBackupOperationsStateFile({ stateRoot, stateFile, policy }) {
  const root = await safeStateRoot(stateRoot);
  const resolved = path.resolve(stateFile);
  if (path.dirname(resolved) !== root || path.basename(resolved) !== BACKUP_OPERATIONS_STATE_FILE) reject("BACKUP_STATE_FILE_UNSAFE");
  try { return validateBackupOperationsState(parseStrictJson(await readSafeFile(resolved, MAX_JSON_BYTES)), policy); } catch (error) {
    if (error?.code === "BACKUP_STATE_FILE_UNSAFE" && !(await lstat(resolved).catch(() => null))) {
      const initialized = path.join(root, BACKUP_OPERATIONS_INITIALIZED_MARKER);
      if (await lstat(initialized).catch(() => null)) {
        if (await readSafeFile(initialized, 256) !== BACKUP_OPERATIONS_INITIALIZED_VALUE) reject("BACKUP_STATE_INITIALIZATION_INVALID");
        return readLatestHistoryState(root, policy);
      }
      return initialBackupOperationsState(policy);
    }
    throw error;
  }
}

export async function transitionAndWriteBackupOperationsState({ stateRoot, stateFile, previousState, event, now, policy }) {
  const root = await safeStateRoot(stateRoot);
  const resolved = path.resolve(stateFile);
  if (path.dirname(resolved) !== root || path.basename(resolved) !== BACKUP_OPERATIONS_STATE_FILE) reject("BACKUP_STATE_FILE_UNSAFE");
  const previous = validateBackupOperationsState(previousState, policy);
  const desired = transitionBackupOperationsState({ policy, previousState: previous, event, now });
  const release = await acquireStateWriteLock(root);
  const temporary = path.join(root, `.state.${process.pid}.${Date.now()}.tmp`);
  try {
    const current = await readBackupOperationsStateFile({ stateRoot: root, stateFile: resolved, policy });
    if (current.integrity_sha256 === desired.integrity_sha256) return current;
    if (current.integrity_sha256 !== previous.integrity_sha256) reject("BACKUP_STATE_CAS_MISMATCH");
    if (previous.sequence === 0) {
      const initialized = path.join(root, BACKUP_OPERATIONS_INITIALIZED_MARKER);
      const handle = await open(initialized, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o400)
        .catch((error) => error?.code === "EEXIST" ? reject("BACKUP_STATE_INITIALIZATION_CONFLICT") : reject("BACKUP_STATE_INITIALIZATION_FAILED"));
      try {
        await handle.writeFile(BACKUP_OPERATIONS_INITIALIZED_VALUE, "utf8");
        await handle.chmod(0o400);
        await handle.sync();
      } finally { await handle.close(); }
      await syncDirectory(root);
    }
    await writeImmutableStateRecord(root, desired);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(canonicalTransferJson(desired), "utf8");
      await handle.chmod(0o600);
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, resolved);
    await syncDirectory(root);
    return desired;
  } finally {
    await unlink(temporary).catch(() => {});
    await release();
  }
}

async function readJsonFile(file) {
  const source = await readSafeFile(path.resolve(file), MAX_JSON_BYTES);
  try { return parseStrictJson(source); } catch { reject("BACKUP_JSON_FILE_INVALID"); }
}

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || index + 1 >= argv.length || result[argv[index].slice(2)] !== undefined) reject("ARGUMENT_INVALID");
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

function only(input, required) {
  const allowed = new Set(required);
  if (Object.keys(input).some((key) => !allowed.has(key)) || required.some((key) => input[key] === undefined)) reject("ARGUMENT_SET_INVALID");
}

async function main(argv) {
  const [commandName, ...rest] = argv;
  const input = args(rest);
  if (commandName === "evaluate") {
    only(input, ["policy", "state", "now", "global-lock-status", "boot-id-sha256"]);
    const policy = validateBackupOperationsPolicy(await readJsonFile(input.policy));
    const state = validateBackupOperationsState(await readJsonFile(input.state), policy);
    process.stdout.write(canonicalTransferJson(evaluateBackupSchedule({ policy, state, now: input.now, globalLockStatus: input["global-lock-status"], bootIdSha256: input["boot-id-sha256"] })));
    return;
  }
  if (commandName === "plan-retention") {
    only(input, ["policy", "generations", "now"]);
    const policy = validateBackupOperationsPolicy(await readJsonFile(input.policy));
    const generations = await readJsonFile(input.generations);
    process.stdout.write(canonicalTransferJson(planBackupRetention({ policy, generations, now: input.now })));
    return;
  }
  reject("COMMAND_INVALID");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main(process.argv.slice(2)).catch((error) => {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`backup operations policy rejected: ${code}\n`);
    process.exitCode = 1;
  });
}
