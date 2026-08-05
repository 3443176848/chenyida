import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.ERP_FIX21_DATABASE_URL || process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX21_DATABASE_URL or DATABASE_URL is required");
const databaseName = (process.env.ERP_FIX21_DATABASE_NAME || "").trim();
if (databaseName && !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
  throw new Error("ERP_FIX21_DATABASE_NAME must be a safe PostgreSQL database name");
}
const expectedFingerprint = (process.env.ERP_FIX21_EXPECTED_FINGERPRINT || "").trim();
if (expectedFingerprint && !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
  throw new Error("ERP_FIX21_EXPECTED_FINGERPRINT must be a lowercase SHA-256 digest");
}
const connectionUrl = new URL(databaseUrl);
if (databaseName) connectionUrl.pathname = `/${databaseName}`;

const ACTIVE_MAPPING_ID = "224d1965-44ef-4c3e-901e-1926b6b07ff8";
const EXPECTED_PARTS = [
  [1, 533, "UAT-A-PCBA-042576"],
  [1, 534, "UAT-A-SENSOR-042576"],
  [1, 535, "UAT-A-HARNESS-042576"],
  [1, 536, "UAT-A-CASE-042576"],
  [2, 533, "UAT-B-PCBA-042576"],
  [2, 534, "UAT-B-SENSOR-042576"],
  [2, 535, "UAT-B-HARNESS-042576"],
  [2, 536, "UAT-B-CASE-042576"],
];

const pool = new Pool({ connectionString: connectionUrl.toString(), max: 1, application_name: "supplier-mapping-fix21-protection" });
const client = await pool.connect();
try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");

  const migration = (await client.query(`select count(*)::int migration_count,max(version) head_version,
    (array_agg(checksum order by version desc))[1] head_checksum,
    (select count(*)::int from pg_tables where schemaname='public') public_table_count
    from schema_migrations`)).rows[0];
  assert.deepEqual(migration, {
    migration_count: 38,
    head_version: "0038_supplier_mapping_governance.sql",
    head_checksum: "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941",
    public_table_count: 225,
  });

  const purchaseRequest = (await client.query(`select id::int,request_code,status
    from planning_purchase_requests where id=1`)).rows[0];
  assert.deepEqual(purchaseRequest, { id: 1, request_code: "PRQ-00000001", status: "ACCEPTED" });

  const sources = {
    suppliers: (await client.query(`select id::int,supplier_code,supplier_name,status
      from suppliers where id in (1,2) order by id`)).rows,
    materials: (await client.query(`select id::int,internal_material_code,standard_name,material_status,base_uom,base_unit_id::int
      from material_master where id in (533,534,535,536) order by id`)).rows,
  };
  assert.deepEqual(sources.suppliers.map(({ id, supplier_code, status }) => ({ id, supplier_code, status })), [
    { id: 1, supplier_code: "SUP-000001", status: "ACTIVE" },
    { id: 2, supplier_code: "SUP-000002", status: "ACTIVE" },
  ]);
  assert.deepEqual(sources.materials.map(({ id, internal_material_code, material_status, base_uom, base_unit_id }) => (
    { id, internal_material_code, material_status, base_uom, base_unit_id }
  )), [
    { id: 533, internal_material_code: "CYD-RB_PCB-000016", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
    { id: 534, internal_material_code: "CYD-RB_SENSOR-000003", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
    { id: 535, internal_material_code: "CYD-RB_CONN-000075", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
    { id: 536, internal_material_code: "CYD-RB_METAL-000015", material_status: "ACTIVE", base_uom: "PCS", base_unit_id: null },
  ]);

  const mappings = (await client.query(`select sm.id::int mapping_version_id,sm.mapping_uid::text mapping_id,
    sm.mapping_version_no::int mapping_version,sm.version::int cas,sm.status,
    sm.supplier_id::int,s.supplier_code,s.supplier_name,s.status supplier_status,
    sm.material_id::int,m.internal_material_code,m.standard_name,m.material_status,
    sm.supplier_item_code supplier_part_number,sm.supplier_item_code_normalized,
    sm.supplier_item_name,sm.supplier_specification,sm.manufacturer,sm.mpn,sm.revision,
    sm.purchase_unit_id::int,pu.code supplier_unit,bu.id::int internal_unit_id,bu.code internal_unit,
    sm.conversion_numerator::text,sm.conversion_denominator::text,
    to_char(sm.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
    case when sm.valid_to is null then null else to_char(sm.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to,
    sm.content_digest,sm.created_by,
    to_char(sm.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at,
    sm.created_request_id::text,sm.submitted_by,
    case when sm.submitted_at is null then null else to_char(sm.submitted_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') end submitted_at,
    sm.submitted_request_id::text,sm.reviewed_by,
    case when sm.reviewed_at is null then null else to_char(sm.reviewed_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') end reviewed_at,
    sm.reviewed_request_id::text,sm.review_outcome,sm.review_reason,sm.request_id::text
    from supplier_mappings sm
    join suppliers s on s.id=sm.supplier_id
    join material_master m on m.id=sm.material_id
    join units pu on pu.id=sm.purchase_unit_id
    left join units bu on ((m.base_unit_id is not null and bu.id=m.base_unit_id)
      or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(bu.code)=upper(btrim(m.base_uom))))
    order by sm.mapping_uid,sm.mapping_version_no`)).rows;
  assert.equal(mappings.length, 8);
  assert.deepEqual(mappings.map(({ supplier_id, material_id, supplier_part_number }) => (
    [supplier_id, material_id, supplier_part_number]
  )).sort((left, right) => left[0] - right[0] || left[1] - right[1]), EXPECTED_PARTS);
  const activeMappings = mappings.filter(({ status }) => status === "ACTIVE");
  const pendingMappings = mappings.filter(({ status }) => status === "PENDING_REVIEW");
  assert.equal(activeMappings.length, 1);
  assert.equal(pendingMappings.length, 7);
  assert.equal(mappings.filter(({ status }) => status === "REJECTED").length, 0);
  const active = activeMappings[0];
  assert.deepEqual({
    mapping_id: active.mapping_id,
    mapping_version: active.mapping_version,
    cas: active.cas,
    supplier_id: active.supplier_id,
    supplier_code: active.supplier_code,
    material_id: active.material_id,
    material_code: active.internal_material_code,
    supplier_part_number: active.supplier_part_number,
    supplier_unit: active.supplier_unit,
    internal_unit: active.internal_unit,
    numerator: active.conversion_numerator,
    denominator: active.conversion_denominator,
    valid_from: active.valid_from,
    valid_to: active.valid_to,
    created_by: active.created_by,
    submitted_by: active.submitted_by,
    reviewed_by: active.reviewed_by,
    review_outcome: active.review_outcome,
    review_reason: active.review_reason,
  }, {
    mapping_id: ACTIVE_MAPPING_ID,
    mapping_version: 1,
    cas: 3,
    supplier_id: 1,
    supplier_code: "SUP-000001",
    material_id: 533,
    material_code: "CYD-RB_PCB-000016",
    supplier_part_number: "UAT-A-PCBA-042576",
    supplier_unit: "PCS",
    internal_unit: "PCS",
    numerator: "1",
    denominator: "1",
    valid_from: "2026-08-05",
    valid_to: null,
    created_by: "uat_20260729_purchase",
    submitted_by: "uat_20260729_purchase",
    reviewed_by: "uat_20260729_operations",
    review_outcome: "APPROVED",
    review_reason: "",
  });
  for (const pending of pendingMappings) {
    assert.equal(pending.mapping_version, 1);
    assert.equal(pending.cas, 2);
    assert.equal(pending.created_by, "uat_20260729_purchase");
    assert.equal(pending.submitted_by, "uat_20260729_purchase");
    assert.equal(pending.reviewed_by, null);
    assert.equal(pending.reviewed_at, null);
    assert.equal(pending.review_outcome, null);
    assert.equal(pending.review_reason, "");
  }

  const events = (await client.query(`select e.id::int,e.mapping_uid::text mapping_id,e.mapping_version_id::int,
    e.mapping_version_no::int mapping_version,e.event_type,e.from_status,e.to_status,e.actor,e.reason,
    e.request_id::text,e.result,to_char(e.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at
    from supplier_mapping_events e order by e.id`)).rows;
  const eventCounts = Object.fromEntries((await client.query(`select event_type,count(*)::int count
    from supplier_mapping_events group by event_type order by event_type`)).rows.map(({ event_type, count }) => [event_type, count]));
  assert.deepEqual(eventCounts, { APPROVED: 1, CREATED: 8, SUBMITTED: 8 });
  const approvedEvent = events.find(({ event_type }) => event_type === "APPROVED");
  assert.ok(approvedEvent);
  assert.deepEqual({
    mapping_id: approvedEvent.mapping_id,
    mapping_version: approvedEvent.mapping_version,
    from_status: approvedEvent.from_status,
    to_status: approvedEvent.to_status,
    actor: approvedEvent.actor,
    reason: approvedEvent.reason,
    request_id: approvedEvent.request_id,
    result: approvedEvent.result,
  }, {
    mapping_id: ACTIVE_MAPPING_ID,
    mapping_version: 1,
    from_status: "PENDING_REVIEW",
    to_status: "ACTIVE",
    actor: "uat_20260729_operations",
    reason: "",
    request_id: "b38c84b9-29a1-47ab-b68b-a6baf56e7121",
    result: "SUCCESS",
  });

  const eventAudits = (await client.query(`select a.id::int,a.username,a.action,a.request_id::text,a.result,
    a.old_version,a.new_version,a.error_code,a.detail->>'mapping_id' mapping_id,
    (a.detail->>'mapping_version')::int mapping_version,(a.detail->>'mapping_version_id')::int mapping_version_id,
    a.detail->>'status' status,to_char(a.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at
    from audit_log a where a.request_id in (select request_id from supplier_mapping_events) order by a.id`)).rows;
  assert.equal(eventAudits.length, 17);
  assert.ok(eventAudits.every(({ result, error_code }) => result === "success" && error_code === null));
  const approvedAudit = eventAudits.find(({ action }) => action === "SUPPLIER_MAPPING_APPROVED");
  assert.ok(approvedAudit);
  assert.deepEqual({
    username: approvedAudit.username,
    request_id: approvedAudit.request_id,
    result: approvedAudit.result,
    old_version: approvedAudit.old_version,
    new_version: approvedAudit.new_version,
    mapping_id: approvedAudit.mapping_id,
    mapping_version: approvedAudit.mapping_version,
    status: approvedAudit.status,
  }, {
    username: "uat_20260729_operations",
    request_id: "b38c84b9-29a1-47ab-b68b-a6baf56e7121",
    result: "success",
    old_version: 2,
    new_version: 3,
    mapping_id: ACTIVE_MAPPING_ID,
    mapping_version: 1,
    status: "ACTIVE",
  });

  const claims = (await client.query(`select supplier_id::int,normalized_supplier_item_code,mapping_uid::text,
    created_by,request_id::text,to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at
    from supplier_mapping_supplier_part_keys order by supplier_id,normalized_supplier_item_code`)).rows;
  assert.equal(claims.length, 8);

  const downstream = (await client.query(`select
    (select count(*)::int from procurement_rfqs) rfq,
    (select count(*)::int from procurement_supplier_quotes) quote,
    (select count(*)::int from procurement_sourcing_awards) award,
    (select count(*)::int from purchase_orders) purchase_order`)).rows[0];
  assert.deepEqual(downstream, { rfq: 0, quote: 0, award: 0, purchase_order: 0 });
  const activeSessions = Number((await client.query(`select count(*) count from app_sessions
    where revoked_at is null and expires_at>now()`)).rows[0].count);
  assert.equal(activeSessions, 0);

  const protectedBusinessState = {
    purchase_request: purchaseRequest,
    sources,
    mappings,
    events,
    event_audits: eventAudits,
    supplier_part_claims: claims,
    downstream,
    active_sessions: activeSessions,
  };
  const protectedBusinessFingerprint = createHash("sha256").update(JSON.stringify(protectedBusinessState)).digest("hex");
  if (expectedFingerprint) assert.equal(protectedBusinessFingerprint, expectedFingerprint);

  console.info(JSON.stringify({
    protected_business_fingerprint: protectedBusinessFingerprint,
    migration,
    mapping_counts: { total: mappings.length, active: activeMappings.length, pending_review: pendingMappings.length, rejected: 0 },
    event_counts: eventCounts,
    downstream,
    active_sessions: activeSessions,
    historical_active_receipt: {
      mapping_id: active.mapping_id,
      decision: "APPROVE",
      actor: approvedEvent.actor,
      occurred_at_asia_shanghai: approvedEvent.occurred_at,
      request_id: approvedEvent.request_id,
      result: approvedEvent.result,
      review_comment: null,
      review_comment_display: "历史批准未采集审核意见",
      before: { mapping_version: 1, cas: approvedAudit.old_version },
      after: { mapping_version: 1, cas: approvedAudit.new_version },
      final_status: active.status,
      supplier: { id: active.supplier_id, code: active.supplier_code },
      material: { id: active.material_id, code: active.internal_material_code },
      supplier_part_number: active.supplier_part_number,
      units: { supplier: active.supplier_unit, internal: active.internal_unit },
      conversion: `${active.conversion_numerator}:${active.conversion_denominator}`,
      validity: { valid_from: active.valid_from, valid_to: active.valid_to },
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
