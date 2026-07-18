import type { MaterialImportRawCell, MaterialImportRawRow } from "./parser-model.ts";

export const MATERIAL_IMPORT_ADAPTIVE_ALGORITHM_VERSION = "adaptive-supplier-v1";
export const MATERIAL_IMPORT_HEADER_SCAN_ROWS = 50;

export type CanonicalField =
  | "material_code" | "material_name" | "specification" | "model" | "brand" | "unit"
  | "category" | "description" | "manufacturer_part_no" | "supplier_part_no"
  | "drawing_no" | "quantity" | "price";
export type AdaptiveMappingStatus = "EXACT" | "HIGH_CONFIDENCE" | "SUGGESTED" | "UNMAPPED" | "CONFLICT";
export type AdaptiveReviewStatus = "AUTO_ACCEPTABLE" | "NEEDS_REVIEW" | "CONFIRMED" | "REJECTED";
export type AdaptiveRowKind = "DATA" | "BLANK" | "TITLE_OR_NOTE" | "REPEATED_HEADER" | "SUBTOTAL" | "TOTAL" | "FOOTER";
export type AdaptiveDataRowClassification = Readonly<{
  kind: AdaptiveRowKind;
  confidence: number;
  reasonCodes: readonly string[];
}>;

export type AdaptiveImportRow = Readonly<{ rowNumber: number; raw: MaterialImportRawRow }>;
export type AdaptiveImportSheet = Readonly<{
  sheetIndex: number;
  sheetName: string;
  rowCount: number;
  sourceColumnMax: number;
  mergedRanges?: readonly string[];
  rows: readonly AdaptiveImportRow[];
}>;

export type AdaptiveColumn = Readonly<{
  columnIndex: number;
  headerPath: string;
  headerParts: readonly string[];
  sampleValues: readonly string[];
  textRatio: number;
  numericRatio: number;
  uniqueRatio: number;
}>;

export type AdaptiveHeaderCandidate = Readonly<{
  sheetIndex: number;
  headerStartRow: number;
  headerEndRow: number;
  dataStartRow: number;
  score: number;
  aliasHitCount: number;
  keyFieldHitCount: number;
  columns: readonly AdaptiveColumn[];
  reasonCodes: readonly string[];
}>;

export type AdaptiveSheetAnalysis = Readonly<{
  sheetIndex: number;
  sheetName: string;
  score: number;
  confidence: number;
  nonEmptyRows: number;
  nonEmptyColumns: number;
  selectedHeader: AdaptiveHeaderCandidate | null;
  headerCandidates: readonly AdaptiveHeaderCandidate[];
  rowClassifications: readonly Readonly<{ rowNumber: number; kind: AdaptiveRowKind; reasonCodes: readonly string[] }>[];
  reasonCodes: readonly string[];
}>;

export type AdaptiveStructureResult = Readonly<{
  algorithmVersion: string;
  selectedSheetIndex: number | null;
  confidence: number;
  status: "HIGH_CONFIDENCE" | "NEEDS_REVIEW" | "NO_CANDIDATE";
  sheets: readonly AdaptiveSheetAnalysis[];
}>;

export type AdaptiveFieldMapping = Readonly<{
  field: CanonicalField;
  sourceColumnIndexes: readonly number[];
  sourceHeaders: readonly string[];
  combinationStrategy: "FIRST_NON_EMPTY" | "JOIN_NON_EMPTY" | "SPECIFICATION_EXTRACT";
  separator: string;
  confidence: number;
  status: AdaptiveMappingStatus;
  evidence: readonly string[];
}>;

export type SupplierImportProfile = Readonly<{
  id?: number;
  supplierKey: string;
  headerAliases?: Readonly<Partial<Record<CanonicalField, readonly string[]>>>;
  preferredMappings?: Readonly<Partial<Record<CanonicalField, readonly string[]>>>;
  templateFingerprint?: string | null;
}>;

export function adaptiveTemplateSignatureFromHeaderPaths(headerPaths: readonly string[], headerSpan: number): string {
  return JSON.stringify({
    schema_version: 1,
    header_span: Math.max(1, Math.min(3, Math.trunc(headerSpan))),
    columns: headerPaths.map(normalizedHeader),
  });
}

export function adaptiveTemplateSignature(header: AdaptiveHeaderCandidate): string {
  return adaptiveTemplateSignatureFromHeaderPaths(
    header.columns.map((column) => column.headerPath),
    header.headerEndRow - header.headerStartRow + 1,
  );
}

export type CanonicalImportRow = Readonly<{
  source_file_id: number;
  source_sheet_name: string;
  source_row_number: number;
  supplier_id: string | null;
  supplier_profile_id: number | null;
  raw_values_json: MaterialImportRawRow;
  raw_material_code: string | null;
  raw_material_name: string | null;
  raw_specification: string | null;
  raw_model: string | null;
  raw_brand: string | null;
  raw_unit: string | null;
  raw_category: string | null;
  raw_description: string | null;
  raw_manufacturer_part_no: string | null;
  raw_supplier_part_no: string | null;
  mapped_values_json: Readonly<Record<string, string | null>>;
  mapping_confidence: number;
  specification_confidence: number;
  mapping_status: AdaptiveMappingStatus;
  review_status: AdaptiveReviewStatus;
  specification_evidence: readonly string[];
  created_at: string;
  updated_at: string;
}>;

export const MATERIAL_IMPORT_FIELD_ALIASES: Readonly<Record<CanonicalField, readonly string[]>> = Object.freeze({
  material_code: Object.freeze(["物料编码", "物料代码", "物料编号", "产品编码", "产品编号", "料号", "货号", "item code", "material code", "part no"]),
  material_name: Object.freeze(["物料名称", "物料名", "产品名称", "产品名", "品名", "名称", "货品名称", "name", "item name", "material name"]),
  specification: Object.freeze(["规格", "规格型号", "型号规格", "产品规格", "规格参数", "技术规格", "规格描述", "尺寸", "参数", "品名及规格", "品名规格", "料号描述", "物料描述", "产品描述", "description", "specification", "spec", "model/spec", "size"]),
  model: Object.freeze(["型号", "产品型号", "物料型号", "model", "model no"]),
  brand: Object.freeze(["品牌", "牌子", "brand"]),
  unit: Object.freeze(["单位", "计量单位", "基本单位", "采购单位", "uom", "unit"]),
  category: Object.freeze(["分类", "物料分类", "产品分类", "类别", "品类", "category"]),
  description: Object.freeze(["描述", "物料描述", "产品描述", "料号描述", "说明", "备注", "description", "remark"]),
  manufacturer_part_no: Object.freeze(["制造商料号", "厂家料号", "厂商料号", "厂商物料编码", "厂家物料编码", "原厂料号", "mpn", "manufacturer part no"]),
  supplier_part_no: Object.freeze(["供应商料号", "供方料号", "供应商编码", "vendor part no", "supplier part no"]),
  drawing_no: Object.freeze(["图号", "图纸编号", "drawing no", "drawing number"]),
  quantity: Object.freeze(["数量", "用量", "需求数量", "采购数量", "qty", "quantity"]),
  price: Object.freeze(["单价", "价格", "含税单价", "未税单价", "price", "unit price"]),
});

const KEY_FIELDS = new Set<CanonicalField>(["material_code", "material_name", "specification", "unit"]);
const NOTE_WORDS = /说明|须知|注意|报价单|报价表|价格表|清单|目录|封面|统计|汇总|变更记录|修改记录|制表|联系人|电话|地址/i;
const EMBEDDED_TITLE_WORDS = /(?:^|[^a-z])bom(?:[^a-z]|$)|物料清单|材料清单/i;
const MATERIAL_SHEET_WORDS = /(?:^|[^a-z])bom(?:[^a-z]|$)|物料|材料|明细|清单/i;
const NON_MATERIAL_SHEET_WORDS = /变更|修改记录|修订|版本记录|change\s*log|revision|history/i;
const TOTAL_WORDS = /^(总计|合计|累计|grand\s*total|total)$/i;
const SUBTOTAL_WORDS = /^(小计|subtotal)$/i;
const FOOTER_WORDS = /^(审核|批准|签字|制表|备注|页码|第\s*\d+\s*页)/i;
const SPEC_CONTRIBUTOR = /型号|尺寸|材质|材料|颜色|参数|封装|等级|厚度|宽度|长度|model|size|parameter/i;
const DIMENSION_TOKEN = /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|mil|inch|英寸)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m|mil|inch|英寸)?\b/i;
const TECH_TOKEN = /\b(?:0[1248]\d{2}|[A-Z]{1,6}[-/]?[A-Z0-9]{1,20}|-?\d+(?:\.\d+)?\s*(?:kΩ|mΩ|Ω|ohm|pf|nf|uf|μf|v|kv|a|ma|w|kw|hz|mhz|ghz|℃|°c))\b/i;

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).normalize("NFC").trim()
    : "";
}

function cellText(cell: MaterialImportRawCell | undefined): string {
  if (!cell || cell.type === "EMPTY" || cell.type === "ERROR" || cell.type === "FORMULA") return "";
  return text(cell.type === "DATE" && cell.interpretation_status === "INTERPRETED" ? cell.interpreted_iso_value : cell.raw_value);
}

function values(row: AdaptiveImportRow): Map<number, string> {
  return new Map(row.raw.cells.map((cell) => [cell.column_index, cellText(cell)]));
}

function normalizedHeader(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_\-—–:：;；,，.。()（）[\]【】/\\]+/g, "");
}

function aliasMap(profile?: SupplierImportProfile): ReadonlyMap<string, ReadonlySet<CanonicalField>> {
  const result = new Map<string, Set<CanonicalField>>();
  for (const field of Object.keys(MATERIAL_IMPORT_FIELD_ALIASES) as CanonicalField[]) {
    for (const alias of [...MATERIAL_IMPORT_FIELD_ALIASES[field], ...(profile?.headerAliases?.[field] ?? [])]) {
      const key = normalizedHeader(alias);
      if (!key) continue;
      const fields = result.get(key) ?? new Set<CanonicalField>();
      fields.add(field);
      result.set(key, fields);
    }
  }
  return result;
}

function columnReferenceIndex(reference: string): number {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase() ?? "";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function mergedParents(sheet: AdaptiveImportSheet, startRow: number, endRow: number): Map<string, string> {
  const direct = new Map<string, string>();
  for (const row of sheet.rows.filter((candidate) => candidate.rowNumber >= startRow && candidate.rowNumber <= endRow)) {
    for (const [column, value] of values(row)) if (value) direct.set(`${row.rowNumber}:${column}`, value);
  }
  const propagated = new Map(direct);
  for (const range of sheet.mergedRanges ?? []) {
    const match = /^([A-Z]+\d+):([A-Z]+\d+)$/i.exec(range);
    if (!match) continue;
    const startColumn = columnReferenceIndex(match[1]);
    const endColumn = columnReferenceIndex(match[2]);
    const start = Number(/\d+$/.exec(match[1])?.[0]);
    const end = Number(/\d+$/.exec(match[2])?.[0]);
    if (start < startRow || start > endRow) continue;
    const parent = direct.get(`${start}:${startColumn}`);
    if (!parent) continue;
    for (let row = start; row <= Math.min(end, endRow); row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        if (!propagated.get(`${row}:${column}`)) propagated.set(`${row}:${column}`, parent);
      }
    }
  }
  return propagated;
}

function headerColumns(sheet: AdaptiveImportSheet, startRow: number, endRow: number): AdaptiveColumn[] {
  const merged = mergedParents(sheet, startRow, endRow);
  const dataRows = sheet.rows.filter((row) => row.rowNumber > endRow).slice(0, 20);
  const columns: AdaptiveColumn[] = [];
  for (let column = 0; column < sheet.sourceColumnMax; column += 1) {
    const parts: string[] = [];
    for (let row = startRow; row <= endRow; row += 1) {
      const part = merged.get(`${row}:${column}`) ?? "";
      if (part && parts.at(-1) !== part) parts.push(part);
    }
    const samples = dataRows.map((row) => values(row).get(column) ?? "").filter(Boolean);
    const numeric = samples.filter((sample) => /^-?(?:\d+|\d+\.\d+)$/.test(sample)).length;
    columns.push({
      columnIndex: column,
      headerPath: parts.join("/"),
      headerParts: parts,
      sampleValues: samples.slice(0, 10),
      textRatio: samples.length ? (samples.length - numeric) / samples.length : 0,
      numericRatio: samples.length ? numeric / samples.length : 0,
      uniqueRatio: samples.length ? new Set(samples).size / samples.length : 0,
    });
  }
  return columns;
}

function headerHits(columns: readonly AdaptiveColumn[], aliases: ReadonlyMap<string, ReadonlySet<CanonicalField>>): { aliasHits: number; keyHits: number; fields: Set<CanonicalField> } {
  const fields = new Set<CanonicalField>();
  let aliasHits = 0;
  for (const column of columns) {
    const path = normalizedHeader(column.headerPath);
    if (!path) continue;
    const matched = new Set<CanonicalField>();
    for (const [alias, aliasFields] of aliases) {
      if (path === alias || path.endsWith(alias) || (alias.length >= 3 && path.includes(alias))) for (const field of aliasFields) matched.add(field);
    }
    if (matched.size) aliasHits += 1;
    for (const field of matched) fields.add(field);
  }
  return { aliasHits, keyHits: [...fields].filter((field) => KEY_FIELDS.has(field)).length, fields };
}

function candidate(sheet: AdaptiveImportSheet, start: number, span: number, aliases: ReadonlyMap<string, ReadonlySet<CanonicalField>>): AdaptiveHeaderCandidate {
  const end = start + span - 1;
  const columns = headerColumns(sheet, start, end);
  const nonEmpty = columns.filter((column) => column.headerPath).length;
  const uniqueHeaders = new Set(columns.map((column) => normalizedHeader(column.headerPath)).filter(Boolean)).size;
  const hits = headerHits(columns, aliases);
  const dataRows = sheet.rows.filter((row) => row.rowNumber > end).slice(0, 10);
  const widths = dataRows.map((row) => row.raw.cells.filter((cell) => cellText(cell)).length).filter(Boolean);
  const stable = widths.length > 1 ? 1 - (Math.max(...widths) - Math.min(...widths)) / Math.max(...widths) : widths.length ? 0.5 : 0;
  const substantiveDataRows = dataRows.filter((row) => {
    const rowValues = [...values(row).values()].filter(Boolean);
    if (rowValues.length < Math.max(2, Math.ceil(sheet.sourceColumnMax / 2))) return false;
    const normalized = rowValues.map(normalizedHeader);
    const aliasesInRow = normalized.filter((value) => [...aliases.keys()].some((alias) => value === alias || value.endsWith(alias))).length;
    return aliasesInRow < Math.max(2, Math.ceil(rowValues.length / 2));
  }).length;
  const merged = (sheet.mergedRanges ?? []).some((range) => {
    const rows = range.match(/\d+/g)?.map(Number) ?? [];
    return rows.some((row) => row >= start && row <= end);
  });
  const ratio = nonEmpty / Math.max(1, sheet.sourceColumnMax);
  const uniqueness = uniqueHeaders / Math.max(1, nonEmpty);
  const textRatio = nonEmpty ? columns.filter((column) => column.headerPath && !/^-?\d+(?:\.\d+)?$/.test(column.headerPath)).length / nonEmpty : 0;
  const candidateRows = sheet.rows.filter((row) => row.rowNumber >= start && row.rowNumber <= end);
  const emptyHeaderRows = candidateRows.filter((row) => !row.raw.cells.some((cell) => cellText(cell))).length;
  const unmergedSingleCellPreambles = candidateRows.slice(0, -1).filter((row) => {
    const populated = [...values(row).values()].filter(Boolean);
    if (populated.length !== 1 || sheet.sourceColumnMax < 2) return false;
    const coveredByMerge = (sheet.mergedRanges ?? []).some((range) => {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range);
      return Boolean(match && Number(match[2]) === row.rowNumber && columnReferenceIndex(match[3]) > columnReferenceIndex(match[1]));
    });
    return !coveredByMerge;
  }).length;
  const dataLikeExtraRows = candidateRows.slice(1).filter((row) => {
    const rowValues = [...values(row).values()].filter(Boolean);
    if (!rowValues.length) return false;
    const normalized = rowValues.map(normalizedHeader);
    const aliasCount = normalized.filter((value) => [...aliases.keys()].some((alias) => value === alias || value.endsWith(alias))).length;
    const numericOrCode = rowValues.filter((value) => /\d/.test(value)).length;
    return aliasCount === 0 && numericOrCode >= Math.max(1, Math.ceil(rowValues.length / 2));
  }).length;
  const dataEvidence = Math.min(1, substantiveDataRows / 2);
  const rawScore = ratio * 0.12 + textRatio * 0.08 + uniqueness * 0.08 + Math.min(1, hits.aliasHits / 4) * 0.28 + Math.min(1, hits.keyHits / 3) * 0.18 + stable * 0.11 + dataEvidence * 0.15;
  const score = Math.max(0, Math.min(1, rawScore - emptyHeaderRows * 0.3 - unmergedSingleCellPreambles * 0.35 - dataLikeExtraRows * 0.25 - (substantiveDataRows === 0 ? 0.2 : 0)));
  const reasons = [
    hits.aliasHits ? "HEADER_ALIAS_HITS" : "NO_HEADER_ALIAS_HIT",
    hits.keyHits ? "KEY_FIELD_COVERAGE" : "NO_KEY_FIELD",
    stable >= 0.7 ? "STABLE_FOLLOWING_ROWS" : "UNSTABLE_FOLLOWING_ROWS",
    merged ? "MERGED_HEADER_CONTEXT" : "NO_MERGED_HEADER_CONTEXT",
    emptyHeaderRows ? "EMPTY_ROW_IN_HEADER_PENALTY" : "NO_EMPTY_HEADER_ROW",
    unmergedSingleCellPreambles ? "UNMERGED_SINGLE_CELL_PREAMBLE_PENALTY" : "NO_SINGLE_CELL_PREAMBLE",
    dataLikeExtraRows ? "DATA_LIKE_HEADER_ROW_PENALTY" : "NO_DATA_LIKE_HEADER_ROW",
    substantiveDataRows ? "FOLLOWING_DATA_EVIDENCE" : "NO_FOLLOWING_DATA_PENALTY",
    span > 1 ? `MULTI_ROW_HEADER_${span}` : "SINGLE_ROW_HEADER",
  ];
  return { sheetIndex: sheet.sheetIndex, headerStartRow: start, headerEndRow: end, dataStartRow: end + 1, score, aliasHitCount: hits.aliasHits, keyFieldHitCount: hits.keyHits, columns, reasonCodes: reasons };
}

function classifyRows(sheet: AdaptiveImportSheet, selected: AdaptiveHeaderCandidate | null): AdaptiveSheetAnalysis["rowClassifications"] {
  const headerSignatures = new Set((selected?.columns ?? []).map((column) => normalizedHeader(column.headerPath)).filter(Boolean));
  return sheet.rows.map((row) => {
    const rowValues = [...values(row).values()].filter(Boolean);
    if (!rowValues.length) return { rowNumber: row.rowNumber, kind: "BLANK" as const, reasonCodes: ["NO_NON_EMPTY_CELL"] };
    const joined = rowValues.join(" ").trim();
    if (TOTAL_WORDS.test(joined)) return { rowNumber: row.rowNumber, kind: "TOTAL" as const, reasonCodes: ["TOTAL_MARKER"] };
    if (SUBTOTAL_WORDS.test(joined)) return { rowNumber: row.rowNumber, kind: "SUBTOTAL" as const, reasonCodes: ["SUBTOTAL_MARKER"] };
    if (FOOTER_WORDS.test(joined)) return { rowNumber: row.rowNumber, kind: "FOOTER" as const, reasonCodes: ["FOOTER_MARKER"] };
    const matches = rowValues.filter((value) => headerSignatures.has(normalizedHeader(value))).length;
    if (selected && row.rowNumber > selected.headerEndRow && matches >= Math.min(2, Math.max(1, headerSignatures.size))) return { rowNumber: row.rowNumber, kind: "REPEATED_HEADER" as const, reasonCodes: ["HEADER_SIGNATURE_REPEATED"] };
    if ((!selected || row.rowNumber < selected.headerStartRow) && (rowValues.length === 1 || NOTE_WORDS.test(joined))) return { rowNumber: row.rowNumber, kind: "TITLE_OR_NOTE" as const, reasonCodes: [rowValues.length === 1 ? "SINGLE_CELL_PREAMBLE" : "NOTE_MARKER"] };
    if (selected && row.rowNumber >= selected.headerStartRow && row.rowNumber <= selected.headerEndRow) return { rowNumber: row.rowNumber, kind: "TITLE_OR_NOTE" as const, reasonCodes: ["SELECTED_HEADER"] };
    return { rowNumber: row.rowNumber, kind: "DATA" as const, reasonCodes: ["STABLE_DATA_REGION"] };
  });
}

export function classifyAdaptiveDataRow(
  raw: MaterialImportRawRow,
  headerMappings: readonly Readonly<{ sourceColumnIndexes: readonly number[]; sourceHeaders: readonly string[] }>[],
): AdaptiveDataRowClassification {
  const populated = raw.cells
    .map((cell) => ({ columnIndex: cell.column_index, value: cellText(cell) }))
    .filter((cell) => cell.value);
  if (!populated.length) return { kind: "BLANK", confidence: 1, reasonCodes: ["NO_NON_EMPTY_CELL"] };
  if (populated.some((cell) => TOTAL_WORDS.test(cell.value))) return { kind: "TOTAL", confidence: 0.99, reasonCodes: ["TOTAL_MARKER"] };
  if (populated.some((cell) => SUBTOTAL_WORDS.test(cell.value))) return { kind: "SUBTOTAL", confidence: 0.99, reasonCodes: ["SUBTOTAL_MARKER"] };
  if (populated.some((cell) => FOOTER_WORDS.test(cell.value))) return { kind: "FOOTER", confidence: 0.96, reasonCodes: ["FOOTER_MARKER"] };

  const expectedLeaves = new Map<number, Set<string>>();
  for (const mapping of headerMappings) {
    mapping.sourceColumnIndexes.forEach((columnIndex, index) => {
      const rawHeader = mapping.sourceHeaders[index] ?? mapping.sourceHeaders[0] ?? "";
      const leaf = rawHeader.split("/").at(-1) ?? rawHeader;
      const normalized = normalizedHeader(leaf);
      if (!normalized) return;
      const leaves = expectedLeaves.get(columnIndex) ?? new Set<string>();
      leaves.add(normalized);
      expectedLeaves.set(columnIndex, leaves);
    });
  }
  const repeatedMatches = populated.filter((cell) => expectedLeaves.get(cell.columnIndex)?.has(normalizedHeader(cell.value))).length;
  const repeatedThreshold = Math.min(2, Math.max(1, expectedLeaves.size));
  if (expectedLeaves.size && repeatedMatches >= repeatedThreshold) {
    return { kind: "REPEATED_HEADER", confidence: Math.min(1, 0.8 + repeatedMatches * 0.04), reasonCodes: ["MAPPED_HEADER_SIGNATURE_REPEATED"] };
  }
  const joined = populated.map((cell) => cell.value).join(" ");
  if (populated.length <= 2 && (NOTE_WORDS.test(joined) || EMBEDDED_TITLE_WORDS.test(joined))) return { kind: "TITLE_OR_NOTE", confidence: 0.9, reasonCodes: [NOTE_WORDS.test(joined) ? "NOTE_MARKER_AFTER_HEADER" : "EMBEDDED_TITLE_MARKER"] };
  return { kind: "DATA", confidence: 0.82, reasonCodes: ["NO_NON_DATA_MARKER", "MAPPED_HEADER_SIGNATURE_NOT_REPEATED"] };
}

export function analyzeAdaptiveImportStructure(sheets: readonly AdaptiveImportSheet[], profile?: SupplierImportProfile): AdaptiveStructureResult {
  const aliases = aliasMap(profile);
  const analyses = sheets.map((sheet): AdaptiveSheetAnalysis => {
    const scan = sheet.rows.filter((row) => row.rowNumber <= MATERIAL_IMPORT_HEADER_SCAN_ROWS);
    const candidates: AdaptiveHeaderCandidate[] = [];
    for (const row of scan) for (let span = 1; span <= 3 && row.rowNumber + span - 1 <= MATERIAL_IMPORT_HEADER_SCAN_ROWS; span += 1) candidates.push(candidate(sheet, row.rowNumber, span, aliases));
    candidates.sort((left, right) => right.score - left.score || right.aliasHitCount - left.aliasHitCount || left.headerStartRow - right.headerStartRow || left.headerEndRow - right.headerEndRow);
    const selected = candidates[0] && candidates[0].score >= 0.35 ? candidates[0] : null;
    const nonEmptyRows = sheet.rows.filter((row) => row.raw.cells.some((cell) => cellText(cell))).length;
    const nonEmptyColumns = new Set(sheet.rows.flatMap((row) => row.raw.cells.filter((cell) => cellText(cell)).map((cell) => cell.column_index))).size;
    const continuity = nonEmptyRows / Math.max(1, sheet.rowCount);
    const coverPenalty = NOTE_WORDS.test(sheet.sheetName) && (selected?.aliasHitCount ?? 0) < 2 ? 0.25 : 0;
    const materialSheetBonus = MATERIAL_SHEET_WORDS.test(sheet.sheetName) ? 0.12 : 0;
    const nonMaterialSheetPenalty = NON_MATERIAL_SHEET_WORDS.test(sheet.sheetName) ? 0.28 : 0;
    const score = Math.max(0, Math.min(1, (selected?.score ?? 0) * 0.65 + Math.min(1, nonEmptyRows / 10) * 0.15 + Math.min(1, nonEmptyColumns / 4) * 0.1 + continuity * 0.1 + materialSheetBonus - coverPenalty - nonMaterialSheetPenalty));
    const reasons = [
      nonEmptyRows ? "NON_EMPTY_ROWS" : "EMPTY_SHEET",
      nonEmptyColumns >= 2 ? "MULTI_COLUMN_STRUCTURE" : "LOW_COLUMN_COUNT",
      selected?.aliasHitCount ? "MATERIAL_HEADER_ALIASES" : "NO_MATERIAL_HEADER_ALIAS",
      coverPenalty ? "COVER_OR_INSTRUCTION_PENALTY" : "NO_COVER_PENALTY",
      materialSheetBonus ? "MATERIAL_SHEET_NAME_BONUS" : "NO_MATERIAL_SHEET_NAME_BONUS",
      nonMaterialSheetPenalty ? "CHANGE_OR_HISTORY_SHEET_PENALTY" : "NO_CHANGE_OR_HISTORY_SHEET_PENALTY",
    ];
    return { sheetIndex: sheet.sheetIndex, sheetName: sheet.sheetName, score, confidence: selected?.score ?? 0, nonEmptyRows, nonEmptyColumns, selectedHeader: selected, headerCandidates: candidates.slice(0, 5), rowClassifications: classifyRows(sheet, selected), reasonCodes: reasons };
  }).sort((left, right) => right.score - left.score || left.sheetIndex - right.sheetIndex);
  const first = analyses[0];
  const second = analyses[1];
  const margin = first ? first.score - (second?.score ?? 0) : 0;
  const confidence = first ? Math.max(0, Math.min(1, first.score * 0.8 + Math.max(0, margin) * 0.2)) : 0;
  return {
    algorithmVersion: MATERIAL_IMPORT_ADAPTIVE_ALGORITHM_VERSION,
    selectedSheetIndex: first && first.selectedHeader ? first.sheetIndex : null,
    confidence,
    status: !first?.selectedHeader ? "NO_CANDIDATE" : confidence >= 0.72 && margin >= 0.08 ? "HIGH_CONFIDENCE" : "NEEDS_REVIEW",
    sheets: analyses,
  };
}

function headerScore(field: CanonicalField, header: string, alias: string): number {
  const normalized = normalizedHeader(header);
  const target = normalizedHeader(alias);
  if (!normalized || !target) return 0;
  if (field === "material_code" && /厂商|厂家|制造商|供应商|供方|原厂/.test(normalized)) return 0;
  if (normalized === target || normalized.endsWith(target)) return 1;
  if (target.length >= 3 && normalized.includes(target)) return 0.82;
  return 0;
}

function sampleScore(field: CanonicalField, column: AdaptiveColumn): number {
  const values = column.sampleValues;
  if (!values.length) return 0;
  if (field === "quantity" || field === "price") return column.numericRatio * 0.8;
  if (field === "unit") return values.filter((value) => /^(pcs?|个|件|套|卷|米|m|kg|g|箱|包|片)$/i.test(value)).length / values.length * 0.8;
  if (field === "specification" || field === "model") return values.filter((value) => DIMENSION_TOKEN.test(value) || TECH_TOKEN.test(value) || /[A-Za-z].*\d|\d.*[A-Za-z]/.test(value)).length / values.length * 0.7;
  if (field === "material_code" || field === "supplier_part_no" || field === "manufacturer_part_no") return values.filter((value) => /\d/.test(value) && !/\s/.test(value)).length / values.length * 0.5 + column.uniqueRatio * 0.3;
  return column.textRatio * 0.3 + column.uniqueRatio * 0.2;
}

export function suggestAdaptiveFieldMappings(header: AdaptiveHeaderCandidate, profile?: SupplierImportProfile): readonly AdaptiveFieldMapping[] {
  const result: AdaptiveFieldMapping[] = [];
  for (const field of Object.keys(MATERIAL_IMPORT_FIELD_ALIASES) as CanonicalField[]) {
    const aliases = [...MATERIAL_IMPORT_FIELD_ALIASES[field], ...(profile?.headerAliases?.[field] ?? [])];
    const preferred = new Set((profile?.preferredMappings?.[field] ?? []).map(normalizedHeader));
    const scored = header.columns.map((column) => {
      const alias = Math.max(0, ...aliases.map((candidate) => headerScore(field, column.headerPath, candidate)));
      const history = preferred.has(normalizedHeader(column.headerPath)) ? 0.12 : 0;
      const samples = sampleScore(field, column);
      return { column, score: Math.min(1, alias * 0.75 + samples * 0.2 + history), exact: alias === 1, history: history > 0 };
    }).filter((item) => item.score >= 0.35).sort((left, right) => right.score - left.score || left.column.columnIndex - right.column.columnIndex);
    let selected = scored.slice(0, 1);
    let strategy: AdaptiveFieldMapping["combinationStrategy"] = "FIRST_NON_EMPTY";
    if (field === "specification") {
      const contributors = header.columns.filter((column) => SPEC_CONTRIBUTOR.test(column.headerPath));
      const dedicated = scored.filter((item) => item.exact && /规格|specification|model\/spec/i.test(item.column.headerPath));
      const contributorScores = contributors.map((column) => {
        const existing = scored.find((item) => item.column.columnIndex === column.columnIndex);
        return existing ?? { column, score: 0.72 + sampleScore(field, column) * 0.2, exact: false, history: false };
      }).sort((left, right) => right.score - left.score || left.column.columnIndex - right.column.columnIndex);
      selected = (dedicated.length ? dedicated.slice(0, 1) : contributorScores.slice(0, 5)).sort((left, right) => left.column.columnIndex - right.column.columnIndex);
      if (selected.length > 1) strategy = "JOIN_NON_EMPTY";
      else if (!dedicated.length && selected.length) strategy = "SPECIFICATION_EXTRACT";
    }
    const top = selected[0];
    const conflict = Boolean(top && scored[1] && Math.abs(top.score - scored[1].score) <= 0.04 && field !== "specification");
    const confidence = top ? Math.max(0, Math.min(1, selected.reduce((sum, item) => sum + item.score, 0) / selected.length)) : 0;
    const status: AdaptiveMappingStatus = !top ? "UNMAPPED" : conflict ? "CONFLICT" : top.exact && selected.length === 1 ? "EXACT" : confidence >= 0.82 ? "HIGH_CONFIDENCE" : "SUGGESTED";
    result.push({
      field,
      sourceColumnIndexes: selected.map((item) => item.column.columnIndex),
      sourceHeaders: selected.map((item) => item.column.headerPath),
      combinationStrategy: strategy,
      separator: " ",
      confidence,
      status,
      evidence: [
        top?.exact ? "EXACT_HEADER_ALIAS" : top ? "PARTIAL_HEADER_OR_SAMPLE_MATCH" : "NO_CANDIDATE",
        top?.history ? "SUPPLIER_PROFILE_MATCH" : "NO_PROFILE_MATCH",
        selected.length > 1 ? "MULTI_COLUMN_COMBINATION" : "SINGLE_COLUMN",
        conflict ? "COMPETING_COLUMNS" : "NO_CLOSE_COMPETITOR",
      ],
    });
  }
  return result;
}

export function extractSpecificationCandidate(input: Readonly<{
  explicitValues?: readonly string[];
  componentValues?: readonly string[];
  materialName?: string | null;
  description?: string | null;
}>): Readonly<{ value: string | null; confidence: number; status: AdaptiveMappingStatus; reviewStatus: AdaptiveReviewStatus; evidence: readonly string[] }> {
  const explicit = (input.explicitValues ?? []).map(text).filter(Boolean);
  if (explicit.length) return { value: [...new Set(explicit)].join(" "), confidence: 0.98, status: "EXACT", reviewStatus: "AUTO_ACCEPTABLE", evidence: ["EXPLICIT_SPECIFICATION_COLUMN"] };
  const components = (input.componentValues ?? []).map(text).filter(Boolean);
  if (components.length) return { value: [...new Set(components)].join(" "), confidence: components.length > 1 ? 0.86 : 0.74, status: components.length > 1 ? "HIGH_CONFIDENCE" : "SUGGESTED", reviewStatus: "NEEDS_REVIEW", evidence: ["DETERMINISTIC_COMPONENT_COMBINATION"] };
  const fallback = [input.materialName, input.description].map(text).filter(Boolean).join(" ");
  const dimensions = fallback.match(new RegExp(DIMENSION_TOKEN.source, "gi")) ?? [];
  const technical = fallback.match(new RegExp(TECH_TOKEN.source, "gi")) ?? [];
  const tokens = [...new Set([...dimensions, ...technical].map((token) => token.trim()))];
  if (!tokens.length) return { value: null, confidence: 0, status: "UNMAPPED", reviewStatus: "NEEDS_REVIEW", evidence: ["NO_SPECIFICATION_EVIDENCE"] };
  return { value: tokens.join(" "), confidence: Math.min(0.68, 0.48 + tokens.length * 0.05), status: "SUGGESTED", reviewStatus: "NEEDS_REVIEW", evidence: ["DETERMINISTIC_NAME_OR_DESCRIPTION_EXTRACTION", "MANUAL_CONFIRMATION_REQUIRED"] };
}

export function buildCanonicalImportRow(input: Readonly<{
  sourceFileId: number;
  sheetName: string;
  row: AdaptiveImportRow;
  mappings: readonly AdaptiveFieldMapping[];
  supplierId?: string | null;
  supplierProfileId?: number | null;
  now?: string;
}>): CanonicalImportRow {
  const cells = values(input.row);
  const mapped: Record<string, string | null> = {};
  const mappingByField = new Map(input.mappings.map((mapping) => [mapping.field, mapping]));
  const resolve = (field: CanonicalField): string | null => {
    const mapping = mappingByField.get(field);
    if (!mapping || ["UNMAPPED", "CONFLICT"].includes(mapping.status)) return null;
    const source = mapping.sourceColumnIndexes.map((index) => cells.get(index) ?? "").filter(Boolean);
    if (!source.length) return null;
    return mapping.combinationStrategy === "FIRST_NON_EMPTY" ? source[0] : [...new Set(source)].join(mapping.separator);
  };
  for (const field of Object.keys(MATERIAL_IMPORT_FIELD_ALIASES) as CanonicalField[]) mapped[field] = resolve(field);
  const specMapping = mappingByField.get("specification");
  const specification = extractSpecificationCandidate({
    explicitValues: specMapping?.status === "EXACT" ? specMapping.sourceColumnIndexes.map((index) => cells.get(index) ?? "") : [],
    componentValues: specMapping && specMapping.status !== "EXACT" ? specMapping.sourceColumnIndexes.map((index) => cells.get(index) ?? "") : [],
    materialName: mapped.material_name,
    description: mapped.description,
  });
  mapped.specification = specification.value;
  const statuses = input.mappings.map((mapping) => mapping.status);
  const mappingStatus: AdaptiveMappingStatus = statuses.includes("CONFLICT") ? "CONFLICT"
    : statuses.includes("UNMAPPED") ? "UNMAPPED"
      : statuses.includes("SUGGESTED") ? "SUGGESTED"
        : statuses.includes("HIGH_CONFIDENCE") ? "HIGH_CONFIDENCE" : "EXACT";
  const confidence = input.mappings.length ? input.mappings.reduce((sum, mapping) => sum + mapping.confidence, 0) / input.mappings.length : 0;
  const now = input.now ?? new Date().toISOString();
  return {
    source_file_id: input.sourceFileId,
    source_sheet_name: input.sheetName,
    source_row_number: input.row.rowNumber,
    supplier_id: input.supplierId ?? null,
    supplier_profile_id: input.supplierProfileId ?? null,
    raw_values_json: input.row.raw,
    raw_material_code: mapped.material_code,
    raw_material_name: mapped.material_name,
    raw_specification: mapped.specification,
    raw_model: mapped.model,
    raw_brand: mapped.brand,
    raw_unit: mapped.unit,
    raw_category: mapped.category,
    raw_description: mapped.description,
    raw_manufacturer_part_no: mapped.manufacturer_part_no,
    raw_supplier_part_no: mapped.supplier_part_no,
    mapped_values_json: Object.freeze(mapped),
    mapping_confidence: confidence,
    specification_confidence: specification.confidence,
    mapping_status: mappingStatus,
    review_status: mappingStatus === "EXACT" && specification.reviewStatus === "AUTO_ACCEPTABLE" ? "AUTO_ACCEPTABLE" : "NEEDS_REVIEW",
    specification_evidence: specification.evidence,
    created_at: now,
    updated_at: now,
  };
}
