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
  assert.match(workspace, /草稿预览不占用库存或在途/); assert.match(workspace, /不会修改正式 reserved_qty/); assert.match(workspace, /createSessionWriteRegistry/); assert.match(workspace, /sessionPost/); assert.doesNotMatch(workspace, /crypto\.randomUUID/);
  assert.doesNotMatch(workspace, /parseFloat|Number\(.*(?:gross|stock|inbound|net)/s);
});

test("purchase UI only accepts or returns immutable request lines", () => {
  assert.match(purchasePage, /PurchaseRequestWorkspace/); assert.match(workspace, /待接收申请/); assert.match(workspace, /接收采购申请/); assert.match(workspace, /退回计划部/); assert.match(workspace, /requested_quantity/);
  assert.match(workspace, /不询价、不选供应商、不创建采购订单或收货单/); assert.doesNotMatch(workspace, />选择供应商<|>比价<|>创建采购订单<|>确认收货</);
});

test("purchase detail renders honest scoped lineage, immutable quantities and separate current supply", () => {
  for (const text of ["Package 与接收谱系","完整 Package SHA-256 摘要","Material Requirement Plan ID","数据快照截止时间","1. 提交时快照","2. 当前供应状态","3. 差异提示","Purchase Request ID","PRQ未单独版本化；固定引用需求计划v","该版本未采集计划说明","该版本未采集采购交接说明","未选择供应商","未填写价格","未指定接收人","未配置处理时限"]) assert.match(workspace,new RegExp(text));
  for (const field of ["material_id","gross_requirement","stock_available","stock_allocated","eligible_inbound","inbound_allocated","net_purchase_requirement","requested_quantity","on_hand_qty","reserved_qty","frozen_qty","inventory_available_qty","stock_allocated_to_active_plans_qty","unallocated_inventory_available_qty","effective_inbound_qty","inbound_allocated_to_active_plans_qty","unallocated_inbound_available_qty"]) assert.match(workspace,new RegExp(field));
  assert.match(workspace,/净采购 = max\(毛需求 - 快照库存分配 - 快照在途分配, 0\)/);assert.match(workspace,/库存可用 = Σ在手 - Σ正式预留 - Σ品质冻结/);assert.match(workspace,/数据库约束保证结果非负/);assert.match(workspace,/计划分配不计入正式库存预留/);
  assert.match(workspace,/模型没有“已到货但未完成入库”的独立数量字段/);assert.match(workspace,/模型未单独记录/);assert.match(workspace,/不会自动重算或改写 PRQ/);
  assert.match(workspace,/Package 接收/);assert.match(workspace,/PRQ 提交/);assert.match(workspace,/SUCCESS/);assert.match(workspace,/不会自动生成采购单据/);
  for (const field of ["decision_counts","package_accept_event","plan_generate_event","prq_submit_event","purchase_decision_event","decision_event","current_supply_observed_at","type","timezone"]) assert.match(workspace,new RegExp(field));
  assert.match(workspace,/接收事件数量/);assert.match(workspace,/退回事件数量/);assert.match(workspace,/不以状态或队列数量推断/);
  for (const text of ["采购决策凭证","业务事件类型","操作者","结果为成功，表示","不是计划交接包接收","采购交接状态","PRQ 状态","计算快照、行项目、分配及来源摘要仍不可变"]) assert.match(workspace,new RegExp(text));
  assert.match(workspace,/detail\.plan\.status/);assert.match(workspace,/request\.status/);assert.match(workspace,/isPurchaseDecisionEvidenceComplete/);assert.match(workspace,/data-purchase-decision-evidence="complete"/);
  assert.doesNotMatch(workspace,/服务端未返回操作者|服务端未返回操作时间/);assert.doesNotMatch(workspace,/result\.data\.accepted_by\s*\|\||result\.data\.returned_by\s*\|\|/);
  assert.doesNotMatch(workspace,/净需求为 0，不生成/);assert.match(workspace,/提交快照净采购为 0；未生成 PRQ/);assert.match(workspace,/未找到采购申请；请核验关系化提交事实/);
});

test("purchase decisions require confirmation and cancellation paths contain no business mutation", () => {
  assert.match(workspace,/PurchaseDecisionDialog/);assert.match(workspace,/decisionInFlight\.current/);assert.match(workspace,/event\.key === "Escape"/);assert.match(workspace,/event\.target === event\.currentTarget/);assert.match(workspace,/ref=\{cancelRef\}/);assert.match(workspace,/disabled=\{busy\}/);
  assert.match(workspace,/decisionRefreshInFlight\.current/);assert.match(workspace,/api<\{ data: RequestDetail \}>\(`\/api\/purchase-requests\/\$\{detail\.header\.id\}`\)/);assert.match(workspace,/正在重新读取当前供应/);assert.match(workspace,/已重新读取当前供应/);
  assert.match(workspace,/isPurchaseAcceptancePreviewComplete/);assert.match(workspace,/confirmDisabled=\{!complete\}/);assert.match(workspace,/资料不完整，禁止接收/);
  for (const heading of ["Package 接收完整凭证","计划生成完整凭证","PRQ 提交完整凭证","接收前显式决策计数","当前供应九项","供应公式与边界"]) assert.match(workspace,new RegExp(heading));
  for (const label of ["当前在手总量","当前正式预留量","当前品质冻结量","当前库存可用量","当前计划库存分配量","当前未分配库存可用量","当前有效在途总量","当前计划在途分配量","当前未分配在途可用量"]) assert.match(workspace,new RegExp(label));
  assert.match(workspace,/不修改交接包、计划、PRQ 明细、库存、正式预留或计划分配/);assert.match(workspace,/不自动创建 RFQ、报价、定标、PO、交付计划、收货单、库存流水、AP 或工单/);
  assert.match(workspace,/不修改原需求计划及提交时分配快照/);assert.match(workspace,/从已处理记录查看凭证/);assert.match(workspace,/Idempotency|createSessionWriteRegistry/);
  assert.match(workspace,/提交后的权威采购决策凭证未能完整读取/);assert.match(workspace,/禁止重试接收或退回/);assert.match(workspace,/<dt>结果<\/dt><dd>\{statusLabel\(event\.result\)\}<\/dd>/);
  assert.match(workspace,/request\.status === "SUBMITTED" && canDecide/);assert.match(workspace,/该 PRQ 已处理；关系化快照保持只读/);
  const closeBody=workspace.match(/const closeDecision[^;]+;/)?.[0]||"";assert.doesNotMatch(closeBody,/mutate|sessionPost|fetch|api\(/);
});

test("390px purchase layout keeps key quantities and units intact without page overflow", () => {
  assert.match(styles,/@media\(max-width:420px\)/);assert.match(styles,/\.planning-quantity\{[^}]*white-space:nowrap/);assert.match(styles,/\.purchase-supply-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(styles,/\.purchase-confirm-supply-cards article>dl\{grid-template-columns:1fr/);assert.match(styles,/max-width:100%/);assert.match(workspace,/purchase-line-cards/);assert.match(workspace,/purchase-supply-formulas/);assert.match(workspace,/data-current-supply-nine="complete"/);
});

test("dashboard exposes both native handoff queues", () => {
  assert.match(dashboard, /material-requirements/); assert.match(dashboard, /purchase-requests/); assert.match(dashboard, /pending_purchase_requests/); assert.match(dashboard, /accepted_planning_packages/);
});
