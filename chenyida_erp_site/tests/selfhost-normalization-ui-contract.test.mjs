import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../app/materials/_components/material-import-normalization-review.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/materials/_lib/material-import-normalization.ts", import.meta.url), "utf8");
const handler = await readFile(new URL("../app/lib/material-import-normalization-selfhost/handler.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../app/lib/material-import-normalization-selfhost/worker.ts", import.meta.url), "utf8");
const repository = await readFile(new URL("../app/lib/material-import-normalization-selfhost/repository.ts", import.meta.url), "utf8");

test("normalization review exposes run history, rerun/retry/cancel, filters and immutable row evidence", () => {
  for (const fragment of [
    "运行历史",
    "重新运行规范化",
    "重试同一运行",
    "取消任务",
    "raw_row",
    "field_candidates",
    "attribute_candidates",
    "lineage",
    "issue_level",
    "issue_code",
    "run_id",
  ]) assert.ok(component.includes(fragment) || client.includes(fragment), fragment);
});

test("self-host API uses run-specific reads, bounded cursor pagination and server-side mutation controls", () => {
  for (const fragment of [
    "normalization/runs",
    "/retry",
    "/cancel",
    "normalized-rows",
    "Idempotency-Key",
    "requireCsrf",
    "decodeCursor",
    "material.import.normalize",
    "material.import.cancel",
  ]) assert.ok(handler.includes(fragment), fragment);
  assert.match(repository, /limit \$\d+/);
});

test("worker stages then publishes through the queue completion transaction without mutating material master", () => {
  for (const fragment of [
    "prepare(",
    "replaceStagedRow",
    "verifyStaged",
    "PUBLISHING",
    "publish:",
    "SUPERSEDED",
  ]) assert.ok(worker.includes(fragment), fragment);
  for (const source of [handler, worker, repository]) {
    assert.doesNotMatch(source, /material_master\s+(set|insert|update|delete)/i);
    assert.doesNotMatch(source, /\b(D1Database|miniflare|cloudflare:workers)\b/i);
  }
});
