import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/planning/material-requirement-workspace.tsx", import.meta.url), "utf8");
const planningPage = await readFile(new URL("../app/planning/material-requirements/page.tsx", import.meta.url), "utf8");
const purchasePage = await readFile(new URL("../app/planning/purchase-requests/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");

test("planning UI shows package source, database results and explicit locked submission", () => {
  assert.match(planningPage, /MaterialRequirementWorkspace/); assert.match(workspace, /已接收交接包/); assert.match(workspace, /生成物料需求预览/); assert.match(workspace, /加锁重算并提交采购部/);
  for (const field of ["gross_requirement", "stock_available", "eligible_inbound", "stock_allocated", "inbound_allocated", "net_purchase_requirement"]) assert.match(workspace, new RegExp(field));
  assert.match(workspace, /DRAFT 不占用库存或在途/); assert.match(workspace, /不会修改正式 reserved_qty/); assert.match(workspace, /crypto\.randomUUID/);
  assert.doesNotMatch(workspace, /parseFloat|Number\(.*(?:gross|stock|inbound|net)/s);
});

test("purchase UI only accepts or returns immutable request lines", () => {
  assert.match(purchasePage, /PurchaseRequestWorkspace/); assert.match(workspace, /待接收申请/); assert.match(workspace, /接收采购申请/); assert.match(workspace, /退回计划部/); assert.match(workspace, /requested_quantity/);
  assert.match(workspace, /不询价、不选供应商、不创建采购订单或收货单/); assert.doesNotMatch(workspace, />选择供应商<|>比价<|>创建采购订单<|>确认收货</);
});

test("dashboard exposes both native handoff queues", () => {
  assert.match(dashboard, /material-requirements/); assert.match(dashboard, /purchase-requests/); assert.match(dashboard, /pending_purchase_requests/); assert.match(dashboard, /accepted_planning_packages/);
});
