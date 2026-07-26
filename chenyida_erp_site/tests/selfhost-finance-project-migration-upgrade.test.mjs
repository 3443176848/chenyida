import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_FINANCE_PROJECT_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/finance_project_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_FINANCE_PROJECT_UPGRADE_DATABASE_URL containing finance_project_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "finance-project-migration-upgrade-test" });
const names = (await readdir(new URL("../drizzle-postgres/", import.meta.url))).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8")] )));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("empty database and 0023 database upgrade once and replay by checksum", async () => {
  assert.equal(names.length, 24); assert.equal(names.at(-1), "0024_finance_project_settlements.sql");
  await reset(); await migrate(names.slice(0, 23));
  assert.equal((await pool.query("select to_regclass('finance_project_source_allocations') value")).rows[0].value, null);
  await migrate(names.slice(23)); await migrate(names);
  const facts = await pool.query("select (select count(*)::int from schema_migrations) migrations,to_regclass('finance_project_source_allocations') allocation_table,(select count(*)::int from pg_trigger where not tgisinternal and tgname=any($1)) guards", [["finance_project_allocations_immutable", "finance_project_allocations_total"]]);
  assert.deepEqual(facts.rows[0], { migrations: 24, allocation_table: "finance_project_source_allocations", guards: 2 });
  await assert.rejects(pool.query("insert into finance_project_source_allocations(source_type,sales_source_entry_id,sales_shipment_line_id,attribution_status,source_quantity,unit_price,amount,allocation_digest,created_by,request_id) values('SALES_SHIPMENT',1,1,'UNATTRIBUTED',1,1,1,$1,'nobody',$2)", ["a".repeat(64), randomUUID()]), /require FinanceService/i);
});

test("historical 0023 finance source remains untouched and explicitly unattributed", async () => {
  await reset(); await migrate(names.slice(0, 23));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('legacyfinance','旧财务','finance','test-only')");
  const customer = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-OLD','历史客户','历史客户','ACTIVE','legacyfinance','legacyfinance',$1) returning id", [randomUUID()]);
  const client = await pool.connect();
  try { await client.query("begin"); await client.query("select set_config('cyd.inventory_service_write','allowed',true),set_config('cyd.sales_service_write','allowed',true),set_config('cyd.finance_service_write','allowed',true)"); const adjustment = await client.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values('ADJ-OLD','ISSUE','历史来源',$1,'legacyfinance',$2) returning id", [randomUUID(), randomUUID()]); const order = await client.query("insert into sales_orders(sales_order_code,customer_id,ordered_qty,shipped_qty,status,operation_id,created_by,request_id) values('SO-OLD',$1,1,1,'SHIPPED',$2,'legacyfinance',$3) returning id", [customer.rows[0].id, randomUUID(), randomUUID()]); const shipment = await client.query("insert into sales_shipments(shipment_code,sales_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('SH-OLD',$1,$2,'历史来源',$3,'legacyfinance',$4) returning id", [order.rows[0].id, adjustment.rows[0].id, randomUUID(), randomUUID()]); const source = await client.query("insert into sales_financial_source_entries(shipment_id,customer_id,entry_type,amount,currency_code,source_id) values($1,$2,'SHIPMENT',10,'CNY',$3) returning id", [shipment.rows[0].id, customer.rows[0].id, randomUUID()]); await client.query("insert into finance_documents(doc_code,doc_type,sales_source_entry_id,customer_id,currency_code,total_amount,accounting_date,operation_id,created_by,request_id) values('AR-OLD','AR',$1,$2,'CNY',10,current_date,$3,'legacyfinance',$4)", [source.rows[0].id, customer.rows[0].id, randomUUID(), randomUUID()]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  await migrate(names.slice(23));
  assert.deepEqual((await pool.query("select (select count(*)::int from finance_documents) documents,(select count(*)::int from finance_project_source_allocations) allocations")).rows[0], { documents: 1, allocations: 0 });
});

test("0024 DDL failure rolls back functions, triggers and migration row", async () => {
  await reset(); await migrate(names.slice(0, 23)); await pool.query("create table finance_project_source_allocations(id bigint primary key)");
  await assert.rejects(migrate(names.slice(23)), /finance_project_source_allocations.*already exists/i);
  const state = await pool.query("select to_regprocedure('cyd_finance_project_allocation_guard()') guard,(select count(*)::int from schema_migrations where version=$1) migration", [names.at(-1)]);
  assert.deepEqual(state.rows[0], { guard: null, migration: 0 });
});
