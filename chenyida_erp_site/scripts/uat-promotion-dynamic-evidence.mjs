import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TASK70_DYNAMIC_POLICY_CONTRACT =
  "chenyida-erp-uat-promotion-dynamic-validation-policy/v2";
export const TASK70_DYNAMIC_ARTIFACT_CONTRACT =
  "chenyida-erp-task70-isolated-dynamic-validation/v2";
export const TASK70_DYNAMIC_POLICY_PATH =
  "chenyida_erp_site/operations/uat-promotion-dynamic-validation-policy-v2.json";
export const TASK70_DYNAMIC_ARTIFACT_PATH =
  "chenyida_erp_site/operations/uat-promotion-dynamic-evidence-v2.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHA256 = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^0\.1\.0-alpha\.\d+$/u;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/u;
const RUN_ID = /^dv70-[A-Za-z0-9_]{8}$/u;
const SAFE_PATH = /^(?:chenyida_erp_site|docs)\/[A-Za-z0-9._/-]+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const OID = /^[1-9][0-9]{3,9}$/u;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,24}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const COVERAGE_STATUS = new Set(["MISSING", "PARTIAL", "PROVED"]);
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const FAULT_BARRIER = "DV70_FIRST_RENAME_REACHED";
const DRIFT_MARKER =
  "chenyida-erp-task70-isolated-test/v1:EXPECTED_PRECONDITION_DRIFT";
const APPLICATION_PACKAGE_PATH = "chenyida_erp_site/package.json";
const MIGRATION_HEAD_PATH =
  "chenyida_erp_site/drizzle-postgres/0046_runtime_lock_privilege_boundary.sql";
const IMAGE_REFERENCE =
  "docker.io/library/postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394";
const IMAGE_DIGEST = IMAGE_REFERENCE.split("@")[1];

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
  "DOES_NOT_PROVE_TRANSPORT_LEVEL_COMMIT_RESPONSE_LOSS_OR_RUNTIME_RECOVERY",
]);
const SOURCE_PATHS = Object.freeze([
  "chenyida_erp_site/drizzle-postgres/0046_runtime_lock_privilege_boundary.sql",
  "chenyida_erp_site/operations/uat-promotion-dynamic-validation-policy-v2.json",
  "chenyida_erp_site/package.json",
  "chenyida_erp_site/release/release-test-inventory-v1.json",
  "chenyida_erp_site/release/test-runtime-policy-v1.json",
  "chenyida_erp_site/scripts/uat-promotion-dynamic-evidence.mjs",
  "chenyida_erp_site/scripts/uat-promotion-dynamic-pg-switch.py",
  "chenyida_erp_site/scripts/uat-promotion-rollback-audit.mjs",
  "chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor-contract.mjs",
  "chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py",
  "chenyida_erp_site/scripts/uat-promotion-rollback-runtime-contract.mjs",
  "chenyida_erp_site/tests/selfhost-uat-promotion-rollback-audit.test.mjs",
  "chenyida_erp_site/tests/test_uat_promotion_dynamic_pg_switch.py",
  "chenyida_erp_site/tests/test_uat_promotion_rollback_fixed_executor.py",
]);
const SCENARIOS = Object.freeze([
  "EXACT_SUCCESS", "REPEAT_FAIL_CLOSED", "PRECONDITION_DRIFT_REJECTED",
  "FIRST_RENAME_FAULT_ROLLBACK",
  "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION_READ_ONLY_OBSERVATION",
]);
const ASSERTIONS = Object.freeze([
  "PRODUCTION_SQL_SHA_BOUND",
  "EXACT_SWITCH_NEW_SEALED",
  "DATABASE_OIDS_PRESERVED",
  "REPEAT_EXECUTION_FAILS_CLOSED",
  "PRECONDITION_DRIFT_REJECTED",
  "FIRST_RENAME_FAULT_ROLLS_BACK",
  "CALLER_RESULT_DISCARD_PROBED_READ_ONLY",
  "NO_PERSISTENT_MIXED_LAYOUT",
  "EXISTING_RUNTIME_AND_PROTECTED_VOLUMES_UNCHANGED",
]);
const PROTECTED_VOLUMES = Object.freeze([
  "chenyida-erp-parallel_erp_attachments",
  "chenyida-erp-parallel_erp_backup_status",
  "chenyida-erp-parallel_erp_postgres",
  "chenyida-erp-parallel_erp_uploads",
]);
const SERVICES = Object.freeze(["caddy", "postgres", "web", "worker"]);
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
const CONTAINER_LIMITS = Object.freeze({
  cpus: 1,
  memory_bytes: 805306368,
  memory_swap_bytes: 805306368,
  pids: 192,
  shared_memory_bytes: 67108864,
  stop_timeout_seconds: 5,
  user: "999:999",
  network_mode: "none",
  rootfs_read_only: true,
  cap_drop: ["ALL"],
  cap_add: [],
  security_opt: ["no-new-privileges"],
  restart_policy: "no",
  privileged: false,
  devices: [],
  mounts: [],
  published_ports: [],
  pull_policy: "never",
  log_driver: "none",
  image_must_preexist: true,
  build_forbidden: true,
  tmpfs: REQUIRED_TMPFS,
});
const TARGET_GUARD = Object.freeze({
  deployment_class: "TEST",
  actual_execution_class: "TEST_ISOLATED_CONTAINER",
  isolated_cluster_marker: "chenyida-erp-task70-isolated-test/v1",
  management_database: "postgres",
  management_database_comment: "chenyida-erp-task70-isolated-test/v1",
  authentication_mode: "LOCAL_UNIX_TRUST_SYNTHETIC_ONLY",
  postgres_listen_addresses: "*",
  docker_network_mode: "none",
  tcp_publish_allowed: false,
  base_spec_literal_scope: "PRODUCTION_OPCODE_FIXTURE_NOT_REAL_UAT_TARGET",
  executor_fixture_candidate_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
  local_only: true,
  real_credentials_used: false,
  production_endpoints: [],
  uat_endpoints: [],
  postgres_port_bindings: [],
  protected_volume_mounts: [],
  preexisting_image_only: true,
});
const RESOURCE_POLICY = Object.freeze({
  minimum_available_memory_bytes: 805306368,
  minimum_start_available_memory_bytes: 1610612736,
  maximum_swap_percent: 80,
  maximum_swap_growth_bytes: 268435456,
  minimum_root_available_bytes: 10737418240,
  maximum_load1: 4,
  sample_interval_seconds: 5,
  maximum_sample_gap_seconds: 10,
  minimum_preflight_sample_window_seconds: 60,
  minimum_swap_sample_window_seconds: 60,
  minimum_total_sample_window_seconds: 180,
  minimum_load_breach_window_seconds: 180,
  require_zero_oom_kill_delta: true,
  require_zero_service_restart_delta: true,
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
      left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function canonicalTask70DynamicJson(value) {
  return JSON.stringify(stable(value));
}

export function task70DynamicSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha1(value) {
  const raw = Buffer.from(value, "utf8");
  return createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
}

function gitEnvironment() {
  return {
    PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0",
  };
}

function gitText(argv, code, repositoryRoot = ROOT) {
  const result = spawnSync("/usr/bin/git", argv, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    env: gitEnvironment(),
  });
  if (result.error || result.status !== 0 || result.signal !== null
    || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 1024 * 1024) {
    reject(code);
  }
  return result.stdout.trim();
}

export function loadTask70DynamicRepositoryGitProjection(
  artifact, policy, repositoryRoot = ROOT,
) {
  if (typeof repositoryRoot !== "string" || !repositoryRoot.startsWith("/")) {
    reject("TASK70_DYNAMIC_GIT_REPOSITORY_ROOT_INVALID");
  }
  if (!artifact || !COMMIT.test(artifact.source?.git_commit || "")
    || !COMMIT.test(artifact.source?.git_tree || "")) {
    reject("TASK70_DYNAMIC_GIT_PROJECTION_INPUT_INVALID");
  }
  const commit = gitText(
    ["rev-parse", "--verify", `${artifact.source.git_commit}^{commit}`],
    "TASK70_DYNAMIC_GIT_COMMIT_NOT_FOUND",
    repositoryRoot,
  );
  const tree = gitText(
    ["rev-parse", "--verify", `${commit}^{tree}`],
    "TASK70_DYNAMIC_GIT_TREE_NOT_FOUND",
    repositoryRoot,
  );
  const headCommit = gitText(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "TASK70_DYNAMIC_GIT_HEAD_INVALID",
    repositoryRoot,
  );
  const ancestry = spawnSync(
    "/usr/bin/git", ["merge-base", "--is-ancestor", commit, headCommit], {
      cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1024 * 1024, shell: false,
      env: gitEnvironment(),
    },
  );
  if (ancestry.error || ancestry.status !== 0 || ancestry.signal !== null) {
    reject("TASK70_DYNAMIC_GIT_COMMIT_NOT_ANCESTOR");
  }
  const sourceBlobs = policy.source_paths.map((repositoryPath) => ({
    path: repositoryPath,
    git_blob: gitText(
      ["rev-parse", "--verify", `${commit}:${repositoryPath}`],
      "TASK70_DYNAMIC_GIT_SOURCE_BLOB_NOT_FOUND",
      repositoryRoot,
    ),
  }));
  return {
    commit, tree, head_commit: headCommit,
    commit_is_ancestor_of_head: true, source_blobs: sourceBlobs,
  };
}

function pythonDigest(value) {
  return task70DynamicSha256(`${canonicalTask70DynamicJson(value)}\n`);
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

function finiteNumber(value, minimum, maximum, code) {
  if (typeof value !== "number" || !Number.isFinite(value)
    || value < minimum || value > maximum) reject(code);
  return value;
}

function nonzeroSha(value, code) {
  if (typeof value !== "string" || !SHA256.test(value) || /^0+$/u.test(value)) reject(code);
  return value;
}

function exactArray(value, expected, code) {
  if (!Array.isArray(value) || !same(value, expected)) reject(code);
  return value;
}

function strictIso(value, code) {
  if (typeof value !== "string" || !ISO_UTC.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    reject(code);
  }
  return value;
}

function selfDigest(value, field, code, digest = task70DynamicSha256) {
  const claimed = value[field];
  const body = { ...value };
  delete body[field];
  if (!SHA256.test(claimed || "")
    || claimed !== digest(canonicalTask70DynamicJson(body))) reject(code);
  return body;
}

function pythonSelfDigest(value, field, code) {
  const claimed = value[field];
  const body = { ...value };
  delete body[field];
  if (!SHA256.test(claimed || "") || claimed !== pythonDigest(body)) reject(code);
  return body;
}

export function validateTask70DynamicPolicy(policy) {
  exactKeys(policy, [
    "schema_version", "contract", "authority", "task_id", "execution_class",
    "evidence_scope", "deployment_class", "audit_clearance", "artifact_path",
    "artifact_contract", "artifact_max_bytes", "handler_implementation_status",
    "required_stage_order", "required_check_order", "source_paths", "case_catalog",
    "required_non_claims", "required_target_guard", "resource_policy", "cleanup_policy",
  ], "TASK70_DYNAMIC_POLICY_FIELDS_INVALID");
  if (policy.schema_version !== 2 || policy.contract !== TASK70_DYNAMIC_POLICY_CONTRACT
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
  exactArray(policy.required_stage_order, STAGES, "TASK70_DYNAMIC_POLICY_STAGE_ORDER_INVALID");
  exactArray(policy.required_check_order, CHECKS, "TASK70_DYNAMIC_POLICY_CHECK_ORDER_INVALID");
  exactArray(policy.required_non_claims, NON_CLAIMS, "TASK70_DYNAMIC_POLICY_NON_CLAIMS_INVALID");
  exactArray(policy.source_paths, SOURCE_PATHS, "TASK70_DYNAMIC_POLICY_SOURCE_PATHS_INVALID");
  if (policy.source_paths.some((item) => !SAFE_PATH.test(item) || item.includes(".."))) {
    reject("TASK70_DYNAMIC_POLICY_SOURCE_PATHS_INVALID");
  }
  if (!Array.isArray(policy.case_catalog) || policy.case_catalog.length !== 1) {
    reject("TASK70_DYNAMIC_POLICY_CASE_CATALOG_INVALID");
  }
  const testCase = policy.case_catalog[0];
  exactKeys(testCase, [
    "case_id", "evidence_class", "stage_id", "stage_coverage", "producer_path",
    "production_opcode", "observation_opcode", "postgres_image_reference",
    "maximum_disk_delta_bytes", "fault_derivation", "required_scenarios",
    "container_limits", "required_assertions",
  ], "TASK70_DYNAMIC_POLICY_CASE_FIELDS_INVALID");
  if (testCase.case_id !== "DV70-PG-SWITCH-01"
    || testCase.evidence_class !== "POSTGRESQL_ATOMIC_SWITCH_MECHANISM_ONLY"
    || testCase.stage_id !== "POSTGRESQL_RESTORE" || testCase.stage_coverage !== "PARTIAL"
    || testCase.producer_path !== "chenyida_erp_site/scripts/uat-promotion-dynamic-pg-switch.py"
    || testCase.production_opcode !== "PG_RB_ATOMIC_SWITCH_V1"
    || testCase.observation_opcode !== "PG_RB_OBSERVE_STATE_V1"
    || testCase.postgres_image_reference !== IMAGE_REFERENCE
    || testCase.maximum_disk_delta_bytes !== 67108864
    || testCase.fault_derivation
      !== "PRODUCTION_SQL_PREFIX_AFTER_FIRST_RENAME_PLUS_FIXED_BARRIER_THEN_EOF_V1") {
    reject("TASK70_DYNAMIC_POLICY_CASE_IDENTITY_INVALID");
  }
  exactArray(testCase.required_scenarios, SCENARIOS,
    "TASK70_DYNAMIC_POLICY_SCENARIOS_INVALID");
  exactArray(testCase.required_assertions, ASSERTIONS,
    "TASK70_DYNAMIC_POLICY_ASSERTIONS_INVALID");
  if (!same(testCase.container_limits, CONTAINER_LIMITS)) {
    reject("TASK70_DYNAMIC_POLICY_CONTAINER_LIMITS_INVALID");
  }
  if (!same(policy.required_target_guard, TARGET_GUARD)) {
    reject("TASK70_DYNAMIC_POLICY_TARGET_GUARD_INVALID");
  }
  if (!same(policy.resource_policy, RESOURCE_POLICY)) {
    reject("TASK70_DYNAMIC_POLICY_RESOURCE_INVALID");
  }
  exactKeys(policy.cleanup_policy, [
    "task_label", "isolation_label", "require_zero_remaining_containers",
    "require_zero_remaining_networks", "require_zero_remaining_volumes",
    "require_zero_remaining_temp_roots", "require_preexisting_container_set_unchanged",
    "require_preexisting_image_set_unchanged", "require_preexisting_volume_set_unchanged",
    "require_preexisting_network_set_unchanged", "require_protected_volume_set_unchanged",
    "require_service_runtime_set_unchanged", "protected_volume_names",
    "protected_service_names",
  ], "TASK70_DYNAMIC_POLICY_CLEANUP_FIELDS_INVALID");
  if (policy.cleanup_policy.task_label !== "chenyida.erp.task70-run-id"
    || policy.cleanup_policy.isolation_label
      !== "chenyida.erp.execution-scope=isolated-synthetic-test"
    || Object.entries(policy.cleanup_policy).some(([key, value]) =>
      key.startsWith("require_") && value !== true)
    || !same(policy.cleanup_policy.protected_volume_names, PROTECTED_VOLUMES)
    || !same(policy.cleanup_policy.protected_service_names, SERVICES)) {
    reject("TASK70_DYNAMIC_POLICY_CLEANUP_INVALID");
  }
  return policy;
}

function expectedCreateArguments(policy, runId, name) {
  const limits = policy.case_catalog[0].container_limits;
  const output = [
    "create", "--pull=never", "--platform", "linux/amd64", "--name", name,
    "--label", `${policy.cleanup_policy.task_label}=${runId}`,
    "--label", policy.cleanup_policy.isolation_label,
    "--user", limits.user, "--network", limits.network_mode,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--restart", "no", "--log-driver", "none",
    "--memory", String(limits.memory_bytes), "--memory-swap", String(limits.memory_swap_bytes),
    "--cpus", String(limits.cpus), "--pids-limit", String(limits.pids),
    "--shm-size", String(limits.shared_memory_bytes),
    "--stop-timeout", String(limits.stop_timeout_seconds),
  ];
  Object.keys(limits.tmpfs).sort().forEach((target) => {
    const spec = limits.tmpfs[target];
    output.push("--tmpfs", `${target}:${spec.options},size=${spec.size_bytes}`);
  });
  output.push(
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env", "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C",
    "--env", "PGDATA=/var/lib/postgresql/data/pgdata",
    policy.case_catalog[0].postgres_image_reference,
    "postgres", "-c", "listen_addresses=*", "-c",
    "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
    "-c", "shared_buffers=64MB", "-c", "log_statement=none",
  );
  return output;
}

function validateImageProjection(value) {
  exactKeys(value, [
    "id", "descriptor_digest", "repo_digest_suffixes", "architecture", "os", "size_bytes",
  ], "TASK70_DYNAMIC_IMAGE_PROJECTION_FIELDS_INVALID");
  if (!DIGEST.test(value.id) || value.descriptor_digest !== IMAGE_DIGEST
    || !Array.isArray(value.repo_digest_suffixes)
    || !same(value.repo_digest_suffixes, [...new Set(value.repo_digest_suffixes)].sort())
    || !value.repo_digest_suffixes.includes(IMAGE_DIGEST)
    || value.repo_digest_suffixes.some((item) => !DIGEST.test(item))
    || value.architecture !== "amd64" || value.os !== "linux") {
    reject("TASK70_DYNAMIC_IMAGE_PROJECTION_INVALID");
  }
  positiveInteger(value.size_bytes, "TASK70_DYNAMIC_IMAGE_PROJECTION_INVALID");
  return value;
}

function validateContainerProjection(value, { policy, runId, image }) {
  exactKeys(value, [
    "container_id", "name", "created_at", "labels", "image_id", "image_reference",
    "user", "network_mode", "rootfs_read_only", "cap_drop", "cap_add", "security_opt",
    "restart_policy", "privileged", "memory_bytes", "memory_swap_bytes", "nano_cpus",
    "pids", "shared_memory_bytes", "stop_timeout_seconds", "log_driver", "devices",
    "binds", "mounts", "published_ports", "publish_all_ports", "tmpfs",
    "synthetic_trust_auth", "initdb_args", "pgdata", "command",
  ], "TASK70_DYNAMIC_CONTAINER_PROJECTION_FIELDS_INVALID");
  const expectedName = `cyd-dv70-pg-switch-${runId}`;
  const expectedLabels = {
    "chenyida.erp.execution-scope": "isolated-synthetic-test",
    "chenyida.erp.task70-run-id": runId,
  };
  if (!CONTAINER_ID.test(value.container_id) || value.name !== expectedName
    || typeof value.created_at !== "string" || value.created_at.length < 20
    || !same(value.labels, expectedLabels) || value.image_id !== image.id
    || value.image_reference !== IMAGE_REFERENCE || value.user !== "999:999"
    || value.network_mode !== "none" || value.rootfs_read_only !== true
    || !same(value.cap_drop, ["ALL"]) || !same(value.cap_add, [])
    || !same(value.security_opt, ["no-new-privileges"])
    || value.restart_policy !== "no" || value.privileged !== false
    || value.memory_bytes !== 805306368 || value.memory_swap_bytes !== 805306368
    || value.nano_cpus !== 1000000000 || value.pids !== 192
    || value.shared_memory_bytes !== 67108864 || value.stop_timeout_seconds !== 5
    || value.log_driver !== "none" || !same(value.devices, []) || !same(value.binds, [])
    || !same(value.mounts, []) || !same(value.published_ports, {})
    || value.publish_all_ports !== false || !same(value.tmpfs, REQUIRED_TMPFS)
    || value.synthetic_trust_auth !== true
    || value.initdb_args !== "--encoding=UTF8 --locale=C"
    || value.pgdata !== "/var/lib/postgresql/data/pgdata"
    || !same(value.command, [
      "postgres", "-c", "listen_addresses=*", "-c",
      "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
      "-c", "shared_buffers=64MB", "-c", "log_statement=none",
    ])) reject("TASK70_DYNAMIC_CONTAINER_PROJECTION_INVALID");
  return value;
}

function validateRuntime(value, { policy, runId }) {
  exactKeys(value, [
    "platform", "postgres_image_reference", "postgres_image_before",
    "postgres_image_after", "docker_binary_sha256", "container_limits",
    "docker_create_arguments", "docker_create_arguments_sha256", "container_inspect",
    "build_performed", "pull_performed", "mounted_volume_names",
  ], "TASK70_DYNAMIC_RUNTIME_FIELDS_INVALID");
  validateImageProjection(value.postgres_image_before);
  validateImageProjection(value.postgres_image_after);
  validateContainerProjection(value.container_inspect, {
    policy, runId, image: value.postgres_image_before,
  });
  const expectedArguments = expectedCreateArguments(
    policy, runId, value.container_inspect.name,
  );
  if (value.platform !== "linux/amd64" || value.postgres_image_reference !== IMAGE_REFERENCE
    || !same(value.postgres_image_before, value.postgres_image_after)
    || !SHA256.test(value.docker_binary_sha256) || /^0+$/u.test(value.docker_binary_sha256)
    || !same(value.container_limits, CONTAINER_LIMITS)
    || !same(value.docker_create_arguments, expectedArguments)
    || value.docker_create_arguments_sha256
      !== task70DynamicSha256(canonicalTask70DynamicJson(expectedArguments))
    || value.build_performed !== false || value.pull_performed !== false
    || !same(value.mounted_volume_names, [])) reject("TASK70_DYNAMIC_RUNTIME_INVALID");
  return value;
}

function validateServiceState(value, expected, code) {
  exactKeys(value, [
    "service", "container_id", "restart_count", "oom_killed", "running", "health",
  ], code);
  if (value.service !== expected || !CONTAINER_ID.test(value.container_id)
    || value.restart_count !== 0 || value.oom_killed !== false || value.running !== true
    || !["HEALTHY", "NONE"].includes(value.health)) reject(code);
  return value;
}

function validateResourceSample(value, index, previous, baselineServices, policy) {
  exactKeys(value, [
    "captured_at", "elapsed_milliseconds", "available_memory_bytes", "swap_used_bytes",
    "swap_total_bytes", "root_available_bytes", "load1", "oom_kill_count", "services",
  ], "TASK70_DYNAMIC_RESOURCE_SAMPLE_FIELDS_INVALID");
  strictIso(value.captured_at, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  nonNegativeInteger(value.elapsed_milliseconds, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  nonNegativeInteger(value.available_memory_bytes, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  nonNegativeInteger(value.swap_used_bytes, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  positiveInteger(value.swap_total_bytes, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  nonNegativeInteger(value.root_available_bytes, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  finiteNumber(value.load1, 0, 1000, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  nonNegativeInteger(value.oom_kill_count, "TASK70_DYNAMIC_RESOURCE_SAMPLE_INVALID");
  if (value.swap_used_bytes > value.swap_total_bytes
    || value.available_memory_bytes < policy.minimum_available_memory_bytes
    || value.swap_used_bytes * 100 > value.swap_total_bytes * policy.maximum_swap_percent
    || value.root_available_bytes < policy.minimum_root_available_bytes
    || value.load1 > policy.maximum_load1
    || !Array.isArray(value.services) || value.services.length !== SERVICES.length) {
    reject("TASK70_DYNAMIC_RESOURCE_SAMPLE_THRESHOLD_FAILED");
  }
  value.services.forEach((entry, serviceIndex) => {
    validateServiceState(entry, SERVICES[serviceIndex],
      "TASK70_DYNAMIC_RESOURCE_SERVICE_SAMPLE_INVALID");
    const baseline = baselineServices?.[serviceIndex];
    if (baseline && entry.container_id !== baseline.container_id) {
      reject("TASK70_DYNAMIC_RESOURCE_SERVICE_ID_CHANGED");
    }
  });
  if (index === 0) {
    if (value.available_memory_bytes < policy.minimum_start_available_memory_bytes
      || value.root_available_bytes
        < policy.minimum_root_available_bytes + 67108864) {
      reject("TASK70_DYNAMIC_RESOURCE_START_GATE_FAILED");
    }
  } else {
    const gap = value.elapsed_milliseconds - previous.elapsed_milliseconds;
    if (gap < 1 || gap > policy.maximum_sample_gap_seconds * 1000
      || Date.parse(value.captured_at) < Date.parse(previous.captured_at)) {
      reject("TASK70_DYNAMIC_RESOURCE_SAMPLE_GAP_INVALID");
    }
  }
  return value;
}

function near(left, right) {
  return Math.abs(left - right) < 1e-9;
}

function validateResourceGate(value, policy, testCase) {
  exactKeys(value, [
    "boot_id_sha256", "sample_interval_seconds", "sample_count", "sample_window_seconds",
    "preflight_sample_window_seconds", "samples", "minimum_available_memory_bytes",
    "maximum_swap_percent_observed", "maximum_rolling_swap_growth_bytes",
    "minimum_root_available_bytes", "maximum_load1_observed", "oom_kill_delta",
    "service_restart_delta", "declared_maximum_disk_delta_bytes",
    "observed_peak_disk_delta_bytes", "result", "resource_evidence_sha256",
  ], "TASK70_DYNAMIC_RESOURCE_GATE_FIELDS_INVALID");
  selfDigest(value, "resource_evidence_sha256", "TASK70_DYNAMIC_RESOURCE_GATE_SHA_INVALID");
  nonzeroSha(value.boot_id_sha256, "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  positiveInteger(value.sample_count, "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.sample_window_seconds, "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.preflight_sample_window_seconds,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.minimum_available_memory_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  finiteNumber(value.maximum_swap_percent_observed, 0, 100,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.maximum_rolling_swap_growth_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.minimum_root_available_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  finiteNumber(value.maximum_load1_observed, 0, 1000,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.oom_kill_delta, "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.service_restart_delta, "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  positiveInteger(value.declared_maximum_disk_delta_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  nonNegativeInteger(value.observed_peak_disk_delta_bytes,
    "TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  if (value.sample_interval_seconds !== policy.sample_interval_seconds
    || !Array.isArray(value.samples) || value.samples.length < 2
    || value.sample_count !== value.samples.length) reject("TASK70_DYNAMIC_RESOURCE_GATE_INVALID");
  let baselineServices;
  value.samples.forEach((sample, index) => {
    validateResourceSample(sample, index, value.samples[index - 1], baselineServices, policy);
    baselineServices ||= sample.services;
  });
  const first = value.samples[0];
  const last = value.samples.at(-1);
  const windowSeconds = Math.floor(
    (last.elapsed_milliseconds - first.elapsed_milliseconds) / 1000,
  );
  const minimumMemory = Math.min(...value.samples.map((entry) => entry.available_memory_bytes));
  const maximumSwapPercent = Math.max(...value.samples.map((entry) =>
    entry.swap_used_bytes / entry.swap_total_bytes * 100));
  const minimumRoot = Math.min(...value.samples.map((entry) => entry.root_available_bytes));
  const maximumLoad = Math.max(...value.samples.map((entry) => entry.load1));
  const maximumOom = Math.max(...value.samples.map((entry) => entry.oom_kill_count));
  const restartSums = value.samples.map((entry) =>
    entry.services.reduce((total, service) => total + service.restart_count, 0));
  let maximumRollingSwapGrowth = 0;
  const minimumWindowMs = policy.minimum_swap_sample_window_seconds * 1000;
  const maximumGapMs = policy.maximum_sample_gap_seconds * 1000;
  value.samples.forEach((current, index) => {
    const eligible = value.samples.slice(0, index).filter((previous) => {
      const difference = current.elapsed_milliseconds - previous.elapsed_milliseconds;
      return difference >= minimumWindowMs && difference <= minimumWindowMs + maximumGapMs;
    });
    if (eligible.length) {
      maximumRollingSwapGrowth = Math.max(maximumRollingSwapGrowth,
        Math.max(0, current.swap_used_bytes - eligible.at(-1).swap_used_bytes));
    }
  });
  const peakDiskDelta = Math.max(0, first.root_available_bytes - minimumRoot);
  if (value.sample_window_seconds !== windowSeconds
    || windowSeconds < policy.minimum_total_sample_window_seconds
    || value.preflight_sample_window_seconds !== policy.minimum_preflight_sample_window_seconds
    || value.preflight_sample_window_seconds > windowSeconds
    || value.minimum_available_memory_bytes !== minimumMemory
    || !near(value.maximum_swap_percent_observed, maximumSwapPercent)
    || value.maximum_rolling_swap_growth_bytes !== maximumRollingSwapGrowth
    || value.minimum_root_available_bytes !== minimumRoot
    || !near(value.maximum_load1_observed, maximumLoad)
    || value.oom_kill_delta !== maximumOom - first.oom_kill_count
    || value.service_restart_delta !== Math.max(...restartSums) - restartSums[0]
    || value.declared_maximum_disk_delta_bytes !== testCase.maximum_disk_delta_bytes
    || value.observed_peak_disk_delta_bytes !== peakDiskDelta
    || value.maximum_rolling_swap_growth_bytes > policy.maximum_swap_growth_bytes
    || value.oom_kill_delta !== 0 || value.service_restart_delta !== 0
    || value.observed_peak_disk_delta_bytes > testCase.maximum_disk_delta_bytes
    || value.result !== "PASS") reject("TASK70_DYNAMIC_RESOURCE_GATE_FAILED");
  return value;
}

function validateObjectService(value, expected) {
  exactKeys(value, [
    "service", "container_id", "image_reference_sha256", "image_id", "restart_count",
    "oom_killed", "running", "health", "mount_set_sha256", "network_set_sha256",
    "port_set_sha256",
  ], "TASK70_DYNAMIC_OBJECT_SERVICE_FIELDS_INVALID");
  if (value.service !== expected || !CONTAINER_ID.test(value.container_id)
    || !DIGEST.test(value.image_id || "") || value.restart_count !== 0
    || value.oom_killed !== false || value.running !== true
    || !["HEALTHY", "NONE"].includes(value.health)) {
    reject("TASK70_DYNAMIC_OBJECT_SERVICE_INVALID");
  }
  ["image_reference_sha256", "mount_set_sha256", "network_set_sha256",
    "port_set_sha256"].forEach((field) =>
    nonzeroSha(value[field], "TASK70_DYNAMIC_OBJECT_SERVICE_INVALID"));
  return value;
}

function validateObjectSnapshot(value, policy) {
  exactKeys(value, [
    "containers", "images", "volumes", "networks", "protected_volumes", "services",
    "fingerprint_sha256",
  ], "TASK70_DYNAMIC_OBJECT_SNAPSHOT_FIELDS_INVALID");
  selfDigest(value, "fingerprint_sha256", "TASK70_DYNAMIC_OBJECT_SNAPSHOT_SHA_INVALID");
  if (!Array.isArray(value.containers)
    || !same(value.containers, [...new Set(value.containers)].sort())
    || value.containers.some((item) => !CONTAINER_ID.test(item))) {
    reject("TASK70_DYNAMIC_OBJECT_CONTAINER_SET_INVALID");
  }
  if (!Array.isArray(value.images)) reject("TASK70_DYNAMIC_OBJECT_IMAGE_SET_INVALID");
  let previousImage = "";
  value.images.forEach((entry) => {
    exactKeys(entry, ["id", "repo_tag_set_sha256", "repo_digest_set_sha256"],
      "TASK70_DYNAMIC_OBJECT_IMAGE_FIELDS_INVALID");
    if (!DIGEST.test(entry.id || "") || entry.id <= previousImage) {
      reject("TASK70_DYNAMIC_OBJECT_IMAGE_SET_INVALID");
    }
    previousImage = entry.id;
    nonzeroSha(entry.repo_tag_set_sha256, "TASK70_DYNAMIC_OBJECT_IMAGE_SET_INVALID");
    nonzeroSha(entry.repo_digest_set_sha256, "TASK70_DYNAMIC_OBJECT_IMAGE_SET_INVALID");
  });
  if (!Array.isArray(value.volumes)) reject("TASK70_DYNAMIC_OBJECT_VOLUME_SET_INVALID");
  let previousVolume = "";
  value.volumes.forEach((entry) => {
    exactKeys(entry, ["name", "driver", "scope", "created_at", "label_set_sha256"],
      "TASK70_DYNAMIC_OBJECT_VOLUME_FIELDS_INVALID");
    if (typeof entry.name !== "string" || !entry.name || entry.name <= previousVolume
      || typeof entry.driver !== "string" || !entry.driver
      || typeof entry.scope !== "string" || !entry.scope
      || typeof entry.created_at !== "string" || !entry.created_at) {
      reject("TASK70_DYNAMIC_OBJECT_VOLUME_SET_INVALID");
    }
    previousVolume = entry.name;
    nonzeroSha(entry.label_set_sha256, "TASK70_DYNAMIC_OBJECT_VOLUME_SET_INVALID");
  });
  if (!Array.isArray(value.networks)) reject("TASK70_DYNAMIC_OBJECT_NETWORK_SET_INVALID");
  let previousNetwork = "";
  value.networks.forEach((entry) => {
    exactKeys(entry, ["id", "name_sha256", "driver", "scope", "label_set_sha256"],
      "TASK70_DYNAMIC_OBJECT_NETWORK_FIELDS_INVALID");
    if (!CONTAINER_ID.test(entry.id || "") || entry.id <= previousNetwork
      || typeof entry.driver !== "string" || !entry.driver
      || typeof entry.scope !== "string" || !entry.scope) {
      reject("TASK70_DYNAMIC_OBJECT_NETWORK_SET_INVALID");
    }
    previousNetwork = entry.id;
    nonzeroSha(entry.name_sha256, "TASK70_DYNAMIC_OBJECT_NETWORK_SET_INVALID");
    nonzeroSha(entry.label_set_sha256, "TASK70_DYNAMIC_OBJECT_NETWORK_SET_INVALID");
  });
  if (!Array.isArray(value.protected_volumes)
    || value.protected_volumes.length !== PROTECTED_VOLUMES.length
    || !same(value.protected_volumes.map((entry) => entry.name), PROTECTED_VOLUMES)) {
    reject("TASK70_DYNAMIC_PROTECTED_VOLUME_SET_INVALID");
  }
  value.protected_volumes.forEach((entry) => {
    const source = value.volumes.find((candidate) => candidate.name === entry.name);
    if (!source || !same(source, entry)) reject("TASK70_DYNAMIC_PROTECTED_VOLUME_SET_INVALID");
  });
  if (!Array.isArray(value.services) || value.services.length !== SERVICES.length) {
    reject("TASK70_DYNAMIC_OBJECT_SERVICE_SET_INVALID");
  }
  value.services.forEach((entry, index) => validateObjectService(entry, SERVICES[index]));
  if (!same(policy.cleanup_policy.protected_volume_names, PROTECTED_VOLUMES)) {
    reject("TASK70_DYNAMIC_PROTECTED_VOLUME_SET_INVALID");
  }
  return value;
}

function validateCleanup(value, { policy, runId, runtime, before, after }) {
  exactKeys(value, [
    "task_label", "isolation_label", "created_containers", "created_networks",
    "created_volumes", "temp_roots", "removed_container_ids", "remaining_containers",
    "remaining_networks", "remaining_volumes", "remaining_temp_roots",
    "process_group_remaining", "result", "cleanup_receipt_sha256",
  ], "TASK70_DYNAMIC_CLEANUP_FIELDS_INVALID");
  selfDigest(value, "cleanup_receipt_sha256", "TASK70_DYNAMIC_CLEANUP_SHA_INVALID");
  const taskContainer = runtime.container_inspect;
  if (value.task_label !== `${policy.cleanup_policy.task_label}=${runId}`
    || value.isolation_label !== policy.cleanup_policy.isolation_label
    || !Array.isArray(value.created_containers) || value.created_containers.length !== 1
    || !same(value.created_networks, []) || !same(value.created_volumes, [])
    || !Array.isArray(value.temp_roots) || value.temp_roots.length !== 1
    || !same(value.removed_container_ids, [taskContainer.container_id])
    || !same(value.remaining_containers, []) || !same(value.remaining_networks, [])
    || !same(value.remaining_volumes, []) || !same(value.remaining_temp_roots, [])
    || value.process_group_remaining !== 0 || value.result !== "ZERO_TASK_RESIDUE"
    || !same(before, after)) reject("TASK70_DYNAMIC_CLEANUP_FAILED");
  const created = value.created_containers[0];
  exactKeys(created, ["id", "name", "labels", "created_at"],
    "TASK70_DYNAMIC_CLEANUP_CONTAINER_FIELDS_INVALID");
  if (created.id !== taskContainer.container_id || created.name !== taskContainer.name
    || !same(created.labels, taskContainer.labels)
    || created.created_at !== taskContainer.created_at) {
    reject("TASK70_DYNAMIC_CLEANUP_CONTAINER_INVALID");
  }
  const suffix = runId.slice("dv70-".length);
  if (value.temp_roots[0] !== `/tmp/cyd-dv70-pg-switch.${suffix}`) {
    reject("TASK70_DYNAMIC_CLEANUP_TEMP_ROOT_INVALID");
  }
  return value;
}

function validateBaseSpec(value, runtime) {
  exactKeys(value, [
    "schema_version", "contract", "environment", "deployment_id", "promotion_id",
    "promotion_generation", "rollback_operation_id", "runtime_plan_sha256",
    "source_set_sha256", "package_sha256", "postgres", "databases", "snapshot",
    "profile", "security", "authority", "runtime_limits", "base_spec_sha256",
  ], "TASK70_DYNAMIC_BASE_SPEC_FIELDS_INVALID");
  pythonSelfDigest(value, "base_spec_sha256", "TASK70_DYNAMIC_BASE_SPEC_SHA_INVALID");
  if (value.schema_version !== 1
    || value.contract !== "chenyida-erp-uat-rollback-postgresql-base-spec/v1"
    || value.environment !== "UAT" || value.deployment_id !== "chenyida-erp"
    || typeof value.promotion_id !== "string" || !value.promotion_id
    || value.promotion_generation !== 1
    || value.rollback_operation_id !== "rollback-runner-deadbeef") {
    reject("TASK70_DYNAMIC_BASE_SPEC_IDENTITY_INVALID");
  }
  ["runtime_plan_sha256", "source_set_sha256", "package_sha256",
    "base_spec_sha256"].forEach((field) =>
    nonzeroSha(value[field], "TASK70_DYNAMIC_BASE_SPEC_IDENTITY_INVALID"));
  exactKeys(value.postgres, [
    "container_id", "image_reference", "image_digest", "control_os_user",
    "control_database_role", "management_database", "system_identifier",
    "server_version_num", "server_major", "listen_addresses",
  ], "TASK70_DYNAMIC_BASE_SPEC_POSTGRES_FIELDS_INVALID");
  if (value.postgres.container_id !== runtime.container_inspect.container_id
    || value.postgres.image_reference !== IMAGE_REFERENCE
    || value.postgres.image_digest !== runtime.postgres_image_before.id
    || value.postgres.control_os_user !== "999:999"
    || value.postgres.control_database_role !== "postgres"
    || value.postgres.management_database !== "postgres"
    || !SYSTEM_IDENTIFIER.test(value.postgres.system_identifier)
    || value.postgres.server_version_num !== "170010"
    || value.postgres.server_major !== "17" || value.postgres.listen_addresses !== "*") {
    reject("TASK70_DYNAMIC_BASE_SPEC_POSTGRES_INVALID");
  }
  exactKeys(value.databases, [
    "active_name", "candidate_oid", "candidate_marker", "staging_name",
    "staging_marker", "quarantine_name", "quarantine_marker",
  ], "TASK70_DYNAMIC_BASE_SPEC_DATABASE_FIELDS_INVALID");
  if (value.databases.active_name !== "chenyida_erp"
    || value.databases.staging_name !== "chenyida_erp_rb_deadbeefdeadbeef"
    || value.databases.quarantine_name !== "chenyida_erp_candidate_deadbeefdeadbeef"
    || !OID.test(value.databases.candidate_oid)
    || value.databases.candidate_marker
      !== "chenyida-erp-deployment/v2:UAT:chenyida-erp"
    || value.databases.staging_marker
      !== "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING"
    || value.databases.quarantine_marker
      !== "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:CANDIDATE_QUARANTINE") {
    reject("TASK70_DYNAMIC_BASE_SPEC_DATABASE_INVALID");
  }
  exactKeys(value.profile, [
    "encoding", "locale_provider", "collate", "ctype", "collation_version",
    "default_tablespace", "profile_sha256",
  ], "TASK70_DYNAMIC_BASE_SPEC_PROFILE_FIELDS_INVALID");
  pythonSelfDigest(value.profile, "profile_sha256", "TASK70_DYNAMIC_BASE_SPEC_PROFILE_SHA_INVALID");
  if (value.profile.encoding !== "UTF8" || value.profile.locale_provider !== "libc"
    || value.profile.collate !== "C" || value.profile.ctype !== "C"
    || value.profile.collation_version !== null
    || value.profile.default_tablespace !== "pg_default") {
    reject("TASK70_DYNAMIC_BASE_SPEC_PROFILE_INVALID");
  }
  exactKeys(value.snapshot, [
    "dump_sha256", "dump_bytes", "database_bytes", "snapshot_manifest_sha256",
    "source_reconciliation_sha256", "target_database_report_sha256", "migration_head",
    "migration_manifest_sha256",
  ], "TASK70_DYNAMIC_BASE_SPEC_SNAPSHOT_FIELDS_INVALID");
  ["dump_sha256", "snapshot_manifest_sha256", "source_reconciliation_sha256",
    "target_database_report_sha256", "migration_manifest_sha256"].forEach((field) =>
    nonzeroSha(value.snapshot[field], "TASK70_DYNAMIC_BASE_SPEC_SNAPSHOT_INVALID"));
  positiveInteger(value.snapshot.dump_bytes, "TASK70_DYNAMIC_BASE_SPEC_SNAPSHOT_INVALID");
  positiveInteger(value.snapshot.database_bytes, "TASK70_DYNAMIC_BASE_SPEC_SNAPSHOT_INVALID");
  if (value.snapshot.migration_head !== basename(MIGRATION_HEAD_PATH)) {
    reject("TASK70_DYNAMIC_BASE_SPEC_SNAPSHOT_INVALID");
  }
  exactKeys(value.security, [
    "access_file_sha256", "access_sha256", "catalog_file_sha256", "catalog_sha256",
    "catalog_artifact_sha256", "policy_file_sha256", "policy_sha256",
    "operator_file_sha256", "operator_policy_sha256", "runtime_privilege_policy_sha256",
    "database_owner", "schema_name", "schema_owner", "roles_projection_sha256",
    "memberships_projection_sha256", "ownership_projection_sha256", "acl_projection_sha256",
    "default_acl_projection_sha256", "unsupported_projection_sha256",
  ], "TASK70_DYNAMIC_BASE_SPEC_SECURITY_FIELDS_INVALID");
  Object.entries(value.security).forEach(([field, child]) => {
    if (field.endsWith("_sha256")) nonzeroSha(child, "TASK70_DYNAMIC_BASE_SPEC_SECURITY_INVALID");
    else if (typeof child !== "string" || !child) reject("TASK70_DYNAMIC_BASE_SPEC_SECURITY_INVALID");
  });
  exactKeys(value.authority, [
    "authority_id", "authority_sha256", "approved_at", "expires_at", "one_time",
    "mutation_scope_sha256",
  ], "TASK70_DYNAMIC_BASE_SPEC_AUTHORITY_FIELDS_INVALID");
  if (typeof value.authority.authority_id !== "string" || !value.authority.authority_id
    || value.authority.one_time !== true) reject("TASK70_DYNAMIC_BASE_SPEC_AUTHORITY_INVALID");
  nonzeroSha(value.authority.authority_sha256, "TASK70_DYNAMIC_BASE_SPEC_AUTHORITY_INVALID");
  nonzeroSha(value.authority.mutation_scope_sha256, "TASK70_DYNAMIC_BASE_SPEC_AUTHORITY_INVALID");
  strictIso(value.authority.approved_at, "TASK70_DYNAMIC_BASE_SPEC_AUTHORITY_INVALID");
  strictIso(value.authority.expires_at, "TASK70_DYNAMIC_BASE_SPEC_AUTHORITY_INVALID");
  if (!same(value.runtime_limits, {
    preflight_seconds: 120, recheck_seconds: 120, prepare_seconds: 120,
    execute_seconds: 1800, probe_seconds: 300, contain_seconds: 300,
    sql_max_bytes: 1048576, output_max_bytes: 4194304,
  })) reject("TASK70_DYNAMIC_BASE_SPEC_LIMITS_INVALID");
  return value;
}

function pgIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) reject("TASK70_DYNAMIC_SQL_IDENTIFIER_INVALID");
  return `"${value}"`;
}

function pgLiteral(value) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 512
    || /[\0\r\n]/u.test(value)) reject("TASK70_DYNAMIC_SQL_LITERAL_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
}

function renderProductionSql(base, bindings) {
  const names = base.databases;
  const lock = pgLiteral(`chenyida-erp-uat-rollback:${base.runtime_plan_sha256}`);
  return `BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${lock},0));
DO $cyd$
BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> ${pgLiteral(base.postgres.system_identifier)}
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${pgLiteral(names.active_name)} AND d.oid::text=${pgLiteral(names.candidate_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${pgLiteral(names.candidate_marker)}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${pgLiteral(names.staging_name)} AND d.oid::text=${pgLiteral(bindings.staging_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${pgLiteral(names.staging_marker)}
         AND d.datallowconn=true AND d.datconnlimit=0
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s
           WHERE s.setdatabase=d.oid AND s.setrole=0
             AND 'default_transaction_read_only=on'=ANY(s.setconfig)))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=${pgLiteral(names.quarantine_name)})
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                WHERE datname IN (${pgLiteral(names.active_name)},${pgLiteral(names.staging_name)},${pgLiteral(names.quarantine_name)}))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts
                WHERE database IN (${pgLiteral(names.active_name)},${pgLiteral(names.staging_name)},${pgLiteral(names.quarantine_name)}))
  THEN RAISE EXCEPTION 'rollback switch precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE ${pgIdentifier(names.staging_name)} ALLOW_CONNECTIONS false;
ALTER DATABASE ${pgIdentifier(names.active_name)} RENAME TO ${pgIdentifier(names.quarantine_name)};
ALTER DATABASE ${pgIdentifier(names.staging_name)} RENAME TO ${pgIdentifier(names.active_name)};
COMMENT ON DATABASE ${pgIdentifier(names.quarantine_name)} IS ${pgLiteral(names.quarantine_marker)};
COMMENT ON DATABASE ${pgIdentifier(names.active_name)} IS ${pgLiteral(names.candidate_marker)};
COMMIT;
`;
}

function renderObservationSql(base) {
  const names = base.databases;
  return `SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'server_version_num',current_setting('server_version_num'),
  'databases',COALESCE((
    SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
      'name',d.datname,'oid',d.oid::text,
      'marker',pg_catalog.shobj_description(d.oid,'pg_database'),
      'allow_connections',d.datallowconn,'connection_limit',d.datconnlimit,
      'default_transaction_read_only',EXISTS(
        SELECT 1 FROM pg_catalog.pg_db_role_setting s
        WHERE s.setdatabase=d.oid AND s.setrole=0
          AND 'default_transaction_read_only=on'=ANY(s.setconfig)),
      'sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity a WHERE a.datid=d.oid),
      'prepared_xacts',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts x WHERE x.database=d.datname)
    ) ORDER BY d.datname)
    FROM pg_catalog.pg_database d
    WHERE d.datname IN (${pgLiteral(names.active_name)},${pgLiteral(names.staging_name)},${pgLiteral(names.quarantine_name)})
  ),'[]'::json)
)::text;
`;
}

function renderFixtureSetupSql() {
  const active = "chenyida_erp";
  const staging = "chenyida_erp_rb_deadbeefdeadbeef";
  const candidateMarker = TARGET_GUARD.executor_fixture_candidate_marker;
  const stagingMarker =
    "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING";
  return [
    `COMMENT ON DATABASE postgres IS ${pgLiteral(TARGET_GUARD.management_database_comment)};`,
    `CREATE DATABASE ${pgIdentifier(active)} WITH OWNER postgres TEMPLATE template0 `
      + "ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' "
      + "TABLESPACE pg_default CONNECTION LIMIT 0;",
    `ALTER DATABASE ${pgIdentifier(active)} SET default_transaction_read_only TO on;`,
    `ALTER DATABASE ${pgIdentifier(active)} ALLOW_CONNECTIONS false;`,
    `ALTER DATABASE ${pgIdentifier(active)} CONNECTION LIMIT 0;`,
    `COMMENT ON DATABASE ${pgIdentifier(active)} IS ${pgLiteral(candidateMarker)};`,
    `CREATE DATABASE ${pgIdentifier(staging)} WITH OWNER postgres TEMPLATE template0 `
      + "ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' "
      + "TABLESPACE pg_default CONNECTION LIMIT 0;",
    `ALTER DATABASE ${pgIdentifier(staging)} SET default_transaction_read_only TO on;`,
    `ALTER DATABASE ${pgIdentifier(staging)} ALLOW_CONNECTIONS true;`,
    `ALTER DATABASE ${pgIdentifier(staging)} CONNECTION LIMIT 0;`,
    `COMMENT ON DATABASE ${pgIdentifier(staging)} IS ${pgLiteral(stagingMarker)};`,
  ].join("\n") + "\n";
}

function renderFixtureResetSql(base, restoredOid) {
  const names = base.databases;
  return `BEGIN;
DO $cyd$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${pgLiteral(names.active_name)} AND d.oid::text=${pgLiteral(restoredOid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${pgLiteral(names.candidate_marker)}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname=${pgLiteral(names.quarantine_name)} AND d.oid::text=${pgLiteral(names.candidate_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')=${pgLiteral(names.quarantine_marker)}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=${pgLiteral(names.staging_name)})
  THEN RAISE EXCEPTION 'task70 fixture reset precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE ${pgIdentifier(names.active_name)} RENAME TO ${pgIdentifier(names.staging_name)};
ALTER DATABASE ${pgIdentifier(names.quarantine_name)} RENAME TO ${pgIdentifier(names.active_name)};
ALTER DATABASE ${pgIdentifier(names.staging_name)} ALLOW_CONNECTIONS true;
COMMENT ON DATABASE ${pgIdentifier(names.active_name)} IS ${pgLiteral(names.candidate_marker)};
COMMENT ON DATABASE ${pgIdentifier(names.staging_name)} IS ${pgLiteral(names.staging_marker)};
COMMIT;
`;
}

function decodeBase64Utf8(value, code) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    reject(code);
  }
  const raw = Buffer.from(value, "base64");
  if (raw.toString("base64") !== value || raw.length < 2 || raw.length > 1048576
    || raw.includes(0) || raw.includes(13)) reject(code);
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw) || !text.endsWith("\n")) reject(code);
  return { raw, text };
}

function expectedObservationBindings(base, restoredOid) {
  const bindingSha256 = pythonDigest({
    task_id: "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
    case_id: "DV70-PG-SWITCH-01",
    base_spec_sha256: base.base_spec_sha256,
    restored_oid: restoredOid,
  });
  return {
    journal_state_sha256: pythonDigest({
      base_spec_sha256: base.base_spec_sha256,
      purpose: "task70-dynamic-case",
      binding_sha256: bindingSha256,
    }),
    observation_scope_sha256: pythonDigest({
      system_identifier: base.postgres.system_identifier,
      databases: [
        base.databases.active_name,
        base.databases.staging_name,
        base.databases.quarantine_name,
      ].sort(),
    }),
  };
}

function expectedSwitchBindingProjection(base, restoredOid) {
  return {
    privilege_receipt_sha256: pythonDigest({
      task_id: "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
      case_id: "DV70-PG-SWITCH-01",
      scope: "SYNTHETIC_PRIVILEGE_RECEIPT_PLACEHOLDER",
    }),
    staging_oid: restoredOid,
    expected_switched_identity_sha256: pythonDigest({
      active_name: base.databases.active_name,
      active_oid: restoredOid,
      quarantine_name: base.databases.quarantine_name,
      quarantine_oid: base.databases.candidate_oid,
      state: "NEW_SEALED",
    }),
  };
}

function validateOpcodeEvidence(value, { kind, base, restoredOid }) {
  exactKeys(value, ["spec", "sql_utf8_base64"], "TASK70_DYNAMIC_OPCODE_EVIDENCE_FIELDS_INVALID");
  const spec = value.spec;
  exactKeys(spec, [
    "schema_version", "contract", "opcode", "base_spec_sha256", "database", "phase",
    "timeout_seconds", "effectful", "bindings", "sql_sha256", "argv_template_sha256",
    "opcode_spec_sha256",
  ], "TASK70_DYNAMIC_OPCODE_SPEC_FIELDS_INVALID");
  pythonSelfDigest(spec, "opcode_spec_sha256", "TASK70_DYNAMIC_OPCODE_SPEC_SHA_INVALID");
  const production = kind === "production";
  const expectedOpcode = production ? "PG_RB_ATOMIC_SWITCH_V1" : "PG_RB_OBSERVE_STATE_V1";
  const expectedPhase = production ? "switch" : "observe";
  if (spec.schema_version !== 1
    || spec.contract !== "chenyida-erp-uat-rollback-postgresql-opcode-spec/v1"
    || spec.opcode !== expectedOpcode || spec.base_spec_sha256 !== base.base_spec_sha256
    || spec.database !== "postgres" || spec.phase !== expectedPhase
    || spec.timeout_seconds !== 300 || spec.effectful !== production) {
    reject("TASK70_DYNAMIC_OPCODE_SPEC_INVALID");
  }
  if (production) {
    exactKeys(spec.bindings, [
      "privilege_receipt_sha256", "staging_oid", "before_observation_sha256",
      "expected_switched_identity_sha256",
    ], "TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID");
    ["privilege_receipt_sha256", "before_observation_sha256",
      "expected_switched_identity_sha256"].forEach((field) =>
      nonzeroSha(spec.bindings[field], "TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID"));
    const expected = expectedSwitchBindingProjection(base, restoredOid);
    if (!OID.test(spec.bindings.staging_oid)
      || spec.bindings.privilege_receipt_sha256 !== expected.privilege_receipt_sha256
      || spec.bindings.staging_oid !== expected.staging_oid
      || spec.bindings.expected_switched_identity_sha256
        !== expected.expected_switched_identity_sha256) {
      reject("TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID");
    }
  } else {
    exactKeys(spec.bindings, ["journal_state_sha256", "observation_scope_sha256"],
      "TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID");
    Object.values(spec.bindings).forEach((child) =>
      nonzeroSha(child, "TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID"));
    if (!same(spec.bindings, expectedObservationBindings(base, restoredOid))) {
      reject("TASK70_DYNAMIC_OPCODE_BINDINGS_INVALID");
    }
  }
  const decoded = decodeBase64Utf8(value.sql_utf8_base64, "TASK70_DYNAMIC_OPCODE_SQL_ENCODING_INVALID");
  const expectedText = production ? renderProductionSql(base, spec.bindings) : renderObservationSql(base);
  const expectedArgvDigest = pythonDigest([
    "DOCKER_EXEC_POSTGRES_PSQL_V1", base.postgres.container_id, "postgres", expectedPhase,
  ]);
  if (decoded.text !== expectedText
    || spec.sql_sha256 !== task70DynamicSha256(decoded.raw)
    || spec.argv_template_sha256 !== expectedArgvDigest) {
    reject("TASK70_DYNAMIC_OPCODE_SQL_BINDING_INVALID");
  }
  return { spec, raw: decoded.raw, text: decoded.text };
}

function deriveObservationClassification(observation, base, restoredOid) {
  const rows = observation.databases;
  const byName = new Map(rows.map((entry) => [entry.name, entry]));
  const names = base.databases;
  const matches = (name, oid, marker, allow, limit, readonly) => {
    const row = byName.get(name);
    return row && row.oid === oid && row.marker === marker
      && row.allow_connections === allow && row.connection_limit === limit
      && row.default_transaction_read_only === readonly
      && row.sessions === 0 && row.prepared_xacts === 0;
  };
  const old = same([...byName.keys()].sort(), [names.active_name, names.staging_name].sort())
    && matches(names.active_name, names.candidate_oid, names.candidate_marker, false, 0, true)
    && matches(names.staging_name, restoredOid, names.staging_marker, true, 0, true);
  const sealed = same([...byName.keys()].sort(), [names.active_name, names.quarantine_name].sort())
    && matches(names.active_name, restoredOid, names.candidate_marker, false, 0, true)
    && matches(names.quarantine_name, names.candidate_oid, names.quarantine_marker, false, 0, true);
  const released = same([...byName.keys()].sort(), [names.active_name, names.quarantine_name].sort())
    && matches(names.active_name, restoredOid, names.candidate_marker, true, 64, false)
    && matches(names.quarantine_name, names.candidate_oid, names.quarantine_marker, false, 0, true);
  const layout = old ? "OLD" : sealed ? "NEW_SEALED" : released ? "NEW_RELEASED" : "INVALID";
  const topologyRows = Object.fromEntries(rows.map((entry) => [entry.name, entry.oid]));
  const oldTopology = {
    [names.active_name]: names.candidate_oid,
    [names.staging_name]: restoredOid,
  };
  const newTopology = {
    [names.active_name]: restoredOid,
    [names.quarantine_name]: names.candidate_oid,
  };
  const topology = same(topologyRows, oldTopology) ? "OLD_TOPOLOGY"
    : same(topologyRows, newTopology) ? "NEW_TOPOLOGY" : "MIXED_OR_UNKNOWN_TOPOLOGY";
  const classificationBody = {
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-layout-classification/v1",
    runtime_plan_sha256: base.runtime_plan_sha256,
    base_spec_sha256: base.base_spec_sha256,
    observation_sha256: observation.observation_sha256,
    restored_oid: restoredOid,
    layout,
    safe_to_recover_switch_receipt: layout === "NEW_SEALED",
    safe_to_recover_unseal_receipt: layout === "NEW_RELEASED",
  };
  return {
    layout,
    topology,
    state_projection_sha256: task70DynamicSha256(canonicalTask70DynamicJson({
      system_identifier: observation.system_identifier,
      server_version_num: observation.server_version_num,
      databases: observation.databases,
    })),
    classification_sha256: pythonDigest(classificationBody),
  };
}

function validateObservation(value, base, restoredOid) {
  exactKeys(value, [
    "schema_version", "contract", "runtime_plan_sha256", "base_spec_sha256",
    "system_identifier", "server_version_num", "databases", "observed_at",
    "observation_sha256",
  ], "TASK70_DYNAMIC_OBSERVATION_FIELDS_INVALID");
  pythonSelfDigest(value, "observation_sha256", "TASK70_DYNAMIC_OBSERVATION_SHA_INVALID");
  if (value.schema_version !== 1
    || value.contract !== "chenyida-erp-uat-rollback-postgresql-state-observation/v1"
    || value.runtime_plan_sha256 !== base.runtime_plan_sha256
    || value.base_spec_sha256 !== base.base_spec_sha256
    || value.system_identifier !== base.postgres.system_identifier
    || value.server_version_num !== "170010" || !Array.isArray(value.databases)
    || value.databases.length > 3) reject("TASK70_DYNAMIC_OBSERVATION_INVALID");
  strictIso(value.observed_at, "TASK70_DYNAMIC_OBSERVATION_INVALID");
  const allowed = new Set([
    base.databases.active_name, base.databases.staging_name, base.databases.quarantine_name,
  ]);
  let previous = "";
  value.databases.forEach((entry) => {
    exactKeys(entry, [
      "name", "oid", "marker", "allow_connections", "connection_limit",
      "default_transaction_read_only", "sessions", "prepared_xacts",
    ], "TASK70_DYNAMIC_OBSERVATION_ROW_FIELDS_INVALID");
    if (!allowed.has(entry.name) || entry.name <= previous || !OID.test(entry.oid)
      || typeof entry.marker !== "string" || !entry.marker
      || typeof entry.allow_connections !== "boolean"
      || !Number.isSafeInteger(entry.connection_limit) || entry.connection_limit < -1
      || entry.connection_limit > 1000000
      || typeof entry.default_transaction_read_only !== "boolean"
      || entry.sessions !== 0 || entry.prepared_xacts !== 0) {
      reject("TASK70_DYNAMIC_OBSERVATION_ROW_INVALID");
    }
    previous = entry.name;
  });
  return deriveObservationClassification(value, base, restoredOid);
}

function validateClaimedClassification(value, expected, code) {
  exactKeys(value, [
    "layout", "topology", "state_projection_sha256", "classification_sha256",
  ], code);
  if (!same(value, expected)) reject(code);
  return value;
}

function decodeCommandOutput(value, code) {
  if (typeof value !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    reject(code);
  }
  const raw = Buffer.from(value, "base64");
  if (raw.toString("base64") !== value || raw.length > 64 * 1024
    || raw.includes(0) || raw.includes(13)) reject(code);
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) reject(code);
  return { raw, text };
}

function validateCommand(value, expected) {
  exactKeys(value, [
    "command_class", "opcode", "stdin_sha256", "exit_code", "stdout_sha256",
    "stderr_sha256", "stdout_base64", "stderr_base64", "failure_code",
    "response_delivered", "caller_boundary", "command_receipt_sha256",
  ], "TASK70_DYNAMIC_COMMAND_RECEIPT_FIELDS_INVALID");
  selfDigest(value, "command_receipt_sha256", "TASK70_DYNAMIC_COMMAND_RECEIPT_SHA_INVALID");
  ["stdin_sha256", "stdout_sha256", "stderr_sha256"].forEach((field) => {
    if (!SHA256.test(value[field] || "")) reject("TASK70_DYNAMIC_COMMAND_RECEIPT_INVALID");
  });
  const stdout = decodeCommandOutput(
    value.stdout_base64, "TASK70_DYNAMIC_COMMAND_RECEIPT_OUTPUT_INVALID",
  );
  const stderr = decodeCommandOutput(
    value.stderr_base64, "TASK70_DYNAMIC_COMMAND_RECEIPT_OUTPUT_INVALID",
  );
  if (task70DynamicSha256(stdout.raw) !== value.stdout_sha256
    || task70DynamicSha256(stderr.raw) !== value.stderr_sha256) {
    reject("TASK70_DYNAMIC_COMMAND_RECEIPT_OUTPUT_INVALID");
  }
  for (const [field, child] of Object.entries(expected)) {
    if (!same(value[field], child)) reject("TASK70_DYNAMIC_COMMAND_RECEIPT_INVALID");
  }
  return { value, stdout, stderr };
}

function validateMutationCommandOutput(command) {
  if (command.stderr.raw.length !== 0
    || [...command.stdout.text].some((character) => !" \t\r\nt".includes(character))) {
    reject("TASK70_DYNAMIC_MUTATION_COMMAND_OUTPUT_INVALID");
  }
}

function validatePreconditionCommandOutput(command) {
  const expected = new Set([
    "ERROR:  rollback switch precondition mismatch\n",
    "ERROR: rollback switch precondition mismatch\n",
  ]);
  if (command.stdout.raw.length !== 0 || !expected.has(command.stderr.text)) {
    reject("TASK70_DYNAMIC_PRECONDITION_COMMAND_OUTPUT_INVALID");
  }
}

function validateMutationAck(value, command) {
  exactKeys(value, [
    "schema_version", "contract", "opcode", "stdout_bytes", "stdout_sha256", "ack_sha256",
  ], "TASK70_DYNAMIC_MUTATION_ACK_FIELDS_INVALID");
  pythonSelfDigest(value, "ack_sha256", "TASK70_DYNAMIC_MUTATION_ACK_SHA_INVALID");
  if (value.schema_version !== 1
    || value.contract !== "chenyida-erp-uat-rollback-postgresql-mutation-ack/v1"
    || value.opcode !== "PG_RB_ATOMIC_SWITCH_V1"
    || !Number.isSafeInteger(value.stdout_bytes) || value.stdout_bytes < 0
    || value.stdout_sha256 !== command.stdout_sha256) reject("TASK70_DYNAMIC_MUTATION_ACK_INVALID");
  return value;
}

function validateFixtureReceipt(value, expectedPhase, expectedSqlSha256 = null) {
  exactKeys(value, [
    "phase", "sql_sha256", "exit_code", "stdout_sha256", "stderr_sha256",
    "fixture_receipt_sha256",
  ], "TASK70_DYNAMIC_FIXTURE_RECEIPT_FIELDS_INVALID");
  selfDigest(value, "fixture_receipt_sha256", "TASK70_DYNAMIC_FIXTURE_RECEIPT_SHA_INVALID");
  if (value.phase !== expectedPhase || value.exit_code !== 0
    || value.stderr_sha256 !== EMPTY_SHA256
    || (expectedSqlSha256 !== null && value.sql_sha256 !== expectedSqlSha256)) {
    reject("TASK70_DYNAMIC_FIXTURE_RECEIPT_INVALID");
  }
  ["sql_sha256", "stdout_sha256"].forEach((field) =>
    nonzeroSha(value[field], "TASK70_DYNAMIC_FIXTURE_RECEIPT_INVALID"));
  return value;
}

function validateGuardReceipt(value, base) {
  exactKeys(value, [
    "system_identifier", "server_version_num", "listen_addresses", "management_database",
    "management_comment", "guard_matches", "guard_receipt_sha256",
  ], "TASK70_DYNAMIC_GUARD_RECEIPT_FIELDS_INVALID");
  selfDigest(value, "guard_receipt_sha256", "TASK70_DYNAMIC_GUARD_RECEIPT_SHA_INVALID");
  if (value.system_identifier !== base.postgres.system_identifier
    || value.server_version_num !== "170010" || value.listen_addresses !== "*"
    || value.management_database !== "postgres"
    || value.management_comment !== TARGET_GUARD.management_database_comment
    || value.guard_matches !== true) reject("TASK70_DYNAMIC_GUARD_RECEIPT_INVALID");
  return value;
}

function validateFixture(value, runtime) {
  exactKeys(value, [
    "fixture_source_path", "base_spec", "restored_oid", "management_identity",
    "setup_receipt", "reset_receipts", "guard_receipts",
  ], "TASK70_DYNAMIC_FIXTURE_FIELDS_INVALID");
  if (value.fixture_source_path
    !== "chenyida_erp_site/tests/test_uat_promotion_rollback_fixed_executor.py") {
    reject("TASK70_DYNAMIC_FIXTURE_SOURCE_INVALID");
  }
  const base = validateBaseSpec(value.base_spec, runtime);
  if (!OID.test(value.restored_oid) || value.restored_oid === base.databases.candidate_oid) {
    reject("TASK70_DYNAMIC_FIXTURE_RESTORED_OID_INVALID");
  }
  exactKeys(value.management_identity, [
    "system_identifier", "server_version_num", "listen_addresses", "encoding", "collate",
    "ctype", "locale_provider", "collation_version", "active_oid", "staging_oid",
  ], "TASK70_DYNAMIC_FIXTURE_IDENTITY_FIELDS_INVALID");
  const identity = value.management_identity;
  if (identity.system_identifier !== base.postgres.system_identifier
    || identity.server_version_num !== "170010" || identity.listen_addresses !== "*"
    || identity.encoding !== "UTF8" || identity.collate !== "C" || identity.ctype !== "C"
    || identity.locale_provider !== "libc" || identity.collation_version !== null
    || identity.active_oid !== base.databases.candidate_oid
    || identity.staging_oid !== value.restored_oid) {
    reject("TASK70_DYNAMIC_FIXTURE_IDENTITY_INVALID");
  }
  validateFixtureReceipt(
    value.setup_receipt, "fixture_setup", task70DynamicSha256(renderFixtureSetupSql()),
  );
  if (!Array.isArray(value.reset_receipts) || value.reset_receipts.length !== 1) {
    reject("TASK70_DYNAMIC_FIXTURE_RESET_SET_INVALID");
  }
  validateFixtureReceipt(
    value.reset_receipts[0], "fixture_reset",
    task70DynamicSha256(renderFixtureResetSql(base, value.restored_oid)),
  );
  if (!Array.isArray(value.guard_receipts) || value.guard_receipts.length !== 7) {
    reject("TASK70_DYNAMIC_GUARD_RECEIPT_SET_INVALID");
  }
  value.guard_receipts.forEach((receipt) => validateGuardReceipt(receipt, base));
  return { base, restoredOid: value.restored_oid };
}

function validateObservationPair(observation, claimed, base, restoredOid, code) {
  const derived = validateObservation(observation, base, restoredOid);
  validateClaimedClassification(claimed, derived, code);
  return derived;
}

function scenarioSelf(value) {
  selfDigest(value, "scenario_sha256", "TASK70_DYNAMIC_SCENARIO_SHA_INVALID");
  return value;
}

function validateSuccessScenario(value, context) {
  exactKeys(value, [
    "scenario_id", "before", "before_classification", "command", "mutation_ack",
    "after", "after_classification", "scenario_sha256",
  ], "TASK70_DYNAMIC_SUCCESS_FIELDS_INVALID");
  scenarioSelf(value);
  if (value.scenario_id !== "EXACT_SUCCESS") reject("TASK70_DYNAMIC_SUCCESS_INVALID");
  const before = validateObservationPair(
    value.before, value.before_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_SUCCESS_BEFORE_INVALID",
  );
  const after = validateObservationPair(
    value.after, value.after_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_SUCCESS_AFTER_INVALID",
  );
  const command = validateCommand(value.command, {
    command_class: "PRODUCTION", opcode: "PG_RB_ATOMIC_SWITCH_V1",
    stdin_sha256: context.production.spec.sql_sha256, exit_code: 0,
    stderr_sha256: EMPTY_SHA256, failure_code: null, response_delivered: true,
    caller_boundary: "CALLER_RECEIVED_PROCESS_RESULT",
  });
  validateMutationCommandOutput(command);
  validateMutationAck(value.mutation_ack, value.command);
  if (before.layout !== "OLD" || before.topology !== "OLD_TOPOLOGY"
    || after.layout !== "NEW_SEALED" || after.topology !== "NEW_TOPOLOGY"
    || context.production.spec.bindings.before_observation_sha256
      !== value.before.observation_sha256) reject("TASK70_DYNAMIC_SUCCESS_INVALID");
  return value;
}

function validateRepeatScenario(value, context) {
  exactKeys(value, [
    "scenario_id", "before", "before_classification", "command", "after",
    "after_classification", "scenario_sha256",
  ], "TASK70_DYNAMIC_REPEAT_FIELDS_INVALID");
  scenarioSelf(value);
  if (value.scenario_id !== "REPEAT_FAIL_CLOSED") reject("TASK70_DYNAMIC_REPEAT_INVALID");
  const before = validateObservationPair(
    value.before, value.before_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_REPEAT_BEFORE_INVALID",
  );
  const after = validateObservationPair(
    value.after, value.after_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_REPEAT_AFTER_INVALID",
  );
  const command = validateCommand(value.command, {
    command_class: "PRODUCTION", opcode: "PG_RB_ATOMIC_SWITCH_V1",
    stdin_sha256: context.production.spec.sql_sha256, exit_code: 3,
    failure_code: "ROLLBACK_SWITCH_PRECONDITION_MISMATCH", response_delivered: true,
    caller_boundary: "CALLER_RECEIVED_PROCESS_RESULT",
  });
  validatePreconditionCommandOutput(command);
  if (before.layout !== "NEW_SEALED" || after.layout !== "NEW_SEALED"
    || before.topology !== "NEW_TOPOLOGY" || after.topology !== "NEW_TOPOLOGY"
    || before.state_projection_sha256 !== after.state_projection_sha256) {
    reject("TASK70_DYNAMIC_REPEAT_INVALID");
  }
  return value;
}

function expectedMarkerSql(base, marker) {
  return `COMMENT ON DATABASE ${pgIdentifier(base.databases.active_name)} IS ${pgLiteral(marker)};\n`;
}

function validateDriftScenario(value, context) {
  exactKeys(value, [
    "scenario_id", "before", "before_classification", "drift_marker", "drift_apply",
    "drifted_before", "drifted_before_classification", "command", "drifted_after",
    "drifted_after_classification", "drift_restore", "restored",
    "restored_classification", "scenario_sha256",
  ], "TASK70_DYNAMIC_DRIFT_FIELDS_INVALID");
  scenarioSelf(value);
  if (value.scenario_id !== "PRECONDITION_DRIFT_REJECTED"
    || value.drift_marker !== DRIFT_MARKER) reject("TASK70_DYNAMIC_DRIFT_INVALID");
  const before = validateObservationPair(
    value.before, value.before_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_DRIFT_BEFORE_INVALID",
  );
  const driftedBefore = validateObservationPair(
    value.drifted_before, value.drifted_before_classification,
    context.base, context.restoredOid, "TASK70_DYNAMIC_DRIFTED_BEFORE_INVALID",
  );
  const driftedAfter = validateObservationPair(
    value.drifted_after, value.drifted_after_classification,
    context.base, context.restoredOid, "TASK70_DYNAMIC_DRIFTED_AFTER_INVALID",
  );
  const restored = validateObservationPair(
    value.restored, value.restored_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_DRIFT_RESTORED_INVALID",
  );
  validateFixtureReceipt(value.drift_apply, "fixture_drift_apply");
  validateFixtureReceipt(value.drift_restore, "fixture_drift_restore");
  if (value.drift_apply.sql_sha256
      !== task70DynamicSha256(expectedMarkerSql(context.base, DRIFT_MARKER))
    || value.drift_restore.sql_sha256
      !== task70DynamicSha256(expectedMarkerSql(
        context.base, context.base.databases.candidate_marker,
      ))) reject("TASK70_DYNAMIC_DRIFT_RECEIPT_INVALID");
  const command = validateCommand(value.command, {
    command_class: "PRODUCTION", opcode: "PG_RB_ATOMIC_SWITCH_V1",
    stdin_sha256: context.production.spec.sql_sha256, exit_code: 3,
    failure_code: "ROLLBACK_SWITCH_PRECONDITION_MISMATCH", response_delivered: true,
    caller_boundary: "CALLER_RECEIVED_PROCESS_RESULT",
  });
  validatePreconditionCommandOutput(command);
  const activeDrifted = value.drifted_before.databases.find((entry) =>
    entry.name === context.base.databases.active_name);
  if (before.layout !== "OLD" || before.topology !== "OLD_TOPOLOGY"
    || driftedBefore.layout !== "INVALID" || driftedBefore.topology !== "OLD_TOPOLOGY"
    || driftedAfter.layout !== "INVALID" || driftedAfter.topology !== "OLD_TOPOLOGY"
    || driftedBefore.state_projection_sha256 !== driftedAfter.state_projection_sha256
    || activeDrifted?.marker !== DRIFT_MARKER
    || restored.layout !== "OLD" || restored.topology !== "OLD_TOPOLOGY") {
    reject("TASK70_DYNAMIC_DRIFT_INVALID");
  }
  return value;
}

function deriveFaultStream(productionRaw, base) {
  const first = Buffer.from(
    `ALTER DATABASE ${pgIdentifier(base.databases.active_name)} RENAME TO `
      + `${pgIdentifier(base.databases.quarantine_name)};\n`,
  );
  const second = Buffer.from(
    `ALTER DATABASE ${pgIdentifier(base.databases.staging_name)} RENAME TO `
      + `${pgIdentifier(base.databases.active_name)};\n`,
  );
  const firstIndex = productionRaw.indexOf(first);
  if (firstIndex < 0 || productionRaw.indexOf(first, firstIndex + 1) >= 0) {
    reject("TASK70_DYNAMIC_FAULT_DERIVATION_INVALID");
  }
  const boundary = firstIndex + first.length;
  const secondIndex = productionRaw.indexOf(second);
  if (secondIndex < boundary || productionRaw.indexOf(second, secondIndex + 1) >= 0) {
    reject("TASK70_DYNAMIC_FAULT_DERIVATION_INVALID");
  }
  return {
    boundary,
    raw: Buffer.concat([
      productionRaw.subarray(0, boundary),
      Buffer.from(`SELECT ${pgLiteral(FAULT_BARRIER)}::text;\n`),
    ]),
  };
}

function validateFaultScenario(value, context) {
  exactKeys(value, [
    "scenario_id", "before", "before_classification", "production_sql_sha256",
    "fault_sql_sha256", "fault_boundary_offset_bytes", "fault_derivation", "barrier",
    "barrier_observed", "command", "witness", "witness_classification", "after",
    "after_classification", "scenario_sha256",
  ], "TASK70_DYNAMIC_FAULT_FIELDS_INVALID");
  scenarioSelf(value);
  if (value.scenario_id !== "FIRST_RENAME_FAULT_ROLLBACK"
    || value.production_sql_sha256 !== context.production.spec.sql_sha256
    || value.fault_derivation
      !== "PRODUCTION_SQL_PREFIX_AFTER_FIRST_RENAME_PLUS_FIXED_BARRIER_THEN_EOF_V1"
    || value.barrier !== FAULT_BARRIER || value.barrier_observed !== true) {
    reject("TASK70_DYNAMIC_FAULT_INVALID");
  }
  const before = validateObservationPair(
    value.before, value.before_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_FAULT_BEFORE_INVALID",
  );
  const witness = validateObservationPair(
    value.witness, value.witness_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_FAULT_WITNESS_INVALID",
  );
  const after = validateObservationPair(
    value.after, value.after_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_FAULT_AFTER_INVALID",
  );
  const expected = deriveFaultStream(context.production.raw, context.base);
  if (value.fault_boundary_offset_bytes !== expected.boundary
    || value.fault_sql_sha256 !== task70DynamicSha256(expected.raw)) {
    reject("TASK70_DYNAMIC_FAULT_DERIVATION_INVALID");
  }
  const command = validateCommand(value.command, {
    command_class: "DERIVED_FAULT_STREAM",
    opcode: "DERIVED_FIRST_RENAME_BARRIER_EOF_V1",
    stdin_sha256: value.fault_sql_sha256, exit_code: 0,
    stderr_sha256: EMPTY_SHA256, failure_code: null, response_delivered: true,
    caller_boundary: "EOF_AFTER_FIRST_RENAME_BARRIER",
  });
  if (command.stderr.raw.length !== 0
    || command.stdout.text.split(FAULT_BARRIER).length - 1 !== 1
    || command.stdout.text.trim() !== FAULT_BARRIER) {
    reject("TASK70_DYNAMIC_FAULT_OUTPUT_INVALID");
  }
  if (before.layout !== "OLD" || witness.layout !== "OLD" || after.layout !== "OLD"
    || before.topology !== "OLD_TOPOLOGY" || witness.topology !== "OLD_TOPOLOGY"
    || after.topology !== "OLD_TOPOLOGY"
    || before.state_projection_sha256 !== after.state_projection_sha256) {
    reject("TASK70_DYNAMIC_FAULT_INVALID");
  }
  return value;
}

function validateCallerResultDiscardScenario(value, context) {
  exactKeys(value, [
    "scenario_id", "simulation_class", "before", "before_classification", "command",
    "caller_result_discarded", "mutation_ack_parsed", "after",
    "after_classification", "scenario_sha256",
  ], "TASK70_DYNAMIC_CALLER_RESULT_DISCARD_FIELDS_INVALID");
  scenarioSelf(value);
  if (value.scenario_id
      !== "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION_READ_ONLY_OBSERVATION"
    || value.simulation_class !== "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION"
    || value.caller_result_discarded !== true || value.mutation_ack_parsed !== false) {
    reject("TASK70_DYNAMIC_CALLER_RESULT_DISCARD_INVALID");
  }
  const before = validateObservationPair(
    value.before, value.before_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_CALLER_RESULT_DISCARD_BEFORE_INVALID",
  );
  const after = validateObservationPair(
    value.after, value.after_classification, context.base, context.restoredOid,
    "TASK70_DYNAMIC_CALLER_RESULT_DISCARD_AFTER_INVALID",
  );
  const command = validateCommand(value.command, {
    command_class: "PRODUCTION", opcode: "PG_RB_ATOMIC_SWITCH_V1",
    stdin_sha256: context.production.spec.sql_sha256, exit_code: 0,
    stderr_sha256: EMPTY_SHA256, failure_code: null, response_delivered: false,
    caller_boundary: "AFTER_PSQL_COMPLETION_BEFORE_ACK_PARSE_RESULT_DISCARDED",
  });
  validateMutationCommandOutput(command);
  if (before.layout !== "OLD" || before.topology !== "OLD_TOPOLOGY"
    || after.layout !== "NEW_SEALED" || after.topology !== "NEW_TOPOLOGY") {
    reject("TASK70_DYNAMIC_CALLER_RESULT_DISCARD_INVALID");
  }
  return value;
}

function validateScenarios(values, context) {
  if (!Array.isArray(values) || values.length !== SCENARIOS.length
    || !same(values.map((entry) => entry.scenario_id), SCENARIOS)) {
    reject("TASK70_DYNAMIC_SCENARIO_SET_INVALID");
  }
  validateSuccessScenario(values[0], context);
  validateRepeatScenario(values[1], context);
  validateDriftScenario(values[2], context);
  validateFaultScenario(values[3], context);
  validateCallerResultDiscardScenario(values[4], context);
  return values;
}

function expectedAssertions(scenarios, context) {
  const [success, repeat, drift, fault, response] = scenarios;
  const scenarioHashes = scenarios.map((entry) => entry.scenario_sha256);
  const productionRefs = [success, repeat, drift, response].map((entry) => entry.scenario_sha256);
  const make = (id, evidence) => ({
    id, result: "PASS", evidence,
    evidence_sha256: task70DynamicSha256(canonicalTask70DynamicJson(evidence)),
  });
  return [
    make("PRODUCTION_SQL_SHA_BOUND", {
      scenario_refs: productionRefs,
      production_sql_sha256: context.production.spec.sql_sha256,
      opcode_spec_sha256: context.production.spec.opcode_spec_sha256,
      production_dispatch_count: 4,
    }),
    make("EXACT_SWITCH_NEW_SEALED", {
      scenario_refs: [success.scenario_sha256],
      before_layout: success.before_classification.layout,
      after_layout: success.after_classification.layout,
      mutation_ack_sha256: success.mutation_ack.ack_sha256,
    }),
    make("DATABASE_OIDS_PRESERVED", {
      scenario_refs: [success.scenario_sha256],
      candidate_oid: context.base.databases.candidate_oid,
      restored_oid: context.restoredOid,
      candidate_before_name: context.base.databases.active_name,
      candidate_after_name: context.base.databases.quarantine_name,
      restored_before_name: context.base.databases.staging_name,
      restored_after_name: context.base.databases.active_name,
    }),
    make("REPEAT_EXECUTION_FAILS_CLOSED", {
      scenario_refs: [repeat.scenario_sha256],
      failure_code: repeat.command.failure_code,
      state_unchanged: repeat.before_classification.state_projection_sha256
        === repeat.after_classification.state_projection_sha256,
      after_layout: repeat.after_classification.layout,
    }),
    make("PRECONDITION_DRIFT_REJECTED", {
      scenario_refs: [drift.scenario_sha256],
      drift_marker: DRIFT_MARKER,
      failure_code: drift.command.failure_code,
      drifted_state_unchanged:
        drift.drifted_before_classification.state_projection_sha256
          === drift.drifted_after_classification.state_projection_sha256,
      restored_layout: drift.restored_classification.layout,
    }),
    make("FIRST_RENAME_FAULT_ROLLS_BACK", {
      scenario_refs: [fault.scenario_sha256],
      fault_derivation: fault.fault_derivation,
      barrier_observed: fault.barrier_observed,
      witness_topology: fault.witness_classification.topology,
      after_layout: fault.after_classification.layout,
      state_rolled_back: fault.before_classification.state_projection_sha256
        === fault.after_classification.state_projection_sha256,
    }),
    make("CALLER_RESULT_DISCARD_PROBED_READ_ONLY", {
      scenario_refs: [response.scenario_sha256],
      simulation_class: response.simulation_class,
      caller_result_discarded: response.caller_result_discarded,
      mutation_ack_parsed: response.mutation_ack_parsed,
      production_command_receipt_count: 1,
      read_only_observation_count: 1,
      after_layout: response.after_classification.layout,
    }),
    make("NO_PERSISTENT_MIXED_LAYOUT", {
      scenario_refs: scenarioHashes,
      stable_topologies: [
        success.before_classification.topology,
        success.after_classification.topology,
        repeat.after_classification.topology,
        drift.restored_classification.topology,
        fault.after_classification.topology,
        response.after_classification.topology,
      ],
      mixed_stable_layout_count: 0,
    }),
    make("EXISTING_RUNTIME_AND_PROTECTED_VOLUMES_UNCHANGED", {
      scenario_refs: scenarioHashes,
      before_fingerprint_sha256: context.objectBefore.fingerprint_sha256,
      after_fingerprint_sha256: context.objectAfter.fingerprint_sha256,
      cleanup_receipt_sha256: context.cleanup.cleanup_receipt_sha256,
      remaining_task_container_count: 0,
      remaining_task_network_count: 0,
      remaining_task_volume_count: 0,
    }),
  ];
}

function validateAssertions(value, scenarios, context) {
  if (!Array.isArray(value) || value.length !== ASSERTIONS.length) {
    reject("TASK70_DYNAMIC_ASSERTION_SET_INVALID");
  }
  value.forEach((entry, index) => {
    exactKeys(entry, ["id", "result", "evidence", "evidence_sha256"],
      "TASK70_DYNAMIC_ASSERTION_FIELDS_INVALID");
    if (entry.id !== ASSERTIONS[index] || entry.result !== "PASS"
      || entry.evidence_sha256
        !== task70DynamicSha256(canonicalTask70DynamicJson(entry.evidence))) {
      reject("TASK70_DYNAMIC_ASSERTION_SHA_INVALID");
    }
  });
  const expected = expectedAssertions(scenarios, context);
  if (!same(value, expected)) reject("TASK70_DYNAMIC_ASSERTION_SEMANTICS_INVALID");
  return value;
}

function validateCase(value, context, policyCase) {
  exactKeys(value, [
    "case_id", "evidence_class", "stage_id", "stage_coverage", "result", "fixture",
    "opcodes", "scenarios", "assertions", "case_evidence_sha256",
  ], "TASK70_DYNAMIC_CASE_FIELDS_INVALID");
  selfDigest(value, "case_evidence_sha256", "TASK70_DYNAMIC_CASE_SHA_INVALID");
  if (value.case_id !== policyCase.case_id || value.evidence_class !== policyCase.evidence_class
    || value.stage_id !== policyCase.stage_id || value.stage_coverage !== policyCase.stage_coverage
    || value.result !== "PASS") reject("TASK70_DYNAMIC_CASE_INVALID");
  const fixture = validateFixture(value.fixture, context.runtime);
  exactKeys(value.opcodes, ["production", "observation"],
    "TASK70_DYNAMIC_OPCODE_SET_FIELDS_INVALID");
  const production = validateOpcodeEvidence(value.opcodes.production, {
    kind: "production", base: fixture.base, restoredOid: fixture.restoredOid,
  });
  const observation = validateOpcodeEvidence(value.opcodes.observation, {
    kind: "observation", base: fixture.base, restoredOid: fixture.restoredOid,
  });
  const scenarioContext = {
    ...context, ...fixture, production, observation,
  };
  validateScenarios(value.scenarios, scenarioContext);
  validateAssertions(value.assertions, value.scenarios, scenarioContext);
  return value;
}

function expectedCoverage(policy, cases) {
  const passed = new Map(cases.map((entry) => [entry.case_id, entry]));
  return {
    stages: policy.required_stage_order.map((id) => ({
      id,
      status: passed.has(policy.case_catalog[0].case_id)
        && id === policy.case_catalog[0].stage_id ? "PARTIAL" : "MISSING",
    })),
    checks: policy.required_check_order.map((id) => ({ id, status: "MISSING" })),
    status: cases.length ? "PARTIAL" : "NOT_EXECUTED",
  };
}

function validateCoverage(value, policy, cases) {
  exactKeys(value, ["stages", "checks", "status"], "TASK70_DYNAMIC_COVERAGE_FIELDS_INVALID");
  for (const [entries, expectedIds] of [
    [value.stages, policy.required_stage_order], [value.checks, policy.required_check_order],
  ]) {
    if (!Array.isArray(entries) || entries.length !== expectedIds.length) {
      reject("TASK70_DYNAMIC_COVERAGE_INVALID");
    }
    entries.forEach((entry, index) => {
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

function validateRepositoryGitProjection(value, artifact) {
  exactKeys(value, [
    "commit", "tree", "head_commit", "commit_is_ancestor_of_head", "source_blobs",
  ], "TASK70_DYNAMIC_GIT_PROJECTION_FIELDS_INVALID");
  if (value.commit !== artifact.source.git_commit || value.tree !== artifact.source.git_tree
    || !COMMIT.test(value.head_commit) || value.commit_is_ancestor_of_head !== true
    || !Array.isArray(value.source_blobs)
    || value.source_blobs.length !== artifact.source_bindings.length) {
    reject("TASK70_DYNAMIC_GIT_PROJECTION_MISMATCH");
  }
  value.source_blobs.forEach((entry, index) => {
    exactKeys(entry, ["path", "git_blob"], "TASK70_DYNAMIC_GIT_SOURCE_BLOB_FIELDS_INVALID");
    const binding = artifact.source_bindings[index];
    if (entry.path !== binding.path || entry.git_blob !== binding.git_blob
      || !COMMIT.test(entry.git_blob)) reject("TASK70_DYNAMIC_GIT_PROJECTION_MISMATCH");
  });
  return value;
}

export function validateTask70DynamicArtifact(
  artifact, { policy, sourceBodies, repositoryGit },
) {
  policy = validateTask70DynamicPolicy(policy);
  exactKeys(artifact, [
    "schema_version", "contract", "task_id", "run_id", "evidence_scope",
    "deployment_class", "audit_clearance", "started_at", "completed_at", "source",
    "source_bindings", "target_guard", "runtime", "resource_gate", "object_protection",
    "cases", "coverage", "cleanup", "non_claims", "result", "artifact_sha256",
  ], "TASK70_DYNAMIC_ARTIFACT_FIELDS_INVALID");
  selfDigest(artifact, "artifact_sha256", "TASK70_DYNAMIC_ARTIFACT_SHA256_MISMATCH");
  const started = Date.parse(artifact.started_at);
  const completed = Date.parse(artifact.completed_at);
  if (artifact.schema_version !== 2 || artifact.contract !== policy.artifact_contract
    || artifact.task_id !== policy.task_id || !RUN_ID.test(artifact.run_id)
    || artifact.evidence_scope !== policy.evidence_scope
    || artifact.deployment_class !== policy.deployment_class
    || artifact.audit_clearance !== policy.audit_clearance
    || artifact.result !== "PASS_PARTIAL") reject("TASK70_DYNAMIC_ARTIFACT_IDENTITY_INVALID");
  strictIso(artifact.started_at, "TASK70_DYNAMIC_ARTIFACT_IDENTITY_INVALID");
  strictIso(artifact.completed_at, "TASK70_DYNAMIC_ARTIFACT_IDENTITY_INVALID");
  if (completed < started) reject("TASK70_DYNAMIC_ARTIFACT_IDENTITY_INVALID");
  exactKeys(artifact.source, [
    "git_commit", "git_tree", "application_version", "migration_head",
  ], "TASK70_DYNAMIC_SOURCE_FIELDS_INVALID");
  if (!COMMIT.test(artifact.source.git_commit) || !COMMIT.test(artifact.source.git_tree)
    || !VERSION.test(artifact.source.application_version)
    || !MIGRATION.test(artifact.source.migration_head)) reject("TASK70_DYNAMIC_SOURCE_INVALID");
  if (!(sourceBodies instanceof Map) || !Array.isArray(artifact.source_bindings)
    || artifact.source_bindings.length !== SOURCE_PATHS.length) {
    reject("TASK70_DYNAMIC_SOURCE_BINDINGS_INVALID");
  }
  artifact.source_bindings.forEach((binding, index) => {
    exactKeys(binding, ["path", "sha256", "git_blob"],
      "TASK70_DYNAMIC_SOURCE_BINDING_FIELDS_INVALID");
    const expectedPath = SOURCE_PATHS[index];
    const body = sourceBodies.get(expectedPath);
    if (binding.path !== expectedPath || typeof body !== "string"
      || binding.sha256 !== task70DynamicSha256(body)
      || binding.git_blob !== gitBlobSha1(body)) {
      reject("TASK70_DYNAMIC_SOURCE_BINDING_MISMATCH");
    }
  });
  validateRepositoryGitProjection(repositoryGit, artifact);
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
  if (!same(artifact.target_guard, TARGET_GUARD)) reject("TASK70_DYNAMIC_TARGET_GUARD_INVALID");
  const runtime = validateRuntime(artifact.runtime, { policy, runId: artifact.run_id });
  validateResourceGate(artifact.resource_gate, policy.resource_policy, policy.case_catalog[0]);
  exactKeys(artifact.object_protection, ["before", "after", "result"],
    "TASK70_DYNAMIC_OBJECT_PROTECTION_FIELDS_INVALID");
  const before = validateObjectSnapshot(artifact.object_protection.before, policy);
  const after = validateObjectSnapshot(artifact.object_protection.after, policy);
  if (artifact.object_protection.result !== "UNCHANGED" || !same(before, after)) {
    reject("TASK70_DYNAMIC_OBJECT_PROTECTION_FAILED");
  }
  validateCleanup(artifact.cleanup, {
    policy, runId: artifact.run_id, runtime, before, after,
  });
  if (!Array.isArray(artifact.cases) || artifact.cases.length !== 1) {
    reject("TASK70_DYNAMIC_CASE_SET_INVALID");
  }
  validateCase(artifact.cases[0], {
    runtime, objectBefore: before, objectAfter: after, cleanup: artifact.cleanup,
  }, policy.case_catalog[0]);
  validateCoverage(artifact.coverage, policy, artifact.cases);
  exactArray(artifact.non_claims, NON_CLAIMS, "TASK70_DYNAMIC_NON_CLAIMS_INVALID");
  return artifact;
}

export function summarizeTask70DynamicEvidence(
  input, { policy, sourceBodies, repositoryGit } = {},
) {
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
  const artifact = validateTask70DynamicArtifact(input, {
    policy, sourceBodies, repositoryGit,
  });
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
  const artifact = artifactRaw === null ? null : JSON.parse(artifactRaw);
  return {
    policy,
    sourceBodies,
    artifact,
    repositoryGit: artifact === null
      ? null : loadTask70DynamicRepositoryGitProjection(artifact, policy),
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
    process.stdout.write("TASK70 DYNAMIC EVIDENCE POLICY V2 VERIFY PASS clearance=PARTIAL_ONLY\n");
    return;
  }
  if (inputs.artifact === null) reject("TASK70_DYNAMIC_ARTIFACT_NOT_EXECUTED");
  const artifact = validateTask70DynamicArtifact(inputs.artifact, inputs);
  process.stdout.write(
    `TASK70 DYNAMIC EVIDENCE V2 VERIFY PASS status=PARTIAL artifact_sha256=${artifact.artifact_sha256}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error?.code || "TASK70_DYNAMIC_EVIDENCE_FAILED"}\n`);
    process.exitCode = 1;
  }
}
