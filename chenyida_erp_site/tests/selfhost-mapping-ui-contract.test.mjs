import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/materials/_components/material-import-workspace.tsx", import.meta.url), "utf8");
const model = await readFile(new URL("../app/materials/_lib/material-import.ts", import.meta.url), "utf8");

test("current import workspace exposes mapping versions and explicit reuse", () => {
  for (const fragment of [
    "/mapping/versions",
    "/mapping/reuse-candidates",
    "/mapping/reuse",
    "Mapping 版本与复用",
    "服务端未自动确认",
    "创建新 Mapping 草稿版本",
    "应用到当前草稿",
  ]) assert.match(workspace, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(model, /"REUSE"/);
  assert.match(model, /"NEW_VERSION"/);
});

test("mapping confirmation remains explicit and bound to version, parse run and metadata digest", () => {
  for (const fragment of [
    "expected_mapping_version",
    "parse_run_id",
    "metadata_digest",
    "mapping/preview",
    "mapping/confirm",
    "重新预览和确认",
  ]) assert.ok(workspace.includes(fragment), fragment);
});
