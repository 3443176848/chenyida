import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_DATABASE_HOST = "postgres";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRMATION = "MAIN_UAT_RFQ1_AWARD_CANDIDATE_CONFIRM_CANCEL_ONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const DETAIL_API_PATH = "/api/procurement/rfqs/1";
const EXPECTED_OUTPUT_DIGEST = "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec";
const AWARD_REASON = "交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。";
const SUPPLIER_A_NAME = "UAT快速交付供应商A-042576";
const SUPPLIER_B_NAME = "UAT低价延期供应商B-042576";
const EXPECTED_LINES = [
  { comparison_line_id: "1", rfq_line_id: "1", material_id: "533", material_code: "CYD-RB_PCB-000016", supplier_b_candidate: "1", supplier_a_candidate: "2" },
  { comparison_line_id: "2", rfq_line_id: "2", material_id: "534", material_code: "CYD-RB_SENSOR-000003", supplier_b_candidate: "3", supplier_a_candidate: "4" },
  { comparison_line_id: "3", rfq_line_id: "3", material_id: "535", material_code: "CYD-RB_CONN-000075", supplier_b_candidate: "5", supplier_a_candidate: "6" },
  { comparison_line_id: "4", rfq_line_id: "4", material_id: "536", material_code: "CYD-RB_METAL-000015", supplier_b_candidate: "7", supplier_a_candidate: "8" },
];

if (process.env.ERP_RFQ_AWARD_CANDIDATE_FIX29_UAT_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_AWARD_CANDIDATE_FIX29_UAT_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_RFQ_AWARD_CANDIDATE_DATABASE_URL || "";
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
if (!parsedDatabaseUrl || !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)
  || parsedDatabaseUrl.hostname !== REQUIRED_DATABASE_HOST || Number(parsedDatabaseUrl.port || "5432") !== 5432
  || process.env.ERP_RFQ_AWARD_CANDIDATE_DATABASE_NAME !== REQUIRED_DATABASE
  || decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")) !== REQUIRED_DATABASE) {
  throw new Error(`FIX-29 UAT database guards must target the exact ${REQUIRED_DATABASE} database`);
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
    } catch { /* continue through the controlled module candidates */ }
  }
  throw new Error("Playwright is required in the FIX-29 readonly UAT runner");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rfq-award-candidate-fix29-uat-readonly" });

async function readProtectedState() {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    const connection = (await client.query(`select current_database() database_name,
      current_setting('transaction_read_only') transaction_read_only,
      (select count(*)::int from app_sessions where username=$1 and revoked_at is null and expires_at>now()) active_purchase_sessions`, [REQUIRED_USERNAME])).rows[0];
    const rfq = (await client.query(`select id::text id,rfq_code,round_no::int,status,version::int
      from procurement_rfqs where id=1`)).rows[0];
    const comparisonLines = (await client.query(`select comparison.id::text comparison_line_id,
      comparison.rfq_line_id::text rfq_line_id,comparison.comparison_version_no::int,
      comparison.basis_digest,rfq_line.material_id::text material_id,material.internal_material_code
      from procurement_quote_comparisons comparison
      join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
      join material_master material on material.id=rfq_line.material_id
      where comparison.rfq_id=1 and comparison.comparison_version_no=1
        and comparison.id in (1,2,3,4)
      order by comparison.id`)).rows;
    const candidates = (await client.query(`select candidate.id::text candidate_id,
      candidate.comparison_id::text comparison_line_id,comparison.rfq_line_id::text rfq_line_id,
      rfq_line.material_id::text material_id,material.internal_material_code,
      candidate.quote_line_id::text quote_line_id,quote_line.quote_id::text quote_id,
      quote.quote_version_no::int quote_version_no,candidate.supplier_id::text supplier_id,
      supplier.supplier_code,supplier.supplier_name,candidate.currency_code,
      quote_line.quoted_quantity::text quoted_quantity,candidate.unit_price::text unit_price,
      (quote_line.quoted_quantity*candidate.unit_price)::numeric(30,6)::text line_amount,
      candidate.promised_delivery_date::text promised_delivery_date,
      candidate.delivery_status,candidate.price_rank::int,candidate.lowest_price,
      greatest((rfq_line.required_date-candidate.promised_delivery_date)::int,0)::int early_days,
      greatest((candidate.promised_delivery_date-rfq_line.required_date)::int,0)::int late_days,
      candidate.comparable_status,candidate.awardable
      from procurement_quote_comparison_lines candidate
      join procurement_quote_comparisons comparison on comparison.id=candidate.comparison_id
      join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
      join material_master material on material.id=rfq_line.material_id
      join procurement_supplier_quote_lines quote_line on quote_line.id=candidate.quote_line_id
      join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
      join suppliers supplier on supplier.id=candidate.supplier_id
      where comparison.rfq_id=1 and comparison.comparison_version_no=1
        and candidate.id in (1,2,3,4,5,6,7,8)
      order by candidate.id`)).rows;
    const counts = (await client.query(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1) bindings,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1) quotes,
      (select count(distinct comparison_version_no)::int from procurement_quote_comparisons where rfq_id=1) comparison_versions,
      (select count(*)::int from procurement_quote_comparisons where rfq_id=1 and comparison_version_no=1) comparison_lines,
      (select count(*)::int from procurement_quote_comparison_lines candidate
        join procurement_quote_comparisons comparison on comparison.id=candidate.comparison_id
        where comparison.rfq_id=1 and comparison.comparison_version_no=1) candidates,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines award_line
        join procurement_sourcing_awards award on award.id=award_line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
    await client.query("commit");
    return { connection, rfq, comparison_lines: comparisonLines, candidates, counts };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function stableId(value, label) {
  assert.match(String(value), /^[1-9]\d*$/, `${label} must be a canonical stable ID`);
  return String(value);
}

function assertProtectedState(state, stage, expectedSessions = 0) {
  assert.deepEqual(state.connection, {
    database_name: REQUIRED_DATABASE,
    transaction_read_only: "on",
    active_purchase_sessions: expectedSessions,
  }, `${stage} connection/session`);
  assert.deepEqual(state.rfq, { id: "1", rfq_code: "RFQ-00000001", round_no: 1, status: "ISSUED", version: 6 }, `${stage} RFQ`);
  assert.deepEqual(state.counts, {
    bindings: 8,
    quotes: 2,
    comparison_versions: 1,
    comparison_lines: 4,
    candidates: 8,
    awards: 0,
    award_lines: 0,
    purchase_orders: 0,
  }, `${stage} protected counts`);
  assert.deepEqual(state.comparison_lines.map((row) => ({
    comparison_line_id: row.comparison_line_id,
    rfq_line_id: row.rfq_line_id,
    version: row.comparison_version_no,
    material_id: row.material_id,
    material_code: row.internal_material_code,
  })), EXPECTED_LINES.map((line) => ({
    comparison_line_id: line.comparison_line_id,
    rfq_line_id: line.rfq_line_id,
    version: 1,
    material_id: line.material_id,
    material_code: line.material_code,
  })), `${stage} Comparison Lines`);
  assert.ok(state.comparison_lines.every((row) => /^[0-9a-f]{64}$/.test(row.basis_digest)), `${stage} basis digests`);
  assert.equal(state.candidates.length, 8, `${stage} exact Candidate count`);
  assert.deepEqual(state.candidates.map((row) => row.candidate_id), ["1", "2", "3", "4", "5", "6", "7", "8"], `${stage} Candidate IDs`);
  for (const expected of EXPECTED_LINES) {
    const lineCandidates = state.candidates.filter((row) => row.comparison_line_id === expected.comparison_line_id);
    assert.deepEqual(lineCandidates.map((row) => row.candidate_id), [expected.supplier_b_candidate, expected.supplier_a_candidate], `${stage} Candidate grouping for Line ${expected.comparison_line_id}`);
    assert.ok(lineCandidates.every((row) => row.rfq_line_id === expected.rfq_line_id
      && row.material_id === expected.material_id && row.internal_material_code === expected.material_code), `${stage} Candidate material scope for Line ${expected.comparison_line_id}`);
  }
  const supplierA = state.candidates.filter((row) => row.supplier_id === "1");
  const supplierB = state.candidates.filter((row) => row.supplier_id === "2");
  assert.equal(supplierA.length, 4, `${stage} Supplier A Candidate count`);
  assert.equal(supplierB.length, 4, `${stage} Supplier B Candidate count`);
  assert.ok(supplierA.every((row) => row.supplier_code === "SUP-000001" && row.supplier_name === SUPPLIER_A_NAME
    && row.quote_id === "1" && row.quote_version_no === 1 && stableId(row.quote_line_id, "Supplier A Quote Line ID")
    && row.currency_code === "CNY" && row.quoted_quantity === "10.000000"
    && row.unit_price === "12.000000" && row.line_amount === "120.000000"
    && row.promised_delivery_date === "2026-10-20" && row.delivery_status === "ON_TIME"
    && row.early_days === 10 && row.late_days === 0 && row.price_rank === 2 && row.lowest_price === false
    && row.comparable_status === "COMPARABLE" && row.awardable === true), `${stage} Supplier A Candidate facts`);
  assert.ok(supplierB.every((row) => row.supplier_code === "SUP-000002" && row.supplier_name === SUPPLIER_B_NAME
    && row.quote_id === "2" && row.quote_version_no === 1 && stableId(row.quote_line_id, "Supplier B Quote Line ID")
    && row.currency_code === "CNY" && row.quoted_quantity === "10.000000"
    && row.unit_price === "10.000000" && row.line_amount === "100.000000"
    && row.promised_delivery_date === "2026-11-05" && row.delivery_status === "LATE"
    && row.early_days === 0 && row.late_days === 6 && row.price_rank === 1 && row.lowest_price === true
    && row.comparable_status === "COMPARABLE" && row.awardable === true), `${stage} Supplier B Candidate facts`);
}

function assertDetail(detail) {
  assert.deepEqual({ id: String(detail.header.id), code: detail.header.rfq_code, round: Number(detail.header.round_no), status: detail.header.status, version: Number(detail.header.version) }, {
    id: "1", code: "RFQ-00000001", round: 1, status: "ISSUED", version: 6,
  });
  assert.equal(detail.downstream_counts.quotes, 2);
  assert.equal(detail.downstream_counts.awards, 0);
  assert.equal(detail.downstream_counts.purchase_orders, 0);
  const version = detail.comparison_read_model.current_version;
  assert.ok(version);
  assert.equal(version.comparison_version_no, 1);
  assert.equal(version.status, "CURRENT");
  assert.equal(version.awardable_now, true);
  assert.equal(version.quote_inputs_current, true);
  assert.equal(version.input_drift, false);
  assert.equal(version.output_summary.digest, EXPECTED_OUTPUT_DIGEST);
  assert.equal(version.material_summaries.length, 4);
  for (const expected of EXPECTED_LINES) {
    const material = version.material_summaries.find((row) => String(row.rfq_line_id) === expected.rfq_line_id);
    assert.ok(material, `missing Material summary for RFQ Line ${expected.rfq_line_id}`);
    assert.deepEqual({ comparison: String(material.comparison_line_id), material: String(material.material_id), code: material.internal_material_code }, {
      comparison: expected.comparison_line_id, material: expected.material_id, code: expected.material_code,
    });
    assert.deepEqual(material.offers.map((row) => String(row.comparison_candidate_id)).sort((left, right) => Number(left) - Number(right)), [expected.supplier_b_candidate, expected.supplier_a_candidate]);
    assert.ok(material.offers.every((candidate) => typeof candidate.comparison_candidate_id === "string"
      && typeof candidate.comparison_line_id === "string" && typeof candidate.quote_id === "string"
      && typeof candidate.quote_line_id === "string" && candidate.quote_input_current === true
      && candidate.comparable_status === "COMPARABLE" && candidate.awardable === true));
  }
  return version;
}

function includesAll(text, expected, stage) {
  for (const value of expected) assert.ok(text.includes(String(value)), `${stage} missing ${value}`);
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1, `${stage}: document overflow ${JSON.stringify(widths)}`);
  assert.ok(widths.body <= widths.viewport + 1, `${stage}: body overflow ${JSON.stringify(widths)}`);
}

async function noDialogOverflow(dialog, stage) {
  const widths = await dialog.evaluate((element) => {
    const body = element.querySelector(".rfq-dialog-body");
    return {
      dialogClient: element.clientWidth,
      dialogScroll: element.scrollWidth,
      bodyClient: body?.clientWidth || 0,
      bodyScroll: body?.scrollWidth || 0,
    };
  });
  assert.ok(widths.dialogScroll <= widths.dialogClient + 1, `${stage}: dialog overflow ${JSON.stringify(widths)}`);
  assert.ok(widths.bodyScroll <= widths.bodyClient + 1, `${stage}: dialog body overflow ${JSON.stringify(widths)}`);
}

async function assertConfirmation(page, version, stage) {
  const dialog = page.locator(".rfq-dialog.award-confirm-dialog[role=dialog]");
  await dialog.getByRole("heading", { name: "正式定标确认", exact: true }).waitFor();
  assert.equal(await dialog.locator(".award-confirm-lines article").count(), 4);
  assert.deepEqual(await dialog.locator(".award-confirm-lines article").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-selected-candidate-id"))), ["2", "4", "6", "8"]);
  const text = await dialog.innerText();
  includesAll(text, [
    "ID 1 / RFQ-00000001", "Round 1 / v6", "v1 / CURRENT", "awardable_now", "true",
    EXPECTED_OUTPUT_DIGEST, ...version.comparison_rows.map((row) => row.basis_digest),
    ...EXPECTED_LINES.flatMap((line) => [line.material_id, line.material_code, line.supplier_a_candidate]),
    "SUP-000001", SUPPLIER_A_NAME, "Candidate ID 2", "Candidate ID 4", "Candidate ID 6", "Candidate ID 8",
    "Quote ID 1 / v1", "12.00 CNY", "120.00 CNY", "2026-10-20", "ON_TIME / 提前10天", "价格排名 2 / 非最低价",
    `SUP-000001 · ${SUPPLIER_A_NAME}`, `SUP-000002 · ${SUPPLIER_B_NAME}`,
    "480.00 CNY", "400.00 CNY", "80.00 CNY / 20%", "LATE / 延期6天",
    "SUP-000001 比 SUP-000002 早 16 天。",
    "DELIVERY_PRIORITY / 交期优先", AWARD_REASON,
    "本次只新增一个不可变 Sourcing Award 及其 Award Line", "不会自动创建 PO、到货计划、收货、库存、应付或其他下游记录",
  ], stage);
  await dialog.getByRole("button", { name: "取消", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "最终确认并创建 Award", exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
  await noOverflow(page, stage);
  await noDialogOverflow(dialog, stage);
  return dialog;
}

let browser;
let context;
let authenticated = false;
const businessWrites = [];
const directBusinessWrites = [];
const forbiddenGets = [];
const browserErrors = [];

async function directPost(path, options) {
  if (!["/api/login", "/api/logout"].includes(path)) {
    directBusinessWrites.push(`POST ${path}`);
    throw new Error(`blocked direct business POST ${path}`);
  }
  return context.request.post(`${REQUIRED_ORIGIN}${path}`, options);
}

async function logoutIfNeeded() {
  if (!authenticated || !context) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      await directPost("/api/logout", { headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token } });
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

  const login = await directPost("/api/login", { headers: { Origin: REQUIRED_ORIGIN }, data: credential });
  assert.equal(login.status(), 200);
  authenticated = true;
  const loginPayload = await login.json();
  assert.deepEqual([loginPayload.user?.username, loginPayload.user?.role, loginPayload.user?.is_active, loginPayload.user?.must_change_password], [REQUIRED_USERNAME, "purchase", true, false]);
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.ok(session.authenticated && session.csrf_token && session.user.permissions.includes("procurement.sourcing.award"));

  const detailResponse = await context.request.get(`${REQUIRED_ORIGIN}${DETAIL_API_PATH}`);
  assert.equal(detailResponse.status(), 200);
  const detail = (await detailResponse.json()).data;
  const currentVersion = assertDetail(detail);

  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
  await page.getByRole("heading", { name: "人工定标与撤销", exact: true }).waitFor();
  const form = page.locator("form.award-selection-form");
  await form.waitFor();
  assert.equal(await form.locator("select.award-candidate-select").count(), 4);
  for (const expected of EXPECTED_LINES) {
    const select = form.locator(`select.award-candidate-select[name="candidate_${expected.rfq_line_id}"]`);
    assert.equal(await select.getAttribute("data-candidate-count"), "2");
    assert.equal(await select.inputValue(), "");
    const options = await select.locator("option").evaluateAll((items) => items.map((option) => ({ value: option.value, label: option.textContent?.trim() || "" })));
    assert.deepEqual(options.map((option) => option.value), ["", expected.supplier_b_candidate, expected.supplier_a_candidate]);
    includesAll(options[1].label, ["SUP-000002", SUPPLIER_B_NAME, `Candidate ID ${expected.supplier_b_candidate}`, "Quote ID 2/v1", "单价 10.00 CNY", "行金额 100.00 CNY", "2026-11-05", "LATE / 延期6天", "价格排名1"], `Supplier B option for Line ${expected.rfq_line_id}`);
    includesAll(options[2].label, ["SUP-000001", SUPPLIER_A_NAME, `Candidate ID ${expected.supplier_a_candidate}`, "Quote ID 1/v1", "单价 12.00 CNY", "行金额 120.00 CNY", "2026-10-20", "ON_TIME / 提前10天", "价格排名2"], `Supplier A option for Line ${expected.rfq_line_id}`);
    await select.selectOption(expected.supplier_a_candidate);
  }
  await form.locator('select[name="reason_code"]').selectOption("DELIVERY_PRIORITY");
  await form.locator('textarea[name="reason"]').fill(AWARD_REASON);
  await form.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).click();
  const dialog = await assertConfirmation(page, currentVersion, "desktop Award confirmation");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertConfirmation(page, currentVersion, "390x844 Award confirmation");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);

  for (const expected of EXPECTED_LINES) {
    await form.locator(`select[name="candidate_${expected.rfq_line_id}"]`).selectOption("");
  }
  await form.locator('select[name="reason_code"]').selectOption("");
  await form.locator('textarea[name="reason"]').fill("");

  const during = await readProtectedState();
  assertProtectedState(during, "after cancel", 1);
  const logout = await directPost("/api/logout", { headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token } });
  assert.equal(logout.status(), 200);
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of ["RFQ-00000001", EXPECTED_OUTPUT_DIGEST, AWARD_REASON, ...EXPECTED_LINES.map((line) => line.material_code)]) {
    assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);
  }

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "FIX-29 readonly UAT must preserve the exact protected state");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  console.info(`RFQ_AWARD_CANDIDATE_FIX29_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 rfq_version=6 comparison_version=1 comparison_lines=4 candidates=8 selected_candidates=2,4,6,8 output_digest=${EXPECTED_OUTPUT_DIGEST} business_post=0 award=0 award_line=0 po=0 desktop=1 mobile=1 cancelled=1 session=0`);
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
