import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl=process.env.TEST_MATERIAL_REQUIREMENT_UPGRADE_DATABASE_URL;
if(!databaseUrl||!/material_requirement_upgrade_test/i.test(databaseUrl))throw new Error("isolated TEST_MATERIAL_REQUIREMENT_UPGRADE_DATABASE_URL containing material_requirement_upgrade_test is required");
const pool=new Pool({connectionString:databaseUrl,max:3,application_name:"material-requirement-upgrade-test"});const directory=new URL("../drizzle-postgres/",import.meta.url);const names=(await readdir(directory)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();const sources=new Map();for(const name of names)sources.set(name,await readFile(new URL(name,directory),"utf8"));const checksum=name=>createHash("sha256").update(sources.get(name)).digest("hex");
async function reset(){await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)")}
async function migrate(list){for(const name of list){const old=await pool.query("select checksum from schema_migrations where version=$1",[name]);if(old.rows[0]){assert.equal(old.rows[0].checksum,checksum(name));continue}const client=await pool.connect();try{await client.query("begin");await client.query(sources.get(name));await client.query("insert into schema_migrations values($1,$2)",[name,checksum(name)]);await client.query("commit")}catch(error){await client.query("rollback");throw error}finally{client.release()}}}
test.after(async()=>pool.end());

test("empty database and repeated upgrade preserve the 0001-0017 chain",async()=>{
  assert.equal(names.length,17);assert.equal(names.at(-1),"0017_planning_material_requirements.sql");await reset();await migrate(names);await migrate(names);
  const tables=await pool.query("select to_regclass('planning_material_requirement_plans') plans,to_regclass('planning_material_requirement_lines') lines,to_regclass('planning_material_allocations') allocations,to_regclass('planning_purchase_requests') requests,to_regclass('planning_purchase_request_lines') request_lines,to_regclass('planning_material_requirement_events') events");
  assert.deepEqual(tables.rows[0],{plans:"planning_material_requirement_plans",lines:"planning_material_requirement_lines",allocations:"planning_material_allocations",requests:"planning_purchase_requests",request_lines:"planning_purchase_request_lines",events:"planning_material_requirement_events"});
  const numeric=await pool.query("select count(*)::int count from information_schema.columns where table_schema='public' and table_name in ('planning_material_requirement_lines','planning_material_allocations','planning_purchase_request_lines') and data_type='numeric' and numeric_precision=24 and numeric_scale=6");assert.equal(numeric.rows[0].count,9);
  const triggers=await pool.query("select count(*)::int count from pg_trigger where not tgisinternal and tgname=any($1)",[["planning_material_requirement_plans_service_guard","planning_material_requirement_lines_immutable","planning_material_allocations_immutable","planning_purchase_requests_service_guard","planning_purchase_request_lines_immutable","planning_material_requirement_events_immutable","planning_submitted_plan_complete","planning_purchase_request_complete"]]);assert.equal(triggers.rows[0].count,8);
});

test("0016 facts and roles survive expand-only 0017",async()=>{
  await reset();await migrate(names.slice(0,16));await pool.query("insert into app_users(username,display_name,role,password_hash) values('planning01','计划','planning','test'),('purchase01','采购','purchase','test')");const before=await pool.query("select username,role from app_users order by username");await migrate(names.slice(16));const after=await pool.query("select username,role from app_users order by username");assert.deepEqual(after.rows,before.rows);assert.equal(Number((await pool.query("select count(*) count from planning_material_requirement_plans")).rows[0].count),0);
});

test("0017 failure rolls back and direct immutable writes fail closed",async()=>{
  await reset();await migrate(names.slice(0,16));await pool.query("create table planning_material_requirement_plans(id bigint primary key)");await assert.rejects(migrate(names.slice(16)),/planning_material_requirement_plans.*already exists/i);assert.equal((await pool.query("select to_regclass('planning_material_allocations') value")).rows[0].value,null);assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version='0017_planning_material_requirements.sql'")).rows[0].count),0);await pool.query("drop table planning_material_requirement_plans");await migrate(names.slice(16));await assert.rejects(pool.query("insert into planning_material_requirement_events(plan_id,event_type,to_status,actor,request_id) values(1,'GENERATED','DRAFT','nobody','00000000-0000-4000-8000-000000000001')"),/service|foreign key/i);
});
