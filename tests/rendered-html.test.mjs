import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production build contains the ERP application shell", async () => {
  const [worker, erpHtml] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/client/erp/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /src:\s*"\/erp\/index\.html\?v=20260710-auth-flow"/i);
  assert.match(worker, /title:\s*"晨亿达 ERP"/i);
  assert.match(worker, /handleErpApi/);
  assert.match(erpHtml, /物料主数据治理工作台/);
  assert.doesNotMatch(worker, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships the complete ERP interface without starter metadata", async () => {
  const [page, layout, packageJson, erpHtml, erpScript, erpStyles, erpApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/erp-api.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/erp\/index\.html/);
  assert.match(layout, /晨亿达 ERP/);
  assert.doesNotMatch(layout, /Starter Project|favicon\.svg/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(erpHtml, /物料主数据治理工作台/);
  assert.match(erpHtml, /创建系统管理员/);
  assert.match(erpHtml, /账号与角色/);
  assert.match(erpHtml, /href="\.\/styles\.css\?v=20260710-auth-flow"/);
  assert.match(erpHtml, /src="\.\/app\.js\?v=20260710-auth-flow"/);
  assert.doesNotMatch(erpHtml, /(?:href|src)="\/(?:styles\.css|app\.js)"/);
  assert.doesNotMatch(erpHtml, /admin123|默认管理员/);
  assert.match(erpScript, /Idempotency-Key/);
  assert.match(erpScript, /setup_required/);
  assert.match(erpScript, /初始化完成，已进入系统/);
  assert.match(erpScript, /authenticated: true, user: result\.user, setup_required: false/);
  assert.match(erpApi, /authenticatedSessionResponse/);
  assert.match(erpApi, /"Set-Cookie": cookie/);
  assert.match(erpApi, /创建首位管理员并登录/);
  assert.match(erpStyles, /@media \(max-width: 900px\)/);
  assert.match(erpStyles, /\.login-card\[hidden\]/);
  assert.ok(root);
});
