import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const api = await readFile(new URL("../app/lib/selfhost-api.ts", import.meta.url), "utf8");
const handler = await readFile(new URL("../app/lib/sales-selfhost/handler.ts", import.meta.url), "utf8");

test("legacy sales UI sends stable IDs through protected writes and server totals", () => {
  for (const name of ["createQuotation", "convertQuotation", "createSalesOrder", "shipSalesOrder"]) { const source = app.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`))?.[0] || ""; assert.match(source, /salesWrite/); assert.doesNotMatch(source, /customer_name|product_code|total_amount|created_by/); }
  assert.match(app, /product_version_id/); assert.match(app, /finished_material_id/); assert.match(app, /expected_order_version/); assert.match(app, /expected_line_version/); assert.match(app, /expected_balance_version/);
  assert.match(html, /id="quoteFinishedMaterial"/); assert.match(html, /id="salesFinishedMaterial"/); assert.match(html, /id="salesUnitPrice"/);
  assert.match(client, /Idempotency-Key/); assert.match(client, /X-CSRF-Token/);
});

test("legacy and stable sales routes delegate to one handler and service", () => {
  assert.match(api, /handleSalesApi/);
  for (const route of ["quotations", "to-sales-order", "sales-orders", "available-to-ship", "shipments", "from-order", "financial-sources", "reversal"]) assert.match(handler, new RegExp(route));
  assert.match(handler, /service\.convertQuotation/); assert.match(handler, /service\.createShipment/); assert.match(handler, /service\.createLegacyShipment/);
  assert.doesNotMatch(handler, /insert into|update sales_|erp_records/i);
});
