import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_TASK10_SMOKE_PHASE || "initial";
const credentials = Object.fromEntries(["purchase", "warehouse", "quality1", "quality2", "production", "finance"].map((role) => [role, {
  username: process.env[`ERP_TASK10_${role.toUpperCase()}_USERNAME`] || "",
  password: process.env[`ERP_TASK10_${role.toUpperCase()}_PASSWORD`] || "",
}]));

if (process.env.ERP_TASK10_ACCEPTANCE_CONFIRM !== "PARALLEL_SYNTHETIC_ONLY" || process.env.ERP_ENV === "production" || !/@postgres(?::5432)?\/chenyida_erp$/i.test(databaseUrl)) {
  throw new Error("TASK10 Compose smoke requires the explicitly confirmed parallel synthetic database");
}
if (!Object.values(credentials).every(({ username, password }) => username && password)) throw new Error("TASK10 role credentials are required through environment variables");

function client() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";"); const split = pair.indexOf("=");
      if (/Max-Age=0/i.test(value)) cookies.delete(pair.slice(0, split)); else cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const payload = await response.json();
    if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    return { response, payload };
  }
  return {
    login: async (username, password) => { const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); csrf = result.payload.csrf_token; },
    get: (path, status = 200) => request(path, {}, status),
    post: (path, body, status = 200, key = randomUUID()) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, status),
  };
}

async function provision(pool, roleName, databaseRole = roleName) {
  const actor = credentials[roleName];
  await pool.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$2,$3,$4,true,false,1)", [actor.username, `TASK10 ${roleName}`, databaseRole, await hashPassword(actor.password)]);
  const session = client(); await session.login(actor.username, actor.password); return session;
}

const digest = (value) => createHash("sha256").update(value).digest("hex");

async function seedPlanning(pool, adminUsername, purchaseUsername) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true),set_config('cyd.material_requirement_service_write','allowed',true),set_config('cyd.inventory_service_write','allowed',true)");
    const unit = (await db.query("insert into units(code,name,symbol,unit_type,enabled) values('T10PCS','件','PCS','COUNT',true) returning id")).rows[0];
    const category = (await db.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('T10','TASK10 IQC 来料',1,'ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()])).rows[0];
    const material = (await db.query("insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('MAT-T10-001','TASK10 IQC 原材料',$1,'PCS',$2,'ACTIVE','PURCHASED','STOCKED','IQC','RoHS','MANUAL',$3,$3,$3,$4) returning id", [category.id, unit.id, adminUsername, randomUUID()])).rows[0];
    const customer = (await db.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-T10','TASK10 合成客户','TASK10 合成客户','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()])).rows[0];
    const supplier = (await db.query("insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-T10-A','Supplier A','SUPPLIER A','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()])).rows[0];
    await db.query("insert into supplier_mappings(material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id) values($1,$2,'Supplier A','SUP-T10-A','A-T10-001','PCS',$3,1,1,'ACTIVE',now()-interval '1 day',$4,$4,$5)", [material.id, supplier.id, unit.id, adminUsername, randomUUID()]);
    const requests = [];
    for (const fixture of [{ suffix: "A", number: 10, quantity: "10" }, { suffix: "B", number: 11, quantity: "3" }]) {
      const { suffix, number, quantity } = fixture;
      const project = (await db.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,target_delivery_date,current_requirement_version_no,version,request_id,created_by) values($1,$2,$3,'TASK10 来料 IQC 验收',$4,$4,'ACCEPTED','2026-10-01',1,4,$5,$4) returning id", [`PRJ-000000${number}`, customer.id, `TASK10 合成项目 ${suffix}`, adminUsername, randomUUID()])).rows[0];
      const requirement = (await db.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,$2,$3,'PCS',$4,$5) returning id", [project.id, `采购 IQC 原材料 ${quantity} 件`, quantity, digest(`task10-requirement-${suffix}`), adminUsername])).rows[0];
      const planningPackage = (await db.query("insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,target_delivery_date,package_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,version,request_id) values($1,1,$2,'ACCEPTED','2026-10-01',$3,$4,$4,now(),$5,now(),3,$6) returning id", [project.id, requirement.id, digest(`task10-package-${suffix}`), adminUsername, purchaseUsername, randomUUID()])).rows[0];
      const plan = (await db.query("insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,version,request_id) values($1,$2,1,'2026-10-01','SUBMITTED',3,$3,$4,$5,$5,now(),1,$6) returning id", [project.id, planningPackage.id, digest(`task10-package-${suffix}`), digest(`task10-calculation-${suffix}`), adminUsername, randomUUID()])).rows[0];
      const planLine = (await db.query("insert into planning_material_requirement_lines(plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest) values($1,1,$2,$3,$4,$5,$6,0,0,0,0,$6,$7) returning id", [plan.id, material.id, unit.id, { internal_material_code: "MAT-T10-001", standard_name: "TASK10 IQC 原材料" }, digest(`task10-material-${suffix}`), quantity, digest(`task10-line-${suffix}`)])).rows[0];
      const request = (await db.query("insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,version,request_id) values($1,$2,'SUBMITTED',$3,now(),1,$4) returning id", [`PRQ-000000${number}`, plan.id, adminUsername, randomUUID()])).rows[0];
      await db.query("insert into planning_purchase_request_lines(purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity) values($1,$2,1,$3,$4,$5)", [request.id, planLine.id, material.id, unit.id, quantity]);
      await db.query("update planning_material_requirement_plans set status='ACCEPTED',accepted_by=$2,accepted_at=now(),version=version+1,updated_at=now() where id=$1", [plan.id, purchaseUsername]);
      await db.query("update planning_purchase_requests set status='ACCEPTED',accepted_by=$2,accepted_at=now(),updated_at=now() where id=$1", [request.id, purchaseUsername]);
      requests.push({ suffix, quantity, purchaseRequestId: Number(request.id) });
    }
    await db.query("commit");
    return { supplierId: Number(supplier.id), materialId: Number(material.id), unitId: Number(unit.id), requests };
  } catch (error) { await db.query("rollback"); throw error; } finally { db.release(); }
}

async function awardToPlan(pool, purchase, refs, fixture) {
  const key = `task10-${fixture.suffix.toLowerCase()}`, quantity = fixture.quantity;
  const rfq = await purchase.post("/api/procurement/rfqs", { purchase_request_id: fixture.purchaseRequestId, supplier_ids: [refs.supplierId], response_deadline: "2026-09-01", expected_version: 1 }, 201, `${key}-rfq`);
  const rfqId = Number(rfq.payload.rfq_id), rfqLineId = Number((await pool.query("select id from procurement_rfq_lines where rfq_id=$1", [rfqId])).rows[0].id);
  await purchase.post(`/api/procurement/rfqs/${rfqId}/issue`, { expected_version: 1 }, 200, `${key}-issue`);
  await purchase.post(`/api/procurement/rfqs/${rfqId}/quotes`, { expected_version: 2, supplier_id: refs.supplierId, supplier_quote_reference: `TASK10-${fixture.suffix}-12`, valid_until: "2026-12-31", tax_included: true, freight_included: false, payment_terms: "月结 30 天", lines: [{ rfq_line_id: rfqLineId, quoted_quantity: quantity, minimum_order_quantity: quantity, unit_price: "12", lead_time_days: 10, promised_delivery_date: "2026-09-15" }] }, 201, `${key}-quote`);
  const comparison = await purchase.post(`/api/procurement/rfqs/${rfqId}/comparisons`, { expected_version: 3 }, 201, `${key}-comparison`);
  const quoteLineId = Number((await pool.query("select quote_line_id from procurement_quote_comparison_lines where comparison_id=$1", [comparison.payload.comparison_id])).rows[0].quote_line_id);
  const award = await purchase.post(`/api/procurement/rfqs/${rfqId}/award`, { expected_version: 4, reason_code: "SOLE_SOURCE", reason: `TASK10 ${fixture.suffix} 合成唯一有效报价`, lines: [{ rfq_line_id: rfqLineId, selected_quote_line_id: quoteLineId, selected_quantity: quantity, selection_reason: "Supplier A 报价 12 CNY 且交期满足", late_delivery_reason_code: "", late_delivery_reason: "", excess_quantity_reason: "" }] }, 201, `${key}-award`);
  const converted = await purchase.post(`/api/procurement/awards/${award.payload.award_id}/purchase-orders`, { expected_version: 1 }, 201, `${key}-convert`);
  const po = converted.payload.data.purchase_orders[0];
  const planned = await purchase.post(`/api/procurement/purchase-orders/${po.id}/delivery-plans`, { expected_version: 1 }, 201, `${key}-plan`);
  return { awardId: Number(award.payload.award_id), poId: Number(po.id), lineId: Number(po.lines[0].id), planId: Number(planned.payload.data.plans[0].id), quantity };
}

async function facts(pool) {
  return (await pool.query(`select
    (select count(*)::int from schema_migrations) migrations,
    (select count(*)::int from procurement_sourcing_awards) awards,
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from purchase_receipts where receipt_type='RECEIPT') receipts,
    (select count(*)::int from inventory_lots where lot_type='SUPPLIER_RECEIPT') lots,
    (select count(*)::int from quality_inspections where inspection_type='IQC') iqc,
    (select count(*)::int from finance_documents where doc_type='AP') ap,
    (select count(*)::int from production_material_issues) production_issues`)).rows[0];
}

const pool = new Pool({ connectionString: databaseUrl, max: 6, application_name: "task10-compose-smoke" });
try {
  if (phase === "initial") {
    const clean = (await pool.query("select (select count(*)::int from app_users) users,(select count(*)::int from customers) customers,(select count(*)::int from purchase_receipts) receipts,(select count(*)::int from inventory_lots) lots,(select count(*)::int from quality_inspections) inspections,(select username from app_users where role='admin' and is_active) admin_username")).rows[0];
    const adminUsername = String(clean.admin_username || ""); delete clean.admin_username; assert.ok(adminUsername); assert.deepEqual(clean, { users: 1, customers: 0, receipts: 0, lots: 0, inspections: 0 });
    const purchase = await provision(pool, "purchase"), warehouse = await provision(pool, "warehouse"), quality1 = await provision(pool, "quality1", "quality"), quality2 = await provision(pool, "quality2", "quality"), production = await provision(pool, "production"), finance = await provision(pool, "finance");
    const refs = await seedPlanning(pool, adminUsername, credentials.purchase.username);
    const main = await awardToPlan(pool, purchase, refs, refs.requests[0]), branch = await awardToPlan(pool, purchase, refs, refs.requests[1]);

    await purchase.post(`/api/procurement/delivery-plans/${main.planId}/receipts`, { quantity: "10", expected_version: 1, expected_line_version: 1, expected_balance_version: 0, supplier_lot_code: "SUP-A-20260727", reason: "TASK10 主链来料" }, 403, "task10-purchase-denied-receive");
    const received = await warehouse.post(`/api/procurement/delivery-plans/${main.planId}/receipts`, { quantity: "10", expected_version: 1, expected_line_version: 1, expected_balance_version: 0, supplier_lot_code: "SUP-A-20260727", reason: "TASK10 主链来料" }, 201, "task10-main-receipt");
    const mainReceiptId = Number(received.payload.receipt_id), mainLineId = Number(received.payload.data.lines[0].id), mainLotId = Number(received.payload.inventory_lot_id); assert.match(received.payload.lot_code, /^RML-\d{8}$/);
    let mainFact = (await pool.query("select l.lot_code,l.supplier_lot_code,l.status,l.version,b.on_hand_qty::text,b.frozen_qty::text,(b.on_hand_qty-b.reserved_qty-b.frozen_qty)::text available,b.version balance_version,(select amount::text from purchase_financial_source_entries where purchase_receipt_id=$2 and entry_type='RECEIPT') source,(select count(*)::int from quality_inspections where inventory_lot_id=l.id) iqc,(select count(*)::int from finance_documents) ap from inventory_lots l join inventory_stock_balances b on b.inventory_lot_id=l.id where l.id=$1", [mainLotId, mainReceiptId])).rows[0];
    assert.deepEqual({ ...mainFact, lot_code: "RML" }, { lot_code: "RML", supplier_lot_code: "SUP-A-20260727", status: "FROZEN", version: 1, on_hand_qty: "10.000000", frozen_qty: "10.000000", available: "0.000000", balance_version: 1, source: "120.000000", iqc: 0, ap: 0 });
    await warehouse.post("/api/quality-inspections", { inspection_type: "IQC", purchase_receipt_line_id: mainLineId, inspected_qty: "10", passed_qty: "8", failed_qty: "2", results: [{ characteristic: "综合", result: "FAIL" }] }, 403, "task10-warehouse-denied-iqc");
    const inspection = await quality1.post("/api/quality-inspections", { inspection_type: "IQC", purchase_receipt_line_id: mainLineId, inspected_qty: "10", passed_qty: "8", failed_qty: "2", responsible_stage: "IQC", results: [{ characteristic: "综合", result: "FAIL" }], defects: [{ result_line_no: 1, defect_type: "来料不良", severity: "MAJOR", quantity: "2", description: "继续隔离" }] }, 201, "task10-main-iqc");
    const inspectionId = Number(inspection.payload.inspection_id);
    await quality1.post(`/api/quality-inspections/${inspectionId}/dispositions`, { expected_version: 1, disposition_code: "RELEASE", release_qty: "8", expected_lot_version: 1, expected_balance_version: 1, reason: "本人不得放行" }, 409, "task10-self-release-denied");
    await quality2.post(`/api/quality-inspections/${inspectionId}/dispositions`, { expected_version: 1, disposition_code: "RELEASE", release_qty: "9", expected_lot_version: 1, expected_balance_version: 1, reason: "不得把可用量视为 9" }, 409, "task10-over-release-denied");
    await quality2.post(`/api/quality-inspections/${inspectionId}/dispositions`, { expected_version: 1, disposition_code: "RELEASE", release_qty: "8", expected_lot_version: 1, expected_balance_version: 1, reason: "放行合格 8" }, 200, "task10-release-eight");
    await quality1.post(`/api/quality-inspections/${inspectionId}/close`, { expected_version: 2, reason: "关闭 IQC，2 件保持冻结" }, 200, "task10-close-iqc");
    mainFact = (await pool.query("select l.status,l.version,b.on_hand_qty::text,b.frozen_qty::text,(b.on_hand_qty-b.reserved_qty-b.frozen_qty)::text available,b.version balance_version,qi.inspected_qty::text,qi.passed_qty::text,qi.failed_qty::text,qi.released_qty::text,qi.lifecycle_status,(select sum(on_hand_qty)::text from inventory_stock_balances where material_id=$2 and location_code='MAIN') aggregate_on_hand from inventory_lots l join inventory_stock_balances b on b.inventory_lot_id=l.id join quality_inspections qi on qi.inventory_lot_id=l.id where l.id=$1", [mainLotId, refs.materialId])).rows[0];
    assert.deepEqual(mainFact, { status: "FROZEN", version: 2, on_hand_qty: "10.000000", frozen_qty: "2.000000", available: "8.000000", balance_version: 2, inspected_qty: "10.000000", passed_qty: "8.000000", failed_qty: "2.000000", released_qty: "8.000000", lifecycle_status: "CLOSED", aggregate_on_hand: "10.000000" });

    await quality1.post(`/api/procurement/delivery-plans/${branch.planId}/receipts`, { quantity: "3", expected_version: 1, expected_line_version: 1, expected_balance_version: 0, supplier_lot_code: "SUP-A-REV-003", reason: "品质不得收货" }, 403, "task10-quality-denied-receive");
    const branchReceipt = await warehouse.post(`/api/procurement/delivery-plans/${branch.planId}/receipts`, { quantity: "3", expected_version: 1, expected_line_version: 1, expected_balance_version: 0, supplier_lot_code: "SUP-A-REV-003", reason: "TASK10 冲销支线来料" }, 201, "task10-branch-receipt");
    const branchReceiptId = Number(branchReceipt.payload.receipt_id), branchLotId = Number(branchReceipt.payload.inventory_lot_id);
    const reversed = await warehouse.post(`/api/procurement/fulfillment/receipts/${branchReceiptId}/reversal`, { reason: "无 IQC 全额冲销", expected_plan_version: 2, expected_lot_version: 1, expected_line_versions: [{ purchase_order_line_id: branch.lineId, expected_line_version: 2 }], expected_balance_versions: [{ material_id: refs.materialId, expected_balance_version: 1 }] }, 201, "task10-branch-reversal");
    assert.equal(reversed.payload.delivery_plan.status, "PENDING");
    const branchFact = (await pool.query("select l.status,b.on_hand_qty::text,b.frozen_qty::text,(b.on_hand_qty-b.reserved_qty-b.frozen_qty)::text available,(select count(*)::int from inventory_ledger_entries where inventory_lot_id=l.id) ledger_count,(select count(*)::int from inventory_lots where source_purchase_receipt_line_id=l.source_purchase_receipt_line_id) lot_count,(select coalesce(sum(amount),0)::text from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id where pr.id=$2 or pr.reversal_of_receipt_id=$2) source_net from inventory_lots l join inventory_stock_balances b on b.inventory_lot_id=l.id where l.id=$1", [branchLotId, branchReceiptId])).rows[0];
    assert.deepEqual(branchFact, { status: "REVERSED", on_hand_qty: "0.000000", frozen_qty: "0.000000", available: "0.000000", ledger_count: 2, lot_count: 1, source_net: "0.000000" });
    const blocked = await warehouse.post(`/api/procurement/fulfillment/receipts/${mainReceiptId}/reversal`, { reason: "已有 IQC 必须阻止", expected_plan_version: 2, expected_lot_version: 2, expected_line_versions: [{ purchase_order_line_id: main.lineId, expected_line_version: 2 }], expected_balance_versions: [{ material_id: refs.materialId, expected_balance_version: 2 }] }, 409, "task10-main-reversal-blocked"); assert.equal(blocked.payload.code, "RECEIPT_REVERSAL_BLOCKED_BY_IQC");
    await production.get("/api/inventory/lots?page_size=100"); await finance.get("/api/procurement/financial-sources?page_size=100");
    for (const path of ["/warehouse/receiving", "/quality/incoming", "/warehouse/inventory-lots", "/procurement/fulfillment"]) assert.equal((await fetch(`${base}${path}`)).status, 200, path);
    assert.deepEqual(await facts(pool), { migrations: 34, awards: 2, purchase_orders: 2, receipts: 2, lots: 2, iqc: 1, ap: 0, production_issues: 0 });
    console.info(JSON.stringify({ ok: true, phase, main: { award_id: main.awardId, po_id: main.poId, plan_id: main.planId, receipt_id: mainReceiptId, lot_id: mainLotId, inspection_id: inspectionId, on_hand: "10.000000", frozen: "2.000000", available: "8.000000", source: "120.000000" }, reversal: { award_id: branch.awardId, po_id: branch.poId, plan_id: branch.planId, receipt_id: branchReceiptId, lot_id: branchLotId, status: "REVERSED" }, ap: 0, production_issues: 0, pages: 4 }));
  } else if (["restart", "restore"].includes(phase)) {
    for (const roleName of Object.keys(credentials)) { const actor = client(); await actor.login(credentials[roleName].username, credentials[roleName].password); await actor.get(roleName.startsWith("quality") ? "/api/quality/source-options?inspection_type=IQC" : roleName === "finance" ? "/api/procurement/financial-sources?page_size=100" : "/api/inventory/lots?page_size=100"); }
    const durable = await facts(pool); assert.deepEqual(durable, { migrations: 34, awards: 2, purchase_orders: 2, receipts: 2, lots: 2, iqc: 1, ap: 0, production_issues: 0 });
    const balances = (await pool.query("select l.status,b.on_hand_qty::text,b.frozen_qty::text,(b.on_hand_qty-b.reserved_qty-b.frozen_qty)::text available from inventory_lots l join inventory_stock_balances b on b.inventory_lot_id=l.id order by l.id")).rows; assert.deepEqual(balances, [{ status: "FROZEN", on_hand_qty: "10.000000", frozen_qty: "2.000000", available: "8.000000" }, { status: "REVERSED", on_hand_qty: "0.000000", frozen_qty: "0.000000", available: "0.000000" }]);
    console.info(JSON.stringify({ ok: true, phase, ...durable, durable: true, balances }));
  } else throw new Error(`unsupported ERP_TASK10_SMOKE_PHASE: ${phase}`);
} finally { await pool.end(); }
