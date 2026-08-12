import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

import { closeDb } from "../db/index.ts";
import { handleSelfhostIdentityApi } from "../app/lib/identity-selfhost/handler.ts";
import { PostgresIdentityRepository } from "../app/lib/identity-selfhost/repository.ts";
import { handleSelfhostApi } from "../app/lib/selfhost-api.ts";

const databaseUrl = process.env.TEST_SESSION_SAFETY_DATABASE_URL;
if (!databaseUrl || !/session_safety_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_SESSION_SAFETY_DATABASE_URL containing session_safety_test is required");
}
process.env.DATABASE_URL = databaseUrl;
process.env.ERP_ENV = "test";
process.env.ERP_SETUP_TOKEN = "session-safety-test-setup-token";
process.env.ERP_PUBLIC_ORIGIN = "";
process.env.ERP_DEPLOYMENT_CLASS = "test";
process.env.ERP_UAT_ALLOW_LOOPBACK_ORIGIN = "false";

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "session-safety-integration-test" });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function resetSchema() {
  await closeDb();
  await pool.query("drop schema public cascade; create schema public");
  await pool.query("create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
}

async function applyMigration(name) {
  const source = await readFile(new URL(name, migrationDirectory), "utf8");
  const checksum = sha256(source);
  const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
  if (existing.rows[0]) {
    assert.equal(existing.rows[0].checksum, checksum);
    return "replayed";
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(source);
    await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum]);
    await client.query("commit");
    return "applied";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function migrateThrough(number) {
  for (const name of migrationNames.filter((candidate) => Number(candidate.slice(0, 4)) <= number)) await applyMigration(name);
}

async function seedUser(username = "session_owner") {
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values($1,'会话安全测试','manager','synthetic-test-only',true,false,1)
  `, [username]);
}

function assertTwoClears(response) {
  const values = response.headers.getSetCookie();
  assert.equal(values.length, 2);
  assert.ok(values.some((value) => value.startsWith("CYD_ERP_SESSION=") && /HttpOnly/.test(value) && /Max-Age=0/.test(value)));
  assert.ok(values.some((value) => value.startsWith("CYD_ERP_CSRF=") && !/HttpOnly/.test(value) && /Max-Age=0/.test(value)));
}

async function identityRequest(path, token = null) {
  const requestId = randomUUID();
  const headers = new Headers({ "X-Request-ID": requestId });
  if (token !== null) headers.set("Cookie", `CYD_ERP_SESSION=${token}; CYD_ERP_CSRF=synthetic-csrf`);
  const response = await handleSelfhostIdentityApi(new Request(`http://local.test${path}`, { headers }), { pool, requestId });
  assert.ok(response);
  return response;
}

async function protectedRequest(token) {
  const headers = new Headers({ "X-Request-ID": randomUUID(), "Cookie": `CYD_ERP_SESSION=${token}; CYD_ERP_CSRF=synthetic-csrf` });
  return handleSelfhostApi(new Request("http://local.test/api/material-master/materials?page=1&page_size=20", { headers }));
}

async function waitForDatabaseLock(applicationName) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(`
      select count(*)::int count from pg_stat_activity
      where application_name=$1 and wait_event_type='Lock'
    `, [applicationName]);
    if (waiting.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("authentication did not reach the expected database lock");
}

test.after(async () => {
  await closeDb();
  await pool.end();
});

test("0044 upgrades an empty database exactly once", async () => {
  await resetSchema();
  await migrateThrough(44);
  const history = await pool.query("select version from schema_migrations order by version");
  assert.equal(history.rowCount, 44);
  assert.equal(history.rows.at(-1).version, "0044_identity_session_absolute_lifetime.sql");
  assert.equal((await applyMigration("0044_identity_session_absolute_lifetime.sql")), "replayed");
  assert.equal((await pool.query("select count(*)::int count from schema_migrations")).rows[0].count, 44);
  const facts = await pool.query(`
    select
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='app_sessions' and column_name='absolute_expires_at') column_count,
      to_regclass('public.app_sessions_active_absolute_expiry_idx')::text index_name,
      (select count(*)::int from pg_trigger where tgname='cyd_app_sessions_identity_immutable_guard' and not tgisinternal) trigger_count
  `);
  assert.deepEqual(facts.rows[0], { column_count: 1, index_name: "app_sessions_active_absolute_expiry_idx", trigger_count: 1 });
});

test("0043 session facts are clamped on upgrade and 0044 constraints are enforced", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  const tokenHash = "a".repeat(64);
  const oldTokenHash = "9".repeat(64);
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at,created_at) values
      ($1,'session_owner',now()+interval '48 hours',now()-interval '2 hours'),
      ($2,'session_owner',now()+interval '48 hours',now()-interval '25 hours')
  `, [tokenHash, oldTokenHash]);
  await applyMigration("0044_identity_session_absolute_lifetime.sql");
  const upgraded = await pool.query(`
    select extract(epoch from (absolute_expires_at-created_at))::int absolute_seconds,
      expires_at=absolute_expires_at expiry_was_clamped,absolute_expires_at<=now() absolute_expired
    from app_sessions where token_hash in ($1,$2) order by token_hash
  `, [tokenHash, oldTokenHash]);
  assert.deepEqual(upgraded.rows, [
    { absolute_seconds: 86_400, expiry_was_clamped: true, absolute_expired: true },
    { absolute_seconds: 86_400, expiry_was_clamped: true, absolute_expired: false },
  ]);
  const repository = new PostgresIdentityRepository(pool);
  const oldContext = await repository.authenticate(oldTokenHash, randomUUID());
  assert.deepEqual({ state: oldContext.state, reason: oldContext.revoked_reason }, { state: "EXPIRED", reason: "ABSOLUTE_TIMEOUT" });
  assert.equal((await repository.authenticate(tokenHash, randomUUID())).state, "AUTHENTICATED");
  await assert.rejects(pool.query(`
    insert into app_sessions(token_hash,username,created_at,expires_at,absolute_expires_at)
    values($1,'session_owner',now(),now()+interval '1 hour',now()+interval '25 hours')
  `, ["b".repeat(64)]), /app_sessions_deadline_ck/);
  await assert.rejects(pool.query("update app_sessions set token_hash=$2 where token_hash=$1", [tokenHash, "c".repeat(64)]), /app_sessions_identity_immutable_ck|APP_SESSION_IDENTITY_IMMUTABLE/);
  await assert.rejects(pool.query("update app_sessions set absolute_expires_at=absolute_expires_at-interval '1 hour' where token_hash=$1", [tokenHash]), /app_sessions_identity_immutable_ck|APP_SESSION_IDENTITY_IMMUTABLE/);
  await pool.query("update app_sessions set revoked_at=now(),revoked_reason='IDLE_TIMEOUT' where token_hash=$1", [tokenHash]);
  assert.equal((await pool.query("select revoked_reason from app_sessions where token_hash=$1", [tokenHash])).rows[0].revoked_reason, "IDLE_TIMEOUT");
});

test("a late 0044 failure rolls back the entire migration", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await pool.query("insert into app_sessions(token_hash,username,expires_at) values($1,'session_owner',now()+interval '1 hour')", ["d".repeat(64)]);
  await pool.query("create function cyd_app_sessions_identity_immutable_guard() returns trigger language plpgsql as $$ begin return new; end $$");
  await assert.rejects(applyMigration("0044_identity_session_absolute_lifetime.sql"), /already exists/);
  const rolledBack = await pool.query(`
    select
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='app_sessions' and column_name='absolute_expires_at') column_count,
      (select count(*)::int from schema_migrations where version='0044_identity_session_absolute_lifetime.sql') history_count,
      pg_get_constraintdef((select oid from pg_constraint where conname='app_sessions_revocation_ck')) revocation_definition
  `);
  assert.equal(rolledBack.rows[0].column_count, 0);
  assert.equal(rolledBack.rows[0].history_count, 0);
  assert.doesNotMatch(rolledBack.rows[0].revocation_definition, /IDLE_TIMEOUT|ABSOLUTE_TIMEOUT/);
});

test("session creation and sliding renewal use database deadlines without moving the absolute cap", async () => {
  await resetSchema();
  await migrateThrough(44);
  await seedUser();
  const repository = new PostgresIdentityRepository(pool);
  const tokenHash = "e".repeat(64);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await repository.createSession(client, "session_owner", tokenHash);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const created = await pool.query(`
    select extract(epoch from (expires_at-created_at))::int idle_seconds,
      extract(epoch from (absolute_expires_at-created_at))::int absolute_seconds,
      absolute_expires_at
    from app_sessions where token_hash=$1
  `, [tokenHash]);
  assert.equal(created.rows[0].idle_seconds, 28_800);
  assert.equal(created.rows[0].absolute_seconds, 86_400);
  const absoluteBefore = new Date(created.rows[0].absolute_expires_at).toISOString();
  await pool.query("update app_sessions set expires_at=now()+interval '1 minute' where token_hash=$1", [tokenHash]);
  const context = await repository.authenticate(tokenHash, randomUUID());
  assert.equal(context.state, "AUTHENTICATED");
  assert.equal(context.actor.username, "session_owner");
  const renewed = await pool.query(`
    select absolute_expires_at,
      extract(epoch from (expires_at-now())) remaining_seconds,
      expires_at<=absolute_expires_at bounded
    from app_sessions where token_hash=$1
  `, [tokenHash]);
  assert.equal(new Date(renewed.rows[0].absolute_expires_at).toISOString(), absoluteBefore);
  assert.equal(renewed.rows[0].bounded, true);
  assert.ok(Number(renewed.rows[0].remaining_seconds) > 28_790 && Number(renewed.rows[0].remaining_seconds) <= 28_800);
});

test("concurrent idle and absolute timeout checks terminalize and audit exactly once", async () => {
  await resetSchema();
  await migrateThrough(44);
  await seedUser();
  const repository = new PostgresIdentityRepository(pool);
  for (const fixture of [
    { tokenHash: "f".repeat(64), reason: "IDLE_TIMEOUT", values: "now()-interval '2 hours',now()-interval '1 minute',now()+interval '22 hours'" },
    { tokenHash: "1".repeat(64), reason: "ABSOLUTE_TIMEOUT", values: "now()-interval '25 hours',now()-interval '2 hours',now()-interval '1 hour'" },
  ]) {
    await pool.query(`
      insert into app_sessions(token_hash,username,created_at,expires_at,absolute_expires_at)
      values($1,'session_owner',${fixture.values})
    `, [fixture.tokenHash]);
    const requestIds = Array.from({ length: 6 }, () => randomUUID());
    const contexts = await Promise.all(requestIds.map((requestId) => repository.authenticate(fixture.tokenHash, requestId)));
    assert.ok(contexts.every((context) => context.state === "EXPIRED" && context.actor === null && context.revoked_reason === fixture.reason));
    const session = await pool.query("select revoked_at,revoked_reason from app_sessions where token_hash=$1", [fixture.tokenHash]);
    assert.ok(session.rows[0].revoked_at);
    assert.equal(session.rows[0].revoked_reason, fixture.reason);
    const audits = await pool.query(`
      select request_id::text,detail from audit_log
      where route_code='IDENTITY' and action='SESSION_EXPIRED' and target_username='session_owner'
        and detail->>'reason'=$1
    `, [fixture.reason]);
    assert.equal(audits.rowCount, 1);
    assert.ok(requestIds.includes(audits.rows[0].request_id));
    assert.deepEqual(audits.rows[0].detail, { reason: fixture.reason });
    assert.equal((await repository.authenticate(fixture.tokenHash, randomUUID())).state, "EXPIRED");
    assert.equal((await pool.query(`select count(*)::int count from audit_log where action='SESSION_EXPIRED' and detail->>'reason'=$1`, [fixture.reason])).rows[0].count, 1);
  }
});

test("a committed user revocation wins before concurrent authentication can return an actor", async () => {
  await resetSchema();
  await migrateThrough(44);
  await seedUser();
  const tokenHash = "2".repeat(64);
  await pool.query("insert into app_sessions(token_hash,username,expires_at) values($1,'session_owner',now()+interval '1 hour')", [tokenHash]);
  const mutator = await pool.connect();
  const applicationName = `session-safety-auth-wait-${randomUUID()}`;
  const authenticationPool = new Pool({ connectionString: databaseUrl, max: 1, application_name: applicationName });
  try {
    await mutator.query("begin");
    await mutator.query("select username from app_users where username='session_owner' for update");
    await mutator.query("update app_users set is_active=false,version=version+1 where username='session_owner'");
    await mutator.query("update app_sessions set revoked_at=now(),revoked_reason='USER_DEACTIVATED' where username='session_owner' and revoked_at is null");
    const authentication = new PostgresIdentityRepository(authenticationPool).authenticate(tokenHash, randomUUID());
    await waitForDatabaseLock(applicationName);
    await mutator.query("commit");
    const context = await authentication;
    assert.deepEqual({ state: context.state, actor: context.actor, reason: context.revoked_reason }, { state: "REVOKED", actor: null, reason: "USER_DEACTIVATED" });
  } catch (error) {
    await mutator.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    mutator.release();
    await authenticationPool.end();
  }
});

test("session and generic protected APIs clear invalid cookies and expose only stable states", async () => {
  await resetSchema();
  await migrateThrough(44);
  await seedUser();
  const expiredToken = "expired-session-token";
  const expiredHash = sha256(expiredToken);
  await pool.query(`
    insert into app_sessions(token_hash,username,created_at,expires_at,absolute_expires_at)
    values($1,'session_owner',now()-interval '2 hours',now()-interval '1 minute',now()+interval '22 hours')
  `, [expiredHash]);
  const sessionResponse = await identityRequest("/api/session", expiredToken);
  assert.equal(sessionResponse.status, 200);
  assertTwoClears(sessionResponse);
  const sessionBody = await sessionResponse.json();
  assert.deepEqual({ authenticated: sessionBody.authenticated, user: sessionBody.user, state: sessionBody.session_state }, { authenticated: false, user: null, state: "EXPIRED" });

  const genericExpired = await protectedRequest(expiredToken);
  assert.equal(genericExpired.status, 401);
  assertTwoClears(genericExpired);
  const expiredText = await genericExpired.text();
  assert.match(expiredText, /"code":"SESSION_EXPIRED"/);
  assert.match(expiredText, /当前会话已过期，请重新登录/);
  assert.doesNotMatch(expiredText, new RegExp(expiredToken));
  assert.doesNotMatch(expiredText, new RegExp(expiredHash));

  const revokedToken = "revoked-session-token";
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at,revoked_at,revoked_reason)
    values($1,'session_owner',now()+interval '1 hour',now(),'LOGOUT')
  `, [sha256(revokedToken)]);
  const revoked = await protectedRequest(revokedToken);
  assert.equal(revoked.status, 401);
  assertTwoClears(revoked);
  assert.equal((await revoked.json()).code, "SESSION_REVOKED");

  const unknownToken = "unknown-session-token";
  const unknown = await protectedRequest(unknownToken);
  assert.equal(unknown.status, 401);
  assertTwoClears(unknown);
  assert.equal((await unknown.json()).code, "AUTH_REQUIRED");
  const anonymous = await identityRequest("/api/session");
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.getSetCookie().length, 0);
  assert.equal((await anonymous.json()).authenticated, false);
  assert.equal((await pool.query("select count(*)::int count from audit_log where action='SESSION_EXPIRED'")).rows[0].count, 1);
});
