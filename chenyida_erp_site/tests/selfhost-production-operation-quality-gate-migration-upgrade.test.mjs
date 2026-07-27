import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readdir,readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const url=process.env.TEST_PRODUCTION_QUALITY_GATE_UPGRADE_DATABASE_URL;
if(!url||!/production_operation_quality_gate_upgrade_test/i.test(url))throw new Error("isolated TEST_PRODUCTION_QUALITY_GATE_UPGRADE_DATABASE_URL containing production_operation_quality_gate_upgrade_test is required");
const pool=new Pool({connectionString:url,max:3,application_name:"production-operation-quality-gate-upgrade-test"}),dir=new URL("../drizzle-postgres/",import.meta.url);
const names=(await readdir(dir)).filter(n=>/^\d{4}_.+\.sql$/.test(n)&&n<="0028_production_operation_quality_gates.sql").sort(),sources=new Map();for(const name of names)sources.set(name,await readFile(new URL(name,dir),"utf8"));
const checksum=name=>createHash("sha256").update(sources.get(name)).digest("hex");
async function reset(){await pool.query("drop schema public cascade;create schema public;create table schema_migrations(version text primary key,checksum text not null)");}
async function migrate(list){for(const name of list){const old=await pool.query("select checksum from schema_migrations where version=$1",[name]);if(old.rows[0]){assert.equal(old.rows[0].checksum,checksum(name));continue;}const client=await pool.connect();try{await client.query("begin");await client.query(sources.get(name));await client.query("insert into schema_migrations values($1,$2)",[name,checksum(name)]);await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}}}
test.after(()=>pool.end());

test("empty database and repeated runner reach exactly guarded migration 0028",async()=>{
  assert.equal(names.length,28);assert.equal(names.at(-1),"0028_production_operation_quality_gates.sql");await reset();await migrate(names);await migrate(names);
  assert.equal((await pool.query("select count(*)::int count from schema_migrations")).rows[0].count,28);
  const columns=await pool.query("select table_name,column_name,column_default from information_schema.columns where (table_name,column_name) in (('production_routing_operations','quality_gate_mode'),('production_work_order_routing_snapshot_operations','quality_gate_mode'),('quality_inspections','production_operation_run_report_id'),('production_operation_wip_projections','quality_hold_qty')) order by table_name,column_name");
  assert.equal(columns.rowCount,4);assert.ok((await pool.query("select to_regprocedure('cyd_validate_production_operation_projection(bigint)') value")).rows[0].value);
});

test("0027 history upgrades expand-only with NONE defaults and legacy IPQC source intact",async()=>{
  await reset();await migrate(names.slice(0,27));await pool.query("insert into app_users(username,display_name,role,password_hash) values('quality01','品质','quality','x')");
  await pool.query("set session_replication_role=replica");try{
    await pool.query("insert into production_routing_operations(id,routing_version_id,sequence_no,operation_code,operation_name,work_center_id,created_by,request_id) values(99001,99001,10,'LEGACY','历史工序',99001,'quality01',$1)",[randomUUID()]);
    await pool.query("insert into production_work_order_routing_snapshot_operations(id,snapshot_id,source_routing_operation_id,sequence_no,operation_code,operation_name,work_center_id,work_center_code,work_center_name,setup_minutes,run_minutes_per_unit) values(99001,99001,99001,10,'LEGACY','历史工序',99001,'LEGACY','历史工序',0,0)");
    await pool.query("insert into quality_inspections(inspection_code,inspection_type,production_report_id,material_id,unit_id,inspected_qty,passed_qty,failed_qty,operation_id,created_by,request_id) values('IPQC-HISTORY','IPQC',99001,99001,99001,1,1,0,$1,'quality01',$2)",[randomUUID(),randomUUID()]);
  }finally{await pool.query("set session_replication_role=origin");}
  await migrate(names.slice(27));
  assert.deepEqual((await pool.query("select quality_gate_mode from production_routing_operations where id=99001")).rows,[{quality_gate_mode:"NONE"}]);
  assert.deepEqual((await pool.query("select quality_gate_mode from production_work_order_routing_snapshot_operations where id=99001")).rows,[{quality_gate_mode:"NONE"}]);
  assert.deepEqual((await pool.query("select production_report_id,production_operation_run_report_id from quality_inspections where inspection_code='IPQC-HISTORY'")).rows,[{production_report_id:"99001",production_operation_run_report_id:null}]);
});

test("0028 failure rolls back all columns, constraints and functions",async()=>{
  await reset();await migrate(names.slice(0,27));await pool.query("alter table production_routing_operations add column quality_gate_mode text");
  await assert.rejects(migrate(names.slice(27)),/quality_gate_mode.*already exists/i);
  assert.equal((await pool.query("select count(*)::int count from information_schema.columns where table_name='quality_inspections' and column_name='production_operation_run_report_id'")).rows[0].count,0);
  assert.equal((await pool.query("select to_regprocedure('cyd_quality_operation_deferred_validate()') value")).rows[0].value,null);
  assert.equal((await pool.query("select count(*)::int count from schema_migrations where version=$1",[names.at(-1)])).rows[0].count,0);
});

test("schema, snapshot, journal and full SHA-256 describe the same 0028 model",async()=>{
  const schema=await readFile(new URL("../db/schema.ts",import.meta.url),"utf8"),snapshot=JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0028_snapshot.json",import.meta.url),"utf8")),journal=JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json",import.meta.url),"utf8"));
  for(const table of ["public.production_routing_operations","public.production_work_order_routing_snapshot_operations","public.production_operation_wip_projections","public.quality_inspections"])assert.ok(snapshot.tables[table],table);
  assert.ok(snapshot.tables["public.quality_inspections"].columns.production_operation_run_report_id);assert.ok(snapshot.tables["public.production_operation_wip_projections"].columns.quality_hold_qty);
  for(const token of ["qualityGateMode","productionOperationRunReportId","qualityRequiredQty","qualityInspectedQty","qualityReleasedQty","qualityHoldQty"])assert.match(schema,new RegExp(token));
  assert.equal(journal.entries.at(-1).tag,"0028_production_operation_quality_gates");assert.match(checksum(names.at(-1)),/^[0-9a-f]{64}$/);
});
