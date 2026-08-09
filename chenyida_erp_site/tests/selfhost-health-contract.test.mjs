import assert from "node:assert/strict";
import test from "node:test";
import { readApplicationVersion } from "../app/lib/application-version.ts";
import { handleSelfhostHealth } from "../app/lib/selfhost-api.ts";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const projectPackagePath = new URL("../package.json", import.meta.url);

test("health reports the validated runtime version and retains the existing fields", async () => {
  const queries = [];
  const response = await handleSelfhostHealth({
    database: { query: async (sql) => { queries.push(sql); return { rows: [{ ok: 1 }] }; } },
    requestId,
    now: () => new Date("2026-08-09T12:34:56.000Z"),
  });
  const payload = await response.json();
  const sourceVersion = readApplicationVersion(projectPackagePath);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.deepEqual(queries, ["select 1"]);
  assert.deepEqual(payload, {
    ok: true,
    database: "postgresql",
    storage: "local",
    worker: "postgresql-jobs",
    version: sourceVersion,
    time: "2026-08-09T12:34:56.000Z",
  });
  assert.equal(payload.version, "0.1.0-alpha.42");
});

test("missing or damaged runtime metadata makes health fail closed without response leaks", async () => {
  let queried = false;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await handleSelfhostHealth({
      database: { query: async () => { queried = true; return {}; } },
      requestId,
      applicationVersion: () => { throw new Error("/app/package.json: { secret: true }"); },
    });
    const responseText = await response.text();
    const payload = JSON.parse(responseText);

    assert.equal(queried, false);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(payload.error.code, "INTERNAL_ERROR");
    assert.equal(payload.error.request_id, requestId);
    assert.equal(payload.ok, undefined);
    assert.equal(payload.version, undefined);
    assert.doesNotMatch(responseText, /package\.json|secret|stack|\/app\//i);
  } finally {
    console.error = originalConsoleError;
  }
});

test("database failures remain non-2xx and do not leak raw errors", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await handleSelfhostHealth({
      database: { query: async () => { throw new Error("select 1 failed at /private/db"); } },
      requestId,
      applicationVersion: () => "0.1.0-alpha.42",
    });
    const responseText = await response.text();

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(responseText, /select 1|private|stack/i);
  } finally {
    console.error = originalConsoleError;
  }
});
