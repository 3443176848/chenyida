import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, chown, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MONITORING_CREDENTIAL_SOURCE_PATH,
  MONITORING_NOTIFIER_CONFIG_CONTRACT,
  MONITORING_REMOTE_ACK_CONTRACT,
  validateMonitoringNotifierConfig,
} from "../tools/ops-monitoring/delivery-contract.mjs";
import { canonicalMonitoringJson, monitoringSha256 } from "../tools/ops-monitoring/contract.mjs";
import {
  NOTIFIER_EGRESS_ACTIVATION_VIEW,
  NOTIFIER_EGRESS_DROPIN_TARGET,
  NOTIFIER_EGRESS_POLICY_TARGET,
  NOTIFIER_EGRESS_STATE_ROOT,
  NOTIFIER_EGRESS_UNIT_FRAGMENT,
  ZERO_SHA256,
  canonicalNotifierEgressAddress,
  createNotifierEgressActivationReceipt,
  createNotifierEgressPolicy,
  notifierEgressTemplateLogicalSha256,
  validateCommittedNotifierEgressActivation,
} from "../tools/ops-monitoring/notifier-egress-contract.mjs";
import { createHttpsAckAdapter } from "../tools/ops-monitoring/notifier.mjs";
import {
  NOTIFIER_EGRESS_CONTEXT_CONTRACT,
  runNotifierEgressActivationPhase,
} from "../scripts/monitoring-notifier-egress-publisher.mjs";

const sha = (character) => character.repeat(64);
const notifierGid = 21002;
const templateRaw = await readFile(new URL("../operations/monitoring-notifier-egress-policy-v1.json", import.meta.url));
const template = JSON.parse(templateRaw);
const baseUnitRaw = await readFile(new URL("../deployment/systemd/chenyida-erp-monitor-notifier.service", import.meta.url));

function notifierConfig({ targetId = "primary-oncall", targetGeneration = 1, host = "alerts.example.com", credentialGeneration = 1 } = {}) {
  return validateMonitoringNotifierConfig({
    schema_version: 1,
    contract: MONITORING_NOTIFIER_CONFIG_CONTRACT,
    config_id: `notifier-${targetId}-${credentialGeneration}`,
    config_generation: credentialGeneration,
    previous_config_sha256: credentialGeneration === 1 ? ZERO_SHA256 : sha("f"),
    host_config_sha256: sha("e"),
    deployment: { class: "UAT", id: "erp-uat-fixture", compose_project: "erp-uat-fixture" },
    installation: {
      activation_id: "monitoring-activation-v1",
      installation_generation: 1,
      monitoring_bundle_sha256: sha("7"),
      supervisor_bundle_sha256: sha("8"),
      state_schema_min: 1,
      state_schema_max: 1,
    },
    identity: { user: "chenyida-monitor-notify", uid: 21002, gid: notifierGid },
    evaluator_identity: { user: "chenyida-monitor-eval", uid: 21001, gid: 21001 },
    notification: {
      required: true,
      target_id: targetId,
      target_generation: targetGeneration,
      adapter: { id: "HTTPS_JSON_ACK_V1", version: 1, source_sha256: sha("d") },
      endpoint: { scheme: "https", host, port: 443, path: "/ack", tls_server_name: host },
      credential: { source_file: MONITORING_CREDENTIAL_SOURCE_PATH, sha256: sha("5"), generation: credentialGeneration },
      ack: { contract: MONITORING_REMOTE_ACK_CONTRACT, timeout_milliseconds: 1000, claim_ttl_seconds: 15, retry_backoff_seconds: 15, max_attempts: 3 },
      oncall_roster_generation: 1,
      escalation_table_sha256: sha("6"),
    },
  });
}

async function writeOwned(file, raw, mode, gid = 0) {
  await writeFile(file, raw, { mode: 0o600 });
  await chown(file, 0, gid);
  await chmod(file, mode);
}

async function sourceSpec(root, logical) {
  const file = path.join(root, logical.slice(1)), metadata = await lstat(file, { bigint: true }), raw = await readFile(file);
  return {
    path: logical,
    sha256: monitoringSha256(raw),
    bytes: raw.length,
    device: String(metadata.dev),
    inode: String(metadata.ino),
    uid: Number(metadata.uid),
    gid: Number(metadata.gid),
    mode: (Number(metadata.mode & 0o7777n)).toString(8).padStart(4, "0"),
    nlink: Number(metadata.nlink),
  };
}

async function fixture(t, config = notifierConfig()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "erp-notifier-egress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "/var", "/var/lib", "/var/lib/chenyida-erp", "/etc", "/etc/chenyida-erp", "/etc/chenyida-erp/monitoring-v1",
    "/etc/chenyida-erp/monitoring-v1/views", "/etc/systemd", "/etc/systemd/system",
  ]) await mkdir(path.join(root, directory.slice(1)), { mode: 0o755 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  const configRaw = Buffer.from(canonicalMonitoringJson(config)), configLogical = `/etc/chenyida-erp/monitoring-v1/views/${monitoringSha256(config)}.notifier.json`;
  await writeOwned(path.join(root, configLogical.slice(1)), configRaw, 0o440, notifierGid);
  await writeOwned(path.join(root, NOTIFIER_EGRESS_UNIT_FRAGMENT.slice(1)), baseUnitRaw, 0o444);
  return {
    root,
    config,
    configLogical,
    configSource: await sourceSpec(root, configLogical),
    baseUnitSource: await sourceSpec(root, NOTIFIER_EGRESS_UNIT_FRAGMENT),
  };
}

function parameters(value, overrides = {}) {
  const config = value.config;
  return {
    policy_state_root: NOTIFIER_EGRESS_STATE_ROOT,
    policy_target: NOTIFIER_EGRESS_POLICY_TARGET,
    activation_view: NOTIFIER_EGRESS_ACTIVATION_VIEW,
    dropin_target: NOTIFIER_EGRESS_DROPIN_TARGET,
    activation_id: overrides.activation_id || "egress-activation-1",
    environment: "UAT",
    egress_generation: overrides.egress_generation || 1,
    previous_policy_sha256: overrides.previous_policy_sha256 || ZERO_SHA256,
    previous_activation_receipt_sha256: overrides.previous_activation_receipt_sha256 || ZERO_SHA256,
    rollback_target_activation_receipt_sha256: overrides.rollback_target_activation_receipt_sha256 || ZERO_SHA256,
    deployment_id: config.deployment.id,
    target_id: config.notification.target_id,
    target_generation: config.notification.target_generation,
    endpoint: config.notification.endpoint,
    allowed_addresses: overrides.allowed_addresses || ["1.1.1.1", "2606:4700:4700::1111"],
    monitoring_bundle_sha256: config.installation.monitoring_bundle_sha256,
    adapter_id: config.notification.adapter.id,
    adapter_sha256: config.notification.adapter.source_sha256,
    credential_sha256: config.notification.credential.sha256,
    credential_generation: config.notification.credential.generation,
    oncall_roster_generation: config.notification.oncall_roster_generation,
    escalation_table_sha256: config.notification.escalation_table_sha256,
    notifier_gid: notifierGid,
    template_file_sha256: monitoringSha256(templateRaw),
    template_policy_sha256: notifierEgressTemplateLogicalSha256(template),
    approval_reference_sha256: sha("a"),
    responsible_operator_identity_sha256: sha("b"),
    approver_identity_sha256: sha("c"),
    activated_at: overrides.activated_at || "2026-08-15T00:00:00.000Z",
    expires_at: overrides.expires_at || "2026-08-16T00:00:00.000Z",
    notifier_config_source: value.configSource,
    base_unit_source: value.baseUnitSource,
    current_policy_source: overrides.current_policy_source || null,
    current_activation_source: overrides.current_activation_source || null,
    rollback_policy_source: overrides.rollback_policy_source || null,
    rollback_activation_source: overrides.rollback_activation_source || null,
  };
}

function context(parameterValue, overrides = {}) {
  const recovery = overrides.recovery === true;
  return {
    schema_version: 1,
    contract: NOTIFIER_EGRESS_CONTEXT_CONTRACT,
    operation_id: parameterValue.activation_id,
    operation: overrides.operation || "ACTIVATE",
    execution_mode: recovery ? "RECOVERY" : "ORIGINAL",
    execution_authorization_id: recovery ? overrides.authorization_id || "egress-recovery-1" : parameterValue.activation_id,
    execution_authorization_sha256: recovery ? sha("4") : sha("9"),
    execution_created_at: recovery ? overrides.created_at || "2026-08-15T00:10:00.000Z" : parameterValue.activated_at,
    original_authorization_sha256: sha("9"),
    supervisor_bundle_sha256: sha("8"),
    expected_intent_sha256: recovery ? overrides.intent_sha256 : null,
    parameters: parameterValue,
  };
}

test("policy contract canonicalizes exact public addresses and rejects local destinations", () => {
  assert.deepEqual(canonicalNotifierEgressAddress("1.1.1.1"), { family: "AF_INET", address: "1.1.1.1", prefix_length: 32, systemd_prefix: "1.1.1.1/32" });
  assert.throws(() => canonicalNotifierEgressAddress("127.0.0.1"), /MONITOR_EGRESS_ADDRESS_FORBIDDEN/);
  assert.throws(() => canonicalNotifierEgressAddress("2001:db8::1"), /MONITOR_EGRESS_ADDRESS_FORBIDDEN/);
});

test("fake-root activation is prepared, applied, effective-bound and finalized", async (t) => {
  const value = await fixture(t), original = context(parameters(value));
  const prepared = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
  const applied = await runNotifierEgressActivationPhase(original, "apply", { filesystemRoot: value.root });
  assert.equal(prepared.intent_sha256, applied.intent_sha256);
  await assert.rejects(runNotifierEgressActivationPhase(original, "finalize", { filesystemRoot: value.root, effectiveUnitSha256: sha("f") }), /MONITOR_EGRESS_EFFECTIVE_UNIT_NOT_VERIFIED/);
  const committed = await runNotifierEgressActivationPhase(original, "finalize", { filesystemRoot: value.root, effectiveUnitSha256: applied.effective_unit_sha256 });
  assert.equal(committed.result, "COMMITTED");
  const [policy, receipt, dropin] = await Promise.all([
    readFile(path.join(value.root, NOTIFIER_EGRESS_POLICY_TARGET.slice(1)), "utf8"),
    readFile(path.join(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW.slice(1)), "utf8"),
    readFile(path.join(value.root, NOTIFIER_EGRESS_DROPIN_TARGET.slice(1)), "utf8"),
  ]);
  assert.match(policy, /"runtime_dns":"FORBIDDEN"/);
  assert.match(receipt, /"status":"COMMITTED"/);
  assert.equal(dropin, "# Managed by chenyida-erp release supervisor; manual edits are forbidden.\n[Service]\nIPAddressAllow=\nIPAddressAllow=1.1.1.1\/32\nIPAddressAllow=2606:4700:4700::1111\/128\n");
});

test("a different authorization cannot replace an unresolved prepared intent", async (t) => {
  const value = await fixture(t), original = context(parameters(value));
  const prepared = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
  const repeated = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
  assert.equal(repeated.intent_sha256, prepared.intent_sha256);
  const replacement = context(parameters(value, { activation_id: "egress-activation-replacement" }));
  await assert.rejects(
    runNotifierEgressActivationPhase(replacement, "prepare", { filesystemRoot: value.root }),
    /MONITOR_EGRESS_ACTIVE_INTENT_PRESENT/,
  );
  const reboundSameId = context(parameters(value, { allowed_addresses: ["8.8.8.8"] }));
  await assert.rejects(
    runNotifierEgressActivationPhase(reboundSameId, "prepare", { filesystemRoot: value.root }),
    /MONITOR_EGRESS_ACTIVE_INTENT_PRESENT/,
  );
});

test("partial apply resumes only through a new recovery authorization", async (t) => {
  const value = await fixture(t), original = context(parameters(value));
  const prepared = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
  await assert.rejects(runNotifierEgressActivationPhase(original, "apply", {
    filesystemRoot: value.root,
    fault(stage) { if (stage === "AFTER_DROPIN") throw new Error("synthetic-fault"); },
  }), /synthetic-fault/);
  const recovery = context(original.parameters, { recovery: true, intent_sha256: prepared.intent_sha256 });
  const plan = await runNotifierEgressActivationPhase(recovery, "recover-prepare", { filesystemRoot: value.root });
  assert.equal(plan.decision, "RESUME_PUBLICATION");
  const applied = await runNotifierEgressActivationPhase(recovery, "recover-apply", { filesystemRoot: value.root });
  const committed = await runNotifierEgressActivationPhase(recovery, "recover-finalize", { filesystemRoot: value.root, effectiveUnitSha256: applied.effective_unit_sha256 });
  assert.equal(committed.result, "COMMITTED");
  assert.equal(committed.recovery_sha256, plan.recovery_sha256);
});

test("recovery resumes exact content-addressed temporaries left before rename", async (t) => {
  await t.test("drop-in temporary", async (subtest) => {
    const value = await fixture(subtest), original = context(parameters(value));
    const prepared = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
    await assert.rejects(runNotifierEgressActivationPhase(original, "apply", {
      filesystemRoot: value.root,
      fault(stage) { if (stage === "BEFORE_DROPIN_RENAME") throw new Error("synthetic-before-rename"); },
    }), /synthetic-before-rename/);
    const recovery = context(original.parameters, { recovery: true, intent_sha256: prepared.intent_sha256 });
    const plan = await runNotifierEgressActivationPhase(recovery, "recover-prepare", { filesystemRoot: value.root });
    assert.equal(plan.decision, "RESUME_PUBLICATION");
    const applied = await runNotifierEgressActivationPhase(recovery, "recover-apply", { filesystemRoot: value.root });
    const committed = await runNotifierEgressActivationPhase(recovery, "recover-finalize", { filesystemRoot: value.root, effectiveUnitSha256: applied.effective_unit_sha256 });
    assert.equal(committed.result, "COMMITTED");
  });

  await t.test("current pointer temporary", async (subtest) => {
    const value = await fixture(subtest), original = context(parameters(value));
    const prepared = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
    const applied = await runNotifierEgressActivationPhase(original, "apply", { filesystemRoot: value.root });
    await assert.rejects(runNotifierEgressActivationPhase(original, "finalize", {
      filesystemRoot: value.root,
      effectiveUnitSha256: applied.effective_unit_sha256,
      fault(stage) { if (stage === "BEFORE_CURRENT_RENAME") throw new Error("synthetic-before-rename"); },
    }), /synthetic-before-rename/);
    const recovery = context(original.parameters, { recovery: true, intent_sha256: prepared.intent_sha256 });
    const plan = await runNotifierEgressActivationPhase(recovery, "recover-prepare", { filesystemRoot: value.root });
    assert.equal(plan.decision, "RESUME_PUBLICATION");
    const recovered = await runNotifierEgressActivationPhase(recovery, "recover-apply", { filesystemRoot: value.root });
    const committed = await runNotifierEgressActivationPhase(recovery, "recover-finalize", { filesystemRoot: value.root, effectiveUnitSha256: recovered.effective_unit_sha256 });
    assert.equal(committed.result, "COMMITTED");
  });
});

test("rollback generation rebinds only the immediately prior committed target receipt", async (t) => {
  const value = await fixture(t);
  const firstContext = context(parameters(value));
  await runNotifierEgressActivationPhase(firstContext, "prepare", { filesystemRoot: value.root });
  const firstApplied = await runNotifierEgressActivationPhase(firstContext, "apply", { filesystemRoot: value.root });
  await runNotifierEgressActivationPhase(firstContext, "finalize", { filesystemRoot: value.root, effectiveUnitSha256: firstApplied.effective_unit_sha256 });
  const firstReceipt = JSON.parse(await readFile(path.join(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW.slice(1)), "utf8"));

  const rotatedConfig = notifierConfig({ targetId: "secondary-oncall", targetGeneration: 2, host: "alerts2.example.com" });
  const rotatedRaw = Buffer.from(canonicalMonitoringJson(rotatedConfig));
  const rotatedLogical = `/etc/chenyida-erp/monitoring-v1/views/${monitoringSha256(rotatedConfig)}.notifier.json`;
  await writeOwned(path.join(value.root, rotatedLogical.slice(1)), rotatedRaw, 0o440, notifierGid);
  const firstPolicySource = await sourceSpec(value.root, NOTIFIER_EGRESS_POLICY_TARGET);
  const firstActivationSource = await sourceSpec(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW);
  const rotatedValue = { ...value, config: rotatedConfig, configSource: await sourceSpec(value.root, rotatedLogical) };
  const secondParameters = parameters(rotatedValue, {
    activation_id: "egress-activation-2", egress_generation: 2,
    previous_policy_sha256: firstReceipt.policy_sha256,
    previous_activation_receipt_sha256: firstReceipt.receipt_sha256,
    current_policy_source: firstPolicySource, current_activation_source: firstActivationSource,
    allowed_addresses: ["1.0.0.1"], activated_at: "2026-08-15T01:00:00.000Z", expires_at: "2026-08-16T01:00:00.000Z",
  });
  const secondContext = context(secondParameters);
  await runNotifierEgressActivationPhase(secondContext, "prepare", { filesystemRoot: value.root });
  const secondApplied = await runNotifierEgressActivationPhase(secondContext, "apply", { filesystemRoot: value.root });
  await runNotifierEgressActivationPhase(secondContext, "finalize", { filesystemRoot: value.root, effectiveUnitSha256: secondApplied.effective_unit_sha256 });
  const secondReceipt = JSON.parse(await readFile(path.join(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW.slice(1)), "utf8"));

  const secondPolicySource = await sourceSpec(value.root, NOTIFIER_EGRESS_POLICY_TARGET);
  const secondActivationSource = await sourceSpec(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW);
  const rollbackPolicySource = await sourceSpec(value.root, firstReceipt.history_file);
  const rollbackReceiptLogical = `${NOTIFIER_EGRESS_STATE_ROOT}/receipts/${String(firstReceipt.generation).padStart(16, "0")}.${firstReceipt.receipt_sha256}.json`;
  const rollbackActivationSource = await sourceSpec(value.root, rollbackReceiptLogical);
  const rollbackParameters = parameters(value, {
    activation_id: "egress-rollback-3", egress_generation: 3,
    previous_policy_sha256: secondReceipt.policy_sha256,
    previous_activation_receipt_sha256: secondReceipt.receipt_sha256,
    rollback_target_activation_receipt_sha256: firstReceipt.receipt_sha256,
    current_policy_source: secondPolicySource, current_activation_source: secondActivationSource,
    rollback_policy_source: rollbackPolicySource, rollback_activation_source: rollbackActivationSource,
    activated_at: "2026-08-15T02:00:00.000Z", expires_at: "2026-08-16T02:00:00.000Z",
  });
  const rollbackContext = context(rollbackParameters, { operation: "ROLLBACK" });
  await runNotifierEgressActivationPhase(rollbackContext, "prepare", { filesystemRoot: value.root });
  const rollbackApplied = await runNotifierEgressActivationPhase(rollbackContext, "apply", { filesystemRoot: value.root });
  await runNotifierEgressActivationPhase(rollbackContext, "finalize", { filesystemRoot: value.root, effectiveUnitSha256: rollbackApplied.effective_unit_sha256 });
  const [rolledBackPolicy, rolledBackReceipt] = await Promise.all([
    readFile(path.join(value.root, NOTIFIER_EGRESS_POLICY_TARGET.slice(1)), "utf8").then(JSON.parse),
    readFile(path.join(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW.slice(1)), "utf8").then(JSON.parse),
  ]);
  assert.equal(rolledBackPolicy.operation, "ROLLBACK");
  assert.equal(rolledBackPolicy.target.target_id, "primary-oncall");
  assert.equal(rolledBackReceipt.rollback_target_activation_receipt_sha256, firstReceipt.receipt_sha256);

  const rolledBackPolicyViewSource = await sourceSpec(value.root, NOTIFIER_EGRESS_POLICY_TARGET);
  const rollbackActivationViewSource = await sourceSpec(value.root, NOTIFIER_EGRESS_ACTIVATION_VIEW);
  const reusedGenerationConfig = notifierConfig({ targetId: "tertiary-oncall", targetGeneration: 2, host: "alerts3.example.com" });
  const reusedGenerationRaw = Buffer.from(canonicalMonitoringJson(reusedGenerationConfig));
  const reusedGenerationLogical = `/etc/chenyida-erp/monitoring-v1/views/${monitoringSha256(reusedGenerationConfig)}.notifier.json`;
  await writeOwned(path.join(value.root, reusedGenerationLogical.slice(1)), reusedGenerationRaw, 0o440, notifierGid);
  const reusedGenerationValue = { ...value, config: reusedGenerationConfig, configSource: await sourceSpec(value.root, reusedGenerationLogical) };
  const fourthBase = {
    activation_id: "egress-activation-4", egress_generation: 4,
    previous_policy_sha256: rolledBackReceipt.policy_sha256,
    previous_activation_receipt_sha256: rolledBackReceipt.receipt_sha256,
    current_policy_source: rolledBackPolicyViewSource, current_activation_source: rollbackActivationViewSource,
    allowed_addresses: ["8.8.8.8"], activated_at: "2026-08-15T03:00:00.000Z", expires_at: "2026-08-16T03:00:00.000Z",
  };
  await assert.rejects(
    runNotifierEgressActivationPhase(context(parameters(reusedGenerationValue, fourthBase)), "prepare", { filesystemRoot: value.root }),
    /MONITOR_EGRESS_TARGET_GENERATION_MISMATCH/,
  );
  const nextGenerationConfig = notifierConfig({ targetId: "tertiary-oncall", targetGeneration: 3, host: "alerts3.example.com" });
  const nextGenerationRaw = Buffer.from(canonicalMonitoringJson(nextGenerationConfig));
  const nextGenerationLogical = `/etc/chenyida-erp/monitoring-v1/views/${monitoringSha256(nextGenerationConfig)}.notifier.json`;
  await writeOwned(path.join(value.root, nextGenerationLogical.slice(1)), nextGenerationRaw, 0o440, notifierGid);
  const nextGenerationValue = { ...value, config: nextGenerationConfig, configSource: await sourceSpec(value.root, nextGenerationLogical) };
  const fourthPrepared = await runNotifierEgressActivationPhase(
    context(parameters(nextGenerationValue, fourthBase)), "prepare", { filesystemRoot: value.root },
  );
  assert.equal(fourthPrepared.result, "PREPARED");
});

test("unknown drop-in is preserved and recovery quarantines without publishing", async (t) => {
  const value = await fixture(t), original = context(parameters(value));
  const prepared = await runNotifierEgressActivationPhase(original, "prepare", { filesystemRoot: value.root });
  const dropinRoot = path.dirname(path.join(value.root, NOTIFIER_EGRESS_DROPIN_TARGET.slice(1)));
  await mkdir(dropinRoot, { mode: 0o755 });
  const unknown = path.join(dropinRoot, "99-unknown.conf");
  await writeOwned(unknown, Buffer.from("[Service]\nIPAddressAllow=0.0.0.0/0\n"), 0o444);
  await assert.rejects(runNotifierEgressActivationPhase(original, "apply", { filesystemRoot: value.root }), /MONITOR_EGRESS_UNKNOWN_DROPIN_PRESENT/);
  const recovery = context(original.parameters, { recovery: true, intent_sha256: prepared.intent_sha256 });
  const plan = await runNotifierEgressActivationPhase(recovery, "recover-prepare", { filesystemRoot: value.root });
  assert.equal(plan.decision, "QUARANTINE");
  const result = await runNotifierEgressActivationPhase(recovery, "recover-apply", { filesystemRoot: value.root });
  assert.equal(result.result, "QUARANTINED");
  assert.equal(await readFile(unknown, "utf8"), "[Service]\nIPAddressAllow=0.0.0.0/0\n");
  await assert.rejects(readFile(path.join(value.root, NOTIFIER_EGRESS_POLICY_TARGET.slice(1))), /ENOENT/);
});

test("HTTPS adapter pins lookup/SNI and rejects proxy or remote-address drift", async () => {
  const config = notifierConfig(), policy = createNotifierEgressPolicy({
    template,
    parameters: {
      operation: "ACTIVATE", environment: "UAT", egress_generation: 1, previous_policy_sha256: ZERO_SHA256,
      previous_activation_receipt_sha256: ZERO_SHA256, rollback_target_activation_receipt_sha256: ZERO_SHA256,
      deployment_id: config.deployment.id, target_id: config.notification.target_id, target_generation: config.notification.target_generation,
      endpoint: config.notification.endpoint, allowed_addresses: ["1.1.1.1"], monitoring_bundle_sha256: config.installation.monitoring_bundle_sha256,
      supervisor_bundle_sha256: config.installation.supervisor_bundle_sha256, notifier_config_sha256: monitoringSha256(config),
      adapter_id: config.notification.adapter.id, adapter_sha256: config.notification.adapter.source_sha256,
      credential_sha256: config.notification.credential.sha256, credential_generation: config.notification.credential.generation,
      oncall_roster_generation: config.notification.oncall_roster_generation, escalation_table_sha256: config.notification.escalation_table_sha256,
      base_unit_sha256: monitoringSha256(baseUnitRaw), template_file_sha256: monitoringSha256(templateRaw), template_policy_sha256: notifierEgressTemplateLogicalSha256(template),
      authorization_sha256: sha("9"), approval_reference_sha256: sha("a"), responsible_operator_identity_sha256: sha("b"), approver_identity_sha256: sha("c"),
      activated_at: "2026-08-15T00:00:00.000Z", expires_at: "2026-08-16T00:00:00.000Z",
    },
  });
  const receipt = createNotifierEgressActivationReceipt({ policy, activationId: "adapter-test" });
  validateCommittedNotifierEgressActivation({ policy, receipt, notifierConfig: config, now: new Date("2026-08-15T00:01:00.000Z") });
  let captured;
  const request = (options, callback) => {
    captured = options;
    const call = new EventEmitter();
    call.write = () => undefined;
    call.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.socket = { remoteAddress: "1.1.1.1" };
      response.destroy = () => undefined;
      callback(response);
      queueMicrotask(() => { response.emit("data", Buffer.from('{"schema_version":1,"contract":"chenyida-erp-monitoring-remote-ack/v1","status":"ACKNOWLEDGED","remote_ack_id":"remote-1","event_id":"' + sha("1") + '","idempotency_key":"' + sha("1") + '","target_id":"primary-oncall","target_generation":1,"attempt_id":"' + sha("2") + '","acked_at":"2026-08-15T00:01:00.000Z"}\n')); response.emit("end"); });
    };
    call.destroy = () => undefined;
    return call;
  };
  const adapter = createHttpsAckAdapter({ request, proxyEnvironment: {} });
  const result = await adapter.send({
    envelope: { event_id: sha("1"), envelope_id: sha("3"), event_sha256: sha("4"), target_id: "primary-oncall", target_generation: 1, event: { severity: "CRITICAL", code: "TEST", message: "synthetic", observed_at: "2026-08-15T00:00:00.000Z" } },
    attempt: { attempt_id: sha("2"), attempt_no: 1, prepared_at: "2026-08-15T00:01:00.000Z" },
    notifierConfig: config, credential: Buffer.from("synthetic-credential"), egressActivation: { policy, receipt },
  });
  assert.equal(result.kind, "RESPONSE");
  assert.equal(captured.hostname, "alerts.example.com");
  assert.equal(captured.servername, "alerts.example.com");
  await new Promise((resolve, reject) => captured.lookup("alerts.example.com", {}, (error, address, family) => error ? reject(error) : (assert.deepEqual([address, family], ["1.1.1.1", 4]), resolve())));
  const proxyAdapter = createHttpsAckAdapter({ request, proxyEnvironment: { HTTPS_PROXY: "http://proxy.invalid" } });
  await assert.rejects(proxyAdapter.send({ envelope: {}, attempt: { prepared_at: "2026-08-15T00:01:00.000Z" }, notifierConfig: config, credential: Buffer.alloc(16), egressActivation: { policy, receipt } }), /MONITOR_NOTIFICATION_PROXY_ENVIRONMENT_FORBIDDEN/);
});
