import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const model = await readFile(new URL("../app/materials/_lib/material-import.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../app/materials/_lib/material-standardization.ts", import.meta.url), "utf8");
const component = await readFile(new URL("../app/materials/_components/material-standardization-preview.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../app/materials/_components/material-import-workspace.tsx", import.meta.url), "utf8");
const stepper = await readFile(new URL("../app/materials/_components/material-import-primitives.tsx", import.meta.url), "utf8");
const list = await readFile(new URL("../app/materials/_components/material-import-list-page.tsx", import.meta.url), "utf8");

test("awaiting supplier imports default to the standardization workbench", () => {
  assert.match(model, /status === "AWAITING_MAPPING"\) return "standardize"/);
  assert.ok(model.includes('"standardize"'));
  assert.ok(stepper.includes('label: "标准整理"'));
  assert.ok(workspace.includes("<MaterialStandardizationPreview"));
  assert.ok(list.includes("供应商物料导入"));
  assert.ok(list.includes("先按固定 13 列标准整理"));
});

test("the UI contract exposes exactly the agreed 13 columns in order", () => {
  const labels = ["序号", "项目号", "板子类型", "内部型号", "物料规格描述", "品牌", "用量", "替代料", "供应商", "订单数量", "需求数量", "购买数量", "库存数"];
  let cursor = -1;
  for (const label of labels) {
    const next = dto.indexOf(`label: "${label}"`, cursor + 1);
    assert.ok(next > cursor, `${label} should appear in order`);
    cursor = next;
  }
  assert.equal((dto.match(/label: "/g) || []).length, 13);
  assert.ok(component.includes("MATERIAL_STANDARDIZATION_COLUMNS.map"));
});

test("preview and download are distinct from formal material creation", () => {
  for (const fragment of [
    "standardization-preview",
    "standardization-export.csv",
    "不代表已经写入正式物料库",
    "高级字段 Mapping",
    "不会自动确认 Mapping、创建 Draft、批准物料或生成正式内部料号",
    "来源无法证明",
  ]) assert.ok(`${dto}\n${component}`.includes(fragment), fragment);
  assert.doesNotMatch(component, /\/opt\/|relative_path|raw_values/);
});
