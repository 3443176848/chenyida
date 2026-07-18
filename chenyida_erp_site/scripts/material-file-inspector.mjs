import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Readable } from "node:stream";

import { parseMaterialImportCsv } from "../app/lib/material-import/csv-parser.ts";
import { detectMaterialImportFileType } from "../app/lib/material-import/file-security.ts";
import { MATERIAL_IMPORT_PARSER_LIMITS } from "../app/lib/material-import/parser-model.ts";
import {
  MemoryMaterialImportSharedStringStore,
  parseMaterialImportXlsx,
} from "../app/lib/material-import/xlsx-parser.ts";

const HEADER_SAMPLE_ROWS = 10;
const HEADER_CANDIDATE_LIMIT = 3;

const FIELD_ALIASES = Object.freeze({
  material_code: [
    "物料编码",
    "内部物料编码",
    "物料号",
    "物料代码",
    "materialcode",
    "materialid",
    "internalitemcode",
  ],
  standard_name: [
    "物料名称",
    "标准物料名称",
    "品名",
    "名称",
    "materialname",
    "standardname",
    "rawitemname",
  ],
  category: ["物料分类", "分类", "category", "categoryname", "itemcategory"],
  specification: [
    "规格",
    "规格描述",
    "spec",
    "specification",
    "rawspec",
    "valuespec",
  ],
  model: ["型号", "model", "modelnumber"],
  brand: ["品牌", "brand"],
  base_unit: [
    "单位",
    "计量单位",
    "基本单位",
    "unit",
    "uom",
    "baseunit",
    "baseuom",
    "purchaseuom",
  ],
  drawing_no: ["图号", "drawingno", "drawingnumber"],
  manufacturer_part_no: [
    "制造商料号",
    "制造商型号",
    "manufacturerpartno",
    "manufacturerpartnumber",
    "mpn",
    "rawmpn",
  ],
  supplier_part_no: [
    "供应商料号",
    "供应商物料编码",
    "supplierpartno",
    "supplierpartnumber",
    "supplieritemcode",
    "rawitemcode",
  ],
});

const ALIAS_TO_FIELD = new Map(
  Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), field]),
  ),
);

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]（）【】]+/g, "");
}

function cellText(cell) {
  if (!cell || cell.type === "EMPTY" || cell.type === "ERROR" || cell.type === "FORMULA") return "";
  return String(cell.raw_value ?? cell.display ?? "").trim();
}

function headerCandidate(row) {
  const cells = new Map(row.raw.cells.map((cell) => [cell.column_index, cell]));
  const values = Array.from({ length: row.raw.source_column_count }, (_, index) =>
    cellText(cells.get(index)),
  );
  const nonEmpty = values.filter(Boolean);
  const possibleFields = [];
  values.forEach((value, sourceColumnIndex) => {
    const standardField = ALIAS_TO_FIELD.get(normalizeHeader(value));
    if (standardField && !possibleFields.some((field) => field.standard_field === standardField)) {
      possibleFields.push({
        source_column_index: sourceColumnIndex,
        standard_field: standardField,
      });
    }
  });
  const textDensity = values.length ? nonEmpty.length / values.length : 0;
  const uniqueness = nonEmpty.length ? new Set(nonEmpty.map(normalizeHeader)).size / nonEmpty.length : 0;
  const recognition = values.length ? possibleFields.length / values.length : 0;
  const score = Number((textDensity * 0.4 + uniqueness * 0.2 + recognition * 0.4).toFixed(4));
  return {
    row_number: row.rowNumber,
    score,
    reason_codes: [
      ...(textDensity >= 0.5 ? ["TEXT_DENSITY"] : []),
      ...(uniqueness >= 0.8 ? ["UNIQUE_LABELS"] : []),
      ...(possibleFields.length ? ["KNOWN_MATERIAL_FIELDS"] : []),
    ],
    possible_fields: possibleFields,
  };
}

function candidatesFor(rows) {
  return rows
    .map(headerCandidate)
    .filter((candidate) => candidate.score > 0 && candidate.reason_codes.length > 0)
    .sort((left, right) =>
      right.possible_fields.length - left.possible_fields.length
      || right.score - left.score
      || left.row_number - right.row_number,
    )
    .slice(0, HEADER_CANDIDATE_LIMIT)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function prefix(path, length = 8) {
  const handle = await open(path, "r");
  try {
    const bytes = new Uint8Array(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    return bytes.slice(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function fileStream(path) {
  return Readable.toWeb(createReadStream(path));
}

function assertSupportedExtension(path, type) {
  const extension = extname(path).toLowerCase();
  if ((type === "XLSX" && extension !== ".xlsx") || (type === "CSV" && extension !== ".csv")) {
    const error = new Error("文件扩展名与检测类型不一致");
    error.code = "IMPORT_FILE_TYPE_UNSUPPORTED";
    throw error;
  }
}

export async function inspectMaterialFile(rawPath, options = {}) {
  const path = resolve(rawPath);
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    const error = new Error("inspect 目标必须是普通文件");
    error.code = "IMPORT_INSPECT_FILE_INVALID";
    throw error;
  }
  if (metadata.size <= 0 || metadata.size > MATERIAL_IMPORT_PARSER_LIMITS.maxFileBytes) {
    const error = new Error("文件为空或超过 10 MiB inspect 上限");
    error.code = "IMPORT_FILE_TOO_LARGE";
    throw error;
  }
  const detectedType = detectMaterialImportFileType(await prefix(path));
  assertSupportedExtension(path, detectedType);
  const file = {
    name: basename(path),
    type: detectedType,
    size_bytes: metadata.size,
    sha256: await sha256File(path),
  };
  const sampledRows = new Map();
  const collect = async (row) => {
    const rows = sampledRows.get(row.sheetIndex) ?? [];
    if (rows.length < HEADER_SAMPLE_ROWS) rows.push(row);
    sampledRows.set(row.sheetIndex, rows);
  };
  if (detectedType === "CSV") {
    const result = await parseMaterialImportCsv(fileStream(path), collect);
    return {
      file,
      csv: {
        csv_count: 1,
        encoding: result.encoding,
        delimiter: result.delimiter === "\t" ? "TAB" : result.delimiter,
        row_count: result.rowCount,
        column_count: result.sourceColumnMax,
        header_candidates: candidatesFor(sampledRows.get(0) ?? []),
        warning_codes: [...new Set(result.warnings.map((warning) => warning.code))],
      },
    };
  }
  const saxWasm = options.saxWasm
    ?? new Uint8Array(await readFile(resolve(import.meta.dirname, "../node_modules/sax-wasm/lib/sax-wasm.wasm")));
  const result = await parseMaterialImportXlsx(
    fileStream(path),
    saxWasm,
    new MemoryMaterialImportSharedStringStore(),
    collect,
  );
  return {
    file,
    excel: {
      sheet_count: result.workbookSheetCount,
      visible_sheet_count: result.visibleSheetCount,
      hidden_sheet_count: result.hiddenSheetCount + result.veryHiddenSheetCount,
      sheets: result.sheets.map((sheet) => ({
        sheet_index: sheet.sheetIndex,
        sheet_name: sheet.sheetName,
        visibility: sheet.visibility,
        row_count: sheet.rowCount,
        column_count: sheet.sourceColumnMax,
        header_candidates: sheet.visibility === "VISIBLE"
          ? candidatesFor(sampledRows.get(sheet.sheetIndex) ?? [])
          : [],
        warning_codes: [...new Set(sheet.warnings.map((warning) => warning.code))],
      })),
    },
  };
}
