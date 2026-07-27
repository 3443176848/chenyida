import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ProductionError } from "../production-selfhost/errors.ts";
import { ProductionRepository } from "../production-selfhost/repository.ts";
import type { ProductionMeta, ProductionResult } from "../production-selfhost/types.ts";

export const PRODUCTION_BATCH_BOUNDARY = Object.freeze({
  manufacturing_batch_genealogy: true,
  finished_goods_inventory_lot: true,
  raw_material_inventory_lot: false,
  supplier_inventory_lot: false,
  message: "成品 Manufacturing Batch 已绑定 Inventory Lot；原材料和供应商批次仍未启用。",
});

const id = (value: unknown, field: string) => { const result = Number(value); if (!Number.isSafeInteger(result) || result <= 0) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须为正整数`); return result; };
const version = (value: unknown, field = "expected_version") => id(value, field);
const quantity = (value: unknown, field = "planned_qty") => { const result = String(value ?? "").trim(); if (!/^(?:[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(result)) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须为正数且最多 6 位小数`); return result; };
const text = (value: unknown, field: string, maximum: number, required = false) => { const result = String(value ?? "").trim().normalize("NFKC"); if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; };
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

const BATCH_SELECT = `select b.*,s.batch_set_code,s.status batch_set_status,s.canonical_digest,s.routing_snapshot_id,s.bom_snapshot_id,s.product_version_id,s.finished_material_id,s.unit_id,wo.work_order_code,
  lot.id inventory_lot_id,lot.lot_code,lot.status inventory_lot_status,coalesce(lb.on_hand_qty,0)::text lot_on_hand_qty,coalesce(lb.frozen_qty,0)::text lot_frozen_qty,(coalesce(lb.on_hand_qty,0)-coalesce(lb.reserved_qty,0)-coalesce(lb.frozen_qty,0))::text lot_available_qty,
  coalesce(f.processed_qty,0)::text processed_qty,coalesce(f.good_qty,0)::text good_qty,coalesce(f.scrap_qty,0)::text scrap_qty,coalesce(f.released_qty,0)::text released_qty,coalesce(f.completed_qty,0)::text completed_qty,coalesce(f.rework_qty,0)::text rework_qty,coalesce(f.quality_hold_qty,0)::text quality_hold_qty,
  case when s.status='CANCELLED' then 'CANCELLED' when coalesce(f.completed_qty,0)=b.planned_qty then 'COMPLETED' when coalesce(f.quality_hold_qty,0)>0 then 'QUALITY_HOLD' when coalesce(f.rework_qty,0)>0 then 'REWORK' when coalesce(f.in_progress_count,0)>0 then 'IN_PROGRESS' when coalesce(f.run_count,0)>0 then 'IN_PROGRESS' when s.status='RELEASED' then 'READY' else 'PLANNED' end batch_status
  from production_batches b join production_batch_sets s on s.id=b.batch_set_id join production_work_orders wo on wo.id=b.work_order_id
  left join inventory_lots lot on lot.source_production_batch_id=b.id left join inventory_stock_balances lb on lb.inventory_lot_id=lot.id and lb.location_code='MAIN'
  left join lateral(
    select coalesce(sum(r.processed_qty),0) processed_qty,coalesce(sum(r.good_qty),0) good_qty,coalesce(sum(r.scrap_qty),0) scrap_qty,
      coalesce(sum(r.dispatched_qty) filter(where r.run_kind='REWORK' and r.status not in ('CANCELLED','REVERSED')),0) rework_qty,
      count(*) filter(where r.status not in ('CANCELLED','REVERSED')) run_count,count(*) filter(where r.status='IN_PROGRESS') in_progress_count,
      coalesce((select sum(q.inspected_qty-q.released_qty) from quality_inspections q join production_operation_run_reports rr on rr.id=q.production_operation_run_report_id join production_operation_runs qr on qr.id=rr.run_id where qr.production_batch_id=b.id and (q.lifecycle_status<>'CLOSED' or q.decision_status<>'RELEASED')),0) quality_hold_qty,
      coalesce((select sum(case when final_op.quality_gate_mode='IPQC' then coalesce(released.quantity,0) else rr.good_qty end) from production_operation_runs final_run join production_work_order_routing_snapshot_operations final_op on final_op.id=final_run.snapshot_operation_id join production_work_order_operation_projections final_projection on final_projection.snapshot_operation_id=final_op.id and final_projection.next_snapshot_operation_id is null join production_operation_run_reports rr on rr.run_id=final_run.id left join lateral(select coalesce(sum(q.released_qty),0) quantity from quality_inspections q where q.production_operation_run_report_id=rr.id and q.lifecycle_status='CLOSED' and q.decision_status='RELEASED') released on true where final_run.production_batch_id=b.id and final_run.status not in ('CANCELLED','REVERSED')),0) released_qty,
      coalesce((select sum(a.quantity) from production_completion_batches cb join production_completion_report_allocations a on a.completion_id=cb.production_completion_id join production_completion_receipt_projections cp on cp.completion_id=cb.production_completion_id and not cp.reversed where cb.production_batch_id=b.id),0) completed_qty
    from production_operation_runs r where r.production_batch_id=b.id and r.status not in ('CANCELLED','REVERSED')
  ) f on true`;

export class ProductionBatchService {
  readonly repository: ProductionRepository;
  readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: ProductionRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  async list(input: { code?: string; workOrderId?: number; status?: string }) {
    const values: unknown[] = [], where: string[] = [];
    if (input.code) { values.push(input.code); where.push(`b.batch_code=$${values.length}`); }
    if (input.workOrderId) { values.push(input.workOrderId); where.push(`b.work_order_id=$${values.length}`); }
    if (input.status) { values.push(input.status); where.push(`s.status=$${values.length}`); }
    return this.repository.pool.query(`${BATCH_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by b.created_at desc,b.id desc`, values);
  }

  async listSets() { return this.repository.pool.query(`select s.*,wo.work_order_code,wo.planned_qty work_order_planned_qty,coalesce(sum(b.planned_qty),0)::text batch_total,count(b.id)::int batch_count,jsonb_agg(jsonb_build_object('id',b.id,'batch_code',b.batch_code,'planned_qty',b.planned_qty,'version',b.version) order by b.id) filter(where b.id is not null) batches from production_batch_sets s join production_work_orders wo on wo.id=s.work_order_id left join production_batches b on b.batch_set_id=s.id group by s.id,wo.id order by s.created_at desc,s.id desc`); }

  async detail(batchId: number) {
    const batch = await this.repository.pool.query(`${BATCH_SELECT} where b.id=$1`, [batchId]);
    if (!batch.rows[0]) throw new ProductionError("PRODUCTION_BATCH_NOT_FOUND", "生产批次不存在", 404);
    const events = await this.repository.pool.query("select * from production_batch_events where batch_set_id=$1 and (production_batch_id is null or production_batch_id=$2) order by id", [Number(batch.rows[0].batch_set_id), batchId]);
    return { ...batch.rows[0], events: events.rows, boundary: PRODUCTION_BATCH_BOUNDARY };
  }

  async workOrderSummary(workOrderId: number) {
    const set = await this.repository.pool.query("select * from production_batch_sets where work_order_id=$1", [workOrderId]);
    if (!set.rows[0]) return { mode: "ORDER", work_order_id: workOrderId, batch_set: null, batches: [], boundary: PRODUCTION_BATCH_BOUNDARY };
    const batches = await this.list({ workOrderId });
    return { mode: set.rows[0].status === "RELEASED" ? "BATCH" : "ORDER", batch_set: set.rows[0], batches: batches.rows, boundary: PRODUCTION_BATCH_BOUNDARY };
  }

  async wip(batchId: number) {
    await this.detail(batchId);
    const result = await this.repository.pool.query(`select op.id snapshot_operation_id,op.sequence_no,op.operation_code,op.operation_name,op.quality_gate_mode,
      case when p.previous_snapshot_operation_id is null then b.planned_qty else coalesce(prev.released_qty,0) end::text source_input_qty,
      greatest(case when p.previous_snapshot_operation_id is null then b.planned_qty else coalesce(prev.released_qty,0) end-coalesce(f.normal_dispatched_qty,0),0)::text waiting_qty,
      coalesce(f.normal_dispatched_qty,0)::text dispatched_qty,coalesce(f.in_progress_qty,0)::text in_progress_qty,coalesce(f.good_qty,0)::text good_qty,coalesce(f.scrap_qty,0)::text scrap_qty,
      coalesce(q.quality_hold_qty,0)::text quality_hold_qty,coalesce(q.released_qty,case when op.quality_gate_mode='NONE' then f.good_qty else 0 end,0)::text released_qty,coalesce(f.rework_qty,0)::text rework_qty,
      greatest(coalesce(q.released_qty,case when op.quality_gate_mode='NONE' then f.good_qty else 0 end,0)-coalesce(x.transferred_qty,0),0)::text available_next_qty,
      case when p.next_snapshot_operation_id is null then greatest(coalesce(q.released_qty,case when op.quality_gate_mode='NONE' then f.good_qty else 0 end,0)-coalesce(x.transferred_qty,0)-coalesce(pr.reported_qty,0),0) else 0 end::text final_output_available_qty
      from production_batches b join production_batch_sets s on s.id=b.batch_set_id join production_work_order_operation_projections p on p.work_order_id=b.work_order_id join production_work_order_routing_snapshot_operations op on op.id=p.snapshot_operation_id
      left join lateral(select coalesce(sum(dispatched_qty) filter(where run_kind='NORMAL' and status not in ('CANCELLED','REVERSED')),0) normal_dispatched_qty,coalesce(sum(dispatched_qty-processed_qty) filter(where status='IN_PROGRESS'),0) in_progress_qty,coalesce(sum(good_qty) filter(where status not in ('CANCELLED','REVERSED')),0) good_qty,coalesce(sum(scrap_qty) filter(where status not in ('CANCELLED','REVERSED')),0) scrap_qty,coalesce(sum(dispatched_qty) filter(where run_kind='REWORK' and status not in ('CANCELLED','REVERSED')),0) rework_qty from production_operation_runs where production_batch_id=b.id and snapshot_operation_id=op.id) f on true
      left join lateral(select coalesce(sum(qi.released_qty) filter(where qi.lifecycle_status='CLOSED' and qi.decision_status='RELEASED'),0) released_qty,coalesce(sum(qi.inspected_qty-qi.released_qty),0) quality_hold_qty from quality_inspections qi join production_operation_run_reports rr on rr.id=qi.production_operation_run_report_id join production_operation_runs r on r.id=rr.run_id where r.production_batch_id=b.id and r.snapshot_operation_id=op.id) q on true
      left join lateral(select coalesce(sum(case when prevop.quality_gate_mode='IPQC' then qi.released_qty else prev.good_qty end),0) released_qty from production_operation_runs prev join production_work_order_routing_snapshot_operations prevop on prevop.id=prev.snapshot_operation_id left join production_operation_run_reports rr on rr.run_id=prev.id left join quality_inspections qi on qi.production_operation_run_report_id=rr.id and qi.lifecycle_status='CLOSED' and qi.decision_status='RELEASED' where prev.production_batch_id=b.id and prev.snapshot_operation_id=p.previous_snapshot_operation_id and prev.status not in ('CANCELLED','REVERSED')) prev on true
      left join lateral(select coalesce(sum(a.quantity),0) transferred_qty from production_operation_run_input_allocations a join production_operation_runs source on source.id=a.source_run_id join production_operation_runs target on target.id=a.run_id where source.production_batch_id=b.id and source.snapshot_operation_id=op.id and target.status not in ('CANCELLED','REVERSED')) x on true
      left join lateral(select coalesce(sum(a.quantity),0) reported_qty from production_report_operation_allocations a join production_operation_run_reports rr on rr.id=a.operation_run_report_id join production_operation_runs r on r.id=rr.run_id join production_report_receipt_projections rp on rp.report_id=a.production_report_id and not rp.reversed where r.production_batch_id=b.id and r.snapshot_operation_id=op.id) pr on true
      where b.id=$1 order by op.sequence_no,op.id`, [batchId]);
    return { batch_id: batchId, operations: result.rows, boundary: PRODUCTION_BATCH_BOUNDARY };
  }

  async genealogy(batchId: number) {
    const batch = await this.detail(batchId);
    const queries = await Promise.all([
      this.repository.pool.query(`select r.*,op.sequence_no,op.operation_code,op.operation_name from production_operation_runs r join production_work_order_routing_snapshot_operations op on op.id=r.snapshot_operation_id where r.production_batch_id=$1 order by r.id`, [batchId]),
      this.repository.pool.query(`select rr.* from production_operation_run_reports rr join production_operation_runs r on r.id=rr.run_id where r.production_batch_id=$1 order by rr.id`, [batchId]),
      this.repository.pool.query(`select a.* from production_operation_run_input_allocations a join production_operation_runs r on r.id=a.run_id where r.production_batch_id=$1 order by a.id`, [batchId]),
      this.repository.pool.query(`select qi.* from quality_inspections qi join production_operation_run_reports rr on rr.id=qi.production_operation_run_report_id join production_operation_runs r on r.id=rr.run_id where r.production_batch_id=$1 order by qi.id`, [batchId]),
      this.repository.pool.query(`select qd.* from quality_defects qd join quality_inspections qi on qi.id=qd.inspection_id join production_operation_run_reports rr on rr.id=qi.production_operation_run_report_id join production_operation_runs r on r.id=rr.run_id where r.production_batch_id=$1 order by qd.id`, [batchId]),
      this.repository.pool.query(`select n.* from production_nonconformances n join production_operation_run_reports rr on rr.id=n.production_operation_run_report_id join production_operation_runs r on r.id=rr.run_id where r.production_batch_id=$1 order by n.id`, [batchId]),
      this.repository.pool.query(`select rq.* from production_rework_requests rq join production_nonconformances n on n.id=rq.nonconformance_id join production_operation_run_reports rr on rr.id=n.production_operation_run_report_id join production_operation_runs r on r.id=rr.run_id where r.production_batch_id=$1 order by rq.id`, [batchId]),
      this.repository.pool.query(`select pr.*,rb.production_batch_id from production_report_batches rb join production_reports pr on pr.id=rb.production_report_id where rb.production_batch_id=$1 order by pr.id`, [batchId]),
      this.repository.pool.query(`select a.* from production_report_operation_allocations a join production_report_batches rb on rb.production_report_id=a.production_report_id where rb.production_batch_id=$1 order by a.id`, [batchId]),
      this.repository.pool.query(`select c.*,cb.production_batch_id,x.inventory_lot_id,l.lot_code,cp.reversed from production_completion_batches cb join production_completions c on c.id=cb.production_completion_id join production_completion_inventory_lots x on x.production_completion_id=c.id join inventory_lots l on l.id=x.inventory_lot_id join production_completion_receipt_projections cp on cp.completion_id=c.id where cb.production_batch_id=$1 order by c.id`, [batchId]),
      this.repository.pool.query(`select ia.id inventory_adjustment_id,il.id ledger_entry_id,il.inventory_lot_id,il.on_hand_delta::text,il.frozen_delta::text,il.location_code,il.lot_code from production_completion_batches cb join production_completions c on c.id=cb.production_completion_id join inventory_adjustments ia on ia.id=c.inventory_adjustment_id join inventory_ledger_entries il on il.adjustment_id=ia.id where cb.production_batch_id=$1 order by il.id`, [batchId]),
      this.repository.pool.query(`select e.event_type,e.actor,e.request_id,e.created_at from production_batch_events e where e.batch_set_id=$1 and (e.production_batch_id is null or e.production_batch_id=$2) order by e.id`, [Number(batch.batch_set_id), batchId]),
      this.repository.pool.query(`select l.*,s.on_hand_qty::text,s.reserved_qty::text,s.frozen_qty::text,(s.on_hand_qty-s.reserved_qty-s.frozen_qty)::text available_qty,s.version balance_version from inventory_lots l left join inventory_stock_balances s on s.inventory_lot_id=l.id and s.location_code='MAIN' where l.source_production_batch_id=$1`,[batchId]),
    ]);
    return { batch, normal_runs: queries[0].rows.filter((r) => r.run_kind === "NORMAL"), rework_runs: queries[0].rows.filter((r) => r.run_kind === "REWORK"), run_reports: queries[1].rows, input_allocations: queries[2].rows, inspections: queries[3].rows, defects: queries[4].rows, nonconformances: queries[5].rows, rework_requests: queries[6].rows, production_reports: queries[7].rows, final_output_allocations: queries[8].rows, completions: queries[9].rows, inventory_links: queries[10].rows, events: queries[11].rows, inventory_lot:queries[12].rows[0]??null, boundary: PRODUCTION_BATCH_BOUNDARY };
  }

  async createSet(meta: ProductionMeta, input: Record<string, unknown>): Promise<ProductionResult> {
    const workOrderId = id(input.work_order_id, "work_order_id"), expectedWorkOrderVersion = version(input.expected_work_order_version, "expected_work_order_version");
    return this.repository.execute(meta, async (client) => {
      const wo = await client.query("select * from production_work_orders where id=$1 for update", [workOrderId]);
      if (!wo.rows[0] || Number(wo.rows[0].version) !== expectedWorkOrderVersion || !["RELEASED", "IN_PROGRESS"].includes(wo.rows[0].status)) throw new ProductionError("WORK_ORDER_VERSION_CONFLICT", "工单不存在、状态或版本已变化", 409);
      if ((await client.query("select 1 from production_operation_runs where work_order_id=$1", [workOrderId])).rows[0]) throw new ProductionError("PRODUCTION_BATCH_RUN_EXISTS", "工单已有工序 Run，不能建立生产批次", 409);
      const code = await this.repository.nextCode(client, "PRODUCTION_BATCH_SET", "PBS");
      const saved = await client.query("insert into production_batch_sets(batch_set_code,work_order_id,operation_id,created_by,request_id) values($1,$2,$3,$4,$5) returning *", [code, workOrderId, meta.operationId, meta.actor.username, meta.requestId]);
      await client.query("insert into production_batch_events(batch_set_id,event_type,to_status,actor,request_id) values($1,'SET_CREATED','DRAFT',$2,$3)", [Number(saved.rows[0].id), meta.actor.username, meta.requestId]);
      await this.fault?.("after_batch_set_create");
      return { status: 201, body: { ok: true, data: saved.rows[0], boundary: PRODUCTION_BATCH_BOUNDARY, request_id: meta.requestId }, objectId: Number(saved.rows[0].id) };
    });
  }

  private async lockDraftSet(client: PoolClient, setId: number, expected: number) { const found = await client.query("select * from production_batch_sets where id=$1 for update", [setId]); const row = found.rows[0]; if (!row) throw new ProductionError("PRODUCTION_BATCH_SET_NOT_FOUND", "生产批次集合不存在", 404); if (row.status !== "DRAFT" || Number(row.version) !== expected) throw new ProductionError("PRODUCTION_BATCH_SET_VERSION_CONFLICT", "批次集合已发布、取消或版本变化", 409); return row; }

  async addBatch(setId: number, meta: ProductionMeta, input: Record<string, unknown>): Promise<ProductionResult> {
    const plannedQty = quantity(input.planned_qty), expected = version(input.expected_batch_set_version, "expected_batch_set_version");
    return this.repository.execute(meta, async (client) => { const set = await this.lockDraftSet(client, setId, expected); const code = await this.repository.nextCode(client, "PRODUCTION_BATCH", "PB"); const saved = await client.query("insert into production_batches(batch_code,batch_set_id,work_order_id,planned_qty,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7) returning *", [code, setId, Number(set.work_order_id), plannedQty, meta.operationId, meta.actor.username, meta.requestId]); const updated = await client.query("update production_batch_sets set version=version+1,updated_at=now() where id=$1 and version=$2 returning version", [setId, expected]); await client.query("insert into production_batch_events(batch_set_id,production_batch_id,event_type,to_status,quantity,actor,request_id) values($1,$2,'BATCH_ADDED','DRAFT',$3,$4,$5)", [setId, Number(saved.rows[0].id), plannedQty, meta.actor.username, meta.requestId]); return { status: 201, body: { ok: true, data: saved.rows[0], batch_set_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: Number(saved.rows[0].id) }; });
  }

  async updateBatch(batchId: number, meta: ProductionMeta, input: Record<string, unknown>): Promise<ProductionResult> {
    const plannedQty = quantity(input.planned_qty), expectedBatch = version(input.expected_version), expectedSet = version(input.expected_batch_set_version, "expected_batch_set_version");
    return this.repository.execute(meta, async (client) => { const found = await client.query("select * from production_batches where id=$1 for update", [batchId]); const row = found.rows[0]; if (!row) throw new ProductionError("PRODUCTION_BATCH_NOT_FOUND", "生产批次不存在", 404); await this.lockDraftSet(client, Number(row.batch_set_id), expectedSet); if (Number(row.version) !== expectedBatch) throw new ProductionError("PRODUCTION_BATCH_VERSION_CONFLICT", "生产批次版本已变化", 409); const saved = await client.query("update production_batches set planned_qty=$2,version=version+1,updated_at=now() where id=$1 and version=$3 returning *", [batchId, plannedQty, expectedBatch]); const updated = await client.query("update production_batch_sets set version=version+1,updated_at=now() where id=$1 and version=$2 returning version", [Number(row.batch_set_id), expectedSet]); await client.query("insert into production_batch_events(batch_set_id,production_batch_id,event_type,to_status,quantity,actor,request_id) values($1,$2,'BATCH_UPDATED','DRAFT',$3,$4,$5)", [Number(row.batch_set_id), batchId, plannedQty, meta.actor.username, meta.requestId]); return { status: 200, body: { ok: true, data: saved.rows[0], batch_set_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: batchId }; });
  }

  async deleteBatch(batchId: number, meta: ProductionMeta, input: Record<string, unknown>): Promise<ProductionResult> {
    const expectedBatch = version(input.expected_version), expectedSet = version(input.expected_batch_set_version, "expected_batch_set_version");
    return this.repository.execute(meta, async (client) => { const found = await client.query("select * from production_batches where id=$1 for update", [batchId]); const row = found.rows[0]; if (!row) throw new ProductionError("PRODUCTION_BATCH_NOT_FOUND", "生产批次不存在", 404); await this.lockDraftSet(client, Number(row.batch_set_id), expectedSet); if (Number(row.version) !== expectedBatch) throw new ProductionError("PRODUCTION_BATCH_VERSION_CONFLICT", "生产批次版本已变化", 409); await client.query("insert into production_batch_events(batch_set_id,event_type,to_status,quantity,reason,actor,request_id) values($1,'BATCH_DELETED','DRAFT',$2,$3,$4,$5)", [Number(row.batch_set_id), row.planned_qty, row.batch_code, meta.actor.username, meta.requestId]); await client.query("delete from production_batches where id=$1", [batchId]); const updated = await client.query("update production_batch_sets set version=version+1,updated_at=now() where id=$1 and version=$2 returning version", [Number(row.batch_set_id), expectedSet]); return { status: 200, body: { ok: true, deleted_batch_id: batchId, batch_set_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: batchId }; });
  }

  async release(setId: number, meta: ProductionMeta, input: Record<string, unknown>): Promise<ProductionResult> {
    const expected = version(input.expected_version);
    return this.repository.execute(meta, async (client) => { const set = await this.lockDraftSet(client, setId, expected); const wo = (await client.query("select * from production_work_orders where id=$1 for update", [Number(set.work_order_id)])).rows[0]; const batches = await client.query("select id,batch_code,planned_qty::text from production_batches where batch_set_id=$1 order by batch_code,id for update", [setId]); if (!batches.rows.length) throw new ProductionError("PRODUCTION_BATCH_REQUIRED", "发布前至少需要一个生产批次", 409); const total = (await client.query("select coalesce(sum(planned_qty),0)::text total from production_batches where batch_set_id=$1", [setId])).rows[0].total; if (!(await client.query("select $1::numeric=$2::numeric ok", [total, wo.planned_qty])).rows[0].ok) throw new ProductionError("PRODUCTION_BATCH_TOTAL_MISMATCH", "生产批次数量合计必须严格等于工单计划数量", 409); if ((await client.query("select 1 from production_operation_runs where work_order_id=$1", [Number(set.work_order_id)])).rows[0]) throw new ProductionError("PRODUCTION_BATCH_RUN_EXISTS", "工单已有工序 Run，不能发布生产批次", 409); const bom = (await client.query("select id from production_bom_snapshots where work_order_id=$1", [Number(set.work_order_id)])).rows[0], routing = (await client.query("select id,routing_digest from production_work_order_routing_snapshots where work_order_id=$1", [Number(set.work_order_id)])).rows[0]; if (!bom || !routing) throw new ProductionError("PRODUCTION_BATCH_SNAPSHOT_MISSING", "工单 BOM 或 Routing 快照缺失", 409); const canonicalDigest = digest({ work_order_id: Number(wo.id), work_order_code: wo.work_order_code, product_version_id: Number(wo.product_version_id), bom_snapshot_id: Number(bom.id), routing_snapshot_id: Number(routing.id), routing_digest: routing.routing_digest, finished_material_id: Number(wo.finished_material_id), unit_id: Number(wo.finished_unit_id), planned_qty: String(wo.planned_qty), batches: batches.rows.map((row) => ({ id: Number(row.id), batch_code: row.batch_code, planned_qty: String(row.planned_qty) })) }); const saved = await client.query(`update production_batch_sets set status='RELEASED',product_version_id=$2,bom_snapshot_id=$3,routing_snapshot_id=$4,finished_material_id=$5,unit_id=$6,planned_qty=$7,canonical_digest=$8,released_by=$9,released_request_id=$10,released_at=now(),version=version+1,updated_at=now() where id=$1 and status='DRAFT' and version=$11 returning *`, [setId, Number(wo.product_version_id), Number(bom.id), Number(routing.id), Number(wo.finished_material_id), Number(wo.finished_unit_id), String(wo.planned_qty), canonicalDigest, meta.actor.username, meta.requestId, expected]); if (!saved.rows[0]) throw new ProductionError("PRODUCTION_BATCH_SET_VERSION_CONFLICT", "批次集合并发发布冲突", 409); await client.query("insert into production_batch_events(batch_set_id,event_type,from_status,to_status,quantity,actor,request_id) values($1,'SET_RELEASED','DRAFT','RELEASED',$2,$3,$4)", [setId, total, meta.actor.username, meta.requestId]); await this.fault?.("after_batch_set_release"); return { status: 200, body: { ok: true, data: { ...saved.rows[0], batches: batches.rows }, boundary: PRODUCTION_BATCH_BOUNDARY, request_id: meta.requestId }, objectId: setId }; });
  }

  async cancel(setId: number, meta: ProductionMeta, input: Record<string, unknown>): Promise<ProductionResult> {
    const expected = version(input.expected_version), reason = text(input.reason, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => { await this.lockDraftSet(client, setId, expected); const saved = await client.query("update production_batch_sets set status='CANCELLED',cancelled_by=$2,cancelled_request_id=$3,cancelled_at=now(),cancel_reason=$4,version=version+1,updated_at=now() where id=$1 and status='DRAFT' and version=$5 returning *", [setId, meta.actor.username, meta.requestId, reason, expected]); await client.query("insert into production_batch_events(batch_set_id,event_type,from_status,to_status,reason,actor,request_id) values($1,'SET_CANCELLED','DRAFT','CANCELLED',$2,$3,$4)", [setId, reason, meta.actor.username, meta.requestId]); return { status: 200, body: { ok: true, data: saved.rows[0], request_id: meta.requestId }, objectId: setId }; });
  }
}
