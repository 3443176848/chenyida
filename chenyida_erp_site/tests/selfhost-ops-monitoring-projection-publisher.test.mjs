import assert from "node:assert/strict";
import { chmod, chown, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BACKUP_RECOVERY_READINESS_V4_ATTESTATION,
  BACKUP_RECOVERY_READINESS_V4_CONTRACT,
} from "../scripts/backup-recovery-readiness-v4.mjs";
import { canonicalTransferJson } from "../scripts/offhost-transfer-contract.mjs";
import { RELEASE_RUNTIME_POLICY_SHA256 } from "../scripts/release-lifecycle-contract.mjs";
import { canonicalJson, sha256 as releaseSha256 } from "../scripts/release-manifest-contract.mjs";
import {
  buildPostDeployReceipt,
  buildReleaseIdentityFromPostDeployReceipt,
} from "../scripts/postdeploy-release-contract.mjs";
import {
  canonicalClusterJson,
  clusterPolicySha256,
  validateClusterRecoveryPolicy,
} from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  MONITORING_BACKUP_PROJECTION_CONTRACT,
  createBackupProjection,
} from "../tools/ops-monitoring/backup-projection.mjs";
import {
  MONITORING_COMPONENTS_PROJECTION_CONTRACT,
  createComponentsProjection,
} from "../tools/ops-monitoring/components-projection.mjs";
import {
  MONITORING_CREDENTIAL_SOURCE_PATH,
  MONITORING_HOST_CONFIG_CONTRACT,
  MONITORING_REMOTE_ACK_CONTRACT,
  validateMonitoringHostConfig,
} from "../tools/ops-monitoring/delivery-contract.mjs";
import {
  MONITORING_CONFIG_CONTRACT,
  canonicalMonitoringJson,
  monitoringSha256,
  validateMonitoringConfig,
} from "../tools/ops-monitoring/contract.mjs";
import {
  MONITORING_PROJECTION_PUBLICATION_CONTRACT,
  MONITORING_PROJECTION_ROOT_MARKER,
  MONITORING_PROJECTION_ROOT_MARKER_VALUE,
  publishMonitoringProjection,
} from "../tools/ops-monitoring/projection-publisher.mjs";
import {
  FIXTURE_CONTROL,
  FIXTURE_WEB,
  FIXTURE_WORKER,
  buildEligibleReleaseFixture,
} from "./release-gate-fixture.mjs";

const rootCapable = typeof process.getuid === "function" && process.getuid() === 0;
const readerGid = 21001;
const receiptTime = "2026-08-12T01:30:00.000Z";
const firstPublication = "2026-08-12T01:31:00.000Z";
const zero = "0".repeat(64);
const digest = (character) => character.repeat(64);
const shaDigest = (character) => `sha256:${digest(character)}`;
const releaseFixturePromise = buildEligibleReleaseFixture({
  entries: [{ ordinal: 1, filename: "0001_fixture.sql", sha256: digest("1") }],
});

function runtimeServices(manifest) {
  const common = { restart_count: 0, oom_killed: false, running: true, restarting: false, paused: false, dead: false, status: "running" };
  return [
    { ...common, service: "caddy", container_id: digest("1"), image_id: shaDigest("1"), image_reference: `registry.example.com/platform/caddy@${shaDigest("1")}`, health: "none", healthcheck_present: false },
    { ...common, service: "postgres", container_id: digest("2"), image_id: shaDigest("2"), image_reference: `registry.example.com/platform/postgres@${shaDigest("2")}`, health: "healthy", healthcheck_present: true },
    { ...common, service: "web", container_id: digest("3"), image_id: manifest.images.web.image_digest, image_reference: manifest.images.web.image_reference, health: "healthy", healthcheck_present: true },
    { ...common, service: "worker", container_id: digest("4"), image_id: manifest.images.worker.image_digest, image_reference: manifest.images.worker.image_reference, health: "healthy", healthcheck_present: true },
  ];
}

function readiness(manifest) {
  return {
    deployment_class: "UAT", deployment_id: "chenyida-erp-uat", version: manifest.source.package_version,
    revision: manifest.source.git_commit.slice(0, 12), migration_head: manifest.migrations.head,
    migration_manifest_sha256: manifest.migrations.allowlist_sha256, database_time: receiptTime,
    components: { postgresql: "READY", migration: "READY", worker: "READY", uploads: "READY", attachments: "READY", runtime: "READY" },
  };
}

function monitoringConfig(identity, services) {
  return validateMonitoringConfig({
    schema_version: 1,
    contract: MONITORING_CONFIG_CONTRACT,
    config_id: "monitoring-authoritative-projection-v1",
    deployment_class: "UAT",
    deployment_id: "chenyida-erp-uat",
    compose_project: "chenyida-erp-uat",
    service_expectations: services.map((service) => ({
      service: service.service,
      container_name: `chenyida-erp-uat-${service.service}-1`,
      image_reference: service.image_reference,
    })),
    release_expectation: {
      application_version: identity.application_version,
      git_commit: identity.git_commit,
      release_manifest_sha256: identity.release_manifest_sha256,
      supervisor_bundle_sha256: identity.supervisor_bundle_sha256,
      migration_head: identity.migration_head,
      migration_manifest_sha256: identity.migration_manifest_sha256,
      web_image_digest: identity.web_image_digest,
      worker_image_digest: identity.worker_image_digest,
    },
    backup_expectation: { policy_id: "daily-rpo-v1", rpo_hours: 24 },
    notification: { required: true, target_id: "primary-oncall" },
  });
}

function hostConfig(identity, receipt, receiptSha256, services) {
  return validateMonitoringHostConfig({
    schema_version: 1,
    contract: MONITORING_HOST_CONFIG_CONTRACT,
    config_id: "monitoring-host-authoritative-v1",
    config_generation: 1,
    previous_config_sha256: zero,
    deployment: { class: "UAT", id: "chenyida-erp-uat", compose_project: "chenyida-erp-uat" },
    installation: {
      activation_id: "monitoring-activation-v1", installation_generation: 1,
      monitoring_bundle_sha256: digest("7"), supervisor_bundle_sha256: identity.supervisor_bundle_sha256,
      state_schema_min: 1, state_schema_max: 1,
    },
    identities: {
      evaluator: { user: "chenyida-monitor-eval", uid: readerGid, gid: readerGid },
      notifier: { user: "chenyida-monitor-notify", uid: 21002, gid: 21002 },
    },
    monitoring: monitoringConfig(identity, services),
    evidence: {
      components_projection_path: "/var/lib/chenyida-erp/monitoring-v1/projections/components.json",
      backup_projection_path: "/var/lib/chenyida-erp/monitoring-v1/projections/backup.json",
      release_activation_id: receipt.run_id,
      release_activated_at: receipt.generated_at,
      postdeploy_receipt_sha256: receiptSha256,
      components_producer_bundle_sha256: identity.supervisor_bundle_sha256,
      backup_producer_bundle_sha256: identity.supervisor_bundle_sha256,
      minimum_components_projection_generation: 1,
      minimum_backup_projection_generation: 1,
    },
    notification: {
      required: true, target_id: "primary-oncall", target_generation: 1,
      adapter: { id: "HTTPS_JSON_ACK_V1", version: 1, source_sha256: digest("d") },
      endpoint: { scheme: "https", host: "alerts.example.internal", port: 443, path: "/ack", tls_server_name: "alerts.example.internal" },
      credential: { source_file: MONITORING_CREDENTIAL_SOURCE_PATH, sha256: digest("e"), generation: 1 },
      ack: { contract: MONITORING_REMOTE_ACK_CONTRACT, timeout_milliseconds: 1000, claim_ttl_seconds: 15, retry_backoff_seconds: 15, max_attempts: 3 },
      oncall_roster_generation: 1,
      escalation_table_sha256: digest("f"),
    },
  });
}

async function writeTrusted(file, raw, mode, gid = 0) {
  await mkdir(path.dirname(file), { recursive: true });
  await chmod(file, 0o600).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  await writeFile(file, raw, { mode });
  await chown(file, 0, gid);
  await chmod(file, mode);
}

async function sourceSpec(file) {
  const metadata = await lstat(file, { bigint: true });
  const raw = await readFile(file);
  return {
    path: file,
    sha256: releaseSha256(raw),
    bytes: raw.length,
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    uid: Number(metadata.uid),
    gid: Number(metadata.gid),
    mode: `0${Number(metadata.mode & 0o7777n).toString(8).padStart(3, "0")}`,
    nlink: Number(metadata.nlink),
  };
}

async function projectionRoot(parent, name = "projections") {
  const root = path.join(parent, name);
  await mkdir(root, { mode: 0o750 });
  await chown(root, 0, readerGid);
  await chmod(root, 0o750);
  for (const kind of ["components", "backup"]) {
    const directory = path.join(root, kind);
    await mkdir(directory, { mode: 0o750 });
    await chown(directory, 0, readerGid);
    await chmod(directory, 0o750);
  }
  await writeTrusted(path.join(root, MONITORING_PROJECTION_ROOT_MARKER), MONITORING_PROJECTION_ROOT_MARKER_VALUE, 0o400, readerGid);
  return root;
}

function activeRecord(hostConfigSha256, supervisorBundleSha256) {
  const active = {
    schema_version: 1, contract: "chenyida-erp-monitoring-host-activation/v1", activation_sha256: "",
    activation_id: "monitoring-activation-v1", status: "COMMITTED", installation_generation: 1,
    monitoring_bundle_sha256: digest("7"), supervisor_bundle_sha256: supervisorBundleSha256,
    runtime_sha256: digest("8"), runtime_bytes: 1024, runtime_version: "22.14.0",
    private_config_sha256: hostConfigSha256, evaluator_config_sha256: digest("9"), notifier_config_sha256: digest("a"),
    evaluator_uid: readerGid, evaluator_gid: readerGid, notifier_uid: 21002, notifier_gid: 21002,
    state_schema_min: 1, state_schema_max: 1, unit_set_sha256: digest("b"), previous_activation_sha256: zero,
    committed_at: "2026-08-12T01:30:30.000Z",
  };
  const body = { ...active };
  delete body.activation_sha256;
  active.activation_sha256 = monitoringSha256(body);
  return active;
}

async function makeFixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-monitor-projection-"));
  const fixture = await releaseFixturePromise;
  const manifest = structuredClone(fixture.manifest);
  manifest.images.web.image_reference = `registry.example.com/chenyida-erp/web@${FIXTURE_WEB}`;
  manifest.images.worker.image_reference = `registry.example.com/chenyida-erp/worker@${FIXTURE_WORKER}`;
  const services = runtimeServices(manifest);
  const receipt = buildPostDeployReceipt({
    runId: "postdeploy-authoritative-v1", generatedAt: receiptTime, deploymentClass: "UAT", deploymentId: "chenyida-erp-uat",
    composeProject: "chenyida-erp-uat", manifest, manifestSha256: releaseSha256(canonicalJson(manifest)),
    supervisorBundleSha256: FIXTURE_CONTROL.supervisor_bundle_sha256, authorizationSha256: digest("4"),
    runtimePolicySha256: RELEASE_RUNTIME_POLICY_SHA256, runtimeConfigurationSha256: digest("3"), services, readiness: readiness(manifest),
  });
  const receiptRaw = canonicalJson(receipt);
  const receiptSha256 = releaseSha256(receiptRaw);
  const identity = buildReleaseIdentityFromPostDeployReceipt({ receipt, receiptSha256 });
  const host = hostConfig(identity, receipt, receiptSha256, services);
  const hostRaw = canonicalMonitoringJson(host);
  const active = activeRecord(releaseSha256(hostRaw), identity.supervisor_bundle_sha256);
  const files = {
    active: path.join(parent, "sources", "active.json"),
    host_config: path.join(parent, "sources", "host-config.json"),
    release_identity: path.join(parent, "sources", "release-identity.json"),
    postdeploy_receipt: path.join(parent, "sources", "postdeploy-receipt.json"),
  };
  await writeTrusted(files.active, canonicalMonitoringJson(active), 0o444);
  await writeTrusted(files.host_config, hostRaw, 0o400);
  await writeTrusted(files.release_identity, `${JSON.stringify(identity)}\n`, 0o440, readerGid);
  await writeTrusted(files.postdeploy_receipt, receiptRaw, 0o440);
  const sources = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await sourceSpec(file)])));
  return { parent, projectionRoot: await projectionRoot(parent), manifest, services, receipt, identity, host, active, files, sources };
}

function componentsSourceSha256(fixture) {
  return monitoringSha256({
    active_activation_sha256: fixture.active.activation_sha256,
    host_config_sha256: fixture.sources.host_config.sha256,
    release_identity_sha256: fixture.sources.release_identity.sha256,
    postdeploy_receipt_sha256: fixture.sources.postdeploy_receipt.sha256,
  });
}

function componentsCandidate(fixture, generation, previous, publishedAt) {
  const sourceSha256 = componentsSourceSha256(fixture);
  return createComponentsProjection({
    schema_version: 1, contract: MONITORING_COMPONENTS_PROJECTION_CONTRACT,
    projection_id: `components-${generation}-${sourceSha256.slice(0, 24)}`,
    generation, previous_projection_sha256: previous,
    producer: { bundle_sha256: fixture.identity.supervisor_bundle_sha256, source_sha256: sourceSha256 },
    published_at: publishedAt,
    release_binding: { activation_id: fixture.receipt.run_id, activated_at: fixture.receipt.generated_at, postdeploy_receipt_sha256: fixture.sources.postdeploy_receipt.sha256 },
    application: {
      live: { status: "PASS", observed_at: fixture.receipt.generated_at, version: fixture.receipt.source.application_version, code: null },
      readiness: { status: "READY", observed_at: fixture.receipt.generated_at, version: fixture.receipt.readiness.version, revision: fixture.receipt.readiness.revision, migration_head: fixture.receipt.readiness.migration_head, code: null },
    },
    release: {
      status: "MATCHED", observed_at: fixture.receipt.generated_at, generated_at: fixture.identity.generated_at,
      release_manifest_sha256: fixture.identity.release_manifest_sha256, supervisor_bundle_sha256: fixture.identity.supervisor_bundle_sha256,
      application_version: fixture.identity.application_version, git_commit: fixture.identity.git_commit,
      migration_head: fixture.identity.migration_head, migration_manifest_sha256: fixture.identity.migration_manifest_sha256,
      web_image_digest: fixture.identity.web_image_digest, worker_image_digest: fixture.identity.worker_image_digest,
    },
  });
}

function componentsContext(fixture, { generation = 1, previous = zero, publishedAt = firstPublication, authorization = digest("a") } = {}) {
  const candidate = componentsCandidate(fixture, generation, previous, publishedAt);
  return {
    schema_version: 1, contract: MONITORING_PROJECTION_PUBLICATION_CONTRACT, operation: "COMPONENTS",
    authorization_sha256: authorization, supervisor_bundle_sha256: fixture.identity.supervisor_bundle_sha256,
    projection_root: fixture.projectionRoot,
    projection: {
      reader_gid: readerGid, generation, previous_projection_sha256: previous, published_at: publishedAt,
      expected_source_sha256: candidate.producer.source_sha256, expected_projection_sha256: candidate.projection_sha256,
    },
    sources: fixture.sources,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test("components publication is canonical, idempotent and strictly chained", { skip: !rootCapable }, async () => {
  const fixture = await makeFixture();
  try {
    const firstContext = componentsContext(fixture);
    const first = await publishMonitoringProjection(firstContext, { production: false, now: new Date(firstPublication) });
    assert.deepEqual(first, { result: "PUBLISHED", kind: "components", generation: 1, projection_sha256: firstContext.projection.expected_projection_sha256, source_sha256: firstContext.projection.expected_source_sha256 });
    assert.equal((await lstat(path.join(fixture.projectionRoot, "components.json"))).mode & 0o7777, 0o440);
    assert.equal((await lstat(path.join(fixture.projectionRoot, "components.json"))).gid, readerGid);
    assert.equal((await publishMonitoringProjection(firstContext, { production: false, now: new Date(firstPublication) })).result, "ALREADY_PUBLISHED");
    const secondContext = componentsContext(fixture, { generation: 2, previous: first.projection_sha256, publishedAt: "2026-08-12T01:32:00.000Z", authorization: digest("b") });
    assert.equal((await publishMonitoringProjection(secondContext, { production: false, now: new Date(secondContext.projection.published_at) })).generation, 2);
    const names = await readdir(path.join(fixture.projectionRoot, "components"));
    assert.equal(names.length, 2);
    assert.match(names[0], /^0000000000000001\.[0-9a-f]{64}\.json$/);
    assert.match(names[1], /^0000000000000002\.[0-9a-f]{64}\.json$/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

test("source inode, link count, mode and release-chain drift fail closed", { skip: !rootCapable }, async () => {
  for (const mutate of [
    async (fixture) => chmod(fixture.files.active, 0o644),
    async (fixture) => link(fixture.files.active, `${fixture.files.active}.hardlink`),
    async (fixture) => {
      const replacement = `${fixture.files.active}.replacement`;
      await writeTrusted(replacement, await readFile(fixture.files.active), 0o444);
      await rename(replacement, fixture.files.active);
    },
  ]) {
    const fixture = await makeFixture();
    try {
      const context = componentsContext(fixture);
      await mutate(fixture);
      await expectCode(publishMonitoringProjection(context, { production: false, now: new Date(firstPublication) }), "MONITOR_PROJECTION_ACTIVE_SOURCE_INVALID");
    } finally { await rm(fixture.parent, { recursive: true, force: true }); }
  }
  const fixture = await makeFixture();
  try {
    fixture.identity = { ...fixture.identity, web_container_id: digest("e") };
    await writeTrusted(fixture.files.release_identity, `${JSON.stringify(fixture.identity)}\n`, 0o440, readerGid);
    fixture.sources.release_identity = await sourceSpec(fixture.files.release_identity);
    await expectCode(publishMonitoringProjection(componentsContext(fixture), { production: false, now: new Date(firstPublication) }), "MONITOR_PROJECTION_RELEASE_CHAIN_MISMATCH");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

test("history and temporary publication phases recover without forks", { skip: !rootCapable }, async () => {
  for (const phase of ["AFTER_HISTORY", "AFTER_TEMP", "AFTER_ALIAS"]) {
    const fixture = await makeFixture();
    try {
      const context = componentsContext(fixture);
      await assert.rejects(publishMonitoringProjection(context, {
        production: false, now: new Date(firstPublication),
        fault: async (current) => { if (current === phase) throw new Error(`fault-${phase}`); },
      }));
      const recovery = structuredClone(context);
      recovery.authorization_sha256 = digest("c");
      const result = await publishMonitoringProjection(recovery, { production: false, now: new Date("2026-08-13T01:31:00.000Z") });
      assert.equal(result.result, phase === "AFTER_ALIAS" ? "ALREADY_PUBLISHED" : "PUBLISHED");
      assert.equal((await readdir(fixture.projectionRoot)).filter((name) => name.endsWith(".tmp")).length, 0);
    } finally { await rm(fixture.parent, { recursive: true, force: true }); }
  }
});

test("recognized partial candidate files are rebuilt but referenced history is immutable", { skip: !rootCapable }, async () => {
  for (const kind of ["history", "temporary"]) {
    const fixture = await makeFixture();
    try {
      const context = componentsContext(fixture);
      const partial = kind === "history"
        ? path.join(fixture.projectionRoot, "components", `0000000000000001.${context.projection.expected_projection_sha256}.json`)
        : path.join(fixture.projectionRoot, `.components.${context.authorization_sha256}.${context.projection.expected_projection_sha256}.tmp`);
      await writeTrusted(partial, "{", 0o600);
      assert.equal((await publishMonitoringProjection(context, { production: false, now: new Date(firstPublication) })).result, "PUBLISHED");
    } finally { await rm(fixture.parent, { recursive: true, force: true }); }
  }
  const fixture = await makeFixture();
  try {
    const context = componentsContext(fixture);
    await publishMonitoringProjection(context, { production: false, now: new Date(firstPublication) });
    const history = path.join(fixture.projectionRoot, "components", `0000000000000001.${context.projection.expected_projection_sha256}.json`);
    await writeTrusted(history, "{", 0o440, readerGid);
    await expectCode(
      publishMonitoringProjection(context, { production: false, now: new Date(firstPublication) }),
      "MONITOR_PROJECTION_HISTORY_CONFLICT",
    );
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

test("future publication and generation jumps are rejected", { skip: !rootCapable }, async () => {
  const fixture = await makeFixture();
  try {
    const future = componentsContext(fixture, { publishedAt: "2026-08-12T01:40:00.000Z" });
    await expectCode(publishMonitoringProjection(future, { production: false, now: new Date(firstPublication) }), "MONITOR_PROJECTION_PUBLICATION_TIME_INVALID");
    const first = await publishMonitoringProjection(componentsContext(fixture), { production: false, now: new Date(firstPublication) });
    const jump = componentsContext(fixture, { generation: 3, previous: first.projection_sha256, publishedAt: "2026-08-12T01:32:00.000Z" });
    await expectCode(publishMonitoringProjection(jump, { production: false, now: new Date(jump.projection.published_at) }), "MONITOR_PROJECTION_CHAIN_INVALID");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

async function backupFixture(fixture, overrides = {}) {
  const policy = validateClusterRecoveryPolicy(JSON.parse(await readFile(new URL("../operations/postgresql-cluster-recovery-policy-v1.json", import.meta.url), "utf8")));
  const policyFile = path.join(fixture.parent, "sources", "postgresql-cluster-recovery-policy.json");
  await writeTrusted(policyFile, canonicalClusterJson(policy), 0o440);
  const readiness = {
    schema_version: 4, contract: BACKUP_RECOVERY_READINESS_V4_CONTRACT,
    result: "RECOVERY_READY", evidence_scope: "ACTUAL_OFFHOST", backup_id: "backup-authoritative-v1", restore_run_id: "restore-authoritative-v1",
    created_at: "2026-08-12T01:40:00.000Z", verified_at: "2026-08-12T02:30:00.000Z", expires_at: "2026-08-13T02:30:00.000Z",
    data_readiness: {
      readiness_v3_sha256: digest("1"),
      receipt: {
        inner_restore: { receipt: {
          deployment: { class: fixture.identity.deployment_class, id: fixture.identity.deployment_id },
          application: { version: fixture.identity.application_version, git_commit: fixture.identity.git_commit, web_image_digest: fixture.identity.web_image_digest, worker_image_digest: fixture.identity.worker_image_digest },
          migration: { head: fixture.identity.migration_head, manifest_sha256: fixture.identity.migration_manifest_sha256 },
          policy: { id: "daily-rpo-v1", rpo_hours: 24 },
          consistency: { recovery_point_at: "2026-08-12T02:00:00.000Z" },
        } },
        operations: { policy_id: "daily-rpo-v1", policy_sha256: digest("2") },
      },
    },
    joint_transfer: {}, recovery_execution: {},
    cluster_security: { policy_sha256: clusterPolicySha256(policy) },
    credential_binding: {}, tablespace: {}, status: {},
    attestation: BACKUP_RECOVERY_READINESS_V4_ATTESTATION,
    readiness_sha256: digest("3"),
    ...overrides,
  };
  const readinessFile = path.join(fixture.parent, "sources", "recovery-readiness.json");
  await writeTrusted(readinessFile, canonicalTransferJson(readiness), 0o640, readerGid);
  fixture.sources.backup_readiness = await sourceSpec(readinessFile);
  fixture.sources.cluster_policy = await sourceSpec(policyFile);
  return { readiness };
}

function backupContext(fixture, readiness, { publishedAt = "2026-08-12T02:31:00.000Z", authorization = digest("d") } = {}) {
  const restore = readiness.data_readiness.receipt.inner_restore.receipt;
  const operations = readiness.data_readiness.receipt.operations;
  const projection = createBackupProjection({
    schema_version: 1, contract: MONITORING_BACKUP_PROJECTION_CONTRACT,
    projection_id: `backup-1-${readiness.readiness_sha256.slice(0, 24)}`, generation: 1, previous_projection_sha256: zero,
    producer: { bundle_sha256: fixture.identity.supervisor_bundle_sha256, policy_sha256: operations.policy_sha256, source_readiness_sha256: readiness.readiness_sha256 },
    published_at: publishedAt, verified_at: readiness.verified_at, recovery_point_at: restore.consistency.recovery_point_at, expires_at: readiness.expires_at,
    release: {
      activation_id: fixture.receipt.run_id, activated_at: fixture.receipt.generated_at,
      postdeploy_receipt_sha256: fixture.sources.postdeploy_receipt.sha256,
      release_manifest_sha256: fixture.identity.release_manifest_sha256,
      application_version: fixture.identity.application_version, git_commit: fixture.identity.git_commit,
    },
    backup: {
      verification_status: "RECOVERY_READY", evidence_scope: "ACTUAL_OFFHOST", transfer_status: "VERIFIED", encryption_status: "VERIFIED",
      cluster_transfer_status: "VERIFIED", cluster_security_status: "VERIFIED", credential_binding_status: "VERIFIED", tablespace_status: "VERIFIED",
      recovery_execution_status: "PUBLISHED", schedule_status: "ON_TIME", retention_status: "POLICY_VALID_DRY_RUN",
      identity_status: "MATCHED", policy_status: "MATCHED", assurance_status: "MATCHED", recovery_ready: true,
      policy_id: "daily-rpo-v1", rpo_hours: 24,
    },
  });
  return {
    schema_version: 1, contract: MONITORING_PROJECTION_PUBLICATION_CONTRACT, operation: "BACKUP",
    authorization_sha256: authorization, supervisor_bundle_sha256: fixture.identity.supervisor_bundle_sha256,
    projection_root: fixture.projectionRoot,
    projection: { reader_gid: readerGid, generation: 1, previous_projection_sha256: zero, published_at: publishedAt, expected_source_sha256: readiness.readiness_sha256, expected_projection_sha256: projection.projection_sha256 },
    sources: fixture.sources,
  };
}

test("backup publication accepts only an unexpired actual V4 identity chain", { skip: !rootCapable }, async () => {
  const fixture = await makeFixture();
  try {
    const { readiness } = await backupFixture(fixture);
    const context = backupContext(fixture, readiness);
    await expectCode(
      publishMonitoringProjection(context, { production: false, now: new Date(context.projection.published_at) }),
      "MONITOR_BACKUP_SOURCE_READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN",
    );
    const actual = await publishMonitoringProjection(context, { production: false, now: new Date(context.projection.published_at), backupValidator: (value) => value });
    assert.equal(actual.result, "PUBLISHED");
    assert.equal(actual.source_sha256, readiness.readiness_sha256);

    const syntheticFixture = await makeFixture();
    try {
      const synthetic = await backupFixture(syntheticFixture, { result: "SYNTHETIC_ISOLATED_VERIFIED", evidence_scope: "SYNTHETIC_ISOLATED", readiness_sha256: digest("4") });
      await expectCode(
        publishMonitoringProjection(backupContext(syntheticFixture, synthetic.readiness), { production: false, now: new Date(context.projection.published_at), backupValidator: (value) => value }),
        "MONITOR_BACKUP_ACTUAL_V4_REQUIRED",
      );
    } finally { await rm(syntheticFixture.parent, { recursive: true, force: true }); }

    const expiredFixture = await makeFixture();
    try {
      const expired = await backupFixture(expiredFixture);
      const expiredContext = backupContext(expiredFixture, expired.readiness);
      await expectCode(
        publishMonitoringProjection(expiredContext, { production: false, now: new Date("2026-08-13T02:30:00.000Z"), backupValidator: (value) => value }),
        "MONITOR_BACKUP_SOURCE_TIME_INVALID",
      );
    } finally { await rm(expiredFixture.parent, { recursive: true, force: true }); }
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});
