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
  assert.equal(result.artifact.execution_readiness.blocking_checkpoint_count, 0);
  assert.equal(result.artifact.execution_readiness.blocking_condition_count, 3);
  assert.equal(result.artifact.execution_readiness.p0_blocker_count, 2);
  assert.equal(result.artifact.execution_readiness.p1_blocker_count, 1);
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "MIGRATION_COMMIT_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "COMPOSE_DEPLOYMENT_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "POST_DEPLOY_RUNTIME_CONFIGURATION").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "POST_DEPLOY_IDENTITY").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "CROSS_ROLE_UAT_EXECUTION").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "PROMOTION_FINAL_RECEIPT").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "ROLLBACK_TO_UAT_EXECUTOR").status, "SUPPORTED");
  assert.equal(result.artifact.capabilities.find((entry) => entry.id === "ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT").status, "SUPPORTED");
  assert.deepEqual(result.artifact.execution_blockers.map((entry) => entry.id), [
    "ROLLBACK_RUNTIME_CAPABILITIES_NOT_IMPLEMENTED_OR_HOST_NOT_ACTIVATED",
    "UAT_ROLLBACK_REHEARSAL_NOT_EXECUTED",
    "HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED",
  ]);
});

test("audit observes the complete repository control plane and recoverable fail-closed runtime boundary", () => {
  const { artifact, errors } = buildUatPromotionRollbackAudit(inputs());
  assert.deepEqual(errors, []);
  assert.equal(artifact.observations.supervisor_operation_count, 35);
  assert.equal(artifact.observations.required_promotion_operation_count, 16);
  assert.deepEqual(artifact.observations.implemented_required_promotion_operations, ["BEGIN_UAT_PROMOTION", "CAPTURE_UAT_PROMOTION_SNAPSHOT", "QUIESCE_UAT_WRITERS", "AUTHORIZE_UAT_PROMOTION_MIGRATION", "RUN_UAT_PROMOTION_MIGRATION", "DEPLOY_UAT_RELEASE", "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION", "VERIFY_UAT_POSTDEPLOY_IDENTITY", "VERIFY_UAT_CROSS_ROLE_EXECUTION", "FINALIZE_UAT_PROMOTION", "ROLLBACK_UAT_RELEASE", "VERIFY_AND_FINALIZE_UAT_ROLLBACK", "RECOVER_UAT_PROMOTION", "ACTIVATE_UAT_ROLLBACK_RUNTIME_V2", "ROLLBACK_UAT_ROLLBACK_RUNTIME_V2", "RECOVER_UAT_ROLLBACK_RUNTIME_V2_ACTIVATION"]);
  assert.deepEqual(artifact.observations.missing_required_promotion_operations, []);
  assert.equal(artifact.observations.restore_target_policy, "TEST_ONLY");
  assert.equal(artifact.observations.migration_authorization, "SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED");
  assert.equal(artifact.observations.compose_release_image_binding, "SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT");
  assert.equal(artifact.observations.postdeploy_transaction_binding, "SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.cross_role_uat_transaction_binding, "SUPERVISOR_CHECKPOINT_12_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.finalization_transaction_binding, "SUPERVISOR_CHECKPOINT_13_AGGREGATED_AND_RECOVERABLE");
  assert.equal(artifact.observations.rollback_transaction_binding, "SUPERVISOR_CHECKPOINT_14_15_CONTENT_ADDRESSED_AND_RECOVERABLE");
  assert.equal(artifact.observations.rollback_runtime_adapter, "BUNDLED_FIXED_EXECUTOR_AND_RECOVERABLE_ACTIVATION_PROTOCOL_CAPABILITIES_BLOCKED_HOST_NOT_ACTIVATED");
  assert.equal(artifact.observations.rollback_rehearsal_evidence, "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT");
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

test("fixed executor fake-root fixture must remain required in the release inventory", () => {
  const fixture = inputs();
  const entry = fixture.inventory.tests.find((item) =>
    item.path === "tests/selfhost-uat-promotion-rollback-fixed-executor.test.mjs");
  assert.ok(entry);
  entry.sha256 = "0".repeat(64);
  assert.ok(buildUatPromotionRollbackAudit(fixture).errors.includes(
    "AUDIT_FIXED_EXECUTOR_RELEASE_TEST_INVALID",
  ));
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

test("cross-role checkpoint 12 cannot regress to a standalone human template", () => {
  const fixture = inputs();
  const resultContractPath = "chenyida_erp_site/scripts/uat-promotion-cross-role-evidence-contract.mjs";
  fixture.sourceBodies.set(
    resultContractPath,
    fixture.sourceBodies.get(resultContractPath).replaceAll(
      "human_execution_authorization_sha256", "REMOVED_HUMAN_EXECUTION_AUTHORIZATION",
    ),
  );
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(result.errors.includes("AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT"));

  const interlockFixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  interlockFixture.sourceBodies.set(
    launcherPath,
    interlockFixture.sourceBodies.get(launcherPath).replaceAll(
      "SUPERVISOR_UAT_PROMOTION_CROSS_ROLE_RECOVERY_REQUIRED", "REMOVED_CROSS_ROLE_INTERLOCK",
    ),
  );
  const interlockResult = buildUatPromotionRollbackAudit(interlockFixture);
  assert.ok(interlockResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(interlockResult.errors.includes("AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT"));

  const durableFixture = inputs();
  const journalPath = "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs";
  durableFixture.sourceBodies.set(
    journalPath,
    durableFixture.sourceBodies.get(journalPath).replaceAll(
      "loadDurableCrossRoleResult", "REMOVED_DURABLE_CROSS_ROLE_RESULT",
    ),
  );
  const durableResult = buildUatPromotionRollbackAudit(durableFixture);
  assert.ok(durableResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(durableResult.errors.includes("AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT"));
});

test("final receipt cannot regress without both journal and bundle-switch recovery interlocks", () => {
  const journalFixture = inputs();
  const journalPath = "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs";
  journalFixture.sourceBodies.set(
    journalPath,
    journalFixture.sourceBodies.get(journalPath).replaceAll(
      "finalizationCheckpointAggregate", "REMOVED_FINALIZATION_AGGREGATE",
    ),
  );
  assert.ok(buildUatPromotionRollbackAudit(journalFixture).errors.includes(
    "AUDIT_FINALIZATION_TRANSACTION_BINDING_DRIFT",
  ));

  const installerFixture = inputs();
  const installerPath = "chenyida_erp_site/scripts/install-release-supervisor.py";
  installerFixture.sourceBodies.set(
    installerPath,
    installerFixture.sourceBodies.get(installerPath).replaceAll(
      "SUPERVISOR_INSTALL_UAT_PROMOTION_FINALIZATION_RECOVERY_REQUIRED",
      "REMOVED_FINALIZATION_INSTALL_INTERLOCK",
    ),
  );
  const result = buildUatPromotionRollbackAudit(installerFixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(result.errors.includes("AUDIT_FINALIZATION_TRANSACTION_BINDING_DRIFT"));
});

test("rollback checkpoints cannot regress to unbound stages or lose bundle-switch interlocks", () => {
  const controlFixture = inputs();
  const controlPath = "chenyida_erp_site/scripts/uat-promotion-rollback-control.mjs";
  controlFixture.sourceBodies.set(
    controlPath,
    controlFixture.sourceBodies.get(controlPath).replaceAll(
      "runUatPromotionRollbackControl", "REMOVED_ROLLBACK_CONTROL",
    ),
  );
  const controlResult = buildUatPromotionRollbackAudit(controlFixture);
  assert.ok(controlResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(controlResult.errors.includes("AUDIT_ROLLBACK_TRANSACTION_BINDING_DRIFT"));

  const installerFixture = inputs();
  const installerPath = "chenyida_erp_site/scripts/install-release-supervisor.py";
  installerFixture.sourceBodies.set(
    installerPath,
    installerFixture.sourceBodies.get(installerPath).replaceAll(
      "SUPERVISOR_INSTALL_UAT_PROMOTION_ROLLBACK_POSTVERIFY_REQUIRED",
      "REMOVED_ROLLBACK_INSTALL_INTERLOCK",
    ),
  );
  const installerResult = buildUatPromotionRollbackAudit(installerFixture);
  assert.ok(installerResult.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
  assert.ok(installerResult.errors.includes("AUDIT_ROLLBACK_TRANSACTION_BINDING_DRIFT"));
});

test("fixed executor, v2 activation, Supervisor v7 and install interlock are all audited", () => {
  const cases = [
    [
      "chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py",
      "ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE",
      "REMOVED_FIXED_EXECUTOR_CAPABILITY_GATE",
    ],
    [
      "chenyida_erp_site/scripts/uat-promotion-rollback-runtime-activation-publisher.mjs",
      "UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN",
      "REMOVED_ACTIVATION_PARTIAL_INTERLOCK",
    ],
    [
      "chenyida_erp_site/scripts/release-supervisor-launcher.py",
      "chenyida-erp-release-supervisor-authorization/v7",
      "REMOVED_SUPERVISOR_V7_AUTHORIZATION",
    ],
    [
      "chenyida_erp_site/scripts/install-release-supervisor.py",
      "assert_no_uat_rollback_runtime_activation_interlock",
      "REMOVED_INSTALL_ACTIVATION_INTERLOCK",
    ],
  ];
  for (const [repositoryPath, marker, replacement] of cases) {
    const fixture = inputs();
    fixture.sourceBodies.set(
      repositoryPath,
      fixture.sourceBodies.get(repositoryPath).replaceAll(marker, replacement),
    );
    const result = buildUatPromotionRollbackAudit(fixture);
    assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_SOURCE_MARKER_DRIFT:")));
    assert.ok(result.errors.includes("AUDIT_ROLLBACK_RUNTIME_BOUNDARY_DRIFT"));
  }
});

test("a declared promotion operation cannot disappear from the audited implementation", () => {
  const fixture = inputs();
  const launcherPath = "chenyida_erp_site/scripts/release-supervisor-launcher.py";
  fixture.sourceBodies.set(launcherPath, fixture.sourceBodies.get(launcherPath).replace(
    '    "QUIESCE_UAT_WRITERS": "QUIESCE_WRITERS",\n',
    "",
  ));
  const result = buildUatPromotionRollbackAudit(fixture);
  assert.ok(result.errors.some((entry) => entry.startsWith("AUDIT_IMPLEMENTED_OPERATION_DRIFT:")
    && entry.includes("ROLLBACK_UAT_RELEASE") && entry.includes("VERIFY_AND_FINALIZE_UAT_ROLLBACK")));
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
