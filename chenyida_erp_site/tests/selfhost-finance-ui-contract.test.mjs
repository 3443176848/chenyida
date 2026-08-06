import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const settlements = await readFile(new URL("../app/finance/settlements/finance-settlements-workspace.tsx", import.meta.url), "utf8");
const projects = await readFile(new URL("../app/finance/projects/finance-projects-workspace.tsx", import.meta.url), "utf8");

test("legacy finance panel uses posted stable sources and immutable reversal workflow", () => {
  for (const label of ["稳定金额来源", "发货金额来源", "收货金额来源", "不可变收付款", "全额冲销", "当前登录账号"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /id="arAmount"|id="apAmount"|id="paymentHandler"/); assert.match(app, /\/api\/finance\/source-options\?document_type=AR/); assert.match(app, /source_entry_id/); assert.doesNotMatch(app, /total_amount:\s*amount|created_by:\s*"财务员"/);
});
test("native TASK10 workspaces keep settlement and project facts server authoritative", () => {
  for (const token of ["/api/finance/settlements", "settlement_type", "expected_version", "idempotencyKey", "内部记账账户标签", "不连接真实银行", "受控全额冲销"]) assert.match(settlements, new RegExp(token));
  assert.doesNotMatch(settlements, /body:\s*JSON\.stringify\([^)]*(customer_id|supplier_id|currency_code)/s);
  for (const token of ["/api/finance/projects", "unattributed_amount", "未归属", "禁止跨币种聚合", "不是毛利、净利润或会计利润", "未收款 AR 不作为现金收入"]) assert.match(projects, new RegExp(token));
  assert.doesNotMatch(projects, /method:\s*["']POST/);
});
test("finance writes freeze request body and require idempotency plus csrf", () => {
  assert.match(app, /financeOperations: new Map/); assert.match(app, /financeWrite\(/); assert.match(app, /protectedWrite: \{ idempotencyKey: operation\.key, csrfToken:/); assert.match(app, /finance-settlements\/\$\{settlementId\}\/reversal/);
  assert.match(client, /const financeWrite =/); assert.match(client, /financial-documents\/from-source/); assert.match(client, /finance-settlements/);
});
