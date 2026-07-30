import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { handleSelfhostMaterialStandardizationApi } from "../app/lib/material-standardization-selfhost/handler.ts";

function dependencies(permissions = ["material.import.read"]) {
  const audits = [];
  return {
    audits,
    value: {
      actor: { username: "handler_test", must_change_password: false, permissions },
      requestId: randomUUID(),
      pool: { query: async (sql, params) => { audits.push({ sql: String(sql), params }); return { rows: [] }; } },
      service: {
        preview: async (_batchId, _actor, input) => ({ batch_id: 7, rows: [], pagination: { page: input.page, page_size: input.pageSize } }),
        exportCsv: async () => ({ filename: "物料整理-IMP-7.csv", csv: "\ufeff序号,项目号\r\n1,A200\r\n", rowCount: 1 }),
      },
    },
  };
}

test("preview is protected, paginated and explicitly private/no-store", async () => {
  const deps = dependencies();
  const response = await handleSelfhostMaterialStandardizationApi(new Request("http://erp.test/api/material-master/import-batches/7/standardization-preview?page=2&page_size=20"), deps.value);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.page, 2);
  assert.equal(body.pagination.page_size, 20);
  assert.equal(body.request_id, deps.value.requestId);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
});

test("CSV download keeps authentication boundary and safe download headers", async () => {
  const deps = dependencies(["material.import.read_any"]);
  const response = await handleSelfhostMaterialStandardizationApi(new Request("http://erp.test/api/material-master/import-batches/7/standardization-export.csv"), deps.value);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv/);
  assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-standardized-row-count"), "1");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("unknown query, unsupported method and missing permission fail closed", async () => {
  const unknownDeps = dependencies();
  const unknown = await handleSelfhostMaterialStandardizationApi(new Request("http://erp.test/api/material-master/import-batches/7/standardization-preview?raw=true"), unknownDeps.value);
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, "REQUEST_VALIDATION_FAILED");

  const methodDeps = dependencies();
  const method = await handleSelfhostMaterialStandardizationApi(new Request("http://erp.test/api/material-master/import-batches/7/standardization-export.csv", { method: "POST" }), methodDeps.value);
  assert.equal(method.status, 405);
  assert.equal((await method.json()).code, "METHOD_NOT_ALLOWED");

  const deniedDeps = dependencies([]);
  const denied = await handleSelfhostMaterialStandardizationApi(new Request("http://erp.test/api/material-master/import-batches/7/standardization-preview"), deniedDeps.value);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "PERMISSION_DENIED");
  assert.ok(deniedDeps.audits.some((entry) => entry.sql.includes("IMPORT_STANDARDIZATION_REQUEST_FAILED")));
});

test("unrelated routes are ignored", async () => {
  const deps = dependencies();
  assert.equal(await handleSelfhostMaterialStandardizationApi(new Request("http://erp.test/api/material-master/import-batches/7/rows"), deps.value), null);
});
