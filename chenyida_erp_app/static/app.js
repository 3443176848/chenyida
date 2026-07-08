const state = {
  summary: {},
  items: [],
  mappings: [],
  cleaning: [],
  products: [],
  boms: [],
  bomLines: [],
  readiness: [],
  purchaseOrders: [],
  purchaseLines: [],
  purchaseSuggestions: [],
  inventory: [],
  workOrders: [],
  workMaterials: [],
  productionReports: [],
  salesOrders: [],
  shipments: [],
  qualityInspections: [],
  qualityDefects: [],
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
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function setTab(name) {
  $$(".nav").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.id === name));
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

function renderSummary() {
  const cards = [
    ["内部物料", state.summary.total_items],
    ["供应商映射", state.summary.total_mappings],
    ["产品工程", state.summary.total_products],
    ["BOM", state.summary.total_boms],
    ["采购单", state.summary.total_pos],
    ["未完成采购", state.summary.open_pos],
    ["生产工单", state.summary.total_work_orders],
    ["进行中工单", state.summary.active_work_orders],
    ["销售订单", state.summary.total_sales_orders],
    ["待交付订单", state.summary.open_sales_orders],
    ["品质检验", state.summary.total_quality_inspections],
    ["质量异常", state.summary.open_quality_issues],
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

function renderBomSelectors() {
  const productOptions = optionList(state.products, "product_code", ["product_code", "product_name"]);
  const bomOptions = optionList(state.boms, "id", ["bom_code", "product_name"]);
  const itemOptions = optionList(state.items, "internal_item_code", ["internal_item_code", "standard_name"]);
  $("#bomProduct").innerHTML = productOptions;
  $("#lineBom").innerHTML = bomOptions;
  $("#readyBom").innerHTML = bomOptions;
  $("#purchaseBom").innerHTML = bomOptions;
  $("#productionBom").innerHTML = bomOptions;
  $("#salesProduct").innerHTML = productOptions;
  $("#lineItem").innerHTML = itemOptions;
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

async function refreshAll() {
  const [summary, items, mappings, cleaning, products, boms, purchaseOrders, purchaseLines, inventory, workOrders, workMaterials, productionReports, salesOrders, shipments, qualityInspections, qualityDefects] = await Promise.all([
    api("/api/summary"),
    api("/api/items"),
    api("/api/mappings"),
    api("/api/cleaning"),
    api("/api/products"),
    api("/api/boms"),
    api("/api/purchase-orders"),
    api("/api/purchase-order-lines"),
    api("/api/inventory"),
    api("/api/work-orders"),
    api("/api/work-order-materials"),
    api("/api/production-reports"),
    api("/api/sales-orders"),
    api("/api/shipments"),
    api("/api/quality-inspections"),
    api("/api/quality-defects"),
  ]);
  state.summary = summary;
  state.items = items.rows;
  state.mappings = mappings.rows;
  state.cleaning = cleaning.rows;
  state.products = products.rows;
  state.boms = boms.rows;
  state.purchaseOrders = purchaseOrders.rows;
  state.purchaseLines = purchaseLines.rows;
  state.inventory = inventory.rows;
  state.workOrders = workOrders.rows;
  state.workMaterials = workMaterials.rows;
  state.productionReports = productionReports.rows;
  state.salesOrders = salesOrders.rows;
  state.shipments = shipments.rows;
  state.qualityInspections = qualityInspections.rows;
  state.qualityDefects = qualityDefects.rows;
  renderSummary();
  renderItems();
  renderMappings();
  renderCleaning();
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
  renderSalesOrders();
  renderShipments();
  renderQualityRefOptions();
  renderQualityInspections();
  renderQualityDefects();
  if (!state.bomLines.length && state.boms.length) {
    await loadBomLines(state.boms[0].id);
  } else {
    renderBomLines();
  }
}

async function loadSample() {
  const sample = await api("/api/sample-import");
  $("#csvText").value = sample.csv;
  toast("已载入示例供应商物料");
}

async function runImport() {
  const csvText = $("#csvText").value.trim();
  if (!csvText) {
    toast("请先粘贴或选择 CSV");
    return;
  }
  const batchNo = $("#batchNo").value.trim();
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
  $("#salesMsg").textContent = `已创建 ${result.sales_order_code}`;
  await refreshAll();
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
  $$(".nav").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#loadSampleBtn").addEventListener("click", loadSample);
  $("#runImportBtn").addEventListener("click", runImport);
  $("#csvFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("#csvText").value = await file.text();
  });
  $("#cleaningTable").addEventListener("click", async (event) => {
    const confirmId = event.target.dataset.confirm;
    const createId = event.target.dataset.create;
    if (confirmId) await confirmMapping(Number(confirmId));
    if (createId) openNewItemDialog(Number(createId));
  });
  $("#createItemBtn").addEventListener("click", createItem);
  $("#createProductBtn").addEventListener("click", createProduct);
  $("#createBomBtn").addEventListener("click", createBom);
  $("#addBomLineBtn").addEventListener("click", addBomLine);
  $("#checkReadyBtn").addEventListener("click", checkReadiness);
  $("#loadPurchaseSuggestionsBtn").addEventListener("click", loadPurchaseSuggestions);
  $("#createPoFromShortageBtn").addEventListener("click", createPoFromShortage);
  $("#receivePurchaseBtn").addEventListener("click", receivePurchase);
  $("#createWorkOrderBtn").addEventListener("click", createWorkOrder);
  $("#completeWorkOrderBtn").addEventListener("click", completeWorkOrder);
  $("#createSalesOrderBtn").addEventListener("click", createSalesOrder);
  $("#shipSalesOrderBtn").addEventListener("click", shipSalesOrder);
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
  $("#salesOrdersTable").addEventListener("click", (event) => {
    const salesOrderId = event.target.dataset.selectSalesOrder;
    if (salesOrderId) {
      $("#shipSalesOrder").value = salesOrderId;
      setTab("sales");
    }
  });
}

bindEvents();
refreshAll().catch((error) => toast(error.message));
