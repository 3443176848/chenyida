import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertTargetedAuthenticatedWorkspace,
  validateTargetedLoginResponse,
} from "../tools/offline-identity-recovery/targeted-browser-contract.mjs";

const EXPECTED = Object.freeze({ username: "synthetic_operations", role: "operations" });

function response(body, { status = 200, contentType = "application/json; charset=utf-8", raw } = {}) {
  return {
    status: () => status,
    headers: () => ({ "content-type": contentType }),
    text: async () => raw ?? JSON.stringify(body),
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test("accepts the minimal authoritative login contract", async () => {
  const result = await validateTargetedLoginResponse(response({
    ok: true,
    user: { username: EXPECTED.username, role: EXPECTED.role },
  }), EXPECTED);
  assert.deepEqual(result, {
    username: EXPECTED.username,
    role: EXPECTED.role,
    displayName: EXPECTED.username,
    roleLabel: EXPECTED.role,
    active: undefined,
    mustChange: undefined,
  });
});

test("accepts authoritative legal additional fields", async () => {
  const result = await validateTargetedLoginResponse(response({
    ok: true,
    setup_required: false,
    csrf_token: "synthetic-non-secret",
    user: {
      username: EXPECTED.username,
      display_name: "Synthetic Operations",
      role: EXPECTED.role,
      role_label: "运营",
      is_active: true,
      must_change_password: false,
      version: 9,
      permissions: ["dashboard.management.read"],
    },
  }), EXPECTED);
  assert.equal(result.displayName, "Synthetic Operations");
  assert.equal(result.roleLabel, "运营");
  assert.equal(result.active, true);
  assert.equal(result.mustChange, false);
});

test("rejects HTTP 200 pseudo-success response variants", async () => {
  const validUser = { username: EXPECTED.username, role: EXPECTED.role };
  for (const [body, code] of [
    [{ ok: false, user: validUser }, "TARGETED_BROWSER_LOGIN_OK_INVALID"],
    [{ ok: true }, "TARGETED_BROWSER_LOGIN_USER_MISSING"],
    [{ ok: true, user: { ...validUser, username: "synthetic_wrong" } }, "TARGETED_BROWSER_LOGIN_USERNAME_INVALID"],
    [{ ok: true, user: { ...validUser, role: "purchase" } }, "TARGETED_BROWSER_LOGIN_ROLE_INVALID"],
    [{ ok: true, user: { ...validUser, must_change_password: true } }, "TARGETED_BROWSER_LOGIN_MUST_CHANGE_INVALID"],
    [{ authenticated: true }, "TARGETED_BROWSER_LOGIN_OK_INVALID"],
    [{ ok: true, code: "SYNTHETIC_ERROR", user: validUser }, "TARGETED_BROWSER_LOGIN_ERROR_CODE_PRESENT"],
  ]) {
    await rejectsCode(validateTargetedLoginResponse(response(body), EXPECTED), code);
  }
});

test("rejects HTML, wrong content type, malformed JSON and all specified error statuses", async () => {
  const body = { ok: true, user: { username: EXPECTED.username, role: EXPECTED.role } };
  await rejectsCode(
    validateTargetedLoginResponse(response(body, { contentType: "text/html", raw: "<html></html>" }), EXPECTED),
    "TARGETED_BROWSER_LOGIN_CONTENT_TYPE_INVALID",
  );
  await rejectsCode(
    validateTargetedLoginResponse(response(body, { contentType: "text/plain" }), EXPECTED),
    "TARGETED_BROWSER_LOGIN_CONTENT_TYPE_INVALID",
  );
  await rejectsCode(
    validateTargetedLoginResponse(response(body, { raw: "{not-json" }), EXPECTED),
    "TARGETED_BROWSER_LOGIN_JSON_INVALID",
  );
  for (const status of [401, 403, 429, 500]) {
    await rejectsCode(
      validateTargetedLoginResponse(response(body, { status }), EXPECTED),
      "TARGETED_BROWSER_LOGIN_HTTP_INVALID",
    );
  }
});

test("rejects inactive responses when the authority returns active state", async () => {
  await rejectsCode(validateTargetedLoginResponse(response({
    ok: true,
    user: { username: EXPECTED.username, role: EXPECTED.role, is_active: false },
  }), EXPECTED), "TARGETED_BROWSER_LOGIN_ACTIVE_INVALID");
});

test("requires the authenticated workspace after a valid login response", () => {
  const expected = { ...EXPECTED, displayName: "Synthetic Operations", roleLabel: "运营" };
  const valid = {
    loginHeadingCount: 0,
    forceChangeHeadingCount: 0,
    workspaceHeadingCount: 1,
    protectedDomCount: 1,
    currentUserLabel: expected.displayName,
    currentRoleLabel: expected.roleLabel,
  };
  assert.doesNotThrow(() => assertTargetedAuthenticatedWorkspace(valid, expected));
  assert.throws(
    () => assertTargetedAuthenticatedWorkspace({
      ...valid,
      loginHeadingCount: 1,
      workspaceHeadingCount: 0,
      protectedDomCount: 0,
    }, expected),
    (error) => error?.code === "TARGETED_BROWSER_WORKSPACE_NOT_AUTHENTICATED",
  );
  assert.throws(
    () => assertTargetedAuthenticatedWorkspace({
      ...valid,
      forceChangeHeadingCount: 1,
      workspaceHeadingCount: 0,
      protectedDomCount: 0,
    }, expected),
    (error) => error?.code === "TARGETED_BROWSER_FORCE_CHANGE_RESTORED",
  );
});

test("formal verifier wires the contract to the page login and safe logout flow", async () => {
  const source = await readFile(new URL(
    "../tools/offline-identity-recovery/targeted-browser-verify.mjs",
    import.meta.url,
  ), "utf8");
  assert.match(source, /getByLabel\("账号"[\s\S]*getByLabel\("密码"/);
  assert.match(source, /validateTargetedLoginResponse\(loginResponse/);
  assert.match(source, /assertAuthenticatedWorkspace\(page, context, login\)/);
  assert.match(source, /getByRole\("button", \{ name: "退出", exact: true \}\)\.click\(\)/);
  assert.doesNotMatch(source, /identityFetch\(context, "login"/);
  assert.doesNotMatch(source, /!login\.authenticated/);
});
