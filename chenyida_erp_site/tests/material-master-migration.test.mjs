import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const wrangler = join(siteRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const v2Tables = [
  "legacy_material_mapping", "material_aliases", "material_attribute_definitions", "material_attribute_values",
  "material_categories", "material_category_attributes", "material_change_logs", "material_code_rules",
  "material_master", "material_versions", "supplier_mapping_price_history", "supplier_mappings",
];

function runWrangler(config, persistTo, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [wrangler, ...args, "--config", config, "--local", "--persist-to", persistTo], {
    cwd: siteRoot, encoding: "utf8",
    env: { ...process.env, ERP_ENV: "test" },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (expectedStatus === "nonzero") assert.notEqual(result.status, 0, output);
  else assert.equal(result.status, expectedStatus, output);
  return output;
}

function parseJsonOutput(output) {
  const start = output.indexOf("[");
  assert.notEqual(start, -1, `No JSON array in Wrangler output: ${output}`);
  return JSON.parse(output.slice(start));
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chenyida-material-migration-test-"));
  const migrations = join(root, "migrations");
  const persistTo = join(root, "d1");
  await mkdir(migrations);
  await cp(join(siteRoot, "drizzle", "0000_far_nightmare.sql"), join(migrations, "0000_far_nightmare.sql"));
  await cp(join(siteRoot, "drizzle", "0001_material_master_v2.sql"), join(migrations, "0001_material_master_v2.sql"));
  const config = join(root, "wrangler.jsonc");
  await writeFile(config, JSON.stringify({ name: "material-migration-test", compatibility_date: "2026-07-11", d1_databases: [{ binding: "DB", database_name: "material-migration-test", database_id: "local-test-only", migrations_dir: migrations }] }), "utf8");
  return { root, migrations, persistTo, config };
}

async function query(context, sql) {
  const output = runWrangler(context.config, context.persistTo, ["d1", "execute", "DB", "--command", sql, "--json"]);
  return parseJsonOutput(output)[0].results;
}

test("Material Master V2 up, idempotence, constraints, down and re-up", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    runWrangler(context.config, context.persistTo, ["d1", "migrations", "apply", "DB"]);
    const firstTables = (await query(context, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((row) => row.name);
    for (const table of v2Tables) assert.ok(firstTables.includes(table), `missing ${table}`);

    const secondApply = runWrangler(context.config, context.persistTo, ["d1", "migrations", "apply", "DB"]);
    assert.match(secondApply, /No migrations to apply/i);
    assert.deepEqual((await query(context, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((row) => row.name), firstTables);

    const columns = await query(context, "PRAGMA table_info(material_master)");
    assert.ok(columns.some((column) => column.name === "material_status"));
    const changeColumns = await query(context, "PRAGMA table_info(material_change_logs)");
    assert.ok(changeColumns.some((column) => column.name === "change_type"));
    const supplierIndexes = await query(context, "PRAGMA index_list(supplier_mappings)");
    assert.ok(supplierIndexes.some((index) => index.name === "supplier_mappings_current_identity_uq" && index.unique === 1));

    const seed = "INSERT INTO material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) VALUES('TEST','测试',1,'ACTIVE','test','test','req');";
    runWrangler(context.config, context.persistTo, ["d1", "execute", "DB", "--command", seed]);
    const invalidDraft = "INSERT INTO material_master(internal_material_code,standard_name,category_id,base_uom,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,source_ref,created_by,updated_by,request_id) VALUES('CYD-X','草稿',1,'EA','DRAFT','PURCHASE','STOCKED','NONE','UNSPECIFIED','MANUAL','test','test','test','req');";
    const rejectedDraft = runWrangler(context.config, context.persistTo, ["d1", "execute", "DB", "--command", invalidDraft], "nonzero");
    assert.match(rejectedDraft, /material_master_code_after_approval_ck/);

    const downFile = join(context.root, "0001.down.sql");
    await writeFile(downFile, await readFile(join(siteRoot, "drizzle", "rollback", "0001_material_master_v2.down.sql"), "utf8"), "utf8");
    runWrangler(context.config, context.persistTo, ["d1", "execute", "DB", "--file", downFile]);
    const afterDown = (await query(context, "SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    for (const table of v2Tables) assert.ok(!afterDown.includes(table), `rollback retained ${table}`);
    assert.ok(afterDown.includes("erp_records"), "rollback removed V1 table");

    await query(context, "DELETE FROM d1_migrations WHERE name='0001_material_master_v2.sql'");
    runWrangler(context.config, context.persistTo, ["d1", "migrations", "apply", "DB"]);
    const afterReup = (await query(context, "SELECT name FROM sqlite_master WHERE type='table'")).map((row) => row.name);
    for (const table of v2Tables) assert.ok(afterReup.includes(table), `re-up missing ${table}`);
  } finally {
    assert.match(context.root, /chenyida-material-migration-test-/);
    await rm(context.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  }
});
