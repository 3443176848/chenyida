import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_PLANNING_REVISION_MIGRATION_DATABASE_URL;
if (!databaseUrl || !/planning_revision_migration_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_PLANNING_REVISION_MIGRATION_DATABASE_URL containing planning_revision_migration_test is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "planning-revision-migration-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 37).sort();
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, directory), "utf8")])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
const migration = sources.get("0037_project_planning_revision_response_lineage.sql");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const journal = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json", import.meta.url), "utf8"));
const snapshot36 = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0036_snapshot.json", import.meta.url), "utf8"));
const snapshot37 = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0037_snapshot.json", import.meta.url), "utf8"));

async function reset() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)");
}

async function migrate(list) {
  for (const name of list) {
    const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (existing.rows[0]) {
      assert.equal(existing.rows[0].checksum, checksum(name));
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sources.get(name));
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function withPlanningWrite(callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.planning_service_write','allowed',true)");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function seedReturnedHistory() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values
    ('revision_sales','销售测试员','sales','test-only',true,false,1),
    ('revision_engineer','工程测试员','engineering','test-only',true,false,1),
    ('revision_planning','计划测试员','planning','test-only',true,false,1)`);
  const customer = await pool.query(`insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id)
    values('CUS-REVISION-MIGRATION','修订迁移客户','修订迁移客户','ACTIVE','revision_sales','revision_sales',$1) returning id`, [randomUUID()]);
  const project = await withPlanningWrite(async (client) => {
    await client.query("select set_config('cyd.project_service_write','allowed',true)");
    const saved = await client.query(`insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,current_requirement_version_no,version,request_id,created_by)
      values('PRJ-00000037',$1,'修订迁移项目','验证历史退回不伪造回复','revision_sales','revision_engineer','ACCEPTED',1,4,$2,'revision_sales') returning id`, [customer.rows[0].id, randomUUID()]);
    const requirement = await client.query(`insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,technical_requirements,content_digest,created_by)
      values($1,1,'历史退回包',10,'PCS','保持原样',$2,'revision_sales') returning id`, [saved.rows[0].id, "a".repeat(64)]);
    const packages = [];
    for (const versionNo of [1, 2]) {
      const reason = versionNo === 1 ? "历史 v1 Planning 退回，升级不得伪造工程回复。" : "历史 v2 Planning 退回，仅用于归属约束测试。";
      const packageRow = await client.query(`insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,package_digest,prepared_by,submitted_by,submitted_at,returned_by,returned_at,return_reason,version,request_id)
        values($1,$2,$3,'RETURNED',$4,'revision_engineer','revision_engineer',now(),'revision_planning',now(),$5,3,$6) returning id`, [saved.rows[0].id, versionNo, requirement.rows[0].id, String(versionNo).repeat(64), reason, randomUUID()]);
      const event = await client.query(`insert into project_planning_handoff_events(package_id,project_id,event_type,actor,reason,request_id)
        values($1,$2,'RETURNED','revision_planning',$3,$4) returning id`, [packageRow.rows[0].id, saved.rows[0].id, reason, randomUUID()]);
      packages.push({ packageId: Number(packageRow.rows[0].id), returnEventId: Number(event.rows[0].id), reason });
    }
    return { projectId: Number(saved.rows[0].id), requirementVersionId: Number(requirement.rows[0].id), packages };
  });
  return project;
}

test.after(async () => pool.end());

test("0037 static schema, journal and immutable 0001-0036 checksums are aligned", () => {
  assert.equal(names.length, 37);
  assert.equal(names.at(-1), "0037_project_planning_revision_response_lineage.sql");
  const immutableDigest = createHash("sha256").update(names.slice(0, 36).map((name) => `${name}:${checksum(name)}\n`).join("")).digest("hex");
  assert.equal(immutableDigest, "fedf885f6b495281578ee38d773571a5a4480425af5e22cf30de02a9e73c63e5");
  const entry = journal.entries.find((candidate) => candidate.idx === 37);
  assert.equal(entry?.idx, 37);
  assert.equal(entry?.tag, "0037_project_planning_revision_response_lineage");
  assert.equal(snapshot37.prevId, snapshot36.id);
  for (const table of ["project_planning_revision_response_versions", "project_planning_revision_response_heads"]) {
    assert.ok(snapshot37.tables[`public.${table}`]);
    assert.match(schema, new RegExp(`pgTable\\("${table}"`));
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  for (const column of ["previous_package_id", "responds_to_return_event_id", "revision_response_version_id"]) {
    assert.ok(snapshot37.tables["public.project_planning_packages"].columns[column]);
    assert.match(migration, new RegExp(`ADD COLUMN "${column}"`));
  }
  for (const token of [
    "project_planning_revision_response_versions_return_source_fk",
    "project_planning_revision_response_heads_current_lineage_fk",
    "project_planning_packages_response_source_fk",
    "project_planning_packages_previous_uq",
    "project_planning_packages_return_successor_uq",
    "project_planning_packages_project_response_uq",
    "planning revision response versions are immutable",
    "new successor planning packages require complete revision lineage",
    "planning successor item must copy the fixed source package item",
    "planning successor BOM snapshot must copy the fixed source snapshot",
  ]) assert.match(migration, new RegExp(token));
  assert.doesNotMatch(migration, /INSERT INTO\s+"?project_planning_revision_response_versions"?/i);
});

test("empty database migrates 0001 to 0037 and repeated runner is a checksum-verified no-op", async () => {
  await reset();
  await migrate(names);
  await migrate(names);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations")).rows[0].count, 37);
  assert.deepEqual((await pool.query(`select to_regclass('project_planning_revision_response_versions') versions,to_regclass('project_planning_revision_response_heads') heads`)).rows[0], {
    versions: "project_planning_revision_response_versions",
    heads: "project_planning_revision_response_heads",
  });
});

test("0036 to 0037 preserves returned v1 without inventing a response and enforces ownership, CAS and SQL guards", async () => {
  await reset(); await migrate(names.slice(0, 36));
  const fixture = await seedReturnedHistory(); const v1 = fixture.packages[0]; const unrelated = fixture.packages[1];
  const before = await pool.query("select row_to_json(pp)::text fingerprint from project_planning_packages pp where id=$1", [v1.packageId]);
  await migrate(names.slice(36));
  const after = await pool.query("select row_to_json(pp)::text fingerprint from project_planning_packages pp where id=$1", [v1.packageId]);
  const beforeObject = JSON.parse(before.rows[0].fingerprint); const afterObject = JSON.parse(after.rows[0].fingerprint);
  for (const column of ["previous_package_id", "responds_to_return_event_id", "revision_response_version_id"]) delete afterObject[column];
  assert.deepEqual(afterObject, beforeObject);
  assert.equal(Number((await pool.query("select count(*) count from project_planning_revision_response_versions")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from project_planning_revision_response_heads")).rows[0].count), 0);
  assert.deepEqual((await pool.query("select previous_package_id,responds_to_return_event_id,revision_response_version_id from project_planning_packages where id=$1", [v1.packageId])).rows[0], { previous_package_id: null, responds_to_return_event_id: null, revision_response_version_id: null });

  const text = "工程修订回复：中文，全角标点保持，且关联精确 RETURN。";
  await assert.rejects(withPlanningWrite((client) => client.query(`insert into project_planning_revision_response_versions(source_package_id,return_event_id,project_id,response_version_no,response_text,response_text_digest,created_by,request_id)
    values($1,$2,$3,1,$4,encode(digest(convert_to($4,'UTF8'),'sha256'),'hex'),'revision_engineer',$5)`, [v1.packageId, unrelated.returnEventId, fixture.projectId, text, randomUUID()])), /source package RETURN event|foreign key/i);
  const responseId = await withPlanningWrite(async (client) => {
    const response = await client.query(`insert into project_planning_revision_response_versions(source_package_id,return_event_id,project_id,response_version_no,response_text,response_text_digest,created_by,request_id)
      values($1,$2,$3,1,$4,encode(digest(convert_to($4,'UTF8'),'sha256'),'hex'),'revision_engineer',$5) returning id`, [v1.packageId, v1.returnEventId, fixture.projectId, text, randomUUID()]);
    await client.query(`insert into project_planning_revision_response_heads(return_event_id,source_package_id,project_id,current_response_version_id,version) values($1,$2,$3,$4,1)`, [v1.returnEventId, v1.packageId, fixture.projectId, response.rows[0].id]);
    return Number(response.rows[0].id);
  });
  await assert.rejects(pool.query("update project_planning_revision_response_versions set response_text='直接修改' where id=$1", [responseId]), /immutable/i);
  await assert.rejects(pool.query("delete from project_planning_revision_response_versions where id=$1", [responseId]), /immutable/i);
  await assert.rejects(pool.query("update project_planning_revision_response_heads set version=2 where return_event_id=$1", [v1.returnEventId]), /PlanningHandoffService/i);
  await assert.rejects(pool.query("update project_planning_packages set package_digest=$2 where id=$1", [v1.packageId, "f".repeat(64)]), /PlanningHandoffService|immutable/i);
  const finalV1 = await pool.query("select status,package_digest,return_reason,previous_package_id,responds_to_return_event_id,revision_response_version_id from project_planning_packages where id=$1", [v1.packageId]);
  assert.deepEqual(finalV1.rows[0], { status: "RETURNED", package_digest: "1".repeat(64), return_reason: v1.reason, previous_package_id: null, responds_to_return_event_id: null, revision_response_version_id: null });
});

test("0037 DDL failure rolls back every table, column, function and migration record", async () => {
  await reset(); await migrate(names.slice(0, 36));
  await pool.query("create table project_planning_revision_response_heads(dummy integer)");
  await assert.rejects(migrate(names.slice(36)), /project_planning_revision_response_heads.*already exists/i);
  assert.equal((await pool.query("select to_regclass('project_planning_revision_response_versions') value")).rows[0].value, null);
  assert.equal((await pool.query(`select count(*)::integer count from information_schema.columns where table_name='project_planning_packages' and column_name in ('previous_package_id','responds_to_return_event_id','revision_response_version_id')`)).rows[0].count, 0);
  assert.equal((await pool.query("select to_regprocedure('cyd_planning_revision_response_version_guard()') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version=$1", [names[36]])).rows[0].count, 0);
});
