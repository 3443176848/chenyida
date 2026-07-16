import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Miniflare } from "miniflare";

import { splitD1MigrationStatements } from "./d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const requestedEnvironment = String(process.env.ERP_ENV || "test").toLowerCase();
if (requestedEnvironment !== "test") {
  throw new Error(`Refusing query-plan test because ERP_ENV is ${requestedEnvironment}; use ERP_ENV=test`);
}

async function applyMigration(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((part) => DB.prepare(part)));
}

async function seedSynthetic(DB, scale) {
  await DB.batch([
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id) VALUES(9900,'PLAN_ROOT','物料',NULL,1,'ACTIVE',1,'test','test','plan')"),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id) VALUES(9901,'PLAN_GROUP','板材',9900,2,'ACTIVE',1,'test','test','plan')"),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id) VALUES(9902,'PLAN_FAMILY','FR4',9901,3,'ACTIVE',1,'test','test','plan')"),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id) VALUES(9903,'PLAN_LEAF','普通FR4',9902,4,'ACTIVE',1,'test','test','plan')"),
  ]);
  await DB.prepare(`
    WITH digits(value) AS (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
    numbers(n) AS (
      SELECT 1 + a.value + b.value*10 + c.value*100 + d.value*1000 + e.value*10000
      FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d CROSS JOIN digits e
      WHERE 1 + a.value + b.value*10 + c.value*100 + d.value*1000 + e.value*10000 <= ?
    )
    INSERT INTO material_master(
      internal_material_code, standard_name, category_id, brand, manufacturer,
      manufacturer_part_number, base_uom, material_status, procurement_type,
      inventory_type, lot_control_required, inspection_type, environmental_requirement,
      source_type, source_ref, version, last_modified_by, submitted_by, submitted_at,
      approved_by, approved_at, created_by, created_at, updated_by, updated_at, request_id
    )
    SELECT
      CASE WHEN n % 10 >= 4 THEN printf('CYD-PLAN-%06d', n) ELSE NULL END,
      '合成物料 ' || printf('%06d', n), 9903, '', 'MAKER-' || (n % 50),
      'MPN-' || printf('%06d', n), 'PCS',
      CASE WHEN n % 10 < 2 THEN 'DRAFT' WHEN n % 10 < 4 THEN 'PENDING_REVIEW' ELSE 'ACTIVE' END,
      'PURCHASE', 'STOCKED', 0, 'NORMAL', 'ROHS', 'MANUAL', 'synthetic:' || n,
      1, 'user' || (n % 10),
      CASE WHEN n % 10 BETWEEN 2 AND 3 THEN 'user' || (n % 10) ELSE '' END,
      CASE WHEN n % 10 BETWEEN 2 AND 3 THEN '2026-07-14T07:00:00.000Z' ELSE NULL END,
      CASE WHEN n % 10 >= 4 THEN 'reviewer' ELSE '' END,
      CASE WHEN n % 10 >= 4 THEN '2026-07-14T08:00:00.000Z' ELSE NULL END,
      'user' || (n % 10),
      printf('2026-07-%02dT00:00:00.000Z', 1 + (n % 14)),
      'user' || (n % 10),
      printf('2026-07-%02dT08:00:00.000Z', 1 + (n % 14)),
      'synthetic-' || n
    FROM numbers
  `).bind(scale).run();
  await DB.prepare("ANALYZE").run();
}

const scenarios = [
  {
    name: "formal_read_default",
    sql: "SELECT id FROM material_master m WHERE m.material_status IN ('ACTIVE','FROZEN','INACTIVE') ORDER BY m.updated_at DESC,m.id DESC LIMIT 20",
    values: [],
  },
  {
    name: "creator_visibility_default",
    sql: "SELECT id FROM material_master m WHERE (m.material_status IN ('ACTIVE','FROZEN','INACTIVE') OR (m.material_status='DRAFT' AND m.created_by=?) OR (m.material_status IN ('PENDING_REVIEW','PENDING_APPROVAL') AND m.created_by=?)) ORDER BY m.updated_at DESC,m.id DESC LIMIT 20",
    values: ["user1", "user1"],
  },
  {
    name: "creator_visibility_count",
    sql: "SELECT COUNT(*) AS total FROM material_master m WHERE (m.material_status IN ('ACTIVE','FROZEN','INACTIVE') OR (m.material_status='DRAFT' AND m.created_by=?) OR (m.material_status IN ('PENDING_REVIEW','PENDING_APPROVAL') AND m.created_by=?))",
    values: ["user1", "user1"],
  },
  {
    name: "edit_any_visibility_default",
    sql: "SELECT id FROM material_master m WHERE (m.material_status IN ('ACTIVE','FROZEN','INACTIVE') OR m.material_status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL')) ORDER BY m.updated_at DESC,m.id DESC LIMIT 20",
    values: [],
  },
  {
    name: "edit_any_visibility_count",
    sql: "SELECT COUNT(*) AS total FROM material_master m WHERE (m.material_status IN ('ACTIVE','FROZEN','INACTIVE') OR m.material_status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL'))",
    values: [],
  },
  {
    name: "review_queue_visibility",
    sql: "SELECT id FROM material_master m WHERE m.material_status IN ('PENDING_REVIEW','PENDING_APPROVAL') ORDER BY m.submitted_at DESC,m.id DESC LIMIT 20",
    values: [],
  },
  {
    name: "category_and_status",
    sql: "SELECT id FROM material_master m WHERE m.material_status='ACTIVE' AND m.category_id=? ORDER BY m.updated_at DESC,m.id DESC LIMIT 20",
    values: [9903],
  },
  {
    name: "source_and_status",
    sql: "SELECT id FROM material_master m WHERE m.material_status='ACTIVE' AND m.source_type=? ORDER BY m.updated_at DESC,m.id DESC LIMIT 20",
    values: ["MANUAL"],
  },
  {
    name: "creator_draft",
    sql: "SELECT id FROM material_master m WHERE m.material_status='DRAFT' AND m.created_by=? ORDER BY m.created_at DESC,m.id DESC LIMIT 20",
    values: ["user1"],
  },
  {
    name: "keyword_literal_contains",
    sql: "SELECT id FROM material_master m WHERE m.material_status='ACTIVE' AND (m.standard_name LIKE ? ESCAPE '\\' OR UPPER(COALESCE(m.internal_material_code,'')) LIKE ? ESCAPE '\\' OR m.manufacturer LIKE ? ESCAPE '\\' OR UPPER(m.manufacturer_part_number) LIKE ? ESCAPE '\\') ORDER BY m.updated_at DESC,m.id DESC LIMIT 20",
    values: ["%050%", "%050%", "%050%", "%050%"],
  },
];

async function inspectScale(scale) {
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `material-query-plan-${scale}-${crypto.randomUUID()}` },
  });
  try {
    const { DB } = await mf.getBindings();
    for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql"]) {
      await applyMigration(DB, migration);
    }
    await seedSynthetic(DB, scale);
    const indexes = (await DB.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='material_master' ORDER BY name").all()).results;
    const statusCounts = (await DB.prepare("SELECT material_status,COUNT(*) AS total FROM material_master GROUP BY material_status ORDER BY material_status").all()).results;
    const results = [];
    for (const scenario of scenarios) {
      const plan = (await DB.prepare(`EXPLAIN QUERY PLAN ${scenario.sql}`).bind(...scenario.values).all()).results.map((row) => String(row.detail));
      const timings = [];
      let returnedRows = 0;
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const start = performance.now();
        const response = await DB.prepare(scenario.sql).bind(...scenario.values).all();
        timings.push(performance.now() - start);
        returnedRows = response.results.length;
      }
      timings.sort((left, right) => left - right);
      results.push({
        name: scenario.name,
        plan,
        median_ms: Number(timings[3].toFixed(3)),
        p95_sample_ms: Number(timings[6].toFixed(3)),
        returned_rows: returnedRows,
      });
    }
    return { scale, status_counts: statusCounts, existing_indexes: indexes.map((row) => row.name), scenarios: results };
  } finally {
    await mf.dispose();
  }
}

const report = {
  generated_at: new Date().toISOString(),
  environment: "isolated in-memory Miniflare D1",
  migration_baseline: "0000..0003",
  scales: [],
};
for (const scale of [1_000, 10_000, 100_000]) report.scales.push(await inspectScale(scale));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
