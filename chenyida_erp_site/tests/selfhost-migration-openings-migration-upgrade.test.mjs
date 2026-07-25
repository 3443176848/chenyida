import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { EXPECTED_MIGRATION_SHA256 } from "../tools/selfhost-migration/manifest.mjs";

const { Pool } = pg;
const databaseUrl = process.env.TEST_MIGRATION_OPENINGS_UPGRADE_DATABASE_URL;
if (databaseUrl && !/opening_upgrade_test/i.test(databaseUrl)) throw new Error("isolated opening_upgrade_test database is required");
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, application_name: "migration-opening-upgrade-test" }) : null;
const names = Object.keys(EXPECTED_MIGRATION_SHA256).sort(); const sources = new Map();
for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");

async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool?.end());

test("empty database upgrades and idempotently repeats through immutable 0014", { skip: !databaseUrl }, async () => {
  assert.equal(names.length, 14); assert.equal(names.at(-1), "0014_migration_openings.sql");
  for (const name of names.slice(0, 13)) assert.equal(checksum(name), EXPECTED_MIGRATION_SHA256[name], name);
  await reset(); await migrate(names); await migrate(names);
  const facts = await pool.query("select to_regclass('migration_opening_sources') sources,to_regclass('inventory_migration_openings') inventory,to_regclass('finance_opening_sources') finance,(select count(*)::int from migration_opening_sources) records");
  assert.deepEqual(facts.rows[0], { sources: "migration_opening_sources", inventory: "inventory_migration_openings", finance: "finance_opening_sources", records: 0 });
});

test("0013 data survives additive upgrade without automatic opening backfill", { skip: !databaseUrl }, async () => {
  await reset(); await migrate(names.slice(0, 13));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('legacy_test','Synthetic legacy','operations','test-only')");
  await pool.query("insert into app_meta(key,value) values('synthetic_0013_marker','preserve')");
  await pool.query("insert into erp_records(kind,code,data,created_by) values('financial_document','SYNTHETIC-LEGACY',$1,'legacy_test')", [{ amount: "1.000000" }]);
  await migrate(names.slice(13));
  assert.equal((await pool.query("select value from app_meta where key='synthetic_0013_marker'")).rows[0].value, "preserve");
  assert.equal(Number((await pool.query("select count(*) count from erp_records where code='SYNTHETIC-LEGACY'")).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*) count from migration_opening_sources")).rows[0].count), 0);
});

test("0014 DDL failure rolls back and direct opening writes fail closed", { skip: !databaseUrl }, async () => {
  await reset(); await migrate(names.slice(0, 13)); await pool.query("create table migration_opening_sources(id uuid primary key)");
  await assert.rejects(migrate(names.slice(13)), /migration_opening_sources.*already exists/i);
  assert.equal((await pool.query("select to_regclass('inventory_migration_openings') value")).rows[0].value, null);
  await pool.query("drop table migration_opening_sources"); await migrate(names.slice(13));
  await pool.query("insert into app_users(username,display_name,role,password_hash,is_active) values('migration_opening_actor','Synthetic actor','operations','test-only',false)");
  await assert.rejects(pool.query("insert into migration_opening_sources(id,migration_run_id,manifest_sha256,source_system,source_entity_kind,source_stable_reference_digest,source_record_digest,mapping_digest,target_digest,opening_type,cutoff_at,created_by,request_id,operation_id) values($1,$2,$3,'SYN','finance_opening',$3,$3,$3,$3,'AR',now(),'migration_opening_actor',$4,$5)", [randomUUID(), randomUUID(), "a".repeat(64), randomUUID(), randomUUID()]), /MigrationOpeningService/);
});
