import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const url = process.env.TEST_PRODUCTION_BATCH_DATABASE_URL;
if (!url || !/production_batch_test/i.test(url)) throw new Error("isolated TEST_PRODUCTION_BATCH_DATABASE_URL containing production_batch_test is required");
const pool = new Pool({ connectionString: url, max: 2, application_name: "production-batch-migration-test" });
const dir = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(dir)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, dir), "utf8")])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");

async function reset() { await pool.query("drop schema public cascade;create schema public;create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (existing.rows[0]) { assert.equal(existing.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }

test.beforeEach(reset);
test.after(() => pool.end());

test("empty database and repeated runner reach exactly migration 0031", async () => {
  assert.equal(names.length, 31);
  assert.equal(names.at(-1), "0031_production_batch_genealogy.sql");
  await migrate(names); await migrate(names);
  assert.equal((await pool.query("select count(*)::int count from schema_migrations")).rows[0].count, 31);
  for (const table of ["production_batch_sets", "production_batches", "production_batch_events", "production_report_batches", "production_completion_batches"]) assert.equal((await pool.query("select to_regclass($1) value", [`public.${table}`])).rows[0].value, table);
});
test("0030 to 0031 preserves historical ORDER mode with null Batch", async () => {
  await migrate(names.slice(0, 30));
  const client = await pool.connect();
  try {
    await client.query("begin"); await client.query("set local session_replication_role=replica");
    await client.query("insert into production_operation_runs(id,run_code,work_order_id,snapshot_operation_id,work_center_id,work_center_code,work_center_name,assigned_operator,dispatched_qty,source_digest,operation_id,created_by,request_id) values(7001,'ORDER-HISTORY',1,1,1,'ORDER','ORDER','order-user',1,$1,$2,'order-user',$3)", ["a".repeat(64), randomUUID(), randomUUID()]);
    await client.query("commit");
  } finally { client.release(); }
  await migrate(names.slice(30));
  assert.equal((await pool.query("select production_batch_id from production_operation_runs where id=7001")).rows[0].production_batch_id, null);
});

test("0031 failure rolls back every new relation and migration row", async () => {
  await migrate(names.slice(0, 30));
  await pool.query("create table production_batch_sets(id bigint)");
  await assert.rejects(migrate(names.slice(30)), /production_batch_sets.*already exists/i);
  assert.equal((await pool.query("select to_regclass('public.production_batches') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::int count from schema_migrations where version=$1", [names.at(-1)])).rows[0].count, 0);
});

test("schema snapshot, journal and full SHA-256 describe 0031", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const snapshot = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0031_snapshot.json", import.meta.url), "utf8"));
  const previous = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0030_snapshot.json", import.meta.url), "utf8"));
  const journal = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json", import.meta.url), "utf8"));
  for (const table of ["production_batch_sets", "production_batches", "production_batch_events", "production_report_batches", "production_completion_batches"]) assert.ok(snapshot.tables[`public.${table}`], table);
  for (const token of ["productionBatchSets", "productionBatches", "productionBatchEvents", "productionReportBatches", "productionCompletionBatches", "productionBatchId"]) assert.match(schema, new RegExp(token));
  assert.equal(snapshot.prevId, previous.id);
  assert.equal(journal.entries.at(-1).tag, "0031_production_batch_genealogy");
  assert.match(checksum(names.at(-1)), /^[0-9a-f]{64}$/);
});
