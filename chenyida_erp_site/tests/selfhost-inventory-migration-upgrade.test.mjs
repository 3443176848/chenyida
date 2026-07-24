import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_INVENTORY_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/inventory_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_INVENTORY_UPGRADE_DATABASE_URL containing inventory_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "inventory-migration-upgrade-test" });
const names = ["0001_selfhost_baseline.sql", "0002_material_master_workflow.sql", "0003_material_import_mapping.sql", "0004_material_import_normalization.sql", "0005_material_import_review.sql", "0006_identity_security.sql", "0007_master_data_bom.sql", "0008_inventory_ledger.sql"];
const expectedOld = ["c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702", "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80", "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf", "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39", "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc", "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079", "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6"];
const sources = new Map(); for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("old checksums remain immutable and empty database upgrades and repeats through 0008", async () => {
  assert.deepEqual(names.slice(0, 7).map(checksum), expectedOld); assert.match(checksum(names[7]), /^[0-9a-f]{64}$/);
  await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('inventory_stock_balances') balances,to_regclass('inventory_ledger_entries') ledger,to_regclass('inventory_adjustments') adjustments");
  assert.equal(tables.rows[0].balances, "inventory_stock_balances"); assert.equal(tables.rows[0].ledger, "inventory_ledger_entries");
  const indexes = await pool.query("select indexname from pg_indexes where indexname in ('inventory_stock_balances_position_uq','inventory_ledger_entries_reversal_uq','inventory_adjustments_reversal_uq')"); assert.equal(indexes.rowCount, 3);
  const triggers = await pool.query("select tgname from pg_trigger where not tgisinternal and tgname like 'inventory_%'"); assert.ok(triggers.rowCount >= 4);
});

test("0007 users sessions and legacy item-code inventory remain unchanged and outside the new authority", async () => {
  await reset(); await migrate(names.slice(0, 7));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('legacy_user','旧用户','warehouse','test-only')");
  await pool.query("insert into app_sessions(token_hash,username,expires_at) values($1,'legacy_user',now()+interval '1 hour')", ["e".repeat(64)]);
  await pool.query("insert into inventory_balances(item_code,on_hand_qty,reserved_qty,version) values('LEGACY-CODE',12.5,1,7)");
  await pool.query("insert into inventory_transactions(item_code,txn_type,qty,before_qty,after_qty,created_by) values('LEGACY-CODE','旧流水',12.5,0,12.5,'legacy_user')");
  await migrate(names.slice(7));
  const preserved = await pool.query("select b.*,t.txn_type,s.token_hash from inventory_balances b join inventory_transactions t on t.item_code=b.item_code cross join app_sessions s where s.username='legacy_user'");
  assert.equal(preserved.rows[0].on_hand_qty, "12.500000"); assert.equal(preserved.rows[0].txn_type, "旧流水"); assert.equal(preserved.rows[0].token_hash, "e".repeat(64));
  assert.equal(Number((await pool.query("select count(*) count from inventory_stock_balances")).rows[0].count), 0);
});

test("0008 DDL failure rolls back all new objects and succeeds after conflict removal", async () => {
  await reset(); await migrate(names.slice(0, 7));
  await pool.query("create table inventory_adjustments(id bigint primary key)");
  await assert.rejects(migrate(names.slice(7)), /inventory_adjustments.*already exists/i);
  assert.equal((await pool.query("select to_regclass('inventory_adjustment_lines') value")).rows[0].value, null);
  assert.equal((await pool.query("select to_regclass('inventory_ledger_entries') value")).rows[0].value, null);
  assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version=$1", [names[7]])).rows[0].count), 0);
  await pool.query("drop table inventory_adjustments"); await migrate(names.slice(7));
  assert.equal((await pool.query("select to_regclass('inventory_ledger_entries') value")).rows[0].value, "inventory_ledger_entries");
});
