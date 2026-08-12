#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

import {
  OpsMonitoringError,
  canonicalMonitoringJson,
  evaluateMonitoringObservation,
  monitoringSha256,
  parseMonitoringJson,
  validateMonitoringConfig,
  validateMonitoringObservation,
  validateMonitoringPolicy,
} from "./contract.mjs";
import { collectMonitoringObservation } from "./collector.mjs";
import {
  initializeMonitoringStateRoot,
  readMonitoringState,
  withMonitoringStateLock,
  writeMonitoringState,
} from "./state-store.mjs";

const COMMAND_OPTIONS = Object.freeze({
  init: new Set(["--state-root"]),
  collect: new Set(["--policy", "--resource-plan", "--config", "--components"]),
  evaluate: new Set(["--policy", "--resource-plan", "--config", "--observation", "--state-root"]),
  run: new Set(["--policy", "--resource-plan", "--config", "--components", "--state-root"]),
  status: new Set(["--policy", "--config", "--state-root"]),
});

function reject(code) {
  throw new OpsMonitoringError(code);
}

function options(command, args) {
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed || args.length % 2 !== 0) reject("MONITOR_CLI_ARGUMENT_INVALID");
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || typeof value !== "string" || value.length < 1 || Object.hasOwn(result, key)) reject("MONITOR_CLI_ARGUMENT_INVALID");
    result[key] = value;
  }
  for (const key of allowed) if (key !== "--components" && !Object.hasOwn(result, key)) reject("MONITOR_CLI_ARGUMENT_INVALID");
  return result;
}

async function safeTextFile(file, maximumBytes = 1024 * 1024) {
  if (typeof file !== "string" || file !== path.resolve(file) || file === path.parse(file).root) reject("MONITOR_INPUT_PATH_INVALID");
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || uid < 0) reject("MONITOR_INPUT_IDENTITY_UNAVAILABLE");
  let before;
  try { before = await lstat(file); } catch { reject("MONITOR_INPUT_FILE_INVALID"); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || ![0, uid].includes(before.uid) || (before.mode & 0o022) !== 0 || before.size < 2 || before.size > maximumBytes) reject("MONITOR_INPUT_FILE_UNSAFE");
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { reject("MONITOR_INPUT_FILE_INVALID"); }
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) reject("MONITOR_INPUT_FILE_CHANGED");
    const raw = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(file).catch(() => null);
    if (!pathAfter || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.nlink !== 1 || pathAfter.uid !== before.uid || (pathAfter.mode & 0o7777) !== (before.mode & 0o7777)) reject("MONITOR_INPUT_FILE_CHANGED");
    return raw;
  } finally {
    await handle.close();
  }
}

async function jsonFile(file, maximumBytes) {
  return parseMonitoringJson(await safeTextFile(file, maximumBytes), maximumBytes);
}

async function inputs(parsed, needsResourcePlan = true) {
  const policy = validateMonitoringPolicy(await jsonFile(parsed["--policy"]));
  const config = validateMonitoringConfig(await jsonFile(parsed["--config"]));
  const resourcePlan = needsResourcePlan ? await jsonFile(parsed["--resource-plan"]) : null;
  return { policy, config, resourcePlan };
}

function statusView(state) {
  if (state === null) return { schema_version: 1, contract: "chenyida-erp-operations-monitoring-status/v1", status: "UNINITIALIZED", state_sequence: null, last_observed_at: null, active_alert_count: 0, active_alerts: [], pending_event_count: 0 };
  return {
    schema_version: 1,
    contract: "chenyida-erp-operations-monitoring-status/v1",
    status: state.active_alerts.some((alert) => alert.severity === "CRITICAL") ? "CRITICAL" : state.active_alerts.length ? "DEGRADED" : "HEALTHY",
    state_sequence: state.sequence,
    last_observed_at: state.last_observed_at,
    active_alert_count: state.active_alerts.length,
    active_alerts: state.active_alerts.map((alert) => ({ dedupe_key: alert.dedupe_key, code: alert.code, severity: alert.severity, first_observed_at: alert.first_observed_at, last_observed_at: alert.last_observed_at })),
    pending_event_count: state.pending_events.length,
  };
}

async function evaluateAndPersist({ policy, resourcePlan, config, observation, stateRoot }) {
  return withMonitoringStateLock(stateRoot, async () => {
    const previousState = await readMonitoringState(stateRoot, config, policy);
    const result = evaluateMonitoringObservation({ policy, resourcePlan, config, observation, previousState });
    await writeMonitoringState(stateRoot, result.nextState, config, policy);
    return result.report;
  });
}

async function execute(argv) {
  const [command, ...args] = argv;
  const parsed = options(command, args);
  if (command === "init") {
    const root = await initializeMonitoringStateRoot(parsed["--state-root"]);
    return { output: { schema_version: 1, contract: "chenyida-erp-operations-monitoring-init/v1", status: "INITIALIZED", state_root_sha256: monitoringSha256(root) }, exitCode: 0 };
  }
  if (command === "status") {
    const { policy, config } = await inputs(parsed, false);
    const view = statusView(await readMonitoringState(parsed["--state-root"], config, policy));
    return { output: view, exitCode: view.status === "UNINITIALIZED" ? 3 : view.pending_event_count ? 2 : view.active_alert_count ? 1 : 0 };
  }
  const { policy, config, resourcePlan } = await inputs(parsed);
  if (command === "collect") {
    const components = parsed["--components"] ? await jsonFile(parsed["--components"]) : null;
    const observation = await collectMonitoringObservation({ policy, resourcePlan, config, components });
    return { output: observation, exitCode: 0 };
  }
  if (command === "evaluate") {
    const observation = validateMonitoringObservation(await jsonFile(parsed["--observation"]));
    const report = await evaluateAndPersist({ policy, resourcePlan, config, observation, stateRoot: parsed["--state-root"] });
    return { output: report, exitCode: report.exit_code };
  }
  if (command === "run") {
    const components = parsed["--components"] ? await jsonFile(parsed["--components"]) : null;
    const observation = await collectMonitoringObservation({ policy, resourcePlan, config, components });
    const report = await evaluateAndPersist({ policy, resourcePlan, config, observation, stateRoot: parsed["--state-root"] });
    return { output: report, exitCode: report.exit_code };
  }
  reject("MONITOR_CLI_ARGUMENT_INVALID");
}

function failureExitCode(code) {
  if (code === "MONITOR_STATE_LOCKED") return 5;
  if (code.startsWith("MONITOR_STATE_") || code.endsWith("_ROLLBACK")) return 4;
  return 3;
}

try {
  const result = await execute(process.argv.slice(2));
  process.stdout.write(canonicalMonitoringJson(result.output));
  process.exitCode = result.exitCode;
} catch (error) {
  const code = error instanceof OpsMonitoringError ? error.code : "MONITOR_INTERNAL_ERROR";
  process.stderr.write(canonicalMonitoringJson({ schema_version: 1, contract: "chenyida-erp-operations-monitoring-error/v1", ok: false, code }));
  process.exitCode = failureExitCode(code);
}
