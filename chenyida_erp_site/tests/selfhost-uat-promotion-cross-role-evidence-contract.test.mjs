import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT,
  canonicalUatPromotionCrossRoleResultJson,
  createUatPromotionCrossRoleResult,
  uatPromotionCrossRoleControlObservations,
  uatPromotionCrossRoleSanitization,
  validateUatPromotionCrossRoleResult,
} from "../scripts/uat-promotion-cross-role-evidence-contract.mjs";
import { canonicalJson, sha256 } from "../scripts/cross-role-uat-evidence-contract.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = JSON.parse(await readFile(
  path.join(siteRoot, "operations/cross-role-uat-evidence-contract-v1.json"), "utf8",
));
const hash = (label) => sha256(Buffer.from(label, "utf8"));
const instant = (second) => new Date(Date.parse("2026-08-15T02:00:00.000Z") + second * 1000).toISOString();

function evidenceActors() {
  return Object.entries(template.actor_slots).sort(([left], [right]) => left.localeCompare(right)).map(([slot, actor]) => ({
    slot,
    role: actor.role,
    person_identity_sha256: hash(`person:${slot}`),
    account_identity_sha256: hash(`account:${slot}`),
  }));
}

function actorBySlot(actors, slot) {
  return actors.find((actor) => actor.slot === slot);
}

function signoff(slot, actor, signedAt, result = "PASS", timeField = "signed_at") {
  return {
    actor_slot: slot,
    person_identity_sha256: actor.person_identity_sha256,
    account_identity_sha256: actor.account_identity_sha256,
    [timeField]: signedAt,
    evidence_sha256: hash(`signoff:${slot}:${signedAt}`),
    result,
  };
}

function evidenceWorkflows(actors) {
  let cursor = 10;
  let first = null;
  let executionCompleted = null;
  let signoffCompleted = null;
  const workflows = template.workflows.map((workflow) => {
    const steps = workflow.steps.map((step) => {
      const startedAt = instant(cursor);
      const completedAt = instant(cursor + 1);
      cursor += 3;
      first ??= startedAt;
      return {
        step_id: step.id,
        actor_slot: step.actor_slot,
        operation_id: step.operation_id,
        expected_contract_sha256: sha256(canonicalJson(step)),
        started_at: startedAt,
        completed_at: completedAt,
        request: {
          request_id: `UAT77:${workflow.id}:${step.id}:REQUEST`,
          metadata_evidence_sha256: hash(`request-metadata:${workflow.id}:${step.id}`),
          body_digest_sha256: hash(`request-body:${workflow.id}:${step.id}`),
          origin_check: "APPROVED",
          content_type_check: "APPLICATION_JSON",
          csrf_check: "PRESENT_AND_ACCEPTED",
          idempotency_key_digest_sha256: hash(`idempotency-key:${workflow.id}:${step.id}`),
        },
        response: {
          http_status: step.expected_status,
          header_request_id: `UAT77:${workflow.id}:${step.id}:REQUEST`,
          body_request_id: `UAT77:${workflow.id}:${step.id}:REQUEST`,
          body_digest_sha256: hash(`response-body:${workflow.id}:${step.id}`),
          evidence_sha256: hash(`response-evidence:${workflow.id}:${step.id}`),
        },
        database: {
          expected_delta_contract_sha256: sha256(canonicalJson(step.expected_db_delta)),
          observed_delta_sha256: hash(`database-observed:${workflow.id}:${step.id}`),
          matches_expected: true,
          half_record_count: 0,
        },
        audit: {
          request_id: `UAT77:${workflow.id}:${step.id}:REQUEST`,
          evidence_sha256: hash(`audit:${workflow.id}:${step.id}`),
          transactionally_committed: true,
        },
        idempotency: {
          request_digest_sha256: hash(`idempotency-request:${workflow.id}:${step.id}`),
          result_digest_sha256: hash(`idempotency-result:${workflow.id}:${step.id}`),
          state: "ORIGINAL_COMMITTED",
        },
        result: "PASS",
      };
    });
    const controls = workflow.controls.map((control) => {
      const observedAt = instant(cursor);
      cursor += 1;
      executionCompleted = observedAt;
      return {
        kind: control.kind,
        target_step: control.target_step,
        expected_contract_sha256: sha256(canonicalJson(control)),
        observed_at: observedAt,
        observation: structuredClone(uatPromotionCrossRoleControlObservations[control.kind]),
        evidence_sha256: hash(`control:${workflow.id}:${control.kind}:${control.target_step}`),
        result: "PASS",
      };
    });
    const reversals = workflow.steps.filter((step) => step.branch_from_checkpoint !== undefined).map((step) => ({
      step_id: step.id,
      branch_from_checkpoint: step.branch_from_checkpoint,
      mode: "APPEND_ONLY_REVERSAL",
      original_fact_preserved: true,
      recorded_at: instant(cursor++),
      source_fact_sha256: hash(`reversal-source:${workflow.id}:${step.id}`),
      reversal_fact_sha256: hash(`reversal-fact:${workflow.id}:${step.id}`),
      ledger_delta_sha256: hash(`reversal-ledger:${workflow.id}:${step.id}`),
      audit_evidence_sha256: hash(`reversal-audit:${workflow.id}:${step.id}`),
      result: "PASS",
      evidence_sha256: hash(`reversal:${workflow.id}:${step.id}`),
    }));
    if (reversals.length > 0) executionCompleted = reversals.at(-1).recorded_at;
    return {
      workflow_id: workflow.id,
      status: "PASS",
      steps,
      controls,
      reversals,
    };
  });
  for (const [index, workflowEvidence] of workflows.entries()) {
    const workflow = template.workflows[index];
    const minimumSignoff = cursor;
    const executorSignoffs = workflow.signoff.executor_slots.map((slot, index) => (
      signoff(slot, actorBySlot(actors, slot), instant(minimumSignoff + index))
    ));
    const observerSecond = minimumSignoff + executorSignoffs.length;
    const businessSecond = observerSecond + 1;
    const observer = actorBySlot(actors, workflow.signoff.observer_slot);
    const business = actorBySlot(actors, workflow.signoff.business_acceptor_slot);
    cursor = businessSecond + 3;
    signoffCompleted = instant(businessSecond);
    workflowEvidence.signoff = {
      executor_signoffs: executorSignoffs,
      observer_signoff: signoff(workflow.signoff.observer_slot, observer, instant(observerSecond)),
      business_acceptance: signoff(
        workflow.signoff.business_acceptor_slot, business, instant(businessSecond),
        "ACCEPTED", "accepted_at",
      ),
    };
  }
  return { workflows, first, executionCompleted, signoffCompleted };
}

function validResult() {
  const actors = evidenceActors();
  const evidence = evidenceWorkflows(actors);
  const resultId = "uat77-cross-role-result-001";
  return createUatPromotionCrossRoleResult({
    schema_version: 1,
    contract: UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT,
    status: "PASS",
    evidence_class: "HUMAN_EXECUTED_UAT",
    result_id: resultId,
    promotion_id: "promotion-uat77-001",
    promotion_generation: 1,
    verification_operation_id: resultId,
    human_execution_authorization_sha256: hash("authorization:human-cross-role-execution"),
    supervisor_bundle_sha256: hash("supervisor:bundle"),
    previous_checkpoint_receipt_sha256: hash("checkpoint:11"),
    postdeploy_identity_evidence_sha256: hash("postdeploy:identity"),
    release_identity_sha256: hash("release:identity"),
    cross_role_contract_artifact_sha256: template.artifact_sha256,
    authorization_matrix_artifact_sha256: template.generated_from.authorization_matrix.artifact_sha256,
    authorization_matrix_source_manifest_sha256: template.generated_from.authorization_matrix.source_manifest_sha256,
    fixture_id: template.synthetic_fixture.fixture_id,
    data_class: "SYNTHETIC_ONLY",
    approval: {
      status: "APPROVED",
      business_role_matrix_approval_id: "BRM-20260815-001",
      uat_account_mapping_approval_id: "UAM-20260815-001",
      allowed_write_scope: `SYNTHETIC_ONLY:${template.synthetic_fixture.fixture_id}`,
      execution_window_start: instant(0),
      execution_window_end: instant(3600),
      stop_authority_identity_sha256: hash("stop-authority"),
      rollback_owner_identity_sha256: actorBySlot(actors, "rollback_owner").person_identity_sha256,
      approval_evidence_sha256: hash("approval-evidence"),
    },
    actors,
    workflows: evidence.workflows,
    execution_started_at: evidence.first,
    execution_completed_at: evidence.executionCompleted,
    signoff_completed_at: evidence.signoffCompleted,
    evidence_expires_at: instant(3600 + 3600),
    sanitization: uatPromotionCrossRoleSanitization,
  }, { template, now: new Date(instant(1800)) });
}

test("cross-role result binds all 32 steps, 32 controls, 6 reversals and human signoffs", () => {
  const result = validResult();
  assert.equal(validateUatPromotionCrossRoleResult(result, {
    template, now: new Date(instant(1800)),
  }).result_sha256, result.result_sha256);
  assert.equal(result.workflows.flatMap((workflow) => workflow.steps).length, 32);
  assert.equal(result.workflows.flatMap((workflow) => workflow.controls).length, 32);
  assert.equal(result.workflows.flatMap((workflow) => workflow.reversals).length, 6);
  assert.equal(canonicalUatPromotionCrossRoleResultJson(result), JSON.stringify(JSON.parse(
    canonicalUatPromotionCrossRoleResultJson(result),
  )));
});

test("placeholder approval identifiers cannot authorize checkpoint 12", () => {
  const changed = structuredClone(validResult());
  changed.approval.business_role_matrix_approval_id = "placeholder-approval";
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_APPROVAL_INVALID",
  );
});

test("approval subject binds the exact matrix, account mapping, actors, scope, window and runtime identity", () => {
  const changed = structuredClone(validResult());
  changed.approval.approval_subject_sha256 = hash("detached-approval-subject");
  assert.throws(
    () => validateUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_APPROVAL_INVALID",
  );
  const bypass = structuredClone(validResult());
  bypass.approval.uat_account_mapping_approval_id = "testapproval123";
  assert.throws(
    () => createUatPromotionCrossRoleResult(bypass, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_APPROVAL_INVALID",
  );
});

test("account reuse and required duty-separation drift fail closed", () => {
  const changed = structuredClone(validResult());
  const observer = actorBySlot(changed.actors, "operations_observer");
  const acceptor = actorBySlot(changed.actors, "business_acceptor");
  acceptor.account_identity_sha256 = observer.account_identity_sha256;
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_ACTORS_INVALID",
  );
});

test("an executor cannot also be the observer or business acceptor under another account", () => {
  const changed = structuredClone(validResult());
  const executor = actorBySlot(changed.actors, "purchase_executor");
  const acceptor = actorBySlot(changed.actors, "business_acceptor");
  acceptor.person_identity_sha256 = executor.person_identity_sha256;
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_ACTORS_INVALID",
  );
});

test("missing step or control evidence cannot be hidden by recomputing outer digests", () => {
  for (const field of ["steps", "controls"]) {
    const changed = structuredClone(validResult());
    changed.workflows[0][field].pop();
    assert.throws(
      () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
      (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_WORKFLOW_INVALID",
    );
  }
});

test("reversal evidence must prove append-only preservation", () => {
  const changed = structuredClone(validResult());
  changed.workflows[0].reversals[0].original_fact_preserved = false;
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_REVERSAL_EVIDENCE_INVALID",
  );
});

test("step and control observations must match the template outcome instead of an arbitrary digest", () => {
  const badStep = structuredClone(validResult());
  badStep.workflows[0].steps[0].response.http_status = 202;
  assert.throws(
    () => createUatPromotionCrossRoleResult(badStep, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_STEP_EVIDENCE_INVALID",
  );
  const badControl = structuredClone(validResult());
  badControl.workflows[0].controls[0].observation.database_delta_zero = false;
  assert.throws(
    () => createUatPromotionCrossRoleResult(badControl, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_CONTROL_EVIDENCE_INVALID",
  );
});

test("step chronology cannot overlap or move backwards", () => {
  const changed = structuredClone(validResult());
  changed.workflows[0].steps[1].started_at = changed.workflows[0].steps[0].started_at;
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_STEP_EVIDENCE_INVALID",
  );
});

test("signoffs must match the approved actor mapping and follow execution", () => {
  const changed = structuredClone(validResult());
  changed.workflows[0].signoff.observer_signoff.person_identity_sha256 = hash("somebody-else");
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_SIGNOFF_INVALID",
  );
});

test("a workflow signoff cannot precede evidence produced by a later workflow", () => {
  const changed = structuredClone(validResult());
  const workflow = changed.workflows[0];
  const early = workflow.reversals.at(-1)?.recorded_at ?? workflow.controls.at(-1).observed_at;
  for (const executor of workflow.signoff.executor_signoffs) executor.signed_at = early;
  workflow.signoff.observer_signoff.signed_at = early;
  workflow.signoff.business_acceptance.accepted_at = early;
  assert.ok(Date.parse(early) < Date.parse(changed.execution_completed_at));
  assert.throws(
    () => createUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_SIGNOFF_INVALID",
  );
});

test("every signoff binds the same exact pre-signing evidence subject", () => {
  const changed = structuredClone(validResult());
  changed.workflows[0].signoff.executor_signoffs[0].subject_sha256 = hash("different-subject");
  assert.throws(
    () => validateUatPromotionCrossRoleResult(changed, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_SIGNOFF_INVALID",
  );
});

test("human execution authorization is distinct from later Supervisor ingest authorization", () => {
  const result = validResult();
  assert.equal(result.execution_authorization_sha256, undefined);
  assert.match(result.human_execution_authorization_sha256, /^[0-9a-f]{64}$/u);
  const conflated = { ...result, execution_authorization_sha256: hash("later-ingest-authorization") };
  assert.throws(
    () => validateUatPromotionCrossRoleResult(conflated, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_RESULT_INVALID",
  );
});

test("expired evidence and secret-bearing shape extensions fail closed", () => {
  const expired = validResult();
  assert.throws(
    () => validateUatPromotionCrossRoleResult(expired, { template, now: new Date(instant(8000)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_RESULT_INVALID",
  );
  const extended = structuredClone(validResult());
  extended.workflows[0].steps[0].cookie = "forbidden";
  assert.throws(
    () => createUatPromotionCrossRoleResult(extended, { template, now: new Date(instant(1800)) }),
    (error) => error.code === "UAT_PROMOTION_CROSS_ROLE_STEP_EVIDENCE_INVALID",
  );
});
