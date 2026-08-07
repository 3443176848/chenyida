import { canonicalDigest } from "./validation.ts";

type StableId = string | number | bigint;

export type ComparisonReadModelRow = Readonly<{
  comparison_version_no: number;
  comparison_id: StableId;
  comparison_candidate_id: StableId;
  basis_digest: string;
  rfq_line_id: StableId;
  quote_id: StableId;
  quote_version_no: number;
  quote_line_id: StableId;
  quote_input_current: boolean;
  supplier_id: StableId;
  supplier_code: string;
  supplier_name: string;
  supplier_quote_reference: string;
  currency_code: string;
  valid_until: string;
  payment_terms: string;
  tax_included: boolean;
  freight_included: boolean;
  material_id: StableId;
  internal_material_code: string;
  standard_name: string;
  requested_quantity: string;
  quoted_quantity: string;
  unit_code: string;
  unit_price: string;
  line_amount: string;
  price_rank: number | null;
  lowest_price: boolean;
  promised_delivery_date: string;
  required_date: string;
  delivery_status: "ON_TIME" | "LATE";
  early_days: number;
  late_days: number;
  comparable_status: string;
  awardable: boolean;
}>;

export type ComparisonReadModelEvent = Readonly<{
  event_id: StableId;
  event_type: string;
  comparison_id: StableId | null;
  rfq_line_id: StableId | null;
  material_id: StableId | null;
  internal_material_code: string | null;
  actor: string;
  occurred_at_shanghai: string;
  request_id: string;
  result: string;
  comparison_version_no: number | null;
  rfq_old_version: number | null;
  rfq_new_version: number | null;
}>;

export type ComparisonDerivedReadModel = Readonly<{
  fixed_quote_inputs: Array<Record<string, unknown>>;
  output_summary: Readonly<{
    digest: string;
    canonical_rows: Array<Record<string, string | number | boolean | null>>;
    note: string;
  }>;
  supplier_summaries: Array<Record<string, unknown>>;
  material_summaries: Array<Record<string, unknown>>;
  aggregate_differences: Record<string, unknown> | null;
  operation_receipts: Array<Record<string, unknown>>;
}>;

const SCALE = 1_000_000n;
const DECIMAL = /^-?\d+(?:\.\d{1,6})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function id(value: StableId) {
  const result = String(value);
  if (!/^[1-9]\d*$/.test(result)) throw new Error(`invalid stable id: ${result}`);
  return result;
}

function compareId(left: StableId, right: StableId) {
  const a = BigInt(id(left));
  const b = BigInt(id(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

function scaled(value: string) {
  const raw = String(value);
  if (!DECIMAL.test(raw)) throw new Error(`invalid decimal: ${raw}`);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -result : result;
}

function decimal(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / SCALE}.${String(absolute % SCALE).padStart(6, "0")}`;
}

function dateEpoch(value: string) {
  if (!DATE.test(value)) throw new Error(`invalid date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateDifference(left: string, right: string) {
  return Math.abs(Math.round((dateEpoch(left) - dateEpoch(right)) / 86_400_000));
}

function deliveryExplanation(status: "ON_TIME" | "LATE", earlyDays: number, lateDays: number) {
  if (status === "LATE") return `延期${lateDays}天`;
  return earlyDays > 0 ? `提前${earlyDays}天` : "按需求日期交付";
}

function sameValue(rows: ComparisonReadModelRow[], field: keyof ComparisonReadModelRow) {
  const values = new Set(rows.map((row) => String(row[field])));
  if (values.size !== 1) throw new Error(`comparison rows disagree on ${String(field)}`);
  return rows[0][field];
}

export function buildComparisonReadModel(input: Readonly<{
  rows: ComparisonReadModelRow[];
  events?: ComparisonReadModelEvent[];
}>): ComparisonDerivedReadModel {
  const rows = [...input.rows];
  if (!rows.length) throw new Error("comparison version has no output rows");
  const versionNo = Number(sameValue(rows, "comparison_version_no"));
  if (!Number.isSafeInteger(versionNo) || versionNo < 1) throw new Error("invalid comparison version");

  const ordered = rows.sort((left, right) => compareId(left.material_id, right.material_id)
    || compareId(left.supplier_id, right.supplier_id)
    || compareId(left.comparison_id, right.comparison_id)
    || compareId(left.comparison_candidate_id, right.comparison_candidate_id));
  const canonicalRows = ordered.map((row) => ({
    comparison_version_no: versionNo,
    comparison_line_id: id(row.comparison_id),
    comparison_candidate_id: id(row.comparison_candidate_id),
    fixed_quote_line_id: id(row.quote_line_id),
    material_id: id(row.material_id),
    supplier_id: id(row.supplier_id),
    quantity: decimal(scaled(row.quoted_quantity)),
    unit_price: decimal(scaled(row.unit_price)),
    line_amount: decimal(scaled(row.line_amount)),
    price_rank: row.price_rank,
    promised_delivery_date: row.promised_delivery_date,
    delivery_status: row.delivery_status,
    early_days: row.early_days,
    late_days: row.late_days,
  }));

  const fixedQuoteInputs = ordered.map((row) => ({
    comparison_id: id(row.comparison_id),
    comparison_line_id: id(row.comparison_id),
    comparison_candidate_id: id(row.comparison_candidate_id),
    quote_id: id(row.quote_id),
    quote_version_no: row.quote_version_no,
    quote_line_id: id(row.quote_line_id),
    supplier_id: id(row.supplier_id),
    supplier_code: row.supplier_code,
    supplier_name: row.supplier_name,
    supplier_quote_reference: row.supplier_quote_reference,
    currency_code: row.currency_code,
    material_id: id(row.material_id),
    internal_material_code: row.internal_material_code,
    quote_input_current: row.quote_input_current,
  }));

  const bySupplier = new Map<string, ComparisonReadModelRow[]>();
  for (const row of ordered) {
    const supplierId = id(row.supplier_id);
    bySupplier.set(supplierId, [...(bySupplier.get(supplierId) || []), row]);
  }
  const supplierSummaries = [...bySupplier.entries()].sort(([left], [right]) => compareId(left, right)).map(([supplierId, supplierRows]) => {
    for (const field of ["supplier_code", "supplier_name", "quote_id", "quote_version_no", "supplier_quote_reference", "currency_code", "valid_until", "payment_terms", "tax_included", "freight_included"] as const) sameValue(supplierRows, field);
    const total = supplierRows.reduce((sum, row) => sum + scaled(row.line_amount), 0n);
    const lateRows = supplierRows.filter((row) => row.delivery_status === "LATE");
    const deliveryStatus: "ON_TIME" | "LATE" = lateRows.length ? "LATE" : "ON_TIME";
    const deliveryDeltaDays = deliveryStatus === "LATE"
      ? Math.max(...lateRows.map((row) => row.late_days))
      : Math.min(...supplierRows.map((row) => row.early_days));
    const latestPromised = supplierRows.map((row) => row.promised_delivery_date).sort().at(-1) || "";
    return {
      supplier_id: supplierId,
      supplier_code: supplierRows[0].supplier_code,
      supplier_name: supplierRows[0].supplier_name,
      quote_id: id(supplierRows[0].quote_id),
      quote_version_no: supplierRows[0].quote_version_no,
      supplier_quote_reference: supplierRows[0].supplier_quote_reference,
      total_amount: decimal(total),
      currency_code: supplierRows[0].currency_code,
      latest_promised_delivery_date: latestPromised,
      delivery_status: deliveryStatus,
      delivery_delta_days: deliveryDeltaDays,
      delivery_explanation: deliveryExplanation(deliveryStatus, deliveryStatus === "ON_TIME" ? deliveryDeltaDays : 0, deliveryStatus === "LATE" ? deliveryDeltaDays : 0),
      valid_until: supplierRows[0].valid_until,
      payment_terms: supplierRows[0].payment_terms,
      tax_included: supplierRows[0].tax_included,
      freight_included: supplierRows[0].freight_included,
    };
  });

  const byMaterial = new Map<string, ComparisonReadModelRow[]>();
  for (const row of ordered) {
    const materialId = id(row.material_id);
    byMaterial.set(materialId, [...(byMaterial.get(materialId) || []), row]);
  }
  const materialSummaries = [...byMaterial.entries()].sort(([left], [right]) => compareId(left, right)).map(([, materialRows]) => {
    for (const field of ["comparison_id", "basis_digest", "rfq_line_id", "material_id", "internal_material_code", "standard_name", "requested_quantity", "unit_code", "required_date"] as const) sameValue(materialRows, field);
    const amounts = materialRows.map((row) => scaled(row.line_amount));
    const maximumAmount = amounts.reduce((maximum, value) => value > maximum ? value : maximum, amounts[0]);
    const minimumAmount = amounts.reduce((minimum, value) => value < minimum ? value : minimum, amounts[0]);
    const offers = [...materialRows].sort((left, right) => compareId(left.supplier_id, right.supplier_id)).map((row) => ({
      comparison_line_id: id(row.comparison_id),
      comparison_candidate_id: id(row.comparison_candidate_id),
      quote_id: id(row.quote_id),
      quote_version_no: row.quote_version_no,
      quote_line_id: id(row.quote_line_id),
      quote_input_current: row.quote_input_current,
      supplier_id: id(row.supplier_id),
      supplier_code: row.supplier_code,
      supplier_name: row.supplier_name,
      currency_code: row.currency_code,
      quoted_quantity: decimal(scaled(row.quoted_quantity)),
      unit_price: decimal(scaled(row.unit_price)),
      line_amount: decimal(scaled(row.line_amount)),
      price_rank: row.price_rank,
      lowest_price: row.lowest_price,
      promised_delivery_date: row.promised_delivery_date,
      delivery_status: row.delivery_status,
      early_days: row.early_days,
      late_days: row.late_days,
      delivery_delta_days: row.delivery_status === "LATE" ? row.late_days : row.early_days,
      delivery_explanation: deliveryExplanation(row.delivery_status, row.early_days, row.late_days),
      comparable_status: row.comparable_status,
      awardable: row.awardable,
    }));
    return {
      comparison_id: id(materialRows[0].comparison_id),
      comparison_line_id: id(materialRows[0].comparison_id),
      rfq_line_id: id(materialRows[0].rfq_line_id),
      material_id: id(materialRows[0].material_id),
      internal_material_code: materialRows[0].internal_material_code,
      standard_name: materialRows[0].standard_name,
      requested_quantity: decimal(scaled(materialRows[0].requested_quantity)),
      unit_code: materialRows[0].unit_code,
      required_date: materialRows[0].required_date,
      basis_digest: materialRows[0].basis_digest,
      amount_difference: decimal(maximumAmount - minimumAmount),
      offers,
    };
  });

  let aggregateDifferences: Record<string, unknown> | null = null;
  if (supplierSummaries.length === 2) {
    const first = supplierSummaries[0];
    const second = supplierSummaries[1];
    const firstTotal = scaled(first.total_amount);
    const secondTotal = scaled(second.total_amount);
    const higher = firstTotal > secondTotal ? first : second;
    const lower = firstTotal > secondTotal ? second : first;
    const difference = scaled(higher.total_amount) - scaled(lower.total_amount);
    const base = scaled(lower.total_amount);
    const percentage = base === 0n ? 0n : (difference * 100n * SCALE + base / 2n) / base;
    const earlier = first.latest_promised_delivery_date <= second.latest_promised_delivery_date ? first : second;
    const later = earlier === first ? second : first;
    aggregateDifferences = {
      higher_supplier_id: higher.supplier_id,
      lower_supplier_id: lower.supplier_id,
      amount_difference: decimal(difference),
      percentage_basis_supplier_id: lower.supplier_id,
      percentage_difference: decimal(percentage),
      earlier_supplier_id: earlier.supplier_id,
      later_supplier_id: later.supplier_id,
      delivery_day_difference: dateDifference(earlier.latest_promised_delivery_date, later.latest_promised_delivery_date),
      lowest_price_supplier_id: lower.supplier_id,
      on_time_supplier_ids: supplierSummaries.filter((row) => row.delivery_status === "ON_TIME").map((row) => row.supplier_id),
      late_risk_supplier_ids: supplierSummaries.filter((row) => row.delivery_status === "LATE").map((row) => row.supplier_id),
    };
  }

  const groupedEvents = new Map<string, ComparisonReadModelEvent[]>();
  for (const event of input.events || []) {
    if (event.event_type !== "COMPARISON_GENERATED") continue;
    const key = JSON.stringify([event.actor, event.occurred_at_shanghai, event.request_id, event.result, event.comparison_version_no]);
    groupedEvents.set(key, [...(groupedEvents.get(key) || []), event]);
  }
  const operationReceipts = [...groupedEvents.values()].map((eventRows) => {
    const first = eventRows[0];
    const oldVersions = new Set(eventRows.map((event) => event.rfq_old_version));
    const newVersions = new Set(eventRows.map((event) => event.rfq_new_version));
    return {
      actor: first.actor,
      occurred_at_shanghai: first.occurred_at_shanghai,
      request_id: first.request_id,
      result: first.result,
      old_version: oldVersions.size === 1 ? first.rfq_old_version : null,
      new_version: newVersions.size === 1 ? first.rfq_new_version : null,
      comparison_version_no: first.comparison_version_no ?? versionNo,
      event_count: eventRows.length,
      events: [...eventRows].sort((left, right) => compareId(left.event_id, right.event_id)).map((event) => ({
        event_id: id(event.event_id),
        comparison_line_id: event.comparison_id === null ? "" : id(event.comparison_id),
        rfq_line_id: event.rfq_line_id === null ? "" : id(event.rfq_line_id),
        material_id: event.material_id === null ? "" : id(event.material_id),
        internal_material_code: event.internal_material_code || "",
      })),
    };
  });

  return {
    fixed_quote_inputs: fixedQuoteInputs,
    output_summary: {
      digest: canonicalDigest(canonicalRows),
      canonical_rows: canonicalRows,
      note: "确定性输出摘要，由不可变Comparison Line重算；不是伪造的历史持久化字段。",
    },
    supplier_summaries: supplierSummaries,
    material_summaries: materialSummaries,
    aggregate_differences: aggregateDifferences,
    operation_receipts: operationReceipts,
  };
}
