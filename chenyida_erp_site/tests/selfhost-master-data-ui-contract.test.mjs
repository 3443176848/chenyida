import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../app/lib/selfhost-api.ts", import.meta.url), "utf8");
const master = await readFile(new URL("../app/lib/master-data-selfhost/handler.ts", import.meta.url), "utf8");
const bom = await readFile(new URL("../app/lib/bom-selfhost/handler.ts", import.meta.url), "utf8");
const legacy = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const apiClient = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8");

test("legacy master-data and BOM paths delegate to self-hosted handlers", () => {
  for (const path of ["/api/items", "/api/mappings", "/api/products", "/api/customers", "/api/suppliers"]) assert.ok(master.includes(path), path);
  assert.match(master, /products\|mappings.*status/);
  for (const path of ["/api/boms", "/api/bom-lines", "/api/bom-readiness"]) assert.ok(bom.includes(path), path);
  assert.match(api, /handleMasterDataApi/); assert.match(api, /handleBomApi/);
  assert.match(legacy, /masterDataWrite\("create-customer", "\/api\/customers"/); assert.match(legacy, /masterDataWrite\("create-bom", "\/api\/boms"/);
  assert.match(legacy, /csrfToken: state\.session\.csrf_token/); assert.match(apiClient, /masterDataWrite/);
  assert.match(legacy, /customer_id: customer\?\.id \|\| null/); assert.match(legacy, /请选择已存在的客户档案/);
});

test("BOM readiness uses only the TASK04 authoritative inventory projection", () => {
  assert.match(bom, /inventory_evaluated: true/);
  assert.match(bom, /inventory_stock_balances/);
  assert.match(bom, /reserved_qty.*frozen_qty/s);
  assert.doesNotMatch(bom, /inventory_balances|inventory_transactions/);
});

test("BOM material selector uses bounded code-first search and submits only stable IDs", () => {
  assert.match(bom, /\/api\/bom-material-candidates/);
  for (const field of ["material_id", "internal_code", "name", "unit_id", "unit", "status", "version"]) assert.ok(bom.includes(field), field);
  assert.match(bom, /material_status='ACTIVE'/);
  assert.match(bom, /internal_material_code\s+is\s+not\s+null/i);
  assert.match(bom, /select 1 from material_master where internal_material_code is not null and lower\(internal_material_code\)=lower\(\$1\)/);
  assert.match(bom, /Math\.min\(parsed,\s*20\)/);

  for (const id of ["lineItemSearch", "lineItemSearchStatus", "lineItemResults", "lineItem", "lineUnitId", "clearLineItemBtn"]) assert.ok(html.includes(`id="${id}"`), id);
  const hiddenMaterial = html.match(/<input[^>]*id="lineItem"[^>]*>/)?.[0] || "";
  assert.match(hiddenMaterial, /type="hidden"/);
  const hiddenUnit = html.match(/<input[^>]*id="lineUnitId"[^>]*>/)?.[0] || "";
  assert.match(hiddenUnit, /type="hidden"/);
  assert.match(legacy, /\/api\/bom-material-candidates\?q=/);
  assert.match(legacy, /limit=20/);
  assert.match(legacy, /data-material-id/);
  assert.match(legacy, /candidate\.material_id/);
  assert.match(legacy, /candidate\.internal_code/);
  assert.match(legacy, /candidate\.name/);
  assert.match(legacy, /candidate\.unit/);
  assert.match(legacy, / · /);
  assert.match(legacy, /bomMaterialSearchController\?\.abort\(\)/);
  assert.match(legacy, /bomLinesRequestToken/);
  assert.match(legacy, /state\.bomLinesBomId/);
  for (const status of ["请输入正式内部编码或名称。", "正在加载物料候选…", "没有匹配的 ACTIVE 正式物料。", "检索失败："]) assert.ok(legacy.includes(status), status);
  assert.ok(legacy.includes("同一物料不能在同一 BOM Version 中重复添加"));
  assert.match(styles, /\.bom-material-option[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media\s*\(max-width:\s*480px\)/);
  assert.match(styles, /\.bom-material-search-row[\s\S]*grid-template-columns:\s*1fr/);

  const addLineBody = legacy.slice(legacy.indexOf("async function addBomLine()"), legacy.indexOf("async function loadBomLines"));
  assert.match(addLineBody, /material_id:\s*(?:Number\()?\$\("#lineItem"\)\.value/);
  assert.match(addLineBody, /unit_id:\s*(?:Number\()?\$\("#lineUnitId"\)\.value/);
  assert.match(addLineBody, /quantity_per:/);
  assert.doesNotMatch(addLineBody, /internal_item_code|standard_name|internal_code:|\bqty_per:|\buom:/);
  const protectedClear = legacy.slice(legacy.indexOf("function clearLegacyProtectedState()"), legacy.indexOf("function suspendLegacyProtectedView"));
  for (const selector of ["#lineItemSearch", "#lineItemSelected", "#lineItemResults"]) assert.ok(protectedClear.includes(selector), selector);
});

test("Product and BOM versions are distinct and the UI calls the real release lifecycle", () => {
  assert.match(html, />产品版本</);
  assert.match(html, />BOM 版本</);
  assert.ok(html.includes("BOM属于产品版本；具体项目在计划交接时关联。"));
  for (const guidance of ["先保存草稿", "校验行项目", "发布后内容不可原地修改", "发布后才可用于计划交接"]) assert.ok(html.includes(guidance), guidance);
  assert.match(legacy, /data-release-bom/);
  assert.match(legacy, /\/api\/boms\/\$\{[^}]+\}\/versions\/\$\{[^}]+\}\/release/);
  assert.match(legacy, /masterDataWrite\([^\n]*release-bom/);
  assert.match(legacy, /expected_version/);
});
