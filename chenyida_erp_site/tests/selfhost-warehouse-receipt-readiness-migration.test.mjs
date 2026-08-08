import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_WAREHOUSE_RECEIPT_READINESS_MIGRATION_DATABASE_URL;
if (!databaseUrl || !/warehouse_receipt_readiness_migration_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_WAREHOUSE_RECEIPT_READINESS_MIGRATION_DATABASE_URL containing warehouse_receipt_readiness_migration_test is required");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "warehouse-receipt-readiness-migration-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && name <= "0040_warehouse_receipt_readiness.sql").sort();
const sources = new Map();
for (const name of names) sources.set(name, await readFile(new URL(name, directory), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");

async function reset() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
}
async function migrate(list) {
  for (const name of list) {
    const applied = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (applied.rows[0]) { assert.equal(applied.rows[0].checksum, checksum(name)); continue; }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sources.get(name));
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
test.after(async () => pool.end());

test("empty database and repeated execution produce exactly the 0040 readiness relation", async () => {
  assert.equal(names.length, 40);
  assert.equal(names.at(-1), "0040_warehouse_receipt_readiness.sql");
  await reset();
  await migrate(names);
  const firstAppliedAt = (await pool.query("select applied_at from schema_migrations where version=$1", [names.at(-1)])).rows[0].applied_at;
  await migrate(names);
  const structure = (await pool.query(`select
    to_regclass('warehouse_receipt_evidence') relation,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='warehouse_receipt_evidence') columns,
    (select count(*)::int from pg_indexes where schemaname='public' and indexname=any($1)) indexes,
    (select count(*)::int from pg_trigger where tgrelid='warehouse_receipt_evidence'::regclass and not tgisinternal) triggers,
    (select count(*)::int from schema_migrations) migrations`, [[
      "warehouse_receipt_evidence_receipt_uq", "warehouse_receipt_evidence_receipt_line_uq",
      "warehouse_receipt_evidence_request_uq", "warehouse_receipt_evidence_plan_idx", "warehouse_receipt_evidence_queue_idx",
    ]])).rows[0];
  assert.deepEqual(structure, { relation: "warehouse_receipt_evidence", columns: 21, indexes: 5, triggers: 1, migrations: 40 });
  assert.deepEqual((await pool.query("select applied_at from schema_migrations where version=$1", [names.at(-1)])).rows[0].applied_at, firstAppliedAt);
});

test("0039 data survives the expand-only 0040 upgrade and database constraints fail closed", async () => {
  await reset();
  await migrate(names.slice(0, 39));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('warehouse01','仓库','warehouse','test-only')");
  await pool.query("insert into business_code_sequences(sequence_code,current_value,version) values('PURCHASE_RECEIPT',7,3)");
  const beforeUsers = (await pool.query("select username,role from app_users")).rows;
  const beforeSequences = (await pool.query("select sequence_code,current_value::text,version from business_code_sequences")).rows;
  await migrate(names.slice(39));
  assert.deepEqual((await pool.query("select username,role from app_users")).rows, beforeUsers);
  assert.deepEqual((await pool.query("select sequence_code,current_value::text,version from business_code_sequences")).rows, beforeSequences);
  assert.equal((await pool.query("select version from schema_migrations order by version desc limit 1")).rows[0].version, "0040_warehouse_receipt_readiness.sql");

  const constraints = (await pool.query(`select conname,pg_get_constraintdef(oid) definition
    from pg_constraint where conrelid='warehouse_receipt_evidence'::regclass order by conname`)).rows;
  const definitions = constraints.map((row) => `${row.conname}:${row.definition}`).join("\n");
  for (const name of ["warehouse_receipt_evidence_type_ck", "warehouse_receipt_evidence_early_ck", "warehouse_receipt_evidence_physical_ck", "warehouse_receipt_evidence_location_ck", "warehouse_receipt_evidence_versions_ck"]) assert.match(definitions, new RegExp(name));
  for (const reference of ["purchase_receipts", "purchase_receipt_lines", "purchase_delivery_plans", "warehouse_receiving_queue_entries", "app_users"]) assert.match(definitions, new RegExp(reference));
  await assert.rejects(pool.query(`insert into warehouse_receipt_evidence(
      purchase_receipt_id,purchase_receipt_line_id,delivery_plan_id,queue_entry_id,evidence_type,evidence_reference,
      evidence_document_date,early_arrival,early_arrival_confirmed,physical_receipt_confirmed,
      expected_purchase_order_version,expected_purchase_order_line_version,expected_delivery_plan_version,
      expected_queue_version,expected_balance_version,created_by,request_id)
    values(1,1,1,1,'DELIVERY_NOTE','UNAUTHORIZED',current_date,false,false,true,1,1,1,1,0,'warehouse01','00000000-0000-4000-8000-000000000001')`), /requires fulfillment service/);
  assert.equal((await pool.query("select count(*)::int count from warehouse_receipt_evidence")).rows[0].count, 0);
});

test("0040 failure rolls back every partial object and records no migration", async () => {
  await reset();
  await migrate(names.slice(0, 39));
  await pool.query("create table warehouse_receipt_evidence(id bigint primary key, marker text not null)");
  await assert.rejects(migrate(names.slice(39)), /warehouse_receipt_evidence.*already exists/i);
  assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version='0040_warehouse_receipt_readiness.sql'")).rows[0].count), 0);
  assert.deepEqual((await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='warehouse_receipt_evidence' order by ordinal_position")).rows.map((row) => row.column_name), ["id", "marker"]);
  assert.equal((await pool.query("select to_regprocedure('cyd_warehouse_receipt_evidence_guard()') value")).rows[0].value, null);
});
