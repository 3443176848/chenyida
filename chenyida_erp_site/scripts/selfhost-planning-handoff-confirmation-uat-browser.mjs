import assert from "node:assert/strict";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_planning";
const REQUIRED_CONFIRM = "MAIN_UAT_V2_CONFIRMATION_OPEN_CANCEL_ONLY";
const EXPECTED_PACKAGE_DIGEST = "d67acce3f1e1a049a4025b29adbc3ec1651f398cd43000a445368b04a28bd822";
const username = process.env.ERP_UAT_USERNAME || "";
const password = process.env.ERP_UAT_PASSWORD || "";
const browserBaseUrl = process.env.ERP_BROWSER_BASE_URL || "";

if (browserBaseUrl !== `${REQUIRED_ORIGIN}/`) throw new Error(`ERP_BROWSER_BASE_URL must be exactly ${REQUIRED_ORIGIN}/`);
if (username !== REQUIRED_USERNAME || !password) throw new Error("the canonical Planning UAT credential is required");
if (process.env.ERP_PLANNING_HANDOFF_CONFIRMATION_UAT_CONFIRM !== REQUIRED_CONFIRM) throw new Error(`ERP_PLANNING_HANDOFF_CONFIRMATION_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try {
      const loaded = await import(specifier);
      const chromium = loaded.chromium || loaded.default?.chromium;
      if (chromium) return chromium;
    } catch { /* try the next controlled runner module */ }
  }
  throw new Error("Playwright is required in the Planning UAT runner");
}

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const observedPosts = [];
let authenticated = false;

async function revokeSession() {
  if (!authenticated) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}/api/session`);
  if (response.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) {
      await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, { headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token } }).catch(() => undefined);
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
  assert.equal(session.authenticated, true); assert.equal(session.user?.username, REQUIRED_USERNAME); assert.equal(session.user?.role, "planning");

  await page.goto(`${REQUIRED_ORIGIN}/planning/handoffs`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "计划部门交接工作台", exact: true }).waitFor();
  await page.locator("button.planning-row", { hasText: "PRJ-00000001 · Package ID 2/v2" }).click();
  await page.getByRole("heading", { name: "PRJ-00000001 · 交接包 v2", exact: true }).waitFor();
  await page.getByRole("button", { name: "接收交接包", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认最终接收 Package v2", exact: true }); await dialog.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "取消");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "取消");

  await dialog.getByText("PRJ-00000001", { exact: true }).waitFor();
  await dialog.getByText("ID 2/v2", { exact: true }).waitFor();
  await dialog.getByText("SUBMITTED", { exact: true }).waitFor();
  await dialog.getByText("提交人", { exact: true }).waitFor();
  await dialog.getByText("RESUBMIT 时间", { exact: true }).waitFor();
  await dialog.getByText(/Asia\/Shanghai/).first().waitFor();
  await dialog.getByLabel("前驱退回").getByText("ID 1/v1", { exact: true }).waitFor();
  await dialog.getByLabel("前驱退回").getByText("RETURNED", { exact: true }).waitFor();
  await dialog.getByLabel("前驱退回").getByText("2", { exact: true }).waitFor();
  for (const label of ["RETURN 操作者", "RETURN 时间", "回复操作者", "回复时间", "完整退回原因", "完整回复正文"]) await dialog.getByText(label, { exact: true }).waitFor();
  const returnReason = (await dialog.locator('[aria-label="前驱退回"] .planning-confirm-reason p').textContent())?.trim() || "";
  assert.ok(returnReason.length > 0);
  const responseText = (await dialog.locator('[aria-label="工程回复"] .planning-response-body p').textContent())?.trim() || "";
  assert.ok(responseText.length > 0);
  for (const label of ["RETURN 请求号", "回复请求号"]) {
    const requestId = (await dialog.locator(".planning-copy-row", { hasText: label }).locator("code").textContent())?.trim() || "";
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  }
  await dialog.getByText(/Product A0 · BOM V1/).waitFor();
  await dialog.getByText("Unit Resolution v1 / 件 · PCS", { exact: true }).waitFor();
  assert.equal(await dialog.locator(".planning-confirm-materials li").count(), 4);
  assert.equal(await dialog.locator(".planning-confirm-materials li").getByText("毛需求 10 PCS", { exact: true }).count(), 4);
  await dialog.getByText(/本确认窗口内容来自不可变 v2 谱系/).waitFor();
  for (const consequence of ["写入一条不可变 ACCEPT 事件。", "Package ID 2/v2 转为 ACCEPTED。", "Package ID 1/v1 继续保持 RETURNED。", "当前版本不再允许退回或重复接收。", "不自动创建采购申请、工单、库存或财务记录。"]) await dialog.getByText(consequence, { exact: true }).waitFor();
  await dialog.getByText("下一业务阶段：计划部门基于已接收的Package v2进行物料需求计算和缺料分析，随后通过独立操作形成采购需求交接。", { exact: true }).waitFor();
  for (const boundary of ["当前未指定具体处理人。", "当前未配置处理时限。", "接收本身不会自动执行下一阶段。"]) await dialog.getByText(boundary, { exact: true }).waitFor();
  await dialog.getByText("查看完整 Package SHA-256 摘要", { exact: true }).click();
  await dialog.getByText(EXPECTED_PACKAGE_DIGEST, { exact: true }).waitFor();

  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, "390px confirmation must not overflow");
  const controls = await dialog.locator(".planning-dialog-actions button").evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }; }));
  assert.equal(controls.length, 2); assert.ok(controls.every((rect) => rect.top >= 0 && rect.bottom <= 844 && rect.left >= 0 && rect.right <= 390));
  await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  assert.deepEqual(observedPosts, ["/api/login"]);

  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  authenticated = false;
  assert.deepEqual(observedPosts, ["/api/login", "/api/logout"]);
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  console.info("PLANNING_HANDOFF_CONFIRMATION_UAT_OK login=1 logout=1 cancel=1 business_post=0 accept=0");
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
