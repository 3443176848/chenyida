import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX19_RFQ_BINDING_READONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const REQUEST_CODE = "PRQ-00000001";
const PROJECT_CODE = "PRJ-00000001";
const SUPPLIERS = [
  { id: "1", code: "SUP-000001", name: "UAT快速交付供应商A-042576" },
  { id: "2", code: "SUP-000002", name: "UAT低价延期供应商B-042576" },
];

if (process.env.ERP_RFQ_BINDING_FIX19_UAT_CONFIRM !== REQUIRED_CONFIRM) {
  throw new Error(`ERP_RFQ_BINDING_FIX19_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);
}

async function canonicalPurchaseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1 || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical Purchase UAT credential metadata is invalid");
  }
  let document;
  try {
    document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  } catch {
    throw new Error("canonical Purchase UAT credential schema is invalid");
  }
  const matches = Array.isArray(document?.accounts)
    ? document.accounts.filter((account) => account?.username === REQUIRED_USERNAME && account?.role === "purchase")
    : [];
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
    || matches[0].must_change_password !== false) {
    throw new Error("the active canonical Purchase UAT credential is required");
  }
  return { username: REQUIRED_USERNAME, password: matches[0].password };
}

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the FIX-19 RFQ binding UAT runner");
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1,
    `${stage} has page-level horizontal overflow`);
}

const credential = await canonicalPurchaseCredential();
const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
});
const authPosts = [];
const businessWrites = [];
const apiGets = [];
const forbiddenApiGets = [];
let authenticated = false;

async function revokeSession() {
  if (!authenticated) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
        headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
      }).catch(() => undefined);
    }
  }
  authenticated = false;
}

try {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && url.pathname.startsWith("/api/")) {
      const target = `${url.pathname}${url.search}`;
      apiGets.push(target);
      const allowed = url.pathname === "/api/session"
        || target === "/api/procurement/rfqs?queue=accepted&page_size=100"
        || target === "/api/procurement/rfqs?page_size=100"
        || target === "/api/suppliers?page_size=100";
      if (!allowed) {
        forbiddenApiGets.push(target);
        return route.abort("blockedbyclient");
      }
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) {
      authPosts.push(url.pathname);
      return route.continue();
    }
    businessWrites.push(`${method} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  const loginResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/login`, {
    headers: { Origin: REQUIRED_ORIGIN },
    data: credential,
  });
  authPosts.push("/api/login");
  assert.equal(loginResponse.status(), 200);
  authenticated = true;
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.deepEqual([session.authenticated, session.user?.username, session.user?.role],
    [true, REQUIRED_USERNAME, "purchase"]);
  assert.equal(typeof session.csrf_token, "string");
  assert.ok(session.csrf_token.length > 0);

  await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "供应商询价与定标", exact: true }).waitFor();
  const form = page.locator("form.sourcing-form");
  await form.waitFor();
  const requestSelect = form.locator('select[name="purchase_request_id"]');
  await requestSelect.locator('option[value="1"]').waitFor({ state: "attached" });

  const requestOptions = await requestSelect.locator("option").evaluateAll((options) => options.map((option) => ({
    value: option.value,
    text: option.textContent?.trim() || "",
  })));
  assert.deepEqual(requestOptions, [
    { value: "", text: "请选择" },
    { value: "1", text: `${REQUEST_CODE} · ${PROJECT_CODE}` },
  ]);

  const requestCards = page.locator("article.sourcing-card");
  assert.equal(await requestCards.count(), 1);
  const requestCardText = await requestCards.first().innerText();
  assert.match(requestCardText, new RegExp(`${REQUEST_CODE} · ${PROJECT_CODE}`));
  assert.match(requestCardText, /ACCEPTED/);
  assert.match(requestCardText, /4 行 · 40\.000000/);
  assert.match(requestCardText, /可创建新 Round/);

  const supplierInputs = form.locator('input[name="supplier_ids"]');
  assert.equal(await supplierInputs.count(), 2);
  assert.deepEqual((await supplierInputs.evaluateAll((inputs) => inputs.map((input) => input.value))).sort(), ["1", "2"]);
  for (const supplier of SUPPLIERS) {
    const label = form.locator(`label.sourcing-check:has(input[name="supplier_ids"][value="${supplier.id}"])`);
    assert.equal(await label.count(), 1);
    assert.equal((await label.innerText()).trim(), `${supplier.code} · ${supplier.name}`);
  }

  await requestSelect.selectOption("1");
  for (const supplier of SUPPLIERS) await form.locator(`input[name="supplier_ids"][value="${supplier.id}"]`).check();
  await form.locator('input[name="response_deadline"]').fill("2026-08-31");
  const formBoundary = await form.evaluate((element) => {
    const data = new FormData(element);
    const purchaseRequestValue = data.get("purchase_request_id");
    const supplierValues = data.getAll("supplier_ids");
    return {
      valid: element.checkValidity(),
      purchase_request_value: purchaseRequestValue,
      purchase_request_id: typeof purchaseRequestValue === "string" && /^[1-9]\d*$/.test(purchaseRequestValue)
        ? Number(purchaseRequestValue)
        : null,
      supplier_values: [...supplierValues].sort(),
      supplier_ids: supplierValues.map((value) => typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : null).sort((left, right) => (left ?? 0) - (right ?? 0)),
      response_deadline: data.get("response_deadline"),
    };
  });
  assert.deepEqual(formBoundary, {
    valid: true,
    purchase_request_value: "1",
    purchase_request_id: 1,
    supplier_values: ["1", "2"],
    supplier_ids: [1, 2],
    response_deadline: "2026-08-31",
  });
  assert.equal(await form.getByRole("button", { name: "建立询价草稿", exact: true }).isEnabled(), true);
  await noOverflow(page, "desktop sourcing selection");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await requestSelect.inputValue(), "1");
  assert.deepEqual((await supplierInputs.evaluateAll((inputs) => inputs.filter((input) => input.checked).map((input) => input.value))).sort(), ["1", "2"]);
  assert.equal(await form.locator('input[name="response_deadline"]').inputValue(), "2026-08-31");
  await noOverflow(page, "390x844 sourcing selection");

  await requestSelect.selectOption("");
  for (const supplier of SUPPLIERS) await form.locator(`input[name="supplier_ids"][value="${supplier.id}"]`).uncheck();
  await form.locator('input[name="response_deadline"]').fill("");
  assert.deepEqual(await form.evaluate((element) => {
    const data = new FormData(element);
    return [data.get("purchase_request_id"), data.getAll("supplier_ids"), data.get("response_deadline")];
  }), ["", [], ""]);

  const logoutResponse = await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, {
    headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token },
  });
  authPosts.push("/api/logout");
  assert.equal(logoutResponse.status(), 200);
  authenticated = false;
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);

  assert.deepEqual(businessWrites, []);
  assert.deepEqual(forbiddenApiGets, []);
  assert.deepEqual(authPosts, ["/api/login", "/api/logout"]);
  assert.equal(apiGets.filter((target) => target === "/api/procurement/rfqs?queue=accepted&page_size=100").length, 1);
  assert.equal(apiGets.filter((target) => target === "/api/procurement/rfqs?page_size=100").length, 1);
  assert.equal(apiGets.filter((target) => target === "/api/suppliers?page_size=100").length, 1);
  console.info(`RFQ_BINDING_FIX19_UAT_READONLY_OK prq=1 lines=4 quantity=40 supplier_ids=1,2 rfq=0 quote=0 award=0 business_post=0 session_revoked=1 desktop=1 mobile=1 form_cleared=1 actor=${REQUIRED_USERNAME}`);
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
