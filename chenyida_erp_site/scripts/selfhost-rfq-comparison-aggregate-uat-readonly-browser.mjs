import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRMATION = "MAIN_UAT_RFQ1_COMPARISON_AGGREGATE_READONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const DETAIL_API_PATH = "/api/procurement/rfqs/1";
const EXPECTED_ACTOR = REQUIRED_USERNAME;
const EXPECTED_OPERATION_TIME_SHANGHAI = "2026-08-06 17:35:19.942600";
const EXPECTED_OPERATION_REQUEST_ID = "69b1b561-c460-4e98-9560-26dfea17b30f";
const IDENTITY_NOTE = "未设置独立Comparison Header ID；版本身份由RFQ、Round、Comparison Version及basis_digest共同确定。";
const STATUS_NOTE = "状态为服务端读模型投影，不是独立数据库状态列。";
const OUTPUT_NOTE = "确定性输出摘要，由不可变Comparison Line重算；不是伪造的历史持久化字段。";

if (process.env.ERP_RFQ_COMPARISON_AGGREGATE_UAT_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_COMPARISON_AGGREGATE_UAT_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_COMPARISON_AGGREGATE_DATABASE_URL || "";
if (!databaseUrl || process.env.ERP_COMPARISON_AGGREGATE_DATABASE_NAME !== REQUIRED_DATABASE
  || decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")) !== REQUIRED_DATABASE) {
  throw new Error(`Comparison aggregate UAT database guards must target the exact ${REQUIRED_DATABASE} database`);
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
  throw new Error("Playwright is required in the Comparison aggregate readonly UAT runner");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rfq-comparison-aggregate-uat-readonly" });
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
      traceability_version::int,response_deadline::text,currency_code,${shanghai("updated_at")} updated_at_shanghai
      from procurement_rfqs where id=1`)).rows[0];
    const bindings = (await client.query(`select id::text,rfq_supplier_id::text,rfq_line_id::text,
      supplier_id::text,material_id::text,supplier_mapping_version_id::text,mapping_uid::text,
      mapping_version_no::int,mapping_row_version::int,mapping_content_digest,binding_status
      from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1 order by id`)).rows;
    const quotes = (await client.query(`select id::text,supplier_id::int,quote_version_no::int,
      supplier_quote_reference,status,currency_code,valid_until::text,tax_included,freight_included,
      payment_terms,quote_digest,version::int,recorded_by,${shanghai("recorded_at")} recorded_at_shanghai,
      request_id::text from procurement_supplier_quotes where rfq_id=1 order by id`)).rows;
    const quoteLines = (await client.query(`select line.id::text,line.quote_id::text,quote.supplier_id::int,
      line.rfq_line_id::int,line.material_id::int,line.quoted_quantity::text,line.unit_price::text,
      (line.quoted_quantity*line.unit_price)::numeric(30,6)::text line_amount,
      line.promised_delivery_date::text,rfq_line.required_date::text,line.line_digest
      from procurement_supplier_quote_lines line join procurement_supplier_quotes quote on quote.id=line.quote_id
      join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id
      where quote.rfq_id=1 order by line.quote_id,rfq_line.line_no,line.id`)).rows;
    const comparisons = (await client.query(`select comparison.id::text comparison_line_id,
      comparison.rfq_line_id::int,comparison.comparison_version_no::int,comparison.basis_digest,
      comparison.generated_by,${shanghai("comparison.generated_at")} generated_at_shanghai,
      comparison.request_id::text,rfq_line.material_id::int,material.internal_material_code
      from procurement_quote_comparisons comparison
      join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
      join material_master material on material.id=rfq_line.material_id
      where comparison.rfq_id=1 order by comparison.rfq_line_id,comparison.id`)).rows;
    const candidates = (await client.query(`select candidate.id::text comparison_candidate_id,
      candidate.comparison_id::text comparison_line_id,candidate.quote_line_id::text,
      comparison.rfq_line_id::int,rfq_line.material_id::int,candidate.supplier_id::int,
      candidate.unit_price::text,(quote_line.quoted_quantity*candidate.unit_price)::numeric(30,6)::text line_amount,
      candidate.price_rank::int,candidate.promised_delivery_date::text,candidate.delivery_status,
      candidate.tax_included,candidate.freight_included
      from procurement_quote_comparison_lines candidate
      join procurement_quote_comparisons comparison on comparison.id=candidate.comparison_id
      join procurement_supplier_quote_lines quote_line on quote_line.id=candidate.quote_line_id
      join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
      where comparison.rfq_id=1 order by rfq_line.material_id,candidate.supplier_id,candidate.id`)).rows;
    const comparisonEvents = (await client.query(`select event.id::text event_id,event.comparison_id::text,
      event.actor,${shanghai("event.created_at")} occurred_at_shanghai,event.request_id::text,event.result,
      comparison.rfq_line_id::int,rfq_line.material_id::int
      from procurement_sourcing_events event
      join procurement_quote_comparisons comparison on comparison.id=event.comparison_id
      join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
      where event.rfq_id=1 and event.event_type='COMPARISON_GENERATED' order by event.id`)).rows;
    const comparisonAudits = (await client.query(`select id::text,username actor,
      ${shanghai("created_at")} occurred_at_shanghai,request_id::text,result,old_version::int,new_version::int
      from audit_log where route_code='PROCUREMENT_SOURCING' and action='COMPARISON_GENERATED'
      and request_id=$1 order by id`, [EXPECTED_OPERATION_REQUEST_ID])).rows;
    const counts = (await client.query(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1) bindings,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1 and supplier_id=1) supplier_a_quotes,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1 and supplier_id=2) supplier_b_quotes,
      (select count(*)::int from procurement_supplier_quotes) quotes,
      (select count(*)::int from procurement_quote_comparisons where rfq_id=1) comparison_lines,
      (select count(*)::int from procurement_quote_comparison_lines candidate join procurement_quote_comparisons comparison on comparison.id=candidate.comparison_id where comparison.rfq_id=1) comparison_candidates,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='COMPARISON_GENERATED') comparison_events,
      (select count(*)::int from procurement_sourcing_awards) awards,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
    await client.query("commit");
    return { connection, header, bindings, quotes, quote_lines: quoteLines, comparisons, candidates,
      comparison_events: comparisonEvents, comparison_audits: comparisonAudits, counts };
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
    id: 1, rfq_code: "RFQ-00000001", round_no: 1, status: "ISSUED", version: 6,
    traceability_version: 1, response_deadline: "2026-08-31", currency_code: "CNY",
    updated_at_shanghai: EXPECTED_OPERATION_TIME_SHANGHAI,
  }, `${stage} RFQ`);
  assert.equal(state.bindings.length, 8, `${stage} Binding count`);
  assert.ok(state.bindings.every((row) => row.binding_status === "ACTIVE"), `${stage} active Bindings`);
  assert.deepEqual(state.quotes.map(({ id, supplier_id, quote_version_no, supplier_quote_reference, status }) => ({ id, supplier_id, quote_version_no, supplier_quote_reference, status })), [
    { id: "1", supplier_id: 1, quote_version_no: 1, supplier_quote_reference: "UAT-Q-A-042576", status: "SUBMITTED" },
    { id: "2", supplier_id: 2, quote_version_no: 1, supplier_quote_reference: "UAT-Q-B-042576", status: "SUBMITTED" },
  ], `${stage} Quote Headers`);
  assert.ok(state.quotes.every((quote) => quote.currency_code === "CNY" && quote.tax_included === false
    && quote.freight_included === false && quote.payment_terms && /^[0-9a-f]{64}$/.test(quote.quote_digest)), `${stage} Quote terms/digests`);
  assert.equal(state.quote_lines.length, 8, `${stage} Quote Line count`);
  assert.ok(state.quote_lines.filter((line) => line.quote_id === "1").every((line) => line.supplier_id === 1
    && line.unit_price === "12.000000" && line.line_amount === "120.000000"
    && line.promised_delivery_date === "2026-10-20" && line.required_date === "2026-10-30"), `${stage} Supplier A Quote Lines`);
  assert.ok(state.quote_lines.filter((line) => line.quote_id === "2").every((line) => line.supplier_id === 2
    && line.unit_price === "10.000000" && line.line_amount === "100.000000"
    && line.promised_delivery_date === "2026-11-05" && line.required_date === "2026-10-30"), `${stage} Supplier B Quote Lines`);
  assert.equal(state.comparisons.length, 4, `${stage} Comparison Line count`);
  assert.equal(new Set(state.comparisons.map((row) => row.comparison_line_id)).size, 4, `${stage} stable Comparison Line IDs`);
  assert.ok(state.comparisons.every((row) => row.comparison_version_no === 1 && /^[0-9a-f]{64}$/.test(row.basis_digest)
    && row.generated_by === EXPECTED_ACTOR && row.generated_at_shanghai === EXPECTED_OPERATION_TIME_SHANGHAI
    && row.request_id === EXPECTED_OPERATION_REQUEST_ID), `${stage} Comparison identity/basis`);
  assert.equal(state.candidates.length, 8, `${stage} Comparison Candidate count`);
  assert.equal(new Set(state.candidates.map((row) => row.comparison_candidate_id)).size, 8, `${stage} stable Candidate IDs`);
  assert.ok(state.candidates.filter((row) => row.supplier_id === 1).every((row) => row.unit_price === "12.000000"
    && row.line_amount === "120.000000" && row.price_rank === 2 && row.promised_delivery_date === "2026-10-20"
    && row.delivery_status === "ON_TIME"), `${stage} Supplier A Comparison Candidates`);
  assert.ok(state.candidates.filter((row) => row.supplier_id === 2).every((row) => row.unit_price === "10.000000"
    && row.line_amount === "100.000000" && row.price_rank === 1 && row.promised_delivery_date === "2026-11-05"
    && row.delivery_status === "LATE"), `${stage} Supplier B Comparison Candidates`);
  assert.equal(state.comparison_events.length, 4, `${stage} Comparison Event count`);
  assert.ok(state.comparison_events.every((event) => event.actor === EXPECTED_ACTOR
    && event.occurred_at_shanghai === EXPECTED_OPERATION_TIME_SHANGHAI
    && event.request_id === EXPECTED_OPERATION_REQUEST_ID && event.result === "SUCCESS"), `${stage} grouped Comparison Events`);
  assert.deepEqual(state.comparison_audits.map(({ actor, occurred_at_shanghai, request_id, result, old_version, new_version }) => ({ actor, occurred_at_shanghai, request_id, result, old_version, new_version })), [{
    actor: EXPECTED_ACTOR, occurred_at_shanghai: EXPECTED_OPERATION_TIME_SHANGHAI,
    request_id: EXPECTED_OPERATION_REQUEST_ID, result: "success", old_version: 5, new_version: 6,
  }], `${stage} Comparison Audit CAS`);
  assert.deepEqual(state.counts, { bindings: 8, supplier_a_quotes: 1, supplier_b_quotes: 1, quotes: 2,
    comparison_lines: 4, comparison_candidates: 8, comparison_events: 4, awards: 0, purchase_orders: 0 }, `${stage} counts`);
}

function decimalEquals(actual, expected, label) {
  assert.match(String(actual), /^-?\d+(?:\.\d+)?$/, `${label} must be a decimal string`);
  assert.equal(Number(actual), expected, label);
}

function canonicalDigest(value) {
  const normalize = (input) => Array.isArray(input)
    ? input.map(normalize)
    : input && typeof input === "object"
      ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]))
      : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function stableId(value, label) {
  assert.match(String(value), /^[1-9]\d*$/, `${label} must be a stable database ID`);
  return String(value);
}

function assertComparisonReadModel(model) {
  assert.equal(model.identity_note, IDENTITY_NOTE);
  assert.equal(model.status_note, STATUS_NOTE);
  assert.ok(String(model.input_summary_note).includes("basis_digest"));
  assert.equal(model.output_summary_note, OUTPUT_NOTE);
  assert.equal(model.has_independent_header_id, false);
  assert.equal(model.comparison_header_id, null);
  assert.equal(model.versions.length, 1);
  assert.ok(model.current_version);
  const version = model.current_version;
  assert.equal(version.rfq_id, "1");
  assert.equal(version.rfq_code, "RFQ-00000001");
  assert.equal(version.round_no, 1);
  assert.equal(version.comparison_version_no, 1);
  assert.equal(version.status, "CURRENT");
  assert.equal(version.persisted_status, false);
  assert.equal(version.quote_inputs_current, true);
  assert.equal(version.input_drift, false);
  assert.equal(version.awardable_now, true);
  assert.equal(version.generated_by, EXPECTED_ACTOR);
  assert.equal(version.generated_at_shanghai, EXPECTED_OPERATION_TIME_SHANGHAI);
  assert.equal(version.request_id, EXPECTED_OPERATION_REQUEST_ID);

  assert.equal(version.comparison_rows.length, 4);
  assert.deepEqual(version.comparison_rows.map((row) => Number(row.material_id)), [533, 534, 535, 536]);
  assert.equal(new Set(version.comparison_rows.map((row) => stableId(row.comparison_line_id, "Comparison Line ID"))).size, 4);
  assert.ok(version.comparison_rows.every((row) => /^[0-9a-f]{64}$/.test(row.basis_digest)
    && row.basis_digest_source === "PERSISTED_DATABASE_FIELD / procurement_quote_comparisons.basis_digest"));

  assert.equal(version.fixed_quote_inputs.length, 8);
  assert.equal(new Set(version.fixed_quote_inputs.map((row) => stableId(row.comparison_candidate_id, "Comparison Candidate ID"))).size, 8);
  assert.equal(new Set(version.fixed_quote_inputs.map((row) => stableId(row.quote_line_id, "fixed Quote Line ID"))).size, 8);
  assert.ok(version.fixed_quote_inputs.every((row) => row.quote_version_no === 1 && row.quote_input_current === true));
  assert.equal(version.fixed_quote_inputs.filter((row) => row.quote_id === "1"
    && row.supplier_quote_reference === "UAT-Q-A-042576").length, 4);
  assert.equal(version.fixed_quote_inputs.filter((row) => row.quote_id === "2"
    && row.supplier_quote_reference === "UAT-Q-B-042576").length, 4);

  assert.match(version.output_summary.digest, /^[0-9a-f]{64}$/);
  assert.equal(version.output_summary.note, OUTPUT_NOTE);
  assert.equal(version.output_summary.canonical_rows.length, 8);
  assert.equal(canonicalDigest(version.output_summary.canonical_rows), version.output_summary.digest);
  const canonicalOrder = version.output_summary.canonical_rows.map((row) => [BigInt(row.material_id), BigInt(row.supplier_id), BigInt(row.comparison_line_id), BigInt(row.comparison_candidate_id)]);
  const sortedCanonicalOrder = [...canonicalOrder].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : left[2] < right[2] ? -1 : left[2] > right[2] ? 1 : left[3] < right[3] ? -1 : left[3] > right[3] ? 1 : 0);
  assert.deepEqual(canonicalOrder, sortedCanonicalOrder);
  assert.ok(version.output_summary.canonical_rows.every((row) => row.comparison_version_no === 1
    && stableId(row.fixed_quote_line_id, "canonical fixed Quote Line ID")
    && [533, 534, 535, 536].includes(Number(row.material_id))
    && [1, 2].includes(Number(row.supplier_id))));

  assert.equal(version.supplier_summaries.length, 2);
  const supplierA = version.supplier_summaries.find((row) => row.supplier_id === "1");
  const supplierB = version.supplier_summaries.find((row) => row.supplier_id === "2");
  assert.ok(supplierA && supplierB);
  assert.deepEqual({ quote_id: supplierA.quote_id, quote_version_no: supplierA.quote_version_no,
    reference: supplierA.supplier_quote_reference, currency: supplierA.currency_code,
    promised: supplierA.latest_promised_delivery_date, delivery_status: supplierA.delivery_status,
    delivery_delta_days: supplierA.delivery_delta_days, tax: supplierA.tax_included, freight: supplierA.freight_included }, {
    quote_id: "1", quote_version_no: 1, reference: "UAT-Q-A-042576", currency: "CNY",
    promised: "2026-10-20", delivery_status: "ON_TIME", delivery_delta_days: 10, tax: false, freight: false,
  });
  assert.deepEqual({ quote_id: supplierB.quote_id, quote_version_no: supplierB.quote_version_no,
    reference: supplierB.supplier_quote_reference, currency: supplierB.currency_code,
    promised: supplierB.latest_promised_delivery_date, delivery_status: supplierB.delivery_status,
    delivery_delta_days: supplierB.delivery_delta_days, tax: supplierB.tax_included, freight: supplierB.freight_included }, {
    quote_id: "2", quote_version_no: 1, reference: "UAT-Q-B-042576", currency: "CNY",
    promised: "2026-11-05", delivery_status: "LATE", delivery_delta_days: 6, tax: false, freight: false,
  });
  decimalEquals(supplierA.total_amount, 480, "Supplier A total");
  decimalEquals(supplierB.total_amount, 400, "Supplier B total");
  assert.ok(supplierA.payment_terms && supplierB.payment_terms && supplierA.valid_until && supplierB.valid_until);
  assert.equal(supplierA.delivery_explanation, "提前10天");
  assert.equal(supplierB.delivery_explanation, "延期6天");

  assert.equal(version.material_summaries.length, 4);
  assert.deepEqual(version.material_summaries.map((row) => Number(row.material_id)), [533, 534, 535, 536]);
  for (const material of version.material_summaries) {
    stableId(material.comparison_line_id, "Material Comparison Line ID");
    assert.equal(material.unit_code, "PCS");
    decimalEquals(material.requested_quantity, 10, "Material requested quantity");
    decimalEquals(material.amount_difference, 20, "Material amount difference");
    assert.equal(material.required_date, "2026-10-30");
    assert.equal(material.offers.length, 2);
    const offerA = material.offers.find((row) => row.supplier_id === "1");
    const offerB = material.offers.find((row) => row.supplier_id === "2");
    assert.ok(offerA && offerB);
    decimalEquals(offerA.unit_price, 12, "Supplier A unit price");
    decimalEquals(offerA.line_amount, 120, "Supplier A line amount");
    assert.deepEqual([offerA.price_rank, offerA.promised_delivery_date, offerA.delivery_status, offerA.delivery_delta_days], [2, "2026-10-20", "ON_TIME", 10]);
    decimalEquals(offerB.unit_price, 10, "Supplier B unit price");
    decimalEquals(offerB.line_amount, 100, "Supplier B line amount");
    assert.deepEqual([offerB.price_rank, offerB.promised_delivery_date, offerB.delivery_status, offerB.delivery_delta_days], [1, "2026-11-05", "LATE", 6]);
  }

  const difference = version.aggregate_differences;
  assert.ok(difference);
  assert.deepEqual({ higher: difference.higher_supplier_id, lower: difference.lower_supplier_id,
    percentage_basis: difference.percentage_basis_supplier_id, earlier: difference.earlier_supplier_id,
    later: difference.later_supplier_id, delivery_days: difference.delivery_day_difference,
    lowest: difference.lowest_price_supplier_id, on_time: difference.on_time_supplier_ids,
    late: difference.late_risk_supplier_ids }, {
    higher: "1", lower: "2", percentage_basis: "2", earlier: "1", later: "2", delivery_days: 16,
    lowest: "2", on_time: ["1"], late: ["2"],
  });
  decimalEquals(difference.amount_difference, 80, "aggregate amount difference");
  decimalEquals(difference.percentage_difference, 20, "aggregate percentage difference");

  assert.equal(version.operation_receipts.length, 1);
  const receipt = version.operation_receipts[0];
  assert.deepEqual({ actor: receipt.actor, occurred_at_shanghai: receipt.occurred_at_shanghai,
    request_id: receipt.request_id, result: receipt.result, old_version: receipt.old_version,
    new_version: receipt.new_version, comparison_version_no: receipt.comparison_version_no,
    event_count: receipt.event_count }, {
    actor: EXPECTED_ACTOR, occurred_at_shanghai: EXPECTED_OPERATION_TIME_SHANGHAI,
    request_id: EXPECTED_OPERATION_REQUEST_ID, result: "SUCCESS", old_version: 5, new_version: 6,
    comparison_version_no: 1, event_count: 4,
  });
  assert.equal(receipt.events.length, 4);
  assert.equal(new Set(receipt.events.map((event) => stableId(event.event_id, "Comparison Event ID"))).size, 4);
  assert.deepEqual(receipt.events.map((event) => Number(event.material_id)), [533, 534, 535, 536]);
  assert.ok(receipt.events.every((event) => stableId(event.comparison_line_id, "Event Comparison Line ID")));

  assert.deepEqual(model.generation, {
    enabled: false, already_generated: true, reason_code: "CURRENT_INPUT_ALREADY_GENERATED",
    label: "当前Quote输入已生成最新比价",
  });
  return version;
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

async function directPost(path, options) {
  if (!["/api/login", "/api/logout"].includes(path)) directBusinessWrites.push(`POST ${path}`);
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
  const loginPayload = await login.json();
  assert.deepEqual([loginPayload.user?.username, loginPayload.user?.role, loginPayload.user?.is_active,
    loginPayload.user?.must_change_password], [REQUIRED_USERNAME, "purchase", true, false]);
  authenticated = true;
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.ok(session.authenticated && session.csrf_token
    && session.user.permissions.includes("procurement.quote.compare")
    && session.user.permissions.includes("procurement.sourcing.award"));

  const detailResponse = await context.request.get(`${REQUIRED_ORIGIN}${DETAIL_API_PATH}`);
  assert.equal(detailResponse.status(), 200);
  const detail = (await detailResponse.json()).data;
  assert.deepEqual({ id: Number(detail.header.id), status: detail.header.status, version: Number(detail.header.version),
    round: Number(detail.header.round_no) }, { id: 1, status: "ISSUED", version: 6, round: 1 });
  assert.equal(detail.downstream_counts.quotes, 2);
  assert.equal(detail.downstream_counts.awards, 0);
  assert.equal(detail.downstream_counts.purchase_orders, 0);
  assert.equal(detail.quotes.length, 2);
  assert.equal(detail.quote_lines.length, 8);
  assert.equal(detail.comparisons.length, 4);
  assert.equal(detail.comparison_lines.length, 8);
  const currentVersion = assertComparisonReadModel(detail.comparison_read_model);

  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
  await page.getByRole("heading", { name: "服务端横向比价", exact: true }).waitFor();
  const generateButton = page.getByRole("button", { name: "当前Quote输入已生成最新比价", exact: true });
  await generateButton.waitFor();
  assert.equal(await generateButton.isDisabled(), true);
  const awardHeading = page.getByRole("heading", { name: "人工定标与撤销", exact: true });
  await awardHeading.waitFor();
  await page.getByRole("button", { name: "确认人工定标", exact: true }).waitFor();
  const desktopText = await page.locator("body").innerText();
  includesAll(desktopText, [
    "Round 1 / v6", "Comparison聚合读模型", "CURRENT / 当前比价版本", IDENTITY_NOTE, STATUS_NOTE,
    "当前Quote输入已生成最新比价", "Supplier ID 1", "Supplier ID 2", "ID 1 / v1", "ID 2 / v1",
    "UAT-Q-A-042576", "UAT-Q-B-042576", "480.00 CNY", "400.00 CNY", "2026-10-20",
    "2026-11-05", "ON_TIME / 满足需求日期", "LATE / 延期风险", "提前10天", "延期6天",
    "高 80.00 CNY", "高 20%", "早 16 天", "最低价格", "满足需求日期", "延期风险",
    "比价不等于定标；不自动产生Award。", "有效期", "付款条件", "未税 / 不含运费",
  ], "desktop Comparison aggregate");
  assert.equal(await page.locator(".comparison-supplier-card").count(), 2);
  assert.equal(await page.locator(".comparison-desktop tbody tr").count(), 4);
  await noOverflow(page, "desktop Comparison aggregate");

  const trace = page.locator("details.comparison-trace");
  assert.equal(await trace.count(), 1);
  await trace.locator("summary").click();
  const traceText = await trace.innerText();
  includesAll(traceText, [
    "固定输入追溯", "Quote ID 1 / v1", "Quote ID 2 / v1", "逐RFQ Line持久化输入摘要",
    "PERSISTED_DATABASE_FIELD / procurement_quote_comparisons.basis_digest", OUTPUT_NOTE,
    currentVersion.output_summary.digest, "8 条不可变输出行", "Comparison生成操作凭证",
    EXPECTED_ACTOR, EXPECTED_OPERATION_TIME_SHANGHAI, EXPECTED_OPERATION_REQUEST_ID,
    "v5 → v6", "4条Line级Event", "不是多次用户点击或多个Comparison Version",
    ...currentVersion.comparison_rows.map((row) => row.basis_digest),
  ], "Comparison trace receipt");
  assert.equal(await trace.locator(".comparison-digest-row").count(), 4);
  assert.equal(await trace.locator(".comparison-trace-grid article").count(), 8);
  assert.equal(await trace.locator(".comparison-operation li").count(), 4);
  assert.ok(await trace.locator(`code[title="${EXPECTED_OPERATION_REQUEST_ID}"]`).count() >= 1);
  assert.ok(await trace.getByRole("button", { name: /^复制/ }).count() >= 6);

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "390x844 Comparison aggregate");
  assert.equal(await page.locator(".comparison-desktop").isVisible(), false);
  assert.equal(await page.locator(".comparison-supplier-card").count(), 2);
  assert.equal(await page.locator(".comparison-material-card").count(), 4);
  assert.ok(await page.locator(".comparison-material-card").first().isVisible());
  const mobileText = await page.locator("body").innerText();
  includesAll(mobileText, ["480.00 CNY", "400.00 CNY", "Material ID 533", "Material ID 536",
    "Comparison Line ID", "固定Quote Line ID", EXPECTED_OPERATION_REQUEST_ID], "390x844 Comparison aggregate");
  assert.equal(await generateButton.isDisabled(), true);
  assert.ok(await awardHeading.isVisible());
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);

  const logout = await directPost("/api/logout", {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  assert.equal(logout.status(), 200);
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of ["RFQ-00000001", "UAT-Q-A-042576", "UAT-Q-B-042576",
    EXPECTED_OPERATION_REQUEST_ID, currentVersion.output_summary.digest, ...currentVersion.comparison_rows.map((row) => row.basis_digest)]) {
    assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);
  }

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "readonly UAT must preserve RFQ, Quotes, Comparison, Events, Bindings and counts");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  console.info(`RFQ_COMPARISON_AGGREGATE_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 rfq_version=6 comparison_version=1 comparison_lines=4 comparison_candidates=8 comparison_events=4 operation_request_id=${EXPECTED_OPERATION_REQUEST_ID} supplier_a_total=480.00 supplier_b_total=400.00 amount_difference=80.00 percentage_difference=20.00 delivery_difference_days=16 business_post=0 quote=2 award=0 po=0 desktop=1 mobile=1 session=0`);
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
