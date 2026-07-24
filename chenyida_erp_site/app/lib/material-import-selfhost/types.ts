export const MAPPING_STATUSES = ["DRAFT", "CONFIRMED", "STALE", "SUPERSEDED"] as const;
export type MappingStatus = typeof MAPPING_STATUSES[number];
export type MappingTargetNamespace = "basic" | "attribute" | "category_hint" | "supplier_reference" | "ignore";
export type MappingMode = "SOURCE" | "SOURCE_WITH_DEFAULT" | "DEFAULT" | "IGNORE";
export type MappingCombinationStrategy = "FIRST_NON_EMPTY" | "JOIN_NON_EMPTY" | "SPECIFICATION_EXTRACT";

export type MappingActor = Readonly<{
  username: string;
  must_change_password: boolean;
  permissions: readonly string[];
}>;

export type SourceField = Readonly<{
  column_index: number;
  column_ref: string;
  source_header: string;
  normalized_header: string;
}>;

export type MappingItemInput = Readonly<{
  source_column_index: number | null;
  source_column_indexes?: readonly number[];
  source_header?: string | null;
  source_headers?: readonly string[];
  target_namespace: MappingTargetNamespace;
  target_code: string;
  mapping_mode: MappingMode;
  default_value_json?: unknown;
  required: boolean;
  display_order: number;
  combination_strategy?: MappingCombinationStrategy;
  combination_separator?: string;
  mapping_confidence?: number;
  adaptive_mapping_status?: "EXACT" | "HIGH_CONFIDENCE" | "SUGGESTED" | "UNMAPPED" | "CONFLICT" | "CONFIRMED";
  mapping_evidence?: readonly string[];
}>;

export type MappingDraftInput = Readonly<{
  selected_sheet_index: number;
  header_mode: "SINGLE_ROW" | "NO_HEADER";
  header_row_number?: number | null;
  items: readonly MappingItemInput[];
}>;

export type MappingTarget = Readonly<{
  group_code: "BASIC" | "ATTRIBUTE" | "SPECIAL";
  target_namespace: MappingTargetNamespace;
  target_code: string;
  display_name: string;
  description: string;
  value_type: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "ENUM" | "NONE";
  required_for_confirm: boolean;
  mapping_modes: readonly MappingMode[];
  default_value_policy: Readonly<{ allowed: boolean; allowed_json_types: readonly string[] }>;
  unit_policy: Readonly<{ mode: "NOT_APPLICABLE" | "FORBIDDEN" | "CANONICAL"; canonical_unit: string | null; allowed_units: readonly string[] }>;
  value_constraints: Readonly<{ decimal_scale: number | null; enum_values: readonly string[]; normalization_rule: string }>;
  categories: readonly Readonly<{ category_code: string; category_name: string; required: boolean }>[];
  enabled: true;
  selectable: true;
  repeatable: boolean;
  constraints: readonly Readonly<{ code: string; message: string }>[];
  display_order: number;
}>;

export type MappingCatalogSnapshot = Readonly<{
  algorithm: "material-import-mapping-metadata-v1";
  targets: readonly MappingTarget[];
  metadataDigest: string;
  targetByKey: ReadonlyMap<string, MappingTarget>;
}>;

export type MappingReuseDecision = "AUTO_RECOMMEND" | "RECONFIRM_REQUIRED" | "INCOMPATIBLE" | "STALE";
