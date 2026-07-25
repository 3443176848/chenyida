import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_FINANCE_SMOKE_PHASE || "initial";
const setupToken = process.env.ERP_SETUP_TOKEN || "";
const adminUsername = process.env.ERP_ADMIN_USERNAME || "";
const adminPassword = process.env.ERP_ADMIN_PASSWORD || "";
if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("finance compose smoke requires an isolated test database");
if (!setupToken || !adminUsername || !adminPassword) throw new Error("finance compose smoke credentials are required");

function client() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(";"); const separator = pair.indexOf("="); const name = pair.slice(0, separator); const content = pair.slice(separator + 1); if (/Max-Age=0/i.test(value)) cookies.delete(name); else cookies.set(name, content); }
    const payload = await response.json();
    if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    return { response, payload };
  }
  return {
    setup: () => request("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setup_token: setupToken, username: adminUsername, display_name: "TASK09 财务烟测管理员", password: adminPassword }) }, 201),
    login: async () => { const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: adminUsername, password: adminPassword }) }); csrf = result.payload.csrf_token; return result; },
    get: (path) => request(path),
    write: (path, body, status = 201, key = randomUUID()) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, status),
  };
}

const pool = new Pool({ connectionString: databaseUrl, max: 3, application_name: "finance-compose-smoke" });
try {
  if (phase === "initial") {
    const setup = client(); await setup.setup(); const admin = client(); await admin.login();
    const customer = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-T09','TASK09 客户','TASK09 客户','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    const supplier = await pool.query("insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-T09','TASK09 供应商','TASK09 供应商','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    const db = await pool.connect(); let refs;
    try {
      await db.query("begin");
      await db.query("select set_config('cyd.inventory_service_write','allowed',true),set_config('cyd.sales_service_write','allowed',true),set_config('cyd.procurement_service_write','allowed',true)");
      const sa = await db.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values('ADJ-T09-S','ISSUE','TASK09 发货来源',$1,$2,$3) returning id", [randomUUID(), adminUsername, randomUUID()]);
      const pa = await db.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values('ADJ-T09-P','RECEIPT','TASK09 收货来源',$1,$2,$3) returning id", [randomUUID(), adminUsername, randomUUID()]);
      const so = await db.query("insert into sales_orders(sales_order_code,customer_id,ordered_qty,shipped_qty,status,operation_id,created_by,request_id) values('SO-T09',$1,1,1,'SHIPPED',$2,$3,$4) returning id", [customer.rows[0].id, randomUUID(), adminUsername, randomUUID()]);
      const sh = await db.query("insert into sales_shipments(shipment_code,sales_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('SH-T09',$1,$2,'TASK09 发货',$3,$4,$5) returning id", [so.rows[0].id, sa.rows[0].id, randomUUID(), adminUsername, randomUUID()]);
      const sf = await db.query("insert into sales_financial_source_entries(shipment_id,customer_id,entry_type,amount,currency_code,source_id) values($1,$2,'SHIPMENT',50.000001,'CNY',$3) returning id", [sh.rows[0].id, customer.rows[0].id, randomUUID()]);
      const po = await db.query("insert into purchase_orders(po_code,supplier_id,status,currency_code,operation_id,created_by,request_id) values('PO-T09',$1,'RECEIVED','CNY',$2,$3,$4) returning id", [supplier.rows[0].id, randomUUID(), adminUsername, randomUUID()]);
      const pr = await db.query("insert into purchase_receipts(receipt_code,purchase_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('PR-T09',$1,$2,'TASK09 收货',$3,$4,$5) returning id", [po.rows[0].id, pa.rows[0].id, randomUUID(), adminUsername, randomUUID()]);
      const pf = await db.query("insert into purchase_financial_source_entries(purchase_receipt_id,supplier_id,entry_type,amount,currency_code,source_id) values($1,$2,'RECEIPT',20,'CNY',$3) returning id", [pr.rows[0].id, supplier.rows[0].id, randomUUID()]);
      await db.query("commit"); refs = { salesSourceId: Number(sf.rows[0].id), purchaseSourceId: Number(pf.rows[0].id) };
    } catch (error) { await db.query("rollback"); throw error; } finally { db.release(); }
    const ar = await admin.write("/api/finance/documents", { doc_type: "AR", sales_source_entry_id: refs.salesSourceId, accounting_date: "2026-07-25" }, 201, "task09-ar");
    const ap = await admin.write("/api/finance/documents", { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceId, accounting_date: "2026-07-25" }, 201, "task09-ap");
    await admin.write("/api/finance/settlements", { document_id: Number(ar.payload.doc_id), expected_version: 1, amount: "10", accounting_date: "2026-07-25", account_name: "TASK09 测试户" }, 201, "task09-ar-settle");
    const paid = await admin.write("/api/finance/settlements", { document_id: Number(ap.payload.doc_id), expected_version: 1, amount: "20", accounting_date: "2026-07-25", account_name: "TASK09 测试户" }, 201, "task09-ap-settle");
    await admin.write(`/api/financial-payments/${paid.payload.settlement_id}/reversal`, { expected_version: 2, accounting_date: "2026-07-26", reason: "TASK09 烟测冲销" }, 201, "task09-ap-reverse");
    const summary = await admin.get("/api/finance-summary");
    if (JSON.stringify([summary.payload.receivable_total, summary.payload.receivable_paid, summary.payload.payable_total, summary.payload.payable_paid, summary.payload.cash_net]) !== JSON.stringify(["50.000001", "10.000000", "20.000000", "0.000000", "10.000000"])) throw new Error(`finance initial summary mismatch: ${JSON.stringify(summary.payload)}`);
    console.info(JSON.stringify({ ok: true, phase, ar: ar.payload.doc_code, ap: ap.payload.doc_code }));
  } else if (phase === "restart") {
    const admin = client(); await admin.login(); const documents = await admin.get("/api/financial-documents"); const settlements = await admin.get("/api/financial-payments"); const summary = await admin.get("/api/finance-summary");
    const counts = await pool.query("select (select count(*)::int from finance_documents) documents,(select count(*)::int from finance_settlements) settlements,(select count(*)::int from finance_document_events) events,(select count(*)::int from audit_log where route_code='FINANCE' and result='success') finance_audits");
    const expected = { documents: 2, settlements: 3, events: 5, finance_audits: 5 };
    if (documents.payload.rows.length !== 2 || settlements.payload.rows.length !== 3 || summary.payload.cash_net !== "10.000000" || JSON.stringify(counts.rows[0]) !== JSON.stringify(expected)) throw new Error(`finance restart mismatch: ${JSON.stringify({ counts: counts.rows[0], summary: summary.payload })}`);
    console.info(JSON.stringify({ ok: true, phase, ...counts.rows[0] }));
  } else throw new Error(`unsupported ERP_FINANCE_SMOKE_PHASE: ${phase}`);
} finally { await pool.end(); }
