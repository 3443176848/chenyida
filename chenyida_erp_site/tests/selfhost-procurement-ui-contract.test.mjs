import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const api = await readFile(new URL("../app/lib/selfhost-api.ts", import.meta.url), "utf8");
const handler = await readFile(new URL("../app/lib/procurement-selfhost/handler.ts", import.meta.url), "utf8");

test("legacy purchase writes use the shared protected-write boundary without client actor fields", () => {
  const shortage = app.match(/async function createPoFromShortage\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const receive = app.match(/async function receivePurchase\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(shortage, /procurementWrite/); assert.doesNotMatch(shortage, /createdBy|created_by/);
  assert.match(receive, /procurementWrite/); assert.match(client, /procurementWrite/);
  assert.match(client, /Idempotency-Key/); assert.match(client, /X-CSRF-Token/);
});

test("legacy and stable procurement routes delegate to one handler and service", () => {
  assert.match(api, /handleProcurementApi/);
  for (const route of ["purchase-suggestions", "purchase-orders", "purchase-order-lines", "purchase-receipts", "purchase-receive", "financial-sources"]) assert.match(handler, new RegExp(route));
  assert.match(handler, /service\.createLegacyReceipt/); assert.match(handler, /service\.createReceipt/); assert.doesNotMatch(handler, /insert into|update purchase_|erp_records/i);
});
