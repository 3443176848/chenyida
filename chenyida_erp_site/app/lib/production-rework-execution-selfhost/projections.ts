import type { PoolClient } from "pg";

type ExecutionEvent = "DISPATCHED" | "STARTED" | "REPORTED" | "CANCELLED" | "REVERSED" | "REINSPECTION_CREATED" | "REINSPECTION_RELEASED";

export async function initializeReworkExecution(client: PoolClient, reworkRequestId: number, actor: string, requestId: string): Promise<Record<string, unknown>> {
  const request = await client.query(`select r.id,r.nonconformance_id,r.quantity from production_rework_requests r
    join production_rework_request_versions v on v.rework_request_id=r.id and v.canonical_digest=r.canonical_digest
      and v.target_snapshot_operation_id=r.target_snapshot_operation_id and v.quantity=r.quantity
    where r.id=$1 and r.status='ACCEPTED' for update of r`, [reworkRequestId]);
  if (!request.rows[0]) throw new Error("accepted rework request snapshot is invalid");
  const saved = await client.query(`insert into production_rework_execution_projections(
      rework_request_id,nonconformance_id,accepted_rework_qty,rework_waiting_dispatch_qty,unresolved_rework_qty,status)
    values($1,$2,$3,$3,$3,'ACCEPTED') returning *`, [reworkRequestId, request.rows[0].nonconformance_id, request.rows[0].quantity]);
  await client.query(`insert into production_rework_execution_events(execution_projection_id,rework_request_id,event_type,to_status,quantity,actor,request_id)
    values($1,$2,'ACCEPTED','ACCEPTED',$3,$4,$5)`, [saved.rows[0].id, reworkRequestId, request.rows[0].quantity, actor, requestId]);
  return saved.rows[0];
}

export async function refreshReworkExecution(client: PoolClient, reworkRequestId: number | null | undefined, actor: string, requestId: string, eventType?: ExecutionEvent, runId?: number, quantity = "0"): Promise<Record<string, unknown> | null> {
  if (!reworkRequestId) return null;
  const locked = await client.query(`select p.*,r.quantity request_quantity,r.nonconformance_id request_nonconformance_id
    from production_rework_execution_projections p join production_rework_requests r on r.id=p.rework_request_id
    where p.rework_request_id=$1 for update of p,r`, [reworkRequestId]);
  const previous = locked.rows[0];
  if (!previous) throw new Error("rework execution projection is missing");
  const facts = await client.query(`with active as (
      select run.* from production_rework_run_allocations a join production_operation_runs run on run.id=a.run_id
      where a.rework_request_id=$1 and a.status='ACTIVE' and run.status not in ('CANCELLED','REVERSED')
    ), run_facts as (
      select coalesce(sum(dispatched_qty) filter(where status='READY'),0)::numeric dispatched,
        coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0)::numeric in_progress,
        coalesce(sum(good_qty),0)::numeric good,coalesce(sum(scrap_qty),0)::numeric scrap from active
    ), released as (
      select coalesce(sum(q.released_qty) filter(where q.lifecycle_status='CLOSED' and q.decision_status='RELEASED'),0)::numeric qty
      from quality_inspections q join production_operation_run_reports rr on rr.id=q.production_operation_run_report_id join active run on run.id=rr.run_id
    ), allocated as (
      select coalesce(sum(quantity) filter(where status='ACTIVE'),0)::numeric qty from production_rework_run_allocations where rework_request_id=$1
    ) select ($2::numeric-allocated.qty)::text waiting,run_facts.dispatched::text,run_facts.in_progress::text,run_facts.good::text,run_facts.scrap::text,
      (run_facts.good-released.qty)::text pending,released.qty::text released,(released.qty+run_facts.scrap)::text completed,
      ($2::numeric-released.qty-run_facts.scrap)::text unresolved,
      case when released.qty+run_facts.scrap=$2::numeric then case when run_facts.scrap>0 then 'COMPLETED_WITH_SCRAP' else 'COMPLETED' end
        when run_facts.good-released.qty>0 and $2::numeric-allocated.qty=0 and run_facts.dispatched=0 and run_facts.in_progress=0 then 'WAITING_REINSPECTION'
        when allocated.qty>0 then 'IN_PROGRESS' else 'ACCEPTED' end status
    from run_facts,released,allocated`, [reworkRequestId, previous.request_quantity]);
  const next = facts.rows[0];
  const saved = await client.query(`update production_rework_execution_projections set
      rework_waiting_dispatch_qty=$2,rework_dispatched_qty=$3,rework_in_progress_qty=$4,rework_reported_good_qty=$5,
      rework_reported_scrap_qty=$6,rework_pending_reinspection_qty=$7,rework_released_qty=$8,rework_completed_qty=$9,
      unresolved_rework_qty=$10,status=$11,version=version+1,updated_at=now() where rework_request_id=$1 returning *`,
    [reworkRequestId, next.waiting, next.dispatched, next.in_progress, next.good, next.scrap, next.pending, next.released, next.completed, next.unresolved, next.status]);
  const terminal = ["COMPLETED", "COMPLETED_WITH_SCRAP"].includes(next.status);
  if (eventType) await client.query(`insert into production_rework_execution_events(execution_projection_id,rework_request_id,run_id,event_type,from_status,to_status,quantity,actor,request_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [saved.rows[0].id, reworkRequestId, runId ?? null, eventType, previous.status, next.status, quantity, actor, requestId]);
  if (terminal && !["COMPLETED", "COMPLETED_WITH_SCRAP"].includes(previous.status)) await client.query(`insert into production_rework_execution_events(execution_projection_id,rework_request_id,run_id,event_type,from_status,to_status,quantity,actor,request_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [saved.rows[0].id, reworkRequestId, runId ?? null, next.status, previous.status, next.status, quantity, actor, requestId]);
  if (terminal) {
    const remaining = await client.query(`select exists(select 1 from production_rework_execution_projections where nonconformance_id=$1 and status not in ('COMPLETED','COMPLETED_WITH_SCRAP')) pending`, [previous.request_nonconformance_id]);
    if (!remaining.rows[0].pending) {
      const ncr = await client.query(`update production_nonconformances set status='RESOLVED',version=version+1,updated_at=now()
        where id=$1 and status='REWORK_ACCEPTED' returning status`, [previous.request_nonconformance_id]);
      if (ncr.rows[0]) await client.query(`insert into production_nonconformance_events(nonconformance_id,event_type,from_status,to_status,quantity,actor,request_id)
        values($1,'REWORK_RESOLVED','REWORK_ACCEPTED','RESOLVED',$2,$3,$4)`, [previous.request_nonconformance_id, previous.request_quantity, actor, requestId]);
    }
  } else if (previous.status !== next.status && previous.status !== "ACCEPTED") {
    await client.query(`update production_nonconformances set status='REWORK_ACCEPTED',version=version+1,updated_at=now() where id=$1 and status='RESOLVED'`, [previous.request_nonconformance_id]);
  }
  return saved.rows[0];
}
