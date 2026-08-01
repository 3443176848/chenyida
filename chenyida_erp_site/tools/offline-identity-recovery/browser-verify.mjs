import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";

const FORMAL_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REHEARSAL_ORIGIN = "http://127.0.0.1:3000";
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_PATH = "/credentials/parallel-admin.txt";
const UAT_PATH = "/credentials/uat-role-accounts.txt";
const EXPECTED_BROWSER_IMAGE = "sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd";
const EXPECTED_WEB_IMAGE = "sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25";
const EXPECTED_PAGE_ASSETS = new Set([
  "/assets/api-client-CVQlzwSm.js",
  "/assets/erp-workbench-BB7iENJk.js",
  "/assets/framework-CXnKph_e.js",
  "/assets/index-D4D6otTZ.js",
  "/assets/index-gGD7SDyV.css",
  "/assets/layout-segment-context-ChYe3VFD.js",
  "/assets/rolldown-runtime-S-ySWqyJ.js",
]);
const FIXED_UAT = [
  ["uat_20260729_manager", "manager"],
  ["uat_20260729_sales", "sales"],
  ["uat_20260729_engineering", "engineering"],
  ["uat_20260729_planning", "planning"],
  ["uat_20260729_purchase", "purchase"],
  ["uat_20260729_warehouse", "warehouse"],
  ["uat_20260729_production", "production"],
  ["uat_20260729_quality", "quality"],
  ["uat_20260729_finance", "finance"],
  ["uat_20260729_operations", "operations"],
];

class BrowserFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function loginStatusCode(prefix, status) {
  if (status === 400) return `${prefix}_HTTP_400`;
  if (status === 401) return `${prefix}_HTTP_401`;
  if (status === 403) return `${prefix}_HTTP_403`;
  if (status === 409) return `${prefix}_HTTP_409`;
  if (status === 429) return `${prefix}_HTTP_429`;
  if (status >= 500 && status <= 599) return `${prefix}_HTTP_5XX`;
  return `${prefix}_HTTP_UNEXPECTED`;
}

function output(...parts) {
  process.stdout.write(`${parts.join(" ")}\n`);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const left = Object.keys(value).sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

async function readCredentials(runId) {
  for (const filePath of [ADMIN_PATH, UAT_PATH]) {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
      || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1
      || metadata.size < 2 || metadata.size > 65536) {
      throw new BrowserFailure("BROWSER_CREDENTIAL_METADATA_INVALID");
    }
  }
  let admin;
  let uat;
  try {
    admin = JSON.parse(await readFile(ADMIN_PATH, "utf8"));
    uat = JSON.parse(await readFile(UAT_PATH, "utf8"));
  } catch {
    throw new BrowserFailure("BROWSER_CREDENTIAL_SCHEMA_INVALID");
  }
  if (!exactKeys(admin, ["format_version", "generated_at", "username", "password", "must_change_password", "recovery_run_id"])
    || admin.format_version !== "chenyida-erp-admin-credentials-v2"
    || admin.username !== "admin"
    || admin.must_change_password !== false
    || admin.recovery_run_id !== runId
    || typeof admin.password !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/.test(admin.generated_at)
    || !exactKeys(uat, ["format_version", "generated_at", "accounts", "recovery_run_id"])
    || uat.format_version !== "chenyida-erp-uat-credentials-v2"
    || uat.recovery_run_id !== runId
    || uat.generated_at !== admin.generated_at
    || !Array.isArray(uat.accounts)
    || uat.accounts.length !== FIXED_UAT.length) {
    throw new BrowserFailure("BROWSER_CREDENTIAL_SCHEMA_INVALID");
  }
  const secrets = new Set([admin.password]);
  for (let index = 0; index < FIXED_UAT.length; index += 1) {
    const account = uat.accounts[index];
    const expected = FIXED_UAT[index];
    if (!exactKeys(account, ["username", "role", "password", "must_change_password"])
      || account.username !== expected[0]
      || account.role !== expected[1]
      || account.must_change_password !== true
      || typeof account.password !== "string"
      || secrets.has(account.password)) {
      throw new BrowserFailure("BROWSER_CREDENTIAL_SCHEMA_INVALID");
    }
    secrets.add(account.password);
  }
  return { admin, uat };
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeBrowserEvidence(args) {
  const directory = path.dirname(args.evidencePath);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o022) !== 0 || await realpath(directory) !== directory) {
    throw new BrowserFailure("BROWSER_EVIDENCE_DIRECTORY_INVALID");
  }
  const temporary = `${args.evidencePath}.write-${randomUUID()}`;
  let handle;
  let linked = false;
  let temporaryCreated = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    temporaryCreated = true;
    await handle.writeFile(`${JSON.stringify({
      format_version: "chenyida-erp-browser-verification-provisional-v2",
      verifier_version: "offline-identity-recovery-browser-v2",
      recovery_run_id: args.runId,
      environment: args.environment,
      origin: args.origin,
      browser_image_id: EXPECTED_BROWSER_IMAGE,
      web_image_id: EXPECTED_WEB_IMAGE,
      accounts: ["admin", ...FIXED_UAT.map(([username]) => username)],
      admin_login_count: 1,
      uat_login_count: 10,
      uat_force_change_count: 10,
      logout_count: 11,
      history_reload_count: 11,
      history_back_count: 11,
      history_forward_count: 11,
      blocked_request_count: 0,
      issued_at_epoch: Math.floor(Date.now() / 1000),
    })}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.chown(0, 0);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, args.evidencePath);
    linked = true;
    await unlink(temporary);
    await fsyncDirectory(directory);
    const installed = await lstat(args.evidencePath);
    if (!installed.isFile() || installed.isSymbolicLink() || installed.uid !== 0 || installed.gid !== 0
      || (installed.mode & 0o777) !== 0o600 || installed.nlink !== 1) {
      throw new BrowserFailure("BROWSER_EVIDENCE_METADATA_INVALID");
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
    if (linked) await unlink(args.evidencePath).catch(() => undefined);
    await fsyncDirectory(directory).catch(() => undefined);
    if (error instanceof BrowserFailure) throw error;
    throw new BrowserFailure("BROWSER_EVIDENCE_WRITE_FAILED");
  }
}

function assertDebugEnvironment() {
  for (const key of [
    "DEBUG", "PWDEBUG", "NODE_DEBUG", "DEBUG_COLORS",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  ]) {
    if (process.env[key]) throw new BrowserFailure("BROWSER_DEBUG_ENV_FORBIDDEN");
  }
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "/ms-playwright") {
    throw new BrowserFailure("BROWSER_RUNTIME_ENV_INVALID");
  }
  if (process.env.NODE_OPTIONS && !/^--max-old-space-size=\d+$/.test(process.env.NODE_OPTIONS)) {
    throw new BrowserFailure("BROWSER_RUNTIME_ENV_INVALID");
  }
  if (process.env.RECOVERY_BROWSER_IMAGE_ID !== EXPECTED_BROWSER_IMAGE
    || process.env.RECOVERY_WEB_IMAGE_ID !== EXPECTED_WEB_IMAGE
    || process.env.RECOVERY_PLAYWRIGHT_VERSION !== "1.51.1") {
    throw new BrowserFailure("BROWSER_RUNTIME_ENV_INVALID");
  }
}

function parseArguments(argv) {
  let environment = "";
  let runId = "";
  let evidencePath = "";
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1] || "";
    if (flag === "--environment") environment = value;
    else if (flag === "--expected-run-id") runId = value;
    else if (flag === "--evidence-path") evidencePath = value;
    else throw new BrowserFailure("BROWSER_ARGUMENT_INVALID");
    index += 1;
  }
  const expectedEvidence = environment === "parallel-uat"
    ? `/evidence/.identity-recovery-browser-${runId}.provisional.json`
    : "/evidence/.browser-verification.provisional.json";
  if (!["parallel-uat", "parallel-uat-rehearsal"].includes(environment)
    || !RUN_ID.test(runId) || evidencePath !== expectedEvidence) {
    throw new BrowserFailure("BROWSER_ARGUMENT_INVALID");
  }
  return {
    environment,
    runId,
    evidencePath,
    origin: environment === "parallel-uat" ? FORMAL_ORIGIN : REHEARSAL_ORIGIN,
  };
}

function allowedRootQuery(url) {
  if (!url.search) return true;
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1) return false;
  const [key, value] = entries[0];
  if (!["identity-recovery-protected-history", "identity-recovery-logged-out"].includes(key)) return false;
  if (!["admin", ...FIXED_UAT.map(([username]) => username)].includes(value)) return false;
  return url.search === `?${key}=${encodeURIComponent(value)}`;
}

async function configureContext(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "block", ignoreHTTPSErrors: false });
  const blockedRequests = [];
  await context.addInitScript(() => {
    window.__cydRecoveryPageShowPersisted = false;
    window.addEventListener("pageshow", (event) => {
      window.__cydRecoveryPageShowPersisted = event.persisted === true;
    }, { capture: true });
  });
  if (typeof context.routeWebSocket !== "function") throw new BrowserFailure("BROWSER_RUNTIME_UNSUPPORTED");
  await context.routeWebSocket("**/*", (webSocket) => {
    blockedRequests.push("WEBSOCKET");
    webSocket.close();
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || url.username || url.password || url.hash) {
      blockedRequests.push("EXTERNAL_ORIGIN");
      await route.abort("blockedbyclient");
      return;
    }
    const method = request.method().toUpperCase();
    const identityApi = (url.pathname === "/api/session" && method === "GET"
      || ["/api/login", "/api/logout"].includes(url.pathname) && method === "POST")
      && url.search === "";
    const pageAsset = ["GET", "HEAD"].includes(method)
      && (url.pathname === "/" && allowedRootQuery(url)
        || EXPECTED_PAGE_ASSETS.has(url.pathname) && url.search === ""
        || url.pathname === "/favicon.ico" && url.search === "");
    if (!identityApi && !pageAsset) {
      let category = `OTHER_PAGE_${request.resourceType().toUpperCase()}`;
      if (url.pathname.startsWith("/api/")) category = "API";
      else if (url.pathname === "/") category = "ROOT_VARIANT";
      else if (url.pathname.startsWith("/_next/static/")) category = "STATIC_VARIANT";
      else if (url.pathname.startsWith("/_next/")) category = "NEXT_NON_STATIC";
      else if (url.pathname === "/favicon.ico") category = "FAVICON_VARIANT";
      blockedRequests.push(category);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return { context, blockedRequests };
}

async function contextIdentityFetch(context, origin, operation, payload = {}) {
  const cookies = await context.cookies(origin);
  const csrf = cookies.find((cookie) => cookie.name === "CYD_ERP_CSRF")?.value || "";
  const url = `${origin}${operation === "login" ? "/api/login" : operation === "session" ? "/api/session" : "/api/logout"}`;
  const response = operation === "session"
    ? await context.request.get(url, { failOnStatusCode: false, maxRedirects: 0 })
    : await context.request.post(url, {
      failOnStatusCode: false,
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/json",
        "Origin": origin,
        ...(operation === "logout" ? { "X-CSRF-Token": csrf } : {}),
      },
      data: operation === "login" ? payload : {},
    });
  if (response.url() !== url) throw new BrowserFailure("BROWSER_IDENTITY_REDIRECT_REJECTED");
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status(),
    authenticated: body.authenticated === true,
    username: typeof body.user?.username === "string" ? body.user.username : "",
    role: typeof body.user?.role === "string" ? body.user.role : "",
    mustChange: body.user?.must_change_password === true,
    ok: body.ok === true,
  };
}

async function cleanupSession(context, origin) {
  try {
    const session = await contextIdentityFetch(context, origin, "session");
    if (session.authenticated) {
      const logout = await contextIdentityFetch(context, origin, "logout");
      if (logout.status !== 200 || !logout.ok) return false;
    }
    const finalSession = await contextIdentityFetch(context, origin, "session");
    return finalSession.status === 200 && !finalSession.authenticated;
  } catch {
    return false;
  }
}

async function assertAnonymousPage(page, context, origin, expectedSearch) {
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  const session = await contextIdentityFetch(context, origin, "session");
  if (session.status !== 200 || session.authenticated) throw new BrowserFailure("BROWSER_LOGOUT_NOT_ANONYMOUS");
  if (await page.getByRole("heading", { name: "请先修改临时密码", exact: true }).count()) {
    throw new BrowserFailure("BROWSER_PROTECTED_HISTORY_RESTORED");
  }
  if (await page.getByRole("heading", { name: "经营工作台", exact: true }).count()) {
    throw new BrowserFailure("BROWSER_PROTECTED_HISTORY_RESTORED");
  }
  if (await page.locator(".wb-shell").count()) throw new BrowserFailure("BROWSER_PROTECTED_HISTORY_RESTORED");
  const passwordValues = await page.locator('input[type="password"]').evaluateAll((inputs) => inputs.map((input) => input.value));
  if (passwordValues.some((value) => value !== "")) throw new BrowserFailure("BROWSER_PASSWORD_FIELD_RESTORED");
  const url = new URL(page.url());
  if (url.origin !== origin || url.pathname !== "/" || url.search !== expectedSearch
    || url.hash || url.username || url.password) {
    throw new BrowserFailure("BROWSER_ORIGIN_CHANGED");
  }
}

function observeAnonymousSession(page, origin) {
  let status = 0;
  let assetResponses = 0;
  let assetFailure = false;
  let pageError = false;
  let consoleError = false;
  page.on("response", (response) => {
    if (response.url() === `${origin}/api/session` && response.request().method() === "GET") {
      status = response.status();
    }
    const url = new URL(response.url());
    if (url.origin === origin && EXPECTED_PAGE_ASSETS.has(url.pathname)) {
      assetResponses += 1;
      if (response.status() !== 200) assetFailure = true;
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && EXPECTED_PAGE_ASSETS.has(url.pathname)) assetFailure = true;
  });
  page.on("pageerror", () => { pageError = true; });
  page.on("console", (message) => { if (message.type() === "error") consoleError = true; });
  return () => ({ status, assetResponses, assetFailure, pageError, consoleError });
}

async function waitForAnonymousLogin(page, sessionStatus) {
  try {
    await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor({ timeout: 10000 });
  } catch {
    const runtime = sessionStatus();
    if (runtime.assetFailure) throw new BrowserFailure("BROWSER_ANONYMOUS_ASSET_RESPONSE_FAILED");
    if (runtime.assetResponses !== EXPECTED_PAGE_ASSETS.size) {
      throw new BrowserFailure("BROWSER_ANONYMOUS_ASSET_RESPONSE_MISSING");
    }
    if (runtime.pageError) throw new BrowserFailure("BROWSER_ANONYMOUS_PAGE_SCRIPT_FAILED");
    if (runtime.consoleError) throw new BrowserFailure("BROWSER_ANONYMOUS_CONSOLE_ERROR");
    if (runtime.status === 0) throw new BrowserFailure("BROWSER_ANONYMOUS_SESSION_RESPONSE_MISSING");
    if (runtime.status !== 200) throw new BrowserFailure("BROWSER_ANONYMOUS_SESSION_RESPONSE_FAILED");
    if (await page.getByRole("heading", { name: "初始化管理员", exact: true }).count()) {
      throw new BrowserFailure("BROWSER_UNEXPECTED_SETUP_PAGE");
    }
    if (await page.getByRole("button", { name: "重新连接", exact: true }).count()) {
      throw new BrowserFailure("BROWSER_ANONYMOUS_CLIENT_ERROR");
    }
    throw new BrowserFailure("BROWSER_ANONYMOUS_RENDER_FAILED");
  }
}

async function assertHistoryTraversal(page) {
  const state = await page.evaluate(() => ({
    navigationType: performance.getEntriesByType("navigation")[0]?.type || "",
    persisted: window.__cydRecoveryPageShowPersisted === true,
  }));
  if (state.navigationType !== "back_forward" && !state.persisted) {
    throw new BrowserFailure("BROWSER_HISTORY_TRAVERSAL_UNPROVEN");
  }
}

async function verifyHistory(page, context, origin, account) {
  const protectedSearch = `?identity-recovery-protected-history=${encodeURIComponent(account)}`;
  const loggedOutSearch = `?identity-recovery-logged-out=${encodeURIComponent(account)}`;
  if (new URL(page.url()).search !== loggedOutSearch) throw new BrowserFailure("BROWSER_HISTORY_STATE_INVALID");
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertAnonymousPage(page, context, origin, loggedOutSearch);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertAnonymousPage(page, context, origin, protectedSearch);
  await assertHistoryTraversal(page);
  await page.goForward({ waitUntil: "domcontentloaded" });
  await assertAnonymousPage(page, context, origin, loggedOutSearch);
  await assertHistoryTraversal(page);
}

async function closeAndProveCleanup(state) {
  let pageClosed = true;
  try { await state.page?.close({ runBeforeUnload: false }); } catch { pageClosed = false; }
  const cleaned = await cleanupSession(state.context, state.origin);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const blocked = state.blockedRequests.length !== 0;
  let contextClosed = true;
  try { await state.context.close(); } catch { contextClosed = false; }
  if (state.loginAttempted && (!state.loginResponseKnown
    || !state.loginSucceeded
    || !state.sessionConfirmed
    || !cleaned)) {
    output("ACCOUNT", state.username, "LOGOUT", "FAIL", "BROWSER_REVOKE_REQUIRED");
    throw new BrowserFailure("BROWSER_SESSION_CLEANUP_UNCERTAIN");
  }
  if (!cleaned || !pageClosed || !contextClosed) throw new BrowserFailure("BROWSER_SESSION_CLEANUP_FAILED");
  if (blocked) {
    const category = [...new Set(state.blockedRequests)][0] || "UNKNOWN";
    throw new BrowserFailure(`BROWSER_BLOCKED_${category}`);
  }
}

async function verifyAdmin(browser, origin, account) {
  const { context, blockedRequests } = await configureContext(browser, origin);
  const state = {
    context, blockedRequests, origin, username: "admin", page: null,
    loginAttempted: false, loginResponseKnown: false, loginSucceeded: false, sessionConfirmed: false,
  };
  let failure = null;
  let phase = "OPEN";
  try {
    state.page = await context.newPage();
    const sessionStatus = observeAnonymousSession(state.page, origin);
    phase = "NAVIGATE";
    await state.page.goto(`${origin}/?identity-recovery-protected-history=admin`, { waitUntil: "domcontentloaded" });
    phase = "ANONYMOUS_PAGE";
    await waitForAnonymousLogin(state.page, sessionStatus);
    phase = "LOGIN_REQUEST";
    state.loginAttempted = true;
    const login = await contextIdentityFetch(context, origin, "login", { username: account.username, password: account.password });
    state.loginResponseKnown = true;
    state.loginSucceeded = login.status === 200;
    if (login.status !== 200) throw new BrowserFailure(loginStatusCode("BROWSER_ADMIN_LOGIN", login.status));
    if (login.username !== "admin" || login.role !== "admin" || login.mustChange) {
      throw new BrowserFailure("BROWSER_ADMIN_IDENTITY_INVALID");
    }
    phase = "SESSION_CONFIRM";
    const session = await contextIdentityFetch(context, origin, "session");
    if (session.status !== 200 || !session.authenticated || session.username !== "admin"
      || session.role !== "admin" || session.mustChange) {
      throw new BrowserFailure("BROWSER_ADMIN_SESSION_FAILED");
    }
    state.sessionConfirmed = true;
    phase = "LOGOUT_REQUEST";
    const logout = await contextIdentityFetch(context, origin, "logout");
    if (logout.status !== 200 || !logout.ok) throw new BrowserFailure("BROWSER_ADMIN_LOGOUT_FAILED");
    phase = "HISTORY";
    await state.page.goto(`${origin}/?identity-recovery-logged-out=admin`, { waitUntil: "domcontentloaded" });
    await verifyHistory(state.page, context, origin, "admin");
  } catch (error) {
    failure = error instanceof BrowserFailure ? error : new BrowserFailure(`BROWSER_ADMIN_${phase}_FAILED`);
  } finally {
    await closeAndProveCleanup(state);
  }
  if (failure) throw failure;
  output("ACCOUNT", "admin", "LOGIN", "PASS");
  output("ACCOUNT", "admin", "NO_FORCE_CHANGE", "PASS");
  output("ACCOUNT", "admin", "LOGOUT", "PASS");
}

async function verifyUat(browser, origin, account) {
  const { context, blockedRequests } = await configureContext(browser, origin);
  const state = {
    context, blockedRequests, origin, username: account.username, page: null,
    loginAttempted: false, loginResponseKnown: false, loginSucceeded: false, sessionConfirmed: false,
  };
  let failure = null;
  let phase = "OPEN";
  try {
    state.page = await context.newPage();
    const sessionStatus = observeAnonymousSession(state.page, origin);
    const protectedSearch = `?identity-recovery-protected-history=${encodeURIComponent(account.username)}`;
    phase = "NAVIGATE";
    await state.page.goto(`${origin}/${protectedSearch}`, { waitUntil: "domcontentloaded" });
    phase = "ANONYMOUS_PAGE";
    await waitForAnonymousLogin(state.page, sessionStatus);
    await state.page.getByLabel("账号", { exact: true }).fill(account.username);
    await state.page.getByLabel("密码", { exact: true }).fill(account.password);
    phase = "LOGIN_REQUEST";
    const response = state.page.waitForResponse((candidate) => candidate.url() === `${origin}/api/login`
      && candidate.request().method() === "POST");
    const requestListener = (request) => {
      if (request.url() === `${origin}/api/login` && request.method() === "POST") state.loginAttempted = true;
    };
    state.page.on("request", requestListener);
    const [loginResponse] = await Promise.all([
      response,
      state.page.getByRole("button", { name: "登录", exact: true }).click(),
    ]);
    state.loginResponseKnown = true;
    state.loginSucceeded = loginResponse.status() === 200;
    state.page.off("request", requestListener);
    if (!state.loginSucceeded) {
      throw new BrowserFailure(loginStatusCode("BROWSER_UAT_LOGIN", loginResponse.status()));
    }
    phase = "FORCE_CHANGE_PAGE";
    await state.page.getByRole("heading", { name: "请先修改临时密码", exact: true }).waitFor();
    await state.page.getByLabel("临时密码", { exact: true }).waitFor();
    await state.page.getByLabel("新密码", { exact: true }).waitFor();
    await state.page.getByRole("button", { name: "修改并重新登录", exact: true }).waitFor();
    phase = "SESSION_CONFIRM";
    const session = await contextIdentityFetch(context, origin, "session");
    if (session.status !== 200 || !session.authenticated || session.username !== account.username
      || session.role !== account.role || !session.mustChange) {
      throw new BrowserFailure("BROWSER_UAT_FORCE_CHANGE_FAILED");
    }
    state.sessionConfirmed = true;
    phase = "LOGOUT_REQUEST";
    const logout = await contextIdentityFetch(context, origin, "logout");
    if (logout.status !== 200 || !logout.ok) throw new BrowserFailure("BROWSER_UAT_LOGOUT_FAILED");
    phase = "HISTORY";
    await state.page.goto(`${origin}/?identity-recovery-logged-out=${encodeURIComponent(account.username)}`, { waitUntil: "domcontentloaded" });
    await verifyHistory(state.page, context, origin, account.username);
  } catch (error) {
    failure = error instanceof BrowserFailure ? error : new BrowserFailure(`BROWSER_UAT_${phase}_FAILED`);
  } finally {
    await closeAndProveCleanup(state);
  }
  if (failure) throw failure;
  output("ACCOUNT", account.username, "LOGIN", "PASS");
  output("ACCOUNT", account.username, "FORCE_CHANGE", "PASS");
  output("ACCOUNT", account.username, "LOGOUT", "PASS");
}

async function main() {
  process.umask(0o077);
  Error.stackTraceLimit = 0;
  let browser;
  let phase = "ARGUMENTS";
  try {
    const args = parseArguments(process.argv.slice(2));
    phase = "GUARDS";
    if ((process.geteuid?.() ?? -1) !== 0) throw new BrowserFailure("BROWSER_ROOT_REQUIRED");
    assertDebugEnvironment();
    const expectedClass = args.environment === "parallel-uat" ? "uat" : "test";
    if (process.env.ERP_DEPLOYMENT_CLASS !== expectedClass || process.env.ERP_DEPLOYMENT_CLASS === "production") {
      throw new BrowserFailure("BROWSER_DEPLOYMENT_CLASS_INVALID");
    }
    phase = "CREDENTIALS";
    const credentials = await readCredentials(args.runId);
    phase = "RUNTIME_IMPORT";
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH || "";
    if (modulePath !== "file:///playwright/node_modules/playwright/index.mjs") {
      throw new BrowserFailure("BROWSER_MODULE_PATH_INVALID");
    }
    const { chromium } = await import(modulePath);
    phase = "BROWSER_LAUNCH";
    browser = await chromium.launch({
      headless: true,
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
      args: ["--disable-dev-shm-usage"],
    });
    phase = "ADMIN";
    await verifyAdmin(browser, args.origin, credentials.admin);
    for (const account of credentials.uat.accounts) {
      phase = `UAT_${account.role.toUpperCase()}`;
      await verifyUat(browser, args.origin, account);
    }
    phase = "BROWSER_CLOSE";
    await browser.close();
    browser = undefined;
    phase = "EVIDENCE";
    await writeBrowserEvidence(args);
    output("COUNT", "ADMIN_LOGIN", 1);
    output("COUNT", "UAT_LOGIN", 10);
    output("COUNT", "UAT_FORCE_CHANGE", 10);
    output("COUNT", "LOGOUT", 11);
    output("STAGE", "BROWSER", "PASS");
    return 0;
  } catch (error) {
    const code = error instanceof BrowserFailure ? error.code : `BROWSER_${phase}_FAILED`;
    process.stderr.write(`STAGE BROWSER FAIL ${code}\n`);
    return 2;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function fatal() {
  process.stderr.write("STAGE BROWSER FAIL BROWSER_UNHANDLED_ERROR\n");
  process.exit(2);
}

process.once("uncaughtException", fatal);
process.once("unhandledRejection", fatal);
process.exitCode = await main();
