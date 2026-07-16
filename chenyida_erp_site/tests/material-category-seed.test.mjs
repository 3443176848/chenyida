import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Miniflare } from "miniflare";
import { MATERIAL_ATTRIBUTES, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_BINDINGS, MATERIAL_CATEGORY_CODE_PATTERN, validateMaterialCategorySeed } from "../seeds/material-category-v1.ts";
import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const runner = join(siteRoot, "scripts", "seed-material-categories.ts");

function run(args, env = "test", expected = 0) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", runner, ...args], { cwd: siteRoot, encoding: "utf8", env: { ...process.env, ERP_ENV: env } });
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`); return `${result.stdout}${result.stderr}`;
}
async function withDb(persistTo, fn) { const mf = new Miniflare({ modules: true, script: "export default {}", compatibilityDate: "2026-05-22", d1Databases: { DB: "local-test-only" }, d1Persist: persistTo }); try { const { DB } = await mf.getBindings(); return await fn(DB); } finally { await mf.dispose(); } }

test("category seed declarations are valid and every leaf is explicitly bound", () => {
  validateMaterialCategorySeed();
  assert.equal(new Set(MATERIAL_CATEGORIES.map((item) => item.code)).size, MATERIAL_CATEGORIES.length);
  assert.equal(new Set(MATERIAL_ATTRIBUTES.map((item) => item.code)).size, MATERIAL_ATTRIBUTES.length);
  assert.ok(MATERIAL_CATEGORIES.every((item) => MATERIAL_CATEGORY_CODE_PATTERN.test(item.code)));
  const categories = new Map(MATERIAL_CATEGORIES.map((item) => [item.code, item]));
  for (const item of MATERIAL_CATEGORIES.filter((entry) => entry.level > 1)) assert.equal(categories.get(item.parentCode)?.level, item.level - 1);
  const leaves = MATERIAL_CATEGORIES.filter((item) => item.level === 4).map((item) => item.code).sort();
  assert.deepEqual(MATERIAL_CATEGORY_BINDINGS.map((item) => item.categoryCode).sort(), leaves);
  const required = (categoryCode) => MATERIAL_CATEGORY_BINDINGS.find((item) => item.categoryCode === categoryCode)?.requiredCodes ?? [];
  for (const code of ["BRAND","MODEL","THICKNESS","COPPER_THICKNESS","TG"]) assert.ok(required("FR4_STANDARD").includes(code));
  for (const code of ["PI_THICKNESS","ADHESIVE_THICKNESS","COLOR"]) assert.ok(required("COVERLAY_PI_STD").includes(code));
  for (const code of ["RESISTANCE","TOLERANCE","POWER","PACKAGE"]) assert.ok(required("RES_CHIP").includes(code));
  for (const code of ["BRAND","ALLOY","POWDER_GRADE","WEIGHT"]) assert.ok(required("PASTE_LEAD_FREE_STD").includes(code));
});

test("category seed is local-only, transactional and idempotent", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "chenyida-category-seed-test-")); const persistTo = join(root, "d1");
  try {
    const config = join(root, "wrangler.jsonc"); await writeFile(config, JSON.stringify({ name: "category-seed-test", compatibility_date: "2026-05-22", d1_databases: [{ binding: "DB", database_name: "category-seed-test", database_id: "local-test-only" }] }), "utf8");
    await withDb(persistTo, async (DB) => { for (const name of ["0000_far_nightmare.sql", "0001_material_master_v2.sql"]) { const statements = splitD1MigrationStatements(await readFile(join(siteRoot, "drizzle", name), "utf8")); await DB.batch(statements.map((sql) => DB.prepare(sql))); } });
    const first = run(["--config", config, "--persist-to", persistTo]); assert.match(first, /material-category-v1/); assert.match(first, /inserted/);
    const counts1 = await withDb(persistTo, (DB) => DB.prepare("SELECT (SELECT count(*) FROM material_categories) categories,(SELECT count(*) FROM material_attribute_definitions) attributes,(SELECT count(*) FROM material_category_attributes) bindings").first());
    assert.deepEqual(counts1, { categories: MATERIAL_CATEGORIES.length, attributes: MATERIAL_ATTRIBUTES.length, bindings: MATERIAL_CATEGORY_BINDINGS.reduce((sum, item) => sum + item.attributeCodes.length, 0) });
    const second = run(["--config", config, "--persist-to", persistTo]); assert.match(second, /inserted[^0-9]*0/);
    const counts2 = await withDb(persistTo, (DB) => DB.prepare("SELECT (SELECT count(*) FROM material_categories) categories,(SELECT count(*) FROM material_attribute_definitions) attributes,(SELECT count(*) FROM material_category_attributes) bindings").first()); assert.deepEqual(counts2, counts1);
    const invalidParentCount = await withDb(persistTo, async (DB) => (await DB.prepare("SELECT count(*) count FROM material_categories c JOIN material_categories p ON p.id=c.parent_id WHERE c.category_level<>p.category_level+1").first()).count); assert.equal(invalidParentCount, 0);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); }
});

test("category seed rejects production and remote execution before database access", () => {
  assert.match(run(["--config", "missing", "--persist-to", "missing"], "production", 1), /ERP_ENV must be test or local/);
  assert.match(run(["--remote", "--config", "missing", "--persist-to", "missing"], "test", 1), /remote or production D1 is forbidden/);
});
