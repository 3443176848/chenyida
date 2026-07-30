import type { MaterialImportRawRow } from "../material-import/parser-model.ts";

export const MATERIAL_STANDARDIZATION_VERSION = "CYD-MATERIAL-13C-v1";

export const MATERIAL_STANDARD_COLUMNS = Object.freeze([
  Object.freeze({ key: "sequence", label: "序号" }),
  Object.freeze({ key: "project", label: "项目号" }),
  Object.freeze({ key: "board_type", label: "板子类型" }),
  Object.freeze({ key: "internal_model", label: "内部型号" }),
  Object.freeze({ key: "specification", label: "物料规格描述" }),
  Object.freeze({ key: "brand", label: "品牌" }),
  Object.freeze({ key: "usage", label: "用量" }),
  Object.freeze({ key: "alternative", label: "替代料" }),
  Object.freeze({ key: "supplier", label: "供应商" }),
  Object.freeze({ key: "order_quantity", label: "订单数量" }),
  Object.freeze({ key: "demand_quantity", label: "需求数量" }),
  Object.freeze({ key: "purchase_quantity", label: "购买数量" }),
  Object.freeze({ key: "inventory", label: "库存数" }),
]);

export type MaterialStandardColumnKey = typeof MATERIAL_STANDARD_COLUMNS[number]["key"];

export type MaterialStandardizationIssue = Readonly<{
  code: string;
  message: string;
  level: "WARNING" | "ERROR";
}>;

export type MaterialStandardizationSourceField = Readonly<{
  column_index: number;
  source_header: string;
  normalized_header?: string;
}>;

export type MaterialStandardizationMappingItem = Readonly<{
  source_column_index: number | null;
  source_column_indexes?: readonly number[];
  target_namespace: string;
  target_code: string;
  mapping_mode: string;
  default_value_json?: unknown;
  combination_strategy?: string;
  combination_separator?: string;
}>;

export type MaterialStandardizationSourceRow = Readonly<{
  rowNumber: number;
  raw: MaterialImportRawRow | unknown;
}>;

export type MaterialStandardizationRow = Readonly<{
  sequence: number;
  source_row_number: number;
  alternative_source_rows: readonly number[];
  values: Readonly<Record<MaterialStandardColumnKey, string>>;
  issues: readonly MaterialStandardizationIssue[];
}>;

export type MaterialStandardizationProfile = Readonly<{
  state: "TEMPLATE_CONFIRMED" | "MAPPING_CONFIRMED" | "PROFILE_PENDING";
  ready: boolean;
  label: string;
  mapping_status: string;
  template_match: boolean;
}>;

export type MaterialStandardizationProjection = Readonly<{
  standard_version: typeof MATERIAL_STANDARDIZATION_VERSION;
  columns: typeof MATERIAL_STANDARD_COLUMNS;
  profile: MaterialStandardizationProfile;
  source: Readonly<{
    filename: string;
    sheet_name: string;
    sheet_index: number;
    parse_run_id: number;
  }>;
  summary: Readonly<{
    source_row_count: number;
    standardized_row_count: number;
    folded_alternative_count: number;
    skipped_row_count: number;
    issue_row_count: number;
    warning_count: number;
    error_count: number;
  }>;
  global_issues: readonly MaterialStandardizationIssue[];
  rows: readonly MaterialStandardizationRow[];
}>;

export type MaterialStandardizationInput = Readonly<{
  filename: string;
  sheetName: string;
  sheetIndex: number;
  parseRunId: number;
  mappingStatus: string;
  sourceFields: readonly MaterialStandardizationSourceField[];
  mappingItems: readonly MaterialStandardizationMappingItem[];
  preludeRows?: readonly MaterialStandardizationSourceRow[];
  rows: readonly MaterialStandardizationSourceRow[];
}>;
