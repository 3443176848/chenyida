import { spawnSync } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";

import {
  MONITORING_OBSERVATION_CONTRACT,
  OpsMonitoringError,
  emptyComponentObservation,
  monitoringResourcePolicy,
  monitoringObservationId,
  monitoringSha256,
  parseMonitoringJson,
  validateMonitoringConfig,
  validateMonitoringObservation,
  validateMonitoringPolicy,
} from "./contract.mjs";

export const DOCKER_INSPECT_FORMAT = '{"container_id":{{json .Id}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"container_name":{{json .Name}},"image_id":{{json .Image}},"image_reference":{{json .Config.Image}},"status":{{json .State.Status}},"health":{{with (index .State "Health")}}{{json .Status}}{{else}}"none"{{end}},"restart_count":{{json .RestartCount}},"oom_killed":{{json .State.OOMKilled}}}';

const SAFE_DOCKER_ENVIRONMENT = Object.freeze({
  PATH: "/usr/bin:/bin",
  HOME: "/nonexistent",
  DOCKER_CONFIG: "/nonexistent",
  LC_ALL: "C",
  LANG: "C",
  TZ: "UTC",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const SERVICE = /^[a-z][a-z0-9_-]{0,31}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_LOCATOR = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/;

function reject(code) {
  throw new OpsMonitoringError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function safeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) reject(code);
  return value;
}

function docker(args, spawn = spawnSync) {
  const result = spawn("/usr/bin/docker", args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 128 * 1024,
    env: SAFE_DOCKER_ENVIRONMENT,
  });
  if (result?.status !== 0 || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 64 * 1024) reject("MONITOR_DOCKER_COMMAND_FAILED");
  return result.stdout;
}

function parseMeminfo(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 128 * 1024) reject("MONITOR_HOST_MEMORY_INVALID");
  const values = new Map();
  for (const match of raw.matchAll(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/gm)) {
    if (values.has(match[1])) reject("MONITOR_HOST_MEMORY_INVALID");
    const kib = Number(match[2]);
    if (!Number.isSafeInteger(kib)) reject("MONITOR_HOST_MEMORY_INVALID");
    values.set(match[1], kib);
  }
  const available = values.get("MemAvailable");
  const total = values.get("SwapTotal");
  const free = values.get("SwapFree");
  if (![available, total, free].every(Number.isSafeInteger) || free > total) reject("MONITOR_HOST_MEMORY_INVALID");
  return {
    available_memory_bytes: safeInteger(available * 1024, "MONITOR_HOST_MEMORY_INVALID"),
    swap_total_bytes: safeInteger(total * 1024, "MONITOR_HOST_MEMORY_INVALID"),
    swap_free_bytes: safeInteger(free * 1024, "MONITOR_HOST_MEMORY_INVALID"),
  };
}

function parseOomCount(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 512 * 1024) reject("MONITOR_HOST_OOM_INVALID");
  const matches = [...raw.matchAll(/^oom_kill\s+(\d+)$/gm)];
  if (matches.length !== 1) reject("MONITOR_HOST_OOM_INVALID");
  return safeInteger(Number(matches[0][1]), "MONITOR_HOST_OOM_INVALID");
}

function parseLoad(raw) {
  const value = typeof raw === "string" ? Number(raw.trim().split(/\s+/)[0]) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) reject("MONITOR_HOST_LOAD_INVALID");
  return value;
}

function parseUptime(raw) {
  const seconds = typeof raw === "string" ? Number(raw.trim().split(/\s+/)[0]) : Number.NaN;
  const milliseconds = Math.floor(seconds * 1000);
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(milliseconds)) reject("MONITOR_HOST_UPTIME_INVALID");
  return milliseconds;
}

function parseBootId(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!UUID.test(value)) reject("MONITOR_HOST_BOOT_ID_INVALID");
  return monitoringSha256(value);
}

async function defaultReadText(file) {
  return readFile(file, "utf8");
}

export async function collectHostObservation({ readText = defaultReadText, statfsImpl = statfs } = {}) {
  let memoryRaw;
  let vmstatRaw;
  let loadRaw;
  let uptimeRaw;
  let bootRaw;
  let root;
  try {
    [memoryRaw, vmstatRaw, loadRaw, uptimeRaw, bootRaw, root] = await Promise.all([
      readText("/proc/meminfo"),
      readText("/proc/vmstat"),
      readText("/proc/loadavg"),
      readText("/proc/uptime"),
      readText("/proc/sys/kernel/random/boot_id"),
      statfsImpl("/"),
    ]);
  } catch {
    reject("MONITOR_HOST_COLLECTION_FAILED");
  }
  let rootFree;
  try { rootFree = Number(BigInt(root.bavail) * BigInt(root.bsize)); } catch { reject("MONITOR_HOST_DISK_INVALID"); }
  if (!Number.isSafeInteger(rootFree) || rootFree < 0) reject("MONITOR_HOST_DISK_INVALID");
  return Object.freeze({
    boot_id_sha256: parseBootId(bootRaw),
    monotonic_milliseconds: parseUptime(uptimeRaw),
    ...parseMeminfo(memoryRaw),
    root_free_bytes: rootFree,
    load_1m: parseLoad(loadRaw),
    oom_kill_count: parseOomCount(vmstatRaw),
  });
}

export function collectDockerServices({ composeProject, spawn = spawnSync }) {
  if (typeof composeProject !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(composeProject)) reject("MONITOR_DOCKER_PROJECT_INVALID");
  const listed = docker(["ps", "-aq", "--no-trunc", "--filter", `label=com.docker.compose.project=${composeProject}`], spawn);
  const ids = listed.split(/\s+/).filter(Boolean);
  if (ids.some((id) => !CONTAINER_ID.test(id)) || new Set(ids).size !== ids.length || ids.length > 16) reject("MONITOR_DOCKER_INVENTORY_INVALID");
  if (ids.length === 0) return Object.freeze([]);
  const inspected = docker(["inspect", "--format", DOCKER_INSPECT_FORMAT, "--", ...ids], spawn);
  const lines = inspected.trim().split("\n").filter(Boolean);
  if (lines.length !== ids.length) reject("MONITOR_DOCKER_INVENTORY_INCOMPLETE");
  const seenIds = new Set();
  const services = lines.map((line) => {
    const value = parseMonitoringJson(line, 4096);
    exactKeys(value, ["container_id", "service", "project", "container_name", "image_id", "image_reference", "status", "health", "restart_count", "oom_killed"], "MONITOR_DOCKER_METADATA_INVALID");
    if (!CONTAINER_ID.test(value.container_id || "") || seenIds.has(value.container_id) || !SERVICE.test(value.service || "") || value.project !== composeProject || typeof value.container_name !== "string" || !value.container_name.startsWith("/") || value.container_name.length < 2 || !IMAGE_DIGEST.test(value.image_id || "") || !IMAGE_LOCATOR.test(value.image_reference || "") || !Number.isSafeInteger(value.restart_count) || value.restart_count < 0 || typeof value.oom_killed !== "boolean") reject("MONITOR_DOCKER_METADATA_INVALID");
    seenIds.add(value.container_id);
    return {
      service: value.service,
      container_name: value.container_name.slice(1),
      container_id: value.container_id,
      image_id: value.image_id,
      image_reference: value.image_reference,
      status: value.status,
      health: value.health,
      restart_count: value.restart_count,
      oom_killed: value.oom_killed,
    };
  }).sort((left, right) => left.service.localeCompare(right.service));
  return Object.freeze(services);
}

export async function collectMonitoringObservation({
  policy,
  resourcePlan,
  config,
  components = null,
  source = null,
  clock = () => new Date(),
  readText = defaultReadText,
  statfsImpl = statfs,
  spawn = spawnSync,
}) {
  validateMonitoringPolicy(policy);
  monitoringResourcePolicy(resourcePlan, policy);
  validateMonitoringConfig(config);
  const observed = clock();
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) reject("MONITOR_COLLECTION_TIME_INVALID");
  const observedAt = observed.toISOString();
  const host = await collectHostObservation({ readText, statfsImpl });
  const services = collectDockerServices({ composeProject: config.compose_project, spawn });
  const componentObservation = components === null ? emptyComponentObservation() : components;
  const resolvedSource = source === null ? components === null ? "HOST_METADATA_ONLY" : "FULL" : source;
  const observation = {
    schema_version: 1,
    contract: MONITORING_OBSERVATION_CONTRACT,
    observation_id: "",
    observed_at: observedAt,
    source: resolvedSource,
    policy_sha256: monitoringSha256(policy),
    resource_policy_sha256: policy.resource_policy_source.sha256,
    host,
    services,
    application: componentObservation.application,
    release: componentObservation.release,
    backup: componentObservation.backup,
    notification: componentObservation.notification,
  };
  observation.observation_id = monitoringObservationId(observation);
  return Object.freeze(validateMonitoringObservation(observation));
}
