import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_CONTRACT,
  canonicalRuntimeConfigurationProbeJson,
  createRuntimeConfigurationProbeReceipt,
  runtimeConfigurationProbeFilename,
  validateRuntimeConfigurationProbeReceipt,
} from "../scripts/postdeploy-runtime-configuration-probe.mjs";

const runtimePolicySha256 = "e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00";
const runtimeConfigurationSha256 = "3".repeat(64);
const composeProjectRoot = "/opt/erp/chenyida_erp_site";
const now = new Date("2026-08-13T01:00:00.000Z");

function services() {
  return ["caddy", "postgres", "web", "worker"].map((service, index) => ({
    service,
    container_id: String(index + 1).repeat(64),
    image_id: `sha256:${String(index + 5).repeat(64)}`,
    image_reference: `registry.example.invalid/chenyida/${service}@sha256:${String(index + 5).repeat(64)}`,
    restart_count: 0,
    oom_killed: false,
    running: true,
    restarting: false,
    paused: false,
    dead: false,
    status: "running",
    health: service === "caddy" ? "none" : "healthy",
    healthcheck_present: service !== "caddy",
  }));
}

function receipt() {
  return createRuntimeConfigurationProbeReceipt({
    probeId: "probe-alpha47",
    probedAt: now.toISOString(),
    deploymentClass: "UAT",
    deploymentId: "chenyida-erp",
    composeProject: "chenyida-erp",
    composeProjectRoot,
    manifest: { source: { git_commit: "a".repeat(40), package_version: "0.1.0-alpha.47" } },
    manifestSha256: "b".repeat(64),
    runtimeGuardContract: "chenyida-erp-release-runtime-guard/v1",
    runtimeGuardMode: "POST_DEPLOY_CURRENT_RUNTIME_STRICT",
    runtimePolicySha256,
    selectors: { caddy: "chenyida-erp-caddy-1", postgres: "chenyida-erp-postgres-1", web: "chenyida-erp-web-1", worker: "chenyida-erp-worker-1" },
    runtime: { services: services(), runtime_configuration_sha256: runtimeConfigurationSha256 },
    control: { supervisor_bundle_sha256: "c".repeat(64), authorization_sha256: "d".repeat(64) },
  });
}

test("trusted probe receipt binds the exact release, bundle, selectors and computed runtime digest without publishing a host path", () => {
  const value = receipt();
  assert.equal(value.contract, POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_CONTRACT);
  assert.equal(value.runtime_configuration_sha256, runtimeConfigurationSha256);
  assert.equal(value.expires_at, "2026-08-13T02:00:00.000Z");
  assert.equal(runtimeConfigurationProbeFilename(value.probe_id), "probe-alpha47.runtime-configuration-probe.json");
  assert.deepEqual(validateRuntimeConfigurationProbeReceipt(value, { now }), value);
  const serialized = canonicalRuntimeConfigurationProbeJson(value);
  assert.equal(serialized, canonicalRuntimeConfigurationProbeJson(JSON.parse(serialized)));
  assert.doesNotMatch(serialized, /\/opt\/erp\/chenyida_erp_site/);
  assert.doesNotMatch(serialized, /password|token|database_url/i);
});

test("probe receipt is one-hour bounded and rejects selector, runtime and control drift", () => {
  const value = receipt();
  assert.throws(() => validateRuntimeConfigurationProbeReceipt(value, { now: new Date("2026-08-13T02:00:00.000Z") }), (error) => error.code === "RUNTIME_CONFIGURATION_PROBE_TIME_INVALID");
  assert.throws(() => validateRuntimeConfigurationProbeReceipt({ ...value, runtime_configuration_sha256: "9".repeat(63) }, { now }), (error) => error.code === "RUNTIME_CONFIGURATION_PROBE_RUNTIME_INVALID");
  assert.throws(() => validateRuntimeConfigurationProbeReceipt({ ...value, selectors: { ...value.selectors, web: value.selectors.worker } }, { now }), (error) => error.code === "RUNTIME_CONFIGURATION_PROBE_SELECTORS_INVALID");
  assert.throws(() => validateRuntimeConfigurationProbeReceipt({ ...value, control: { ...value.control, supervisor_bundle_sha256: "short" } }, { now }), (error) => error.code === "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
});

test("probe wrapper takes the canonical global lock and validates secret files on both sides of inspection", async () => {
  const wrapper = await readFile(new URL("../scripts/probe-postdeploy-runtime-configuration.sh", import.meta.url), "utf8");
  const lock = wrapper.indexOf("acquire_chenyida_release_gate_lock");
  const firstSecret = wrapper.indexOf("verify_runtime_secret_boundary", lock);
  const probe = wrapper.indexOf("postdeploy-runtime-configuration-probe.mjs", firstSecret);
  const secondSecret = wrapper.indexOf("verify_runtime_secret_boundary", probe);
  assert.ok(lock >= 0 && firstSecret > lock && probe > firstSecret && secondSecret > probe);
  assert.match(wrapper, /release-gate-lock\.sh/);
  const lockUsers = await Promise.all([
    "../scripts/release-gate-lock.sh",
    "../scripts/postdeploy-release-verifier.mjs",
    "../scripts/release-gate-runner.mjs",
    "../scripts/create-release-image-evidence.sh",
    "../scripts/create-release-manifest.sh",
    "../scripts/run-release-gate.sh",
    "../scripts/write-release-identity.sh",
  ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));
  for (const source of lockUsers) {
    assert.match(source, /\/run\/lock\/chenyida-erp-release-gate-v1\.lock/);
    assert.doesNotMatch(source, /\/var\/lock\/chenyida-erp-release-gate-v1\.lock/);
  }
});
