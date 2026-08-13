export const RELEASE_RUNTIME_GUARD_CONTRACT = "chenyida-erp-release-runtime-guard/v1";
export const RELEASE_LIFECYCLE_CONTRACT = "chenyida-erp-release-lifecycle/v1";
export const PRE_DEPLOY_RUNTIME_GUARD_MODE = "PRE_DEPLOY_EXISTING_RUNTIME_STABILITY";
export const ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE = "ISOLATED_CANDIDATE_STRICT";
export const POST_DEPLOY_RUNTIME_GUARD_MODE = "POST_DEPLOY_CURRENT_RUNTIME_STRICT";
export const RELEASE_RUNTIME_POLICY_SHA256 = "8c9f9fd06eb4533faeeed4c316eb93568c38b3a42ac8c48dd081fbb4e7a2f444";

const OFFICIAL_PRE_DEPLOY_SERVICES = Object.freeze([
  Object.freeze({ service: "caddy", allowed_health: Object.freeze(["none"]), healthcheck_policy: "VERSIONED_POLICY_ABSENT" }),
  Object.freeze({ service: "postgres", allowed_health: Object.freeze(["healthy"]), healthcheck_policy: "PRESENT_REQUIRED" }),
  Object.freeze({ service: "web", allowed_health: Object.freeze(["healthy"]), healthcheck_policy: "PRESENT_REQUIRED" }),
  Object.freeze({ service: "worker", allowed_health: Object.freeze(["none", "healthy"]), healthcheck_policy: "LEGACY_ABSENT_OR_PRESENT_HEALTHY" }),
]);

export const OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD = Object.freeze({
  contract: RELEASE_RUNTIME_GUARD_CONTRACT,
  mode: PRE_DEPLOY_RUNTIME_GUARD_MODE,
  compose_project: "chenyida-erp-parallel",
  services: OFFICIAL_PRE_DEPLOY_SERVICES,
});

export const OFFICIAL_ISOLATED_CANDIDATE_RUNTIME_GUARD = Object.freeze({
  contract: RELEASE_RUNTIME_GUARD_CONTRACT,
  mode: ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE,
  runtime_policy_sha256: RELEASE_RUNTIME_POLICY_SHA256,
});

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateRuntimeGuardBinding(value, expectedMode = null, code = "RUNTIME_GUARD_BINDING_INVALID") {
  exactKeys(value, ["contract", "mode"], code);
  if (value.contract !== RELEASE_RUNTIME_GUARD_CONTRACT
    || ![PRE_DEPLOY_RUNTIME_GUARD_MODE, ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE, POST_DEPLOY_RUNTIME_GUARD_MODE].includes(value.mode)
    || (expectedMode !== null && value.mode !== expectedMode)) reject(code);
  return value;
}

export function runtimeGuardBinding(mode) {
  return validateRuntimeGuardBinding({ contract: RELEASE_RUNTIME_GUARD_CONTRACT, mode }, mode);
}

export function validatePreDeployRuntimeGuard(value) {
  exactKeys(value, ["contract", "mode", "compose_project", "services"], "RUNTIME_GUARD_FIELDS_INVALID");
  validateRuntimeGuardBinding({ contract: value.contract, mode: value.mode }, PRE_DEPLOY_RUNTIME_GUARD_MODE, "RUNTIME_GUARD_MODE_INVALID");
  if (value.compose_project !== OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD.compose_project
    || !exactJson(value.services, OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD.services)) reject("RUNTIME_GUARD_POLICY_INVALID");
  return value;
}

export function validateIsolatedCandidateRuntimeGuard(value) {
  exactKeys(value, ["contract", "mode", "runtime_policy_sha256"], "CANDIDATE_RUNTIME_GUARD_FIELDS_INVALID");
  validateRuntimeGuardBinding({ contract: value.contract, mode: value.mode }, ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE, "CANDIDATE_RUNTIME_GUARD_MODE_INVALID");
  if (value.runtime_policy_sha256 !== RELEASE_RUNTIME_POLICY_SHA256) reject("CANDIDATE_RUNTIME_POLICY_INVALID");
  return value;
}

export function validateReleaseLifecycle(value) {
  exactKeys(value, ["contract", "pre_deploy_gate", "isolated_candidate", "post_deploy_identity"], "RELEASE_LIFECYCLE_FIELDS_INVALID");
  validateRuntimeGuardBinding(value.pre_deploy_gate, PRE_DEPLOY_RUNTIME_GUARD_MODE, "RELEASE_PRE_DEPLOY_MODE_INVALID");
  validateRuntimeGuardBinding(value.isolated_candidate, ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE, "RELEASE_CANDIDATE_MODE_INVALID");
  validateRuntimeGuardBinding(value.post_deploy_identity, POST_DEPLOY_RUNTIME_GUARD_MODE, "RELEASE_POST_DEPLOY_MODE_INVALID");
  if (value.contract !== RELEASE_LIFECYCLE_CONTRACT) reject("RELEASE_LIFECYCLE_INVALID");
  return value;
}

export function officialReleaseLifecycle() {
  return validateReleaseLifecycle({
    contract: RELEASE_LIFECYCLE_CONTRACT,
    pre_deploy_gate: runtimeGuardBinding(PRE_DEPLOY_RUNTIME_GUARD_MODE),
    isolated_candidate: runtimeGuardBinding(ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE),
    post_deploy_identity: runtimeGuardBinding(POST_DEPLOY_RUNTIME_GUARD_MODE),
  });
}

export function serviceHealthRules(runtimeGuard) {
  validatePreDeployRuntimeGuard(runtimeGuard);
  return new Map(runtimeGuard.services.map((entry) => [entry.service, entry]));
}

function boundedString(value, expression, code, maximum = 512) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !expression.test(value)) reject(code);
}

export function validatePreDeployRuntimeSnapshotShape(value, prefix = "PRE_DEPLOY_RUNTIME") {
  if (!Array.isArray(value) || value.length > 16) reject(`${prefix}_SERVICE_SET_INVALID`);
  const seen = new Set(); const containers = new Set();
  for (const state of value) {
    exactKeys(state, [
      "service", "container_id", "image_id", "image_reference", "restart_count", "oom_killed",
      "running", "restarting", "paused", "dead", "status", "health", "healthcheck_present",
    ], `${prefix}_FIELDS_INVALID`);
    boundedString(state.service, /^[a-z][a-z0-9_-]*$/, `${prefix}_SERVICE_INVALID`, 80);
    boundedString(state.container_id, /^[0-9a-f]{64}$/, `${prefix}_CONTAINER_ID_INVALID`, 64);
    boundedString(state.image_id, /^sha256:[0-9a-f]{64}$/, `${prefix}_IMAGE_ID_INVALID`, 71);
    boundedString(state.image_reference, /^[^\u0000-\u001f\u007f|]+$/, `${prefix}_IMAGE_REFERENCE_INVALID`);
    if (!Number.isSafeInteger(state.restart_count) || state.restart_count < 0 || state.restart_count > 1_000_000) reject(`${prefix}_RESTART_COUNT_INVALID`);
    for (const key of ["oom_killed", "running", "restarting", "paused", "dead", "healthcheck_present"]) if (typeof state[key] !== "boolean") reject(`${prefix}_STATE_INVALID`);
    boundedString(state.status, /^[a-z]+$/, `${prefix}_STATUS_INVALID`, 32);
    boundedString(state.health, /^(?:none|healthy|starting|unhealthy)$/, `${prefix}_HEALTH_INVALID`, 16);
    if (seen.has(state.service) || containers.has(state.container_id)) reject(`${prefix}_SERVICE_SET_INVALID`);
    seen.add(state.service);
    containers.add(state.container_id);
  }
  const sorted = [...value].sort((left, right) => left.service.localeCompare(right.service));
  if (!exactJson(sorted, value)) reject(`${prefix}_ORDER_INVALID`);
  return value;
}

export function validatePreDeployRuntimeSnapshot(value, runtimeGuard, prefix = "PRE_DEPLOY_RUNTIME") {
  const rules = serviceHealthRules(runtimeGuard);
  validatePreDeployRuntimeSnapshotShape(value, prefix);
  if (value.length !== rules.size) reject(`${prefix}_SERVICE_SET_INVALID`);
  for (const state of value) {
    const rule = rules.get(state.service);
    if (!rule) reject(`${prefix}_SERVICE_SET_INVALID`);
    if (!state.running || state.restarting || state.paused || state.dead || state.status !== "running" || state.restart_count !== 0 || state.oom_killed || !rule.allowed_health.includes(state.health)) reject(`${prefix}_STATE_INVALID`);
    if (rule.healthcheck_policy === "VERSIONED_POLICY_ABSENT" && (state.health !== "none" || state.healthcheck_present)) reject(`${prefix}_HEALTHCHECK_INVALID`);
    if (rule.healthcheck_policy === "PRESENT_REQUIRED" && (state.health !== "healthy" || !state.healthcheck_present)) reject(`${prefix}_HEALTHCHECK_INVALID`);
    if (rule.healthcheck_policy === "LEGACY_ABSENT_OR_PRESENT_HEALTHY"
      && !((state.health === "none" && !state.healthcheck_present) || (state.health === "healthy" && state.healthcheck_present))) reject(`${prefix}_HEALTHCHECK_INVALID`);
  }
  if (value.some((state, index) => state.service !== [...rules.keys()][index])) reject(`${prefix}_ORDER_INVALID`);
  return value;
}

export function assertPreDeployRuntimeStable(baseline, current, runtimeGuard, code = "PRE_DEPLOY_RUNTIME_DRIFT") {
  validatePreDeployRuntimeSnapshot(baseline, runtimeGuard, "PRE_DEPLOY_BASELINE_RUNTIME");
  validatePreDeployRuntimeSnapshot(current, runtimeGuard, "PRE_DEPLOY_CURRENT_RUNTIME");
  if (!exactJson(baseline, current)) reject(code);
  return current;
}
