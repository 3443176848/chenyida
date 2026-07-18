import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const migrations = [
  "0000_far_nightmare.sql",
  "0001_material_master_v2.sql",
  "0002_material_draft_review_api.sql",
  "0003_material_draft_lifecycle.sql",
  "0004_material_import_batch_foundation.sql",
  "0005_material_import_parser_mapping.sql",
  "0006_material_import_normalization.sql",
  "0007_material_library.sql",
];
let sequence = 0;

async function runSqlFile(DB, relativePath) {
  const sql = await readFile(join(siteRoot, relativePath), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((statement) => DB.prepare(statement)));
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `adaptive-import-migration-${sequence}` },
  });
  const { DB } = await mf.getBindings();
  for (const migration of migrations) await runSqlFile(DB, `drizzle/${migration}`);
  const now = "2026-07-18T08:00:00.000Z";
  await DB.prepare(
    "INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES('owner','Owner','manager','test',1,0,1,?,?)",
  ).bind(now, now).run();
  return { mf, DB, now };
}

async function insertLegacyMapping(DB, now) {
  await DB.prepare(
    "INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-ADAPTIVE-1','CSV','FILE_READY','owner',1,0,0,0,0,?,?)",
  ).bind(now, now).run();
  await DB.prepare(
    "INSERT INTO material_import_parse_runs(id,batch_id,parser_version,run_status,attempt_no,current_stage,mapping_preparation_status,completed_at,created_at,updated_at) VALUES(1,1,'parser-v1','SUCCEEDED',1,'COMPLETE','READY',?,?,?)",
  ).bind(now, now, now).run();
  await DB.prepare("UPDATE material_import_batches SET status='AWAITING_MAPPING',current_parse_run_id=1 WHERE id=1").run();
  await DB.prepare(
    "INSERT INTO material_import_mappings(id,batch_id,parse_run_id,selected_sheet_index,header_mode,header_row_number,mapping_status,mapping_version,metadata_digest,created_by,updated_by,created_at,updated_at) VALUES(1,1,1,0,'SINGLE_ROW',1,'DRAFT',1,?,'owner','owner',?,?)",
  ).bind("a".repeat(64), now, now).run();
  await DB.prepare(
    "INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order) VALUES(1,0,'品名','basic','STANDARD_NAME','SOURCE',1,0)",
  ).run();
}

test("0008 upgrades an empty 0007 database and exposes adaptive schema", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await runSqlFile(context.DB, "drizzle/0008_supplier_adaptive_import.sql");
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_supplier_profiles'").first());
    for (const [table, column] of [
      ["material_import_mappings", "header_start_row_number"],
      ["material_import_mapping_items", "source_column_indexes_json"],
      ["material_import_normalized_rows", "review_status"],
    ]) {
      assert.ok(await context.DB.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name=?`).bind(column).first(), `${table}.${column}`);
    }
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally {
    await context.mf.dispose();
  }
});

test("0008 preserves legacy mappings and permits controlled multi-source specification mappings", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await insertLegacyMapping(context.DB, context.now);
    await runSqlFile(context.DB, "drizzle/0008_supplier_adaptive_import.sql");
    assert.deepEqual(
      await context.DB.prepare("SELECT source_column_index,source_column_indexes_json,adaptive_mapping_status FROM material_import_mapping_items WHERE mapping_id=1").first(),
      { source_column_index: 0, source_column_indexes_json: null, adaptive_mapping_status: "UNMAPPED" },
    );
    await context.DB.prepare(
      `INSERT INTO material_import_mapping_items(
        mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order,
        source_column_indexes_json,source_headers_json,combination_strategy,mapping_confidence,adaptive_mapping_status,mapping_evidence_json
      ) VALUES(1,0,'型号 / 尺寸','supplier_reference','SUPPLIER_SPECIFICATION','SOURCE',0,1,
        '[0,1]','["型号","尺寸"]','SPECIFICATION_EXTRACT',0.8,'SUGGESTED','["HEADER_ALIAS","VALUE_SHAPE"]')`,
    ).run();
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_mapping_items WHERE mapping_id=1 AND source_column_index=0").first()).count, 2);
    await assert.rejects(
      context.DB.prepare("UPDATE material_import_mapping_items SET mapping_confidence=1.1 WHERE target_code='SUPPLIER_SPECIFICATION'").run(),
      /CHECK constraint failed/,
    );
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally {
    await context.mf.dispose();
  }
});

test("protected 0008 compatibility rollback, refusal, and failed upgrade are atomic", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await runSqlFile(context.DB, "drizzle/0008_supplier_adaptive_import.sql");
    await runSqlFile(context.DB, "drizzle/rollback/0008_supplier_adaptive_import.down.sql");
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_supplier_profiles'").first());
    assert.ok(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='material_import_mapping_items_source_uq'").first());
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='material_import_mapping_items_source_idx'").first(), null);
    await context.DB.prepare(
      "INSERT INTO material_import_supplier_profiles(supplier_key,profile_name,created_by,updated_by,created_at,updated_at) VALUES('supplier-a','默认模板','owner','owner',?,?)",
    ).bind(context.now, context.now).run();
    await assert.rejects(
      runSqlFile(context.DB, "drizzle/rollback/0008_supplier_adaptive_import.down.sql"),
      /NOT NULL constraint failed/,
    );
  } finally {
    await context.mf.dispose();
  }

  const failed = await fixture();
  try {
    const sql = await readFile(join(siteRoot, "drizzle/0008_supplier_adaptive_import.sql"), "utf8");
    const statements = splitD1MigrationStatements(sql);
    statements.splice(Math.floor(statements.length / 2), 0, "CREATE TABLE material_import_batches(id INTEGER)");
    await assert.rejects(failed.DB.batch(statements.map((statement) => failed.DB.prepare(statement))));
    assert.equal(await failed.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_supplier_profiles'").first(), null);
    assert.equal(await failed.DB.prepare("SELECT name FROM pragma_table_info('material_import_mappings') WHERE name='supplier_profile_id'").first(), null);
  } finally {
    await failed.mf.dispose();
  }
});
