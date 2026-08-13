import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeReadinessError } from "../app/lib/runtime-readiness/identity.ts";
import { handleSelfhostApi, handleSelfhostHealth, handleSelfhostLive } from "../app/lib/selfhost-api.ts";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const database = { async query() { throw new Error("not used"); } };
const ready = Object.freeze({
  deploymentClass: "uat",
  deploymentId: "chenyida-erp-uat",
  version: "0.1.0-alpha.46",
  revision: "a".repeat(12),
  migrationHead: "0045_runtime_worker_readiness.sql",
  migrationManifestSha256: "b".repeat(64),
  databaseTime: new Date("2026-08-12T12:34:56.000Z"),
  leaseExpiresAt: new Date("2026-08-12T12:35:56.000Z"),
  components: Object.freeze({
    postgresql: "READY", migration: "READY", worker: "READY",
    uploads: "READY", attachments: "READY", runtime: "READY",
  }),
});

test("readiness reports bounded database, Migration, Worker, storage and runtime facts", async () => {
  const response = await handleSelfhostHealth({ database, requestId, readiness: { async check() { return ready; } } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "READY",
    database: "postgresql",
    storage: "local",
    worker: "postgresql-jobs",
    deployment_class: "UAT",
    deployment_id: "chenyida-erp-uat",
    version: "0.1.0-alpha.46",
    revision: "a".repeat(12),
    migration_head: "0045_runtime_worker_readiness.sql",
    migration_manifest_sha256: "b".repeat(64),
    components: ready.components,
    time: "2026-08-12T12:34:56.000Z",
  });
});

test("known dependency failures return 503 with stable Chinese messages and no sensitive details", async () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (line) => logs.push(String(line));
  try {
    for (const code of [
      "RUNTIME_DATABASE_UNAVAILABLE",
      "RUNTIME_MIGRATION_MISMATCH",
      "RUNTIME_WORKER_UNAVAILABLE",
      "RUNTIME_UPLOADS_UNAVAILABLE",
      "RUNTIME_ATTACHMENTS_UNAVAILABLE",
    ]) {
      const response = await handleSelfhostHealth({
        database,
        requestId,
        readiness: { async check() { throw Object.assign(new RuntimeReadinessError(code), { secret: "postgres://password@private/db" }); } },
      });
      const text = await response.text();
      const payload = JSON.parse(text);
      assert.equal(response.status, 503, code);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(payload.ok, false);
      assert.equal(payload.status, "NOT_READY");
      assert.equal(payload.code, code);
      assert.equal(payload.request_id, requestId);
      assert.equal(payload.error.code, code);
      assert.doesNotMatch(text, /postgres:|password|private|stack|instance|sha256/i);
    }
    assert.equal(logs.length, 5);
    assert.ok(logs.every((line) => !/postgres:|password|private|stack/i.test(line)));
    assert.ok(logs.every((line) => JSON.parse(line).request_id === requestId));
  } finally {
    console.error = originalConsoleError;
  }
});

test("unknown readiness exceptions remain HTTP 500 and are redacted in response and logs", async () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (line) => logs.push(String(line));
  try {
    const response = await handleSelfhostHealth({
      database,
      requestId,
      readiness: { async check() { throw new Error("select secret from /private/db"); } },
    });
    const text = await response.text();
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(text).code, "INTERNAL_ERROR");
    assert.doesNotMatch(text, /select|secret|private|stack/i);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /select|secret|private|stack/i);
  } finally {
    console.error = originalConsoleError;
  }
});

test("a hung readiness check fails within the handler deadline", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await handleSelfhostHealth({
      database,
      requestId,
      timeoutMs: 10,
      readiness: { async check() { return new Promise(() => undefined); } },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "RUNTIME_HEALTH_TIMEOUT");
  } finally {
    console.error = originalConsoleError;
  }
});

test("liveness validates only process version metadata and is independent of PostgreSQL Pool creation", async () => {
  let poolCalls = 0;
  const response = await handleSelfhostApi(new Request("http://local.test/api/live", {
    headers: { "X-Request-ID": requestId },
  }), {
    poolFactory: () => { poolCalls += 1; throw new Error("database must not be initialized"); },
  });
  assert.equal(response.status, 200);
  assert.equal(poolCalls, 0);
  const payload = await response.json();
  assert.deepEqual({ ok: payload.ok, status: payload.status, version: payload.version }, {
    ok: true, status: "LIVE", version: "0.1.0-alpha.46",
  });
});

test("damaged liveness metadata fails closed without exposing its source", async () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (line) => logs.push(String(line));
  try {
    const response = await handleSelfhostLive({
      requestId,
      applicationVersion: () => { throw new Error("/app/package.json contains secret"); },
    });
    const text = await response.text();
    assert.equal(response.status, 500);
    assert.doesNotMatch(text, /package\.json|secret|\/app\//i);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /package\.json|secret|\/app\//i);
  } finally {
    console.error = originalConsoleError;
  }
});
