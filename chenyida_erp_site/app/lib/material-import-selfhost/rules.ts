import { createHash } from "node:crypto";
import { mappingFailure } from "./errors.ts";
import type {
  MappingCatalogSnapshot,
  MappingDraftInput,
  MappingItemInput,
  MappingReuseDecision,
  MappingTarget,
  MappingTargetNamespace,
  SourceField,
} from "./types.ts";

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeSourceHeader(value: unknown, index: number): string {
  const text = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return text || `COLUMN_${columnReference(index)}`;
}

export function columnReference(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 255) mappingFailure("IMPORT_MAPPING_INVALID", "源列索引无效", 422);
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export function sourceStructureDigest(input: Readonly<{
  sourceKind: string;
  sheetName: string;
  sheetIndex: number;
  headerMode: "SINGLE_ROW" | "NO_HEADER";
  headerRowNumber: number | null;
  fields: readonly SourceField[];
}>): string {
  return sha256(canonicalJson({
    algorithm: "material-import-source-structure-v1",
    source_kind: input.sourceKind,
    sheet_name: input.sheetName.normalize("NFC"),
    sheet_index: input.sheetIndex,
    header_mode: input.headerMode,
    header_row_number: input.headerRowNumber,
    fields: input.fields.map((field) => ({
      column_index: field.column_index,
      normalized_header: field.normalized_header,
    })),
  }));
}

export function mappingContentDigest(input: Readonly<{
  selectedSheetIndex: number;
  headerMode: "SINGLE_ROW" | "NO_HEADER";
  headerRowNumber: number | null;
  sourceStructureDigest: string;
  metadataDigest: string;
  items: readonly MappingItemInput[];
}>): string {
  return sha256(canonicalJson({
    algorithm: "material-import-mapping-content-v1",
    selected_sheet_index: input.selectedSheetIndex,
    header_mode: input.headerMode,
    header_row_number: input.headerRowNumber,
    source_structure_digest: input.sourceStructureDigest,
    metadata_digest: input.metadataDigest,
    items: [...input.items].sort((left, right) => left.display_order - right.display_order || `${left.target_namespace}.${left.target_code}`.localeCompare(`${right.target_namespace}.${right.target_code}`, "en")).map((item) => ({
      source_column_index: item.source_column_index,
      source_column_indexes: item.source_column_indexes ?? (item.source_column_index === null ? [] : [item.source_column_index]),
      source_header: item.source_header ?? null,
      source_headers: item.source_headers ?? [],
      target_namespace: item.target_namespace,
      target_code: item.target_code,
      mapping_mode: item.mapping_mode,
      default_value_json: item.default_value_json ?? null,
      required: item.required,
      display_order: item.display_order,
      combination_strategy: item.combination_strategy ?? "FIRST_NON_EMPTY",
      combination_separator: item.combination_separator ?? " ",
    })),
  }));
}

function targetKey(namespace: MappingTargetNamespace, code: string): string {
  return `${namespace}\u0000${code}`;
}

function scalarDefault(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value));
}

export function validateMappingDraft(
  draft: MappingDraftInput,
  input: Readonly<{ sourceColumnMax: number; rowCount: number; catalog: MappingCatalogSnapshot }>,
): readonly MappingItemInput[] {
  if (!Number.isInteger(draft.selected_sheet_index) || draft.selected_sheet_index < 0 || draft.selected_sheet_index > 31) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping Sheet 无效", 422);
  if (draft.header_mode !== "SINGLE_ROW" && draft.header_mode !== "NO_HEADER") mappingFailure("IMPORT_HEADER_NOT_CONFIRMED", "表头模式无效", 422);
  if (draft.header_mode === "SINGLE_ROW" && (!Number.isInteger(draft.header_row_number) || Number(draft.header_row_number) < 1 || Number(draft.header_row_number) > input.rowCount)) mappingFailure("IMPORT_HEADER_NOT_CONFIRMED", "表头行无效", 422);
  if (draft.header_mode === "NO_HEADER" && draft.header_row_number != null) mappingFailure("IMPORT_HEADER_NOT_CONFIRMED", "NO_HEADER 不得指定表头行", 422);
  if (!Array.isArray(draft.items) || draft.items.length < 1 || draft.items.length > 256) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 项数量无效", 422);
  const targets = new Set<string>();
  const normalized: MappingItemInput[] = [];
  for (const item of draft.items) {
    if (!item || typeof item !== "object") mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 项无效", 422);
    const sourceColumns: readonly number[] = item.source_column_indexes?.length
      ? item.source_column_indexes
      : item.source_column_index === null
        ? []
        : [item.source_column_index];
    const columns = [...new Set<number>(sourceColumns)];
    const requiresSource = item.mapping_mode !== "DEFAULT";
    if (columns.length > 8 || columns.some((column) => !Number.isInteger(column) || column < 0 || column >= input.sourceColumnMax)) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 源列无效", 422);
    if (requiresSource && !columns.length) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 必须指定来源列", 422);
    if (!requiresSource && columns.length) mappingFailure("IMPORT_MAPPING_INVALID", "默认值 Mapping 不得指定来源列", 422);
    if (item.source_headers && item.source_headers.length !== columns.length) mappingFailure("IMPORT_MAPPING_INVALID", "组合表头与来源列数量不一致", 422);
    const strategy = item.combination_strategy ?? "FIRST_NON_EMPTY";
    if (!["FIRST_NON_EMPTY", "JOIN_NON_EMPTY", "SPECIFICATION_EXTRACT"].includes(strategy)) mappingFailure("IMPORT_MAPPING_INVALID", "来源列组合策略无效", 422);
    if (strategy === "SPECIFICATION_EXTRACT" && `${item.target_namespace}.${item.target_code}` !== "supplier_reference.SUPPLIER_SPECIFICATION") mappingFailure("IMPORT_MAPPING_INVALID", "规格提取策略只能用于供应商规格", 422);
    const separator = item.combination_separator ?? " ";
    if (separator.length > 10 || /[\u0000-\u001f\u007f]/.test(separator)) mappingFailure("IMPORT_MAPPING_INVALID", "组合分隔符无效", 422);
    if (!Number.isInteger(item.display_order) || item.display_order < 0 || item.display_order > 255) mappingFailure("IMPORT_MAPPING_INVALID", "显示顺序无效", 422);
    if (item.mapping_confidence !== undefined && (!Number.isFinite(item.mapping_confidence) || item.mapping_confidence < 0 || item.mapping_confidence > 1)) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 置信度无效", 422);
    if (item.adaptive_mapping_status && !["EXACT", "HIGH_CONFIDENCE", "SUGGESTED", "UNMAPPED", "CONFLICT", "CONFIRMED"].includes(item.adaptive_mapping_status)) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 状态无效", 422);
    if (item.adaptive_mapping_status === "CONFLICT" || item.adaptive_mapping_status === "UNMAPPED") mappingFailure("IMPORT_MAPPING_INVALID", "冲突或未映射字段必须先人工处理", 422);
    const definition = input.catalog.targetByKey.get(targetKey(item.target_namespace, item.target_code));
    if (!definition || !definition.mapping_modes.includes(item.mapping_mode)) mappingFailure("IMPORT_MAPPING_TARGET_INVALID", "Mapping 目标无效、已禁用或模式不兼容", 422);
    if (item.required !== definition.required_for_confirm) mappingFailure("IMPORT_MAPPING_INVALID", "Mapping 必填规则与当前目标元数据不一致", 422);
    const key = targetKey(item.target_namespace, item.target_code);
    if (!definition.repeatable && targets.has(key)) mappingFailure("IMPORT_MAPPING_DUPLICATE_TARGET", "一个目标字段只能映射一次", 422);
    targets.add(key);
    if (["DEFAULT", "SOURCE_WITH_DEFAULT"].includes(item.mapping_mode)) {
      if (!scalarDefault(item.default_value_json)) mappingFailure("IMPORT_MAPPING_INVALID", "默认值只能是受限标量", 422);
    } else if (item.default_value_json !== undefined && item.default_value_json !== null) mappingFailure("IMPORT_MAPPING_INVALID", "当前 Mapping 模式不允许默认值", 422);
    normalized.push({
      ...item,
      source_column_index: columns[0] ?? null,
      source_column_indexes: columns,
      source_headers: item.source_headers ?? (item.source_header ? [item.source_header] : []),
      combination_strategy: strategy,
      combination_separator: separator,
      mapping_confidence: item.mapping_confidence ?? 0,
      adaptive_mapping_status: item.adaptive_mapping_status ?? "CONFIRMED",
      mapping_evidence: (item.mapping_evidence ?? []).slice(0, 20),
    });
  }
  return normalized;
}

export function missingRequiredTargets(items: readonly MappingItemInput[], catalog: MappingCatalogSnapshot): readonly MappingTarget[] {
  const mapped = new Set(items.map((item) => targetKey(item.target_namespace, item.target_code)));
  return catalog.targets.filter((target) => target.required_for_confirm && !mapped.has(targetKey(target.target_namespace, target.target_code)));
}

export function decideReuse(input: Readonly<{
  candidateStatus: string;
  sourceKindMatches: boolean;
  structureDigestMatches: boolean;
  metadataDigestMatches: boolean;
  targetsCompatible: boolean;
}>): Readonly<{ decision: MappingReuseDecision; reason_code: string }> {
  if (input.candidateStatus === "STALE") return { decision: "STALE", reason_code: "MAPPING_STALE" };
  if (input.candidateStatus !== "CONFIRMED") return { decision: "INCOMPATIBLE", reason_code: "MAPPING_NOT_CURRENT_CONFIRMED" };
  if (!input.sourceKindMatches) return { decision: "INCOMPATIBLE", reason_code: "SOURCE_KIND_CHANGED" };
  if (!input.structureDigestMatches) return { decision: "INCOMPATIBLE", reason_code: "SOURCE_STRUCTURE_CHANGED" };
  if (!input.targetsCompatible) return { decision: "STALE", reason_code: "TARGET_CATALOG_INCOMPATIBLE" };
  if (!input.metadataDigestMatches) return { decision: "RECONFIRM_REQUIRED", reason_code: "TARGET_CATALOG_CHANGED" };
  return { decision: "AUTO_RECOMMEND", reason_code: "EXACT_STRUCTURE_AND_CATALOG" };
}
