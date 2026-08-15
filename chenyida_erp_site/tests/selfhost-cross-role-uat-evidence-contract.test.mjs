import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CROSS_ROLE_UAT_ARTIFACT_CONTRACT,
  buildCrossRoleUatEvidenceContract,
  canonicalJson,
  loadCrossRoleUatInputs,
  prettyJson,
} from "../scripts/cross-role-uat-evidence-contract.mjs";

const REQUIRED_WORKFLOWS = [
  "PROCURE_RECEIVE_IQC_AP",
  "PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE",
  "SALES_FQC_SHIPMENT_AR",
  "FINANCE_PAYMENT_REVERSAL",
];
const REQUIRED_CONTROLS = [
  "UNAUTHORIZED_403",
  "CSRF_403",
  "IDEMPOTENCY_REPLAY",
  "IDEMPOTENCY_CONFLICT",
  "CAS_CONFLICT",
  "ATOMIC_FAILURE_ZERO_HALF_RECORD",
  "APPEND_ONLY_REVERSAL",
  "AUDIT_REQUEST_ID",
];
const APPROVAL_FIELDS = [
  "business_role_matrix_approval_id",
  "uat_account_mapping_approval_id",
  "allowed_write_scope",
  "execution_window_start",
  "execution_window_end",
  "stop_authority_person",
  "rollback_owner_person",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const cloneInputs = (inputs) => ({
  policy: structuredClone(inputs.policy),
  matrix: structuredClone(inputs.matrix),
  inventory: structuredClone(inputs.inventory),
  evidenceBodies: new Map(inputs.evidenceBodies),
  rawDigests: { ...inputs.rawDigests },
});

const inputs = loadCrossRoleUatInputs();
const built = buildCrossRoleUatEvidenceContract(inputs);
const artifactRaw = await readFile(new URL("../operations/cross-role-uat-evidence-contract-v1.json", import.meta.url), "utf8");
const markdownRaw = await readFile(new URL("../../docs/testing/selfhost-cross-role-uat-evidence-contract-v1.md", import.meta.url), "utf8");
const artifact = JSON.parse(artifactRaw);

test("01 canonical JSON and Markdown replay deterministically with a valid self digest", () => {
  assert.deepEqual(built.errors, []);
  assert.equal(artifact.contract, CROSS_ROLE_UAT_ARTIFACT_CONTRACT);
  assert.equal(artifactRaw, prettyJson(built.artifact));
  assert.equal(markdownRaw, built.markdown);
  const { artifact_sha256: actual, ...body } = artifact;
  assert.equal(actual, sha256(canonicalJson(body)));
  assert.equal(artifact.validation.result, "PASS");
});

test("02 execution, approval, account mapping and all three signoff classes fail closed", () => {
  assert.equal(artifact.authority, "REPOSITORY_SYNTHETIC_EVIDENCE_ONLY");
  assert.equal(artifact.execution_class, "NOT_AUTHORIZED");
  assert.equal(artifact.approval_gate.status, "BLOCKED");
  assert.equal(artifact.readiness.status, "BLOCKED");
  for (const field of APPROVAL_FIELDS) assert.equal(artifact.approval_gate[field], null, field);
  for (const [slot, actor] of Object.entries(artifact.actor_slots)) {
    assert.equal(actor.person_name, null, `${slot}:person`);
    assert.equal(actor.account_username, null, `${slot}:account`);
  }
  for (const workflow of artifact.workflows) {
    assert.ok(workflow.signoff.executor_slots.length > 0);
    assert.equal(workflow.signoff.observer_slot, "operations_observer");
    assert.equal(workflow.signoff.business_acceptor_slot, "business_acceptor");
    assert.deepEqual(
      [workflow.signoff.executor_signed_at, workflow.signoff.observer_signed_at, workflow.signoff.business_accepted_at, workflow.signoff.result],
      [null, null, null, null],
    );
  }
  assert.match(markdownRaw, /BLOCKED \/ SYNTHETIC CONTRACT ONLY \/ NOT AUTHORIZED TO EXECUTE/);
  assert.doesNotMatch(markdownRaw, /UAT已通过|员工试运行已完成|允许正式写入/);
});

test("03 all four cross-role chains, 32 steps and eight controls per chain are locked", () => {
  assert.deepEqual(artifact.workflows.map((workflow) => workflow.id), REQUIRED_WORKFLOWS);
  assert.equal(artifact.coverage.workflow_count, 4);
  assert.equal(artifact.coverage.step_count, 32);
  assert.equal(artifact.coverage.control_assertion_count, 32);
  assert.equal(artifact.coverage.branch_reversal_step_count, 6);
  for (const workflow of artifact.workflows) {
    assert.deepEqual(workflow.controls.map((control) => control.kind), REQUIRED_CONTROLS);
    assert.ok(workflow.preconditions.length >= 3);
    assert.ok(workflow.steps.some((step) => step.branch_from_checkpoint));
  }
});

test("04 every write step is bound to an allowed actor, denied probe, route, permission and server guard", () => {
  const byId = new Map(inputs.matrix.operations.map((operation) => [operation.id, operation]));
  for (const workflow of artifact.workflows) {
    for (const step of workflow.steps) {
      const operation = byId.get(step.operation_id);
      assert.ok(operation, `${workflow.id}:${step.id}`);
      assert.ok(operation.methods.includes(step.method), step.id);
      assert.ok(new RegExp(operation.route_pattern).test(step.path.replaceAll(/\{[a-z0-9_]+\}/g, "1")), step.id);
      assert.ok(operation.allowed_roles.includes(step.authorization.actor_role), step.id);
      assert.ok(operation.denied_roles.includes(step.denied_probe_role), step.id);
      assert.deepEqual(step.authorization.permissions_all, operation.permissions_all);
      assert.deepEqual([step.authorization.csrf, step.authorization.idempotency, step.authorization.audit], ["REQUIRED", "REQUIRED", "REQUIRED_TRANSACTIONAL"]);
      assert.equal(step.request_evidence.headers["X-CSRF-Token"], "{redacted_capture_only_presence_and_result}");
      assert.ok(step.response_evidence.includes("body_digest_sha256"));
      assert.ok(step.server_evidence.some((entry) => entry.includes("audit_log")));
    }
  }
});

test("05 each step specifies a sanitized body, CAS contract, database delta and request-id evidence", () => {
  for (const workflow of artifact.workflows) {
    for (const step of workflow.steps) {
      assert.equal(typeof step.body_template, "object", step.id);
      assert.ok(Array.isArray(step.cas_fields), step.id);
      assert.ok(step.expected_db_delta.length > 0, step.id);
      for (const delta of step.expected_db_delta) {
        assert.ok(delta.table.length > 2, step.id);
        assert.ok(delta.delta.length > 1, step.id);
        assert.ok(delta.assertion.length > 2, step.id);
      }
      assert.match(step.request_evidence.headers["X-Request-ID"], /^UAT67-/);
      assert.match(step.request_evidence.headers["Idempotency-Key"], /^uat67-/);
      assert.ok(step.request_evidence.forbidden_capture.includes("Cookie"));
    }
  }
});

test("06 reversals are isolated, append-only and direct SQL cleanup stays forbidden", () => {
  assert.equal(artifact.rollback_policy.mode, "BUSINESS_REVERSAL_FIRST");
  assert.equal(artifact.rollback_policy.direct_sql_delete_or_update, "FORBIDDEN");
  assert.equal(artifact.rollback_policy.snapshot_restore, "SEPARATE_EXPLICIT_AUTHORIZATION_REQUIRED");
  const reversalOperations = new Set(["fulfillment.reverse", "production.complete-reverse", "sales.delivery-reverse", "finance.reverse"]);
  const reversals = artifact.workflows.flatMap((workflow) => workflow.steps).filter((step) => reversalOperations.has(step.operation_id));
  assert.equal(reversals.length, 5);
  for (const step of reversals) {
    assert.ok(step.branch_from_checkpoint, step.id);
    assert.ok(step.expected_db_delta.some((delta) => /REVERSAL|reversal|冲销|反向/.test(`${delta.delta} ${delta.assertion}`)), step.id);
  }
  assert.ok(artifact.stop_conditions.some((condition) => condition.includes("下游引用")));
});

test("07 authorization matrix, evidence source and release inventory digests are bound", () => {
  assert.equal(artifact.generated_from.authorization_matrix.artifact_sha256, inputs.matrix.artifact_sha256);
  assert.equal(artifact.generated_from.authorization_matrix.source_manifest_sha256, inputs.matrix.source_manifest.sha256);
  assert.equal(artifact.generated_from.release_test_inventory.sha256, inputs.rawDigests.inventory);
  assert.equal(artifact.generated_from.evidence_source_manifest.sha256, inputs.policy.reviewed_evidence_source_manifest_sha256);
  assert.equal(artifact.coverage.evidence_source_count, 16);
  assert.ok(artifact.generated_from.evidence_source_manifest.files.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
});

test("08 matrix, source, route, actor, approval, control and signoff drift are rejected", () => {
  const cases = [
    ["matrix", (value) => { value.policy.reviewed_authorization_matrix.artifact_sha256 = "0".repeat(64); }, "AUTHORIZATION_MATRIX_ARTIFACT_DRIFT"],
    ["route", (value) => { value.policy.workflows[0].steps[0].path = "/api/not-authorized"; }, "STEP_ROUTE_NOT_AUTHORIZED"],
    ["actor", (value) => { value.policy.actor_slots.purchase_executor.role = "sales"; }, "ACTOR_ROLE_DRIFT"],
    ["approval", (value) => { value.policy.approval_gate.status = "READY"; }, "APPROVAL_GATE_MUST_REMAIN_BLOCKED"],
    ["account", (value) => { value.policy.actor_slots.purchase_executor.account_username = "someone"; }, "ACTOR_IDENTITY_MUST_REMAIN_EMPTY"],
    ["control", (value) => { value.policy.workflows[0].controls.pop(); }, "WORKFLOW_CONTROL_SET_DRIFT"],
    ["signoff", (value) => { value.policy.workflows[0].signoff.result = "PASS"; }, "SIGNOFF_MUST_REMAIN_EMPTY"],
  ];
  for (const [name, mutate, expected] of cases) {
    const changed = cloneInputs(inputs);
    mutate(changed);
    const result = buildCrossRoleUatEvidenceContract(changed);
    assert.ok(result.errors.some((entry) => entry.startsWith(expected)), `${name}:${result.errors.join(",")}`);
  }
  const sourceChanged = cloneInputs(inputs);
  const first = sourceChanged.policy.evidence_sources[0];
  sourceChanged.evidenceBodies.set(first.path, "source drift");
  const sourceErrors = buildCrossRoleUatEvidenceContract(sourceChanged).errors;
  assert.ok(sourceErrors.some((entry) => entry.startsWith("EVIDENCE_SOURCE_MARKER_DRIFT")));
  assert.ok(sourceErrors.includes("EVIDENCE_SOURCE_MANIFEST_DRIFT"));
});

test("09 historical unauthorized-write evidence remains explicitly represented", () => {
  const audit = artifact.generated_from.evidence_source_manifest.files.find((entry) => entry.path.endsWith("SELFHOST-UAT-AUDIT-34.md"));
  const decision = artifact.generated_from.evidence_source_manifest.files.find((entry) => entry.path.endsWith("SELFHOST-UAT-DECISION-35.md"));
  assert.ok(audit?.markers.includes("UNAUTHORIZED UAT PO WRITE CONFIRMED"));
  assert.ok(decision?.markers.includes("不追溯性授权"));
  assert.ok(decision?.markers.includes("每个后续写阶段仍需独立明确授权"));
  assert.ok(artifact.readiness.blockers.includes("UAT_WRITE_SCOPE_AND_WINDOW_NOT_AUTHORIZED"));
});
