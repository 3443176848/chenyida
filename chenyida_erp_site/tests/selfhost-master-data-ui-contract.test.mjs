import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("../app/lib/selfhost-api.ts", import.meta.url), "utf8");
const master = await readFile(new URL("../app/lib/master-data-selfhost/handler.ts", import.meta.url), "utf8");
const bom = await readFile(new URL("../app/lib/bom-selfhost/handler.ts", import.meta.url), "utf8");
const legacy = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const apiClient = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");

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
