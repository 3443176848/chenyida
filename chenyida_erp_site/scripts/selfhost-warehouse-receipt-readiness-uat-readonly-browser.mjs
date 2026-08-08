import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const ORIGIN = "https://43.135.148.43.nip.io:18888";
const DATABASE = "chenyida_erp";
const DATABASE_HOST = "postgres";
const USERNAME = "uat_20260729_warehouse";
const CONFIRMATION = "MAIN_UAT_WAREHOUSE_RECEIPT_READINESS_CANCEL_ONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const WORKSPACE_PATH = "/warehouse/receiving";
const QUEUE_PATH = "/api/procurement/fulfillment/receiving-queue";
const PREVIEW_PREFIX = "/api/procurement/delivery-plans/";
const MATERIALS = [
  ["1", "533", "CYD-RB_PCB-000016"],
  ["2", "534", "CYD-RB_SENSOR-000003"],
  ["3", "535", "CYD-RB_CONN-000075"],
  ["4", "536", "CYD-RB_METAL-000015"],
];

if (process.env.ERP_WAREHOUSE_RECEIPT_UAT_CONFIRM !== CONFIRMATION) {
  throw new Error(`ERP_WAREHOUSE_RECEIPT_UAT_CONFIRM=${CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_WAREHOUSE_RECEIPT_DATABASE_URL || "";
const parsed = databaseUrl ? new URL(databaseUrl) : null;
if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)
  || parsed.hostname !== DATABASE_HOST || Number(parsed.port || "5432") !== 5432
  || decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== DATABASE) {
  throw new Error(`warehouse receipt UAT must target ${DATABASE_HOST}/${DATABASE}`);
}

async function warehouseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical warehouse UAT credential metadata is invalid");
  }
  const document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  const matches = Array.isArray(document?.accounts)
    ? document.accounts.filter((account) => account?.username === USERNAME && account?.role === "warehouse") : [];
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
    || matches[0].must_change_password !== false) {
    throw new Error("the exact active canonical warehouse UAT credential is required; password rotation is forbidden");
  }
  return { username: USERNAME, password: matches[0].password };
}

async function chromiumProvider() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      if (loaded.chromium || loaded.default?.chromium) return loaded.chromium || loaded.default.chromium;
    } catch { /* try the next controlled provider */ }
  }
  throw new Error("Playwright is required for warehouse receipt readonly UAT");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "warehouse-receipt-readiness-uat-readonly" });

async function databaseState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const connection = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) head_version,
      (select count(*)::int from app_sessions where username=$1 and revoked_at is null and expires_at>now()) active_sessions,
      (select jsonb_build_object('role',role,'is_active',is_active,'must_change_password',must_change_password)
        from app_users where username=$1) account`, [USERNAME])).rows[0];
    const po = (await client.query(`select po.id::text id,po.po_code,po.version::int,po.status,
      po.supplier_id::text supplier_id,supplier.supplier_code,po.currency_code,
      sum(line.order_qty)::text ordered_quantity,sum(line.received_qty)::text received_quantity,
      sum(line.order_qty*line.unit_price)::numeric(48,6)::text total_amount
      from purchase_orders po join suppliers supplier on supplier.id=po.supplier_id
      join purchase_order_lines line on line.purchase_order_id=po.id where po.id=1
      group by po.id,supplier.id`)).rows[0];
    const lines = (await client.query(`select line.id::text line_id,line.version::int,line.status,
      link.award_line_id::text award_line_id,line.material_id::text material_id,
      material.internal_material_code,line.order_qty::text quantity,line.received_qty::text received
      from purchase_order_lines line join procurement_award_po_line_links link on link.purchase_order_line_id=line.id
      join material_master material on material.id=line.material_id
      where line.purchase_order_id=1 order by line.id`)).rows;
    const plans = (await client.query(`select plan.id::text plan_id,plan.purchase_order_line_id::text line_id,
      plan.version::int,plan.status,plan.planned_quantity::text quantity,
      plan.received_quantity::text received,plan.promised_delivery_date::text planned_date,
      queue.id::text queue_id,queue.version::int queue_version,queue.closed_at
      from purchase_delivery_plans plan join warehouse_receiving_queue_entries queue on queue.delivery_plan_id=plan.id
      where plan.purchase_order_id=1 order by plan.id`)).rows;
    const counts = (await client.query(`select
      (select count(*)::int from purchase_orders) purchase_orders,
      (select count(*)::int from purchase_order_lines) purchase_order_lines,
      (select count(*)::int from purchase_delivery_plans) delivery_plans,
      (select count(*)::int from warehouse_receiving_queue_entries) receiving_queues,
      (select count(*)::int from purchase_receipts) receipts,
      (select count(*)::int from purchase_receipt_lines) warehouse_receipts,
      (select count(*)::int from warehouse_receipt_evidence) receipt_evidence,
      (select count(*)::int from inventory_lots) lots,
      (select count(*)::int from quality_inspections where inspection_type='IQC') iqc,
      (select count(*)::int from inventory_ledger_entries) ledger,
      (select count(*)::int from purchase_financial_source_entries) purchase_financial_sources,
      (select count(*)::int from finance_documents where doc_type='AP') ap,
      (select count(*)::int from finance_settlements) payments,
      (select count(*)::int from production_work_orders) work_orders,
      (select count(*)::int from production_material_issues) production_issues,
      (select count(*)::int from production_material_returns) production_returns,
      (select count(*)::int from production_reports) production_reports,
      (select count(*)::int from production_completions) production_completions`)).rows[0];
    await client.query("commit");
    const business = { po, lines, plans, counts };
    return { connection, business, fingerprint: digest(business) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function assertDatabaseState(state, sessions) {
  assert.deepEqual(state.connection, {
    database_name: DATABASE, transaction_read_only: "on", migration_count: 40,
    head_version: "0040_warehouse_receipt_readiness.sql", active_sessions: sessions,
    account: { role: "warehouse", is_active: true, must_change_password: false },
  });
  assert.deepEqual(state.business.po, {
    id: "1", po_code: "PO-00000001", version: 1, status: "OPEN", supplier_id: "1",
    supplier_code: "SUP-000001", currency_code: "CNY", ordered_quantity: "40.000000",
    received_quantity: "0.000000", total_amount: "480.000000",
  });
  assert.deepEqual(state.business.lines.map((line) => [line.line_id, line.award_line_id, line.material_id,
    line.internal_material_code, line.version, line.status, line.quantity, line.received]),
  MATERIALS.map(([id, materialId, code]) => [id, id, materialId, code, 1, "OPEN", "10.000000", "0.000000"]));
  assert.deepEqual(state.business.plans.map((plan) => [plan.plan_id, plan.line_id, plan.version, plan.status,
    plan.quantity, plan.received, plan.planned_date, plan.queue_id, plan.queue_version, plan.closed_at]),
  [1, 2, 3, 4].map((id) => [String(id), String(id), 1, "PENDING", "10.000000", "0.000000", "2026-10-20", String(id), 1, null]));
  assert.deepEqual(state.business.counts, {
    purchase_orders: 1, purchase_order_lines: 4, delivery_plans: 4, receiving_queues: 4,
    receipts: 0, warehouse_receipts: 0, receipt_evidence: 0, lots: 0, iqc: 0, ledger: 0,
    purchase_financial_sources: 0, ap: 0, payments: 0, work_orders: 0, production_issues: 0,
    production_returns: 0, production_reports: 0, production_completions: 0,
  });
}

function assertReadiness(readiness, planId) {
  assert.equal(readiness.contract_version, "WAREHOUSE_RECEIPT_READINESS_V1");
  assert.equal(readiness.read_only, true);assert.equal(readiness.data_timezone, "Asia/Shanghai");
  assert.deepEqual({ id: readiness.purchase_order.id, code: readiness.purchase_order.po_code,
    version: readiness.purchase_order.version, status: readiness.purchase_order.status,
    supplier: readiness.purchase_order.supplier.id, supplierCode: readiness.purchase_order.supplier.code,
    currency: readiness.purchase_order.currency_code, quantity: readiness.purchase_order.ordered_quantity,
    received: readiness.purchase_order.received_quantity, total: readiness.purchase_order.total_amount }, {
    id: "1", code: "PO-00000001", version: 1, status: "OPEN", supplier: "1",
    supplierCode: "SUP-000001", currency: "CNY", quantity: "40.000000",
    received: "0.000000", total: "480.000000",
  });
  assert.deepEqual(Object.keys(readiness.creation_evidence).sort(), ["action", "actor", "created_at_shanghai", "operation_id", "request_id", "result"]);
  assert.equal(readiness.creation_evidence.action, "SOURCING_AWARD_CONVERTED");assert.equal(readiness.creation_evidence.result, "SUCCESS");
  assert.equal(readiness.lines.length, 4);
  assert.deepEqual(readiness.lines.map((line) => [line.purchase_order_line_id, line.award_line_id, line.material_id,
    line.material_code, line.quantity, line.received_quantity, line.remaining_quantity,
    line.delivery_plan.id, line.delivery_plan.version, line.delivery_plan.status,
    line.delivery_plan.promised_delivery_date, line.queue.id, line.queue.version, line.queue.status]),
  MATERIALS.map(([id, materialId, code]) => [id, id, materialId, code, "10.000000", "0.000000", "10.000000",
    id, 1, "PENDING", "2026-10-20", id, 1, "OPEN_PENDING"]));
  assert.equal(readiness.selected_receipt.delivery_plan_id, String(planId));
  assert.equal(readiness.selected_receipt.quantity, null);assert.equal(readiness.selected_receipt.is_early_arrival, true);
  assert.equal(readiness.selected_receipt.initial_confirmation_blocked, true);
  assert.equal(readiness.selected_receipt.target.location_code, "MAIN");
  assert.equal(readiness.selected_receipt.supplier_lot.applicability, "NOT_APPLICABLE");
  assert.match(readiness.receipt_accounting_boundary.iqc_material_internal_lot, /不创建内部RML Lot/);
  assert.match(readiness.receipt_accounting_boundary.iqc_material_inventory, /不创建IQC冻结/);
  assert.match(readiness.receipt_accounting_boundary.available_inventory_rule, /不等待IQC放行/);
  assert.match(readiness.receipt_accounting_boundary.next_responsibility, /不创建供应商来料IQC责任队列/);
  for (const key of ["receipt", "warehouse_receipt", "inventory_ledger", "lot", "iqc", "purchase_financial_source",
    "ap", "payment", "work_order", "production_report", "production_completion"]) assert.equal(readiness.downstream[key], 0, key);
  assert.equal(readiness.downstream.all_zero, true);
  assert.equal(readiness.receipt_accounting_boundary.supplier_notification_or_in_transit_model_available, false);
  assert.match(readiness.receipt_accounting_boundary.next_responsibility, /quality/);
  const forbidden = new Set(["request_body", "response_body", "cookie", "session", "headers", "sensitive_header", "idempotency_key_digest"]);
  const visit = (value) => { if (!value || typeof value !== "object") return;for (const [key, item] of Object.entries(value)) { assert.equal(forbidden.has(key.toLowerCase()), false, `forbidden DTO key ${key}`);visit(item); } };
  visit(readiness);
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1, `${stage} document overflow ${JSON.stringify(widths)}`);
  assert.ok(widths.body <= widths.viewport + 1, `${stage} body overflow ${JSON.stringify(widths)}`);
}

let browser;
let context;
let authenticated = false;
const businessWrites = [];
const directBusinessWrites = [];
const unexpectedApiGets = [];
const browserErrors = [];
const previewGets = [];

async function directPost(path, options) {
  if (!["/api/login", "/api/logout"].includes(path)) {
    directBusinessWrites.push(`POST ${path}`);throw new Error(`blocked direct business POST ${path}`);
  }
  return context.request.post(`${ORIGIN}${path}`, options);
}

async function cleanupSession() {
  if (!authenticated || !context) return;
  const response = await context.request.get(`${ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      await directPost("/api/logout", { headers: { Origin: ORIGIN, "X-CSRF-Token": session.csrf_token } });
    }
  }
  authenticated = false;
}

try {
  const before = await databaseState();assertDatabaseState(before, 0);
  const credential = await warehouseCredential();
  const chromium = await chromiumProvider();
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method().toUpperCase();
    if (url.origin !== ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && url.pathname.startsWith("/api/")) {
      const known = url.pathname === "/api/session" || url.pathname === QUEUE_PATH
        || (url.pathname.startsWith(PREVIEW_PREFIX) && url.pathname.endsWith("/receipt-preview"));
      if (!known) unexpectedApiGets.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/receipt-preview")) previewGets.push(`${url.pathname}${url.search}`);
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) return route.continue();
    businessWrites.push(`${method} ${url.pathname}`);return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console:${message.text()}`); });
  page.on("response", (response) => { const url = new URL(response.url());if (url.origin === ORIGIN && response.status() >= 400) browserErrors.push(`http:${response.status()}:${url.pathname}`); });

  const login = await directPost("/api/login", { headers: { Origin: ORIGIN }, data: credential });
  assert.equal(login.status(), 200);authenticated = true;
  const session = await (await context.request.get(`${ORIGIN}/api/session`)).json();
  assert.ok(session.authenticated && session.csrf_token && session.user.username === USERNAME && session.user.role === "warehouse");
  assert.equal(session.user.must_change_password, false);assert.equal(session.user.permissions.includes("system.audit.read"), false);
  assert.equal(session.user.permissions.includes("quality.inspect"), false);

  const directPreview = await context.request.get(`${ORIGIN}/api/procurement/delivery-plans/1/receipt-preview`);
  assert.equal(directPreview.status(), 200);assertReadiness((await directPreview.json()).data, 1);
  const crossDomain = await context.request.get(`${ORIGIN}/api/procurement/purchase-orders/1/history`);
  assert.equal(crossDomain.status(), 403);assert.equal((await crossDomain.json()).code, "PERMISSION_DENIED");

  await page.goto(`${ORIGIN}${WORKSPACE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "仓库收货准备与证据核对", exact: true }).waitFor();
  const bodyText = await page.locator("body").innerText();
  for (const required of ["实际物理收货", "供应商通知或在途登记当前未建模", "PO OPEN不代表已到货",
    "Plan PENDING不代表已收货", "queue OPEN_PENDING不代表库存增加", "warehouse只登记实际物理收货",
    "IQC检验、处置与关闭由quality负责", "收货不会自动创建AP、付款、Work Order或其他生产记录",
    "PO #1 · PO-00000001 · v1", "Plan #1/v1 · queue #1/v1", "计划 10.000000 · 已收 0.000000 · 未收 10.000000 PCS",
    "承诺 2026-10-20"]) assert.ok(bodyText.includes(required), `workspace missing ${required}`);
  assert.equal(await page.locator(".warehouse-receipt-card").count(), 4);
  for (const input of ["quantity", "evidence_reference", "evidence_document_date", "supplier_lot_code", "early_arrival_reason", "reason"]) {
    const control = page.locator(`[name="${input}"]`).first();assert.equal(await control.inputValue(), "", `${input} must start blank`);
  }
  assert.equal(await page.locator('[name="early_arrival_confirmed"]').first().isChecked(), false);
  assert.equal(await page.locator('[name="physical_receipt_confirmed"]').first().isChecked(), false);
  await noOverflow(page, "desktop workspace");

  async function openAndCancel(stage, mode) {
    const previewResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/procurement/delivery-plans/1/receipt-preview"
      && response.request().method() === "GET");
    await page.locator(".warehouse-receipt-card").first().getByRole("button", { name: "核对收货", exact: true }).click();
    assert.equal((await previewResponse).status(), 200);
    await page.getByRole("heading", { name: "核对 PO-00000001 收货准备", exact: true }).waitFor();
    await page.waitForTimeout(50);
    assert.equal((await page.evaluate(() => document.activeElement?.textContent?.trim())), "取消", `${stage} default focus`);
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole("button", { name: "确认过账收货", exact: true }).isDisabled(), true);
    assert.equal(await dialog.locator(".warehouse-lineage-list article").count(), 4);
    const text = await dialog.innerText();
    for (const required of ["PO聚合与创建证据", "#1 · PO-00000001 · v1", "480.000000 CNY", "SOURCING_AWARD_CONVERTED · SUCCESS",
      "四层稳定谱系", "服务端当前时间", "承诺/计划日期", "2026-10-20", "实际收货时间规则", "提前到货", "是",
      "送货凭证", "Supplier批次", "目标仓库", "目标库位", "MAIN", "经办账号", USERNAME, "收货说明",
      "Receipt", "Warehouse Receipt Line", "Inventory Ledger", "RML Lot", "IQC", "AP", "Payment", "Work Order",
      "IQC、库存与职责边界", "不创建内部RML Lot", "不创建IQC冻结", "不等待IQC放行", "不创建供应商来料IQC责任队列",
      "不合格、退货与让步接收均为独立受控操作", "当前确认资料不完整或权威状态不可过账"]) {
      assert.ok(text.includes(required), `${stage} preview missing ${required}`);
    }
    for (const [label] of [["Receipt"], ["Warehouse Receipt Line"], ["Inventory Ledger"], ["RML Lot"], ["IQC"], ["AP"], ["Payment"], ["Work Order"]]) {
      const count = dialog.locator(".warehouse-count-grid span").filter({ hasText: label }).first();assert.match(await count.innerText(), /0$/m, `${stage} ${label}`);
    }
    await noOverflow(page, `${stage} preview`);
    if (mode === "cancel") await dialog.getByRole("button", { name: "取消", exact: true }).click();
    else if (mode === "close") await dialog.getByRole("button", { name: "关闭收货确认窗口" }).click();
    else if (mode === "escape") await page.keyboard.press("Escape");
    else if (mode === "backdrop") await page.locator(".rfq-dialog-backdrop").click({ position: { x: 3, y: 3 } });
    else throw new Error(`unknown cancel mode ${mode}`);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(businessWrites, []);assert.deepEqual(directBusinessWrites, []);
  }

  await openAndCancel("desktop cancel", "cancel");
  await openAndCancel("desktop close", "close");
  await openAndCancel("desktop escape", "escape");
  await openAndCancel("desktop backdrop", "backdrop");
  await page.setViewportSize({ width: 390, height: 844 });await noOverflow(page, "390x844 workspace");
  await openAndCancel("390x844 cancel", "cancel");
  assert.ok(previewGets.length >= 5);assert.deepEqual(businessWrites, []);assert.deepEqual(directBusinessWrites, []);

  const during = await databaseState();assertDatabaseState(during, 1);assert.equal(during.fingerprint, before.fingerprint);
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  authenticated = false;
  await page.waitForURL(`${ORIGIN}/`);assert.equal((await (await context.request.get(`${ORIGIN}/api/session`)).json()).authenticated, false);
  await page.goto(`${ORIGIN}${WORKSPACE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByText("请先登录。", { exact: true }).waitFor();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.goForward({ waitUntil: "domcontentloaded" });await page.getByText("请先登录。", { exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });await page.getByText("请先登录。", { exact: true }).waitFor();
  const anonymous = await page.locator("body").innerText();
  for (const protectedValue of ["PO-00000001", "SUP-000001", "CYD-RB_PCB-000016", "SOURCING_AWARD_CONVERTED"]) {
    assert.equal(anonymous.includes(protectedValue), false, protectedValue);
  }
  const after = await databaseState();assertDatabaseState(after, 0);
  assert.equal(after.fingerprint, before.fingerprint);assert.deepEqual(after.business, before.business);
  assert.deepEqual(businessWrites, []);assert.deepEqual(directBusinessWrites, []);
  assert.deepEqual(unexpectedApiGets, []);assert.deepEqual(browserErrors, []);
  console.info(`WAREHOUSE_RECEIPT_READINESS_UAT_READONLY_OK database=${DATABASE} actor=${USERNAME} po=1 code=PO-00000001 status=OPEN amount=480.00_CNY line=4 plan=4 queue=4 receipt=0 lot=0 iqc=0 ledger=0 ap=0 payment=0 work_order=0 production=0 business_post=0 before_fingerprint=${before.fingerprint} after_fingerprint=${after.fingerprint} desktop_cancel=4 mobile_cancel=1 back_forward_refresh=1 session=0`);
} finally {
  try { await cleanupSession(); } finally {
    await context?.close().catch(() => undefined);await browser?.close().catch(() => undefined);
    try { const finalState = await databaseState();assert.equal(finalState.connection.active_sessions, 0); }
    finally { await pool.end(); }
  }
}
