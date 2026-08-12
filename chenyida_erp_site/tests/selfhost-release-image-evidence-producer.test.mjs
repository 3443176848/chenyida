import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RELEASE_ARTIFACT_ROOT_MARKER,
  RELEASE_TRIVY_IMAGE_REFERENCE,
  RELEASE_TRIVY_VERSION,
  canonicalJson,
  verifyTrustedImageEvidence,
} from "../scripts/release-manifest-contract.mjs";
import { parseStrictJson } from "../scripts/release-identity-contract.mjs";
import { createReleaseImageEvidence, hashTrustedDatabaseTree } from "../scripts/release-image-evidence-producer.mjs";
import { validateTrivyCycloneDxDocument } from "../scripts/release-image-evidence-contract.mjs";
import { buildEligibleReleaseFixture, initializeReleaseArtifactRoot } from "./release-gate-fixture.mjs";

const rootCapable = typeof process.getuid === "function" && process.getuid() === 0;
const GENERATED_AT = "2026-08-12T01:00:00.000Z";
const SCANNER_CONFIG_DIGEST = `sha256:${"9".repeat(64)}`;

async function writeTrustedInput(directory, filename, value) {
  const file = path.join(directory, filename);
  await writeFile(file, canonicalJson(value), { mode: 0o440 });
  await chmod(file, 0o440);
  return file;
}

async function producerFixture(root, { vulnerable = false, archiveConfigDigest = null } = {}) {
  const migrationEntries = [{ ordinal: 1, filename: "0001_fixture.sql", sha256: "1".repeat(64) }];
  const fixture = await buildEligibleReleaseFixture({ entries: migrationEntries, generatedAt: GENERATED_AT });
  const inputRoot = path.join(root, "inputs");
  const artifactRoot = path.join(root, "artifacts");
  await initializeReleaseArtifactRoot(inputRoot);
  await initializeReleaseArtifactRoot(artifactRoot);

  const scannerInspectFile = await writeTrustedInput(inputRoot, "scanner-inspect.json", [{ Id: SCANNER_CONFIG_DIGEST, Os: "linux", Architecture: "amd64", RepoDigests: [RELEASE_TRIVY_IMAGE_REFERENCE] }]);
  const scannerVersionFile = await writeTrustedInput(inputRoot, "scanner-version.json", { Version: RELEASE_TRIVY_VERSION, ScannerImageConfigDigest: SCANNER_CONFIG_DIGEST });
  const databaseMetadataFile = await writeTrustedInput(inputRoot, "database-metadata.json", { Version: 2, UpdatedAt: GENERATED_AT, DownloadedAt: GENERATED_AT, NextUpdate: "2026-08-13T01:00:00.000Z" });
  const targets = {};
  for (const [service, digest, archiveSha256] of [["web", fixture.candidate.web_image_digest, "e".repeat(64)], ["worker", fixture.candidate.worker_image_digest, "f".repeat(64)]]) {
    const raw = fixture.targetArtifacts[service];
    const vulnerability = vulnerable && service === "web"
      ? { ...raw.vulnerability, Results: raw.vulnerability.Results.map((result) => ({ ...result, Vulnerabilities: [{ VulnerabilityID: "CVE-fixture", Severity: "HIGH" }] })) }
      : raw.vulnerability;
    targets[service] = {
      imageReference: fixture.images[service].image_reference,
      inspectFile: await writeTrustedInput(inputRoot, `${service}-inspect.json`, raw.inspect),
      archiveSha256,
      archiveBytes: "1024",
      archiveConfigDigest: archiveConfigDigest && service === "web" ? archiveConfigDigest : digest,
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
      supervisorBundleSha256: "6".repeat(64),
      authorizationSha256: "7".repeat(64),
      scannerConfigDigest: SCANNER_CONFIG_DIGEST,
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
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("producer refuses findings and archive identity drift before writing evidence", { skip: !rootCapable }, async () => {
  for (const variant of [{ vulnerable: true }, { archiveConfigDigest: `sha256:${"0".repeat(64)}` }]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "cyd-image-producer-reject-"));
    try {
      const { artifactRoot, input } = await producerFixture(root, variant);
      await assert.rejects(createReleaseImageEvidence(input), (error) => ["IMAGE_EVIDENCE_VULNERABILITIES_FOUND", "IMAGE_PROVENANCE_TARGET_INVALID"].includes(error.code));
      assert.deepEqual(await readdir(artifactRoot), [RELEASE_ARTIFACT_ROOT_MARKER]);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("Trivy 0.70 native CycloneDX contract accepts structural components and rejects identity or finding drift", async () => {
  const fixture = await buildEligibleReleaseFixture({ entries: [{ ordinal: 1, filename: "0001_fixture.sql", sha256: "1".repeat(64) }] });
  const document = fixture.targetArtifacts.web.cyclonedx;
  const expected = { imageConfigDigest: fixture.candidate.web_image_digest, imageReference: fixture.images.web.image_reference };
  assert.equal(validateTrivyCycloneDxDocument(document, expected), document);

  const mutate = (callback) => {
    const value = structuredClone(document);
    callback(value);
    return value;
  };
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { delete value.$schema; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_FIELDS_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { value.metadata.tools.components[0].version = "0.69.3"; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_TOOL_INVALID");
  assert.throws(() => validateTrivyCycloneDxDocument(mutate((value) => { value.metadata.component.properties[0].value = `sha256:${"0".repeat(64)}`; }), expected), (error) => error.code === "TRIVY_CYCLONEDX_IMAGE_MISMATCH");
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
