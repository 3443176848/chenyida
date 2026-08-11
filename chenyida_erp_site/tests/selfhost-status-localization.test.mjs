import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROLE_LABELS, STATUS_LABELS, roleLabel, statusLabel, statusPairLabel } from "../public/erp/status-localization.js";

const legacy = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const workbench = await readFile(new URL("../app/_components/erp-workbench.tsx", import.meta.url), "utf8");
const sourcing = await readFile(new URL("../app/procurement/sourcing/sourcing-workspace.tsx", import.meta.url), "utf8");
const planning = await readFile(new URL("../app/planning/planning-workspace.tsx", import.meta.url), "utf8");
const supplierMappings = await readFile(new URL("../app/procurement/supplier-mappings/supplier-mapping-workspace.tsx", import.meta.url), "utf8");
const rfqDialog = await readFile(new URL("../app/procurement/sourcing/rfq-issue-dialog.tsx", import.meta.url), "utf8");
const normalization = await readFile(new URL("../app/materials/_components/material-import-normalization-review.tsx", import.meta.url), "utf8");
const production = await readFile(new URL("../app/production/work-orders/page.tsx", import.meta.url), "utf8");
const warehouse = await readFile(new URL("../app/warehouse/shipping/warehouse-shipping-workspace.tsx", import.meta.url), "utf8");
const finance = await readFile(new URL("../app/finance/settlements/finance-settlements-workspace.tsx", import.meta.url), "utf8");

test("shared status vocabulary localizes common ERP states without changing their codes", () => {
  const expected = {
    DRAFT: "草稿", ACTIVE: "已生效", PENDING_REVIEW: "待审核", SUBMITTED: "已提交",
    ACCEPTED: "已接收", RETURNED: "已退回", ISSUED: "已发出", INVITED: "待报价",
    RESPONDED: "已报价", REVERSED: "已冲销", SETTLED: "已结清", SUCCESS: "成功",
    VALID: "有效", WARNING: "警告", ERROR: "错误", VISIBLE: "可见",
    UNVERIFIED: "未验证", LEGACY_LOCAL_ONLY: "旧版仅本机校验", LOCAL_VERIFIED: "本机备份已校验",
    OFFHOST_VERIFIED: "异机接收已校验", RESTORE_VERIFIED: "隔离恢复证据有效",
    MATCHED: "匹配", MISMATCH: "不匹配", UNCONFIGURED: "未配置", INVALID: "验证证据无效", STALE: "已失效",
  };
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(STATUS_LABELS[code], label);
    assert.equal(statusLabel(code), label);
  }
  assert.equal(statusLabel("future_server_state"), "future_server_state");
  assert.equal(statusLabel(null), "—");
  assert.equal(statusPairLabel("OPEN/PENDING"), "处理中 / 待处理");
  assert.equal(statusPairLabel("DRAFT / 草稿 / 待发出"), "草稿 / 待发出");
});

test("roles shown in status bars use department names and retain unknown values", () => {
  assert.equal(ROLE_LABELS.admin, "管理员");
  assert.equal(roleLabel("purchase"), "采购");
  assert.equal(roleLabel("future_role"), "future_role");
});

test("native and legacy status surfaces consume the shared localization boundary", () => {
  assert.match(legacy, /status-localization\.js/);
  assert.match(legacy, /statusLabel\(/);
  assert.match(workbench, /roleLabel\(/);
  assert.match(sourcing, /statusLabel\(value\)/);
  assert.match(planning, /statusLabel\(value\)/);
  assert.match(supplierMappings, /statusLabel\(row\.supplier_status\)/);
  assert.match(rfqDialog, /statusLabel\(receipt\.result\)/);
  assert.match(normalization, /statusLabel\(detail\.row\.row_status\)/);
  assert.match(normalization, /option value="ERROR">错误/);
  assert.match(production, /statusLabel\(order\.status\)/);
  assert.match(warehouse, /statusLabel\(row\.header\.status\)/);
  assert.match(finance, /statusLabel\(row\.status\)/);
  assert.doesNotMatch(sourcing, /DRAFT:\s*"DRAFT \/ 草稿/);
});
