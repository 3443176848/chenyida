import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  validateRuntimeGuardBinding,
} from "./release-lifecycle-contract.mjs";
import {
  canonicalJson,
  loadReleaseManifest,
  sha256,
} from "./release-manifest-contract.mjs";
import { validatePostDeployRuntimeServices } from "./postdeploy-release-contract.mjs";
import {
  inspectPostDeployRuntime,
  loadPostDeployRuntimePolicy,
  verifyAuthorizedComposeProjectRoot,
} from "./postdeploy-release-verifier.mjs";

export const POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_CONTRACT = "chenyida-erp-postdeploy-runtime-configuration-probe/v1";
export const POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_ROOT = "/var/lib/chenyida-erp/runtime-probes";
export const POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_MARKER = ".chenyida-erp-runtime-probe-root-v1";
export const POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_MARKER_VALUE = "chenyida-erp-runtime-probe-root/v1\n";

const RELEASE_GATE_LOCK_FILE = "/run/lock/chenyida-erp-release-gate-v1.lock";
const RUNTIME_SECRET_POLICY_SHA256 = "8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5";
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SERVICES = Object.freeze(["caddy", "postgres", "web", "worker"]);
const MAX_RECEIPT_BYTES = 64 * 1024;

export class RuntimeConfigurationProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimeConfigurationProbeError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimeConfigurationProbeError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]));
  }
  return value;
}

export function canonicalRuntimeConfigurationProbeJson(value) {
  return `${JSON.stringify(sortedJsonValue(value))}\n`;
}

function identifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) reject(code);
  return value;
}

function digest(value, code) {
  if (typeof value !== "string" || !SHA256.test(value)) reject(code);
  return value;
}

function absolutePath(value, code) {
  if (typeof value !== "string" || value.length > 4096 || !path.isAbsolute(value) || value === path.parse(value).root || path.normalize(value) !== value) reject(code);
  return value;
}

function timestamp(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) reject(code);
  return new Date(value);
}

function supervisorControl(environment = process.env) {
  if (environment.ERP_RELEASE_SUPERVISOR_LAUNCHED !== "YES") reject("RUNTIME_CONFIGURATION_PROBE_SUPERVISOR_REQUIRED");
  const supervisorBundleSha256 = environment.ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256;
  const authorizationSha256 = environment.ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256;
  digest(supervisorBundleSha256, "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  digest(authorizationSha256, "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  return Object.freeze({ supervisor_bundle_sha256: supervisorBundleSha256, authorization_sha256: authorizationSha256 });
}

function verifyGlobalLock(environment = process.env) {
  if (environment.ERP_RELEASE_GATE_LOCK_HELD !== "YES") reject("RUNTIME_CONFIGURATION_PROBE_GLOBAL_LOCK_REQUIRED");
  const result = spawnSync("/usr/bin/flock", ["-n", RELEASE_GATE_LOCK_FILE, "/bin/true"], { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  if (result.status === 0) reject("RUNTIME_CONFIGURATION_PROBE_GLOBAL_LOCK_NOT_HELD");
  if (result.status !== 1) reject("RUNTIME_CONFIGURATION_PROBE_GLOBAL_LOCK_INVALID");
}

function validateSelectors(value) {
  exactKeys(value, SERVICES, "RUNTIME_CONFIGURATION_PROBE_SELECTORS_INVALID");
  const selectors = SERVICES.map((service) => identifier(value[service], "RUNTIME_CONFIGURATION_PROBE_SELECTORS_INVALID"));
  if (new Set(selectors).size !== SERVICES.length) reject("RUNTIME_CONFIGURATION_PROBE_SELECTORS_INVALID");
  return value;
}

export function createRuntimeConfigurationProbeReceipt({
  probeId,
  probedAt,
  deploymentClass,
  deploymentId,
  composeProject,
  composeProjectRoot,
  manifest,
  manifestSha256,
  runtimeGuardContract,
  runtimeGuardMode,
  runtimePolicySha256,
  selectors,
  runtime,
  control,
}) {
  identifier(probeId, "RUNTIME_CONFIGURATION_PROBE_ID_INVALID");
  if (probeId.length > 101) reject("RUNTIME_CONFIGURATION_PROBE_ID_INVALID");
  const probed = timestamp(probedAt, "RUNTIME_CONFIGURATION_PROBE_TIME_INVALID");
  if (!manifest?.source || !GIT_OBJECT.test(manifest.source.git_commit || "") || typeof manifest.source.package_version !== "string") reject("RUNTIME_CONFIGURATION_PROBE_RELEASE_INVALID");
  digest(manifestSha256, "RUNTIME_CONFIGURATION_PROBE_RELEASE_INVALID");
  validateRuntimeGuardBinding({ contract: runtimeGuardContract, mode: runtimeGuardMode }, POST_DEPLOY_RUNTIME_GUARD_MODE, "RUNTIME_CONFIGURATION_PROBE_RUNTIME_GUARD_INVALID");
  digest(runtimePolicySha256, "RUNTIME_CONFIGURATION_PROBE_POLICY_INVALID");
  validateSelectors(selectors);
  exactKeys(control, ["supervisor_bundle_sha256", "authorization_sha256"], "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  digest(control.supervisor_bundle_sha256, "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  digest(control.authorization_sha256, "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  if (!["UAT", "PRODUCTION"].includes(deploymentClass) || deploymentId !== composeProject || composeProject !== "chenyida-erp") reject("RUNTIME_CONFIGURATION_PROBE_DEPLOYMENT_INVALID");
  absolutePath(composeProjectRoot, "RUNTIME_CONFIGURATION_PROBE_PROJECT_ROOT_INVALID");
  const services = validatePostDeployRuntimeServices(runtime?.services);
  digest(runtime?.runtime_configuration_sha256, "RUNTIME_CONFIGURATION_PROBE_RUNTIME_INVALID");
  return Object.freeze({
    schema_version: 1,
    contract: POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_CONTRACT,
    probe_id: probeId,
    probed_at: probed.toISOString(),
    expires_at: new Date(probed.getTime() + 60 * 60 * 1000).toISOString(),
    control: Object.freeze({ ...control }),
    deployment: Object.freeze({ class: deploymentClass, id: deploymentId, compose_project: composeProject }),
    release: Object.freeze({ manifest_sha256: manifestSha256, git_commit: manifest.source.git_commit, package_version: manifest.source.package_version }),
    runtime_guard: Object.freeze({ contract: runtimeGuardContract, mode: runtimeGuardMode }),
    runtime_policy_sha256: runtimePolicySha256,
    runtime_secret_policy_sha256: RUNTIME_SECRET_POLICY_SHA256,
    runtime_configuration_sha256: runtime.runtime_configuration_sha256,
    compose_project_root_sha256: sha256(Buffer.from(composeProjectRoot, "utf8")),
    selectors: Object.freeze({ ...selectors }),
    services,
  });
}

export function validateRuntimeConfigurationProbeReceipt(value, { now = new Date() } = {}) {
  exactKeys(value, [
    "schema_version", "contract", "probe_id", "probed_at", "expires_at", "control", "deployment", "release",
    "runtime_guard", "runtime_policy_sha256", "runtime_secret_policy_sha256", "runtime_configuration_sha256",
    "compose_project_root_sha256", "selectors", "services",
  ], "RUNTIME_CONFIGURATION_PROBE_RECEIPT_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_CONTRACT) reject("RUNTIME_CONFIGURATION_PROBE_RECEIPT_VERSION_INVALID");
  identifier(value.probe_id, "RUNTIME_CONFIGURATION_PROBE_ID_INVALID");
  if (value.probe_id.length > 101) reject("RUNTIME_CONFIGURATION_PROBE_ID_INVALID");
  const probed = timestamp(value.probed_at, "RUNTIME_CONFIGURATION_PROBE_TIME_INVALID");
  const expires = timestamp(value.expires_at, "RUNTIME_CONFIGURATION_PROBE_TIME_INVALID");
  if (expires.getTime() - probed.getTime() !== 60 * 60 * 1000 || probed.getTime() > now.getTime() + 5 * 60 * 1000 || now.getTime() >= expires.getTime()) reject("RUNTIME_CONFIGURATION_PROBE_TIME_INVALID");
  exactKeys(value.control, ["supervisor_bundle_sha256", "authorization_sha256"], "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  digest(value.control.supervisor_bundle_sha256, "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  digest(value.control.authorization_sha256, "RUNTIME_CONFIGURATION_PROBE_CONTROL_INVALID");
  exactKeys(value.deployment, ["class", "id", "compose_project"], "RUNTIME_CONFIGURATION_PROBE_DEPLOYMENT_INVALID");
  if (!["UAT", "PRODUCTION"].includes(value.deployment.class) || value.deployment.id !== "chenyida-erp" || value.deployment.compose_project !== "chenyida-erp") reject("RUNTIME_CONFIGURATION_PROBE_DEPLOYMENT_INVALID");
  exactKeys(value.release, ["manifest_sha256", "git_commit", "package_version"], "RUNTIME_CONFIGURATION_PROBE_RELEASE_INVALID");
  digest(value.release.manifest_sha256, "RUNTIME_CONFIGURATION_PROBE_RELEASE_INVALID");
  if (!GIT_OBJECT.test(value.release.git_commit || "") || typeof value.release.package_version !== "string" || value.release.package_version.length < 1 || value.release.package_version.length > 120) reject("RUNTIME_CONFIGURATION_PROBE_RELEASE_INVALID");
  exactKeys(value.runtime_guard, ["contract", "mode"], "RUNTIME_CONFIGURATION_PROBE_RUNTIME_GUARD_INVALID");
  validateRuntimeGuardBinding(value.runtime_guard, POST_DEPLOY_RUNTIME_GUARD_MODE, "RUNTIME_CONFIGURATION_PROBE_RUNTIME_GUARD_INVALID");
  digest(value.runtime_policy_sha256, "RUNTIME_CONFIGURATION_PROBE_POLICY_INVALID");
  if (value.runtime_secret_policy_sha256 !== RUNTIME_SECRET_POLICY_SHA256) reject("RUNTIME_CONFIGURATION_PROBE_SECRET_POLICY_INVALID");
  digest(value.runtime_configuration_sha256, "RUNTIME_CONFIGURATION_PROBE_RUNTIME_INVALID");
  digest(value.compose_project_root_sha256, "RUNTIME_CONFIGURATION_PROBE_PROJECT_ROOT_INVALID");
  validateSelectors(value.selectors);
  validatePostDeployRuntimeServices(value.services);
  return value;
}

async function trustedProbeRoot(root) {
  if (root !== POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_ROOT) reject("RUNTIME_CONFIGURATION_PROBE_ROOT_INVALID");
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== 0 || rootStat.gid !== 0 || (rootStat.mode & 0o777) !== 0o700) reject("RUNTIME_CONFIGURATION_PROBE_ROOT_INVALID");
  const marker = path.join(root, POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_MARKER);
  const markerStat = await lstat(marker).catch(() => null);
  if (!markerStat?.isFile() || markerStat.isSymbolicLink() || markerStat.uid !== 0 || markerStat.gid !== 0 || markerStat.nlink !== 1 || (markerStat.mode & 0o777) !== 0o400 || markerStat.size !== Buffer.byteLength(POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_MARKER_VALUE)) reject("RUNTIME_CONFIGURATION_PROBE_ROOT_INVALID");
  const markerHandle = await open(marker, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if ((await markerHandle.readFile()).toString("utf8") !== POSTDEPLOY_RUNTIME_CONFIGURATION_PROBE_MARKER_VALUE) reject("RUNTIME_CONFIGURATION_PROBE_ROOT_INVALID");
  } finally { await markerHandle.close(); }
  return root;
}

export function runtimeConfigurationProbeFilename(probeId) {
  identifier(probeId, "RUNTIME_CONFIGURATION_PROBE_ID_INVALID");
  if (probeId.length > 101) reject("RUNTIME_CONFIGURATION_PROBE_ID_INVALID");
  return `${probeId}.runtime-configuration-probe.json`;
}

async function writeProbeReceipt({ root, receipt }) {
  await trustedProbeRoot(root);
  const raw = Buffer.from(canonicalRuntimeConfigurationProbeJson(receipt), "utf8");
  if (raw.length < 2 || raw.length > MAX_RECEIPT_BYTES) reject("RUNTIME_CONFIGURATION_PROBE_RECEIPT_SIZE_INVALID");
  const target = path.join(root, runtimeConfigurationProbeFilename(receipt.probe_id));
  const temporary = path.join(root, `.${receipt.probe_id}.${process.pid}.tmp`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(raw);
    await handle.chmod(0o400);
    await handle.chown(0, 0);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, target);
    await unlink(temporary);
    const directory = await open(root, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (error instanceof RuntimeConfigurationProbeError) throw error;
    reject(error?.code === "EEXIST" ? "RUNTIME_CONFIGURATION_PROBE_ALREADY_EXISTS" : "RUNTIME_CONFIGURATION_PROBE_WRITE_FAILED");
  }
  return Object.freeze({ file: target, sha256: sha256(raw) });
}

export async function probePostDeployRuntimeConfiguration(options) {
  const control = options.control || supervisorControl(options.environment);
  verifyGlobalLock(options.environment);
  validateRuntimeGuardBinding({ contract: options.runtimeGuardContract, mode: options.runtimeGuardMode }, POST_DEPLOY_RUNTIME_GUARD_MODE, "RUNTIME_CONFIGURATION_PROBE_RUNTIME_GUARD_INVALID");
  const policy = await loadPostDeployRuntimePolicy(options.runtimePolicyFile);
  if (options.composeProject !== policy.compose_project || options.deploymentId !== policy.compose_project) reject("RUNTIME_CONFIGURATION_PROBE_DEPLOYMENT_INVALID");
  verifyAuthorizedComposeProjectRoot({ composeProjectRoot: options.composeProjectRoot, caddyfileSha256: policy.caddyfile_sha256 });
  const manifest = await loadReleaseManifest({ file: options.manifestFile, expectedSha256: options.manifestSha256, requireEligible: true, trusted: true, now: options.now || new Date() });
  const expectedReferences = { caddy: policy.references.caddy, postgres: policy.references.postgres, web: manifest.images.web.image_reference, worker: manifest.images.worker.image_reference };
  const runtime = (options.runtimeInspector || inspectPostDeployRuntime)({ composeProject: options.composeProject, composeProjectRoot: options.composeProjectRoot, composeVersion: policy.compose_version, selectors: options.selectors, expectedReferences, expectedMounts: policy.mounts, expectedTmpfs: policy.tmpfs, expectedRuntime: policy.runtime, expectedVolumeNames: policy.volume_names, appEnvironmentKeys: policy.app_environment_keys, expectedVersion: manifest.source.package_version, expectedRevision: manifest.source.git_commit, expectedManifestSha256: options.manifestSha256, expectedSupervisorBundleSha256: control.supervisor_bundle_sha256, expectedDeploymentClass: options.deploymentClass, expectedDeploymentId: options.deploymentId, readerGid: options.readerGid });
  const receipt = createRuntimeConfigurationProbeReceipt({ probeId: options.probeId, probedAt: (options.now || new Date()).toISOString(), deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, composeProjectRoot: options.composeProjectRoot, manifest, manifestSha256: options.manifestSha256, runtimeGuardContract: options.runtimeGuardContract, runtimeGuardMode: options.runtimeGuardMode, runtimePolicySha256: policy.sha256, selectors: options.selectors, runtime, control });
  validateRuntimeConfigurationProbeReceipt(receipt, { now: options.now || new Date() });
  const publication = await writeProbeReceipt({ root: options.probeRoot, receipt });
  return Object.freeze({ receipt, ...publication });
}

function cliOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!/^--[a-z0-9-]+$/.test(key || "") || value === undefined || Object.hasOwn(result, key)) reject("RUNTIME_CONFIGURATION_PROBE_CLI_INVALID");
    result[key] = value;
  }
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  const expected = ["--release-manifest", "--release-manifest-sha256", "--probe-root", "--probe-id", "--reader-gid", "--runtime-guard-contract", "--runtime-guard-mode", "--deployment-class", "--deployment-id", "--compose-project", "--compose-project-root", "--caddy-container", "--postgres-container", "--web-container", "--worker-container", "--runtime-policy", "--confirm"];
  if (command !== "probe" || Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key)) || options["--confirm"] !== "PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION" || typeof process.getuid !== "function" || process.getuid() !== 0) reject("RUNTIME_CONFIGURATION_PROBE_CLI_INVALID");
  const selectors = Object.fromEntries(SERVICES.map((service) => [service, options[`--${service}-container`]]));
  const outcome = await probePostDeployRuntimeConfiguration({ manifestFile: options["--release-manifest"], manifestSha256: options["--release-manifest-sha256"], probeRoot: options["--probe-root"], probeId: options["--probe-id"], readerGid: options["--reader-gid"], runtimeGuardContract: options["--runtime-guard-contract"], runtimeGuardMode: options["--runtime-guard-mode"], deploymentClass: options["--deployment-class"], deploymentId: options["--deployment-id"], composeProject: options["--compose-project"], composeProjectRoot: options["--compose-project-root"], selectors, runtimePolicyFile: options["--runtime-policy"], environment: process.env });
  process.stdout.write(`${canonicalJson({ result: "PROBED", probe_file: outcome.file, probe_sha256: outcome.sha256, runtime_configuration_sha256: outcome.receipt.runtime_configuration_sha256 })}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof RuntimeConfigurationProbeError || typeof error?.code === "string" ? error.code : "RUNTIME_CONFIGURATION_PROBE_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
