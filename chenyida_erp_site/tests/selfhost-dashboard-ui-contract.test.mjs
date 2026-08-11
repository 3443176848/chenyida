import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("../app/_components/erp-workbench.tsx", import.meta.url), "utf8");
const dashboardService = await readFile(new URL("../app/lib/dashboard-selfhost/service.ts", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const legacy = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const materialImportCreate = await readFile(new URL("../app/materials/_components/material-import-create-page.tsx", import.meta.url), "utf8");
const selfhostWorker = await readFile(new URL("../app/lib/selfhost-worker.ts", import.meta.url), "utf8");

test("root is native, authenticated, non-production and loads the permission-cropped summary", () => {
  assert.doesNotMatch(page, /<iframe/i);
  assert.match(page, /ErpWorkbench/);
  assert.doesNotMatch(workbench, /<iframe/i);
  for (const route of ["/api/session", "/api/summary", "/api/setup", "/api/login", "/api/me/password"]) assert.match(workbench, new RegExp(route));
  assert.doesNotMatch(workbench, /\/api\/(?:management-dashboard|backup-governance)/);
  assert.match(workbench, /logoutSession/);
  assert.match(workbench, /非生产开发基线/);
  assert.match(workbench, /loadCard/);
  assert.doesNotMatch(workbench, /Promise\.all/);
});

test("root exposes exactly eight role entrances and keeps every authorized module in one group", () => {
  const roleBlock = workbench.match(/const ROLE_ENTRANCES:[^=]+=\[([\s\S]*?)\n\];/);
  const moduleBlock = dashboardService.match(/const MODULES:[^=]+=\[([\s\S]*?)\n\];/);
  assert.ok(roleBlock);
  assert.ok(moduleBlock);
  assert.deepEqual([...roleBlock[1].matchAll(/label:"([^"]+)"/g)].map((match) => match[1]), ["管理员", "采购", "市场", "计划", "工程", "财务", "生产", "仓库"]);
  const groupedCodes = [...roleBlock[1].matchAll(/moduleCodes:\[([^\]]*)\]/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((code) => code[1]));
  const serviceCodes = [...moduleBlock[1].matchAll(/\{code:"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(groupedCodes).size, groupedCodes.length, "a module must not appear under multiple roles");
  assert.deepEqual([...groupedCodes].sort(), [...serviceCodes].sort(), "all server-cropped modules must remain reachable");
  for (const contract of ["wb-role-hub", "wb-role-tabs", "wb-role-panel", "role=\"tablist\"", "role=\"tabpanel\"", "服务端权限实时裁剪"]) assert.ok(workbench.includes(contract), contract);
  assert.doesNotMatch(workbench, /wb-metrics|wb-modules|经营风险与待办|最近受控业务事件|备份与恢复治理/);
});

test("legacy remains explicit, has allowlisted deep links, and no browser backup restore control", () => {
  assert.match(workbench, /兼容业务台/);
  assert.match(legacy, /LEGACY_TABS = new Set/);
  assert.match(legacy, /requestedLegacyTab/);
  for (const tab of ["partners", "bom", "purchase", "production", "sales", "quality", "finance"]) assert.match(legacy, new RegExp(`"${tab}"`));
  assert.doesNotMatch(html, /id="createBackupBtn"/);
  assert.doesNotMatch(legacy, /data-restore-backup|async function restoreBackup|async function createBackup/);
  assert.match(html, /禁止浏览器在线原地恢复/);
});

test("legacy cleaning is visibly retired and the pending card declares its global status scope", () => {
  assert.doesNotMatch(html, /data-tab="cleaning"/);
  assert.match(html, /旧“清洗审核”已退役/);
  assert.match(html, /不是人工物料审核队列/);
  assert.match(html, /href="\/materials\/review"/);
  assert.match(html, /href="\/materials\/imports"/);
  assert.match(legacy, /全局待处理（草稿 \+ 待审核）/);
});

test("legacy supplier import delegates to the native PostgreSQL batch workflow", () => {
  assert.match(html, /href="\/materials\/imports\/new"[^>]*>供应商导入<\/a>/);
  assert.match(html, /CSV、XLS 或 XLSX/);
  assert.match(html, /app\.js\?v=20260812-backup-release-identity-v2-41/);
  assert.doesNotMatch(html, /20260714-material-read-ui|id="(?:csvFile|csvText|runImportBtn|loadSampleBtn)"|accept="\.csv"/);
  assert.doesNotMatch(legacy, /\/api\/(?:sample-import|import(?:-file)?)|async function (?:loadSample|runImport)|csvFile|csvText|runImportBtn|loadSampleBtn|file\.text\(\)/);
  assert.match(legacy, /\.nav\[data-tab\]/);
  assert.match(materialImportCreate, /accept="\.xlsx,\.xls,\.csv"/);
  for (const parser of [/await parseMaterialImportCsv\(/, /await parseMaterialImportXls\(/, /await parseMaterialImportXlsx\(/]) assert.match(selfhostWorker, parser);
  assert.match(dashboardService, /const LEGACY_UI_VERSION="20260812-backup-release-identity-v2-41"/);
  assert.doesNotMatch(dashboardService, /href:"\/erp\/index\.html\?tab=/);
  for (const tab of ["partners", "bom", "purchase", "production", "sales", "quality", "finance", "operations"]) assert.match(dashboardService, new RegExp(`legacyHref\\("${tab}"\\)`));
  for (const route of ["/", "/materials/:path*", "/erp/index.html"]) assert.ok(nextConfig.includes(`"${route}"`));
  assert.match(nextConfig, /private, no-store, max-age=0, must-revalidate/);
  assert.match(nextConfig, /key: "Pragma", value: "no-cache"/);
});

test("native root does not issue the legacy refreshAll 23-request batch", () => {
  assert.doesNotMatch(workbench, /refreshAll|\/api\/purchase-order-lines|\/api\/production-reports/);
  const match = legacy.match(/async function refreshAll\(\)[\s\S]*?Promise\.all\(\[([\s\S]*?)\]\)/);
  assert.ok(match);
  assert.equal([...match[1].matchAll(/api\("\/api\//g)].length, 23);
});

test("legacy backup governance renders missing or invalid evidence without inventing readiness", () => {
  assert.match(legacy, /latest_verification\?\.backup_id \|\| "无可信回执"/);
  assert.match(legacy, /status: backups\.verification_status \|\| "UNVERIFIED"/);
  assert.match(legacy, /statusLabel\(row\.status \|\| "UNVERIFIED"\)/);
  for (const field of ["identity_status", "policy_status", "assurance_status"]) {
    assert.match(legacy, new RegExp(`statusLabel\\(row\\.${field} \\|\\| "UNCONFIGURED"\\)`));
  }
  assert.match(legacy, /row\.recovery_ready \? "是" : "否"/);
  assert.match(legacy, /<td colspan="8">没有可信验证记录<\/td>/);
  assert.match(dashboardService, /import \{createHash\} from "node:crypto";import \{hostname\} from "node:os"/);
  assert.match(dashboardService, /hostname:hostname\(\)/);
  assert.doesNotMatch(dashboardService, /process\.env\.HOSTNAME/);
});
