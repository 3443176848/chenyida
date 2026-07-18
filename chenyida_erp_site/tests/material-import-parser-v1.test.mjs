import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { detectCsvDelimiter, parseMaterialImportCsv } from "../app/lib/material-import/csv-parser.ts";
import { MATERIAL_IMPORT_PARSER_LIMITS, MaterialImportParserError, columnIndex, columnReference, normalizeRawRow } from "../app/lib/material-import/parser-model.ts";
import { MemoryMaterialImportSharedStringStore, parseMaterialImportXlsx } from "../app/lib/material-import/xlsx-parser.ts";

const encoder = new TextEncoder();
const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const saxWasm = new Uint8Array(await readFile(resolve(siteRoot, "node_modules/sax-wasm/lib/sax-wasm.wasm")));

function chunks(text, size = 3) {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  return new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size)); controller.close(); } });
}

async function csv(text, chunkSize = 3) {
  const rows = [];
  const result = await parseMaterialImportCsv(chunks(text, chunkSize), async (row) => { rows.push(row); });
  return { result, rows };
}

async function workbook({ sheets, sharedStrings, styles, date1904 = false, externalRelationship = false, doctype = false }) {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output);
  const sheetTags = sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" state="${sheet.state ?? "visible"}" r:id="rId${index + 1}"/>`).join("");
  await writer.add("xl/workbook.xml", new TextReader(`${doctype ? '<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///etc/passwd">]>' : ''}<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets>${sheetTags}</sheets></workbook>`));
  const rels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Target="${externalRelationship ? "https://example.test/file.xml" : `worksheets/sheet${index + 1}.xml`}"${externalRelationship ? ' TargetMode="External"' : ""}/>`).join("");
  await writer.add("xl/_rels/workbook.xml.rels", new TextReader(`<Relationships>${rels}</Relationships>`));
  for (let index = 0; index < sheets.length; index += 1) await writer.add(`xl/worksheets/sheet${index + 1}.xml`, new TextReader(sheets[index].xml));
  if (sharedStrings) await writer.add("xl/sharedStrings.xml", new TextReader(sharedStrings));
  if (styles) await writer.add("xl/styles.xml", new TextReader(styles));
  return writer.close();
}

test("column references round-trip across Excel boundaries", () => {
  for (const index of [0, 25, 26, 51, 255]) assert.equal(columnIndex(`${columnReference(index)}1`), index);
});

test("raw row hash is stable and includes source width", async () => {
  const cell = { column_index: 0, column_ref: "A", type: "TEXT", source_type: "TEXT", raw_value: "00123", display: "00123", format_code: null };
  const first = await normalizeRawRow(1, [cell]);
  const second = await normalizeRawRow(1, [cell]);
  const wider = await normalizeRawRow(2, [cell]);
  assert.equal(first.hash, second.hash);
  assert.notEqual(first.hash, wider.hash);
  assert.deepEqual(JSON.parse(first.json), { schema_version: 1, source_column_count: 1, cells: [cell] });
});

for (const [name, source, expected] of [
  ["comma delimiter", "a,b\n1,2\n", ","],
  ["tab delimiter", "a\tb\n1\t2\n", "\t"],
  ["semicolon delimiter", "a;b\n1;2\n", ";"],
]) test(`CSV detects ${name}`, () => assert.equal(detectCsvDelimiter(source), expected));

test("CSV rejects ambiguous delimiter detection", () => assert.throws(() => detectCsvDelimiter("one\ntwo\n"), /识别/));

test("CSV preserves 00123 as text", async () => {
  const { rows } = await csv("code,name\n00123,part\n");
  assert.equal(rows[1].raw.cells[0].type, "TEXT");
  assert.equal(rows[1].raw.cells[0].raw_value, "00123");
});

test("CSV handles quoted newline and escaped quotes across chunks", async () => {
  const { rows } = await csv('code,note\r\n1,"line 1\nline ""2"""\r\n', 1);
  assert.equal(rows[1].raw.cells[1].raw_value, 'line 1\nline "2"');
});

test("CSV preserves trailing empty columns", async () => {
  const { rows } = await csv("a,b,\n1,2,\n");
  assert.equal(rows[1].raw.source_column_count, 3);
  assert.equal(rows[1].raw.cells[2].type, "EMPTY");
});

test("CSV accepts CRLF LF and blank rows", async () => {
  const { rows } = await csv("a,b\r\n\r\n1,2\n");
  assert.equal(rows.length, 3);
  assert.equal(rows[1].raw.source_column_count, 1);
});

test("CSV warns on irregular column count", async () => {
  const { result } = await csv("a,b\n1\n2,3,4\n");
  assert.equal(result.warnings.some((warning) => warning.code === "CSV_IRREGULAR_COLUMN_COUNT"), true);
});

for (const prefix of ["=", "+", "-", "@"]) test(`CSV marks ${prefix} formula-injection risk without rejecting`, async () => {
  const { rows } = await csv(`value,x\n${prefix}cmd,1\n`);
  assert.equal(rows[1].raw.cells[0].formula_injection_risk, true);
});

test("CSV supports UTF-8 BOM", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("名称,值\n物料,1\n")]);
  const rows = [];
  const result = await parseMaterialImportCsv(chunks(bytes, 2), async (row) => rows.push(row));
  assert.equal(result.encoding, "utf-8");
  assert.equal(rows[1].raw.cells[0].raw_value, "物料");
});

test("CSV supports strict GB18030 input", async () => {
  const bytes = new Uint8Array([0xc3, 0xfb, 0xb3, 0xc6, 0x2c, 0xd6, 0xb5, 0x0a, 0xce, 0xef, 0xc1, 0xcf, 0x2c, 0x31, 0x0a]);
  const rows = [];
  const result = await parseMaterialImportCsv(chunks(bytes, 2), async (row) => rows.push(row));
  assert.equal(result.encoding, "gb18030");
  assert.equal(rows[0].raw.cells[0].raw_value, "名称");
  assert.equal(rows[1].raw.cells[0].raw_value, "物料");
});

test("CSV rejects unsupported byte encoding", async () => {
  await assert.rejects(parseMaterialImportCsv(chunks(new Uint8Array([0xff, 0xff, 0xff])), async () => {}), (error) => error.code === "IMPORT_PARSE_UNSUPPORTED_ENCODING");
});

test("CSV enforces column limit", async () => {
  const line = Array.from({ length: MATERIAL_IMPORT_PARSER_LIMITS.maxColumns + 1 }, (_, index) => String(index)).join(",");
  await assert.rejects(csv(`${line}\n${line}\n`, 1024), (error) => error.code === "IMPORT_PARSE_LIMIT_EXCEEDED");
});

test("CSV enforces cell length", async () => {
  const large = "x".repeat(MATERIAL_IMPORT_PARSER_LIMITS.maxCellCharacters + 1);
  await assert.rejects(csv(`a,b\n${large},1\n`, 64 * 1024), (error) => error.code === "IMPORT_PARSE_LIMIT_EXCEEDED");
});

test("CSV cancellation releases the input stream", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(parseMaterialImportCsv(chunks("a,b\n1,2\n"), async () => {}, { signal: controller.signal }), (error) => error.code === "IMPORT_PARSE_CANCELLED");
});

test("XLSX parses shared strings and inline strings", async () => {
  const bytes = await workbook({ sheets: [{ name: "Data", xml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Inline</t></is></c></row></sheetData></worksheet>' }], sharedStrings: "<sst><si><t>Shared</t></si></sst>" });
  const rows = [];
  const result = await parseMaterialImportXlsx(chunks(bytes, 17), saxWasm, new MemoryMaterialImportSharedStringStore(), async (row) => rows.push(row));
  assert.equal(result.parsedRowCount, 1);
  assert.deepEqual(rows[0].raw.cells.map((cell) => cell.raw_value), ["Shared", "Inline"]);
});

test("XLSX parses multiple sheets and skips hidden sheets", async () => {
  const bytes = await workbook({ sheets: [
    { name: "Visible", xml: '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>' },
    { name: "Hidden", state: "hidden", xml: '<worksheet><sheetData><row r="1"><c r="A1"><v>secret</v></c></row></sheetData></worksheet>' },
    { name: "VeryHidden", state: "veryHidden", xml: '<worksheet><sheetData><row r="1"><c r="A1"><v>secret</v></c></row></sheetData></worksheet>' },
  ] });
  const rows = [];
  const result = await parseMaterialImportXlsx(chunks(bytes, 23), saxWasm, new MemoryMaterialImportSharedStringStore(), async (row) => rows.push(row));
  assert.equal(rows.length, 1);
  assert.deepEqual([result.visibleSheetCount, result.hiddenSheetCount, result.veryHiddenSheetCount], [1, 1, 1]);
  assert.equal(result.skippedSheetCount, 2);
});

test("XLSX preserves formulas and cached values without execution", async () => {
  const bytes = await workbook({ sheets: [{ name: "Data", xml: '<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>' }] });
  const rows = [];
  await parseMaterialImportXlsx(chunks(bytes, 19), saxWasm, new MemoryMaterialImportSharedStringStore(), async (row) => rows.push(row));
  assert.equal(rows[0].raw.cells[0].type, "FORMULA");
  assert.equal(rows[0].raw.cells[0].formula, "1+1");
  assert.equal(rows[0].raw.cells[0].cached_value, "2");
});

for (const [system, date1904, serial, expected] of [["1900", false, "45292", "2024-01-01"], ["1904", true, "43830", "2024-01-01"]]) test(`XLSX interprets ${system} date system`, async () => {
  const styles = '<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>';
  const bytes = await workbook({ date1904, styles, sheets: [{ name: "Data", xml: `<worksheet><sheetData><row r="1"><c r="A1" s="0"><v>${serial}</v></c></row></sheetData></worksheet>` }] });
  const rows = [];
  await parseMaterialImportXlsx(chunks(bytes, 29), saxWasm, new MemoryMaterialImportSharedStringStore(), async (row) => rows.push(row));
  assert.equal(rows[0].raw.cells[0].interpreted_iso_value, expected);
  assert.equal(rows[0].raw.cells[0].date_system, system);
});

test("XLSX records merged ranges", async () => {
  const bytes = await workbook({ sheets: [{ name: "Data", xml: '<worksheet><sheetData/><mergeCells><mergeCell ref="A1:B2"/></mergeCells></worksheet>' }] });
  const result = await parseMaterialImportXlsx(chunks(bytes, 31), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {});
  assert.deepEqual(result.sheets[0].mergedRanges, ["A1:B2"]);
});

test("XLSX rejects an over-limit column with a stable parser error", async () => {
  const firstOverLimitReference = `${columnReference(MATERIAL_IMPORT_PARSER_LIMITS.maxColumns)}1`;
  const bytes = await workbook({ sheets: [{ name: "Data", xml: `<worksheet><sheetData><row r="1"><c r="${firstOverLimitReference}"><v>1</v></c></row></sheetData></worksheet>` }] });
  await assert.rejects(
    parseMaterialImportXlsx(chunks(bytes, 17), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {}),
    (error) => error.code === "IMPORT_PARSE_LIMIT_EXCEEDED" && error.message === "XLSX 列数超过限制",
  );
});

test("XLSX supports empty sheets", async () => {
  const bytes = await workbook({ sheets: [{ name: "Empty", xml: "<worksheet><sheetData/></worksheet>" }] });
  const result = await parseMaterialImportXlsx(chunks(bytes, 11), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {});
  assert.equal(result.sheets[0].rowCount, 0);
});

test("XLSX rejects external relationships", async () => {
  const bytes = await workbook({ externalRelationship: true, sheets: [{ name: "Data", xml: "<worksheet/>" }] });
  await assert.rejects(parseMaterialImportXlsx(chunks(bytes), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {}), (error) => error.code === "IMPORT_PARSE_INVALID_XLSX");
});

test("XLSX rejects DOCTYPE and external entities", async () => {
  const bytes = await workbook({ doctype: true, sheets: [{ name: "Data", xml: "<worksheet/>" }] });
  await assert.rejects(parseMaterialImportXlsx(chunks(bytes), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {}), (error) => error.code === "IMPORT_PARSE_INVALID_XLSX");
});

test("XLSX rejects corrupt XML", async () => {
  const bytes = await workbook({ sheets: [{ name: "Data", xml: "<worksheet><sheetData>" }] });
  await assert.rejects(parseMaterialImportXlsx(chunks(bytes), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {}), (error) => error.code === "IMPORT_PARSE_INVALID_XLSX");
});

test("XLSX rejects corrupt shared string indexes", async () => {
  const bytes = await workbook({ sheets: [{ name: "Data", xml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData></worksheet>' }], sharedStrings: "<sst><si><t>one</t></si></sst>" });
  await assert.rejects(parseMaterialImportXlsx(chunks(bytes), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {}), (error) => error.code === "IMPORT_PARSE_INVALID_XLSX");
});

test("XLSX shared string store supports multiple chunks and repeated references", async () => {
  const values = Array.from({ length: 513 }, (_, index) => `<si><t>v${index}</t></si>`).join("");
  const bytes = await workbook({ sheets: [{ name: "Data", xml: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>512</v></c><c r="B1" t="s"><v>512</v></c></row></sheetData></worksheet>' }], sharedStrings: `<sst>${values}</sst>` });
  const rows = [];
  await parseMaterialImportXlsx(chunks(bytes, 101), saxWasm, new MemoryMaterialImportSharedStringStore(), async (row) => rows.push(row));
  assert.deepEqual(rows[0].raw.cells.map((cell) => cell.raw_value), ["v512", "v512"]);
});

test("XLSX cancellation stops before visible sheet parsing", async () => {
  const bytes = await workbook({ sheets: [{ name: "Data", xml: '<worksheet><sheetData><row r="1"/></sheetData></worksheet>' }] });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(parseMaterialImportXlsx(chunks(bytes), saxWasm, new MemoryMaterialImportSharedStringStore(), async () => {}, { signal: controller.signal }), (error) => error.code === "IMPORT_PARSE_CANCELLED");
});

test("parser limits expose every approved bounded resource", () => {
  for (const key of ["maxSheets", "maxRows", "maxColumns", "maxCellCharacters", "maxNonEmptyCells", "maxSharedStrings", "maxTotalSharedStringBytes", "maxFormulaCharacters", "maxRowJsonBytes", "maxTotalNormalizedJsonBytes", "maxTotalDecodedTextBytes"]) assert.ok(MATERIAL_IMPORT_PARSER_LIMITS[key] > 0, key);
});

test("parser errors expose stable codes without source content", () => {
  const error = new MaterialImportParserError("IMPORT_PARSE_INVALID_XLSX", "工作簿无效");
  assert.equal(error.code, "IMPORT_PARSE_INVALID_XLSX");
  assert.equal(JSON.stringify(error).includes("secret"), false);
});
