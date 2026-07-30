import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalDecimal,
  createMaterialStandardizationCsv,
  multiplyDecimal,
  standardizeMaterialRows,
  subtractDecimalFloorZero,
} from "../app/lib/material-standardization-selfhost/rules.ts";
import { MATERIAL_STANDARD_COLUMNS } from "../app/lib/material-standardization-selfhost/types.ts";
import { MaterialStandardizationService } from "../app/lib/material-standardization-selfhost/service.ts";

function raw(values, types = {}) {
  return {
    schema_version: 1,
    source_column_count: values.length,
    cells: values.flatMap((value, column_index) => value === null || value === undefined ? [] : [{
      column_index,
      column_ref: String.fromCharCode(65 + column_index),
      type: types[column_index] || "TEXT",
      source_type: "s",
      raw_value: String(value),
      display: String(value),
      format_code: null,
    }]),
  };
}

function fields(headers) {
  return headers.map((source_header, column_index) => ({ column_index, source_header }));
}

test("an exact 13-column template passes through without requiring a profile", () => {
  const headers = MATERIAL_STANDARD_COLUMNS.map((column) => column.label);
  const source = ["01", "A200", "USB小板", "8SD05169C", "电阻,10K,0402", "YAGEO", "2.50", "RC0402-10K", "供应商甲", "100", "250.00", "240.00", "10"];
  const result = standardizeMaterialRows({
    filename: "supplier.xlsx", sheetName: "Sheet1", sheetIndex: 0, parseRunId: 9,
    mappingStatus: "DRAFT", sourceFields: fields(headers), mappingItems: [], rows: [{ rowNumber: 2, raw: raw(source) }],
  });
  assert.equal(result.standard_version, "CYD-MATERIAL-13C-v1");
  assert.equal(result.profile.state, "TEMPLATE_CONFIRMED");
  assert.equal(result.profile.ready, true);
  assert.deepEqual(MATERIAL_STANDARD_COLUMNS.map((column) => result.rows[0].values[column.key]), source);
});

test("a supplier BOM uses explicit title context, exact decimals and folds only marked alternatives", () => {
  const headers = ["状态", "物料名称", "型号", "品牌", "单机用量", "订单数量", "库存数", "供应商名称"];
  const result = standardizeMaterialRows({
    filename: "A200量产BOM.xlsx", sheetName: "BOM", sheetIndex: 0, parseRunId: 10,
    mappingStatus: "CONFIRMED", sourceFields: fields(headers), mappingItems: [],
    rows: [
      { rowNumber: 1, raw: raw(["A200 USB BOM 8SD05169C"]) },
      { rowNumber: 2, raw: raw(["主料", "电阻,10K,0402", "RC0402-10K", "YAGEO", "0.1", "1000", "20", "供应商甲"]) },
      { rowNumber: 3, raw: raw(["替代料", "电阻,10K,0402", "ALT-10K", "KOA", "", "", "", "供应商乙"]) },
    ],
  });
  assert.equal(result.profile.state, "MAPPING_CONFIRMED");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.project, "A200");
  assert.equal(result.rows[0].values.board_type, "USB小板");
  assert.equal(result.rows[0].values.internal_model, "8SD05169C");
  assert.equal(result.rows[0].values.demand_quantity, "100");
  assert.equal(result.rows[0].values.purchase_quantity, "80");
  assert.equal(result.rows[0].values.alternative, "ALT-10K（KOA）");
  assert.deepEqual(result.rows[0].alternative_source_rows, [3]);
  assert.equal(result.summary.folded_alternative_count, 1);
});

test("unconfirmed structures remain provisional and formulas are never trusted", () => {
  const result = standardizeMaterialRows({
    filename: "unknown.xlsx", sheetName: "Sheet1", sheetIndex: 0, parseRunId: 11,
    mappingStatus: "DRAFT", sourceFields: fields(["物料名称", "数量"]), mappingItems: [],
    rows: [{ rowNumber: 2, raw: raw(["连接器", "=1+1"], { 1: "FORMULA" }) }],
  });
  assert.equal(result.profile.state, "PROFILE_PENDING");
  assert.equal(result.rows[0].values.usage, "");
  assert.ok(result.global_issues.some((item) => item.code === "STANDARDIZATION_PROFILE_PENDING"));
  assert.ok(result.rows[0].issues.some((item) => item.code === "STANDARDIZATION_FORMULA_OR_ERROR_IGNORED"));
  assert.ok(result.rows[0].issues.some((item) => item.code === "STANDARDIZATION_INTERNAL_MODEL_MISSING"));
});

test("existing server Mapping supplies standard fields without treating supplier part numbers as internal models", () => {
  const result = standardizeMaterialRows({
    filename: "supplier-layout.xlsx", sheetName: "Data", sheetIndex: 0, parseRunId: 13,
    mappingStatus: "CONFIRMED", sourceFields: fields(["供应商列A", "供应商列B", "供应商列C", "供应商列D"]),
    mappingItems: [
      { source_column_index: 0, source_column_indexes: [0], target_namespace: "supplier_reference", target_code: "SUPPLIER_ITEM_CODE", mapping_mode: "SOURCE" },
      { source_column_index: 1, source_column_indexes: [1], target_namespace: "supplier_reference", target_code: "SUPPLIER_SPECIFICATION", mapping_mode: "SOURCE" },
      { source_column_index: 2, source_column_indexes: [2], target_namespace: "basic", target_code: "BRAND", mapping_mode: "SOURCE" },
      { source_column_index: 3, source_column_indexes: [3], target_namespace: "supplier_reference", target_code: "SOURCE_QUANTITY", mapping_mode: "SOURCE" },
    ],
    rows: [{ rowNumber: 2, raw: raw(["SUP-9988", "连接器,24PIN", "JAE", "2"]) }],
  });
  assert.equal(result.rows[0].values.specification, "连接器,24PIN");
  assert.equal(result.rows[0].values.brand, "JAE");
  assert.equal(result.rows[0].values.usage, "2");
  assert.equal(result.rows[0].values.internal_model, "");
  assert.ok(result.rows[0].issues.some((item) => item.code === "STANDARDIZATION_INTERNAL_MODEL_MISSING"));
});

test("decimal arithmetic is string-exact and floors purchases at zero", () => {
  assert.equal(canonicalDecimal("001.2300"), "1.23");
  assert.equal(multiplyDecimal("0.1", "3"), "0.3");
  assert.equal(multiplyDecimal("2.500", "1000.2"), "2500.5");
  assert.equal(subtractDecimalFloorZero("0.3", "0.10"), "0.2");
  assert.equal(subtractDecimalFloorZero("2", "3"), "0");
});

test("CSV is UTF-8 BOM, RFC 4180 escaped and neutralizes spreadsheet formulas", () => {
  const headers = MATERIAL_STANDARD_COLUMNS.map((column) => column.label);
  const source = ["1", "=cmd", "USB,小板", "@model", "含\"引号\n换行", "品牌", "1", "", "供应商", "1", "1", "1", "0"];
  const projection = standardizeMaterialRows({
    filename: "template.xlsx", sheetName: "Sheet1", sheetIndex: 0, parseRunId: 12,
    mappingStatus: "DRAFT", sourceFields: fields(headers), mappingItems: [], rows: [{ rowNumber: 2, raw: raw(source) }],
  });
  const csv = createMaterialStandardizationCsv(projection);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes("'=cmd"));
  assert.ok(csv.includes("'@model"));
  assert.ok(csv.includes('"USB,小板"'));
  assert.ok(csv.includes('"含""引号\n换行"'));
  assert.ok(csv.endsWith("\r\n"));
});

function servicePool({ owner = "tester", status = "AWAITING_MAPPING", sheetVisible = true, count = 1, sourceBytes = 0 } = {}) {
  const pool = {
    async query(sql) {
      const statement = String(sql);
      if (/^(begin|commit|rollback)/.test(statement)) return { rows: [] };
      if (statement.includes("from material_import_batches b")) return { rows: [{ id: 7, batch_no: "IMP-7", status, created_by: owner, current_parse_run_id: 3, original_filename: "A200.xlsx" }] };
      if (statement.includes("from material_import_mappings")) return { rows: [{ id: 8, selected_sheet_index: 0, selected_sheet_name: "BOM", status: "DRAFT", header_row_number: 1, data_start_row_number: 2, source_fields: fields(["物料名称", "用量"]) }] };
      if (statement.includes("from material_import_parse_sheets")) return { rows: sheetVisible ? [{ sheet_name: "BOM", row_count: count, source_column_max: 2 }] : [] };
      if (statement.includes("from material_import_mapping_items")) return { rows: [] };
      if (statement.includes("count(*)::int")) return { rows: [{ count, source_bytes: sourceBytes }] };
      if (statement.includes("row_number<$4")) return { rows: [] };
      if (statement.includes("row_number>=$4")) return { rows: [{ row_number: 2, raw_values: raw(["电阻", "1"]) }] };
      throw new Error(`unexpected query: ${statement}`);
    },
    async connect() { return { query: pool.query, release() {} }; },
  };
  return pool;
}

test("service fails closed for row limits, hidden batches and unavailable sheets", async () => {
  const actor = { username: "tester", must_change_password: false, permissions: ["material.import.read"] };
  await assert.rejects(() => new MaterialStandardizationService(servicePool({ count: 5001 })).preview(7, actor, { page: 1, pageSize: 50 }), (error) => error.code === "STANDARDIZATION_ROW_LIMIT_EXCEEDED" && error.status === 413);
  await assert.rejects(() => new MaterialStandardizationService(servicePool({ sourceBytes: 32 * 1024 * 1024 + 1 })).preview(7, actor, { page: 1, pageSize: 50 }), (error) => error.code === "STANDARDIZATION_SOURCE_SIZE_LIMIT_EXCEEDED" && error.status === 413);
  await assert.rejects(() => new MaterialStandardizationService(servicePool({ owner: "someone_else" })).preview(7, actor, { page: 1, pageSize: 50 }), (error) => error.code === "IMPORT_BATCH_NOT_FOUND" && error.status === 404);
  await assert.rejects(() => new MaterialStandardizationService(servicePool({ sheetVisible: false })).preview(7, actor, { page: 1, pageSize: 50 }), (error) => error.code === "STANDARDIZATION_SHEET_NOT_AVAILABLE" && error.status === 409);
  await assert.rejects(() => new MaterialStandardizationService(servicePool({ status: "PARSED" })).preview(7, actor, { page: 1, pageSize: 50 }), (error) => error.code === "STANDARDIZATION_PARSE_NOT_READY" && error.status === 409);
});
