import type { PoolClient } from "pg";
import { ProcurementError } from "../procurement-selfhost/errors.ts";
import type { RfqDetailDto } from "../procurement-sourcing-selfhost/types.ts";

type Row = Record<string, unknown>;

type DownstreamProjection = Readonly<{
  receipt: number;
  warehouse_receipt: number;
  delivery_allocation: number;
  inventory_adjustment: number;
  inventory_ledger: number;
  lot: number;
  iqc: number;
  purchase_financial_source: number;
  finance_project_allocation: number;
  ap: number;
  payment: number;
  work_order: number;
  handoff_work_order_link: number;
  production_report: number;
  production_completion: number;
  all_zero: boolean;
  scope_note: string;
}>;

export type PurchaseOrderHistoryReadModel = Readonly<{
  contract_version: "PO_HISTORY_TRACEABILITY_V1";
  read_only: true;
  observed_at: string;
  data_timezone: "Asia/Shanghai";
  governance_boundary: Readonly<{
    authorization_verified: false;
    note: string;
  }>;
  purchase_order: Readonly<{
    purchase_order_id: string;
    po_code: string;
    version: number;
    status: string;
    status_label: string;
    supplier_id: string;
    supplier_code: string;
    supplier_name: string;
    currency_code: string;
    tax_included: boolean;
    tax_label: string;
    freight_included: boolean;
    freight_label: string;
    payment_terms: string;
    commercial_terms_source: string;
    ordered_quantity: string;
    received_quantity: string;
    unit_code: string;
    total_amount: string;
    remark: string;
    created_by: string;
    created_at_shanghai: string;
    request_id: string;
    po_operation_id: string;
    conversion_operation_id: string;
    conversion_action: string;
    po_convertible_now: boolean;
  }>;
  lineage: Readonly<{
    project: Readonly<{ id: string; code: string; name: string }>;
    material_requirement_plan: Readonly<{ id: string; version: number; status: string }>;
    purchase_request: Readonly<{ id: string; code: string; version: number; status: string }>;
    rfq: Readonly<{ id: string; code: string; round_no: number; version: number; status: string }>;
    comparison: Readonly<{ version: number; status: string }>;
    quote: Readonly<{ id: string; version: number }>;
    award: Readonly<{ id: string; version: number; status: string }>;
    purchase_order: Readonly<{ id: string; version: number; status: string }>;
  }>;
  digests: Readonly<{
    comparison_output_digest: string;
    persisted_award_digest: string;
    derived_award_decision_digest: string;
    derived_award_decision_rule: string;
  }>;
  supplier_summaries: Array<Readonly<{
    label: string;
    supplier_id: string;
    supplier_code: string;
    supplier_name: string;
    line_count: number;
    total_amount: string;
    currency_code: string;
  }>>;
  lines: Array<Readonly<{
    purchase_order_line_id: string;
    line_no: number;
    version: number;
    status: string;
    award_line_id: string;
    comparison_line_id: string;
    candidate_id: string;
    quote_id: string;
    quote_version: number;
    quote_line_id: string;
    binding_id: string;
    supplier_label: string;
    supplier_id: string;
    supplier_code: string;
    supplier_name: string;
    material_id: string;
    material_code: string;
    material_name: string;
    mapping_fact_id: string;
    mapping_uuid: string;
    mapping_version: number;
    mapping_row_cas: number;
    quantity: string;
    received_quantity: string;
    unit_code: string;
    unit_price: string;
    line_amount: string;
    currency_code: string;
    planned_delivery_date: string;
  }>>;
  line_summary: Readonly<{
    line_count: number;
    duplicate_material: boolean;
    duplicate_material_note: string;
  }>;
  delivery_model: Readonly<{
    has_independent_delivery_plan_line: false;
    note: string;
  }>;
  delivery_plans: Array<Readonly<{
    delivery_plan_id: string;
    status: string;
    status_label: string;
    version: number;
    purchase_order_id: string;
    purchase_order_line_id: string;
    award_line_id: string;
    material_id: string;
    material_code: string;
    material_name: string;
    quantity: string;
    received_quantity: string;
    unit_code: string;
    planned_delivery_date: string;
    actor: string;
    occurred_at_shanghai: string;
    request_id: string;
    plan_event_id: string;
    plan_event_type: string;
    queue_id: string;
    queue_status: string;
    queue_status_label: string;
    queue_version: number;
  }>>;
  credentials: Readonly<{
    purchase_order_event: Readonly<{
      event_id: string;
      event_type: string;
      from_status: null;
      to_status: string;
      actor: string;
      occurred_at_shanghai: string;
      request_id: string;
      result: "SUCCESS";
      result_source: string;
    }>;
    audit: Readonly<{
      audit_id: string;
      action: string;
      result: "SUCCESS";
      actor: string;
      occurred_at_shanghai: string;
      request_id: string;
      operation_id: string;
    }>;
    idempotency: Readonly<{
      http_status: number;
      key_digest: string;
      request_digest: string;
      created_at_shanghai: string;
      exposed_fields_note: string;
    }>;
    historical_failed_attempt: Readonly<{
      available: boolean;
      relation: "UNBOUND_PRIOR_ATTEMPT";
      note: string;
      audit_id?: string;
      request_id?: string;
      result?: "FAILED";
      error_code?: string;
      http_status?: number | null;
      http_status_source?: string;
      business_record_count?: number;
    }>;
  }>;
  downstream: DownstreamProjection;
  protected_boundaries: readonly string[];
}>;

const SCALE = 1_000_000n;
const DECIMAL = /^\d+(?:\.\d{1,6})?$/;

const inconsistent = () => new ProcurementError(
  "PURCHASE_ORDER_HISTORY_INCONSISTENT",
  "采购订单历史引用、凭证或下游投影不完整，已停止展示且未修改任何数据",
  409,
);

function stableId(value: unknown) {
  const result = String(value ?? "");
  if (!/^[1-9]\d*$/.test(result)) throw inconsistent();
  return result;
}

function positiveInteger(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw inconsistent();
  return result;
}

function nonNegativeInteger(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw inconsistent();
  return result;
}

function requiredText(value: unknown) {
  const result = String(value ?? "");
  if (!result) throw inconsistent();
  return result;
}

function sha256(value: unknown) {
  const result = requiredText(value);
  if (!/^[0-9a-f]{64}$/.test(result)) throw inconsistent();
  return result;
}

function decimalScaled(value: unknown) {
  const raw = String(value ?? "");
  if (!DECIMAL.test(raw)) throw inconsistent();
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function decimal(value: bigint) {
  return `${value / SCALE}.${String(value % SCALE).padStart(6, "0")}`;
}

function lineAmount(quantity: unknown, unitPrice: unknown) {
  return decimal((decimalScaled(quantity) * decimalScaled(unitPrice) + SCALE / 2n) / SCALE);
}

export function supplierSequenceLabel(index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 26) return `Supplier ${index + 1}`;
  return `Supplier ${String.fromCharCode(65 + index)}`;
}

export function projectedQueueStatus(planStatus: string, closedAt: unknown) {
  if (closedAt === null || closedAt === undefined || closedAt === "") {
    return ["PENDING", "PARTIAL"].includes(planStatus) ? "OPEN_PENDING" : "OPEN";
  }
  return "CLOSED";
}

export function legacyConversionHttpStatus(errorCode: string) {
  // This status is a projection of the historical API contract, not an audit_log column.
  return errorCode === "AWARD_SUPPLIER_MAPPING_NOT_UNIQUE"
    ? { http_status: 422, source: "LEGACY_ERROR_CONTRACT" as const }
    : { http_status: null, source: "UNAVAILABLE" as const };
}

function sameInstant(left: unknown, right: unknown) {
  const a = new Date(String(left ?? "")).valueOf();
  const b = new Date(String(right ?? "")).valueOf();
  return Number.isFinite(a) && a === b;
}

export async function loadPurchaseOrderHistory(
  client: PoolClient,
  purchaseOrderId: number,
  sourcingDetail: RfqDetailDto,
): Promise<PurchaseOrderHistoryReadModel> {
  const awardHistory = sourcingDetail.award_history;
  if (!awardHistory) throw inconsistent();

  const headers = await client.query<Row>(`select po.id::text purchase_order_id,po.po_code,po.version::int po_version,
      po.status po_status,po.supplier_id::text supplier_id,supplier.supplier_code,supplier.supplier_name,
      to_char(transaction_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US')||'+08:00' observed_at,
      po.currency_code,po.remark,po.created_by,
      to_char(po.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at_shanghai,
      po.created_at,po.request_id::text request_id,po.operation_id::text po_operation_id,
      source.id::text source_link_id,source.source_type,source.source_operation_id::text conversion_operation_id,
      award.id::text award_id,award.version::int award_version,award.status award_status,award.selected_at,
      rfq.id::text rfq_id,rfq.rfq_code,rfq.round_no::int round_no,rfq.version::int rfq_version,rfq.status rfq_status,
      prq.id::text prq_id,prq.request_code,prq.version::int prq_version,prq.status prq_status,
      mrp.id::text mrp_id,mrp.plan_version_no::int mrp_version,mrp.status mrp_status,
      project.id::text project_id,project.project_code,project.project_name,
      count(distinct link.award_id)::int source_award_count,
      count(distinct link.award_line_id)::int linked_award_line_count,
      count(distinct link.purchase_order_line_id)::int linked_po_line_count
    from purchase_orders po
    join suppliers supplier on supplier.id=po.supplier_id
    join purchase_order_source_links source on source.purchase_order_id=po.id and source.source_type='SOURCING_AWARD'
    join procurement_award_po_line_links link on link.purchase_order_id=po.id
    join procurement_sourcing_awards award on award.id=link.award_id
    join procurement_rfqs rfq on rfq.id=award.rfq_id
    join planning_purchase_requests prq on prq.id=rfq.purchase_request_id
    join planning_material_requirement_plans mrp on mrp.id=prq.plan_id
    join business_projects project on project.id=mrp.project_id
    where po.id=$1
    group by po.id,supplier.id,source.id,award.id,rfq.id,prq.id,mrp.id,project.id`, [purchaseOrderId]);
  if (headers.rows.length !== 1) throw inconsistent();
  const header = headers.rows[0];
  if (Number(header.source_award_count) !== 1
    || Number(header.linked_award_line_count) !== Number(header.linked_po_line_count)
    || stableId(header.award_id) !== awardHistory.identity.award_id
    || stableId(header.rfq_id) !== awardHistory.identity.rfq_id) throw inconsistent();

  const commercialRows = await client.query<Row>(`select distinct quote.id::text quote_id,
      quote.quote_version_no::int quote_version,quote.payment_terms,quote.tax_included,quote.freight_included,
      quote.currency_code
    from procurement_award_po_line_links link
    join procurement_sourcing_award_lines award_line on award_line.id=link.award_line_id
    join procurement_supplier_quote_lines quote_line on quote_line.id=award_line.selected_quote_line_id
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id
    where link.purchase_order_id=$1 order by quote_id`, [purchaseOrderId]);
  if (commercialRows.rows.length !== 1) throw inconsistent();
  const commercial = commercialRows.rows[0];

  const lineRows = await client.query<Row>(`select po_line.id::text purchase_order_line_id,
      po_line.line_no::int line_no,po_line.version::int po_line_version,po_line.status po_line_status,
      po_line.material_id::text material_id,material.internal_material_code material_code,
      material.standard_name material_name,unit.code unit_code,po_line.order_qty::text quantity,
      po_line.received_qty::text received_quantity,po_line.unit_price::text unit_price,
      (po_line.order_qty*po_line.unit_price)::numeric(30,6)::text line_amount,
      award_line.id::text award_line_id,award_line.comparison_id::text comparison_line_id,
      candidate.id::text candidate_id,quote.id::text quote_id,quote.quote_version_no::int quote_version,
      quote_line.id::text quote_line_id,binding.id::text binding_id,
      binding.supplier_mapping_version_id::text mapping_fact_id,binding.mapping_uid::text mapping_uuid,
      binding.mapping_version_no::int mapping_version,binding.mapping_row_version::int mapping_row_cas,
      po_line.supplier_mapping_id::text po_mapping_fact_id,
      award_line.supplier_id::text supplier_id,supplier.supplier_code,supplier.supplier_name,
      award_line.promised_delivery_date::text planned_delivery_date,po.currency_code,
      link.operation_id::text conversion_operation_id,link.request_id::text link_request_id
    from purchase_order_lines po_line
    join purchase_orders po on po.id=po_line.purchase_order_id
    join procurement_award_po_line_links link on link.purchase_order_line_id=po_line.id and link.purchase_order_id=po.id
    join procurement_sourcing_award_lines award_line on award_line.id=link.award_line_id and award_line.award_id=link.award_id
    join procurement_sourcing_awards award on award.id=award_line.award_id
    join procurement_quote_comparison_lines candidate on candidate.comparison_id=award_line.comparison_id
      and candidate.quote_line_id=award_line.selected_quote_line_id and candidate.supplier_id=award_line.supplier_id
    join procurement_supplier_quote_lines quote_line on quote_line.id=award_line.selected_quote_line_id
      and quote_line.rfq_line_id=award_line.rfq_line_id
    join procurement_supplier_quotes quote on quote.id=quote_line.quote_id and quote.rfq_id=award.rfq_id
      and quote.supplier_id=award_line.supplier_id
    join procurement_rfq_supplier_line_mapping_bindings binding on binding.rfq_id=award.rfq_id
      and binding.rfq_line_id=award_line.rfq_line_id and binding.supplier_id=award_line.supplier_id
    join supplier_mappings mapping on mapping.id=binding.supplier_mapping_version_id
      and mapping.mapping_uid=binding.mapping_uid and mapping.mapping_version_no=binding.mapping_version_no
    join material_master material on material.id=po_line.material_id and material.id=binding.material_id
    join units unit on unit.id=po_line.unit_id and unit.id=binding.purchase_unit_id
    join suppliers supplier on supplier.id=award_line.supplier_id and supplier.id=po.supplier_id
    where po_line.purchase_order_id=$1 order by po_line.line_no,po_line.id`, [purchaseOrderId]);
  if (!lineRows.rows.length || lineRows.rows.length !== Number(header.linked_po_line_count)) throw inconsistent();

  const supplierLabels = new Map(awardHistory.summary.supplier_summaries.map((supplier, index) => [supplier.supplier_id, supplierSequenceLabel(index)]));
  const awardLines = new Map(awardHistory.lines.map((line) => [line.award_line_id, line]));
  const operationIds = new Set<string>();
  const materialIds = new Set<string>();
  let ordered = 0n;
  let received = 0n;
  let total = 0n;
  const lines = lineRows.rows.map((row) => {
    const awardLineId = stableId(row.award_line_id);
    const awardLine = awardLines.get(awardLineId);
    if (!awardLine
      || stableId(row.material_id) !== awardLine.material_id
      || stableId(row.comparison_line_id) !== awardLine.comparison_line_id
      || stableId(row.candidate_id) !== awardLine.comparison_candidate_id
      || stableId(row.quote_line_id) !== awardLine.quote_line_id
      || stableId(row.quote_id) !== awardLine.quote_id
      || positiveInteger(row.quote_version) !== awardLine.quote_version_no
      || stableId(row.supplier_id) !== awardLine.supplier_id
      || stableId(row.po_mapping_fact_id) !== stableId(row.mapping_fact_id)
      || String(row.line_amount) !== lineAmount(row.quantity, row.unit_price)
      || String(row.currency_code) !== String(header.currency_code)
      || String(row.link_request_id) !== String(header.request_id)) throw inconsistent();
    const materialId = stableId(row.material_id);
    materialIds.add(materialId);
    operationIds.add(requiredText(row.conversion_operation_id));
    ordered += decimalScaled(row.quantity);
    received += decimalScaled(row.received_quantity);
    total += decimalScaled(row.line_amount);
    return {
      purchase_order_line_id: stableId(row.purchase_order_line_id),
      line_no: positiveInteger(row.line_no),
      version: positiveInteger(row.po_line_version),
      status: requiredText(row.po_line_status),
      award_line_id: awardLineId,
      comparison_line_id: stableId(row.comparison_line_id),
      candidate_id: stableId(row.candidate_id),
      quote_id: stableId(row.quote_id),
      quote_version: positiveInteger(row.quote_version),
      quote_line_id: stableId(row.quote_line_id),
      binding_id: stableId(row.binding_id),
      supplier_label: supplierLabels.get(stableId(row.supplier_id)) || "Supplier",
      supplier_id: stableId(row.supplier_id),
      supplier_code: requiredText(row.supplier_code),
      supplier_name: requiredText(row.supplier_name),
      material_id: materialId,
      material_code: requiredText(row.material_code),
      material_name: requiredText(row.material_name),
      mapping_fact_id: stableId(row.mapping_fact_id),
      mapping_uuid: requiredText(row.mapping_uuid),
      mapping_version: positiveInteger(row.mapping_version),
      mapping_row_cas: positiveInteger(row.mapping_row_cas),
      quantity: String(row.quantity),
      received_quantity: String(row.received_quantity),
      unit_code: requiredText(row.unit_code),
      unit_price: String(row.unit_price),
      line_amount: String(row.line_amount),
      currency_code: requiredText(row.currency_code),
      planned_delivery_date: requiredText(row.planned_delivery_date),
    };
  });
  if (operationIds.size !== 1 || [...operationIds][0] !== String(header.conversion_operation_id)) throw inconsistent();

  const planRows = await client.query<Row>(`select plan.id::text delivery_plan_id,plan.status plan_status,
      plan.version::int plan_version,plan.purchase_order_id::text purchase_order_id,
      plan.purchase_order_line_id::text purchase_order_line_id,link.award_line_id::text award_line_id,
      plan.material_id::text material_id,material.internal_material_code material_code,
      material.standard_name material_name,plan.planned_quantity::text quantity,
      plan.received_quantity::text received_quantity,unit.code unit_code,
      plan.promised_delivery_date::text planned_delivery_date,plan.created_by actor,
      to_char(plan.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai,
      plan.request_id::text request_id,event.id::text plan_event_id,event.event_type plan_event_type,
      event.actor event_actor,event.request_id::text event_request_id,
      to_char(event.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') event_at_shanghai,
      event.created_event_count::int created_event_count,queue.id::text queue_id,
      queue.version::int queue_version,queue.closed_at,queue.queue_count::int queue_count
    from purchase_delivery_plans plan
    join purchase_order_lines po_line on po_line.id=plan.purchase_order_line_id and po_line.purchase_order_id=plan.purchase_order_id
    join procurement_award_po_line_links link on link.purchase_order_line_id=po_line.id and link.purchase_order_id=plan.purchase_order_id
    join material_master material on material.id=plan.material_id and material.id=po_line.material_id
    join units unit on unit.id=plan.unit_id and unit.id=po_line.unit_id
    join lateral (select e.*,count(*) over() created_event_count from purchase_delivery_plan_events e
      where e.delivery_plan_id=plan.id and e.event_type='CREATED' order by e.id limit 1) event on true
    join lateral (select q.*,count(*) over() queue_count from warehouse_receiving_queue_entries q
      where q.delivery_plan_id=plan.id order by q.id limit 1) queue on true
    where plan.purchase_order_id=$1 order by plan.id`, [purchaseOrderId]);
  if (planRows.rows.length !== lines.length) throw inconsistent();
  const lineById = new Map(lines.map((line) => [line.purchase_order_line_id, line]));
  const deliveryPlans = planRows.rows.map((row) => {
    const line = lineById.get(stableId(row.purchase_order_line_id));
    if (!line || Number(row.created_event_count) !== 1 || Number(row.queue_count) !== 1
      || stableId(row.award_line_id) !== line.award_line_id
      || stableId(row.material_id) !== line.material_id
      || String(row.quantity) !== line.quantity
      || String(row.received_quantity) !== line.received_quantity
      || String(row.planned_delivery_date) !== line.planned_delivery_date
      || String(row.actor) !== String(row.event_actor)
      || String(row.request_id) !== String(row.event_request_id)
      || String(row.request_id) !== String(header.request_id)
      || String(row.occurred_at_shanghai) !== String(row.event_at_shanghai)) throw inconsistent();
    const queueStatus = projectedQueueStatus(String(row.plan_status), row.closed_at);
    return {
      delivery_plan_id: stableId(row.delivery_plan_id),
      status: requiredText(row.plan_status),
      status_label: row.plan_status === "PENDING" ? "待到货" : requiredText(row.plan_status),
      version: positiveInteger(row.plan_version),
      purchase_order_id: stableId(row.purchase_order_id),
      purchase_order_line_id: stableId(row.purchase_order_line_id),
      award_line_id: stableId(row.award_line_id),
      material_id: stableId(row.material_id),
      material_code: requiredText(row.material_code),
      material_name: requiredText(row.material_name),
      quantity: String(row.quantity),
      received_quantity: String(row.received_quantity),
      unit_code: requiredText(row.unit_code),
      planned_delivery_date: requiredText(row.planned_delivery_date),
      actor: requiredText(row.actor),
      occurred_at_shanghai: requiredText(row.occurred_at_shanghai),
      request_id: requiredText(row.request_id),
      plan_event_id: stableId(row.plan_event_id),
      plan_event_type: requiredText(row.plan_event_type),
      queue_id: stableId(row.queue_id),
      queue_status: queueStatus,
      queue_status_label: queueStatus === "OPEN_PENDING" ? "待处理" : queueStatus === "CLOSED" ? "已关闭" : "处理中",
      queue_version: positiveInteger(row.queue_version),
    };
  });

  const eventRows = await client.query<Row>(`select event.id::text event_id,event.event_type,
      event.from_status,event.to_status,event.created_by actor,event.request_id::text request_id,
      event.created_at,to_char(event.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai
    from purchase_order_status_events event where event.purchase_order_id=$1 and event.event_type='CREATED'
    order by event.id`, [purchaseOrderId]);
  if (eventRows.rows.length !== 1) throw inconsistent();
  const poEvent = eventRows.rows[0];

  const auditRows = await client.query<Row>(`select audit.id::text audit_id,audit.action,audit.result,
      audit.username actor,audit.request_id::text request_id,audit.operation_id::text operation_id,
      audit.idempotency_key_digest,
      to_char(audit.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai,
      audit.created_at
    from audit_log audit where audit.route_code='PROCUREMENT' and audit.action='SOURCING_AWARD_CONVERTED'
      and audit.result='success' and audit.detail->>'object_id'=($1::bigint)::text
    order by audit.id`, [header.award_id]);
  if (auditRows.rows.length !== 1) throw inconsistent();
  const audit = auditRows.rows[0];
  if (String(poEvent.from_status ?? "") !== "" || String(poEvent.to_status) !== "OPEN"
    || String(poEvent.actor) !== String(header.created_by)
    || String(poEvent.request_id) !== String(header.request_id)
    || String(audit.actor) !== String(header.created_by)
    || String(audit.request_id) !== String(header.request_id)
    || String(audit.operation_id) !== String(header.conversion_operation_id)
    || String(audit.idempotency_key_digest ?? "") === ""
    || !sameInstant(poEvent.created_at, header.created_at)
    || !sameInstant(audit.created_at, header.created_at)) throw inconsistent();

  const idempotencyRows = await client.query<Row>(`select idem.status_code::int status_code,
      idem.key_digest,idem.request_digest,
      to_char(idem.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') created_at_shanghai
    from idempotency_keys idem where idem.key_digest=$1 and idem.username=$2 and idem.method='POST'
      and idem.path=$3 and idem.status_code=201 and idem.response->>'request_id'=$4
      and exists(select 1 from jsonb_array_elements(coalesce(idem.response#>'{data,purchase_orders}','[]'::jsonb)) item
        where item->>'id'=($5::bigint)::text)
    order by idem.created_at`, [audit.idempotency_key_digest, header.created_by,
    `/api/procurement/awards/${stableId(header.award_id)}/purchase-orders`, header.request_id, purchaseOrderId]);
  if (idempotencyRows.rows.length !== 1) throw inconsistent();
  const idempotency = idempotencyRows.rows[0];

  const failedRows = await client.query<Row>(`select failed.id::text audit_id,failed.request_id::text request_id,
      failed.error_code,to_char(failed.created_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') occurred_at_shanghai,
      ((select count(*) from purchase_orders candidate where candidate.request_id=failed.request_id)
       +(select count(*) from procurement_award_po_line_links candidate where candidate.request_id=failed.request_id)
       +(select count(*) from purchase_order_status_events candidate where candidate.request_id=failed.request_id)
       +(select count(*) from purchase_delivery_plans candidate where candidate.request_id=failed.request_id)
       +(select count(*) from purchase_delivery_plan_events candidate where candidate.request_id=failed.request_id))::int business_record_count
    from audit_log failed where failed.route_code='PROCUREMENT' and failed.action='SOURCING_AWARD_CONVERTED'
      and failed.result='failed' and failed.username=$1 and failed.request_id<>$2::uuid
      and failed.created_at>=$3::timestamptz and failed.created_at<$4::timestamptz
      and not coalesce(failed.detail ? 'object_id',false) order by failed.created_at,failed.id`, [header.created_by, header.request_id,
    header.selected_at, header.created_at]);
  let historicalFailedAttempt: PurchaseOrderHistoryReadModel["credentials"]["historical_failed_attempt"];
  if (failedRows.rows.length === 1 && Number(failedRows.rows[0].business_record_count) === 0) {
    const failed = failedRows.rows[0];
    const projectedStatus = legacyConversionHttpStatus(String(failed.error_code ?? ""));
    historicalFailedAttempt = {
      available: true,
      relation: "UNBOUND_PRIOR_ATTEMPT",
      note: "该失败Audit未保存Award或PO对象ID；仅作为同actor/action时间窗内唯一且业务记录为0的先前尝试展示，不与成功PO合并为一次操作。",
      audit_id: stableId(failed.audit_id),
      request_id: requiredText(failed.request_id),
      result: "FAILED",
      error_code: requiredText(failed.error_code),
      http_status: projectedStatus.http_status,
      http_status_source: projectedStatus.source,
      business_record_count: 0,
    };
  } else {
    historicalFailedAttempt = {
      available: false,
      relation: "UNBOUND_PRIOR_ATTEMPT",
      note: failedRows.rows.length > 1
        ? "同actor/action时间窗内存在多个未绑定失败Audit，已失败关闭其标识展示，避免泄漏或错误归属。"
        : "没有可在不推断对象归属的前提下单独展示的历史失败尝试。",
    };
  }

  const downstreamRows = await client.query<Row>(`with target_receipts as (
      select receipt.* from purchase_receipts receipt where receipt.purchase_order_id=$1
    ), target_receipt_lines as (
      select line.* from purchase_receipt_lines line join target_receipts receipt on receipt.id=line.purchase_receipt_id
    ), target_purchase_sources as (
      select source.* from purchase_financial_source_entries source join target_receipts receipt on receipt.id=source.purchase_receipt_id
    ), target_finance_documents as (
      select document.* from finance_documents document join target_purchase_sources source on source.id=document.purchase_source_entry_id
      where document.doc_type='AP'
    ), target_work_orders as (
      select distinct work_order.* from production_work_orders work_order
      join production_handoff_work_order_links link on link.work_order_id=work_order.id
      join production_handoff_items item on item.id=link.handoff_item_id
      join production_handoffs handoff on handoff.id=item.handoff_id
      join project_planning_packages package on package.id=handoff.planning_package_id
      where package.project_id=$2
    ) select
      (select count(*)::int from target_receipts where receipt_type='RECEIPT') receipt,
      (select count(*)::int from target_receipt_lines) warehouse_receipt,
      (select count(*)::int from purchase_receipt_delivery_allocations allocation
        join target_receipt_lines line on line.id=allocation.purchase_receipt_line_id) delivery_allocation,
      (select count(distinct receipt.inventory_adjustment_id)::int from target_receipts receipt
        where receipt.inventory_adjustment_id is not null) inventory_adjustment,
      (select count(*)::int from inventory_ledger_entries ledger
        join target_receipt_lines line on line.inventory_ledger_entry_id=ledger.id) inventory_ledger,
      (select count(*)::int from inventory_lots lot
        join target_receipt_lines line on line.id=lot.source_purchase_receipt_line_id) lot,
      (select count(*)::int from quality_inspections inspection
        join target_receipt_lines line on line.id=inspection.purchase_receipt_line_id where inspection.inspection_type='IQC') iqc,
      (select count(*)::int from target_purchase_sources) purchase_financial_source,
      (select count(*)::int from finance_project_source_allocations allocation
        join target_purchase_sources source on source.id=allocation.purchase_source_entry_id) finance_project_allocation,
      (select count(*)::int from target_finance_documents) ap,
      (select count(*)::int from finance_settlements settlement
        join target_finance_documents document on document.id=settlement.document_id) payment,
      (select count(*)::int from target_work_orders) work_order,
      (select count(*)::int from production_handoff_work_order_links link
        join target_work_orders work_order on work_order.id=link.work_order_id) handoff_work_order_link,
      (select count(*)::int from production_reports report
        join target_work_orders work_order on work_order.id=report.work_order_id) production_report,
      (select count(*)::int from production_completions completion
        join target_work_orders work_order on work_order.id=completion.work_order_id) production_completion`, [purchaseOrderId, header.project_id]);
  const downstreamRaw = downstreamRows.rows[0];
  if (!downstreamRaw) throw inconsistent();
  const downstreamCounts = Object.fromEntries(
    Object.entries(downstreamRaw).map(([key, value]) => [key, nonNegativeInteger(value)]),
  ) as Omit<DownstreamProjection, "all_zero" | "scope_note">;
  const allZero = Object.values(downstreamCounts).every((value) => value === 0);

  const supplierSummaries = awardHistory.summary.supplier_summaries.map((supplier, index) => ({
    label: supplierSequenceLabel(index),
    supplier_id: supplier.supplier_id,
    supplier_code: supplier.supplier_code,
    supplier_name: supplier.supplier_name,
    line_count: lines.filter((line) => line.supplier_id === supplier.supplier_id).length,
    total_amount: decimal(lines.filter((line) => line.supplier_id === supplier.supplier_id)
      .reduce((sum, line) => sum + decimalScaled(line.line_amount), 0n)),
    currency_code: supplier.currency_code,
  }));

  return {
    contract_version: "PO_HISTORY_TRACEABILITY_V1",
    read_only: true,
    observed_at: requiredText(header.observed_at),
    data_timezone: "Asia/Shanghai",
    governance_boundary: {
      authorization_verified: false,
      note: "本组件只读展示关系化业务事实，不验证项目任务授权，也不把对象存在、Event、Audit或Idempotency解释为授权已经验证。",
    },
    purchase_order: {
      purchase_order_id: stableId(header.purchase_order_id),
      po_code: requiredText(header.po_code),
      version: positiveInteger(header.po_version),
      status: requiredText(header.po_status),
      status_label: header.po_status === "OPEN" ? "处理中" : requiredText(header.po_status),
      supplier_id: stableId(header.supplier_id),
      supplier_code: requiredText(header.supplier_code),
      supplier_name: requiredText(header.supplier_name),
      currency_code: requiredText(header.currency_code),
      tax_included: commercial.tax_included === true,
      tax_label: commercial.tax_included === true ? "含税" : "未税",
      freight_included: commercial.freight_included === true,
      freight_label: commercial.freight_included === true ? "含运费" : "不含运费",
      payment_terms: requiredText(commercial.payment_terms),
      commercial_terms_source: `Quote ${stableId(commercial.quote_id)}/v${positiveInteger(commercial.quote_version)}`,
      ordered_quantity: decimal(ordered),
      received_quantity: decimal(received),
      unit_code: lines.length && new Set(lines.map((line) => line.unit_code)).size === 1 ? lines[0].unit_code : "MIXED",
      total_amount: decimal(total),
      remark: String(header.remark ?? ""),
      created_by: requiredText(header.created_by),
      created_at_shanghai: requiredText(header.created_at_shanghai),
      request_id: requiredText(header.request_id),
      po_operation_id: requiredText(header.po_operation_id),
      conversion_operation_id: requiredText(header.conversion_operation_id),
      conversion_action: requiredText(audit.action),
      po_convertible_now: awardHistory.projections.po_convertible_now,
    },
    lineage: {
      project: { id: stableId(header.project_id), code: requiredText(header.project_code), name: requiredText(header.project_name) },
      material_requirement_plan: { id: stableId(header.mrp_id), version: positiveInteger(header.mrp_version), status: requiredText(header.mrp_status) },
      purchase_request: { id: stableId(header.prq_id), code: requiredText(header.request_code), version: positiveInteger(header.prq_version), status: requiredText(header.prq_status) },
      rfq: { id: stableId(header.rfq_id), code: requiredText(header.rfq_code), round_no: positiveInteger(header.round_no), version: positiveInteger(header.rfq_version), status: requiredText(header.rfq_status) },
      comparison: { version: awardHistory.identity.comparison_version_no, status: awardHistory.identity.comparison_status },
      quote: { id: stableId(commercial.quote_id), version: positiveInteger(commercial.quote_version) },
      award: { id: stableId(header.award_id), version: positiveInteger(header.award_version), status: requiredText(header.award_status) },
      purchase_order: { id: stableId(header.purchase_order_id), version: positiveInteger(header.po_version), status: requiredText(header.po_status) },
    },
    digests: {
      comparison_output_digest: sha256(awardHistory.identity.comparison_output_digest),
      persisted_award_digest: sha256(awardHistory.persisted_award_digest.value),
      derived_award_decision_digest: sha256(awardHistory.decision_digest.value),
      derived_award_decision_rule: awardHistory.decision_digest.canonical_rule,
    },
    supplier_summaries: supplierSummaries,
    lines,
    line_summary: {
      line_count: lines.length,
      duplicate_material: materialIds.size !== lines.length,
      duplicate_material_note: materialIds.size === lines.length ? "无重复Material" : "存在重复Material",
    },
    delivery_model: {
      has_independent_delivery_plan_line: false,
      note: "模型没有独立Delivery Plan Line；每条Delivery Plan记录直接且唯一对应一条PO Line。",
    },
    delivery_plans: deliveryPlans,
    credentials: {
      purchase_order_event: {
        event_id: stableId(poEvent.event_id),
        event_type: requiredText(poEvent.event_type),
        from_status: null,
        to_status: requiredText(poEvent.to_status),
        actor: requiredText(poEvent.actor),
        occurred_at_shanghai: requiredText(poEvent.occurred_at_shanghai),
        request_id: requiredText(poEvent.request_id),
        result: "SUCCESS",
        result_source: "EXACT_SUCCESS_AUDIT_IN_SAME_TRANSACTION",
      },
      audit: {
        audit_id: stableId(audit.audit_id),
        action: requiredText(audit.action),
        result: "SUCCESS",
        actor: requiredText(audit.actor),
        occurred_at_shanghai: requiredText(audit.occurred_at_shanghai),
        request_id: requiredText(audit.request_id),
        operation_id: requiredText(audit.operation_id),
      },
      idempotency: {
        http_status: positiveInteger(idempotency.status_code),
        key_digest: sha256(idempotency.key_digest),
        request_digest: sha256(idempotency.request_digest),
        created_at_shanghai: requiredText(idempotency.created_at_shanghai),
        exposed_fields_note: "只展示HTTP状态和摘要；请求正文、响应正文、Cookie、Session及敏感Header均不进入DTO。",
      },
      historical_failed_attempt: historicalFailedAttempt,
    },
    downstream: {
      ...downstreamCounts,
      all_zero: allZero,
      scope_note: "采购与库存/财务计数沿目标PO及receipt稳定外键；生产计数沿目标Project的Production Handoff稳定关系。",
    },
    protected_boundaries: [
      "PO OPEN不等于已到货。",
      "Delivery Plan PENDING不等于已收货。",
      "queue OPEN_PENDING是待处理队列，不等于库存增加。",
      "本页面不自动执行任何下游动作。",
    ],
  };
}
