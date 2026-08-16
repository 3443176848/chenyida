import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalClusterJson } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  UAT_ROLLBACK_EXECUTION_STAGES,
  UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG,
  UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256,
  UAT_ROLLBACK_POSTVERIFY_CHECKS,
  UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE,
  UAT_ROLLBACK_RUNTIME_CURRENT_FILE,
  UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE,
  UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE,
  UAT_ROLLBACK_RUNTIME_STATE_ROOT,
  UAT_ROLLBACK_ZERO_SHA256,
  createUatRollbackRuntimeActivationIntent,
  createUatRollbackRuntimeActivationObjects,
  fixedUatRollbackHandler,
  uatRollbackFixedExecutorIdempotencyKey,
  validateUatRollbackFixedExecutorCatalog,
  validateUatRollbackRuntimeActivationAlias,
} from "../scripts/uat-promotion-rollback-fixed-executor-contract.mjs";
import {
  UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_CONTRACT,
  executeUatRollbackRuntimeActivation,
  prepareUatRollbackRuntimeActivation,
} from "../scripts/uat-promotion-rollback-runtime-activation-publisher.mjs";
import {
  UAT_PROMOTION_ROLLBACK_RUNTIME_DOCKER,
  UAT_PROMOTION_ROLLBACK_RUNTIME_COMPOSE_PLUGIN,
  UAT_PROMOTION_ROLLBACK_RUNTIME_EXECUTOR,
  createUatPromotionRollbackReconciliationAuthority,
  createUatPromotionRollbackRuntimePlan,
} from "../scripts/uat-promotion-rollback-runtime-contract.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const image = (name) => `registry.example.com/chenyida/${name}@sha256:${digest(`image:${name}`)}`;
const sourceExecutor = new URL("../scripts/uat-promotion-rollback-fixed-executor.py", import.meta.url);

function runtimePlan(operationId, executorSha256) {
  return createUatPromotionRollbackRuntimePlan({
    promotion_id: "promotion-fixed-executor-001",
    promotion_generation: 1,
    rollback_operation_id: operationId,
    deployment: {
      class: "UAT", id: "chenyida-erp", compose_project: "chenyida-erp",
      compose_project_root: "/opt/erp/chenyida_erp_site",
      database: {
        name: "chenyida_erp", system_identifier: "7612345678901234567", oid: "16384",
        marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
      },
    },
    candidate: {
      services: Object.fromEntries(["caddy", "postgres", "web", "worker"].map((service) => [service, {
        service, container_id: digest(`container:${service}`), image_reference: image(service),
        image_digest: `sha256:${digest(`digest:${service}`)}`,
      }])),
      volumes: Object.fromEntries(["uploads", "attachments", "backup_status"].map((domain) => [domain, {
        domain, name: `chenyida-erp_erp_${domain}`, identity_sha256: digest(`volume:${domain}`),
      }])),
      protected_resources_sha256: digest("protected-resources"),
    },
    predecessor: {
      release_manifest_sha256: digest("predecessor-manifest"),
      postdeploy_receipt_sha256: digest("predecessor-receipt"),
      runtime_configuration_sha256: digest("predecessor-runtime"),
      web_image: image("predecessor-web"),
      web_image_config_digest: `sha256:${digest("predecessor-web-config")}`,
      worker_image: image("predecessor-worker"),
      worker_image_config_digest: `sha256:${digest("predecessor-worker-config")}`,
    },
    reconciliation_authority: createUatPromotionRollbackReconciliationAuthority({
      authority_id: `reconciliation-${operationId}`,
      promotion_id: "promotion-fixed-executor-001", promotion_generation: 1,
      rollback_operation_id: operationId,
      approval_reference_sha256: digest(`approval:${operationId}`),
      requester_identity_sha256: digest(`requester:${operationId}`),
      approver_identity_sha256: digest(`approver:${operationId}`),
      approved_at: "2026-08-15T03:00:00.000Z", expires_at: "2026-08-16T03:00:00.000Z",
    }),
    toolchain: {
      executor: {
        path: UAT_PROMOTION_ROLLBACK_RUNTIME_EXECUTOR,
        sha256: executorSha256, uid: 0, gid: 0, mode: "0555",
      },
      docker: {
        path: UAT_PROMOTION_ROLLBACK_RUNTIME_DOCKER,
        sha256: digest("docker-binary"), uid: 0, gid: 0, mode: "0755",
      },
      compose_plugin: {
        path: UAT_PROMOTION_ROLLBACK_RUNTIME_COMPOSE_PLUGIN,
        sha256: digest("compose-plugin-binary"), uid: 0, gid: 0, mode: "0755",
      },
    },
    helpers: {
      volume_restore: {
        image_reference: image("volume-restore-helper"),
        image_config_digest: `sha256:${digest("volume-restore-helper-config")}`,
        application_version: "0.1.0-alpha.47",
        git_commit: "1".repeat(40), git_tree: "2".repeat(40),
        image_role: "volume-restore-helper", platform: "linux/amd64",
        protocol: "chenyida-erp-volume-helper/v1",
        contract_sha256: "143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d",
        evidence_run_id: "helper-evidence-fixture",
        backup_status_reader_gid: 1000,
        build_provenance_sha256: digest("helper-build-provenance"),
        sbom_evidence_sha256: digest("helper-sbom-evidence"),
        security_evidence_sha256: digest("helper-security-evidence"),
        supervisor_bundle_sha256: digest("helper-supervisor-bundle"),
      },
    },
    source_bindings: {
      snapshot_objects_sha256: digest("snapshot-objects"),
      snapshot_reconciliation_sha256: digest("snapshot-reconciliation"),
      snapshot_manifest_sha256: digest("snapshot-manifest"),
      snapshot_policy_sha256: digest("snapshot-policy"),
      runtime_privilege_access_sha256: digest("runtime-privilege-access"),
      runtime_privilege_compiled_catalog_sha256:
        digest("runtime-privilege-compiled-catalog"),
      runtime_privilege_policy_sha256: digest("runtime-privilege-policy"),
      runtime_privilege_operator_policy_sha256: digest("runtime-privilege-operator-policy"),
      deployment_environment_sha256: digest("deployment-environment"),
      compose_file_sha256: digest("compose-file"),
      compose_release_file_sha256: digest("compose-release-file"),
      runtime_policy_sha256: digest("runtime-policy"),
    },
  });
}

function physical(root, logical) { return path.join(root, logical.slice(1)); }

async function trustedParents(root, bundleSha256) {
  for (const directory of [
    "/usr", "/usr/local", "/usr/local/libexec",
    "/usr/local/libexec/chenyida-erp-release-supervisor",
    "/usr/local/libexec/chenyida-erp-release-supervisor/bundles",
    `/usr/local/libexec/chenyida-erp-release-supervisor/bundles/${bundleSha256}`,
    `/usr/local/libexec/chenyida-erp-release-supervisor/bundles/${bundleSha256}/chenyida_erp_site`,
    `/usr/local/libexec/chenyida-erp-release-supervisor/bundles/${bundleSha256}/chenyida_erp_site/scripts`,
    "/var", "/var/lib", "/var/lib/chenyida-erp-release-supervisor",
  ]) {
    await mkdir(physical(root, directory), { recursive: true, mode: 0o755 });
    await chmod(physical(root, directory), 0o755);
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "uat-rollback-runtime-activation-"));
  const bundleSha256 = digest(`bundle:${root}`);
  await trustedParents(root, bundleSha256);
  const sourceLogical = `/usr/local/libexec/chenyida-erp-release-supervisor/bundles/${bundleSha256}/${UAT_ROLLBACK_RUNTIME_EXECUTOR_SOURCE}`;
  const sourcePhysical = physical(root, sourceLogical);
  await copyFile(sourceExecutor, sourcePhysical);
  await chmod(sourcePhysical, 0o555);
  const raw = await readFile(sourcePhysical);
  const metadata = await lstat(sourcePhysical);
  const operationId = "rollback-runtime-activation-001";
  const plan = runtimePlan(operationId, digest(raw));
  const parameters = {
    state_root: UAT_ROLLBACK_RUNTIME_STATE_ROOT,
    activation_file: UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE,
    current_file: UAT_ROLLBACK_RUNTIME_CURRENT_FILE,
    executor_file: UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE,
    activation_id: operationId,
    generation: 1,
    operation: "INSTALL",
    approved_at: "2026-08-15T03:00:00.000Z",
    expires_at: "2026-08-15T04:00:00.000Z",
    requester_identity_sha256: digest("activation-requester"),
    approver_identity_sha256: digest("activation-approver"),
    previous_activation_receipt_sha256: UAT_ROLLBACK_ZERO_SHA256,
    rollback_target_activation_receipt_sha256: UAT_ROLLBACK_ZERO_SHA256,
    executor_source: {
      path: sourceLogical, sha256: digest(raw), bytes: raw.length,
      uid: metadata.uid, gid: metadata.gid, mode: "0555", nlink: metadata.nlink,
    },
    plan,
  };
  const authorizationSha256 = digest(`authorization:${operationId}`);
  const context = {
    schema_version: 2,
    contract: UAT_ROLLBACK_RUNTIME_ACTIVATION_CONTEXT_CONTRACT,
    operation_id: operationId,
    execution_mode: "ORIGINAL",
    execution_authorization_id: operationId,
    execution_created_at: "2026-08-15T03:00:00.000Z",
    execution_authorization_sha256: authorizationSha256,
    original_authorization_sha256: authorizationSha256,
    supervisor_bundle_sha256: bundleSha256,
    expected_intent_sha256: null,
    parameters,
  };
  return { root, bundleSha256, raw, context };
}

function nextContext(previous, alias, { operation = "UPGRADE", suffix = "upgrade" } = {}) {
  const operationId = `${previous.operation_id}-${suffix}`;
  const authorizationSha256 = digest(`authorization:${operationId}`);
  return {
    ...structuredClone(previous),
    operation_id: operationId,
    execution_authorization_id: operationId,
    execution_authorization_sha256: authorizationSha256,
    original_authorization_sha256: authorizationSha256,
    parameters: {
      ...structuredClone(previous.parameters),
      activation_id: operationId,
      generation: alias.generation + 1,
      operation,
      previous_activation_receipt_sha256: alias.receipt_sha256,
      rollback_target_activation_receipt_sha256: UAT_ROLLBACK_ZERO_SHA256,
    },
  };
}

function recoveryContext(original, intentSha256) {
  return {
    ...structuredClone(original),
    execution_mode: "RECOVERY",
    execution_authorization_id: `${original.operation_id}-recovery`,
    execution_created_at: "2026-08-15T03:05:00.000Z",
    execution_authorization_sha256: digest(`recovery:${original.operation_id}`),
    expected_intent_sha256: intentSha256,
  };
}

async function readAlias(root) {
  return JSON.parse(await readFile(physical(root, UAT_ROLLBACK_RUNTIME_ACTIVATION_FILE), "utf8"));
}

test("fixed catalog is an exact 9-stage/13-check closed set with no TEST restore dispatch", () => {
  assert.equal(validateUatRollbackFixedExecutorCatalog(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG),
    UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG);
  assert.equal(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_SHA256.length, 64);
  assert.deepEqual(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.stages, UAT_ROLLBACK_EXECUTION_STAGES);
  assert.deepEqual(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.checks, UAT_ROLLBACK_POSTVERIFY_CHECKS);
  assert.equal(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.handlers.length, 22);
  assert.equal(new Set(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.handlers.map((entry) => entry.handler_id)).size, 22);
  for (const label of UAT_ROLLBACK_EXECUTION_STAGES) {
    for (const action of ["PREPARE", "EXECUTE", "PROBE"]) {
      assert.equal(fixedUatRollbackHandler("ROLLBACK_EXECUTION", label, action).label, label);
    }
  }
  for (const label of UAT_ROLLBACK_POSTVERIFY_CHECKS) {
    for (const action of ["PREPARE", "PROBE"]) {
      assert.equal(fixedUatRollbackHandler("ROLLBACK_POSTVERIFY", label, action).label, label);
    }
  }
  assert.equal(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.capability_status,
    "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS");
  assert.ok(UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.forbidden_tools.every((tool) =>
    !UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG.handlers.some((entry) => entry.argv_template.includes(tool))));
});

test("fixed handler idempotency is isolated by action and execution mode", () => {
  const request = {
    operation: "ROLLBACK_EXECUTION",
    operation_id: "rollback-idempotency-001",
    execution_mode: "ORIGINAL",
    action: "PREPARE",
    label: "POSTGRESQL_RESTORE",
    record_intent_sha256: digest("record-intent"),
    runtime_plan_sha256: digest("runtime-plan"),
    previous_result_sha256: UAT_ROLLBACK_ZERO_SHA256,
  };
  const prepared = uatRollbackFixedExecutorIdempotencyKey(request);
  const executed = uatRollbackFixedExecutorIdempotencyKey({ ...request, action: "EXECUTE" });
  const probed = uatRollbackFixedExecutorIdempotencyKey({ ...request, action: "PROBE" });
  const recovered = uatRollbackFixedExecutorIdempotencyKey({
    ...request, execution_mode: "RECOVERY", action: "PROBE",
  });
  assert.equal(new Set([prepared, executed, probed, recovered]).size, 4);
});

test("activation objects bind plan, executor, actors, generation, and every immutable digest", async () => {
  const value = await fixture();
  try {
    const intent = createUatRollbackRuntimeActivationIntent({
      ...value.context.parameters,
      supervisor_bundle_sha256: value.bundleSha256,
      authorization_sha256: value.context.original_authorization_sha256,
      executor_source_sha256: digest(value.raw),
    });
    const objects = createUatRollbackRuntimeActivationObjects(intent, intent.approved_at);
    assert.equal(validateUatRollbackRuntimeActivationAlias(objects.alias), objects.alias);
    assert.equal(objects.alias.status, "BLOCKED_CAPABILITY_UNAVAILABLE");
    assert.throws(() => validateUatRollbackRuntimeActivationAlias({
      ...objects.alias, current_sha256: digest("substituted-current"),
    }), /UAT_ROLLBACK_RUNTIME_ACTIVATION_INVALID/);
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("production prepare fails before creating activation state while required UAT handlers are absent", async () => {
  const value = await fixture();
  try {
    const result = await prepareUatRollbackRuntimeActivation(value.context, { filesystemRoot: value.root });
    assert.equal(result.result, "BLOCKED_CAPABILITY_UNAVAILABLE");
    await assert.rejects(lstat(physical(value.root, UAT_ROLLBACK_RUNTIME_STATE_ROOT)), /ENOENT/);
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("fake-root install, upgrade, and rollback append generations without overwriting history", async () => {
  const value = await fixture();
  try {
    const firstPrepared = await prepareUatRollbackRuntimeActivation(value.context, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    assert.equal(firstPrepared.result, "PREPARED");
    const first = await executeUatRollbackRuntimeActivation(value.context, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    assert.equal(first.result, "COMMITTED");
    const alias1 = validateUatRollbackRuntimeActivationAlias(await readAlias(value.root));
    const upgradeContext = nextContext(value.context, alias1);
    await prepareUatRollbackRuntimeActivation(upgradeContext, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    await executeUatRollbackRuntimeActivation(upgradeContext, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    const alias2 = validateUatRollbackRuntimeActivationAlias(await readAlias(value.root));
    assert.equal(alias2.generation, 2);
    assert.equal(alias2.previous_activation_receipt_sha256, alias1.receipt_sha256);
    const rollbackContext = nextContext(upgradeContext, alias2, { operation: "ROLLBACK", suffix: "rollback" });
    rollbackContext.parameters.rollback_target_activation_receipt_sha256 = alias1.receipt_sha256;
    await prepareUatRollbackRuntimeActivation(rollbackContext, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    await executeUatRollbackRuntimeActivation(rollbackContext, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    const alias3 = validateUatRollbackRuntimeActivationAlias(await readAlias(value.root));
    assert.equal(alias3.generation, 3);
    assert.equal(alias3.operation, "ROLLBACK");
    assert.equal(alias3.rollback_target_activation_receipt_sha256, alias1.receipt_sha256);
    for (const alias of [alias1, alias2, alias3]) {
      assert.equal((await lstat(physical(value.root, alias.history_file))).mode & 0o777, 0o400);
      assert.equal((await lstat(physical(value.root, alias.receipt_file))).mode & 0o777, 0o400);
    }
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

for (const failpoint of [
  "AFTER_EXECUTOR_CONTENT", "AFTER_PLAN_CONTENT", "AFTER_HISTORY", "AFTER_EXECUTOR_ALIAS",
  "AFTER_RECEIPT", "AFTER_CURRENT", "AFTER_ACTIVATION_ALIAS",
]) {
  test(`known ${failpoint} crash is resumed only by the exact recovery intent`, async () => {
    const value = await fixture();
    try {
      const prepared = await prepareUatRollbackRuntimeActivation(value.context, {
        filesystemRoot: value.root, allowBlockedFixture: true,
      });
      await assert.rejects(executeUatRollbackRuntimeActivation(value.context, {
        filesystemRoot: value.root,
        allowBlockedFixture: true,
        fault: async (point) => { if (point === failpoint) throw new Error(`fault:${point}`); },
      }), new RegExp(`fault:${failpoint}`));
      const recovery = recoveryContext(value.context, prepared.intent_sha256);
      const recoveryPrepared = await prepareUatRollbackRuntimeActivation(recovery, {
        filesystemRoot: value.root, allowBlockedFixture: true,
      });
      assert.equal(recoveryPrepared.result, "RECOVERY_PREPARED");
      const recoveryRecord = JSON.parse(await readFile(physical(value.root,
        `${UAT_ROLLBACK_RUNTIME_STATE_ROOT}/recoveries/${recovery.execution_authorization_id}`
          + `.${recoveryPrepared.recovery_sha256}.json`), "utf8"));
      assert.equal(recoveryRecord.recovery_authorization_sha256,
        recovery.execution_authorization_sha256);
      assert.equal(recoveryRecord.original_authorization_sha256,
        recovery.original_authorization_sha256);
      const completed = await executeUatRollbackRuntimeActivation(recovery, {
        filesystemRoot: value.root, allowBlockedFixture: true,
      });
      assert.ok(new Set(["COMMITTED", "ALREADY_COMMITTED"]).has(completed.result));
      assert.equal(completed.recovery_sha256, recoveryPrepared.recovery_sha256);
      validateUatRollbackRuntimeActivationAlias(await readAlias(value.root));
    } finally { await rm(value.root, { recursive: true, force: true }); }
  });
}

test("foreign executor alias is preserved and blocks fake-root publication", async () => {
  const value = await fixture();
  try {
    await prepareUatRollbackRuntimeActivation(value.context, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    });
    const executor = physical(value.root, UAT_ROLLBACK_RUNTIME_EXECUTOR_FILE);
    await writeFile(executor, "foreign-executor\n", { mode: 0o555 });
    await chmod(executor, 0o555);
    await assert.rejects(executeUatRollbackRuntimeActivation(value.context, {
      filesystemRoot: value.root, allowBlockedFixture: true,
    }), /UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN/);
    assert.equal(await readFile(executor, "utf8"), "foreign-executor\n");
  } finally { await rm(value.root, { recursive: true, force: true }); }
});
