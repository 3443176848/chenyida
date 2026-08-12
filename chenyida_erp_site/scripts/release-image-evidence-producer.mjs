import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./release-identity-contract.mjs";
import {
  RELEASE_TRIVY_IMAGE_REFERENCE,
  RELEASE_TRIVY_VERSION,
  RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT,
  ReleaseImageEvidenceError,
  validateCandidateBuildProvenance,
  validateDockerImageInspect,
  validateImageScanProvenance,
  validateTrivyCycloneDxDocument,
  validateTrivyNativeVulnerabilityReport,
  validateTrivyVersionReport,
} from "./release-image-evidence-contract.mjs";
import {
  RELEASE_SBOM_EVIDENCE_CONTRACT,
  RELEASE_SECURITY_EVIDENCE_CONTRACT,
  RELEASE_SECURITY_SCAN_REPORT_CONTRACT,
  RELEASE_VULNERABILITY_POLICY_ID,
  RELEASE_VULNERABILITY_POLICY_SHA256,
  RELEASE_MAX_SBOM_BYTES,
  ReleaseManifestError,
  canonicalJson,
  readStableFile,
  sha256,
  validateCandidate,
  validateSbomEvidence,
  validateSecurityEvidence,
  validateSecurityScanReport,
  writeImmutableJsonArtifact,
} from "./release-manifest-contract.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function reject(code) {
  throw new ReleaseManifestError(code);
}

function cliOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(result, key)) reject("IMAGE_EVIDENCE_CLI_ARGUMENT_INVALID");
    result[key] = value;
  }
  return result;
}

function exactOptions(options, expected) {
  const actual = Object.keys(options).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject("IMAGE_EVIDENCE_CLI_ARGUMENT_INVALID");
}

function required(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function normalizedIso(value, code) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) reject(code);
  return new Date(timestamp).toISOString();
}

function positiveInteger(value, code) {
  if (typeof value === "string") {
    if (!/^[1-9][0-9]*$/.test(value)) reject(code);
    value = Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 1) reject(code);
  return value;
}

async function nativeJson(file, code) {
  if (typeof file !== "string" || file !== path.resolve(file) || file === "/") reject(code);
  const { raw, stat } = await readStableFile(file, { minimumBytes: 2, maximumBytes: RELEASE_MAX_SBOM_BYTES, code });
  if (stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o022) !== 0) reject(code);
  return { value: parseStrictJson(raw.toString("utf8"), RELEASE_MAX_SBOM_BYTES), raw };
}

function metadataField(value, upper, lower) {
  return value?.[upper] ?? value?.[lower];
}

async function stableTrustedFileDigest(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1 || (before.mode & 0o022) !== 0 || before.size < 1) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    const pathStat = await lstat(file).catch(() => null);
    if (!pathStat || pathStat.isSymbolicLink() || !pathStat.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.dev !== pathStat.dev || before.ino !== pathStat.ino || pathStat.nlink !== 1) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
    return { bytes: before.size, mode: before.mode & 0o7777, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export async function hashTrustedDatabaseTree(root) {
  if (typeof root !== "string" || root !== path.resolve(root) || root === "/" || await realpath(root).catch(() => null) !== root) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
  const entries = [];
  let totalBytes = 0;
  async function walk(directory, relative) {
    const directoryStat = await lstat(directory).catch(() => null);
    if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== 0 || directoryStat.gid !== 0 || (directoryStat.mode & 0o022) !== 0) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
    const names = (await readdir(directory)).sort();
    if (names.length > 10_000) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
    for (const name of names) {
      if (name === "." || name === ".." || name.includes("/") || name.includes("\0")) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
      const file = path.join(directory, name); const child = relative ? `${relative}/${name}` : name;
      const stat = await lstat(file).catch(() => null);
      if (!stat || stat.isSymbolicLink()) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
      if (stat.isDirectory()) await walk(file, child);
      else if (stat.isFile()) {
        const digest = await stableTrustedFileDigest(file);
        totalBytes += digest.bytes;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > 4 * 1024 * 1024 * 1024 || entries.length >= 20_000) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
        entries.push({ path: child, ...digest });
      } else reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
    }
  }
  await walk(root, "");
  if (entries.length < 2 || !entries.some((entry) => entry.path === "metadata.json")) reject("IMAGE_EVIDENCE_DATABASE_TREE_INVALID");
  return sha256(canonicalJson(entries));
}

export async function createReleaseImageEvidence(input) {
  const runId = required(input.runId, IDENTIFIER, "IMAGE_EVIDENCE_RUN_ID_INVALID");
  const candidate = validateCandidate(input.candidate);
  const scannerImageDigest = required(input.scannerImageDigest, DIGEST, "IMAGE_EVIDENCE_SCANNER_IDENTITY_INVALID");
  const scannerBinarySha256 = required(input.scannerBinarySha256, SHA256, "IMAGE_EVIDENCE_SCANNER_BINARY_INVALID");
  const supervisorBundleSha256 = required(input.supervisorBundleSha256, SHA256, "IMAGE_EVIDENCE_SUPERVISOR_INVALID");
  const authorizationSha256 = required(input.authorizationSha256, SHA256, "IMAGE_EVIDENCE_AUTHORIZATION_INVALID");
  const databasePayloadTreeSha256 = required(input.databasePayloadTreeSha256, SHA256, "IMAGE_EVIDENCE_DATABASE_PAYLOAD_INVALID");
  const buildProvenancePath = path.resolve(input.buildProvenanceFile);
  if (path.dirname(buildProvenancePath) !== path.resolve(input.artifactRoot) || path.basename(buildProvenancePath) !== `${runId}.build-provenance.json`) reject("IMAGE_EVIDENCE_BUILD_PROVENANCE_INPUT_INVALID");
  const buildProvenance = await nativeJson(buildProvenancePath, "IMAGE_EVIDENCE_BUILD_PROVENANCE_INPUT_INVALID");
  const validatedBuildProvenance = validateCandidateBuildProvenance(buildProvenance.value, { runId, candidate, imageReferences: { web: input.targets.web?.imageReference, worker: input.targets.worker?.imageReference } });
  const buildProvenanceRaw = canonicalJson(buildProvenance.value);
  if (!buildProvenance.raw.equals(Buffer.from(buildProvenanceRaw, "utf8"))) reject("IMAGE_EVIDENCE_BUILD_PROVENANCE_INPUT_INVALID");

  const scannerInspect = await nativeJson(input.scannerInspectFile, "IMAGE_EVIDENCE_SCANNER_INSPECT_INPUT_INVALID");
  validateDockerImageInspect(scannerInspect.value, { imageDigest: scannerImageDigest, imageReference: RELEASE_TRIVY_IMAGE_REFERENCE });
  const scannerVersion = await nativeJson(input.scannerVersionFile, "IMAGE_EVIDENCE_SCANNER_VERSION_INPUT_INVALID");
  validateTrivyVersionReport(scannerVersion.value);
  const databaseMetadata = await nativeJson(input.databaseMetadataFile, "IMAGE_EVIDENCE_DATABASE_METADATA_INPUT_INVALID");
  const databaseSchemaVersion = metadataField(databaseMetadata.value, "Version", "version");
  if (!Number.isSafeInteger(databaseSchemaVersion) || databaseSchemaVersion < 1 || databaseSchemaVersion > 99) reject("IMAGE_EVIDENCE_DATABASE_METADATA_INVALID");
  const databaseUpdatedAt = normalizedIso(metadataField(databaseMetadata.value, "UpdatedAt", "updated_at"), "IMAGE_EVIDENCE_DATABASE_METADATA_INVALID");
  const databaseDownloadedAt = normalizedIso(metadataField(databaseMetadata.value, "DownloadedAt", "downloaded_at"), "IMAGE_EVIDENCE_DATABASE_METADATA_INVALID");
  const databaseNextUpdate = normalizedIso(metadataField(databaseMetadata.value, "NextUpdate", "next_update"), "IMAGE_EVIDENCE_DATABASE_METADATA_INVALID");

  const targetData = [];
  const total = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const service of ["web", "worker"]) {
    const target = input.targets[service];
    if (!target) reject("IMAGE_EVIDENCE_TARGET_INPUT_INVALID");
    const expectedManifestDigest = candidate[`${service}_image_digest`];
    const expectedConfigDigest = required(target.archiveConfigDigest, DIGEST, "IMAGE_EVIDENCE_TARGET_ARCHIVE_INVALID");
    const buildTarget = validatedBuildProvenance.targets.find((entry) => entry.service === service);
    if (!buildTarget || buildTarget.image_reference !== target.imageReference || buildTarget.registry_manifest_digest !== expectedManifestDigest || buildTarget.image_config_digest !== expectedConfigDigest) reject("IMAGE_EVIDENCE_BUILD_TARGET_MISMATCH");
    const inspect = await nativeJson(target.inspectFile, "IMAGE_EVIDENCE_TARGET_INSPECT_INPUT_INVALID");
    validateDockerImageInspect(inspect.value, { imageDigest: expectedManifestDigest, imageReference: target.imageReference });
    const vulnerability = await nativeJson(target.vulnerabilityFile, "IMAGE_EVIDENCE_TARGET_VULNERABILITY_INPUT_INVALID");
    const counts = validateTrivyNativeVulnerabilityReport(vulnerability.value, { imageConfigDigest: expectedConfigDigest, imageReference: target.imageReference });
    const cyclonedx = await nativeJson(target.cyclonedxFile, "IMAGE_EVIDENCE_TARGET_CYCLONEDX_INPUT_INVALID");
    validateTrivyCycloneDxDocument(cyclonedx.value, { imageConfigDigest: expectedConfigDigest, imageReference: target.imageReference });
    for (const key of Object.keys(total)) total[key] += counts[key];
    targetData.push({ service, expectedManifestDigest, expectedConfigDigest, target, inspect, vulnerability, cyclonedx, counts });
  }
  if (Object.values(total).some((count) => count !== 0)) reject("IMAGE_EVIDENCE_VULNERABILITIES_FOUND");

  const generatedAt = (input.now || new Date()).toISOString();
  const scannerInspectName = `${runId}.trivy.inspect.json`, scannerVersionName = `${runId}.trivy.version.json`, databaseMetadataName = `${runId}.trivy-db.metadata.json`;
  const provenanceName = `${runId}.image-scan-provenance.json`, sbomName = `${runId}.sbom-evidence.json`, normalizedReportName = `${runId}.security-report.json`, securityName = `${runId}.security-evidence.json`;
  const targetNames = Object.fromEntries(targetData.map(({ service }) => [service, { inspect: `${runId}.${service}.inspect.json`, vulnerability: `${runId}.${service}.trivy.json`, cyclonedx: `${runId}.${service}.cdx.json` }]));
  const scannerInspectRaw = canonicalJson(scannerInspect.value), scannerVersionRaw = canonicalJson(scannerVersion.value), databaseMetadataRaw = canonicalJson(databaseMetadata.value);
  const provenance = validateImageScanProvenance({
    schema_version: 3,
    contract: RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT,
    generated_at: generatedAt,
    run_id: runId,
    producer: { supervisor_bundle_sha256: supervisorBundleSha256, authorization_sha256: authorizationSha256 },
    candidate,
    build_provenance: { file: path.basename(buildProvenancePath), sha256: sha256(buildProvenanceRaw) },
    scanner: {
      name: "trivy", version: RELEASE_TRIVY_VERSION, image_reference: RELEASE_TRIVY_IMAGE_REFERENCE,
      registry_manifest_digest: RELEASE_TRIVY_IMAGE_REFERENCE.slice(RELEASE_TRIVY_IMAGE_REFERENCE.lastIndexOf("@") + 1),
      local_identity_digest: scannerImageDigest, binary_sha256: scannerBinarySha256, platform: "linux/amd64",
      inspect: { file: scannerInspectName, sha256: sha256(scannerInspectRaw) }, version_report: { file: scannerVersionName, sha256: sha256(scannerVersionRaw) },
    },
    database: {
      schema_version: databaseSchemaVersion, updated_at: databaseUpdatedAt, downloaded_at: databaseDownloadedAt, next_update: databaseNextUpdate,
      metadata: { file: databaseMetadataName, sha256: sha256(databaseMetadataRaw) }, payload_tree_sha256: databasePayloadTreeSha256,
    },
    targets: targetData.map(({ service, expectedConfigDigest, target, inspect, vulnerability, cyclonedx }) => ({
      service, image_reference: target.imageReference, registry_manifest_digest: target.imageReference.slice(target.imageReference.lastIndexOf("@") + 1),
      image_config_digest: expectedConfigDigest, platform: "linux/amd64", inspect: { file: targetNames[service].inspect, sha256: sha256(canonicalJson(inspect.value)) },
      archive_sha256: required(target.archiveSha256, SHA256, "IMAGE_EVIDENCE_TARGET_ARCHIVE_INVALID"), archive_bytes: positiveInteger(target.archiveBytes, "IMAGE_EVIDENCE_TARGET_ARCHIVE_INVALID"), archive_config_digest: expectedConfigDigest,
      native_vulnerability: { file: targetNames[service].vulnerability, sha256: sha256(canonicalJson(vulnerability.value)) },
      native_cyclonedx: { file: targetNames[service].cyclonedx, sha256: sha256(canonicalJson(cyclonedx.value)) },
    })),
  });
  const provenanceRaw = canonicalJson(provenance);
  const sbom = validateSbomEvidence({ schema_version: 1, contract: RELEASE_SBOM_EVIDENCE_CONTRACT, generated_at: generatedAt, scope: "WEB_AND_WORKER_IMAGES", candidate, format: "TRIVY_CYCLONEDX_1_6_JSON_SET", documents: targetData.map(({ service, cyclonedx }) => ({ service, file: targetNames[service].cyclonedx, sha256: sha256(canonicalJson(cyclonedx.value)) })), provenance_file: provenanceName, provenance_sha256: sha256(provenanceRaw), result: "VERIFIED" });
  const sbomRaw = canonicalJson(sbom);
  const normalizedReport = validateSecurityScanReport({ schema_version: 1, contract: RELEASE_SECURITY_SCAN_REPORT_CONTRACT, generated_at: generatedAt, candidate, scanner: { name: "trivy", version: RELEASE_TRIVY_VERSION, image_reference: RELEASE_TRIVY_IMAGE_REFERENCE, binary_sha256: scannerBinarySha256 }, policy: { id: RELEASE_VULNERABILITY_POLICY_ID, sha256: RELEASE_VULNERABILITY_POLICY_SHA256 }, vulnerability_database_updated_at: databaseUpdatedAt, targets: targetData.map(({ service, expectedManifestDigest, counts }) => ({ service, image_digest: expectedManifestDigest, counts, result: "PASS" })), counts: total, result: "PASS" }, { generated_at: generatedAt, candidate, scanner: "trivy", scanner_version: RELEASE_TRIVY_VERSION, scanner_image_reference: RELEASE_TRIVY_IMAGE_REFERENCE, scanner_binary_sha256: scannerBinarySha256, policy_id: RELEASE_VULNERABILITY_POLICY_ID, policy_sha256: RELEASE_VULNERABILITY_POLICY_SHA256, vulnerability_database_updated_at: databaseUpdatedAt, counts: total, result: "PASS" });
  const normalizedReportRaw = canonicalJson(normalizedReport);
  const security = validateSecurityEvidence({ schema_version: 1, contract: RELEASE_SECURITY_EVIDENCE_CONTRACT, generated_at: generatedAt, candidate, sbom_evidence_sha256: sha256(sbomRaw), provenance_file: provenanceName, provenance_sha256: sha256(provenanceRaw), scanner: "trivy", scanner_version: RELEASE_TRIVY_VERSION, scanner_image_reference: RELEASE_TRIVY_IMAGE_REFERENCE, scanner_binary_sha256: scannerBinarySha256, policy_id: RELEASE_VULNERABILITY_POLICY_ID, policy_sha256: RELEASE_VULNERABILITY_POLICY_SHA256, raw_report_file: normalizedReportName, raw_report_sha256: sha256(normalizedReportRaw), vulnerability_database_updated_at: databaseUpdatedAt, counts: total, result: "PASS", reason: null });

  const artifacts = [[scannerInspectName, scannerInspect.value], [scannerVersionName, scannerVersion.value], [databaseMetadataName, databaseMetadata.value]];
  for (const { service, inspect, vulnerability, cyclonedx } of targetData) artifacts.push([targetNames[service].inspect, inspect.value], [targetNames[service].vulnerability, vulnerability.value], [targetNames[service].cyclonedx, cyclonedx.value]);
  artifacts.push([provenanceName, provenance], [sbomName, sbom], [normalizedReportName, normalizedReport], [securityName, security]);
  for (const [filename, value] of artifacts) await writeImmutableJsonArtifact({ root: input.artifactRoot, filename, value });
  return { sbomFile: sbomName, sbomSha256: sha256(sbomRaw), securityFile: securityName, securitySha256: sha256(canonicalJson(security)), provenanceFile: provenanceName, provenanceSha256: sha256(provenanceRaw) };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (command === "hash-database-tree") {
    exactOptions(options, ["--root"]);
    process.stdout.write(`${await hashTrustedDatabaseTree(options["--root"])}\n`);
    return;
  }
  if (command !== "create") reject("IMAGE_EVIDENCE_CLI_COMMAND_INVALID");
  const common = ["--artifact-root", "--run-id", "--git-commit", "--git-tree", "--package-version", "--migration-allowlist-sha256", "--web-image-reference", "--web-image-digest", "--worker-image-reference", "--worker-image-digest", "--build-provenance", "--supervisor-bundle-sha256", "--authorization-sha256", "--scanner-image-digest", "--scanner-binary-sha256", "--scanner-inspect", "--scanner-version", "--database-metadata", "--database-payload-tree-sha256", "--confirm"];
  const perTarget = ["inspect", "archive-sha256", "archive-bytes", "archive-config-digest", "vulnerability", "cyclonedx"];
  const expected = [...common, ...["web", "worker"].flatMap((service) => perTarget.map((suffix) => `--${service}-${suffix}`))];
  exactOptions(options, expected);
  if (options["--confirm"] !== "CREATE_TRIVY_IMAGE_EVIDENCE") reject("IMAGE_EVIDENCE_CLI_CONFIRMATION_INVALID");
  const target = (service) => ({ imageReference: options[`--${service}-image-reference`], inspectFile: options[`--${service}-inspect`], archiveSha256: options[`--${service}-archive-sha256`], archiveBytes: options[`--${service}-archive-bytes`], archiveConfigDigest: options[`--${service}-archive-config-digest`], vulnerabilityFile: options[`--${service}-vulnerability`], cyclonedxFile: options[`--${service}-cyclonedx`] });
  const output = await createReleaseImageEvidence({ artifactRoot: options["--artifact-root"], runId: options["--run-id"], candidate: { git_commit: options["--git-commit"], git_tree: options["--git-tree"], package_version: options["--package-version"], web_image_digest: options["--web-image-digest"], worker_image_digest: options["--worker-image-digest"], migration_allowlist_sha256: options["--migration-allowlist-sha256"] }, buildProvenanceFile: options["--build-provenance"], supervisorBundleSha256: options["--supervisor-bundle-sha256"], authorizationSha256: options["--authorization-sha256"], scannerImageDigest: options["--scanner-image-digest"], scannerBinarySha256: options["--scanner-binary-sha256"], scannerInspectFile: options["--scanner-inspect"], scannerVersionFile: options["--scanner-version"], databaseMetadataFile: options["--database-metadata"], databasePayloadTreeSha256: options["--database-payload-tree-sha256"], targets: { web: target("web"), worker: target("worker") } });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof ReleaseManifestError || error instanceof ReleaseImageEvidenceError ? error.code : "IMAGE_EVIDENCE_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
