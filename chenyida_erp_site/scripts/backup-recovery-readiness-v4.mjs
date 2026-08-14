import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  BACKUP_RECOVERY_READINESS_FILE,
  BACKUP_RECOVERY_READINESS_ROOT_MARKER,
  BACKUP_RECOVERY_READINESS_ROOT_MARKER_VALUE,
  BACKUP_RECOVERY_READY_RESULT,
  BACKUP_RECOVERY_SYNTHETIC_RESULT,
  validateBackupRecoveryReadiness,
} from "./backup-recovery-readiness-v3.mjs";
import { canonicalTransferJson } from "./offhost-transfer-contract.mjs";
import {
  CLUSTER_POLICY_CONTRACT,
  clusterPolicySha256,
  clusterSha256,
  validateClusterSecurityReceipt,
  validateCredentialBindingReceipt,
  validateRecoveryIntent,
  validateRecoveryState,
  validateTablespaceReceipt,
  transitionRecoveryState,
} from "./postgresql-cluster-recovery-contract.mjs";
import {
  baseClusterRecoveryPolicy,
  isClusterRecoveryPolicyV2,
  validateClusterRecoveryPolicyForReadiness,
  validateRecoveryControlIntentForPolicy,
} from "./postgresql-cluster-recovery-policy-v2-contract.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CONTRACT,
  validateRuntimePrivilegeOperatorIntent,
  validateRuntimePrivilegeOperatorReceipt,
  validateRuntimePrivilegeOperatorState,
} from "./postgresql-runtime-privilege-operator.mjs";
import {
  validateJointTransferV2,
  verifyJointTransferV2,
} from "./postgresql-cluster-transfer-contract.mjs";

export const BACKUP_RECOVERY_READINESS_V4_CONTRACT = "chenyida-erp-backup-verification/v4";
export const BACKUP_RECOVERY_READINESS_V4_ATTESTATION = "ROOT_PUBLISHED_DATA_V3_JOINT_TRANSFER_V2_CLUSTER_SECURITY_CREDENTIAL_TABLESPACE_AND_RECOVERY_STATE_VERIFIED";
export const BACKUP_RECOVERY_READINESS_V4_POLICY_V2_ATTESTATION = "ROOT_PUBLISHED_DATA_V3_JOINT_TRANSFER_V2_CLUSTER_SECURITY_CREDENTIAL_TABLESPACE_RECOVERY_STATE_AND_RUNTIME_PRIVILEGE_VERIFIED";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RECOVERY_STATES = 256;
const SAFE_PATH = "/usr/bin:/bin";

export class BackupRecoveryReadinessV4Error extends Error {
  constructor(code) {
    super(code);
    this.name = "BackupRecoveryReadinessV4Error";
    this.code = code;
  }
}

function reject(code) {
  throw new BackupRecoveryReadinessV4Error(code);
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

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function readinessBody(value) {
  const body = { ...value };
  delete body.readiness_sha256;
  return body;
}

function transferSha256(value) {
  return createHash("sha256").update(canonicalTransferJson(value)).digest("hex");
}

function stateChainSha256(states) {
  return clusterSha256(states.map((state) => state.state_sha256));
}

function validateRecoveryStateChain(statesInput, intent) {
  if (!Array.isArray(statesInput) || statesInput.length < 1 || statesInput.length > MAX_RECOVERY_STATES) reject("READINESS_V4_STATE_CHAIN_INVALID");
  const states = statesInput.map((state) => validateRecoveryState(state, intent));
  if (states[0].sequence !== 0 || states[0].phase !== "INTENT_DURABLE") reject("READINESS_V4_STATE_CHAIN_INVALID");
  for (let index = 1; index < states.length; index += 1) {
    const previous = states[index - 1], current = states[index];
    if (current.sequence !== index || current.previous_state_sha256 !== previous.state_sha256) reject("READINESS_V4_STATE_CHAIN_INVALID");
    const expected = transitionRecoveryState(previous, intent, {
      phase: current.phase,
      operation: current.operation,
      recordedAt: current.recorded_at,
    });
    if (canonicalTransferJson(expected) !== canonicalTransferJson(current)) reject("READINESS_V4_STATE_CHAIN_INVALID");
  }
  const finalState = states.at(-1);
  if (finalState.phase !== "PUBLISHED" || finalState.sequence !== states.length - 1) reject("READINESS_V4_RECOVERY_NOT_PUBLISHED");
  if (states.some((state) => Date.parse(state.recorded_at) < Date.parse(intent.created_at))) reject("READINESS_V4_STATE_TIME_INVALID");
  return { states, finalState };
}

function assertJointEvidence(value, verification) {
  if (!verification) reject("READINESS_V4_JOINT_VERIFICATION_REQUIRED");
  const joint = verifyJointTransferV2({
    joint: value.joint_transfer.receipt,
    dataEvidence: verification.dataEvidence,
    clusterEvidence: verification.clusterEvidence,
    sourceSigningPublicKey: verification.sourceSigningPublicKey,
    receiverReceiptPublicKey: verification.receiverReceiptPublicKey,
  });
  if (transferSha256(joint) !== value.joint_transfer.receipt_sha256) reject("READINESS_V4_JOINT_SHA256_MISMATCH");
  return joint;
}

function rejectLegacyPolicyActual(policy, evidence) {
  const actual = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    && evidence.result === BACKUP_RECOVERY_READY_RESULT
    && evidence.evidence_scope === "ACTUAL_OFFHOST";
  if (actual && policy.schema_version === 1 && policy.contract === CLUSTER_POLICY_CONTRACT) {
    reject("READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN");
  }
}

function requireActualPolicyActivation(policy, evidence) {
  const actual = evidence?.result === BACKUP_RECOVERY_READY_RESULT && evidence?.evidence_scope === "ACTUAL_OFFHOST";
  if (!actual) return;
  rejectLegacyPolicyActual(policy, evidence);
  if (!isClusterRecoveryPolicyV2(policy) || policy.activation.status !== "ACTIVATED") reject("READINESS_V4_POLICY_V2_ACTIVATION_REQUIRED");
  iso(policy.activation.activated_at, "READINESS_V4_POLICY_V2_ACTIVATION_TIME_INVALID");
  iso(policy.activation.expires_at, "READINESS_V4_POLICY_V2_ACTIVATION_TIME_INVALID");
  if (Date.parse(evidence.verified_at) < Date.parse(policy.activation.activated_at)
    || Date.parse(evidence.verified_at) >= Date.parse(policy.activation.expires_at)) reject("READINESS_V4_POLICY_V2_ACTIVATION_EXPIRED");
}

function validateRecoveryControlEvidence(value, { policy, baseIntent }) {
  exactKeys(value, ["intent_sha256", "status", "intent"], "READINESS_V4_RECOVERY_CONTROL_INVALID");
  text(value.intent_sha256, SHA256, "READINESS_V4_RECOVERY_CONTROL_INVALID");
  if (value.status !== "VERIFIED") reject("READINESS_V4_RECOVERY_CONTROL_INVALID");
  let control;
  try { ({ control } = validateRecoveryControlIntentForPolicy(value.intent, policy, baseIntent)); }
  catch { reject("READINESS_V4_RECOVERY_CONTROL_INVALID"); }
  if (value.intent_sha256 !== control.intent_sha256) reject("READINESS_V4_RECOVERY_CONTROL_INVALID");
  return control;
}

function validateRuntimePrivilegeEvidence(value, { policy, control, cluster }) {
  exactKeys(value, ["intent_sha256", "final_state_sha256", "receipt_sha256", "status", "intent", "final_state", "receipt"], "READINESS_V4_RUNTIME_PRIVILEGE_INVALID");
  for (const key of ["intent_sha256", "final_state_sha256", "receipt_sha256"]) text(value[key], SHA256, "READINESS_V4_RUNTIME_PRIVILEGE_INVALID");
  if (value.status !== "VERIFIED") reject("READINESS_V4_RUNTIME_PRIVILEGE_INVALID");
  let intent, finalState, receipt;
  try {
    intent = validateRuntimePrivilegeOperatorIntent(value.intent);
    finalState = validateRuntimePrivilegeOperatorState(value.final_state, intent);
    receipt = validateRuntimePrivilegeOperatorReceipt(value.receipt, intent, finalState);
  } catch { reject("READINESS_V4_RUNTIME_PRIVILEGE_INVALID"); }
  if (value.intent_sha256 !== intent.intent_sha256 || value.final_state_sha256 !== finalState.state_sha256
    || value.receipt_sha256 !== receipt.receipt_sha256 || receipt.contract !== RUNTIME_PRIVILEGE_OPERATOR_RECEIPT_CONTRACT
    || receipt.operation !== policy.actual_recovery_controls.required_runtime_privilege_operation
    || receipt.runtime_guard_mode !== policy.actual_recovery_controls.required_runtime_guard_mode
    || receipt.runtime_privilege_policy_sha256 !== policy.runtime_privilege_binding.policy_sha256
    || receipt.operator_policy_sha256 !== policy.runtime_privilege_binding.operator_policy_sha256
    || receipt.target.system_identifier_sha256 !== cluster.target_system_identifier_sha256
    || receipt.credential_generation_id !== control.runtime_credential_generation_id
    || receipt.credential_role_set_sha256 !== control.runtime_credential_role_set_sha256
    || receipt.credential_role_count !== policy.credential_binding.login_roles.length
    || receipt.supervisor_bundle_sha256 !== control.supervisor_bundle_sha256
    || receipt.release_manifest_sha256 !== control.release_manifest_sha256
    || receipt.runtime_configuration_sha256 !== control.runtime_configuration_sha256
    || receipt.authorization_sha256 === control.authorization_sha256
    || receipt.authorization_sha256 === policy.activation.authorization_sha256) reject("READINESS_V4_RUNTIME_PRIVILEGE_BINDING_MISMATCH");
  return { intent, finalState, receipt };
}

export function validateBackupRecoveryReadinessV4(value, policyInput) {
  const policy = validateClusterRecoveryPolicyForReadiness(policyInput);
  const basePolicy = baseClusterRecoveryPolicy(policy);
  const policyV2 = isClusterRecoveryPolicyV2(policy);
  const expectedFields = [
    "schema_version", "contract", "result", "evidence_scope", "backup_id", "restore_run_id", "created_at",
    "verified_at", "expires_at", "data_readiness", "joint_transfer", "recovery_execution", "cluster_security",
    "credential_binding", "tablespace", "status", "attestation", "readiness_sha256",
  ];
  if (policyV2) expectedFields.push("recovery_control", "runtime_privilege");
  exactKeys(value, expectedFields, "READINESS_V4_FIELDS_INVALID");
  if (value.schema_version !== 4 || value.contract !== BACKUP_RECOVERY_READINESS_V4_CONTRACT
    || !new Set([BACKUP_RECOVERY_READY_RESULT, BACKUP_RECOVERY_SYNTHETIC_RESULT]).has(value.result)
    || !new Set(["ACTUAL_OFFHOST", "SYNTHETIC_ISOLATED"]).has(value.evidence_scope)) reject("READINESS_V4_VERSION_INVALID");
  if ((value.result === BACKUP_RECOVERY_READY_RESULT) !== (value.evidence_scope === "ACTUAL_OFFHOST")) reject("READINESS_V4_SCOPE_INVALID");
  rejectLegacyPolicyActual(policy, value);
  text(value.backup_id, IDENTIFIER, "READINESS_V4_IDENTITY_INVALID");
  text(value.restore_run_id, IDENTIFIER, "READINESS_V4_IDENTITY_INVALID");
  iso(value.created_at, "READINESS_V4_TIME_INVALID");
  iso(value.verified_at, "READINESS_V4_TIME_INVALID");
  iso(value.expires_at, "READINESS_V4_TIME_INVALID");
  if (Date.parse(value.created_at) > Date.parse(value.verified_at) || Date.parse(value.verified_at) > Date.parse(value.expires_at)) reject("READINESS_V4_TIME_INVALID");
  requireActualPolicyActivation(policy, value);

  exactKeys(value.data_readiness, ["readiness_v3_sha256", "receipt"], "READINESS_V4_DATA_INVALID");
  text(value.data_readiness.readiness_v3_sha256, SHA256, "READINESS_V4_DATA_INVALID");
  const data = validateBackupRecoveryReadiness(value.data_readiness.receipt);
  if (data.readiness_sha256 !== value.data_readiness.readiness_v3_sha256 || data.backup_id !== value.backup_id
    || data.created_at !== value.created_at || data.expires_at !== value.expires_at) reject("READINESS_V4_DATA_MISMATCH");

  exactKeys(value.joint_transfer, ["receipt_sha256", "receipt"], "READINESS_V4_JOINT_INVALID");
  text(value.joint_transfer.receipt_sha256, SHA256, "READINESS_V4_JOINT_INVALID");
  const joint = validateJointTransferV2(value.joint_transfer.receipt);
  if (transferSha256(joint) !== value.joint_transfer.receipt_sha256 || joint.backup_id !== value.backup_id) reject("READINESS_V4_JOINT_MISMATCH");

  exactKeys(value.recovery_execution, ["intent_sha256", "state_chain_sha256", "state_count", "intent", "states"], "READINESS_V4_EXECUTION_INVALID");
  text(value.recovery_execution.intent_sha256, SHA256, "READINESS_V4_EXECUTION_INVALID");
  text(value.recovery_execution.state_chain_sha256, SHA256, "READINESS_V4_EXECUTION_INVALID");
  integer(value.recovery_execution.state_count, 1, MAX_RECOVERY_STATES, "READINESS_V4_EXECUTION_INVALID");
  const intent = validateRecoveryIntent(value.recovery_execution.intent);
  if (intent.intent_sha256 !== value.recovery_execution.intent_sha256 || intent.backup_id !== value.backup_id
    || intent.restore_run_id !== value.restore_run_id) reject("READINESS_V4_INTENT_MISMATCH");
  const { states, finalState } = validateRecoveryStateChain(value.recovery_execution.states, intent);
  if (states.length !== value.recovery_execution.state_count || stateChainSha256(states) !== value.recovery_execution.state_chain_sha256) reject("READINESS_V4_STATE_CHAIN_INVALID");
  const control = policyV2 ? validateRecoveryControlEvidence(value.recovery_control, { policy, baseIntent: intent }) : null;

  exactKeys(value.cluster_security, ["receipt_sha256", "snapshot_sha256", "policy_id", "policy_sha256", "target_system_identifier_sha256", "status", "receipt"], "READINESS_V4_CLUSTER_INVALID");
  for (const key of ["receipt_sha256", "snapshot_sha256", "policy_sha256", "target_system_identifier_sha256"]) text(value.cluster_security[key], SHA256, "READINESS_V4_CLUSTER_INVALID");
  if (value.cluster_security.policy_id !== basePolicy.policy_id || value.cluster_security.policy_sha256 !== clusterPolicySha256(basePolicy)
    || value.cluster_security.status !== "VERIFIED") reject("READINESS_V4_CLUSTER_INVALID");
  const cluster = validateClusterSecurityReceipt(value.cluster_security.receipt, basePolicy);
  if (cluster.receipt_sha256 !== value.cluster_security.receipt_sha256 || cluster.snapshot_sha256 !== value.cluster_security.snapshot_sha256
    || cluster.policy_id !== value.cluster_security.policy_id || cluster.policy_sha256 !== value.cluster_security.policy_sha256
    || cluster.target_system_identifier_sha256 !== value.cluster_security.target_system_identifier_sha256
    || cluster.backup_id !== value.backup_id || cluster.restore_run_id !== value.restore_run_id) reject("READINESS_V4_CLUSTER_MISMATCH");

  exactKeys(value.credential_binding, ["receipt_sha256", "role_set_sha256", "role_count", "root_enforced", "status", "receipt"], "READINESS_V4_CREDENTIAL_INVALID");
  text(value.credential_binding.receipt_sha256, SHA256, "READINESS_V4_CREDENTIAL_INVALID");
  text(value.credential_binding.role_set_sha256, SHA256, "READINESS_V4_CREDENTIAL_INVALID");
  integer(value.credential_binding.role_count, 1, 64, "READINESS_V4_CREDENTIAL_INVALID");
  if (typeof value.credential_binding.root_enforced !== "boolean" || value.credential_binding.status !== "VERIFIED") reject("READINESS_V4_CREDENTIAL_INVALID");
  const credential = validateCredentialBindingReceipt(value.credential_binding.receipt);
  if (credential.receipt_sha256 !== value.credential_binding.receipt_sha256 || credential.role_set_sha256 !== value.credential_binding.role_set_sha256
    || credential.role_count !== value.credential_binding.role_count || credential.root_enforced !== value.credential_binding.root_enforced
    || credential.backup_id !== value.backup_id || credential.restore_run_id !== value.restore_run_id) reject("READINESS_V4_CREDENTIAL_MISMATCH");

  exactKeys(value.tablespace, ["receipt_sha256", "custom_tablespace_count", "status", "receipt"], "READINESS_V4_TABLESPACE_INVALID");
  text(value.tablespace.receipt_sha256, SHA256, "READINESS_V4_TABLESPACE_INVALID");
  integer(value.tablespace.custom_tablespace_count, 0, 64, "READINESS_V4_TABLESPACE_INVALID");
  if (value.tablespace.status !== "VERIFIED") reject("READINESS_V4_TABLESPACE_INVALID");
  const tablespace = validateTablespaceReceipt(value.tablespace.receipt);
  if (tablespace.receipt_sha256 !== value.tablespace.receipt_sha256 || tablespace.custom_tablespace_count !== value.tablespace.custom_tablespace_count
    || tablespace.backup_id !== value.backup_id || tablespace.restore_run_id !== value.restore_run_id) reject("READINESS_V4_TABLESPACE_MISMATCH");

  const runtimePrivilege = policyV2
    ? validateRuntimePrivilegeEvidence(value.runtime_privilege, { policy, control, cluster })
    : null;
  const statusKeys = ["data_restore", "data_transfer", "cluster_transfer", "cluster_security", "credential_binding", "tablespace", "recovery_execution", "schedule", "retention"];
  if (policyV2) statusKeys.push("runtime_privilege");
  exactKeys(value.status, statusKeys, "READINESS_V4_STATUS_INVALID");
  const expectedStatus = {
    data_restore: "VERIFIED",
    data_transfer: "VERIFIED",
    cluster_transfer: "VERIFIED",
    cluster_security: "VERIFIED",
    credential_binding: "VERIFIED",
    tablespace: "VERIFIED",
    recovery_execution: "PUBLISHED",
    schedule: "ON_TIME",
    retention: "POLICY_VALID_DRY_RUN",
  };
  if (policyV2) expectedStatus.runtime_privilege = "VERIFIED";
  if (canonicalTransferJson(value.status) !== canonicalTransferJson(expectedStatus)) reject("READINESS_V4_STATUS_INVALID");

  const restore = data.inner_restore.receipt;
  const targetSystemIdentifierSha256 = clusterSha256(restore.evidence.target.database_system_identifier);
  if (restore.result !== "RESTORE_VERIFIED" || restore.evidence.kind !== "ISOLATED_RESTORE_VERIFICATION"
    || restore.evidence.restore_run_id !== value.restore_run_id || data.transfer.envelope_sha256 !== joint.data.envelope_sha256
    || data.transfer.receiver_receipt_sha256 !== joint.data.receiver_receipt_sha256 || data.transfer.acceptance_sha256 !== joint.data.acceptance_sha256
    || data.transfer.source_location_id !== joint.source_location_id || data.transfer.receiver_location_id !== joint.receiver_location_id
    || data.transfer.source_machine_identity_sha256 !== joint.source_machine_identity_sha256
    || data.transfer.source_signing_key_fingerprint !== joint.source_signing_key_fingerprint
    || data.transfer.receiver_encryption_key_fingerprint !== joint.receiver_encryption_key_fingerprint
    || data.transfer.receiver_receipt_key_fingerprint !== joint.receiver_receipt_key_fingerprint
    || restore.manifest_sha256 !== joint.data.manifest_sha256 || restore.consistency.recovery_point_at !== joint.data.recovery_point_at
    || restore.expires_at !== joint.data.expires_at || restore.deployment.class !== joint.data.deployment_class) reject("READINESS_V4_DATA_JOINT_MISMATCH");
  if (intent.policy_sha256 !== cluster.policy_sha256 || intent.snapshot_sha256 !== cluster.snapshot_sha256
    || intent.data_transfer_acceptance_sha256 !== joint.data.acceptance_sha256
    || intent.cluster_transfer_acceptance_sha256 !== joint.cluster.acceptance_sha256
    || intent.joint_transfer_sha256 !== value.joint_transfer.receipt_sha256
    || intent.target_system_identifier_sha256 !== targetSystemIdentifierSha256
    || cluster.target_system_identifier_sha256 !== targetSystemIdentifierSha256
    || intent.credential_generation_id !== credential.credential_generation_id
    || intent.credential_role_set_sha256 !== credential.role_set_sha256
    || credential.role_count !== basePolicy.credential_binding.login_roles.length
    || intent.tablespace_map_sha256 !== tablespace.map_sha256
    || intent.custom_tablespace_identity_sha256.length !== tablespace.custom_tablespace_count
    || tablespace.custom_tablespace_count > (policyV2 ? policy.tablespaces.maximum_custom : basePolicy.tablespaces.maximum_custom)
    || cluster.tablespace_map_sha256 !== tablespace.map_sha256
    || cluster.tablespace_receipt_sha256 !== tablespace.receipt_sha256
    || cluster.credential_receipt_sha256 !== credential.receipt_sha256
    || cluster.credential_role_set_sha256 !== credential.role_set_sha256
    || joint.cluster.snapshot_sha256 !== cluster.snapshot_sha256 || joint.cluster.policy_sha256 !== cluster.policy_sha256) reject("READINESS_V4_CLUSTER_CHAIN_MISMATCH");

  if (policyV2) {
    const sourceSystemIdentifierSha256 = clusterSha256(restore.deployment.database_system_identifier);
    const targetMarkerSha256 = createHash("sha256")
      .update(`chenyida-erp-deployment/v2:${restore.evidence.target.deployment_class}:${restore.evidence.target.deployment_id}`)
      .digest("hex");
    if (control.deployment_class !== restore.deployment.class
      || control.target_deployment_class !== restore.evidence.target.deployment_class
      || control.target_deployment_class !== policy.actual_recovery_controls.required_isolated_target_deployment_class
      || control.source_location_id !== data.transfer.source_location_id
      || control.target_location_id !== restore.location_id
      || control.source_system_identifier_sha256 !== sourceSystemIdentifierSha256
      || control.source_machine_identity_sha256 !== data.transfer.source_machine_identity_sha256
      || control.release_manifest_sha256 !== restore.manifest_sha256
      || control.operations_policy_sha256 !== data.operations.policy_sha256
      || control.rpo_hours !== restore.policy.rpo_hours
      || control.runtime_privilege_policy_sha256 !== policy.runtime_privilege_binding.policy_sha256
      || runtimePrivilege.intent.target.database_oid !== restore.evidence.target.database_oid
      || runtimePrivilege.intent.target.marker_sha256 !== targetMarkerSha256
      || control.source_system_identifier_sha256 === control.target_system_identifier_sha256
      || control.source_machine_identity_sha256 === control.target_machine_identity_sha256
      || control.source_location_id === control.target_location_id) reject("READINESS_V4_POLICY_V2_INTENT_BINDING_MISMATCH");
    if (value.evidence_scope === "ACTUAL_OFFHOST"
      && (policy.activation.environment !== control.deployment_class
        || policy.activation.rpo_hours !== control.rpo_hours
        || policy.activation.rto_minutes !== control.rto_minutes
        || policy.activation.target_disposition !== control.target_disposition
        || policy.activation.approval_reference_sha256 === control.approval_reference_sha256)) {
      reject("READINESS_V4_POLICY_V2_AUTHORIZATION_MISMATCH");
    }
  }

  const actual = value.evidence_scope === "ACTUAL_OFFHOST", clusterScope = actual ? "ACTUAL_CONTROLLED" : "SYNTHETIC_TEST_ONLY";
  if ((actual ? data.result !== BACKUP_RECOVERY_READY_RESULT : data.result !== BACKUP_RECOVERY_SYNTHETIC_RESULT)
    || joint.evidence_scope !== clusterScope || intent.evidence_scope !== clusterScope || cluster.evidence_scope !== clusterScope
    || policyV2 && control.evidence_scope !== clusterScope
    || credential.evidence_scope !== clusterScope || tablespace.evidence_scope !== clusterScope
    || credential.root_enforced !== actual || value.credential_binding.root_enforced !== actual) reject("READINESS_V4_SCOPE_CHAIN_MISMATCH");

  const jointAccepted = Date.parse(joint.accepted_at), intentCreated = Date.parse(intent.created_at), restoreVerified = Date.parse(restore.verified_at), dataVerified = Date.parse(data.verified_at);
  const tablespaceVerified = Date.parse(tablespace.verified_at), credentialBound = Date.parse(credential.bound_at), clusterVerified = Date.parse(cluster.verified_at), finalRecorded = Date.parse(finalState.recorded_at), verified = Date.parse(value.verified_at);
  if (!(jointAccepted <= intentCreated && intentCreated <= restoreVerified && restoreVerified <= dataVerified
    && intentCreated <= tablespaceVerified && intentCreated <= credentialBound
    && Math.max(tablespaceVerified, credentialBound) <= clusterVerified
    && Math.max(dataVerified, clusterVerified) <= finalRecorded && finalRecorded <= verified)) reject("READINESS_V4_TIME_CHAIN_INVALID");
  if (policyV2) {
    const controlCreated = Date.parse(control.created_at), operatorIntentCreated = Date.parse(runtimePrivilege.intent.created_at), operatorCompleted = Date.parse(runtimePrivilege.receipt.completed_at);
    if (!(intentCreated <= controlCreated && controlCreated <= operatorIntentCreated && operatorIntentCreated <= operatorCompleted
      && Math.max(clusterVerified, credentialBound) <= operatorCompleted && operatorCompleted <= finalRecorded)) {
      reject("READINESS_V4_RUNTIME_PRIVILEGE_TIME_INVALID");
    }
    if (finalRecorded - intentCreated > control.rto_minutes * 60_000) reject("READINESS_V4_RTO_EXCEEDED");
  }

  const expectedAttestation = policyV2 ? BACKUP_RECOVERY_READINESS_V4_POLICY_V2_ATTESTATION : BACKUP_RECOVERY_READINESS_V4_ATTESTATION;
  if (value.attestation !== expectedAttestation) reject("READINESS_V4_ATTESTATION_INVALID");
  text(value.readiness_sha256, SHA256, "READINESS_V4_INTEGRITY_INVALID");
  if (clusterSha256(readinessBody(value)) !== value.readiness_sha256) reject("READINESS_V4_INTEGRITY_INVALID");
  return value;
}

export function createBackupRecoveryReadinessV4(options) {
  const policy = validateClusterRecoveryPolicyForReadiness(options.policy);
  const basePolicy = baseClusterRecoveryPolicy(policy);
  requireActualPolicyActivation(policy, options.dataReadiness);
  const data = validateBackupRecoveryReadiness(options.dataReadiness);
  const joint = verifyJointTransferV2({
    joint: options.jointTransfer,
    dataEvidence: options.dataEvidence,
    clusterEvidence: options.clusterEvidence,
    sourceSigningPublicKey: options.sourceSigningPublicKey,
    receiverReceiptPublicKey: options.receiverReceiptPublicKey,
  });
  const intent = validateRecoveryIntent(options.recoveryIntent);
  const { states } = validateRecoveryStateChain(options.recoveryStates, intent);
  const cluster = validateClusterSecurityReceipt(options.clusterSecurityReceipt, basePolicy);
  const credential = validateCredentialBindingReceipt(options.credentialBindingReceipt);
  const tablespace = validateTablespaceReceipt(options.tablespaceReceipt);
  const policyV2 = isClusterRecoveryPolicyV2(policy);
  const control = policyV2 ? validateRecoveryControlEvidence(options.recoveryControl, { policy, baseIntent: intent }) : null;
  const runtimePrivilege = policyV2
    ? validateRuntimePrivilegeEvidence(options.runtimePrivilege, { policy, control, cluster })
    : null;
  const verifiedDate = options.verifiedAt instanceof Date ? options.verifiedAt : new Date(options.verifiedAt || Date.now());
  if (Number.isNaN(verifiedDate.getTime())) reject("READINESS_V4_TIME_INVALID");
  const verifiedAt = verifiedDate.toISOString();
  const actual = data.result === BACKUP_RECOVERY_READY_RESULT;
  if (actual && process.getuid?.() !== 0) reject("READINESS_V4_ACTUAL_ROOT_REQUIRED");
  const body = {
    schema_version: 4,
    contract: BACKUP_RECOVERY_READINESS_V4_CONTRACT,
    result: actual ? BACKUP_RECOVERY_READY_RESULT : BACKUP_RECOVERY_SYNTHETIC_RESULT,
    evidence_scope: actual ? "ACTUAL_OFFHOST" : "SYNTHETIC_ISOLATED",
    backup_id: data.backup_id,
    restore_run_id: intent.restore_run_id,
    created_at: data.created_at,
    verified_at: verifiedAt,
    expires_at: data.expires_at,
    data_readiness: { readiness_v3_sha256: data.readiness_sha256, receipt: data },
    joint_transfer: { receipt_sha256: transferSha256(joint), receipt: joint },
    recovery_execution: {
      intent_sha256: intent.intent_sha256,
      state_chain_sha256: stateChainSha256(states),
      state_count: states.length,
      intent,
      states,
    },
    cluster_security: {
      receipt_sha256: cluster.receipt_sha256,
      snapshot_sha256: cluster.snapshot_sha256,
      policy_id: cluster.policy_id,
      policy_sha256: cluster.policy_sha256,
      target_system_identifier_sha256: cluster.target_system_identifier_sha256,
      status: "VERIFIED",
      receipt: cluster,
    },
    credential_binding: {
      receipt_sha256: credential.receipt_sha256,
      role_set_sha256: credential.role_set_sha256,
      role_count: credential.role_count,
      root_enforced: credential.root_enforced,
      status: "VERIFIED",
      receipt: credential,
    },
    tablespace: {
      receipt_sha256: tablespace.receipt_sha256,
      custom_tablespace_count: tablespace.custom_tablespace_count,
      status: "VERIFIED",
      receipt: tablespace,
    },
    status: {
      data_restore: "VERIFIED",
      data_transfer: "VERIFIED",
      cluster_transfer: "VERIFIED",
      cluster_security: "VERIFIED",
      credential_binding: "VERIFIED",
      tablespace: "VERIFIED",
      recovery_execution: "PUBLISHED",
      schedule: "ON_TIME",
      retention: "POLICY_VALID_DRY_RUN",
    },
    attestation: policyV2 ? BACKUP_RECOVERY_READINESS_V4_POLICY_V2_ATTESTATION : BACKUP_RECOVERY_READINESS_V4_ATTESTATION,
  };
  if (policyV2) {
    body.recovery_control = {
      intent_sha256: control.intent_sha256,
      status: "VERIFIED",
      intent: control,
    };
    body.runtime_privilege = {
      intent_sha256: runtimePrivilege.intent.intent_sha256,
      final_state_sha256: runtimePrivilege.finalState.state_sha256,
      receipt_sha256: runtimePrivilege.receipt.receipt_sha256,
      status: "VERIFIED",
      intent: runtimePrivilege.intent,
      final_state: runtimePrivilege.finalState,
      receipt: runtimePrivilege.receipt,
    };
    body.status.runtime_privilege = "VERIFIED";
  }
  const readiness = { ...body, readiness_sha256: clusterSha256(body) };
  validateBackupRecoveryReadinessV4(readiness, policy);
  assertJointEvidence(readiness, {
    dataEvidence: options.dataEvidence,
    clusterEvidence: options.clusterEvidence,
    sourceSigningPublicKey: options.sourceSigningPublicKey,
    receiverReceiptPublicKey: options.receiverReceiptPublicKey,
  });
  return readiness;
}

async function safeText(file, code, maximumBytes = MAX_JSON_BYTES) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.size < 1 || before.size > maximumBytes || (before.mode & 0o022) !== 0) reject(code);
    const source = await handle.readFile("utf8");
    const after = await handle.stat(), pointed = await lstat(file).catch(() => reject(code));
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || pointed.dev !== after.dev || pointed.ino !== after.ino || pointed.nlink !== 1) reject(code);
    return source;
  } finally { await handle.close(); }
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch(() => reject("READINESS_V4_ROOT_UNSAFE"));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function validateReadinessRoot(root, readerGid) {
  if (!Number.isSafeInteger(readerGid) || readerGid < 0) reject("READINESS_V4_READER_GID_INVALID");
  const resolved = path.resolve(root), metadata = await lstat(resolved).catch(() => reject("READINESS_V4_ROOT_UNSAFE"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() || metadata.gid !== readerGid || (metadata.mode & 0o7777) !== 0o2750) reject("READINESS_V4_ROOT_UNSAFE");
  const marker = path.join(resolved, BACKUP_RECOVERY_READINESS_ROOT_MARKER), markerMetadata = await lstat(marker).catch(() => reject("READINESS_V4_ROOT_UNSAFE"));
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink() || markerMetadata.nlink !== 1 || markerMetadata.uid !== metadata.uid
    || markerMetadata.gid !== readerGid || ![0o400, 0o440].includes(markerMetadata.mode & 0o7777)
    || await safeText(marker, "READINESS_V4_ROOT_UNSAFE", 256) !== BACKUP_RECOVERY_READINESS_ROOT_MARKER_VALUE) reject("READINESS_V4_ROOT_UNSAFE");
  return resolved;
}

async function acquireReadinessLock(root) {
  const lockFile = path.join(root, ".recovery-readiness-v3.lock");
  try {
    const handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile("chenyida-erp-recovery-readiness-lock/v3-v4\n", "utf8");
      await handle.chmod(0o600);
      await handle.sync();
    } finally { await handle.close(); }
    await syncDirectory(root);
  } catch (error) { if (error?.code !== "EEXIST") reject("READINESS_V4_LOCK_UNSAFE"); }
  const before = await lstat(lockFile).catch(() => reject("READINESS_V4_LOCK_UNSAFE"));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o7777) !== 0o600 || before.size < 1 || before.size > 256) reject("READINESS_V4_LOCK_UNSAFE");
  const child = spawn("flock", ["-n", lockFile, "sh", "-c", "printf 'LOCKED\\n'; IFS= read -r release"], {
    env: { PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const acquired = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    child.once("error", () => finish(false));
    child.once("close", () => finish(false));
    child.stdout.once("data", (chunk) => finish(chunk.toString("utf8") === "LOCKED\n"));
  });
  if (!acquired) { child.kill("SIGKILL"); reject("READINESS_V4_LOCK_BUSY"); }
  return async () => {
    child.stdin.end("release\n");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("close", resolve));
    const after = await lstat(lockFile).catch(() => reject("READINESS_V4_LOCK_UNSAFE"));
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1 || after.uid !== before.uid || (after.mode & 0o7777) !== 0o600) reject("READINESS_V4_LOCK_CHANGED");
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
    if (error?.code !== "EEXIST") reject("READINESS_V4_PUBLICATION_FAILED");
    const metadata = await lstat(file).catch(() => reject(conflictCode));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.() || metadata.gid !== readerGid || (metadata.mode & 0o7777) !== 0o640
      || await safeText(file, conflictCode) !== source) reject(conflictCode);
  }
}

async function readPublishedReadiness(file, readerGid, policy) {
  const metadata = await lstat(file).catch(() => reject("READINESS_V4_ALIAS_UNSAFE"));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.() || metadata.gid !== readerGid || (metadata.mode & 0o7777) !== 0o640) reject("READINESS_V4_ALIAS_UNSAFE");
  const source = await safeText(file, "READINESS_V4_ALIAS_UNSAFE");
  let parsed;
  try { parsed = parseStrictJson(source); } catch { reject("READINESS_V4_ALIAS_INVALID"); }
  let value, version;
  try {
    if (parsed?.schema_version === 4) { value = validateBackupRecoveryReadinessV4(parsed, policy); version = 4; }
    else { value = validateBackupRecoveryReadiness(parsed); version = 3; }
  } catch { reject("READINESS_V4_ALIAS_INVALID"); }
  if (source !== canonicalTransferJson(value)) reject("READINESS_V4_ALIAS_INVALID");
  return { value, version };
}

export async function publishBackupRecoveryReadinessV4({ readiness, policy, verification, receiptRoot, receiptReaderGid, confirm }) {
  const validatedPolicy = validateClusterRecoveryPolicyForReadiness(policy);
  rejectLegacyPolicyActual(validatedPolicy, readiness);
  const validated = validateBackupRecoveryReadinessV4(readiness, validatedPolicy);
  assertJointEvidence(validated, verification);
  if (validated.result === BACKUP_RECOVERY_READY_RESULT && process.getuid?.() !== 0) reject("READINESS_V4_ACTUAL_ROOT_REQUIRED");
  const requiredConfirmation = validated.result === BACKUP_RECOVERY_READY_RESULT
    ? "PUBLISH_ACTUAL_CLUSTER_COMPLETE_RECOVERY_READINESS_V4"
    : "PUBLISH_SYNTHETIC_CLUSTER_COMPLETE_RECOVERY_EVIDENCE_V4";
  if (confirm !== requiredConfirmation) reject("READINESS_V4_PUBLICATION_CONFIRMATION_REQUIRED");
  const root = await validateReadinessRoot(receiptRoot, receiptReaderGid), release = await acquireReadinessLock(root);
  const source = canonicalTransferJson(validated);
  const immutableFile = path.join(root, `${validated.backup_id}.${validated.restore_run_id}.recovery-readiness-v4.json`);
  const aliasFile = path.join(root, BACKUP_RECOVERY_READINESS_FILE);
  const temporary = path.join(root, `.recovery-readiness-v4.${process.pid}.${Date.now()}.tmp`);
  try {
    const existingMetadata = await lstat(aliasFile).catch((error) => error?.code === "ENOENT" ? null : reject("READINESS_V4_ALIAS_UNSAFE"));
    let idempotent = false;
    if (existingMetadata) {
      const existing = await readPublishedReadiness(aliasFile, receiptReaderGid, validatedPolicy);
      idempotent = existing.version === 4 && existing.value.readiness_sha256 === validated.readiness_sha256;
      if (!idempotent) {
        if (existing.value.result === BACKUP_RECOVERY_READY_RESULT && validated.result !== BACKUP_RECOVERY_READY_RESULT) reject("READINESS_V4_ALIAS_DOWNGRADE_FORBIDDEN");
        if (Date.parse(existing.value.verified_at) >= Date.parse(validated.verified_at)) reject("READINESS_V4_ALIAS_REGRESSION");
      }
    }
    await writeReadinessFile(immutableFile, source, receiptReaderGid, "READINESS_V4_HISTORY_CONFLICT");
    if (idempotent) return { immutableFile, aliasFile };
    await writeReadinessFile(temporary, source, receiptReaderGid, "READINESS_V4_TEMP_CONFLICT");
    await rename(temporary, aliasFile);
    await syncDirectory(root);
    const published = await readPublishedReadiness(aliasFile, receiptReaderGid, validatedPolicy);
    if (published.version !== 4 || published.value.readiness_sha256 !== validated.readiness_sha256) reject("READINESS_V4_PUBLICATION_FAILED");
    return { immutableFile, aliasFile };
  } finally {
    await unlink(temporary).catch(() => {});
    await release();
  }
}
