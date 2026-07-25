import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_INVENTORY_SMOKE_PHASE || "initial";
const setupToken = process.env.ERP_SETUP_TOKEN || "";
const adminUsername = process.env.ERP_ADMIN_USERNAME || "";
const adminPassword = process.env.ERP_ADMIN_PASSWORD || "";
const reuseIdentity = process.env.ERP_FULL_JOURNEY_REUSE_IDENTITY === "true";
if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("inventory compose smoke requires an isolated test database");
if (!setupToken || !adminUsername || !adminPassword) throw new Error("inventory compose smoke credentials are required");

function apiClient() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers); if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(";"); const separator = pair.indexOf("="); const name = pair.slice(0, separator); const content = pair.slice(separator + 1); if (/Max-Age=0/i.test(value)) cookies.delete(name); else cookies.set(name, content); }
    const payload = await response.json(); if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`); return { response, payload };
  }
  return {
    setup: () => request("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setup_token: setupToken, username: adminUsername, display_name: "TASK04 烟测管理员", password: adminPassword }) }, 201),
    login: async () => { const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: adminUsername, password: adminPassword }) }); csrf = result.payload.csrf_token; return result; },
    get: (path) => request(path),
    write: (path, body, expectedStatus = 201, key = randomUUID()) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, expectedStatus),
  };
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "inventory-compose-smoke" });
try {
  if (phase === "initial") {
    const api = apiClient(); if (!reuseIdentity) await api.setup(); await api.login();
    await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('T04_LEAF','TASK04 测试叶子',4,'ACTIVE',$1,$1,$2)", [adminUsername, randomUUID()]);
    const category = await pool.query("select id from material_categories where category_code='T04_LEAF'");
    await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('T04PCS','TASK04 件','T04PCS','COUNT',true)"); const unit = await pool.query("select id from units where code='T04PCS'");
    await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id)
      values('CYD-T04-000001','TASK04 烟测物料',$1,'T04PCS',$2,'ACTIVE','PURCHASE','STOCKED','IQC','ROHS','MANUAL',$3,$3,$3,$4)`, [category.rows[0].id, unit.rows[0].id, adminUsername, randomUUID()]);
    const material = await pool.query("select id,base_unit_id from material_master where internal_material_code='CYD-T04-000001'"); const materialId = Number(material.rows[0].id); const unitId = Number(material.rows[0].base_unit_id);
    await api.write("/api/inventory-adjustments", { operation_type: "RECEIPT", reason: "Compose 入库", lines: [{ material_id: materialId, unit_id: unitId, quantity: "10", expected_balance_version: 0 }] }, 201, "task04-compose-receipt");
    await api.write("/api/inventory-adjustments", { operation_type: "ISSUE", reason: "Compose 出库", lines: [{ material_id: materialId, unit_id: unitId, quantity: "2", expected_balance_version: 1 }] }, 201, "task04-compose-issue");
    await api.write("/api/inventory-adjustments", { operation_type: "FREEZE", reason: "Compose 冻结", lines: [{ material_id: materialId, unit_id: unitId, quantity: "3", expected_balance_version: 2 }] }, 201, "task04-compose-freeze");
    await api.write("/api/inventory-adjustments", { operation_type: "UNFREEZE", reason: "Compose 解冻", lines: [{ material_id: materialId, unit_id: unitId, quantity: "1", expected_balance_version: 3 }] }, 201, "task04-compose-unfreeze");
    const inventory = await api.get("/api/inventory"); const row = inventory.payload.rows.find((item) => Number(item.material_id) === materialId);
    if (row?.on_hand_qty !== "8.000000" || row?.frozen_qty !== "2.000000" || row?.available_qty !== "6.000000" || Number(row?.balance_version) !== 4) throw new Error(`inventory projection mismatch: ${JSON.stringify(row)}`);
    const reconciliation = await api.get("/api/inventory/reconciliation"); if (!reconciliation.payload.consistent) throw new Error("inventory ledger reconciliation failed");
    console.info(JSON.stringify({ ok: true, phase, material_id: materialId, on_hand_qty: row.on_hand_qty, frozen_qty: row.frozen_qty, balance_version: row.balance_version }));
  } else if (phase === "restart") {
    const api = apiClient(); await api.login(); const inventory = await api.get("/api/inventory"); const row = inventory.payload.rows.find((item) => item.internal_material_code === "CYD-T04-000001");
    const reconciliation = await api.get("/api/inventory/reconciliation"); const counts = await pool.query("select (select count(*)::int from inventory_adjustments) adjustments,(select count(*)::int from inventory_ledger_entries) ledger,(select count(*)::int from audit_log where route_code='INVENTORY' and result='success') audits");
    if (row?.on_hand_qty !== "8.000000" || row?.frozen_qty !== "2.000000" || Number(row?.balance_version) !== 4 || !reconciliation.payload.consistent || counts.rows[0].adjustments !== 4 || counts.rows[0].ledger !== 4 || counts.rows[0].audits !== 4) throw new Error(`inventory state was not durable after restart: ${JSON.stringify({ row, counts: counts.rows[0] })}`);
    console.info(JSON.stringify({ ok: true, phase, material_id: row.material_id, ...counts.rows[0] }));
  } else throw new Error(`unsupported ERP_INVENTORY_SMOKE_PHASE: ${phase}`);
} finally { await pool.end(); }
