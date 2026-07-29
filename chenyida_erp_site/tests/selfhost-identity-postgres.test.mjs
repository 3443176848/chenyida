import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { closeDb } from "../db/index.ts";
import { handleSelfhostIdentityApi } from "../app/lib/identity-selfhost/handler.ts";
import { handleSelfhostApi } from "../app/lib/selfhost-api.ts";

const databaseUrl = process.env.TEST_IDENTITY_DATABASE_URL;
if (!databaseUrl || !/test/i.test(databaseUrl)) throw new Error("isolated TEST_IDENTITY_DATABASE_URL containing test is required");
process.env.DATABASE_URL = databaseUrl;
process.env.ERP_ENV = "test";
process.env.ERP_SETUP_TOKEN = "identity-test-setup-token-value";
process.env.ERP_PUBLIC_ORIGIN = "";
process.env.ERP_DEPLOYMENT_CLASS = "test";
process.env.ERP_UAT_ALLOW_LOOPBACK_ORIGIN = "false";
const pool = new Pool({ connectionString: databaseUrl, max: 20, application_name: "identity-security-integration-test" });

const passwords = {
  admin: "River!4826Stone",
  temporary: "Copper!5821Wave",
  changed: "Forest#7152Peak",
  secondAdmin: "Harbor!6382Cloud",
  secondChanged: "Meadow#7193Light",
};

function jar() { return {}; }

function applyCookies(response, cookieJar) {
  for (const value of response.headers.getSetCookie()) {
    const [pair] = value.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const content = pair.slice(index + 1);
    if (/Max-Age=0/i.test(value)) delete cookieJar[name];
    else cookieJar[name] = content;
  }
}

async function api(path, { method = "GET", body, cookieJar = jar(), key, csrf = true, origin = true, requestOrigin = "http://local.test", full = false } = {}) {
  const headers = new Headers({ "X-Request-ID": randomUUID() });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (Object.keys(cookieJar).length) headers.set("Cookie", Object.entries(cookieJar).map(([name, value]) => `${name}=${value}`).join("; "));
  if (origin) headers.set("Origin", typeof origin === "string" ? origin : new URL(requestOrigin).origin);
  if (csrf && cookieJar.CYD_ERP_CSRF) headers.set("X-CSRF-Token", typeof csrf === "string" ? csrf : cookieJar.CYD_ERP_CSRF);
  if (key) headers.set("Idempotency-Key", key);
  const request = new Request(`${requestOrigin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = full ? await handleSelfhostApi(request) : await handleSelfhostIdentityApi(request, { pool, requestId: headers.get("X-Request-ID") });
  assert.ok(response, `route not handled: ${method} ${path}`);
  applyCookies(response, cookieJar);
  const payload = await response.json();
  return { response, payload, jar: cookieJar };
}

async function setupAdmin(username = "rootadmin", password = passwords.admin) {
  const cookieJar = jar();
  const result = await api("/api/setup", { method: "POST", cookieJar, body: { setup_token: process.env.ERP_SETUP_TOKEN, username, display_name: "系统管理员", password } });
  assert.equal(result.response.status, 201);
  return { cookieJar, user: result.payload.user, csrf: result.payload.csrf_token };
}

async function createUser(adminJar, overrides = {}, key = randomUUID()) {
  return api("/api/users", {
    method: "POST", cookieJar: adminJar, key,
    body: { username: "buyer01", display_name: "采购员", role: "purchase", temporary_password: passwords.temporary, ...overrides },
  });
}

async function login(username, password, cookieJar = jar()) {
  return api("/api/login", { method: "POST", cookieJar, body: { username, password } });
}

async function resetDatabase() {
  await pool.query(`
    truncate identity_write_rate_limit_buckets,identity_login_failures,idempotency_keys,audit_log,app_sessions,app_users,app_meta restart identity cascade
  `);
}

test.beforeEach(resetDatabase);
test.after(async () => { await pool.end(); await closeDb(); });

test("setup, login failures, persistent rate limit and Retry-After are safe", async () => {
  const admin = await setupAdmin();
  const session = await api("/api/session", { cookieJar: admin.cookieJar });
  assert.equal(session.payload.authenticated, true); assert.equal(session.payload.user.role, "admin");
  for (let index = 0; index < 5; index += 1) {
    const failed = await login("missing01", "Wrong!4826Stone");
    assert.equal(failed.response.status, 401); assert.equal(failed.payload.code, "LOGIN_FAILED");
  }
  const limited = await login("missing01", "Wrong!4826Stone");
  assert.equal(limited.response.status, 429); assert.equal(limited.payload.code, "RATE_LIMITED");
  assert.ok(Number(limited.response.headers.get("Retry-After")) >= 1);
  const audit = await pool.query("select action,target_username,detail::text from audit_log where action in ('LOGIN_FAILED','LOGIN_RATE_LIMITED') order by id");
  assert.equal(audit.rowCount, 6); assert.ok(audit.rows.every((row) => !/Wrong|password|token/i.test(row.detail)));
});

test("create, first-login must-change, own password change and multi-session revocation", async () => {
  const admin = await setupAdmin();
  const created = await createUser(admin.cookieJar, {}, "create-buyer-identity-0001");
  assert.equal(created.response.status, 201); assert.equal(created.payload.user.must_change_password, true); assert.equal(created.payload.user.version, 1);
  const replay = await createUser(admin.cookieJar, {}, "create-buyer-identity-0001");
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const conflict = await createUser(admin.cookieJar, { display_name: "不同姓名" }, "create-buyer-identity-0001");
  assert.equal(conflict.response.status, 409); assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const firstJar = jar(); const secondJar = jar();
  assert.equal((await login("buyer01", passwords.temporary, firstJar)).response.status, 200);
  assert.equal((await login("buyer01", passwords.temporary, secondJar)).response.status, 200);
  const blocked = await api("/api/material-master/materials?page=1&page_size=20", { cookieJar: firstJar, full: true });
  assert.equal(blocked.response.status, 403); assert.equal(blocked.payload.code, "PASSWORD_CHANGE_REQUIRED");
  const changed = await api("/api/me/password", {
    method: "POST", cookieJar: firstJar, key: "change-buyer-password-0001",
    body: { old_password: passwords.temporary, new_password: passwords.changed, expected_version: 1 },
  });
  assert.equal(changed.response.status, 200); assert.equal(changed.payload.user.must_change_password, false); assert.equal(changed.payload.user.version, 2);
  const current = await api("/api/session", { cookieJar: firstJar });
  assert.equal(current.payload.authenticated, true); assert.equal(current.payload.user.version, 2);
  const revoked = await api("/api/users", { cookieJar: secondJar });
  assert.equal(revoked.response.status, 401); assert.equal(revoked.payload.code, "SESSION_REVOKED");
  assert.equal((await login("buyer01", passwords.temporary)).response.status, 401);
  assert.equal((await login("buyer01", passwords.changed)).response.status, 200);
  const material = await api("/api/material-master/materials?page=1&page_size=20", { cookieJar: firstJar, full: true });
  assert.equal(material.response.status, 200);
});

test("explicit TLS public origin fixes proxy termination without weakening first-change CSRF", async () => {
  const previousPublicOrigin = process.env.ERP_PUBLIC_ORIGIN;
  try {
    const admin = await setupAdmin();
    assert.equal((await createUser(admin.cookieJar)).response.status, 201);
    const buyerJar = jar(); await login("buyer01", passwords.temporary, buyerJar);
    process.env.ERP_PUBLIC_ORIGIN = "https://erp.example.test:18888";
    const body = { old_password: passwords.temporary, new_password: passwords.changed, expected_version: 1 };
    const internalOrigin = "http://erp.example.test:18888";
    const wrong = await api("/api/me/password", { method: "POST", cookieJar: buyerJar, key: "proxy-wrong-origin-key", body, origin: "https://evil.example:18888", requestOrigin: internalOrigin });
    assert.equal(wrong.response.status, 403); assert.equal(wrong.payload.code, "CSRF_INVALID"); assert.equal(wrong.payload.message, "请求来源校验失败");
    const missing = await api("/api/me/password", { method: "POST", cookieJar: buyerJar, key: "proxy-missing-origin-key", body, origin: false, requestOrigin: internalOrigin });
    assert.equal(missing.response.status, 403); assert.equal(missing.payload.code, "CSRF_INVALID");
    const missingToken = await api("/api/me/password", { method: "POST", cookieJar: buyerJar, key: "proxy-missing-token-key", body, origin: process.env.ERP_PUBLIC_ORIGIN, csrf: false, requestOrigin: internalOrigin });
    assert.equal(missingToken.response.status, 403); assert.equal(missingToken.payload.code, "CSRF_INVALID"); assert.equal(missingToken.payload.message, "CSRF Token 无效");
    const changed = await api("/api/me/password", { method: "POST", cookieJar: buyerJar, key: "proxy-valid-origin-key", body, origin: process.env.ERP_PUBLIC_ORIGIN, requestOrigin: internalOrigin });
    assert.equal(changed.response.status, 200); assert.equal(changed.payload.user.must_change_password, false); assert.equal(changed.payload.user.version, 2);
  } finally {
    if (previousPublicOrigin === undefined) delete process.env.ERP_PUBLIC_ORIGIN;
    else process.env.ERP_PUBLIC_ORIGIN = previousPublicOrigin;
  }
});

test("explicit UAT loopback origin supports admin user creation and logout without widening CSRF", async () => {
  const previous = {
    publicOrigin: process.env.ERP_PUBLIC_ORIGIN,
    deploymentClass: process.env.ERP_DEPLOYMENT_CLASS,
    loopback: process.env.ERP_UAT_ALLOW_LOOPBACK_ORIGIN,
  };
  const requestOrigin = "http://127.0.0.1:3000";
  const browserOrigin = "http://127.0.0.1:43127";
  try {
    process.env.ERP_PUBLIC_ORIGIN = "https://erp.example.test:18888";
    process.env.ERP_DEPLOYMENT_CLASS = "uat";
    process.env.ERP_UAT_ALLOW_LOOPBACK_ORIGIN = "true";
    const admin = await setupAdmin();
    const body = { username: "uatloop01", display_name: "UAT 经营负责人", role: "manager", temporary_password: "Quartz!5729Lake" };

    const unknownOrigin = await api("/api/users", {
      method: "POST", cookieJar: admin.cookieJar, key: "uat-loopback-unknown-origin", body,
      origin: "https://evil.example", requestOrigin,
    });
    assert.equal(unknownOrigin.response.status, 403); assert.equal(unknownOrigin.payload.code, "CSRF_INVALID");
    const missingCsrf = await api("/api/users", {
      method: "POST", cookieJar: admin.cookieJar, key: "uat-loopback-missing-csrf", body,
      csrf: false, origin: browserOrigin, requestOrigin,
    });
    assert.equal(missingCsrf.response.status, 403); assert.equal(missingCsrf.payload.code, "CSRF_INVALID");
    const wrongCsrf = await api("/api/users", {
      method: "POST", cookieJar: admin.cookieJar, key: "uat-loopback-wrong-csrf", body,
      csrf: "not-the-cookie-csrf-value", origin: browserOrigin, requestOrigin,
    });
    assert.equal(wrongCsrf.response.status, 403); assert.equal(wrongCsrf.payload.code, "CSRF_INVALID");

    const created = await api("/api/users", {
      method: "POST", cookieJar: admin.cookieJar, key: "uat-loopback-create-manager", body,
      origin: browserOrigin, requestOrigin,
    });
    assert.equal(created.response.status, 201); assert.equal(created.payload.user.role, "manager");
    const weak = await api("/api/users", {
      method: "POST", cookieJar: admin.cookieJar, key: "uat-loopback-create-weak",
      body: { ...body, username: "weakuser", temporary_password: "weak" },
      origin: browserOrigin, requestOrigin,
    });
    assert.equal(weak.response.status, 400); assert.equal(weak.payload.code, "PASSWORD_WEAK");
    const duplicate = await api("/api/users", {
      method: "POST", cookieJar: admin.cookieJar, key: "uat-loopback-create-duplicate", body,
      origin: browserOrigin, requestOrigin,
    });
    assert.equal(duplicate.response.status, 409); assert.equal(duplicate.payload.code, "USERNAME_EXISTS");

    const revokedJar = { ...admin.cookieJar };
    const loggedOut = await api("/api/logout", {
      method: "POST", cookieJar: admin.cookieJar, body: {}, origin: browserOrigin, requestOrigin,
    });
    assert.equal(loggedOut.response.status, 200);
    const clearHeaders = loggedOut.response.headers.getSetCookie();
    assert.equal(clearHeaders.length, 2);
    assert.ok(clearHeaders.every((value) => /Path=\//.test(value) && /SameSite=Lax/.test(value) && /Max-Age=0/.test(value)));
    assert.equal(admin.cookieJar.CYD_ERP_SESSION, undefined); assert.equal(admin.cookieJar.CYD_ERP_CSRF, undefined);
    const revoked = await api("/api/users", { cookieJar: revokedJar, origin: browserOrigin, requestOrigin });
    assert.equal(revoked.response.status, 401); assert.equal(revoked.payload.code, "SESSION_REVOKED");
    const repeated = await api("/api/logout", {
      method: "POST", cookieJar: admin.cookieJar, body: {}, origin: false, csrf: false, requestOrigin,
    });
    assert.equal(repeated.response.status, 200);

    const audit = await pool.query(`
      select action,result,error_code,target_username from audit_log
      where action in ('USER_CREATED','LOGOUT') order by id
    `);
    assert.ok(audit.rows.some((row) => row.action === "USER_CREATED" && row.result === "success" && row.target_username === "uatloop01"));
    assert.ok(audit.rows.some((row) => row.action === "USER_CREATED" && row.result === "failed" && row.error_code === "CSRF_INVALID"));
    assert.ok(audit.rows.some((row) => row.action === "USER_CREATED" && row.result === "failed" && row.error_code === "PASSWORD_WEAK"));
    assert.ok(audit.rows.some((row) => row.action === "USER_CREATED" && row.result === "failed" && row.error_code === "USERNAME_EXISTS"));
    assert.ok(audit.rows.some((row) => row.action === "LOGOUT" && row.result === "success" && row.target_username === "rootadmin"));
  } finally {
    for (const [key, value] of [
      ["ERP_PUBLIC_ORIGIN", previous.publicOrigin],
      ["ERP_DEPLOYMENT_CLASS", previous.deploymentClass],
      ["ERP_UAT_ALLOW_LOOPBACK_ORIGIN", previous.loopback],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("status and reset enforce CAS and immediately revoke every target session", async () => {
  const admin = await setupAdmin();
  await createUser(admin.cookieJar);
  const buyerJar = jar(); await login("buyer01", passwords.temporary, buyerJar);
  const stale = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: randomUUID(), body: { username: "buyer01", is_active: false, expected_version: 99 } });
  assert.equal(stale.response.status, 409); assert.equal(stale.payload.code, "VERSION_CONFLICT");
  const stopped = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: randomUUID(), body: { username: "buyer01", is_active: false, expected_version: 1 } });
  assert.equal(stopped.payload.user.version, 2); assert.equal(stopped.payload.user.is_active, false);
  const oldSession = await api("/api/users", { cookieJar: buyerJar });
  assert.equal(oldSession.payload.code, "SESSION_REVOKED");
  const enabled = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: randomUUID(), body: { username: "buyer01", is_active: true, expected_version: 2 } });
  assert.equal(enabled.payload.user.version, 3);
  const reset = await api("/api/users/reset-password", { method: "POST", cookieJar: admin.cookieJar, key: randomUUID(), body: { username: "buyer01", temporary_password: "Canvas!7429River", expected_version: 3 } });
  assert.equal(reset.payload.user.version, 4); assert.equal(reset.payload.user.must_change_password, true);
  const temporaryLogin = await login("buyer01", "Canvas!7429River");
  assert.equal(temporaryLogin.response.status, 200); assert.equal(temporaryLogin.payload.user.must_change_password, true);
});

test("logout requires Origin and CSRF only when a valid session exists", async () => {
  const admin = await setupAdmin();
  const revokedJar = { ...admin.cookieJar };
  const missingOrigin = await api("/api/logout", { method: "POST", cookieJar: admin.cookieJar, body: {}, origin: false });
  assert.equal(missingOrigin.response.status, 403); assert.equal(missingOrigin.payload.code, "CSRF_INVALID");
  const wrong = await api("/api/logout", { method: "POST", cookieJar: admin.cookieJar, body: {}, csrf: false });
  assert.equal(wrong.response.status, 403);
  const loggedOut = await api("/api/logout", { method: "POST", cookieJar: admin.cookieJar, body: {} });
  assert.equal(loggedOut.response.status, 200); assert.equal(admin.cookieJar.CYD_ERP_SESSION, undefined);
  const oldSession = await api("/api/users", { cookieJar: revokedJar });
  assert.equal(oldSession.response.status, 401); assert.equal(oldSession.payload.code, "SESSION_REVOKED");
  const anonymous = await api("/api/logout", { method: "POST", cookieJar: jar(), body: {}, origin: false, csrf: false });
  assert.equal(anonymous.response.status, 200);
  const audit = await pool.query("select result,error_code from audit_log where action='LOGOUT' order by id");
  assert.equal(audit.rows.filter((row) => row.result === "failed" && row.error_code === "CSRF_INVALID").length, 2);
  assert.equal(audit.rows.filter((row) => row.result === "success").length, 1);
});

test("non-admin cannot manage users or audit; audit query is bounded, filterable and minimal", async () => {
  const admin = await setupAdmin();
  await createUser(admin.cookieJar);
  const buyerJar = jar(); await login("buyer01", passwords.temporary, buyerJar);
  const deniedUsers = await api("/api/users", { cookieJar: buyerJar });
  assert.equal(deniedUsers.response.status, 403); assert.equal(deniedUsers.payload.code, "PASSWORD_CHANGE_REQUIRED");
  const deniedAudit = await api("/api/system/audit-logs", { cookieJar: buyerJar });
  assert.equal(deniedAudit.response.status, 403); assert.equal(deniedAudit.payload.code, "PASSWORD_CHANGE_REQUIRED");
  await api("/api/me/password", {
    method: "POST", cookieJar: buyerJar, key: "buyer-permission-change-key",
    body: { old_password: passwords.temporary, new_password: passwords.changed, expected_version: 1 },
  });
  const forbiddenUsers = await api("/api/users", { cookieJar: buyerJar });
  assert.equal(forbiddenUsers.response.status, 403); assert.equal(forbiddenUsers.payload.code, "PERMISSION_DENIED");
  const forbiddenCreate = await api("/api/users", {
    method: "POST", cookieJar: buyerJar, key: "buyer-forbidden-create-key",
    body: { username: "denied01", display_name: "无权限用户", role: "manager", temporary_password: "Quartz!5729Lake" },
  });
  assert.equal(forbiddenCreate.response.status, 403); assert.equal(forbiddenCreate.payload.code, "PERMISSION_DENIED");
  const forbiddenAudit = await api("/api/system/audit-logs", { cookieJar: buyerJar });
  assert.equal(forbiddenAudit.response.status, 403); assert.equal(forbiddenAudit.payload.code, "PERMISSION_DENIED");
  const audit = await api("/api/system/audit-logs?action=USER_CREATED&target_username=buyer01&result=success&page=1&page_size=1", { cookieJar: admin.cookieJar });
  assert.equal(audit.response.status, 200); assert.equal(audit.payload.data.length, 1); assert.equal(audit.payload.pagination.page_size, 1);
  assert.deepEqual(Object.keys(audit.payload.data[0]).sort(), ["action", "actor", "created_at", "error_code", "id", "new_version", "old_version", "operation_id", "request_id", "result", "target_username"].sort());
  const invalidPage = await api("/api/system/audit-logs?page_size=101", { cookieJar: admin.cookieJar });
  assert.equal(invalidPage.response.status, 400); assert.equal(invalidPage.payload.code, "QUERY_INVALID");
  const deniedCreateAudit = await pool.query("select result,error_code from audit_log where action='USER_CREATED' and username='buyer01' and target_username='denied01'");
  assert.deepEqual(deniedCreateAudit.rows, [{ result: "failed", error_code: "PERMISSION_DENIED" }]);
  const allText = JSON.stringify(audit.payload);
  assert.doesNotMatch(allText, /Copper|River!|CYD_ERP_SESSION|password_hash|token_hash/i);
});

test("concurrent uniqueness and last-active-admin protection preserve invariants", async () => {
  const admin1 = await setupAdmin("adminone", passwords.admin);
  const [left, right] = await Promise.all([
    createUser(admin1.cookieJar, { username: "sameuser", display_name: "并发甲" }, "same-user-create-key-a"),
    createUser(admin1.cookieJar, { username: "sameuser", display_name: "并发乙" }, "same-user-create-key-b"),
  ]);
  assert.deepEqual([left.response.status, right.response.status].sort(), [201, 409]);
  assert.equal(Number((await pool.query("select count(*) count from app_users where username='sameuser'")).rows[0].count), 1);

  const second = await createUser(admin1.cookieJar, { username: "admintwo", display_name: "第二管理员", role: "admin", temporary_password: passwords.secondAdmin }, "create-second-admin-key");
  assert.equal(second.response.status, 201);
  const admin2Jar = jar(); await login("admintwo", passwords.secondAdmin, admin2Jar);
  await api("/api/me/password", { method: "POST", cookieJar: admin2Jar, key: "second-admin-change-key", body: { old_password: passwords.secondAdmin, new_password: passwords.secondChanged, expected_version: 1 } });
  const results = await Promise.all([
    api("/api/users/status", { method: "POST", cookieJar: admin1.cookieJar, key: "stop-admin-two-key", body: { username: "admintwo", is_active: false, expected_version: 2 } }),
    api("/api/users/status", { method: "POST", cookieJar: admin2Jar, key: "stop-admin-one-key", body: { username: "adminone", is_active: false, expected_version: 1 } }),
  ]);
  assert.ok(results.some((item) => item.response.status === 200));
  assert.ok(results.some((item) => item.response.status === 409 || item.response.status === 401));
  const active = await pool.query("select count(*) count from app_users where role='admin' and is_active=true");
  assert.equal(Number(active.rows[0].count), 1);
});

test("database failure rolls back user, audit and idempotency while rate state remains", async () => {
  const admin = await setupAdmin();
  await pool.query(`create or replace function fail_identity_audit_for_test() returns trigger language plpgsql as $$ begin if new.action='USER_CREATED' then raise exception 'identity audit test failure'; end if; return new; end $$`);
  await pool.query("create trigger fail_identity_audit_for_test before insert on audit_log for each row execute function fail_identity_audit_for_test()");
  const failed = await createUser(admin.cookieJar, { username: "rollback01" }, "rollback-user-create-key");
  assert.equal(failed.response.status, 500); assert.equal(failed.payload.code, "INTERNAL_ERROR");
  await pool.query("drop trigger fail_identity_audit_for_test on audit_log");
  await pool.query("drop function fail_identity_audit_for_test()");
  assert.equal(Number((await pool.query("select count(*) count from app_users where username='rollback01'")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select count(*) count from idempotency_keys where path like '%rollback01%'")).rows[0].count), 0);
  assert.equal(Number((await pool.query("select attempt_count from identity_write_rate_limit_buckets where username='rootadmin'")).rows[0].attempt_count), 1);
});

test("identity write rate limits 20 new keys per minute without counting completed replays", async () => {
  const admin = await setupAdmin();
  const body = { username: "missing01", is_active: false, expected_version: 1 };
  const firstKey = "missing-user-rate-key-0001";
  const first = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: firstKey, body });
  assert.equal(first.response.status, 404);
  const replay = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: firstKey, body });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  for (let index = 2; index <= 20; index += 1) {
    const response = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: `missing-user-rate-key-${String(index).padStart(4, "0")}`, body });
    assert.equal(response.response.status, 404);
  }
  const limited = await api("/api/users/status", { method: "POST", cookieJar: admin.cookieJar, key: "missing-user-rate-key-0021", body });
  assert.equal(limited.response.status, 429); assert.equal(limited.payload.code, "RATE_LIMITED");
  const bucket = await pool.query("select attempt_count,new_key_count,rejected_count from identity_write_rate_limit_buckets where username='rootadmin'");
  assert.deepEqual(bucket.rows[0], { attempt_count: 21, new_key_count: 21, rejected_count: 1 });
});
