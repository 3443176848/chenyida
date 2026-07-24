import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/materials/_components/material-detail-workspace.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/materials/[materialId]/audit-logs/page.tsx", import.meta.url), "utf8");

test("material detail workspace exposes a real paginated audit history route", () => {
  assert.match(route, /view="audit-logs"/);
  assert.match(workspace, /"audit-logs"/);
  assert.match(workspace, /物料操作审计历史/);
  assert.match(workspace, /MaterialPagination/);
});

test("audit history entry is capability-driven and renders only safe metadata", () => {
  assert.match(workspace, /material\.audit\.read/);
  assert.match(workspace, /canReadAudit \?/);
  assert.doesNotMatch(workspace, /item\.detail/);
  assert.match(workspace, /不显示请求正文、凭证或内部错误堆栈/);
});
