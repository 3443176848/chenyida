import path from "node:path";

export const RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT = "chenyida-erp-image-scan-provenance/v1";
export const RELEASE_TRIVY_VERSION = "0.70.0";
export const RELEASE_TRIVY_IMAGE_REFERENCE = "ghcr.io/aquasecurity/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c";

const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
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

export function validateImageScanProvenance(value) {
  exactKeys(value, ["schema_version", "contract", "generated_at", "producer", "candidate", "scanner", "database", "targets"], "IMAGE_PROVENANCE_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT) reject("IMAGE_PROVENANCE_VERSION_INVALID");
  iso(value.generated_at, "IMAGE_PROVENANCE_TIME_INVALID");
  exactKeys(value.producer, ["supervisor_bundle_sha256", "authorization_sha256"], "IMAGE_PROVENANCE_PRODUCER_FIELDS_INVALID");
  string(value.producer.supervisor_bundle_sha256, SHA256, "IMAGE_PROVENANCE_SUPERVISOR_INVALID");
  string(value.producer.authorization_sha256, SHA256, "IMAGE_PROVENANCE_AUTHORIZATION_INVALID");
  validateCandidate(value.candidate);

  exactKeys(value.scanner, ["name", "version", "image_reference", "registry_manifest_digest", "config_digest", "binary_sha256", "platform", "inspect", "version_report"], "IMAGE_PROVENANCE_SCANNER_FIELDS_INVALID");
  if (value.scanner.name !== "trivy" || value.scanner.version !== RELEASE_TRIVY_VERSION || value.scanner.image_reference !== RELEASE_TRIVY_IMAGE_REFERENCE || value.scanner.registry_manifest_digest !== registryDigest(value.scanner.image_reference, "IMAGE_PROVENANCE_SCANNER_REFERENCE_INVALID") || value.scanner.platform !== "linux/amd64") reject("IMAGE_PROVENANCE_SCANNER_INVALID");
  string(value.scanner.config_digest, DIGEST, "IMAGE_PROVENANCE_SCANNER_CONFIG_INVALID");
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
    if (target.service !== service || target.image_config_digest !== expected.get(service) || target.archive_config_digest !== target.image_config_digest || target.platform !== "linux/amd64") reject("IMAGE_PROVENANCE_TARGET_INVALID");
    if (target.registry_manifest_digest !== registryDigest(target.image_reference, "IMAGE_PROVENANCE_TARGET_REFERENCE_INVALID")) reject("IMAGE_PROVENANCE_TARGET_REFERENCE_INVALID");
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
  if (row.Id !== expected.configDigest || row.Os !== "linux" || row.Architecture !== "amd64" || !Array.isArray(row.RepoDigests) || !row.RepoDigests.includes(expected.imageReference)) reject("IMAGE_INSPECT_IDENTITY_MISMATCH");
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
