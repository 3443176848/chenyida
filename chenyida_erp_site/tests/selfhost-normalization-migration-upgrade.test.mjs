import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_NORMALIZATION_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/upgrade_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_NORMALIZATION_UPGRADE_DATABASE_URL containing upgrade_test is required");
}
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "normalization-migration-upgrade-test" });

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

test("0004 upgrades a published legacy normalization result without losing source linkage or issues", async () => {
  await migration("0001_selfhost_baseline.sql");
  await migration("0002_material_master_workflow.sql");
  await migration("0003_material_import_mapping.sql");
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('legacy_normalizer','旧规范化员','manager','test-only',true,false,1)
  `);
  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version)
    values('IMP-NORMALIZATION-UPGRADE','CSV','NORMALIZED','legacy_normalizer',7) returning id
  `);
  const batchId = Number(batch.rows[0].id);
  const file = await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,'11111111-1111-4111-8111-111111111111','legacy-normalization.csv','legacy-normalization.csv','text/csv',$2,20)
    returning id
  `, [batchId, "a".repeat(64)]);
  const parse = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,
      parsed_sheet_count,mapping_preparation_status,source_structure_digest,completed_at
    ) values($1,'legacy-parser','SUCCEEDED',1,$2,'COMPLETE',1,1,'READY',$3,now()) returning id
  `, [batchId, "a".repeat(64), "b".repeat(64)]);
  const parseRunId = Number(parse.rows[0].id);
  const sheet = await pool.query(`
    insert into material_import_parse_sheets(
      parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings
    ) values($1,0,'旧物料','VISIBLE','COMPLETED',1,1,'[]'::jsonb) returning id
  `, [parseRunId]);
  const row = await pool.query(`
    insert into material_import_rows(
      batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash
    ) values($1,$2,'22222222-2222-4222-8222-222222222222',0,'旧物料',2,$3,$4) returning id
  `, [batchId, parseRunId, { schema_version: 1, source_column_count: 1, cells: [] }, "c".repeat(64)]);
  const snapshot = {
    schema_version: 1,
    source_fields: [{ column_index: 0, column_ref: "A", source_header: "名称", normalized_header: "名称" }],
    items: [],
    targets: [],
  };
  const mapping = await pool.query(`
    insert into material_import_mappings(
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
      header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
      mapping_digest,status,mapping_snapshot,created_by,updated_by,request_id,confirmed_by,confirmed_at
    ) values(
      '33333333-3333-4333-8333-333333333333',$1,$2,1,'CSV',0,'旧物料','SINGLE_ROW',1,$3,
      $4,$5,'material-import-mapping-metadata-v1',$6,'CONFIRMED',$7,'legacy_normalizer',
      'legacy_normalizer','44444444-4444-4444-8444-444444444444','legacy_normalizer',now()
    ) returning id
  `, [batchId, parseRunId, "b".repeat(64), JSON.stringify(snapshot.source_fields), "d".repeat(64), "e".repeat(64), snapshot]);
  const run = await pool.query(`
    insert into material_import_normalization_runs(
      batch_id,parse_run_id,mapping_id,mapping_version,mapping_digest,processor_version,metadata_digest,
      run_status,current_stage,total_rows,processed_rows,valid_rows,warning_rows,error_rows,result_digest,
      requested_by,started_at,completed_at
    ) values($1,$2,$3,1,$4,'legacy-normalizer-v1',$5,'SUCCEEDED','COMPLETE',1,1,0,1,0,$6,
      'legacy_normalizer',now(),now()) returning id
  `, [batchId, parseRunId, Number(mapping.rows[0].id), "e".repeat(64), "d".repeat(64), "f".repeat(64)]);
  const runId = Number(run.rows[0].id);
  const normalized = await pool.query(`
    insert into material_import_normalized_rows(
      batch_id,normalization_run_id,source_sheet_index,source_row_number,source_raw_row_hash,
      normalized_payload,normalized_payload_hash,mapped_values,row_status,error_count,warning_count
    ) values($1,$2,0,2,$3,$4,$5,$6,'WARNING',0,1) returning id
  `, [
    batchId,
    runId,
    "c".repeat(64),
    { schema_version: 1, row_status: "WARNING" },
    "1".repeat(64),
    { basic: { standard_name: "旧物料" } },
  ]);
  await pool.query(`
    insert into material_import_normalization_issues(
      normalization_run_id,normalized_row_id,issue_level,issue_code,target_code,source_sheet_index,
      source_row_number,source_column_index,safe_message,safe_details
    ) values($1,$2,'WARNING','NORMALIZATION_LEGACY_WARNING','basic.BRAND',0,2,0,'旧版安全提示','{}'::jsonb)
  `, [runId, Number(normalized.rows[0].id)]);

  await migration("0004_material_import_normalization.sql");

  const upgraded = await pool.query(`
    select r.source_file_id,r.source_sheet_id,r.source_schema_digest,r.normalizer_rule_version,
      r.run_version,r.expected_version,r.run_status,r.published_at,r.issue_count,r.warning_count,
      n.source_row_id,n.source_sheet_id normalized_sheet_id,n.source_sheet_name,n.issue_count row_issue_count,
      i.issue_key,i.rule_code
    from material_import_normalization_runs r
    join material_import_normalized_rows n on n.normalization_run_id=r.id
    join material_import_normalization_issues i on i.normalization_run_id=r.id
    where r.id=$1
  `, [runId]);
  const value = upgraded.rows[0];
  assert.equal(Number(value.source_file_id), Number(file.rows[0].id));
  assert.equal(Number(value.source_sheet_id), Number(sheet.rows[0].id));
  assert.equal(Number(value.source_row_id), Number(row.rows[0].id));
  assert.equal(Number(value.normalized_sheet_id), Number(sheet.rows[0].id));
  assert.equal(value.source_sheet_name, "旧物料");
  assert.equal(value.source_schema_digest, "b".repeat(64));
  assert.equal(value.normalizer_rule_version, "legacy-normalizer-v1");
  assert.equal(value.run_version, 1);
  assert.equal(value.expected_version, 1);
  assert.equal(value.run_status, "SUCCEEDED");
  assert.ok(value.published_at);
  assert.equal(value.issue_count, 1);
  assert.equal(value.warning_count, 1);
  assert.equal(value.row_issue_count, 1);
  assert.match(value.issue_key, /^[a-f0-9]{64}$/);
  assert.equal(value.rule_code, "NORMALIZATION_LEGACY_WARNING");
  await assert.rejects(
    pool.query("update material_import_normalized_rows set warning_count=0 where id=$1", [Number(normalized.rows[0].id)]),
    /published normalization result is immutable/,
  );
});
