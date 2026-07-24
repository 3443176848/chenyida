import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");

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

test("new stable errors and must-change flow are handled without loading missing dashboard APIs", () => {
  assert.match(client, /PASSWORD_CHANGE_REQUIRED/);
  assert.match(client, /Retry-After/);
  assert.match(app, /result\.user\.must_change_password/);
  assert.match(app, /session\.user\.must_change_password/);
  assert.match(app, /自托管经营看板尚未迁移/);
  assert.match(app, /自托管备份 API 尚未迁移/);
});

test("passwords and tokens are not written to URLs, logs or browser storage", () => {
  assert.doesNotMatch(app, /console\.(?:log|info|warn|error)\([^)]*(?:password|token)/i);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.doesNotMatch(app, /URLSearchParams\([^)]*(?:password|token)/i);
});
