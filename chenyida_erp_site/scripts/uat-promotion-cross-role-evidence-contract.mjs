import {
  CROSS_ROLE_UAT_ARTIFACT_CONTRACT,
  canonicalJson,
  sha256,
} from "./cross-role-uat-evidence-contract.mjs";

export const UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT =
  "chenyida-erp-uat-promotion-cross-role-result/v1";
export const UAT_PROMOTION_CROSS_ROLE_RESULT_ROOT =
  "/var/lib/chenyida-erp/uat-cross-role-results-v1";
export const UAT_PROMOTION_CROSS_ROLE_RESULT_MARKER =
  ".chenyida-erp-uat-cross-role-results-v1";
export const UAT_PROMOTION_CROSS_ROLE_RESULT_MARKER_VALUE =
  "chenyida-erp-uat-cross-role-results/v1\n";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PLACEHOLDER = /(?:test|todo|pending|placeholder|example|synthetic|null|none)/iu;
const EXPECTED_COVERAGE = Object.freeze({
  workflow_count: 4,
  step_count: 32,
  branch_reversal_step_count: 6,
  control_assertion_count: 32,
});
const SANITIZATION = Object.freeze({
  identity_capture: "SHA256_ONLY_NO_PERSON_NAME_OR_USERNAME",
  request_capture: "REQUEST_ID_AND_DIGEST_ONLY_NO_HEADER_OR_BODY_SECRET",
  database_capture: "AGGREGATE_DELTA_DIGEST_ONLY_NO_ROW_CONTENT",
  forbidden_capture: "AUTHORIZATION_COOKIE_SET_COOKIE_CSRF_PASSWORD_SESSION_AND_REAL_PERSONAL_DATA",
});

export class UatPromotionCrossRoleEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionCrossRoleEvidenceError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionCrossRoleEvidenceError(code); }
function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}
function exactKeys(value, expected, code) {
  const actual = Object.keys(object(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function bodyWithout(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}
function digest(value, code) {
  if (typeof value !== "string" || !SHA256.test(value) || value === "0".repeat(64)) reject(code);
  return value;
}
function identifier(value, code, rejectPlaceholder = false) {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || rejectPlaceholder && PLACEHOLDER.test(value)) reject(code);
  return value;
}
function instant(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
  return Date.parse(value);
}
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }

export function validateCrossRoleUatTemplate(value) {
  const code = "UAT_PROMOTION_CROSS_ROLE_TEMPLATE_INVALID";
  object(value, code);
  if (value.schema_version !== 1 || value.contract !== CROSS_ROLE_UAT_ARTIFACT_CONTRACT
    || value.authority !== "REPOSITORY_SYNTHETIC_EVIDENCE_ONLY"
    || value.execution_class !== "NOT_AUTHORIZED"
    || value.readiness?.status !== "BLOCKED"
    || typeof value.artifact_sha256 !== "string" || !SHA256.test(value.artifact_sha256)
    || sha256(canonicalJson(bodyWithout(value, "artifact_sha256"))) !== value.artifact_sha256
    || !same(value.coverage, { ...value.coverage, ...EXPECTED_COVERAGE })
    || !Array.isArray(value.workflows) || value.workflows.length !== EXPECTED_COVERAGE.workflow_count
    || !value.actor_slots || typeof value.actor_slots !== "object" || Array.isArray(value.actor_slots)
    || value.synthetic_fixture?.data_class !== "SYNTHETIC_ONLY"
    || !identifier(value.synthetic_fixture?.fixture_id, code)) reject(code);
  const steps = value.workflows.flatMap((workflow) => workflow.steps ?? []);
  const controls = value.workflows.flatMap((workflow) => workflow.controls ?? []);
  const reversals = steps.filter((step) => step.branch_from_checkpoint !== undefined);
  if (steps.length !== EXPECTED_COVERAGE.step_count
    || controls.length !== EXPECTED_COVERAGE.control_assertion_count
    || reversals.length !== EXPECTED_COVERAGE.branch_reversal_step_count
    || new Set(value.workflows.map((workflow) => workflow.id)).size !== value.workflows.length
    || new Set(steps.map((step) => step.id)).size !== steps.length) reject(code);
  for (const actor of Object.values(value.actor_slots)) {
    if (actor?.person_name !== null || actor?.account_username !== null
      || typeof actor?.role !== "string" || actor.role.length < 2) reject(code);
  }
  for (const workflow of value.workflows) {
    if (workflow.signoff?.executor_signed_at !== null || workflow.signoff?.observer_signed_at !== null
      || workflow.signoff?.business_accepted_at !== null || workflow.signoff?.result !== null) reject(code);
  }
  return value;
}

function validateApproval(value, template) {
  const code = "UAT_PROMOTION_CROSS_ROLE_APPROVAL_INVALID";
  exactKeys(value, [
    "status", "business_role_matrix_approval_id", "uat_account_mapping_approval_id",
    "allowed_write_scope", "execution_window_start", "execution_window_end",
    "stop_authority_identity_sha256", "rollback_owner_identity_sha256",
    "approval_subject_sha256", "approval_evidence_sha256",
  ], code);
  if (value.status !== "APPROVED") reject(code);
  identifier(value.business_role_matrix_approval_id, code, true);
  identifier(value.uat_account_mapping_approval_id, code, true);
  if (value.allowed_write_scope !== `SYNTHETIC_ONLY:${template.synthetic_fixture.fixture_id}`) reject(code);
  const start = instant(value.execution_window_start, code);
  const end = instant(value.execution_window_end, code);
  if (end <= start || end - start > 8 * 60 * 60 * 1000) reject(code);
  for (const field of [
    "stop_authority_identity_sha256", "rollback_owner_identity_sha256",
    "approval_subject_sha256", "approval_evidence_sha256",
  ]) digest(value[field], code);
  if (value.stop_authority_identity_sha256 === value.rollback_owner_identity_sha256) reject(code);
  return Object.freeze({ start, end });
}

function approvalSubjectBody(value, template) {
  const approval = bodyWithout(bodyWithout(value.approval ?? {}, "approval_subject_sha256"), "approval_evidence_sha256");
  return {
    contract: "chenyida-erp-uat-promotion-cross-role-approval-subject/v1",
    promotion_id: value.promotion_id,
    promotion_generation: value.promotion_generation,
    human_execution_authorization_sha256: value.human_execution_authorization_sha256,
    supervisor_bundle_sha256: value.supervisor_bundle_sha256,
    previous_checkpoint_receipt_sha256: value.previous_checkpoint_receipt_sha256,
    postdeploy_identity_evidence_sha256: value.postdeploy_identity_evidence_sha256,
    release_identity_sha256: value.release_identity_sha256,
    cross_role_contract_artifact_sha256: template.artifact_sha256,
    authorization_matrix_artifact_sha256: template.generated_from.authorization_matrix.artifact_sha256,
    authorization_matrix_source_manifest_sha256:
      template.generated_from.authorization_matrix.source_manifest_sha256,
    fixture_id: template.synthetic_fixture.fixture_id,
    approval,
    actors: value.actors,
  };
}

function approvalSubjectSha256(value, template) {
  return sha256(canonicalJson(approvalSubjectBody(value, template)));
}

function validateActors(value, template, approval) {
  const code = "UAT_PROMOTION_CROSS_ROLE_ACTORS_INVALID";
  if (!Array.isArray(value)) reject(code);
  const expectedSlots = Object.keys(template.actor_slots).sort();
  if (value.length !== expectedSlots.length) reject(code);
  const bySlot = new Map();
  for (const [index, actor] of value.entries()) {
    exactKeys(actor, ["slot", "role", "person_identity_sha256", "account_identity_sha256"], code);
    if (actor.slot !== expectedSlots[index] || actor.role !== template.actor_slots[actor.slot]?.role) reject(code);
    digest(actor.person_identity_sha256, code);
    digest(actor.account_identity_sha256, code);
    if (bySlot.has(actor.slot)) reject(code);
    bySlot.set(actor.slot, actor);
  }
  if (new Set(value.map((actor) => actor.account_identity_sha256)).size !== value.length) reject(code);
  for (const rule of template.separation_rules ?? []) {
    const left = bySlot.get(rule.left);
    const right = bySlot.get(rule.right);
    if (!left || !right || left.person_identity_sha256 === right.person_identity_sha256
      || left.account_identity_sha256 === right.account_identity_sha256) reject(code);
  }
  const executorSlots = new Set(template.workflows.flatMap((workflow) => workflow.signoff.executor_slots));
  const observerSlots = new Set(template.workflows.map((workflow) => workflow.signoff.observer_slot));
  const businessSlots = new Set(template.workflows.map((workflow) => workflow.signoff.business_acceptor_slot));
  const executorPeople = new Set([...executorSlots].map((slot) => bySlot.get(slot)?.person_identity_sha256));
  const observerPeople = new Set([...observerSlots].map((slot) => bySlot.get(slot)?.person_identity_sha256));
  const businessPeople = new Set([...businessSlots].map((slot) => bySlot.get(slot)?.person_identity_sha256));
  if ([...observerPeople].some((person) => executorPeople.has(person) || businessPeople.has(person))
    || [...businessPeople].some((person) => executorPeople.has(person))) reject(code);
  if (bySlot.get("rollback_owner")?.person_identity_sha256 !== approval.rollback_owner_identity_sha256) reject(code);
  return bySlot;
}

function validateStepEvidence(value, expected, actor, window, requestIds, minimum) {
  const code = "UAT_PROMOTION_CROSS_ROLE_STEP_EVIDENCE_INVALID";
  exactKeys(value, [
    "step_id", "actor_slot", "operation_id", "expected_contract_sha256", "started_at", "completed_at",
    "request", "response", "database", "audit", "idempotency", "result",
  ], code);
  if (value.step_id !== expected.id || value.actor_slot !== expected.actor_slot
    || value.operation_id !== expected.operation_id || value.actor_slot !== actor.slot || value.result !== "PASS"
    || value.expected_contract_sha256 !== sha256(canonicalJson(expected))) reject(code);
  const started = instant(value.started_at, code);
  const completed = instant(value.completed_at, code);
  if (started < window.start || started < minimum || completed < started || completed > window.end) reject(code);

  exactKeys(value.request, [
    "request_id", "metadata_evidence_sha256", "body_digest_sha256", "origin_check",
    "content_type_check", "csrf_check", "idempotency_key_digest_sha256",
  ], code);
  if (typeof value.request.request_id !== "string" || !REQUEST_ID.test(value.request.request_id)
    || requestIds.has(value.request.request_id) || value.request.origin_check !== "APPROVED"
    || value.request.content_type_check !== "APPLICATION_JSON"
    || value.request.csrf_check !== "PRESENT_AND_ACCEPTED") reject(code);
  requestIds.add(value.request.request_id);
  for (const field of ["metadata_evidence_sha256", "body_digest_sha256", "idempotency_key_digest_sha256"]) {
    digest(value.request[field], code);
  }

  exactKeys(value.response, [
    "http_status", "header_request_id", "body_request_id", "body_digest_sha256", "evidence_sha256",
  ], code);
  if (value.response.http_status !== expected.expected_status
    || value.response.header_request_id !== value.request.request_id
    || value.response.body_request_id !== value.request.request_id) reject(code);
  digest(value.response.body_digest_sha256, code);
  digest(value.response.evidence_sha256, code);

  exactKeys(value.database, [
    "expected_delta_contract_sha256", "observed_delta_sha256", "matches_expected", "half_record_count",
  ], code);
  if (value.database.expected_delta_contract_sha256 !== sha256(canonicalJson(expected.expected_db_delta))
    || value.database.matches_expected !== true || value.database.half_record_count !== 0) reject(code);
  digest(value.database.observed_delta_sha256, code);

  exactKeys(value.audit, ["request_id", "evidence_sha256", "transactionally_committed"], code);
  if (value.audit.request_id !== value.request.request_id || value.audit.transactionally_committed !== true) reject(code);
  digest(value.audit.evidence_sha256, code);

  exactKeys(value.idempotency, ["request_digest_sha256", "result_digest_sha256", "state"], code);
  if (value.idempotency.state !== "ORIGINAL_COMMITTED") reject(code);
  digest(value.idempotency.request_digest_sha256, code);
  digest(value.idempotency.result_digest_sha256, code);
  return Object.freeze({ started, completed });
}

export const uatPromotionCrossRoleControlObservations = Object.freeze({
  UNAUTHORIZED_403: Object.freeze({
    http_status: 403, error_code: "HTTP_403", database_delta_zero: true,
    idempotency_replayed: null, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
  CSRF_403: Object.freeze({
    http_status: 403, error_code: "HTTP_403", database_delta_zero: true,
    idempotency_replayed: null, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
  IDEMPOTENCY_REPLAY: Object.freeze({
    http_status: null, error_code: null, database_delta_zero: true,
    idempotency_replayed: true, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
  IDEMPOTENCY_CONFLICT: Object.freeze({
    http_status: 409, error_code: "IDEMPOTENCY_CONFLICT", database_delta_zero: true,
    idempotency_replayed: false, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
  CAS_CONFLICT: Object.freeze({
    http_status: 409, error_code: "CAS_CONFLICT", database_delta_zero: true,
    idempotency_replayed: null, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
  ATOMIC_FAILURE_ZERO_HALF_RECORD: Object.freeze({
    http_status: null, error_code: "FAULT_INJECTED", database_delta_zero: true,
    idempotency_replayed: null, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
  APPEND_ONLY_REVERSAL: Object.freeze({
    http_status: null, error_code: null, database_delta_zero: false,
    idempotency_replayed: null, request_id_consistent: true,
    original_fact_preserved: true, half_record_count: 0,
  }),
  AUDIT_REQUEST_ID: Object.freeze({
    http_status: null, error_code: null, database_delta_zero: null,
    idempotency_replayed: null, request_id_consistent: true,
    original_fact_preserved: null, half_record_count: 0,
  }),
});

function validateControlEvidence(value, expected, targetCompleted, window) {
  const code = "UAT_PROMOTION_CROSS_ROLE_CONTROL_EVIDENCE_INVALID";
  exactKeys(value, [
    "kind", "target_step", "expected_contract_sha256", "observed_at", "observation",
    "evidence_sha256", "result",
  ], code);
  if (value.kind !== expected.kind || value.target_step !== expected.target_step || value.result !== "PASS"
    || value.expected_contract_sha256 !== sha256(canonicalJson(expected))
    || !same(value.observation, uatPromotionCrossRoleControlObservations[expected.kind])) reject(code);
  const observed = instant(value.observed_at, code);
  if (observed < targetCompleted || observed > window.end) reject(code);
  digest(value.evidence_sha256, code);
  return observed;
}

function validateReversalEvidence(value, expected, targetCompleted, window) {
  const code = "UAT_PROMOTION_CROSS_ROLE_REVERSAL_EVIDENCE_INVALID";
  exactKeys(value, [
    "step_id", "branch_from_checkpoint", "mode", "original_fact_preserved", "recorded_at",
    "source_fact_sha256", "reversal_fact_sha256", "ledger_delta_sha256", "audit_evidence_sha256",
    "result", "evidence_sha256",
  ], code);
  if (value.step_id !== expected.id || value.branch_from_checkpoint !== expected.branch_from_checkpoint
    || value.mode !== "APPEND_ONLY_REVERSAL" || value.original_fact_preserved !== true
    || value.result !== "PASS") reject(code);
  const recorded = instant(value.recorded_at, code);
  if (recorded < targetCompleted || recorded > window.end) reject(code);
  for (const field of [
    "source_fact_sha256", "reversal_fact_sha256", "ledger_delta_sha256",
    "audit_evidence_sha256", "evidence_sha256",
  ]) digest(value[field], code);
  if (value.source_fact_sha256 === value.reversal_fact_sha256) reject(code);
  return recorded;
}

function validateActorSignoff(value, expectedSlot, actor, timeField, minimum, window, result) {
  const code = "UAT_PROMOTION_CROSS_ROLE_SIGNOFF_INVALID";
  exactKeys(value, [
    "actor_slot", "person_identity_sha256", "account_identity_sha256", timeField,
    "subject_sha256", "evidence_sha256", "result",
  ], code);
  if (value.actor_slot !== expectedSlot || value.person_identity_sha256 !== actor.person_identity_sha256
    || value.account_identity_sha256 !== actor.account_identity_sha256 || value.result !== result
    || value.subject_sha256 !== window.subject) reject(code);
  digest(value.evidence_sha256, code);
  const signed = instant(value[timeField], code);
  if (signed < minimum || signed > window.end) reject(code);
  return signed;
}

function validateSignoff(value, expected, actors, minimum, window) {
  const code = "UAT_PROMOTION_CROSS_ROLE_SIGNOFF_INVALID";
  exactKeys(value, ["executor_signoffs", "observer_signoff", "business_acceptance", "signoff_sha256"], code);
  if (!Array.isArray(value.executor_signoffs)
    || value.executor_signoffs.length !== expected.executor_slots.length) reject(code);
  const signedAt = [];
  for (const [index, item] of value.executor_signoffs.entries()) {
    const slot = expected.executor_slots[index];
    signedAt.push(validateActorSignoff(item, slot, actors.get(slot), "signed_at", minimum, window, "PASS"));
  }
  signedAt.push(validateActorSignoff(
    value.observer_signoff, expected.observer_slot, actors.get(expected.observer_slot),
    "signed_at", minimum, window, "PASS",
  ));
  signedAt.push(validateActorSignoff(
    value.business_acceptance, expected.business_acceptor_slot, actors.get(expected.business_acceptor_slot),
    "accepted_at", minimum, window, "ACCEPTED",
  ));
  digest(value.signoff_sha256, code);
  if (sha256(canonicalJson(bodyWithout(value, "signoff_sha256"))) !== value.signoff_sha256) reject(code);
  return Math.max(...signedAt);
}

function validateWorkflowExecution(value, expected, actors, window, requestIds) {
  const code = "UAT_PROMOTION_CROSS_ROLE_WORKFLOW_INVALID";
  exactKeys(value, [
    "workflow_id", "status", "steps", "controls", "reversals", "signoff", "workflow_evidence_sha256",
  ], code);
  if (value.workflow_id !== expected.id || value.status !== "PASS"
    || !Array.isArray(value.steps) || value.steps.length !== expected.steps.length
    || !Array.isArray(value.controls) || value.controls.length !== expected.controls.length) reject(code);
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  let previousCompleted = window.start;
  const stepCompleted = new Map();
  for (const [index, step] of value.steps.entries()) {
    const expectedStep = expected.steps[index];
    const actor = actors.get(expectedStep.actor_slot);
    if (!actor) reject(code);
    const times = validateStepEvidence(step, expectedStep, actor, window, requestIds, previousCompleted);
    first = Math.min(first, times.started);
    last = Math.max(last, times.completed);
    previousCompleted = times.completed;
    stepCompleted.set(expectedStep.id, times.completed);
  }
  for (const [index, control] of value.controls.entries()) {
    const expectedControl = expected.controls[index];
    const targetCompleted = expectedControl.target_step === "ALL_STEPS"
      ? previousCompleted
      : stepCompleted.get(expectedControl.target_step);
    if (!Number.isFinite(targetCompleted)) reject(code);
    last = Math.max(last, validateControlEvidence(control, expectedControl, targetCompleted, window));
  }
  const expectedReversals = expected.steps.filter((step) => step.branch_from_checkpoint !== undefined);
  if (!Array.isArray(value.reversals) || value.reversals.length !== expectedReversals.length) reject(code);
  for (const [index, reversal] of value.reversals.entries()) {
    const expectedReversal = expectedReversals[index];
    last = Math.max(last, validateReversalEvidence(
      reversal, expectedReversal, stepCompleted.get(expectedReversal.id), window,
    ));
  }
  return Object.freeze({ first, executionCompleted: last });
}

function validateWorkflowSignoff(value, expected, actors, minimum, window) {
  const code = "UAT_PROMOTION_CROSS_ROLE_WORKFLOW_INVALID";
  const signed = validateSignoff(value.signoff, expected.signoff, actors, minimum, window);
  digest(value.workflow_evidence_sha256, code);
  if (sha256(canonicalJson(bodyWithout(value, "workflow_evidence_sha256"))) !== value.workflow_evidence_sha256) reject(code);
  return signed;
}

function evidenceSubjectBody(value) {
  const body = bodyWithout(bodyWithout(value, "result_sha256"), "evidence_subject_sha256");
  delete body.signoff_completed_at;
  body.workflows = (body.workflows ?? []).map((workflow) => {
    const unsigned = bodyWithout(workflow, "workflow_evidence_sha256");
    delete unsigned.signoff;
    return unsigned;
  });
  return body;
}

export function validateUatPromotionCrossRoleResult(value, { template, now } = {}) {
  const code = "UAT_PROMOTION_CROSS_ROLE_RESULT_INVALID";
  const contract = validateCrossRoleUatTemplate(template);
  exactKeys(value, [
    "schema_version", "contract", "status", "evidence_class", "result_id", "promotion_id",
    "promotion_generation", "verification_operation_id", "human_execution_authorization_sha256",
    "supervisor_bundle_sha256", "previous_checkpoint_receipt_sha256",
    "postdeploy_identity_evidence_sha256", "release_identity_sha256",
    "cross_role_contract_artifact_sha256", "authorization_matrix_artifact_sha256",
    "authorization_matrix_source_manifest_sha256", "fixture_id", "data_class", "approval",
    "actors", "workflows", "execution_started_at", "execution_completed_at", "signoff_completed_at",
    "evidence_expires_at", "sanitization", "evidence_subject_sha256", "result_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT
    || value.status !== "PASS" || value.evidence_class !== "HUMAN_EXECUTED_UAT"
    || value.result_id !== value.verification_operation_id || value.data_class !== "SYNTHETIC_ONLY"
    || value.fixture_id !== contract.synthetic_fixture.fixture_id
    || value.cross_role_contract_artifact_sha256 !== contract.artifact_sha256
    || value.authorization_matrix_artifact_sha256 !== contract.generated_from.authorization_matrix.artifact_sha256
    || value.authorization_matrix_source_manifest_sha256 !== contract.generated_from.authorization_matrix.source_manifest_sha256
    || !same(value.sanitization, SANITIZATION)) reject(code);
  for (const field of ["result_id", "promotion_id", "verification_operation_id"]) identifier(value[field], code);
  if (!Number.isSafeInteger(value.promotion_generation) || value.promotion_generation < 1
    || value.promotion_generation > 1_000_000) reject(code);
  for (const field of [
    "human_execution_authorization_sha256", "supervisor_bundle_sha256", "previous_checkpoint_receipt_sha256",
    "postdeploy_identity_evidence_sha256", "release_identity_sha256",
    "cross_role_contract_artifact_sha256", "authorization_matrix_artifact_sha256",
    "authorization_matrix_source_manifest_sha256", "evidence_subject_sha256", "result_sha256",
  ]) digest(value[field], code);
  const window = validateApproval(value.approval, contract);
  const actors = validateActors(value.actors, contract, value.approval);
  if (value.approval.approval_subject_sha256 !== approvalSubjectSha256(value, contract)) {
    reject("UAT_PROMOTION_CROSS_ROLE_APPROVAL_INVALID");
  }
  if (sha256(canonicalJson(evidenceSubjectBody(value))) !== value.evidence_subject_sha256) reject(code);
  if (!Array.isArray(value.workflows) || value.workflows.length !== contract.workflows.length) reject(code);
  const requestIds = new Set();
  const subjectWindow = Object.freeze({ ...window, subject: value.evidence_subject_sha256 });
  const workflowTimes = [];
  let previousWorkflowCompleted = window.start;
  for (const [index, workflow] of value.workflows.entries()) {
    const times = validateWorkflowExecution(
      workflow, contract.workflows[index], actors, subjectWindow, requestIds,
    );
    if (times.first < previousWorkflowCompleted) reject(code);
    previousWorkflowCompleted = times.executionCompleted;
    workflowTimes.push(times);
  }
  const executionStarted = instant(value.execution_started_at, code);
  const executionCompleted = instant(value.execution_completed_at, code);
  const signoffCompleted = instant(value.signoff_completed_at, code);
  const expires = instant(value.evidence_expires_at, code);
  const workflowSignoffTimes = value.workflows.map((workflow, index) => validateWorkflowSignoff(
    workflow, contract.workflows[index], actors, executionCompleted, subjectWindow,
  ));
  if (executionStarted !== Math.min(...workflowTimes.map((item) => item.first))
    || executionCompleted !== Math.max(...workflowTimes.map((item) => item.executionCompleted))
    || signoffCompleted !== Math.max(...workflowSignoffTimes)
    || executionStarted < window.start || executionCompleted > window.end
    || signoffCompleted < executionCompleted || signoffCompleted > window.end
    || expires <= signoffCompleted || expires - signoffCompleted > 24 * 60 * 60 * 1000) reject(code);
  if (now !== undefined) {
    const observed = now instanceof Date ? now.getTime() : Number.NaN;
    if (!Number.isFinite(observed) || observed < signoffCompleted || observed >= expires) reject(code);
  }
  if (sha256(canonicalJson(bodyWithout(value, "result_sha256"))) !== value.result_sha256) reject(code);
  return value;
}

function addSignoffDigest(signoff) {
  const body = bodyWithout(signoff, "signoff_sha256");
  return { ...body, signoff_sha256: sha256(canonicalJson(body)) };
}

function bindSignoffSubject(signoff, subject) {
  return { ...bodyWithout(signoff, "subject_sha256"), subject_sha256: subject };
}

function bindWorkflowSubject(workflow, subject) {
  return {
    ...workflow,
    signoff: {
      ...workflow.signoff,
      executor_signoffs: (workflow.signoff?.executor_signoffs ?? []).map((item) => (
        bindSignoffSubject(item, subject)
      )),
      observer_signoff: bindSignoffSubject(workflow.signoff?.observer_signoff ?? {}, subject),
      business_acceptance: bindSignoffSubject(workflow.signoff?.business_acceptance ?? {}, subject),
    },
  };
}

function addWorkflowDigest(workflow) {
  const withSignoff = { ...workflow, signoff: addSignoffDigest(workflow.signoff) };
  const body = bodyWithout(withSignoff, "workflow_evidence_sha256");
  return { ...body, workflow_evidence_sha256: sha256(canonicalJson(body)) };
}

export function createUatPromotionCrossRoleResult(input, { template, now } = {}) {
  const contract = validateCrossRoleUatTemplate(template);
  const initial = bodyWithout(bodyWithout(input, "result_sha256"), "evidence_subject_sha256");
  const unsigned = {
    ...initial,
    approval: {
      ...bodyWithout(initial.approval ?? {}, "approval_subject_sha256"),
      approval_subject_sha256: approvalSubjectSha256(initial, contract),
    },
  };
  const subject = sha256(canonicalJson(evidenceSubjectBody(unsigned)));
  const body = {
    ...unsigned,
    evidence_subject_sha256: subject,
    workflows: (unsigned.workflows ?? []).map((workflow) => addWorkflowDigest(
      bindWorkflowSubject(workflow, subject),
    )),
  };
  return Object.freeze(validateUatPromotionCrossRoleResult({
    ...body, result_sha256: sha256(canonicalJson(body)),
  }, { template: contract, now }));
}

export function canonicalUatPromotionCrossRoleResultJson(value) {
  return canonicalJson(value);
}

export const uatPromotionCrossRoleSanitization = SANITIZATION;
