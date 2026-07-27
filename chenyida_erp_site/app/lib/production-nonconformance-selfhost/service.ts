import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { QualityError } from "../quality-selfhost/errors.ts";
import { id, quantity, text, version } from "../quality-selfhost/rules.ts";
import { QualityRepository } from "../quality-selfhost/repository.ts";
import type { QualityMeta, QualityResult } from "../quality-selfhost/types.ts";
import { initializeReworkExecution } from "../production-rework-execution-selfhost/projections.ts";

type NcrRow = Record<string, unknown> & { id: string; status: string; version: number; failed_qty: string; work_order_id: string; snapshot_operation_id: string };
type RequestRow = Record<string, unknown> & { id: string; nonconformance_id: string; status: string; version: number; quantity: string; created_by: string; revision_no: number };

const canonicalDigest = (row: Record<string, unknown>) => createHash("sha256").update(JSON.stringify({
  nonconformance_id: Number(row.nonconformance_id), revision_no: Number(row.revision_no),
  target_snapshot_operation_id: Number(row.target_snapshot_operation_id), target_sequence_no: Number(row.target_sequence_no),
  target_operation_code: row.target_operation_code, target_operation_name: row.target_operation_name,
  target_work_center_id: Number(row.target_work_center_id), target_work_center_code: row.target_work_center_code,
  target_work_center_name: row.target_work_center_name, target_description: row.target_description,
  quantity: String(row.quantity), reason: row.reason,
})).digest("hex");

export class ProductionNonconformanceService {
  readonly pool: Pool; readonly repository: QualityRepository; readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(pool: Pool, repository: QualityRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.pool=pool; this.repository=repository; this.fault=fault; }

  private async nextCode(client: PoolClient, sequence: string, prefix: string) {
    const result = await client.query<{ current_value: string }>(`insert into business_code_sequences(sequence_code,current_value,version,updated_at) values($1,1,1,now()) on conflict(sequence_code) do update set current_value=business_code_sequences.current_value+1,version=business_code_sequences.version+1,updated_at=now() returning current_value`, [sequence]);
    return `${prefix}-${String(result.rows[0].current_value).padStart(8, "0")}`;
  }

  private async lockNcr(client: PoolClient, ncrId: number): Promise<NcrRow> {
    const found = await client.query<NcrRow>("select * from production_nonconformances where id=$1 for update", [ncrId]);
    if (!found.rows[0]) throw new QualityError("NONCONFORMANCE_NOT_FOUND", "不合格记录不存在", 404);
    return found.rows[0];
  }

  private async refresh(client: PoolClient, ncrId: number) {
    const calculated = await client.query(`select n.failed_qty,
      coalesce(sum(a.quantity) filter(where a.allocation_type='REWORK' and a.status='ACTIVE'),0)::numeric active_rework_qty,
      coalesce(sum(a.quantity) filter(where a.allocation_type='SCRAP' and a.status='FINAL'),0)::numeric final_scrap_qty,
      exists(select 1 from production_rework_requests r where r.nonconformance_id=n.id and r.status='SUBMITTED') has_submitted,
      exists(select 1 from production_rework_requests r where r.nonconformance_id=n.id and r.status='ACCEPTED') has_accepted
      from production_nonconformances n left join production_nonconformance_allocations a on a.nonconformance_id=n.id where n.id=$1 group by n.id`, [ncrId]);
    const row = calculated.rows[0];
    if (!row) throw new QualityError("NONCONFORMANCE_NOT_FOUND", "不合格记录不存在", 404);
    const projected = await client.query(`update production_nonconformances set active_rework_qty=$2,final_scrap_qty=$3,
      unresolved_qty=failed_qty-$2::numeric-$3::numeric,
      status=case when $4::boolean then 'REWORK_PENDING' when $5::boolean then 'REWORK_ACCEPTED' when failed_qty-$2::numeric-$3::numeric=0 then 'DISPOSED' else 'OPEN' end,
      version=version+1,updated_at=now() where id=$1 returning *`, [ncrId, row.active_rework_qty, row.final_scrap_qty, row.has_submitted, row.has_accepted]);
    return projected.rows[0];
  }

  async list(limit: number, offset: number, status?: string) {
    const values: unknown[] = []; const where: string[] = [];
    if (status) { values.push(status.toUpperCase()); where.push(`n.status=$${values.length}`); }
    values.push(limit, offset);
    return this.pool.query(`select n.*,qi.inspection_code,wo.work_order_code,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code,
      op.sequence_no source_sequence_no,rr.report_code run_report_code
      from production_nonconformances n join quality_inspections qi on qi.id=n.inspection_id
      join production_work_orders wo on wo.id=n.work_order_id join material_master m on m.id=n.material_id join units u on u.id=n.unit_id
      join production_work_order_routing_snapshot_operations op on op.id=n.snapshot_operation_id
      join production_operation_run_reports rr on rr.id=n.production_operation_run_report_id
      ${where.length ? `where ${where.join(" and ")}` : ""} order by n.created_at desc,n.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async listRequests(limit: number, offset: number, status?: string) {
    const values: unknown[] = []; const where: string[] = [];
    if (status) { values.push(status.toUpperCase()); where.push(`r.status=$${values.length}`); }
    values.push(limit, offset);
    return this.pool.query(`select r.*,n.ncr_code,wo.work_order_code,n.failed_qty,n.active_rework_qty,n.final_scrap_qty,n.unresolved_qty,n.status ncr_status,
      p.status execution_status,p.version execution_version,p.accepted_rework_qty::text,p.rework_waiting_dispatch_qty::text,p.rework_dispatched_qty::text,p.rework_in_progress_qty::text,p.rework_reported_good_qty::text,p.rework_reported_scrap_qty::text,p.rework_pending_reinspection_qty::text,p.rework_released_qty::text,p.rework_completed_qty::text,p.unresolved_rework_qty::text
      from production_rework_requests r join production_nonconformances n on n.id=r.nonconformance_id join production_work_orders wo on wo.id=n.work_order_id left join production_rework_execution_projections p on p.rework_request_id=r.id
      ${where.length ? `where ${where.join(" and ")}` : ""} order by r.created_at desc,r.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async get(ncrId: number) {
    const header = await this.pool.query(`select n.*,qi.inspection_code,qi.lifecycle_status inspection_lifecycle_status,wo.work_order_code,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code,rr.report_code run_report_code,op.sequence_no source_sequence_no
      from production_nonconformances n join quality_inspections qi on qi.id=n.inspection_id join production_work_orders wo on wo.id=n.work_order_id
      join material_master m on m.id=n.material_id join units u on u.id=n.unit_id join production_operation_run_reports rr on rr.id=n.production_operation_run_report_id
      join production_work_order_routing_snapshot_operations op on op.id=n.snapshot_operation_id where n.id=$1`, [ncrId]);
    if (!header.rows[0]) throw new QualityError("NONCONFORMANCE_NOT_FOUND", "不合格记录不存在", 404);
    const [events, requests, scraps, targets] = await Promise.all([
      this.pool.query("select * from production_nonconformance_events where nonconformance_id=$1 order by id", [ncrId]),
      this.pool.query(`select r.*,v.canonical_digest submitted_digest,v.created_at snapshot_created_at,p.status execution_status,p.version execution_version,p.accepted_rework_qty::text,p.rework_waiting_dispatch_qty::text,p.rework_dispatched_qty::text,p.rework_in_progress_qty::text,p.rework_reported_good_qty::text,p.rework_reported_scrap_qty::text,p.rework_pending_reinspection_qty::text,p.rework_released_qty::text,p.rework_completed_qty::text,p.unresolved_rework_qty::text,
        coalesce((select jsonb_agg(e order by e.id) from production_rework_request_events e where e.rework_request_id=r.id),'[]'::jsonb) events,
        coalesce((select jsonb_agg(jsonb_build_object('id',run.id,'run_code',run.run_code,'run_kind',run.run_kind,'status',run.status,'dispatched_qty',run.dispatched_qty,'processed_qty',run.processed_qty,'good_qty',run.good_qty,'scrap_qty',run.scrap_qty,'assigned_operator',run.assigned_operator) order by run.id) from production_operation_runs run where run.rework_request_id=r.id),'[]'::jsonb) runs
        from production_rework_requests r left join production_rework_request_versions v on v.rework_request_id=r.id left join production_rework_execution_projections p on p.rework_request_id=r.id where r.nonconformance_id=$1 order by r.revision_no,r.id`, [ncrId]),
      this.pool.query("select * from production_scrap_dispositions where nonconformance_id=$1 order by id", [ncrId]),
      this.targetOptions(ncrId),
    ]);
    return { ...header.rows[0], events: events.rows, rework_requests: requests.rows, scrap_dispositions: scraps.rows, target_operations: targets.rows };
  }

  async targetOptions(ncrId: number) {
    return this.pool.query(`select target.id target_snapshot_operation_id,target.sequence_no,target.operation_code,target.operation_name,target.work_center_id,target.work_center_code,target.work_center_name,target.description
      from production_nonconformances n join production_work_order_routing_snapshot_operations source on source.id=n.snapshot_operation_id
      join production_work_order_routing_snapshots s on s.work_order_id=n.work_order_id
      join production_work_order_routing_snapshot_operations target on target.snapshot_id=s.id and target.sequence_no<=source.sequence_no
      where n.id=$1 and n.status<>'CANCELLED' order by target.sequence_no`, [ncrId]);
  }

  async createNcr(inspectionId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const source = await client.query(`select qi.*,rr.id run_report_id,run.work_order_id,rr.snapshot_operation_id,op.work_center_id,op.work_center_code,op.work_center_name,wo.finished_material_id material_id,wo.finished_unit_id unit_id
        from quality_inspections qi join production_operation_run_reports rr on rr.id=qi.production_operation_run_report_id
        join production_operation_runs run on run.id=rr.run_id join production_work_order_routing_snapshot_operations op on op.id=rr.snapshot_operation_id
        join production_work_orders wo on wo.id=run.work_order_id where qi.id=$1 for update of qi,rr,run,op,wo`, [inspectionId]);
      const row = source.rows[0];
      if (!row) throw new QualityError("NONCONFORMANCE_SOURCE_INVALID", "只有结构化工序 IPQC 可建立不合格记录", 422);
      if (Number(row.version) !== expected) throw new QualityError("NONCONFORMANCE_VERSION_CONFLICT", "检验版本已变化，请刷新后重试", 409);
      const code = await this.nextCode(client, "PRODUCTION_NONCONFORMANCE", "NCR");
      const created = await client.query(`insert into production_nonconformances(ncr_code,inspection_id,production_operation_run_report_id,work_order_id,snapshot_operation_id,work_center_id,work_center_code,work_center_name,material_id,unit_id,inspected_qty,passed_qty,failed_qty,unresolved_qty,operation_id,created_by,request_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16) returning *`, [code, inspectionId, row.run_report_id, row.work_order_id, row.snapshot_operation_id, row.work_center_id, row.work_center_code, row.work_center_name, row.material_id, row.unit_id, row.inspected_qty, row.passed_qty, row.failed_qty, meta.operationId, meta.actor.username, meta.requestId]);
      const ncrId = Number(created.rows[0].id);
      await client.query("insert into production_nonconformance_events(nonconformance_id,event_type,to_status,quantity,actor,request_id) values($1,'CREATED','OPEN',$2,$3,$4)", [ncrId, row.failed_qty, meta.actor.username, meta.requestId]);
      await this.fault?.("after_nonconformance_create");
      return { status: 201, body: { ok: true, data: created.rows[0], request_id: meta.requestId }, objectId: ncrId };
    });
  }

  async createDraft(ncrId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const targetId = id(input.target_snapshot_operation_id, "target_snapshot_operation_id"); const qty = quantity(input.quantity, "quantity"); const reason = text(input.reason, "reason", 2000, true);
    const supersedes = input.supersedes_request_id === null || input.supersedes_request_id === undefined ? null : id(input.supersedes_request_id, "supersedes_request_id");
    return this.repository.execute(meta, async (client) => {
      const ncr = await this.lockNcr(client, ncrId); if (ncr.status === "CANCELLED") throw new QualityError("NONCONFORMANCE_STATE_CONFLICT", "已取消不合格记录不能申请返工", 409);
      const target = await client.query(`select op.*,s.work_order_id from production_work_order_routing_snapshot_operations op join production_work_order_routing_snapshots s on s.id=op.snapshot_id where op.id=$1`, [targetId]);
      if (!target.rows[0]) throw new QualityError("REWORK_TARGET_INVALID", "返工目标工序不存在", 422);
      let revisionNo = 1;
      if (supersedes) { const previous = await client.query<RequestRow>("select * from production_rework_requests where id=$1 and nonconformance_id=$2 for update", [supersedes, ncrId]); if (!previous.rows[0] || !["RETURNED", "CANCELLED"].includes(previous.rows[0].status)) throw new QualityError("REWORK_REVISION_INVALID", "只能修订已退回或已取消的返工申请", 409); revisionNo = Number(previous.rows[0].revision_no) + 1; }
      else if ((await client.query("select 1 from production_rework_requests where nonconformance_id=$1 limit 1", [ncrId])).rows[0]) throw new QualityError("REWORK_REVISION_REQUIRED", "已有返工申请时必须基于已退回版本创建修订", 409);
      const code = await this.nextCode(client, "PRODUCTION_REWORK_REQUEST", "RWR"); const op = target.rows[0];
      const created = await client.query(`insert into production_rework_requests(request_code,nonconformance_id,revision_no,supersedes_request_id,target_snapshot_operation_id,target_sequence_no,target_operation_code,target_operation_name,target_work_center_id,target_work_center_code,target_work_center_name,target_description,quantity,reason,operation_id,created_by,request_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`, [code, ncrId, revisionNo, supersedes, targetId, op.sequence_no, op.operation_code, op.operation_name, op.work_center_id, op.work_center_code, op.work_center_name, op.description, qty, reason, meta.operationId, meta.actor.username, meta.requestId]);
      const requestId = Number(created.rows[0].id); await client.query("insert into production_rework_request_events(rework_request_id,event_type,to_status,quantity,actor,request_id) values($1,'CREATED','DRAFT',$2,$3,$4)", [requestId, qty, meta.actor.username, meta.requestId]);
      await this.fault?.("after_rework_draft"); return { status: 201, body: { ok: true, data: created.rows[0], request_id: meta.requestId }, objectId: requestId };
    });
  }

  async updateDraft(requestId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const targetId = id(input.target_snapshot_operation_id, "target_snapshot_operation_id"), qty = quantity(input.quantity, "quantity"), reason = text(input.reason, "reason", 2000, true), expected = version(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const identity = await client.query("select nonconformance_id from production_rework_requests where id=$1", [requestId]); if (!identity.rows[0]) throw new QualityError("REWORK_REQUEST_NOT_FOUND", "返工申请不存在", 404);
      await this.lockNcr(client, Number(identity.rows[0].nonconformance_id));
      const request = await client.query<RequestRow>("select * from production_rework_requests where id=$1 for update", [requestId]);
      if (!request.rows[0] || request.rows[0].status !== "DRAFT" || Number(request.rows[0].version) !== expected) throw new QualityError("REWORK_VERSION_OR_STATE_CONFLICT", "返工草稿版本已变化或不可编辑", 409);
      const target = await client.query("select * from production_work_order_routing_snapshot_operations where id=$1", [targetId]); if (!target.rows[0]) throw new QualityError("REWORK_TARGET_INVALID", "返工目标工序不存在", 422); const op = target.rows[0];
      const updated = await client.query(`update production_rework_requests set target_snapshot_operation_id=$2,target_sequence_no=$3,target_operation_code=$4,target_operation_name=$5,target_work_center_id=$6,target_work_center_code=$7,target_work_center_name=$8,target_description=$9,quantity=$10,reason=$11,version=version+1,updated_at=now() where id=$1 returning *`, [requestId, targetId, op.sequence_no, op.operation_code, op.operation_name, op.work_center_id, op.work_center_code, op.work_center_name, op.description, qty, reason]);
      await client.query("insert into production_rework_request_events(rework_request_id,event_type,from_status,to_status,quantity,actor,request_id) values($1,'UPDATED','DRAFT','DRAFT',$2,$3,$4)", [requestId, qty, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: requestId };
    });
  }

  async submit(requestId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const identity = await client.query("select nonconformance_id from production_rework_requests where id=$1", [requestId]); if (!identity.rows[0]) throw new QualityError("REWORK_REQUEST_NOT_FOUND", "返工申请不存在", 404);
      const ncrId = Number(identity.rows[0].nonconformance_id); const oldNcr = await this.lockNcr(client, ncrId);
      const locked = await client.query<RequestRow>("select * from production_rework_requests where id=$1 for update", [requestId]); const row = locked.rows[0];
      if (!row || row.status !== "DRAFT" || Number(row.version) !== expected) throw new QualityError("REWORK_VERSION_OR_STATE_CONFLICT", "返工草稿版本已变化或不可提交", 409);
      const digest = canonicalDigest(row);
      const updated = await client.query(`update production_rework_requests set status='SUBMITTED',canonical_digest=$2,submitted_by=$3,submitted_request_id=$4,submitted_at=now(),version=version+1,updated_at=now() where id=$1 returning *`, [requestId, digest, meta.actor.username, meta.requestId]);
      const submitted = updated.rows[0];
      await client.query(`insert into production_rework_request_versions(rework_request_id,version_no,nonconformance_id,target_snapshot_operation_id,target_sequence_no,target_operation_code,target_operation_name,target_work_center_id,target_work_center_code,target_work_center_name,target_description,quantity,reason,canonical_digest,submitted_by,request_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [requestId, submitted.version, ncrId, submitted.target_snapshot_operation_id, submitted.target_sequence_no, submitted.target_operation_code, submitted.target_operation_name, submitted.target_work_center_id, submitted.target_work_center_code, submitted.target_work_center_name, submitted.target_description, submitted.quantity, submitted.reason, digest, meta.actor.username, meta.requestId]);
      await client.query(`insert into production_nonconformance_allocations(nonconformance_id,allocation_type,rework_request_id,quantity,status,operation_id,created_by,request_id) values($1,'REWORK',$2,$3,'ACTIVE',$4,$5,$6)`, [ncrId, requestId, submitted.quantity, meta.operationId, meta.actor.username, meta.requestId]);
      const ncr = await this.refresh(client, ncrId);
      await client.query("insert into production_rework_request_events(rework_request_id,event_type,from_status,to_status,quantity,actor,request_id) values($1,'SUBMITTED','DRAFT','SUBMITTED',$2,$3,$4)", [requestId, submitted.quantity, meta.actor.username, meta.requestId]);
      await client.query("insert into production_nonconformance_events(nonconformance_id,event_type,from_status,to_status,quantity,actor,request_id) values($1,'REWORK_SUBMITTED',$2,$3,$4,$5,$6)", [ncrId, oldNcr.status, ncr.status, submitted.quantity, meta.actor.username, meta.requestId]);
      await this.fault?.("after_rework_submit"); return { status: 200, body: { ok: true, data: submitted, ncr, canonical_digest: digest, request_id: meta.requestId }, objectId: requestId };
    });
  }

  async decide(requestId: number, decision: "ACCEPT" | "RETURN", meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version), returnReason = decision === "RETURN" ? text(input.reason, "reason", 1000, true) : "";
    return this.repository.execute(meta, async (client) => {
      const identity = await client.query("select nonconformance_id from production_rework_requests where id=$1", [requestId]); if (!identity.rows[0]) throw new QualityError("REWORK_REQUEST_NOT_FOUND", "返工申请不存在", 404);
      const ncrId = Number(identity.rows[0].nonconformance_id); const oldNcr = await this.lockNcr(client, ncrId);
      const locked = await client.query<RequestRow>("select * from production_rework_requests where id=$1 for update", [requestId]); const row = locked.rows[0];
      if (!row || row.status !== "SUBMITTED" || Number(row.version) !== expected) throw new QualityError("REWORK_VERSION_OR_STATE_CONFLICT", "返工申请版本已变化或不在待接收状态", 409);
      if (row.created_by === meta.actor.username) throw new QualityError("REWORK_SEPARATION_OF_DUTIES", "返工申请创建人不能接收或退回自己的申请", 403);
      const next = decision === "ACCEPT" ? "ACCEPTED" : "RETURNED";
      const updated = await client.query(`update production_rework_requests set status=$2,decided_by=$3,decided_request_id=$4,decided_at=now(),return_reason=$5,version=version+1,updated_at=now() where id=$1 returning *`, [requestId, next, meta.actor.username, meta.requestId, returnReason]);
      if (next === "RETURNED") await client.query("update production_nonconformance_allocations set status='RELEASED',released_by=$2,released_request_id=$3,released_at=now(),updated_at=now() where rework_request_id=$1 and status='ACTIVE'", [requestId, meta.actor.username, meta.requestId]);
      if (next === "ACCEPTED") await initializeReworkExecution(client, requestId, meta.actor.username, meta.requestId);
      const ncr = await this.refresh(client, ncrId);
      await client.query("insert into production_rework_request_events(rework_request_id,event_type,from_status,to_status,quantity,reason,actor,request_id) values($1,$2,'SUBMITTED',$3,$4,$5,$6,$7)", [requestId, next, next, row.quantity, returnReason, meta.actor.username, meta.requestId]);
      await client.query("insert into production_nonconformance_events(nonconformance_id,event_type,from_status,to_status,quantity,reason,actor,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)", [ncrId, next === "ACCEPTED" ? "REWORK_ACCEPTED" : "REWORK_RETURNED", oldNcr.status, ncr.status, row.quantity, returnReason, meta.actor.username, meta.requestId]);
      await this.fault?.(`after_rework_${decision.toLowerCase()}`); return { status: 200, body: { ok: true, data: updated.rows[0], ncr, request_id: meta.requestId }, objectId: requestId };
    });
  }

  async cancelDraft(requestId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version), reason = text(input.reason, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => {
      const identity = await client.query("select nonconformance_id from production_rework_requests where id=$1", [requestId]); if (!identity.rows[0]) throw new QualityError("REWORK_REQUEST_NOT_FOUND", "返工申请不存在", 404);
      await this.lockNcr(client, Number(identity.rows[0].nonconformance_id)); const locked = await client.query<RequestRow>("select * from production_rework_requests where id=$1 for update", [requestId]); const row = locked.rows[0];
      if (!row || row.status !== "DRAFT" || Number(row.version) !== expected) throw new QualityError("REWORK_VERSION_OR_STATE_CONFLICT", "只有当前版本返工草稿可以取消", 409);
      const updated = await client.query("update production_rework_requests set status='CANCELLED',cancelled_by=$2,cancelled_request_id=$3,cancelled_at=now(),cancel_reason=$4,version=version+1,updated_at=now() where id=$1 returning *", [requestId, meta.actor.username, meta.requestId, reason]);
      await client.query("insert into production_rework_request_events(rework_request_id,event_type,from_status,to_status,quantity,reason,actor,request_id) values($1,'CANCELLED','DRAFT','CANCELLED',$2,$3,$4,$5)", [requestId, row.quantity, reason, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: requestId };
    });
  }

  async scrap(ncrId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version), qty = quantity(input.quantity, "quantity"), reason = text(input.reason, "reason", 2000, true);
    return this.repository.execute(meta, async (client) => {
      const oldNcr = await this.lockNcr(client, ncrId);
      if (oldNcr.status === "CANCELLED") throw new QualityError("NONCONFORMANCE_VERSION_CONFLICT", "不合格记录版本已变化或不可处置", 409);
      if (Number(qty) > Number(oldNcr.unresolved_qty)) throw new QualityError("NONCONFORMANCE_QUANTITY_EXCEEDED", "报废数量超过当前未分配不合格数量", 422);
      if (Number(oldNcr.version) !== expected) throw new QualityError("NONCONFORMANCE_VERSION_CONFLICT", "不合格记录版本已变化或不可处置", 409);
      const code = await this.nextCode(client, "PRODUCTION_SCRAP_DISPOSITION", "PSD");
      const saved = await client.query("insert into production_scrap_dispositions(disposition_code,nonconformance_id,quantity,reason,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7) returning *", [code, ncrId, qty, reason, meta.operationId, meta.actor.username, meta.requestId]);
      await client.query("insert into production_nonconformance_allocations(nonconformance_id,allocation_type,scrap_disposition_id,quantity,status,operation_id,created_by,request_id) values($1,'SCRAP',$2,$3,'FINAL',$4,$5,$6)", [ncrId, saved.rows[0].id, qty, meta.operationId, meta.actor.username, meta.requestId]);
      const ncr = await this.refresh(client, ncrId); await client.query("insert into production_nonconformance_events(nonconformance_id,event_type,from_status,to_status,quantity,reason,actor,request_id) values($1,'SCRAP_DISPOSED',$2,$3,$4,$5,$6,$7)", [ncrId, oldNcr.status, ncr.status, qty, reason, meta.actor.username, meta.requestId]);
      await this.fault?.("after_scrap_disposition"); return { status: 201, body: { ok: true, data: saved.rows[0], ncr, inventory_posting_created: false, request_id: meta.requestId }, objectId: Number(saved.rows[0].id) };
    });
  }

  async safelyCancelForInspectionReopen(client: PoolClient, inspectionId: number, actor: IdentityActor, requestId: string, reason: string) {
    const found = await client.query<NcrRow>("select * from production_nonconformances where inspection_id=$1 for update", [inspectionId]); const ncr = found.rows[0]; if (!ncr || ncr.status === "CANCELLED") return;
    const blocked = await client.query(`select exists(select 1 from production_nonconformance_allocations where nonconformance_id=$1 and status in ('ACTIVE','FINAL')) blocked,
      exists(select 1 from production_rework_requests where nonconformance_id=$1 and status in ('SUBMITTED','ACCEPTED')) history`, [ncr.id]);
    if (blocked.rows[0].blocked || blocked.rows[0].history) throw new QualityError("NONCONFORMANCE_DOWNSTREAM_EXISTS", "不合格记录已有返工或报废处置，检验不能重新打开", 409);
    await client.query("update production_rework_requests set status='CANCELLED',cancelled_by=$2,cancelled_request_id=$3,cancelled_at=now(),cancel_reason=$4,version=version+1,updated_at=now() where nonconformance_id=$1 and status='DRAFT'", [ncr.id, actor.username, requestId, reason]);
    await client.query("insert into production_rework_request_events(rework_request_id,event_type,from_status,to_status,quantity,reason,actor,request_id) select id,'CANCELLED','DRAFT','CANCELLED',quantity,$2,$3,$4 from production_rework_requests where nonconformance_id=$1 and status='CANCELLED' and cancelled_request_id=$4", [ncr.id, reason, actor.username, requestId]);
    const updated = await client.query("update production_nonconformances set status='CANCELLED',cancelled_by=$2,cancelled_request_id=$3,cancelled_at=now(),cancel_reason=$4,version=version+1,updated_at=now() where id=$1 returning *", [ncr.id, actor.username, requestId, reason]);
    await client.query("insert into production_nonconformance_events(nonconformance_id,event_type,from_status,to_status,quantity,reason,actor,request_id) values($1,'CANCELLED',$2,'CANCELLED',0,$3,$4,$5)", [ncr.id, ncr.status, reason, actor.username, requestId]);
    if (!updated.rows[0]) throw new QualityError("NONCONFORMANCE_VERSION_CONFLICT", "不合格记录已变化，请刷新后重试", 409);
  }
}
