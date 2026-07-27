import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir,readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const url=process.env.TEST_PRODUCTION_FINAL_OUTPUT_UPGRADE_DATABASE_URL;
if(!url||!/production_final_output_upgrade_test/i.test(url))throw new Error("isolated TEST_PRODUCTION_FINAL_OUTPUT_UPGRADE_DATABASE_URL containing production_final_output_upgrade_test is required");
const pool=new Pool({connectionString:url,max:3,application_name:"production-final-output-upgrade-test"}),dir=new URL("../drizzle-postgres/",import.meta.url);
const names=(await readdir(dir)).filter(n=>/^\d{4}_.+\.sql$/.test(n)&&n<="0027_production_final_output_reporting.sql").sort(),sources=new Map();
for(const name of names)sources.set(name,await readFile(new URL(name,dir),"utf8"));
const checksum=name=>createHash("sha256").update(sources.get(name)).digest("hex");
async function reset(){await pool.query("drop schema public cascade;create schema public;create table schema_migrations(version text primary key,checksum text not null)");}
async function migrate(list){for(const name of list){const old=await pool.query("select checksum from schema_migrations where version=$1",[name]);if(old.rows[0]){assert.equal(old.rows[0].checksum,checksum(name));continue;}const client=await pool.connect();try{await client.query("begin");await client.query(sources.get(name));await client.query("insert into schema_migrations values($1,$2)",[name,checksum(name)]);await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}}}
test.after(()=>pool.end());

test("empty database and repeated runner reach exactly immutable migration 0027",async()=>{
  assert.equal(names.length,27);assert.equal(names.at(-1),"0027_production_final_output_reporting.sql");await reset();await migrate(names);await migrate(names);
  assert.equal((await pool.query("select count(*)::int count from schema_migrations")).rows[0].count,27);
  assert.equal((await pool.query("select to_regclass('production_report_operation_allocations') value")).rows[0].value,"production_report_operation_allocations");
  assert.ok((await pool.query("select to_regprocedure('cyd_validate_production_final_output_report(bigint)') value")).rows[0].value);
});

test("0026 data upgrades expand-only and keeps historical reports unclassified",async()=>{
  await reset();await migrate(names.slice(0,26));
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('admin01','管理员','admin','x')");
  const before=(await pool.query("select count(*)::int count from production_reports")).rows[0].count;await migrate(names.slice(26));
  assert.equal((await pool.query("select count(*)::int count from production_reports")).rows[0].count,before);
  assert.equal((await pool.query("select count(*)::int count from production_report_operation_allocations")).rows[0].count,0);
  await pool.query("select cyd_validate_production_final_output_report(null::bigint)");
});

test("0027 failure rolls back every new object",async()=>{
  await reset();await migrate(names.slice(0,26));await pool.query("create table production_report_operation_allocations(id bigint primary key)");
  await assert.rejects(migrate(names.slice(26)),/production_report_operation_allocations.*already exists/i);
  assert.equal((await pool.query("select to_regprocedure('cyd_validate_production_final_output_report(bigint)') value")).rows[0].value,null);
  assert.equal((await pool.query("select count(*)::int count from schema_migrations where version=$1",[names.at(-1)])).rows[0].count,0);
});

test("snapshot, schema and migration agree on allocation shape and checksum",async()=>{
  const schema=await readFile(new URL("../db/schema.ts",import.meta.url),"utf8"),snapshot=JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0027_snapshot.json",import.meta.url),"utf8")),journal=JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json",import.meta.url),"utf8"));
  const table=snapshot.tables["public.production_report_operation_allocations"];
  assert.ok(table);assert.deepEqual(Object.keys(table.columns),["id","production_report_id","operation_run_report_id","snapshot_operation_id","quantity","operation_id","created_by","request_id","created_at"]);
  assert.match(schema,/productionReportOperationAllocations/);assert.match(schema,/numeric\("quantity", \{ precision: 24, scale: 6 \}\)/);
  assert.equal(journal.entries.at(-1).tag,"0027_production_final_output_reporting");assert.match(checksum(names.at(-1)),/^[0-9a-f]{64}$/);
});
