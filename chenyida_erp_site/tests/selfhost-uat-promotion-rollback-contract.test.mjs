import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS,
  UAT_PROMOTION_ROLLBACK_STAGES,
  assertUatPromotionRollbackPostverifyResultMatchesIntent,
  assertUatPromotionRollbackResultMatchesIntent,
  createUatPromotionRollbackCheckIntent,
  createUatPromotionRollbackCheckResult,
  createUatPromotionRollbackContentReconciliation,
  createUatPromotionRollbackExecutionPackage,
  createUatPromotionRollbackPostverifyResult,
  createUatPromotionRollbackResult,
  createUatPromotionRollbackStageIntent,
  createUatPromotionRollbackStageResult,
  validateUatPromotionRollbackPostverifyResult,
  validateUatPromotionRollbackResult,
} from "../scripts/uat-promotion-rollback-contract.mjs";
import {
  createUatPromotionRollbackRuntimePlan,
  deriveUatPromotionRollbackRuntimeTargets,
} from "../scripts/uat-promotion-rollback-runtime-contract.mjs";
import {
  createNextUatPromotionCheckpointReceipt,
  validateUatPromotionCheckpointReceipt,
} from "../scripts/uat-promotion-transaction-journal.mjs";
import { clusterSha256 } from "../scripts/postgresql-cluster-recovery-contract.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const image = (name) => `registry.example.invalid/chenyida/${name}@sha256:${hash(name)}`;
const snapshotObjects = Object.freeze({
  postgresql: { file: "postgresql.dump", sha256: hash("postgresql"), bytes: 4096, entries: null },
  uploads: { file: "uploads.tar.gz", sha256: hash("uploads"), bytes: 128, entries: 2 },
  attachments: { file: "attachments.tar.gz", sha256: hash("attachments"), bytes: 256, entries: 3 },
  backup_status: { file: "backup-status.tar.gz", sha256: hash("backup-status"), bytes: 512, entries: 4 },
});
const predecessor = Object.freeze({
  git_commit: "a".repeat(40),
  git_tree: "b".repeat(40),
  application_version: "0.1.0-alpha.46",
  release_manifest_sha256: hash("predecessor-manifest"),
  web_image: image("web-predecessor"),
  worker_image: image("worker-predecessor"),
  migration_head: "0045_predecessor.sql",
  migration_manifest_sha256: hash("predecessor-migrations"),
  runtime_configuration_sha256: hash("predecessor-runtime"),
});
const database = Object.freeze({
  name: "chenyida_erp",
  system_identifier: "7612345678901234567",
  oid: "16384",
  marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
});
const boundary = Object.freeze({
  environment_restore: "EXACT_PREUPGRADE_SNAPSHOT_AND_PREDECESSOR_RUNTIME_ONLY",
  posted_business_reversal: "NOT_PERFORMED_REQUIRES_SEPARATE_BUSINESS_AUTHORIZATION",
  down_migration: false,
  direct_sql_correction: false,
  business_fact_deletion: false,
  automatic_business_compensation: false,
});
const checkpointOrder = Object.freeze([
  "CANDIDATE_SOURCE_SNAPSHOT", "ELIGIBLE_RELEASE_MANIFEST", "PRE_DEPLOY_RUNTIME_STABILITY",
  "PROMOTION_INTENT_AND_DURABLE_JOURNAL", "PROMOTION_BOUND_RECOVERABLE_SNAPSHOT",
  "WRITER_QUIESCE_RECEIPT", "ONE_TIME_MIGRATION_AUTHORIZATION", "MIGRATION_COMMIT_RECEIPT",
  "COMPOSE_DEPLOYMENT_RECEIPT", "POST_DEPLOY_RUNTIME_CONFIGURATION", "POST_DEPLOY_IDENTITY",
  "CROSS_ROLE_UAT_EXECUTION", "PROMOTION_FINAL_RECEIPT", "ROLLBACK_TO_UAT_EXECUTOR",
  "ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT",
]);

function source(role, overrides = {}) {
  return Object.freeze({
    path: `/var/lib/chenyida-erp/rollback-fixture/${role}`,
    sha256: hash(`source:${role}`),
    bytes: 64,
    device: "2049",
    inode: String(10_000 + role.length),
    uid: 0,
    gid: 0,
    mode: "0400",
    nlink: 1,
    ...overrides,
  });
}

function executionPackage() {
  const sources = {
    snapshot_readiness: source("snapshot-readiness.json"),
    snapshot_manifest: source("snapshot-manifest.json"),
    snapshot_migrations: source("snapshot-migrations.json"),
    snapshot_reconciliation: source("snapshot-reconciliation.json"),
    snapshot_postgresql: source("postgresql.dump", {
      sha256: snapshotObjects.postgresql.sha256, bytes: snapshotObjects.postgresql.bytes,
    }),
    snapshot_uploads: source("uploads.tar.gz", {
      sha256: snapshotObjects.uploads.sha256, bytes: snapshotObjects.uploads.bytes,
    }),
    snapshot_attachments: source("attachments.tar.gz", {
      sha256: snapshotObjects.attachments.sha256, bytes: snapshotObjects.attachments.bytes,
    }),
    snapshot_backup_status: source("backup-status.tar.gz", {
      sha256: snapshotObjects.backup_status.sha256, bytes: snapshotObjects.backup_status.bytes,
    }),
    snapshot_policy: source("snapshot-policy.json"),
    snapshot_policy_activation: source("snapshot-policy-activation.json"),
    predecessor_postdeploy_receipt: source("predecessor-postdeploy.json", {
      sha256: hash("predecessor-receipt"),
    }),
    predecessor_release_manifest: source("predecessor-manifest.json", {
      sha256: predecessor.release_manifest_sha256,
    }),
    candidate_deployment_result: source("candidate-deployment.json"),
    candidate_postdeploy_identity: source("candidate-postdeploy.json"),
    compose_file: source("compose.yaml"),
    compose_release_file: source("compose.release.yaml"),
    deployment_environment: source("deployment.env"),
    runtime_policy: source("runtime-policy.json"),
    runtime_adapter_activation: source("runtime-adapter-activation.json", {
      path: "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v1.json",
    }),
  };
  const contentReconciliation = createUatPromotionRollbackContentReconciliation({
    source_reconciliation_sha256: sources.snapshot_reconciliation.sha256,
    database: { report_sha256: hash("postgresql-logical-content") },
    files: {
      uploads: { tree_sha256: hash("uploads-logical-content"), entries: snapshotObjects.uploads.entries },
      attachments: { tree_sha256: hash("attachments-logical-content"), entries: snapshotObjects.attachments.entries },
      backup_status: { tree_sha256: hash("backup-status-logical-content"), entries: snapshotObjects.backup_status.entries },
    },
  });
  const candidateServices = Object.fromEntries(["caddy", "postgres", "web", "worker"].map((name) => [name, {
    service: name,
    container_id: hash(`candidate-container:${name}`),
    image_reference: image(`candidate-${name}`),
    image_digest: `sha256:${hash(`candidate-image:${name}`)}`,
  }]));
  const candidateVolumes = Object.fromEntries(["uploads", "attachments", "backup_status"].map((domain) => [domain, {
    domain, name: `chenyida-erp_erp_${domain}`, identity_sha256: hash(`candidate-volume:${domain}`),
  }]));
  const runtimePlan = createUatPromotionRollbackRuntimePlan({
    promotion_id: "promotion-001",
    promotion_generation: 1,
    rollback_operation_id: "rollback-uat-release-001",
    deployment: {
      class: "UAT", id: "chenyida-erp", compose_project: "chenyida-erp",
      compose_project_root: "/opt/erp/chenyida_erp_site", database,
    },
    candidate: {
      services: candidateServices, volumes: candidateVolumes,
      protected_resources_sha256: hash("protected-resources"),
    },
    predecessor: {
      release_manifest_sha256: predecessor.release_manifest_sha256,
      postdeploy_receipt_sha256: sources.predecessor_postdeploy_receipt.sha256,
      runtime_configuration_sha256: predecessor.runtime_configuration_sha256,
      web_image: predecessor.web_image, worker_image: predecessor.worker_image,
    },
    toolchain: {
      executor: {
        path: "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1",
        sha256: hash("rollback-executor"), uid: 0, gid: 0, mode: "0555",
      },
      docker: {
        path: "/usr/bin/docker", sha256: hash("docker"), uid: 0, gid: 0, mode: "0555",
      },
    },
    source_bindings: {
      snapshot_objects_sha256: clusterSha256(snapshotObjects),
      snapshot_reconciliation_sha256: sources.snapshot_reconciliation.sha256,
      deployment_environment_sha256: sources.deployment_environment.sha256,
      compose_file_sha256: sources.compose_file.sha256,
      compose_release_file_sha256: sources.compose_release_file.sha256,
      runtime_policy_sha256: sources.runtime_policy.sha256,
    },
  });
  return createUatPromotionRollbackExecutionPackage({
    promotion_id: "promotion-001",
    promotion_generation: 1,
    rollback_operation_id: "rollback-uat-release-001",
    created_at: "2026-08-15T02:00:00.000Z",
    execution_deadline: "2026-08-15T03:00:00.000Z",
    snapshot_readiness_sha256: hash("snapshot-readiness"),
    snapshot_objects: snapshotObjects,
    snapshot_objects_sha256: clusterSha256(snapshotObjects),
    predecessor,
    predecessor_sha256: clusterSha256(predecessor),
    database,
    database_snapshot_sha256: clusterSha256(database),
    boundary,
    content_reconciliation: contentReconciliation,
    protected_resources_sha256: hash("protected-resources"),
    runtime_plan_sha256: runtimePlan.runtime_plan_sha256,
    compose_project: "chenyida-erp",
    compose_project_root: "/opt/erp/chenyida_erp_site",
    restore_strategies: {
      database: "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
      file_domains: "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
      runtime: "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
    },
    sources,
    source_set_sha256: clusterSha256(sources),
  });
}

function rollbackIntent(packageValue = executionPackage()) {
  const rollbackOperationId = "rollback-uat-release-001";
  const intent = {
    promotion_id: "promotion-001",
    promotion_generation: 1,
    rollback_operation_id: rollbackOperationId,
    execution_authorization_sha256: hash("rollback-authorization"),
    supervisor_bundle_sha256: hash("supervisor-bundle"),
    created_at: "2026-08-15T02:00:00.000Z",
    expires_at: "2026-08-15T02:15:00.000Z",
    parameters: {
      previous_checkpoint_receipt_sha256: hash("checkpoint-13"),
      promotion_snapshot_binding_sha256: hash("promotion-snapshot"),
      snapshot_readiness_sha256: hash("snapshot-readiness"),
      snapshot_backup_id: "backup-001",
      snapshot_restore_run_id: "restore-001",
      snapshot_objects: snapshotObjects,
      predecessor,
      database,
      compose_project: "chenyida-erp",
      compose_project_root: "/opt/erp/chenyida_erp_site",
      execution_package_sha256: packageValue.package_sha256,
      execution_deadline: packageValue.execution_deadline,
      boundary,
    },
  };
  intent.rollback_intent_sha256 = hash("rollback-intent");
  intent.rollback_plan_sha256 = hash("rollback-plan");
  return intent;
}

function service(name, imageField, imageValue) {
  return {
    container_id: hash(`container:${name}`),
    [imageField]: imageValue,
    running: true,
    healthy: true,
    restart_count: 0,
    oom_killed: false,
  };
}

function stageEvidence(stage, intent, packageValue) {
  const targets = deriveUatPromotionRollbackRuntimeTargets(intent.rollback_operation_id);
  const commonVolume = (domain) => ({
    strategy: packageValue.restore_strategies.file_domains,
    source_artifact_sha256: packageValue.sources[`snapshot_${domain}`].sha256,
    source_artifact_bytes: intent.parameters.snapshot_objects[domain].bytes,
    source_entries: intent.parameters.snapshot_objects[domain].entries,
    source_reconciliation_sha256: packageValue.content_reconciliation.source_reconciliation_sha256,
    target_content_sha256: packageValue.content_reconciliation.files[domain].tree_sha256,
    target_volume: targets.volumes[domain].target,
    target_volume_identity_sha256: hash(`rollback-volume:${domain}`),
    retained_candidate_volume: `candidate_${domain}_001`,
    retained_candidate_volume_identity_sha256: hash(`candidate-volume:${domain}`),
    runtime_plan_sha256: packageValue.runtime_plan_sha256,
  });
  const values = {
    PRECONDITION_RECHECK: {
      execution_package_sha256: packageValue.package_sha256,
      source_set_sha256: packageValue.source_set_sha256,
      checkpoint_receipt_sha256: intent.parameters.previous_checkpoint_receipt_sha256,
      snapshot_intent_sha256: hash("snapshot-intent"),
      finalization_intent_sha256: hash("finalization-intent"),
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      runtime_activation_sha256: packageValue.sources.runtime_adapter_activation.sha256,
    },
    WRITER_CONTAINMENT: {
      database_fence_sha256: hash("database-fence"),
      candidate_service_set_sha256: clusterSha256({
        deployment_result_sha256: packageValue.sources.candidate_deployment_result.sha256,
        postdeploy_identity_sha256: packageValue.sources.candidate_postdeploy_identity.sha256,
      }),
      web_container_id: hash("candidate-web"),
      worker_container_id: hash("candidate-worker"),
      database_oid: database.oid,
      system_identifier: database.system_identifier,
      stopped: true,
      sealed: true,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
    },
    POSTGRESQL_RESTORE: {
      strategy: packageValue.restore_strategies.database,
      source_artifact_sha256: packageValue.sources.snapshot_postgresql.sha256,
      source_artifact_bytes: snapshotObjects.postgresql.bytes,
      source_reconciliation_sha256: packageValue.content_reconciliation.source_reconciliation_sha256,
      target_content_sha256: packageValue.content_reconciliation.database.report_sha256,
      snapshot_database_oid: database.oid,
      restored_database_oid: "17384",
      restored_database_name: database.name,
      system_identifier: database.system_identifier,
      migration_head: predecessor.migration_head,
      restored_database_marker: database.marker,
      staging_database_name: targets.database.staging,
      candidate_database_quarantine_name: targets.database.candidate_quarantine,
      candidate_database_quarantine_oid: database.oid,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
    },
    UPLOADS_RESTORE: commonVolume("uploads"),
    ATTACHMENTS_RESTORE: commonVolume("attachments"),
    BACKUP_STATUS_RESTORE: commonVolume("backup_status"),
    RUNTIME_CONFIGURATION_RESTORE: {
      compose_file_sha256: packageValue.sources.compose_file.sha256,
      compose_release_file_sha256: packageValue.sources.compose_release_file.sha256,
      deployment_environment_sha256: packageValue.sources.deployment_environment.sha256,
      runtime_policy_sha256: packageValue.sources.runtime_policy.sha256,
      runtime_configuration_sha256: predecessor.runtime_configuration_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
    },
    WEB_WORKER_PREDECESSOR_ACTIVATION: {
      strategy: packageValue.restore_strategies.runtime,
      web: service("web", "image_reference", predecessor.web_image),
      worker: service("worker", "image_reference", predecessor.worker_image),
      caddy: service("caddy", "image_digest", `sha256:${hash("caddy")}`),
      postgres: service("postgres", "image_digest", `sha256:${hash("postgres")}`),
      rollback_postdeploy_receipt_sha256: hash("rollback-postdeploy-receipt"),
      rollback_postdeploy_receipt_json: "{}\n",
      release_identity_sha256: hash("restored-release-identity"),
      release_identity_json: "{}\n",
      runtime_configuration_sha256: predecessor.runtime_configuration_sha256,
      protected_resources_sha256: packageValue.protected_resources_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
    },
    PROTECTED_RESOURCE_RECHECK: {
      before_sha256: packageValue.protected_resources_sha256,
      after_sha256: packageValue.protected_resources_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
    },
  };
  return values[stage];
}

function rollbackResult(intent = rollbackIntent(), packageValue = executionPackage(), mutateEvidence = null) {
  const base = Date.parse(intent.created_at);
  const stages = [];
  let previous = "0".repeat(64);
  for (const [index, stage] of UAT_PROMOTION_ROLLBACK_STAGES.entries()) {
    const common = {
      promotion_id: intent.promotion_id,
      promotion_generation: intent.promotion_generation,
      operation_id: intent.rollback_operation_id,
      execution_authorization_sha256: intent.execution_authorization_sha256,
      rollback_plan_sha256: intent.rollback_plan_sha256,
      execution_package_sha256: packageValue.package_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      ordinal: index + 1,
      stage,
      previous_result_sha256: previous,
      input_sha256: hash(`stage-input:${stage}`),
      prepared_at: new Date(base + index * 2_000).toISOString(),
    };
    const stageIntent = createUatPromotionRollbackStageIntent(common);
    const evidence = stageEvidence(stage, intent, packageValue);
    mutateEvidence?.(stage, evidence);
    const result = createUatPromotionRollbackStageResult({
      promotion_id: common.promotion_id,
      promotion_generation: common.promotion_generation,
      operation_id: common.operation_id,
      execution_authorization_sha256: common.execution_authorization_sha256,
      rollback_plan_sha256: common.rollback_plan_sha256,
      execution_package_sha256: common.execution_package_sha256,
      runtime_plan_sha256: common.runtime_plan_sha256,
      ordinal: common.ordinal,
      stage,
      previous_result_sha256: previous,
      stage_intent_sha256: stageIntent.stage_intent_sha256,
      evidence,
      started_at: common.prepared_at,
      completed_at: new Date(base + index * 2_000 + 1_000).toISOString(),
    });
    stages.push(result);
    previous = result.stage_result_sha256;
  }
  return createUatPromotionRollbackResult({
    promotion_id: intent.promotion_id,
    promotion_generation: intent.promotion_generation,
    rollback_operation_id: intent.rollback_operation_id,
    execution_authorization_sha256: intent.execution_authorization_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    checkpoint_13_receipt_sha256: intent.parameters.previous_checkpoint_receipt_sha256,
    rollback_intent_sha256: intent.rollback_intent_sha256,
    rollback_plan_sha256: intent.rollback_plan_sha256,
    execution_package_sha256: packageValue.package_sha256,
    runtime_plan_sha256: packageValue.runtime_plan_sha256,
    source_set_sha256: packageValue.source_set_sha256,
    promotion_snapshot_binding_sha256: intent.parameters.promotion_snapshot_binding_sha256,
    snapshot_readiness_sha256: intent.parameters.snapshot_readiness_sha256,
    snapshot_backup_id: intent.parameters.snapshot_backup_id,
    snapshot_restore_run_id: intent.parameters.snapshot_restore_run_id,
    snapshot_objects: intent.parameters.snapshot_objects,
    predecessor: intent.parameters.predecessor,
    database: intent.parameters.database,
    restored_database: { ...intent.parameters.database, oid: "17384" },
    candidate_database_quarantine: {
      name: stages[2].evidence.candidate_database_quarantine_name,
      oid: stages[2].evidence.candidate_database_quarantine_oid,
    },
    compose_project: intent.parameters.compose_project,
    compose_project_root: intent.parameters.compose_project_root,
    boundary: intent.parameters.boundary,
    protected_resources_before_sha256: packageValue.protected_resources_sha256,
    protected_resources_after_sha256: packageValue.protected_resources_sha256,
    stage_result_sha256_chain: previous,
    stages,
    started_at: stages[0].started_at,
    completed_at: stages.at(-1).completed_at,
  });
}

function postverifyIntent(rollback) {
  const intent = {
    promotion_id: rollback.promotion_id,
    promotion_generation: rollback.promotion_generation,
    postverify_operation_id: "finalize-uat-rollback-001",
    execution_authorization_sha256: hash("postverify-authorization"),
    supervisor_bundle_sha256: rollback.supervisor_bundle_sha256,
    created_at: "2026-08-15T02:01:00.000Z",
    expires_at: "2026-08-15T02:10:00.000Z",
    parameters: {
      previous_checkpoint_receipt_sha256: hash("checkpoint-14"),
      rollback_operation_id: rollback.rollback_operation_id,
      rollback_intent_sha256: rollback.rollback_intent_sha256,
      rollback_result_sha256: rollback.result_sha256,
    },
  };
  intent.postverify_intent_sha256 = hash("postverify-intent");
  intent.postverify_plan_sha256 = hash("postverify-plan");
  return intent;
}

function checkEvidence(check, rollback, packageValue, checkedAt) {
  const domainByCheck = {
    POSTGRESQL_CONTENT: "postgresql",
    UPLOADS_CONTENT: "uploads",
    ATTACHMENTS_CONTENT: "attachments",
    BACKUP_STATUS_CONTENT: "backup_status",
  };
  if (Object.hasOwn(domainByCheck, check)) {
    const domain = domainByCheck[check];
    const stageIndex = { postgresql: 2, uploads: 3, attachments: 4, backup_status: 5 }[domain];
    const stage = rollback.stages[stageIndex];
    return {
      source_artifact_sha256: packageValue.sources[`snapshot_${domain}`].sha256,
      source_artifact_bytes: rollback.snapshot_objects[domain].bytes,
      source_reconciliation_sha256: packageValue.content_reconciliation.source_reconciliation_sha256,
      target_content_sha256: domain === "postgresql"
        ? packageValue.content_reconciliation.database.report_sha256
        : packageValue.content_reconciliation.files[domain].tree_sha256,
      target_identity_sha256: domain === "postgresql"
        ? clusterSha256(rollback.restored_database)
        : stage.evidence.target_volume_identity_sha256,
      stage_result_sha256: stage.stage_result_sha256,
      entries: rollback.snapshot_objects[domain].entries,
      ...(domain === "postgresql" ? {
        candidate_database_quarantine_name: stage.evidence.candidate_database_quarantine_name,
        candidate_database_quarantine_oid: stage.evidence.candidate_database_quarantine_oid,
        candidate_database_quarantine_present: true,
      } : {
        candidate_volume_name: stage.evidence.retained_candidate_volume,
        candidate_volume_identity_sha256: stage.evidence.retained_candidate_volume_identity_sha256,
        candidate_volume_present: true,
      }),
    };
  }
  const activation = rollback.stages[7].evidence;
  const values = {
    MIGRATION_HEAD: {
      migration_head: rollback.predecessor.migration_head,
      migration_manifest_sha256: rollback.predecessor.migration_manifest_sha256,
      database_identity_sha256: clusterSha256(rollback.restored_database),
      postgresql_stage_result_sha256: rollback.stages[2].stage_result_sha256,
    },
    CADDY_IDENTITY: activation.caddy,
    POSTGRES_IDENTITY: activation.postgres,
    WEB_IDENTITY: {
      ...activation.web,
      application_version: rollback.predecessor.application_version,
      git_commit: rollback.predecessor.git_commit,
    },
    WORKER_IDENTITY: {
      ...activation.worker,
      application_version: rollback.predecessor.application_version,
      git_commit: rollback.predecessor.git_commit,
    },
    RUNTIME_CONFIGURATION: {
      runtime_configuration_sha256: rollback.predecessor.runtime_configuration_sha256,
      deployment_environment_sha256: packageValue.sources.deployment_environment.sha256,
      activation_stage_result_sha256: rollback.stages[7].stage_result_sha256,
      runtime_plan_sha256: rollback.runtime_plan_sha256,
    },
    STRICT_RELEASE_IDENTITY: {
      release_identity_sha256: activation.release_identity_sha256,
      release_manifest_sha256: rollback.predecessor.release_manifest_sha256,
      rollback_postdeploy_receipt_sha256: activation.rollback_postdeploy_receipt_sha256,
      activation_stage_result_sha256: rollback.stages[7].stage_result_sha256,
    },
    HEALTH: (() => {
      const receipt = JSON.parse(activation.rollback_postdeploy_receipt_json);
      const readiness = { ...receipt.readiness, database_time: checkedAt };
      const services = {
        caddy: activation.caddy, postgres: activation.postgres,
        web: activation.web, worker: activation.worker,
      };
      const body = {
        status: "HEALTHY",
        checked_at: checkedAt,
        readiness_sha256: clusterSha256(readiness),
        readiness,
        services,
        service_set_sha256: clusterSha256(services),
        release_identity_sha256: activation.release_identity_sha256,
        runtime_configuration_sha256: activation.runtime_configuration_sha256,
      };
      return { ...body, health_sha256: clusterSha256(body) };
    })(),
    PROTECTED_RESOURCES: {
      before_sha256: packageValue.protected_resources_sha256,
      after_sha256: packageValue.protected_resources_sha256,
      protected_recheck_stage_result_sha256: rollback.stages[8].stage_result_sha256,
      runtime_plan_sha256: rollback.runtime_plan_sha256,
    },
  };
  return values[check];
}

function postverifyResult(rollback, intent = postverifyIntent(rollback), packageValue = executionPackage()) {
  const checks = [];
  let previous = "0".repeat(64);
  const base = Date.parse(intent.created_at);
  for (const [index, check] of UAT_PROMOTION_ROLLBACK_POSTVERIFY_CHECKS.entries()) {
    const common = {
      promotion_id: rollback.promotion_id,
      promotion_generation: rollback.promotion_generation,
      operation_id: intent.postverify_operation_id,
      execution_authorization_sha256: intent.execution_authorization_sha256,
      rollback_plan_sha256: rollback.rollback_plan_sha256,
      execution_package_sha256: rollback.execution_package_sha256,
      runtime_plan_sha256: rollback.runtime_plan_sha256,
      ordinal: index + 1,
      check,
      previous_result_sha256: previous,
      input_sha256: hash(`check-input:${check}`),
      prepared_at: new Date(base + index * 1_000).toISOString(),
    };
    const checkIntent = createUatPromotionRollbackCheckIntent(common);
    const result = createUatPromotionRollbackCheckResult({
      promotion_id: common.promotion_id,
      promotion_generation: common.promotion_generation,
      operation_id: common.operation_id,
      execution_authorization_sha256: common.execution_authorization_sha256,
      rollback_plan_sha256: common.rollback_plan_sha256,
      execution_package_sha256: common.execution_package_sha256,
      runtime_plan_sha256: common.runtime_plan_sha256,
      ordinal: common.ordinal,
      check,
      previous_result_sha256: previous,
      check_intent_sha256: checkIntent.check_intent_sha256,
      evidence: checkEvidence(
        check, rollback, packageValue, new Date(base + index * 1_000 + 250).toISOString(),
      ),
      started_at: common.prepared_at,
      completed_at: new Date(base + index * 1_000 + 500).toISOString(),
    });
    checks.push(result);
    previous = result.check_result_sha256;
  }
  return createUatPromotionRollbackPostverifyResult({
    promotion_id: rollback.promotion_id,
    promotion_generation: rollback.promotion_generation,
    postverify_operation_id: intent.postverify_operation_id,
    execution_authorization_sha256: intent.execution_authorization_sha256,
    supervisor_bundle_sha256: intent.supervisor_bundle_sha256,
    checkpoint_14_receipt_sha256: intent.parameters.previous_checkpoint_receipt_sha256,
    rollback_operation_id: rollback.rollback_operation_id,
    rollback_intent_sha256: rollback.rollback_intent_sha256,
    rollback_result_sha256: rollback.result_sha256,
    rollback_plan_sha256: rollback.rollback_plan_sha256,
    execution_package_sha256: rollback.execution_package_sha256,
    runtime_plan_sha256: rollback.runtime_plan_sha256,
    postverify_intent_sha256: intent.postverify_intent_sha256,
    postverify_plan_sha256: intent.postverify_plan_sha256,
    snapshot_objects: rollback.snapshot_objects,
    predecessor: rollback.predecessor,
    database: rollback.database,
    restored_database: rollback.restored_database,
    candidate_database_quarantine: rollback.candidate_database_quarantine,
    boundary: rollback.boundary,
    check_result_sha256_chain: previous,
    checks,
    verified_at: checks.at(-1).completed_at,
  });
}

test("checkpoint 14 accepts only the complete ordered four-domain predecessor rollback", () => {
  const intent = rollbackIntent();
  const result = rollbackResult(intent);
  assert.equal(validateUatPromotionRollbackResult(result), result);
  assert.equal(assertUatPromotionRollbackResultMatchesIntent(result, intent), result);
  assert.equal(result.stages.length, 9);
  assert.deepEqual(Object.keys(result.snapshot_objects).sort(), [
    "attachments", "backup_status", "postgresql", "uploads",
  ]);
});

test("checkpoint 14 rejects partial stages, target drift, and protected-resource replacement", () => {
  const intent = rollbackIntent();
  const result = rollbackResult(intent);
  assert.throws(
    () => validateUatPromotionRollbackResult({ ...result, stages: result.stages.slice(0, -1) }),
    /UAT_PROMOTION_ROLLBACK_RESULT_INVALID/,
  );
  assert.throws(
    () => assertUatPromotionRollbackResultMatchesIntent({
      ...result, predecessor: { ...result.predecessor, migration_head: "0046_drift.sql" },
    }, intent),
    /UAT_PROMOTION_ROLLBACK_RESULT_INVALID|UAT_PROMOTION_ROLLBACK_RESULT_BINDING_INVALID/,
  );
  assert.throws(
    () => validateUatPromotionRollbackResult({
      ...result, protected_resources_after_sha256: hash("replaced-protected-resources"),
    }),
    /UAT_PROMOTION_ROLLBACK_RESULT_INVALID/,
  );
});

test("checkpoint 14 requires the candidate database quarantine OID and disjoint restored volumes", () => {
  assert.throws(
    () => rollbackResult(rollbackIntent(), executionPackage(), (stage, evidence) => {
      if (stage === "POSTGRESQL_RESTORE") evidence.candidate_database_quarantine_oid = "18384";
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID|UAT_PROMOTION_ROLLBACK_RESULT_INVALID/,
  );
  assert.throws(
    () => rollbackResult(rollbackIntent(), executionPackage(), (stage, evidence) => {
      if (stage === "ATTACHMENTS_RESTORE") {
        evidence.target_volume_identity_sha256 = hash("rollback-volume:uploads");
      }
    }),
    /UAT_PROMOTION_ROLLBACK_RESULT_INVALID/,
  );
  assert.throws(
    () => rollbackResult(rollbackIntent(), executionPackage(), (stage, evidence) => {
      if (stage === "BACKUP_STATUS_RESTORE") {
        evidence.target_volume_identity_sha256 = hash("candidate-volume:uploads");
      }
    }),
    /UAT_PROMOTION_ROLLBACK_RESULT_INVALID/,
  );
});

test("checkpoint 15 uses a distinct authorization and verifies every restored domain and service", () => {
  const rollbackIntentValue = rollbackIntent();
  const rollback = rollbackResult(rollbackIntentValue);
  const intent = postverifyIntent(rollback);
  const result = postverifyResult(rollback, intent);
  assert.notEqual(intent.execution_authorization_sha256, rollback.execution_authorization_sha256);
  assert.equal(validateUatPromotionRollbackPostverifyResult(result), result);
  assert.equal(assertUatPromotionRollbackPostverifyResultMatchesIntent(result, intent, rollback), result);
  assert.equal(result.checks.length, 13);
});

test("checkpoint 15 rejects authorization reuse, missing checks, and result substitution", () => {
  const rollback = rollbackResult();
  const reused = postverifyIntent(rollback);
  reused.execution_authorization_sha256 = rollback.execution_authorization_sha256;
  const reusedResult = postverifyResult(rollback, reused);
  assert.equal(reusedResult.execution_authorization_sha256, rollback.execution_authorization_sha256);
  // The pure result contract is intentionally context-agnostic; the transaction layer must reject reuse.
  assert.equal(validateUatPromotionRollbackPostverifyResult(reusedResult), reusedResult);

  const intent = postverifyIntent(rollback);
  const result = postverifyResult(rollback, intent);
  assert.throws(
    () => validateUatPromotionRollbackPostverifyResult({ ...result, checks: result.checks.slice(1) }),
    /UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_INVALID/,
  );
  assert.throws(
    () => assertUatPromotionRollbackPostverifyResultMatchesIntent(
      { ...result, rollback_result_sha256: hash("substituted-result") }, intent, rollback,
    ),
    /UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_INVALID|UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_BINDING_INVALID/,
  );
});

test("rollback boundary can never be relabelled as down migration or business reversal", () => {
  const result = rollbackResult();
  for (const boundaryDrift of [
    { down_migration: true },
    { direct_sql_correction: true },
    { business_fact_deletion: true },
    { automatic_business_compensation: true },
    { posted_business_reversal: "AUTOMATIC" },
  ]) {
    assert.throws(
      () => validateUatPromotionRollbackResult({
        ...result, boundary: { ...result.boundary, ...boundaryDrift },
      }),
      /UAT_PROMOTION_ROLLBACK_RESULT_INVALID/,
    );
  }
});

test("checkpoint 13 can append independently timed and independently authorized checkpoints 14 and 15", () => {
  const authorizationChain = Array.from({ length: 10 }, (_, index) => hash(`authorization-${index}`));
  const checkpoint13Body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-checkpoint-receipt/v1",
    promotion_id: "promotion-rollback-chain-001",
    promotion_generation: 1,
    journal_sequence: 10,
    checkpoint_id: "PROMOTION_FINAL_RECEIPT",
    checkpoint_ordinal: 13,
    completed_checkpoints: checkpointOrder.slice(0, 13),
    checkpoint_status: "COMMITTED",
    journal_status: "COMMITTED",
    recorded_at: "2026-08-15T01:59:00.000Z",
    promotion_expires_at: "2026-08-15T02:00:00.000Z",
    intent_sha256: hash("promotion-intent"),
    candidate_binding_sha256: hash("candidate-binding"),
    database_binding_sha256: hash("database-binding"),
    runtime_binding_sha256: hash("runtime-binding"),
    recovery_binding_sha256: hash("recovery-binding"),
    promotion_snapshot_binding_sha256: hash("snapshot-binding"),
    writer_quiesce_binding_sha256: hash("writer-binding"),
    migration_authorization_binding_sha256: hash("migration-authorization-binding"),
    migration_fence_binding_sha256: hash("migration-fence-binding"),
    migration_result_binding_sha256: hash("migration-result-binding"),
    compose_deployment_binding_sha256: hash("compose-binding"),
    previous_promotion_receipt_sha256: "0".repeat(64),
    previous_checkpoint_receipt_sha256: hash("checkpoint-12"),
    original_authorization_sha256: authorizationChain[0],
    checkpoint_authorization_sha256: authorizationChain.at(-1),
    authorization_sha256_chain: authorizationChain,
    authorization_chain_sha256: clusterSha256(authorizationChain),
    checkpoint_evidence_sha256: hash("checkpoint-13-evidence"),
  };
  const checkpoint13 = validateUatPromotionCheckpointReceipt({
    ...checkpoint13Body,
    receipt_sha256: clusterSha256(checkpoint13Body),
  });
  const bindingInput = {
    intent_sha256: checkpoint13.intent_sha256,
    candidate_binding_sha256: checkpoint13.candidate_binding_sha256,
    database_binding_sha256: checkpoint13.database_binding_sha256,
    runtime_binding_sha256: checkpoint13.runtime_binding_sha256,
    recovery_binding_sha256: checkpoint13.recovery_binding_sha256,
    promotion_snapshot_binding_sha256: checkpoint13.promotion_snapshot_binding_sha256,
    writer_quiesce_binding_sha256: checkpoint13.writer_quiesce_binding_sha256,
    migration_authorization_binding_sha256: checkpoint13.migration_authorization_binding_sha256,
    migration_fence_binding_sha256: checkpoint13.migration_fence_binding_sha256,
    migration_result_binding_sha256: checkpoint13.migration_result_binding_sha256,
    compose_deployment_binding_sha256: checkpoint13.compose_deployment_binding_sha256,
  };
  const rollbackAuthorization = hash("rollback-authorization-independent");
  const checkpoint14 = createNextUatPromotionCheckpointReceipt(checkpoint13, {
    ...bindingInput,
    checkpoint_id: "ROLLBACK_TO_UAT_EXECUTOR",
    checkpoint_status: "COMMITTED",
    journal_status: "ROLLBACK_IN_PROGRESS",
    recorded_at: "2026-08-20T03:00:00.000Z",
    checkpoint_evidence_sha256: hash("rollback-result"),
    checkpoint_authorization_sha256: rollbackAuthorization,
  });
  const postverifyAuthorization = hash("postverify-authorization-independent");
  const checkpoint15 = createNextUatPromotionCheckpointReceipt(checkpoint14, {
    ...bindingInput,
    checkpoint_id: "ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT",
    checkpoint_status: "COMMITTED",
    journal_status: "ROLLED_BACK",
    recorded_at: "2026-08-20T03:05:00.000Z",
    checkpoint_evidence_sha256: hash("postverify-result"),
    checkpoint_authorization_sha256: postverifyAuthorization,
  });
  assert.equal(checkpoint14.journal_status, "ROLLBACK_IN_PROGRESS");
  assert.equal(checkpoint15.journal_status, "ROLLED_BACK");
  assert.deepEqual(checkpoint15.authorization_sha256_chain.slice(-2), [
    rollbackAuthorization, postverifyAuthorization,
  ]);
  assert.throws(() => createNextUatPromotionCheckpointReceipt(checkpoint14, {
    ...bindingInput,
    checkpoint_id: "ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT",
    checkpoint_status: "COMMITTED",
    journal_status: "ROLLED_BACK",
    recorded_at: "2026-08-20T03:05:00.000Z",
    checkpoint_evidence_sha256: hash("postverify-result"),
    checkpoint_authorization_sha256: rollbackAuthorization,
  }), /UAT_PROMOTION_CHECKPOINT_AUTHORIZATION_REUSED/);
});
