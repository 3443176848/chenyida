import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const REQUEST_CODE = "PRQ-00000001";
const PACKAGE_DIGEST = "d67acce3f1e1a049a4025b29adbc3ec1651f398cd43000a445368b04a28bd822";
const PACKAGE_ACCEPT_REQUEST_ID = "61fcf8bd-3d35-4324-b748-5c34541cbed9";
const PLAN_GENERATE_REQUEST_ID = "cd625756-4e4c-451f-8230-eb8b77d4f6e0";
const PRQ_SUBMIT_REQUEST_ID = "5cd10203-a200-464b-9cf1-fd6955273baf";
const EXPECTED_MATERIALS = [533, 534, 535, 536];
const SUPPLY_LABELS = [
  "当前在手总量",
  "当前正式预留量",
  "当前品质冻结量",
  "当前库存可用量",
  "当前计划库存分配量",
  "当前未分配库存可用量",
  "当前有效在途总量",
  "当前计划在途分配量",
  "当前未分配在途可用量",
];

async function canonicalPurchaseCredential() {
  const metadata = await lstat(CREDENTIAL_PATH);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1 || metadata.size < 2 || metadata.size > 65536) {
    throw new Error("canonical Purchase UAT credential metadata is invalid");
  }
  let document;
  try { document = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8")); } catch { throw new Error("canonical Purchase UAT credential schema is invalid"); }
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
    } catch { /* continue through the controlled module list */ }
  }
  throw new Error("Playwright is required in the FIX-17 Purchase UAT runner");
}

async function assertNoOverflow(page, stage) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, `${stage} must not overflow at 390px`);
}

async function factValue(scope, label) {
  return scope.locator("dt", { hasText: label }).locator("..").locator("dd").innerText();
}

async function assertEvent(scope, { title, actionType, actor, time, requestId }) {
  const event = scope.locator(".planning-event", { hasText: title });
  assert.equal(await event.count(), 1);
  const text = await event.innerText();
  for (const expected of [actionType, actor, time, "Asia/Shanghai", requestId, "SUCCESS", "不可变事件已提交"]) {
    assert.ok(text.includes(expected), `${title} must display ${expected}`);
  }
}

const credential = await canonicalPurchaseCredential();
const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const writePaths = [];
const detailGets = [];
const forbiddenObjectGets = [];
let delayNextDetail = false;
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
    if (method === "GET" && /^\/api\/purchase-requests\/\d+$/.test(url.pathname)) {
      if (url.pathname !== "/api/purchase-requests/1") {
        forbiddenObjectGets.push(url.pathname);
        return route.abort("blockedbyclient");
      }
      detailGets.push(url.pathname);
      if (delayNextDetail) {
        delayNextDetail = false;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    writePaths.push(url.pathname);
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) return route.continue();
    return route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credential.username);
  await page.getByLabel("密码", { exact: true }).fill(credential.password);
  const loginResponse = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  assert.equal((await loginResponse).status(), 200);
  authenticated = true;
  await page.getByRole("heading", { name: "经营工作台", exact: true }).waitFor();

  await page.goto(`${REQUIRED_ORIGIN}/planning/purchase-requests`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "采购申请接收工作台", exact: true }).waitFor();
  await page.getByRole("tab", { name: /待接收申请\s*1/ }).waitFor();
  await page.getByRole("tab", { name: /已处理\s*0/ }).waitFor();
  const row = page.locator("button.planning-row", { hasText: REQUEST_CODE });
  assert.equal(await row.count(), 1);
  await row.click();
  await page.getByRole("heading", { name: new RegExp(`^${REQUEST_CODE}`) }).waitFor();
  await page.getByText("Purchase Request ID 1", { exact: true }).waitFor();
  await page.getByText("待采购接收", { exact: true }).first().waitFor();
  const detailCounts = await page.locator(".purchase-decision-counts").innerText();
  assert.match(detailCounts, /ACCEPT 事件数量\s*0/);
  assert.match(detailCounts, /RETURN 事件数量\s*0/);
  const initialQueryTime = (await page.locator(".purchase-query-time").innerText()).replace(/^查询时间：/, "");
  await assertNoOverflow(page, "Purchase Request detail");

  await page.waitForTimeout(1100);
  const getBefore = detailGets.length;
  delayNextDetail = true;
  await page.getByRole("button", { name: "接收采购申请", exact: true }).click();
  const loading = page.getByRole("dialog", { name: `接收前复核 ${REQUEST_CODE}`, exact: true });
  await loading.waitFor();
  await loading.getByRole("heading", { name: "正在重新读取当前供应", exact: true }).waitFor();
  assert.equal(await loading.getByRole("button", { name: "等待完整数据", exact: true }).isDisabled(), true);
  assert.equal(await loading.getByRole("button", { name: "取消", exact: true }).evaluate((button) => button === document.activeElement), true);

  const dialog = page.getByRole("dialog", { name: `确认接收 ${REQUEST_CODE}`, exact: true });
  await dialog.waitFor();
  assert.equal(detailGets.length, getBefore + 1);
  assert.equal(await dialog.getByRole("button", { name: "取消", exact: true }).evaluate((button) => button === document.activeElement), true);
  assert.equal(await dialog.getByRole("button", { name: "确认接收", exact: true }).isEnabled(), true);

  const requestSection = dialog.locator(".planning-confirm-section", { hasText: "PRQ 与项目" });
  assert.equal((await factValue(requestSection, "Purchase Request ID")).trim(), "1");
  assert.equal((await factValue(requestSection, "PRQ 编号")).trim(), REQUEST_CODE);
  assert.equal((await factValue(requestSection, "项目")).trim(), "PRJ-00000001");
  assert.equal((await factValue(requestSection, "需求日期")).trim(), "2026-10-30");
  assert.equal((await factValue(requestSection, "状态")).trim(), "待采购接收");
  const refreshedQueryTime = (await factValue(requestSection, "当前供应查询时间")).trim();
  assert.notEqual(refreshedQueryTime, initialQueryTime);
  assert.match(refreshedQueryTime, /Asia\/Shanghai$/);
  await dialog.getByText("已重新读取当前供应", { exact: true }).waitFor();

  const packageSection = dialog.locator(".planning-confirm-section", { hasText: "Package ACCEPT 完整凭证" });
  await packageSection.getByText("ID 2/v2", { exact: true }).waitFor();
  await packageSection.getByText(PACKAGE_DIGEST, { exact: true }).waitFor();
  await assertEvent(packageSection, {
    title: "Package ACCEPT", actionType: "ACCEPT / ACCEPTED", actor: "uat_20260729_planning",
    time: "2026/08/03 00:19:09 Asia/Shanghai", requestId: PACKAGE_ACCEPT_REQUEST_ID,
  });

  const planSection = dialog.locator(".planning-confirm-section", { hasText: "Plan GENERATE 完整凭证" });
  await planSection.getByText("ID 1/v1", { exact: true }).waitFor();
  assert.equal((await factValue(planSection, "计算时间")).trim(), "2026/08/03 08:55:59 Asia/Shanghai");
  assert.equal((await factValue(planSection, "快照截止时间")).trim(), "2026/08/03 09:00:02 Asia/Shanghai");
  await assertEvent(planSection, {
    title: "Plan GENERATE", actionType: "GENERATE / GENERATED", actor: "uat_20260729_planning",
    time: "2026/08/03 08:55:59 Asia/Shanghai", requestId: PLAN_GENERATE_REQUEST_ID,
  });

  const submitSection = dialog.locator(".planning-confirm-section", { hasText: "PRQ SUBMIT 完整凭证" });
  await assertEvent(submitSection, {
    title: "PRQ SUBMIT", actionType: "SUBMIT / SUBMITTED", actor: "uat_20260729_planning",
    time: "2026/08/03 09:00:02 Asia/Shanghai", requestId: PRQ_SUBMIT_REQUEST_ID,
  });

  const decisionText = await dialog.locator(".purchase-decision-counts").innerText();
  assert.match(decisionText, /接收前 ACCEPT\s*0/);
  assert.match(decisionText, /接收前 RETURN\s*0/);

  const cards = dialog.locator(".purchase-accept-material-card");
  assert.equal(await cards.count(), 4);
  for (const materialId of EXPECTED_MATERIALS) {
    const card = cards.filter({ hasText: `Material ID ${materialId}` });
    assert.equal(await card.count(), 1);
    assert.equal((await factValue(card, "毛需求")).replace(/\s+/g, " ").trim(), "10 PCS");
    assert.equal((await factValue(card, "快照库存可用")).replace(/\s+/g, " ").trim(), "0 PCS");
    assert.equal((await factValue(card, "快照库存分配")).replace(/\s+/g, " ").trim(), "0 PCS");
    assert.equal((await factValue(card, "快照在途可用")).replace(/\s+/g, " ").trim(), "0 PCS");
    assert.equal((await factValue(card, "快照在途分配")).replace(/\s+/g, " ").trim(), "0 PCS");
    assert.equal((await factValue(card, "净采购")).replace(/\s+/g, " ").trim(), "10 PCS");
    assert.equal((await factValue(card, "PRQ 申请量")).replace(/\s+/g, " ").trim(), "10 PCS");
    const currentNine = card.locator('[data-current-supply-nine="complete"]');
    for (const label of SUPPLY_LABELS) {
      assert.equal((await factValue(currentNine, label)).replace(/\s+/g, " ").trim(), "0 PCS");
    }
    assert.equal(await currentNine.locator(".planning-quantity").count(), 9);
  }

  const dialogText = await dialog.innerText();
  for (const expected of [
    "库存可用 = 在手 - 正式预留 - 品质冻结。",
    "未分配库存 = max（库存可用 - 计划库存分配，0）。",
    "未分配在途 = max（有效在途 - 计划在途分配，0）。",
    "计划分配不等于正式 reserved_qty。",
    "有效在途排除已收货、完成、取消及关闭来源。",
    "当前供应只用于本次复核，不会改写已提交快照。",
    "只新增一条不可变 Purchase ACCEPT（PURCHASE_ACCEPTED）事件。",
    "不修改 Package、Plan、PRQ 明细、库存、正式预留或 Planning Allocation。",
    "不自动创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP 或 Work Order。",
    "当前未指定具体处理人，也未配置处理时限。",
    "采购寻源、询价和报价比较由后续独立受控操作完成；本次接收不会开始上述流程。",
  ]) assert.ok(dialogText.includes(expected), `confirmation must display ${expected}`);
  await assertNoOverflow(page, "Purchase acceptance confirmation");

  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(writePaths, ["/api/login"]);
  assert.deepEqual(forbiddenObjectGets, []);

  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  authenticated = false;
  assert.deepEqual(writePaths, ["/api/login", "/api/logout"]);
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);

  const protectedContentGone = () => page.waitForFunction((requestCode) => !document.body.innerText.includes(requestCode)
    && (document.body.innerText.includes("登录晨亿达 ERP") || document.body.innerText.includes("请先登录")), REQUEST_CODE);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await protectedContentGone();
  await page.goForward({ waitUntil: "domcontentloaded" });
  await protectedContentGone();
  await page.reload({ waitUntil: "domcontentloaded" });
  await protectedContentGone();
  assert.equal(await page.getByText(REQUEST_CODE, { exact: true }).count(), 0);

  console.info("PURCHASE_CONFIRMATION_FIX17_UAT_READONLY_OK purchase_only=1 prq=1 accept=0 return=0 materials=4 supply_fields=9 refresh=1 cancel=1 business_post=0 session_revoked=1 protected_history=0 downstream=0");
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
