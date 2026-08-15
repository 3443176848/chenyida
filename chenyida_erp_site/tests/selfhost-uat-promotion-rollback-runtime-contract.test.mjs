import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canonicalClusterJson,
  clusterSha256,
} from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX,
  UAT_PROMOTION_ROLLBACK_RUNTIME_DOCKER,
  UAT_PROMOTION_ROLLBACK_RUNTIME_EXECUTOR,
  createUatPromotionRollbackRuntimeActivation,
  createUatPromotionRollbackRuntimeOriginalObservation,
  createUatPromotionRollbackRuntimePlan,
  createUatPromotionRollbackRuntimeRequest,
  createUatPromotionRollbackRuntimeResponse,
  deriveUatPromotionRollbackRuntimeSourceRoles,
  deriveUatPromotionRollbackRuntimeTargets,
  validateUatPromotionRollbackRuntimeActivation,
  validateUatPromotionRollbackRuntimeObservation,
  validateUatPromotionRollbackRuntimeRequest,
  validateUatPromotionRollbackRuntimeResponse,
} from "../scripts/uat-promotion-rollback-runtime-contract.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const image = (name) => `registry.example.com/chenyida/${name}@sha256:${digest(name)}`;
const operationId = "rollback-runtime-contract-001";
const adapterPath = fileURLToPath(new URL("../scripts/uat-promotion-rollback-runtime-adapter.py", import.meta.url));

function pythonCanonicalRoundTrip(value) {
  const source = String.raw`
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("rollback_runtime_adapter", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
value = module.parse_json(sys.stdin.buffer.read(), "GOLDEN_VECTOR_INVALID")
result = {"canonical_hex": module.canonical(value).hex(), "sha256": module.sha256_value(value)}
sys.stdout.buffer.write(module.canonical(result))
`;
  const result = spawnSync("/usr/bin/python3", ["-c", source, adapterPath], {
    input: Buffer.from(canonicalClusterJson(value)), maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  assert.equal(result.stderr.length, 0);
  return JSON.parse(result.stdout.toString("utf8"));
}

function pythonRejectsRawJson(raw) {
  const source = String.raw`
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("rollback_runtime_adapter", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    module.parse_json(sys.stdin.buffer.read(), "GOLDEN_VECTOR_INVALID")
except module.AdapterError:
    raise SystemExit(0)
raise SystemExit(1)
`;
  return spawnSync("/usr/bin/python3", ["-c", source, adapterPath], { input: Buffer.from(raw) }).status === 0;
}

function runtimePlan() {
  return createUatPromotionRollbackRuntimePlan({
    promotion_id: "promotion-runtime-contract-001",
    promotion_generation: 1,
    rollback_operation_id: operationId,
    deployment: {
      class: "UAT", id: "chenyida-erp", compose_project: "chenyida-erp",
      compose_project_root: "/opt/erp/chenyida_erp_site",
      database: {
        name: "chenyida_erp", system_identifier: "7612345678901234567", oid: "16384",
        marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
      },
    },
    candidate: {
      services: Object.fromEntries(["caddy", "postgres", "web", "worker"].map((service) => [service, {
        service, container_id: digest(`container:${service}`), image_reference: image(service),
        image_digest: `sha256:${digest(`image:${service}`)}`,
      }])),
      volumes: Object.fromEntries(["uploads", "attachments", "backup_status"].map((domain) => [domain, {
        domain, name: `chenyida-erp_erp_${domain}`, identity_sha256: digest(`volume:${domain}`),
      }])),
      protected_resources_sha256: digest("protected-runtime"),
    },
    predecessor: {
      release_manifest_sha256: digest("predecessor-manifest"),
      postdeploy_receipt_sha256: digest("predecessor-receipt"),
      runtime_configuration_sha256: digest("predecessor-runtime"),
      web_image: image("predecessor-web"), worker_image: image("predecessor-worker"),
    },
    toolchain: {
      executor: {
        path: UAT_PROMOTION_ROLLBACK_RUNTIME_EXECUTOR,
        sha256: digest("executor"), uid: 0, gid: 0, mode: "0555",
      },
      docker: {
        path: UAT_PROMOTION_ROLLBACK_RUNTIME_DOCKER,
        sha256: digest("docker"), uid: 0, gid: 0, mode: "0555",
      },
    },
    source_bindings: {
      snapshot_objects_sha256: digest("snapshot-objects"),
      snapshot_reconciliation_sha256: digest("snapshot-reconciliation"),
      deployment_environment_sha256: digest("deployment-environment"),
      compose_file_sha256: digest("compose"),
      compose_release_file_sha256: digest("compose-release"),
      runtime_policy_sha256: digest("runtime-policy"),
    },
  });
}

function requestInput(overrides = {}) {
  const plan = runtimePlan();
  const context = {
    operation: "ROLLBACK_EXECUTION", operation_id: operationId, execution_mode: "ORIGINAL",
  };
  const payload = {
    context,
    transaction_intent: { rollback_intent_sha256: digest("transaction-intent") },
    execution_package: { package_sha256: digest("package") },
  };
  const body = {
    action: "PREFLIGHT", operation: "ROLLBACK_EXECUTION", operation_id: operationId,
    execution_mode: "ORIGINAL", label: null,
    execution_package_sha256: digest("package"), source_set_sha256: digest("source-set"),
    transaction_intent_sha256: digest("transaction-intent"), record_intent_sha256: "0".repeat(64),
    runtime_plan_sha256: plan.runtime_plan_sha256, previous_result_sha256: "0".repeat(64),
    payload, requested_at: "2026-08-15T02:00:00.000Z",
    execution_deadline: "2026-08-15T03:00:00.000Z",
    authorization_expires_at: "2026-08-15T02:15:00.000Z",
    action_deadline: "2026-08-15T02:02:00.000Z", ...overrides,
  };
  body.source_roles = deriveUatPromotionRollbackRuntimeSourceRoles(body);
  return body;
}

test("runtime plan derives deterministic staging database, volumes, and immutable action matrix", () => {
  const plan = runtimePlan();
  assert.deepEqual(plan.targets, deriveUatPromotionRollbackRuntimeTargets(operationId));
  assert.deepEqual(plan.action_matrix, UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX);
  assert.notEqual(plan.targets.database.staging, plan.targets.database.active);
  assert.notEqual(plan.targets.volumes.uploads.target, plan.candidate.volumes.uploads.name);
});

test("runtime activation requires distinct approver and an unmodified content-addressed plan", () => {
  const activation = createUatPromotionRollbackRuntimeActivation({
    activation_id: "rollback-runtime-activation-001",
    approved_at: "2026-08-15T02:00:00.000Z",
    expires_at: "2026-08-15T03:00:00.000Z",
    requester_identity_sha256: digest("requester"),
    approver_identity_sha256: digest("approver"),
    plan: runtimePlan(),
  });
  assert.equal(validateUatPromotionRollbackRuntimeActivation(
    activation, { now: new Date("2026-08-15T02:30:00.000Z") },
  ), activation);
  assert.throws(
    () => validateUatPromotionRollbackRuntimeActivation({
      ...activation, plan: { ...activation.plan, max_output_bytes: 1 },
    }, { now: new Date("2026-08-15T02:30:00.000Z") }),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_PLAN_INVALID|UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_INVALID/,
  );
  assert.throws(
    () => validateUatPromotionRollbackRuntimeActivation(activation, {
      now: new Date("2026-08-15T02:30:00.000Z"),
      executionDeadline: "2026-08-15T03:00:01.000Z",
    }),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_ACTIVATION_INVALID/,
  );
  assert.equal(validateUatPromotionRollbackRuntimeActivation(activation, {
    now: new Date("2026-08-16T02:30:00.000Z"), allowExpired: true,
    executionDeadline: "2026-08-15T02:59:59.000Z",
  }), activation);
});

test("canonical request binds payload, transaction, package, plan, deadline, action, and label", () => {
  const request = createUatPromotionRollbackRuntimeRequest(requestInput());
  assert.equal(validateUatPromotionRollbackRuntimeRequest(request), request);
  assert.equal(request.payload_sha256, clusterSha256(request.payload));
  assert.throws(
    () => validateUatPromotionRollbackRuntimeRequest({
      ...request, payload: { ...request.payload, substituted: true },
    }),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_INVALID/,
  );
  const roleDriftBody = { ...request, source_roles: request.source_roles.slice(1) };
  delete roleDriftBody.request_sha256;
  const roleDrift = { ...roleDriftBody, request_sha256: clusterSha256(roleDriftBody) };
  assert.throws(
    () => validateUatPromotionRollbackRuntimeRequest(roleDrift),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_INVALID/,
  );
  assert.throws(
    () => createUatPromotionRollbackRuntimeRequest(requestInput({
      authorization_expires_at: "2026-08-15T02:01:00.000Z",
      action_deadline: "2026-08-15T02:01:01.000Z",
    })),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_INVALID/,
  );
});

test("recovery mode can probe and contain but can never execute a stage", () => {
  assert.throws(
    () => createUatPromotionRollbackRuntimeRequest(requestInput({
      action: "EXECUTE", execution_mode: "RECOVERY", label: "POSTGRESQL_RESTORE",
      record_intent_sha256: digest("record-intent"),
      payload: {
        context: { operation: "ROLLBACK_EXECUTION", operation_id: operationId, execution_mode: "RECOVERY" },
        transaction_intent: { rollback_intent_sha256: digest("transaction-intent") },
        execution_package: { package_sha256: digest("package") },
      },
    })),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_REQUEST_INVALID/,
  );
});

test("runtime response is bound to the exact request and runtime plan", () => {
  const request = createUatPromotionRollbackRuntimeRequest(requestInput());
  const plan = runtimePlan();
  const response = createUatPromotionRollbackRuntimeResponse({
    action: request.action, operation: request.operation, operation_id: request.operation_id,
    label: request.label, request_sha256: request.request_sha256,
    runtime_plan_sha256: request.runtime_plan_sha256, status: "SAFE_TO_EXECUTE",
    started_at: "2026-08-15T02:00:01.000Z", completed_at: "2026-08-15T02:00:02.000Z",
    output: {
      result: "ROLLBACK_RUNTIME_PREFLIGHT_PASSED",
      execution_package_sha256: request.execution_package_sha256,
      source_set_sha256: request.source_set_sha256,
      runtime_plan_sha256: request.runtime_plan_sha256,
      runtime_activation_source_sha256: digest("activation-source"),
      executor_sha256: digest("executor"),
      deployment_identity_sha256: clusterSha256(plan.deployment),
      protected_resources_sha256: plan.candidate.protected_resources_sha256,
      target_state: "SAFE_TO_EXECUTE",
      observed: createUatPromotionRollbackRuntimeOriginalObservation(plan),
    },
  });
  assert.equal(validateUatPromotionRollbackRuntimeResponse(response, request), response);
  assert.throws(
    () => validateUatPromotionRollbackRuntimeResponse({
      ...response, request_sha256: digest("substituted-request"),
    }, request),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_INVALID/,
  );
});

test("containment can report a freshly observed stale intent without claiming containment", () => {
  const input = requestInput({
    action: "CONTAIN",
    record_intent_sha256: digest("containment-intent"),
  });
  input.payload.record_intent = { runtime_observation_sha256: digest("prior-observation") };
  const request = createUatPromotionRollbackRuntimeRequest(input);
  const response = createUatPromotionRollbackRuntimeResponse({
    action: request.action,
    operation: request.operation,
    operation_id: request.operation_id,
    label: request.label,
    request_sha256: request.request_sha256,
    runtime_plan_sha256: request.runtime_plan_sha256,
    status: "STALE_INTENT",
    started_at: "2026-08-15T02:00:01.000Z",
    completed_at: "2026-08-15T02:00:02.000Z",
    output: { observed: createUatPromotionRollbackRuntimeOriginalObservation(runtimePlan()) },
  });
  assert.equal(validateUatPromotionRollbackRuntimeResponse(response, request), response);
  const sameObservationInput = requestInput({
    action: "CONTAIN",
    record_intent_sha256: digest("same-observation-containment-intent"),
  });
  sameObservationInput.payload.record_intent = {
    runtime_observation_sha256: response.output.observed.observation_sha256,
  };
  const sameObservationRequest = createUatPromotionRollbackRuntimeRequest(sameObservationInput);
  const sameObservationBody = structuredClone(response);
  delete sameObservationBody.response_sha256;
  sameObservationBody.request_sha256 = sameObservationRequest.request_sha256;
  assert.throws(
    () => validateUatPromotionRollbackRuntimeResponse(
      createUatPromotionRollbackRuntimeResponse(sameObservationBody), sameObservationRequest,
    ),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_INVALID/,
  );
  const responseBody = structuredClone(response);
  delete responseBody.response_sha256;
  assert.throws(
    () => createUatPromotionRollbackRuntimeResponse({
      ...responseBody,
      output: { observed: response.output.observed, containment: "FORGED" },
    }),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_RESPONSE_INVALID/,
  );
});

test("runtime observation requires complete writer discovery and retained candidate volume identities", () => {
  const original = createUatPromotionRollbackRuntimeOriginalObservation(runtimePlan());
  const counterDrift = structuredClone(original);
  delete counterDrift.observation_sha256;
  counterDrift.writer_inventory.active_writer_count = 1;
  counterDrift.observation_sha256 = clusterSha256(counterDrift);
  assert.throws(
    () => validateUatPromotionRollbackRuntimeObservation(counterDrift),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_OBSERVATION_INVALID/,
  );

  const missingCandidate = structuredClone(original);
  delete missingCandidate.observation_sha256;
  missingCandidate.retained_candidate_volumes.uploads.present = false;
  missingCandidate.retained_candidate_volumes.uploads.identity_sha256 = null;
  missingCandidate.observation_sha256 = clusterSha256(missingCandidate);
  assert.equal(
    validateUatPromotionRollbackRuntimeObservation(missingCandidate),
    missingCandidate,
  );
  assert.notDeepEqual(missingCandidate, original);

  const serviceIdentityCollision = structuredClone(original);
  delete serviceIdentityCollision.observation_sha256;
  serviceIdentityCollision.writer_inventory.members.push({
    writer_key: "shadow-writer",
    service: "shadow-writer",
    container_id: serviceIdentityCollision.services.caddy.container_id,
    running: true,
    unexpected: true,
  });
  serviceIdentityCollision.writer_inventory.members.sort((left, right) => (
    left.writer_key < right.writer_key ? -1 : left.writer_key > right.writer_key ? 1 : 0
  ));
  serviceIdentityCollision.writer_inventory.writer_set_sha256 = clusterSha256(
    serviceIdentityCollision.writer_inventory.members.map((member) => ({
      writer_key: member.writer_key,
      service: member.service,
      container_id: member.container_id,
      unexpected: member.unexpected,
    })),
  );
  serviceIdentityCollision.writer_inventory.active_writer_count += 1;
  serviceIdentityCollision.writer_inventory.unexpected_writer_count = 1;
  serviceIdentityCollision.observation_sha256 = clusterSha256(serviceIdentityCollision);
  assert.throws(
    () => validateUatPromotionRollbackRuntimeObservation(serviceIdentityCollision),
    /UAT_PROMOTION_ROLLBACK_RUNTIME_OBSERVATION_INVALID/,
  );
});

test("Node and Python share newline-terminated canonical request and response bytes", () => {
  const vector = {
    integer: Number.MAX_SAFE_INTEGER,
    nested: { enabled: true, labels: ["晨亿达", "rollback"], optional: null },
  };
  const golden = pythonCanonicalRoundTrip(vector);
  assert.equal(Buffer.from(golden.canonical_hex, "hex").toString("utf8"), canonicalClusterJson(vector));
  assert.equal(golden.sha256, clusterSha256(vector));

  const request = createUatPromotionRollbackRuntimeRequest(requestInput());
  const requestGolden = pythonCanonicalRoundTrip(request);
  const pythonRequest = JSON.parse(Buffer.from(requestGolden.canonical_hex, "hex").toString("utf8"));
  assert.equal(validateUatPromotionRollbackRuntimeRequest(pythonRequest).request_sha256, request.request_sha256);

  const response = createUatPromotionRollbackRuntimeResponse({
    action: request.action, operation: request.operation, operation_id: request.operation_id,
    label: request.label, request_sha256: request.request_sha256,
    runtime_plan_sha256: request.runtime_plan_sha256, status: "SAFE_TO_EXECUTE",
    started_at: "2026-08-15T02:00:01.000Z", completed_at: "2026-08-15T02:00:02.000Z",
    output: {
      result: "ROLLBACK_RUNTIME_PREFLIGHT_PASSED",
      execution_package_sha256: request.execution_package_sha256,
      source_set_sha256: request.source_set_sha256,
      runtime_plan_sha256: request.runtime_plan_sha256,
      runtime_activation_source_sha256: digest("activation-source"),
      executor_sha256: digest("executor"),
      deployment_identity_sha256: clusterSha256(runtimePlan().deployment),
      protected_resources_sha256: runtimePlan().candidate.protected_resources_sha256,
      target_state: "SAFE_TO_EXECUTE",
      observed: createUatPromotionRollbackRuntimeOriginalObservation(runtimePlan()),
    },
  });
  const responseGolden = pythonCanonicalRoundTrip(response);
  const pythonResponse = JSON.parse(Buffer.from(responseGolden.canonical_hex, "hex").toString("utf8"));
  assert.equal(validateUatPromotionRollbackRuntimeResponse(pythonResponse, request).response_sha256, response.response_sha256);
});

test("Python rejects every JSON numeric and Unicode form excluded by Node canonical JSON", () => {
  for (const raw of [
    '{"value":NaN}\n', '{"value":Infinity}\n', '{"value":-Infinity}\n',
    '{"value":1.5}\n', '{"value":-0}\n', '{"value":9007199254740992}\n',
    '{"value":"\\ud800"}\n',
  ]) assert.equal(pythonRejectsRawJson(raw), true, raw);
});
