import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ProcurementError } from "../procurement-selfhost/errors.ts";
import { ProcurementRepository } from "../procurement-selfhost/repository.ts";
import { expectedBalanceVersions, id, quantity, text, version } from "../procurement-selfhost/rules.ts";
import { ProcurementService } from "../procurement-selfhost/service.ts";
import type { ProcurementMeta, ProcurementResult, PurchaseOrderLineInput } from "../procurement-selfhost/types.ts";

type AwardLine = {
  award_line_id: string; award_id: string; supplier_id: string; material_id: string; unit_id: string;
  selected_quantity: string; selected_unit_price: string; promised_delivery_date: string; currency_code: string;
  quote_status: string; valid_until: string; quote_material_id: string; quote_unit_id: string; quoted_quantity: string; quote_unit_price: string; quote_promised_delivery_date: string;
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dateOnly = (value: unknown) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const numericId = (value: unknown, field: string) => { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };

export class ProcurementFulfillmentService {
  readonly repository: ProcurementRepository;
  readonly procurement: ProcurementService;
  readonly fault?: (checkpoint: string) => void | Promise<void>;

  constructor(repository: ProcurementRepository, procurement = new ProcurementService(repository), fault?: (checkpoint: string) => void | Promise<void>) {
    this.repository = repository; this.procurement = procurement; this.fault = fault;
  }

  async pendingAwards(limit: number, offset: number) {
    return this.repository.pool.query(`select a.id award_id,a.version award_version,a.selected_at,a.reason_code,a.reason,r.id rfq_id,r.rfq_code,pr.request_code,
      count(al.id)::int line_count,coalesce(sum(al.selected_quantity),0)::text total_quantity,
      count(l.id)::int converted_line_count
      from procurement_sourcing_awards a join procurement_rfqs r on r.id=a.rfq_id join planning_purchase_requests pr on pr.id=r.purchase_request_id
      join procurement_sourcing_award_lines al on al.award_id=a.id left join procurement_award_po_line_links l on l.award_line_id=al.id
      where a.status='AWARDED' and pr.status='ACCEPTED'
      group by a.id,r.id,pr.id having count(l.id)<count(al.id)
      order by a.selected_at,a.id limit $1 offset $2`, [limit, offset]);
  }

  async listOrdersAndPlans(limit: number, offset: number) {
    return this.repository.pool.query(`select po.id purchase_order_id,po.po_code,po.status po_status,po.currency_code,po.version po_version,s.supplier_code,s.supplier_name,
      count(pol.id)::int line_count,count(dp.id)::int plan_count,coalesce(sum(pol.order_qty),0)::text ordered_quantity,
      coalesce(sum(pol.received_qty),0)::text received_quantity
      from purchase_orders po join suppliers s on s.id=po.supplier_id join purchase_order_lines pol on pol.purchase_order_id=po.id
      join procurement_award_po_line_links l on l.purchase_order_line_id=pol.id left join purchase_delivery_plans dp on dp.purchase_order_line_id=pol.id
      group by po.id,s.id order by po.created_at desc,po.id desc limit $1 offset $2`, [limit, offset]);
  }

  async receivingQueue(limit: number, offset: number) {
    return this.repository.pool.query(`select q.id queue_id,q.version queue_version,p.*,po.po_code,po.status po_status,pol.line_no,pol.version purchase_order_line_version,
      (p.planned_quantity-p.received_quantity)::text remaining_quantity,s.supplier_code,s.supplier_name,m.internal_material_code,m.standard_name,u.code unit_code,
      coalesce(b.version,0) balance_version,coalesce(b.on_hand_qty,0)::text on_hand_quantity,
      (p.promised_delivery_date<current_date and p.status in ('PENDING','PARTIAL')) overdue
      from warehouse_receiving_queue_entries q join purchase_delivery_plans p on p.id=q.delivery_plan_id
      join purchase_orders po on po.id=p.purchase_order_id join purchase_order_lines pol on pol.id=p.purchase_order_line_id
      join suppliers s on s.id=p.supplier_id join material_master m on m.id=p.material_id join units u on u.id=p.unit_id
      left join inventory_stock_balances b on b.material_id=p.material_id and b.location_code='MAIN' and b.lot_code=''
      where q.closed_at is null and p.status in ('PENDING','PARTIAL') order by p.promised_delivery_date,p.id limit $1 offset $2`, [limit, offset]);
  }

  async payableHandoff(limit: number, offset: number) {
    return this.repository.pool.query(`select pf.id source_entry_id,pf.source_id,pf.amount::text,pf.currency_code,pf.created_at,pr.id receipt_id,pr.receipt_code,
      po.id purchase_order_id,po.po_code,s.supplier_code,s.supplier_name,fd.id ap_id,fd.doc_code ap_code,fd.status ap_status,
      case when fd.id is null then 'PENDING_AP' else 'AP_CREATED' end handoff_status
      from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id
      join purchase_orders po on po.id=pr.purchase_order_id join suppliers s on s.id=pf.supplier_id
      left join finance_documents fd on fd.purchase_source_entry_id=pf.id and fd.doc_type='AP'
      where pf.entry_type='RECEIPT' order by pf.created_at desc,pf.id desc limit $1 offset $2`, [limit, offset]);
  }

  private async awardLines(client: PoolClient, awardId: number, expectedVersion: number): Promise<AwardLine[]> {
    const awardResult = await client.query(`select a.*,r.purchase_request_id,pr.status purchase_request_status
      from procurement_sourcing_awards a join procurement_rfqs r on r.id=a.rfq_id join planning_purchase_requests pr on pr.id=r.purchase_request_id
      where a.id=$1 for update of a,pr`, [awardId]);
    const award = awardResult.rows[0];
    if (!award) throw new ProcurementError("SOURCING_AWARD_NOT_FOUND", "采购定标不存在", 404);
    if (award.status !== "AWARDED" || Number(award.version) !== expectedVersion) throw new ProcurementError("SOURCING_AWARD_VERSION_OR_STATE_CONFLICT", "采购定标版本已变化、已撤销或状态不可转单", 409);
    if (award.purchase_request_status !== "ACCEPTED") throw new ProcurementError("PURCHASE_REQUEST_NOT_ACTIVE", "来源采购需求不再有效", 409);
    const result = await client.query<AwardLine>(`select al.id award_line_id,al.award_id,al.supplier_id,rl.material_id,rl.unit_id,al.selected_quantity,al.selected_unit_price,
      al.promised_delivery_date,q.currency_code,q.status quote_status,q.valid_until,ql.material_id quote_material_id,ql.unit_id quote_unit_id,ql.quoted_quantity,ql.unit_price quote_unit_price,ql.promised_delivery_date quote_promised_delivery_date
      from procurement_sourcing_award_lines al join procurement_rfq_lines rl on rl.id=al.rfq_line_id
      join procurement_supplier_quote_lines ql on ql.id=al.selected_quote_line_id join procurement_supplier_quotes q on q.id=ql.quote_id
      where al.award_id=$1 order by al.id for update of al,q`, [awardId]);
    if (!result.rows.length) throw new ProcurementError("SOURCING_AWARD_EMPTY", "采购定标没有明细", 409);
    if ((await client.query("select 1 from procurement_award_po_line_links where award_id=$1 limit 1", [awardId])).rows[0]) throw new ProcurementError("SOURCING_AWARD_ALREADY_CONVERTED", "采购定标明细已经生成采购订单", 409);
    for (const row of result.rows) {
      if (row.quote_status !== "SUBMITTED" || dateOnly(row.valid_until) < new Date().toISOString().slice(0, 10)) throw new ProcurementError("SOURCING_QUOTE_NOT_CURRENT", "选中报价已失效或已被替代", 409);
      const sameNumeric = await client.query("select $1::numeric=$2::numeric price_ok,$3::numeric=$4::numeric quantity_ok", [row.selected_unit_price, row.quote_unit_price, row.selected_quantity, row.quoted_quantity]);
      if (row.material_id !== row.quote_material_id || row.unit_id !== row.quote_unit_id || !sameNumeric.rows[0].price_ok || !sameNumeric.rows[0].quantity_ok || dateOnly(row.promised_delivery_date) !== dateOnly(row.quote_promised_delivery_date)) throw new ProcurementError("SOURCING_AWARD_SOURCE_MISMATCH", "定标与选中报价的物料、数量、单位、价格或承诺交期不一致", 409);
      const supplier = await client.query("select 1 from suppliers where id=$1 and status='ACTIVE'", [Number(row.supplier_id)]);
      if (!supplier.rows[0]) throw new ProcurementError("SUPPLIER_NOT_ACTIVE", "定标供应商不存在或未启用", 422);
    }
    return result.rows;
  }

  async convertAward(awardId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const expectedVersion = version(input.expected_version, "expected_version");
    return this.repository.execute(meta, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`SOURCING_AWARD_CONVERT:${awardId}`]);
      const rows = await this.awardLines(client, awardId, expectedVersion); const groups = new Map<string, AwardLine[]>();
      for (const row of rows) groups.set(`${row.supplier_id}:${row.currency_code}`, [...(groups.get(`${row.supplier_id}:${row.currency_code}`) ?? []), row]);
      const created: Record<string, unknown>[] = [];
      for (const group of [...groups.values()].sort((a, b) => `${a[0].supplier_id}:${a[0].currency_code}`.localeCompare(`${b[0].supplier_id}:${b[0].currency_code}`))) {
        const orderLines: PurchaseOrderLineInput[] = [];
        for (const row of group) {
          const mapping = await client.query(`select id from supplier_mappings where supplier_id=$1 and material_id=$2 and purchase_unit_id=$3 and status='ACTIVE'
            and conversion_numerator=1 and conversion_denominator=1 and valid_from<=now() and (valid_to is null or valid_to>now()) order by id`, [Number(row.supplier_id), Number(row.material_id), Number(row.unit_id)]);
          if (mapping.rows.length !== 1) throw new ProcurementError("AWARD_SUPPLIER_MAPPING_NOT_UNIQUE", "定标物料必须存在唯一有效的一比一供应商映射", 422);
          orderLines.push({ materialId: Number(row.material_id), unitId: Number(row.unit_id), supplierMappingId: Number(mapping.rows[0].id), orderQty: row.selected_quantity, unitPrice: row.selected_unit_price, remark: "采购定标转单" });
        }
        const promised = group.map((row) => dateOnly(row.promised_delivery_date)).sort().at(-1)!;
        const order = await this.procurement.createOrderInTransaction(client, meta, Number(group[0].supplier_id), group[0].currency_code, "SOURCING_AWARD", new Date(`${promised}T00:00:00Z`), `采购定标 ${awardId}`, orderLines);
        const saved = order.lines as Record<string, unknown>[];
        for (let index = 0; index < group.length; index += 1) {
          const row = group[index], poLine = saved[index]; const sourceDigest = digest([awardId, row.award_line_id, order.id, poLine.id, row.supplier_id, row.material_id, row.unit_id, row.selected_quantity, row.selected_unit_price, row.currency_code, dateOnly(row.promised_delivery_date)]);
          await client.query(`insert into procurement_award_po_line_links(award_id,award_line_id,purchase_order_id,purchase_order_line_id,source_digest,operation_id,created_by,request_id)
            values($1,$2,$3,$4,$5,$6,$7,$8)`, [awardId, Number(row.award_line_id), Number(order.id), Number(poLine.id), sourceDigest, meta.operationId, meta.actor.username, meta.requestId]);
        }
        created.push(order);
      }
      await this.fault?.("after_award_po_links");
      return { status: 201, body: { ok: true, data: { award_id: awardId, purchase_orders: created }, request_id: meta.requestId }, objectId: awardId };
    });
  }

  async createDeliveryPlans(purchaseOrderId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const expectedVersion = version(input.expected_version, "expected_version");
    return this.repository.execute(meta, async (client) => {
      const header = await client.query("select * from purchase_orders where id=$1 for update", [purchaseOrderId]); const po = header.rows[0];
      if (!po) throw new ProcurementError("PURCHASE_ORDER_NOT_FOUND", "采购订单不存在", 404);
      if (po.source_type !== "SOURCING_AWARD" || po.status !== "OPEN" || Number(po.version) !== expectedVersion) throw new ProcurementError("DELIVERY_PLAN_PO_VERSION_OR_STATE_CONFLICT", "采购订单版本已变化或当前状态不能建立到货计划", 409);
      const rows = await client.query(`select pol.*,al.promised_delivery_date from purchase_order_lines pol join procurement_award_po_line_links l on l.purchase_order_line_id=pol.id
        join procurement_sourcing_award_lines al on al.id=l.award_line_id where pol.purchase_order_id=$1 order by pol.line_no for update of pol`, [purchaseOrderId]);
      if (!rows.rows.length) throw new ProcurementError("AWARD_PO_SOURCE_NOT_FOUND", "采购订单缺少定标来源关系", 409);
      if ((await client.query("select 1 from purchase_delivery_plans where purchase_order_id=$1 limit 1", [purchaseOrderId])).rows[0]) throw new ProcurementError("DELIVERY_PLAN_ALREADY_EXISTS", "采购订单已经建立到货计划", 409);
      const plans = [];
      for (const row of rows.rows) {
        const plan = await client.query(`insert into purchase_delivery_plans(purchase_order_id,purchase_order_line_id,supplier_id,material_id,unit_id,planned_quantity,received_quantity,promised_delivery_date,status,created_by,updated_by,request_id)
          values($1,$2,$3,$4,$5,$6,0,$7,'PENDING',$8,$8,$9) returning *`, [purchaseOrderId, Number(row.id), Number(po.supplier_id), Number(row.material_id), Number(row.unit_id), row.order_qty, row.promised_delivery_date, meta.actor.username, meta.requestId]);
        const planId = Number(plan.rows[0].id); await client.query("insert into warehouse_receiving_queue_entries(delivery_plan_id,created_by,updated_by) values($1,$2,$2)", [planId, meta.actor.username]);
        await client.query("insert into purchase_delivery_plan_events(delivery_plan_id,from_status,to_status,event_type,actor,request_id) values($1,null,'PENDING','CREATED',$2,$3)", [planId, meta.actor.username, meta.requestId]); plans.push(plan.rows[0]);
      }
      await this.fault?.("after_delivery_plans");
      return { status: 201, body: { ok: true, data: { purchase_order_id: purchaseOrderId, plans }, request_id: meta.requestId }, objectId: purchaseOrderId };
    });
  }

  async receive(deliveryPlanId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const receiveQuantity = quantity(input.quantity, "quantity"), expectedPlanVersion = version(input.expected_version, "expected_version"), expectedLineVersion = version(input.expected_line_version, "expected_line_version"), expectedBalanceVersion = Number(input.expected_balance_version);
    if (!Number.isSafeInteger(expectedBalanceVersion) || expectedBalanceVersion < 0) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_balance_version 必须是非负整数");
    const reason = text(input.reason ?? "仓库按到货计划收货", "reason", 1000, true);
    return this.repository.execute(meta, async (client) => {
      const planResult = await client.query("select * from purchase_delivery_plans where id=$1 for update", [deliveryPlanId]); const plan = planResult.rows[0];
      if (!plan) throw new ProcurementError("DELIVERY_PLAN_NOT_FOUND", "到货计划不存在", 404);
      if (!['PENDING','PARTIAL'].includes(String(plan.status)) || Number(plan.version) !== expectedPlanVersion) throw new ProcurementError("DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT", "到货计划版本已变化或当前状态不可收货", 409);
      if (!(await client.query("select 1 from warehouse_receiving_queue_entries where delivery_plan_id=$1 and closed_at is null for update", [deliveryPlanId])).rows[0]) throw new ProcurementError("RECEIVING_QUEUE_CLOSED", "待入库记录已关闭", 409);
      const allowed = await client.query("select $1::numeric<=($2::numeric-$3::numeric) ok", [receiveQuantity, plan.planned_quantity, plan.received_quantity]);
      if (!allowed.rows[0].ok) throw new ProcurementError("PURCHASE_RECEIPT_OVER_QUANTITY", "收货数量超过到货计划未收数量", 409);
      const receipt = await this.procurement.createReceiptInTransaction(client, meta, Number(plan.purchase_order_id), [{ purchaseOrderLineId: Number(plan.purchase_order_line_id), quantity: receiveQuantity, expectedLineVersion, expectedBalanceVersion }], reason);
      const data = receipt.body.data as Record<string, unknown>, receiptLine = (data.lines as Record<string, unknown>[])[0];
      await client.query(`insert into purchase_receipt_delivery_allocations(purchase_receipt_line_id,delivery_plan_id,quantity,created_by,request_id) values($1,$2,$3,$4,$5)`, [Number(receiptLine.id), deliveryPlanId, receiveQuantity, meta.actor.username, meta.requestId]);
      const updated = await client.query(`update purchase_delivery_plans set received_quantity=received_quantity+$2::numeric,status=case when received_quantity+$2::numeric=planned_quantity then 'COMPLETED' else 'PARTIAL' end,
        version=version+1,updated_by=$3,updated_at=now() where id=$1 and version=$4 returning *`, [deliveryPlanId, receiveQuantity, meta.actor.username, expectedPlanVersion]);
      if (!updated.rows[0]) throw new ProcurementError("DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT", "到货计划版本已变化", 409);
      await client.query("insert into purchase_delivery_plan_events(delivery_plan_id,purchase_receipt_id,from_status,to_status,event_type,quantity,reason,actor,request_id) values($1,$2,$3,$4,'RECEIPT_POSTED',$5,$6,$7,$8)", [deliveryPlanId, Number(data.id), plan.status, updated.rows[0].status, receiveQuantity, reason, meta.actor.username, meta.requestId]);
      if (updated.rows[0].status === "COMPLETED") await client.query("update warehouse_receiving_queue_entries set version=version+1,updated_by=$2,updated_at=now(),closed_by=$2,closed_at=now(),close_reason='到货计划已完成' where delivery_plan_id=$1 and closed_at is null", [deliveryPlanId, meta.actor.username]);
      await this.fault?.("after_receipt_allocation");
      return { ...receipt, body: { ...receipt.body, delivery_plan: updated.rows[0] } };
    });
  }

  async transitionPlan(deliveryPlanId: number, transition: "cancel" | "close", meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const expected = version(input.expected_version, "expected_version"), reason = text(input.reason, "reason", 1000, true), target = transition === "cancel" ? "CANCELLED" : "CLOSED";
    return this.repository.execute(meta, async (client) => {
      const planResult = await client.query("select * from purchase_delivery_plans where id=$1 for update", [deliveryPlanId]); const plan = planResult.rows[0];
      if (!plan) throw new ProcurementError("DELIVERY_PLAN_NOT_FOUND", "到货计划不存在", 404);
      const valid = transition === "cancel" ? plan.status === "PENDING" && String(plan.received_quantity) === "0.000000" : plan.status === "COMPLETED";
      if (Number(plan.version) !== expected || !valid) throw new ProcurementError(transition === "cancel" ? "DELIVERY_PLAN_CANCEL_CONFLICT" : "DELIVERY_PLAN_CLOSE_CONFLICT", transition === "cancel" ? "只有版本匹配且尚未收货的待到货计划可以取消" : "只有版本匹配且已全部收货的计划可以关闭", 409);
      const updated = await client.query("update purchase_delivery_plans set status=$2,version=version+1,updated_by=$3,updated_at=now() where id=$1 and version=$4 returning *", [deliveryPlanId, target, meta.actor.username, expected]);
      await client.query("update warehouse_receiving_queue_entries set version=version+1,updated_by=$2,updated_at=now(),closed_by=$2,closed_at=coalesce(closed_at,now()),close_reason=$3 where delivery_plan_id=$1", [deliveryPlanId, meta.actor.username, reason]);
      await client.query("insert into purchase_delivery_plan_events(delivery_plan_id,from_status,to_status,event_type,reason,actor,request_id) values($1,$2,$3,$3,$4,$5,$6)", [deliveryPlanId, plan.status, target, reason, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: updated.rows[0], request_id: meta.requestId }, objectId: deliveryPlanId };
    });
  }

  async reverseReceipt(receiptId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    const reason = text(input.reason, "冲销原因", 1000, true), balances = expectedBalanceVersions(input.expected_balance_versions), expectedPlanVersion = version(input.expected_plan_version, "expected_plan_version");
    const rawLineVersions = input.expected_line_versions;
    if (!Array.isArray(rawLineVersions) || rawLineVersions.length < 1 || rawLineVersions.length > 100) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_line_versions 必须包含 1 到 100 行");
    const lineVersions = new Map<number, number>();
    for (const raw of rawLineVersions) { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_line_versions 行无效"); const row = raw as Record<string, unknown>, lineId = id(row.purchase_order_line_id, "purchase_order_line_id"); if (lineVersions.has(lineId)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_line_versions 不能重复采购明细"); lineVersions.set(lineId, version(row.expected_line_version, "expected_line_version")); }
    return this.repository.execute(meta, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`FINANCE_SOURCE:AP:${receiptId}`]);
      if ((await client.query(`select 1 from finance_documents fd join purchase_financial_source_entries pf on pf.id=fd.purchase_source_entry_id where pf.purchase_receipt_id=$1 and fd.doc_type='AP'`, [receiptId])).rows[0]) throw new ProcurementError("RECEIPT_REVERSAL_BLOCKED_BY_AP", "该收货来源已经生成应付，不能破坏来源链", 409);
      const allocationResult = await client.query(`select a.*,p.status plan_status,p.version plan_version,p.received_quantity,p.purchase_order_line_id
        from purchase_receipt_delivery_allocations a join purchase_delivery_plans p on p.id=a.delivery_plan_id
        join purchase_receipt_lines rl on rl.id=a.purchase_receipt_line_id where rl.purchase_receipt_id=$1 for update of p`, [receiptId]);
      if (allocationResult.rows.length !== 1) throw new ProcurementError("RECEIPT_DELIVERY_ALLOCATION_NOT_FOUND", "收货单缺少唯一到货计划分配关系", 409);
      const allocation = allocationResult.rows[0];
      if (Number(allocation.plan_version) !== expectedPlanVersion) throw new ProcurementError("DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT", "到货计划版本已变化", 409);
      if (allocation.plan_status === "CLOSED") throw new ProcurementError("DELIVERY_PLAN_CLOSED", "已关闭到货计划的收货不能冲销", 409);
      const result = await this.procurement.reverseReceiptInTransaction(client, receiptId, meta, reason, balances, lineVersions);
      const data = result.body.data as Record<string, unknown>, reversalLine = (data.lines as Record<string, unknown>[])[0];
      await client.query(`insert into purchase_receipt_delivery_allocations(purchase_receipt_line_id,delivery_plan_id,quantity,reversal_of_allocation_id,created_by,request_id)
        values($1,$2,$3,$4,$5,$6)`, [Number(reversalLine.id), Number(allocation.delivery_plan_id), allocation.quantity, Number(allocation.id), meta.actor.username, meta.requestId]);
      const updated = await client.query(`update purchase_delivery_plans set received_quantity=received_quantity-$2::numeric,
        status=case when received_quantity-$2::numeric=0 then 'PENDING' else 'PARTIAL' end,version=version+1,updated_by=$3,updated_at=now()
        where id=$1 and version=$4 and received_quantity>=$2::numeric returning *`, [Number(allocation.delivery_plan_id), allocation.quantity, meta.actor.username, expectedPlanVersion]);
      if (!updated.rows[0]) throw new ProcurementError("DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT", "到货计划版本已变化或累计收货不足", 409);
      if (allocation.plan_status === "COMPLETED") await client.query("update warehouse_receiving_queue_entries set version=version+1,updated_by=$2,updated_at=now(),closed_by=null,closed_at=null,close_reason='' where delivery_plan_id=$1", [Number(allocation.delivery_plan_id), meta.actor.username]);
      await client.query("insert into purchase_delivery_plan_events(delivery_plan_id,purchase_receipt_id,from_status,to_status,event_type,quantity,reason,actor,request_id) values($1,$2,$3,$4,'RECEIPT_REVERSED',$5,$6,$7,$8)", [Number(allocation.delivery_plan_id), Number(data.id), allocation.plan_status, updated.rows[0].status, allocation.quantity, reason, meta.actor.username, meta.requestId]);
      await this.fault?.("after_receipt_reversal_allocation");
      return { ...result, body: { ...result.body, delivery_plan: updated.rows[0] } };
    });
  }
}

export { numericId };
