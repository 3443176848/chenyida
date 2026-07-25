import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");

test("legacy finance panel uses posted stable sources and immutable reversal workflow", () => {
  for (const label of ["稳定金额来源", "发货金额来源", "收货金额来源", "不可变收付款", "全额冲销", "当前登录账号"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /id="arAmount"|id="apAmount"|id="paymentHandler"/); assert.match(app, /\/api\/finance\/source-options\?document_type=AR/); assert.match(app, /source_entry_id/); assert.doesNotMatch(app, /total_amount:\s*amount|created_by:\s*"财务员"/);
});
test("finance writes freeze request body and require idempotency plus csrf", () => {
  assert.match(app, /financeOperations: new Map/); assert.match(app, /financeWrite\(/); assert.match(app, /protectedWrite: \{ idempotencyKey: operation\.key, csrfToken:/); assert.match(app, /finance-settlements\/\$\{settlementId\}\/reversal/);
  assert.match(client, /const financeWrite =/); assert.match(client, /financial-documents\/from-source/); assert.match(client, /finance-settlements/);
});
