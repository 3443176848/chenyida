import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { MaterialGovernanceError } from "../app/lib/material-governance-selfhost/errors.ts";
import { handleSelfhostMaterialGovernanceApi } from "../app/lib/material-governance-selfhost/handler.ts";

const actor = {
  username: "governance_handler_test",
  must_change_password: false,
  permissions: ["material.import.read_any", "material.import.governance.read", "material.import.governance.run"],
};

function dependencies(requireCsrf = () => undefined) {
  return {
    actor,
    requestId: randomUUID(),
    requireCsrf,
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
}

test("governance write routes require CSRF before accepting a request", async () => {
  const deps = dependencies(() => {
    throw new MaterialGovernanceError("CSRF_INVALID", "CSRF Token 无效", 403);
  });
  const response = await handleSelfhostMaterialGovernanceApi(new Request(
    "http://erp.test/api/material-master/import-batches/7/governance-runs",
    { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "governance-handler-0001" }, body: "{}" },
  ), deps);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "CSRF_INVALID");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), deps.requestId);
});

test("governance write routes require an idempotency key after CSRF succeeds", async () => {
  let csrfChecks = 0;
  const deps = dependencies(() => { csrfChecks += 1; });
  const response = await handleSelfhostMaterialGovernanceApi(new Request(
    "http://erp.test/api/material-master/import-batches/7/governance-runs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  ), deps);
  assert.equal(csrfChecks, 1);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("governance read routes reject unknown query parameters and unsupported methods", async () => {
  const deps = dependencies();
  const unknown = await handleSelfhostMaterialGovernanceApi(new Request(
    "http://erp.test/api/material-master/import-batches/7/governance?unsafe=true",
  ), deps);
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, "REQUEST_VALIDATION_FAILED");
  const method = await handleSelfhostMaterialGovernanceApi(new Request(
    "http://erp.test/api/material-master/import-batches/7/governance-runs",
    { method: "DELETE" },
  ), deps);
  assert.equal(method.status, 405);
  assert.equal((await method.json()).code, "METHOD_NOT_ALLOWED");
});

test("governance write routes reject oversized bodies before buffering them", async () => {
  const deps = dependencies();
  const response = await handleSelfhostMaterialGovernanceApi(new Request(
    "http://erp.test/api/material-master/import-batches/7/governance-runs",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(256 * 1024 + 1),
        "Idempotency-Key": "governance-handler-size-0001",
      },
      body: "{}",
    },
  ), deps);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "REQUEST_VALIDATION_FAILED");
});
