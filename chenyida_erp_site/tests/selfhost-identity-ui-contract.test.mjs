import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const workbench = await readFile(new URL("../app/_components/erp-workbench.tsx", import.meta.url), "utf8");
const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");

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
  assert.match(app, /备份创建和新空目标恢复只允许受控离线 CLI；浏览器不提供写操作/);
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

test("user creation presents stable identity code and request context", () => {
  assert.match(app, /createUserMsg"\)\.textContent = identityErrorText\(error\)/);
  assert.match(app, /error\.code/);
  assert.match(app, /error\.requestId/);
});
