import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE,
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  PRE_DEPLOY_RUNTIME_GUARD_MODE,
  officialReleaseLifecycle,
} from "../scripts/release-lifecycle-contract.mjs";
import {
  assembleReleaseManifest,
  buildMigrationAllowlist,
  canonicalJson,
  discardPreparedJsonArtifact,
  loadReleaseManifest,
  publishPreparedJsonArtifact,
  readRecoverableJsonPublication,
  sha256,
  validateOfficialReleaseGatePlan,
  validateReleaseManifest,
  validateSecurityEvidence,
  validateTrivyCycloneDxDocument,
  validateTrivyNativeVulnerabilityReport,
  writeImmutableJsonArtifact,
  writePreparedJsonArtifact,
} from "../scripts/release-manifest-contract.mjs";
import { buildEligibleReleaseFixture, initializeReleaseArtifactRoot } from "./release-gate-fixture.mjs";

const rootCapable = typeof process.getuid === "function" && process.getuid() === 0;

async function migrationFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-release-manifest-"));
  const directory = path.join(root, "migrations");
  await mkdir(directory);
  await writeFile(path.join(directory, "0001_first.sql"), "create table fixture(id integer);\n");
  await writeFile(path.join(directory, "0002_second.sql"), "alter table fixture add column payload text;\n");
  return { root, directory, entries: await buildMigrationAllowlist(directory) };
}

test("eligible manifest binds one deployment class, official plan, images, migrations and evidence", async () => {
  const f = await migrationFixture();
  try {
    const fixture = await buildEligibleReleaseFixture({ entries: f.entries });
    assert.equal(fixture.manifest.promotion_status, "ELIGIBLE");
    assert.deepEqual(fixture.manifest.allowed_deployment_classes, ["UAT"]);
    assert.equal(fixture.manifest.migrations.head, "0002_second.sql");
    assert.deepEqual(fixture.manifest.lifecycle, officialReleaseLifecycle());
    assert.equal(fixture.manifest.gate.runtime_guard_mode, PRE_DEPLOY_RUNTIME_GUARD_MODE);
    assert.equal(fixture.manifest.lifecycle.isolated_candidate.mode, ISOLATED_CANDIDATE_RUNTIME_GUARD_MODE);
    assert.equal(fixture.manifest.lifecycle.post_deploy_identity.mode, POST_DEPLOY_RUNTIME_GUARD_MODE);
    assert.deepEqual(validateReleaseManifest(fixture.manifest, { now: new Date("2026-08-12T01:30:00.000Z"), requireEligible: true }), fixture.manifest);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("manifest fails closed for extra fields, cross-class reuse, image drift, reorder and expiry", async () => {
  const f = await migrationFixture();
  try {
    const { manifest } = await buildEligibleReleaseFixture({ entries: f.entries });
    assert.throws(() => validateReleaseManifest({ ...manifest, unexpected: true }), (error) => error.code === "RELEASE_MANIFEST_FIELDS_INVALID");
    const withoutLifecycle = { ...manifest };
    delete withoutLifecycle.lifecycle;
    assert.throws(() => validateReleaseManifest(withoutLifecycle), (error) => error.code === "RELEASE_MANIFEST_FIELDS_INVALID");
    assert.throws(() => validateReleaseManifest({ ...manifest, schema_version: 1, contract: "chenyida-erp-release-manifest/v1" }), (error) => error.code === "RELEASE_MANIFEST_VERSION_INVALID");
    assert.throws(() => validateReleaseManifest({ ...manifest, lifecycle: { ...manifest.lifecycle, pre_deploy_gate: manifest.lifecycle.post_deploy_identity } }), (error) => error.code === "RELEASE_PRE_DEPLOY_MODE_INVALID");
    assert.throws(() => validateReleaseManifest({ ...manifest, lifecycle: { ...manifest.lifecycle, post_deploy_identity: manifest.lifecycle.pre_deploy_gate } }), (error) => error.code === "RELEASE_POST_DEPLOY_MODE_INVALID");
    assert.throws(() => validateReleaseManifest({ ...manifest, gate: { ...manifest.gate, runtime_guard_mode: POST_DEPLOY_RUNTIME_GUARD_MODE } }), (error) => error.code === "RELEASE_GATE_RUNTIME_GUARD_INVALID");
    assert.throws(() => validateReleaseManifest({ ...manifest, allowed_deployment_classes: ["UAT", "PRODUCTION"] }), (error) => error.code === "RELEASE_DEPLOYMENT_CLASSES_INVALID");
    assert.throws(() => validateReleaseManifest({ ...manifest, images: { ...manifest.images, web: { ...manifest.images.web, oci_revision: "e".repeat(40) } } }), (error) => error.code === "RELEASE_IMAGE_SOURCE_MISMATCH");
    assert.throws(() => validateReleaseManifest({ ...manifest, control: { ...manifest.control, image_evidence_authorization_sha256: null } }), (error) => error.code === "RELEASE_CONTROL_IMAGE_AUTHORIZATION_REQUIRED");
    assert.throws(() => validateReleaseManifest({ ...manifest, migrations: { ...manifest.migrations, entries: [...manifest.migrations.entries].reverse() } }), (error) => ["MIGRATION_ORDINAL_SEQUENCE_INVALID", "MIGRATION_ORDER_INVALID"].includes(error.code));
    assert.throws(() => validateReleaseManifest(manifest, { now: new Date("2026-08-12T02:00:00.000Z"), requireEligible: true }), (error) => error.code === "RELEASE_MANIFEST_EXPIRED");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("official plan rejects a weak command, removed skip detector or relaxed resource policy", async () => {
  const raw = JSON.parse(await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8"));
  assert.equal(validateOfficialReleaseGatePlan(raw), raw);
  assert.throws(() => validateOfficialReleaseGatePlan({ ...raw, runtime_guard: { ...raw.runtime_guard, mode: POST_DEPLOY_RUNTIME_GUARD_MODE } }), (error) => error.code === "RUNTIME_GUARD_MODE_INVALID");
  assert.throws(() => validateOfficialReleaseGatePlan({ ...raw, candidate_runtime_guard: { ...raw.candidate_runtime_guard, mode: PRE_DEPLOY_RUNTIME_GUARD_MODE } }), (error) => error.code === "CANDIDATE_RUNTIME_GUARD_MODE_INVALID");
  assert.throws(() => validateOfficialReleaseGatePlan({ ...raw, steps: raw.steps.map((step, index) => index === 0 ? { ...step, executor_id: "UNTRUSTED_COMMAND" } : step) }), (error) => error.code === "GATE_OFFICIAL_PLAN_STEPS_INVALID");
  assert.throws(() => validateOfficialReleaseGatePlan({ ...raw, steps: raw.steps.map((step) => step.id === "build-and-node-source-tests" ? { ...step, forbid_output_patterns: [] } : step) }), (error) => error.code === "GATE_OFFICIAL_PLAN_STEPS_INVALID");
  assert.throws(() => validateOfficialReleaseGatePlan({ ...raw, resource_policy: { ...raw.resource_policy, min_available_memory_mib: 1 } }), (error) => ["GATE_MEMORY_THRESHOLD_INVALID", "GATE_OFFICIAL_PLAN_RESOURCE_POLICY_INVALID"].includes(error.code));
});

test("security PASS requires scanner, policy, raw report binding and zero unknown findings", async () => {
  const f = await migrationFixture();
  try {
    const fixture = await buildEligibleReleaseFixture({ entries: f.entries });
    assert.throws(() => assembleReleaseManifest({ releaseId: "control-drift", generatedAt: "2026-08-12T01:00:00.000Z", expiresAt: "2026-08-12T02:00:00.000Z", deploymentClass: "UAT", source: fixture.source, images: fixture.images, migrations: f.entries, planFile: fixture.filenames.planFile, planRaw: fixture.planRaw, plan: fixture.plan, reportFile: fixture.filenames.reportFile, reportRaw: fixture.reportRaw, report: fixture.report, sbomFile: fixture.filenames.sbomFile, sbomRaw: fixture.sbomRaw, sbom: fixture.sbom, securityFile: fixture.filenames.securityFile, securityRaw: fixture.securityRaw, security: fixture.security, control: { ...fixture.manifest.control, release_gate_authorization_sha256: "0".repeat(64) } }), (error) => error.code === "RELEASE_CONTROL_GATE_MISMATCH");
    assert.throws(() => validateSecurityEvidence({ ...fixture.security, raw_report_sha256: null }), (error) => error.code === "SECURITY_RAW_REPORT_SHA256_INVALID");
    assert.throws(() => validateSecurityEvidence({ ...fixture.security, counts: { ...fixture.security.counts, unknown: 1 } }), (error) => error.code === "SECURITY_PASS_EVIDENCE_INVALID");
    assert.throws(() => validateSecurityEvidence({ ...fixture.security, scanner: "NONE" }), (error) => error.code === "SECURITY_PASS_EVIDENCE_INVALID");
    assert.throws(() => validateSecurityEvidence({ ...fixture.security, scanner_version: "0.69.4" }), (error) => error.code === "SECURITY_PASS_EVIDENCE_INVALID");
    assert.throws(() => validateSecurityEvidence({ ...fixture.security, scanner_image_reference: "ghcr.io/aquasecurity/trivy@sha256:" + "1".repeat(64) }), (error) => error.code === "SECURITY_PASS_EVIDENCE_INVALID");
    const webReport = fixture.targetArtifacts.web.vulnerability;
    assert.deepEqual(validateTrivyNativeVulnerabilityReport(webReport, { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference }), fixture.security.counts);
    const vulnerable = { ...webReport, Results: webReport.Results.map((result, index) => index === 0 ? { ...result, Vulnerabilities: [{ VulnerabilityID: "CVE-fixture", Severity: "HIGH" }, { VulnerabilityID: "CVE-unknown" }] } : result) };
    assert.deepEqual(validateTrivyNativeVulnerabilityReport(vulnerable, { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference }), { critical: 0, high: 1, medium: 0, low: 0, unknown: 1 });
    assert.throws(() => validateTrivyNativeVulnerabilityReport({ ...webReport, Metadata: { ImageID: fixture.targetConfigs.worker } }, { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference }), (error) => error.code === "TRIVY_NATIVE_REPORT_IMAGE_MISMATCH");
    assert.throws(() => validateTrivyNativeVulnerabilityReport({ ...webReport, Results: webReport.Results.map((result) => ({ ...result, Packages: [] })) }, { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference }), (error) => error.code === "TRIVY_NATIVE_PACKAGE_INVENTORY_MISSING");
    assert.throws(() => validateTrivyNativeVulnerabilityReport({ ...webReport, Results: webReport.Results.map((result, index) => index === 0 ? { ...result, Type: "debian" } : result) }, { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference }), (error) => error.code === "TRIVY_NATIVE_PACKAGE_ECOSYSTEM_INVALID");
    assert.throws(() => validateTrivyNativeVulnerabilityReport({ ...webReport, Results: webReport.Results.slice(0, 1) }, { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference }), (error) => error.code === "TRIVY_NATIVE_REPORT_IDENTITY_INVALID");
    assert.throws(() => validateTrivyCycloneDxDocument({ ...fixture.targetArtifacts.web.cyclonedx, components: [] }), (error) => error.code === "TRIVY_CYCLONEDX_COMPONENTS_INVALID");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("manifest assembly rejects stale or missing required gate work", async () => {
  const f = await migrationFixture();
  try {
    const fixture = await buildEligibleReleaseFixture({ entries: f.entries });
    const skipped = { ...fixture.report, steps: fixture.report.steps.map((step, index) => index === 0 ? { ...step, result: "NOT_APPLICABLE", started_at: null, finished_at: null, duration_ms: 0, exit_code: null, reason: "skipped" } : step) };
    assert.throws(() => assembleReleaseManifest({ releaseId: "skip-fixture", generatedAt: "2026-08-12T01:00:00.000Z", expiresAt: "2026-08-12T02:00:00.000Z", deploymentClass: "UAT", source: fixture.source, images: fixture.images, migrations: f.entries, planFile: fixture.filenames.planFile, planRaw: fixture.planRaw, plan: fixture.plan, reportFile: fixture.filenames.reportFile, reportRaw: canonicalJson(skipped), report: skipped, sbomFile: fixture.filenames.sbomFile, sbomRaw: fixture.sbomRaw, sbom: fixture.sbom, securityFile: fixture.filenames.securityFile, securityRaw: fixture.securityRaw, security: fixture.security, control: fixture.manifest.control }), (error) => ["GATE_REPORT_RESULT_INCONSISTENT", "RELEASE_GATE_REQUIRED_STEP_SKIPPED"].includes(error.code));
    assert.throws(() => assembleReleaseManifest({ releaseId: "stale-fixture", generatedAt: "2026-08-12T03:00:01.000Z", expiresAt: "2026-08-12T04:00:00.000Z", deploymentClass: "UAT", source: fixture.source, images: fixture.images, migrations: f.entries, planFile: fixture.filenames.planFile, planRaw: fixture.planRaw, plan: fixture.plan, reportFile: fixture.filenames.reportFile, reportRaw: fixture.reportRaw, report: fixture.report, sbomFile: fixture.filenames.sbomFile, sbomRaw: fixture.sbomRaw, sbom: fixture.sbom, securityFile: fixture.filenames.securityFile, securityRaw: fixture.securityRaw, security: fixture.security, control: fixture.manifest.control }), (error) => error.code === "RELEASE_GATE_REPORT_STALE");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("trusted eligible loader verifies every immutable companion and rejects deletion or hard links", { skip: !rootCapable }, async () => {
  const f = await migrationFixture();
  try {
    const artifacts = path.join(f.root, "artifacts");
    await initializeReleaseArtifactRoot(artifacts);
    const fixture = await buildEligibleReleaseFixture({ entries: f.entries, root: artifacts, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 59 * 60 * 1000).toISOString() });
    const manifestFile = path.join(artifacts, "release-manifest.json"), manifestRaw = await readFile(manifestFile, "utf8");
    const loaded = await loadReleaseManifest({ file: manifestFile, expectedSha256: sha256(manifestRaw), requireEligible: true, trusted: true });
    assert.equal(loaded.release_id, fixture.manifest.release_id);
    const rawReport = path.join(artifacts, fixture.filenames.rawReportFile), alias = path.join(f.root, "security-hardlink.json");
    await link(rawReport, alias);
    await assert.rejects(loadReleaseManifest({ file: manifestFile, expectedSha256: sha256(manifestRaw), requireEligible: true, trusted: true }), (error) => error.code === "RELEASE_BUNDLE_SECURITY_REPORT_INVALID");
    await unlink(alias);
    await unlink(rawReport);
    await assert.rejects(loadReleaseManifest({ file: manifestFile, expectedSha256: sha256(manifestRaw), requireEligible: true, trusted: true }), (error) => error.code === "RELEASE_BUNDLE_SECURITY_REPORT_INVALID");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("immutable writer refuses overwrite and unsafe root metadata", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-release-writer-"));
  try {
    const artifacts = path.join(root, "artifacts");
    await initializeReleaseArtifactRoot(artifacts);
    await writeImmutableJsonArtifact({ root: artifacts, filename: "fixture.json", value: { ok: true } });
    assert.equal((await stat(path.join(artifacts, "fixture.json"))).nlink, 1);
    await assert.rejects(writeImmutableJsonArtifact({ root: artifacts, filename: "fixture.json", value: { ok: true } }), (error) => error.code === "EEXIST");
    await chmod(artifacts, 0o770);
    await assert.rejects(writeImmutableJsonArtifact({ root: artifacts, filename: "other.json", value: { ok: true } }), (error) => error.code === "RELEASE_ARTIFACT_ROOT_TRUST_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("immutable writer never overwrites under concurrency and repairs a linked crash residue", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-release-writer-race-"));
  try {
    const artifacts = path.join(root, "artifacts");
    await initializeReleaseArtifactRoot(artifacts);
    const outcomes = await Promise.allSettled([
      writeImmutableJsonArtifact({ root: artifacts, filename: "race.json", value: { writer: "a" } }),
      writeImmutableJsonArtifact({ root: artifacts, filename: "race.json", value: { writer: "b" } }),
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected" && item.reason?.code === "EEXIST").length, 1);
    assert.ok([canonicalJson({ writer: "a" }), canonicalJson({ writer: "b" })].includes(await readFile(path.join(artifacts, "race.json"), "utf8")));

    const residue = path.join(artifacts, ".residue.json.999.fixture.publish.tmp");
    const target = path.join(artifacts, "residue.json");
    await writeFile(residue, canonicalJson({ committed: true }), { mode: 0o440 });
    await chmod(residue, 0o440);
    await link(residue, target);
    assert.equal((await stat(target)).nlink, 2);
    await assert.rejects(writeImmutableJsonArtifact({ root: artifacts, filename: "residue.json", value: { committed: false } }), (error) => error.code === "EEXIST");
    assert.equal((await stat(target)).nlink, 1);
    await assert.rejects(readFile(residue), (error) => error.code === "ENOENT");
    assert.equal(await readFile(target, "utf8"), canonicalJson({ committed: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prepared artifacts remain non-consumable until an exact postcheck publication", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-release-prepared-"));
  try {
    const artifacts = path.join(root, "artifacts");
    await initializeReleaseArtifactRoot(artifacts);
    const value = { result: "PASS", marker: "postcheck-required" };
    const prepared = ".fixture.prepared.json";
    const digest = sha256(canonicalJson(value));
    await writePreparedJsonArtifact({ root: artifacts, filename: prepared, value });
    await assert.rejects(readFile(path.join(artifacts, "fixture.json")), (error) => error.code === "ENOENT");
    await assert.rejects(publishPreparedJsonArtifact({ root: artifacts, preparedFilename: prepared, expectedSha256: "0".repeat(64), filename: "fixture.json", validator: (item) => item }), (error) => error.code === "RELEASE_PREPARED_ARTIFACT_INVALID_SHA256_MISMATCH");
    await publishPreparedJsonArtifact({ root: artifacts, preparedFilename: prepared, expectedSha256: digest, filename: "fixture.json", validator: (item) => item });
    assert.equal(await readFile(path.join(artifacts, "fixture.json"), "utf8"), canonicalJson(value));
    await assert.rejects(readFile(path.join(artifacts, prepared)), (error) => error.code === "ENOENT");

    const discard = ".discard.prepared.json";
    await writePreparedJsonArtifact({ root: artifacts, filename: discard, value });
    await discardPreparedJsonArtifact({ root: artifacts, preparedFilename: discard, expectedSha256: digest, validator: (item) => item });
    await assert.rejects(readFile(path.join(artifacts, discard)), (error) => error.code === "ENOENT");

    const recoverPrepared = ".recover.prepared.json";
    const recoverPublished = "recover.json";
    await writePreparedJsonArtifact({ root: artifacts, filename: recoverPrepared, value });
    assert.deepEqual(await readRecoverableJsonPublication({ root: artifacts, preparedFilename: recoverPrepared, filename: recoverPublished, validator: (item) => item }), {
      safeRoot: artifacts, state: "PREPARED", sha256: digest, value,
    });
    await link(path.join(artifacts, recoverPrepared), path.join(artifacts, recoverPublished));
    assert.equal((await stat(path.join(artifacts, recoverPublished))).nlink, 2);
    const recovered = await readRecoverableJsonPublication({ root: artifacts, preparedFilename: recoverPrepared, filename: recoverPublished, validator: (item) => item });
    assert.equal(recovered.state, "PUBLISHED");
    assert.equal(recovered.sha256, digest);
    assert.deepEqual(recovered.value, value);
    assert.equal((await stat(path.join(artifacts, recoverPublished))).nlink, 1);
    await assert.rejects(readFile(path.join(artifacts, recoverPrepared)), (error) => error.code === "ENOENT");

    await writePreparedJsonArtifact({ root: artifacts, filename: ".collision.prepared.json", value });
    await writeImmutableJsonArtifact({ root: artifacts, filename: "collision.json", value: { result: "FAIL" } });
    await assert.rejects(readRecoverableJsonPublication({ root: artifacts, preparedFilename: ".collision.prepared.json", filename: "collision.json", validator: (item) => item }), (error) => error.code === "RELEASE_JSON_PUBLICATION_INVALID_COLLISION");
  } finally { await rm(root, { recursive: true, force: true }); }
});
