import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { hashPassword, verifyPassword } from "../app/lib/identity-selfhost/password.ts";
import {
  businessFingerprint,
  executeBrowserFailureSessionCleanup,
  executeRecovery,
  executeRetainedStagePromotion,
  executeStageFinalization,
  protectedDataFingerprint,
  RECOVERY_ACCOUNTS,
  RECOVERY_ACTION,
  RECOVERY_ACTOR,
  RECOVERY_SESSION_CLEANUP_ACTION,
  validateRecoveryCredentialFiles,
} from "../tools/offline-identity-recovery/core.ts";

const expectedDatabase = process.env.RECOVERY_EXPECTED_DATABASE || "";
if (!/^cyd_oir_test_[0-9a-f]{12}$/.test(expectedDatabase)) throw new Error("isolated recovery test database required");
const parsed = new URL(process.env.DATABASE_URL || "");
if (process.env.RECOVERY_REWRITE_DATABASE_PATH !== "1") throw new Error("isolated recovery database rewrite guard required");
parsed.pathname = `/${expectedDatabase}`;
const databaseUrl = parsed.toString();
if (parsed.hostname !== "postgres" || parsed.pathname !== `/${expectedDatabase}`) throw new Error("isolated recovery test database identity mismatch");

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "offline-identity-recovery-postgres-test" });
const roots = new Set();

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function stageDirectory(runId) {
  const directory = `/run/chenyida-erp/identity-recovery-tests/${runId}`;
  roots.add(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function options(runId, directory, overrides = {}) {
  return {
    pool,
    environment: "parallel-uat-rehearsal",
    deploymentClass: "test",
    expectedMigration: "0036",
    recoveryRunId: runId,
    confirmation: true,
    effectiveUid: 0,
    databaseUrl,
    expectedDatabaseName: expectedDatabase,
    stageDirectory: directory,
    promote: true,
    ...overrides,
  };
}

async function finalizationOptions(runId, directory, overrides = {}) {
  const evidencePath = `${directory}/browser-verification.json`;
  const issuedAt = Math.floor(Date.now() / 1000);
  try {
    await writeFile(evidencePath, `${JSON.stringify({
      format_version: "chenyida-erp-browser-verification-v2",
      verifier_version: "offline-identity-recovery-browser-v2",
      recovery_run_id: runId,
      environment: "parallel-uat-rehearsal",
      origin: "http://127.0.0.1:3000",
      browser_image_id: "sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd",
      web_image_id: "sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25",
      accounts: RECOVERY_ACCOUNTS.map((account) => account.username),
      admin_login_count: 1,
      uat_login_count: 10,
      uat_force_change_count: 10,
      logout_count: 11,
      history_reload_count: 11,
      history_back_count: 11,
      history_forward_count: 11,
      blocked_request_count: 0,
      issued_at_epoch: issuedAt,
      host_postcheck: true,
      promoted_at_epoch: issuedAt,
    })}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return options(runId, directory, {
    finalizationConfirmation: true,
    browserVerificationEvidencePath: evidencePath,
    ...overrides,
  });
}

async function seed() {
  await pool.query(`
    truncate identity_login_failures,identity_write_rate_limit_buckets,
      app_sessions,audit_log,idempotency_keys,app_users restart identity cascade
  `);
  const fixtureHash = await hashPassword(`T${randomBytes(18).toString("base64url")}!8z`);
  for (const account of RECOVERY_ACCOUNTS) {
    await pool.query(`
      insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
      values($1,$2,$3,$4,true,false,1)
    `, [account.username, `UAT ${account.role}`, account.role, fixtureHash]);
    await pool.query(`
      insert into app_sessions(token_hash,username,expires_at)
      values($1,$2,now()+interval '1 day')
    `, [digest(`${account.username}:${randomUUID()}`), account.username]);
    await pool.query(`
      insert into app_sessions(token_hash,username,expires_at)
      values($1,$2,now()+interval '1 day')
    `, [digest(`${account.username}:second:${randomUUID()}`), account.username]);
    await pool.query(`
      insert into app_sessions(token_hash,username,expires_at,revoked_at,revoked_reason)
      values($1,$2,now()+interval '1 day',now(),'LOGOUT')
    `, [digest(`${account.username}:revoked:${randomUUID()}`), account.username]);
    await pool.query(`
      insert into app_sessions(token_hash,username,expires_at)
      values($1,$2,now()-interval '1 day')
    `, [digest(`${account.username}:expired:${randomUUID()}`), account.username]);
  }
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('unrelated_user','Unrelated','manager',$1,true,false,7)
  `, [fixtureHash]);
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('uat_20260729_observer','Unrelated prefix account','sales',$1,true,false,9)
  `, [fixtureHash]);
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at)
    values($1,'unrelated_user',now()+interval '1 day')
  `, [digest(`unrelated:${randomUUID()}`)]);
  await pool.query(`
    insert into app_sessions(token_hash,username,expires_at)
    values($1,'uat_20260729_observer',now()+interval '1 day')
  `, [digest(`unrelated-prefix:${randomUUID()}`)]);
}

async function targetState() {
  return pool.query(`
    select username,role,is_active,must_change_password,version
    from app_users where username=any($1::text[]) order by username
  `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
}

async function unrelatedState() {
  const user = await pool.query(`
    select username,display_name,role,is_active,must_change_password,version,
      created_at::text,updated_at::text,last_login_at::text,xmin::text,ctid::text
    from app_users where username in ('unrelated_user','uat_20260729_observer') order by username
  `);
  const sessions = await pool.query(`
    select username,expires_at::text,created_at::text,revoked_at::text,revoked_reason,xmin::text,ctid::text
    from app_sessions where username in ('unrelated_user','uat_20260729_observer') order by username,created_at,ctid
  `);
  const preRevokedTargets = await pool.query(`
    select username,expires_at::text,created_at::text,revoked_at::text,revoked_reason,xmin::text,ctid::text
    from app_sessions where username=any($1::text[]) and revoked_reason='LOGOUT'
    order by username,created_at,ctid
  `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
  return { user: user.rows, sessions: sessions.rows, preRevokedTargets: preRevokedTargets.rows };
}

async function runEvidence(runId) {
  const result = await pool.query(`
    select
      (select count(*)::int from audit_log where action=$1 and operation_id=$2::uuid) audit_count,
      (select count(*)::int from idempotency_keys
        where username=$3 and response->>'recovery_run_id'=$2::text) marker_count,
      (select count(*)::int from app_sessions
        where username=any($4::text[]) and revoked_at is null) target_active_sessions,
      (select count(*)::int from app_sessions
        where username='unrelated_user' and revoked_at is null) unrelated_active_sessions
  `, [RECOVERY_ACTION, runId, RECOVERY_ACTOR, RECOVERY_ACCOUNTS.map((account) => account.username)]);
  return result.rows[0];
}

test.after(async () => {
  await pool.end();
  for (const directory of roots) await rm(directory, { recursive: true, force: true });
});

test("atomically recovers eleven accounts, preserves roles/status and unrelated sessions, and persists exact audit", async () => {
  await seed();
  const fingerprintBefore = await businessFingerprint(pool);
  const protectedFingerprintBefore = await protectedDataFingerprint(pool);
  const unrelatedBefore = await unrelatedState();
  const runId = "11111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory));
  assert.equal(result.status, "canonical_active");
  assert.equal(result.accountCount, 11);
  assert.equal(result.sessionRevokedCount, 33);
  assert.equal(result.auditCount, 11);
  await validateRecoveryCredentialFiles(result.stages.adminCanonical, result.stages.uatCanonical, runId);
  assert.equal((await stat(result.stages.adminCanonical)).mode & 0o777, 0o600);
  assert.equal((await stat(result.stages.uatCanonical)).mode & 0o777, 0o600);

  const state = await targetState();
  assert.equal(state.rowCount, 11);
  for (const account of RECOVERY_ACCOUNTS) {
    const row = state.rows.find((candidate) => candidate.username === account.username);
    assert.equal(row?.role, account.role);
    assert.equal(row?.is_active, true);
    assert.equal(row?.must_change_password, account.mustChangePassword);
    assert.equal(row?.version, 2);
  }
  const adminDocument = JSON.parse(await readFile(result.stages.adminCanonical, "utf8"));
  const uatDocument = JSON.parse(await readFile(result.stages.uatCanonical, "utf8"));
  const newSecrets = new Map([[adminDocument.username, adminDocument.password], ...uatDocument.accounts.map((account) => [account.username, account.password])]);
  const stored = await pool.query(`select username,password_hash from app_users where username=any($1::text[])`, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
  for (const row of stored.rows) assert.equal(await verifyPassword(newSecrets.get(row.username), row.password_hash), true);
  assert.deepEqual(await unrelatedState(), unrelatedBefore);
  assert.deepEqual(await businessFingerprint(pool), fingerprintBefore);
  assert.deepEqual(await protectedDataFingerprint(pool), protectedFingerprintBefore);
  const evidence = await runEvidence(runId);
  assert.deepEqual(evidence, {
    audit_count: 11,
    marker_count: 1,
    target_active_sessions: 0,
    unrelated_active_sessions: 1,
  });
  const audits = await pool.query(`
    select username,action,target_username,result,detail
    from audit_log where operation_id=$1::uuid order by target_username
  `, [runId]);
  assert.equal(audits.rowCount, 11);
  assert.ok(audits.rows.every((row) => row.username === RECOVERY_ACTOR
    && row.action === RECOVERY_ACTION
    && row.result === "success"
    && row.detail.recovery_run_id === runId
    && row.detail.reason_code === "USER_AUTHORIZED_NON_PRODUCTION_CREDENTIAL_RECOVERY"
    && !Object.keys(row.detail).some((key) => /password|hash|token|cookie|digest/i.test(key))));
  const marker = await pool.query(`
    select expires_at::text expires_at from idempotency_keys
    where username=$1 and response->>'recovery_run_id'=$2
  `, [RECOVERY_ACTOR, runId]);
  assert.equal(marker.rows[0]?.expires_at, "infinity");

  await assert.rejects(executeRecovery(options(runId, directory)), (error) => error?.code === "RECOVERY_RUN_REPLAYED");
  const repeated = await runEvidence(runId);
  assert.equal(repeated.audit_count, 11);
  assert.equal((await targetState()).rows.every((row) => row.version === 2), true);
  const finalized = await executeStageFinalization(await finalizationOptions(runId, directory));
  assert.equal(finalized.status, "completed");
  assert.equal(finalized.sessionRevokedCount, 33);
  await assert.rejects(access(result.stages.adminStage));
  await assert.rejects(access(result.stages.uatStage));
});

test("fault injection rolls back users, sessions, audit and run marker without half records", async () => {
  await seed();
  const runId = "21111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  await assert.rejects(
    executeRecovery(options(runId, directory, {
      hooks: { afterUserUpdate: (index) => { if (index === 4) throw new Error("injected"); } },
      promote: false,
    })),
    (error) => error?.code === "RECOVERY_TRANSACTION_FAILED",
  );
  const state = await targetState();
  assert.ok(state.rows.every((row) => row.version === 1 && row.must_change_password === false));
  assert.deepEqual(await runEvidence(runId), {
    audit_count: 0,
    marker_count: 0,
    target_active_sessions: 33,
    unrelated_active_sessions: 1,
  });
  await assert.rejects(access(`${directory}/.parallel-admin.txt.stage-${runId}`));
  await assert.rejects(access(`${directory}/.uat-role-accounts.txt.stage-${runId}`));
});

test("browser-failure fallback revokes one selected account and reconciles commit acknowledgement loss", async () => {
  await seed();
  const runId = "22111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const recovery = await executeRecovery(options(runId, directory));
  assert.equal(recovery.status, "canonical_active");
  const versionsBefore = await targetState();
  for (const account of RECOVERY_ACCOUNTS) {
    await pool.query(`
      insert into app_sessions(token_hash,username,expires_at)
      values($1,$2,now()+interval '1 day')
    `, [digest(`browser-fallback:${account.username}:${randomUUID()}`), account.username]);
  }
  const unrelatedBefore = await unrelatedState();
  const cleaned = await executeBrowserFailureSessionCleanup(options(runId, directory, {
    sessionCleanupConfirmation: true,
    sessionCleanupUsername: "uat_20260729_manager",
    hooks: { afterSessionCleanupCommitAcknowledged: () => { throw new Error("injected acknowledgement loss"); } },
  }));
  assert.equal(cleaned.accountCount, 1);
  assert.equal(cleaned.sessionRevokedCount, 1);
  assert.equal(cleaned.auditCount, 1);
  assert.deepEqual((await targetState()).rows, versionsBefore.rows);
  const unrelatedAfter = await unrelatedState();
  assert.deepEqual(unrelatedAfter.user, unrelatedBefore.user);
  assert.deepEqual(unrelatedAfter.sessions, unrelatedBefore.sessions);
  assert.equal((await runEvidence(runId)).target_active_sessions, 10);
  const sessions = await pool.query(`
    select
      count(*) filter(where username='uat_20260729_manager' and revoked_at is null)::int selected,
      count(*) filter(where username<>'uat_20260729_manager' and revoked_at is null)::int other_targets
    from app_sessions where username=any($1::text[])
  `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
  assert.deepEqual(sessions.rows[0], { selected: 0, other_targets: 10 });
  const cleanupAudits = await pool.query(`
    select count(*)::int count,count(distinct target_username)::int targets
    from audit_log where action=$1 and detail->>'recovery_run_id'=$2
  `, [RECOVERY_SESSION_CLEANUP_ACTION, runId]);
  assert.deepEqual(cleanupAudits.rows[0], { count: 1, targets: 1 });
  const replay = await executeBrowserFailureSessionCleanup(options(runId, directory, {
    sessionCleanupConfirmation: true,
    sessionCleanupUsername: "uat_20260729_manager",
  }));
  assert.deepEqual(replay, cleaned);
});

test("stage write failure prevents database execution and account invariant mismatch rolls back", async () => {
  await seed();
  const stageRunId = "31111111-2222-4333-8444-555555555555";
  const stageDir = await stageDirectory(stageRunId);
  await assert.rejects(executeRecovery(options(stageRunId, stageDir, {
    hooks: { beforeStageWrite: () => { throw new Error("injected"); } },
  })));
  assert.ok((await targetState()).rows.every((row) => row.version === 1));
  assert.deepEqual(await runEvidence(stageRunId), {
    audit_count: 0,
    marker_count: 0,
    target_active_sessions: 33,
    unrelated_active_sessions: 1,
  });

  const linkedRunId = "31211111-2222-4333-8444-555555555555";
  const linkedDir = await stageDirectory(linkedRunId);
  await assert.rejects(executeRecovery(options(linkedRunId, linkedDir, {
    hooks: { afterStageLink: (target) => { if (target === "uat") throw new Error("injected"); } },
  })));
  await assert.rejects(access(`${linkedDir}/.parallel-admin.txt.stage-${linkedRunId}`));
  await assert.rejects(access(`${linkedDir}/.uat-role-accounts.txt.stage-${linkedRunId}`));
  assert.deepEqual(await runEvidence(linkedRunId), {
    audit_count: 0,
    marker_count: 0,
    target_active_sessions: 33,
    unrelated_active_sessions: 1,
  });

  const connectRunId = "32111111-2222-4333-8444-555555555555";
  const connectDir = await stageDirectory(connectRunId);
  await assert.rejects(
    executeRecovery(options(connectRunId, connectDir, {
      hooks: { beforeDatabaseConnect: () => { throw new Error("injected"); } },
    })),
    (error) => error?.code === "RECOVERY_DATABASE_CONNECT_FAILED",
  );
  await assert.rejects(access(`${connectDir}/.parallel-admin.txt.stage-${connectRunId}`));
  await assert.rejects(access(`${connectDir}/.uat-role-accounts.txt.stage-${connectRunId}`));
  assert.deepEqual(await runEvidence(connectRunId), {
    audit_count: 0,
    marker_count: 0,
    target_active_sessions: 33,
    unrelated_active_sessions: 1,
  });

  await pool.query("update app_users set is_active=false where username='uat_20260729_planning'");
  const invariantRunId = "41111111-2222-4333-8444-555555555555";
  const invariantDir = await stageDirectory(invariantRunId);
  await assert.rejects(
    executeRecovery(options(invariantRunId, invariantDir)),
    (error) => error?.code === "RECOVERY_ACCOUNT_INVARIANT_MISMATCH",
  );
  assert.deepEqual(await runEvidence(invariantRunId), {
    audit_count: 0,
    marker_count: 0,
    target_active_sessions: 33,
    unrelated_active_sessions: 1,
  });
  assert.ok((await targetState()).rows.every((row) => row.version === 1));
});

test("database commit plus promotion failure retains both stages and supports controlled promotion recovery", async () => {
  await seed();
  const runId = "51111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory, {
    hooks: { beforePromotion: (target) => { if (target === "uat") throw new Error("injected"); } },
  }));
  assert.equal(result.status, "partial");
  assert.equal(result.promotionCode, "RECOVERY_CANONICAL_PROMOTION_FAILED");
  for (const stagePath of [result.stages.adminStage, result.stages.uatStage]) {
    const metadata = await stat(stagePath);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.uid, 0);
    assert.equal(metadata.gid, 0);
  }
  const adminStageBefore = await readFile(result.stages.adminStage);
  const uatStageBefore = await readFile(result.stages.uatStage);
  const adminMetadataBefore = await stat(result.stages.adminStage);
  const uatMetadataBefore = await stat(result.stages.uatStage);
  await assert.rejects(executeRecovery(options(runId, directory)), (error) => error?.code === "RECOVERY_RUN_REPLAYED");
  assert.equal((await readFile(result.stages.adminStage)).equals(adminStageBefore), true);
  assert.equal((await readFile(result.stages.uatStage)).equals(uatStageBefore), true);
  const adminMetadataAfter = await stat(result.stages.adminStage);
  const uatMetadataAfter = await stat(result.stages.uatStage);
  assert.equal(adminMetadataAfter.mtimeMs, adminMetadataBefore.mtimeMs);
  assert.equal(uatMetadataAfter.mtimeMs, uatMetadataBefore.mtimeMs);
  assert.ok((await targetState()).rows.every((row) => row.version === 2));
  assert.deepEqual(await runEvidence(runId), {
    audit_count: 11,
    marker_count: 1,
    target_active_sessions: 0,
    unrelated_active_sessions: 1,
  });

  const promoted = await executeRetainedStagePromotion(options(runId, directory));
  assert.equal(promoted.status, "canonical_active");
  await validateRecoveryCredentialFiles(result.stages.adminCanonical, result.stages.uatCanonical, runId);
  const finalized = await executeStageFinalization(await finalizationOptions(runId, directory));
  assert.equal(finalized.status, "completed");
  await assert.rejects(access(result.stages.adminStage));
  await assert.rejects(access(result.stages.uatStage));
  const replayedFinalization = await executeStageFinalization(await finalizationOptions(runId, directory));
  assert.equal(replayedFinalization.status, "completed");
});

test("commit acknowledgement loss is resolved from persistent evidence and can complete promotion", async () => {
  await seed();
  const runId = "61111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory, {
    hooks: { afterCommitAcknowledged: () => { throw new Error("injected"); } },
  }));
  assert.equal(result.status, "canonical_active");
  assert.equal(result.accountCount, 11);
  assert.equal(result.sessionRevokedCount, 33);
  assert.deepEqual(await runEvidence(runId), {
    audit_count: 11,
    marker_count: 1,
    target_active_sessions: 0,
    unrelated_active_sessions: 1,
  });
  await validateRecoveryCredentialFiles(result.stages.adminCanonical, result.stages.uatCanonical, runId);
  const finalized = await executeStageFinalization(await finalizationOptions(runId, directory));
  assert.equal(finalized.status, "completed");
});

test("unverifiable commit outcome returns PARTIAL and retains both recoverable stages", async () => {
  await seed();
  const runId = "71111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory, {
    hooks: {
      afterCommitAcknowledged: () => { throw new Error("injected"); },
      beforeCommitVerification: () => { throw new Error("injected"); },
    },
  }));
  assert.equal(result.status, "partial");
  assert.equal(result.partialPhase, "TRANSACTION_OUTCOME");
  assert.equal(result.promotionCode, "RECOVERY_COMMIT_OUTCOME_UNKNOWN");
  for (const stagePath of [result.stages.adminStage, result.stages.uatStage]) {
    const metadata = await stat(stagePath);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.uid, 0);
    assert.equal(metadata.gid, 0);
  }
  assert.deepEqual(await runEvidence(runId), {
    audit_count: 11,
    marker_count: 1,
    target_active_sessions: 0,
    unrelated_active_sessions: 1,
  });
  const promoted = await executeRetainedStagePromotion(options(runId, directory));
  assert.equal(promoted.status, "canonical_active");
  await validateRecoveryCredentialFiles(result.stages.adminCanonical, result.stages.uatCanonical, runId);
  const finalized = await executeStageFinalization(await finalizationOptions(runId, directory));
  assert.equal(finalized.status, "completed");
});

test("guarded finalization requires explicit confirmation and restores both stages after injected cleanup failure", async () => {
  await seed();
  const runId = "81111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory));
  assert.equal(result.status, "canonical_active");
  const adminStage = await readFile(result.stages.adminStage);
  const uatStage = await readFile(result.stages.uatStage);
  const evidenceBefore = await runEvidence(runId);

  await assert.rejects(
    executeStageFinalization(options(runId, directory)),
    (error) => error?.code === "RECOVERY_FINALIZE_CONFIRMATION_REQUIRED",
  );
  assert.equal((await readFile(result.stages.adminStage)).equals(adminStage), true);
  assert.equal((await readFile(result.stages.uatStage)).equals(uatStage), true);

  await assert.rejects(
    executeStageFinalization(options(runId, directory, { finalizationConfirmation: true })),
    (error) => error?.code === "RECOVERY_BROWSER_EVIDENCE_REQUIRED",
  );
  assert.equal((await readFile(result.stages.adminStage)).equals(adminStage), true);
  assert.equal((await readFile(result.stages.uatStage)).equals(uatStage), true);

  const partial = await executeStageFinalization(await finalizationOptions(runId, directory, {
    hooks: { beforeFinalization: (target) => { if (target === "uat-stage") throw new Error("injected"); } },
  }));
  assert.equal(partial.status, "partial");
  assert.equal(partial.partialPhase, "FINALIZATION");
  assert.equal((await readFile(result.stages.adminStage)).equals(adminStage), true);
  assert.equal((await readFile(result.stages.uatStage)).equals(uatStage), true);
  assert.deepEqual(await runEvidence(runId), evidenceBefore);

  await unlink(result.stages.adminStage);
  const finalized = await executeStageFinalization(await finalizationOptions(runId, directory));
  assert.equal(finalized.status, "completed");
  await assert.rejects(access(result.stages.adminStage));
  await assert.rejects(access(result.stages.uatStage));
  assert.deepEqual(await runEvidence(runId), evidenceBefore);
});

test("prepared finalization marker recovers a crash after both stages were removed", async () => {
  await seed();
  const runId = "82111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory));
  assert.equal(result.status, "canonical_active");
  const partial = await executeStageFinalization(await finalizationOptions(runId, directory, {
    hooks: { beforeFinalization: (target) => { if (target === "directory") throw new Error("injected"); } },
  }));
  assert.equal(partial.status, "partial");
  await unlink(result.stages.adminStage);
  await unlink(result.stages.uatStage);
  await unlink(`${directory}/browser-verification.json`);
  const finalized = await executeStageFinalization(options(runId, directory, {
    finalizationConfirmation: true,
    browserVerificationEvidencePath: `${directory}/browser-verification.json`,
    now: new Date(Date.now() + 16 * 60 * 1000),
  }));
  assert.equal(finalized.status, "completed");
  await assert.rejects(access(result.stages.adminStage));
  await assert.rejects(access(result.stages.uatStage));
});

test("guarded retained promotion rejects a policy-valid Stage that is not bound to committed hashes", async () => {
  await seed();
  const runId = "91111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory, {
    hooks: { beforePromotion: (target) => { if (target === "uat") throw new Error("injected"); } },
  }));
  assert.equal(result.status, "partial");
  const original = await readFile(result.stages.uatStage);
  const tampered = JSON.parse(original.toString("utf8"));
  tampered.accounts[0].password = `R${randomBytes(24).toString("base64url")}!7a`;
  await writeFile(result.stages.uatStage, `${JSON.stringify(tampered, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(
    executeRetainedStagePromotion(options(runId, directory)),
    (error) => error?.code === "RECOVERY_STAGE_DATABASE_MISMATCH",
  );
  assert.equal((await readFile(result.stages.uatStage)).equals(Buffer.from(`${JSON.stringify(tampered, null, 2)}\n`)), true);
  assert.deepEqual(await runEvidence(runId), {
    audit_count: 11,
    marker_count: 1,
    target_active_sessions: 0,
    unrelated_active_sessions: 1,
  });
});

test("guarded finalization rejects incomplete persistent audit evidence and retains both stages", async () => {
  await seed();
  const runId = "a1111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const result = await executeRecovery(options(runId, directory));
  assert.equal(result.status, "canonical_active");
  const adminStage = await readFile(result.stages.adminStage);
  const uatStage = await readFile(result.stages.uatStage);
  await pool.query("delete from audit_log where operation_id=$1::uuid and target_username='uat_20260729_quality'", [runId]);
  await assert.rejects(
    executeStageFinalization(await finalizationOptions(runId, directory)),
    (error) => error?.code === "RECOVERY_COMMITTED_EVIDENCE_REQUIRED",
  );
  assert.equal((await readFile(result.stages.adminStage)).equals(adminStage), true);
  assert.equal((await readFile(result.stages.uatStage)).equals(uatStage), true);
});

test("main recovery refuses promotion when a Stage changes after the database commit", async () => {
  await seed();
  const runId = "b1111111-2222-4333-8444-555555555555";
  const directory = await stageDirectory(runId);
  const adminStagePath = `${directory}/.parallel-admin.txt.stage-${runId}`;
  const result = await executeRecovery(options(runId, directory, {
    hooks: {
      beforePromotion: async (target) => {
        if (target !== "admin") return;
        const document = JSON.parse(await readFile(adminStagePath, "utf8"));
        document.password = `R${randomBytes(24).toString("base64url")}!7a`;
        await writeFile(adminStagePath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      },
    },
  }));
  assert.equal(result.status, "partial");
  assert.equal(result.partialPhase, "PROMOTION");
  assert.equal(result.promotionCode, "RECOVERY_STAGE_DATABASE_MISMATCH");
  assert.deepEqual(await runEvidence(runId), {
    audit_count: 11,
    marker_count: 1,
    target_active_sessions: 0,
    unrelated_active_sessions: 1,
  });
  await assert.rejects(access(result.stages.adminCanonical));
  await assert.rejects(access(result.stages.uatCanonical));
});
