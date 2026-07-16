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
  const statements = splitD1MigrationStatements(sql);
  await DB.batch(statements.map((statement) => DB.prepare(statement)));
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `material-import-migration-${sequence}` },
  });
  const { DB } = await mf.getBindings();
  for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql"]) {
    await runSqlFile(DB, `drizzle/${migration}`);
  }
  await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('owner','所有者','purchase','test',1,0,1)").run();
  return { mf, DB };
}

test("Material import 0004 upgrades an existing database and enforces relational constraints", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await context.DB.prepare("INSERT INTO erp_records(kind,code,data_json,version,created_by) VALUES('legacy','KEEP','{}',1,'owner')").run();
    await runSqlFile(context.DB, "drizzle/0004_material_import_batch_foundation.sql");
    const tables = (await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((row) => row.name);
    for (const name of ["material_import_batches", "material_import_files", "material_import_rows", "material_import_events", "material_import_idempotency"]) assert.ok(tables.includes(name));
    assert.equal((await context.DB.prepare("SELECT code FROM erp_records WHERE kind='legacy'").first()).code, "KEEP");

    await context.DB.prepare(`INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-1','CSV','CREATED','owner',1,0,0,0,0,'2026-07-15T00:00:00Z','2026-07-15T00:00:00Z')`).run();
    await assert.rejects(context.DB.prepare(`INSERT INTO material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES('MIB-1','CSV','CREATED','owner',1,0,0,0,0,'x','x')`).run(), /UNIQUE/);
    await assert.rejects(context.DB.prepare(`INSERT INTO material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES('MIB-BAD','CSV','PARSING','owner',1,0,0,0,0,'x','x')`).run(), /material_import_batches_status_ck/);
    await assert.rejects(context.DB.prepare(`INSERT INTO material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES('MIB-FAILED','CSV','FAILED','owner',1,0,0,0,0,'x','x')`).run(), /material_import_batches_failure_ck|terminal_ck/);
    await assert.rejects(context.DB.prepare(`INSERT INTO material_import_rows(batch_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_sha256,created_at) VALUES(999,0,'__CSV__',1,'{}',?,'x')`).bind("a".repeat(64)).run(), /FOREIGN KEY/);
    await assert.rejects(context.DB.prepare(`INSERT INTO material_import_rows(batch_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_sha256,created_at) VALUES(1,-1,'__CSV__',1,'{}',?,'x')`).bind("a".repeat(64)).run(), /material_import_rows_position_ck/);
    await context.DB.prepare(`INSERT INTO material_import_rows(batch_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_sha256,created_at) VALUES(1,0,'__CSV__',1,'{}',?,'x')`).bind("a".repeat(64)).run();
    await assert.rejects(context.DB.prepare(`INSERT INTO material_import_rows(batch_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_sha256,created_at) VALUES(1,0,'renamed',1,'{}',?,'x')`).bind("b".repeat(64)).run(), /UNIQUE/);
    await assert.rejects(context.DB.prepare("DELETE FROM material_import_batches WHERE id=1").run(), /FOREIGN KEY/);
  } finally {
    await context.mf.dispose();
  }
});

test("0004 Down remains green with guarded empty down and re-up", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await runSqlFile(context.DB, "drizzle/0004_material_import_batch_foundation.sql");
    await runSqlFile(context.DB, "drizzle/rollback/0004_material_import_batch_foundation.down.sql");
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_batches'").first(), null);
    await runSqlFile(context.DB, "drizzle/0004_material_import_batch_foundation.sql");
    await context.DB.prepare(`INSERT INTO material_import_batches(batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES('MIB-DOWN','CSV','CREATED','owner',1,0,0,0,0,'x','x')`).run();
    await assert.rejects(runSqlFile(context.DB, "drizzle/rollback/0004_material_import_batch_foundation.down.sql"));
    assert.ok(await context.DB.prepare("SELECT id FROM material_import_batches WHERE batch_no='MIB-DOWN'").first());
  } finally {
    await context.mf.dispose();
  }
});

test("Material import 0004 batch application rolls back on a later statement failure", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const sql = await readFile(join(siteRoot, "drizzle/0004_material_import_batch_foundation.sql"), "utf8");
    const statements = splitD1MigrationStatements(sql);
    statements.splice(2, 0, "CREATE TABLE material_import_batches(id INTEGER)");
    await assert.rejects(context.DB.batch(statements.map((statement) => context.DB.prepare(statement))));
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='material_import_batches'").first(), null);
  } finally {
    await context.mf.dispose();
  }
});
