import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const url = process.env.TEST_FINISHED_GOODS_LOT_DATABASE_URL;
if (!url || !/finished_goods_lot_test/i.test(url)) throw new Error("isolated TEST_FINISHED_GOODS_LOT_DATABASE_URL containing finished_goods_lot_test is required");
const pool = new Pool({ connectionString: url, max: 2, application_name: "finished-goods-lot-migration-test" });
const dir = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(dir)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
const lotNames = names.slice(0, 32);
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, dir), "utf8")])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");

async function reset() { await pool.query("drop schema public cascade;create schema public;create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) {
  for (const name of list) {
    const prior = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (prior.rows[0]) { assert.equal(prior.rows[0].checksum, checksum(name)); continue; }
    const client = await pool.connect();
    try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); }
    catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}

test.beforeEach(reset);
test.after(() => pool.end());

test("empty database and repeated runner reach exactly 0032", async () => {
  assert.equal(lotNames.length, 32); assert.equal(lotNames.at(-1), "0032_finished_goods_inventory_lots.sql");
  await migrate(lotNames); await migrate(lotNames);
  assert.equal((await pool.query("select count(*)::int n from schema_migrations")).rows[0].n, 32);
  for (const table of ["inventory_lots", "production_completion_inventory_lots", "inventory_lot_events"]) assert.equal((await pool.query("select to_regclass($1) value", [`public.${table}`])).rows[0].value, table);
  for (const table of ["inventory_stock_balances", "inventory_ledger_entries", "inventory_adjustment_lines"]) assert.equal((await pool.query("select count(*)::int n from information_schema.columns where table_name=$1 and column_name='inventory_lot_id'", [table])).rows[0].n, 1);
});

test("0031 to 0032 preserves historical empty-lot balance", async () => {
  await migrate(lotNames.slice(0, 31));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('history01','历史','admin','x')");
  const unit = (await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('HISPCS','件','PCS','COUNT',true) returning id")).rows[0];
  const category = (await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('HISTORY','历史',4,'ACTIVE','history01','history01',$1) returning id", [randomUUID()])).rows[0];
  const material = (await pool.query("insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('CYD-HISTORY','历史库存',$1,'HISPCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL','history01','history01','history01',$3) returning id", [category.id, unit.id, randomUUID()])).rows[0];
  const client = await pool.connect();
  try { await client.query("begin"); await client.query("select set_config('cyd.inventory_service_write','allowed',true)"); await client.query("insert into inventory_stock_balances(material_id,unit_id,lot_code,on_hand_qty,version) values($1,$2,'',3,1)", [material.id, unit.id]); await client.query("commit"); }
  catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
  await migrate(lotNames.slice(31));
  assert.deepEqual((await pool.query("select inventory_lot_id,lot_code,on_hand_qty::text from inventory_stock_balances where material_id=$1", [material.id])).rows, [{ inventory_lot_id: null, lot_code: "", on_hand_qty: "3.000000" }]);
});

test("0032 failure is transactional", async () => {
  await migrate(lotNames.slice(0, 31)); await pool.query("create table inventory_lots(id bigint)");
  await assert.rejects(migrate(lotNames.slice(31)), /inventory_lots.*already exists/i);
  assert.equal((await pool.query("select column_name from information_schema.columns where table_name='inventory_ledger_entries' and column_name='inventory_lot_id'")).rowCount, 0);
  assert.equal((await pool.query("select count(*)::int n from schema_migrations where version=$1", [lotNames.at(-1)])).rows[0].n, 0);
});

test("journal snapshot schema and SHA-256 describe 0032", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8"), snapshot = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0032_snapshot.json", import.meta.url), "utf8")), previous = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0031_snapshot.json", import.meta.url), "utf8")), journal = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json", import.meta.url), "utf8"));
  for (const table of ["inventory_lots", "production_completion_inventory_lots", "inventory_lot_events"]) assert.ok(snapshot.tables[`public.${table}`], table);
  for (const token of ["inventoryLots", "productionCompletionInventoryLots", "inventoryLotEvents", "inventoryLotId"]) assert.match(schema, new RegExp(token));
  assert.equal(snapshot.prevId, previous.id); assert.ok(journal.entries.some((entry) => entry.tag === "0032_finished_goods_inventory_lots")); assert.match(checksum(lotNames.at(-1)), /^[0-9a-f]{64}$/);
});
