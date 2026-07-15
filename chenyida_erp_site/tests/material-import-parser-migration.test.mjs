import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
let sequence = 0;

async function runSqlFile(DB, relativePath) {
  const sql = await readFile(join(siteRoot, relativePath), "utf8");
  const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
  await DB.batch(statements.map((statement) => DB.prepare(statement)));
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({ modules: true, script: "export default {}", compatibilityDate: "2026-05-22", d1Databases: { DB: `parser-migration-${sequence}` } });
  const { DB } = await mf.getBindings();
  for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql"]) await runSqlFile(DB, `drizzle/${migration}`);
  await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('owner','所有者','purchase','test',1,0,1)").run();
  return { mf, DB };
}

async function insertReadyBatch(DB, id = 1) {
  const timestamp = "2026-07-16T00:00:00.000Z";
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(?,?,'CSV','FILE_READY','owner',1,1,0,0,0,?,?)").bind(id, `MIB-${id}`, timestamp, timestamp).run();
  await DB.prepare("INSERT INTO material_import_files(id,batch_id,object_key,original_filename,filename_extension,declared_mime_type,declared_sha256,detected_file_type,actual_sha256,actual_size_bytes,storage_status,security_check_status,uploaded_at,created_at,updated_at) VALUES(?,?,?,'materials.csv','.csv','text/csv',?,'CSV',?,10,'STORED','BASIC_CHECK_PASSED',?,?,?)")
    .bind(id, id, `test/${id}`, "a".repeat(64), "a".repeat(64), timestamp, timestamp, timestamp).run();
}

test("0005 upgrades 0004 data, preserves rows, and enforces parser relations", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await insertReadyBatch(context.DB);
    await context.DB.prepare("INSERT INTO material_import_rows(batch_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_sha256,created_at) VALUES(1,0,'__CSV__',1,'{\"A\":{\"type\":\"TEXT\",\"value\":\"00123\"}}',?,'2026-07-16T00:00:00.000Z')").bind("b".repeat(64)).run();
    await runSqlFile(context.DB, "drizzle/0005_material_import_parser_mapping.sql");
    const foreignKeyViolations = (await context.DB.prepare("PRAGMA foreign_key_check").all()).results;
    assert.deepEqual(foreignKeyViolations, []);

    const tables = (await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((row) => row.name);
    for (const name of ["material_import_parse_runs", "material_import_parse_sheets", "material_import_shared_string_chunks", "material_import_header_suggestions", "material_import_job_outbox", "material_import_mappings", "material_import_mapping_items"]) assert.ok(tables.includes(name), name);
    const row = await context.DB.prepare("SELECT r.raw_row_hash,p.parser_version,p.run_status FROM material_import_rows r JOIN material_import_parse_runs p ON p.id=r.parse_run_id").first();
    assert.deepEqual(row, { raw_row_hash: "b".repeat(64), parser_version: "legacy-0004-backfill-v1", run_status: "SUPERSEDED" });
    assert.equal((await context.DB.prepare("SELECT status,current_parse_run_id FROM material_import_batches WHERE id=1").first()).status, "FILE_READY");

    const now = "2026-07-16T00:01:00.000Z";
    await context.DB.prepare("INSERT INTO material_import_parse_runs(batch_id,parser_version,run_status,attempt_no,current_stage,created_at,updated_at) VALUES(1,'csv-v1','QUEUED',1,'INSPECT_WORKBOOK',?,?)").bind(now, now).run();
    await assert.rejects(context.DB.prepare("INSERT INTO material_import_parse_runs(batch_id,parser_version,run_status,attempt_no,current_stage,created_at,updated_at) VALUES(1,'csv-v1','RUNNING',2,'INSPECT_WORKBOOK',?,?)").bind(now, now).run(), /UNIQUE/);
    const active = await context.DB.prepare("SELECT id FROM material_import_parse_runs WHERE batch_id=1 AND run_status='QUEUED'").first();
    await context.DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,?,0,'__CSV__',1,'{}',?,?)").bind(active.id, "c".repeat(64), now).run();
    await assert.rejects(context.DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,?,0,'__CSV__',1,'{}',?,?)").bind(active.id, "c".repeat(64), now).run(), /UNIQUE/);
    await assert.rejects(context.DB.prepare("UPDATE material_import_batches SET status='PARSED' WHERE id=1").run(), /current_run_ck/);
  } finally {
    await context.mf.dispose();
  }
});

test("0005 application rolls back when a later statement fails", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const sql = await readFile(join(siteRoot, "drizzle/0005_material_import_parser_mapping.sql"), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
    statements.splice(20, 0, "CREATE TABLE material_import_parse_runs(id INTEGER)");
    await assert.rejects(context.DB.batch(statements.map((statement) => context.DB.prepare(statement))));
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_rows'").first());
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_parse_runs'").first(), null);
  } finally {
    await context.mf.dispose();
  }
});

test("0005 protected Down preserves legacy rows and permits re-upgrade", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await insertReadyBatch(context.DB);
    await context.DB.prepare("INSERT INTO material_import_rows(batch_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_sha256,created_at) VALUES(1,0,'__CSV__',1,'{}',?,'2026-07-16T00:00:00.000Z')").bind("d".repeat(64)).run();
    await runSqlFile(context.DB, "drizzle/0005_material_import_parser_mapping.sql");
    await runSqlFile(context.DB, "drizzle/rollback/0005_material_import_parser_mapping.down.sql");
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_parse_runs'").first(), null);
    assert.deepEqual(await context.DB.prepare("SELECT raw_row_sha256 FROM material_import_rows").first(), { raw_row_sha256: "d".repeat(64) });
    await runSqlFile(context.DB, "drizzle/0005_material_import_parser_mapping.sql");
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_parse_runs'").first());
    assert.equal((await context.DB.prepare("SELECT count(*) count FROM material_import_rows").first()).count, 1);
  } finally { await context.mf.dispose(); }
});

test("0005 Down refuses to discard parser-era business state", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await insertReadyBatch(context.DB);
    await runSqlFile(context.DB, "drizzle/0005_material_import_parser_mapping.sql");
    await context.DB.prepare("INSERT INTO material_import_parse_runs(batch_id,parser_version,run_status,attempt_no,current_stage,created_at,updated_at) VALUES(1,'material-import-parser-v1','QUEUED',1,'INSPECT_WORKBOOK','2026-07-16T00:00:00.000Z','2026-07-16T00:00:00.000Z')").run();
    await assert.rejects(runSqlFile(context.DB, "drizzle/rollback/0005_material_import_parser_mapping.down.sql"), /NOT NULL/);
    assert.ok(await context.DB.prepare("SELECT id FROM material_import_parse_runs WHERE parser_version='material-import-parser-v1'").first());
  } finally { await context.mf.dispose(); }
});
