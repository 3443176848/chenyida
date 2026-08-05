import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../app/procurement/supplier-mappings/supplier-mapping-workspace.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/procurement/supplier-mappings/supplier-mappings.css", import.meta.url), "utf8");
const purchasePage = await readFile(new URL("../app/procurement/supplier-mappings/page.tsx", import.meta.url), "utf8");
const operationsPage = await readFile(new URL("../app/operations/supplier-mappings/page.tsx", import.meta.url), "utf8");
const sourcing = await readFile(new URL("../app/procurement/sourcing/sourcing-workspace.tsx", import.meta.url), "utf8");
const coverageStyles = await readFile(new URL("../app/procurement/sourcing/rfq-coverage.css", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");

test("native purchase mapping page exposes bounded stable-ID creation, draft editing, submission and complete history facts", () => {
  assert.match(purchasePage, /mode="manage"/);
  for (const text of [
    "新建映射", "保存草稿", "提交审核", "草稿、待审核、已生效与历史版本",
    "Supplier ID / 编码 / 名称", "Material ID / 正式编码 / 名称", "supplier_part_number", "状态",
    "Mapping {row.mapping_id}", "Version {row.mapping_version}", "Supplier / Internal Unit", "换算关系",
    "创建", "提交", "审核", "request_id", "Asia/Shanghai", "SUCCESS",
  ]) assert.match(workspace, new RegExp(text.replace(/[{}]/g, "\\$&")));
  assert.match(workspace, /\/api\/supplier-mappings\/options\?type=\$\{kind\}&limit=20/);
  assert.match(workspace, /<option value=\{option\.id\}/);
  assert.match(workspace, /ID \{option\.id\} \/ \{option\.code\} \/ \{option\.name\}/);
  assert.doesNotMatch(workspace, /find\([^\n]+supplier_name|find\([^\n]+standard_name/);
  for (const route of ["/api/supplier-mappings", "/draft", "/submit", "/versions"]) assert.match(workspace, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(workspace, /crypto\.randomUUID\(\)/);
  assert.match(workspace, /logoutSession\(session\.csrf_token\)/);
});

test("operations route provides filtered read-only review, server preview, explicit confirmation and durable receipt", () => {
  assert.match(operationsPage, /mode="review"/);
  assert.match(workspace, /\/api\/supplier-mappings\/review-queue\?page_size=100\$\{suffix\}/);
  assert.match(workspace, /正文已冻结且没有编辑入口/);
  assert.match(workspace, /mode === "manage" && row\.status === "DRAFT"/);
  assert.match(workspace, /mode === "review" && row\.status === "PENDING_REVIEW"/);
  assert.match(workspace, /onClick=\{\(\) => void openReview\(row, "approve"\)\}>批准并生效/);
  assert.match(workspace, /\/review-preview\?expected_version=/);
  assert.match(workspace, /审核意见（独立字段，必填）/);
  assert.match(workspace, /review_comment: comment/);
  assert.match(workspace, /event\.key === "Escape"/);
  assert.match(workspace, /aria-label="关闭审核窗口"/);
  assert.match(workspace, />取消<\/button>/);
  assert.match(workspace, /approvalBusyRef\.current/);
  assert.match(workspace, /服务端复核未通过，未发送批准请求/);
  for (const text of [
    "Mapping ID", "Version / CAS / 状态", "创建成功事实", "提交成功事实", "相同 Supplier / Material ACTIVE",
    "Supplier 内料号冲突", "批准推进语义", "RFQ 覆盖校验", "RFQ 0 / Quote 0 / Award 0 / PO 0",
    "批准成功凭证", "APPROVE", "Asia/Shanghai 时间", "审核意见", "批准前 Version / CAS", "批准后 Version / CAS",
    "历史批准未采集审核意见", "查看批准凭证",
  ]) assert.match(workspace, new RegExp(text.replaceAll("/", "\\/")));
  for (const text of ["Mapping ID", "Supplier ID / 编码 / 名称", "Material ID / 正式编码 / 名称", "supplier_part_number / 后缀", "状态"]) {
    assert.match(workspace, new RegExp(text.replaceAll("/", "\\/")));
  }
  assert.match(workspace, /mapping_id/);
  assert.match(workspace, /active_conflict_count/);
  assert.match(workspace, /\/reject/);
  assert.match(workspace, /退回原因（必填）/);
  assert.match(workspace, /required maxLength=\{500\}/);
  assert.doesNotMatch(operationsPage, /input|textarea|select/);
});

test("RFQ page shows full PRQ lines, per-supplier coverage and missing combinations, disabling incomplete suppliers", () => {
  for (const text of [
    "已接收采购申请与完整明细", "Material {line.material_id}", "Supplier Mapping 覆盖率",
    "覆盖 {row.covered_count}/{row.required_count}", "缺少组合", "Material {item.material_id}",
    "全部申请物料均有当前有效 1:1 Mapping",
  ]) assert.match(sourcing, new RegExp(text.replace(/[{}]/g, "\\$&")));
  assert.match(sourcing, /disabled=\{!row\.selectable\}/);
  assert.match(sourcing, /disabled=\{busy\|\|coverageBusy\|\|!suppliers\.some\(row=>row\.selectable\)\}/);
  assert.match(sourcing, /\/api\/procurement\/rfqs\/coverage\?purchase_request_id=/);
  assert.match(sourcing, /buildCreateRfqDraftRequest\(requests,suppliers/);
  assert.doesNotMatch(sourcing, /filter\([^\n]+status==="ACTIVE"[^\n]+supplier_ids/);
});

test("mapping and RFQ coverage layouts are bounded at 390px without page-level horizontal overflow", () => {
  assert.match(styles, /\.sm-shell\s*\{\s*overflow-x:\s*clip/);
  assert.match(styles, /min-width:\s*0/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(styles, /\.sm-dialog\s*\{[^}]*width:\s*min\(980px,100%\)/);
  assert.match(styles, /\.sm-dialog\s*\{[^}]*max-height:/);
  assert.match(styles, /\.sm-dialog-backdrop/);
  assert.match(coverageStyles, /min-width:\s*0/);
  assert.match(coverageStyles, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(workspace, /<table/);
});

test("dashboard publishes separate purchase maintenance and operations review entries", () => {
  for (const token of ["supplier-mappings", "supplier-mapping-review", "/procurement/supplier-mappings", "/operations/supplier-mappings"]) {
    assert.match(dashboard, new RegExp(token.replaceAll("/", "\\/")));
  }
});
