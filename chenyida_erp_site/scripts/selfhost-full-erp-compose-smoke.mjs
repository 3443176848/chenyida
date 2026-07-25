import assert from "node:assert/strict";
import { Pool } from "pg";

const phase = process.env.ERP_FULL_JOURNEY_PHASE || "initial";
const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";

if (process.env.ERP_ENV !== "test") throw new Error("full ERP Compose smoke requires ERP_ENV=test");

async function resetSyntheticRateWindow() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("rate-window reset requires an isolated test database");
  const pool = new Pool({ connectionString: databaseUrl, application_name: "full-erp-compose-rate-window" });
  try { await pool.query("delete from identity_write_rate_limit_buckets where username=$1", [process.env.ERP_ADMIN_USERNAME]); }
  finally { await pool.end(); }
}

async function requestAs(username, password, path, expectedStatus = 200) {
  const cookies = new Map();
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  for (const value of login.headers.getSetCookie()) {
    const [pair] = value.split(";"); const split = pair.indexOf("="); cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  if (login.status !== 200) throw new Error(`role login failed: ${login.status}`);
  const response = await fetch(`${base}${path}`, { headers: { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } });
  const payload = await response.json();
  if (response.status !== expectedStatus) throw new Error(`${username} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

if (phase === "initial") {
  await import("./selfhost-identity-compose-smoke.mjs?full-journey-initial");
  process.env.ERP_FULL_JOURNEY_REUSE_IDENTITY = "true";
  await resetSyntheticRateWindow();
  await import("./selfhost-master-data-compose-smoke.mjs?full-journey-initial");
  await resetSyntheticRateWindow();
  await import("./selfhost-inventory-compose-smoke.mjs?full-journey-initial");
  await resetSyntheticRateWindow();
  await import("./selfhost-procurement-compose-smoke.mjs?full-journey-initial");
  await resetSyntheticRateWindow();
  await import("./selfhost-production-compose-smoke.mjs?full-journey-initial");
  await resetSyntheticRateWindow();
  await import("./selfhost-sales-compose-smoke.mjs?full-journey-initial");
  await resetSyntheticRateWindow();
  await import("./selfhost-quality-compose-smoke.mjs?full-journey-initial");
  await resetSyntheticRateWindow();
  await import("./selfhost-finance-compose-smoke.mjs?full-journey-initial");
  await import("./selfhost-dashboard-compose-smoke.mjs?full-journey-initial");

  const qualitySummary = await requestAs(process.env.ERP_QUALITY_USERNAME || "quality08", process.env.ERP_QUALITY_PASSWORD || "Task08-Quality-Changed!567", "/api/summary");
  assert.deepEqual(Object.keys(qualitySummary.groups).sort(), ["inventory", "procurement", "production", "quality", "sales"]);
  const deniedManagement = await requestAs(process.env.ERP_QUALITY_USERNAME || "quality08", process.env.ERP_QUALITY_PASSWORD || "Task08-Quality-Changed!567", "/api/management-dashboard", 403);
  assert.equal(deniedManagement.code, "PERMISSION_DENIED");
  const deniedBackup = await requestAs(process.env.ERP_QUALITY_USERNAME || "quality08", process.env.ERP_QUALITY_PASSWORD || "Task08-Quality-Changed!567", "/api/backups", 403);
  assert.equal(deniedBackup.code, "PERMISSION_DENIED");
  console.info(JSON.stringify({ ok: true, phase, domains: Object.keys(qualitySummary.groups), role_projection: "quality" }));
} else if (phase === "restart") {
  process.env.ERP_FULL_JOURNEY_REUSE_IDENTITY = "true";
  process.env.ERP_DASHBOARD_SMOKE_PHASE = "restart";
  await import("./selfhost-dashboard-compose-smoke.mjs?full-journey-restart");
  const adminSummary = await requestAs(process.env.ERP_ADMIN_USERNAME || "", process.env.ERP_ADMIN_PASSWORD || "", "/api/summary");
  assert.ok(adminSummary.total_items > 0 && adminSummary.total_pos > 0 && adminSummary.total_work_orders > 0 && adminSummary.total_sales_orders > 0 && adminSummary.total_quality_inspections > 0);
  console.info(JSON.stringify({ ok: true, phase, migration: adminSummary.groups.operations.migrations[0]?.version, durable: true }));
} else {
  throw new Error(`unsupported ERP_FULL_JOURNEY_PHASE: ${phase}`);
}
