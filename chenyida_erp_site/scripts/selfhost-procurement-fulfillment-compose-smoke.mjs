import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_TASK05_SMOKE_PHASE || "initial";
let adminUsername = "";
const users = {
  purchase: [process.env.ERP_TASK05_PURCHASE_USERNAME || "", process.env.ERP_TASK05_PURCHASE_TEMP_PASSWORD || "", process.env.ERP_TASK05_PURCHASE_PASSWORD || ""],
  warehouse: [process.env.ERP_TASK05_WAREHOUSE_USERNAME || "", process.env.ERP_TASK05_WAREHOUSE_TEMP_PASSWORD || "", process.env.ERP_TASK05_WAREHOUSE_PASSWORD || ""],
  finance: [process.env.ERP_TASK05_FINANCE_USERNAME || "", process.env.ERP_TASK05_FINANCE_TEMP_PASSWORD || "", process.env.ERP_TASK05_FINANCE_PASSWORD || ""],
};

if (process.env.ERP_TASK05_ACCEPTANCE_CONFIRM !== "PARALLEL_SYNTHETIC_ONLY" || process.env.ERP_ENV === "production" || !/@postgres(?::5432)?\/chenyida_erp$/i.test(databaseUrl)) {
  throw new Error("TASK05 Compose smoke requires the explicitly confirmed parallel synthetic database");
}
if (!Object.values(users).flat().every(Boolean)) throw new Error("TASK05 Compose smoke role credentials are required through environment variables");

function client() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(";"); const split = pair.indexOf("="); if (/Max-Age=0/i.test(value)) cookies.delete(pair.slice(0, split)); else cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
    const payload = await response.json();
    if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    return { response, payload };
  }
  return {
    login: async (username, password) => { const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); csrf = result.payload.csrf_token; return result; },
    get: (path, status = 200) => request(path, {}, status),
    write: (path, body, status = 200, key = randomUUID()) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, status),
  };
}

async function provisionRole(pool, role) {
  const [username, , password] = users[role];
  await pool.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$2,$3,$4,true,false,1)", [username, `TASK05 ${role}`, role, await hashPassword(password)]);
  const actor = client(); await actor.login(username, password); return actor;
}

async function seedAcceptedRequest(pool) {
  const purchase = users.purchase[0], digest = (label) => createHash("sha256").update(label).digest("hex");
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true),set_config('cyd.inventory_service_write','allowed',true)");
    const unit = await db.query("insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id");
    const category = await db.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('T05','TASK05 合成零件',1,'ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    const material = await db.query("insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('MAT-T05-001','TASK05 连接器',$1,'PCS',$2,'ACTIVE','PURCHASED','STOCKED','NONE','RoHS','MANUAL',$3,$3,$3,$4) returning id", [category.rows[0].id, unit.rows[0].id, adminUsername, randomUUID()]);
    const customer = await db.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-T05','TASK05 合成客户','TASK05 合成客户','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    const supplier = await db.query("insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-T05-A','供应商 A','供应商 A','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    await db.query("insert into supplier_mappings(material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id) values($1,$2,'供应商 A','SUP-T05-A','A-T05-001','PCS',$3,1,1,'ACTIVE',now()-interval '1 day',$4,$4,$5)", [material.rows[0].id, supplier.rows[0].id, unit.rows[0].id, adminUsername, randomUUID()]);
    const project = await db.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values('PRJ-00000005',$1,'TASK05 合成项目','采购履约验收',$2,$2,'ACCEPTED','2026-10-01',1,4,$3,$2) returning id", [customer.rows[0].id, adminUsername, randomUUID()]);
    const requirement = await db.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'采购连接器 10 件',10,'PCS',$2,$3) returning id", [project.rows[0].id, digest("task05-requirement"), adminUsername]);
    const planningPackage = await db.query("insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id) values($1,1,$2,'ACCEPTED','2026-10-01',$3,$4,$4,now(),$5,now(),3,$6) returning id", [project.rows[0].id, requirement.rows[0].id, digest("task05-package"), adminUsername, purchase, randomUUID()]);
    const plan = await db.query("insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id) values($1,$2,1,'2026-10-01','SUBMITTED',3,$3,$4,$5,$5,now(),1,$6) returning id", [project.rows[0].id, planningPackage.rows[0].id, digest("task05-package"), digest("task05-calculation"), adminUsername, randomUUID()]);
    const planLine = await db.query("insert into planning_material_requirement_lines(plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest) values($1,1,$2,$3,$4,$5,10,0,0,0,0,10,$6) returning id", [plan.rows[0].id, material.rows[0].id, unit.rows[0].id, { internal_material_code: "MAT-T05-001", standard_name: "TASK05 连接器" }, digest("task05-material"), digest("task05-line")]);
    const request = await db.query("insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,version,request_id) values('PRQ-00000005',$1,'SUBMITTED',$2,now(),1,$3) returning id", [plan.rows[0].id, adminUsername, randomUUID()]);
    await db.query("insert into planning_purchase_request_lines(purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity) values($1,$2,1,$3,$4,10)", [request.rows[0].id, planLine.rows[0].id, material.rows[0].id, unit.rows[0].id]);
    await db.query("update planning_material_requirement_plans set status='ACCEPTED',accepted_by=$2,accepted_at=now(),version=version+1,updated_at=now() where id=$1", [plan.rows[0].id, purchase]);
    await db.query("update planning_purchase_requests set status='ACCEPTED',accepted_by=$2,accepted_at=now(),updated_at=now() where id=$1", [request.rows[0].id, purchase]);
    await db.query("commit");
    return { purchaseRequestId: Number(request.rows[0].id), supplierId: Number(supplier.rows[0].id), materialId: Number(material.rows[0].id) };
  } catch (error) { await db.query("rollback"); throw error; } finally { db.release(); }
}

const pool = new Pool({ connectionString: databaseUrl, max: 8, application_name: "task05-compose-smoke" });
try {
  if (phase === "initial") {
    const clean = await pool.query("select (select count(*)::int from app_users) users,(select count(*)::int from customers) customers,(select count(*)::int from procurement_sourcing_awards) awards,(select count(*)::int from purchase_orders) pos,(select username from app_users where role='admin' and is_active) admin_username");
    adminUsername = String(clean.rows[0].admin_username || ""); delete clean.rows[0].admin_username; assert.ok(adminUsername);
    assert.deepEqual(clean.rows[0], { users: 1, customers: 0, awards: 0, pos: 0 });
    const purchase = await provisionRole(pool, "purchase"), warehouse = await provisionRole(pool, "warehouse"), finance = await provisionRole(pool, "finance");
    const refs = await seedAcceptedRequest(pool);

    const rfq = await purchase.write("/api/procurement/rfqs", { purchase_request_id: refs.purchaseRequestId, supplier_ids: [refs.supplierId], response_deadline: "2026-09-01", expected_version: 1 }, 201, "task05-rfq");
    const rfqId = Number(rfq.payload.rfq_id), rfqLineId = Number((await pool.query("select id from procurement_rfq_lines where rfq_id=$1", [rfqId])).rows[0].id);
    await purchase.write(`/api/procurement/rfqs/${rfqId}/issue`, { expected_version: 1 }, 200, "task05-rfq-issue");
    await purchase.write(`/api/procurement/rfqs/${rfqId}/quotes`, { expected_version: 2, supplier_id: refs.supplierId, supplier_quote_reference: "TASK05-A-12", valid_until: "2026-12-31", tax_included: true, freight_included: false, payment_terms: "月结 30 天", lines: [{ rfq_line_id: rfqLineId, quoted_quantity: "10.000000", minimum_order_quantity: "10.000000", unit_price: "12.000000", lead_time_days: 10, promised_delivery_date: "2026-09-15" }] }, 201, "task05-quote");
    const compared = await purchase.write(`/api/procurement/rfqs/${rfqId}/comparisons`, { expected_version: 3 }, 201, "task05-comparison");
    const quoteLineId = Number((await pool.query("select quote_line_id from procurement_quote_comparison_lines where comparison_id=$1", [compared.payload.comparison_id])).rows[0].quote_line_id);
    const awarded = await purchase.write(`/api/procurement/rfqs/${rfqId}/award`, { expected_version: 4, reason_code: "SOLE_SOURCE", reason: "TASK05 合成验收唯一有效报价", lines: [{ rfq_line_id: rfqLineId, selected_quote_line_id: quoteLineId, selected_quantity: "10.000000", selection_reason: "供应商 A 报价 12 元且承诺交期满足需求", late_delivery_reason_code: "", late_delivery_reason: "", excess_quantity_reason: "" }] }, 201, "task05-award");
    const awardId = Number(awarded.payload.award_id), convertKey = "task05-award-convert", convertBody = { expected_version: 1 };
    const deniedConvert = await warehouse.write(`/api/procurement/awards/${awardId}/purchase-orders`, convertBody, 403, "task05-denied-convert"); assert.equal(deniedConvert.payload.code, "PERMISSION_DENIED");
    const converted = await purchase.write(`/api/procurement/awards/${awardId}/purchase-orders`, convertBody, 201, convertKey);
    const replay = await purchase.write(`/api/procurement/awards/${awardId}/purchase-orders`, convertBody, 201, convertKey); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
    const bodyConflict = await purchase.write(`/api/procurement/awards/${awardId}/purchase-orders`, { expected_version: 2 }, 409, convertKey); assert.equal(bodyConflict.payload.code, "IDEMPOTENCY_CONFLICT");
    const po = converted.payload.data.purchase_orders[0], poId = Number(po.id), poLineId = Number(po.lines[0].id);
    assert.equal(po.lines[0].order_qty, "10.000000"); assert.equal(po.lines[0].unit_price, "12.000000");
    const planned = await purchase.write(`/api/procurement/purchase-orders/${poId}/delivery-plans`, { expected_version: 1 }, 201, "task05-delivery-plan");
    const planId = Number(planned.payload.data.plans[0].id);
    const before = (await pool.query("select (select count(*)::int from purchase_receipts) receipts,(select count(*)::int from inventory_ledger_entries) ledger,(select count(*)::int from finance_documents where doc_type='AP') ap")).rows[0]; assert.deepEqual(before, { receipts: 0, ledger: 0, ap: 0 });
    const firstBody = { quantity: "4", expected_version: 1, expected_line_version: 1, expected_balance_version: 0, reason: "TASK05 首批收货 4" }, receiveKey = "task05-receive-four";
    const first = await warehouse.write(`/api/procurement/delivery-plans/${planId}/receipts`, firstBody, 201, receiveKey);
    assert.equal(first.payload.delivery_plan.status, "PARTIAL"); assert.equal(first.payload.delivery_plan.received_quantity, "4.000000"); assert.equal(first.payload.data.financial_source.amount, "48.000000");
    const receiveReplay = await warehouse.write(`/api/procurement/delivery-plans/${planId}/receipts`, firstBody, 201, receiveKey); assert.equal(receiveReplay.response.headers.get("Idempotency-Replayed"), "true");
    const receiveConflict = await warehouse.write(`/api/procurement/delivery-plans/${planId}/receipts`, { ...firstBody, quantity: "3" }, 409, receiveKey); assert.equal(receiveConflict.payload.code, "IDEMPOTENCY_CONFLICT");
    const ap48 = await finance.write("/api/finance/documents", { doc_type: "AP", purchase_source_entry_id: Number(first.payload.data.financial_source.id), accounting_date: "2026-07-26", due_date: "2026-08-26" }, 201, "task05-ap-48"); assert.equal(ap48.payload.data.total_amount, "48.000000");
    const stale = await warehouse.write(`/api/procurement/delivery-plans/${planId}/receipts`, { quantity: "1", expected_version: 1, expected_line_version: 2, expected_balance_version: 1, reason: "TASK05 陈旧版本" }, 409, "task05-stale"); assert.equal(stale.payload.code, "DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT");
    const over = await warehouse.write(`/api/procurement/delivery-plans/${planId}/receipts`, { quantity: "7", expected_version: 2, expected_line_version: 2, expected_balance_version: 1, reason: "TASK05 超收" }, 409, "task05-over"); assert.equal(over.payload.code, "PURCHASE_RECEIPT_OVER_QUANTITY");
    const second = await warehouse.write(`/api/procurement/delivery-plans/${planId}/receipts`, { quantity: "6", expected_version: 2, expected_line_version: 2, expected_balance_version: 1, reason: "TASK05 第二批收货 6" }, 201, "task05-receive-six");
    assert.equal(second.payload.delivery_plan.status, "COMPLETED"); assert.equal(second.payload.data.financial_source.amount, "72.000000");
    const ap72 = await finance.write("/api/finance/documents", { doc_type: "AP", purchase_source_entry_id: Number(second.payload.data.financial_source.id), accounting_date: "2026-07-26", due_date: "2026-08-26" }, 201, "task05-ap-72"); assert.equal(ap72.payload.data.total_amount, "72.000000");
    const awardBlocked = await purchase.write(`/api/procurement/awards/${awardId}/reversal`, { expected_version: 1, reason: "TASK05 已转 PO 后禁止撤销" }, 409, "task05-award-blocked"); assert.equal(awardBlocked.payload.code, "AWARD_HAS_PURCHASE_ORDER");
    const reversalBlocked = await warehouse.write(`/api/procurement/fulfillment/receipts/${second.payload.receipt_id}/reversal`, { reason: "TASK05 已有 AP 后禁止冲销", expected_plan_version: 3, expected_line_versions: [{ purchase_order_line_id: poLineId, expected_line_version: 3 }], expected_balance_versions: [{ material_id: refs.materialId, expected_balance_version: 2 }] }, 409, "task05-receipt-blocked"); assert.equal(reversalBlocked.payload.code, "RECEIPT_REVERSAL_BLOCKED_BY_AP");
    const handoff = await finance.get("/api/procurement/fulfillment/payable-handoff?page_size=100"); assert.deepEqual(handoff.payload.data.map((row) => [row.amount, row.handoff_status]).sort(), [["48.000000", "AP_CREATED"], ["72.000000", "AP_CREATED"]]);
    const totals = (await pool.query("select (select status from purchase_orders where id=$1) po_status,(select status from purchase_delivery_plans where id=$2) plan_status,(select received_qty::text from purchase_order_lines where id=$3) received,(select on_hand_qty::text from inventory_stock_balances where material_id=$4) inventory,(select sum(amount)::text from purchase_financial_source_entries where entry_type='RECEIPT') sources,(select sum(total_amount)::text from finance_documents where doc_type='AP') ap_total,(select count(*)::int from purchase_receipt_delivery_allocations where reversal_of_allocation_id is null) allocations,(select count(*)::int from purchase_delivery_plan_events) plan_events,(select count(*)::int from audit_log where result='success' and route_code in ('PROCUREMENT','PROCUREMENT_SOURCING','FINANCE')) success_audits", [poId, planId, poLineId, refs.materialId])).rows[0];
    assert.deepEqual({ ...totals, success_audits: undefined }, { po_status: "RECEIVED", plan_status: "COMPLETED", received: "10.000000", inventory: "10.000000", sources: "120.000000", ap_total: "120.000000", allocations: 2, plan_events: 3, success_audits: undefined }); assert.ok(totals.success_audits >= 10);
    for (const path of ["/procurement/fulfillment", "/warehouse/receiving", "/finance/payables"]) { const response = await fetch(`${base}${path}`); assert.equal(response.status, 200, path); }
    console.info(JSON.stringify({ ok: true, phase, award_id: awardId, po_id: poId, plan_id: planId, receipt_ids: [Number(first.payload.receipt_id), Number(second.payload.receipt_id)], ap_ids: [Number(ap48.payload.doc_id), Number(ap72.payload.doc_id)], quantity: "10.000000", sources: "120.000000", ap_total: "120.000000", pages: 3, roles: ["purchase", "warehouse", "finance"] }));
  } else if (phase === "restart") {
    for (const [role, [username, , password]] of Object.entries(users)) { const actor = client(); await actor.login(username, password); await actor.get(role === "finance" ? "/api/procurement/fulfillment/payable-handoff?page_size=100" : role === "warehouse" ? "/api/procurement/fulfillment/receiving-queue?page_size=100" : "/api/procurement/fulfillment/orders?page_size=100"); }
    const totals = (await pool.query("select (select count(*)::int from schema_migrations) migrations,(select count(*)::int from procurement_sourcing_awards) awards,(select count(*)::int from purchase_orders) pos,(select count(*)::int from purchase_receipts where receipt_type='RECEIPT') receipts,(select sum(on_hand_qty)::text from inventory_stock_balances) inventory,(select sum(amount)::text from purchase_financial_source_entries where entry_type='RECEIPT') sources,(select sum(total_amount)::text from finance_documents where doc_type='AP') ap_total,(select count(*)::int from purchase_delivery_plan_events) plan_events")).rows[0];
    assert.deepEqual(totals, { migrations: 19, awards: 1, pos: 1, receipts: 2, inventory: "10.000000", sources: "120.000000", ap_total: "120.000000", plan_events: 3 });
    console.info(JSON.stringify({ ok: true, phase, ...totals, durable: true }));
  } else throw new Error(`unsupported ERP_TASK05_SMOKE_PHASE: ${phase}`);
} finally { await pool.end(); }
