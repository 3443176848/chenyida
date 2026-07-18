import { configure, type Entry, type FileEntry, ZipReader } from "@zip.js/zip.js";
import { SAXParser, SaxEventType, type AttributeDetail, type TagDetail, type TextDetail } from "sax-wasm";

import {
  columnIndex,
  columnReference,
  MATERIAL_IMPORT_PARSER_LIMITS,
  MaterialImportParserError,
  normalizeRawRow,
  type MaterialImportParsedRow,
  type MaterialImportParserWarning,
  type MaterialImportRawCell,
} from "./parser-model.ts";

configure({ useWebWorkers: false });

export type MaterialImportSheetVisibility = "VISIBLE" | "HIDDEN" | "VERY_HIDDEN";
export type MaterialImportXlsxSheet = Readonly<{
  sheetIndex: number;
  sheetName: string;
  visibility: MaterialImportSheetVisibility;
  status: "COMPLETED" | "SKIPPED_HIDDEN" | "SKIPPED_VERY_HIDDEN";
  rowCount: number;
  sourceColumnMax: number;
  mergedRanges: readonly string[];
  warnings: readonly MaterialImportParserWarning[];
}>;

export interface MaterialImportSharedStringStore {
  appendChunk(startStringIndex: number, values: readonly string[], decodedBytes: number): Promise<void>;
  get(index: number): Promise<string | null>;
}

export class MemoryMaterialImportSharedStringStore implements MaterialImportSharedStringStore {
  readonly #chunks: Array<Readonly<{ start: number; values: readonly string[] }>> = [];
  async appendChunk(start: number, values: readonly string[]): Promise<void> { this.#chunks.push({ start, values: [...values] }); }
  async get(index: number): Promise<string | null> {
    const chunk = this.#chunks.find((candidate) => index >= candidate.start && index < candidate.start + candidate.values.length);
    return chunk?.values[index - chunk.start] ?? null;
  }
}

export type MaterialImportXlsxResult = Readonly<{
  dateSystem: "1900" | "1904";
  workbookSheetCount: number;
  visibleSheetCount: number;
  hiddenSheetCount: number;
  veryHiddenSheetCount: number;
  parsedSheetCount: number;
  skippedSheetCount: number;
  parsedRowCount: number;
  normalizedJsonBytes: number;
  decodedTextBytes: number;
  nonEmptyCells: number;
  sheets: readonly MaterialImportXlsxSheet[];
  warnings: readonly MaterialImportParserWarning[];
}>;

function attribute(tag: TagDetail, name: string): string | null {
  const result = tag.attributes.find((candidate: AttributeDetail) => candidate.name.value === name || candidate.name.value.endsWith(`:${name}`));
  return result?.value.value ?? null;
}

function localName(name: string): string { return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name; }

async function parseXmlEntry(
  entry: FileEntry,
  wasm: WebAssembly.Module | Uint8Array,
  handler: (event: number, detail: TagDetail | TextDetail) => void,
): Promise<number> {
  if (entry.uncompressedSize > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalDecodedTextBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "OOXML XML 条目超过限制");
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 100) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "OOXML ZIP 压缩比超过限制");
  let depth = 0;
  let decodedBytes = 0;
  let unsafeDoctype = false;
  const parser = new SAXParser(SaxEventType.OpenTag | SaxEventType.CloseTag | SaxEventType.Text | SaxEventType.Cdata | SaxEventType.Doctype);
  parser.eventHandler = (event, detail) => {
    if (event === SaxEventType.Doctype) { unsafeDoctype = true; return; }
    if (event === SaxEventType.OpenTag) {
      depth += 1;
      const tag = detail as TagDetail;
      if (depth > 128 || tag.attributes.length > 64) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "OOXML XML 结构超过安全限制");
    } else if (event === SaxEventType.CloseTag) depth -= 1;
    else if ((detail as TextDetail).value.length > MATERIAL_IMPORT_PARSER_LIMITS.maxSingleSharedStringBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "OOXML 文本节点超过限制");
    handler(event, detail as TagDetail | TextDetail);
  };
  if (!(await parser.prepareWasm(wasm))) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "XML 解析器初始化失败");
  try {
    await entry.getData(new WritableStream<Uint8Array>({
      write(chunk) {
        decodedBytes += chunk.byteLength;
        if (decodedBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalDecodedTextBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "OOXML 解码文本超过限制");
        parser.write(chunk);
      },
      close() { parser.end(); },
      abort() { parser.end(); },
    }));
  } catch (error) {
    if (error instanceof MaterialImportParserError) throw error;
    throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "OOXML XML 损坏或不受支持");
  }
  if (unsafeDoctype) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "OOXML 禁止 DOCTYPE 或外部实体");
  if (depth !== 0) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "OOXML XML 标签未正确闭合");
  return decodedBytes;
}

function fileEntry(entries: ReadonlyMap<string, Entry>, name: string): FileEntry {
  const entry = entries.get(name);
  if (!entry || entry.directory) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "XLSX 缺少必要 OOXML 部件");
  if (entry.encrypted) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "不支持加密工作簿");
  return entry as FileEntry;
}

function normalizedTarget(target: string): string {
  const value = target.replaceAll("\\", "/").replace(/^\//, "");
  const segments = value.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "OOXML Relationship 路径无效");
  return value.startsWith("xl/") ? value : `xl/${value}`;
}

function visibility(value: string | null): MaterialImportSheetVisibility {
  if (value === "hidden") return "HIDDEN";
  if (value === "veryHidden") return "VERY_HIDDEN";
  return "VISIBLE";
}

function excelDate(serialText: string, system: "1900" | "1904"): string | null {
  const serial = Number(serialText);
  if (!Number.isFinite(serial)) return null;
  const adjusted = system === "1900" && serial >= 60 ? serial - 1 : serial;
  const epoch = Date.UTC(system === "1900" ? 1899 : 1904, system === "1900" ? 11 : 0, system === "1900" ? 31 : 1);
  const date = new Date(epoch + adjusted * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/T00:00:00\.000Z$/, "");
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function looksLikeDateFormat(format: string): boolean { return /(^|[^\\])[ymdhis]/i.test(format.replace(/"[^"]*"/g, "")); }

export async function parseMaterialImportXlsx(
  stream: ReadableStream<Uint8Array>,
  wasm: WebAssembly.Module | Uint8Array,
  sharedStrings: MaterialImportSharedStringStore,
  onRow: (row: MaterialImportParsedRow) => Promise<void>,
  options: Readonly<{ signal?: AbortSignal; onProgress?: (rows: number) => Promise<void> }> = {},
): Promise<MaterialImportXlsxResult> {
  const reader = new ZipReader(stream, { useWebWorkers: false });
  const warnings: MaterialImportParserWarning[] = [];
  let decodedTextBytes = 0;
  try {
    const listed = await reader.getEntries();
    if (listed.length > 1_024) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLSX ZIP 条目数超过限制");
    const entries = new Map(listed.map((entry) => [entry.filename.replace(/^\//, ""), entry]));
    for (const entry of listed) {
      if (entry.filename.includes("\\") || entry.filename.split("/").includes("..")) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "XLSX ZIP 条目路径无效");
      if (entry.encrypted) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "不支持加密工作簿");
    }

    const relationships = new Map<string, string>();
    decodedTextBytes += await parseXmlEntry(fileEntry(entries, "xl/_rels/workbook.xml.rels"), wasm, (event, detail) => {
      if (event !== SaxEventType.OpenTag || localName((detail as TagDetail).name) !== "Relationship") return;
      const tag = detail as TagDetail;
      if (attribute(tag, "TargetMode") === "External") throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "OOXML 禁止外部 Relationship");
      const id = attribute(tag, "Id");
      const target = attribute(tag, "Target");
      if (id && target) relationships.set(id, normalizedTarget(target));
    });

    const sheets: Array<{ index: number; name: string; visibility: MaterialImportSheetVisibility; path: string }> = [];
    let dateSystem: "1900" | "1904" = "1900";
    decodedTextBytes += await parseXmlEntry(fileEntry(entries, "xl/workbook.xml"), wasm, (event, detail) => {
      if (event !== SaxEventType.OpenTag) return;
      const tag = detail as TagDetail;
      const name = localName(tag.name);
      if (name === "workbookPr" && attribute(tag, "date1904") === "1") dateSystem = "1904";
      if (name !== "sheet") return;
      const relationshipId = attribute(tag, "id");
      const target = relationshipId ? relationships.get(relationshipId) : null;
      const sheetName = attribute(tag, "name");
      if (!target || !sheetName) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "Workbook Sheet Relationship 无效");
      sheets.push({ index: sheets.length, name: sheetName.slice(0, 255), visibility: visibility(attribute(tag, "state")), path: target });
    });
    if (sheets.length > MATERIAL_IMPORT_PARSER_LIMITS.maxSheets) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "Workbook Sheet 数量超过限制");

    let sharedCount = 0;
    let sharedBytes = 0;
    const sharedEntry = entries.get("xl/sharedStrings.xml");
    if (sharedEntry && !sharedEntry.directory) {
      let inItem = false;
      let inText = false;
      let item = "";
      let chunk: string[] = [];
      let chunkStart = 0;
      const flush = async () => {
        if (!chunk.length) return;
        const values = chunk;
        chunk = [];
        await sharedStrings.appendChunk(chunkStart, values, values.reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0));
        chunkStart += values.length;
      };
      const pendingFlushes: Promise<void>[] = [];
      decodedTextBytes += await parseXmlEntry(sharedEntry as FileEntry, wasm, (event, detail) => {
        if (event === SaxEventType.OpenTag) {
          const name = localName((detail as TagDetail).name);
          if (name === "si") { inItem = true; item = ""; }
          if (inItem && name === "t") inText = true;
        } else if ((event === SaxEventType.Text || event === SaxEventType.Cdata) && inText) item += (detail as TextDetail).value;
        else if (event === SaxEventType.CloseTag) {
          const name = localName((detail as TagDetail).name);
          if (name === "t") inText = false;
          if (name === "si") {
            inItem = false;
            const bytes = new TextEncoder().encode(item).byteLength;
            if (bytes > MATERIAL_IMPORT_PARSER_LIMITS.maxSingleSharedStringBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "Shared String 单项超过限制");
            sharedCount += 1;
            sharedBytes += bytes;
            if (sharedCount > MATERIAL_IMPORT_PARSER_LIMITS.maxSharedStrings || sharedBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalSharedStringBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "Shared Strings 超过限制");
            chunk.push(item);
            if (chunk.length === 512) pendingFlushes.push(flush());
          }
        }
      });
      pendingFlushes.push(flush());
      await Promise.all(pendingFlushes);
    }

    const customFormats = new Map<number, string>();
    const styleFormats: number[] = [];
    const stylesEntry = entries.get("xl/styles.xml");
    if (stylesEntry && !stylesEntry.directory) {
      let inCellXfs = false;
      decodedTextBytes += await parseXmlEntry(stylesEntry as FileEntry, wasm, (event, detail) => {
        if (event === SaxEventType.OpenTag) {
          const tag = detail as TagDetail;
          const name = localName(tag.name);
          if (name === "numFmt") {
            const id = Number(attribute(tag, "numFmtId"));
            const code = attribute(tag, "formatCode");
            if (Number.isInteger(id) && code) customFormats.set(id, code.slice(0, 1_024));
          } else if (name === "cellXfs") inCellXfs = true;
          else if (name === "xf" && inCellXfs) styleFormats.push(Number(attribute(tag, "numFmtId") ?? 0));
        } else if (event === SaxEventType.CloseTag && localName((detail as TagDetail).name) === "cellXfs") inCellXfs = false;
      });
    }

    let parsedRowCount = 0;
    let normalizedJsonBytes = 0;
    let nonEmptyCells = 0;
    const sheetResults: MaterialImportXlsxSheet[] = [];
    for (const sheet of sheets) {
      if (sheet.visibility !== "VISIBLE") {
        const code = sheet.visibility === "HIDDEN" ? "XLSX_HIDDEN_SHEET_SKIPPED" : "XLSX_VERY_HIDDEN_SHEET_SKIPPED";
        const warning = { code, message: "隐藏 Sheet 仅保留安全元数据，不解析业务行", sheetIndex: sheet.index };
        warnings.push(warning);
        sheetResults.push({ sheetIndex: sheet.index, sheetName: sheet.name, visibility: sheet.visibility, status: sheet.visibility === "HIDDEN" ? "SKIPPED_HIDDEN" : "SKIPPED_VERY_HIDDEN", rowCount: 0, sourceColumnMax: 0, mergedRanges: [], warnings: [warning] });
        continue;
      }
      if (options.signal?.aborted) throw new MaterialImportParserError("IMPORT_PARSE_CANCELLED", "解析任务已取消");
      let rowNumber = 0;
      let sheetRowCount = 0;
      let sourceColumnMax = 0;
      let currentCells: MaterialImportRawCell[] = [];
      type CellState = { ref: string; type: string; style: number; value: string; formula: string; inline: string; inValue: boolean; inFormula: boolean; inInline: boolean };
      let currentCell: CellState | null = null;
      const mergedRanges: string[] = [];
      const sheetWarnings: MaterialImportParserWarning[] = [];
      let pendingCells: Promise<void>[] = [];
      let rowChain = Promise.resolve();
      const finishCell = async (state: CellState, target: MaterialImportRawCell[]) => {
        const index = columnIndex(state.ref);
        if (index >= MATERIAL_IMPORT_PARSER_LIMITS.maxColumns) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLSX 列数超过限制");
        sourceColumnMax = Math.max(sourceColumnMax, index + 1);
        const raw = state.type === "inlineStr" ? state.inline : state.value;
        let cell: MaterialImportRawCell;
        if (state.formula) {
          if (state.formula.length > MATERIAL_IMPORT_PARSER_LIMITS.maxFormulaCharacters) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "公式文本超过限制");
          cell = { column_index: index, column_ref: columnReference(index), type: "FORMULA", source_type: state.type || "NUMBER", raw_value: raw || null, display: raw || null, format_code: null, formula: state.formula, cached_value: raw || null, cached_type: state.type || "NUMBER" };
        } else if (state.type === "s") {
          const value = await sharedStrings.get(Number(raw));
          if (value === null) throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "Shared String 索引无效");
          cell = { column_index: index, column_ref: columnReference(index), type: "TEXT", source_type: "SHARED_STRING", raw_value: value, display: value, format_code: null };
        } else if (state.type === "inlineStr" || state.type === "str") cell = { column_index: index, column_ref: columnReference(index), type: "TEXT", source_type: "TEXT", raw_value: raw, display: raw, format_code: null };
        else if (state.type === "b") cell = { column_index: index, column_ref: columnReference(index), type: "BOOLEAN", source_type: "BOOLEAN", raw_value: raw, display: raw === "1" ? "TRUE" : "FALSE", format_code: null };
        else if (state.type === "e") cell = { column_index: index, column_ref: columnReference(index), type: "ERROR", source_type: "ERROR", raw_value: raw, display: raw, format_code: null };
        else if (!raw) cell = { column_index: index, column_ref: columnReference(index), type: "EMPTY", source_type: state.type || "NUMBER", raw_value: null, display: null, format_code: null };
        else {
          const formatId = styleFormats[state.style] ?? 0;
          const format = customFormats.get(formatId) ?? null;
          const isDate = BUILTIN_DATE_FORMATS.has(formatId) || (format ? looksLikeDateFormat(format) : false);
          if (isDate) {
            const iso = excelDate(raw, dateSystem);
            cell = { column_index: index, column_ref: columnReference(index), type: "DATE", source_type: "NUMBER", raw_value: raw, display: iso ?? raw, format_code: format, date_system: dateSystem, interpreted_iso_value: iso, interpretation_status: iso ? "INTERPRETED" : "FAILED" };
            if (!iso && sheetWarnings.length < MATERIAL_IMPORT_PARSER_LIMITS.maxWarningDetails) sheetWarnings.push({ code: "XLSX_DATE_INTERPRETATION_FAILED", message: "日期候选无法解释，已保留原值", sheetIndex: sheet.index, rowNumber });
          } else cell = { column_index: index, column_ref: columnReference(index), type: "NUMBER", source_type: "NUMBER", raw_value: raw, display: raw, format_code: format };
        }
        if ((cell.raw_value?.length ?? 0) > MATERIAL_IMPORT_PARSER_LIMITS.maxCellCharacters) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLSX 单元格文本超过限制");
        if (cell.type !== "EMPTY") nonEmptyCells += 1;
        target.push(cell);
      };
      decodedTextBytes += await parseXmlEntry(fileEntry(entries, sheet.path), wasm, (event, detail) => {
        if (event === SaxEventType.OpenTag) {
          const tag = detail as TagDetail;
          const name = localName(tag.name);
          if (name === "row") rowNumber = Number(attribute(tag, "r") ?? rowNumber + 1);
          else if (name === "c") currentCell = { ref: attribute(tag, "r") ?? `${columnReference(currentCells.length)}${rowNumber || 1}`, type: attribute(tag, "t") ?? "n", style: Number(attribute(tag, "s") ?? 0), value: "", formula: "", inline: "", inValue: false, inFormula: false, inInline: false };
          else if (currentCell && name === "v") currentCell.inValue = true;
          else if (currentCell && name === "f") currentCell.inFormula = true;
          else if (currentCell && name === "t") currentCell.inInline = true;
          else if (name === "mergeCell") { const ref = attribute(tag, "ref"); if (ref && mergedRanges.length < 1_000) mergedRanges.push(ref); }
        } else if ((event === SaxEventType.Text || event === SaxEventType.Cdata) && currentCell) {
          const text = (detail as TextDetail).value;
          if (currentCell.inFormula) currentCell.formula += text;
          else if (currentCell.inValue) currentCell.value += text;
          else if (currentCell.inInline) currentCell.inline += text;
        } else if (event === SaxEventType.CloseTag) {
          const name = localName((detail as TagDetail).name);
          if (currentCell && name === "v") currentCell.inValue = false;
          else if (currentCell && name === "f") currentCell.inFormula = false;
          else if (currentCell && name === "t") currentCell.inInline = false;
          else if (name === "c" && currentCell) {
            const state = currentCell;
            currentCell = null;
            const write = finishCell(state, currentCells);
            void write.catch(() => undefined);
            pendingCells.push(write);
          }
          else if (name === "row") {
            const cells = currentCells;
            currentCells = [];
            const cellWrites = pendingCells;
            pendingCells = [];
            const currentRow = rowNumber;
            rowChain = rowChain.then(async () => {
              await Promise.all(cellWrites);
              parsedRowCount += 1;
              sheetRowCount += 1;
              if (parsedRowCount > MATERIAL_IMPORT_PARSER_LIMITS.maxRows || nonEmptyCells > MATERIAL_IMPORT_PARSER_LIMITS.maxNonEmptyCells) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLSX 数据量超过限制");
              const width = cells.length ? Math.max(...cells.map((cell) => cell.column_index)) + 1 : 0;
              const normalized = await normalizeRawRow(width, cells);
              normalizedJsonBytes += new TextEncoder().encode(normalized.json).byteLength;
              if (normalizedJsonBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalNormalizedJsonBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "规范化数据总量超过限制");
              await onRow({ sheetIndex: sheet.index, sheetName: sheet.name, rowNumber: currentRow, raw: normalized.raw, rawJson: normalized.json, rawRowHash: normalized.hash });
              if (parsedRowCount % MATERIAL_IMPORT_PARSER_LIMITS.progressRows === 0) await options.onProgress?.(parsedRowCount);
            });
            void rowChain.catch(() => undefined);
          }
        }
      });
      await rowChain;
      sheetResults.push({ sheetIndex: sheet.index, sheetName: sheet.name, visibility: "VISIBLE", status: "COMPLETED", rowCount: sheetRowCount, sourceColumnMax, mergedRanges, warnings: sheetWarnings });
      warnings.push(...sheetWarnings);
    }
    if (decodedTextBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalDecodedTextBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "OOXML 解码文本超过限制");
    return {
      dateSystem,
      workbookSheetCount: sheets.length,
      visibleSheetCount: sheets.filter((sheet) => sheet.visibility === "VISIBLE").length,
      hiddenSheetCount: sheets.filter((sheet) => sheet.visibility === "HIDDEN").length,
      veryHiddenSheetCount: sheets.filter((sheet) => sheet.visibility === "VERY_HIDDEN").length,
      parsedSheetCount: sheetResults.filter((sheet) => sheet.status === "COMPLETED").length,
      skippedSheetCount: sheetResults.filter((sheet) => sheet.status !== "COMPLETED").length,
      parsedRowCount,
      normalizedJsonBytes,
      decodedTextBytes,
      nonEmptyCells,
      sheets: sheetResults,
      warnings: warnings.slice(0, MATERIAL_IMPORT_PARSER_LIMITS.maxWarningDetails),
    };
  } finally {
    await reader.close().catch(() => undefined);
  }
}
