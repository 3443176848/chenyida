import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeStep, officialExecutorCommand, publishReleaseGateArtifacts, resourceViolation, runReleaseGate } from "../scripts/release-gate-runner.mjs";
import { RELEASE_GATE_REPORT_CONTRACT, canonicalJson, sha256, validateOfficialReleaseGatePlan, validateReleaseGateReport, writePreparedJsonArtifact } from "../scripts/release-manifest-contract.mjs";
import {
  RELEASE_TEST_INVENTORY_NOT_APPLICABLE,
  RELEASE_TEST_INVENTORY_REQUIRED,
  RELEASE_TEST_INVENTORY_TOTAL,
  validateReleaseTestInventoryDocument,
} from "../scripts/release-test-inventory.mjs";
import { buildEligibleReleaseFixture, initializeReleaseArtifactRoot } from "./release-gate-fixture.mjs";

const rootCapable = typeof process.getuid === "function" && process.getuid() === 0;

test("versioned repository release plan is the exact fail-closed official plan", async () => {
  const raw = await readFile(new URL("../release/release-gate-plan-v1.json", import.meta.url), "utf8");
  const value = validateOfficialReleaseGatePlan(JSON.parse(raw));
  assert.equal(value.resource_policy.compose_parallel_limit, 1);
  assert.equal(value.resource_policy.max_temporary_containers, 1);
  assert.equal(value.steps.length, 18);
  assert.ok(value.steps.every((step) => step.applicability === "REQUIRED" && step.timeout_seconds <= 14400));
  assert.equal(value.steps.find((step) => step.id === "supervisor-python-contracts").executor_id, "PYTHON_CANDIDATE_TEST");
  assert.ok(["release-contracts", "credential-scan", "build-and-node-source-tests", "browser-end-to-end-tests", "special-posix-tests", "all-typescript-configs", "eslint"].every((id) => value.steps.find((step) => step.id === id)?.executor_id === "NODE_CANDIDATE_TEST"));
  assert.equal(value.steps.find((step) => step.id === "postgres-regression-tests")?.executor_id, "POSTGRES_CANDIDATE_TEST");
  assert.ok(value.steps.filter((step) => step.id.startsWith("python-")).every((step) => step.executor_id === "PYTHON_CANDIDATE_TEST"));
  assert.ok(value.steps.every((step) => !("command" in step)));
  assert.equal(officialExecutorCommand(value.steps[0], "/trusted/supervisor")[0], "/trusted/supervisor/scripts/run-release-node-sandbox.sh");
  assert.equal(officialExecutorCommand(value.steps[4], "/trusted/supervisor")[0], "/trusted/supervisor/scripts/run-release-postgres-regression-tests.sh");
  assert.deepEqual(officialExecutorCommand(value.steps[6], "/trusted/supervisor"), ["/trusted/supervisor/scripts/run-release-node-sandbox.sh", "special-posix"]);
  assert.throws(() => officialExecutorCommand({ executor_id: "PATH", action: "../../bin/sh" }, "/trusted/supervisor"), (error) => error.code === "GATE_EXECUTOR_ACTION_INVALID");
});

test("versioned test inventory accounts for every top-level test and only excludes explicit legacy or alias evidence", async () => {
  const raw = await readFile(new URL("../release/release-test-inventory-v1.json", import.meta.url), "utf8");
  const inventory = validateReleaseTestInventoryDocument(JSON.parse(raw));
  assert.equal(inventory.total_tests, RELEASE_TEST_INVENTORY_TOTAL);
  assert.equal(inventory.required_tests, RELEASE_TEST_INVENTORY_REQUIRED);
  assert.equal(inventory.not_applicable_tests, RELEASE_TEST_INVENTORY_NOT_APPLICABLE);
  assert.deepEqual(inventory.category_counts, { BROWSER: 6, HISTORICAL_D1_SITES: 22, POSTGRES: 80, POSTGRES_ALIAS: 2, PURE_NODE: 107, RELEASE_CONTRACT: 6, SPECIAL_HARNESS: 4 });
  assert.deepEqual(inventory.tests.filter((entry) => entry.category === "RELEASE_CONTRACT").map((entry) => entry.path), [
    "tests/selfhost-file-storage.test.mjs",
    "tests/selfhost-release-gate-contract.test.mjs",
    "tests/selfhost-release-identity-contract.test.mjs",
    "tests/selfhost-release-image-evidence-producer.test.mjs",
    "tests/selfhost-release-manifest-contract.test.mjs",
    "tests/selfhost-release-migration-allowlist.test.mjs",
  ]);
  assert.ok(inventory.tests.filter((entry) => entry.applicability === "NOT_APPLICABLE").every((entry) => entry.reason && entry.canonical_path !== entry.path));
  assert.ok(inventory.tests.filter((entry) => entry.applicability === "REQUIRED").every((entry) => entry.reason === null && entry.canonical_path === null));
  assert.throws(() => validateReleaseTestInventoryDocument({ ...inventory, unexpected: true }), (error) => error.code === "RELEASE_TEST_INVENTORY_FIELDS_INVALID");
  assert.throws(() => validateReleaseTestInventoryDocument({ ...inventory, tests: inventory.tests.slice(1) }), (error) => error.code === "RELEASE_TEST_INVENTORY_TESTS_INVALID");
  assert.throws(() => validateReleaseTestInventoryDocument({ ...inventory, tests: inventory.tests.map((entry, index) => index === 0 ? { ...entry, applicability: "NOT_APPLICABLE" } : entry) }), (error) => error.code === "RELEASE_TEST_ENTRY_POLICY_INVALID");
});

test("operator wrappers use a fixed real lock, trusted artifact root and sanitized child environment", async () => {
  const wrapper = await readFile(new URL("../scripts/run-release-gate.sh", import.meta.url), "utf8");
  const creator = await readFile(new URL("../scripts/create-release-manifest.sh", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/release-gate-runner.mjs", import.meta.url), "utf8");
  const nodeSandbox = await readFile(new URL("../scripts/run-release-node-sandbox.sh", import.meta.url), "utf8");
  const postgresSandbox = await readFile(new URL("../scripts/run-release-postgres-regression-tests.sh", import.meta.url), "utf8");
  const postgresRunner = await readFile(new URL("../scripts/release-postgres-regression-runner.mjs", import.meta.url), "utf8");
  const pythonSandbox = await readFile(new URL("../scripts/run-python-baseline-test.sh", import.meta.url), "utf8");
  for (const script of [wrapper, creator]) {
    assert.match(script, /LOCK_FILE=\/var\/lock\/chenyida-erp-release-gate-v1\.lock/);
    assert.match(script, /flock -n 9/);
    assert.match(script, /0:0:440:1/);
  }
  assert.match(wrapper, /release gate must be launched by the installed supervisor/);
  assert.match(creator, /release manifest creation must be launched by the installed supervisor/);
  assert.match(wrapper, /env -i PATH=/);
  assert.match(runner, /GATE_GLOBAL_LOCK_NOT_HELD/);
  assert.match(runner, /safeCommandEnvironment/);
  assert.match(runner, /OFFICIAL_EXECUTOR_COMMANDS/);
  assert.match(runner, /\.RepoDigests/);
  assert.match(runner, /expectedRepoDigest/);
  assert.match(runner, /expectedConfigDigest/);
  assert.doesNotMatch(runner, /const runEnvironment = \{ \.\.\.environment/);
  assert.doesNotMatch(runner, /process\.(?:stdout|stderr)\.write\(chunk\)/);
  assert.match(nodeSandbox, /--network none/);
  assert.match(nodeSandbox, /--read-only --cap-drop ALL --security-opt no-new-privileges/);
  assert.match(nodeSandbox, /--tmpfs \/tmp:rw,nosuid,nodev,noexec,size=256m/);
  assert.match(nodeSandbox, /--tmpfs \/test-tmp:rw,exec,nosuid,nodev,size=256m/);
  assert.match(nodeSandbox, /--tmpfs \/workspace\/chenyida_erp_site\/node_modules\/\.vite-temp:rw,exec,nosuid,nodev,size=32m/);
  assert.match(nodeSandbox, /-e TMPDIR=\/tmp/);
  assert.match(nodeSandbox, /git_candidate archive --format=tar/);
  assert.match(nodeSandbox, /NODE_IMAGE='node@sha256:[0-9a-f]{64}'/);
  assert.match(nodeSandbox, /POSIX_IMAGE='node@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37'/);
  assert.match(nodeSandbox, /ERP_CREDENTIAL_SCAN_FILE_LIST=\/workspace\/\.release-tracked-files\.nul/);
  assert.match(pythonSandbox, /--unshare-all/);
  assert.match(pythonSandbox, /--cap-drop ALL/);
  assert.match(pythonSandbox, /--clearenv/);
  assert.match(pythonSandbox, /supervisor-contracts/);
  assert.match(pythonSandbox, /--ro-bind "\$SUPERVISOR_SITE_ROOT" \/supervisor/);
  assert.match(pythonSandbox, /git_candidate archive --format=tar/);
  assert.match(pythonSandbox, /--ro-bind \/lib64 \/lib64/);
  assert.match(nodeSandbox, /-v "\$NODE_MODULES:\/workspace\/chenyida_erp_site\/node_modules:ro"/);
  assert.doesNotMatch(nodeSandbox, /\$NODE_MODULES:\/supervisor\/node_modules/);
  assert.match(nodeSandbox, /--user "\$container_user"/);
  assert.match(nodeSandbox, /chown -R 0:0 "\$SNAPSHOT"/);
  assert.match(nodeSandbox, /CONTAINER_USER=0:0/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs run NODE_RELEASE_CONTRACT/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs run NODE_SOURCE/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs run SPECIAL_POSIX/);
  assert.match(nodeSandbox, /-v "\$SNAPSHOT:\/opt\/erp:ro"/);
  assert.match(nodeSandbox, /-v "\$SNAPSHOT\/chenyida_erp_site:\/app:ro"/);
  assert.match(nodeSandbox, /-v "\$SNAPSHOT\/chenyida_erp_site:\/workspace:ro"/);
  assert.match(nodeSandbox, /--tmpfs \/run\/chenyida-erp:rw,exec,nosuid,nodev,size=128m,mode=0700/);
  assert.doesNotMatch(nodeSandbox, /\n  browser-e2e\|special-posix\)\n/);
  assert.doesNotMatch(nodeSandbox, /tests\/\*\.test\.mjs/);
  assert.doesNotMatch(nodeSandbox, /postgres-regression/);
  assert.match(postgresSandbox, /POSTGRES_IMAGE='postgres@sha256:[0-9a-f]{64}'/);
  assert.match(postgresSandbox, /NODE_IMAGE='node@sha256:[0-9a-f]{64}'/);
  assert.match(postgresSandbox, /--network none --add-host postgres:127\.0\.0\.1 --read-only --cap-drop ALL/);
  assert.match(postgresSandbox, /--memory 1024m --memory-swap 1280m --cpus 1 --pids-limit 256/);
  assert.match(postgresSandbox, /--tmpfs \/tmp:rw,exec,nosuid,nodev,size=1536m/);
  assert.match(postgresSandbox, /git_candidate archive --format=tar/);
  assert.match(postgresSandbox, /if \[ "\$\{ERP_RELEASE_POSTGRES_CONTAINER_MODE:-\}" = YES \]; then\s+container_main\s+exit 0\s+fi/);
  assert.ok(postgresSandbox.indexOf('remove_task_container "$NODE_ID" "$NODE_CONTAINER"') < postgresSandbox.indexOf("POSTGRES_ID=$(/usr/bin/docker create"));
  assert.match(postgresRunner, /EXPECTED_POSTGRES_TESTS = 80/);
  assert.match(postgresRunner, /harness === "POSTGRES_REGRESSION"/);
  assert.match(postgresRunner, /postgresql:\/\/chenyida_erp:x@postgres:5432\/chenyida_erp/);
  assert.match(postgresRunner, /create role chenyida_erp login nosuperuser nocreatedb nocreaterole noinherit/);
  assert.match(postgresRunner, /owner: "chenyida_erp"/);
  assert.match(postgresRunner, /const childEnvironment =|function childEnvironment/);
  assert.doesNotMatch(postgresRunner, /env:\s*process\.env/);
  assert.doesNotMatch(postgresRunner, /\.\.\.process\.env/);
  assert.match(postgresRunner, /summary\.skipped !== 0 \|\| summary\.todo !== 0/);
  assert.match(postgresRunner, /for \(const head of \[17, 36, 41\]\)/);
  assert.match(postgresRunner, /verifyReleaseTestInventory/);
  assert.match(wrapper, /\.release-gate-report\.prepared\.json/);
  assert.match(creator, /\.release-manifest\.\$AUTHORIZATION_SHA256\.prepared\.json/);
  assert.ok(wrapper.indexOf("release-gate-runner.mjs\" commit") > wrapper.indexOf("candidate image changed during release gate"));
  assert.ok(creator.indexOf("publish-manifest") > creator.indexOf("candidate image changed during manifest creation"));
  assert.doesNotMatch(creator, /--output "\$ARTIFACT_ROOT\/release-manifest\.json"/);
  const launcher = await readFile(new URL("../scripts/release-supervisor-launcher.py", import.meta.url), "utf8");
  assert.equal((launcher.match(/--no-textconv/g) || []).length, 2);
});

test("gate plan and report publish only from exact prepared bytes", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-release-gate-publish-"));
  try {
    const artifacts = path.join(root, "artifacts");
    await initializeReleaseArtifactRoot(artifacts);
    const fixture = await buildEligibleReleaseFixture({ entries: [{ ordinal: 1, filename: "0001_fixture.sql", sha256: "1".repeat(64) }] });
    const runId = fixture.report.run_id;
    const planDigest = sha256(canonicalJson(fixture.plan));
    const reportDigest = sha256(canonicalJson(fixture.report));
    await writePreparedJsonArtifact({ root: artifacts, filename: `.${runId}.release-gate-plan.prepared.json`, value: fixture.plan });
    await writePreparedJsonArtifact({ root: artifacts, filename: `.${runId}.release-gate-report.prepared.json`, value: fixture.report });
    await assert.rejects(readFile(path.join(artifacts, `${runId}.release-gate-report.json`)), (error) => error.code === "ENOENT");
    await assert.rejects(publishReleaseGateArtifacts({ artifactRoot: artifacts, runId, planSha256: planDigest, reportSha256: "0".repeat(64), control: fixture.report.control, runnerExitCode: 0 }), (error) => error.code === "GATE_PREPARED_REPORT_INVALID_SHA256_MISMATCH");
    await assert.rejects(publishReleaseGateArtifacts({ artifactRoot: artifacts, runId, planSha256: planDigest, reportSha256: reportDigest, control: fixture.report.control, runnerExitCode: 137 }), (error) => error.code === "GATE_RUNNER_EXIT_REPORT_MISMATCH");
    await assert.rejects(readFile(path.join(artifacts, `${runId}.release-gate-report.json`)), (error) => error.code === "ENOENT");
    const published = await publishReleaseGateArtifacts({ artifactRoot: artifacts, runId, planSha256: planDigest, reportSha256: reportDigest, control: fixture.report.control, runnerExitCode: 0 });
    assert.equal(published.report.result, "PASS");
    assert.equal(await readFile(path.join(artifacts, published.filename), "utf8"), canonicalJson(fixture.report));
    await assert.rejects(readFile(path.join(artifacts, `.${runId}.release-gate-report.prepared.json`)), (error) => error.code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native image evidence is digest-pinned, offline, socketless and scans each saved archive", async () => {
  const producer = await readFile(new URL("../scripts/create-release-image-evidence.sh", import.meta.url), "utf8");
  assert.match(producer, /TRIVY_IMAGE='ghcr\.io\/aquasecurity\/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c'/);
  assert.match(producer, /ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256/);
  assert.match(producer, /docker image save --output "\$archive" "\$image"/);
  assert.match(producer, /--network none --read-only --cap-drop ALL --security-opt no-new-privileges/);
  assert.match(producer, /--input \/input\/image\.tar/);
  assert.match(producer, /--scanners vuln --pkg-types os,library --list-all-pkgs/);
  assert.match(producer, /--severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL/);
  assert.match(producer, /--skip-db-update --skip-java-db-update --skip-check-update --skip-vex-repo-update --skip-version-check/);
  assert.match(producer, /--offline-scan --disable-telemetry --no-progress --config \/dev\/null --ignorefile \/dev\/null/);
  assert.match(producer, /hash-database-tree/);
  assert.doesNotMatch(producer, /\/var\/run\/docker\.sock/);
  assert.doesNotMatch(producer, /--ignore-unfixed|--vex|--ignore-policy|--skip-files|--skip-dirs/);
});

test("release wrappers never pull implicitly when creating task containers", async () => {
  const files = [
    "create-release-image-evidence.sh",
    "create-release-manifest.sh",
    "run-release-gate.sh",
    "run-release-node-sandbox.sh",
    "run-release-postgres-regression-tests.sh",
    "run-release-migration-postgres-test.sh",
    "run-backup-recovery-postgres-test.sh",
    "write-release-identity.sh",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/usr\/bin\/docker run\b/, `${file} must not use implicit docker run`);
    let offset = 0;
    let count = 0;
    while ((offset = source.indexOf("/usr/bin/docker create", offset)) !== -1) {
      assert.match(source.slice(offset, offset + 160), /--pull=never/, `${file} docker create must fail closed without a local image`);
      offset += 22;
      count += 1;
    }
    assert.ok(count > 0, `${file} must exercise a checked Docker create path`);
  }
});

test("release wrappers terminate on signals and standalone container ownership is unique", async () => {
  const files = [
    "create-release-image-evidence.sh",
    "create-release-manifest.sh",
    "run-compose-config-test.sh",
    "run-python-baseline-test.sh",
    "run-release-gate.sh",
    "run-release-migration-postgres-test.sh",
    "run-release-node-sandbox.sh",
    "run-release-postgres-regression-tests.sh",
    "run-backup-recovery-postgres-test.sh",
    "write-release-identity.sh",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.match(source, /trap cleanup EXIT/);
    assert.match(source, /trap 'on_signal 129' HUP/);
    assert.match(source, /trap 'on_signal 130' INT/);
    assert.match(source, /trap 'on_signal 143' TERM/);
    assert.match(source, /on_signal\(\).*exit "\$signal_status"/s);
    assert.doesNotMatch(source, /trap cleanup EXIT HUP INT TERM/);
  }
  const sandbox = await readFile(new URL("../scripts/run-release-node-sandbox.sh", import.meta.url), "utf8");
  assert.match(sandbox, /RUN_ID="standalone-\$\{TEMP_ROOT##\*\.\}"/);
  assert.doesNotMatch(sandbox, /RUN_ID=standalone(?:\s|$)/m);
});

test("credential scan accepts only an explicit sorted committed-tree file list in snapshot mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-credential-list-"));
  try {
    await mkdir(path.join(root, "chenyida_erp_site", ".openai"), { recursive: true });
    await writeFile(path.join(root, "chenyida_erp_site", "package.json"), '{"name":"fixture"}\n');
    await writeFile(path.join(root, "chenyida_erp_site", ".openai", "hosting.json"), '{"project_id":"fixture"}\n');
    const list = path.join(root, "tracked.nul");
    await writeFile(list, "chenyida_erp_site/package.json\0");
    const valid = spawnSync(process.execPath, [new URL("../scripts/check-credentials.mjs", import.meta.url).pathname], {
      cwd: new URL("../../", import.meta.url).pathname,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ERP_CREDENTIAL_SCAN_SCOPE: "COMMITTED_TREE", ERP_CREDENTIAL_SCAN_ROOT: root, ERP_CREDENTIAL_SCAN_FILE_LIST: list },
    });
    assert.equal(valid.status, 0, valid.stderr);
    await writeFile(list, "../unsafe\0");
    const invalid = spawnSync(process.execPath, [new URL("../scripts/check-credentials.mjs", import.meta.url).pathname], {
      cwd: new URL("../../", import.meta.url).pathname,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ERP_CREDENTIAL_SCAN_SCOPE: "COMMITTED_TREE", ERP_CREDENTIAL_SCAN_ROOT: root, ERP_CREDENTIAL_SCAN_FILE_LIST: list },
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /unsafe path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid release run IDs fail before lock, source, Docker or command work", async () => {
  await assert.rejects(runReleaseGate({ runId: "../escape", environment: {} }), (error) => error.code === "GATE_RUN_ID_INVALID");
  await assert.rejects(runReleaseGate({ runId: "a".repeat(81), environment: {} }), (error) => error.code === "GATE_RUN_ID_INVALID");
});

test("resource policy stops on 60-second swap growth and absolute thresholds", async () => {
  const plan = validateOfficialReleaseGatePlan(JSON.parse(await readFile(new URL("../release/release-gate-plan-v1.json", import.meta.url), "utf8")));
  const base = { available_memory_mib: 2048, swap_used_mib: 100, swap_used_percent: 10, root_free_gib: 30, load_1m: 0.5, temporary_containers: 0 };
  const state = { swapSamples: [], aggregate: { maximum_swap_growth_mib_60s: 0 } };
  assert.equal(resourceViolation(base, plan.resource_policy, state, 0), null);
  assert.equal(resourceViolation({ ...base, swap_used_mib: 357 }, plan.resource_policy, state, 59_000), "GATE_SWAP_GROWTH_ABOVE_LIMIT");
  assert.equal(state.aggregate.maximum_swap_growth_mib_60s, 257);
  assert.equal(resourceViolation({ ...base, swap_used_percent: 80.1 }, plan.resource_policy, { swapSamples: [], aggregate: { maximum_swap_growth_mib_60s: 0 } }, 0), "GATE_SWAP_ABOVE_LIMIT");
});

test("step timeout and resource abort escalate to SIGKILL for TERM-resistant process groups", async () => {
  const healthy = { available_memory_mib: 2048, swap_used_mib: 100, swap_used_percent: 10, root_free_gib: 30, load_1m: 0.5, temporary_containers: 0 };
  const policy = { min_available_memory_mib: 768, max_swap_used_percent: 80, max_swap_growth_mib_60s: 256, min_root_free_gib: 10, max_load_1m: 4, max_temporary_containers: 1 };
  const makeState = () => ({ aggregate: { minimum_available_memory_mib: 2048, maximum_swap_used_percent: 10, maximum_swap_growth_mib_60s: 0, minimum_root_free_gib: 30, maximum_load_1m: 0.5, maximum_temporary_containers: 0 }, monitorState: { swapSamples: [], aggregate: { maximum_swap_growth_mib_60s: 0 } } });
  const run = async ({ timeout, resources }) => {
    const state = makeState();
    return executeStep({
      step: { ordinal: 1, id: "term-resistant", timeout_seconds: timeout, command: ["/bin/sh", "-c", "trap '' TERM; while :; do sleep 1; done"], forbid_output_patterns: [] },
      cwd: "/tmp", environment: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, baselineContainers: new Set(), policy,
      aggregate: state.aggregate, monitorState: state.monitorState, clock: () => new Date(), inventory: () => new Set(), readResources: resources,
      monitorIntervalMs: 10, killGraceMs: 50,
    });
  };
  const timedOut = await run({ timeout: 0.05, resources: async () => healthy });
  assert.equal(timedOut.reason, "GATE_STEP_TIMEOUT");
  assert.ok(timedOut.duration_ms < 2_000);
  const exhausted = await run({ timeout: 10, resources: async () => ({ ...healthy, available_memory_mib: 700 }) });
  assert.equal(exhausted.reason, "GATE_AVAILABLE_MEMORY_BELOW_LIMIT");
  assert.ok(exhausted.duration_ms < 2_000);
});

test("a stale PASS report or a report with system/container failure cannot validate as PASS", async () => {
  const fixture = await buildEligibleReleaseFixture({ entries: [{ ordinal: 1, filename: "0001_fixture.sql", sha256: "1".repeat(64) }] });
  const failedSystem = { ...fixture.report, resources: { ...fixture.report.resources, baseline_runtime_failure: "GATE_PREEXISTING_TASK_CONTAINER", preexisting_temporary_container_ids: ["a".repeat(64)] } };
  assert.throws(() => validateReleaseGateReport(failedSystem), (error) => error.code === "GATE_REPORT_RESULT_INCONSISTENT");
  const failedStep = { ...fixture.report, steps: fixture.report.steps.map((step, index) => index === 0 ? { ...step, result: "FAIL", exit_code: 1, reason: "GATE_STEP_EXIT_NONZERO" } : step) };
  assert.throws(() => validateReleaseGateReport(failedStep), (error) => error.code === "GATE_REPORT_RESULT_INCONSISTENT");
  assert.equal(fixture.report.contract, RELEASE_GATE_REPORT_CONTRACT);
  assert.equal(fixture.report.plan_sha256, sha256(canonicalJson(fixture.plan)));
});

test("runner source contains awaited monitoring and final status/health comparison", async () => {
  const runner = await readFile(new URL("../scripts/release-gate-runner.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /setInterval\(async/);
  assert.match(runner, /await monitor/);
  assert.match(runner, /after\.status !== before\.status \|\| after\.health !== before\.health/);
  assert.match(runner, /GATE_PREEXISTING_TASK_CONTAINER/);
  assert.match(runner, /verifySecurityReport/);
});
