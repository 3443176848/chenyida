#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

import {
  OpsMonitoringError,
  acknowledgeMonitoringEvents,
  canonicalMonitoringJson,
  emptyComponentObservation,
  evaluateMonitoringObservation,
  monitoringSha256,
  parseMonitoringJson,
  validateMonitoringPolicy,
} from "./contract.mjs";
import { collectMonitoringObservation } from "./collector.mjs";
import {
  backupProjectionObservation,
  backupProjectionWatermark,
  validateBackupProjectionForEvaluation,
} from "./backup-projection.mjs";
import {
  componentsProjectionObservation,
  componentsProjectionWatermark,
  validateComponentsProjectionForEvaluation,
} from "./components-projection.mjs";
import {
  createDeliveryEnvelope,
  createDeliveryGrant,
  deriveMonitoringHostConfigViews,
  validateDeliveryAckChain,
  validateMonitoringEvaluatorConfig,
  validateMonitoringHostConfig,
  validateMonitoringNotifierConfig,
} from "./delivery-contract.mjs";
import {
  publishDeliveryEnvelope,
  publishDeliveryGrant,
  readDeliveryAcks,
  readDeliveryAttempts,
  readDeliveryClaims,
  readDeliveryEnvelopes,
  readDeliveryGrants,
  readDeliveryReadiness,
  readDeliveryResults,
} from "./delivery-store.mjs";
import {
  assertMonitoringHostStateCurrent,
  createMonitoringHostState,
  publishMonitoringObservation,
  readMonitoringHostState,
  readMonitoringObservation,
  recoverMonitoringHostStateWrite,
  writeMonitoringHostState,
} from "./host-store.mjs";
import { deliverPendingEvent } from "./notifier.mjs";

const REQUIRED_ENVIRONMENT = Object.freeze([
  "ERP_MONITORING_POLICY",
  "ERP_MONITORING_RESOURCE_PLAN",
  "ERP_MONITORING_PRIVATE_CONFIG",
  "ERP_MONITORING_EVALUATOR_CONFIG",
  "ERP_MONITORING_NOTIFIER_CONFIG",
  "ERP_MONITORING_OBSERVATION_ROOT",
  "ERP_MONITORING_STATE_ROOT",
  "ERP_MONITORING_OUTBOX_ROOT",
  "ERP_MONITORING_DELIVERY_ROOT",
]);

function reject(code) {
  throw new OpsMonitoringError(code);
}

function absoluteEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value !== path.resolve(value) || value === path.parse(value).root) reject("MONITOR_HOST_ENVIRONMENT_INVALID");
  return value;
}

function runtimePaths() {
  if (process.env.ERP_MONITORING_HOST_LAUNCHED !== "YES") reject("MONITOR_HOST_LAUNCH_CONTEXT_INVALID");
  return Object.fromEntries(REQUIRED_ENVIRONMENT.map((name) => [name, absoluteEnvironment(name)]));
}

async function safeBytes(file, { modes, owners, minimum = 2, maximum = 2 * 1024 * 1024, code }) {
  if (file !== path.resolve(file) || file === path.parse(file).root) reject(code);
  const before = await lstat(file).catch(() => reject(code));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !modes.includes(before.mode & 0o7777) || !owners.some((entry) => before.uid === entry.uid && before.gid === entry.gid) || before.size < minimum || before.size > maximum) reject(code);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => reject(code));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) reject(`${code}_CHANGED`);
    const raw = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(file).catch(() => null);
    if (!pathAfter || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || pathAfter.nlink !== 1 || !modes.includes(pathAfter.mode & 0o7777) || !owners.some((entry) => pathAfter.uid === entry.uid && pathAfter.gid === entry.gid)) reject(`${code}_CHANGED`);
    return raw;
  } finally { await handle.close(); }
}

async function safeJson(file, options) {
  const raw = await safeBytes(file, options);
  const value = parseMonitoringJson(raw.toString("utf8"), options.maximum);
  if (raw.toString("utf8") !== canonicalMonitoringJson(value)) reject(`${options.code}_NOT_CANONICAL`);
  return value;
}

function currentIdentity() {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) reject("MONITOR_HOST_IDENTITY_UNAVAILABLE");
  return { uid, gid };
}

async function commonInputs(paths) {
  const root = { uid: 0, gid: 0 };
  const policy = validateMonitoringPolicy(await safeJson(paths.ERP_MONITORING_POLICY, { modes: [0o444], owners: [root], maximum: 256 * 1024, code: "MONITOR_HOST_POLICY_INVALID" }));
  const resourcePlan = await safeJson(paths.ERP_MONITORING_RESOURCE_PLAN, { modes: [0o444], owners: [root], maximum: 1024 * 1024, code: "MONITOR_HOST_RESOURCE_PLAN_INVALID" });
  return { policy, resourcePlan };
}

async function optionalBackupProjection(evaluatorConfig, previousWatermark, expectedOwner, evaluationTime) {
  const file = evaluatorConfig.evidence.backup_projection_path;
  const exists = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject("MONITOR_BACKUP_PROJECTION_FILE_INVALID"));
  if (exists === null) return null;
  const value = await safeJson(file, { modes: [0o440], owners: [expectedOwner], maximum: 256 * 1024, code: "MONITOR_BACKUP_PROJECTION_FILE_INVALID" });
  return validateBackupProjectionForEvaluation(value, evaluatorConfig, previousWatermark, evaluationTime);
}

async function optionalComponentsProjection(evaluatorConfig, previousWatermark, expectedOwner) {
  const file = evaluatorConfig.evidence.components_projection_path;
  const exists = await lstat(file).catch((error) => error?.code === "ENOENT" ? null : reject("MONITOR_COMPONENTS_PROJECTION_FILE_INVALID"));
  if (exists === null) return null;
  const value = await safeJson(file, { modes: [0o440], owners: [expectedOwner], maximum: 256 * 1024, code: "MONITOR_COMPONENTS_PROJECTION_FILE_INVALID" });
  return validateComponentsProjectionForEvaluation(value, evaluatorConfig, previousWatermark);
}

function storeOwnership(evaluatorConfig) {
  return {
    observation: {
      rootOwner: { uid: 0, gid: evaluatorConfig.identity.gid },
      fileOwner: { uid: 0, gid: evaluatorConfig.identity.gid },
      rootMode: 0o750,
      fileMode: 0o440,
    },
    outbox: {
      rootOwner: { uid: evaluatorConfig.identity.uid, gid: evaluatorConfig.notifier_identity.gid },
      fileOwner: { uid: evaluatorConfig.identity.uid, gid: evaluatorConfig.notifier_identity.gid },
      rootMode: 0o2750,
      fileMode: 0o440,
    },
    delivery: {
      rootOwner: { uid: evaluatorConfig.notifier_identity.uid, gid: evaluatorConfig.identity.gid },
      fileOwner: { uid: evaluatorConfig.notifier_identity.uid, gid: evaluatorConfig.identity.gid },
      rootMode: 0o2750,
      fileMode: 0o440,
    },
  };
}

async function ensurePendingDelivery({ hostState, evaluatorConfig, outboxRoot, ownership, envelopesByEvent, grantsByEvent }) {
  for (const event of hostState.monitoring_state.pending_events) {
    if (event.delivery.status === "EVENT_FILE_ONLY") continue;
    const expectedEnvelope = createDeliveryEnvelope({ event, evaluatorConfig });
    await publishDeliveryEnvelope(outboxRoot, expectedEnvelope, ownership.outbox);
    const envelope = envelopesByEvent.get(event.event_id) || expectedEnvelope;
    if (envelope.envelope_id !== expectedEnvelope.envelope_id) reject("MONITOR_DELIVERY_PENDING_ENVELOPE_CONFLICT");
    envelopesByEvent.set(event.event_id, envelope);
    const existingGrant = grantsByEvent.get(event.event_id);
    if (existingGrant) {
      if (existingGrant.envelope_id !== envelope.envelope_id) reject("MONITOR_DELIVERY_PENDING_GRANT_CONFLICT");
      continue;
    }
    const grant = createDeliveryGrant({ envelope, hostStateSha256: hostState.integrity_sha256, hostStateSequence: hostState.wrapper_sequence, grantedAt: hostState.updated_at });
    await publishDeliveryGrant(outboxRoot, grant, ownership.outbox);
    grantsByEvent.set(event.event_id, grant);
  }
}

async function collector(paths) {
  const identity = currentIdentity();
  if (identity.uid !== 0 || identity.gid !== 0) reject("MONITOR_COLLECTOR_ROOT_REQUIRED");
  const privateConfig = validateMonitoringHostConfig(await safeJson(paths.ERP_MONITORING_PRIVATE_CONFIG, { modes: [0o400], owners: [{ uid: 0, gid: 0 }], maximum: 256 * 1024, code: "MONITOR_HOST_PRIVATE_CONFIG_INVALID" }));
  const views = deriveMonitoringHostConfigViews(privateConfig);
  const { policy, resourcePlan } = await commonInputs(paths);
  const observedAt = new Date().toISOString();
  const components = structuredClone(emptyComponentObservation());
  const expectedOwner = { uid: 0, gid: views.evaluator.identity.gid };
  const componentsProjection = await optionalComponentsProjection(views.evaluator, undefined, expectedOwner);
  const backupProjection = await optionalBackupProjection(views.evaluator, undefined, expectedOwner, { observed_at: observedAt, max_clock_skew_seconds: policy.max_clock_skew_seconds });
  if (componentsProjection !== null) Object.assign(components, componentsProjectionObservation(componentsProjection));
  if (backupProjection !== null) components.backup = backupProjectionObservation(backupProjection, observedAt, policy.max_clock_skew_seconds);
  const notifierSha = monitoringSha256(views.notifier);
  const ownership = storeOwnership(views.evaluator);
  const deliveryExists = await lstat(paths.ERP_MONITORING_DELIVERY_ROOT).then(() => true).catch(() => false);
  if (deliveryExists) {
    const readiness = await readDeliveryReadiness(paths.ERP_MONITORING_DELIVERY_ROOT, notifierSha, ownership.delivery);
    if (readiness && readiness.target_id === views.notifier.notification.target_id && readiness.target_generation === views.notifier.notification.target_generation && readiness.credential_sha256 === views.notifier.notification.credential.sha256 && Date.parse(readiness.verified_at) <= Date.parse(observedAt) && Date.parse(readiness.expires_at) >= Date.parse(observedAt)) components.notification = { status: "READY", target_id: readiness.target_id };
  }
  const observation = await collectMonitoringObservation({ policy, resourcePlan, config: views.evaluator.monitoring, components, source: "HOST_PROJECTIONS", clock: () => new Date(observedAt) });
  await publishMonitoringObservation(paths.ERP_MONITORING_OBSERVATION_ROOT, observation, ownership.observation);
  return { output: { schema_version: 1, contract: "chenyida-erp-monitoring-collector-result/v1", status: "PUBLISHED", observation_id: observation.observation_id, observed_at: observation.observed_at }, exitCode: 0 };
}

async function evaluator(paths) {
  const identity = currentIdentity();
  const evaluatorConfig = validateMonitoringEvaluatorConfig(await safeJson(paths.ERP_MONITORING_EVALUATOR_CONFIG, { modes: [0o440], owners: [{ uid: 0, gid: identity.gid }], maximum: 256 * 1024, code: "MONITOR_EVALUATOR_CONFIG_FILE_INVALID" }));
  if (identity.uid !== evaluatorConfig.identity.uid || identity.gid !== evaluatorConfig.identity.gid) reject("MONITOR_EVALUATOR_IDENTITY_INVALID");
  const { policy, resourcePlan } = await commonInputs(paths);
  const ownership = storeOwnership(evaluatorConfig);
  const lockFd = Number(process.env.ERP_MONITORING_LOCK_FD);
  let previous = await recoverMonitoringHostStateWrite(paths.ERP_MONITORING_STATE_ROOT, evaluatorConfig, policy, lockFd);
  const observation = await readMonitoringObservation(paths.ERP_MONITORING_OBSERVATION_ROOT, ownership.observation);
  const [acks, claims, attempts, results, envelopes, grants] = await Promise.all([
    readDeliveryAcks(paths.ERP_MONITORING_DELIVERY_ROOT, ownership.delivery),
    readDeliveryClaims(paths.ERP_MONITORING_DELIVERY_ROOT, ownership.delivery),
    readDeliveryAttempts(paths.ERP_MONITORING_DELIVERY_ROOT, ownership.delivery),
    readDeliveryResults(paths.ERP_MONITORING_DELIVERY_ROOT, ownership.delivery),
    readDeliveryEnvelopes(paths.ERP_MONITORING_OUTBOX_ROOT, ownership.outbox),
    readDeliveryGrants(paths.ERP_MONITORING_OUTBOX_ROOT, ownership.outbox),
  ]);
  const envelopesByEvent = new Map(envelopes.map((entry) => [entry.event_id, entry]));
  const grantsByEvent = new Map(grants.map((entry) => [entry.event_id, entry]));
  const claimsById = new Map(claims.map((entry) => [entry.claim_id, entry]));
  const attemptsById = new Map(attempts.map((entry) => [entry.attempt_id, entry]));
  const resultsById = new Map(results.map((entry) => [entry.result_id, entry]));
  const pendingIds = new Set((previous?.monitoring_state.pending_events || []).map((event) => event.event_id));
  const acknowledgedIds = [];
  for (const ack of acks) {
    const envelope = envelopesByEvent.get(ack.event_id);
    if (!envelope) reject("MONITOR_DELIVERY_ACK_ENVELOPE_MISSING");
    const attempt = attemptsById.get(ack.attempt_id);
    const result = resultsById.get(ack.result_id);
    const claim = attempt ? claimsById.get(attempt.claim_id) : null;
    const grant = grantsByEvent.get(ack.event_id);
    if (!attempt || !result || !claim || !grant) reject("MONITOR_DELIVERY_ACK_CHAIN_MISSING");
    validateDeliveryAckChain({ ack, envelope, grant, claim, attempt, result });
    if (pendingIds.has(ack.event_id)) acknowledgedIds.push(ack.event_id);
  }
  if (acknowledgedIds.length) {
    const acknowledgedState = acknowledgeMonitoringEvents({ state: previous.monitoring_state, eventIds: acknowledgedIds, config: evaluatorConfig.monitoring, policy });
    const ackWrapper = createMonitoringHostState({ previous, evaluatorConfig, policy, monitoringState: acknowledgedState, acknowledgedEventIds: acknowledgedIds, updatedAt: new Date().toISOString() });
    previous = await writeMonitoringHostState(paths.ERP_MONITORING_STATE_ROOT, ackWrapper, evaluatorConfig, policy, lockFd);
  }
  if (previous !== null) await ensurePendingDelivery({ hostState: previous, evaluatorConfig, outboxRoot: paths.ERP_MONITORING_OUTBOX_ROOT, ownership, envelopesByEvent, grantsByEvent });
  const expectedProjectionOwner = { uid: 0, gid: evaluatorConfig.identity.gid };
  const componentsCollected = observation.application.live.status !== "NOT_COLLECTED" || observation.application.readiness.status !== "NOT_COLLECTED" || !["NOT_COLLECTED", "UNCONFIGURED"].includes(observation.release.status);
  const componentsProjection = componentsCollected ? await optionalComponentsProjection(evaluatorConfig, previous?.components_watermark || null, expectedProjectionOwner) : null;
  if ((componentsProjection === null) !== !componentsCollected) reject("MONITOR_COMPONENTS_OBSERVATION_PROJECTION_MISMATCH");
  if (componentsProjection !== null) {
    const projected = componentsProjectionObservation(componentsProjection);
    if (canonicalMonitoringJson(projected.application) !== canonicalMonitoringJson(observation.application) || canonicalMonitoringJson(projected.release) !== canonicalMonitoringJson(observation.release)) reject("MONITOR_COMPONENTS_OBSERVATION_PROJECTION_MISMATCH");
  }
  const backupProjection = observation.backup.status === "AVAILABLE" ? await optionalBackupProjection(evaluatorConfig, previous?.backup_watermark || null, expectedProjectionOwner, { observed_at: observation.observed_at, max_clock_skew_seconds: policy.max_clock_skew_seconds }) : null;
  if ((backupProjection === null) !== (observation.backup.status === "NOT_COLLECTED")) reject("MONITOR_BACKUP_OBSERVATION_PROJECTION_MISMATCH");
  if (backupProjection !== null && canonicalMonitoringJson(backupProjectionObservation(backupProjection, observation.observed_at, policy.max_clock_skew_seconds)) !== canonicalMonitoringJson(observation.backup)) reject("MONITOR_BACKUP_OBSERVATION_PROJECTION_MISMATCH");
  const result = evaluateMonitoringObservation({ policy, resourcePlan, config: evaluatorConfig.monitoring, observation, previousState: previous?.monitoring_state || null, now: new Date() });
  const wrapper = createMonitoringHostState({
    previous,
    evaluatorConfig,
    policy,
    monitoringState: result.nextState,
    componentsWatermark: componentsProjection === null ? previous?.components_watermark || null : componentsProjectionWatermark(componentsProjection),
    backupWatermark: backupProjection === null ? previous?.backup_watermark || null : backupProjectionWatermark(backupProjection),
    updatedAt: new Date().toISOString(),
  });
  const persisted = await writeMonitoringHostState(paths.ERP_MONITORING_STATE_ROOT, wrapper, evaluatorConfig, policy, lockFd);
  assertMonitoringHostStateCurrent(persisted, evaluatorConfig, policy);
  await ensurePendingDelivery({ hostState: persisted, evaluatorConfig, outboxRoot: paths.ERP_MONITORING_OUTBOX_ROOT, ownership, envelopesByEvent, grantsByEvent });
  return { output: result.report, exitCode: result.report.pending_event_count ? 2 : result.report.active_alert_count ? 1 : 0 };
}

async function notifier(paths) {
  const identity = currentIdentity();
  const config = validateMonitoringNotifierConfig(await safeJson(paths.ERP_MONITORING_NOTIFIER_CONFIG, { modes: [0o440], owners: [{ uid: 0, gid: identity.gid }], maximum: 256 * 1024, code: "MONITOR_NOTIFIER_CONFIG_FILE_INVALID" }));
  if (identity.uid !== config.identity.uid || identity.gid !== config.identity.gid) reject("MONITOR_NOTIFIER_IDENTITY_INVALID");
  if (config.notification.adapter.id !== "HTTPS_JSON_ACK_V1") reject("MONITOR_FAKE_ADAPTER_RUNTIME_FORBIDDEN");
  const credentialDirectory = absoluteEnvironment("CREDENTIALS_DIRECTORY");
  const credential = await safeBytes(path.join(credentialDirectory, "notification"), { modes: [0o400, 0o440], owners: [{ uid: 0, gid: 0 }, identity], minimum: 16, maximum: 4096, code: "MONITOR_NOTIFICATION_CREDENTIAL_FILE_INVALID" });
  const evaluatorConfig = {
    identity: config.evaluator_identity,
    notifier_identity: config.identity,
  };
  const ownership = storeOwnership(evaluatorConfig);
  const result = await deliverPendingEvent({ outboxRoot: paths.ERP_MONITORING_OUTBOX_ROOT, deliveryRoot: paths.ERP_MONITORING_DELIVERY_ROOT, notifierConfig: config, credential, storeOptions: { outbox: ownership.outbox, delivery: ownership.delivery } });
  return { output: { schema_version: 1, contract: "chenyida-erp-monitoring-notifier-result/v1", ...result }, exitCode: ["IDLE", "ACKNOWLEDGED"].includes(result.status) ? 0 : 2 };
}

async function continuity(paths) {
  const identity = currentIdentity();
  const config = validateMonitoringEvaluatorConfig(await safeJson(paths.ERP_MONITORING_EVALUATOR_CONFIG, { modes: [0o440], owners: [{ uid: 0, gid: identity.gid }], maximum: 256 * 1024, code: "MONITOR_EVALUATOR_CONFIG_FILE_INVALID" }));
  if (identity.uid !== config.identity.uid || identity.gid !== config.identity.gid) reject("MONITOR_EVALUATOR_IDENTITY_INVALID");
  const { policy } = await commonInputs(paths);
  const state = await readMonitoringHostState(paths.ERP_MONITORING_STATE_ROOT, config, policy);
  if (state === null || Date.now() - Date.parse(state.monitoring_state.last_observed_at) > policy.max_sample_gap_seconds * 1000) reject("MONITOR_CONTINUITY_STALE");
  assertMonitoringHostStateCurrent(state, config, policy);
  return { output: { schema_version: 1, contract: "chenyida-erp-monitoring-continuity-result/v1", status: "CURRENT", last_observed_at: state.monitoring_state.last_observed_at }, exitCode: 0 };
}

async function execute() {
  const phase = process.argv[2];
  if (process.argv.length !== 3 || !new Set(["collector", "evaluator", "notifier", "continuity"]).has(phase)) reject("MONITOR_HOST_RUNNER_ARGUMENT_INVALID");
  const paths = runtimePaths();
  if (phase === "collector") return collector(paths);
  if (phase === "evaluator") return evaluator(paths);
  if (phase === "notifier") return notifier(paths);
  return continuity(paths);
}

try {
  const result = await execute();
  process.stdout.write(canonicalMonitoringJson(result.output));
  process.exitCode = result.exitCode;
} catch (error) {
  const code = error instanceof OpsMonitoringError ? error.code : "MONITOR_HOST_INTERNAL_ERROR";
  process.stderr.write(canonicalMonitoringJson({ schema_version: 1, contract: "chenyida-erp-monitoring-host-error/v1", ok: false, code }));
  process.exitCode = code === "MONITOR_CONTINUITY_STALE" ? 4 : code.includes("LOCK") ? 5 : 3;
}
