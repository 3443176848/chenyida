import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadCurrentSupplyBreakdowns } from "../app/lib/material-requirement-selfhost/current-supply.ts";

const databaseUrl = process.env.ERP_FIX18_DATABASE_URL || process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX18_DATABASE_URL or DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "purchase-history-fix18-protection" });
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

  const header = (await client.query(`select
      pr.id::int purchase_request_id,pr.request_code,pr.status purchase_request_status,pr.version::int purchase_request_version,
      pr.accepted_by,to_char(pr.accepted_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') accepted_at_shanghai,pr.request_id::text purchase_request_request_id,
      plan.required_date::text,pr.plan_id::int,plan.plan_version_no::int,plan.status plan_status,plan.version::int plan_version,
      plan.accepted_by plan_accepted_by,to_char(plan.accepted_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') plan_accepted_at_shanghai,plan.request_id::text plan_request_id,
      plan.planning_package_id::int package_id,pkg.package_version_no::int,pkg.status package_status,pkg.version::int package_version,
      pkg.package_digest,project.project_code
    from planning_purchase_requests pr
    join planning_material_requirement_plans plan on plan.id=pr.plan_id
    join project_planning_packages pkg on pkg.id=plan.planning_package_id
    join business_projects project on project.id=pkg.project_id
    where pr.id=1 and pr.request_code='PRQ-00000001'`)).rows[0];
  assert.deepEqual(header, {
    purchase_request_id: 1, request_code: "PRQ-00000001", purchase_request_status: "ACCEPTED", purchase_request_version: 2,
    accepted_by: "uat_20260729_purchase", accepted_at_shanghai: "2026-08-04 06:06:15", purchase_request_request_id: "80568b28-47f5-4f58-8901-afc053871998",
    required_date: "2026-10-30", plan_id: 1, plan_version_no: 1, plan_status: "ACCEPTED", plan_version: 3,
    plan_accepted_by: "uat_20260729_purchase", plan_accepted_at_shanghai: "2026-08-04 06:06:15", plan_request_id: "80568b28-47f5-4f58-8901-afc053871998",
    package_id: 2, package_version_no: 2, package_status: "ACCEPTED", package_version: 3,
    package_digest: "d67acce3f1e1a049a4025b29adbc3ec1651f398cd43000a445368b04a28bd822", project_code: "PRJ-00000001",
  });

  const upstreamEvents = (await client.query(`select source,event_type,actor,to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') occurred_at_shanghai,request_id::text
    from (
      select 'PACKAGE'::text source,event_type,actor,created_at,request_id
      from project_planning_handoff_events where package_id=$1 and project_id=(select project_id from project_planning_packages where id=$1) and event_type='ACCEPTED'
      union all
      select 'PLAN'::text,event_type,actor,created_at,request_id
      from planning_material_requirement_events where plan_id=$2 and event_type in ('GENERATED','REGENERATED')
      union all
      select 'PRQ'::text,event_type,actor,created_at,request_id
      from planning_material_requirement_events where plan_id=$2 and purchase_request_id=1 and event_type='SUBMITTED'
    ) evidence order by source,event_type,request_id`, [header.package_id, header.plan_id])).rows;
  assert.deepEqual(upstreamEvents, [
    { source: "PACKAGE", event_type: "ACCEPTED", actor: "uat_20260729_planning", occurred_at_shanghai: "2026-08-03 00:19:09", request_id: "61fcf8bd-3d35-4324-b748-5c34541cbed9" },
    { source: "PLAN", event_type: "GENERATED", actor: "uat_20260729_planning", occurred_at_shanghai: "2026-08-03 08:55:59", request_id: "cd625756-4e4c-451f-8230-eb8b77d4f6e0" },
    { source: "PRQ", event_type: "SUBMITTED", actor: "uat_20260729_planning", occurred_at_shanghai: "2026-08-03 09:00:02", request_id: "5cd10203-a200-464b-9cf1-fd6955273baf" },
  ]);

  const decisionEvents = (await client.query(`select event_type,to_status,actor,
      to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') occurred_at_shanghai,request_id::text
    from planning_material_requirement_events
    where plan_id=$1 and purchase_request_id=1 and event_type in ('PURCHASE_ACCEPTED','PURCHASE_RETURNED') order by id`, [header.plan_id])).rows;
  assert.deepEqual(decisionEvents, [{
    event_type: "PURCHASE_ACCEPTED", to_status: "ACCEPTED", actor: "uat_20260729_purchase",
    occurred_at_shanghai: "2026-08-04 06:06:15", request_id: "80568b28-47f5-4f58-8901-afc053871998",
  }]);

  const decisionCounts = (await client.query(`select
      count(*) filter(where event_type='PURCHASE_ACCEPTED')::int accept_count,
      count(*) filter(where event_type='PURCHASE_RETURNED')::int return_count
    from planning_material_requirement_events where plan_id=$1 and purchase_request_id=1`, [header.plan_id])).rows[0];
  assert.deepEqual(decisionCounts, { accept_count: 1, return_count: 0 });
  const queues = (await client.query(`select count(*) filter(where status='SUBMITTED')::int pending_count,
      count(*) filter(where status in ('ACCEPTED','RETURNED'))::int processed_count from planning_purchase_requests`)).rows[0];
  assert.deepEqual(queues, { pending_count: 0, processed_count: 1 });

  const lines = (await client.query(`select rl.id::int line_id,rl.material_id::int,rl.unit_id::int,u.code unit_code,
      pl.gross_requirement::numeric(24,6)::text gross_requirement,pl.stock_available::numeric(24,6)::text stock_available,
      pl.stock_allocated::numeric(24,6)::text stock_allocated,pl.eligible_inbound::numeric(24,6)::text eligible_inbound,
      pl.inbound_allocated::numeric(24,6)::text inbound_allocated,pl.net_purchase_requirement::numeric(24,6)::text net_purchase_requirement,
      rl.requested_quantity::numeric(24,6)::text requested_quantity
    from planning_purchase_request_lines rl
    join planning_material_requirement_lines pl on pl.id=rl.plan_line_id and pl.plan_id=$1
    join units u on u.id=rl.unit_id where rl.purchase_request_id=1 order by rl.line_no,rl.id`, [header.plan_id])).rows;
  assert.deepEqual(lines.map((line) => ({ line_id: line.line_id, material_id: line.material_id, unit_code: line.unit_code })), [
    { line_id: 1, material_id: 533, unit_code: "PCS" }, { line_id: 2, material_id: 534, unit_code: "PCS" },
    { line_id: 3, material_id: 535, unit_code: "PCS" }, { line_id: 4, material_id: 536, unit_code: "PCS" },
  ]);
  for (const line of lines) assert.deepEqual([
    line.gross_requirement, line.stock_available, line.stock_allocated, line.eligible_inbound,
    line.inbound_allocated, line.net_purchase_requirement, line.requested_quantity,
  ], ["10.000000", "0.000000", "0.000000", "0.000000", "0.000000", "10.000000", "10.000000"]);

  const currentSupply = await loadCurrentSupplyBreakdowns(client, lines.map((line) => ({
    lineId: line.line_id, materialId: line.material_id, unitId: line.unit_id,
    snapshotStockAvailable: line.stock_available, snapshotStockAllocated: line.stock_allocated,
    snapshotInboundAvailable: line.eligible_inbound, snapshotInboundAllocated: line.inbound_allocated,
  })), header.required_date);
  const supplyFields = ["on_hand_qty", "reserved_qty", "frozen_qty", "inventory_available_qty", "stock_allocated_to_active_plans_qty", "unallocated_inventory_available_qty", "effective_inbound_qty", "inbound_allocated_to_active_plans_qty", "unallocated_inbound_available_qty"];
  const supply = lines.map((line) => {
    const value = currentSupply.get(line.line_id); assert.ok(value, `current supply is required for Material ${line.material_id}`);
    for (const field of supplyFields) assert.equal(value[field], "0.000000", `Material ${line.material_id} ${field} must remain zero`);
    return { material_id: line.material_id, unit_code: line.unit_code, ...Object.fromEntries(supplyFields.map((field) => [field, value[field]])) };
  });

  const inventory = (await client.query("select id::int from inventory_stock_balances where material_id=any($1::bigint[]) order by id", [lines.map((line) => line.material_id)])).rows;
  const allocations = (await client.query("select id::int from planning_material_allocations where plan_id=$1 order by id", [header.plan_id])).rows;
  assert.deepEqual(inventory, []); assert.deepEqual(allocations, []);
  const downstream = (await client.query(`select (select count(*)::int from procurement_rfqs) rfq_count,
      (select count(*)::int from procurement_supplier_quotes) quote_count,(select count(*)::int from procurement_sourcing_awards) award_count,
      (select count(*)::int from purchase_orders) purchase_order_count,(select count(*)::int from purchase_delivery_plans) delivery_plan_count,
      (select count(*)::int from purchase_receipts) receipt_count,(select count(*)::int from inventory_ledger_entries) ledger_count,
      (select count(*)::int from finance_documents where doc_type='AP') ap_count,(select count(*)::int from production_work_orders) work_order_count`)).rows[0];
  assert.deepEqual(downstream, { rfq_count: 0, quote_count: 0, award_count: 0, purchase_order_count: 0, delivery_plan_count: 0, receipt_count: 0, ledger_count: 0, ap_count: 0, work_order_count: 0 });
  const identity = (await client.query(`select count(*)::int user_count,count(*) filter(where is_active)::int active_user_count,
      count(*) filter(where must_change_password)::int must_change_password_count,
      (select count(*)::int from app_sessions where revoked_at is null and expires_at>now()) active_session_count from app_users`)).rows[0];
  assert.deepEqual(identity, { user_count: 14, active_user_count: 12, must_change_password_count: 9, active_session_count: 0 });

  const protectedState = { migration, header, upstream_events: upstreamEvents, decision_events: decisionEvents, decision_counts: decisionCounts, queues, lines, supply, inventory, allocations, downstream, identity };
  const fingerprint = createHash("sha256").update(JSON.stringify(protectedState)).digest("hex");
  console.info(JSON.stringify({ fingerprint, migration, prq: header, upstream_events: upstreamEvents, decision_events: decisionEvents, decision_counts: decisionCounts, queues, lines, supply, inventory_row_count: inventory.length, allocation_count: allocations.length, downstream, identity }));
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
