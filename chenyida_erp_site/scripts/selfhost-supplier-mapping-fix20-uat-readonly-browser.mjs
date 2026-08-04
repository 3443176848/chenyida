import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX20_SUPPLIER_MAPPING_READONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const ACCOUNTS = [
  { username: "uat_20260729_purchase", role: "purchase" },
  { username: "uat_20260729_operations", role: "operations" },
];
const scope = process.env.ERP_SUPPLIER_MAPPING_FIX20_UAT_SCOPE || "full";
if (!["full", "purchase"].includes(scope)) throw new Error("FIX-20 UAT scope must be full or purchase");
const requiredAccounts = scope === "purchase" ? ACCOUNTS.filter((account) => account.role === "purchase") : ACCOUNTS;
const MATERIALS = [
  { id: "533", code: "CYD-RB_PCB-000016" },
  { id: "534", code: "CYD-RB_SENSOR-000003" },
  { id: "535", code: "CYD-RB_CONN-000075" },
  { id: "536", code: "CYD-RB_METAL-000015" },
];
const SUPPLIERS = [
  { id: "1", code: "SUP-000001" },
  { id: "2", code: "SUP-000002" },
];

if (process.env.ERP_SUPPLIER_MAPPING_FIX20_UAT_CONFIRM !== REQUIRED_CONFIRM) {
  throw new Error(`ERP_SUPPLIER_MAPPING_FIX20_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);
}

async function canonicalCredentials() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1 || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical UAT credential metadata is invalid");
  }
  let document;
  try {
    document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  } catch {
    throw new Error("canonical UAT credential schema is invalid");
  }
  return Object.fromEntries(requiredAccounts.map((required) => {
    const matches = Array.isArray(document?.accounts)
      ? document.accounts.filter((account) => account?.username === required.username && account?.role === required.role)
      : [];
    if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
      || matches[0].must_change_password !== false) {
      throw new Error(`the active canonical ${required.role} UAT credential is required`);
    }
    return [required.role, { username: required.username, password: matches[0].password }];
  }));
}

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the FIX-20 readonly UAT runner");
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

function allowedApiGet(url) {
  const target = `${url.pathname}${url.search}`;
  if (url.pathname === "/api/session") return true;
  if (target === "/api/supplier-mappings?page_size=100") return true;
  if (target === "/api/supplier-mappings/review-queue?page_size=100") return true;
  if (url.pathname === "/api/supplier-mappings/options") {
    return ["supplier", "material", "unit"].includes(url.searchParams.get("type") || "")
      && url.searchParams.get("limit") === "20";
  }
  return target === "/api/procurement/rfqs?queue=accepted&page_size=100"
    || target === "/api/procurement/rfqs?page_size=100"
    || target === "/api/procurement/rfqs/coverage?purchase_request_id=1";
}

const credentials = await canonicalCredentials();
const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
const authPosts = [];
const businessWrites = [];
const forbiddenApiGets = [];
const browserErrors = [];
let authenticated = false;

async function login(role) {
  const response = await context.request.post(`${REQUIRED_ORIGIN}/api/login`, {
    headers: { Origin: REQUIRED_ORIGIN },
    data: credentials[role],
  });
  authPosts.push("/api/login");
  assert.equal(response.status(), 200);
  authenticated = true;
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.deepEqual([session.authenticated, session.user?.username, session.user?.role],
    [true, credentials[role].username, role]);
  assert.equal(typeof session.csrf_token, "string");
  return session;
}

async function logoutFromPage(page) {
  await page.getByRole("button", { name: "安全退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
}

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
    if (method === "GET" && url.pathname.startsWith("/api/") && !allowedApiGet(url)) {
      forbiddenApiGets.push(`${url.pathname}${url.search}`);
      return route.abort("blockedbyclient");
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
  page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) browserErrors.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
  });

  const purchaseSession = await login("purchase");
  assert.ok(purchaseSession.user.permissions.includes("supplier_mapping.create"));
  assert.ok(purchaseSession.user.permissions.includes("supplier_mapping.edit_draft"));
  assert.ok(purchaseSession.user.permissions.includes("supplier_mapping.submit"));
  assert.ok(!purchaseSession.user.permissions.includes("supplier_mapping.approve"));
  assert.ok(!purchaseSession.user.permissions.includes("supplier_mapping.reject"));

  await page.goto(`${REQUIRED_ORIGIN}/procurement/supplier-mappings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "供应商物料映射", exact: true }).waitFor();
  await page.getByText("没有符合条件的 Supplier Mapping。", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "新建映射", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "保存草稿", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "提交审核（保存草稿后可用）", exact: true }).isDisabled(), true);
  assert.equal(await page.locator("article.sm-card").count(), 0);
  const supplierSearch = page.locator(".sm-option-searches label").filter({ hasText: "搜索 Supplier" });
  for (const supplier of SUPPLIERS) {
    await supplierSearch.locator("input").fill(supplier.code);
    await supplierSearch.getByRole("button", { name: "有界搜索", exact: true }).click();
    const option = page.locator(`select[name="supplier_id"] option[value="${supplier.id}"]`);
    await option.waitFor({ state: "attached" });
    assert.match(await option.innerText(), new RegExp(`ID ${supplier.id} / ${supplier.code}`));
  }
  const materialSearch = page.locator(".sm-option-searches label").filter({ hasText: "搜索 Material" });
  for (const material of MATERIALS) {
    await materialSearch.locator("input").fill(material.code);
    await materialSearch.getByRole("button", { name: "有界搜索", exact: true }).click();
    const option = page.locator(`select[name="material_id"] option[value="${material.id}"]`);
    await option.waitFor({ state: "attached" });
    assert.match(await option.innerText(), new RegExp(`ID ${material.id} / ${material.code}`));
  }
  assert.equal(await page.locator('input[name="supplier"]').count(), 1);
  assert.equal(await page.locator('input[name="material"]').count(), 1);
  assert.equal(await page.locator('input[name="supplier_part_number"]').count(), 1);
  await noOverflow(page, "purchase supplier mapping desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "purchase supplier mapping 390x844");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${REQUIRED_ORIGIN}/procurement/sourcing`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "供应商询价与定标", exact: true }).waitFor();
  await page.locator('select[name="purchase_request_id"] option[value="1"]').waitFor({ state: "attached" });
  const requestLines = page.locator("article.rfq-request li");
  await requestLines.nth(3).waitFor();
  assert.equal(await requestLines.count(), 4);
  for (const material of MATERIALS) {
    assert.equal((await requestLines.filter({ hasText: `Material ${material.id} / ${material.code}` }).count()), 1);
  }
  const supplierCards = page.locator("article.rfq-supplier");
  await supplierCards.nth(1).waitFor();
  assert.equal(await supplierCards.count(), 2);
  for (const supplier of SUPPLIERS) {
    const card = supplierCards.filter({ hasText: `Supplier ${supplier.id} / ${supplier.code}` });
    assert.equal(await card.count(), 1);
    assert.match(await card.innerText(), /覆盖 0\/4 · 不可选/);
    assert.match(await card.innerText(), /缺少当前有效 1:1 Supplier Mapping/);
    assert.equal(await card.locator('input[name="supplier_ids"]').isDisabled(), true);
    for (const material of MATERIALS) {
      assert.match(await card.innerText(), new RegExp(`Material ${material.id} / ${material.code}`));
    }
  }
  assert.equal(await page.getByRole("button", { name: "建立询价草稿", exact: true }).isDisabled(), true);
  await page.getByText("尚无 RFQ。", { exact: true }).waitFor();
  await noOverflow(page, "RFQ coverage desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "RFQ coverage 390x844");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${REQUIRED_ORIGIN}/procurement/supplier-mappings`, { waitUntil: "domcontentloaded" });
  await page.getByText("没有符合条件的 Supplier Mapping。", { exact: true }).waitFor();
  await logoutFromPage(page);

  if (scope === "full") {
    const operationsSession = await login("operations");
    assert.ok(operationsSession.user.permissions.includes("supplier_mapping.review_queue"));
    assert.ok(operationsSession.user.permissions.includes("supplier_mapping.approve"));
    assert.ok(operationsSession.user.permissions.includes("supplier_mapping.reject"));
    assert.ok(!operationsSession.user.permissions.includes("supplier_mapping.create"));
    assert.ok(!operationsSession.user.permissions.includes("supplier_mapping.edit_draft"));
    assert.ok(!operationsSession.user.permissions.includes("supplier_mapping.submit"));

    await page.goto(`${REQUIRED_ORIGIN}/operations/supplier-mappings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "供应商映射运营审核", exact: true }).waitFor();
    await page.getByText("当前审核队列为 0。", { exact: true }).waitFor();
    assert.match(await page.locator("main").innerText(), /正文已冻结且没有编辑入口/);
    assert.equal(await page.locator("article.sm-card").count(), 0);
    assert.equal(await page.locator("details.sm-edit").count(), 0);
    assert.equal(await page.getByRole("button", { name: "批准并生效", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "退回", exact: true }).count(), 0);
    await noOverflow(page, "operations review desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, "operations review 390x844");
    await logoutFromPage(page);
  }

  assert.deepEqual(businessWrites, []);
  assert.deepEqual(forbiddenApiGets, []);
  assert.deepEqual(authPosts, scope === "full"
    ? ["/api/login", "/api/logout", "/api/login", "/api/logout"]
    : ["/api/login", "/api/logout"]);
  assert.deepEqual(browserErrors, []);
  console.info(`SUPPLIER_MAPPING_FIX20_UAT_READONLY_OK purchase_entry=1 operations_entry=${scope === "full" ? 1 : 0} queue=${scope === "full" ? 0 : "not_run"} coverage=0/4x2 missing=4x2 supplier_selectable=0 mappings=0 rfq=0 quote=0 award=0 business_post=0 sessions_revoked=${scope === "full" ? 2 : 1} desktop=1 mobile=1`);
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
