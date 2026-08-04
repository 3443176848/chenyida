const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class TargetedBrowserContractError extends Error {
  constructor(code) {
    super(code);
    this.name = "TargetedBrowserContractError";
    this.code = code;
  }
}

function fail(code) {
  throw new TargetedBrowserContractError(code);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function responseMetadata(response, prefix) {
  if (!response || typeof response.status !== "function"
    || typeof response.headers !== "function" || typeof response.text !== "function") {
    fail(`${prefix}_RESPONSE_INVALID`);
  }
  const status = response.status();
  const headers = await response.headers();
  const contentType = object(headers)
    ? Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]
    : undefined;
  return { status, contentType: typeof contentType === "string" ? contentType.trim() : "" };
}

async function jsonBody(response, prefix, expectedStatus = 200) {
  const { status, contentType } = await responseMetadata(response, prefix);
  if (status !== expectedStatus) fail(`${prefix}_HTTP_INVALID`);
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) fail(`${prefix}_CONTENT_TYPE_INVALID`);
  let body;
  try {
    body = JSON.parse(await response.text());
  } catch {
    fail(`${prefix}_JSON_INVALID`);
  }
  if (!object(body)) fail(`${prefix}_JSON_INVALID`);
  return body;
}

function assertNoErrorCode(body, prefix) {
  if (own(body, "code") || own(body, "error_code") || own(body, "error")) {
    fail(`${prefix}_ERROR_CODE_PRESENT`);
  }
}

export async function validateTargetedLoginResponse(response, expected) {
  if (!object(expected) || typeof expected.username !== "string" || !expected.username
    || typeof expected.role !== "string" || !expected.role) {
    fail("TARGETED_BROWSER_LOGIN_EXPECTATION_INVALID");
  }
  const body = await jsonBody(response, "TARGETED_BROWSER_LOGIN");
  assertNoErrorCode(body, "TARGETED_BROWSER_LOGIN");
  if (body.ok !== true) fail("TARGETED_BROWSER_LOGIN_OK_INVALID");
  if (!object(body.user)) fail("TARGETED_BROWSER_LOGIN_USER_MISSING");
  if (body.user.username !== expected.username) fail("TARGETED_BROWSER_LOGIN_USERNAME_INVALID");
  if (body.user.role !== expected.role) fail("TARGETED_BROWSER_LOGIN_ROLE_INVALID");
  if (own(body.user, "is_active") && body.user.is_active !== true) {
    fail("TARGETED_BROWSER_LOGIN_ACTIVE_INVALID");
  }
  if (own(body.user, "active") && body.user.active !== true) {
    fail("TARGETED_BROWSER_LOGIN_ACTIVE_INVALID");
  }
  if (own(body.user, "must_change_password") && body.user.must_change_password !== false) {
    fail("TARGETED_BROWSER_LOGIN_MUST_CHANGE_INVALID");
  }
  const displayName = typeof body.user.display_name === "string" && body.user.display_name.trim()
    ? body.user.display_name.trim()
    : expected.username;
  const roleLabel = typeof body.user.role_label === "string" && body.user.role_label.trim()
    ? body.user.role_label.trim()
    : expected.role;
  return {
    username: body.user.username,
    role: body.user.role,
    displayName,
    roleLabel,
    active: own(body.user, "is_active") ? body.user.is_active
      : own(body.user, "active") ? body.user.active : undefined,
    mustChange: own(body.user, "must_change_password") ? body.user.must_change_password : undefined,
  };
}

export async function validateTargetedLogoutTransport(response) {
  const { status, contentType } = await responseMetadata(response, "TARGETED_BROWSER_LOGOUT");
  if (status !== 200) fail("TARGETED_BROWSER_LOGOUT_HTTP_INVALID");
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    fail("TARGETED_BROWSER_LOGOUT_CONTENT_TYPE_INVALID");
  }
  // The UI consumes the JSON body and immediately replaces the document.  The
  // resulting anonymous page plus /api/session are the durable logout proof;
  // rereading the disposed response body after navigation is inherently racy.
  return { status, contentType };
}

export function assertTargetedAuthenticatedWorkspace(state, expected) {
  if (!object(state) || !object(expected)) fail("TARGETED_BROWSER_WORKSPACE_STATE_INVALID");
  if (state.forceChangeHeadingCount !== 0) fail("TARGETED_BROWSER_FORCE_CHANGE_RESTORED");
  if (state.loginHeadingCount !== 0 || state.workspaceHeadingCount !== 1 || state.protectedDomCount !== 1) {
    fail("TARGETED_BROWSER_WORKSPACE_NOT_AUTHENTICATED");
  }
  if (state.currentUserLabel !== expected.displayName) fail("TARGETED_BROWSER_WORKSPACE_USER_INVALID");
  if (![expected.role, expected.roleLabel, "运营"].includes(state.currentRoleLabel)) {
    fail("TARGETED_BROWSER_WORKSPACE_ROLE_INVALID");
  }
}
