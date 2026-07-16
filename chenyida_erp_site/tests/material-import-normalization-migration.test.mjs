import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
let sequence = 0;

async function runSqlFile(DB, relativePath) {
  const sql = await readFile(join(siteRoot, relativePath), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((statement) => DB.prepare(statement)));
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({ modules: true, script: "export default {}", compatibilityDate: "2026-05-22", d1Databases: { DB: `normalization-migration-${sequence}` } });
  const { DB } = await mf.getBindings();
  for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql", "0005_material_import_parser_mapping.sql"]) await runSqlFile(DB, `drizzle/${migration}`);
  await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('owner','所有者','manager','test',1,0,1)").run();
  return { mf, DB };
}

async function insertMappedBatch(DB, id = 1) {
  const now = "2026-07-17T00:00:00.000Z";
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(?,?,'CSV','CREATED','owner',1,0,0,0,0,?,?)").bind(id, `MIB-NORM-${id}`, now, now).run();
  await DB.prepare("INSERT INTO material_import_parse_runs(id,batch_id,parser_version,run_status,attempt_no,current_stage,completed_at,mapping_preparation_status,created_at,updated_at) VALUES(?,?,'parser-v1','SUCCEEDED',1,'COMPLETE',?,'READY',?,?)").bind(id, id, now, now, now).run();
  await DB.prepare("UPDATE material_import_batches SET status='MAPPING_CONFIRMED',current_parse_run_id=?,current_version=2 WHERE id=?").bind(id, id).run();
  await DB.prepare("INSERT INTO material_import_mappings(id,batch_id,parse_run_id,selected_sheet_index,header_mode,mapping_status,mapping_version,metadata_digest,created_by,updated_by,confirmed_by,created_at,updated_at,confirmed_at) VALUES(?,?,?,0,'NO_HEADER','CONFIRMED',1,?,'owner','owner','owner',?,?,?)").bind(id, id, id, "a".repeat(64), now, now, now).run();
  await DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order) VALUES(?,0,'name','basic','STANDARD_NAME','SOURCE',1,0)").bind(id).run();
  await DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(?,?,0,'Sheet1',1,?,?,?)").bind(id, id, JSON.stringify({ schema_version: 1, source_column_count: 1, cells: [] }), "b".repeat(64), now).run();
  await DB.prepare("INSERT INTO material_import_events(batch_id,event_type,actor_type,actor_identifier,previous_status,new_status,request_id,safe_details_json,created_at) VALUES(?,'MAPPING_CONFIRMED','USER','owner','AWAITING_MAPPING','MAPPING_CONFIRMED','fixture','{}',?)").bind(id, now).run();
}

test("0006 upgrades an empty 0005 database", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await runSqlFile(context.DB, "drizzle/0006_material_import_normalization.sql");
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_normalization_runs'").first());
  } finally { await context.mf.dispose(); }
});

test("0006 upgrades 0005 data and enforces normalization integrity", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await insertMappedBatch(context.DB);
    await runSqlFile(context.DB, "drizzle/0006_material_import_normalization.sql");
    assert.deepEqual(await context.DB.prepare("SELECT status,current_version,current_parse_run_id,current_normalization_run_id FROM material_import_batches WHERE id=1").first(), { status: "MAPPING_CONFIRMED", current_version: 2, current_parse_run_id: 1, current_normalization_run_id: null });
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_rows").first()).count, 1);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_mapping_items").first()).count, 1);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_events").first()).count, 1);
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
    for (const table of ["material_import_normalization_runs", "material_import_normalized_rows", "material_import_normalization_issues"]) assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first(), table);

    const now = "2026-07-17T00:01:00.000Z";
    const insertRun = "INSERT INTO material_import_normalization_runs(batch_id,parse_run_id,mapping_id,mapping_version,mapping_digest,processor_version,payload_schema_version,metadata_digest,batch_version_at_start,run_status,attempt_no,current_stage,total_rows,processed_rows,valid_rows,warning_rows,error_rows,normalized_json_bytes,issue_count,warning_count,error_count,requested_by,created_at,updated_at) VALUES(1,1,1,1,?, ?,1,?,2,?,1,?,0,0,0,0,0,0,0,0,0,'owner',?,?)";
    await context.DB.prepare(insertRun).bind("d".repeat(64), "norm-v1", "a".repeat(64), "QUEUED", "LOAD_MAPPING", now, now).run();
    await assert.rejects(context.DB.prepare(insertRun).bind("d".repeat(64), "norm-v2", "a".repeat(64), "RUNNING", "NORMALIZE_ROWS", now, now).run(), /UNIQUE/);
    const active = await context.DB.prepare("SELECT id FROM material_import_normalization_runs WHERE run_status='QUEUED'").first();
    await context.DB.prepare("UPDATE material_import_normalization_runs SET run_status='SUCCEEDED',current_stage='COMPLETE' WHERE id=?").bind(active.id).run();
    await context.DB.prepare("UPDATE material_import_batches SET status='NORMALIZED',current_normalization_run_id=? WHERE id=1").bind(active.id).run();
    await assert.rejects(context.DB.prepare("UPDATE material_import_batches SET current_normalization_run_id=999 WHERE id=1").run(), /invalid current normalization run/);
    await assert.rejects(context.DB.prepare("UPDATE material_import_normalization_runs SET run_status='SUPERSEDED' WHERE id=?").bind(active.id).run(), /current normalization run must remain succeeded/);
    await context.DB.prepare("INSERT INTO material_import_normalized_rows(batch_id,normalization_run_id,parse_run_id,source_sheet_index,source_row_number,source_raw_row_hash,normalized_payload_json,normalized_payload_hash,row_status,error_count,warning_count,created_at,updated_at) VALUES(1,?,1,0,1,?,'{}',?,'VALID',0,0,?,?)").bind(active.id, "b".repeat(64), "c".repeat(64), now, now).run();
    await assert.rejects(context.DB.prepare("UPDATE material_import_normalized_rows SET batch_id=999 WHERE normalization_run_id=?").bind(active.id).run(), /normalized row binding mismatch/);
    await assert.rejects(context.DB.prepare("INSERT INTO material_import_normalized_rows(batch_id,normalization_run_id,parse_run_id,source_sheet_index,source_row_number,source_raw_row_hash,normalized_payload_json,normalized_payload_hash,row_status,error_count,warning_count,created_at,updated_at) VALUES(999,?,1,0,2,?,'{}',?,'VALID',0,0,?,?)").bind(active.id, "b".repeat(64), "c".repeat(64), now, now).run(), /normalized row binding mismatch|FOREIGN KEY/);
  } finally { await context.mf.dispose(); }
});

test("protected 0006 Down, re-upgrade, refusal, and failed rebuild rollback", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await insertMappedBatch(context.DB);
    await runSqlFile(context.DB, "drizzle/0006_material_import_normalization.sql");
    await runSqlFile(context.DB, "drizzle/rollback/0006_material_import_normalization.down.sql");
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_normalization_runs'").first(), null);
    assert.equal((await context.DB.prepare("SELECT status,current_parse_run_id FROM material_import_batches WHERE id=1").first()).status, "MAPPING_CONFIRMED");
    await runSqlFile(context.DB, "drizzle/0006_material_import_normalization.sql");
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_normalization_runs'").first());
    await context.DB.prepare("INSERT INTO material_import_normalization_runs(batch_id,parse_run_id,mapping_id,mapping_version,mapping_digest,processor_version,payload_schema_version,metadata_digest,batch_version_at_start,run_status,attempt_no,current_stage,total_rows,processed_rows,valid_rows,warning_rows,error_rows,normalized_json_bytes,issue_count,warning_count,error_count,requested_by,created_at,updated_at) VALUES(1,1,1,1,?,'norm-v1',1,?,2,'QUEUED',1,'LOAD_MAPPING',0,0,0,0,0,0,0,0,0,'owner',?,?)").bind("d".repeat(64), "a".repeat(64), "2026-07-17T00:00:00.000Z", "2026-07-17T00:00:00.000Z").run();
    await assert.rejects(runSqlFile(context.DB, "drizzle/rollback/0006_material_import_normalization.down.sql"), /NOT NULL/);
  } finally { await context.mf.dispose(); }

  const rollback = await fixture();
  try {
    await insertMappedBatch(rollback.DB);
    const sql = await readFile(join(siteRoot, "drizzle/0006_material_import_normalization.sql"), "utf8");
    const statements = splitD1MigrationStatements(sql);
    statements.splice(Math.floor(statements.length / 2), 0, "CREATE TABLE material_import_batches(id INTEGER)");
    await assert.rejects(rollback.DB.batch(statements.map((statement) => rollback.DB.prepare(statement))));
    assert.equal(await rollback.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_normalization_runs'").first(), null);
    assert.deepEqual(await rollback.DB.prepare("SELECT status,current_parse_run_id FROM material_import_batches WHERE id=1").first(), { status: "MAPPING_CONFIRMED", current_parse_run_id: 1 });
  } finally { await rollback.mf.dispose(); }
});
