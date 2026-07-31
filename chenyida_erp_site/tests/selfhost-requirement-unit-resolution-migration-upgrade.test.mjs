import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_REQUIREMENT_UNIT_RESOLUTION_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/requirement_unit_resolution_upgrade_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_REQUIREMENT_UNIT_RESOLUTION_UPGRADE_DATABASE_URL containing requirement_unit_resolution_upgrade_test is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "requirement-unit-resolution-upgrade-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(directory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name <= "0036_project_requirement_unit_resolution.sql")
  .sort();
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, directory), "utf8")])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");

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

async function withService(setting, callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config($1,'allowed',true)", [setting]);
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

async function seedRequirementFixture() {
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values
      ('resolution_sales','销售测试员','sales','test-only',true,false,1),
      ('resolution_engineer','工程测试员','engineering','test-only',true,false,1)
  `);
  const customer = await pool.query(`
    insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id)
    values('CUS-UNIT-RESOLUTION','单位解析客户','单位解析客户','ACTIVE','resolution_sales','resolution_sales',$1)
    returning id
  `, [randomUUID()]);
  const units = await pool.query(`
    insert into units(code,name,symbol,unit_type,enabled)
    values('PCS','件','件','COUNT',true),('EA','个','个','COUNT',true),('BOX','盒','盒','COUNT',false)
    returning id,code
  `);
  const unitByCode = Object.fromEntries(units.rows.map((row) => [row.code, Number(row.id)]));
  const facts = await withService("cyd.project_service_write", async (client) => {
    const project = await client.query(`
      insert into business_projects(
        project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,
        current_requirement_version_no,version,request_id,created_by
      ) values('PRJ-00000036',$1,'单位解析升级项目','验证可证明回填','resolution_sales','resolution_engineer','ACCEPTED',1,1,$2,'resolution_sales')
      returning id
    `, [customer.rows[0].id, randomUUID()]);
    const version = await client.query(`
      insert into project_requirement_versions(
        project_id,version_no,customer_requirement_summary,content_digest,created_by
      ) values($1,1,'单位解析升级需求',$2,'resolution_sales') returning id
    `, [project.rows[0].id, "a".repeat(64)]);
    const items = await client.query(`
      insert into project_requirement_items(
        requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending
      ) values
        ($1,10,'已声明启用单位',10,$2,false),
        ($1,20,'待工程确认单位',10,null,true),
        ($1,30,'已声明历史停用单位',10,$3,false)
      returning id,line_no
    `, [version.rows[0].id, unitByCode.PCS, unitByCode.BOX]);
    return {
      projectId: Number(project.rows[0].id),
      requirementVersionId: Number(version.rows[0].id),
      itemByLine: Object.fromEntries(items.rows.map((row) => [Number(row.line_no), Number(row.id)])),
    };
  });
  return { ...facts, unitByCode, customerId: Number(customer.rows[0].id) };
}

async function seedReleasedProductBom(fixture) {
  const product = await pool.query(`
    insert into products(
      product_code,product_name,customer_id,status,current_version_no,version,created_by,updated_by,request_id
    ) values('UNIT-RESOLUTION-PRODUCT','单位解析产品',$1,'ACTIVE',1,1,'resolution_engineer','resolution_engineer',$2)
    returning id
  `, [fixture.customerId, randomUUID()]);
  const productVersion = await pool.query(`
    insert into product_versions(
      product_id,version_no,version_code,status,product_type,lifecycle_status,released_by,released_at,
      created_by,updated_by,request_id
    ) values($1,1,'A0','RELEASED','PCB','ACTIVE','resolution_engineer',now(),
      'resolution_engineer','resolution_engineer',$2) returning id
  `, [product.rows[0].id, randomUUID()]);
  const bomHeader = await pool.query(`
    insert into bom_headers(
      bom_code,product_id,status,current_version_no,version,created_by,updated_by,request_id
    ) values('BOM-UNIT-RESOLUTION-V1',$1,'ACTIVE',1,1,'resolution_engineer','resolution_engineer',$2)
    returning id
  `, [product.rows[0].id, randomUUID()]);
  const bomVersion = await pool.query(`
    insert into bom_versions(
      bom_header_id,product_version_id,version_no,version_code,status,released_by,released_at,
      created_by,updated_by,request_id
    ) values($1,$2,1,'V1','RELEASED','resolution_engineer',now(),
      'resolution_engineer','resolution_engineer',$3) returning id
  `, [bomHeader.rows[0].id, productVersion.rows[0].id, randomUUID()]);
  return { productVersionId: Number(productVersion.rows[0].id), bomVersionId: Number(bomVersion.rows[0].id) };
}

test.after(async () => pool.end());

test("empty database and repeated runner reach exactly migration 0036", async () => {
  assert.equal(names.length, 36);
  assert.equal(names.at(-1), "0036_project_requirement_unit_resolution.sql");
  await reset();
  await migrate(names);
  await migrate(names);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations")).rows[0].count, 36);
  assert.deepEqual((await pool.query(`
    select to_regclass('project_requirement_unit_resolution_versions') versions,
      to_regclass('project_requirement_unit_resolution_heads') heads
  `)).rows[0], {
    versions: "project_requirement_unit_resolution_versions",
    heads: "project_requirement_unit_resolution_heads",
  });
  assert.equal((await pool.query(`
    select is_nullable from information_schema.columns
    where table_schema='public' and table_name='project_planning_package_items' and column_name='unit_resolution_id'
  `)).rows[0].is_nullable, "YES");
});

test("0034 to 0035 to 0036 backfills only declared source units and preserves pending facts", async () => {
  await reset();
  await migrate(names.slice(0, 34));
  const fixture = await seedRequirementFixture();
  const before = await pool.query(`
    select id,line_no,unit_id,unit_pending from project_requirement_items
    where requirement_version_id=$1 order by line_no
  `, [fixture.requirementVersionId]);
  await migrate(names.slice(34, 35));
  assert.deepEqual((await pool.query(`
    select id,line_no,unit_id,unit_pending from project_requirement_items
    where requirement_version_id=$1 order by line_no
  `, [fixture.requirementVersionId])).rows, before.rows);
  await migrate(names.slice(35));
  const after = await pool.query(`
    select id,line_no,unit_id,unit_pending from project_requirement_items
    where requirement_version_id=$1 order by line_no
  `, [fixture.requirementVersionId]);
  assert.deepEqual(after.rows, before.rows);

  const versions = await pool.query(`
    select requirement_item_id,resolution_version_no,unit_id,source_type,resolved_by,
      length(content_digest)::integer digest_length
    from project_requirement_unit_resolution_versions order by requirement_item_id
  `);
  assert.deepEqual(versions.rows.map((row) => ({
    item: Number(row.requirement_item_id), version: Number(row.resolution_version_no), unit: Number(row.unit_id),
    source: row.source_type, actor: row.resolved_by, digest: Number(row.digest_length),
  })), [
    { item: fixture.itemByLine[10], version: 1, unit: fixture.unitByCode.PCS, source: "REQUIREMENT_DECLARED", actor: "resolution_sales", digest: 64 },
    { item: fixture.itemByLine[30], version: 1, unit: fixture.unitByCode.BOX, source: "REQUIREMENT_DECLARED", actor: "resolution_sales", digest: 64 },
  ]);
  assert.deepEqual((await pool.query(`
    select requirement_item_id,version from project_requirement_unit_resolution_heads order by requirement_item_id
  `)).rows.map((row) => [Number(row.requirement_item_id), Number(row.version)]), [
    [fixture.itemByLine[10], 1], [fixture.itemByLine[30], 1],
  ]);
  assert.equal((await pool.query(`
    select count(*)::integer count from project_requirement_unit_resolution_versions where requirement_item_id=$1
  `, [fixture.itemByLine[20]])).rows[0].count, 0);
});

test("0035 to 0036 direct upgrade records the new head without guessing pending rows", async () => {
  await reset();
  await migrate(names.slice(0, 35));
  const fixture = await seedRequirementFixture();
  await migrate(names.slice(35));
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations")).rows[0].count, 36);
  assert.equal((await pool.query(`
    select count(*)::integer count from project_requirement_unit_resolution_versions
    where source_type='REQUIREMENT_DECLARED'
  `)).rows[0].count, 2);
  assert.equal((await pool.query(`
    select count(*)::integer count from project_requirement_unit_resolution_heads
    where requirement_item_id=$1
  `, [fixture.itemByLine[20]])).rows[0].count, 0);
});

test("service guards enforce source ownership append-only versions and monotonic heads", async () => {
  await reset();
  await migrate(names.slice(0, 35));
  const fixture = await seedRequirementFixture();
  await migrate(names.slice(35));

  const insertEngineering = (client, unitId, versionNo, supersedesId, digestChar) => client.query(`
    insert into project_requirement_unit_resolution_versions(
      project_id,requirement_version_id,requirement_item_id,resolution_version_no,unit_id,
      source_type,supersedes_resolution_id,resolved_by,request_id,content_digest
    ) values($1,$2,$3,$4,$5,'ENGINEERING_CONFIRMED',$6,'resolution_engineer',$7,$8)
    returning id
  `, [fixture.projectId, fixture.requirementVersionId, fixture.itemByLine[20], versionNo, unitId, supersedesId, randomUUID(), digestChar.repeat(64)]);

  await assert.rejects(
    pool.query(`
      insert into project_requirement_unit_resolution_versions(
        project_id,requirement_version_id,requirement_item_id,resolution_version_no,unit_id,
        source_type,resolved_by,request_id,content_digest
      ) values($1,$2,$3,1,$4,'ENGINEERING_CONFIRMED','resolution_engineer',$5,$6)
    `, [fixture.projectId, fixture.requirementVersionId, fixture.itemByLine[20], fixture.unitByCode.PCS, randomUUID(), "b".repeat(64)]),
    /PlanningHandoffService/i,
  );
  await assert.rejects(
    withService("cyd.project_service_write", (client) => insertEngineering(client, fixture.unitByCode.PCS, 1, null, "b")),
    /PlanningHandoffService/i,
  );
  await assert.rejects(
    withService("cyd.planning_service_write", (client) => insertEngineering(client, fixture.unitByCode.BOX, 1, null, "b")),
    /enabled unit/i,
  );

  const firstId = await withService("cyd.planning_service_write", async (client) => {
    const inserted = await insertEngineering(client, fixture.unitByCode.PCS, 1, null, "b");
    await client.query(`
      insert into project_requirement_unit_resolution_heads(
        requirement_item_id,project_id,requirement_version_id,current_resolution_id,version
      ) values($1,$2,$3,$4,1)
    `, [fixture.itemByLine[20], fixture.projectId, fixture.requirementVersionId, inserted.rows[0].id]);
    return Number(inserted.rows[0].id);
  });
  const secondId = await withService("cyd.planning_service_write", async (client) => {
    const inserted = await insertEngineering(client, fixture.unitByCode.EA, 2, firstId, "c");
    const advanced = await client.query(`
      update project_requirement_unit_resolution_heads
      set current_resolution_id=$1,version=version+1,updated_at=now()
      where requirement_item_id=$2 and version=1 returning version
    `, [inserted.rows[0].id, fixture.itemByLine[20]]);
    assert.equal(Number(advanced.rows[0].version), 2);
    return Number(inserted.rows[0].id);
  });
  assert.notEqual(secondId, firstId);
  await assert.rejects(
    withService("cyd.planning_service_write", (client) => client.query(`
      update project_requirement_unit_resolution_heads
      set version=version+1 where requirement_item_id=$1
    `, [fixture.itemByLine[20]])),
    /head version must advance once/i,
  );
  await assert.rejects(
    pool.query("update project_requirement_unit_resolution_versions set content_digest=$1 where id=$2", ["d".repeat(64), firstId]),
    /versions are immutable/i,
  );
  await assert.rejects(
    pool.query("delete from project_requirement_unit_resolution_versions where id=$1", [firstId]),
    /versions are immutable/i,
  );
  assert.deepEqual((await pool.query(`
    select version,current_resolution_id from project_requirement_unit_resolution_heads where requirement_item_id=$1
  `, [fixture.itemByLine[20]])).rows.map((row) => [Number(row.version), Number(row.current_resolution_id)]), [[2, secondId]]);
});

test("new package items require exact current provenance and disabled units do not erase history", async () => {
  await reset();
  await migrate(names.slice(0, 35));
  const fixture = await seedRequirementFixture();
  await migrate(names.slice(35));
  const product = await seedReleasedProductBom(fixture);
  const resolutions = await pool.query(`
    select requirement_item_id,id from project_requirement_unit_resolution_versions
    where requirement_item_id in ($1,$2)
  `, [fixture.itemByLine[10], fixture.itemByLine[30]]);
  const resolutionByItem = Object.fromEntries(resolutions.rows.map((row) => [Number(row.requirement_item_id), Number(row.id)]));

  const firstPackage = await withService("cyd.planning_service_write", async (client) => {
    const inserted = await client.query(`
      insert into project_planning_packages(
        project_id,package_version_no,requirement_version_id,status,package_digest,prepared_by,request_id
      ) values($1,1,$2,'DRAFT',$3,'resolution_engineer',$4) returning id
    `, [fixture.projectId, fixture.requirementVersionId, "1".repeat(64), randomUUID()]);
    await client.query("savepoint missing_provenance");
    await assert.rejects(client.query(`
      insert into project_planning_package_items(
        package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,line_no,source_digest
      ) values($1,$2,$3,$4,10,$5,10,$6)
    `, [inserted.rows[0].id, fixture.itemByLine[10], product.productVersionId, product.bomVersionId, fixture.unitByCode.PCS, "2".repeat(64)]), /requires unit resolution provenance/i);
    await client.query("rollback to savepoint missing_provenance");
    await client.query(`
      insert into project_planning_package_items(
        package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,line_no,source_digest,unit_resolution_id
      ) values($1,$2,$3,$4,10,$5,10,$6,$7)
    `, [inserted.rows[0].id, fixture.itemByLine[10], product.productVersionId, product.bomVersionId, fixture.unitByCode.PCS, "2".repeat(64), resolutionByItem[fixture.itemByLine[10]]]);
    return Number(inserted.rows[0].id);
  });
  await pool.query("update units set enabled=false where id=$1", [fixture.unitByCode.PCS]);
  assert.deepEqual((await pool.query(`
    select package_id,requirement_item_id,unit_id,unit_resolution_id
    from project_planning_package_items where package_id=$1
  `, [firstPackage])).rows.map((row) => Object.values(row).map(Number)), [[
    firstPackage, fixture.itemByLine[10], fixture.unitByCode.PCS, resolutionByItem[fixture.itemByLine[10]],
  ]]);
  await assert.rejects(withService("cyd.planning_service_write", async (client) => {
    const second = await client.query(`
      insert into project_planning_packages(
        project_id,package_version_no,requirement_version_id,status,package_digest,prepared_by,request_id
      ) values($1,2,$2,'DRAFT',$3,'resolution_engineer',$4) returning id
    `, [fixture.projectId, fixture.requirementVersionId, "3".repeat(64), randomUUID()]);
    await client.query(`
      insert into project_planning_package_items(
        package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,line_no,source_digest,unit_resolution_id
      ) values($1,$2,$3,$4,10,$5,10,$6,$7)
    `, [second.rows[0].id, fixture.itemByLine[10], product.productVersionId, product.bomVersionId, fixture.unitByCode.PCS, "4".repeat(64), resolutionByItem[fixture.itemByLine[10]]]);
  }), /references are inconsistent/i);
});

test("0036 DDL failure rolls back tables column backfill guards and migration record", async () => {
  await reset();
  await migrate(names.slice(0, 35));
  await pool.query("create table project_requirement_unit_resolution_heads(dummy integer)");
  await assert.rejects(migrate(names.slice(35)), /project_requirement_unit_resolution_heads.*already exists/i);
  assert.equal((await pool.query("select to_regclass('project_requirement_unit_resolution_versions') value")).rows[0].value, null);
  assert.equal((await pool.query(`
    select count(*)::integer count from information_schema.columns
    where table_name='project_planning_package_items' and column_name='unit_resolution_id'
  `)).rows[0].count, 0);
  assert.equal((await pool.query("select to_regprocedure('cyd_requirement_unit_resolution_version_guard()') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version=$1", [names[35]])).rows[0].count, 0);
});
