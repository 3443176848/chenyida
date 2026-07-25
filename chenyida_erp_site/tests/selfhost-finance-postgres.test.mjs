import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleFinanceApi } from "../app/lib/finance-selfhost/handler.ts";
import { FinanceRepository } from "../app/lib/finance-selfhost/repository.ts";
import { FinanceService } from "../app/lib/finance-selfhost/service.ts";

const databaseUrl = process.env.TEST_FINANCE_DATABASE_URL;
if (!databaseUrl || !/finance_test/i.test(databaseUrl)) throw new Error("isolated TEST_FINANCE_DATABASE_URL containing finance_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 16, application_name: "finance-integration-test" });
const actor = (role, username = `${role}01`) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });

async function api(path, { method = "GET", role = "finance", username, body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers({ "X-Request-ID": randomUUID() });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await handleFinanceApi(request, { pool, actor: actor(role, username), requestId: headers.get("X-Request-ID"), requireCsrf: () => { if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 }); } });
  assert.ok(result);
  return { response: result, payload: await result.json() };
}

const meta = (marker, action = "FINANCE_DOCUMENT_POSTED") => ({ actor: actor("finance"), requestId: randomUUID(), operationId: randomUUID(), keyDigest: Buffer.from(`finance-${marker}`).toString("hex").padEnd(64, "0").slice(0, 64), requestDigest: Buffer.from(`body-${marker}`).toString("hex").padEnd(64, "0").slice(0, 64), method: "POST", route: "/test", action });

async function seedSources() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','admin','admin','test-only'),('manager01','manager','manager','test-only'),('finance01','finance','finance','test-only'),
    ('sales01','sales','sales','test-only'),('purchase01','purchase','purchase','test-only'),('warehouse01','warehouse','warehouse','test-only'),('engineering01','engineering','engineering','test-only')`);
  const customer = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-FIN','财务客户','财务客户','ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const supplier = await pool.query("insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-FIN','财务供应商','财务供应商','ACTIVE','admin01','admin01',$1) returning id", [randomUUID()]);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.inventory_service_write','allowed',true),set_config('cyd.sales_service_write','allowed',true),set_config('cyd.procurement_service_write','allowed',true)");
    const salesAdjustment = await client.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values('ADJ-FIN-S','ISSUE','财务销售来源',$1,'admin01',$2) returning id", [randomUUID(), randomUUID()]);
    const purchaseAdjustment = await client.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values('ADJ-FIN-P','RECEIPT','财务采购来源',$1,'admin01',$2) returning id", [randomUUID(), randomUUID()]);
    const order = await client.query("insert into sales_orders(sales_order_code,customer_id,ordered_qty,shipped_qty,status,operation_id,created_by,request_id) values('SO-FIN',$1,10,10,'SHIPPED',$2,'admin01',$3) returning id", [customer.rows[0].id, randomUUID(), randomUUID()]);
    const shipment = await client.query("insert into sales_shipments(shipment_code,sales_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('SH-FIN',$1,$2,'财务测试发货',$3,'admin01',$4) returning id", [order.rows[0].id, salesAdjustment.rows[0].id, randomUUID(), randomUUID()]);
    const salesSource = await client.query("insert into sales_financial_source_entries(shipment_id,customer_id,entry_type,amount,currency_code,source_id) values($1,$2,'SHIPMENT',123.456789,'CNY',$3) returning id", [shipment.rows[0].id, customer.rows[0].id, randomUUID()]);
    const po = await client.query("insert into purchase_orders(po_code,supplier_id,status,currency_code,operation_id,created_by,request_id) values('PO-FIN',$1,'RECEIVED','CNY',$2,'admin01',$3) returning id", [supplier.rows[0].id, randomUUID(), randomUUID()]);
    const receipt = await client.query("insert into purchase_receipts(receipt_code,purchase_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('PR-FIN',$1,$2,'财务测试收货',$3,'admin01',$4) returning id", [po.rows[0].id, purchaseAdjustment.rows[0].id, randomUUID(), randomUUID()]);
    const purchaseSource = await client.query("insert into purchase_financial_source_entries(purchase_receipt_id,supplier_id,entry_type,amount,currency_code,source_id) values($1,$2,'RECEIPT',98.765432,'CNY',$3) returning id", [receipt.rows[0].id, supplier.rows[0].id, randomUUID()]);
    await client.query("commit");
    return { salesSourceId: Number(salesSource.rows[0].id), purchaseSourceId: Number(purchaseSource.rows[0].id), shipmentId: Number(shipment.rows[0].id), receiptId: Number(receipt.rows[0].id), orderId: Number(order.rows[0].id), poId: Number(po.rows[0].id) };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

test.beforeEach(async () => { await pool.query("truncate app_users,customers,suppliers,idempotency_keys,audit_log,business_code_sequences,identity_write_rate_limit_buckets restart identity cascade"); });
test.after(async () => pool.end());

test("AR and AP inherit exact posted source facts, settle, reverse and summarize", async () => {
  const refs = await seedSources();
  const arBody = { document_type: "AR", source_entry_id: refs.salesSourceId, due_date: "2026-08-31" };
  const ar = await api("/api/financial-documents/from-source", { method: "POST", body: arBody, key: "finance-ar-source-0001" });
  assert.equal(ar.response.status, 201, JSON.stringify(ar.payload));
  const arId = Number(ar.payload.doc_id);
  const replay = await api("/api/financial-documents/from-source", { method: "POST", body: arBody, key: "finance-ar-source-0001" });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const changed = await api("/api/financial-documents/from-source", { method: "POST", body: { ...arBody, due_date: "2026-09-01" }, key: "finance-ar-source-0001" });
  assert.equal(changed.payload.code, "IDEMPOTENCY_CONFLICT");
  const duplicate = await api("/api/financial-documents/from-source", { method: "POST", body: arBody });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.code, "FINANCE_SOURCE_ALREADY_POSTED");
  const ap = await api("/api/finance/documents", { method: "POST", body: { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceId, accounting_date: "2026-07-25" } });
  assert.equal(ap.response.status, 201, JSON.stringify(ap.payload));
  const apId = Number(ap.payload.doc_id);
  const exact = await pool.query("select doc_type,total_amount::text,currency_code,customer_id,supplier_id from finance_documents order by id");
  assert.deepEqual(exact.rows.map((row) => [row.doc_type, row.total_amount, row.currency_code, Boolean(row.customer_id), Boolean(row.supplier_id)]), [["AR", "123.456789", "CNY", true, false], ["AP", "98.765432", "CNY", false, true]]);

  const partial = await api("/api/financial-payments", { method: "POST", body: { doc_id: arId, expected_version: 1, amount: "23.456789", payment_date: "2026-07-25", account_name: "测试基本户", reason: "首笔收款" } });
  assert.equal(partial.response.status, 201, JSON.stringify(partial.payload));
  assert.deepEqual([partial.payload.settled_amount, partial.payload.doc_status, partial.payload.document_version], ["23.456789", "PARTIALLY_SETTLED", 2]);
  const over = await api("/api/financial-payments", { method: "POST", body: { doc_id: arId, expected_version: 2, amount: "100.000001", payment_date: "2026-07-25", account_name: "测试基本户" } });
  assert.equal(over.response.status, 409);
  assert.equal(over.payload.code, "FINANCE_AMOUNT_EXCEEDS_BALANCE");
  const full = await api(`/api/financial-documents/${arId}/settlements`, { method: "POST", body: { expected_version: 2, amount: "100", accounting_date: "2026-07-25", account_name: "测试基本户" } });
  assert.equal(full.response.status, 201, JSON.stringify(full.payload));
  assert.deepEqual([full.payload.settled_amount, full.payload.doc_status, full.payload.document_version], ["123.456789", "SETTLED", 3]);
  const reversed = await api(`/api/finance-settlements/${full.payload.settlement_id}/reversal`, { method: "POST", body: { expected_version: 3, accounting_date: "2026-07-26", reason: "银行退回" } });
  assert.equal(reversed.response.status, 201, JSON.stringify(reversed.payload));
  assert.deepEqual([reversed.payload.settled_amount, reversed.payload.doc_status, reversed.payload.document_version], ["23.456789", "PARTIALLY_SETTLED", 4]);
  const repeated = await api(`/api/financial-payments/${full.payload.settlement_id}/reversal`, { method: "POST", body: { expected_version: 4, accounting_date: "2026-07-26", reason: "重复" } });
  assert.equal(repeated.response.status, 409);
  assert.equal(repeated.payload.code, "FINANCE_SETTLEMENT_ALREADY_REVERSED");
  const apPayment = await api("/api/finance/settlements", { method: "POST", body: { document_id: apId, expected_version: 1, amount: "8.765432", accounting_date: "2026-07-25", account_name: "测试基本户" } });
  assert.equal(apPayment.response.status, 201, JSON.stringify(apPayment.payload));
  const summary = await api("/api/finance-summary");
  assert.deepEqual({ receivable_total: summary.payload.receivable_total, receivable_paid: summary.payload.receivable_paid, payable_total: summary.payload.payable_total, payable_paid: summary.payload.payable_paid, cash_net: summary.payload.cash_net }, { receivable_total: "123.456789", receivable_paid: "23.456789", payable_total: "98.765432", payable_paid: "8.765432", cash_net: "14.691357" });
  assert.equal(Number((await pool.query("select count(*) count from finance_document_events")).rows[0].count), 6);
});

test("role scope, trusted body, CSRF, versions and concurrent settlements fail closed", async () => {
  const refs = await seedSources();
  const sources = await api("/api/finance/source-options?doc_type=AR", { role: "finance" });
  assert.equal(sources.payload.rows[0].source_entry_id, String(refs.salesSourceId));
  assert.equal((await api("/api/finance/source-options?doc_type=AR", { role: "sales" })).response.status, 403);
  const untrusted = await api("/api/finance/documents", { method: "POST", body: { doc_type: "AR", sales_source_entry_id: refs.salesSourceId, total_amount: "1" } });
  assert.equal(untrusted.response.status, 400);
  assert.equal(untrusted.payload.code, "REQUEST_VALIDATION_FAILED");
  assert.equal((await api("/api/finance/documents", { method: "POST", role: "sales", body: { doc_type: "AR", sales_source_entry_id: refs.salesSourceId } })).response.status, 403);
  assert.equal((await api("/api/finance/documents", { method: "POST", csrf: false, body: { doc_type: "AR", sales_source_entry_id: refs.salesSourceId } })).response.status, 403);
  const ar = await api("/api/finance/documents", { method: "POST", body: { doc_type: "AR", sales_source_entry_id: refs.salesSourceId } });
  const arId = Number(ar.payload.doc_id);
  const concurrent = await Promise.all(["A", "B"].map((suffix) => api("/api/financial-payments", { method: "POST", key: `finance-concurrent-${suffix}`, body: { doc_id: arId, expected_version: 1, amount: "70", payment_date: "2026-07-25", account_name: "并发户", reason: suffix } })));
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [201, 409]);
  assert.equal((await pool.query("select settled_amount::text,version from finance_documents where id=$1", [arId])).rows[0].settled_amount, "70.000000");
  const salesList = await api("/api/financial-documents", { role: "sales" });
  assert.ok(salesList.payload.rows.every((row) => row.doc_type === "AR"));
  const purchaseList = await api("/api/financial-documents", { role: "purchase" });
  assert.equal(purchaseList.payload.rows.length, 0);
  const hidden = await api("/api/finance-summary", { role: "engineering" });
  assert.equal(hidden.payload.receivable_total, "0");
});

test("posted facts are immutable, upstream reversal is blocked and transaction failures roll back", async () => {
  const refs = await seedSources();
  const ar = await api("/api/finance/documents", { method: "POST", body: { doc_type: "AR", sales_source_entry_id: refs.salesSourceId } });
  const arId = Number(ar.payload.doc_id);
  const payment = await api("/api/financial-payments", { method: "POST", body: { document_id: arId, expected_version: 1, amount: "10", accounting_date: "2026-07-25", account_name: "测试户" } });
  await assert.rejects(pool.query("update finance_settlements set reason='篡改' where id=$1", [payment.payload.settlement_id]), /immutable|FinanceService|finance facts/i);
  await assert.rejects(pool.query("delete from finance_document_events where document_id=$1", [arId]), /immutable|FinanceService|finance facts/i);
  await assert.rejects(pool.query("update finance_documents set total_amount=1 where id=$1", [arId]), /immutable|FinanceService|finance document/i);
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('cyd.inventory_service_write','allowed',true),set_config('cyd.sales_service_write','allowed',true)");
    const adj = await db.query("insert into inventory_adjustments(adjustment_code,operation_type,reversal_of_adjustment_id,reason,operation_id,created_by,request_id) select 'ADJ-FIN-R','REVERSAL',inventory_adjustment_id,'冲销测试',$1,'admin01',$2 from sales_shipments where id=$3 returning id", [randomUUID(), randomUUID(), refs.shipmentId]);
    const shipment = await db.query("insert into sales_shipments(shipment_code,sales_order_id,shipment_type,original_shipment_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('SH-FIN-R',$1,'REVERSAL',$2,$3,'冲销测试',$4,'admin01',$5) returning id", [refs.orderId, refs.shipmentId, adj.rows[0].id, randomUUID(), randomUUID()]);
    await assert.rejects(db.query("insert into sales_financial_source_entries(shipment_id,customer_id,entry_type,amount,currency_code,source_id,reversal_of_source_entry_id) select $1,customer_id,'SHIPMENT_REVERSAL',-amount,currency_code,$2,id from sales_financial_source_entries where id=$3", [shipment.rows[0].id, randomUUID(), refs.salesSourceId]), /posted finance document blocks source reversal/);
    await db.query("rollback");
  } finally { db.release(); }

  const faulty = new FinanceService(new FinanceRepository(pool), (checkpoint) => { if (checkpoint === "after_finance_document_create") throw new Error("forced finance rollback"); });
  const failedMeta = meta("fault-create");
  await assert.rejects(faulty.create(failedMeta, { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceId, accounting_date: "2026-07-25" }), /服务器暂时无法处理财务请求/);
  assert.equal(Number((await pool.query("select count(*) count from finance_documents where doc_type='AP'")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest=$1", [failedMeta.keyDigest])).rows[0].count), 0);

  const upstream = await pool.connect();
  try {
    await upstream.query("begin");
    await upstream.query("select set_config('cyd.inventory_service_write','allowed',true),set_config('cyd.procurement_service_write','allowed',true)");
    await upstream.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`FINANCE_SOURCE:AP:${refs.receiptId}`]);
    await upstream.query("select id from purchase_receipts where id=$1 for update", [refs.receiptId]);
    const racingFinance = new FinanceService(new FinanceRepository(pool)).create(meta("race-ap"), { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceId, accounting_date: "2026-07-25" });
    const blocked = await Promise.race([racingFinance.then(() => "completed", () => "failed"), new Promise((resolve) => setTimeout(() => resolve("blocked"), 50))]);
    assert.equal(blocked, "blocked");
    assert.equal(Number((await upstream.query("select count(*) count from finance_documents where doc_type='AP'")).rows[0].count), 0);
    const adjustment = await upstream.query("insert into inventory_adjustments(adjustment_code,operation_type,reversal_of_adjustment_id,reason,operation_id,created_by,request_id) select 'ADJ-FIN-PR-R','REVERSAL',inventory_adjustment_id,'采购并发冲销',$1,'admin01',$2 from purchase_receipts where id=$3 returning id", [randomUUID(), randomUUID(), refs.receiptId]);
    const reversal = await upstream.query("insert into purchase_receipts(receipt_code,purchase_order_id,receipt_type,reversal_of_receipt_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('PR-FIN-R',$1,'REVERSAL',$2,$3,'采购并发冲销',$4,'admin01',$5) returning id", [refs.poId, refs.receiptId, adjustment.rows[0].id, randomUUID(), randomUUID()]);
    await upstream.query("insert into purchase_financial_source_entries(purchase_receipt_id,supplier_id,entry_type,amount,currency_code,source_id) select $1,supplier_id,'RECEIPT_REVERSAL',-amount,currency_code,$2 from purchase_financial_source_entries where id=$3", [reversal.rows[0].id, randomUUID(), refs.purchaseSourceId]);
    await upstream.query("commit");
    await assert.rejects(racingFinance, (error) => error.code === "FINANCE_SOURCE_INVALID");
    assert.equal(Number((await pool.query("select count(*) count from finance_documents where doc_type='AP'")).rows[0].count), 0);
  } catch (error) { await upstream.query("rollback").catch(() => undefined); throw error; } finally { upstream.release(); }

  await pool.query(`create or replace function fail_finance_audit_for_test() returns trigger language plpgsql as $$ begin if new.action='FINANCE_SETTLEMENT_REVERSED' then raise exception 'forced finance audit failure'; end if; return new; end $$`);
  await pool.query("create trigger fail_finance_audit_for_test before insert on audit_log for each row execute function fail_finance_audit_for_test()");
  const failed = await api(`/api/financial-payments/${payment.payload.settlement_id}/reversal`, { method: "POST", body: { expected_version: 2, accounting_date: "2026-07-26", reason: "审计失败" } });
  assert.equal(failed.response.status, 500);
  assert.deepEqual((await pool.query("select settled_amount::text,version from finance_documents where id=$1", [arId])).rows[0], { settled_amount: "10.000000", version: 2 });
  assert.equal(Number((await pool.query("select count(*) count from finance_settlements where original_settlement_id=$1", [payment.payload.settlement_id])).rows[0].count), 0);
  await pool.query("drop trigger fail_finance_audit_for_test on audit_log; drop function fail_finance_audit_for_test()");
});
