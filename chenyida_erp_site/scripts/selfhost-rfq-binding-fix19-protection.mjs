import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.ERP_FIX19_DATABASE_URL || process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX19_DATABASE_URL or DATABASE_URL is required");
const databaseName = (process.env.ERP_FIX19_DATABASE_NAME || "").trim();
if (databaseName && !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
  throw new Error("ERP_FIX19_DATABASE_NAME must be a safe PostgreSQL database name");
}
const connectionUrl = new URL(databaseUrl);
if (databaseName) connectionUrl.pathname = `/${databaseName}`;

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  max: 1,
  application_name: "rfq-binding-fix19-protection",
});
const client = await pool.connect();

try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");

  const migration = (await client.query(`select count(*)::int migration_count,
      max(version) head_version,
      max(checksum) filter(where version='0037_project_planning_revision_response_lineage.sql') head_checksum
    from schema_migrations`)).rows[0];
  assert.deepEqual(migration, {
    migration_count: 37,
    head_version: "0037_project_planning_revision_response_lineage.sql",
    head_checksum: "139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f",
  });

  const purchaseRequest = (await client.query(`select
      pr.id::int purchase_request_id,
      pr.request_code,
      pr.status,
      project.project_code,
      plan.required_date::text
    from planning_purchase_requests pr
    join planning_material_requirement_plans plan on plan.id=pr.plan_id
    join project_planning_packages package on package.id=plan.planning_package_id
    join business_projects project on project.id=package.project_id
    where pr.id=1`)).rows[0];
  assert.deepEqual(purchaseRequest, {
    purchase_request_id: 1,
    request_code: "PRQ-00000001",
    status: "ACCEPTED",
    project_code: "PRJ-00000001",
    required_date: "2026-10-30",
  });

  const purchaseDecisions = (await client.query(`select
      count(*) filter(where event_type='PURCHASE_ACCEPTED')::int accept_count,
      count(*) filter(where event_type='PURCHASE_RETURNED')::int return_count
    from planning_material_requirement_events
    where purchase_request_id=1`)).rows[0];
  assert.deepEqual(purchaseDecisions, { accept_count: 1, return_count: 0 });

  const requestLines = (await client.query(`select
      line_no::int,
      material_id::int,
      requested_quantity::numeric(24,6)::text,
      units.code unit_code
    from planning_purchase_request_lines lines
    join units on units.id=lines.unit_id
    where purchase_request_id=1
    order by lines.line_no,lines.id`)).rows;
  assert.deepEqual(requestLines, [
    { line_no: 1, material_id: 533, requested_quantity: "10.000000", unit_code: "PCS" },
    { line_no: 2, material_id: 534, requested_quantity: "10.000000", unit_code: "PCS" },
    { line_no: 3, material_id: 535, requested_quantity: "10.000000", unit_code: "PCS" },
    { line_no: 4, material_id: 536, requested_quantity: "10.000000", unit_code: "PCS" },
  ]);

  const suppliers = (await client.query(`select
      id::int supplier_id,
      supplier_code,
      supplier_name,
      status,
      created_by,
      to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') created_at_shanghai
    from suppliers
    where id in (1,2)
    order by id`)).rows;
  assert.deepEqual(suppliers, [
    {
      supplier_id: 1,
      supplier_code: "SUP-000001",
      supplier_name: "UAT快速交付供应商A-042576",
      status: "ACTIVE",
      created_by: "uat_20260729_purchase",
      created_at_shanghai: "2026-08-04 10:52:21",
    },
    {
      supplier_id: 2,
      supplier_code: "SUP-000002",
      supplier_name: "UAT低价延期供应商B-042576",
      status: "ACTIVE",
      created_by: "uat_20260729_purchase",
      created_at_shanghai: "2026-08-04 10:52:45",
    },
  ]);

  const uatSupplierIds = (await client.query(`select array_agg(id::int order by id) supplier_ids
    from suppliers where created_by='uat_20260729_purchase'`)).rows[0]?.supplier_ids ?? [];
  assert.deepEqual(uatSupplierIds, [1, 2]);

  const failureEvidence = (await client.query(`select
      action,
      result,
      route_code,
      error_code,
      request_id::text,
      detail='{}'::jsonb detail_empty
    from audit_log
    where request_id='e2d8caab-a39d-4756-894b-329ae548e3f5'::uuid`)).rows;
  assert.deepEqual(failureEvidence, [{
    action: "RFQ_CREATED",
    result: "failed",
    route_code: "PROCUREMENT_SOURCING",
    error_code: "REQUEST_VALIDATION_FAILED",
    request_id: "e2d8caab-a39d-4756-894b-329ae548e3f5",
    detail_empty: true,
  }]);

  const downstream = (await client.query(`select
      (select count(*)::int from procurement_rfqs) rfq_count,
      (select count(*)::int from procurement_supplier_quotes) quote_count,
      (select count(*)::int from procurement_sourcing_awards) award_count,
      (select count(*)::int from purchase_orders) purchase_order_count,
      (select count(*)::int from purchase_delivery_plans) delivery_plan_count,
      (select count(*)::int from purchase_receipts) receipt_count,
      (select count(*)::int from inventory_ledger_entries) ledger_count,
      (select count(*)::int from finance_documents where doc_type='AP') ap_count,
      (select count(*)::int from production_work_orders) work_order_count`)).rows[0];
  assert.deepEqual(downstream, {
    rfq_count: 0,
    quote_count: 0,
    award_count: 0,
    purchase_order_count: 0,
    delivery_plan_count: 0,
    receipt_count: 0,
    ledger_count: 0,
    ap_count: 0,
    work_order_count: 0,
  });

  const identity = (await client.query(`select
      count(*)::int user_count,
      count(*) filter(where is_active)::int active_user_count,
      count(*) filter(where must_change_password)::int must_change_password_count,
      (select count(*)::int from app_sessions where revoked_at is null and expires_at>now()) active_session_count
    from app_users`)).rows[0];
  assert.deepEqual(identity, {
    user_count: 14,
    active_user_count: 12,
    must_change_password_count: 9,
    active_session_count: 0,
  });

  const protectedState = {
    migration,
    purchase_request: purchaseRequest,
    purchase_decisions: purchaseDecisions,
    request_lines: requestLines,
    suppliers,
    uat_supplier_ids: uatSupplierIds,
    failure_evidence: failureEvidence,
    downstream,
    identity,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(protectedState)).digest("hex");
  console.info(JSON.stringify({
    fingerprint,
    migration_count: migration.migration_count,
    head_version: migration.head_version,
    purchase_request_id: purchaseRequest.purchase_request_id,
    request_line_count: requestLines.length,
    supplier_ids: suppliers.map((supplier) => supplier.supplier_id),
    downstream,
    identity,
  }));

  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
