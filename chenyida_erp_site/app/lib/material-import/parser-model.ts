export const MATERIAL_IMPORT_PARSER_VERSION = "material-import-parser-v1";

export const MATERIAL_IMPORT_PARSER_LIMITS = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024,
  maxSheets: 32,
  maxRows: 50_000,
  maxColumns: 256,
  maxCellCharacters: 32_767,
  maxNonEmptyCells: 2_000_000,
  maxSharedStrings: 200_000,
  maxTotalSharedStringBytes: 64 * 1024 * 1024,
  maxSingleSharedStringBytes: 256 * 1024,
  maxSharedStringCacheBytes: 8 * 1024 * 1024,
  maxFormulaCharacters: 8_192,
  maxRowJsonBytes: 512 * 1024,
  maxTotalNormalizedJsonBytes: 256 * 1024 * 1024,
  maxTotalDecodedTextBytes: 384 * 1024 * 1024,
  maxWarningDetails: 100,
  maxErrorDetails: 100,
  maxWarningDetailBytes: 256 * 1024,
  maxErrorDetailBytes: 256 * 1024,
  logicalWriteRows: 100,
  progressRows: 500,
} as const);

export type MaterialImportCellType = "EMPTY" | "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "FORMULA" | "ERROR";

export type MaterialImportRawCell = Readonly<{
  column_index: number;
  column_ref: string;
  type: MaterialImportCellType;
  source_type: string;
  raw_value: string | null;
  display: string | null;
  format_code: string | null;
  formula_injection_risk?: boolean;
  formula?: string;
  cached_value?: string | null;
  cached_type?: string | null;
  date_system?: "1900" | "1904";
  interpreted_iso_value?: string | null;
  interpretation_status?: "INTERPRETED" | "FAILED";
}>;

export type MaterialImportRawRow = Readonly<{
  schema_version: 1;
  source_column_count: number;
  cells: readonly MaterialImportRawCell[];
}>;

export type MaterialImportParsedRow = Readonly<{
  sheetIndex: number;
  sheetName: string;
  rowNumber: number;
  raw: MaterialImportRawRow;
  rawJson: string;
  rawRowHash: string;
}>;

export type MaterialImportParserWarning = Readonly<{ code: string; message: string; sheetIndex?: number; rowNumber?: number }>;

export class MaterialImportParserError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export function columnReference(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "列索引无效");
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export function columnIndex(reference: string): number {
  const match = /^([A-Z]+)[1-9][0-9]*$/i.exec(reference);
  if (!match) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "单元格引用无效");
  let value = 0;
  for (const character of match[1].toUpperCase()) value = value * 26 + character.charCodeAt(0) - 64;
  return value - 1;
}

function orderedCell(cell: MaterialImportRawCell): Record<string, unknown> {
  const value: Record<string, unknown> = {
    column_index: cell.column_index,
    column_ref: cell.column_ref,
    type: cell.type,
    source_type: cell.source_type,
    raw_value: cell.raw_value,
    display: cell.display,
    format_code: cell.format_code,
  };
  for (const key of ["formula_injection_risk", "formula", "cached_value", "cached_type", "date_system", "interpreted_iso_value", "interpretation_status"] as const) {
    if (cell[key] !== undefined) value[key] = cell[key];
  }
  return value;
}

export async function normalizeRawRow(sourceColumnCount: number, cells: readonly MaterialImportRawCell[]): Promise<Readonly<{ raw: MaterialImportRawRow; json: string; hash: string }>> {
  if (!Number.isInteger(sourceColumnCount) || sourceColumnCount < 0 || sourceColumnCount > MATERIAL_IMPORT_PARSER_LIMITS.maxColumns) {
    throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "源列数超过限制");
  }
  const sorted = [...cells].sort((left, right) => left.column_index - right.column_index);
  if (sorted.some((cell, index) => cell.column_index < 0 || cell.column_index >= sourceColumnCount || (index > 0 && sorted[index - 1].column_index === cell.column_index))) {
    throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "原始单元格索引无效");
  }
  const raw: MaterialImportRawRow = { schema_version: 1, source_column_count: sourceColumnCount, cells: sorted };
  const canonical = { schema_version: 1 as const, source_column_count: sourceColumnCount, cells: sorted.map(orderedCell) };
  const json = JSON.stringify(canonical);
  if (new TextEncoder().encode(json).byteLength > MATERIAL_IMPORT_PARSER_LIMITS.maxRowJsonBytes) {
    throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "单行规范化数据超过限制");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { raw, json, hash };
}
