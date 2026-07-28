import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import {
  MATERIAL_ATTRIBUTES as MATERIAL_ATTRIBUTES_V1,
  MATERIAL_CATEGORIES as MATERIAL_CATEGORIES_V1,
  MATERIAL_CATEGORY_BINDINGS as MATERIAL_CATEGORY_BINDINGS_V1,
} from "../seeds/material-category-v1.ts";

const databaseUrl = process.env.TEST_GOVERNANCE_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/material_governance_upgrade_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_GOVERNANCE_UPGRADE_DATABASE_URL containing material_governance_upgrade_test is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "material-governance-upgrade-test" });
const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name <= "0035_bom_material_governance.sql")
  .sort();
const migrationSources = new Map();
for (const name of migrationNames) migrationSources.set(name, await readFile(new URL(name, migrationDirectory), "utf8"));
const checksum = (name) => createHash("sha256").update(migrationSources.get(name)).digest("hex");

async function reset() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)");
}

async function migrate(names) {
  for (const name of names) {
    const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (existing.rows[0]) {
      assert.equal(existing.rows[0].checksum, checksum(name));
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migrationSources.get(name));
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

async function seedGovernanceMetadataV1(username) {
  const targetLeaves = new Set([
    "RES_CHIP", "CAP_CHIP", "IND_CHIP", "CONN_BOARD_STD", "CONN_FPC_STD",
    "IC_BGA", "IC_QFN", "DIODE_SMD", "MOS_SMD",
  ]);
  const categoriesByCode = new Map(MATERIAL_CATEGORIES_V1.map((item) => [item.code, item]));
  const selectedCategories = new Set(targetLeaves);
  for (const leaf of targetLeaves) {
    let current = categoriesByCode.get(leaf);
    while (current?.parentCode) {
      selectedCategories.add(current.parentCode);
      current = categoriesByCode.get(current.parentCode);
    }
  }
  const categoryIds = new Map();
  for (const item of MATERIAL_CATEGORIES_V1.filter((candidate) => selectedCategories.has(candidate.code))) {
    const inserted = await pool.query(`
      insert into material_categories(
        category_code,category_name_cn,parent_id,category_level,status,sort_order,version,
        created_by,updated_by,request_id
      ) values($1,$2,$3,$4,'ACTIVE',$5,1,$6,$6,$7) returning id
    `, [item.code, item.name, item.parentCode ? categoryIds.get(item.parentCode) : null, item.level, item.sortOrder, username, "00340000-0000-4000-8000-000000000001"]);
    categoryIds.set(item.code, Number(inserted.rows[0].id));
  }
  const selectedBindings = MATERIAL_CATEGORY_BINDINGS_V1.filter((item) => targetLeaves.has(item.categoryCode));
  const selectedAttributes = new Set(selectedBindings.flatMap((item) => item.attributeCodes));
  const attributeIds = new Map();
  for (const item of MATERIAL_ATTRIBUTES_V1.filter((candidate) => selectedAttributes.has(candidate.code))) {
    const inserted = await pool.query(`
      insert into material_attribute_definitions(
        attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
        normalization_rule,status,version,created_by,updated_by,request_id
      ) values($1,$2,$3,$4,$5,$6::jsonb,'NONE','ACTIVE',1,$7,$7,$8) returning id
    `, [item.code, item.name, item.type, item.scale || 0, item.unit || "", JSON.stringify(item.values || []), username, "00340000-0000-4000-8000-000000000002"]);
    attributeIds.set(item.code, Number(inserted.rows[0].id));
  }
  for (const binding of selectedBindings) {
    for (const [sortOrder, code] of binding.attributeCodes.entries()) {
      await pool.query(`
        insert into material_category_attributes(
          category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,
          sort_order,status,created_by,updated_by,request_id
        ) values($1,$2,$3,false,true,$4,'ACTIVE',$5,$5,$6)
      `, [categoryIds.get(binding.categoryCode), attributeIds.get(code), binding.requiredCodes.includes(code), sortOrder, username, "00340000-0000-4000-8000-000000000003"]);
    }
  }
}

test.after(async () => pool.end());

test("empty database and repeated runner reach exactly migration 0035", async () => {
  assert.equal(migrationNames.length, 35);
  assert.equal(migrationNames.at(-1), "0035_bom_material_governance.sql");
  await reset();
  await migrate(migrationNames);
  await migrate(migrationNames);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations")).rows[0].count, 35);
  assert.equal((await pool.query("select count(*)::integer count from information_schema.tables where table_schema='public' and table_name like 'material_governance_%'")).rows[0].count, 9);
  assert.equal((await pool.query("select count(*)::integer count from information_schema.columns where table_name='material_import_mappings' and column_name in ('header_start_row_number','header_end_row_number','data_start_row_number','structure_confidence','structure_status','adaptive_algorithm_version')")).rows[0].count, 6);
});

test("0034 data upgrades expand-only without changing existing import records", async () => {
  await reset();
  await migrate(migrationNames.slice(0, 34));
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('governance_legacy','旧治理员','manager','test-only',true,false,1)
  `);
  await seedGovernanceMetadataV1("governance_legacy");
  await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version,total_rows,accepted_rows,rejected_rows)
    values('IMP-GOVERNANCE-LEGACY','CSV','NORMALIZED','governance_legacy',7,3,2,1)
  `);
  const before = (await pool.query("select * from material_import_batches where batch_no='IMP-GOVERNANCE-LEGACY'")).rows[0];
  await migrate(migrationNames.slice(34));
  const after = (await pool.query("select * from material_import_batches where batch_no='IMP-GOVERNANCE-LEGACY'")).rows[0];
  assert.equal(after.id, before.id);
  assert.equal(after.current_version, 7);
  assert.equal(after.total_rows, 3);
  assert.equal(after.accepted_rows, 2);
  assert.equal(after.rejected_rows, 1);
  assert.equal((await pool.query("select count(*)::integer count from material_governance_runs")).rows[0].count, 0);
  assert.deepEqual(
    (await pool.query(`
      select attribute_code,decimal_scale from material_attribute_definitions
      where attribute_code in ('RESISTANCE','POWER','CAPACITANCE','INDUCTANCE','RATED_VOLTAGE','PITCH')
      order by attribute_code
    `)).rows.map((row) => [row.attribute_code, Number(row.decimal_scale)]),
    [["CAPACITANCE", 18], ["INDUCTANCE", 12], ["PITCH", 6], ["POWER", 6], ["RATED_VOLTAGE", 6], ["RESISTANCE", 6]],
  );
  assert.equal((await pool.query(`
    select count(*)::integer count from material_attribute_definitions
    where attribute_code in ('DIELECTRIC','RATED_CURRENT','STRUCTURE','FREQUENCY')
  `)).rows[0].count, 4);
  assert.equal((await pool.query(`
    select count(*)::integer count from material_categories
    where category_code in ('IC_SOT','IC_SMD_OTHER','SEMI_TRANS','TRANS_SMD','PASS_OSCILLATOR','OSC_SMD')
      and status='ACTIVE'
  `)).rows[0].count, 6);
  const required = await pool.query(`
    select category.category_code,definition.attribute_code,binding.is_required
    from material_category_attributes binding
    join material_categories category on category.id=binding.category_id
    join material_attribute_definitions definition on definition.id=binding.attribute_definition_id
    where (category.category_code='CAP_CHIP' and definition.attribute_code in ('DIELECTRIC','BRAND'))
       or (category.category_code='IC_SOT' and definition.attribute_code in ('MPN','PACKAGE'))
    order by category.category_code,definition.attribute_code
  `);
  assert.deepEqual(required.rows, [
    { category_code: "CAP_CHIP", attribute_code: "BRAND", is_required: false },
    { category_code: "CAP_CHIP", attribute_code: "DIELECTRIC", is_required: true },
    { category_code: "IC_SOT", attribute_code: "MPN", is_required: true },
    { category_code: "IC_SOT", attribute_code: "PACKAGE", is_required: true },
  ]);
  await migrate(migrationNames.slice(34));
  assert.equal((await pool.query("select count(*)::integer count from audit_log where action='MATERIAL_GOVERNANCE_METADATA_V2_APPLIED'")).rows[0].count, 1);
});

test("0035 failure rolls back all earlier statements in the migration", async () => {
  await reset();
  await migrate(migrationNames.slice(0, 34));
  await pool.query("create table material_governance_runs(dummy integer)");
  await assert.rejects(migrate(migrationNames.slice(34)), /material_governance_runs.*already exists/i);
  assert.equal((await pool.query("select to_regclass('public.material_governance_alternative_candidates') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from information_schema.columns where table_name='material_import_mappings' and column_name='structure_status'")).rows[0].count, 0);
  assert.equal((await pool.query("select to_regprocedure('cyd_material_governance_fact_guard()') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version='0035_bom_material_governance.sql'")).rows[0].count, 0);
});

test("0035 rejects an inactive v2 attribute collision and rolls back the migration", async () => {
  await reset();
  await migrate(migrationNames.slice(0, 34));
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('governance_collision','碰撞测试员','manager','test-only',true,false,1)
  `);
  await seedGovernanceMetadataV1("governance_collision");
  await pool.query(`
    insert into material_attribute_definitions(
      attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,version,created_by,updated_by,request_id
    ) values('DIELECTRIC','停用介质','TEXT',0,'','[]'::jsonb,'NONE','INACTIVE',1,
      'governance_collision','governance_collision','00340000-0000-4000-8000-000000000004')
  `);
  await assert.rejects(migrate(migrationNames.slice(34)), /metadata v2 attribute collision/i);
  assert.equal((await pool.query("select status from material_attribute_definitions where attribute_code='DIELECTRIC'")).rows[0].status, "INACTIVE");
  assert.equal((await pool.query("select to_regclass('public.material_governance_runs') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version='0035_bom_material_governance.sql'")).rows[0].count, 0);
});

test("0035 rejects governance writes outside a service transaction", async () => {
  await reset();
  await migrate(migrationNames);
  await assert.rejects(
    pool.query(`
      insert into material_governance_runs(
        batch_id,normalization_run_id,normalization_result_digest,rule_version,config_digest,rule_snapshot,
        result_digest,source_count,group_count,ready_group_count,exception_row_count,
        alternative_candidate_count,operation_id,requested_by,request_id
      ) values(1,1,$1,'v1',$1,'{}'::jsonb,$1,0,0,0,0,0,
        '11111111-1111-4111-8111-111111111111','nobody','22222222-2222-4222-8222-222222222222')
    `, ["a".repeat(64)]),
    /material governance writes require service transaction/i,
  );
});
