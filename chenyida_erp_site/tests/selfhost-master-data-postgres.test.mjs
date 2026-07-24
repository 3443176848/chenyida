import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { handleMasterDataApi } from "../app/lib/master-data-selfhost/handler.ts";
import { handleBomApi } from "../app/lib/bom-selfhost/handler.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

const databaseUrl = process.env.TEST_MASTER_DATA_DATABASE_URL;
if (!databaseUrl || !/master_data_test/i.test(databaseUrl)) throw new Error("isolated TEST_MASTER_DATA_DATABASE_URL containing master_data_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "master-data-integration-test" });
const actor = (role, username = `${role}01`) => ({ username, display_name: role, role, is_active: true, must_change_password: false, version: 1, last_login_at: null, permissions: permissionsForRole(role) });

async function api(handler, path, { method = "GET", role = "admin", username, body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers({ "X-Request-ID": randomUUID() }); if (body !== undefined) headers.set("Content-Type", "application/json"); if (key) headers.set("Idempotency-Key", key); if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handler(request, { pool, actor: actor(role, username), requestId: headers.get("X-Request-ID"), requireCsrf: () => { if (headers.get("X-CSRF-Token") !== "test-csrf") throw Object.assign(new Error("csrf"), { code: "CSRF_INVALID", status: 403 }); } });
  assert.ok(response, `route not handled ${method} ${path}`); return { response, payload: await response.json() };
}

async function seedReferences() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash) values
    ('admin01','admin','admin','test-only'),('sales01','sales','sales','test-only'),('purchase01','purchase','purchase','test-only'),
    ('engineering01','engineering','engineering','test-only'),('warehouse01','warehouse','warehouse','test-only'),
    ('operations01','operations','operations','test-only'),('rate-sales','rate-sales','sales','test-only')`);
  await pool.query(`insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values('TEST_LEAF','测试叶子',4,'ACTIVE','test','test',$1)`, [randomUUID()]);
  const category = await pool.query("select id from material_categories where category_code='TEST_LEAF'");
  await pool.query(`insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true)`);
  const unit = await pool.query("select id from units where code='PCS'");
  await pool.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id) values('CYD-TEST-000001','测试物料',$1,'PCS',$2,'ACTIVE','PURCHASE','STOCK','IQC','ROHS','MANUAL','test','test','test',$3)`, [category.rows[0].id, unit.rows[0].id, randomUUID()]);
}

test.beforeEach(async () => {
  await pool.query(`truncate bom_lines,bom_versions,bom_headers,product_versions,products,customers,supplier_mapping_price_history,supplier_mappings,suppliers,business_code_sequences,identity_write_rate_limit_buckets,idempotency_keys,audit_log,app_users,material_master,units,material_categories restart identity cascade`);
  await seedReferences();
});
test.after(async () => pool.end());

test("customer supplier product BOM mapping and inventory-backed readiness complete", async () => {
  const customer = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", key: "customer-create-0001", body: { customer_name: "晨亿达客户" } });
  assert.equal(customer.response.status, 201); assert.match(customer.payload.customer_code, /^CUS-\d{6}$/);
  const replay = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", key: "customer-create-0001", body: { customer_name: "晨亿达客户" } });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const conflict = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", key: "customer-create-0001", body: { customer_name: "不同客户" } });
  assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const supplier = await api(handleMasterDataApi, "/api/suppliers", { method: "POST", role: "purchase", body: { supplier_name: "合成供应商" } });
  assert.equal(supplier.response.status, 201);
  const product = await api(handleMasterDataApi, "/api/products", { method: "POST", role: "engineering", body: { product_name: "控制板", customer_id: customer.payload.data.id, product_type: "PCB", product_version: "A0", layer_count: 4 } });
  assert.equal(product.response.status, 201); const productId = Number(product.payload.data.id); const productVersionId = Number(product.payload.data.current_version.id);
  const releasedProduct = await api(handleMasterDataApi, `/api/products/${productId}/versions/${productVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  assert.equal(releasedProduct.response.status, 200);

  const bom = await api(handleBomApi, "/api/boms", { method: "POST", role: "engineering", body: { product_id: productId, bom_version: "A0" } });
  assert.equal(bom.response.status, 201); const bomId = Number(bom.payload.bom_id); const bomVersionId = Number(bom.payload.data.current_version.id);
  const material = await pool.query("select id from material_master where internal_material_code='CYD-TEST-000001'"); const unit = await pool.query("select id from units where code='PCS'");
  const line = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: material.rows[0].id, quantity_per: "2.500000", unit_id: unit.rows[0].id, loss_rate: "0.05" } });
  assert.equal(line.response.status, 201);
  const readiness = await api(handleBomApi, `/api/bom-readiness?bom_id=${bomId}&order_qty=10`, { role: "warehouse" });
  assert.equal(readiness.response.status, 200); assert.equal(readiness.payload.inventory_evaluated, true); assert.equal(readiness.payload.structure_ready, true); assert.equal(readiness.payload.all_ready, false); assert.equal(readiness.payload.rows[0].required_qty, "26.250000"); assert.equal(readiness.payload.rows[0].readiness_status, "SHORTAGE");
  const releasedBom = await api(handleBomApi, `/api/boms/${bomId}/versions/${bomVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  assert.equal(releasedBom.response.status, 200);
  await assert.rejects(pool.query("update bom_lines set quantity_per=3 where id=$1", [line.payload.data.id]), /released bom lines are immutable/);
  const otherProduct = await api(handleMasterDataApi, "/api/products", { method: "POST", role: "engineering", body: { product_name: "其他产品", product_version: "A0" } });
  const otherProductId = Number(otherProduct.payload.data.id); const otherVersionId = Number(otherProduct.payload.data.current_version.id);
  await api(handleMasterDataApi, `/api/products/${otherProductId}/versions/${otherVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  const crossProductRevision = await api(handleBomApi, `/api/boms/${bomId}/versions`, { method: "POST", role: "engineering", body: { expected_version: 2, version_code: "B0", product_version_id: otherVersionId } });
  assert.equal(crossProductRevision.response.status, 422); assert.equal(crossProductRevision.payload.code, "PRODUCT_VERSION_NOT_RELEASED");
  const revision = await api(handleBomApi, `/api/boms/${bomId}/versions`, { method: "POST", role: "engineering", body: { expected_version: 2, version_code: "B0" } });
  assert.equal(revision.response.status, 201);

  const mapping = await api(handleMasterDataApi, "/api/mappings", { method: "POST", role: "purchase", body: { supplier_id: supplier.payload.data.id, material_id: material.rows[0].id, purchase_unit_id: unit.rows[0].id, supplier_item_code: "V-100", valid_from: "2026-01-01T00:00:00.000Z" } });
  assert.equal(mapping.response.status, 201);
  const price = await api(handleMasterDataApi, `/api/mappings/${mapping.payload.data.id}/prices`, { method: "POST", role: "purchase", body: { price: "12.345600", minimum_order_qty: "0", currency_code: "CNY", price_uom: "PCS", effective_from: "2026-01-01T00:00:00.000Z" } });
  assert.equal(price.response.status, 201);
  const invalidPricePeriod = await api(handleMasterDataApi, `/api/mappings/${mapping.payload.data.id}/prices`, { method: "POST", role: "purchase", body: { price: "1", currency_code: "CNY", price_uom: "PCS", effective_from: "invalid-date" } });
  assert.equal(invalidPricePeriod.response.status, 400); assert.equal(invalidPricePeriod.payload.code, "REQUEST_VALIDATION_FAILED");
  const mappingInactive = await api(handleMasterDataApi, `/api/mappings/${mapping.payload.data.id}/status`, { method: "PATCH", role: "purchase", body: { status: "INACTIVE", expected_version: 1 } });
  assert.equal(mappingInactive.response.status, 200); assert.equal(mappingInactive.payload.data.version, 2);
  const productInactive = await api(handleMasterDataApi, `/api/products/${productId}/status`, { method: "PATCH", role: "engineering", body: { status: "INACTIVE", expected_version: 2 } });
  assert.equal(productInactive.response.status, 200); assert.equal(productInactive.payload.data.version, 3);
  const staleProduct = await api(handleMasterDataApi, `/api/products/${productId}/status`, { method: "PATCH", role: "engineering", body: { status: "ACTIVE", expected_version: 2 } });
  assert.equal(staleProduct.response.status, 409); assert.equal(staleProduct.payload.code, "VERSION_CONFLICT");
  const items = await api(handleMasterDataApi, "/api/items", { role: "operations" }); assert.equal(items.payload.rows.length, 1); assert.equal(items.payload.rows[0].status, "ACTIVE");
  assert.equal(Number((await pool.query("select count(*) count from inventory_transactions")).rows[0].count), 0);
});

test("permission CSRF active-reference overlap concurrency and rollback protections fail closed", async () => {
  const denied = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "purchase", body: { customer_name: "越权客户" } }); assert.equal(denied.response.status, 403);
  const noCsrf = await api(handleMasterDataApi, "/api/suppliers", { method: "POST", role: "purchase", csrf: false, body: { supplier_name: "缺少 CSRF" } }); assert.equal(noCsrf.response.status, 403);
  const created = await Promise.all(["并发客户甲", "并发客户乙"].map((customer_name) => api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", body: { customer_name } })));
  assert.deepEqual(created.map((item) => item.response.status), [201, 201]); assert.equal(new Set(created.map((item) => item.payload.customer_code)).size, 2);
  const supplier = await api(handleMasterDataApi, "/api/suppliers", { method: "POST", role: "purchase", body: { supplier_name: "重叠供应商" } });
  const material = await pool.query("select id from material_master limit 1"); const unit = await pool.query("select id from units limit 1");
  const first = await api(handleMasterDataApi, "/api/mappings", { method: "POST", role: "purchase", body: { supplier_id: supplier.payload.data.id, material_id: material.rows[0].id, purchase_unit_id: unit.rows[0].id, supplier_item_code: "OVERLAP", valid_from: "2026-01-01T00:00:00Z" } }); assert.equal(first.response.status, 201);
  const overlap = await api(handleMasterDataApi, "/api/mappings", { method: "POST", role: "purchase", body: { supplier_id: supplier.payload.data.id, material_id: material.rows[0].id, purchase_unit_id: unit.rows[0].id, supplier_item_code: "OVERLAP", valid_from: "2026-06-01T00:00:00Z" } }); assert.equal(overlap.response.status, 409);
  await pool.query("update material_master set material_status='FROZEN' where id=$1", [material.rows[0].id]);
  const inactive = await api(handleMasterDataApi, "/api/mappings", { method: "POST", role: "purchase", body: { supplier_id: supplier.payload.data.id, material_id: material.rows[0].id, purchase_unit_id: unit.rows[0].id, supplier_item_code: "FROZEN", valid_from: "2026-01-01T00:00:00Z" } }); assert.equal(inactive.response.status, 422);
  await pool.query(`create or replace function fail_master_audit_for_test() returns trigger language plpgsql as $$ begin if new.action='CUSTOMER_CREATED' then raise exception 'forced audit failure'; end if; return new; end $$`);
  await pool.query("create trigger fail_master_audit_for_test before insert on audit_log for each row execute function fail_master_audit_for_test()");
  const failed = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", key: "rollback-customer-key", body: { customer_name: "必须回滚客户" } }); assert.equal(failed.response.status, 500);
  assert.equal(Number((await pool.query("select count(*) count from customers where customer_name='必须回滚客户'")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where key_digest is not null and response::text like '%必须回滚客户%'")).rows[0].count), 0);
  await pool.query("drop trigger fail_master_audit_for_test on audit_log; drop function fail_master_audit_for_test()");
});

test("master-data API rate limits distinct write keys without weakening idempotent replay", async () => {
  for (let index = 1; index <= 20; index += 1) {
    const result = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", username: "rate-sales", key: `rate-key-${String(index).padStart(4, "0")}`, body: { customer_name: `限流客户${index}` } });
    assert.equal(result.response.status, 201);
  }
  const replay = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", username: "rate-sales", key: "rate-key-0001", body: { customer_name: "限流客户1" } });
  assert.equal(replay.response.status, 201); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const limited = await api(handleMasterDataApi, "/api/customers", { method: "POST", role: "sales", username: "rate-sales", key: "rate-key-0021", body: { customer_name: "限流客户21" } });
  assert.equal(limited.response.status, 429); assert.equal(limited.payload.code, "RATE_LIMITED");
});
