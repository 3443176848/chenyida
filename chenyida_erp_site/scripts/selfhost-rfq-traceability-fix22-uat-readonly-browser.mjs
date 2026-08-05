import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX22_RFQ1_TRACEABILITY_READONLY_CANCEL";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const RFQ_CODE = "RFQ-00000001";
const PRQ_CODE = "PRQ-00000001";
const PROJECT_CODE = "PRJ-00000001";
const CREATION_REQUEST_ID = "75078325-3b3a-4d1e-b911-99cbd5f802db";
const CREATION_TIME_SHANGHAI = "2026-08-05 15:24:26.684817";

const SUPPLIERS = [
  { id: 1, code: "SUP-000001", name: "UAT快速交付供应商A-042576" },
  { id: 2, code: "SUP-000002", name: "UAT低价延期供应商B-042576" },
];

const MATERIALS = [
  { id: 533, code: "CYD-RB_PCB-000016" },
  { id: 534, code: "CYD-RB_SENSOR-000003" },
  { id: 535, code: "CYD-RB_CONN-000075" },
  { id: 536, code: "CYD-RB_METAL-000015" },
];

const MAPPINGS = [
  { supplierId: 1, materialId: 533, mappingId: "224d1965-44ef-4c3e-901e-1926b6b07ff8", partNumber: "UAT-A-PCBA-042576" },
  { supplierId: 1, materialId: 534, mappingId: "43ca04d8-9933-4dac-ba21-b7fb85741830", partNumber: "UAT-A-SENSOR-042576" },
  { supplierId: 1, materialId: 535, mappingId: "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e", partNumber: "UAT-A-HARNESS-042576" },
  { supplierId: 1, materialId: 536, mappingId: "9659ad2d-406a-4c4c-b575-51329badc63f", partNumber: "UAT-A-CASE-042576" },
  { supplierId: 2, materialId: 533, mappingId: "45a3daf1-4e97-4a01-a94d-1f3089d3961b", partNumber: "UAT-B-PCBA-042576" },
  { supplierId: 2, materialId: 534, mappingId: "5bd2ced5-6696-4e69-a833-e886cf5e273f", partNumber: "UAT-B-SENSOR-042576" },
  { supplierId: 2, materialId: 535, mappingId: "3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6", partNumber: "UAT-B-HARNESS-042576" },
  { supplierId: 2, materialId: 536, mappingId: "5432e7fc-463a-4cea-99fe-f3db8cf0af83", partNumber: "UAT-B-CASE-042576" },
];

if (process.env.ERP_RFQ_TRACEABILITY_FIX22_UAT_CONFIRM !== REQUIRED_CONFIRM) {
  throw new Error(`ERP_RFQ_TRACEABILITY_FIX22_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);
}

const databaseUrl = process.env.ERP_FIX22_DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX22_DATABASE_URL is required");
let configuredDatabase = "";
try {
  configuredDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  configuredDatabase = "";
}
if (configuredDatabase !== REQUIRED_DATABASE) {
  throw new Error(`ERP_FIX22_DATABASE_URL must target the exact ${REQUIRED_DATABASE} database`);
}
if ((process.env.ERP_FIX22_DATABASE_NAME || "").trim() !== REQUIRED_DATABASE) {
  throw new Error(`ERP_FIX22_DATABASE_NAME=${REQUIRED_DATABASE} is required`);
}

const origin = new URL(REQUIRED_ORIGIN);
assert.deepEqual(
  { protocol: origin.protocol, hostname: origin.hostname, port: origin.port, pathname: origin.pathname },
  { protocol: "https:", hostname: "43.135.148.43.nip.io", port: "18888", pathname: "/" },
);

const dateOnly = (value) => String(value || "").slice(0, 10);
const nonEmpty = (value, field) => {
  assert.equal(typeof value, "string", `${field} must be a string`);
  assert.ok(value.trim(), `${field} must not be empty`);
  return value;
};

async function canonicalPurchaseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1 || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical Purchase UAT credential metadata is invalid");
  }
  let document;
  try {
    document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  } catch {
    throw new Error("canonical Purchase UAT credential schema is invalid");
  }
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
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the FIX-22 readonly UAT runner");
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1,
    `${stage} has page-level horizontal overflow: ${JSON.stringify(widths)}`);
}

async function noDialogOverflow(dialog, stage) {
  const widths = await dialog.evaluate((element) => {
    const body = element.querySelector(".rfq-dialog-body");
    return {
      has_body: Boolean(body),
      dialog_client: element.clientWidth,
      dialog_scroll: element.scrollWidth,
      body_client: body?.clientWidth || 0,
      body_scroll: body?.scrollWidth || 0,
    };
  });
  assert.ok(widths.has_body
    && widths.dialog_scroll <= widths.dialog_client + 1
    && widths.body_scroll <= widths.body_client + 1,
  `${stage} has horizontal overflow: ${JSON.stringify(widths)}`);
}

function allowedApiGet(url) {
  return url.pathname === "/api/session"
    || (url.pathname === "/api/procurement/rfqs/1" && url.search === "");
}

function assertTextIncludes(text, expected, stage) {
  for (const value of expected) {
    assert.ok(text.includes(String(value)), `${stage} is missing ${value}`);
  }
}

function assertDetailPayload(detail) {
  assert.deepEqual({
    id: Number(detail.header?.id),
    rfq_code: detail.header?.rfq_code,
    purchase_request_id: Number(detail.header?.purchase_request_id),
    request_code: detail.header?.request_code,
    round_no: Number(detail.header?.round_no),
    status: detail.header?.status,
    response_deadline: dateOnly(detail.header?.response_deadline),
    currency_code: detail.header?.currency_code,
    source_purchase_request_version: Number(detail.header?.source_purchase_request_version),
    source_current_version: Number(detail.header?.source_current_version),
    source_status: detail.header?.source_status,
    source_latest: detail.header?.source_latest,
    deadline_valid: detail.header?.deadline_valid,
    version: Number(detail.header?.version),
    project_code: detail.header?.project_code,
  }, {
    id: 1,
    rfq_code: RFQ_CODE,
    purchase_request_id: 1,
    request_code: PRQ_CODE,
    round_no: 1,
    status: "DRAFT",
    response_deadline: "2026-08-31",
    currency_code: "CNY",
    source_purchase_request_version: 2,
    source_current_version: 2,
    source_status: "ACCEPTED",
    source_latest: true,
    deadline_valid: true,
    version: 1,
    project_code: PROJECT_CODE,
  });
  nonEmpty(detail.header.project_name, "project_name");

  assert.equal(detail.lines.length, 4);
  assert.deepEqual(detail.lines.map((line) => ({
    id: Number(line.id),
    purchase_request_line_id: Number(line.purchase_request_line_id),
    line_no: Number(line.line_no),
    material_id: Number(line.material_id),
    internal_material_code: line.internal_material_code,
    unit_code: line.unit_code,
    requested_quantity: String(line.requested_quantity),
  })), MATERIALS.map((material, index) => ({
    id: index + 1,
    purchase_request_line_id: index + 1,
    line_no: index + 1,
    material_id: material.id,
    internal_material_code: material.code,
    unit_code: "PCS",
    requested_quantity: "10.000000",
  })));
  for (const line of detail.lines) nonEmpty(line.standard_name, `Material ${line.material_id} standard_name`);

  assert.deepEqual(detail.suppliers.map((supplier) => ({
    supplier_id: Number(supplier.supplier_id),
    supplier_code: supplier.supplier_code,
    supplier_name: supplier.supplier_name,
    status: supplier.status,
    supplier_status: supplier.supplier_status,
  })), SUPPLIERS.map((supplier) => ({
    supplier_id: supplier.id,
    supplier_code: supplier.code,
    supplier_name: supplier.name,
    status: "INVITED",
    supplier_status: "ACTIVE",
  })));

  const receipt = detail.creation_receipt;
  assert.deepEqual({
    authority: receipt?.authority,
    event_type: receipt?.event_type,
    immutable: receipt?.immutable,
    actor: receipt?.actor,
    occurred_at_shanghai: receipt?.occurred_at_shanghai,
    request_id: receipt?.request_id,
    result: receipt?.result,
    old_version: receipt?.old_version,
    new_version: Number(receipt?.new_version),
  }, {
    authority: "EXACT_SUCCESS_AUDIT",
    event_type: "RFQ_CREATED",
    immutable: false,
    actor: REQUIRED_USERNAME,
    occurred_at_shanghai: CREATION_TIME_SHANGHAI,
    request_id: CREATION_REQUEST_ID,
    result: "SUCCESS",
    old_version: null,
    new_version: 1,
  });
  assert.match(receipt.idempotency_key_digest, /^[0-9a-f]{64}$/);
  assert.match(String(receipt.operation_id), /^[0-9a-f-]{36}$/i);
  assert.match(receipt.authority_note, /0039 前草稿没有独立 RFQ_CREATED 业务事件/);
  assert.match(receipt.authority_note, /未伪造历史事件/);

  const trace = detail.mapping_traceability;
  assert.deepEqual({
    mode: trace?.mode,
    complete: trace?.complete,
    can_issue: trace?.can_issue,
    summary: trace?.summary,
    bindings: trace?.bindings?.length,
    current_qualification: trace?.current_qualification?.length,
  }, {
    mode: "UNBOUND_LEGACY_DRAFT",
    complete: false,
    can_issue: false,
    summary: "历史草稿尚未固定 Mapping",
    bindings: 0,
    current_qualification: 8,
  });
  assert.deepEqual(trace.issues, ["历史草稿尚未固定 Mapping；当前资格结果不能冒充创建时绑定。"]);
  const current = [...trace.current_qualification].sort((left, right) => Number(left.supplier_id) - Number(right.supplier_id)
    || Number(left.material_id) - Number(right.material_id));
  assert.deepEqual(current.map((row) => ({
    supplier_id: Number(row.supplier_id),
    material_id: Number(row.material_id),
    mapping_id: row.mapping_id,
    supplier_part_number: row.supplier_part_number,
  })), MAPPINGS.map((mapping) => ({
    supplier_id: mapping.supplierId,
    material_id: mapping.materialId,
    mapping_id: mapping.mappingId,
    supplier_part_number: mapping.partNumber,
  })));
  for (const row of current) {
    assert.deepEqual({
      supplier_status: row.supplier_status,
      invitation_status: row.invitation_status,
      mapping_version: Number(row.mapping_version),
      mapping_row_version: Number(row.mapping_row_version),
      purchase_unit_code: row.purchase_unit_code,
      base_unit_code: row.base_unit_code,
      conversion_numerator: String(row.conversion_numerator),
      conversion_denominator: String(row.conversion_denominator),
      valid_from: dateOnly(row.valid_from),
      valid_to: row.valid_to,
      binding_source: row.binding_source,
      binding_status: row.binding_status,
      current_status: row.current_status,
      status_drift: row.status_drift,
      version_drift: row.version_drift,
      eligible: row.eligible,
      issue_reason: row.issue_reason,
    }, {
      supplier_status: "ACTIVE",
      invitation_status: "INVITED",
      mapping_version: 1,
      mapping_row_version: 3,
      purchase_unit_code: "PCS",
      base_unit_code: "PCS",
      conversion_numerator: "1",
      conversion_denominator: "1",
      valid_from: "2026-08-05",
      valid_to: null,
      binding_source: "CURRENT_QUALIFICATION",
      binding_status: "CURRENT_ACTIVE_CANDIDATE",
      current_status: "ACTIVE",
      status_drift: false,
      version_drift: false,
      eligible: true,
      issue_reason: "",
    }, `Supplier ${row.supplier_id} / Material ${row.material_id}`);
    nonEmpty(row.supplier_name, `Supplier ${row.supplier_id} name`);
    nonEmpty(row.standard_name, `Material ${row.material_id} name`);
  }

  assert.deepEqual(detail.downstream_counts, { quotes: 0, awards: 0, purchase_orders: 0 });
  assert.deepEqual(detail.events, []);
  assert.deepEqual(detail.quotes, []);
  assert.deepEqual(detail.quote_lines, []);
  assert.deepEqual(detail.comparisons, []);
  assert.deepEqual(detail.comparison_lines, []);
  assert.equal(detail.award, null);
  assert.equal(detail.issue_receipt, null);
  return { receipt, trace, current };
}

async function assertMappingCards(scope, current, stage) {
  assert.equal(await scope.locator(".rfq-mapping-group").count(), 2, `${stage} supplier group count`);
  assert.equal(await scope.locator(".rfq-mapping-card").count(), 8, `${stage} Mapping card count`);
  for (const supplier of SUPPLIERS) {
    const group = scope.locator(`.rfq-mapping-group[aria-label="Supplier ${supplier.id} Mapping"]`);
    assert.equal(await group.count(), 1, `${stage} Supplier ${supplier.id} group`);
    assertTextIncludes(await group.locator(".rfq-mapping-supplier").innerText(), [
      `Supplier ID ${supplier.id} · ${supplier.code} · ${supplier.name}`,
      "当前供应商状态：ACTIVE",
    ], `${stage} Supplier ${supplier.id}`);
  }
  for (const mapping of MAPPINGS) {
    const row = current.find((candidate) => Number(candidate.supplier_id) === mapping.supplierId
      && Number(candidate.material_id) === mapping.materialId);
    assert.ok(row, `${stage} missing Supplier ${mapping.supplierId} / Material ${mapping.materialId}`);
    const card = scope.locator(".rfq-mapping-card", { hasText: mapping.mappingId });
    assert.equal(await card.count(), 1, `${stage} Mapping ${mapping.mappingId}`);
    assertTextIncludes(await card.innerText(), [
      `Material ID ${mapping.materialId} · ${row.internal_material_code}`,
      row.standard_name,
      mapping.partNumber,
      mapping.mappingId,
      "v1 / Row v3",
      "PCS → PCS · 1:1",
      "2026-08-05 — 长期",
      "ACTIVE · 当前资格检查（尚未固定）",
      "INVITED",
      "ACTIVE · v1 / Row v3",
      "不适用（尚未固定）",
    ], `${stage} Mapping ${mapping.mappingId}`);
  }
}

async function assertNoProtectedRfq(page, stage) {
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const text = await page.locator("body").innerText();
  for (const protectedValue of [
    RFQ_CODE,
    PRQ_CODE,
    PROJECT_CODE,
    CREATION_REQUEST_ID,
    ...MAPPINGS.map(({ mappingId }) => mappingId),
  ]) {
    assert.equal(text.includes(protectedValue), false, `${stage}: protected RFQ content remained visible`);
  }
  assert.equal(await page.locator(".rfq-dialog").count(), 0, `${stage}: protected dialog remained visible`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: "rfq-traceability-fix22-uat-readonly-browser",
});

async function readMainUatState() {
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
      request.request_code,q.round_no::int,q.status,q.response_deadline::text,q.currency_code,q.version::int,
      q.source_purchase_request_version::int,request.version::int source_current_version,request.status source_status,
      project.project_code,q.created_by,q.request_id::text,
      to_char(q.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at_shanghai,
      q.issued_by,q.issued_at,q.closed_at
      from procurement_rfqs q
      join planning_purchase_requests request on request.id=q.purchase_request_id
      join planning_material_requirement_plans plan on plan.id=request.plan_id
      join business_projects project on project.id=plan.project_id where q.id=1`)).rows[0];
    const lines = (await client.query(`select line.id::int,line.purchase_request_line_id::int,line.line_no::int,
      line.material_id::int,material.internal_material_code,line.requested_quantity::numeric(24,6)::text,
      unit.code unit_code from procurement_rfq_lines line
      join material_master material on material.id=line.material_id join units unit on unit.id=line.unit_id
      where line.rfq_id=1 order by line.line_no`)).rows;
    const suppliers = (await client.query(`select invitation.supplier_id::int,supplier.supplier_code,
      supplier.supplier_name,invitation.status invitation_status,supplier.status supplier_status
      from procurement_rfq_suppliers invitation join suppliers supplier on supplier.id=invitation.supplier_id
      where invitation.rfq_id=1 order by invitation.supplier_id`)).rows;
    const population = (await client.query(`select
      (select count(*)::int from procurement_rfqs) rfqs,
      (select count(*)::int from procurement_rfq_lines) rfq_lines,
      (select count(*)::int from procurement_rfq_suppliers) rfq_suppliers,
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings) rfq_mapping_bindings,
      (select count(*)::int from procurement_sourcing_events) sourcing_events,
      (select count(*)::int from audit_log where route_code='PROCUREMENT_SOURCING') sourcing_audits,
      (select count(*)::int from supplier_mappings) supplier_mappings,
      (select count(*)::int from supplier_mappings where status='ACTIVE') active_supplier_mappings,
      (select count(*)::int from procurement_supplier_quotes) quotes,
      (select count(*)::int from procurement_supplier_quote_lines) quote_lines,
      (select count(*)::int from procurement_quote_comparisons) comparisons,
      (select count(*)::int from procurement_sourcing_awards) awards,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select count(*)::int from purchase_delivery_plans) delivery_plans,
      (select count(*)::int from purchase_receipts) receipts,
      (select count(*)::int from inventory_ledger_entries) ledger_entries,
      (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
      (select count(*)::int from production_work_orders) work_orders`)).rows[0];
    await client.query("commit");
    return { schema, header, lines, suppliers, population };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertStrictMainUatState(state, stage) {
  assert.deepEqual(state.schema, {
    database_name: REQUIRED_DATABASE,
    transaction_read_only: "on",
    migration_count: 39,
    head_version: "0039_rfq_traceability.sql",
    active_sessions: 0,
  }, `${stage} schema/session guard`);
  assert.deepEqual(state.header, {
    id: 1,
    rfq_code: RFQ_CODE,
    purchase_request_id: 1,
    request_code: PRQ_CODE,
    round_no: 1,
    status: "DRAFT",
    response_deadline: "2026-08-31",
    currency_code: "CNY",
    version: 1,
    source_purchase_request_version: 2,
    source_current_version: 2,
    source_status: "ACCEPTED",
    project_code: PROJECT_CODE,
    created_by: REQUIRED_USERNAME,
    request_id: CREATION_REQUEST_ID,
    created_at_shanghai: CREATION_TIME_SHANGHAI,
    issued_by: null,
    issued_at: null,
    closed_at: null,
  }, `${stage} RFQ header`);
  assert.deepEqual(state.lines, MATERIALS.map((material, index) => ({
    id: index + 1,
    purchase_request_line_id: index + 1,
    line_no: index + 1,
    material_id: material.id,
    internal_material_code: material.code,
    requested_quantity: "10.000000",
    unit_code: "PCS",
  })), `${stage} RFQ lines`);
  assert.deepEqual(state.suppliers, SUPPLIERS.map((supplier) => ({
    supplier_id: supplier.id,
    supplier_code: supplier.code,
    supplier_name: supplier.name,
    invitation_status: "INVITED",
    supplier_status: "ACTIVE",
  })), `${stage} RFQ suppliers`);
  assert.deepEqual(state.population, {
    rfqs: 1,
    rfq_lines: 4,
    rfq_suppliers: 2,
    rfq_mapping_bindings: 0,
    sourcing_events: 0,
    sourcing_audits: 3,
    supplier_mappings: 8,
    active_supplier_mappings: 8,
    quotes: 0,
    quote_lines: 0,
    comparisons: 0,
    awards: 0,
    purchase_orders: 0,
    delivery_plans: 0,
    receipts: 0,
    ledger_entries: 0,
    ap_documents: 0,
    work_orders: 0,
  }, `${stage} business population`);
}

let browser;
let context;
let authenticated = false;
const authPosts = [];
const businessWrites = [];
const apiGets = [];
const forbiddenApiGets = [];
const browserErrors = [];

async function revokeSession() {
  if (!authenticated || !context) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      const logout = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
      });
      assert.equal(logout.status(), 200, "cleanup logout must succeed");
    }
  }
  authenticated = false;
}

try {
  const before = await readMainUatState();
  assertStrictMainUatState(before, "before browser UAT");
  const credential = await canonicalPurchaseCredential();
  const chromium = await loadChromium();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && url.pathname.startsWith("/api/")) {
      const target = `${url.pathname}${url.search}`;
      apiGets.push(target);
      if (!allowedApiGet(url)) {
        forbiddenApiGets.push(target);
        return route.abort("blockedbyclient");
      }
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) {
      authPosts.push(url.pathname);
      return route.continue();
    }
    businessWrites.push(`${method} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === REQUIRED_ORIGIN && response.status() >= 400) {
      browserErrors.push(`http:${response.status()}:${url.pathname}`);
    }
  });

  const loginResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/login`, {
    headers: { Origin: REQUIRED_ORIGIN },
    data: credential,
  });
  authPosts.push("/api/login");
  assert.equal(loginResponse.status(), 200);
  const loginPayload = await loginResponse.json();
  assert.equal(loginPayload.ok, true);
  assert.deepEqual([
    loginPayload.user?.username,
    loginPayload.user?.role,
    loginPayload.user?.is_active,
    loginPayload.user?.must_change_password,
  ], [REQUIRED_USERNAME, "purchase", true, false]);
  authenticated = true;
  const sessionResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/session`);
  assert.equal(sessionResponse.status(), 200);
  const session = await sessionResponse.json();
  assert.deepEqual([session.authenticated, session.user?.username, session.user?.role],
    [true, REQUIRED_USERNAME, "purchase"]);
  assert.ok(session.user.permissions.includes("procurement.rfq.read"));
  assert.ok(session.user.permissions.includes("procurement.rfq.manage"));
  assert.equal(typeof session.csrf_token, "string");
  assert.ok(session.csrf_token.length > 0);

  const detailResponsePromise = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/procurement/rfqs/1`
    && response.request().method() === "GET");
  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: `${RFQ_CODE} · Round 1`, exact: true }).waitFor();
  const detailResponse = await detailResponsePromise;
  assert.equal(detailResponse.status(), 200);
  const detailPayload = await detailResponse.json();
  assert.equal(detailPayload.ok, true);
  const { receipt, trace, current } = assertDetailPayload(detailPayload.data);

  const bodyText = await page.locator("body").innerText();
  assertTextIncludes(bodyText, [
    `ID 1 · ${RFQ_CODE}`,
    "Round 1 / v1",
    "DRAFT / 草稿 / 待发出",
    `ID 1 · ${PRQ_CODE}`,
    "固定 v2 · 当前 v2",
    PROJECT_CODE,
    detailPayload.data.header.project_name,
    "2026-08-31",
    "CNY",
    "历史草稿尚未固定 Mapping",
    "当前资格检查 / 尚未冻结的拟绑定 Mapping",
    "报价入口未启用",
    "Quote 0 · Award 0 · PO 0",
    "尚无不可变询比价事件。",
  ], "RFQ detail");
  for (const line of detailPayload.data.lines) {
    assertTextIncludes(bodyText, [
      `Material ${line.material_id}`,
      line.internal_material_code,
      line.standard_name,
      "10.000000",
      "PCS",
    ], `RFQ Line ${line.line_no}`);
  }

  const creation = page.locator('[aria-label="RFQ 创建凭证"]');
  assert.equal(await creation.count(), 1);
  assertTextIncludes(await creation.innerText(), [
    "RFQ 创建成功凭证",
    "SUCCESS",
    "EXACT_SUCCESS_AUDIT",
    "RFQ_CREATED",
    REQUIRED_USERNAME,
    `${CREATION_TIME_SHANGHAI}（Asia/Shanghai）`,
    "不存在 → v1",
    "不可变",
    CREATION_REQUEST_ID,
    receipt.operation_id,
    receipt.idempotency_key_digest,
    "0039 前草稿没有独立 RFQ_CREATED 业务事件",
    "未伪造历史事件",
  ], "creation receipt");

  const traceability = page.locator('[aria-label="Supplier Mapping 追溯"]');
  assert.equal(await traceability.count(), 1);
  assertTextIncludes(await traceability.innerText(), [
    "历史草稿尚未固定 Mapping",
    "当前资格检查 / 尚未冻结的拟绑定 Mapping",
    "不代表 RFQ 创建时已经绑定",
    trace.issues[0],
  ], "Mapping traceability");
  await assertMappingCards(traceability, current, "detail");
  await noOverflow(page, "RFQ detail desktop");

  const bindButton = page.getByRole("button", { name: "确认并固定当前 Mapping", exact: true });
  const issueButton = page.getByRole("button", { name: "发出询价并冻结范围", exact: true });
  assert.equal(await bindButton.count(), 1);
  assert.equal(await bindButton.isEnabled(), true);
  assert.equal(await issueButton.count(), 1);
  assert.equal(await issueButton.isEnabled(), true);

  await issueButton.click();
  let dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "取消");
  assert.equal(await dialog.locator(".rfq-confirm-lines article").count(), 4);
  assert.equal(await dialog.locator(".rfq-confirm-suppliers span").count(), 2);
  assert.equal(await dialog.locator(".rfq-mapping-card").count(), 8);
  const dialogText = await dialog.innerText();
  assertTextIncludes(dialogText, [
    `ID 1 · ${RFQ_CODE}`,
    "Round 1 / v1",
    "DRAFT / 草稿 / 待发出",
    `ID 1 · ${PRQ_CODE}`,
    PROJECT_CODE,
    detailPayload.data.header.project_name,
    "2026-08-31",
    "CNY",
    "RFQ 创建成功凭证",
    "EXACT_SUCCESS_AUDIT",
    "RFQ_CREATED",
    "SUCCESS",
    REQUIRED_USERNAME,
    CREATION_TIME_SHANGHAI,
    CREATION_REQUEST_ID,
    "不存在 → v1",
    "固定范围 · 4 条 Material",
    "受邀 Supplier · 2 家",
    "拟固定 Mapping · 8 条",
    "发出前服务端重新校验 PRQ、Supplier、Mapping、截止日期、CAS 与当前 DRAFT 状态。",
    "发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结，不可原地修改。",
    "只有发出成功后才允许录入 Supplier 报价。",
    "本操作不自动创建 Quote、Award、PO、库存或财务记录。",
    "当前不可发出",
    "历史草稿尚未固定 Mapping。请先退出本窗口，使用独立的显式固定操作。",
  ], "issue confirmation");
  for (const line of detailPayload.data.lines) {
    assertTextIncludes(dialogText, [
      `Line ${line.line_no} · Material ${line.material_id}`,
      `${line.internal_material_code} · ${line.standard_name}`,
      `${line.requested_quantity} ${line.unit_code}`,
    ], `issue confirmation Line ${line.line_no}`);
  }
  for (const supplier of SUPPLIERS) {
    assertTextIncludes(dialogText, [`ID ${supplier.id} · ${supplier.code} · ${supplier.name}`],
      `issue confirmation Supplier ${supplier.id}`);
  }
  await assertMappingCards(dialog, current, "issue confirmation");
  const issueConfirm = dialog.getByRole("button", { name: "发出询价并冻结范围", exact: true });
  assert.equal(await issueConfirm.isDisabled(), true, "legacy draft must not be issuable before explicit Mapping binding");
  await noDialogOverflow(dialog, "issue confirmation desktop");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, [], "desktop cancel must issue zero business writes");

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "RFQ detail 390x844");
  await issueButton.click();
  dialog = page.getByRole("dialog", { name: "发出询价并冻结范围", exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("button", { name: "发出询价并冻结范围", exact: true }).isDisabled(), true);
  await noOverflow(page, "issue confirmation page 390x844");
  await noDialogOverflow(dialog, "issue confirmation 390x844");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, [], "mobile cancel must issue zero business writes");

  const logoutResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  authPosts.push("/api/logout");
  assert.equal(logoutResponse.status(), 200);
  authenticated = false;
  const anonymousSession = await context.request.get(`${REQUIRED_ORIGIN}/api/session`);
  assert.equal(anonymousSession.status(), 200);
  assert.equal((await anonymousSession.json()).authenticated, false);

  await page.reload({ waitUntil: "domcontentloaded" });
  await assertNoProtectedRfq(page, "RFQ detail reload after logout");
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  await assertNoProtectedRfq(page, "logout");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertNoProtectedRfq(page, "history back");
  await page.goForward({ waitUntil: "domcontentloaded" });
  await assertNoProtectedRfq(page, "history forward");
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertNoProtectedRfq(page, "root reload after logout");

  const after = await readMainUatState();
  assertStrictMainUatState(after, "after browser UAT");
  assert.deepEqual(after, before, "main UAT protected RFQ state must remain byte-for-byte equivalent at the read-model boundary");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(forbiddenApiGets, []);
  assert.deepEqual(authPosts, ["/api/login", "/api/logout"]);
  assert.deepEqual(browserErrors, []);
  assert.equal(apiGets.filter((target) => target === "/api/procurement/rfqs/1").length, 1,
    "protected RFQ detail must not refetch after logout/history restore");
  assert.ok(apiGets.filter((target) => target === "/api/session").length >= 1);
  console.info(`RFQ_TRACEABILITY_FIX22_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 status=DRAFT version=1 legacy_unbound=1 proposed_mappings=8 issue_dialog_cancelled=2 business_post=0 quote=0 award=0 po=0 session=0 desktop=1 mobile=1 history_safe=1`);
} finally {
  try {
    await revokeSession();
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      const finalState = await readMainUatState();
      assert.equal(finalState.schema.active_sessions, 0, "cleanup must leave zero active application sessions");
    } finally {
      await pool.end();
    }
  }
}
