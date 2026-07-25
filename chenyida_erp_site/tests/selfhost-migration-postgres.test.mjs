import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import pg from "pg";
import { writeSyntheticSqlite } from "../tools/selfhost-migration/synthetic-fixtures.mjs";
import { inspectSqliteSource } from "../tools/selfhost-migration/source-sqlite.mjs";
import { migrationChecksums, createManifest } from "../tools/selfhost-migration/manifest.mjs";
import { registryDigest } from "../tools/selfhost-migration/mapping-registry.mjs";
import { validateAndPlan } from "../tools/selfhost-migration/validator.mjs";
import { executionInputDigest, executeDryRun, executeSyntheticCommit } from "../tools/selfhost-migration/executor.mjs";
import { PostgresTargetAdapter } from "../tools/selfhost-migration/target-postgres.mjs";

const { Pool } = pg;
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const siteRoot = resolve(import.meta.dirname, "..");
const temporaryRoots = new Set();

async function temporaryRoot(prefix) {
  const path = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryRoots.add(path);
  return path;
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((path) => rm(path, { recursive: true, force: true })));
  temporaryRoots.clear();
});

test("synthetic PostgreSQL commit resumes, repeats without duplicates, reconciles, and refuses non-empty public target", { skip: !databaseUrl }, async () => {
  const sourceRoot = await temporaryRoot("chenyida_pgsource_migration_test_");
  const workspace = await temporaryRoot("chenyida_pgwork_migration_test_");
  const fileTarget = resolve(sourceRoot, "file-target"); await mkdir(fileTarget);
  const source = await inspectSqliteSource(await writeSyntheticSqlite(sourceRoot, "resume"), { ERP_ENV: "test" });
  const targetMigrations = await migrationChecksums(resolve(siteRoot, "drizzle-postgres"));
  const plan = validateAndPlan(source, registryDigest()); assert.equal(plan.runnable, true);
  const inputDigest = executionInputDigest({ source, mappingDigest: registryDigest(), targetMigrations, plan });
  const runId = "44444444-4444-4444-8444-444444444444";
  const manifest = await createManifest({ runId, source, targetGitCommit: "c".repeat(40), targetMigrations, executionMode: "SYNTHETIC_COMMIT" });
  const target = new PostgresTargetAdapter(databaseUrl, { ERP_ENV: "test" });
  try {
    const baseline = await target.inspect(targetMigrations); assert.equal(baseline.migrations.length, 15); assert.ok(baseline.businessForeignKeyCount > 40);
    const pool = new Pool({ connectionString: databaseUrl });
    assert.equal((await pool.query("select to_regnamespace('migration_tool') is null as missing")).rows[0].missing, true);
    const dryWorkspace = await temporaryRoot("chenyida_pgdry_migration_test_");
    assert.equal((await executeDryRun({ workspace: dryWorkspace, inputDigest, plan })).state, "DRY_RUN_PASSED");
    assert.equal((await pool.query("select to_regnamespace('migration_tool') is null as missing")).rows[0].missing, true);
    await assert.rejects(() => executeSyntheticCommit({ workspace, inputDigest, runId, source, plan, target, manifest, interruptAfterDomain: "bom" }), { code: "MIGRATION_TEST_INTERRUPT" });
    const partial = await target.aggregate(runId); assert.ok(partial.record_count > 0 && partial.record_count < plan.rows.length);
    const resumed = await executeSyntheticCommit({ workspace, inputDigest, runId, source, plan, target, manifest });
    assert.equal(resumed.state, "RECONCILED"); assert.equal(resumed.reconciliation.grade, "PASS");
    const afterFirst = await target.aggregate(runId); assert.equal(afterFirst.record_count, plan.rows.length); assert.equal(afterFirst.orphan_count, 0); assert.equal(afterFirst.inventory_qty, "112.000000"); assert.equal(afterFirst.finance_amount, "19.000000");
    const openings = await pool.query("select (select count(*)::int from inventory_migration_openings) inventory,(select count(*)::int from finance_opening_sources) finance,(select count(*)::int from inventory_ledger_entries where entry_type='MIGRATION_OPENING') ledgers,(select count(*)::int from finance_documents where doc_type in ('OPENING_AR','OPENING_AP')) documents");
    assert.deepEqual(openings.rows[0], { inventory: 2, finance: 2, ledgers: 2, documents: 2 });
    const repeated = await executeSyntheticCommit({ workspace, inputDigest, runId, source, plan, target, manifest });
    assert.equal(repeated.state, "RECONCILED"); assert.equal((await target.aggregate(runId)).record_count, plan.rows.length);
    const changed = { ...plan.rows.find((row) => row.kind === "material"), source_digest: "d".repeat(64), data: { code: "SYN-MAT-001", name: "Changed Synthetic", status: "ACTIVE" } };
    await assert.rejects(() => target.commitDomain(runId, source.kind, [changed]), { code: "MIGRATION_SOURCE_CHANGED" });
    await pool.query("insert into app_meta(key,value) values('synthetic_nonempty_guard','1')");
    await assert.rejects(() => target.inspect(targetMigrations), { code: "MIGRATION_TARGET_NOT_EMPTY" });
    await pool.end();
  } finally { await target.close(); }
});
