import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadCurrentSupplyBreakdowns } from "../app/lib/material-requirement-selfhost/current-supply.ts";

const databaseUrl = process.env.ERP_FIX17_DATABASE_URL || process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("ERP_FIX17_DATABASE_URL or DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "purchase-confirmation-fix17-protection" });
const client = await pool.connect();

try {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='15s'; set local lock_timeout='3s'");

  const databaseName = (await client.query("select current_database() name")).rows[0].name;
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
      plan.required_date::text,pr.plan_id::int,plan.plan_version_no::int,plan.status plan_status,plan.version::int plan_version,
      plan.planning_package_id::int package_id,pkg.package_version_no::int,pkg.status package_status,pkg.version::int package_version,
      pkg.package_digest,project.project_code
    from planning_purchase_requests pr
    join planning_material_requirement_plans plan on plan.id=pr.plan_id
    join project_planning_packages pkg on pkg.id=plan.planning_package_id
    join business_projects project on project.id=pkg.project_id
    where pr.id=1 and pr.request_code='PRQ-00000001'`)).rows[0];
  assert.ok(header, "protected PRQ-00000001 is required");

  const events = (await client.query(`select source,event_type,actor,to_char(created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') occurred_at_shanghai,request_id::text
    from (
      select 'PACKAGE'::text source,event_type,actor,created_at,request_id
      from project_planning_handoff_events where package_id=$1 and project_id=(select pkg.project_id from planning_purchase_requests pr join planning_material_requirement_plans plan on plan.id=pr.plan_id join project_planning_packages pkg on pkg.id=plan.planning_package_id where pr.id=1) and event_type='ACCEPTED'
      union all
      select 'PLAN'::text,event_type,actor,created_at,request_id
      from planning_material_requirement_events where plan_id=$2 and event_type in ('GENERATED','REGENERATED')
      union all
      select 'PRQ'::text,event_type,actor,created_at,request_id
      from planning_material_requirement_events where plan_id=$2 and purchase_request_id=1 and event_type='SUBMITTED'
    ) evidence order by source,event_type,request_id`, [header.package_id, header.plan_id])).rows;

  const decisionCounts = (await client.query(`select
      count(*) filter(where event_type='PURCHASE_ACCEPTED')::int accept_count,
      count(*) filter(where event_type='PURCHASE_RETURNED')::int return_count
    from planning_material_requirement_events where plan_id=$1 and purchase_request_id=1`, [header.plan_id])).rows[0];
  const queues = (await client.query(`select
      count(*) filter(where status='SUBMITTED')::int pending_count,
      count(*) filter(where status in ('ACCEPTED','RETURNED'))::int processed_count
    from planning_purchase_requests`)).rows[0];

  const lines = (await client.query(`select rl.id::int line_id,rl.material_id::int,rl.unit_id::int,u.code unit_code,
      pl.gross_requirement::numeric(24,6)::text gross_requirement,
      pl.stock_available::numeric(24,6)::text stock_available,
      pl.stock_allocated::numeric(24,6)::text stock_allocated,
      pl.eligible_inbound::numeric(24,6)::text eligible_inbound,
      pl.inbound_allocated::numeric(24,6)::text inbound_allocated,
      pl.net_purchase_requirement::numeric(24,6)::text net_purchase_requirement,
      rl.requested_quantity::numeric(24,6)::text requested_quantity
    from planning_purchase_request_lines rl
    join planning_material_requirement_lines pl on pl.id=rl.plan_line_id and pl.plan_id=$1
    join units u on u.id=rl.unit_id
    where rl.purchase_request_id=1 order by rl.line_no,rl.id`, [header.plan_id])).rows;
  const currentSupply = await loadCurrentSupplyBreakdowns(client, lines.map((line) => ({
    lineId: line.line_id,
    materialId: line.material_id,
    unitId: line.unit_id,
    snapshotStockAvailable: line.stock_available,
    snapshotStockAllocated: line.stock_allocated,
    snapshotInboundAvailable: line.eligible_inbound,
    snapshotInboundAllocated: line.inbound_allocated,
  })), header.required_date);
  const supply = lines.map((line) => {
    const value = currentSupply.get(line.line_id);
    assert.ok(value, `current supply is required for Material ${line.material_id}`);
    return {
      material_id: line.material_id,
      unit_code: line.unit_code,
      on_hand_qty: value.on_hand_qty,
      reserved_qty: value.reserved_qty,
      frozen_qty: value.frozen_qty,
      inventory_available_qty: value.inventory_available_qty,
      stock_allocated_to_active_plans_qty: value.stock_allocated_to_active_plans_qty,
      unallocated_inventory_available_qty: value.unallocated_inventory_available_qty,
      effective_inbound_qty: value.effective_inbound_qty,
      inbound_allocated_to_active_plans_qty: value.inbound_allocated_to_active_plans_qty,
      unallocated_inbound_available_qty: value.unallocated_inbound_available_qty,
    };
  });

  const inventory = (await client.query(`select b.id::int,b.material_id::int,b.unit_id::int,b.location_code,
      coalesce(b.inventory_lot_id,0)::int inventory_lot_id,b.on_hand_qty::numeric(24,6)::text,
      b.reserved_qty::numeric(24,6)::text,b.frozen_qty::numeric(24,6)::text,b.version::int
    from inventory_stock_balances b where b.material_id=any($1::bigint[]) order by b.id`, [lines.map((line) => line.material_id)])).rows;
  const allocations = (await client.query(`select a.id::int,a.plan_id::int,a.plan_line_id::int,a.allocation_type,
      coalesce(a.purchase_order_line_id,0)::int purchase_order_line_id,a.quantity::numeric(24,6)::text
    from planning_material_allocations a where a.plan_id=$1 order by a.id`, [header.plan_id])).rows;
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
  const identity = (await client.query(`select
      count(*)::int user_count,count(*) filter(where is_active)::int active_user_count,
      count(*) filter(where must_change_password)::int must_change_password_count,
      (select count(*)::int from app_sessions where revoked_at is null and expires_at>now()) active_session_count
    from app_users`)).rows[0];

  const protectedState = { migration, header, events, decision_counts: decisionCounts, queues, lines, supply, inventory, allocations, downstream };
  const fingerprint = createHash("sha256").update(JSON.stringify(protectedState)).digest("hex");
  console.info(JSON.stringify({
    database_name: databaseName,
    fingerprint,
    migration,
    prq: header,
    decision_counts: decisionCounts,
    queues,
    lines,
    supply,
    inventory_row_count: inventory.length,
    allocation_count: allocations.length,
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
