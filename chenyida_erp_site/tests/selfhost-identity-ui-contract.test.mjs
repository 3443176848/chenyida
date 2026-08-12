import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isHistorySessionRestore } from "../public/erp/api-client.js";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const workbench = await readFile(new URL("../app/_components/erp-workbench.tsx", import.meta.url), "utf8");
const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const materialShell = await readFile(new URL("../app/materials/_components/material-shell.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const legacyStyles = await readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
const legacyShellRoute = await readFile(new URL("../app/erp-shell/route.ts", import.meta.url), "utf8");

test("identity forms use alpha.2 field names, expected versions, CSRF and idempotency", () => {
  assert.match(app, /temporary_password/);
  assert.match(app, /expected_version: state\.session\.user\.version/);
  assert.match(app, /expected_version: version/);
  assert.match(app, /protectedWrite: \{ idempotencyKey: operation\.key, csrfToken: state\.session\.csrf_token/);
  assert.doesNotMatch(app, /body: JSON\.stringify\(\{ username, password \}\)/);
});

test("unknown identity results retain only page-memory operation context", () => {
  assert.match(app, /identityOperations: new Map\(\)/);
  assert.match(app, /if \(!error\.resultUnknown\) state\.identityOperations\.delete/);
  assert.match(app, /上一次操作结果尚未确认，只能使用原请求安全重试/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});

test("stable identity errors and must-change flow coexist with read-only operations APIs", () => {
  assert.match(client, /PASSWORD_CHANGE_REQUIRED/);
  assert.match(client, /Retry-After/);
  assert.match(app, /result\.user\.must_change_password/);
  assert.match(app, /session\.user\.must_change_password/);
  assert.match(app, /api\("\/api\/management-dashboard"\)/);
  assert.match(app, /备份创建和任务自建的一次性 TEST 数据库恢复只允许受控离线 CLI；浏览器不提供写操作/);
  assert.doesNotMatch(app, /function (?:createBackup|restoreBackup)/);
});

test("passwords and tokens are not written to URLs, logs or browser storage", () => {
  assert.doesNotMatch(app, /console\.(?:log|info|warn|error)\([^)]*(?:password|token)/i);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.doesNotMatch(app, /URLSearchParams\([^)]*(?:password|token)/i);
});

test("both workbenches share the same fail-visible secure logout helper", () => {
  assert.match(client, /export async function logoutSession\(csrfToken\)/);
  assert.match(client, /api\("\/api\/logout",\s*\{[\s\S]*method: "POST"[\s\S]*protectedWrite: \{ csrfToken \}/);
  assert.match(client, /credentials: "same-origin"/);
  assert.equal((client.match(/api\("\/api\/logout"/g) || []).length, 1);
  for (const source of [app, workbench]) {
    assert.match(source, /logoutSession\(/);
    assert.match(source, /location\.replace\("\/"\)/);
    assert.doesNotMatch(source, /api\("\/api\/logout"/);
    assert.doesNotMatch(source, /logout[\s\S]{0,250}\.catch\(\(\)=>null\)/);
  }
  assert.match(app, /退出失败：\$\{identityErrorText\(error\)\}/);
  assert.match(workbench, /退出失败：\$\{explain\(reason\)\}/);
  assert.match(html, /id="toast"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(workbench, /role="alert"/);
});

test("history restore detection covers pageshow persisted and back_forward without disabling history", () => {
  assert.equal(isHistorySessionRestore({ persisted: true }, { type: "navigate" }), true);
  assert.equal(isHistorySessionRestore({ persisted: false }, { type: "back_forward" }), true);
  assert.equal(isHistorySessionRestore({ persisted: false }, { type: "navigate" }), false);
  assert.equal(isHistorySessionRestore({ persisted: false }, { type: "reload" }), false);
  assert.match(client, /path === "\/api\/session" \? "no-store"/);
  assert.doesNotMatch(client, /addEventListener\("unload"|history\.(?:go|back|forward)\(/);
});

test("root, material and legacy shells conceal pagehide snapshots and revalidate pageshow restores", () => {
  for (const source of [workbench, materialShell, app]) {
    assert.match(source, /pagehide/);
    assert.match(source, /pageshow/);
    assert.match(source, /isHistorySessionRestore/);
    assert.match(source, /suspendProtectedViews|suspendLegacyProtectedView/);
    assert.match(source, /\/api\/session/);
  }
  assert.match(html, /data-cyd-auth-state="checking"/);
  assert.match(html, /class="topbar" data-cyd-protected-view/);
  assert.match(html, /class="layout" data-cyd-protected-view/);
  assert.match(html, /id="loginOverlay" class="login-overlay">/);
  assert.match(globals, /data-cyd-auth-state="checking"[^}]*visibility:hidden/);
  assert.match(legacyStyles, /data-cyd-auth-state="anonymous"[^}]*visibility: hidden/);
  for (const route of ['"/"', '"/materials/:path*"', '"/erp/index.html"']) assert.match(nextConfig, new RegExp(route.replace(/[/*]/g, "\\$&")));
  assert.match(nextConfig, /private, no-store, max-age=0, must-revalidate/);
  assert.match(nextConfig, /Pragma/);
  assert.match(proxy, /matcher: \["\/erp\/index\.html"\]/);
  assert.match(proxy, /target\.pathname = "\/erp-shell"/);
  assert.match(legacyShellRoute, /join\(process\.cwd\(\), "public", "erp", "index\.html"\)/);
  assert.match(legacyShellRoute, /private, no-store, max-age=0, must-revalidate/);
  assert.doesNotMatch(legacyShellRoute, /public, max-age/);
});

test("legacy protected-state cleanup erases BOM selector text and stable IDs before logout or history restore", () => {
  const clear = app.match(/function clearLegacyProtectedState\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  for (const selector of ["#lineItemSearch", "#lineItem", "#lineUnitId", "#lineUom", "#lineItemSelected", "#lineItemSearchStatus", "#lineItemResults"]) assert.ok(clear.includes(selector), selector);
  assert.match(clear, /bomMaterialSearchController\?\.abort\(\)/);
  assert.match(clear, /bomLinesRequestToken \+= 1/);
  assert.match(app, /async function logout\(\)[\s\S]*clearLegacyProtectedState\(\);[\s\S]*location\.replace\("\/"\)/);
  assert.match(app, /async function revalidateRestoredSession[\s\S]*clearLegacyProtectedState\(\)/);
});

test("legacy reveals protected DOM only after a complete authenticated refresh", () => {
  assert.match(app, /async function refreshAndRevealLegacy\(\) \{[\s\S]*await refreshAll\(\);[\s\S]*hideLogin\(\);[\s\S]*\}/);
  assert.match(app, /async function revalidateRestoredSession[\s\S]*await refreshAndRevealLegacy\(\);[\s\S]*catch \(error\) \{[\s\S]*clearLegacyProtectedState\(\);[\s\S]*showLogin\(\);[\s\S]*return;/);
  assert.match(app, /async function initApp[\s\S]*loadSession\(\{ revealAuthenticated: false \}\)/);
  for (const name of ["login", "setupSystem"]) {
    const block = app.match(new RegExp(`async function ${name}\\(.*?(?=\\nasync function )`, "s"))?.[0] || "";
    assert.match(block, /suspendLegacyProtectedView\(\);[\s\S]*clearLegacyProtectedState\(\);/);
    assert.match(block, /await refreshAndRevealLegacy\(\)/);
    assert.doesNotMatch(block, /hideLogin\(\)/);
  }
});

test("user creation presents stable identity code and request context", () => {
  assert.match(app, /createUserMsg"\)\.textContent = identityErrorText\(error\)/);
  assert.match(app, /error\.code/);
  assert.match(app, /error\.requestId/);
});
