import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/erp/index.html", import.meta.url), "utf8");
const client = await readFile(new URL("../public/erp/api-client.js", import.meta.url), "utf8");
const api = await readFile(new URL("../app/lib/selfhost-api.ts", import.meta.url), "utf8");
const handler = await readFile(new URL("../app/lib/production-selfhost/handler.ts", import.meta.url), "utf8");

test("legacy production writes use protected idempotent boundary and explicit controlled finished material", () => {
  for (const name of ["createWorkOrder", "issueWorkOrder", "completeWorkOrder"]) { const source = app.match(new RegExp(`async function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || ""; assert.match(source, /productionWrite/); assert.doesNotMatch(source, /createdBy|created_by/); }
  assert.match(html, /id="productionFinishedMaterial"/); assert.match(app, /finished_material_id/); assert.match(client, /productionWrite/); assert.match(client, /Idempotency-Key/); assert.match(client, /X-CSRF-Token/);
});

test("legacy and stable production routes delegate to one handler and service", () => {
  assert.match(api, /handleProductionApi/);
  for (const route of ["work-orders", "work-order-materials", "production-reports", "material-issues", "material-returns", "completions", "bom-snapshot", "progress"]) assert.match(handler, new RegExp(route));
  assert.match(handler, /service\.createLegacyFromBom/); assert.match(handler, /service\.issueLegacy/); assert.match(handler, /service\.completeLegacy/);
  assert.doesNotMatch(handler, /insert into|update production_|erp_records/i);
});
