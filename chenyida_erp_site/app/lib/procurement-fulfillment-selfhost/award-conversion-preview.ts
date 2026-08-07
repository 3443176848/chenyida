import { ProcurementError } from "../procurement-selfhost/errors.ts";
import type { RfqDetailDto } from "../procurement-sourcing-selfhost/types.ts";

const stableId = (value: unknown, field: string) => {
  const result = String(value ?? "");
  if (!/^[1-9]\d*$/.test(result)) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览缺少有效${field}`, 409);
  return result;
};
const positiveInteger = (value: unknown, field: string) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览缺少有效${field}`, 409);
  return result;
};
const nonNegativeInteger = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览缺少有效${field}`, 409);
  return value;
};
const requiredText = (value: unknown, field: string) => {
  const result = String(value ?? "");
  if (!result) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览缺少${field}`, 409);
  return result;
};
const requiredBoundedText = (value: unknown, field: string, maxLength: number) => {
  if (typeof value !== "string") throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览的${field}不是文本`, 409);
  const result = requiredText(value, field);
  if (!result.trim() || result.length > maxLength) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览的${field}为空或超过${maxLength}字`, 409);
  return result;
};
const digest = (value: unknown, field: string) => {
  const result = requiredText(value, field);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览的${field}无效`, 409);
  return result;
};
const decimalScaled = (value: unknown, field: string) => {
  const result = String(value ?? "");
  if (!/^\d+(?:\.\d{1,6})?$/.test(result)) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", `转换预览的${field}无效`, 409);
  const [whole, fraction = ""] = result.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};
const decimal = (value: bigint) => `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, "0")}`;
const stableSort = (left: string, right: string) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;

export function buildAwardConversionPreview(detail: RfqDetailDto, requestedAwardId: number) {
  const history = detail.award_history;
  if (!history || stableId(history.identity.award_id, "Award ID") !== String(requestedAwardId)) {
    throw new ProcurementError("SOURCING_AWARD_NOT_FOUND", "采购定标不存在或不属于当前询价", 404);
  }
  const awardId = stableId(history.identity.award_id, "Award ID");
  const awardVersion = positiveInteger(history.identity.version, "Award Version");
  const rfqId = stableId(history.identity.rfq_id, "RFQ ID");
  const rfqVersion = positiveInteger(history.identity.rfq_current_cas, "RFQ Version");
  const comparisonVersion = positiveInteger(history.identity.comparison_version_no, "Comparison Version");
  const awardDigest = digest(history.persisted_award_digest.value, "Award持久化摘要");
  const decisionDigest = digest(history.decision_digest.value, "Award派生决策摘要");
  const comparisonOutputDigest = digest(history.identity.comparison_output_digest, "Comparison输出摘要");
  const currentPoCount = nonNegativeInteger(detail.downstream_counts.purchase_orders, "当前PO数量");
  const currentPoLineCount = nonNegativeInteger(detail.downstream_counts.purchase_order_lines, "当前PO Line数量");
  const currentDeliveryPlanCount = nonNegativeInteger(detail.downstream_counts.delivery_plans, "当前到货计划数量");
  if (currentPoCount !== history.projections.po_count) throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "PO计数投影不一致，已停止转换", 409);
  if (history.identity.status !== "AWARDED" || String(detail.header.status) !== "CLOSED"
    || history.identity.comparison_status !== "CURRENT" || history.projections.awardable_now !== false
    || history.projections.po_convertible_now !== true || currentPoCount !== 0
    || currentPoLineCount !== 0 || currentDeliveryPlanCount !== 0) {
    throw new ProcurementError("SOURCING_AWARD_NOT_CONVERTIBLE", "采购定标、询价、比价或下游计数已变化，当前不能转换", 409);
  }

  const lines = [...history.lines].sort((left, right) => stableSort(left.award_line_id, right.award_line_id));
  if (!lines.length || lines.length !== history.summary.award_line_count || new Set(lines.map((line) => line.award_line_id)).size !== lines.length
    || new Set(lines.map((line) => line.rfq_line_id)).size !== lines.length) {
    throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "Award Line不完整或重复，已停止转换", 409);
  }

  const quoteById = new Map(detail.quotes.map((quote) => [String(quote.quote_id), quote]));
  const selectedQuoteIds = [...new Set(lines.map((line) => line.quote_id))].sort(stableSort);
  const selectedQuotes = selectedQuoteIds.map((quoteId) => {
    const quote = quoteById.get(quoteId);
    if (!quote || quote.status !== "SUBMITTED" || quote.quote_expired !== false || Number(quote.quote_version_no) < 1) {
      throw new ProcurementError("SOURCING_QUOTE_NOT_CURRENT", "Award引用的报价已变化或失效，已停止转换", 409);
    }
    if (typeof quote.tax_included !== "boolean" || typeof quote.freight_included !== "boolean") {
      throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "Award引用的Quote税费或运费口径无效，已停止转换", 409);
    }
    const referencedLines = lines.filter((line) => line.quote_id === quoteId);
    if (referencedLines.some((line) => line.quote_version_no !== quote.quote_version_no
      || line.supplier_id !== String(quote.supplier_id) || line.currency_code !== quote.currency_code)) {
      throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "Award与Quote谱系不一致，已停止转换", 409);
    }
    return {
      quote_id: quoteId,
      quote_version_no: quote.quote_version_no,
      supplier_id: String(quote.supplier_id),
      supplier_code: quote.supplier_code,
      supplier_name: quote.supplier_name,
      supplier_quote_reference: quote.supplier_quote_reference,
      currency_code: quote.currency_code,
      payment_terms: requiredBoundedText(quote.payment_terms, "付款条件", 1000),
      tax_included: quote.tax_included,
      freight_included: quote.freight_included,
    };
  });
  const fixedQuotes = history.fixed_quotes.map((quote) => ({ ...quote }));
  if (!fixedQuotes.length || selectedQuotes.some((selected) => !fixedQuotes.some((fixed) => fixed.quote_id === selected.quote_id
    && fixed.quote_version_no === selected.quote_version_no && fixed.supplier_id === selected.supplier_id))) {
    throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "Award引用的Quote不属于固定Comparison输入", 409);
  }

  const groups = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = `${line.supplier_id}:${line.currency_code}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  for (const group of groups.values()) {
    if (new Set(group.map((line) => line.material_id)).size !== group.length) {
      throw new ProcurementError("AWARD_CONVERSION_PO_MODEL_CONFLICT", "同一PO聚合包含重复Material，当前PO模型不能安全转换", 409);
    }
  }
  const totalsByCurrency = [...new Set(lines.map((line) => line.currency_code))].sort().map((currencyCode) => ({
    currency_code: currencyCode,
    total_amount: decimal(lines.filter((line) => line.currency_code === currencyCode)
      .reduce((sum, line) => sum + decimalScaled(line.line_amount, "Line金额"), 0n)),
  }));
  const suppliers = [...new Map(lines.map((line) => [line.supplier_id, {
    supplier_id: line.supplier_id,
    supplier_code: line.supplier_code,
    supplier_name: line.supplier_name,
  }])).values()].sort((left, right) => stableSort(left.supplier_id, right.supplier_id));
  const operation = history.operation_receipt;
  if (operation.event_count !== 1 || operation.user_operation_count !== 1 || operation.result !== "SUCCESS"
    || operation.award_line_count !== lines.length) {
    throw new ProcurementError("AWARD_CONVERSION_PREVIEW_INCONSISTENT", "Award成功Event不完整，已停止转换", 409);
  }

  return {
    contract_version: "AWARD_PO_CONFIRMATION_V1" as const,
    award: {
      award_id: awardId,
      version: awardVersion,
      status: history.identity.status,
      display_identity: history.identity.display_identity,
      has_business_number: history.identity.has_business_number,
      business_number_note: history.identity.business_number_note,
    },
    rfq: {
      rfq_id: rfqId,
      rfq_code: history.identity.rfq_code,
      round_no: history.identity.round_no,
      status: String(detail.header.status),
      version: rfqVersion,
    },
    comparison: {
      version: comparisonVersion,
      status: history.identity.comparison_status,
      output_digest: comparisonOutputDigest,
      awardable_now: history.projections.awardable_now,
    },
    fixed_quotes: fixedQuotes,
    selected_quotes: selectedQuotes,
    suppliers,
    award_event: {
      event_id: operation.event_id,
      event_type: operation.event_type,
      actor: operation.actor,
      occurred_at_shanghai: operation.occurred_at_shanghai,
      request_id: operation.request_id,
      result: operation.result,
    },
    digests: {
      persisted_award_digest: awardDigest,
      decision_digest: decisionDigest,
      decision_digest_source: history.decision_digest.source,
      decision_digest_rule: history.decision_digest.canonical_rule,
    },
    lines,
    current_counts: {
      purchase_orders: currentPoCount,
      purchase_order_lines: currentPoLineCount,
      delivery_plans: currentDeliveryPlanCount,
    },
    planned_result: {
      conversion_operation_count: 1,
      purchase_order_aggregate_count: groups.size,
      purchase_order_line_count: lines.length,
      delivery_plan_aggregate_count: lines.length,
      delivery_plan_line_count: 0,
      receiving_queue_entry_count: lines.length,
      delivery_plan_event_count: lines.length,
      totals_by_currency: totalsByCurrency,
      planned_delivery_dates: [...new Set(lines.map((line) => line.promised_delivery_date))].sort(),
    },
    model_capabilities: {
      external_reference: false,
      external_reference_note: "当前PO模型未采集外部参考",
      remark: true,
      remark_max_length: 2000,
      delivery_plan_semantics: "每个Delivery Plan记录是直接唯一绑定一条PO Line的独立计划聚合；模型没有单独的Delivery Plan Line实体。",
    },
    protected_boundaries: {
      upstream_unchanged: ["Award", "RFQ", "Quote", "Comparison"],
      not_created: ["Receipt", "Warehouse Receipt", "Inventory Ledger", "IQC", "AP", "Payment", "Work Order", "其他生产记录", "其他财务记录"],
      next_stage: "供应商到货、仓库收货和IQC必须由后续独立任务完成。",
    },
    confirmation: {
      expected_award_version: awardVersion,
      expected_rfq_id: Number(rfqId),
      expected_rfq_version: rfqVersion,
      expected_comparison_version: comparisonVersion,
      expected_comparison_output_digest: comparisonOutputDigest,
      expected_award_digest: awardDigest,
      expected_decision_digest: decisionDigest,
      expected_po_count: currentPoCount,
      expected_delivery_plan_count: currentDeliveryPlanCount,
      expected_award_line_ids: lines.map((line) => line.award_line_id),
    },
    po_convertible_now: true,
  };
}

export type AwardConversionPreview = ReturnType<typeof buildAwardConversionPreview>;
