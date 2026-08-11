import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_DASHBOARD_SMOKE_PHASE || "initial";
const setupToken = process.env.ERP_SETUP_TOKEN || "";
const username = process.env.ERP_ADMIN_USERNAME || "";
const password = process.env.ERP_ADMIN_PASSWORD || "";
const reuseIdentity = process.env.ERP_FULL_JOURNEY_REUSE_IDENTITY === "true";
const expectedBackupStatus = process.env.ERP_EXPECTED_BACKUP_STATUS || "UNVERIFIED";
const legacyRefreshGetPaths = [
  "/api/summary", "/api/items", "/api/mappings", "/api/cleaning", "/api/products", "/api/customers", "/api/suppliers", "/api/boms",
  "/api/purchase-orders", "/api/purchase-order-lines", "/api/inventory", "/api/inventory-adjustments", "/api/work-orders", "/api/work-order-materials",
  "/api/production-reports", "/api/quotations", "/api/sales-orders", "/api/shipments", "/api/quality-inspections", "/api/quality-defects",
  "/api/finance-summary", "/api/financial-documents", "/api/financial-payments",
];
if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("dashboard compose smoke requires an isolated test database");
if (!setupToken || !username || !password) throw new Error("dashboard compose smoke credentials are required");

function browser() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expected = 200) {
    const headers = new Headers(init.headers); if (cookies.size) headers.set("Cookie", [...cookies].map(([key,value]) => `${key}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(";"); const split = pair.indexOf("="); cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
    const payload = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text();
    if (response.status !== expected) throw new Error(`${path}: ${response.status} ${JSON.stringify(payload)}`); return payload;
  }
  return {
    root: () => request("/"),
    setup: async () => { const result = await request("/api/setup", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({setup_token:setupToken,username,display_name:"TASK10 看板烟测管理员",password}) }, 201); csrf=result.csrf_token; return result; },
    login: async () => { const result = await request("/api/login", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password}) }); csrf=result.csrf_token; return result; },
    get: (path) => request(path),
    post: (path, body, status) => request(path, { method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf,"Idempotency-Key":randomUUID()},body:JSON.stringify(body) }, status),
  };
}

const pool = new Pool({ connectionString: databaseUrl, application_name:"dashboard-compose-smoke" });
try {
  const client = browser(); const root = await client.root(); if (/<iframe/i.test(root) || !root.includes("晨亿达 ERP")) throw new Error("root is not the native ERP workbench");
  if (phase === "initial") { if (!reuseIdentity) await client.setup(); else await client.login(); await pool.query("insert into background_jobs(id,type,idempotency_key,payload,status,last_error_code) values($1,'task10.smoke','task10-compose-failed','{}','FAILED','SYNTHETIC_FAILURE') on conflict(idempotency_key) do nothing", [randomUUID()]); }
  else if (phase === "restart") await client.login(); else throw new Error(`unsupported dashboard phase: ${phase}`);
  const summary = await client.get("/api/summary"); const management = await client.get("/api/management-dashboard"); const backup = await client.get("/api/backups");
  if (summary.authority !== "Node/PostgreSQL" || summary.inventory_quantity_aggregated !== false || summary.failed_jobs !== 1) throw new Error(`summary mismatch: ${JSON.stringify(summary)}`);
  if (reuseIdentity && !(summary.total_items > 0 && summary.total_customers > 0 && summary.total_suppliers > 0 && summary.total_products > 0 && summary.total_boms > 0 && summary.total_pos > 0 && summary.total_work_orders > 0 && summary.total_sales_orders > 0 && summary.total_quality_inspections > 0 && summary.receivable_balance !== "0.000000")) throw new Error(`full-domain dashboard facts are incomplete: ${JSON.stringify(summary)}`);
  if (!management.metrics.length || !management.risks.some((risk) => risk.code === "BACKGROUND_JOB_FAILED") || !management.recent_activity.length) throw new Error(`management mismatch: ${JSON.stringify(management)}`);
  if (backup.browser_create_enabled !== false || backup.browser_restore_enabled !== false || backup.restore_target !== "TASK_CREATED_DISPOSABLE_TEST_DATABASE_ONLY" || backup.verification_status !== expectedBackupStatus) throw new Error(`backup governance mismatch: ${JSON.stringify(backup)}`);
  for (const path of legacyRefreshGetPaths) await client.get(path);
  const retired = await client.post("/api/backups/create", {}, 409); if (retired.code !== "OFFLINE_OPERATION_REQUIRED") throw new Error("browser backup create was not retired to offline governance");
  console.info(JSON.stringify({ ok:true,phase,failed_jobs:summary.failed_jobs,backup:backup.verification_status,metrics:management.metrics.length,legacy_refresh_gets:legacyRefreshGetPaths.length }));
} finally { await pool.end(); }
