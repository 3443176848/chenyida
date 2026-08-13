import assert from "node:assert/strict";
import test from "node:test";

import { IdentityError } from "../app/lib/identity-selfhost/errors.ts";
import { assertProtectedIdentityGate, buildAuthCookieHeaders, buildClearCookieHeaders, buildCsrfCookieHeader, handleSelfhostIdentityApi, identityFailureResponse } from "../app/lib/identity-selfhost/handler.ts";
import { assertPasswordChanged, hashPassword, validateDisplayName, validatePassword, validateUsername, verifyPassword } from "../app/lib/identity-selfhost/password.ts";
import { permissionsForRole, validateRole } from "../app/lib/identity-selfhost/permissions.ts";
import { assertResetAllowed, assertStatusChangeAllowed } from "../app/lib/identity-selfhost/service.ts";
import { IDENTITY_ROLES } from "../app/lib/identity-selfhost/types.ts";

test("username and display name validation are bounded", () => {
  assert.equal(validateUsername(" Purchase_01 "), "purchase_01");
  for (const value of ["ab", "1admin", "admin/ops", "bad name", `a${"b".repeat(32)}`]) assert.throws(() => validateUsername(value), (error) => error.code === "USERNAME_INVALID");
  assert.equal(validateDisplayName(" 采购员甲 "), "采购员甲");
  for (const value of ["", "x".repeat(129), "bad\nname"]) assert.throws(() => validateDisplayName(value), (error) => error.code === "DISPLAY_NAME_INVALID");
});

test("role allowlist and server-side permission matrix are fixed", () => {
  assert.deepEqual(IDENTITY_ROLES, ["admin", "manager", "purchase", "engineering", "planning", "production", "warehouse", "quality", "sales", "finance", "operations"]);
  for (const role of IDENTITY_ROLES) assert.equal(validateRole(role), role);
  assert.throws(() => validateRole("custom"), (error) => error.code === "ROLE_INVALID");
  assert.ok(permissionsForRole("admin").includes("system.audit.read"));
  for (const role of IDENTITY_ROLES.filter((item) => item !== "admin")) assert.ok(!permissionsForRole(role).some((permission) => permission.startsWith("system.")));
  assert.ok(permissionsForRole("purchase").includes("material.read"));
});

test("operations receives only the governed material and supplier-mapping review increments", () => {
  const reviewPermissions = ["material.review.queue", "material.review.approve", "material.review.reject"];
  const supplierMappingReviewPermissions = [
    "supplier_mapping.read", "supplier_mapping.review_queue", "supplier_mapping.approve", "supplier_mapping.reject",
  ];
  const baselinePermissions = [
    "dashboard.management.read", "dashboard.read", "finance.read", "inventory.read", "master.bom.read",
    "master.customer.read", "master.product.read", "master.supplier.read", "master.supplier_mapping.read",
    "material.read", "operations.audit_status.read", "planning.read", "procurement.read", "production.read",
    "production.work_center.manage", "production.work_center.read", "quality.read", "sales.read",
  ];
  const operations = permissionsForRole("operations");
  const governedReviewPermissions = [...reviewPermissions, ...supplierMappingReviewPermissions];
  assert.deepEqual(operations.filter((permission) => !governedReviewPermissions.includes(permission)), baselinePermissions);
  for (const permission of governedReviewPermissions) assert.ok(operations.includes(permission), permission);
  for (const permission of [
    "*", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit",
    "material.audit.read", "system.audit.read", "system.backup.read", "system.user.read", "system.user.create",
    "system.user.status", "system.user.reset", "master.bom.manage", "inventory.adjust", "inventory.reverse",
    "procurement.plan", "procurement.order", "procurement.receive", "production.plan", "production.issue",
    "production.report", "sales.order", "sales.ship", "quality.inspect", "finance.post",
    "supplier_mapping.create", "supplier_mapping.edit_draft", "supplier_mapping.submit",
  ]) assert.equal(operations.includes(permission), false, permission);
  for (const role of IDENTITY_ROLES.filter((role) => !["admin", "manager", "operations"].includes(role))) {
    for (const permission of reviewPermissions) assert.equal(permissionsForRole(role).includes(permission), false, `${role}:${permission}`);
    for (const permission of supplierMappingReviewPermissions.filter((item) => item !== "supplier_mapping.read")) {
      assert.equal(permissionsForRole(role).includes(permission), false, `${role}:${permission}`);
    }
  }
});

test("password policy rejects weak, default, username-containing and unchanged values", () => {
  assert.equal(validatePassword("River!4826Stone", "rootadmin"), "River!4826Stone");
  for (const [password, username, code] of [
    ["Short!12", "buyer01", "PASSWORD_WEAK"],
    ["alllowercaseonly", "buyer01", "PASSWORD_WEAK"],
    ["Password!2345A", "buyer01", "PASSWORD_WEAK"],
    ["Buyer01!Safe9", "buyer01", "PASSWORD_CONTAINS_USERNAME"],
    ["A".repeat(129), "buyer01", "PASSWORD_WEAK"],
  ]) assert.throws(() => validatePassword(password, username), (error) => error.code === code);
  assert.throws(() => assertPasswordChanged("River!4826Stone", "River!4826Stone"), (error) => error.code === "PASSWORD_UNCHANGED");
});

test("PBKDF2-SHA256 uses 310000 iterations and constant-time verification", async () => {
  const hashed = await hashPassword("River!4826Stone");
  assert.match(hashed, /^pbkdf2_sha256\$310000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword("River!4826Stone", hashed), true);
  assert.equal(await verifyPassword("Wrong!4826Stone", hashed), false);
  assert.equal(await verifyPassword("River!4826Stone", "pbkdf2_sha256$100000$bad$bad"), false);
});

test("self-deactivation, self-reset and last active admin are blocked", () => {
  const admin = { username: "admin01", role: "admin", is_active: true };
  assert.throws(() => assertStatusChangeAllowed("admin01", admin, false, 2), (error) => error.code === "SELF_DEACTIVATION_FORBIDDEN");
  assert.throws(() => assertStatusChangeAllowed("admin02", admin, false, 1), (error) => error.code === "LAST_ACTIVE_ADMIN");
  assert.doesNotThrow(() => assertStatusChangeAllowed("admin02", admin, false, 2));
  assert.throws(() => assertResetAllowed("admin01", "admin01"), (error) => error.code === "SELF_PASSWORD_RESET_FORBIDDEN");
});

test("must-change gate allows identity handler to run first and blocks all later protected modules", () => {
  const actor = { username: "buyer01", display_name: "采购员", role: "purchase", is_active: true, must_change_password: true, version: 1, last_login_at: null, permissions: ["material.read"] };
  assert.throws(() => assertProtectedIdentityGate({ state: "AUTHENTICATED", actor, token_hash: "a".repeat(64) }), (error) => error.code === "PASSWORD_CHANGE_REQUIRED" && error.status === 403);
  assert.throws(() => assertProtectedIdentityGate({ state: "EXPIRED", actor: null, token_hash: "a".repeat(64), revoked_reason: "IDLE_TIMEOUT" }), (error) => error.code === "SESSION_EXPIRED" && error.message === "当前会话已过期，请重新登录" && error.status === 401);
  assert.throws(() => assertProtectedIdentityGate({ state: "REVOKED", actor: null, token_hash: "a".repeat(64) }), (error) => error.code === "SESSION_REVOKED" && error.status === 401);
});

test("cookie policy is environment-aware and keeps CSRF readable", () => {
  const request = new Request("http://internal.test/api/login");
  const development = buildAuthCookieHeaders(request, "session-value", "csrf-value", "development").getSetCookie();
  assert.match(development[0], /HttpOnly/); assert.match(development[0], /SameSite=Lax/); assert.doesNotMatch(development[0], /Secure/);
  assert.doesNotMatch(development[1], /HttpOnly/); assert.match(development[1], /SameSite=Lax/);
  const production = buildAuthCookieHeaders(request, "session-value", "csrf-value", "production").getSetCookie();
  assert.ok(production.every((value) => /Secure/.test(value)));
  assert.match(buildCsrfCookieHeader(request, "csrf-value", "production"), /Secure/);
  const cleared = buildClearCookieHeaders(request, "production").getSetCookie();
  assert.equal(cleared.length, production.length);
  const byName = (values, name) => values.find((value) => value.startsWith(`${name}=`));
  const sessionSet = byName(production, "CYD_ERP_SESSION");
  const sessionClear = byName(cleared, "CYD_ERP_SESSION");
  const csrfSet = byName(production, "CYD_ERP_CSRF");
  const csrfClear = byName(cleared, "CYD_ERP_CSRF");
  for (const value of [sessionSet, sessionClear, csrfSet, csrfClear]) {
    assert.match(value, /Path=\//); assert.match(value, /SameSite=Lax/); assert.match(value, /Secure/); assert.doesNotMatch(value, /Domain=/i);
  }
  assert.match(sessionSet, /HttpOnly/); assert.match(sessionClear, /HttpOnly/);
  assert.doesNotMatch(csrfSet, /HttpOnly/); assert.doesNotMatch(csrfClear, /HttpOnly/);
  assert.match(sessionClear, /Max-Age=0/); assert.match(csrfClear, /Max-Age=0/);
});

test("stable error mapping never exposes internal exceptions", async () => {
  const known = identityFailureResponse(new IdentityError("VERSION_CONFLICT", "用户版本已变化，请刷新后重试", 409), "11111111-1111-4111-8111-111111111111");
  assert.equal(known.status, 409); assert.equal((await known.json()).code, "VERSION_CONFLICT");
  const unknown = identityFailureResponse(new Error("select secret from app_users"), "11111111-1111-4111-8111-111111111111");
  const body = await unknown.text(); assert.equal(unknown.status, 500); assert.doesNotMatch(body, /select secret|app_users|stack/i);
});

test("controlled deployments reject browser setup before reading supplied secrets", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      ERP_ENV: "production",
      ERP_DEPLOYMENT_CLASS: "production",
      ERP_PUBLIC_ORIGIN: "https://erp.example.invalid",
    });
    for (const name of ["DATABASE_URL", "ERP_MIGRATION_DATABASE_URL", "POSTGRES_PASSWORD", "ERP_ADMIN_PASSWORD", "ERP_SETUP_TOKEN"]) delete process.env[name];
    const response = await handleSelfhostIdentityApi(new Request("https://erp.example.invalid/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setup_token: "browser-supplied-secret-value",
        username: "admin01",
        display_name: "系统管理员",
        password: "Browser!SuppliedSecret9",
      }),
    }), {
      pool: { async connect() { throw new Error("audit unavailable"); } },
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    const body = await response.text();
    assert.equal(response.status, 403);
    assert.match(body, /SETUP_DISABLED/);
    assert.doesNotMatch(body, /browser-supplied|Browser!|audit unavailable/i);
  } finally {
    process.env = saved;
  }
});

test("identity failures preserve retry metadata and both invalid-session cookie clears", async () => {
  const request = new Request("https://erp.example.test/api/users");
  const response = identityFailureResponse(
    new IdentityError("RATE_LIMITED", "身份写操作过于频繁，请稍后重试", 429, 17),
    "11111111-1111-4111-8111-111111111111",
    buildClearCookieHeaders(request, "production"),
  );
  assert.equal(response.headers.get("Retry-After"), "17");
  const cleared = response.headers.getSetCookie();
  assert.equal(cleared.length, 2);
  assert.ok(cleared.some((value) => value.startsWith("CYD_ERP_SESSION=") && /HttpOnly/.test(value) && /Max-Age=0/.test(value) && /Secure/.test(value)));
  assert.ok(cleared.some((value) => value.startsWith("CYD_ERP_CSRF=") && !/HttpOnly/.test(value) && /Max-Age=0/.test(value) && /Secure/.test(value)));
  assert.doesNotMatch(await response.text(), /CYD_ERP_SESSION|CYD_ERP_CSRF|token_hash/i);
});
