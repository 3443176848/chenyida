import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_PROJECT_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/project_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_PROJECT_UPGRADE_DATABASE_URL containing project_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "project-migration-upgrade-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url); const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const sources = new Map(); for (const name of names) sources.set(name, await readFile(new URL(name, directory), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("empty database upgrades and repeat execution preserve the 0001-0015 chain", async () => {
  assert.equal(names.length, 15); assert.equal(names[0], "0001_selfhost_baseline.sql"); assert.equal(names.at(-1), "0015_market_project_handoff.sql");
  await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('business_projects') projects,to_regclass('project_requirement_versions') versions,to_regclass('project_requirement_items') items,to_regclass('project_document_links') documents,to_regclass('project_handoffs') handoffs,to_regclass('project_handoff_events') events");
  assert.deepEqual(tables.rows[0], { projects: "business_projects", versions: "project_requirement_versions", items: "project_requirement_items", documents: "project_document_links", handoffs: "project_handoffs", events: "project_handoff_events" });
  const indexes = await pool.query("select indexname from pg_indexes where indexname in ('business_projects_code_uq','project_requirement_versions_project_no_uq','project_requirement_items_version_line_uq','project_handoffs_project_uq','project_handoffs_queue_idx','project_handoff_events_request_idx')"); assert.equal(indexes.rowCount, 6);
});

test("0014 administrator survives expand-only 0015 with no project backfill", async () => {
  await reset(); await migrate(names.slice(0, 14)); await pool.query("insert into app_users(username,display_name,role,password_hash) values('existing_admin','原管理员','admin','test-only')");
  await migrate(names.slice(14)); const admin = await pool.query("select username,role from app_users where username='existing_admin'"); assert.deepEqual(admin.rows[0], { username: "existing_admin", role: "admin" });
  assert.equal(Number((await pool.query("select count(*) count from business_projects")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version='0015_market_project_handoff.sql'")).rows[0].count), 1);
});

test("0015 DDL failure rolls back and database guards reject direct state writes", async () => {
  await reset(); await migrate(names.slice(0, 14)); await pool.query("create table business_projects(id bigint primary key)"); await assert.rejects(migrate(names.slice(14)), /business_projects.*already exists/i);
  assert.equal((await pool.query("select to_regclass('project_requirement_versions') value")).rows[0].value, null); assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version='0015_market_project_handoff.sql'")).rows[0].count), 0);
  await pool.query("drop table business_projects"); await migrate(names.slice(14)); await pool.query("insert into app_users(username,display_name,role,password_hash) values('market_test','市场','sales','test-only')"); await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-PROJ','迁移客户','迁移客户','ACTIVE','test','test',$1)", [randomUUID()]);
  await assert.rejects(pool.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,request_id,created_by) values('PRJ-00000001',1,'绕过','绕过状态机','market_test',$1,'market_test')", [randomUUID()]), /require ProjectService/);
  const foreignKeys = await pool.query("select count(*)::int count from pg_constraint where contype='f' and conrelid::regclass::text in ('business_projects','project_requirement_versions','project_requirement_items','project_document_links','project_handoffs','project_handoff_events')"); assert.ok(foreignKeys.rows[0].count >= 20);
});
