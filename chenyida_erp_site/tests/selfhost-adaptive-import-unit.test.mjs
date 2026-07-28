import assert from "node:assert/strict";
import test from "node:test";

import { analyzeAdaptiveImportStructure, classifyAdaptiveDataRow } from "../app/lib/material-import/adaptive-import.ts";
import { adaptiveSuggestedItems, publishInitialMapping } from "../app/lib/material-import-selfhost/service.ts";

function row(rowNumber, values) {
  return {
    rowNumber,
    raw: {
      schema_version: 1,
      source_column_count: values.length,
      cells: values.map((value, columnIndex) => ({
        column_index: columnIndex,
        column_ref: String.fromCharCode(65 + columnIndex),
        type: value === null ? "EMPTY" : "TEXT",
        source_type: "TEST",
        raw_value: value,
        display: value,
        format_code: null,
      })),
    },
  };
}

function target(namespace, code, required = false) {
  return { target_namespace: namespace, target_code: code, required_for_confirm: required };
}

const targets = [
  target("basic", "STANDARD_NAME", true),
  target("basic", "SPECIFICATION_MODEL"),
  target("basic", "UNIT", true),
  target("basic", "BRAND"),
  target("basic", "MANUFACTURER"),
  target("basic", "MANUFACTURER_PART_NUMBER"),
  target("basic", "DESCRIPTION"),
  target("category_hint", "CATEGORY_HINT"),
  target("supplier_reference", "SUPPLIER_ITEM_CODE"),
  target("supplier_reference", "SUPPLIER_SPECIFICATION"),
  target("supplier_reference", "SOURCE_QUANTITY"),
];

test("selfhost adaptive conversion keeps manufacturer and brand separate and prefers explicit supplier part number", () => {
  const rows = [
    row(1, ["Item", "Name", "SPEC", "Model", "Brand", "Manufacturer", "Qty", "Unit", "Supplier Part No"]),
    row(2, ["ITEM-001", "连接器", "2.0mm 10PIN", "MX-10", "品牌甲", "制造商甲", "2", "PCS", "SUP-001"]),
    row(3, ["ITEM-002", "连接器", "2.0mm 20PIN", "MX-20", "品牌乙", "制造商乙", "4", "PCS", "SUP-002"]),
  ];
  const structure = analyzeAdaptiveImportStructure([{
    sheetIndex: 0,
    sheetName: "BOM",
    rowCount: rows.length,
    sourceColumnMax: 9,
    mergedRanges: [],
    rows,
  }]);
  const header = structure.sheets[0].selectedHeader;
  assert.ok(header);
  const items = adaptiveSuggestedItems(header, targets);
  const byTarget = new Map(items.map((item) => [`${item.target_namespace}.${item.target_code}`, item]));
  assert.equal(byTarget.get("basic.BRAND").source_column_index, 4);
  assert.equal(byTarget.get("basic.MANUFACTURER").source_column_index, 5);
  assert.equal(byTarget.get("basic.SPECIFICATION_MODEL").source_column_index, 3);
  assert.equal(byTarget.get("supplier_reference.SUPPLIER_ITEM_CODE").source_column_index, 8);
  assert.equal(byTarget.get("supplier_reference.SOURCE_QUANTITY").source_column_index, 6);
  assert.deepEqual(byTarget.get("supplier_reference.SUPPLIER_SPECIFICATION").source_column_indexes, [2]);
});

test("runtime row classification never drops a valid material because a later remark contains footer or total words", () => {
  const headers = [
    { sourceColumnIndexes: [0], sourceHeaders: ["Item"] },
    { sourceColumnIndexes: [1], sourceHeaders: ["Name"] },
    { sourceColumnIndexes: [2], sourceHeaders: ["SPEC"] },
    { sourceColumnIndexes: [3], sourceHeaders: ["备注"] },
  ];
  assert.equal(classifyAdaptiveDataRow(row(2, ["R1", "电阻", "0201 10K ±1%", "备注：可替代"]).raw, headers).kind, "DATA");
  assert.equal(classifyAdaptiveDataRow(row(3, ["R2", "电阻", "0201 12K ±1%", "合计"]).raw, headers).kind, "DATA");
  assert.equal(classifyAdaptiveDataRow(row(4, ["合计", "2"]).raw, headers).kind, "TOTAL");
  assert.equal(classifyAdaptiveDataRow(row(5, ["审核：张三"]).raw, headers).kind, "FOOTER");
});

test("runtime row classification preserves formula and error cells for fail-closed normalization", () => {
  const headers = [
    { sourceColumnIndexes: [0], sourceHeaders: ["Item"] },
    { sourceColumnIndexes: [1], sourceHeaders: ["SPEC"] },
  ];
  const raw = (type) => ({
    schema_version: 1,
    source_column_count: 2,
    cells: [
      {
        column_index: 0,
        column_ref: "A",
        type,
        source_type: "XLSX",
        raw_value: null,
        display: null,
        format_code: null,
        ...(type === "FORMULA" ? { formula: "A1+1", cached_value: "2", cached_type: "NUMBER" } : {}),
      },
      {
        column_index: 1,
        column_ref: "B",
        type: "EMPTY",
        source_type: "XLSX",
        raw_value: null,
        display: null,
        format_code: null,
      },
    ],
  });
  assert.deepEqual(classifyAdaptiveDataRow(raw("FORMULA"), headers), {
    kind: "DATA",
    confidence: 1,
    reasonCodes: ["UNTRUSTED_CELL_REQUIRES_VALIDATION"],
  });
  assert.equal(classifyAdaptiveDataRow(raw("ERROR"), headers).kind, "DATA");
});

test("adaptive structure returns no candidate for an unstructured note-only source", () => {
  const rows = [row(1, ["内部说明"]), row(2, ["请联系管理员"]), row(3, ["版本记录"])];
  const structure = analyzeAdaptiveImportStructure([{
    sheetIndex: 0,
    sheetName: "说明",
    rowCount: rows.length,
    sourceColumnMax: 1,
    mergedRanges: [],
    rows,
  }]);
  assert.equal(structure.selectedSheetIndex, null);
  assert.equal(structure.status, "NO_CANDIDATE");
});

test("selfhost publication keeps an untrusted header as an empty NO_HEADER draft", async () => {
  const sourceRows = [row(1, ["内部说明"]), row(2, ["请联系管理员"]), row(3, ["版本记录"])];
  let mappingInsert = null;
  let mappingItemWrites = 0;
  const client = {
    async query(statement, values = []) {
      const sql = String(statement).replace(/\s+/g, " ").trim().toLowerCase();
      if (sql.startsWith("select * from material_import_batches")) return { rows: [{ id: 1, source_kind: "CSV" }] };
      if (sql.includes("from material_attribute_definitions d")) return { rows: [] };
      if (sql.startsWith("select max(mapping_version)")) return { rows: [{ version: null }] };
      if (sql.startsWith("insert into material_import_mappings")) {
        mappingInsert = values;
        return { rows: [{ id: 77 }] };
      }
      if (sql.startsWith("insert into material_import_mapping_items")) {
        mappingItemWrites += 1;
        return { rows: [] };
      }
      if (sql.startsWith("insert into material_import_header_suggestions")) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const result = await publishInitialMapping(client, {
    batchId: 1,
    parseRunId: 2,
    requestId: "11111111-1111-4111-8111-111111111111",
    actor: "tester",
    rows: sourceRows.map((item) => ({ sheetIndex: 0, sheetName: "说明", rowNumber: item.rowNumber, raw: item.raw })),
  });
  assert.equal(result.mappingId, 77);
  assert.equal(mappingInsert[7], "NO_HEADER");
  assert.deepEqual(mappingInsert.slice(8, 15), [null, null, null, null, null, null, null]);
  assert.deepEqual(JSON.parse(mappingInsert[16]).map((field) => field.normalized_header), ["COLUMN_A"]);
  assert.equal(mappingItemWrites, 0);
});
