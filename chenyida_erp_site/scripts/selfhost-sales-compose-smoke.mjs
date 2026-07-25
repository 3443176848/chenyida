import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_SALES_SMOKE_PHASE || "initial";
const setupToken = process.env.ERP_SETUP_TOKEN || "";
const adminUsername = process.env.ERP_ADMIN_USERNAME || "";
const adminPassword = process.env.ERP_ADMIN_PASSWORD || "";
const reuseIdentity = process.env.ERP_FULL_JOURNEY_REUSE_IDENTITY === "true";
if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("sales compose smoke requires an isolated test database");
if (!setupToken || !adminUsername || !adminPassword) throw new Error("sales compose smoke credentials are required");

function apiClient() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers); if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(";"); const separator = pair.indexOf("="); const name = pair.slice(0, separator); const content = pair.slice(separator + 1); if (/Max-Age=0/i.test(value)) cookies.delete(name); else cookies.set(name, content); }
    const payload = await response.json(); if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`); return { response, payload };
  }
  return {
    setup: () => request("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setup_token: setupToken, username: adminUsername, display_name: "TASK07 烟测管理员", password: adminPassword }) }, 201),
    login: async () => { const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: adminUsername, password: adminPassword }) }); csrf = result.payload.csrf_token; return result; },
    get: (path) => request(path),
    write: (path, body, expectedStatus = 201, key = randomUUID(), method = "POST") => request(path, { method, headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, expectedStatus),
  };
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "sales-compose-smoke" });
try {
  if (phase === "initial") {
    const api = apiClient(); if (!reuseIdentity) await api.setup(); await api.login();
    const category = await pool.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('T07_LEAF','TASK07 销售测试',4,'ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    const unit = await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('T07PCS','TASK07 件','T07PCS','COUNT',true) returning id");
    const customer = await pool.query("insert into customers(customer_code,customer_name,normalized_name,status,created_by,updated_by,request_id) values('CUS-T07','TASK07 客户','TASK07 客户','ACTIVE',$1,$1,$2) returning id", [adminUsername, randomUUID()]);
    const material = await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id)
      values('CYD-T07-FG','TASK07 销售成品',$1,'T07PCS',$2,'ACTIVE','MAKE','STOCKED','FQC','ROHS','MANUAL',$3,$3,$3,$4) returning id`, [category.rows[0].id, unit.rows[0].id, adminUsername, randomUUID()]);
    const product = await pool.query("insert into products(product_code,product_name,customer_id,created_by,updated_by,request_id) values('PRD-T07','TASK07 产品',$1,$2,$2,$3) returning id", [customer.rows[0].id, adminUsername, randomUUID()]);
    const productVersion = await pool.query("insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,created_by,updated_by,request_id,released_by,released_at) values($1,1,'A0','RELEASED','PCB','MASS',$2,$2,$3,$2,now()) returning id", [product.rows[0].id, adminUsername, randomUUID()]);
    const bom = await pool.query("insert into bom_headers(bom_code,product_id,created_by,updated_by,request_id) values('BOM-T07',$1,$2,$2,$3) returning id", [product.rows[0].id, adminUsername, randomUUID()]); const bomVersion = await pool.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,released_by,released_at,created_by,updated_by,request_id) values($1,$2,1,'A0','RELEASED',$3,now(),$3,$3,$4) returning id", [bom.rows[0].id, productVersion.rows[0].id, adminUsername, randomUUID()]);
    await pool.query("insert into material_customer_restrictions(material_id,customer_id,status,created_by,request_id) values($1,$2,'ACTIVE',$3,$4)", [material.rows[0].id, customer.rows[0].id, adminUsername, randomUUID()]);
    await api.write("/api/inventory-adjustments", { operation_type: "RECEIPT", reason: "TASK07 初始库存", lines: [{ material_id: Number(material.rows[0].id), unit_id: Number(unit.rows[0].id), quantity: "12", expected_balance_version: 0 }] }, 201, "task07-stock");
    const quoteBody = { customer_id: Number(customer.rows[0].id), currency_code: "CNY", valid_until: "2027-08-01T00:00:00Z", owner: "Compose", remark: "TASK07 持久化", lines: [{ product_id: Number(product.rows[0].id), product_version_id: Number(productVersion.rows[0].id), finished_material_id: Number(material.rows[0].id), unit_id: Number(unit.rows[0].id), quantity: "10", unit_price: "1.234567" }] };
    const quote = await api.write("/api/quotations", quoteBody, 201, "task07-quote"); const quoteId = Number(quote.payload.quote_id);
    await api.write(`/api/quotations/${quoteId}/publish`, { expected_version: 1, reason: "" }, 200, "task07-publish");
    await api.write(`/api/quotations/${quoteId}/accept`, { expected_version: 2, reason: "" }, 200, "task07-accept");
    const converted = await api.write(`/api/quotations/${quoteId}/convert`, { expected_version: 3, owner: "Compose" }, 201, "task07-convert"); const order = converted.payload.data.sales_order; const orderId = Number(order.id); const lineId = Number(order.current_version.lines[0].id);
    const inventorySource = await pool.query("select a.id adjustment_id,l.id ledger_id from inventory_adjustments a join inventory_ledger_entries l on l.adjustment_id=a.id order by a.id limit 1"); const seed = await pool.connect(); try { await seed.query("begin"); await seed.query("select set_config('cyd.production_service_write','allowed',true),set_config('cyd.quality_service_write','allowed',true)"); const wo = await seed.query("insert into production_work_orders(work_order_code,product_id,product_version_id,bom_version_id,finished_material_id,finished_unit_id,planned_qty,status,operation_id,created_by,request_id) values('WO-T07-FQC',$1,$2,$3,$4,$5,10,'COMPLETED',$6,$7,$8) returning id", [product.rows[0].id, productVersion.rows[0].id, bomVersion.rows[0].id, material.rows[0].id, unit.rows[0].id, randomUUID(), adminUsername, randomUUID()]); const completion = await seed.query("insert into production_completions(completion_code,work_order_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values('PC-T07-FQC',$1,$2,'TASK08 回归放行来源',$3,$4,$5) returning id", [wo.rows[0].id, inventorySource.rows[0].adjustment_id, randomUUID(), adminUsername, randomUUID()]); const completionLine = await seed.query("insert into production_completion_lines(completion_id,line_no,material_id,unit_id,quantity,inventory_ledger_entry_id) values($1,1,$2,$3,10,$4) returning id", [completion.rows[0].id, material.rows[0].id, unit.rows[0].id, inventorySource.rows[0].ledger_id]); const inspection = await seed.query("insert into quality_inspections(inspection_code,inspection_type,production_completion_line_id,sales_order_line_id,material_id,unit_id,inspected_qty,passed_qty,failed_qty,lifecycle_status,decision_status,released_qty,operation_id,created_by,request_id) values('QI-T07-FQC','FQC',$1,$2,$3,$4,10,10,0,'CLOSED','RELEASED',10,$5,$6,$7) returning id", [completionLine.rows[0].id, lineId, material.rows[0].id, unit.rows[0].id, randomUUID(), adminUsername, randomUUID()]); await seed.query("insert into quality_inspection_results(inspection_id,line_no,characteristic,result) values($1,1,'TASK07 回归放行','PASS')", [inspection.rows[0].id]); await seed.query("commit"); } catch (error) { await seed.query("rollback"); throw error; } finally { seed.release(); }
    const first = await api.write("/api/shipments", { sales_order_id: orderId, expected_order_version: 1, reason: "TASK07 首批", lines: [{ sales_order_line_id: lineId, quantity: "3", expected_line_version: 1, expected_balance_version: 1 }] }, 201, "task07-ship-1");
    await api.write(`/api/shipments/${first.payload.shipment_id}/reversal`, { reason: "TASK07 冲销验证", expected_balance_versions: [{ material_id: Number(material.rows[0].id), expected_balance_version: 2 }] }, 201, "task07-reverse");
    await api.write("/api/shipments", { sales_order_id: orderId, expected_order_version: 3, reason: "TASK07 最终出货", lines: [{ sales_order_line_id: lineId, quantity: "4", expected_line_version: 3, expected_balance_version: 3 }] }, 201, "task07-ship-2");
    const detail = await api.get(`/api/sales-orders/${orderId}`); const inventory = await api.get("/api/inventory"); const balance = inventory.payload.rows.find((row) => row.internal_material_code === "CYD-T07-FG"); if (detail.payload.data.header.status !== "PARTIALLY_SHIPPED" || detail.payload.data.lines[0].shipped_qty !== "4.000000" || balance?.on_hand_qty !== "8.000000") throw new Error("sales compose projection mismatch");
    console.info(JSON.stringify({ ok: true, phase, quote_code: quote.payload.quote_code, sales_order_code: order.sales_order_code, on_hand_qty: balance.on_hand_qty }));
  } else if (phase === "restart") {
    const api = apiClient(); await api.login(); const [quotes, orders, shipments, inventory, finance, reconciliation] = await Promise.all([api.get("/api/quotations"), api.get("/api/sales-orders"), api.get("/api/shipments"), api.get("/api/inventory"), api.get("/api/sales/financial-sources"), api.get("/api/inventory/reconciliation")]);
    const quote = quotes.payload.rows.find((row) => row.owner === "Compose"); const order = orders.payload.rows.find((row) => row.owner === "Compose"); const balance = inventory.payload.rows.find((row) => row.internal_material_code === "CYD-T07-FG"); const counts = await pool.query("select (select count(*)::int from sales_quotation_status_events) quote_events,(select count(*)::int from sales_quote_order_links) links,(select count(*)::int from sales_shipments) shipments,(select count(*)::int from sales_financial_source_entries) finance,(select count(*)::int from inventory_ledger_entries) ledger,(select count(*)::int from audit_log where route_code='SALES' and result='success') audits");
    const exactAmounts = finance.payload.rows.map((row) => row.amount).sort().join(",");
    if (quote?.status !== "CONVERTED" || order?.status !== "PARTIALLY_SHIPPED" || order?.shipped_qty !== "4.000000" || balance?.on_hand_qty !== "8.000000" || shipments.payload.rows.length !== 3 || exactAmounts !== "-3.703701,3.703701,4.938268" || !reconciliation.payload.consistent || JSON.stringify(counts.rows[0]) !== JSON.stringify({ quote_events: 4, links: 1, shipments: 3, finance: 3, ledger: 4, audits: 7 })) throw new Error(`sales state was not durable after restart: ${JSON.stringify({ counts: counts.rows[0], exactAmounts })}`);
    console.info(JSON.stringify({ ok: true, phase, quote_code: quote.quote_code, sales_order_code: order.sales_order_code, ...counts.rows[0] }));
  } else throw new Error(`unsupported ERP_SALES_SMOKE_PHASE: ${phase}`);
} finally { await pool.end(); }
