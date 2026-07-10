import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production build contains the ERP application shell", async () => {
  const [worker, erpHtml] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/client/erp/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /src:\s*"\/erp\/index\.html"/i);
  assert.match(worker, /title:\s*"晨亿达 ERP"/i);
  assert.match(worker, /handleErpApi/);
  assert.match(erpHtml, /物料主数据治理工作台/);
  assert.doesNotMatch(worker, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships the complete ERP interface without starter metadata", async () => {
  const [page, layout, packageJson, erpHtml, erpScript, erpStyles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/erp\/index\.html/);
  assert.match(layout, /晨亿达 ERP/);
  assert.doesNotMatch(layout, /Starter Project|favicon\.svg/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(erpHtml, /物料主数据治理工作台/);
  assert.match(erpHtml, /初始化晨亿达 ERP/);
  assert.match(erpHtml, /账号与角色/);
  assert.doesNotMatch(erpHtml, /admin123|默认管理员/);
  assert.match(erpScript, /Idempotency-Key/);
  assert.match(erpScript, /setup_required/);
  assert.match(erpStyles, /@media \(max-width: 900px\)/);
  assert.ok(root);
});
