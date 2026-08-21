import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod, chown, link, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  DynamicEvidenceV3Error,
  canonical,
  digestValue,
  expectedPsqlArguments,
  loadAndValidatePolicy,
  normalizeSql,
  parseStrictJson,
  readTrustedArtifactFile,
  resetLayoutSql,
  setupClusterSql,
  verifyCompressedSqlEvidence,
  validateFixedExecutionReceipt,
  validatePsqlCommandReceipt,
  validatePolicy,
} from "../scripts/uat-promotion-dynamic-evidence-v3.mjs";


function clone(value) {
  return structuredClone(value);
}


test("V3 policy is closed, partial-only and explicitly preserves trust-boundary nonclaims", () => {
  const policy = loadAndValidatePolicy();
  assert.equal(policy.schema_version, 3);
  assert.equal(policy.audit_clearance, "PARTIAL_ONLY");
  assert.equal(policy.production_opcode, "PG_RB_GUARDED_SWITCH_V3");
  assert.equal(policy.migration_fixture.expected_count, 46);
  assert.equal(policy.case_catalog[0].required_scenarios.length, 10);
  assert.equal(policy.case_catalog[0].required_assertions.length, 15);
  assert.equal(
    policy.sql_evidence.reconciliation_normalized_sha256,
    "067255c7e6b319dbea1660bebca1b3259bb6e61363f5818ec88f226fc99ce339",
  );
  assert.equal(
    policy.sql_evidence.production_normalized_sha256,
    "b4e0c24f4e7852980fd090c073912957782571723ef502e8c21763c67f96a140",
  );
  assert.ok(policy.required_non_claims.includes(
    "DOES_NOT_PROVE_CONCURRENT_NONCOOPERATING_ROOT_OR_POSTGRESQL_SUPERUSER_EXCLUSION",
  ));
  assert.ok(policy.required_non_claims.includes(
    "DOES_NOT_PROVE_REAL_DATA_VOLUME_FINISHES_WITHIN_240_SECOND_CONTENT_TIMEOUT",
  ));
  assert.ok(policy.required_non_claims.includes(
    "DOES_NOT_PROVE_REAL_PREFIX_SIDE_EFFECT_EXECUTION_OR_RECEIPTS",
  ));
  assert.ok(policy.required_non_claims.includes(
    "DOES_NOT_PROVE_PROCESS_TERMINATION_OR_FRESH_PROCESS_RESTART_RECOVERY",
  ));
  assert.ok(policy.required_non_claims.includes(
    "DOES_NOT_PROVE_TRANSPORT_LEVEL_POSTGRESQL_COMMIT_RESPONSE_LOSS",
  ));
});


test("V3 canonical digest matches the executor newline and recursive key ordering", () => {
  const value = { z: [3, { y: true, x: "晨亿达" }], a: { c: null, b: 2 } };
  assert.equal(
    canonical(value),
    '{"a":{"b":2,"c":null},"z":[3,{"x":"晨亿达","y":true}]}\n',
  );
  assert.match(digestValue(value), /^[0-9a-f]{64}$/);
});


test("V3 canonical form rejects every non-safe-integer numeric value", () => {
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => canonical({ value }),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_EVIDENCE_JSON_INVALID",
    );
  }
});


test("V3 strict JSON boundary rejects duplicate keys and non-integer spellings", () => {
  assert.deepEqual(parseStrictJson(Buffer.from('{"a":1,"nested":[2,true,null]}')),
    { a: 1, nested: [2, true, null] });
  for (const raw of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"value":1.0}',
    '{"value":1e0}',
    '{"value":-0}',
    '{"value":9007199254740992}',
  ]) {
    assert.throws(
      () => parseStrictJson(Buffer.from(raw)),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_EVIDENCE_JSON_INVALID",
    );
  }
  assert.throws(
    () => parseStrictJson(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d])),
    (error) => error instanceof DynamicEvidenceV3Error
      && error.code === "TASK70_V3_EVIDENCE_JSON_INVALID",
  );
});


test("V3 artifact reader requires stable root-owned 0400 single-link bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "task70-v3-artifact-reader-"));
  const artifact = join(root, "artifact.json");
  const hardlink = join(root, "artifact-hardlink.json");
  const symbolic = join(root, "artifact-symlink.json");
  try {
    await writeFile(artifact, '{"ok":1}\n', { mode: 0o600 });
    await chmod(artifact, 0o400);
    assert.equal(readTrustedArtifactFile(artifact, 1024).toString("utf8"), '{"ok":1}\n');

    await chmod(artifact, 0o440);
    assert.throws(() => readTrustedArtifactFile(artifact, 1024),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_ARTIFACT_INVALID");
    await chmod(artifact, 0o400);

    await link(artifact, hardlink);
    assert.throws(() => readTrustedArtifactFile(artifact, 1024),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_ARTIFACT_INVALID");
    await unlink(hardlink);

    await symlink(artifact, symbolic);
    assert.throws(() => readTrustedArtifactFile(symbolic, 1024),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_ARTIFACT_INVALID");

    try {
      await chown(artifact, 65534, 65534);
      assert.throws(() => readTrustedArtifactFile(artifact, 1024),
        (error) => error instanceof DynamicEvidenceV3Error
          && error.code === "TASK70_V3_ARTIFACT_INVALID");
    } catch (error) {
      assert.equal(error.code, "EPERM");
      assert.equal((await stat(artifact)).uid, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("V3 SQL receipt independently binds target role variables argv stdin and limits", () => {
  const sql = Buffer.from("SELECT :'expected_database'::text;\n", "utf8");
  const spec = {
    phase: "migration_0001",
    containerId: "a".repeat(64),
    database: "chenyida_erp_rb_deadbeefdeadbeef",
    username: "chenyida_erp_owner",
    writeOverride: true,
    variables: { expected_database: "chenyida_erp_rb_deadbeefdeadbeef" },
    verbosity: "terse",
    timeoutSeconds: 300,
    maximumOutputBytes: 32 * 1024 * 1024,
    exitCode: 0,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    sql,
  };
  const argv = expectedPsqlArguments(spec);
  assert.ok(argv.includes("PGOPTIONS=-c default_transaction_read_only=off"));
  assert.ok(argv.includes("--username=chenyida_erp_owner"));
  assert.ok(argv.includes("--set=expected_database=chenyida_erp_rb_deadbeefdeadbeef"));
  const executionBody = {
    container_id: spec.containerId,
    database: spec.database,
    username: spec.username,
    write_override: spec.writeOverride,
    variables: spec.variables,
    verbosity: spec.verbosity,
    timeout_seconds: spec.timeoutSeconds,
    maximum_output_bytes: spec.maximumOutputBytes,
    argv_sha256: digestValue(argv),
    stdin_sha256: createHash("sha256").update(sql).digest("hex"),
  };
  const execution = {
    ...executionBody, execution_sha256: digestValue(executionBody),
  };
  const receiptBody = {
    phase: spec.phase,
    sql_sha256: execution.stdin_sha256,
    execution,
    exit_code: 0,
    stdout_sha256: createHash("sha256").update(spec.stdout).digest("hex"),
    stderr_sha256: createHash("sha256").update(spec.stderr).digest("hex"),
  };
  const receipt = { ...receiptBody, receipt_sha256: digestValue(receiptBody) };
  assert.equal(validatePsqlCommandReceipt(receipt, spec), receipt);

  const rehash = (value) => {
    const executionCopy = { ...value.execution };
    delete executionCopy.execution_sha256;
    value.execution.execution_sha256 = digestValue(executionCopy);
    const receiptCopy = { ...value };
    delete receiptCopy.receipt_sha256;
    value.receipt_sha256 = digestValue(receiptCopy);
    return value;
  };
  for (const mutate of [
    (value) => { value.execution.database = "postgres"; },
    (value) => { value.execution.username = "postgres"; },
    (value) => { value.execution.write_override = false; },
    (value) => { value.execution.variables.expected_database = "postgres"; },
    (value) => { value.execution.argv_sha256 = "b".repeat(64); },
    (value) => { value.execution.stdin_sha256 = "c".repeat(64); },
    (value) => { value.execution.timeout_seconds = 301; },
  ]) {
    const altered = clone(receipt);
    mutate(altered);
    rehash(altered);
    assert.throws(() => validatePsqlCommandReceipt(altered, spec),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_SQL_RECEIPT_INVALID");
  }
});


test("V3 fixed executor receipt binds the completed production psql invocation", () => {
  const sql = Buffer.from("SELECT true;\n", "utf8");
  const base = {
    databases: {
      staging_name: "chenyida_erp_rb_deadbeefdeadbeef",
      staging_marker: "chenyida-erp-task70-isolated-v3-test/v1",
    },
    postgres: {
      container_id: "a".repeat(64), system_identifier: "7612345678901234567",
    },
    security: { database_owner: "chenyida_erp_owner" },
  };
  const opcode = {
    phase: "guardedswitch", database: base.databases.staging_name,
    sql_sha256: createHash("sha256").update(sql).digest("hex"),
  };
  const variables = {
    capture_security_state: "1", sealed_staging_mode: "1",
    expected_database: base.databases.staging_name,
    expected_marker: base.databases.staging_marker,
    expected_system_identifier: base.postgres.system_identifier,
    migration_owner: base.security.database_owner,
  };
  const argv = [
    "exec", "--interactive", "--user", "999:999", "--env",
    "PGAPPNAME=cyd_rb_deadbeefdeadbeef_guardedswitch",
    "--env", "PGOPTIONS=-c default_transaction_read_only=off",
    "--", base.postgres.container_id,
    "psql", "--no-psqlrc", "--quiet", "--no-align", "--tuples-only",
    "--field-separator=\t", "--host=/var/run/postgresql", "--port=5432",
    "--username=postgres", "--no-password", `--dbname=${base.databases.staging_name}`,
    ...Object.keys(variables).sort().map((key) => `--set=${key}=${variables[key]}`),
    "--set=ON_ERROR_STOP=on", "--set=VERBOSITY=terse",
  ];
  const environment = {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent",
  };
  const stdout = Buffer.from("t\n", "ascii");
  const stderr = Buffer.alloc(0);
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-task70-v3-fixed-executor-psql-execution-receipt/v1",
    sequence: 2, phase: "guardedswitch", arguments: argv,
    arguments_sha256: digestValue(argv), environment,
    environment_sha256: digestValue(environment), stdin_present: true,
    stdin_bytes: sql.length, stdin_sha256: opcode.sql_sha256,
    timeout_milliseconds: 300_000, maximum_output_bytes: 4 * 1024 * 1024,
    side_effects_started: true, return_code: 0,
    stdout_base64: stdout.toString("base64"), stdout_bytes: stdout.length,
    stdout_sha256: createHash("sha256").update(stdout).digest("hex"),
    stderr_base64: stderr.toString("base64"), stderr_bytes: stderr.length,
    stderr_sha256: createHash("sha256").update(stderr).digest("hex"),
    daemon_state: "COMPLETED_NO_UNTRACKED_PROCESS",
  };
  const receipt = { ...body, execution_receipt_sha256: digestValue(body) };
  assert.equal(
    validateFixedExecutionReceipt(receipt, { base, opcode, sql, sequence: 2 }).receipt,
    receipt,
  );
  for (const mutate of [
    (value) => {
      value.arguments[value.arguments.indexOf("--username=postgres")]
        = "--username=chenyida_erp_owner";
      value.arguments_sha256 = digestValue(value.arguments);
    },
    (value) => { value.stdin_sha256 = "b".repeat(64); },
    (value) => { value.stdout_base64 = "dAr="; },
    (value) => { value.sequence = 3; },
  ]) {
    const altered = clone(receipt);
    mutate(altered);
    const alteredBody = { ...altered };
    delete alteredBody.execution_receipt_sha256;
    altered.execution_receipt_sha256 = digestValue(alteredBody);
    assert.throws(
      () => validateFixedExecutionReceipt(altered, { base, opcode, sql, sequence: 2 }),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_FIXED_EXECUTION_RECEIPT_INVALID",
    );
  }
});


test("V3 setup and reset SQL reconstruction matches the Python producer golden bytes", async () => {
  const policy = loadAndValidatePolicy();
  const privilegePolicy = JSON.parse(await readFile(new URL(
    "../operations/postgresql-runtime-privilege-policy-v2.json", import.meta.url,
  ), "utf8"));
  const setup = setupClusterSql(policy, privilegePolicy);
  assert.equal(setup.length, 2538);
  assert.equal(
    createHash("sha256").update(setup).digest("hex"),
    "919ec37296b6d65b3ddb33ba4ba3c8f4cf8f9b6d5883a762a7af56e9c4cfd626",
  );
  assert.match(
    setup.toString("utf8"),
    /GRANT ALL PRIVILEGES ON TABLESPACE pg_default TO CURRENT_USER;\nGRANT ALL PRIVILEGES ON TABLESPACE pg_global TO CURRENT_USER;/,
  );
  const invalidPrivilegePolicy = structuredClone(privilegePolicy);
  invalidPrivilegePolicy.tablespaces.built_in = ["pg_default"];
  assert.throws(
    () => setupClusterSql(policy, invalidPrivilegePolicy),
    (error) => error instanceof DynamicEvidenceV3Error
      && error.code === "TASK70_V3_SQL_RECEIPT_INVALID",
  );

  const reset = resetLayoutSql({
    databases: {
      active_name: "chenyida_erp",
      staging_name: "chenyida_erp_rb_deadbeefdeadbeef",
      quarantine_name: "chenyida_erp_candidate_deadbeefdeadbeef",
      candidate_marker: policy.required_target_guard.executor_fixture_candidate_marker,
      candidate_oid: "16384",
      quarantine_marker:
        "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:QUARANTINED",
      staging_marker:
        "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING",
    },
  }, "16385");
  assert.equal(reset.length, 1305);
  assert.equal(
    createHash("sha256").update(reset).digest("hex"),
    "e13d3a25057fc882e02baa60486e7766072f14e9cf22ec09038cca403563fb85",
  );
});


test("V3 SQL evidence accepts one canonical mtime-zero gzip member only", () => {
  const raw = Buffer.from("SELECT true;\n", "utf8");
  const compressed = gzipSync(raw, { level: 9, mtime: 0 });
  const roots = {
    base: {
      postgres: { system_identifier: "7612345678901234567" },
      databases: {
        active_name: "chenyida_erp",
        staging_name: "chenyida_erp_rb_deadbeefdeadbeef",
        candidate_oid: "16384",
      },
    },
    fixture: { restored_oid: "16385" },
  };
  const normalizedSha256 = createHash("sha256").update(raw).digest("hex");
  const body = {
    encoding: "GZIP_BASE64_MTIME_ZERO",
    uncompressed_bytes: raw.length,
    uncompressed_sha256: normalizedSha256,
    normalized_sha256: normalizedSha256,
    gzip_bytes: compressed.length,
    gzip_sha256: createHash("sha256").update(compressed).digest("hex"),
    gzip_base64: compressed.toString("base64"),
  };
  const evidence = { ...body, sql_evidence_sha256: digestValue(body) };
  assert.deepEqual(
    verifyCompressedSqlEvidence(evidence, roots, normalizedSha256, 4096), raw,
  );
  assert.throws(
    () => verifyCompressedSqlEvidence(evidence, roots, "f".repeat(64), 4096),
    (error) => error instanceof DynamicEvidenceV3Error
      && error.code === "TASK70_V3_SQL_EVIDENCE_INVALID",
  );

  const withCompressed = (encoded) => {
    const changed = {
      ...evidence,
      gzip_bytes: encoded.length,
      gzip_sha256: createHash("sha256").update(encoded).digest("hex"),
      gzip_base64: encoded.toString("base64"),
    };
    const changedBody = { ...changed };
    delete changedBody.sql_evidence_sha256;
    changed.sql_evidence_sha256 = digestValue(changedBody);
    return changed;
  };
  const nonzeroMtime = Buffer.from(compressed);
  nonzeroMtime[4] = 1;
  const emptyMember = gzipSync(Buffer.alloc(0), { level: 9, mtime: 0 });
  for (const mutated of [
    withCompressed(nonzeroMtime),
    withCompressed(Buffer.concat([compressed, emptyMember])),
  ]) {
    assert.throws(
      () => verifyCompressedSqlEvidence(mutated, roots, normalizedSha256, 4096),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_SQL_EVIDENCE_INVALID",
    );
  }
});


test("V3 SQL normalization distinguishes bound content hex from unknown digest", () => {
  const bound = createHash("sha256").update("task70-bound-content").digest("hex");
  const largeObjects = createHash("sha256").update("0:0:0:0:0:0").digest("hex");
  const longIdentity = "61".repeat(20) + "016384" + "61".repeat(17);
  const exactShaLengthIdentity = "62".repeat(32);
  const longExtension = "65".repeat(40);
  const roots = {
    base: {
      postgres: { system_identifier: "7612345678901234567" },
      databases: {
        active_name: "chenyida_erp",
        staging_name: "chenyida_erp_rb_deadbeefdeadbeef",
        candidate_oid: "16384",
      },
      bound_sha256: bound,
    },
    fixture: {
      restored_oid: "16385",
      content_report_rows: [
        ["RELATION", longIdentity, "16384", bound],
        ["SEQUENCE", exactShaLengthIdentity, "16385", "false"],
        ["EXTENSION", longExtension, "31", "7075626c6963"],
        ["LARGE_OBJECTS", "0", "0", largeObjects],
      ],
    },
  };
  const raw = Buffer.from(
    "SELECT (SELECT system_identifier::text FROM "
      + "pg_catalog.pg_control_system()) <> '7612345678901234567';\n"
      + "SELECT d.datname='chenyida_erp_rb_deadbeefdeadbeef' "
      + "AND d.oid::text='16385';\n"
      + "SELECT d.datname='chenyida_erp' AND d.oid::text='16384';\n"
      + "SELECT $json${\"target\":{\"database_oid\":\"16385\","
      + "\"marker_sha256\":\"" + bound + "\"}}$json$;\n"
      + `SELECT '${longIdentity}','${exactShaLengthIdentity}';\n`
      + `SELECT '[[\"${longExtension}\",\"31\",\"7075626c6963\"]]'::jsonb;\n`
      + "SELECT '16384','16385';\n",
    "utf8",
  );
  const normalizedSha256 =
    "9d3eea6bfc39a1d4ec16849bb2ae3f68c9585ddcf4681bca95ae905175c8713b";
  assert.equal(
    createHash("sha256").update(normalizeSql(raw, roots, "PRODUCTION")).digest("hex"),
    normalizedSha256,
  );

  const evidenceFor = (sql, expectedNormalized) => {
    const compressed = gzipSync(sql, { level: 9, mtime: 0 });
    const body = {
      encoding: "GZIP_BASE64_MTIME_ZERO",
      uncompressed_bytes: sql.length,
      uncompressed_sha256: createHash("sha256").update(sql).digest("hex"),
      normalized_sha256: expectedNormalized,
      gzip_bytes: compressed.length,
      gzip_sha256: createHash("sha256").update(compressed).digest("hex"),
      gzip_base64: compressed.toString("base64"),
    };
    return { ...body, sql_evidence_sha256: digestValue(body) };
  };

  assert.deepEqual(
    verifyCompressedSqlEvidence(
      evidenceFor(raw, normalizedSha256), roots, normalizedSha256, 4096,
      "PRODUCTION",
    ),
    raw,
  );
  for (const invalid of [
    Buffer.from(`SELECT '${"63".repeat(32)}';\n`),
    Buffer.from(`SELECT '${"64".repeat(40)}';\n`),
    Buffer.from(`-- ${exactShaLengthIdentity}\nSELECT true;\n`),
  ]) {
    const claimed = createHash("sha256").update(invalid).digest("hex");
    assert.throws(
      () => verifyCompressedSqlEvidence(
        evidenceFor(invalid, claimed), roots, claimed, 4096,
      ),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_SQL_EVIDENCE_INVALID",
    );
  }
  const expanded = Buffer.from(`${bound}\n`.repeat(14_000));
  assert.ok(expanded.length < 1_048_576);
  const claimed = createHash("sha256").update(expanded).digest("hex");
  assert.throws(
    () => verifyCompressedSqlEvidence(
      evidenceFor(expanded, claimed), roots, claimed, 1_048_576,
    ),
    (error) => error instanceof DynamicEvidenceV3Error
      && error.code === "TASK70_V3_SQL_EVIDENCE_INVALID",
  );
});


test("V3 source verifier binds each current byte stream to the selected Git blob", async () => {
  const source = await readFile(
    new URL("../scripts/uat-promotion-dynamic-evidence-v3.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\["cat-file", "blob", binding\.git_blob\]/);
  assert.match(source, /digestBytes\(blobRaw\) !== binding\.sha256/);
});


test("V3 release inventory content-addresses this complete verifier test", async () => {
  const inventory = JSON.parse(await readFile(new URL(
    "../release/release-test-inventory-v1.json", import.meta.url,
  ), "utf8"));
  const entry = inventory.tests.find(
    (item) => item.path === "tests/selfhost-uat-promotion-dynamic-evidence-v3.test.mjs",
  );
  assert.ok(entry);
  const source = await readFile(new URL(import.meta.url));
  assert.equal(entry.sha256, createHash("sha256").update(source).digest("hex"));
});


test("V3 policy mutation, scenario removal and nonclaim removal fail closed", () => {
  const policy = loadAndValidatePolicy();
  for (const mutated of [
    { ...clone(policy), audit_clearance: "FULL" },
    {
      ...clone(policy),
      case_catalog: [{
        ...clone(policy.case_catalog[0]),
        required_scenarios: policy.case_catalog[0].required_scenarios.slice(1),
      }],
    },
    {
      ...clone(policy),
      required_non_claims: policy.required_non_claims.filter(
        (item) => !item.includes("NONCOOPERATING_ROOT"),
      ),
    },
  ]) {
    assert.throws(
      () => validatePolicy(mutated),
      (error) => error instanceof DynamicEvidenceV3Error
        && error.code === "TASK70_V3_POLICY_INVALID",
    );
  }
});


test("V3 source path set is unique, sorted and includes every migration", () => {
  const policy = loadAndValidatePolicy();
  assert.deepEqual(policy.source_paths, [...policy.source_paths].sort());
  assert.equal(new Set(policy.source_paths).size, policy.source_paths.length);
  const migrations = policy.source_paths.filter(
    (path) => /^chenyida_erp_site\/drizzle-postgres\/\d{4}_[a-z0-9_]+\.sql$/.test(path),
  );
  assert.equal(migrations.length, 46);
  assert.equal(migrations.at(-1),
    "chenyida_erp_site/drizzle-postgres/0046_runtime_lock_privilege_boundary.sql");
});
