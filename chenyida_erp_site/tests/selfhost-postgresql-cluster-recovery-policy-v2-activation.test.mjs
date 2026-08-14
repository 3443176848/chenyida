import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  RELEASE_IDENTITY_CONTRACT,
  RELEASE_IDENTITY_ROOT_MARKER,
  RELEASE_IDENTITY_ROOT_MARKER_VALUE,
} from "../scripts/release-identity-contract.mjs";
import {
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  RELEASE_RUNTIME_POLICY_SHA256,
  runtimeGuardBinding,
} from "../scripts/release-lifecycle-contract.mjs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalClusterJson,
  clusterSha256,
} from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  clusterRecoveryPolicyV2Sha256,
  validateClusterRecoveryPolicyV2,
  ZERO_SHA256,
} from "../scripts/postgresql-cluster-recovery-policy-v2-contract.mjs";
import {
  CLUSTER_POLICY_ACTIVATION_CURRENT_FILE,
  CLUSTER_POLICY_ACTIVATION_STATE_ROOT,
  CLUSTER_POLICY_TARGET_FILE,
  CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256,
  CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256,
  createClusterRecoveryPolicyActivationEvidence,
  validateClusterRecoveryPolicyActivationEvidence,
  validateClusterRecoveryPolicyActivationReceipt,
} from "../scripts/postgresql-cluster-recovery-policy-v2-activation-contract.mjs";
import {
  CLUSTER_POLICY_ACTIVATION_CONTEXT_CONTRACT,
  readCommittedClusterPolicyActivation,
  runClusterPolicyActivationPhase,
  validateClusterPolicyActivationContext,
} from "../scripts/postgresql-cluster-recovery-policy-v2-publisher.mjs";

const siteRoot = path.resolve(new URL("../", import.meta.url).pathname);
const releaseIdentityFile = "/var/lib/chenyida-erp/release-identity/release-identity.json";
const templateRaw = await readFile(new URL("../operations/postgresql-cluster-recovery-policy-v2.json", import.meta.url));
const template = validateClusterRecoveryPolicyV2(JSON.parse(templateRaw.toString("utf8")));

function digest(label) {
  return createHash("sha256").update(label).digest("hex");
}

function physical(root, logical) {
  return path.join(root, logical.slice(1));
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-cluster-policy-activation-"));
  await mkdir(physical(root, "/var/lib/chenyida-erp"), { recursive: true, mode: 0o755 });
  await mkdir(physical(root, "/etc/chenyida-erp"), { recursive: true, mode: 0o755 });
  const identityRoot = physical(root, "/var/lib/chenyida-erp/release-identity");
  await mkdir(identityRoot, { mode: 0o750 });
  await writeFile(path.join(identityRoot, RELEASE_IDENTITY_ROOT_MARKER), RELEASE_IDENTITY_ROOT_MARKER_VALUE, { mode: 0o440 });
  await chmod(path.join(identityRoot, RELEASE_IDENTITY_ROOT_MARKER), 0o440);
  const identity = {
    schema_version: 3,
    contract: RELEASE_IDENTITY_CONTRACT,
    deployment_class: "UAT",
    deployment_id: "chenyida-erp-uat",
    release_id: "fixture-alpha47",
    release_manifest_sha256: digest("release-manifest"),
    postdeploy_receipt_sha256: digest("postdeploy-receipt"),
    supervisor_bundle_sha256: digest("release-supervisor-bundle"),
    authorization_sha256: digest("release-authorization"),
    runtime_guard: runtimeGuardBinding(POST_DEPLOY_RUNTIME_GUARD_MODE),
    runtime_policy_sha256: RELEASE_RUNTIME_POLICY_SHA256,
    application_version: "0.1.0-alpha.47",
    git_commit: "a".repeat(40),
    git_tree: "b".repeat(40),
    migration_head: "0046_runtime_lock_privilege_boundary.sql",
    migration_manifest_sha256: digest("migration-manifest"),
    caddy_container_id: "1".repeat(64),
    caddy_image_digest: `sha256:${"1".repeat(64)}`,
    postgres_container_id: "2".repeat(64),
    postgres_image_digest: `sha256:${"2".repeat(64)}`,
    web_container_id: "3".repeat(64),
    web_image_digest: `sha256:${"3".repeat(64)}`,
    worker_container_id: "4".repeat(64),
    worker_image_digest: `sha256:${"4".repeat(64)}`,
    generated_at: "2026-08-14T23:00:00.000Z",
  };
  await writeFile(physical(root, releaseIdentityFile), canonicalClusterJson(identity), { mode: 0o440 });
  await chmod(physical(root, releaseIdentityFile), 0o440);
  releaseIdentitySources.set(root, await source(root, releaseIdentityFile, "0440"));
  return root;
}

const releaseIdentitySources = new Map();

async function source(root, logical, mode) {
  const file = physical(root, logical);
  const [raw, metadata] = await Promise.all([readFile(file), lstat(file, { bigint: true })]);
  return Object.freeze({
    path: logical,
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.length,
    device: String(metadata.dev),
    inode: String(metadata.ino),
    uid: Number(metadata.uid),
    gid: Number(metadata.gid),
    mode,
    nlink: Number(metadata.nlink),
  });
}

function times(generation) {
  const hour = String(generation).padStart(2, "0");
  return {
    activatedAt: `2026-08-15T${hour}:00:00.000Z`,
    expiresAt: "2026-08-16T00:00:00.000Z",
  };
}

function originalContext({
  operation = "ACTIVATE",
  generation = 1,
  environment = "UAT",
  previousPolicySha256 = ZERO_SHA256,
  previousReceiptSha256 = ZERO_SHA256,
  currentPolicySource = null,
  currentActivationSource = null,
  rollbackTargetSource = null,
  rpoHours = 24,
  rtoMinutes = 120,
  targetDisposition = "DESTROY_AFTER_EVIDENCE",
  bundleSha256 = digest("supervisor-bundle-v1"),
  operationId = `${operation.toLowerCase()}-cluster-policy-${generation}`,
  releaseIdentitySource = {
    path: releaseIdentityFile, sha256: digest("release-identity-placeholder"), bytes: 2,
    device: "1", inode: "1", uid: 0, gid: 0, mode: "0440", nlink: 1,
  },
} = {}) {
  const { activatedAt, expiresAt } = times(generation);
  const authorizationSha256 = digest(`authorization-${operationId}`);
  return Object.freeze({
    schema_version: 1,
    contract: CLUSTER_POLICY_ACTIVATION_CONTEXT_CONTRACT,
    operation_id: operationId,
    operation,
    execution_mode: "ORIGINAL",
    execution_authorization_id: operationId,
    execution_authorization_sha256: authorizationSha256,
    execution_created_at: activatedAt,
    original_authorization_sha256: authorizationSha256,
    supervisor_bundle_sha256: bundleSha256,
    expected_intent_sha256: null,
    parameters: {
      policy_state_root: CLUSTER_POLICY_ACTIVATION_STATE_ROOT,
      policy_target: CLUSTER_POLICY_TARGET_FILE,
      activation_id: operationId,
      environment,
      policy_generation: generation,
      previous_policy_sha256: previousPolicySha256,
      previous_activation_receipt_sha256: previousReceiptSha256,
      template_file_sha256: CLUSTER_POLICY_V2_TEMPLATE_FILE_SHA256,
      template_policy_sha256: CLUSTER_POLICY_V2_TEMPLATE_POLICY_SHA256,
      approval_reference_sha256: digest(`approval-${operationId}`),
      responsible_operator_identity_sha256: digest(`operator-${operationId}`),
      approver_identity_sha256: digest(`approver-${operationId}`),
      rpo_hours: rpoHours,
      rto_minutes: rtoMinutes,
      target_disposition: targetDisposition,
      activated_at: activatedAt,
      policy_expires_at: expiresAt,
      release_identity_source: releaseIdentitySource,
      current_policy_source: currentPolicySource,
      current_activation_source: currentActivationSource,
      rollback_target_source: rollbackTargetSource,
    },
  });
}

function context(root, options = {}) {
  return originalContext({ releaseIdentitySource: releaseIdentitySources.get(root), ...options });
}

function recoveryContext(original, intentSha256, suffix = "recovery") {
  const executionAuthorizationId = `${original.operation_id}-${suffix}`;
  return Object.freeze({
    ...original,
    execution_mode: "RECOVERY",
    execution_authorization_id: executionAuthorizationId,
    execution_authorization_sha256: digest(`authorization-${executionAuthorizationId}`),
    execution_created_at: original.parameters.activated_at.replace(":00:00.000Z", ":05:00.000Z"),
    expected_intent_sha256: intentSha256,
  });
}

async function activate(root, context, options = {}) {
  const prepared = await runClusterPolicyActivationPhase(context, "prepare", { filesystemRoot: root, siteRoot, ...options });
  const committed = await runClusterPolicyActivationPhase(context, "execute", { filesystemRoot: root, siteRoot, ...options });
  return { prepared, committed };
}

async function current(root) {
  const policy = JSON.parse(await readFile(physical(root, CLUSTER_POLICY_TARGET_FILE), "utf8"));
  const receipt = JSON.parse(await readFile(physical(root, CLUSTER_POLICY_ACTIVATION_CURRENT_FILE), "utf8"));
  validateClusterRecoveryPolicyActivationReceipt(receipt, policy);
  return { policy, receipt };
}

async function nextActivation(root, generation, overrides = {}) {
  const previous = await current(root);
  return originalContext({
    generation,
    releaseIdentitySource: releaseIdentitySources.get(root),
    previousPolicySha256: previous.receipt.policy_sha256,
    previousReceiptSha256: previous.receipt.receipt_sha256,
    currentPolicySource: await source(root, CLUSTER_POLICY_TARGET_FILE, "0440"),
    currentActivationSource: await source(root, CLUSTER_POLICY_ACTIVATION_CURRENT_FILE, "0400"),
    ...overrides,
  });
}

test("content-addressed activation commits canonical policy and independent receipt atomically and idempotently", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const activation = context(root);
  const prepared = await runClusterPolicyActivationPhase(activation, "prepare", { filesystemRoot: root, siteRoot });
  await assert.rejects(readFile(physical(root, CLUSTER_POLICY_TARGET_FILE)), { code: "ENOENT" });
  const committed = await runClusterPolicyActivationPhase(activation, "execute", { filesystemRoot: root, siteRoot });
  assert.equal(prepared.result, "PREPARED");
  assert.equal(committed.result, "COMMITTED");

  const { policy, receipt } = await current(root);
  assert.equal(receipt.policy_sha256, clusterRecoveryPolicyV2Sha256(policy));
  assert.equal(receipt.receipt_sha256, committed.receipt_sha256);
  assert.equal(receipt.generation, 1);
  assert.equal((await lstat(physical(root, CLUSTER_POLICY_TARGET_FILE))).mode & 0o7777, 0o440);
  assert.equal((await lstat(physical(root, CLUSTER_POLICY_ACTIVATION_CURRENT_FILE))).mode & 0o7777, 0o400);
  const history = await readdir(physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/history`));
  const receipts = await readdir(physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/receipts`));
  assert.deepEqual(history, [`0000000000000001.${receipt.policy_sha256}.json`]);
  assert.deepEqual(receipts, [`0000000000000001.${receipt.receipt_sha256}.json`]);
  const evidence = createClusterRecoveryPolicyActivationEvidence(receipt, policy);
  assert.deepEqual(validateClusterRecoveryPolicyActivationEvidence(evidence, policy), evidence);
  assert.deepEqual(await readCommittedClusterPolicyActivation(policy, { filesystemRoot: root }), { policy, receipt });
  const intentsRoot = physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/intents`);
  const [committedIntentName] = await readdir(intentsRoot);
  const committedIntentSha256 = committedIntentName.match(/\.([0-9a-f]{64})\.json$/u)[1];
  const renamedIntentName = `renamed-committed-operation.${committedIntentSha256}.json`;
  await rename(path.join(intentsRoot, committedIntentName), path.join(intentsRoot, renamedIntentName));
  await assert.rejects(
    readCommittedClusterPolicyActivation(policy, { filesystemRoot: root }),
    (error) => error.code === "CLUSTER_POLICY_ACTIVATION_UNRESOLVED_INTENT",
  );
  await rename(path.join(intentsRoot, renamedIntentName), path.join(intentsRoot, committedIntentName));
  assert.deepEqual(await readCommittedClusterPolicyActivation(policy, { filesystemRoot: root }), { policy, receipt });
  const removedIntent = path.join(root, "committed-intent.removed");
  await rename(path.join(intentsRoot, committedIntentName), removedIntent);
  await assert.rejects(
    readCommittedClusterPolicyActivation(policy, { filesystemRoot: root }),
    (error) => error.code === "CLUSTER_POLICY_ACTIVATION_UNRESOLVED_INTENT",
  );
  await rename(removedIntent, path.join(intentsRoot, committedIntentName));
  assert.equal((await runClusterPolicyActivationPhase(activation, "execute", { filesystemRoot: root, siteRoot })).result, "ALREADY_COMMITTED");
  const pending = await nextActivation(root, 2, { operationId: "activate-uncommitted-generation-2" });
  await runClusterPolicyActivationPhase(pending, "prepare", { filesystemRoot: root, siteRoot });
  await assert.rejects(
    readCommittedClusterPolicyActivation(policy, { filesystemRoot: root }),
    (error) => error.code === "CLUSTER_POLICY_ACTIVATION_UNRESOLVED_INTENT",
  );
});

test("generation advances one step and rollback restores only the exact immediately prior committed controls", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await activate(root, context(root));
  const generation1 = await current(root);
  await activate(root, await nextActivation(root, 2, { rpoHours: 12, rtoMinutes: 60 }));
  const generation2 = await current(root);
  const rollbackLogical = `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/receipts/0000000000000001.${generation1.receipt.receipt_sha256}.json`;
  const rollback = await nextActivation(root, 3, {
    operation: "ROLLBACK",
    operationId: "rollback-cluster-policy-3",
    rpoHours: generation1.receipt.rpo_hours,
    rtoMinutes: generation1.receipt.rto_minutes,
    targetDisposition: generation1.receipt.target_disposition,
    rollbackTargetSource: await source(root, rollbackLogical, "0400"),
  });
  await activate(root, rollback);
  const generation3 = await current(root);
  assert.equal(generation3.receipt.operation, "ROLLBACK");
  assert.equal(generation3.receipt.generation, 3);
  assert.equal(generation3.receipt.previous_policy_sha256, generation2.receipt.policy_sha256);
  assert.equal(generation3.receipt.rollback_target_activation_receipt_sha256, generation1.receipt.receipt_sha256);
  assert.equal(generation3.policy.activation.rpo_hours, generation1.policy.activation.rpo_hours);
  assert.equal(generation3.policy.activation.rto_minutes, generation1.policy.activation.rto_minutes);
  assert.notEqual(generation3.receipt.policy_sha256, generation1.receipt.policy_sha256);
});

test("every durable publication boundary resumes under a distinct recovery authorization", async (t) => {
  for (const stage of ["AFTER_HISTORY", "AFTER_TARGET", "AFTER_RECEIPT", "AFTER_CURRENT"]) {
    await t.test(stage, async (subtest) => {
      const root = await fixture();
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const activation = context(root, { operationId: `activate-fault-${stage.toLowerCase()}` });
      const prepared = await runClusterPolicyActivationPhase(activation, "prepare", { filesystemRoot: root, siteRoot });
      await assert.rejects(
        runClusterPolicyActivationPhase(activation, "execute", {
          filesystemRoot: root,
          siteRoot,
          fault: async (boundary) => { if (boundary === stage) throw new Error(`FAULT_${stage}`); },
        }),
        new RegExp(`FAULT_${stage}`),
      );
      const recovery = recoveryContext(activation, prepared.intent_sha256, stage.toLowerCase());
      const recoveryPrepared = await runClusterPolicyActivationPhase(recovery, "recover-prepare", { filesystemRoot: root, siteRoot });
      assert.equal(recoveryPrepared.decision, stage === "AFTER_CURRENT" ? "ALREADY_COMMITTED" : "RESUME_PUBLICATION");
      const recovered = await runClusterPolicyActivationPhase(recovery, "recover-execute", { filesystemRoot: root, siteRoot });
      assert.ok(new Set(["COMMITTED", "ALREADY_COMMITTED"]).has(recovered.result));
      assert.equal((await current(root)).receipt.receipt_sha256, prepared.receipt_sha256);
    });
  }
});

test("inconsistent partial publication is preserved and quarantined without automatic deletion", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const activation = context(root, { operationId: "activate-inconsistent-partial" });
  const prepared = await runClusterPolicyActivationPhase(activation, "prepare", { filesystemRoot: root, siteRoot });
  await assert.rejects(
    runClusterPolicyActivationPhase(activation, "execute", {
      filesystemRoot: root,
      siteRoot,
      fault: async (boundary) => { if (boundary === "AFTER_HISTORY") throw new Error("FAULT_AFTER_HISTORY"); },
    }),
    /FAULT_AFTER_HISTORY/u,
  );
  const target = physical(root, CLUSTER_POLICY_TARGET_FILE);
  await writeFile(target, templateRaw, { flag: "wx", mode: 0o440 });
  await chmod(target, 0o440);
  const recovery = recoveryContext(activation, prepared.intent_sha256, "quarantine");
  const plan = await runClusterPolicyActivationPhase(recovery, "recover-prepare", { filesystemRoot: root, siteRoot });
  assert.equal(plan.decision, "QUARANTINE");
  const result = await runClusterPolicyActivationPhase(recovery, "recover-execute", { filesystemRoot: root, siteRoot });
  assert.equal(result.result, "QUARANTINED");
  assert.deepEqual(await readFile(target), templateRaw);
  assert.equal((await readdir(physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/history`))).length, 1);
  assert.equal((await readdir(physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/quarantine`))).length, 1);
});

test("expired partial publication can still be authorized only for quarantine recovery", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const activation = context(root, { operationId: "activate-expired-partial" });
  const prepared = await runClusterPolicyActivationPhase(activation, "prepare", { filesystemRoot: root, siteRoot });
  await assert.rejects(
    runClusterPolicyActivationPhase(activation, "execute", {
      filesystemRoot: root,
      siteRoot,
      fault: async (boundary) => { if (boundary === "AFTER_HISTORY") throw new Error("FAULT_AFTER_HISTORY"); },
    }),
    /FAULT_AFTER_HISTORY/u,
  );
  const recovery = structuredClone(recoveryContext(activation, prepared.intent_sha256, "expired-quarantine"));
  recovery.execution_created_at = "2026-08-16T00:01:00.000Z";
  assert.deepEqual(validateClusterPolicyActivationContext(recovery), recovery);
  const plan = await runClusterPolicyActivationPhase(recovery, "recover-prepare", { filesystemRoot: root, siteRoot });
  assert.equal(plan.decision, "QUARANTINE");
  const result = await runClusterPolicyActivationPhase(recovery, "recover-execute", { filesystemRoot: root, siteRoot });
  assert.equal(result.result, "QUARANTINED");
  assert.equal((await readdir(physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/quarantine`))).length, 1);
});

test("source inode, hardlink, symlink, generation, environment, template and time drift fail closed", async (t) => {
  await t.test("replaced inode", async (subtest) => {
    const root = await fixture();
    subtest.after(() => rm(root, { recursive: true, force: true }));
    await activate(root, context(root));
    const next = await nextActivation(root, 2);
    const target = physical(root, CLUSTER_POLICY_TARGET_FILE), replacement = `${target}.replacement`;
    await writeFile(replacement, await readFile(target), { flag: "wx", mode: 0o440 });
    await chmod(replacement, 0o440);
    await rename(replacement, target);
    await assert.rejects(runClusterPolicyActivationPhase(next, "prepare", { filesystemRoot: root, siteRoot }), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
  });

  await t.test("hardlinked current receipt", async (subtest) => {
    const root = await fixture();
    subtest.after(() => rm(root, { recursive: true, force: true }));
    await activate(root, context(root));
    const next = await nextActivation(root, 2);
    await link(physical(root, CLUSTER_POLICY_ACTIVATION_CURRENT_FILE), physical(root, `${CLUSTER_POLICY_ACTIVATION_STATE_ROOT}/current-hardlink.json`));
    await assert.rejects(runClusterPolicyActivationPhase(next, "prepare", { filesystemRoot: root, siteRoot }), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
  });

  await t.test("symlinked policy", async (subtest) => {
    const root = await fixture();
    subtest.after(() => rm(root, { recursive: true, force: true }));
    await activate(root, context(root));
    const next = await nextActivation(root, 2);
    const target = physical(root, CLUSTER_POLICY_TARGET_FILE), saved = `${target}.saved`;
    await rename(target, saved);
    await symlink(saved, target);
    await assert.rejects(runClusterPolicyActivationPhase(next, "prepare", { filesystemRoot: root, siteRoot }), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_CURRENT_SOURCE_INVALID");
  });

  await t.test("generation skip and cross-environment transition", async (subtest) => {
    const root = await fixture();
    subtest.after(() => rm(root, { recursive: true, force: true }));
    await activate(root, context(root));
    await assert.rejects(runClusterPolicyActivationPhase(await nextActivation(root, 3), "prepare", { filesystemRoot: root, siteRoot }), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_GENERATION_MISMATCH");
    await assert.rejects(runClusterPolicyActivationPhase(await nextActivation(root, 2, { environment: "PRODUCTION" }), "prepare", { filesystemRoot: root, siteRoot }), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_RELEASE_IDENTITY_INVALID");
  });

  await t.test("repository template raw replacement", async (subtest) => {
    const root = await fixture(), replacedSite = await mkdtemp(path.join(os.tmpdir(), "cyd-cluster-policy-template-"));
    subtest.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(replacedSite, { recursive: true, force: true })]));
    await mkdir(path.join(replacedSite, "operations"), { recursive: true });
    await writeFile(path.join(replacedSite, "operations/postgresql-cluster-recovery-policy-v2.json"), Buffer.concat([templateRaw, Buffer.from(" ")]));
    await assert.rejects(runClusterPolicyActivationPhase(context(root), "prepare", { filesystemRoot: root, siteRoot: replacedSite }), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_TEMPLATE_REPLACED");
  });

  const future = structuredClone(originalContext());
  future.execution_created_at = "2026-08-15T00:10:00.000Z";
  assert.throws(() => validateClusterPolicyActivationContext(future), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_CONTEXT_BINDING_INVALID");
  const validRecovery = recoveryContext(originalContext(), digest("intent"));
  const expiredRecovery = { ...validRecovery, execution_created_at: validRecovery.parameters.policy_expires_at };
  assert.deepEqual(validateClusterPolicyActivationContext(expiredRecovery), expiredRecovery);
});

test("receipt self hash cannot be substituted with a file hash or reused actor", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await activate(root, context(root));
  const { policy, receipt } = await current(root);
  const receiptFileSha256 = clusterSha256(canonicalClusterJson(receipt));
  assert.notEqual(receiptFileSha256, receipt.receipt_sha256);
  assert.throws(
    () => validateClusterRecoveryPolicyActivationReceipt({ ...receipt, receipt_sha256: receiptFileSha256 }, policy),
    (error) => error.code === "CLUSTER_POLICY_ACTIVATION_RECEIPT_INTEGRITY_INVALID",
  );
  const reused = { ...receipt, approver_identity_sha256: receipt.responsible_operator_identity_sha256 };
  const body = Object.fromEntries(Object.entries(reused).filter(([key]) => key !== "receipt_sha256"));
  reused.receipt_sha256 = clusterSha256(body);
  assert.throws(() => validateClusterRecoveryPolicyActivationReceipt(reused, policy), (error) => error.code === "CLUSTER_POLICY_ACTIVATION_RECEIPT_ACTORS_INVALID");
});
