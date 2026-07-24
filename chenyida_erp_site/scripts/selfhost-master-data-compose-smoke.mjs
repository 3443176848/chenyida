import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const databaseUrl = process.env.DATABASE_URL || "";
const phase = process.env.ERP_MASTER_DATA_SMOKE_PHASE || "initial";
const setupToken = process.env.ERP_SETUP_TOKEN || "";
const adminUsername = process.env.ERP_ADMIN_USERNAME || "";
const adminPassword = process.env.ERP_ADMIN_PASSWORD || "";

if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("master-data compose smoke requires an isolated test database");
if (!setupToken || !adminUsername || !adminPassword) throw new Error("master-data compose smoke credentials are required");

function apiClient() {
  const cookies = new Map(); let csrf = "";
  async function request(path, init = {}, expectedStatus = 200) {
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${base}${path}`, { ...init, headers });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";"); const separator = pair.indexOf("="); const name = pair.slice(0, separator); const content = pair.slice(separator + 1);
      if (/Max-Age=0/i.test(value)) cookies.delete(name); else cookies.set(name, content);
    }
    const payload = await response.json();
    if (response.status !== expectedStatus) throw new Error(`${path}: ${response.status} ${payload?.code || payload?.error?.code || "UNKNOWN"}`);
    return { response, payload };
  }
  return {
    login: async () => { const result = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: adminUsername, password: adminPassword }) }); csrf = result.payload.csrf_token; return result; },
    get: (path) => request(path),
    write: (path, body, expectedStatus = 200, key = randomUUID(), method = "POST") => request(path, { method, headers: { "Content-Type": "application/json", Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key }, body: JSON.stringify(body) }, expectedStatus),
    setup: () => request("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setup_token: setupToken, username: adminUsername, display_name: "TASK03 烟测管理员", password: adminPassword }) }, 201),
  };
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "master-data-compose-smoke" });
try {
  if (phase === "initial") {
    const api = apiClient(); await api.setup(); await api.login();
    await pool.query(`insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('T03_LEAF','TASK03 测试叶子',4,'ACTIVE',$1,$1,$2)`, [adminUsername, randomUUID()]);
    const category = await pool.query("select id from material_categories where category_code='T03_LEAF'");
    await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('T03PCS','TASK03 件','T03PCS','COUNT',true)");
    const unit = await pool.query("select id from units where code='T03PCS'");
    await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('CYD-T03-000001','TASK03 烟测物料',$1,'T03PCS',$2,'ACTIVE','PURCHASE','STOCK','IQC','ROHS','MANUAL',$3,$3,$3,$4)`, [category.rows[0].id, unit.rows[0].id, adminUsername, randomUUID()]);
    const material = await pool.query("select id from material_master where internal_material_code='CYD-T03-000001'");

    const customer = await api.write("/api/customers", { customer_name: "TASK03 烟测客户" }, 201, "task03-compose-customer");
    const supplier = await api.write("/api/suppliers", { supplier_name: "TASK03 烟测供应商" }, 201, "task03-compose-supplier");
    const product = await api.write("/api/products", { product_code: "T03-PROD-001", product_name: "TASK03 烟测产品", customer_id: customer.payload.data.id, version_code: "A0" }, 201, "task03-compose-product");
    const productId = Number(product.payload.data.id); const productVersionId = Number(product.payload.data.current_version.id);
    await api.write(`/api/products/${productId}/versions/${productVersionId}/release`, { expected_version: 1 }, 200, "task03-compose-product-release");
    const bom = await api.write("/api/boms", { bom_code: "T03-BOM-001", product_id: productId, version_code: "A0" }, 201, "task03-compose-bom");
    const bomId = Number(bom.payload.bom_id); const bomVersionId = Number(bom.payload.data.current_version.id);
    await api.write("/api/bom-lines", { bom_id: bomId, line_no: 1, material_id: material.rows[0].id, quantity_per: "2.000000", unit_id: unit.rows[0].id }, 201, "task03-compose-bom-line");
    const readiness = await api.get(`/api/bom-readiness?bom_id=${bomId}&order_qty=5`);
    if (!readiness.payload.structure_ready || readiness.payload.inventory_evaluated !== false || readiness.payload.all_ready !== false) throw new Error("BOM readiness must remain structural before TASK04");
    await api.write(`/api/boms/${bomId}/versions/${bomVersionId}/release`, { expected_version: 1 }, 200, "task03-compose-bom-release");
    const mapping = await api.write("/api/mappings", { supplier_id: supplier.payload.data.id, material_id: material.rows[0].id, purchase_unit_id: unit.rows[0].id, supplier_item_code: "T03-SUP-001", valid_from: "2026-01-01T00:00:00.000Z" }, 201, "task03-compose-mapping");
    await api.write(`/api/mappings/${mapping.payload.data.id}/prices`, { price: "12.340000", currency_code: "CNY", price_uom: "T03PCS", effective_from: "2026-01-01T00:00:00.000Z" }, 201, "task03-compose-price");
    console.info(JSON.stringify({ ok: true, phase, product_id: productId, bom_id: bomId, structure_ready: true, inventory_evaluated: false }));
  } else if (phase === "restart") {
    const api = apiClient(); await api.login();
    const [customers, suppliers, products, boms, mappings, items] = await Promise.all([api.get("/api/customers"), api.get("/api/suppliers"), api.get("/api/products"), api.get("/api/boms"), api.get("/api/mappings"), api.get("/api/items")]);
    const product = products.payload.rows.find((row) => row.product_code === "T03-PROD-001"); const bom = boms.payload.rows.find((row) => row.bom_code === "T03-BOM-001");
    if (!customers.payload.rows.some((row) => row.customer_name === "TASK03 烟测客户") || !suppliers.payload.rows.some((row) => row.supplier_name === "TASK03 烟测供应商") || product?.product_version_status !== "RELEASED" || bom?.bom_status !== "RELEASED" || !mappings.payload.rows.some((row) => row.supplier_item_code === "T03-SUP-001") || !items.payload.rows.some((row) => row.internal_material_code === "CYD-T03-000001")) throw new Error("master-data state was not durable after restart");
    const persisted = await pool.query("select (select count(*)::int from supplier_mapping_price_history) prices,(select count(*)::int from bom_lines) bom_lines,(select count(*)::int from audit_log where route_code='MASTER_DATA' and result='success') audits");
    if (persisted.rows[0].prices < 1 || persisted.rows[0].bom_lines < 1 || persisted.rows[0].audits < 8) throw new Error(`persisted master-data state mismatch: ${JSON.stringify(persisted.rows[0])}`);
    console.info(JSON.stringify({ ok: true, phase, product_id: product.id, bom_id: bom.id, ...persisted.rows[0] }));
  } else throw new Error(`unsupported ERP_MASTER_DATA_SMOKE_PHASE: ${phase}`);
} finally { await pool.end(); }
