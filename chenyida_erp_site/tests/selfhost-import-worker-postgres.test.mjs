import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { Pool } from "pg";

import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";
import { SelfHostedWorker } from "../app/lib/selfhost-worker.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(test|localhost|127\.0\.0\.1|task01)/i.test(databaseUrl)) throw new Error("isolated TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "import-worker-integration-test" });

async function mergedHeaderWorkbook() {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output);
  await writer.add("xl/workbook.xml", new TextReader(`
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="物料BOM" sheetId="1" r:id="rId1"/>
        <sheet name="内部说明" sheetId="2" state="hidden" r:id="rId2"/>
      </sheets>
    </workbook>
  `));
  await writer.add("xl/_rels/workbook.xml.rels", new TextReader(`
    <Relationships>
      <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
    </Relationships>
  `));
  await writer.add("xl/worksheets/sheet1.xml", new TextReader(`
    <worksheet>
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>供应商 BOM 版本 V2</t></is></c></row>
        <row r="2">
          <c r="A2" t="inlineStr"><is><t>物料信息</t></is></c>
          <c r="C2" t="inlineStr"><is><t>供应信息</t></is></c>
        </row>
        <row r="3">
          <c r="A3" t="inlineStr"><is><t>物料名称</t></is></c>
          <c r="B3" t="inlineStr"><is><t>单位</t></is></c>
          <c r="C3" t="inlineStr"><is><t>品牌</t></is></c>
          <c r="D3" t="inlineStr"><is><t>描述</t></is></c>
        </row>
        <row r="4">
          <c r="A4" t="inlineStr"><is><t>精密电阻</t></is></c>
          <c r="B4" t="inlineStr"><is><t>PCS</t></is></c>
          <c r="C4" t="inlineStr"><is><t>TDK</t></is></c>
          <c r="D4" t="inlineStr"><is><t>0201 0R ±5%</t></is></c>
        </row>
        <row r="5">
          <c r="A5" t="inlineStr"><is><t>贴片电容</t></is></c>
          <c r="B5" t="inlineStr"><is><t>PCS</t></is></c>
          <c r="C5" t="inlineStr"><is><t>Murata</t></is></c>
          <c r="D5" t="inlineStr"><is><t>0201 1uF 6.3V X5R</t></is></c>
        </row>
      </sheetData>
      <mergeCells count="2"><mergeCell ref="A2:B2"/><mergeCell ref="C2:D2"/></mergeCells>
    </worksheet>
  `));
  await writer.add("xl/worksheets/sheet2.xml", new TextReader("<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>secret</v></c></row></sheetData></worksheet>"));
  return writer.close();
}

test.before(async () => {
  await pool.query("truncate background_jobs,material_import_job_outbox,material_import_batches,app_users restart identity cascade");
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('mapper1','映射员','purchase','test-only',true,false,1)
  `);
});

test.after(async () => pool.end());

test("real XLSX worker preserves sheet metadata and propagates merged multi-row headers into the initial mapping", async () => {
  const bytes = await mergedHeaderWorkbook();
  const relativePath = "task01/merged-header.xlsx";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const queue = new PostgresBackgroundJobQueue(pool, { now: () => new Date() }, { uuid: randomUUID }, 60);
  const client = await pool.connect();
  let batchId;
  try {
    await client.query("begin");
    const batch = await client.query(`
      insert into material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count)
      values($1,'XLSX','QUEUED_FOR_PARSING','mapper1',1,1) returning id
    `, [`IMP-WORKER-${randomUUID().slice(0, 8)}`]);
    batchId = Number(batch.rows[0].id);
    await client.query(`
      insert into material_import_files(
        batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes
      ) values($1,$2,$3,'merged-header.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$4,$5)
    `, [batchId, randomUUID(), relativePath, sha256, bytes.byteLength]);
    await queue.enqueue(client, {
      type: "material.import.parse",
      payload: { batch_id: batchId, relative_path: relativePath },
      idempotencyKey: `parse-import:${batchId}`,
      aggregateType: "material_import_batch",
      aggregateId: String(batchId),
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const storage = {
    async open(requestedPath) {
      assert.equal(requestedPath, relativePath);
      return Readable.from([Buffer.from(bytes)]);
    },
    async write() { throw new Error("not used"); },
    async delete() {},
  };
  const worker = new SelfHostedWorker(queue, storage, "import-worker-test", 1);
  assert.equal(await worker.runOnce(), true);

  const run = await pool.query(`
    select p.id,p.parsed_sheet_count,p.rows_written,p.mapping_preparation_status,p.source_structure_digest,
           b.status batch_status,b.total_rows
    from material_import_parse_runs p join material_import_batches b on b.current_parse_run_id=p.id
    where b.id=$1
  `, [batchId]);
  assert.deepEqual(
    {
      parsed_sheet_count: Number(run.rows[0].parsed_sheet_count),
      rows_written: Number(run.rows[0].rows_written),
      mapping_preparation_status: run.rows[0].mapping_preparation_status,
      batch_status: run.rows[0].batch_status,
      total_rows: Number(run.rows[0].total_rows),
    },
    { parsed_sheet_count: 1, rows_written: 5, mapping_preparation_status: "READY", batch_status: "AWAITING_MAPPING", total_rows: 5 },
  );
  assert.match(run.rows[0].source_structure_digest, /^[0-9a-f]{64}$/);

  const sheets = await pool.query(`
    select sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,merged_ranges,warnings
    from material_import_parse_sheets where parse_run_id=$1 order by sheet_index
  `, [run.rows[0].id]);
  assert.equal(sheets.rows.length, 2);
  assert.deepEqual(sheets.rows[0].merged_ranges, ["A2:B2", "C2:D2"]);
  assert.deepEqual(
    { visibility: sheets.rows[1].visibility, parse_status: sheets.rows[1].parse_status, row_count: Number(sheets.rows[1].row_count) },
    { visibility: "HIDDEN", parse_status: "SKIPPED_HIDDEN", row_count: 0 },
  );

  const mapping = await pool.query(`
    select header_start_row_number,header_end_row_number,data_start_row_number,source_fields,adaptive_algorithm_version
    from material_import_mappings where batch_id=$1 and status='DRAFT'
  `, [batchId]);
  assert.deepEqual(
    {
      header_start_row_number: Number(mapping.rows[0].header_start_row_number),
      header_end_row_number: Number(mapping.rows[0].header_end_row_number),
      data_start_row_number: Number(mapping.rows[0].data_start_row_number),
    },
    { header_start_row_number: 2, header_end_row_number: 3, data_start_row_number: 4 },
  );
  assert.equal(mapping.rows[0].adaptive_algorithm_version, "adaptive-supplier-v1");
  const fields = new Map(mapping.rows[0].source_fields.map((field) => [Number(field.column_index), field.source_header]));
  assert.equal(fields.get(0), "物料信息/物料名称");
  assert.equal(fields.get(1), "物料信息/单位");
  assert.equal(fields.get(2), "供应信息/品牌");
  assert.equal(fields.get(3), "供应信息/描述");

  const suggestions = await pool.query(`
    select reason_codes from material_import_header_suggestions
    where parse_run_id=$1 and sheet_index=0 and row_number=2 order by rank limit 1
  `, [run.rows[0].id]);
  assert.ok(suggestions.rows[0].reason_codes.includes("MERGED_HEADER_CONTEXT"));
  const completed = await pool.query("select status,result from background_jobs where type='material.import.parse'");
  assert.equal(completed.rows[0].status, "SUCCEEDED");
  assert.equal(completed.rows[0].result.parser, "ooxml-xlsx");
  assert.equal(Number(completed.rows[0].result.sheets), 2);
});
