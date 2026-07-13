import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
let databaseSequence = 0;

async function runSqlFile(DB, relativePath) {
  const sql = await readFile(join(siteRoot, relativePath), "utf8");
  const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
  await DB.batch(statements.map((statement) => DB.prepare(statement)));
}

async function fixture() {
  databaseSequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `material-draft-lifecycle-migration-${databaseSequence}` },
  });
  const { DB } = await mf.getBindings();
  await runSqlFile(DB, "drizzle/0000_far_nightmare.sql");
  await runSqlFile(DB, "drizzle/0001_material_master_v2.sql");
  await runSqlFile(DB, "drizzle/0002_material_draft_review_api.sql");
  await DB.batch([
    DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('creator','创建人','purchase','test',1,0,1)"),
    DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('submitter','提交人','manager','test',1,0,1)"),
    DB.prepare(`
      INSERT INTO material_categories(id,category_code,category_name_cn,category_level,status,created_by,updated_by,request_id)
      VALUES(9001,'MIGRATION_LEAF','迁移叶类',4,'ACTIVE','test','test','seed')
    `),
  ]);
  return { mf, DB };
}

async function seedLegacyPending(DB, withSubmitHistory) {
  await DB.prepare(`
    INSERT INTO material_master(
      id,internal_material_code,standard_name,category_id,base_uom,material_status,
      procurement_type,inventory_type,inspection_type,environmental_requirement,
      source_type,source_ref,version,created_by,created_at,updated_by,updated_at,request_id
    ) VALUES(1001,NULL,'历史待审物料',9001,'PCS','PENDING_APPROVAL','PURCHASE','STOCKED',
      'NORMAL','ROHS','MANUAL','legacy:1001',2,'creator','2026-07-01T00:00:00.000Z',
      'creator','2026-07-02T00:00:00.000Z','legacy-submit')
  `).run();
  await DB.prepare(`
    INSERT INTO material_versions(
      material_id,version_no,event_type,change_reason,changed_fields_json,snapshot_json,
      changed_by,reviewed_by,reviewed_at,created_at,request_id
    ) VALUES(1001,1,'CREATE','', '["material_status"]',
      '{"material_status":"DRAFT"}','creator','',NULL,'2026-07-01T00:00:00.000Z','legacy-create')
  `).run();
  if (withSubmitHistory) {
    await DB.prepare(`
      INSERT INTO material_versions(
        material_id,version_no,event_type,change_reason,changed_fields_json,snapshot_json,
        changed_by,reviewed_by,reviewed_at,created_at,request_id
      ) VALUES(1001,2,'SUBMIT','历史提交', '["material_status"]',
        '{"material_status":"PENDING_APPROVAL"}','submitter','',NULL,
        '2026-07-02T00:00:00.000Z','legacy-submit')
    `).run();
  }
}

test("Material draft lifecycle 0003 backfills verifiable state and enforces expanded constraints", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await seedLegacyPending(context.DB, true);
    await context.DB.prepare(`
      INSERT INTO material_master(
        id,internal_material_code,standard_name,category_id,base_uom,material_status,
        procurement_type,inventory_type,inspection_type,environmental_requirement,
        source_type,source_ref,version,created_by,updated_by,request_id
      ) VALUES(1002,NULL,'历史草稿',9001,'PCS','DRAFT','PURCHASE','STOCKED','NORMAL','ROHS',
        'MANUAL','legacy:1002',1,'creator','submitter','legacy-draft')
    `).run();
    await runSqlFile(context.DB, "drizzle/0003_material_draft_lifecycle.sql");
    const versionForeignKeys = await context.DB.prepare("PRAGMA foreign_key_list(material_versions)").all();
    assert.ok(versionForeignKeys.results.some((row) => row.table === "material_master"));

    const rows = await context.DB.prepare(`
      SELECT id,material_status,last_modified_by,submitted_by,submitted_at FROM material_master ORDER BY id
    `).all();
    assert.deepEqual(rows.results, [
      { id: 1001, material_status: "PENDING_REVIEW", last_modified_by: "creator", submitted_by: "submitter", submitted_at: "2026-07-02T00:00:00.000Z" },
      { id: 1002, material_status: "DRAFT", last_modified_by: "creator", submitted_by: "", submitted_at: null },
    ]);
    const historical = await context.DB.prepare("SELECT snapshot_json FROM material_versions WHERE material_id=1001 AND version_no=2").first();
    assert.equal(JSON.parse(historical.snapshot_json).material_status, "PENDING_APPROVAL");

    await context.DB.prepare(`
      INSERT INTO material_api_idempotency(
        username,method,route_scope,key_digest,request_digest,operation_id,state,
        lease_token_digest,lease_expires_at,created_at,updated_at
      ) VALUES('creator','PATCH','/api/material-master/drafts/1002',?,?,?,'PENDING',?,1,?,?)
    `).bind("a".repeat(64), "b".repeat(64), "00000000-0000-4000-8000-000000000003", "c".repeat(64), "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z").run();
    await assert.rejects(
      context.DB.prepare("UPDATE material_master SET submitted_by='creator',submitted_at=NULL WHERE id=1002").run(),
      /material_master_submission_ck/,
    );
    const indexes = await context.DB.prepare("PRAGMA index_list(material_master)").all();
    for (const name of ["material_master_review_queue_idx", "material_master_review_category_idx", "material_master_review_source_idx", "material_master_review_creator_idx"]) {
      assert.ok(indexes.results.some((row) => row.name === name), `missing ${name}`);
    }
    const plan = await context.DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM material_master WHERE material_status='PENDING_REVIEW' ORDER BY submitted_at DESC,id DESC LIMIT 20").all();
    assert.match(plan.results.map((row) => String(row.detail)).join("\n"), /material_master_review_queue_idx/);
  } finally {
    await context.mf.dispose();
  }
});

test("Material draft lifecycle 0003 preflight fails without recoverable submission responsibility", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await seedLegacyPending(context.DB, false);
    await assert.rejects(runSqlFile(context.DB, "drizzle/0003_material_draft_lifecycle.sql"));
    const columns = await context.DB.prepare("PRAGMA table_info(material_master)").all();
    assert.ok(!columns.results.some((column) => column.name === "last_modified_by"));
    const state = await context.DB.prepare("SELECT material_status FROM material_master WHERE id=1001").first();
    assert.equal(state.material_status, "PENDING_APPROVAL");
  } finally {
    await context.mf.dispose();
  }
});

test("Material draft lifecycle 0003 supports guarded empty down and re-up", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await runSqlFile(context.DB, "drizzle/0003_material_draft_lifecycle.sql");
    await runSqlFile(context.DB, "drizzle/rollback/0003_material_draft_lifecycle.down.sql");
    let columns = await context.DB.prepare("PRAGMA table_info(material_master)").all();
    assert.ok(!columns.results.some((column) => column.name === "last_modified_by"));
    const oldSql = await context.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='material_api_idempotency'").first();
    assert.match(oldSql.sql, /method = 'POST'/);
    await runSqlFile(context.DB, "drizzle/0003_material_draft_lifecycle.sql");
    columns = await context.DB.prepare("PRAGMA table_info(material_master)").all();
    assert.ok(columns.results.some((column) => column.name === "last_modified_by"));
  } finally {
    await context.mf.dispose();
  }
});
