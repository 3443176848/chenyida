import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { installRuntimeCheckoutVerification } from "../db/index.ts";
import { CONTROLLED_SEARCH_PATH, CONTROLLED_STARTUP_OPTIONS } from "../scripts/postgresql-session-profile.ts";
import {
  assertDatabaseRuntimeIdentity,
  assertIsolatedDatabaseTarget,
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
    role_inherit: policy.roleInherit,
    role_connection_limit: policy.roleConnectionLimit,
    role_valid_until_absent: true,
    search_path_exact: true,
    role_settings_absent: true,
    database_settings_absent: true,
    database_read_only_fence_valid: false,
    database_connection_limit: 64,
    membership_valid: true,
    dangerous_membership_absent: true,
    owner_membership_absent: true,
    database_connect: true,
    database_create: policy.service === "MIGRATION",
    database_temporary: policy.service === "MIGRATION",
    schema_usage: true,
    schema_create: policy.service === "MIGRATION",
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

function identityClient(row) {
  return {
    async query(sql) {
      if (sql === "ROLLBACK") return { rows: [] };
      return sql.includes("set_config")
        ? { rows: [{ search_path: CONTROLLED_SEARCH_PATH }] }
        : { rows: [row] };
    },
  };
}

test("runtime database identity accepts the exact web role and canary boundary", async () => {
  const policy = webPolicy();
  assert.ok(policy);
  assert.equal(policy.privilegeGroup, "chenyida_erp_web_priv");
  const client = {
    async query(sql, values) {
      if (sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("set_config")) {
        assert.deepEqual(values, [CONTROLLED_SEARCH_PATH]);
        return { rows: [{ search_path: CONTROLLED_SEARCH_PATH }] };
      }
      assert.match(sql, /pg_catalog\.pg_auth_members/);
      assert.deepEqual(values, [policy.role, policy.privilegeGroup, policy.ownerRole, CONTROLLED_SEARCH_PATH]);
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
  await assert.doesNotReject(assertDatabaseRuntimeIdentity(identityClient(row), policy));
  await assert.rejects(
    assertDatabaseRuntimeIdentity(identityClient({ ...row, migration_select: true }), policy),
    runtimeError,
  );
});

test("only the migration service accepts the exact short-lived database fence", async () => {
  const migration = servicePolicy("MIGRATION");
  assert.ok(migration);
  const fenced = {
    ...validWebRow(migration),
    database_settings_absent: false,
    database_read_only_fence_valid: true,
    database_connection_limit: 1,
  };
  await assert.doesNotReject(assertDatabaseRuntimeIdentity(identityClient(fenced), migration, "MIGRATION_FENCED"));
  await assert.rejects(
    assertDatabaseRuntimeIdentity(identityClient(fenced), webPolicy(), "MIGRATION_FENCED"),
    (error) => error instanceof DatabaseRuntimeError && error.code === "DATABASE_RUNTIME_POLICY_INVALID",
  );
  await assert.rejects(assertDatabaseRuntimeIdentity(identityClient(fenced), migration), runtimeError);
});

test("runtime database identity rejects role swaps, dangerous capabilities and canary drift", async () => {
  const policy = webPolicy();
  for (const mutation of [
    { current_role_name: "chenyida_erp_worker" },
    { search_path_exact: false },
    { database_settings_absent: false },
    { role_superuser: true },
    { role_valid_until_absent: false },
    { dangerous_membership_absent: false },
    { owner_membership_absent: false },
    { membership_valid: false },
    { database_temporary: true },
    { migration_update: true },
    { lease_update: true },
    { users_delete: true },
  ]) {
    const client = identityClient({ ...validWebRow(policy), ...mutation });
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

test("pg pool blocks every checkout until runtime verification completes", async () => {
  const policy = webPolicy();
  let resolveIdentity;
  let connectDelivered = false;
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    connect(callback) { callback(); }
    query(sql) {
      if (sql === "ROLLBACK") return Promise.resolve({ rows: [] });
      if (sql.includes("set_config")) return Promise.resolve({ rows: [{ search_path: CONTROLLED_SEARCH_PATH }] });
      return new Promise((resolve) => { resolveIdentity = resolve; });
    }
    end(callback) { this._ending = true; callback?.(); }
    ref() {}
    unref() {}
  }
  // A fake Client keeps this a pure in-process pg-pool contract test; no database is contacted.
  const pool = installRuntimeCheckoutVerification(Reflect.construct(Pool, [{
    Client: FakeClient,
    max: 1,
    connectionTimeoutMillis: 1_000,
  }]), policy);
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

test("pg pool revalidates an idle client and destroys role-contaminated sessions", async () => {
  const policy = webPolicy();
  let roleContaminated = false;
  let inTransaction = true;
  let identityChecks = 0;
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    connect(callback) { callback(); }
    query(sql) {
      if (sql === "ROLLBACK") {
        inTransaction = false;
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("set_config")) return Promise.resolve({ rows: [{ search_path: CONTROLLED_SEARCH_PATH }] });
      identityChecks += 1;
      return Promise.resolve({ rows: [{
        ...validWebRow(policy),
        ...(roleContaminated ? { current_role_name: "chenyida_erp_worker" } : {}),
      }] });
    }
    end(callback) { this._ending = true; callback?.(); }
    ref() {}
    unref() {}
  }
  const pool = installRuntimeCheckoutVerification(Reflect.construct(Pool, [{
    Client: FakeClient,
    max: 1,
    connectionTimeoutMillis: 1_000,
  }]), policy);
  const first = await pool.connect();
  assert.equal(inTransaction, false);
  first.release();
  inTransaction = true;
  roleContaminated = true;
  await assert.rejects(pool.connect(), runtimeError);
  assert.equal(inTransaction, false);
  assert.equal(identityChecks, 2);
  assert.equal(pool.totalCount, 0);
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
    assert.equal(resolved.pool.options, undefined);
    assert.equal(CONTROLLED_STARTUP_OPTIONS, "-c search_path=pg_catalog,public,pg_temp");
    process.env.DATABASE_URL = "postgresql://postgres@example.invalid/runtime_identity_test";
    assert.throws(
      () => databasePoolConfiguration({ environment: "test", deploymentClass: "test" }),
      (error) => error instanceof DatabaseRuntimeError && error.code === "ISOLATED_DATABASE_HOST_INVALID",
    );
  } finally {
    process.env = saved;
  }
});

test("isolated database target parsing rejects remote, option and deployment downgrades", () => {
  const isolated = { environment: "test", deploymentClass: "test" };
  const root = mkdtempSync(path.join(tmpdir(), "cyd-runtime-identity-"));
  const socket = path.join(root, "socket");
  mkdirSync(socket, { mode: 0o700 });
  try {
    assert.doesNotThrow(() => assertIsolatedDatabaseTarget(isolated, "postgresql://postgres@localhost/runtime_identity_test"));
    assert.doesNotThrow(() => assertIsolatedDatabaseTarget(isolated, `postgresql://postgres@/runtime_identity_test?host=${socket}`));
    for (const [url, code] of [
      ["postgresql://test-user@example.invalid/runtime_identity_test", "ISOLATED_DATABASE_HOST_INVALID"],
      ["postgresql://postgres@erp-task-test-pg/runtime_identity_test", "ISOLATED_DATABASE_HOST_INVALID"],
      ["postgresql://postgres@localhost/runtime_identity_test?sslmode=disable", "ISOLATED_DATABASE_OPTIONS_INVALID"],
      ["postgresql://postgres@localhost/chenyida_erp", "ISOLATED_DATABASE_NAME_INVALID"],
      ["postgresql://postgres@/runtime_identity_test?host=/var/run/postgresql", "ISOLATED_DATABASE_SOCKET_INVALID"],
    ]) {
      assert.throws(
        () => assertIsolatedDatabaseTarget(isolated, url),
        (error) => error instanceof DatabaseRuntimeError && error.code === code && !error.message.includes(url),
      );
    }
    const linkedRoot = mkdtempSync(path.join(tmpdir(), "cyd-runtime-identity-link-"));
    try {
      symlinkSync(socket, path.join(linkedRoot, "socket"));
      assert.throws(
        () => assertIsolatedDatabaseTarget(isolated, `postgresql://postgres@/runtime_identity_test?host=${linkedRoot}/socket`),
        (error) => error instanceof DatabaseRuntimeError && error.code === "ISOLATED_DATABASE_SOCKET_INVALID",
      );
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
    assert.throws(
      () => assertIsolatedDatabaseTarget({ environment: "development", deploymentClass: "test" }, "postgresql://postgres@localhost/runtime_identity_test"),
      (error) => error instanceof DatabaseRuntimeError && error.code === "ISOLATED_DATABASE_DEPLOYMENT_INVALID",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
