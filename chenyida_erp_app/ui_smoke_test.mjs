import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = __dirname;
const workspace = path.dirname(appDir);
const python = "C:\\Users\\tu661\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const port = 8767;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = path.join(appDir, "data", "ui-smoke");

async function waitForServer(proc) {
  let lastError = null;
  for (let i = 0; i < 30; i += 1) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited early: ${proc.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server not ready: ${lastError?.message || "timeout"}`);
}

const dbPath = path.join(outputDir, "ui-smoke.sqlite3");
await fs.mkdir(outputDir, { recursive: true });
await fs.rm(dbPath, { force: true });

const proc = spawn(python, [
  path.join(appDir, "server.py"),
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
], {
  cwd: workspace,
  env: { ...process.env, CYD_ERP_DB: dbPath },
  stdio: "pipe",
});

try {
  await waitForServer(proc);
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByText("晨亿达 ERP 登录").waitFor();
  await page.locator("#loginUsername").fill("admin");
  await page.locator("#loginPassword").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#userName", { hasText: "系统管理员" }).waitFor();
  await page.getByText("产品工程").first().click();
  await page.getByText("新增产品工程卡").waitFor();
  await page.getByText("客户供应商").first().click();
  await page.locator("#customerName").fill("浏览器测试客户档案");
  await page.locator("#customerContact").fill("浏览器联系人");
  await page.getByRole("button", { name: "保存客户" }).click();
  await page.locator("#partnerMsg").getByText(/CUS-/).waitFor();
  await page.locator("#supplierName").fill("浏览器测试供应商");
  await page.locator("#supplierContact").fill("浏览器供应商联系人");
  await page.getByRole("button", { name: "保存供应商" }).click();
  await page.locator("#partnerMsg").getByText(/SUP-/).waitFor();
  await page.getByText("BOM 管理").first().click();
  await page.getByText("齐套检查").waitFor();
  await page.getByText("采购与库存").first().click();
  await page.getByText("缺料采购建议").waitFor();
  await page.getByRole("button", { name: "生成采购建议" }).click();
  await page.getByText("建议采购数量").waitFor();
  await page.locator("#adjustCountedQty").fill("1234");
  await page.locator("#adjustReason").fill("浏览器盘点测试");
  await page.getByRole("button", { name: "保存盘点调整" }).click();
  await page.locator("#adjustMsg").getByText(/IA-/).waitFor();
  await page.getByText("生产协同").first().click();
  await page.getByRole("button", { name: "生成生产工单" }).waitFor();
  await page.getByRole("button", { name: "生成生产工单" }).click();
  await page.getByText(/WO-/).waitFor();
  await page.getByText("询价报价").first().click();
  await page.getByRole("button", { name: "生成报价单" }).waitFor();
  await page.locator("#quoteCustomer").fill("浏览器测试客户档案");
  await page.locator("#quoteQty").fill("3");
  await page.locator("#quoteUnitPrice").fill("66");
  await page.getByRole("button", { name: "生成报价单" }).click();
  await page.locator("#quoteMsg").getByText(/QT-/).waitFor();
  await page.getByRole("button", { name: "转销售订单" }).first().click();
  await page.locator("#quoteMsg").getByText(/SO-/).waitFor();
  await page.getByText("销售交付").first().click();
  await page.getByRole("button", { name: "创建销售订单" }).waitFor();
  await page.locator("#salesCustomer").fill("浏览器测试客户");
  await page.getByRole("button", { name: "创建销售订单" }).click();
  await page.locator("#salesMsg").getByText(/SO-/).waitFor();
  await page.getByText("财务结算").first().click();
  await page.locator("#arAmount").fill("888");
  await page.getByRole("button", { name: "生成应收" }).click();
  await page.locator("#financeMsg").getByText(/AR-/).waitFor();
  await page.waitForFunction(() => document.querySelector("#paymentDoc")?.value);
  await page.locator("#paymentAmount").fill("188");
  await page.getByRole("button", { name: "登记收付款" }).click();
  await page.locator("#financeMsg").getByText(/RCV-/).waitFor();
  await page.getByText("品质管理").first().click();
  await page.getByRole("button", { name: "保存检验记录" }).waitFor();
  await page.getByRole("button", { name: "保存检验记录" }).click();
  await page.getByText(/IPQC-/).waitFor();
  await page.getByText("系统运维").first().click();
  await page.getByRole("button", { name: "创建备份" }).waitFor();
  await page.getByRole("heading", { name: "最近操作" }).waitFor();
  await page.screenshot({ path: path.join(outputDir, "operations-ui.png"), fullPage: true });
  await browser.close();
  console.log("UI_SMOKE_TEST_OK");
} finally {
  proc.kill();
}
