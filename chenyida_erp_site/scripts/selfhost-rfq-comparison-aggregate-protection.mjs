import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_CONFIRMATION = "MAIN_UAT_RFQ1_COMPARISON_AGGREGATE_PROTECTION_READONLY";
const EXPECTED_DATABASE = "chenyida_erp";
const EXPECTED_ACTOR = "uat_20260729_purchase";
const EXPECTED_OPERATION_TIME_SHANGHAI = "2026-08-06 17:35:19.942600";
const EXPECTED_OPERATION_REQUEST_ID = "69b1b561-c460-4e98-9560-26dfea17b30f";
const EXPECTED_BINDINGS = [
  ["1", 1, 1, 533, "224d1965-44ef-4c3e-901e-1926b6b07ff8"],
  ["2", 1, 2, 534, "43ca04d8-9933-4dac-ba21-b7fb85741830"],
  ["3", 1, 3, 535, "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e"],
  ["4", 1, 4, 536, "9659ad2d-406a-4c4c-b575-51329badc63f"],
  ["5", 2, 1, 533, "45a3daf1-4e97-4a01-a94d-1f3089d3961b"],
  ["6", 2, 2, 534, "5bd2ced5-6696-4e69-a833-e886cf5e273f"],
  ["7", 2, 3, 535, "3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6"],
  ["8", 2, 4, 536, "5432e7fc-463a-4cea-99fe-f3db8cf0af83"],
];

if (process.env.ERP_RFQ_COMPARISON_AGGREGATE_PROTECTION_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_COMPARISON_AGGREGATE_PROTECTION_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_COMPARISON_AGGREGATE_DATABASE_URL || "";
const expectedDatabaseName = (process.env.ERP_COMPARISON_AGGREGATE_DATABASE_NAME || "").trim();
const restoreDatabasePattern = /^rfq_comparison_aggregate_restore_\d{8}$/;
if (!databaseUrl || (expectedDatabaseName !== EXPECTED_DATABASE && !restoreDatabasePattern.test(expectedDatabaseName))) {
  throw new Error(`ERP_COMPARISON_AGGREGATE_DATABASE_URL must target ${EXPECTED_DATABASE} or an exact Comparison aggregate restore database`);
}
const connectionUrl = new URL(databaseUrl);
assert.equal(decodeURIComponent(connectionUrl.pathname.replace(/^\//, "")), expectedDatabaseName);

const args = process.argv.slice(2);
let captureBaseline = false;
let expectedHash = (process.env.ERP_COMPARISON_AGGREGATE_EXPECTED_HASH || "").trim();
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--capture-baseline") {
    if (captureBaseline) throw new Error("--capture-baseline may only be provided once");
    captureBaseline = true;
  } else if (argument === "--expected-hash") {
    if (index + 1 >= args.length || expectedHash) throw new Error("--expected-hash requires one unique SHA-256 value");
    expectedHash = args[index + 1];
    index += 1;
  } else if (argument.startsWith("--expected-hash=")) {
    if (expectedHash) throw new Error("--expected-hash may only be provided once");
    expectedHash = argument.slice("--expected-hash=".length);
  } else throw new Error(`unsupported argument: ${argument}`);
}
if (expectedHash && !/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error("expected hash must be one lowercase SHA-256 digest");
if (captureBaseline === Boolean(expectedHash)) throw new Error("use exactly one of --capture-baseline or --expected-hash");

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
assert.equal(migrationNames.length, 39);
assert.equal(migrationNames.at(-1), "0039_rfq_traceability.sql");
const migrationManifest = new Map(await Promise.all(migrationNames.map(async (name) => [
  name,
  createHash("sha256").update(await readFile(new URL(name, migrationDirectory))).digest("hex"),
])));
assert.equal(migrationManifest.get("0039_rfq_traceability.sql"), "3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37");

const canonicalDigest = (value) => {
  const normalize = (input) => Array.isArray(input)
    ? input.map(normalize)
    : input && typeof input === "object"
      ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]))
      : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
};
const shanghai = (column) => `to_char(${column} at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US')`;
const pool = new Pool({ connectionString: connectionUrl.toString(), max: 1, application_name: "rfq-comparison-aggregate-protection" });
const client = await pool.connect();

try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  const connection = (await client.query("select current_database() database_name,current_setting('transaction_read_only') transaction_read_only")).rows[0];
  assert.deepEqual(connection, { database_name: expectedDatabaseName, transaction_read_only: "on" });
  const ledger = (await client.query("select version,checksum from schema_migrations order by version")).rows;
  assert.deepEqual(ledger, migrationNames.map((version) => ({ version, checksum: migrationManifest.get(version) })));

  const rfq = (await client.query(`select id::int,rfq_code,purchase_request_id::int,round_no::int,status,
      version::int,traceability_version::int,response_deadline::text response_deadline_text,currency_code,
      issued_by,${shanghai("issued_at")} issued_at_shanghai,${shanghai("updated_at")} updated_at_shanghai
    from procurement_rfqs where id=1`)).rows[0];
  assert.equal(rfq.id, 1);
  assert.equal(rfq.rfq_code, "RFQ-00000001");
  assert.equal(rfq.purchase_request_id, 1);
  assert.equal(rfq.round_no, 1);
  assert.equal(rfq.status, "ISSUED");
  assert.equal(rfq.version, 6);
  assert.equal(rfq.traceability_version, 1);
  assert.equal(rfq.currency_code, "CNY");
  assert.equal(rfq.issued_by, EXPECTED_ACTOR);
  assert.equal(rfq.updated_at_shanghai, EXPECTED_OPERATION_TIME_SHANGHAI);

  const lines = (await client.query(`select line.id::int,line.purchase_request_line_id::int,line.line_no::int,
      line.material_id::int,material.internal_material_code,material.standard_name,line.unit_id::int,unit.code unit_code,
      line.requested_quantity::numeric(24,6)::text,line.required_date::text
    from procurement_rfq_lines line join material_master material on material.id=line.material_id
    join units unit on unit.id=line.unit_id where line.rfq_id=1 order by line.id`)).rows;
  assert.deepEqual(lines.map(({ id, line_no, material_id, unit_code, requested_quantity, required_date }) => ({ id, line_no, material_id, unit_code, requested_quantity, required_date })), [
    { id: 1, line_no: 1, material_id: 533, unit_code: "PCS", requested_quantity: "10.000000", required_date: "2026-10-30" },
    { id: 2, line_no: 2, material_id: 534, unit_code: "PCS", requested_quantity: "10.000000", required_date: "2026-10-30" },
    { id: 3, line_no: 3, material_id: 535, unit_code: "PCS", requested_quantity: "10.000000", required_date: "2026-10-30" },
    { id: 4, line_no: 4, material_id: 536, unit_code: "PCS", requested_quantity: "10.000000", required_date: "2026-10-30" },
  ]);
  assert.ok(lines.every((line) => typeof line.internal_material_code === "string" && line.internal_material_code.length > 0));

  const suppliers = (await client.query(`select invitation.id::int,invitation.supplier_id::int,supplier.supplier_code,
      supplier.supplier_name,supplier.status supplier_status,invitation.status invitation_status,
      case when invitation.responded_at is null then null else ${shanghai("invitation.responded_at")} end responded_at_shanghai
    from procurement_rfq_suppliers invitation join suppliers supplier on supplier.id=invitation.supplier_id
    where invitation.rfq_id=1 and invitation.supplier_id in (1,2) order by invitation.supplier_id`)).rows;
  assert.deepEqual(suppliers.map(({ supplier_id, supplier_code, supplier_status, invitation_status }) => ({ supplier_id, supplier_code, supplier_status, invitation_status })), [
    { supplier_id: 1, supplier_code: "SUP-000001", supplier_status: "ACTIVE", invitation_status: "RESPONDED" },
    { supplier_id: 2, supplier_code: "SUP-000002", supplier_status: "ACTIVE", invitation_status: "RESPONDED" },
  ]);
  assert.ok(suppliers.every((supplier) => supplier.responded_at_shanghai));

  const bindings = (await client.query(`select binding.id::text binding_id,binding.rfq_supplier_id::int,
      binding.rfq_line_id::int,binding.supplier_id::int,binding.material_id::int,
      binding.supplier_mapping_version_id::int,binding.mapping_uid::text mapping_id,
      binding.mapping_version_no::int mapping_version,binding.mapping_row_version::int mapping_row_version,
      binding.mapping_content_digest,binding.binding_source,binding.binding_status,
      mapping.status current_mapping_status,mapping.mapping_version_no::int current_mapping_version,
      mapping.version::int current_mapping_row_version,mapping.content_digest current_mapping_content_digest
    from procurement_rfq_supplier_line_mapping_bindings binding
    join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
    where binding.rfq_id=1 order by binding.id`)).rows;
  assert.equal(bindings.length, 8);
  assert.deepEqual(bindings.map(({ binding_id, supplier_id, rfq_line_id, material_id, mapping_id }) => [binding_id, supplier_id, rfq_line_id, material_id, mapping_id]), EXPECTED_BINDINGS);
  assert.ok(bindings.every((binding) => binding.binding_source === "LEGACY_DRAFT_CONFIRMATION"
    && binding.binding_status === "ACTIVE" && binding.current_mapping_status === "ACTIVE"
    && binding.current_mapping_version === binding.mapping_version
    && binding.current_mapping_row_version === binding.mapping_row_version
    && binding.current_mapping_content_digest === binding.mapping_content_digest));

  const quotes = (await client.query(`select quote.id::text,quote.rfq_id::int,quote.supplier_id::int,
      supplier.supplier_code,supplier.supplier_name,quote.quote_version_no::int,
      quote.supplier_quote_reference,quote.status,quote.currency_code,quote.valid_until::text,
      quote.tax_included,quote.freight_included,quote.payment_terms,quote.quote_digest,quote.version::int,
      quote.recorded_by,${shanghai("quote.recorded_at")} recorded_at_shanghai,quote.request_id::text
    from procurement_supplier_quotes quote join suppliers supplier on supplier.id=quote.supplier_id
    where quote.rfq_id=1 order by quote.id`)).rows;
  assert.deepEqual(quotes.map(({ id, supplier_id, quote_version_no, supplier_quote_reference, status, currency_code }) => ({ id, supplier_id, quote_version_no, supplier_quote_reference, status, currency_code })), [
    { id: "1", supplier_id: 1, quote_version_no: 1, supplier_quote_reference: "UAT-Q-A-042576", status: "SUBMITTED", currency_code: "CNY" },
    { id: "2", supplier_id: 2, quote_version_no: 1, supplier_quote_reference: "UAT-Q-B-042576", status: "SUBMITTED", currency_code: "CNY" },
  ]);
  assert.ok(quotes.every((quote) => quote.tax_included === false && quote.freight_included === false
    && typeof quote.payment_terms === "string" && quote.payment_terms.trim().length > 0
    && /^[0-9a-f]{64}$/.test(quote.quote_digest) && quote.recorded_by === EXPECTED_ACTOR
    && /^[0-9a-f-]{36}$/.test(quote.request_id)));

  const quoteLines = (await client.query(`select quote_line.id::text,quote_line.quote_id::text,
      quote.supplier_id::int,quote.quote_version_no::int,quote.supplier_quote_reference,
      quote_line.rfq_line_id::int,rfq_line.line_no::int,quote_line.material_id::int,
      material.internal_material_code,quote_line.unit_id::int,unit.code unit_code,
      quote_line.quoted_quantity::text,quote_line.minimum_order_quantity::text,quote_line.unit_price::text,
      (quote_line.quoted_quantity*quote_line.unit_price)::numeric(30,6)::text line_amount,
      quote_line.lead_time_days::int,quote_line.promised_delivery_date::text,rfq_line.required_date::text,
      (rfq_line.required_date-quote_line.promised_delivery_date)::int delivery_delta_days,quote_line.line_digest
    from procurement_supplier_quote_lines quote_line
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
    join procurement_rfq_lines rfq_line on rfq_line.id=quote_line.rfq_line_id
    join material_master material on material.id=quote_line.material_id join units unit on unit.id=quote_line.unit_id
    where quote.rfq_id=1 order by quote.id,rfq_line.line_no,quote_line.id`)).rows;
  assert.equal(quoteLines.length, 8);
  assert.equal(new Set(quoteLines.map((line) => line.id)).size, 8);
  assert.ok(quoteLines.every((line) => line.rfq_line_id === line.line_no && line.material_id === 532 + line.line_no
    && line.unit_code === "PCS" && line.quoted_quantity === "10.000000"
    && line.minimum_order_quantity === "10.000000" && line.required_date === "2026-10-30"
    && /^[0-9a-f]{64}$/.test(line.line_digest)));
  const quoteALines = quoteLines.filter((line) => line.quote_id === "1");
  const quoteBLines = quoteLines.filter((line) => line.quote_id === "2");
  assert.equal(quoteALines.length, 4);
  assert.equal(quoteBLines.length, 4);
  assert.ok(quoteALines.every((line) => line.supplier_id === 1 && line.quote_version_no === 1
    && line.unit_price === "12.000000" && line.line_amount === "120.000000"
    && line.promised_delivery_date === "2026-10-20" && line.delivery_delta_days === 10));
  assert.ok(quoteBLines.every((line) => line.supplier_id === 2 && line.quote_version_no === 1
    && line.unit_price === "10.000000" && line.line_amount === "100.000000"
    && line.promised_delivery_date === "2026-11-05" && line.delivery_delta_days === -6));

  const basisInputRows = (await client.query(`select line.id rfq_line_id,line.requested_quantity,
      line.required_date,quote.id quote_id,quote.supplier_id,quote.currency_code,quote.valid_until,
      quote.tax_included,quote.freight_included,quote_line.id quote_line_id,quote_line.unit_id,
      quote_line.unit_price,quote_line.minimum_order_quantity,quote_line.promised_delivery_date
    from procurement_rfq_lines line
    join procurement_supplier_quote_lines quote_line on quote_line.rfq_line_id=line.id
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id and quote.status='SUBMITTED'
    where line.rfq_id=1 order by line.id,quote.supplier_id`)).rows;
  assert.equal(basisInputRows.length, 8);

  const comparisons = (await client.query(`select comparison.id::text comparison_line_id,
      comparison.rfq_id::int,comparison.rfq_line_id::int,comparison.comparison_version_no::int,
      comparison.basis_digest,comparison.generated_by,${shanghai("comparison.generated_at")} generated_at_shanghai,
      comparison.request_id::text,rfq_line.material_id::int,material.internal_material_code
    from procurement_quote_comparisons comparison
    join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
    join material_master material on material.id=rfq_line.material_id
    where comparison.rfq_id=1 order by comparison.rfq_line_id,comparison.id`)).rows;
  assert.equal(comparisons.length, 4);
  assert.equal(new Set(comparisons.map((comparison) => comparison.comparison_line_id)).size, 4);
  assert.deepEqual(comparisons.map(({ rfq_line_id, material_id, comparison_version_no }) => ({ rfq_line_id, material_id, comparison_version_no })), [
    { rfq_line_id: 1, material_id: 533, comparison_version_no: 1 },
    { rfq_line_id: 2, material_id: 534, comparison_version_no: 1 },
    { rfq_line_id: 3, material_id: 535, comparison_version_no: 1 },
    { rfq_line_id: 4, material_id: 536, comparison_version_no: 1 },
  ]);
  assert.ok(comparisons.every((comparison) => /^[0-9a-f]{64}$/.test(comparison.basis_digest)
    && comparison.generated_by === EXPECTED_ACTOR
    && comparison.generated_at_shanghai === EXPECTED_OPERATION_TIME_SHANGHAI
    && comparison.request_id === EXPECTED_OPERATION_REQUEST_ID));
  for (const comparison of comparisons) {
    const input = basisInputRows.filter((row) => Number(row.rfq_line_id) === comparison.rfq_line_id);
    assert.equal(input.length, 2);
    assert.equal(canonicalDigest(input), comparison.basis_digest);
  }

  const candidates = (await client.query(`select candidate.id::text comparison_candidate_id,
      comparison.id::text comparison_line_id,comparison.comparison_version_no::int,
      comparison.rfq_line_id::int,rfq_line.material_id::int,material.internal_material_code,
      candidate.quote_line_id::text,quote_line.quote_id::text,quote.quote_version_no::int,
      quote.supplier_quote_reference,candidate.supplier_id::int,candidate.currency_code,
      unit.code unit_code,quote_line.quoted_quantity::text,candidate.unit_price::text,
      (quote_line.quoted_quantity*candidate.unit_price)::numeric(30,6)::text line_amount,
      candidate.minimum_order_quantity::text,candidate.promised_delivery_date::text,
      candidate.price_rank::int,candidate.lowest_price,candidate.moq_satisfied,candidate.delivery_status,
      greatest((rfq_line.required_date-candidate.promised_delivery_date)::int,0)::int early_days,
      greatest((candidate.promised_delivery_date-rfq_line.required_date)::int,0)::int late_days,
      candidate.quote_expired,candidate.comparable_status,candidate.reason_code,candidate.awardable,
      candidate.tax_included,candidate.freight_included
    from procurement_quote_comparison_lines candidate
    join procurement_quote_comparisons comparison on comparison.id=candidate.comparison_id
    join procurement_supplier_quote_lines quote_line on quote_line.id=candidate.quote_line_id
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
    join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
    join material_master material on material.id=rfq_line.material_id join units unit on unit.id=candidate.unit_id
    where comparison.rfq_id=1 order by rfq_line.material_id,candidate.supplier_id,candidate.id`)).rows;
  assert.equal(candidates.length, 8);
  assert.equal(new Set(candidates.map((candidate) => candidate.comparison_candidate_id)).size, 8);
  assert.ok(comparisons.every((comparison) => candidates.filter((candidate) => candidate.comparison_line_id === comparison.comparison_line_id).length === 2));
  assert.ok(candidates.every((candidate) => candidate.comparison_version_no === 1
    && candidate.unit_code === "PCS" && candidate.quoted_quantity === "10.000000"
    && candidate.minimum_order_quantity === "10.000000" && candidate.currency_code === "CNY"
    && candidate.tax_included === false && candidate.freight_included === false
    && candidate.quote_expired === false && candidate.comparable_status === "COMPARABLE"));
  assert.ok(candidates.filter((candidate) => candidate.supplier_id === 1).every((candidate) => candidate.quote_id === "1"
    && candidate.quote_version_no === 1 && candidate.supplier_quote_reference === "UAT-Q-A-042576"
    && candidate.unit_price === "12.000000" && candidate.line_amount === "120.000000"
    && candidate.price_rank === 2 && candidate.lowest_price === false
    && candidate.promised_delivery_date === "2026-10-20" && candidate.delivery_status === "ON_TIME"
    && candidate.early_days === 10 && candidate.late_days === 0));
  assert.ok(candidates.filter((candidate) => candidate.supplier_id === 2).every((candidate) => candidate.quote_id === "2"
    && candidate.quote_version_no === 1 && candidate.supplier_quote_reference === "UAT-Q-B-042576"
    && candidate.unit_price === "10.000000" && candidate.line_amount === "100.000000"
    && candidate.price_rank === 1 && candidate.lowest_price === true
    && candidate.promised_delivery_date === "2026-11-05" && candidate.delivery_status === "LATE"
    && candidate.early_days === 0 && candidate.late_days === 6));

  const comparisonEvents = (await client.query(`select event.id::text event_id,event.comparison_id::text,
      event.event_type,event.actor,${shanghai("event.created_at")} occurred_at_shanghai,event.request_id::text,
      event.result,event.old_version::int,event.new_version::int,comparison.rfq_line_id::int,
      rfq_line.material_id::int,material.internal_material_code
    from procurement_sourcing_events event
    join procurement_quote_comparisons comparison on comparison.id=event.comparison_id
    join procurement_rfq_lines rfq_line on rfq_line.id=comparison.rfq_line_id
    join material_master material on material.id=rfq_line.material_id
    where event.rfq_id=1 and event.event_type='COMPARISON_GENERATED'
    order by event.id`)).rows;
  assert.equal(comparisonEvents.length, 4);
  assert.ok(comparisonEvents.every((event) => event.event_type === "COMPARISON_GENERATED"
    && event.actor === EXPECTED_ACTOR && event.occurred_at_shanghai === EXPECTED_OPERATION_TIME_SHANGHAI
    && event.request_id === EXPECTED_OPERATION_REQUEST_ID && event.result === "SUCCESS"
    && event.old_version === null && event.new_version === null));
  assert.deepEqual(comparisonEvents.map(({ rfq_line_id, material_id }) => ({ rfq_line_id, material_id })), [
    { rfq_line_id: 1, material_id: 533 }, { rfq_line_id: 2, material_id: 534 },
    { rfq_line_id: 3, material_id: 535 }, { rfq_line_id: 4, material_id: 536 },
  ]);

  const comparisonAudits = (await client.query(`select audit.id::text audit_id,audit.username actor,
      ${shanghai("audit.created_at")} occurred_at_shanghai,audit.request_id::text,audit.result,
      audit.old_version::int,audit.new_version::int,audit.operation_id::text,
      audit.idempotency_key_digest
    from audit_log audit where audit.route_code='PROCUREMENT_SOURCING'
      and audit.action='COMPARISON_GENERATED' and audit.request_id=$1 order by audit.id`, [EXPECTED_OPERATION_REQUEST_ID])).rows;
  assert.equal(comparisonAudits.length, 1);
  assert.deepEqual({ actor: comparisonAudits[0].actor, occurred_at_shanghai: comparisonAudits[0].occurred_at_shanghai,
    request_id: comparisonAudits[0].request_id, result: comparisonAudits[0].result,
    old_version: comparisonAudits[0].old_version, new_version: comparisonAudits[0].new_version }, {
    actor: EXPECTED_ACTOR, occurred_at_shanghai: EXPECTED_OPERATION_TIME_SHANGHAI,
    request_id: EXPECTED_OPERATION_REQUEST_ID, result: "success", old_version: 5, new_version: 6,
  });
  assert.ok(comparisonAudits[0].operation_id && /^[0-9a-f]{64}$/.test(comparisonAudits[0].idempotency_key_digest));

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
  assert.deepEqual(counts, { bindings: 8, supplier_a_quotes: 1, supplier_b_quotes: 1, quotes: 2,
    comparison_lines: 4, comparison_candidates: 8, comparison_events: 4, awards: 0, purchase_orders: 0 });

  const outputCanonicalRows = candidates.map((candidate) => ({
    comparison_version_no: candidate.comparison_version_no,
    comparison_line_id: candidate.comparison_line_id,
    comparison_candidate_id: candidate.comparison_candidate_id,
    fixed_quote_line_id: candidate.quote_line_id,
    material_id: String(candidate.material_id),
    supplier_id: String(candidate.supplier_id),
    quantity: candidate.quoted_quantity,
    unit_price: candidate.unit_price,
    line_amount: candidate.line_amount,
    price_rank: candidate.price_rank,
    promised_delivery_date: candidate.promised_delivery_date,
    delivery_status: candidate.delivery_status,
    early_days: candidate.early_days,
    late_days: candidate.late_days,
  }));
  const outputDigest = canonicalDigest(outputCanonicalRows);
  const supplierSummaries = [1, 2].map((supplierId) => {
    const rows = candidates.filter((candidate) => candidate.supplier_id === supplierId);
    return {
      supplier_id: supplierId,
      quote_id: rows[0].quote_id,
      quote_version_no: rows[0].quote_version_no,
      supplier_quote_reference: rows[0].supplier_quote_reference,
      total_amount: rows.reduce((total, row) => total + Number(row.line_amount), 0).toFixed(2),
      latest_promised_delivery_date: rows.map((row) => row.promised_delivery_date).sort().at(-1),
      delivery_status: rows.some((row) => row.delivery_status === "LATE") ? "LATE" : "ON_TIME",
      early_days: Math.min(...rows.map((row) => row.early_days)),
      late_days: Math.max(...rows.map((row) => row.late_days)),
    };
  });
  assert.deepEqual(supplierSummaries, [
    { supplier_id: 1, quote_id: "1", quote_version_no: 1, supplier_quote_reference: "UAT-Q-A-042576",
      total_amount: "480.00", latest_promised_delivery_date: "2026-10-20", delivery_status: "ON_TIME", early_days: 10, late_days: 0 },
    { supplier_id: 2, quote_id: "2", quote_version_no: 1, supplier_quote_reference: "UAT-Q-B-042576",
      total_amount: "400.00", latest_promised_delivery_date: "2026-11-05", delivery_status: "LATE", early_days: 0, late_days: 6 },
  ]);

  const protectedState = {
    rfq, lines, suppliers, bindings, quotes, quote_lines: quoteLines,
    basis_input_rows: basisInputRows, comparisons, comparison_candidates: candidates,
    comparison_events: comparisonEvents, comparison_audits: comparisonAudits, counts,
    deterministic_output_summary: { digest: outputDigest, canonical_rows: outputCanonicalRows },
    supplier_summaries: supplierSummaries,
    aggregate_differences: {
      amount_difference: "80.00", percentage_basis_supplier_id: 2,
      percentage_difference: "20.00", delivery_day_difference: 16,
      lowest_price_supplier_id: 2, on_time_supplier_id: 1, late_risk_supplier_id: 2,
    },
  };
  const fingerprint = canonicalDigest(protectedState);
  if (expectedHash) assert.equal(fingerprint, expectedHash);
  console.info(JSON.stringify({
    protected_business_fingerprint: fingerprint,
    mode: captureBaseline ? "CAPTURE_BASELINE" : "VERIFY_EXPECTED_HASH",
    expected_hash_asserted: Boolean(expectedHash),
    summary: {
      rfq_id: 1, rfq_code: rfq.rfq_code, status: rfq.status, rfq_version: rfq.version,
      round_no: rfq.round_no, comparison_version_no: 1, independent_comparison_header_id: null,
      comparison_line_ids: comparisons.map((row) => row.comparison_line_id),
      basis_digests: comparisons.map((row) => row.basis_digest), output_digest: outputDigest,
      comparison_event_count: comparisonEvents.length, operation_request_id: EXPECTED_OPERATION_REQUEST_ID,
      operation_actor: EXPECTED_ACTOR, operation_time_shanghai: EXPECTED_OPERATION_TIME_SHANGHAI,
      rfq_cas: "v5->v6", supplier_summaries: supplierSummaries, counts,
    },
  }));
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
