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
  assert.match(planningCss, /\.planning-dialog\{display:flex;flex-direction:column;overflow:hidden;padding:0\}/);
  assert.match(planningCss, /\.planning-dialog-body\{[^}]*overflow-y:auto/);
  assert.match(planningCss, /\.planning-dialog-actions\{[^}]*flex:0 0 auto/);
  assert.match(planningCss, /\.planning-handoff-dialog,\.planning-resubmit-dialog\{width:min\(780px,100%\)/);
  assert.match(planningCss, /\.planning-confirm-digest code\{[^}]*overflow-wrap:anywhere/);
  assert.match(planningCss, /\.planning-row-reason\{[^}]*overflow-wrap:anywhere/);
  assert.match(workspace, /className="planning-material-cards"/);
  assert.match(workspace, /className="planning-table-scroll planning-material-table"/);
  assert.match(workspace, /roleLabel\(user\.role,"受控业务人员"\)/);
  assert.doesNotMatch(workspace, /<span>{user\.role}<\/span>/);
});

test("planning page has pending and processed queues with confirmed decisions and read-only history", () => {
  assert.match(planningPage, /PlanningHandoffWorkspace/); assert.match(workspace, /待接收交接包/); assert.match(workspace, /已处理交接包/); assert.match(workspace, /status=PROCESSED/); assert.match(planningService, /wanted === "PROCESSED" \? \["RETURNED", "ACCEPTED"\]/);
  assert.match(workspace, /接收交接包/); assert.match(workspace, /退回原因/); assert.match(workspace, /确认最终接收 Package/); assert.match(workspace, /确认退回工程\/项目部修订/); assert.match(workspace, /写入一条不可变退回事件/); assert.match(workspace, /写入一条不可变接收事件/);
  assert.match(workspace, /操作完成凭证/); assert.match(workspace, /查看已处理详情/); assert.match(workspace, /数据库保存的退回原因/); assert.match(workspace, /result:"SUCCESS"/);
  assert.match(workspace, /calculated_gross_quantity/); assert.match(workspace, /specification_snapshot/); assert.match(workspace, /package_digest/); assert.match(workspace, /sessionPost/); assert.match(workspace, /createSessionWriteRegistry/); assert.match(workspace, /useEffect\(.*load/s);
  assert.match(apiClient, /planningWrite/); assert.match(apiClient, /currentCsrfToken/); assert.match(apiClient, /credentials: "same-origin"/); assert.match(apiClient, /X-CSRF-Token/); assert.match(apiClient, /Idempotency-Key/);
  assert.doesNotMatch(workspace, /crypto\.randomUUID/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage|relative_path|absolute_path|storage_name|file_body/);
  assert.doesNotMatch(permissions.match(/planning:\s*\[[^\]]*\]/s)?.[0]||"", /system\.audit\.read/);
});

test("final ACCEPT confirmation carries immutable v2 lineage, consequences and the authoritative next stage", () => {
  for (const text of [
    "当前目标", "完整 Package SHA-256 摘要", "提交人", "重新提交时间",
    "前驱退回", "退回事件", "退回操作者", "退回时间", "完整退回原因",
    "工程回复", "回复操作者", "回复时间", "完整回复正文",
    "固定快照摘要", "Product", "BOM", "Unit Resolution", "毛需求",
    "本确认窗口内容来自不可变", "接收后果", "写入一条不可变接收事件",
    "继续保持已退回", "当前版本不再允许退回或重复接收",
    "不自动创建采购申请、工单、库存或财务记录",
    "下一业务阶段：计划部门基于已接收的Package v", "进行物料需求计算和缺料分析，随后通过独立操作形成采购需求交接。",
    "当前未指定具体处理人。", "当前未配置处理时限。", "接收本身不会自动执行下一阶段。",
  ]) assert.ok(workspace.includes(text), `missing ACCEPT confirmation text: ${text}`);
  assert.match(workspace, /setDecisionPrompt\(\{kind,reason:normalizedReason,detail\}\)/);
  assert.match(workspace, /const currentDetail=prompt\.detail/);
  assert.match(workspace, /decisionInFlight\.current/);
  assert.match(workspace, /detail\.header\.status!=="SUBMITTED"/);
  assert.match(workspace, /expected_version:currentDetail\.header\.version/);
});

test("Engineering RESUBMIT confirmation carries the fixed source, response, target and queue consequence", () => {
  for (const text of [
    "确认重新提交 Package", "源 Package", "退回事件", "完整退回原因", "工程回复",
    "目标 Package", "固定快照摘要", "Product", "BOM", "Unit Resolution", "毛需求",
    "写入一条不可变重新提交事件", "转为已提交", "提交后进入计划部待接收队列",
    "不自动创建采购申请、工单、库存或财务等下游业务记录", "重新提交完成凭证",
    "下一队列：计划部待接收队列",
  ]) assert.ok(workspace.includes(text), `missing RESUBMIT confirmation text: ${text}`);
  assert.match(workspace, /setResubmitPrompt\(\{detail:target\}\)/);
  assert.match(workspace, /const target=resubmitPrompt\.detail/);
  assert.match(workspace, /resubmitInFlight\.current/);
  assert.match(workspace, /target\.header\.status!=="DRAFT"/);
  assert.match(workspace, /target\.header\.package_version_no<=1/);
  assert.match(workspace, /expected_version:target\.header\.version/);
});

test("decision dialogs default to cancel and trap keyboard focus without weakening server gates", () => {
  assert.match(workspace, /role="dialog" aria-modal="true" aria-labelledby={dialogId}/);
  assert.match(workspace, /requestAnimationFrame\(\(\)=>cancelRef\.current\?\.focus\(\)\)/);
  assert.match(workspace, /event\.key==="Escape"/);
  assert.match(workspace, /event\.key!=="Tab"/);
  assert.match(workspace, /aria-label="关闭确认窗口"/);
  assert.match(workspace, /event\.target===event\.currentTarget&&!busy/);
  assert.match(workspace, /disabled={busy}/);
  assert.match(workspace, /sessionPost/);
  assert.match(planningService, /expected_version|expectedVersion/);
  for (const gate of ["planning.accept", "planning.prepare"]) assert.ok(workspace.includes(gate));
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
  assert.match(workspace, /成功 ·/);
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

test("returned engineering detail saves a versioned reply before creating an immutable successor lineage", () => {
  assert.match(workspace, /工程修订回复/);
  assert.match(workspace, /revision-responses/);
  assert.match(workspace, /expected_head_version/);
  assert.match(workspace, /response_head_version/);
  assert.match(workspace, /保存新的回复版本/);
  assert.match(workspace, /生成 v\{detail\.header\.package_version_no\+1\}/);
  assert.match(workspace, /previous_package_id/);
  assert.match(workspace, /responds_to_return_event_id/);
  assert.match(workspace, /revision_response_version_id/);
  assert.match(workspace, /v\{lineage\.previous_package_version_no\} → 计划部退回 → 工程回复 → v/);
  assert.match(workspace, /当前输入尚未保存/);
  assert.match(workspace, /固定复用（只读）/);
  assert.match(workspace, /不会自动提交计划部/);
  assert.match(workspace, /Number\(row\.id\)===requested/);
  assert.match(workspace, /Unicode NFC 与 LF/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
});

test("revision response and successor confirmation remain contained at 390px", () => {
  assert.match(planningCss, /\.planning-revision-editor textarea\{[^}]*min-height/);
  assert.match(planningCss, /\.planning-response-body>p\{[^}]*white-space:pre-wrap/);
  assert.match(planningCss, /\.planning-successor-dialog\{width:min\(720px,100%\)/);
  assert.match(planningCss, /@media\(max-width:420px\)[\s\S]*?\.planning-revision-editor textarea/);
  assert.match(planningCss, /@media\(max-width:600px\)[\s\S]*?\.planning-lineage-flow\{display:grid/);
  assert.match(planningCss, /overflow-wrap:anywhere/);
});

test("dashboard preserves the TASK02 queue while its package workspace stays upstream-only", () => {
  assert.match(dashboard, /计划部门/); assert.match(dashboard, /\/planning\/handoffs/); assert.match(dashboard, /pending_planning_handoffs/);
  assert.match(legacyOperations, /option value="planning">计划/);
  assert.doesNotMatch(workspace, /<button[^>]*>创建(?:采购申请|采购订单)|净需求计算|供应商推荐/);
  assert.doesNotMatch(workspace, /material-requirement-plans|planning-purchase-requests/);
});
