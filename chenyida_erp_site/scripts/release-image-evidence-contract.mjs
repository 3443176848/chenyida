import path from "node:path";

export const RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT = "chenyida-erp-candidate-build-provenance/v3";
export const RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT = "chenyida-erp-image-scan-provenance/v3";
export const RELEASE_TRIVY_VERSION = "0.70.0";
export const RELEASE_TRIVY_IMAGE_REFERENCE = "ghcr.io/aquasecurity/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c";
export const RELEASE_NODE_BASE_IMAGE_REFERENCE = "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
export const RELEASE_RUNTIME_BASE_IMAGE_REFERENCE = "cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed";
export const RELEASE_RUNTIME_APK_REPOSITORY = "https://apk.cgr.dev/chainguard";
export const RELEASE_RUNTIME_NODE_PACKAGE = "nodejs-22-minimal=22.23.2-r1";
export const RELEASE_RUNTIME_NODE_VERSION = "v22.23.2";
export const RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE = "registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
export const RELEASE_DOCKERFILE_FRONTEND_REFERENCE = "docker.io/docker/dockerfile:1.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720";

const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REGISTRY_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/;
const ARTIFACT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/;
const SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

export class ReleaseImageEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseImageEvidenceError";
    this.code = code;
  }
}

function reject(code) {
  throw new ReleaseImageEvidenceError(code);
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  return value;
}

function exactKeys(value, expected, code) {
  const actual = Object.keys(record(value, code)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function string(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) reject(code);
  return value;
}

function iso(value, code) {
  string(value, ISO_UTC, code);
  if (!Number.isFinite(Date.parse(value))) reject(code);
  return value;
}

function artifactFile(value, code) {
  if (typeof value !== "string" || path.basename(value) !== value || !ARTIFACT_FILE.test(value)) reject(code);
  return value;
}

function registryDigest(reference, code) {
  string(reference, REGISTRY_REFERENCE, code);
  return reference.slice(reference.lastIndexOf("@sha256:") + 1);
}

function validateCandidate(candidate) {
  exactKeys(candidate, ["git_commit", "git_tree", "package_version", "web_image_digest", "worker_image_digest", "migration_allowlist_sha256"], "IMAGE_PROVENANCE_CANDIDATE_FIELDS_INVALID");
  string(candidate.git_commit, COMMIT, "IMAGE_PROVENANCE_CANDIDATE_INVALID");
  string(candidate.git_tree, COMMIT, "IMAGE_PROVENANCE_CANDIDATE_INVALID");
  string(candidate.package_version, VERSION, "IMAGE_PROVENANCE_CANDIDATE_INVALID");
  string(candidate.web_image_digest, DIGEST, "IMAGE_PROVENANCE_CANDIDATE_INVALID");
  string(candidate.worker_image_digest, DIGEST, "IMAGE_PROVENANCE_CANDIDATE_INVALID");
  string(candidate.migration_allowlist_sha256, SHA256, "IMAGE_PROVENANCE_CANDIDATE_INVALID");
  if (candidate.web_image_digest === candidate.worker_image_digest) reject("IMAGE_PROVENANCE_CANDIDATE_INVALID");
  return candidate;
}

function validateInspectDescriptor(value, code) {
  exactKeys(value, ["file", "sha256"], `${code}_FIELDS_INVALID`);
  artifactFile(value.file, `${code}_FILE_INVALID`);
  string(value.sha256, SHA256, `${code}_SHA256_INVALID`);
}

function exactStringArray(value, expected, code) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((entry, index) => entry !== expected[index])) reject(code);
}

export function validateCandidateBuildProvenance(value, expected = {}) {
  exactKeys(value, ["schema_version", "contract", "generated_at", "run_id", "scope", "candidate", "source", "builder", "targets", "limitations", "result"], "CANDIDATE_BUILD_FIELDS_INVALID");
  if (value.schema_version !== 3 || value.contract !== RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT) reject("CANDIDATE_BUILD_VERSION_INVALID");
  iso(value.generated_at, "CANDIDATE_BUILD_TIME_INVALID");
  string(value.run_id, IDENTIFIER, "CANDIDATE_BUILD_RUN_ID_INVALID");
  if (value.scope !== "LOCAL_ISOLATED_CANDIDATE") reject("CANDIDATE_BUILD_SCOPE_INVALID");
  validateCandidate(value.candidate);
  if (expected.candidate) {
    for (const key of ["git_commit", "git_tree", "package_version", "web_image_digest", "worker_image_digest", "migration_allowlist_sha256"]) {
      if (value.candidate[key] !== expected.candidate[key]) reject("CANDIDATE_BUILD_CANDIDATE_MISMATCH");
    }
  }
  if (expected.runId && value.run_id !== expected.runId) reject("CANDIDATE_BUILD_RUN_ID_MISMATCH");

  exactKeys(value.source, ["archive_sha256", "archive_bytes", "dockerfile_sha256", "dockerignore_sha256", "package_lock_sha256", "orchestrator_sha256", "producer_sha256"], "CANDIDATE_BUILD_SOURCE_FIELDS_INVALID");
  for (const field of ["archive_sha256", "dockerfile_sha256", "dockerignore_sha256", "package_lock_sha256", "orchestrator_sha256", "producer_sha256"]) string(value.source[field], SHA256, "CANDIDATE_BUILD_SOURCE_INVALID");
  if (!Number.isSafeInteger(value.source.archive_bytes) || value.source.archive_bytes < 1) reject("CANDIDATE_BUILD_SOURCE_INVALID");

  exactKeys(value.builder, ["docker_server_version", "buildx_version", "builder_name", "builder_driver", "buildkit_version", "platform", "context", "base_pull_policy", "dependency_network", "runtime_dependency_network", "application_build_network", "frontend_reference", "frontend_manifest_digest", "build_base_image_reference", "build_base_registry_manifest_digest", "build_base_local_identity_digest", "runtime_base_image_reference", "runtime_base_registry_manifest_digest", "runtime_base_local_identity_digest", "runtime_apk_repository", "runtime_node_package", "runtime_node_version", "registry_image_reference", "registry_manifest_digest", "registry_local_identity_digest", "registry_state"], "CANDIDATE_BUILD_BUILDER_FIELDS_INVALID");
  for (const field of ["docker_server_version", "buildx_version", "buildkit_version"]) string(value.builder[field], /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "CANDIDATE_BUILD_TOOL_VERSION_INVALID");
  if (value.builder.builder_name !== "default" || value.builder.builder_driver !== "docker" || value.builder.platform !== "linux/amd64" || value.builder.context !== "GIT_ARCHIVE" || value.builder.base_pull_policy !== "LOCAL_REQUIRED_PULL_FALSE" || value.builder.dependency_network !== "PUBLIC_NPM_LOCKFILE_INTEGRITY" || value.builder.runtime_dependency_network !== "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGE" || value.builder.application_build_network !== "NONE") reject("CANDIDATE_BUILD_POLICY_INVALID");
  if (value.builder.frontend_reference !== RELEASE_DOCKERFILE_FRONTEND_REFERENCE || value.builder.frontend_manifest_digest !== RELEASE_DOCKERFILE_FRONTEND_REFERENCE.slice(RELEASE_DOCKERFILE_FRONTEND_REFERENCE.indexOf("@") + 1)) reject("CANDIDATE_BUILD_FRONTEND_INVALID");
  if (value.builder.build_base_image_reference !== RELEASE_NODE_BASE_IMAGE_REFERENCE || value.builder.build_base_registry_manifest_digest !== RELEASE_NODE_BASE_IMAGE_REFERENCE.slice(RELEASE_NODE_BASE_IMAGE_REFERENCE.indexOf("@") + 1)) reject("CANDIDATE_BUILD_BASE_IMAGE_INVALID");
  if (value.builder.runtime_base_image_reference !== RELEASE_RUNTIME_BASE_IMAGE_REFERENCE || value.builder.runtime_base_registry_manifest_digest !== RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.slice(RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.indexOf("@") + 1) || value.builder.runtime_apk_repository !== RELEASE_RUNTIME_APK_REPOSITORY || value.builder.runtime_node_package !== RELEASE_RUNTIME_NODE_PACKAGE || value.builder.runtime_node_version !== RELEASE_RUNTIME_NODE_VERSION) reject("CANDIDATE_BUILD_RUNTIME_IMAGE_INVALID");
  if (value.builder.registry_image_reference !== RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE || value.builder.registry_manifest_digest !== RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.slice(RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.indexOf("@") + 1) || value.builder.registry_state !== "EPHEMERAL_LOOPBACK_REMOVED") reject("CANDIDATE_BUILD_REGISTRY_INVALID");
  if (string(value.builder.build_base_local_identity_digest, DIGEST, "CANDIDATE_BUILD_BASE_IMAGE_INVALID") !== value.builder.build_base_registry_manifest_digest) reject("CANDIDATE_BUILD_BASE_IMAGE_INVALID");
  if (string(value.builder.runtime_base_local_identity_digest, DIGEST, "CANDIDATE_BUILD_RUNTIME_IMAGE_INVALID") !== value.builder.runtime_base_registry_manifest_digest) reject("CANDIDATE_BUILD_RUNTIME_IMAGE_INVALID");
  if (string(value.builder.registry_local_identity_digest, DIGEST, "CANDIDATE_BUILD_REGISTRY_INVALID") !== value.builder.registry_manifest_digest) reject("CANDIDATE_BUILD_REGISTRY_INVALID");

  if (!Array.isArray(value.targets) || value.targets.length !== 2) reject("CANDIDATE_BUILD_TARGETS_INVALID");
  const targetDigests = new Set(); const targetReferences = new Set();
  value.targets.forEach((target, index) => {
    exactKeys(target, ["service", "docker_target", "image_reference", "registry_manifest_digest", "image_config_digest", "oci_version", "oci_revision", "baked_version", "baked_revision", "user", "cmd"], "CANDIDATE_BUILD_TARGET_FIELDS_INVALID");
    const service = index === 0 ? "web" : "worker";
    if (target.service !== service || target.docker_target !== service) reject("CANDIDATE_BUILD_TARGET_INVALID");
    const match = string(target.image_reference, REGISTRY_REFERENCE, "CANDIDATE_BUILD_TARGET_REFERENCE_INVALID").match(/^127\.0\.0\.1:([1-9][0-9]{0,4})\/chenyida-erp\/(web|worker)@sha256:[0-9a-f]{64}$/);
    if (!match || Number(match[1]) > 65535 || match[2] !== service || target.registry_manifest_digest !== registryDigest(target.image_reference, "CANDIDATE_BUILD_TARGET_REFERENCE_INVALID")) reject("CANDIDATE_BUILD_TARGET_REFERENCE_INVALID");
    const expectedDigest = value.candidate[`${service}_image_digest`];
    if (target.registry_manifest_digest !== expectedDigest || target.oci_version !== value.candidate.package_version || target.oci_revision !== value.candidate.git_commit || target.baked_version !== value.candidate.package_version || target.baked_revision !== value.candidate.git_commit || target.user !== "65532:65532") reject("CANDIDATE_BUILD_TARGET_IDENTITY_INVALID");
    string(target.image_config_digest, DIGEST, "CANDIDATE_BUILD_TARGET_IDENTITY_INVALID");
    const expectedCommand = service === "web" ? ["node", "server.js"] : ["node", "--experimental-strip-types", "worker/selfhost.ts"];
    exactStringArray(target.cmd, expectedCommand, "CANDIDATE_BUILD_TARGET_COMMAND_INVALID");
    if (expected.imageReferences?.[service] && target.image_reference !== expected.imageReferences[service]) reject("CANDIDATE_BUILD_TARGET_REFERENCE_MISMATCH");
    targetDigests.add(target.image_config_digest); targetReferences.add(target.image_reference);
  });
  if (targetDigests.size !== 2 || targetReferences.size !== 2) reject("CANDIDATE_BUILD_TARGET_COLLISION");
  exactStringArray(value.limitations, ["NO_EXTERNAL_REGISTRY_ANCHOR", "NO_REPRODUCIBLE_BUILD_ATTESTATION", "LOCAL_ENGINE_ONLY", "PUBLIC_NPM_FETCH_WITH_LOCKFILE_INTEGRITY", "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGE"], "CANDIDATE_BUILD_LIMITATIONS_INVALID");
  if (value.result !== "LOCAL_LOOPBACK_DIGEST_VERIFIED") reject("CANDIDATE_BUILD_RESULT_INVALID");
  return value;
}

export function validateImageScanProvenance(value) {
  exactKeys(value, ["schema_version", "contract", "generated_at", "run_id", "producer", "candidate", "build_provenance", "scanner", "database", "targets"], "IMAGE_PROVENANCE_FIELDS_INVALID");
  if (value.schema_version !== 3 || value.contract !== RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT) reject("IMAGE_PROVENANCE_VERSION_INVALID");
  iso(value.generated_at, "IMAGE_PROVENANCE_TIME_INVALID");
  string(value.run_id, IDENTIFIER, "IMAGE_PROVENANCE_RUN_ID_INVALID");
  exactKeys(value.producer, ["supervisor_bundle_sha256", "authorization_sha256"], "IMAGE_PROVENANCE_PRODUCER_FIELDS_INVALID");
  string(value.producer.supervisor_bundle_sha256, SHA256, "IMAGE_PROVENANCE_SUPERVISOR_INVALID");
  string(value.producer.authorization_sha256, SHA256, "IMAGE_PROVENANCE_AUTHORIZATION_INVALID");
  validateCandidate(value.candidate);
  validateInspectDescriptor(value.build_provenance, "IMAGE_PROVENANCE_BUILD");
  if (value.build_provenance.file !== `${value.run_id}.build-provenance.json`) reject("IMAGE_PROVENANCE_BUILD_FILE_INVALID");

  exactKeys(value.scanner, ["name", "version", "image_reference", "registry_manifest_digest", "local_identity_digest", "binary_sha256", "platform", "inspect", "version_report"], "IMAGE_PROVENANCE_SCANNER_FIELDS_INVALID");
  if (value.scanner.name !== "trivy" || value.scanner.version !== RELEASE_TRIVY_VERSION || value.scanner.image_reference !== RELEASE_TRIVY_IMAGE_REFERENCE || value.scanner.registry_manifest_digest !== registryDigest(value.scanner.image_reference, "IMAGE_PROVENANCE_SCANNER_REFERENCE_INVALID") || value.scanner.platform !== "linux/amd64") reject("IMAGE_PROVENANCE_SCANNER_INVALID");
  if (string(value.scanner.local_identity_digest, DIGEST, "IMAGE_PROVENANCE_SCANNER_IDENTITY_INVALID") !== value.scanner.registry_manifest_digest) reject("IMAGE_PROVENANCE_SCANNER_IDENTITY_INVALID");
  string(value.scanner.binary_sha256, SHA256, "IMAGE_PROVENANCE_SCANNER_BINARY_INVALID");
  validateInspectDescriptor(value.scanner.inspect, "IMAGE_PROVENANCE_SCANNER_INSPECT");
  validateInspectDescriptor(value.scanner.version_report, "IMAGE_PROVENANCE_SCANNER_VERSION_REPORT");

  exactKeys(value.database, ["schema_version", "updated_at", "downloaded_at", "next_update", "metadata", "payload_tree_sha256"], "IMAGE_PROVENANCE_DATABASE_FIELDS_INVALID");
  if (!Number.isSafeInteger(value.database.schema_version) || value.database.schema_version < 1 || value.database.schema_version > 99) reject("IMAGE_PROVENANCE_DATABASE_SCHEMA_INVALID");
  iso(value.database.updated_at, "IMAGE_PROVENANCE_DATABASE_TIME_INVALID");
  iso(value.database.downloaded_at, "IMAGE_PROVENANCE_DATABASE_TIME_INVALID");
  iso(value.database.next_update, "IMAGE_PROVENANCE_DATABASE_TIME_INVALID");
  if (Date.parse(value.database.downloaded_at) < Date.parse(value.database.updated_at) || Date.parse(value.database.next_update) <= Date.parse(value.database.updated_at)) reject("IMAGE_PROVENANCE_DATABASE_TIME_INVALID");
  validateInspectDescriptor(value.database.metadata, "IMAGE_PROVENANCE_DATABASE_METADATA");
  string(value.database.payload_tree_sha256, SHA256, "IMAGE_PROVENANCE_DATABASE_PAYLOAD_INVALID");

  if (!Array.isArray(value.targets) || value.targets.length !== 2) reject("IMAGE_PROVENANCE_TARGETS_INVALID");
  const expected = new Map([["web", value.candidate.web_image_digest], ["worker", value.candidate.worker_image_digest]]);
  value.targets.forEach((target, index) => {
    exactKeys(target, ["service", "image_reference", "registry_manifest_digest", "image_config_digest", "platform", "inspect", "archive_sha256", "archive_bytes", "archive_config_digest", "native_vulnerability", "native_cyclonedx"], "IMAGE_PROVENANCE_TARGET_FIELDS_INVALID");
    const service = index === 0 ? "web" : "worker";
    if (target.service !== service || target.archive_config_digest !== target.image_config_digest || target.platform !== "linux/amd64") reject("IMAGE_PROVENANCE_TARGET_INVALID");
    if (target.registry_manifest_digest !== registryDigest(target.image_reference, "IMAGE_PROVENANCE_TARGET_REFERENCE_INVALID") || target.registry_manifest_digest !== expected.get(service)) reject("IMAGE_PROVENANCE_TARGET_REFERENCE_INVALID");
    string(target.image_config_digest, DIGEST, "IMAGE_PROVENANCE_TARGET_CONFIG_INVALID");
    string(target.archive_config_digest, DIGEST, "IMAGE_PROVENANCE_TARGET_ARCHIVE_CONFIG_INVALID");
    string(target.archive_sha256, SHA256, "IMAGE_PROVENANCE_TARGET_ARCHIVE_INVALID");
    if (!Number.isSafeInteger(target.archive_bytes) || target.archive_bytes < 1) reject("IMAGE_PROVENANCE_TARGET_ARCHIVE_INVALID");
    validateInspectDescriptor(target.inspect, "IMAGE_PROVENANCE_TARGET_INSPECT");
    validateInspectDescriptor(target.native_vulnerability, "IMAGE_PROVENANCE_TARGET_VULNERABILITY");
    validateInspectDescriptor(target.native_cyclonedx, "IMAGE_PROVENANCE_TARGET_CYCLONEDX");
  });
  if (value.targets[0].image_reference === value.targets[1].image_reference || value.targets[0].archive_sha256 === value.targets[1].archive_sha256) reject("IMAGE_PROVENANCE_TARGET_COLLISION");
  return value;
}

export function validateDockerImageInspect(value, expected) {
  if (!Array.isArray(value) || value.length !== 1) reject("IMAGE_INSPECT_ROWS_INVALID");
  const row = record(value[0], "IMAGE_INSPECT_ROW_INVALID");
  if (row.Id !== expected.imageDigest || row.Os !== "linux" || row.Architecture !== "amd64" || !Array.isArray(row.RepoDigests) || !row.RepoDigests.includes(expected.imageReference)) reject("IMAGE_INSPECT_IDENTITY_MISMATCH");
  return row;
}

export function validateTrivyVersionReport(value, expectedConfigDigest = null) {
  record(value, "TRIVY_VERSION_REPORT_INVALID");
  const version = value.Version ?? value.version;
  if (version !== RELEASE_TRIVY_VERSION) reject("TRIVY_VERSION_MISMATCH");
  const configDigest = value.ScannerImageConfigDigest ?? value.scanner_image_config_digest ?? null;
  if (expectedConfigDigest !== null && configDigest !== null && configDigest !== expectedConfigDigest) reject("TRIVY_VERSION_IMAGE_MISMATCH");
  return value;
}

export function validateTrivyDatabaseMetadata(value, expected) {
  record(value, "TRIVY_DATABASE_METADATA_INVALID");
  const schemaVersion = value.Version ?? value.version;
  const updatedAt = value.UpdatedAt ?? value.updated_at;
  const downloadedAt = value.DownloadedAt ?? value.downloaded_at;
  const nextUpdate = value.NextUpdate ?? value.next_update;
  const normalized = (input) => {
    const timestamp = Date.parse(input);
    if (!Number.isFinite(timestamp)) reject("TRIVY_DATABASE_METADATA_MISMATCH");
    return new Date(timestamp).toISOString();
  };
  if (schemaVersion !== expected.schemaVersion || normalized(updatedAt) !== expected.updatedAt || normalized(downloadedAt) !== expected.downloadedAt || normalized(nextUpdate) !== expected.nextUpdate) reject("TRIVY_DATABASE_METADATA_MISMATCH");
  return value;
}

export function validateTrivyNativeVulnerabilityReport(value, expected) {
  record(value, "TRIVY_NATIVE_REPORT_INVALID");
  if (value.SchemaVersion !== 2 || value.ArtifactType !== "container_image" || !Array.isArray(value.Results) || value.Results.length < 1) reject("TRIVY_NATIVE_REPORT_IDENTITY_INVALID");
  const metadata = value.Metadata === undefined ? {} : record(value.Metadata, "TRIVY_NATIVE_REPORT_METADATA_INVALID");
  if (metadata.ImageID !== undefined && metadata.ImageID !== expected.imageConfigDigest) reject("TRIVY_NATIVE_REPORT_IMAGE_MISMATCH");
  if (metadata.RepoDigests !== undefined && (!Array.isArray(metadata.RepoDigests) || (metadata.RepoDigests.length > 0 && !metadata.RepoDigests.includes(expected.imageReference)))) reject("TRIVY_NATIVE_REPORT_IMAGE_MISMATCH");
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  let packages = 0;
  for (const result of value.Results) {
    record(result, "TRIVY_NATIVE_RESULT_INVALID");
    if (Array.isArray(result.Packages)) packages += result.Packages.length;
    else if (result.Packages !== undefined) reject("TRIVY_NATIVE_PACKAGES_INVALID");
    const vulnerabilities = result.Vulnerabilities === undefined || result.Vulnerabilities === null ? [] : result.Vulnerabilities;
    if (!Array.isArray(vulnerabilities)) reject("TRIVY_NATIVE_VULNERABILITIES_INVALID");
    for (const vulnerability of vulnerabilities) {
      record(vulnerability, "TRIVY_NATIVE_VULNERABILITY_INVALID");
      const severity = typeof vulnerability.Severity === "string" ? vulnerability.Severity.toUpperCase() : "UNKNOWN";
      const key = SEVERITIES.has(severity) ? severity.toLowerCase() : "unknown";
      counts[key] += 1;
    }
  }
  if (packages < 1) reject("TRIVY_NATIVE_PACKAGE_INVENTORY_MISSING");
  return counts;
}

export function validateTrivyCycloneDxDocument(value, expected = {}) {
  exactKeys(value, ["$schema", "bomFormat", "specVersion", "serialNumber", "version", "metadata", "components", "dependencies", "vulnerabilities"], "TRIVY_CYCLONEDX_FIELDS_INVALID");
  if (value.$schema !== "http://cyclonedx.org/schema/bom-1.6.schema.json" || value.bomFormat !== "CycloneDX" || value.specVersion !== "1.6" || value.version !== 1 || typeof value.serialNumber !== "string" || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.serialNumber)) reject("TRIVY_CYCLONEDX_IDENTITY_INVALID");
  exactKeys(value.metadata, ["timestamp", "tools", "component"], "TRIVY_CYCLONEDX_METADATA_INVALID");
  if (typeof value.metadata.timestamp !== "string" || !Number.isFinite(Date.parse(value.metadata.timestamp))) reject("TRIVY_CYCLONEDX_TIME_INVALID");
  exactKeys(value.metadata.tools, ["components"], "TRIVY_CYCLONEDX_TOOL_INVALID");
  if (!Array.isArray(value.metadata.tools.components) || value.metadata.tools.components.length !== 1) reject("TRIVY_CYCLONEDX_TOOL_INVALID");
  const tool = record(value.metadata.tools.components[0], "TRIVY_CYCLONEDX_TOOL_INVALID");
  const allowedToolKeys = new Set(["type", "manufacturer", "group", "name", "version"]);
  if (Object.keys(tool).some((key) => !allowedToolKeys.has(key)) || tool.type !== "application" || tool.group !== "aquasecurity" || tool.name !== "trivy" || tool.version !== RELEASE_TRIVY_VERSION) reject("TRIVY_CYCLONEDX_TOOL_INVALID");
  exactKeys(tool.manufacturer, ["name"], "TRIVY_CYCLONEDX_TOOL_INVALID");
  if (tool.manufacturer.name !== "Aqua Security Software Ltd.") reject("TRIVY_CYCLONEDX_TOOL_INVALID");

  const root = record(value.metadata.component, "TRIVY_CYCLONEDX_ROOT_INVALID");
  if (root.type !== "container" || typeof root["bom-ref"] !== "string" || root["bom-ref"].length < 1 || typeof root.name !== "string" || root.name.length < 1) reject("TRIVY_CYCLONEDX_ROOT_INVALID");
  if (root.properties !== undefined) {
    if (!Array.isArray(root.properties)) reject("TRIVY_CYCLONEDX_ROOT_INVALID");
    for (const property of root.properties) {
      exactKeys(property, ["name", "value"], "TRIVY_CYCLONEDX_ROOT_INVALID");
      if (typeof property.name !== "string" || typeof property.value !== "string") reject("TRIVY_CYCLONEDX_ROOT_INVALID");
    }
    const imageIds = root.properties.filter((property) => property.name === "aquasecurity:trivy:ImageID").map((property) => property.value);
    if (imageIds.length > 1 || (imageIds.length === 1 && expected.imageConfigDigest !== undefined && imageIds[0] !== expected.imageConfigDigest)) reject("TRIVY_CYCLONEDX_IMAGE_MISMATCH");
    const repoDigests = root.properties.filter((property) => property.name === "aquasecurity:trivy:RepoDigest").map((property) => property.value);
    if (repoDigests.length > 1 || (repoDigests.length === 1 && expected.imageReference !== undefined && !repoDigests[0].endsWith(`@${registryDigest(expected.imageReference, "TRIVY_CYCLONEDX_IMAGE_MISMATCH")}`))) reject("TRIVY_CYCLONEDX_IMAGE_MISMATCH");
  }
  if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > 200_000) reject("TRIVY_CYCLONEDX_COMPONENTS_INVALID");
  const references = new Set([root["bom-ref"]]); let debian = 0; let npm = 0;
  for (const component of value.components) {
    record(component, "TRIVY_CYCLONEDX_COMPONENT_INVALID");
    if (typeof component["bom-ref"] !== "string" || component["bom-ref"].length < 1 || references.has(component["bom-ref"])) reject("TRIVY_CYCLONEDX_COMPONENT_REFERENCE_INVALID");
    references.add(component["bom-ref"]);
    if (typeof component.name !== "string" || component.name.length < 1 || typeof component.type !== "string" || component.type.length < 1) reject("TRIVY_CYCLONEDX_COMPONENT_INVALID");
    if (component.purl !== undefined) {
      if (typeof component.purl !== "string" || !component.purl.startsWith("pkg:") || typeof component.version !== "string" || component.version.length < 1) reject("TRIVY_CYCLONEDX_COMPONENT_INVALID");
      if (component.purl.startsWith("pkg:deb/")) debian += 1;
      if (component.purl.startsWith("pkg:npm/")) npm += 1;
    }
  }
  if (debian < 1 || npm < 1) reject("TRIVY_CYCLONEDX_PACKAGE_COVERAGE_INVALID");
  if (!Array.isArray(value.dependencies)) reject("TRIVY_CYCLONEDX_DEPENDENCIES_INVALID");
  const dependencyReferences = new Set();
  for (const dependency of value.dependencies) {
    exactKeys(dependency, ["ref", "dependsOn"], "TRIVY_CYCLONEDX_DEPENDENCY_INVALID");
    if (!references.has(dependency.ref) || dependencyReferences.has(dependency.ref) || !Array.isArray(dependency.dependsOn) || new Set(dependency.dependsOn).size !== dependency.dependsOn.length || dependency.dependsOn.some((reference) => !references.has(reference))) reject("TRIVY_CYCLONEDX_DEPENDENCY_INVALID");
    dependencyReferences.add(dependency.ref);
  }
  if (!Array.isArray(value.vulnerabilities) || value.vulnerabilities.length !== 0) reject("TRIVY_CYCLONEDX_VULNERABILITIES_FOUND");
  return value;
}
