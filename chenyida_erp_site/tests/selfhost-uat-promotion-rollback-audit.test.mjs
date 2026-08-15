import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  UAT_PROMOTION_AUDIT_ARTIFACT_PATH,
  UAT_PROMOTION_AUDIT_MARKDOWN_PATH,
  assertUatPromotionMayStart,
  buildUatPromotionRollbackAudit,
  canonicalJson,
  loadUatPromotionRollbackAuditInputs,
  sha256,
} from "../scripts/uat-promotion-rollback-audit.mjs";

function inputs() {
  const value = loadUatPromotionRollbackAuditInputs();
  return {
    ...value,
    policy: structuredClone(value.policy),
    inventory: structuredClone(value.inventory),
    sourceBodies: new Map(value.sourceBodies),
    rawDigests: { ...value.rawDigests },
  };
}

test("current repository audit is valid but UAT promotion remains blocked", () => {
  const result = buildUatPromotionRollbackAudit(inputs());
  assert.deepEqual(result.errors, []);
  assert.equal(result.artifact.audit_validation.result, "PASS");
  assert.equal(result.artifact.execution_readiness.status, "BLOCKED");
  assert.equal(result.artifact.execution_readiness.may_start, false);
  assert.equal(result.artifact.execution_readiness.blocking_checkpoint_count, 4);
  assert.equal(result.artifact.execution_readiness.p0_blocker_count, 3);
  assert.equal(result.artifact.execution_readiness.p1_blocker_count, 1);
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "MIGRATION_COMMIT_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "COMPOSE_DEPLOYMENT_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "POST_DEPLOY_RUNTIME_CONFIGURATION").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "POST_DEPLOY_IDENTITY").status, "SUPPORTED");
});

test("audit observes the exact Supervisor gap and TEST-only restore boundary", () => {
  const { artifact, errors } = buildUatPromotionRollbackAudit(inputs());
  assert.deepEqual(errors, []);
  assert.equal(artifact.observations.supervisor_operation_count, 28);
  assert.equal(artifact.observations.required_promotion_operation_count, 10);
  assert.deepEqual(artifact.observations.implemented_required_promotion_operations, ["BEGIN_UAT_PROMOTION", "CAPTURE_UAT_PROMOTION_SNAPSHOT", "QUIESCE_UAT_WRITERS", "AUTHORIZE_UAT_PROMOTION_MIGRATION", "RUN_UAT_PROMOTION_MIGRATION", "DEPLOY_UAT_RELEASE", "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION", "VERIFY_UAT_POSTDEPLOY_IDENTITY", "RECOVER_UAT_PROMOTION"]);
  assert.deepEqual(artifact.observations.missing_required_promotion_operations, ["ROLLBACK_UAT_RELEASE"]);
  assert.equal(artifact.observations.restore_target_policy, "TEST_ONLY");
  assert.equal(artifact.observations.migration_authorization, "SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED");
  assert.equal(artifact.observations.compose_release_image_binding, "SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT");
  assert.equal(artifact.observations.postdeploy_transaction_binding, "SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.cross_role_uat_readiness, "BLOCKED");
});

test("promotion start assertion fails closed while any checkpoint is incomplete", () => {
  const { artifact } = buildUatPromotionRollbackAudit(inputs());
  assert.throws(() => assertUatPromotionMayStart(artifact), (error) => error.code === "UAT_PROMOTION_EXECUTOR_NOT_READY");
  assert.throws(() => assertUatPromotionMayStart({ ...artifact, audit_validation: { result: "FAIL", errors: ["fixture"] } }), /UAT_PROMOTION_AUDIT_INVALID/);
});

test("policy cannot relabel a supported capability as missing", () => {
  const fixture = inputs();
  fixture.policy.capabilities.find((entry) => entry.id === "COMPOSE_DEPLOYMENT_RECEIPT").status = "MISSING";
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.includes("AUDIT_CAPABILITY_STATUS_DRIFT:COMPOSE_DEPLOYMENT_RECEIPT"));
});

test("source marker drift and cross-role readiness promotion are rejected", () => {
  const markerFixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  markerFixture.sourceBodies.set(launcherPath, markerFixture.sourceBodies.get(launcherPath).replaceAll("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", "REMOVED_POSTDEPLOY_IDENTITY"));
  assert.ok(buildUatPromotionRollbackAudit(markerFixture).errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));

  const uatFixture = inputs();
  const uatPath = "chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json";
  const uat = JSON.parse(uatFixture.sourceBodies.get(uatPath));
  uat.readiness.status = "READY";
  uatFixture.sourceBodies.set(uatPath, `${JSON.stringify(uat, null, 2)}\n`);
  const errors = buildUatPromotionRollbackAudit(uatFixture).errors;
  assert.ok(errors.includes("AUDIT_CROSS_ROLE_UAT_BOUNDARY_DRIFT"));
});

test("postdeploy transaction evidence cannot regress to standalone probes", () => {
  const fixture = inputs();
  const journalPath = "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs";
  fixture.sourceBodies.set(journalPath, fixture.sourceBodies.get(journalPath).replaceAll("UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONTRACT", "REMOVED_POSTDEPLOY_CONTAINMENT"));
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(result.errors.includes("AUDIT_POSTDEPLOY_TRANSACTION_BINDING_DRIFT"));

  const bindingFixture = inputs();
  bindingFixture.sourceBodies.set(
    journalPath,
    bindingFixture.sourceBodies.get(journalPath).replaceAll(
      "UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONTRACT", "REMOVED_POSTDEPLOY_CONTROL_BINDING",
    ),
  );
  const bindingResult = buildUatPromotionRollbackAudit(bindingFixture);
  assert.ok(bindingResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(bindingResult.errors.includes("AUDIT_POSTDEPLOY_TRANSACTION_BINDING_DRIFT"));
});

test("a declared promotion operation cannot disappear from the audited implementation", () => {
  const fixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  fixture.sourceBodies.set(launcherPath, fixture.sourceBodies.get(launcherPath).replace(
    '    "QUIESCE_UAT_WRITERS": "QUIESCE_WRITERS",\n',
    "",
  ));
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.includes("AUDIT_IMPLEMENTED_OPERATION_DRIFT:BEGIN_UAT_PROMOTION,CAPTURE_UAT_PROMOTION_SNAPSHOT,AUTHORIZE_UAT_PROMOTION_MIGRATION,RUN_UAT_PROMOTION_MIGRATION,DEPLOY_UAT_RELEASE,VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION,VERIFY_UAT_POSTDEPLOY_IDENTITY,RECOVER_UAT_PROMOTION"));
});

test("artifact is deterministic and self-digested", () => {
  const first = buildUatPromotionRollbackAudit(inputs());
  const second = buildUatPromotionRollbackAudit(inputs());
  assert.equal(canonicalJson(first.artifact), canonicalJson(second.artifact));
  const { artifact_sha256: actual, ...body } = first.artifact;
  assert.equal(actual, sha256(canonicalJson(body)));
  assert.equal(first.manifest.sha256, sha256(canonicalJson(first.manifest.files)));
});

test("committed audit artifact and Markdown are exact generator outputs", async () => {
  const result = buildUatPromotionRollbackAudit(inputs());
  const artifactRaw = await readFile(new URL(`../../${UAT_PROMOTION_AUDIT_ARTIFACT_PATH}`, import.meta.url), "utf8");
  const markdownRaw = await readFile(new URL(`../../${UAT_PROMOTION_AUDIT_MARKDOWN_PATH}`, import.meta.url), "utf8");
  assert.equal(artifactRaw, `${JSON.stringify(JSON.parse(artifactRaw), null, 2)}\n`);
  assert.equal(canonicalJson(JSON.parse(artifactRaw)), canonicalJson(result.artifact));
  assert.equal(markdownRaw, result.markdown);
});
