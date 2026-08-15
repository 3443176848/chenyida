import { createHash } from "node:crypto";

import { canonicalClusterJson } from "./postgresql-cluster-recovery-contract.mjs";

export const UAT_ROLLBACK_FIXED_EXECUTOR_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-fixed-executor/v1";
export const UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-fixed-executor-catalog/v1";
export const UAT_ROLLBACK_TRUSTED_FD_MANIFEST_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-trusted-fd-manifest/v2";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-activation-intent/v2";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_RECEIPT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-activation-receipt/v2";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_CURRENT_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-activation-current/v2";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_ALIAS_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-activation/v2";

export const UAT_ROLLBACK_RUNTIME_STATE_ROOT =
  "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter";
export const UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE =
  `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/activation-v2.json`;
export const UAT_ROLLBACK_RUNTIME_CURRENT_FILE =
  `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/current-v2.json`;
export const UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE =
  "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1";
export const UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE =
  "chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py";

export const UAT_ROLLBACK_EXECUTION_STAGES = Object.freeze([
  "PRECONDITION_RECHECK",
  "WRITER_CONTAINMENT",
  "POSTGRESQL_RESTORE",
  "UPLOADS_RESTORE",
  "ATTACHMENTS_RESTORE",
  "BACKUP_STATUS_RESTORE",
  "RUNTIME_CONFIGURATION_RESTORE",
  "WEB_WORKER_PREDECESSOR_ACTIVATION",
  "PROTECTED_RESOURCE_RECHECK",
]);

export const UAT_ROLLBACK_POSTVERIFY_CHECKS = Object.freeze([
  "POSTGRESQL_CONTENT",
  "UPLOADS_CONTENT",
  "ATTACHMENTS_CONTENT",
  "BACKUP_STATUS_CONTENT",
  "MIGRATION_HEAD",
  "CADDY_IDENTITY",
  "POSTGRES_IDENTITY",
  "WEB_IDENTITY",
  "WORKER_IDENTITY",
  "RUNTIME_CONFIGURATION",
  "STRICT_RELEASE_IDENTITY",
  "HEALTH",
  "PROTECTED_RESOURCES",
]);

const STAGE_SOURCES = Object.freeze({
  PRECONDITION_RECHECK: [
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_policy", "snapshot_policy_activation", "predecessor_postdeploy_receipt",
    "predecessor_release_manifest", "candidate_deployment_result", "candidate_postdeploy_identity",
    "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
  ],
  WRITER_CONTAINMENT: ["candidate_deployment_result", "candidate_postdeploy_identity"],
  POSTGRESQL_RESTORE: [
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_postgresql", "snapshot_policy", "snapshot_policy_activation",
  ],
  UPLOADS_RESTORE: ["snapshot_manifest", "snapshot_uploads"],
  ATTACHMENTS_RESTORE: ["snapshot_manifest", "snapshot_attachments"],
  BACKUP_STATUS_RESTORE: ["snapshot_manifest", "snapshot_backup_status"],
  RUNTIME_CONFIGURATION_RESTORE: [
    "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
  ],
  WEB_WORKER_PREDECESSOR_ACTIVATION: [
    "predecessor_postdeploy_receipt", "predecessor_release_manifest", "compose_file",
    "compose_release_file", "deployment_environment", "runtime_policy",
  ],
  PROTECTED_RESOURCE_RECHECK: ["candidate_deployment_result", "candidate_postdeploy_identity"],
});

const CHECK_SOURCES = Object.freeze({
  POSTGRESQL_CONTENT: [
    "snapshot_postgresql", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
  ],
  UPLOADS_CONTENT: ["snapshot_uploads", "snapshot_manifest", "snapshot_reconciliation"],
  ATTACHMENTS_CONTENT: ["snapshot_attachments", "snapshot_manifest", "snapshot_reconciliation"],
  BACKUP_STATUS_CONTENT: ["snapshot_backup_status", "snapshot_manifest", "snapshot_reconciliation"],
  MIGRATION_HEAD: ["snapshot_migrations", "predecessor_release_manifest"],
  CADDY_IDENTITY: ["candidate_deployment_result"],
  POSTGRES_IDENTITY: ["candidate_deployment_result"],
  WEB_IDENTITY: ["predecessor_postdeploy_receipt", "predecessor_release_manifest"],
  WORKER_IDENTITY: ["predecessor_postdeploy_receipt", "predecessor_release_manifest"],
  RUNTIME_CONFIGURATION: ["deployment_environment", "runtime_policy"],
  STRICT_RELEASE_IDENTITY: ["predecessor_postdeploy_receipt", "predecessor_release_manifest"],
  HEALTH: ["predecessor_postdeploy_receipt"],
  PROTECTED_RESOURCES: ["candidate_deployment_result", "candidate_postdeploy_identity"],
});

const MISSING_CAPABILITIES = Object.freeze({
  WRITER_CONTAINMENT: "UAT_ROLLBACK_WRITER_AND_DATABASE_FENCE_HANDLER_MISSING",
  POSTGRESQL_RESTORE: "UAT_POSTGRESQL_STAGING_RESTORE_ATOMIC_SWITCH_HANDLER_MISSING",
  UPLOADS_RESTORE: "UAT_UPLOADS_NAMED_VOLUME_RESTORE_HANDLER_MISSING",
  ATTACHMENTS_RESTORE: "UAT_ATTACHMENTS_NAMED_VOLUME_RESTORE_HANDLER_MISSING",
  BACKUP_STATUS_RESTORE: "UAT_BACKUP_STATUS_NAMED_VOLUME_RESTORE_HANDLER_MISSING",
  WEB_WORKER_PREDECESSOR_ACTIVATION: "UAT_PREDECESSOR_WEB_WORKER_ACTIVATION_HANDLER_MISSING",
  POSTGRESQL_CONTENT: "UAT_POSTGRESQL_CONTENT_PROBE_HANDLER_MISSING",
  UPLOADS_CONTENT: "UAT_UPLOADS_CONTENT_PROBE_HANDLER_MISSING",
  ATTACHMENTS_CONTENT: "UAT_ATTACHMENTS_CONTENT_PROBE_HANDLER_MISSING",
  BACKUP_STATUS_CONTENT: "UAT_BACKUP_STATUS_CONTENT_PROBE_HANDLER_MISSING",
  MIGRATION_HEAD: "UAT_MIGRATION_HEAD_READONLY_PROBE_HANDLER_MISSING",
  CADDY_IDENTITY: "UAT_CADDY_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
  POSTGRES_IDENTITY: "UAT_POSTGRES_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
  WEB_IDENTITY: "UAT_WEB_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
  WORKER_IDENTITY: "UAT_WORKER_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
  RUNTIME_CONFIGURATION: "UAT_RUNTIME_CONFIGURATION_READONLY_PROBE_HANDLER_MISSING",
  STRICT_RELEASE_IDENTITY: "UAT_STRICT_RELEASE_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
  HEALTH: "UAT_HEALTH_READONLY_PROBE_HANDLER_MISSING",
});

const INTERNAL_ONLY = new Set([
  "PRECONDITION_RECHECK", "RUNTIME_CONFIGURATION_RESTORE",
  "PROTECTED_RESOURCE_RECHECK", "PROTECTED_RESOURCES",
]);

function handler(label, kind, sources) {
  const unavailable = MISSING_CAPABILITIES[label] ?? null;
  const tool = INTERNAL_ONLY.has(label) ? "EXECUTOR_INTERNAL" : "DOCKER_FD";
  const actions = kind === "STAGE" ? ["PREPARE", "EXECUTE", "PROBE"] : ["PREPARE", "PROBE"];
  return Object.freeze({
    label,
    kind,
    handler_id: `chenyida-erp.rollback.${label.toLowerCase().replaceAll("_", "-")}.v1`,
    actions: Object.freeze(actions),
    tool,
    argv_template: Object.freeze(tool === "DOCKER_FD"
      ? ["/proc/self/fd/{docker_fd}", "FIXED_HANDLER", label]
      : ["EXECUTOR_INTERNAL", label]),
    cwd: "/",
    environment: "EMPTY_FIXED_LOCALE_UTC",
    required_source_roles: Object.freeze([...sources, "runtime_adapter_activation"]),
    input_contract: "chenyida-erp-uat-promotion-rollback-runtime-request/v1",
    output_contract: kind === "STAGE"
      ? "chenyida-erp-uat-promotion-rollback-stage-evidence/v1"
      : "chenyida-erp-uat-promotion-rollback-check-evidence/v1",
    timeout_seconds: kind === "STAGE" ? 1800 : 300,
    privilege: "ROOT_UNDER_RELEASE_SUPERVISOR_GLOBAL_LOCK",
    idempotency_key_fields: Object.freeze([
      "operation_id", "label", "record_intent_sha256", "runtime_plan_sha256",
      "previous_result_sha256",
    ]),
    unknown_policy: "PROBE_THEN_CONTAIN_NEVER_BLINDLY_REEXECUTE",
    production_status: unavailable === null ? "AVAILABLE_READONLY_OR_METADATA_ONLY" : "UNAVAILABLE",
    unavailable_code: unavailable,
  });
}

const handlers = [
  ...UAT_ROLLBACK_EXECUTION_STAGES.map((label) => handler(label, "STAGE", STAGE_SOURCES[label])),
  ...UAT_ROLLBACK_POSTVERIFY_CHECKS.map((label) => handler(label, "CHECK", CHECK_SOURCES[label])),
];

const catalogBody = {
  schema_version: 1,
  contract: UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_CONTRACT,
  execution_class: "UAT_FIXED_CLOSED_SET_FAIL_CLOSED",
  executor_contract: UAT_ROLLBACK_FIXED_EXECUTOR_CONTRACT,
  stages: UAT_ROLLBACK_EXECUTION_STAGES,
  checks: UAT_ROLLBACK_POSTVERIFY_CHECKS,
  handlers,
  forbidden_tools: Object.freeze([
    "chenyida_erp_site/scripts/restore-selfhost.sh",
    "chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs",
  ]),
  capability_status: "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS",
  unavailable_capabilities: Object.freeze(Object.keys(MISSING_CAPABILITIES).sort()),
};

export const UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG = Object.freeze({
  ...catalogBody,
  catalog_sha256: createHash("sha256").update(canonicalClusterJson(catalogBody)).digest("hex"),
});
export const UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256 =
  UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.catalog_sha256;

export class UatRollbackFixedExecutorContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatRollbackFixedExecutorContractError";
    this.code = code;
  }
}

function reject(code) { throw new UatRollbackFixedExecutorContractError(code); }
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }
function exactKeys(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [...fields].sort())) reject(code);
}

export function validateUatRollbackFixedExecutorCatalog(value) {
  const code = "UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_INVALID";
  exactKeys(value, [...Object.keys(catalogBody), "catalog_sha256"], code);
  if (!same(value, UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG)) reject(code);
  return value;
}

export function fixedUatRollbackHandler(operation, label, action) {
  if (!new Set(["ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"]).has(operation)) {
    reject("UAT_ROLLBACK_FIXED_EXECUTOR_OPERATION_INVALID");
  }
  const expectedKind = operation === "ROLLBACK_EXECUTION" ? "STAGE" : "CHECK";
  const entry = handlers.find((candidate) => candidate.kind === expectedKind && candidate.label === label);
  if (!entry || !entry.actions.includes(action)) reject("UAT_ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID");
  return entry;
}

export function uatRollbackFixedExecutorIdempotencyKey(request) {
  const entry = fixedUatRollbackHandler(request.operation, request.label, request.action);
  const body = Object.fromEntries(entry.idempotency_key_fields.map((field) => [field, request[field]]));
  return createHash("sha256").update(canonicalClusterJson({
    contract: "chenyida-erp-uat-promotion-rollback-idempotency-key/v1",
    ...body,
  })).digest("hex");
}

export function uatRollbackActivationPaths(generation, receiptSha256 = null, activationSha256 = null) {
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 1_000_000) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_GENERATION_INVALID");
  }
  const ordinal = String(generation).padStart(16, "0");
  return Object.freeze({
    intent_prefix: `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/intents/${ordinal}.`,
    executor: `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/executors/`,
    plan: `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/plans/`,
    history: activationSha256 === null ? null
      : `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/history/${ordinal}.${activationSha256}.json`,
    receipt: receiptSha256 === null ? null
      : `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/receipts/${ordinal}.${receiptSha256}.json`,
    current: UAT_ROLLBACK_RUNTIME_CURRENT_FILE,
    activation: UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE,
  });
}

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export const UAT_ROLLBACK_ZERO_SHA256 = "0".repeat(64);

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
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}
function hashed(body, field) {
  return Object.freeze({
    ...body,
    [field]: createHash("sha256").update(canonicalClusterJson(body)).digest("hex"),
  });
}
function validatePlanReference(plan, executorSha256, code) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)
    || plan.schema_version !== 1
    || plan.contract !== "chenyida-erp-uat-promotion-rollback-runtime-plan/v1"
    || !SHA256.test(plan.runtime_plan_sha256 ?? "")
    || !SHA256.test(plan.toolchain?.executor?.sha256 ?? "")
    || plan.toolchain.executor.sha256 !== executorSha256
    || createHash("sha256").update(canonicalClusterJson(without(plan, "runtime_plan_sha256"))).digest("hex")
      !== plan.runtime_plan_sha256) reject(code);
  return plan;
}

function validateActivationCommon(value, code) {
  identifier(value.activation_id, code);
  integer(value.generation, 1, 1_000_000, code);
  if (!new Set(["INSTALL", "UPGRADE", "ROLLBACK"]).has(value.operation)) reject(code);
  for (const field of [
    "supervisor_bundle_sha256", "authorization_sha256", "requester_identity_sha256",
    "approver_identity_sha256", "executor_catalog_sha256", "executor_source_sha256",
    "installed_executor_sha256", "runtime_plan_sha256",
  ]) digest(value[field], code);
  if (value.requester_identity_sha256 === value.approver_identity_sha256
    || value.executor_catalog_sha256 !== UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256
    || value.executor_source_sha256 !== value.installed_executor_sha256
    || value.capability_status !== UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.capability_status
    || !same(value.unavailable_capabilities, UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.unavailable_capabilities)) {
    reject(code);
  }
  const approved = Date.parse(instant(value.approved_at, code));
  const expires = Date.parse(instant(value.expires_at, code));
  if (expires <= approved || expires - approved > 2 * 60 * 60 * 1000) reject(code);
  digest(value.previous_activation_receipt_sha256, code, true);
  digest(value.rollback_target_activation_receipt_sha256, code, true);
  if (value.generation === 1 && (value.operation !== "INSTALL"
      || value.previous_activation_receipt_sha256 !== UAT_ROLLBACK_ZERO_SHA256)
    || value.generation > 1 && (value.operation === "INSTALL"
      || value.previous_activation_receipt_sha256 === UAT_ROLLBACK_ZERO_SHA256)
    || value.operation === "ROLLBACK" && value.generation < 3
    || value.operation === "ROLLBACK"
      && value.rollback_target_activation_receipt_sha256 === UAT_ROLLBACK_ZERO_SHA256
    || value.operation !== "ROLLBACK"
      && value.rollback_target_activation_receipt_sha256 !== UAT_ROLLBACK_ZERO_SHA256) reject(code);
  validatePlanReference(value.plan, value.installed_executor_sha256, code);
  if (value.runtime_plan_sha256 !== value.plan.runtime_plan_sha256) reject(code);
}

export function createUatRollbackRuntimeActivationIntent(input) {
  const body = {
    schema_version: 2,
    contract: UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_CONTRACT,
    status: "PREPARED",
    activation_id: input.activation_id,
    generation: input.generation,
    operation: input.operation,
    approved_at: input.approved_at,
    expires_at: input.expires_at,
    supervisor_bundle_sha256: input.supervisor_bundle_sha256,
    authorization_sha256: input.authorization_sha256,
    requester_identity_sha256: input.requester_identity_sha256,
    approver_identity_sha256: input.approver_identity_sha256,
    previous_activation_receipt_sha256: input.previous_activation_receipt_sha256,
    rollback_target_activation_receipt_sha256:
      input.rollback_target_activation_receipt_sha256 ?? UAT_ROLLBACK_ZERO_SHA256,
    executor_catalog_sha256: UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256,
    capability_status: UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.capability_status,
    unavailable_capabilities: UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.unavailable_capabilities,
    executor_source_sha256: input.executor_source_sha256,
    installed_executor_sha256: input.executor_source_sha256,
    runtime_plan_sha256: input.plan.runtime_plan_sha256,
    plan: input.plan,
  };
  return validateUatRollbackRuntimeActivationIntent(hashed(body, "intent_sha256"));
}

export function validateUatRollbackRuntimeActivationIntent(value) {
  const code = "UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "activation_id", "generation", "operation",
    "approved_at", "expires_at", "supervisor_bundle_sha256", "authorization_sha256",
    "requester_identity_sha256", "approver_identity_sha256",
    "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256",
    "executor_catalog_sha256", "capability_status", "unavailable_capabilities",
    "executor_source_sha256", "installed_executor_sha256", "runtime_plan_sha256", "plan",
    "intent_sha256",
  ], code);
  if (value.schema_version !== 2 || value.contract !== UAT_ROLLBACK_RUNTIME_ACTIVATION_INTENT_CONTRACT
    || value.status !== "PREPARED") reject(code);
  validateActivationCommon(value, code);
  if (createHash("sha256").update(canonicalClusterJson(without(value, "intent_sha256"))).digest("hex")
    !== value.intent_sha256) reject(code);
  return Object.freeze(value);
}

export function createUatRollbackRuntimeActivationObjects(intentInput, committedAt) {
  const intent = validateUatRollbackRuntimeActivationIntent(intentInput);
  instant(committedAt, "UAT_ROLLBACK_RUNTIME_ACTIVATION_TIME_INVALID");
  if (Date.parse(committedAt) < Date.parse(intent.approved_at)
    || Date.parse(committedAt) >= Date.parse(intent.expires_at)) {
    reject("UAT_ROLLBACK_RUNTIME_ACTIVATION_TIME_INVALID");
  }
  const activationStatus = intent.capability_status === "SUPPORTED" ? "ACTIVE"
    : "BLOCKED_CAPABILITY_UNAVAILABLE";
  const historyBody = {
    schema_version: 2,
    contract: "chenyida-erp-uat-promotion-rollback-runtime-activation-history/v2",
    status: "COMMITTED",
    activation_status: activationStatus,
    activation_id: intent.activation_id,
    generation: intent.generation,
    operation: intent.operation,
    committed_at: committedAt,
    intent_sha256: intent.intent_sha256,
    previous_activation_receipt_sha256: intent.previous_activation_receipt_sha256,
    rollback_target_activation_receipt_sha256: intent.rollback_target_activation_receipt_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    authorization_sha256: intent.authorization_sha256,
    executor_catalog_sha256: intent.executor_catalog_sha256,
    capability_status: intent.capability_status,
    unavailable_capabilities: intent.unavailable_capabilities,
    installed_executor_sha256: intent.installed_executor_sha256,
    runtime_plan_sha256: intent.runtime_plan_sha256,
    approved_at: intent.approved_at,
    expires_at: intent.expires_at,
    requester_identity_sha256: intent.requester_identity_sha256,
    approver_identity_sha256: intent.approver_identity_sha256,
    plan: intent.plan,
  };
  const history = hashed(historyBody, "history_sha256");
  const receiptBody = {
    schema_version: 2,
    contract: UAT_ROLLBACK_RUNTIME_ACTIVATION_RECEIPT_CONTRACT,
    status: "COMMITTED",
    activation_status: activationStatus,
    activation_id: intent.activation_id,
    generation: intent.generation,
    operation: intent.operation,
    committed_at: committedAt,
    intent_sha256: intent.intent_sha256,
    history_sha256: history.history_sha256,
    previous_activation_receipt_sha256: intent.previous_activation_receipt_sha256,
    rollback_target_activation_receipt_sha256: intent.rollback_target_activation_receipt_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    authorization_sha256: intent.authorization_sha256,
    executor_catalog_sha256: intent.executor_catalog_sha256,
    installed_executor_sha256: intent.installed_executor_sha256,
    runtime_plan_sha256: intent.runtime_plan_sha256,
    expires_at: intent.expires_at,
  };
  const receipt = hashed(receiptBody, "receipt_sha256");
  const currentBody = {
    schema_version: 2,
    contract: UAT_ROLLBACK_RUNTIME_ACTIVATION_CURRENT_CONTRACT,
    status: activationStatus,
    activation_id: intent.activation_id,
    generation: intent.generation,
    history_sha256: history.history_sha256,
    receipt_sha256: receipt.receipt_sha256,
    executor_catalog_sha256: intent.executor_catalog_sha256,
    installed_executor_sha256: intent.installed_executor_sha256,
    runtime_plan_sha256: intent.runtime_plan_sha256,
    expires_at: intent.expires_at,
  };
  const current = hashed(currentBody, "current_sha256");
  const paths = uatRollbackActivationPaths(
    intent.generation, receipt.receipt_sha256, history.history_sha256,
  );
  const aliasBody = {
    schema_version: 2,
    contract: UAT_ROLLBACK_RUNTIME_ACTIVATION_ALIAS_CONTRACT,
    status: activationStatus,
    activation_id: intent.activation_id,
    generation: intent.generation,
    operation: intent.operation,
    approved_at: intent.approved_at,
    expires_at: intent.expires_at,
    requester_identity_sha256: intent.requester_identity_sha256,
    approver_identity_sha256: intent.approver_identity_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    authorization_sha256: intent.authorization_sha256,
    previous_activation_receipt_sha256: intent.previous_activation_receipt_sha256,
    rollback_target_activation_receipt_sha256: intent.rollback_target_activation_receipt_sha256,
    executor_catalog_sha256: intent.executor_catalog_sha256,
    capability_status: intent.capability_status,
    unavailable_capabilities: intent.unavailable_capabilities,
    executor_source_sha256: intent.executor_source_sha256,
    installed_executor_sha256: intent.installed_executor_sha256,
    runtime_plan_sha256: intent.runtime_plan_sha256,
    intent_sha256: intent.intent_sha256,
    history_sha256: history.history_sha256,
    history_file: paths.history,
    receipt_sha256: receipt.receipt_sha256,
    receipt_file: paths.receipt,
    current_sha256: current.current_sha256,
    current_file: paths.current,
    executor_file: UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE,
    plan: intent.plan,
  };
  const alias = hashed(aliasBody, "activation_sha256");
  return Object.freeze({ intent, history, receipt, current, alias });
}

export function validateUatRollbackRuntimeActivationAlias(value, { requireActive = false } = {}) {
  const code = "UAT_ROLLBACK_RUNTIME_ACTIVATION_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "activation_id", "generation", "operation",
    "approved_at", "expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "supervisor_bundle_sha256", "authorization_sha256", "previous_activation_receipt_sha256",
    "rollback_target_activation_receipt_sha256", "executor_catalog_sha256", "capability_status",
    "unavailable_capabilities", "executor_source_sha256", "installed_executor_sha256",
    "runtime_plan_sha256", "intent_sha256", "history_sha256", "history_file",
    "receipt_sha256", "receipt_file", "current_sha256", "current_file", "executor_file", "plan",
    "activation_sha256",
  ], code);
  if (value.schema_version !== 2 || value.contract !== UAT_ROLLBACK_RUNTIME_ACTIVATION_ALIAS_CONTRACT
    || !new Set(["ACTIVE", "BLOCKED_CAPABILITY_UNAVAILABLE"]).has(value.status)
    || requireActive && value.status !== "ACTIVE") reject(code);
  validateActivationCommon(value, code);
  for (const field of ["intent_sha256", "history_sha256", "receipt_sha256", "current_sha256"]) {
    digest(value[field], code);
  }
  const paths = uatRollbackActivationPaths(value.generation, value.receipt_sha256, value.history_sha256);
  if (value.history_file !== paths.history || value.receipt_file !== paths.receipt
    || value.current_file !== paths.current || value.executor_file !== UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE
    || value.status === "ACTIVE" && value.capability_status !== "SUPPORTED"
    || value.status !== "ACTIVE" && value.capability_status === "SUPPORTED"
    || createHash("sha256").update(canonicalClusterJson(without(value, "activation_sha256"))).digest("hex")
      !== value.activation_sha256) reject(code);
  return Object.freeze(value);
}
