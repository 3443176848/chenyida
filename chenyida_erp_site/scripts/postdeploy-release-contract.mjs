import {
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  RELEASE_RUNTIME_POLICY_SHA256,
  runtimeGuardBinding,
  validateRuntimeGuardBinding,
} from "./release-lifecycle-contract.mjs";
import { RELEASE_IDENTITY_CONTRACT, validateReleaseIdentity } from "./release-identity-contract.mjs";
import { canonicalJson, sha256, validateReleaseManifest } from "./release-manifest-contract.mjs";

export const POSTDEPLOY_RECEIPT_CONTRACT = "chenyida-erp-postdeploy-verification/v1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const RUN_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SERVICES = ["caddy", "postgres", "web", "worker"];
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const READY_COMPONENTS = Object.freeze({ postgresql: "READY", migration: "READY", worker: "READY", uploads: "READY", attachments: "READY", runtime: "READY" });

export class PostDeployReleaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "PostDeployReleaseError";
    this.code = code;
  }
}

function reject(code) {
  throw new PostDeployReleaseError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function string(value, pattern, code, maximum = 512) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !pattern.test(value)) reject(code);
}

function iso(value, code) {
  string(value, ISO_UTC, code, 24);
  if (Number.isNaN(Date.parse(value))) reject(code);
}

export function isLocalOnlyImageReference(reference) {
  if (typeof reference !== "string") return true;
  const separator = reference.indexOf("/");
  if (separator <= 0) return true;
  const authority = reference.slice(0, separator).toLowerCase();
  const host = authority.split(":")[0];
  return host === "localhost" || host.startsWith("127.") || host === "0.0.0.0" || host.endsWith(".localhost");
}

export function validatePostDeployRuntimeServices(value) {
  if (!Array.isArray(value) || value.length !== SERVICES.length) reject("POSTDEPLOY_SERVICE_SET_INVALID");
  const containerIds = new Set(); const imageIds = new Set();
  value.forEach((state, index) => {
    exactKeys(state, ["service", "container_id", "image_id", "image_reference", "restart_count", "oom_killed", "running", "restarting", "paused", "dead", "status", "health", "healthcheck_present"], "POSTDEPLOY_SERVICE_FIELDS_INVALID");
    if (state.service !== SERVICES[index]) reject("POSTDEPLOY_SERVICE_SET_INVALID");
    string(state.container_id, CONTAINER_ID, "POSTDEPLOY_CONTAINER_ID_INVALID", 64);
    string(state.image_id, DIGEST, "POSTDEPLOY_IMAGE_ID_INVALID", 71);
    string(state.image_reference, IMAGE_REFERENCE, "POSTDEPLOY_IMAGE_REFERENCE_INVALID");
    if (!Number.isSafeInteger(state.restart_count) || state.restart_count !== 0 || state.oom_killed !== false || state.running !== true || state.restarting !== false || state.paused !== false || state.dead !== false || state.status !== "running") reject("POSTDEPLOY_RUNTIME_STATE_INVALID");
    for (const key of ["oom_killed", "running", "restarting", "paused", "dead", "healthcheck_present"]) if (typeof state[key] !== "boolean") reject("POSTDEPLOY_RUNTIME_STATE_INVALID");
    if (state.service === "caddy") {
      if (state.health !== "none" || state.healthcheck_present) reject("POSTDEPLOY_HEALTH_INVALID");
    } else if (state.health !== "healthy" || !state.healthcheck_present) reject("POSTDEPLOY_HEALTH_INVALID");
    if (containerIds.has(state.container_id) || imageIds.has(state.image_id)) reject("POSTDEPLOY_RUNTIME_IDENTITY_COLLISION");
    containerIds.add(state.container_id); imageIds.add(state.image_id);
  });
  return value;
}

export function validatePostDeployReadiness(value) {
  exactKeys(value, ["deployment_class", "deployment_id", "version", "revision", "migration_head", "migration_manifest_sha256", "database_time", "components"], "POSTDEPLOY_READINESS_FIELDS_INVALID");
  if (!["UAT", "PRODUCTION"].includes(value.deployment_class)) reject("POSTDEPLOY_READINESS_DEPLOYMENT_INVALID");
  string(value.deployment_id, IDENTIFIER, "POSTDEPLOY_READINESS_DEPLOYMENT_INVALID", 120);
  string(value.version, VERSION, "POSTDEPLOY_READINESS_VERSION_INVALID", 40);
  string(value.revision, /^[0-9a-f]{12}$/, "POSTDEPLOY_READINESS_REVISION_INVALID", 12);
  string(value.migration_head, MIGRATION, "POSTDEPLOY_READINESS_MIGRATION_INVALID", 160);
  string(value.migration_manifest_sha256, SHA256, "POSTDEPLOY_READINESS_MIGRATION_INVALID", 64);
  iso(value.database_time, "POSTDEPLOY_READINESS_TIME_INVALID");
  exactKeys(value.components, Object.keys(READY_COMPONENTS), "POSTDEPLOY_READINESS_COMPONENTS_INVALID");
  if (Object.entries(READY_COMPONENTS).some(([key, expected]) => (
    value.components[key] !== expected
  ))) reject("POSTDEPLOY_READINESS_COMPONENTS_INVALID");
  return value;
}

export function validatePostDeployReceipt(value) {
  exactKeys(value, ["schema_version", "contract", "run_id", "generated_at", "result", "runtime_guard", "control", "deployment", "release", "source", "migrations", "runtime_policy_sha256", "runtime_configuration_sha256", "services", "readiness"], "POSTDEPLOY_RECEIPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== POSTDEPLOY_RECEIPT_CONTRACT || value.result !== "PASS") reject("POSTDEPLOY_RECEIPT_VERSION_INVALID");
  string(value.run_id, RUN_IDENTIFIER, "POSTDEPLOY_RUN_ID_INVALID", 101); iso(value.generated_at, "POSTDEPLOY_TIME_INVALID");
  try { validateRuntimeGuardBinding(value.runtime_guard, POST_DEPLOY_RUNTIME_GUARD_MODE, "POSTDEPLOY_RUNTIME_GUARD_INVALID"); } catch (error) { reject(error?.code || "POSTDEPLOY_RUNTIME_GUARD_INVALID"); }
  exactKeys(value.control, ["supervisor_bundle_sha256", "authorization_sha256"], "POSTDEPLOY_CONTROL_FIELDS_INVALID");
  for (const item of Object.values(value.control)) string(item, SHA256, "POSTDEPLOY_CONTROL_INVALID", 64);
  exactKeys(value.deployment, ["class", "id", "compose_project"], "POSTDEPLOY_DEPLOYMENT_FIELDS_INVALID");
  if (!["UAT", "PRODUCTION"].includes(value.deployment.class)) reject("POSTDEPLOY_DEPLOYMENT_CLASS_INVALID");
  string(value.deployment.id, IDENTIFIER, "POSTDEPLOY_DEPLOYMENT_ID_INVALID", 120); string(value.deployment.compose_project, IDENTIFIER, "POSTDEPLOY_COMPOSE_PROJECT_INVALID", 120);
  if (value.deployment.id !== value.deployment.compose_project) reject("POSTDEPLOY_COMPOSE_PROJECT_INVALID");
  exactKeys(value.release, ["release_id", "manifest_sha256", "gate_plan_sha256", "gate_report_sha256"], "POSTDEPLOY_RELEASE_FIELDS_INVALID");
  string(value.release.release_id, IDENTIFIER, "POSTDEPLOY_RELEASE_ID_INVALID", 120);
  for (const key of ["manifest_sha256", "gate_plan_sha256", "gate_report_sha256"]) string(value.release[key], SHA256, "POSTDEPLOY_RELEASE_DIGEST_INVALID", 64);
  exactKeys(value.source, ["application_version", "git_commit", "git_tree"], "POSTDEPLOY_SOURCE_FIELDS_INVALID");
  string(value.source.application_version, VERSION, "POSTDEPLOY_SOURCE_VERSION_INVALID", 40); string(value.source.git_commit, COMMIT, "POSTDEPLOY_SOURCE_GIT_INVALID", 40); string(value.source.git_tree, COMMIT, "POSTDEPLOY_SOURCE_GIT_INVALID", 40);
  exactKeys(value.migrations, ["head", "manifest_sha256"], "POSTDEPLOY_MIGRATION_FIELDS_INVALID");
  string(value.migrations.head, MIGRATION, "POSTDEPLOY_MIGRATION_INVALID", 160); string(value.migrations.manifest_sha256, SHA256, "POSTDEPLOY_MIGRATION_INVALID", 64);
  if (value.runtime_policy_sha256 !== RELEASE_RUNTIME_POLICY_SHA256) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  string(value.runtime_configuration_sha256, SHA256, "POSTDEPLOY_RUNTIME_CONFIGURATION_INVALID", 64);
  validatePostDeployRuntimeServices(value.services); validatePostDeployReadiness(value.readiness);
  if (Math.abs(Date.parse(value.readiness.database_time) - Date.parse(value.generated_at)) > MAX_CLOCK_SKEW_MS) reject("POSTDEPLOY_CLOCK_SKEW_INVALID");
  if (value.readiness.deployment_class !== value.deployment.class || value.readiness.deployment_id !== value.deployment.id || value.readiness.version !== value.source.application_version || value.readiness.revision !== value.source.git_commit.slice(0, 12) || value.readiness.migration_head !== value.migrations.head || value.readiness.migration_manifest_sha256 !== value.migrations.manifest_sha256) reject("POSTDEPLOY_READINESS_IDENTITY_MISMATCH");
  return value;
}

export function buildPostDeployReceipt({ runId, generatedAt, deploymentClass, deploymentId, composeProject, manifest, manifestSha256, supervisorBundleSha256, authorizationSha256, runtimePolicySha256, runtimeConfigurationSha256, services, readiness }) {
  validateReleaseManifest(manifest, { now: new Date(generatedAt), requireEligible: true });
  string(manifestSha256, SHA256, "POSTDEPLOY_MANIFEST_SHA256_INVALID", 64);
  if (sha256(canonicalJson(manifest)) !== manifestSha256) reject("POSTDEPLOY_MANIFEST_SHA256_MISMATCH");
  if (manifest.lifecycle.post_deploy_identity.mode !== POST_DEPLOY_RUNTIME_GUARD_MODE) reject("POSTDEPLOY_MANIFEST_LIFECYCLE_MISMATCH");
  if (manifest.allowed_deployment_classes.length !== 1 || manifest.allowed_deployment_classes[0] !== deploymentClass) reject("POSTDEPLOY_DEPLOYMENT_CLASS_MISMATCH");
  if (manifest.control.supervisor_bundle_sha256 !== supervisorBundleSha256) reject("POSTDEPLOY_SUPERVISOR_MISMATCH");
  if ([manifest.images.web.image_reference, manifest.images.worker.image_reference].some(isLocalOnlyImageReference)) reject("POSTDEPLOY_LOCAL_ONLY_IMAGE_FORBIDDEN");
  if (runtimePolicySha256 !== RELEASE_RUNTIME_POLICY_SHA256) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  validatePostDeployRuntimeServices(services); validatePostDeployReadiness(readiness);
  for (const service of ["web", "worker"]) {
    const state = services.find((item) => item.service === service);
    if (state.image_reference !== manifest.images[service].image_reference || state.image_id !== manifest.images[service].image_digest) reject("POSTDEPLOY_IMAGE_MISMATCH");
  }
  return validatePostDeployReceipt({
    schema_version: 1,
    contract: POSTDEPLOY_RECEIPT_CONTRACT,
    run_id: runId,
    generated_at: generatedAt,
    result: "PASS",
    runtime_guard: runtimeGuardBinding(POST_DEPLOY_RUNTIME_GUARD_MODE),
    control: { supervisor_bundle_sha256: supervisorBundleSha256, authorization_sha256: authorizationSha256 },
    deployment: { class: deploymentClass, id: deploymentId, compose_project: composeProject },
    release: { release_id: manifest.release_id, manifest_sha256: manifestSha256, gate_plan_sha256: manifest.gate.plan_sha256, gate_report_sha256: manifest.gate.report_sha256 },
    source: { application_version: manifest.source.package_version, git_commit: manifest.source.git_commit, git_tree: manifest.source.git_tree },
    migrations: { head: manifest.migrations.head, manifest_sha256: manifest.migrations.allowlist_sha256 },
    runtime_policy_sha256: runtimePolicySha256,
    runtime_configuration_sha256: runtimeConfigurationSha256,
    services,
    readiness,
  });
}

export function buildReleaseIdentityFromPostDeployReceipt({ receipt, receiptSha256 = sha256(canonicalJson(receipt)) }) {
  validatePostDeployReceipt(receipt);
  string(receiptSha256, SHA256, "POSTDEPLOY_RECEIPT_SHA256_INVALID", 64);
  if (sha256(canonicalJson(receipt)) !== receiptSha256) reject("POSTDEPLOY_RECEIPT_SHA256_MISMATCH");
  const service = Object.fromEntries(receipt.services.map((item) => [item.service, item]));
  return validateReleaseIdentity({
    schema_version: 3,
    contract: RELEASE_IDENTITY_CONTRACT,
    deployment_class: receipt.deployment.class,
    deployment_id: receipt.deployment.id,
    release_id: receipt.release.release_id,
    release_manifest_sha256: receipt.release.manifest_sha256,
    postdeploy_receipt_sha256: receiptSha256,
    supervisor_bundle_sha256: receipt.control.supervisor_bundle_sha256,
    authorization_sha256: receipt.control.authorization_sha256,
    runtime_guard: runtimeGuardBinding(POST_DEPLOY_RUNTIME_GUARD_MODE),
    runtime_policy_sha256: receipt.runtime_policy_sha256,
    application_version: receipt.source.application_version,
    git_commit: receipt.source.git_commit,
    git_tree: receipt.source.git_tree,
    migration_head: receipt.migrations.head,
    migration_manifest_sha256: receipt.migrations.manifest_sha256,
    caddy_container_id: service.caddy.container_id,
    caddy_image_digest: service.caddy.image_id,
    postgres_container_id: service.postgres.container_id,
    postgres_image_digest: service.postgres.image_id,
    web_container_id: service.web.container_id,
    web_image_digest: service.web.image_id,
    worker_container_id: service.worker.container_id,
    worker_image_digest: service.worker.image_id,
    generated_at: receipt.generated_at,
  });
}
