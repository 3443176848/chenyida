import assert from "node:assert/strict";
import test from "node:test";
import { api, createSessionWriteRegistry, ErpApiError, logoutSession, sessionPost } from "../public/erp/api-client.js";

const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
const cookie = (token) => { globalThis.document = { cookie: token ? `theme=light; CYD_ERP_CSRF=${encodeURIComponent(token)}` : "theme=light" }; };

test.afterEach(() => {
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  globalThis.fetch = originalFetch;
});

test("all Planning module writes are protected POST requests using the current cookie and same-origin credentials", async () => {
  const paths = [
    "/api/projects/1/requirement-resolutions",
    "/api/projects/1/requirement-unit-resolutions",
    "/api/projects/1/planning-packages",
    "/api/planning-packages/1/submit",
    "/api/planning-packages/1/accept",
    "/api/planning-packages/1/return",
    "/api/planning-packages/1/material-requirement-plans",
    "/api/material-requirement-plans/1/submit",
    "/api/purchase-requests/1/accept",
    "/api/purchase-requests/1/return",
    "/api/planning-packages/1/production-handoffs",
    "/api/production-handoffs/1/submit",
  ];
  cookie("current-session-token");
  const requests = [];
  globalThis.fetch = async (path, options) => { requests.push({ path, options }); return ok(); };
  for (const path of paths) {
    await assert.rejects(api(path, { method: "POST", body: "{}" }), (error) => error instanceof ErpApiError && error.code === "PROTECTED_WRITE_CONTEXT_REQUIRED");
    await api(path, { method: "POST", body: "{}", protectedWrite: { csrfToken: "stale-session-token", idempotencyKey: `planning-${requests.length}-key` } });
  }
  assert.equal(requests.length, paths.length);
  for (const request of requests) {
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.credentials, "same-origin");
    assert.equal(request.options.headers["X-CSRF-Token"], "current-session-token");
    assert.match(request.options.headers["Idempotency-Key"], /^planning-\d+-key$/);
  }
});

test("browser writes and logout fail closed without the current CSRF cookie", async () => {
  cookie("");
  globalThis.fetch = async () => ok();
  await assert.rejects(api("/api/projects/1/planning-packages", { method: "POST", body: "{}", protectedWrite: { csrfToken: "old", idempotencyKey: "missing-cookie-key" } }), (error) => error.code === "PROTECTED_WRITE_CONTEXT_REQUIRED");
  await assert.rejects(logoutSession("old"), (error) => error.code === "PROTECTED_WRITE_CONTEXT_REQUIRED");
});

test("BOM line PATCH and DELETE use the shared protected-write client", async () => {
  cookie("bom-session-token");
  const requests = [];
  globalThis.fetch = async (path, options) => { requests.push({ path, options }); return ok(); };
  await api("/api/bom-lines/7", { method: "PATCH", body: "{}", protectedWrite: { csrfToken: "old", idempotencyKey: "bom-line-patch-key" } });
  await api("/api/bom-lines/7", { method: "DELETE", body: "{}", protectedWrite: { csrfToken: "old", idempotencyKey: "bom-line-delete-key" } });
  assert.deepEqual(requests.map((request) => [request.options.method, request.options.credentials, request.options.headers["X-CSRF-Token"]]), [
    ["PATCH", "same-origin", "bom-session-token"],
    ["DELETE", "same-origin", "bom-session-token"],
  ]);
});

test("logout and relogin use only the new current-session token", async () => {
  const requests = [];
  globalThis.fetch = async (path, options) => { requests.push({ path, options }); return ok(); };
  cookie("session-one");
  await logoutSession("stale-token");
  cookie("session-two");
  await api("/api/projects/1/requirement-resolutions", { method: "POST", body: "{}", protectedWrite: { csrfToken: "session-one", idempotencyKey: "new-session-write" } });
  assert.deepEqual(requests.map((request) => request.options.headers["X-CSRF-Token"]), ["session-one", "session-two"]);
  assert.equal(requests[0].options.credentials, "same-origin");
});

test("page-memory idempotency keys bind to the current session and canonical request body", async () => {
  const registry = createSessionWriteRegistry();
  const requests = [];
  cookie("session-a");
  globalThis.fetch = async (_path, options) => { requests.push(options); throw new TypeError("simulated connection loss"); };
  await assert.rejects(sessionPost(registry, "/api/projects/1/requirement-resolutions", { b: 2, a: 1 }, "stale"), (error) => error.code === "RESULT_UNKNOWN" && error.resultUnknown);
  assert.equal(registry.size, 1);
  const firstKey = requests[0].headers["Idempotency-Key"];

  globalThis.fetch = async (_path, options) => { requests.push(options); return ok(); };
  await sessionPost(registry, "/api/projects/1/requirement-resolutions", { a: 1, b: 2 }, "stale");
  assert.equal(requests[1].headers["Idempotency-Key"], firstKey);
  assert.equal(registry.size, 0);

  globalThis.fetch = async (_path, options) => { requests.push(options); throw new TypeError("simulated connection loss"); };
  await assert.rejects(sessionPost(registry, "/api/projects/1/requirement-resolutions", { a: 1 }, "session-a"), (error) => error.code === "RESULT_UNKNOWN");
  const oldSessionKey = requests[2].headers["Idempotency-Key"];
  cookie("session-b");
  globalThis.fetch = async (_path, options) => { requests.push(options); return ok(); };
  await sessionPost(registry, "/api/projects/1/requirement-resolutions", { a: 1 }, "session-a");
  assert.notEqual(requests[3].headers["Idempotency-Key"], oldSessionKey);
  assert.equal(requests[3].headers["X-CSRF-Token"], "session-b");

  cookie("session-c");
  globalThis.fetch = async (_path, options) => { requests.push(options); throw new TypeError("simulated connection loss"); };
  await assert.rejects(sessionPost(registry, "/api/projects/1/requirement-resolutions", { a: 1 }, "session-c"), (error) => error.code === "RESULT_UNKNOWN");
  await assert.rejects(sessionPost(registry, "/api/projects/1/requirement-resolutions", { a: 2 }, "session-c"), (error) => error.code === "RESULT_UNKNOWN");
  assert.notEqual(requests.at(-2).headers["Idempotency-Key"], requests.at(-1).headers["Idempotency-Key"]);
  assert.equal(registry.size, 2);
});
