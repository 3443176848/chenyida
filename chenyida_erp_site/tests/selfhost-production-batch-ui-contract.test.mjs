import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = [
  "../app/production/batches/page.tsx",
  "../app/production/dispatch/page.tsx",
  "../app/production/operations/page.tsx",
  "../app/production/wip/page.tsx",
  "../app/production/reporting/page.tsx",
  "../app/warehouse/production-completions/page.tsx",
  "../app/quality/production/page.tsx",
  "../app/quality/nonconformances/page.tsx",
  "../app/production/rework-requests/page.tsx",
];

test("all TASK07 workflow pages state the Inventory Lot boundary", async () => {
  for (const page of pages) {
    const source = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(source, /生产批次谱系已建立，但仓库批次库存尚未启用。/, page);
  }
});
test("Batch page and execution pages expose stable codes, genealogy, NORMAL and REWORK", async () => {
  const batch = await readFile(new URL(pages[0], import.meta.url), "utf8");
  const operation = await readFile(new URL(pages[2], import.meta.url), "utf8");
  for (const token of ["batch_code", "canonical_digest", "genealogy", "planned_qty", "quality_hold_qty", "completed_qty"]) assert.match(batch, new RegExp(token));
  assert.match(operation, /batch_code/);
  assert.match(operation, /NORMAL.*REWORK|REWORK.*NORMAL/s);
});
