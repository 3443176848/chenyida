import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateRuntimeServiceInventory, executeStep, officialExecutorCommand, publishReleaseGateArtifacts, resourceViolation, runReleaseGate } from "../scripts/release-gate-runner.mjs";
import {
  ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE,
  OFFICIAL_ISOLATED_CANDIDATE_RUNTIME_GUARD,
  OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD,
  PRE_DEPLOY_RUNTIME_GUARD_MODE,
  assertPreDeployRuntimeStable,
} from "../scripts/release-lifecycle-contract.mjs";
import { RELEASE_GATE_REPORT_CONTRACT, buildMigrationAllowlist, canonicalJson, migrationAllowlistDigest, sha256, validateOfficialReleaseGatePlan, validateOfficialTestRuntimePolicy, validateReleaseGateReport, writePreparedJsonArtifact } from "../scripts/release-manifest-contract.mjs";
import {
  RELEASE_TEST_INVENTORY_NOT_APPLICABLE,
  RELEASE_TEST_INVENTORY_REQUIRED,
  RELEASE_TEST_INVENTORY_TOTAL,
  RELEASE_TYPESCRIPT_CONFIGS,
  validateReleaseTestInventoryDocument,
  verifyTrustedPostgresRuntimeCatalog,
  verifyReleaseTypeScriptConfigSet,
} from "../scripts/release-test-inventory.mjs";
import { parseStrictJson } from "../scripts/release-identity-contract.mjs";
import { clusterSha256 } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import { buildEligibleReleaseFixture, initializeReleaseArtifactRoot } from "./release-gate-fixture.mjs";

const rootCapable = typeof process.getuid === "function" && process.getuid() === 0;

function preDeployRuntimeFixture() {
  const common = {
    restart_count: 0,
    oom_killed: false,
    running: true,
    restarting: false,
    paused: false,
    dead: false,
    status: "running",
  };
  return [
    { ...common, service: "caddy", container_id: "1".repeat(64), image_id: `sha256:${"a".repeat(64)}`, image_reference: "caddy:2.10-alpine", health: "none", healthcheck_present: false },
    { ...common, service: "postgres", container_id: "2".repeat(64), image_id: `sha256:${"b".repeat(64)}`, image_reference: "postgres:17-bookworm", health: "healthy", healthcheck_present: true },
    { ...common, service: "web", container_id: "3".repeat(64), image_id: `sha256:${"c".repeat(64)}`, image_reference: "chenyida-erp-parallel-web", health: "healthy", healthcheck_present: true },
    { ...common, service: "worker", container_id: "4".repeat(64), image_id: `sha256:${"d".repeat(64)}`, image_reference: "chenyida-erp-parallel-worker", health: "none", healthcheck_present: false },
  ];
}

test("versioned repository release plan is the exact fail-closed official plan", async () => {
  const raw = await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8");
  const value = validateOfficialReleaseGatePlan(JSON.parse(raw));
  assert.equal(value.resource_policy.compose_parallel_limit, 1);
  assert.equal(value.resource_policy.max_temporary_containers, 1);
  assert.deepEqual(value.runtime_guard, OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD);
  assert.deepEqual(value.candidate_runtime_guard, OFFICIAL_ISOLATED_CANDIDATE_RUNTIME_GUARD);
  assert.equal(value.runtime_guard.mode, PRE_DEPLOY_RUNTIME_GUARD_MODE);
  assert.equal(value.candidate_runtime_guard.mode, ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE);
  assert.equal(value.steps.length, 19);
  assert.ok(value.steps.every((step) => step.applicability === "REQUIRED" && step.timeout_seconds <= 14400));
  assert.equal(value.steps.find((step) => step.id === "supervisor-python-contracts").executor_id, "PYTHON_CANDIDATE_TEST");
  assert.ok(["release-contracts", "credential-scan", "build-and-node-source-tests", "browser-end-to-end-tests", "special-posix-tests", "all-typescript-configs", "eslint"].every((id) => value.steps.find((step) => step.id === id)?.executor_id === "NODE_CANDIDATE_TEST"));
  assert.equal(value.steps.find((step) => step.id === "postgres-regression-tests")?.executor_id, "POSTGRES_CANDIDATE_TEST");
  assert.equal(value.steps.find((step) => step.id === "container-runtime-policy")?.executor_id, "CONTAINER_RUNTIME_TEST");
  assert.ok(value.steps.filter((step) => step.id.startsWith("python-")).every((step) => step.executor_id === "PYTHON_CANDIDATE_TEST"));
  assert.ok(value.steps.every((step) => !("command" in step)));
  assert.equal(officialExecutorCommand(value.steps[0], "/trusted/supervisor")[0], "/trusted/supervisor/scripts/run-release-node-sandbox.sh");
  assert.equal(officialExecutorCommand(value.steps[4], "/trusted/supervisor")[0], "/trusted/supervisor/scripts/run-release-postgres-regression-tests.sh");
  assert.deepEqual(officialExecutorCommand(value.steps[6], "/trusted/supervisor"), ["/trusted/supervisor/scripts/run-release-node-sandbox.sh", "special-posix"]);
  assert.deepEqual(officialExecutorCommand(value.steps[15], "/trusted/supervisor"), ["/trusted/supervisor/scripts/run-container-runtime-policy-test.sh"]);
  assert.throws(() => officialExecutorCommand({ executor_id: "PATH", action: "../../bin/sh" }, "/trusted/supervisor"), (error) => error.code === "GATE_EXECUTOR_ACTION_INVALID");
});

test("versioned test inventory accounts for every top-level test and only excludes explicit legacy or alias evidence", async () => {
  const raw = await readFile(new URL("../release/release-test-inventory-v1.json", import.meta.url), "utf8");
  const inventory = validateReleaseTestInventoryDocument(JSON.parse(raw));
  assert.equal(inventory.total_tests, RELEASE_TEST_INVENTORY_TOTAL);
  assert.equal(inventory.required_tests, RELEASE_TEST_INVENTORY_REQUIRED);
  assert.equal(inventory.not_applicable_tests, RELEASE_TEST_INVENTORY_NOT_APPLICABLE);
  assert.deepEqual(inventory.category_counts, { BROWSER: 6, HISTORICAL_D1_SITES: 22, POSTGRES: 84, POSTGRES_ALIAS: 2, PURE_NODE: 121, RELEASE_CONTRACT: 6, SPECIAL_HARNESS: 7 });
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

test("trusted runtime policy rejects a semantically valid re-signed catalog replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-runtime-catalog-anchor-"));
  try {
    const policyRaw = await readFile(new URL("../release/test-runtime-policy-v1.json", import.meta.url), "utf8");
    const policy = validateOfficialTestRuntimePolicy(parseStrictJson(policyRaw), policyRaw);
    const source = parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-compiled-catalog-v1.json", import.meta.url), "utf8"), 512 * 1024);
    const altered = structuredClone(source);
    altered.catalog.routines.find((item) => item.extension === null).definition_sha256 = "f".repeat(64);
    altered.catalog_sha256 = clusterSha256(altered.catalog);
    const { artifact_sha256: ignored, ...body } = altered;
    void ignored;
    altered.artifact_sha256 = clusterSha256(body);
    const target = path.join(root, policy.postgres_runtime_catalog.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(altered, null, 2)}\n`, { mode: 0o644 });
    await assert.rejects(verifyTrustedPostgresRuntimeCatalog({ root, policy }), (error) => error.code === "RELEASE_POSTGRES_RUNTIME_CATALOG_SHA256_MISMATCH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release typecheck inventory pins all 38 top-level configs and rejects set drift", async () => {
  const siteRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const actual = await verifyReleaseTypeScriptConfigSet({ root: siteRoot });
  assert.equal(actual.length, 38);
  assert.deepEqual(actual.map((entry) => entry.path), RELEASE_TYPESCRIPT_CONFIGS);

  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-release-typecheck-inventory-"));
  try {
    await Promise.all(RELEASE_TYPESCRIPT_CONFIGS.map((config) => writeFile(path.join(root, config), "{}\n")));
    assert.equal((await verifyReleaseTypeScriptConfigSet({ root })).length, 38);
    await writeFile(path.join(root, "tsconfig.unreviewed.json"), "{}\n");
    await assert.rejects(verifyReleaseTypeScriptConfigSet({ root }), (error) => error.code === "RELEASE_TYPESCRIPT_CONFIG_SET_MISMATCH");
    await rm(path.join(root, "tsconfig.unreviewed.json"), { force: true });
    await rm(path.join(root, RELEASE_TYPESCRIPT_CONFIGS[0]), { force: true });
    await assert.rejects(verifyReleaseTypeScriptConfigSet({ root }), (error) => error.code === "RELEASE_TYPESCRIPT_CONFIG_SET_MISMATCH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operator wrappers use a fixed real lock, trusted artifact root and sanitized child environment", async () => {
  const wrapper = await readFile(new URL("../scripts/run-release-gate.sh", import.meta.url), "utf8");
  const creator = await readFile(new URL("../scripts/create-release-manifest.sh", import.meta.url), "utf8");
  const imageEvidence = await readFile(new URL("../scripts/create-release-image-evidence.sh", import.meta.url), "utf8");
  const identity = await readFile(new URL("../scripts/write-release-identity.sh", import.meta.url), "utf8");
  const lockHelper = await readFile(new URL("../scripts/release-gate-lock.sh", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/release-gate-runner.mjs", import.meta.url), "utf8");
  const nodeSandbox = await readFile(new URL("../scripts/run-release-node-sandbox.sh", import.meta.url), "utf8");
  const postgresSandbox = await readFile(new URL("../scripts/run-release-postgres-regression-tests.sh", import.meta.url), "utf8");
  const migrationSandbox = await readFile(new URL("../scripts/run-release-migration-postgres-test.sh", import.meta.url), "utf8");
  const recoverySandbox = await readFile(new URL("../scripts/run-backup-recovery-postgres-test.sh", import.meta.url), "utf8");
  const postgresRunner = await readFile(new URL("../scripts/release-postgres-regression-runner.mjs", import.meta.url), "utf8");
  const pythonSandbox = await readFile(new URL("../scripts/run-python-baseline-test.sh", import.meta.url), "utf8");
  const composeSandbox = await readFile(new URL("../scripts/run-compose-config-test.sh", import.meta.url), "utf8");
  const runtimePolicyTest = await readFile(new URL("../scripts/container-runtime-policy-test.py", import.meta.url), "utf8");
  const releaseMigrationTest = await readFile(new URL("./selfhost-release-migration-postgres.sh", import.meta.url), "utf8");
  const controlledMigrationDriver = await readFile(new URL("./selfhost-release-migration-controlled-driver.ts", import.meta.url), "utf8");
  for (const script of [wrapper, creator, imageEvidence, identity]) {
    assert.match(script, /release-gate-lock\.sh/);
    assert.match(script, /acquire_chenyida_release_gate_lock/);
    assert.match(script, /0:0:440:1/);
  }
  assert.match(lockHelper, /ERP_RELEASE_GATE_LOCK_FD/);
  assert.match(lockHelper, /inherited global release gate lock is not held/);
  assert.match(lockHelper, /flock -n -E 75/);
  assert.match(wrapper, /release gate must be launched by the installed supervisor/);
  assert.match(creator, /release manifest creation must be launched by the installed supervisor/);
  assert.match(wrapper, /env -i PATH=/);
  assert.match(wrapper, /buildMigrationAllowlist\(process\.argv\[1\]\)/);
  assert.match(wrapper, /"\$REPOSITORY_ROOT\/chenyida_erp_site\/drizzle-postgres"/);
  assert.doesNotMatch(wrapper, /buildMigrationAllowlist\("\.\/drizzle-postgres"\)/);
  assert.match(runner, /GATE_GLOBAL_LOCK_NOT_HELD/);
  assert.match(runner, /safeCommandEnvironment/);
  assert.match(runner, /OFFICIAL_EXECUTOR_COMMANDS/);
  assert.match(runner, /\.RepoDigests/);
  assert.match(runner, /expectedRepoDigest/);
  assert.match(runner, /expectedConfigDigest/);
  assert.equal((runner.match(/\{\{with \(index \.State \\"Health\\"\)\}\}/g) || []).length, 2);
  assert.doesNotMatch(runner, /\{\{if \.State\.Health\}\}/);
  assert.equal((runner.match(/\{\{if \.Config\.Healthcheck\}\}/g) || []).length, 2);
  assert.match(runner, /runtimeServiceInventory/);
  assert.match(runner, /assertPreDeployRuntimeStable/);
  assert.match(runner, /GATE_REQUIRED_RUNTIME_CHANGED/);
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
  assert.match(composeSandbox, /--profile "\*"/);
  assert.match(composeSandbox, /for deployment_class in uat production/);
  assert.match(composeSandbox, /container-runtime-policy\.py validate/);
  assert.match(composeSandbox, /--ro-bind "\$SUPERVISOR_SITE_ROOT" \/supervisor/);
  for (const forbidden of ["DATABASE_URL", "ERP_MIGRATION_DATABASE_URL", "ERP_SETUP_TOKEN", "POSTGRES_PASSWORD", "ERP_ADMIN_PASSWORD"]) {
    assert.doesNotMatch(composeSandbox, new RegExp(forbidden));
  }
  assert.match(runtimePolicyTest, /chenyida\.erp\.container-runtime-policy-test/);
  assert.match(runtimePolicyTest, /max_containers=1/);
  assert.match(runtimePolicyTest, /TASK_VOLUME_INVENTORY_FAILED/);
  assert.match(runtimePolicyTest, /POSTGRES_PASSWORD_FILE/);
  assert.match(runtimePolicyTest, /POSTGRES_TABLESPACE_NAMESPACE_WRITE_SUCCEEDED/);
  assert.match(runtimePolicyTest, /SIBLING_SECRET_VISIBLE/);
  assert.match(runtimePolicyTest, /POSTGRES_WARM_DATA_COUNT_MISMATCH/);
  assert.match(runtimePolicyTest, /CADDY_WARM_LISTENER_POLICY_MISMATCH/);
  assert.doesNotMatch(runtimePolicyTest, /"--privileged"/);
  const controlledMigrationFunction = releaseMigrationTest.match(/run_controlled\(\) \{[\s\S]*?\n\}\n\n# Empty controlled target/)?.[0] || "";
  assert.notEqual(controlledMigrationFunction, "");
  assert.match(controlledMigrationFunction, /TEST_RELEASE_MIGRATION_DATABASE_URL=/);
  assert.match(controlledMigrationFunction, /ERP_ENV=test ERP_DEPLOYMENT_CLASS=test/);
  assert.match(controlledMigrationFunction, /ERP_MIGRATION_TEST_HARNESS=CONTROLLED_RELEASE_MIGRATION/);
  assert.match(controlledMigrationFunction, /selfhost-release-migration-controlled-driver\.ts/);
  for (const forbidden of ["DATABASE_URL", "ERP_MIGRATION_DATABASE_URL", "ERP_SETUP_TOKEN", "POSTGRES_PASSWORD", "ERP_ADMIN_PASSWORD"]) {
    assert.doesNotMatch(controlledMigrationFunction, new RegExp(`(?:^|[ \\t])${forbidden}=`, "m"));
  }
  assert.match(controlledMigrationDriver, /ERP_ENV !== "test"/);
  assert.match(controlledMigrationDriver, /ERP_DEPLOYMENT_CLASS !== "test"/);
  assert.match(controlledMigrationDriver, /assertIsolatedDatabaseTarget/);
  assert.match(controlledMigrationDriver, /cyd-release-migration-postgres/);
  assert.match(controlledMigrationDriver, /runMigrationWorkflow/);
  assert.doesNotMatch(controlledMigrationDriver, /runtimeConfig\(|getPool\(/);
  assert.match(nodeSandbox, /-v "\$NODE_MODULES:\/workspace\/chenyida_erp_site\/node_modules:ro"/);
  assert.doesNotMatch(nodeSandbox, /\$NODE_MODULES:\/supervisor\/node_modules/);
  assert.match(nodeSandbox, /--user "\$container_user"/);
  assert.match(nodeSandbox, /chown -R 0:0 "\$SNAPSHOT"/);
  assert.match(nodeSandbox, /CONTAINER_USER=0:0/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs run NODE_RELEASE_CONTRACT/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs run NODE_SOURCE/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs run SPECIAL_POSIX/);
  assert.match(nodeSandbox, /release-test-inventory\.mjs typecheck/);
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
  assert.match(postgresSandbox, /-c max_locks_per_transaction=1024/);
  assert.match(postgresSandbox, /git_candidate archive --format=tar/);
  for (const script of [postgresSandbox, migrationSandbox, recoverySandbox]) {
    assert.match(script, /mkdir -m 0555 "\$SITE_ROOT\/node_modules"/);
    assert.ok(script.indexOf('mkdir -m 0555 "$SITE_ROOT/node_modules"') < script.indexOf('-v "$NODE_MODULES:/workspace/node_modules:ro"'));
  }
  assert.match(recoverySandbox, /selfhost-postgresql-cluster-recovery-postgres\.sh/);
  assert.match(recoverySandbox, /TRUSTED_TEST_ROOT="\$SUPERVISOR_SITE_ROOT\/tests"/);
  assert.match(recoverySandbox, /-v "\$TRUSTED_TEST_ROOT:\/supervisor-tests:ro"/);
  assert.match(recoverySandbox, /\/supervisor-tests\/selfhost-backup-recovery-postgres\.sh; \/supervisor-tests\/selfhost-postgresql-cluster-recovery-postgres\.sh/);
  assert.doesNotMatch(recoverySandbox, /\/workspace\/tests\/selfhost-(?:backup|postgresql-cluster)-recovery-postgres\.sh/);
  assert.match(recoverySandbox, /--tmpfs \/tmp:rw,exec,nosuid,nodev,size=1280m/);
  assert.equal((recoverySandbox.match(/POSTGRES_ID=\$\(\/usr\/bin\/docker create/g) || []).length, 1);
  assert.match(postgresSandbox, /if \[ "\$\{ERP_RELEASE_POSTGRES_CONTAINER_MODE:-\}" = YES \]; then\s+container_main\s+exit 0\s+fi/);
  assert.ok(postgresSandbox.indexOf('remove_task_container "$NODE_ID" "$NODE_CONTAINER"') < postgresSandbox.indexOf("POSTGRES_ID=$(/usr/bin/docker create"));
  assert.match(postgresRunner, /EXPECTED_POSTGRES_TESTS = 84/);
  assert.match(postgresRunner, /migrations\.length !== 46/);
  assert.match(postgresRunner, /0046_runtime_lock_privilege_boundary\.sql/);
  assert.match(postgresRunner, /harness === "POSTGRES_REGRESSION"/);
  assert.match(postgresRunner, /verifyCandidateRuntimePrivilegeCatalog/);
  assert.match(postgresRunner, /postgres_runtime_catalog\.file_sha256/);
  assert.match(postgresSandbox, /\/supervisor\/tests\/selfhost-postgresql-runtime-privilege-catalog-postgres\.sh/);
  assert.match(postgresSandbox, /POSTGRES RUNTIME PRIVILEGE CATALOG PASS/);
  assert.match(postgresRunner, /postgresql:\/\/chenyida_erp:x@postgres:5432\/chenyida_erp/);
  assert.match(postgresRunner, /create role chenyida_erp login nosuperuser nocreatedb nocreaterole noinherit/);
  assert.match(postgresRunner, /owner: "chenyida_erp"/);
  assert.match(postgresRunner, /const childEnvironment =|function childEnvironment/);
  assert.doesNotMatch(postgresRunner, /env:\s*process\.env/);
  assert.doesNotMatch(postgresRunner, /\.\.\.process\.env/);
  assert.match(postgresRunner, /summary\.skipped !== 0 \|\| summary\.todo !== 0/);
  assert.match(postgresRunner, /for \(const head of \[17, 36, 44, 46\]\)/);
  assert.match(postgresRunner, /verifyReleaseTestInventory/);
  assert.match(wrapper, /\.release-gate-report\.prepared\.json/);
  assert.match(creator, /\.release-manifest\.\$AUTHORIZATION_SHA256\.prepared\.json/);
  assert.ok(wrapper.indexOf("release-gate-runner.mjs\" commit") > wrapper.indexOf("candidate image changed during release gate"));
  assert.ok(creator.indexOf("publish-manifest") > creator.indexOf("candidate image changed during manifest creation"));
  assert.doesNotMatch(creator, /--output "\$ARTIFACT_ROOT\/release-manifest\.json"/);
  const launcher = await readFile(new URL("../scripts/release-supervisor-launcher.py", import.meta.url), "utf8");
  assert.equal((launcher.match(/--no-textconv/g) || []).length, 2);
});

test("release lock helper rejects an inherited but unlocked descriptor and accepts an inherited held lock", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "cyd-release-inherited-lock-"));
  const lock = path.join(fixture, "release-gate.lock");
  const stateRoot = path.join(fixture, "postgresql-runtime-privilege-operator");
  const scripts = path.resolve(new URL("../scripts", import.meta.url).pathname);
  let handle;
  try {
    await writeFile(lock, "", { mode: 0o600 });
    await chmod(lock, 0o600);
    handle = await open(lock, "r+");
    const environment = {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LC_ALL: "C",
      NODE_ENV: "test",
      ERP_RELEASE_GATE_LOCK_FILE: lock,
      ERP_RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT: stateRoot,
      ERP_RELEASE_SUPERVISOR_LAUNCHED: "YES",
      ERP_RELEASE_GATE_LOCK_HELD: "YES",
      ERP_RELEASE_GATE_LOCK_FD: "9",
    };
    const stdio = ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", handle.fd];
    const unlocked = spawnSync("/bin/sh", ["-ceu", 'cd "$1"; . ./release-gate-lock.sh; acquire_chenyida_release_gate_lock', "sh", scripts], { env: environment, stdio, encoding: "utf8" });
    assert.notEqual(unlocked.status, 0);
    assert.match(unlocked.stderr, /inherited global release gate lock is not held/);
    await handle.close();
    handle = null;

    const held = spawnSync("/bin/sh", ["-ceu", 'exec 9<>"$1"; flock -n 9; cd "$2"; . ./release-gate-lock.sh; acquire_chenyida_release_gate_lock', "sh", lock, scripts], { env: environment, encoding: "utf8" });
    assert.equal(held.status, 0, held.stderr);
  } finally {
    await handle?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});

test("installed supervisor layout loads trusted code while hashing the explicit candidate migration directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-installed-migration-layout-"));
  try {
    const bundleSite = path.join(root, "bundle", "chenyida_erp_site");
    const bundleScripts = path.join(bundleSite, "scripts");
    const candidateMigrations = path.join(root, "candidate", "chenyida_erp_site", "drizzle-postgres");
    await mkdir(bundleScripts, { recursive: true });
    await mkdir(candidateMigrations, { recursive: true });
    for (const file of ["release-manifest-contract.mjs", "release-identity-contract.mjs", "release-image-evidence-contract.mjs", "release-lifecycle-contract.mjs"]) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(bundleScripts, file));
    }
    await writeFile(path.join(candidateMigrations, "0001_fixture.sql"), "select 1;\n");
    await assert.rejects(readFile(path.join(bundleSite, "drizzle-postgres", "0001_fixture.sql")), (error) => error.code === "ENOENT");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", 'import {buildMigrationAllowlist,migrationAllowlistDigest} from "./scripts/release-manifest-contract.mjs";process.stdout.write(migrationAllowlistDigest(await buildMigrationAllowlist(process.argv[1])))', candidateMigrations], {
      cwd: bundleSite,
      encoding: "utf8",
      env: { PATH: process.env.PATH, LC_ALL: "C", LANG: "C", TZ: "UTC" },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, migrationAllowlistDigest(await buildMigrationAllowlist(candidateMigrations)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("candidate image builder uses an exact Git archive, pinned inputs and an ephemeral loopback registry", async () => {
  const builderPath = new URL("../scripts/build-release-candidate-images.sh", import.meta.url);
  const builder = await readFile(builderPath, "utf8");
  const producer = await readFile(new URL("../scripts/release-candidate-build-producer.mjs", import.meta.url), "utf8");
  const syntax = spawnSync("/bin/sh", ["-n", builderPath.pathname], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(builder, /git_candidate archive --format=tar "\$GIT_COMMIT" chenyida_erp_site/);
  assert.match(builder, /DOCKERFILE_FRONTEND='docker\.io\/docker\/dockerfile:1\.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720'/);
  assert.match(builder, /NODE_IMAGE='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'/);
  assert.match(builder, /RUNTIME_BASE_IMAGE='cgr\.dev\/chainguard\/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed'/);
  assert.match(builder, /REGISTRY_IMAGE='registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373'/);
  assert.match(builder, /docker buildx build --builder default --load --pull=false --provenance=false --platform linux\/amd64/);
  assert.match(builder, /docker buildx inspect default --bootstrap=false/);
  assert.match(builder, /--build-arg "ERP_BUILD_VERSION=\$PACKAGE_VERSION" --build-arg "ERP_BUILD_REVISION=\$GIT_COMMIT"/);
  assert.match(builder, /--publish 127\.0\.0\.1::5000/);
  assert.match(builder, /REGISTRY_WEB_TAG="127\.0\.0\.1:\$REGISTRY_PORT\/chenyida-erp\/web:\$GIT_COMMIT"/);
  assert.match(builder, /docker pull "\$WEB_IMAGE_REF"/);
  assert.match(builder, /rm -rf -- "\$REGISTRY_DATA"/);
  assert.match(builder, /chmod 0400 "\$INPUT_ROOT\/build-base\.inspect\.json" "\$INPUT_ROOT\/runtime-base\.inspect\.json" "\$INPUT_ROOT\/registry\.inspect\.json" "\$INPUT_ROOT\/web\.inspect\.json" "\$INPUT_ROOT\/worker\.inspect\.json"/);
  assert.match(builder, /--build-base-inspect \/input\/build-base\.inspect\.json --runtime-base-inspect \/input\/runtime-base\.inspect\.json/);
  assert.doesNotMatch(builder, /"\$INPUT_ROOT"\/\*\.json/);
  assert.ok(builder.indexOf('remove_container\n[ -d "$REGISTRY_DATA" ]') < builder.indexOf('rm -rf -- "$REGISTRY_DATA"'));
  assert.ok(builder.indexOf('rm -rf -- "$REGISTRY_DATA"') < builder.indexOf('[ "$(/usr/bin/docker image inspect --format \'{{.Id}}\' "$WEB_IMAGE_REF")"'));
  assert.match(builder, /--network none --read-only --cap-drop ALL --security-opt no-new-privileges/);
  assert.match(producer, /CANDIDATE_BUILD_PRODUCER_PATH_INVALID/);
  assert.match(producer, /context: "GIT_ARCHIVE"/);
  assert.match(producer, /dependency_network: "PUBLIC_NPM_LOCKFILE_INTEGRITY"/);
  assert.match(producer, /runtime_dependency_network: "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGE"/);
  assert.doesNotMatch(builder, /\blatest\b|ghcr\.io\/3443176848/);
  assert.doesNotMatch(builder, /\/usr\/bin\/docker run\b/);
});

test("release shell wrappers reject replace refs and normalize Git archive modes", async () => {
  const files = [
    "build-release-candidate-images.sh",
    "create-release-image-evidence.sh",
    "create-release-manifest.sh",
    "run-backup-recovery-postgres-test.sh",
    "run-compose-config-test.sh",
    "run-container-runtime-policy-test.sh",
    "run-python-baseline-test.sh",
    "run-release-gate.sh",
    "run-release-migration-postgres-test.sh",
    "run-release-node-sandbox.sh",
    "run-release-postgres-regression-tests.sh",
    "run-source-diff-check.sh",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.match(source, /GIT_NO_REPLACE_OBJECTS=1/, `${file} must disable Git replacement objects`);
    assert.match(source, /-c core\.useReplaceRefs=false/, `${file} must disable replace refs in Git configuration`);
    assert.match(source, /-c tar\.umask=0022/, `${file} must produce non-group-writable Git archives`);
    assert.doesNotMatch(source, /\/usr\/bin\/git -C /, `${file} must not bypass the sanitized Git invocation`);
  }
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
  assert.match(producer, /\^blobs\\\/sha256\\\/\(\[0-9a-f\]\{64\}\)\$/);
  assert.match(producer, /archive configuration blob digest mismatch/);
  assert.match(producer, /--network none --read-only --cap-drop ALL --security-opt no-new-privileges/);
  assert.match(producer, /--input \/input\/image\.tar/);
  assert.match(producer, /--scanners vuln --pkg-types os,library --list-all-pkgs/);
  assert.match(producer, /--severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL/);
  assert.match(producer, /--skip-db-update --skip-java-db-update --skip-check-update --skip-vex-repo-update --skip-version-check/);
  assert.match(producer, /--offline-scan --disable-telemetry --no-progress --config \/dev\/null --ignorefile \/dev\/null/);
  assert.match(producer, /hash-database-tree/);
  assert.match(producer, /rm -f -- "\$archive"/);
  assert.doesNotMatch(producer, /\/var\/run\/docker\.sock/);
  assert.doesNotMatch(producer, /--ignore-unfixed|--vex|--ignore-policy|--skip-files|--skip-dirs/);
});

test("release wrappers never pull implicitly when creating task containers", async () => {
  const files = [
    "build-release-candidate-images.sh",
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
    "build-release-candidate-images.sh",
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
  const plan = validateOfficialReleaseGatePlan(JSON.parse(await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8")));
  const base = { available_memory_mib: 2048, swap_used_mib: 100, swap_used_percent: 10, root_free_gib: 30, load_1m: 0.5, temporary_containers: 0 };
  const state = { swapSamples: [], aggregate: { maximum_swap_growth_mib_60s: 0 } };
  assert.equal(resourceViolation(base, plan.resource_policy, state, 0), null);
  assert.equal(resourceViolation({ ...base, swap_used_mib: 357 }, plan.resource_policy, state, 59_000), "GATE_SWAP_GROWTH_ABOVE_LIMIT");
  assert.equal(state.aggregate.maximum_swap_growth_mib_60s, 257);
  assert.equal(resourceViolation({ ...base, swap_used_percent: 80.1 }, plan.resource_policy, { swapSamples: [], aggregate: { maximum_swap_growth_mib_60s: 0 } }, 0), "GATE_SWAP_ABOVE_LIMIT");
});

test("pre-deploy runtime guard accepts stable legacy Worker and rejects every identity or state transition", () => {
  const baseline = preDeployRuntimeFixture();
  assert.equal(evaluateRuntimeServiceInventory(baseline, OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD).failure, null);
  assert.deepEqual(assertPreDeployRuntimeStable(baseline, structuredClone(baseline), OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD), baseline);

  for (const current of [
    baseline.slice(0, 3),
    [...baseline, { ...baseline[3], service: "extra", container_id: "5".repeat(64) }],
    baseline.map((entry) => entry.service === "worker" ? { ...entry, health: "unhealthy" } : entry),
    baseline.map((entry) => entry.service === "worker" ? { ...entry, healthcheck_present: true } : entry),
    baseline.map((entry) => entry.service === "web" ? { ...entry, health: "none", healthcheck_present: false } : entry),
    baseline.map((entry) => entry.service === "postgres" ? { ...entry, restart_count: 1 } : entry),
    baseline.map((entry) => entry.service === "caddy" ? { ...entry, oom_killed: true } : entry),
  ]) {
    assert.notEqual(evaluateRuntimeServiceInventory(current, OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD).failure, null);
  }

  const stableButDrifted = [
    baseline.map((entry) => entry.service === "worker" ? { ...entry, health: "healthy", healthcheck_present: true } : entry),
    baseline.map((entry) => entry.service === "worker" ? { ...entry, container_id: "5".repeat(64) } : entry),
    baseline.map((entry) => entry.service === "worker" ? { ...entry, image_id: `sha256:${"e".repeat(64)}` } : entry),
    baseline.map((entry) => entry.service === "worker" ? { ...entry, image_reference: "chenyida-erp-parallel-worker:changed" } : entry),
  ];
  for (const current of stableButDrifted) {
    assert.equal(evaluateRuntimeServiceInventory(current, OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD).failure, null);
    assert.throws(
      () => assertPreDeployRuntimeStable(baseline, current, OFFICIAL_PRE_DEPLOY_RUNTIME_GUARD),
      (error) => error.code === "PRE_DEPLOY_RUNTIME_DRIFT",
    );
  }
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
  const unhealthyFinal = fixture.report.resources.final_runtime_services.map((service) => service.service === "worker" ? { ...service, health: "unhealthy" } : service);
  const recordedFailure = { ...fixture.report, result: "FAIL", resources: { ...fixture.report.resources, final_runtime_services: unhealthyFinal, runtime_transition_failure: "GATE_REQUIRED_RUNTIME_STATE_INVALID", final_runtime_failure: "GATE_REQUIRED_RUNTIME_STATE_INVALID" } };
  assert.deepEqual(validateReleaseGateReport(recordedFailure), recordedFailure);
  assert.throws(() => validateReleaseGateReport({ ...recordedFailure, resources: { ...recordedFailure.resources, runtime_transition_failure: null, final_runtime_failure: null } }), (error) => error.code === "GATE_REPORT_FAILURE_REASON_MISSING");
  assert.equal(fixture.report.contract, RELEASE_GATE_REPORT_CONTRACT);
  assert.equal(fixture.report.plan_sha256, sha256(canonicalJson(fixture.plan)));
});

test("runner source contains awaited monitoring and final status/health comparison", async () => {
  const runner = await readFile(new URL("../scripts/release-gate-runner.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /setInterval\(async/);
  assert.match(runner, /await monitor/);
  assert.match(runner, /canonicalJson\(after\) !== canonicalJson\(before\)/);
  assert.match(runner, /assertPreDeployRuntimeStable/);
  assert.match(runner, /GATE_PREEXISTING_TASK_CONTAINER/);
  assert.match(runner, /verifySecurityReport/);
});
