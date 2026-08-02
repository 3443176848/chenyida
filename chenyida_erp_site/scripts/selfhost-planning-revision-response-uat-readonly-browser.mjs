import assert from "node:assert/strict";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_engineering";
const REQUIRED_CONFIRM = "MAIN_UAT_ENGINEERING_READONLY_NO_RESPONSE_NO_V2";
const username = process.env.ERP_UAT_USERNAME || "";
const password = process.env.ERP_UAT_PASSWORD || "";
const browserBaseUrl = process.env.ERP_BROWSER_BASE_URL || "";

if (browserBaseUrl !== `${REQUIRED_ORIGIN}/`) throw new Error(`ERP_BROWSER_BASE_URL must be exactly ${REQUIRED_ORIGIN}/`);
if (username !== REQUIRED_USERNAME || !password) throw new Error("the canonical Engineering UAT credential is required");
if (process.env.ERP_PLANNING_REVISION_UAT_READONLY_CONFIRM !== REQUIRED_CONFIRM) throw new Error(`ERP_PLANNING_REVISION_UAT_READONLY_CONFIRM=${REQUIRED_CONFIRM} is required`);

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try { const loaded = await import(specifier); if (loaded.chromium) return loaded.chromium; } catch { /* try the next isolated runner module */ }
  }
  throw new Error("Playwright is required in the read-only UAT runner");
}

const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ["--disable-dev-shm-usage"],
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
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) {
      observedPosts.push(url.pathname);
      return route.continue();
    }
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
  assert.equal(session.user?.role, "engineering");

  await page.goto(`${REQUIRED_ORIGIN}/engineering/projects/1/planning?package=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "PRJ-00000001 · 交接包 v1", exact: true }).waitFor();
  await page.getByText("已退回", { exact: true }).first().waitFor();
  await page.getByText("UAT退回验证:请在工程交接说明中补充“本批计划数量10 PCS,按BOM V1四项物料整批齐套”。保持Product A0、BOM V1、Unit Resolution v1及四项物料数量不变后提交v2。", { exact: true }).first().waitFor();
  await page.getByText("尚无已保存回复；生成 v2 保持禁用。", { exact: true }).waitFor();

  const responseEditor = page.getByLabel("回复正文（必填，10—2000 字符）", { exact: true });
  assert.equal(await responseEditor.count(), 1);
  assert.equal(await responseEditor.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "生成 v2", exact: true }).isDisabled(), true);
  assert.equal(await page.locator("select").count(), 0, "reply-only mode must not render Product/BOM or Unit selectors");
  await page.getByText(/UAT-BB-PROD-042576 A0 .* V1/).waitFor();
  await page.getByText(/Unit Resolution v1 .* 需求 10 PCS/).waitFor();
  assert.equal(await page.locator(".planning-material-card").count(), 4);
  assert.equal(await page.locator(".planning-material-card").getByText("10 PCS", { exact: true }).count(), 4);
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, "390px Planning detail must not overflow");

  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  authenticated = false;
  assert.deepEqual(observedPosts, ["/api/login", "/api/logout"]);
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  console.info("PLANNING_REVISION_UAT_READONLY_OK login=1 logout=1 business_post=0 response_write=0 successor_write=0 planning_login=0");
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
