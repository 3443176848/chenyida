import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");

test("legacy quality panel exposes stable-source and controlled lifecycle workflow", () => {
  for (const value of ["IQC", "IPQC", "FQC", "稳定来源", "处理中、待处理", "追加缺陷", "执行处置", "关闭", "重开（经理）", "已关闭、已放行"]) assert.match(html, new RegExp(value.replace(/[()]/g, "\\$&")));
  assert.doesNotMatch(html, /检验员<input/); assert.match(html, /id="failedQty"/); assert.match(app, /\/api\/quality\/source-options\?inspection_type=/); assert.match(app, /allocation_id: row\.allocation_id/); assert.doesNotMatch(app, /type === "IPQC"[^\n]+production_completion_line_id/); assert.doesNotMatch(app, /Number\(\$\("#inspectionQty"\)/); assert.match(app, /const hasFailure = !\/\^0/);
});

test("quality writes use frozen idempotent body, csrf and stable endpoints", () => {
  assert.match(app, /qualityOperations: new Map/); assert.match(app, /qualityWrite\(/); assert.match(app, /protectedWrite: \{ idempotencyKey: operation\.key, csrfToken:/);
  for (const endpoint of ["/defects", "/dispositions", "/close", "/reopen"]) assert.ok(app.includes(endpoint));
  assert.match(client, /const qualityWrite =/); assert.match(client, /quality-inspections/); assert.match(client, /qualityWrite\)/);
});
