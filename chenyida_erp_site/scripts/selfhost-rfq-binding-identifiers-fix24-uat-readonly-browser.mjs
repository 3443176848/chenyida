import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX24_RFQ1_BINDING_IDENTIFIERS_READONLY_CANCEL";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const DETAIL_API_PATH = "/api/procurement/rfqs/1";
const RFQ_CODE = "RFQ-00000001";
const PRQ_CODE = "PRQ-00000001";
const PROJECT_CODE = "PRJ-00000001";
const CREATION_REQUEST_ID = "75078325-3b3a-4d1e-b911-99cbd5f802db";
const CREATION_TIME_SHANGHAI = "2026-08-05 15:24:26.684817";
const CONFIRM_REQUEST_ID = "52ed7a96-3a78-46e2-8ed8-2a1b4076a6e7";
const CONFIRM_TIME_SHANGHAI = "2026-08-05 22:50:42.192964";
const SCOPE_DIGEST = "9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d";

const SUPPLIERS = [
  { id: 1, code: "SUP-000001", name: "UAT快速交付供应商A-042576" },
  { id: 2, code: "SUP-000002", name: "UAT低价延期供应商B-042576" },
];
const MATERIALS = [
  { id: 533, lineId: 1, code: "CYD-RB_PCB-000016", name: "UAT-BB-MAT-PCBA-042576 · UAT控制板组件" },
  { id: 534, lineId: 2, code: "CYD-RB_SENSOR-000003", name: "UAT-BB-MAT-SENSOR-042576 · UAT温湿度传感器" },
  { id: 535, lineId: 3, code: "CYD-RB_CONN-000075", name: "UAT-BB-MAT-HARNESS-042576 · UAT 12V测试线束" },
  { id: 536, lineId: 4, code: "CYD-RB_METAL-000015", name: "UAT-BB-MAT-CASE-042576 · UAT测试外壳" },
];
const BINDINGS = [
  { id: "1", supplierId: 1, lineId: 1, materialId: 533, mappingId: "224d1965-44ef-4c3e-901e-1926b6b07ff8", partNumber: "UAT-A-PCBA-042576" },
  { id: "2", supplierId: 1, lineId: 2, materialId: 534, mappingId: "43ca04d8-9933-4dac-ba21-b7fb85741830", partNumber: "UAT-A-SENSOR-042576" },
  { id: "3", supplierId: 1, lineId: 3, materialId: 535, mappingId: "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e", partNumber: "UAT-A-HARNESS-042576" },
  { id: "4", supplierId: 1, lineId: 4, materialId: 536, mappingId: "9659ad2d-406a-4c4c-b575-51329badc63f", partNumber: "UAT-A-CASE-042576" },
  { id: "5", supplierId: 2, lineId: 1, materialId: 533, mappingId: "45a3daf1-4e97-4a01-a94d-1f3089d3961b", partNumber: "UAT-B-PCBA-042576" },
  { id: "6", supplierId: 2, lineId: 2, materialId: 534, mappingId: "5bd2ced5-6696-4e69-a833-e886cf5e273f", partNumber: "UAT-B-SENSOR-042576" },
  { id: "7", supplierId: 2, lineId: 3, materialId: 535, mappingId: "3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6", partNumber: "UAT-B-HARNESS-042576" },
  { id: "8", supplierId: 2, lineId: 4, materialId: 536, mappingId: "5432e7fc-463a-4cea-99fe-f3db8cf0af83", partNumber: "UAT-B-CASE-042576" },
];

if (process.env.ERP_RFQ_BINDING_FIX24_UAT_CONFIRM !== REQUIRED_CONFIRM) {
  throw new Error(`ERP_RFQ_BINDING_FIX24_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);
}
const databaseUrl = process.env.ERP_FIX24_DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX24_DATABASE_URL is required");
const configuredDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
if (configuredDatabase !== REQUIRED_DATABASE || process.env.ERP_FIX24_DATABASE_NAME !== REQUIRED_DATABASE) {
  throw new Error(`FIX-24 database guards must target the exact ${REQUIRED_DATABASE} database`);
}

async function purchaseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1 || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical Purchase UAT credential metadata is invalid");
  }
  const document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  const matches = Array.isArray(document?.accounts)
    ? document.accounts.filter((account) => account?.username === REQUIRED_USERNAME && account?.role === "purchase")
    : [];
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
    || matches[0].must_change_password !== false) {
    throw new Error("the exact active canonical Purchase UAT credential is required");
  }
  return { username: REQUIRED_USERNAME, password: matches[0].password };
}

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      if (loaded.chromium || loaded.default?.chromium) return loaded.chromium || loaded.default.chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the FIX-24 readonly UAT runner");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rfq-binding-fix24-uat-readonly" });
const shanghai = (column) => `to_char(${column} at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US')`;

async function readProtectedState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const schema = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) head_version,
      (select count(*)::int from app_sessions where revoked_at is null and expires_at>now()) active_sessions`)).rows[0];
    const header = (await client.query(`select q.id::int,q.rfq_code,q.purchase_request_id::int,
      request.request_code,q.round_no::int,q.status,q.version::int,q.traceability_version::int,
      q.source_purchase_request_version::int,request.version::int source_current_version,
      request.status source_status,project.project_code,q.response_deadline::text,q.currency_code,
      q.issued_by,q.issued_at,q.closed_at
      from procurement_rfqs q join planning_purchase_requests request on request.id=q.purchase_request_id
      join planning_material_requirement_plans plan on plan.id=request.plan_id
      join business_projects project on project.id=plan.project_id where q.id=1`)).rows[0];
    const lines = (await client.query(`select line.id::int,line.line_no::int,line.material_id::int,
      material.internal_material_code,material.standard_name,line.requested_quantity::numeric(24,6)::text,
      unit.code unit_code from procurement_rfq_lines line join material_master material on material.id=line.material_id
      join units unit on unit.id=line.unit_id where line.rfq_id=1 order by line.line_no,line.id`)).rows;
    const suppliers = (await client.query(`select invitation.id::int rfq_supplier_id,invitation.supplier_id::int,
      supplier.supplier_code,supplier.supplier_name,supplier.status supplier_status,
      invitation.status invitation_status from procurement_rfq_suppliers invitation
      join suppliers supplier on supplier.id=invitation.supplier_id where invitation.rfq_id=1
      order by supplier.supplier_code,invitation.supplier_id`)).rows;
    const bindings = (await client.query(`select binding.id::text binding_id,binding.rfq_id::int,
      binding.rfq_supplier_id::int,binding.rfq_line_id::int,binding.supplier_id::int,
      supplier.supplier_code,supplier.supplier_name,binding.material_id::int,
      material.internal_material_code,material.standard_name,binding.mapping_uid::text mapping_id,
      binding.mapping_version_no::int mapping_version,binding.mapping_row_version::int mapping_row_version,
      binding.supplier_part_number,purchase_unit.code supplier_unit,
      coalesce(base_unit.code,nullif(btrim(material.base_uom),'')) internal_unit,
      binding.conversion_numerator::text conversion_numerator,
      binding.conversion_denominator::text conversion_denominator,
      to_char(binding.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
      case when binding.valid_to is null then null else to_char(binding.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to,
      binding.binding_source,binding.binding_status,binding.bound_by,
      ${shanghai("binding.bound_at")} bound_at_shanghai,binding.request_id::text binding_request_id,
      mapping.status current_mapping_status,mapping.mapping_version_no::int current_mapping_version,
      mapping.version::int current_mapping_row_version,
      (mapping.status is distinct from binding.binding_status) status_drift,
      (mapping.mapping_version_no is distinct from binding.mapping_version_no
        or mapping.version is distinct from binding.mapping_row_version
        or mapping.content_digest is distinct from binding.mapping_content_digest) version_drift
      from procurement_rfq_supplier_line_mapping_bindings binding
      join procurement_rfq_suppliers invitation on invitation.id=binding.rfq_supplier_id and invitation.rfq_id=binding.rfq_id
      join procurement_rfq_lines line on line.id=binding.rfq_line_id and line.rfq_id=binding.rfq_id and line.material_id=binding.material_id
      join suppliers supplier on supplier.id=binding.supplier_id
      join material_master material on material.id=binding.material_id
      join units purchase_unit on purchase_unit.id=binding.purchase_unit_id
      left join units base_unit on base_unit.id=material.base_unit_id
      join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
      where binding.rfq_id=1 order by binding.id`)).rows;
    const events = (await client.query(`select id::int,event_type,actor,${shanghai("created_at")} occurred_at_shanghai,
      request_id::text,result,credential_version::int,old_version::int,new_version::int,from_status,to_status,
      scope_digest,idempotency_key_digest from procurement_sourcing_events where rfq_id=1 order by id`)).rows;
    const creationAudit = (await client.query(`select username,request_id::text,result,old_version::int,new_version::int,
      ${shanghai("created_at")} occurred_at_shanghai from audit_log where route_code='PROCUREMENT_SOURCING'
      and action='RFQ_CREATED' and result='success' and detail->>'object_id'='1' order by id`)).rows;
    const population = (await client.query(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1) bindings,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_MAPPING_CONFIRMED') mapping_confirmed_events,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_ISSUED') issued_events,
      (select count(*)::int from procurement_supplier_quotes) quotes,
      (select count(*)::int from procurement_supplier_quote_lines) quote_lines,
      (select count(*)::int from procurement_quote_comparisons) comparisons,
      (select count(*)::int from procurement_quote_comparison_lines) comparison_lines,
      (select count(*)::int from procurement_sourcing_awards) awards,
      (select count(*)::int from procurement_sourcing_award_lines) award_lines,
      (select count(*)::int from procurement_award_po_line_links) award_po_links,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select count(*)::int from purchase_order_lines) purchase_order_lines,
      (select count(*)::int from purchase_order_source_links) purchase_order_source_links,
      (select count(*)::int from purchase_delivery_plans) delivery_plans,
      (select count(*)::int from warehouse_receiving_queue_entries) receiving_queue_entries,
      (select count(*)::int from purchase_receipts) receipts,
      (select count(*)::int from purchase_receipt_lines) receipt_lines,
      (select count(*)::int from purchase_financial_source_entries) purchase_financial_sources,
      (select count(*)::int from inventory_ledger_entries) inventory_ledger_entries,
      (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
      (select count(*)::int from production_work_orders) work_orders`)).rows[0];
    await client.query("commit");
    return { schema, header, lines, suppliers, bindings, events, creation_audit: creationAudit, population };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function assertProtectedState(state, stage) {
  assert.deepEqual(state.schema, {
    database_name: REQUIRED_DATABASE, transaction_read_only: "on", migration_count: 39,
    head_version: "0039_rfq_traceability.sql", active_sessions: 0,
  }, `${stage} schema/session`);
  assert.deepEqual(state.header, {
    id: 1, rfq_code: RFQ_CODE, purchase_request_id: 1, request_code: PRQ_CODE, round_no: 1,
    status: "DRAFT", version: 2, traceability_version: 1, source_purchase_request_version: 2,
    source_current_version: 2, source_status: "ACCEPTED", project_code: PROJECT_CODE,
    response_deadline: "2026-08-31", currency_code: "CNY", issued_by: null, issued_at: null, closed_at: null,
  }, `${stage} RFQ`);
  assert.deepEqual(state.lines, MATERIALS.map((material, index) => ({
    id: material.lineId, line_no: index + 1, material_id: material.id,
    internal_material_code: material.code, standard_name: material.name,
    requested_quantity: "10.000000", unit_code: "PCS",
  })), `${stage} lines`);
  assert.deepEqual(state.suppliers, SUPPLIERS.map((supplier) => ({
    rfq_supplier_id: supplier.id, supplier_id: supplier.id, supplier_code: supplier.code,
    supplier_name: supplier.name, supplier_status: "ACTIVE", invitation_status: "INVITED",
  })), `${stage} suppliers`);
  assert.equal(state.bindings.length, 8, `${stage} Binding count`);
  assert.equal(new Set(state.bindings.map((binding) => binding.binding_id)).size, 8, `${stage} Binding ID uniqueness`);
  assert.deepEqual(state.bindings.map((binding) => ({
    id: binding.binding_id, supplierId: binding.supplier_id, lineId: binding.rfq_line_id,
    materialId: binding.material_id, mappingId: binding.mapping_id, partNumber: binding.supplier_part_number,
  })), BINDINGS, `${stage} Binding identity and association`);
  for (const binding of state.bindings) {
    assert.deepEqual({
      rfq_id: binding.rfq_id, rfq_supplier_id: binding.rfq_supplier_id,
      supplier_unit: binding.supplier_unit, internal_unit: binding.internal_unit,
      numerator: binding.conversion_numerator, denominator: binding.conversion_denominator,
      valid_from: binding.valid_from, valid_to: binding.valid_to, source: binding.binding_source,
      binding_status: binding.binding_status, bound_by: binding.bound_by,
      bound_at_shanghai: binding.bound_at_shanghai, binding_request_id: binding.binding_request_id,
      mapping_version: binding.mapping_version, mapping_row_version: binding.mapping_row_version,
      current_mapping_status: binding.current_mapping_status,
      current_mapping_version: binding.current_mapping_version,
      current_mapping_row_version: binding.current_mapping_row_version,
      status_drift: binding.status_drift, version_drift: binding.version_drift,
    }, {
      rfq_id: 1, rfq_supplier_id: binding.supplier_id, supplier_unit: "PCS", internal_unit: "PCS",
      numerator: "1", denominator: "1", valid_from: "2026-08-05", valid_to: null,
      source: "LEGACY_DRAFT_CONFIRMATION", binding_status: "ACTIVE", bound_by: REQUIRED_USERNAME,
      bound_at_shanghai: CONFIRM_TIME_SHANGHAI, binding_request_id: CONFIRM_REQUEST_ID,
      mapping_version: 1, mapping_row_version: 3, current_mapping_status: "ACTIVE",
      current_mapping_version: 1, current_mapping_row_version: 3, status_drift: false, version_drift: false,
    }, `${stage} Binding ${binding.binding_id}`);
  }
  assert.equal(state.events.length, 1, `${stage} Event count`);
  assert.deepEqual({
    event_type: state.events[0].event_type, actor: state.events[0].actor,
    occurred_at_shanghai: state.events[0].occurred_at_shanghai, request_id: state.events[0].request_id,
    result: state.events[0].result, credential_version: state.events[0].credential_version,
    old_version: state.events[0].old_version, new_version: state.events[0].new_version,
    from_status: state.events[0].from_status, to_status: state.events[0].to_status,
    scope_digest: state.events[0].scope_digest,
  }, {
    event_type: "RFQ_MAPPING_CONFIRMED", actor: REQUIRED_USERNAME,
    occurred_at_shanghai: CONFIRM_TIME_SHANGHAI, request_id: CONFIRM_REQUEST_ID,
    result: "SUCCESS", credential_version: 2, old_version: 1, new_version: 2,
    from_status: "DRAFT", to_status: "DRAFT", scope_digest: SCOPE_DIGEST,
  }, `${stage} Mapping Event`);
  assert.match(state.events[0].idempotency_key_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(state.creation_audit, [{
    username: REQUIRED_USERNAME, request_id: CREATION_REQUEST_ID, result: "success",
    old_version: null, new_version: 1, occurred_at_shanghai: CREATION_TIME_SHANGHAI,
  }], `${stage} creation Audit`);
  assert.equal(state.population.bindings, 8, `${stage} Binding population`);
  assert.equal(state.population.mapping_confirmed_events, 1, `${stage} Mapping Event population`);
  assert.equal(state.population.issued_events, 0, `${stage} issued population`);
  for (const [name, count] of Object.entries(state.population)) {
    if (!["bindings", "mapping_confirmed_events"].includes(name)) assert.equal(count, 0, `${stage} ${name}`);
  }
}

function includesAll(text, values, stage) {
  for (const value of values) assert.ok(text.includes(String(value)), `${stage} missing ${value}`);
}

async function noOverflow(page, locator, stage) {
  const widths = locator
    ? await locator.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))
    : await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(widths.scroll <= widths.client + 1, `${stage} horizontal overflow: ${JSON.stringify(widths)}`);
}

async function mappingCardFacts(scope) {
  return scope.locator(".rfq-mapping-card").evaluateAll((cards) => cards.map((card) => {
    const facts = new Map([...card.querySelectorAll("dl > div")].map((row) => [
      row.querySelector("dt")?.textContent?.trim() || "",
      row.querySelector("dd")?.textContent?.trim() || "",
    ]));
    const statuses = new Map([...card.querySelectorAll("[data-rfq-status]")].map((row) => [
      row.getAttribute("data-rfq-status") || "",
      row.querySelector("b")?.textContent?.trim() || "",
    ]));
    return {
      text: card.textContent || "",
      binding_id: facts.get("Binding ID") || "",
      supplier_id: facts.get("Supplier ID") || "",
      rfq_line_id: facts.get("RFQ Line ID") || "",
      material_id: facts.get("Material ID") || "",
      mapping_id: facts.get("Mapping ID") || "",
      binding_status: statuses.get("binding") || "",
      mapping_status: statuses.get("mapping") || "",
      invitation_status: statuses.get("invitation") || "",
      status_drift: facts.get("状态漂移（Binding ↔ Mapping）") || "",
      version_drift: facts.get("版本漂移（固定 ↔ 当前）") || "",
    };
  }));
}

let browser;
let context;
let authenticated = false;
const businessWrites = [];
const apiGets = [];
const forbiddenGets = [];
const browserErrors = [];

async function logoutIfNeeded() {
  if (!authenticated || !context) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
      });
    }
  }
  authenticated = false;
}

try {
  const before = await readProtectedState();
  assertProtectedState(before, "before UAT");
  const credential = await purchaseCredential();
  const chromium = await loadChromium();
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && url.pathname.startsWith("/api/")) {
      const target = `${url.pathname}${url.search}`;
      apiGets.push(target);
      if (!["/api/session", DETAIL_API_PATH].includes(target)) {
        forbiddenGets.push(target);
        return route.abort("blockedbyclient");
      }
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) return route.continue();
    businessWrites.push(`${method} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console:${message.text()}`); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === REQUIRED_ORIGIN && response.status() >= 400) browserErrors.push(`http:${response.status()}:${url.pathname}`);
  });

  const login = await context.request.post(`${REQUIRED_ORIGIN}/api/login`, { headers: { Origin: REQUIRED_ORIGIN }, data: credential });
  assert.equal(login.status(), 200);
  const loginPayload = await login.json();
  assert.deepEqual([loginPayload.user?.username, loginPayload.user?.role, loginPayload.user?.is_active,
    loginPayload.user?.must_change_password], [REQUIRED_USERNAME, "purchase", true, false]);
  authenticated = true;
  const sessionResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/session`);
  const session = await sessionResponse.json();
  assert.ok(session.authenticated && session.user.permissions.includes("procurement.rfq.manage") && session.csrf_token);

  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: `${RFQ_CODE} · Round 1`, exact: true }).waitFor();
  const creation = page.getByRole("region", { name: "RFQ 创建成功审计", exact: true });
  await creation.waitFor();
  includesAll(await creation.innerText(), [
    "RFQ 创建成功审计", REQUIRED_USERNAME, `${CREATION_TIME_SHANGHAI}（Asia/Shanghai）`,
    "不存在 → v1", "SUCCESS", CREATION_REQUEST_ID,
  ], "creation Audit");

  const receipt = page.locator("details.rfq-receipt").filter({ hasText: "RFQ_MAPPING_CONFIRMED" }).first();
  await receipt.waitFor();
  includesAll(await receipt.innerText(), [
    "Mapping 固定凭证", "RFQ_MAPPING_CONFIRMED", REQUIRED_USERNAME,
    `${CONFIRM_TIME_SHANGHAI}（Asia/Shanghai）`, CONFIRM_REQUEST_ID, "SUCCESS", "v1 → v2",
    "固定 Binding 数量", "8", SCOPE_DIGEST, "Binding 稳定 ID（按 ID 升序）",
    BINDINGS.map((binding) => binding.id).join(" · "), "身份关联口径", "不按任何摘要输入序列位置配对",
    ...BINDINGS.map((binding) => binding.id), "不可变快照说明",
  ], "standalone Mapping receipt");
  assert.equal(await receipt.getAttribute("open"), "");
  await receipt.locator("summary").click();
  assert.equal(await receipt.getAttribute("open"), null, "Mapping receipt must close without a request");
  await receipt.locator("summary").click();
  assert.equal(await receipt.getAttribute("open"), "", "Mapping receipt must reopen without a request");

  const trace = page.locator(".rfq-mapping-trace");
  const cards = await mappingCardFacts(trace);
  assert.deepEqual(cards.map((card) => card.binding_id), BINDINGS.map((binding) => binding.id), "stable Binding ID UI order");
  for (const [index, binding] of BINDINGS.entries()) {
    const supplier = SUPPLIERS.find((row) => row.id === binding.supplierId);
    const material = MATERIALS.find((row) => row.id === binding.materialId);
    includesAll(cards[index].text, [
      `Binding ID${binding.id}`, "RFQ ID1", `RFQ Line ID${binding.lineId}`,
      `Supplier ID${binding.supplierId}`, supplier.code, supplier.name,
      `Material ID ${binding.materialId}`, material.code, material.name,
      "Mapping ID", binding.mappingId, "Mapping Version", "v1", binding.partNumber,
      "Supplier Unit", "PCS", "Internal Unit", "换算", "1:1", "有效期", "2026-08-05", "长期",
      "Binding状态", "ACTIVE", "Mapping状态", "邀请状态", "INVITED", "Binding固定来源",
      "状态漂移（Binding ↔ Mapping）", "否", "版本漂移（固定 ↔ 当前）", "固定范围摘要", SCOPE_DIGEST,
    ], `Binding card ${binding.id}`);
    assert.deepEqual({
      binding_id: cards[index].binding_id,
      supplier_id: cards[index].supplier_id,
      rfq_line_id: cards[index].rfq_line_id,
      material_id: cards[index].material_id,
      mapping_id: cards[index].mapping_id,
      binding_status: cards[index].binding_status,
      mapping_status: cards[index].mapping_status,
      invitation_status: cards[index].invitation_status,
      status_drift: cards[index].status_drift,
      version_drift: cards[index].version_drift,
    }, {
      binding_id: binding.id,
      supplier_id: String(binding.supplierId),
      rfq_line_id: String(binding.lineId),
      material_id: String(binding.materialId),
      mapping_id: binding.mappingId,
      binding_status: "ACTIVE",
      mapping_status: "ACTIVE",
      invitation_status: "INVITED",
      status_drift: "否",
      version_drift: "否",
    }, `Binding card ${binding.id} authoritative association`);
  }
  await noOverflow(page, null, "desktop detail");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: `${RFQ_CODE} · Round 1`, exact: true }).waitFor();
  assert.deepEqual((await mappingCardFacts(page.locator(".rfq-mapping-trace"))).map((card) => card.binding_id),
    BINDINGS.map((binding) => binding.id), "Binding IDs must persist after refresh");

  const issue = page.getByRole("button", { name: "发出询价并冻结范围", exact: true });
  assert.equal(await issue.isEnabled(), true);
  await issue.click();
  let dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "取消");
  assert.equal(await dialog.getByRole("button", { name: "确认发出", exact: true }).isEnabled(), true);
  const desktopDialogText = await dialog.innerText();
  includesAll(desktopDialogText, [
    "ID 1 · RFQ-00000001", "Round 1 / v2", "DRAFT / 草稿 / 待发出",
    "RFQ 创建成功审计", CREATION_REQUEST_ID, "Mapping 固定凭证", "RFQ_MAPPING_CONFIRMED",
    REQUIRED_USERNAME, `${CONFIRM_TIME_SHANGHAI}（Asia/Shanghai）`, CONFIRM_REQUEST_ID,
    "SUCCESS", "v1 → v2", SCOPE_DIGEST, "固定 Binding 数量", "Binding 稳定 ID（按 ID 升序）",
    BINDINGS.map((binding) => binding.id).join(" · "), "身份关联口径", "不按任何摘要输入序列位置配对",
    "固定范围 · 4 条 Material", "受邀 Supplier · 2 家", "2026-08-31", "CNY",
    "当前状态漂移", "无", "当前版本漂移", "发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结",
    "只有发出成功后才允许录入 Supplier 报价", "本次发出不会自动创建或修改以下下游记录",
    "Quote（供应商报价）", "Award（定标）", "PO（采购订单）", "Delivery Plan（交付计划）",
    "Receipt／收货", "Inventory Ledger／库存流水", "AP／采购应付", "Work Order／生产工单",
    "其他生产记录", "财务记录",
    ...BINDINGS.flatMap((binding) => [binding.id, binding.mappingId]),
  ], "desktop issue confirmation");
  assert.deepEqual((await mappingCardFacts(dialog)).map((card) => card.binding_id), BINDINGS.map((binding) => binding.id));
  await noOverflow(page, dialog, "desktop issue confirmation");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, [], "desktop cancel must issue zero business writes");

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, null, "390x844 detail");
  await issue.click();
  dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("button", { name: "确认发出", exact: true }).isEnabled(), true);
  assert.deepEqual((await mappingCardFacts(dialog)).map((card) => card.binding_id), BINDINGS.map((binding) => binding.id));
  await noOverflow(page, null, "390x844 issue page");
  await noOverflow(page, dialog, "390x844 issue dialog");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, [], "390x844 cancel must issue zero business writes");

  const logout = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  assert.equal(logout.status(), 200);
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of [RFQ_CODE, PRQ_CODE, CONFIRM_REQUEST_ID, SCOPE_DIGEST,
    ...BINDINGS.map((binding) => binding.mappingId)]) {
    assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);
  }

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "readonly UAT must preserve RFQ, Bindings, Events and all downstream state");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  assert.ok(apiGets.filter((target) => target === DETAIL_API_PATH).length >= 2);
  console.info(`RFQ_BINDING_IDENTIFIERS_FIX24_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 round=1 version=2 binding_ids=${BINDINGS.map((binding) => binding.id).join(",")} mapping_event=1 receipt=SUCCESS scope=${SCOPE_DIGEST} issue_cancel=2 business_post=0 status=DRAFT issued=0 quote=0 award=0 po=0 desktop=1 mobile=1 session=0`);
} finally {
  try { await logoutIfNeeded(); } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      const finalState = await readProtectedState();
      assert.equal(finalState.schema.active_sessions, 0, "cleanup must leave zero active sessions");
    } finally { await pool.end(); }
  }
}
