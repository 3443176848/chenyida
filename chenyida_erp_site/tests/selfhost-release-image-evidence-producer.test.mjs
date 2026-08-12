import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RELEASE_ARTIFACT_ROOT_MARKER,
  RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE,
  RELEASE_NODE_BASE_IMAGE_REFERENCE,
  RELEASE_RUNTIME_BASE_IMAGE_REFERENCE,
  RELEASE_TRIVY_IMAGE_REFERENCE,
  RELEASE_TRIVY_VERSION,
  buildMigrationAllowlist,
  canonicalJson,
  migrationAllowlistDigest,
  sha256,
  verifyTrustedImageEvidence,
} from "../scripts/release-manifest-contract.mjs";
import { parseStrictJson } from "../scripts/release-identity-contract.mjs";
import { createReleaseImageEvidence, hashTrustedDatabaseTree } from "../scripts/release-image-evidence-producer.mjs";
import { validateCandidateBuildProvenance, validateImageScanProvenance, validateTrivyCycloneDxDocument } from "../scripts/release-image-evidence-contract.mjs";
import { FIXTURE_GIT, FIXTURE_TREE, FIXTURE_VERSION, FIXTURE_WEB, FIXTURE_WEB_CONFIG, FIXTURE_WORKER, FIXTURE_WORKER_CONFIG, buildEligibleReleaseFixture, initializeReleaseArtifactRoot } from "./release-gate-fixture.mjs";

const rootCapable = typeof process.getuid === "function" && process.getuid() === 0;
const GENERATED_AT = "2026-08-12T01:00:00.000Z";
const SCANNER_IMAGE_DIGEST = RELEASE_TRIVY_IMAGE_REFERENCE.slice(RELEASE_TRIVY_IMAGE_REFERENCE.lastIndexOf("@") + 1);

async function writeTrustedInput(directory, filename, value) {
  const file = path.join(directory, filename);
  await writeFile(file, canonicalJson(value), { mode: 0o440 });
  await chmod(file, 0o440);
  return file;
}

async function producerFixture(root, { vulnerable = false, archiveConfigDigest = null, noncanonicalBuildProvenance = false } = {}) {
  const migrationEntries = [{ ordinal: 1, filename: "0001_fixture.sql", sha256: "1".repeat(64) }];
  const fixture = await buildEligibleReleaseFixture({ entries: migrationEntries, releaseId: "producer-alpha45", generatedAt: GENERATED_AT });
  const inputRoot = path.join(root, "inputs");
  const artifactRoot = path.join(root, "artifacts");
  await initializeReleaseArtifactRoot(inputRoot);
  await initializeReleaseArtifactRoot(artifactRoot);
  const buildProvenanceFile = await writeTrustedInput(artifactRoot, fixture.filenames.buildProvenanceFile, fixture.buildProvenance);
  if (noncanonicalBuildProvenance) {
    const raw = await readFile(buildProvenanceFile, "utf8");
    await chmod(buildProvenanceFile, 0o640);
    await writeFile(buildProvenanceFile, ` ${raw}`);
    await chmod(buildProvenanceFile, 0o440);
  }

  const scannerInspectFile = await writeTrustedInput(inputRoot, "scanner-inspect.json", [{ Id: SCANNER_IMAGE_DIGEST, Os: "linux", Architecture: "amd64", RepoDigests: [RELEASE_TRIVY_IMAGE_REFERENCE] }]);
  const scannerVersionFile = await writeTrustedInput(inputRoot, "scanner-version.json", { Version: RELEASE_TRIVY_VERSION });
  const databaseMetadataFile = await writeTrustedInput(inputRoot, "database-metadata.json", { Version: 2, UpdatedAt: GENERATED_AT, DownloadedAt: GENERATED_AT, NextUpdate: "2026-08-13T01:00:00.000Z" });
  const targets = {};
  for (const [service, configDigest, archiveSha256] of [["web", fixture.targetConfigs.web, "e".repeat(64)], ["worker", fixture.targetConfigs.worker, "f".repeat(64)]]) {
    const raw = fixture.targetArtifacts[service];
    const vulnerability = vulnerable && service === "web"
      ? { ...raw.vulnerability, Results: raw.vulnerability.Results.map((result) => ({ ...result, Vulnerabilities: [{ VulnerabilityID: "CVE-fixture", Severity: "HIGH" }] })) }
      : raw.vulnerability;
    targets[service] = {
      imageReference: fixture.images[service].image_reference,
      inspectFile: await writeTrustedInput(inputRoot, `${service}-inspect.json`, raw.inspect),
      archiveSha256,
      archiveBytes: "1024",
      archiveConfigDigest: archiveConfigDigest && service === "web" ? archiveConfigDigest : configDigest,
      vulnerabilityFile: await writeTrustedInput(inputRoot, `${service}-vulnerability.json`, vulnerability),
      cyclonedxFile: await writeTrustedInput(inputRoot, `${service}-cyclonedx.json`, raw.cyclonedx),
    };
  }
  return {
    artifactRoot,
    fixture,
    input: {
      artifactRoot,
      runId: "producer-alpha45",
      candidate: fixture.candidate,
      buildProvenanceFile,
      supervisorBundleSha256: "6".repeat(64),
      authorizationSha256: "7".repeat(64),
      scannerImageDigest: SCANNER_IMAGE_DIGEST,
      scannerBinarySha256: "8".repeat(64),
      scannerInspectFile,
      scannerVersionFile,
      databaseMetadataFile,
      databasePayloadTreeSha256: "a".repeat(64),
      targets,
      now: new Date(GENERATED_AT),
    },
  };
}

test("producer preserves validated native image evidence and emits a trusted zero-finding bundle", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-image-producer-"));
  try {
    const { artifactRoot, fixture, input } = await producerFixture(root);
    const output = await createReleaseImageEvidence(input);
    const sbom = parseStrictJson(await readFile(path.join(artifactRoot, output.sbomFile), "utf8"));
    const security = parseStrictJson(await readFile(path.join(artifactRoot, output.securityFile), "utf8"));
    const verified = await verifyTrustedImageEvidence({
      root: artifactRoot,
      sbom,
      security,
      imageReferences: { web: fixture.images.web.image_reference, worker: fixture.images.worker.image_reference },
      expectedProducer: { supervisorBundleSha256: input.supervisorBundleSha256, authorizationSha256: input.authorizationSha256 },
    });
    assert.deepEqual(verified.total, { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });
    assert.equal(verified.provenance.scanner.version, RELEASE_TRIVY_VERSION);
    assert.equal(verified.provenance.run_id, input.runId);
    assert.throws(() => validateImageScanProvenance({ ...verified.provenance, run_id: "different-run" }), (error) => error.code === "IMAGE_PROVENANCE_BUILD_FILE_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("producer refuses findings, archive drift and noncanonical build provenance before writing evidence", { skip: !rootCapable }, async () => {
  for (const variant of [{ vulnerable: true }, { archiveConfigDigest: `sha256:${"0".repeat(64)}` }, { noncanonicalBuildProvenance: true }]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "cyd-image-producer-reject-"));
    try {
      const { artifactRoot, input } = await producerFixture(root, variant);
      await assert.rejects(createReleaseImageEvidence(input), (error) => ["IMAGE_EVIDENCE_VULNERABILITIES_FOUND", "IMAGE_EVIDENCE_BUILD_TARGET_MISMATCH", "IMAGE_EVIDENCE_BUILD_PROVENANCE_INPUT_INVALID"].includes(error.code));
      assert.deepEqual((await readdir(artifactRoot)).sort(), [RELEASE_ARTIFACT_ROOT_MARKER, "producer-alpha45.build-provenance.json"].sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("candidate build producer binds the exact snapshot inputs and loopback digest identities", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-candidate-build-producer-"));
  try {
    const artifactRoot = path.join(root, "artifacts");
    const inputRoot = path.join(root, "inputs");
    await initializeReleaseArtifactRoot(artifactRoot);
    await mkdir(inputRoot, { mode: 0o700 });
    const siteRoot = path.resolve(new URL("..", import.meta.url).pathname);
    const migrations = await buildMigrationAllowlist(path.join(siteRoot, "drizzle-postgres"));
    const migrationDigest = migrationAllowlistDigest(migrations);
    const webReference = `127.0.0.1:5000/chenyida-erp/web@${FIXTURE_WEB}`;
    const workerReference = `127.0.0.1:5000/chenyida-erp/worker@${FIXTURE_WORKER}`;
    const targetInspect = (manifestDigest, configDigest, reference, cmd) => [{
      Id: manifestDigest, Descriptor: { digest: manifestDigest, annotations: { "config.digest": configDigest } }, Os: "linux", Architecture: "amd64", RepoDigests: [reference],
      Config: { Labels: { "org.opencontainers.image.version": FIXTURE_VERSION, "org.opencontainers.image.revision": FIXTURE_GIT }, Env: [`ERP_RUNTIME_BUILD_VERSION=${FIXTURE_VERSION}`, `ERP_RUNTIME_GIT_COMMIT=${FIXTURE_GIT}`], User: "65532:65532", Cmd: cmd },
    }];
    const baseDigest = RELEASE_NODE_BASE_IMAGE_REFERENCE.split("@")[1];
    const runtimeBaseDigest = RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.split("@")[1];
    const registryDigest = RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.split("@")[1];
    const baseInspect = await writeTrustedInput(inputRoot, "base.json", [{ Id: baseDigest, Descriptor: { digest: baseDigest }, Os: "linux", Architecture: "amd64", RepoDigests: [RELEASE_NODE_BASE_IMAGE_REFERENCE] }]);
    const runtimeBaseInspect = await writeTrustedInput(inputRoot, "runtime-base.json", [{ Id: runtimeBaseDigest, Descriptor: { digest: runtimeBaseDigest }, Os: "linux", Architecture: "amd64", RepoDigests: [RELEASE_RUNTIME_BASE_IMAGE_REFERENCE] }]);
    const registryInspect = await writeTrustedInput(inputRoot, "registry.json", [{ Id: registryDigest, Descriptor: { digest: registryDigest }, Os: "linux", Architecture: "amd64", RepoDigests: [RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE] }]);
    const webInspect = await writeTrustedInput(inputRoot, "web.json", targetInspect(FIXTURE_WEB, FIXTURE_WEB_CONFIG, webReference, ["node", "server.js"]));
    const workerInspect = await writeTrustedInput(inputRoot, "worker.json", targetInspect(FIXTURE_WORKER, FIXTURE_WORKER_CONFIG, workerReference, ["node", "--experimental-strip-types", "worker/selfhost.ts"]));
    const runId = "candidate-build-fixture";
    const result = spawnSync(process.execPath, [
      path.join(siteRoot, "scripts", "release-candidate-build-producer.mjs"), "create",
      "--site-root", siteRoot, "--artifact-root", artifactRoot, "--run-id", runId, "--git-commit", FIXTURE_GIT, "--git-tree", FIXTURE_TREE,
      "--archive-sha256", "3".repeat(64), "--archive-bytes", "1024", "--migration-allowlist-sha256", migrationDigest,
      "--build-base-inspect", baseInspect, "--runtime-base-inspect", runtimeBaseInspect, "--registry-inspect", registryInspect, "--web-inspect", webInspect, "--worker-inspect", workerInspect,
      "--web-image-reference", webReference, "--worker-image-reference", workerReference, "--docker-server-version", "29.5.2", "--buildx-version", "v0.34.1", "--builder-driver", "docker", "--buildkit-version", "v0.30.0",
      "--confirm", "CREATE_LOCAL_CANDIDATE_BUILD_PROVENANCE",
    ], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C", LANG: "C", TZ: "UTC" } });
    assert.equal(result.status, 0, result.stderr);
    const value = parseStrictJson(await readFile(path.join(artifactRoot, `${runId}.build-provenance.json`), "utf8"));
    assert.equal(validateCandidateBuildProvenance(value, { runId, candidate: value.candidate, imageReferences: { web: webReference, worker: workerReference } }), value);
    assert.equal(value.candidate.migration_allowlist_sha256, migrationDigest);
    assert.deepEqual(value.targets.map((target) => [target.registry_manifest_digest, target.image_config_digest]), [[FIXTURE_WEB, FIXTURE_WEB_CONFIG], [FIXTURE_WORKER, FIXTURE_WORKER_CONFIG]]);
    assert.deepEqual([value.builder.builder_name, value.builder.builder_driver, value.builder.buildkit_version], ["default", "docker", "v0.30.0"]);
    assert.equal(value.source.producer_sha256, sha256(await readFile(path.join(siteRoot, "scripts", "release-candidate-build-producer.mjs"))));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Trivy 0.70 native CycloneDX contract accepts structural components and rejects identity or finding drift", async () => {
  const fixture = await buildEligibleReleaseFixture({ entries: [{ ordinal: 1, filename: "0001_fixture.sql", sha256: "1".repeat(64) }] });
  const document = fixture.targetArtifacts.web.cyclonedx;
  const expected = { imageConfigDigest: fixture.targetConfigs.web, imageReference: fixture.images.web.image_reference };
  assert.equal(validateTrivyCycloneDxDocument(document, expected), document);

  const mutate = (callback) => {
    const value = structuredClone(document);
    callback(value);
    return value;
  };
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { delete value.$schema; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_FIELDS_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { value.metadata.tools.components[0].version = "0.69.3"; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_TOOL_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { value.metadata.component.properties[0].value = `sha256:${"0".repeat(64)}`; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_IMAGE_MISMATCH");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { const os = value.components.find((component) => component.type === "operating-system"); os.name = "debian"; os.version = "12"; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_OS_IDENTITY_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { const osPackage = value.components.find((component) => component.purl?.startsWith("pkg:apk/wolfi/")); osPackage.purl = osPackage.purl.replace("pkg:apk/wolfi/", "pkg:deb/debian/"); }), expected), (error) => error.code === "TRIVY_CYCLONEDX_PACKAGE_COVERAGE_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { value.components = value.components.filter((component) => !component.purl?.startsWith("pkg:npm/")); }), expected), (error) => error.code === "TRIVY_CYCLONEDX_PACKAGE_COVERAGE_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { value.vulnerabilities.push({ id: "CVE-fixture" }); }), expected), (error) => error.code === "TRIVY_CYCLONEDX_VULNERABILITIES_FOUND");
});

test("trusted database tree hash detects payload changes and unsafe directory permissions", { skip: !rootCapable }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyd-trivy-db-tree-"));
  try {
    const database = path.join(root, "db");
    await mkdir(database, { mode: 0o750 });
    await chmod(database, 0o750);
    await writeTrustedInput(database, "metadata.json", { Version: 2, UpdatedAt: GENERATED_AT });
    const payload = await writeTrustedInput(database, "trivy.db", { fixture: "first" });
    const first = await hashTrustedDatabaseTree(database);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(await hashTrustedDatabaseTree(database), first);
    await chmod(payload, 0o640);
    await writeFile(payload, canonicalJson({ fixture: "second" }));
    await chmod(payload, 0o440);
    assert.notEqual(await hashTrustedDatabaseTree(database), first);
    await chmod(database, 0o770);
    await assert.rejects(hashTrustedDatabaseTree(database), (error) => error.code === "IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});
