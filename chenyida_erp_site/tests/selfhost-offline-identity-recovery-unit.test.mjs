import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import {
  assertCanonicalDocuments,
  assertObservedDatabaseState,
  assertOfflineState,
  assertRecoveryCredentialDocuments,
  assertStaticGuards,
  createCredentialDocuments,
  diagnoseUatCredentialJson,
  diagnoseUatCredentialValue,
  formatUatSchemaDiagnosis,
  RECOVERY_ACCOUNTS,
} from "../tools/offline-identity-recovery/core.ts";
import { validatePassword } from "../app/lib/identity-selfhost/password.ts";

const execFileAsync = promisify(execFile);
const runId = "d13e64b8-ea35-4e95-b08f-673e613aa403";

function assertRedactedOutput(output, forbiddenValues, label) {
  for (const value of forbiddenValues) {
    if (value && output.includes(value)) throw new Error(`redaction check failed: ${label}`);
  }
}

function base(overrides = {}) {
  return {
    environment: "parallel-uat",
    deploymentClass: "uat",
    expectedMigration: "0036",
    recoveryRunId: runId,
    confirmation: true,
    effectiveUid: 0,
    ...overrides,
  };
}

function testDatabaseUrl(password) {
  const value = new URL("http://postgres");
  value.protocol = "postgresql:";
  value.username = "chenyida_erp";
  value.password = password;
  value.port = "5432";
  value.pathname = "/chenyida_erp";
  return value.toString();
}

test("static guard rejects production, non-root, missing confirmation and unexpected migration", () => {
  for (const [override, code] of [
    [{ deploymentClass: "production" }, "RECOVERY_PRODUCTION_FORBIDDEN"],
    [{ effectiveUid: 1000 }, "RECOVERY_ROOT_REQUIRED"],
    [{ confirmation: false }, "RECOVERY_CONFIRMATION_REQUIRED"],
    [{ expectedMigration: "0035" }, "RECOVERY_EXPECTED_MIGRATION_INVALID"],
  ]) {
    assert.throws(() => assertStaticGuards(base(override)), (error) => error?.code === code);
  }
});

test("observed database and offline guards reject wrong migration and running writers", () => {
  const observed = {
    current_database: "chenyida_erp",
    current_user: "chenyida_erp",
    read_only: "off",
    migration_count: 36,
    migration_head: "0036_project_requirement_unit_resolution.sql",
  };
  assert.doesNotThrow(() => assertObservedDatabaseState(observed, "chenyida_erp", "0036"));
  assert.doesNotThrow(() => assertObservedDatabaseState({ ...observed, read_only: "on" }, "chenyida_erp", "0036", "on"));
  assert.throws(
    () => assertObservedDatabaseState({ ...observed, migration_head: "0035_project_planning_handoff.sql" }, "chenyida_erp", "0036"),
    (error) => error?.code === "RECOVERY_MIGRATION_MISMATCH",
  );
  assert.throws(() => assertOfflineState("running", "stopped", 0, 0), (error) => error?.code === "RECOVERY_WRITERS_STILL_ACTIVE");
  assert.throws(() => assertOfflineState("exited", "exited", 1, 0), (error) => error?.code === "RECOVERY_WRITERS_STILL_ACTIVE");
});

test("CSPRNG canonical documents use fixed account order, unique policy-valid secrets and schemas", () => {
  const documents = createCredentialDocuments(runId, new Date("2026-08-01T11:22:33.444Z"));
  assertCanonicalDocuments(documents, runId);
  assertRecoveryCredentialDocuments(documents, runId);
  assert.equal(documents.admin.username, "admin");
  assert.equal(documents.admin.must_change_password, false);
  assert.equal(documents.uat.accounts.length, 10);
  assert.deepEqual(documents.uat.accounts.map(({ username, role }) => ({ username, role })), RECOVERY_ACCOUNTS.slice(1).map(({ username, role }) => ({ username, role })));
  const values = [documents.admin.password, ...documents.uat.accounts.map((account) => account.password)];
  assert.equal(new Set(values).size, 11);
  assert.doesNotThrow(() => validatePassword(documents.admin.password, "admin"));
  documents.uat.accounts.forEach((account) => assert.doesNotThrow(() => validatePassword(account.password, account.username)));
  assert.equal(documents.admin.generated_at, "2026-08-01T19:22:33.444+08:00");
});

test("redacted UAT schema diagnosis classifies synthetic failures without emitting secret material", () => {
  const sentinel = "DO_NOT_EMIT_CANONICAL_SECRET_MATERIAL";
  const documents = createCredentialDocuments(runId, new Date("2026-08-01T11:22:33.444Z"));
  const secretValues = documents.uat.accounts.map((account) => account.password);
  const cases = [
    {
      name: "missing field",
      mutate: (value) => { delete value.accounts[0].role; },
      pointer: "/accounts/0/role",
      keyword: "required",
      expectedType: "string",
      actualType: "missing",
    },
    {
      name: "wrong type",
      mutate: (value) => { value.generated_at = 42; },
      pointer: "/generated_at",
      keyword: "type",
      expectedType: "string",
      actualType: "number",
    },
    {
      name: "additional property",
      mutate: (value) => { value.accounts[0].unexpected = sentinel; },
      pointer: "/accounts/0/<redacted>",
      keyword: "additionalProperties",
      expectedType: "absent",
      actualType: "string",
    },
    {
      name: "duplicate username",
      mutate: (value) => { value.accounts[1].username = value.accounts[0].username; },
      pointer: "/accounts/1/username",
      keyword: "uniqueItems",
      expectedType: "string",
      actualType: "string",
    },
    {
      name: "invalid role",
      mutate: (value) => { value.accounts[0].role = sentinel; },
      pointer: "/accounts/0/role",
      keyword: "enum",
      expectedType: "string",
      actualType: "string",
    },
    {
      name: "secret field policy failure",
      mutate: (value) => { value.accounts[0].password = sentinel; },
      pointer: "/accounts/0/<redacted>",
      keyword: "pattern",
      expectedType: "string",
      actualType: "string",
    },
    {
      name: "missing secret field",
      mutate: (value) => { delete value.accounts[0].password; },
      pointer: "/accounts/0/<redacted>",
      keyword: "required",
      expectedType: "string",
      actualType: "missing",
    },
    {
      name: "must-change failure",
      mutate: (value) => { value.accounts[0].must_change_password = sentinel; },
      pointer: "/accounts/0/must_change_password",
      keyword: "type",
      expectedType: "boolean",
      actualType: "string",
    },
    {
      name: "top-level version failure",
      mutate: (value) => { value.format_version = sentinel; },
      pointer: "/format_version",
      keyword: "const",
      expectedType: "string",
      actualType: "string",
    },
    {
      name: "comment content",
      mutate: (value) => { value.accounts[0].comment = sentinel; },
      pointer: "/accounts/0/<redacted>",
      keyword: "additionalProperties",
      expectedType: "absent",
      actualType: "string",
    },
  ];

  for (const fixture of cases) {
    const value = structuredClone(documents.uat);
    fixture.mutate(value);
    const diagnosis = diagnoseUatCredentialValue(value, runId);
    assert.equal(diagnosis.valid, false, fixture.name);
    assert.ok(diagnosis.errors.some((error) => error.pointer === fixture.pointer
      && error.keyword === fixture.keyword
      && error.expectedType === fixture.expectedType
      && error.actualType === fixture.actualType), fixture.name);
    const output = formatUatSchemaDiagnosis(diagnosis).join("\n");
    assertRedactedOutput(output, [sentinel, ...secretValues], fixture.name);
    assert.doesNotMatch(output, /POINTER \/accounts\/\d+\/password(?: |$)/, fixture.name);
    assert.doesNotMatch(output, /FIELD password(?: |$)/, fixture.name);
  }

  const malformed = formatUatSchemaDiagnosis(diagnoseUatCredentialJson(`{"comment":"${sentinel}"`, runId)).join("\n");
  assertRedactedOutput(malformed, [sentinel, ...secretValues], "malformed JSON");
  assert.match(malformed, /POINTER \/ KEYWORD type EXPECTED_TYPE object ACTUAL_TYPE missing/);

  const mismatchedRun = diagnoseUatCredentialValue(documents.uat, "e13e64b8-ea35-4e95-b08f-673e613aa403");
  assert.deepEqual(mismatchedRun.errors.map(({ pointer, keyword }) => ({ pointer, keyword })), [
    { pointer: "/recovery_run_id", keyword: "const" },
  ]);

  const currentCanonical = structuredClone(documents);
  currentCanonical.uat.accounts[2].must_change_password = false;
  currentCanonical.uat.accounts[3].must_change_password = false;
  currentCanonical.uat.accounts[4].must_change_password = false;
  assert.equal(diagnoseUatCredentialValue(currentCanonical.uat, runId).valid, true);
  assert.doesNotThrow(() => assertCanonicalDocuments(currentCanonical, runId));
  assert.throws(
    () => assertRecoveryCredentialDocuments(currentCanonical, runId),
    (error) => error?.code === "RECOVERY_UAT_INITIAL_STATE_INVALID",
  );
});

test("diagnose-schema CLI reads only a guarded synthetic file and keeps failures redacted", async (context) => {
  const directory = `/run/chenyida-erp/identity-recovery-tests/${runId}`;
  const filePath = `${directory}/uat-role-accounts.txt`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  context.after(() => rm(directory, { recursive: true, force: true }));
  const documents = createCredentialDocuments(runId, new Date("2026-08-01T11:22:33.444Z"));
  const credentialSecrets = documents.uat.accounts.map((account) => account.password);
  await writeFile(filePath, `${JSON.stringify(documents.uat, null, 2)}\n`, { mode: 0o600 });
  const args = [
    "--diagnose-schema",
    "--environment", "parallel-uat-rehearsal",
    "--expected-run-id", runId,
    "--stage-directory", directory,
  ];
  const environment = {
    PATH: process.env.PATH,
    ERP_DEPLOYMENT_CLASS: "test",
    DATABASE_URL: "DO_NOT_READ_DATABASE_URL",
  };
  let passed;
  try {
    passed = await execFileAsync("./tools/offline-identity-recovery/identity-recovery", args, {
      cwd: "/app",
      env: environment,
    });
  } catch {
    throw new Error("diagnostic CLI success path failed safely");
  }
  assertRedactedOutput(`${passed.stdout}${passed.stderr}`, credentialSecrets, "diagnostic CLI success");
  assert.match(passed.stdout, /FINAL SCHEMA_PASS/);
  assert.match(passed.stdout, /COUNT ERRORS 0/);

  const sentinel = "DO_NOT_EMIT_DIAGNOSTIC_SECRET";
  documents.uat.accounts[0].password = sentinel;
  await writeFile(filePath, `${JSON.stringify(documents.uat, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(
    execFileAsync("./tools/offline-identity-recovery/identity-recovery", args, {
      cwd: "/app",
      env: environment,
    }),
    (error) => {
      const output = `${error?.stdout || ""}${error?.stderr || ""}`;
      assertRedactedOutput(output, [sentinel, "DO_NOT_READ_DATABASE_URL", ...credentialSecrets], "diagnostic CLI");
      assert.match(output, /POINTER \/accounts\/0\/<redacted>/);
      assert.match(output, /FINAL SCHEMA_INVALID/);
      return true;
    },
  );

  await chmod(filePath, 0o644);
  await assert.rejects(
    execFileAsync("./tools/offline-identity-recovery/identity-recovery", args, {
      cwd: "/app",
      env: environment,
    }),
    (error) => {
      const output = `${error?.stdout || ""}${error?.stderr || ""}`;
      assertRedactedOutput(output, [sentinel, "DO_NOT_READ_DATABASE_URL", ...credentialSecrets], "diagnostic metadata failure");
      assert.match(output, /RECOVERY_FILE_METADATA_INVALID/);
      return true;
    },
  );
});

test("CLI failure output is fixed and redacts environment material", async () => {
  const sentinel = "DO_NOT_EMIT_RECOVERY_MATERIAL";
  await assert.rejects(
    execFileAsync("./tools/offline-identity-recovery/identity-recovery", [
      "--environment", "parallel-uat",
      "--expected-migration", "0036",
      "--expected-run-id", runId,
      "--confirm-offline-recovery",
    ], {
      cwd: "/app",
      env: {
        ...process.env,
        ERP_DEPLOYMENT_CLASS: "production",
        DATABASE_URL: testDatabaseUrl(sentinel),
      },
    }),
    (error) => {
      const output = `${error?.stdout || ""}${error?.stderr || ""}`;
      assertRedactedOutput(output, [sentinel, "postgresql://", "postgres://"], "recovery CLI failure");
      assert.match(output, /RECOVERY_PRODUCTION_FORBIDDEN/);
      assert.doesNotMatch(output, /postgres(?:ql)?:\/\//i);
      assert.doesNotMatch(output, /password_hash|token_hash|session/i);
      return true;
    },
  );
});

test("CLI finalization requires its independent browser-verification confirmation and rejects it in other modes", async () => {
  const common = [
    "--environment", "parallel-uat",
    "--expected-migration", "0036",
    "--expected-run-id", runId,
    "--confirm-offline-recovery",
  ];
  const environment = {
    ...process.env,
    ERP_DEPLOYMENT_CLASS: "uat",
    DATABASE_URL: testDatabaseUrl("NON_SECRET_TEST_VALUE"),
  };
  await assert.rejects(
    execFileAsync("./tools/offline-identity-recovery/identity-recovery", [...common, "--finalize-recovery-stage"], {
      cwd: "/app",
      env: environment,
    }),
    (error) => /RECOVERY_FINALIZE_CONFIRMATION_REQUIRED/.test(`${error?.stdout || ""}${error?.stderr || ""}`),
  );
  await assert.rejects(
    execFileAsync("./tools/offline-identity-recovery/identity-recovery", [
      ...common,
      "--revoke-target-sessions-after-browser-failure",
      "--session-cleanup-username", "uat_20260729_manager",
    ], { cwd: "/app", env: environment }),
    (error) => /RECOVERY_SESSION_CLEANUP_CONFIRMATION_REQUIRED/.test(`${error?.stdout || ""}${error?.stderr || ""}`),
  );
  for (const flags of [
    [...common, "--confirm-finalize-after-browser-verification"],
    [...common, "--promote-retained-stage-only", "--confirm-finalize-after-browser-verification"],
    [...common, "--browser-verification-evidence", `/run/chenyida-erp/identity-recovery-browser-${runId}.json`],
    [...common, "--confirm-browser-failure-session-cleanup"],
    [...common, "--revoke-target-sessions-after-browser-failure", "--confirm-browser-failure-session-cleanup"],
  ]) {
    await assert.rejects(
      execFileAsync("./tools/offline-identity-recovery/identity-recovery", flags, { cwd: "/app", env: environment }),
      (error) => /RECOVERY_ARGUMENT_INVALID/.test(`${error?.stdout || ""}${error?.stderr || ""}`),
    );
  }
});

test("formal runner pins the approved image and minimum container privilege contract", async () => {
  const runner = await readFile("/app/tools/offline-identity-recovery/run-formal-recovery.sh", "utf8");
  assert.match(runner, /sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa/);
  for (const guard of [
    "--pull never",
    "--entrypoint /app/tools/offline-identity-recovery/identity-recovery",
    "--security-opt no-new-privileges=true",
    "--cap-drop ALL",
    "--cap-add CHOWN",
    "--cap-add DAC_READ_SEARCH",
    "--confirm-finalize-after-browser-verification",
    "--browser-verification-evidence",
    "--promote-retained-stage-only",
    "--revoke-target-sessions-after-browser-failure",
    "--session-cleanup-username",
    "--confirm-browser-failure-session-cleanup",
  ]) assert.ok(runner.includes(guard));
});

test("browser verifier keeps admin secrets outside the page world and emits guarded proof", async () => {
  const browser = await readFile("/app/tools/offline-identity-recovery/browser-verify.mjs", "utf8");
  const isolatedRunner = await readFile("/app/tools/offline-identity-recovery/run-isolated-browser.sh", "utf8");
  const formalRunner = await readFile("/app/tools/offline-identity-recovery/run-formal-browser.sh", "utf8");
  for (const guard of [
    "context.request.post",
    'ignoreDefaultArgs: ["--disable-back-forward-cache"]',
    "BROWSER_SESSION_CLEANUP_UNCERTAIN",
    "BROWSER_REVOKE_REQUIRED",
    "|| !state.loginSucceeded",
    "BROWSER_HISTORY_TRAVERSAL_UNPROVEN",
    "chenyida-erp-browser-verification-provisional-v2",
    "writeBrowserEvidence(args)",
  ]) assert.ok(browser.includes(guard));
  assert.doesNotMatch(browser, /page\.evaluate\(async \(\{ operation, payload \}\)/);
  assert.match(isolatedRunner, /mktemp \/tmp\/chenyida-erp-rehearsal-web\.XXXXXX/);
  assert.match(isolatedRunner, /--evidence-path \/evidence\/\.browser-verification\.provisional\.json/);
  assert.doesNotMatch(isolatedRunner, /\/tmp\/rehearsal-web\.log/);
  for (const guard of [
    "sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd",
    "--pull never",
    "--read-only",
    "--security-opt no-new-privileges=true",
    "--cap-drop ALL",
    "--evidence-path",
    "docker network create",
    "promote-browser-evidence.ts",
  ]) assert.ok(formalRunner.includes(guard));
  assert.doesNotMatch(formalRunner, /trace|har|screenshot|video/i);
  assert.doesNotMatch(formalRunner, /src=\/etc\/chenyida-erp,dst=\/credentials/);
  assert.doesNotMatch(formalRunner, /--network chenyida-erp-parallel_default/);
});
