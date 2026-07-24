import type {
  MaterialImportMappingMetadataSnapshot,
  MaterialImportMappingTarget,
  MaterialImportMappingTargetNamespace,
} from "./mapping-target-registry.ts";
import { extractSpecificationCandidate } from "./adaptive-import.ts";
import type { AdaptiveDataRowClassification } from "./adaptive-import.ts";
import { canonicalJson } from "./mapping-target-registry.ts";
import type { MaterialImportRawCell, MaterialImportRawRow } from "./parser-model.ts";

export const MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION = "material-import-normalizer-v1";

export const MATERIAL_IMPORT_NORMALIZATION_LIMITS = Object.freeze({
  maxRows: 50_000,
  maxRowPayloadBytes: 256 * 1024,
  maxBatchPayloadBytes: 256 * 1024 * 1024,
  maxIssuesPerRow: 20,
  maxIssuesPerBatch: 200_000,
  logicalRowsPerChunk: 100,
  maxChunkBytes: 5 * 1024 * 1024,
  maxStatementsPerBatch: 50,
} as const);

export type MaterialImportNormalizationRowStatus = "VALID" | "WARNING" | "ERROR";
export type MaterialImportNormalizationIssueLevel = "WARNING" | "ERROR";
export type MaterialImportNormalizationValueState = "MISSING" | "EMPTY" | "BLANK_TEXT" | "NULL_VALUE" | "PRESENT";

export type MaterialImportNormalizationIssue = Readonly<{
  issue_level: MaterialImportNormalizationIssueLevel;
  issue_code: string;
  target_code: string;
  source_column_index: number | null;
  safe_message: string;
  safe_details: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>;
}>;

export type MaterialImportNormalizationMappingItem = Readonly<{
  source_column_index: number | null;
  source_column_indexes?: readonly number[];
  source_headers?: readonly string[];
  target_namespace: MaterialImportMappingTargetNamespace;
  target_code: string;
  mapping_mode: "SOURCE" | "SOURCE_WITH_DEFAULT" | "DEFAULT" | "IGNORE";
  default_value: unknown;
  required: boolean;
  display_order: number;
  combination_strategy?: "FIRST_NON_EMPTY" | "JOIN_NON_EMPTY" | "SPECIFICATION_EXTRACT";
  combination_separator?: string;
  mapping_confidence?: number;
  adaptive_mapping_status?: "EXACT" | "HIGH_CONFIDENCE" | "SUGGESTED" | "UNMAPPED" | "CONFLICT" | "CONFIRMED";
  mapping_evidence?: readonly string[];
}>;

export type MaterialImportNormalizationLineage = Readonly<{
  batch_id: number;
  parse_run_id: number;
  normalization_run_id: number;
  mapping_id: number;
  mapping_version: number;
  mapping_digest: string;
  metadata_digest: string;
  processor_version: string;
  sheet_index: number;
  row_number: number;
  source_row_number: number;
  raw_row_hash: string;
}>;

export type MaterialImportNormalizedRowResult = Readonly<{
  normalized_payload: Readonly<Record<string, unknown>>;
  normalized_payload_json: string;
  normalized_payload_hash: string;
  normalized_payload_bytes: number;
  row_status: MaterialImportNormalizationRowStatus;
  error_count: number;
  warning_count: number;
  issues: readonly MaterialImportNormalizationIssue[];
}>;

type SourceLineage = {
  kind: "SOURCE_COLUMN" | "DEFAULT_VALUE";
  column_index: number | null;
  cell_type: MaterialImportRawCell["type"] | null;
  value_state: MaterialImportNormalizationValueState;
  blank_kind?: "EMPTY_STRING" | "WHITESPACE_ONLY" | null;
  raw_value: unknown;
};

const TEXT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  "basic.STANDARD_NAME": 500,
  "basic.UNIT": 64,
  "basic.BRAND": 200,
  "basic.MANUFACTURER": 200,
  "basic.MANUFACTURER_PART_NUMBER": 255,
  "category_hint.CATEGORY_HINT": 500,
  "supplier_reference.SUPPLIER_NAME": 255,
  "supplier_reference.SUPPLIER_ITEM_CODE": 255,
  "supplier_reference.SUPPLIER_ITEM_NAME": 500,
  "supplier_reference.SUPPLIER_SPECIFICATION": 2_000,
  "supplier_reference.PURCHASE_UOM": 64,
});

const UNKNOWN_BRANDS = new Set(["UNKNOWN", "UNSPECIFIED", "N/A", "NA", "未知"]);
const STRICT_INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const STRICT_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function targetKey(namespace: MaterialImportMappingTargetNamespace, code: string): string {
  return `${namespace}.${code}`;
}

function hashBytes(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

function validIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sourceFromCell(cell: MaterialImportRawCell | undefined, columnIndex: number | null): SourceLineage {
  if (!cell) return { kind: "SOURCE_COLUMN", column_index: columnIndex, cell_type: null, value_state: "MISSING", raw_value: null };
  if (cell.type === "EMPTY") return { kind: "SOURCE_COLUMN", column_index: columnIndex, cell_type: cell.type, value_state: "EMPTY", raw_value: cell.raw_value };
  if (cell.type === "TEXT" && String(cell.raw_value ?? "").trim() === "") {
    const raw = String(cell.raw_value ?? "");
    return {
      kind: "SOURCE_COLUMN",
      column_index: columnIndex,
      cell_type: cell.type,
      value_state: "BLANK_TEXT",
      blank_kind: raw === "" ? "EMPTY_STRING" : "WHITESPACE_ONLY",
      raw_value: cell.raw_value,
    };
  }
  return {
    kind: "SOURCE_COLUMN",
    column_index: columnIndex,
    cell_type: cell.type,
    value_state: "PRESENT",
    raw_value: cell.type === "DATE" ? (cell.interpretation_status === "INTERPRETED" ? cell.interpreted_iso_value : null) : cell.raw_value,
  };
}

function defaultSource(value: unknown): SourceLineage {
  return { kind: "DEFAULT_VALUE", column_index: null, cell_type: null, value_state: value === null ? "NULL_VALUE" : "PRESENT", raw_value: value };
}

function issue(
  level: MaterialImportNormalizationIssueLevel,
  code: string,
  target: string,
  column: number | null,
  message: string,
  details: Record<string, string | number | boolean | readonly (string | number | boolean)[]> = {},
): MaterialImportNormalizationIssue {
  return { issue_level: level, issue_code: code, target_code: target, source_column_index: column, safe_message: message, safe_details: details };
}

function convertCandidate(
  definition: MaterialImportMappingTarget,
  source: SourceLineage,
  required: boolean,
): Readonly<{ candidate: unknown; issues: readonly MaterialImportNormalizationIssue[] }> {
  const key = targetKey(definition.target_namespace, definition.target_code);
  const column = source.column_index;
  if (["MISSING", "EMPTY", "NULL_VALUE"].includes(source.value_state)) {
    if (source.kind === "DEFAULT_VALUE" && required) return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_DEFAULT_INVALID", key, column, "默认值不能满足必填目标")] };
    return required
      ? { candidate: null, issues: [issue("ERROR", "NORMALIZATION_REQUIRED_VALUE_MISSING", key, column, "缺少必填值")] }
      : { candidate: null, issues: [] };
  }
  if (source.value_state === "BLANK_TEXT") {
    return {
      candidate: null,
      issues: [issue(required ? "ERROR" : "WARNING", "NORMALIZATION_BLANK_VALUE", key, column, "源值为空白文本")],
    };
  }
  if (source.cell_type === "FORMULA") {
    return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_FORMULA_NOT_EXECUTED", key, column, "公式未执行，缓存值不作为候选")] };
  }
  if (source.cell_type === "ERROR") {
    return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_SOURCE_ERROR_CELL", key, column, "源单元格为错误值")] };
  }

  const raw = source.raw_value;
  const valueType = definition.value_type;
  let candidate: unknown = null;
  let failure: MaterialImportNormalizationIssue | null = null;
  if (valueType === "TEXT" || valueType === "ENUM") {
    if (source.kind === "DEFAULT_VALUE" && typeof raw === "string") candidate = raw.normalize("NFC").trim();
    else if (source.cell_type === "TEXT" && typeof raw === "string") candidate = raw.normalize("NFC").trim();
    else failure = issue("ERROR", "NORMALIZATION_TYPE_MISMATCH", key, column, "源值类型与文本目标不匹配", { expected_type: valueType });
    if (!failure && valueType === "ENUM" && !definition.value_constraints.enum_values.includes(String(candidate))) {
      failure = issue("ERROR", "NORMALIZATION_ENUM_INVALID", key, column, "枚举值不在允许范围", { allowed_values: definition.value_constraints.enum_values });
    }
  } else if (valueType === "INTEGER") {
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!STRICT_INTEGER.test(text) || /^-?0[0-9]/.test(text)) {
      failure = issue("ERROR", "NORMALIZATION_NUMBER_INVALID", key, column, "整数格式无效");
    } else {
      const number = Number(text);
      if (!Number.isSafeInteger(number)) failure = issue("ERROR", "NORMALIZATION_INTEGER_REQUIRED", key, column, "值必须是安全整数");
      else if (key === "basic.SHELF_LIFE_DAYS" && number < 0) failure = issue("ERROR", "NORMALIZATION_INTEGER_REQUIRED", key, column, "保质期天数必须为非负整数");
      else candidate = number;
    }
  } else if (valueType === "DECIMAL") {
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!STRICT_DECIMAL.test(text) || /^-?0[0-9]/.test(text)) failure = issue("ERROR", "NORMALIZATION_NUMBER_INVALID", key, column, "十进制数格式无效");
    else if (definition.value_constraints.decimal_scale !== null && (text.split(".")[1]?.length ?? 0) > definition.value_constraints.decimal_scale) failure = issue("ERROR", "NORMALIZATION_NUMBER_INVALID", key, column, "十进制数超过允许精度", { decimal_scale: definition.value_constraints.decimal_scale });
    else candidate = text;
  } else if (valueType === "BOOLEAN") {
    if (typeof raw === "boolean") candidate = raw;
    else if (typeof raw === "string" && /^(true|false)$/i.test(raw.trim())) candidate = raw.trim().toLowerCase() === "true";
    else failure = issue("ERROR", "NORMALIZATION_BOOLEAN_INVALID", key, column, "布尔值仅接受 true 或 false");
  } else if (valueType === "DATE") {
    const text = typeof raw === "string" ? raw.trim() : "";
    if ((source.cell_type === "DATE" || source.cell_type === "TEXT" || source.kind === "DEFAULT_VALUE") && validIsoDate(text)) candidate = text;
    else failure = issue("ERROR", "NORMALIZATION_DATE_INVALID", key, column, "日期必须为有效的 YYYY-MM-DD");
  }

  if (failure) return source.kind === "DEFAULT_VALUE"
    ? { candidate: null, issues: [issue("ERROR", "NORMALIZATION_DEFAULT_INVALID", key, column, "默认值类型或范围无效", { expected_type: valueType })] }
    : { candidate: null, issues: [failure] };
  if (typeof candidate === "string") {
    const limit = TEXT_LIMITS[key];
    if (limit !== undefined && candidate.length > limit) {
      return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_TEXT_TOO_LONG", key, column, "文本超过允许长度", { max_length: limit })] };
    }
  }
  const warnings: MaterialImportNormalizationIssue[] = [];
  if (key === "basic.BRAND" && typeof candidate === "string" && UNKNOWN_BRANDS.has(candidate.toUpperCase())) {
    warnings.push(issue("WARNING", "NORMALIZATION_BRAND_UNKNOWN", key, column, "品牌为未知占位值，请人工确认"));
  }
  if (definition.target_namespace === "attribute") {
    if (!definition.enabled || !definition.selectable) {
      return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_ATTRIBUTE_DISABLED", key, column, "属性已停用或不可选择")] };
    }
    if (definition.unit_policy.mode === "CANONICAL") {
      const unit = definition.unit_policy.canonical_unit;
      if (!unit) return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED", key, column, "属性缺少标准单位元数据")] };
      if (!definition.unit_policy.allowed_units.includes(unit)) {
        return { candidate: null, issues: [issue("ERROR", "NORMALIZATION_ATTRIBUTE_UNIT_INVALID", key, column, "属性标准单位不在允许范围", { allowed_units: definition.unit_policy.allowed_units })] };
      }
      candidate = candidate === null ? null : { value: candidate, unit };
    }
  }
  return { candidate, issues: warnings };
}

function fieldStatus(issues: readonly MaterialImportNormalizationIssue[]): MaterialImportNormalizationRowStatus {
  if (issues.some((item) => item.issue_level === "ERROR")) return "ERROR";
  if (issues.some((item) => item.issue_level === "WARNING")) return "WARNING";
  return "VALID";
}

export class MaterialImportRowNormalizer {
  async normalize(input: Readonly<{
    lineage: MaterialImportNormalizationLineage;
    rawRow: MaterialImportRawRow;
    mappingItems: readonly MaterialImportNormalizationMappingItem[];
    metadataSnapshot: MaterialImportMappingMetadataSnapshot;
    rowClassification?: AdaptiveDataRowClassification;
    canonicalContext?: Readonly<{
      source_file_id: number;
      source_sheet_name: string;
      supplier_id: string | null;
      supplier_profile_id: number | null;
      created_at: string;
    }>;
  }>): Promise<MaterialImportNormalizedRowResult> {
    if (input.rowClassification && input.rowClassification.kind !== "DATA") {
      const payload: Record<string, unknown> = {
        schema_version: 1,
        lineage: input.lineage,
        row_disposition: "SKIPPED",
        row_classification: {
          kind: input.rowClassification.kind,
          confidence: input.rowClassification.confidence,
          reason_codes: input.rowClassification.reasonCodes,
        },
        basic: {},
        attributes: {},
        category_hint: null,
        supplier_reference: {},
        adaptive_mapping: {},
        deferred_validation: [],
        row_status: "VALID",
        issue_summary: { issue_count: 0, error_count: 0, warning_count: 0 },
      };
      const payloadJson = canonicalJson(payload);
      return {
        normalized_payload: payload,
        normalized_payload_json: payloadJson,
        normalized_payload_hash: await hashBytes(payloadJson),
        normalized_payload_bytes: new TextEncoder().encode(payloadJson).byteLength,
        row_status: "VALID",
        error_count: 0,
        warning_count: 0,
        issues: [],
      };
    }
    const cells = new Map(input.rawRow.cells.map((cell) => [cell.column_index, cell]));
    const allIssues: MaterialImportNormalizationIssue[] = [];
    const basic: Record<string, unknown> = {};
    const attributes: Record<string, unknown> = {};
    const supplierReference: Record<string, unknown> = {};
    let categoryHint: unknown = null;
    let issueLimitReached = false;
    const adaptiveMappings: Record<string, unknown> = {};
    const adaptiveRow = input.mappingItems.some((item) => item.adaptive_mapping_status !== undefined || item.combination_strategy !== undefined || item.source_column_indexes !== undefined);

    const pushIssues = (items: readonly MaterialImportNormalizationIssue[]) => {
      for (const item of items) {
        if (allIssues.length < MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxIssuesPerRow - 1) allIssues.push(item);
        else {
          issueLimitReached = true;
          break;
        }
      }
    };

    for (const item of [...input.mappingItems].sort((left, right) => left.display_order - right.display_order)) {
      if (item.target_namespace === "ignore" || item.mapping_mode === "IGNORE") continue;
      const definition = input.metadataSnapshot.targetByKey.get(`${item.target_namespace}\u0000${item.target_code}`);
      const key = targetKey(item.target_namespace, item.target_code);
      if (!definition) {
        pushIssues([issue("ERROR", "NORMALIZATION_ATTRIBUTE_DISABLED", key, item.source_column_index, "Mapping 目标已失效")]);
        continue;
      }
      const sourceIndexes = item.source_column_indexes?.length ? item.source_column_indexes : item.source_column_index === null ? [] : [item.source_column_index];
      const sourceCells = sourceIndexes.map((index) => cells.get(index)).filter((cell): cell is MaterialImportRawCell => Boolean(cell));
      let cell = sourceCells.find((candidate) => candidate.type !== "EMPTY") ?? sourceCells[0];
      let source = sourceFromCell(cell, sourceIndexes[0] ?? null);
      const combination = item.combination_strategy ?? "FIRST_NON_EMPTY";
      const combinedValues = sourceCells.filter((candidate) => !["EMPTY", "FORMULA", "ERROR"].includes(candidate.type)).map((candidate) => String(candidate.raw_value ?? "").normalize("NFC").trim()).filter(Boolean);
      let extractionReviewRequired = false;
      if (combination === "JOIN_NON_EMPTY" && combinedValues.length) {
        const joined = [...new Set(combinedValues)].join(item.combination_separator ?? " ");
        cell = { column_index: sourceIndexes[0] ?? 0, column_ref: cell?.column_ref ?? "A", type: "TEXT", source_type: "COMBINED_COLUMNS", raw_value: joined, display: joined, format_code: null };
        source = { ...sourceFromCell(cell, sourceIndexes[0] ?? null), source_column_indexes: sourceIndexes, raw_values: combinedValues } as SourceLineage;
      } else if (combination === "SPECIFICATION_EXTRACT") {
        const extracted = extractSpecificationCandidate({ componentValues: combinedValues });
        extractionReviewRequired = extracted.reviewStatus === "NEEDS_REVIEW";
        if (extracted.value) {
          cell = { column_index: sourceIndexes[0] ?? 0, column_ref: cell?.column_ref ?? "A", type: "TEXT", source_type: "SPECIFICATION_EXTRACT", raw_value: extracted.value, display: extracted.value, format_code: null };
          source = { ...sourceFromCell(cell, sourceIndexes[0] ?? null), source_column_indexes: sourceIndexes, raw_values: combinedValues, extraction_evidence: extracted.evidence } as SourceLineage;
        } else source = sourceFromCell(undefined, sourceIndexes[0] ?? null);
      }
      const useDefault = item.mapping_mode === "DEFAULT"
        || (item.mapping_mode === "SOURCE_WITH_DEFAULT" && (source.value_state === "MISSING" || source.value_state === "EMPTY"));
      if (useDefault) source = defaultSource(item.default_value);
      const converted = convertCandidate(definition, source, item.required || definition.required_for_confirm);
      pushIssues(converted.issues);
      const specificationIssues: MaterialImportNormalizationIssue[] = [];
      if (adaptiveRow && key === "supplier_reference.SUPPLIER_SPECIFICATION" && (converted.candidate === null || converted.candidate === "")) {
        specificationIssues.push(issue("ERROR", "NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED", key, sourceIndexes[0] ?? null, "规格未识别，禁止以空规格进入物料草稿"));
        pushIssues([issue("ERROR", "NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED", key, sourceIndexes[0] ?? null, "规格未识别，禁止以空规格进入物料草稿")]);
      } else if (adaptiveRow && key === "supplier_reference.SUPPLIER_SPECIFICATION" && extractionReviewRequired) {
        specificationIssues.push(issue("WARNING", "NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED", key, sourceIndexes[0] ?? null, "规格为确定性组合候选，必须在审核界面确认", { source_columns: sourceIndexes }));
        pushIssues([issue("WARNING", "NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED", key, sourceIndexes[0] ?? null, "规格为确定性组合候选，必须在审核界面确认", { source_columns: sourceIndexes })]);
      }
      const value = { target_code: key, source, candidate: converted.candidate, status: fieldStatus([...converted.issues, ...specificationIssues]) };
      if (item.target_namespace === "basic") basic[item.target_code.toLowerCase()] = value;
      else if (item.target_namespace === "attribute") attributes[item.target_code] = value;
      else if (item.target_namespace === "category_hint") categoryHint = value;
      else supplierReference[item.target_code] = value;
      adaptiveMappings[key] = {
        source_column_indexes: sourceIndexes,
        combination_strategy: combination,
        confidence: item.mapping_confidence ?? 0,
        mapping_status: item.adaptive_mapping_status ?? "UNMAPPED",
        evidence: item.mapping_evidence ?? [],
      };
    }

    if (adaptiveRow && !supplierReference.SUPPLIER_SPECIFICATION) {
      pushIssues([issue("ERROR", "NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED", "supplier_reference.SUPPLIER_SPECIFICATION", null, "未建立规格 Mapping，禁止以空规格进入物料草稿")]);
    }

    if (issueLimitReached) {
      allIssues.push(issue("ERROR", "NORMALIZATION_ISSUE_LIMIT_EXCEEDED", "row.__ROW__", null, "单行问题数量超过限制"));
    }
    const candidateValue = (value: unknown): unknown => value && typeof value === "object" && "candidate" in value
      ? (value as { candidate?: unknown }).candidate ?? null
      : null;
    const adaptiveStatuses = input.mappingItems.map((item) => item.adaptive_mapping_status ?? "UNMAPPED");
    const mappingStatus = adaptiveStatuses.includes("CONFLICT") ? "CONFLICT"
      : adaptiveStatuses.includes("UNMAPPED") ? "UNMAPPED"
        : adaptiveStatuses.includes("SUGGESTED") ? "SUGGESTED"
          : adaptiveStatuses.includes("HIGH_CONFIDENCE") ? "HIGH_CONFIDENCE" : "EXACT";
    const mappingConfidence = input.mappingItems.length
      ? input.mappingItems.reduce((sum, item) => sum + Number(item.mapping_confidence ?? 0), 0) / input.mappingItems.length
      : 0;
    const specificationItem = input.mappingItems.find((item) => item.target_namespace === "supplier_reference" && item.target_code === "SUPPLIER_SPECIFICATION");
    const specification = candidateValue(supplierReference.SUPPLIER_SPECIFICATION);
    const specificationSourceIndexes = specificationItem?.source_column_indexes
      ?? (specificationItem?.source_column_index === null || specificationItem?.source_column_index === undefined ? [] : [specificationItem.source_column_index]);
    const specificationSourceHeaders = specificationItem?.source_headers ?? [];
    const rawModelIndex = specificationSourceHeaders.findIndex((header) => /型号|model/i.test(header.split("/").at(-1) ?? header));
    const rawModelColumn = rawModelIndex >= 0 ? specificationSourceIndexes[rawModelIndex] : undefined;
    const rawModel = rawModelColumn === undefined ? null : cellTextForCanonical(cells.get(rawModelColumn));
    const payload: Record<string, unknown> = {
      schema_version: 1,
      lineage: input.lineage,
      basic,
      attributes,
      category_hint: categoryHint,
      supplier_reference: supplierReference,
      adaptive_mapping: adaptiveMappings,
      deferred_validation: ["CATEGORY_ASSIGNMENT_REQUIRED", "CATEGORY_BOUND_ATTRIBUTE_VALIDATION_REQUIRED", "MATERIAL_VALIDATION_NOT_RUN"],
    };
    let errors = allIssues.filter((item) => item.issue_level === "ERROR").length;
    let warnings = allIssues.length - errors;
    if (adaptiveRow && input.canonicalContext) {
      payload.canonical_import = {
        schema_version: 1,
        source_file_id: input.canonicalContext.source_file_id,
        source_sheet_name: input.canonicalContext.source_sheet_name,
        source_row_number: input.lineage.source_row_number,
        supplier_id: input.canonicalContext.supplier_id,
        supplier_profile_id: input.canonicalContext.supplier_profile_id,
        raw_values_reference: {
          parse_run_id: input.lineage.parse_run_id,
          sheet_index: input.lineage.sheet_index,
          row_number: input.lineage.source_row_number,
          raw_row_hash: input.lineage.raw_row_hash,
        },
        raw_material_code: candidateValue(supplierReference.SUPPLIER_ITEM_CODE),
        raw_material_name: candidateValue(basic.standard_name),
        raw_specification: specification,
        raw_model: rawModel,
        raw_brand: candidateValue(basic.brand),
        raw_unit: candidateValue(basic.unit),
        raw_category: candidateValue(categoryHint),
        raw_description: candidateValue(supplierReference.SUPPLIER_ITEM_NAME),
        raw_manufacturer_part_no: candidateValue(basic.manufacturer_part_number),
        raw_supplier_part_no: candidateValue(supplierReference.SUPPLIER_ITEM_CODE),
        mapped_values_json: { basic, attributes, category_hint: categoryHint, supplier_reference: supplierReference },
        mapping_confidence: Math.max(0, Math.min(1, mappingConfidence)),
        specification_confidence: specification ? Math.max(0, Math.min(1, Number(specificationItem?.mapping_confidence ?? 0))) : 0,
        mapping_status: mappingStatus,
        review_status: !errors && specification && ["EXACT", "CONFIRMED"].includes(specificationItem?.adaptive_mapping_status ?? "") ? "AUTO_ACCEPTABLE" : "NEEDS_REVIEW",
        created_at: input.canonicalContext.created_at,
        updated_at: input.canonicalContext.created_at,
      };
    }
    payload.row_status = errors ? "ERROR" : warnings ? "WARNING" : "VALID";
    payload.issue_summary = { issue_count: allIssues.length, error_count: errors, warning_count: warnings };
    let payloadJson = canonicalJson(payload);
    let payloadBytes = new TextEncoder().encode(payloadJson).byteLength;
    if (payloadBytes > MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxRowPayloadBytes) {
      allIssues.splice(0, allIssues.length, issue("ERROR", "NORMALIZATION_ROW_TOO_LARGE", "row.__ROW__", null, "单行规范化结果超过限制", { max_bytes: MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxRowPayloadBytes }));
      payload.basic = {};
      payload.attributes = {};
      payload.category_hint = null;
      payload.supplier_reference = {};
      errors = 1;
      warnings = 0;
      payload.row_status = "ERROR";
      payload.issue_summary = { issue_count: 1, error_count: 1, warning_count: 0 };
      payloadJson = canonicalJson(payload);
      payloadBytes = new TextEncoder().encode(payloadJson).byteLength;
    }
    return {
      normalized_payload: payload,
      normalized_payload_json: payloadJson,
      normalized_payload_hash: await hashBytes(payloadJson),
      normalized_payload_bytes: payloadBytes,
      row_status: errors ? "ERROR" : warnings ? "WARNING" : "VALID",
      error_count: errors,
      warning_count: warnings,
      issues: allIssues,
    };
  }
}

function cellTextForCanonical(cell: MaterialImportRawCell | undefined): string | null {
  if (!cell || ["EMPTY", "ERROR", "FORMULA"].includes(cell.type)) return null;
  const value = String(cell.raw_value ?? "").normalize("NFC").trim();
  return value || null;
}
