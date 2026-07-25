import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_PROCUREMENT_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/procurement_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_PROCUREMENT_UPGRADE_DATABASE_URL containing procurement_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "procurement-migration-upgrade-test" });
const names = ["0001_selfhost_baseline.sql", "0002_material_master_workflow.sql", "0003_material_import_mapping.sql", "0004_material_import_normalization.sql", "0005_material_import_review.sql", "0006_identity_security.sql", "0007_master_data_bom.sql", "0008_inventory_ledger.sql", "0009_procurement.sql"];
const expectedOld = ["c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702", "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80", "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf", "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39", "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc", "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079", "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6", "49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b"];
const sources = new Map(); for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("0001-0008 checksums remain immutable and empty database upgrades and repeats through 0009", async () => {
  assert.deepEqual(names.slice(0, 8).map(checksum), expectedOld); assert.match(checksum(names[8]), /^[0-9a-f]{64}$/);
  await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('purchase_orders') po,to_regclass('purchase_receipts') receipts,to_regclass('purchase_financial_source_entries') finance");
  assert.deepEqual(tables.rows[0], { po: "purchase_orders", receipts: "purchase_receipts", finance: "purchase_financial_source_entries" });
  const indexes = await pool.query("select indexname from pg_indexes where indexname in ('purchase_orders_code_uq','purchase_order_lines_material_uq','purchase_receipts_reversal_uq','purchase_receipt_lines_ledger_uq')"); assert.equal(indexes.rowCount, 4);
  const triggers = await pool.query("select tgname from pg_trigger where not tgisinternal and tgname like 'purchase_%'"); assert.ok(triggers.rowCount >= 10);
});

test("0008 identity material BOM inventory and legacy erp_records remain available without procurement backfill", async () => {
  await reset(); await migrate(names.slice(0, 8));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('legacy_user','旧用户','purchase','test-only')");
  await pool.query("insert into erp_records(kind,code,data,created_by) values('purchase_order','LEGACY-PO',$1,'legacy_user')", [{ supplier_name: "legacy" }]);
  await pool.query("insert into inventory_balances(item_code,on_hand_qty,reserved_qty,version) values('LEGACY-CODE',12.5,1,7)");
  const before = await pool.query("select count(*)::int erp_count from erp_records where kind='purchase_order'"); await migrate(names.slice(8));
  assert.equal((await pool.query("select count(*)::int erp_count from erp_records where kind='purchase_order'")).rows[0].erp_count, before.rows[0].erp_count);
  assert.equal((await pool.query("select on_hand_qty from inventory_balances where item_code='LEGACY-CODE'")).rows[0].on_hand_qty, "12.500000");
  assert.equal(Number((await pool.query("select count(*) count from purchase_orders")).rows[0].count), 0);
});

test("0009 DDL failure rolls back all procurement objects and constraints fail closed", async () => {
  await reset(); await migrate(names.slice(0, 8)); await pool.query("create table purchase_orders(id bigint primary key)");
  await assert.rejects(migrate(names.slice(8)), /purchase_orders.*already exists/i); assert.equal((await pool.query("select to_regclass('purchase_receipts') value")).rows[0].value, null); assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version=$1", [names[8]])).rows[0].count), 0);
  await pool.query("drop table purchase_orders"); await migrate(names.slice(8));
  await assert.rejects(pool.query(`insert into purchase_orders(po_code,supplier_id,status,currency_code,operation_id,created_by,request_id) values('BAD',1,'INVALID','CNY',$1,'nobody',$2)`, [randomUUID(), randomUUID()]));
});
