import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || "";
const base = process.env.ERP_SMOKE_BASE_URL || "";
const adminUsername = process.env.ERP_ADMIN_USERNAME || "";
const adminPassword = process.env.ERP_ADMIN_PASSWORD || "";
const qualityUsername = process.env.ERP_QUALITY_USERNAME || "quality08";
const qualityPassword = process.env.ERP_QUALITY_PASSWORD || "Task08-Quality-Changed!567";
if (process.env.ERP_ENV !== "test" || !/_migration_test/i.test(databaseUrl) || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(base)) throw new Error("public materialization journey requires loopback synthetic test targets");
if (!adminUsername || !adminPassword) throw new Error("controlled setup test admin credentials are required");

function browser(username, password) {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expected = 200) {
    const headers = new Headers(init.headers); if (cookies.size) headers.set("Cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(";"); const separator = pair.indexOf("="); cookies.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    const payload = await response.json(); if (response.status !== expected) throw new Error(`${path}: ${response.status} ${payload?.code || "UNKNOWN"}`); return payload;
  }
  return {
    login: async () => { const payload = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); csrf = payload.csrf_token; },
    get: (path, expected) => request(path, {}, expected),
    write: (path, body, expected = 201) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) }, expected),
  };
}

const pool = new Pool({ connectionString: databaseUrl, application_name: "task03-public-journey" });
try {
  const before = await pool.query(`select
    (select count(*)::int from migration_tool.public_id_map) maps,
    (select count(*)::int from migration_tool.source_classifications where classification='ARCHIVE_ONLY') archived,
    (select count(*)::int from inventory_migration_openings) inventory_openings,
    (select count(*)::int from finance_opening_sources) finance_openings,
    (select count(*)::int from erp_records) erp_records`);
  assert.deepEqual(before.rows[0], { maps: 18, archived: 12, inventory_openings: 2, finance_openings: 2, erp_records: 0 });

  process.env.ERP_FULL_JOURNEY_REUSE_IDENTITY = "true";
  process.env.ERP_FINANCE_OPENING_AR = "6.500000";
  process.env.ERP_FINANCE_OPENING_AP = "7.250000";
  await import("./selfhost-full-erp-compose-smoke.mjs?task03-public-materialization");

  const refs = await pool.query(`select
    (select prl.id from purchase_receipt_lines prl join purchase_receipts pr on pr.id=prl.purchase_receipt_id join purchase_orders po on po.id=pr.purchase_order_id where po.remark='Compose 采购' order by prl.id limit 1) receipt_line_id,
    (select r.id from production_reports r join production_work_orders w on w.id=r.work_order_id where w.owner='Compose' order by r.id limit 1) report_id`);
  assert.ok(refs.rows[0].receipt_line_id && refs.rows[0].report_id);
  const admin = browser(adminUsername, adminPassword); await admin.login();
  const iqc = await admin.write("/api/quality-inspections", { inspection_type: "IQC", purchase_receipt_line_id: Number(refs.rows[0].receipt_line_id), inspected_qty: "5", passed_qty: "5", failed_qty: "0", results: [{ characteristic: "Synthetic incoming appearance", result: "PASS" }] });
  const ipqc = await admin.write("/api/quality-inspections", { inspection_type: "IPQC", production_report_id: Number(refs.rows[0].report_id), inspected_qty: "2", passed_qty: "2", failed_qty: "0", results: [{ characteristic: "Synthetic process dimension", result: "PASS" }] });
  const quality = browser(qualityUsername, qualityPassword); await quality.login();
  for (const inspection of [iqc, ipqc]) {
    await quality.write(`/api/quality-inspections/${inspection.inspection_id}/dispositions`, { expected_version: 1, disposition_code: "RELEASE", release_qty: inspection === iqc ? "5" : "2", reason: "TASK03 synthetic release" }, 200);
    await quality.write(`/api/quality-inspections/${inspection.inspection_id}/close`, { expected_version: 2, reason: "TASK03 synthetic close" }, 200);
  }

  const [summary, management, finance, inspections, inventory, orders, workOrders, salesOrders] = await Promise.all([
    admin.get("/api/summary"), admin.get("/api/management-dashboard"), admin.get("/api/finance-summary"), admin.get("/api/quality-inspections"),
    admin.get("/api/inventory"), admin.get("/api/purchase-orders"), admin.get("/api/work-orders"), admin.get("/api/sales-orders"),
  ]);
  await Promise.all([admin.get(`/api/quality-inspections/${iqc.inspection_id}`), admin.get(`/api/quality-inspections/${ipqc.inspection_id}`)]);
  assert.equal(summary.authority, "Node/PostgreSQL"); assert.ok(management.metrics.length > 0);
  assert.equal(finance.receivable_total, "56.500001"); assert.equal(finance.payable_total, "27.250000");
  assert.ok(inspections.rows.some((row) => row.inspection_type === "IQC" && row.lifecycle_status === "CLOSED"));
  assert.ok(inspections.rows.some((row) => row.inspection_type === "IPQC" && row.lifecycle_status === "CLOSED"));
  assert.ok(inspections.rows.some((row) => row.inspection_type === "FQC" && row.lifecycle_status === "CLOSED"));
  assert.ok(inventory.rows.length > 0 && orders.rows.length > 0 && workOrders.rows.length > 0 && salesOrders.rows.length > 0);

  const after = await pool.query(`select
    (select count(*)::int from migration_tool.public_id_map) maps,
    (select count(*)::int from quality_inspections where lifecycle_status='CLOSED') quality_closed,
    (select coalesce(sum(on_hand_quantity),0)::text from inventory_migration_opening_lines) opening_inventory,
    (select coalesce(sum(total_amount-settled_amount),0)::text from finance_documents where doc_type='OPENING_AR' and status<>'REVERSED') opening_ar,
    (select coalesce(sum(total_amount-settled_amount),0)::text from finance_documents where doc_type='OPENING_AP' and status<>'REVERSED') opening_ap,
    (select count(*)::int from erp_records) erp_records`);
  assert.deepEqual(after.rows[0], { maps: 18, quality_closed: 4, opening_inventory: "112.000000", opening_ar: "6.500000", opening_ap: "7.250000", erp_records: 0 });
  console.info(JSON.stringify({ ok: true, snapshot_targets: 18, archive_only: 12, quality_closed: 4, legacy_gets: 23, opening_inventory: "112.000000", finance_ar: finance.receivable_total, finance_ap: finance.payable_total }));
} finally { await pool.end(); }
