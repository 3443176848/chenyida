import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, link, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MONITORING_CONFIG_CONTRACT,
  MONITORING_OBSERVATION_CONTRACT,
  acknowledgeMonitoringEvents,
  canonicalMonitoringJson,
  emptyComponentObservation,
  evaluateMonitoringObservation,
  monitoringObservationId,
  monitoringSha256,
  parseMonitoringJson,
  validateMonitoringConfig,
  validateMonitoringObservation,
  validateMonitoringPolicy,
} from "../tools/ops-monitoring/contract.mjs";
import {
  MONITORING_CREDENTIAL_SOURCE_PATH,
  MONITORING_HOST_CONFIG_CONTRACT,
  MONITORING_REMOTE_ACK_CONTRACT,
  createDeliveryEnvelope,
  createDeliveryGrant,
  deriveMonitoringHostConfigViews,
  validateDeliveryAckChain,
  validateDeliveryAttempt,
  validateDeliveryEnvelope,
  validateDeliveryReadiness,
  validateMonitoringHostConfig,
} from "../tools/ops-monitoring/delivery-contract.mjs";
import {
  createBackupProjection,
  validateBackupProjectionForEvaluation,
  backupProjectionWatermark,
} from "../tools/ops-monitoring/backup-projection.mjs";
import {
  componentsProjectionObservation,
  componentsProjectionWatermark,
  createComponentsProjection,
  validateComponentsProjectionForEvaluation,
} from "../tools/ops-monitoring/components-projection.mjs";
import {
  initializeMonitoringDeliveryRoot,
  initializeMonitoringOutbox,
  publishDeliveryEnvelope,
  publishDeliveryGrant,
  readDeliveryAcks,
  readDeliveryAttempts,
  readDeliveryClaims,
  readDeliveryEnvelopes,
  readDeliveryGrants,
  readDeliveryReadiness,
  readDeliveryResults,
} from "../tools/ops-monitoring/delivery-store.mjs";
import {
  createHttpsAckAdapter,
  deliverPendingEvent,
} from "../tools/ops-monitoring/notifier.mjs";
import {
  createNotifierEgressActivationReceipt,
  createNotifierEgressPolicy,
  notifierEgressTemplateLogicalSha256,
} from "../tools/ops-monitoring/notifier-egress-contract.mjs";
import {
  MONITORING_HOST_STATE_LOCK,
  assertInheritedMonitoringLock,
  createMonitoringHostState,
  initializeMonitoringHostStateRoot,
  validateMonitoringHostState,
} from "../tools/ops-monitoring/host-store.mjs";

const policy = validateMonitoringPolicy(parseMonitoringJson(await readFile(new URL("../operations/monitoring-policy-v1.json", import.meta.url), "utf8")));
const resourcePlan = parseMonitoringJson(await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8"));
const observedAt = "2026-08-13T00:10:00.000Z";
const activatedAt = "2026-08-13T00:00:00.000Z";
const credential = Buffer.from("synthetic-monitoring-secret-0001\n", "utf8");
const sha = (character) => character.repeat(64);
const digest = (character) => `sha256:${sha(character)}`;
const egressTemplateRaw = await readFile(new URL("../operations/monitoring-notifier-egress-policy-v1.json", import.meta.url));
const egressTemplate = JSON.parse(egressTemplateRaw);

function committedEgress(config) {
  const policy = createNotifierEgressPolicy({
    template: egressTemplate,
    parameters: {
      operation: "ACTIVATE", environment: "UAT", egress_generation: 1, previous_policy_sha256: sha("0"),
      previous_activation_receipt_sha256: sha("0"), rollback_target_activation_receipt_sha256: sha("0"),
      deployment_id: config.deployment.id, target_id: config.notification.target_id, target_generation: config.notification.target_generation,
      endpoint: config.notification.endpoint, allowed_addresses: ["1.1.1.1"], monitoring_bundle_sha256: config.installation.monitoring_bundle_sha256,
      supervisor_bundle_sha256: config.installation.supervisor_bundle_sha256, notifier_config_sha256: monitoringSha256(config),
      adapter_id: config.notification.adapter.id, adapter_sha256: config.notification.adapter.source_sha256,
      credential_sha256: config.notification.credential.sha256, credential_generation: config.notification.credential.generation,
      oncall_roster_generation: config.notification.oncall_roster_generation, escalation_table_sha256: config.notification.escalation_table_sha256,
      base_unit_sha256: sha("1"), template_file_sha256: monitoringSha256(egressTemplateRaw),
      template_policy_sha256: notifierEgressTemplateLogicalSha256(egressTemplate), authorization_sha256: sha("2"),
      approval_reference_sha256: sha("3"), responsible_operator_identity_sha256: sha("4"), approver_identity_sha256: sha("5"),
      activated_at: "2026-08-13T00:00:00.000Z", expires_at: "2026-08-14T00:00:00.000Z",
    },
  });
  return { policy, receipt: createNotifierEgressActivationReceipt({ policy, activationId: "host-delivery-egress-v1" }) };
}

function monitoringConfig(targetId = "primary-oncall") {
  return validateMonitoringConfig({
    schema_version: 1,
    contract: MONITORING_CONFIG_CONTRACT,
    config_id: `monitoring-${targetId}`,
    deployment_class: "TEST",
    deployment_id: "erp-host-fixture",
    compose_project: "erp-host-fixture",
    service_expectations: [
      ["caddy", "1"],
      ["postgres", "2"],
      ["web", "a"],
      ["worker", "b"],
    ].map(([service, character]) => ({
      service,
      container_name: `erp-host-fixture-${service}-1`,
      image_reference: `registry.internal/chenyida/${service}@${digest(character)}`,
    })),
    release_expectation: {
      application_version: "0.1.0-alpha.47",
      git_commit: "3".repeat(40),
      release_manifest_sha256: sha("4"),
      supervisor_bundle_sha256: sha("5"),
      migration_head: "0046_runtime_lock_privilege_boundary.sql",
      migration_manifest_sha256: sha("6"),
      web_image_digest: digest("a"),
      worker_image_digest: digest("b"),
    },
    backup_expectation: { policy_id: "daily-rpo-v1", rpo_hours: 24 },
    notification: { required: true, target_id: targetId },
  });
}

function hostConfig({
  targetId = "primary-oncall",
  targetGeneration = 1,
  configGeneration = 1,
  previousConfigSha256 = "0".repeat(64),
  activationId = "monitoring-activation-v1",
  installationGeneration = 1,
  credentialValue = credential,
  credentialGeneration = 1,
  deploymentClass = "TEST",
  adapterId = "SYNTHETIC_FAKE_ACK_V1",
} = {}) {
  const config = monitoringConfig(targetId);
  config.deployment_class = deploymentClass;
  const value = {
    schema_version: 1,
    contract: MONITORING_HOST_CONFIG_CONTRACT,
    config_id: "monitoring-host-v1",
    config_generation: configGeneration,
    previous_config_sha256: previousConfigSha256,
    deployment: { class: deploymentClass, id: "erp-host-fixture", compose_project: "erp-host-fixture" },
    installation: {
      activation_id: activationId,
      installation_generation: installationGeneration,
      monitoring_bundle_sha256: sha("7"),
      supervisor_bundle_sha256: sha("8"),
      state_schema_min: 1,
      state_schema_max: 1,
    },
    identities: {
      evaluator: { user: "chenyida-monitor-eval", uid: 21001, gid: 21001 },
      notifier: { user: "chenyida-monitor-notify", uid: 21002, gid: 21002 },
    },
    monitoring: config,
    evidence: {
      components_projection_path: "/var/lib/chenyida-erp/monitoring-v1/projections/components.json",
      backup_projection_path: "/var/lib/chenyida-erp/monitoring-v1/projections/backup.json",
      release_activation_id: activationId,
      release_activated_at: activatedAt,
      postdeploy_receipt_sha256: sha("9"),
      components_producer_bundle_sha256: sha("b"),
      backup_producer_bundle_sha256: sha("c"),
      minimum_components_projection_generation: 1,
      minimum_backup_projection_generation: 1,
    },
    notification: {
      required: true,
      target_id: targetId,
      target_generation: targetGeneration,
      adapter: { id: adapterId, version: 1, source_sha256: sha("d") },
      endpoint: adapterId === "SYNTHETIC_FAKE_ACK_V1"
        ? { scheme: null, host: null, port: null, path: null, tls_server_name: null }
        : { scheme: "https", host: "alerts.example.internal", port: 443, path: "/ack", tls_server_name: "alerts.example.internal" },
      credential: { source_file: MONITORING_CREDENTIAL_SOURCE_PATH, sha256: monitoringSha256(credentialValue), generation: credentialGeneration },
      ack: { contract: MONITORING_REMOTE_ACK_CONTRACT, timeout_milliseconds: 1000, claim_ttl_seconds: 15, retry_backoff_seconds: 15, max_attempts: 3 },
      oncall_roster_generation: 1,
      escalation_table_sha256: sha("e"),
    },
  };
  return validateMonitoringHostConfig(value);
}

function observationFixture() {
  const empty = structuredClone(emptyComponentObservation());
  const value = {
    schema_version: 1,
    contract: MONITORING_OBSERVATION_CONTRACT,
    observation_id: "pending",
    observed_at: observedAt,
    source: "SYNTHETIC_TEST",
    policy_sha256: monitoringSha256(policy),
    resource_policy_sha256: policy.resource_policy_source.sha256,
    host: {
      boot_id_sha256: sha("f"),
      monotonic_milliseconds: 1_000_000,
      available_memory_bytes: 512 * 1024 * 1024,
      swap_total_bytes: 1024 * 1024 * 1024,
      swap_free_bytes: 1024 * 1024 * 1024,
      root_free_bytes: 20 * 1024 ** 3,
      load_1m: 0.5,
      oom_kill_count: 0,
    },
    services: [],
    application: empty.application,
    release: empty.release,
    backup: empty.backup,
    notification: { status: "READY", target_id: "primary-oncall" },
  };
  value.observation_id = monitoringObservationId(value);
  return validateMonitoringObservation(value);
}

function evaluatedFixture() {
  const config = monitoringConfig();
  const observation = observationFixture();
  return {
    config,
    observation,
    result: evaluateMonitoringObservation({ policy, resourcePlan, config, observation, now: new Date(observedAt) }),
  };
}

function backupProjectionFixture(overrides = {}) {
  const generation = overrides.generation ?? 1;
  return createBackupProjection({
    schema_version: 1,
    contract: "chenyida-erp-monitoring-backup-projection/v1",
    projection_id: `backup-projection-${generation}`,
    generation,
    previous_projection_sha256: overrides.previous_projection_sha256 ?? "0".repeat(64),
    producer: { bundle_sha256: sha("c"), policy_sha256: sha("1"), source_readiness_sha256: sha("2") },
    published_at: `2026-08-13T00:${generation === 1 ? "05" : "09"}:00.000Z`,
    verified_at: `2026-08-13T00:${generation === 1 ? "04" : "08"}:00.000Z`,
    recovery_point_at: `2026-08-13T00:${generation === 1 ? "03" : "07"}:00.000Z`,
    expires_at: "2026-08-14T00:10:00.000Z",
    release: {
      activation_id: "monitoring-activation-v1",
      activated_at: activatedAt,
      postdeploy_receipt_sha256: sha("9"),
      release_manifest_sha256: sha("4"),
      application_version: "0.1.0-alpha.47",
      git_commit: "3".repeat(40),
    },
    backup: {
      verification_status: "RECOVERY_READY",
      evidence_scope: "ACTUAL_OFFHOST",
      transfer_status: "VERIFIED",
      encryption_status: "VERIFIED",
      cluster_transfer_status: "VERIFIED",
      cluster_security_status: "VERIFIED",
      credential_binding_status: "VERIFIED",
      tablespace_status: "VERIFIED",
      recovery_execution_status: "PUBLISHED",
      schedule_status: "ON_TIME",
      retention_status: "POLICY_VALID_DRY_RUN",
      identity_status: "MATCHED",
      policy_status: "MATCHED",
      assurance_status: "MATCHED",
      recovery_ready: true,
      policy_id: "daily-rpo-v1",
      rpo_hours: 24,
    },
  });
}

function componentsProjectionFixture(overrides = {}) {
  const generation = overrides.generation ?? 1;
  return createComponentsProjection({
    schema_version: 1,
    contract: "chenyida-erp-monitoring-components-projection/v1",
    projection_id: `components-projection-${generation}`,
    generation,
    previous_projection_sha256: overrides.previous_projection_sha256 ?? "0".repeat(64),
    producer: { bundle_sha256: sha("b"), source_sha256: sha("2") },
    published_at: generation === 1 ? "2026-08-13T00:09:00.000Z" : "2026-08-13T00:10:00.000Z",
    release_binding: { activation_id: "monitoring-activation-v1", activated_at: activatedAt, postdeploy_receipt_sha256: sha("9") },
    application: {
      live: { status: "PASS", observed_at: generation === 1 ? "2026-08-13T00:08:00.000Z" : "2026-08-13T00:10:00.000Z", version: "0.1.0-alpha.47", code: null },
      readiness: { status: "READY", observed_at: generation === 1 ? "2026-08-13T00:08:00.000Z" : "2026-08-13T00:10:00.000Z", version: "0.1.0-alpha.47", revision: "3".repeat(12), migration_head: "0046_runtime_lock_privilege_boundary.sql", code: null },
    },
    release: {
      status: "MATCHED",
      observed_at: generation === 1 ? "2026-08-13T00:08:00.000Z" : "2026-08-13T00:10:00.000Z",
      generated_at: activatedAt,
      release_manifest_sha256: sha("4"),
      supervisor_bundle_sha256: sha("5"),
      application_version: "0.1.0-alpha.47",
      git_commit: "3".repeat(40),
      migration_head: "0046_runtime_lock_privilege_boundary.sql",
      migration_manifest_sha256: sha("6"),
      web_image_digest: digest("a"),
      worker_image_digest: digest("b"),
    },
  });
}

async function deliveryRoots(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "erp-monitor-delivery-"));
  await chmod(temporary, 0o700);
  const outbox = path.join(temporary, "outbox");
  const delivery = path.join(temporary, "delivery");
  await initializeMonitoringOutbox(outbox);
  await initializeMonitoringDeliveryRoot(delivery);
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return { temporary, outbox, delivery };
}

function exactAckAdapter() {
  return {
    id: "SYNTHETIC_FAKE_ACK_V1",
    async send({ envelope, attempt }) {
      const value = {
        schema_version: 1,
        contract: MONITORING_REMOTE_ACK_CONTRACT,
        status: "ACKNOWLEDGED",
        remote_ack_id: `synthetic-${attempt.attempt_no}`,
        event_id: envelope.event_id,
        idempotency_key: envelope.event_id,
        target_id: envelope.target_id,
        target_generation: envelope.target_generation,
        attempt_id: attempt.attempt_id,
        acked_at: observedAt,
      };
      return { kind: "RESPONSE", value, raw: Buffer.from(canonicalMonitoringJson(value)) };
    },
  };
}

test("content-derived observation identity covers every sanitized component", () => {
  const observation = observationFixture();
  assert.match(observation.observation_id, /^obs-[0-9a-f]{32}$/);
  assert.throws(
    () => validateMonitoringObservation({ ...observation, host: { ...observation.host, available_memory_bytes: observation.host.available_memory_bytes + 1 } }),
    (error) => error.code === "MONITOR_OBSERVATION_INTEGRITY_INVALID",
  );
});

test("HTTPS adapter settles fail-closed when a response aborts before end", async () => {
  const views = deriveMonitoringHostConfigViews(hostConfig({ adapterId: "HTTPS_JSON_ACK_V1", deploymentClass: "UAT" }));
  const envelope = createDeliveryEnvelope({ event: evaluatedFixture().result.report.events[0], evaluatorConfig: views.evaluator });
  const response = new EventEmitter();
  response.statusCode = 200;
  response.complete = false;
  response.socket = { remoteAddress: "1.1.1.1" };
  response.destroy = () => undefined;
  const request = (_options, callback) => {
    const call = new EventEmitter();
    call.destroy = () => undefined;
    call.end = () => {
      callback(response);
      queueMicrotask(() => { response.emit("data", Buffer.from("{")); response.emit("aborted"); });
    };
    return call;
  };
  const result = await createHttpsAckAdapter({ request, proxyEnvironment: {} }).send({
    envelope,
    attempt: { attempt_id: sha("a"), attempt_no: 1, prepared_at: observedAt },
    notifierConfig: views.notifier,
    credential: credential.toString("utf8").trimEnd(),
    egressActivation: committedEgress(views.notifier),
  });
  assert.equal(result.kind, "AMBIGUOUS");
  assert.equal(result.code, "REMOTE_RESPONSE_ABORTED");
});

test("host views isolate notifier secrets and forbid fake adapters outside TEST", () => {
  const config = hostConfig();
  const views = deriveMonitoringHostConfigViews(config);
  assert.equal(Object.hasOwn(views.evaluator, "notification") && Object.hasOwn(views.evaluator.notification, "credential"), false);
  assert.equal(views.evaluator.notification.notifier_config_sha256, monitoringSha256(views.notifier));
  assert.equal(views.notifier.notification.credential.source_file, MONITORING_CREDENTIAL_SOURCE_PATH);
  assert.throws(() => hostConfig({ deploymentClass: "UAT" }), (error) => error.code === "MONITOR_HOST_FAKE_ADAPTER_FORBIDDEN");
});

test("old pending events remain intrinsically valid but a target rotation cannot reinterpret them", () => {
  const { result } = evaluatedFixture();
  const oldViews = deriveMonitoringHostConfigViews(hostConfig());
  const event = result.report.events[0];
  const envelope = createDeliveryEnvelope({ event, evaluatorConfig: oldViews.evaluator });
  assert.equal(validateDeliveryEnvelope(envelope), envelope);
  const rotated = hostConfig({
    targetId: "secondary-oncall",
    targetGeneration: 2,
    configGeneration: 2,
    previousConfigSha256: monitoringSha256(hostConfig()),
    activationId: "monitoring-activation-v2",
    installationGeneration: 2,
  });
  const rotatedViews = deriveMonitoringHostConfigViews(rotated);
  assert.equal(validateDeliveryEnvelope(envelope).target_id, "primary-oncall");
  assert.throws(() => createDeliveryEnvelope({ event, evaluatorConfig: rotatedViews.evaluator }), (error) => error.code === "MONITOR_DELIVERY_EVENT_TARGET_INVALID");
  const acknowledged = acknowledgeMonitoringEvents({ state: result.nextState, eventIds: [event.event_id], config: rotatedViews.evaluator.monitoring, policy });
  assert.equal(acknowledged.pending_events.some((entry) => entry.event_id === event.event_id), false);
});

test("backup projections bind producer, activation, postdeploy identity and a monotonic chain", () => {
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const evaluationTime = { observed_at: observedAt, max_clock_skew_seconds: policy.max_clock_skew_seconds };
  const first = validateBackupProjectionForEvaluation(backupProjectionFixture(), views.evaluator, null, evaluationTime);
  const watermark = backupProjectionWatermark(first);
  const second = backupProjectionFixture({ generation: 2, previous_projection_sha256: first.projection_sha256 });
  assert.equal(validateBackupProjectionForEvaluation(second, views.evaluator, watermark, evaluationTime), second);
  assert.throws(
    () => validateBackupProjectionForEvaluation(first, views.evaluator, backupProjectionWatermark(second), evaluationTime),
    (error) => error.code === "MONITOR_BACKUP_PROJECTION_ROLLBACK",
  );
  assert.throws(
    () => validateBackupProjectionForEvaluation({ ...second, producer: { ...second.producer, bundle_sha256: sha("0") } }, views.evaluator, watermark, evaluationTime),
    (error) => ["MONITOR_BACKUP_PROJECTION_INTEGRITY_INVALID", "MONITOR_BACKUP_PROJECTION_BINDING_INVALID"].includes(error.code),
  );
  const futureBody = { ...backupProjectionFixture(), published_at: "2026-08-13T00:20:00.000Z", verified_at: "2026-08-13T00:19:00.000Z", recovery_point_at: "2026-08-13T00:18:00.000Z" };
  delete futureBody.projection_sha256;
  const future = createBackupProjection(futureBody);
  assert.throws(() => validateBackupProjectionForEvaluation(future, views.evaluator, null, evaluationTime), (error) => error.code === "MONITOR_BACKUP_PROJECTION_FUTURE_DATED");
});

test("application and release projections bind activation identity and cannot roll back", () => {
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const first = validateComponentsProjectionForEvaluation(componentsProjectionFixture(), views.evaluator, null);
  const watermark = componentsProjectionWatermark(first);
  const second = componentsProjectionFixture({ generation: 2, previous_projection_sha256: first.projection_sha256 });
  assert.equal(validateComponentsProjectionForEvaluation(second, views.evaluator, watermark), second);
  assert.equal(componentsProjectionObservation(second).release.git_commit, views.evaluator.monitoring.release_expectation.git_commit);
  assert.throws(
    () => validateComponentsProjectionForEvaluation(first, views.evaluator, componentsProjectionWatermark(second)),
    (error) => error.code === "MONITOR_COMPONENTS_PROJECTION_ROLLBACK",
  );
  assert.throws(
    () => validateComponentsProjectionForEvaluation({ ...second, release_binding: { ...second.release_binding, activation_id: "wrong-activation" } }, views.evaluator, watermark),
    (error) => ["MONITOR_COMPONENTS_PROJECTION_INTEGRITY_INVALID", "MONITOR_COMPONENTS_PROJECTION_BINDING_INVALID"].includes(error.code),
  );
});

test("notifier persists claim and attempt before send and only exact remote acknowledgement delivers", async (t) => {
  const roots = await deliveryRoots(t);
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const { result } = evaluatedFixture();
  const [firstEvent, secondEvent] = result.report.events;
  assert.ok(firstEvent && secondEvent);
  for (const event of [firstEvent, secondEvent]) {
    const envelope = createDeliveryEnvelope({ event, evaluatorConfig: views.evaluator });
    await publishDeliveryEnvelope(roots.outbox, envelope);
    await publishDeliveryGrant(roots.outbox, createDeliveryGrant({ envelope, hostStateSha256: sha("a"), hostStateSequence: 1, grantedAt: observedAt }));
  }
  const delivered = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig: views.notifier, credential, adapter: exactAckAdapter(), now: new Date(observedAt) });
  assert.equal(new Set([firstEvent.event_id, secondEvent.event_id]).has(delivered.event_id), true);
  assert.equal(delivered.status, "ACKNOWLEDGED");
  assert.equal(delivered.attempt_no, 1);
  assert.equal(delivered.acknowledged, true);
  const [acks, claims, envelopes, grants, attempts, results] = await Promise.all([
    readDeliveryAcks(roots.delivery),
    readDeliveryClaims(roots.delivery),
    readDeliveryEnvelopes(roots.outbox),
    readDeliveryGrants(roots.outbox),
    readDeliveryAttempts(roots.delivery),
    readDeliveryResults(roots.delivery),
  ]);
  assert.equal(acks.length, 1);
  const ack = acks[0];
  const chain = validateDeliveryAckChain({
    ack,
    envelope: envelopes.find((entry) => entry.event_id === ack.event_id),
    grant: grants.find((entry) => entry.event_id === ack.event_id),
    claim: claims.find((entry) => entry.claim_id === attempts.find((attempt) => attempt.attempt_id === ack.attempt_id)?.claim_id),
    attempt: attempts.find((entry) => entry.attempt_id === ack.attempt_id),
    result: results.find((entry) => entry.result_id === ack.result_id),
  });
  assert.equal(chain.result.status, "ACKNOWLEDGED");
  const readiness = await readDeliveryReadiness(roots.delivery, chain.attempt.notifier_config_sha256);
  assert.equal(readiness.ack_id, chain.ack.ack_id);
  const mixedAttempt = {
    ...chain.attempt,
    attempt_id: "",
    adapter_id: "HTTPS_JSON_ACK_V1",
    egress_policy_sha256: sha("1"),
  };
  mixedAttempt.attempt_id = monitoringSha256({ ...mixedAttempt, attempt_id: undefined });
  assert.throws(() => validateDeliveryAttempt(mixedAttempt), (error) => error.code === "MONITOR_DELIVERY_ATTEMPT_EGRESS_INVALID");
  const mixedReadiness = {
    ...readiness,
    readiness_id: "",
    adapter_id: "HTTPS_JSON_ACK_V1",
    egress_policy_sha256: sha("1"),
  };
  mixedReadiness.readiness_id = monitoringSha256({ ...mixedReadiness, readiness_id: undefined });
  assert.throws(() => validateDeliveryReadiness(mixedReadiness), (error) => error.code === "MONITOR_DELIVERY_READINESS_EGRESS_INVALID");
  const forgedAmbiguous = { ...chain.result, result_id: "", status: "AMBIGUOUS", detail_code: "REMOTE_ACK_BINDING_INVALID" };
  forgedAmbiguous.result_id = monitoringSha256({ ...forgedAmbiguous, result_id: undefined });
  assert.throws(() => validateDeliveryAckChain({ ...chain, result: forgedAmbiguous }), (error) => error.code === "MONITOR_DELIVERY_ACK_CHAIN_INVALID");

  const invalidAdapter = {
    id: "SYNTHETIC_FAKE_ACK_V1",
    async send({ envelope, attempt }) {
      const value = {
        schema_version: 1,
        contract: MONITORING_REMOTE_ACK_CONTRACT,
        status: "ACKNOWLEDGED",
        remote_ack_id: "synthetic-invalid",
        event_id: envelope.event_id,
        idempotency_key: envelope.event_id,
        target_id: "wrong-target",
        target_generation: envelope.target_generation,
        attempt_id: attempt.attempt_id,
        acked_at: observedAt,
      };
      return { kind: "RESPONSE", value, raw: Buffer.from(canonicalMonitoringJson(value)) };
    },
  };
  const ambiguous = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig: views.notifier, credential, adapter: invalidAdapter, now: new Date(observedAt) });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  assert.equal(ambiguous.acknowledged, false);
  assert.equal((await readDeliveryAcks(roots.delivery)).length, 1);
});

test("crash after send is ambiguous, retains one idempotency key, and retries only after the lease", async (t) => {
  const roots = await deliveryRoots(t);
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const event = evaluatedFixture().result.report.events[0];
  const envelope = createDeliveryEnvelope({ event, evaluatorConfig: views.evaluator });
  await publishDeliveryEnvelope(roots.outbox, envelope);
  await publishDeliveryGrant(roots.outbox, createDeliveryGrant({ envelope, hostStateSha256: sha("b"), hostStateSequence: 1, grantedAt: observedAt }));
  await assert.rejects(
    deliverPendingEvent({
      outboxRoot: roots.outbox,
      deliveryRoot: roots.delivery,
      notifierConfig: views.notifier,
      credential,
      adapter: exactAckAdapter(),
      now: new Date(observedAt),
      hooks: { afterSend: () => { throw new Error("synthetic crash after send"); } },
    }),
    /synthetic crash/,
  );
  await assert.rejects(
    deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig: views.notifier, credential, adapter: exactAckAdapter(), now: new Date(Date.parse(observedAt) + 14_000) }),
    (error) => error.code === "MONITOR_DELIVERY_CLAIM_ACTIVE",
  );
  const retried = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig: views.notifier, credential, adapter: exactAckAdapter(), now: new Date(Date.parse(observedAt) + 16_000) });
  assert.equal(retried.attempt_no, 2);
  assert.equal(retried.event_id, event.event_id);
  assert.equal(retried.acknowledged, true);
});

test("an exhausted oldest event remains visible without starving a later deliverable event", async (t) => {
  const roots = await deliveryRoots(t);
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const notifierConfig = structuredClone(views.notifier);
  notifierConfig.notification.ack.max_attempts = 1;
  for (const event of evaluatedFixture().result.report.events.slice(0, 2)) {
    const envelope = createDeliveryEnvelope({ event, evaluatorConfig: views.evaluator });
    await publishDeliveryEnvelope(roots.outbox, envelope);
    await publishDeliveryGrant(roots.outbox, createDeliveryGrant({ envelope, hostStateSha256: sha("a"), hostStateSequence: 1, grantedAt: observedAt }));
  }
  const ambiguousAdapter = { id: "SYNTHETIC_FAKE_ACK_V1", async send() { return { kind: "AMBIGUOUS", code: "SYNTHETIC_AMBIGUOUS", raw: null }; } };
  const exhausted = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig, credential, adapter: ambiguousAdapter, now: new Date(observedAt) });
  assert.equal(exhausted.status, "AMBIGUOUS");
  const later = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig, credential, adapter: exactAckAdapter(), now: new Date(Date.parse(observedAt) + 16_000) });
  assert.equal(later.status, "ACKNOWLEDGED");
  assert.notEqual(later.event_id, exhausted.event_id);
  const terminal = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig, credential, adapter: exactAckAdapter(), now: new Date(Date.parse(observedAt) + 32_000) });
  assert.equal(terminal.status, "EXHAUSTED");
});

test("target migration is fail-closed while credential rotation is bound only after a remote acknowledgement", async (t) => {
  const roots = await deliveryRoots(t);
  const base = deriveMonitoringHostConfigViews(hostConfig());
  const event = evaluatedFixture().result.report.events[0];
  const envelope = createDeliveryEnvelope({ event, evaluatorConfig: base.evaluator });
  await publishDeliveryEnvelope(roots.outbox, envelope);
  await publishDeliveryGrant(roots.outbox, createDeliveryGrant({ envelope, hostStateSha256: sha("b"), hostStateSequence: 1, grantedAt: observedAt }));
  const rotatedTarget = deriveMonitoringHostConfigViews(hostConfig({ targetId: "secondary-oncall", targetGeneration: 2 }));
  await assert.rejects(
    deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig: rotatedTarget.notifier, credential, adapter: exactAckAdapter(), now: new Date(observedAt) }),
    (error) => error.code === "MONITOR_DELIVERY_TARGET_MIGRATION_REQUIRED",
  );
  const nextCredential = Buffer.from("synthetic-monitoring-secret-0002\n", "utf8");
  const rotatedCredential = deriveMonitoringHostConfigViews(hostConfig({ credentialValue: nextCredential, credentialGeneration: 2 }));
  assert.equal(await readDeliveryReadiness(roots.delivery, monitoringSha256(rotatedCredential.notifier)), null);
  const delivered = await deliverPendingEvent({ outboxRoot: roots.outbox, deliveryRoot: roots.delivery, notifierConfig: rotatedCredential.notifier, credential: nextCredential, adapter: exactAckAdapter(), now: new Date(observedAt) });
  assert.equal(delivered.status, "ACKNOWLEDGED");
  const readiness = await readDeliveryReadiness(roots.delivery, monitoringSha256(rotatedCredential.notifier));
  assert.equal(readiness.credential_sha256, rotatedCredential.notifier.notification.credential.sha256);
  assert.equal(readiness.ack_id, (await readDeliveryAcks(roots.delivery))[0].ack_id);
  assert.equal(await readDeliveryReadiness(roots.delivery, monitoringSha256(base.notifier)), null);
});

test("unknown outbox entries fail closed and bounded roots never ignore them", async (t) => {
  const roots = await deliveryRoots(t);
  await writeFile(path.join(roots.outbox, "events", "rogue.json"), "{}\n", { mode: 0o400 });
  await assert.rejects(readDeliveryEnvelopes(roots.outbox), (error) => error.code === "MONITOR_OUTBOX_EVENT_FILENAME_INVALID");
});

test("delivery publication recovers partial prepared files and readers accept an atomically linked crash point", async (t) => {
  const roots = await deliveryRoots(t);
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const events = evaluatedFixture().result.report.events;
  const first = createDeliveryEnvelope({ event: events[0], evaluatorConfig: views.evaluator });
  const firstRaw = canonicalMonitoringJson(first);
  const partial = path.join(roots.outbox, "events", `.prepare.${monitoringSha256(Buffer.from(firstRaw))}.${"1".repeat(32)}.tmp`);
  await writeFile(partial, "{", { mode: 0o400 });
  await publishDeliveryEnvelope(roots.outbox, first);
  assert.deepEqual((await readdir(path.join(roots.outbox, "events"))).sort(), [`${first.event_id}.json`]);

  const second = createDeliveryEnvelope({ event: events[1], evaluatorConfig: views.evaluator });
  const secondRaw = canonicalMonitoringJson(second);
  const prepared = path.join(roots.outbox, "events", `.prepare.${monitoringSha256(Buffer.from(secondRaw))}.${"2".repeat(32)}.tmp`);
  await writeFile(prepared, secondRaw, { mode: 0o400 });
  await link(prepared, path.join(roots.outbox, "events", `${second.event_id}.json`));
  const read = await readDeliveryEnvelopes(roots.outbox);
  assert.deepEqual(new Set(read.map((entry) => entry.event_id)), new Set([first.event_id, second.event_id]));
  await publishDeliveryEnvelope(roots.outbox, second);
  assert.equal((await readdir(path.join(roots.outbox, "events"))).some((name) => name.startsWith(".prepare.")), false);
});

test("inherited state lock requires a kernel FLOCK proof on the exact inode", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "erp-monitor-lock-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const stateRoot = path.join(temporary, "state");
  await mkdir(stateRoot, { mode: 0o700 });
  const lockPath = path.join(stateRoot, MONITORING_HOST_STATE_LOCK);
  await writeFile(lockPath, "chenyida-erp-monitoring-flock/v1\n", { mode: 0o600 });
  const unlocked = await open(lockPath, "r");
  const previousLaunch = process.env.ERP_MONITORING_HOST_LAUNCHED;
  const previousFd = process.env.ERP_MONITORING_LOCK_FD;
  process.env.ERP_MONITORING_HOST_LAUNCHED = "YES";
  process.env.ERP_MONITORING_LOCK_FD = String(unlocked.fd);
  try {
    assert.throws(() => assertInheritedMonitoringLock(stateRoot, unlocked.fd), (error) => error.code === "MONITOR_HOST_LOCK_NOT_HELD");
  } finally {
    await unlocked.close();
    if (previousLaunch === undefined) delete process.env.ERP_MONITORING_HOST_LAUNCHED; else process.env.ERP_MONITORING_HOST_LAUNCHED = previousLaunch;
    if (previousFd === undefined) delete process.env.ERP_MONITORING_LOCK_FD; else process.env.ERP_MONITORING_LOCK_FD = previousFd;
  }
  const helper = path.join(temporary, "lock-helper.mjs");
  const moduleUrl = new URL("../tools/ops-monitoring/host-store.mjs", import.meta.url).href;
  await writeFile(helper, `import { assertInheritedMonitoringLock } from ${JSON.stringify(moduleUrl)};\nassertInheritedMonitoringLock(process.argv[2], 9);\nprocess.stdout.write("LOCK_VERIFIED\\n");\n`, { mode: 0o600 });
  const child = spawnSync("/bin/sh", ["-c", `exec 9<\"$1/${MONITORING_HOST_STATE_LOCK}\"; /usr/bin/flock -n 9; export ERP_MONITORING_HOST_LAUNCHED=YES ERP_MONITORING_LOCK_FD=9; exec \"$2\" \"$3\" \"$1\"`, "monitor-lock-helper", stateRoot, process.execPath, helper], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "LOCK_VERIFIED\n");
});

test("host state PREPARED journal completes exactly and an unjournaled orphan rolls back", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "erp-monitor-state-recovery-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const stateRoot = path.join(temporary, "state");
  await initializeMonitoringHostStateRoot(stateRoot);
  const views = deriveMonitoringHostConfigViews(hostConfig());
  const monitoringState = evaluatedFixture().result.nextState;
  const configPath = path.join(temporary, "evaluator.json");
  const policyPath = path.join(temporary, "policy.json");
  const monitoringStatePath = path.join(temporary, "monitoring-state.json");
  await writeFile(configPath, canonicalMonitoringJson(views.evaluator), { mode: 0o600 });
  await writeFile(policyPath, canonicalMonitoringJson(policy), { mode: 0o600 });
  await writeFile(monitoringStatePath, canonicalMonitoringJson(monitoringState), { mode: 0o600 });
  const helper = path.join(temporary, "state-recovery-helper.mjs");
  const hostStoreUrl = new URL("../tools/ops-monitoring/host-store.mjs", import.meta.url).href;
  const contractUrl = new URL("../tools/ops-monitoring/contract.mjs", import.meta.url).href;
  const helperSource = `
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalMonitoringJson, monitoringSha256, parseMonitoringJson } from ${JSON.stringify(contractUrl)};
import { MONITORING_HOST_STATE_TRANSACTION, createMonitoringHostState, recoverMonitoringHostStateWrite, writeMonitoringHostState } from ${JSON.stringify(hostStoreUrl)};
const [root, configFile, policyFile, stateFile] = process.argv.slice(2);
const config = parseMonitoringJson(await readFile(configFile, "utf8"));
const policy = parseMonitoringJson(await readFile(policyFile, "utf8"));
const monitoringState = parseMonitoringJson(await readFile(stateFile, "utf8"));
const first = createMonitoringHostState({ evaluatorConfig: config, policy, monitoringState, updatedAt: "2026-08-13T00:10:00.000Z" });
const persisted = await writeMonitoringHostState(root, first, config, policy, 9);
const second = createMonitoringHostState({ previous: persisted, evaluatorConfig: config, policy, monitoringState, updatedAt: "2026-08-13T00:10:01.000Z" });
const temporaryName = \`.current.\${second.wrapper_sequence}.\${second.integrity_sha256}.tmp\`;
const temporaryPath = path.join(root, temporaryName);
let handle = await open(temporaryPath, "wx", 0o600);
await handle.writeFile(canonicalMonitoringJson(second));
await handle.sync();
await handle.close();
const metadata = await stat(temporaryPath);
const transaction = { schema_version: 1, contract: "chenyida-erp-monitoring-state-write/v1", transaction_id: "", temporary: temporaryName, temporary_dev: metadata.dev, temporary_ino: metadata.ino, temporary_bytes: metadata.size, previous_wrapper_sha256: persisted.integrity_sha256, new_wrapper_sha256: second.integrity_sha256 };
transaction.transaction_id = monitoringSha256({ ...transaction, transaction_id: undefined });
handle = await open(path.join(root, MONITORING_HOST_STATE_TRANSACTION), "wx", 0o600);
await handle.writeFile(canonicalMonitoringJson(transaction));
await handle.sync();
await handle.close();
const recovered = await recoverMonitoringHostStateWrite(root, config, policy, 9);
if (recovered.integrity_sha256 !== second.integrity_sha256) throw new Error("prepared transaction was not completed");
const orphan = createMonitoringHostState({ previous: recovered, evaluatorConfig: config, policy, monitoringState, updatedAt: "2026-08-13T00:10:02.000Z" });
const orphanName = \`.current.\${orphan.wrapper_sequence}.\${orphan.integrity_sha256}.tmp\`;
handle = await open(path.join(root, orphanName), "wx", 0o600);
await handle.writeFile(canonicalMonitoringJson(orphan));
await handle.sync();
await handle.close();
const unchanged = await recoverMonitoringHostStateWrite(root, config, policy, 9);
if (unchanged.integrity_sha256 !== recovered.integrity_sha256) throw new Error("unjournaled orphan was activated");
const interrupted = createMonitoringHostState({ previous: unchanged, evaluatorConfig: config, policy, monitoringState, updatedAt: "2026-08-13T00:10:03.000Z" });
const interruptedName = \`.current.\${interrupted.wrapper_sequence}.\${interrupted.integrity_sha256}.tmp\`;
handle = await open(path.join(root, interruptedName), "wx", 0o600);
await handle.writeFile(canonicalMonitoringJson(interrupted));
await handle.sync();
await handle.close();
handle = await open(path.join(root, \`.state-write-prepared.\${"f".repeat(64)}.tmp\`), "wx", 0o600);
await handle.writeFile("{");
await handle.sync();
await handle.close();
const partialRecovered = await recoverMonitoringHostStateWrite(root, config, policy, 9);
if (partialRecovered.integrity_sha256 !== unchanged.integrity_sha256) throw new Error("partial journal temporary was activated");
process.stdout.write("STATE_RECOVERY_VERIFIED\\n");
`;
  await writeFile(helper, helperSource, { mode: 0o600 });
  const child = spawnSync("/bin/sh", ["-c", `exec 9<\"$1/${MONITORING_HOST_STATE_LOCK}\"; /usr/bin/flock -n 9; export ERP_MONITORING_HOST_LAUNCHED=YES ERP_MONITORING_LOCK_FD=9; exec \"$2\" \"$3\" \"$1\" \"$4\" \"$5\" \"$6\"`, "monitor-state-helper", stateRoot, process.execPath, helper, configPath, policyPath, monitoringStatePath], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "STATE_RECOVERY_VERIFIED\n");
});

test("host wrapper accepts one explicit config generation and rejects skipped lineage", () => {
  const { result } = evaluatedFixture();
  const firstHost = hostConfig();
  const firstViews = deriveMonitoringHostConfigViews(firstHost);
  const componentsWatermark = componentsProjectionWatermark(componentsProjectionFixture());
  const first = createMonitoringHostState({ evaluatorConfig: firstViews.evaluator, policy, monitoringState: result.nextState, componentsWatermark, updatedAt: observedAt });
  assert.equal(validateMonitoringHostState(first, firstViews.evaluator, policy), first);
  const nextHost = hostConfig({
    configGeneration: 2,
    previousConfigSha256: monitoringSha256(firstHost),
    activationId: "monitoring-activation-v2",
    installationGeneration: 2,
  });
  const nextViews = deriveMonitoringHostConfigViews(nextHost);
  const next = createMonitoringHostState({ previous: first, evaluatorConfig: nextViews.evaluator, policy, monitoringState: result.nextState, updatedAt: observedAt });
  assert.equal(next.previous_wrapper_sha256, first.integrity_sha256);
  assert.deepEqual(next.components_watermark, componentsWatermark);
  const skippedHost = hostConfig({
    configGeneration: 3,
    previousConfigSha256: monitoringSha256(nextHost),
    activationId: "monitoring-activation-v3",
    installationGeneration: 3,
  });
  assert.throws(
    () => createMonitoringHostState({ previous: first, evaluatorConfig: deriveMonitoringHostConfigViews(skippedHost).evaluator, policy, monitoringState: result.nextState, updatedAt: observedAt }),
    (error) => error.code === "MONITOR_HOST_CONFIG_TRANSITION_INVALID",
  );
});
