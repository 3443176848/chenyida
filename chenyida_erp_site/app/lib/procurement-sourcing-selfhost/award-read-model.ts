import { canonicalDigest } from "./validation.ts";

type StableId = string | number | bigint;

export type AwardHistoryHeaderRow = Readonly<{
  id: StableId;
  rfq_id: StableId;
  status: string;
  award_digest: string;
  selected_by: string;
  selected_at: Date | string;
  selected_at_shanghai: string;
  reason_code: string;
  reason: string;
  version: number | string;
  request_id: string;
  reversed_by?: string | null;
  reversed_at?: Date | string | null;
  reversal_reason?: string;
}>;

export type AwardHistoryLineRow = Readonly<{
  award_line_id: StableId;
  award_id: StableId;
  rfq_id: StableId | null;
  rfq_line_id: StableId | null;
  line_no: number | string | null;
  material_id: StableId | null;
  internal_material_code: string | null;
  standard_name: string | null;
  unit_id: StableId | null;
  unit_code: string | null;
  comparison_line_id: StableId | null;
  comparison_version_no: number | string | null;
  comparison_candidate_id: StableId | null;
  quote_line_id: StableId | null;
  quote_id: StableId | null;
  quote_version_no: number | string | null;
  supplier_id: StableId | null;
  supplier_code: string | null;
  supplier_name: string | null;
  selected_quantity: string;
  selected_unit_price: string;
  currency_code: string | null;
  required_date: string | null;
  promised_delivery_date: string | null;
  selection_reason: string;
  late_delivery_reason_code: string | null;
  late_delivery_reason: string;
  excess_quantity_reason: string;
}>;

export type AwardHistoryEventRow = Readonly<{
  id: StableId;
  award_id: StableId | null;
  event_type: string;
  actor: string;
  request_id: string;
  result: string;
  reason: string;
  created_at: Date | string;
  occurred_at_shanghai: string;
  old_version: number | null;
  new_version: number | null;
  from_status: string | null;
  to_status: string | null;
}>;

export type AwardHistoryAuditRow = Readonly<{
  audit_id: StableId;
  actor: string;
  request_id: string;
  result: string;
  old_version: number | null;
  new_version: number | null;
  occurred_at_shanghai: string;
}>;

export type AwardComparisonVersion = Readonly<{
  comparison_version_no: number;
  status: string;
  awardable_now: boolean;
  awardability_note?: string;
  output_summary: Readonly<{ digest: string }>;
  fixed_quote_inputs: Array<Readonly<{
    quote_id: StableId;
    quote_version_no: number;
    supplier_id: StableId;
    supplier_code: string;
    supplier_name: string;
    supplier_quote_reference: string;
    currency_code: string;
  }>>;
}>;

export type AwardHistoryReadModel = Readonly<{
  identity: Readonly<{
    award_id: string;
    display_identity: string;
    has_business_number: false;
    business_number: null;
    business_number_note: string;
    has_version: true;
    version: number;
    version_note: string;
    status: string;
    status_source: string;
    immutable_semantics: string;
    rfq_id: string;
    rfq_code: string;
    round_no: number;
    rfq_submitted_cas: number | null;
    rfq_submitted_cas_source: string;
    rfq_current_cas: number;
    rfq_current_cas_source: string;
    comparison_version_no: number;
    comparison_status: string;
    comparison_status_source: string;
    comparison_output_digest: string;
  }>;
  persisted_award_digest: Readonly<{
    value: string;
    source: string;
    note: string;
  }>;
  decision_digest: Readonly<{
    value: string;
    source: "DETERMINISTIC_RECALCULATION";
    persisted: false;
    canonical_rule: "AWARD_DECISION_V1";
    note: string;
    canonical_facts: Record<string, unknown>;
  }>;
  fixed_quotes: Array<Readonly<{
    quote_id: string;
    quote_version_no: number;
    supplier_id: string;
    supplier_code: string;
    supplier_name: string;
    supplier_quote_reference: string;
    currency_code: string;
  }>>;
  lines: Array<Readonly<{
    award_line_id: string;
    rfq_line_id: string;
    line_no: number;
    material_id: string;
    internal_material_code: string;
    standard_name: string;
    unit_id: string;
    unit_code: string;
    comparison_line_id: string;
    comparison_candidate_id: string;
    quote_line_id: string;
    quote_id: string;
    quote_version_no: number;
    supplier_id: string;
    supplier_code: string;
    supplier_name: string;
    selected_quantity: string;
    selected_unit_price: string;
    line_amount: string;
    currency_code: string;
    required_date: string;
    promised_delivery_date: string;
    selection_reason: string;
    late_delivery_reason_code: string | null;
    late_delivery_reason: string;
    excess_quantity_reason: string;
  }>>;
  summary: Readonly<{
    award_line_count: number;
    supplier_summaries: Array<Readonly<{
      supplier_id: string;
      supplier_code: string;
      supplier_name: string;
      award_line_count: number;
      total_amount: string;
      currency_code: string;
    }>>;
    split_award_lines: false;
    split_note: string;
    duplicate_material: boolean;
    duplicate_material_note: string;
  }>;
  reason: Readonly<{
    code: string;
    text: string;
    normalized_text: string;
  }>;
  operation_receipt: Readonly<{
    event_id: string;
    event_type: string;
    event_count: 1;
    user_operation_count: 1;
    award_line_count: number;
    actor: string;
    occurred_at_shanghai: string;
    request_id: string;
    result: string;
    reason: string;
    version_transition_recorded: boolean;
    version_transition_note: string;
    event_old_version: number | null;
    event_new_version: number | null;
    cas_evidence: Readonly<{
      authority: "EXACT_SUCCESS_AUDIT" | "CURRENT_RFQ_HEAD_ONLY";
      audit_id: string | null;
      old_version: number | null;
      audit_new_version: number | null;
      new_version: number;
      submitted_source: string;
      current_source: string;
      note: string;
    }>;
  }>;
  projections: Readonly<{
    comparison_status: string;
    awardable_now: boolean;
    awardability_note: string;
    po_convertible_now: boolean;
    po_count: number;
    po_conversion_note: string;
    po_conversion_conditions: Readonly<{
      award_status_awarded: boolean;
      rfq_status_closed: boolean;
      award_lines_complete: boolean;
      references_complete: boolean;
      source_purchase_request_accepted: boolean;
      purchase_order_count_zero: boolean;
    }>;
  }>;
}>;

const SCALE = 1_000_000n;
const DECIMAL = /^\d+(?:\.\d{1,6})?$/;

function stableId(value: StableId | null | undefined, label: string) {
  const result = value === null || value === undefined ? "" : String(value);
  if (!/^[1-9]\d*$/.test(result)) throw new Error(`Award history missing ${label}`);
  return result;
}

function positiveInteger(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`Award history invalid ${label}`);
  return result;
}

function requiredText(value: unknown, label: string) {
  const result = String(value ?? "");
  if (!result) throw new Error(`Award history missing ${label}`);
  return result;
}

function decimalScaled(value: unknown, label: string) {
  const raw = String(value ?? "");
  if (!DECIMAL.test(raw)) throw new Error(`Award history invalid ${label}`);
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function decimal(value: bigint) {
  return `${value / SCALE}.${String(value % SCALE).padStart(6, "0")}`;
}

function multiply(left: unknown, right: unknown) {
  const product = decimalScaled(left, "quantity") * decimalScaled(right, "unit price");
  return decimal((product + SCALE / 2n) / SCALE);
}

function compareIds(left: StableId, right: StableId) {
  const a = BigInt(stableId(left, "stable ID"));
  const b = BigInt(stableId(right, "stable ID"));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeAwardDecisionText(value: unknown) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.trim().replace(/[\t ]+/g, " ")).join("\n").trim();
}

function sameInstant(left: unknown, right: unknown) {
  const instant = (value: unknown) => value instanceof Date ? value.valueOf() : new Date(String(value ?? "")).valueOf();
  const a = instant(left);
  const b = instant(right);
  return Number.isFinite(a) && a === b;
}

export function buildAwardHistoryReadModel(input: Readonly<{
  award: AwardHistoryHeaderRow;
  award_lines: AwardHistoryLineRow[];
  award_events: AwardHistoryEventRow[];
  award_audits: AwardHistoryAuditRow[];
  rfq: Readonly<{ id: StableId; rfq_code: string; round_no: number | string; status: string; version: number | string; source_status: string }>;
  rfq_line_ids: StableId[];
  comparison_version: AwardComparisonVersion;
  purchase_order_count: number | string;
}>): AwardHistoryReadModel {
  const awardId = stableId(input.award.id, "Award ID");
  const rfqId = stableId(input.rfq.id, "RFQ ID");
  if (stableId(input.award.rfq_id, "Award RFQ ID") !== rfqId) throw new Error("Award history crosses RFQ scope");
  const version = positiveInteger(input.award.version, "Award version");
  const roundNo = positiveInteger(input.rfq.round_no, "RFQ round");
  const rfqCurrentCas = positiveInteger(input.rfq.version, "RFQ current CAS");
  const comparisonVersionNo = positiveInteger(input.comparison_version.comparison_version_no, "Comparison version");
  const comparisonOutputDigest = requiredText(input.comparison_version.output_summary.digest, "Comparison output digest");
  if (!/^[0-9a-f]{64}$/.test(comparisonOutputDigest)) throw new Error("Award history invalid Comparison output digest");
  if (!/^[0-9a-f]{64}$/.test(input.award.award_digest)) throw new Error("Award history invalid persisted Award digest");

  const expectedRfqLineIds = new Set(input.rfq_line_ids.map((value) => stableId(value, "RFQ Line ID")));
  const orderedRows = [...input.award_lines].sort((left, right) => compareIds(left.award_line_id, right.award_line_id));
  if (!expectedRfqLineIds.size || orderedRows.length !== expectedRfqLineIds.size) throw new Error("Award history does not completely cover RFQ Lines");
  const lineIds = new Set<string>();
  const rfqLineIds = new Set<string>();
  const materialIds = new Set<string>();
  let duplicateMaterial = false;
  const lines = orderedRows.map((row) => {
    const awardLineId = stableId(row.award_line_id, "Award Line ID");
    const rowAwardId = stableId(row.award_id, "Award Line Award ID");
    const rowRfqId = stableId(row.rfq_id, "Award Line RFQ ID");
    const rfqLineId = stableId(row.rfq_line_id, "Award Line RFQ Line ID");
    const materialId = stableId(row.material_id, "Award Line Material ID");
    if (rowAwardId !== awardId || rowRfqId !== rfqId || !expectedRfqLineIds.has(rfqLineId)) throw new Error("Award history line crosses Award or RFQ scope");
    if (lineIds.has(awardLineId) || rfqLineIds.has(rfqLineId)) throw new Error("Award history contains duplicate Award or RFQ Line identity");
    lineIds.add(awardLineId);
    rfqLineIds.add(rfqLineId);
    if (materialIds.has(materialId)) duplicateMaterial = true;
    materialIds.add(materialId);
    const rowComparisonVersion = positiveInteger(row.comparison_version_no, "Award Line Comparison version");
    if (rowComparisonVersion !== comparisonVersionNo) throw new Error("Award history spans multiple Comparison versions");
    const selectedQuantity = decimal(decimalScaled(row.selected_quantity, "selected quantity"));
    const selectedUnitPrice = decimal(decimalScaled(row.selected_unit_price, "selected unit price"));
    return {
      award_line_id: awardLineId,
      rfq_line_id: rfqLineId,
      line_no: positiveInteger(row.line_no, "RFQ line number"),
      material_id: materialId,
      internal_material_code: requiredText(row.internal_material_code, "Material code"),
      standard_name: requiredText(row.standard_name, "Material name"),
      unit_id: stableId(row.unit_id, "Unit ID"),
      unit_code: requiredText(row.unit_code, "Unit code"),
      comparison_line_id: stableId(row.comparison_line_id, "Comparison Line ID"),
      comparison_candidate_id: stableId(row.comparison_candidate_id, "Comparison Candidate ID"),
      quote_line_id: stableId(row.quote_line_id, "Quote Line ID"),
      quote_id: stableId(row.quote_id, "Quote ID"),
      quote_version_no: positiveInteger(row.quote_version_no, "Quote version"),
      supplier_id: stableId(row.supplier_id, "Supplier ID"),
      supplier_code: requiredText(row.supplier_code, "Supplier code"),
      supplier_name: requiredText(row.supplier_name, "Supplier name"),
      selected_quantity: selectedQuantity,
      selected_unit_price: selectedUnitPrice,
      line_amount: multiply(selectedQuantity, selectedUnitPrice),
      currency_code: requiredText(row.currency_code, "currency"),
      required_date: requiredText(row.required_date, "required date"),
      promised_delivery_date: requiredText(row.promised_delivery_date, "promised delivery date"),
      selection_reason: String(row.selection_reason || ""),
      late_delivery_reason_code: row.late_delivery_reason_code || null,
      late_delivery_reason: String(row.late_delivery_reason || ""),
      excess_quantity_reason: String(row.excess_quantity_reason || ""),
    };
  });
  if ([...expectedRfqLineIds].some((id) => !rfqLineIds.has(id))) throw new Error("Award history is missing an RFQ Line");

  const fixedQuoteMap = new Map<string, AwardHistoryReadModel["fixed_quotes"][number]>();
  for (const row of input.comparison_version.fixed_quote_inputs) {
    const quoteId = stableId(row.quote_id, "fixed Quote ID");
    const value = {
      quote_id: quoteId,
      quote_version_no: positiveInteger(row.quote_version_no, "fixed Quote version"),
      supplier_id: stableId(row.supplier_id, "fixed Quote Supplier ID"),
      supplier_code: requiredText(row.supplier_code, "fixed Quote Supplier code"),
      supplier_name: requiredText(row.supplier_name, "fixed Quote Supplier name"),
      supplier_quote_reference: requiredText(row.supplier_quote_reference, "fixed Quote reference"),
      currency_code: requiredText(row.currency_code, "fixed Quote currency"),
    };
    const prior = fixedQuoteMap.get(quoteId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(value)) throw new Error("Award history fixed Quote identity is inconsistent");
    fixedQuoteMap.set(quoteId, value);
  }
  const fixedQuotes = [...fixedQuoteMap.values()].sort((left, right) => compareIds(left.quote_id, right.quote_id));
  if (!fixedQuotes.length) throw new Error("Award history has no fixed Quote inputs");
  for (const line of lines) {
    const fixedQuote = fixedQuotes.find((quote) => quote.quote_id === line.quote_id
      && quote.quote_version_no === line.quote_version_no && quote.supplier_id === line.supplier_id);
    if (!fixedQuote || fixedQuote.currency_code !== line.currency_code) {
      throw new Error(`Award Line ${line.award_line_id} does not reference a fixed Comparison Quote`);
    }
  }

  const reasonNormalized = normalizeAwardDecisionText(input.award.reason);
  if (!reasonNormalized) throw new Error("Award history has no normalized reason");
  const canonicalFacts: Record<string, unknown> = {
    canonical_rule: "AWARD_DECISION_V1",
    award_id: awardId,
    rfq: { rfq_id: rfqId, rfq_code: requiredText(input.rfq.rfq_code, "RFQ code"), round_no: roundNo },
    comparison: { comparison_version_no: comparisonVersionNo, output_digest: comparisonOutputDigest },
    lines: lines.map((line) => ({
      award_line_id: line.award_line_id,
      comparison_line_id: line.comparison_line_id,
      comparison_candidate_id: line.comparison_candidate_id,
      quote_id: line.quote_id,
      quote_version_no: line.quote_version_no,
      quote_line_id: line.quote_line_id,
      supplier_id: line.supplier_id,
      material_id: line.material_id,
      unit_id: line.unit_id,
      quantity: line.selected_quantity,
      unit_price: line.selected_unit_price,
      amount: line.line_amount,
      currency_code: line.currency_code,
      selection_reason_normalized: normalizeAwardDecisionText(line.selection_reason),
      late_delivery_reason_code: line.late_delivery_reason_code,
      late_delivery_reason_normalized: normalizeAwardDecisionText(line.late_delivery_reason),
      excess_quantity_reason_normalized: normalizeAwardDecisionText(line.excess_quantity_reason),
    })),
    reason_code: requiredText(input.award.reason_code, "Award reason code"),
    reason_normalized: reasonNormalized,
  };

  const matchingEvents = input.award_events.filter((event) => String(event.award_id ?? "") === awardId && event.event_type === "AWARDED");
  if (matchingEvents.length !== 1) throw new Error(`Award history requires one AWARDED Event, found ${matchingEvents.length}`);
  const event = matchingEvents[0];
  if (event.actor !== input.award.selected_by || event.request_id !== input.award.request_id
    || event.result !== "SUCCESS" || !sameInstant(event.created_at, input.award.selected_at)
    || event.reason !== input.award.reason) {
    throw new Error("Award history Event does not match Award provenance");
  }
  const eventVersionRecorded = event.old_version !== null && event.new_version !== null;
  const exactAudits = input.award_audits.filter((audit) => audit.actor === input.award.selected_by
    && audit.request_id === input.award.request_id && audit.result === "success"
    && audit.old_version !== null && audit.new_version === audit.old_version + 1 && audit.new_version <= rfqCurrentCas);
  const audit = exactAudits.length === 1 ? exactAudits[0] : null;
  const purchaseOrderCount = Number(input.purchase_order_count);
  if (!Number.isSafeInteger(purchaseOrderCount) || purchaseOrderCount < 0) throw new Error("Award history invalid PO count");
  const referencesComplete = lines.length === orderedRows.length;
  const awardLinesComplete = lines.length === expectedRfqLineIds.size;
  const awardStatusAwarded = input.award.status === "AWARDED";
  const rfqStatusClosed = input.rfq.status === "CLOSED";
  const sourcePurchaseRequestAccepted = input.rfq.source_status === "ACCEPTED";
  const purchaseOrderCountZero = purchaseOrderCount === 0;
  const poConvertibleNow = awardStatusAwarded && rfqStatusClosed && awardLinesComplete && referencesComplete
    && sourcePurchaseRequestAccepted && purchaseOrderCountZero;

  const supplierSummaries = fixedQuotes.map((quote) => {
    const supplierLines = lines.filter((line) => line.supplier_id === quote.supplier_id);
    const currencies = new Set(supplierLines.map((line) => line.currency_code));
    if (currencies.size > 1) throw new Error("Award history Supplier total spans currencies");
    const total = supplierLines.reduce((sum, line) => sum + decimalScaled(line.line_amount, "line amount"), 0n);
    return {
      supplier_id: quote.supplier_id,
      supplier_code: quote.supplier_code,
      supplier_name: quote.supplier_name,
      award_line_count: supplierLines.length,
      total_amount: decimal(total),
      currency_code: quote.currency_code,
    };
  });

  const submittedCas = audit?.old_version ?? null;
  return {
    identity: {
      award_id: awardId,
      display_identity: `定标 #${awardId}`,
      has_business_number: false,
      business_number: null,
      business_number_note: "未设置独立Award业务编号。",
      has_version: true,
      version,
      version_note: "Award有独立Version字段；AWARDED事实一次性不可变，只有合法撤销会推进Version。",
      status: input.award.status,
      status_source: "PERSISTED_DATABASE_FIELD / procurement_sourcing_awards.status",
      immutable_semantics: "Award聚合与四条Award Line是一次用户定标事务形成的不可变事实；不得原地改写。",
      rfq_id: rfqId,
      rfq_code: input.rfq.rfq_code,
      round_no: roundNo,
      rfq_submitted_cas: submittedCas,
      rfq_submitted_cas_source: audit ? "EXACT_SUCCESS_AUDIT / audit_log.old_version" : "UNAVAILABLE / 历史Event未记录且无唯一精确Audit",
      rfq_current_cas: rfqCurrentCas,
      rfq_current_cas_source: "PERSISTED_DATABASE_FIELD / procurement_rfqs.version",
      comparison_version_no: comparisonVersionNo,
      comparison_status: input.comparison_version.status,
      comparison_status_source: "SERVER_READ_PROJECTION / latest immutable Comparison facts + current Quote input validity and basis drift checks",
      comparison_output_digest: comparisonOutputDigest,
    },
    persisted_award_digest: {
      value: input.award.award_digest,
      source: "PERSISTED_DATABASE_FIELD / procurement_sourcing_awards.award_digest",
      note: "这是创建时RFQ、Comparison、原因和选择请求的持久化Award摘要；不包含数据库生成的Award/Line ID，不冒充decision digest。",
    },
    decision_digest: {
      value: canonicalDigest(canonicalFacts),
      source: "DETERMINISTIC_RECALCULATION",
      persisted: false,
      canonical_rule: "AWARD_DECISION_V1",
      note: "确定性决策摘要，由不可变Award事实重算；不是伪造的历史持久化字段。",
      canonical_facts: canonicalFacts,
    },
    fixed_quotes: fixedQuotes,
    lines,
    summary: {
      award_line_count: lines.length,
      supplier_summaries: supplierSummaries,
      split_award_lines: false,
      split_note: "每条RFQ Line只有一条稳定Award Line，无拆单。",
      duplicate_material: duplicateMaterial,
      duplicate_material_note: duplicateMaterial ? "存在重复Material。" : "无重复Material。",
    },
    reason: { code: input.award.reason_code, text: input.award.reason, normalized_text: reasonNormalized },
    operation_receipt: {
      event_id: stableId(event.id, "Award Event ID"),
      event_type: event.event_type,
      event_count: 1,
      user_operation_count: 1,
      award_line_count: lines.length,
      actor: event.actor,
      occurred_at_shanghai: event.occurred_at_shanghai,
      request_id: event.request_id,
      result: event.result,
      reason: event.reason,
      version_transition_recorded: eventVersionRecorded,
      version_transition_note: eventVersionRecorded ? "历史Award Event记录了版本转换。" : "历史Award Event未记录版本转换。",
      event_old_version: event.old_version,
      event_new_version: event.new_version,
      cas_evidence: {
        authority: audit ? "EXACT_SUCCESS_AUDIT" : "CURRENT_RFQ_HEAD_ONLY",
        audit_id: audit ? stableId(audit.audit_id, "Award Audit ID") : null,
        old_version: submittedCas,
        audit_new_version: audit?.new_version ?? null,
        new_version: rfqCurrentCas,
        submitted_source: audit ? "同request_id唯一成功Audit的old_version" : "无权威提交前CAS证据",
        current_source: "当前procurement_rfqs.version",
        note: audit ? "Audit独立记录同一次请求的RFQ CAS；它不是Award Event字段。" : "只能证明当前RFQ Head；页面不会反推或伪造提交前CAS。",
      },
    },
    projections: {
      comparison_status: input.comparison_version.status,
      awardable_now: false,
      awardability_note: "Comparison仍是当前版本，但RFQ已完成定标，不可再次创建Award。",
      po_convertible_now: poConvertibleNow,
      po_count: purchaseOrderCount,
      po_conversion_note: "这是只读资格投影；真正转PO必须在独立任务中重新校验权限、Award CAS、Supplier和Mapping，本页不提供转PO操作。",
      po_conversion_conditions: {
        award_status_awarded: awardStatusAwarded,
        rfq_status_closed: rfqStatusClosed,
        award_lines_complete: awardLinesComplete,
        references_complete: referencesComplete,
        source_purchase_request_accepted: sourcePurchaseRequestAccepted,
        purchase_order_count_zero: purchaseOrderCountZero,
      },
    },
  };
}
