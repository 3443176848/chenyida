import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/projects/project-workspace.tsx", import.meta.url), "utf8");
const marketPage = await readFile(new URL("../app/business/projects/page.tsx", import.meta.url), "utf8");
const engineeringPage = await readFile(new URL("../app/engineering/projects/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");

test("market page exposes draft, revision, submit, return context and refresh recovery", () => {
  assert.match(marketPage, /MarketProjects/); assert.match(workspace, /市场项目交接/); assert.match(workspace, /新建客户需求/); assert.match(workspace, /保存为新需求版本/); assert.match(workspace, /重新提交/); assert.match(workspace, /项目部退回原因/);
  assert.match(workspace, /\/api\/projects/); assert.match(workspace, /expected_version/); assert.match(workspace, /crypto\.randomUUID/); assert.match(workspace, /useEffect\(.*load/s);
});

test("engineering page exposes bounded queue, safe detail, accept and reasoned return", () => {
  assert.match(engineeringPage, /EngineeringProjects/); assert.match(workspace, /项目部接收工作台/); assert.match(workspace, /待接收队列/); assert.match(workspace, /已接收项目/); assert.match(workspace, /接收项目/); assert.match(workspace, /退回原因/);
  assert.match(workspace, /技术资料元数据/); assert.match(workspace, /sha256/); assert.match(workspace, /size_bytes/); assert.doesNotMatch(workspace, /relative_path|absolute_path|file_body/);
});

test("both workspaces render loading, empty, error and role gates and dashboard entries", () => {
  for (const text of ["正在读取会话", "暂无项目需求", "当前没有待接收项目", "project-error", "仅供市场部门", "仅供项目部门"]) assert.match(workspace, new RegExp(text));
  assert.match(dashboard, /市场部门/); assert.match(dashboard, /\/business\/projects/); assert.match(dashboard, /项目部门/); assert.match(dashboard, /\/engineering\/projects/);
  assert.match(client, /projectWrite/); assert.match(client, /X-CSRF-Token/); assert.match(client, /Idempotency-Key/); assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
});
