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

const cli = process.argv.slice(2);
let expectedHash = (process.env.ERP_FIX22_EXPECTED_HASH || "").trim();
let captureBaseline = false;
for (let index = 0; index < cli.length; index += 1) {
  const argument = cli[index];
  if (argument === "--capture-baseline") {
    if (captureBaseline) throw new Error("--capture-baseline may only be provided once");
    captureBaseline = true;
  } else if (argument === "--expected-hash") {
    if (index + 1 >= cli.length || expectedHash) throw new Error("--expected-hash requires one unique SHA-256 value");
    const candidate = cli[index + 1];
    if (!/^[0-9a-f]{64}$/.test(candidate)) throw new Error("--expected-hash requires one lowercase SHA-256 digest");
    expectedHash = candidate;
    index += 1;
  } else if (argument.startsWith("--expected-hash=")) {
    if (expectedHash) throw new Error("--expected-hash may only be provided once");
    const candidate = argument.slice("--expected-hash=".length);
    if (!/^[0-9a-f]{64}$/.test(candidate)) throw new Error("--expected-hash requires one lowercase SHA-256 digest");
    expectedHash = candidate;
  } else {
    throw new Error(`unsupported argument: ${argument}`);
  }
}
if (expectedHash && !/^[0-9a-f]{64}$/.test(expectedHash)) {
  throw new Error("expected hash must be one lowercase SHA-256 digest");
}
if (captureBaseline && expectedHash) throw new Error("--capture-baseline and --expected-hash are mutually exclusive");
if (!captureBaseline && !expectedHash) throw new Error("normal verification requires --expected-hash; use --capture-baseline only for the authorized initial capture");

const databaseUrl = process.env.ERP_FIX22_DATABASE_URL || process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX22_DATABASE_URL or DATABASE_URL is required");
const expectedDatabaseName = (process.env.ERP_FIX22_DATABASE_NAME || "").trim();
if (!/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabaseName)) {
  throw new Error("ERP_FIX22_DATABASE_NAME must be an explicit safe PostgreSQL database name");
}
const connectionUrl = new URL(databaseUrl);
const targetDatabaseName = decodeURIComponent(connectionUrl.pathname.replace(/^\//, ""));
if (targetDatabaseName !== expectedDatabaseName) {
  throw new Error(`database URL must target the explicitly confirmed ${expectedDatabaseName} database`);
}

const EXPECTED_MAPPINGS = [
  [1, 533, "224d1965-44ef-4c3e-901e-1926b6b07ff8", "UAT-A-PCBA-042576"],
  [1, 534, "43ca04d8-9933-4dac-ba21-b7fb85741830", "UAT-A-SENSOR-042576"],
  [1, 535, "aa16f7e7-904d-4ae2-9f73-d34e7aaf257e", "UAT-A-HARNESS-042576"],
  [1, 536, "9659ad2d-406a-4c4c-b575-51329badc63f", "UAT-A-CASE-042576"],
  [2, 533, "45a3daf1-4e97-4a01-a94d-1f3089d3961b", "UAT-B-PCBA-042576"],
  [2, 534, "5bd2ced5-6696-4e69-a833-e886cf5e273f", "UAT-B-SENSOR-042576"],
  [2, 535, "3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6", "UAT-B-HARNESS-042576"],
  [2, 536, "5432e7fc-463a-4cea-99fe-f3db8cf0af83", "UAT-B-CASE-042576"],
];

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  max: 1,
  application_name: "rfq-traceability-fix22-protection",
});
const client = await pool.connect();

const shanghai = (column) => `to_char(${column} at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US')`;

try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");

  const connectionFacts = (await client.query(`select current_database() database_name,
    current_setting('transaction_read_only') transaction_read_only`)).rows[0];
  assert.deepEqual(connectionFacts, { database_name: expectedDatabaseName, transaction_read_only: "on" });

  const schemaFacts = (await client.query(`select count(*)::int migration_count,max(version) head_version,
      (array_agg(checksum order by version desc))[1] head_checksum,
      max(checksum) filter(where version='0038_supplier_mapping_governance.sql') migration_0038_checksum,
      (select count(*)::int from pg_tables where schemaname='public') public_table_count,
      to_regclass('public.procurement_rfq_supplier_line_mapping_bindings') is not null has_binding_table,
      exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='procurement_rfqs' and column_name='traceability_version') has_traceability_generation,
      (select count(*)=8 from information_schema.columns where table_schema='public'
        and table_name='procurement_sourcing_events'
        and column_name=any(array['credential_version','result','idempotency_key_digest','old_version',
          'new_version','from_status','to_status','scope_digest'])) has_event_credential_columns
    from schema_migrations`)).rows[0];
  const migrationLedger = (await client.query("select version,checksum from schema_migrations order by version")).rows;
  assert.deepEqual(migrationLedger, migrationNames.slice(0, schemaFacts.migration_count).map((version) => ({
    version,
    checksum: migrationManifest.get(version),
  })));
  assert.equal(schemaFacts.head_checksum, migrationManifest.get(schemaFacts.head_version));
  assert.equal(schemaFacts.migration_0038_checksum, "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941");
  if (schemaFacts.migration_count === 38) {
    assert.deepEqual({
      head_version: schemaFacts.head_version,
      public_table_count: schemaFacts.public_table_count,
      has_binding_table: schemaFacts.has_binding_table,
      has_traceability_generation: schemaFacts.has_traceability_generation,
      has_event_credential_columns: schemaFacts.has_event_credential_columns,
    }, {
      head_version: "0038_supplier_mapping_governance.sql",
      public_table_count: 225,
      has_binding_table: false,
      has_traceability_generation: false,
      has_event_credential_columns: false,
    });
  } else {
    assert.equal(schemaFacts.migration_count, 39);
    assert.deepEqual({
      head_version: schemaFacts.head_version,
      public_table_count: schemaFacts.public_table_count,
      has_binding_table: schemaFacts.has_binding_table,
      has_traceability_generation: schemaFacts.has_traceability_generation,
      has_event_credential_columns: schemaFacts.has_event_credential_columns,
    }, {
      head_version: "0039_rfq_traceability.sql",
      public_table_count: 226,
      has_binding_table: true,
      has_traceability_generation: true,
      has_event_credential_columns: true,
    });
  }

  const rfq = (await client.query(`select q.id::int rfq_id,q.rfq_code,q.purchase_request_id::int,
      q.round_no::int,q.status,q.response_deadline::text,q.currency_code,
      q.source_purchase_request_version::int,q.source_digest,
      ${schemaFacts.has_binding_table ? "q.traceability_version" : "1"}::int traceability_version,
      q.version::int,q.request_id::text,
      q.created_by,${shanghai("q.created_at")} created_at_shanghai,q.issued_by,
      case when q.issued_at is null then null else ${shanghai("q.issued_at")} end issued_at_shanghai,
      case when q.closed_at is null then null else ${shanghai("q.closed_at")} end closed_at_shanghai,
      ${shanghai("q.updated_at")} updated_at_shanghai
    from procurement_rfqs q where q.id=1`)).rows[0];
  assert.deepEqual({
    rfq_id: rfq?.rfq_id,
    rfq_code: rfq?.rfq_code,
    purchase_request_id: rfq?.purchase_request_id,
    round_no: rfq?.round_no,
    status: rfq?.status,
    response_deadline: rfq?.response_deadline,
    currency_code: rfq?.currency_code,
    source_purchase_request_version: rfq?.source_purchase_request_version,
    traceability_version: rfq?.traceability_version,
    version: rfq?.version,
    request_id: rfq?.request_id,
    created_by: rfq?.created_by,
    created_at_shanghai: rfq?.created_at_shanghai,
    issued_by: rfq?.issued_by,
    issued_at_shanghai: rfq?.issued_at_shanghai,
  }, {
    rfq_id: 1,
    rfq_code: "RFQ-00000001",
    purchase_request_id: 1,
    round_no: 1,
    status: "DRAFT",
    response_deadline: "2026-08-31",
    currency_code: "CNY",
    source_purchase_request_version: 2,
    traceability_version: 1,
    version: 1,
    request_id: "75078325-3b3a-4d1e-b911-99cbd5f802db",
    created_by: "uat_20260729_purchase",
    created_at_shanghai: "2026-08-05 15:24:26.684817",
    issued_by: null,
    issued_at_shanghai: null,
  });
  assert.equal(rfq.closed_at_shanghai, null);

  const purchaseRequest = (await client.query(`select request.id::int purchase_request_id,request.request_code,
      request.plan_id::int,request.status,request.submitted_by,${shanghai("request.submitted_at")} submitted_at_shanghai,
      request.accepted_by,case when request.accepted_at is null then null else ${shanghai("request.accepted_at")} end accepted_at_shanghai,
      request.returned_by,case when request.returned_at is null then null else ${shanghai("request.returned_at")} end returned_at_shanghai,
      request.return_reason,request.version::int,request.request_id::text,${shanghai("request.updated_at")} updated_at_shanghai,
      plan.id::int plan_id,plan.plan_version_no::int,plan.status plan_status,plan.required_date::text,
      project.id::int project_id,project.project_code,project.project_name,project.status project_status
    from planning_purchase_requests request
    join planning_material_requirement_plans plan on plan.id=request.plan_id
    join business_projects project on project.id=plan.project_id
    where request.id=1`)).rows[0];
  assert.deepEqual({
    purchase_request_id: purchaseRequest?.purchase_request_id,
    request_code: purchaseRequest?.request_code,
    status: purchaseRequest?.status,
    version: purchaseRequest?.version,
    project_code: purchaseRequest?.project_code,
  }, {
    purchase_request_id: 1,
    request_code: "PRQ-00000001",
    status: "ACCEPTED",
    version: 2,
    project_code: "PRJ-00000001",
  });

  const purchaseDecisionEvents = (await client.query(`select event.id::int,event.plan_id::int,
      event.purchase_request_id::int,event.event_type,event.from_status,event.to_status,event.actor,
      event.reason,event.request_id::text,${shanghai("event.created_at")} occurred_at_shanghai
    from planning_material_requirement_events event where event.purchase_request_id=1 order by event.id`)).rows;
  assert.equal(purchaseDecisionEvents.filter(({ event_type }) => event_type === "PURCHASE_ACCEPTED").length, 1);
  assert.equal(purchaseDecisionEvents.filter(({ event_type }) => event_type === "PURCHASE_RETURNED").length, 0);

  const lines = (await client.query(`select line.id::int rfq_line_id,line.rfq_id::int,
      line.purchase_request_line_id::int,request_line.plan_line_id::int,line.line_no::int,
      line.material_id::int,material.internal_material_code,material.standard_name,material.material_status,
      line.unit_id::int,unit.code unit_code,line.requested_quantity::numeric(24,6)::text,
      line.required_date::text,line.source_digest,${shanghai("line.created_at")} created_at_shanghai,
      request_line.line_no::int purchase_request_line_no,
      request_line.requested_quantity::numeric(24,6)::text purchase_request_quantity
    from procurement_rfq_lines line
    join planning_purchase_request_lines request_line on request_line.id=line.purchase_request_line_id
    join material_master material on material.id=line.material_id
    join units unit on unit.id=line.unit_id
    where line.rfq_id=1 order by line.line_no,line.id`)).rows;
  assert.deepEqual(lines.map((line) => ({
    rfq_line_id: line.rfq_line_id,
    purchase_request_line_id: line.purchase_request_line_id,
    line_no: line.line_no,
    material_id: line.material_id,
    quantity: line.requested_quantity,
    unit_code: line.unit_code,
  })), [
    { rfq_line_id: 1, purchase_request_line_id: 1, line_no: 1, material_id: 533, quantity: "10.000000", unit_code: "PCS" },
    { rfq_line_id: 2, purchase_request_line_id: 2, line_no: 2, material_id: 534, quantity: "10.000000", unit_code: "PCS" },
    { rfq_line_id: 3, purchase_request_line_id: 3, line_no: 3, material_id: 535, quantity: "10.000000", unit_code: "PCS" },
    { rfq_line_id: 4, purchase_request_line_id: 4, line_no: 4, material_id: 536, quantity: "10.000000", unit_code: "PCS" },
  ]);

  const invitations = (await client.query(`select invitation.id::int rfq_supplier_id,
      invitation.rfq_id::int,invitation.supplier_id::int,supplier.supplier_code,supplier.supplier_name,
      supplier.status supplier_status,invitation.status invitation_status,invitation.invited_by,
      ${shanghai("invitation.invited_at")} invited_at_shanghai,
      case when invitation.responded_at is null then null else ${shanghai("invitation.responded_at")} end responded_at_shanghai,
      invitation.supplier_mapping_digest
    from procurement_rfq_suppliers invitation join suppliers supplier on supplier.id=invitation.supplier_id
    where invitation.rfq_id=1 order by invitation.supplier_id,invitation.id`)).rows;
  assert.deepEqual(invitations.map(({ supplier_id, supplier_code, supplier_status, invitation_status }) => ({
    supplier_id, supplier_code, supplier_status, invitation_status,
  })), [
    { supplier_id: 1, supplier_code: "SUP-000001", supplier_status: "ACTIVE", invitation_status: "INVITED" },
    { supplier_id: 2, supplier_code: "SUP-000002", supplier_status: "ACTIVE", invitation_status: "INVITED" },
  ]);
  assert.ok(invitations.every(({ responded_at_shanghai }) => responded_at_shanghai === null));

  const mappings = (await client.query(`select mapping.id::int mapping_version_id,
      mapping.mapping_uid::text mapping_id,mapping.mapping_version_no::int mapping_version,
      mapping.version::int mapping_row_version,mapping.status,mapping.supplier_id::int,
      supplier.supplier_code,supplier.supplier_name,supplier.status supplier_status,
      mapping.material_id::int,material.internal_material_code,material.standard_name,material.material_status,
      mapping.supplier_item_code supplier_part_number,mapping.supplier_item_code_normalized,
      mapping.supplier_item_name,mapping.supplier_specification,mapping.manufacturer,mapping.mpn,mapping.revision,
      mapping.purchase_unit_id::int,purchase_unit.code purchase_unit_code,
      internal_unit.id::int internal_unit_id,internal_unit.code internal_unit_code,
      mapping.conversion_numerator::text,mapping.conversion_denominator::text,
      ${shanghai("mapping.valid_from")} valid_from_shanghai,
      case when mapping.valid_to is null then null else ${shanghai("mapping.valid_to")} end valid_to_shanghai,
      mapping.content_digest,mapping.created_by,${shanghai("mapping.created_at")} created_at_shanghai,
      mapping.created_request_id::text,mapping.submitted_by,
      case when mapping.submitted_at is null then null else ${shanghai("mapping.submitted_at")} end submitted_at_shanghai,
      mapping.submitted_request_id::text,mapping.reviewed_by,
      case when mapping.reviewed_at is null then null else ${shanghai("mapping.reviewed_at")} end reviewed_at_shanghai,
      mapping.reviewed_request_id::text,mapping.review_outcome,mapping.review_reason,mapping.request_id::text
    from supplier_mappings mapping
    join suppliers supplier on supplier.id=mapping.supplier_id
    join material_master material on material.id=mapping.material_id
    join units purchase_unit on purchase_unit.id=mapping.purchase_unit_id
    left join units internal_unit on ((material.base_unit_id is not null and internal_unit.id=material.base_unit_id)
      or (material.base_unit_id is null and nullif(btrim(material.base_uom),'') is not null
        and upper(internal_unit.code)=upper(btrim(material.base_uom))))
    where mapping.supplier_id in (1,2) and mapping.material_id in (533,534,535,536)
    order by mapping.supplier_id,mapping.material_id,mapping.mapping_version_no,mapping.id`)).rows;
  const mappingPopulation = (await client.query(`select count(*)::int total_mapping_count,
    count(*) filter(where status='ACTIVE')::int active_mapping_count from supplier_mappings`)).rows[0];
  assert.deepEqual(mappingPopulation, { total_mapping_count: 8, active_mapping_count: 8 });
  assert.equal(mappings.length, 8);
  assert.deepEqual(mappings.map((mapping) => [
    mapping.supplier_id,
    mapping.material_id,
    mapping.mapping_id,
    mapping.supplier_part_number,
  ]), EXPECTED_MAPPINGS);
  for (const mapping of mappings) {
    assert.deepEqual({
      status: mapping.status,
      mapping_version: mapping.mapping_version,
      mapping_row_version: mapping.mapping_row_version,
      supplier_status: mapping.supplier_status,
      material_status: mapping.material_status,
      purchase_unit_code: mapping.purchase_unit_code,
      internal_unit_code: mapping.internal_unit_code,
      conversion_numerator: mapping.conversion_numerator,
      conversion_denominator: mapping.conversion_denominator,
    }, {
      status: "ACTIVE",
      mapping_version: 1,
      mapping_row_version: 3,
      supplier_status: "ACTIVE",
      material_status: "ACTIVE",
      purchase_unit_code: "PCS",
      internal_unit_code: "PCS",
      conversion_numerator: "1",
      conversion_denominator: "1",
    });
  }

  const creationAudits = (await client.query(`select audit.id::int,audit.username,audit.action,
      audit.request_id::text,audit.result,audit.route_code,audit.operation_id::text,
      audit.idempotency_key_digest,audit.old_version,audit.new_version,audit.error_code,
      audit.detail->>'object_id' object_id,${shanghai("audit.created_at")} occurred_at_shanghai
    from audit_log audit
    where audit.route_code='PROCUREMENT_SOURCING' and audit.action='RFQ_CREATED'
      and audit.result='success' and audit.request_id=$1::uuid and audit.username=$2
      and audit.detail->>'object_id'='1'
    order by audit.id`, [rfq.request_id, rfq.created_by])).rows;
  assert.equal(creationAudits.length, 1);
  assert.deepEqual({
    username: creationAudits[0].username,
    action: creationAudits[0].action,
    request_id: creationAudits[0].request_id,
    result: creationAudits[0].result,
    route_code: creationAudits[0].route_code,
    old_version: creationAudits[0].old_version,
    new_version: creationAudits[0].new_version,
    error_code: creationAudits[0].error_code,
    object_id: creationAudits[0].object_id,
  }, {
    username: "uat_20260729_purchase",
    action: "RFQ_CREATED",
    request_id: "75078325-3b3a-4d1e-b911-99cbd5f802db",
    result: "success",
    route_code: "PROCUREMENT_SOURCING",
    old_version: null,
    new_version: 1,
    error_code: null,
    object_id: "1",
  });
  assert.match(creationAudits[0].idempotency_key_digest, /^[0-9a-f]{64}$/);
  assert.match(creationAudits[0].operation_id, /^[0-9a-f-]{36}$/);
  assert.equal(creationAudits[0].occurred_at_shanghai, rfq.created_at_shanghai);

  const events = schemaFacts.has_event_credential_columns
    ? (await client.query(`select event.id::int,event.rfq_id::int,event.quote_id::int,
        event.comparison_id::int,event.award_id::int,event.event_type,event.actor,event.request_id::text,
        event.reason,event.credential_version::int,event.result,event.idempotency_key_digest,
        event.old_version,event.new_version,event.from_status,event.to_status,event.scope_digest,
        ${shanghai("event.created_at")} occurred_at_shanghai
      from procurement_sourcing_events event where event.rfq_id=1 order by event.id`)).rows
    : (await client.query(`select event.id::int,event.rfq_id::int,event.quote_id::int,
        event.comparison_id::int,event.award_id::int,event.event_type,event.actor,event.request_id::text,
        event.reason,1::int credential_version,'SUCCESS'::text result,null::text idempotency_key_digest,
        null::int old_version,null::int new_version,null::text from_status,null::text to_status,
        null::text scope_digest,${shanghai("event.created_at")} occurred_at_shanghai
      from procurement_sourcing_events event where event.rfq_id=1 order by event.id`)).rows;
  assert.deepEqual(events, []);

  const bindings = schemaFacts.has_binding_table
    ? (await client.query(`select binding.id::int,binding.rfq_id::int,binding.rfq_supplier_id::int,
        binding.rfq_line_id::int,binding.supplier_id::int,binding.material_id::int,
        binding.supplier_mapping_version_id::int,binding.mapping_uid::text,binding.mapping_version_no::int,
        binding.mapping_row_version::int,binding.mapping_content_digest,binding.supplier_part_number,
        binding.purchase_unit_id::int,binding.conversion_numerator::text,binding.conversion_denominator::text,
        ${shanghai("binding.valid_from")} valid_from_shanghai,
        case when binding.valid_to is null then null else ${shanghai("binding.valid_to")} end valid_to_shanghai,
        binding.binding_source,binding.binding_status,binding.bound_by,
        ${shanghai("binding.bound_at")} bound_at_shanghai,binding.request_id::text
      from procurement_rfq_supplier_line_mapping_bindings binding where binding.rfq_id=1
      order by binding.supplier_id,binding.rfq_line_id,binding.id`)).rows
    : [];
  assert.deepEqual(bindings, []);

  const sourcingPopulation = (await client.query(`select
      (select count(*)::int from procurement_rfqs) rfqs,
      (select count(*)::int from procurement_rfq_lines) rfq_lines,
      (select count(*)::int from procurement_rfq_suppliers) rfq_suppliers,
      (select count(*)::int from procurement_sourcing_events) sourcing_events,
      (select count(*)::int from procurement_supplier_quotes) supplier_quotes,
      (select count(*)::int from procurement_supplier_quote_lines) supplier_quote_lines,
      (select count(*)::int from procurement_quote_comparisons) quote_comparisons,
      (select count(*)::int from procurement_quote_comparison_lines) quote_comparison_lines,
      (select count(*)::int from procurement_sourcing_awards) sourcing_awards,
      (select count(*)::int from procurement_sourcing_award_lines) sourcing_award_lines,
      (select count(*)::int from procurement_award_po_line_links) award_po_links,
      (select count(*)::int from purchase_orders) purchase_orders,
      (select current_value::int from business_code_sequences where sequence_code='PROCUREMENT_RFQ') rfq_sequence`)).rows[0];
  sourcingPopulation.mapping_bindings = schemaFacts.has_binding_table
    ? Number((await client.query("select count(*) count from procurement_rfq_supplier_line_mapping_bindings")).rows[0].count)
    : 0;
  assert.deepEqual(sourcingPopulation, {
    rfqs: 1,
    rfq_lines: 4,
    rfq_suppliers: 2,
    sourcing_events: 0,
    supplier_quotes: 0,
    supplier_quote_lines: 0,
    quote_comparisons: 0,
    quote_comparison_lines: 0,
    sourcing_awards: 0,
    sourcing_award_lines: 0,
    award_po_links: 0,
    purchase_orders: 0,
    rfq_sequence: 1,
    mapping_bindings: 0,
  });

  const sourcingAudits = (await client.query(`select audit.id::int,audit.username,audit.action,
      audit.request_id::text,audit.result,audit.error_code,audit.detail->>'object_id' object_id,
      audit.old_version,audit.new_version,${shanghai("audit.created_at")} occurred_at_shanghai
    from audit_log audit where audit.route_code='PROCUREMENT_SOURCING' order by audit.id`)).rows;
  assert.deepEqual(sourcingAudits.map(({ username, action, result, error_code, object_id }) => ({
    username, action, result, error_code, object_id,
  })), [
    { username: "uat_20260729_purchase", action: "RFQ_CREATED", result: "failed", error_code: "REQUEST_VALIDATION_FAILED", object_id: null },
    { username: "uat_20260729_purchase", action: "RFQ_CREATED", result: "failed", error_code: "SUPPLIER_MAPPING_REQUIRED", object_id: null },
    { username: "uat_20260729_purchase", action: "RFQ_CREATED", result: "success", error_code: null, object_id: "1" },
  ]);

  const sourcingIdempotency = (await client.query(`select username,method,path,status_code,
      key_digest,request_digest,${shanghai("created_at")} created_at_shanghai
    from idempotency_keys where path like '/api/procurement/rfqs%' order by created_at,key_digest`)).rows;
  assert.equal(sourcingIdempotency.length, 1);
  assert.deepEqual({
    username: sourcingIdempotency[0].username,
    method: sourcingIdempotency[0].method,
    path: sourcingIdempotency[0].path,
    status_code: sourcingIdempotency[0].status_code,
  }, {
    username: "uat_20260729_purchase",
    method: "POST",
    path: "/api/procurement/rfqs",
    status_code: 201,
  });

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

  const protectedBusinessState = {
    rfq,
    purchase_request: purchaseRequest,
    purchase_decision_events: purchaseDecisionEvents,
    rfq_lines: lines,
    rfq_supplier_invitations: invitations,
    current_supplier_mappings: mappings,
    supplier_mapping_population: mappingPopulation,
    creation_success_audit: creationAudits,
    rfq_events: events,
    rfq_mapping_bindings: bindings,
    global_sourcing_population: sourcingPopulation,
    global_sourcing_audits: sourcingAudits,
    global_sourcing_idempotency: sourcingIdempotency,
    downstream_counts: downstream,
  };
  const protectedBusinessFingerprint = createHash("sha256")
    .update(JSON.stringify(protectedBusinessState))
    .digest("hex");
  if (expectedHash) assert.equal(protectedBusinessFingerprint, expectedHash);

  console.info(JSON.stringify({
    protected_business_fingerprint: protectedBusinessFingerprint,
    mode: captureBaseline ? "CAPTURE_BASELINE" : "VERIFY_EXPECTED_HASH",
    expected_hash_asserted: Boolean(expectedHash),
    schema_facts: schemaFacts,
    summary: {
      rfq_id: rfq.rfq_id,
      rfq_code: rfq.rfq_code,
      rfq_status: rfq.status,
      rfq_version: rfq.version,
      purchase_request_id: purchaseRequest.purchase_request_id,
      purchase_request_status: purchaseRequest.status,
      line_count: lines.length,
      supplier_invitation_count: invitations.length,
      current_mapping_count: mappings.length,
      total_mapping_count: mappingPopulation.total_mapping_count,
      active_mapping_count: mappingPopulation.active_mapping_count,
      binding_count: bindings.length,
      creation_success_audit_count: creationAudits.length,
      rfq_event_count: events.length,
      global_sourcing_population: sourcingPopulation,
      global_sourcing_audit_count: sourcingAudits.length,
      global_sourcing_idempotency_count: sourcingIdempotency.length,
      downstream,
    },
    business_hash_excludes: ["schema_migrations", "non-RFQ idempotency_keys", "app_sessions"],
    expected_migration_0039_checksum: migrationManifest.get("0039_rfq_traceability.sql"),
  }));

  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
