import { createHash } from "node:crypto";
import { MaterialImportRowNormalizer, MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION } from "../material-import/normalization-model.ts";
import type { MaterialImportRawRow } from "../material-import/parser-model.ts";
import { canonicalJson } from "../material-import-selfhost/rules.ts";
import type { MappingItemInput, MappingTarget } from "../material-import-selfhost/types.ts";
import type {
  AttributeCandidateRecord,
  FieldCandidateRecord,
  IssueRecord,
  LineageRecord,
  NormalizationMappingContext,
  NormalizedRowBundle,
} from "./types.ts";

export const SELFHOST_NORMALIZER_RULE_VERSION = MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION;
export const SELFHOST_NORMALIZATION_CHUNK_ROWS = 100;

type CandidateValue = Readonly<{
  target_code: string;
  source: Readonly<{ kind: string; column_index: number | null; value_state: string; raw_value: unknown }>;
  candidate: unknown;
  status: "VALID" | "WARNING" | "ERROR";
}>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bounded(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 2_000);
  if (depth >= 3) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => bounded(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 32).map(([key, item]) => [key.slice(0, 128), bounded(item, depth + 1)]));
  }
  return String(value).slice(0, 2_000);
}

function targetRule(target: MappingTarget): string {
  if (target.value_constraints.normalization_rule && target.value_constraints.normalization_rule !== "NONE") return target.value_constraints.normalization_rule;
  return ({
    TEXT: "TEXT_TRIM_NFC",
    INTEGER: "STRICT_INTEGER",
    DECIMAL: "STRICT_DECIMAL",
    BOOLEAN: "STRICT_BOOLEAN",
    DATE: "ISO_DATE",
    ENUM: "STRICT_ENUM",
    NONE: "NONE",
  } as const)[target.value_type];
}

function validationStatus(candidate: CandidateValue): "VALID" | "WARNING" | "ERROR" | "EMPTY" {
  if (candidate.status === "ERROR") return "ERROR";
  if (candidate.status === "WARNING") return "WARNING";
  return candidate.candidate === null ? "EMPTY" : "VALID";
}

function candidatesFromPayload(payload: Record<string, unknown>): readonly Readonly<{
  namespace: "basic" | "attribute" | "category_hint" | "supplier_reference";
  code: string;
  candidate: CandidateValue;
}>[] {
  const output: { namespace: "basic" | "attribute" | "category_hint" | "supplier_reference"; code: string; candidate: CandidateValue }[] = [];
  for (const [namespace, payloadKey] of [["basic", "basic"], ["attribute", "attributes"], ["supplier_reference", "supplier_reference"]] as const) {
    const values = payload[payloadKey];
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [code, candidate] of Object.entries(values as Record<string, CandidateValue>)) {
      if (candidate && typeof candidate === "object") output.push({ namespace, code: namespace === "basic" ? code.toUpperCase() : code, candidate });
    }
  }
  const category = payload.category_hint;
  if (category && typeof category === "object" && !Array.isArray(category)) output.push({ namespace: "category_hint", code: "CATEGORY_HINT", candidate: category as CandidateValue });
  return output;
}

function sourceColumns(item: MappingItemInput): readonly number[] {
  if (item.mapping_mode === "DEFAULT") return [];
  if (item.source_column_indexes?.length) return item.source_column_indexes;
  return item.source_column_index === null ? [] : [item.source_column_index];
}

export class SelfhostMaterialImportRowNormalizer {
  readonly #delegate = new MaterialImportRowNormalizer();

  async normalize(input: Readonly<{
    runId: number;
    rowNumber: number;
    rawRowHash: string;
    rawRow: MaterialImportRawRow;
    mapping: NormalizationMappingContext;
  }>): Promise<NormalizedRowBundle> {
    const legacyItems = input.mapping.mappingItems.map((item) => {
      const columns = sourceColumns(item);
      return {
        source_column_index: item.source_column_index,
        ...(columns.length > 1 ? { source_column_indexes: columns, source_headers: item.source_headers } : {}),
        target_namespace: item.target_namespace,
        target_code: item.target_code,
        mapping_mode: item.mapping_mode,
        default_value: item.default_value_json ?? null,
        required: item.required,
        display_order: item.display_order,
        ...(columns.length > 1 ? {
          combination_strategy: item.combination_strategy,
          combination_separator: item.combination_separator,
        } : {}),
      };
    });
    const legacy = await this.#delegate.normalize({
      lineage: {
        batch_id: input.mapping.batchId,
        parse_run_id: input.mapping.parseRunId,
        normalization_run_id: input.runId,
        mapping_id: input.mapping.mappingId,
        mapping_version: input.mapping.mappingVersion,
        mapping_digest: input.mapping.mappingDigest,
        metadata_digest: input.mapping.metadataDigest,
        processor_version: SELFHOST_NORMALIZER_RULE_VERSION,
        sheet_index: input.mapping.sourceSheetIndex,
        row_number: input.rowNumber,
        source_row_number: input.rowNumber,
        raw_row_hash: input.rawRowHash,
      },
      rawRow: input.rawRow,
      mappingItems: legacyItems as never,
      metadataSnapshot: input.mapping.catalog as never,
    });
    const payload = legacy.normalized_payload as Record<string, unknown>;
    const extracted = candidatesFromPayload(payload);
    const itemByTarget = new Map(input.mapping.mappingItems.map((item) => [`${item.target_namespace}.${item.target_code}`, item]));
    const targetByKey = input.mapping.catalog.targetByKey;
    const fieldCandidates: FieldCandidateRecord[] = [];
    const attributeCandidates: AttributeCandidateRecord[] = [];
    const lineage: LineageRecord[] = [];
    for (const [displayOrder, entry] of extracted.entries()) {
      const stableCode = entry.candidate.target_code.split(".").at(-1) || entry.code;
      const item = itemByTarget.get(`${entry.namespace}.${stableCode}`);
      const target = targetByKey.get(`${entry.namespace}\u0000${stableCode}`);
      if (!item || !target) continue;
      const ruleCode = targetRule(target);
      const status = validationStatus(entry.candidate);
      if (entry.namespace === "attribute") {
        const normalized = entry.candidate.candidate;
        const unitCode = normalized && typeof normalized === "object" && !Array.isArray(normalized) && "unit" in normalized ? String((normalized as { unit: unknown }).unit) : null;
        attributeCandidates.push({
          attributeCode: stableCode,
          attributeName: target.display_name,
          dataType: target.value_type as AttributeCandidateRecord["dataType"],
          rawValue: bounded(entry.candidate.source.raw_value),
          normalizedValue: bounded(normalized),
          unitCode,
          validationStatus: status,
          ruleCode,
          ruleVersion: SELFHOST_NORMALIZER_RULE_VERSION,
          displayOrder,
        });
      } else {
        fieldCandidates.push({
          targetNamespace: entry.namespace,
          targetCode: stableCode,
          rawValue: bounded(entry.candidate.source.raw_value),
          normalizedValue: bounded(entry.candidate.candidate),
          valueState: entry.candidate.source.value_state,
          validationStatus: status,
          ruleCode,
          ruleVersion: SELFHOST_NORMALIZER_RULE_VERSION,
          displayOrder,
        });
      }
      const columns = sourceColumns(item);
      const lineageColumns = columns.length ? columns : [null];
      for (const [ordinal, column] of lineageColumns.entries()) {
        const sourceField = column === null ? null : input.mapping.sourceFields.find((field) => field.column_index === column) ?? null;
        const rawCell = column === null ? null : input.rawRow.cells.find((cell) => cell.column_index === column) ?? null;
        lineage.push({
          targetNamespace: entry.namespace,
          targetCode: stableCode,
          attributeCode: entry.namespace === "attribute" ? stableCode : null,
          sourceColumnIndex: column,
          sourceColumnName: sourceField?.source_header ?? item.source_headers?.[ordinal] ?? null,
          sourceFieldKey: sourceField?.normalized_header ?? null,
          rawValueSummary: bounded(column === null ? item.default_value_json ?? null : rawCell?.raw_value ?? null),
          normalizedValueSummary: bounded(entry.candidate.candidate),
          ruleCode,
          ruleVersion: SELFHOST_NORMALIZER_RULE_VERSION,
          steps: Object.freeze([
            column === null ? "DEFAULT_VALUE" : "READ_SOURCE_CELL",
            target.value_type === "TEXT" ? "NFC_TRIM" : `PARSE_${target.value_type}`,
            "VALIDATE_TARGET",
          ]),
          ordinal,
        });
      }
    }
    const retainedIssues = legacy.issues.filter((entry) => entry.issue_code !== "NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED");
    const retainedErrors = retainedIssues.filter((entry) => entry.issue_level === "ERROR").length;
    const retainedWarnings = retainedIssues.length - retainedErrors;
    payload.row_status = retainedErrors ? "ERROR" : retainedWarnings ? "WARNING" : payload.row_disposition === "SKIPPED" ? "SKIPPED" : "VALID";
    payload.issue_summary = { issue_count: retainedIssues.length, error_count: retainedErrors, warning_count: retainedWarnings };
    const issues: IssueRecord[] = retainedIssues.map((entry, index) => {
      const attributeCode = entry.target_code.startsWith("attribute.") ? entry.target_code.slice("attribute.".length) : null;
      const rawCell = entry.source_column_index === null ? null : input.rawRow.cells.find((cell) => cell.column_index === entry.source_column_index);
      const identity = canonicalJson({
        run: input.runId,
        row: input.rowNumber,
        target: entry.target_code,
        code: entry.issue_code,
        column: entry.source_column_index,
        ordinal: index,
      });
      return {
        issueKey: hash(identity),
        level: entry.issue_level,
        code: entry.issue_code,
        targetCode: entry.target_code,
        attributeCode,
        sourceColumnIndex: entry.source_column_index,
        message: entry.safe_message.slice(0, 500),
        safeDetails: bounded(entry.safe_details) as Record<string, unknown>,
        sourceValueSummary: bounded(rawCell?.raw_value ?? null),
        ruleCode: entry.issue_code,
      };
    });
    const rowStatus = payload.row_disposition === "SKIPPED" ? "SKIPPED" : retainedErrors ? "ERROR" : retainedWarnings ? "WARNING" : "VALID";
    const mappedValues = {
      basic: payload.basic ?? {},
      attributes: payload.attributes ?? {},
      category_hint: payload.category_hint ?? null,
      supplier_reference: payload.supplier_reference ?? {},
    };
    const payloadJson = canonicalJson(payload);
    return {
      payload,
      payloadHash: hash(payloadJson),
      payloadBytes: Buffer.byteLength(payloadJson),
      mappedValues,
      rowStatus,
      fieldCandidates,
      attributeCandidates,
      lineage,
      issues,
    };
  }
}
