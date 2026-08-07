import type {
  ComparisonMaterialOffer,
  ComparisonMaterialSummary,
  ComparisonReadModel,
  ComparisonSupplierSummary,
  ComparisonVersionReadModel,
} from "./comparison-aggregate-view";

export const awardReasonLabels = {
  LOWEST_PRICE: "最低价",
  DELIVERY_PRIORITY: "交期优先",
  SOLE_SOURCE: "单一来源",
  LATE_DELIVERY_ACCEPTED: "接受延期交付",
  COMMERCIAL_TERMS: "商务条款",
  OTHER: "其他",
} as const;

export type AwardReasonCode = keyof typeof awardReasonLabels;
const nonLowestReasonCodes = new Set<AwardReasonCode>(["DELIVERY_PRIORITY", "COMMERCIAL_TERMS", "OTHER"]);

type AwardDetailLine = Readonly<{
  id: string | number;
  line_no: number;
  material_id?: string | number;
  internal_material_code: string;
  standard_name: string;
  unit_code: string;
  requested_quantity: string;
  required_date: string;
}>;

export type AwardCandidateDetail = Readonly<{
  header: Readonly<{
    id: string | number;
    rfq_code: string;
    round_no: number;
    version: number;
  }>;
  lines: AwardDetailLine[];
  comparison_read_model: ComparisonReadModel;
}>;

export type AwardRequestLine = Readonly<{
  rfq_line_id: string;
  comparison_line_id: string;
  comparison_basis_digest: string;
  selected_candidate_id: string;
  expected_quote_id: string;
  expected_quote_version_no: number;
  selection_reason: string;
  late_delivery_reason_code: string;
  late_delivery_reason: string;
  excess_quantity_reason: string;
}>;

export type AwardRequest = Readonly<{
  expected_version: number;
  expected_rfq_code: string;
  expected_round_no: number;
  expected_comparison_version: number;
  expected_comparison_output_digest: string;
  reason_code: AwardReasonCode;
  reason: string;
  lines: AwardRequestLine[];
}>;

export type AwardDraftLine = Readonly<{
  rfq_line_id: string;
  comparison_line_id: string;
  comparison_basis_digest: string;
  line_no: number;
  material_id: string;
  internal_material_code: string;
  standard_name: string;
  unit_code: string;
  required_date: string;
  candidate: ComparisonMaterialOffer;
}>;

export type AwardDraft = Readonly<{
  request: AwardRequest;
  rfq: Readonly<{ id: string; rfq_code: string; round_no: number; version: number }>;
  comparison: Readonly<{
    version_no: number;
    status: ComparisonVersionReadModel["status"];
    awardable_now: boolean;
    output_digest: string;
    request_id: string;
  }>;
  lines: AwardDraftLine[];
  quote_summaries: ComparisonSupplierSummary[];
  reason_label: string;
  selected_total_amount: string;
  lowest_total_amount: string;
  amount_difference: string;
  percentage_difference: string;
  currency_code: string;
  selected_supplier: ComparisonSupplierSummary | null;
  lowest_supplier: ComparisonSupplierSummary | null;
  delivery_day_difference: number | null;
  delivery_comparison: string | null;
}>;

export class AwardSelectionError extends Error {}

const DECIMAL = /^\d+(?:\.\d{1,6})?$/;
const SCALE = 1_000_000n;

export function canonicalStableId(value: unknown, field = "ID") {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) throw new AwardSelectionError(`${field}不是有效的稳定正整数 ID`);
    return String(value);
  }
  const text = typeof value === "string" ? value : "";
  if (!/^[1-9]\d*$/.test(text)) throw new AwardSelectionError(`${field}不是有效的稳定正整数 ID`);
  return text;
}

function compareStableId(left: string, right: string) {
  return left.length - right.length || left.localeCompare(right);
}

function scaled(value: string, field: string) {
  const text = String(value);
  if (!DECIMAL.test(text)) throw new AwardSelectionError(`${field}不是有效的最多 6 位小数`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function decimal(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / SCALE}.${String(absolute % SCALE).padStart(6, "0")}`;
}

function boundedFormText(form: Pick<FormData, "get">, name: string, maximum: number, required = false) {
  const value = String(form.get(name) || "").trim();
  if ((required && !value) || value.length > maximum) throw new AwardSelectionError(`${name}长度必须在 ${required ? `1—${maximum}` : `0—${maximum}`} 字符之间`);
  return value;
}

function currentVersion(model: ComparisonReadModel) {
  const version = model.current_version;
  if (!version || version.status !== "CURRENT" || !version.awardable_now) {
    throw new AwardSelectionError("当前 Comparison 不是可定标的 CURRENT Version，请刷新后重新核对");
  }
  return version;
}

export function awardCandidatesForRfqLine(model: ComparisonReadModel, rfqLineId: unknown) {
  const lineId = canonicalStableId(rfqLineId, "RFQ Line ID");
  const version = model.current_version;
  if (!version || version.status !== "CURRENT" || !version.awardable_now) return [];
  const material = version.material_summaries.find((row) => canonicalStableId(row.rfq_line_id, "Candidate RFQ Line ID") === lineId);
  if (!material) return [];
  const comparisonLineId = canonicalStableId(material.comparison_line_id, "Comparison Line ID");
  return material.offers.filter((candidate) =>
    canonicalStableId(candidate.comparison_line_id, "Candidate Comparison Line ID") === comparisonLineId
      && candidate.quote_input_current === true
      && candidate.comparable_status === "COMPARABLE"
      && candidate.awardable === true,
  ).sort((left, right) => compareStableId(
    canonicalStableId(left.comparison_candidate_id, "Candidate ID"),
    canonicalStableId(right.comparison_candidate_id, "Candidate ID"),
  ));
}

export function awardCandidateOptionLabel(candidate: ComparisonMaterialOffer) {
  const delivery = candidate.delivery_status === "ON_TIME"
    ? candidate.early_days > 0 ? `提前${candidate.early_days}天` : "按需求日期交付"
    : `延期${candidate.late_days}天`;
  return `${candidate.supplier_code}/${candidate.supplier_name} · Candidate ID ${candidate.comparison_candidate_id} · Quote ID ${candidate.quote_id}/v${candidate.quote_version_no} · 单价 ${decimalDisplay(candidate.unit_price, 2)} ${candidate.currency_code} · 行金额 ${decimalDisplay(candidate.line_amount, 2)} ${candidate.currency_code} · 承诺日期 ${String(candidate.promised_delivery_date).slice(0, 10)} · ${candidate.delivery_status} / ${delivery} · 价格排名${candidate.price_rank ?? "—"}`;
}

export function decimalDisplay(value: string, minimumFraction = 0) {
  const raw = String(value ?? "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw || "—";
  const [whole, fraction = ""] = raw.split(".");
  const visible = fraction.replace(/0+$/, "").padEnd(minimumFraction, "0");
  return visible ? `${whole}.${visible}` : whole;
}

function materialForLine(version: ComparisonVersionReadModel, rfqLineId: string): ComparisonMaterialSummary {
  const material = version.material_summaries.find((row) => canonicalStableId(row.rfq_line_id, "Comparison RFQ Line ID") === rfqLineId);
  if (!material) throw new AwardSelectionError(`RFQ Line ${rfqLineId} 没有 CURRENT Comparison Line`);
  return material;
}

function fixedQuoteSummaries(version: ComparisonVersionReadModel) {
  const summaries = version.supplier_summaries.map((summary) => {
    const supplierId = canonicalStableId(summary.supplier_id, "Quote Supplier ID");
    const quoteId = canonicalStableId(summary.quote_id, "Quote ID");
    if (!Number.isSafeInteger(summary.quote_version_no) || summary.quote_version_no < 1) {
      throw new AwardSelectionError(`Quote ${quoteId} Version不是有效正整数`);
    }
    return { ...summary, supplier_id: supplierId, quote_id: quoteId };
  }).sort((left, right) => compareStableId(left.supplier_id, right.supplier_id));
  if (!summaries.length) throw new AwardSelectionError("CURRENT Comparison 缺少固定 Quote 汇总");

  const summaryKeys = new Set<string>();
  const supplierIds = new Set<string>();
  for (const summary of summaries) {
    const key = `${summary.supplier_id}:${summary.quote_id}:v${summary.quote_version_no}`;
    if (supplierIds.has(summary.supplier_id) || summaryKeys.has(key)) {
      throw new AwardSelectionError(`Supplier ${summary.supplier_id} 的固定 Quote 汇总不唯一`);
    }
    supplierIds.add(summary.supplier_id);
    summaryKeys.add(key);
  }

  const fixedInputKeys = new Set<string>();
  for (const input of version.fixed_quote_inputs) {
    const supplierId = canonicalStableId(input.supplier_id, "固定 Quote Supplier ID");
    const quoteId = canonicalStableId(input.quote_id, "固定 Quote ID");
    if (!Number.isSafeInteger(input.quote_version_no) || input.quote_version_no < 1 || input.quote_input_current !== true) {
      throw new AwardSelectionError(`固定 Quote ${quoteId} Version或CURRENT状态无效`);
    }
    const key = `${supplierId}:${quoteId}:v${input.quote_version_no}`;
    if (!summaryKeys.has(key)) throw new AwardSelectionError(`固定 Quote ${quoteId}/v${input.quote_version_no} 与汇总不一致`);
    fixedInputKeys.add(key);
  }
  if ([...summaryKeys].some((key) => !fixedInputKeys.has(key))) {
    throw new AwardSelectionError("固定 Quote 输入与 Supplier 汇总不完整");
  }
  return summaries;
}

export function buildAwardDraft(detail: AwardCandidateDetail, form: Pick<FormData, "get">): AwardDraft {
  const version = currentVersion(detail.comparison_read_model);
  const quoteSummaries = fixedQuoteSummaries(version);
  const reasonCode = boundedFormText(form, "reason_code", 64, true) as AwardReasonCode;
  if (!Object.hasOwn(awardReasonLabels, reasonCode)) throw new AwardSelectionError("请选择合法的定标理由代码");
  const reason = boundedFormText(form, "reason", 1000, true);
  const seenCandidates = new Set<string>();
  let hasSoleSourceLine = false;
  const draftLines: AwardDraftLine[] = [];
  const requestLines: AwardRequestLine[] = [];

  for (const line of detail.lines) {
    const rfqLineId = canonicalStableId(line.id, "RFQ Line ID");
    const material = materialForLine(version, rfqLineId);
    const candidateId = canonicalStableId(form.get(`candidate_${rfqLineId}`), `RFQ Line ${line.line_no} Candidate ID`);
    const candidates = awardCandidatesForRfqLine(detail.comparison_read_model, rfqLineId);
    if (candidates.length === 1) hasSoleSourceLine = true;
    const candidate = candidates.find((row) => canonicalStableId(row.comparison_candidate_id, "Candidate ID") === candidateId);
    if (!candidate) throw new AwardSelectionError(`Candidate ${candidateId} 不属于 RFQ Line ${rfqLineId} 的 CURRENT Comparison`);
    if (seenCandidates.has(candidateId)) throw new AwardSelectionError(`Candidate ${candidateId} 不能跨 RFQ Line 重复使用`);
    seenCandidates.add(candidateId);
    const candidateSupplierId = canonicalStableId(candidate.supplier_id, "Candidate Supplier ID");
    const candidateQuoteId = canonicalStableId(candidate.quote_id, "Candidate Quote ID");
    const quoteSummary = quoteSummaries.find((summary) => summary.supplier_id === candidateSupplierId);
    if (!quoteSummary || quoteSummary.quote_id !== candidateQuoteId || quoteSummary.quote_version_no !== candidate.quote_version_no) {
      throw new AwardSelectionError(`Candidate ${candidateId} 的固定 Quote 引用与 CURRENT Comparison 汇总不一致`);
    }

    const comparisonLineId = canonicalStableId(material.comparison_line_id, "Comparison Line ID");
    const comparisonRow = version.comparison_rows.find((row) => canonicalStableId(row.comparison_line_id, "Comparison Line ID") === comparisonLineId);
    if (!comparisonRow || canonicalStableId(comparisonRow.rfq_line_id, "Comparison RFQ Line ID") !== rfqLineId) {
      throw new AwardSelectionError(`RFQ Line ${rfqLineId} 的 Comparison Line 或 basis_digest 缺失`);
    }
    const selectionReason = boundedFormText(form, `selection_reason_${rfqLineId}`, 1000);
    const lateCode = boundedFormText(form, `late_code_${rfqLineId}`, 64);
    const lateReason = boundedFormText(form, `late_reason_${rfqLineId}`, 1000);
    const excessReason = boundedFormText(form, `excess_reason_${rfqLineId}`, 1000);
    if (candidate.price_rank !== 1 && !nonLowestReasonCodes.has(reasonCode)
      && !(reasonCode === "SOLE_SOURCE" && candidates.length === 1)) {
      throw new AwardSelectionError(`Candidate ${candidateId} 不是最低价，必须选择合法的非最低价理由代码并填写完整理由`);
    }
    if (candidate.delivery_status === "LATE" && (lateCode !== "LATE_DELIVERY_ACCEPTED" || !lateReason)) {
      throw new AwardSelectionError(`Candidate ${candidateId} 晚于需求日期，必须选择 LATE_DELIVERY_ACCEPTED 并填写接受理由`);
    }
    if (candidate.delivery_status !== "LATE" && (lateCode || lateReason)) {
      throw new AwardSelectionError(`Candidate ${candidateId} 准时交付，不得填写晚交期接受代码或理由`);
    }
    if (scaled(candidate.quoted_quantity, "Candidate 数量") > scaled(material.requested_quantity, "RFQ 申请数量") && !excessReason) {
      throw new AwardSelectionError(`Candidate ${candidateId} 数量超过申请数量，必须填写超量原因`);
    }

    draftLines.push({
      rfq_line_id: rfqLineId,
      comparison_line_id: comparisonLineId,
      comparison_basis_digest: comparisonRow.basis_digest,
      line_no: line.line_no,
      material_id: canonicalStableId(material.material_id, "Material ID"),
      internal_material_code: material.internal_material_code,
      standard_name: material.standard_name,
      unit_code: material.unit_code,
      required_date: material.required_date,
      candidate,
    });
    requestLines.push({
      rfq_line_id: rfqLineId,
      comparison_line_id: comparisonLineId,
      comparison_basis_digest: comparisonRow.basis_digest,
      selected_candidate_id: candidateId,
      expected_quote_id: canonicalStableId(candidate.quote_id, "Quote ID"),
      expected_quote_version_no: candidate.quote_version_no,
      selection_reason: selectionReason,
      late_delivery_reason_code: lateCode,
      late_delivery_reason: lateReason,
      excess_quantity_reason: excessReason,
    });
  }

  if (hasSoleSourceLine && reasonCode !== "SOLE_SOURCE") {
    throw new AwardSelectionError("存在单一有效 Candidate 的 RFQ Line，必须选择单一来源理由");
  }
  if (!hasSoleSourceLine && reasonCode === "SOLE_SOURCE") {
    throw new AwardSelectionError("当前每条 RFQ Line 均有多个有效 Candidate，不能选择单一来源理由");
  }
  if (requestLines.length !== version.comparison_rows.length) {
    throw new AwardSelectionError("定标必须完整覆盖 CURRENT Comparison 的全部 RFQ Line");
  }
  const selectedTotal = draftLines.reduce((sum, row) => sum + scaled(row.candidate.line_amount, "Candidate 行金额"), 0n);
  const lowestCandidates = version.material_summaries.map((material) => {
    const lowest = material.offers.find((candidate) => candidate.lowest_price && candidate.quote_input_current && candidate.comparable_status === "COMPARABLE");
    if (!lowest) throw new AwardSelectionError(`Comparison Line ${material.comparison_line_id} 缺少当前最低价 Candidate`);
    return lowest;
  });
  const lowestTotal = lowestCandidates.reduce((sum, candidate) => sum + scaled(candidate.line_amount, "最低价 Candidate 行金额"), 0n);
  const difference = selectedTotal - lowestTotal;
  const percentage = lowestTotal === 0n ? 0n : (difference * 100n * SCALE + lowestTotal / 2n) / lowestTotal;
  const selectedSupplierIds = new Set(draftLines.map((row) => canonicalStableId(row.candidate.supplier_id, "Supplier ID")));
  const selectedSupplierId = selectedSupplierIds.size === 1 ? [...selectedSupplierIds][0] : null;
  const lowestSupplierId = version.aggregate_differences?.lowest_price_supplier_id || null;
  const selectedSupplier = selectedSupplierId ? quoteSummaries.find((row) => row.supplier_id === selectedSupplierId) || null : null;
  const lowestSupplier = lowestSupplierId ? quoteSummaries.find((row) => row.supplier_id === lowestSupplierId) || null : null;
  const deliveryDayDifference = selectedSupplier && lowestSupplier && selectedSupplier.supplier_id !== lowestSupplier.supplier_id
    ? version.aggregate_differences?.delivery_day_difference ?? null
    : 0;
  const deliveryComparison = selectedSupplier && lowestSupplier && selectedSupplier.supplier_id !== lowestSupplier.supplier_id && deliveryDayDifference !== null
    ? selectedSupplier.latest_promised_delivery_date < lowestSupplier.latest_promised_delivery_date
      ? `${selectedSupplier.supplier_code} 比 ${lowestSupplier.supplier_code} 早 ${deliveryDayDifference} 天。`
      : selectedSupplier.latest_promised_delivery_date > lowestSupplier.latest_promised_delivery_date
        ? `${selectedSupplier.supplier_code} 比 ${lowestSupplier.supplier_code} 晚 ${deliveryDayDifference} 天。`
        : `${selectedSupplier.supplier_code} 与 ${lowestSupplier.supplier_code} 的最晚承诺日期相同。`
    : null;
  const currencyCodes = new Set([
    ...draftLines.map((row) => row.candidate.currency_code),
    ...lowestCandidates.map((candidate) => candidate.currency_code),
  ]);
  const currencyCode = currencyCodes.size === 1 ? [...currencyCodes][0] : "多币种";
  const request: AwardRequest = {
    expected_version: detail.header.version,
    expected_rfq_code: detail.header.rfq_code,
    expected_round_no: detail.header.round_no,
    expected_comparison_version: version.comparison_version_no,
    expected_comparison_output_digest: version.output_summary.digest,
    reason_code: reasonCode,
    reason,
    lines: requestLines,
  };
  return {
    request,
    rfq: { id: canonicalStableId(detail.header.id, "RFQ ID"), rfq_code: detail.header.rfq_code, round_no: detail.header.round_no, version: detail.header.version },
    comparison: {
      version_no: version.comparison_version_no,
      status: version.status,
      awardable_now: version.awardable_now,
      output_digest: version.output_summary.digest,
      request_id: version.request_id,
    },
    lines: draftLines,
    quote_summaries: quoteSummaries,
    reason_label: awardReasonLabels[reasonCode],
    selected_total_amount: decimal(selectedTotal),
    lowest_total_amount: decimal(lowestTotal),
    amount_difference: decimal(difference),
    percentage_difference: decimal(percentage),
    currency_code: currencyCode,
    selected_supplier: selectedSupplier,
    lowest_supplier: lowestSupplier,
    delivery_day_difference: deliveryDayDifference,
    delivery_comparison: deliveryComparison,
  };
}
