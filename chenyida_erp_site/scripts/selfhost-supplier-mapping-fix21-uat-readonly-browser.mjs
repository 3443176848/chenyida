import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX21_SUPPLIER_MAPPING_READONLY_1_ACTIVE_7_PENDING";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const OPERATIONS = { username: "uat_20260729_operations", role: "operations" };
const ACTIVE = {
  mappingId: "224d1965-44ef-4c3e-901e-1926b6b07ff8",
  partNumber: "UAT-A-PCBA-042576",
  supplier: { id: 1, code: "SUP-000001" },
  material: { id: 533, code: "CYD-RB_PCB-000016" },
  approvalRequestId: "b38c84b9-29a1-47ab-b68b-a6baf56e7121",
};
const PENDING = {
  mappingId: "43ca04d8-9933-4dac-ba21-b7fb85741830",
  partNumber: "UAT-A-SENSOR-042576",
  supplier: { id: 1, code: "SUP-000001" },
  material: { id: 534, code: "CYD-RB_SENSOR-000003" },
};

if (process.env.ERP_SUPPLIER_MAPPING_FIX21_UAT_CONFIRM !== REQUIRED_CONFIRM) {
  throw new Error(`ERP_SUPPLIER_MAPPING_FIX21_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);
}

async function canonicalCredential() {
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
  const matches = Array.isArray(document?.accounts)
    ? document.accounts.filter((account) => account?.username === OPERATIONS.username && account?.role === OPERATIONS.role)
    : [];
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password
    || matches[0].must_change_password !== false) {
    throw new Error("the active canonical operations UAT credential is required");
  }
  return { username: OPERATIONS.username, password: matches[0].password };
}

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the FIX-21 readonly UAT runner");
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
  if (["/api/session", "/api/summary", "/api/management-dashboard"].includes(url.pathname)) return true;
  if (url.pathname === "/api/supplier-mappings/review-queue") {
    if (url.searchParams.get("page_size") !== "100") return false;
    return [...url.searchParams.keys()].every((key) => [
      "page_size", "status", "mapping_id", "supplier", "material", "supplier_part_number",
    ].includes(key));
  }
  const preview = url.pathname.match(/^\/api\/supplier-mappings\/([0-9a-f-]+)\/review-preview$/i);
  if (!preview || ![ACTIVE.mappingId, PENDING.mappingId].includes(preview[1])) return false;
  const expectedVersion = preview[1] === ACTIVE.mappingId ? "3" : "2";
  return url.searchParams.size === 1 && url.searchParams.get("expected_version") === expectedVersion;
}

const credential = await canonicalCredential();
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

async function login() {
  const response = await context.request.post(`${REQUIRED_ORIGIN}/api/login`, {
    headers: { Origin: REQUIRED_ORIGIN },
    data: credential,
  });
  authPosts.push("/api/login");
  assert.equal(response.status(), 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual([payload.user?.username, payload.user?.role, payload.user?.is_active, payload.user?.must_change_password],
    [OPERATIONS.username, OPERATIONS.role, true, false]);
  authenticated = true;
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.deepEqual([session.authenticated, session.user?.username, session.user?.role],
    [true, OPERATIONS.username, OPERATIONS.role]);
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

  const session = await login();
  for (const permission of ["supplier_mapping.review_queue", "supplier_mapping.approve", "supplier_mapping.reject"]) {
    assert.ok(session.user.permissions.includes(permission));
  }
  for (const permission of ["supplier_mapping.create", "supplier_mapping.edit_draft", "supplier_mapping.submit"]) {
    assert.ok(!session.user.permissions.includes(permission));
  }

  await page.goto(`${REQUIRED_ORIGIN}/operations/supplier-mappings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "供应商映射运营审核", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 7);
  assert.equal(await page.locator("details.sm-edit").count(), 0);
  assert.equal(await page.getByRole("button", { name: "批准并生效", exact: true }).count(), 7);
  assert.equal(await page.getByRole("button", { name: "退回", exact: true }).count(), 7);
  await noOverflow(page, "operations pending desktop");

  const pendingCard = page.locator("article.sm-card", { hasText: PENDING.partNumber });
  assert.match(await pendingCard.innerText(), new RegExp(PENDING.mappingId));
  assert.match(await pendingCard.innerText(), /Version 1 · Version Fact #\d+ · CAS 2/);
  assert.match(await pendingCard.innerText(), /待审核/);
  assert.match(await pendingCard.innerText(), new RegExp(`ID ${PENDING.supplier.id} / ${PENDING.supplier.code}`));
  assert.match(await pendingCard.innerText(), new RegExp(`ID ${PENDING.material.id} / ${PENDING.material.code}`));
  await pendingCard.getByRole("button", { name: "批准并生效", exact: true }).click();
  const approvalDialog = page.getByRole("dialog", { name: "确认批准并生效" });
  await approvalDialog.waitFor();
  const approvalText = await approvalDialog.innerText();
  for (const fact of [
    PENDING.mappingId, "V1 / CAS 2 / PENDING_REVIEW", `ID ${PENDING.supplier.id} / ${PENDING.supplier.code}`,
    `ID ${PENDING.material.id} / ${PENDING.material.code}`, PENDING.partNumber, "PCS / PCS", "1 : 1",
    "2026-08-05", "创建成功事实", "提交成功事实", "uat_20260729_purchase", "SUCCESS",
    "0 条；冲突 0 条", "Supplier 内料号冲突", "V1 / CAS 2 → V1 / CAS 3", "可参与",
    "RFQ 0 / Quote 0 / Award 0 / PO 0", "批准条件", "满足",
  ]) assert.match(approvalText, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const reviewComment = approvalDialog.getByLabel("审核意见（独立字段，必填）", { exact: true });
  assert.equal(await reviewComment.inputValue(), "");
  assert.equal(await approvalDialog.getByRole("button", { name: "确认批准并生效", exact: true }).isDisabled(), true);
  assert.equal(await reviewComment.evaluate((element) => element === document.activeElement), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "operations approval preview 390x844");
  await page.setViewportSize({ width: 1440, height: 900 });
  await approvalDialog.getByRole("button", { name: "取消", exact: true }).click();
  await approvalDialog.waitFor({ state: "detached" });

  const filter = page.locator("form.sm-filter");
  await filter.locator('select[name="status"]').selectOption("ACTIVE");
  await filter.getByRole("button", { name: "筛选", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 1);
  const activeCard = page.locator("article.sm-card", { hasText: ACTIVE.partNumber });
  assert.match(await activeCard.innerText(), new RegExp(ACTIVE.mappingId));
  assert.match(await activeCard.innerText(), /Version 1 · Version Fact #\d+ · CAS 3/);
  assert.match(await activeCard.innerText(), /已生效/);
  await activeCard.getByRole("button", { name: "查看批准凭证", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "批准成功凭证" });
  await receipt.waitFor();
  const receiptText = await receipt.innerText();
  for (const fact of [
    ACTIVE.mappingId, "APPROVE", "SUCCESS", "uat_20260729_operations", "Asia/Shanghai 时间",
    ACTIVE.approvalRequestId, "历史批准未采集审核意见", "V1 / CAS 2", "V1 / CAS 3", "ACTIVE / 生效",
    `ID ${ACTIVE.supplier.id} / ${ACTIVE.supplier.code}`, `ID ${ACTIVE.material.id} / ${ACTIVE.material.code}`,
    ACTIVE.partNumber, "PCS → PCS · 1:1", "2026-08-05",
  ]) assert.match(receiptText, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "historical approval receipt 390x844");
  await receipt.getByRole("button", { name: "关闭凭证", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await filter.locator('select[name="status"]').selectOption("PENDING_REVIEW");
  await filter.locator('input[name="mapping_id"]').fill("");
  await filter.locator('input[name="supplier_part_number"]').fill("SENSOR-042576");
  await filter.getByRole("button", { name: "筛选", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 2);
  assert.equal(await page.locator("article.sm-card", { hasText: "UAT-A-SENSOR-042576" }).count(), 1);
  assert.equal(await page.locator("article.sm-card", { hasText: "UAT-B-SENSOR-042576" }).count(), 1);

  await filter.locator('input[name="supplier_part_number"]').fill("");
  await filter.locator('input[name="mapping_id"]').fill(PENDING.mappingId);
  await filter.getByRole("button", { name: "筛选", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 1);
  assert.equal(await page.locator("article.sm-card", { hasText: PENDING.mappingId }).count(), 1);

  await filter.locator('input[name="mapping_id"]').fill("");
  await filter.locator('select[name="status"]').selectOption("REJECTED");
  await filter.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByText("没有符合条件的 Supplier Mapping。", { exact: true }).waitFor();
  assert.equal(await page.locator("article.sm-card").count(), 0);

  await filter.locator('select[name="status"]').selectOption("");
  await filter.getByRole("button", { name: "筛选", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article.sm-card").length === 8);
  await noOverflow(page, "operations all-status desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, "operations all-status 390x844");
  await logoutFromPage(page);

  assert.deepEqual(businessWrites, []);
  assert.deepEqual(forbiddenApiGets, []);
  assert.deepEqual(authPosts, ["/api/login", "/api/logout"]);
  assert.deepEqual(browserErrors, []);
  console.info("SUPPLIER_MAPPING_FIX21_UAT_READONLY_OK operations=1 mappings=8 active=1 pending=7 rejected=0 pending_preview=1 cancelled=1 historical_receipt=1 historical_comment_missing=1 status_filter=1 suffix_filter=1 mapping_id_filter=1 business_post=0 rfq=0 quote=0 award=0 po=0 session=0 desktop=1 mobile=1");
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
