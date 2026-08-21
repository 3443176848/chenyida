import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TASK70_DYNAMIC_POLICY_CONTRACT =
  "chenyida-erp-uat-promotion-dynamic-validation-policy/v1";
export const TASK70_DYNAMIC_ARTIFACT_CONTRACT =
  "chenyida-erp-task70-isolated-dynamic-validation/v1";
export const TASK70_DYNAMIC_POLICY_PATH =
  "chenyida_erp_site/operations/uat-promotion-dynamic-validation-policy-v1.json";
export const TASK70_DYNAMIC_ARTIFACT_PATH =
  "chenyida_erp_site/operations/uat-promotion-dynamic-evidence-v1.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const TREE = /^[0-9a-f]{40}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/;
const SAFE_PATH = /^(?:chenyida_erp_site|docs)\/[A-Za-z0-9._/-]+$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COVERAGE_STATUS = new Set(["MISSING", "PARTIAL", "PROVED"]);
const STAGES = Object.freeze([
  "PRECONDITION_RECHECK", "WRITER_CONTAINMENT", "POSTGRESQL_RESTORE",
  "UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
  "RUNTIME_CONFIGURATION_RESTORE", "WEB_WORKER_PREDECESSOR_ACTIVATION",
  "PROTECTED_RESOURCE_RECHECK",
]);
const CHECKS = Object.freeze([
  "POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT",
  "BACKUP_STATUS_CONTENT", "MIGRATION_HEAD", "CADDY_IDENTITY",
  "POSTGRES_IDENTITY", "WEB_IDENTITY", "WORKER_IDENTITY",
  "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "HEALTH",
  "PROTECTED_RESOURCES",
]);
const NON_CLAIMS = Object.freeze([
  "DOES_NOT_PROVE_HOST_ACTIVATION",
  "DOES_NOT_PROVE_ACTUAL_UAT_ROLLBACK",
  "DOES_NOT_PROVE_HUMAN_UAT",
  "DOES_NOT_PROVE_PRODUCTION_READINESS",
  "DOES_NOT_PROVE_FULL_TASK70_COMPLETION",
  "DOES_NOT_PROVE_DUMP_MIGRATION_ACL_VOLUME_OR_COMPOSE_RECOVERY",
]);
const POLICY_FIELDS = Object.freeze([
  "schema_version", "contract", "authority", "task_id", "execution_class",
  "evidence_scope", "deployment_class", "audit_clearance", "artifact_path",
  "artifact_contract", "artifact_max_bytes", "handler_implementation_status",
  "required_stage_order", "required_check_order", "source_paths", "case_catalog",
  "required_non_claims", "required_target_guard", "resource_policy", "cleanup_policy",
]);
const APPLICATION_PACKAGE_PATH = "chenyida_erp_site/package.json";
const MIGRATION_HEAD_PATH =
  "chenyida_erp_site/drizzle-postgres/0046_runtime_lock_privilege_boundary.sql";
const REQUIRED_TMPFS = Object.freeze({
  "/tmp": Object.freeze({
    size_bytes: 33554432,
    options: "rw,nosuid,nodev,noexec,uid=999,gid=999,mode=1777",
  }),
  "/var/lib/postgresql/data": Object.freeze({
    size_bytes: 402653184,
    options: "rw,nosuid,nodev,noexec,uid=999,gid=999,mode=0700",
  }),
  "/var/run/postgresql": Object.freeze({
    size_bytes: 16777216,
    options: "rw,nosuid,nodev,noexec,uid=999,gid=999,mode=0700",
  }),
});

export class Task70DynamicEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "Task70DynamicEvidenceError";
    this.code = code;
  }
}

function reject(code) {
  throw new Task70DynamicEvidenceError(code);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function canonicalTask70DynamicJson(value) {
  return JSON.stringify(stable(value));
}

export function task70DynamicSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return canonicalTask70DynamicJson(left) === canonicalTask70DynamicJson(right);
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !same(Object.keys(value).sort(), [...keys].sort())) reject(code);
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) reject(code);
  return value;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) reject(code);
  return value;
}

function boundedNumber(value, minimum, maximum, code) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function exactStringArray(value, expected, code) {
  if (!Array.isArray(value) || !same(value, expected)) reject(code);
  return value;
}

function validateContainerLimits(value) {
  exactKeys(value, [
    "cpus", "memory_bytes", "memory_swap_bytes", "pids", "user", "network_mode",
    "rootfs_read_only", "cap_drop", "cap_add", "security_opt", "restart_policy",
    "privileged", "devices", "mounts", "pull_policy", "log_driver",
    "image_must_preexist", "build_forbidden", "tmpfs",
  ], "TASK70_DYNAMIC_POLICY_CONTAINER_LIMITS_INVALID");
  if (value.cpus !== 1 || value.memory_bytes !== 805306368
    || value.memory_swap_bytes !== value.memory_bytes || value.pids !== 192
    || value.user !== "999:999" || value.network_mode !== "none"
    || value.rootfs_read_only !== true || !same(value.cap_drop, ["ALL"])
    || !same(value.cap_add, []) || !same(value.security_opt, ["no-new-privileges"])
    || value.restart_policy !== "no" || value.privileged !== false
    || !same(value.devices, []) || !same(value.mounts, [])
    || value.pull_policy !== "never" || value.log_driver !== "none"
    || value.image_must_preexist !== true || value.build_forbidden !== true) {
    reject("TASK70_DYNAMIC_POLICY_CONTAINER_LIMITS_INVALID");
  }
  exactKeys(value.tmpfs, Object.keys(REQUIRED_TMPFS),
    "TASK70_DYNAMIC_POLICY_TMPFS_INVALID");
  for (const [target, expected] of Object.entries(REQUIRED_TMPFS)) {
    const spec = value.tmpfs[target];
    exactKeys(spec, ["size_bytes", "options"], "TASK70_DYNAMIC_POLICY_TMPFS_INVALID");
    if (!same(spec, expected)) {
      reject("TASK70_DYNAMIC_POLICY_TMPFS_INVALID");
    }
  }
  return value;
}

export function validateTask70DynamicPolicy(policy) {
  exactKeys(policy, POLICY_FIELDS, "TASK70_DYNAMIC_POLICY_FIELDS_INVALID");
  if (policy.schema_version !== 1 || policy.contract !== TASK70_DYNAMIC_POLICY_CONTRACT
    || policy.authority !== "SELFHOSTED_NODE_POSTGRESQL_REPOSITORY_SOURCE"
    || policy.task_id !== "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70"
    || policy.execution_class !== "ISOLATED_SYNTHETIC_ONLY_NOT_UAT_AUTHORIZED"
    || policy.evidence_scope !== "ISOLATED_SYNTHETIC_ONLY"
    || policy.deployment_class !== "TEST" || policy.audit_clearance !== "PARTIAL_ONLY"
    || policy.artifact_path !== TASK70_DYNAMIC_ARTIFACT_PATH
    || policy.artifact_contract !== TASK70_DYNAMIC_ARTIFACT_CONTRACT
    || policy.artifact_max_bytes !== 1048576
    || policy.handler_implementation_status !== "HANDLERS_IMPLEMENTED_DORMANT") {
    reject("TASK70_DYNAMIC_POLICY_IDENTITY_INVALID");
  }
  exactStringArray(policy.required_stage_order, STAGES,
    "TASK70_DYNAMIC_POLICY_STAGE_ORDER_INVALID");
  exactStringArray(policy.required_check_order, CHECKS,
    "TASK70_DYNAMIC_POLICY_CHECK_ORDER_INVALID");
  exactStringArray(policy.required_non_claims, NON_CLAIMS,
    "TASK70_DYNAMIC_POLICY_NON_CLAIMS_INVALID");
  if (!Array.isArray(policy.source_paths) || policy.source_paths.length < 8
    || new Set(policy.source_paths).size !== policy.source_paths.length
    || [...policy.source_paths].sort().some((item, index) => item !== policy.source_paths[index])
    || policy.source_paths.some((item) => typeof item !== "string"
      || !SAFE_PATH.test(item) || item.includes(".."))) {
    reject("TASK70_DYNAMIC_POLICY_SOURCE_PATHS_INVALID");
  }
  if (!Array.isArray(policy.case_catalog) || policy.case_catalog.length !== 1) {
    reject("TASK70_DYNAMIC_POLICY_CASE_CATALOG_INVALID");
  }
  const testCase = policy.case_catalog[0];
  exactKeys(testCase, [
    "case_id", "evidence_class", "stage_id", "stage_coverage",
    "postgres_image_reference", "maximum_disk_delta_bytes", "container_limits",
    "required_assertions",
  ], "TASK70_DYNAMIC_POLICY_CASE_FIELDS_INVALID");
  if (testCase.case_id !== "DV70-PG-SWITCH-01"
    || testCase.evidence_class !== "POSTGRESQL_ATOMIC_SWITCH_MECHANISM_ONLY"
    || testCase.stage_id !== "POSTGRESQL_RESTORE" || testCase.stage_coverage !== "PARTIAL"
    || testCase.postgres_image_reference
      !== "postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394"
    || testCase.maximum_disk_delta_bytes !== 67108864) {
    reject("TASK70_DYNAMIC_POLICY_CASE_IDENTITY_INVALID");
  }
  validateContainerLimits(testCase.container_limits);
  if (!Array.isArray(testCase.required_assertions) || testCase.required_assertions.length !== 9
    || new Set(testCase.required_assertions).size !== testCase.required_assertions.length
    || testCase.required_assertions.some((item) => !/^[A-Z][A-Z0-9_]{7,100}$/.test(item))) {
    reject("TASK70_DYNAMIC_POLICY_ASSERTIONS_INVALID");
  }
  exactKeys(policy.required_target_guard, [
    "deployment_class", "actual_execution_class", "isolated_cluster_marker",
    "base_spec_literal_scope", "executor_fixture_candidate_marker", "local_only",
    "real_credentials_used", "production_endpoints", "uat_endpoints",
    "protected_volume_mounts", "preexisting_image_only",
  ], "TASK70_DYNAMIC_POLICY_TARGET_GUARD_INVALID");
  if (policy.required_target_guard.deployment_class !== "TEST"
    || policy.required_target_guard.actual_execution_class !== "TEST_ISOLATED_CONTAINER"
    || policy.required_target_guard.isolated_cluster_marker
      !== "chenyida-erp-task70-isolated-test/v1"
    || policy.required_target_guard.base_spec_literal_scope
      !== "PRODUCTION_OPCODE_FIXTURE_NOT_REAL_UAT_TARGET"
    || policy.required_target_guard.executor_fixture_candidate_marker
      !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || policy.required_target_guard.local_only !== true
    || policy.required_target_guard.real_credentials_used !== false
    || policy.required_target_guard.preexisting_image_only !== true
    || !same(policy.required_target_guard.production_endpoints, [])
    || !same(policy.required_target_guard.uat_endpoints, [])
    || !same(policy.required_target_guard.protected_volume_mounts, [])) {
    reject("TASK70_DYNAMIC_POLICY_TARGET_GUARD_INVALID");
  }
  exactKeys(policy.resource_policy, [
    "minimum_available_memory_bytes", "maximum_swap_percent",
    "maximum_swap_growth_bytes", "minimum_root_available_bytes", "maximum_load1",
    "minimum_swap_sample_window_seconds", "minimum_load_breach_window_seconds",
    "require_zero_oom_kill_delta", "require_zero_service_restart_delta",
  ], "TASK70_DYNAMIC_POLICY_RESOURCE_FIELDS_INVALID");
  if (policy.resource_policy.minimum_available_memory_bytes !== 805306368
    || policy.resource_policy.maximum_swap_percent !== 80
    || policy.resource_policy.maximum_swap_growth_bytes !== 268435456
    || policy.resource_policy.minimum_root_available_bytes !== 10737418240
    || policy.resource_policy.maximum_load1 !== 4
    || policy.resource_policy.minimum_swap_sample_window_seconds !== 60
    || policy.resource_policy.minimum_load_breach_window_seconds !== 180
    || policy.resource_policy.require_zero_oom_kill_delta !== true
    || policy.resource_policy.require_zero_service_restart_delta !== true) {
    reject("TASK70_DYNAMIC_POLICY_RESOURCE_INVALID");
  }
  exactKeys(policy.cleanup_policy, [
    "task_label", "require_zero_remaining_containers", "require_zero_remaining_networks",
    "require_zero_remaining_volumes", "require_zero_remaining_temp_roots",
    "require_preexisting_container_set_unchanged", "require_preexisting_image_set_unchanged",
    "require_preexisting_volume_set_unchanged", "require_protected_volume_set_unchanged",
    "require_service_runtime_set_unchanged", "protected_volume_names",
  ], "TASK70_DYNAMIC_POLICY_CLEANUP_FIELDS_INVALID");
  if (policy.cleanup_policy.task_label !== "chenyida.erp.task70-run-id"
    || Object.entries(policy.cleanup_policy).some(([key, value]) =>
      key.startsWith("require_") && value !== true)
    || !same(policy.cleanup_policy.protected_volume_names, [
      "chenyida-erp-parallel_erp_attachments",
      "chenyida-erp-parallel_erp_backup_status",
      "chenyida-erp-parallel_erp_postgres",
      "chenyida-erp-parallel_erp_uploads",
    ])) reject("TASK70_DYNAMIC_POLICY_CLEANUP_INVALID");
  return policy;
}

function validateSnapshot(value) {
  exactKeys(value, [
    "available_memory_bytes", "swap_used_bytes", "swap_total_bytes",
    "root_available_bytes", "load1", "oom_kill_count", "service_restart_count",
  ], "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  nonNegativeInteger(value.available_memory_bytes, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  nonNegativeInteger(value.swap_used_bytes, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  positiveInteger(value.swap_total_bytes, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  if (value.swap_used_bytes > value.swap_total_bytes) reject("TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  nonNegativeInteger(value.root_available_bytes, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  boundedNumber(value.load1, 0, 1000, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  nonNegativeInteger(value.oom_kill_count, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  nonNegativeInteger(value.service_restart_count, "TASK70_DYNAMIC_RESOURCE_SNAPSHOT_INVALID");
  return value;
}

function validateResourceGate(value, policy, testCase) {
  exactKeys(value, [
    "before", "after", "swap_sample_window_seconds", "load_breach_window_seconds",
    "minimum_available_memory_bytes", "maximum_swap_percent_observed",
    "swap_growth_bytes", "minimum_root_available_bytes", "maximum_load1_observed",
    "oom_kill_delta", "service_restart_delta", "declared_maximum_disk_delta_bytes",
    "observed_peak_disk_delta_bytes", "result",
  ], "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  validateSnapshot(value.before);
  validateSnapshot(value.after);
  positiveInteger(value.swap_sample_window_seconds,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  positiveInteger(value.load_breach_window_seconds,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  nonNegativeInteger(value.minimum_available_memory_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  boundedNumber(value.maximum_swap_percent_observed, 0, 100,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  nonNegativeInteger(value.swap_growth_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  nonNegativeInteger(value.minimum_root_available_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  boundedNumber(value.maximum_load1_observed, 0, 1000,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  nonNegativeInteger(value.oom_kill_delta,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  nonNegativeInteger(value.service_restart_delta,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  positiveInteger(value.declared_maximum_disk_delta_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  nonNegativeInteger(value.observed_peak_disk_delta_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  const resource = policy.resource_policy;
  const endpointSwapPercent = Math.max(
    value.before.swap_used_bytes / value.before.swap_total_bytes * 100,
    value.after.swap_used_bytes / value.after.swap_total_bytes * 100,
  );
  if (value.swap_sample_window_seconds < resource.minimum_swap_sample_window_seconds
    || value.load_breach_window_seconds < resource.minimum_load_breach_window_seconds
    || value.minimum_available_memory_bytes < resource.minimum_available_memory_bytes
    || value.maximum_swap_percent_observed > resource.maximum_swap_percent
    || value.swap_growth_bytes > resource.maximum_swap_growth_bytes
    || value.minimum_root_available_bytes < resource.minimum_root_available_bytes
    || value.maximum_load1_observed > resource.maximum_load1
    || value.oom_kill_delta !== 0 || value.service_restart_delta !== 0
    || value.declared_maximum_disk_delta_bytes !== testCase.maximum_disk_delta_bytes
    || value.observed_peak_disk_delta_bytes > value.declared_maximum_disk_delta_bytes
    || value.minimum_available_memory_bytes > value.before.available_memory_bytes
    || value.minimum_available_memory_bytes > value.after.available_memory_bytes
    || value.maximum_swap_percent_observed < endpointSwapPercent
    || value.swap_growth_bytes
      < Math.max(0, value.after.swap_used_bytes - value.before.swap_used_bytes)
    || value.minimum_root_available_bytes > value.before.root_available_bytes
    || value.minimum_root_available_bytes > value.after.root_available_bytes
    || value.maximum_load1_observed < value.before.load1
    || value.maximum_load1_observed < value.after.load1
    || value.after.oom_kill_count - value.before.oom_kill_count !== value.oom_kill_delta
    || value.after.service_restart_count - value.before.service_restart_count
      !== value.service_restart_delta
    || value.before.available_memory_bytes
      < resource.minimum_available_memory_bytes + testCase.container_limits.memory_bytes
    || value.before.root_available_bytes
      < resource.minimum_root_available_bytes + value.declared_maximum_disk_delta_bytes
    || value.result !== "PASS") reject("TASK70_DYNAMIC_RESOURCE_GATE_FAILED");
  return value;
}

function validateObjectFingerprint(value) {
  exactKeys(value, [
    "container_set_sha256", "image_set_sha256", "volume_set_sha256",
    "protected_volumes_sha256", "service_runtime_sha256",
  ], "TASK70_DYNAMIC_OBJECT_FINGERPRINT_INVALID");
  if (Object.values(value).some((item) => !SHA256.test(item) || /^0+$/.test(item))) {
    reject("TASK70_DYNAMIC_OBJECT_FINGERPRINT_INVALID");
  }
  return value;
}

function validateCase(value, policyCase) {
  exactKeys(value, [
    "case_id", "evidence_class", "stage_id", "stage_coverage", "result",
    "production_sql_sha256", "executed_sql_sha256", "opcode_spec_sha256",
    "assertions", "case_evidence_sha256",
  ], "TASK70_DYNAMIC_CASE_FIELDS_INVALID");
  const { case_evidence_sha256: claimedCaseEvidenceSha256, ...caseEvidenceBody } = value;
  if (value.case_id !== policyCase.case_id || value.evidence_class !== policyCase.evidence_class
    || value.stage_id !== policyCase.stage_id || value.stage_coverage !== policyCase.stage_coverage
    || value.result !== "PASS" || !SHA256.test(value.production_sql_sha256)
    || value.production_sql_sha256 !== value.executed_sql_sha256
    || !SHA256.test(value.opcode_spec_sha256) || !SHA256.test(value.case_evidence_sha256)
    || /^0+$/.test(value.case_evidence_sha256)
    || claimedCaseEvidenceSha256
      !== task70DynamicSha256(canonicalTask70DynamicJson(caseEvidenceBody))) {
    reject("TASK70_DYNAMIC_CASE_INVALID");
  }
  if (!Array.isArray(value.assertions)
    || value.assertions.length !== policyCase.required_assertions.length) {
    reject("TASK70_DYNAMIC_CASE_ASSERTIONS_INVALID");
  }
  for (let index = 0; index < value.assertions.length; index += 1) {
    const assertion = value.assertions[index];
    exactKeys(assertion, ["id", "result", "evidence_sha256"],
      "TASK70_DYNAMIC_CASE_ASSERTION_FIELDS_INVALID");
    if (assertion.id !== policyCase.required_assertions[index] || assertion.result !== "PASS"
      || !SHA256.test(assertion.evidence_sha256) || /^0+$/.test(assertion.evidence_sha256)) {
      reject("TASK70_DYNAMIC_CASE_ASSERTION_INVALID");
    }
  }
  return value;
}

function expectedCoverage(policy, cases) {
  const passed = new Map(cases.map((item) => [item.case_id, item]));
  const stages = policy.required_stage_order.map((id) => ({ id, status: "MISSING" }));
  for (const policyCase of policy.case_catalog) {
    if (passed.has(policyCase.case_id)) {
      stages.find((entry) => entry.id === policyCase.stage_id).status =
        policyCase.stage_coverage;
    }
  }
  return {
    stages,
    checks: policy.required_check_order.map((id) => ({ id, status: "MISSING" })),
    status: cases.length ? "PARTIAL" : "NOT_EXECUTED",
  };
}

function validateCoverage(value, policy, cases) {
  exactKeys(value, ["stages", "checks", "status"], "TASK70_DYNAMIC_COVERAGE_FIELDS_INVALID");
  for (const [actual, expectedIds] of [[value.stages, policy.required_stage_order],
    [value.checks, policy.required_check_order]]) {
    if (!Array.isArray(actual) || actual.length !== expectedIds.length) {
      reject("TASK70_DYNAMIC_COVERAGE_INVALID");
    }
    actual.forEach((entry, index) => {
      exactKeys(entry, ["id", "status"], "TASK70_DYNAMIC_COVERAGE_ENTRY_FIELDS_INVALID");
      if (entry.id !== expectedIds[index] || !COVERAGE_STATUS.has(entry.status)) {
        reject("TASK70_DYNAMIC_COVERAGE_INVALID");
      }
    });
  }
  const expected = expectedCoverage(policy, cases);
  if (!same(value, expected) || value.status !== "PARTIAL"
    || value.stages.some((entry) => entry.status === "PROVED")
    || value.checks.some((entry) => entry.status !== "MISSING")) {
    reject("TASK70_DYNAMIC_COVERAGE_OVERCLAIMED");
  }
  return value;
}

function validateCleanup(value, runId, beforeFingerprint, afterFingerprint) {
  exactKeys(value, [
    "task_label", "created_containers", "created_networks", "created_volumes",
    "temp_roots", "removed_container_ids", "remaining_containers",
    "remaining_networks", "remaining_volumes", "remaining_temp_roots",
    "process_group_remaining", "result", "cleanup_receipt_sha256",
  ], "TASK70_DYNAMIC_CLEANUP_FIELDS_INVALID");
  const { cleanup_receipt_sha256: claimedCleanupSha256, ...cleanupBody } = value;
  if (value.task_label !== `chenyida.erp.task70-run-id=${runId}`
    || !Array.isArray(value.created_containers) || value.created_containers.length !== 1
    || !same(value.created_networks, []) || !same(value.created_volumes, [])
    || !Array.isArray(value.temp_roots) || value.temp_roots.length !== 1
    || !Array.isArray(value.removed_container_ids) || value.removed_container_ids.length !== 1
    || !same(value.remaining_containers, []) || !same(value.remaining_networks, [])
    || !same(value.remaining_volumes, []) || !same(value.remaining_temp_roots, [])
    || value.process_group_remaining !== 0 || value.result !== "ZERO_TASK_RESIDUE"
    || !SHA256.test(value.cleanup_receipt_sha256)
    || claimedCleanupSha256
      !== task70DynamicSha256(canonicalTask70DynamicJson(cleanupBody))
    || !same(beforeFingerprint, afterFingerprint)) reject("TASK70_DYNAMIC_CLEANUP_FAILED");
  const container = value.created_containers[0];
  exactKeys(container, ["id", "name", "label"], "TASK70_DYNAMIC_CLEANUP_CONTAINER_INVALID");
  if (!/^[0-9a-f]{64}$/.test(container.id) || container.name !== `cyd-dv70-pg-switch-${runId}`
    || container.label !== value.task_label || value.removed_container_ids[0] !== container.id) {
    reject("TASK70_DYNAMIC_CLEANUP_CONTAINER_INVALID");
  }
  if (!/^\/tmp\/cyd-dv70-pg-switch\.[A-Za-z0-9]{6,16}$/.test(value.temp_roots[0])) {
    reject("TASK70_DYNAMIC_CLEANUP_TEMP_ROOT_INVALID");
  }
  return value;
}

export function validateTask70DynamicArtifact(artifact, { policy, sourceBodies }) {
  policy = validateTask70DynamicPolicy(policy);
  exactKeys(artifact, [
    "schema_version", "contract", "task_id", "run_id", "evidence_scope",
    "deployment_class", "audit_clearance", "started_at", "completed_at", "source",
    "source_bindings", "target_guard", "runtime", "resource_gate", "object_protection",
    "cases", "coverage", "cleanup", "non_claims", "result", "artifact_sha256",
  ], "TASK70_DYNAMIC_ARTIFACT_FIELDS_INVALID");
  const startedAt = Date.parse(artifact.started_at);
  const completedAt = Date.parse(artifact.completed_at);
  if (artifact.schema_version !== 1 || artifact.contract !== policy.artifact_contract
    || artifact.task_id !== policy.task_id || !RUN_ID.test(artifact.run_id)
    || artifact.evidence_scope !== policy.evidence_scope
    || artifact.deployment_class !== policy.deployment_class
    || artifact.audit_clearance !== policy.audit_clearance
    || !ISO_UTC.test(artifact.started_at) || !ISO_UTC.test(artifact.completed_at)
    || !Number.isFinite(startedAt) || !Number.isFinite(completedAt)
    || new Date(startedAt).toISOString() !== artifact.started_at
    || new Date(completedAt).toISOString() !== artifact.completed_at
    || completedAt < startedAt
    || artifact.result !== "PASS_PARTIAL" || !SHA256.test(artifact.artifact_sha256)) {
    reject("TASK70_DYNAMIC_ARTIFACT_IDENTITY_INVALID");
  }
  const { artifact_sha256: claimed, ...body } = artifact;
  if (claimed !== task70DynamicSha256(canonicalTask70DynamicJson(body))) {
    reject("TASK70_DYNAMIC_ARTIFACT_SHA256_MISMATCH");
  }
  exactKeys(artifact.source, ["git_commit", "git_tree", "application_version", "migration_head"],
    "TASK70_DYNAMIC_SOURCE_FIELDS_INVALID");
  if (!COMMIT.test(artifact.source.git_commit) || !TREE.test(artifact.source.git_tree)
    || !VERSION.test(artifact.source.application_version)
    || !MIGRATION.test(artifact.source.migration_head)) reject("TASK70_DYNAMIC_SOURCE_INVALID");
  if (!(sourceBodies instanceof Map) || !Array.isArray(artifact.source_bindings)
    || artifact.source_bindings.length !== policy.source_paths.length) {
    reject("TASK70_DYNAMIC_SOURCE_BINDINGS_INVALID");
  }
  artifact.source_bindings.forEach((binding, index) => {
    exactKeys(binding, ["path", "sha256"], "TASK70_DYNAMIC_SOURCE_BINDING_FIELDS_INVALID");
    const expectedPath = policy.source_paths[index];
    const source = sourceBodies.get(expectedPath);
    if (binding.path !== expectedPath || typeof source !== "string"
      || binding.sha256 !== task70DynamicSha256(source)) {
      reject("TASK70_DYNAMIC_SOURCE_BINDING_MISMATCH");
    }
  });
  let applicationVersion;
  try {
    applicationVersion = JSON.parse(sourceBodies.get(APPLICATION_PACKAGE_PATH)).version;
  } catch {
    reject("TASK70_DYNAMIC_SOURCE_APPLICATION_VERSION_INVALID");
  }
  if (artifact.source.application_version !== applicationVersion
    || artifact.source.migration_head !== basename(MIGRATION_HEAD_PATH)
    || typeof sourceBodies.get(MIGRATION_HEAD_PATH) !== "string") {
    reject("TASK70_DYNAMIC_SOURCE_REPOSITORY_IDENTITY_MISMATCH");
  }
  if (!same(artifact.target_guard, policy.required_target_guard)) {
    reject("TASK70_DYNAMIC_TARGET_GUARD_INVALID");
  }
  exactKeys(artifact.runtime, [
    "platform", "postgres_image_reference", "postgres_image_id", "docker_binary_sha256",
    "container_limits", "build_performed", "pull_performed", "mounted_volume_names",
  ], "TASK70_DYNAMIC_RUNTIME_FIELDS_INVALID");
  const policyCase = policy.case_catalog[0];
  if (artifact.runtime.platform !== "linux/amd64"
    || artifact.runtime.postgres_image_reference !== policyCase.postgres_image_reference
    || !DIGEST.test(artifact.runtime.postgres_image_id)
    || /^sha256:0+$/.test(artifact.runtime.postgres_image_id)
    || !SHA256.test(artifact.runtime.docker_binary_sha256)
    || /^0+$/.test(artifact.runtime.docker_binary_sha256)
    || !same(artifact.runtime.container_limits, policyCase.container_limits)
    || artifact.runtime.build_performed !== false || artifact.runtime.pull_performed !== false
    || !same(artifact.runtime.mounted_volume_names, [])) reject("TASK70_DYNAMIC_RUNTIME_INVALID");
  validateResourceGate(artifact.resource_gate, policy, policyCase);
  exactKeys(artifact.object_protection, ["before", "after", "result"],
    "TASK70_DYNAMIC_OBJECT_PROTECTION_FIELDS_INVALID");
  validateObjectFingerprint(artifact.object_protection.before);
  validateObjectFingerprint(artifact.object_protection.after);
  if (artifact.object_protection.result !== "UNCHANGED"
    || !same(artifact.object_protection.before, artifact.object_protection.after)) {
    reject("TASK70_DYNAMIC_OBJECT_PROTECTION_FAILED");
  }
  if (!Array.isArray(artifact.cases) || artifact.cases.length !== 1) {
    reject("TASK70_DYNAMIC_CASE_SET_INVALID");
  }
  validateCase(artifact.cases[0], policyCase);
  validateCoverage(artifact.coverage, policy, artifact.cases);
  validateCleanup(artifact.cleanup, artifact.run_id,
    artifact.object_protection.before, artifact.object_protection.after);
  exactStringArray(artifact.non_claims, policy.required_non_claims,
    "TASK70_DYNAMIC_NON_CLAIMS_INVALID");
  return artifact;
}

export function summarizeTask70DynamicEvidence(input, { policy, sourceBodies } = {}) {
  policy = validateTask70DynamicPolicy(policy);
  const base = {
    repository_handler_capability: policy.handler_implementation_status,
    isolated_dynamic_validation: "NOT_EXECUTED_NO_VERIFIED_RECEIPT",
    host_runtime_activation: "NOT_ACTIVATED_NO_TRUSTED_HOST_RECEIPT",
    actual_uat_rollback_rehearsal: "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT",
    audit_clearance: policy.audit_clearance,
    verified_case_ids: [],
    artifact_sha256: null,
    may_clear_dynamic_blocker: false,
    may_claim_host_activation: false,
    may_claim_actual_uat: false,
    may_claim_production_readiness: false,
  };
  if (input === null || input === undefined) return base;
  const artifact = validateTask70DynamicArtifact(input, { policy, sourceBodies });
  return {
    ...base,
    isolated_dynamic_validation: "VERIFIED_PARTIAL_ONLY",
    verified_case_ids: artifact.cases.map((entry) => entry.case_id),
    artifact_sha256: artifact.artifact_sha256,
  };
}

function readBoundedNoFollow(repositoryPath, maximumBytes) {
  if (!SAFE_PATH.test(repositoryPath) || repositoryPath.includes("..")) {
    reject("TASK70_DYNAMIC_ARTIFACT_PATH_INVALID");
  }
  const absolute = resolve(ROOT, repositoryPath);
  if (!absolute.startsWith(`${ROOT}/`)) reject("TASK70_DYNAMIC_ARTIFACT_PATH_INVALID");
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    reject("TASK70_DYNAMIC_ARTIFACT_OPEN_FAILED");
  }
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > maximumBytes
      || (before.mode & 0o022) !== 0) reject("TASK70_DYNAMIC_ARTIFACT_METADATA_INVALID");
    const raw = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < raw.length) {
      const count = readSync(descriptor, raw, offset, raw.length - offset, null);
      if (count === 0) reject("TASK70_DYNAMIC_ARTIFACT_TRUNCATED");
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      reject("TASK70_DYNAMIC_ARTIFACT_CHANGED_DURING_READ");
    }
    return raw.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function loadTask70DynamicRepositoryInputs() {
  const policyRaw = readFileSync(resolve(ROOT, TASK70_DYNAMIC_POLICY_PATH), "utf8");
  const policy = validateTask70DynamicPolicy(JSON.parse(policyRaw));
  const sourceBodies = new Map(policy.source_paths.map((repositoryPath) => [
    repositoryPath, readFileSync(resolve(ROOT, repositoryPath), "utf8"),
  ]));
  const artifactRaw = readBoundedNoFollow(policy.artifact_path, policy.artifact_max_bytes);
  return {
    policy,
    sourceBodies,
    artifact: artifactRaw === null ? null : JSON.parse(artifactRaw),
  };
}

function main(args) {
  if (args.length !== 1 || !["verify-policy", "verify"].includes(args[0])) {
    process.stderr.write("usage: uat-promotion-dynamic-evidence.mjs verify-policy|verify\n");
    process.exitCode = 2;
    return;
  }
  const inputs = loadTask70DynamicRepositoryInputs();
  if (args[0] === "verify-policy") {
    process.stdout.write("TASK70 DYNAMIC EVIDENCE POLICY VERIFY PASS clearance=PARTIAL_ONLY\n");
    return;
  }
  if (inputs.artifact === null) reject("TASK70_DYNAMIC_ARTIFACT_NOT_EXECUTED");
  const artifact = validateTask70DynamicArtifact(inputs.artifact, inputs);
  process.stdout.write(`TASK70 DYNAMIC EVIDENCE VERIFY PASS status=PARTIAL artifact_sha256=${artifact.artifact_sha256}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error?.code || "TASK70_DYNAMIC_EVIDENCE_FAILED"}\n`);
    process.exitCode = 1;
  }
}
