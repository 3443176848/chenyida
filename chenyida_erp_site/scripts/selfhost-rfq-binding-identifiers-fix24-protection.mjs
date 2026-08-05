import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
assert.equal(migrationNames.length, 39);
assert.equal(migrationNames.at(-1), "0039_rfq_traceability.sql");
const migrationManifest = new Map(await Promise.all(migrationNames.map(async (name) => [
  name,
  createHash("sha256").update(await readFile(new URL(name, migrationDirectory))).digest("hex"),
])));
assert.equal(migrationManifest.get("0039_rfq_traceability.sql"), "3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37");

const cli = process.argv.slice(2);
let expectedHash = (process.env.ERP_FIX24_EXPECTED_HASH || "").trim();
let captureBaseline = false;
for (let index = 0; index < cli.length; index += 1) {
  const argument = cli[index];
  if (argument === "--capture-baseline") {
    if (captureBaseline) throw new Error("--capture-baseline may only be provided once");
    captureBaseline = true;
  } else if (argument === "--expected-hash") {
    if (index + 1 >= cli.length || expectedHash) throw new Error("--expected-hash requires one unique SHA-256 value");
    expectedHash = cli[index + 1];
    index += 1;
  } else if (argument.startsWith("--expected-hash=")) {
    if (expectedHash) throw new Error("--expected-hash may only be provided once");
    expectedHash = argument.slice("--expected-hash=".length);
  } else throw new Error(`unsupported argument: ${argument}`);
}
if (expectedHash && !/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error("expected hash must be one lowercase SHA-256 digest");
if (captureBaseline === Boolean(expectedHash)) throw new Error("use exactly one of --capture-baseline or --expected-hash");

const databaseUrl = process.env.ERP_FIX24_DATABASE_URL || process.env.DATABASE_URL || "";
const expectedDatabaseName = (process.env.ERP_FIX24_DATABASE_NAME || "").trim();
if (!databaseUrl) throw new Error("ERP_FIX24_DATABASE_URL or DATABASE_URL is required");
if (!/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabaseName)) throw new Error("ERP_FIX24_DATABASE_NAME must be an explicit safe PostgreSQL database name");
const connectionUrl = new URL(databaseUrl);
assert.equal(decodeURIComponent(connectionUrl.pathname.replace(/^\//, "")), expectedDatabaseName);

const EXPECTED_SCOPE_DIGEST = "9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d";
const EXPECTED_CONFIRM_REQUEST_ID = "52ed7a96-3a78-46e2-8ed8-2a1b4076a6e7";
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
const shanghai = (column) => `to_char(${column} at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US')`;
const pool = new Pool({ connectionString: connectionUrl.toString(), max: 1, application_name: "rfq-binding-identifiers-fix24-protection" });
const client = await pool.connect();

try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  const connection = (await client.query("select current_database() database_name,current_setting('transaction_read_only') transaction_read_only")).rows[0];
  assert.deepEqual(connection, { database_name: expectedDatabaseName, transaction_read_only: "on" });

  const migrationLedger = (await client.query("select version,checksum from schema_migrations order by version")).rows;
  assert.deepEqual(migrationLedger, migrationNames.map((version) => ({ version, checksum: migrationManifest.get(version) })));
  const schema = (await client.query(`select count(*)::int migration_count,max(version) head_version,
      (select count(*)::int from pg_tables where schemaname='public') public_table_count,
      (select data_type from information_schema.columns where table_schema='public'
        and table_name='procurement_rfq_supplier_line_mapping_bindings' and column_name='id') binding_id_type,
      (select count(*)::int from pg_constraint where conrelid='procurement_rfq_supplier_line_mapping_bindings'::regclass and contype='p') binding_primary_keys
    from schema_migrations`)).rows[0];
  assert.deepEqual(schema, { migration_count: 39, head_version: "0039_rfq_traceability.sql", public_table_count: 226, binding_id_type: "bigint", binding_primary_keys: 1 });

  const rfq = (await client.query(`select q.id::int rfq_id,q.rfq_code,q.purchase_request_id::int,q.round_no::int,
      q.status,q.version::int,q.traceability_version::int,q.response_deadline::text,q.currency_code,
      q.source_purchase_request_version::int,q.source_digest,q.request_id::text,q.created_by,
      ${shanghai("q.created_at")} created_at_shanghai,q.issued_by,
      case when q.issued_at is null then null else ${shanghai("q.issued_at")} end issued_at_shanghai,
      case when q.closed_at is null then null else ${shanghai("q.closed_at")} end closed_at_shanghai,
      ${shanghai("q.updated_at")} updated_at_shanghai
    from procurement_rfqs q where q.id=1`)).rows[0];
  assert.deepEqual({ rfq_id: rfq?.rfq_id, rfq_code: rfq?.rfq_code, round_no: rfq?.round_no, status: rfq?.status,
    version: rfq?.version, traceability_version: rfq?.traceability_version, response_deadline: rfq?.response_deadline,
    currency_code: rfq?.currency_code, issued_by: rfq?.issued_by, issued_at_shanghai: rfq?.issued_at_shanghai,
    closed_at_shanghai: rfq?.closed_at_shanghai }, {
    rfq_id: 1, rfq_code: "RFQ-00000001", round_no: 1, status: "DRAFT", version: 2,
    traceability_version: 1, response_deadline: "2026-08-31", currency_code: "CNY",
    issued_by: null, issued_at_shanghai: null, closed_at_shanghai: null,
  });

  const source = (await client.query(`select request.id::int purchase_request_id,request.request_code,request.status,
      request.version::int,request.submitted_by,request.accepted_by,request.returned_by,
      plan.id::int plan_id,plan.plan_version_no::int,plan.status plan_status,plan.required_date::text,
      project.id::int project_id,project.project_code,project.project_name,project.status project_status
    from planning_purchase_requests request join planning_material_requirement_plans plan on plan.id=request.plan_id
    join business_projects project on project.id=plan.project_id where request.id=1`)).rows[0];
  assert.deepEqual({ purchase_request_id: source?.purchase_request_id, request_code: source?.request_code,
    status: source?.status, version: source?.version, accepted_by: source?.accepted_by }, {
    purchase_request_id: 1, request_code: "PRQ-00000001", status: "ACCEPTED", version: 2,
    accepted_by: "uat_20260729_purchase",
  });

  const lines = (await client.query(`select line.id::int rfq_line_id,line.purchase_request_line_id::int,
      line.line_no::int,line.material_id::int,material.internal_material_code,material.standard_name,
      material.material_status,line.unit_id::int,unit.code unit_code,
      line.requested_quantity::numeric(24,6)::text,line.required_date::text,line.source_digest
    from procurement_rfq_lines line join material_master material on material.id=line.material_id
    join units unit on unit.id=line.unit_id where line.rfq_id=1 order by line.line_no,line.id`)).rows;
  assert.deepEqual(lines.map(({ rfq_line_id, line_no, material_id, unit_code }) => ({ rfq_line_id, line_no, material_id, unit_code })), [
    { rfq_line_id: 1, line_no: 1, material_id: 533, unit_code: "PCS" },
    { rfq_line_id: 2, line_no: 2, material_id: 534, unit_code: "PCS" },
    { rfq_line_id: 3, line_no: 3, material_id: 535, unit_code: "PCS" },
    { rfq_line_id: 4, line_no: 4, material_id: 536, unit_code: "PCS" },
  ]);

  const suppliers = (await client.query(`select invitation.id::int rfq_supplier_id,invitation.supplier_id::int,
      supplier.supplier_code,supplier.supplier_name,supplier.status supplier_status,
      invitation.status invitation_status,invitation.invited_by,invitation.supplier_mapping_digest
    from procurement_rfq_suppliers invitation join suppliers supplier on supplier.id=invitation.supplier_id
    where invitation.rfq_id=1 order by supplier.supplier_code,invitation.supplier_id`)).rows;
  assert.deepEqual(suppliers.map(({ supplier_id, supplier_code, supplier_status, invitation_status }) => ({ supplier_id, supplier_code, supplier_status, invitation_status })), [
    { supplier_id: 1, supplier_code: "SUP-000001", supplier_status: "ACTIVE", invitation_status: "INVITED" },
    { supplier_id: 2, supplier_code: "SUP-000002", supplier_status: "ACTIVE", invitation_status: "INVITED" },
  ]);

  const bindings = (await client.query(`select binding.id::text binding_id,binding.rfq_id::int,
      binding.rfq_supplier_id::int,binding.rfq_line_id::int,binding.supplier_id::int,
      supplier.supplier_code,supplier.supplier_name,binding.material_id::int,
      material.internal_material_code,material.standard_name,binding.supplier_mapping_version_id::int,
      binding.mapping_uid::text mapping_id,binding.mapping_version_no::int mapping_version,
      binding.mapping_row_version::int mapping_row_version,binding.mapping_content_digest,
      binding.supplier_part_number,binding.purchase_unit_id::int,purchase_unit.code supplier_unit,
      internal_unit.code internal_unit,binding.conversion_numerator::text,binding.conversion_denominator::text,
      ${shanghai("binding.valid_from")} valid_from_shanghai,
      case when binding.valid_to is null then null else ${shanghai("binding.valid_to")} end valid_to_shanghai,
      binding.binding_source,binding.binding_status,binding.bound_by,
      ${shanghai("binding.bound_at")} bound_at_shanghai,binding.request_id::text,
      mapping.status current_mapping_status,mapping.mapping_version_no::int current_mapping_version,
      mapping.version::int current_mapping_row_version,mapping.content_digest current_mapping_content_digest
    from procurement_rfq_supplier_line_mapping_bindings binding
    join suppliers supplier on supplier.id=binding.supplier_id
    join material_master material on material.id=binding.material_id
    join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
    join units purchase_unit on purchase_unit.id=binding.purchase_unit_id
    left join units internal_unit on internal_unit.id=material.base_unit_id
    where binding.rfq_id=1 order by supplier.supplier_code,binding.supplier_id,
      material.internal_material_code,binding.material_id,binding.id`)).rows;
  assert.equal(bindings.length, 8);
  assert.equal(new Set(bindings.map(({ binding_id }) => binding_id)).size, 8);
  assert.ok(bindings.every((binding) => /^[1-9]\d*$/.test(binding.binding_id)
    && binding.rfq_id === 1 && binding.binding_source === "LEGACY_DRAFT_CONFIRMATION"
    && binding.binding_status === "ACTIVE" && binding.bound_by === "uat_20260729_purchase"
    && binding.bound_at_shanghai === "2026-08-05 22:50:42.192964"
    && binding.request_id === EXPECTED_CONFIRM_REQUEST_ID
    && binding.current_mapping_status === "ACTIVE"
    && binding.current_mapping_version === binding.mapping_version
    && binding.current_mapping_row_version === binding.mapping_row_version
    && binding.current_mapping_content_digest === binding.mapping_content_digest));
  assert.deepEqual(bindings.map(({ binding_id, supplier_id, rfq_line_id, material_id, mapping_id }) => [binding_id, supplier_id, rfq_line_id, material_id, mapping_id]).sort((left, right) => Number(left[0]) - Number(right[0])), EXPECTED_BINDINGS);

  const events = (await client.query(`select event.id::int,event.rfq_id::int,event.event_type,event.actor,
      ${shanghai("event.created_at")} occurred_at_shanghai,event.request_id::text,event.credential_version::int,
      event.result,event.idempotency_key_digest,event.old_version,event.new_version,event.from_status,
      event.to_status,event.scope_digest from procurement_sourcing_events event where event.rfq_id=1 order by event.id`)).rows;
  assert.equal(events.length, 1);
  assert.deepEqual({ event_type: events[0].event_type, actor: events[0].actor, occurred_at_shanghai: events[0].occurred_at_shanghai,
    request_id: events[0].request_id, credential_version: events[0].credential_version, result: events[0].result,
    old_version: events[0].old_version, new_version: events[0].new_version, from_status: events[0].from_status,
    to_status: events[0].to_status, scope_digest: events[0].scope_digest }, {
    event_type: "RFQ_MAPPING_CONFIRMED", actor: "uat_20260729_purchase",
    occurred_at_shanghai: "2026-08-05 22:50:42.192964", request_id: EXPECTED_CONFIRM_REQUEST_ID,
    credential_version: 2, result: "SUCCESS", old_version: 1, new_version: 2,
    from_status: "DRAFT", to_status: "DRAFT", scope_digest: EXPECTED_SCOPE_DIGEST,
  });
  assert.ok(events[0].idempotency_key_digest && /^[0-9a-f]{64}$/.test(events[0].idempotency_key_digest));

  const successCredentials = (await client.query(`select audit.id::int,audit.username,audit.action,
      audit.request_id::text,audit.result,audit.operation_id::text,audit.idempotency_key_digest,
      audit.old_version,audit.new_version,audit.detail->>'object_id' object_id,
      ${shanghai("audit.created_at")} occurred_at_shanghai
    from audit_log audit where audit.route_code='PROCUREMENT_SOURCING' and audit.result='success'
      and audit.action in ('RFQ_CREATED','RFQ_MAPPING_CONFIRMED') and audit.detail->>'object_id'='1'
    order by audit.created_at,audit.id`)).rows;
  assert.equal(successCredentials.length, 2);
  assert.deepEqual(successCredentials.map(({ action, username, old_version, new_version, object_id }) => ({ action, username, old_version, new_version, object_id })), [
    { action: "RFQ_CREATED", username: "uat_20260729_purchase", old_version: null, new_version: 1, object_id: "1" },
    { action: "RFQ_MAPPING_CONFIRMED", username: "uat_20260729_purchase", old_version: 1, new_version: 2, object_id: "1" },
  ]);

  const sourcingIdempotency = (await client.query(`select username,method,path,status_code,key_digest,
      request_digest,response->>'rfq_id' rfq_id,response->>'request_id' request_id,
      response->>'event' event,response->>'result' result,response->>'version' version,
      ${shanghai("created_at")} created_at_shanghai
    from idempotency_keys where path in ('/api/procurement/rfqs','/api/procurement/rfqs/1/mapping-bindings')
      and response->>'rfq_id'='1' order by created_at,key_digest`)).rows;
  assert.equal(sourcingIdempotency.length, 2);
  assert.deepEqual(sourcingIdempotency.map(({ method, path, status_code, event, result, version }) => ({ method, path, status_code, event, result, version })), [
    { method: "POST", path: "/api/procurement/rfqs", status_code: 201, event: null, result: null, version: "1" },
    { method: "POST", path: "/api/procurement/rfqs/1/mapping-bindings", status_code: 200, event: "RFQ_MAPPING_CONFIRMED", result: "SUCCESS", version: "2" },
  ]);

  const downstream = (await client.query(`select
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
      (select count(*)::int from purchase_receipt_delivery_allocations) receipt_delivery_allocations,
      (select count(*)::int from purchase_financial_source_entries) purchase_financial_sources,
      (select count(*)::int from inventory_ledger_entries) inventory_ledger_entries,
      (select count(*)::int from finance_documents where doc_type='AP') ap_documents,
      (select count(*)::int from production_work_orders) work_orders`)).rows[0];
  assert.ok(Object.values(downstream).every((count) => count === 0), JSON.stringify(downstream));

  const population = (await client.query(`select
      (select count(*)::int from procurement_rfqs) rfqs,
      (select count(*)::int from procurement_rfq_lines) rfq_lines,
      (select count(*)::int from procurement_rfq_suppliers) rfq_suppliers,
      (select count(*)::int from procurement_rfq_supplier_line_mapping_bindings) mapping_bindings,
      (select count(*)::int from procurement_sourcing_events) sourcing_events,
      (select count(*)::int from procurement_sourcing_events where event_type='RFQ_MAPPING_CONFIRMED') mapping_confirmed_events,
      (select count(*)::int from procurement_sourcing_events where event_type='RFQ_ISSUED') issued_events,
      (select current_value::int from business_code_sequences where sequence_code='PROCUREMENT_RFQ') rfq_sequence`)).rows[0];
  assert.deepEqual(population, { rfqs: 1, rfq_lines: 4, rfq_suppliers: 2, mapping_bindings: 8,
    sourcing_events: 1, mapping_confirmed_events: 1, issued_events: 0, rfq_sequence: 1 });

  const protectedBusinessState = { rfq, source, lines, suppliers, bindings, events, success_credentials: successCredentials,
    sourcing_idempotency: sourcingIdempotency, population, downstream };
  const protectedBusinessFingerprint = createHash("sha256").update(JSON.stringify(protectedBusinessState)).digest("hex");
  if (expectedHash) assert.equal(protectedBusinessFingerprint, expectedHash);
  console.info(JSON.stringify({ protected_business_fingerprint: protectedBusinessFingerprint,
    mode: captureBaseline ? "CAPTURE_BASELINE" : "VERIFY_EXPECTED_HASH", expected_hash_asserted: Boolean(expectedHash),
    schema, summary: { rfq_id: rfq.rfq_id, rfq_code: rfq.rfq_code, status: rfq.status, version: rfq.version,
      round_no: rfq.round_no, binding_ids: bindings.map(({ binding_id }) => binding_id), binding_count: bindings.length,
      mapping_event: events[0], downstream }, expected_migration_0039_checksum: migrationManifest.get("0039_rfq_traceability.sql") }));
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
