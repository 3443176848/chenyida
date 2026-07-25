import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import pg from "pg";
import { executeSyntheticCommit, executionInputDigest } from "../tools/selfhost-migration/executor.mjs";
import { createManifest, migrationChecksums } from "../tools/selfhost-migration/manifest.mjs";
import { registryDigest } from "../tools/selfhost-migration/mapping-registry.mjs";
import { writeSyntheticSqlite } from "../tools/selfhost-migration/synthetic-fixtures.mjs";
import { inspectSqliteSource } from "../tools/selfhost-migration/source-sqlite.mjs";
import { PostgresTargetAdapter } from "../tools/selfhost-migration/target-postgres.mjs";
import { validateAndPlan } from "../tools/selfhost-migration/validator.mjs";

const { Pool } = pg;
const databaseUrl = process.env.TEST_PUBLIC_MATERIALIZATION_DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, application_name: "public-materialization-test" }) : null;
const siteRoot = resolve(import.meta.dirname, "..");
const temporaryRoots = new Set();

async function temporary(prefix) { const path = await mkdtemp(resolve(tmpdir(), prefix)); temporaryRoots.add(path); return path; }
async function reset() {
  await pool.query("drop schema if exists migration_tool cascade");
  const tables = await pool.query("select string_agg(format('%I',tablename),',') names from pg_tables where schemaname='public' and tablename<>'schema_migrations'");
  if (tables.rows[0].names) await pool.query(`truncate ${tables.rows[0].names} restart identity cascade`);
}

async function fixture(kind = "valid") {
  const sourceRoot = await temporary("cyd_public_source_migration_test_"); const workspace = await temporary("cyd_public_work_migration_test_"); const fileTarget = resolve(await temporary("cyd_public_files_migration_test_"), "target"); await mkdir(fileTarget);
  const source = await inspectSqliteSource(await writeSyntheticSqlite(sourceRoot, kind), { ERP_ENV: "test" });
  const targetMigrations = await migrationChecksums(resolve(siteRoot, "drizzle-postgres")); const plan = validateAndPlan(source, registryDigest());
  const inputDigest = executionInputDigest({ source, mappingDigest: registryDigest(), targetMigrations, plan }); const runId = randomUUID();
  const manifest = await createManifest({ runId, source, targetGitCommit: "e".repeat(40), targetMigrations, executionMode: "SYNTHETIC_COMMIT" });
  return { source, workspace, fileTarget, targetMigrations, plan, inputDigest, runId, manifest };
}

test.afterEach(async () => { await Promise.all([...temporaryRoots].map((path) => rm(path, { recursive: true, force: true }))); temporaryRoots.clear(); });
test.after(async () => pool?.end());

test("cutover snapshot writes actual public IDs, openings and file once, then reconciles", { skip: !databaseUrl }, async () => {
  await reset(); const value = await fixture(); const target = new PostgresTargetAdapter(databaseUrl, { ERP_ENV: "test" });
  try {
    await target.inspect(value.targetMigrations);
    const first = await executeSyntheticCommit({ ...value, target, fileTarget: value.fileTarget, setupAdmin: { username: "synthetic_test_admin", password: "Synthetic-Admin!12345" } });
    assert.equal(first.state, "RECONCILED"); assert.equal(first.public_materialization.report.result, "PASS"); assert.equal(first.public_materialization.report.public_actual_targets, 18); assert.equal(first.public_materialization.report.archive_only_records, 12);
    const counts = await pool.query(`select
      (select count(*)::int from migration_tool.public_id_map) maps,
      (select count(*)::int from material_master) materials,
      (select count(*)::int from customers) customers,
      (select count(*)::int from suppliers) suppliers,
      (select count(*)::int from products) products,
      (select count(*)::int from bom_headers) boms,
      (select count(*)::int from inventory_migration_openings) inventory_openings,
      (select count(*)::int from finance_opening_sources) finance_openings,
      (select count(*)::int from migration_tool.synthetic_files) files,
      (select count(*)::int from erp_records) erp_records`);
    assert.deepEqual(counts.rows[0], { maps: 18, materials: 2, customers: 1, suppliers: 1, products: 1, boms: 1, inventory_openings: 2, finance_openings: 2, files: 1, erp_records: 0 });
    const identities = await pool.query("select username,role,is_active,must_change_password,password_hash from app_users order by username");
    assert.ok(identities.rows.some((row) => row.username === "synthetic_test_admin" && row.role === "admin" && row.is_active));
    assert.ok(identities.rows.some((row) => row.username === "synthetic_admin" && !row.is_active && row.must_change_password && row.password_hash === "!MIGRATED_DISABLED_NO_PASSWORD!"));
    const repeated = await executeSyntheticCommit({ ...value, target, fileTarget: value.fileTarget, setupAdmin: { username: "synthetic_test_admin", password: "Synthetic-Admin!12345" } });
    assert.equal(repeated.public_materialization.report.public_actual_targets, 18);
    assert.equal(Number((await pool.query("select count(*) count from migration_tool.synthetic_files")).rows[0].count), 1);
    await pool.query("update material_master set standard_name='Synthetic digest drift' where internal_material_code='SYN-MAT-001'");
    const driftSnapshot = await target.materializeSnapshot({ source: value.source, plan: value.plan, manifest: value.manifest, workspace: value.workspace, fileTarget: value.fileTarget });
    await assert.rejects(() => target.finalizeSnapshot(driftSnapshot), { code: "MATERIALIZATION_TARGET_DIGEST_CHANGED" });
  } finally { await target.close(); }
});

test("aggregate fault rolls back current material and resume does not duplicate completed upstream", { skip: !databaseUrl }, async () => {
  await reset(); const value = await fixture(); const target = new PostgresTargetAdapter(databaseUrl, { ERP_ENV: "test" });
  try {
    await target.inspect(value.targetMigrations);
    await assert.rejects(() => executeSyntheticCommit({ ...value, target, fileTarget: value.fileTarget, materializationFault: (stage, row) => { if (stage === "material:after_business" && row.stable_key === "SYN-MAT-001") throw Object.assign(new Error("synthetic fault"), { code: "SYNTHETIC_FAULT" }); } }), { code: "SYNTHETIC_FAULT" });
    assert.equal(Number((await pool.query("select count(*) count from material_master")).rows[0].count), 1);
    assert.equal(Number((await pool.query("select count(*) count from material_master where internal_material_code='SYN-MAT-001'")).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from units")).rows[0].count), 1);
    const resumed = await executeSyntheticCommit({ ...value, target, fileTarget: value.fileTarget });
    assert.equal(resumed.public_materialization.report.result, "PASS");
    assert.equal(Number((await pool.query("select count(*) count from units")).rows[0].count), 1);
    assert.equal(Number((await pool.query("select count(*) count from material_master")).rows[0].count), 2);
  } finally { await target.close(); }
});

test("target code conflict blocks downstream work and the same run resumes after correction", { skip: !databaseUrl }, async () => {
  await reset(); const value = await fixture(); const target = new PostgresTargetAdapter(databaseUrl, { ERP_ENV: "test" });
  try {
    await target.inspect(value.targetMigrations);
    await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','Conflicting synthetic unit','PCS','COUNT',true)");
    await assert.rejects(() => executeSyntheticCommit({ ...value, target, fileTarget: value.fileTarget }), { code: "MATERIALIZATION_CODE_CONFLICT" });
    const blocked = await pool.query(`select
      (select count(*)::int from migration_tool.public_id_map where source_kind='identity') identity_maps,
      (select count(*)::int from migration_tool.public_id_map where source_kind in ('unit','material')) downstream_maps,
      (select count(*)::int from material_master) materials`);
    assert.deepEqual(blocked.rows[0], { identity_maps: 1, downstream_maps: 0, materials: 0 });
    await pool.query("delete from units where code='PCS'");
    const resumed = await executeSyntheticCommit({ ...value, target, fileTarget: value.fileTarget });
    assert.equal(resumed.public_materialization.report.result, "PASS");
    assert.equal(Number((await pool.query("select count(*) count from migration_tool.public_id_map where source_kind='identity'")).rows[0].count), 1);
    assert.equal(Number((await pool.query("select count(*) count from material_master")).rows[0].count), 2);
  } finally { await target.close(); }
});
