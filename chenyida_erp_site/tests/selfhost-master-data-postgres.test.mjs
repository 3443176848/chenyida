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

async function insertSelectorMaterial({ code, name, status = "ACTIVE", unitId, version = 1 }) {
  const category = await pool.query("select id from material_categories where category_code='TEST_LEAF'");
  const result = await pool.query(`insert into material_master(
    internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,
    inspection_type,environmental_requirement,source_type,version,last_modified_by,created_by,updated_by,request_id
  ) values($1,$2,$3,'PCS',$4,$5,'PURCHASE','STOCK','IQC','ROHS','MANUAL',$6,'test','test','test',$7)
  returning id,internal_material_code,standard_name,base_unit_id,material_status,version`, [code, name, category.rows[0].id, unitId, status, version, randomUUID()]);
  return result.rows[0];
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

test("BOM material candidates are code-first bounded stable-ID DTOs and line writes revalidate material identity", async () => {
  const pcs = (await pool.query("select id from units where code='PCS'")).rows[0];
  const box = (await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('BOX','箱','BOX','COUNT',true) returning id")).rows[0];
  const disabledUnit = (await pool.query("insert into units(code,name,symbol,unit_type,enabled) values('OFF','停用单位','OFF','COUNT',false) returning id")).rows[0];
  const materials = {};
  for (const [key, code, name, version] of [
    ["pcb", "CYD-RB_PCB-990001", "合成测试控制板", 3],
    ["pcbPrefix", "CYD-RB_PCB-990001-ALT", "合成测试控制板前缀项", 1],
    ["sensor", "CYD-RB_SENSOR-990003", "合成温度传感器", 2],
    ["conn", "CYD-RB_CONN-990075", "合成微型连接器", 4],
    ["metal", "CYD-RB_METAL-990015", "合成金属外壳", 5],
  ]) materials[key] = await insertSelectorMaterial({ code, name, unitId: pcs.id, version });
  await pool.query("update material_master set base_unit_id=null where id=$1", [materials.pcb.id]);
  materials.frozen = await insertSelectorMaterial({ code: "CYD-RB_CONN-999999", name: "不可选物料", status: "FROZEN", unitId: pcs.id });
  await insertSelectorMaterial({ code: "CYD-RB_CONN-999999-ALT", name: "不应由冻结精确编码回退命中", unitId: pcs.id });
  await insertSelectorMaterial({ code: "CYD-RB_CONN-999998", name: "停用单位物料", unitId: disabledUnit.id });
  await insertSelectorMaterial({ code: null, name: "不可选物料", status: "DRAFT", unitId: pcs.id });
  await insertSelectorMaterial({ code: null, name: "不可选物料", status: "PENDING_REVIEW", unitId: pcs.id });

  const category = (await pool.query("select id from material_categories where category_code='TEST_LEAF'")).rows[0];
  await pool.query(`insert into material_master(
    internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,
    inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id
  ) select 'CYD-RB_LIMIT-' || lpad(value::text,6,'0'),'有界候选物料 ' || value,$1,'PCS',$2,'ACTIVE','PURCHASE','STOCK',
    'IQC','ROHS','MANUAL','test','test','test',$3 from generate_series(1,25) value`, [category.id, pcs.id, randomUUID()]);

  const empty = await api(handleBomApi, "/api/bom-material-candidates?q=&limit=20", { role: "engineering" });
  assert.equal(empty.response.status, 200); assert.deepEqual(empty.payload.rows, []);
  for (const [key, code] of [
    ["pcb", "CYD-RB_PCB-990001"],
    ["sensor", "CYD-RB_SENSOR-990003"],
    ["conn", "CYD-RB_CONN-990075"],
    ["metal", "CYD-RB_METAL-990015"],
  ]) {
    const exact = await api(handleBomApi, `/api/bom-material-candidates?q=${encodeURIComponent(code)}&limit=20`, { role: "engineering" });
    assert.equal(exact.response.status, 200); assert.equal(exact.payload.rows.length, 1);
    assert.deepEqual(Object.keys(exact.payload.rows[0]).sort(), ["internal_code", "material_id", "name", "status", "unit", "unit_id", "version"]);
    assert.equal(exact.payload.rows[0].material_id, Number(materials[key].id));
    assert.equal(exact.payload.rows[0].internal_code, code); assert.equal(exact.payload.rows[0].unit, "PCS");
    assert.equal(exact.payload.rows[0].status, "ACTIVE"); assert.equal(exact.payload.rows[0].version, Number(materials[key].version));
    assert.ok(Number.isSafeInteger(exact.payload.rows[0].material_id)); assert.ok(Number.isSafeInteger(exact.payload.rows[0].unit_id));
  }
  const prefix = await api(handleBomApi, "/api/bom-material-candidates?q=CYD-RB_SENSOR-99&limit=20", { role: "engineering" });
  assert.deepEqual(prefix.payload.rows.map((row) => row.internal_code), ["CYD-RB_SENSOR-990003"]);
  const byName = await api(handleBomApi, `/api/bom-material-candidates?q=${encodeURIComponent("微型连接器")}&limit=20`, { role: "engineering" });
  assert.deepEqual(byName.payload.rows.map((row) => row.material_id), [Number(materials.conn.id)]);
  const excluded = await api(handleBomApi, `/api/bom-material-candidates?q=${encodeURIComponent("不可选物料")}&limit=20`, { role: "engineering" });
  assert.deepEqual(excluded.payload.rows, []);
  const ineligibleExact = await api(handleBomApi, `/api/bom-material-candidates?q=${encodeURIComponent("CYD-RB_CONN-999999")}&limit=20`, { role: "engineering" });
  assert.deepEqual(ineligibleExact.payload.rows, []);
  const disabledUnitExact = await api(handleBomApi, `/api/bom-material-candidates?q=${encodeURIComponent("CYD-RB_CONN-999998")}&limit=20`, { role: "engineering" });
  assert.deepEqual(disabledUnitExact.payload.rows, []);
  const bounded = await api(handleBomApi, `/api/bom-material-candidates?q=${encodeURIComponent("有界候选物料")}&limit=999`, { role: "engineering" });
  assert.equal(bounded.payload.rows.length, 20);
  assert.ok(bounded.payload.rows.every((row) => row.status === "ACTIVE" && row.internal_code));

  const product = await api(handleMasterDataApi, "/api/products", { method: "POST", role: "engineering", body: { product_name: "BOM 选择器合成产品", product_version: "A0" } });
  assert.equal(product.response.status, 201);
  const productId = Number(product.payload.data.id); const productVersionId = Number(product.payload.data.current_version.id);
  const releasedProduct = await api(handleMasterDataApi, `/api/products/${productId}/versions/${productVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  assert.equal(releasedProduct.response.status, 200);
  const bom = await api(handleBomApi, "/api/boms", { method: "POST", role: "engineering", body: { product_id: productId, version_code: "V1" } });
  assert.equal(bom.response.status, 201); const bomId = Number(bom.payload.bom_id);

  const missing = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: Number.MAX_SAFE_INTEGER, quantity_per: "1", unit_id: Number(pcs.id) } });
  assert.equal(missing.response.status, 422);
  const inactive = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: Number(materials.frozen.id), quantity_per: "1", unit_id: Number(pcs.id) } });
  assert.equal(inactive.response.status, 422);
  const wrongUnit = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: Number(materials.pcb.id), quantity_per: "1", unit_id: Number(box.id) } });
  assert.equal(wrongUnit.response.status, 422);
  const zeroQuantity = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: Number(materials.sensor.id), quantity_per: "0", unit_id: Number(pcs.id) } });
  assert.equal(zeroQuantity.response.status, 400);
  const overPrecision = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: Number(materials.sensor.id), quantity_per: "1.0000001", unit_id: Number(pcs.id) } });
  assert.equal(overPrecision.response.status, 400);
  const line = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 1, material_id: Number(materials.pcb.id), quantity_per: "1.250000", unit_id: Number(pcs.id), process_stage: "SMT" } });
  assert.equal(line.response.status, 201); assert.equal(Number(line.payload.data.material_id), Number(materials.pcb.id)); assert.equal(Number(line.payload.data.unit_id), Number(pcs.id));
  const duplicate = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 2, material_id: Number(materials.pcb.id), quantity_per: "2", unit_id: Number(pcs.id), process_stage: "ASSEMBLY" } });
  assert.equal(duplicate.response.status, 409);
  const persisted = await pool.query("select material_id,unit_id,quantity_per::text quantity_per from bom_lines where bom_version_id=$1", [bom.payload.data.current_version.id]);
  assert.deepEqual(persisted.rows, [{ material_id: String(materials.pcb.id), unit_id: String(pcs.id), quantity_per: "1.250000" }]);
});

test("BOM search is bounded and RELEASED line add update delete stay transactionally immutable", async () => {
  const unit = (await pool.query("select id from units where code='PCS'")).rows[0];
  const originalMaterial = (await pool.query("select id from material_master where internal_material_code='CYD-TEST-000001'")).rows[0];
  const secondMaterial = await insertSelectorMaterial({ code: "CYD-TEST-000002", name: "第二合成物料", unitId: unit.id });
  const product = await api(handleMasterDataApi, "/api/products", { method: "POST", role: "engineering", body: { product_name: "BOM 搜索与不可变合成产品", product_version: "A0" } });
  assert.equal(product.response.status, 201);
  const productId = Number(product.payload.data.id); const productVersionId = Number(product.payload.data.current_version.id);
  await api(handleMasterDataApi, `/api/products/${productId}/versions/${productVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  const created = await api(handleBomApi, "/api/boms", { method: "POST", role: "engineering", body: { product_id: productId, bom_code: "BOM-SEARCH-IMMUTABLE", version_code: "V1" } });
  assert.equal(created.response.status, 201); const bomId = Number(created.payload.bom_id); const bomVersionId = Number(created.payload.data.current_version.id);

  for (const query of ["BOM-SEARCH", product.payload.data.product_code, "不可变合成产品"]) {
    const found = await api(handleBomApi, `/api/boms?q=${encodeURIComponent(query)}&limit=999`, { role: "engineering" });
    assert.equal(found.response.status, 200); assert.equal(found.payload.limit, 20);
    assert.deepEqual(found.payload.rows.map((row) => Number(row.id)), [bomId]);
    assert.ok(found.payload.rows.every((row) => !("lines" in row)));
  }
  const emptySearch = await api(handleBomApi, "/api/boms?q=&limit=20", { role: "engineering" });
  assert.deepEqual(emptySearch.payload.rows, []);

  const draftLine = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 10, material_id: Number(originalMaterial.id), quantity_per: "1", unit_id: Number(unit.id), loss_rate: "0" } });
  assert.equal(draftLine.response.status, 201); const lineId = Number(draftLine.payload.data.id);
  const updated = await api(handleBomApi, `/api/bom-lines/${lineId}`, { method: "PATCH", role: "engineering", body: { bom_id: bomId, line_no: 20, quantity_per: "2", loss_rate: "0.1", process_stage: "ASSEMBLY" } });
  assert.equal(updated.response.status, 200); assert.equal(updated.payload.data.quantity_per, "2.000000"); assert.equal(updated.payload.data.loss_rate, "0.10000000");
  const deleted = await api(handleBomApi, `/api/bom-lines/${lineId}`, { method: "DELETE", role: "engineering", body: { bom_id: bomId } });
  assert.equal(deleted.response.status, 200); assert.equal(deleted.payload.deleted, true);
  assert.equal(Number((await pool.query("select count(*) count from bom_lines where bom_version_id=$1", [bomVersionId])).rows[0].count), 0);
  const restoredLine = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 10, material_id: Number(originalMaterial.id), quantity_per: "1", unit_id: Number(unit.id), loss_rate: "0" } });
  const releasedLineId = Number(restoredLine.payload.data.id);
  const released = await api(handleBomApi, `/api/boms/${bomId}/versions/${bomVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  assert.equal(released.response.status, 200);

  const before = (await pool.query(`select h.version header_version,v.status version_status,
    (select count(*)::int from bom_versions where bom_header_id=h.id) version_count,
    (select count(*)::int from bom_lines where bom_version_id=v.id) line_count,
    (select count(*)::int from audit_log where result='success' and action in ('BOM_LINE_ADDED','BOM_LINE_UPDATED','BOM_LINE_DELETED')) success_audits,
    (select count(*)::int from idempotency_keys where path in ('/api/bom-lines','/api/bom-lines/${releasedLineId}')) idempotency_count
    from bom_headers h join bom_versions v on v.id=$2 where h.id=$1`, [bomId, bomVersionId])).rows[0];
  const attempts = [
    await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: bomId, line_no: 20, material_id: Number(secondMaterial.id), quantity_per: "1", unit_id: Number(unit.id), loss_rate: "0" } }),
    await api(handleBomApi, `/api/bom-lines/${releasedLineId}`, { method: "PATCH", role: "engineering", body: { bom_id: bomId, quantity_per: "9" } }),
    await api(handleBomApi, `/api/bom-lines/${releasedLineId}`, { method: "DELETE", role: "engineering", body: { bom_id: bomId } }),
  ];
  for (const attempt of attempts) { assert.equal(attempt.response.status, 409); assert.equal(attempt.payload.code, "BOM_RELEASED_IMMUTABLE"); }
  const after = (await pool.query(`select h.version header_version,v.status version_status,
    (select count(*)::int from bom_versions where bom_header_id=h.id) version_count,
    (select count(*)::int from bom_lines where bom_version_id=v.id) line_count,
    (select count(*)::int from audit_log where result='success' and action in ('BOM_LINE_ADDED','BOM_LINE_UPDATED','BOM_LINE_DELETED')) success_audits,
    (select count(*)::int from idempotency_keys where path in ('/api/bom-lines','/api/bom-lines/${releasedLineId}')) idempotency_count
    from bom_headers h join bom_versions v on v.id=$2 where h.id=$1`, [bomId, bomVersionId])).rows[0];
  assert.deepEqual(after, before);
  assert.equal(Number((await pool.query("select count(*) count from audit_log where result='failed' and action in ('BOM_LINE_ADDED','BOM_LINE_UPDATED','BOM_LINE_DELETED') and error_code='BOM_RELEASED_IMMUTABLE'")).rows[0].count), 3);

  await assert.rejects(pool.query("insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,created_by,updated_by,request_id) values($1,30,$2,1,$3,0,'test','test',$4)", [bomVersionId, secondMaterial.id, unit.id, randomUUID()]), /released bom lines are immutable/);
  await assert.rejects(pool.query("update bom_lines set quantity_per=3 where id=$1", [releasedLineId]), /released bom lines are immutable/);
  await assert.rejects(pool.query("delete from bom_lines where id=$1", [releasedLineId]), /released bom lines are immutable/);
  assert.equal(Number((await pool.query("select count(*) count from bom_lines where bom_version_id=$1", [bomVersionId])).rows[0].count), 1);
});

test("BOM release preserves permission idempotency CAS audit rollback and legacy base-unit contracts", async () => {
  const material = (await pool.query("select id from material_master where internal_material_code='CYD-TEST-000001'")).rows[0];
  const unit = (await pool.query("select id from units where code='PCS'")).rows[0];
  await pool.query("update material_master set base_unit_id=null where id=$1", [material.id]);
  const legacyUnit = (await pool.query("select base_unit_id,base_uom from material_master where id=$1", [material.id])).rows[0];
  assert.equal(legacyUnit.base_unit_id, null); assert.equal(legacyUnit.base_uom, "PCS");

  const product = await api(handleMasterDataApi, "/api/products", { method: "POST", role: "engineering", body: { product_name: "BOM 发布合同合成产品", product_version: "A0" } });
  assert.equal(product.response.status, 201);
  const productId = Number(product.payload.data.id); const productVersionId = Number(product.payload.data.current_version.id);
  const productRelease = await api(handleMasterDataApi, `/api/products/${productId}/versions/${productVersionId}/release`, { method: "POST", role: "engineering", body: { expected_version: 1 } });
  assert.equal(productRelease.response.status, 200);

  const createDraftBom = async (versionCode) => {
    const created = await api(handleBomApi, "/api/boms", { method: "POST", role: "engineering", body: { product_id: productId, version_code: versionCode } });
    assert.equal(created.response.status, 201);
    const headerId = Number(created.payload.bom_id); const versionId = Number(created.payload.data.current_version.id);
    const line = await api(handleBomApi, "/api/bom-lines", { method: "POST", role: "engineering", body: { bom_id: headerId, line_no: 1, material_id: Number(material.id), quantity_per: "1.000000", unit_id: Number(unit.id) } });
    assert.equal(line.response.status, 201);
    return { headerId, versionId };
  };

  const releasable = await createDraftBom("V1");
  const readiness = await api(handleBomApi, `/api/bom-readiness?bom_id=${releasable.headerId}&order_qty=1`, { role: "engineering" });
  assert.equal(readiness.response.status, 200); assert.equal(readiness.payload.structure_ready, true);
  assert.notEqual(readiness.payload.rows[0].readiness_status, "UNIT_CONVERSION_REQUIRED");

  const releasePath = `/api/boms/${releasable.headerId}/versions/${releasable.versionId}/release`;
  const denied = await api(handleBomApi, releasePath, { method: "POST", role: "warehouse", body: { expected_version: 1 } });
  assert.equal(denied.response.status, 403); assert.equal(denied.payload.code, "PERMISSION_DENIED");

  const releaseKey = "bom-release-contract-0001";
  const released = await api(handleBomApi, releasePath, { method: "POST", role: "engineering", key: releaseKey, body: { expected_version: 1 } });
  assert.equal(released.response.status, 200); assert.equal(released.payload.data.status, "RELEASED");
  const replay = await api(handleBomApi, releasePath, { method: "POST", role: "engineering", key: releaseKey, body: { expected_version: 1 } });
  assert.equal(replay.response.status, 200); assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(Number(replay.payload.data.id), releasable.versionId);
  const idempotencyConflict = await api(handleBomApi, releasePath, { method: "POST", role: "engineering", key: releaseKey, body: { expected_version: 2 } });
  assert.equal(idempotencyConflict.response.status, 409); assert.equal(idempotencyConflict.payload.code, "IDEMPOTENCY_CONFLICT");
  const stale = await api(handleBomApi, releasePath, { method: "POST", role: "engineering", key: "bom-release-stale-0001", body: { expected_version: 1 } });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.code, "VERSION_CONFLICT");

  const releaseState = (await pool.query(`select h.version,v.status from bom_headers h join bom_versions v on v.id=$2 and v.bom_header_id=h.id where h.id=$1`, [releasable.headerId, releasable.versionId])).rows[0];
  assert.equal(Number(releaseState.version), 2); assert.equal(releaseState.status, "RELEASED");
  const successAudits = await pool.query("select detail,old_version,new_version from audit_log where action='BOM_VERSION_RELEASED' and result='success'");
  assert.equal(successAudits.rows.length, 1); assert.equal(Number(successAudits.rows[0].detail.target_id), releasable.versionId);
  assert.equal(Number(successAudits.rows[0].old_version), 1); assert.equal(Number(successAudits.rows[0].new_version), 2);
  const persistedReleaseKeys = await pool.query("select count(*) count from idempotency_keys where username='engineering01' and method='POST' and path=$1", [releasePath]);
  assert.equal(Number(persistedReleaseKeys.rows[0].count), 1);

  const rollbackDraft = await createDraftBom("V2");
  const rollbackPath = `/api/boms/${rollbackDraft.headerId}/versions/${rollbackDraft.versionId}/release`;
  try {
    await pool.query(`create or replace function fail_bom_release_audit_for_test() returns trigger language plpgsql as $$
      begin
        if new.action='BOM_VERSION_RELEASED' and new.result='success' then raise exception 'forced BOM release audit failure'; end if;
        return new;
      end $$`);
    await pool.query("create trigger fail_bom_release_audit_for_test before insert on audit_log for each row execute function fail_bom_release_audit_for_test()");
    const failed = await api(handleBomApi, rollbackPath, { method: "POST", role: "engineering", key: "bom-release-audit-failure-0001", body: { expected_version: 1 } });
    assert.equal(failed.response.status, 500); assert.equal(failed.payload.code, "INTERNAL_ERROR");

    const rolledBack = (await pool.query(`select h.version,v.status,v.released_at from bom_headers h join bom_versions v on v.id=$2 and v.bom_header_id=h.id where h.id=$1`, [rollbackDraft.headerId, rollbackDraft.versionId])).rows[0];
    assert.equal(Number(rolledBack.version), 1); assert.equal(rolledBack.status, "DRAFT"); assert.equal(rolledBack.released_at, null);
    assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where username='engineering01' and method='POST' and path=$1", [rollbackPath])).rows[0].count), 0);
    assert.equal(Number((await pool.query("select count(*) count from audit_log where action='BOM_VERSION_RELEASED' and result='success' and detail->>'target_id'=$1", [String(rollbackDraft.versionId)])).rows[0].count), 0);
    const failureAudit = (await pool.query("select action,result,error_code from audit_log where request_id=$1", [failed.payload.request_id])).rows[0];
    assert.deepEqual(failureAudit, { action: "BOM_VERSION_RELEASED", result: "failed", error_code: "INTERNAL_ERROR" });
  } finally {
    await pool.query("drop trigger if exists fail_bom_release_audit_for_test on audit_log");
    await pool.query("drop function if exists fail_bom_release_audit_for_test()");
  }
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
