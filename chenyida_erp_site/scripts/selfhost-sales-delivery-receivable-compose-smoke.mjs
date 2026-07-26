import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/identity-selfhost/password.ts";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_TASK09_SMOKE_PHASE || "initial";
if (process.env.ERP_TASK09_ACCEPTANCE_CONFIRM !== "PARALLEL_SYNTHETIC_ONLY" || process.env.ERP_ENV === "production" || !/@postgres(?::5432)?\/chenyida_erp$/i.test(databaseUrl)) {
  throw new Error("TASK09 smoke requires the explicitly confirmed parallel synthetic database");
}
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "task09-sales-delivery-receivable-compose-smoke" });

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
  const username = `task09${role}`;
  const password = `Aa9!${randomUUID()}`;
  const client = httpClient();
  await pool.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$2,$3,$4,true,false,1)", [username, `TASK09 ${role}`, role, await hashPassword(password)]);
  await client.login(username, password);
  return { username, client };
}

async function seed(admin, production) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('cyd.production_service_write','allowed',true)");
    const unit = (await db.query("insert into units(code,name,symbol,unit_type,enabled) values('T09PCS','TASK09 件','T09PCS','COUNT',true) returning id")).rows[0];
    const category = (await db.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('TASK09','TASK09 合成物料',4,'ACTIVE',$1,$1,$2) returning id", [admin, randomUUID()])).rows[0];
    const materials = (await db.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values
      ('CYD-T09-RAW','TASK09 原材料',$1,'T09PCS',$2,'ACTIVE','PURCHASE','STOCKED','NONE','ROHS','MANUAL',$3,$3,$3,$4),
      ('CYD-T09-FG','TASK09 成品',$1,'T09PCS',$2,'ACTIVE','MAKE','STOCKED','FQC','ROHS','MANUAL',$3,$3,$3,$5) returning id,internal_material_code`, [category.id, unit.id, admin, randomUUID(), randomUUID()])).rows;
    const raw = materials.find((row) => row.internal_material_code === "CYD-T09-RAW");
    const finished = materials.find((row) => row.internal_material_code === "CYD-T09-FG");
    const customer = (await db.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-T09','TASK09 客户','TASK09 客户','ACTIVE',$1,$1,$2) returning id", [admin, randomUUID()])).rows[0];
    const product = (await db.query("insert into products(product_code,product_name,customer_id,status,created_by,updated_by,request_id) values('PRD-T09','TASK09 产品',$1,'ACTIVE',$2,$2,$3) returning id", [customer.id, admin, randomUUID()])).rows[0];
    const productVersion = (await db.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,released_by,released_at,created_by,updated_by,request_id) values($1,1,'A0','RELEASED','ASSEMBLY','MASS',$2,now(),$2,$2,$3) returning id", [product.id, admin, randomUUID()])).rows[0];
    const bomHeader = (await db.query("insert into bom_headers(bom_code,product_id,status,created_by,updated_by,request_id) values('BOM-T09',$1,'ACTIVE',$2,$2,$3) returning id", [product.id, admin, randomUUID()])).rows[0];
    const bomVersion = (await db.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,released_by,released_at,created_by,updated_by,request_id) values($1,$2,1,'A0','RELEASED',$3,now(),$3,$3,$4) returning id", [bomHeader.id, productVersion.id, admin, randomUUID()])).rows[0];
    const bomLine = (await db.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,created_by,updated_by,request_id) values($1,1,$2,1,$3,0,'ASSEMBLY',$4,$4,$5) returning id", [bomVersion.id, raw.id, unit.id, admin, randomUUID()])).rows[0];
    const workOrder = (await db.query("insert into production_work_orders(work_order_code,product_id,product_version_id,bom_version_id,finished_material_id,finished_unit_id,planned_qty,status,owner,operation_id,created_by,request_id) values('WO-T09',$1,$2,$3,$4,$5,10,'IN_PROGRESS',$6,$7,$6,$8) returning id", [product.id, productVersion.id, bomVersion.id, finished.id, unit.id, production, randomUUID(), randomUUID()])).rows[0];
    const snapshot = (await db.query("insert into production_bom_snapshots(work_order_id,bom_header_id,bom_version_id,product_version_id,released_by,request_id) values($1,$2,$3,$4,$5,$6) returning id", [workOrder.id, bomHeader.id, bomVersion.id, productVersion.id, admin, randomUUID()])).rows[0];
    const snapshotLine = (await db.query("insert into production_bom_snapshot_lines(snapshot_id,source_bom_line_id,line_no,material_id,quantity_per,loss_rate,unit_id,process_stage) values($1,$2,1,$3,1,0,$4,'ASSEMBLY') returning id", [snapshot.id, bomLine.id, raw.id, unit.id])).rows[0];
    await db.query("insert into production_material_requirements(work_order_id,snapshot_line_id,material_id,unit_id,required_qty,net_issued_qty) values($1,$2,$3,$4,10,10)", [workOrder.id, snapshotLine.id, raw.id, unit.id]);
    await db.query("commit");
    return { unitId: Number(unit.id), finishedId: Number(finished.id), customerId: Number(customer.id), productId: Number(product.id), productVersionId: Number(productVersion.id), workOrderId: Number(workOrder.id) };
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
  await manager.client.write(`/api/quality-inspections/${inspectionId}/dispositions`, { expected_version: 1, disposition_code: "RELEASE", release_qty: String(quantity), reason: "TASK09 FQC 放行" }, 200, `${key}-release`);
  await quality.client.write(`/api/quality-inspections/${inspectionId}/close`, { expected_version: 2, reason: "TASK09 FQC 关闭" }, 200, `${key}-close`);
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
    assert.deepEqual(baseline, { migrations: 23, users: 1, sales_orders: 0, shipments: 0, finance: 0 });
    const admin = (await pool.query("select username from app_users where role='admin' and is_active order by username limit 1")).rows[0].username;
    const production = await provision("production");
    const warehouse = await provision("warehouse");
    const sales = await provision("sales");
    const quality = await provision("quality");
    const manager = await provision("manager");
    const finance = await provision("finance");
    const refs = await seed(admin, production.username);

    const report4 = await production.client.write("/api/production/reports", { work_order_id: refs.workOrderId, expected_version: 1, reported_qty: "4", good_qty: "4", scrap_qty: "0", process_stage: "ASSEMBLY", operator: production.username }, 201, "task09-report-4");
    const completion4 = await warehouse.client.write("/api/production/completions", { work_order_id: refs.workOrderId, expected_version: 2, expected_balance_version: 0, reason: "TASK09 完工 4", allocations: [{ report_id: Number(report4.payload.data.id), quantity: "4", expected_report_version: 1 }] }, 201, "task09-completion-4");
    const report6 = await production.client.write("/api/production/reports", { work_order_id: refs.workOrderId, expected_version: 3, reported_qty: "6", good_qty: "6", scrap_qty: "0", process_stage: "ASSEMBLY", operator: production.username }, 201, "task09-report-6");
    const completion6 = await warehouse.client.write("/api/production/completions", { work_order_id: refs.workOrderId, expected_version: 4, expected_balance_version: 1, reason: "TASK09 完工 6", allocations: [{ report_id: Number(report6.payload.data.id), quantity: "6", expected_report_version: 1 }] }, 201, "task09-completion-6");
    assert.deepEqual([completion4.payload.data.work_order.completed_qty, completion6.payload.data.work_order.completed_qty], ["4.000000", "10.000000"]);
    const completionLines = (await pool.query("select pcl.id,pcl.quantity::text from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id where pc.work_order_id=$1 order by pcl.id", [refs.workOrderId])).rows;

    const order = await sales.client.write("/api/sales-orders", { customer_id: refs.customerId, currency_code: "CNY", owner: sales.username, remark: "TASK09 SO 10 × 20", lines: [{ product_id: refs.productId, product_version_id: refs.productVersionId, finished_material_id: refs.finishedId, unit_id: refs.unitId, quantity: "10", unit_price: "20" }] }, 201, "task09-sales-order");
    const orderId = Number(order.payload.data.id);
    const orderLineId = Number(order.payload.data.current_version.lines[0].id);
    const allocation4 = await sales.client.write("/api/quality/finished-goods-allocations", { completion_line_id: Number(completionLines[0].id), sales_order_line_id: orderLineId, quantity: "4", expected_completion_version: 1, expected_sales_order_line_version: 1 }, 201, "task09-allocation-4");
    const allocation6 = await sales.client.write("/api/quality/finished-goods-allocations", { completion_line_id: Number(completionLines[1].id), sales_order_line_id: orderLineId, quantity: "6", expected_completion_version: 1, expected_sales_order_line_version: 1 }, 201, "task09-allocation-6");
    const fqc4 = await releaseFqc(quality, manager, Number(allocation4.payload.allocation_id), 4, "task09-fqc-4");
    const fqc6 = await releaseFqc(quality, manager, Number(allocation6.payload.allocation_id), 6, "task09-fqc-6");

    const instructionBody = { sales_order_id: orderId, expected_order_version: 1, receiver: "TASK09 收货人", shipping_address: "TASK09 收货地址", contact_info: "TASK09", lines: [{ sales_order_line_id: orderLineId, quantity: "10", expected_line_version: 1 }] };
    const instruction = await sales.client.write("/api/delivery-instructions", instructionBody, 201, "task09-delivery-create");
    const instructionId = Number(instruction.payload.delivery_instruction_id);
    const untouched = (await pool.query("select (select count(*)::int from sales_shipments) shipments,(select on_hand_qty::text from inventory_stock_balances where material_id=$1) inventory,(select count(*)::int from sales_shipment_line_fqc_allocations) fqc_consumptions,(select count(*)::int from sales_financial_source_entries) sources,(select count(*)::int from finance_documents where doc_type='AR') ar", [refs.finishedId])).rows[0];
    assert.deepEqual(untouched, { shipments: 0, inventory: "10.000000", fqc_consumptions: 0, sources: 0, ar: 0 });
    const instructionReplay = await sales.client.write("/api/delivery-instructions", instructionBody, 201, "task09-delivery-create");
    assert.equal(instructionReplay.response.headers.get("Idempotency-Replayed"), "true");
    await sales.client.write(`/api/delivery-instructions/${instructionId}/submit`, { expected_version: 1, reason: "" }, 200, "task09-delivery-submit");
    await warehouse.client.write(`/api/delivery-instructions/${instructionId}/accept`, { expected_version: 2, reason: "" }, 200, "task09-delivery-accept");
    let detail = await warehouse.client.get(`/api/delivery-instructions/${instructionId}`);
    const instructionLineId = Number(detail.payload.data.lines[0].id);
    await quality.client.write(`/api/delivery-instructions/${instructionId}/execute`, { expected_instruction_version: 3, expected_sales_order_version: 1, reason: "越权", lines: [{ instruction_line_id: instructionLineId, quantity: "4", expected_line_version: 1, expected_sales_order_line_version: 1, expected_balance_version: 2 }] }, 403, "task09-quality-execute-denied");

    const firstBody = { expected_instruction_version: 3, expected_sales_order_version: 1, reason: "TASK09 第一批 4", lines: [{ instruction_line_id: instructionLineId, quantity: "4", expected_line_version: 1, expected_sales_order_line_version: 1, expected_balance_version: 2 }] };
    const first = await warehouse.client.write(`/api/delivery-instructions/${instructionId}/execute`, firstBody, 201, "task09-shipment-4");
    assert.equal(first.payload.data.financial_source.amount, "80.000000");
    const firstReplay = await warehouse.client.write(`/api/delivery-instructions/${instructionId}/execute`, firstBody, 201, "task09-shipment-4");
    assert.equal(firstReplay.response.headers.get("Idempotency-Replayed"), "true");
    const after4 = (await pool.query("select (select on_hand_qty::text from inventory_stock_balances where material_id=$1) inventory,(select shipped_qty::text from sales_order_lines where id=$2) shipped,(select status from sales_delivery_instructions where id=$3) instruction_status,(select coalesce(sum(qi.released_qty),0)-coalesce(sum(c.consumed),0) from quality_inspections qi left join lateral(select sum(case when a.entry_type='SHIPMENT' then a.quantity else -a.quantity end) consumed from sales_shipment_line_fqc_allocations a where a.quality_inspection_id=qi.id)c on true where qi.id=any($4::bigint[]))::text fqc_available", [refs.finishedId, orderLineId, instructionId, [fqc4, fqc6]])).rows[0];
    assert.deepEqual(after4, { inventory: "6.000000", shipped: "4.000000", instruction_status: "PARTIAL", fqc_available: "6.000000" });
    const firstSourceId = Number(first.payload.data.financial_source.id);
    const ar80 = await finance.client.write("/api/finance/documents", { doc_type: "AR", sales_source_entry_id: firstSourceId }, 201, "task09-ar-80");
    assert.equal(ar80.payload.data.total_amount, "80.000000");
    await warehouse.client.write(`/api/shipments/${first.payload.shipment_id}/reversal`, { reason: "AR 后冲销应阻止", expected_balance_versions: [{ material_id: refs.finishedId, expected_balance_version: 3 }] }, 409, "task09-ar-reversal-gate");

    detail = await warehouse.client.get(`/api/delivery-instructions/${instructionId}`);
    const second = await warehouse.client.write(`/api/delivery-instructions/${instructionId}/execute`, { expected_instruction_version: Number(detail.payload.data.header.version), expected_sales_order_version: Number(detail.payload.data.header.sales_order_version), reason: "TASK09 第二批 6", lines: [{ instruction_line_id: instructionLineId, quantity: "6", expected_line_version: Number(detail.payload.data.lines[0].version), expected_sales_order_line_version: Number(detail.payload.data.lines[0].sales_order_line_version), expected_balance_version: Number(detail.payload.data.lines[0].balance_version) }] }, 201, "task09-shipment-6");
    assert.equal(second.payload.data.financial_source.amount, "120.000000");
    const ar120 = await finance.client.write("/api/finance/documents", { doc_type: "AR", sales_source_entry_id: Number(second.payload.data.financial_source.id) }, 201, "task09-ar-120");
    assert.equal(ar120.payload.data.total_amount, "120.000000");

    for (const path of ["/sales/delivery", "/warehouse/shipping", "/finance/receivables"]) {
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
      (select count(*)::int from finance_settlements) settlements,
      (select count(*)::int from sales_delivery_instruction_events where instruction_id=$1) delivery_events,
      (select count(*)::int from audit_log where result='success' and action in ('SALES_DELIVERY_INSTRUCTION_CREATED','SALES_DELIVERY_INSTRUCTION_SUBMITTED','SALES_DELIVERY_INSTRUCTION_ACCEPT','SALES_SHIPMENT_POSTED','FINANCE_DOCUMENT_POSTED')) acceptance_audits`, [instructionId, orderId, refs.finishedId])).rows[0];
    assert.deepEqual({ ...totals, acceptance_audits: undefined }, { migrations: 23, instruction_status: "COMPLETED", order_status: "SHIPPED", shipment_quantities: ["4.000000", "6.000000"], fqc_consumptions: ["4.000000", "6.000000"], inventory_ledger: "-10.000000", inventory: "0.000000", sources: ["80.000000", "120.000000"], ar: ["80.000000", "120.000000"], settlements: 0, delivery_events: 5, acceptance_audits: undefined });
    assert.ok(totals.acceptance_audits >= 7);
    console.info(JSON.stringify({ ok: true, phase, order_id: orderId, instruction_id: instructionId, shipments: [4, 6], fqc_consumptions: [4, 6], inventory: [10, 6, 0], sales_sources: [80, 120], ar: [80, 120], settlements: 0, ar_reversal_gate: true, idempotency_replayed: true, unauthorized_403: true, pages: 3 }));
  } else if (phase === "restart") {
    const totals = (await pool.query(`select
      (select count(*)::int from schema_migrations) migrations,
      (select count(*)::int from sales_delivery_instructions where status='COMPLETED') instructions,
      (select array_agg(sl.quantity::text order by sl.id) from sales_shipment_lines sl join sales_shipments sh on sh.id=sl.shipment_id where sh.shipment_type='SHIPMENT') shipments,
      (select array_agg(quantity::text order by id) from sales_shipment_line_fqc_allocations where entry_type='SHIPMENT') fqc,
      (select coalesce(sum(on_hand_qty),0)::text from inventory_stock_balances where material_id=(select finished_material_id from production_work_orders limit 1)) inventory,
      (select array_agg(amount::text order by id) from sales_financial_source_entries where entry_type='SHIPMENT') sources,
      (select array_agg(total_amount::text order by id) from finance_documents where doc_type='AR') ar,
      (select count(*)::int from finance_settlements) settlements,
      (select count(*)::int from sales_delivery_instruction_events) delivery_events`)).rows[0];
    assert.deepEqual(totals, { migrations: 23, instructions: 1, shipments: ["4.000000", "6.000000"], fqc: ["4.000000", "6.000000"], inventory: "0.000000", sources: ["80.000000", "120.000000"], ar: ["80.000000", "120.000000"], settlements: 0, delivery_events: 5 });
    for (const path of ["/api/health", "/sales/delivery", "/warehouse/shipping", "/finance/receivables"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
    }
    console.info(JSON.stringify({ ok: true, phase, durable: true, ...totals }));
  } else if (phase === "cleanup") {
    const admin = await cleanSynthetic();
    const totals = (await pool.query("select (select count(*)::int from schema_migrations) migrations,(select count(*)::int from app_users) users,(select count(*)::int from sales_delivery_instructions) instructions,(select count(*)::int from sales_shipments) shipments,(select count(*)::int from sales_shipment_line_fqc_allocations) fqc,(select count(*)::int from sales_financial_source_entries) sources,(select count(*)::int from finance_documents) finance,(select count(*)::int from finance_settlements) settlements")).rows[0];
    assert.deepEqual(totals, { migrations: 23, users: 1, instructions: 0, shipments: 0, fqc: 0, sources: 0, finance: 0, settlements: 0 });
    console.info(JSON.stringify({ ok: true, phase, admin, ...totals }));
  } else {
    throw new Error(`unsupported ERP_TASK09_SMOKE_PHASE: ${phase}`);
  }
} finally {
  await pool.end();
}
