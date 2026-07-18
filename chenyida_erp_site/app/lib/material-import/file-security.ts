import type { MaterialImportObjectStore } from "./object-store.ts";
import { validateMaterialImportXlsContainer } from "./xls-parser.ts";

const ZIP_MAX_ENTRIES = 2_048;
const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 1024 * 1024;
const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const ZIP_MAX_COMPRESSION_RATIO = 100;

export type MaterialImportDetectedType = "XLSX" | "CSV";

export class MaterialImportFileSecurityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectMaterialImportFileType(prefix: Uint8Array): MaterialImportDetectedType {
  if (startsWith(prefix, [0x50, 0x4b, 0x03, 0x04])) return "XLSX";
  if (startsWith(prefix, [0xd0, 0xcf, 0x11, 0xe0])) {
    // Keep the existing workbook category in the V1 schema; the .xls extension
    // selects the BIFF/OLE parser after the upload security check.
    return "XLSX";
  }
  const forbidden: Array<readonly number[]> = [
    [0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x25, 0x50, 0x44, 0x46],
    [0x1f, 0x8b], [0x52, 0x61, 0x72, 0x21], [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff],
  ];
  if (forbidden.some((signature) => startsWith(prefix, signature))) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "文件类型不受支持");
  }
  return "CSV";
}

async function readBounded(
  store: MaterialImportObjectStore,
  key: string,
  range: Readonly<{ offset?: number; length?: number; suffix?: number }>,
  maximum: number,
): Promise<Uint8Array> {
  const stream = await store.open(key, range);
  if (!stream) throw new MaterialImportFileSecurityError("IMPORT_FILE_STORAGE_FAILED", "已存储文件不可读取");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > maximum) throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "安全检查读取范围超限");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function validateDeclaredMetadata(
  type: MaterialImportDetectedType,
  filenameExtension: string,
  declaredMimeType: string,
): readonly string[] {
  const extension = filenameExtension.toLowerCase();
  if (extension === ".xlsm") {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "不支持 XLSM 宏工作簿");
  }
  if (extension === ".xls") {
    const allowedLegacyMimes = new Set(["", "application/octet-stream", "application/vnd.ms-excel"]);
    if (!allowedLegacyMimes.has(declaredMimeType)) throw new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "客户端 MIME 与 XLS 类型不一致");
    return ["XLS_LEGACY_BINARY"];
  }
  const neutral = new Set(["", "application/octet-stream"]);
  if (type === "XLSX" && extension === ".csv") {
    const mislabeledAllowed = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
      "text/plain",
    ]);
    if (!neutral.has(declaredMimeType) && !mislabeledAllowed.has(declaredMimeType)) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "客户端 MIME 与检测类型不一致");
    }
    return ["XLSX_CONTENT_WITH_CSV_EXTENSION"];
  }
  if ((type === "XLSX" && extension !== ".xlsx") || (type === "CSV" && extension !== ".csv")) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "文件扩展名与检测类型不一致");
  }
  const allowed = type === "XLSX"
    ? new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])
    : new Set(["text/csv", "application/csv", "text/plain"]);
  if (!neutral.has(declaredMimeType) && !allowed.has(declaredMimeType)) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_TYPE_UNSUPPORTED", "客户端 MIME 与检测类型不一致");
  }
  return [];
}

async function validateXlsx(store: MaterialImportObjectStore, key: string, size: number): Promise<void> {
  const tailLength = Math.min(size, 65_557);
  const tail = await readBounded(store, key, { suffix: tailLength }, tailLength);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (uint32(tailView, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX ZIP 目录无效");
  const disk = uint16(tailView, eocd + 4);
  const centralDisk = uint16(tailView, eocd + 6);
  const entriesOnDisk = uint16(tailView, eocd + 8);
  const entries = uint16(tailView, eocd + 10);
  const centralSize = uint32(tailView, eocd + 12);
  const centralOffset = uint32(tailView, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entries !== entriesOnDisk || entries === 0 || entries > ZIP_MAX_ENTRIES) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX ZIP 分卷或条目数量不受支持");
  }
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "不支持 ZIP64 工作簿");
  }
  if (centralSize <= 0 || centralSize > ZIP_MAX_CENTRAL_DIRECTORY_BYTES || centralOffset + centralSize > size) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX ZIP 目录范围无效");
  }
  const central = await readBounded(store, key, { offset: centralOffset, length: centralSize }, ZIP_MAX_CENTRAL_DIRECTORY_BYTES);
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names = new Set<string>();
  let totalUncompressed = 0;
  let offset = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > central.byteLength || uint32(view, offset) !== 0x02014b50) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX ZIP 条目目录损坏");
    }
    const flags = uint16(view, offset + 8);
    const method = uint16(view, offset + 10);
    const compressed = uint32(view, offset + 20);
    const uncompressed = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > central.byteLength || nameLength === 0) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX ZIP 条目长度无效");
    }
    if ((flags & 0x0001) !== 0) throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "不接受加密或密码保护工作簿");
    if (method !== 0 && method !== 8) throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX 使用了不支持的压缩方式");
    const name = decoder.decode(central.slice(offset + 46, offset + 46 + nameLength)).replaceAll("\\", "/");
    if (name.startsWith("/") || name.includes("../") || name.includes("\u0000")) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX 包含不安全路径");
    }
    const lower = name.toLowerCase();
    if (lower.endsWith("vbaproject.bin") || lower.includes("/macrosheets/") || lower.endsWith(".xlsm")) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "不接受含宏工作簿");
    }
    if (uncompressed > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX 单条目展开大小超限");
    }
    if (uncompressed > 0 && (compressed === 0 || uncompressed / compressed > ZIP_MAX_COMPRESSION_RATIO)) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX 压缩比超限");
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX 总展开大小超限");
    }
    names.add(name);
    offset = end;
  }
  if (offset !== central.byteLength) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX ZIP 目录包含额外结构");
  }
  for (const required of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]) {
    if (!names.has(required)) throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "XLSX 缺少必要工作簿结构");
  }
}

async function validateXls(store: MaterialImportObjectStore, key: string, size: number): Promise<void> {
  const bytes = await readBounded(store, key, { offset: 0, length: size }, Math.min(size, 10 * 1024 * 1024));
  try { validateMaterialImportXlsContainer(bytes); }
  catch (error) {
    if (error instanceof MaterialImportFileSecurityError) throw error;
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", error instanceof Error ? error.message : "XLS OLE 结构无效");
  }
}

async function validateCsvEncoding(
  store: MaterialImportObjectStore,
  key: string,
  encoding: "utf-8" | "gb18030",
): Promise<{ prefix: string; suffix: string }> {
  const stream = await store.open(key);
  if (!stream) throw new MaterialImportFileSecurityError("IMPORT_FILE_STORAGE_FAILED", "已存储文件不可读取");
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "运行环境不支持文件编码检查");
  }
  const reader = stream.getReader();
  let prefix = "";
  let suffix = "";
  let controls = 0;
  let characters = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (value.includes(0)) throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "CSV 包含 NUL 二进制特征");
      const text = decoder.decode(value, { stream: true });
      if (prefix.length < 8192) prefix += text.slice(0, 8192 - prefix.length);
      suffix = (suffix + text).slice(-8192);
      characters += text.length;
      for (const char of text) {
        const code = char.charCodeAt(0);
        if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) controls += 1;
      }
    }
    const final = decoder.decode();
    if (prefix.length < 8192) prefix += final.slice(0, 8192 - prefix.length);
    suffix = (suffix + final).slice(-8192);
    characters += final.length;
  } finally {
    reader.releaseLock();
  }
  if (characters > 0 && controls / characters > 0.01) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "CSV 包含明显二进制内容");
  }
  return { prefix, suffix };
}

async function validateCsv(store: MaterialImportObjectStore, key: string): Promise<void> {
  let decoded: { prefix: string; suffix: string };
  try {
    decoded = await validateCsvEncoding(store, key, "utf-8");
  } catch (error) {
    if (error instanceof MaterialImportFileSecurityError && error.message.includes("NUL")) throw error;
    try {
      decoded = await validateCsvEncoding(store, key, "gb18030");
    } catch {
      throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "CSV 文本编码无效，仅支持 UTF-8 或 GB18030");
    }
  }
  const beginning = decoded.prefix.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  const looksLikeHtmlDocument = beginning.startsWith("<!doctype html")
    || (/^<html(?:\s|>)/.test(beginning) && (beginning.includes("<head") || beginning.includes("<body") || decoded.suffix.toLowerCase().includes("</html>")));
  if (looksLikeHtmlDocument) {
    throw new MaterialImportFileSecurityError("IMPORT_FILE_SECURITY_CHECK_FAILED", "CSV 内容是 HTML 文档伪装");
  }
}

export async function runMaterialImportBasicSecurityCheck(input: Readonly<{
  store: MaterialImportObjectStore;
  objectKey: string;
  actualSizeBytes: number;
  detectedType: MaterialImportDetectedType;
  filenameExtension: string;
  declaredMimeType: string;
}>): Promise<Readonly<{ warningCodes: readonly string[] }>> {
  const warningCodes = validateDeclaredMetadata(input.detectedType, input.filenameExtension, input.declaredMimeType);
  if (input.filenameExtension.toLowerCase() === ".xls") await validateXls(input.store, input.objectKey, input.actualSizeBytes);
  else if (input.detectedType === "XLSX") await validateXlsx(input.store, input.objectKey, input.actualSizeBytes);
  else await validateCsv(input.store, input.objectKey);
  return { warningCodes };
}
