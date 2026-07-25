import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertMigrationEnvironment, assertSourcePath, assertWorkspace, parseSafePostgresUrl, assertEmptyFileTarget } from "../tools/selfhost-migration/environment-guard.mjs";
import { writeSyntheticD1Export, writeSyntheticSqlite } from "../tools/selfhost-migration/synthetic-fixtures.mjs";
import { inspectSqliteSource } from "../tools/selfhost-migration/source-sqlite.mjs";
import { inspectD1ExportSource } from "../tools/selfhost-migration/source-d1-export.mjs";
import { validateAndPlan, issueSummary } from "../tools/selfhost-migration/validator.mjs";
import { registryDigest } from "../tools/selfhost-migration/mapping-registry.mjs";
import { createManifest, validateManifest, migrationChecksums } from "../tools/selfhost-migration/manifest.mjs";
import { CheckpointStore } from "../tools/selfhost-migration/checkpoint.mjs";
import { InMemoryIdMap } from "../tools/selfhost-migration/id-map.mjs";
import { executeDryRun, executionInputDigest } from "../tools/selfhost-migration/executor.mjs";
import { buildSafeReport } from "../tools/selfhost-migration/report.mjs";

const env = { ERP_ENV: "test" };
const siteRoot = resolve(import.meta.dirname, "..");
const temporaryRoots = new Set();

async function tempRoot(label = "case") {
  const path = await mkdtemp(resolve(tmpdir(), `chenyida_${label}_migration_test_`));
  temporaryRoots.add(path);
  return path;
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((path) => rm(path, { recursive: true, force: true })));
  temporaryRoots.clear();
});

test("environment guard rejects production, remote targets, repository paths, and non-empty file targets", async () => {
  assert.throws(() => assertMigrationEnvironment({ ERP_ENV: "production" }), { code: "MIGRATION_ENVIRONMENT_FORBIDDEN" });
  assert.throws(() => assertMigrationEnvironment({ ERP_ENV: "test", ERP_D1_BINDING: "DB" }), { code: "MIGRATION_D1_BINDING_FORBIDDEN" });
  assert.throws(() => parseSafePostgresUrl("postgresql://u:p@example.invalid/example_migration_test"), { code: "MIGRATION_REMOTE_DATABASE_FORBIDDEN" });
  assert.throws(() => parseSafePostgresUrl("postgresql://u:p@127.0.0.1/example"), { code: "MIGRATION_DATABASE_MARKER_REQUIRED" });
  assert.throws(() => parseSafePostgresUrl("postgresql://u:p@127.0.0.1/example_migration_test?host=example.invalid"), { code: "MIGRATION_DATABASE_URL_OPTIONS_FORBIDDEN" });
  assert.throws(() => assertSourcePath(resolve(siteRoot, "../chenyida_erp_app/data/erp.sqlite3"), "sqlite"), { code: "MIGRATION_REAL_PATH_FORBIDDEN" });
  const root = await tempRoot("guard"); const files = resolve(root, "files"); await mkdir(files); await writeFile(resolve(files, "occupied"), "x");
  assert.throws(() => assertEmptyFileTarget(files), { code: "MIGRATION_FILE_TARGET_NOT_EMPTY" });
});

test("SQLite and D1 export adapters fingerprint only generated synthetic sources", async () => {
  const sqliteRoot = await tempRoot("sqlite"); const d1Root = await tempRoot("d1");
  const sqlite = await writeSyntheticSqlite(sqliteRoot, "valid"); const d1 = await writeSyntheticD1Export(d1Root, "valid");
  const left = await inspectSqliteSource(sqlite, env); const right = await inspectD1ExportSource(d1, env);
  assert.equal(left.records.length, 30); assert.equal(right.records.length, 30);
  assert.match(left.snapshotSha256, /^[0-9a-f]{64}$/); assert.match(right.schemaFingerprint, /^[0-9a-f]{64}$/);
  const badRoot = await tempRoot("badsource"); const bad = resolve(badRoot, "bad.json"); await writeFile(bad, JSON.stringify({ schema_version: 1, records: [] }));
  await assert.rejects(() => inspectD1ExportSource(bad, env), { code: "MIGRATION_SOURCE_NOT_SYNTHETIC" });
});

test("mapping planner accepts typed openings and blocks duplicates, orphans, precision, inventory, identity, file, and finance constraints", async () => {
  const validRoot = await tempRoot("valid"); const blockedRoot = await tempRoot("blocked");
  const valid = await inspectD1ExportSource(await writeSyntheticD1Export(validRoot, "valid"), env);
  const blocked = await inspectD1ExportSource(await writeSyntheticD1Export(blockedRoot, "blocked"), env);
  const validPlan = validateAndPlan(valid, registryDigest()); const blockedPlan = validateAndPlan(blocked, registryDigest());
  assert.equal(validPlan.runnable, true); assert.equal(validPlan.issues.length, 0);
  assert.equal(blockedPlan.runnable, false);
  const codes = new Set(blockedPlan.issues.map((item) => item.code));
  for (const code of ["UNKNOWN_ROLE", "UNMAPPED_KIND", "DUPLICATE_STABLE_KEY", "ORPHAN_REFERENCE", "NEGATIVE_INVENTORY", "FROZEN_EXCEEDS_ON_HAND", "MISSING_UNIT", "INVALID_STATUS", "INVALID_QUANTITY", "INVALID_AMOUNT", "CURRENCY_MISMATCH", "PRECISION_EXCEEDED", "FINANCE_OPENING_COUNTERPARTY_INVALID", "FILE_MISSING", "FILE_CHECKSUM_MISMATCH"]) assert.ok(codes.has(code), code);
});

test("ID map is stable, idempotent, and rejects changed source digest", () => {
  const map = new InMemoryIdMap("SQLITE", "11111111-1111-4111-8111-111111111111");
  const input = { sourceKind: "material", sourceStableKey: "SYN-MAT-001", targetTable: "material_master", sourceDigest: "a".repeat(64), targetDigest: "b".repeat(64) };
  const first = map.register(input); const second = map.register(input);
  assert.deepEqual(second, first); assert.equal(map.entries.size, 1);
  assert.throws(() => map.register({ ...input, sourceDigest: "c".repeat(64) }), { code: "MIGRATION_SOURCE_CHANGED" });
});

test("manifest is complete, safe, and binds exactly 0001-0014", async () => {
  const root = await tempRoot("manifest"); const source = await inspectD1ExportSource(await writeSyntheticD1Export(root, "valid"), env);
  const migrations = await migrationChecksums(resolve(siteRoot, "drizzle-postgres"));
  const manifest = await createManifest({ runId: "22222222-2222-4222-8222-222222222222", source, targetGitCommit: "a".repeat(40), targetMigrations: migrations, executionMode: "DRY_RUN" });
  assert.equal(manifest.target_migrations.length, 14); assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, source_files: [{ name: "/real/path", sha256: "a", bytes: 1 }] }), { code: "MIGRATION_MANIFEST_PATH_INVALID" });
  assert.throws(() => validateManifest({ ...manifest, leaked_password: "secret" }), { code: "MIGRATION_MANIFEST_SENSITIVE" });
});

test("checkpoint resumes completed phases and rejects changed input digest", async () => {
  const root = await tempRoot("checkpoint"); const store = new CheckpointStore(root, "a".repeat(64));
  const first = await store.append("Inspect", "INSPECTED", { count: 1 }); const second = await store.append("Inspect", "INSPECTED", { count: 2 });
  assert.equal(first.digest, second.digest); assert.equal(second.checkpoints.length, 1);
  const stale = new CheckpointStore(root, "b".repeat(64));
  await assert.rejects(() => stale.load(), { code: "CHECKPOINT_STALE" });
});

test("dry-run writes only safe workspace checkpoints and never a target", async () => {
  const sourceRoot = await tempRoot("drysource"); const workspace = await tempRoot("drywork");
  const source = await inspectSqliteSource(await writeSyntheticSqlite(sourceRoot, "valid"), env);
  const migrations = await migrationChecksums(resolve(siteRoot, "drizzle-postgres")); const plan = validateAndPlan(source, registryDigest());
  const inputDigest = executionInputDigest({ source, mappingDigest: registryDigest(), targetMigrations: migrations, plan });
  const result = await executeDryRun({ workspace, inputDigest, plan });
  assert.equal(result.state, "DRY_RUN_PASSED");
  const persisted = JSON.parse(await readFile(resolve(workspace, "checkpoint.json"), "utf8"));
  assert.equal(persisted.state, "DRY_RUN_PASSED"); assert.equal(JSON.stringify(persisted).includes("SYN-MAT-001"), false);
  const report = buildSafeReport({ runId: "33333333-3333-4333-8333-333333333333", state: result.state, manifest: await createManifest({ runId: "33333333-3333-4333-8333-333333333333", source, targetGitCommit: "b".repeat(40), targetMigrations: migrations, executionMode: "DRY_RUN", issues: issueSummary(plan.issues) }), plan, checkpoint: result.checkpoint });
  assert.equal(JSON.stringify(report).includes("SYN-MAT-001"), false);
});

test("workspace guard requires generated marker and can require empty", async () => {
  const root = await tempRoot("workspace"); assert.equal(assertWorkspace(root, { requireEmpty: true }), root);
  await writeFile(resolve(root, "x"), "x"); assert.throws(() => assertWorkspace(root, { requireEmpty: true }), { code: "MIGRATION_WORKSPACE_NOT_EMPTY" });
});
