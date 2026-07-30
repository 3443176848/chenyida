import { api, ErpApiError, logoutSession, safeMaterialReturnTo } from "./api-client.js?v=20260729-identity-logout-fix";

const state = {
  summary: {},
  items: [],
  mappings: [],
  cleaning: [],
  products: [],
  customers: [],
  suppliers: [],
  boms: [],
  bomLines: [],
  readiness: [],
  purchaseOrders: [],
  purchaseLines: [],
  purchaseSuggestions: [],
  inventory: [],
  inventoryAdjustments: [],
  workOrders: [],
  workMaterials: [],
  productionReports: [],
  quotations: [],
  salesOrders: [],
  shipments: [],
  qualityInspections: [],
  qualityDefects: [],
  financeSummary: {},
  financialDocuments: [],
  financialPayments: [],
  financeSources: [],
  session: { authenticated: false, user: null, setup_required: false },
  managementDashboard: null,
  backups: [],
  users: [],
  identityOperations: new Map(),
  masterDataOperations: new Map(),
  procurementOperations: new Map(),
  productionOperations: new Map(),
  salesOperations: new Map(),
  qualityOperations: new Map(),
  financeOperations: new Map(),
  qualitySourceOptions: [],
  selectedInspection: null,
  operationsAvailability: { dashboard: false, backups: false },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const LEGACY_TABS = new Set(["dashboard", "partners", "bom", "purchase", "production", "sales", "quality", "finance", "operations"]);

function requestedLegacyTab() {
  const requested = new URL(window.location.href).searchParams.get("tab") || "dashboard";
  return LEGACY_TABS.has(requested) ? requested : "dashboard";
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function identityErrorText(error) {
  if (!(error instanceof ErpApiError)) return "系统暂时无法完成请求";
  return `${error.message}（${error.code}${error.requestId ? ` · 请求 ${error.requestId}` : ""}）`;
}

function setTab(name) {
  $$(".nav").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === name));
  if (name === "operations") {
    refreshOperations().catch((error) => toast(error.message));
  }
}

function pill(level) {
  const cls = level === "自动匹配" ? "auto" : level === "疑似匹配" ? "suspect" : "new";
  return `<span class="pill ${cls}">${level || ""}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function canManageSystem() {
  return state.session.user?.role === "admin";
}

function showLogin() {
  $("#loginOverlay").hidden = false;
  $("#setupForm").hidden = true;
  $("#loginForm").hidden = false;
  $("#loginUsername")?.focus();
}

window.addEventListener("cyd-erp-auth-required", showLogin);
window.addEventListener("cyd-erp-password-change-required", openPasswordDialog);

async function identityWrite(operationName, path, payload) {
  const frozenBody = JSON.stringify(payload);
  const existing = state.identityOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) {
    throw new Error("上一次操作结果尚未确认，只能使用原请求安全重试");
  }
  const operation = existing || { key: crypto.randomUUID(), frozenBody };
  state.identityOperations.set(operationName, operation);
  try {
    const result = await api(path, {
      method: "POST",
      body: operation.frozenBody,
      protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" },
    });
    state.identityOperations.delete(operationName);
    return result;
  } catch (error) {
    if (!error.resultUnknown) state.identityOperations.delete(operationName);
    throw error;
  }
}

async function masterDataWrite(operationName, path, payload, method = "POST") {
  const frozenBody = JSON.stringify(payload);
  const existing = state.masterDataOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) throw new Error("上一次主数据操作结果尚未确认，只能使用原请求安全重试");
  const operation = existing || { key: crypto.randomUUID(), frozenBody };
  state.masterDataOperations.set(operationName, operation);
  try {
    const result = await api(path, { method, body: operation.frozenBody, protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" } });
    state.masterDataOperations.delete(operationName);
    return result;
  } catch (error) {
    if (!error.resultUnknown) state.masterDataOperations.delete(operationName);
    throw error;
  }
}

async function procurementWrite(operationName, path, payload, method = "POST") {
  const frozenBody = JSON.stringify(payload); const existing = state.procurementOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) throw new Error("上一次采购操作结果尚未确认，只能使用原请求安全重试");
  const operation = existing || { key: crypto.randomUUID(), frozenBody }; state.procurementOperations.set(operationName, operation);
  try { const result = await api(path, { method, body: operation.frozenBody, protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" } }); state.procurementOperations.delete(operationName); return result; }
  catch (error) { if (!error.resultUnknown) state.procurementOperations.delete(operationName); throw error; }
}

async function productionWrite(operationName, path, payload, method = "POST") {
  const frozenBody = JSON.stringify(payload); const existing = state.productionOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) throw new Error("上一次生产操作结果尚未确认，只能使用原请求安全重试");
  const operation = existing || { key: crypto.randomUUID(), frozenBody }; state.productionOperations.set(operationName, operation);
  try { const result = await api(path, { method, body: operation.frozenBody, protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" } }); state.productionOperations.delete(operationName); return result; }
  catch (error) { if (!error.resultUnknown) state.productionOperations.delete(operationName); throw error; }
}

async function salesWrite(operationName, path, payload, method = "POST") {
  const frozenBody = JSON.stringify(payload); const existing = state.salesOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) throw new Error("上一次销售操作结果尚未确认，只能使用原请求安全重试");
  const operation = existing || { key: crypto.randomUUID(), frozenBody }; state.salesOperations.set(operationName, operation);
  try { const result = await api(path, { method, body: operation.frozenBody, protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" } }); state.salesOperations.delete(operationName); return result; }
  catch (error) { if (!error.resultUnknown) state.salesOperations.delete(operationName); throw error; }
}

async function qualityWrite(operationName, path, payload) {
  const frozenBody = JSON.stringify(payload); const existing = state.qualityOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) throw new Error("上一次品质操作结果尚未确认，只能使用原请求安全重试");
  const operation = existing || { key: crypto.randomUUID(), frozenBody }; state.qualityOperations.set(operationName, operation);
  try { const result = await api(path, { method: "POST", body: operation.frozenBody, protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" } }); state.qualityOperations.delete(operationName); return result; }
  catch (error) { if (!error.resultUnknown) state.qualityOperations.delete(operationName); throw error; }
}

async function financeWrite(operationName, path, payload) {
  const frozenBody = JSON.stringify(payload); const existing = state.financeOperations.get(operationName);
  if (existing && existing.frozenBody !== frozenBody) throw new Error("上一次财务操作结果尚未确认，只能使用原请求安全重试");
  const operation = existing || { key: crypto.randomUUID(), frozenBody }; state.financeOperations.set(operationName, operation);
  try { const result = await api(path, { method: "POST", body: operation.frozenBody, protectedWrite: { idempotencyKey: operation.key, csrfToken: state.session.csrf_token || "" } }); state.financeOperations.delete(operationName); return result; }
  catch (error) { if (!error.resultUnknown) state.financeOperations.delete(operationName); throw error; }
}

function requestedMaterialReturnTo() {
  try {
    const raw = new URL(window.top.location.href).searchParams.get("return_to");
    return raw ? safeMaterialReturnTo(raw) : null;
  } catch {
    return null;
  }
}

function continueAfterAuthentication() {
  const returnTo = requestedMaterialReturnTo();
  if (returnTo) {
    window.top.location.replace(returnTo);
    return true;
  }
  return false;
}

function showSetup() {
  $("#loginOverlay").hidden = false;
  $("#loginForm").hidden = true;
  $("#setupForm").hidden = false;
  $("#setupToken")?.focus();
}

function hideLogin() {
  $("#loginOverlay").hidden = true;
}

function updateUserBar() {
  const user = state.session.user;
  $("#userBadge").hidden = !user;
  $("#logoutBtn").hidden = !user;
  $("#changePasswordBtn").hidden = !user;
  if (!user) return;
  $("#userName").textContent = user.display_name || user.username;
  $("#userRole").textContent = user.role_label || user.role;
}

async function loadSession() {
  const result = await api("/api/session");
  state.session = result;
  updateUserBar();
  if (result.setup_required) {
    showSetup();
  } else if (result.authenticated) {
    hideLogin();
  } else {
    showLogin();
  }
  return result;
}

function renderSummary() {
  const cards = [
    ["内部物料", state.summary.total_items],
    ["供应商映射", state.summary.total_mappings],
    ["客户档案", state.summary.total_customers],
    ["供应商档案", state.summary.total_suppliers],
    ["产品工程", state.summary.total_products],
    ["BOM", state.summary.total_boms],
    ["采购单", state.summary.total_pos],
    ["未完成采购", state.summary.open_pos],
    ["生产工单", state.summary.total_work_orders],
    ["进行中工单", state.summary.active_work_orders],
    ["报价单", state.summary.total_quotations],
    ["待转报价", state.summary.open_quotations],
    ["销售订单", state.summary.total_sales_orders],
    ["待交付订单", state.summary.open_sales_orders],
    ["品质检验", state.summary.total_quality_inspections],
    ["质量异常", state.summary.open_quality_issues],
    ["应收余额", state.summary.receivable_balance],
    ["应付余额", state.summary.payable_balance],
    ["全局待处理（DRAFT + PENDING_REVIEW）", state.summary.pending],
    ["自动匹配", state.summary.auto_count],
    ["疑似匹配", state.summary.suspect_count],
    ["新物料", state.summary.new_count],
  ];
  $("#summaryCards").innerHTML = cards.map(([label, value]) => `
    <div class="summary-card">
      <b>${value ?? 0}</b>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderOperations() {
  const dashboard = state.managementDashboard || { metrics: [], risks: [], recent_activity: [] };
  $("#opsMetrics").innerHTML = dashboard.metrics.map((metric) => `
    <div class="summary-card">
      <b>${escapeHtml(metric.value)}</b>
      <span>${escapeHtml(metric.label)}</span>
      <small>${escapeHtml(metric.hint)}</small>
    </div>
  `).join("");
  $("#opsRisks").innerHTML = dashboard.risks.map((risk) => `
    <li class="risk ${escapeHtml(risk.level)}">${escapeHtml(risk.text)}</li>
  `).join("");
  $("#opsActivityTable").innerHTML = `
    <thead><tr><th>时间</th><th>动作</th><th>说明</th></tr></thead>
    <tbody>${dashboard.recent_activity.map((row) => `
      <tr>
        <td>${escapeHtml(row.created_at)}</td>
        <td>${escapeHtml(row.action)}</td>
        <td>${escapeHtml(row.detail)}</td>
      </tr>
    `).join("")}</tbody>
  `;

  const canManage = canManageSystem();
  $("#backupAdminHint").hidden = false;
  $("#backupAdminHint").textContent = "备份创建和新空目标恢复只允许受控离线 CLI；浏览器不提供写操作。";
  $("#userAdminHint").hidden = canManage;
  $("#createUserForm").hidden = !canManage;
  $("#backupTable").innerHTML = `
    <thead><tr><th>验证标识</th><th>状态</th><th>验证时间</th><th>恢复边界</th></tr></thead>
    <tbody>${state.backups.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.status || "VERIFIED")}</td>
        <td>${escapeHtml(row.verified_at || row.created_at)}</td>
        <td>仅新建空目标</td>
      </tr>
    `).join("") || `<tr><td colspan="4">没有可信验证记录</td></tr>`}</tbody>
  `;
  $("#usersTable").innerHTML = `
    <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
    <tbody>${state.users.map((row) => `
      <tr>
        <td>${escapeHtml(row.username)}</td>
        <td>${escapeHtml(row.display_name)}</td>
        <td><span class="pill auto">${escapeHtml(row.role_label || row.role)}</span></td>
        <td>${row.is_active ? "启用" : "停用"}</td>
        <td>${escapeHtml(row.last_login_at || "-")}</td>
        <td>
          <div class="row-actions">
            <button data-toggle-user="${escapeHtml(row.username)}" data-user-active="${row.is_active ? "1" : "0"}" data-user-version="${escapeHtml(row.version)}" ${row.username === state.session.user?.username ? "disabled" : ""}>${row.is_active ? "停用" : "启用"}</button>
            <button data-reset-user="${escapeHtml(row.username)}">重置密码</button>
          </div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="6">当前账号无权查看用户清单</td></tr>`}</tbody>
  `;
}

function optionList(rows, valueKey, labelKeys) {
  return rows.map((row) => {
    const label = labelKeys.map((key) => row[key]).filter(Boolean).join(" - ");
    return `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(label)}</option>`;
  }).join("");
}

function renderItems() {
  const rows = state.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.internal_item_code)}</td>
      <td>${escapeHtml(item.item_category)}</td>
      <td>${escapeHtml(item.standard_name)}</td>
      <td>${escapeHtml(item.base_uom)}</td>
      <td>${escapeHtml(item.package)}</td>
      <td>${escapeHtml(item.value_spec)}</td>
      <td>${escapeHtml(item.voltage)}</td>
      <td>${escapeHtml(item.tolerance)}</td>
      <td>${escapeHtml(item.environmental_level)}</td>
      <td>${escapeHtml(item.is_customer_specific)}</td>
      <td>${escapeHtml(item.default_inspection_rule)}</td>
    </tr>
  `).join("");
  $("#itemsTable").innerHTML = `
    <thead><tr>
      <th>内部编码</th><th>品类</th><th>标准名称</th><th>单位</th><th>封装</th>
      <th>规格值</th><th>耐压</th><th>精度</th><th>环保</th><th>客户专用</th><th>检验规则</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderProducts() {
  const rows = state.products.map((product) => `
    <tr>
      <td>${escapeHtml(product.product_code)}</td>
      <td>${escapeHtml(product.product_name)}</td>
      <td>${escapeHtml(product.customer_name)}</td>
      <td>${escapeHtml(product.product_type)}</td>
      <td>${escapeHtml(product.product_version)}</td>
      <td>${escapeHtml(product.lifecycle_status)}</td>
      <td>${escapeHtml(product.layer_count)}</td>
      <td>${escapeHtml(product.board_thickness)}</td>
      <td>${escapeHtml(product.surface_finish)}</td>
      <td>${escapeHtml(product.smt_required)}</td>
    </tr>
  `).join("");
  $("#productsTable").innerHTML = `
    <thead><tr>
      <th>产品编码</th><th>产品名称</th><th>客户</th><th>类型</th><th>版本</th>
      <th>状态</th><th>层数</th><th>板厚</th><th>表面处理</th><th>SMT</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderPartners() {
  $("#customerOptions").innerHTML = state.customers.map((row) => `<option value="${escapeHtml(row.customer_name)}"></option>`).join("");
  $("#supplierOptions").innerHTML = state.suppliers.map((row) => `<option value="${escapeHtml(row.supplier_name)}"></option>`).join("");
  const salesCustomerOptions = optionList(state.customers.filter((row) => (row.status || row.customer_status) === "ACTIVE"), "id", ["customer_code", "customer_name"]);
  $("#quoteCustomer").innerHTML = salesCustomerOptions;
  $("#salesCustomer").innerHTML = salesCustomerOptions;
  const customerRows = state.customers.map((row) => `
    <tr>
      <td>${escapeHtml(row.customer_code)}</td>
      <td>${escapeHtml(row.customer_name)}</td>
      <td>${escapeHtml(row.customer_status)}</td>
      <td>${escapeHtml(row.contact_name)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td>${escapeHtml(row.payment_terms)}</td>
      <td>${escapeHtml(row.owner)}</td>
      <td>${escapeHtml(row.updated_at)}</td>
    </tr>
  `).join("");
  $("#customersTable").innerHTML = `
    <thead><tr>
      <th>客户编码</th><th>客户名称</th><th>状态</th><th>联系人</th><th>电话</th><th>账期</th><th>负责人</th><th>更新时间</th>
    </tr></thead>
    <tbody>${customerRows}</tbody>
  `;
  const supplierRows = state.suppliers.map((row) => `
    <tr>
      <td>${escapeHtml(row.supplier_code)}</td>
      <td>${escapeHtml(row.supplier_name)}</td>
      <td>${escapeHtml(row.supplier_status)}</td>
      <td>${escapeHtml(row.supplier_level)}</td>
      <td>${escapeHtml(row.contact_name)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td>${escapeHtml(row.payment_terms)}</td>
      <td>${escapeHtml(row.owner)}</td>
      <td>${escapeHtml(row.updated_at)}</td>
    </tr>
  `).join("");
  $("#suppliersTable").innerHTML = `
    <thead><tr>
      <th>供应商编码</th><th>供应商名称</th><th>状态</th><th>等级</th><th>联系人</th><th>电话</th><th>账期</th><th>负责人</th><th>更新时间</th>
    </tr></thead>
    <tbody>${supplierRows}</tbody>
  `;
}

function renderBomSelectors() {
  const productOptions = optionList(state.products, "product_code", ["product_code", "product_name"]);
  const bomOptions = optionList(state.boms, "id", ["bom_code", "product_name"]);
  const itemOptions = optionList(state.items, "internal_item_code", ["internal_item_code", "standard_name"]);
  const inventoryOptions = optionList(state.inventory, "material_id", ["internal_material_code", "standard_name"]);
  $("#bomProduct").innerHTML = productOptions;
  $("#lineBom").innerHTML = bomOptions;
  $("#readyBom").innerHTML = bomOptions;
  $("#purchaseBom").innerHTML = bomOptions;
  $("#productionBom").innerHTML = bomOptions;
  $("#productionFinishedMaterial").innerHTML = optionList(state.items, "id", ["internal_material_code", "standard_name"]);
  const salesProducts = optionList(state.products.filter((row) => (row.status || row.product_status) === "ACTIVE" && row.product_version_status === "RELEASED"), "id", ["product_code", "product_name", "product_version"]);
  const finishedMaterials = optionList(state.inventory, "material_id", ["internal_material_code", "standard_name", "base_uom"]);
  $("#quoteProduct").innerHTML = salesProducts;
  $("#salesProduct").innerHTML = salesProducts;
  $("#quoteFinishedMaterial").innerHTML = finishedMaterials;
  $("#salesFinishedMaterial").innerHTML = finishedMaterials;
  $("#lineItem").innerHTML = itemOptions;
  $("#adjustItem").innerHTML = inventoryOptions;
}

function renderBoms() {
  const rows = state.boms.map((bom) => `
    <tr data-bom-id="${bom.id}">
      <td>${escapeHtml(bom.id)}</td>
      <td>${escapeHtml(bom.bom_code)}</td>
      <td>${escapeHtml(bom.product_code)}</td>
      <td>${escapeHtml(bom.product_name)}</td>
      <td>${escapeHtml(bom.customer_name)}</td>
      <td>${escapeHtml(bom.bom_version)}</td>
      <td>${escapeHtml(bom.bom_status)}</td>
      <td><button data-view-bom="${bom.id}">查看明细</button></td>
    </tr>
  `).join("");
  $("#bomsTable").innerHTML = `
    <thead><tr>
      <th>ID</th><th>BOM 编码</th><th>产品编码</th><th>产品名称</th><th>客户</th><th>版本</th><th>状态</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderBomLines() {
  const rows = state.bomLines.map((line) => `
    <tr>
      <td>${escapeHtml(line.line_no)}</td>
      <td>${escapeHtml(line.internal_item_code)}</td>
      <td>${escapeHtml(line.standard_name)}</td>
      <td>${escapeHtml(line.item_category)}</td>
      <td>${escapeHtml(line.qty_per)}</td>
      <td>${escapeHtml(line.uom)}</td>
      <td>${escapeHtml(line.loss_rate)}</td>
      <td>${escapeHtml(line.process_stage)}</td>
      <td>${escapeHtml(line.on_hand_qty)}</td>
    </tr>
  `).join("");
  $("#bomLinesTable").innerHTML = `
    <thead><tr>
      <th>行号</th><th>物料编码</th><th>物料名称</th><th>品类</th><th>单件用量</th><th>单位</th><th>损耗率</th><th>工序</th><th>库存</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderReadiness() {
  const rows = state.readiness.map((line) => `
    <tr>
      <td>${escapeHtml(line.internal_item_code)}</td>
      <td>${escapeHtml(line.standard_name)}</td>
      <td>${escapeHtml(line.required_qty)}</td>
      <td>${escapeHtml(line.available_qty)}</td>
      <td>${escapeHtml(line.shortage_qty)}</td>
      <td>${escapeHtml(line.readiness_status)}</td>
    </tr>
  `).join("");
  $("#readinessTable").innerHTML = `
    <thead><tr>
      <th>物料编码</th><th>物料名称</th><th>需求数量</th><th>可用库存</th><th>缺口</th><th>状态</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function remainingQty(line) {
  return Math.max(0, Number(line.order_qty || 0) - Number(line.received_qty || 0));
}

function renderPurchaseSuggestions() {
  const rows = state.purchaseSuggestions.map((row) => `
    <tr>
      <td>${escapeHtml(row.internal_item_code)}</td>
      <td>${escapeHtml(row.standard_name)}</td>
      <td>${escapeHtml(row.item_category)}</td>
      <td>${escapeHtml(row.shortage_qty)}</td>
      <td>${escapeHtml(row.uom)}</td>
      <td>${escapeHtml(row.supplier_name)}</td>
      <td>${escapeHtml(row.last_price)}</td>
      <td>${escapeHtml(row.lead_time_days)}</td>
    </tr>
  `).join("");
  $("#purchaseSuggestionsTable").innerHTML = `
    <thead><tr>
      <th>物料编码</th><th>物料名称</th><th>品类</th><th>建议采购数量</th><th>单位</th><th>建议供应商</th><th>最近价格</th><th>交期</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderPurchaseOrders() {
  const rows = state.purchaseOrders.map((po) => `
    <tr>
      <td>${escapeHtml(po.po_code)}</td>
      <td>${escapeHtml(po.supplier_name)}</td>
      <td>${escapeHtml(po.po_status)}</td>
      <td>${escapeHtml(po.source_type)}</td>
      <td>${escapeHtml(po.line_count)}</td>
      <td>${escapeHtml(po.total_order_qty)}</td>
      <td>${escapeHtml(po.total_received_qty)}</td>
      <td>${escapeHtml(po.created_at)}</td>
      <td><button data-view-po="${po.id}">查看明细</button></td>
    </tr>
  `).join("");
  $("#purchaseOrdersTable").innerHTML = `
    <thead><tr>
      <th>采购单号</th><th>供应商</th><th>状态</th><th>来源</th><th>行数</th><th>采购数量</th><th>已收数量</th><th>创建时间</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderPurchaseLines() {
  const rows = state.purchaseLines.map((line) => `
    <tr>
      <td>${escapeHtml(line.po_code)}</td>
      <td>${escapeHtml(line.supplier_name)}</td>
      <td>${escapeHtml(line.line_no)}</td>
      <td>${escapeHtml(line.internal_item_code)}</td>
      <td>${escapeHtml(line.standard_name)}</td>
      <td>${escapeHtml(line.order_qty)}</td>
      <td>${escapeHtml(line.received_qty)}</td>
      <td>${escapeHtml(remainingQty(line))}</td>
      <td>${escapeHtml(line.uom)}</td>
      <td>${escapeHtml(line.line_status)}</td>
      <td><button data-receive-line="${line.id}" ${remainingQty(line) <= 0 ? "disabled" : ""}>收货</button></td>
    </tr>
  `).join("");
  $("#purchaseLinesTable").innerHTML = `
    <thead><tr>
      <th>采购单号</th><th>供应商</th><th>行号</th><th>物料编码</th><th>物料名称</th><th>采购数量</th><th>已收</th><th>未收</th><th>单位</th><th>状态</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
  renderReceiveSelector();
}

function renderReceiveSelector() {
  const openLines = state.purchaseLines.filter((line) => remainingQty(line) > 0);
  $("#receiveLine").innerHTML = openLines.map((line) => {
    const label = `${line.po_code} - ${line.internal_item_code} - 未收 ${remainingQty(line)} ${line.uom || ""}`;
    return `<option value="${escapeHtml(line.id)}">${escapeHtml(label)}</option>`;
  }).join("");
}

function renderInventory() {
  const rows = state.inventory.map((item) => `
    <tr>
      <td>${escapeHtml(item.internal_item_code)}</td>
      <td>${escapeHtml(item.standard_name)}</td>
      <td>${escapeHtml(item.item_category)}</td>
      <td>${escapeHtml(item.on_hand_qty)}</td>
      <td>${escapeHtml(item.reserved_qty)}</td>
      <td>${escapeHtml(item.frozen_qty)}</td>
      <td>${escapeHtml(item.available_qty)}</td>
      <td>${escapeHtml(item.base_uom)}</td>
      <td>${escapeHtml(item.updated_at)}</td>
    </tr>
  `).join("");
  $("#inventoryTable").innerHTML = `
    <thead><tr>
      <th>物料编码</th><th>物料名称</th><th>品类</th><th>现有库存</th><th>已预留</th><th>已冻结</th><th>可用库存</th><th>单位</th><th>更新时间</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
  const adjustments = state.inventoryAdjustments.map((row) => `
    <tr>
      <td>${escapeHtml(row.adjustment_code)}</td>
      <td>${escapeHtml(row.operation_type)}</td>
      <td>${escapeHtml(row.line_count)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.reason)}</td>
      <td>${escapeHtml(row.created_by)}</td>
      <td>${escapeHtml(row.reversal_adjustment_code || "")}</td>
      <td>${escapeHtml(row.created_at)}</td>
    </tr>
  `).join("");
  $("#inventoryAdjustmentsTable").innerHTML = `
    <thead><tr>
      <th>调整单</th><th>类型</th><th>行数</th><th>状态</th><th>原因</th><th>经办人</th><th>冲销单</th><th>时间</th>
    </tr></thead>
    <tbody>${adjustments}</tbody>
  `;
}

function renderWorkOrders() {
  const rows = state.workOrders.map((order) => `
    <tr>
      <td>${escapeHtml(order.work_order_code)}</td>
      <td>${escapeHtml(order.product_code)}</td>
      <td>${escapeHtml(order.product_name)}</td>
      <td>${escapeHtml(order.bom_code)}</td>
      <td>${escapeHtml(order.order_qty)}</td>
      <td>${escapeHtml(order.completed_qty)}</td>
      <td>${escapeHtml(order.work_status)}</td>
      <td>${escapeHtml(order.owner)}</td>
      <td>${escapeHtml(order.finished_item_code)}</td>
      <td>
        <div class="row-actions">
          <button data-view-work-order="${order.id}">查看用料</button>
          <button data-issue-work-order="${order.id}" ${order.work_status === "已完工" ? "disabled" : ""}>领料</button>
        </div>
      </td>
    </tr>
  `).join("");
  $("#workOrdersTable").innerHTML = `
    <thead><tr>
      <th>工单号</th><th>产品编码</th><th>产品名称</th><th>BOM</th><th>生产数量</th><th>已完工</th><th>状态</th><th>负责人</th><th>成品物料</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
  renderWorkOrderSelector();
}

function renderWorkMaterials() {
  const rows = state.workMaterials.map((row) => {
    const remaining = Math.max(0, Number(row.required_qty || 0) - Number(row.issued_qty || 0));
    return `
      <tr>
        <td>${escapeHtml(row.work_order_code)}</td>
        <td>${escapeHtml(row.line_no)}</td>
        <td>${escapeHtml(row.internal_item_code)}</td>
        <td>${escapeHtml(row.standard_name)}</td>
        <td>${escapeHtml(row.required_qty)}</td>
        <td>${escapeHtml(row.issued_qty)}</td>
        <td>${escapeHtml(remaining)}</td>
        <td>${escapeHtml(row.available_qty)}</td>
        <td>${escapeHtml(row.uom)}</td>
        <td>${escapeHtml(row.process_stage)}</td>
      </tr>
    `;
  }).join("");
  $("#workMaterialsTable").innerHTML = `
    <thead><tr>
      <th>工单号</th><th>行号</th><th>物料编码</th><th>物料名称</th><th>需求</th><th>已领</th><th>未领</th><th>可用库存</th><th>单位</th><th>工序</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderProductionReports() {
  const rows = state.productionReports.map((row) => `
    <tr>
      <td>${escapeHtml(row.work_order_code)}</td>
      <td>${escapeHtml(row.product_code)}</td>
      <td>${escapeHtml(row.report_date)}</td>
      <td>${escapeHtml(row.process_stage)}</td>
      <td>${escapeHtml(row.good_qty)}</td>
      <td>${escapeHtml(row.scrap_qty)}</td>
      <td>${escapeHtml(row.operator)}</td>
      <td>${escapeHtml(row.created_at)}</td>
    </tr>
  `).join("");
  $("#productionReportsTable").innerHTML = `
    <thead><tr>
      <th>工单号</th><th>产品编码</th><th>报工日期</th><th>工序</th><th>良品</th><th>报废</th><th>操作员</th><th>记录时间</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderWorkOrderSelector() {
  const openOrders = state.workOrders.filter((order) => order.work_status !== "已完工");
  $("#completeWorkOrder").innerHTML = openOrders.map((order) => {
    const remaining = Math.max(0, Number(order.order_qty || 0) - Number(order.completed_qty || 0));
    const label = `${order.work_order_code} - ${order.product_name || order.product_code} - 未完 ${remaining}`;
    return `<option value="${escapeHtml(order.id)}">${escapeHtml(label)}</option>`;
  }).join("");
}

function renderQuotations() {
  const rows = state.quotations.map((quote) => {
    const status = quote.quote_status || quote.status;
    const converted = Number(quote.sales_order_id || 0) > 0 || status === "CONVERTED";
    return `
      <tr>
        <td>${escapeHtml(quote.quote_code)}</td>
        <td>${escapeHtml(quote.customer_name)}</td>
        <td>${escapeHtml(quote.product_code)}</td>
        <td>${escapeHtml(quote.product_name)}</td>
        <td>${escapeHtml(quote.quote_qty)}</td>
        <td>${escapeHtml(quote.unit_price)}</td>
        <td>${escapeHtml(quote.total_amount)}</td>
        <td>${escapeHtml(quote.quote_status)}</td>
        <td>${escapeHtml(quote.valid_until)}</td>
        <td>${escapeHtml(quote.owner)}</td>
        <td>
          <div class="row-actions">
            <button data-convert-quote="${quote.id}" ${!converted && status === "ACCEPTED" ? "" : "disabled"}>转销售订单</button>
            <button data-publish-quote="${quote.id}" data-quote-version="${quote.version}" ${status === "DRAFT" ? "" : "disabled"}>发布</button>
            <button data-accept-quote="${quote.id}" data-quote-version="${quote.version}" ${status === "PUBLISHED" ? "" : "disabled"}>接受</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  $("#quotationsTable").innerHTML = `
    <thead><tr>
      <th>报价单号</th><th>客户</th><th>产品编码</th><th>产品名称</th><th>数量</th><th>单价</th><th>总额</th><th>状态</th><th>有效期</th><th>负责人</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderSalesOrders() {
  const rows = state.salesOrders.map((order) => {
    const remaining = Math.max(0, Number(order.order_qty || 0) - Number(order.shipped_qty || 0));
    return `
      <tr>
        <td>${escapeHtml(order.sales_order_code)}</td>
        <td>${escapeHtml(order.customer_name)}</td>
        <td>${escapeHtml(order.product_code)}</td>
        <td>${escapeHtml(order.product_name)}</td>
        <td>${escapeHtml(order.order_qty)}</td>
        <td>${escapeHtml(order.shipped_qty)}</td>
        <td>${escapeHtml(remaining)}</td>
        <td>${escapeHtml(order.sales_status)}</td>
        <td>${escapeHtml(order.due_date)}</td>
        <td>${escapeHtml(order.finished_available_qty)}</td>
        <td>
          <div class="row-actions">
            <button data-select-sales-order="${order.id}" ${remaining <= 0 || Number(order.line_count) !== 1 ? "disabled" : ""}>出货</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  $("#salesOrdersTable").innerHTML = `
    <thead><tr>
      <th>订单号</th><th>客户</th><th>产品编码</th><th>产品名称</th><th>订单数量</th><th>已出货</th><th>未出货</th><th>状态</th><th>交付日期</th><th>成品可用</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
  renderSalesSelector();
}

function renderShipments() {
  const rows = state.shipments.map((shipment) => `
    <tr>
      <td>${escapeHtml(shipment.shipment_code)}</td>
      <td>${escapeHtml(shipment.sales_order_code)}</td>
      <td>${escapeHtml(shipment.customer_name)}</td>
      <td>${escapeHtml(shipment.product_code)}</td>
      <td>${escapeHtml(shipment.product_name)}</td>
      <td>${escapeHtml(shipment.finished_item_code)}</td>
      <td>${escapeHtml(shipment.ship_qty)}</td>
      <td>${escapeHtml(shipment.ship_date)}</td>
      <td>${escapeHtml(shipment.receiver)}</td>
    </tr>
  `).join("");
  $("#shipmentsTable").innerHTML = `
    <thead><tr>
      <th>出货单号</th><th>销售订单</th><th>客户</th><th>产品编码</th><th>产品名称</th><th>成品物料</th><th>出货数量</th><th>出货日期</th><th>收货信息</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderSalesSelector() {
  const openOrders = state.salesOrders.filter((order) => Number(order.order_qty || 0) > Number(order.shipped_qty || 0));
  $("#shipSalesOrder").innerHTML = openOrders.map((order) => {
    const remaining = Math.max(0, Number(order.order_qty || 0) - Number(order.shipped_qty || 0));
    const label = `${order.sales_order_code} - ${order.customer_name} - ${order.product_name || order.product_code} - 未出 ${remaining}`;
    return `<option value="${escapeHtml(order.id)}">${escapeHtml(label)}</option>`;
  }).join("");
}

function renderFinanceSelectors() {
  $("#arSalesOrder").innerHTML = state.financeSources.filter((row) => row.document_type === "AR").map((row) => `
    <option value="${escapeHtml(row.source_entry_id)}">${escapeHtml(row.source_code)} - ${escapeHtml(row.customer_name)} - ${escapeHtml(row.amount)} ${escapeHtml(row.currency_code)}</option>
  `).join("");
  $("#apPurchaseOrder").innerHTML = state.financeSources.filter((row) => row.document_type === "AP").map((row) => `
    <option value="${escapeHtml(row.source_entry_id)}">${escapeHtml(row.source_code)} - ${escapeHtml(row.supplier_name)} - ${escapeHtml(row.amount)} ${escapeHtml(row.currency_code)}</option>
  `).join("");
  const openDocs = state.financialDocuments.filter((doc) => Number(doc.balance_amount || 0) > 0);
  $("#paymentDoc").innerHTML = openDocs.map((doc) => `
    <option value="${escapeHtml(doc.id)}" data-type="${escapeHtml(doc.doc_type)}" data-version="${escapeHtml(doc.version)}">${escapeHtml(doc.doc_code)} - ${escapeHtml(doc.counterparty)} - 未结 ${escapeHtml(doc.balance_amount)}</option>
  `).join("");
  const selectedDoc = openDocs[0];
  if (selectedDoc) {
    $("#paymentAmount").value = selectedDoc.balance_amount;
    $("#paymentType").value = selectedDoc.doc_type === "AR" ? "收款" : "付款";
  }
}

function renderFinance() {
  const summary = state.financeSummary || {};
  const cards = [
    ["应收总额", summary.receivable_total],
    ["已收款", summary.receivable_paid],
    ["应收余额", summary.receivable_balance],
    ["应付总额", summary.payable_total],
    ["已付款", summary.payable_paid],
    ["应付余额", summary.payable_balance],
    ["现金净流入", summary.cash_net],
  ];
  $("#financeCards").innerHTML = cards.map(([label, value]) => `
    <div class="summary-card">
      <b>${escapeHtml(value ?? 0)}</b>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join("");
  $("#financialDocumentsTable").innerHTML = `
    <thead><tr>
      <th>单号</th><th>类型</th><th>往来单位</th><th>来源</th><th>总金额</th><th>已结</th><th>未结</th><th>状态</th><th>到期日</th>
    </tr></thead>
    <tbody>${state.financialDocuments.map((doc) => `
      <tr>
        <td>${escapeHtml(doc.doc_code)}</td>
        <td>${escapeHtml(doc.doc_type === "AR" ? "应收" : "应付")}</td>
        <td>${escapeHtml(doc.counterparty)}</td>
        <td>${escapeHtml(doc.source_code)}</td>
        <td>${escapeHtml(doc.total_amount)}</td>
        <td>${escapeHtml(doc.paid_amount)}</td>
        <td>${escapeHtml(doc.balance_amount)}</td>
        <td>${escapeHtml(doc.doc_status || doc.status)}</td>
        <td>${escapeHtml(doc.due_date)}</td>
      </tr>
    `).join("")}</tbody>
  `;
  $("#financialPaymentsTable").innerHTML = `
    <thead><tr>
      <th>流水号</th><th>类型</th><th>财务单据</th><th>往来单位</th><th>金额</th><th>日期</th><th>账户</th><th>经办人</th><th>动作</th>
    </tr></thead>
    <tbody>${state.financialPayments.map((row) => `
      <tr>
        <td>${escapeHtml(row.settlement_code || row.payment_code)}</td>
        <td>${escapeHtml(row.payment_type)}</td>
        <td>${escapeHtml(row.doc_code)}</td>
        <td>${escapeHtml(row.counterparty)}</td>
        <td>${escapeHtml(row.amount)}</td>
        <td>${escapeHtml(row.accounting_date || row.payment_date)}</td>
        <td>${escapeHtml(row.account_name)}</td>
        <td>${escapeHtml(row.created_by || row.handled_by)}</td>
        <td>${row.original_settlement_id ? "冲销记录" : row.is_reversed ? "已冲销" : `<button type="button" data-finance-reverse="${escapeHtml(row.id)}" data-document-version="${escapeHtml(state.financialDocuments.find((doc) => Number(doc.id) === Number(row.document_id))?.version || 0)}">全额冲销</button>`}</td>
      </tr>
    `).join("")}</tbody>
  `;
  $$('[data-finance-reverse]').forEach((button) => { button.onclick = () => reverseFinancialSettlement(Number(button.dataset.financeReverse), Number(button.dataset.documentVersion)).catch((error) => toast(error.message)); });
  renderFinanceSelectors();
}

async function renderQualityRefOptions() {
  const visible = state.session.user?.role === "purchase" ? ["IQC"] : ["production", "engineering"].includes(state.session.user?.role) ? ["IPQC", "FQC"] : state.session.user?.role === "sales" ? ["FQC"] : ["warehouse", "finance"].includes(state.session.user?.role) ? ["IQC", "FQC"] : ["IQC", "IPQC", "FQC"];
  if (!visible.includes($("#qualityType").value)) $("#qualityType").value = visible[0];
  Array.from($("#qualityType").options).forEach((option) => { option.hidden = !visible.includes(option.value); });
  const type = $("#qualityType").value;
  const result = await api(`/api/quality/source-options?inspection_type=${encodeURIComponent(type)}`); state.qualitySourceOptions = result.rows || [];
  const options = state.qualitySourceOptions.map((row) => ({ value: JSON.stringify(type === "IQC" ? { purchase_receipt_line_id: row.purchase_receipt_line_id } : type === "IPQC" ? { production_report_id: row.production_report_id } : { allocation_id: row.allocation_id }), label: `${row.source_code} - ${row.material_code} - ${row.material_name} (可检 ${row.remaining_qty} ${row.unit_code})` }));
  $("#qualityRef").innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
}

function renderQualityInspections() {
  const rows = state.qualityInspections.map((row) => `
    <tr>
      <td>${escapeHtml(row.inspection_code)}</td>
      <td>${escapeHtml(row.inspection_type)}</td>
      <td>${escapeHtml(row.purchase_receipt_line_id || row.production_report_id || row.fqc_allocation_id || "")}</td>
      <td>${escapeHtml(row.material_code)}</td>
      <td>${escapeHtml(row.material_name)}</td>
      <td>${escapeHtml(row.inspected_qty)}</td>
      <td>${escapeHtml(row.passed_qty)}</td>
      <td>${escapeHtml(row.failed_qty)}</td>
      <td>${escapeHtml(`${row.lifecycle_status}/${row.decision_status}`)}</td>
      <td>${escapeHtml(row.released_qty)}</td>
      <td>${escapeHtml(row.created_by)}</td>
      <td>${escapeHtml(row.responsible_stage)}</td>
      <td>${escapeHtml(row.inspection_date)}</td><td><button data-quality-id="${row.id}" data-quality-version="${row.version}" data-quality-code="${escapeHtml(row.inspection_code)}">选择</button></td>
    </tr>
  `).join("");
  $("#qualityInspectionsTable").innerHTML = `
    <thead><tr>
      <th>检验单号</th><th>类型</th><th>来源 ID</th><th>物料编码</th><th>物料名称</th><th>检验</th><th>合格</th><th>不良</th><th>状态</th><th>放行</th><th>创建人</th><th>责任环节</th><th>日期</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderQualityDefects() {
  const rows = state.qualityDefects.map((row) => `
    <tr>
      <td>${escapeHtml(row.inspection_code)}</td>
      <td>${escapeHtml(row.defect_type)}</td>
      <td>${escapeHtml(row.severity)}</td>
      <td>${escapeHtml(row.quantity)}</td>
      <td>${escapeHtml(row.description)}</td>
      <td>${escapeHtml(row.created_by)}</td>
      <td>${escapeHtml(row.created_at)}</td>
    </tr>
  `).join("");
  $("#qualityDefectsTable").innerHTML = `
    <thead><tr>
      <th>检验单号</th><th>不良类型</th><th>严重度</th><th>数量</th><th>说明</th><th>创建人</th><th>记录时间</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderMappings() {
  const rows = state.mappings.map((row) => `
    <tr>
      <td>${escapeHtml(row.internal_item_code)}</td>
      <td>${escapeHtml(row.supplier_name)}</td>
      <td>${escapeHtml(row.supplier_item_name)}</td>
      <td>${escapeHtml(row.supplier_item_code)}</td>
      <td>${escapeHtml(row.purchase_uom)}</td>
      <td>${escapeHtml(row.min_order_qty)}</td>
      <td>${escapeHtml(row.lead_time_days)}</td>
      <td>${escapeHtml(row.last_price)}</td>
      <td>${escapeHtml(row.match_status)}</td>
      <td>${escapeHtml(row.approved_by)}</td>
    </tr>
  `).join("");
  $("#mappingsTable").innerHTML = `
    <thead><tr>
      <th>内部编码</th><th>供应商</th><th>供应商名称</th><th>供应商料号</th><th>采购单位</th>
      <th>MOQ</th><th>交期</th><th>最近价格</th><th>状态</th><th>确认人</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderCleaning() {
  const rows = state.cleaning.map((row) => {
    const canConfirm = row.process_status === "待处理" && row.candidate_internal_code;
    const canCreate = row.process_status === "待处理" && row.match_level === "新物料";
    return `
      <tr>
        <td>${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.import_batch_no)}</td>
        <td>${escapeHtml(row.supplier_name)}</td>
        <td>${escapeHtml(row.raw_item_name)}</td>
        <td>${escapeHtml(row.raw_item_code)}</td>
        <td>${escapeHtml(row.raw_spec)}</td>
        <td>${escapeHtml(row.parsed_category)}</td>
        <td>${escapeHtml(row.candidate_internal_code)}</td>
        <td>${escapeHtml(row.candidate_standard_name)}</td>
        <td>${pill(row.match_level)}</td>
        <td>${escapeHtml(row.confidence)}</td>
        <td>${escapeHtml(row.owner_role)}</td>
        <td>${escapeHtml(row.process_status)}</td>
        <td>
          <div class="row-actions">
            <button data-confirm="${row.id}" ${canConfirm ? "" : "disabled"}>确认映射</button>
            <button data-create="${row.id}" ${canCreate ? "" : "disabled"}>新建物料</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  $("#cleaningTable").innerHTML = `
    <thead><tr>
      <th>ID</th><th>批次</th><th>供应商</th><th>原始名称</th><th>供应商料号</th><th>原始规格</th>
      <th>解析品类</th><th>候选编码</th><th>候选名称</th><th>匹配</th><th>置信度</th><th>责任</th><th>状态</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

async function refreshOperations() {
  state.managementDashboard = await api("/api/management-dashboard").then((dashboard) => {
    state.operationsAvailability.dashboard = true;
    return dashboard;
  }).catch((error) => {
    if (error.status !== 404) throw error;
    state.operationsAvailability.dashboard = false;
    return { metrics: [], risks: [{ level: "medium", text: "自托管经营看板尚未迁移，本页仅开放身份管理。" }], recent_activity: [] };
  });
  if (canManageSystem()) {
    const users = await api("/api/users");
    state.users = users.rows;
    const backups = await api("/api/backups").catch((error) => {
      if (error.status !== 404) throw error;
      return null;
    });
    state.operationsAvailability.backups = Boolean(backups);
    state.backups = backups?.latest_verification ? [{ name: backups.latest_verification.backup_id, status: backups.verification_status, verified_at: backups.latest_verification.verified_at }] : [];
  } else {
    state.backups = [];
    state.users = [];
  }
  renderOperations();
}

async function login(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "正在登录...";
  $("#loginMsg").textContent = "";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUsername").value.trim(),
        password: $("#loginPassword").value,
      }),
    });
    state.session = { authenticated: true, user: result.user, setup_required: false, csrf_token: result.csrf_token };
    updateUserBar();
    hideLogin();
    if (continueAfterAuthentication()) return;
    if (result.user.must_change_password) {
      openPasswordDialog();
    } else {
      setTab(requestedLegacyTab());
      await refreshAll();
    }
    toast("登录成功");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function setupSystem(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "正在创建...";
  $("#setupMsg").textContent = "";
  try {
    const result = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setup_token: $("#setupToken").value,
        username: $("#setupUsername").value.trim(),
        display_name: $("#setupDisplayName").value.trim(),
        password: $("#setupPassword").value,
      }),
    });
    state.session = { authenticated: true, user: result.user, setup_required: false, csrf_token: result.csrf_token };
    updateUserBar();
    hideLogin();
    if (continueAfterAuthentication()) return;
    setTab(requestedLegacyTab());
    await refreshAll();
    $("#setupForm").reset();
    toast("初始化完成，已进入系统");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function logout() {
  const button = $("#logoutBtn");
  if (button.disabled) return;
  button.disabled = true;
  try {
    await logoutSession(state.session.csrf_token || "");
    state.session = { authenticated: false, user: null };
    window.top.location.replace("/");
  } catch (error) {
    button.disabled = false;
    toast(`退出失败：${identityErrorText(error)}`);
  }
}

function openPasswordDialog() {
  $("#passwordForm").reset();
  $("#passwordMsg").textContent = "";
  $("#passwordDialog").showModal();
}

async function changePassword(event) {
  event.preventDefault();
  const newPassword = $("#newPassword").value;
  if (newPassword !== $("#newPasswordConfirm").value) {
    $("#passwordMsg").textContent = "两次新密码不一致";
    return;
  }
  const result = await identityWrite("change-own-password", "/api/me/password", {
    old_password: $("#oldPassword").value,
    new_password: newPassword,
    expected_version: state.session.user.version,
  });
  $("#passwordDialog").close();
  state.session.user = { ...state.session.user, ...result.user };
  updateUserBar();
  toast("密码已修改，其他会话已撤销");
}

async function createUser(event) {
  event.preventDefault();
  const username = $("#newUsername").value.trim();
  const result = await identityWrite(`create-user:${username}`, "/api/users", {
    username,
    display_name: $("#newUserDisplayName").value.trim(),
    role: $("#newUserRole").value,
    temporary_password: $("#newUserPassword").value,
  });
  $("#createUserForm").reset();
  $("#createUserMsg").textContent = `已创建 ${result.user.username}，首次登录必须修改密码。`;
  await refreshOperations();
  toast("账号已创建");
}

async function toggleUser(username, isActive, version) {
  await identityWrite(`user-status:${username}`, "/api/users/status", {
    username, is_active: !isActive, expected_version: version,
  });
  await refreshOperations();
  toast(isActive ? "账号已停用" : "账号已启用");
}

async function resetUserPassword(username) {
  const password = window.prompt(`请输入 ${username} 的新临时密码（至少 12 位）`);
  if (!password) return;
  const user = state.users.find((item) => item.username === username);
  await identityWrite(`reset-password:${username}`, "/api/users/reset-password", {
    username, temporary_password: password, expected_version: user?.version,
  });
  await refreshOperations();
  toast("密码已重置，用户下次登录必须修改密码");
}

async function refreshAll() {
  const [summary, items, mappings, cleaning, products, customers, suppliers, boms, purchaseOrders, purchaseLines, inventory, inventoryAdjustments, workOrders, workMaterials, productionReports, quotations, salesOrders, shipments, qualityInspections, qualityDefects, financeSummary, financialDocuments, financialPayments] = await Promise.all([
    api("/api/summary"),
    api("/api/items"),
    api("/api/mappings"),
    api("/api/cleaning"),
    api("/api/products"),
    api("/api/customers"),
    api("/api/suppliers"),
    api("/api/boms"),
    api("/api/purchase-orders"),
    api("/api/purchase-order-lines"),
    api("/api/inventory"),
    api("/api/inventory-adjustments"),
    api("/api/work-orders"),
    api("/api/work-order-materials"),
    api("/api/production-reports"),
    api("/api/quotations"),
    api("/api/sales-orders"),
    api("/api/shipments"),
    api("/api/quality-inspections"),
    api("/api/quality-defects"),
    api("/api/finance-summary"),
    api("/api/financial-documents"),
    api("/api/financial-payments"),
  ]);
  state.summary = summary;
  state.items = items.rows;
  state.mappings = mappings.rows;
  state.cleaning = cleaning.rows;
  state.products = products.rows;
  state.customers = customers.rows;
  state.suppliers = suppliers.rows;
  state.boms = boms.rows;
  state.purchaseOrders = purchaseOrders.rows;
  state.purchaseLines = purchaseLines.rows;
  state.inventory = inventory.rows;
  state.inventoryAdjustments = inventoryAdjustments.rows;
  state.workOrders = workOrders.rows;
  state.workMaterials = workMaterials.rows;
  state.productionReports = productionReports.rows;
  state.quotations = quotations.rows;
  state.salesOrders = salesOrders.rows;
  state.shipments = shipments.rows;
  state.qualityInspections = qualityInspections.rows;
  state.qualityDefects = qualityDefects.rows;
  state.financeSummary = financeSummary;
  state.financialDocuments = financialDocuments.rows;
  state.financialPayments = financialPayments.rows;
  if (state.session.user?.permissions?.includes("*") || state.session.user?.permissions?.includes("finance.post")) {
    const [arSources, apSources] = await Promise.all([api("/api/finance/source-options?document_type=AR&limit=100"), api("/api/finance/source-options?document_type=AP&limit=100")]);
    state.financeSources = [...arSources.rows, ...apSources.rows];
  } else state.financeSources = [];
  renderSummary();
  renderItems();
  renderMappings();
  renderCleaning();
  renderPartners();
  renderProducts();
  renderBoms();
  renderBomSelectors();
  renderPurchaseOrders();
  renderPurchaseLines();
  renderPurchaseSuggestions();
  renderInventory();
  renderWorkOrders();
  renderWorkMaterials();
  renderProductionReports();
  renderQuotations();
  renderSalesOrders();
  renderShipments();
  renderFinance();
  await renderQualityRefOptions();
  renderQualityInspections();
  renderQualityDefects();
  if (!state.bomLines.length && state.boms.length) {
    await loadBomLines(state.boms[0].id);
  } else {
    renderBomLines();
  }
}

async function confirmMapping(id) {
  await api("/api/cleaning/confirm", {
    method: "POST",
    body: JSON.stringify({ id, approvedBy: "系统用户" }),
  });
  await refreshAll();
  toast("映射已确认");
}

function openNewItemDialog(id) {
  const row = state.cleaning.find((entry) => String(entry.id) === String(id));
  if (!row) return;
  $("#newItemCleaningId").value = row.id;
  $("#newItemCategory").value = row.parsed_category || "OTH";
  $("#newItemName").value = row.raw_item_name;
  $("#newItemDialog").showModal();
}

async function createItem(event) {
  event.preventDefault();
  const id = Number($("#newItemCleaningId").value);
  await api("/api/cleaning/create-item", {
    method: "POST",
    body: JSON.stringify({
      id,
      item_category: $("#newItemCategory").value.trim(),
      standard_name: $("#newItemName").value.trim(),
      environmental_level: $("#newItemEnv").value.trim(),
      default_inspection_rule: $("#newItemInspection").value.trim(),
      approvedBy: "系统用户",
    }),
  });
  $("#newItemDialog").close();
  await refreshAll();
  toast("新物料已建档");
}

async function createProduct() {
  const customerName = $("#productCustomer").value.trim();
  const customer = customerName ? state.customers.find((row) => row.customer_name === customerName) : null;
  if (customerName && !customer) {
    toast("请选择已存在的客户档案");
    return;
  }
  const payload = {
    product_code: $("#productCode").value.trim(),
    product_name: $("#productName").value.trim(),
    customer_id: customer?.id || null,
    product_type: $("#productType").value.trim(),
    product_version: $("#productVersion").value.trim(),
    lifecycle_status: $("#productStatus").value.trim(),
    layer_count: $("#productLayers").value.trim(),
    board_thickness: $("#productThickness").value.trim(),
    min_line_width: $("#productLineWidth").value.trim(),
    min_hole: $("#productHole").value.trim(),
    surface_finish: $("#productFinish").value.trim(),
    smt_required: $("#productSmt").value.trim(),
    engineering_owner: "工程部",
  };
  await masterDataWrite("create-product", "/api/products", payload);
  $("#productMsg").textContent = "产品已保存";
  await refreshAll();
  toast("产品工程卡已保存");
}

async function createCustomer() {
  const payload = {
    customer_name: $("#customerName").value.trim(),
    contact_name: $("#customerContact").value.trim(),
    phone: $("#customerPhone").value.trim(),
    payment_terms: $("#customerTerms").value.trim(),
    owner: $("#customerOwner").value.trim(),
    remark: $("#customerRemark").value.trim(),
  };
  if (!payload.customer_name) {
    toast("请填写客户名称");
    return;
  }
  const result = await masterDataWrite("create-customer", "/api/customers", payload);
  $("#partnerMsg").textContent = `客户档案已保存：${result.customer_code}`;
  await refreshAll();
  toast("客户档案已保存");
}

async function createSupplier() {
  const payload = {
    supplier_name: $("#supplierName").value.trim(),
    supplier_level: $("#supplierLevel").value.trim(),
    contact_name: $("#supplierContact").value.trim(),
    phone: $("#supplierPhone").value.trim(),
    payment_terms: $("#supplierTerms").value.trim(),
    owner: $("#supplierOwner").value.trim(),
    remark: $("#supplierRemark").value.trim(),
  };
  if (!payload.supplier_name) {
    toast("请填写供应商名称");
    return;
  }
  const result = await masterDataWrite("create-supplier", "/api/suppliers", payload);
  $("#partnerMsg").textContent = `供应商档案已保存：${result.supplier_code}`;
  await refreshAll();
  toast("供应商档案已保存");
}

async function createBom() {
  const payload = {
    bom_code: $("#bomCode").value.trim(),
    product_code: $("#bomProduct").value,
    bom_version: $("#bomVersion").value.trim(),
    bom_status: $("#bomStatus").value.trim(),
    approved_by: "",
  };
  const result = await masterDataWrite("create-bom", "/api/boms", payload);
  await refreshAll();
  if (result.bom_id) await loadBomLines(result.bom_id);
  toast("BOM 已创建");
}

async function addBomLine() {
  const payload = {
    bom_id: $("#lineBom").value,
    line_no: $("#lineNo").value.trim(),
    internal_item_code: $("#lineItem").value,
    qty_per: $("#lineQty").value.trim(),
    uom: $("#lineUom").value.trim(),
    process_stage: $("#lineStage").value.trim(),
    loss_rate: $("#lineLoss").value.trim(),
  };
  await masterDataWrite(`create-bom-line:${payload.bom_id}:${payload.line_no}`, "/api/bom-lines", payload);
  await loadBomLines(payload.bom_id);
  toast("BOM 明细已加入");
}

async function loadBomLines(bomId) {
  if (!bomId) return;
  const result = await api(`/api/bom-lines?bom_id=${encodeURIComponent(bomId)}`);
  state.bomLines = result.rows;
  $("#lineBom").value = String(bomId);
  $("#readyBom").value = String(bomId);
  renderBomLines();
}

async function checkReadiness() {
  const bomId = $("#readyBom").value;
  const qty = $("#readyQty").value.trim() || "1";
  const result = await api(`/api/bom-readiness?bom_id=${encodeURIComponent(bomId)}&order_qty=${encodeURIComponent(qty)}`);
  state.readiness = result.rows;
  $("#readyMsg").textContent = result.all_ready ? "齐套，可以进入计划" : "存在缺料，请采购确认";
  renderReadiness();
}

async function loadPurchaseSuggestions() {
  const bomId = $("#purchaseBom").value;
  const qty = $("#purchaseQty").value.trim() || "1";
  if (!bomId) {
    toast("请先选择 BOM");
    return;
  }
  const result = await api(`/api/purchase-suggestions?bom_id=${encodeURIComponent(bomId)}&order_qty=${encodeURIComponent(qty)}`);
  state.purchaseSuggestions = result.suggestions;
  $("#purchaseMsg").textContent = `生成 ${result.suggestions.length} 条采购建议`;
  renderPurchaseSuggestions();
}

async function createPoFromShortage() {
  const bomId = $("#purchaseBom").value;
  const qty = $("#purchaseQty").value.trim() || "1";
  if (!bomId) {
    toast("请先选择 BOM");
    return;
  }
  const result = await procurementWrite(`purchase-from-shortage:${bomId}`, "/api/purchase-orders/from-shortage", { bom_id: bomId, order_qty: qty });
  state.purchaseSuggestions = result.suggestions;
  $("#purchaseMsg").textContent = `已生成 ${result.created.length} 张采购单`;
  await refreshAll();
  renderPurchaseSuggestions();
  toast("采购单已生成");
}

async function loadPurchaseLines(poId = "") {
  const suffix = poId ? `?po_id=${encodeURIComponent(poId)}` : "";
  const result = await api(`/api/purchase-order-lines${suffix}`);
  state.purchaseLines = result.rows;
  renderPurchaseLines();
}

async function receivePurchase() {
  const lineId = $("#receiveLine").value;
  const receiveQty = $("#receiveQty").value.trim();
  if (!lineId) {
    toast("没有可收货的采购明细");
    return;
  }
  const result = await procurementWrite(`purchase-receive:${lineId}`, "/api/purchase-receive", { line_id: lineId, receive_qty: receiveQty });
  $("#receiveMsg").textContent = `库存从 ${result.before_qty} 增加到 ${result.after_qty}`;
  await refreshAll();
  toast("收货入库完成");
}

async function createInventoryAdjustment() {
  const materialId = Number($("#adjustItem").value);
  const countedQty = $("#adjustCountedQty").value.trim();
  const inventory = state.inventory.find((item) => Number(item.material_id) === materialId);
  if (!inventory) {
    toast("请选择要盘点的物料");
    return;
  }
  const result = await api("/api/inventory-adjustments", {
    method: "POST",
    body: JSON.stringify({
      operation_type: "ADJUSTMENT",
      reason: $("#adjustReason").value.trim(),
      lines: [{
        material_id: inventory.material_id,
        unit_id: inventory.unit_id,
        counted_qty: countedQty,
        expected_balance_version: inventory.balance_version,
      }],
    }),
  });
  const line = result.data.lines[0];
  $("#adjustMsg").textContent = `${result.adjustment_code}，差异 ${line.on_hand_delta}，库存从 ${line.before_on_hand_qty} 调整到 ${line.after_on_hand_qty}`;
  await refreshAll();
  toast("库存盘点已保存");
}

async function createWorkOrder() {
  const bomId = $("#productionBom").value;
  const qty = $("#workOrderQty").value.trim() || "1";
  if (!bomId) {
    toast("请先选择 BOM");
    return;
  }
  const result = await productionWrite(`work-order-from-bom:${bomId}`, "/api/work-orders/from-bom", {
      bom_id: bomId,
      finished_material_id: $("#productionFinishedMaterial").value,
      order_qty: qty,
      owner: $("#workOrderOwner").value.trim(),
      planned_start: $("#plannedStart").value,
      planned_finish: $("#plannedFinish").value,
  });
  $("#workOrderMsg").textContent = `已生成 ${result.work_order_code}`;
  await refreshAll();
  await loadWorkOrderMaterials(result.work_order_id);
  toast("生产工单已生成");
}

async function loadWorkOrderMaterials(workOrderId = "") {
  const suffix = workOrderId ? `?work_order_id=${encodeURIComponent(workOrderId)}` : "";
  const [materials, reports] = await Promise.all([
    api(`/api/work-order-materials${suffix}`),
    api(`/api/production-reports${suffix}`),
  ]);
  state.workMaterials = materials.rows;
  state.productionReports = reports.rows;
  if (workOrderId && $("#completeWorkOrder")) {
    $("#completeWorkOrder").value = String(workOrderId);
  }
  renderWorkMaterials();
  renderProductionReports();
}

async function issueWorkOrder(workOrderId) {
  const result = await productionWrite(`work-order-issue:${workOrderId}`, "/api/work-orders/issue-materials", { work_order_id: workOrderId });
  await refreshAll();
  await loadWorkOrderMaterials(workOrderId);
  toast(`已领料 ${result.issued.length} 项`);
}

async function completeWorkOrder() {
  const workOrderId = $("#completeWorkOrder").value;
  if (!workOrderId) {
    toast("没有可报工的生产工单");
    return;
  }
  const result = await productionWrite(`work-order-complete:${workOrderId}`, "/api/work-orders/complete", {
      work_order_id: workOrderId,
      good_qty: $("#goodQty").value.trim(),
      scrap_qty: $("#scrapQty").value.trim(),
      operator: $("#productionOperator").value.trim(),
      process_stage: "完工入库",
  });
  $("#completeMsg").textContent = `${result.finished_item_code} 库存从 ${result.before_qty} 增加到 ${result.after_qty}`;
  await refreshAll();
  await loadWorkOrderMaterials(workOrderId);
  toast("完工入库完成");
}

async function createQuotation() {
  const product = state.products.find((row) => String(row.id) === String($("#quoteProduct").value));
  const material = state.inventory.find((row) => String(row.material_id) === String($("#quoteFinishedMaterial").value));
  const payload = {
    customer_id: Number($("#quoteCustomer").value),
    currency_code: "CNY",
    lines: product && material ? [{ product_id: Number(product.id), product_version_id: Number(product.product_version_id), finished_material_id: Number(material.material_id), unit_id: Number(material.unit_id), quantity: $("#quoteQty").value.trim(), unit_price: $("#quoteUnitPrice").value.trim(), remark: "" }] : [],
    valid_until: $("#quoteValidUntil").value,
    owner: $("#quoteOwner").value.trim(),
    remark: $("#quoteRemark").value.trim(),
  };
  if (!payload.customer_id) {
    toast("请选择客户");
    return;
  }
  if (!product || !material) {
    toast("请选择已发布产品和成品物料");
    return;
  }
  const result = await salesWrite("create-quotation", "/api/quotations", payload);
  await refreshAll();
  $("#quoteMsg").textContent = `已生成 ${result.quote_code}`;
  toast("报价单已生成");
}

async function publishQuotation(quoteId, expectedVersion) {
  await salesWrite(`publish-quotation:${quoteId}`, `/api/quotations/${quoteId}/publish`, { expected_version: Number(expectedVersion), reason: "" });
  await refreshAll();
  toast("报价已发布");
}

async function acceptQuotation(quoteId, expectedVersion) {
  await salesWrite(`accept-quotation:${quoteId}`, `/api/quotations/${quoteId}/accept`, { expected_version: Number(expectedVersion), reason: "" });
  await refreshAll();
  toast("报价已接受");
}

async function convertQuotation(quoteId) {
  const quote = state.quotations.find((row) => String(row.id) === String(quoteId));
  const result = await salesWrite(`convert-quotation:${quoteId}`, "/api/quotations/to-sales-order", {
      quote_id: quoteId,
      expected_version: Number(quote?.version),
      owner: $("#quoteOwner").value.trim() || "业务员",
  });
  await refreshAll();
  $("#quoteMsg").textContent = `已转销售订单 ${result.sales_order_code}`;
  toast("销售订单已创建");
}

async function createSalesOrder() {
  const product = state.products.find((row) => String(row.id) === String($("#salesProduct").value));
  const material = state.inventory.find((row) => String(row.material_id) === String($("#salesFinishedMaterial").value));
  const payload = {
    customer_id: Number($("#salesCustomer").value),
    currency_code: "CNY",
    lines: product && material ? [{ product_id: Number(product.id), product_version_id: Number(product.product_version_id), finished_material_id: Number(material.material_id), unit_id: Number(material.unit_id), quantity: $("#salesOrderQty").value.trim(), unit_price: $("#salesUnitPrice").value.trim(), remark: "" }] : [],
    due_date: $("#salesDueDate").value,
    owner: $("#salesOwner").value.trim(),
  };
  if (!payload.customer_id || !product || !material) {
    toast("请选择客户、已发布产品和成品物料");
    return;
  }
  const result = await salesWrite("create-sales-order", "/api/sales-orders", payload);
  await refreshAll();
  $("#salesMsg").textContent = `已创建 ${result.sales_order_code}`;
  toast("销售订单已创建");
}

async function shipSalesOrder() {
  const salesOrderId = $("#shipSalesOrder").value;
  if (!salesOrderId) {
    toast("没有可出货的销售订单");
    return;
  }
  const order = state.salesOrders.find((row) => String(row.id) === String(salesOrderId));
  if (!order || Number(order.line_count) !== 1) {
    toast("兼容页面只支持单行订单出货，请使用稳定多行接口");
    return;
  }
  const result = await salesWrite(`ship-sales-order:${salesOrderId}`, "/api/shipments", {
      sales_order_id: salesOrderId,
      expected_order_version: Number(order.version),
      lines: [{ sales_order_line_id: Number(order.sales_order_line_id), quantity: $("#shipQty").value.trim(), expected_line_version: Number(order.expected_line_version), expected_balance_version: Number(order.expected_balance_version) }],
      ship_date: $("#shipDate").value,
      receiver: $("#shipReceiver").value.trim(),
      reason: "销售出货",
  });
  const inventoryLine = result.data?.inventory?.lines?.[0] || {};
  $("#shipMsg").textContent = `${result.shipment_code}，库存从 ${inventoryLine.before_on_hand_qty ?? "-"} 变为 ${inventoryLine.after_on_hand_qty ?? "-"}`;
  await refreshAll();
  toast("出货完成");
}

async function createReceivable() {
  const sourceEntryId = $("#arSalesOrder").value;
  if (!sourceEntryId) {
    toast("没有可生成应收的已过账发货金额来源");
    return;
  }
  const result = await financeWrite(`finance-ar:${sourceEntryId}`, "/api/financial-documents/from-source", { document_type: "AR", source_entry_id: Number(sourceEntryId), due_date: $("#arDueDate").value });
  await refreshAll();
  $("#financeMsg").textContent = `已生成应收 ${result.doc_code}`;
  toast("应收单已生成");
}

async function createPayable() {
  const sourceEntryId = $("#apPurchaseOrder").value;
  if (!sourceEntryId) {
    toast("没有可生成应付的已过账收货金额来源");
    return;
  }
  const result = await financeWrite(`finance-ap:${sourceEntryId}`, "/api/financial-documents/from-source", { document_type: "AP", source_entry_id: Number(sourceEntryId), due_date: $("#apDueDate").value });
  await refreshAll();
  $("#financeMsg").textContent = `已生成应付 ${result.doc_code}`;
  toast("应付单已生成");
}

async function createPayment() {
  const docId = $("#paymentDoc").value;
  if (!docId) {
    toast("没有可结算的财务单据");
    return;
  }
  const selected = $("#paymentDoc").selectedOptions[0];
  const result = await financeWrite(`finance-settle:${docId}:${selected?.dataset.version}`, "/api/financial-payments", {
      doc_id: docId,
      expected_version: Number(selected?.dataset.version),
      amount: $("#paymentAmount").value.trim(),
      payment_date: $("#paymentDate").value || new Date().toISOString().slice(0, 10),
      account_name: $("#paymentAccount").value.trim(),
      reason: "财务登记收付款",
  });
  await refreshAll();
  $("#financeMsg").textContent = `已登记 ${result.payment_code}，状态：${result.doc_status}`;
  toast("收付款已登记");
}

async function reverseFinancialSettlement(settlementId, documentVersion) {
  const reason = window.prompt("请输入冲销原因"); if (!reason) return;
  await financeWrite(`finance-reverse:${settlementId}:${documentVersion}`, `/api/finance-settlements/${settlementId}/reversal`, { expected_version: documentVersion, accounting_date: new Date().toISOString().slice(0, 10), reason });
  await refreshAll(); toast("收付款已全额冲销");
}

async function createQualityInspection() {
  const refValue = $("#qualityRef").value;
  if (!refValue) {
    toast("没有可检验的来源单据");
    return;
  }
  const ref = JSON.parse(refValue);
  const inspectedQty = $("#inspectionQty").value.trim();
  const passedQty = $("#passedQty").value.trim();
  const failedQty = $("#failedQty").value.trim();
  const hasFailure = !/^0(?:\.0{1,6})?$/.test(failedQty);
  const payload = {
    inspection_type: $("#qualityType").value,
    ...ref,
    inspected_qty: inspectedQty,
    passed_qty: passedQty,
    failed_qty: failedQty,
    results: [{ characteristic: $("#qualityCharacteristic").value.trim(), result: $("#qualityResult").value }],
    defects: hasFailure ? [{ result_line_no: 1, defect_type: $("#defectType").value.trim(), severity: $("#defectSeverity").value, quantity: failedQty, description: $("#qualityRemark").value.trim() }] : [],
    responsible_stage: $("#responsibleStage").value.trim(),
    remark: $("#qualityRemark").value.trim(),
  };
  if (hasFailure !== (payload.results[0].result === "FAIL")) { toast("不良数量与 PASS/FAIL 结果不一致"); return; }
  if (hasFailure && !payload.defects[0].defect_type) { toast("有不良数量时请填写不良类型"); return; }
  const result = await qualityWrite(`quality-create:${crypto.randomUUID()}`, "/api/quality-inspections", payload);
  $("#qualityMsg").textContent = `已保存 ${result.data.inspection_code}，状态：OPEN/PENDING`;
  await refreshAll();
  toast("品质检验记录已保存");
}

function selectedQuality() { if (!state.selectedInspection) throw new Error("请先从检验列表选择记录"); return state.selectedInspection; }
async function addQualityDefect() { const selected = selectedQuality(); const result = await qualityWrite(`quality-defect:${selected.id}:${selected.version}`, `/api/quality-inspections/${selected.id}/defects`, { expected_version: selected.version, defect_type: $("#defectType").value.trim(), severity: $("#defectSeverity").value, quantity: $("#defectQty").value.trim(), description: $("#qualityActionReason").value.trim() }); selected.version = Number(result.inspection_version); $("#selectedInspection").value = `${$("#selectedInspection").value.split(" (v")[0]} (v${selected.version})`; await refreshAll(); toast("缺陷已追加"); }
async function dispositionQuality() { const selected = selectedQuality(); const code = $("#disposition").value; await qualityWrite(`quality-disposition:${selected.id}:${selected.version}`, `/api/quality-inspections/${selected.id}/dispositions`, { expected_version: selected.version, disposition_code: code, release_qty: ["RELEASE", "CONCESSION"].includes(code) ? $("#releaseQty").value.trim() : undefined, reason: $("#qualityActionReason").value.trim() }); state.selectedInspection = null; $("#selectedInspection").value = ""; await refreshAll(); toast("品质处置已记录"); }
async function closeQuality() { const selected = selectedQuality(); await qualityWrite(`quality-close:${selected.id}:${selected.version}`, `/api/quality-inspections/${selected.id}/close`, { expected_version: selected.version, reason: $("#qualityActionReason").value.trim() }); state.selectedInspection = null; $("#selectedInspection").value = ""; await refreshAll(); toast("检验已关闭"); }
async function reopenQuality() { const selected = selectedQuality(); await qualityWrite(`quality-reopen:${selected.id}:${selected.version}`, `/api/quality-inspections/${selected.id}/reopen`, { expected_version: selected.version, reason: $("#qualityActionReason").value.trim() }); state.selectedInspection = null; $("#selectedInspection").value = ""; await refreshAll(); toast("检验已重开"); }

function bindEvents() {
  $("#setupForm").addEventListener("submit", (event) => setupSystem(event).catch((error) => {
    $("#setupMsg").textContent = error.message;
  }));
  $("#loginForm").addEventListener("submit", (event) => login(event).catch((error) => {
    $("#loginMsg").textContent = error.message;
  }));
  $("#logoutBtn").addEventListener("click", () => void logout());
  $("#changePasswordBtn").addEventListener("click", openPasswordDialog);
  $("#cancelPasswordBtn").addEventListener("click", () => $("#passwordDialog").close());
  $("#passwordForm").addEventListener("submit", (event) => changePassword(event).catch((error) => {
    $("#passwordMsg").textContent = error.message;
  }));
  $$(".nav[data-tab]").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#refreshOpsBtn").addEventListener("click", () => refreshOperations().catch((error) => toast(error.message)));
  $("#createUserForm").addEventListener("submit", (event) => createUser(event).catch((error) => {
    $("#createUserMsg").textContent = identityErrorText(error);
  }));
  $("#usersTable").addEventListener("click", (event) => {
    const username = event.target.dataset.toggleUser;
    const resetUsername = event.target.dataset.resetUser;
    if (username) toggleUser(username, event.target.dataset.userActive === "1", Number(event.target.dataset.userVersion)).catch((error) => toast(error.message));
    if (resetUsername) resetUserPassword(resetUsername).catch((error) => toast(error.message));
  });
  $("#cleaningTable").addEventListener("click", async (event) => {
    const confirmId = event.target.dataset.confirm;
    const createId = event.target.dataset.create;
    if (confirmId) await confirmMapping(Number(confirmId));
    if (createId) openNewItemDialog(Number(createId));
  });
  $("#createItemBtn").addEventListener("click", createItem);
  $("#createCustomerBtn").addEventListener("click", createCustomer);
  $("#createSupplierBtn").addEventListener("click", createSupplier);
  $("#createProductBtn").addEventListener("click", createProduct);
  $("#createBomBtn").addEventListener("click", createBom);
  $("#addBomLineBtn").addEventListener("click", addBomLine);
  $("#checkReadyBtn").addEventListener("click", checkReadiness);
  $("#loadPurchaseSuggestionsBtn").addEventListener("click", loadPurchaseSuggestions);
  $("#createPoFromShortageBtn").addEventListener("click", createPoFromShortage);
  $("#receivePurchaseBtn").addEventListener("click", receivePurchase);
  $("#createAdjustmentBtn").addEventListener("click", createInventoryAdjustment);
  $("#createWorkOrderBtn").addEventListener("click", createWorkOrder);
  $("#completeWorkOrderBtn").addEventListener("click", completeWorkOrder);
  $("#createQuoteBtn").addEventListener("click", createQuotation);
  $("#createSalesOrderBtn").addEventListener("click", createSalesOrder);
  $("#shipSalesOrderBtn").addEventListener("click", shipSalesOrder);
  $("#createReceivableBtn").addEventListener("click", createReceivable);
  $("#createPayableBtn").addEventListener("click", createPayable);
  $("#createPaymentBtn").addEventListener("click", createPayment);
  $("#paymentDoc").addEventListener("change", () => {
    const option = $("#paymentDoc").selectedOptions[0];
    if (option) $("#paymentType").value = option.dataset.type === "应收" ? "收款" : "付款";
  });
  $("#qualityType").addEventListener("change", () => renderQualityRefOptions().catch((error) => toast(error.message)));
  $("#createInspectionBtn").addEventListener("click", createQualityInspection);
  $("#addDefectBtn").addEventListener("click", () => addQualityDefect().catch((error) => toast(error.message)));
  $("#dispositionInspectionBtn").addEventListener("click", () => dispositionQuality().catch((error) => toast(error.message)));
  $("#closeInspectionBtn").addEventListener("click", () => closeQuality().catch((error) => toast(error.message)));
  $("#reopenInspectionBtn").addEventListener("click", () => reopenQuality().catch((error) => toast(error.message)));
  $("#qualityInspectionsTable").addEventListener("click", (event) => { const button = event.target.closest("[data-quality-id]"); if (!button) return; state.selectedInspection = { id: Number(button.dataset.qualityId), version: Number(button.dataset.qualityVersion) }; $("#selectedInspection").value = `${button.dataset.qualityCode} (v${button.dataset.qualityVersion})`; });
  $("#bomsTable").addEventListener("click", async (event) => {
    const bomId = event.target.dataset.viewBom;
    if (bomId) await loadBomLines(bomId);
  });
  $("#purchaseOrdersTable").addEventListener("click", async (event) => {
    const poId = event.target.dataset.viewPo;
    if (poId) await loadPurchaseLines(poId);
  });
  $("#purchaseLinesTable").addEventListener("click", (event) => {
    const lineId = event.target.dataset.receiveLine;
    if (lineId) {
      $("#receiveLine").value = lineId;
      setTab("purchase");
    }
  });
  $("#workOrdersTable").addEventListener("click", async (event) => {
    const viewId = event.target.dataset.viewWorkOrder;
    const issueId = event.target.dataset.issueWorkOrder;
    if (viewId) await loadWorkOrderMaterials(viewId);
    if (issueId) await issueWorkOrder(issueId);
  });
  $("#quotationsTable").addEventListener("click", async (event) => {
    const quoteId = event.target.dataset.convertQuote;
    const publishId = event.target.dataset.publishQuote;
    const acceptId = event.target.dataset.acceptQuote;
    if (publishId) await publishQuotation(publishId, event.target.dataset.quoteVersion);
    else if (acceptId) await acceptQuotation(acceptId, event.target.dataset.quoteVersion);
    else if (quoteId) await convertQuotation(quoteId);
  });
  $("#salesOrdersTable").addEventListener("click", (event) => {
    const salesOrderId = event.target.dataset.selectSalesOrder;
    if (salesOrderId) {
      $("#shipSalesOrder").value = salesOrderId;
      setTab("sales");
    }
  });
}

async function initApp() {
  bindEvents();
  const session = await loadSession();
  if (session.authenticated) {
    if (continueAfterAuthentication()) return;
    if (session.user.must_change_password) openPasswordDialog();
    else {
      setTab(requestedLegacyTab());
      await refreshAll();
    }
  }
}

initApp().catch((error) => toast(error.message));
