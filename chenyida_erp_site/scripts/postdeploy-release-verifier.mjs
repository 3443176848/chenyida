import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  RELEASE_RUNTIME_POLICY_SHA256,
  validateRuntimeGuardBinding,
} from "./release-lifecycle-contract.mjs";
import {
  abortPreparedReleaseIdentity,
  commitPreparedReleaseIdentity,
  parseStrictJson,
  prepareReleaseIdentity,
} from "./release-identity-contract.mjs";
import {
  canonicalJson,
  discardPreparedJsonArtifact,
  loadReleaseManifest,
  publishPreparedJsonArtifact,
  readRecoverableJsonPublication,
  sha256,
  writePreparedJsonArtifact,
} from "./release-manifest-contract.mjs";
import {
  PostDeployReleaseError,
  buildPostDeployReceipt,
  buildReleaseIdentityFromPostDeployReceipt,
  validatePostDeployReadiness,
  validatePostDeployReceipt,
  validatePostDeployRuntimeServices,
} from "./postdeploy-release-contract.mjs";

const SAFE_ENVIRONMENT = Object.freeze({ PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" });
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/;
const RELEASE_GATE_LOCK_FILE = "/var/lock/chenyida-erp-release-gate-v1.lock";
const SERVICES = ["caddy", "postgres", "web", "worker"];
const PREPARED_SUFFIX = ".postdeploy-receipt.prepared.json";
const CONTAINER_INSPECT_FORMAT = '{{.Id}}|{{.Name}}|{{.Image}}|{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Running}}|{{.State.Restarting}}|{{.State.Paused}}|{{.State.Dead}}|{{.State.Status}}|{{with (index .State "Health")}}{{.Status}}{{else}}none{{end}}|{{if .Config.Healthcheck}}true{{else}}false{{end}}';
const IMAGE_INSPECT_FORMAT = '{{.Id}}|{{.Os}}|{{.Architecture}}|{{json .RepoDigests}}|{{json .Descriptor}}';

function reject(code) {
  throw new PostDeployReleaseError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function cliOptions(args) {
  const value = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const item = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || item === undefined || Object.hasOwn(value, key)) reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
    value[key] = item;
  }
  return value;
}

function docker(args, code, { maximum = 4 * 1024 * 1024 } = {}) {
  const result = spawnSync("/usr/bin/docker", args, { encoding: "utf8", timeout: 30_000, maxBuffer: maximum, env: SAFE_ENVIRONMENT, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0 || result.signal || typeof result.stdout !== "string") reject(code);
  return result.stdout;
}

function verifyGlobalLock(environment = process.env) {
  if (environment.ERP_RELEASE_GATE_LOCK_HELD !== "YES") reject("POSTDEPLOY_GLOBAL_LOCK_REQUIRED");
  const result = spawnSync("/usr/bin/flock", ["-n", RELEASE_GATE_LOCK_FILE, "/bin/true"], { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  if (result.status === 0) reject("POSTDEPLOY_GLOBAL_LOCK_NOT_HELD");
  if (result.status !== 1) reject("POSTDEPLOY_GLOBAL_LOCK_PROBE_FAILED");
}

function supervisorControl(environment = process.env) {
  if (environment.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES") reject("POSTDEPLOY_SUPERVISOR_REQUIRED");
  const supervisorBundleSha256 = environment.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256;
  const authorizationSha256 = environment.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256;
  if (![supervisorBundleSha256, authorizationSha256].every((value) => typeof value === "string" && SHA256.test(value))) reject("POSTDEPLOY_SUPERVISOR_CONTROL_INVALID");
  return { supervisor_bundle_sha256: supervisorBundleSha256, authorization_sha256: authorizationSha256 };
}

async function runtimePolicy(file) {
  const raw = await readFile(file);
  if (sha256(raw) !== RELEASE_RUNTIME_POLICY_SHA256) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const value = parseStrictJson(raw.toString("utf8"), 256 * 1024);
  if (!Array.isArray(value?.services)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const references = {};
  for (const service of ["caddy", "postgres"]) {
    const entries = value.services.filter((entry) => entry?.service === service);
    if (entries.length !== 1 || entries[0]?.image?.kind !== "fixed" || !IMAGE_REFERENCE.test(entries[0]?.image?.reference || "")) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    references[service] = entries[0].image.reference;
  }
  return { sha256: RELEASE_RUNTIME_POLICY_SHA256, references };
}

function exactImageIdentity(reference, row) {
  const lines = docker(["image", "inspect", "--format", IMAGE_INSPECT_FORMAT, "--", reference], "POSTDEPLOY_IMAGE_INSPECTION_FAILED").trim().split("\n").filter(Boolean);
  if (lines.length !== 1) reject("POSTDEPLOY_IMAGE_INSPECTION_FAILED");
  const fields = lines[0].split("|");
  if (fields.length !== 5) reject("POSTDEPLOY_IMAGE_INSPECTION_FAILED");
  const [imageId, imageOs, imageArchitecture, repoDigestsRaw, descriptorRaw] = fields;
  let repoDigests; let descriptor;
  try { repoDigests = parseStrictJson(repoDigestsRaw, 64 * 1024); descriptor = parseStrictJson(descriptorRaw, 64 * 1024); } catch { reject("POSTDEPLOY_IMAGE_INSPECTION_FAILED"); }
  const expectedDigest = reference.slice(reference.lastIndexOf("@") + 1);
  if (imageId !== row?.Image || imageId !== expectedDigest || descriptor?.digest !== expectedDigest || imageOs !== "linux" || imageArchitecture !== "amd64" || !Array.isArray(repoDigests) || !repoDigests.includes(reference)) reject("POSTDEPLOY_IMAGE_MISMATCH");
  return imageId;
}

function boolean(value, code) {
  if (typeof value !== "boolean") reject(code);
  return value;
}

export function normalizePostDeployInspectRows({ rows, inventoryIds, composeProject, selectors, expectedReferences, expectedVersion, expectedRevision, imageIdentity = exactImageIdentity }) {
  if (!Array.isArray(rows) || rows.length !== SERVICES.length || !Array.isArray(inventoryIds) || inventoryIds.length !== SERVICES.length) reject("POSTDEPLOY_SERVICE_SET_INVALID");
  const inventory = [...inventoryIds].sort(); const states = [];
  for (let index = 0; index < SERVICES.length; index += 1) {
    const service = SERVICES[index]; const row = rows[index];
    const selectorMatches = CONTAINER_ID.test(selectors[service] || "") ? row?.Id === selectors[service] : row?.Name === `/${selectors[service]}`;
    if (!row || typeof row !== "object" || Array.isArray(row) || !CONTAINER_ID.test(row.Id || "") || !selectorMatches) reject("POSTDEPLOY_CONTAINER_ID_INVALID");
    const labels = row?.Config?.Labels;
    if (!labels || labels["com.docker.compose.project"] !== composeProject || labels["com.docker.compose.service"] !== service || row.Config.Image !== expectedReferences[service]) reject("POSTDEPLOY_COMPOSE_IDENTITY_INVALID");
    const imageId = imageIdentity(expectedReferences[service], row);
    if (["web", "worker"].includes(service) && (labels["org.opencontainers.image.version"] !== expectedVersion || labels["org.opencontainers.image.revision"] !== expectedRevision)) reject("POSTDEPLOY_IMAGE_SOURCE_MISMATCH");
    const state = row.State;
    if (!state || typeof row.RestartCount !== "number" || !Number.isSafeInteger(row.RestartCount)) reject("POSTDEPLOY_RUNTIME_STATE_INVALID");
    states.push({
      service,
      container_id: row.Id,
      image_id: imageId,
      image_reference: expectedReferences[service],
      restart_count: row.RestartCount,
      oom_killed: boolean(state.OOMKilled, "POSTDEPLOY_RUNTIME_STATE_INVALID"),
      running: boolean(state.Running, "POSTDEPLOY_RUNTIME_STATE_INVALID"),
      restarting: boolean(state.Restarting, "POSTDEPLOY_RUNTIME_STATE_INVALID"),
      paused: boolean(state.Paused, "POSTDEPLOY_RUNTIME_STATE_INVALID"),
      dead: boolean(state.Dead, "POSTDEPLOY_RUNTIME_STATE_INVALID"),
      status: state.Status,
      health: state.Health?.Status || "none",
      healthcheck_present: row.Config.Healthcheck !== null && row.Config.Healthcheck !== undefined,
    });
  }
  if (canonicalJson(states.map((state) => state.container_id).sort()) !== canonicalJson(inventory)) reject("POSTDEPLOY_SERVICE_SET_INVALID");
  return validatePostDeployRuntimeServices(states);
}

export function inspectPostDeployRuntime({ composeProject, selectors, expectedReferences, expectedVersion, expectedRevision }) {
  const inventoryIds = docker(["ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${composeProject}`], "POSTDEPLOY_RUNTIME_INVENTORY_FAILED").split(/\s+/).filter(Boolean);
  const names = SERVICES.map((service) => selectors[service]);
  const lines = docker(["inspect", "--format", CONTAINER_INSPECT_FORMAT, "--", ...names], "POSTDEPLOY_RUNTIME_INSPECTION_FAILED").trim().split("\n").filter(Boolean);
  if (lines.length !== SERVICES.length) reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED");
  const rows = lines.map((line) => {
    const fields = line.split("|");
    if (fields.length !== 17) reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED");
    const [Id, Name, Image, imageReference, composeLabel, serviceLabel, versionLabel, revisionLabel, restartCount, oomKilled, running, restarting, paused, dead, status, health, healthcheck] = fields;
    if (!/^\d+$/.test(restartCount) || ![oomKilled, running, restarting, paused, dead, healthcheck].every((item) => ["true", "false"].includes(item))) reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED");
    return {
      Id,
      Name,
      Image,
      RestartCount: Number(restartCount),
      Config: {
        Image: imageReference,
        Labels: {
          "com.docker.compose.project": composeLabel,
          "com.docker.compose.service": serviceLabel,
          "org.opencontainers.image.version": versionLabel,
          "org.opencontainers.image.revision": revisionLabel,
        },
        Healthcheck: healthcheck === "true" ? { present: true } : null,
      },
      State: {
        OOMKilled: oomKilled === "true",
        Running: running === "true",
        Restarting: restarting === "true",
        Paused: paused === "true",
        Dead: dead === "true",
        Status: status,
        ...(health === "none" ? {} : { Health: { Status: health } }),
      },
    };
  });
  return normalizePostDeployInspectRows({ rows, inventoryIds, composeProject, selectors, expectedReferences, expectedVersion, expectedRevision });
}

export function normalizeReadinessResponse(value) {
  exactKeys(value, ["ok", "status", "database", "storage", "worker", "deployment_class", "deployment_id", "version", "revision", "migration_head", "migration_manifest_sha256", "components", "time"], "POSTDEPLOY_READINESS_RESPONSE_FIELDS_INVALID");
  if (value.ok !== true || value.status !== "READY" || value.database !== "postgresql" || value.storage !== "local" || value.worker !== "postgresql-jobs") reject("POSTDEPLOY_READINESS_RESPONSE_INVALID");
  return validatePostDeployReadiness({ deployment_class: value.deployment_class, deployment_id: value.deployment_id, version: value.version, revision: value.revision, migration_head: value.migration_head, migration_manifest_sha256: value.migration_manifest_sha256, database_time: value.time, components: value.components });
}

export function assertPostDeployReadinessStable(baseline, current) {
  validatePostDeployReadiness(baseline);
  validatePostDeployReadiness(current);
  const baselineIdentity = { ...baseline, database_time: null };
  const currentIdentity = { ...current, database_time: null };
  if (canonicalJson(baselineIdentity) !== canonicalJson(currentIdentity) || Date.parse(current.database_time) < Date.parse(baseline.database_time)) reject("POSTDEPLOY_READINESS_DRIFT");
  return current;
}

export function inspectPostDeployReadiness(webContainerId) {
  if (!CONTAINER_ID.test(webContainerId || "")) reject("POSTDEPLOY_WEB_CONTAINER_INVALID");
  const source = "fetch('http://127.0.0.1:3000/api/health',{redirect:'error'}).then(async response=>{const text=await response.text();if(!response.ok)process.exit(41);process.stdout.write(text)}).catch(()=>process.exit(42))";
  const raw = docker(["exec", "--", webContainerId, "node", "-e", source], "POSTDEPLOY_READINESS_REQUEST_FAILED", { maximum: 1024 * 1024 });
  return normalizeReadinessResponse(parseStrictJson(raw, 1024 * 1024));
}

function selectorsFromReceipt(receipt) {
  return Object.fromEntries(receipt.services.map((state) => [state.service, state.container_id]));
}

function expectedReferencesFromReceipt(receipt) {
  return Object.fromEntries(receipt.services.map((state) => [state.service, state.image_reference]));
}

function preparedReceiptFilename(runId) {
  if (!IDENTIFIER.test(runId || "") || runId.length > 101) reject("POSTDEPLOY_RUN_ID_INVALID");
  return `.${runId}${PREPARED_SUFFIX}`;
}

function publishedReceiptFilename(runId) {
  if (!IDENTIFIER.test(runId || "") || runId.length > 101) reject("POSTDEPLOY_RUN_ID_INVALID");
  return `${runId}.postdeploy-receipt.json`;
}

async function recoverableReceiptPublication({ root, runId }) {
  return readRecoverableJsonPublication({
    root,
    preparedFilename: preparedReceiptFilename(runId),
    filename: publishedReceiptFilename(runId),
    validator: validatePostDeployReceipt,
    code: "POSTDEPLOY_RECEIPT_PUBLICATION_INVALID",
  });
}

function assertRecoveredReceiptBinding({ publication, runId, deploymentClass, deploymentId, composeProject, manifest, manifestSha256, control, policy }) {
  const receipt = publication.value;
  const rebuilt = buildPostDeployReceipt({
    runId,
    generatedAt: receipt.generated_at,
    deploymentClass,
    deploymentId,
    composeProject,
    manifest,
    manifestSha256,
    supervisorBundleSha256: control.supervisor_bundle_sha256,
    authorizationSha256: control.authorization_sha256,
    runtimePolicySha256: policy.sha256,
    services: receipt.services,
    readiness: receipt.readiness,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(receipt)) reject("POSTDEPLOY_RECOVERED_RECEIPT_MISMATCH");
  return receipt;
}

export async function preparePostDeployVerification(options) {
  validateRuntimeGuardBinding({ contract: options.runtimeGuardContract, mode: options.runtimeGuardMode }, POST_DEPLOY_RUNTIME_GUARD_MODE, "POSTDEPLOY_RUNTIME_GUARD_INVALID");
  const control = options.control || supervisorControl(options.environment);
  verifyGlobalLock(options.environment);
  const now = options.now || new Date();
  const policy = await runtimePolicy(options.runtimePolicyFile);
  const manifest = await loadReleaseManifest({ file: options.manifestFile, expectedSha256: options.manifestSha256, requireEligible: true, trusted: true, now });
  const expectedReferences = { caddy: policy.references.caddy, postgres: policy.references.postgres, web: manifest.images.web.image_reference, worker: manifest.images.worker.image_reference };
  const publication = await recoverableReceiptPublication({ root: options.postdeployRoot, runId: options.runId });
  let receipt; let receiptSha256; let publicationState;
  if (publication === null) {
    const services = inspectPostDeployRuntime({ composeProject: options.composeProject, selectors: options.selectors, expectedReferences, expectedVersion: manifest.source.package_version, expectedRevision: manifest.source.git_commit });
    const readiness = inspectPostDeployReadiness(services.find((state) => state.service === "web").container_id);
    receipt = buildPostDeployReceipt({ runId: options.runId, generatedAt: now.toISOString(), deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, manifest, manifestSha256: options.manifestSha256, supervisorBundleSha256: control.supervisor_bundle_sha256, authorizationSha256: control.authorization_sha256, runtimePolicySha256: policy.sha256, services, readiness });
    receiptSha256 = sha256(canonicalJson(receipt));
    await writePreparedJsonArtifact({ root: options.postdeployRoot, filename: preparedReceiptFilename(options.runId), value: receipt });
    publicationState = "PREPARED";
  } else {
    receipt = assertRecoveredReceiptBinding({ publication, runId: options.runId, deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, manifest, manifestSha256: options.manifestSha256, control, policy });
    receiptSha256 = publication.sha256;
    publicationState = publication.state;
    const services = inspectPostDeployRuntime({ composeProject: options.composeProject, selectors: selectorsFromReceipt(receipt), expectedReferences, expectedVersion: manifest.source.package_version, expectedRevision: manifest.source.git_commit });
    const readiness = inspectPostDeployReadiness(services.find((state) => state.service === "web").container_id);
    buildPostDeployReceipt({ runId: options.runId, generatedAt: now.toISOString(), deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, manifest, manifestSha256: options.manifestSha256, supervisorBundleSha256: control.supervisor_bundle_sha256, authorizationSha256: control.authorization_sha256, runtimePolicySha256: policy.sha256, services, readiness });
    if (canonicalJson(services) !== canonicalJson(receipt.services)) reject("POSTDEPLOY_RUNTIME_DRIFT");
    assertPostDeployReadinessStable(receipt.readiness, readiness);
  }
  const identity = buildReleaseIdentityFromPostDeployReceipt({ receipt, receiptSha256 });
  const preparedIdentity = await prepareReleaseIdentity({ root: options.identityRoot, readerGid: options.readerGid, identity, transactionId: control.authorization_sha256, authorizationSha256: control.authorization_sha256 });
  if (preparedIdentity.already_published && publicationState === "PREPARED") {
    await publishPreparedJsonArtifact({ root: options.postdeployRoot, preparedFilename: preparedReceiptFilename(options.runId), expectedSha256: receiptSha256, filename: publishedReceiptFilename(options.runId), validator: validatePostDeployReceipt });
    publicationState = "PUBLISHED";
  }
  return { receipt, receiptSha256, publicationState, identity, preparedIdentity };
}

export async function commitPostDeployVerification(options) {
  const control = options.control || supervisorControl(options.environment); verifyGlobalLock(options.environment);
  if (control.authorization_sha256 !== options.authorizationSha256) reject("POSTDEPLOY_AUTHORIZATION_MISMATCH");
  await runtimePolicy(options.runtimePolicyFile);
  const publication = await recoverableReceiptPublication({ root: options.postdeployRoot, runId: options.runId });
  if (publication === null || publication.sha256 !== options.receiptSha256) reject("POSTDEPLOY_PREPARED_RECEIPT_INVALID");
  const receipt = publication.value;
  if (canonicalJson(receipt.control) !== canonicalJson(control) || receipt.run_id !== options.runId) reject("POSTDEPLOY_PREPARED_CONTROL_MISMATCH");
  const services = inspectPostDeployRuntime({ composeProject: receipt.deployment.compose_project, selectors: selectorsFromReceipt(receipt), expectedReferences: expectedReferencesFromReceipt(receipt), expectedVersion: receipt.source.application_version, expectedRevision: receipt.source.git_commit });
  const readiness = inspectPostDeployReadiness(services.find((state) => state.service === "web").container_id);
  if (canonicalJson(services) !== canonicalJson(receipt.services)) reject("POSTDEPLOY_RUNTIME_DRIFT");
  assertPostDeployReadinessStable(receipt.readiness, readiness);
  const finalFilename = publishedReceiptFilename(options.runId);
  if (publication.state === "PREPARED") await publishPreparedJsonArtifact({ root: options.postdeployRoot, preparedFilename: preparedReceiptFilename(options.runId), expectedSha256: options.receiptSha256, filename: finalFilename, validator: validatePostDeployReceipt });
  const identity = await commitPreparedReleaseIdentity({ root: options.identityRoot, readerGid: options.readerGid, transactionId: control.authorization_sha256, authorizationSha256: control.authorization_sha256 });
  return { receipt, receiptFilename: finalFilename, identity };
}

export async function abortPostDeployVerification(options) {
  const publication = await recoverableReceiptPublication({ root: options.postdeployRoot, runId: options.runId });
  if (publication !== null && publication.sha256 !== options.receiptSha256) reject("POSTDEPLOY_PREPARED_RECEIPT_INVALID");
  if (publication?.state === "PREPARED") await discardPreparedJsonArtifact({ root: options.postdeployRoot, preparedFilename: preparedReceiptFilename(options.runId), expectedSha256: options.receiptSha256, validator: validatePostDeployReceipt });
  try { await abortPreparedReleaseIdentity({ root: options.identityRoot, readerGid: options.readerGid, transactionId: options.authorizationSha256, authorizationSha256: options.authorizationSha256 }); }
  catch (error) { if (!["ENOENT", "RELEASE_TRANSACTION_ROOT_INVALID"].includes(error?.code)) throw error; }
}

async function main() {
  const [command, ...args] = process.argv.slice(2); const options = cliOptions(args);
  if (typeof process.getuid !== "function" || process.getuid() !== 0) reject("POSTDEPLOY_ROOT_REQUIRED");
  const control = supervisorControl(process.env); verifyGlobalLock(process.env);
  if (command === "prepare") {
    const expected = ["--manifest", "--manifest-sha256", "--postdeploy-root", "--identity-root", "--reader-gid", "--run-id", "--runtime-guard-contract", "--runtime-guard-mode", "--deployment-class", "--deployment-id", "--compose-project", "--caddy-container", "--postgres-container", "--web-container", "--worker-container", "--runtime-policy", "--confirm"];
    if (Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key)) || options["--confirm"] !== "PREPARE_EXACT_POSTDEPLOY_VERIFICATION") reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
    const selectors = Object.fromEntries(SERVICES.map((service) => [service, options[`--${service}-container`]]));
    const outcome = await preparePostDeployVerification({ manifestFile: options["--manifest"], manifestSha256: options["--manifest-sha256"], postdeployRoot: options["--postdeploy-root"], identityRoot: options["--identity-root"], readerGid: options["--reader-gid"], runId: options["--run-id"], runtimeGuardContract: options["--runtime-guard-contract"], runtimeGuardMode: options["--runtime-guard-mode"], deploymentClass: options["--deployment-class"], deploymentId: options["--deployment-id"], composeProject: options["--compose-project"], selectors, runtimePolicyFile: options["--runtime-policy"], control, environment: process.env });
    process.stdout.write(`${JSON.stringify({ result: outcome.preparedIdentity.already_published ? "ALREADY_PUBLISHED" : "PREPARED", receipt_sha256: outcome.receiptSha256 })}\n`);
    return;
  }
  const expected = ["--postdeploy-root", "--identity-root", "--reader-gid", "--run-id", "--receipt-sha256", "--authorization-sha256", "--runtime-policy", "--confirm"];
  if (!["commit", "abort"].includes(command) || Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key))) reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
  if (options["--authorization-sha256"] !== control.authorization_sha256) reject("POSTDEPLOY_AUTHORIZATION_MISMATCH");
  const common = { postdeployRoot: options["--postdeploy-root"], identityRoot: options["--identity-root"], readerGid: options["--reader-gid"], runId: options["--run-id"], receiptSha256: options["--receipt-sha256"], authorizationSha256: options["--authorization-sha256"], runtimePolicyFile: options["--runtime-policy"], control, environment: process.env };
  if (command === "abort") {
    if (options["--confirm"] !== "ABORT_EXACT_POSTDEPLOY_VERIFICATION") reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
    await abortPostDeployVerification(common); process.stdout.write('{"result":"ABORTED"}\n'); return;
  }
  if (options["--confirm"] !== "COMMIT_EXACT_POSTDEPLOY_VERIFICATION") reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
  const outcome = await commitPostDeployVerification(common);
  process.stdout.write(`${JSON.stringify({ result: "COMMITTED", receipt_file: outcome.receiptFilename, receipt_sha256: options["--receipt-sha256"] })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`${typeof error?.code === "string" ? error.code : "POSTDEPLOY_INTERNAL_ERROR"}\n`); process.exitCode = 1; });
}
