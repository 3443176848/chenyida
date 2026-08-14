import https from "node:https";

import { OpsMonitoringError, monitoringSha256, parseMonitoringJson } from "./contract.mjs";
import {
  MONITORING_DELIVERY_ACK_CONTRACT,
  MONITORING_DELIVERY_READINESS_CONTRACT,
  MONITORING_DELIVERY_RESULT_CONTRACT,
  MONITORING_REMOTE_ACK_CONTRACT,
  validateDeliveryAckChain,
  validateDeliveryEnvelope,
  validateMonitoringNotifierConfig,
} from "./delivery-contract.mjs";
import {
  prepareDeliveryAttempt,
  readDeliveryAcks,
  readDeliveryEnvelopes,
  readDeliveryGrants,
  recordDeliveryAck,
  recordDeliveryReadiness,
  recordDeliveryResult,
} from "./delivery-store.mjs";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REMOTE_ACK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function reject(code) {
  throw new OpsMonitoringError(code);
}

function credentialBytes(value, expectedSha256) {
  if (!Buffer.isBuffer(value) || value.length < 16 || value.length > 4096 || monitoringSha256(value) !== expectedSha256) reject("MONITOR_NOTIFICATION_CREDENTIAL_INVALID");
  const text = value.toString("utf8");
  if (!/^[\x21-\x7e]{16,4096}\n?$/.test(text) || text.includes("\r")) reject("MONITOR_NOTIFICATION_CREDENTIAL_INVALID");
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function validateRemoteAck(value, { envelope, attempt }) {
  exactKeys(value, ["schema_version", "contract", "status", "remote_ack_id", "event_id", "idempotency_key", "target_id", "target_generation", "attempt_id", "acked_at"], "MONITOR_REMOTE_ACK_FIELDS_INVALID");
  if (value.schema_version !== 1 || value.contract !== MONITORING_REMOTE_ACK_CONTRACT || value.status !== "ACKNOWLEDGED" || typeof value.remote_ack_id !== "string" || !REMOTE_ACK_ID.test(value.remote_ack_id) || value.event_id !== envelope.event_id || value.idempotency_key !== envelope.event_id || value.target_id !== envelope.target_id || value.target_generation !== envelope.target_generation || value.attempt_id !== attempt.attempt_id || typeof value.acked_at !== "string" || !ISO_UTC.test(value.acked_at) || Number.isNaN(Date.parse(value.acked_at))) reject("MONITOR_REMOTE_ACK_INVALID");
  return value;
}

function adapterPayload(envelope, attempt) {
  return {
    schema_version: 1,
    contract: "chenyida-erp-monitoring-notification-request/v1",
    event_id: envelope.event_id,
    idempotency_key: envelope.event_id,
    target_id: envelope.target_id,
    target_generation: envelope.target_generation,
    attempt_id: attempt.attempt_id,
    event: envelope.event,
  };
}

export function createHttpsAckAdapter({ request = https.request } = {}) {
  return Object.freeze({
    id: "HTTPS_JSON_ACK_V1",
    async send({ envelope, attempt, notifierConfig, credential }) {
      const config = validateMonitoringNotifierConfig(notifierConfig);
      if (config.notification.adapter.id !== "HTTPS_JSON_ACK_V1") reject("MONITOR_NOTIFICATION_ADAPTER_MISMATCH");
      const body = Buffer.from(`${JSON.stringify(adapterPayload(envelope, attempt))}\n`, "utf8");
      if (body.length > 64 * 1024) reject("MONITOR_NOTIFICATION_REQUEST_TOO_LARGE");
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
        const endpoint = config.notification.endpoint;
        let call;
        try {
          call = request({
            protocol: "https:",
            hostname: endpoint.host,
            servername: endpoint.tls_server_name,
            port: endpoint.port,
            path: endpoint.path,
            method: "POST",
            timeout: config.notification.ack.timeout_milliseconds,
            maxRedirects: 0,
            headers: {
              "content-type": "application/json",
              "content-length": String(body.length),
              "idempotency-key": envelope.event_id,
              authorization: `Bearer ${credential}`,
              "user-agent": "chenyida-erp-monitoring-host-v1",
            },
          }, (response) => {
            const chunks = [];
            let bytes = 0;
            let ended = false;
            response.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > 16 * 1024) { response.destroy(); finish({ kind: "AMBIGUOUS", code: "REMOTE_RESPONSE_TOO_LARGE", raw: null }); return; }
              chunks.push(chunk);
            });
            response.on("end", () => {
              ended = true;
              const raw = Buffer.concat(chunks);
              const status = Number(response.statusCode || 0);
              if (status < 200 || status >= 300) {
                finish({ kind: status >= 500 || status === 429 ? "RETRYABLE" : "REJECTED", code: status >= 500 ? "REMOTE_SERVER_ERROR" : status === 429 ? "REMOTE_RATE_LIMITED" : "REMOTE_REQUEST_REJECTED", raw });
                return;
              }
              try { finish({ kind: "RESPONSE", value: parseMonitoringJson(raw.toString("utf8"), 16 * 1024), raw }); }
              catch { finish({ kind: "AMBIGUOUS", code: "REMOTE_ACK_INVALID_JSON", raw }); }
            });
            response.on("aborted", () => finish({ kind: "AMBIGUOUS", code: "REMOTE_RESPONSE_ABORTED", raw: chunks.length ? Buffer.concat(chunks) : null }));
            response.on("error", () => finish({ kind: "AMBIGUOUS", code: "REMOTE_RESPONSE_ERROR", raw: chunks.length ? Buffer.concat(chunks) : null }));
            response.on("close", () => { if (!ended && response.complete !== true) finish({ kind: "AMBIGUOUS", code: "REMOTE_RESPONSE_INCOMPLETE", raw: chunks.length ? Buffer.concat(chunks) : null }); });
          });
          call.on("timeout", () => { call.destroy(); finish({ kind: "AMBIGUOUS", code: "REMOTE_TIMEOUT", raw: null }); });
          call.on("error", () => finish({ kind: "AMBIGUOUS", code: "REMOTE_CONNECTION_AMBIGUOUS", raw: null }));
          call.end(body);
        } catch {
          finish({ kind: "AMBIGUOUS", code: "REMOTE_CONNECTION_AMBIGUOUS", raw: null });
        }
      });
    },
  });
}

function createResult({ attempt, now, status, detailCode, raw }) {
  const value = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_RESULT_CONTRACT,
    result_id: "",
    attempt_id: attempt.attempt_id,
    event_id: attempt.event_id,
    recorded_at: now.toISOString(),
    status,
    detail_code: detailCode,
    response_sha256: raw === null ? null : monitoringSha256(raw),
  };
  value.result_id = monitoringSha256({ ...value, result_id: undefined });
  return value;
}

function createAck({ envelope, attempt, result, remoteAck }) {
  const value = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_ACK_CONTRACT,
    ack_id: "",
    event_id: envelope.event_id,
    envelope_id: envelope.envelope_id,
    attempt_id: attempt.attempt_id,
    result_id: result.result_id,
    target_id: attempt.target_id,
    target_generation: attempt.target_generation,
    notifier_config_sha256: attempt.notifier_config_sha256,
    credential_sha256: attempt.credential_sha256,
    credential_generation: attempt.credential_generation,
    remote_ack_id_sha256: monitoringSha256(remoteAck.remote_ack_id),
    acked_at: remoteAck.acked_at,
    verification: "EXACT_REMOTE_ACK_V1",
  };
  value.ack_id = monitoringSha256({ ...value, ack_id: undefined });
  return value;
}

export function createDeliveryReadiness({ notifierConfig, credential, envelope, grant, claim, attempt, result, ack }) {
  const config = validateMonitoringNotifierConfig(notifierConfig);
  credentialBytes(credential, config.notification.credential.sha256);
  const chain = validateDeliveryAckChain({ envelope, grant, claim, attempt, result, ack });
  if (chain.attempt.notifier_config_sha256 !== monitoringSha256(config) || chain.attempt.target_id !== config.notification.target_id || chain.attempt.target_generation !== config.notification.target_generation || chain.attempt.credential_sha256 !== config.notification.credential.sha256 || chain.attempt.credential_generation !== config.notification.credential.generation || chain.attempt.adapter_id !== config.notification.adapter.id || chain.attempt.adapter_sha256 !== config.notification.adapter.source_sha256) reject("MONITOR_DELIVERY_READINESS_BINDING_INVALID");
  const verifiedAt = chain.result.recorded_at;
  const value = {
    schema_version: 1,
    contract: MONITORING_DELIVERY_READINESS_CONTRACT,
    readiness_id: "",
    status: "READY",
    event_id: chain.envelope.event_id,
    envelope_id: chain.envelope.envelope_id,
    grant_id: chain.grant.grant_id,
    claim_id: chain.claim.claim_id,
    attempt_id: chain.attempt.attempt_id,
    result_id: chain.result.result_id,
    ack_id: chain.ack.ack_id,
    remote_ack_id_sha256: chain.ack.remote_ack_id_sha256,
    target_id: config.notification.target_id,
    target_generation: config.notification.target_generation,
    notifier_config_sha256: monitoringSha256(config),
    credential_sha256: config.notification.credential.sha256,
    credential_generation: config.notification.credential.generation,
    adapter_id: config.notification.adapter.id,
    adapter_sha256: config.notification.adapter.source_sha256,
    verified_at: verifiedAt,
    expires_at: new Date(Date.parse(verifiedAt) + 120_000).toISOString(),
  };
  value.readiness_id = monitoringSha256({ ...value, readiness_id: undefined });
  return value;
}

export async function deliverPendingEvent({ outboxRoot, deliveryRoot, notifierConfig, credential, pendingEventIds = null, adapter = null, now = new Date(), storeOptions = {}, hooks = {} }) {
  const config = validateMonitoringNotifierConfig(notifierConfig);
  const secret = credentialBytes(credential, config.notification.credential.sha256);
  if (pendingEventIds !== null && (!(pendingEventIds instanceof Set) || [...pendingEventIds].some((eventId) => typeof eventId !== "string" || !/^[0-9a-f]{64}$/.test(eventId)))) reject("MONITOR_DELIVERY_PENDING_SET_INVALID");
  const [envelopes, grants, acknowledgements] = await Promise.all([readDeliveryEnvelopes(outboxRoot, storeOptions.outbox || {}), readDeliveryGrants(outboxRoot, storeOptions.outbox || {}), readDeliveryAcks(deliveryRoot, storeOptions.delivery || storeOptions)]);
  const acknowledged = new Set(acknowledgements.map((entry) => entry.event_id));
  const granted = new Map(grants.map((entry) => [entry.event_id, entry]));
  const candidates = envelopes.filter((candidate) => (pendingEventIds === null || pendingEventIds.has(candidate.event_id)) && granted.get(candidate.event_id)?.envelope_id === candidate.envelope_id && !acknowledged.has(candidate.event_id));
  let envelope = null;
  let prepared = null;
  let exhausted = false;
  for (const candidate of candidates) {
    try {
      prepared = await prepareDeliveryAttempt({ root: deliveryRoot, envelope: candidate, notifierConfig: config, now, options: storeOptions.delivery || storeOptions });
      envelope = candidate;
      break;
    } catch (error) {
      if (error instanceof OpsMonitoringError && error.code === "MONITOR_DELIVERY_ATTEMPT_LIMIT_REACHED") { exhausted = true; continue; }
      throw error;
    }
  }
  if (!envelope && exhausted) return Object.freeze({ status: "EXHAUSTED", event_id: null, attempt_no: null, acknowledged: false });
  if (!envelope) return Object.freeze({ status: "IDLE", event_id: null, attempt_no: null, acknowledged: false });
  validateDeliveryEnvelope(envelope);
  await hooks.afterAttemptPersisted?.(prepared);
  let selected = adapter;
  if (selected === null) selected = createHttpsAckAdapter();
  if (!selected || typeof selected.send !== "function" || selected.id !== config.notification.adapter.id) reject("MONITOR_NOTIFICATION_ADAPTER_INVALID");
  const response = await selected.send({ envelope, attempt: prepared.attempt, notifierConfig: config, credential: secret });
  await hooks.afterSend?.({ response, prepared });
  let result;
  let remoteAck = null;
  if (response?.kind === "RESPONSE") {
    try {
      remoteAck = validateRemoteAck(response.value, { envelope, attempt: prepared.attempt });
      result = createResult({ attempt: prepared.attempt, now, status: "ACKNOWLEDGED", detailCode: "REMOTE_ACK_VERIFIED", raw: response.raw });
    } catch {
      result = createResult({ attempt: prepared.attempt, now, status: "AMBIGUOUS", detailCode: "REMOTE_ACK_BINDING_INVALID", raw: response.raw || null });
    }
  } else {
    const status = response?.kind === "RETRYABLE" ? "RETRYABLE" : response?.kind === "REJECTED" ? "REJECTED" : "AMBIGUOUS";
    const code = typeof response?.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(response.code) ? response.code : "REMOTE_RESULT_AMBIGUOUS";
    result = createResult({ attempt: prepared.attempt, now, status, detailCode: code, raw: Buffer.isBuffer(response?.raw) ? response.raw : null });
  }
  await recordDeliveryResult(deliveryRoot, result, { ...(storeOptions.delivery || storeOptions), attemptNo: prepared.attempt.attempt_no });
  if (remoteAck === null) return Object.freeze({ status: result.status, event_id: envelope.event_id, attempt_no: prepared.attempt.attempt_no, acknowledged: false });
  const ack = createAck({ envelope, attempt: prepared.attempt, result, remoteAck });
  await recordDeliveryAck(deliveryRoot, ack, storeOptions.delivery || storeOptions);
  const readiness = createDeliveryReadiness({ notifierConfig: config, credential, envelope, grant: granted.get(envelope.event_id), claim: prepared.claim, attempt: prepared.attempt, result, ack });
  await recordDeliveryReadiness(deliveryRoot, readiness, storeOptions.delivery || storeOptions);
  return Object.freeze({ status: "ACKNOWLEDGED", event_id: envelope.event_id, attempt_no: prepared.attempt.attempt_no, acknowledged: true });
}
