import type { MappingActor, MappingCatalogSnapshot, MappingItemInput } from "../material-import-selfhost/types.ts";

export const NORMALIZATION_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "PUBLISHING",
  "SUCCEEDED",
  "SUPERSEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;

export type NormalizationRunStatus = typeof NORMALIZATION_RUN_STATUSES[number];
export type NormalizationActor = MappingActor;
export type NormalizationRowStatus = "VALID" | "WARNING" | "ERROR" | "SKIPPED";

export type NormalizationMappingContext = Readonly<{
  batchId: number;
  parseRunId: number;
  mappingId: number;
  mappingVersion: number;
  mappingDigest: string;
  sourceSchemaDigest: string;
  metadataDigest: string;
  sourceFileId: number;
  sourceSheetId: number;
  sourceSheetIndex: number;
  sourceSheetName: string;
  headerRowNumber: number | null;
  sourceFields: readonly Readonly<{
    column_index: number;
    column_ref: string;
    source_header: string;
    normalized_header: string;
  }>[];
  mappingSnapshot: Record<string, unknown>;
  mappingItems: readonly MappingItemInput[];
  catalog: MappingCatalogSnapshot;
}>;

export type FieldCandidateRecord = Readonly<{
  targetNamespace: "basic" | "category_hint" | "supplier_reference";
  targetCode: string;
  rawValue: unknown;
  normalizedValue: unknown;
  valueState: string;
  validationStatus: "VALID" | "WARNING" | "ERROR" | "EMPTY";
  ruleCode: string;
  ruleVersion: string;
  displayOrder: number;
}>;

export type AttributeCandidateRecord = Readonly<{
  attributeCode: string;
  attributeName: string;
  dataType: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "ENUM";
  rawValue: unknown;
  normalizedValue: unknown;
  unitCode: string | null;
  validationStatus: "VALID" | "WARNING" | "ERROR" | "EMPTY";
  ruleCode: string;
  ruleVersion: string;
  displayOrder: number;
}>;

export type LineageRecord = Readonly<{
  targetNamespace: "basic" | "attribute" | "category_hint" | "supplier_reference";
  targetCode: string;
  attributeCode: string | null;
  sourceColumnIndex: number | null;
  sourceColumnName: string | null;
  sourceFieldKey: string | null;
  rawValueSummary: unknown;
  normalizedValueSummary: unknown;
  ruleCode: string;
  ruleVersion: string;
  steps: readonly string[];
  ordinal: number;
}>;

export type IssueRecord = Readonly<{
  issueKey: string;
  level: "ERROR" | "WARNING";
  code: string;
  targetCode: string;
  attributeCode: string | null;
  sourceColumnIndex: number | null;
  message: string;
  safeDetails: Record<string, unknown>;
  sourceValueSummary: unknown;
  ruleCode: string;
}>;

export type NormalizedRowBundle = Readonly<{
  payload: Record<string, unknown>;
  payloadHash: string;
  payloadBytes: number;
  mappedValues: Record<string, unknown>;
  rowStatus: NormalizationRowStatus;
  fieldCandidates: readonly FieldCandidateRecord[];
  attributeCandidates: readonly AttributeCandidateRecord[];
  lineage: readonly LineageRecord[];
  issues: readonly IssueRecord[];
}>;
