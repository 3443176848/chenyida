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

test("operations route renders a pending-only read-only queue with approve/reject and no review-body editor", () => {
  assert.match(operationsPage, /mode="review"/);
  assert.match(workspace, /mode === "review" \? "\/api\/supplier-mappings\/review-queue\?page_size=100"/);
  assert.match(workspace, /正文已冻结且没有编辑入口/);
  assert.match(workspace, /批准后 RFQ 才可使用/);
  assert.match(workspace, /mode === "manage" && row\.status === "DRAFT"/);
  assert.match(workspace, /mode === "review" && row\.status === "PENDING_REVIEW"/);
  assert.match(workspace, /\/approve/);
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
  assert.match(coverageStyles, /min-width:\s*0/);
  assert.match(coverageStyles, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(workspace, /<table/);
});

test("dashboard publishes separate purchase maintenance and operations review entries", () => {
  for (const token of ["supplier-mappings", "supplier-mapping-review", "/procurement/supplier-mappings", "/operations/supplier-mappings"]) {
    assert.match(dashboard, new RegExp(token.replaceAll("/", "\\/")));
  }
});
