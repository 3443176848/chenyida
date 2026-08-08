import type { PoolClient } from "pg";
import { ProcurementError } from "../procurement-selfhost/errors.ts";
import { projectedQueueStatus } from "./purchase-order-history.ts";

type Row = Record<string, unknown>;

export type WarehouseReceiptReadiness = Readonly<{
  contract_version: "WAREHOUSE_RECEIPT_READINESS_V1";
  read_only: true;
  observed_at: string;
  data_timezone: "Asia/Shanghai";
  purchase_order: Readonly<{
    id: string;
    po_code: string;
    version: number;
    status: string;
    project: Readonly<{ id: string; code: string; name: string }>;
    supplier: Readonly<{ id: string; code: string; name: string }>;
    currency_code: string;
    tax_included: boolean;
    freight_included: boolean;
    payment_terms: string;
    commercial_terms_source: string;
    ordered_quantity: string;
    received_quantity: string;
    total_amount: string;
  }>;
  creation_evidence: Readonly<{
    actor: string;
    created_at_shanghai: string;
    request_id: string;
    operation_id: string;
    action: string;
    result: "SUCCESS";
  }>;
  lines: ReadonlyArray<Readonly<{
    purchase_order_line_id: string;
    line_no: number;
    version: number;
    status: string;
    award_line_id: string;
    material_id: string;
    material_code: string;
    material_name: string;
    quantity: string;
    received_quantity: string;
    remaining_quantity: string;
    unit_code: string;
    unit_price: string;
    line_amount: string;
    delivery_plan: Readonly<{
      id: string;
      version: number;
      status: string;
      planned_quantity: string;
      received_quantity: string;
      remaining_quantity: string;
      promised_delivery_date: string;
    }>;
    queue: Readonly<{ id: string; version: number; status: string }>;
  }>>;
  selected_receipt: Readonly<{
    delivery_plan_id: string;
    purchase_order_line_id: string;
    queue_id: string;
    server_time_shanghai: string;
    server_date_shanghai: string;
    promised_delivery_date: string;
    actual_receipt_time_rule: string;
    is_early_arrival: boolean;
    quantity: string | null;
    remaining_quantity: string;
    remaining_after_receipt: string | null;
    operator_username: string;
    supplier_lot: Readonly<{ applicability: "REQUIRED_FOR_IQC" | "NOT_APPLICABLE"; note: string }>;
    target: Readonly<{
      warehouse_model: "NOT_SEPARATELY_MODELED";
      warehouse_note: string;
      location_code: "MAIN";
      location_note: string;
    }>;
    authoritative_state_ready: boolean;
    initial_confirmation_blocked: true;
  }>;
  confirmation: Readonly<{
    expected_purchase_order_version: number;
    expected_line_version: number;
    expected_version: number;
    expected_queue_version: number;
    expected_balance_version: number;
    expected_early_arrival: boolean;
    expected_target_location_code: "MAIN";
  }>;
  downstream: Readonly<Record<string, number | boolean | string>>;
  receipt_accounting_boundary: Readonly<{
    physical_receipt_model: true;
    supplier_notification_or_in_transit_model_available: false;
    receipt_created_on_post: true;
    warehouse_receipt_model: string;
    iqc_material_internal_lot: string;
    iqc_material_inventory: string;
    available_inventory_rule: string;
    ledger_rule: string;
    next_responsibility: string;
    exceptions_are_separate_operations: string;
    no_automatic_records: readonly string[];
  }>;
  protected_boundaries: readonly string[];
  exposed_fields_note: string;
}>;

const inconsistent = () => new ProcurementError(
  "WAREHOUSE_RECEIPT_READINESS_INCONSISTENT",
  "仓库收货谱系、凭证或下游投影不完整，已停止展示且未修改任何数据",
  409,
);
const stableId = (value: unknown) => {
  const result = String(value ?? "");
  if (!/^[1-9]\d*$/.test(result)) throw inconsistent();
  return result;
};
const positiveInteger = (value: unknown) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw inconsistent();
  return result;
};
const nonNegativeInteger = (value: unknown) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw inconsistent();
  return result;
};
const requiredText = (value: unknown) => {
  const result = String(value ?? "");
  if (!result) throw inconsistent();
  return result;
};

function subtractDecimal(left: unknown, right: unknown) {
  const scaled = (value: unknown) => {
    const raw = String(value ?? "");
    if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) throw inconsistent();
    const [whole, fraction = ""] = raw.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  };
  const value = scaled(left) - scaled(right);
  if (value < 0n) throw new ProcurementError("PURCHASE_RECEIPT_OVER_QUANTITY", "收货数量超过到货计划未收数量", 409);
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, "0")}`;
}

export async function loadWarehouseReceiptReadiness(
  client: PoolClient,
  deliveryPlanId: number,
  actorUsername: string,
  quantity: string | null,
): Promise<WarehouseReceiptReadiness> {
  const exists = await client.query("select purchase_order_id from purchase_delivery_plans where id=$1", [deliveryPlanId]);
  if (!exists.rows[0]) throw new ProcurementError("DELIVERY_PLAN_NOT_FOUND", "到货计划不存在", 404);

  const selectedRows = await client.query<Row>(`select plan.id::text delivery_plan_id,
      plan.purchase_order_id::text purchase_order_id,plan.purchase_order_line_id::text purchase_order_line_id,
      plan.version::int plan_version,plan.status plan_status,plan.planned_quantity::text planned_quantity,
      plan.received_quantity::text plan_received_quantity,
      (plan.planned_quantity-plan.received_quantity)::text plan_remaining_quantity,
      plan.promised_delivery_date::text promised_delivery_date,
      queue.id::text queue_id,queue.version::int queue_version,queue.closed_at,
      purchase_order.po_code,purchase_order.version::int purchase_order_version,
      purchase_order.status purchase_order_status,purchase_order.supplier_id::text supplier_id,
      purchase_order.currency_code,purchase_order.created_by,
      to_char(purchase_order.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') purchase_order_created_at_shanghai,
      purchase_order.request_id::text purchase_order_request_id,
      purchase_order_line.line_no::int line_no,purchase_order_line.version::int purchase_order_line_version,
      purchase_order_line.status purchase_order_line_status,purchase_order_line.order_qty::text order_quantity,
      purchase_order_line.received_qty::text line_received_quantity,
      material.material_status,material.inventory_type,material.inspection_type,
      supplier.status supplier_status,
      case when material.material_status='ACTIVE' and material.inventory_type='STOCKED' and material.inspection_type='IQC'
        then 0 else coalesce(balance.version,0) end::int balance_version,
      to_char(observed.current_time at time zone 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US')||'+08:00' server_time_shanghai,
      (observed.current_time at time zone 'Asia/Shanghai')::date::text server_date_shanghai,
      ((observed.current_time at time zone 'Asia/Shanghai')::date<plan.promised_delivery_date) is_early_arrival
    from purchase_delivery_plans plan
    join warehouse_receiving_queue_entries queue on queue.delivery_plan_id=plan.id
    join purchase_orders purchase_order on purchase_order.id=plan.purchase_order_id
    join purchase_order_lines purchase_order_line on purchase_order_line.id=plan.purchase_order_line_id
      and purchase_order_line.purchase_order_id=purchase_order.id
    join procurement_award_po_line_links award_link
      on award_link.purchase_order_line_id=purchase_order_line.id and award_link.purchase_order_id=purchase_order.id
    join material_master material on material.id=plan.material_id and material.id=purchase_order_line.material_id
    join suppliers supplier on supplier.id=plan.supplier_id and supplier.id=purchase_order.supplier_id
    left join inventory_stock_balances balance on balance.material_id=plan.material_id
      and balance.unit_id=plan.unit_id and balance.location_code='MAIN' and balance.inventory_lot_id is null
    cross join lateral (select clock_timestamp() current_time) observed
    where plan.id=$1`, [deliveryPlanId]);
  if (selectedRows.rows.length !== 1) {
    throw new ProcurementError("PERMISSION_DENIED", "没有权限查看该到货计划及其采购数据域", 403);
  }
  const selected = selectedRows.rows[0];
  const purchaseOrderId = Number(selected.purchase_order_id);

  const sourceRows = await client.query<Row>(`select distinct project.id::text project_id,
      project.project_code,project.project_name,award.id::text award_id,
      quote.id::text quote_id,quote.quote_version_no::int quote_version,
      quote.payment_terms,quote.tax_included,quote.freight_included,quote.currency_code quote_currency_code,
      supplier.supplier_code,supplier.supplier_name,
      source.source_operation_id::text source_operation_id,
      audit.username audit_actor,audit.request_id::text audit_request_id,
      audit.operation_id::text audit_operation_id,audit.action,audit.result,
      to_char(audit.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') audit_created_at_shanghai,
      (select sum(line.order_qty)::text from purchase_order_lines line where line.purchase_order_id=$1) ordered_quantity,
      (select sum(line.received_qty)::text from purchase_order_lines line where line.purchase_order_id=$1) received_quantity,
      (select sum(line.order_qty*line.unit_price)::numeric(48,6)::text from purchase_order_lines line where line.purchase_order_id=$1) total_amount
    from purchase_order_source_links source
    join purchase_orders purchase_order on purchase_order.id=source.purchase_order_id
    join suppliers supplier on supplier.id=purchase_order.supplier_id
    join procurement_award_po_line_links award_link on award_link.purchase_order_id=purchase_order.id
    join procurement_sourcing_awards award on award.id=award_link.award_id
    join procurement_rfqs rfq on rfq.id=award.rfq_id
    join planning_purchase_requests purchase_request on purchase_request.id=rfq.purchase_request_id
    join planning_material_requirement_plans requirement_plan on requirement_plan.id=purchase_request.plan_id
    join business_projects project on project.id=requirement_plan.project_id
    join procurement_sourcing_award_lines award_line on award_line.id=award_link.award_line_id
    join procurement_supplier_quote_lines quote_line on quote_line.id=award_line.selected_quote_line_id
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
    join audit_log audit on audit.route_code='PROCUREMENT' and audit.action='SOURCING_AWARD_CONVERTED'
      and audit.result='success' and audit.detail->>'object_id'=award.id::text
    where source.purchase_order_id=$1 and source.source_type='SOURCING_AWARD'`, [purchaseOrderId]);
  if (sourceRows.rows.length !== 1) throw inconsistent();
  const source = sourceRows.rows[0];
  if (String(source.quote_currency_code) !== String(selected.currency_code)
      || String(source.audit_actor) !== String(selected.created_by)
      || String(source.audit_request_id) !== String(selected.purchase_order_request_id)
      || String(source.audit_operation_id) !== String(source.source_operation_id)
      || String(source.result) !== "success") throw inconsistent();

  const lineRows = await client.query<Row>(`select purchase_order_line.id::text purchase_order_line_id,
      purchase_order_line.line_no::int line_no,purchase_order_line.version::int line_version,
      purchase_order_line.status line_status,award_link.award_line_id::text award_line_id,
      purchase_order_line.material_id::text material_id,material.internal_material_code material_code,
      material.standard_name material_name,purchase_order_line.order_qty::text quantity,
      purchase_order_line.received_qty::text received_quantity,
      (purchase_order_line.order_qty-purchase_order_line.received_qty)::text remaining_quantity,
      unit.code unit_code,purchase_order_line.unit_price::text unit_price,
      (purchase_order_line.order_qty*purchase_order_line.unit_price)::numeric(48,6)::text line_amount,
      plan.id::text delivery_plan_id,plan.version::int plan_version,plan.status plan_status,
      plan.planned_quantity::text planned_quantity,plan.received_quantity::text plan_received_quantity,
      (plan.planned_quantity-plan.received_quantity)::text plan_remaining_quantity,
      plan.promised_delivery_date::text promised_delivery_date,
      queue.id::text queue_id,queue.version::int queue_version,queue.closed_at
    from purchase_order_lines purchase_order_line
    join procurement_award_po_line_links award_link
      on award_link.purchase_order_line_id=purchase_order_line.id and award_link.purchase_order_id=purchase_order_line.purchase_order_id
    join material_master material on material.id=purchase_order_line.material_id
    join units unit on unit.id=purchase_order_line.unit_id
    join purchase_delivery_plans plan on plan.purchase_order_line_id=purchase_order_line.id
      and plan.purchase_order_id=purchase_order_line.purchase_order_id
    join warehouse_receiving_queue_entries queue on queue.delivery_plan_id=plan.id
    where purchase_order_line.purchase_order_id=$1 order by purchase_order_line.line_no,purchase_order_line.id`, [purchaseOrderId]);
  if (!lineRows.rows.length || lineRows.rows.filter((row) => Number(row.delivery_plan_id) === deliveryPlanId).length !== 1) throw inconsistent();
  const lines = lineRows.rows.map((row) => ({
    purchase_order_line_id: stableId(row.purchase_order_line_id),
    line_no: positiveInteger(row.line_no),
    version: positiveInteger(row.line_version),
    status: requiredText(row.line_status),
    award_line_id: stableId(row.award_line_id),
    material_id: stableId(row.material_id),
    material_code: requiredText(row.material_code),
    material_name: requiredText(row.material_name),
    quantity: requiredText(row.quantity),
    received_quantity: requiredText(row.received_quantity),
    remaining_quantity: requiredText(row.remaining_quantity),
    unit_code: requiredText(row.unit_code),
    unit_price: requiredText(row.unit_price),
    line_amount: requiredText(row.line_amount),
    delivery_plan: {
      id: stableId(row.delivery_plan_id),
      version: positiveInteger(row.plan_version),
      status: requiredText(row.plan_status),
      planned_quantity: requiredText(row.planned_quantity),
      received_quantity: requiredText(row.plan_received_quantity),
      remaining_quantity: requiredText(row.plan_remaining_quantity),
      promised_delivery_date: requiredText(row.promised_delivery_date),
    },
    queue: {
      id: stableId(row.queue_id),
      version: positiveInteger(row.queue_version),
      status: projectedQueueStatus(String(row.plan_status), row.closed_at),
    },
  }));

  const downstreamRows = await client.query<Row>(`with target_receipts as (
      select receipt.* from purchase_receipts receipt
      where receipt.purchase_order_id=$1 and receipt.receipt_type='RECEIPT'
    ), target_receipt_lines as (
      select line.* from purchase_receipt_lines line
      join target_receipts receipt on receipt.id=line.purchase_receipt_id
    ), target_sources as (
      select source.* from purchase_financial_source_entries source
      join target_receipts receipt on receipt.id=source.purchase_receipt_id
    ), target_ap as (
      select document.* from finance_documents document
      join target_sources source on source.id=document.purchase_source_entry_id where document.doc_type='AP'
    ), target_work_orders as (
      select distinct work_order.* from production_work_orders work_order
      join production_handoff_work_order_links link on link.work_order_id=work_order.id
      join production_handoff_items item on item.id=link.handoff_item_id
      join production_handoffs handoff on handoff.id=item.handoff_id
      join project_planning_packages package on package.id=handoff.planning_package_id
      where package.project_id=$2
    ) select
      (select count(*)::int from target_receipts) receipt,
      (select count(*)::int from target_receipt_lines) warehouse_receipt,
      (select count(*)::int from inventory_ledger_entries ledger join target_receipt_lines line on line.inventory_ledger_entry_id=ledger.id) inventory_ledger,
      (select count(*)::int from inventory_lots lot join target_receipt_lines line on line.id=lot.source_purchase_receipt_line_id) lot,
      (select count(*)::int from quality_inspections inspection join target_receipt_lines line on line.id=inspection.purchase_receipt_line_id where inspection.inspection_type='IQC') iqc,
      (select count(*)::int from target_sources) purchase_financial_source,
      (select count(*)::int from target_ap) ap,
      (select count(*)::int from finance_settlements settlement join target_ap document on document.id=settlement.document_id) payment,
      (select count(*)::int from target_work_orders) work_order,
      (select count(*)::int from production_reports report join target_work_orders work_order on work_order.id=report.work_order_id) production_report,
      (select count(*)::int from production_completions completion join target_work_orders work_order on work_order.id=completion.work_order_id) production_completion`, [purchaseOrderId, source.project_id]);
  const rawDownstream = downstreamRows.rows[0];
  if (!rawDownstream) throw inconsistent();
  const downstreamCounts = Object.fromEntries(Object.entries(rawDownstream).map(([key, value]) => [key, nonNegativeInteger(value)]));
  const allZero = Object.values(downstreamCounts).every((value) => value === 0);

  const isEarlyArrival = selected.is_early_arrival === true;
  const remaining = requiredText(selected.plan_remaining_quantity);
  const authoritativeStateReady = ["OPEN", "PARTIALLY_RECEIVED"].includes(String(selected.purchase_order_status))
    && ["OPEN", "PARTIALLY_RECEIVED"].includes(String(selected.purchase_order_line_status))
    && ["PENDING", "PARTIAL"].includes(String(selected.plan_status))
    && selected.closed_at == null && String(selected.supplier_status) === "ACTIVE"
    && String(selected.material_status) === "ACTIVE" && subtractDecimal(remaining, "0") !== "0.000000";
  const inventoryType = requiredText(selected.inventory_type);
  const inspectionType = requiredText(selected.inspection_type);
  const iqcManaged = inventoryType === "STOCKED" && inspectionType === "IQC";

  return {
    contract_version: "WAREHOUSE_RECEIPT_READINESS_V1",
    read_only: true,
    observed_at: requiredText(selected.server_time_shanghai),
    data_timezone: "Asia/Shanghai",
    purchase_order: {
      id: stableId(selected.purchase_order_id), po_code: requiredText(selected.po_code),
      version: positiveInteger(selected.purchase_order_version), status: requiredText(selected.purchase_order_status),
      project: { id: stableId(source.project_id), code: requiredText(source.project_code), name: requiredText(source.project_name) },
      supplier: { id: stableId(selected.supplier_id), code: requiredText(source.supplier_code), name: requiredText(source.supplier_name) },
      currency_code: requiredText(selected.currency_code), tax_included: source.tax_included === true,
      freight_included: source.freight_included === true, payment_terms: requiredText(source.payment_terms),
      commercial_terms_source: `Quote ${stableId(source.quote_id)}/v${positiveInteger(source.quote_version)}`,
      ordered_quantity: requiredText(source.ordered_quantity), received_quantity: requiredText(source.received_quantity),
      total_amount: requiredText(source.total_amount),
    },
    creation_evidence: {
      actor: requiredText(selected.created_by), created_at_shanghai: requiredText(selected.purchase_order_created_at_shanghai),
      request_id: requiredText(selected.purchase_order_request_id), operation_id: requiredText(source.audit_operation_id),
      action: requiredText(source.action), result: "SUCCESS",
    },
    lines,
    selected_receipt: {
      delivery_plan_id: stableId(selected.delivery_plan_id), purchase_order_line_id: stableId(selected.purchase_order_line_id),
      queue_id: stableId(selected.queue_id), server_time_shanghai: requiredText(selected.server_time_shanghai),
      server_date_shanghai: requiredText(selected.server_date_shanghai), promised_delivery_date: requiredText(selected.promised_delivery_date),
      actual_receipt_time_rule: "最终过账时由PostgreSQL服务端生成purchase_receipts.created_at；不接受浏览器日期，也不会用计划日期冒充实际到货时间。",
      is_early_arrival: isEarlyArrival, quantity, remaining_quantity: remaining,
      remaining_after_receipt: quantity === null ? null : subtractDecimal(remaining, quantity), operator_username: actorUsername,
      supplier_lot: iqcManaged
        ? { applicability: "REQUIRED_FOR_IQC", note: "该物料为STOCKED/IQC；供应商批次必填，服务端另生成唯一内部RML Lot。" }
        : { applicability: "NOT_APPLICABLE", note: "该物料不适用Supplier Receipt RML Lot；不得伪造供应商批次。" },
      target: {
        warehouse_model: "NOT_SEPARATELY_MODELED", warehouse_note: "当前Inventory没有独立仓库维度，不伪造仓库主数据。",
        location_code: "MAIN", location_note: "当前Inventory唯一权威库位固定为MAIN。",
      },
      authoritative_state_ready: authoritativeStateReady, initial_confirmation_blocked: true,
    },
    confirmation: {
      expected_purchase_order_version: positiveInteger(selected.purchase_order_version),
      expected_line_version: positiveInteger(selected.purchase_order_line_version),
      expected_version: positiveInteger(selected.plan_version), expected_queue_version: positiveInteger(selected.queue_version),
      expected_balance_version: nonNegativeInteger(selected.balance_version), expected_early_arrival: isEarlyArrival,
      expected_target_location_code: "MAIN",
    },
    downstream: {
      ...downstreamCounts, all_zero: allZero,
      scope_note: "Receipt、Receipt Line、Ledger、Lot、IQC与AP沿稳定外键计数；Work Order与生产记录仅按同Project计数，不宣称由收货自动产生。",
    },
    receipt_accounting_boundary: {
      physical_receipt_model: true, supplier_notification_or_in_transit_model_available: false,
      receipt_created_on_post: true,
      warehouse_receipt_model: "系统创建Purchase Receipt及Receipt Line；没有独立的Warehouse Receipt聚合表。",
      iqc_material_internal_lot: iqcManaged
        ? "当前选中物料为ACTIVE/STOCKED/IQC；收货事务创建唯一内部RML Lot，初始状态FROZEN。"
        : `当前选中物料为ACTIVE/${inventoryType}/${inspectionType}，未启用IQC Lot模式；收货不创建内部RML Lot，Supplier批次不适用。`,
      iqc_material_inventory: iqcManaged
        ? "当前选中物料收货时立即增加on-hand与frozen，available保持0。"
        : "当前选中物料按普通RECEIPT入账，不创建IQC冻结；on-hand增加且available按余额公式立即重算。",
      available_inventory_rule: iqcManaged
        ? "quality角色完成IQC合格放行并追加UNFREEZE Ledger后，可用库存才增加。"
        : "当前选中物料不等待IQC放行；普通RECEIPT事务完成后即可按on-hand、reserved与frozen的权威余额计算可用量。",
      ledger_rule: iqcManaged
        ? "Inventory Ledger在实际收货事务中产生，不等待IQC；IQC后续只对合格量追加解冻账。"
        : "Inventory Ledger在实际收货事务中以普通RECEIPT产生；当前物料没有后续IQC解冻账。",
      next_responsibility: iqcManaged
        ? "收货后下一责任队列属于quality；warehouse没有IQC检验、处置或关闭写权限。"
        : "当前选中物料不创建供应商来料IQC责任队列；若物料权威配置为IQC，检验、处置和关闭只能由quality负责，warehouse无写权限。",
      exceptions_are_separate_operations: "不合格、退货与让步接收均为独立受控操作，本次收货不会自动执行。",
      no_automatic_records: ["AP", "Payment", "Work Order", "Production Issue", "Production Report", "Production Completion"],
    },
    protected_boundaries: [
      "PO OPEN不代表已到货。", "Plan PENDING不代表已收货。", "queue OPEN_PENDING不代表库存增加。",
      "本模型登记实际物理收货，不是供应商通知或在途登记；当前没有独立通知/在途模型。",
      "打开、取消、关闭本确认预览不会发送业务POST。",
    ],
    exposed_fields_note: "DTO不返回请求正文、响应正文、Cookie、Session、敏感Header、幂等Key摘要或通用审计详情；warehouse无需且未获得system.audit.read。",
  };
}
