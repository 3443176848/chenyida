import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/erp/app.js", import.meta.url), "utf8");
const api = await readFile(new URL("../app/lib/selfhost-api.ts", import.meta.url), "utf8");
const bom = await readFile(new URL("../app/lib/bom-selfhost/handler.ts", import.meta.url), "utf8");
const adjustment = app.match(/async function createInventoryAdjustment\(\) \{[\s\S]*?\n\}/)?.[0] || "";

test("legacy inventory adjustment submits stable Material and balance version", () => {
  assert.match(adjustment, /material_id: inventory\.material_id/);
  assert.match(adjustment, /unit_id: inventory\.unit_id/);
  assert.match(adjustment, /expected_balance_version: inventory\.balance_version/);
  assert.doesNotMatch(adjustment, /internal_item_code|adjusted_by/);
  assert.match(api, /handleInventoryApi/);
});

test("BOM readiness consumes the authoritative inventory projection", () => {
  assert.match(bom, /inventory_stock_balances/);
  assert.match(bom, /inventory_evaluated: true/);
  assert.match(bom, /on_hand_qty.*reserved_qty.*frozen_qty/s);
});
