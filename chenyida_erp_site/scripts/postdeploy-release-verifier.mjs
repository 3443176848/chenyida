import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
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
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/;
const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]{0,127}$/;
const COMPOSE_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DEFAULT_SHM_BYTES = 64 * 1024 * 1024;
const DEFAULT_MASKED_PATHS = Object.freeze(["/proc/acpi", "/proc/asound", "/proc/interrupts", "/proc/kcore", "/proc/keys", "/proc/latency_stats", "/proc/sched_debug", "/proc/scsi", "/proc/timer_list", "/proc/timer_stats", "/sys/devices/virtual/powercap", "/sys/firmware"]);
const DEFAULT_READONLY_PATHS = Object.freeze(["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"]);
const RELEASE_GATE_LOCK_FILE = "/run/lock/chenyida-erp-release-gate-v1.lock";
const SERVICES = ["caddy", "postgres", "web", "worker"];
const POLICY_SERVICES = ["admin", "caddy", "migrate", "postgres", "web", "worker"];
const NETWORKS = ["backend", "edge"];
const PREPARED_SUFFIX = ".postdeploy-receipt.prepared.json";
const CONTAINER_INSPECT_FORMAT = '[{{json .Id}},{{json .Name}},{{json .Image}},{{json .Config.Image}},{{json (index .Config.Labels "com.docker.compose.project")}},{{json (index .Config.Labels "com.docker.compose.service")}},{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},{{json (index .Config.Labels "org.opencontainers.image.version")}},{{json (index .Config.Labels "org.opencontainers.image.revision")}},{{json (index .Config.Labels "com.docker.compose.container-number")}},{{json (index .Config.Labels "com.docker.compose.oneoff")}},{{json (index .Config.Labels "com.docker.compose.version")}},{{json (index .Config.Labels "com.docker.compose.image")}},{{json (index .Config.Labels "com.docker.compose.config-hash")}},{{json .RestartCount}},{{json .State.OOMKilled}},{{json .State.Running}},{{json .State.Restarting}},{{json .State.Paused}},{{json .State.Dead}},{{json .State.Status}},{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}},{{json (index .Config "Healthcheck")}},{{json (index .HostConfig "Tmpfs")}},{{json .Mounts}},{{json (index .Config "User")}},{{json (index .HostConfig "GroupAdd")}},{{json (index .HostConfig "Privileged")}},{{json (index .HostConfig "ReadonlyRootfs")}},{{json (index .HostConfig "CapAdd")}},{{json (index .HostConfig "CapDrop")}},{{json (index .HostConfig "SecurityOpt")}},{{json (index .HostConfig "NanoCpus")}},{{json (index .HostConfig "Memory")}},{{json (index .HostConfig "MemorySwap")}},{{json (index .HostConfig "PidsLimit")}},{{json (index .HostConfig "ShmSize")}},{{json (index .HostConfig "RestartPolicy")}},{{json (index .HostConfig "Init")}},{{json (index .HostConfig "AutoRemove")}},{{json (index .Config "StopTimeout")}},{{json (index .HostConfig "LogConfig")}},{{json (index .Config "Cmd")}},{{json (index .Config "Entrypoint")}},{{json (index .Config "WorkingDir")}},{{json (index .Config "StopSignal")}},{{json (index .HostConfig "PortBindings")}},{{json (index .NetworkSettings "Ports")}},{{json (index .HostConfig "NetworkMode")}},{{json (index .NetworkSettings "Networks")}},{{json (index .HostConfig "CgroupParent")}},{{json (index .HostConfig "CgroupnsMode")}},{{json (index .HostConfig "Dns")}},{{json (index .HostConfig "DnsOptions")}},{{json (index .HostConfig "DnsSearch")}},{{json (index .HostConfig "ExtraHosts")}},{{json (index .HostConfig "Devices")}},{{json (index .HostConfig "DeviceRequests")}},{{json (index .HostConfig "Runtime")}},{{json (index .HostConfig "IpcMode")}},{{json (index .HostConfig "PidMode")}},{{json (index .HostConfig "UTSMode")}},{{json (index .HostConfig "UsernsMode")}},{{json (index .HostConfig "OomKillDisable")}},{{json (index .HostConfig "OomScoreAdj")}},{{json (index .HostConfig "PublishAllPorts")}},{{json (index .HostConfig "Sysctls")}},{{json (index .HostConfig "Ulimits")}},{{json (index .HostConfig "VolumesFrom")}},{{json (index .HostConfig "Links")}},{{json (index .HostConfig "Isolation")}},{{json (index .HostConfig "MemoryReservation")}},{{json (index .HostConfig "CpuShares")}},{{json (index .HostConfig "CpuPeriod")}},{{json (index .HostConfig "CpuQuota")}},{{json (index .HostConfig "CpusetCpus")}},{{json (index .HostConfig "CpusetMems")}},{{json (index .HostConfig "BlkioWeight")}},{{json (index .HostConfig "MaskedPaths")}},{{json (index .HostConfig "ReadonlyPaths")}},{{json (index .Config "OpenStdin")}},{{json (index .Config "StdinOnce")}},{{json (index .Config "Tty")}},{{json .State.Pid}}]';
const IMAGE_INSPECT_FORMAT = '[{{json .Id}},{{json .Os}},{{json .Architecture}},{{json .RepoDigests}},{{json (index . "Descriptor")}},{{json (index .Config "Cmd")}},{{json (index .Config "Entrypoint")}},{{json (index .Config "WorkingDir")}},{{json (index .Config "StopSignal")}}]';
const NETWORK_INSPECT_FORMAT = '[{{json .Id}},{{json .Name}},{{json .Driver}},{{json .Scope}},{{json .Internal}},{{json .Attachable}},{{json .Ingress}},{{json .ConfigOnly}},{{json (index . "EnableIPv4")}},{{json .EnableIPv6}},{{json .Options}},{{json .Labels}},{{json .Containers}},{{json .IPAM}}]';
const ENVIRONMENT_KEYS_FORMAT = '{{range (index .Config "Env")}}{{println (index (split . "=") 0)}}{{end}}';
const SAFE_IMAGE_ENVIRONMENT_KEYS = Object.freeze(["ERP_RUNTIME_BUILD_VERSION", "ERP_RUNTIME_GIT_COMMIT"]);
const FIXED_ENVIRONMENT_VALUES = Object.freeze({
  ERP_ENV: "production",
  ERP_UPLOAD_ROOT: "/data/chenyida-erp/uploads",
  ERP_ATTACHMENT_ROOT: "/data/chenyida-erp/attachments",
  ERP_BACKUP_STATUS_FILE: "/data/chenyida-erp/backup-status/recovery-readiness.json",
});
const SERVICE_ENVIRONMENT_VALUES = Object.freeze({
  caddy: Object.freeze({ ERP_HTTPS_PORT: "443" }),
  postgres: Object.freeze({ POSTGRES_DB: "chenyida_erp", POSTGRES_PASSWORD_FILE: "/run/chenyida-erp-secrets/postgres-bootstrap-password", POSTGRES_USER: "postgres" }),
  web: Object.freeze({ ERP_PROCESS_NAME: "chenyida-erp-web", ERP_SERVICE_KIND: "WEB", NODE_OPTIONS: "--max-old-space-size=384", PORT: "3000" }),
  worker: Object.freeze({ ERP_PROCESS_NAME: "chenyida-erp-worker", ERP_SERVICE_KIND: "WORKER", ERP_WORKER_INSTANCE_FILE: "/tmp/chenyida-erp-worker-instance-id", NODE_OPTIONS: "--max-old-space-size=384" }),
});

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

export async function loadPostDeployRuntimePolicy(file) {
  const raw = await readFile(file);
  if (sha256(raw) !== RELEASE_RUNTIME_POLICY_SHA256) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const value = parseStrictJson(raw.toString("utf8"), 256 * 1024);
  if (!Array.isArray(value?.services) || !Array.isArray(value?.sources) || value?.project?.name !== "chenyida-erp"
    || typeof value?.parser?.docker_compose_version !== "string" || value.parser.docker_compose_version.length < 1
    || canonicalJson(value?.project?.services) !== canonicalJson(POLICY_SERVICES)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  if (canonicalJson(value?.project?.networks) !== canonicalJson(NETWORKS)
    || !Array.isArray(value?.project?.volumes) || value.project.volumes.length !== new Set(value.project.volumes).size
    || value.project.volumes.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(name))
    || !Array.isArray(value?.app_environment_keys)
    || value.app_environment_keys.length !== new Set(value.app_environment_keys).size
    || value.app_environment_keys.some((key) => typeof key !== "string" || !ENVIRONMENT_KEY.test(key))) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const references = {}; const mounts = {}; const tmpfs = {}; const runtime = {};
  const byService = new Map();
  for (const entry of value.services) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !POLICY_SERVICES.includes(entry.service) || byService.has(entry.service)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    byService.set(entry.service, entry);
  }
  if (byService.size !== POLICY_SERVICES.length || POLICY_SERVICES.some((service) => !byService.has(service))) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const expectedImageKinds = { admin: "worker_candidate", caddy: "fixed", migrate: "worker_candidate", postgres: "fixed", web: "web_candidate", worker: "worker_candidate" };
  for (const service of POLICY_SERVICES) {
    if (byService.get(service)?.image?.kind !== expectedImageKinds[service]) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  }
  for (const service of ["caddy", "postgres"]) {
    const entry = byService.get(service);
    if (entry?.image?.kind !== "fixed" || !IMAGE_REFERENCE.test(entry?.image?.reference || "")) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    references[service] = entry.image.reference;
  }
  for (const service of SERVICES) {
    const entry = byService.get(service);
    const expected = entry?.mounts;
    if (!Array.isArray(expected) || !Array.isArray(entry?.tmpfs) || !Array.isArray(entry?.groups)
      || !Array.isArray(entry?.cap_drop) || !Array.isArray(entry?.cap_add) || !Array.isArray(entry?.security_options)
      || !Array.isArray(entry?.ports) || !Array.isArray(entry?.networks) || !Array.isArray(entry?.environment_additions)
      || !Array.isArray(entry?.image_environment_keys)
      || !["app_release", "direct"].includes(entry?.environment_profile)
      || entry.networks.length < 1 || entry.networks.length !== new Set(entry.networks).size
      || entry.networks.some((network) => !NETWORKS.includes(network))
      || entry.environment_additions.length !== new Set(entry.environment_additions).size
      || entry.environment_additions.some((key) => typeof key !== "string" || !ENVIRONMENT_KEY.test(key))
      || entry.image_environment_keys.length < 1
      || entry.image_environment_keys.length !== new Set(entry.image_environment_keys).size
      || entry.image_environment_keys.some((key) => typeof key !== "string" || !ENVIRONMENT_KEY.test(key))
      || !entry.resources || !entry.lifecycle || !entry.logging || !entry.process) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    mounts[service] = expected.map((mount) => {
      exactKeys(mount, ["type", "source", "target", "read_only", "create_host_path"], "POSTDEPLOY_RUNTIME_POLICY_INVALID");
      if (!['bind', 'volume'].includes(mount.type) || typeof mount.source !== "string" || typeof mount.target !== "string" || typeof mount.read_only !== "boolean") reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
      return Object.freeze({ type: mount.type, source: mount.source, target: mount.target, read_only: mount.read_only });
    });
    tmpfs[service] = [...entry.tmpfs];
    runtime[service] = Object.freeze(entry);
  }
  const caddySources = value.sources.filter((entry) => entry?.path === "deploy/Caddyfile" && typeof entry?.sha256 === "string" && SHA256.test(entry.sha256));
  if (caddySources.length !== 1) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  return {
    sha256: RELEASE_RUNTIME_POLICY_SHA256,
    compose_project: value.project.name,
    compose_version: value.parser.docker_compose_version,
    app_environment_keys: Object.freeze([...value.app_environment_keys]),
    volume_names: Object.freeze([...value.project.volumes]),
    references,
    mounts,
    tmpfs,
    runtime,
    caddyfile_sha256: caddySources[0].sha256,
  };
}

function trustedProjectDirectory(directory) {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o022) !== 0) reject("POSTDEPLOY_COMPOSE_PROJECT_ROOT_INVALID");
}

export function verifyAuthorizedComposeProjectRoot({ composeProjectRoot, caddyfileSha256 }) {
  try {
    if (typeof composeProjectRoot !== "string" || composeProjectRoot.length > 4096 || !path.isAbsolute(composeProjectRoot)
      || composeProjectRoot === path.parse(composeProjectRoot).root || path.normalize(composeProjectRoot) !== composeProjectRoot
      || typeof caddyfileSha256 !== "string" || !SHA256.test(caddyfileSha256)) reject("POSTDEPLOY_COMPOSE_PROJECT_ROOT_INVALID");
    if (realpathSync.native(composeProjectRoot) !== composeProjectRoot) reject("POSTDEPLOY_COMPOSE_PROJECT_ROOT_INVALID");
    const parsed = path.parse(composeProjectRoot); let current = parsed.root;
    for (const component of composeProjectRoot.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, component); trustedProjectDirectory(current);
    }
    const deploy = path.join(composeProjectRoot, "deploy"); trustedProjectDirectory(deploy);
    const caddyfile = path.join(deploy, "Caddyfile");
    const before = lstatSync(caddyfile);
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1
      || (before.mode & 0o022) !== 0 || before.size < 1 || before.size > 1024 * 1024) reject("POSTDEPLOY_CADDYFILE_INVALID");
    const descriptor = openSync(caddyfile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_CLOEXEC);
    try {
      const opened = fstatSync(descriptor);
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid || opened.gid !== before.gid || opened.mode !== before.mode || opened.nlink !== before.nlink || opened.size !== before.size) reject("POSTDEPLOY_CADDYFILE_INVALID");
      const raw = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.uid !== opened.uid || after.gid !== opened.gid || after.mode !== opened.mode || after.nlink !== opened.nlink || after.size !== opened.size
        || sha256(raw) !== caddyfileSha256) reject("POSTDEPLOY_CADDYFILE_INVALID");
    } finally { closeSync(descriptor); }
    return caddyfile;
  } catch (error) {
    if (error instanceof PostDeployReleaseError) throw error;
    reject("POSTDEPLOY_COMPOSE_PROJECT_ROOT_INVALID");
  }
}

function parseSingleJsonArray(raw, length, code, maximum = 256 * 1024) {
  if (typeof raw !== "string") reject(code);
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) reject(code);
  let value;
  try { value = parseStrictJson(lines[0], maximum); } catch { reject(code); }
  if (!Array.isArray(value) || value.length !== length) reject(code);
  return value;
}

function normalizeEnvironmentKeys(raw, code) {
  if (typeof raw !== "string" || raw.length > 256 * 1024) reject(code);
  const keys = raw.split("\n").filter((line) => line.length > 0);
  if (keys.some((key) => !ENVIRONMENT_KEY.test(key)) || keys.length !== new Set(keys).size) reject(code);
  return keys.sort();
}

function safeEnvironmentFormat(keys) {
  if (!Array.isArray(keys) || keys.length < 1 || keys.some((key) => !ENVIRONMENT_KEY.test(key))) reject("POSTDEPLOY_ENVIRONMENT_INSPECTION_FAILED");
  const predicates = keys.map((key) => `(eq (index (split . "=") 0) "${key}")`);
  return `{{range (index .Config "Env")}}{{if ${predicates.length === 1 ? predicates[0] : `(or ${predicates.join(" ")})`}}}{{json .}}{{println}}{{end}}{{end}}`;
}

function normalizeSafeEnvironment(raw, allowedKeys, code) {
  if (typeof raw !== "string" || raw.length > 256 * 1024 || !Array.isArray(allowedKeys)) reject(code);
  const allowed = new Set(allowedKeys); const result = {};
  for (const line of raw.split("\n").filter(Boolean)) {
    let assignment;
    try { assignment = parseStrictJson(line, 16 * 1024); } catch { reject(code); }
    if (typeof assignment !== "string" || assignment.length > 8192) reject(code);
    const separator = assignment.indexOf("=");
    const key = separator > 0 ? assignment.slice(0, separator) : "";
    if (!allowed.has(key) || Object.hasOwn(result, key)) reject(code);
    result[key] = assignment.slice(separator + 1);
  }
  return result;
}

function inspectEnvironment(target, { image = false, safeKeys }) {
  const prefix = image ? ["image", "inspect"] : ["inspect"];
  const keyRaw = docker([...prefix, "--format", ENVIRONMENT_KEYS_FORMAT, "--", target], "POSTDEPLOY_ENVIRONMENT_INSPECTION_FAILED", { maximum: 256 * 1024 });
  const safeRaw = docker([...prefix, "--format", safeEnvironmentFormat(safeKeys), "--", target], "POSTDEPLOY_ENVIRONMENT_INSPECTION_FAILED", { maximum: 256 * 1024 });
  return {
    keys: normalizeEnvironmentKeys(keyRaw, "POSTDEPLOY_ENVIRONMENT_INSPECTION_FAILED"),
    safe: normalizeSafeEnvironment(safeRaw, safeKeys, "POSTDEPLOY_ENVIRONMENT_INSPECTION_FAILED"),
  };
}

export function normalizePostDeployImageIdentity({ fields, reference, rowImage, environmentKeys, expectedEnvironmentKeys, safeEnvironment }) {
  if (!Array.isArray(fields) || fields.length !== 9) reject("POSTDEPLOY_IMAGE_INSPECTION_FAILED");
  const [imageId, imageOs, imageArchitecture, repoDigests, descriptor, command, entrypoint, workingDirectory, stopSignal] = fields;
  const expectedDigest = reference.slice(reference.lastIndexOf("@") + 1);
  if (!IMAGE_REFERENCE.test(reference || "") || imageId !== rowImage || imageId !== expectedDigest || descriptor?.digest !== expectedDigest
    || imageOs !== "linux" || imageArchitecture !== "amd64" || !Array.isArray(repoDigests) || !repoDigests.includes(reference)
    || !Array.isArray(environmentKeys) || environmentKeys.some((key) => !ENVIRONMENT_KEY.test(key))
    || environmentKeys.length !== new Set(environmentKeys).size || !safeEnvironment || typeof safeEnvironment !== "object" || Array.isArray(safeEnvironment)) reject("POSTDEPLOY_IMAGE_MISMATCH");
  exactCanonical([...environmentKeys].sort(), normalizeStringList(expectedEnvironmentKeys, "POSTDEPLOY_IMAGE_MISMATCH"), "POSTDEPLOY_IMAGE_MISMATCH");
  for (const key of Object.keys(safeEnvironment)) if (!environmentKeys.includes(key) || !SAFE_IMAGE_ENVIRONMENT_KEYS.includes(key)) reject("POSTDEPLOY_IMAGE_MISMATCH");
  if (![null, ""].includes(workingDirectory) && (typeof workingDirectory !== "string" || !path.posix.isAbsolute(workingDirectory))) reject("POSTDEPLOY_IMAGE_MISMATCH");
  if (![null, ""].includes(stopSignal) && typeof stopSignal !== "string") reject("POSTDEPLOY_IMAGE_MISMATCH");
  for (const value of [command, entrypoint]) if (value !== null && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) reject("POSTDEPLOY_IMAGE_MISMATCH");
  return {
    image_id: imageId,
    image_config_digest: DIGEST.test(descriptor?.annotations?.["config.digest"] || "") ? descriptor.annotations["config.digest"] : null,
    environment_keys: [...environmentKeys].sort(),
    safe_environment: { ...safeEnvironment },
    defaults: { command, entrypoint, working_directory: workingDirectory || "", stop_signal: stopSignal || "" },
  };
}

function exactImageIdentity(reference, row, expectedEnvironmentKeys) {
  const fields = parseSingleJsonArray(
    docker(["image", "inspect", "--format", IMAGE_INSPECT_FORMAT, "--", reference], "POSTDEPLOY_IMAGE_INSPECTION_FAILED"),
    9,
    "POSTDEPLOY_IMAGE_INSPECTION_FAILED",
  );
  const environment = inspectEnvironment(reference, { image: true, safeKeys: SAFE_IMAGE_ENVIRONMENT_KEYS });
  return normalizePostDeployImageIdentity({ fields, reference, rowImage: row?.Image, environmentKeys: environment.keys, expectedEnvironmentKeys, safeEnvironment: environment.safe });
}

function boolean(value, code) {
  if (typeof value !== "boolean") reject(code);
  return value;
}

function absoluteNormalizedPath(value, code) {
  if (typeof value !== "string" || value.length > 4096 || !path.isAbsolute(value) || path.normalize(value) !== value) reject(code);
  return value;
}

function normalizeComposeResourceLabels(labels, { resourceKey, logicalName, composeProject, code }) {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) reject(code);
  const legacy = ["com.docker.compose.project", `com.docker.compose.${resourceKey}`, "com.docker.compose.version"];
  const modern = ["com.docker.compose.config-hash", ...legacy];
  const actual = Object.keys(labels || {}).sort();
  const isLegacy = canonicalJson(actual) === canonicalJson([...legacy].sort());
  const isModern = canonicalJson(actual) === canonicalJson([...modern].sort());
  if ((!isLegacy && !isModern)
    || labels["com.docker.compose.project"] !== composeProject
    || labels[`com.docker.compose.${resourceKey}`] !== logicalName
    || !COMPOSE_VERSION.test(labels["com.docker.compose.version"] || "")
    || (isModern && !SHA256.test(labels["com.docker.compose.config-hash"] || ""))) reject(code);
  return {
    created_with_compose_version: labels["com.docker.compose.version"],
    configuration_sha256: isModern ? labels["com.docker.compose.config-hash"] : null,
  };
}

export function normalizePostDeployVolumeIdentity({ volume, name, source, composeProject }) {
  if (!volume || typeof volume !== "object" || Array.isArray(volume)) reject("POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  exactKeys(volume, ["CreatedAt", "Driver", "Labels", "Mountpoint", "Name", "Options", "Scope"], "POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  const prefix = `${composeProject}_`; const logicalName = name.startsWith(prefix) ? name.slice(prefix.length) : "";
  const labelIdentity = normalizeComposeResourceLabels(volume.Labels, { resourceKey: "volume", logicalName, composeProject, code: "POSTDEPLOY_VOLUME_IDENTITY_INVALID" });
  const optionsEmpty = volume.Options === null || (volume.Options && typeof volume.Options === "object" && !Array.isArray(volume.Options) && Object.keys(volume.Options).length === 0);
  if (!logicalName || volume.Name !== name || volume.Driver !== "local" || volume.Scope !== "local" || !optionsEmpty
    || typeof volume.CreatedAt !== "string" || !Number.isFinite(Date.parse(volume.CreatedAt))
    || volume.Mountpoint !== source || absoluteNormalizedPath(volume.Mountpoint, "POSTDEPLOY_VOLUME_IDENTITY_INVALID") !== source
    || volume.Labels["com.docker.compose.project"] !== composeProject
    || volume.Labels["com.docker.compose.volume"] !== logicalName) reject("POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  return { name, logical_name: logicalName, created_at: volume.CreatedAt, mountpoint: volume.Mountpoint, ...labelIdentity };
}

function exactVolumeIdentity({ name, source, composeProject }) {
  const raw = docker(["volume", "inspect", "--format", "{{json .}}", "--", name], "POSTDEPLOY_VOLUME_INSPECTION_FAILED", { maximum: 256 * 1024 }).trim();
  if (!raw || raw.includes("\n")) reject("POSTDEPLOY_VOLUME_INSPECTION_FAILED");
  let volume;
  try { volume = parseStrictJson(raw, 256 * 1024); } catch { reject("POSTDEPLOY_VOLUME_INSPECTION_FAILED"); }
  return normalizePostDeployVolumeIdentity({ volume, name, source, composeProject });
}

export function verifyPostDeployBindMountIdentity({ pid, source, target }) {
  if (!Number.isSafeInteger(pid) || pid < 2) reject("POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
  absoluteNormalizedPath(source, "POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
  absoluteNormalizedPath(target, "POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
  const projected = `/proc/${pid}/root${target}`;
  let sourceDescriptor; let projectedDescriptor;
  try {
    const sourceMetadata = lstatSync(source, { bigint: true });
    const projectedMetadata = lstatSync(projected, { bigint: true });
    if (sourceMetadata.isSymbolicLink() || projectedMetadata.isSymbolicLink()
      || (!sourceMetadata.isFile() && !sourceMetadata.isDirectory())
      || sourceMetadata.isFile() !== projectedMetadata.isFile()
      || sourceMetadata.isDirectory() !== projectedMetadata.isDirectory()
      || realpathSync(source) !== source) reject("POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
    const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (sourceMetadata.isDirectory() ? fsConstants.O_DIRECTORY : 0);
    sourceDescriptor = openSync(source, flags);
    projectedDescriptor = openSync(projected, flags);
    const stableSource = fstatSync(sourceDescriptor, { bigint: true });
    const stableProjected = fstatSync(projectedDescriptor, { bigint: true });
    if (stableSource.dev !== sourceMetadata.dev || stableSource.ino !== sourceMetadata.ino
      || stableProjected.dev !== projectedMetadata.dev || stableProjected.ino !== projectedMetadata.ino
      || stableSource.dev !== stableProjected.dev || stableSource.ino !== stableProjected.ino) reject("POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
    return { source, target, device: stableSource.dev.toString(), inode: stableSource.ino.toString() };
  } catch (error) {
    if (error instanceof PostDeployReleaseError) throw error;
    reject("POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
  } finally {
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
    if (projectedDescriptor !== undefined) closeSync(projectedDescriptor);
  }
}

function normalizeRuntimeMounts(value, { pid, composeProject, composeVersion, volumeIdentity = exactVolumeIdentity, bindIdentity = verifyPostDeployBindMountIdentity, onVolumeIdentity = () => undefined, onBindIdentity = () => undefined } = {}) {
  if (!Array.isArray(value)) reject("POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  const normalized = value.map((mount) => {
    if (!mount || typeof mount !== "object" || Array.isArray(mount)
      || !["bind", "volume"].includes(mount.Type)
      || typeof mount.Source !== "string" || typeof mount.Destination !== "string"
      || typeof mount.RW !== "boolean") reject("POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
    absoluteNormalizedPath(mount.Source, "POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
    absoluteNormalizedPath(mount.Destination, "POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
    if (mount.Type === "volume") {
      exactKeys(mount, ["Type", "Name", "Source", "Destination", "Driver", "Mode", "RW", "Propagation"], "POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
      if (typeof mount.Name !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,254}$/.test(mount.Name) || mount.Driver !== "local"
        || mount.Mode !== (mount.RW ? "rw" : "ro") || mount.Propagation !== "") reject("POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
      onVolumeIdentity(volumeIdentity({ name: mount.Name, source: mount.Source, composeProject, composeVersion }));
      return { type: "volume", source: mount.Name, target: mount.Destination, read_only: !mount.RW };
    }
    exactKeys(mount, ["Type", "Source", "Destination", "Mode", "RW", "Propagation"], "POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
    if (mount.Mode !== (mount.RW ? "rw" : "ro") || mount.Propagation !== "rprivate") reject("POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
    onBindIdentity(bindIdentity({ pid, source: mount.Source, target: mount.Destination }));
    return { type: "bind", source: mount.Source, target: mount.Destination, read_only: !mount.RW };
  }).sort((left, right) => left.target.localeCompare(right.target));
  if (new Set(normalized.map((mount) => mount.target)).size !== normalized.length) reject("POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  return normalized;
}

function expectedRuntimeMounts(value, composeProject, composeProjectRoot) {
  if (!Array.isArray(value)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const normalized = value.map((mount) => {
    let source;
    if (mount.type === "volume") source = `${composeProject}_${mount.source}`;
    else if (mount.source === "$PROJECT_ROOT/deploy/Caddyfile") source = path.join(composeProjectRoot, "deploy", "Caddyfile");
    else {
      if (mount.source.includes("$")) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
      source = absoluteNormalizedPath(mount.source, "POSTDEPLOY_RUNTIME_POLICY_INVALID");
    }
    return { type: mount.type, source, target: mount.target, read_only: mount.read_only };
  }).sort((left, right) => left.target.localeCompare(right.target));
  if (new Set(normalized.map((mount) => mount.target)).size !== normalized.length) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  return normalized;
}

function normalizeTmpfsEntry(target, options, code) {
  absoluteNormalizedPath(target, code);
  if (typeof options !== "string" || options.length < 1 || options.length > 1024) reject(code);
  const seen = new Set(); const normalized = [];
  for (const option of options.split(",")) {
    if (!/^[a-z0-9]+(?:=[a-z0-9]+)?$/.test(option)) reject(code);
    const key = option.split("=", 1)[0];
    if (seen.has(key)) reject(code);
    seen.add(key); normalized.push(option);
  }
  return { target, options: normalized.sort() };
}

function normalizeRuntimeTmpfs(value) {
  if (value === null || value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("POSTDEPLOY_RUNTIME_TMPFS_INVALID");
  return Object.entries(value).map(([target, options]) => normalizeTmpfsEntry(target, options, "POSTDEPLOY_RUNTIME_TMPFS_INVALID")).sort((left, right) => left.target.localeCompare(right.target));
}

function expectedRuntimeTmpfs(value) {
  if (!Array.isArray(value)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const normalized = value.map((definition) => {
    if (typeof definition !== "string") reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    const separator = definition.indexOf(":");
    if (separator < 1) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    return normalizeTmpfsEntry(definition.slice(0, separator), definition.slice(separator + 1), "POSTDEPLOY_RUNTIME_POLICY_INVALID");
  }).sort((left, right) => left.target.localeCompare(right.target));
  if (new Set(normalized.map((entry) => entry.target)).size !== normalized.length) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  return normalized;
}

function exactCanonical(actual, expected, code) {
  if (canonicalJson(actual) !== canonicalJson(expected)) reject(code);
}

function normalizeStringList(value, code, { capability = false } = {}) {
  if (value === null || value === undefined) value = [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length < 1)) reject(code);
  const normalized = value.map((item) => capability ? item.toUpperCase().replace(/^CAP_/, "") : item).sort();
  if (normalized.length !== new Set(normalized).size) reject(code);
  return normalized;
}

function isEmptyList(value) {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function isEmptyMap(value) {
  return value === null || value === undefined || (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function durationNanoseconds(value, code) {
  if (value === null) return 0;
  if (typeof value !== "string") reject(code);
  const match = value.match(/^(\d+)(ns|us|ms|s|m|h)$/);
  if (!match) reject(code);
  const multiplier = { ns: 1, us: 1_000, ms: 1_000_000, s: 1_000_000_000, m: 60_000_000_000, h: 3_600_000_000_000 }[match[2]];
  const result = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(result) || result < 0) reject(code);
  return result;
}

function expectedHealthcheck(value) {
  if (value === null) return null;
  const expected = {
    Test: value.test.map((item) => item.replaceAll("$${", "${")),
    Interval: durationNanoseconds(value.interval, "POSTDEPLOY_RUNTIME_POLICY_INVALID"),
    Timeout: durationNanoseconds(value.timeout, "POSTDEPLOY_RUNTIME_POLICY_INVALID"),
    Retries: value.retries,
  };
  if (value.start_period !== null) expected.StartPeriod = durationNanoseconds(value.start_period, "POSTDEPLOY_RUNTIME_POLICY_INVALID");
  return expected;
}

function normalizeHealthcheck(value, expected) {
  if (expected === null) {
    if (value !== null && value !== undefined) reject("POSTDEPLOY_RUNTIME_HEALTHCHECK_INVALID");
    return null;
  }
  exactKeys(value, Object.keys(expected), "POSTDEPLOY_RUNTIME_HEALTHCHECK_INVALID");
  if (!Array.isArray(value.Test) || value.Test.some((item) => typeof item !== "string")
    || ![value.Interval, value.Timeout, value.Retries].every(Number.isSafeInteger)
    || (Object.hasOwn(expected, "StartPeriod") && !Number.isSafeInteger(value.StartPeriod))) reject("POSTDEPLOY_RUNTIME_HEALTHCHECK_INVALID");
  exactCanonical(value, expected, "POSTDEPLOY_RUNTIME_HEALTHCHECK_INVALID");
  return value;
}

function expectedPorts(value) {
  if (!Array.isArray(value)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  const result = {};
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !["tcp", "udp"].includes(entry.protocol)
      || !Number.isSafeInteger(entry.target) || entry.target < 1 || entry.target > 65535
      || typeof entry.host_ip !== "string" || isIP(entry.host_ip) !== 4
      || typeof entry.published_default !== "string" || !/^\d{1,5}$/.test(entry.published_default)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    const published = Number(entry.published_default);
    if (published < 1 || published > 65535) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    const key = `${entry.target}/${entry.protocol}`;
    if (Object.hasOwn(result, key)) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
    result[key] = [{ HostIp: entry.host_ip, HostPort: entry.published_default }];
  }
  return result;
}

function normalizePublishedPorts(value, { allowNullExtras }) {
  if (value === null || value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("POSTDEPLOY_RUNTIME_PORTS_INVALID");
  const result = {};
  for (const [key, bindings] of Object.entries(value)) {
    if (!/^\d{1,5}\/(?:tcp|udp)$/.test(key)) reject("POSTDEPLOY_RUNTIME_PORTS_INVALID");
    if (bindings === null && allowNullExtras) continue;
    if (!Array.isArray(bindings) || bindings.length !== 1) reject("POSTDEPLOY_RUNTIME_PORTS_INVALID");
    const binding = bindings[0];
    exactKeys(binding, ["HostIp", "HostPort"], "POSTDEPLOY_RUNTIME_PORTS_INVALID");
    if (typeof binding.HostIp !== "string" || isIP(binding.HostIp) !== 4 || typeof binding.HostPort !== "string" || !/^\d{1,5}$/.test(binding.HostPort)) reject("POSTDEPLOY_RUNTIME_PORTS_INVALID");
    result[key] = [{ HostIp: binding.HostIp, HostPort: binding.HostPort }];
  }
  return result;
}

function expectedEnvironmentKeys(service, policy, appEnvironmentKeys) {
  const keys = new Set(policy.image_environment_keys);
  for (const key of policy.environment_additions) keys.add(key);
  if (policy.environment_profile === "app_release") {
    for (const key of appEnvironmentKeys) keys.add(key);
    keys.add("ERP_RUNTIME_IMAGE_REFERENCE"); keys.add("ERP_RUNTIME_IMAGE_CONFIG_DIGEST");
  }
  const result = [...keys].sort();
  if (result.some((key) => !ENVIRONMENT_KEY.test(key))) reject("POSTDEPLOY_RUNTIME_POLICY_INVALID");
  return result;
}

function expectedControlledEnvironment({ service, environmentKeys, imageIdentity, expectedReference, expectedVersion, expectedRevision, expectedManifestSha256, expectedSupervisorBundleSha256, expectedDeploymentClass, expectedDeploymentId }) {
  const values = {
    ...FIXED_ENVIRONMENT_VALUES,
    ...(SERVICE_ENVIRONMENT_VALUES[service] || {}),
    ERP_DEPLOYMENT_CLASS: expectedDeploymentClass,
    ERP_RELEASE_EXPECTED_DEPLOYMENT_ID: expectedDeploymentId,
    ERP_RELEASE_EXPECTED_VERSION: expectedVersion,
    ERP_RELEASE_EXPECTED_GIT_COMMIT: expectedRevision,
    ERP_RELEASE_EXPECTED_MANIFEST_SHA256: expectedManifestSha256,
    ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256: expectedSupervisorBundleSha256,
    ERP_RUNTIME_BUILD_VERSION: expectedVersion,
    ERP_RUNTIME_GIT_COMMIT: expectedRevision,
    ERP_RUNTIME_IMAGE_REFERENCE: expectedReference,
    ERP_RUNTIME_IMAGE_CONFIG_DIGEST: imageIdentity.image_config_digest,
  };
  return Object.fromEntries(Object.keys(values).filter((key) => environmentKeys.includes(key)).map((key) => {
    if (!Object.hasOwn(values, key) || typeof values[key] !== "string") reject("POSTDEPLOY_RUNTIME_CONTROL_BINDING_INVALID");
    return [key, values[key]];
  }));
}

function validateEnvironmentProjection(options) {
  const { row, service, policy, appEnvironmentKeys, imageIdentity } = options;
  const keys = expectedEnvironmentKeys(service, policy, appEnvironmentKeys);
  exactCanonical(normalizeStringList(row.EnvironmentKeys, "POSTDEPLOY_RUNTIME_ENVIRONMENT_INVALID"), keys, "POSTDEPLOY_RUNTIME_ENVIRONMENT_INVALID");
  const expectedSafe = expectedControlledEnvironment({ ...options, environmentKeys: keys });
  if (!row.SafeEnvironment || typeof row.SafeEnvironment !== "object" || Array.isArray(row.SafeEnvironment)) reject("POSTDEPLOY_RUNTIME_ENVIRONMENT_INVALID");
  exactCanonical(Object.keys(row.SafeEnvironment).sort(), keys, "POSTDEPLOY_RUNTIME_ENVIRONMENT_INVALID");
  for (const [key, expected] of Object.entries(expectedSafe)) {
    const actual = row.SafeEnvironment[key];
    if (key === "ERP_DEPLOYMENT_CLASS") {
      if (typeof actual !== "string" || actual.toUpperCase() !== expected.toUpperCase()) reject("POSTDEPLOY_RUNTIME_CONTROL_BINDING_INVALID");
    } else if (actual !== expected) reject("POSTDEPLOY_RUNTIME_CONTROL_BINDING_INVALID");
  }
  const expectedImageSafe = ["web", "worker"].includes(service)
    ? { ERP_RUNTIME_BUILD_VERSION: options.expectedVersion, ERP_RUNTIME_GIT_COMMIT: options.expectedRevision }
    : {};
  exactCanonical(imageIdentity.safe_environment, expectedImageSafe, "POSTDEPLOY_IMAGE_SOURCE_MISMATCH");
  return Object.fromEntries(keys.map((key) => [key, row.SafeEnvironment[key]]));
}

function validateRuntimeProjection({ row, service, policy, imageIdentity, readerGid }) {
  const host = row.HostConfig; const config = row.Config;
  if (!host || !config) reject("POSTDEPLOY_RUNTIME_PROJECTION_INVALID");
  const expectedGroups = policy.groups.map((group) => group === "$RELEASE_IDENTITY_READER_GID" ? String(readerGid) : group).sort();
  if (config.User !== policy.user || host.Privileged !== false || host.ReadonlyRootfs !== policy.read_only_rootfs
    || host.AutoRemove !== false) reject("POSTDEPLOY_RUNTIME_SECURITY_INVALID");
  exactCanonical(normalizeStringList(host.GroupAdd, "POSTDEPLOY_RUNTIME_SECURITY_INVALID"), expectedGroups, "POSTDEPLOY_RUNTIME_SECURITY_INVALID");
  exactCanonical(normalizeStringList(host.CapAdd, "POSTDEPLOY_RUNTIME_SECURITY_INVALID", { capability: true }), [...policy.cap_add].sort(), "POSTDEPLOY_RUNTIME_SECURITY_INVALID");
  exactCanonical(normalizeStringList(host.CapDrop, "POSTDEPLOY_RUNTIME_SECURITY_INVALID", { capability: true }), [...policy.cap_drop].sort(), "POSTDEPLOY_RUNTIME_SECURITY_INVALID");
  exactCanonical(normalizeStringList(host.SecurityOpt, "POSTDEPLOY_RUNTIME_SECURITY_INVALID"), [...policy.security_options].sort(), "POSTDEPLOY_RUNTIME_SECURITY_INVALID");
  if (host.CgroupParent !== "" || host.CgroupnsMode !== "private" || host.Runtime !== "runc" || host.IpcMode !== "private"
    || host.PidMode !== "" || host.UTSMode !== "" || host.UsernsMode !== "" || host.Isolation !== ""
    || !isEmptyList(host.Dns) || !isEmptyList(host.DnsOptions) || !isEmptyList(host.DnsSearch) || !isEmptyList(host.ExtraHosts)
    || !isEmptyList(host.Devices) || !isEmptyList(host.DeviceRequests) || !isEmptyList(host.Ulimits)
    || !isEmptyList(host.VolumesFrom) || !isEmptyList(host.Links) || !isEmptyMap(host.Sysctls)
    || ![null, false].includes(host.OomKillDisable) || host.OomScoreAdj !== 0 || host.PublishAllPorts !== false
    || config.OpenStdin !== false || config.StdinOnce !== false || config.Tty !== false) reject("POSTDEPLOY_RUNTIME_ISOLATION_INVALID");
  exactCanonical(normalizeStringList(host.MaskedPaths, "POSTDEPLOY_RUNTIME_ISOLATION_INVALID"), [...DEFAULT_MASKED_PATHS].sort(), "POSTDEPLOY_RUNTIME_ISOLATION_INVALID");
  exactCanonical(normalizeStringList(host.ReadonlyPaths, "POSTDEPLOY_RUNTIME_ISOLATION_INVALID"), [...DEFAULT_READONLY_PATHS].sort(), "POSTDEPLOY_RUNTIME_ISOLATION_INVALID");

  const resources = policy.resources;
  const expectedNanoCpus = resources.cpus * 1_000_000_000;
  const expectedShm = resources.shared_memory_bytes ?? DEFAULT_SHM_BYTES;
  if (![host.NanoCpus, host.Memory, host.MemorySwap, host.PidsLimit, host.ShmSize].every(Number.isSafeInteger)
    || host.NanoCpus !== expectedNanoCpus || host.Memory !== resources.memory_bytes || host.MemorySwap !== resources.memory_swap_bytes
    || host.PidsLimit !== resources.pids || host.ShmSize !== expectedShm
    || ![host.MemoryReservation, host.CpuShares, host.CpuPeriod, host.CpuQuota, host.BlkioWeight].every((value) => value === 0)
    || host.CpusetCpus !== "" || host.CpusetMems !== "") reject("POSTDEPLOY_RUNTIME_RESOURCES_INVALID");

  exactKeys(host.RestartPolicy, ["MaximumRetryCount", "Name"], "POSTDEPLOY_RUNTIME_LIFECYCLE_INVALID");
  const expectedRestart = policy.lifecycle.restart === "no" ? "no" : policy.lifecycle.restart;
  const actualInit = host.Init === null || host.Init === undefined ? false : host.Init;
  const expectedStopTimeout = policy.lifecycle.stop_grace_period === null ? null : durationNanoseconds(policy.lifecycle.stop_grace_period, "POSTDEPLOY_RUNTIME_POLICY_INVALID") / 1_000_000_000;
  if (host.RestartPolicy.Name !== expectedRestart || host.RestartPolicy.MaximumRetryCount !== 0 || actualInit !== policy.lifecycle.init
    || config.StopTimeout !== expectedStopTimeout) reject("POSTDEPLOY_RUNTIME_LIFECYCLE_INVALID");

  exactKeys(host.LogConfig, ["Config", "Type"], "POSTDEPLOY_RUNTIME_LOGGING_INVALID");
  exactKeys(host.LogConfig.Config, ["max-file", "max-size"], "POSTDEPLOY_RUNTIME_LOGGING_INVALID");
  if (host.LogConfig.Type !== policy.logging.driver || host.LogConfig.Config["max-file"] !== policy.logging.max_file
    || host.LogConfig.Config["max-size"] !== policy.logging.max_size) reject("POSTDEPLOY_RUNTIME_LOGGING_INVALID");

  const expectedCommand = policy.process.command === null ? imageIdentity.defaults.command : policy.process.command;
  const expectedEntrypoint = policy.process.entrypoint === null ? imageIdentity.defaults.entrypoint : policy.process.entrypoint;
  if (canonicalJson(config.Cmd) !== canonicalJson(expectedCommand) || canonicalJson(config.Entrypoint) !== canonicalJson(expectedEntrypoint)
    || (config.WorkingDir || "") !== imageIdentity.defaults.working_directory || (config.StopSignal || "") !== imageIdentity.defaults.stop_signal) reject("POSTDEPLOY_RUNTIME_PROCESS_INVALID");
  normalizeHealthcheck(config.Healthcheck, expectedHealthcheck(policy.healthcheck));
  const ports = expectedPorts(policy.ports);
  exactCanonical(normalizePublishedPorts(host.PortBindings, { allowNullExtras: false }), ports, "POSTDEPLOY_RUNTIME_PORTS_INVALID");
  exactCanonical(normalizePublishedPorts(row.NetworkSettings?.Ports, { allowNullExtras: true }), ports, "POSTDEPLOY_RUNTIME_PORTS_INVALID");
}

function normalizeEndpoint(value, { row, service, networkName }) {
  exactKeys(value, ["Aliases", "DNSNames", "DriverOpts", "EndpointID", "Gateway", "GlobalIPv6Address", "GlobalIPv6PrefixLen", "GwPriority", "IPAMConfig", "IPAddress", "IPPrefixLen", "IPv6Gateway", "Links", "MacAddress", "NetworkID"], "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  const containerName = row.Name.slice(1);
  const expectedAliases = [containerName, service].sort();
  const expectedDnsNames = [containerName, service, row.Id.slice(0, 12)].sort();
  if (!CONTAINER_ID.test(value.NetworkID || "") || !CONTAINER_ID.test(value.EndpointID || "")
    || value.DriverOpts !== null || value.IPAMConfig !== null || value.Links !== null || value.GwPriority !== 0
    || isIP(value.Gateway) !== 4 || isIP(value.IPAddress) !== 4 || !Number.isSafeInteger(value.IPPrefixLen) || value.IPPrefixLen < 1 || value.IPPrefixLen > 32
    || value.IPv6Gateway !== "" || value.GlobalIPv6Address !== "" || value.GlobalIPv6PrefixLen !== 0
    || !/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(value.MacAddress || "")) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  exactCanonical(normalizeStringList(value.Aliases, "POSTDEPLOY_RUNTIME_NETWORK_INVALID"), expectedAliases, "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  exactCanonical(normalizeStringList(value.DNSNames, "POSTDEPLOY_RUNTIME_NETWORK_INVALID"), expectedDnsNames, "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  return { network_name: networkName, network_id: value.NetworkID, endpoint_id: value.EndpointID, container_name: containerName, ip_address: value.IPAddress, ip_prefix: value.IPPrefixLen, mac_address: value.MacAddress };
}

export function normalizePostDeployNetworkRows({ rows, composeProject, runtimePolicy, containerRows }) {
  if (!Array.isArray(rows) || rows.length !== NETWORKS.length || !runtimePolicy || !Array.isArray(containerRows)) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  const endpointByNetwork = new Map(NETWORKS.map((network) => [network, []]));
  for (let index = 0; index < SERVICES.length; index += 1) {
    const service = SERVICES[index]; const container = containerRows[index]; const policy = runtimePolicy[service];
    const expectedNames = policy.networks.map((network) => `${composeProject}_${network}`).sort();
    const actualNetworks = container?.NetworkSettings?.Networks;
    if (!actualNetworks || typeof actualNetworks !== "object" || Array.isArray(actualNetworks)) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    exactCanonical(Object.keys(actualNetworks).sort(), expectedNames, "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    if (container.HostConfig.NetworkMode !== `${composeProject}_${policy.networks[0]}`) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    for (const logical of policy.networks) endpointByNetwork.get(logical).push({
      service,
      container_id: container.Id,
      ...normalizeEndpoint(actualNetworks[`${composeProject}_${logical}`], { row: container, service, networkName: `${composeProject}_${logical}` }),
    });
  }
  const seen = new Set(); const identities = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || !NETWORKS.includes(row.LogicalName) || seen.has(row.LogicalName)) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    seen.add(row.LogicalName);
    const logical = row.LogicalName; const expectedName = `${composeProject}_${logical}`; const endpoints = endpointByNetwork.get(logical);
    const labelIdentity = normalizeComposeResourceLabels(row.Labels, { resourceKey: "network", logicalName: logical, composeProject, code: "POSTDEPLOY_RUNTIME_NETWORK_INVALID" });
    const optionsEmpty = row.Options && typeof row.Options === "object" && !Array.isArray(row.Options) && Object.keys(row.Options).length === 0;
    if (!CONTAINER_ID.test(row.Id || "") || row.Name !== expectedName || row.Driver !== "bridge" || row.Scope !== "local"
      || row.Internal !== (logical === "backend") || row.Attachable !== false || row.Ingress !== false || row.ConfigOnly !== false
      || row.EnableIPv4 !== true || row.EnableIPv6 !== false || !optionsEmpty
      || row.Labels["com.docker.compose.project"] !== composeProject || row.Labels["com.docker.compose.network"] !== logical) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    exactKeys(row.IPAM, ["Config", "Driver", "Options"], "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    if (row.IPAM.Driver !== "default" || row.IPAM.Options !== null || !Array.isArray(row.IPAM.Config) || row.IPAM.Config.length !== 1) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    exactKeys(row.IPAM.Config[0], ["Gateway", "Subnet"], "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    if (isIP(row.IPAM.Config[0].Gateway) !== 4 || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(row.IPAM.Config[0].Subnet)) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    if (!row.Containers || typeof row.Containers !== "object" || Array.isArray(row.Containers)) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    exactCanonical(Object.keys(row.Containers).sort(), endpoints.map((entry) => entry.container_id).sort(), "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    for (const endpoint of endpoints) {
      if (endpoint.network_id !== row.Id) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
      const member = row.Containers[endpoint.container_id];
      exactKeys(member, ["EndpointID", "IPv4Address", "IPv6Address", "MacAddress", "Name"], "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
      if (member.EndpointID !== endpoint.endpoint_id || member.Name !== endpoint.container_name || member.MacAddress !== endpoint.mac_address
        || member.IPv4Address !== `${endpoint.ip_address}/${endpoint.ip_prefix}` || member.IPv6Address !== "") reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
    }
    identities.push({ logical_name: logical, name: row.Name, network_id: row.Id, ...labelIdentity });
  }
  if (seen.size !== NETWORKS.length) reject("POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  return identities.sort((left, right) => left.logical_name.localeCompare(right.logical_name));
}

export function normalizePostDeployInspectRows({
  rows,
  networkRows,
  inventoryIds,
  networkInventoryNames,
  volumeInventoryNames,
  composeProject,
  composeProjectRoot,
  composeVersion,
  selectors,
  expectedReferences,
  expectedMounts,
  expectedTmpfs,
  expectedRuntime,
  expectedVolumeNames,
  appEnvironmentKeys,
  expectedVersion,
  expectedRevision,
  expectedManifestSha256,
  expectedSupervisorBundleSha256,
  expectedDeploymentClass,
  expectedDeploymentId,
  readerGid,
  imageIdentity = exactImageIdentity,
  volumeIdentity = exactVolumeIdentity,
  bindIdentity = verifyPostDeployBindMountIdentity,
}) {
  if (!Array.isArray(rows) || rows.length !== SERVICES.length || !Array.isArray(inventoryIds) || inventoryIds.length !== SERVICES.length) reject("POSTDEPLOY_SERVICE_SET_INVALID");
  if (!expectedRuntime || !Array.isArray(appEnvironmentKeys) || !Array.isArray(expectedVolumeNames)
    || !Array.isArray(networkInventoryNames) || !Array.isArray(volumeInventoryNames) || !/^\d{1,10}$/.test(String(readerGid || ""))
    || !SHA256.test(expectedManifestSha256 || "") || !SHA256.test(expectedSupervisorBundleSha256 || "")
    || !["UAT", "PRODUCTION"].includes(expectedDeploymentClass) || expectedDeploymentId !== composeProject) reject("POSTDEPLOY_RUNTIME_CONTROL_BINDING_INVALID");
  absoluteNormalizedPath(composeProjectRoot, "POSTDEPLOY_COMPOSE_PROJECT_ROOT_INVALID");
  exactCanonical([...networkInventoryNames].sort(), NETWORKS.map((network) => `${composeProject}_${network}`).sort(), "POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  exactCanonical([...volumeInventoryNames].sort(), expectedVolumeNames.map((volume) => `${composeProject}_${volume}`).sort(), "POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  const inventory = [...inventoryIds].sort(); const states = []; const configurationServices = []; const volumeIdentities = new Map(); const bindIdentities = [];
  const captureVolumeIdentity = (identity) => {
    exactKeys(identity, ["name", "logical_name", "created_at", "mountpoint", "created_with_compose_version", "configuration_sha256"], "POSTDEPLOY_VOLUME_IDENTITY_INVALID");
    if (typeof identity.name !== "string" || typeof identity.logical_name !== "string"
      || typeof identity.created_at !== "string" || !Number.isFinite(Date.parse(identity.created_at))
      || absoluteNormalizedPath(identity.mountpoint, "POSTDEPLOY_VOLUME_IDENTITY_INVALID") !== identity.mountpoint
      || !COMPOSE_VERSION.test(identity.created_with_compose_version || "")
      || (identity.configuration_sha256 !== null && !SHA256.test(identity.configuration_sha256 || ""))) reject("POSTDEPLOY_VOLUME_IDENTITY_INVALID");
    const prior = volumeIdentities.get(identity.name);
    if (prior && canonicalJson(prior) !== canonicalJson(identity)) reject("POSTDEPLOY_VOLUME_IDENTITY_INVALID");
    volumeIdentities.set(identity.name, identity);
  };
  const captureBindIdentity = (service, identity) => {
    exactKeys(identity, ["source", "target", "device", "inode"], "POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
    if (absoluteNormalizedPath(identity.source, "POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID") !== identity.source
      || absoluteNormalizedPath(identity.target, "POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID") !== identity.target
      || !/^\d+$/.test(identity.device || "") || !/^[1-9]\d*$/.test(identity.inode || "")) reject("POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
    bindIdentities.push({ service, ...identity });
  };
  for (let index = 0; index < SERVICES.length; index += 1) {
    const service = SERVICES[index]; const row = rows[index];
    const selectorMatches = CONTAINER_ID.test(selectors[service] || "") ? row?.Id === selectors[service] : row?.Name === `/${selectors[service]}`;
    if (!row || typeof row !== "object" || Array.isArray(row) || !CONTAINER_ID.test(row.Id || "") || !selectorMatches) reject("POSTDEPLOY_CONTAINER_ID_INVALID");
    const labels = row?.Config?.Labels;
    if (!labels || labels["com.docker.compose.project"] !== composeProject || labels["com.docker.compose.service"] !== service
      || labels["com.docker.compose.project.working_dir"] !== composeProjectRoot || row.Config.Image !== expectedReferences[service]
      || row.Name !== `/${composeProject}-${service}-1` || labels["com.docker.compose.container-number"] !== "1"
      || labels["com.docker.compose.oneoff"] !== "False" || labels["com.docker.compose.version"] !== composeVersion
      || labels["com.docker.compose.image"] !== row.Image || !SHA256.test(labels["com.docker.compose.config-hash"] || "")) reject("POSTDEPLOY_COMPOSE_IDENTITY_INVALID");
    const image = imageIdentity(expectedReferences[service], row, expectedRuntime[service].image_environment_keys);
    if (!image || image.image_id !== row.Image) reject("POSTDEPLOY_IMAGE_MISMATCH");
    exactCanonical(normalizeStringList(image.environment_keys, "POSTDEPLOY_IMAGE_MISMATCH"), normalizeStringList(expectedRuntime[service].image_environment_keys, "POSTDEPLOY_RUNTIME_POLICY_INVALID"), "POSTDEPLOY_IMAGE_MISMATCH");
    if (["web", "worker"].includes(service) && !DIGEST.test(image.image_config_digest || "")) reject("POSTDEPLOY_IMAGE_MISMATCH");
    if (["web", "worker"].includes(service) && (labels["org.opencontainers.image.version"] !== expectedVersion || labels["org.opencontainers.image.revision"] !== expectedRevision)) reject("POSTDEPLOY_IMAGE_SOURCE_MISMATCH");
    if (canonicalJson(normalizeRuntimeMounts(row.Mounts, { pid: row.State?.Pid, composeProject, composeVersion, volumeIdentity, bindIdentity, onVolumeIdentity: captureVolumeIdentity, onBindIdentity: (identity) => captureBindIdentity(service, identity) })) !== canonicalJson(expectedRuntimeMounts(expectedMounts?.[service], composeProject, composeProjectRoot))) reject("POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
    if (canonicalJson(normalizeRuntimeTmpfs(row?.HostConfig?.Tmpfs)) !== canonicalJson(expectedRuntimeTmpfs(expectedTmpfs?.[service]))) reject("POSTDEPLOY_RUNTIME_TMPFS_INVALID");
    validateRuntimeProjection({ row, service, policy: expectedRuntime[service], imageIdentity: image, readerGid });
    const environment = validateEnvironmentProjection({ row, service, policy: expectedRuntime[service], appEnvironmentKeys, imageIdentity: image, expectedReference: expectedReferences[service], expectedVersion, expectedRevision, expectedManifestSha256, expectedSupervisorBundleSha256, expectedDeploymentClass, expectedDeploymentId });
    configurationServices.push({ service, compose_configuration_sha256: labels["com.docker.compose.config-hash"], environment_sha256: sha256(canonicalJson(environment)) });
    const state = row.State;
    if (!state || typeof row.RestartCount !== "number" || !Number.isSafeInteger(row.RestartCount)) reject("POSTDEPLOY_RUNTIME_STATE_INVALID");
    states.push({
      service,
      container_id: row.Id,
      image_id: image.image_id,
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
  const expectedVolumeInventory = expectedVolumeNames.map((name) => `${composeProject}_${name}`).sort();
  exactCanonical([...volumeIdentities.keys()].sort(), expectedVolumeInventory, "POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  const networks = normalizePostDeployNetworkRows({ rows: networkRows, composeProject, runtimePolicy: expectedRuntime, containerRows: rows });
  const runtimeConfiguration = {
    schema_version: 1,
    contract: "chenyida-erp-postdeploy-runtime-configuration/v1",
    services: configurationServices,
    volumes: [...volumeIdentities.values()].sort((left, right) => left.name.localeCompare(right.name)),
    networks,
    bind_mounts: bindIdentities.sort((left, right) => `${left.service}:${left.target}`.localeCompare(`${right.service}:${right.target}`)),
  };
  return { services: validatePostDeployRuntimeServices(states), runtime_configuration_sha256: sha256(canonicalJson(runtimeConfiguration)) };
}

function parseContainerInspectFields(fields) {
  if (!Array.isArray(fields) || fields.length !== 84) reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED");
  const [Id, Name, Image, imageReference, composeLabel, serviceLabel, workingDirectoryLabel, versionLabel, revisionLabel,
    containerNumberLabel, oneoffLabel, composeVersionLabel, composeImageLabel, configHashLabel, RestartCount, OOMKilled,
    Running, Restarting, Paused, Dead, Status, healthStatus, Healthcheck, Tmpfs, Mounts, User, GroupAdd, Privileged,
    ReadonlyRootfs, CapAdd, CapDrop, SecurityOpt, NanoCpus, Memory, MemorySwap, PidsLimit, ShmSize, RestartPolicy, Init,
    AutoRemove, StopTimeout, LogConfig, Cmd, Entrypoint, WorkingDir, StopSignal, PortBindings, Ports, NetworkMode, Networks,
    CgroupParent, CgroupnsMode, Dns, DnsOptions, DnsSearch, ExtraHosts, Devices, DeviceRequests, Runtime, IpcMode, PidMode,
    UTSMode, UsernsMode, OomKillDisable, OomScoreAdj, PublishAllPorts, Sysctls, Ulimits, VolumesFrom, Links, Isolation,
    MemoryReservation, CpuShares, CpuPeriod, CpuQuota, CpusetCpus, CpusetMems, BlkioWeight, MaskedPaths, ReadonlyPaths,
    OpenStdin, StdinOnce, Tty, Pid] = fields;
  return {
    Id, Name, Image, Mounts, RestartCount,
    Config: {
      Image: imageReference,
      Labels: {
        "com.docker.compose.project": composeLabel,
        "com.docker.compose.service": serviceLabel,
        "com.docker.compose.project.working_dir": workingDirectoryLabel,
        "org.opencontainers.image.version": versionLabel,
        "org.opencontainers.image.revision": revisionLabel,
        "com.docker.compose.container-number": containerNumberLabel,
        "com.docker.compose.oneoff": oneoffLabel,
        "com.docker.compose.version": composeVersionLabel,
        "com.docker.compose.image": composeImageLabel,
        "com.docker.compose.config-hash": configHashLabel,
      },
      User, Healthcheck, StopTimeout, Cmd, Entrypoint, WorkingDir, StopSignal, OpenStdin, StdinOnce, Tty,
    },
    HostConfig: { Tmpfs, GroupAdd, Privileged, ReadonlyRootfs, CapAdd, CapDrop, SecurityOpt, NanoCpus, Memory, MemorySwap, PidsLimit, ShmSize, RestartPolicy, Init, AutoRemove, LogConfig, PortBindings, NetworkMode, CgroupParent, CgroupnsMode, Dns, DnsOptions, DnsSearch, ExtraHosts, Devices, DeviceRequests, Runtime, IpcMode, PidMode, UTSMode, UsernsMode, OomKillDisable, OomScoreAdj, PublishAllPorts, Sysctls, Ulimits, VolumesFrom, Links, Isolation, MemoryReservation, CpuShares, CpuPeriod, CpuQuota, CpusetCpus, CpusetMems, BlkioWeight, MaskedPaths, ReadonlyPaths },
    NetworkSettings: { Ports, Networks },
    State: { OOMKilled, Running, Restarting, Paused, Dead, Status, Pid, ...(healthStatus === null ? {} : { Health: { Status: healthStatus } }) },
  };
}

function parseNetworkInspectFields(fields, logicalName) {
  if (!Array.isArray(fields) || fields.length !== 14) reject("POSTDEPLOY_NETWORK_INSPECTION_FAILED");
  const [Id, Name, Driver, Scope, Internal, Attachable, Ingress, ConfigOnly, EnableIPv4, EnableIPv6, Options, Labels, Containers, IPAM] = fields;
  return { Id, Name, Driver, Scope, Internal, Attachable, Ingress, ConfigOnly, EnableIPv4, EnableIPv6, Options, Labels, Containers, IPAM, LogicalName: logicalName };
}

export function inspectPostDeployRuntime({
  composeProject,
  composeProjectRoot,
  composeVersion,
  selectors,
  expectedReferences,
  expectedMounts,
  expectedTmpfs,
  expectedRuntime,
  expectedVolumeNames,
  appEnvironmentKeys,
  expectedVersion,
  expectedRevision,
  expectedManifestSha256,
  expectedSupervisorBundleSha256,
  expectedDeploymentClass,
  expectedDeploymentId,
  readerGid,
}) {
  const inventoryIds = docker(["ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${composeProject}`], "POSTDEPLOY_RUNTIME_INVENTORY_FAILED").split(/\s+/).filter(Boolean);
  const networkInventoryNames = docker(["network", "ls", "--format", "{{.Name}}", "--filter", `label=com.docker.compose.project=${composeProject}`], "POSTDEPLOY_NETWORK_INVENTORY_FAILED").split(/\s+/).filter(Boolean);
  const volumeInventoryNames = docker(["volume", "ls", "--format", "{{.Name}}", "--filter", `label=com.docker.compose.project=${composeProject}`], "POSTDEPLOY_VOLUME_INVENTORY_FAILED").split(/\s+/).filter(Boolean);
  const names = SERVICES.map((service) => selectors[service]);
  const lines = docker(["inspect", "--format", CONTAINER_INSPECT_FORMAT, "--", ...names], "POSTDEPLOY_RUNTIME_INSPECTION_FAILED").trim().split("\n").filter(Boolean);
  if (lines.length !== SERVICES.length) reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED");
  const rows = lines.map((line, index) => {
    let fields;
    try { fields = parseStrictJson(line, 1024 * 1024); } catch { reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED"); }
    const row = parseContainerInspectFields(fields);
    const service = SERVICES[index];
    const environment = inspectEnvironment(row.Id, { safeKeys: expectedEnvironmentKeys(service, expectedRuntime[service], appEnvironmentKeys) });
    row.EnvironmentKeys = environment.keys; row.SafeEnvironment = environment.safe;
    if (row.Config.Labels["com.docker.compose.service"] !== SERVICES[index]) reject("POSTDEPLOY_RUNTIME_INSPECTION_FAILED");
    return row;
  });
  const networkNames = NETWORKS.map((network) => `${composeProject}_${network}`);
  const networkLines = docker(["network", "inspect", "--format", NETWORK_INSPECT_FORMAT, "--", ...networkNames], "POSTDEPLOY_NETWORK_INSPECTION_FAILED").trim().split("\n").filter(Boolean);
  if (networkLines.length !== NETWORKS.length) reject("POSTDEPLOY_NETWORK_INSPECTION_FAILED");
  const networkRows = networkLines.map((line, index) => {
    let fields;
    try { fields = parseStrictJson(line, 1024 * 1024); } catch { reject("POSTDEPLOY_NETWORK_INSPECTION_FAILED"); }
    return parseNetworkInspectFields(fields, NETWORKS[index]);
  });
  return normalizePostDeployInspectRows({ rows, networkRows, inventoryIds, networkInventoryNames, volumeInventoryNames, composeProject, composeProjectRoot, composeVersion, selectors, expectedReferences, expectedMounts, expectedTmpfs, expectedRuntime, expectedVolumeNames, appEnvironmentKeys, expectedVersion, expectedRevision, expectedManifestSha256, expectedSupervisorBundleSha256, expectedDeploymentClass, expectedDeploymentId, readerGid });
}

export function normalizeCaddyfileDigestOutput(raw, expectedSha256) {
  if (typeof raw !== "string" || typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)) reject("POSTDEPLOY_CADDYFILE_CONTAINER_INVALID");
  const match = raw.match(/^([0-9a-f]{64})  \/etc\/caddy\/Caddyfile\n$/);
  if (!match || match[1] !== expectedSha256) reject("POSTDEPLOY_CADDYFILE_CONTAINER_INVALID");
  return match[1];
}

export function verifyContainerCaddyfile(containerId, expectedSha256) {
  if (!CONTAINER_ID.test(containerId || "")) reject("POSTDEPLOY_CADDYFILE_CONTAINER_INVALID");
  const raw = docker(["exec", "--", containerId, "/usr/bin/sha256sum", "/etc/caddy/Caddyfile"], "POSTDEPLOY_CADDYFILE_CONTAINER_INVALID", { maximum: 1024 });
  return normalizeCaddyfileDigestOutput(raw, expectedSha256);
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

function assertRecoveredReceiptBinding({ publication, runId, deploymentClass, deploymentId, composeProject, manifest, manifestSha256, control, policy, runtimeConfigurationSha256 }) {
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
    runtimeConfigurationSha256,
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
  const policy = await loadPostDeployRuntimePolicy(options.runtimePolicyFile);
  if (!SHA256.test(options.runtimeConfigurationSha256 || "")) reject("POSTDEPLOY_RUNTIME_CONFIGURATION_INVALID");
  if (options.composeProject !== policy.compose_project || options.deploymentId !== policy.compose_project) reject("POSTDEPLOY_COMPOSE_IDENTITY_INVALID");
  verifyAuthorizedComposeProjectRoot({ composeProjectRoot: options.composeProjectRoot, caddyfileSha256: policy.caddyfile_sha256 });
  const manifest = await loadReleaseManifest({ file: options.manifestFile, expectedSha256: options.manifestSha256, requireEligible: true, trusted: true, now });
  const expectedReferences = { caddy: policy.references.caddy, postgres: policy.references.postgres, web: manifest.images.web.image_reference, worker: manifest.images.worker.image_reference };
  const publication = await recoverableReceiptPublication({ root: options.postdeployRoot, runId: options.runId });
  let receipt; let receiptSha256; let publicationState;
  if (publication === null) {
    const runtime = inspectPostDeployRuntime({ composeProject: options.composeProject, composeProjectRoot: options.composeProjectRoot, composeVersion: policy.compose_version, selectors: options.selectors, expectedReferences, expectedMounts: policy.mounts, expectedTmpfs: policy.tmpfs, expectedRuntime: policy.runtime, expectedVolumeNames: policy.volume_names, appEnvironmentKeys: policy.app_environment_keys, expectedVersion: manifest.source.package_version, expectedRevision: manifest.source.git_commit, expectedManifestSha256: options.manifestSha256, expectedSupervisorBundleSha256: control.supervisor_bundle_sha256, expectedDeploymentClass: options.deploymentClass, expectedDeploymentId: options.deploymentId, readerGid: options.readerGid });
    if (runtime.runtime_configuration_sha256 !== options.runtimeConfigurationSha256) reject("POSTDEPLOY_RUNTIME_CONFIGURATION_MISMATCH");
    const services = runtime.services;
    verifyContainerCaddyfile(services.find((state) => state.service === "caddy").container_id, policy.caddyfile_sha256);
    const readiness = inspectPostDeployReadiness(services.find((state) => state.service === "web").container_id);
    receipt = buildPostDeployReceipt({ runId: options.runId, generatedAt: now.toISOString(), deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, manifest, manifestSha256: options.manifestSha256, supervisorBundleSha256: control.supervisor_bundle_sha256, authorizationSha256: control.authorization_sha256, runtimePolicySha256: policy.sha256, runtimeConfigurationSha256: options.runtimeConfigurationSha256, services, readiness });
    receiptSha256 = sha256(canonicalJson(receipt));
    await writePreparedJsonArtifact({ root: options.postdeployRoot, filename: preparedReceiptFilename(options.runId), value: receipt });
    publicationState = "PREPARED";
  } else {
    receipt = assertRecoveredReceiptBinding({ publication, runId: options.runId, deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, manifest, manifestSha256: options.manifestSha256, control, policy, runtimeConfigurationSha256: options.runtimeConfigurationSha256 });
    receiptSha256 = publication.sha256;
    publicationState = publication.state;
    const runtime = inspectPostDeployRuntime({ composeProject: options.composeProject, composeProjectRoot: options.composeProjectRoot, composeVersion: policy.compose_version, selectors: selectorsFromReceipt(receipt), expectedReferences, expectedMounts: policy.mounts, expectedTmpfs: policy.tmpfs, expectedRuntime: policy.runtime, expectedVolumeNames: policy.volume_names, appEnvironmentKeys: policy.app_environment_keys, expectedVersion: manifest.source.package_version, expectedRevision: manifest.source.git_commit, expectedManifestSha256: options.manifestSha256, expectedSupervisorBundleSha256: control.supervisor_bundle_sha256, expectedDeploymentClass: options.deploymentClass, expectedDeploymentId: options.deploymentId, readerGid: options.readerGid });
    if (runtime.runtime_configuration_sha256 !== options.runtimeConfigurationSha256) reject("POSTDEPLOY_RUNTIME_CONFIGURATION_MISMATCH");
    const services = runtime.services;
    verifyContainerCaddyfile(services.find((state) => state.service === "caddy").container_id, policy.caddyfile_sha256);
    const readiness = inspectPostDeployReadiness(services.find((state) => state.service === "web").container_id);
    buildPostDeployReceipt({ runId: options.runId, generatedAt: now.toISOString(), deploymentClass: options.deploymentClass, deploymentId: options.deploymentId, composeProject: options.composeProject, manifest, manifestSha256: options.manifestSha256, supervisorBundleSha256: control.supervisor_bundle_sha256, authorizationSha256: control.authorization_sha256, runtimePolicySha256: policy.sha256, runtimeConfigurationSha256: options.runtimeConfigurationSha256, services, readiness });
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
  const policy = await loadPostDeployRuntimePolicy(options.runtimePolicyFile);
  verifyAuthorizedComposeProjectRoot({ composeProjectRoot: options.composeProjectRoot, caddyfileSha256: policy.caddyfile_sha256 });
  const publication = await recoverableReceiptPublication({ root: options.postdeployRoot, runId: options.runId });
  if (publication === null || publication.sha256 !== options.receiptSha256) reject("POSTDEPLOY_PREPARED_RECEIPT_INVALID");
  if (publication.value?.deployment?.compose_project !== policy.compose_project) reject("POSTDEPLOY_COMPOSE_IDENTITY_INVALID");
  const receipt = publication.value;
  if (!SHA256.test(options.runtimeConfigurationSha256 || "") || receipt.runtime_configuration_sha256 !== options.runtimeConfigurationSha256) reject("POSTDEPLOY_RUNTIME_CONFIGURATION_MISMATCH");
  if (canonicalJson(receipt.control) !== canonicalJson(control) || receipt.run_id !== options.runId) reject("POSTDEPLOY_PREPARED_CONTROL_MISMATCH");
  const runtime = inspectPostDeployRuntime({ composeProject: receipt.deployment.compose_project, composeProjectRoot: options.composeProjectRoot, composeVersion: policy.compose_version, selectors: selectorsFromReceipt(receipt), expectedReferences: expectedReferencesFromReceipt(receipt), expectedMounts: policy.mounts, expectedTmpfs: policy.tmpfs, expectedRuntime: policy.runtime, expectedVolumeNames: policy.volume_names, appEnvironmentKeys: policy.app_environment_keys, expectedVersion: receipt.source.application_version, expectedRevision: receipt.source.git_commit, expectedManifestSha256: receipt.release.manifest_sha256, expectedSupervisorBundleSha256: receipt.control.supervisor_bundle_sha256, expectedDeploymentClass: receipt.deployment.class, expectedDeploymentId: receipt.deployment.id, readerGid: options.readerGid });
  if (runtime.runtime_configuration_sha256 !== receipt.runtime_configuration_sha256) reject("POSTDEPLOY_RUNTIME_CONFIGURATION_MISMATCH");
  const services = runtime.services;
  verifyContainerCaddyfile(services.find((state) => state.service === "caddy").container_id, policy.caddyfile_sha256);
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
    const expected = ["--manifest", "--manifest-sha256", "--postdeploy-root", "--identity-root", "--reader-gid", "--run-id", "--runtime-guard-contract", "--runtime-guard-mode", "--runtime-configuration-sha256", "--deployment-class", "--deployment-id", "--compose-project", "--compose-project-root", "--caddy-container", "--postgres-container", "--web-container", "--worker-container", "--runtime-policy", "--confirm"];
    if (Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key)) || options["--confirm"] !== "PREPARE_EXACT_POSTDEPLOY_VERIFICATION") reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
    const selectors = Object.fromEntries(SERVICES.map((service) => [service, options[`--${service}-container`]]));
    const outcome = await preparePostDeployVerification({ manifestFile: options["--manifest"], manifestSha256: options["--manifest-sha256"], postdeployRoot: options["--postdeploy-root"], identityRoot: options["--identity-root"], readerGid: options["--reader-gid"], runId: options["--run-id"], runtimeGuardContract: options["--runtime-guard-contract"], runtimeGuardMode: options["--runtime-guard-mode"], runtimeConfigurationSha256: options["--runtime-configuration-sha256"], deploymentClass: options["--deployment-class"], deploymentId: options["--deployment-id"], composeProject: options["--compose-project"], composeProjectRoot: options["--compose-project-root"], selectors, runtimePolicyFile: options["--runtime-policy"], control, environment: process.env });
    process.stdout.write(`${JSON.stringify({ result: outcome.preparedIdentity.already_published ? "ALREADY_PUBLISHED" : "PREPARED", receipt_sha256: outcome.receiptSha256 })}\n`);
    return;
  }
  const expected = ["--postdeploy-root", "--identity-root", "--reader-gid", "--run-id", "--receipt-sha256", "--authorization-sha256", "--compose-project-root", "--runtime-policy", ...(command === "commit" ? ["--runtime-configuration-sha256"] : []), "--confirm"];
  if (!["commit", "abort"].includes(command) || Object.keys(options).length !== expected.length || expected.some((key) => !Object.hasOwn(options, key))) reject("POSTDEPLOY_CLI_ARGUMENT_INVALID");
  if (options["--authorization-sha256"] !== control.authorization_sha256) reject("POSTDEPLOY_AUTHORIZATION_MISMATCH");
  const common = { postdeployRoot: options["--postdeploy-root"], identityRoot: options["--identity-root"], readerGid: options["--reader-gid"], runId: options["--run-id"], receiptSha256: options["--receipt-sha256"], authorizationSha256: options["--authorization-sha256"], composeProjectRoot: options["--compose-project-root"], runtimePolicyFile: options["--runtime-policy"], runtimeConfigurationSha256: options["--runtime-configuration-sha256"], control, environment: process.env };
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
