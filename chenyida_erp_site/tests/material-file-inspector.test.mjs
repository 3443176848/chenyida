import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { inspectMaterialFile } from "../scripts/material-file-inspector.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

test("local CSV inspect reports safe metadata, header candidates, encoding and delimiter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "material-inspect-"));
  const path = join(directory, "materials.csv");
  try {
    await writeFile(path, "物料编码,品名,分类,计量单位,品牌,制造商料号,供应商料号\nM-1,测试物料,电阻,PCS,TEST,MPN-1,SUP-1\n");
    const inspected = await inspectMaterialFile(path);
    assert.equal(inspected.file.name, "materials.csv");
    assert.equal(inspected.file.type, "CSV");
    assert.match(inspected.file.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      inspected.csv.header_candidates[0].possible_fields.map((field) => field.standard_field),
      [
        "material_code",
        "standard_name",
        "category",
        "base_unit",
        "brand",
        "manufacturer_part_no",
        "supplier_part_no",
      ],
    );
    assert.equal(inspected.csv.encoding, "utf-8");
    assert.equal(inspected.csv.delimiter, ",");
    assert.equal(inspected.csv.column_count, 7);
    assert.equal(JSON.stringify(inspected).includes("测试物料"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local XLSX inspect uses the bounded production parser without modifying the workbook", async () => {
  const path = resolve(siteRoot, "../物料主数据治理落地包/output/物料主数据治理模板.xlsx");
  const inspected = await inspectMaterialFile(path);
  assert.equal(inspected.file.type, "XLSX");
  assert.equal(inspected.excel.sheet_count, 10);
  assert.equal(inspected.excel.sheets.length, 10);
  assert.equal(inspected.excel.sheets.every((sheet) => Number.isInteger(sheet.row_count)), true);
});

test("local inspect rejects extension/type mismatch before parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "material-inspect-mismatch-"));
  const path = join(directory, "not-an-xlsx.xlsx");
  try {
    await writeFile(path, "a,b\n1,2\n");
    await assert.rejects(
      inspectMaterialFile(path),
      (error) => error.code === "IMPORT_FILE_TYPE_UNSUPPORTED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
