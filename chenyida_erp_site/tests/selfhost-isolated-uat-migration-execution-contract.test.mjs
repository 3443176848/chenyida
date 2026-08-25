import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ISOLATED_UAT_MIGRATION_ENGINE_RESULT_CONTRACT,
  ISOLATED_UAT_MIGRATION_GRANT_CONTRACT,
  IsolatedUatMigrationExecutionError,
  assertIsolatedUatMigrationEngineResultMatchesGrant,
  canonicalIsolatedUatMigrationExecutionJson,
  createIsolatedUatMigrationEngineResult,
  createIsolatedUatMigrationGrant,
  isolatedUatMigrationExecutionSha256,
  validateIsolatedUatMigrationEngineResult,
  validateIsolatedUatMigrationGrant,
} from "../scripts/isolated-uat-migration-execution-contract.mjs";
import { createControlledMigrationEngineResult } from "../scripts/migrate-postgres.ts";
import { loadReleaseAuthorization } from "../scripts/release-migration-authorization.ts";
import { buildMigrationAllowlist, sha256 } from "../scripts/release-manifest-contract.mjs";
import {
  UAT_PROMOTION_MIGRATION_ENGINE_RESULT_CONTRACT,
  UAT_PROMOTION_MIGRATION_GRANT_CONTRACT,
  UatPromotionMigrationExecutionError,
  createUatPromotionMigrationGrant,
  validateUatPromotionMigrationEngineResult,
  validateUatPromotionMigrationGrant,
} from "../scripts/uat-promotion-migration-execution-contract.mjs";
import {
  FIXTURE_GIT,
  FIXTURE_VERSION,
  FIXTURE_WORKER,
  buildEligibleReleaseFixture,
  initializeReleaseArtifactRoot,
} from "./release-gate-fixture.mjs";

const digest = (value) => value.repeat(64).slice(0, 64);
const deploymentId = "chenyida-erp-uat-contract";
const databaseMarker = `chenyida-erp-deployment/v2:UAT:${deploymentId}`;

function isolatedGrantInput(overrides = {}) {
  return {
    promotion_id: "promotion-isolated-uat",
    migration_operation_id: "migration-isolated-uat",
    execution_authorization_sha256: digest("1"),
    root_operations_package_sha256: digest("2"),
    release_manifest_sha256: digest("3"),
    worker_image: `registry.example.com/erp/worker@sha256:${digest("4")}`,
    migration_manifest_sha256: digest("5"),
    expected_current_head: "EMPTY",
    target_head: "0002_second.sql",
    database: {
      deployment_class: "UAT",
      deployment_id: deploymentId,
      database_name: "chenyida_erp",
      database_system_identifier: "1234567890123456789",
      database_oid: "16384",
      database_marker: databaseMarker,
      migration_role: "chenyida_erp_owner",
      control_role: "postgres",
    },
    created_at: "2026-08-25T01:00:00.000Z",
    expires_at: "2026-08-25T01:10:00.000Z",
    ...overrides,
  };
}

function isolatedGrant(overrides = {}) {
  return createIsolatedUatMigrationGrant(isolatedGrantInput(overrides));
}

function legacyGrant(overrides = {}) {
  return createUatPromotionMigrationGrant({
    execution_scope: "SUPERVISOR_CONTROLLED_UAT_MIGRATION",
    promotion_id: "promotion-legacy-uat",
    migration_operation_id: "migration-legacy-uat",
    execution_authorization_sha256: digest("1"),
    migration_approval_authorization_sha256: digest("2"),
    migration_approval_receipt_sha256: digest("3"),
    migration_authorization_binding_sha256: digest("4"),
    promotion_intent_sha256: digest("5"),
    candidate_binding_sha256: digest("6"),
    database_binding_sha256: digest("7"),
    runtime_binding_sha256: digest("8"),
    recovery_binding_sha256: digest("9"),
    promotion_snapshot_binding_sha256: digest("a"),
    writer_quiesce_binding_sha256: digest("b"),
    supervisor_bundle_sha256: digest("c"),
    release_manifest_sha256: digest("d"),
    worker_image: `registry.example.com/erp/worker@sha256:${digest("e")}`,
    migration_manifest_sha256: digest("f"),
    expected_current_head: "EMPTY",
    target_head: "0002_second.sql",
    database: {
      deployment_class: "UAT",
      deployment_id: "chenyida-erp",
      database_name: "chenyida_erp",
      database_system_identifier: "1234567890123456789",
      database_oid: "16384",
      database_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
      migration_role: "chenyida_erp_owner",
      control_role: "postgres",
    },
    created_at: "2026-08-25T01:00:00.000Z",
    expires_at: "2026-08-25T01:10:00.000Z",
    ...overrides,
  });
}

function engineInput(grant) {
  const files = [
    { filename: "0001_first.sql", sha256: digest("a"), outcome: "APPLIED" },
    { filename: "0002_second.sql", sha256: digest("b"), outcome: "APPLIED" },
  ];
  return {
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    grant_sha256: grant.grant_sha256,
    database_name: grant.database.database_name,
    database_system_identifier: grant.database.database_system_identifier,
    database_oid: grant.database.database_oid,
    database_marker: grant.database.database_marker,
    migration_role: grant.database.migration_role,
    application_name: "chenyida-erp-migration",
    current_head_before: grant.expected_current_head,
    target_head: grant.target_head,
    started_at: "2026-08-25T01:02:00.000Z",
    completed_at: "2026-08-25T01:03:00.000Z",
    files,
    final_migration_rows_sha256: isolatedUatMigrationExecutionSha256(
      files.map((entry) => ({ version: entry.filename, checksum: entry.sha256 })),
    ),
    final_migration_rows_count: files.length,
    other_backend_count_before: 0,
    other_backend_count_after: 0,
    database_default_transaction_read_only: "on",
    migration_transaction_read_only: "off",
  };
}

function expectIsolatedCode(code, action) {
  assert.throws(action, (error) => error instanceof IsolatedUatMigrationExecutionError && error.code === code);
}

function expectLegacyCode(code, action) {
  assert.throws(action, (error) => error instanceof UatPromotionMigrationExecutionError && error.code === code);
}

test("isolated UAT grant binds EMPTY to target and an exact dynamic database identity", () => {
  const grant = isolatedGrant();
  assert.equal(validateIsolatedUatMigrationGrant(grant), grant);
  assert.equal(grant.contract, ISOLATED_UAT_MIGRATION_GRANT_CONTRACT);
  assert.equal(grant.database.database_marker, `chenyida-erp-deployment/v2:UAT:${grant.database.deployment_id}`);
  assert.equal(canonicalIsolatedUatMigrationExecutionJson(grant).endsWith("\n"), true);

  for (const change of [
    { database: { ...grant.database, deployment_id: "chenyida-erp" } },
    { database: { ...grant.database, deployment_id: "chenyida-erp-uat-Upper" } },
    { database: { ...grant.database, database_marker: `${databaseMarker}-other` } },
    { expected_current_head: "0001_first.sql" },
    { expires_at: "2026-08-25T01:15:00.001Z" },
  ]) {
    expectIsolatedCode("ISOLATED_UAT_MIGRATION_GRANT_INVALID", () => {
      createIsolatedUatMigrationGrant(isolatedGrantInput(change));
    });
  }
  expectIsolatedCode("ISOLATED_UAT_MIGRATION_GRANT_INVALID", () => validateIsolatedUatMigrationGrant({
    ...grant,
    root_operations_package_sha256: digest("0"),
  }));
});

test("isolated engine result is dynamic, EMPTY-only and content-addressed", () => {
  const grant = isolatedGrant();
  const result = createIsolatedUatMigrationEngineResult(engineInput(grant));
  assert.equal(validateIsolatedUatMigrationEngineResult(result), result);
  assert.equal(assertIsolatedUatMigrationEngineResultMatchesGrant(result, grant), result);
  assert.equal(result.contract, ISOLATED_UAT_MIGRATION_ENGINE_RESULT_CONTRACT);

  expectIsolatedCode("ISOLATED_UAT_MIGRATION_ENGINE_RESULT_INVALID", () => {
    createIsolatedUatMigrationEngineResult({
      ...engineInput(grant),
      files: engineInput(grant).files.map((entry, index) => (
        index === 0 ? { ...entry, outcome: "ALREADY_APPLIED" } : entry
      )),
    });
  });
  expectIsolatedCode("ISOLATED_UAT_MIGRATION_ENGINE_RESULT_INVALID", () => {
    createIsolatedUatMigrationEngineResult({
      ...engineInput(grant),
      database_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
    });
  });
});

test("isolated engine result stays inside the grant authorization window", () => {
  const grant = isolatedGrant();
  const boundaryResult = createIsolatedUatMigrationEngineResult({
    ...engineInput(grant),
    started_at: grant.created_at,
    completed_at: "2026-08-25T01:09:59.999Z",
  });
  assert.equal(assertIsolatedUatMigrationEngineResultMatchesGrant(boundaryResult, grant), boundaryResult);

  for (const timestamps of [
    {
      started_at: "2026-08-25T00:59:59.999Z",
      completed_at: "2026-08-25T01:03:00.000Z",
    },
    {
      started_at: grant.created_at,
      completed_at: grant.expires_at,
    },
  ]) {
    const result = createIsolatedUatMigrationEngineResult({ ...engineInput(grant), ...timestamps });
    expectIsolatedCode("ISOLATED_UAT_MIGRATION_ENGINE_RESULT_BINDING_INVALID", () => {
      assertIsolatedUatMigrationEngineResultMatchesGrant(result, grant);
    });
  }
});

test("legacy and isolated grant/result contracts cannot cross-validate or cross-create", () => {
  const isolated = isolatedGrant();
  const legacy = legacyGrant();
  expectLegacyCode("UAT_PROMOTION_MIGRATION_GRANT_INVALID", () => validateUatPromotionMigrationGrant(isolated));
  expectIsolatedCode("ISOLATED_UAT_MIGRATION_GRANT_INVALID", () => validateIsolatedUatMigrationGrant(legacy));

  const isolatedResult = createControlledMigrationEngineResult(isolated, engineInput(isolated));
  const legacyResult = createControlledMigrationEngineResult(legacy, engineInput(legacy));
  assert.equal(isolatedResult.contract, ISOLATED_UAT_MIGRATION_ENGINE_RESULT_CONTRACT);
  assert.equal(legacyResult.contract, UAT_PROMOTION_MIGRATION_ENGINE_RESULT_CONTRACT);
  expectLegacyCode("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_INVALID", () => {
    validateUatPromotionMigrationEngineResult(isolatedResult);
  });
  expectIsolatedCode("ISOLATED_UAT_MIGRATION_ENGINE_RESULT_INVALID", () => {
    validateIsolatedUatMigrationEngineResult(legacyResult);
  });
  assert.equal(legacy.contract, UAT_PROMOTION_MIGRATION_GRANT_CONTRACT);
});

async function migrationFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-isolated-uat-contract-"));
  const directory = path.join(root, "migrations");
  await mkdir(directory);
  await writeFile(path.join(directory, "0001_first.sql"), "create table fixture(id integer);\n");
  await writeFile(path.join(directory, "0002_second.sql"), "alter table fixture add column payload text;\n");
  return { root, directory, entries: await buildMigrationAllowlist(directory) };
}

async function writeGrant(file, grant) {
  const raw = canonicalIsolatedUatMigrationExecutionJson(grant);
  await writeFile(file, raw, { mode: 0o440 });
  await chmod(file, 0o440);
  assert.notEqual(sha256(raw), grant.grant_sha256);
  return grant.grant_sha256;
}

test("release migration guard selects root package for isolated grants and supervisor bundle for legacy grants", async () => {
  const fixtureRoot = await migrationFixture();
  const saved = { ...process.env };
  try {
    const artifacts = path.join(fixtureRoot.root, "artifacts");
    await initializeReleaseArtifactRoot(artifacts);
    const release = await buildEligibleReleaseFixture({
      entries: fixtureRoot.entries,
      root: artifacts,
      releaseId: "isolated-uat-migration-contract",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 59 * 60 * 1000).toISOString(),
    });
    const manifestFile = path.join(artifacts, "release-manifest.json");
    const manifestRaw = await readFile(manifestFile, "utf8");
    const manifestSha256 = sha256(manifestRaw);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const isolated = isolatedGrant({
      execution_authorization_sha256: digest("7"),
      root_operations_package_sha256: digest("8"),
      release_manifest_sha256: manifestSha256,
      worker_image: release.manifest.images.worker.image_reference,
      migration_manifest_sha256: release.manifest.migrations.allowlist_sha256,
      target_head: release.manifest.migrations.head,
      created_at: createdAt,
      expires_at: expiresAt,
    });
    const isolatedFile = path.join(fixtureRoot.root, "isolated-grant.json");
    const isolatedSha256 = await writeGrant(isolatedFile, isolated);
    Object.assign(process.env, {
      NODE_ENV: "test",
      ERP_ALLOW_PRODUCTION_MIGRATION: "YES",
      ERP_MIGRATION_CONFIRM: "MIGRATE_EXACT_RELEASE_MANIFEST",
      ERP_RELEASE_MANIFEST_FILE: manifestFile,
      ERP_RELEASE_MANIFEST_SHA256: manifestSha256,
      ERP_RELEASE_EXPECTED_DEPLOYMENT_ID: deploymentId,
      ERP_MIGRATION_EXPECTED_DATABASE: "chenyida_erp",
      ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: "1234567890123456789",
      ERP_MIGRATION_EXPECTED_DATABASE_OID: "16384",
      ERP_MIGRATION_EXPECTED_DATABASE_MARKER: databaseMarker,
      ERP_MIGRATION_EXPECTED_ROLE: "chenyida_erp_owner",
      ERP_MIGRATION_EXPECTED_CURRENT_HEAD: "EMPTY",
      ERP_MIGRATION_EXPECTED_TARGET_HEAD: release.manifest.migrations.head,
      ERP_RELEASE_EXPECTED_VERSION: FIXTURE_VERSION,
      ERP_RUNTIME_BUILD_VERSION: FIXTURE_VERSION,
      ERP_RELEASE_EXPECTED_GIT_COMMIT: FIXTURE_GIT,
      ERP_RUNTIME_GIT_COMMIT: FIXTURE_GIT,
      ERP_RUNTIME_IMAGE_REFERENCE: release.manifest.images.worker.image_reference,
      ERP_RUNTIME_IMAGE_CONFIG_DIGEST: FIXTURE_WORKER,
      ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256: isolatedSha256,
      ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256: isolated.execution_authorization_sha256,
      ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256: isolated.root_operations_package_sha256,
      ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256: "not-a-digest",
    });
    const config = { environment: "production", deploymentClass: "uat" };
    const options = {
      testGrantFile: isolatedFile,
      migrationEntries: fixtureRoot.entries.map(({ filename, sha256: entrySha256 }) => ({
        filename,
        sha256: entrySha256,
      })),
    };
    const authorization = await loadReleaseAuthorization(config, fixtureRoot.directory, options);
    assert.equal(authorization?.grant?.contract, ISOLATED_UAT_MIGRATION_GRANT_CONTRACT);

    delete process.env.ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256;
    await assert.rejects(
      loadReleaseAuthorization(config, fixtureRoot.directory, options),
      (error) => error.code === "MIGRATION_ROOT_OPERATIONS_PACKAGE_SHA256_INVALID",
    );
    process.env.ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256 = digest("0");
    await assert.rejects(
      loadReleaseAuthorization(config, fixtureRoot.directory, options),
      (error) => error.code === "MIGRATION_EXECUTION_GRANT_BINDING_INVALID",
    );

    const legacy = legacyGrant({
      execution_authorization_sha256: digest("7"),
      supervisor_bundle_sha256: digest("9"),
      release_manifest_sha256: manifestSha256,
      worker_image: release.manifest.images.worker.image_reference,
      migration_manifest_sha256: release.manifest.migrations.allowlist_sha256,
      target_head: release.manifest.migrations.head,
      created_at: createdAt,
      expires_at: expiresAt,
    });
    const legacyFile = path.join(fixtureRoot.root, "legacy-grant.json");
    const legacySha256 = await writeGrant(legacyFile, legacy);
    Object.assign(process.env, {
      ERP_RELEASE_EXPECTED_DEPLOYMENT_ID: "chenyida-erp",
      ERP_MIGRATION_EXPECTED_DATABASE_MARKER: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
      ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256: legacySha256,
      ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256: legacy.execution_authorization_sha256,
    });
    delete process.env.ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256;
    delete process.env.ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256;
    const legacyOptions = { ...options, testGrantFile: legacyFile };
    await assert.rejects(
      loadReleaseAuthorization(config, fixtureRoot.directory, legacyOptions),
      (error) => error.code === "MIGRATION_SUPERVISOR_BUNDLE_SHA256_INVALID",
    );
    process.env.ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256 = legacy.supervisor_bundle_sha256;
    const legacyAuthorization = await loadReleaseAuthorization(config, fixtureRoot.directory, legacyOptions);
    assert.equal(legacyAuthorization?.grant?.contract, UAT_PROMOTION_MIGRATION_GRANT_CONTRACT);
  } finally {
    process.env = saved;
    await rm(fixtureRoot.root, { recursive: true, force: true });
  }
});
