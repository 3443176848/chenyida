export const MATERIAL_STANDARDIZATION_COLUMNS = Object.freeze([
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

export type MaterialStandardizationColumnKey = typeof MATERIAL_STANDARDIZATION_COLUMNS[number]["key"];
export type MaterialStandardizationIssueDto = { code: string; message: string; level: "WARNING" | "ERROR" };
export type MaterialStandardizationRowDto = {
  sequence: number;
  source_row_number: number;
  alternative_source_rows: number[];
  values: Record<MaterialStandardizationColumnKey, string>;
  issues: MaterialStandardizationIssueDto[];
};
export type MaterialStandardizationResponse = {
  request_id?: string;
  batch_id: number;
  batch_no: string;
  batch_status: string;
  standard_version: "CYD-MATERIAL-13C-v1";
  columns: typeof MATERIAL_STANDARDIZATION_COLUMNS;
  profile: {
    state: "TEMPLATE_CONFIRMED" | "MAPPING_CONFIRMED" | "PROFILE_PENDING";
    ready: boolean;
    label: string;
    mapping_status: string;
    template_match: boolean;
  };
  source: { filename: string; sheet_name: string; sheet_index: number; parse_run_id: number };
  summary: {
    source_row_count: number;
    standardized_row_count: number;
    folded_alternative_count: number;
    skipped_row_count: number;
    issue_row_count: number;
    warning_count: number;
    error_count: number;
  };
  global_issues: MaterialStandardizationIssueDto[];
  rows: MaterialStandardizationRowDto[];
  pagination: { page: number; page_size: 20 | 50; total_rows: number; total_pages: number };
};

export function materialStandardizationPreviewUrl(batchId: number, page: number, pageSize: 20 | 50): string {
  return `/api/material-master/import-batches/${batchId}/standardization-preview?page=${page}&page_size=${pageSize}`;
}

export function materialStandardizationExportUrl(batchId: number): string {
  return `/api/material-master/import-batches/${batchId}/standardization-export.csv`;
}
