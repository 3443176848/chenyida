import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertRealReadonlyArguments, assertRealReadonlyEnvironment, REAL_READONLY_CONFIRMATION, REAL_READONLY_MODE, readonlyGuardInternals } from "../tools/selfhost-migration/readonly-environment-guard.mjs";
import { TOOL_VERSION } from "../tools/selfhost-migration/manifest.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const siteRoot = resolve(repoRoot, "chenyida_erp_site");
const appRoot = resolve(repoRoot, "chenyida_erp_app");
const snapshotScript = resolve(siteRoot, "scripts/readonly-sqlite-snapshot.py");
const fixtureScript = resolve(siteRoot, "scripts/readonly-inventory-synthetic-fixture.py");
const inventoryScript = resolve(siteRoot, "tools/selfhost-migration/readonly-inventory.py");
const cliScript = resolve(siteRoot, "tools/selfhost-migration/cli.mjs");
const roots = new Set();
const zeroCommit = "0".repeat(40);

async function taskRoot(label = "") {
  const root = await mkdtemp(resolve(tmpdir(), `chenyida_task04_readonly_test_${label}`));
  await chmod(root, 0o700);
  roots.add(root);
  return root;
}

function runSnapshot(root, source) {
  return spawnSync("python3", [snapshotScript, "--mode", "SYNTHETIC_READONLY_SNAPSHOT_TEST", "--confirm", "SYNTHETIC_READONLY_SNAPSHOT_TEST_ONLY", "--source", source, "--output-root", root, "--git-commit", zeroCommit, "--tool-version", TOOL_VERSION, "--no-materialize", "--no-files"], { encoding: "utf8" });
}

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

test("real readonly guards reject missing authority, database targets, D1, symlink, and backup paths", async () => {
  assert.throws(() => assertRealReadonlyEnvironment({ ERP_ENV: "production" }), { code: "READONLY_ENVIRONMENT_FORBIDDEN" });
  assert.throws(() => assertRealReadonlyEnvironment({ ERP_ENV: "readonly-inventory", ERP_D1_BINDING: "DB" }), { code: "READONLY_D1_BINDING_FORBIDDEN" });
  assert.throws(() => assertRealReadonlyEnvironment({ ERP_ENV: "readonly-inventory", DATABASE_URL: "postgresql://target" }), { code: "READONLY_TARGET_ENV_FORBIDDEN" });
  assert.throws(() => assertRealReadonlyEnvironment({ ERP_ENV: "readonly-inventory", PGPORT: "5432" }), { code: "READONLY_TARGET_ENV_FORBIDDEN" });

  const root = await taskRoot("guards_");
  const source = resolve(root, "fixture.sqlite3");
  execFileSync("python3", [fixtureScript, source, appRoot]);
  const link = resolve(root, "linked.sqlite3");
  await symlink(source, link);
  const symlinkRun = runSnapshot(root, link);
  assert.notEqual(symlinkRun.status, 0);
  assert.match(symlinkRun.stderr, /SNAPSHOT_SOURCE_SYMLINK_FORBIDDEN/);

  const backupRoot = await taskRoot("backup_case_");
  const backupDirectory = resolve(backupRoot, "backups");
  await mkdir(backupDirectory);
  const backupSource = resolve(backupDirectory, "fixture.sqlite3");
  execFileSync("python3", [fixtureScript, backupSource, appRoot]);
  const backupRun = runSnapshot(backupRoot, backupSource);
  assert.notEqual(backupRun.status, 0);
  for (const name of ["task04-source.snapshot.sqlite3", "snapshot-manifest.json"]) {
    await assert.rejects(() => readFile(resolve(backupRoot, name)));
  }
  const wrongRealSource = spawnSync("python3", [snapshotScript, "--mode", REAL_READONLY_MODE, "--confirm", "REAL_LOCAL_SQLITE_READONLY_SNAPSHOT", "--source", source, "--output-root", root, "--git-commit", "a".repeat(40), "--tool-version", TOOL_VERSION, "--service-pid", String(process.pid), "--service-database-path", "/opt/erp/chenyida_erp_app/data/erp.sqlite3", "--no-materialize", "--no-files"], { encoding: "utf8" });
  assert.notEqual(wrongRealSource.status, 0);
  assert.match(wrongRealSource.stderr, /SNAPSHOT_SOURCE_NOT_AUTHORIZED/);
});

test("online backup, manifest binding, redaction, opaque references, drift, aggregates, and cleanup", async () => {
  const root = await taskRoot("inventory_");
  const source = resolve(root, "fixture.sqlite3");
  execFileSync("python3", [fixtureScript, source, appRoot]);
  execFileSync("python3", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('alter table items add column drift_marker text'); c.commit(); c.close()", source]);
  const sourceBefore = readonlyGuardInternals.sha256File(source);
  const created = runSnapshot(root, source);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(readonlyGuardInternals.sha256File(source), sourceBefore);

  const snapshot = resolve(root, "task04-source.snapshot.sqlite3");
  const manifestPath = resolve(root, "snapshot-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.integrity_check, "ok");
  assert.match(manifest.snapshot_sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.source_path_digest, /^[0-9a-f]{64}$/);
  assert.equal(manifest.source_path_digest, createHash("sha256").update(source).digest("hex"));
  const output = resolve(root, "reports");
  await mkdir(output, { mode: 0o700 });
  const args = { mode: REAL_READONLY_MODE, confirm: REAL_READONLY_CONFIRMATION, "source-kind": "sqlite-snapshot", source: snapshot, "snapshot-manifest": manifestPath, "source-sha256": manifest.snapshot_sha256, "git-commit": zeroCommit, "tool-version": TOOL_VERSION, workspace: output, "no-materialize": "true", "no-files": "true" };
  assert.equal(assertRealReadonlyArguments(args, { environment: { ERP_ENV: "readonly-inventory" }, currentGitCommit: zeroCommit }).source, snapshot);
  assert.throws(() => assertRealReadonlyArguments({ ...args, "database-url": "postgresql://127.0.0.1/db" }, { environment: { ERP_ENV: "readonly-inventory" }, currentGitCommit: zeroCommit }), { code: "READONLY_TARGET_FORBIDDEN" });
  assert.throws(() => assertRealReadonlyArguments({ ...args, "no-materialize": "false" }, { environment: { ERP_ENV: "readonly-inventory" }, currentGitCommit: zeroCommit }), { code: "READONLY_NO_MATERIALIZE_REQUIRED" });
  assert.throws(() => assertRealReadonlyArguments({ ...args, "source-sha256": "f".repeat(64) }, { environment: { ERP_ENV: "readonly-inventory" }, currentGitCommit: zeroCommit }), { code: "READONLY_SOURCE_SHA_MISMATCH" });

  const inventory = spawnSync("python3", [inventoryScript, "--mode", REAL_READONLY_MODE, "--confirm", REAL_READONLY_CONFIRMATION, "--source", snapshot, "--snapshot-manifest", manifestPath, "--source-sha256", manifest.snapshot_sha256, "--git-commit", zeroCommit, "--tool-version", TOOL_VERSION, "--output", output, "--legacy-app-dir", appRoot, "--no-materialize", "--no-files"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(inventory.status, 0, inventory.stderr);
  const summary = JSON.parse(inventory.stdout);
  assert.equal(summary.state, "REAL_READONLY_INVENTORY_COMPLETE");
  assert.equal(summary.dry_run.target_connection, "NONE");
  assert.equal(summary.dry_run.materialization, "DISABLED");
  for (const key of ["invalid_quantity", "invalid_amount", "invalid_unit", "identity_issues"]) assert.ok(summary.dry_run[key] > 0, key);
  assert.ok(summary.dry_run.inventory_opening_plan.records > 0);
  assert.ok(summary.dry_run.finance_opening_plan.records > 0);

  const reportNames = ["source-schema-fingerprint.json", "source-target-aggregate-mapping.json", "real-readonly-data-quality.json", "migration-dry-run-aggregate.json", "manual-disposition-template.json"];
  const reports = await Promise.all(reportNames.map((name) => readFile(resolve(output, name), "utf8")));
  const serialized = reports.join("\n");
  for (const forbidden of ["SENSITIVE_PERSON", "SENSITIVE_CUSTOMER", "SENSITIVE_SUPPLIER", "SENSITIVE_MATERIAL", "SENSITIVE_SESSION_TOKEN", "SYN-SO-001", "13800000000", "/opt/erp/chenyida_erp_app/data/erp.sqlite3"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(serialized.includes("SELECT DISTINCT"), false);
  const schemaReport = JSON.parse(reports[0]);
  assert.ok(schemaReport.column_drift.some((item) => item.table === "items" && item.extra_columns.includes("drift_marker")));
  const dispositions = JSON.parse(reports[4]);
  assert.ok(dispositions.items.length > 0);
  assert.ok(dispositions.items.every((item) => /^ref_[0-9a-f]{32}$/.test(item.opaque_reference)));
  assert.ok(new Set(dispositions.items.map((item) => item.opaque_reference)).size < dispositions.items.length);
  assert.equal(JSON.stringify(dispositions).includes("source_id"), false);
  assert.equal(dispositions.task_local_key_persisted, false);

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  manifest.git_commit = currentCommit;
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  const cliOutput = resolve(root, "cli-reports");
  await mkdir(cliOutput, { mode: 0o700 });
  const cliRun = spawnSync("node", [cliScript, "--mode", REAL_READONLY_MODE, "--confirm", REAL_READONLY_CONFIRMATION, "--source-kind", "sqlite-snapshot", "--source", snapshot, "--snapshot-manifest", manifestPath, "--source-sha256", manifest.snapshot_sha256, "--git-commit", currentCommit, "--tool-version", TOOL_VERSION, "--workspace", cliOutput, "--no-materialize", "true", "--no-files", "true"], { cwd: siteRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: { PATH: process.env.PATH, ERP_ENV: "readonly-inventory" } });
  assert.equal(cliRun.status, 0, cliRun.stderr);
  assert.equal(JSON.parse(cliRun.stdout).state, "REAL_READONLY_INVENTORY_COMPLETE");
  const cliDispositions = JSON.parse(await readFile(resolve(cliOutput, "manual-disposition-template.json"), "utf8"));
  assert.notDeepEqual(new Set(cliDispositions.items.map((item) => item.opaque_reference)), new Set(dispositions.items.map((item) => item.opaque_reference)));
  await rm(snapshot);
  assert.throws(() => readonlyGuardInternals.sha256File(snapshot));
});

test("inventory source contains no free-text DISTINCT query and rejects incomplete invocation", async () => {
  const sourceCode = await readFile(inventoryScript, "utf8");
  assert.equal(/SELECT\s+DISTINCT/i.test(sourceCode), false);
  const result = spawnSync("python3", [inventoryScript, "--mode", REAL_READONLY_MODE], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
