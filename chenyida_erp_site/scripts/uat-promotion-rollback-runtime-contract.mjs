import path from "node:path";

import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";

export const UAT_PROMOTION_ROLLBACK_RUNTIME_PLAN_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-plan/v1";
export const UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-activation/v1";
export const UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-request/v1";
export const UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-response/v1";
export const UAT_PROMOTION_ROLLBACK_RUNTIME_OBSERVATION_CONTRACT =
  "chenyida-erp-uat-promotion-rollback-runtime-observation/v1";

export const UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_FILE =
  "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v1.json";
export const UAT_PROMOTION_ROLLBACK_RUNTIME_EXECUTOR =
  "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1";
export const UAT_PROMOTION_ROLLBACK_RUNTIME_DOCKER = "/usr/bin/docker";

export const UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS = Object.freeze({
  PREFLIGHT: 120,
  RECHECK: 120,
  PREPARE: 120,
  EXECUTE: 1800,
  PROBE: 300,
  CONTAIN: 300,
});

export const UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX = Object.freeze({
  ROLLBACK_EXECUTION: Object.freeze({
    PRECONDITION_RECHECK: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    WRITER_CONTAINMENT: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    POSTGRESQL_RESTORE: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    UPLOADS_RESTORE: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    ATTACHMENTS_RESTORE: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    BACKUP_STATUS_RESTORE: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    RUNTIME_CONFIGURATION_RESTORE: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    WEB_WORKER_PREDECESSOR_ACTIVATION: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
    PROTECTED_RESOURCE_RECHECK: Object.freeze(["PREPARE", "EXECUTE", "PROBE"]),
  }),
  ROLLBACK_POSTVERIFY: Object.freeze({
    POSTGRESQL_CONTENT: Object.freeze(["PREPARE", "PROBE"]),
    UPLOADS_CONTENT: Object.freeze(["PREPARE", "PROBE"]),
    ATTACHMENTS_CONTENT: Object.freeze(["PREPARE", "PROBE"]),
    BACKUP_STATUS_CONTENT: Object.freeze(["PREPARE", "PROBE"]),
    MIGRATION_HEAD: Object.freeze(["PREPARE", "PROBE"]),
    CADDY_IDENTITY: Object.freeze(["PREPARE", "PROBE"]),
    POSTGRES_IDENTITY: Object.freeze(["PREPARE", "PROBE"]),
    WEB_IDENTITY: Object.freeze(["PREPARE", "PROBE"]),
    WORKER_IDENTITY: Object.freeze(["PREPARE", "PROBE"]),
    RUNTIME_CONFIGURATION: Object.freeze(["PREPARE", "PROBE"]),
    STRICT_RELEASE_IDENTITY: Object.freeze(["PREPARE", "PROBE"]),
    HEALTH: Object.freeze(["PREPARE", "PROBE"]),
    PROTECTED_RESOURCES: Object.freeze(["PREPARE", "PROBE"]),
  }),
  RECOVERY: Object.freeze(["PREFLIGHT", "RECHECK", "PROBE", "CONTAIN"]),
});

export const UAT_PROMOTION_ROLLBACK_RUNTIME_STAGE_SOURCE_ROLES = Object.freeze({
  PRECONDITION_RECHECK: Object.freeze([
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_policy", "snapshot_policy_activation", "predecessor_postdeploy_receipt",
    "predecessor_release_manifest", "candidate_deployment_result", "candidate_postdeploy_identity",
    "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
  ]),
  WRITER_CONTAINMENT: Object.freeze(["candidate_deployment_result", "candidate_postdeploy_identity"]),
  POSTGRESQL_RESTORE: Object.freeze([
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_postgresql", "snapshot_policy", "snapshot_policy_activation",
  ]),
  UPLOADS_RESTORE: Object.freeze(["snapshot_manifest", "snapshot_uploads"]),
  ATTACHMENTS_RESTORE: Object.freeze(["snapshot_manifest", "snapshot_attachments"]),
  BACKUP_STATUS_RESTORE: Object.freeze(["snapshot_manifest", "snapshot_backup_status"]),
  RUNTIME_CONFIGURATION_RESTORE: Object.freeze([
    "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
  ]),
  WEB_WORKER_PREDECESSOR_ACTIVATION: Object.freeze([
    "predecessor_postdeploy_receipt", "predecessor_release_manifest", "compose_file",
    "compose_release_file", "deployment_environment", "runtime_policy",
  ]),
  PROTECTED_RESOURCE_RECHECK: Object.freeze(["candidate_deployment_result", "candidate_postdeploy_identity"]),
});

export const UAT_PROMOTION_ROLLBACK_RUNTIME_CHECK_SOURCE_ROLES = Object.freeze({
  POSTGRESQL_CONTENT: Object.freeze([
    "snapshot_postgresql", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
  ]),
  UPLOADS_CONTENT: Object.freeze(["snapshot_uploads", "snapshot_manifest", "snapshot_reconciliation"]),
  ATTACHMENTS_CONTENT: Object.freeze([
    "snapshot_attachments", "snapshot_manifest", "snapshot_reconciliation",
  ]),
  BACKUP_STATUS_CONTENT: Object.freeze([
    "snapshot_backup_status", "snapshot_manifest", "snapshot_reconciliation",
  ]),
  MIGRATION_HEAD: Object.freeze(["snapshot_migrations", "predecessor_release_manifest"]),
  CADDY_IDENTITY: Object.freeze(["candidate_deployment_result"]),
  POSTGRES_IDENTITY: Object.freeze(["candidate_deployment_result"]),
  WEB_IDENTITY: Object.freeze(["predecessor_postdeploy_receipt", "predecessor_release_manifest"]),
  WORKER_IDENTITY: Object.freeze(["predecessor_postdeploy_receipt", "predecessor_release_manifest"]),
  RUNTIME_CONFIGURATION: Object.freeze(["deployment_environment", "runtime_policy"]),
  STRICT_RELEASE_IDENTITY: Object.freeze(["predecessor_postdeploy_receipt", "predecessor_release_manifest"]),
  HEALTH: Object.freeze(["predecessor_postdeploy_receipt"]),
  PROTECTED_RESOURCES: Object.freeze(["candidate_deployment_result", "candidate_postdeploy_identity"]),
});

const PACKAGE_SOURCE_ROLES = Object.freeze([
  "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
  "snapshot_postgresql", "snapshot_uploads", "snapshot_attachments", "snapshot_backup_status",
  "snapshot_policy", "snapshot_policy_activation", "predecessor_postdeploy_receipt",
  "predecessor_release_manifest", "candidate_deployment_result", "candidate_postdeploy_identity",
  "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
  "runtime_adapter_activation",
]);

export function deriveUatPromotionRollbackRuntimeSourceRoles({ action, operation, label }) {
  let roles;
  if (action === "PREFLIGHT") roles = PACKAGE_SOURCE_ROLES;
  else if (action === "RECHECK" || action === "CONTAIN" || action === "PROBE" && label === null) {
    roles = ["candidate_deployment_result", "candidate_postdeploy_identity", "runtime_adapter_activation"];
  } else {
    const mapping = operation === "ROLLBACK_EXECUTION"
      ? UAT_PROMOTION_ROLLBACK_RUNTIME_STAGE_SOURCE_ROLES
      : UAT_PROMOTION_ROLLBACK_RUNTIME_CHECK_SOURCE_ROLES;
    roles = [...(mapping[label] || []), "runtime_adapter_activation"];
  }
  const selected = new Set(roles);
  const result = PACKAGE_SOURCE_ROLES.filter((role) => selected.has(role));
  if (result.length !== selected.size) reject("UAT_PROMOTION_ROLLBACK_RUNTIME_SOURCE_ROLES_INVALID");
  return Object.freeze(result);
}

const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = "0".repeat(64);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const DOCKER_NAME = /^[a-z0-9][a-z0-9_.-]{0,127}$/u;
const OPERATION_LABELS = new Set([
  ...Object.keys(UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX.ROLLBACK_EXECUTION),
  ...Object.keys(UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX.ROLLBACK_POSTVERIFY),
]);

export class UatPromotionRollbackRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = "UatPromotionRollbackRuntimeError";
    this.code = code;
  }
}

function reject(code) { throw new UatPromotionRollbackRuntimeError(code); }
function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}
function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}
function string(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}
function digest(value, code, allowZero = false) {
  string(value, SHA256, code);
  if (!allowZero && value === ZERO_SHA256) reject(code);
  return value;
}
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}
function instant(value, code) {
  string(value, ISO_UTC, code);
  if (Number.isNaN(Date.parse(value))) reject(code);
  return value;
}
function absolute(value, code) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value
    || value === "/" || value.includes("\u0000")) reject(code);
  return value;
}
function same(left, right) { return canonicalClusterJson(left) === canonicalClusterJson(right); }
function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function validateDatabase(value, code) {
  exactKeys(value, ["name", "system_identifier", "oid", "marker"], code);
  if (value.name !== "chenyida_erp"
    || value.marker !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || !/^[1-9][0-9]{9,29}$/u.test(value.system_identifier || "")
    || !/^[1-9][0-9]{0,9}$/u.test(value.oid || "")) reject(code);
  return value;
}

function validateObservedDatabase(value, code) {
  exactKeys(value, [
    "name", "system_identifier", "oid", "marker", "allow_connections", "writer_sessions", "sealed",
  ], code);
  validateDatabase({
    name: value.name, system_identifier: value.system_identifier, oid: value.oid, marker: value.marker,
  }, code);
  if (typeof value.allow_connections !== "boolean" || typeof value.sealed !== "boolean"
    || value.allow_connections === value.sealed) reject(code);
  integer(value.writer_sessions, 0, 1_000_000, code);
  if (value.sealed && value.writer_sessions !== 0) reject(code);
  return value;
}

function validateService(value, service, code) {
  exactKeys(value, ["service", "container_id", "image_reference", "image_digest"], code);
  if (value.service !== service) reject(code);
  string(value.container_id, CONTAINER_ID, code);
  string(value.image_reference, IMAGE_REFERENCE, code);
  string(value.image_digest, IMAGE_DIGEST, code);
  return value;
}

function validateVolume(value, domain, code) {
  exactKeys(value, ["domain", "name", "identity_sha256"], code);
  if (value.domain !== domain) reject(code);
  string(value.name, DOCKER_NAME, code);
  digest(value.identity_sha256, code);
  return value;
}

function validateObservedService(value, service, code) {
  exactKeys(value, [
    "service", "container_id", "image_reference", "image_digest", "running", "health",
    "restart_count", "oom_killed",
  ], code);
  validateService({
    service: value.service, container_id: value.container_id,
    image_reference: value.image_reference, image_digest: value.image_digest,
  }, service, code);
  if (typeof value.running !== "boolean" || typeof value.oom_killed !== "boolean"
    || !new Set(["none", "healthy", "unhealthy", "starting", "stopped"]).has(value.health)) reject(code);
  integer(value.restart_count, 0, 1_000_000, code);
  return value;
}

function writerIdentitySet(members) {
  return members.map(({ writer_key: writerKey, service, container_id: containerId, unexpected }) => ({
    writer_key: writerKey, service, container_id: containerId, unexpected,
  }));
}

function validateWriterInventory(value, services, code) {
  exactKeys(value, [
    "discovery_scope", "discovery_complete", "members", "writer_set_sha256",
    "active_writer_count", "unexpected_writer_count",
  ], code);
  if (value.discovery_scope !== "COMPOSE_PROJECT_COMPLETE_WRITER_SET"
    || value.discovery_complete !== true
    || !Array.isArray(value.members) || value.members.length < 2 || value.members.length > 64) reject(code);
  for (const member of value.members) {
    exactKeys(member, ["writer_key", "service", "container_id", "running", "unexpected"], code);
    string(member.writer_key, IDENTIFIER, code);
    string(member.service, IDENTIFIER, code);
    string(member.container_id, CONTAINER_ID, code);
    if (typeof member.running !== "boolean" || typeof member.unexpected !== "boolean") reject(code);
  }
  const ordered = [...value.members].sort((left, right) => (
    left.writer_key < right.writer_key ? -1 : left.writer_key > right.writer_key ? 1 : 0
  ));
  const byKey = new Map(value.members.map((member) => [member.writer_key, member]));
  const knownServiceContainerIds = new Set(
    Object.values(services).map((service) => service.container_id),
  );
  if (!same(ordered, value.members) || byKey.size !== value.members.length
    || new Set(value.members.map((member) => member.container_id)).size !== value.members.length
    || !byKey.has("web") || !byKey.has("worker")
    || ["web", "worker"].some((service) => {
      const member = byKey.get(service);
      return member.service !== service || member.container_id !== services[service].container_id
        || member.running !== services[service].running || member.unexpected;
    })
    || value.members.some((member) => !new Set(["web", "worker"]).has(member.writer_key)
      && !member.unexpected)
    || value.members.some((member) => !new Set(["web", "worker"]).has(member.writer_key)
      && knownServiceContainerIds.has(member.container_id))
    || value.active_writer_count !== value.members.filter((member) => member.running).length
    || value.unexpected_writer_count !== value.members.filter((member) => member.unexpected).length
    || clusterSha256(writerIdentitySet(value.members)) !== value.writer_set_sha256) reject(code);
  integer(value.active_writer_count, 0, value.members.length, code);
  integer(value.unexpected_writer_count, 0, value.members.length - 2, code);
  digest(value.writer_set_sha256, code);
  return value;
}

function validateRetainedCandidateVolume(value, domain, code) {
  exactKeys(value, ["domain", "name", "present", "identity_sha256"], code);
  if (value.domain !== domain || typeof value.present !== "boolean") reject(code);
  string(value.name, DOCKER_NAME, code);
  if (value.present) digest(value.identity_sha256, code);
  else if (value.identity_sha256 !== null) reject(code);
  return value;
}

function validateDerivedTarget(value, namePattern, identityField, identityPattern, code) {
  exactKeys(value, ["name", "present", identityField], code);
  string(value.name, namePattern, code);
  if (typeof value.present !== "boolean") reject(code);
  if (value.present) string(value[identityField], identityPattern, code);
  else if (value[identityField] !== null) reject(code);
  return value;
}

export function validateUatPromotionRollbackRuntimeObservation(value) {
  const code = "UAT_PROMOTION_ROLLBACK_RUNTIME_OBSERVATION_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "active_generation", "database", "services", "volumes",
    "writer_inventory", "retained_candidate_volumes", "derived_targets",
    "protected_resources_sha256", "observation_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_RUNTIME_OBSERVATION_CONTRACT
    || !new Set(["CANDIDATE", "PREDECESSOR", "PARTIAL_OR_UNKNOWN"]).has(value.active_generation)) reject(code);
  validateObservedDatabase(value.database, code);
  exactKeys(value.services, ["caddy", "postgres", "web", "worker"], code);
  for (const service of ["caddy", "postgres", "web", "worker"]) {
    validateObservedService(value.services[service], service, code);
  }
  const serviceValues = Object.values(value.services);
  if (new Set(serviceValues.map((item) => item.container_id)).size !== serviceValues.length) reject(code);
  validateWriterInventory(value.writer_inventory, value.services, code);
  exactKeys(value.volumes, ["uploads", "attachments", "backup_status"], code);
  for (const domain of ["uploads", "attachments", "backup_status"]) validateVolume(value.volumes[domain], domain, code);
  const volumeValues = Object.values(value.volumes);
  if (new Set(volumeValues.map((item) => item.name)).size !== volumeValues.length
    || new Set(volumeValues.map((item) => item.identity_sha256)).size !== volumeValues.length) reject(code);
  exactKeys(value.retained_candidate_volumes, ["uploads", "attachments", "backup_status"], code);
  for (const domain of ["uploads", "attachments", "backup_status"]) {
    validateRetainedCandidateVolume(value.retained_candidate_volumes[domain], domain, code);
  }
  const retainedValues = Object.values(value.retained_candidate_volumes);
  if (new Set(retainedValues.map((item) => item.name)).size !== retainedValues.length
    || retainedValues.some((item) => value.volumes[item.domain].name !== item.name
      && item.present && value.volumes[item.domain].identity_sha256 === item.identity_sha256)) reject(code);
  exactKeys(value.derived_targets, ["database", "volumes"], code);
  exactKeys(value.derived_targets.database, ["staging", "candidate_quarantine"], code);
  validateDerivedTarget(
    value.derived_targets.database.staging, DATABASE_IDENTIFIER,
    "oid", /^[1-9][0-9]{0,9}$/u, code,
  );
  validateDerivedTarget(
    value.derived_targets.database.candidate_quarantine,
    DATABASE_IDENTIFIER,
    "oid", /^[1-9][0-9]{0,9}$/u, code,
  );
  exactKeys(value.derived_targets.volumes, ["uploads", "attachments", "backup_status"], code);
  for (const domain of ["uploads", "attachments", "backup_status"]) {
    exactKeys(value.derived_targets.volumes[domain], ["target", "utility_container"], code);
    validateDerivedTarget(
      value.derived_targets.volumes[domain].target,
      DOCKER_NAME,
      "identity_sha256", SHA256, code,
    );
    validateDerivedTarget(
      value.derived_targets.volumes[domain].utility_container,
      DOCKER_NAME,
      "container_id", CONTAINER_ID, code,
    );
  }
  digest(value.protected_resources_sha256, code);
  digest(value.observation_sha256, code);
  if (clusterSha256(without(value, "observation_sha256")) !== value.observation_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackRuntimeOriginalObservation(planInput) {
  const plan = validateUatPromotionRollbackRuntimePlan(planInput);
  const writerMembers = ["web", "worker"].map((service) => ({
    writer_key: service,
    service,
    container_id: plan.candidate.services[service].container_id,
    running: true,
    unexpected: false,
  }));
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_ROLLBACK_RUNTIME_OBSERVATION_CONTRACT,
    active_generation: "CANDIDATE",
    database: {
      ...plan.deployment.database, allow_connections: true, writer_sessions: 0, sealed: false,
    },
    services: Object.fromEntries(Object.entries(plan.candidate.services).map(([service, identity]) => [service, {
      ...identity, running: true, health: service === "caddy" ? "none" : "healthy",
      restart_count: 0, oom_killed: false,
    }])),
    writer_inventory: {
      discovery_scope: "COMPOSE_PROJECT_COMPLETE_WRITER_SET",
      discovery_complete: true,
      members: writerMembers,
      writer_set_sha256: clusterSha256(writerIdentitySet(writerMembers)),
      active_writer_count: 2,
      unexpected_writer_count: 0,
    },
    volumes: plan.candidate.volumes,
    retained_candidate_volumes: Object.fromEntries(
      Object.entries(plan.candidate.volumes).map(([domain, volume]) => [domain, {
        ...volume, present: true,
      }]),
    ),
    derived_targets: {
      database: {
        staging: { name: plan.targets.database.staging, present: false, oid: null },
        candidate_quarantine: {
          name: plan.targets.database.candidate_quarantine, present: false, oid: null,
        },
      },
      volumes: Object.fromEntries(["uploads", "attachments", "backup_status"].map((domain) => [domain, {
        target: { name: plan.targets.volumes[domain].target, present: false, identity_sha256: null },
        utility_container: {
          name: plan.targets.volumes[domain].utility_container, present: false, container_id: null,
        },
      }])),
    },
    protected_resources_sha256: plan.candidate.protected_resources_sha256,
  };
  return Object.freeze(validateUatPromotionRollbackRuntimeObservation({
    ...body, observation_sha256: clusterSha256(body),
  }));
}

export function deriveUatPromotionRollbackRuntimeTargets(operationId) {
  string(operationId, IDENTIFIER, "UAT_PROMOTION_ROLLBACK_RUNTIME_OPERATION_INVALID");
  const token = clusterSha256({
    contract: "chenyida-erp-uat-promotion-rollback-target-derivation/v1",
    operation_id: operationId,
  }).slice(0, 16);
  return Object.freeze({
    database: Object.freeze({
      active: "chenyida_erp",
      staging: `chenyida_erp_rb_${token}`,
      candidate_quarantine: `chenyida_erp_candidate_${token}`,
    }),
    volumes: Object.freeze(Object.fromEntries(
      ["uploads", "attachments", "backup_status"].map((domain) => [domain, Object.freeze({
        target: `chenyida-erp_erp_${domain}_rb_${token}`,
        utility_container: `chenyida-erp-rollback-${domain.replaceAll("_", "-")}-${token}`,
      })]),
    )),
    rollback_postdeploy_run_id: `rollback-${token}`,
  });
}

function validateTargets(value, operationId, code) {
  exactKeys(value, ["database", "volumes", "rollback_postdeploy_run_id"], code);
  exactKeys(value.database, ["active", "staging", "candidate_quarantine"], code);
  for (const name of Object.values(value.database)) string(name, DATABASE_IDENTIFIER, code);
  exactKeys(value.volumes, ["uploads", "attachments", "backup_status"], code);
  for (const domain of ["uploads", "attachments", "backup_status"]) {
    exactKeys(value.volumes[domain], ["target", "utility_container"], code);
    string(value.volumes[domain].target, DOCKER_NAME, code);
    string(value.volumes[domain].utility_container, DOCKER_NAME, code);
  }
  string(value.rollback_postdeploy_run_id, IDENTIFIER, code);
  if (!same(value, deriveUatPromotionRollbackRuntimeTargets(operationId))) reject(code);
  return value;
}

function validateTool(value, expectedPath, code) {
  exactKeys(value, ["path", "sha256", "uid", "gid", "mode"], code);
  if (absolute(value.path, code) !== expectedPath || value.uid !== 0 || value.gid !== 0
    || value.mode !== "0555") reject(code);
  digest(value.sha256, code);
  return value;
}

export function validateUatPromotionRollbackRuntimePlan(value) {
  const code = "UAT_PROMOTION_ROLLBACK_RUNTIME_PLAN_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "promotion_id", "promotion_generation", "rollback_operation_id",
    "deployment", "candidate", "predecessor", "targets", "toolchain", "timeouts",
    "max_output_bytes", "source_bindings", "action_matrix", "runtime_plan_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_RUNTIME_PLAN_CONTRACT) reject(code);
  string(value.promotion_id, IDENTIFIER, code);
  string(value.rollback_operation_id, IDENTIFIER, code);
  integer(value.promotion_generation, 1, 1_000_000, code);
  exactKeys(value.deployment, ["class", "id", "compose_project", "compose_project_root", "database"], code);
  if (value.deployment.class !== "UAT" || value.deployment.id !== "chenyida-erp"
    || value.deployment.compose_project !== "chenyida-erp") reject(code);
  absolute(value.deployment.compose_project_root, code);
  validateDatabase(value.deployment.database, code);
  exactKeys(value.candidate, ["services", "volumes", "protected_resources_sha256"], code);
  exactKeys(value.candidate.services, ["caddy", "postgres", "web", "worker"], code);
  for (const service of ["caddy", "postgres", "web", "worker"]) {
    validateService(value.candidate.services[service], service, code);
  }
  const services = Object.values(value.candidate.services);
  if (new Set(services.map((item) => item.container_id)).size !== services.length
    || new Set(services.map((item) => item.image_digest)).size !== services.length) reject(code);
  exactKeys(value.candidate.volumes, ["uploads", "attachments", "backup_status"], code);
  for (const domain of ["uploads", "attachments", "backup_status"]) {
    validateVolume(value.candidate.volumes[domain], domain, code);
  }
  const volumes = Object.values(value.candidate.volumes);
  if (new Set(volumes.map((item) => item.name)).size !== volumes.length
    || new Set(volumes.map((item) => item.identity_sha256)).size !== volumes.length) reject(code);
  digest(value.candidate.protected_resources_sha256, code);
  exactKeys(value.predecessor, [
    "release_manifest_sha256", "postdeploy_receipt_sha256", "runtime_configuration_sha256",
    "web_image", "worker_image",
  ], code);
  for (const field of [
    "release_manifest_sha256", "postdeploy_receipt_sha256", "runtime_configuration_sha256",
  ]) digest(value.predecessor[field], code);
  for (const field of ["web_image", "worker_image"]) string(value.predecessor[field], IMAGE_REFERENCE, code);
  validateTargets(value.targets, value.rollback_operation_id, code);
  for (const domain of ["uploads", "attachments", "backup_status"]) {
    if (value.targets.volumes[domain].target === value.candidate.volumes[domain].name) reject(code);
  }
  exactKeys(value.toolchain, ["executor", "docker"], code);
  validateTool(value.toolchain.executor, UAT_PROMOTION_ROLLBACK_RUNTIME_EXECUTOR, code);
  validateTool(value.toolchain.docker, UAT_PROMOTION_ROLLBACK_RUNTIME_DOCKER, code);
  exactKeys(value.timeouts, Object.keys(UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS), code);
  if (!same(value.timeouts, UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS)) reject(code);
  if (value.max_output_bytes !== 4 * 1024 * 1024) reject(code);
  exactKeys(value.source_bindings, [
    "snapshot_objects_sha256", "snapshot_reconciliation_sha256", "deployment_environment_sha256",
    "compose_file_sha256", "compose_release_file_sha256", "runtime_policy_sha256",
  ], code);
  for (const item of Object.values(value.source_bindings)) digest(item, code);
  if (!same(value.action_matrix, UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX)
    || clusterSha256(without(value, "runtime_plan_sha256")) !== value.runtime_plan_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackRuntimePlan(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_ROLLBACK_RUNTIME_PLAN_CONTRACT,
    ...input,
    targets: deriveUatPromotionRollbackRuntimeTargets(input.rollback_operation_id),
    timeouts: UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS,
    max_output_bytes: 4 * 1024 * 1024,
    action_matrix: UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX,
  };
  return Object.freeze(validateUatPromotionRollbackRuntimePlan({
    ...body,
    runtime_plan_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionRollbackRuntimeActivation(
  value, { now = new Date(), allowExpired = false, executionDeadline = null } = {},
) {
  const code = "UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "status", "activation_id", "approved_at", "expires_at",
    "requester_identity_sha256", "approver_identity_sha256", "plan", "activation_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_CONTRACT
    || value.status !== "ACTIVE") reject(code);
  string(value.activation_id, IDENTIFIER, code);
  digest(value.requester_identity_sha256, code);
  digest(value.approver_identity_sha256, code);
  if (value.requester_identity_sha256 === value.approver_identity_sha256) reject(code);
  const approved = Date.parse(instant(value.approved_at, code));
  const expires = Date.parse(instant(value.expires_at, code));
  const observed = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const boundDeadline = executionDeadline === null ? null : Date.parse(instant(executionDeadline, code));
  if (Number.isNaN(observed) || expires <= approved || expires - approved > 24 * 60 * 60 * 1000
    || observed < approved - 5 * 60 * 1000 || !allowExpired && observed >= expires
    || !allowExpired && boundDeadline !== null && expires < boundDeadline
    || allowExpired && boundDeadline !== null && approved >= boundDeadline) reject(code);
  validateUatPromotionRollbackRuntimePlan(value.plan);
  if (clusterSha256(without(value, "activation_sha256")) !== value.activation_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackRuntimeActivation(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_CONTRACT,
    status: "ACTIVE",
    ...input,
  };
  return Object.freeze(validateUatPromotionRollbackRuntimeActivation({
    ...body,
    activation_sha256: clusterSha256(body),
  }, { now: new Date(input.approved_at) }));
}

function validateRuntimeAction(value, operation, executionMode, label, code) {
  if (!new Set(["PREFLIGHT", "RECHECK", "PREPARE", "EXECUTE", "PROBE", "CONTAIN"]).has(value)) reject(code);
  const operationProbe = value === "PROBE" && label === null;
  if (value === "PREFLIGHT" || value === "RECHECK" || value === "CONTAIN" || operationProbe) {
    if (label !== null) reject(code);
  } else if (!OPERATION_LABELS.has(label)) reject(code);
  if (executionMode === "RECOVERY") {
    if (label !== null || value === "EXECUTE"
      || !UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX.RECOVERY.includes(value)) reject(code);
  } else if (value !== "PREFLIGHT" && value !== "RECHECK" && value !== "CONTAIN" && !operationProbe) {
    const allowed = UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX[operation]?.[label];
    if (!allowed?.includes(value)) reject(code);
  }
}

export function validateUatPromotionRollbackRuntimeRequest(value) {
  const code = "UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_INVALID";
  exactKeys(value, [
    "schema_version", "contract", "action", "operation", "operation_id", "execution_mode", "label",
    "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
    "record_intent_sha256", "runtime_plan_sha256", "previous_result_sha256", "context_sha256",
    "source_roles", "payload_sha256", "payload", "requested_at", "execution_deadline",
    "authorization_expires_at", "action_deadline", "request_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_CONTRACT
    || !new Set(["ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"]).has(value.operation)
    || !new Set(["ORIGINAL", "RECOVERY"]).has(value.execution_mode)) reject(code);
  string(value.operation_id, IDENTIFIER, code);
  if (value.label !== null) string(value.label, /^[A-Z][A-Z0-9_]{1,79}$/u, code);
  validateRuntimeAction(value.action, value.operation, value.execution_mode, value.label, code);
  for (const field of [
    "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
    "previous_result_sha256", "context_sha256", "payload_sha256", "request_sha256",
  ]) digest(value[field], code, field === "previous_result_sha256");
  digest(value.record_intent_sha256, code, value.action === "PREFLIGHT" || value.action === "RECHECK");
  digest(value.runtime_plan_sha256, code);
  const expectedRoles = deriveUatPromotionRollbackRuntimeSourceRoles(value);
  if (!Array.isArray(value.source_roles) || !same(value.source_roles, expectedRoles)) reject(code);
  record(value.payload, code);
  if (clusterSha256(value.payload) !== value.payload_sha256) reject(code);
  const requested = Date.parse(instant(value.requested_at, code));
  const executionDeadline = Date.parse(instant(value.execution_deadline, code));
  const authorizationExpires = Date.parse(instant(value.authorization_expires_at, code));
  const actionDeadline = Date.parse(instant(value.action_deadline, code));
  const maximumActionMs = UAT_PROMOTION_ROLLBACK_RUNTIME_TIMEOUTS[value.action] * 1_000;
  if (actionDeadline <= requested || actionDeadline > authorizationExpires
    || value.execution_mode === "ORIGINAL" && actionDeadline > executionDeadline
    || actionDeadline - requested > maximumActionMs
    || clusterSha256(without(value, "request_sha256")) !== value.request_sha256) reject(code);
  return value;
}

export function createUatPromotionRollbackRuntimeRequest(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_CONTRACT,
    ...input,
    context_sha256: clusterSha256(input.payload.context),
    payload_sha256: clusterSha256(input.payload),
  };
  return Object.freeze(validateUatPromotionRollbackRuntimeRequest({
    ...body,
    request_sha256: clusterSha256(body),
  }));
}

export function validateUatPromotionRollbackRuntimeResponse(value, request = null) {
  const code = "UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_INVALID";
  const allowedStatuses = {
    PREFLIGHT: new Set([
      "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
      "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT", "BLOCKED_TARGET_IDENTITY_MISMATCH",
    ]),
    RECHECK: new Set([
      "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
      "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT", "BLOCKED_TARGET_IDENTITY_MISMATCH",
    ]),
    PREPARE: new Set(["PREPARED"]),
    EXECUTE: new Set(["COMMITTED", "ALREADY_COMMITTED"]),
    PROBE: new Set(["COMMITTED", "VERIFIED", "PARTIAL_OR_UNKNOWN", "CONTAINED"]),
    CONTAIN: new Set(["CONTAINED", "STALE_INTENT"]),
  };
  exactKeys(value, [
    "schema_version", "contract", "action", "operation", "operation_id", "label", "request_sha256",
    "runtime_plan_sha256", "status", "started_at", "completed_at", "output", "response_sha256",
  ], code);
  if (value.schema_version !== 1 || value.contract !== UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_CONTRACT
    || !new Set(["PREFLIGHT", "RECHECK", "PREPARE", "EXECUTE", "PROBE", "CONTAIN"]).has(value.action)
    || !new Set(["ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"]).has(value.operation)) reject(code);
  string(value.operation_id, IDENTIFIER, code);
  if (value.label !== null) string(value.label, /^[A-Z][A-Z0-9_]{1,79}$/u, code);
  for (const field of ["request_sha256", "runtime_plan_sha256", "response_sha256"]) digest(value[field], code);
  string(value.status, /^[A-Z][A-Z0-9_]{1,79}$/u, code);
  if (!allowedStatuses[value.action].has(value.status)) reject(code);
  const started = Date.parse(instant(value.started_at, code));
  const completed = Date.parse(instant(value.completed_at, code));
  record(value.output, code);
  if (new Set(["PREFLIGHT", "RECHECK"]).has(value.action)) {
    exactKeys(value.output, [
      "result", "execution_package_sha256", "source_set_sha256", "runtime_plan_sha256",
      "runtime_activation_source_sha256", "executor_sha256", "deployment_identity_sha256",
      "protected_resources_sha256", "target_state", "observed",
    ], code);
    if (value.output.result !== (value.action === "PREFLIGHT"
      ? "ROLLBACK_RUNTIME_PREFLIGHT_PASSED" : "ROLLBACK_RUNTIME_RECHECK_PASSED")
      || value.output.target_state !== value.status) reject(code);
    validateUatPromotionRollbackRuntimeObservation(value.output.observed);
  }
  if (value.action === "CONTAIN" && value.status === "STALE_INTENT") {
    exactKeys(value.output, ["observed"], code);
    validateUatPromotionRollbackRuntimeObservation(value.output.observed);
  }
  if (completed < started || clusterSha256(without(value, "response_sha256")) !== value.response_sha256) reject(code);
  if (request !== null) {
    validateUatPromotionRollbackRuntimeRequest(request);
    if (value.action !== request.action || value.operation !== request.operation
      || value.operation_id !== request.operation_id || value.label !== request.label
      || value.request_sha256 !== request.request_sha256
      || request.runtime_plan_sha256 !== ZERO_SHA256
        && value.runtime_plan_sha256 !== request.runtime_plan_sha256) reject(code);
    if (value.action === "CONTAIN" && value.status === "STALE_INTENT"
      && value.output.observed.observation_sha256
        === request.payload?.record_intent?.runtime_observation_sha256) reject(code);
    const requested = Date.parse(request.requested_at);
    const deadline = Date.parse(request.action_deadline);
    if (started < requested || completed > deadline) reject(code);
  }
  return value;
}

export function createUatPromotionRollbackRuntimeResponse(input) {
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_CONTRACT,
    ...input,
  };
  return Object.freeze(validateUatPromotionRollbackRuntimeResponse({
    ...body,
    response_sha256: clusterSha256(body),
  }));
}

export function canonicalUatPromotionRollbackRuntimeJson(value) {
  return canonicalClusterJson(value);
}
