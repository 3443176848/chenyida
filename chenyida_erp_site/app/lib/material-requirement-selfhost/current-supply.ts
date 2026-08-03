import type { PoolClient } from "pg";

export type CurrentSupplyRequestLine = Readonly<{
  lineId: number;
  materialId: number;
  unitId: number;
  snapshotStockAvailable: string;
  snapshotStockAllocated: string;
  snapshotInboundAvailable: string;
  snapshotInboundAllocated: string;
}>;

export type CurrentSupplyBreakdown = Readonly<{
  inventory_location_scope: "MAIN";
  inventory_position_count: number;
  inventory_lot_position_count: number;
  on_hand_qty: string;
  reserved_qty: string;
  frozen_qty: string;
  other_unavailable_supported: false;
  other_unavailable_qty: null;
  inventory_available_qty: string;
  stock_allocated_to_active_plans_qty: string;
  unallocated_inventory_available_qty: string;
  effective_inbound_qty: string;
  inbound_allocated_to_active_plans_qty: string;
  unallocated_inbound_available_qty: string;
  inbound_cutoff_date: string;
  posted_receipts_excluded: true;
  unposted_arrival_quantity_supported: false;
  unposted_arrival_qty: null;
  snapshot_unallocated_inventory_available_qty: string;
  snapshot_unallocated_inbound_available_qty: string;
  unallocated_inventory_delta_qty: string;
  unallocated_inbound_delta_qty: string;
  changed: boolean;
}>;

export const currentSupplyFormula = Object.freeze({
  inventory_available: "inventory_available_qty = sum(on_hand_qty) - sum(reserved_qty) - sum(frozen_qty); database constraints keep every position nonnegative",
  unallocated_inventory_available: "unallocated_inventory_available_qty = max(inventory_available_qty - stock_allocated_to_active_plans_qty, 0)",
  effective_inbound: "effective_inbound_qty = sum(active PO line remaining quantity due by the PRQ required date; active Delivery Plan remaining quantity governs when present)",
  unallocated_inbound_available: "unallocated_inbound_available_qty = max(effective_inbound_qty - inbound_allocated_to_active_plans_qty, 0)",
});

export const currentSupplyModel = Object.freeze({
  inventory_location_scope: "MAIN",
  active_plan_statuses: ["SUBMITTED", "ACCEPTED"],
  active_purchase_order_statuses: ["OPEN", "PARTIALLY_RECEIVED"],
  active_purchase_order_line_statuses: ["OPEN", "PARTIALLY_RECEIVED"],
  active_delivery_plan_statuses: ["PENDING", "PARTIAL"],
  posted_receipts_excluded: true,
  other_unavailable_supported: false,
  unposted_arrival_quantity_supported: false,
});

type CurrentSupplyRow = Record<string, unknown> & {
  line_id: string;
  inventory_position_count: number;
  inventory_lot_position_count: number;
  on_hand_qty: string;
  reserved_qty: string;
  frozen_qty: string;
  inventory_available_qty: string;
  stock_allocated_to_active_plans_qty: string;
  unallocated_inventory_available_qty: string;
  effective_inbound_qty: string;
  inbound_allocated_to_active_plans_qty: string;
  unallocated_inbound_available_qty: string;
  snapshot_unallocated_inventory_available_qty: string;
  snapshot_unallocated_inbound_available_qty: string;
  unallocated_inventory_delta_qty: string;
  unallocated_inbound_delta_qty: string;
  changed: boolean;
};

export async function loadCurrentSupplyBreakdowns(client: PoolClient, requestedLines: readonly CurrentSupplyRequestLine[], requiredDate: string) {
  const result = new Map<number, CurrentSupplyBreakdown>();
  if (!requestedLines.length) return result;

  const requested = requestedLines.map((line) => ({
    line_id: line.lineId,
    material_id: line.materialId,
    unit_id: line.unitId,
    snapshot_stock_available: line.snapshotStockAvailable,
    snapshot_stock_allocated: line.snapshotStockAllocated,
    snapshot_inbound_available: line.snapshotInboundAvailable,
    snapshot_inbound_allocated: line.snapshotInboundAllocated,
    required_date: requiredDate,
  }));

  const rows = await client.query<CurrentSupplyRow>(`with requested as (
      select * from jsonb_to_recordset($1::jsonb) as r(
        line_id bigint,material_id bigint,unit_id bigint,
        snapshot_stock_available numeric(24,6),snapshot_stock_allocated numeric(24,6),
        snapshot_inbound_available numeric(24,6),snapshot_inbound_allocated numeric(24,6),required_date date
      )
    ), inventory as (
      select r.line_id,count(b.id)::int inventory_position_count,
        count(b.id) filter(where b.inventory_lot_id is not null)::int inventory_lot_position_count,
        coalesce(sum(b.on_hand_qty),0)::numeric(24,6) on_hand_qty,
        coalesce(sum(b.reserved_qty),0)::numeric(24,6) reserved_qty,
        coalesce(sum(b.frozen_qty),0)::numeric(24,6) frozen_qty
      from requested r left join inventory_stock_balances b
        on b.material_id=r.material_id and b.unit_id=r.unit_id and b.location_code='MAIN'
      group by r.line_id
    ), active_stock_allocations as (
      select l.material_id,l.unit_id,sum(a.quantity)::numeric(24,6) allocated_qty
      from planning_material_allocations a
      join planning_material_requirement_plans p on p.id=a.plan_id and p.status in ('SUBMITTED','ACCEPTED')
      join planning_material_requirement_lines l on l.id=a.plan_line_id
      where a.allocation_type='STOCK'
      group by l.material_id,l.unit_id
    ), effective_inbound_sources as (
      select r.line_id,pol.id purchase_order_line_id,
        case when dp.id is not null then greatest(dp.planned_quantity-dp.received_quantity,0)
          else greatest(pol.order_qty-pol.received_qty,0) end::numeric(24,6) remaining_qty
      from requested r
      join purchase_order_lines pol on pol.material_id=r.material_id and pol.unit_id=r.unit_id
      join purchase_orders po on po.id=pol.purchase_order_id
      left join purchase_delivery_plans dp on dp.purchase_order_line_id=pol.id
      where po.status in ('OPEN','PARTIALLY_RECEIVED')
        and pol.status in ('OPEN','PARTIALLY_RECEIVED')
        and pol.order_qty>pol.received_qty
        and ((dp.id is not null and dp.status in ('PENDING','PARTIAL') and dp.promised_delivery_date<=r.required_date)
          or (dp.id is null and po.expected_at is not null and (po.expected_at at time zone 'Asia/Shanghai')::date<=r.required_date))
    ), effective_inbound as (
      select line_id,coalesce(sum(remaining_qty),0)::numeric(24,6) effective_inbound_qty
      from effective_inbound_sources group by line_id
    ), active_inbound_allocations as (
      select source.line_id,sum(a.quantity)::numeric(24,6) allocated_qty
      from effective_inbound_sources source
      join planning_material_allocations a on a.purchase_order_line_id=source.purchase_order_line_id and a.allocation_type='INBOUND'
      join planning_material_requirement_plans p on p.id=a.plan_id and p.status in ('SUBMITTED','ACCEPTED')
      group by source.line_id
    ), combined as (
      select r.*,i.inventory_position_count,i.inventory_lot_position_count,
        i.on_hand_qty,i.reserved_qty,i.frozen_qty,
        (i.on_hand_qty-i.reserved_qty-i.frozen_qty)::numeric(24,6) inventory_available_qty,
        coalesce(sa.allocated_qty,0)::numeric(24,6) stock_allocated_to_active_plans_qty,
        coalesce(ei.effective_inbound_qty,0)::numeric(24,6) effective_inbound_qty,
        coalesce(ia.allocated_qty,0)::numeric(24,6) inbound_allocated_to_active_plans_qty
      from requested r join inventory i on i.line_id=r.line_id
      left join active_stock_allocations sa on sa.material_id=r.material_id and sa.unit_id=r.unit_id
      left join effective_inbound ei on ei.line_id=r.line_id
      left join active_inbound_allocations ia on ia.line_id=r.line_id
    ), calculated as (
      select *,
        greatest(inventory_available_qty-stock_allocated_to_active_plans_qty,0)::numeric(24,6) unallocated_inventory_available_qty,
        greatest(effective_inbound_qty-inbound_allocated_to_active_plans_qty,0)::numeric(24,6) unallocated_inbound_available_qty,
        greatest(snapshot_stock_available-snapshot_stock_allocated,0)::numeric(24,6) snapshot_unallocated_inventory_available_qty,
        greatest(snapshot_inbound_available-snapshot_inbound_allocated,0)::numeric(24,6) snapshot_unallocated_inbound_available_qty
      from combined
    )
    select line_id::text,inventory_position_count,inventory_lot_position_count,
      on_hand_qty::numeric(24,6)::text,reserved_qty::numeric(24,6)::text,frozen_qty::numeric(24,6)::text,
      inventory_available_qty::text,stock_allocated_to_active_plans_qty::text,unallocated_inventory_available_qty::text,
      effective_inbound_qty::text,inbound_allocated_to_active_plans_qty::text,unallocated_inbound_available_qty::text,
      snapshot_unallocated_inventory_available_qty::text,snapshot_unallocated_inbound_available_qty::text,
      (unallocated_inventory_available_qty-snapshot_unallocated_inventory_available_qty)::numeric(24,6)::text unallocated_inventory_delta_qty,
      (unallocated_inbound_available_qty-snapshot_unallocated_inbound_available_qty)::numeric(24,6)::text unallocated_inbound_delta_qty,
      (unallocated_inventory_available_qty<>snapshot_unallocated_inventory_available_qty
        or unallocated_inbound_available_qty<>snapshot_unallocated_inbound_available_qty) changed
    from calculated order by line_id`, [JSON.stringify(requested)]);

  for (const row of rows.rows) {
    result.set(Number(row.line_id), {
      inventory_location_scope: "MAIN",
      inventory_position_count: Number(row.inventory_position_count),
      inventory_lot_position_count: Number(row.inventory_lot_position_count),
      on_hand_qty: row.on_hand_qty,
      reserved_qty: row.reserved_qty,
      frozen_qty: row.frozen_qty,
      other_unavailable_supported: false,
      other_unavailable_qty: null,
      inventory_available_qty: row.inventory_available_qty,
      stock_allocated_to_active_plans_qty: row.stock_allocated_to_active_plans_qty,
      unallocated_inventory_available_qty: row.unallocated_inventory_available_qty,
      effective_inbound_qty: row.effective_inbound_qty,
      inbound_allocated_to_active_plans_qty: row.inbound_allocated_to_active_plans_qty,
      unallocated_inbound_available_qty: row.unallocated_inbound_available_qty,
      inbound_cutoff_date: requiredDate,
      posted_receipts_excluded: true,
      unposted_arrival_quantity_supported: false,
      unposted_arrival_qty: null,
      snapshot_unallocated_inventory_available_qty: row.snapshot_unallocated_inventory_available_qty,
      snapshot_unallocated_inbound_available_qty: row.snapshot_unallocated_inbound_available_qty,
      unallocated_inventory_delta_qty: row.unallocated_inventory_delta_qty,
      unallocated_inbound_delta_qty: row.unallocated_inbound_delta_qty,
      changed: row.changed,
    });
  }
  return result;
}
