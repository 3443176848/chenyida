import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { handleBomApi } from "../app/lib/bom-selfhost/handler.ts";
import { handleFinanceApi } from "../app/lib/finance-selfhost/handler.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";
import { handleMasterDataApi } from "../app/lib/master-data-selfhost/handler.ts";
import { handleMaterialRequirementApi } from "../app/lib/material-requirement-selfhost/handler.ts";
import { handleSelfhostMaterialApi } from "../app/lib/material-selfhost/handler.ts";
import { handlePlanningHandoffApi } from "../app/lib/planning-handoff-selfhost/handler.ts";
import { handleProcurementFulfillmentApi } from "../app/lib/procurement-fulfillment-selfhost/handler.ts";
import { handleProcurementSourcingApi } from "../app/lib/procurement-sourcing-selfhost/handler.ts";
import { handleProductionHandoffApi } from "../app/lib/production-handoff-selfhost/handler.ts";
import { ProductionOperationService } from "../app/lib/production-operation-selfhost/service.ts";
import { ProductionRoutingService } from "../app/lib/production-routing-selfhost/service.ts";
import { handleProductionApi } from "../app/lib/production-selfhost/handler.ts";
import { ProductionRepository } from "../app/lib/production-selfhost/repository.ts";
import { handleProjectApi } from "../app/lib/project-selfhost/handler.ts";
import { handleQualityApi } from "../app/lib/quality-selfhost/handler.ts";
import { handleSalesApi } from "../app/lib/sales-selfhost/handler.ts";
import { handleSupplierMappingApi } from "../app/lib/supplier-mapping-selfhost/handler.ts";

const REQUIRED_DATABASE = "small_team_golden_journey_test";
const REQUIRED_CONFIRMATION = "ISOLATED_SYNTHETIC_0046_ONLY";
const databaseUrl = process.env.TEST_UNIFIED_GOLDEN_JOURNEY_DATABASE_URL || "";
let configuredDatabase = "";
try {
  configuredDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  configuredDatabase = "";
}
if (configuredDatabase !== REQUIRED_DATABASE) {
  throw new Error(`TEST_UNIFIED_GOLDEN_JOURNEY_DATABASE_URL must target exact isolated database ${REQUIRED_DATABASE}`);
}
if (process.env.ERP_UNIFIED_GOLDEN_JOURNEY_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_UNIFIED_GOLDEN_JOURNEY_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  application_name: "small-team-unified-golden-journey-test",
});

const roleActor = (role, username = `${role}01`) => ({
  username,
  display_name: username,
  role,
  is_active: true,
  must_change_password: false,
  version: 1,
  last_login_at: null,
  permissions: permissionsForRole(role),
});

const materialCreator = {
  ...roleActor("purchase", "purchase01"),
  permissions: ["material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit"],
};
const materialReviewer = {
  ...roleActor("manager", "manager01"),
  permissions: ["material.read", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read"],
};

async function call(handler, path, {
  method = "GET",
  role = "admin",
  username,
  actorOverride,
  body,
  key = randomUUID(),
  csrf = true,
} = {}) {
  const requestId = randomUUID();
  const headers = new Headers({ "X-Request-ID": requestId });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Idempotency-Key", key);
  if (csrf) headers.set("X-CSRF-Token", "test-csrf");
  const request = new Request(`http://local.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, {
    pool,
    actor: actorOverride || roleActor(role, username),
    requestId,
    requireCsrf: () => {
      if (headers.get("X-CSRF-Token") !== "test-csrf") {
        throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 });
      }
    },
  });
  assert.ok(response, `route not handled: ${method} ${path}`);
  return { response, payload: await response.json(), requestId };
}

function expectStatus(result, expected, label) {
  assert.equal(result.response.status, expected, `${label}: ${JSON.stringify(result.payload)}`);
  return result;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function serviceMeta(role, action, marker, username = `${role}01`) {
  return {
    actor: roleActor(role, username),
    requestId: randomUUID(),
    operationId: randomUUID(),
    keyDigest: digest(`golden-key:${marker}`),
    requestDigest: digest(`golden-body:${marker}`),
    method: "POST",
    route: `/isolated/golden-journey/${marker}`,
    action,
  };
}

async function seedIdentityAndMaterialTaxonomy() {
  await pool.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password) values
    ('admin01','管理员','admin','test-only',true,false),
    ('manager01','经理','manager','test-only',true,false),
    ('sales01','市场','sales','test-only',true,false),
    ('engineering01','工程','engineering','test-only',true,false),
    ('planning01','计划','planning','test-only',true,false),
    ('purchase01','采购','purchase','test-only',true,false),
    ('operations01','运营','operations','test-only',true,false),
    ('production01','生产','production','test-only',true,false),
    ('warehouse01','仓库','warehouse','test-only',true,false),
    ('quality01','品质','quality','test-only',true,false),
    ('finance01','财务','finance','test-only',true,false)`);
  const unit = (await pool.query(
    "insert into units(code,name,symbol,unit_type,enabled) values('PCS','件','PCS','COUNT',true) returning id",
  )).rows[0];
  const requestId = randomUUID();
  const root = (await pool.query(`insert into material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id
    ) values('GJ_ROOT','黄金旅程物料',null,1,'ACTIVE',1,'admin01','admin01',$1) returning id`, [requestId])).rows[0];
  const levelTwo = Number((await pool.query(`insert into material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id
    ) values('GJ_PARTS','黄金旅程零部件',$1,2,'ACTIVE',1,'admin01','admin01',$2) returning id`, [root.id, requestId])).rows[0].id);
  const levelThree = (await pool.query(`insert into material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id
    ) values('GJ_CONTROL',$1,$2,3,'ACTIVE',1,'admin01','admin01',$3) returning id`, ["黄金旅程控制件", levelTwo, requestId])).rows[0];
  const leaf = (await pool.query(`insert into material_categories(
      category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id
    ) values('GJ_ITEM','黄金旅程标准件',$1,4,'ACTIVE',1,'admin01','admin01',$2) returning id`, [levelThree.id, requestId])).rows[0];
  const attribute = (await pool.query(`insert into material_attribute_definitions(
      attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,normalization_rule,status,created_by,updated_by,request_id
    ) values('GJ_KIND','黄金旅程类型','TEXT',0,'','[]'::jsonb,'TRIM_UPPER','ACTIVE','admin01','admin01',$1) returning id`, [requestId])).rows[0];
  await pool.query(`insert into material_category_attributes(
      category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,updated_by,request_id
    ) values($1,$2,true,true,true,10,'ACTIVE','admin01','admin01',$3)`, [leaf.id, attribute.id, requestId]);
  return { unitId: Number(unit.id), categoryId: Number(leaf.id) };
}

function materialDraft(categoryId, { name, kind, procurementType, inspectionType }) {
  return {
    category_id: categoryId,
    basic_fields: {
      standard_name: name,
      unit: "PCS",
      brand: "",
      manufacturer: "",
      manufacturer_part_number: "",
      procurement_type: procurementType,
      inventory_type: "STOCKED",
      lot_control_required: false,
      shelf_life_days: null,
      inspection_type: inspectionType,
      environmental_requirement: "ROHS",
      source_type: "MANUAL",
    },
    attributes: {
      GJ_KIND: { value: kind, unit: "", source: "MANUAL", confidence: 1 },
    },
  };
}

async function approveMaterial(categoryId, input, { key, assertReplay = false } = {}) {
  const body = materialDraft(categoryId, input);
  const created = expectStatus(await call(handleSelfhostMaterialApi, "/api/material-master/drafts", {
    method: "POST",
    actorOverride: materialCreator,
    key,
    body,
  }), 201, `create ${input.kind} material`);
  if (assertReplay) {
    const replay = expectStatus(await call(handleSelfhostMaterialApi, "/api/material-master/drafts", {
      method: "POST",
      actorOverride: materialCreator,
      key,
      body,
    }), 201, `replay ${input.kind} material`);
    assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
    assert.equal(replay.payload.data.material_id, created.payload.data.material_id);
  }
  const materialId = Number(created.payload.data.material_id);
  const submitted = expectStatus(await call(handleSelfhostMaterialApi, `/api/material-master/drafts/${materialId}/submit`, {
    method: "POST",
    actorOverride: materialCreator,
    body: { expected_version: Number(created.payload.data.version), submit_comment: "黄金旅程提交审核" },
  }), 200, `submit ${input.kind} material`);
  const approved = expectStatus(await call(handleSelfhostMaterialApi, `/api/material-master/drafts/${materialId}/approve`, {
    method: "POST",
    actorOverride: materialReviewer,
    body: { expected_version: Number(submitted.payload.data.version), review_comment: "黄金旅程异人审核通过" },
  }), 200, `approve ${input.kind} material`);
  assert.equal(approved.payload.data.material_status, "ACTIVE");
  return { id: materialId, code: approved.payload.data.internal_material_code };
}

async function attachBaseUnit(unitId, materialIds) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('cyd.material_service_write','allowed',true)");
    await client.query("update material_master set base_unit_id=$1 where id=any($2::bigint[])", [unitId, materialIds]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function mappingBody(refs) {
  return {
    supplier_id: refs.supplierId,
    material_id: refs.rawMaterialId,
    supplier_item_code: "GJ-SUP-RAW-001",
    supplier_item_name: "黄金旅程供应商原料",
    supplier_specification: "受控合成规格",
    manufacturer: "合成制造商",
    mpn: "GJ-MPN-001",
    revision: "A",
    purchase_unit_id: refs.unitId,
    conversion_numerator: 1,
    conversion_denominator: 1,
    valid_from: "2026-08-01",
    valid_to: "",
  };
}

function buildAwardBody(detail) {
  const current = detail.comparison_read_model.current_version;
  assert.equal(current.status, "CURRENT");
  return {
    expected_version: Number(detail.header.version),
    expected_rfq_code: detail.header.rfq_code,
    expected_round_no: Number(detail.header.round_no),
    expected_comparison_version: Number(current.comparison_version_no),
    expected_comparison_output_digest: current.output_summary.digest,
    reason_code: "SOLE_SOURCE",
    reason: "仅有一个有效报价，已核对价格、交期、MOQ及正式Supplier Mapping。",
    lines: detail.lines.map((line) => {
      const material = current.material_summaries.find((row) => String(row.rfq_line_id) === String(line.id));
      const candidate = material?.offers[0];
      const identity = current.comparison_rows.find((row) => row.comparison_line_id === material?.comparison_line_id);
      assert.ok(material && candidate && identity);
      return {
        rfq_line_id: String(line.id),
        comparison_line_id: String(material.comparison_line_id),
        comparison_basis_digest: identity.basis_digest,
        selected_candidate_id: String(candidate.comparison_candidate_id),
        expected_quote_id: String(candidate.quote_id),
        expected_quote_version_no: Number(candidate.quote_version_no),
        selection_reason: "",
        late_delivery_reason_code: "",
        late_delivery_reason: "",
        excess_quantity_reason: "",
      };
    }),
  };
}

async function receiptBody(deliveryPlanId, quantity) {
  const preview = expectStatus(await call(
    handleProcurementFulfillmentApi,
    `/api/procurement/delivery-plans/${deliveryPlanId}/receipt-preview?quantity=${encodeURIComponent(quantity)}`,
    { role: "warehouse" },
  ), 200, "preview warehouse receipt");
  const readiness = preview.payload.data;
  return {
    ...readiness.confirmation,
    quantity,
    supplier_lot_code: readiness.selected_receipt.supplier_lot.applicability === "REQUIRED_FOR_IQC"
      ? `GJ-LOT-${randomUUID()}`
      : "",
    evidence_type: "DELIVERY_NOTE",
    evidence_reference: `GJ-${randomUUID()}`,
    evidence_document_date: readiness.selected_receipt.server_date_shanghai,
    early_arrival_reason: readiness.selected_receipt.is_early_arrival ? "黄金旅程提前到货证据" : "",
    early_arrival_confirmed: readiness.selected_receipt.is_early_arrival,
    physical_receipt_confirmed: true,
    reason: "黄金旅程物理收货",
  };
}

test.before(async () => {
  assert.equal((await pool.query("select current_database() name")).rows[0].name, REQUIRED_DATABASE);
  const migrations = await pool.query("select version from schema_migrations order by version");
  assert.equal(migrations.rows.length, 46, "golden journey requires the complete 0046 schema");
  assert.equal(migrations.rows.at(-1).version, "0046_runtime_lock_privilege_boundary.sql");
  const empty = await pool.query(`select
    (select count(*)::int from app_users) users,
    (select count(*)::int from material_master) materials,
    (select count(*)::int from business_projects) projects,
    (select count(*)::int from purchase_orders) purchase_orders,
    (select count(*)::int from production_work_orders) work_orders,
    (select count(*)::int from sales_orders) sales_orders,
    (select count(*)::int from finance_documents) finance_documents`);
  assert.deepEqual(empty.rows[0], {
    users: 0,
    materials: 0,
    projects: 0,
    purchase_orders: 0,
    work_orders: 0,
    sales_orders: 0,
    finance_documents: 0,
  }, "golden journey refuses a reused business database");
});

test.after(async () => pool.end());

test("one fresh 0046 database carries stable identities from governed master data through finance reversal", async () => {
  const taxonomy = await seedIdentityAndMaterialTaxonomy();
  const raw = await approveMaterial(taxonomy.categoryId, {
    name: "黄金旅程原材料",
    kind: "RAW",
    procurementType: "PURCHASE",
    inspectionType: "NONE",
  }, { key: "golden-material-raw", assertReplay: true });
  const finished = await approveMaterial(taxonomy.categoryId, {
    name: "黄金旅程成品",
    kind: "FINISHED",
    procurementType: "SELF_MADE",
    inspectionType: "FULL",
  }, { key: "golden-material-finished" });
  await attachBaseUnit(taxonomy.unitId, [raw.id, finished.id]);

  const customer = expectStatus(await call(handleMasterDataApi, "/api/customers", {
    method: "POST",
    role: "sales",
    body: { customer_name: "黄金旅程客户" },
  }), 201, "create customer");
  const supplier = expectStatus(await call(handleMasterDataApi, "/api/suppliers", {
    method: "POST",
    role: "purchase",
    body: { supplier_name: "黄金旅程供应商" },
  }), 201, "create supplier");
  const refs = {
    unitId: taxonomy.unitId,
    rawMaterialId: raw.id,
    finishedMaterialId: finished.id,
    customerId: Number(customer.payload.data.id),
    supplierId: Number(supplier.payload.data.id),
  };

  const product = expectStatus(await call(handleMasterDataApi, "/api/products", {
    method: "POST",
    role: "engineering",
    body: {
      product_name: "黄金旅程控制板",
      customer_id: refs.customerId,
      product_type: "PCB",
      product_version: "A0",
      layer_count: 4,
    },
  }), 201, "create product");
  refs.productId = Number(product.payload.data.id);
  refs.productVersionId = Number(product.payload.data.current_version.id);
  expectStatus(await call(handleMasterDataApi, `/api/products/${refs.productId}/versions/${refs.productVersionId}/release`, {
    method: "POST",
    role: "engineering",
    body: { expected_version: 1 },
  }), 200, "release product version");

  const bom = expectStatus(await call(handleBomApi, "/api/boms", {
    method: "POST",
    role: "engineering",
    body: { product_id: refs.productId, bom_version: "A0" },
  }), 201, "create BOM");
  refs.bomHeaderId = Number(bom.payload.bom_id);
  refs.bomVersionId = Number(bom.payload.data.current_version.id);
  expectStatus(await call(handleBomApi, "/api/bom-lines", {
    method: "POST",
    role: "engineering",
    body: {
      bom_id: refs.bomHeaderId,
      line_no: 1,
      material_id: refs.rawMaterialId,
      quantity_per: "1.000000",
      unit_id: refs.unitId,
      loss_rate: "0",
      process_stage: "ASSEMBLY",
    },
  }), 201, "create BOM line");
  expectStatus(await call(handleBomApi, `/api/boms/${refs.bomHeaderId}/versions/${refs.bomVersionId}/release`, {
    method: "POST",
    role: "engineering",
    body: { expected_version: 1 },
  }), 200, "release BOM");

  const retiredMapping = await call(handleMasterDataApi, "/api/mappings", {
    method: "POST",
    role: "purchase",
    body: {
      supplier_id: refs.supplierId,
      material_id: refs.rawMaterialId,
      purchase_unit_id: refs.unitId,
      supplier_item_code: "RETIRED-GJ",
      valid_from: "2026-08-01T00:00:00.000Z",
    },
  });
  assert.equal(retiredMapping.response.status, 409);
  assert.equal(retiredMapping.payload.code, "SUPPLIER_MAPPING_GOVERNANCE_REQUIRED");

  const governedMappingBody = mappingBody(refs);
  const mappingKey = "golden-supplier-mapping-create";
  const mappingCreated = expectStatus(await call(handleSupplierMappingApi, "/api/supplier-mappings", {
    method: "POST",
    role: "purchase",
    key: mappingKey,
    body: governedMappingBody,
  }), 201, "create Supplier Mapping draft");
  const mappingReplay = expectStatus(await call(handleSupplierMappingApi, "/api/supplier-mappings", {
    method: "POST",
    role: "purchase",
    key: mappingKey,
    body: governedMappingBody,
  }), 201, "replay Supplier Mapping draft");
  assert.equal(mappingReplay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(mappingReplay.payload.mapping_id, mappingCreated.payload.mapping_id);
  refs.mappingUid = String(mappingCreated.payload.mapping_id);
  const mappingSubmitted = expectStatus(await call(
    handleSupplierMappingApi,
    `/api/supplier-mappings/${refs.mappingUid}/submit`,
    {
      method: "POST",
      role: "purchase",
      body: { expected_version: Number(mappingCreated.payload.expected_version) },
    },
  ), 200, "submit Supplier Mapping");
  const mappingApproved = expectStatus(await call(
    handleSupplierMappingApi,
    `/api/supplier-mappings/${refs.mappingUid}/approve`,
    {
      method: "POST",
      role: "operations",
      body: {
        expected_version: Number(mappingSubmitted.payload.expected_version),
        review_comment: "UAT审核通过：供应商、正式物料、PCS单位及1:1换算核对一致。",
      },
    },
  ), 200, "approve Supplier Mapping by another function");
  refs.mappingVersionId = String(mappingApproved.payload.mapping_version_id);

  const projectBody = {
    customer_id: refs.customerId,
    project_name: "黄金旅程客户项目",
    project_goal: "用一条受控链路交付10件成品",
    target_delivery_date: "2099-10-30",
    customer_requirement_summary: "10件黄金旅程控制板",
    quantity_requirement: "10.000000",
    quantity_unit: "PCS",
    delivery_requirement: "整批交付",
    commercial_terms: "CNY，测试条款",
    technical_requirements: "使用已发布产品与BOM",
    items: [{
      provisional_name: "黄金旅程控制板",
      quantity: "10.000000",
      unit_id: refs.unitId,
      unit_pending: false,
      specification_requirement: "A0版本",
    }],
  };
  const deniedProject = await call(handleProjectApi, "/api/projects", {
    method: "POST",
    role: "warehouse",
    body: projectBody,
  });
  assert.equal(deniedProject.response.status, 403, JSON.stringify(deniedProject.payload));
  const project = expectStatus(await call(handleProjectApi, "/api/projects", {
    method: "POST",
    role: "sales",
    body: projectBody,
  }), 201, "market creates project");
  refs.projectId = Number(project.payload.project_id);
  expectStatus(await call(handleProjectApi, `/api/projects/${refs.projectId}/submit`, {
    method: "POST",
    role: "sales",
    body: { expected_version: 1 },
  }), 200, "market submits project");
  expectStatus(await call(handleProjectApi, `/api/projects/${refs.projectId}/accept`, {
    method: "POST",
    role: "engineering",
    body: { expected_version: 2 },
  }), 200, "engineering accepts project");
  const projectState = (await pool.query(
    "select version,current_requirement_version_no from business_projects where id=$1",
    [refs.projectId],
  )).rows[0];
  const requirementItem = (await pool.query(`select item.id
    from business_projects project
    join project_requirement_versions requirement
      on requirement.project_id=project.id and requirement.version_no=project.current_requirement_version_no
    join project_requirement_items item on item.requirement_version_id=requirement.id
    where project.id=$1`, [refs.projectId])).rows[0];
  refs.requirementItemId = Number(requirementItem.id);

  expectStatus(await call(handlePlanningHandoffApi, `/api/projects/${refs.projectId}/requirement-resolutions`, {
    method: "POST",
    role: "engineering",
    body: {
      expected_version: Number(projectState.version),
      resolutions: [{
        requirement_item_id: refs.requirementItemId,
        product_id: refs.productId,
        product_version_id: refs.productVersionId,
        bom_header_id: refs.bomHeaderId,
        bom_version_id: refs.bomVersionId,
      }],
    },
  }), 200, "engineering fixes stable product and BOM references");
  const planningPackage = expectStatus(await call(
    handlePlanningHandoffApi,
    `/api/projects/${refs.projectId}/planning-packages`,
    {
      method: "POST",
      role: "engineering",
      body: { expected_version: Number(projectState.version) },
    },
  ), 201, "engineering prepares planning package");
  refs.packageId = Number(planningPackage.payload.package_id);
  expectStatus(await call(handlePlanningHandoffApi, `/api/planning-packages/${refs.packageId}/submit`, {
    method: "POST",
    role: "engineering",
    body: { expected_version: 1 },
  }), 200, "engineering submits planning package");
  expectStatus(await call(handlePlanningHandoffApi, `/api/planning-packages/${refs.packageId}/accept`, {
    method: "POST",
    role: "planning",
    body: { expected_version: 2 },
  }), 200, "planning accepts package");
  refs.packageItemId = Number((await pool.query(
    "select id from project_planning_package_items where package_id=$1",
    [refs.packageId],
  )).rows[0].id);

  const requirementPlan = expectStatus(await call(
    handleMaterialRequirementApi,
    `/api/planning-packages/${refs.packageId}/material-requirement-plans`,
    {
      method: "POST",
      role: "planning",
      body: { required_date: "2099-10-20" },
    },
  ), 201, "planning calculates material requirements");
  assert.equal(requirementPlan.payload.lines.length, 1);
  assert.deepEqual({
    gross: requirementPlan.payload.lines[0].grossRequirement,
    stock: requirementPlan.payload.lines[0].stockAvailable,
    inbound: requirementPlan.payload.lines[0].eligibleInbound,
    net: requirementPlan.payload.lines[0].netPurchaseRequirement,
  }, { gross: "10.000000", stock: "0.000000", inbound: "0.000000", net: "10.000000" });
  refs.requirementPlanId = Number(requirementPlan.payload.plan_id);
  const requirementSubmitted = expectStatus(await call(
    handleMaterialRequirementApi,
    `/api/material-requirement-plans/${refs.requirementPlanId}/submit`,
    { method: "POST", role: "planning", body: { expected_version: 1 } },
  ), 200, "planning submits purchase requirement");
  refs.purchaseRequestId = Number(requirementSubmitted.payload.purchase_request.id);
  expectStatus(await call(
    handleMaterialRequirementApi,
    `/api/purchase-requests/${refs.purchaseRequestId}/accept`,
    { method: "POST", role: "purchase", body: { expected_version: 1 } },
  ), 200, "purchase accepts purchase requirement");
  refs.purchaseRequestVersion = Number((await pool.query(
    "select version from planning_purchase_requests where id=$1",
    [refs.purchaseRequestId],
  )).rows[0].version);

  const rfq = expectStatus(await call(handleProcurementSourcingApi, "/api/procurement/rfqs", {
    method: "POST",
    role: "purchase",
    body: {
      purchase_request_id: refs.purchaseRequestId,
      supplier_ids: [refs.supplierId],
      response_deadline: "2099-09-01",
      expected_version: refs.purchaseRequestVersion,
    },
  }), 201, "purchase creates RFQ");
  refs.rfqId = Number(rfq.payload.rfq_id);
  expectStatus(await call(handleProcurementSourcingApi, `/api/procurement/rfqs/${refs.rfqId}/issue`, {
    method: "POST",
    role: "purchase",
    body: { expected_version: 1 },
  }), 200, "purchase issues RFQ");
  const rfqDetail = expectStatus(await call(handleProcurementSourcingApi, `/api/procurement/rfqs/${refs.rfqId}`, {
    role: "purchase",
  }), 200, "read RFQ lines");
  const rfqLineId = Number(rfqDetail.payload.data.lines[0].id);
  expectStatus(await call(handleProcurementSourcingApi, `/api/procurement/rfqs/${refs.rfqId}/quotes`, {
    method: "POST",
    role: "purchase",
    body: {
      expected_version: 2,
      supplier_id: refs.supplierId,
      supplier_quote_reference: "GJ-QUOTE-001",
      valid_until: "2099-12-31",
      tax_included: false,
      freight_included: false,
      payment_terms: "月结30天",
      lines: [{
        rfq_line_id: rfqLineId,
        quoted_quantity: "10.000000",
        minimum_order_quantity: "10.000000",
        unit_price: "12.000000",
        lead_time_days: 10,
        promised_delivery_date: "2099-10-20",
      }],
    },
  }), 201, "record supplier quote");
  expectStatus(await call(handleProcurementSourcingApi, `/api/procurement/rfqs/${refs.rfqId}/comparisons`, {
    method: "POST",
    role: "purchase",
    body: { expected_version: 3 },
  }), 201, "generate quote comparison");
  const compared = expectStatus(await call(handleProcurementSourcingApi, `/api/procurement/rfqs/${refs.rfqId}`, {
    role: "purchase",
  }), 200, "read current quote comparison");
  const award = expectStatus(await call(handleProcurementSourcingApi, `/api/procurement/rfqs/${refs.rfqId}/award`, {
    method: "POST",
    role: "purchase",
    body: buildAwardBody(compared.payload.data),
  }), 201, "create source-bound award");
  refs.awardId = Number(award.payload.award_id);

  const poPreview = expectStatus(await call(
    handleProcurementFulfillmentApi,
    `/api/procurement/awards/${refs.awardId}/purchase-order-conversion-preview`,
    { role: "purchase" },
  ), 200, "preview award conversion");
  assert.equal(poPreview.payload.data.po_convertible_now, true);
  const converted = expectStatus(await call(
    handleProcurementFulfillmentApi,
    `/api/procurement/awards/${refs.awardId}/purchase-orders`,
    {
      method: "POST",
      role: "purchase",
      body: { ...poPreview.payload.data.confirmation, remark: "黄金旅程合成采购订单" },
    },
  ), 201, "convert award to purchase order");
  const purchaseOrder = converted.payload.data.purchase_orders[0];
  refs.purchaseOrderId = Number(purchaseOrder.id);
  refs.purchaseOrderLineId = Number(purchaseOrder.lines[0].id);
  refs.deliveryPlanId = Number(purchaseOrder.delivery_plans[0].id);
  assert.equal(purchaseOrder.lines[0].order_qty, "10.000000");
  assert.equal(purchaseOrder.lines[0].unit_price, "12.000000");
  const warehouseReceipt = expectStatus(await call(
    handleProcurementFulfillmentApi,
    `/api/procurement/delivery-plans/${refs.deliveryPlanId}/receipts`,
    {
      method: "POST",
      role: "warehouse",
      body: await receiptBody(refs.deliveryPlanId, "10"),
    },
  ), 201, "warehouse receives governed purchase order");
  refs.purchaseSourceId = Number(warehouseReceipt.payload.data.financial_source.id);
  assert.equal(warehouseReceipt.payload.data.financial_source.amount, "120.000000");
  const apDocument = expectStatus(await call(handleFinanceApi, "/api/finance/documents", {
    method: "POST",
    role: "finance",
    body: { doc_type: "AP", purchase_source_entry_id: refs.purchaseSourceId },
  }), 201, "finance creates AP from receipt source");
  refs.apDocumentId = Number(apDocument.payload.doc_id);
  assert.equal(apDocument.payload.data.total_amount, "120.000000");

  const productionRepository = new ProductionRepository(pool);
  const routingService = new ProductionRoutingService(productionRepository);
  const workCenter = await routingService.createWorkCenter(
    serviceMeta("admin", "PRODUCTION_WORK_CENTER_CREATED", "work-center"),
    { work_center_code: "GJ-WC", name_cn: "黄金旅程工位", work_center_type: "ASSEMBLY" },
  );
  assert.equal(workCenter.status, 201, JSON.stringify(workCenter.body));
  const routing = await routingService.createRouting(
    serviceMeta("engineering", "PRODUCTION_ROUTING_CREATED", "routing-create"),
    {
      routing_code: "GJ-RT",
      product_id: refs.productId,
      product_version_id: refs.productVersionId,
      version_code: "V1",
      operations: [{
        sequence_no: 10,
        operation_code: "OP10",
        operation_name: "组装",
        work_center_id: Number(workCenter.body.data.id),
        quality_gate_mode: "NONE",
      }],
    },
  );
  assert.equal(routing.status, 201, JSON.stringify(routing.body));
  refs.routingVersionId = Number(routing.body.data.id);
  const routingSubmitted = await routingService.transition(
    refs.routingVersionId,
    "submit",
    serviceMeta("engineering", "PRODUCTION_ROUTING_SUBMITTED", "routing-submit"),
    { expected_version: 1 },
  );
  assert.equal(routingSubmitted.status, 200, JSON.stringify(routingSubmitted.body));
  const routingReleased = await routingService.transition(
    refs.routingVersionId,
    "release",
    serviceMeta("manager", "PRODUCTION_ROUTING_RELEASED", "routing-release"),
    { expected_version: Number(routingSubmitted.body.data.version) },
  );
  assert.equal(routingReleased.status, 200, JSON.stringify(routingReleased.body));

  const handoff = expectStatus(await call(
    handleProductionHandoffApi,
    `/api/planning-packages/${refs.packageId}/production-handoffs`,
    {
      method: "POST",
      role: "planning",
      body: { items: [{ package_item_id: refs.packageItemId, finished_material_id: refs.finishedMaterialId }] },
    },
  ), 201, "planning prepares production handoff");
  refs.productionHandoffId = Number(handoff.payload.data.id);
  expectStatus(await call(handleProductionHandoffApi, `/api/production-handoffs/${refs.productionHandoffId}/submit`, {
    method: "POST",
    role: "planning",
    body: { expected_version: 1 },
  }), 200, "planning submits production handoff");
  expectStatus(await call(handleProductionHandoffApi, `/api/production-handoffs/${refs.productionHandoffId}/accept`, {
    method: "POST",
    role: "production",
    body: { expected_version: 2 },
  }), 200, "production accepts handoff");
  const handoffDetail = expectStatus(await call(
    handleProductionHandoffApi,
    `/api/production-handoffs/${refs.productionHandoffId}`,
    { role: "production" },
  ), 200, "read production handoff");
  refs.productionHandoffItemId = Number(handoffDetail.payload.data.items[0].id);
  const workOrderKey = "golden-handoff-work-order";
  const workOrder = expectStatus(await call(
    handleProductionHandoffApi,
    `/api/production-handoff-items/${refs.productionHandoffItemId}/work-order`,
    { method: "POST", role: "production", key: workOrderKey, body: {} },
  ), 201, "create work order from handoff");
  refs.workOrderId = Number(workOrder.payload.data.work_order.id);
  const workOrderReplay = expectStatus(await call(
    handleProductionHandoffApi,
    `/api/production-handoff-items/${refs.productionHandoffItemId}/work-order`,
    { method: "POST", role: "production", key: workOrderKey, body: {} },
  ), 201, "replay work-order conversion");
  assert.equal(workOrderReplay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(Number(workOrderReplay.payload.data.work_order.id), refs.workOrderId);
  expectStatus(await call(handleProductionApi, `/api/work-orders/${refs.workOrderId}/release`, {
    method: "POST",
    role: "production",
    body: { expected_version: 1 },
  }), 200, "release work order and reserve received raw material");

  const reservedSource = (await pool.query(`select
      requirement.id requirement_id,
      requirement.version requirement_version,
      reservation.balance_id,
      balance.version balance_version
    from production_material_requirements requirement
    join production_inventory_reservations reservation on reservation.requirement_id=requirement.id
    join inventory_stock_balances balance on balance.id=reservation.balance_id
    where requirement.work_order_id=$1`, [refs.workOrderId])).rows[0];
  assert.ok(reservedSource);
  expectStatus(await call(handleProductionApi, "/api/production/material-issues", {
    method: "POST",
    role: "warehouse",
    body: {
      work_order_id: refs.workOrderId,
      reason: "黄金旅程整批领料",
      lines: [{
        requirement_id: Number(reservedSource.requirement_id),
        quantity: "10",
        expected_requirement_version: Number(reservedSource.requirement_version),
        expected_balance_version: Number(reservedSource.balance_version),
      }],
    },
  }), 201, "issue the reserved supplier lot to production");

  const operationService = new ProductionOperationService(productionRepository);
  const operation = (await operationService.operations(refs.workOrderId)).rows[0];
  assert.ok(operation);
  const dispatched = await operationService.dispatch(
    serviceMeta("production", "PRODUCTION_OPERATION_DISPATCHED", "operation-dispatch"),
    {
      snapshot_operation_id: Number(operation.snapshot_operation_id),
      quantity: "10",
      assigned_operator: "production01",
      expected_operation_version: Number(operation.version),
    },
  );
  assert.equal(dispatched.status, 201, JSON.stringify(dispatched.body));
  refs.operationRunId = Number(dispatched.body.data.id);
  const started = await operationService.start(
    refs.operationRunId,
    serviceMeta("production", "PRODUCTION_OPERATION_STARTED", "operation-start"),
    { expected_version: 1 },
  );
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const operationReported = await operationService.report(
    refs.operationRunId,
    serviceMeta("production", "PRODUCTION_OPERATION_REPORTED", "operation-report"),
    { expected_version: 2, processed_qty: "10", good_qty: "10", scrap_qty: "0", remark: "黄金旅程组装完成" },
  );
  assert.equal(operationReported.status, 201, JSON.stringify(operationReported.body));
  refs.operationRunReportId = Number(operationReported.body.data.report.id);

  const finalOutput = (await pool.query(`select
      work_order.version work_order_version,
      wip.version final_output_version,
      wip.final_output_available_qty::text
    from production_work_orders work_order
    join production_work_order_operation_projections projection
      on projection.work_order_id=work_order.id and projection.next_snapshot_operation_id is null
    join production_operation_wip_projections wip on wip.operation_projection_id=projection.id
    where work_order.id=$1`, [refs.workOrderId])).rows[0];
  assert.equal(finalOutput.final_output_available_qty, "10.000000");
  const productionReport = expectStatus(await call(handleProductionApi, "/api/production/reports", {
    method: "POST",
    role: "production",
    body: {
      work_order_id: refs.workOrderId,
      expected_work_order_version: Number(finalOutput.work_order_version),
      expected_final_output_version: Number(finalOutput.final_output_version),
      final_output_allocations: [{ operation_run_report_id: refs.operationRunReportId, quantity: "10" }],
      remark: "黄金旅程稳定末工序来源",
    },
  }), 201, "create structured production report");
  refs.productionReportId = Number(productionReport.payload.data.id);
  const completionState = (await pool.query(
    "select version from production_work_orders where id=$1",
    [refs.workOrderId],
  )).rows[0];
  const finishedBalance = (await pool.query(
    "select version from inventory_stock_balances where material_id=$1 and location_code='MAIN' and inventory_lot_id is null",
    [refs.finishedMaterialId],
  )).rows[0];
  const completion = expectStatus(await call(handleProductionApi, "/api/production/completions", {
    method: "POST",
    role: "warehouse",
    body: {
      work_order_id: refs.workOrderId,
      expected_version: Number(completionState.version),
      expected_balance_version: Number(finishedBalance?.version || 0),
      reason: "黄金旅程成品入库",
      allocations: [{ report_id: refs.productionReportId, quantity: "10", expected_report_version: 1 }],
    },
  }), 201, "complete production into finished inventory");
  refs.completionId = Number(completion.payload.data.id);
  refs.completionLineId = Number(completion.payload.data.lines[0].id);
  assert.equal(completion.payload.data.work_order.status, "COMPLETED");

  const quoteBody = {
    customer_id: refs.customerId,
    currency_code: "CNY",
    valid_until: "2099-12-31T00:00:00Z",
    owner: "sales01",
    remark: "黄金旅程报价",
    lines: [{
      product_id: refs.productId,
      product_version_id: refs.productVersionId,
      finished_material_id: refs.finishedMaterialId,
      unit_id: refs.unitId,
      quantity: "10",
      unit_price: "20",
    }],
  };
  const quotation = expectStatus(await call(handleSalesApi, "/api/quotations", {
    method: "POST",
    role: "sales",
    body: quoteBody,
  }), 201, "sales creates quotation");
  refs.quotationId = Number(quotation.payload.quote_id);
  assert.equal(quotation.payload.data.current_version.total_amount, "200.000000");
  expectStatus(await call(handleSalesApi, `/api/quotations/${refs.quotationId}/publish`, {
    method: "POST",
    role: "sales",
    body: { expected_version: 1, reason: "" },
  }), 200, "publish quotation");
  expectStatus(await call(handleSalesApi, `/api/quotations/${refs.quotationId}/accept`, {
    method: "POST",
    role: "sales",
    body: { expected_version: 2, reason: "" },
  }), 200, "accept quotation");
  const salesOrder = expectStatus(await call(handleSalesApi, `/api/quotations/${refs.quotationId}/convert`, {
    method: "POST",
    role: "sales",
    body: { expected_version: 3, owner: "sales01" },
  }), 201, "convert quotation to sales order");
  refs.salesOrderId = Number(salesOrder.payload.sales_order_id);
  refs.salesOrderLineId = Number(salesOrder.payload.data.sales_order.current_version.lines[0].id);
  assert.equal(salesOrder.payload.data.sales_order.current_version.total_amount, "200.000000");

  const allocation = expectStatus(await call(handleQualityApi, "/api/quality/finished-goods-allocations", {
    method: "POST",
    role: "sales",
    body: {
      completion_line_id: refs.completionLineId,
      sales_order_line_id: refs.salesOrderLineId,
      quantity: "10",
      expected_completion_version: 1,
      expected_sales_order_line_version: 1,
    },
  }), 201, "sales fixes finished-goods allocation to its order line");
  refs.finishedGoodsAllocationId = Number(allocation.payload.allocation_id);
  const inspection = expectStatus(await call(handleQualityApi, "/api/quality-inspections", {
    method: "POST",
    role: "quality",
    body: {
      inspection_type: "FQC",
      allocation_id: refs.finishedGoodsAllocationId,
      inspected_qty: "10",
      passed_qty: "10",
      failed_qty: "0",
      responsible_stage: "成品终检",
      results: [{ characteristic: "综合判定", result: "PASS" }],
    },
  }), 201, "quality records FQC");
  refs.qualityInspectionId = Number(inspection.payload.inspection_id);
  expectStatus(await call(handleQualityApi, `/api/quality-inspections/${refs.qualityInspectionId}/dispositions`, {
    method: "POST",
    role: "manager",
    body: { expected_version: 1, disposition_code: "RELEASE", release_qty: "10", reason: "异人确认合格放行" },
  }), 200, "manager independently releases FQC");
  expectStatus(await call(handleQualityApi, `/api/quality-inspections/${refs.qualityInspectionId}/close`, {
    method: "POST",
    role: "quality",
    body: { expected_version: 2, reason: "黄金旅程终检完成" },
  }), 200, "quality closes FQC");

  const currentOrder = expectStatus(await call(handleSalesApi, `/api/sales-orders/${refs.salesOrderId}`, {
    role: "sales",
  }), 200, "read sales order for delivery");
  const orderLine = currentOrder.payload.data.lines.find((line) => Number(line.id) === refs.salesOrderLineId);
  const instruction = expectStatus(await call(handleSalesApi, "/api/delivery-instructions", {
    method: "POST",
    role: "sales",
    body: {
      sales_order_id: refs.salesOrderId,
      expected_order_version: Number(currentOrder.payload.data.header.version),
      receiver: "黄金旅程收货人",
      shipping_address: "黄金旅程测试地址",
      contact_info: "synthetic-only",
      lines: [{
        sales_order_line_id: refs.salesOrderLineId,
        quantity: "10",
        expected_line_version: Number(orderLine.version),
      }],
    },
  }), 201, "sales creates delivery instruction");
  refs.deliveryInstructionId = Number(instruction.payload.delivery_instruction_id);
  expectStatus(await call(handleSalesApi, `/api/delivery-instructions/${refs.deliveryInstructionId}/submit`, {
    method: "POST",
    role: "sales",
    body: { expected_version: 1, reason: "" },
  }), 200, "sales submits delivery instruction");
  expectStatus(await call(handleSalesApi, `/api/delivery-instructions/${refs.deliveryInstructionId}/accept`, {
    method: "POST",
    role: "warehouse",
    body: { expected_version: 2, reason: "" },
  }), 200, "warehouse accepts delivery instruction");
  const acceptedInstruction = expectStatus(await call(
    handleSalesApi,
    `/api/delivery-instructions/${refs.deliveryInstructionId}`,
    { role: "warehouse" },
  ), 200, "read accepted delivery instruction");
  const finishedInventory = (await pool.query(`select version
    from inventory_stock_balances
    where material_id=$1 and location_code='MAIN' and inventory_lot_id is null`, [refs.finishedMaterialId])).rows[0];
  const shipment = expectStatus(await call(
    handleSalesApi,
    `/api/delivery-instructions/${refs.deliveryInstructionId}/execute`,
    {
      method: "POST",
      role: "warehouse",
      body: {
        expected_instruction_version: Number(acceptedInstruction.payload.data.header.version),
        expected_sales_order_version: Number(currentOrder.payload.data.header.version),
        reason: "黄金旅程整批出货",
        lines: [{
          instruction_line_id: Number(acceptedInstruction.payload.data.lines[0].id),
          quantity: "10",
          expected_line_version: Number(acceptedInstruction.payload.data.lines[0].version),
          expected_sales_order_line_version: Number(orderLine.version),
          expected_balance_version: Number(finishedInventory.version),
        }],
      },
    },
  ), 201, "warehouse ships FQC-released finished goods");
  refs.shipmentId = Number(shipment.payload.shipment_id);
  refs.salesSourceId = Number(shipment.payload.data.financial_source.id);
  assert.equal(shipment.payload.data.financial_source.amount, "200.000000");

  const arDocument = expectStatus(await call(handleFinanceApi, "/api/finance/documents", {
    method: "POST",
    role: "finance",
    body: { doc_type: "AR", sales_source_entry_id: refs.salesSourceId },
  }), 201, "finance creates AR from shipment source");
  refs.arDocumentId = Number(arDocument.payload.doc_id);
  assert.equal(arDocument.payload.data.total_amount, "200.000000");
  const payment = expectStatus(await call(handleFinanceApi, "/api/financial-payments", {
    method: "POST",
    role: "finance",
    body: {
      doc_id: refs.arDocumentId,
      expected_version: 1,
      amount: "200",
      payment_date: "2026-08-23",
      account_name: "黄金旅程测试户",
      reason: "黄金旅程收款",
    },
  }), 201, "finance settles AR");
  refs.settlementId = Number(payment.payload.settlement_id);
  const paymentReversal = expectStatus(await call(
    handleFinanceApi,
    `/api/financial-payments/${refs.settlementId}/reversal`,
    {
      method: "POST",
      role: "finance",
      body: { expected_version: 2, accounting_date: "2026-08-24", reason: "银行退回，保留原收款事实" },
    },
  ), 201, "finance appends legal payment reversal");
  assert.ok(paymentReversal.payload.reversal_id);

  const stableMaterialFacts = await pool.query(`select
      (select count(*)::int from supplier_mappings where mapping_uid=$2 and material_id=$1 and status='ACTIVE') mapping,
      (select count(*)::int from bom_lines where bom_version_id=$3 and material_id=$1) bom,
      (select count(*)::int from project_planning_package_bom_lines line join project_planning_package_items item on item.id=line.package_item_id where item.package_id=$4 and line.material_id=$1) package,
      (select count(*)::int from planning_material_requirement_lines where plan_id=$5 and material_id=$1) plan,
      (select count(*)::int from planning_purchase_request_lines where purchase_request_id=$6 and material_id=$1) purchase_request,
      (select count(*)::int from procurement_rfq_lines where rfq_id=$7 and material_id=$1) rfq,
      (select count(*)::int from purchase_order_lines where purchase_order_id=$8 and material_id=$1) purchase_order,
      (select count(*)::int from production_material_requirements where work_order_id=$9 and material_id=$1) production`, [
    refs.rawMaterialId,
    refs.mappingUid,
    refs.bomVersionId,
    refs.packageId,
    refs.requirementPlanId,
    refs.purchaseRequestId,
    refs.rfqId,
    refs.purchaseOrderId,
    refs.workOrderId,
  ]);
  assert.deepEqual(stableMaterialFacts.rows[0], {
    mapping: 1,
    bom: 1,
    package: 1,
    plan: 1,
    purchase_request: 1,
    rfq: 1,
    purchase_order: 1,
    production: 1,
  });

  const conservation = (await pool.query(`select
      (select sum(quantity)::text from purchase_receipt_lines) purchased_qty,
      (select sum(net_issued_qty)::text from production_material_requirements where work_order_id=$1) issued_qty,
      (select sum(quantity)::text from production_completion_lines where completion_id=$2) completed_qty,
      (select sum(quantity)::text from finished_goods_sales_allocations where sales_order_line_id=$3 and status='ACTIVE') fqc_allocated_qty,
      (select released_qty::text from quality_inspections where id=$4) fqc_released_qty,
      (select shipped_qty::text from sales_order_lines where id=$3) shipped_qty,
      (select sum(amount)::text from purchase_financial_source_entries where id=$5) purchase_amount,
      (select total_amount::text from finance_documents where id=$6) ap_amount,
      (select sum(amount)::text from sales_financial_source_entries where id=$7) sales_amount,
      (select total_amount::text from finance_documents where id=$8) ar_amount,
      (select status from finance_documents where id=$8) ar_status,
      (select settled_amount::text from finance_documents where id=$8) ar_settled,
      (select count(*)::int from finance_settlements where document_id=$8) settlement_facts,
      (select count(*)::int from finance_settlements where original_settlement_id=$9) reversal_facts`, [
    refs.workOrderId,
    refs.completionId,
    refs.salesOrderLineId,
    refs.qualityInspectionId,
    refs.purchaseSourceId,
    refs.apDocumentId,
    refs.salesSourceId,
    refs.arDocumentId,
    refs.settlementId,
  ])).rows[0];
  assert.deepEqual(conservation, {
    purchased_qty: "10.000000",
    issued_qty: "10.000000",
    completed_qty: "10.000000",
    fqc_allocated_qty: "10.000000",
    fqc_released_qty: "10.000000",
    shipped_qty: "10.000000",
    purchase_amount: "120.000000",
    ap_amount: "120.000000",
    sales_amount: "200.000000",
    ar_amount: "200.000000",
    ar_status: "OPEN",
    ar_settled: "0.000000",
    settlement_facts: 2,
    reversal_facts: 1,
  });

  const lineage = (await pool.query(`select
      package.project_id::text package_project_id,
      plan.project_id::text plan_project_id,
      handoff.planning_package_id::text production_package_id,
      link.work_order_id::text linked_work_order_id,
      work_order.product_id::text work_order_product_id,
      work_order.product_version_id::text work_order_product_version_id,
      sales_order.customer_id::text sales_customer_id,
      sales_line.product_id::text sales_product_id,
      sales_line.product_version_id::text sales_product_version_id
    from project_planning_packages package
    join planning_material_requirement_plans plan on plan.planning_package_id=package.id
    join production_handoffs handoff on handoff.planning_package_id=package.id
    join production_handoff_items handoff_item on handoff_item.handoff_id=handoff.id
    join production_handoff_work_order_links link on link.handoff_item_id=handoff_item.id
    join production_work_orders work_order on work_order.id=link.work_order_id
    join sales_orders sales_order on sales_order.id=$4
    join sales_order_versions sales_version on sales_version.sales_order_id=sales_order.id and sales_version.version_no=sales_order.current_version_no
    join sales_order_lines sales_line on sales_line.sales_order_version_id=sales_version.id
    where package.id=$1 and plan.id=$2 and work_order.id=$3`, [
    refs.packageId,
    refs.requirementPlanId,
    refs.workOrderId,
    refs.salesOrderId,
  ])).rows[0];
  assert.deepEqual(lineage, {
    package_project_id: String(refs.projectId),
    plan_project_id: String(refs.projectId),
    production_package_id: String(refs.packageId),
    linked_work_order_id: String(refs.workOrderId),
    work_order_product_id: String(refs.productId),
    work_order_product_version_id: String(refs.productVersionId),
    sales_customer_id: String(refs.customerId),
    sales_product_id: String(refs.productId),
    sales_product_version_id: String(refs.productVersionId),
  });

  console.info(JSON.stringify({
    ok: true,
    schema: "0046",
    project_id: refs.projectId,
    raw_material_id: refs.rawMaterialId,
    product_id: refs.productId,
    purchase_order_id: refs.purchaseOrderId,
    work_order_id: refs.workOrderId,
    sales_order_id: refs.salesOrderId,
    quantities: { purchased: "10", issued: "10", completed: "10", shipped: "10" },
    amounts: { purchase: "120", sales: "200" },
    payment_reversed: true,
  }));
});
