import {
  canonicalClusterJson,
  clusterSha256,
} from "./postgresql-cluster-recovery-contract.mjs";
import {
  clusterRecoveryPolicyV2Sha256,
  validateClusterRecoveryPolicyV2,
  ZERO_SHA256,
} from "./postgresql-cluster-recovery-policy-v2-contract.mjs";

export const CLUSTER_POLICY_ACTIVATION_RECEIPT_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy-activation-receipt/v1";
export const CLUSTER_POLICY_ACTIVATION_EVIDENCE_CONTRACT = "chenyida-erp-postgresql-cluster-recovery-policy-activation-evidence/v1";
export const CLUSTER_POLICY_ACTIVATION_STATE_ROOT = "/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2";
export const CLUSTER_POLICY_ACTIVATION_CURRENT_FILE = `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/current.json`;
export const CLUSTER_POLICY_TARGET_FILE = "/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json";
export const CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256 = "1a092993b1dda00bd8a2aac0899cb4e1eee83e9b336022bdb72f3e4d23e317aa";
export const CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256 = "c30951ad74a827c06e8256cfc124f61bd5672bca9daa7abda21c0896523378b8";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RECEIPT_FIELDS = Object.freeze([
  "schema_version", "contract", "activation_id", "operation", "status", "committed_at", "environment",
  "generation", "policy_id", "policy_sha256", "policy_file_sha256", "previous_policy_sha256",
  "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256",
  "template_file_sha256", "template_policy_sha256", "supervisor_bundle_sha256", "authorization_sha256",
  "release_identity_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256",
  "rpo_hours", "rto_minutes", "target_disposition", "activated_at", "expires_at",
  "state_root", "policy_target", "history_file", "receipt_sha256",
]);

export class ClusterRecoveryPolicyActivationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ClusterRecoveryPolicyActivationError";
    this.code = code;
  }
}

function reject(code) { throw new ClusterRecoveryPolicyActivationError(code); }
function record(value, code) { if (!value || typeof value !== "object" || Array.isArray(value)) reject(code); return value; }
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function digest(value, code, allowZero = false) {
  if (typeof value !== "string" || !SHA256.test(value) || !allowZero && value === ZERO_SHA256) reject(code);
  return value;
}
function identifier(value, code) { if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code); return value; }
function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return value;
}
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function receiptBody(value) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receipt_sha256")); }
function historyFile(generation, policySha256) {
  return `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/history/${String(generation).padStart(16, "0")}.${policySha256}.json`;
}

function validateReceiptShape(value) {
  exactKeys(value, RECEIPT_FIELDS, "CLUSTER_POLICY_ACTIVATION_RECEIPT_INVALID");
  if (value.schema_version !== 1 || value.contract !== CLUSTER_POLICY_ACTIVATION_RECEIPT_CONTRACT
    || !new Set(["ACTIVATE", "ROLLBACK"]).has(value.operation) || value.status !== "COMMITTED") {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_INVALID");
  }
  identifier(value.activation_id, "CLUSTER_POLICY_ACTIVATION_RECEIPT_ID_INVALID");
  iso(value.committed_at, "CLUSTER_POLICY_ACTIVATION_RECEIPT_TIME_INVALID");
  iso(value.activated_at, "CLUSTER_POLICY_ACTIVATION_RECEIPT_TIME_INVALID");
  iso(value.expires_at, "CLUSTER_POLICY_ACTIVATION_RECEIPT_TIME_INVALID");
  if (value.committed_at !== value.activated_at || Date.parse(value.activated_at) >= Date.parse(value.expires_at)
    || Date.parse(value.expires_at) - Date.parse(value.activated_at) > 24 * 60 * 60 * 1000) {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_TIME_INVALID");
  }
  if (!new Set(["UAT", "PRODUCTION"]).has(value.environment)) reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_ENVIRONMENT_INVALID");
  integer(value.generation, 1, 1_000_000, "CLUSTER_POLICY_ACTIVATION_RECEIPT_GENERATION_INVALID");
  integer(value.rpo_hours, 1, 168, "CLUSTER_POLICY_ACTIVATION_RECEIPT_SLA_INVALID");
  integer(value.rto_minutes, 1, 10_080, "CLUSTER_POLICY_ACTIVATION_RECEIPT_SLA_INVALID");
  identifier(value.policy_id, "CLUSTER_POLICY_ACTIVATION_RECEIPT_POLICY_INVALID");
  for (const key of RECEIPT_FIELDS.filter((field) => field.endsWith("_sha256"))) {
    digest(value[key], "CLUSTER_POLICY_ACTIVATION_RECEIPT_DIGEST_INVALID", new Set([
      "previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256",
    ]).has(key));
  }
  if (value.generation === 1 && (value.previous_policy_sha256 !== ZERO_SHA256 || value.previous_activation_receipt_sha256 !== ZERO_SHA256)
    || value.generation > 1 && (value.previous_policy_sha256 === ZERO_SHA256 || value.previous_activation_receipt_sha256 === ZERO_SHA256)) {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_GENERATION_INVALID");
  }
  if (value.operation === "ACTIVATE" && value.rollback_target_activation_receipt_sha256 !== ZERO_SHA256
    || value.operation === "ROLLBACK" && (value.generation < 3 || value.rollback_target_activation_receipt_sha256 === ZERO_SHA256)) {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_ROLLBACK_INVALID");
  }
  if (value.approval_reference_sha256 === value.responsible_operator_identity_sha256
    || value.approval_reference_sha256 === value.approver_identity_sha256
    || value.responsible_operator_identity_sha256 === value.approver_identity_sha256) {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_ACTORS_INVALID");
  }
  if (value.template_file_sha256 !== CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256
    || value.template_policy_sha256 !== CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256
    || value.state_root !== CLUSTER_POLICY_ACTIVATION_STATE_ROOT || value.policy_target !== CLUSTER_POLICY_TARGET_FILE
    || value.history_file !== historyFile(value.generation, value.policy_sha256)) {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_SOURCE_INVALID");
  }
  if (!new Set(["DESTROY_AFTER_EVIDENCE", "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT"]).has(value.target_disposition)) {
    reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_DISPOSITION_INVALID");
  }
  if (clusterSha256(receiptBody(value)) !== value.receipt_sha256) reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_INTEGRITY_INVALID");
  return value;
}

export function createClusterRecoveryPolicyActivationReceipt({
  policy: policyInput,
  activationId,
  operation,
  previousActivationReceiptSha256,
  releaseIdentitySha256,
  rollbackTargetActivationReceiptSha256 = ZERO_SHA256,
}) {
  const policy = validateClusterRecoveryPolicyV2(policyInput);
  if (policy.activation.status !== "ACTIVATED") reject("CLUSTER_POLICY_ACTIVATION_POLICY_REQUIRED");
  const policySha256 = clusterRecoveryPolicyV2Sha256(policy);
  const body = {
    schema_version: 1,
    contract: CLUSTER_POLICY_ACTIVATION_RECEIPT_CONTRACT,
    activation_id: activationId,
    operation,
    status: "COMMITTED",
    committed_at: policy.activation.activated_at,
    environment: policy.activation.environment,
    generation: policy.activation.generation,
    policy_id: policy.policy_id,
    policy_sha256: policySha256,
    policy_file_sha256: clusterSha256(canonicalClusterJson(policy)),
    previous_policy_sha256: policy.activation.previous_policy_sha256,
    previous_activation_receipt_sha256: previousActivationReceiptSha256,
    rollback_target_activation_receipt_sha256: rollbackTargetActivationReceiptSha256,
    template_file_sha256: CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256,
    template_policy_sha256: CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256,
    supervisor_bundle_sha256: policy.activation.supervisor_bundle_sha256,
    authorization_sha256: policy.activation.authorization_sha256,
    release_identity_sha256: releaseIdentitySha256,
    approval_reference_sha256: policy.activation.approval_reference_sha256,
    responsible_operator_identity_sha256: policy.activation.responsible_operator_identity_sha256,
    approver_identity_sha256: policy.activation.approver_identity_sha256,
    rpo_hours: policy.activation.rpo_hours,
    rto_minutes: policy.activation.rto_minutes,
    target_disposition: policy.activation.target_disposition,
    activated_at: policy.activation.activated_at,
    expires_at: policy.activation.expires_at,
    state_root: CLUSTER_POLICY_ACTIVATION_STATE_ROOT,
    policy_target: CLUSTER_POLICY_TARGET_FILE,
    history_file: historyFile(policy.activation.generation, policySha256),
  };
  return Object.freeze(validateReceiptShape({ ...body, receipt_sha256: clusterSha256(body) }));
}

export function validateClusterRecoveryPolicyActivationReceipt(value, policyInput = null) {
  const receipt = validateReceiptShape(value);
  if (policyInput !== null) {
    const policy = validateClusterRecoveryPolicyV2(policyInput);
    if (policy.activation.status !== "ACTIVATED" || receipt.policy_id !== policy.policy_id
      || receipt.policy_sha256 !== clusterRecoveryPolicyV2Sha256(policy)
      || receipt.policy_file_sha256 !== clusterSha256(canonicalClusterJson(policy))
      || receipt.environment !== policy.activation.environment || receipt.generation !== policy.activation.generation
      || receipt.previous_policy_sha256 !== policy.activation.previous_policy_sha256
      || receipt.supervisor_bundle_sha256 !== policy.activation.supervisor_bundle_sha256
      || receipt.authorization_sha256 !== policy.activation.authorization_sha256
      || receipt.approval_reference_sha256 !== policy.activation.approval_reference_sha256
      || receipt.responsible_operator_identity_sha256 !== policy.activation.responsible_operator_identity_sha256
      || receipt.approver_identity_sha256 !== policy.activation.approver_identity_sha256
      || receipt.rpo_hours !== policy.activation.rpo_hours || receipt.rto_minutes !== policy.activation.rto_minutes
      || receipt.target_disposition !== policy.activation.target_disposition
      || receipt.activated_at !== policy.activation.activated_at || receipt.expires_at !== policy.activation.expires_at) {
      reject("CLUSTER_POLICY_ACTIVATION_RECEIPT_POLICY_MISMATCH");
    }
  }
  return receipt;
}

export function createClusterRecoveryPolicyActivationEvidence(receiptInput, policyInput) {
  const receipt = validateClusterRecoveryPolicyActivationReceipt(receiptInput, policyInput);
  return Object.freeze({
    contract: CLUSTER_POLICY_ACTIVATION_EVIDENCE_CONTRACT,
    receipt_sha256: receipt.receipt_sha256,
    status: "VERIFIED",
    receipt,
  });
}

export function validateClusterRecoveryPolicyActivationEvidence(value, policyInput) {
  exactKeys(value, ["contract", "receipt_sha256", "status", "receipt"], "CLUSTER_POLICY_ACTIVATION_EVIDENCE_INVALID");
  if (value.contract !== CLUSTER_POLICY_ACTIVATION_EVIDENCE_CONTRACT || value.status !== "VERIFIED") reject("CLUSTER_POLICY_ACTIVATION_EVIDENCE_INVALID");
  const receipt = validateClusterRecoveryPolicyActivationReceipt(value.receipt, policyInput);
  if (value.receipt_sha256 !== receipt.receipt_sha256) reject("CLUSTER_POLICY_ACTIVATION_EVIDENCE_INVALID");
  return Object.freeze({ ...value, receipt });
}
