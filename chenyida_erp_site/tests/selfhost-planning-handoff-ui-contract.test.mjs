import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/planning/planning-workspace.tsx", import.meta.url), "utf8");
const engineeringPage = await readFile(new URL("../app/engineering/projects/[projectId]/planning/page.tsx", import.meta.url), "utf8");
const planningPage = await readFile(new URL("../app/planning/handoffs/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");
const legacyOperations = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");

test("engineering planning page resolves stable versions and shows immutable package history", () => {
  assert.match(engineeringPage, /EngineeringPlanningWorkspace/); assert.match(workspace, /需求明细解析/); assert.match(workspace, /Product.*BOM/s); assert.match(workspace, /零件规格快照/);
  assert.match(workspace, /生成交接包/); assert.match(workspace, /提交计划部/); assert.match(workspace, /交接包版本/); assert.match(workspace, /退回原因/);
  assert.match(workspace, /requirement_item_id/); assert.match(workspace, /product_version_id/); assert.match(workspace, /bom_version_id/); assert.match(workspace, /expected_version/);
});

test("planning page has pending and accepted queues with read-only decision detail", () => {
  assert.match(planningPage, /PlanningHandoffWorkspace/); assert.match(workspace, /待接收交接包/); assert.match(workspace, /已接收历史/); assert.match(workspace, /接收交接包/); assert.match(workspace, /退回原因/);
  assert.match(workspace, /calculated_gross_quantity/); assert.match(workspace, /specification_snapshot/); assert.match(workspace, /package_digest/); assert.match(workspace, /crypto\.randomUUID/); assert.match(workspace, /useEffect\(.*load/s);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage|relative_path|absolute_path|storage_name|file_body/);
});

test("dashboard preserves the TASK02 queue while its package workspace stays upstream-only", () => {
  assert.match(dashboard, /计划部门/); assert.match(dashboard, /\/planning\/handoffs/); assert.match(dashboard, /pending_planning_handoffs/);
  assert.match(legacyOperations, /option value="planning">计划/);
  assert.doesNotMatch(workspace, /创建采购申请|创建采购订单|净需求计算|供应商推荐/);
});
