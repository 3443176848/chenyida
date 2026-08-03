import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { calculateMaterialRequirements } from "./calculation.ts";
import { MaterialRequirementError } from "./errors.ts";
import { MaterialRequirementRepository } from "./repository.ts";
import type { RequirementMutationMeta, RequirementMutationResult } from "./types.ts";
import { assertOnlyKeys, boundedText, expectedVersion, requiredDate } from "./validation.ts";

type PackageRow = Record<string, unknown> & { id: string; project_id: string; status: string; version: number; package_digest: string; target_delivery_date: unknown; latest_package_id: string };
type PlanRow = Record<string, unknown> & { id: string; project_id: string; planning_package_id: string; status: string; version: number; required_date: unknown; source_package_version: number; source_package_digest: string; calculation_digest: string };
const allowed = (actor: IdentityActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);

type PurchaseRequestScopeRow = Readonly<{ status: string; submitted_by: string; accepted_by: string | null; returned_by: string | null }>;
export type PurchaseRequestReadScope = "ALL" | "PURCHASE_QUEUE" | "PLANNING_OWN" | "NONE";

export function purchaseRequestReadScope(actor: Pick<IdentityActor, "role" | "permissions">): PurchaseRequestReadScope {
  if (actor.permissions.includes("*") || ["admin", "manager"].includes(actor.role)) return "ALL";
  if (actor.role === "purchase") return "PURCHASE_QUEUE";
  if (actor.role === "planning") return "PLANNING_OWN";
  return "NONE";
}

export function canReadPurchaseRequest(actor: Pick<IdentityActor, "username" | "role" | "permissions">, row: PurchaseRequestScopeRow) {
  const scope = purchaseRequestReadScope(actor);
  if (scope === "ALL") return true;
  if (scope === "PLANNING_OWN") return row.submitted_by === actor.username;
  if (scope === "PURCHASE_QUEUE") return row.status === "SUBMITTED" || row.accepted_by === actor.username || row.returned_by === actor.username;
  return false;
}

export class MaterialRequirementService {
  readonly repository: MaterialRequirementRepository; readonly fault?: (checkpoint: string) => void | Promise<void>;
  constructor(repository: MaterialRequirementRepository, fault?: (checkpoint: string) => void | Promise<void>) { this.repository = repository; this.fault = fault; }

  private async latestAcceptedPackage(client: PoolClient, packageId: number, lock = false): Promise<PackageRow> {
    const result = await client.query<PackageRow>(`select pp.*,p.project_code,p.project_name,p.project_owner,(select x.id from project_planning_packages x where x.project_id=pp.project_id order by x.package_version_no desc limit 1) latest_package_id
      from project_planning_packages pp join business_projects p on p.id=pp.project_id where pp.id=$1 ${lock ? "for update of pp,p" : ""}`, [packageId]);
    const row = result.rows[0]; if (!row) throw new MaterialRequirementError("PLANNING_PACKAGE_NOT_FOUND", "计划交接包不存在", 404);
    if (row.status !== "ACCEPTED" || Number(row.latest_package_id) !== packageId) throw new MaterialRequirementError("PLANNING_PACKAGE_NOT_LATEST_ACCEPTED", "只能使用项目最新且已接收的计划交接包", 409);
    return row;
  }

  async generate(packageId: number, meta: RequirementMutationMeta, input: Record<string, unknown>): Promise<RequirementMutationResult> {
    assertOnlyKeys(input, ["required_date"]);
    return this.repository.execute(meta, async (client) => {
      const source = await this.latestAcceptedPackage(client, packageId, true); const demandDate = requiredDate(input.required_date, source.target_delivery_date);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-requirement-project:${source.project_id}`]);
      const previous = await client.query<PlanRow>("select * from planning_material_requirement_plans where project_id=$1 order by plan_version_no desc limit 1 for update", [Number(source.project_id)]); const prior = previous.rows[0];
      if (prior && ["SUBMITTED", "ACCEPTED"].includes(prior.status)) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_STATE_CONFLICT", "当前项目已有已提交或已接收的物料需求计划", 409);
      if (prior?.status === "DRAFT") {
        await client.query("update planning_material_requirement_plans set status='STALE',version=version+1,request_id=$2,updated_at=now() where id=$1 and status='DRAFT'", [Number(prior.id), meta.requestId]);
        await client.query("insert into planning_material_requirement_events(plan_id,event_type,from_status,to_status,actor,request_id) values($1,'REGENERATED','DRAFT','STALE',$2,$3)", [Number(prior.id), meta.actor.username, meta.requestId]);
      }
      const calculation = await calculateMaterialRequirements(client, packageId, demandDate, false); const planVersionNo = Number(prior?.plan_version_no || 0) + 1;
      const saved = await client.query(`insert into planning_material_requirement_plans(project_id,planning_package_id,plan_version_no,required_date,status,source_package_version,source_package_digest,calculation_digest,prepared_by,request_id)
        values($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9) returning *`, [Number(source.project_id), packageId, planVersionNo, demandDate, Number(source.version), source.package_digest, calculation.digest, meta.actor.username, meta.requestId]);
      const planId = Number(saved.rows[0].id);
      for (const line of calculation.lines) await client.query(`insert into planning_material_requirement_lines(plan_id,line_no,material_id,unit_id,material_snapshot,material_digest,gross_requirement,stock_available,eligible_inbound,stock_allocated,inbound_allocated,net_purchase_requirement,source_digest)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [planId, line.lineNo, line.materialId, line.unitId, line.materialSnapshot, line.materialDigest, line.grossRequirement, line.stockAvailable, line.eligibleInbound, line.stockAllocated, line.inboundAllocated, line.netPurchaseRequirement, line.sourceDigest]);
      await client.query("insert into planning_material_requirement_events(plan_id,event_type,from_status,to_status,actor,request_id) values($1,$2,null,'DRAFT',$3,$4)", [planId, prior ? "REGENERATED" : "GENERATED", meta.actor.username, meta.requestId]); await this.fault?.("after_preview_saved");
      return { status: 201, body: { ok: true, plan_id: planId, planning_package_id: packageId, data: saved.rows[0], lines: calculation.lines.map(({ stockSource: _stock, inboundSources: _inbound, ...line }) => line), request_id: meta.requestId }, objectId: planId, newVersion: 1 };
    });
  }

  private async planForUpdate(client: PoolClient, planId: number): Promise<PlanRow> {
    const result = await client.query<PlanRow>("select * from planning_material_requirement_plans where id=$1 for update", [planId]); if (!result.rows[0]) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_NOT_FOUND", "物料需求计划不存在", 404); return result.rows[0];
  }

  async submit(planId: number, meta: RequirementMutationMeta, input: Record<string, unknown>): Promise<RequirementMutationResult> {
    assertOnlyKeys(input, ["expected_version"]); const expected = expectedVersion(input.expected_version);
    return this.repository.execute(meta, async (client) => {
      const plan = await this.planForUpdate(client, planId); if (plan.status !== "DRAFT" || Number(plan.version) !== expected) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_VERSION_CONFLICT", "物料需求计划状态或版本已变化", 409);
      const source = await this.latestAcceptedPackage(client, Number(plan.planning_package_id), true);
      if (Number(source.version) !== Number(plan.source_package_version) || source.package_digest !== plan.source_package_digest) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_RECALC_REQUIRED", "计划交接包来源已变化，请重新生成物料需求计划", 409);
      const demandDate = plan.required_date instanceof Date ? plan.required_date.toISOString().slice(0, 10) : String(plan.required_date).slice(0, 10); const calculation = await calculateMaterialRequirements(client, Number(plan.planning_package_id), demandDate, true);
      if (calculation.digest !== plan.calculation_digest) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_RECALC_REQUIRED", "库存、有效分配或需求日前在途已变化，请重新生成物料需求计划", 409);
      const stored = await client.query("select id,line_no,material_id,unit_id,source_digest from planning_material_requirement_lines where plan_id=$1 order by line_no", [planId]);
      if (stored.rowCount !== calculation.lines.length || stored.rows.some((row, index) => Number(row.material_id) !== calculation.lines[index].materialId || Number(row.unit_id) !== calculation.lines[index].unitId || row.source_digest !== calculation.lines[index].sourceDigest)) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_RECALC_REQUIRED", "物料需求预览与当前来源不一致，请重新生成", 409);
      const updated = await client.query("update planning_material_requirement_plans set status='SUBMITTED',submitted_by=$2,submitted_at=now(),version=version+1,request_id=$3,updated_at=now() where id=$1 and status='DRAFT' and version=$4 returning *", [planId, meta.actor.username, meta.requestId, expected]); if (!updated.rows[0]) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_VERSION_CONFLICT", "物料需求计划状态或版本已变化", 409);
      for (const [index, line] of calculation.lines.entries()) {
        const planLineId = Number(stored.rows[index].id);
        if (line.stockSource) await client.query(`insert into planning_material_allocations(plan_id,plan_line_id,allocation_type,inventory_balance_id,quantity,source_version,source_quantity,source_digest) values($1,$2,'STOCK',$3,$4,$5,$6,$7)`, [planId, planLineId, line.stockSource.inventoryBalanceId, line.stockAllocated, line.stockSource.sourceVersion, line.stockSource.sourceQuantity, line.stockSource.sourceDigest]);
        for (const inbound of line.inboundSources) await client.query(`insert into planning_material_allocations(plan_id,plan_line_id,allocation_type,purchase_order_line_id,quantity,source_version,source_quantity,source_digest) values($1,$2,'INBOUND',$3,$4,$5,$6,$7)`, [planId, planLineId, inbound.purchaseOrderLineId, inbound.quantity, inbound.sourceVersion, inbound.sourceQuantity, inbound.sourceDigest]);
      }
      const positiveLines = await client.query("select * from planning_material_requirement_lines where plan_id=$1 and net_purchase_requirement>0 order by line_no", [planId]); let purchaseRequest: Record<string, unknown> | null = null;
      if (positiveLines.rows.length) {
        const sequence = await client.query("insert into business_code_sequences(sequence_code,current_value,version,updated_at) values('PLANNING_PURCHASE_REQUEST',1,1,now()) on conflict(sequence_code) do update set current_value=business_code_sequences.current_value+1,version=business_code_sequences.version+1,updated_at=now() returning current_value"); const value = Number(sequence.rows[0].current_value); if (!Number.isSafeInteger(value) || value > 99_999_999) throw new MaterialRequirementError("PURCHASE_REQUEST_SEQUENCE_EXHAUSTED", "采购申请编号序列已用尽", 500); const requestCode = `PRQ-${String(value).padStart(8, "0")}`;
        const request = await client.query("insert into planning_purchase_requests(request_code,plan_id,status,submitted_by,request_id) values($1,$2,'SUBMITTED',$3,$4) returning *", [requestCode, planId, meta.actor.username, meta.requestId]); purchaseRequest = request.rows[0];
        await client.query(`insert into planning_purchase_request_lines(purchase_request_id,plan_line_id,line_no,material_id,unit_id,requested_quantity)
          select $1,id,row_number() over(order by line_no),material_id,unit_id,net_purchase_requirement from planning_material_requirement_lines where plan_id=$2 and net_purchase_requirement>0 order by line_no`, [Number(request.rows[0].id), planId]);
      }
      await client.query("insert into planning_material_requirement_events(plan_id,purchase_request_id,event_type,from_status,to_status,actor,request_id) values($1,$2,'SUBMITTED','DRAFT','SUBMITTED',$3,$4)", [planId, purchaseRequest ? Number(purchaseRequest.id) : null, meta.actor.username, meta.requestId]); await this.fault?.("after_submission_created");
      return { status: 200, body: { ok: true, plan_id: planId, data: updated.rows[0], purchase_request: purchaseRequest, purchase_required: Boolean(purchaseRequest), request_id: meta.requestId }, objectId: planId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  private async decide(requestId: number, meta: RequirementMutationMeta, input: Record<string, unknown>, decision: "ACCEPTED" | "RETURNED"): Promise<RequirementMutationResult> {
    assertOnlyKeys(input, decision === "RETURNED" ? ["expected_version", "reason"] : ["expected_version"]); const expected = expectedVersion(input.expected_version); const reason = decision === "RETURNED" ? boundedText(input.reason, "退回原因", 1000, true) : "";
    return this.repository.execute(meta, async (client) => {
      const found = await client.query(`select r.*,p.status plan_status,p.version plan_version from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id where r.id=$1 for update of r,p`, [requestId]); const row = found.rows[0]; if (!row) throw new MaterialRequirementError("PURCHASE_REQUEST_NOT_FOUND", "采购申请不存在", 404);
      if (row.status !== "SUBMITTED" || row.plan_status !== "SUBMITTED" || Number(row.version) !== expected) throw new MaterialRequirementError("PURCHASE_REQUEST_VERSION_CONFLICT", "采购申请已被处理或版本已变化", 409);
      const request = decision === "ACCEPTED"
        ? await client.query("update planning_purchase_requests set status='ACCEPTED',accepted_by=$2,accepted_at=now(),returned_by=null,returned_at=null,return_reason='',version=version+1,request_id=$3,updated_at=now() where id=$1 and status='SUBMITTED' and version=$4 returning *", [requestId, meta.actor.username, meta.requestId, expected])
        : await client.query("update planning_purchase_requests set status='RETURNED',returned_by=$2,returned_at=now(),accepted_by=null,accepted_at=null,return_reason=$3,version=version+1,request_id=$4,updated_at=now() where id=$1 and status='SUBMITTED' and version=$5 returning *", [requestId, meta.actor.username, reason, meta.requestId, expected]);
      if (!request.rows[0]) throw new MaterialRequirementError("PURCHASE_REQUEST_VERSION_CONFLICT", "采购申请已被处理或版本已变化", 409);
      const plan = decision === "ACCEPTED"
        ? await client.query("update planning_material_requirement_plans set status='ACCEPTED',accepted_by=$2,accepted_at=now(),returned_by=null,returned_at=null,return_reason='',version=version+1,request_id=$3,updated_at=now() where id=$1 and status='SUBMITTED' returning *", [Number(row.plan_id), meta.actor.username, meta.requestId])
        : await client.query("update planning_material_requirement_plans set status='RETURNED',returned_by=$2,returned_at=now(),accepted_by=null,accepted_at=null,return_reason=$3,version=version+1,request_id=$4,updated_at=now() where id=$1 and status='SUBMITTED' returning *", [Number(row.plan_id), meta.actor.username, reason, meta.requestId]);
      if (!plan.rows[0]) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_VERSION_CONFLICT", "物料需求计划状态已变化", 409);
      await client.query("insert into planning_material_requirement_events(plan_id,purchase_request_id,event_type,from_status,to_status,actor,reason,request_id) values($1,$2,$3,'SUBMITTED',$4,$5,$6,$7)", [Number(row.plan_id), requestId, decision === "ACCEPTED" ? "PURCHASE_ACCEPTED" : "PURCHASE_RETURNED", decision, meta.actor.username, reason, meta.requestId]); await this.fault?.("after_purchase_decision");
      return { status: 200, body: { ok: true, plan_id: Number(row.plan_id), purchase_request_id: requestId, data: request.rows[0], plan: plan.rows[0], allocations_released: decision === "RETURNED", request_id: meta.requestId }, objectId: requestId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  accept(requestId: number, meta: RequirementMutationMeta, input: Record<string, unknown>) { return this.decide(requestId, meta, input, "ACCEPTED"); }
  returnToPlanning(requestId: number, meta: RequirementMutationMeta, input: Record<string, unknown>) { return this.decide(requestId, meta, input, "RETURNED"); }

  async planDetail(actor: IdentityActor, planId: number) {
    if (!allowed(actor, "planning.requirement.read")) throw new MaterialRequirementError("PERMISSION_DENIED", "没有权限读取物料需求计划", 403);
    const header = await this.repository.pool.query(`select p.*,bp.project_code,bp.project_name,pp.package_version_no,pp.package_digest,r.id purchase_request_id,r.request_code,r.status purchase_request_status,r.version purchase_request_version
      from planning_material_requirement_plans p join business_projects bp on bp.id=p.project_id join project_planning_packages pp on pp.id=p.planning_package_id left join planning_purchase_requests r on r.plan_id=p.id where p.id=$1`, [planId]); if (!header.rows[0]) throw new MaterialRequirementError("MATERIAL_REQUIREMENT_NOT_FOUND", "物料需求计划不存在", 404);
    const [lines, allocations, requestLines, events] = await Promise.all([
      this.repository.pool.query("select l.*,l.gross_requirement::text,l.stock_available::text,l.eligible_inbound::text,l.stock_allocated::text,l.inbound_allocated::text,l.net_purchase_requirement::text,u.code unit_code from planning_material_requirement_lines l join units u on u.id=l.unit_id where l.plan_id=$1 order by l.line_no", [planId]),
      this.repository.pool.query("select a.*,a.quantity::text,a.source_quantity::text,po.po_code,pol.line_no purchase_order_line_no from planning_material_allocations a left join purchase_order_lines pol on pol.id=a.purchase_order_line_id left join purchase_orders po on po.id=pol.purchase_order_id where a.plan_id=$1 order by a.plan_line_id,a.allocation_type,a.id", [planId]),
      this.repository.pool.query("select rl.*,rl.requested_quantity::text from planning_purchase_request_lines rl join planning_purchase_requests r on r.id=rl.purchase_request_id where r.plan_id=$1 order by rl.line_no", [planId]),
      this.repository.pool.query("select * from planning_material_requirement_events where plan_id=$1 order by id", [planId]),
    ]);
    return { header: header.rows[0], lines: lines.rows, allocations: allocations.rows, purchase_request_lines: requestLines.rows, events: events.rows };
  }

  async packagePlans(actor: IdentityActor, packageId: number) {
    if (!allowed(actor, "planning.requirement.read")) throw new MaterialRequirementError("PERMISSION_DENIED", "没有权限读取物料需求计划", 403); const source = await this.repository.pool.query("select 1 from project_planning_packages where id=$1", [packageId]); if (!source.rows[0]) throw new MaterialRequirementError("PLANNING_PACKAGE_NOT_FOUND", "计划交接包不存在", 404);
    const result = await this.repository.pool.query(`select p.*,r.id purchase_request_id,r.request_code,r.status purchase_request_status,r.version purchase_request_version from planning_material_requirement_plans p left join planning_purchase_requests r on r.plan_id=p.id where p.planning_package_id=$1 order by p.plan_version_no desc`, [packageId]); return result.rows;
  }

  async requestDetail(actor: IdentityActor, requestId: number) {
    if (!allowed(actor, "planning.purchase_request.read")) throw new MaterialRequirementError("PERMISSION_DENIED", "没有权限读取采购申请", 403);
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin transaction isolation level repeatable read read only");
      const headerResult = await client.query(`select r.*,p.project_id,p.planning_package_id,p.plan_version_no,p.required_date,p.status plan_status,
        p.source_package_version,p.source_package_digest,p.calculation_digest,p.prepared_by,p.prepared_at,
        p.submitted_by plan_submitted_by,p.submitted_at plan_submitted_at,p.version plan_row_version,
        bp.project_code,bp.project_name,pp.package_version_no,pp.status package_status,pp.package_digest,
        pp.accepted_by package_accepted_by,pp.accepted_at package_accepted_at,
        (select count(*)::int from planning_purchase_request_lines rl where rl.purchase_request_id=r.id) line_count,
        (select coalesce(sum(rl.requested_quantity),0)::numeric(24,6)::text from planning_purchase_request_lines rl where rl.purchase_request_id=r.id) requested_quantity
        from planning_purchase_requests r
        join planning_material_requirement_plans p on p.id=r.plan_id
        join business_projects bp on bp.id=p.project_id
        join project_planning_packages pp on pp.id=p.planning_package_id
        where r.id=$1`, [requestId]);
      const header = headerResult.rows[0];
      if (!header) throw new MaterialRequirementError("PURCHASE_REQUEST_NOT_FOUND", "采购申请不存在", 404);
      if (!canReadPurchaseRequest(actor, header as PurchaseRequestScopeRow)) throw new MaterialRequirementError("PURCHASE_REQUEST_FORBIDDEN", "没有权限查看该采购申请及其来源快照", 403);

      const lineResult = await client.query(`select rl.id,rl.purchase_request_id,rl.plan_line_id,rl.line_no,rl.material_id,rl.unit_id,
        rl.requested_quantity::text,pl.line_no plan_line_no,pl.material_id plan_material_id,pl.unit_id plan_unit_id,
        pl.material_snapshot,pl.material_digest,
        pl.gross_requirement::text,pl.stock_available::text,pl.stock_allocated::text,
        pl.eligible_inbound::text,pl.inbound_allocated::text,pl.net_purchase_requirement::text,
        pl.source_digest,u.code unit_code,u.name unit_name
        from planning_purchase_request_lines rl
        join planning_material_requirement_lines pl on pl.id=rl.plan_line_id and pl.plan_id=$2
        join units u on u.id=rl.unit_id
        where rl.purchase_request_id=$1 order by rl.line_no`, [requestId, Number(header.plan_id)]);
      if (lineResult.rows.some((line) => Number(line.material_id) !== Number(line.plan_material_id) || Number(line.unit_id) !== Number(line.plan_unit_id))) {
        throw new MaterialRequirementError("PURCHASE_REQUEST_TRACEABILITY_CONFLICT", "采购申请物料快照与稳定物料标识不一致", 409);
      }

      const packageItemResult = await client.query(`select pi.id,pi.line_no,pi.requirement_item_id,pi.product_version_id,pi.bom_version_id,
        pi.required_quantity::text,pi.unit_id,pi.unit_resolution_id,pi.source_digest,
        p.id product_id,p.product_code,p.product_name,pv.version_no product_version_no,pv.version_code product_version_code,
        bh.id bom_header_id,bh.bom_code,bv.version_no bom_version_no,bv.version_code bom_version_code,
        ur.resolution_version_no unit_resolution_version_no,ur.source_type unit_resolution_source_type,u.code unit_code
        from project_planning_package_items pi
        join product_versions pv on pv.id=pi.product_version_id
        join products p on p.id=pv.product_id
        join bom_versions bv on bv.id=pi.bom_version_id and bv.product_version_id=pi.product_version_id
        join bom_headers bh on bh.id=bv.bom_header_id and bh.product_id=p.id
        join units u on u.id=pi.unit_id
        left join project_requirement_unit_resolution_versions ur on ur.id=pi.unit_resolution_id
          and ur.requirement_item_id=pi.requirement_item_id and ur.unit_id=pi.unit_id
        where pi.package_id=$1 order by pi.line_no`, [Number(header.planning_package_id)]);
      const packageAcceptResult = await client.query(`select id,event_type,actor,request_id,created_at
        from project_planning_handoff_events where package_id=$1 and event_type='ACCEPTED' order by id desc limit 1`, [Number(header.planning_package_id)]);
      const generatedEventResult = await client.query(`select id,event_type,actor,request_id,created_at,to_status
        from planning_material_requirement_events where plan_id=$1 and event_type in ('GENERATED','REGENERATED') order by id desc limit 1`, [Number(header.plan_id)]);
      const submitEventResult = await client.query(`select id,event_type,actor,request_id,created_at,to_status
        from planning_material_requirement_events where plan_id=$1 and purchase_request_id=$2 and event_type='SUBMITTED' order by id desc limit 1`, [Number(header.plan_id), requestId]);
      const checkedAtResult = await client.query("select now() checked_at");
      const requiredDateValue = header.required_date instanceof Date ? header.required_date.toISOString().slice(0, 10) : String(header.required_date).slice(0, 10);
      const current = await calculateMaterialRequirements(client, Number(header.planning_package_id), requiredDateValue, false);
      const currentByMaterial = new Map(current.lines.map((line) => [`${line.materialId}:${line.unitId}`, line]));
      const packageAccept = packageAcceptResult.rows[0];
      const generatedEvent = generatedEventResult.rows[0];
      const submitEvent = submitEventResult.rows[0];
      const traceEvent = (row: Record<string, unknown> | undefined, action: string) => row ? {
        id: Number(row.id), action, actor: row.actor, occurred_at: row.created_at, request_id: row.request_id,
        result: "SUCCESS", evidence_source: action === "ACCEPT" ? "PACKAGE_EVENT" : "MATERIAL_REQUIREMENT_EVENT",
      } : null;
      const lines = lineResult.rows.map((line) => {
        const currentLine = currentByMaterial.get(`${Number(line.material_id)}:${Number(line.unit_id)}`);
        return {
          ...line,
          current_supply: currentLine ? { stock_available: currentLine.stockAvailable, eligible_inbound: currentLine.eligibleInbound } : null,
        };
      });
      const response = {
        header,
        package: {
          id: Number(header.planning_package_id), version_no: Number(header.package_version_no), status: header.package_status,
          digest: header.package_digest, project_code: header.project_code, accept_event: traceEvent(packageAccept, "ACCEPT"),
          items: packageItemResult.rows,
          acceptance_effect: "PACKAGE_ACCEPT_DOES_NOT_CREATE_PURCHASE_DOCUMENTS",
        },
        plan: {
          id: Number(header.plan_id), version_no: Number(header.plan_version_no), status: header.plan_status,
          source_package_id: Number(header.planning_package_id), source_package_version_no: Number(header.package_version_no),
          prepared_by: header.prepared_by, calculated_at: header.prepared_at,
          snapshot_cutoff_at: header.plan_submitted_at, submission_revalidated_at: header.plan_submitted_at,
          generated_event: traceEvent(generatedEvent, generatedEvent?.event_type === "REGENERATED" ? "REGENERATE" : "GENERATE"),
          note: null, note_captured: false,
        },
        purchase_request: {
          id: Number(header.id), request_code: header.request_code, status: header.status,
          source_plan_id: Number(header.plan_id), source_plan_version_no: Number(header.plan_version_no),
          project_code: header.project_code, required_date: header.required_date,
          submitted_by: header.submitted_by, submitted_at: header.submitted_at,
          submit_event: traceEvent(submitEvent, "SUBMIT"), line_count: Number(header.line_count),
          total_requested_quantity: header.requested_quantity, independently_versioned: false,
          supplier_selection: null, price: null, assignee: null, handling_deadline: null,
          handoff_note: null, handoff_note_captured: false,
        },
        lines,
        quantity_formula: "net_purchase_requirement = max(gross_requirement - stock_allocated - inbound_allocated, 0)",
        current_supply_checked_at: checkedAtResult.rows[0].checked_at,
      };
      await client.query("commit");
      return response;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async requestQueue(actor: IdentityActor, page: number, pageSize: number, status?: string) {
    if (!allowed(actor, "planning.purchase_request.read")) throw new MaterialRequirementError("PERMISSION_DENIED", "没有权限读取采购申请", 403);
    const wanted = status || "SUBMITTED";
    if (!["SUBMITTED", "ACCEPTED", "RETURNED", "PROCESSED"].includes(wanted)) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", "status 无效");
    const scope = purchaseRequestReadScope(actor);
    if (scope === "NONE") throw new MaterialRequirementError("PERMISSION_DENIED", "没有权限读取采购申请", 403);
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (wanted === "PROCESSED") clauses.push("r.status in ('ACCEPTED','RETURNED')");
    else { values.push(wanted); clauses.push(`r.status=$${values.length}`); }
    if (scope === "PLANNING_OWN") { values.push(actor.username); clauses.push(`r.submitted_by=$${values.length}`); }
    if (scope === "PURCHASE_QUEUE" && wanted !== "SUBMITTED") { values.push(actor.username); clauses.push(`(r.accepted_by=$${values.length} or r.returned_by=$${values.length})`); }
    values.push(pageSize, (page - 1) * pageSize);
    const limitPosition = values.length - 1; const offsetPosition = values.length;
    const where = clauses.join(" and ");
    const rows = await this.repository.pool.query(`select r.*,p.project_id,p.plan_version_no,p.required_date,bp.project_code,bp.project_name,
      count(l.id)::int line_count,coalesce(sum(l.requested_quantity),0)::numeric(24,6)::text requested_quantity
      from planning_purchase_requests r join planning_material_requirement_plans p on p.id=r.plan_id
      join business_projects bp on bp.id=p.project_id left join planning_purchase_request_lines l on l.purchase_request_id=r.id
      where ${where} group by r.id,p.id,bp.id order by r.submitted_at,r.id limit $${limitPosition} offset $${offsetPosition}`, values);
    const countValues = values.slice(0, -2);
    const count = await this.repository.pool.query(`select count(*)::int count from planning_purchase_requests r where ${where}`, countValues);
    return { rows: rows.rows, pagination: { page, page_size: pageSize, total: Number(count.rows[0].count) } };
  }
}
