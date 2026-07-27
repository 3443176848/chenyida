import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleProcurementApi } from "../app/lib/procurement-selfhost/handler.ts";
import { ProcurementRepository } from "../app/lib/procurement-selfhost/repository.ts";
import { ProcurementService } from "../app/lib/procurement-selfhost/service.ts";

const databaseUrl = process.env.TEST_PROCUREMENT_DATABASE_URL;
if (!databaseUrl || !/procurement_test/i.test(databaseUrl)) throw new Error("isolated TEST_PROCUREMENT_DATABASE_URL containing procurement_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 16, application_name: "procurement-integration-test" });
const actor = (role, username = `${role}01`) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });

async function api(path, { method = "GET", role = "admin", username, body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers({ "X-Request-ID": randomUUID() }); if (body !== undefined) headers.set("Content-Type", "application/json"); if (key) headers.set("Idempotency-Key", key); if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await handleProcurementApi(request, { pool, actor: actor(role, username), requestId: headers.get("X-Request-ID"), requireCsrf: () => { if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 }); } });
  assert.ok(result); return { response: result, payload: await result.json() };
}

async function seed() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','admin','admin','test-only'),('manager01','manager','manager','test-only'),('purchase01','purchase','purchase','test-only'),('warehouse01','warehouse','warehouse','test-only'),
    ('engineering01','engineering','engineering','test-only'),('finance01','finance','finance','test-only'),('sales01','sales','sales','test-only'),('rate-purchase','rate','purchase','test-only')`);
  await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('PROC_LEAF','采购测试',4,'ACTIVE','test','test',$1)", [randomUUID()]); const category = await pool.query("select id from material_categories where category_code='PROC_LEAF'");
  await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true),('BOX','箱','BOX','COUNT',true)"); const unit = await pool.query("select id,code from units order by code"); const pcs = unit.rows.find((row) => row.code === "PCS"); const box = unit.rows.find((row) => row.code === "BOX");
  await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values
    ('CYD-PROC-000001','采购物料一',$1,'PCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL','test','test','test',$3),
    ('CYD-PROC-000002','采购物料二',$1,'PCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL','test','test','test',$4),
    (null,'未启用物料',$1,'PCS',$2,'DRAFT','PURCHASE','STOCKED','NONE','ROHS','MANUAL','test','test','test',$5)`, [category.rows[0].id, pcs.id, randomUUID(), randomUUID(), randomUUID()]);
  await pool.query(`insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values
    ('SUP-000001','启用供应商','启用供应商','ACTIVE','test','test',$1),('SUP-000002','停用供应商','停用供应商','INACTIVE','test','test',$2)`, [randomUUID(), randomUUID()]);
  const supplier = await pool.query("select id,status from suppliers order by id"); const materials = await pool.query("select id,base_unit_id,material_status from material_master order by id");
  const mappings = [];
  for (let index = 0; index < 2; index += 1) { const result = await pool.query(`insert into supplier_mappings(material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id)
      values($1,$2,'启用供应商','SUP-000001',$3,'PCS',$4,1,1,'ACTIVE',now()-interval '1 day','test','test',$5) returning id`, [materials.rows[index].id, supplier.rows[0].id, `S-${index + 1}`, pcs.id, randomUUID()]); mappings.push(result.rows[0]);
    await pool.query(`insert into supplier_mapping_price_history(supplier_mapping_id,price,currency_code,price_uom,effective_from,created_by,request_id) values($1,$2,'CNY','PCS',now()-interval '1 day','test',$3)`, [result.rows[0].id, String(index + 1), randomUUID()]); }
  return { supplierId: Number(supplier.rows[0].id), inactiveSupplierId: Number(supplier.rows[1].id), one: materials.rows[0], two: materials.rows[1], draft: materials.rows[2], pcs, box, mappingOne: mappings[0], mappingTwo: mappings[1] };
}

function orderBody(refs, lines = [{ material_id: Number(refs.one.id), unit_id: Number(refs.pcs.id), supplier_mapping_id: Number(refs.mappingOne.id), order_qty: "10", unit_price: "2.500000" }]) { return { supplier_id: refs.supplierId, currency_code: "CNY", expected_at: "2026-08-01T00:00:00Z", remark: "测试采购", lines }; }

test.beforeEach(async () => {
  await pool.query(`truncate purchase_financial_source_entries,purchase_receipt_lines,purchase_receipts,purchase_order_status_events,purchase_order_source_links,purchase_order_lines,purchase_orders,
    inventory_adjustment_lines,inventory_ledger_entries,inventory_stock_balances,inventory_adjustments,bom_lines,bom_versions,bom_headers,product_versions,products,customers,
    supplier_mapping_price_history,supplier_mappings,suppliers,business_code_sequences,identity_write_rate_limit_buckets,idempotency_keys,audit_log,app_users,material_master,units,material_categories restart identity cascade`);
});
test.after(async () => pool.end());

test("PO idempotency update receipt reversal close and financial source stay consistent", async () => {
  const refs = await seed(); const body = orderBody(refs);
  const created = await api("/api/purchase-orders", { method: "POST", role: "purchase", key: "procurement-order-0001", body }); assert.equal(created.response.status, 201); assert.match(created.payload.data.po_code, /^PO-\d{8}$/); const poId = Number(created.payload.data.id); const lineId = Number(created.payload.data.lines[0].id);
  const replay = await api("/api/purchase-orders", { method: "POST", role: "purchase", key: "procurement-order-0001", body }); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const conflict = await api("/api/purchase-orders", { method: "POST", role: "purchase", key: "procurement-order-0001", body: { ...body, remark: "不同正文" } }); assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");
  const updated = await api(`/api/purchase-orders/${poId}`, { method: "PATCH", role: "purchase", body: { expected_version: 1, expected_at: "2026-08-02T00:00:00Z", remark: "更新交期" } }); assert.equal(updated.response.status, 200); assert.equal(updated.payload.data.version, 2);
  const firstReceipt = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", key: "procurement-receipt-0001", body: { purchase_order_id: poId, reason: "首批到货", lines: [{ purchase_order_line_id: lineId, quantity: "4", expected_line_version: 1, expected_balance_version: 0 }] } }); assert.equal(firstReceipt.response.status, 201); assert.match(firstReceipt.payload.receipt_code, /^PR-\d{8}$/);
  const replayReceipt = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", key: "procurement-receipt-0001", body: { purchase_order_id: poId, reason: "首批到货", lines: [{ purchase_order_line_id: lineId, quantity: "4", expected_line_version: 1, expected_balance_version: 0 }] } }); assert.equal(replayReceipt.response.headers.get("Idempotency-Replayed"), "true");
  const secondReceipt = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", body: { purchase_order_id: poId, reason: "剩余到货", lines: [{ purchase_order_line_id: lineId, quantity: "6", expected_line_version: 2, expected_balance_version: 1 }] } }); assert.equal(secondReceipt.response.status, 201);
  let detail = await api(`/api/purchase-orders/${poId}`, { role: "engineering" }); assert.equal(detail.payload.data.header.po_status, "RECEIVED"); assert.equal(detail.payload.data.lines[0].received_qty, "10.000000");
  const reversed = await api(`/api/purchase-receipts/${secondReceipt.payload.receipt_id}/reversal`, { method: "POST", role: "warehouse", body: { reason: "第二批录入错误", expected_line_versions: [{ purchase_order_line_id: lineId, expected_line_version: 3 }], expected_balance_versions: [{ material_id: Number(refs.one.id), expected_balance_version: 2 }] } }); assert.equal(reversed.response.status, 201); assert.equal(reversed.payload.reversal_of_receipt_id, secondReceipt.payload.receipt_id);
  const repeated = await api(`/api/purchase-receipts/${secondReceipt.payload.receipt_id}/reversal`, { method: "POST", role: "warehouse", body: { reason: "重复冲销", expected_line_versions: [{ purchase_order_line_id: lineId, expected_line_version: 4 }], expected_balance_versions: [{ material_id: Number(refs.one.id), expected_balance_version: 3 }] } }); assert.equal(repeated.response.status, 409); assert.equal(repeated.payload.code, "PURCHASE_RECEIPT_ALREADY_REVERSED");
  const finalReceipt = await api("/api/purchase-receipts", { method: "POST", role: "purchase", body: { purchase_order_id: poId, reason: "重新到货", lines: [{ purchase_order_line_id: lineId, quantity: "6", expected_line_version: 4, expected_balance_version: 3 }] } }); assert.equal(finalReceipt.response.status, 201);
  const closed = await api(`/api/purchase-orders/${poId}/close`, { method: "POST", role: "manager", body: { expected_version: 6, reason: "完成采购" } }); assert.equal(closed.response.status, 200); assert.equal(closed.payload.data.status, "CLOSED");
  const closedReversal = await api(`/api/purchase-receipts/${finalReceipt.payload.receipt_id}/reversal`, { method: "POST", role: "warehouse", body: { reason: "关闭后冲销", expected_line_versions: [{ purchase_order_line_id: lineId, expected_line_version: 5 }], expected_balance_versions: [{ material_id: Number(refs.one.id), expected_balance_version: 4 }] } }); assert.equal(closedReversal.response.status, 409); assert.equal(closedReversal.payload.code, "PURCHASE_ORDER_CLOSED");
  const balance = await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1", [refs.one.id]); assert.deepEqual(balance.rows[0], { on_hand_qty: "10.000000", version: 4 });
  const finance = await pool.query("select entry_type,amount::text from purchase_financial_source_entries order by id"); assert.deepEqual(finance.rows.map((row) => [row.entry_type, row.amount]), [["RECEIPT", "10.000000"], ["RECEIPT", "15.000000"], ["RECEIPT_REVERSAL", "-15.000000"], ["RECEIPT", "15.000000"]]);
  assert.equal(Number((await pool.query("select count(*) count from erp_records where kind in ('purchase_order','financial_document','financial_payment')")).rows[0].count), 0);
  await assert.rejects(pool.query("update purchase_receipts set reason='tamper'"), /posted inventory records are immutable|posting requires service/); await assert.rejects(pool.query("update purchase_receipt_lines set quantity=1"), /posted inventory records are immutable|posting requires service/);
});

test("reference, permission, CSRF, over-receipt, concurrent receipt and atomic rollback fail closed", async () => {
  const refs = await seed();
  assert.equal((await api("/api/purchase-orders", { method: "POST", role: "engineering", body: orderBody(refs) })).response.status, 403);
  assert.equal((await api("/api/purchase-orders", { method: "POST", role: "purchase", csrf: false, body: orderBody(refs) })).response.status, 403);
  const inactiveSupplier = await api("/api/purchase-orders", { method: "POST", role: "purchase", body: { ...orderBody(refs), supplier_id: refs.inactiveSupplierId } }); assert.equal(inactiveSupplier.response.status, 422); assert.equal(inactiveSupplier.payload.code, "SUPPLIER_NOT_ACTIVE");
  const wrongUnit = await api("/api/purchase-orders", { method: "POST", role: "purchase", body: orderBody(refs, [{ material_id: Number(refs.one.id), unit_id: Number(refs.box.id), supplier_mapping_id: Number(refs.mappingOne.id), order_qty: "1", unit_price: "1" }]) }); assert.equal(wrongUnit.response.status, 422); assert.equal(wrongUnit.payload.code, "PURCHASE_REFERENCE_NOT_ACTIVE");
  const created = await api("/api/purchase-orders", { method: "POST", role: "purchase", body: orderBody(refs) }); const poId = Number(created.payload.data.id); const lineId = Number(created.payload.data.lines[0].id);
  await pool.query("update suppliers set status='INACTIVE' where id=$1", [refs.supplierId]);
  const inactiveAtReceipt = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", body: { purchase_order_id: poId, lines: [{ purchase_order_line_id: lineId, quantity: "1", expected_line_version: 1, expected_balance_version: 0 }] } }); assert.equal(inactiveAtReceipt.response.status, 422); assert.equal(inactiveAtReceipt.payload.code, "SUPPLIER_NOT_ACTIVE");
  await pool.query("update suppliers set status='ACTIVE' where id=$1", [refs.supplierId]);
  const excessive = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", body: { purchase_order_id: poId, lines: [{ purchase_order_line_id: lineId, quantity: "11", expected_line_version: 1, expected_balance_version: 0 }] } }); assert.equal(excessive.response.status, 409); assert.equal(excessive.payload.code, "PURCHASE_RECEIPT_OVER_QUANTITY");
  const concurrent = await Promise.all(["A", "B"].map((suffix) => api("/api/purchase-receipts", { method: "POST", role: "warehouse", key: `concurrent-receipt-${suffix}`, body: { purchase_order_id: poId, reason: suffix, lines: [{ purchase_order_line_id: lineId, quantity: "7", expected_line_version: 1, expected_balance_version: 0 }] } }))); assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [201, 409]);
  const projection = await pool.query("select received_qty,version from purchase_order_lines where id=$1", [lineId]); assert.deepEqual(projection.rows[0], { received_qty: "7.000000", version: 2 });
  await pool.query(`create or replace function fail_procurement_audit_for_test() returns trigger language plpgsql as $$ begin if new.action='PURCHASE_RECEIPT_POSTED' then raise exception 'forced procurement audit failure'; end if; return new; end $$`); await pool.query("create trigger fail_procurement_audit_for_test before insert on audit_log for each row execute function fail_procurement_audit_for_test()");
  const failed = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", key: "rollback-procurement-key", body: { purchase_order_id: poId, reason: "整体回滚", lines: [{ purchase_order_line_id: lineId, quantity: "1", expected_line_version: 2, expected_balance_version: 1 }] } }); assert.equal(failed.response.status, 500);
  assert.equal(Number((await pool.query("select count(*) count from purchase_receipts where reason='整体回滚'")).rows[0].count), 0); assert.deepEqual((await pool.query("select received_qty,version from purchase_order_lines where id=$1", [lineId])).rows[0], { received_qty: "7.000000", version: 2 }); assert.deepEqual((await pool.query("select on_hand_qty,version from inventory_stock_balances where material_id=$1", [refs.one.id])).rows[0], { on_hand_qty: "7.000000", version: 1 });
  await pool.query("drop trigger fail_procurement_audit_for_test on audit_log; drop function fail_procurement_audit_for_test()");
});

test("multi-line receipt is atomic and concurrent PO codes remain unique", async () => {
  const refs = await seed(); const twoLines = [{ material_id: Number(refs.one.id), unit_id: Number(refs.pcs.id), supplier_mapping_id: Number(refs.mappingOne.id), order_qty: "5", unit_price: "1" }, { material_id: Number(refs.two.id), unit_id: Number(refs.pcs.id), supplier_mapping_id: Number(refs.mappingTwo.id), order_qty: "3", unit_price: "2" }];
  const orders = await Promise.all(Array.from({ length: 8 }, (_, index) => api("/api/purchase-orders", { method: "POST", role: "purchase", key: `parallel-po-${index}`, body: orderBody(refs, twoLines.map((line) => ({ ...line, remark: String(index) }))) }))); assert.ok(orders.every((item) => item.response.status === 201)); assert.equal(new Set(orders.map((item) => item.payload.data.po_code)).size, 8);
  const selected = orders[0].payload.data; const receipt = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", body: { purchase_order_id: Number(selected.id), reason: "多行收货", lines: selected.lines.map((line) => ({ purchase_order_line_id: Number(line.id), quantity: line.order_qty, expected_line_version: 1, expected_balance_version: 0 })) } }); assert.equal(receipt.response.status, 201); assert.equal(receipt.payload.data.lines.length, 2);
  const balances = await pool.query("select material_id,on_hand_qty,version from inventory_stock_balances order by material_id"); assert.deepEqual(balances.rows.map((row) => row.on_hand_qty), ["5.000000", "3.000000"]); assert.ok(balances.rows.every((row) => row.version === 1));
  const reconciliation = await pool.query(`select count(*)::int mismatches from inventory_stock_balances b left join (select balance_id,sum(on_hand_delta) qty from inventory_ledger_entries group by balance_id) l on l.balance_id=b.id where b.on_hand_qty<>coalesce(l.qty,0)`); assert.equal(reconciliation.rows[0].mismatches, 0);
});

test("maximum numeric(24,6) quantity and price produce an exact non-floating financial source", async () => {
  const refs = await seed(); const maximum = "999999999999999999.999999";
  const created = await api("/api/purchase-orders", { method: "POST", role: "purchase", body: orderBody(refs, [{ material_id: Number(refs.one.id), unit_id: Number(refs.pcs.id), supplier_mapping_id: Number(refs.mappingOne.id), order_qty: maximum, unit_price: maximum }]) }); assert.equal(created.response.status, 201);
  const receipt = await api("/api/purchase-receipts", { method: "POST", role: "warehouse", body: { purchase_order_id: Number(created.payload.data.id), lines: [{ purchase_order_line_id: Number(created.payload.data.lines[0].id), quantity: maximum, expected_line_version: 1, expected_balance_version: 0 }] } }); assert.equal(receipt.response.status, 201);
  const amount = "999999999999999999999998000000000000.000000"; assert.equal(receipt.payload.data.lines[0].line_amount, amount); assert.equal(receipt.payload.data.financial_source.amount, amount);
});

test("released BOM shortage remains advisory until explicit grouped PO creation", async () => {
  const refs = await seed();
  const product = await pool.query("insert into products(product_code,product_name,created_by,updated_by,request_id) values('PRD-PROC','采购测试产品','test','test',$1) returning id", [randomUUID()]);
  const productVersion = await pool.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,created_by,updated_by,request_id,released_by,released_at) values($1,1,'A0','RELEASED','PCB','MASS','test','test',$2,'test',now()) returning id", [product.rows[0].id, randomUUID()]);
  const bom = await pool.query("insert into bom_headers(bom_code,product_id,created_by,updated_by,request_id) values('BOM-PROC',$1,'test','test',$2) returning id", [product.rows[0].id, randomUUID()]);
  const bomVersion = await pool.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,created_by,updated_by,request_id) values($1,$2,1,'A0','DRAFT','test','test',$3) returning id", [bom.rows[0].id, productVersion.rows[0].id, randomUUID()]);
  await pool.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,created_by,updated_by,request_id) values($1,1,$2,2,$3,0.1,'test','test',$4)", [bomVersion.rows[0].id, refs.one.id, refs.pcs.id, randomUUID()]);
  await pool.query("update bom_versions set status='RELEASED',released_by='test',released_at=now() where id=$1", [bomVersion.rows[0].id]);
  const suggested = await api(`/api/purchase-suggestions?bom_id=${bom.rows[0].id}&order_qty=2&currency_code=CNY`, { role: "purchase" }); assert.equal(suggested.response.status, 200); assert.equal(suggested.payload.rows[0].shortage_qty, "4.400000"); assert.equal(suggested.payload.rows[0].readiness_status, "READY"); assert.equal(Number((await pool.query("select count(*) count from purchase_orders")).rows[0].count), 0);
  await pool.query("update material_master set material_status='INACTIVE' where id=$1", [refs.one.id]);
  const blocked = await api(`/api/purchase-suggestions?bom_id=${bom.rows[0].id}&order_qty=2&currency_code=CNY`, { role: "purchase" }); assert.equal(blocked.payload.rows[0].readiness_status, "BLOCKED"); assert.equal(blocked.payload.rows[0].blocking_reason, "MATERIAL_NOT_ACTIVE");
  const blockedCreate = await api("/api/purchase-orders/from-shortage", { method: "POST", role: "purchase", body: { bom_id: Number(bom.rows[0].id), order_qty: "2", currency_code: "CNY" } }); assert.equal(blockedCreate.response.status, 422); assert.equal(blockedCreate.payload.code, "PURCHASE_SUGGESTION_BLOCKED");
  await pool.query("update material_master set material_status='ACTIVE' where id=$1", [refs.one.id]);
  const generated = await api("/api/purchase-orders/from-shortage", { method: "POST", role: "purchase", body: { bom_id: Number(bom.rows[0].id), order_qty: "2", currency_code: "CNY" } }); assert.equal(generated.response.status, 201); assert.equal(generated.payload.created.length, 1); assert.equal(generated.payload.created[0].lines[0].order_qty, "4.400000");
  assert.equal(Number((await pool.query("select count(*) count from purchase_order_source_links where source_type='BOM_SHORTAGE' and bom_version_id=$1", [bomVersion.rows[0].id])).rows[0].count), 1);
});

test("inventory transaction reuse rolls back receipt, ledger, balance, finance, audit and idempotency together", async () => {
  const refs = await seed(); const created = await api("/api/purchase-orders", { method: "POST", role: "purchase", body: orderBody(refs) }); const poId = Number(created.payload.data.id); const lineId = Number(created.payload.data.lines[0].id);
  const service = new ProcurementService(new ProcurementRepository(pool), undefined, (checkpoint) => { if (checkpoint === "after_inventory") throw new Error("forced cross-domain rollback"); });
  const meta = { actor: actor("warehouse"), requestId: randomUUID(), operationId: randomUUID(), keyDigest: "f".repeat(64), requestDigest: "e".repeat(64), method: "POST", route: "/api/purchase-receipts", action: "PURCHASE_RECEIPT_POSTED" };
  await assert.rejects(service.createReceipt(meta, { purchase_order_id: poId, reason: "故障注入", lines: [{ purchase_order_line_id: lineId, quantity: "2", expected_line_version: 1, expected_balance_version: 0 }] }), /服务器暂时无法处理采购请求/);
  assert.equal(Number((await pool.query("select count(*) count from purchase_receipts")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from inventory_ledger_entries")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from inventory_stock_balances")).rows[0].count), 0); assert.equal(Number((await pool.query("select count(*) count from purchase_financial_source_entries")).rows[0].count), 0); assert.deepEqual((await pool.query("select received_qty,version from purchase_order_lines where id=$1", [lineId])).rows[0], { received_qty: "0.000000", version: 1 }); assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [meta.keyDigest])).rows[0].count), 0);
});

test("procurement write-rate limiter allows idempotent replay but rejects the twenty-first new key", async () => {
  const refs = await seed(); const firstBody = orderBody(refs);
  for (let index = 1; index <= 20; index += 1) { const result = await api("/api/purchase-orders", { method: "POST", role: "purchase", username: "rate-purchase", key: `proc-rate-${String(index).padStart(4, "0")}`, body: { ...firstBody, remark: `限流${index}` } }); assert.equal(result.response.status, 201); }
  const replay = await api("/api/purchase-orders", { method: "POST", role: "purchase", username: "rate-purchase", key: "proc-rate-0001", body: { ...firstBody, remark: "限流1" } }); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const limited = await api("/api/purchase-orders", { method: "POST", role: "purchase", username: "rate-purchase", key: "proc-rate-0021", body: { ...firstBody, remark: "限流21" } }); assert.equal(limited.response.status, 429); assert.equal(limited.payload.code, "RATE_LIMITED");
});
