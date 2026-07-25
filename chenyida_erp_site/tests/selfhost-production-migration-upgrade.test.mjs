import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_PRODUCTION_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/production_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_PRODUCTION_UPGRADE_DATABASE_URL containing production_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "production-migration-upgrade-test" });
const names = ["0001_selfhost_baseline.sql", "0002_material_master_workflow.sql", "0003_material_import_mapping.sql", "0004_material_import_normalization.sql", "0005_material_import_review.sql", "0006_identity_security.sql", "0007_master_data_bom.sql", "0008_inventory_ledger.sql", "0009_procurement.sql", "0010_production.sql"];
const expectedOld = ["c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702", "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80", "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf", "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39", "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc", "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079", "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6", "49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b", "351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7"];
const sources = new Map(); for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("0001-0009 remain immutable and empty database upgrades and repeats through 0010", async () => {
  assert.deepEqual(names.slice(0, 9).map(checksum), expectedOld); assert.match(checksum(names[9]), /^[0-9a-f]{64}$/); await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('production_work_orders') wo,to_regclass('production_bom_snapshots') snapshots,to_regclass('production_material_requirements') requirements,to_regclass('production_completions') completions"); assert.deepEqual(tables.rows[0], { wo: "production_work_orders", snapshots: "production_bom_snapshots", requirements: "production_material_requirements", completions: "production_completions" });
  const indexes = await pool.query("select indexname from pg_indexes where indexname in ('production_work_orders_code_uq','production_bom_snapshots_wo_uq','production_material_issue_lines_ledger_uq','production_completion_lines_ledger_uq')"); assert.equal(indexes.rowCount, 4);
  const triggers = await pool.query("select tgname from pg_trigger where not tgisinternal and tgname like 'production_%'"); assert.ok(triggers.rowCount >= 11);
});

test("0009 procurement inventory identity and legacy records survive without production backfill", async () => {
  await reset(); await migrate(names.slice(0, 9)); await pool.query("insert into app_users(username,display_name,role,password_hash) values('legacy_prod','旧生产','production','test-only')"); await pool.query("insert into erp_records(kind,code,data,created_by) values('work_order','LEGACY-WO',$1,'legacy_prod')", [{ order_qty: 7 }]); await pool.query("insert into inventory_balances(item_code,on_hand_qty,reserved_qty,version) values('LEGACY-FG',3,0,2)"); await migrate(names.slice(9));
  assert.equal(Number((await pool.query("select count(*) count from erp_records where kind='work_order'")).rows[0].count), 1); assert.equal((await pool.query("select on_hand_qty from inventory_balances where item_code='LEGACY-FG'")).rows[0].on_hand_qty, "3.000000"); assert.equal(Number((await pool.query("select count(*) count from production_work_orders")).rows[0].count), 0); assert.ok(await pool.query("select to_regclass('purchase_orders')"));
});

test("0010 DDL failure rolls back and status and immutable guards fail closed", async () => {
  await reset(); await migrate(names.slice(0, 9)); await pool.query("create table production_work_orders(id bigint primary key)"); await assert.rejects(migrate(names.slice(9)), /production_work_orders.*already exists/i); assert.equal((await pool.query("select to_regclass('production_bom_snapshots') value")).rows[0].value, null); assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version=$1", [names[9]])).rows[0].count), 0); await pool.query("drop table production_work_orders"); await migrate(names.slice(9));
  await assert.rejects(pool.query(`insert into production_work_orders(work_order_code,product_id,product_version_id,bom_version_id,finished_material_id,finished_unit_id,planned_qty,status,operation_id,created_by,request_id) values('BAD',1,1,1,1,1,1,'INVALID',$1,'nobody',$2)`, [randomUUID(), randomUUID()]));
});
