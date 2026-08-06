import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const REQUIRED_CONFIRMATION = "MAIN_UAT_FIX27_RFQ1_QUOTE_PROTECTION_READONLY";
const EXPECTED_DATABASE = "chenyida_erp";
const EXPECTED_SCOPE_DIGEST = "9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d";
const EXPECTED_QUOTE_REQUEST_ID = "5ca5863a-6a5d-4457-917a-d1b24f41ccff";
const EXPECTED_QUOTE_TIME_SHANGHAI = "2026-08-06 13:10:59.800906";
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

if (process.env.ERP_RFQ_QUOTE_FIX27_PROTECTION_CONFIRM !== REQUIRED_CONFIRMATION) {
  throw new Error(`ERP_RFQ_QUOTE_FIX27_PROTECTION_CONFIRM=${REQUIRED_CONFIRMATION} is required`);
}
const databaseUrl = process.env.ERP_FIX27_DATABASE_URL || "";
const expectedDatabaseName = (process.env.ERP_FIX27_DATABASE_NAME || "").trim();
if (!databaseUrl || expectedDatabaseName !== EXPECTED_DATABASE) {
  throw new Error(`ERP_FIX27_DATABASE_URL and ERP_FIX27_DATABASE_NAME=${EXPECTED_DATABASE} are required`);
}
const connectionUrl = new URL(databaseUrl);
assert.equal(decodeURIComponent(connectionUrl.pathname.replace(/^\//, "")), EXPECTED_DATABASE);

const args = process.argv.slice(2);
let captureBaseline = false;
let expectedHash = (process.env.ERP_FIX27_EXPECTED_HASH || "").trim();
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
const pool = new Pool({ connectionString: connectionUrl.toString(), max: 1, application_name: "rfq-quote-semantics-fix27-protection" });
const client = await pool.connect();

try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  const connection = (await client.query("select current_database() database_name,current_setting('transaction_read_only') transaction_read_only")).rows[0];
  assert.deepEqual(connection, { database_name: EXPECTED_DATABASE, transaction_read_only: "on" });
  const ledger = (await client.query("select version,checksum from schema_migrations order by version")).rows;
  assert.deepEqual(ledger, migrationNames.map((version) => ({ version, checksum: migrationManifest.get(version) })));

  const rfq = (await client.query(`select id::int,rfq_code,purchase_request_id::int,round_no::int,status,
      version::int,traceability_version::int,response_deadline::text response_deadline_text,currency_code,
      issued_by,${shanghai("issued_at")} issued_at_shanghai,${shanghai("updated_at")} updated_at_shanghai
    from procurement_rfqs where id=1`)).rows[0];
  assert.deepEqual(rfq, {
    id: 1, rfq_code: "RFQ-00000001", purchase_request_id: 1, round_no: 1, status: "ISSUED",
    version: 4, traceability_version: 1, response_deadline_text: "2026-08-31", currency_code: "CNY",
    issued_by: "uat_20260729_purchase", issued_at_shanghai: "2026-08-06 12:06:31.280557",
    updated_at_shanghai: EXPECTED_QUOTE_TIME_SHANGHAI,
  });

  const lines = (await client.query(`select id::int,purchase_request_line_id::int,line_no::int,material_id::int,
      unit_id::int,requested_quantity::numeric(24,6)::text,required_date::text
    from procurement_rfq_lines where rfq_id=1 order by id`)).rows;
  assert.deepEqual(lines.map(({ id, line_no, material_id, unit_id, requested_quantity, required_date }) => ({ id, line_no, material_id, unit_id, requested_quantity, required_date })), [
    { id: 1, line_no: 1, material_id: 533, unit_id: 1, requested_quantity: "10.000000", required_date: "2026-10-30" },
    { id: 2, line_no: 2, material_id: 534, unit_id: 1, requested_quantity: "10.000000", required_date: "2026-10-30" },
    { id: 3, line_no: 3, material_id: 535, unit_id: 1, requested_quantity: "10.000000", required_date: "2026-10-30" },
    { id: 4, line_no: 4, material_id: 536, unit_id: 1, requested_quantity: "10.000000", required_date: "2026-10-30" },
  ]);

  const suppliers = (await client.query(`select invitation.id::int,invitation.supplier_id::int,supplier.supplier_code,
      supplier.status supplier_status,invitation.status invitation_status,
      case when invitation.responded_at is null then null else ${shanghai("invitation.responded_at")} end responded_at_shanghai
    from procurement_rfq_suppliers invitation join suppliers supplier on supplier.id=invitation.supplier_id
    where invitation.rfq_id=1 and invitation.supplier_id in (1,2) order by invitation.id`)).rows;
  assert.deepEqual(suppliers, [
    { id: 1, supplier_id: 1, supplier_code: "SUP-000001", supplier_status: "ACTIVE", invitation_status: "RESPONDED", responded_at_shanghai: EXPECTED_QUOTE_TIME_SHANGHAI },
    { id: 2, supplier_id: 2, supplier_code: "SUP-000002", supplier_status: "ACTIVE", invitation_status: "INVITED", responded_at_shanghai: null },
  ]);

  const bindings = (await client.query(`select b.id::text binding_id,b.rfq_id::int,b.rfq_supplier_id::int,
      b.rfq_line_id::int,b.supplier_id::int,b.material_id::int,b.supplier_mapping_version_id::int,
      b.mapping_uid::text mapping_id,b.mapping_version_no::int mapping_version,b.mapping_row_version::int,
      b.mapping_content_digest,b.binding_source,b.binding_status,s.status supplier_status,
      material.material_status,mapping.status current_mapping_status,mapping.mapping_version_no::int current_mapping_version,
      mapping.version::int current_mapping_row_version,mapping.content_digest current_mapping_content_digest,
      latest.id::int latest_mapping_id,active_match.mapping_count::int current_active_count,
      active_match.mapping_version_id::int current_active_mapping_id,
      (s.status='ACTIVE' and material.material_status='ACTIVE' and mapping.status='ACTIVE'
        and mapping.mapping_version_no=b.mapping_version_no and mapping.version=b.mapping_row_version
        and mapping.content_digest is not distinct from b.mapping_content_digest
        and latest.id=b.supplier_mapping_version_id and active_match.mapping_count=1
        and active_match.mapping_version_id=b.supplier_mapping_version_id
        and b.valid_from<=statement_timestamp() and (b.valid_to is null or b.valid_to>statement_timestamp())) scope_intact
    from procurement_rfq_supplier_line_mapping_bindings b
    join suppliers s on s.id=b.supplier_id join material_master material on material.id=b.material_id
    join supplier_mappings mapping on mapping.id=b.supplier_mapping_version_id
    left join lateral (select candidate.id from supplier_mappings candidate where candidate.mapping_uid=b.mapping_uid
      order by candidate.mapping_version_no desc,candidate.id desc limit 1) latest on true
    left join lateral (select count(*)::int mapping_count,
      (array_agg(candidate.id order by candidate.mapping_version_no desc,candidate.id desc))[1] mapping_version_id
      from supplier_mappings candidate where candidate.supplier_id=b.supplier_id and candidate.material_id=b.material_id
        and candidate.purchase_unit_id=b.purchase_unit_id and candidate.status='ACTIVE'
        and candidate.conversion_numerator=candidate.conversion_denominator
        and candidate.valid_from<=statement_timestamp() and (candidate.valid_to is null or candidate.valid_to>statement_timestamp())) active_match on true
    where b.rfq_id=1 and b.id between 1 and 8 order by b.id`)).rows;
  assert.equal(bindings.length, 8);
  assert.deepEqual(bindings.map(({ binding_id, supplier_id, rfq_line_id, material_id, mapping_id }) => [binding_id, supplier_id, rfq_line_id, material_id, mapping_id]), EXPECTED_BINDINGS);
  assert.ok(bindings.every((binding) => binding.rfq_id === 1
    && binding.binding_source === "LEGACY_DRAFT_CONFIRMATION" && binding.binding_status === "ACTIVE"
    && binding.supplier_status === "ACTIVE" && binding.material_status === "ACTIVE"
    && binding.current_mapping_status === "ACTIVE" && binding.current_mapping_version === binding.mapping_version
    && binding.current_mapping_row_version === binding.mapping_row_version
    && binding.current_mapping_content_digest === binding.mapping_content_digest
    && binding.latest_mapping_id === binding.supplier_mapping_version_id
    && binding.current_active_count === 1 && binding.current_active_mapping_id === binding.supplier_mapping_version_id
    && binding.scope_intact === true));

  const events = (await client.query(`select id::text,quote_id::text,event_type,actor,
      ${shanghai("created_at")} occurred_at_shanghai,request_id::text,result,old_version::int,new_version::int,
      from_status,to_status,scope_digest from procurement_sourcing_events where rfq_id=1 order by id`)).rows;
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(({ id, quote_id, event_type, result, old_version, new_version, scope_digest }) => ({ id, quote_id, event_type, result, old_version, new_version, scope_digest })), [
    { id: "1", quote_id: null, event_type: "RFQ_MAPPING_CONFIRMED", result: "SUCCESS", old_version: 1, new_version: 2, scope_digest: EXPECTED_SCOPE_DIGEST },
    { id: "2", quote_id: null, event_type: "RFQ_ISSUED", result: "SUCCESS", old_version: 2, new_version: 3, scope_digest: EXPECTED_SCOPE_DIGEST },
    { id: "3", quote_id: "1", event_type: "QUOTE_SUBMITTED", result: "SUCCESS", old_version: null, new_version: null, scope_digest: null },
  ]);
  assert.deepEqual({ actor: events[2].actor, time: events[2].occurred_at_shanghai, request_id: events[2].request_id }, {
    actor: "uat_20260729_purchase", time: EXPECTED_QUOTE_TIME_SHANGHAI, request_id: EXPECTED_QUOTE_REQUEST_ID,
  });

  const quote = (await client.query(`select quote.id::text,quote.rfq_id::int,quote.supplier_id::int,
      supplier.supplier_code,quote.quote_version_no::int,quote.supplier_quote_reference,quote.status,
      quote.currency_code,quote.valid_until::text,quote.tax_included,quote.freight_included,quote.payment_terms,
      quote.quote_digest,quote.version::int,quote.recorded_by,${shanghai("quote.recorded_at")} recorded_at_shanghai,
      quote.request_id::text from procurement_supplier_quotes quote join suppliers supplier on supplier.id=quote.supplier_id
    where quote.id=1 and quote.rfq_id=1 and quote.supplier_id=1`)).rows[0];
  assert.deepEqual({ id: quote.id, rfq_id: quote.rfq_id, supplier_id: quote.supplier_id, supplier_code: quote.supplier_code,
    quote_version_no: quote.quote_version_no, reference: quote.supplier_quote_reference, status: quote.status,
    currency: quote.currency_code, valid_until: quote.valid_until, version: quote.version, recorded_by: quote.recorded_by,
    recorded_at_shanghai: quote.recorded_at_shanghai, request_id: quote.request_id }, {
    id: "1", rfq_id: 1, supplier_id: 1, supplier_code: "SUP-000001", quote_version_no: 1,
    reference: "UAT-Q-A-042576", status: "SUBMITTED", currency: "CNY", valid_until: "2026-09-30",
    version: 1, recorded_by: "uat_20260729_purchase", recorded_at_shanghai: EXPECTED_QUOTE_TIME_SHANGHAI,
    request_id: EXPECTED_QUOTE_REQUEST_ID,
  });

  const quoteLines = (await client.query(`select line.id::text,line.quote_id::text,line.rfq_line_id::int,
      rfq_line.line_no::int,line.material_id::int,line.unit_id::int,unit.code unit_code,
      line.quoted_quantity::text,line.minimum_order_quantity::text,line.unit_price::text,
      (line.quoted_quantity*line.unit_price)::numeric(30,6)::text line_amount,line.lead_time_days::int,
      line.promised_delivery_date::text,rfq_line.required_date::text,
      (rfq_line.required_date-line.promised_delivery_date)::int delivery_delta_days,line.line_digest
    from procurement_supplier_quote_lines line join procurement_rfq_lines rfq_line on rfq_line.id=line.rfq_line_id
    join units unit on unit.id=line.unit_id where line.quote_id=1 order by rfq_line.line_no`)).rows;
  assert.equal(quoteLines.length, 4);
  assert.ok(quoteLines.every((line, index) => line.id === String(index + 1) && line.quote_id === "1"
    && line.rfq_line_id === index + 1 && line.line_no === index + 1 && line.material_id === 533 + index
    && line.unit_id === 1 && line.unit_code === "PCS" && line.quoted_quantity === "10.000000"
    && line.minimum_order_quantity === "10.000000" && line.unit_price === "12.000000"
    && line.line_amount === "120.000000" && line.lead_time_days === 75
    && line.promised_delivery_date === "2026-10-20" && line.required_date === "2026-10-30"
    && line.delivery_delta_days === 10 && /^[0-9a-f]{64}$/.test(line.line_digest)));
  const totalAmount = quoteLines.reduce((total, line) => total + Number(line.line_amount), 0).toFixed(2);
  assert.equal(totalAmount, "480.00");

  const counts = (await client.query(`select
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings where rfq_id=1) bindings,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_MAPPING_CONFIRMED') mapping_confirmed,
      (select count(*)::int from procurement_sourcing_events where rfq_id=1 and event_type='RFQ_ISSUED') issued,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1 and supplier_id=1) supplier_a_quotes,
      (select count(*)::int from procurement_supplier_quotes where rfq_id=1 and supplier_id=2) supplier_b_quotes,
      (select count(*)::int from procurement_supplier_quotes) quotes,
      (select count(*)::int from procurement_sourcing_awards) awards,
      (select count(*)::int from purchase_orders) purchase_orders`)).rows[0];
  assert.deepEqual(counts, { bindings: 8, mapping_confirmed: 1, issued: 1, supplier_a_quotes: 1, supplier_b_quotes: 0, quotes: 1, awards: 0, purchase_orders: 0 });

  const computedScopeDigest = canonicalDigest({
    rfq_id: rfq.id, purchase_request_id: rfq.purchase_request_id, round_no: rfq.round_no,
    response_deadline: rfq.response_deadline_text, currency_code: rfq.currency_code,
    lines: lines.map((line) => ({ rfq_line_id: line.id, purchase_request_line_id: line.purchase_request_line_id,
      material_id: line.material_id, unit_id: line.unit_id, requested_quantity: line.requested_quantity, line_no: line.line_no })),
    suppliers: suppliers.map((supplier) => ({ rfq_supplier_id: supplier.id, supplier_id: supplier.supplier_id })),
    mappings: bindings.map((binding) => ({ rfq_supplier_id: binding.rfq_supplier_id, rfq_line_id: binding.rfq_line_id,
      mapping_id: binding.mapping_id, mapping_version: binding.mapping_version, mapping_row_version: binding.mapping_row_version })),
  });
  assert.equal(computedScopeDigest, EXPECTED_SCOPE_DIGEST);

  const protectedState = { rfq, lines, suppliers, bindings, events, quote, quote_lines: quoteLines, counts, computed_scope_digest: computedScopeDigest };
  const fingerprint = createHash("sha256").update(JSON.stringify(protectedState)).digest("hex");
  if (expectedHash) assert.equal(fingerprint, expectedHash);
  console.info(JSON.stringify({
    protected_business_fingerprint: fingerprint,
    mode: captureBaseline ? "CAPTURE_BASELINE" : "VERIFY_EXPECTED_HASH",
    expected_hash_asserted: Boolean(expectedHash),
    summary: { rfq_id: 1, rfq_code: rfq.rfq_code, status: rfq.status, version: rfq.version,
      supplier_a: "RESPONDED", supplier_b: "INVITED", quote_id: quote.id, quote_status: quote.status,
      quote_version: quote.quote_version_no, quote_event_version_transition: "NOT_RECORDED",
      binding_count: bindings.length, scope_digest: computedScopeDigest, total_amount: totalAmount,
      delivery_delta_days: quoteLines[0].delivery_delta_days, counts },
  }));
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
