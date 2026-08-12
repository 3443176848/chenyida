import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./release-identity-contract.mjs";
import {
  RELEASE_GATE_REPORT_CONTRACT,
  RELEASE_GATE_ATTEMPT_CONTRACT,
  RELEASE_MAX_SBOM_BYTES,
  RELEASE_MAX_CLOCK_SKEW_MS,
  RELEASE_MAX_SBOM_EVIDENCE_AGE_MS,
  RELEASE_MAX_SECURITY_DATABASE_AGE_MS,
  RELEASE_MAX_SECURITY_EVIDENCE_AGE_MS,
  RELEASE_TEST_RUNTIME_POLICY_SHA256,
  ReleaseManifestError,
  buildMigrationAllowlist,
  canonicalJson,
  migrationAllowlistDigest,
  publishPreparedJsonArtifact,
  readPreparedJsonArtifact,
  readTrustedArtifactFile,
  readStrictJsonFile,
  sha256,
  validateCandidate,
  validateOfficialReleaseGatePlan,
  validateOfficialTestRuntimePolicy,
  validateOfficialVulnerabilityPolicy,
  validateReleaseGatePlan,
  validateReleaseGateReport,
  validateReleaseGateAttempt,
  validateSecurityScanReport,
  validateSbomEvidence,
  validateSecurityEvidence,
  verifyTrustedImageEvidence,
  writeImmutableJsonArtifact,
  writePreparedJsonArtifact,
} from "./release-manifest-contract.mjs";

const EMPTY_SHA256 = sha256("");
const DEFAULT_SUPERVISOR_SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RELEASE_GATE_LOCK_FILE = "/var/lock/chenyida-erp-release-gate-v1.lock";
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const RELEASE_TEMPORARY_LABELS = ["chenyida.erp.release-node-bootstrap", "chenyida.erp.release-manifest-node-bootstrap", "chenyida.erp.release-node-test", "chenyida.erp.release-browser-test", "chenyida.erp.release-postgres-regression", "chenyida.erp.release-migration-test", "chenyida.erp.backup-recovery-test", "chenyida.erp.release-identity-publisher", "chenyida.erp.release-image-evidence"];
const REQUIRED_RUNTIME_SERVICES = new Map([["caddy", new Set(["none"])], ["postgres", new Set(["healthy"])], ["web", new Set(["healthy"])], ["worker", new Set(["none", "healthy"])]]);
const TREE_DIGEST_COMMAND = "{ /usr/bin/find -P . -xdev -printf '%y|%m|%P|%l\\n' | LC_ALL=C /usr/bin/sort; /usr/bin/find -P . -xdev -type f -print0 | LC_ALL=C /usr/bin/sort -z | /usr/bin/xargs -0 /usr/bin/sha256sum; } | /usr/bin/sha256sum";
const OFFICIAL_EXECUTOR_COMMANDS = new Map([
  ["NODE_CANDIDATE_TEST:CONTRACTS", ["scripts/run-release-node-sandbox.sh", "contracts"]],
  ["NODE_CANDIDATE_TEST:CREDENTIALS", ["scripts/run-release-node-sandbox.sh", "credentials"]],
  ["NODE_CANDIDATE_TEST:NODE_SOURCE", ["scripts/run-release-node-sandbox.sh", "node-source"]],
  ["POSTGRES_CANDIDATE_TEST:POSTGRES_REGRESSION", ["scripts/run-release-postgres-regression-tests.sh"]],
  ["NODE_CANDIDATE_TEST:BROWSER_E2E", ["scripts/run-release-node-sandbox.sh", "browser-e2e"]],
  ["NODE_CANDIDATE_TEST:SPECIAL_POSIX", ["scripts/run-release-node-sandbox.sh", "special-posix"]],
  ["NODE_CANDIDATE_TEST:TYPECHECK", ["scripts/run-release-node-sandbox.sh", "typecheck"]],
  ["NODE_CANDIDATE_TEST:LINT", ["scripts/run-release-node-sandbox.sh", "lint"]],
  ["MIGRATION_POSTGRES_TEST:RELEASE_MIGRATION", ["scripts/run-release-migration-postgres-test.sh"]],
  ["BACKUP_RECOVERY_POSTGRES_TEST:BACKUP_RECOVERY", ["scripts/run-backup-recovery-postgres-test.sh"]],
  ["PYTHON_CANDIDATE_TEST:SUPERVISOR_CONTRACTS", ["scripts/run-python-baseline-test.sh", "supervisor-contracts"]],
  ["PYTHON_CANDIDATE_TEST:SELF_TEST", ["scripts/run-python-baseline-test.sh", "self-test"]],
  ["PYTHON_CANDIDATE_TEST:SMOKE", ["scripts/run-python-baseline-test.sh", "smoke"]],
  ["PYTHON_CANDIDATE_TEST:GO_LIVE", ["scripts/run-python-baseline-test.sh", "go-live"]],
  ["COMPOSE_CONFIG_TEST:VALIDATE", ["scripts/run-compose-config-test.sh"]],
  ["SOURCE_CHECK:DIFF_CHECK", ["scripts/run-source-diff-check.sh"]],
]);

function fail(code) {
  throw new ReleaseManifestError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}

function supervisorControl(environment) {
  if (environment.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES") fail("GATE_SUPERVISOR_REQUIRED");
  const supervisorBundleSha256 = environment.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256;
  const authorizationSha256 = environment.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256;
  if (![supervisorBundleSha256, authorizationSha256].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))) fail("GATE_SUPERVISOR_CONTROL_INVALID");
  return { supervisor_bundle_sha256: supervisorBundleSha256, authorization_sha256: authorizationSha256 };
}

function cliOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(result, key)) fail("GATE_CLI_ARGUMENT_INVALID");
    result[key] = value;
  }
  return result;
}

function isoNow(clock) {
  return clock().toISOString();
}

async function systemResources(temporaryContainers) {
  const memory = await readFile("/proc/meminfo", "utf8");
  const values = Object.fromEntries([...memory.matchAll(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/gm)].map((match) => [match[1], Number(match[2])]));
  if (!Number.isFinite(values.MemAvailable) || !Number.isFinite(values.SwapTotal) || !Number.isFinite(values.SwapFree)) fail("GATE_RESOURCE_READ_FAILED");
  const root = await statfs("/");
  const swapUsedMib = (values.SwapTotal - values.SwapFree) / 1024;
  const swapUsedPercent = values.SwapTotal === 0 ? 0 : ((values.SwapTotal - values.SwapFree) / values.SwapTotal) * 100;
  return {
    available_memory_mib: Number((values.MemAvailable / 1024).toFixed(3)),
    swap_used_mib: Number(swapUsedMib.toFixed(3)),
    swap_used_percent: Number(swapUsedPercent.toFixed(3)),
    root_free_gib: Number(((Number(root.bavail) * Number(root.bsize)) / (1024 ** 3)).toFixed(3)),
    load_1m: Number(os.loadavg()[0].toFixed(3)),
    temporary_containers: temporaryContainers,
  };
}

function dockerContainerIds(environment = process.env) {
  const result = spawnSync("/usr/bin/docker", ["ps", "-aq", "--no-trunc"], { encoding: "utf8", timeout: 30_000, env: environment });
  if (result.status !== 0) fail("GATE_DOCKER_INVENTORY_FAILED");
  return new Set(result.stdout.split(/\s+/).filter(Boolean));
}

function releaseTemporaryContainerIds(environment) {
  const found = new Set();
  for (const label of RELEASE_TEMPORARY_LABELS) {
    const result = spawnSync("/usr/bin/docker", ["ps", "-aq", "--no-trunc", "--filter", `label=${label}`], { encoding: "utf8", timeout: 30_000, env: environment });
    if (result.status !== 0) fail("GATE_TEMPORARY_CONTAINER_INVENTORY_FAILED");
    for (const id of result.stdout.split(/\s+/).filter(Boolean)) found.add(id);
  }
  return [...found].sort();
}

function git(repositoryRoot, args, { output = false } = {}) {
  const gitEnvironment = {
    PATH: "/usr/bin:/bin", HOME: "/nonexistent", LC_ALL: "C", LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0",
  };
  const result = spawnSync("/usr/bin/git", ["-c", `safe.directory=${repositoryRoot}`, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "pager.diff=false", "-C", repositoryRoot, ...args], { encoding: "utf8", timeout: 30_000, env: gitEnvironment });
  if (result.status !== 0) fail("GATE_GIT_PREFLIGHT_FAILED");
  return output ? result.stdout.trim() : "";
}

function verifySource(repositoryRoot, candidate) {
  const root = path.resolve(repositoryRoot);
  if (git(root, ["rev-parse", "--show-toplevel"], { output: true }) !== root) fail("GATE_GIT_ROOT_MISMATCH");
  if (git(root, ["rev-parse", "--verify", "HEAD^{commit}"], { output: true }) !== candidate.git_commit) fail("GATE_GIT_COMMIT_MISMATCH");
  if (git(root, ["rev-parse", "--verify", "HEAD^{tree}"], { output: true }) !== candidate.git_tree) fail("GATE_GIT_TREE_MISMATCH");
  git(root, ["diff", "--quiet", "--no-ext-diff", "--no-textconv", "--"]);
  git(root, ["diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--"]);
  if (git(root, ["ls-files", "--others", "--exclude-standard", "--", "chenyida_erp_site"], { output: true }) !== "") fail("GATE_UNTRACKED_BUILD_CONTEXT");
}

function dockerStates(ids, environment = process.env) {
  if (ids.size === 0) return new Map();
  const result = spawnSync("/usr/bin/docker", ["inspect", "--format", "{{.Id}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", ...ids], { encoding: "utf8", timeout: 30_000, env: environment });
  if (result.status !== 0) fail("GATE_DOCKER_STATE_FAILED");
  const states = new Map();
  for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
    const [id, restart, oom, status, health] = line.split("|");
    if (!/^[0-9a-f]{64}$/.test(id || "") || !/^\d+$/.test(restart || "") || !["true", "false"].includes(oom) || !status || !health) fail("GATE_DOCKER_STATE_INVALID");
    states.set(id, { restart: Number(restart), oom: oom === "true", status, health });
  }
  if (states.size !== ids.size) fail("GATE_DOCKER_STATE_INCOMPLETE");
  return states;
}

function runtimeServiceInventory(environment) {
  const listed = spawnSync("/usr/bin/docker", ["ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=chenyida-erp-parallel"], { encoding: "utf8", timeout: 30_000, env: environment });
  if (listed.status !== 0) fail("GATE_RUNTIME_INVENTORY_FAILED");
  const ids = listed.stdout.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return { states: [], failure: "GATE_REQUIRED_RUNTIME_MISSING" };
  const inspected = spawnSync("/usr/bin/docker", ["inspect", "--format", "{{.Id}}|{{index .Config.Labels \"com.docker.compose.service\"}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", ...ids], { encoding: "utf8", timeout: 30_000, env: environment });
  if (inspected.status !== 0) fail("GATE_RUNTIME_STATE_FAILED");
  const states = inspected.stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [container_id, service, restart, oom, status, health] = line.split("|");
    if (!/^[0-9a-f]{64}$/.test(container_id || "") || !/^[a-z][a-z0-9_-]*$/.test(service || "") || !/^\d+$/.test(restart || "") || !["true", "false"].includes(oom) || !status || !health) fail("GATE_RUNTIME_STATE_INVALID");
    return { service, container_id, restart_count: Number(restart), oom_killed: oom === "true", status, health };
  }).sort((left, right) => left.service.localeCompare(right.service));
  const services = states.map((state) => state.service);
  const expected = [...REQUIRED_RUNTIME_SERVICES.keys()];
  if (states.length !== expected.length || services.some((service, index) => service !== expected[index])) return { states, failure: "GATE_REQUIRED_RUNTIME_SET_INVALID" };
  const unhealthy = states.some((state) => state.restart_count !== 0 || state.oom_killed || state.status !== "running" || !REQUIRED_RUNTIME_SERVICES.get(state.service).has(state.health));
  return { states, failure: unhealthy ? "GATE_REQUIRED_RUNTIME_UNHEALTHY" : null };
}

function runtimeTreeDigest(directory) {
  const absolute = path.resolve(directory);
  const insecure = spawnSync("/usr/bin/find", ["-P", ".", "-xdev", "(", "-type", "f", "-o", "-type", "d", ")", "(", "!", "-user", "root", "-o", "!", "-group", "root", "-o", "-perm", "/022", ")", "-print", "-quit"], { cwd: absolute, encoding: "utf8", timeout: 60_000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  if (insecure.status !== 0 || typeof insecure.stdout !== "string" || insecure.stdout.trim() !== "") fail("GATE_TEST_RUNTIME_PERMISSIONS_INVALID");
  const result = spawnSync("/bin/sh", ["-c", TREE_DIGEST_COMMAND], { cwd: absolute, encoding: "utf8", timeout: 180_000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  const digest = typeof result.stdout === "string" ? result.stdout.trim().split(/\s+/)[0] || "" : "";
  if (result.status !== 0 || !/^[0-9a-f]{64}$/.test(digest)) fail("GATE_TEST_RUNTIME_DIGEST_FAILED");
  return digest;
}

function inspectPinnedRuntimeImage(reference, expectedRepoDigest, expectedConfigDigest, expectedPlatform, environment) {
  const result = spawnSync("/usr/bin/docker", ["image", "inspect", "--format", "{{.Id}}|{{.Os}}/{{.Architecture}}|{{json .RepoDigests}}", "--", reference], { encoding: "utf8", timeout: 30_000, env: environment });
  const lines = typeof result.stdout === "string" ? result.stdout.trim().split("\n").filter(Boolean) : [];
  if (result.status !== 0 || lines.length !== 1) fail("GATE_TEST_RUNTIME_IMAGE_MISMATCH");
  const first = lines[0].indexOf("|"); const second = lines[0].indexOf("|", first + 1);
  if (first < 1 || second < first + 2) fail("GATE_TEST_RUNTIME_IMAGE_MISMATCH");
  let repoDigests;
  try { repoDigests = JSON.parse(lines[0].slice(second + 1)); } catch { fail("GATE_TEST_RUNTIME_IMAGE_MISMATCH"); }
  if (lines[0].slice(0, first) !== expectedConfigDigest || lines[0].slice(first + 1, second) !== expectedPlatform || !Array.isArray(repoDigests) || !repoDigests.includes(reference) || !reference.endsWith(`@${expectedRepoDigest}`)) fail("GATE_TEST_RUNTIME_IMAGE_MISMATCH");
  return expectedConfigDigest;
}

export async function verifyTestRuntimePolicy(repositoryRoot, environment = process.env, supervisorSiteRoot = DEFAULT_SUPERVISOR_SITE_ROOT) {
  const root = path.resolve(repositoryRoot);
  const policyPath = path.join(path.resolve(supervisorSiteRoot), "release", "test-runtime-policy-v1.json");
  const raw = await readFile(policyPath, "utf8");
  const policy = validateOfficialTestRuntimePolicy(parseStrictJson(raw), raw);
  const nodeModules = path.join(root, policy.node_dependencies.path);
  const pythonVenv = path.join(root, policy.python_runtime.venv_path);
  if (sha256(await readFile(path.join(root, "chenyida_erp_site", "package-lock.json"))) !== policy.node_dependencies.package_lock_sha256) fail("GATE_TEST_RUNTIME_LOCKFILE_MISMATCH");
  if (sha256(await readFile(path.join(root, "chenyida_erp_app", "requirements.txt"))) !== policy.python_runtime.requirements_sha256 || sha256(await readFile(path.join(root, "chenyida_erp_app", "requirements-dev.txt"))) !== policy.python_runtime.requirements_dev_sha256) fail("GATE_TEST_RUNTIME_REQUIREMENTS_MISMATCH");
  if (sha256(await readFile(policy.python_runtime.interpreter_path)) !== policy.python_runtime.interpreter_sha256) fail("GATE_TEST_RUNTIME_INTERPRETER_MISMATCH");
  const nodeModulesDigest = runtimeTreeDigest(nodeModules); const pythonVenvDigest = runtimeTreeDigest(pythonVenv);
  if (nodeModulesDigest !== policy.node_dependencies.tree_sha256 || pythonVenvDigest !== policy.python_runtime.venv_tree_sha256) fail("GATE_TEST_RUNTIME_TREE_MISMATCH");
  const playwrightPackage = parseStrictJson(await readFile(path.join(nodeModules, policy.browser_runtime.package_name, "package.json"), "utf8"));
  if (playwrightPackage.name !== policy.browser_runtime.package_name || playwrightPackage.version !== policy.browser_runtime.package_version) fail("GATE_TEST_RUNTIME_BROWSER_PACKAGE_MISMATCH");
  return {
    policy_sha256: RELEASE_TEST_RUNTIME_POLICY_SHA256,
    node_image_digest: inspectPinnedRuntimeImage(policy.node_image.reference, policy.node_image.repo_digest, policy.node_image.config_digest, policy.platform, environment),
    postgres_image_digest: inspectPinnedRuntimeImage(policy.postgres_image.reference, policy.postgres_image.repo_digest, policy.postgres_image.config_digest, policy.platform, environment),
    posix_image_digest: inspectPinnedRuntimeImage(policy.posix_image.reference, policy.posix_image.repo_digest, policy.posix_image.config_digest, policy.platform, environment),
    browser_image_digest: inspectPinnedRuntimeImage(policy.browser_image.reference, policy.browser_image.repo_digest, policy.browser_image.config_digest, policy.platform, environment),
    browser_executable_sha256: policy.browser_runtime.executable_sha256,
    node_modules_tree_sha256: nodeModulesDigest,
    python_venv_tree_sha256: pythonVenvDigest,
  };
}

function safeCommandEnvironment(candidate, runId, heapMib, imageReferences, repositoryRoot, supervisorSiteRoot) {
  return {
    PATH: SAFE_PATH,
    HOME: "/nonexistent",
    LC_ALL: "C",
    LANG: "C",
    TZ: "UTC",
    COMPOSE_PARALLEL_LIMIT: "1",
    COMPOSE_DISABLE_ENV_FILE: "1",
    NODE_OPTIONS: `--max-old-space-size=${heapMib}`,
    ERP_ENV: "test",
    ERP_DEPLOYMENT_CLASS: "test",
    ERP_SETUP_TOKEN: "release-config-only-token-00000000",
    DATABASE_URL: "postgresql://release_config:release_config@127.0.0.1/release_config",
    ERP_MIGRATION_DATABASE_URL: "postgresql://release_migrator:release_config@127.0.0.1/release_config",
    ERP_MIGRATION_EXPECTED_ROLE: "release_migrator",
    POSTGRES_DB: "release_config",
    POSTGRES_USER: "release_config",
    POSTGRES_PASSWORD: "release-config-not-a-runtime-secret",
    ERP_BUILD_VERSION: candidate.package_version,
    ERP_BUILD_REVISION: candidate.git_commit,
    ERP_WEB_IMAGE: imageReferences.web,
    ERP_WORKER_IMAGE: imageReferences.worker,
    ERP_WEB_IMAGE_CONFIG_DIGEST: candidate.web_image_digest,
    ERP_WORKER_IMAGE_CONFIG_DIGEST: candidate.worker_image_digest,
    ERP_RELEASE_GATE_RUN_ID: runId,
    ERP_RELEASE_GATE_GIT_COMMIT: candidate.git_commit,
    ERP_RELEASE_GATE_GIT_TREE: candidate.git_tree,
    ERP_RELEASE_NODE_HEAP_MIB: String(heapMib),
    ERP_RELEASE_REPOSITORY_ROOT: path.resolve(repositoryRoot),
    ERP_RELEASE_SUPERVISOR_SITE_ROOT: path.resolve(supervisorSiteRoot),
  };
}

export function officialExecutorCommand(step, supervisorSiteRoot = DEFAULT_SUPERVISOR_SITE_ROOT) {
  const relative = OFFICIAL_EXECUTOR_COMMANDS.get(`${step?.executor_id}:${step?.action}`);
  if (!relative) fail("GATE_EXECUTOR_ACTION_INVALID");
  const executable = path.join(path.resolve(supervisorSiteRoot), relative[0]);
  if (!executable.startsWith(`${path.resolve(supervisorSiteRoot)}${path.sep}`)) fail("GATE_EXECUTOR_PATH_INVALID");
  return [executable, ...relative.slice(1)];
}

function verifyGlobalLock(environment) {
  if (environment.ERP_RELEASE_GATE_LOCK_HELD !== "YES") fail("GATE_GLOBAL_LOCK_REQUIRED");
  const result = spawnSync("/usr/bin/flock", ["-n", RELEASE_GATE_LOCK_FILE, "/bin/true"], { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  if (result.status === 0) fail("GATE_GLOBAL_LOCK_NOT_HELD");
  if (result.status !== 1) fail("GATE_GLOBAL_LOCK_PROBE_FAILED");
}

function temporaryIds(baseline, current) {
  return [...current].filter((id) => !baseline.has(id)).sort();
}

export function resourceViolation(snapshot, policy, monitorState, at = Date.now()) {
  monitorState.swapSamples.push({ at, used: snapshot.swap_used_mib });
  monitorState.swapSamples = monitorState.swapSamples.filter((sample) => sample.at >= at - 60_000);
  const growth = Math.max(0, snapshot.swap_used_mib - Math.min(...monitorState.swapSamples.map((sample) => sample.used)));
  monitorState.aggregate.maximum_swap_growth_mib_60s = Math.max(monitorState.aggregate.maximum_swap_growth_mib_60s, growth);
  if (snapshot.available_memory_mib < policy.min_available_memory_mib) return "GATE_AVAILABLE_MEMORY_BELOW_LIMIT";
  if (snapshot.swap_used_percent > policy.max_swap_used_percent) return "GATE_SWAP_ABOVE_LIMIT";
  if (growth > policy.max_swap_growth_mib_60s) return "GATE_SWAP_GROWTH_ABOVE_LIMIT";
  if (snapshot.root_free_gib < policy.min_root_free_gib) return "GATE_ROOT_DISK_BELOW_LIMIT";
  if (snapshot.load_1m > policy.max_load_1m) return "GATE_LOAD_ABOVE_LIMIT";
  if (snapshot.temporary_containers > policy.max_temporary_containers) return "GATE_TEMPORARY_CONTAINER_LIMIT_EXCEEDED";
  return null;
}

function aggregates(initial) {
  return {
    minimum_available_memory_mib: initial.available_memory_mib,
    maximum_swap_used_percent: initial.swap_used_percent,
    maximum_swap_growth_mib_60s: 0,
    minimum_root_free_gib: initial.root_free_gib,
    maximum_load_1m: initial.load_1m,
    maximum_temporary_containers: initial.temporary_containers,
  };
}

function observeAggregate(target, snapshot) {
  target.minimum_available_memory_mib = Math.min(target.minimum_available_memory_mib, snapshot.available_memory_mib);
  target.maximum_swap_used_percent = Math.max(target.maximum_swap_used_percent, snapshot.swap_used_percent);
  target.minimum_root_free_gib = Math.min(target.minimum_root_free_gib, snapshot.root_free_gib);
  target.maximum_load_1m = Math.max(target.maximum_load_1m, snapshot.load_1m);
  target.maximum_temporary_containers = Math.max(target.maximum_temporary_containers, snapshot.temporary_containers);
}

function killProcessGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}

export async function executeStep({ step, cwd, environment, baselineContainers, policy, aggregate, monitorState, clock, inventory = dockerContainerIds, readResources = systemResources, monitorIntervalMs = 1000, killGraceMs = 5000 }) {
  const startedAt = isoNow(clock); const start = Date.now();
  const stdoutHash = createHash("sha256"); const stderrHash = createHash("sha256");
  let forbidden = null; let resourceFailure = null; let timedOut = false; let tail = "";
  const patterns = step.forbid_output_patterns.map((source) => {
    try { return new RegExp(source, "m"); } catch { fail("GATE_STEP_OUTPUT_PATTERN_INVALID"); }
  });
  const inspectChunk = (chunk) => {
    const text = `${tail}${chunk.toString("utf8")}`;
    if (!forbidden) forbidden = patterns.find((pattern) => pattern.test(text))?.source || null;
    tail = text.slice(-4096);
  };
  const child = spawn(step.command[0], step.command.slice(1), { cwd, env: environment, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { stdoutHash.update(chunk); inspectChunk(chunk); });
  child.stderr.on("data", (chunk) => { stderrHash.update(chunk); inspectChunk(chunk); });
  let killTimer = null; let monitoring = true; let stopRequested = false;
  const requestStop = () => {
    if (stopRequested) return;
    stopRequested = true;
    killProcessGroup(child, "SIGTERM");
    killTimer = setTimeout(() => killProcessGroup(child, "SIGKILL"), killGraceMs);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    requestStop();
  }, step.timeout_seconds * 1000);
  const monitor = (async () => {
    while (monitoring) {
      await new Promise((resolve) => setTimeout(resolve, monitorIntervalMs));
      if (!monitoring || resourceFailure) continue;
      try {
        const current = inventory(environment);
        const snapshot = await readResources(temporaryIds(baselineContainers, current).length);
        observeAggregate(aggregate, snapshot);
        resourceFailure = resourceViolation(snapshot, policy, monitorState);
        if (resourceFailure) requestStop();
      } catch (error) {
        resourceFailure = error.code || "GATE_RESOURCE_MONITOR_FAILED";
        requestStop();
      }
    }
  })();
  const exit = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    child.once("error", (error) => finish({ code: null, signal: null, spawnError: error?.code || "SPAWN_ERROR" }));
    child.once("close", (code, signal) => finish({ code, signal, spawnError: null }));
  }).finally(async () => {
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    monitoring = false;
    await monitor;
  });
  const finishedAt = isoNow(clock);
  const reason = timedOut ? "GATE_STEP_TIMEOUT" : resourceFailure || (forbidden ? `GATE_FORBIDDEN_OUTPUT:${forbidden}` : exit.spawnError ? `GATE_STEP_SPAWN_ERROR:${exit.spawnError}` : exit.signal ? `GATE_STEP_SIGNAL:${exit.signal}` : exit.code === 0 ? null : "GATE_STEP_EXIT_NONZERO");
  return {
    ordinal: step.ordinal, id: step.id, result: reason === null ? "PASS" : "FAIL", started_at: startedAt, finished_at: finishedAt,
    duration_ms: Math.min(86_400_000, Math.max(0, Date.now() - start)), exit_code: Number.isSafeInteger(exit.code) && exit.code >= 0 && exit.code <= 255 ? exit.code : null,
    stdout_sha256: stdoutHash.digest("hex"), stderr_sha256: stderrHash.digest("hex"), reason,
  };
}

function blockedStep(step, reason) {
  return { ordinal: step.ordinal, id: step.id, result: "BLOCKED", started_at: null, finished_at: null, duration_ms: 0, exit_code: null, stdout_sha256: EMPTY_SHA256, stderr_sha256: EMPTY_SHA256, reason };
}

function notApplicableStep(step) {
  return { ordinal: step.ordinal, id: step.id, result: "NOT_APPLICABLE", started_at: null, finished_at: null, duration_ms: 0, exit_code: null, stdout_sha256: EMPTY_SHA256, stderr_sha256: EMPTY_SHA256, reason: step.reason };
}

function evidenceStep(step, sbom, security, now) {
  if (step.id === "image-sbom-evidence") return sbom.scope === "WEB_AND_WORKER_IMAGES"
    ? { ...blockedStep(step, null), result: "PASS", started_at: isoNow(() => now), finished_at: isoNow(() => now), exit_code: 0, reason: null }
    : blockedStep(step, "GATE_IMAGE_SBOM_NOT_EVALUATED");
  if (step.id === "vulnerability-assessment-evidence") {
    if (security.result !== "PASS") return blockedStep(step, "GATE_VULNERABILITY_STATUS_NOT_EVALUATED");
    const databaseTime = Date.parse(security.vulnerability_database_updated_at);
    if (databaseTime > now.getTime() + RELEASE_MAX_CLOCK_SKEW_MS || now.getTime() - databaseTime > RELEASE_MAX_SECURITY_DATABASE_AGE_MS) return blockedStep(step, "GATE_VULNERABILITY_DATABASE_STALE");
    return { ...blockedStep(step, null), result: "PASS", started_at: now.toISOString(), finished_at: now.toISOString(), exit_code: 0, reason: null };
  }
  return blockedStep(step, "GATE_UNKNOWN_EVIDENCE_STEP");
}

async function readEvidence(artifactRoot, file, validator, code) {
  const absolute = path.resolve(file);
  if (file !== absolute || path.dirname(absolute) !== path.resolve(artifactRoot)) fail(`${code}_OUTSIDE_ARTIFACT_ROOT`);
  const { raw } = await readTrustedArtifactFile(path.resolve(artifactRoot), path.basename(absolute), { minimumBytes: 2, maximumBytes: 64 * 1024, code });
  const text = raw.toString("utf8");
  return { raw: text, value: validator(parseStrictJson(text)) };
}

async function verifySbomDocument(artifactRoot, sbom) {
  if (sbom.scope === "WEB_AND_WORKER_IMAGES") return;
  const descriptor = sbom.documents[0];
  const { raw } = await readTrustedArtifactFile(path.resolve(artifactRoot), descriptor.file, { minimumBytes: 2, maximumBytes: RELEASE_MAX_SBOM_BYTES, code: "GATE_SBOM_DOCUMENT_INVALID" });
  if (sha256(raw) !== descriptor.sha256) fail("GATE_SBOM_DOCUMENT_DIGEST_MISMATCH");
}

async function verifySecurityReport(artifactRoot, sbom, security, imageReferences, supervisorBundleSha256) {
  if (security.result !== "PASS") return null;
  const native = await verifyTrustedImageEvidence({ root: path.resolve(artifactRoot), sbom, security, imageReferences, expectedProducer: { supervisorBundleSha256 } });
  const { raw } = await readTrustedArtifactFile(path.resolve(artifactRoot), security.raw_report_file, { minimumBytes: 2, maximumBytes: RELEASE_MAX_SBOM_BYTES, code: "GATE_SECURITY_REPORT_INVALID" });
  if (sha256(raw) !== security.raw_report_sha256) fail("GATE_SECURITY_REPORT_DIGEST_MISMATCH");
  const normalized = validateSecurityScanReport(parseStrictJson(raw.toString("utf8"), RELEASE_MAX_SBOM_BYTES), security);
  if (normalized.targets.some((target) => canonicalJson(target.counts) !== canonicalJson(native.targetCounts.get(target.service)))) fail("GATE_SECURITY_NATIVE_COUNTS_MISMATCH");
  return native;
}

function assertCandidateMatches(expected, actual, code) {
  if (canonicalJson(expected) !== canonicalJson(actual)) fail(code);
}

export async function runReleaseGate({ planPath, repositoryRoot, artifactRoot, runId, candidate, webImageReference, workerImageReference, sbomEvidencePath, securityEvidencePath, environment = process.env, clock = () => new Date(), requireOfficialPlan = true, lockVerifier = verifyGlobalLock, supervisorSiteRoot = DEFAULT_SUPERVISOR_SITE_ROOT, control = null }) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) fail("GATE_RUN_ID_INVALID");
  const trustedControl = control || supervisorControl(environment);
  lockVerifier(environment);
  validateCandidate(candidate);
  for (const reference of [webImageReference, workerImageReference]) if (typeof reference !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/.test(reference)) fail("GATE_IMAGE_REFERENCE_INVALID");
  if (webImageReference === workerImageReference) fail("GATE_IMAGE_REFERENCE_COLLISION");
  verifySource(repositoryRoot, candidate);
  const siteRoot = path.join(path.resolve(repositoryRoot), "chenyida_erp_site");
  const trustedSupervisorSiteRoot = path.resolve(supervisorSiteRoot);
  const officialPlanPath = path.join(trustedSupervisorSiteRoot, "release", "release-gate-plan-v1.json");
  if (requireOfficialPlan && path.resolve(planPath) !== officialPlanPath) fail("GATE_PLAN_PATH_NOT_OFFICIAL");
  const { raw: sourcePlanRaw } = await readStrictJsonFile(planPath);
  const plan = requireOfficialPlan ? validateOfficialReleaseGatePlan(parseStrictJson(sourcePlanRaw)) : validateReleaseGatePlan(parseStrictJson(sourcePlanRaw));
  if (requireOfficialPlan) {
    const policyRaw = await readFile(path.join(trustedSupervisorSiteRoot, "release", "vulnerability-policy-v1.json"), "utf8");
    validateOfficialVulnerabilityPolicy(parseStrictJson(policyRaw), policyRaw);
  }
  const testRuntime = await verifyTestRuntimePolicy(repositoryRoot, environment, trustedSupervisorSiteRoot);
  const planRaw = canonicalJson(plan);
  const planFilename = `${runId}.release-gate-plan.json`;
  const evidenceNames = [path.basename(sbomEvidencePath || ""), path.basename(securityEvidencePath || ""), planFilename, `${runId}.release-gate-report.json`, `${runId}.release-gate-attempt.json`];
  if (new Set(evidenceNames).size !== evidenceNames.length) fail("GATE_ARTIFACT_NAME_COLLISION");
  const sbomLoaded = await readEvidence(artifactRoot, sbomEvidencePath, validateSbomEvidence, "GATE_SBOM_EVIDENCE_INVALID");
  const securityLoaded = await readEvidence(artifactRoot, securityEvidencePath, validateSecurityEvidence, "GATE_SECURITY_EVIDENCE_INVALID");
  const evidenceNow = clock().getTime(); const sbomTime = Date.parse(sbomLoaded.value.generated_at); const securityTime = Date.parse(securityLoaded.value.generated_at);
  if (sbomTime > evidenceNow + RELEASE_MAX_CLOCK_SKEW_MS || evidenceNow - sbomTime > RELEASE_MAX_SBOM_EVIDENCE_AGE_MS) fail("GATE_SBOM_EVIDENCE_STALE");
  if (securityTime > evidenceNow + RELEASE_MAX_CLOCK_SKEW_MS || evidenceNow - securityTime > RELEASE_MAX_SECURITY_EVIDENCE_AGE_MS) fail("GATE_SECURITY_EVIDENCE_STALE");
  assertCandidateMatches(candidate, sbomLoaded.value.candidate, "GATE_SBOM_CANDIDATE_MISMATCH");
  assertCandidateMatches(candidate, securityLoaded.value.candidate, "GATE_SECURITY_CANDIDATE_MISMATCH");
  if (securityLoaded.value.sbom_evidence_sha256 !== sha256(sbomLoaded.raw)) fail("GATE_SECURITY_SBOM_DIGEST_MISMATCH");
  await verifySbomDocument(artifactRoot, sbomLoaded.value);
  await verifySecurityReport(artifactRoot, sbomLoaded.value, securityLoaded.value, { web: webImageReference, worker: workerImageReference }, trustedControl.supervisor_bundle_sha256);
  const packageValue = JSON.parse(await readFile(path.join(siteRoot, "package.json"), "utf8"));
  if (packageValue.version !== candidate.package_version) fail("GATE_PACKAGE_VERSION_MISMATCH");
  const migrations = await buildMigrationAllowlist(path.join(siteRoot, "drizzle-postgres"));
  if (migrationAllowlistDigest(migrations) !== candidate.migration_allowlist_sha256) fail("GATE_MIGRATION_ALLOWLIST_MISMATCH");
  const runEnvironment = safeCommandEnvironment(candidate, runId, plan.resource_policy.node_max_old_space_size_mib, { web: webImageReference, worker: workerImageReference }, repositoryRoot, trustedSupervisorSiteRoot);
  const baselineContainers = dockerContainerIds(runEnvironment); const baselineStates = dockerStates(baselineContainers, runEnvironment); const baselineRuntime = runtimeServiceInventory(runEnvironment);
  const preexistingTemporaryContainerIds = releaseTemporaryContainerIds(runEnvironment);
  const baselineRuntimeFailure = preexistingTemporaryContainerIds.length > 0 ? "GATE_PREEXISTING_TASK_CONTAINER" : baselineRuntime.failure;
  const initial = await systemResources(preexistingTemporaryContainerIds.length); const aggregate = aggregates(initial); const monitorState = { swapSamples: [], aggregate }; const initialViolation = resourceViolation(initial, plan.resource_policy, monitorState);
  const startedAt = isoNow(clock); const results = []; let blocked = baselineRuntimeFailure || initialViolation;
  for (const step of plan.steps) {
    if (step.applicability === "NOT_APPLICABLE") { results.push(notApplicableStep(step)); continue; }
    if (blocked) { results.push(blockedStep(step, blocked)); continue; }
    if (step.kind === "EVIDENCE") {
      const result = evidenceStep(step, sbomLoaded.value, securityLoaded.value, clock()); results.push(result);
      if (result.result !== "PASS") blocked = result.reason;
      continue;
    }
    const result = await executeStep({ step: { ...step, command: officialExecutorCommand(step, trustedSupervisorSiteRoot) }, cwd: siteRoot, environment: runEnvironment, baselineContainers, policy: plan.resource_policy, aggregate, monitorState, clock });
    const postContainers = dockerContainerIds(runEnvironment); const postSnapshot = await systemResources(temporaryIds(baselineContainers, postContainers).length); observeAggregate(aggregate, postSnapshot);
    const postViolation = resourceViolation(postSnapshot, plan.resource_policy, monitorState);
    if (result.result === "PASS" && postViolation) { result.result = "FAIL"; result.reason = postViolation; }
    results.push(result); if (result.result !== "PASS") blocked = result.reason;
  }
  verifySource(repositoryRoot, candidate);
  const finalContainers = dockerContainerIds(runEnvironment); const residual = temporaryIds(baselineContainers, finalContainers); const finalRuntime = runtimeServiceInventory(runEnvironment);
  const finalStates = dockerStates(new Set([...baselineContainers].filter((id) => finalContainers.has(id))), runEnvironment);
  let runtimeFailure = baselineRuntimeFailure;
  for (const [id, before] of baselineStates) {
    const after = finalStates.get(id);
    if (!after) { runtimeFailure = "GATE_BASELINE_CONTAINER_DISAPPEARED"; break; }
    if ((after.oom && !before.oom) || after.restart > before.restart) { runtimeFailure = "GATE_BASELINE_CONTAINER_OOM_OR_RESTART"; break; }
    if (after.status !== before.status || after.health !== before.health) { runtimeFailure = "GATE_BASELINE_CONTAINER_STATE_CHANGED"; break; }
  }
  if (finalRuntime.failure) runtimeFailure = finalRuntime.failure;
  else if (canonicalJson(finalRuntime.states) !== canonicalJson(baselineRuntime.states)) runtimeFailure = "GATE_REQUIRED_RUNTIME_CHANGED";
  try {
    const finalTestRuntime = await verifyTestRuntimePolicy(repositoryRoot, runEnvironment, trustedSupervisorSiteRoot);
    if (canonicalJson(finalTestRuntime) !== canonicalJson(testRuntime)) runtimeFailure = "GATE_TEST_RUNTIME_CHANGED";
  } catch (error) {
    runtimeFailure = error instanceof ReleaseManifestError ? error.code : "GATE_TEST_RUNTIME_RECHECK_FAILED";
  }
  const final = await systemResources(residual.length); observeAggregate(aggregate, final);
  const finalViolation = resourceViolation(final, plan.resource_policy, monitorState);
  const finalResourceFailure = residual.length > 0 ? "GATE_RESIDUAL_TASK_CONTAINER" : finalViolation;
  let result = results.some((step) => step.result === "FAIL") || runtimeFailure || finalResourceFailure ? "FAIL" : results.every((step) => ["PASS", "NOT_APPLICABLE"].includes(step.result)) ? "PASS" : "BLOCKED";
  if (sbomLoaded.value.scope !== "WEB_AND_WORKER_IMAGES" || securityLoaded.value.result !== "PASS") result = result === "FAIL" ? "FAIL" : "BLOCKED";
  const report = {
    schema_version: 1, contract: RELEASE_GATE_REPORT_CONTRACT, plan_id: plan.plan_id, plan_sha256: sha256(planRaw), run_id: runId,
    generated_at: startedAt, completed_at: isoNow(clock), control: trustedControl, candidate, steps: results,
    evidence: { sbom_file: path.basename(sbomEvidencePath), sbom_sha256: sha256(sbomLoaded.raw), sbom_scope: sbomLoaded.value.scope, security_file: path.basename(securityEvidencePath), security_sha256: sha256(securityLoaded.raw), security_result: securityLoaded.value.result },
    resources: { initial, final, test_runtime: testRuntime, baseline_runtime_services: baselineRuntime.states, final_runtime_services: finalRuntime.states, baseline_container_count: baselineContainers.size, preexisting_temporary_container_ids: preexistingTemporaryContainerIds, ...aggregate, residual_container_ids: residual, baseline_runtime_failure: runtimeFailure, final_resource_failure: finalResourceFailure }, result,
  };
  validateReleaseGateReport(report);
  const filename = `${runId}.release-gate-report.json`;
  const preparedPlanFilename = `.${runId}.release-gate-plan.prepared.json`;
  const preparedReportFilename = `.${runId}.release-gate-report.prepared.json`;
  await writePreparedJsonArtifact({ root: artifactRoot, filename: preparedPlanFilename, value: plan });
  await writePreparedJsonArtifact({ root: artifactRoot, filename: preparedReportFilename, value: report });
  return { report, filename, planFilename, preparedPlanFilename, preparedReportFilename };
}

export async function publishReleaseGateArtifacts({ artifactRoot, runId, planSha256, reportSha256, control, runnerExitCode }) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) fail("GATE_RUN_ID_INVALID");
  if (!Number.isInteger(runnerExitCode) || runnerExitCode < 0 || runnerExitCode > 255) fail("GATE_RUNNER_EXIT_CODE_INVALID");
  const preparedPlanFilename = `.${runId}.release-gate-plan.prepared.json`;
  const preparedReportFilename = `.${runId}.release-gate-report.prepared.json`;
  const planFilename = `${runId}.release-gate-plan.json`;
  const reportFilename = `${runId}.release-gate-report.json`;
  const planLoaded = await readPreparedJsonArtifact({ root: artifactRoot, filename: preparedPlanFilename, expectedSha256: planSha256, validator: validateOfficialReleaseGatePlan, code: "GATE_PREPARED_PLAN_INVALID" });
  const reportLoaded = await readPreparedJsonArtifact({ root: artifactRoot, filename: preparedReportFilename, expectedSha256: reportSha256, validator: validateReleaseGateReport, code: "GATE_PREPARED_REPORT_INVALID" });
  if (reportLoaded.value.run_id !== runId || reportLoaded.value.plan_id !== planLoaded.value.plan_id || reportLoaded.value.plan_sha256 !== planSha256) fail("GATE_PREPARED_PLAN_REPORT_MISMATCH");
  if (canonicalJson(reportLoaded.value.control) !== canonicalJson(control)) fail("GATE_PREPARED_CONTROL_MISMATCH");
  if (runnerExitCode !== (reportLoaded.value.result === "PASS" ? 0 : 1)) fail("GATE_RUNNER_EXIT_REPORT_MISMATCH");
  await publishPreparedJsonArtifact({ root: artifactRoot, preparedFilename: preparedPlanFilename, expectedSha256: planSha256, filename: planFilename, validator: validateOfficialReleaseGatePlan });
  await publishPreparedJsonArtifact({ root: artifactRoot, preparedFilename: preparedReportFilename, expectedSha256: reportSha256, filename: reportFilename, validator: validateReleaseGateReport });
  return { report: reportLoaded.value, filename: reportFilename, planFilename };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (command === "commit") {
    exactKeys(options, ["--artifact-root", "--run-id", "--plan-sha256", "--report-sha256", "--runner-exit-code", "--confirm"], "GATE_CLI_ARGUMENT_INVALID");
    if (options["--confirm"] !== "PUBLISH_RELEASE_GATE_AFTER_RECHECK") fail("GATE_CLI_CONFIRMATION_INVALID");
    verifyGlobalLock(process.env);
    const control = supervisorControl(process.env);
    const runnerExitCode = Number(options["--runner-exit-code"]);
    const outcome = await publishReleaseGateArtifacts({ artifactRoot: options["--artifact-root"], runId: options["--run-id"], planSha256: options["--plan-sha256"], reportSha256: options["--report-sha256"], control, runnerExitCode });
    process.stdout.write(`${JSON.stringify({ result: outcome.report.result, report_file: outcome.filename, report_sha256: options["--report-sha256"], plan_file: outcome.planFilename, plan_sha256: options["--plan-sha256"] })}\n`);
    if (outcome.report.result !== "PASS") process.exitCode = 1;
    return;
  }
  if (command !== "run") fail("GATE_CLI_COMMAND_INVALID");
  exactKeys(options, ["--plan", "--repository-root", "--artifact-root", "--run-id", "--git-commit", "--git-tree", "--package-version", "--web-image-reference", "--worker-image-reference", "--web-image-digest", "--worker-image-digest", "--migration-allowlist-sha256", "--sbom-evidence", "--security-evidence", "--confirm"], "GATE_CLI_ARGUMENT_INVALID");
  if (options["--confirm"] !== "RUN_EXACT_RELEASE_GATE") fail("GATE_CLI_CONFIRMATION_INVALID");
  const candidate = { git_commit: options["--git-commit"], git_tree: options["--git-tree"], package_version: options["--package-version"], web_image_digest: options["--web-image-digest"], worker_image_digest: options["--worker-image-digest"], migration_allowlist_sha256: options["--migration-allowlist-sha256"] };
  const startedAt = new Date().toISOString();
  const control = supervisorControl(process.env);
  let outcome;
  try {
    outcome = await runReleaseGate({ planPath: options["--plan"], repositoryRoot: options["--repository-root"], artifactRoot: options["--artifact-root"], runId: options["--run-id"], candidate, webImageReference: options["--web-image-reference"], workerImageReference: options["--worker-image-reference"], sbomEvidencePath: options["--sbom-evidence"], securityEvidencePath: options["--security-evidence"], control });
  } catch (error) {
    const failureCode = error instanceof ReleaseManifestError ? error.code : "RELEASE_GATE_INTERNAL_ERROR";
    const attempt = validateReleaseGateAttempt({ schema_version: 1, contract: RELEASE_GATE_ATTEMPT_CONTRACT, run_id: options["--run-id"], generated_at: startedAt, completed_at: new Date().toISOString(), control, candidate, result: "FAIL", failure_code: failureCode });
    await writeImmutableJsonArtifact({ root: options["--artifact-root"], filename: `${options["--run-id"]}.release-gate-attempt.json`, value: attempt });
    throw error;
  }
  const { report, filename, planFilename, preparedPlanFilename, preparedReportFilename } = outcome;
  process.stdout.write(`${JSON.stringify({ result: report.result, report_file: filename, report_sha256: sha256(canonicalJson(report)), plan_file: planFilename, plan_sha256: report.plan_sha256, prepared_plan_file: preparedPlanFilename, prepared_report_file: preparedReportFilename })}\n`);
  if (report.result !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`${error instanceof ReleaseManifestError ? error.code : "RELEASE_GATE_INTERNAL_ERROR"}\n`); process.exitCode = 1; });
}
