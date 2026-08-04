import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword, verifyPassword } from "../app/lib/identity-selfhost/password.ts";
import { createCredentialDocuments, RECOVERY_ACCOUNTS, RECOVERY_ACTION, RECOVERY_ACTOR } from "../tools/offline-identity-recovery/core.ts";
import {
  executeTargetedRecovery,
  executeTargetedRetainedCandidatePromotion,
  executeTargetedVerificationSessionCleanup,
  resolveTargetedPaths,
  targetedConfirmationPhrase,
  TARGETED_ACCOUNT,
} from "../tools/offline-identity-recovery/targeted.ts";

const expectedDatabase = process.env.TARGETED_RECOVERY_EXPECTED_DATABASE || "";
if (!/^cyd_toir_test_[0-9a-f]{12}$/.test(expectedDatabase)) throw new Error("isolated targeted recovery database required");
if (process.env.TARGETED_RECOVERY_REWRITE_DATABASE_PATH !== "1") throw new Error("isolated database rewrite guard required");
const parsed = new URL(process.env.DATABASE_URL || "");
if (parsed.hostname !== "postgres" || decodeURIComponent(parsed.pathname.slice(1)) !== "chenyida_erp") {
  throw new Error("isolated targeted recovery source database identity mismatch");
}
parsed.pathname = `/${expectedDatabase}`;
const databaseUrl = parsed.toString();
const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "targeted-offline-identity-recovery-test" });
const roots = new Set();

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function migrate() {
  await pool.query("drop schema public cascade; create schema public; create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
  const directory = new URL("../drizzle-postgres/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  assert.equal(names.length, 38);
  for (const name of names) {
    const source = await readFile(new URL(name, directory), "utf8");
    const checksum = digest(source);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(source);
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function seed() {
  await pool.query(`
    truncate identity_login_failures,identity_write_rate_limit_buckets,
      app_sessions,audit_log,idempotency_keys,app_users restart identity cascade
  `);
  const fixtureHash = await hashPassword(`F9!x${randomBytes(24).toString("base64url")}`);
  for (const account of RECOVERY_ACCOUNTS) {
    await pool.query(`
      insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
      values($1,$2,$3,$4,true,$5,1)
    `, [account.username, `UAT ${account.role}`, account.role, fixtureHash, account.username !== "admin"]);
    await pool.query(`
      insert into app_sessions(token_hash,username,expires_at)
      values($1,$2,now()+interval '1 day')
    `, [digest(`${account.username}:${randomUUID()}`), account.username]);
  }
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at)
    values($1,$2,now()+interval '1 day'),($3,$2,now()-interval '1 day')
  `, [
    digest(`${TARGETED_ACCOUNT.username}:second:${randomUUID()}`),
    TARGETED_ACCOUNT.username,
    digest(`${TARGETED_ACCOUNT.username}:expired:${randomUUID()}`),
  ]);
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at,revoked_at,revoked_reason)
    values($1,$2,now()+interval '1 day',now(),'LOGOUT')
  `, [digest(`${TARGETED_ACCOUNT.username}:revoked:${randomUUID()}`), TARGETED_ACCOUNT.username]);
}

async function stage(runId) {
  const directory = `/run/chenyida-erp/targeted-identity-recovery-tests/${runId}`;
  roots.add(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const canonicalRunId = randomUUID();
  const document = createCredentialDocuments(canonicalRunId).uat;
  await writeFile(`${directory}/uat-role-accounts.txt`, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return directory;
}

function options(runId, directory, overrides = {}) {
  const expectedUserVersion = overrides.expectedUserVersion ?? 1;
  return {
    pool,
    environment: "parallel-uat-rehearsal",
    deploymentClass: "test",
    expectedMigration: "0038",
    recoveryRunId: runId,
    targetUsername: TARGETED_ACCOUNT.username,
    expectedRole: TARGETED_ACCOUNT.role,
    expectedActive: true,
    expectedUserVersion,
    confirmationPhrase: targetedConfirmationPhrase({ recoveryRunId: runId, expectedUserVersion }),
    effectiveUid: 0,
    databaseUrl,
    password: `A9!z${randomBytes(32).toString("hex")}`,
    expectedDatabaseName: expectedDatabase,
    stageDirectory: directory,
    promote: true,
    ...overrides,
  };
}

async function nonTargetFingerprint() {
  const users = await pool.query(`
    select username,display_name,role,is_active,must_change_password,version,
      created_at::text,updated_at::text,last_login_at::text,password_hash
    from app_users where username<>$1 order by username
  `, [TARGETED_ACCOUNT.username]);
  const sessions = await pool.query(`
    select to_jsonb(s)::text payload from app_sessions s
    where username<>$1 order by username,token_hash
  `, [TARGETED_ACCOUNT.username]);
  return { users: digest(JSON.stringify(users.rows)), sessions: digest(JSON.stringify(sessions.rows)), count: users.rowCount };
}

async function targetSafeState() {
  return (await pool.query(`
    select username,role,is_active,must_change_password,version
    from app_users where username=$1
  `, [TARGETED_ACCOUNT.username])).rows[0];
}

async function recoveryEvidence(runId) {
  return (await pool.query(`
    select
      (select count(*)::int from audit_log where action=$1 and operation_id=$2::uuid) audit_count,
      (select count(*)::int from idempotency_keys
        where username=$3 and response->>'recovery_run_id'=$2::text
          and response->>'mode'='TARGETED_ACCOUNT_FINALIZATION') marker_count,
      (select count(*)::int from app_sessions where username=$4 and revoked_at is null) target_unrevoked_sessions
  `, [RECOVERY_ACTION, runId, RECOVERY_ACTOR, TARGETED_ACCOUNT.username])).rows[0];
}

test.before(migrate);
test.after(async () => {
  await pool.end();
  for (const directory of roots) await rm(directory, { recursive: true, force: true });
});

test("changes only operations, verifies the strong hash, revokes all sessions and writes one immutable audit", async () => {
  await seed();
  const runId = "11111111-3333-4444-8555-666666666666";
  const directory = await stage(runId);
  const recoveryOptions = options(runId, directory);
  const otherBefore = await nonTargetFingerprint();
  const result = await executeTargetedRecovery(recoveryOptions);
  assert.equal(result.status, "canonical_active");
  assert.equal(result.accountCount, 1);
  assert.equal(result.canonicalAccountCount, 10);
  assert.equal(result.canonicalErrorCount, 0);
  assert.equal(result.canonicalDiffCount, 2);
  assert.equal(result.sessionRevokedCount, 3);
  assert.equal(result.auditCount, 1);
  assert.equal(result.otherControlledAccountCount, 10);
  assert.equal(result.otherAccountsUnchanged, true);
  assert.equal(result.otherSessionsUnchanged, true);
  assert.equal(result.businessFingerprintBefore === result.businessFingerprintAfter, true);
  const otherAfter = await nonTargetFingerprint();
  assert.equal(otherAfter.users === otherBefore.users, true);
  assert.equal(otherAfter.sessions === otherBefore.sessions, true);
  assert.equal(otherAfter.count, 10);
  assert.deepEqual(await targetSafeState(), {
    username: TARGETED_ACCOUNT.username,
    role: TARGETED_ACCOUNT.role,
    is_active: true,
    must_change_password: false,
    version: 2,
  });
  const stored = (await pool.query("select password_hash from app_users where username=$1", [TARGETED_ACCOUNT.username])).rows[0];
  assert.equal(await verifyPassword(recoveryOptions.password, stored.password_hash), true);
  assert.deepEqual(await recoveryEvidence(runId), { audit_count: 1, marker_count: 1, target_unrevoked_sessions: 0 });
  const audit = (await pool.query(`
    select username,action,target_username,result,old_version,new_version,detail
    from audit_log where operation_id=$1::uuid
  `, [runId])).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].username, RECOVERY_ACTOR);
  assert.equal(audit[0].action, RECOVERY_ACTION);
  assert.equal(audit[0].target_username, TARGETED_ACCOUNT.username);
  assert.equal(audit[0].result, "success");
  assert.equal(audit[0].old_version, 1);
  assert.equal(audit[0].new_version, 2);
  assert.equal(Object.keys(audit[0].detail).some((key) => /password|hash|token|cookie|connection/i.test(key)), false);
  const paths = resolveTargetedPaths(recoveryOptions);
  await assert.rejects(access(paths.candidate));
  const canonical = JSON.parse(await readFile(paths.canonical, "utf8"));
  const target = canonical.accounts.filter((account) => account.username === TARGETED_ACCOUNT.username);
  assert.equal(target.length, 1);
  assert.equal(target[0].must_change_password, false);
  assert.equal(target[0].password === recoveryOptions.password, true);
  await assert.rejects(
    executeTargetedRecovery(recoveryOptions),
    (error) => error?.code === "TARGETED_RUN_REPLAYED",
  );
  assert.deepEqual(await recoveryEvidence(runId), { audit_count: 1, marker_count: 1, target_unrevoked_sessions: 0 });
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at)
    values($1,$2,now()+interval '1 day')
  `, [digest(`browser-validation:${randomUUID()}`), TARGETED_ACCOUNT.username]);
  const cleanupOptions = { ...recoveryOptions, password: undefined };
  const cleanup = await executeTargetedVerificationSessionCleanup(cleanupOptions, 1);
  assert.deepEqual(cleanup, {
    accountCount: 1,
    sessionRevokedCount: 1,
    auditCount: 1,
    remainingSessionCount: 0,
    verificationAttempt: 1,
  });
  assert.deepEqual(await executeTargetedVerificationSessionCleanup(cleanupOptions, 1), cleanup);
  assert.deepEqual(await recoveryEvidence(runId), { audit_count: 1, marker_count: 1, target_unrevoked_sessions: 0 });
});

test("candidate and transaction failures leave zero half records and do not promote canonical", async () => {
  await seed();
  const candidateRunId = "21111111-3333-4444-8555-666666666666";
  const candidateDirectory = await stage(candidateRunId);
  const candidateOptions = options(candidateRunId, candidateDirectory, {
    hooks: { afterCandidateWrite: () => { throw new Error("injected candidate failure"); } },
  });
  const candidateCanonicalBefore = digest(await readFile(`${candidateDirectory}/uat-role-accounts.txt`));
  const targetBefore = await targetSafeState();
  await assert.rejects(
    executeTargetedRecovery(candidateOptions),
    (error) => error?.code === "TARGETED_CANDIDATE_PREPARATION_FAILED",
  );
  assert.deepEqual(await targetSafeState(), targetBefore);
  assert.deepEqual(await recoveryEvidence(candidateRunId), { audit_count: 0, marker_count: 0, target_unrevoked_sessions: 3 });
  assert.equal(digest(await readFile(`${candidateDirectory}/uat-role-accounts.txt`)), candidateCanonicalBefore);
  await assert.rejects(access(resolveTargetedPaths(candidateOptions).candidate));

  await seed();
  const transactionRunId = "31111111-3333-4444-8555-666666666666";
  const transactionDirectory = await stage(transactionRunId);
  const transactionOptions = options(transactionRunId, transactionDirectory, {
    hooks: { afterTargetUpdate: () => { throw new Error("injected transaction failure"); } },
  });
  const otherBefore = await nonTargetFingerprint();
  const canonicalBefore = digest(await readFile(`${transactionDirectory}/uat-role-accounts.txt`));
  await assert.rejects(
    executeTargetedRecovery(transactionOptions),
    (error) => error?.code === "TARGETED_TRANSACTION_FAILED",
  );
  assert.deepEqual(await targetSafeState(), {
    username: TARGETED_ACCOUNT.username,
    role: TARGETED_ACCOUNT.role,
    is_active: true,
    must_change_password: true,
    version: 1,
  });
  assert.deepEqual(await recoveryEvidence(transactionRunId), { audit_count: 0, marker_count: 0, target_unrevoked_sessions: 3 });
  const otherAfter = await nonTargetFingerprint();
  assert.equal(otherAfter.users === otherBefore.users, true);
  assert.equal(otherAfter.sessions === otherBefore.sessions, true);
  assert.equal(digest(await readFile(`${transactionDirectory}/uat-role-accounts.txt`)), canonicalBefore);
  await assert.rejects(access(resolveTargetedPaths(transactionOptions).candidate));
});

test("promotion failure retains one candidate and controlled compensation reuses it without a second password", async () => {
  await seed();
  const runId = "41111111-3333-4444-8555-666666666666";
  const directory = await stage(runId);
  const recoveryOptions = options(runId, directory, {
    hooks: { beforePromotion: () => { throw new Error("injected promotion failure"); } },
  });
  const canonicalBefore = digest(await readFile(`${directory}/uat-role-accounts.txt`));
  const partial = await executeTargetedRecovery(recoveryOptions);
  assert.equal(partial.status, "partial");
  assert.equal(partial.partialPhase, "PROMOTION");
  assert.deepEqual(await recoveryEvidence(runId), { audit_count: 1, marker_count: 1, target_unrevoked_sessions: 0 });
  assert.equal(digest(await readFile(`${directory}/uat-role-accounts.txt`)), canonicalBefore);
  await access(resolveTargetedPaths(recoveryOptions).candidate);
  const promoted = await executeTargetedRetainedCandidatePromotion({
    ...recoveryOptions,
    password: undefined,
    hooks: undefined,
  });
  assert.equal(promoted.status, "canonical_active");
  await assert.rejects(access(resolveTargetedPaths(recoveryOptions).candidate));
  const canonical = JSON.parse(await readFile(`${directory}/uat-role-accounts.txt`, "utf8"));
  const operation = canonical.accounts.find((account) => account.username === TARGETED_ACCOUNT.username);
  assert.equal(operation.must_change_password, false);
  assert.equal(operation.password === recoveryOptions.password, true);
});

test("wrong database, migration, service state and expected version all fail before an unsafe change", async () => {
  await seed();
  const databaseRunId = "51111111-3333-4444-8555-666666666666";
  await assert.rejects(
    executeTargetedRecovery(options(databaseRunId, await stage(databaseRunId), {
      expectedDatabaseName: "cyd_toir_test_deadbeefdead",
    })),
    (error) => error?.code === "TARGETED_DATABASE_IDENTITY_REJECTED",
  );

  const serviceRunId = "61111111-3333-4444-8555-666666666666";
  const blockerPool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "chenyida-erp-web" });
  const blocker = await blockerPool.connect();
  try {
    await blocker.query("select 1");
    await assert.rejects(
      executeTargetedRecovery(options(serviceRunId, await stage(serviceRunId))),
      (error) => error?.code === "TARGETED_WRITERS_STILL_ACTIVE",
    );
  } finally {
    blocker.release();
    await blockerPool.end();
  }

  const migrationRunId = "71111111-3333-4444-8555-666666666666";
  const migrationName = "0038_supplier_mapping_governance.sql";
  const migrationChecksum = "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941";
  await pool.query("delete from schema_migrations where version=$1", [migrationName]);
  try {
    await assert.rejects(
      executeTargetedRecovery(options(migrationRunId, await stage(migrationRunId))),
      (error) => error?.code === "TARGETED_MIGRATION_MISMATCH",
    );
  } finally {
    await pool.query("insert into schema_migrations(version,checksum) values($1,$2)", [migrationName, migrationChecksum]);
  }

  const versionRunId = "81111111-3333-4444-8555-666666666666";
  const versionDirectory = await stage(versionRunId);
  await assert.rejects(
    executeTargetedRecovery(options(versionRunId, versionDirectory, { expectedUserVersion: 2 })),
    (error) => error?.code === "TARGETED_ACCOUNT_INVARIANT_MISMATCH",
  );
  assert.deepEqual(await targetSafeState(), {
    username: TARGETED_ACCOUNT.username,
    role: TARGETED_ACCOUNT.role,
    is_active: true,
    must_change_password: true,
    version: 1,
  });
  assert.deepEqual(await recoveryEvidence(versionRunId), { audit_count: 0, marker_count: 0, target_unrevoked_sessions: 3 });
  await assert.rejects(access(resolveTargetedPaths(options(versionRunId, versionDirectory, { expectedUserVersion: 2 })).candidate));
});
