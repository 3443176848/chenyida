import assert from "node:assert/strict";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_PURCHASE_SUPPLY_OPEN_ACCEPT_CANCEL_ONLY";
const REQUEST_CODE = "PRQ-00000001";
const EXPECTED_LINES = [
  [533, "CYD-RB_PCB-000016"],
  [534, "CYD-RB_SENSOR-000003"],
  [535, "CYD-RB_CONN-000075"],
  [536, "CYD-RB_METAL-000015"],
];

const username = process.env.ERP_UAT_USERNAME || "";
const password = process.env.ERP_UAT_PASSWORD || "";
const browserBaseUrl = process.env.ERP_BROWSER_BASE_URL || "";
if (browserBaseUrl !== `${REQUIRED_ORIGIN}/`) throw new Error(`ERP_BROWSER_BASE_URL must be exactly ${REQUIRED_ORIGIN}/`);
if (username !== REQUIRED_USERNAME || !password) throw new Error("the canonical Purchase UAT credential is required");
if (process.env.ERP_PURCHASE_SUPPLY_UAT_CONFIRM !== REQUIRED_CONFIRM) throw new Error(`ERP_PURCHASE_SUPPLY_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the Purchase supply UAT runner");
}

async function assertNoOverflow(page, stage) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, `${stage} must not overflow at 390px`);
}

async function assertQuantity(quantity, expected) {
  assert.equal((await quantity.textContent()).replace(/\s+/g, " ").trim(), expected);
  const geometry = await quantity.evaluate((element) => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return { display: style.display, whiteSpace: style.whiteSpace, width: rect.width, height: rect.height }; });
  assert.equal(geometry.display, "inline-flex");
  assert.equal(geometry.whiteSpace, "nowrap");
  assert.ok(geometry.width > 20 && geometry.height < 40);
}

const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const observedPosts = [];
const detailGets = [];
let authenticated = false;

async function revokeSession() {
  if (!authenticated) return;
  const sessionResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/session`);
  if (sessionResponse.ok()) {
    const session = await sessionResponse.json();
    if (session.authenticated && session.csrf_token) await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, { headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token } }).catch(() => undefined);
  }
  authenticated = false;
}

try {
  await context.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method().toUpperCase();
    if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && url.pathname === "/api/purchase-requests/1") detailGets.push(url.pathname);
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    observedPosts.push(url.pathname);
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) return route.continue();
    return route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const loginResponse = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  assert.equal((await loginResponse).status(), 200);
  authenticated = true;
  await page.getByRole("heading", { name: "经营工作台", exact: true }).waitFor();

  await page.goto(`${REQUIRED_ORIGIN}/planning/purchase-requests`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "采购申请接收工作台", exact: true }).waitFor();
  await page.locator("button.planning-row", { hasText: REQUEST_CODE }).click();
  await page.getByRole("heading", { name: new RegExp(`^${REQUEST_CODE}`) }).waitFor();
  for (const title of ["1. 提交时快照", "2. 当前供应状态", "3. 差异提示"]) await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await page.getByText("ID 2/v2", { exact: true }).first().waitFor();
  await page.getByText("Material Requirement Plan ID 1", { exact: true }).waitFor();
  await page.getByText("待采购接收", { exact: true }).first().waitFor();
  await page.locator(".purchase-query-time").getByText(/查询时间：.*Asia\/Shanghai/).waitFor();
  assert.equal(await page.locator(".purchase-snapshot-card").count(), 4);
  assert.equal(await page.locator(".purchase-current-card").count(), 4);
  assert.equal(await page.locator(".purchase-difference-card").count(), 4);

  for (const [materialId, code] of EXPECTED_LINES) {
    const snapshot = page.locator(".purchase-snapshot-card", { hasText: code });
    const current = page.locator(".purchase-current-card", { hasText: code });
    const difference = page.locator(".purchase-difference-card", { hasText: code });
    assert.equal(await snapshot.count(), 1); assert.equal(await current.count(), 1); assert.equal(await difference.count(), 1);
    await snapshot.getByText(`Material ID ${materialId}`, { exact: true }).waitFor();
    assert.equal(await snapshot.getByText("10 PCS", { exact: true }).count(), 3);
    assert.equal(await snapshot.getByText("0 PCS", { exact: true }).count(), 4);
    const currentText = await current.innerText();
    for (const label of ["当前在手总量", "当前正式预留", "品质冻结/Hold", "当前库存可用", "有效计划库存分配", "当前未分配库存可用", "当前有效在途总量", "有效计划在途分配", "当前未分配在途可用"]) assert.match(currentText, new RegExp(label));
    assert.equal((currentText.match(/模型未单独记录/g) || []).length, 2);
    await current.getByText("MAIN · 0 个位置（0 个批次位置）", { exact: true }).waitFor();
    const currentQuantities = current.locator(".planning-quantity");
    assert.equal(await currentQuantities.count(), 9);
    for (const quantity of await currentQuantities.all()) await assertQuantity(quantity, "0 PCS");
    assert.equal(await difference.getByText("0 PCS", { exact: true }).count(), 2);
    assert.equal(await difference.getByText("10 PCS", { exact: true }).count(), 1);
  }
  await page.locator(".purchase-supply-formulas summary").click();
  await page.getByText(/库存可用 = Σ在手 - Σ正式预留 - Σ冻结\/Hold/).waitFor();
  await assertNoOverflow(page, "purchase supply detail");

  const getBefore = detailGets.length;
  await page.getByRole("button", { name: "接收采购申请", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `确认接收 ${REQUEST_CODE}`, exact: true });
  await dialog.waitFor();
  assert.equal(detailGets.length, getBefore + 1);
  await dialog.getByText("已重新读取当前供应", { exact: true }).waitFor();
  await dialog.getByRole("heading", { name: "提交数量与当前供应（4 条）", exact: true }).waitFor();
  await dialog.getByText("接收不会修改库存、正式预留或 Planning Allocation。", { exact: true }).waitFor();
  await dialog.getByText("接收不会自动创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP 或 Work Order。", { exact: true }).waitFor();
  assert.equal(await dialog.locator(".purchase-confirm-supply-cards article").count(), 4);
  for (const [, code] of EXPECTED_LINES) {
    const card = dialog.locator(".purchase-confirm-supply-cards article", { hasText: code });
    assert.equal(await card.getByText("10 PCS", { exact: true }).count(), 1);
    assert.equal(await card.getByText("0 PCS", { exact: true }).count(), 8);
  }
  await assertNoOverflow(page, "purchase supply confirmation");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(observedPosts, ["/api/login"]);

  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  authenticated = false;
  assert.deepEqual(observedPosts, ["/api/login", "/api/logout"]);
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  console.info("PURCHASE_SUPPLY_UAT_READONLY_OK lines=4 refresh_get=1 cancel=1 business_post=0 accept=0 return=0 downstream=0");
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
