import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_DATABASE = "chenyida_erp";
const REQUIRED_DATABASE_HOST = "postgres";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRMATION = "MAIN_UAT_RFQ1_AWARD_HISTORY_TRACEABILITY_READ_ONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const RFQ_PATH = "/procurement/sourcing/1";
const DETAIL_API_PATH = "/api/procurement/rfqs/1";
const OUTPUT_DIGEST = "79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec";
const PERSISTED_AWARD_DIGEST = "7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55";
const AWARD_REQUEST_ID = "4634fff1-988d-465b-92c6-34ffe214ddda";
const AWARD_TIME_SHANGHAI = "2026-08-07 20:02:24.641511";
const AWARD_REASON = "交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。";
const EXPECTED_QUOTES = [
  { quote_id: "1", quote_version_no: 1, supplier_id: "1", supplier_code: "SUP-000001", supplier_name: "UAT快速交付供应商A-042576", reference: "UAT-Q-A-042576" },
  { quote_id: "2", quote_version_no: 1, supplier_id: "2", supplier_code: "SUP-000002", supplier_name: "UAT低价延期供应商B-042576", reference: "UAT-Q-B-042576" },
];
const EXPECTED_LINES = [
  { award_line_id: "1", rfq_line_id: "1", comparison_line_id: "1", candidate_id: "2", quote_line_id: "1", material_id: "533", material_code: "CYD-RB_PCB-000016" },
  { award_line_id: "2", rfq_line_id: "2", comparison_line_id: "2", candidate_id: "4", quote_line_id: "2", material_id: "534", material_code: "CYD-RB_SENSOR-000003" },
  { award_line_id: "3", rfq_line_id: "3", comparison_line_id: "3", candidate_id: "6", quote_line_id: "3", material_id: "535", material_code: "CYD-RB_CONN-000075" },
  { award_line_id: "4", rfq_line_id: "4", comparison_line_id: "4", candidate_id: "8", quote_line_id: "4", material_id: "536", material_code: "CYD-RB_METAL-000015" },
];

if (process.env.ERP_RFQ_AWARD_HISTORY_FIX31_UAT_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_AWARD_HISTORY_FIX31_UAT_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_RFQ_AWARD_HISTORY_DATABASE_URL || "";
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
if (!parsedDatabaseUrl || !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)
  || parsedDatabaseUrl.hostname !== REQUIRED_DATABASE_HOST || Number(parsedDatabaseUrl.port || "5432") !== 5432
  || process.env.ERP_RFQ_AWARD_HISTORY_DATABASE_NAME !== REQUIRED_DATABASE
  || decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")) !== REQUIRED_DATABASE) {
  throw new Error(`FIX-31 UAT database guards must target the exact ${REQUIRED_DATABASE} database`);
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
    } catch { /* continue through controlled module candidates */ }
  }
  throw new Error("Playwright is required in the FIX-31 readonly UAT runner");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  application_name: "rfq-award-history-fix31-uat-readonly",
});

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
    const quotes = (await client.query(`select quote.id::text quote_id,quote.quote_version_no::int,
      quote.supplier_id::text supplier_id,supplier.supplier_code,supplier.supplier_name,
      quote.supplier_quote_reference reference
      from procurement_supplier_quotes quote join suppliers supplier on supplier.id=quote.supplier_id
      where quote.rfq_id=1 order by quote.id`)).rows;
    const comparisonLines = (await client.query(`select comparison.id::text comparison_line_id,
      comparison.rfq_line_id::text rfq_line_id,comparison.comparison_version_no::int,
      comparison.basis_digest,rfq_line.material_id::text material_id,material.internal_material_code
      from procurement_quote_comparisons comparison
      join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
      join material_master material on material.id=rfq_line.material_id
      where comparison.rfq_id=1 and comparison.comparison_version_no=1
      order by comparison.id`)).rows;
    const award = (await client.query(`select award.id::text award_id,award.rfq_id::text rfq_id,
      award.status,award.version::int,award.award_digest,award.selected_by,
      to_char(award.selected_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') selected_at_shanghai,
      award.reason_code,award.reason,award.request_id::text request_id
      from procurement_sourcing_awards award where award.id=1 and award.rfq_id=1`)).rows[0];
    const awardLines = (await client.query(`select award_line.id::text award_line_id,
      award_line.rfq_line_id::text rfq_line_id,comparison.id::text comparison_line_id,
      comparison.comparison_version_no::int comparison_version_no,candidate.id::text candidate_id,
      quote_line.id::text quote_line_id,quote.id::text quote_id,quote.quote_version_no::int quote_version_no,
      award_line.supplier_id::text supplier_id,supplier.supplier_code,supplier.supplier_name,
      rfq_line.material_id::text material_id,material.internal_material_code,
      rfq_line.unit_id::text unit_id,unit.code unit_code,
      award_line.selected_quantity::text selected_quantity,award_line.selected_unit_price::text selected_unit_price,
      (award_line.selected_quantity*award_line.selected_unit_price)::numeric(30,6)::text line_amount,
      quote.currency_code,award_line.required_date::text required_date,
      award_line.promised_delivery_date::text promised_delivery_date,
      award_line.selection_reason,award_line.late_delivery_reason_code,
      award_line.late_delivery_reason,award_line.excess_quantity_reason
      from procurement_sourcing_award_lines award_line
      join procurement_sourcing_awards award on award.id=award_line.award_id and award.id=1 and award.rfq_id=1
      join procurement_rfq_lines rfq_line on rfq_line.id=award_line.rfq_line_id and rfq_line.rfq_id=award.rfq_id
      join material_master material on material.id=rfq_line.material_id
      join units unit on unit.id=rfq_line.unit_id
      join procurement_quote_comparisons comparison on comparison.id=award_line.comparison_id
        and comparison.rfq_id=award.rfq_id and comparison.rfq_line_id=award_line.rfq_line_id
      join procurement_quote_comparison_lines candidate on candidate.comparison_id=award_line.comparison_id
        and candidate.quote_line_id=award_line.selected_quote_line_id and candidate.supplier_id=award_line.supplier_id
      join procurement_supplier_quote_lines quote_line on quote_line.id=award_line.selected_quote_line_id
        and quote_line.rfq_line_id=award_line.rfq_line_id and quote_line.material_id=rfq_line.material_id
        and quote_line.unit_id=rfq_line.unit_id
      join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
        and quote.rfq_id=award.rfq_id and quote.supplier_id=award_line.supplier_id
      join suppliers supplier on supplier.id=award_line.supplier_id
      order by award_line.id`)).rows;
    const awardEvents = (await client.query(`select event.id::text event_id,event.award_id::text award_id,
      event.event_type,event.actor,event.request_id::text request_id,event.result,event.reason,
      to_char(event.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai,
      event.credential_version::int credential_version,event.old_version::int old_version,
      event.new_version::int new_version,event.from_status,event.to_status
      from procurement_sourcing_events event
      where event.rfq_id=1 and event.award_id=1 and event.event_type='AWARDED'
      order by event.id`)).rows;
    const awardAudits = (await client.query(`select audit.id::text audit_id,audit.username actor,
      audit.request_id::text request_id,audit.result,audit.old_version::int old_version,
      audit.new_version::int new_version,
      to_char(audit.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai
      from audit_log audit join procurement_sourcing_awards award
        on award.id=1 and award.rfq_id=1 and award.request_id=audit.request_id
        and award.selected_by=audit.username and award.selected_at=audit.created_at
      where audit.route_code='PROCUREMENT_SOURCING' and audit.action='SOURCING_AWARDED'
        and audit.result='success' and audit.detail->>'object_id'='1'
      order by audit.id`)).rows;
    const counts = (await client.query(`select
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1) quotes,
      (select count(distinct comparison_version_no)::int from procurement_quote_comparisons where rfq_id=1) comparison_versions,
      (select count(*)::int from procurement_quote_comparisons where rfq_id=1 and comparison_version_no=1) comparison_lines,
      (select count(*)::int from procurement_sourcing_awards where rfq_id=1) awards,
      (select count(*)::int from procurement_sourcing_award_lines line
        join procurement_sourcing_awards award on award.id=line.award_id where award.rfq_id=1) award_lines,
      (select count(*)::int from procurement_sourcing_events
        where rfq_id=1 and award_id=1 and event_type='AWARDED') award_events,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
    await client.query("commit");
    return { connection, rfq, quotes, comparison_lines: comparisonLines, award, award_lines: awardLines, award_events: awardEvents, award_audits: awardAudits, counts };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertProtectedState(state, stage, expectedSessions = 0) {
  assert.deepEqual(state.connection, {
    database_name: REQUIRED_DATABASE,
    transaction_read_only: "on",
    active_purchase_sessions: expectedSessions,
  }, `${stage} connection/session`);
  assert.deepEqual(state.rfq, {
    id: "1", rfq_code: "RFQ-00000001", round_no: 1, status: "CLOSED", version: 7,
  }, `${stage} RFQ`);
  assert.deepEqual(state.counts, {
    quotes: 2, comparison_versions: 1, comparison_lines: 4,
    awards: 1, award_lines: 4, award_events: 1, purchase_orders: 0,
  }, `${stage} protected counts`);
  assert.deepEqual(state.quotes, EXPECTED_QUOTES, `${stage} fixed Quotes`);
  assert.deepEqual(state.comparison_lines.map((line) => ({
    comparison_line_id: line.comparison_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_version_no: line.comparison_version_no,
    material_id: line.material_id,
    internal_material_code: line.internal_material_code,
  })), EXPECTED_LINES.map((line) => ({
    comparison_line_id: line.comparison_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_version_no: 1,
    material_id: line.material_id,
    internal_material_code: line.material_code,
  })), `${stage} Comparison Version 1`);
  assert.ok(state.comparison_lines.every((line) => /^[0-9a-f]{64}$/.test(line.basis_digest)), `${stage} Comparison basis digests`);
  assert.deepEqual(state.award, {
    award_id: "1", rfq_id: "1", status: "AWARDED", version: 1,
    award_digest: PERSISTED_AWARD_DIGEST, selected_by: REQUIRED_USERNAME,
    selected_at_shanghai: AWARD_TIME_SHANGHAI, reason_code: "DELIVERY_PRIORITY",
    reason: AWARD_REASON, request_id: AWARD_REQUEST_ID,
  }, `${stage} Award aggregate`);
  assert.deepEqual(state.award_lines.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    comparison_version_no: line.comparison_version_no,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: line.quote_id,
    quote_version_no: line.quote_version_no,
    supplier_id: line.supplier_id,
    supplier_code: line.supplier_code,
    supplier_name: line.supplier_name,
    material_id: line.material_id,
    internal_material_code: line.internal_material_code,
    selected_quantity: line.selected_quantity,
    selected_unit_price: line.selected_unit_price,
    line_amount: line.line_amount,
    currency_code: line.currency_code,
  })), EXPECTED_LINES.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    comparison_version_no: 1,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: "1",
    quote_version_no: 1,
    supplier_id: "1",
    supplier_code: "SUP-000001",
    supplier_name: EXPECTED_QUOTES[0].supplier_name,
    material_id: line.material_id,
    internal_material_code: line.material_code,
    selected_quantity: "10.000000",
    selected_unit_price: "12.000000",
    line_amount: "120.000000",
    currency_code: "CNY",
  })), `${stage} Award Lines`);
  assert.equal(state.award_lines.every((line) => line.unit_code === "PCS"
    && line.required_date === "2026-10-30" && line.promised_delivery_date === "2026-10-20"
    && line.selection_reason === "" && line.late_delivery_reason_code === null
    && line.late_delivery_reason === "" && line.excess_quantity_reason === ""), true, `${stage} Award Line immutable facts`);
  assert.deepEqual(state.award_events, [{
    event_id: "9", award_id: "1", event_type: "AWARDED", actor: REQUIRED_USERNAME,
    request_id: AWARD_REQUEST_ID, result: "SUCCESS", reason: AWARD_REASON,
    occurred_at_shanghai: AWARD_TIME_SHANGHAI, credential_version: 1,
    old_version: null, new_version: null, from_status: null, to_status: null,
  }], `${stage} Award Event`);
  assert.deepEqual(state.award_audits, [{
    audit_id: "1469", actor: REQUIRED_USERNAME, request_id: AWARD_REQUEST_ID,
    result: "success", old_version: 6, new_version: 7,
    occurred_at_shanghai: AWARD_TIME_SHANGHAI,
  }], `${stage} exact Award Audit`);
}

function canonicalDigest(value) {
  const normalize = (input) => Array.isArray(input)
    ? input.map(normalize)
    : input && typeof input === "object"
      ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]))
      : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function assertDetail(detail, databaseState) {
  assert.deepEqual({
    id: String(detail.header.id), code: detail.header.rfq_code, round: Number(detail.header.round_no),
    status: detail.header.status, version: Number(detail.header.version),
  }, { id: "1", code: "RFQ-00000001", round: 1, status: "CLOSED", version: 7 });
  assert.deepEqual(detail.downstream_counts, { quotes: 2, awards: 1, purchase_orders: 0 });
  const comparison = detail.comparison_read_model.current_version;
  assert.ok(comparison);
  assert.deepEqual({
    version: comparison.comparison_version_no,
    status: comparison.status,
    awardable_now: comparison.awardable_now,
    input_drift: comparison.input_drift,
    digest: comparison.output_summary.digest,
  }, { version: 1, status: "CURRENT", awardable_now: false, input_drift: false, digest: OUTPUT_DIGEST });
  assert.equal(comparison.awardability_note, "Comparison仍是当前版本，但RFQ已完成定标，不可再次创建Award。");

  const history = detail.award_history;
  assert.ok(history);
  assert.deepEqual(history.identity, {
    award_id: "1",
    display_identity: "定标 #1",
    has_business_number: false,
    business_number: null,
    business_number_note: "未设置独立Award业务编号。",
    has_version: true,
    version: 1,
    version_note: "Award有独立Version字段；AWARDED事实一次性不可变，只有合法撤销会推进Version。",
    status: "AWARDED",
    status_source: "PERSISTED_DATABASE_FIELD / procurement_sourcing_awards.status",
    immutable_semantics: "Award聚合与四条Award Line是一次用户定标事务形成的不可变事实；不得原地改写。",
    rfq_id: "1",
    rfq_code: "RFQ-00000001",
    round_no: 1,
    rfq_submitted_cas: 6,
    rfq_submitted_cas_source: "EXACT_SUCCESS_AUDIT / audit_log.old_version",
    rfq_current_cas: 7,
    rfq_current_cas_source: "PERSISTED_DATABASE_FIELD / procurement_rfqs.version",
    comparison_version_no: 1,
    comparison_status: "CURRENT",
    comparison_status_source: "SERVER_READ_PROJECTION / latest immutable Comparison facts + current Quote input validity and basis drift checks",
    comparison_output_digest: OUTPUT_DIGEST,
  });
  assert.deepEqual(history.fixed_quotes.map((quote) => ({
    quote_id: quote.quote_id,
    quote_version_no: quote.quote_version_no,
    supplier_id: quote.supplier_id,
    supplier_code: quote.supplier_code,
    supplier_name: quote.supplier_name,
    reference: quote.supplier_quote_reference,
    currency_code: quote.currency_code,
  })), EXPECTED_QUOTES.map((quote) => ({ ...quote, currency_code: "CNY" })));
  assert.deepEqual(history.lines.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    candidate_id: line.comparison_candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: line.quote_id,
    quote_version_no: line.quote_version_no,
    supplier_id: line.supplier_id,
    material_id: line.material_id,
    quantity: line.selected_quantity,
    unit_price: line.selected_unit_price,
    amount: line.line_amount,
  })), EXPECTED_LINES.map((line) => ({
    award_line_id: line.award_line_id,
    rfq_line_id: line.rfq_line_id,
    comparison_line_id: line.comparison_line_id,
    candidate_id: line.candidate_id,
    quote_line_id: line.quote_line_id,
    quote_id: "1",
    quote_version_no: 1,
    supplier_id: "1",
    material_id: line.material_id,
    quantity: "10.000000",
    unit_price: "12.000000",
    amount: "120.000000",
  })));
  assert.deepEqual(history.summary.supplier_summaries.map((supplier) => ({
    supplier_id: supplier.supplier_id,
    line_count: supplier.award_line_count,
    total: supplier.total_amount,
    currency: supplier.currency_code,
  })), [
    { supplier_id: "1", line_count: 4, total: "480.000000", currency: "CNY" },
    { supplier_id: "2", line_count: 0, total: "0.000000", currency: "CNY" },
  ]);
  assert.deepEqual({
    line_count: history.summary.award_line_count,
    split: history.summary.split_award_lines,
    duplicate_material: history.summary.duplicate_material,
  }, { line_count: 4, split: false, duplicate_material: false });
  assert.deepEqual(history.reason, { code: "DELIVERY_PRIORITY", text: AWARD_REASON, normalized_text: AWARD_REASON });
  assert.deepEqual(history.persisted_award_digest, {
    value: PERSISTED_AWARD_DIGEST,
    source: "PERSISTED_DATABASE_FIELD / procurement_sourcing_awards.award_digest",
    note: "这是创建时RFQ、Comparison、原因和选择请求的持久化Award摘要；不包含数据库生成的Award/Line ID，不冒充decision digest。",
  });
  assert.equal(history.decision_digest.source, "DETERMINISTIC_RECALCULATION");
  assert.equal(history.decision_digest.persisted, false);
  assert.equal(history.decision_digest.canonical_rule, "AWARD_DECISION_V1");
  assert.equal(history.decision_digest.note, "确定性决策摘要，由不可变Award事实重算；不是伪造的历史持久化字段。");
  assert.match(history.decision_digest.value, /^[0-9a-f]{64}$/);
  assert.notEqual(history.decision_digest.value, PERSISTED_AWARD_DIGEST);
  assert.equal(canonicalDigest(history.decision_digest.canonical_facts), history.decision_digest.value);
  assert.deepEqual({
    canonical_rule: history.decision_digest.canonical_facts.canonical_rule,
    award_id: history.decision_digest.canonical_facts.award_id,
    rfq: history.decision_digest.canonical_facts.rfq,
    comparison: history.decision_digest.canonical_facts.comparison,
    reason_code: history.decision_digest.canonical_facts.reason_code,
    reason_normalized: history.decision_digest.canonical_facts.reason_normalized,
  }, {
    canonical_rule: "AWARD_DECISION_V1",
    award_id: "1",
    rfq: { rfq_id: "1", rfq_code: "RFQ-00000001", round_no: 1 },
    comparison: { comparison_version_no: 1, output_digest: OUTPUT_DIGEST },
    reason_code: "DELIVERY_PRIORITY",
    reason_normalized: AWARD_REASON,
  });
  assert.deepEqual(history.decision_digest.canonical_facts.lines.map((line) => ({
    award_line_id: line.award_line_id,
    comparison_line_id: line.comparison_line_id,
    comparison_candidate_id: line.comparison_candidate_id,
    quote_id: line.quote_id,
    quote_version_no: line.quote_version_no,
    quote_line_id: line.quote_line_id,
    supplier_id: line.supplier_id,
    material_id: line.material_id,
    unit_id: line.unit_id,
    quantity: line.quantity,
    unit_price: line.unit_price,
    amount: line.amount,
    currency_code: line.currency_code,
    selection_reason_normalized: line.selection_reason_normalized,
    late_delivery_reason_code: line.late_delivery_reason_code,
    late_delivery_reason_normalized: line.late_delivery_reason_normalized,
    excess_quantity_reason_normalized: line.excess_quantity_reason_normalized,
  })), databaseState.award_lines.map((line) => ({
    award_line_id: line.award_line_id,
    comparison_line_id: line.comparison_line_id,
    comparison_candidate_id: line.candidate_id,
    quote_id: line.quote_id,
    quote_version_no: line.quote_version_no,
    quote_line_id: line.quote_line_id,
    supplier_id: line.supplier_id,
    material_id: line.material_id,
    unit_id: line.unit_id,
    quantity: line.selected_quantity,
    unit_price: line.selected_unit_price,
    amount: line.line_amount,
    currency_code: line.currency_code,
    selection_reason_normalized: line.selection_reason,
    late_delivery_reason_code: line.late_delivery_reason_code,
    late_delivery_reason_normalized: line.late_delivery_reason,
    excess_quantity_reason_normalized: line.excess_quantity_reason,
  })));
  assert.deepEqual({
    event_id: history.operation_receipt.event_id,
    event_type: history.operation_receipt.event_type,
    event_count: history.operation_receipt.event_count,
    operations: history.operation_receipt.user_operation_count,
    line_count: history.operation_receipt.award_line_count,
    actor: history.operation_receipt.actor,
    time: history.operation_receipt.occurred_at_shanghai,
    request_id: history.operation_receipt.request_id,
    result: history.operation_receipt.result,
    event_transition: history.operation_receipt.version_transition_recorded,
    event_old: history.operation_receipt.event_old_version,
    event_new: history.operation_receipt.event_new_version,
  }, {
    event_id: "9", event_type: "AWARDED", event_count: 1, operations: 1, line_count: 4,
    actor: REQUIRED_USERNAME, time: AWARD_TIME_SHANGHAI, request_id: AWARD_REQUEST_ID,
    result: "SUCCESS", event_transition: false, event_old: null, event_new: null,
  });
  assert.deepEqual(history.operation_receipt.cas_evidence, {
    authority: "EXACT_SUCCESS_AUDIT",
    audit_id: "1469",
    old_version: 6,
    audit_new_version: 7,
    new_version: 7,
    submitted_source: "同request_id唯一成功Audit的old_version",
    current_source: "当前procurement_rfqs.version",
    note: "Audit独立记录同一次请求的RFQ CAS；它不是Award Event字段。",
  });
  assert.deepEqual({
    comparison: history.projections.comparison_status,
    awardable: history.projections.awardable_now,
    po_convertible: history.projections.po_convertible_now,
    po_count: history.projections.po_count,
    conditions: history.projections.po_conversion_conditions,
  }, {
    comparison: "CURRENT",
    awardable: false,
    po_convertible: true,
    po_count: 0,
    conditions: {
      award_status_awarded: true,
      rfq_status_closed: true,
      award_lines_complete: true,
      references_complete: true,
      source_purchase_request_accepted: true,
      purchase_order_count_zero: true,
    },
  });
  return history;
}

function includesAll(text, values, stage) {
  for (const value of values) assert.ok(text.includes(String(value)), `${stage} missing ${value}`);
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

async function assertHistoryPage(page, history, mode) {
  await page.getByRole("heading", { name: "RFQ-00000001 · Round 1", exact: true }).waitFor();
  await page.getByRole("heading", { name: "定标 #1", exact: true }).waitFor();
  const panel = page.locator('[data-award-history="server"][data-award-id="1"]');
  await panel.waitFor();
  const text = await panel.innerText();
  includesAll(text, [
    "Award稳定数据库ID", "未设置独立Award业务编号。", "Award Version", "v1",
    "AWARDED", "RFQ", "ID 1 / RFQ-00000001", "Round 1", "v6", "v7",
    "Comparison Version", "CURRENT", OUTPUT_DIGEST,
    "Quote ID 1 / v1 / Supplier A", "Quote ID 2 / v1 / Supplier B",
    EXPECTED_QUOTES[0].supplier_name, EXPECTED_QUOTES[1].supplier_name,
    ...EXPECTED_LINES.flatMap((line) => [
      `Award Line ID ${line.award_line_id}`,
      `Comparison Line ${line.comparison_line_id}`,
      `Candidate ID ${line.candidate_id}`,
      `Quote Line ID ${line.quote_line_id}`,
      `Material ID ${line.material_id}`,
      line.material_code,
    ]),
    "10 PCS", "12.00 CNY", "120.00 CNY", "480.00 CNY", "0.00 CNY",
    "Award Line 4", "Award Line 0", "无拆单", "无重复Material",
    "DELIVERY_PRIORITY", AWARD_REASON, PERSISTED_AWARD_DIGEST,
    "AWARD_DECISION_V1", history.decision_digest.value,
    "确定性决策摘要，由不可变Award事实重算；不是伪造的历史持久化字段。",
    "Event", "ID 9 / AWARDED", "Event数量", "用户操作次数",
    REQUIRED_USERNAME, AWARD_TIME_SHANGHAI, AWARD_REQUEST_ID, "SUCCESS",
    "历史Award Event未记录版本转换。", "Audit记录 v6 → v7。",
    "awardable_now", "false",
    "Comparison仍是当前版本，但RFQ已完成定标，不可再次创建Award。",
    "po_convertible_now", "true", "当前PO计数 0",
    "转PO入口", "本页只显示资格，不提供链接、按钮或业务POST。",
  ], `${mode} Award history`);
  assert.equal(text.includes("vnull"), false);
  assert.equal((await page.locator("body").innerText()).includes("允许进入定标"), false);
  assert.equal(await page.locator("form.award-selection-form").count(), 0);
  assert.equal(await page.getByRole("button", { name: "打开正式定标确认窗口", exact: true }).count(), 0);
  assert.equal(await page.locator(".award-confirm-dialog").count(), 0);
  assert.equal(await page.getByRole("button", { name: /撤销|转PO|采购订单/ }).count(), 0);
  assert.equal(await page.getByRole("link", { name: /转PO|采购订单/ }).count(), 0);
  const selector = mode === "desktop" ? ".award-history-desktop" : ".award-history-mobile";
  const hiddenSelector = mode === "desktop" ? ".award-history-mobile" : ".award-history-desktop";
  assert.equal(await panel.locator(selector).isVisible(), true);
  assert.equal(await panel.locator(hiddenSelector).isVisible(), false);
  assert.deepEqual(await panel.locator(`${selector} [data-award-line-id]`).evaluateAll(
    (rows) => rows.map((row) => row.getAttribute("data-award-line-id")),
  ), ["1", "2", "3", "4"]);
  await noOverflow(page, `${mode} Award history`);
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
      await directPost("/api/logout", {
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

  const login = await directPost("/api/login", { headers: { Origin: REQUIRED_ORIGIN }, data: credential });
  assert.equal(login.status(), 200);
  authenticated = true;
  const loginPayload = await login.json();
  assert.deepEqual([
    loginPayload.user?.username,
    loginPayload.user?.role,
    loginPayload.user?.is_active,
    loginPayload.user?.must_change_password,
  ], [REQUIRED_USERNAME, "purchase", true, false]);
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.ok(session.authenticated && session.csrf_token
    && session.user.username === REQUIRED_USERNAME && session.user.role === "purchase");

  const detailResponse = await context.request.get(`${REQUIRED_ORIGIN}${DETAIL_API_PATH}`);
  assert.equal(detailResponse.status(), 200);
  const detail = (await detailResponse.json()).data;
  const history = assertDetail(detail, before);

  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}`, { waitUntil: "domcontentloaded" });
  await assertHistoryPage(page, history, "desktop");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);

  await page.setViewportSize({ width: 390, height: 844 });
  await assertHistoryPage(page, history, "mobile");
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertHistoryPage(page, history, "mobile");
  assert.ok((await page.locator(".award-history").innerText()).includes(history.decision_digest.value));

  await page.goto(`${REQUIRED_ORIGIN}${RFQ_PATH}?history_reopen=1`, { waitUntil: "domcontentloaded" });
  await assertHistoryPage(page, history, "mobile");
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertHistoryPage(page, history, "desktop");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);

  const during = await readProtectedState();
  assertProtectedState(during, "during UAT", 1);
  const logout = await directPost("/api/logout", {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  assert.equal(logout.status(), 200);
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cydAuthState === "anonymous");
  const anonymousText = await page.locator("body").innerText();
  for (const protectedValue of [
    "RFQ-00000001", OUTPUT_DIGEST, PERSISTED_AWARD_DIGEST,
    history.decision_digest.value, AWARD_REASON, AWARD_REQUEST_ID,
  ]) assert.equal(anonymousText.includes(protectedValue), false, `protected value remained after logout: ${protectedValue}`);

  const after = await readProtectedState();
  assertProtectedState(after, "after UAT");
  assert.deepEqual(after, before, "FIX-31 readonly UAT must preserve the exact protected state");
  assert.deepEqual(businessWrites, []);
  assert.deepEqual(directBusinessWrites, []);
  assert.deepEqual(forbiddenGets, []);
  assert.deepEqual(browserErrors, []);
  console.info(`RFQ_AWARD_HISTORY_FIX31_UAT_READONLY_OK database=${REQUIRED_DATABASE} actor=${REQUIRED_USERNAME} rfq=1 rfq_version=7 comparison_version=1 award=1 award_line=4 award_event=1 po=0 awardable_now=false po_convertible_now=true decision_digest=${history.decision_digest.value} business_post=0 desktop=1 mobile=1 refresh=1 reopen=1 session=0`);
} finally {
  try {
    await logoutIfNeeded();
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      const finalState = await readProtectedState();
      assert.equal(finalState.connection.active_purchase_sessions, 0, "cleanup must leave zero active Purchase sessions");
    } finally {
      await pool.end();
    }
  }
}
