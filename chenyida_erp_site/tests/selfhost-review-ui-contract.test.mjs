import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/materials/_components/material-import-review-workspace.tsx", import.meta.url), "utf8");
const importWorkspace = await readFile(new URL("../app/materials/_components/material-import-workspace.tsx", import.meta.url), "utf8");
const primitives = await readFile(new URL("../app/materials/_components/material-import-primitives.tsx", import.meta.url), "utf8");
const normalization = await readFile(new URL("../app/materials/_components/material-import-normalization-review.tsx", import.meta.url), "utf8");

test("review UI remains in existing seven-step import workspace and preserves deep links", () => {
  assert.match(importWorkspace, /MaterialImportReviewWorkspace/);
  const stepsBlock = primitives.slice(primitives.indexOf("const STEPS"), primitives.indexOf("function currentStep"));
  assert.equal((stepsBlock.match(/\{ view: "/g) || []).length, 7);
  assert.match(primitives, /\["normalized", "issues", "review"\]/);
  assert.match(normalization, /view=review&run_id=/);
  assert.match(workspace, /searchParams\.set\("row", String\(row\.normalized_row_id\)\)/);
  assert.match(workspace, /className="min-drawer"/);
});

test("review UI exposes three layers, overrides, issue handling, exact binding and draft selection", () => {
  for (const marker of [
    "不可变 Parser 原始值", "Normalization 候选 / 人工最终值", "显式清空", "恢复候选",
    "动态属性（稳定 attribute_code）", "确认 WARNING", "精确搜索 ACTIVE 物料",
    "明确绑定此 ACTIVE", "创建 Material Draft", "安全重试失败行", "复核历史版本（只读）",
  ]) assert.match(workspace, new RegExp(marker));
  assert.match(workspace, /status === 409/);
  assert.match(workspace, /服务端分页复核行/);
});

test("review UI does not expose forbidden automatic actions", () => {
  for (const forbidden of ["自动批准按钮", "自动生成正式编码按钮", "AI修正按钮", "自动匹配物料按钮", "直接创建ACTIVE物料按钮"]) {
    assert.doesNotMatch(workspace, new RegExp(forbidden));
  }
  assert.match(workspace, /没有创建 ACTIVE、自动审批、自动编码、自动匹配或 AI 修正入口/);
  assert.doesNotMatch(workspace, /cloudflare|d1|r2|queue\.send/i);
});
