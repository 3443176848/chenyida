import type { MaterialImportRawCell, MaterialImportRawRow } from "../material-import/parser-model.ts";
import {
  MATERIAL_STANDARD_COLUMNS,
  MATERIAL_STANDARDIZATION_VERSION,
  type MaterialStandardColumnKey,
  type MaterialStandardizationInput,
  type MaterialStandardizationIssue,
  type MaterialStandardizationMappingItem,
  type MaterialStandardizationProfile,
  type MaterialStandardizationProjection,
  type MaterialStandardizationRow,
  type MaterialStandardizationSourceField,
} from "./types.ts";

const MAX_TEXT_LENGTH = 30_000;
const PROJECT_FROM_FILENAME = /^(G\d+(?:-G?\d+)?|[A-Z]?\d{3,4}[A-Z]?)(?=量产|项目|[_\s-]|\.|$)/i;
const PROJECT_FROM_TITLE = /(?:^|[^A-Z0-9])(G\d+(?:-G?\d+)?|[A-Z]?\d{3,4}[A-Z]?)(?=[^A-Z0-9]|$)/i;
const INTERNAL_MODEL = /(?:^|[^A-Z0-9])(\d(?:SD|SH|PF|P)\d{5,6}[A-Z]?)(?=[^A-Z0-9]|$)/i;
const J_MODEL = /(?:^|[^A-Z0-9])(J\d+[_-]SUBA\d+[_-]V\d+)(?=[^A-Z0-9]|$)/i;

type MutableValues = Record<MaterialStandardColumnKey, string>;
type MutableRow = {
  sequence: number;
  source_row_number: number;
  alternative_source_rows: number[];
  values: MutableValues;
  issues: MaterialStandardizationIssue[];
};
type CellRead = Readonly<{ value: string; unsafe: boolean }>;
type SourceContext = Readonly<{ project: string; boardType: string; internalModel: string }>;

const HEADER_ALIASES: Readonly<Record<MaterialStandardColumnKey, readonly string[]>> = Object.freeze({
  sequence: ["序号", "项次", "编号", "item", "no"],
  project: ["项目号", "项目编号", "项目", "project", "projectno"],
  board_type: ["板子类型", "板类型", "板型", "板类别", "pcba类型"],
  internal_model: ["内部型号", "内部机型", "成品型号", "整机型号", "机型", "internalmodel"],
  specification: ["物料规格描述", "物料名称及描述", "物料描述", "规格描述", "规格型号", "规格", "描述", "物料名称", "品名", "description"],
  brand: ["品牌", "生产厂商", "生产厂家", "制造商", "厂家", "manufacturer", "vendor", "brand"],
  usage: ["用量", "单机用量", "普通用量", "数量", "qty", "quantity"],
  alternative: ["替代料", "备选料", "替代型号", "alternative", "alternate"],
  supplier: ["供应商", "供应商名称", "供方", "supplier", "suppliername"],
  order_quantity: ["订单数量", "订单数", "生产数量", "投产数量", "orderquantity"],
  demand_quantity: ["需求数量", "需求数", "总需求", "demandquantity"],
  purchase_quantity: ["购买数量", "采购数量", "需购数量", "purchasequantity"],
  inventory: ["库存数", "库存数量", "现有库存", "库存", "inventory", "stock"],
});

const STATUS_ALIASES = Object.freeze(["状态", "物料状态", "主替状态", "类型", "status"]);
const PART_NUMBER_ALIASES = Object.freeze(["型号", "物料型号", "厂商物料编码", "供应商料号", "制造商料号", "manufacturerpartnumber", "partno", "mpn"]);
const ALTERNATIVE_STATUS = new Set(["替代料", "替代", "备选料", "备选", "alternative", "alternate"]);

const BOARD_MARKERS: readonly Readonly<{ tokens: readonly string[]; label: string }>[] = Object.freeze([
  Object.freeze({ tokens: ["PSSENSOR", "光感"], label: "光感小板" }),
  Object.freeze({ tokens: ["SUBLCM"], label: "屏小板" }),
  Object.freeze({ tokens: ["屏排线"], label: "屏排线" }),
  Object.freeze({ tokens: ["主FPC"], label: "主FPC" }),
  Object.freeze({ tokens: ["充电FPC"], label: "充电FPC" }),
  Object.freeze({ tokens: ["SIM-FPC", "SIM FPC"], label: "SIM FPC" }),
  Object.freeze({ tokens: ["TYPE-C耳机"], label: "TYPE-C耳机小板" }),
  Object.freeze({ tokens: ["TYPE-C", "TYPEC"], label: "TYPE-C小板" }),
  Object.freeze({ tokens: ["USB"], label: "USB小板" }),
  Object.freeze({ tokens: ["MOTOR", "马达"], label: "马达小板" }),
  Object.freeze({ tokens: ["WIFI"], label: "WiFi小板" }),
  Object.freeze({ tokens: ["闪光灯"], label: "闪光灯" }),
  Object.freeze({ tokens: ["ANT", "天线"], label: "天线小板" }),
  Object.freeze({ tokens: ["SUB"], label: "SUB小板" }),
]);

const MAPPING_TARGETS: Readonly<Record<"specification" | "brand" | "usage" | "supplier", readonly string[]>> = Object.freeze({
  specification: [
    "supplier_reference\u0000SUPPLIER_SPECIFICATION",
    "basic\u0000SPECIFICATION_MODEL",
    "basic\u0000DESCRIPTION",
    "basic\u0000STANDARD_NAME",
    "supplier_reference\u0000SUPPLIER_ITEM_CODE",
  ],
  brand: ["basic\u0000BRAND", "basic\u0000MANUFACTURER"],
  usage: ["supplier_reference\u0000SOURCE_QUANTITY"],
  supplier: ["supplier_reference\u0000SUPPLIER_NAME"],
});

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, MAX_TEXT_LENGTH);
}

export function normalizeStandardizationHeader(value: unknown): string {
  return text(value).normalize("NFKC").toLowerCase().replace(/[\s\-_/\\:：()（）\[\]【】.]+/g, "");
}

function normalizedCandidates(value: unknown): readonly string[] {
  const source = text(value);
  const candidates = [source, ...source.split(/[>›|｜]/g)];
  return Object.freeze([...new Set(candidates.map(normalizeStandardizationHeader).filter(Boolean))]);
}

function matchesAlias(field: MaterialStandardizationSourceField, aliases: readonly string[]): boolean {
  const candidates = normalizedCandidates(field.source_header || field.normalized_header || "");
  const normalizedAliases = aliases.map(normalizeStandardizationHeader);
  return candidates.some((candidate) => normalizedAliases.includes(candidate));
}

function sourceIndex(fields: readonly MaterialStandardizationSourceField[], aliases: readonly string[]): number | null {
  const found = fields.find((field) => Number.isInteger(field.column_index) && field.column_index >= 0 && matchesAlias(field, aliases));
  return found ? fieldIndex(found) : null;
}

function fieldIndex(field: MaterialStandardizationSourceField): number {
  return Number(field.column_index);
}

function cells(raw: unknown): readonly MaterialImportRawCell[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const value = (raw as MaterialImportRawRow).cells;
  return Array.isArray(value) ? value.filter((cell): cell is MaterialImportRawCell => Boolean(cell) && typeof cell === "object" && !Array.isArray(cell)) : [];
}

function cell(raw: unknown, index: number | null): CellRead {
  if (index === null || index < 0) return { value: "", unsafe: false };
  const found = cells(raw).find((item) => Number(item.column_index) === index);
  if (!found) return { value: "", unsafe: false };
  if (found.type === "FORMULA" || found.type === "ERROR") return { value: "", unsafe: true };
  return { value: text(found.display ?? found.raw_value), unsafe: false };
}

function issue(code: string, message: string, level: "WARNING" | "ERROR" = "WARNING"): MaterialStandardizationIssue {
  return Object.freeze({ code, message, level });
}

function addIssue(output: MaterialStandardizationIssue[], value: MaterialStandardizationIssue): void {
  if (!output.some((item) => item.code === value.code && item.message === value.message)) output.push(value);
}

function readDirect(raw: unknown, index: number | null, label: string, issues: MaterialStandardizationIssue[]): string {
  const found = cell(raw, index);
  if (found.unsafe) addIssue(issues, issue("STANDARDIZATION_FORMULA_OR_ERROR_IGNORED", `${label}来源为公式或错误单元格，已按安全规则留空。`));
  return found.value;
}

function scalarDefault(value: unknown): string {
  return ["string", "number", "boolean"].includes(typeof value) ? text(value) : "";
}

function mappedValue(raw: unknown, item: MaterialStandardizationMappingItem, label: string, issues: MaterialStandardizationIssue[]): string {
  if (item.mapping_mode === "IGNORE") return "";
  if (item.mapping_mode === "DEFAULT") return scalarDefault(item.default_value_json);
  const indexes = item.source_column_indexes?.length
    ? item.source_column_indexes.filter((value) => Number.isInteger(value) && value >= 0)
    : item.source_column_index === null ? [] : [item.source_column_index];
  const values = indexes.map((index) => readDirect(raw, index, label, issues)).filter(Boolean);
  const source = item.combination_strategy === "JOIN_NON_EMPTY" ? values.join(item.combination_separator ?? " ") : values[0] ?? "";
  return source || (item.mapping_mode === "SOURCE_WITH_DEFAULT" ? scalarDefault(item.default_value_json) : "");
}

function mappingFallback(
  raw: unknown,
  mappingItems: readonly MaterialStandardizationMappingItem[],
  kind: keyof typeof MAPPING_TARGETS,
  label: string,
  issues: MaterialStandardizationIssue[],
): string {
  const byTarget = new Map(mappingItems.map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item]));
  for (const target of MAPPING_TARGETS[kind]) {
    const item = byTarget.get(target);
    if (!item) continue;
    const value = mappedValue(raw, item, label, issues);
    if (value) return value;
  }
  return "";
}

function emptyValues(): MutableValues {
  return Object.fromEntries(MATERIAL_STANDARD_COLUMNS.map((column) => [column.key, ""])) as MutableValues;
}

function exactTemplate(fields: readonly MaterialStandardizationSourceField[]): boolean {
  if (fields.length !== MATERIAL_STANDARD_COLUMNS.length) return false;
  return MATERIAL_STANDARD_COLUMNS.every((column, index) => text(fields[index]?.source_header) === column.label && fieldIndex(fields[index]) === index);
}

function profileFor(mappingStatus: string, templateMatch: boolean): MaterialStandardizationProfile {
  if (templateMatch) return Object.freeze({ state: "TEMPLATE_CONFIRMED", ready: true, label: "13 列模板已确认", mapping_status: mappingStatus, template_match: true });
  if (mappingStatus === "CONFIRMED") return Object.freeze({ state: "MAPPING_CONFIRMED", ready: true, label: "字段 Mapping 已确认", mapping_status: mappingStatus, template_match: false });
  return Object.freeze({ state: "PROFILE_PENDING", ready: false, label: "临时识别，待人工确认", mapping_status: mappingStatus, template_match: false });
}

function decimalParts(value: string): Readonly<{ coefficient: bigint; scale: number }> | null {
  const normalized = text(value).replaceAll(",", "").replaceAll("，", "");
  const match = /^\+?(\d{1,24})(?:\.(\d{1,12}))?$/.exec(normalized);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return { coefficient: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

function decimalText(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return "0";
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const raw = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  const compact = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
  return `${negative ? "-" : ""}${compact}`;
}

export function canonicalDecimal(value: unknown, positive = false): string | null {
  const parsed = decimalParts(text(value));
  if (!parsed || (positive && parsed.coefficient <= 0n)) return null;
  return decimalText(parsed.coefficient, parsed.scale);
}

export function multiplyDecimal(left: string, right: string): string {
  const a = decimalParts(left); const b = decimalParts(right);
  if (!a || !b) throw new Error("INVALID_DECIMAL");
  return decimalText(a.coefficient * b.coefficient, a.scale + b.scale);
}

export function subtractDecimalFloorZero(left: string, right: string): string {
  const a = decimalParts(left); const b = decimalParts(right);
  if (!a || !b) throw new Error("INVALID_DECIMAL");
  const scale = Math.max(a.scale, b.scale);
  const coefficient = a.coefficient * (10n ** BigInt(scale - a.scale)) - b.coefficient * (10n ** BigInt(scale - b.scale));
  return decimalText(coefficient < 0n ? 0n : coefficient, scale);
}

function decimalField(value: string, label: string, positive: boolean, issues: MaterialStandardizationIssue[]): string {
  if (!value) return "";
  const normalized = canonicalDecimal(value, positive);
  if (normalized === null) addIssue(issues, issue("STANDARDIZATION_QUANTITY_INVALID", `${label}“${value.slice(0, 80)}”不是允许的${positive ? "正" : "非负"}十进制数，已留空。`));
  return normalized ?? "";
}

function boardTypeFromText(value: string): string {
  const upper = value.normalize("NFKC").toUpperCase();
  return BOARD_MARKERS.find((entry) => entry.tokens.some((token) => upper.includes(token.toUpperCase())))?.label ?? "";
}

function contextFromText(source: string, previous: SourceContext, filename = false): SourceContext {
  const normalized = text(source).normalize("NFKC");
  const project = (filename ? normalized.match(PROJECT_FROM_FILENAME) : normalized.match(PROJECT_FROM_TITLE))?.[1]?.toUpperCase() ?? "";
  const model = normalized.match(INTERNAL_MODEL)?.[1]?.toUpperCase() ?? normalized.match(J_MODEL)?.[1]?.toUpperCase().replaceAll("-", "_") ?? "";
  const boardType = boardTypeFromText(normalized);
  return Object.freeze({ project: project || previous.project, boardType: boardType || previous.boardType, internalModel: model || previous.internalModel });
}

function rowText(raw: unknown): string {
  return cells(raw).filter((value) => value.type !== "FORMULA" && value.type !== "ERROR").map((value) => text(value.display ?? value.raw_value)).filter(Boolean).join(" ");
}

function titleContext(raw: unknown, previous: SourceContext): SourceContext | null {
  const nonEmpty = cells(raw).filter((value) => value.type !== "FORMULA" && value.type !== "ERROR" && text(value.display ?? value.raw_value));
  if (!nonEmpty.length || nonEmpty.length > 4) return null;
  const joined = rowText(raw); const upper = joined.normalize("NFKC").toUpperCase();
  const explicit = upper.includes("BOM") || INTERNAL_MODEL.test(upper) || J_MODEL.test(upper) || BOARD_MARKERS.some((entry) => entry.tokens.some((token) => upper.includes(token.toUpperCase()))) || (upper.includes("项目") && PROJECT_FROM_TITLE.test(upper));
  if (!explicit) return null;
  const updated = contextFromText(joined, previous);
  return updated.project !== previous.project || updated.boardType !== previous.boardType || updated.internalModel !== previous.internalModel ? updated : previous;
}

function repeatedHeader(raw: unknown, fields: readonly MaterialStandardizationSourceField[]): boolean {
  let matches = 0;
  for (const field of fields) {
    const value = cell(raw, field.column_index).value;
    if (value && normalizeStandardizationHeader(value) === normalizeStandardizationHeader(field.source_header)) matches += 1;
  }
  return matches >= 3;
}

function directIndexes(fields: readonly MaterialStandardizationSourceField[]): Readonly<Record<MaterialStandardColumnKey, number | null>> {
  return Object.freeze(Object.fromEntries(MATERIAL_STANDARD_COLUMNS.map((column) => [column.key, sourceIndex(fields, HEADER_ALIASES[column.key])])) as Record<MaterialStandardColumnKey, number | null>);
}

function alternativeIdentity(values: MutableValues, raw: unknown, partNumberIndex: number | null, issues: MaterialStandardizationIssue[]): string {
  const partNumber = readDirect(raw, partNumberIndex, "替代料型号", issues);
  const identity = partNumber || values.specification || values.alternative;
  if (!identity) return "";
  return values.brand ? `${identity}（${values.brand}）` : identity;
}

function appendAlternative(row: MutableRow, value: string, sourceRow: number): void {
  if (!value) {
    addIssue(row.issues, issue("STANDARDIZATION_ALTERNATIVE_IDENTITY_MISSING", `原始第 ${sourceRow} 行标记为替代料，但没有可证明的型号或规格。`));
  } else {
    const existing = row.values.alternative.split(/[；;]/).map((item) => item.trim()).filter(Boolean);
    if (!existing.some((item) => normalizeStandardizationHeader(item) === normalizeStandardizationHeader(value))) existing.push(value);
    row.values.alternative = existing.join("；").slice(0, 3000);
  }
  row.alternative_source_rows.push(sourceRow);
}

function freezeRow(row: MutableRow): MaterialStandardizationRow {
  return Object.freeze({
    sequence: row.sequence,
    source_row_number: row.source_row_number,
    alternative_source_rows: Object.freeze([...row.alternative_source_rows]),
    values: Object.freeze({ ...row.values }),
    issues: Object.freeze([...row.issues]),
  });
}

export function standardizeMaterialRows(input: MaterialStandardizationInput): MaterialStandardizationProjection {
  const templateMatch = exactTemplate(input.sourceFields);
  const profile = profileFor(input.mappingStatus, templateMatch);
  const indexes = directIndexes(input.sourceFields);
  const statusIndex = sourceIndex(input.sourceFields, STATUS_ALIASES);
  const partNumberIndex = sourceIndex(input.sourceFields, PART_NUMBER_ALIASES);
  const globalIssues: MaterialStandardizationIssue[] = [];
  if (!profile.ready) globalIssues.push(issue("STANDARDIZATION_PROFILE_PENDING", "当前来源结构尚未人工确认；预览和 CSV 为临时整理结果，请先核对高级字段 Mapping。"));

  let context: SourceContext = contextFromText(input.filename, { project: "", boardType: "", internalModel: "" }, true);
  for (const sourceRow of input.preludeRows ?? []) context = titleContext(sourceRow.raw, context) ?? context;
  const output: MutableRow[] = [];
  let skipped = 0; let folded = 0;

  for (const sourceRow of input.rows) {
    const updatedContext = titleContext(sourceRow.raw, context);
    if (updatedContext && rowText(sourceRow.raw)) { context = updatedContext; skipped += 1; continue; }
    if (repeatedHeader(sourceRow.raw, input.sourceFields)) { skipped += 1; continue; }
    const rowIssues: MaterialStandardizationIssue[] = [];
    const values = emptyValues();
    for (const column of MATERIAL_STANDARD_COLUMNS) values[column.key] = readDirect(sourceRow.raw, indexes[column.key], column.label, rowIssues);

    if (!templateMatch) {
      values.project ||= context.project;
      values.board_type ||= context.boardType;
      values.internal_model ||= context.internalModel;
      values.specification ||= mappingFallback(sourceRow.raw, input.mappingItems, "specification", "物料规格描述", rowIssues);
      values.brand ||= mappingFallback(sourceRow.raw, input.mappingItems, "brand", "品牌", rowIssues);
      values.usage ||= mappingFallback(sourceRow.raw, input.mappingItems, "usage", "用量", rowIssues);
      values.supplier ||= mappingFallback(sourceRow.raw, input.mappingItems, "supplier", "供应商", rowIssues);
    }

    const status = normalizeStandardizationHeader(readDirect(sourceRow.raw, statusIndex, "主替状态", rowIssues));
    const explicitAlternativeRow = ALTERNATIVE_STATUS.has(status);
    const meaningful = Object.values(values).some(Boolean) || explicitAlternativeRow;
    if (!meaningful) { skipped += 1; continue; }

    if (!templateMatch) {
      values.usage = decimalField(values.usage, "用量", true, rowIssues);
      values.order_quantity = decimalField(values.order_quantity, "订单数量", false, rowIssues);
      values.inventory = decimalField(values.inventory, "库存数", false, rowIssues);
      values.demand_quantity = values.usage && values.order_quantity ? multiplyDecimal(values.usage, values.order_quantity) : "";
      values.purchase_quantity = values.demand_quantity && values.inventory ? subtractDecimalFloorZero(values.demand_quantity, values.inventory) : "";
    }

    if (explicitAlternativeRow && output.length) {
      appendAlternative(output[output.length - 1], alternativeIdentity(values, sourceRow.raw, partNumberIndex, rowIssues), sourceRow.rowNumber);
      for (const item of rowIssues) addIssue(output[output.length - 1].issues, item);
      folded += 1; skipped += 1; continue;
    }
    if (explicitAlternativeRow) addIssue(rowIssues, issue("STANDARDIZATION_ALTERNATIVE_WITHOUT_PRIMARY", "该行明确标记为替代料，但前面没有可归属的主料，已保留为独立行。", "ERROR"));

    const sequence = output.length + 1;
    values.sequence = templateMatch ? values.sequence || String(sequence) : String(sequence);
    if (!values.project) addIssue(rowIssues, issue("STANDARDIZATION_PROJECT_MISSING", "项目号无法从明确列、文件名或标题证明，已留空。"));
    if (!values.board_type) addIssue(rowIssues, issue("STANDARDIZATION_BOARD_TYPE_MISSING", "板子类型无法从明确列或标题证明，已留空。"));
    if (!values.internal_model) addIssue(rowIssues, issue("STANDARDIZATION_INTERNAL_MODEL_MISSING", "内部型号无法从明确列或标题证明；供应商料号不会被当作内部型号。"));
    if (!values.specification) addIssue(rowIssues, issue("STANDARDIZATION_SPECIFICATION_MISSING", "物料规格描述没有明确来源，已留空。", "ERROR"));
    if (!values.usage) addIssue(rowIssues, issue("STANDARDIZATION_USAGE_MISSING", "用量没有可验证的正数来源，已留空。"));
    if (!templateMatch && (!values.usage || !values.order_quantity)) addIssue(rowIssues, issue("STANDARDIZATION_DEMAND_INPUT_MISSING", "用量或订单数量未知，需求数量不计算。"));
    if (!templateMatch && (!values.demand_quantity || !values.inventory)) addIssue(rowIssues, issue("STANDARDIZATION_PURCHASE_INPUT_MISSING", "需求数量或库存数未知，购买数量不计算。"));

    context = Object.freeze({
      project: values.project || context.project,
      boardType: values.board_type || context.boardType,
      internalModel: values.internal_model || context.internalModel,
    });
    output.push({ sequence, source_row_number: sourceRow.rowNumber, alternative_source_rows: [], values, issues: rowIssues });
  }

  const rows = Object.freeze(output.map(freezeRow));
  const allIssues = rows.flatMap((row) => row.issues);
  return Object.freeze({
    standard_version: MATERIAL_STANDARDIZATION_VERSION,
    columns: MATERIAL_STANDARD_COLUMNS,
    profile,
    source: Object.freeze({ filename: text(input.filename), sheet_name: text(input.sheetName), sheet_index: input.sheetIndex, parse_run_id: input.parseRunId }),
    summary: Object.freeze({
      source_row_count: input.rows.length,
      standardized_row_count: rows.length,
      folded_alternative_count: folded,
      skipped_row_count: skipped,
      issue_row_count: rows.filter((row) => row.issues.length > 0).length,
      warning_count: allIssues.filter((item) => item.level === "WARNING").length + globalIssues.filter((item) => item.level === "WARNING").length,
      error_count: allIssues.filter((item) => item.level === "ERROR").length + globalIssues.filter((item) => item.level === "ERROR").length,
    }),
    global_issues: Object.freeze(globalIssues),
    rows,
  });
}

function csvValue(value: string): string {
  let safe = text(value).replace(/\r\n|\r|\n/g, "\n");
  if (/^[=+\-@\t\r]/.test(safe.trimStart())) safe = `'${safe}`;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function createMaterialStandardizationCsv(projection: MaterialStandardizationProjection): string {
  const lines = [MATERIAL_STANDARD_COLUMNS.map((column) => csvValue(column.label)).join(",")];
  for (const row of projection.rows) lines.push(MATERIAL_STANDARD_COLUMNS.map((column) => csvValue(row.values[column.key])).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}
