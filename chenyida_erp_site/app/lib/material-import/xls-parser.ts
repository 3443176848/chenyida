import {
  columnReference,
  MATERIAL_IMPORT_PARSER_LIMITS,
  MaterialImportParserError,
  normalizeRawRow,
  type MaterialImportParsedRow,
  type MaterialImportParserWarning,
  type MaterialImportRawCell,
} from "./parser-model.ts";

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const MAX_SECTORS = 25_000;

type DirectoryEntry = Readonly<{ name: string; type: number; start: number; size: number }>;
type CfbWorkbook = Readonly<{ stream: Uint8Array; entries: readonly DirectoryEntry[] }>;

function hasSignature(bytes: Uint8Array): boolean { return CFB_SIGNATURE.every((value, index) => bytes[index] === value); }
function u16(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true); }
function u32(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true); }
function f64(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(offset, true); }

function fail(message: string): never { throw new MaterialImportParserError("IMPORT_PARSE_INVALID_XLS", message); }
function checkRange(bytes: Uint8Array, offset: number, length: number): void { if (offset < 0 || length < 0 || offset + length > bytes.length) fail("XLS 二进制结构超出文件范围"); }

function sector(bytes: Uint8Array, index: number, size: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > MAX_SECTORS) fail("XLS 扇区索引无效");
  const offset = 512 + index * size;
  checkRange(bytes, offset, size);
  return bytes.subarray(offset, offset + size);
}

function chain(start: number, fat: readonly number[], limit: number): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  let current = start >>> 0;
  while (current !== ENDOFCHAIN && current !== FREESECT) {
    if (current >= fat.length || seen.has(current) || result.length >= limit) fail("XLS 扇区链无效");
    seen.add(current); result.push(current); current = fat[current] >>> 0;
  }
  return result;
}

function streamFromSectors(bytes: Uint8Array, ids: readonly number[], size: number): Uint8Array {
  const output = new Uint8Array(Math.min(size, ids.length * 512));
  let offset = 0;
  for (const id of ids) {
    const part = sector(bytes, id, 512);
    const take = Math.min(part.length, output.length - offset);
    if (take > 0) output.set(part.subarray(0, take), offset);
    offset += take;
    if (offset >= output.length) break;
  }
  return output;
}

function decodeUtf16(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-16le", { fatal: true }).decode(bytes); } catch { return ""; }
}

function decodeCompressed(bytes: Uint8Array, encoding: "gb18030" | "windows-1252"): string {
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { let output = ""; for (const value of bytes) output += String.fromCharCode(value); return output; }
}

function directoryName(entry: Uint8Array): string {
  const length = u16(entry, 64);
  if (length < 2 || length > 64 || length % 2 !== 0) return "";
  return decodeUtf16(entry.subarray(0, length - 2));
}

function readCfb(bytes: Uint8Array): CfbWorkbook {
  if (!hasSignature(bytes)) fail("XLS 不是有效的 OLE 工作簿");
  checkRange(bytes, 0, 512);
  const sectorShift = u16(bytes, 30);
  const miniSectorShift = u16(bytes, 32);
  if (sectorShift !== 9 || miniSectorShift !== 6) fail("XLS 扇区大小不受支持");
  const sectorSize = 1 << sectorShift;
  const fatSectorCount = u32(bytes, 44);
  const firstDirectorySector = u32(bytes, 48);
  const miniStreamCutoff = u32(bytes, 56);
  const firstMiniFatSector = u32(bytes, 60);
  const firstDifatSector = u32(bytes, 68);
  const difatSectorCount = u32(bytes, 72);
  if (fatSectorCount === 0 || fatSectorCount > MAX_SECTORS || miniStreamCutoff < 4096 || difatSectorCount > MAX_SECTORS) fail("XLS OLE 头无效");

  const fatSectors: number[] = [];
  for (let index = 0; index < 109 && fatSectors.length < fatSectorCount; index += 1) {
    const id = u32(bytes, 76 + index * 4);
    if (id !== FREESECT) fatSectors.push(id);
  }
  let difat = firstDifatSector;
  for (let index = 0; index < difatSectorCount && fatSectors.length < fatSectorCount; index += 1) {
    const part = sector(bytes, difat, sectorSize);
    for (let at = 0; at < sectorSize - 4 && fatSectors.length < fatSectorCount; at += 4) {
      const id = u32(part, at); if (id !== FREESECT) fatSectors.push(id);
    }
    difat = u32(part, sectorSize - 4);
  }
  if (fatSectors.length !== fatSectorCount) fail("XLS FAT 目录不完整");
  const fat: number[] = [];
  for (const id of fatSectors) { const part = sector(bytes, id, sectorSize); for (let at = 0; at < part.length; at += 4) fat.push(u32(part, at)); }
  const directoryIds = chain(firstDirectorySector, fat, MAX_SECTORS);
  const directoryBytes = new Uint8Array(directoryIds.length * sectorSize);
  directoryIds.forEach((id, index) => directoryBytes.set(sector(bytes, id, sectorSize), index * sectorSize));
  const entries: DirectoryEntry[] = [];
  for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
    const type = directoryBytes[offset + 66];
    if (type === 0) continue;
    entries.push({ name: directoryName(directoryBytes.subarray(offset, offset + 128)), type, start: u32(directoryBytes, offset + 116), size: u32(directoryBytes, offset + 120) });
  }
  const root = entries.find((entry) => entry.type === 5);
  const workbook = entries.find((entry) => entry.type === 2 && /^(workbook|book)$/i.test(entry.name));
  if (!root || !workbook) fail("XLS 缺少 Workbook 流");
  let workbookStream: Uint8Array;
  if (workbook.size < miniStreamCutoff) {
    const rootBytes = streamFromSectors(bytes, chain(root.start, fat, MAX_SECTORS), root.size);
    const miniFatIds = chain(firstMiniFatSector, fat, MAX_SECTORS);
    const miniFat: number[] = [];
    for (const id of miniFatIds) { const part = sector(bytes, id, sectorSize); for (let at = 0; at < part.length; at += 4) miniFat.push(u32(part, at)); }
    const miniIds = chain(workbook.start, miniFat, MAX_SECTORS);
    const output = new Uint8Array(Math.min(workbook.size, miniIds.length * 64));
    miniIds.forEach((id, index) => { if (index * 64 >= output.length) return; const offset = id * 64; checkRange(rootBytes, offset, 64); output.set(rootBytes.subarray(offset, offset + Math.min(64, output.length - index * 64)), index * 64); });
    workbookStream = output;
  } else workbookStream = streamFromSectors(bytes, chain(workbook.start, fat, MAX_SECTORS), workbook.size);
  return { stream: workbookStream, entries };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; if (!value?.byteLength) continue; size += value.byteLength; if (size > MATERIAL_IMPORT_PARSER_LIMITS.maxFileBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLS 文件超过 10 MiB 限制"); chunks.push(value.slice()); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}

export function validateMaterialImportXlsContainer(bytes: Uint8Array): void { readCfb(bytes); }

type BiffRecord = Readonly<{ id: number; payload: Uint8Array; offset: number }>;
function records(bytes: Uint8Array): BiffRecord[] {
  const result: BiffRecord[] = []; let offset = 0;
  while (offset + 4 <= bytes.length) { const id = u16(bytes, offset); const length = u16(bytes, offset + 2); const next = offset + 4 + length; if (next > bytes.length) fail("XLS BIFF 记录长度无效"); result.push({ id, payload: bytes.subarray(offset + 4, next), offset }); offset = next; if (result.length > 2_000_000) fail("XLS 记录数量超过限制"); if (id === 0x000a) break; }
  return result;
}

class SegmentReader {
  readonly #segments: readonly Uint8Array[]; readonly #encoding: "gb18030" | "windows-1252"; #segment = 0; #offset = 0;
  constructor(segments: readonly Uint8Array[], encoding: "gb18030" | "windows-1252" = "windows-1252") { this.#segments = segments; this.#encoding = encoding; }
  atBoundary(): boolean { return this.#segment >= this.#segments.length || this.#offset >= this.#segments[this.#segment].length; }
  readByte(): number { while (this.#segment < this.#segments.length && this.#offset >= this.#segments[this.#segment].length) { this.#segment += 1; this.#offset = 0; } if (this.#segment >= this.#segments.length) fail("XLS 字符串记录不完整"); return this.#segments[this.#segment][this.#offset++]; }
  readBytes(length: number): Uint8Array { const result = new Uint8Array(length); for (let index = 0; index < length; index += 1) result[index] = this.readByte(); return result; }
  readU16(): number { return this.readByte() | (this.readByte() << 8); }
  readStringCharacters(count: number, compressed: boolean): string {
    let remaining = count; let mode = compressed; let output = "";
    while (remaining > 0) {
      if (this.atBoundary()) mode = (this.readByte() & 1) === 0;
      const segment = this.#segments[this.#segment];
      const available = segment.length - this.#offset;
      const chars = Math.min(remaining, mode ? available : Math.floor(available / 2));
      if (chars <= 0) fail("XLS 字符串记录不完整");
      const bytes = this.readBytes(mode ? chars : chars * 2);
      output += mode ? decodeCompressed(bytes, this.#encoding) : decodeUtf16(bytes);
      remaining -= chars;
    }
    return output;
  }
}

function readBiffString(reader: SegmentReader): string {
  const count = reader.readU16(); const flags = reader.readByte(); const rich = (flags & 0x08) !== 0 ? reader.readU16() : 0; const extended = (flags & 0x04) !== 0 ? (() => { const a = reader.readByte(); const b = reader.readByte(); const c = reader.readByte(); const d = reader.readByte(); return (a | b << 8 | c << 16 | d << 24) >>> 0; })() : 0;
  if (count > MATERIAL_IMPORT_PARSER_LIMITS.maxCellCharacters) fail("XLS 单元格文本超过限制");
  const compressed = (flags & 1) === 0;
  const value = reader.readStringCharacters(count, compressed);
  if (rich) reader.readBytes(rich * 4); if (extended) reader.readBytes(extended); return value;
}

function parseSst(recordsList: readonly BiffRecord[], index: number, encoding: "gb18030" | "windows-1252"): string[] {
  const segments: Uint8Array[] = [recordsList[index].payload]; let next = index + 1;
  while (next < recordsList.length && recordsList[next].id === 0x003c) { segments.push(recordsList[next].payload); next += 1; }
  const reader = new SegmentReader(segments, encoding); const total = reader.readU16() | (reader.readU16() << 16); reader.readU16(); reader.readU16();
  const result: string[] = [];
  for (let item = 0; item < total && item < MATERIAL_IMPORT_PARSER_LIMITS.maxSharedStrings; item += 1) result.push(readBiffString(reader));
  return result;
}

function rkValue(value: number): number { if (value & 1) return (value >> 2) / (value & 2 ? 100 : 1); const bits = new Uint8Array(8); new DataView(bits.buffer).setUint32(0, value & 0xfffffffc, true); return f64(bits, 0); }
function cellText(value: string, column: number, sourceType = "TEXT"): MaterialImportRawCell { return { column_index: column, column_ref: columnReference(column), type: "TEXT", source_type: sourceType, raw_value: value, display: value, format_code: null, formula_injection_risk: /^[=+\-@]/.test(value) }; }
function cellNumber(value: number, column: number, sourceType = "NUMBER"): MaterialImportRawCell { const text = Number.isFinite(value) ? String(value) : null; return { column_index: column, column_ref: columnReference(column), type: "NUMBER", source_type: sourceType, raw_value: text, display: text, format_code: null }; }

export type MaterialImportXlsSheet = Readonly<{ sheetIndex: number; sheetName: string; visibility: "VISIBLE" | "HIDDEN" | "VERY_HIDDEN"; status: "COMPLETED" | "SKIPPED_HIDDEN" | "SKIPPED_VERY_HIDDEN"; rowCount: number; sourceColumnMax: number; mergedRanges: readonly string[]; warnings: readonly MaterialImportParserWarning[] }>;
export type MaterialImportXlsResult = Readonly<{ dateSystem: "1900"; workbookSheetCount: number; visibleSheetCount: number; hiddenSheetCount: number; veryHiddenSheetCount: number; parsedSheetCount: number; skippedSheetCount: number; parsedRowCount: number; normalizedJsonBytes: number; decodedTextBytes: number; nonEmptyCells: number; sheets: readonly MaterialImportXlsSheet[]; warnings: readonly MaterialImportParserWarning[] }>;

export async function parseMaterialImportXls(stream: ReadableStream<Uint8Array>, onRow: (row: MaterialImportParsedRow) => Promise<void>, options: Readonly<{ signal?: AbortSignal; onProgress?: (rows: number) => Promise<void> }> = {}): Promise<MaterialImportXlsResult> {
  const bytes = await readAll(stream); const cfb = readCfb(bytes); const all = records(cfb.stream); const bounds: Array<{ offset: number; name: string; visibility: "VISIBLE" | "HIDDEN" | "VERY_HIDDEN" }> = [];
  let sst: string[] = []; let compressedEncoding: "gb18030" | "windows-1252" = "windows-1252";
  all.forEach((record, index) => { if (record.id === 0x002f) fail("XLS 加密或密码保护工作簿不受支持"); if (record.id === 0x0042 && record.payload.length >= 2) compressedEncoding = u16(record.payload, 0) === 0x3a8 ? "gb18030" : "windows-1252"; if (record.id === 0x0085 && record.payload.length >= 8) { const visibility = record.payload[4] === 1 ? "HIDDEN" : record.payload[4] === 2 ? "VERY_HIDDEN" : "VISIBLE"; const count = record.payload[6]; const unicode = (record.payload[7] & 1) !== 0; const chars = record.payload.subarray(8, 8 + (unicode ? count * 2 : count)); bounds.push({ offset: u32(record.payload, 0), visibility, name: unicode ? decodeUtf16(chars) : decodeCompressed(chars, compressedEncoding) }); } if (record.id === 0x00fc) sst = parseSst(all, index, compressedEncoding); });
  if (!bounds.length) fail("XLS 没有可识别的工作表");
  const sheets: MaterialImportXlsSheet[] = []; const warnings: MaterialImportParserWarning[] = []; let parsedRows = 0; let normalizedBytes = 0; let nonEmptyCells = 0;
  for (let sheetIndex = 0; sheetIndex < bounds.length; sheetIndex += 1) {
    const sheet = bounds[sheetIndex]; const base = records(cfb.stream.subarray(sheet.offset));
    if (sheet.visibility !== "VISIBLE") { const warning = { code: sheet.visibility === "HIDDEN" ? "XLS_HIDDEN_SHEET_SKIPPED" : "XLS_VERY_HIDDEN_SHEET_SKIPPED", message: "隐藏 Sheet 仅保留安全元数据，不解析业务行", sheetIndex }; warnings.push(warning); sheets.push({ sheetIndex, sheetName: sheet.name, visibility: sheet.visibility, status: sheet.visibility === "HIDDEN" ? "SKIPPED_HIDDEN" : "SKIPPED_VERY_HIDDEN", rowCount: 0, sourceColumnMax: 0, mergedRanges: [], warnings: [warning] }); continue; }
    const rows = new Map<number, Map<number, MaterialImportRawCell>>(); const merged: string[] = []; let sourceColumnMax = 0;
    const put = (row: number, column: number, cell: MaterialImportRawCell) => { if (column >= MATERIAL_IMPORT_PARSER_LIMITS.maxColumns) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLS 列数超过限制"); sourceColumnMax = Math.max(sourceColumnMax, column + 1); const target = rows.get(row) ?? new Map<number, MaterialImportRawCell>(); target.set(column, cell); rows.set(row, target); if (cell.type !== "EMPTY") nonEmptyCells += 1; };
    for (let index = 0; index < base.length; index += 1) { if (options.signal?.aborted) throw new MaterialImportParserError("IMPORT_PARSE_CANCELLED", "解析任务已取消"); const record = base[index]; const p = record.payload; if (record.id === 0x0208 && p.length >= 4) { rows.set(u16(p, 0), rows.get(u16(p, 0)) ?? new Map()); continue; } if (record.id === 0x00e5 && p.length >= 2) { const count = u16(p, 0); for (let at = 0; at < count && 2 + at * 8 + 8 <= p.length && merged.length < 1_000; at += 1) { const r1 = u16(p, 2 + at * 8) + 1; const r2 = u16(p, 4 + at * 8) + 1; const c1 = columnReference(u16(p, 6 + at * 8)); const c2 = columnReference(u16(p, 8 + at * 8)); merged.push(`${c1}${r1}:${c2}${r2}`); } continue; } if (p.length < 6) continue; let row = 0; let column = 0; if ([0x0203, 0x0204, 0x0205, 0x0206, 0x0207, 0x00fd, 0x027e, 0x00bd].includes(record.id)) { row = u16(p, 0); column = u16(p, 2); } else continue;
      if (record.id === 0x00fd && p.length >= 10) put(row, column, cellText(sst[u32(p, 6)] ?? "", column, "SHARED_STRING"));
      else if (record.id === 0x0204 && p.length >= 8) put(row, column, cellText(readBiffString(new SegmentReader([p.subarray(6)], compressedEncoding)), column));
      else if (record.id === 0x0203 && p.length >= 14) put(row, column, cellNumber(f64(p, 6), column));
      else if (record.id === 0x027e && p.length >= 10) put(row, column, cellNumber(rkValue(u32(p, 6)), column, "RK"));
      else if (record.id === 0x00bd && p.length >= 12) { const lastColumn = u16(p, p.length - 2); const count = Math.floor((p.length - 6) / 6); for (let item = 0; item < count; item += 1) put(row, column + item, cellNumber(rkValue(u32(p, 6 + item * 6 + 2)), column + item, "RK")); if (lastColumn < column || lastColumn > column + count) fail("XLS MULRK 列范围无效"); }
      else if (record.id === 0x0205 && p.length >= 8) { const value = p[6] !== 0; put(row, column, { column_index: column, column_ref: columnReference(column), type: p[7] ? "ERROR" : "BOOLEAN", source_type: p[7] ? "ERROR" : "BOOLEAN", raw_value: p[7] ? String(p[6]) : (value ? "1" : "0"), display: p[7] ? String(p[6]) : (value ? "TRUE" : "FALSE"), format_code: null }); }
      else if (record.id === 0x0006 && p.length >= 14) put(row, column, { ...cellNumber(f64(p, 6), column, "FORMULA"), type: "FORMULA", formula: "[BIFF_FORMULA]", cached_value: String(f64(p, 6)), cached_type: "NUMBER" });
    }
    for (const [rowNumber, cells] of [...rows.entries()].sort(([left], [right]) => left - right)) { const values = [...cells.values()].sort((left, right) => left.column_index - right.column_index); parsedRows += 1; if (parsedRows > MATERIAL_IMPORT_PARSER_LIMITS.maxRows || nonEmptyCells > MATERIAL_IMPORT_PARSER_LIMITS.maxNonEmptyCells) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "XLS 数据量超过限制"); const width = values.length ? Math.max(...values.map((cell) => cell.column_index)) + 1 : 0; const normalized = await normalizeRawRow(width, values); normalizedBytes += new TextEncoder().encode(normalized.json).byteLength; if (normalizedBytes > MATERIAL_IMPORT_PARSER_LIMITS.maxTotalNormalizedJsonBytes) throw new MaterialImportParserError("IMPORT_PARSE_LIMIT_EXCEEDED", "规范化数据总量超过限制"); await onRow({ sheetIndex, sheetName: sheet.name, rowNumber: rowNumber + 1, raw: normalized.raw, rawJson: normalized.json, rawRowHash: normalized.hash }); if (parsedRows % MATERIAL_IMPORT_PARSER_LIMITS.progressRows === 0) await options.onProgress?.(parsedRows); }
    sheets.push({ sheetIndex, sheetName: sheet.name, visibility: "VISIBLE", status: "COMPLETED", rowCount: rows.size, sourceColumnMax, mergedRanges: merged, warnings: [] });
  }
  return { dateSystem: "1900", workbookSheetCount: bounds.length, visibleSheetCount: bounds.filter((sheet) => sheet.visibility === "VISIBLE").length, hiddenSheetCount: bounds.filter((sheet) => sheet.visibility === "HIDDEN").length, veryHiddenSheetCount: bounds.filter((sheet) => sheet.visibility === "VERY_HIDDEN").length, parsedSheetCount: sheets.filter((sheet) => sheet.status === "COMPLETED").length, skippedSheetCount: sheets.filter((sheet) => sheet.status !== "COMPLETED").length, parsedRowCount: parsedRows, normalizedJsonBytes: normalizedBytes, decodedTextBytes: bytes.length, nonEmptyCells, sheets, warnings: warnings.slice(0, MATERIAL_IMPORT_PARSER_LIMITS.maxWarningDetails) };
}
