import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  RELEASE_ARTIFACT_ROOT_MARKER,
  RELEASE_ARTIFACT_ROOT_MARKER_VALUE,
  RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT,
  RELEASE_DOCKERFILE_FRONTEND_REFERENCE,
  RELEASE_GATE_REPORT_CONTRACT,
  RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT,
  RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE,
  RELEASE_NODE_BASE_IMAGE_REFERENCE,
  RELEASE_RUNTIME_APK_REPOSITORY,
  RELEASE_RUNTIME_BASE_IMAGE_REFERENCE,
  RELEASE_RUNTIME_NODE_PACKAGE,
  RELEASE_RUNTIME_NODE_VERSION,
  RELEASE_SBOM_EVIDENCE_CONTRACT,
  RELEASE_SECURITY_EVIDENCE_CONTRACT,
  RELEASE_SECURITY_SCAN_REPORT_CONTRACT,
  RELEASE_TEST_RUNTIME_POLICY_SHA256,
  RELEASE_TRIVY_IMAGE_REFERENCE,
  RELEASE_TRIVY_VERSION,
  RELEASE_VULNERABILITY_POLICY_ID,
  RELEASE_VULNERABILITY_POLICY_SHA256,
  assembleReleaseManifest,
  canonicalJson,
  migrationAllowlistDigest,
  sha256,
  validateCandidateBuildProvenance,
  validateImageScanProvenance,
  validateOfficialReleaseGatePlan,
  validateReleaseGateReport,
  validateSbomEvidence,
  validateSecurityEvidence,
  validateSecurityScanReport,
  writeImmutableJsonArtifact,
} from "../scripts/release-manifest-contract.mjs";

export const FIXTURE_GIT = "a".repeat(40);
export const FIXTURE_TREE = "b".repeat(40);
export const FIXTURE_WEB = `sha256:${"c".repeat(64)}`;
export const FIXTURE_WORKER = `sha256:${"d".repeat(64)}`;
export const FIXTURE_WEB_CONFIG = `sha256:${"e".repeat(64)}`;
export const FIXTURE_WORKER_CONFIG = `sha256:${"f".repeat(64)}`;
export const FIXTURE_VERSION = "0.1.0-alpha.46";
export const FIXTURE_TEST_RUNTIME = { policy_sha256: RELEASE_TEST_RUNTIME_POLICY_SHA256, node_image_digest: "sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3", postgres_image_digest: "sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394", posix_image_digest: "sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37", browser_image_digest: "sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961", browser_executable_sha256: "efb2bece6f2f5bc00dc270162d2241c86d509ca4f4297b1eb0f5cd8894d050be", node_modules_tree_sha256: "3d727122206562df4ebfe24139bfd7b2ae16a299ef2e62b6d55b19e61c2db819", python_venv_tree_sha256: "c67b68ec9436f4a13f41df0eff9b552ca3f1d8b9e759113ebd23eefbe9419041" };
export const FIXTURE_RUNTIME_SERVICES = [
  { service: "caddy", container_id: "1".repeat(64), image_id: `sha256:${"1".repeat(64)}`, image_reference: "caddy:legacy", restart_count: 0, oom_killed: false, running: true, restarting: false, paused: false, dead: false, status: "running", health: "none", healthcheck_present: false },
  { service: "postgres", container_id: "2".repeat(64), image_id: `sha256:${"2".repeat(64)}`, image_reference: "postgres:legacy", restart_count: 0, oom_killed: false, running: true, restarting: false, paused: false, dead: false, status: "running", health: "healthy", healthcheck_present: true },
  { service: "web", container_id: "3".repeat(64), image_id: `sha256:${"3".repeat(64)}`, image_reference: "chenyida-erp:web-legacy", restart_count: 0, oom_killed: false, running: true, restarting: false, paused: false, dead: false, status: "running", health: "healthy", healthcheck_present: true },
  { service: "worker", container_id: "4".repeat(64), image_id: `sha256:${"4".repeat(64)}`, image_reference: "chenyida-erp:worker-legacy", restart_count: 0, oom_killed: false, running: true, restarting: false, paused: false, dead: false, status: "running", health: "none", healthcheck_present: false },
];
export const FIXTURE_CONTROL = {
  supervisor_bundle_sha256: "6".repeat(64),
  image_evidence_authorization_sha256: "7".repeat(64),
  release_gate_authorization_sha256: "8".repeat(64),
  manifest_authorization_sha256: "5".repeat(64),
};

export async function initializeReleaseArtifactRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o750 });
  await chmod(root, 0o750);
  const marker = path.join(root, RELEASE_ARTIFACT_ROOT_MARKER);
  await writeFile(marker, RELEASE_ARTIFACT_ROOT_MARKER_VALUE, { mode: 0o440 });
  await chmod(marker, 0o440);
}

export async function buildEligibleReleaseFixture({ entries, root = null, releaseId = "fixture-alpha45", generatedAt = "2026-08-12T01:00:00.000Z", expiresAt = "2026-08-12T02:00:00.000Z", deploymentClass = "UAT" }) {
  const plan = validateOfficialReleaseGatePlan(JSON.parse(await readFile(new URL("../release/release-gate-plan-v2.json", import.meta.url), "utf8")));
  const planRaw = canonicalJson(plan);
  const candidate = { git_commit: FIXTURE_GIT, git_tree: FIXTURE_TREE, package_version: FIXTURE_VERSION, web_image_digest: FIXTURE_WEB, worker_image_digest: FIXTURE_WORKER, migration_allowlist_sha256: migrationAllowlistDigest(entries) };
  const targetConfigs = { web: FIXTURE_WEB_CONFIG, worker: FIXTURE_WORKER_CONFIG };
  const image = (service, digest) => ({ service, image_reference: `127.0.0.1:5000/chenyida-erp/${service}@${digest}`, image_digest: digest, oci_version: FIXTURE_VERSION, oci_revision: FIXTURE_GIT, baked_version: FIXTURE_VERSION, baked_revision: FIXTURE_GIT });
  const images = { web: image("web", FIXTURE_WEB), worker: image("worker", FIXTURE_WORKER) };
  const source = { git_commit: FIXTURE_GIT, git_tree: FIXTURE_TREE, worktree_clean: true, package_path: "chenyida_erp_site/package.json", package_version: FIXTURE_VERSION, package_sha256: "1".repeat(64), dockerfile_path: "chenyida_erp_site/Dockerfile", dockerfile_sha256: "2".repeat(64), compose_path: "chenyida_erp_site/compose.yml", compose_sha256: "3".repeat(64), release_compose_path: "chenyida_erp_site/compose.release.yml", release_compose_sha256: "4".repeat(64) };
  const planFile = `${releaseId}.plan.json`, reportFile = `${releaseId}.report.json`, sbomFile = `${releaseId}.sbom.json`, rawReportFile = `${releaseId}.security-report.json`, securityFile = `${releaseId}.security.json`, provenanceFile = `${releaseId}.scan-provenance.json`, buildProvenanceFile = `${releaseId}.build-provenance.json`;
  const buildProvenance = validateCandidateBuildProvenance({
    schema_version: 3,
    contract: RELEASE_CANDIDATE_BUILD_PROVENANCE_CONTRACT,
    generated_at: generatedAt,
    run_id: releaseId,
    scope: "LOCAL_ISOLATED_CANDIDATE",
    candidate,
    source: { archive_sha256: "0".repeat(64), archive_bytes: 1024, dockerfile_sha256: "1".repeat(64), dockerignore_sha256: "2".repeat(64), package_lock_sha256: "3".repeat(64), orchestrator_sha256: "4".repeat(64), producer_sha256: "5".repeat(64) },
    builder: {
      docker_server_version: "29.5.2", buildx_version: "v0.34.1", builder_name: "default", builder_driver: "docker", buildkit_version: "v0.30.0", platform: "linux/amd64", context: "GIT_ARCHIVE",
      base_pull_policy: "LOCAL_REQUIRED_PULL_FALSE", dependency_network: "PUBLIC_NPM_LOCKFILE_INTEGRITY", runtime_dependency_network: "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGE", application_build_network: "NONE",
      frontend_reference: RELEASE_DOCKERFILE_FRONTEND_REFERENCE, frontend_manifest_digest: RELEASE_DOCKERFILE_FRONTEND_REFERENCE.slice(RELEASE_DOCKERFILE_FRONTEND_REFERENCE.indexOf("@") + 1),
      build_base_image_reference: RELEASE_NODE_BASE_IMAGE_REFERENCE, build_base_registry_manifest_digest: RELEASE_NODE_BASE_IMAGE_REFERENCE.slice(RELEASE_NODE_BASE_IMAGE_REFERENCE.indexOf("@") + 1), build_base_local_identity_digest: RELEASE_NODE_BASE_IMAGE_REFERENCE.slice(RELEASE_NODE_BASE_IMAGE_REFERENCE.indexOf("@") + 1),
      runtime_base_image_reference: RELEASE_RUNTIME_BASE_IMAGE_REFERENCE, runtime_base_registry_manifest_digest: RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.slice(RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.indexOf("@") + 1), runtime_base_local_identity_digest: RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.slice(RELEASE_RUNTIME_BASE_IMAGE_REFERENCE.indexOf("@") + 1),
      runtime_apk_repository: RELEASE_RUNTIME_APK_REPOSITORY, runtime_node_package: RELEASE_RUNTIME_NODE_PACKAGE, runtime_node_version: RELEASE_RUNTIME_NODE_VERSION,
      registry_image_reference: RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE, registry_manifest_digest: RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.slice(RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.indexOf("@") + 1), registry_local_identity_digest: RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.slice(RELEASE_LOOPBACK_REGISTRY_IMAGE_REFERENCE.indexOf("@") + 1), registry_state: "EPHEMERAL_LOOPBACK_REMOVED",
    },
    targets: [["web", ["node", "server.js"]], ["worker", ["node", "--experimental-strip-types", "worker/selfhost.ts"]]].map(([service, cmd]) => ({ service, docker_target: service, image_reference: images[service].image_reference, registry_manifest_digest: images[service].image_reference.slice(images[service].image_reference.lastIndexOf("@") + 1), image_config_digest: targetConfigs[service], oci_version: FIXTURE_VERSION, oci_revision: FIXTURE_GIT, baked_version: FIXTURE_VERSION, baked_revision: FIXTURE_GIT, user: "65532:65532", cmd })),
    limitations: ["NO_EXTERNAL_REGISTRY_ANCHOR", "NO_REPRODUCIBLE_BUILD_ATTESTATION", "LOCAL_ENGINE_ONLY", "PUBLIC_NPM_FETCH_WITH_LOCKFILE_INTEGRITY", "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGE"],
    result: "LOCAL_LOOPBACK_DIGEST_VERIFIED",
  }, { runId: releaseId, candidate, imageReferences: { web: images.web.image_reference, worker: images.worker.image_reference } });
  const buildProvenanceRaw = canonicalJson(buildProvenance);
  const targetInputs = [["web", FIXTURE_WEB, FIXTURE_WEB_CONFIG, images.web.image_reference], ["worker", FIXTURE_WORKER, FIXTURE_WORKER_CONFIG, images.worker.image_reference]];
  const nativeCycloneDx = Object.fromEntries(targetInputs.map(([service, , configDigest]) => {
    const rootReference = `urn:uuid:${randomUUID()}`;
    const osReference = `pkg:apk/wolfi/fixture-${service}@1.0.0`;
    const npmReference = `pkg:npm/fixture-${service}@1.0.0`;
    return [service, {
    $schema: "http://cyclonedx.org/schema/bom-1.6.schema.json", bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
    metadata: {
      timestamp: generatedAt,
      tools: { components: [{ type: "application", manufacturer: { name: "Aqua Security Software Ltd." }, group: "aquasecurity", name: "trivy", version: RELEASE_TRIVY_VERSION }] },
      component: { type: "container", "bom-ref": rootReference, name: `${service}.tar`, properties: [{ name: "aquasecurity:trivy:ImageID", value: configDigest }] },
    },
    components: [
      { type: "operating-system", "bom-ref": `urn:uuid:${randomUUID()}`, name: "wolfi", version: "20230201", properties: [{ name: "aquasecurity:trivy:Class", value: "os-pkgs" }, { name: "aquasecurity:trivy:Type", value: "wolfi" }] },
      { type: "library", "bom-ref": osReference, name: `fixture-${service}-os`, version: "1.0.0", purl: osReference },
      { type: "library", "bom-ref": npmReference, name: `fixture-${service}`, version: "1.0.0", purl: npmReference },
    ],
    dependencies: [{ ref: rootReference, dependsOn: [osReference, npmReference] }, { ref: osReference, dependsOn: [] }, { ref: npmReference, dependsOn: [] }],
    vulnerabilities: [],
  }];
  }));
  const nativeVulnerability = Object.fromEntries(targetInputs.map(([service, , configDigest]) => [service, { SchemaVersion: 2, ArtifactName: `${service}.tar`, ArtifactType: "container_image", Metadata: { ImageID: configDigest, OS: { Family: "wolfi", Name: "20230201" } }, Results: [{ Target: `${service}.tar (wolfi 20230201)`, Class: "os-pkgs", Type: "wolfi", Packages: [{ ID: `fixture-${service}@1.0.0` }] }, { Target: "Node.js", Class: "lang-pkgs", Type: "node-pkg", Packages: [{ ID: `fixture-${service}-node@1.0.0` }] }] }]));
  const targetFiles = Object.fromEntries(targetInputs.map(([service]) => [service, { inspect: `${releaseId}.${service}.inspect.json`, vulnerability: `${releaseId}.${service}.trivy.json`, cyclonedx: `${releaseId}.${service}.cdx.json` }]));
  const targetArtifacts = Object.fromEntries(targetInputs.map(([service, manifestDigest, , imageReference], index) => {
    const inspect = [{ Id: manifestDigest, Os: "linux", Architecture: "amd64", RepoDigests: [imageReference] }];
    return [service, { inspect, inspectRaw: canonicalJson(inspect), vulnerability: nativeVulnerability[service], vulnerabilityRaw: canonicalJson(nativeVulnerability[service]), cyclonedx: nativeCycloneDx[service], cyclonedxRaw: canonicalJson(nativeCycloneDx[service]), archiveSha256: (index === 0 ? "e" : "f").repeat(64) }];
  }));
  const scannerImageDigest = RELEASE_TRIVY_IMAGE_REFERENCE.slice(RELEASE_TRIVY_IMAGE_REFERENCE.lastIndexOf("@") + 1), scannerInspectFile = `${releaseId}.trivy.inspect.json`, scannerVersionFile = `${releaseId}.trivy.version.json`, databaseMetadataFile = `${releaseId}.trivy-db.metadata.json`;
  const scannerInspect = [{ Id: scannerImageDigest, Os: "linux", Architecture: "amd64", RepoDigests: [RELEASE_TRIVY_IMAGE_REFERENCE] }], scannerVersionReport = { Version: RELEASE_TRIVY_VERSION }, databaseMetadata = { Version: 2, UpdatedAt: generatedAt, DownloadedAt: generatedAt, NextUpdate: new Date(Date.parse(generatedAt) + 24 * 60 * 60 * 1000).toISOString() };
  const scanner = "trivy", scannerVersion = RELEASE_TRIVY_VERSION, scannerImageReference = RELEASE_TRIVY_IMAGE_REFERENCE, scannerSha = "8".repeat(64), policyId = RELEASE_VULNERABILITY_POLICY_ID, policySha = RELEASE_VULNERABILITY_POLICY_SHA256, counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  const provenance = validateImageScanProvenance({ schema_version: 3, contract: RELEASE_IMAGE_SCAN_PROVENANCE_CONTRACT, generated_at: generatedAt, run_id: releaseId, producer: { supervisor_bundle_sha256: "6".repeat(64), authorization_sha256: "7".repeat(64) }, candidate, build_provenance: { file: buildProvenanceFile, sha256: sha256(buildProvenanceRaw) }, scanner: { name: scanner, version: scannerVersion, image_reference: scannerImageReference, registry_manifest_digest: scannerImageDigest, local_identity_digest: scannerImageDigest, binary_sha256: scannerSha, platform: "linux/amd64", inspect: { file: scannerInspectFile, sha256: sha256(canonicalJson(scannerInspect)) }, version_report: { file: scannerVersionFile, sha256: sha256(canonicalJson(scannerVersionReport)) } }, database: { schema_version: 2, updated_at: generatedAt, downloaded_at: generatedAt, next_update: databaseMetadata.NextUpdate, metadata: { file: databaseMetadataFile, sha256: sha256(canonicalJson(databaseMetadata)) }, payload_tree_sha256: "a".repeat(64) }, targets: targetInputs.map(([service, manifestDigest, configDigest, imageReference]) => ({ service, image_reference: imageReference, registry_manifest_digest: manifestDigest, image_config_digest: configDigest, platform: "linux/amd64", inspect: { file: targetFiles[service].inspect, sha256: sha256(targetArtifacts[service].inspectRaw) }, archive_sha256: targetArtifacts[service].archiveSha256, archive_bytes: 1024, archive_config_digest: configDigest, native_vulnerability: { file: targetFiles[service].vulnerability, sha256: sha256(targetArtifacts[service].vulnerabilityRaw) }, native_cyclonedx: { file: targetFiles[service].cyclonedx, sha256: sha256(targetArtifacts[service].cyclonedxRaw) } })) });
  const provenanceRaw = canonicalJson(provenance);
  const sbom = validateSbomEvidence({ schema_version: 1, contract: RELEASE_SBOM_EVIDENCE_CONTRACT, generated_at: generatedAt, scope: "WEB_AND_WORKER_IMAGES", candidate, format: "TRIVY_CYCLONEDX_1_6_JSON_SET", documents: targetInputs.map(([service]) => ({ service, file: targetFiles[service].cyclonedx, sha256: sha256(targetArtifacts[service].cyclonedxRaw) })), provenance_file: provenanceFile, provenance_sha256: sha256(provenanceRaw), result: "VERIFIED" });
  const sbomRaw = canonicalJson(sbom);
  const rawReport = validateSecurityScanReport({ schema_version: 1, contract: RELEASE_SECURITY_SCAN_REPORT_CONTRACT, generated_at: generatedAt, candidate, scanner: { name: scanner, version: scannerVersion, image_reference: scannerImageReference, binary_sha256: scannerSha }, policy: { id: policyId, sha256: policySha }, vulnerability_database_updated_at: generatedAt, targets: [["web", FIXTURE_WEB], ["worker", FIXTURE_WORKER]].map(([service, image_digest]) => ({ service, image_digest, counts, result: "PASS" })), counts, result: "PASS" }, { generated_at: generatedAt, candidate, scanner, scanner_version: scannerVersion, scanner_image_reference: scannerImageReference, scanner_binary_sha256: scannerSha, policy_id: policyId, policy_sha256: policySha, vulnerability_database_updated_at: generatedAt, counts, result: "PASS" });
  const rawReportRaw = canonicalJson(rawReport);
  const security = validateSecurityEvidence({ schema_version: 1, contract: RELEASE_SECURITY_EVIDENCE_CONTRACT, generated_at: generatedAt, candidate, sbom_evidence_sha256: sha256(sbomRaw), provenance_file: provenanceFile, provenance_sha256: sha256(provenanceRaw), scanner, scanner_version: scannerVersion, scanner_image_reference: scannerImageReference, scanner_binary_sha256: scannerSha, policy_id: policyId, policy_sha256: policySha, raw_report_file: rawReportFile, raw_report_sha256: sha256(rawReportRaw), vulnerability_database_updated_at: generatedAt, counts, result: "PASS", reason: null });
  const securityRaw = canonicalJson(security);
  const empty = sha256(""), snapshot = { available_memory_mib: 2048, swap_used_mib: 100, swap_used_percent: 10, root_free_gib: 30, load_1m: 0.5, temporary_containers: 0 };
  const report = validateReleaseGateReport({ schema_version: 2, contract: RELEASE_GATE_REPORT_CONTRACT, plan_id: plan.plan_id, plan_sha256: sha256(planRaw), run_id: releaseId, generated_at: generatedAt, completed_at: generatedAt, runtime_guard: plan.runtime_guard, control: { supervisor_bundle_sha256: FIXTURE_CONTROL.supervisor_bundle_sha256, authorization_sha256: FIXTURE_CONTROL.release_gate_authorization_sha256 }, candidate, steps: plan.steps.map((step) => ({ ordinal: step.ordinal, id: step.id, result: "PASS", started_at: generatedAt, finished_at: generatedAt, duration_ms: 0, exit_code: 0, stdout_sha256: empty, stderr_sha256: empty, reason: null })), evidence: { sbom_file: sbomFile, sbom_sha256: sha256(sbomRaw), sbom_scope: sbom.scope, security_file: securityFile, security_sha256: sha256(securityRaw), security_result: security.result }, resources: { initial: snapshot, final: snapshot, test_runtime: FIXTURE_TEST_RUNTIME, baseline_runtime_services: FIXTURE_RUNTIME_SERVICES, final_runtime_services: FIXTURE_RUNTIME_SERVICES, baseline_container_count: 4, preexisting_temporary_container_ids: [], minimum_available_memory_mib: 2048, maximum_swap_used_percent: 10, maximum_swap_growth_mib_60s: 0, minimum_root_free_gib: 30, maximum_load_1m: 0.5, maximum_temporary_containers: 0, residual_container_ids: [], baseline_runtime_failure: null, runtime_transition_failure: null, final_runtime_failure: null, final_resource_failure: null }, result: "PASS" });
  const reportRaw = canonicalJson(report);
  const manifest = assembleReleaseManifest({ releaseId, generatedAt, expiresAt, deploymentClass, source, images, migrations: entries, planFile, planRaw, plan, reportFile, reportRaw, report, sbomFile, sbomRaw, sbom, securityFile, securityRaw, security, control: FIXTURE_CONTROL });
  if (root) {
    const artifacts = [[planFile, plan], [buildProvenanceFile, buildProvenance], [scannerInspectFile, scannerInspect], [scannerVersionFile, scannerVersionReport], [databaseMetadataFile, databaseMetadata], [provenanceFile, provenance], [sbomFile, sbom], [rawReportFile, rawReport], [securityFile, security], [reportFile, report]];
    for (const [service] of targetInputs) artifacts.push([targetFiles[service].inspect, targetArtifacts[service].inspect], [targetFiles[service].vulnerability, targetArtifacts[service].vulnerability], [targetFiles[service].cyclonedx, targetArtifacts[service].cyclonedx]);
    for (const [filename, value] of artifacts) await writeImmutableJsonArtifact({ root, filename, value });
    await writeImmutableJsonArtifact({ root, filename: "release-manifest.json", value: manifest });
  }
  return { plan, planRaw, candidate, targetConfigs, source, images, buildProvenance, buildProvenanceRaw, provenance, provenanceRaw, targetArtifacts, sbom, sbomRaw, rawReport, rawReportRaw, security, securityRaw, report, reportRaw, manifest, filenames: { planFile, reportFile, buildProvenanceFile, provenanceFile, sbomFile, rawReportFile, securityFile } };
}
