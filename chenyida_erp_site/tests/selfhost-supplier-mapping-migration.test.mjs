import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_SUPPLIER_MAPPING_MIGRATION_DATABASE_URL;
if (!databaseUrl || !/supplier_mapping_migration_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_SUPPLIER_MAPPING_MIGRATION_DATABASE_URL containing supplier_mapping_migration_test is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "supplier-mapping-migration-test" });
const directory = new URL("../drizzle-postgres/", import.meta.url);
const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const sources = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, directory), "utf8")])));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
const migrationName = "0038_supplier_mapping_governance.sql";
const migration = sources.get(migrationName);
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const journal = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/_journal.json", import.meta.url), "utf8"));
const snapshot37 = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0037_snapshot.json", import.meta.url), "utf8"));
const snapshot38 = JSON.parse(await readFile(new URL("../drizzle-postgres/meta/0038_snapshot.json", import.meta.url), "utf8"));

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

async function seedLegacyMapping() {
  await pool.query("insert into app_users(username,display_name,role,password_hash) values('mapping_legacy','历史映射','purchase','test-only')");
  const unit = (await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('M38PCS','件','PCS','COUNT',true) returning id")).rows[0];
  const category = (await pool.query(`insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id)
    values('M38','映射迁移',4,'ACTIVE','mapping_legacy','mapping_legacy',$1) returning id`, [randomUUID()])).rows[0];
  const materials = (await pool.query(`insert into material_master(
      internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,
      inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id
    ) values
      ('CYD-M38-000001','迁移物料一',$1,'M38PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','ROHS','MANUAL','mapping_legacy','mapping_legacy','mapping_legacy',$3),
      ('CYD-M38-000002','迁移物料二',$1,'M38PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','ROHS','MANUAL','mapping_legacy','mapping_legacy','mapping_legacy',$4)
    returning id,internal_material_code`, [category.id, unit.id, randomUUID(), randomUUID()])).rows;
  const supplier = (await pool.query(`insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id)
    values('SUP-M38','迁移供应商','迁移供应商','ACTIVE','mapping_legacy','mapping_legacy',$1) returning id`, [randomUUID()])).rows[0];
  const requestId = randomUUID();
  const mapping = (await pool.query(`insert into supplier_mappings(
      material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,supplier_item_name,supplier_specification,
      purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,valid_to,
      created_by,updated_by,request_id
    ) values($1,$2,'迁移供应商','SUP-M38',' legacy-part-001 ','历史名称','历史规格','M38PCS',$3,1,1,'ACTIVE',
      '2026-01-01 00:00:00+08','2026-12-31 00:00:00+08','mapping_legacy','mapping_legacy',$4) returning id`,
  [materials[0].id, supplier.id, unit.id, requestId])).rows[0];
  return {
    mappingId: Number(mapping.id), materialIds: materials.map((row) => Number(row.id)),
    supplierId: Number(supplier.id), unitId: Number(unit.id), requestId,
  };
}

test.after(async () => pool.end());

test("0038 static schema, journal, snapshot and immutable 0001-0037 history are aligned", () => {
  assert.equal(names.length, 38);
  assert.equal(names.at(-1), migrationName);
  assert.equal(checksum("0037_project_planning_revision_response_lineage.sql"), "139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f");
  const immutableDigest = createHash("sha256").update(names.slice(0, 37).map((name) => `${name}:${checksum(name)}\n`).join("")).digest("hex");
  assert.equal(immutableDigest, "47fb40b7740ea6b8cdb84002f34a92b13e05b42e06a117d216cae52be85dc4c3");
  assert.equal(journal.entries.at(-1)?.idx, 38);
  assert.equal(journal.entries.at(-1)?.tag, "0038_supplier_mapping_governance");
  assert.equal(snapshot38.prevId, snapshot37.id);
  for (const table of ["supplier_mapping_events", "supplier_mapping_supplier_part_keys"]) {
    assert.ok(snapshot38.tables[`public.${table}`]);
    assert.match(schema, new RegExp(`pgTable\\(\"${table}\"`));
    assert.match(migration, new RegExp(`CREATE TABLE \"${table}\"`));
  }
  for (const column of [
    "mapping_uid", "mapping_version_no", "supersedes_mapping_version_id", "superseded_by_mapping_version_id",
    "content_digest", "created_request_id", "submitted_by", "submitted_at", "submitted_request_id",
    "reviewed_by", "reviewed_at", "reviewed_request_id", "review_outcome", "review_reason",
  ]) {
    assert.ok(snapshot38.tables["public.supplier_mappings"].columns[column]);
    assert.match(migration, new RegExp(`ADD COLUMN \"${column}\"`));
  }
  for (const [table, index] of [
    ["supplier_mappings", "supplier_mappings_active_supplier_part_uq"],
    ["supplier_mapping_supplier_part_keys", "supplier_mapping_supplier_part_keys_identity_uq"],
  ]) {
    assert.ok(snapshot38.tables[`public.${table}`].indexes[index]);
    assert.match(schema, new RegExp(index));
    assert.match(migration, new RegExp(index));
  }
  for (const constraint of ["supplier_mappings_governed_lifecycle_ck", "supplier_mappings_governed_text_ck"]) {
    assert.ok(snapshot38.tables["public.supplier_mappings"].checkConstraints[constraint]);
    assert.match(schema, new RegExp(constraint));
    assert.match(migration, new RegExp(constraint));
  }
  for (const token of [
    "supplier_mappings_governed_lifecycle_ck", "supplier_mappings_active_material_period_excl",
    "supplier_mapping_supplier_part_keys_identity_uq", "supplier mapping versions cannot be deleted",
    "supplier mapping writes require SupplierMappingService", "supplier mapping events are immutable",
    "supplier mapping part number claims are immutable", "separation of duties",
    "DROP INDEX \"supplier_mappings_identity_period_uq\"",
  ]) assert.match(migration, new RegExp(token));
  assert.doesNotMatch(migration, /insert into\s+"supplier_mapping_events"/i);
  assert.doesNotMatch(migration, /update\s+"supplier_mappings"\s+set\s+"status"/i);
});

test("empty database migrates 0001 to 0038 and a repeated runner is a checksum-verified no-op", async () => {
  await reset();
  await migrate(names);
  await migrate(names);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations")).rows[0].count, 38);
  assert.deepEqual((await pool.query(`select
      to_regclass('supplier_mapping_events') events,
      to_regclass('supplier_mapping_supplier_part_keys') part_keys,
      to_regprocedure('cyd_supplier_mapping_version_guard()') version_guard`)).rows[0], {
    events: "supplier_mapping_events",
    part_keys: "supplier_mapping_supplier_part_keys",
    version_guard: "cyd_supplier_mapping_version_guard()",
  });
});

test("0037 to 0038 preserves legacy facts, backfills provenance without invented review, and guards every later write", async () => {
  await reset(); await migrate(names.slice(0, 37));
  const refs = await seedLegacyMapping();
  const before = (await pool.query(`select material_id::text,supplier_id::text,supplier_name,supplier_key,supplier_item_code,
    supplier_item_name,supplier_specification,purchase_uom,purchase_unit_id::text,conversion_numerator::text,
    conversion_denominator::text,status,valid_from,valid_to,created_by,updated_by,request_id::text,version
    from supplier_mappings where id=$1`, [refs.mappingId])).rows[0];
  await migrate(names.slice(37));
  const after = (await pool.query(`select material_id::text,supplier_id::text,supplier_name,supplier_key,supplier_item_code,
    supplier_item_name,supplier_specification,purchase_uom,purchase_unit_id::text,conversion_numerator::text,
    conversion_denominator::text,status,valid_from,valid_to,created_by,updated_by,request_id::text,version
    from supplier_mappings where id=$1`, [refs.mappingId])).rows[0];
  assert.deepEqual(after, before);
  const governance = (await pool.query(`select mapping_uid::text,mapping_version_no,supplier_item_code_normalized,
    created_request_id::text,submitted_by,submitted_at,reviewed_by,reviewed_at,review_outcome,content_digest,review_reason
    from supplier_mappings where id=$1`, [refs.mappingId])).rows[0];
  assert.match(governance.mapping_uid, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...governance, mapping_uid: "<uuid>" }, {
    mapping_uid: "<uuid>", mapping_version_no: 1, supplier_item_code_normalized: "LEGACY-PART-001",
    created_request_id: refs.requestId, submitted_by: null, submitted_at: null, reviewed_by: null,
    reviewed_at: null, review_outcome: null, content_digest: null, review_reason: "",
  });
  assert.equal((await pool.query("select count(*)::integer count from supplier_mapping_events")).rows[0].count, 0);
  assert.deepEqual((await pool.query(`select supplier_id::integer,normalized_supplier_item_code,mapping_uid::text
    from supplier_mapping_supplier_part_keys`)).rows, [{
    supplier_id: refs.supplierId, normalized_supplier_item_code: "LEGACY-PART-001", mapping_uid: governance.mapping_uid,
  }]);

  await assert.rejects(pool.query("update supplier_mappings set supplier_item_name='直接改写' where id=$1", [refs.mappingId]), /SupplierMappingService/);
  await assert.rejects(pool.query("delete from supplier_mappings where id=$1", [refs.mappingId]), /cannot be deleted/);
  await assert.rejects(pool.query(`insert into supplier_mappings(
      material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,status,valid_from,
      created_by,updated_by,request_id
    ) values($1,$2,'迁移供应商','SUP-M38','DIRECT-ACTIVE','M38PCS',$3,'ACTIVE',now(),
      'mapping_legacy','mapping_legacy',$4)`, [refs.materialIds[1], refs.supplierId, refs.unitId, randomUUID()]), /SupplierMappingService/);

  const client = await pool.connect();
  const draftUid = randomUUID(); const draftRequestId = randomUUID();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.supplier_mapping_service_write','allowed',true)");
    await client.query(`insert into supplier_mapping_supplier_part_keys(
      supplier_id,normalized_supplier_item_code,mapping_uid,created_by,request_id
    ) values($1,'DRAFT-PART-002',$2,'mapping_legacy',$3)`, [refs.supplierId, draftUid, draftRequestId]);
    await client.query(`insert into supplier_mappings(
      mapping_uid,mapping_version_no,material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,
      supplier_item_code_normalized,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,
      valid_from,created_by,updated_by,created_request_id,request_id
    ) values($1,1,$2,$3,'迁移供应商','SUP-M38','DRAFT-PART-002','DRAFT-PART-002','M38PCS',$4,1,1,'DRAFT',
      '2026-02-01 00:00:00+08','mapping_legacy','mapping_legacy',$5,$5)`,
    [draftUid, refs.materialIds[1], refs.supplierId, refs.unitId, draftRequestId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback"); throw error;
  } finally { client.release(); }
  assert.deepEqual((await pool.query("select status,version,mapping_version_no from supplier_mappings where mapping_uid=$1", [draftUid])).rows[0], {
    status: "DRAFT", version: 1, mapping_version_no: 1,
  });
});

test("0038 rejects ambiguous historical identities and rolls every expansion back", async () => {
  await reset(); await migrate(names.slice(0, 37));
  const refs = await seedLegacyMapping();
  await pool.query(`insert into supplier_mappings(
      material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,
      conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id
    ) values($1,$2,'迁移供应商','SUP-M38',' legacy-part-001 ','M38PCS',$3,1,1,'ACTIVE',
      '2027-01-01 00:00:00+08','mapping_legacy','mapping_legacy',$4)`,
  [refs.materialIds[1], refs.supplierId, refs.unitId, randomUUID()]);
  await assert.rejects(migrate(names.slice(37)), /supplier mapping conflicts require manual resolution.*duplicate_parts=1/i);
  assert.equal((await pool.query(`select count(*)::integer count from information_schema.columns
    where table_name='supplier_mappings' and column_name in ('mapping_uid','submitted_at','reviewed_at')`)).rows[0].count, 0);
  assert.equal((await pool.query("select to_regclass('supplier_mapping_events') value")).rows[0].value, null);
  assert.equal((await pool.query("select to_regclass('supplier_mapping_supplier_part_keys') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version=$1", [migrationName])).rows[0].count, 0);
  assert.equal((await pool.query("select count(*)::integer count from supplier_mappings")).rows[0].count, 2);
});

test("0038 DDL collision rolls back tables, columns, functions and migration record", async () => {
  await reset(); await migrate(names.slice(0, 37));
  await pool.query("create table supplier_mapping_events(dummy integer)");
  await assert.rejects(migrate(names.slice(37)), /supplier_mapping_events.*already exists/i);
  assert.equal((await pool.query(`select count(*)::integer count from information_schema.columns
    where table_name='supplier_mappings' and column_name in ('mapping_uid','submitted_at','reviewed_at')`)).rows[0].count, 0);
  assert.equal((await pool.query("select to_regclass('supplier_mapping_supplier_part_keys') value")).rows[0].value, null);
  assert.equal((await pool.query("select to_regprocedure('cyd_supplier_mapping_version_guard()') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::integer count from schema_migrations where version=$1", [migrationName])).rows[0].count, 0);
});
