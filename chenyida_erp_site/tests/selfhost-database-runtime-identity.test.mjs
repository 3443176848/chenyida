import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Pool } from "pg";

import { createRuntimeVerifier } from "../db/index.ts";
import {
  assertDatabaseRuntimeIdentity,
  databasePoolConfiguration,
  databaseRuntimePolicy,
  DatabaseRuntimeError,
} from "../db/runtime-connection.ts";

function runtimeError(error) {
  return error instanceof DatabaseRuntimeError
    && error.code === "DATABASE_RUNTIME_IDENTITY_INVALID"
    && error.message === "DATABASE_RUNTIME_IDENTITY_INVALID";
}

function servicePolicy(service = "WEB") {
  const saved = { ...process.env };
  try {
    process.env.ERP_SERVICE_KIND = service;
    process.env.ERP_RELEASE_EXPECTED_DEPLOYMENT_ID = "runtime-identity-test";
    return databaseRuntimePolicy({ deploymentClass: "production" });
  } finally {
    process.env = saved;
  }
}

const webPolicy = () => servicePolicy("WEB");

function validWebRow(policy) {
  return {
    database_name: policy.database,
    database_marker: policy.marker,
    database_owner: policy.ownerRole,
    current_role_name: policy.role,
    session_role_name: policy.role,
    application_name: policy.applicationName,
    role_login: true,
    role_superuser: false,
    role_create_role: false,
    role_create_database: false,
    role_replication: false,
    role_bypass_rls: false,
    role_inherit: true,
    role_connection_limit: 12,
    role_settings_absent: true,
    membership_valid: true,
    dangerous_membership_absent: true,
    owner_membership_absent: true,
    database_connect: true,
    database_create: false,
    database_temporary: false,
    schema_usage: true,
    schema_create: false,
    migration_select: true,
    migration_insert: false,
    migration_update: false,
    migration_delete: false,
    lease_select: true,
    lease_insert: false,
    lease_update: false,
    lease_delete: false,
    users_select: true,
    users_insert: true,
    users_update: true,
    users_delete: false,
  };
}

test("runtime database identity accepts the exact web role and canary boundary", async () => {
  const policy = webPolicy();
  assert.ok(policy);
  assert.equal(policy.privilegeGroup, "chenyida_erp_web_priv");
  const client = {
    async query(sql, values) {
      assert.match(sql, /pg_catalog\.pg_auth_members/);
      assert.deepEqual(values, [policy.role, policy.privilegeGroup, policy.ownerRole]);
      return { rows: [validWebRow(policy)] };
    },
  };
  await assert.doesNotReject(assertDatabaseRuntimeIdentity(client, policy));
});

test("runtime database identity uses the single D-133 privilege-group namespace", () => {
  assert.deepEqual(
    ["WEB", "WORKER", "ADMIN"].map((service) => servicePolicy(service)?.privilegeGroup),
    ["chenyida_erp_web_priv", "chenyida_erp_worker_priv", "chenyida_erp_admin_priv"],
  );
});

test("runtime database identity keeps the one-shot admin away from migration history", async () => {
  const policy = servicePolicy("ADMIN");
  assert.ok(policy);
  const row = {
    ...validWebRow(policy),
    role_connection_limit: 1,
    migration_select: false,
    lease_select: false,
    users_update: false,
  };
  const client = { async query() { return { rows: [row] }; } };
  await assert.doesNotReject(assertDatabaseRuntimeIdentity(client, policy));
  await assert.rejects(
    assertDatabaseRuntimeIdentity({ async query() { return { rows: [{ ...row, migration_select: true }] }; } }, policy),
    runtimeError,
  );
});

test("runtime database identity rejects role swaps, dangerous capabilities and canary drift", async () => {
  const policy = webPolicy();
  for (const mutation of [
    { current_role_name: "chenyida_erp_worker" },
    { role_superuser: true },
    { dangerous_membership_absent: false },
    { owner_membership_absent: false },
    { membership_valid: false },
    { database_temporary: true },
    { migration_update: true },
    { lease_update: true },
    { users_delete: true },
  ]) {
    const client = { async query() { return { rows: [{ ...validWebRow(policy), ...mutation }] }; } };
    await assert.rejects(assertDatabaseRuntimeIdentity(client, policy), runtimeError);
  }
});

test("runtime database identity converts database errors to a stable non-leaking code", async () => {
  const policy = webPolicy();
  const client = { async query() { throw new Error("postgresql://user:secret@example.invalid/private"); } };
  await assert.rejects(assertDatabaseRuntimeIdentity(client, policy), (error) => {
    assert.ok(runtimeError(error));
    assert.equal(error.message.includes("secret"), false);
    assert.equal(error.message.includes("example.invalid"), false);
    return true;
  });
});

test("pg pool blocks first physical connection delivery until runtime verification completes", async () => {
  const policy = webPolicy();
  let resolveIdentity;
  let connectDelivered = false;
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    connect(callback) { callback(); }
    query() { return new Promise((resolve) => { resolveIdentity = resolve; }); }
    end(callback) { this._ending = true; callback?.(); }
    ref() {}
    unref() {}
  }
  // A fake Client keeps this a pure in-process pg-pool contract test; no database is contacted.
  const pool = Reflect.construct(Pool, [{
    Client: FakeClient,
    max: 1,
    connectionTimeoutMillis: 1_000,
    verify: createRuntimeVerifier(policy),
  }]);
  const pending = pool.connect().then((client) => {
    connectDelivered = true;
    return client;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connectDelivered, false);
  resolveIdentity({ rows: [validWebRow(policy)] });
  const client = await pending;
  assert.equal(connectDelivered, true);
  client.release();
  await pool.end();
});

test("isolated test pool keeps guarded environment compatibility", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://postgres@127.0.0.1/runtime_identity_test",
      DATABASE_POOL_MAX: "2",
      ERP_PROCESS_NAME: "runtime-identity-isolated-test",
    });
    const resolved = databasePoolConfiguration({ environment: "test", deploymentClass: "test" });
    assert.equal(resolved.policy, null);
    assert.equal(resolved.pool.max, 2);
    assert.equal(resolved.pool.application_name, "runtime-identity-isolated-test");
    process.env.DATABASE_URL = "postgresql://postgres@example.invalid/production";
    assert.throws(
      () => databasePoolConfiguration({ environment: "test", deploymentClass: "test" }),
      (error) => error instanceof DatabaseRuntimeError && error.code === "TEST_DATABASE_TARGET_INVALID",
    );
  } finally {
    process.env = saved;
  }
});
