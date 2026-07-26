import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl=process.env.TEST_PRODUCTION_HANDOFF_UPGRADE_DATABASE_URL;
if(!databaseUrl||!/production_handoff_upgrade_test/i.test(databaseUrl))throw new Error("isolated TEST_PRODUCTION_HANDOFF_UPGRADE_DATABASE_URL containing production_handoff_upgrade_test is required");
const pool=new Pool({connectionString:databaseUrl,max:3,application_name:"production-handoff-upgrade-test"}),directory=new URL("../drizzle-postgres/",import.meta.url);
const names=(await readdir(directory)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort(),sources=new Map();for(const name of names)sources.set(name,await readFile(new URL(name,directory),"utf8"));
const checksum=name=>createHash("sha256").update(sources.get(name)).digest("hex");
async function reset(){await pool.query("drop schema public cascade;create schema public;create table schema_migrations(version text primary key,checksum text not null)");}
async function migrate(list){for(const name of list){const previous=await pool.query("select checksum from schema_migrations where version=$1",[name]);if(previous.rows[0]){assert.equal(previous.rows[0].checksum,checksum(name));continue;}const client=await pool.connect();try{await client.query("begin");await client.query(sources.get(name));await client.query("insert into schema_migrations values($1,$2)",[name,checksum(name)]);await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}}}
test.after(async()=>pool.end());

test("empty database and repeated migration produce exactly the 0020 model",async()=>{assert.equal(names.length,20);assert.equal(names.at(-1),"0020_production_handoff_reservations.sql");await reset();await migrate(names);await migrate(names);const tables=await pool.query("select to_regclass('production_handoffs') handoffs,to_regclass('production_handoff_items') items,to_regclass('production_handoff_work_order_links') links,to_regclass('production_inventory_reservations') reservations,to_regclass('production_inventory_reservation_events') events");assert.deepEqual(tables.rows[0],{handoffs:"production_handoffs",items:"production_handoff_items",links:"production_handoff_work_order_links",reservations:"production_inventory_reservations",events:"production_inventory_reservation_events"});});
test("0019 data survives expand-only 0020",async()=>{await reset();await migrate(names.slice(0,19));await pool.query("insert into app_users(username,display_name,role,password_hash) values('admin01','管理员','admin','x')");await migrate(names.slice(19));assert.deepEqual((await pool.query("select username,role from app_users")).rows,[{username:"admin01",role:"admin"}]);assert.equal((await pool.query("select count(*)::int count from schema_migrations")).rows[0].count,20);});
test("0020 failure rolls back without a partial table or migration record",async()=>{await reset();await migrate(names.slice(0,19));await pool.query("create table production_handoffs(id bigint primary key)");await assert.rejects(migrate(names.slice(19)),/production_handoffs.*already exists/i);assert.equal((await pool.query("select to_regclass('production_handoff_items') value")).rows[0].value,null);assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version='0020_production_handoff_reservations.sql'")).rows[0].count),0);});
