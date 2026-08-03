import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/planning/material-requirement-workspace.tsx", import.meta.url), "utf8");
const planningPage = await readFile(new URL("../app/planning/material-requirements/page.tsx", import.meta.url), "utf8");
const purchasePage = await readFile(new URL("../app/planning/purchase-requests/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/planning/planning.css", import.meta.url), "utf8");

test("planning UI shows package source, database results and explicit locked submission", () => {
  assert.match(planningPage, /MaterialRequirementWorkspace/); assert.match(workspace, /已接收交接包/); assert.match(workspace, /生成物料需求预览/); assert.match(workspace, /加锁重算并提交采购部/);
  for (const field of ["gross_requirement", "stock_available", "eligible_inbound", "stock_allocated", "inbound_allocated", "net_purchase_requirement"]) assert.match(workspace, new RegExp(field));
  assert.match(workspace, /DRAFT 不占用库存或在途/); assert.match(workspace, /不会修改正式 reserved_qty/); assert.match(workspace, /createSessionWriteRegistry/); assert.match(workspace, /sessionPost/); assert.doesNotMatch(workspace, /crypto\.randomUUID/);
  assert.doesNotMatch(workspace, /parseFloat|Number\(.*(?:gross|stock|inbound|net)/s);
});

test("purchase UI only accepts or returns immutable request lines", () => {
  assert.match(purchasePage, /PurchaseRequestWorkspace/); assert.match(workspace, /待接收申请/); assert.match(workspace, /接收采购申请/); assert.match(workspace, /退回计划部/); assert.match(workspace, /requested_quantity/);
  assert.match(workspace, /不询价、不选供应商、不创建采购订单或收货单/); assert.doesNotMatch(workspace, />选择供应商<|>比价<|>创建采购订单<|>确认收货</);
});

test("purchase detail renders honest scoped lineage, immutable quantities and separate current supply", () => {
  for (const text of ["Package 与 ACCEPT 谱系","完整 Package SHA-256 摘要","Material Requirement Plan ID","数据快照截止时间","提交时数量分配快照","当前库存 / 供应状态","Purchase Request ID","PRQ未单独版本化；固定引用需求计划v","该版本未采集计划说明","该版本未采集采购交接说明","未选择供应商","未填写价格","未指定接收人","未配置处理时限"]) assert.match(workspace,new RegExp(text));
  for (const field of ["material_id","gross_requirement","stock_available","stock_allocated","eligible_inbound","inbound_allocated","net_purchase_requirement","requested_quantity","current_supply"]) assert.match(workspace,new RegExp(field));
  assert.match(workspace,/净采购 = max\(毛需求 - 库存分配 - 在途分配, 0\)/);
  assert.match(workspace,/Package ACCEPT/);assert.match(workspace,/PRQ SUBMIT/);assert.match(workspace,/SUCCESS/);assert.match(workspace,/不会自动生成采购单据/);
  assert.doesNotMatch(workspace,/净需求为 0，不生成/);assert.match(workspace,/提交快照净采购为 0；未生成 PRQ/);assert.match(workspace,/未找到采购申请；请核验关系化提交事实/);
});

test("purchase decisions require confirmation and cancellation paths contain no business mutation", () => {
  assert.match(workspace,/PurchaseDecisionDialog/);assert.match(workspace,/decisionInFlight\.current/);assert.match(workspace,/event\.key === "Escape"/);assert.match(workspace,/event\.target === event\.currentTarget/);assert.match(workspace,/ref=\{cancelRef\}/);assert.match(workspace,/disabled=\{busy\}/);
  assert.match(workspace,/采购部门基于已接收PRQ开展供应商寻源、询价和报价比较；接收本身不会自动创建RFQ、定标、PO、收货或AP。/);
  assert.match(workspace,/不修改原需求计划及提交时分配快照/);assert.match(workspace,/从已处理记录查看凭证/);assert.match(workspace,/Idempotency|createSessionWriteRegistry/);
  const closeBody=workspace.match(/const closeDecision[^;]+;/)?.[0]||"";assert.doesNotMatch(closeBody,/mutate|sessionPost|fetch|api\(/);
});

test("390px purchase layout keeps key quantities and units intact without page overflow", () => {
  assert.match(styles,/@media\(max-width:420px\)/);assert.match(styles,/\.planning-quantity\{[^}]*white-space:nowrap/);assert.match(styles,/\.purchase-line-heading\{[^}]*grid-template-columns:1fr/);assert.match(styles,/\.purchase-allocation-columns\{[^}]*grid-template-columns:1fr/);assert.match(styles,/max-width:100%/);assert.match(workspace,/purchase-line-cards/);assert.match(workspace,/展开数量分配与当前供应/);
});

test("dashboard exposes both native handoff queues", () => {
  assert.match(dashboard, /material-requirements/); assert.match(dashboard, /purchase-requests/); assert.match(dashboard, /pending_purchase_requests/); assert.match(dashboard, /accepted_planning_packages/);
});
