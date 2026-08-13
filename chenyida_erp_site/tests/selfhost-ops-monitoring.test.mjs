import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MONITORING_CONFIG_CONTRACT,
  MONITORING_OBSERVATION_CONTRACT,
  canonicalMonitoringJson,
  emptyComponentObservation,
  evaluateMonitoringObservation,
  monitoringResourcePolicy,
  monitoringSha256,
  parseMonitoringJson,
  validateMonitoringConfig,
  validateMonitoringObservation,
  validateMonitoringPolicy,
} from "../tools/ops-monitoring/contract.mjs";
import { DOCKER_INSPECT_FORMAT, collectMonitoringObservation } from "../tools/ops-monitoring/collector.mjs";
import {
  MONITORING_STATE_FILE,
  MONITORING_STATE_LOCK,
  initializeMonitoringStateRoot,
  readMonitoringState,
  validateMonitoringStateRoot,
  withMonitoringStateLock,
  writeMonitoringState,
} from "../tools/ops-monitoring/state-store.mjs";

const policy = validateMonitoringPolicy(parseMonitoringJson(await readFile(new URL("../operations/monitoring-policy-v1.json", import.meta.url), "utf8")));
const resourcePlan = parseMonitoringJson(await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8"));
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const originMs = Date.parse("2026-08-13T00:00:00.000Z");
const digest = (character) => `sha256:${character.repeat(64)}`;
const image = (service, character) => `registry.internal/chenyida/${service}@${digest(character)}`;
const serviceCharacters = { caddy: "1", postgres: "2", web: "a", worker: "b" };

function configFixture({ deploymentClass = "TEST", notificationRequired = false } = {}) {
  return validateMonitoringConfig({
    schema_version: 1,
    contract: MONITORING_CONFIG_CONTRACT,
    config_id: "fixture-monitoring-v1",
    deployment_class: deploymentClass,
    deployment_id: "erp-fixture",
    compose_project: "erp-fixture",
    service_expectations: ["caddy", "postgres", "web", "worker"].map((service) => ({
      service,
      container_name: `erp-fixture-${service}-1`,
      image_reference: image(service, serviceCharacters[service]),
    })),
    release_expectation: {
      application_version: "0.1.0-alpha.46",
      git_commit: "3".repeat(40),
      release_manifest_sha256: "4".repeat(64),
      supervisor_bundle_sha256: "5".repeat(64),
      migration_head: "0045_runtime_worker_readiness.sql",
      migration_manifest_sha256: "6".repeat(64),
      web_image_digest: digest("a"),
      worker_image_digest: digest("b"),
    },
    backup_expectation: { policy_id: "daily-rpo-v1", rpo_hours: 24 },
    notification: notificationRequired ? { required: true, target_id: "primary-oncall" } : { required: false, target_id: null },
  });
}

function serviceFixture(service, index) {
  return {
    service,
    container_name: `erp-fixture-${service}-1`,
    container_id: String(index + 1).repeat(64),
    image_id: digest(String(index + 5)),
    image_reference: image(service, serviceCharacters[service]),
    status: "running",
    health: service === "caddy" ? "none" : "healthy",
    restart_count: 0,
    oom_killed: false,
  };
}

function componentsFixture(observedAt, notification = { status: "UNCONFIGURED", target_id: null }) {
  return {
    application: {
      live: { status: "PASS", observed_at: observedAt, version: "0.1.0-alpha.46", code: null },
      readiness: { status: "READY", observed_at: observedAt, version: "0.1.0-alpha.46", revision: "3".repeat(12), migration_head: "0045_runtime_worker_readiness.sql", code: null },
    },
    release: {
      status: "MATCHED",
      observed_at: observedAt,
      generated_at: new Date(originMs).toISOString(),
      release_manifest_sha256: "4".repeat(64),
      supervisor_bundle_sha256: "5".repeat(64),
      application_version: "0.1.0-alpha.46",
      git_commit: "3".repeat(40),
      migration_head: "0045_runtime_worker_readiness.sql",
      migration_manifest_sha256: "6".repeat(64),
      web_image_digest: digest("a"),
      worker_image_digest: digest("b"),
    },
    backup: {
      status: "AVAILABLE",
      observed_at: observedAt,
      verification_status: "RESTORE_VERIFIED",
      identity_status: "MATCHED",
      policy_status: "MATCHED",
      assurance_status: "MATCHED",
      recovery_ready: true,
      recovery_point_at: new Date(originMs).toISOString(),
      expires_at: new Date(originMs + 24 * 60 * 60 * 1000).toISOString(),
      policy_id: "daily-rpo-v1",
      rpo_hours: 24,
    },
    notification,
  };
}

function observationFixture({
  seconds = 0,
  host = {},
  services = null,
  components = null,
  source = "SYNTHETIC_TEST",
  id = null,
} = {}) {
  const observedAt = new Date(originMs + seconds * 1000).toISOString();
  const componentValues = components || componentsFixture(observedAt);
  return validateMonitoringObservation({
    schema_version: 1,
    contract: MONITORING_OBSERVATION_CONTRACT,
    observation_id: id || `fixture-${String(seconds).replaceAll(".", "-")}`,
    observed_at: observedAt,
    source,
    policy_sha256: monitoringSha256(policy),
    resource_policy_sha256: policy.resource_policy_source.sha256,
    host: {
      boot_id_sha256: "7".repeat(64),
      monotonic_milliseconds: 1_000_000 + Math.round(seconds * 1000),
      available_memory_bytes: 2048 * MiB,
      swap_total_bytes: 1024 * MiB,
      swap_free_bytes: 924 * MiB,
      root_free_bytes: 20 * GiB,
      load_1m: 1,
      oom_kill_count: 0,
      ...host,
    },
    services: services || ["caddy", "postgres", "web", "worker"].map(serviceFixture),
    application: componentValues.application,
    release: componentValues.release,
    backup: componentValues.backup,
    notification: componentValues.notification,
  });
}

function evaluate(observation, previousState = null, config = configFixture(), now = new Date(observation.observed_at)) {
  return evaluateMonitoringObservation({ policy, resourcePlan, config, observation, previousState, now });
}

function codes(value) {
  return value.report.active_alerts.map((alert) => alert.code);
}

test("monitoring policy binds the one official resource policy and strict inputs fail closed", () => {
  assert.equal(monitoringResourcePolicy(resourcePlan, policy).min_available_memory_mib, 768);
  assert.equal(policy.resource_policy_source.sha256, monitoringSha256(resourcePlan.resource_policy));
  assert.equal(Object.hasOwn(policy, "resources"), false);
  assert.throws(() => monitoringResourcePolicy({ ...resourcePlan, resource_policy: { ...resourcePlan.resource_policy, max_load_1m: 3 } }, policy), (error) => ["MONITOR_RESOURCE_PLAN_INVALID", "MONITOR_RESOURCE_POLICY_SHA256_MISMATCH"].includes(error.code));
  assert.throws(() => parseMonitoringJson('{"schema_version":1,"schema_version":1}'), (error) => error.code === "MONITOR_JSON_INVALID");
  assert.throws(() => parseMonitoringJson(`{"value":1e999}`), (error) => error.code === "MONITOR_JSON_INVALID");
  assert.throws(() => parseMonitoringJson(`{"value":"bad\u0000control"}`), (error) => error.code === "MONITOR_JSON_INVALID");
  assert.throws(() => parseMonitoringJson(`{"value":"${"x".repeat(1024 * 1024)}"}`), (error) => error.code === "MONITOR_JSON_INVALID");
  assert.throws(() => parseMonitoringJson(`${"[".repeat(20_000)}0${"]".repeat(20_000)}`), (error) => error.code === "MONITOR_JSON_INVALID");
  const valid = observationFixture();
  assert.throws(() => validateMonitoringObservation({ ...valid, unknown: true }), (error) => error.code === "MONITOR_OBSERVATION_FIELDS_INVALID");
  assert.throws(() => validateMonitoringObservation({ ...valid, policy_sha256: "0".repeat(64) }) && evaluate({ ...valid, policy_sha256: "0".repeat(64) }), (error) => error.code === "MONITOR_OBSERVATION_POLICY_MISMATCH");
  assert.throws(() => validateMonitoringObservation({ ...valid, host: { ...valid.host, load_1m: -0 } }), (error) => error.code === "MONITOR_OBSERVATION_HOST_INVALID");
  assert.throws(() => validateMonitoringObservation({ ...valid, services: [valid.services[0], valid.services[0]] }), (error) => error.code === "MONITOR_OBSERVATION_SERVICE_INVALID");
  assert.throws(() => validateMonitoringObservation({ ...valid, release: { ...valid.release, generated_at: "2026-99-99T00:00:00.000Z" } }), (error) => error.code === "MONITOR_OBSERVATION_RELEASE_INVALID");
  const collected = emptyComponentObservation();
  assert.throws(() => validateMonitoringObservation({ ...valid, source: "HOST_METADATA_ONLY", application: componentsFixture(valid.observed_at).application, release: collected.release, backup: collected.backup, notification: collected.notification }), (error) => error.code === "MONITOR_OBSERVATION_SOURCE_INVALID");
});

test("resource boundaries are exact and all simultaneous breaches are retained", () => {
  const equal = observationFixture({ host: { available_memory_bytes: 768 * MiB, swap_total_bytes: 5 * MiB, swap_free_bytes: MiB, root_free_bytes: 10 * GiB, load_1m: 4 } });
  const equalResult = evaluate(equal);
  for (const code of ["HOST_MEMORY_AVAILABLE_LOW", "HOST_SWAP_USAGE_HIGH", "HOST_ROOT_FREE_LOW", "HOST_LOAD_SUSTAINED_HIGH"]) assert.equal(codes(equalResult).includes(code), false, code);
  const breached = observationFixture({ host: { available_memory_bytes: 768 * MiB - 1, swap_total_bytes: 5 * MiB, swap_free_bytes: MiB - 1, root_free_bytes: 10 * GiB - 1, load_1m: 5 } });
  const result = evaluate(breached);
  for (const code of ["HOST_MEMORY_AVAILABLE_LOW", "HOST_SWAP_USAGE_HIGH", "HOST_ROOT_FREE_LOW"]) assert.ok(codes(result).includes(code), code);
  assert.equal(codes(result).includes("HOST_LOAD_SUSTAINED_HIGH"), false);
});

test("swap growth requires a complete 60-second window and uses a strict greater-than boundary", () => {
  const initial = evaluate(observationFixture({ host: { swap_free_bytes: 924 * MiB } }));
  assert.ok(codes(initial).includes("MONITOR_SWAP_WINDOW_INCOMPLETE"));
  const equal = evaluate(observationFixture({ seconds: 60, host: { swap_free_bytes: 668 * MiB } }), initial.nextState);
  assert.equal(codes(equal).includes("MONITOR_SWAP_WINDOW_INCOMPLETE"), false);
  assert.equal(codes(equal).includes("HOST_SWAP_GROWTH_HIGH"), false);
  const above = evaluate(observationFixture({ seconds: 60, id: "fixture-growth-above", host: { swap_free_bytes: 668 * MiB - 1 } }), initial.nextState);
  assert.ok(codes(above).includes("HOST_SWAP_GROWTH_HIGH"));
});

test("load fires only after an unbroken 180-second greater-than window", () => {
  let state = null;
  let result;
  for (const seconds of [0, 60, 120, 179]) {
    result = evaluate(observationFixture({ seconds, host: { load_1m: 4.001 } }), state);
    state = result.nextState;
  }
  assert.equal(codes(result).includes("HOST_LOAD_SUSTAINED_HIGH"), false);
  result = evaluate(observationFixture({ seconds: 180, host: { load_1m: 4.001 } }), state);
  assert.ok(codes(result).includes("HOST_LOAD_SUSTAINED_HIGH"));
  let equalState = null;
  for (const seconds of [0, 60, 120, 180]) {
    const load = seconds === 60 ? 4 : 4.001;
    result = evaluate(observationFixture({ seconds, id: `equal-load-${seconds}`, host: { load_1m: load } }), equalState);
    equalState = result.nextState;
  }
  assert.equal(codes(result).includes("HOST_LOAD_SUSTAINED_HIGH"), false);
  const gap = evaluate(observationFixture({ seconds: 400, host: { load_1m: 9 } }), state);
  assert.equal(codes(gap).includes("HOST_LOAD_SUSTAINED_HIGH"), false);
  assert.ok(codes(gap).includes("MONITOR_LOAD_WINDOW_INCOMPLETE"));
});

test("state machine deduplicates, reminds, escalates, recovers, and never recovers through UNKNOWN", () => {
  const low = observationFixture({ host: { available_memory_bytes: 700 * MiB } });
  const first = evaluate(low);
  assert.ok(first.report.events.some((event) => event.code === "HOST_MEMORY_AVAILABLE_LOW" && event.event_type === "FIRING"));
  const repeated = evaluate(observationFixture({ seconds: 60, host: { available_memory_bytes: 700 * MiB } }), first.nextState);
  assert.equal(repeated.report.events.some((event) => event.code === "HOST_MEMORY_AVAILABLE_LOW"), false);
  const reminder = evaluate(observationFixture({ seconds: 3600, host: { available_memory_bytes: 700 * MiB } }), repeated.nextState);
  assert.ok(reminder.report.events.some((event) => event.code === "HOST_MEMORY_AVAILABLE_LOW" && event.event_type === "REMINDER"));
  const recovered = evaluate(observationFixture({ seconds: 3660, host: { available_memory_bytes: 900 * MiB } }), reminder.nextState);
  assert.ok(recovered.report.events.some((event) => event.code === "HOST_MEMORY_AVAILABLE_LOW" && event.event_type === "RECOVERED"));

  const baseline = evaluate(observationFixture({ id: "escalation-base" }));
  const gapped = evaluate(observationFixture({ seconds: 100, id: "escalation-gap" }), baseline.nextState);
  assert.ok(gapped.report.events.some((event) => event.code === "MONITOR_STATE_GAP" && event.event_type === "FIRING"));
  const staleObservation = observationFixture({ seconds: 160, id: "escalation-stale" });
  const escalated = evaluate(staleObservation, gapped.nextState, configFixture(), new Date(Date.parse(staleObservation.observed_at) + 121_000));
  assert.ok(escalated.report.events.some((event) => event.code === "MONITOR_OBSERVATION_STALE" && event.event_type === "ESCALATED"));

  const failedComponents = componentsFixture(new Date(originMs).toISOString());
  failedComponents.application.live = { status: "FAIL", observed_at: new Date(originMs).toISOString(), version: null, code: "APPLICATION_HTTP_FAILED" };
  const failed = evaluate(observationFixture({ id: "live-failed", components: failedComponents }));
  const unknown = emptyComponentObservation();
  const unknownResult = evaluate(observationFixture({ seconds: 60, id: "live-unknown", components: { ...componentsFixture(new Date(originMs + 60_000).toISOString()), application: unknown.application } }), failed.nextState);
  assert.ok(codes(unknownResult).includes("APPLICATION_LIVENESS_FAILED"));
  assert.equal(unknownResult.report.events.some((event) => event.code === "APPLICATION_LIVENESS_FAILED" && event.event_type === "RECOVERED"), false);

  const staleComponents = componentsFixture(new Date(originMs).toISOString());
  const staleResult = evaluate(observationFixture({ seconds: 180, id: "live-stale", components: staleComponents }), failed.nextState);
  assert.ok(codes(staleResult).includes("APPLICATION_LIVENESS_FAILED"));
  assert.equal(staleResult.report.events.some((event) => event.code === "APPLICATION_LIVENESS_FAILED" && event.event_type === "RECOVERED"), false);

  const staleWholeObservation = observationFixture({ seconds: 60, id: "whole-observation-stale", host: { available_memory_bytes: 900 * MiB } });
  const staleWholeResult = evaluate(staleWholeObservation, first.nextState, configFixture(), new Date(Date.parse(staleWholeObservation.observed_at) + 121_000));
  assert.ok(codes(staleWholeResult).includes("HOST_MEMORY_AVAILABLE_LOW"));
  assert.equal(staleWholeResult.report.events.some((event) => event.code === "HOST_MEMORY_AVAILABLE_LOW" && event.event_type === "RECOVERED"), false);
});

test("a nonzero host OOM history remains active until a controlled new baseline", () => {
  const first = evaluate(observationFixture({ host: { oom_kill_count: 1 } }));
  assert.ok(codes(first).includes("HOST_OOM_HISTORY_PRESENT"));
  const unchanged = evaluate(observationFixture({ seconds: 60, host: { oom_kill_count: 1 } }), first.nextState);
  assert.ok(codes(unchanged).includes("HOST_OOM_HISTORY_PRESENT"));
  assert.equal(unchanged.report.events.some((event) => event.code === "HOST_OOM_HISTORY_PRESENT" && event.event_type === "RECOVERED"), false);
});

test("notification absence is explicit and events are transactionally retained as pending", () => {
  const config = configFixture({ deploymentClass: "UAT", notificationRequired: true });
  const first = evaluate(observationFixture(), null, config);
  assert.equal(first.report.delivery_state, "NOT_CONFIGURED");
  assert.equal(first.report.exit_code, 2);
  assert.ok(first.nextState.pending_events.length > 0);
  assert.ok(first.nextState.pending_events.every((event) => event.delivery.status === "NOT_CONFIGURED" && event.delivery.target_id === "primary-oncall"));
  const readyComponents = componentsFixture(new Date(originMs + 60_000).toISOString(), { status: "READY", target_id: "primary-oncall" });
  const ready = evaluate(observationFixture({ seconds: 60, components: readyComponents }), first.nextState, config);
  assert.ok(ready.report.events.some((event) => event.code === "ALERT_DELIVERY_NOT_CONFIGURED" && event.event_type === "RECOVERED" && event.delivery.status === "PENDING"));
  assert.ok(ready.nextState.pending_events.length > first.nextState.pending_events.length);
});

test("service policy permits Caddy without health but fails every Worker and runtime service breach", () => {
  const services = observationFixture().services
    .filter((service) => service.service !== "postgres")
    .map((service) => {
      if (service.service === "worker") return { ...service, health: "none" };
      if (service.service === "web") return { ...service, image_reference: "legacy-web:latest", status: "exited", restart_count: 2, oom_killed: true };
      return service;
    });
  const result = evaluate(observationFixture({ services }));
  for (const code of ["SERVICE_MISSING", "SERVICE_IMAGE_MISMATCH", "SERVICE_NOT_RUNNING", "SERVICE_RESTARTED", "SERVICE_OOM_KILLED", "SERVICE_HEALTH_UNAVAILABLE"]) assert.ok(codes(result).includes(code), code);
  assert.equal(result.report.active_alerts.some((alert) => alert.dedupe_key === "service.caddy.health"), false);
});

test("application, release, migration, backup, and assurance mismatches fail together", () => {
  const at = new Date(originMs).toISOString();
  const components = componentsFixture(at, { status: "READY", target_id: "primary-oncall" });
  components.application.live = { status: "FAIL", observed_at: at, version: null, code: "APPLICATION_HTTP_FAILED" };
  components.application.readiness = { status: "NOT_READY", observed_at: at, version: null, revision: null, migration_head: null, code: "RUNTIME_MIGRATION_SOURCE_INVALID" };
  components.release = { ...components.release, status: "MISMATCH", git_commit: "f".repeat(40) };
  components.backup = { ...components.backup, identity_status: "MISMATCH", policy_status: "MISMATCH", assurance_status: "MISMATCH", recovery_ready: false, policy_id: "unexpected-policy", rpo_hours: 12 };
  const result = evaluate(observationFixture({ components }));
  for (const code of ["APPLICATION_LIVENESS_FAILED", "APPLICATION_MIGRATION_MISMATCH", "RELEASE_IDENTITY_MISMATCH", "BACKUP_IDENTITY_MISMATCH", "BACKUP_POLICY_MISMATCH", "BACKUP_ASSURANCE_MISMATCH", "BACKUP_RECOVERY_NOT_READY"]) assert.ok(codes(result).includes(code), code);
});

test("wall clock, monotonic time, OOM and service counters cannot roll back silently", () => {
  const first = evaluate(observationFixture());
  assert.throws(() => evaluate(observationFixture({ id: "wall-clock-same" }), first.nextState), (error) => error.code === "MONITOR_OBSERVATION_TIME_ROLLBACK");
  assert.throws(() => evaluate(observationFixture({ seconds: 60, host: { monotonic_milliseconds: first.nextState.last_monotonic_milliseconds } }), first.nextState), (error) => error.code === "MONITOR_MONOTONIC_TIME_ROLLBACK");
  const oom = evaluate(observationFixture({ seconds: 60, host: { oom_kill_count: 2 } }), first.nextState);
  assert.ok(codes(oom).includes("HOST_OOM_DETECTED"));
  assert.throws(() => evaluate(observationFixture({ seconds: 120, host: { oom_kill_count: 1 } }), oom.nextState), (error) => error.code === "MONITOR_OOM_COUNTER_ROLLBACK");
  const restartedServices = structuredClone(first.nextState.service_instances);
  restartedServices[2].restart_count = 2;
  const modifiedState = { ...first.nextState, service_instances: restartedServices, integrity_sha256: "" };
  const body = { ...modifiedState };
  delete body.integrity_sha256;
  modifiedState.integrity_sha256 = monitoringSha256(body);
  const serviceRollback = observationFixture({ seconds: 60, services: observationFixture({ seconds: 60 }).services.map((service) => service.service === "web" ? { ...service, restart_count: 1 } : service) });
  assert.throws(() => evaluate(serviceRollback, modifiedState), (error) => error.code === "MONITOR_SERVICE_COUNTER_ROLLBACK");
});

test("collector reads only bounded host and Docker metadata and handles a missing Health key safely", async () => {
  const config = configFixture();
  const ids = ["1", "2", "3", "4"].map((character) => character.repeat(64));
  const invocations = [];
  const spawn = (command, args, options) => {
    invocations.push({ command, args, options });
    if (args[0] === "ps") return { status: 0, stdout: `${ids.join("\n")}\n`, stderr: "" };
    const lines = ["caddy", "postgres", "web", "worker"].map((service, index) => JSON.stringify({
      container_id: ids[index],
      service,
      project: "erp-fixture",
      container_name: `/erp-fixture-${service}-1`,
      image_id: digest(String(index + 5)),
      image_reference: image(service, serviceCharacters[service]),
      status: "running",
      health: service === "caddy" ? "none" : "healthy",
      restart_count: 0,
      oom_killed: false,
    }));
    return { status: 0, stdout: `${lines.join("\n")}\n`, stderr: "SECRET_DOCKER_ERROR_MUST_NOT_ESCAPE" };
  };
  const values = new Map([
    ["/proc/meminfo", "MemAvailable:       2097152 kB\nSwapTotal:       1048576 kB\nSwapFree:         921600 kB\n"],
    ["/proc/vmstat", "nr_free_pages 1\noom_kill 0\n"],
    ["/proc/loadavg", "0.12 0.07 0.11 1/100 123\n"],
    ["/proc/uptime", "1234.56 2345.67\n"],
    ["/proc/sys/kernel/random/boot_id", "123e4567-e89b-42d3-a456-426614174000\n"],
  ]);
  const observation = await collectMonitoringObservation({
    policy,
    resourcePlan,
    config,
    clock: () => new Date(originMs),
    readText: async (file) => values.get(file),
    statfsImpl: async () => ({ bavail: 20 * GiB / 4096, bsize: 4096 }),
    spawn,
  });
  assert.equal(observation.source, "HOST_METADATA_ONLY");
  assert.equal(observation.services.length, 4);
  assert.equal(observation.services[0].health, "none");
  assert.match(DOCKER_INSPECT_FORMAT, /index \.State "Health"/);
  assert.doesNotMatch(DOCKER_INSPECT_FORMAT, /\.State\.Health\}\}/);
  const invocationText = JSON.stringify(invocations);
  for (const forbidden of ["Config.Env", "Mounts", "NetworkSettings", "logs", "DOCKER_HOST", "HTTP_PROXY", "SECRET_DOCKER_ERROR"]) assert.equal(invocationText.includes(forbidden), false, forbidden);
  assert.ok(invocations.every((call) => call.command === "/usr/bin/docker" && call.options.timeout === 30_000 && call.options.maxBuffer === 128 * 1024 && call.options.env.HOME === "/nonexistent"));
});

test("state root is private, atomic, chained, fail-closed, and non-blocking under contention", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-monitor-state-parent-"));
  await chmod(parent, 0o700);
  const root = path.join(parent, "state");
  const config = configFixture();
  try {
    await initializeMonitoringStateRoot(root);
    assert.equal((await lstat(root)).mode & 0o7777, 0o700);
    const result = evaluate(observationFixture());
    await withMonitoringStateLock(root, () => writeMonitoringState(root, result.nextState, config, policy));
    assert.equal((await lstat(path.join(root, MONITORING_STATE_FILE))).mode & 0o7777, 0o600);
    assert.equal((await readMonitoringState(root, config, policy)).integrity_sha256, result.nextState.integrity_sha256);
    await assert.rejects(withMonitoringStateLock(root, () => writeMonitoringState(root, result.nextState, config, policy)), (error) => error.code === "MONITOR_STATE_CHAIN_INVALID");

    let release;
    const blocker = new Promise((resolve) => { release = resolve; });
    const first = withMonitoringStateLock(root, async () => blocker);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await lstat(path.join(root, MONITORING_STATE_LOCK)).then(() => true).catch(() => false)) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(withMonitoringStateLock(root, async () => undefined), (error) => error.code === "MONITOR_STATE_LOCKED");
    release();
    await first;

    await writeFile(path.join(root, "unexpected.tmp"), "partial", { mode: 0o600 });
    await assert.rejects(validateMonitoringStateRoot(root), (error) => error.code === "MONITOR_STATE_ROOT_ENTRY_INVALID");
    await rm(path.join(root, "unexpected.tmp"));
    await writeFile(path.join(root, MONITORING_STATE_FILE), "{}\n", { mode: 0o600 });
    await assert.rejects(readMonitoringState(root, config, policy), (error) => error.code === "MONITOR_STATE_FIELDS_INVALID");
    await unlink(path.join(root, MONITORING_STATE_FILE));
    await symlink("missing.json", path.join(root, MONITORING_STATE_FILE));
    await assert.rejects(readMonitoringState(root, config, policy), (error) => ["MONITOR_STATE_ROOT_ENTRY_INVALID", "MONITOR_STATE_FILE_UNSAFE"].includes(error.code));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("CLI emits only canonical reports or a stable redacted error", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-monitor-cli-parent-"));
  await chmod(parent, 0o700);
  const stateRoot = path.join(parent, "state");
  const files = {
    policy: path.join(parent, "policy.json"),
    plan: path.join(parent, "plan.json"),
    config: path.join(parent, "config.json"),
    observation: path.join(parent, "observation.json"),
  };
  const config = { ...configFixture(), config_id: "TOKEN-CANARY-MUST-NOT-ESCAPE" };
  try {
    await initializeMonitoringStateRoot(stateRoot);
    for (const [file, value] of [[files.policy, policy], [files.plan, resourcePlan], [files.config, config], [files.observation, observationFixture()]]) {
      const serialized = file === files.plan ? await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8") : canonicalMonitoringJson(value);
      await writeFile(file, serialized, { mode: 0o600 });
      await chmod(file, 0o600);
    }
    const cli = new URL("../tools/ops-monitoring/cli.mjs", import.meta.url).pathname;
    const args = [cli, "evaluate", "--policy", files.policy, "--resource-plan", files.plan, "--config", files.config, "--observation", files.observation, "--state-root", stateRoot];
    const success = spawnSync(process.execPath, args, { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
    assert.equal(success.status, 1, success.stderr);
    assert.equal(success.stderr, "");
    assert.equal(parseMonitoringJson(success.stdout).contract, "chenyida-erp-operations-monitoring-report/v1");
    assert.equal(`${success.stdout}${success.stderr}`.includes("TOKEN-CANARY-MUST-NOT-ESCAPE"), false);

    await writeFile(files.config, '{"secret":"TOKEN-CANARY-MUST-NOT-ESCAPE"}\n', { mode: 0o600 });
    const failed = spawnSync(process.execPath, args, { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
    assert.equal(failed.status, 3);
    assert.equal(failed.stdout, "");
    const error = parseMonitoringJson(failed.stderr);
    assert.equal(error.code, "MONITOR_CONFIG_FIELDS_INVALID");
    assert.equal(failed.stderr.includes("TOKEN-CANARY-MUST-NOT-ESCAPE"), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("serialized report, events, and state expose no raw URLs, paths, Docker errors, or exceptions", () => {
  const config = { ...configFixture(), config_id: "Authorization-Cookie-Token" };
  const result = evaluate(observationFixture({ host: { available_memory_bytes: 1 } }), null, config);
  const output = `${canonicalMonitoringJson(result.report)}${canonicalMonitoringJson(result.nextState)}`;
  for (const forbidden of ["Authorization", "Cookie", "Token", "postgresql://", "https://", "/var/lib/", "SECRET", "Error:", " at "]) assert.equal(output.includes(forbidden), false, forbidden);
  assert.ok(result.report.active_alerts.every((alert) => /^[A-Z0-9_]+$/.test(alert.code) && !alert.message_zh.includes("\n")));
});
