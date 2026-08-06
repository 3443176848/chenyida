import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRMATION = "MAIN_UAT_FIX27_RFQ1_QUOTE_READONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const DETAIL_API_PATH = "/api/procurement/rfqs/1";
const SCOPE_DIGEST = "9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d";
const QUOTE_REQUEST_ID = "5ca5863a-6a5d-4457-917a-d1b24f41ccff";
const QUOTE_TIME_SHANGHAI = "2026-08-06 13:10:59.800906";

if (process.env.ERP_RFQ_QUOTE_FIX27_UAT_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_QUOTE_FIX27_UAT_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_FIX27_DATABASE_URL || "";
if (!databaseUrl || process.env.ERP_FIX27_DATABASE_NAME !== REQUIRED_DATABASE
  || decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")) !== REQUIRED_DATABASE) {
  throw new Error(`FIX-27 database guards must target the exact ${REQUIRED_DATABASE} database`);
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
  throw new Error("Playwright is required in the FIX-27 readonly UAT runner");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rfq-quote-fix27-uat-readonly" });
const shanghai = (column) => `to_char(${column} at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US')`;

async function readProtectedState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const connection = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from app_sessions where username=$1 and revoked_at is null and expires_at>now()) active_purchase_sessions`, [REQUIRED_USERNAME])).rows[0];
    const header = (await client.query(`select id::int,rfq_code,round_no::int,status,version::int,
      traceability_version::int,response_deadline::text,currency_code from procurement_rfqs where id=1`)).rows[0];
    const suppliers = (await client.query(`select supplier_id::int,status,
      case when responded_at is null then null else ${shanghai("responded_at")} end responded_at_shanghai
      from procurement_rfq_suppliers where rfq_id=1 and supplier_id in (1,2) order by supplier_id`)).rows;
    const bindings = (await client.query(`select binding.id::text,binding.rfq_supplier_id::int,
      binding.rfq_line_id::int,binding.supplier_id::int,binding.material_id::int,
      binding.supplier_mapping_version_id::int,binding.mapping_uid::text,binding.mapping_version_no::int,
      binding.mapping_row_version::int,binding.mapping_content_digest,binding.binding_status,
      mapping.status mapping_status,mapping.mapping_version_no::int current_mapping_version,
      mapping.version::int current_mapping_row_version,mapping.content_digest current_mapping_content_digest
      from procurement_rfq_supplier_line_mapping_bindings binding
      join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
      where binding.rfq_id=1 and binding.id between 1 and 8 order by binding.id`)).rows;
    const quote = (await client.query(`select id::text,rfq_id::int,supplier_id::int,quote_version_no::int,
      supplier_quote_reference,status,currency_code,valid_until::text,version::int,recorded_by,
      ${shanghai("recorded_at")} recorded_at_shanghai,request_id::text from procurement_supplier_quotes
      where id=1 and rfq_id=1 and supplier_id=1`)).rows[0];
    const quoteLines = (await client.query(`select line.id::text,line.rfq_line_id::int,line.quoted_quantity::text,
      line.unit_price::text,(line.quoted_quantity*line.unit_price)::numeric(30,6)::text line_amount,
      line.promised_delivery_date::text,rfq_line.required_date::text,
      (rfq_line.required_date-line.promised_delivery_date)::int delivery_delta_days
      from procurement_supplier_quote_lines line join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id
      where line.quote_id=1 order by rfq_line.line_no`)).rows;
    const events = (await client.query(`select id::text,quote_id::text,event_type,actor,
      ${shanghai("created_at")} occurred_at_shanghai,request_id::text,result,old_version::int,
      new_version::int,scope_digest from procurement_sourcing_events where rfq_id=1 order by id`)).rows;
    const counts = (await client.query(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1) bindings,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_MAPPING_CONFIRMED') mapping_confirmed,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_ISSUED') issued,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1 and supplier_id=1) supplier_a_quotes,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1 and supplier_id=2) supplier_b_quotes,
      (select count(*)::int from procurement_supplier_quotes) quotes,
      (select count(*)::int from procurement_sourcing_awards) awards,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
    await client.query("commit");
    return { connection, header, suppliers, bindings, quote, quote_lines: quoteLines, events, counts };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function assertProtectedState(state, stage, expectedSessions = 0) {
  assert.deepEqual(state.connection, {
    database_name: REQUIRED_DATABASE, transaction_read_only: "on", active_purchase_sessions: expectedSessions,
  }, `${stage} connection/session`);
  assert.deepEqual(state.header, {
    id: 1, rfq_code: "RFQ-00000001", round_no: 1, status: "ISSUED", version: 4,
    traceability_version: 1, response_deadline: "2026-08-31", currency_code: "CNY",
  }, `${stage} RFQ`);
  assert.deepEqual(state.suppliers, [
    { supplier_id: 1, status: "RESPONDED", responded_at_shanghai: QUOTE_TIME_SHANGHAI },
    { supplier_id: 2, status: "INVITED", responded_at_shanghai: null },
  ], `${stage} invitations`);
  assert.equal(state.bindings.length, 8, `${stage} Binding count`);
  assert.deepEqual(state.bindings.map((row) => row.id), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.ok(state.bindings.every((row) => row.binding_status === "ACTIVE" && row.mapping_status === "ACTIVE"
    && row.mapping_version_no === row.current_mapping_version && row.mapping_row_version === row.current_mapping_row_version
    && row.mapping_content_digest === row.current_mapping_content_digest), `${stage} frozen Mapping scope`);
  assert.deepEqual({ id: state.quote.id, rfq_id: state.quote.rfq_id, supplier_id: state.quote.supplier_id,
    quote_version_no: state.quote.quote_version_no, reference: state.quote.supplier_quote_reference,
    status: state.quote.status, currency: state.quote.currency_code, valid_until: state.quote.valid_until,
    version: state.quote.version, actor: state.quote.recorded_by, time: state.quote.recorded_at_shanghai,
    request_id: state.quote.request_id }, {
    id: "1", rfq_id: 1, supplier_id: 1, quote_version_no: 1, reference: "UAT-Q-A-042576",
    status: "SUBMITTED", currency: "CNY", valid_until: "2026-09-30", version: 1,
    actor: REQUIRED_USERNAME, time: QUOTE_TIME_SHANGHAI, request_id: QUOTE_REQUEST_ID,
  }, `${stage} Quote`);
  assert.equal(state.quote_lines.length, 4);
  assert.ok(state.quote_lines.every((line, index) => line.id === String(index + 1)
    && line.rfq_line_id === index + 1 && line.quoted_quantity === "10.000000"
    && line.unit_price === "12.000000" && line.line_amount === "120.000000"
    && line.promised_delivery_date === "2026-10-20" && line.required_date === "2026-10-30"
    && line.delivery_delta_days === 10), `${stage} Quote lines`);
  assert.deepEqual(state.events.map(({ id, quote_id, event_type, result, old_version, new_version, scope_digest }) => ({ id, quote_id, event_type, result, old_version, new_version, scope_digest })), [
    { id: "1", quote_id: null, event_type: "RFQ_MAPPING_CONFIRMED", result: "SUCCESS", old_version: 1, new_version: 2, scope_digest: SCOPE_DIGEST },
    { id: "2", quote_id: null, event_type: "RFQ_ISSUED", result: "SUCCESS", old_version: 2, new_version: 3, scope_digest: SCOPE_DIGEST },
    { id: "3", quote_id: "1", event_type: "QUOTE_SUBMITTED", result: "SUCCESS", old_version: null, new_version: null, scope_digest: null },
  ], `${stage} Events`);
  assert.deepEqual(state.counts, { bindings: 8, mapping_confirmed: 1, issued: 1, supplier_a_quotes: 1,
    supplier_b_quotes: 0, quotes: 1, awards: 0, purchase_orders: 0 }, `${stage} counts`);
}

function includesAll(text, expected, stage) {
  for (const value of expected) assert.ok(text.includes(String(value)), `${stage} missing ${value}`);
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(widths.scroll <= widths.client + 1, `${stage} horizontal overflow: ${JSON.stringify(widths)}`);
}

let browser;
let context;
let authenticated = false;
const businessWrites = [];
const directBusinessWrites = [];
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
    if (method === "GET" && url.pathname.startsWith("/api/")
      && !["/api/session", DETAIL_API_PATH].includes(`${url.pathname}${url.search}`)) {
      forbiddenGets.push(`${url.pathname}${url.search}`);
      return route.abort("blockedbyclient");
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
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.ok(session.authenticated && session.csrf_token && session.user.permissions.includes("procurement.quote.record"));

  const detailResponse = await context.request.get(`${REQUIRED_ORIGIN}${DETAIL_API_PATH}`);
  assert.equal(detailResponse.status(), 200);
  const detail = (await detailResponse.json()).data;
  assert.deepEqual({ id: Number(detail.header.id), status: detail.header.status, version: Number(detail.header.version),
    round: Number(detail.header.round_no) }, { id: 1, status: "ISSUED", version: 4, round: 1 });
  assert.equal(detail.mapping_traceability.scope_intact, true);
  assert.deepEqual(detail.mapping_traceability.issues, []);
  assert.equal(detail.mapping_binding_receipt.scope_digest, SCOPE_DIGEST);
  assert.ok(detail.mapping_traceability.bindings.every((binding) => binding.scope_intact === true));
  assert.deepEqual(detail.suppliers.map((supplier) => ({ id: Number(supplier.supplier_id), status: supplier.status,
    entry: supplier.quote_entry_enabled })), [
    { id: 1, status: "RESPONDED", entry: false },
    { id: 2, status: "INVITED", entry: true },
  ]);
  assert.equal(detail.quotes.length, 1);
  assert.deepEqual({ id: detail.quotes[0].id, business_code: detail.quotes[0].quote_business_code,
    has_business_code: detail.quotes[0].has_quote_business_code, supplier_id: Number(detail.quotes[0].supplier_id),
    supplier_code: detail.quotes[0].supplier_code, rfq_id: Number(detail.quotes[0].rfq_id),
    round: Number(detail.quotes[0].round_no), version: Number(detail.quotes[0].quote_version_no),
    status: detail.quotes[0].status, reference: detail.quotes[0].supplier_quote_reference,
    valid_until: detail.quotes[0].valid_until, total: detail.quotes[0].total_amount,
    actor: detail.quotes[0].recorded_by, time: detail.quotes[0].recorded_at_shanghai,
    request_id: detail.quotes[0].request_id }, {
    id: "1", business_code: null, has_business_code: false, supplier_id: 1, supplier_code: "SUP-000001",
    rfq_id: 1, round: 1, version: 1, status: "SUBMITTED", reference: "UAT-Q-A-042576",
    valid_until: "2026-09-30", total: "480.000000", actor: REQUIRED_USERNAME,
    time: QUOTE_TIME_SHANGHAI, request_id: QUOTE_REQUEST_ID,
  });
  assert.equal(detail.quote_lines.length, 4);
  assert.ok(detail.quote_lines.every((line) => line.quoted_quantity === "10.000000"
    && line.unit_price === "12.000000" && line.line_amount === "120.000000"
    && line.unit_code === "PCS" && line.currency_code === "CNY"
    && line.required_date === "2026-10-30" && line.promised_delivery_date === "2026-10-20"
    && Number(line.delivery_delta_days) === 10 && Number(line.early_days) === 10
    && Number(line.late_days) === 0 && line.delivery_status === "ON_TIME"
    && line.delivery_explanation === "准时，提前10天"));
  const quoteEvents = detail.events.filter((event) => event.quote_id === "1");
  assert.equal(quoteEvents.length, 1);
  assert.deepEqual({ type: quoteEvents[0].event_type, result: quoteEvents[0].result,
    old: quoteEvents[0].old_version, next: quoteEvents[0].new_version,
    transition: quoteEvents[0].version_transition_semantics, actor: quoteEvents[0].actor,
    time: quoteEvents[0].occurred_at_shanghai, request_id: quoteEvents[0].request_id }, {
    type: "QUOTE_SUBMITTED", result: "SUCCESS", old: null, next: null, transition: "NOT_RECORDED",
    actor: REQUIRED_USERNAME, time: QUOTE_TIME_SHANGHAI, request_id: QUOTE_REQUEST_ID,
  });

  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Quote追溯 · 数据库ID 1", exact: true }).waitFor();
  const desktopText = await page.locator("body").innerText();
  includesAll(desktopText, [
    "Round 1 / v4", "ISSUED / 已发出", "RESPONDED / 已报价", "INVITED / 待报价",
    "Quote入口：不可直接提交首版", "Quote入口：可报价", "稳定Quote数据库ID", "未设置独立Quote业务编号",
    "ID 1 / SUP-000001", "ID 1 / Round 1", "当前 v1", "SUBMITTED / 当前报价", "UAT-Q-A-042576",
    "2026-09-30", "10 PCS × 12.00 CNY", "120.00 CNY", "480.00 CNY", "2026-10-20",
    "2026-10-30", "ON_TIME / 准时", "准时，提前10天", REQUIRED_USERNAME,
    `${QUOTE_TIME_SHANGHAI}（Asia/Shanghai）`, QUOTE_REQUEST_ID, "SUCCESS", "只产生QUOTE_SUBMITTED",
    "没有独立CREATE Event", "事件未记录版本转换", "RFQ Version是询价聚合CAS",
    "Supplier报价响应会正常推进CAS", SCOPE_DIGEST,
  ], "desktop Quote traceability");
  assert.equal(desktopText.includes("当前阻断项"), false);
  assert.equal(desktopText.includes("vnull"), false);
  assert.equal((desktopText.match(/10 PCS × 12\.00 CNY/g) || []).length, 4);
  assert.equal((desktopText.match(/120\.00 CNY/g) || []).length, 4);
  assert.equal(await page.locator(".rfq-mapping-card.drift").count(), 0);
  assert.equal(await page.locator('[data-quote-id="1"] .quote-lines-table tbody tr').count(), 4);
  assert.equal(await page.locator('.sourcing-quote select[name="supplier_id"] option[value="1"]').count(), 0);
  assert.equal(await page.locator('.sourcing-quote select[name="supplier_id"] option[value="2"]').count(), 1);
  await noOverflow(page, "desktop Quote traceability");

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "390x844 Quote traceability");
  const mobileText = await page.locator("body").innerText();
  includesAll(mobileText, ["Quote追溯 · 数据库ID 1", "480.00 CNY", "准时，提前10天", "SUP-000002", "INVITED / 待报价"], "mobile Quote traceability");
  assert.equal(await page.locator('.sourcing-quote select[name="supplier_id"] option[value="2"]').count(), 1);
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);

  const logout = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  assert.equal(logout.status(), 200);
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of ["RFQ-00000001", "UAT-Q-A-042576", QUOTE_REQUEST_ID, SCOPE_DIGEST]) {
    assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);
  }

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "readonly UAT must preserve RFQ, Quote, Events, Bindings and counts");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  console.info(`RFQ_QUOTE_SEMANTICS_FIX27_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 version=4 supplier_a=RESPONDED supplier_b=INVITED quote_id=1 quote_status=SUBMITTED quote_version=1 scope=${SCOPE_DIGEST} bindings=8 total=480.00 delivery_delta=10 business_post=0 quote=1 award=0 po=0 desktop=1 mobile=1 session=0`);
} finally {
  try { await logoutIfNeeded(); } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      const finalState = await readProtectedState();
      assert.equal(finalState.connection.active_purchase_sessions, 0, "cleanup must leave zero active Purchase sessions");
    } finally { await pool.end(); }
  }
}
