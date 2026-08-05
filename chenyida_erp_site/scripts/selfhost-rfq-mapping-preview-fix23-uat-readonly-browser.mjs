import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX23_RFQ1_MAPPING_PREVIEW_READONLY_CANCEL";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const RFQ_CODE = "RFQ-00000001";
const PRQ_CODE = "PRQ-00000001";
const PROJECT_CODE = "PRJ-00000001";
const CREATION_REQUEST_ID = "75078325-3b3a-4d1e-b911-99cbd5f802db";
const CREATION_TIME_SHANGHAI = "2026-08-05 15:24:26.684817";
const PREVIEW_PATH = "/api/procurement/rfqs/1/mapping-bindings/preview?expected_version=1";

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

if (process.env.ERP_RFQ_MAPPING_FIX23_UAT_CONFIRM !== REQUIRED_CONFIRM) {
  throw new Error(`ERP_RFQ_MAPPING_FIX23_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);
}
const databaseUrl = process.env.ERP_FIX23_DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX23_DATABASE_URL is required");
const configuredDatabase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
if (configuredDatabase !== REQUIRED_DATABASE || process.env.ERP_FIX23_DATABASE_NAME !== REQUIRED_DATABASE) {
  throw new Error(`FIX-23 database guards must target the exact ${REQUIRED_DATABASE} database`);
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
  throw new Error("Playwright is required in the FIX-23 readonly UAT runner");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rfq-mapping-fix23-uat-readonly" });

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
      request.request_code,q.round_no::int,q.status,q.version::int,q.source_purchase_request_version::int,
      request.version::int source_current_version,request.status source_status,project.project_code,
      q.issued_by,q.issued_at,q.closed_at
      from procurement_rfqs q join planning_purchase_requests request on request.id=q.purchase_request_id
      join planning_material_requirement_plans plan on plan.id=request.plan_id
      join business_projects project on project.id=plan.project_id where q.id=1`)).rows[0];
    const lines = (await client.query(`select line.id::int,line.line_no::int,line.material_id::int,
      material.internal_material_code,line.requested_quantity::numeric(24,6)::text,unit.code unit_code
      from procurement_rfq_lines line join material_master material on material.id=line.material_id
      join units unit on unit.id=line.unit_id where line.rfq_id=1 order by line.line_no`)).rows;
    const suppliers = (await client.query(`select invitation.supplier_id::int,supplier.supplier_code,
      supplier.status supplier_status,invitation.status invitation_status
      from procurement_rfq_suppliers invitation join suppliers supplier on supplier.id=invitation.supplier_id
      where invitation.rfq_id=1 order by invitation.supplier_id`)).rows;
    const mappings = (await client.query(`select mapping.supplier_id::int,mapping.material_id::int,
      mapping.mapping_uid::text mapping_id,mapping.mapping_version_no::int mapping_version,
      mapping.version::int mapping_row_version,mapping.status,mapping.supplier_item_code supplier_part_number
      from supplier_mappings mapping where mapping.supplier_id in (1,2)
      and mapping.material_id in (533,534,535,536) order by mapping.supplier_id,mapping.material_id`)).rows;
    const population = (await client.query(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1) bindings,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1) rfq_events,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_ISSUED') issued_events,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1) quotes,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_award_po_line_links link join procurement_sourcing_awards award on award.id=link.award_id where award.rfq_id=1) purchase_orders,
      (select count(*)::int from audit_log where route_code='PROCUREMENT_SOURCING') sourcing_audits,
      (select count(*)::int from idempotency_keys where path like '/api/procurement/rfqs%') sourcing_idempotency`)).rows[0];
    await client.query("commit");
    return { schema, header, lines, suppliers, mappings, population };
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
    status: "DRAFT", version: 1, source_purchase_request_version: 2, source_current_version: 2,
    source_status: "ACCEPTED", project_code: PROJECT_CODE, issued_by: null, issued_at: null, closed_at: null,
  }, `${stage} RFQ`);
  assert.deepEqual(state.lines, MATERIALS.map((material, index) => ({
    id: index + 1, line_no: index + 1, material_id: material.id, internal_material_code: material.code,
    requested_quantity: "10.000000", unit_code: "PCS",
  })), `${stage} lines`);
  assert.deepEqual(state.suppliers, SUPPLIERS.map((supplier) => ({
    supplier_id: supplier.id, supplier_code: supplier.code, supplier_status: "ACTIVE", invitation_status: "INVITED",
  })), `${stage} suppliers`);
  assert.deepEqual(state.mappings.map((mapping) => ({
    supplier_id: mapping.supplier_id, material_id: mapping.material_id, mapping_id: mapping.mapping_id,
    mapping_version: mapping.mapping_version, mapping_row_version: mapping.mapping_row_version,
    status: mapping.status, supplier_part_number: mapping.supplier_part_number,
  })), MAPPINGS.map((mapping) => ({
    supplier_id: mapping.supplierId, material_id: mapping.materialId, mapping_id: mapping.mappingId,
    mapping_version: 1, mapping_row_version: 3, status: "ACTIVE", supplier_part_number: mapping.partNumber,
  })), `${stage} mappings`);
  assert.deepEqual(state.population, {
    bindings: 0, rfq_events: 0, issued_events: 0, quotes: 0, awards: 0, purchase_orders: 0,
    sourcing_audits: 3, sourcing_idempotency: 1,
  }, `${stage} protected counts`);
}

function assertPreview(preview) {
  assert.deepEqual({
    id: Number(preview.rfq?.id), rfq_code: preview.rfq?.rfq_code, round_no: Number(preview.rfq?.round_no),
    version: Number(preview.rfq?.version), expected_version: Number(preview.rfq?.expected_version),
    status: preview.rfq?.status, purchase_request_id: Number(preview.rfq?.purchase_request_id),
    request_code: preview.rfq?.request_code, source_version: Number(preview.rfq?.source_purchase_request_version),
    current_source_version: Number(preview.rfq?.current_purchase_request_version), project_code: preview.rfq?.project_code,
  }, {
    id: 1, rfq_code: RFQ_CODE, round_no: 1, version: 1, expected_version: 1, status: "DRAFT",
    purchase_request_id: 1, request_code: PRQ_CODE, source_version: 2, current_source_version: 2,
    project_code: PROJECT_CODE,
  });
  assert.deepEqual({
    qualification_passed: preview.qualification_passed,
    expected_binding_count: Number(preview.expected_binding_count),
    actual_candidate_count: Number(preview.actual_candidate_count),
    current_binding_count: Number(preview.current_binding_count),
    missing_combination_count: Number(preview.missing_combination_count),
    supplier_material_conflict_count: Number(preview.supplier_material_conflict_count),
    supplier_part_number_conflict_count: Number(preview.supplier_part_number_conflict_count),
    blockers: preview.blocking_reasons?.length,
    timezone: preview.data_timezone,
  }, {
    qualification_passed: true, expected_binding_count: 8, actual_candidate_count: 8,
    current_binding_count: 0, missing_combination_count: 0, supplier_material_conflict_count: 0,
    supplier_part_number_conflict_count: 0, blockers: 0, timezone: "Asia/Shanghai",
  });
  assert.match(preview.observed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  assert.match(preview.qualification_digest, /^[0-9a-f]{64}$/);
  assert.equal(preview.lines.length, 4);
  assert.deepEqual(preview.suppliers.map((supplier) => ({
    id: Number(supplier.supplier_id), code: supplier.supplier_code, status: supplier.status,
    required: Number(supplier.required_material_count), eligible_count: Number(supplier.eligible_mapping_count),
    coverage: supplier.coverage, missing: Number(supplier.missing_material_count),
    material_conflicts: Number(supplier.supplier_material_conflict_count),
    part_conflicts: Number(supplier.supplier_part_number_conflict_count), eligible: supplier.eligible,
  })), SUPPLIERS.map((supplier) => ({
    id: supplier.id, code: supplier.code, status: "ACTIVE", required: 4, eligible_count: 4,
    coverage: "4/4", missing: 0, material_conflicts: 0, part_conflicts: 0, eligible: true,
  })));
  const combinations = [...preview.combinations].sort((left, right) => Number(left.supplier_id) - Number(right.supplier_id)
    || Number(left.material_id) - Number(right.material_id));
  assert.equal(combinations.length, 8);
  assert.deepEqual(combinations.map((row) => ({
    supplier_id: Number(row.supplier_id), material_id: Number(row.material_id), mapping_id: row.mapping_id,
    part_number: row.supplier_part_number,
  })), MAPPINGS.map((mapping) => ({
    supplier_id: mapping.supplierId, material_id: mapping.materialId,
    mapping_id: mapping.mappingId, part_number: mapping.partNumber,
  })));
  for (const row of combinations) {
    assert.ok(Number(row.rfq_line_id) > 0 && Number(row.mapping_version_id) > 0);
    assert.deepEqual({
      supplier_status: row.supplier_status, material_status: row.material_status,
      mapping_version: Number(row.mapping_version), mapping_row_version: Number(row.mapping_row_version),
      purchase_unit_code: row.purchase_unit_code, base_unit_code: row.base_unit_code,
      conversion_numerator: String(row.conversion_numerator), conversion_denominator: String(row.conversion_denominator),
      conversion_text: row.conversion_text, valid_from: row.valid_from, valid_to: row.valid_to,
      mapping_status: row.mapping_status,
      supplier_material_count: Number(row.current_active_supplier_material_count),
      supplier_part_count: Number(row.current_active_supplier_part_number_count),
      supplier_material_conflict: row.supplier_material_conflict,
      supplier_part_number_conflict: row.supplier_part_number_conflict,
      eligible: row.eligible, issues: row.issues.length,
    }, {
      supplier_status: "ACTIVE", material_status: "ACTIVE", mapping_version: 1, mapping_row_version: 3,
      purchase_unit_code: "PCS", base_unit_code: "PCS", conversion_numerator: "1", conversion_denominator: "1",
      conversion_text: "1:1", valid_from: "2026-08-05", valid_to: null, mapping_status: "ACTIVE",
      supplier_material_count: 1, supplier_part_count: 1, supplier_material_conflict: false,
      supplier_part_number_conflict: false, eligible: true, issues: 0,
    }, `Supplier ${row.supplier_id} / Material ${row.material_id}`);
  }
}

async function noOverflow(page, locator, stage) {
  const widths = locator
    ? await locator.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))
    : await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(widths.scroll <= widths.client + 1, `${stage} horizontal overflow: ${JSON.stringify(widths)}`);
}

function includesAll(text, values, stage) {
  for (const value of values) assert.ok(text.includes(String(value)), `${stage} missing ${value}`);
}

let browser;
let context;
let authenticated = false;
const businessWrites = [];
const apiGets = [];
const forbiddenGets = [];
const browserErrors = [];
let releaseFirstPreview;
const firstPreviewGate = new Promise((resolve) => { releaseFirstPreview = resolve; });
let pauseFirstPreview = true;

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
      if (!["/api/session", "/api/procurement/rfqs/1", PREVIEW_PATH].includes(target)) {
        forbiddenGets.push(target);
        return route.abort("blockedbyclient");
      }
      if (target === PREVIEW_PATH && pauseFirstPreview) {
        pauseFirstPreview = false;
        await firstPreviewGate;
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
  const creationText = await creation.innerText();
  includesAll(creationText, [
    "RFQ 创建成功审计", "CREATION AUDIT", "精确匹配的成功 Audit", "RFQ_CREATED", "独立 RFQ_CREATED Event", "否",
    REQUIRED_USERNAME, `${CREATION_TIME_SHANGHAI}（Asia/Shanghai）`, "不存在 → v1", "SUCCESS", CREATION_REQUEST_ID,
    "这是与本 RFQ 精确匹配的成功 Audit，不是独立 RFQ_CREATED 业务 Event。",
  ], "creation Audit");
  assert.equal(creationText.includes("RFQ 创建成功凭证"), false);
  const bodyText = await page.locator("body").innerText();
  includesAll(bodyText, ["RFQ 业务 Event（与 Audit 分列）", "尚无独立 RFQ 业务 Event；创建成功 Audit 在上方独立显示。"], "Event/Audit labels");
  await noOverflow(page, null, "desktop detail");

  const bind = page.getByRole("button", { name: "确认并固定当前 Mapping", exact: true });
  assert.equal(await bind.isEnabled(), true);
  await bind.click();
  let dialog = page.getByRole("dialog", { name: "确认并固定当前 Mapping", exact: true });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "取消");
  includesAll(await dialog.innerText(), ["正在重新查询当前权威资格与冲突证据…", "此查询零业务写入。"], "loading state");
  releaseFirstPreview();
  const previewResponse = await page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/mapping-bindings/preview"));
  assert.equal(previewResponse.status(), 200);
  const previewEnvelope = await previewResponse.json();
  assert.match(previewEnvelope.request_id, /^[0-9a-f-]{36}$/i);
  assertPreview(previewEnvelope.data);
  await dialog.getByRole("heading", { name: "当前资格检查：全部通过", exact: true }).waitFor();
  const dialogText = await dialog.innerText();
  includesAll(dialogText, [
    "当前资格检查：全部通过", "Supplier 1：4/4", "Supplier 2：4/4", "缺失组合：0",
    "Supplier/Material 冲突：0", "供应商料号冲突：0", "候选 Mapping：8", "预期 Binding：8", "当前 Binding：0",
    "Binding 0 → 预期 8", "Supplier × RFQ Line Mapping · 8 条", "不可变关系化快照说明",
    "确认后将生成8条关系化、不可变的Supplier×RFQ Line Mapping Binding。",
    "每条Binding固定引用本次确认的Mapping ID和Version。后续Supplier Mapping状态、版本或内容发生变化时，不会自动替换或改写本RFQ已固定的Binding。",
    "固定 Mapping 不等于发出 RFQ", "RFQ 继续保持 DRAFT / 草稿 / 待发出",
    "本操作不创建 Quote、Award、PO、库存或财务记录。", "正式发出仍需后续独立确认",
    "当前预览不是提交锁", "资格摘要 SHA-256",
  ], "desktop Mapping preview");
  assert.equal(await dialog.locator(".rfq-mapping-card").count(), 8);
  for (const mapping of MAPPINGS) includesAll(dialogText, [mapping.mappingId, mapping.partNumber], `Mapping ${mapping.mappingId}`);
  const confirm = dialog.getByRole("button", { name: "确认并固定当前 Mapping", exact: true });
  assert.equal(await confirm.isEnabled(), true);
  await noOverflow(page, dialog, "desktop Mapping preview");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, [], "ESC must issue zero business writes");

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, null, "mobile detail");
  const secondPreviewResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/mapping-bindings/preview"));
  await bind.click();
  dialog = page.getByRole("dialog", { name: "确认并固定当前 Mapping", exact: true });
  await dialog.waitFor();
  assert.equal((await secondPreviewResponse).status(), 200);
  await dialog.getByRole("heading", { name: "当前资格检查：全部通过", exact: true }).waitFor();
  assert.equal(await dialog.locator(".rfq-mapping-card").count(), 8);
  assert.equal(await dialog.getByRole("button", { name: "确认并固定当前 Mapping", exact: true }).isEnabled(), true);
  await noOverflow(page, null, "mobile preview page");
  await noOverflow(page, dialog, "mobile Mapping preview");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, [], "cancel must issue zero business writes");

  const logout = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  assert.equal(logout.status(), 200);
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of [RFQ_CODE, PRQ_CODE, CREATION_REQUEST_ID, ...MAPPINGS.map((row) => row.mappingId)]) {
    assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);
  }

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "readonly UAT must preserve protected business state");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  assert.equal(apiGets.filter((target) => target === PREVIEW_PATH).length, 2);
  console.info(`RFQ_MAPPING_PREVIEW_FIX23_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 qualification=passed supplier1=4/4 supplier2=4/4 missing=0 supplier_material_conflict=0 supplier_part_conflict=0 mappings=8 bindings=0 status=DRAFT issued=0 quote=0 award=0 po=0 preview_get=2 business_post=0 esc=1 cancel=1 desktop=1 mobile=1 session=0`);
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
