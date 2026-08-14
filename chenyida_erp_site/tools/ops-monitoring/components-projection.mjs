import {
  MONITORING_OBSERVATION_CONTRACT,
  OpsMonitoringError,
  emptyComponentObservation,
  monitoringSha256,
  validateMonitoringObservation,
} from "./contract.mjs";
import { validateMonitoringEvaluatorConfig } from "./delivery-contract.mjs";

export const MONITORING_COMPONENTS_PROJECTION_CONTRACT = "chenyida-erp-monitoring-components-projection/v1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZERO_SHA256 = "0".repeat(64);

function reject(code) {
  throw new OpsMonitoringError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function digest(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) reject(code);
}

function identifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code);
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
}

function iso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) reject(code);
}

function projectionBody(value) {
  const body = { ...value };
  delete body.projection_sha256;
  return body;
}

function validateComponentShapes(value) {
  const empty = emptyComponentObservation();
  validateMonitoringObservation({
    schema_version: 1,
    contract: MONITORING_OBSERVATION_CONTRACT,
    observation_id: "components-shape-validation",
    observed_at: value.published_at,
    source: "SYNTHETIC_TEST",
    policy_sha256: ZERO_SHA256,
    resource_policy_sha256: ZERO_SHA256,
    host: {
      boot_id_sha256: ZERO_SHA256,
      monotonic_milliseconds: 0,
      available_memory_bytes: 0,
      swap_total_bytes: 0,
      swap_free_bytes: 0,
      root_free_bytes: 0,
      load_1m: 0,
      oom_kill_count: 0,
    },
    services: [],
    application: value.application,
    release: value.release,
    backup: empty.backup,
    notification: empty.notification,
  });
  if (value.application.live.status === "NOT_COLLECTED" || value.application.readiness.status === "NOT_COLLECTED" || ["NOT_COLLECTED", "UNCONFIGURED"].includes(value.release.status)) reject("MONITOR_COMPONENTS_PROJECTION_INCOMPLETE");
}

export function validateComponentsProjection(value) {
  exactKeys(value, ["schema_version", "contract", "projection_id", "generation", "previous_projection_sha256", "projection_sha256", "producer", "published_at", "release_binding", "application", "release"], "MONITOR_COMPONENTS_PROJECTION_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_COMPONENTS_PROJECTION_CONTRACT) reject("MONITOR_COMPONENTS_PROJECTION_VERSION_INVALID");
  identifier(value.projection_id, "MONITOR_COMPONENTS_PROJECTION_ID_INVALID");
  integer(value.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_COMPONENTS_PROJECTION_GENERATION_INVALID");
  digest(value.previous_projection_sha256, "MONITOR_COMPONENTS_PROJECTION_GENERATION_INVALID");
  digest(value.projection_sha256, "MONITOR_COMPONENTS_PROJECTION_INTEGRITY_INVALID");
  if ((value.generation === 1) !== (value.previous_projection_sha256 === ZERO_SHA256) || monitoringSha256(projectionBody(value)) !== value.projection_sha256) reject("MONITOR_COMPONENTS_PROJECTION_INTEGRITY_INVALID");
  exactKeys(value.producer, ["bundle_sha256", "source_sha256"], "MONITOR_COMPONENTS_PRODUCER_FIELDS_INVALID");
  digest(value.producer.bundle_sha256, "MONITOR_COMPONENTS_PRODUCER_INVALID");
  digest(value.producer.source_sha256, "MONITOR_COMPONENTS_PRODUCER_INVALID");
  iso(value.published_at, "MONITOR_COMPONENTS_PROJECTION_TIME_INVALID");
  exactKeys(value.release_binding, ["activation_id", "activated_at", "postdeploy_receipt_sha256"], "MONITOR_COMPONENTS_RELEASE_BINDING_FIELDS_INVALID");
  identifier(value.release_binding.activation_id, "MONITOR_COMPONENTS_RELEASE_BINDING_INVALID");
  iso(value.release_binding.activated_at, "MONITOR_COMPONENTS_RELEASE_BINDING_INVALID");
  digest(value.release_binding.postdeploy_receipt_sha256, "MONITOR_COMPONENTS_RELEASE_BINDING_INVALID");
  if (Date.parse(value.published_at) < Date.parse(value.release_binding.activated_at)) reject("MONITOR_COMPONENTS_PROJECTION_PREDATES_ACTIVATION");
  validateComponentShapes(value);
  for (const timestamp of [value.application.live.observed_at, value.application.readiness.observed_at, value.release.observed_at].filter((item) => item !== null)) {
    if (Date.parse(timestamp) < Date.parse(value.release_binding.activated_at) || Date.parse(timestamp) > Date.parse(value.published_at)) reject("MONITOR_COMPONENTS_PROJECTION_TIME_INVALID");
  }
  return value;
}

export function validateComponentsProjectionForEvaluation(value, evaluatorConfig, previousWatermark = undefined) {
  const projection = validateComponentsProjection(value);
  const config = validateMonitoringEvaluatorConfig(evaluatorConfig);
  if (projection.producer.bundle_sha256 !== config.evidence.components_producer_bundle_sha256 || projection.release_binding.activation_id !== config.evidence.release_activation_id || projection.release_binding.activated_at !== config.evidence.release_activated_at || projection.release_binding.postdeploy_receipt_sha256 !== config.evidence.postdeploy_receipt_sha256 || projection.generation < config.evidence.minimum_components_projection_generation) reject("MONITOR_COMPONENTS_PROJECTION_BINDING_INVALID");
  if (previousWatermark === null && (config.evidence.minimum_components_projection_generation !== 1 || projection.generation !== 1 || projection.previous_projection_sha256 !== ZERO_SHA256)) reject("MONITOR_COMPONENTS_PROJECTION_BOOTSTRAP_ANCHOR_REQUIRED");
  if (projection.release.status === "MATCHED") {
    const expected = config.monitoring.release_expectation;
    if (projection.release.release_manifest_sha256 !== expected.release_manifest_sha256 || projection.release.supervisor_bundle_sha256 !== expected.supervisor_bundle_sha256 || projection.release.application_version !== expected.application_version || projection.release.git_commit !== expected.git_commit || projection.release.migration_head !== expected.migration_head || projection.release.migration_manifest_sha256 !== expected.migration_manifest_sha256 || projection.release.web_image_digest !== expected.web_image_digest || projection.release.worker_image_digest !== expected.worker_image_digest) reject("MONITOR_COMPONENTS_RELEASE_IDENTITY_MISMATCH");
  }
  if (previousWatermark !== null && previousWatermark !== undefined) {
    exactKeys(previousWatermark, ["generation", "projection_sha256", "published_at"], "MONITOR_COMPONENTS_WATERMARK_INVALID");
    integer(previousWatermark.generation, 1, Number.MAX_SAFE_INTEGER, "MONITOR_COMPONENTS_WATERMARK_INVALID");
    digest(previousWatermark.projection_sha256, "MONITOR_COMPONENTS_WATERMARK_INVALID");
    iso(previousWatermark.published_at, "MONITOR_COMPONENTS_WATERMARK_INVALID");
    if (projection.generation < previousWatermark.generation || Date.parse(projection.published_at) < Date.parse(previousWatermark.published_at)) reject("MONITOR_COMPONENTS_PROJECTION_ROLLBACK");
    if (projection.generation === previousWatermark.generation) {
      if (projection.projection_sha256 !== previousWatermark.projection_sha256 || projection.published_at !== previousWatermark.published_at) reject("MONITOR_COMPONENTS_PROJECTION_REPLAY_MISMATCH");
    } else if (projection.generation !== previousWatermark.generation + 1 || projection.previous_projection_sha256 !== previousWatermark.projection_sha256) reject("MONITOR_COMPONENTS_PROJECTION_CHAIN_INVALID");
  }
  return projection;
}

export function componentsProjectionWatermark(value) {
  const projection = validateComponentsProjection(value);
  return Object.freeze({ generation: projection.generation, projection_sha256: projection.projection_sha256, published_at: projection.published_at });
}

export function componentsProjectionObservation(value) {
  const projection = validateComponentsProjection(value);
  return Object.freeze({ application: projection.application, release: projection.release });
}

export function createComponentsProjection(value) {
  const projection = { ...value, projection_sha256: "" };
  projection.projection_sha256 = monitoringSha256(projectionBody(projection));
  return Object.freeze(validateComponentsProjection(projection));
}
