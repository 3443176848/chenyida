import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { createCredentialDocuments } from "../tools/offline-identity-recovery/core.ts";
import {
  assertTargetedObservedDatabaseState,
  assertTargetedOfflineState,
  assertTargetedStaticGuards,
  prepareTargetedCanonicalCandidate,
  resolveTargetedPaths,
  targetedConfirmationPhrase,
  TARGETED_ACCOUNT,
} from "../tools/offline-identity-recovery/targeted.ts";

const runId = "71111111-2222-4333-8444-555555555555";

function base(overrides = {}) {
  const expectedUserVersion = overrides.expectedUserVersion ?? 6;
  const recoveryRunId = overrides.recoveryRunId ?? runId;
  return {
    pool: null,
    environment: "parallel-uat-rehearsal",
    deploymentClass: "test",
    expectedMigration: "0038",
    recoveryRunId,
    targetUsername: TARGETED_ACCOUNT.username,
    expectedRole: TARGETED_ACCOUNT.role,
    expectedActive: true,
    expectedUserVersion,
    confirmationPhrase: targetedConfirmationPhrase({ recoveryRunId, expectedUserVersion }),
    effectiveUid: 0,
    databaseUrl: "postgresql://chenyida_erp:redacted@postgres:5432/cyd_toir_test_111111111111",
    expectedDatabaseName: "cyd_toir_test_111111111111",
    stageDirectory: `/run/chenyida-erp/targeted-identity-recovery-tests/${recoveryRunId}`,
    promote: true,
    ...overrides,
  };
}

async function runCli(args, input, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn("./tools/offline-identity-recovery/identity-recovery", args, {
      cwd: "/workspace",
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test("targeted static guards require one exact account, 0038, root and the full confirmation phrase", () => {
  assert.doesNotThrow(() => assertTargetedStaticGuards(base()));
  for (const [override, code] of [
    [{ deploymentClass: "production" }, "TARGETED_PRODUCTION_FORBIDDEN"],
    [{ effectiveUid: 1000 }, "TARGETED_ROOT_REQUIRED"],
    [{ expectedMigration: "0037" }, "TARGETED_EXPECTED_MIGRATION_INVALID"],
    [{ targetUsername: "*" }, "TARGETED_SINGLE_ACCOUNT_REQUIRED"],
    [{ targetUsername: `${TARGETED_ACCOUNT.username},uat_20260729_purchase` }, "TARGETED_SINGLE_ACCOUNT_REQUIRED"],
    [{ targetUsername: "uat_20260729_purchase" }, "TARGETED_SINGLE_ACCOUNT_REQUIRED"],
    [{ expectedRole: "purchase" }, "TARGETED_ROLE_INVALID"],
    [{ expectedActive: false }, "TARGETED_ACTIVE_STATE_INVALID"],
    [{ expectedUserVersion: 0 }, "TARGETED_VERSION_INVALID"],
    [{ confirmationPhrase: "CONFIRM" }, "TARGETED_CONFIRMATION_REQUIRED"],
  ]) {
    assert.throws(() => assertTargetedStaticGuards(base(override)), (error) => error?.code === code);
  }
});

test("database and offline guards fail closed for wrong identity, migration or writer state", () => {
  const observed = {
    current_database: "cyd_toir_test_111111111111",
    current_user: "chenyida_erp",
    read_only: "off",
    migration_count: 38,
    migration_head: "0038_supplier_mapping_governance.sql",
  };
  assert.doesNotThrow(() => assertTargetedObservedDatabaseState(observed, observed.current_database));
  assert.throws(
    () => assertTargetedObservedDatabaseState({ ...observed, migration_count: 37 }, observed.current_database),
    (error) => error?.code === "TARGETED_MIGRATION_MISMATCH",
  );
  assert.throws(
    () => assertTargetedObservedDatabaseState({ ...observed, current_database: "wrong" }, observed.current_database),
    (error) => error?.code === "TARGETED_DATABASE_IDENTITY_REJECTED",
  );
  assert.doesNotThrow(() => assertTargetedOfflineState("exited", "exited", 0, 0));
  assert.throws(() => assertTargetedOfflineState("running", "exited", 0, 0), (error) => error?.code === "TARGETED_WRITERS_STILL_ACTIVE");
  assert.throws(() => assertTargetedOfflineState("exited", "exited", 1, 0), (error) => error?.code === "TARGETED_WRITERS_STILL_ACTIVE");
});

test("v2 writer creates a guarded candidate with exactly the operations password and must-change differences", async (context) => {
  const options = base();
  const paths = resolveTargetedPaths(options);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await chmod(paths.directory, 0o700);
  context.after(() => rm(paths.directory, { recursive: true, force: true }));
  const documents = createCredentialDocuments("81111111-2222-4333-8444-555555555555", new Date("2026-08-04T12:00:00.000Z"));
  await writeFile(paths.canonical, `${JSON.stringify(documents.uat, null, 2)}\n`, { mode: 0o600 });
  const password = `A9!z${randomBytes(32).toString("hex")}`;
  const evidence = await prepareTargetedCanonicalCandidate(options, password);
  assert.equal(evidence.paths.candidate, paths.candidate);
  const before = JSON.parse(await readFile(paths.canonical, "utf8"));
  const after = JSON.parse(await readFile(paths.candidate, "utf8"));
  assert.equal(before.accounts.length, 10);
  assert.equal(after.accounts.length, 10);
  for (let index = 0; index < before.accounts.length; index += 1) {
    const left = before.accounts[index];
    const right = after.accounts[index];
    if (left.username === TARGETED_ACCOUNT.username) {
      assert.equal(left.must_change_password, true);
      assert.equal(right.must_change_password, false);
      assert.equal(right.password !== left.password, true);
      assert.equal(right.password === password, true);
      assert.deepEqual(
        { ...right, password: left.password, must_change_password: left.must_change_password },
        left,
      );
    } else {
      assert.deepEqual(right, left);
    }
  }
  assert.deepEqual(
    { ...after, accounts: before.accounts },
    before,
  );
  const metadata = await stat(paths.candidate);
  assert.equal(metadata.uid, 0);
  assert.equal(metadata.gid, 0);
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(metadata.nlink, 1);
});

test("candidate writer failure removes its candidate and never changes the canonical", async (context) => {
  const recoveryRunId = "91111111-2222-4333-8444-555555555555";
  const options = base({
    recoveryRunId,
    confirmationPhrase: targetedConfirmationPhrase({ recoveryRunId, expectedUserVersion: 6 }),
    stageDirectory: `/run/chenyida-erp/targeted-identity-recovery-tests/${recoveryRunId}`,
    hooks: { afterCandidateWrite: () => { throw new Error("injected"); } },
  });
  const paths = resolveTargetedPaths(options);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await chmod(paths.directory, 0o700);
  context.after(() => rm(paths.directory, { recursive: true, force: true }));
  const documents = createCredentialDocuments("a1111111-2222-4333-8444-555555555555");
  const canonical = `${JSON.stringify(documents.uat, null, 2)}\n`;
  await writeFile(paths.canonical, canonical, { mode: 0o600 });
  await assert.rejects(
    prepareTargetedCanonicalCandidate(options, `A9!z${randomBytes(32).toString("hex")}`),
    (error) => error?.code === "TARGETED_CANDIDATE_PREPARATION_FAILED",
  );
  assert.equal(await readFile(paths.canonical, "utf8"), canonical);
  await assert.rejects(readFile(paths.candidate));
});

test("CLI accepts the secret only on stdin and keeps it redacted when exact-target validation fails", async () => {
  const sentinel = `Z9!${randomBytes(32).toString("hex")}Aa`;
  const expectedUserVersion = 6;
  const confirmationPhrase = targetedConfirmationPhrase({ recoveryRunId: runId, expectedUserVersion });
  const result = await runCli([
    "--environment", "parallel-uat-rehearsal",
    "--expected-migration", "0038",
    "--expected-run-id", runId,
    "--expected-database-name", "cyd_toir_test_111111111111",
    "--stage-directory", `/run/chenyida-erp/targeted-identity-recovery-tests/${runId}`,
    "--target-username", "*",
    "--expected-role", "operations",
    "--expected-active", "true",
    "--expected-user-version", String(expectedUserVersion),
    "--targeted-confirmation-phrase", confirmationPhrase,
    "--targeted-finalize-account",
    "--targeted-password-stdin",
  ], `${sentinel}\n`, {
    PATH: process.env.PATH,
    ERP_DEPLOYMENT_CLASS: "test",
    DATABASE_URL: "postgresql://chenyida_erp:redacted@postgres:5432/chenyida_erp",
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.code, 2);
  assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes("redacted"), false);
  assert.match(result.stdout, /STAGE PRECHECK FAIL TARGETED_SINGLE_ACCOUNT_REQUIRED/);
  assert.match(result.stdout, /FINAL BLOCKED/);
});
