import assert from "node:assert/strict";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_PRQ_OPEN_ACCEPT_CANCEL_ONLY";
const REQUEST_CODE = "PRQ-00000001";
const PACKAGE_DIGEST = "d67acce3f1e1a049a4025b29adbc3ec1651f398cd43000a445368b04a28bd822";
const PACKAGE_ACCEPT_REQUEST = "61fcf8bd-3d35-4324-b748-5c34541cbed9";
const PLAN_GENERATE_REQUEST = "cd625756-4e4c-451f-8230-eb8b77d4f6e0";
const PRQ_SUBMIT_REQUEST = "5cd10203-a200-464b-9cf1-fd6955273baf";
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
if (process.env.ERP_PURCHASE_TRACEABILITY_UAT_CONFIRM !== REQUIRED_CONFIRM) throw new Error(`ERP_PURCHASE_TRACEABILITY_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* try the next controlled runner module */ }
  }
  throw new Error("Playwright is required in the Purchase UAT runner");
}

async function assertNoPageOverflow(page, stage) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, `${stage} must not overflow at 390px`);
}

const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const observedPosts = [];
let authenticated = false;

async function revokeSession() {
  if (!authenticated) return;
  const sessionResponse = await context.request.get(`${REQUIRED_ORIGIN}/api/session`);
  if (sessionResponse.ok()) {
    const session = await sessionResponse.json();
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
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user?.username, REQUIRED_USERNAME);
  assert.equal(session.user?.role, "purchase");

  await page.goto(`${REQUIRED_ORIGIN}/planning/purchase-requests`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "采购申请接收工作台", exact: true }).waitFor();
  await page.locator("button.planning-row", { hasText: REQUEST_CODE }).click();
  await page.getByRole("heading", { name: new RegExp(`^${REQUEST_CODE}`) }).waitFor();

  await page.getByText("ID 2/v2", { exact: true }).first().waitFor();
  await page.getByText("ACCEPTED", { exact: true }).first().waitFor();
  await page.getByText(PACKAGE_DIGEST, { exact: true }).waitFor();
  await page.getByText("Product A0", { exact: true }).waitFor();
  await page.getByText(/BOM V1/).waitFor();
  await page.getByText("Unit Resolution v1 · PCS", { exact: true }).waitFor();
  await page.getByText("Package ACCEPT", { exact: true }).waitFor();
  await page.getByText("uat_20260729_planning", { exact: true }).first().waitFor();
  await page.getByText("2026/08/03 00:19:09 Asia/Shanghai", { exact: true }).waitFor();
  await page.getByText(PACKAGE_ACCEPT_REQUEST, { exact: true }).waitFor();
  await page.getByText("SUCCESS · 不可变事件已提交", { exact: true }).first().waitFor();
  await page.getByText("该 ACCEPT 仅确认工程 Package 进入计划阶段，不会自动生成采购单据。", { exact: true }).waitFor();

  await page.getByText("Material Requirement Plan ID 1", { exact: true }).waitFor();
  await page.getByText("2026/08/03 08:55:59 Asia/Shanghai", { exact: true }).first().waitFor();
  await page.getByText("2026/08/03 09:00:02 Asia/Shanghai", { exact: true }).first().waitFor();
  await page.getByText(PLAN_GENERATE_REQUEST, { exact: true }).waitFor();
  await page.getByText("该版本未采集计划说明", { exact: true }).waitFor();
  await page.getByText("净采购 = max(毛需求 - 库存分配 - 在途分配, 0)", { exact: true }).waitFor();

  assert.equal(await page.locator(".purchase-line-card").count(), 4);
  assert.equal(await page.locator(".purchase-key-quantities").getByText("10 PCS", { exact: true }).count(), 12);
  for (const [materialId, code] of EXPECTED_LINES) {
    const card = page.locator(".purchase-line-card", { hasText: code });
    assert.equal(await card.count(), 1);
    await card.getByText(`Material ID ${materialId}`, { exact: true }).waitFor();
    await card.locator("summary").click();
    const snapshot = card.locator(".purchase-allocation-columns section").first();
    await snapshot.getByText("提交时快照", { exact: true }).waitFor();
    assert.equal(await snapshot.getByText("0 PCS", { exact: true }).count(), 4);
    assert.equal(await snapshot.getByText("10 PCS", { exact: true }).count(), 3);
    await card.getByText("当前库存 / 供应状态", { exact: true }).waitFor();
  }

  await page.getByText("Purchase Request ID 1", { exact: true }).waitFor();
  await page.getByText("待采购接收", { exact: true }).first().waitFor();
  await page.getByText("ID 1/v1", { exact: true }).first().waitFor();
  await page.getByText("2026-10-30", { exact: true }).first().waitFor();
  await page.getByText(PRQ_SUBMIT_REQUEST, { exact: true }).waitFor();
  await page.getByText("4 行 · 40 PCS", { exact: true }).waitFor();
  await page.getByText("40 PCS", { exact: true }).first().waitFor();
  for (const fact of ["PRQ未单独版本化；固定引用需求计划v1", "未选择供应商", "未填写价格", "未指定接收人", "未配置处理时限", "该版本未采集采购交接说明"]) await page.getByText(fact, { exact: true }).waitFor();
  await assertNoPageOverflow(page, "purchase detail");

  await page.getByRole("button", { name: "接收采购申请", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `确认接收 ${REQUEST_CODE}`, exact: true });
  await dialog.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
  await dialog.getByText(`${REQUEST_CODE} · ID 1`, { exact: true }).waitFor();
  await dialog.getByText("PRJ-00000001", { exact: true }).waitFor();
  await dialog.getByText("2/v2 · ACCEPT SUCCESS", { exact: true }).waitFor();
  await dialog.getByText("ID 1/v1", { exact: true }).waitFor();
  await dialog.getByRole("heading", { name: "采购需求（4 条）", exact: true }).waitFor();
  assert.equal(await dialog.locator(".planning-confirm-materials li").count(), 4);
  assert.equal(await dialog.locator(".planning-confirm-materials").getByText("10 PCS", { exact: true }).count(), 4);
  await dialog.getByText("40 PCS", { exact: true }).waitFor();
  await dialog.getByText("当前未指定具体处理人。", { exact: true }).waitFor();
  await dialog.getByText("当前未配置处理时限。", { exact: true }).waitFor();
  await dialog.getByText("采购部门基于已接收PRQ开展供应商寻源、询价和报价比较；接收本身不会自动创建RFQ、定标、PO、收货或AP。", { exact: true }).waitFor();
  await assertNoPageOverflow(page, "purchase accept confirmation");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(observedPosts, ["/api/login"]);

  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  authenticated = false;
  assert.deepEqual(observedPosts, ["/api/login", "/api/logout"]);
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  console.info("PURCHASE_TRACEABILITY_UAT_READONLY_OK login=1 logout=1 cancel=1 business_post=0 accept=0 return=0 downstream=0");
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
