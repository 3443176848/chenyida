import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_PLANNING_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/planning_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_PLANNING_UPGRADE_DATABASE_URL containing planning_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "planning-migration-upgrade-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url); const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const sources = new Map(); for (const name of names) sources.set(name, await readFile(new URL(name, directory), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("empty database upgrades and repeated migration preserve the 0001-0016 chain", async () => {
  assert.equal(names.length, 16); assert.equal(names[0], "0001_selfhost_baseline.sql"); assert.equal(names.at(-1), "0016_project_planning_handoff.sql");
  await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('project_requirement_resolutions') resolutions,to_regclass('project_planning_packages') packages,to_regclass('project_planning_package_items') items,to_regclass('project_planning_package_bom_lines') bom_lines,to_regclass('project_planning_document_links') documents,to_regclass('project_planning_handoff_events') events");
  assert.deepEqual(tables.rows[0], { resolutions: "project_requirement_resolutions", packages: "project_planning_packages", items: "project_planning_package_items", bom_lines: "project_planning_package_bom_lines", documents: "project_planning_document_links", events: "project_planning_handoff_events" });
  const roles = await pool.query("insert into app_users(username,display_name,role,password_hash) values('planning01','计划员','planning','test-only') returning role"); assert.equal(roles.rows[0].role, "planning");
  const indexes = await pool.query("select count(*)::int count from pg_indexes where indexname in ('project_requirement_resolutions_project_idx','project_planning_packages_queue_idx','project_planning_packages_project_idx','project_planning_handoff_events_request_idx')"); assert.equal(indexes.rows[0].count, 4);
});

test("0015 administrator, ten legacy roles and market-project facts survive expand-only 0016", async () => {
  await reset(); await migrate(names.slice(0, 15));
  const roles = ["admin","manager","purchase","engineering","production","warehouse","quality","sales","finance","operations"];
  for (const [index, role] of roles.entries()) await pool.query("insert into app_users(username,display_name,role,password_hash) values($1,$2,$3,'test-only')", [`legacy${index}`, role, role]);
  const customer = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-UPGRADE-16','升级客户','升级客户','ACTIVE','legacy7','legacy7',$1) returning id", [randomUUID()]);
  const client = await pool.connect(); try { await client.query("begin"); await client.query("select set_config('cyd.project_service_write','allowed',true)");
    const project = await client.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,current_requirement_version_no,version,request_id,created_by) values('PRJ-00000016',$1,'升级项目','保留 TASK01 事实','legacy7','legacy3','ACCEPTED',1,4,$2,'legacy7') returning id", [customer.rows[0].id, randomUUID()]);
    const version = await client.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'升级需求',2,'件',$2,'legacy7') returning id", [project.rows[0].id, "a".repeat(64)]);
    const handoff = await client.query("insert into project_handoffs(project_id,requirement_version_id,status,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id) values($1,$2,'ACCEPTED','legacy7',now(),'legacy3',now(),2,$3) returning id", [project.rows[0].id, version.rows[0].id, randomUUID()]);
    await client.query("insert into project_handoff_events(handoff_id,project_id,requirement_version_id,event_type,actor,request_id) values($1,$2,$3,'SUBMITTED','legacy7',$4),($1,$2,$3,'ACCEPTED','legacy3',$5)", [handoff.rows[0].id, project.rows[0].id, version.rows[0].id, randomUUID(), randomUUID()]); await client.query("commit");
  } finally { client.release(); }
  const before = await pool.query("select p.status,p.version,h.status handoff_status,(select count(*)::int from project_handoff_events) events from business_projects p join project_handoffs h on h.project_id=p.id");
  await migrate(names.slice(15)); const after = await pool.query("select p.status,p.version,h.status handoff_status,(select count(*)::int from project_handoff_events) events from business_projects p join project_handoffs h on h.project_id=p.id");
  assert.deepEqual(after.rows, before.rows); assert.deepEqual((await pool.query("select role,count(*)::int count from app_users group by role order by role")).rows.map(row=>row.role).sort(), roles.sort());
  assert.equal(Number((await pool.query("select count(*) count from project_planning_packages")).rows[0].count), 0);
});

test("0016 DDL failure rolls back and guards reject direct snapshot and event writes", async () => {
  await reset(); await migrate(names.slice(0, 15)); await pool.query("create table project_planning_packages(id bigint primary key)");
  await assert.rejects(migrate(names.slice(15)), /project_planning_packages.*already exists/i);
  assert.equal((await pool.query("select to_regclass('project_requirement_resolutions') value")).rows[0].value, null); assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version='0016_project_planning_handoff.sql'")).rows[0].count), 0);
  await pool.query("drop table project_planning_packages"); await migrate(names.slice(15));
  await assert.rejects(pool.query("insert into project_planning_handoff_events(package_id,project_id,event_type,actor,request_id) values(1,1,'SUBMITTED','nobody',$1)", [randomUUID()]), /PlanningHandoffService|foreign key/i);
  const foreignKeys = await pool.query("select count(*)::int count from pg_constraint where contype='f' and conrelid::regclass::text in ('project_requirement_resolutions','project_planning_packages','project_planning_package_items','project_planning_package_bom_lines','project_planning_document_links','project_planning_handoff_events')"); assert.ok(foreignKeys.rows[0].count >= 25);
});
