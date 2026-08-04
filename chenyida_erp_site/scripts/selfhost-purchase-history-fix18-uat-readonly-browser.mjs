import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const REQUIRED_ORIGIN = "https://43.135.148.43.nip.io:18888";
const REQUIRED_USERNAME = "uat_20260729_purchase";
const REQUIRED_CONFIRM = "MAIN_UAT_FIX18_HISTORY_READONLY";
const CREDENTIAL_PATH = "/credentials/uat-role-accounts.txt";
const REQUEST_CODE = "PRQ-00000001";
const DECISION_REQUEST_ID = "80568b28-47f5-4f58-8901-afc053871998";
const UPSTREAM_REQUEST_IDS = [
  "61fcf8bd-3d35-4324-b748-5c34541cbed9",
  "cd625756-4e4c-451f-8230-eb8b77d4f6e0",
  "5cd10203-a200-464b-9cf1-fd6955273baf",
];
const EXPECTED_MATERIALS = [533, 534, 535, 536];
const SUPPLY_LABELS = [
  "当前在手总量", "当前正式预留", "品质冻结/Hold", "当前库存可用", "有效计划库存分配",
  "当前未分配库存可用", "当前有效在途总量", "有效计划在途分配", "当前未分配在途可用",
];

if (process.env.ERP_PURCHASE_HISTORY_FIX18_UAT_CONFIRM !== REQUIRED_CONFIRM) throw new Error(`ERP_PURCHASE_HISTORY_FIX18_UAT_CONFIRM=${REQUIRED_CONFIRM} is required`);

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
  if (matches.length !== 1 || typeof matches[0].password !== "string" || !matches[0].password || matches[0].must_change_password !== false) {
    throw new Error("the active canonical Purchase UAT credential is required");
  }
  return { username: REQUIRED_USERNAME, password: matches[0].password };
}

async function loadChromium() {
  for (const specifier of [process.env.PLAYWRIGHT_MODULE_PATH, "playwright", "@playwright/test", "playwright-core"].filter(Boolean)) {
    try { const loaded = await import(specifier); const chromium = loaded.chromium || loaded.default?.chromium; if (chromium) return chromium; } catch { /* use the next controlled module */ }
  }
  throw new Error("Playwright is required in the FIX-18 Purchase history UAT runner");
}

async function noOverflow(page, stage) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, `${stage} has page-level horizontal overflow`);
}

const credential = await canonicalPurchaseCredential();
const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] });
const authPosts = [];
const businessWrites = [];
const targetGets = [];
const forbiddenObjectGets = [];
let authenticated = false;

async function revokeSession() {
  if (!authenticated) return;
  const response = await context.request.get(`${REQUIRED_ORIGIN}/api/session`).catch(() => null);
  if (response?.ok()) {
    const session = await response.json();
    if (session.authenticated && session.csrf_token) await context.request.post(`${REQUIRED_ORIGIN}/api/logout`, { headers: { Origin: REQUIRED_ORIGIN, "X-CSRF-Token": session.csrf_token } }).catch(() => undefined);
  }
  authenticated = false;
}

try {
  await context.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method().toUpperCase();
    if (url.origin !== REQUIRED_ORIGIN) return route.abort("blockedbyclient");
    if (method === "GET" && /^\/api\/purchase-requests\/\d+$/.test(url.pathname)) {
      if (url.pathname !== "/api/purchase-requests/1") { forbiddenObjectGets.push(url.pathname); return route.abort("blockedbyclient"); }
      targetGets.push(url.pathname);
    }
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return route.continue();
    if (method === "POST" && ["/api/login", "/api/logout"].includes(url.pathname)) { authPosts.push(url.pathname); return route.continue(); }
    businessWrites.push(`${method} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor();
  await page.getByLabel("账号", { exact: true }).fill(credential.username);
  await page.getByLabel("密码", { exact: true }).fill(credential.password);
  const loginResponse = page.waitForResponse((response) => response.url() === `${REQUIRED_ORIGIN}/api/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  assert.equal((await loginResponse).status(), 200); authenticated = true;
  await page.getByRole("heading", { name: "经营工作台", exact: true }).waitFor();
  const session = await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json();
  assert.deepEqual([session.authenticated, session.user?.username, session.user?.role], [true, REQUIRED_USERNAME, "purchase"]);

  async function openTargetHistory() {
    await page.goto(`${REQUIRED_ORIGIN}/planning/purchase-requests`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "采购申请接收工作台", exact: true }).waitFor();
    await page.getByRole("tab", { name: /待接收申请\s*0/ }).waitFor();
    await page.getByRole("tab", { name: /已处理\s*1/ }).click();
    const row = page.locator("button.planning-row", { hasText: REQUEST_CODE }); assert.equal(await row.count(), 1); await row.click();
    await page.getByRole("heading", { name: new RegExp(`^${REQUEST_CODE}`) }).waitFor();
  }

  async function assertHistory(stage, copyRequestId = false) {
    await page.getByText("该 PRQ 已处理；关系化快照保持只读。", { exact: true }).waitFor();
    for (const heading of ["Package 与 ACCEPT 谱系", "Material Requirement Plan 谱系", "PRQ 提交凭证", "采购决策凭证"]) await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    for (const requestId of UPSTREAM_REQUEST_IDS) await page.getByText(requestId, { exact: true }).waitFor();
    const planFact = await page.locator("dt", { hasText: "采购交接状态" }).locator("..").innerText(); assert.match(planFact, /ACCEPTED/);
    const prqFact = await page.locator("dt", { hasText: "PRQ 状态" }).locator("..").innerText(); assert.match(prqFact, /ACCEPTED/); assert.match(prqFact, /采购已接收/);
    await page.getByText("该字段记录计划部→采购部交接状态；Plan v1 计算快照、行项目、分配及来源摘要仍不可变，ACCEPTED 不表示快照被改写。", { exact: true }).waitFor();

    const evidence = page.locator('[data-purchase-decision-evidence="complete"]'); assert.equal(await evidence.count(), 1);
    const evidenceText = await evidence.innerText();
    for (const expected of ["Purchase Request ID\n1", `PRQ\n${REQUEST_CODE}`, "决策\nACCEPT / 采购接收", "业务事件类型\nPURCHASE_ACCEPTED", `Actor\n${REQUIRED_USERNAME}`, "时间\n2026/08/04 06:06:15 Asia/Shanghai", "展示时区\nAsia/Shanghai", "结果\nSUCCESS", "ACCEPT 事件数量\n1", "RETURN 事件数量\n0", DECISION_REQUEST_ID, "不是 Planning ACCEPT"]) {
      assert.ok(evidenceText.includes(expected), `${stage}: Purchase decision evidence must include ${expected}`);
    }
    if (copyRequestId) {
      const copyRow = evidence.locator(".planning-copy-row", { hasText: "请求号" }); await copyRow.getByRole("button", { name: "复制", exact: true }).click();
      await copyRow.getByRole("button", { name: "已复制", exact: true }).waitFor(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), DECISION_REQUEST_ID);
    }
    assert.equal(await page.getByRole("button", { name: "接收采购申请", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "退回计划部", exact: true }).count(), 0);
    assert.equal(await page.locator(".planning-decision-actions, textarea").count(), 0);
    assert.equal(await page.locator(".purchase-snapshot-card").count(), 4); assert.equal(await page.locator(".purchase-current-card").count(), 4); assert.equal(await page.locator(".purchase-difference-card").count(), 4);
    for (const materialId of EXPECTED_MATERIALS) await page.getByText(`Material ID ${materialId}`, { exact: true }).first().waitFor();
    for (const card of await page.locator(".purchase-snapshot-card").all()) { const text = await card.innerText(); assert.match(text, /毛需求\s*10\s*PCS/); assert.match(text, /净采购\s*10\s*PCS/); assert.match(text, /PRQ 申请量\s*10\s*PCS/); }
    for (const card of await page.locator(".purchase-current-card").all()) { const text = await card.innerText(); for (const label of SUPPLY_LABELS) assert.match(text, new RegExp(`${label}\\s*0\\s*PCS`)); assert.equal(await card.locator(".planning-quantity").count(), 9); }
    await noOverflow(page, stage);
  }

  await openTargetHistory(); await assertHistory("desktop history", true);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "采购申请接收工作台", exact: true }).waitFor(); await page.getByRole("tab", { name: /已处理\s*1/ }).click(); await page.locator("button.planning-row", { hasText: REQUEST_CODE }).click(); await assertHistory("history after refresh");
  await page.setViewportSize({ width: 390, height: 844 }); await assertHistory("390x844 history");

  await page.goto(`${REQUIRED_ORIGIN}/`, { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录晨亿达 ERP", exact: true }).waitFor(); authenticated = false;
  assert.equal((await (await context.request.get(`${REQUIRED_ORIGIN}/api/session`)).json()).authenticated, false);
  const protectedContentGone = () => page.waitForFunction((requestCode) => !document.body.innerText.includes(requestCode) && (document.body.innerText.includes("登录晨亿达 ERP") || document.body.innerText.includes("请先登录")), REQUEST_CODE);
  await page.goBack({ waitUntil: "domcontentloaded" }); await protectedContentGone(); await page.goForward({ waitUntil: "domcontentloaded" }); await protectedContentGone(); await page.reload({ waitUntil: "domcontentloaded" }); await protectedContentGone();

  assert.deepEqual(businessWrites, []); assert.deepEqual(forbiddenObjectGets, []); assert.deepEqual(authPosts, ["/api/login", "/api/logout"]); assert.equal(targetGets.length, 2);
  console.info(`PURCHASE_HISTORY_FIX18_UAT_READONLY_OK prq=1 accept=1 return=0 result=SUCCESS actor=${REQUIRED_USERNAME} business_post=0 target_get=2 other_object_get=0 session_revoked=1 desktop=1 mobile=1 refresh=1`);
} finally {
  await revokeSession().catch(() => undefined);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
