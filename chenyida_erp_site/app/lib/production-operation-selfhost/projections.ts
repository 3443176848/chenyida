import type { PoolClient } from "pg";
import { ProductionError } from "../production-selfhost/errors.ts";

type Queryable = Pick<PoolClient, "query">;

export async function initializeOperationProjections(client: Queryable, workOrderId: number): Promise<void> {
  const snapshot = await client.query("select id from production_work_order_routing_snapshots where work_order_id=$1", [workOrderId]);
  if (!snapshot.rows[0]) return;
  await client.query(`
    insert into production_work_order_operation_projections(work_order_id,snapshot_operation_id,previous_snapshot_operation_id,next_snapshot_operation_id,status,target_qty)
    select s.work_order_id,op.id,
      lag(op.id) over(order by op.sequence_no,op.id),
      lead(op.id) over(order by op.sequence_no,op.id),
      case when wo.status='CANCELLED' then 'CANCELLED' else 'WAITING' end,
      wo.planned_qty
    from production_work_order_routing_snapshot_operations op
    join production_work_order_routing_snapshots s on s.id=op.snapshot_id
    join production_work_orders wo on wo.id=s.work_order_id
    where s.work_order_id=$1
    on conflict(snapshot_operation_id) do nothing`, [workOrderId]);
  await client.query(`
    insert into production_operation_wip_projections(operation_projection_id,snapshot_operation_id)
    select p.id,p.snapshot_operation_id from production_work_order_operation_projections p
    where p.work_order_id=$1
    on conflict(snapshot_operation_id) do nothing`, [workOrderId]);
  await refreshOperationProjections(client, workOrderId);
}

export async function refreshOperationProjections(client: Queryable, workOrderId: number): Promise<void> {
  const rows = await client.query(`
    select p.id,p.snapshot_operation_id,p.previous_snapshot_operation_id,p.next_snapshot_operation_id,p.target_qty,p.version,wo.status work_order_status
    from production_work_order_operation_projections p
    join production_work_orders wo on wo.id=p.work_order_id
    join production_work_order_routing_snapshot_operations op on op.id=p.snapshot_operation_id
    where p.work_order_id=$1 order by op.sequence_no,op.id for update of p`, [workOrderId]);
  for (const row of rows.rows) {
    const first = row.previous_snapshot_operation_id == null;
    const source = first
      ? await client.query(`select least(wo.planned_qty,coalesce(min(round(r.net_issued_qty*wo.planned_qty/nullif(r.required_qty,0),6)),0))::text quantity from production_work_orders wo left join production_material_requirements r on r.work_order_id=wo.id where wo.id=$1 group by wo.id`, [workOrderId])
      : await client.query(`select coalesce(sum(good_qty),0)::text quantity from production_operation_runs where snapshot_operation_id=$1 and status not in ('CANCELLED','REVERSED')`, [Number(row.previous_snapshot_operation_id)]);
    const facts = await client.query(`
      select coalesce(sum(dispatched_qty) filter(where status not in ('CANCELLED','REVERSED')),0)::text dispatched,
        coalesce(sum(processed_qty) filter(where status not in ('CANCELLED','REVERSED')),0)::text processed,
        coalesce(sum(good_qty) filter(where status not in ('CANCELLED','REVERSED')),0)::text good,
        coalesce(sum(scrap_qty) filter(where status not in ('CANCELLED','REVERSED')),0)::text scrap,
        coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0)::text in_progress,
        bool_or(status='READY') has_ready,bool_or(status='IN_PROGRESS') has_active
      from production_operation_runs where snapshot_operation_id=$1`, [Number(row.snapshot_operation_id)]);
    const transferred = await client.query(`
      select coalesce(sum(a.quantity),0)::text quantity
      from production_operation_run_input_allocations a
      join production_operation_runs source on source.id=a.source_run_id
      join production_operation_runs target on target.id=a.run_id
      where source.snapshot_operation_id=$1 and source.status not in ('CANCELLED','REVERSED') and target.status not in ('CANCELLED','REVERSED')`, [Number(row.snapshot_operation_id)]);
    const quantity = await client.query(`select
      ($1::numeric-$2::numeric)::text waiting,
      ($3::numeric-$4::numeric)::text available,
      case when $5::bigint is null then ($3::numeric-$4::numeric)::text else '0' end final_output`,
      [source.rows[0]?.quantity ?? "0", facts.rows[0].dispatched, facts.rows[0].good, transferred.rows[0].quantity, row.next_snapshot_operation_id]);
    if (Number(quantity.rows[0].waiting) < 0 || Number(quantity.rows[0].available) < 0) throw new ProductionError("OPERATION_QUANTITY_CONFLICT", "工序投入或良品已被超量消费", 409);
    const status = row.work_order_status === "CANCELLED" ? "CANCELLED"
      : Number(facts.rows[0].processed) >= Number(row.target_qty) ? "COMPLETED"
        : facts.rows[0].has_active ? "IN_PROGRESS"
          : Number(quantity.rows[0].waiting) > 0 || facts.rows[0].has_ready ? "READY" : "WAITING";
    await client.query(`update production_work_order_operation_projections set status=$2,version=version+1,updated_at=now() where id=$1`, [Number(row.id), status]);
    await client.query(`update production_operation_wip_projections set source_input_qty=$2,waiting_input_qty=$3,dispatched_qty=$4,in_progress_qty=$5,completed_good_qty=$6,scrap_qty=$7,transferred_to_next_qty=$8,available_for_next_qty=$9,final_output_available_qty=$10,version=version+1,updated_at=now() where operation_projection_id=$1`, [Number(row.id), source.rows[0]?.quantity ?? "0", quantity.rows[0].waiting, facts.rows[0].dispatched, facts.rows[0].in_progress, facts.rows[0].good, facts.rows[0].scrap, transferred.rows[0].quantity, quantity.rows[0].available, quantity.rows[0].final_output]);
  }
}
