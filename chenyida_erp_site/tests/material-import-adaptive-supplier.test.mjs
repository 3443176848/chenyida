import assert from "node:assert/strict";
import test from "node:test";

import {
  MATERIAL_IMPORT_FIELD_ALIASES,
  analyzeAdaptiveImportStructure,
  buildCanonicalImportRow,
  classifyAdaptiveDataRow,
  extractSpecificationCandidate,
  suggestAdaptiveFieldMappings,
} from "../app/lib/material-import/adaptive-import.ts";

function row(rowNumber, source) {
  const cells = source.map((value, column_index) => ({
    column_index,
    column_ref: String.fromCharCode(65 + column_index),
    type: value === null ? "EMPTY" : /^-?\d+(?:\.\d+)?$/.test(String(value)) ? "NUMBER" : "TEXT",
    source_type: "TEXT",
    raw_value: value,
    display: value,
    format_code: null,
  }));
  return { rowNumber, raw: { schema_version: 1, source_column_count: source.length, cells } };
}

function sheet(sheetIndex, sheetName, rows, mergedRanges = []) {
  return { sheetIndex, sheetName, rowCount: rows.at(-1)?.rowNumber ?? 0, sourceColumnMax: Math.max(0, ...rows.map((item) => item.raw.source_column_count)), mergedRanges, rows };
}

test("field aliases centrally cover supplier specification variants", () => {
  for (const alias of ["规格", "规格型号", "型号规格", "产品规格", "尺寸", "参数", "品名及规格", "料号描述", "Description", "Specification", "Spec", "Model/Spec", "Size"]) {
    assert.equal(MATERIAL_IMPORT_FIELD_ALIASES.specification.some((item) => item.toLowerCase() === alias.toLowerCase()), true, alias);
  }
});

test("structure analysis scores material sheet above cover and detects a two-row merged header", () => {
  const cover = sheet(0, "使用说明", [row(1, ["供应商价格表"]), row(3, ["说明", "请勿修改"]), row(5, ["联系人", "已脱敏"])]);
  const data = sheet(1, "物料清单", [
    row(1, ["2026 产品清单", null, null, null, null]),
    row(2, [null, null, null, null, null]),
    row(3, ["物料信息", null, "规格信息", null, "采购信息"]),
    row(4, ["料号", "品名", "型号", "尺寸", "单位"]),
    row(5, ["A-001", "连接器", "MX-10", "10×20mm", "PCS"]),
    row(6, ["A-002", "电容", "C0402", "0402 10uF", "PCS"]),
  ], ["A3:B3", "C3:D3"]);
  const result = analyzeAdaptiveImportStructure([cover, data]);
  assert.equal(result.selectedSheetIndex, 1);
  const selected = result.sheets.find((item) => item.sheetIndex === 1).selectedHeader;
  assert.deepEqual([selected.headerStartRow, selected.headerEndRow, selected.dataStartRow], [3, 4, 5]);
  assert.deepEqual(selected.columns.map((column) => column.headerPath), ["物料信息/料号", "物料信息/品名", "规格信息/型号", "规格信息/尺寸", "采购信息/单位"]);
  assert.equal(selected.reasonCodes.includes("MULTI_ROW_HEADER_2"), true);
});

test("structure analysis prefers a BOM sheet over a smaller change-log sheet with similar field aliases", () => {
  const bom = sheet(0, "BOM", [
    row(1, ["V700 BOM", null, null, null]),
    row(2, ["序号", "物料规格描述", "物料型号", "数量"]),
    ...Array.from({ length: 20 }, (_, index) => row(index + 3, [String(index + 1), `规格-${index + 1}`, `MODEL-${index + 1}`, "1"])),
  ], ["A1:D1"]);
  const changeLog = sheet(1, "变更记录", [
    row(1, ["V700 变更记录", null, null, null]),
    row(2, ["序号", "修改记录描述", "物料规格描述", "数量"]),
    row(3, ["1", "修改内容", "规格-1", "1"]),
    row(4, ["2", "修改内容", "规格-2", "1"]),
  ], ["A1:D1"]);
  const result = analyzeAdaptiveImportStructure([bom, changeLog]);
  assert.equal(result.selectedSheetIndex, 0);
  assert.equal(result.sheets.find((item) => item.sheetIndex === 1).reasonCodes.includes("CHANGE_OR_HISTORY_SHEET_PENALTY"), true);
});

test("structure analysis supports three-row headers and scans after title, note, and blank rows", () => {
  const target = sheet(0, "Data", [
    row(1, ["报价物料清单", null, null]),
    row(2, ["说明：价格已脱敏", null, null]),
    row(3, [null, null, null]),
    row(4, ["物料", "规格", "规格"]),
    row(5, ["基础", "型号", "尺寸"]),
    row(6, ["信息", "参数", "参数"]),
    row(7, ["品名", "Model/Spec", "Size"]),
    row(8, ["电阻", "R-10K", "0402"]),
  ]);
  const result = analyzeAdaptiveImportStructure([target]);
  const candidates = result.sheets[0].headerCandidates;
  assert.equal(candidates.some((candidate) => candidate.headerEndRow - candidate.headerStartRow + 1 === 3), true);
  assert.ok(result.sheets[0].selectedHeader.headerStartRow >= 4);
});

test("row classification skips blank, repeated header, subtotal, total, and footer without deleting raw rows", () => {
  const target = sheet(0, "物料", [
    row(1, ["料号", "品名", "规格", "单位"]),
    row(2, ["1", "电阻", "10K", "PCS"]),
    row(3, [null, null, null, null]),
    row(4, ["料号", "品名", "规格", "单位"]),
    row(5, ["小计"]),
    row(6, ["合计"]),
    row(7, ["审核："]),
  ]);
  const analysis = analyzeAdaptiveImportStructure([target]).sheets[0];
  const kinds = new Map(analysis.rowClassifications.map((item) => [item.rowNumber, item.kind]));
  assert.equal(kinds.get(2), "DATA");
  assert.equal(kinds.get(3), "BLANK");
  assert.equal(kinds.get(4), "REPEATED_HEADER");
  assert.equal(kinds.get(5), "SUBTOTAL");
  assert.equal(kinds.get(6), "TOTAL");
  assert.equal(kinds.get(7), "FOOTER");
  assert.equal(target.rows.length, 7);
});

test("runtime row classification explains repeated headers, totals, footers, notes, and data", () => {
  const headers = [
    { sourceColumnIndexes: [0], sourceHeaders: ["物料信息/料号"] },
    { sourceColumnIndexes: [1], sourceHeaders: ["物料信息/品名"] },
    { sourceColumnIndexes: [2, 3], sourceHeaders: ["规格信息/型号", "规格信息/长度"] },
  ];
  assert.equal(classifyAdaptiveDataRow(row(1, ["料号", "品名", "型号", "长度"]).raw, headers).kind, "REPEATED_HEADER");
  assert.equal(classifyAdaptiveDataRow(row(2, ["小计", "2"]).raw, headers).kind, "SUBTOTAL");
  assert.equal(classifyAdaptiveDataRow(row(3, ["合计", "2"]).raw, headers).kind, "TOTAL");
  assert.equal(classifyAdaptiveDataRow(row(4, ["审核："]).raw, headers).kind, "FOOTER");
  assert.equal(classifyAdaptiveDataRow(row(5, ["说明：以下价格已脱敏"]).raw, headers).kind, "TITLE_OR_NOTE");
  assert.equal(classifyAdaptiveDataRow(row(6, ["V700 PCB BOM"]).raw, headers).kind, "TITLE_OR_NOTE");
  assert.equal(classifyAdaptiveDataRow(row(7, ["A-1", "连接器", "MX-10", "20mm"]).raw, headers).kind, "DATA");
});

test("mapping combines header aliases, value features, and supplier profile history", () => {
  const target = sheet(0, "物料", [
    row(1, ["自定义编号", "品名", "型号", "尺寸", "计量单位"]),
    row(2, ["S-001", "连接器", "MX-20", "10×20mm", "PCS"]),
    row(3, ["S-002", "连接器", "MX-30", "20×30mm", "PCS"]),
  ]);
  const structure = analyzeAdaptiveImportStructure([target], {
    supplierKey: "SUPPLIER-A",
    headerAliases: { supplier_part_no: ["自定义编号"] },
    preferredMappings: { supplier_part_no: ["自定义编号"] },
  });
  const mappings = suggestAdaptiveFieldMappings(structure.sheets[0].selectedHeader, {
    supplierKey: "SUPPLIER-A",
    headerAliases: { supplier_part_no: ["自定义编号"] },
    preferredMappings: { supplier_part_no: ["自定义编号"] },
  });
  assert.equal(mappings.find((item) => item.field === "supplier_part_no").status, "EXACT");
  const specification = mappings.find((item) => item.field === "specification");
  assert.deepEqual(specification.sourceHeaders, ["型号", "尺寸"]);
  assert.equal(specification.combinationStrategy, "JOIN_NON_EMPTY");
  assert.equal(["HIGH_CONFIDENCE", "SUGGESTED"].includes(specification.status), true);
});

test("qualified manufacturer code is not generalized into material code and BOM usage maps to quantity", () => {
  const target = sheet(0, "BOM", [
    row(44, ["序号", "名称", "物料规格描述", "厂商物料编码", "生产厂商", "用量", "位号", "备注"]),
    row(45, ["1", "连接器", "10×20mm", "MFG-001", "厂商甲", "2", "J1", ""]),
    row(46, ["2", "电容", "0402 10uF", "MFG-002", "厂商乙", "4", "C1", ""]),
  ]);
  const header = analyzeAdaptiveImportStructure([target]).sheets[0].selectedHeader;
  const mappings = suggestAdaptiveFieldMappings(header);
  assert.equal(mappings.find((item) => item.field === "material_code").status, "UNMAPPED");
  assert.deepEqual(mappings.find((item) => item.field === "manufacturer_part_no").sourceHeaders, ["厂商物料编码"]);
  assert.equal(mappings.find((item) => item.field === "manufacturer_part_no").status, "EXACT");
  assert.deepEqual(mappings.find((item) => item.field === "quantity").sourceHeaders, ["用量"]);
  assert.equal(mappings.find((item) => item.field === "quantity").status, "EXACT");
});

test("specification extraction separates explicit, component, inferred, and missing evidence", () => {
  assert.deepEqual(extractSpecificationCandidate({ explicitValues: [" 0402 10uF 16V "] }), {
    value: "0402 10uF 16V", confidence: 0.98, status: "EXACT", reviewStatus: "AUTO_ACCEPTABLE", evidence: ["EXPLICIT_SPECIFICATION_COLUMN"],
  });
  const components = extractSpecificationCandidate({ componentValues: ["MX-10", "10×20mm", "黑色"] });
  assert.equal(components.value, "MX-10 10×20mm 黑色");
  assert.equal(components.reviewStatus, "NEEDS_REVIEW");
  const inferred = extractSpecificationCandidate({ materialName: "贴片电阻 0402 10KΩ 1%", description: "" });
  assert.equal(inferred.status, "SUGGESTED");
  assert.equal(inferred.reviewStatus, "NEEDS_REVIEW");
  assert.match(inferred.value, /0402/);
  const missing = extractSpecificationCandidate({ materialName: "普通物料", description: "无参数" });
  assert.equal(missing.value, null);
  assert.equal(missing.status, "UNMAPPED");
});

test("canonical row preserves immutable raw values and never turns missing specification into an accepted value", () => {
  const source = row(8, ["A-1", "普通物料", "PCS"]);
  const mappings = [
    { field: "material_code", sourceColumnIndexes: [0], sourceHeaders: ["料号"], combinationStrategy: "FIRST_NON_EMPTY", separator: " ", confidence: 1, status: "EXACT", evidence: ["EXACT_HEADER_ALIAS"] },
    { field: "material_name", sourceColumnIndexes: [1], sourceHeaders: ["品名"], combinationStrategy: "FIRST_NON_EMPTY", separator: " ", confidence: 1, status: "EXACT", evidence: ["EXACT_HEADER_ALIAS"] },
    { field: "unit", sourceColumnIndexes: [2], sourceHeaders: ["单位"], combinationStrategy: "FIRST_NON_EMPTY", separator: " ", confidence: 1, status: "EXACT", evidence: ["EXACT_HEADER_ALIAS"] },
    { field: "specification", sourceColumnIndexes: [], sourceHeaders: [], combinationStrategy: "SPECIFICATION_EXTRACT", separator: " ", confidence: 0, status: "UNMAPPED", evidence: ["NO_CANDIDATE"] },
  ];
  const canonical = buildCanonicalImportRow({ sourceFileId: 9, sheetName: "Data", row: source, mappings, supplierId: "SUP-A", supplierProfileId: 2, now: "2026-07-18T00:00:00.000Z" });
  assert.equal(canonical.raw_specification, null);
  assert.equal(canonical.mapped_values_json.specification, null);
  assert.equal(canonical.specification_confidence, 0);
  assert.equal(canonical.review_status, "NEEDS_REVIEW");
  assert.equal(canonical.raw_values_json, source.raw);
});

test("conflicting near-equal columns are not silently selected", () => {
  const target = sheet(0, "物料", [
    row(1, ["品名", "产品名称", "规格", "单位"]),
    row(2, ["电阻", "电阻器", "10K 1%", "PCS"]),
    row(3, ["电容", "电容器", "10uF 16V", "PCS"]),
  ]);
  const header = analyzeAdaptiveImportStructure([target]).sheets[0].selectedHeader;
  const mappings = suggestAdaptiveFieldMappings(header);
  const name = mappings.find((item) => item.field === "material_name");
  assert.equal(name.status, "CONFLICT");
});
