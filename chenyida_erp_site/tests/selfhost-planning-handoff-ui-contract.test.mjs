import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/planning/planning-workspace.tsx", import.meta.url), "utf8");
const planningCss = await readFile(new URL("../app/planning/planning.css", import.meta.url), "utf8");
const engineeringPage = await readFile(new URL("../app/engineering/projects/[projectId]/planning/page.tsx", import.meta.url), "utf8");
const planningPage = await readFile(new URL("../app/planning/handoffs/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");
const planningService = await readFile(new URL("../app/lib/planning-handoff-selfhost/service.ts", import.meta.url), "utf8");
const permissions = await readFile(new URL("../app/lib/identity-selfhost/permissions.ts", import.meta.url), "utf8");
const legacyOperations = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const apiClient = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");

test("engineering planning page resolves stable versions and shows immutable package history", () => {
  assert.match(engineeringPage, /EngineeringPlanningWorkspace/); assert.match(workspace, /需求明细解析/); assert.match(workspace, /Product.*BOM/s); assert.match(workspace, /零件规格快照/);
  assert.match(workspace, /生成交接包/); assert.match(workspace, /提交计划部/); assert.match(workspace, /交接包版本/); assert.match(workspace, /退回原因/);
  assert.match(workspace, /requirement_item_id/); assert.match(workspace, /product_version_id/); assert.match(workspace, /bom_version_id/); assert.match(workspace, /expected_version/);
});

test("engineering resolves each pending requirement with a versioned stable Unit ID", () => {
  assert.match(workspace, /enabled_units/);
  assert.match(workspace, /resolved_unit_id/);
  assert.match(workspace, /unit_resolution_id/);
  assert.match(workspace, /unit_resolution_version_no/);
  assert.match(workspace, /unit_resolution_head_version/);
  assert.match(workspace, /requirement-unit-resolutions/);
  assert.match(workspace, /requirement_item_id:row\.requirement_item_id,unit_id:unitId,expected_head_version/);
  assert.match(workspace, /<option value="">请选择有效单位<\/option>/);
  assert.match(workspace, /unit\.name} · {unit\.code}/);
  assert.match(workspace, /销售原始单位：{row\.unit_pending\?"待确认"/);
  assert.match(workspace, /不会改写销售原始需求/);
  assert.match(workspace, /不会从 BOM 推断单位/);
  assert.match(workspace, /Unit Resolution v/);
  assert.match(workspace, /ENGINEERING_CONFIRMED:"工程确认"/);
  assert.match(workspace, /REQUIREMENT_DECLARED:"销售需求声明"/);
  assert.doesNotMatch(workspace, /请选择有效单位[\s\S]{0,120}selected/);
});

test("package creation is gated by persisted Unit and Product BOM resolutions", () => {
  assert.match(workspace, /unitComplete\(row\)&&productBomComplete\(row\)&&!unitChoiceDirty\(row\)&&!productChoiceDirty\(row\)/);
  assert.match(workspace, /row\.unit_resolution_id&&row\.unit_resolution_version_no&&row\.resolved_unit_id&&unitById\.has/);
  assert.match(workspace, /单位（当前选择尚未保存）/);
  assert.match(workspace, /Product \/ BOM（当前选择尚未保存）/);
  assert.match(workspace, /Product \/ BOM（当前解析已失效，需重新选择并保存）/);
  assert.match(workspace, /candidate&&Number\(candidate\.product_id\)===Number\(row\.product_id\)&&Number\(candidate\.product_version_id\)===Number\(row\.product_version_id\)&&Number\(candidate\.bom_header_id\)===Number\(row\.bom_header_id\)/);
  assert.match(workspace, /生成交接包前仍需完成/);
  assert.match(workspace, /第 \$\{row\.line_no} 行/);
  assert.match(workspace, /本地选择尚未保存时不会计入交接完整性/);
  assert.match(workspace, /disabled={busy\|\|!allPersistedResolutionsComplete}/);
  assert.match(workspace, /单位：{unitIsComplete\?"已完成":"未完成"}/);
  assert.match(workspace, /Product \/ BOM：{productIsComplete\?"已完成":"未完成"}/);
});

test("planning workspace keeps narrow screens contained and switches materials to cards", () => {
  assert.match(planningCss, /@media\(max-width:420px\)/);
  assert.match(planningCss, /@media\(max-width:900px\)\{\.planning-resolution\{grid-template-columns:1fr\}/);
  assert.match(planningCss, /\.planning-shell\{box-sizing:border-box;width:100%;max-width:100%\}/);
  assert.doesNotMatch(planningCss, /\.planning-shell\{[^}]*overflow-x:hidden/);
  assert.match(planningCss, /@media\(max-width:600px\)\{[\s\S]*?\.planning-material-table\{display:none\}/);
  assert.match(planningCss, /\.planning-material-cards\{display:grid/);
  assert.match(planningCss, /\.planning-trace-value\{[^}]*overflow-wrap:anywhere/);
  assert.match(planningCss, /\.planning-dialog\{[^}]*width:min\(560px,100%\)/);
  assert.match(planningCss, /@media\(max-width:420px\)[\s\S]*?\.planning-dialog-actions\{[^}]*flex-direction:column/);
  assert.match(planningCss, /\.planning-row-reason\{[^}]*overflow-wrap:anywhere/);
  assert.match(workspace, /className="planning-material-cards"/);
  assert.match(workspace, /className="planning-table-scroll planning-material-table"/);
  assert.match(workspace, /系统管理员/);
  assert.match(workspace, /工程人员/);
  assert.doesNotMatch(workspace, /<span>{user\.role}<\/span>/);
});

test("planning page has pending and processed queues with confirmed decisions and read-only history", () => {
  assert.match(planningPage, /PlanningHandoffWorkspace/); assert.match(workspace, /待接收交接包/); assert.match(workspace, /已处理交接包/); assert.match(workspace, /status=PROCESSED/); assert.match(planningService, /wanted === "PROCESSED" \? \["RETURNED", "ACCEPTED"\]/);
  assert.match(workspace, /接收交接包/); assert.match(workspace, /退回原因/); assert.match(workspace, /确认接收交接包/); assert.match(workspace, /确认退回工程\/项目部修订/); assert.match(workspace, /确认后将写入不可变 RETURN 事件/); assert.match(workspace, /确认后将写入不可变 ACCEPT 事件/);
  assert.match(workspace, /操作完成凭证/); assert.match(workspace, /查看已处理详情/); assert.match(workspace, /数据库保存的退回原因/); assert.match(workspace, /result:"SUCCESS"/);
  assert.match(workspace, /calculated_gross_quantity/); assert.match(workspace, /specification_snapshot/); assert.match(workspace, /package_digest/); assert.match(workspace, /sessionPost/); assert.match(workspace, /createSessionWriteRegistry/); assert.match(workspace, /useEffect\(.*load/s);
  assert.match(apiClient, /planningWrite/); assert.match(apiClient, /currentCsrfToken/); assert.match(apiClient, /credentials: "same-origin"/); assert.match(apiClient, /X-CSRF-Token/); assert.match(apiClient, /Idempotency-Key/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage|relative_path|absolute_path|storage_name|file_body/);
  assert.doesNotMatch(permissions.match(/planning:\s*\[[^\]]*\]/s)?.[0]||"", /system\.audit\.read/);
});

test("planning detail exposes scoped traceability, fixed units and explicit current evidence", () => {
  assert.match(workspace, /Package 稳定 ID/);
  assert.match(workspace, /Package Version/);
  assert.match(workspace, /Package 完整摘要/);
  assert.match(workspace, /未指定具体接收人/);
  assert.match(workspace, /未配置处理时限/);
  assert.match(workspace, /trace_events\.map/);
  assert.match(workspace, /创建交接包/);
  assert.match(workspace, /提交计划部/);
  assert.match(workspace, /RETURN:"退回工程\/项目部修订"/);
  assert.match(workspace, /event\.action/);
  assert.match(workspace, /event\.result/);
  assert.match(workspace, /SUCCESS ·/);
  assert.match(workspace, /请求号/);
  assert.match(workspace, /Asia\/Shanghai/);
  assert.doesNotMatch(workspace, /new Date\(event\.created_at\)\.toLocaleString/);
  assert.match(workspace, /Product 稳定 ID/);
  assert.match(workspace, /Product Version 稳定 ID/);
  assert.match(workspace, /BOM 稳定 ID/);
  assert.match(workspace, /BOM Version 稳定 ID/);
  assert.match(workspace, /非生成时状态快照/);
  assert.match(workspace, /销售原始单位/);
  assert.match(workspace, /工程正式解析/);
  assert.match(workspace, /Unit Resolution ID/);
  assert.match(workspace, /固定引用的 Unit Resolution/);
  assert.match(workspace, /没有改写销售原始需求/);
  assert.match(workspace, /Material ID/);
  assert.match(workspace, /compactNumber\(line\.quantity_per\)} {line\.unit_code}/);
  assert.match(workspace, /退回工程\/项目部修订/);
  assert.match(workspace, /接收和退回按钮已停用并隐藏/);
  const packageView = workspace.slice(workspace.indexOf("function PackageView"));
  assert.doesNotMatch(packageView, /<input|<select/);
});

test("dashboard preserves the TASK02 queue while its package workspace stays upstream-only", () => {
  assert.match(dashboard, /计划部门/); assert.match(dashboard, /\/planning\/handoffs/); assert.match(dashboard, /pending_planning_handoffs/);
  assert.match(legacyOperations, /option value="planning">计划/);
  assert.doesNotMatch(workspace, /创建采购申请|创建采购订单|净需求计算|供应商推荐/);
});
