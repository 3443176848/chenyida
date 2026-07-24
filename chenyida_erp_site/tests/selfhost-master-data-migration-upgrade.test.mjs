import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_MASTER_DATA_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/master_data_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_MASTER_DATA_UPGRADE_DATABASE_URL containing master_data_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "master-data-migration-upgrade-test" });
const names = ["0001_selfhost_baseline.sql", "0002_material_master_workflow.sql", "0003_material_import_mapping.sql", "0004_material_import_normalization.sql", "0005_material_import_review.sql", "0006_identity_security.sql", "0007_master_data_bom.sql"];
const expectedOld = ["c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702", "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80", "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf", "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39", "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc", "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079"];
const sources = new Map(); for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));
const checksum = (name) => createHash("sha256").update(sources.get(name)).digest("hex");
async function reset() { await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null)"); }
async function migrate(list) { for (const name of list) { const old = await pool.query("select checksum from schema_migrations where version=$1", [name]); if (old.rows[0]) { assert.equal(old.rows[0].checksum, checksum(name)); continue; } const client = await pool.connect(); try { await client.query("begin"); await client.query(sources.get(name)); await client.query("insert into schema_migrations values($1,$2)", [name, checksum(name)]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } } }
test.after(async () => pool.end());

test("old migration checksums remain immutable and empty database upgrades/repeats through 0007", async () => {
  assert.deepEqual(names.slice(0, 6).map(checksum), expectedOld); assert.match(checksum(names[6]), /^[0-9a-f]{64}$/);
  await reset(); await migrate(names); await migrate(names);
  const tables = await pool.query("select to_regclass('customers') customers,to_regclass('bom_versions') bom_versions,to_regclass('business_code_sequences') sequences"); assert.equal(tables.rows[0].customers, "customers"); assert.equal(tables.rows[0].bom_versions, "bom_versions");
  const indexes = await pool.query("select indexname from pg_indexes where indexname in ('customers_code_uq','bom_lines_version_line_uq','supplier_mappings_supplier_status_idx')"); assert.equal(indexes.rowCount, 3);
});

test("0006 existing users sessions and legacy supplier mapping remain usable after upgrade", async () => {
  await reset(); await migrate(names.slice(0, 6));
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values('legacy_user','旧用户','purchase','test-only')`); await pool.query(`insert into app_sessions(token_hash,username,expires_at) values($1,'legacy_user',now()+interval '1 hour')`, ["d".repeat(64)]);
  await pool.query(`insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('LEGACY_LEAF','旧分类',4,'ACTIVE','test','test',$1)`, ["11111111-1111-4111-8111-111111111111"]); const category = await pool.query("select id from material_categories where category_code='LEGACY_LEAF'");
  await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('LEGACY-1','旧物料',$1,'PCS','ACTIVE','PURCHASE','STOCK','IQC','ROHS','MANUAL','test','test','test',$2)`, [category.rows[0].id, "11111111-1111-4111-8111-111111111112"]); const material = await pool.query("select id from material_master where internal_material_code='LEGACY-1'");
  await pool.query(`insert into supplier_mappings(material_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,status,valid_from,created_by,updated_by,request_id) values($1,'旧供应商','LEGACY','L-1','PCS','ACTIVE',now(),'test','test',$2)`, [material.rows[0].id, "11111111-1111-4111-8111-111111111113"]);
  await migrate(names.slice(6));
  const preserved = await pool.query(`select s.token_hash,s.revoked_at,sm.supplier_id,sm.supplier_item_code from app_sessions s cross join supplier_mappings sm where s.username='legacy_user'`); assert.equal(preserved.rowCount, 1); assert.equal(preserved.rows[0].token_hash, "d".repeat(64)); assert.equal(preserved.rows[0].supplier_id, null); assert.equal(preserved.rows[0].supplier_item_code, "L-1");
});

test("0007 failure rolls back all DDL and succeeds after invalid legacy status is corrected", async () => {
  await reset(); await migrate(names.slice(0, 6));
  await pool.query(`insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('BAD_LEAF','坏分类',4,'ACTIVE','test','test',$1)`, ["11111111-1111-4111-8111-111111111121"]); const category = await pool.query("select id from material_categories where category_code='BAD_LEAF'");
  await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('BAD-1','坏物料',$1,'PCS','ACTIVE','PURCHASE','STOCK','IQC','ROHS','MANUAL','test','test','test',$2)`, [category.rows[0].id, "11111111-1111-4111-8111-111111111122"]); const material = await pool.query("select id from material_master where internal_material_code='BAD-1'");
  await pool.query(`insert into supplier_mappings(material_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,status,valid_from,created_by,updated_by,request_id) values($1,'坏供应商','BAD','B-1','PCS','UNKNOWN',now(),'test','test',$2)`, [material.rows[0].id, "11111111-1111-4111-8111-111111111123"]);
  await assert.rejects(migrate(names.slice(6)), /supplier_mappings_status_ck/); assert.equal((await pool.query("select to_regclass('customers') table_name")).rows[0].table_name, null); assert.equal(Number((await pool.query("select count(*) count from information_schema.columns where table_name='supplier_mappings' and column_name='supplier_id'")).rows[0].count), 0);
  await pool.query("update supplier_mappings set status='ACTIVE'"); await migrate(names.slice(6)); assert.equal((await pool.query("select to_regclass('customers') table_name")).rows[0].table_name, "customers");
});
