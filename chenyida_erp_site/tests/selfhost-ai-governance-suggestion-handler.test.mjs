import assert from "node:assert/strict";
import test from "node:test";

import { handleSelfhostAiGovernanceSuggestionApi } from "../app/lib/ai-governance-suggestion-selfhost/handler.ts";

const requestId = "22222222-2222-4222-8222-222222222222";
const root = "https://erp.invalid/api/material-master/import-batches/1/governance-runs/2/groups/3/ai-suggestions";
const actor = { username: "operator", permissions: ["material.import.governance.read", "material.import.governance.run"], must_change_password: false };

function dependencies(service, options = {}) {
  const queries = [];
  return {
    value: {
      pool: { async query(sql, values) { queries.push({ sql, values }); return { rows: [] }; } },
      actor: options.actor ?? actor,
      requestId,
      requireCsrf: options.requireCsrf ?? (() => undefined),
      service,
    },
    queries,
  };
}

function fakeService(overrides = {}) {
  return {
    async create() { return { data: { suggestion_uid: "ok" }, operationId: "33333333-3333-4333-8333-333333333333", replayed: false, replaySource: "NONE", statusCode: 201 }; },
    async list() { return { items: [], nextAfterUid: null }; },
    async one() { return { suggestion_uid: "11111111-1111-4111-8111-111111111111" }; },
    ...overrides,
  };
}

test("POST requires CSRF and Idempotency-Key and returns no-store request identity", async () => {
  const csrf = dependencies(fakeService(), { requireCsrf: () => { throw { code: "CSRF_INVALID", message: "CSRF Token 无效", status: 403 }; } });
  const denied = await handleSelfhostAiGovernanceSuggestionApi(new Request(root, {
    method: "POST",
    headers: { "Idempotency-Key": "abcdefgh", "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "CLASSIFICATION", expected_group_version: 1 }),
  }), csrf.value);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "CSRF_INVALID");

  const noKey = dependencies(fakeService());
  const missing = await handleSelfhostAiGovernanceSuggestionApi(new Request(root, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "CLASSIFICATION", expected_group_version: 1 }),
  }), noKey.value);
  assert.equal((await missing.json()).code, "IDEMPOTENCY_KEY_REQUIRED");

  const success = dependencies(fakeService());
  const created = await handleSelfhostAiGovernanceSuggestionApi(new Request(root, {
    method: "POST",
    headers: { "Idempotency-Key": "abcdefgh", "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "CLASSIFICATION", expected_group_version: 1 }),
  }), success.value);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.equal(created.headers.get("x-request-id"), requestId);
  assert.equal((await created.json()).request_id, requestId);
});

test("POST rejects unknown fields and declared bodies larger than 256 KiB", async () => {
  const service = fakeService({
    async create(_batch, _run, _group, _context, body) {
      if ("provider" in body) throw { code: "REQUEST_FIELD_UNKNOWN", message: "请求包含未知字段：provider", status: 400 };
      throw new Error("unexpected");
    },
  });
  const unknown = dependencies(service);
  const response = await handleSelfhostAiGovernanceSuggestionApi(new Request(root, {
    method: "POST",
    headers: { "Idempotency-Key": "abcdefgh", "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "CLASSIFICATION", expected_group_version: 1, provider: "REMOTE" }),
  }), unknown.value);
  assert.equal((await response.json()).code, "REQUEST_FIELD_UNKNOWN");

  const large = dependencies(fakeService());
  const oversized = await handleSelfhostAiGovernanceSuggestionApi(new Request(root, {
    method: "POST",
    headers: { "Idempotency-Key": "abcdefgh", "Content-Type": "application/json", "Content-Length": String(256 * 1024 + 1) },
    body: "{}",
  }), large.value);
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "REQUEST_BODY_TOO_LARGE");
});

test("unexpected failures are sanitized and failure audits contain no request body", async () => {
  const secret = "secret-supplier-part SQL /private/path";
  const failing = dependencies(fakeService({ async create() { throw new Error(secret); } }));
  const response = await handleSelfhostAiGovernanceSuggestionApi(new Request(root, {
    method: "POST",
    headers: { "Idempotency-Key": "abcdefgh", "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "CLASSIFICATION", expected_group_version: 1 }),
  }), failing.value);
  const raw = await response.text();
  assert.equal(response.status, 500);
  assert.doesNotMatch(raw, /secret-supplier-part|SQL|private\/path/);
  assert.equal(JSON.parse(raw).error.request_id, requestId);
  assert.equal(failing.queries.length, 1);
  assert.doesNotMatch(JSON.stringify(failing.queries), /secret-supplier-part|CLASSIFICATION/);
});

test("GET list and detail perform zero business writes and reject unknown query fields", async () => {
  const list = dependencies(fakeService());
  const listResponse = await handleSelfhostAiGovernanceSuggestionApi(new Request(`${root}?limit=10`), list.value);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(list.queries, []);

  const detail = dependencies(fakeService());
  const detailResponse = await handleSelfhostAiGovernanceSuggestionApi(new Request(`${root}/11111111-1111-4111-8111-111111111111`), detail.value);
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(detail.queries, []);

  const invalid = dependencies(fakeService());
  const invalidResponse = await handleSelfhostAiGovernanceSuggestionApi(new Request(`${root}?write=true`), invalid.value);
  assert.equal((await invalidResponse.json()).code, "REQUEST_VALIDATION_FAILED");
  assert.equal(invalid.queries.length, 1);
});
