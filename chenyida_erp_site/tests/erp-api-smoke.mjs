import assert from "node:assert/strict";
import { assertSafeTestTarget } from "../scripts/environment.mjs";

const { target } = assertSafeTestTarget(process.env);
const baseUrl = target.origin;
const adminUsername = process.env.ERP_TEST_USERNAME || "admin";
const adminPassword = process.env.ERP_TEST_PASSWORD;

if (!adminPassword) {
  throw new Error("ERP_TEST_PASSWORD is required");
}

const adminJar = { cookies: new Map(), csrfToken: "" };

function updateCookies(jar, response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of setCookies) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue === "" || /Max-Age=0/i.test(value)) jar.cookies.delete(name);
    else jar.cookies.set(name, cookieValue);
  }
}

async function request(path, { method = "GET", body, idempotencyKey, expectedStatus, jar = adminJar } = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Request-Id": crypto.randomUUID(),
  };
  if (jar.cookies.size) headers.Cookie = [...jar.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  if (method === "POST") {
    headers["Idempotency-Key"] = idempotencyKey || crypto.randomUUID();
    headers.Origin = baseUrl;
    if (jar.csrfToken) headers["X-CSRF-Token"] = jar.csrfToken;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  updateCookies(jar, response);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (payload && typeof payload === "object" && typeof payload.csrf_token === "string") {
    jar.csrfToken = payload.csrf_token;
  }
  if (expectedStatus !== undefined) {
    assert.equal(response.status, expectedStatus, `${method} ${path} returned an unexpected status`);
  } else if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { payload, response };
}

const session = (await request("/api/session")).payload;
if (session.setup_required) {
  await request("/api/setup", {
    method: "POST",
    body: {
      setup_token: process.env.ERP_TEST_SETUP_TOKEN,
      username: adminUsername,
      display_name: "测试管理员",
      password: adminPassword,
    },
  });
}

const login = (await request("/api/login", {
  method: "POST",
  body: { username: adminUsername, password: adminPassword },
})).payload;
assert.equal(login.user.role, "admin");

const suffix = `TEST-${Date.now().toString(36).toUpperCase()}`;

const managerInitialPassword = `Manager-${suffix}-Initial!`;
const managerPassword = `Manager-${suffix}-Final!`;
const managerUser = (await request("/api/users", {
  method: "POST",
  body: {
    username: `testmanager${Date.now().toString().slice(-6)}`,
    display_name: "烟测审核经理",
    role: "manager",
    password: managerInitialPassword,
  },
})).payload.user;
const managerJar = { cookies: new Map(), csrfToken: "" };
await request("/api/login", {
  method: "POST",
  body: { username: managerUser.username, password: managerInitialPassword },
  jar: managerJar,
});
await request("/api/me/password", {
  method: "POST",
  body: { old_password: managerInitialPassword, new_password: managerPassword },
  jar: managerJar,
});
await request("/api/login", {
  method: "POST",
  body: { username: managerUser.username, password: managerPassword },
  jar: managerJar,
});

const materialBody = {
  basic_fields: {
    standard_name: "烟测 FR4 覆铜板",
    unit: "PCS",
    source_type: "MANUAL",
    source_ref: "",
    brand: "TEST",
    manufacturer: "TEST",
    manufacturer_part_number: `FR4-${suffix}`,
    procurement_type: "PURCHASE",
    inventory_type: "STOCKED",
    lot_control_required: true,
    shelf_life_days: 365,
    inspection_type: "NORMAL",
    environmental_requirement: "ROHS",
  },
  category_id: 9901,
  attributes: { THICKNESS: { value: 1.6, unit: "mm", source: "MANUAL", confidence: 1 } },
};
const materialKey = `material-create-${Date.now()}`;
const materialDraft = (await request("/api/material-master/drafts", {
  method: "POST", body: materialBody, idempotencyKey: materialKey,
})).payload;
assert.equal(materialDraft.data.material_status, "DRAFT");
const materialReplay = await request("/api/material-master/drafts", {
  method: "POST", body: materialBody, idempotencyKey: materialKey,
});
assert.equal(materialReplay.response.headers.get("idempotency-replayed"), "true");
assert.equal(materialReplay.payload.operation_id, materialDraft.operation_id);
const submittedMaterial = (await request(`/api/material-master/drafts/${materialDraft.data.material_id}/submit`, {
  method: "POST", body: { expected_version: 1, submit_comment: "烟测提交" },
})).payload;
assert.equal(submittedMaterial.data.material_status, "PENDING_REVIEW");
const selfReview = await request(`/api/material-master/drafts/${materialDraft.data.material_id}/approve`, {
  method: "POST", body: { expected_version: 2 }, expectedStatus: 403,
});
assert.equal(selfReview.payload.error.code, "SELF_REVIEW_FORBIDDEN");
const approvedMaterial = (await request(`/api/material-master/drafts/${materialDraft.data.material_id}/approve`, {
  method: "POST",
  body: { expected_version: 2, review_comment: "烟测审核通过" },
  jar: managerJar,
})).payload;
assert.equal(approvedMaterial.data.material_status, "ACTIVE");
assert.match(approvedMaterial.data.internal_material_code, /^CYD-PCB-FR4-\d{6}$/);
const materialDetail = (await request(`/api/material-master/drafts/${materialDraft.data.material_id}`, { jar: managerJar })).payload;
assert.equal(materialDetail.data.material.version, 3);

const backup = (await request("/api/backups/create", { method: "POST", body: {} })).payload.backup;
assert.match(backup.name, /^erp-backup-/);
const restoredBackup = (await request("/api/backups/restore", {
  method: "POST",
  body: { name: backup.name },
})).payload.backup;
assert.equal(restoredBackup.name, backup.name);
const missingBackup = await request("/api/backups/restore", {
  method: "POST",
  body: { name: `TEST-MISSING-BACKUP-${suffix}` },
  expectedStatus: 404,
});
assert.equal(missingBackup.payload.code, "NOT_FOUND");

const createdUser = (await request("/api/users", {
  method: "POST",
  body: {
    username: `testsales${Date.now().toString().slice(-7)}`,
    display_name: "烟测销售员",
    role: "sales",
    password: `Sales-${suffix}-Pass!`,
  },
})).payload.user;
assert.equal(createdUser.role, "sales");
assert.equal(createdUser.must_change_password, true);
await request("/api/users/status", {
  method: "POST",
  body: { username: createdUser.username, is_active: false, version: 1 },
});
const disabledUser = (await request("/api/users")).payload.rows.find((row) => row.username === createdUser.username);
assert.equal(disabledUser.is_active, false);
await request("/api/users/status", {
  method: "POST",
  body: { username: createdUser.username, is_active: true, version: disabledUser.version },
});
await request("/api/users/reset-password", {
  method: "POST",
  body: { username: createdUser.username, password: `Reset-${suffix}-Pass!` },
});

const customerKey = crypto.randomUUID();
const customerBody = {
  customer_name: `TEST-烟测客户-${suffix}`,
  contact_name: "测试联系人",
  payment_terms: "月结30天",
  owner: "烟测",
};
const firstCustomer = (await request("/api/customers", { method: "POST", body: customerBody, idempotencyKey: customerKey })).payload;
const replayedCustomer = await request("/api/customers", { method: "POST", body: customerBody, idempotencyKey: customerKey });
assert.equal(replayedCustomer.response.headers.get("idempotency-replayed"), "true");
assert.equal(replayedCustomer.payload.customer_code, firstCustomer.customer_code);

const supplier = (await request("/api/suppliers", {
  method: "POST",
  body: { supplier_name: `TEST-烟测供应商-${suffix}`, supplier_level: "合格供应商", owner: "烟测" },
})).payload;
assert.match(supplier.supplier_code, /^SUP-/);

const productCode = `TEST-PRODUCT-${suffix}`;
await request("/api/products", {
  method: "POST",
  body: { product_code: productCode, product_name: "烟测在线产品", product_type: "FPC+SMT", product_version: "A0" },
});

await request("/api/import", {
  method: "POST",
  body: {
    batchNo: `TEST-IMPORT-${suffix}`,
    rows: [{ supplier_name: supplier.supplier_name, raw_item_name: "TEST-MATERIAL-001 贴片电阻 10K 0603 1%", raw_item_code: `TEST-R-${suffix}`, purchase_uom: "PCS" }],
  },
});
const cleaningRows = (await request("/api/cleaning")).payload.rows;
const cleaning = cleaningRows.find((row) => row.import_batch_no === `TEST-IMPORT-${suffix}`);
assert.ok(cleaning);
const item = (await request("/api/cleaning/create-item", {
  method: "POST",
  body: { id: cleaning.id, item_category: "RES", standard_name: "贴片电阻 10K 0603", environmental_level: "RoHS", default_inspection_rule: "抽检" },
})).payload;
assert.match(item.internal_item_code, /^MAT-RES-/);

const bom = (await request("/api/boms", {
  method: "POST",
  body: { bom_code: `BOM-${productCode}-A0`, product_code: productCode, bom_version: "A0", bom_status: "已审核" },
})).payload;
await request("/api/bom-lines", {
  method: "POST",
  body: { bom_id: bom.bom_id, line_no: 10, internal_item_code: item.internal_item_code, qty_per: 2, uom: "PCS", process_stage: "SMT", loss_rate: 0 },
});

await request("/api/inventory-adjustments", {
  method: "POST",
  body: { internal_item_code: item.internal_item_code, counted_qty: 100, reason: "在线烟测", adjusted_by: "烟测" },
});
const readiness = (await request(`/api/bom-readiness?bom_id=${bom.bom_id}&order_qty=10`)).payload;
assert.equal(readiness.all_ready, true);

const workOrder = (await request("/api/work-orders/from-bom", {
  method: "POST",
  body: { bom_id: bom.bom_id, order_qty: 10, owner: "烟测" },
})).payload;
const issued = (await request("/api/work-orders/issue-materials", {
  method: "POST",
  body: { work_order_id: workOrder.work_order_id },
})).payload;
assert.equal(issued.issued.length, 1);
const completed = (await request("/api/work-orders/complete", {
  method: "POST",
  body: { work_order_id: workOrder.work_order_id, good_qty: 5, scrap_qty: 0, operator: "烟测" },
})).payload;
assert.equal(completed.after_qty, 5);

const quotation = (await request("/api/quotations", {
  method: "POST",
  body: { customer_name: customerBody.customer_name, product_code: productCode, quote_qty: 2, unit_price: 88, owner: "烟测" },
})).payload;
const salesOrder = (await request("/api/quotations/to-sales-order", {
  method: "POST",
  body: { quote_id: quotation.quote_id, owner: "烟测" },
})).payload;
const shipment = (await request("/api/shipments/from-order", {
  method: "POST",
  body: { sales_order_id: salesOrder.sales_order_id, ship_qty: 1, receiver: "烟测收货人" },
})).payload;
assert.equal(shipment.after_qty, 4);

const receivable = (await request("/api/financial-documents/from-sales-order", {
  method: "POST",
  body: { sales_order_id: salesOrder.sales_order_id, total_amount: 176, created_by: "烟测" },
})).payload;
const payment = (await request("/api/financial-payments", {
  method: "POST",
  body: { doc_id: receivable.doc_id, amount: 50, payment_type: "收款", handled_by: "烟测" },
})).payload;
assert.equal(payment.doc_status, "部分结清");

const inspection = (await request("/api/quality-inspections", {
  method: "POST",
  body: { inspection_type: "FQC", ref_type: "销售订单", ref_id: salesOrder.sales_order_id, product_code: productCode, inspected_qty: 1, passed_qty: 1, inspector: "烟测" },
})).payload;
assert.equal(inspection.inspection_status, "合格放行");

const summary = (await request("/api/summary")).payload;
assert.ok(summary.total_items >= 2);
assert.ok(summary.total_customers >= 1);
assert.ok(summary.total_suppliers >= 1);
assert.ok(summary.total_work_orders >= 1);
assert.ok(summary.total_sales_orders >= 1);
assert.equal(summary.receivable_balance >= 126, true);

console.log(JSON.stringify({ ok: true, productCode, workOrder: workOrder.work_order_code, salesOrder: salesOrder.sales_order_code }));
