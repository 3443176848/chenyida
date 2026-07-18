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
    d1Databases: { DB: `material-library-migration-${sequence}` },
  });
  const { DB } = await mf.getBindings();
  for (const migration of migrations) await runSqlFile(DB, `drizzle/${migration}`);
  await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version) VALUES('owner','所有者','manager','test',1,0,1)").run();
  return { mf, DB };
}

test("0007 upgrades 0006, seeds canonical units, and preserves existing material rows", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await context.DB.prepare(`
      INSERT INTO material_categories(id,category_code,category_name_cn,category_level,status,created_by,updated_by,request_id)
      VALUES(1,'ROOT','根分类',1,'ACTIVE','owner','owner','before')
    `).run();
    await context.DB.prepare(`
      INSERT INTO material_master(
        id,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,
        material_status,procurement_type,inventory_type,lot_control_required,inspection_type,
        environmental_requirement,source_type,source_ref,version,last_modified_by,
        created_by,updated_by,request_id
      ) VALUES(1,'既有草稿',1,'','', '', 'PCS','DRAFT','PURCHASE','STOCKED',0,'NONE',
        'UNSPECIFIED','MANUAL','manual:1',1,'owner','owner','owner','before')
    `).run();

    await runSqlFile(context.DB, "drizzle/0007_material_library.sql");
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
    const tables = (await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((row) => row.name);
    for (const table of ["units", "unit_aliases", "brands", "brand_aliases", "material_import_normalization_approvals", "material_import_draft_links", "material_duplicate_candidates"]) {
      assert.ok(tables.includes(table), table);
    }
    assert.deepEqual(
      (await context.DB.prepare("SELECT code FROM units ORDER BY id").all()).results.map((row) => row.code),
      ["PCS", "KG", "G", "M", "MM"],
    );
    assert.deepEqual(
      await context.DB.prepare("SELECT brand_id,base_unit_id,source_import_batch_id,source_import_file_id,source_import_row_id FROM material_master WHERE id=1").first(),
      { brand_id: null, base_unit_id: null, source_import_batch_id: null, source_import_file_id: null, source_import_row_id: null },
    );
    await assert.rejects(
      context.DB.prepare("INSERT INTO units(code,name,symbol,unit_type,enabled) VALUES('pcs','重复','pcs','COUNT',1)").run(),
      /units_code_ck/,
    );
    await assert.rejects(
      context.DB.prepare("INSERT INTO unit_aliases(unit_id,alias,normalized_alias) VALUES(1,'PCS','pcs')").run(),
      /UNIQUE/,
    );
    await assert.rejects(
      context.DB.prepare("UPDATE material_master SET base_unit_id=999 WHERE id=1").run(),
      /FOREIGN KEY/,
    );
  } finally {
    await context.mf.dispose();
  }
});

test("0007 protected Down supports empty re-upgrade and refuses governed data", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await runSqlFile(context.DB, "drizzle/0007_material_library.sql");
    await runSqlFile(context.DB, "drizzle/rollback/0007_material_library.down.sql");
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='units'").first(), null);
    assert.equal((await context.DB.prepare("PRAGMA table_info(material_master)").all()).results.some((column) => column.name === "base_unit_id"), false);
    await runSqlFile(context.DB, "drizzle/0007_material_library.sql");
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM units").first()).count, 5);
    await context.DB.prepare("INSERT INTO brands(code,standard_name,normalized_name,enabled) VALUES('MURATA','村田','村田',1)").run();
    await assert.rejects(runSqlFile(context.DB, "drizzle/rollback/0007_material_library.down.sql"), /NOT NULL/);
  } finally {
    await context.mf.dispose();
  }
});

test("0007 failed application rolls back every additive object", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const sql = await readFile(join(siteRoot, "drizzle/0007_material_library.sql"), "utf8");
    const statements = splitD1MigrationStatements(sql);
    statements.splice(Math.floor(statements.length / 2), 0, "CREATE TABLE material_master(id INTEGER)");
    await assert.rejects(context.DB.batch(statements.map((statement) => context.DB.prepare(statement))));
    assert.equal(await context.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='units'").first(), null);
    assert.equal((await context.DB.prepare("PRAGMA table_info(material_master)").all()).results.some((column) => column.name === "base_unit_id"), false);
  } finally {
    await context.mf.dispose();
  }
});
