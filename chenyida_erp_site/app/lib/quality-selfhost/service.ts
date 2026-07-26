import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { QualityError } from "./errors.ts";
import { defects, enumValue, id, optionalDate, quantity, resultLines, text, version, zeroQuantity } from "./rules.ts";
import { QualityRepository } from "./repository.ts";
import type { DefectInput, QualityMeta, QualityResult, ResultLineInput } from "./types.ts";

type InspectionType = "IQC" | "IPQC" | "FQC";
type InspectionRow = Record<string, unknown> & {
  id: string; inspection_type: InspectionType; lifecycle_status: "OPEN" | "CLOSED"; decision_status: "PENDING" | "HOLD" | "RELEASED";
  inspected_qty: string; passed_qty: string; failed_qty: string; released_qty: string; version: number; created_by: string;
  production_completion_line_id: string | null; sales_order_line_id: string | null; fqc_allocation_id: string | null;
};
type QualitySource = Record<string, unknown> & {
  material_id: string; unit_id: string; source_qty: string;
  completion_qty?: string; order_qty?: string; allocation_qty?: string;
  purchaseReceiptLineId: number | null; productionReportId: number | null; productionCompletionLineId: number | null; salesOrderLineId: number | null; fqcAllocationId: number | null;
};
const TYPES = ["IQC", "IPQC", "FQC"] as const;
const DISPOSITIONS = ["RELEASE", "CONCESSION", "REWORK", "RETURN_TO_SUPPLIER", "SCRAP"] as const;

export const QUALITY_BOUNDARY = Object.freeze({
  iqc_inventory_isolation: false,
  iqc_boundary: "IQC 只建立采购收货明细的可信品质状态；当前无批次/隔离库位，不能映射池化库存剩余量，也不会冻结全局库存。",
  ipqc_boundary: "IPQC 只关联不可变生产报工；不会修改工单、领料、报工、完工或库存，也不会自动执行返工工艺。",
  fqc_boundary: "只有已关闭且有效放行的 FQC 数量可供对应销售明细发货使用。",
  financial_posting_created: false,
});

export function visibleQualityTypes(actor: Pick<IdentityActor, "role">): InspectionType[] {
  if (["admin", "manager", "quality"].includes(actor.role)) return [...TYPES];
  if (actor.role === "purchase") return ["IQC"];
  if (["production", "engineering"].includes(actor.role)) return ["IPQC", "FQC"];
  if (["warehouse", "finance"].includes(actor.role)) return ["IQC", "FQC"];
  if (actor.role === "sales") return ["FQC"];
  if (actor.role === "operations") return [...TYPES];
  return [];
}

function assertVisible(actor: Pick<IdentityActor, "role">, inspectionType: string): asserts inspectionType is InspectionType {
  if (!visibleQualityTypes(actor).includes(inspectionType as InspectionType)) throw new QualityError("QUALITY_NOT_VISIBLE", "品质记录不存在", 404);
}

function assertSourceShape(type: InspectionType, input: Record<string, unknown>) {
  const expected = type === "IQC" ? ["purchase_receipt_line_id"] : type === "IPQC" ? ["production_report_id"] : ["allocation_id"];
  const sourceKeys = ["purchase_receipt_line_id", "production_report_id", "production_completion_line_id", "sales_order_line_id", "allocation_id"];
  if (sourceKeys.some((key) => !expected.includes(key) && input[key] !== undefined && input[key] !== null && input[key] !== "")) throw new QualityError("QUALITY_SOURCE_INVALID", "检验类型只能绑定规定的稳定来源", 422);
}

export class QualityService {
  readonly repository: QualityRepository; readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: QualityRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  async list(actor: IdentityActor, limit: number, offset: number, requestedType?: string, lifecycle?: string) {
    const types = visibleQualityTypes(actor); if (!types.length) throw new QualityError("PERMISSION_DENIED", "没有权限读取品质记录", 403);
    const values: unknown[] = [types]; const where = ["qi.inspection_type=any($1::text[])"];
    if(actor.role==="production"){values.push(actor.username);where.push(`(exists(select 1 from production_reports pr join production_work_orders wo on wo.id=pr.work_order_id where pr.id=qi.production_report_id and (wo.created_by=$${values.length} or wo.owner=$${values.length})) or exists(select 1 from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id join production_work_orders wo on wo.id=pc.work_order_id where pcl.id=qi.production_completion_line_id and (wo.created_by=$${values.length} or wo.owner=$${values.length})))`);}
    if (requestedType) { const selected = enumValue(requestedType, "inspection_type", TYPES); assertVisible(actor, selected); values.push(selected); where.push(`qi.inspection_type=$${values.length}`); }
    if (lifecycle) { values.push(enumValue(lifecycle, "lifecycle_status", ["OPEN", "CLOSED"] as const)); where.push(`qi.lifecycle_status=$${values.length}`); }
    values.push(limit, offset);
    return this.repository.pool.query(`select qi.*,m.internal_material_code material_code,m.internal_material_code item_code,m.internal_material_code product_code,m.standard_name material_name,m.standard_name item_name,m.standard_name product_name,u.code unit_code,u.code uom,
      case qi.inspection_type when 'IQC' then '采购收货明细' when 'IPQC' then '生产报工' else '完工/销售明细' end ref_type,
      qi.lifecycle_status||'/'||qi.decision_status inspection_status,qi.created_by inspector,coalesce(last_event.disposition_code,'') disposition
      from quality_inspections qi join material_master m on m.id=qi.material_id join units u on u.id=qi.unit_id
      left join lateral(select e.disposition_code from quality_inspection_events e where e.inspection_id=qi.id and e.event_type='DISPOSITIONED' order by e.id desc limit 1) last_event on true
      where ${where.join(" and ")} order by qi.inspection_date desc,qi.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async listDefects(actor: IdentityActor, limit: number, offset: number, inspectionId?: number) {
    const types = visibleQualityTypes(actor); if (!types.length) throw new QualityError("PERMISSION_DENIED", "没有权限读取品质记录", 403);
    const values: unknown[] = [types]; const where = ["qi.inspection_type=any($1::text[])"];
    if(actor.role==="production"){values.push(actor.username);where.push(`(exists(select 1 from production_reports pr join production_work_orders wo on wo.id=pr.work_order_id where pr.id=qi.production_report_id and (wo.created_by=$${values.length} or wo.owner=$${values.length})) or exists(select 1 from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id join production_work_orders wo on wo.id=pc.work_order_id where pcl.id=qi.production_completion_line_id and (wo.created_by=$${values.length} or wo.owner=$${values.length})))`);}
    if (inspectionId) { values.push(inspectionId); where.push(`qd.inspection_id=$${values.length}`); }
    values.push(limit, offset);
    return this.repository.pool.query(`select qd.*,qd.quantity defect_qty,qd.description corrective_action,qi.inspection_code,qi.inspection_type,qi.responsible_stage from quality_defects qd join quality_inspections qi on qi.id=qd.inspection_id where ${where.join(" and ")} order by qd.created_at desc,qd.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async get(actor: IdentityActor, inspectionId: number) {
    const found = await this.repository.pool.query(`select qi.*,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code from quality_inspections qi join material_master m on m.id=qi.material_id join units u on u.id=qi.unit_id where qi.id=$1`, [inspectionId]);
    if (!found.rows[0]) throw new QualityError("QUALITY_INSPECTION_NOT_FOUND", "检验记录不存在", 404); assertVisible(actor, String(found.rows[0].inspection_type)); await this.assertProductionScope(actor,inspectionId);
    const [results, defectsFound, events] = await Promise.all([this.repository.pool.query("select * from quality_inspection_results where inspection_id=$1 order by line_no", [inspectionId]), this.repository.pool.query("select * from quality_defects where inspection_id=$1 order by id", [inspectionId]), this.repository.pool.query("select * from quality_inspection_events where inspection_id=$1 order by id", [inspectionId])]);
    return { ...found.rows[0], results: results.rows, defects: defectsFound.rows, events: events.rows, boundary: QUALITY_BOUNDARY };
  }

  async resultLines(actor: IdentityActor, inspectionId: number) { await this.getVisibleInspection(actor, inspectionId); return this.repository.pool.query("select * from quality_inspection_results where inspection_id=$1 order by line_no", [inspectionId]); }

  private async assertProductionScope(actor:IdentityActor,inspectionId:number){if(actor.role!=="production")return;const owned=await this.repository.pool.query(`select 1 from quality_inspections qi where qi.id=$1 and (exists(select 1 from production_reports pr join production_work_orders wo on wo.id=pr.work_order_id where pr.id=qi.production_report_id and (wo.created_by=$2 or wo.owner=$2)) or exists(select 1 from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id join production_work_orders wo on wo.id=pc.work_order_id where pcl.id=qi.production_completion_line_id and (wo.created_by=$2 or wo.owner=$2)))`,[inspectionId,actor.username]);if(!owned.rows[0])throw new QualityError("QUALITY_INSPECTION_NOT_FOUND","检验记录不存在",404);}

  private async getVisibleInspection(actor: IdentityActor, inspectionId: number) { const found = await this.repository.pool.query<{ inspection_type: string }>("select inspection_type from quality_inspections where id=$1", [inspectionId]); if (!found.rows[0]) throw new QualityError("QUALITY_INSPECTION_NOT_FOUND", "检验记录不存在", 404); assertVisible(actor, found.rows[0].inspection_type);await this.assertProductionScope(actor,inspectionId); }

  async listAllocations(actor:IdentityActor,limit = 100, offset = 0, status?: string) {
    const values: unknown[] = []; const where: string[] = [];
    if(actor.role==="production"){values.push(actor.username);where.push(`(wo.created_by=$${values.length} or wo.owner=$${values.length})`);}
    if (status) { values.push(enumValue(status, "status", ["ACTIVE", "CANCELLED"] as const)); where.push(`a.status=$${values.length}`); }
    values.push(limit, offset);
    return this.repository.pool.query(`select a.*,pc.completion_code,wo.work_order_code,so.sales_order_code,so.customer_id,sol.product_id,sol.product_version_id,
      m.internal_material_code material_code,m.standard_name material_name,u.code unit_code,coalesce(inspected.inspected_qty,0)::text inspected_qty,
      coalesce(released.released_qty,0)::text released_qty
      from finished_goods_sales_allocations a join production_completion_lines pcl on pcl.id=a.completion_line_id join production_completions pc on pc.id=pcl.completion_id
      join production_work_orders wo on wo.id=pc.work_order_id join sales_order_lines sol on sol.id=a.sales_order_line_id join sales_order_versions sov on sov.id=sol.sales_order_version_id
      join sales_orders so on so.id=sov.sales_order_id join material_master m on m.id=pcl.material_id join units u on u.id=pcl.unit_id
      left join lateral(select coalesce(sum(qi.inspected_qty),0) inspected_qty from quality_inspections qi where qi.fqc_allocation_id=a.id) inspected on true
      left join lateral(select coalesce(sum(qi.released_qty),0) released_qty from quality_inspections qi where qi.fqc_allocation_id=a.id and qi.lifecycle_status='CLOSED' and qi.decision_status='RELEASED') released on true
      ${where.length ? `where ${where.join(" and ")}` : ""} order by a.id desc limit $${values.length - 1} offset $${values.length}`, values);
  }

  async allocationOptions(limit = 100) {
    return this.repository.pool.query(`select pcl.id completion_line_id,sol.id sales_order_line_id,pc.completion_code,wo.work_order_code,so.sales_order_code,
      so.customer_id,sol.product_id,sol.product_version_id,pcl.material_id,pcl.unit_id,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code,
      cp.version completion_version,sol.version sales_order_line_version,
      (pcl.quantity-coalesce(ca.allocated,0))::text completion_remaining_qty,(sol.ordered_qty-coalesce(oa.allocated,0))::text sales_order_remaining_qty,
      least(pcl.quantity-coalesce(ca.allocated,0),sol.ordered_qty-coalesce(oa.allocated,0))::text allocatable_qty
      from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id join production_completion_receipt_projections cp on cp.completion_id=pc.id and not cp.reversed
      join production_work_orders wo on wo.id=pc.work_order_id join products p on p.id=wo.product_id
      join sales_order_lines sol on sol.product_id=wo.product_id and sol.product_version_id=wo.product_version_id and sol.finished_material_id=wo.finished_material_id and sol.unit_id=wo.finished_unit_id
      join sales_order_versions sov on sov.id=sol.sales_order_version_id join sales_orders so on so.id=sov.sales_order_id and so.current_version_no=sov.version_no and so.status in ('OPEN','PARTIALLY_SHIPPED') and so.customer_id=p.customer_id
      join material_master m on m.id=pcl.material_id join units u on u.id=pcl.unit_id
      left join lateral(select sum(quantity) allocated from finished_goods_sales_allocations where completion_line_id=pcl.id and status='ACTIVE') ca on true
      left join lateral(select sum(quantity) allocated from finished_goods_sales_allocations where sales_order_line_id=sol.id and status='ACTIVE') oa on true
      where pcl.quantity>coalesce(ca.allocated,0) and sol.ordered_qty>coalesce(oa.allocated,0)
        and not exists(select 1 from finished_goods_sales_allocations existing where existing.completion_line_id=pcl.id and existing.sales_order_line_id=sol.id)
      order by pcl.id desc,sol.id desc limit $1`, [limit]);
  }

  async createAllocation(meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const completionLineId=id(input.completion_line_id,"completion_line_id"),salesOrderLineId=id(input.sales_order_line_id,"sales_order_line_id"),allocatedQty=quantity(input.quantity,"quantity");
    const expectedCompletionVersion=version(input.expected_completion_version),expectedSalesLineVersion=id(input.expected_sales_order_line_version,"expected_sales_order_line_version");
    return this.repository.execute(meta,async(client)=>{
      const source=await client.query(`select pcl.quantity completion_qty,cp.version completion_version,cp.reversed,p.customer_id work_customer,wo.product_id work_product,wo.product_version_id work_product_version,wo.finished_material_id work_material,wo.finished_unit_id work_unit
        from production_completion_lines pcl join production_completions pc on pc.id=pcl.completion_id join production_completion_receipt_projections cp on cp.completion_id=pc.id
        join production_work_orders wo on wo.id=pc.work_order_id join products p on p.id=wo.product_id where pcl.id=$1 for update of pcl,cp`,[completionLineId]);
      const target=await client.query(`select sol.ordered_qty,sol.version line_version,so.status,so.customer_id order_customer,sol.product_id order_product,sol.product_version_id order_product_version,sol.finished_material_id order_material,sol.unit_id order_unit
        from sales_order_lines sol join sales_order_versions sov on sov.id=sol.sales_order_version_id join sales_orders so on so.id=sov.sales_order_id and so.current_version_no=sov.version_no where sol.id=$1 for update of sol,so`,[salesOrderLineId]);
      const s=source.rows[0],t=target.rows[0]; if(!s||!t||s.reversed||!["OPEN","PARTIALLY_SHIPPED"].includes(t.status)||s.work_customer!==t.order_customer||s.work_product!==t.order_product||s.work_product_version!==t.order_product_version||s.work_material!==t.order_material||s.work_unit!==t.order_unit)throw new QualityError("FINISHED_GOODS_ALLOCATION_SOURCE_MISMATCH","完工与销售明细的客户、产品版本、成品物料或单位不一致",422);
      if(Number(s.completion_version)!==expectedCompletionVersion||Number(t.line_version)!==expectedSalesLineVersion)throw new QualityError("FINISHED_GOODS_ALLOCATION_VERSION_CONFLICT","完工或销售明细版本已变化，请刷新后重试",409);
      const used=await client.query(`select coalesce(sum(quantity) filter(where completion_line_id=$1 and status='ACTIVE'),0)::numeric completion_used,coalesce(sum(quantity) filter(where sales_order_line_id=$2 and status='ACTIVE'),0)::numeric order_used from finished_goods_sales_allocations where completion_line_id=$1 or sales_order_line_id=$2`,[completionLineId,salesOrderLineId]);
      const capacity=await client.query("select $1::numeric+$2::numeric<=$3::numeric completion_ok,$4::numeric+$2::numeric<=$5::numeric order_ok",[used.rows[0].completion_used,allocatedQty,s.completion_qty,used.rows[0].order_used,t.ordered_qty]);
      if(!capacity.rows[0].completion_ok||!capacity.rows[0].order_ok)throw new QualityError("FINISHED_GOODS_ALLOCATION_EXCEEDED","分配数量超过完工或销售明细可分配数量",409);
      const created=await client.query(`insert into finished_goods_sales_allocations(completion_line_id,sales_order_line_id,quantity,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6) returning *`,[completionLineId,salesOrderLineId,allocatedQty,meta.operationId,meta.actor.username,meta.requestId]);
      const allocationId=Number(created.rows[0].id); await client.query("insert into finished_goods_sales_allocation_events(allocation_id,event_type,quantity,actor,request_id) values($1,'CREATED',$2,$3,$4)",[allocationId,allocatedQty,meta.actor.username,meta.requestId]); await this.fault?.("after_finished_goods_allocation_create");
      return{status:201,body:{ok:true,data:created.rows[0],allocation_id:allocationId,request_id:meta.requestId},objectId:allocationId};
    });
  }

  async cancelAllocation(allocationId:number,meta:QualityMeta,input:Record<string,unknown>):Promise<QualityResult>{
    const expected=version(input.expected_version),reason=text(input.reason,"取消原因",1000,true);
    return this.repository.execute(meta,async(client)=>{const found=await client.query("select * from finished_goods_sales_allocations where id=$1 for update",[allocationId]);const row=found.rows[0];if(!row)throw new QualityError("FINISHED_GOODS_ALLOCATION_NOT_FOUND","成品订单分配不存在",404);if(row.status!=="ACTIVE"||Number(row.version)!==expected)throw new QualityError("FINISHED_GOODS_ALLOCATION_VERSION_CONFLICT","分配状态或版本已变化，请刷新后重试",409);if((await client.query("select 1 from quality_inspections where fqc_allocation_id=$1 limit 1",[allocationId])).rows[0])throw new QualityError("FINISHED_GOODS_ALLOCATION_FQC_EXISTS","分配已有 FQC，不能取消或改写",409);const updated=await client.query("update finished_goods_sales_allocations set status='CANCELLED',version=version+1,cancelled_by=$2,cancelled_request_id=$3,cancelled_at=now(),cancel_reason=$4,updated_at=now() where id=$1 and status='ACTIVE' and version=$5 returning *",[allocationId,meta.actor.username,meta.requestId,reason,expected]);if(!updated.rows[0])throw new QualityError("FINISHED_GOODS_ALLOCATION_VERSION_CONFLICT","分配并发取消冲突",409);await client.query("insert into finished_goods_sales_allocation_events(allocation_id,event_type,quantity,reason,actor,request_id) values($1,'CANCELLED',$2,$3,$4,$5)",[allocationId,row.quantity,reason,meta.actor.username,meta.requestId]);await this.fault?.("after_finished_goods_allocation_cancel");return{status:200,body:{ok:true,data:updated.rows[0],request_id:meta.requestId},objectId:allocationId};});
  }

  async sourceOptions(actor: IdentityActor, type: string, limit = 100) {
    const selected = enumValue(type, "inspection_type", TYPES); assertVisible(actor, selected);
    if (selected === "IQC") return this.repository.pool.query(`select prl.id purchase_receipt_line_id,pr.receipt_code source_code,prl.material_id,prl.unit_id,prl.quantity::text source_qty,(prl.quantity-coalesce(used.inspected,0))::text remaining_qty,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code
      from purchase_receipt_lines prl join purchase_receipts pr on pr.id=prl.purchase_receipt_id and pr.receipt_type='RECEIPT' join material_master m on m.id=prl.material_id join units u on u.id=prl.unit_id
      left join lateral(select sum(qi.inspected_qty) inspected from quality_inspections qi where qi.purchase_receipt_line_id=prl.id) used on true
      where not exists(select 1 from purchase_receipts rr where rr.reversal_of_receipt_id=pr.id) and prl.quantity>coalesce(used.inspected,0) order by prl.id desc limit $1`, [limit]);
    if (selected === "IPQC") return this.repository.pool.query(`select r.id production_report_id,r.report_code source_code,wo.finished_material_id material_id,wo.finished_unit_id unit_id,r.reported_qty::text source_qty,(r.reported_qty-coalesce(used.inspected,0))::text remaining_qty,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code
      from production_reports r join production_report_receipt_projections rp on rp.report_id=r.id and not rp.reversed join production_work_orders wo on wo.id=r.work_order_id join material_master m on m.id=wo.finished_material_id join units u on u.id=wo.finished_unit_id
      left join lateral(select sum(qi.inspected_qty) inspected from quality_inspections qi where qi.production_report_id=r.id) used on true
      where r.reported_qty>coalesce(used.inspected,0) order by r.id desc limit $1`, [limit]);
    return this.repository.pool.query(`select a.id allocation_id,a.completion_line_id,a.sales_order_line_id,pc.completion_code||' / '||so.sales_order_code source_code,pcl.material_id,pcl.unit_id,a.quantity::text source_qty,
      (a.quantity-coalesce(used.inspected,0))::text remaining_qty,m.internal_material_code material_code,m.standard_name material_name,u.code unit_code
      from finished_goods_sales_allocations a join production_completion_lines pcl on pcl.id=a.completion_line_id join production_completions pc on pc.id=pcl.completion_id
      join production_completion_receipt_projections cp on cp.completion_id=pc.id and not cp.reversed join sales_order_lines sol on sol.id=a.sales_order_line_id
      join sales_order_versions sov on sov.id=sol.sales_order_version_id join sales_orders so on so.id=sov.sales_order_id and so.current_version_no=sov.version_no and so.status in ('OPEN','PARTIALLY_SHIPPED')
      join material_master m on m.id=pcl.material_id join units u on u.id=pcl.unit_id left join lateral(select sum(qi.inspected_qty) inspected from quality_inspections qi where qi.fqc_allocation_id=a.id) used on true
      where a.status='ACTIVE' and a.quantity>coalesce(used.inspected,0) order by a.id desc limit $1`, [limit]);
  }

  async eligibility(actor: IdentityActor, salesOrderLineId: number) {
    if (!["admin", "manager", "quality", "production", "warehouse", "sales", "finance"].includes(actor.role)) throw new QualityError("QUALITY_NOT_VISIBLE", "销售明细品质额度不存在", 404);
    const result = await this.repository.pool.query(`with released as (
        select coalesce(sum(released_qty),0)::numeric released_qty from quality_inspections where sales_order_line_id=$1 and inspection_type='FQC' and lifecycle_status='CLOSED' and decision_status='RELEASED'
      ), consumed as (
        select coalesce(sum(case when sh.shipment_type='SHIPMENT' then sl.quantity else -sl.quantity end),0)::numeric consumed_qty from sales_shipment_lines sl join sales_shipments sh on sh.id=sl.shipment_id where sl.sales_order_line_id=$1
      )
      select sol.id sales_order_line_id,sol.ordered_qty::text,sol.shipped_qty::text,released.released_qty::text,consumed.consumed_qty::text consumed_qty,greatest(released.released_qty-consumed.consumed_qty,0)::text available_qty
      from sales_order_lines sol cross join released cross join consumed where sol.id=$1`, [salesOrderLineId]);
    if (!result.rows[0]) throw new QualityError("SALES_ORDER_LINE_NOT_FOUND", "销售明细不存在", 404); return { ...result.rows[0], boundary: QUALITY_BOUNDARY };
  }

  private async lockInspection(client: PoolClient, inspectionId: number): Promise<InspectionRow> { const found = await client.query<InspectionRow>("select * from quality_inspections where id=$1 for update", [inspectionId]); if (!found.rows[0]) throw new QualityError("QUALITY_INSPECTION_NOT_FOUND", "检验记录不存在", 404); return found.rows[0]; }

  private async lockFqcSources(client: PoolClient, inspection: Pick<InspectionRow, "production_completion_line_id" | "sales_order_line_id" | "fqc_allocation_id">) {
    if(inspection.fqc_allocation_id){const allocation=await client.query("select id,quantity,status from finished_goods_sales_allocations where id=$1 for update",[inspection.fqc_allocation_id]);if(!allocation.rows[0]||allocation.rows[0].status!=="ACTIVE")throw new QualityError("QUALITY_SOURCE_INVALID","FQC 稳定分配不存在或已取消",422);}
    const order = await client.query("select id,ordered_qty from sales_order_lines where id=$1 for update", [inspection.sales_order_line_id]);
    const completion = await client.query("select id,quantity from production_completion_lines where id=$1 for update", [inspection.production_completion_line_id]);
    if (!order.rows[0] || !completion.rows[0]) throw new QualityError("QUALITY_SOURCE_INVALID", "FQC 来源不存在", 422); return { order: order.rows[0], completion: completion.rows[0] };
  }

  private async lockFqcInspection(client: PoolClient, inspectionId: number) {
    const peek = await client.query<InspectionRow>("select * from quality_inspections where id=$1", [inspectionId]); if (!peek.rows[0]) throw new QualityError("QUALITY_INSPECTION_NOT_FOUND", "检验记录不存在", 404);
    if (peek.rows[0].inspection_type !== "FQC") return { row: await this.lockInspection(client, inspectionId), sources: null };
    const sources = await this.lockFqcSources(client, peek.rows[0]); return { row: await this.lockInspection(client, inspectionId), sources };
  }

  private async resolveSource(client: PoolClient, type: InspectionType, input: Record<string, unknown>): Promise<QualitySource> {
    if (type === "IQC") { const sourceId = id(input.purchase_receipt_line_id, "purchase_receipt_line_id"); const found = await client.query(`select prl.material_id::text,prl.unit_id::text,prl.quantity::text source_qty from purchase_receipt_lines prl join purchase_receipts pr on pr.id=prl.purchase_receipt_id and pr.receipt_type='RECEIPT' where prl.id=$1 and not exists(select 1 from purchase_receipts rr where rr.reversal_of_receipt_id=pr.id) for update of prl`, [sourceId]); if (!found.rows[0]) throw new QualityError("QUALITY_SOURCE_INVALID", "采购收货明细不存在、已冲销或不可检验", 422); return { purchaseReceiptLineId: sourceId, productionReportId: null, productionCompletionLineId: null, salesOrderLineId: null, fqcAllocationId:null, ...found.rows[0] } as QualitySource; }
    if (type === "IPQC") { const sourceId = id(input.production_report_id, "production_report_id"); const found = await client.query(`select wo.finished_material_id::text material_id,wo.finished_unit_id::text unit_id,r.reported_qty::text source_qty from production_reports r join production_report_receipt_projections rp on rp.report_id=r.id and not rp.reversed join production_work_orders wo on wo.id=r.work_order_id where r.id=$1 for update of r,rp`, [sourceId]); if (!found.rows[0]) throw new QualityError("QUALITY_SOURCE_INVALID", "生产报工不存在、已冲销或不可检验", 422); return { purchaseReceiptLineId: null, productionReportId: sourceId, productionCompletionLineId: null, salesOrderLineId: null, fqcAllocationId:null, ...found.rows[0] } as QualitySource; }
    const allocationId=id(input.allocation_id,"allocation_id");
    const found=await client.query(`select a.id,a.quantity::text allocation_qty,a.completion_line_id,a.sales_order_line_id,pcl.material_id::text,pcl.unit_id::text,pcl.quantity::text completion_qty,sol.ordered_qty::text order_qty
      from finished_goods_sales_allocations a join production_completion_lines pcl on pcl.id=a.completion_line_id join production_completions pc on pc.id=pcl.completion_id
      join production_completion_receipt_projections cp on cp.completion_id=pc.id and not cp.reversed join sales_order_lines sol on sol.id=a.sales_order_line_id
      join sales_order_versions sov on sov.id=sol.sales_order_version_id join sales_orders so on so.id=sov.sales_order_id and so.current_version_no=sov.version_no and so.status in ('OPEN','PARTIALLY_SHIPPED')
      where a.id=$1 and a.status='ACTIVE' for update of a,pcl,cp,sol,so`,[allocationId]);
    const row=found.rows[0];if(!row)throw new QualityError("QUALITY_SOURCE_INVALID","有效的成品订单分配不存在",422);
    return{purchaseReceiptLineId:null,productionReportId:null,productionCompletionLineId:Number(row.completion_line_id),salesOrderLineId:Number(row.sales_order_line_id),fqcAllocationId:allocationId,material_id:row.material_id,unit_id:row.unit_id,source_qty:row.allocation_qty,allocation_qty:row.allocation_qty,completion_qty:row.completion_qty,order_qty:row.order_qty};
  }

  private async validateCreateQuantities(client: PoolClient, type: InspectionType, source: QualitySource, inspected: string, passed: string, failed: string, results: ResultLineInput[], defectInputs: DefectInput[]) {
    const quantities = await client.query("select $1::numeric>0 and $2::numeric>=0 and $3::numeric>=0 and $2::numeric+$3::numeric=$1::numeric conserved", [inspected, passed, failed]);
    if (!quantities.rows[0].conserved) throw new QualityError("QUALITY_QUANTITY_INVALID", "合格数量与不良数量之和必须等于检验数量", 422);
    const hasFailed = !zeroQuantity(failed); if (hasFailed && (!results.some((row) => row.result === "FAIL") || defectInputs.length === 0)) throw new QualityError("QUALITY_DEFECT_REQUIRED", "存在不良数量时必须同时提交 FAIL 结果和有效缺陷", 422); if (!hasFailed && (results.some((row) => row.result === "FAIL") || defectInputs.length > 0)) throw new QualityError("QUALITY_RESULT_INCONSISTENT", "无不良数量时不能提交 FAIL 结果或缺陷", 422);
    const defectTotal = await client.query("select coalesce(sum(value::numeric),0)<=$2::numeric ok from unnest($1::text[]) value", [defectInputs.map((item) => item.quantity), failed]); if (!defectTotal.rows[0].ok) throw new QualityError("QUALITY_DEFECT_QUANTITY_EXCEEDED", "缺陷累计数量超过不良数量", 422);
    if (defectInputs.some((item) => item.resultLineNo !== null && (item.resultLineNo! > results.length || results[item.resultLineNo! - 1].result !== "FAIL"))) throw new QualityError("QUALITY_RESULT_LINE_INVALID", "缺陷只能引用本次提交的 FAIL 结果明细", 422);
    if (type === "FQC") {
      const used = await client.query("select coalesce(sum(inspected_qty),0)::numeric used from quality_inspections where fqc_allocation_id=$1", [source.fqcAllocationId]);
      const allowed = await client.query("select $1::numeric+$2::numeric<=$3::numeric ok", [used.rows[0].used, inspected, source.allocation_qty]); if (!allowed.rows[0].ok) throw new QualityError("QUALITY_SOURCE_OVER_INSPECTED", "累计 FQC 检验数量超过稳定分配数量", 409);
    } else {
      const column = type === "IQC" ? "purchase_receipt_line_id" : "production_report_id"; const sourceId = type === "IQC" ? source.purchaseReceiptLineId : source.productionReportId;
      const used = await client.query(`select coalesce(sum(inspected_qty),0)::numeric used from quality_inspections where ${column}=$1`, [sourceId]); const allowed = await client.query("select $1::numeric+$2::numeric<=$3::numeric ok", [used.rows[0].used, inspected, source.source_qty]); if (!allowed.rows[0].ok) throw new QualityError("QUALITY_SOURCE_OVER_INSPECTED", "累计检验数量超过来源允许范围", 409);
    }
  }

  private async insertDefect(client: PoolClient, inspectionId: number, input: DefectInput, resultId: number | null, meta: QualityMeta) { const code = await this.repository.nextCode(client, "QUALITY_DEFECT", "QD"); return client.query("insert into quality_defects(defect_code,inspection_id,result_line_id,defect_type,severity,quantity,description,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *", [code, inspectionId, resultId, input.defectType, input.severity, input.quantity, input.description, randomUUID(), meta.actor.username, meta.requestId]); }

  async create(meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const type = enumValue(input.inspection_type, "inspection_type", TYPES); assertSourceShape(type, input); const inspected = quantity(input.inspected_qty, "inspected_qty"); const passed = quantity(input.passed_qty, "passed_qty", false); const failed = quantity(input.failed_qty, "failed_qty", false);
    const results = resultLines(input.results ?? [{ characteristic: "综合判定", result: zeroQuantity(failed) ? "PASS" : "FAIL" }]); const defectInputs = defects(input.defects, { ...input, failed_qty: failed }); const date = optionalDate(input.inspection_date); const stage = text(input.responsible_stage, "responsible_stage", 200); const remark = text(input.remark, "remark", 1000);
    return this.repository.execute(meta, async (client) => {
      const source = await this.resolveSource(client, type, input); await this.validateCreateQuantities(client, type, source, inspected, passed, failed, results, defectInputs); const code = await this.repository.nextCode(client, "QUALITY_INSPECTION", "QI");
      const created = await client.query(`insert into quality_inspections(inspection_code,inspection_type,purchase_receipt_line_id,production_report_id,production_completion_line_id,sales_order_line_id,fqc_allocation_id,material_id,unit_id,inspected_qty,passed_qty,failed_qty,inspection_date,responsible_stage,remark,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,now()),$14,$15,$16,$17,$18) returning *`, [code, type, source.purchaseReceiptLineId, source.productionReportId, source.productionCompletionLineId, source.salesOrderLineId, source.fqcAllocationId, source.material_id, source.unit_id, inspected, passed, failed, date, stage, remark, meta.operationId, meta.actor.username, meta.requestId]);
      const inspectionId = Number(created.rows[0].id); const resultIds: number[] = [];
      for (let index = 0; index < results.length; index += 1) { const row = results[index]; const saved = await client.query("insert into quality_inspection_results(inspection_id,line_no,characteristic,result,measured_value,specification,remark) values($1,$2,$3,$4,$5,$6,$7) returning id", [inspectionId, index + 1, row.characteristic, row.result, row.measuredValue, row.specification, row.remark]); resultIds.push(Number(saved.rows[0].id)); }
      for (const defect of defectInputs) await this.insertDefect(client, inspectionId, defect, defect.resultLineNo === null ? null : resultIds[defect.resultLineNo - 1], meta);
      await client.query("insert into quality_inspection_events(inspection_id,event_type,to_lifecycle_status,to_decision_status,created_by,request_id) values($1,'CREATED','OPEN','PENDING',$2,$3)", [inspectionId, meta.actor.username, meta.requestId]); await this.fault?.("after_quality_create");
      return { status: 201, body: { ok: true, data: created.rows[0], inspection_id: inspectionId, inspection_code: code, inspection_status: "OPEN/PENDING", boundary: QUALITY_BOUNDARY, request_id: meta.requestId }, objectId: inspectionId };
    });
  }

  async addDefect(inspectionId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version); const defect = defects([input], input)[0]; const resultLineId = input.result_line_id === null || input.result_line_id === undefined ? null : id(input.result_line_id, "result_line_id");
    return this.repository.execute(meta, async (client) => { const row = await this.lockInspection(client, inspectionId); if (Number(row.version) !== expected || row.lifecycle_status !== "OPEN") throw new QualityError("QUALITY_VERSION_OR_STATE_CONFLICT", "检验版本已变化或不是开放状态", 409); if (resultLineId && !(await client.query("select 1 from quality_inspection_results where id=$1 and inspection_id=$2 and result='FAIL'", [resultLineId, inspectionId])).rows[0]) throw new QualityError("QUALITY_RESULT_LINE_INVALID", "缺陷引用的 FAIL 结果明细不属于该检验", 422);
      const cumulative = await client.query("select coalesce(sum(quantity),0)+$2::numeric<=$3::numeric ok from quality_defects where inspection_id=$1", [inspectionId, defect.quantity, row.failed_qty]); if (!cumulative.rows[0].ok) throw new QualityError("QUALITY_DEFECT_QUANTITY_EXCEEDED", "缺陷累计数量超过不良数量", 409);
      const created = await this.insertDefect(client, inspectionId, defect, resultLineId, meta); const updated = await client.query("update quality_inspections set version=version+1,updated_at=now() where id=$1 and version=$2 returning version", [inspectionId, expected]); if (!updated.rows[0]) throw new QualityError("QUALITY_VERSION_OR_STATE_CONFLICT", "检验版本已变化", 409);
      await client.query("insert into quality_inspection_events(inspection_id,event_type,from_lifecycle_status,to_lifecycle_status,from_decision_status,to_decision_status,reason,created_by,request_id) values($1,'DEFECT_ADDED','OPEN','OPEN',$2,$2,$3,$4,$5)", [inspectionId, row.decision_status, created.rows[0].defect_code, meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: created.rows[0], defect_id: Number(created.rows[0].id), inspection_version: Number(updated.rows[0].version), request_id: meta.requestId }, objectId: Number(created.rows[0].id) };
    });
  }

  async disposition(inspectionId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version); const dispositionCode = enumValue(input.disposition_code ?? input.disposition, "disposition_code", DISPOSITIONS); const release = ["RELEASE", "CONCESSION"].includes(dispositionCode) ? quantity(input.release_qty, "release_qty") : "0"; const reason = text(input.reason, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => { const row = await this.lockInspection(client, inspectionId); if (Number(row.version) !== expected || row.lifecycle_status !== "OPEN") throw new QualityError("QUALITY_VERSION_OR_STATE_CONFLICT", "检验版本已变化或不是开放状态", 409); if (row.created_by === meta.actor.username) throw new QualityError("QUALITY_DUTY_SEPARATION_REQUIRED", "检验创建人不能执行处置", 409); if (!zeroQuantity(row.failed_qty) && !(await client.query("select 1 from quality_defects where inspection_id=$1", [inspectionId])).rows[0]) throw new QualityError("QUALITY_DEFECT_REQUIRED", "存在不良数量时必须先登记缺陷", 409);
      const maximum = dispositionCode === "RELEASE" ? row.passed_qty : row.inspected_qty; const allowed = await client.query("select $1::numeric<=$2::numeric ok", [release, maximum]); if (!allowed.rows[0].ok) throw new QualityError("QUALITY_RELEASE_QUANTITY_EXCEEDED", dispositionCode === "RELEASE" ? "正常放行不能超过合格数量" : "让步放行不能超过检验数量", 409);
      const decision = zeroQuantity(release) ? "HOLD" : "RELEASED"; const updated = await client.query("update quality_inspections set decision_status=$2,released_qty=$3,version=version+1,updated_at=now() where id=$1 and version=$4 returning *", [inspectionId, decision, release, expected]); if (!updated.rows[0]) throw new QualityError("QUALITY_VERSION_OR_STATE_CONFLICT", "检验版本已变化", 409);
      await client.query("insert into quality_inspection_events(inspection_id,event_type,from_lifecycle_status,to_lifecycle_status,from_decision_status,to_decision_status,disposition_code,release_qty,reason,created_by,request_id) values($1,'DISPOSITIONED','OPEN','OPEN',$2,$3,$4,$5,$6,$7,$8)", [inspectionId, row.decision_status, decision, dispositionCode, release, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_quality_disposition"); return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: inspectionId };
    });
  }

  async close(inspectionId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version); const reason = text(input.reason, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => { const locked = await this.lockFqcInspection(client, inspectionId); const row = locked.row; if (Number(row.version) !== expected || row.lifecycle_status !== "OPEN" || row.decision_status === "PENDING") throw new QualityError("QUALITY_CLOSE_STATE_CONFLICT", "只有已处置且版本匹配的开放检验可以关闭", 409);
      if (row.inspection_type === "FQC" && row.decision_status === "RELEASED") { if(row.fqc_allocation_id){const totals=await client.query(`select a.quantity,coalesce(sum(qi.released_qty),0)::numeric released from finished_goods_sales_allocations a left join quality_inspections qi on qi.fqc_allocation_id=a.id and qi.lifecycle_status='CLOSED' and qi.decision_status='RELEASED' where a.id=$1 and a.status='ACTIVE' group by a.id`,[row.fqc_allocation_id]);if(!totals.rows[0]||!(await client.query("select $1::numeric+$2::numeric<=$3::numeric ok",[totals.rows[0].released,row.released_qty,totals.rows[0].quantity])).rows[0].ok)throw new QualityError("QUALITY_RELEASE_CAPACITY_EXCEEDED","累计 FQC 放行超过稳定分配数量",409);}else{const totals = await client.query(`select coalesce(sum(released_qty) filter(where production_completion_line_id=$1),0)::numeric completion_released,coalesce(sum(released_qty) filter(where sales_order_line_id=$2),0)::numeric order_released from quality_inspections where inspection_type='FQC' and lifecycle_status='CLOSED' and decision_status='RELEASED' and (production_completion_line_id=$1 or sales_order_line_id=$2)`, [row.production_completion_line_id, row.sales_order_line_id]); const allowed = await client.query("select $1::numeric+$2::numeric<=$3::numeric and $4::numeric+$2::numeric<=$5::numeric ok", [totals.rows[0].completion_released, row.released_qty, locked.sources!.completion.quantity, totals.rows[0].order_released, locked.sources!.order.ordered_qty]); if (!allowed.rows[0].ok) throw new QualityError("QUALITY_RELEASE_CAPACITY_EXCEEDED", "累计 FQC 放行超过完工或销售明细数量", 409);} }
      const updated = await client.query("update quality_inspections set lifecycle_status='CLOSED',version=version+1,updated_at=now() where id=$1 and version=$2 returning *", [inspectionId, expected]); if (!updated.rows[0]) throw new QualityError("QUALITY_CLOSE_STATE_CONFLICT", "检验已被并发更新", 409); await client.query("insert into quality_inspection_events(inspection_id,event_type,from_lifecycle_status,to_lifecycle_status,from_decision_status,to_decision_status,release_qty,reason,created_by,request_id) values($1,'CLOSED','OPEN','CLOSED',$2,$2,$3,$4,$5,$6)", [inspectionId, row.decision_status, row.released_qty, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_quality_close"); return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: inspectionId };
    });
  }

  async reopen(inspectionId: number, meta: QualityMeta, input: Record<string, unknown>): Promise<QualityResult> {
    const expected = version(input.expected_version); const reason = text(input.reason, "reason", 1000, true);
    return this.repository.execute(meta, async (client) => { const locked = await this.lockFqcInspection(client, inspectionId); const row = locked.row; if (Number(row.version) !== expected || row.lifecycle_status !== "CLOSED") throw new QualityError("QUALITY_REOPEN_STATE_CONFLICT", "只有已关闭且版本匹配的检验可以重开", 409);
      if (row.inspection_type === "FQC" && row.decision_status === "RELEASED") { const consumption = await client.query(`with released as (select coalesce(sum(released_qty),0)::numeric qty from quality_inspections where sales_order_line_id=$1 and lifecycle_status='CLOSED' and decision_status='RELEASED' and id<>$2), consumed as (select coalesce(sum(case when sh.shipment_type='SHIPMENT' then sl.quantity else -sl.quantity end),0)::numeric qty from sales_shipment_lines sl join sales_shipments sh on sh.id=sl.shipment_id where sl.sales_order_line_id=$1) select released.qty>=consumed.qty ok from released,consumed`, [row.sales_order_line_id, inspectionId]); if (!consumption.rows[0].ok) throw new QualityError("QUALITY_RELEASE_ALREADY_CONSUMED", "该 FQC 放行额度已被有效发货消费，不能重开", 409); }
      const updated = await client.query("update quality_inspections set lifecycle_status='OPEN',decision_status='PENDING',released_qty=0,version=version+1,updated_at=now() where id=$1 and version=$2 returning *", [inspectionId, expected]); if (!updated.rows[0]) throw new QualityError("QUALITY_REOPEN_STATE_CONFLICT", "检验已被并发更新", 409); await client.query("insert into quality_inspection_events(inspection_id,event_type,from_lifecycle_status,to_lifecycle_status,from_decision_status,to_decision_status,release_qty,reason,created_by,request_id) values($1,'REOPENED','CLOSED','OPEN',$2,'PENDING',0,$3,$4,$5)", [inspectionId, row.decision_status, reason, meta.actor.username, meta.requestId]); await this.fault?.("after_quality_reopen"); return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: inspectionId };
    });
  }
}
