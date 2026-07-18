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
  session: { authenticated: false, user: null },
  managementDashboard: null,
  backups: [],
  users: [],
  cleaningConfidenceSort: "newest",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  const contentType = response.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401 && !["/api/session", "/api/login"].includes(path)) {
      showLogin();
    }
    throw new Error(data.error || "请求失败");
  }
  return data;
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

function importWarningText(code) {
  const messages = {
    FILE_EXTENSION_DIFFERS_FROM_CONTENT_SIGNATURE: "文件后缀与实际类型不同，已按实际 Excel 类型处理",
    SOURCE_COLUMNS_EXCEED_ANALYSIS_LIMIT_ORIGINAL_FILE_ARCHIVE_REQUIRED: "原文件已完整归档，仅从可信表头范围生成待审核行",
    MATERIAL_NAME_FROM_SPECIFICATION_REVIEW_REQUIRED: "物料名称使用规格描述候选，必须人工确认",
    MATERIAL_UNIT_REVIEW_REQUIRED: "原表缺少单位，建档前必须人工填写",
  };
  return messages[code] || code;
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
  $("#loginUsername")?.focus();
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
  if (result.authenticated) {
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
    ["待处理", state.summary.pending],
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
  $("#backupAdminHint").hidden = canManage;
  $("#createBackupBtn").disabled = !canManage;
  $("#backupTable").innerHTML = `
    <thead><tr><th>备份文件</th><th>大小</th><th>时间</th><th>操作</th></tr></thead>
    <tbody>${state.backups.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${Math.round((Number(row.size) || 0) / 1024)} KB</td>
        <td>${escapeHtml(row.created_at)}</td>
        <td><button data-restore-backup="${escapeHtml(row.name)}" ${canManage ? "" : "disabled"}>恢复</button></td>
      </tr>
    `).join("") || `<tr><td colspan="4">还没有备份</td></tr>`}</tbody>
  `;
  $("#usersTable").innerHTML = `
    <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>最近登录</th></tr></thead>
    <tbody>${state.users.map((row) => `
      <tr>
        <td>${escapeHtml(row.username)}</td>
        <td>${escapeHtml(row.display_name)}</td>
        <td><span class="pill auto">${escapeHtml(row.role_label)}</span></td>
        <td>${row.is_active ? "启用" : "停用"}</td>
        <td>${escapeHtml(row.last_login_at || "-")}</td>
      </tr>
    `).join("") || `<tr><td colspan="5">当前账号无权查看用户清单</td></tr>`}</tbody>
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
  $("#bomProduct").innerHTML = productOptions;
  $("#lineBom").innerHTML = bomOptions;
  $("#readyBom").innerHTML = bomOptions;
  $("#purchaseBom").innerHTML = bomOptions;
  $("#productionBom").innerHTML = bomOptions;
  $("#quoteProduct").innerHTML = productOptions;
  $("#salesProduct").innerHTML = productOptions;
  $("#lineItem").innerHTML = itemOptions;
  $("#adjustItem").innerHTML = itemOptions;
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
      <td>${escapeHtml(item.available_qty)}</td>
      <td>${escapeHtml(item.base_uom)}</td>
      <td>${escapeHtml(item.updated_at)}</td>
    </tr>
  `).join("");
  $("#inventoryTable").innerHTML = `
    <thead><tr>
      <th>物料编码</th><th>物料名称</th><th>品类</th><th>现有库存</th><th>已预留</th><th>可用库存</th><th>单位</th><th>更新时间</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
  const adjustments = state.inventoryAdjustments.map((row) => `
    <tr>
      <td>${escapeHtml(row.adjustment_code)}</td>
      <td>${escapeHtml(row.internal_item_code)}</td>
      <td>${escapeHtml(row.standard_name)}</td>
      <td>${escapeHtml(row.before_qty)}</td>
      <td>${escapeHtml(row.counted_qty)}</td>
      <td>${escapeHtml(row.delta_qty)}</td>
      <td>${escapeHtml(row.after_qty)}</td>
      <td>${escapeHtml(row.reason)}</td>
      <td>${escapeHtml(row.adjusted_by)}</td>
      <td>${escapeHtml(row.created_at)}</td>
    </tr>
  `).join("");
  $("#inventoryAdjustmentsTable").innerHTML = `
    <thead><tr>
      <th>盘点单</th><th>物料编码</th><th>物料名称</th><th>调整前</th><th>实盘数</th><th>差异</th><th>调整后</th><th>原因</th><th>经办人</th><th>时间</th>
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
    const converted = Number(quote.sales_order_id || 0) > 0 || quote.quote_status === "已转订单";
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
            <button data-convert-quote="${quote.id}" ${converted ? "disabled" : ""}>转销售订单</button>
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
            <button data-select-sales-order="${order.id}" ${remaining <= 0 ? "disabled" : ""}>出货</button>
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
  $("#arSalesOrder").innerHTML = state.salesOrders.map((order) => `
    <option value="${escapeHtml(order.id)}">${escapeHtml(order.sales_order_code)} - ${escapeHtml(order.customer_name)} - ${escapeHtml(order.product_name || order.product_code)}</option>
  `).join("");
  $("#apPurchaseOrder").innerHTML = state.purchaseOrders.map((po) => `
    <option value="${escapeHtml(po.id)}">${escapeHtml(po.po_code)} - ${escapeHtml(po.supplier_name)} - ${escapeHtml(po.po_status)}</option>
  `).join("");
  const openDocs = state.financialDocuments.filter((doc) => Number(doc.balance_amount || 0) > 0);
  $("#paymentDoc").innerHTML = openDocs.map((doc) => `
    <option value="${escapeHtml(doc.id)}" data-type="${escapeHtml(doc.doc_type)}">${escapeHtml(doc.doc_code)} - ${escapeHtml(doc.counterparty)} - 未结 ${escapeHtml(doc.balance_amount)}</option>
  `).join("");
  const selectedDoc = openDocs[0];
  if (selectedDoc) {
    $("#paymentAmount").value = selectedDoc.balance_amount;
    $("#paymentType").value = selectedDoc.doc_type === "应收" ? "收款" : "付款";
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
        <td>${escapeHtml(doc.doc_type)}</td>
        <td>${escapeHtml(doc.counterparty)}</td>
        <td>${escapeHtml(doc.source_code)}</td>
        <td>${escapeHtml(doc.total_amount)}</td>
        <td>${escapeHtml(doc.paid_amount)}</td>
        <td>${escapeHtml(doc.balance_amount)}</td>
        <td>${escapeHtml(doc.doc_status)}</td>
        <td>${escapeHtml(doc.due_date)}</td>
      </tr>
    `).join("")}</tbody>
  `;
  $("#financialPaymentsTable").innerHTML = `
    <thead><tr>
      <th>流水号</th><th>类型</th><th>财务单据</th><th>往来单位</th><th>金额</th><th>日期</th><th>账户</th><th>经办人</th>
    </tr></thead>
    <tbody>${state.financialPayments.map((row) => `
      <tr>
        <td>${escapeHtml(row.payment_code)}</td>
        <td>${escapeHtml(row.payment_type)}</td>
        <td>${escapeHtml(row.doc_code)}</td>
        <td>${escapeHtml(row.counterparty)}</td>
        <td>${escapeHtml(row.amount)}</td>
        <td>${escapeHtml(row.payment_date)}</td>
        <td>${escapeHtml(row.account_name)}</td>
        <td>${escapeHtml(row.handled_by)}</td>
      </tr>
    `).join("")}</tbody>
  `;
  renderFinanceSelectors();
}

function renderQualityRefOptions() {
  const type = $("#qualityType")?.value || "IPQC";
  let options = [];
  if (type === "IQC") {
    options = state.purchaseLines.map((line) => ({
      value: JSON.stringify({ ref_type: "采购明细", ref_id: line.id, item_code: line.internal_item_code, product_code: "" }),
      label: `${line.po_code || "采购单"} - ${line.internal_item_code} - ${line.standard_name || ""}`,
    }));
  } else if (type === "IPQC") {
    options = state.workOrders.map((order) => ({
      value: JSON.stringify({ ref_type: "生产工单", ref_id: order.id, item_code: "", product_code: order.product_code }),
      label: `${order.work_order_code} - ${order.product_name || order.product_code}`,
    }));
  } else {
    options = state.salesOrders.map((order) => ({
      value: JSON.stringify({ ref_type: "销售订单", ref_id: order.id, item_code: "", product_code: order.product_code }),
      label: `${order.sales_order_code} - ${order.customer_name} - ${order.product_name || order.product_code}`,
    }));
  }
  $("#qualityRef").innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
}

function renderQualityInspections() {
  const rows = state.qualityInspections.map((row) => `
    <tr>
      <td>${escapeHtml(row.inspection_code)}</td>
      <td>${escapeHtml(row.inspection_type)}</td>
      <td>${escapeHtml(row.ref_type)}</td>
      <td>${escapeHtml(row.item_code || row.product_code)}</td>
      <td>${escapeHtml(row.item_name || row.product_name)}</td>
      <td>${escapeHtml(row.inspected_qty)}</td>
      <td>${escapeHtml(row.passed_qty)}</td>
      <td>${escapeHtml(row.failed_qty)}</td>
      <td>${escapeHtml(row.inspection_status)}</td>
      <td>${escapeHtml(row.disposition)}</td>
      <td>${escapeHtml(row.inspector)}</td>
      <td>${escapeHtml(row.responsible_stage)}</td>
      <td>${escapeHtml(row.inspection_date)}</td>
    </tr>
  `).join("");
  $("#qualityInspectionsTable").innerHTML = `
    <thead><tr>
      <th>检验单号</th><th>类型</th><th>来源</th><th>对象编码</th><th>对象名称</th><th>检验</th><th>合格</th><th>不良</th><th>状态</th><th>处置</th><th>检验员</th><th>责任环节</th><th>日期</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderQualityDefects() {
  const rows = state.qualityDefects.map((row) => `
    <tr>
      <td>${escapeHtml(row.inspection_code)}</td>
      <td>${escapeHtml(row.inspection_type)}</td>
      <td>${escapeHtml(row.defect_type)}</td>
      <td>${escapeHtml(row.severity)}</td>
      <td>${escapeHtml(row.defect_qty)}</td>
      <td>${escapeHtml(row.responsible_stage)}</td>
      <td>${escapeHtml(row.corrective_action)}</td>
      <td>${escapeHtml(row.created_at)}</td>
    </tr>
  `).join("");
  $("#qualityDefectsTable").innerHTML = `
    <thead><tr>
      <th>检验单号</th><th>类型</th><th>不良类型</th><th>严重度</th><th>数量</th><th>责任环节</th><th>改善措施</th><th>记录时间</th>
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
        <td>${escapeHtml(row.purchase_uom)}</td>
        <td>${escapeHtml(row.source_sheet_name ? `${row.source_sheet_name} #${row.source_row_number || ""}` : "")}</td>
        <td>${escapeHtml(row.mapping_status)}</td>
        <td>${escapeHtml(row.specification_confidence)}</td>
        <td>${escapeHtml(row.review_status)}</td>
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
      <th>单位</th><th>来源行</th><th>映射状态</th><th>规格置信度</th><th>审核状态</th>
      <th>解析品类</th><th>候选编码</th><th>候选名称</th><th>匹配</th><th>置信度</th><th>责任</th><th>状态</th><th>操作</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  `;
}

async function refreshOperations() {
  const dashboard = await api("/api/management-dashboard");
  state.managementDashboard = dashboard;
  if (canManageSystem()) {
    const [backups, users] = await Promise.all([
      api("/api/backups"),
      api("/api/users"),
    ]);
    state.backups = backups.rows;
    state.users = users.rows;
  } else {
    state.backups = [];
    state.users = [];
  }
  renderOperations();
}

async function login(event) {
  event.preventDefault();
  $("#loginMsg").textContent = "";
  const result = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({
      username: $("#loginUsername").value.trim(),
      password: $("#loginPassword").value,
    }),
  });
  state.session = { authenticated: true, user: result.user };
  updateUserBar();
  hideLogin();
  await refreshAll();
  toast("登录成功");
}

async function logout() {
  await api("/api/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => null);
  state.session = { authenticated: false, user: null };
  updateUserBar();
  showLogin();
  toast("已退出登录");
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
  await api("/api/me/password", {
    method: "POST",
    body: JSON.stringify({
      old_password: $("#oldPassword").value,
      new_password: newPassword,
    }),
  });
  $("#passwordDialog").close();
  toast("密码已修改");
}

async function createBackup() {
  const result = await api("/api/backups/create", { method: "POST", body: JSON.stringify({}) });
  state.backups = result.rows;
  renderOperations();
  toast(`已创建备份：${result.backup.name}`);
}

async function restoreBackup(name) {
  const ok = window.confirm(`确认恢复备份 ${name}？恢复后当前数据库会回到备份时点。`);
  if (!ok) return;
  await api("/api/backups/restore", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  await refreshAll();
  await refreshOperations();
  toast("备份已恢复");
}

async function refreshAll() {
  const cleaningQuery = encodeURIComponent(state.cleaningConfidenceSort);
  const [summary, items, mappings, cleaning, products, customers, suppliers, boms, purchaseOrders, purchaseLines, inventory, inventoryAdjustments, workOrders, workMaterials, productionReports, quotations, salesOrders, shipments, qualityInspections, qualityDefects, financeSummary, financialDocuments, financialPayments] = await Promise.all([
    api("/api/summary"),
    api("/api/items"),
    api("/api/mappings"),
    api(`/api/cleaning?confidence_sort=${cleaningQuery}`),
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
  renderQualityRefOptions();
  renderQualityInspections();
  renderQualityDefects();
  if (!state.bomLines.length && state.boms.length) {
    await loadBomLines(state.boms[0].id);
  } else {
    renderBomLines();
  }
}

async function refreshCleaning() {
  const sort = encodeURIComponent(state.cleaningConfidenceSort);
  const result = await api(`/api/cleaning?confidence_sort=${sort}`);
  state.cleaning = result.rows;
  renderCleaning();
}

async function loadSample() {
  const sample = await api("/api/sample-import");
  $("#csvFile").value = "";
  $("#csvText").value = sample.csv;
  toast("已载入示例供应商物料");
}

async function runImport() {
  const file = $("#csvFile").files[0];
  const batchNo = $("#batchNo").value.trim();
  if (file) {
    if (file.size > 10 * 1024 * 1024) {
      toast("导入文件不能超过 10 MiB");
      return;
    }
    const suffix = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    if (![".csv", ".xlsx", ".xls"].includes(suffix)) {
      toast("仅支持 CSV、XLSX、XLS 文件");
      return;
    }
    $("#importMsg").textContent = "正在上传并识别工作表与表头…";
    const query = new URLSearchParams({ filename: file.name });
    if (batchNo) query.set("batch_no", batchNo);
    const result = await api(`/api/import-file?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const headerLabel = result.header_start_row === result.header_end_row
      ? `第 ${result.header_start_row} 行`
      : `第 ${result.header_start_row}～${result.header_end_row} 行`;
    const warningText = (result.warnings || []).map(importWarningText).join("；");
    $("#importMsg").textContent = `已从 ${result.selected_sheet} 生成 ${result.count} 条待审核行，表头 ${headerLabel}，批次 ${result.batch_no}${warningText ? `；${warningText}` : ""}`;
    await refreshAll();
    setTab("cleaning");
    toast(`${result.source_type} 已进入清洗审核`);
    return;
  }
  const csvText = $("#csvText").value.trim();
  if (!csvText) {
    toast("请先选择 CSV、XLSX、XLS 文件，或粘贴 CSV");
    return;
  }
  const result = await api("/api/import", {
    method: "POST",
    body: JSON.stringify({ csvText, batchNo }),
  });
  $("#importMsg").textContent = `已导入 ${result.count} 行，批次 ${result.batch_no}`;
  await refreshAll();
  setTab("cleaning");
  toast("导入与匹配完成");
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
  $("#newItemSpec").value = row.raw_spec || "";
  $("#newItemUom").value = row.purchase_uom || "";
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
      specification: $("#newItemSpec").value.trim(),
      base_uom: $("#newItemUom").value.trim(),
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
  const payload = {
    product_code: $("#productCode").value.trim(),
    product_name: $("#productName").value.trim(),
    customer_name: $("#productCustomer").value.trim(),
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
  await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
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
  const result = await api("/api/customers", { method: "POST", body: JSON.stringify(payload) });
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
  const result = await api("/api/suppliers", { method: "POST", body: JSON.stringify(payload) });
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
  const result = await api("/api/boms", { method: "POST", body: JSON.stringify(payload) });
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
  await api("/api/bom-lines", { method: "POST", body: JSON.stringify(payload) });
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
  const result = await api("/api/purchase-orders/from-shortage", {
    method: "POST",
    body: JSON.stringify({ bom_id: bomId, order_qty: qty, createdBy: "系统用户" }),
  });
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
  const result = await api("/api/purchase-receive", {
    method: "POST",
    body: JSON.stringify({ line_id: lineId, receive_qty: receiveQty }),
  });
  $("#receiveMsg").textContent = `库存从 ${result.before_qty} 增加到 ${result.after_qty}`;
  await refreshAll();
  toast("收货入库完成");
}

async function createInventoryAdjustment() {
  const itemCode = $("#adjustItem").value;
  const countedQty = $("#adjustCountedQty").value.trim();
  if (!itemCode) {
    toast("请选择要盘点的物料");
    return;
  }
  const result = await api("/api/inventory-adjustments", {
    method: "POST",
    body: JSON.stringify({
      internal_item_code: itemCode,
      counted_qty: countedQty,
      reason: $("#adjustReason").value.trim(),
      adjusted_by: $("#adjustedBy").value.trim(),
    }),
  });
  $("#adjustMsg").textContent = `${result.adjustment_code}，差异 ${result.delta_qty}，库存从 ${result.before_qty} 调整到 ${result.after_qty}`;
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
  const result = await api("/api/work-orders/from-bom", {
    method: "POST",
    body: JSON.stringify({
      bom_id: bomId,
      order_qty: qty,
      owner: $("#workOrderOwner").value.trim(),
      planned_start: $("#plannedStart").value,
      planned_finish: $("#plannedFinish").value,
    }),
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
  const result = await api("/api/work-orders/issue-materials", {
    method: "POST",
    body: JSON.stringify({ work_order_id: workOrderId }),
  });
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
  const result = await api("/api/work-orders/complete", {
    method: "POST",
    body: JSON.stringify({
      work_order_id: workOrderId,
      good_qty: $("#goodQty").value.trim(),
      scrap_qty: $("#scrapQty").value.trim(),
      operator: $("#productionOperator").value.trim(),
      process_stage: "完工入库",
    }),
  });
  $("#completeMsg").textContent = `${result.finished_item_code} 库存从 ${result.before_qty} 增加到 ${result.after_qty}`;
  await refreshAll();
  await loadWorkOrderMaterials(workOrderId);
  toast("完工入库完成");
}

async function createQuotation() {
  const payload = {
    customer_name: $("#quoteCustomer").value.trim(),
    product_code: $("#quoteProduct").value,
    quote_qty: $("#quoteQty").value.trim(),
    unit_price: $("#quoteUnitPrice").value.trim(),
    valid_until: $("#quoteValidUntil").value,
    owner: $("#quoteOwner").value.trim(),
    remark: $("#quoteRemark").value.trim(),
  };
  if (!payload.customer_name) {
    toast("请填写客户名称");
    return;
  }
  if (!payload.product_code) {
    toast("请选择产品");
    return;
  }
  const result = await api("/api/quotations", { method: "POST", body: JSON.stringify(payload) });
  await refreshAll();
  $("#quoteMsg").textContent = `已生成 ${result.quote_code}`;
  toast("报价单已生成");
}

async function convertQuotation(quoteId) {
  const result = await api("/api/quotations/to-sales-order", {
    method: "POST",
    body: JSON.stringify({
      quote_id: quoteId,
      owner: $("#quoteOwner").value.trim() || "业务员",
    }),
  });
  await refreshAll();
  $("#quoteMsg").textContent = `已转销售订单 ${result.sales_order_code}`;
  toast("销售订单已创建");
}

async function createSalesOrder() {
  const payload = {
    customer_name: $("#salesCustomer").value.trim(),
    product_code: $("#salesProduct").value,
    order_qty: $("#salesOrderQty").value.trim(),
    due_date: $("#salesDueDate").value,
    owner: $("#salesOwner").value.trim(),
  };
  if (!payload.customer_name) {
    toast("请填写客户名称");
    return;
  }
  const result = await api("/api/sales-orders", { method: "POST", body: JSON.stringify(payload) });
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
  const result = await api("/api/shipments/from-order", {
    method: "POST",
    body: JSON.stringify({
      sales_order_id: salesOrderId,
      ship_qty: $("#shipQty").value.trim(),
      ship_date: $("#shipDate").value,
      receiver: $("#shipReceiver").value.trim(),
    }),
  });
  $("#shipMsg").textContent = `${result.shipment_code}，库存从 ${result.before_qty} 变为 ${result.after_qty}`;
  await refreshAll();
  toast("出货完成");
}

async function createReceivable() {
  const salesOrderId = $("#arSalesOrder").value;
  const amount = $("#arAmount").value.trim();
  if (!salesOrderId) {
    toast("没有可生成应收的销售订单");
    return;
  }
  const result = await api("/api/financial-documents/from-sales-order", {
    method: "POST",
    body: JSON.stringify({
      sales_order_id: salesOrderId,
      total_amount: amount,
      due_date: $("#arDueDate").value,
      created_by: "财务员",
    }),
  });
  await refreshAll();
  $("#financeMsg").textContent = `已生成应收 ${result.doc_code}`;
  toast("应收单已生成");
}

async function createPayable() {
  const poId = $("#apPurchaseOrder").value;
  const amount = $("#apAmount").value.trim();
  if (!poId) {
    toast("没有可生成应付的采购单");
    return;
  }
  const result = await api("/api/financial-documents/from-purchase-order", {
    method: "POST",
    body: JSON.stringify({
      po_id: poId,
      total_amount: amount,
      due_date: $("#apDueDate").value,
      created_by: "财务员",
    }),
  });
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
  const result = await api("/api/financial-payments", {
    method: "POST",
    body: JSON.stringify({
      doc_id: docId,
      payment_type: $("#paymentType").value,
      amount: $("#paymentAmount").value.trim(),
      payment_date: $("#paymentDate").value,
      account_name: $("#paymentAccount").value.trim(),
      handled_by: $("#paymentHandler").value.trim(),
    }),
  });
  await refreshAll();
  $("#financeMsg").textContent = `已登记 ${result.payment_code}，状态：${result.doc_status}`;
  toast("收付款已登记");
}

async function createQualityInspection() {
  const refValue = $("#qualityRef").value;
  if (!refValue) {
    toast("没有可检验的来源单据");
    return;
  }
  const ref = JSON.parse(refValue);
  const inspectedQty = Number($("#inspectionQty").value || 0);
  const passedQty = Number($("#passedQty").value || 0);
  const failedQty = Math.max(0, inspectedQty - passedQty);
  const payload = {
    inspection_type: $("#qualityType").value,
    ...ref,
    inspected_qty: inspectedQty,
    passed_qty: passedQty,
    failed_qty: failedQty,
    defect_type: $("#defectType").value.trim(),
    defect_qty: failedQty,
    disposition: $("#disposition").value,
    inspector: $("#inspector").value.trim(),
    responsible_stage: $("#responsibleStage").value.trim(),
    remark: $("#qualityRemark").value.trim(),
  };
  if (failedQty > 0 && !payload.defect_type) {
    toast("有不良数量时请填写不良类型");
    return;
  }
  if (failedQty > 0 && !payload.disposition) {
    toast("有不良数量时请选择处置方式");
    return;
  }
  const result = await api("/api/quality-inspections", { method: "POST", body: JSON.stringify(payload) });
  $("#qualityMsg").textContent = `已保存 ${result.inspection_code}，状态：${result.inspection_status}`;
  await refreshAll();
  toast("品质检验记录已保存");
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", (event) => login(event).catch((error) => {
    $("#loginMsg").textContent = error.message;
  }));
  $("#logoutBtn").addEventListener("click", logout);
  $("#changePasswordBtn").addEventListener("click", openPasswordDialog);
  $("#cancelPasswordBtn").addEventListener("click", () => $("#passwordDialog").close());
  $("#passwordForm").addEventListener("submit", (event) => changePassword(event).catch((error) => {
    $("#passwordMsg").textContent = error.message;
  }));
  $$(".nav").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#refreshOpsBtn").addEventListener("click", () => refreshOperations().catch((error) => toast(error.message)));
  $("#createBackupBtn").addEventListener("click", () => createBackup().catch((error) => toast(error.message)));
  $("#backupTable").addEventListener("click", async (event) => {
    const backupName = event.target.dataset.restoreBackup;
    if (backupName) await restoreBackup(backupName);
  });
  $("#loadSampleBtn").addEventListener("click", () => loadSample().catch((error) => toast(error.message)));
  $("#runImportBtn").addEventListener("click", () => runImport().catch((error) => {
    $("#importMsg").textContent = error.message;
    toast(error.message);
  }));
  $("#csvFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("#csvText").value = "";
    $("#importMsg").textContent = `已选择 ${file.name}（${Math.ceil(file.size / 1024)} KiB）`;
  });
  $("#cleaningTable").addEventListener("click", async (event) => {
    const confirmId = event.target.dataset.confirm;
    const createId = event.target.dataset.create;
    if (confirmId) await confirmMapping(Number(confirmId));
    if (createId) openNewItemDialog(Number(createId));
  });
  $("#cleaningConfidenceSort").addEventListener("change", (event) => {
    state.cleaningConfidenceSort = event.target.value;
    refreshCleaning().catch((error) => toast(error.message));
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
  $("#qualityType").addEventListener("change", renderQualityRefOptions);
  $("#createInspectionBtn").addEventListener("click", createQualityInspection);
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
    if (quoteId) await convertQuotation(quoteId);
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
    await refreshAll();
  }
}

initApp().catch((error) => toast(error.message));
