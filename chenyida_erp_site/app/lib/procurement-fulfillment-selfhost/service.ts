import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { ProcurementError } from "../procurement-selfhost/errors.ts";
import { ProcurementRepository } from "../procurement-selfhost/repository.ts";
import { expectedBalanceVersions, id, quantity, supplierLotCode, text, version } from "../procurement-selfhost/rules.ts";
import { ProcurementService } from "../procurement-selfhost/service.ts";
import type { ProcurementMeta, ProcurementResult, PurchaseOrderLineInput } from "../procurement-selfhost/types.ts";
import { ProcurementSourcingRepository } from "../procurement-sourcing-selfhost/repository.ts";
import { ProcurementSourcingService } from "../procurement-sourcing-selfhost/service.ts";
import { buildAwardConversionPreview, type AwardConversionPreview } from "./award-conversion-preview.ts";
import { firstAwardMappingQualificationFailure, loadAwardMappingQualification } from "./award-mapping-qualification.ts";
import { loadPurchaseOrderHistory, type PurchaseOrderHistoryReadModel } from "./purchase-order-history.ts";
import { assertReceiptEvidenceDateNotFuture, receiptEvidenceDate } from "./receipt-evidence-date.ts";
import { loadWarehouseReceiptReadiness, type WarehouseReceiptReadiness } from "./warehouse-receipt-readiness.ts";

type AwardLine = {
  award_line_id: string; award_id: string; rfq_line_id: string; selected_quote_line_id: string; comparison_id: string;
  comparison_version_no: number; comparison_candidate_id: string; quote_id: string; quote_version_no: number;
  supplier_id: string; supplier_status: string; material_id: string; material_status: string; unit_id: string; unit_enabled: boolean;
  selected_quantity: string; selected_unit_price: string; promised_delivery_date: string; currency_code: string;
  quote_status: string; valid_until: string; quote_current: boolean; quote_material_id: string; quote_unit_id: string; quoted_quantity: string; quote_unit_price: string; quote_promised_delivery_date: string;
  candidate_currency_code: string; candidate_unit_price: string; candidate_promised_delivery_date: string; candidate_status: string; candidate_awardable: boolean;
};

type ConversionAssertions = AwardConversionPreview["confirmation"] & Readonly<{ remark: string }>;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dateOnly = (value: unknown) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const numericId = (value: unknown, field: string) => { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; };
const sha256 = (value: unknown, field: string) => { const result = String(value ?? ""); if (!/^[0-9a-f]{64}$/.test(result)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是SHA-256摘要`); return result; };
const stableIds = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须包含1到100个ID`);
  const result = value.map((item) => { if (typeof item !== "string" || !/^[1-9]\d*$/.test(item)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须使用规范十进制字符串ID`); return item; });
  if (new Set(result).size !== result.length) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 不能重复`);
  return result.sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
};
const exactKeys = (value: Record<string, unknown>, expected: string[]) => { const extra = Object.keys(value).find((key) => !expected.includes(key)); if (extra) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `请求正文包含不支持的字段：${extra}`); };
const strictBoolean = (value: unknown, field: string) => { if (typeof value !== "boolean") throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是布尔值`); return value; };
const evidenceType = (value: unknown) => {
  const result = String(value ?? "");
  if (!["DELIVERY_NOTE", "LOGISTICS_HANDOVER", "OTHER_EQUIVALENT"].includes(result)) {
    throw new ProcurementError("RECEIPT_EVIDENCE_TYPE_INVALID", "送货凭证类型无效", 422);
  }
  return result as "DELIVERY_NOTE" | "LOGISTICS_HANDOVER" | "OTHER_EQUIVALENT";
};
export class ProcurementFulfillmentService {
  readonly repository: ProcurementRepository;
  readonly procurement: ProcurementService;
  readonly fault?: (checkpoint: string) => void | Promise<void>;

  constructor(repository: ProcurementRepository, procurement = new ProcurementService(repository), fault?: (checkpoint: string) => void | Promise<void>) {
    this.repository = repository; this.procurement = procurement; this.fault = fault;
  }

  async conversionPreview(awardId: number, actor: Pick<IdentityActor, "username" | "role" | "permissions">, transactionClient?: PoolClient) {
    const client = transactionClient ?? await this.repository.pool.connect();
    const ownsTransaction = transactionClient === undefined;
    try {
      if (ownsTransaction) await client.query("begin isolation level repeatable read read only");
      const source = await client.query<{ rfq_id: string }>("select rfq_id::text from procurement_sourcing_awards where id=$1", [awardId]);
      if (!source.rows[0]) throw new ProcurementError("SOURCING_AWARD_NOT_FOUND", "采购定标不存在", 404);
      const sourcing = new ProcurementSourcingService(new ProcurementSourcingRepository(this.repository.pool));
      const detail = await sourcing.detail(numericId(source.rows[0].rfq_id, "rfqId"), actor, client);
      const qualification = await loadAwardMappingQualification(client, awardId);
      const preview = buildAwardConversionPreview(detail, awardId, qualification);
      if (ownsTransaction) await client.query("commit");
      return preview;
    } catch (error) {
      if (ownsTransaction) await client.query("rollback").catch(() => undefined);
      if (error instanceof ProcurementError) throw error;
      const known = error as { code?: string; status?: number };
      if (known.code === "RFQ_FORBIDDEN") throw new ProcurementError("PERMISSION_DENIED", "没有权限查看该采购定标", 403);
      if (known.status === 404) throw new ProcurementError("SOURCING_AWARD_NOT_FOUND", "采购定标或来源询价不存在", 404);
      throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "采购定标权威预览不完整或已变化，已停止转换", 409);
    } finally { if (ownsTransaction) client.release(); }
  }

  async purchaseOrderHistory(
    purchaseOrderId: number,
    actor: Pick<IdentityActor, "username" | "role" | "permissions">,
  ): Promise<PurchaseOrderHistoryReadModel> {
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await client.query("set local statement_timeout='5s'");
      const source = await client.query<{ purchase_order_id: string; rfq_id: string | null }>(`select distinct
          po.id::text purchase_order_id,award.rfq_id::text rfq_id
        from purchase_orders po
        left join procurement_award_po_line_links link on link.purchase_order_id=po.id
        left join procurement_sourcing_awards award on award.id=link.award_id
        where po.id=$1`, [purchaseOrderId]);
      if (!source.rows.length) throw new ProcurementError("PURCHASE_ORDER_NOT_FOUND", "采购订单不存在", 404);
      if (source.rows.length !== 1 || !source.rows[0].rfq_id) {
        throw new ProcurementError(
          "PURCHASE_ORDER_HISTORY_INCONSISTENT",
          "采购订单历史来源不完整，已停止展示且未修改任何数据",
          409,
        );
      }
      const sourcing = new ProcurementSourcingService(new ProcurementSourcingRepository(this.repository.pool));
      const detail = await sourcing.detail(numericId(source.rows[0].rfq_id, "rfqId"), actor, client);
      const history = await loadPurchaseOrderHistory(client, purchaseOrderId, detail);
      await client.query("commit");
      return history;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error instanceof ProcurementError) throw error;
      const known = error as { code?: string; status?: number };
      if (known.code === "RFQ_FORBIDDEN") {
        throw new ProcurementError("PERMISSION_DENIED", "没有权限查看该采购订单及其项目数据域", 403);
      }
      if (known.status === 404) throw new ProcurementError("PURCHASE_ORDER_NOT_FOUND", "采购订单或其来源不存在", 404);
      throw new ProcurementError(
        "PURCHASE_ORDER_HISTORY_INCONSISTENT",
        "采购订单历史引用、凭证或下游投影不完整，已停止展示且未修改任何数据",
        409,
      );
    } finally {
      client.release();
    }
  }

  async receiptReadiness(
    deliveryPlanId: number,
    actor: Pick<IdentityActor, "username" | "role" | "permissions">,
    rawQuantity: string | null,
    rawEvidenceDocumentDate: string | null,
  ): Promise<WarehouseReceiptReadiness> {
    const previewQuantity = rawQuantity === null || rawQuantity.trim() === "" ? null : quantity(rawQuantity, "quantity");
    const client = await this.repository.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await client.query("set local statement_timeout='5s'");
      const preview = await loadWarehouseReceiptReadiness(
        client,
        deliveryPlanId,
        actor.username,
        previewQuantity,
        rawEvidenceDocumentDate,
      );
      await client.query("commit");
      return preview;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error instanceof ProcurementError) throw error;
      throw new ProcurementError(
        "WAREHOUSE_RECEIPT_READINESS_INCONSISTENT",
        "仓库收货谱系、凭证或下游投影不完整，已停止展示且未修改任何数据",
        409,
      );
    } finally { client.release(); }
  }

  private conversionAssertions(input: Record<string, unknown>, preview: AwardConversionPreview): ConversionAssertions {
    exactKeys(input, [
      "expected_award_version", "expected_rfq_id", "expected_rfq_version", "expected_comparison_version",
      "expected_comparison_output_digest", "expected_award_digest", "expected_decision_digest", "expected_mapping_qualification_digest", "expected_po_count",
      "expected_delivery_plan_count", "expected_award_line_ids", "remark",
    ]);
    const assertions: ConversionAssertions = {
      expected_award_version: numericId(input.expected_award_version, "expected_award_version"),
      expected_rfq_id: numericId(input.expected_rfq_id, "expected_rfq_id"),
      expected_rfq_version: numericId(input.expected_rfq_version, "expected_rfq_version"),
      expected_comparison_version: numericId(input.expected_comparison_version, "expected_comparison_version"),
      expected_comparison_output_digest: sha256(input.expected_comparison_output_digest, "expected_comparison_output_digest"),
      expected_award_digest: sha256(input.expected_award_digest, "expected_award_digest"),
      expected_decision_digest: sha256(input.expected_decision_digest, "expected_decision_digest"),
      expected_mapping_qualification_digest: sha256(input.expected_mapping_qualification_digest, "expected_mapping_qualification_digest"),
      expected_po_count: version(input.expected_po_count, "expected_po_count"),
      expected_delivery_plan_count: version(input.expected_delivery_plan_count, "expected_delivery_plan_count"),
      expected_award_line_ids: stableIds(input.expected_award_line_ids, "expected_award_line_ids"),
      remark: text(input.remark, "remark", 2000),
    };
    const expected = preview.confirmation;
    const scalarKeys: Array<Exclude<keyof typeof expected, "expected_award_line_ids">> = [
      "expected_award_version", "expected_rfq_id", "expected_rfq_version", "expected_comparison_version",
      "expected_comparison_output_digest", "expected_award_digest", "expected_decision_digest", "expected_po_count",
      "expected_delivery_plan_count",
    ];
    if (scalarKeys.some((key) => assertions[key] !== expected[key])
      || JSON.stringify(assertions.expected_award_line_ids) !== JSON.stringify(expected.expected_award_line_ids)) {
      throw new ProcurementError("AWARD_CONVERSION_CONFIRMATION_STALE", "Award转换确认中的状态、CAS、摘要、行集或下游计数已变化，请关闭后重新打开", 409);
    }
    return assertions;
  }

  async pendingAwards(limit: number, offset: number, actor: Pick<IdentityActor, "username" | "role" | "permissions">) {
    const unrestricted = actor.role !== "purchase" || actor.permissions.includes("*");
    return this.repository.pool.query(`select a.id award_id,a.version award_version,a.selected_at,a.reason_code,a.reason,r.id rfq_id,r.rfq_code,pr.request_code,
      count(al.id)::int line_count,coalesce(sum(al.selected_quantity),0)::text total_quantity,
      count(l.id)::int converted_line_count
      from procurement_sourcing_awards a join procurement_rfqs r on r.id=a.rfq_id join planning_purchase_requests pr on pr.id=r.purchase_request_id
      join procurement_sourcing_award_lines al on al.award_id=a.id left join procurement_award_po_line_links l on l.award_line_id=al.id
      where a.status='AWARDED' and pr.status='ACCEPTED'
        and ($3::boolean or pr.accepted_by=$4 or pr.returned_by=$4)
      group by a.id,r.id,pr.id having count(l.id)<count(al.id)
      order by a.selected_at,a.id limit $1 offset $2`, [limit, offset, unrestricted, actor.username]);
  }

  async listOrdersAndPlans(limit: number, offset: number, actor: Pick<IdentityActor, "username" | "role" | "permissions">) {
    const unrestricted = actor.role !== "purchase" || actor.permissions.includes("*");
    return this.repository.pool.query(`select po.id purchase_order_id,po.po_code,po.status po_status,po.currency_code,po.version po_version,s.supplier_code,s.supplier_name,
      count(pol.id)::int line_count,count(dp.id)::int plan_count,coalesce(sum(pol.order_qty),0)::text ordered_quantity,
      coalesce(sum(pol.received_qty),0)::text received_quantity,coalesce(receipt.receipt_count,0)::int receipt_count,
      coalesce(receipt.receipt_codes,'') receipt_codes,coalesce(receipt.internal_lots,'') internal_lots,
      coalesce(receipt.supplier_lots,'') supplier_lots,coalesce(receipt.iqc_status,'') iqc_status
      from purchase_orders po join suppliers s on s.id=po.supplier_id join purchase_order_lines pol on pol.purchase_order_id=po.id
      join procurement_award_po_line_links l on l.purchase_order_line_id=pol.id left join purchase_delivery_plans dp on dp.purchase_order_line_id=pol.id
      left join lateral(select count(distinct pr.id) receipt_count,string_agg(distinct pr.receipt_code,', ' order by pr.receipt_code) receipt_codes,
        string_agg(distinct il.lot_code,', ' order by il.lot_code) internal_lots,string_agg(distinct il.supplier_lot_code,', ' order by il.supplier_lot_code) supplier_lots,
        string_agg(distinct qi.lifecycle_status||'/'||qi.decision_status||' released '||qi.released_qty::text,', ' order by qi.lifecycle_status||'/'||qi.decision_status||' released '||qi.released_qty::text) iqc_status
        from purchase_receipts pr join purchase_receipt_lines prl on prl.purchase_receipt_id=pr.id left join inventory_lots il on il.source_purchase_receipt_line_id=prl.id left join quality_inspections qi on qi.inventory_lot_id=il.id
        where pr.purchase_order_id=po.id and pr.receipt_type='RECEIPT') receipt on true
      where ($3::boolean or exists(select 1 from purchase_order_lines scope_line
        join procurement_award_po_line_links scope_link on scope_link.purchase_order_line_id=scope_line.id
        join procurement_sourcing_awards scope_award on scope_award.id=scope_link.award_id
        join procurement_rfqs scope_rfq on scope_rfq.id=scope_award.rfq_id
        join planning_purchase_requests scope_prq on scope_prq.id=scope_rfq.purchase_request_id
        where scope_line.purchase_order_id=po.id
          and (scope_prq.status='SUBMITTED' or scope_prq.accepted_by=$4 or scope_prq.returned_by=$4)))
      group by po.id,s.id,receipt.receipt_count,receipt.receipt_codes,receipt.internal_lots,receipt.supplier_lots,receipt.iqc_status order by po.created_at desc,po.id desc limit $1 offset $2`, [limit, offset, unrestricted, actor.username]);
  }

  async receivingQueue(limit: number, offset: number, actor: Pick<IdentityActor, "username" | "role" | "permissions">) {
    const unrestricted = actor.role !== "purchase" || actor.permissions.includes("*");
    return this.repository.pool.query(`select q.id queue_id,q.version queue_version,p.*,po.po_code,po.status po_status,po.version po_version,pol.line_no,pol.version purchase_order_line_version,
      (p.planned_quantity-p.received_quantity)::text remaining_quantity,s.supplier_code,s.supplier_name,m.internal_material_code,m.standard_name,u.code unit_code,
      m.inventory_type,m.inspection_type,case when m.inventory_type='STOCKED' and m.inspection_type='IQC' then 0 else coalesce(b.version,0) end balance_version,coalesce(b.on_hand_qty,0)::text on_hand_quantity,
      (p.promised_delivery_date<current_date and p.status in ('PENDING','PARTIAL')) overdue
      from warehouse_receiving_queue_entries q join purchase_delivery_plans p on p.id=q.delivery_plan_id
      join purchase_orders po on po.id=p.purchase_order_id join purchase_order_lines pol on pol.id=p.purchase_order_line_id
      join suppliers s on s.id=p.supplier_id join material_master m on m.id=p.material_id join units u on u.id=p.unit_id
      left join inventory_stock_balances b on b.material_id=p.material_id and b.location_code='MAIN' and b.lot_code=''
      where q.closed_at is null and p.status in ('PENDING','PARTIAL')
        and ($3::boolean or exists(select 1 from procurement_award_po_line_links scope_link
          join procurement_sourcing_awards scope_award on scope_award.id=scope_link.award_id
          join procurement_rfqs scope_rfq on scope_rfq.id=scope_award.rfq_id
          join planning_purchase_requests scope_prq on scope_prq.id=scope_rfq.purchase_request_id
          where scope_link.purchase_order_line_id=pol.id
            and (scope_prq.status='SUBMITTED' or scope_prq.accepted_by=$4 or scope_prq.returned_by=$4)))
      order by p.promised_delivery_date,p.id limit $1 offset $2`, [limit, offset, unrestricted, actor.username]);
  }

  async payableHandoff(limit: number, offset: number, actor: Pick<IdentityActor, "username" | "role" | "permissions">) {
    const unrestricted = actor.role !== "purchase" || actor.permissions.includes("*");
    return this.repository.pool.query(`select pf.id source_entry_id,pf.source_id,pf.amount::text,pf.currency_code,pf.created_at,pr.id receipt_id,pr.receipt_code,
      po.id purchase_order_id,po.po_code,s.supplier_code,s.supplier_name,fd.id ap_id,fd.doc_code ap_code,fd.status ap_status,
      case when fd.id is null then 'PENDING_AP' else 'AP_CREATED' end handoff_status
      from purchase_financial_source_entries pf join purchase_receipts pr on pr.id=pf.purchase_receipt_id
      join purchase_orders po on po.id=pr.purchase_order_id join suppliers s on s.id=pf.supplier_id
      left join finance_documents fd on fd.purchase_source_entry_id=pf.id and fd.doc_type='AP'
      where pf.entry_type='RECEIPT'
        and ($3::boolean or exists(select 1 from purchase_order_lines scope_line
          join procurement_award_po_line_links scope_link on scope_link.purchase_order_line_id=scope_line.id
          join procurement_sourcing_awards scope_award on scope_award.id=scope_link.award_id
          join procurement_rfqs scope_rfq on scope_rfq.id=scope_award.rfq_id
          join planning_purchase_requests scope_prq on scope_prq.id=scope_rfq.purchase_request_id
          where scope_line.purchase_order_id=po.id
            and (scope_prq.status='SUBMITTED' or scope_prq.accepted_by=$4 or scope_prq.returned_by=$4)))
      order by pf.created_at desc,pf.id desc limit $1 offset $2`, [limit, offset, unrestricted, actor.username]);
  }

  private async awardLines(client: PoolClient, awardId: number, expected: ConversionAssertions): Promise<AwardLine[]> {
    const awardResult = await client.query(`select a.*,r.id::text rfq_id,r.status rfq_status,r.version rfq_version,
      r.purchase_request_id,pr.status purchase_request_status
      from procurement_sourcing_awards a join procurement_rfqs r on r.id=a.rfq_id
      join planning_purchase_requests pr on pr.id=r.purchase_request_id
      where a.id=$1 for update of a,r,pr`, [awardId]);
    const award = awardResult.rows[0];
    if (!award) throw new ProcurementError("SOURCING_AWARD_NOT_FOUND", "采购定标不存在", 404);
    if (award.status !== "AWARDED" || Number(award.version) !== expected.expected_award_version) {
      throw new ProcurementError("SOURCING_AWARD_VERSION_OR_STATE_CONFLICT", "采购定标版本已变化、已撤销或状态不可转单", 409);
    }
    if (Number(award.rfq_id) !== expected.expected_rfq_id || award.rfq_status !== "CLOSED"
      || Number(award.rfq_version) !== expected.expected_rfq_version) {
      throw new ProcurementError("SOURCING_RFQ_VERSION_OR_STATE_CONFLICT", "来源RFQ身份、版本或状态已变化", 409);
    }
    if (award.award_digest !== expected.expected_award_digest) {
      throw new ProcurementError("SOURCING_AWARD_DIGEST_CONFLICT", "Award持久化摘要已变化", 409);
    }
    if (award.purchase_request_status !== "ACCEPTED") throw new ProcurementError("PURCHASE_REQUEST_NOT_ACTIVE", "来源采购需求不再有效", 409);

    const baseLines = await client.query<{ award_line_id: string; rfq_line_id: string }>(
      "select id::text award_line_id,rfq_line_id::text from procurement_sourcing_award_lines where award_id=$1 order by id for update",
      [awardId],
    );
    const rfqLines = await client.query<{ rfq_line_id: string }>(
      "select id::text rfq_line_id from procurement_rfq_lines where rfq_id=$1 order by id for share",
      [expected.expected_rfq_id],
    );
    if (!baseLines.rows.length || baseLines.rows.length !== rfqLines.rows.length
      || new Set(baseLines.rows.map((row) => row.award_line_id)).size !== baseLines.rows.length
      || new Set(baseLines.rows.map((row) => row.rfq_line_id)).size !== baseLines.rows.length
      || rfqLines.rows.some((row) => !baseLines.rows.some((line) => line.rfq_line_id === row.rfq_line_id))) {
      throw new ProcurementError("SOURCING_AWARD_LINE_SET_CONFLICT", "Award Line未完整且唯一覆盖RFQ Line", 409);
    }
    const actualLineIds = baseLines.rows.map((row) => row.award_line_id);
    if (JSON.stringify(actualLineIds) !== JSON.stringify(expected.expected_award_line_ids)) {
      throw new ProcurementError("SOURCING_AWARD_LINE_SET_CONFLICT", "Award Line集合与确认快照不一致", 409);
    }

    const downstream = (await client.query(`select count(distinct link.purchase_order_id)::int purchase_orders,
      count(distinct link.purchase_order_line_id)::int purchase_order_lines,
      count(distinct plan.id)::int delivery_plans
      from procurement_award_po_line_links link
      left join purchase_delivery_plans plan on plan.purchase_order_line_id=link.purchase_order_line_id
      where link.award_id=$1`, [awardId])).rows[0];
    if (Number(downstream.purchase_orders) !== expected.expected_po_count
      || Number(downstream.delivery_plans) !== expected.expected_delivery_plan_count) {
      throw new ProcurementError("AWARD_CONVERSION_CONFIRMATION_STALE", "PO或到货计划计数已变化，请重新打开确认窗口", 409);
    }
    if (Number(downstream.purchase_orders) !== 0 || Number(downstream.purchase_order_lines) !== 0) {
      throw new ProcurementError("SOURCING_AWARD_ALREADY_CONVERTED", "采购定标明细已经生成采购订单", 409);
    }

    const latestComparison = Number((await client.query(
      "select coalesce(max(comparison_version_no),0)::int value from procurement_quote_comparisons where rfq_id=$1",
      [expected.expected_rfq_id],
    )).rows[0].value);
    if (latestComparison !== expected.expected_comparison_version) {
      throw new ProcurementError("SOURCING_COMPARISON_VERSION_CONFLICT", "Comparison Version已变化", 409);
    }
    const result = await client.query<AwardLine>(`select al.id::text award_line_id,al.award_id::text award_id,
      al.rfq_line_id::text rfq_line_id,al.selected_quote_line_id::text selected_quote_line_id,
      al.comparison_id::text comparison_id,c.comparison_version_no::int comparison_version_no,
      candidate.id::text comparison_candidate_id,q.id::text quote_id,q.quote_version_no::int quote_version_no,
      al.supplier_id::text supplier_id,s.status supplier_status,rl.material_id::text material_id,
      material.material_status,rl.unit_id::text unit_id,unit.enabled unit_enabled,
      al.selected_quantity::text,al.selected_unit_price::text,al.promised_delivery_date::text,
      q.currency_code,q.status quote_status,q.valid_until::text,(q.valid_until>=current_date) quote_current,
      ql.material_id::text quote_material_id,ql.unit_id::text quote_unit_id,ql.quoted_quantity::text,
      ql.unit_price::text quote_unit_price,ql.promised_delivery_date::text quote_promised_delivery_date,
      candidate.currency_code candidate_currency_code,candidate.unit_price::text candidate_unit_price,
      candidate.promised_delivery_date::text candidate_promised_delivery_date,
      candidate.comparable_status candidate_status,candidate.awardable candidate_awardable
      from procurement_sourcing_award_lines al
      join procurement_sourcing_awards a on a.id=al.award_id
      join procurement_rfq_lines rl on rl.id=al.rfq_line_id and rl.rfq_id=a.rfq_id
      join material_master material on material.id=rl.material_id
      join units unit on unit.id=rl.unit_id
      join procurement_quote_comparisons c on c.id=al.comparison_id and c.rfq_id=a.rfq_id and c.rfq_line_id=al.rfq_line_id
      join procurement_quote_comparison_lines candidate on candidate.comparison_id=c.id
        and candidate.quote_line_id=al.selected_quote_line_id and candidate.supplier_id=al.supplier_id
      join procurement_supplier_quote_lines ql on ql.id=al.selected_quote_line_id
        and ql.rfq_line_id=al.rfq_line_id and ql.material_id=rl.material_id and ql.unit_id=rl.unit_id
      join procurement_supplier_quotes q on q.id=ql.quote_id and q.rfq_id=a.rfq_id and q.supplier_id=al.supplier_id
      join suppliers s on s.id=al.supplier_id
      where al.award_id=$1 order by al.id for update of al,q`, [awardId]);
    if (result.rows.length !== baseLines.rows.length) {
      throw new ProcurementError("SOURCING_AWARD_SOURCE_MISMATCH", "Award引用缺失、重复或跨越RFQ边界", 409);
    }
    for (const row of result.rows) {
      if (row.comparison_version_no !== expected.expected_comparison_version || row.quote_version_no < 1
        || row.quote_status !== "SUBMITTED" || !row.quote_current) {
        throw new ProcurementError("SOURCING_QUOTE_NOT_CURRENT", "选中报价或Comparison已失效、被替代或版本漂移", 409);
      }
      const sameNumeric = await client.query(`select
        $1::numeric=$2::numeric and $1::numeric=$3::numeric price_ok,
        $4::numeric=$5::numeric quantity_ok`, [row.selected_unit_price, row.quote_unit_price, row.candidate_unit_price, row.selected_quantity, row.quoted_quantity]);
      if (row.material_id !== row.quote_material_id || row.unit_id !== row.quote_unit_id
        || !sameNumeric.rows[0].price_ok || !sameNumeric.rows[0].quantity_ok
        || dateOnly(row.promised_delivery_date) !== dateOnly(row.quote_promised_delivery_date)
        || dateOnly(row.promised_delivery_date) !== dateOnly(row.candidate_promised_delivery_date)
        || row.currency_code !== row.candidate_currency_code || row.candidate_status !== "COMPARABLE" || !row.candidate_awardable) {
        throw new ProcurementError("SOURCING_AWARD_SOURCE_MISMATCH", "Award与Comparison/Quote的Supplier、Material、数量、单位、价格、币种或承诺交期不一致", 409);
      }
    }
    return result.rows;
  }

  private async createPlansInTransaction(client: PoolClient, purchaseOrder: Record<string, unknown>, rows: Array<Record<string, unknown>>, meta: ProcurementMeta) {
    const plans: Record<string, unknown>[] = [];
    for (const row of rows) {
      const plan = await client.query(`insert into purchase_delivery_plans(purchase_order_id,purchase_order_line_id,supplier_id,material_id,unit_id,planned_quantity,received_quantity,promised_delivery_date,status,created_by,updated_by,request_id)
        values($1,$2,$3,$4,$5,$6,0,$7,'PENDING',$8,$8,$9) returning *`, [String(purchaseOrder.id), String(row.id), String(purchaseOrder.supplier_id), String(row.material_id), String(row.unit_id), row.order_qty, row.promised_delivery_date, meta.actor.username, meta.requestId]);
      const planId = String(plan.rows[0].id);
      await client.query("insert into warehouse_receiving_queue_entries(delivery_plan_id,created_by,updated_by) values($1,$2,$2)", [planId, meta.actor.username]);
      await client.query("insert into purchase_delivery_plan_events(delivery_plan_id,from_status,to_status,event_type,actor,request_id) values($1,null,'PENDING','CREATED',$2,$3)", [planId, meta.actor.username, meta.requestId]);
      plans.push(plan.rows[0]);
    }
    return plans;
  }

  async convertAward(awardId: number, meta: ProcurementMeta, input: Record<string, unknown>): Promise<ProcurementResult> {
    return this.repository.execute(meta, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`SOURCING_AWARD_CONVERT:${awardId}`]);
      const transactionPreview = await this.conversionPreview(awardId, meta.actor, client);
      const expected = this.conversionAssertions(input, transactionPreview);
      const rows = await this.awardLines(client, awardId, expected);
      const mappingQualification = await loadAwardMappingQualification(client, awardId, { lock: true });
      const mappingFailure = firstAwardMappingQualificationFailure(mappingQualification);
      if (mappingFailure) throw new ProcurementError(mappingFailure.error_code || "AWARD_MAPPING_QUALIFICATION_FAILED", mappingFailure.reason, 422);
      if (mappingQualification.qualification_digest !== expected.expected_mapping_qualification_digest
        || mappingQualification.qualification_digest !== transactionPreview.mapping_qualification.qualification_digest) {
        throw new ProcurementError("AWARD_MAPPING_QUALIFICATION_DRIFT", "Award转PO固定Supplier Mapping资格在预览后发生漂移，请关闭后重新打开确认窗口", 409);
      }
      const qualificationByAwardLine = new Map(mappingQualification.lines.map((line) => [line.award_line_id, line]));
      const groups = new Map<string, AwardLine[]>();
      for (const row of rows) groups.set(`${row.supplier_id}:${row.currency_code}`, [...(groups.get(`${row.supplier_id}:${row.currency_code}`) ?? []), row]);
      const created: Record<string, unknown>[] = [];
      let purchaseOrderLineCount = 0; let deliveryPlanCount = 0;
      for (const group of [...groups.values()].sort((a, b) => `${a[0].supplier_id}:${a[0].currency_code}`.localeCompare(`${b[0].supplier_id}:${b[0].currency_code}`))) {
        if (new Set(group.map((row) => row.material_id)).size !== group.length) throw new ProcurementError("AWARD_CONVERSION_PO_MODEL_CONFLICT", "同一PO聚合包含重复Material", 409);
        const orderLines: PurchaseOrderLineInput[] = [];
        for (const row of group) {
          const qualification = qualificationByAwardLine.get(row.award_line_id);
          if (!qualification?.qualified || !qualification.mapping_fact_id) {
            throw new ProcurementError(qualification?.error_code || "AWARD_MAPPING_QUALIFICATION_FAILED", qualification?.reason || `Award Line ${row.award_line_id} 缺少固定Supplier Mapping资格`, 422);
          }
          orderLines.push({ materialId: row.material_id, unitId: row.unit_id, supplierMappingId: qualification.mapping_fact_id, orderQty: row.selected_quantity, unitPrice: row.selected_unit_price, remark: "采购定标转单" });
        }
        const promised = group.map((row) => dateOnly(row.promised_delivery_date)).sort().at(-1)!;
        const order = await this.procurement.createOrderInTransaction(client, meta, group[0].supplier_id, group[0].currency_code, "SOURCING_AWARD", new Date(`${promised}T00:00:00Z`), expected.remark, orderLines, undefined, mappingQualification.observed_at);
        const saved = order.lines as Record<string, unknown>[];
        for (let index = 0; index < group.length; index += 1) {
          const row = group[index], poLine = saved[index], qualification = qualificationByAwardLine.get(row.award_line_id)!;
          const sourceDigest = digest([awardId, row.award_line_id, qualification.rfq_binding_id, qualification.mapping_fact_id,
            qualification.mapping_uuid, qualification.mapping_version_no, qualification.mapping_row_cas, qualification.content_digest,
            order.id, poLine.id, row.supplier_id, row.material_id, row.unit_id, row.selected_quantity, row.selected_unit_price,
            row.currency_code, dateOnly(row.promised_delivery_date)]);
          await client.query(`insert into procurement_award_po_line_links(award_id,award_line_id,purchase_order_id,purchase_order_line_id,source_digest,operation_id,created_by,request_id)
            values($1,$2,$3,$4,$5,$6,$7,$8)`, [awardId, row.award_line_id, String(order.id), String(poLine.id), sourceDigest, meta.operationId, meta.actor.username, meta.requestId]);
          poLine.promised_delivery_date = dateOnly(row.promised_delivery_date);
        }
        await this.fault?.("after_award_po_links");
        const plans = await this.createPlansInTransaction(client, order, saved, meta);
        await this.fault?.("after_award_delivery_plans");
        purchaseOrderLineCount += saved.length; deliveryPlanCount += plans.length;
        created.push({ ...order, delivery_plans: plans });
      }
      return { status: 201, body: { ok: true, data: { award_id: awardId, purchase_orders: created, summary: {
        conversion_operation_count: 1,
        purchase_order_aggregate_count: created.length,
        purchase_order_line_count: purchaseOrderLineCount,
        delivery_plan_aggregate_count: deliveryPlanCount,
        delivery_plan_line_count: 0,
        receiving_queue_entry_count: deliveryPlanCount,
      } }, request_id: meta.requestId }, objectId: awardId };
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
    for (const field of ["received_at", "receipt_date", "actual_receipt_at", "actual_arrival_at", "browser_time"]) {
      if (field in input) throw new ProcurementError("RECEIPT_TIME_SERVER_CONTROLLED", "实际收货时间只能由服务端在最终过账时生成", 422);
    }
    exactKeys(input, [
      "quantity", "supplier_lot_code", "expected_purchase_order_version", "expected_version",
      "expected_line_version", "expected_queue_version", "expected_balance_version",
      "evidence_type", "evidence_reference", "evidence_document_date", "expected_early_arrival",
      "early_arrival_reason", "early_arrival_confirmed", "physical_receipt_confirmed",
      "expected_target_location_code", "reason",
    ]);
    const receiveQuantity = quantity(input.quantity, "quantity");
    const expectedPurchaseOrderVersion = version(input.expected_purchase_order_version, "expected_purchase_order_version");
    const expectedPlanVersion = version(input.expected_version, "expected_version");
    const expectedLineVersion = version(input.expected_line_version, "expected_line_version");
    const expectedQueueVersion = version(input.expected_queue_version, "expected_queue_version");
    const expectedBalanceVersion = version(input.expected_balance_version, "expected_balance_version");
    const normalizedSupplierLotCode = input.supplier_lot_code == null || String(input.supplier_lot_code).trim() === ""
      ? null : supplierLotCode(input.supplier_lot_code);
    const normalizedEvidenceType = evidenceType(input.evidence_type);
    const evidenceReference = text(input.evidence_reference, "送货凭证编号", 128, true);
    const evidenceDocumentDate = receiptEvidenceDate(input.evidence_document_date);
    const expectedEarlyArrival = strictBoolean(input.expected_early_arrival, "expected_early_arrival");
    const earlyArrivalReasonText = text(input.early_arrival_reason, "提前到货原因", 1000);
    const earlyArrivalReason = earlyArrivalReasonText || null;
    const earlyArrivalConfirmed = strictBoolean(input.early_arrival_confirmed, "early_arrival_confirmed");
    const physicalReceiptConfirmed = strictBoolean(input.physical_receipt_confirmed, "physical_receipt_confirmed");
    const expectedTargetLocationCode = String(input.expected_target_location_code ?? "");
    const reason = text(input.reason, "收货说明", 1000, true);
    if (!physicalReceiptConfirmed) {
      throw new ProcurementError("PHYSICAL_RECEIPT_CONFIRMATION_REQUIRED", "必须明确确认本次登记的是已实际到达MAIN库位的物理收货", 422);
    }
    if (expectedTargetLocationCode !== "MAIN") {
      throw new ProcurementError("RECEIPT_TARGET_LOCATION_CONFLICT", "目标库位已变化或不是当前唯一权威库位MAIN", 409);
    }
    return this.repository.execute(meta, async (client) => {
      const planResult = await client.query(`select plan.*,
          purchase_order.version purchase_order_version,purchase_order.status purchase_order_status,
          purchase_order_line.version purchase_order_line_version,purchase_order_line.status purchase_order_line_status,
          purchase_order_line.order_qty,purchase_order_line.received_qty,
          queue.id queue_id,queue.version queue_version,queue.closed_at,
          material.material_status,material.inventory_type,material.inspection_type,supplier.status supplier_status
        from purchase_delivery_plans plan
        join purchase_orders purchase_order on purchase_order.id=plan.purchase_order_id
        join purchase_order_lines purchase_order_line on purchase_order_line.id=plan.purchase_order_line_id
          and purchase_order_line.purchase_order_id=purchase_order.id
        join warehouse_receiving_queue_entries queue on queue.delivery_plan_id=plan.id
        join material_master material on material.id=plan.material_id and material.id=purchase_order_line.material_id
        join suppliers supplier on supplier.id=plan.supplier_id and supplier.id=purchase_order.supplier_id
        where plan.id=$1 for update of purchase_order,purchase_order_line,plan,queue`, [deliveryPlanId]);
      const plan = planResult.rows[0];
      if (!plan) throw new ProcurementError("DELIVERY_PLAN_NOT_FOUND", "到货计划不存在", 404);
      if (!["OPEN", "PARTIALLY_RECEIVED"].includes(String(plan.purchase_order_status))
          || Number(plan.purchase_order_version) !== expectedPurchaseOrderVersion) {
        throw new ProcurementError("PURCHASE_ORDER_VERSION_OR_STATE_CONFLICT", "采购订单版本已变化或当前状态不可收货", 409);
      }
      if (!["OPEN", "PARTIALLY_RECEIVED"].includes(String(plan.purchase_order_line_status))
          || Number(plan.purchase_order_line_version) !== expectedLineVersion) {
        throw new ProcurementError("PURCHASE_ORDER_LINE_VERSION_CONFLICT", "采购明细版本已变化或当前状态不可收货", 409);
      }
      if (!["PENDING", "PARTIAL"].includes(String(plan.status)) || Number(plan.version) !== expectedPlanVersion) {
        throw new ProcurementError("DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT", "到货计划版本已变化或当前状态不可收货", 409);
      }
      if (plan.closed_at != null || Number(plan.queue_version) !== expectedQueueVersion) {
        throw new ProcurementError("RECEIVING_QUEUE_VERSION_OR_STATE_CONFLICT", "待入库队列版本已变化或已经关闭", 409);
      }
      if (String(plan.supplier_status) !== "ACTIVE") throw new ProcurementError("SUPPLIER_NOT_ACTIVE", "供应商不存在或未启用，不能继续收货", 422);
      if (String(plan.material_status) !== "ACTIVE") throw new ProcurementError("MATERIAL_NOT_ACTIVE", "物料不存在或未启用，不能继续收货", 422);
      const allowed = await client.query("select $1::numeric<=least($2::numeric-$3::numeric,$4::numeric-$5::numeric) ok", [receiveQuantity, plan.planned_quantity, plan.received_quantity, plan.order_qty, plan.received_qty]);
      if (!allowed.rows[0].ok) throw new ProcurementError("PURCHASE_RECEIPT_OVER_QUANTITY", "收货数量超过到货计划未收数量", 409);
      const timing = (await client.query<{ receipt_date: string; early_arrival: boolean }>(`select
        (transaction_timestamp() at time zone 'Asia/Shanghai')::date::text receipt_date,
        ((transaction_timestamp() at time zone 'Asia/Shanghai')::date<$1::date) early_arrival`, [plan.promised_delivery_date])).rows[0];
      if (!timing) throw new ProcurementError("INTERNAL_ERROR", "服务器暂时无法生成权威收货时间", 500);
      assertReceiptEvidenceDateNotFuture(evidenceDocumentDate, timing.receipt_date);
      if (timing.early_arrival !== expectedEarlyArrival) {
        throw new ProcurementError("RECEIPT_CONFIRMATION_STALE", "提前到货判断已变化，请关闭后重新核对收货", 409);
      }
      if (timing.early_arrival && (!earlyArrivalReason || !earlyArrivalConfirmed)) {
        throw new ProcurementError("EARLY_ARRIVAL_EVIDENCE_REQUIRED", "提前到货必须填写可审计送货凭证、提前到货原因并明确确认", 422);
      }
      if (!timing.early_arrival && (earlyArrivalReason || earlyArrivalConfirmed)) {
        throw new ProcurementError("EARLY_ARRIVAL_EVIDENCE_NOT_APPLICABLE", "当前不是提前到货，请移除提前到货原因和确认", 422);
      }
      const receipt = await this.procurement.createReceiptInTransaction(client, meta, Number(plan.purchase_order_id), [{ purchaseOrderLineId: Number(plan.purchase_order_line_id), quantity: receiveQuantity, expectedLineVersion, expectedBalanceVersion, supplierLotCode: normalizedSupplierLotCode }], reason);
      const data = receipt.body.data as Record<string, unknown>, receiptLine = (data.lines as Record<string, unknown>[])[0];
      await client.query(`insert into purchase_receipt_delivery_allocations(purchase_receipt_line_id,delivery_plan_id,quantity,created_by,request_id) values($1,$2,$3,$4,$5)`, [Number(receiptLine.id), deliveryPlanId, receiveQuantity, meta.actor.username, meta.requestId]);
      await this.fault?.("after_receipt_allocation");
      const updated = await client.query(`update purchase_delivery_plans set received_quantity=received_quantity+$2::numeric,status=case when received_quantity+$2::numeric=planned_quantity then 'COMPLETED' else 'PARTIAL' end,
        version=version+1,updated_by=$3,updated_at=now() where id=$1 and version=$4 returning *`, [deliveryPlanId, receiveQuantity, meta.actor.username, expectedPlanVersion]);
      if (!updated.rows[0]) throw new ProcurementError("DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT", "到货计划版本已变化", 409);
      await client.query("insert into purchase_delivery_plan_events(delivery_plan_id,purchase_receipt_id,from_status,to_status,event_type,quantity,reason,actor,request_id) values($1,$2,$3,$4,'RECEIPT_POSTED',$5,$6,$7,$8)", [deliveryPlanId, Number(data.id), plan.status, updated.rows[0].status, receiveQuantity, reason, meta.actor.username, meta.requestId]);
      const queue = await client.query(`update warehouse_receiving_queue_entries set version=version+1,
          updated_by=$2,updated_at=now(),closed_by=case when $3::text='COMPLETED' then $2 else null end,
          closed_at=case when $3::text='COMPLETED' then now() else null end,
          close_reason=case when $3::text='COMPLETED' then '到货计划已完成' else '' end
        where id=$1 and version=$4 and closed_at is null returning *`, [Number(plan.queue_id), meta.actor.username, updated.rows[0].status, expectedQueueVersion]);
      if (!queue.rows[0]) throw new ProcurementError("RECEIVING_QUEUE_VERSION_OR_STATE_CONFLICT", "待入库队列版本已变化或已经关闭", 409);
      const evidence = await client.query(`insert into warehouse_receipt_evidence(
          purchase_receipt_id,purchase_receipt_line_id,delivery_plan_id,queue_entry_id,
          evidence_type,evidence_reference,evidence_document_date,early_arrival,early_arrival_reason,
          early_arrival_confirmed,physical_receipt_confirmed,target_location_code,
          expected_purchase_order_version,expected_purchase_order_line_version,expected_delivery_plan_version,
          expected_queue_version,expected_balance_version,created_by,request_id,created_at)
        select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'MAIN',$12,$13,$14,$15,$16,$17,$18,receipt.created_at
        from purchase_receipts receipt where receipt.id=$1 returning *`, [
        Number(data.id), Number(receiptLine.id), deliveryPlanId, Number(plan.queue_id), normalizedEvidenceType,
        evidenceReference, evidenceDocumentDate, timing.early_arrival, earlyArrivalReason,
        earlyArrivalConfirmed, physicalReceiptConfirmed, expectedPurchaseOrderVersion, expectedLineVersion,
        expectedPlanVersion, expectedQueueVersion, expectedBalanceVersion, meta.actor.username, meta.requestId,
      ]);
      if (!evidence.rows[0]) throw new ProcurementError("WAREHOUSE_RECEIPT_EVIDENCE_NOT_CREATED", "收货证据未能与收货单建立关系，已整体回滚", 409);
      await this.fault?.("after_receipt_evidence");
      return { ...receipt, body: { ...receipt.body, delivery_plan: updated.rows[0], receiving_queue: queue.rows[0], warehouse_receipt_evidence: evidence.rows[0] } };
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
    const reason = text(input.reason, "冲销原因", 1000, true), balances = expectedBalanceVersions(input.expected_balance_versions), expectedPlanVersion = version(input.expected_plan_version, "expected_plan_version"), expectedLotVersion = input.expected_lot_version == null ? null : version(input.expected_lot_version, "expected_lot_version");
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
      const result = await this.procurement.reverseReceiptInTransaction(client, receiptId, meta, reason, balances, lineVersions, expectedLotVersion);
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
