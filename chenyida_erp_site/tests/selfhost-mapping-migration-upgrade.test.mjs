import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_UPGRADE_DATABASE_URL containing upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "mapping-migration-upgrade-test" });

async function migration(name) {
  const source = await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8");
  const statements = source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of statements) await client.query(statement);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

test.after(async () => pool.end());

test("0003 upgrades legacy rows and invalidates unprovable confirmed mappings safely", async () => {
  await migration("0001_selfhost_baseline.sql");
  await migration("0002_material_master_workflow.sql");
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('legacy_mapper','旧映射员','purchase','test-only',true,false,1)
  `);
  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version)
    values('IMP-LEGACY-UPGRADE','CSV','MAPPING_CONFIRMED','legacy_mapper',5) returning id
  `);
  const batchId = Number(batch.rows[0].id);
  await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,'11111111-1111-4111-8111-111111111111','legacy.csv','legacy.csv','text/csv',$2,10)
  `, [batchId, "a".repeat(64)]);
  const run = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,parsed_sheet_count
    ) values($1,'legacy-parser','SUCCEEDED',1,$2,'COMPLETE',1,1) returning id
  `, [batchId, "a".repeat(64)]);
  const parseRunId = Number(run.rows[0].id);
  await pool.query("update material_import_batches set current_parse_run_id=$2 where id=$1", [batchId, parseRunId]);
  await pool.query(`
    insert into material_import_rows(batch_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
    values($1,'22222222-2222-4222-8222-222222222222',0,'__CSV__',1,$2,$3)
  `, [batchId, { schema_version: 1, source_column_count: 1, cells: [] }, "b".repeat(64)]);
  const mapping = await pool.query(`
    insert into material_import_mappings(
      batch_id,parse_run_id,mapping_version,selected_sheet_index,header_mode,header_row_number,
      metadata_digest,mapping_digest,status,created_by
    ) values($1,$2,1,0,'SINGLE_ROW',1,$3,$4,'CONFIRMED','legacy_mapper') returning id
  `, [batchId, parseRunId, "c".repeat(64), "d".repeat(64)]);
  await pool.query(`
    insert into material_import_mapping_items(
      mapping_id,target_code,mapping_mode,source_column_indexes,source_headers,required,mapping_evidence,display_order
    ) values($1,'STANDARD_NAME','SOURCE','[0]'::jsonb,'["name"]'::jsonb,true,'[]'::jsonb,0)
  `, [Number(mapping.rows[0].id)]);

  await migration("0003_material_import_mapping.sql");
  const upgraded = await pool.query(`
    select m.status,m.stale_reason_code,m.mapping_snapshot,m.source_fields,r.parse_run_id
    from material_import_mappings m
    join material_import_rows r on r.batch_id=m.batch_id
    where m.id=$1
  `, [Number(mapping.rows[0].id)]);
  assert.equal(upgraded.rows[0].status, "STALE");
  assert.equal(upgraded.rows[0].stale_reason_code, "LEGACY_SNAPSHOT_INCOMPLETE");
  assert.equal(upgraded.rows[0].mapping_snapshot.legacy_backfill, true);
  assert.deepEqual(upgraded.rows[0].source_fields, []);
  assert.equal(Number(upgraded.rows[0].parse_run_id), parseRunId);
  await assert.rejects(
    pool.query("update material_import_mappings set mapping_digest=$2 where id=$1", [Number(mapping.rows[0].id), "e".repeat(64)]),
    /confirmed material import mapping is immutable/,
  );
});
