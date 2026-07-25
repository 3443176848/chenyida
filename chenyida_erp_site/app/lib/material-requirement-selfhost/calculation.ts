import type { PoolClient } from "pg";
import { MaterialRequirementError } from "./errors.ts";
import type { RequirementCalculation, RequirementCalculationLine } from "./types.ts";
import { canonicalDigest } from "./validation.ts";

const zero = "0.000000";
const positive = (value: string) => value !== zero && !/^0(?:\.0+)?$/.test(value);

async function numeric(client: PoolClient, expression: string, values: unknown[]) {
  const result = await client.query<{ value: string }>(`select (${expression})::numeric(24,6)::text value`, values); return result.rows[0].value;
}

export async function calculateMaterialRequirements(client: PoolClient, packageId: number, requiredDate: string, lockSources: boolean): Promise<RequirementCalculation> {
  const source = await client.query(`select bl.material_id,bl.unit_id,sum(bl.calculated_gross_quantity)::numeric(24,6)::text gross_requirement,
    (array_agg(bl.specification_snapshot order by bl.id))[1] material_snapshot,min(bl.material_digest) material_digest,count(distinct bl.material_digest)::int digest_count
    from project_planning_package_items pi join project_planning_package_bom_lines bl on bl.package_item_id=pi.id
    where pi.package_id=$1 group by bl.material_id,bl.unit_id order by bl.material_id,bl.unit_id`, [packageId]);
  if (!source.rows.length) throw new MaterialRequirementError("PLANNING_PACKAGE_EMPTY", "已接收计划交接包没有可汇总的 BOM 物料", 422);
  if (source.rows.some((row) => Number(row.digest_count) !== 1)) throw new MaterialRequirementError("PLANNING_PACKAGE_MATERIAL_CONFLICT", "交接包内同一物料存在不一致的固化快照", 409);
  if (lockSources) await client.query("lock table purchase_orders, purchase_order_lines in share mode");

  const lines: RequirementCalculationLine[] = [];
  for (const [index, row] of source.rows.entries()) {
    const materialId = Number(row.material_id); const unitId = Number(row.unit_id); const grossRequirement = String(row.gross_requirement);
    if (lockSources) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`planning-material:${materialId}:${unitId}`]);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`inventory:MAIN:${materialId}`]);
    }
    const balance = await client.query(`select b.id,b.version,b.on_hand_qty::text,b.reserved_qty::text,b.frozen_qty::text,
      (b.on_hand_qty-b.reserved_qty-b.frozen_qty)::numeric(24,6)::text source_quantity,
      coalesce((select sum(a.quantity) from planning_material_allocations a join planning_material_requirement_plans p on p.id=a.plan_id and p.status in ('SUBMITTED','ACCEPTED') join planning_material_requirement_lines l on l.id=a.plan_line_id where a.allocation_type='STOCK' and l.material_id=b.material_id and l.unit_id=b.unit_id),0)::numeric(24,6)::text other_allocated,
      greatest(b.on_hand_qty-b.reserved_qty-b.frozen_qty-coalesce((select sum(a.quantity) from planning_material_allocations a join planning_material_requirement_plans p on p.id=a.plan_id and p.status in ('SUBMITTED','ACCEPTED') join planning_material_requirement_lines l on l.id=a.plan_line_id where a.allocation_type='STOCK' and l.material_id=b.material_id and l.unit_id=b.unit_id),0),0)::numeric(24,6)::text stock_available
      from inventory_stock_balances b where b.material_id=$1 and b.unit_id=$2 and b.location_code='MAIN' and b.lot_code='' ${lockSources ? "for share of b" : ""}`, [materialId, unitId]);
    const balanceRow = balance.rows[0]; const stockAvailable = String(balanceRow?.stock_available ?? zero);
    const stockAllocated = await numeric(client, "least($1::numeric,$2::numeric)", [grossRequirement, stockAvailable]);
    const remaining = await numeric(client, "$1::numeric-$2::numeric", [grossRequirement, stockAllocated]);
    const stockSourceDigest = canonicalDigest(balanceRow ? { id: Number(balanceRow.id), version: Number(balanceRow.version), on_hand_qty: balanceRow.on_hand_qty, reserved_qty: balanceRow.reserved_qty, frozen_qty: balanceRow.frozen_qty, other_allocated: balanceRow.other_allocated } : { absent: true, material_id: materialId, unit_id: unitId });

    const inbound = await client.query(`with sources as (
        select pol.id purchase_order_line_id,pol.version source_version,po.id purchase_order_id,po.version purchase_order_version,po.status purchase_order_status,pol.status line_status,po.expected_at,
          (pol.order_qty-pol.received_qty)::numeric(24,6) source_quantity,
          coalesce((select sum(a.quantity) from planning_material_allocations a join planning_material_requirement_plans p on p.id=a.plan_id and p.status in ('SUBMITTED','ACCEPTED') where a.allocation_type='INBOUND' and a.purchase_order_line_id=pol.id),0)::numeric(24,6) other_allocated
        from purchase_order_lines pol join purchase_orders po on po.id=pol.purchase_order_id
        where pol.material_id=$1 and pol.unit_id=$2 and po.status in ('OPEN','PARTIALLY_RECEIVED') and pol.status in ('OPEN','PARTIALLY_RECEIVED') and po.expected_at is not null and (po.expected_at at time zone 'Asia/Shanghai')::date<=$3::date and pol.order_qty>pol.received_qty
      ), available as (
        select *,greatest(source_quantity-other_allocated,0)::numeric(24,6) available_quantity from sources
      ), positioned as (
        select *,coalesce(sum(available_quantity) over(order by expected_at,purchase_order_id,purchase_order_line_id rows between unbounded preceding and 1 preceding),0)::numeric(24,6) prior_available,
          sum(available_quantity) over()::numeric(24,6) eligible_total
        from available
      )
      select purchase_order_line_id,source_version,purchase_order_id,purchase_order_version,purchase_order_status,line_status,expected_at,source_quantity::text,other_allocated::text,available_quantity::text,
        greatest(least(available_quantity,$4::numeric-prior_available),0)::numeric(24,6)::text allocated_quantity,eligible_total::text
      from positioned order by expected_at,purchase_order_id,purchase_order_line_id`, [materialId, unitId, requiredDate, remaining]);
    const eligibleInbound = String(inbound.rows[0]?.eligible_total ?? zero);
    const inboundAllocated = await numeric(client, "least($1::numeric,$2::numeric)", [remaining, eligibleInbound]);
    const netPurchaseRequirement = await numeric(client, "$1::numeric-$2::numeric-$3::numeric", [grossRequirement, stockAllocated, inboundAllocated]);
    const inboundSourceRows = inbound.rows.map((item) => ({ purchase_order_line_id: Number(item.purchase_order_line_id), source_version: Number(item.source_version), purchase_order_id: Number(item.purchase_order_id), purchase_order_version: Number(item.purchase_order_version), purchase_order_status: item.purchase_order_status, line_status: item.line_status, expected_at: new Date(String(item.expected_at)).toISOString(), source_quantity: item.source_quantity, other_allocated: item.other_allocated, available_quantity: item.available_quantity }));
    const inboundSources = inbound.rows.filter((item) => positive(String(item.allocated_quantity))).map((item) => ({ purchaseOrderLineId: Number(item.purchase_order_line_id), sourceVersion: Number(item.source_version), sourceQuantity: String(item.source_quantity), quantity: String(item.allocated_quantity), sourceDigest: canonicalDigest(inboundSourceRows.find((sourceRow) => sourceRow.purchase_order_line_id === Number(item.purchase_order_line_id))) }));
    const sourceDigest = canonicalDigest({ package_id: packageId, required_date: requiredDate, material_id: materialId, unit_id: unitId, gross_requirement: grossRequirement, material_digest: row.material_digest, stock_source_digest: stockSourceDigest, inbound_sources: inboundSourceRows });
    lines.push({ lineNo: index + 1, materialId, unitId, materialSnapshot: row.material_snapshot as Record<string, unknown>, materialDigest: String(row.material_digest), grossRequirement, stockAvailable, eligibleInbound, stockAllocated, inboundAllocated, netPurchaseRequirement, sourceDigest,
      stockSource: balanceRow && positive(stockAllocated) ? { inventoryBalanceId: Number(balanceRow.id), sourceVersion: Number(balanceRow.version), sourceQuantity: String(balanceRow.source_quantity), sourceDigest: stockSourceDigest } : null, inboundSources });
  }
  return { lines, digest: canonicalDigest({ package_id: packageId, required_date: requiredDate, lines: lines.map(({ stockSource: _stock, inboundSources: _inbound, ...line }) => line) }) };
}
