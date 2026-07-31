import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_TASK10_SMOKE_PHASE || "initial";
if (process.env.ERP_TASK10_ACCEPTANCE_CONFIRM !== "PARALLEL_SYNTHETIC_ONLY" || process.env.ERP_ENV === "production" || !/@postgres(?::5432)?\/chenyida_erp$/i.test(databaseUrl)) {
  throw new Error("TASK10 smoke requires the explicitly confirmed parallel synthetic database");
}
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "task10-finance-project-settlement-compose-smoke" });

function httpClient() {
  const cookies = new Map();
  let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";");
      const split = pair.indexOf("=");
      if (/Max-Age=0/i.test(value)) cookies.delete(pair.slice(0, split));
      else cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const payload = await response.json();
    if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    return { response, payload };
  }
  return {
    login: async (username, password) => {
      const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      csrf = result.payload.csrf_token;
      return result;
    },
    get: (path, status = 200) => request(path, {}, status),
    write: (path, body, status = 200, key = randomUUID()) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, status),
  };
}

async function provision(role) {
  const username = `task10${role}`;
  const password = `Aa9!${randomUUID()}`;
  const client = httpClient();
  await pool.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$2,$3,$4,true,false,1)", [username, `TASK10 ${role}`, role, await hashPassword(password)]);
  await client.login(username, password);
  return { username, client };
}

async function seed(admin, production) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('cyd.production_service_write','allowed',true),set_config('cyd.project_service_write','allowed',true),set_config('cyd.planning_service_write','allowed',true)");
    const unit = (await db.query("insert into units(code,name,symbol,unit_type,enabled) values('T10PCS','TASK10 件','T10PCS','COUNT',true) returning id")).rows[0];
    const category = (await db.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('TASK10','TASK10 合成物料',4,'ACTIVE',$1,$1,$2) returning id", [admin, randomUUID()])).rows[0];
    const materials = (await db.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values
      ('CYD-T10-RAW','TASK10 原材料',$1,'T10PCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL',$3,$3,$3,$4),
      ('CYD-T10-RAW2','TASK10 辅料',$1,'T10PCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL',$3,$3,$3,$5),
      ('CYD-T10-FG','TASK10 成品',$1,'T10PCS',$2,'ACTIVE','MAKE','STOCKED','FQC','ROHS','MANUAL',$3,$3,$3,$6) returning id,internal_material_code`, [category.id, unit.id, admin, randomUUID(), randomUUID(), randomUUID()])).rows;
    const raw = materials.find((row) => row.internal_material_code === "CYD-T10-RAW");
    const purchaseMaterial = materials.find((row) => row.internal_material_code === "CYD-T10-RAW2");
    const finished = materials.find((row) => row.internal_material_code === "CYD-T10-FG");
    const customer = (await db.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-T10','TASK10 客户','TASK10 客户','ACTIVE',$1,$1,$2) returning id", [admin, randomUUID()])).rows[0];
    const product = (await db.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values('PRD-T10','TASK10 产品',$1,'ACTIVE',$2,$2,$3) returning id", [customer.id, admin, randomUUID()])).rows[0];
    const productVersion = (await db.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,released_by,released_at,created_by,updated_by,request_id) values($1,1,'A0','RELEASED','ASSEMBLY','MASS',$2,now(),$2,$2,$3) returning id", [product.id, admin, randomUUID()])).rows[0];
    const bomHeader = (await db.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values('BOM-T10',$1,'ACTIVE',$2,$2,$3) returning id", [product.id, admin, randomUUID()])).rows[0];
    const bomVersion = (await db.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,created_by,updated_by,request_id) values($1,$2,1,'A0','DRAFT',$3,$3,$4) returning id", [bomHeader.id, productVersion.id, admin, randomUUID()])).rows[0];
    const bomLine = (await db.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,created_by,updated_by,request_id) values($1,1,$2,1,$3,0,'ASSEMBLY',$4,$4,$5) returning id", [bomVersion.id, raw.id, unit.id, admin, randomUUID()])).rows[0];
    await db.query("update bom_versions set status='RELEASED',released_by=$2,released_at=now() where id=$1", [bomVersion.id, admin]);
    const workOrder = (await db.query("insert into production_work_orders(work_order_code,product_id,product_version_id,bom_version_id,finished_material_id,finished_unit_id,planned_qty,status,owner,operation_id,created_by,request_id) values('WO-T10',$1,$2,$3,$4,$5,10,'IN_PROGRESS',$6,$7,$6,$8) returning id", [product.id, productVersion.id, bomVersion.id, finished.id, unit.id, production, randomUUID(), randomUUID()])).rows[0];
    const snapshot = (await db.query("insert into production_bom_snapshots(work_order_id,bom_header_id,bom_version_id,product_version_id,released_by,request_id) values($1,$2,$3,$4,$5,$6) returning id", [workOrder.id, bomHeader.id, bomVersion.id, productVersion.id, admin, randomUUID()])).rows[0];
    const snapshotLine = (await db.query("insert into production_bom_snapshot_lines(snapshot_id,source_bom_line_id,line_no,material_id,quantity_per,loss_rate,unit_id,process_stage) values($1,$2,1,$3,1,0,$4,'ASSEMBLY') returning id", [snapshot.id, bomLine.id, raw.id, unit.id])).rows[0];
    await db.query("insert into production_material_requirements(work_order_id,snapshot_line_id,material_id,unit_id,required_qty,net_issued_qty) values($1,$2,$3,$4,10,10)", [workOrder.id, snapshotLine.id, raw.id, unit.id]);
    await db.query("set local session_replication_role=replica");
    const digest = "f".repeat(64);
    const project = (await db.query("insert into business_projects(project_code,customer_id,project_name,project_goal,market_owner,project_owner,status,request_id,created_by) values('PRJ-10000010',$1,'TASK10 完整项目','收付款与项目收支追溯',$2,$2,'ACCEPTED',$3,$2) returning id", [customer.id, admin, randomUUID()])).rows[0];
    const requirement = (await db.query("insert into project_requirement_versions(project_id,version_no,customer_requirement_summary,quantity_requirement,quantity_unit,content_digest,created_by) values($1,1,'TASK10 合成需求',10,'T10PCS',$2,$3) returning id", [project.id, digest, admin])).rows[0];
    const requirementItem = (await db.query("insert into project_requirement_items(requirement_version_id,line_no,provisional_name,quantity,unit_id,unit_pending,product_id) values($1,1,'TASK10 产品',10,$2,false,$3) returning id", [requirement.id, unit.id, product.id])).rows[0];
    const unitResolution = (await db.query("insert into project_requirement_unit_resolution_versions(project_id,requirement_version_id,requirement_item_id,resolution_version_no,unit_id,source_type,resolved_by,request_id,content_digest) values($1,$2,$3,1,$4,'REQUIREMENT_DECLARED',$5,$6,$7) returning id", [project.id, requirement.id, requirementItem.id, unit.id, admin, randomUUID(), digest])).rows[0];
    await db.query("insert into project_requirement_unit_resolution_heads(requirement_item_id,project_id,requirement_version_id,current_resolution_id,version) values($1,$2,$3,$4,1)", [requirementItem.id, project.id, requirement.id, unitResolution.id]);
    const planningPackage = (await db.query("insert into project_planning_packages(project_id,package_version_no,requirement_version_id,status,package_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,request_id) values($1,1,$2,'ACCEPTED',$3,$4,$4,now(),$4,now(),$5) returning id", [project.id, requirement.id, digest, admin, randomUUID()])).rows[0];
    const packageItem = (await db.query("insert into project_planning_package_items(package_id,requirement_item_id,product_version_id,bom_version_id,required_quantity,unit_id,unit_resolution_id,line_no,source_digest) values($1,$2,$3,$4,10,$5,$6,1,$7) returning id", [planningPackage.id, requirementItem.id, productVersion.id, bomVersion.id, unit.id, unitResolution.id, digest])).rows[0];
    const productionHandoff = (await db.query("insert into production_handoffs(handoff_code,planning_package_id,handoff_version_no,status,source_package_version,source_package_digest,source_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,request_id) values('PHO-T10',$1,1,'ACCEPTED',1,$2,$2,$3,$3,now(),$3,now(),$4) returning id", [planningPackage.id, digest, admin, randomUUID()])).rows[0];
    const handoffItem = (await db.query("insert into production_handoff_items(handoff_id,planning_package_item_id,product_id,product_version_id,bom_version_id,finished_material_id,finished_unit_id,planned_quantity,line_no,source_digest) values($1,$2,$3,$4,$5,$6,$7,10,1,$8) returning id", [productionHandoff.id, packageItem.id, product.id, productVersion.id, bomVersion.id, finished.id, unit.id, digest])).rows[0];
    await db.query("insert into production_handoff_work_order_links(handoff_item_id,work_order_id,source_digest,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6)", [handoffItem.id, workOrder.id, digest, randomUUID(), admin, randomUUID()]);

    const supplier = (await db.query("insert into suppliers(supplier_code,supplier_name,normalized_name,status,created_by,updated_by,request_id) values('SUP-T10','TASK10 供应商','TASK10 供应商','ACTIVE',$1,$1,$2) returning id", [admin, randomUUID()])).rows[0];
    const plan = (await db.query("insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,submitted_by,submitted_at,accepted_by,accepted_at,request_id) values($1,$2,1,current_date,'ACCEPTED',1,$3,$3,$4,$4,now(),$4,now(),$5) returning id", [project.id, planningPackage.id, digest, admin, randomUUID()])).rows[0];
    const planLines = (await db.query(`insert into planning_material_requirement_lines(plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest) values
      ($1,1,$2,$4,'{}',$5,4,0,0,0,0,4,$5),
      ($1,2,$3,$4,'{}',$5,6,0,0,0,0,6,$5) returning id,material_id`, [plan.id, raw.id, purchaseMaterial.id, unit.id, digest])).rows;
    const purchaseRequest = (await db.query("insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,submitted_at,accepted_by,accepted_at,request_id) values('PRQ-10000010',$1,'ACCEPTED',$2,now(),$2,now(),$3) returning id", [plan.id, admin, randomUUID()])).rows[0];
    const requestLines = (await db.query(`insert into planning_purchase_request_lines(purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity) values
      ($1,$2,1,$4,$6,4),($1,$3,2,$5,$6,6) returning id,material_id`, [purchaseRequest.id, planLines[0].id, planLines[1].id, raw.id, purchaseMaterial.id, unit.id])).rows;
    const rfq = (await db.query("insert into procurement_rfqs(rfq_code,purchase_request_id,round_no,status,response_deadline,currency_code,source_purchase_request_version,source_digest,request_id,created_by,issued_by,issued_at) values('RFQ-10000010',$1,1,'ISSUED',current_date,'CNY',1,$2,$3,$4,$4,now()) returning id", [purchaseRequest.id, digest, randomUUID(), admin])).rows[0];
    const rfqLines = (await db.query(`insert into procurement_rfq_lines(rfq_id,purchase_request_line_id,material_id,unit_id,requested_quantity,required_date,line_no,source_digest) values
      ($1,$2,$4,$6,4,current_date,1,$7),($1,$3,$5,$6,6,current_date,2,$7) returning id,material_id`, [rfq.id, requestLines[0].id, requestLines[1].id, raw.id, purchaseMaterial.id, unit.id, digest])).rows;
    await db.query("insert into procurement_rfq_suppliers(rfq_id,supplier_id,status,invited_by,responded_at,supplier_mapping_digest) values($1,$2,'RESPONDED',$3,now(),$4)", [rfq.id, supplier.id, admin, digest]);
    const quote = (await db.query("insert into procurement_supplier_quotes(rfq_id,supplier_id,quote_version_no,supplier_quote_reference,status,currency_code,valid_until,tax_included,freight_included,payment_terms,quote_digest,recorded_by,request_id) values($1,$2,1,'TASK10-QUOTE','SUBMITTED','CNY',current_date+30,true,true,'TASK10 合成账期',$3,$4,$5) returning id", [rfq.id, supplier.id, digest, admin, randomUUID()])).rows[0];
    const quoteLines = (await db.query(`insert into procurement_supplier_quote_lines(quote_id,rfq_line_id,material_id,unit_id,quoted_quantity,minimum_order_quantity,unit_price,lead_time_days,promised_delivery_date,line_digest) values
      ($1,$2,$4,$6,4,1,12,0,current_date,$7),($1,$3,$5,$6,6,1,12,0,current_date,$7) returning id,rfq_line_id`, [quote.id, rfqLines[0].id, rfqLines[1].id, raw.id, purchaseMaterial.id, unit.id, digest])).rows;
    const comparisons = [];
    for (const [index, rfqLine] of rfqLines.entries()) {
      const comparison = (await db.query("insert into procurement_quote_comparisons(rfq_id,rfq_line_id,comparison_version_no,basis_digest,generated_by,request_id) values($1,$2,1,$3,$4,$5) returning id", [rfq.id, rfqLine.id, digest, admin, randomUUID()])).rows[0];
      await db.query("insert into procurement_quote_comparison_lines(comparison_id,quote_line_id,supplier_id,currency_code,unit_id,tax_included,freight_included,unit_price,minimum_order_quantity,promised_delivery_date,price_rank,lowest_price,moq_satisfied,delivery_status,quote_expired,comparable_status,reason_code,awardable) values($1,$2,$3,'CNY',$4,true,true,12,1,current_date,1,true,true,'ON_TIME',false,'COMPARABLE','OK',true)", [comparison.id, quoteLines[index].id, supplier.id, unit.id]);
      comparisons.push(comparison);
    }
    const award = (await db.query("insert into procurement_sourcing_awards(rfq_id,status,award_digest,selected_by,reason_code,reason,request_id) values($1,'AWARDED',$2,$3,'SYNTHETIC','TASK10 合成定标',$4) returning id", [rfq.id, digest, admin, randomUUID()])).rows[0];
    const awardLines = (await db.query(`insert into procurement_sourcing_award_lines(award_id,rfq_line_id,comparison_id,selected_quote_line_id,supplier_id,selected_quantity,selected_unit_price,required_date,promised_delivery_date,selection_reason) values
      ($1,$2,$4,$6,$8,4,12,current_date,current_date,'TASK10 AP48'),
      ($1,$3,$5,$7,$8,6,12,current_date,current_date,'TASK10 AP72') returning id`, [award.id, rfqLines[0].id, rfqLines[1].id, comparisons[0].id, comparisons[1].id, quoteLines[0].id, quoteLines[1].id, supplier.id])).rows;
    const mappings = [];
    for (const [index, material] of [raw, purchaseMaterial].entries()) {
      const mapping = (await db.query("insert into supplier_mappings(material_id,supplier_name,supplier_key,supplier_item_code,supplier_item_name,purchase_uom,status,valid_from,created_by,updated_by,request_id) values($1,'TASK10 供应商','TASK10 供应商',$2,$3,'T10PCS','ACTIVE',now(),$4,$4,$5) returning id", [material.id, `T10-SUP-${index + 1}`, `TASK10 物料 ${index + 1}`, admin, randomUUID()])).rows[0];
      mappings.push(mapping);
    }
    const purchaseSources = [];
    for (const [index, quantity] of [4, 6].entries()) {
      const amount = quantity * 12; const material = index === 0 ? raw : purchaseMaterial;
      const po = (await db.query("insert into purchase_orders(po_code,supplier_id,status,currency_code,operation_id,created_by,request_id) values($1,$2,'RECEIVED','CNY',$3,$4,$5) returning id", [`PO-T10-${amount}`, supplier.id, randomUUID(), admin, randomUUID()])).rows[0];
      const poLine = (await db.query("insert into purchase_order_lines(purchase_order_id,line_no,material_id,unit_id,supplier_mapping_id,order_qty,unit_price,received_qty,status) values($1,1,$2,$3,$4,$5,12,$5,'RECEIVED') returning id", [po.id, material.id, unit.id, mappings[index].id, quantity])).rows[0];
      await db.query("insert into procurement_award_po_line_links(award_id,award_line_id,purchase_order_id,purchase_order_line_id,source_digest,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)", [award.id, awardLines[index].id, po.id, poLine.id, digest, randomUUID(), admin, randomUUID()]);
      const delivery = (await db.query("insert into purchase_delivery_plans(purchase_order_id,purchase_order_line_id,supplier_id,material_id,unit_id,planned_quantity,received_quantity,promised_delivery_date,status,created_by,updated_by,request_id) values($1,$2,$3,$4,$5,$6,$6,current_date,'COMPLETED',$7,$7,$8) returning id", [po.id, poLine.id, supplier.id, material.id, unit.id, quantity, admin, randomUUID()])).rows[0];
      const adjustment = (await db.query("insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id) values($1,'RECEIPT','TASK10 合成采购收货',$2,$3,$4) returning id", [`ADJ-T10-${amount}`, randomUUID(), admin, randomUUID()])).rows[0];
      const balance = (await db.query("insert into inventory_stock_balances(material_id,unit_id,on_hand_qty,reserved_qty,frozen_qty,version) values($1,$2,$3,0,0,1) returning id", [material.id, unit.id, quantity])).rows[0];
      const ledger = (await db.query("insert into inventory_ledger_entries(operation_id,adjustment_id,line_no,balance_id,material_id,unit_id,entry_type,on_hand_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after,source_id,created_by,request_id) values($1,$2,1,$3,$4,$5,'RECEIPT',$6,0,$6,0,0,0,1,$2,$7,$8) returning id", [randomUUID(), adjustment.id, balance.id, material.id, unit.id, quantity, admin, randomUUID()])).rows[0];
      const receipt = (await db.query("insert into purchase_receipts(receipt_code,purchase_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values($1,$2,$3,'TASK10 合成采购收货',$4,$5,$6) returning id", [`RCPT-T10-${amount}`, po.id, adjustment.id, randomUUID(), admin, randomUUID()])).rows[0];
      const receiptLine = (await db.query("insert into purchase_receipt_lines(purchase_receipt_id,line_no,purchase_order_line_id,material_id,unit_id,quantity,inventory_ledger_entry_id,line_amount) values($1,1,$2,$3,$4,$5,$6,$7) returning id", [receipt.id, poLine.id, material.id, unit.id, quantity, ledger.id, amount])).rows[0];
      await db.query("insert into purchase_receipt_delivery_allocations(purchase_receipt_line_id,delivery_plan_id,quantity,created_by,request_id) values($1,$2,$3,$4,$5)", [receiptLine.id, delivery.id, quantity, admin, randomUUID()]);
      const source = (await db.query("insert into purchase_financial_source_entries(purchase_receipt_id,supplier_id,entry_type,amount,currency_code,source_id) values($1,$2,'RECEIPT',$3,'CNY',$4) returning id", [receipt.id, supplier.id, amount, randomUUID()])).rows[0];
      purchaseSources.push(Number(source.id));
    }
    await db.query("commit");
    return { unitId: Number(unit.id), finishedId: Number(finished.id), customerId: Number(customer.id), productId: Number(product.id), productVersionId: Number(productVersion.id), workOrderId: Number(workOrder.id), projectId: Number(project.id), purchaseSourceIds: purchaseSources };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

async function releaseFqc(quality, manager, allocationId, quantity, key) {
  const created = await quality.client.write("/api/quality-inspections", { inspection_type: "FQC", allocation_id: allocationId, inspected_qty: String(quantity), passed_qty: String(quantity), failed_qty: "0", results: [{ characteristic: "最终检验", result: "PASS" }] }, 201, `${key}-create`);
  const inspectionId = Number(created.payload.inspection_id);
  await manager.client.write(`/api/quality-inspections/${inspectionId}/dispositions`, { expected_version: 1, disposition_code: "RELEASE", release_qty: String(quantity), reason: "TASK10 FQC 放行" }, 200, `${key}-release`);
  await quality.client.write(`/api/quality-inspections/${inspectionId}/close`, { expected_version: 2, reason: "TASK10 FQC 关闭" }, 200, `${key}-close`);
  return inspectionId;
}

async function cleanSynthetic() {
  const admin = (await pool.query("select username from app_users where role='admin' and is_active order by username limit 1")).rows[0]?.username;
  if (!admin) throw new Error("active admin is required for cleanup");
  const names = (await pool.query("select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','app_meta','app_users') order by tablename")).rows.map((row) => `"${String(row.tablename).replaceAll('"', '""')}"`);
  if (names.length) await pool.query(`truncate table ${names.join(",")} restart identity cascade`);
  await pool.query("delete from app_users where username<>$1", [admin]);
  return admin;
}

try {
  if (phase === "initial") {
    const baseline = (await pool.query("select (select count(*)::int from schema_migrations) migrations,(select count(*)::int from app_users) users,(select count(*)::int from sales_orders) sales_orders,(select count(*)::int from sales_shipments) shipments,(select count(*)::int from finance_documents) finance")).rows[0];
    assert.deepEqual(baseline, { migrations: 24, users: 1, sales_orders: 0, shipments: 0, finance: 0 });
    const admin = (await pool.query("select username from app_users where role='admin' and is_active order by username limit 1")).rows[0].username;
    const production = await provision("production");
    const warehouse = await provision("warehouse");
    const sales = await provision("sales");
    const quality = await provision("quality");
    const manager = await provision("manager");
    const finance = await provision("finance");
    const purchase = await provision("purchase");
    const refs = await seed(admin, production.username);
    const ap48 = await finance.client.write("/api/finance/documents", { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceIds[0] }, 201, "task10-ap-48");
    const ap72 = await finance.client.write("/api/finance/documents", { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceIds[1] }, 201, "task10-ap-72");
    assert.deepEqual([ap48.payload.data.total_amount, ap72.payload.data.total_amount], ["48.000000", "72.000000"]);

    const report4 = await production.client.write("/api/production/reports", { work_order_id: refs.workOrderId, expected_version: 1, reported_qty: "4", good_qty: "4", scrap_qty: "0", process_stage: "ASSEMBLY", operator: production.username }, 201, "task10-report-4");
    const completion4 = await warehouse.client.write("/api/production/completions", { work_order_id: refs.workOrderId, expected_version: 2, expected_balance_version: 0, reason: "TASK10 完工 4", allocations: [{ report_id: Number(report4.payload.data.id), quantity: "4", expected_report_version: 1 }] }, 201, "task10-completion-4");
    const report6 = await production.client.write("/api/production/reports", { work_order_id: refs.workOrderId, expected_version: 3, reported_qty: "6", good_qty: "6", scrap_qty: "0", process_stage: "ASSEMBLY", operator: production.username }, 201, "task10-report-6");
    const completion6 = await warehouse.client.write("/api/production/completions", { work_order_id: refs.workOrderId, expected_version: 4, expected_balance_version: 1, reason: "TASK10 完工 6", allocations: [{ report_id: Number(report6.payload.data.id), quantity: "6", expected_report_version: 1 }] }, 201, "task10-completion-6");
    assert.deepEqual([completion4.payload.data.work_order.completed_qty, completion6.payload.data.work_order.completed_qty], ["4.000000", "10.000000"]);
    const completionLines = (await pool.query("select pcl.id,pcl.quantity::text from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id where pc.work_order_id=$1 order by pcl.id", [refs.workOrderId])).rows;

    const order = await sales.client.write("/api/sales-orders", { customer_id: refs.customerId, currency_code: "CNY", owner: sales.username, remark: "TASK10 SO 10 × 20", lines: [{ product_id: refs.productId, product_version_id: refs.productVersionId, finished_material_id: refs.finishedId, unit_id: refs.unitId, quantity: "10", unit_price: "20" }] }, 201, "task10-sales-order");
    const orderId = Number(order.payload.data.id);
    const orderLineId = Number(order.payload.data.current_version.lines[0].id);
    const allocation4 = await sales.client.write("/api/quality/finished-goods-allocations", { completion_line_id: Number(completionLines[0].id), sales_order_line_id: orderLineId, quantity: "4", expected_completion_version: 1, expected_sales_order_line_version: 1 }, 201, "task10-allocation-4");
    const allocation6 = await sales.client.write("/api/quality/finished-goods-allocations", { completion_line_id: Number(completionLines[1].id), sales_order_line_id: orderLineId, quantity: "6", expected_completion_version: 1, expected_sales_order_line_version: 1 }, 201, "task10-allocation-6");
    const fqc4 = await releaseFqc(quality, manager, Number(allocation4.payload.allocation_id), 4, "task10-fqc-4");
    const fqc6 = await releaseFqc(quality, manager, Number(allocation6.payload.allocation_id), 6, "task10-fqc-6");

    const instructionBody = { sales_order_id: orderId, expected_order_version: 1, receiver: "TASK10 收货人", shipping_address: "TASK10 收货地址", contact_info: "TASK10", lines: [{ sales_order_line_id: orderLineId, quantity: "10", expected_line_version: 1 }] };
    const instruction = await sales.client.write("/api/delivery-instructions", instructionBody, 201, "task10-delivery-create");
    const instructionId = Number(instruction.payload.delivery_instruction_id);
    const untouched = (await pool.query("select (select count(*)::int from sales_shipments) shipments,(select on_hand_qty::text from inventory_stock_balances where material_id=$1) inventory,(select count(*)::int from sales_shipment_line_fqc_allocations) fqc_consumptions,(select count(*)::int from sales_financial_source_entries) sources,(select count(*)::int from finance_documents where doc_type='AR') ar", [refs.finishedId])).rows[0];
    assert.deepEqual(untouched, { shipments: 0, inventory: "10.000000", fqc_consumptions: 0, sources: 0, ar: 0 });
    const instructionReplay = await sales.client.write("/api/delivery-instructions", instructionBody, 201, "task10-delivery-create");
    assert.equal(instructionReplay.response.headers.get("Idempotency-Replayed"), "true");
    await sales.client.write(`/api/delivery-instructions/${instructionId}/submit`, { expected_version: 1, reason: "" }, 200, "task10-delivery-submit");
    await warehouse.client.write(`/api/delivery-instructions/${instructionId}/accept`, { expected_version: 2, reason: "" }, 200, "task10-delivery-accept");
    let detail = await warehouse.client.get(`/api/delivery-instructions/${instructionId}`);
    const instructionLineId = Number(detail.payload.data.lines[0].id);
    await quality.client.write(`/api/delivery-instructions/${instructionId}/execute`, { expected_instruction_version: 3, expected_sales_order_version: 1, reason: "越权", lines: [{ instruction_line_id: instructionLineId, quantity: "4", expected_line_version: 1, expected_sales_order_line_version: 1, expected_balance_version: 2 }] }, 403, "task10-quality-execute-denied");

    const firstBody = { expected_instruction_version: 3, expected_sales_order_version: 1, reason: "TASK10 第一批 4", lines: [{ instruction_line_id: instructionLineId, quantity: "4", expected_line_version: 1, expected_sales_order_line_version: 1, expected_balance_version: 2 }] };
    const first = await warehouse.client.write(`/api/delivery-instructions/${instructionId}/execute`, firstBody, 201, "task10-shipment-4");
    assert.equal(first.payload.data.financial_source.amount, "80.000000");
    const firstReplay = await warehouse.client.write(`/api/delivery-instructions/${instructionId}/execute`, firstBody, 201, "task10-shipment-4");
    assert.equal(firstReplay.response.headers.get("Idempotency-Replayed"), "true");
    const after4 = (await pool.query("select (select on_hand_qty::text from inventory_stock_balances where material_id=$1) inventory,(select shipped_qty::text from sales_order_lines where id=$2) shipped,(select status from sales_delivery_instructions where id=$3) instruction_status,(select coalesce(sum(qi.released_qty),0)-coalesce(sum(c.consumed),0) from quality_inspections qi left join lateral(select sum(case when a.entry_type='SHIPMENT' then a.quantity else -a.quantity end) consumed from sales_shipment_line_fqc_allocations a where a.quality_inspection_id=qi.id)c on true where qi.id=any($4::bigint[]))::text fqc_available", [refs.finishedId, orderLineId, instructionId, [fqc4, fqc6]])).rows[0];
    assert.deepEqual(after4, { inventory: "6.000000", shipped: "4.000000", instruction_status: "PARTIAL", fqc_available: "6.000000" });
    const firstSourceId = Number(first.payload.data.financial_source.id);
    const ar80 = await finance.client.write("/api/finance/documents", { doc_type: "AR", sales_source_entry_id: firstSourceId }, 201, "task10-ar-80");
    assert.equal(ar80.payload.data.total_amount, "80.000000");
    await warehouse.client.write(`/api/shipments/${first.payload.shipment_id}/reversal`, { reason: "AR 后冲销应阻止", expected_balance_versions: [{ material_id: refs.finishedId, expected_balance_version: 3 }] }, 409, "task10-ar-reversal-gate");

    detail = await warehouse.client.get(`/api/delivery-instructions/${instructionId}`);
    const second = await warehouse.client.write(`/api/delivery-instructions/${instructionId}/execute`, { expected_instruction_version: Number(detail.payload.data.header.version), expected_sales_order_version: Number(detail.payload.data.header.sales_order_version), reason: "TASK10 第二批 6", lines: [{ instruction_line_id: instructionLineId, quantity: "6", expected_line_version: Number(detail.payload.data.lines[0].version), expected_sales_order_line_version: Number(detail.payload.data.lines[0].sales_order_line_version), expected_balance_version: Number(detail.payload.data.lines[0].balance_version) }] }, 201, "task10-shipment-6");
    assert.equal(second.payload.data.financial_source.amount, "120.000000");
    const ar120 = await finance.client.write("/api/finance/documents", { doc_type: "AR", sales_source_entry_id: Number(second.payload.data.financial_source.id) }, 201, "task10-ar-120");
    assert.equal(ar120.payload.data.total_amount, "120.000000");

    await finance.client.write("/api/finance/settlements", { document_id: Number(ar80.payload.doc_id), expected_version: 1, settlement_type: "PAYMENT", amount: "1", accounting_date: "2026-07-26", account_name: "TASK10 内部户" }, 422, "task10-wrong-ar-payment");
    await finance.client.write("/api/finance/settlements", { document_id: Number(ap48.payload.doc_id), expected_version: 1, settlement_type: "RECEIPT", amount: "1", accounting_date: "2026-07-26", account_name: "TASK10 内部户" }, 422, "task10-wrong-ap-receipt");
    for (const [marker, value] of [["zero", "0"], ["negative", "-1"], ["over", "81"]]) await finance.client.write("/api/finance/settlements", { document_id: Number(ar80.payload.doc_id), expected_version: 1, settlement_type: "RECEIPT", amount: value, accounting_date: "2026-07-26", account_name: "TASK10 内部户" }, value === "81" ? 409 : 400, `task10-${marker}-receipt`);
    await sales.client.write("/api/finance/settlements", { document_id: Number(ar80.payload.doc_id), expected_version: 1, settlement_type: "RECEIPT", amount: "1", accounting_date: "2026-07-26", account_name: "越权户" }, 403, "task10-sales-write-denied");
    await purchase.client.write("/api/finance/settlements", { document_id: Number(ap48.payload.doc_id), expected_version: 1, settlement_type: "PAYMENT", amount: "1", accounting_date: "2026-07-26", account_name: "越权户" }, 403, "task10-purchase-write-denied");
    const receipt30Body = { document_id: Number(ar80.payload.doc_id), expected_version: 1, settlement_type: "RECEIPT", amount: "30", accounting_date: "2026-07-26", account_name: "TASK10 内部户", reason: "AR80 首笔" };
    const receipt30 = await finance.client.write("/api/finance/settlements", receipt30Body, 201, "task10-receipt-30");
    assert.deepEqual([receipt30.payload.doc_status, receipt30.payload.settled_amount], ["PARTIALLY_SETTLED", "30.000000"]);
    const receipt30Replay = await finance.client.write("/api/finance/settlements", receipt30Body, 201, "task10-receipt-30");
    assert.equal(receipt30Replay.response.headers.get("Idempotency-Replayed"), "true");
    await finance.client.write("/api/finance/settlements", { ...receipt30Body, amount: "31" }, 409, "task10-receipt-30");
    const receipt50 = await finance.client.write("/api/finance/settlements", { ...receipt30Body, expected_version: 2, amount: "50", reason: "AR80 尾款" }, 201, "task10-receipt-50");
    assert.deepEqual([receipt50.payload.doc_status, receipt50.payload.settled_amount], ["SETTLED", "80.000000"]);
    const receipt120 = await finance.client.write("/api/finance/settlements", { document_id: Number(ar120.payload.doc_id), expected_version: 1, settlement_type: "RECEIPT", amount: "120", accounting_date: "2026-07-26", account_name: "TASK10 内部户", reason: "AR120 全收" }, 201, "task10-receipt-120");
    assert.equal(receipt120.payload.doc_status, "SETTLED");
    const payment48 = await finance.client.write("/api/finance/settlements", { document_id: Number(ap48.payload.doc_id), expected_version: 1, settlement_type: "PAYMENT", amount: "48", accounting_date: "2026-07-26", account_name: "TASK10 内部户", reason: "AP48 全付" }, 201, "task10-payment-48");
    assert.equal(payment48.payload.doc_status, "SETTLED");
    const payment30 = await finance.client.write("/api/finance/settlements", { document_id: Number(ap72.payload.doc_id), expected_version: 1, settlement_type: "PAYMENT", amount: "30", accounting_date: "2026-07-26", account_name: "TASK10 内部户", reason: "AP72 首笔" }, 201, "task10-payment-30");
    assert.equal(payment30.payload.doc_status, "PARTIALLY_SETTLED");
    const payment42 = await finance.client.write("/api/finance/settlements", { document_id: Number(ap72.payload.doc_id), expected_version: 2, settlement_type: "PAYMENT", amount: "42", accounting_date: "2026-07-26", account_name: "TASK10 内部户", reason: "AP72 尾款" }, 201, "task10-payment-42");
    assert.equal(payment42.payload.doc_status, "SETTLED");
    const projectSummary = await finance.client.get("/api/finance/projects?currency=CNY");
    assert.equal(projectSummary.payload.rows.length, 1);
    assert.equal(projectSummary.payload.rows[0].project_code, "PRJ-10000010");
    assert.deepEqual(projectSummary.payload.rows[0], { ...projectSummary.payload.rows[0], sales_source_amount: "200.000000", purchase_source_amount: "120.000000", ar_total: "200.000000", ar_settled: "200.000000", ar_outstanding: "0.000000", ap_total: "120.000000", ap_settled: "120.000000", ap_outstanding: "0.000000", customer_receipts: "200.000000", supplier_payments: "120.000000", net_cash: "80.000000", transaction_contribution: "80.000000", unattributed_amount: "0" });

    for (const path of ["/sales/delivery", "/warehouse/shipping", "/finance/receivables", "/finance/settlements", "/finance/projects"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
    }
    const totals = (await pool.query(`select
      (select count(*)::int from schema_migrations) migrations,
      (select status from sales_delivery_instructions where id=$1) instruction_status,
      (select status from sales_orders where id=$2) order_status,
      (select array_agg(sl.quantity::text order by sl.id) from sales_shipment_lines sl join sales_shipments sh on sh.id=sl.shipment_id where sh.shipment_type='SHIPMENT') shipment_quantities,
      (select array_agg(a.quantity::text order by a.id) from sales_shipment_line_fqc_allocations a where a.entry_type='SHIPMENT') fqc_consumptions,
      (select coalesce(sum(l.on_hand_delta),0)::text from inventory_ledger_entries l join sales_shipment_lines sl on sl.inventory_ledger_entry_id=l.id join sales_shipments sh on sh.id=sl.shipment_id where sh.shipment_type='SHIPMENT') inventory_ledger,
      (select on_hand_qty::text from inventory_stock_balances where material_id=$3) inventory,
      (select array_agg(amount::text order by id) from sales_financial_source_entries where entry_type='SHIPMENT') sources,
      (select array_agg(total_amount::text order by id) from finance_documents where doc_type='AR') ar,
      (select array_agg(total_amount::text order by id) from finance_documents where doc_type='AP') ap,
      (select array_agg(amount::text order by id) from finance_settlements) settlement_amounts,
      (select array_agg(settlement_type order by id) from finance_settlements) settlement_types,
      (select count(*)::int from finance_settlements where settlement_type like '%REVERSAL') reversals,
      (select count(*)::int from finance_project_source_allocations) allocations,
      (select count(distinct project_id)::int from finance_project_source_allocations where project_id is not null) allocation_projects,
      (select coalesce(sum(total_amount-settled_amount),0)::text from finance_documents where doc_type='AR') ar_outstanding,
      (select coalesce(sum(total_amount-settled_amount),0)::text from finance_documents where doc_type='AP') ap_outstanding,
      (select count(*)::int from sales_delivery_instruction_events where instruction_id=$1) delivery_events,
      (select count(*)::int from audit_log where result='success' and action in ('SALES_DELIVERY_INSTRUCTION_CREATED','SALES_DELIVERY_INSTRUCTION_SUBMIT','SALES_DELIVERY_INSTRUCTION_ACCEPT','SALES_SHIPMENT_POSTED','FINANCE_DOCUMENT_POSTED')) acceptance_audits`, [instructionId, orderId, refs.finishedId])).rows[0];
    assert.deepEqual({ ...totals, acceptance_audits: undefined }, { migrations: 24, instruction_status: "COMPLETED", order_status: "SHIPPED", shipment_quantities: ["4.000000", "6.000000"], fqc_consumptions: ["4.000000", "6.000000"], inventory_ledger: "-10.000000", inventory: "0.000000", sources: ["80.000000", "120.000000"], ar: ["80.000000", "120.000000"], ap: ["48.000000", "72.000000"], settlement_amounts: ["30.000000", "50.000000", "120.000000", "48.000000", "30.000000", "42.000000"], settlement_types: ["RECEIPT", "RECEIPT", "RECEIPT", "PAYMENT", "PAYMENT", "PAYMENT"], reversals: 0, allocations: 4, allocation_projects: 1, ar_outstanding: "0.000000", ap_outstanding: "0.000000", delivery_events: 5, acceptance_audits: undefined });
    assert.ok(totals.acceptance_audits >= 7);
    console.info(JSON.stringify({ ok: true, phase, project_id: refs.projectId, order_id: orderId, instruction_id: instructionId, sales_sources: [80, 120], purchase_sources: [48, 72], ar: [80, 120], ap: [48, 72], receipts: [30, 50, 120], payments: [48, 30, 42], ar_outstanding: 0, ap_outstanding: 0, transaction_contribution: 80, net_cash: 80, unattributed: 0, settlement_reversals: 0, real_bank_writes: 0, idempotency_replayed: true, unauthorized_403: true, pages: 5 }));
  } else if (phase === "restart") {
    const totals = (await pool.query(`select
      (select count(*)::int from schema_migrations) migrations,
      (select count(*)::int from sales_delivery_instructions where status='COMPLETED') instructions,
      (select array_agg(sl.quantity::text order by sl.id) from sales_shipment_lines sl join sales_shipments sh on sh.id=sl.shipment_id where sh.shipment_type='SHIPMENT') shipments,
      (select array_agg(quantity::text order by id) from sales_shipment_line_fqc_allocations where entry_type='SHIPMENT') fqc,
      (select coalesce(sum(on_hand_qty),0)::text from inventory_stock_balances where material_id=(select finished_material_id from production_work_orders limit 1)) inventory,
      (select array_agg(amount::text order by id) from sales_financial_source_entries where entry_type='SHIPMENT') sources,
      (select array_agg(total_amount::text order by id) from finance_documents where doc_type='AR') ar,
      (select array_agg(total_amount::text order by id) from finance_documents where doc_type='AP') ap,
      (select coalesce(sum(amount) filter(where settlement_type='RECEIPT'),0)::text from finance_settlements) receipts,
      (select coalesce(sum(amount) filter(where settlement_type='PAYMENT'),0)::text from finance_settlements) payments,
      (select count(*)::int from finance_settlements) settlements,
      (select count(*)::int from finance_project_source_allocations) allocations,
      (select count(*)::int from finance_document_events) finance_events,
      (select count(*)::int from audit_log where route_code='FINANCE' and result='success') finance_audits,
      (select count(*)::int from sales_delivery_instruction_events) delivery_events`)).rows[0];
    assert.deepEqual(totals, { migrations: 24, instructions: 1, shipments: ["4.000000", "6.000000"], fqc: ["4.000000", "6.000000"], inventory: "0.000000", sources: ["80.000000", "120.000000"], ar: ["80.000000", "120.000000"], ap: ["48.000000", "72.000000"], receipts: "200.000000", payments: "120.000000", settlements: 6, allocations: 4, finance_events: 10, finance_audits: 10, delivery_events: 5 });
    for (const path of ["/api/health", "/sales/delivery", "/warehouse/shipping", "/finance/receivables", "/finance/settlements", "/finance/projects"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
    }
    console.info(JSON.stringify({ ok: true, phase, durable: true, ...totals }));
  } else if (phase === "cleanup") {
    const admin = await cleanSynthetic();
    const totals = (await pool.query("select (select count(*)::int from schema_migrations) migrations,(select count(*)::int from app_users) users,(select count(*)::int from sales_delivery_instructions) instructions,(select count(*)::int from sales_shipments) shipments,(select count(*)::int from sales_shipment_line_fqc_allocations) fqc,(select count(*)::int from sales_financial_source_entries) sources,(select count(*)::int from finance_documents) finance,(select count(*)::int from finance_settlements) settlements,(select count(*)::int from finance_project_source_allocations) allocations")).rows[0];
    assert.deepEqual(totals, { migrations: 24, users: 1, instructions: 0, shipments: 0, fqc: 0, sources: 0, finance: 0, settlements: 0, allocations: 0 });
    console.info(JSON.stringify({ ok: true, phase, admin, ...totals }));
  } else {
    throw new Error(`unsupported ERP_TASK10_SMOKE_PHASE: ${phase}`);
  }
} finally {
  await pool.end();
}
