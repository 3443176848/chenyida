import { link, lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const ORIGIN = "https://43.135.148.43.nip.io:18888";
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const EXPECTED_BROWSER_IMAGE = "sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd";
const EXPECTED_WEB_IMAGE = "sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8";
const TARGET_USERNAME = "uat_20260729_operations";
const TARGET_ROLE = "operations";
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
  [TARGET_USERNAME, TARGET_ROLE],
];

class BrowserFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function output(...parts) {
  process.stdout.write(`${parts.join(" ")}\n`);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseArguments(argv) {
  let runId = "";
  let attempt = 0;
  let evidencePath = "";
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new BrowserFailure("TARGETED_BROWSER_ARGUMENT_INVALID");
    seen.add(flag);
    const value = argv[index + 1] || "";
    if (!value || value.startsWith("--")) throw new BrowserFailure("TARGETED_BROWSER_ARGUMENT_INVALID");
    if (flag === "--expected-run-id") runId = value;
    else if (flag === "--verification-attempt") attempt = Number(value);
    else if (flag === "--evidence-path") evidencePath = value;
    else throw new BrowserFailure("TARGETED_BROWSER_ARGUMENT_INVALID");
    index += 1;
  }
  const expectedPath = `/evidence/targeted-identity-recovery-browser-${runId}-attempt-${attempt}.json`;
  if (!RUN_ID.test(runId) || ![1, 2].includes(attempt) || evidencePath !== expectedPath) {
    throw new BrowserFailure("TARGETED_BROWSER_ARGUMENT_INVALID");
  }
  return { runId, attempt, evidencePath };
}

function assertRuntime() {
  if (process.env.ERP_DEPLOYMENT_CLASS !== "uat"
    || process.env.RECOVERY_BROWSER_IMAGE_ID !== EXPECTED_BROWSER_IMAGE
    || process.env.RECOVERY_WEB_IMAGE_ID !== EXPECTED_WEB_IMAGE
    || process.env.RECOVERY_PLAYWRIGHT_VERSION !== "1.51.1"
    || process.env.PLAYWRIGHT_MODULE_PATH !== "file:///playwright/node_modules/playwright/index.mjs") {
    throw new BrowserFailure("TARGETED_BROWSER_RUNTIME_INVALID");
  }
  for (const key of [
    "DEBUG", "PWDEBUG", "NODE_DEBUG", "DEBUG_COLORS",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  ]) {
    if (process.env[key]) throw new BrowserFailure("TARGETED_BROWSER_DEBUG_ENV_FORBIDDEN");
  }
}

async function readTargetCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > 65536) {
    throw new BrowserFailure("TARGETED_BROWSER_CREDENTIAL_METADATA_INVALID");
  }
  let document;
  try {
    document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  } catch {
    throw new BrowserFailure("TARGETED_BROWSER_CREDENTIAL_SCHEMA_INVALID");
  }
  if (!exactKeys(document, ["format_version", "generated_at", "accounts", "recovery_run_id"])
    || document.format_version !== "chenyida-erp-uat-credentials-v2"
    || !RUN_ID.test(String(document.recovery_run_id || ""))
    || !Array.isArray(document.accounts)
    || document.accounts.length !== FIXED_UAT.length) {
    throw new BrowserFailure("TARGETED_BROWSER_CREDENTIAL_SCHEMA_INVALID");
  }
  const passwords = new Set();
  for (let index = 0; index < FIXED_UAT.length; index += 1) {
    const account = document.accounts[index];
    const expected = FIXED_UAT[index];
    if (!exactKeys(account, ["username", "role", "password", "must_change_password"])
      || account.username !== expected[0]
      || account.role !== expected[1]
      || typeof account.password !== "string"
      || account.password.length < 12
      || account.password.length > 128
      || passwords.has(account.password)) {
      throw new BrowserFailure("TARGETED_BROWSER_CREDENTIAL_SCHEMA_INVALID");
    }
    passwords.add(account.password);
  }
  const targets = document.accounts.filter((account) => account.username === TARGET_USERNAME);
  if (targets.length !== 1 || targets[0].role !== TARGET_ROLE || targets[0].must_change_password !== false) {
    throw new BrowserFailure("TARGETED_BROWSER_TARGET_CREDENTIAL_INVALID");
  }
  return { username: targets[0].username, role: targets[0].role, password: targets[0].password };
}

async function identityFetch(context, operation, payload = {}) {
  const cookies = await context.cookies(ORIGIN);
  const csrf = cookies.find((cookie) => cookie.name === "CYD_ERP_CSRF")?.value || "";
  const endpoint = operation === "login" ? "/api/login" : operation === "logout" ? "/api/logout" : "/api/session";
  const url = `${ORIGIN}${endpoint}`;
  const response = operation === "session"
    ? await context.request.get(url, { failOnStatusCode: false, maxRedirects: 0 })
    : await context.request.post(url, {
      failOnStatusCode: false,
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/json",
        "Origin": ORIGIN,
        ...(operation === "logout" ? { "X-CSRF-Token": csrf } : {}),
      },
      data: operation === "login" ? payload : {},
    });
  if (response.url() !== url) throw new BrowserFailure("TARGETED_BROWSER_IDENTITY_REDIRECTED");
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

async function bestEffortLogout(context) {
  try {
    const session = await identityFetch(context, "session");
    if (session.authenticated) await identityFetch(context, "logout");
  } catch {
    // The formal caller performs an offline targeted cleanup after any failure.
  }
}

async function configureContext(browser) {
  const context = await browser.newContext({ serviceWorkers: "block", ignoreHTTPSErrors: false });
  const blockedRequests = [];
  const businessRequests = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const identityApi = url.origin === ORIGIN && url.search === ""
      && (url.pathname === "/api/session" && method === "GET"
        || ["/api/login", "/api/logout"].includes(url.pathname) && method === "POST");
    const rootPage = url.origin === ORIGIN && url.pathname === "/" && method === "GET"
      && ["?targeted-identity-recovery=before", "?targeted-identity-recovery=logged-out"].includes(url.search);
    const asset = url.origin === ORIGIN && url.search === "" && ["GET", "HEAD"].includes(method)
      && (/^\/assets\/[A-Za-z0-9._-]+\.(?:js|css|woff2?)$/.test(url.pathname) || url.pathname === "/favicon.ico");
    if (!identityApi && !rootPage && !asset) {
      if (url.pathname.startsWith("/api/")) businessRequests.push("API");
      blockedRequests.push("BLOCKED");
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return { context, blockedRequests, businessRequests };
}

async function assertAnonymousLoginPage(page, context, expectedSearch) {
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor({ timeout: 15000 });
  const session = await identityFetch(context, "session");
  if (session.status !== 200 || session.authenticated) throw new BrowserFailure("TARGETED_BROWSER_SESSION_NOT_ANONYMOUS");
  if (await page.getByRole("heading", { name: "请先修改临时密码", exact: true }).count()) {
    throw new BrowserFailure("TARGETED_BROWSER_FORCE_CHANGE_RESTORED");
  }
  if (await page.locator(".wb-shell").count()) throw new BrowserFailure("TARGETED_BROWSER_PROTECTED_CONTENT_RESTORED");
  const url = new URL(page.url());
  if (url.origin !== ORIGIN || url.pathname !== "/" || url.search !== expectedSearch || url.hash) {
    throw new BrowserFailure("TARGETED_BROWSER_HISTORY_ORIGIN_CHANGED");
  }
  const passwordValues = await page.locator('input[type="password"]').evaluateAll((inputs) => inputs.map((input) => input.value));
  if (passwordValues.some((value) => value !== "")) throw new BrowserFailure("TARGETED_BROWSER_PASSWORD_RESTORED");
}

async function fsyncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeEvidence(args, blockedRequestCount, businessRequestCount) {
  const directory = path.dirname(args.evidencePath);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o022) !== 0 || await realpath(directory) !== directory) {
    throw new BrowserFailure("TARGETED_BROWSER_EVIDENCE_DIRECTORY_INVALID");
  }
  const temporary = `${args.evidencePath}.write-${randomUUID()}`;
  let handle;
  let linked = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({
      format_version: "chenyida-erp-targeted-browser-verification-v1",
      verifier_version: "offline-identity-recovery-targeted-browser-v1",
      recovery_run_id: args.runId,
      verification_attempt: args.attempt,
      origin: ORIGIN,
      browser_image_id: EXPECTED_BROWSER_IMAGE,
      web_image_id: EXPECTED_WEB_IMAGE,
      username: TARGET_USERNAME,
      role: TARGET_ROLE,
      login_count: 1,
      force_change_count: 0,
      logout_count: 1,
      back_count: 1,
      forward_count: 1,
      refresh_count: 1,
      blocked_request_count: blockedRequestCount,
      business_request_count: businessRequestCount,
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
      throw new BrowserFailure("TARGETED_BROWSER_EVIDENCE_METADATA_INVALID");
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (linked) await unlink(args.evidencePath).catch(() => undefined);
    await fsyncDirectory(directory).catch(() => undefined);
    if (error instanceof BrowserFailure) throw error;
    throw new BrowserFailure("TARGETED_BROWSER_EVIDENCE_WRITE_FAILED");
  }
}

let browser;
let context;
try {
  Error.stackTraceLimit = 0;
  assertRuntime();
  const args = parseArguments(process.argv.slice(2));
  const credential = await readTargetCredential();
  const playwrightModule = await import(process.env.PLAYWRIGHT_MODULE_PATH);
  browser = await playwrightModule.chromium.launch({ headless: true });
  const configured = await configureContext(browser);
  context = configured.context;
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/?targeted-identity-recovery=before`, { waitUntil: "domcontentloaded" });
  await assertAnonymousLoginPage(page, context, "?targeted-identity-recovery=before");

  const login = await identityFetch(context, "login", { username: credential.username, password: credential.password });
  if (login.status !== 200 || !login.authenticated
    || login.username !== TARGET_USERNAME || login.role !== TARGET_ROLE || login.mustChange) {
    throw new BrowserFailure("TARGETED_BROWSER_LOGIN_FAILED");
  }
  const session = await identityFetch(context, "session");
  if (session.status !== 200 || !session.authenticated
    || session.username !== TARGET_USERNAME || session.role !== TARGET_ROLE || session.mustChange) {
    throw new BrowserFailure("TARGETED_BROWSER_SESSION_MISMATCH");
  }
  const logout = await identityFetch(context, "logout");
  if (logout.status !== 200 || !logout.ok) throw new BrowserFailure("TARGETED_BROWSER_LOGOUT_FAILED");
  const anonymous = await identityFetch(context, "session");
  if (anonymous.status !== 200 || anonymous.authenticated) throw new BrowserFailure("TARGETED_BROWSER_LOGOUT_INCOMPLETE");

  await page.goto(`${ORIGIN}/?targeted-identity-recovery=logged-out`, { waitUntil: "domcontentloaded" });
  await assertAnonymousLoginPage(page, context, "?targeted-identity-recovery=logged-out");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertAnonymousLoginPage(page, context, "?targeted-identity-recovery=before");
  await page.goForward({ waitUntil: "domcontentloaded" });
  await assertAnonymousLoginPage(page, context, "?targeted-identity-recovery=logged-out");
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertAnonymousLoginPage(page, context, "?targeted-identity-recovery=logged-out");
  if (configured.blockedRequests.length !== 0 || configured.businessRequests.length !== 0) {
    throw new BrowserFailure("TARGETED_BROWSER_REQUEST_SCOPE_VIOLATION");
  }
  await writeEvidence(args, configured.blockedRequests.length, configured.businessRequests.length);
  output("STAGE", "TARGETED_BROWSER", "PASS");
  output("ACCOUNT", TARGET_USERNAME, "PASS");
  output("ROLE", TARGET_ROLE, "PASS");
  output("COUNT", "LOGIN", 1);
  output("COUNT", "FORCE_CHANGE", 0);
  output("COUNT", "LOGOUT", 1);
  output("COUNT", "BACK", 1);
  output("COUNT", "FORWARD", 1);
  output("COUNT", "REFRESH", 1);
  output("COUNT", "BUSINESS_REQUEST", 0);
  output("FINAL", "TARGETED_BROWSER_VERIFIED");
  await context.close();
  await browser.close();
  process.exitCode = 0;
} catch (error) {
  if (context) await bestEffortLogout(context);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  const code = error instanceof BrowserFailure ? error.code : "TARGETED_BROWSER_INTERNAL_ERROR";
  output("STAGE", "TARGETED_BROWSER", "FAIL", code);
  output("FINAL", "BLOCKED");
  process.exitCode = 2;
}
