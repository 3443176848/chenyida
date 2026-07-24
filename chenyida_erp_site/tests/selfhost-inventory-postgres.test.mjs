import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleInventoryApi } from "../app/lib/inventory-selfhost/handler.ts";

const databaseUrl = process.env.TEST_INVENTORY_DATABASE_URL;
if (!databaseUrl || !/inventory_test/i.test(databaseUrl)) throw new Error("isolated TEST_INVENTORY_DATABASE_URL containing inventory_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "inventory-integration-test" });
const actor = (role, username = `${role}01`) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });

async function api(path, { method = "GET", role = "admin", username, body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers({ "X-Request-ID": randomUUID() });
  if (body !== undefined) headers.set("Content-Type", "application/json"); if (key) headers.set("Idempotency-Key", key); if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleInventoryApi(request, { pool, actor: actor(role, username), requestId: headers.get("X-Request-ID"), requireCsrf: () => { if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 }); } });
  assert.ok(response); return { response, payload: await response.json() };
}

async function seed() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','admin','admin','test-only'),('warehouse01','warehouse','warehouse','test-only'),('purchase01','purchase','purchase','test-only')`);
  await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('INV_LEAF','库存测试',4,'ACTIVE','test','test',$1)", [randomUUID()]);
  const category = await pool.query("select id from material_categories where category_code='INV_LEAF'");
  await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true),('BOX','箱','BOX','COUNT',true)");
  const units = await pool.query("select id,code from units order by code"); const pcs = units.rows.find((row) => row.code === "PCS");
  await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values
    ('CYD-INV-000001','库存物料一',$1,'PCS',$2,'ACTIVE','PURCHASE','STOCKED','IQC','ROHS','MANUAL','test','test','test',$3),
    ('CYD-INV-000002','库存物料二',$1,'PCS',$2,'ACTIVE','PURCHASE','STOCKED','IQC','ROHS','MANUAL','test','test','test',$4)`, [category.rows[0].id, pcs.id, randomUUID(), randomUUID()]);
  const materials = await pool.query("select id,internal_material_code,base_unit_id from material_master order by id");
  return { one: materials.rows[0], two: materials.rows[1], box: units.rows.find((row) => row.code === "BOX") };
}

test.beforeEach(async () => {
  await pool.query("truncate inventory_adjustment_lines,inventory_ledger_entries,inventory_stock_balances,inventory_adjustments,business_code_sequences,identity_write_rate_limit_buckets,idempotency_keys,audit_log,app_users,material_master,units,material_categories restart identity cascade");
});
test.after(async () => pool.end());

test("receipt issue freeze unfreeze adjustment reversal stay immutable and reconcile", async () => {
  const { one } = await seed(); const materialId = Number(one.id); const unitId = Number(one.base_unit_id);
  const receiptBody = { operation_type: "RECEIPT", reason: "期初测试入库", lines: [{ material_id: materialId, unit_id: unitId, quantity: "10.000001", expected_balance_version: 0 }] };
  const receipt = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", key: "inventory-receipt-0001", body: receiptBody });
  assert.equal(receipt.response.status, 201); assert.match(receipt.payload.adjustment_code, /^IA-\d{8}$/);
  const replay = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", key: "inventory-receipt-0001", body: receiptBody });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const conflict = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", key: "inventory-receipt-0001", body: { ...receiptBody, reason: "不同正文" } });
  assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const issue = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "ISSUE", reason: "通用出库测试", lines: [{ material_id: materialId, unit_id: unitId, quantity: "2.000001", expected_balance_version: 1 }] } });
  assert.equal(issue.response.status, 201);
  const freeze = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "FREEZE", reason: "待检冻结", lines: [{ material_id: materialId, unit_id: unitId, quantity: "3", expected_balance_version: 2 }] } });
  assert.equal(freeze.response.status, 201);
  const unfreeze = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "UNFREEZE", reason: "检验放行", lines: [{ material_id: materialId, unit_id: unitId, quantity: "1", expected_balance_version: 3 }] } });
  assert.equal(unfreeze.response.status, 201);
  const adjustment = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "ADJUSTMENT", reason: "盘点差异", lines: [{ material_id: materialId, unit_id: unitId, counted_qty: "12", expected_balance_version: 4 }] } });
  assert.equal(adjustment.response.status, 201); assert.equal(adjustment.payload.data.lines[0].on_hand_delta, "4.000000");
  const reversal = await api(`/api/inventory-adjustments/${adjustment.payload.adjustment_id}/reversal`, { method: "POST", role: "warehouse", body: { reason: "盘点录入错误", expected_balance_versions: [{ material_id: materialId, expected_balance_version: 5 }] } });
  assert.equal(reversal.response.status, 201); assert.equal(reversal.payload.reversal_of_adjustment_id, adjustment.payload.adjustment_id);
  const secondReversal = await api(`/api/inventory-adjustments/${adjustment.payload.adjustment_id}/reversal`, { method: "POST", role: "warehouse", body: { reason: "重复冲销", expected_balance_versions: [{ material_id: materialId, expected_balance_version: 6 }] } });
  assert.equal(secondReversal.response.status, 409); assert.equal(secondReversal.payload.code, "INVENTORY_ALREADY_REVERSED");

  const balance = await api("/api/inventory", { role: "purchase" });
  assert.equal(balance.payload.rows[0].on_hand_qty, "8.000000"); assert.equal(balance.payload.rows[0].frozen_qty, "2.000000"); assert.equal(balance.payload.rows[0].available_qty, "6.000000"); assert.equal(balance.payload.rows[0].balance_version, 6);
  const reconciliation = await api("/api/inventory/reconciliation", { role: "warehouse" }); assert.equal(reconciliation.payload.consistent, true);
  assert.equal(Number((await pool.query("select count(*) count from inventory_ledger_entries")).rows[0].count), 6);
  await assert.rejects(pool.query("update inventory_stock_balances set on_hand_qty=99"), /inventory balance writes require inventory service transaction/);
  await assert.rejects(pool.query("update inventory_ledger_entries set on_hand_delta=1"), /posted inventory records are immutable/);
  await assert.rejects(pool.query("delete from inventory_adjustments where id=$1", [receipt.payload.adjustment_id]), /posted inventory records are immutable/);
});

test("permissions CSRF units stale versions negative inventory and concurrency fail closed", async () => {
  const { one, box } = await seed(); const materialId = Number(one.id); const unitId = Number(one.base_unit_id);
  const baseBody = { operation_type: "RECEIPT", reason: "测试", lines: [{ material_id: materialId, unit_id: unitId, quantity: "5", expected_balance_version: 0 }] };
  assert.equal((await api("/api/inventory-adjustments", { method: "POST", role: "purchase", body: baseBody })).response.status, 403);
  assert.equal((await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", csrf: false, body: baseBody })).response.status, 403);
  const wrongUnit = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { ...baseBody, lines: [{ ...baseBody.lines[0], unit_id: Number(box.id) }] } });
  assert.equal(wrongUnit.response.status, 422); assert.equal(wrongUnit.payload.code, "INVENTORY_UNIT_MISMATCH");
  assert.equal((await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: baseBody })).response.status, 201);
  const excessive = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "ISSUE", reason: "超额", lines: [{ material_id: materialId, unit_id: unitId, quantity: "6", expected_balance_version: 1 }] } });
  assert.equal(excessive.response.status, 409); assert.equal(excessive.payload.code, "INVENTORY_INSUFFICIENT_AVAILABLE");
  const stale = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "ISSUE", reason: "旧版本", lines: [{ material_id: materialId, unit_id: unitId, quantity: "1", expected_balance_version: 0 }] } });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.code, "INVENTORY_VERSION_CONFLICT");
  const concurrent = await Promise.all(["A", "B"].map((suffix) => api("/api/inventory-adjustments", { method: "POST", role: "warehouse", key: `concurrent-issue-${suffix}`, body: { operation_type: "ISSUE", reason: `并发${suffix}`, lines: [{ material_id: materialId, unit_id: unitId, quantity: "4", expected_balance_version: 1 }] } })));
  assert.deepEqual(concurrent.map((result) => result.response.status).sort(), [201, 409]);
  const final = await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1", [materialId]); assert.equal(final.rows[0].on_hand_qty, "1.000000"); assert.equal(final.rows[0].version, 2);
});

test("multi-line posting uses stable locks and audit failure rolls back every inventory record", async () => {
  const { one, two } = await seed(); const lines = [one, two].map((row) => ({ material_id: Number(row.id), unit_id: Number(row.base_unit_id), quantity: "2", expected_balance_version: 0 })).reverse();
  const multi = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", body: { operation_type: "RECEIPT", reason: "多物料入库", lines } });
  assert.equal(multi.response.status, 201); assert.equal(multi.payload.data.lines.length, 2);
  await pool.query(`create or replace function fail_inventory_audit_for_test() returns trigger language plpgsql as $$ begin if new.action='INVENTORY_ADJUSTMENT_POSTED' then raise exception 'forced inventory audit failure'; end if; return new; end $$`);
  await pool.query("create trigger fail_inventory_audit_for_test before insert on audit_log for each row execute function fail_inventory_audit_for_test()");
  const failed = await api("/api/inventory-adjustments", { method: "POST", role: "warehouse", key: "rollback-inventory-key", body: { operation_type: "RECEIPT", reason: "必须整体回滚", lines: [{ material_id: Number(one.id), unit_id: Number(one.base_unit_id), quantity: "1", expected_balance_version: 1 }] } });
  assert.equal(failed.response.status, 500);
  const after = await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1", [one.id]); assert.equal(after.rows[0].on_hand_qty, "2.000000"); assert.equal(after.rows[0].version, 1);
  assert.equal(Number((await pool.query("select count(*) count from inventory_adjustments where reason='必须整体回滚'")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where path='/api/inventory-adjustments' and response::text like '%必须整体回滚%'")).rows[0].count), 0);
  await pool.query("drop trigger fail_inventory_audit_for_test on audit_log; drop function fail_inventory_audit_for_test()");
});
