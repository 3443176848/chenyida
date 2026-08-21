import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION,
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
  validateUatPromotionRollbackExecutionPackage,
  validateUatPromotionRollbackPostverifyResult,
  validateUatPromotionRollbackResult,
  validateUatPromotionRollbackStageResult,
} from "../scripts/uat-promotion-rollback-contract.mjs";
import {
  createUatPromotionRollbackReconciliationAuthority,
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
const without = (value, field) => Object.fromEntries(
  Object.entries(value).filter(([key]) => key !== field),
);
function preactivationContentProof({ bindingSha256, runtimePlanSha256, reconciliationSha256,
  reportSha256, migrationHead, migrationLedgerFileSha256, migrationAllowlistSha256,
  database, restoredOid,
  quarantineName, quarantineMarker }) {
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-rollback-preactivation-content-proof/v2",
    binding_sha256: bindingSha256,
    runtime_plan_sha256: runtimePlanSha256,
    source_reconciliation_sha256: reconciliationSha256,
    source_database_report_sha256: reportSha256,
    live_database_report_sha256: reportSha256,
    migration_head: migrationHead,
    migration_ledger_file_sha256: migrationLedgerFileSha256,
    migration_allowlist_sha256: migrationAllowlistSha256,
    migration_ledger_sha256: hash("preactivation-migration-ledger"),
    live_security_state_sha256: hash("preactivation-security-state"),
    active_allowed_session_role_set_sha256: hash("preactivation-role-set"),
    active_session_client_policy_sha256: hash("preactivation-client-policy"),
    active_session_observation_sha256: hash("preactivation-session-observation"),
    active_writer_session_count: 0,
    active_database_identity_sha256: clusterSha256({
      name: database.name, system_identifier: database.system_identifier,
      oid: restoredOid, marker: database.marker,
    }),
    restored_database_oid: restoredOid,
    restored_database_marker: database.marker,
    system_identifier: database.system_identifier,
    active_allow_connections: true,
    active_connection_limit: 64,
    active_default_transaction_read_only: false,
    active_prepared_xacts: 0,
    candidate_database_quarantine_name: quarantineName,
    candidate_database_quarantine_oid: database.oid,
    candidate_database_quarantine_marker: quarantineMarker,
    candidate_database_quarantine_allow_connections: false,
    candidate_database_quarantine_connection_limit: 0,
    candidate_database_quarantine_sessions: 0,
    candidate_database_quarantine_prepared_xacts: 0,
    before_observation_sha256: hash("preactivation-before"),
    after_observation_sha256: hash("preactivation-after"),
  };
  return { ...body, proof_sha256: clusterSha256(body) };
}

function restorePreconditionProof({ baseSpecSha256, opcodeSpecSha256,
  createReceiptSha256, dumpInventorySha256, systemIdentifier, databaseName,
  databaseOid, databaseMarker }) {
  const databaseValue = {
    name: databaseName,
    oid: databaseOid,
    marker: databaseMarker,
    owner: "postgres",
    allow_connections: true,
    connection_limit: 0,
    default_transaction_read_only: true,
    sessions: 0,
    prepared_xacts: 0,
  };
  const profile = {
    encoding: "UTF8",
    locale_provider: "libc",
    collate: "C.UTF-8",
    ctype: "C.UTF-8",
    collation_version: null,
    default_tablespace: "pg_default",
  };
  const emptyProjection = {
    user_schema_count: 0,
    relation_count: 0,
    sequence_count: 0,
    routine_count: 0,
    standalone_type_count: 0,
    unexpected_extension_count: 0,
    large_object_count: 0,
    schema_migrations_present: false,
  };
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-rollback-postgresql-restore-precondition/v1",
    base_spec_sha256: baseSpecSha256,
    opcode_spec_sha256: opcodeSpecSha256,
    binding_sha256: createReceiptSha256,
    create_receipt_sha256: createReceiptSha256,
    dump_inventory_sha256: dumpInventorySha256,
    system_identifier: systemIdentifier,
    server_version_num: "170006",
    database: databaseValue,
    database_identity_sha256: clusterSha256({
      system_identifier: systemIdentifier, ...databaseValue,
    }),
    profile,
    profile_sha256: clusterSha256(profile),
    empty_projection: emptyProjection,
    empty_projection_sha256: clusterSha256(emptyProjection),
    raw_observation_sha256: hash("rollback-restore-precondition-observation"),
  };
  return { ...body, restore_precondition_sha256: clusterSha256(body) };
}

function stagingContentProof({ bindingSha256, baseSpecSha256, runtimePlanSha256,
  reconciliationSha256, reportSha256, migrationHead, migrationLedgerFileSha256,
  migrationAllowlistSha256, stagingName, stagingOid, stagingMarker,
  systemIdentifier, candidateName, candidateOid, candidateMarker }) {
  const body = {
    schema_version: 1,
    contract: "chenyida-erp-uat-promotion-rollback-staging-content-proof/v1",
    binding_sha256: bindingSha256,
    base_spec_sha256: baseSpecSha256,
    runtime_plan_sha256: runtimePlanSha256,
    source_reconciliation_sha256: reconciliationSha256,
    source_database_report_sha256: reportSha256,
    live_database_report_sha256: reportSha256,
    migration_head: migrationHead,
    migration_ledger_file_sha256: migrationLedgerFileSha256,
    migration_allowlist_sha256: migrationAllowlistSha256,
    migration_ledger_sha256: hash("rollback-staging-migration-ledger"),
    live_security_state_sha256: hash("rollback-staging-security-state"),
    staging_allowed_session_role_set_sha256: hash("rollback-staging-role-set"),
    staging_session_client_policy_sha256: hash("rollback-staging-client-policy"),
    staging_session_observation_sha256: hash("rollback-staging-session-observation"),
    staging_writer_session_count: 0,
    staging_database_identity_sha256: clusterSha256({
      name: stagingName, system_identifier: systemIdentifier,
      oid: stagingOid, marker: stagingMarker,
    }),
    staging_database_name: stagingName,
    staging_database_oid: stagingOid,
    staging_database_marker: stagingMarker,
    system_identifier: systemIdentifier,
    staging_allow_connections: true,
    staging_connection_limit: 0,
    staging_default_transaction_read_only: true,
    staging_prepared_xacts: 0,
    candidate_database_name: candidateName,
    candidate_database_oid: candidateOid,
    candidate_database_marker: candidateMarker,
    candidate_database_allow_connections: false,
    candidate_database_connection_limit: 0,
    candidate_database_sessions: 0,
    candidate_database_prepared_xacts: 0,
    before_observation_sha256: hash("rollback-staging-before"),
    after_observation_sha256: hash("rollback-staging-after"),
  };
  return { ...body, proof_sha256: clusterSha256(body) };
}
const reconciliationAuthority = () => createUatPromotionRollbackReconciliationAuthority({
  authority_id: "rollback-reconciliation-authority-001",
  promotion_id: "promotion-001", promotion_generation: 1,
  rollback_operation_id: "rollback-uat-release-001",
  approval_reference_sha256: hash("reconciliation-approval"),
  requester_identity_sha256: hash("reconciliation-requester"),
  approver_identity_sha256: hash("reconciliation-approver"),
  approved_at: "2026-08-15T01:00:00.000Z", expires_at: "2026-08-16T01:00:00.000Z",
});
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
    snapshot_runtime_privilege_access: source("snapshot-runtime-privilege-access.json"),
    snapshot_runtime_privilege_compiled_catalog:
      source("snapshot-runtime-privilege-compiled-catalog.json"),
    snapshot_runtime_privilege_policy: source("snapshot-runtime-privilege-policy.json"),
    snapshot_runtime_privilege_operator_policy:
      source("snapshot-runtime-privilege-operator-policy.json"),
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
      path: "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v2.json",
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
      web_image: predecessor.web_image,
      web_image_config_digest: `sha256:${hash("predecessor-web-config")}`,
      worker_image: predecessor.worker_image,
      worker_image_config_digest: `sha256:${hash("predecessor-worker-config")}`,
    },
    reconciliation_authority: reconciliationAuthority(),
    toolchain: {
      executor: {
        path: "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1",
        sha256: hash("rollback-executor"), uid: 0, gid: 0, mode: "0555",
      },
      docker: {
        path: "/usr/bin/docker", sha256: hash("docker"), uid: 0, gid: 0, mode: "0755",
      },
      compose_plugin: {
        path: "/usr/libexec/docker/cli-plugins/docker-compose",
        sha256: hash("compose-plugin"), uid: 0, gid: 0, mode: "0755",
      },
    },
    helpers: {
      volume_restore: {
        image_reference: image("volume-restore-helper"),
        image_config_digest: `sha256:${hash("volume-restore-helper-config")}`,
        application_version: "0.1.0-alpha.47",
        git_commit: "1".repeat(40), git_tree: "2".repeat(40),
        image_role: "volume-restore-helper", platform: "linux/amd64",
        protocol: "chenyida-erp-volume-helper/v1",
        contract_sha256: "143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d",
        evidence_run_id: "helper-evidence-fixture",
        backup_status_reader_gid: 1000,
        build_provenance_sha256: hash("helper-build-provenance"),
        sbom_evidence_sha256: hash("helper-sbom-evidence"),
        security_evidence_sha256: hash("helper-security-evidence"),
        supervisor_bundle_sha256: hash("helper-supervisor-bundle"),
      },
    },
    source_bindings: {
      snapshot_objects_sha256: clusterSha256(snapshotObjects),
      snapshot_reconciliation_sha256: sources.snapshot_reconciliation.sha256,
      snapshot_manifest_sha256: sources.snapshot_manifest.sha256,
      snapshot_policy_sha256: sources.snapshot_policy.sha256,
      runtime_privilege_access_sha256: sources.snapshot_runtime_privilege_access.sha256,
      runtime_privilege_compiled_catalog_sha256:
        sources.snapshot_runtime_privilege_compiled_catalog.sha256,
      runtime_privilege_policy_sha256: sources.snapshot_runtime_privilege_policy.sha256,
      runtime_privilege_operator_policy_sha256:
        sources.snapshot_runtime_privilege_operator_policy.sha256,
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

function applicationService(name, imageReference, imageConfigDigest) {
  return {
    ...service(name, "image_reference", imageReference),
    image_config_digest: imageConfigDigest,
  };
}

function stageEvidence(stage, intent, packageValue, priorStages = []) {
  const targets = deriveUatPromotionRollbackRuntimeTargets(intent.rollback_operation_id);
  const restoredDatabaseOid = "17384";
  const postgresBaseSpecSha256 = hash("rollback-postgresql-base-spec");
  const capacityReceiptSha256 = hash("rollback-postgresql-capacity-receipt");
  const restoreReceiptSha256 = hash("rollback-postgresql-restore-receipt");
  const privilegeReconcileReceiptSha256 = hash("rollback-postgresql-reconcile-receipt");
  const restorePrecondition = restorePreconditionProof({
    baseSpecSha256: postgresBaseSpecSha256,
    opcodeSpecSha256: hash("rollback-restore-precondition-opcode-spec"),
    createReceiptSha256: capacityReceiptSha256,
    dumpInventorySha256: hash("rollback-postgresql-dump-inventory"),
    systemIdentifier: database.system_identifier,
    databaseName: targets.database.staging,
    databaseOid: restoredDatabaseOid,
    databaseMarker:
      `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:RESTORED_STAGING`,
  });
  const preSwitchContentProof = stagingContentProof({
    bindingSha256: privilegeReconcileReceiptSha256,
    baseSpecSha256: postgresBaseSpecSha256,
    runtimePlanSha256: packageValue.runtime_plan_sha256,
    reconciliationSha256: packageValue.content_reconciliation.source_reconciliation_sha256,
    reportSha256: packageValue.content_reconciliation.database.report_sha256,
    migrationHead: predecessor.migration_head,
    migrationLedgerFileSha256: packageValue.sources.snapshot_migrations.sha256,
    migrationAllowlistSha256: predecessor.migration_manifest_sha256,
    stagingName: targets.database.staging,
    stagingOid: restoredDatabaseOid,
    stagingMarker:
      `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:RESTORED_STAGING`,
    systemIdentifier: database.system_identifier,
    candidateName: database.name,
    candidateOid: database.oid,
    candidateMarker: database.marker,
  });
  const guardedSwitch = {
    opcodeSpecSha256: hash("rollback-postgresql-guarded-opcode-spec"),
    sqlSha256: hash("rollback-postgresql-guarded-sql"),
    runnerArgvTemplateSha256: hash("rollback-postgresql-guarded-runner-argv"),
    stateSha256: clusterSha256({
      source_reconciliation_sha256: preSwitchContentProof.source_reconciliation_sha256,
      expected_content_report_sha256: preSwitchContentProof.source_database_report_sha256,
      migration_ledger_file_sha256: preSwitchContentProof.migration_ledger_file_sha256,
      migration_allowlist_sha256: preSwitchContentProof.migration_allowlist_sha256,
      expected_security_state_sha256: preSwitchContentProof.live_security_state_sha256,
      staging_content_proof_sha256: preSwitchContentProof.proof_sha256,
      staging_oid: preSwitchContentProof.staging_database_oid,
    }),
    expectedIdentitySha256: clusterSha256({
      active_name: database.name,
      active_oid: restoredDatabaseOid,
      quarantine_name: targets.database.candidate_quarantine,
      quarantine_oid: database.oid,
      state: "NEW_SEALED",
    }),
  };
  const switchReceiptBody = {
    schema_version: 2,
    contract: "chenyida-erp-uat-promotion-rollback-side-effect-receipt/v2",
    status: "COMMITTED",
    operation_id: intent.rollback_operation_id,
    label: "POSTGRESQL_RESTORE",
    side_effect_name: "DATABASE_SWITCH",
    intent_sha256: hash("rollback-postgresql-switch-intent"),
    before_identity_sha256: preSwitchContentProof.proof_sha256,
    after_identity_sha256: hash("rollback-postgresql-switch-effect"),
    argv_template_sha256: clusterSha256({
      opcode: "PG_RB_GUARDED_SWITCH_V3",
      opcode_spec_sha256: guardedSwitch.opcodeSpecSha256,
      sql_sha256: guardedSwitch.sqlSha256,
      runner_argv_template_sha256: guardedSwitch.runnerArgvTemplateSha256,
    }),
    recovery_observation_sha256: "0".repeat(64),
    daemon_state: "COMPLETED_NO_UNTRACKED_PROCESS",
    completed_at: "2026-08-15T02:00:02.500Z",
  };
  const switchReceipt = {
    ...switchReceiptBody, receipt_sha256: clusterSha256(switchReceiptBody),
  };
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
    domain,
    manifest_sha256: packageValue.sources.snapshot_manifest.sha256,
    expected_tree_sha256: packageValue.content_reconciliation.files[domain].tree_sha256,
    target_volume_marker_sha256: hash(`rollback-volume-marker:${domain}`),
    target_root_identity_sha256: hash(`rollback-root-identity:${domain}`),
    metadata_policy_sha256: hash(`rollback-metadata-policy:${domain}`),
    metadata_state_sha256: hash(`rollback-metadata-state:${domain}`),
    capacity_receipt_sha256: hash(`rollback-capacity-receipt:${domain}`),
    volume_restore_receipt_sha256: hash(`rollback-volume-restore-receipt:${domain}`),
    helper_image_reference: image("rollback-volume-helper"),
    helper_image_config_digest: `sha256:${hash("rollback-volume-helper-config")}`,
    archive_inventory_sha256: hash(`rollback-archive-inventory:${domain}`),
    ...(domain === "backup_status" ? {
      backup_status_disposition: UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION,
      current_backup_readiness: false,
      post_rollback_backup_required: true,
    } : {}),
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
      restored_database_oid: restoredDatabaseOid,
      restored_database_name: database.name,
      system_identifier: database.system_identifier,
      migration_head: predecessor.migration_head,
      restored_database_marker: database.marker,
      staging_database_name: targets.database.staging,
      candidate_database_quarantine_name: targets.database.candidate_quarantine,
      candidate_database_quarantine_oid: database.oid,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      manifest_sha256: packageValue.sources.snapshot_manifest.sha256,
      migration_ledger_file_sha256: packageValue.sources.snapshot_migrations.sha256,
      migration_manifest_sha256: predecessor.migration_manifest_sha256,
      writer_containment_stage_result_sha256:
        priorStages[1]?.stage_result_sha256 ?? hash("writer-containment-stage-result-unavailable"),
      postgres_container_id: hash("candidate-container:postgres"),
      postgres_image_config_digest: `sha256:${hash("candidate-image:postgres")}`,
      database_profile_sha256: restorePrecondition.profile_sha256,
      postgres_base_spec_sha256: postgresBaseSpecSha256,
      staging_create_receipt_sha256: capacityReceiptSha256,
      restore_receipt_sha256: restoreReceiptSha256,
      privilege_reconcile_receipt_sha256: privilegeReconcileReceiptSha256,
      restore_precondition_opcode_spec_sha256: restorePrecondition.opcode_spec_sha256,
      restore_precondition_sha256: restorePrecondition.restore_precondition_sha256,
      dump_inventory_sha256: restorePrecondition.dump_inventory_sha256,
      empty_projection_sha256: restorePrecondition.empty_projection_sha256,
      restore_precondition: restorePrecondition,
      pre_switch_content_proof_sha256: preSwitchContentProof.proof_sha256,
      pre_switch_content_proof: preSwitchContentProof,
      runtime_privilege_access_sha256:
        packageValue.sources.snapshot_runtime_privilege_access.sha256,
      runtime_privilege_catalog_sha256: hash("rollback-runtime-privilege-catalog"),
      runtime_privilege_catalog_artifact_sha256:
        packageValue.sources.snapshot_runtime_privilege_compiled_catalog.sha256,
      runtime_privilege_policy_sha256:
        packageValue.sources.snapshot_runtime_privilege_policy.sha256,
      runtime_privilege_operator_policy_sha256:
        packageValue.sources.snapshot_runtime_privilege_operator_policy.sha256,
      uat_reconciliation_authority_sha256: reconciliationAuthority().authority_sha256,
      uat_reconciliation_activation_sha256: hash("rollback-reconciliation-activation"),
      sealed_security_projection_sha256: hash("rollback-sealed-security-projection"),
      staging_database_marker:
        `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:RESTORED_STAGING`,
      candidate_database_quarantine_marker:
        `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:CANDIDATE_QUARANTINE`,
      guarded_switch_opcode_spec_sha256: guardedSwitch.opcodeSpecSha256,
      guarded_switch_sql_sha256: guardedSwitch.sqlSha256,
      guarded_switch_runner_argv_template_sha256: guardedSwitch.runnerArgvTemplateSha256,
      guarded_switch_state_sha256: guardedSwitch.stateSha256,
      guarded_switch_expected_identity_sha256: guardedSwitch.expectedIdentitySha256,
      switch_receipt_sha256: switchReceipt.receipt_sha256,
      switch_effect_identity_sha256: switchReceipt.after_identity_sha256,
      switch_receipt: switchReceipt,
      restored_database_allow_connections_at_commit: false,
      restored_database_connection_limit_at_commit: 0,
      restored_database_sessions_at_commit: 0,
      restored_database_prepared_xacts_at_commit: 0,
      candidate_database_quarantine_allow_connections_at_commit: false,
      candidate_database_quarantine_connection_limit_at_commit: 0,
      candidate_database_quarantine_sessions_at_commit: 0,
      candidate_database_quarantine_prepared_xacts_at_commit: 0,
    },
    UPLOADS_RESTORE: commonVolume("uploads"),
    ATTACHMENTS_RESTORE: commonVolume("attachments"),
    BACKUP_STATUS_RESTORE: commonVolume("backup_status"),
    RUNTIME_CONFIGURATION_RESTORE: {
      compose_file_sha256: packageValue.sources.compose_file.sha256,
      compose_release_file_sha256: packageValue.sources.compose_release_file.sha256,
      deployment_environment_sha256: packageValue.sources.deployment_environment.sha256,
      runtime_policy_sha256: packageValue.sources.runtime_policy.sha256,
      predecessor_runtime_configuration_sha256: predecessor.runtime_configuration_sha256,
      rollback_runtime_projection_sha256: hash("rollback-runtime-projection"),
      compose_rollback_overlay_sha256: hash("rollback-compose-overlay"),
      rollback_runtime_configuration_sha256: hash("rollback-runtime-configuration"),
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
    },
    WEB_WORKER_PREDECESSOR_ACTIVATION: {
      strategy: packageValue.restore_strategies.runtime,
      web: applicationService(
        "web", predecessor.web_image, `sha256:${hash("predecessor-web-config")}`,
      ),
      worker: applicationService(
        "worker", predecessor.worker_image,
        `sha256:${hash("predecessor-worker-config")}`,
      ),
      caddy: service("caddy", "image_digest", `sha256:${hash("caddy")}`),
      postgres: service("postgres", "image_digest", `sha256:${hash("postgres")}`),
      rollback_postdeploy_receipt_sha256: hash("rollback-postdeploy-receipt"),
      rollback_postdeploy_receipt_json: "{}\n",
      release_identity_sha256: hash("restored-release-identity"),
      release_identity_json: "{}\n",
      predecessor_runtime_configuration_sha256: predecessor.runtime_configuration_sha256,
      rollback_runtime_configuration_sha256: hash("rollback-runtime-configuration"),
      rollback_runtime_projection_sha256: hash("rollback-runtime-projection"),
      compose_rollback_overlay_sha256: hash("rollback-compose-overlay"),
      protected_resources_sha256: packageValue.protected_resources_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      uat_reconciliation_authority_sha256:
        priorStages[2]?.evidence.uat_reconciliation_authority_sha256
        ?? reconciliationAuthority().authority_sha256,
      uat_reconciliation_activation_sha256:
        priorStages[2]?.evidence.uat_reconciliation_activation_sha256
        ?? hash("rollback-reconciliation-activation"),
      sealed_security_projection_sha256:
        priorStages[2]?.evidence.sealed_security_projection_sha256
        ?? hash("rollback-sealed-security-projection"),
      database_unseal_receipt_sha256: hash("rollback-database-unseal-receipt"),
      compose_invocation_receipt_sha256: hash("rollback-compose-invocation-receipt"),
      active_database_allow_connections: true,
      active_database_connection_limit: 64,
      candidate_database_quarantine_allow_connections: false,
      candidate_database_quarantine_connection_limit: 0,
      preactivation_content_proof: preactivationContentProof({
        bindingSha256: hash("rollback-database-unseal-receipt"),
        runtimePlanSha256: packageValue.runtime_plan_sha256,
        reconciliationSha256:
          packageValue.content_reconciliation.source_reconciliation_sha256,
        reportSha256: packageValue.content_reconciliation.database.report_sha256,
        migrationHead: predecessor.migration_head,
        migrationLedgerFileSha256: packageValue.sources.snapshot_migrations.sha256,
        migrationAllowlistSha256: predecessor.migration_manifest_sha256,
        database,
        restoredOid: priorStages[2]?.evidence.restored_database_oid ?? "17384",
        quarantineName: targets.database.candidate_quarantine,
        quarantineMarker:
          `chenyida-erp-uat-rollback/v1:${intent.rollback_operation_id}:CANDIDATE_QUARANTINE`,
      }),
    },
    PROTECTED_RESOURCE_RECHECK: {
      before_sha256: packageValue.protected_resources_sha256,
      after_sha256: packageValue.protected_resources_sha256,
      runtime_plan_sha256: packageValue.runtime_plan_sha256,
      observation_sha256: hash("protected-resource-observation"),
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
    const evidence = stageEvidence(stage, intent, packageValue, stages);
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
      side_effect_receipts_sha256: hash(`stage-side-effect-receipts:${stage}`),
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
    uat_reconciliation_authority_sha256:
      stages[2].evidence.uat_reconciliation_authority_sha256,
    uat_reconciliation_activation_sha256:
      stages[2].evidence.uat_reconciliation_activation_sha256,
    sealed_security_projection_sha256: stages[2].evidence.sealed_security_projection_sha256,
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
    predecessor_runtime_configuration_sha256:
      stages[6].evidence.predecessor_runtime_configuration_sha256,
    rollback_runtime_configuration_sha256:
      stages[6].evidence.rollback_runtime_configuration_sha256,
    rollback_runtime_projection_sha256:
      stages[6].evidence.rollback_runtime_projection_sha256,
    compose_rollback_overlay_sha256: stages[6].evidence.compose_rollback_overlay_sha256,
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
        runtime_plan_sha256: stage.evidence.runtime_plan_sha256,
        restored_database_oid: stage.evidence.restored_database_oid,
        restored_database_marker: stage.evidence.restored_database_marker,
        system_identifier: stage.evidence.system_identifier,
        migration_head: stage.evidence.migration_head,
        migration_ledger_file_sha256: stage.evidence.migration_ledger_file_sha256,
        migration_manifest_sha256: stage.evidence.migration_manifest_sha256,
        restore_receipt_sha256: stage.evidence.restore_receipt_sha256,
        runtime_privilege_access_sha256: stage.evidence.runtime_privilege_access_sha256,
        runtime_privilege_catalog_sha256: stage.evidence.runtime_privilege_catalog_sha256,
        runtime_privilege_catalog_artifact_sha256:
          stage.evidence.runtime_privilege_catalog_artifact_sha256,
        runtime_privilege_policy_sha256: stage.evidence.runtime_privilege_policy_sha256,
        runtime_privilege_operator_policy_sha256:
          stage.evidence.runtime_privilege_operator_policy_sha256,
        uat_reconciliation_authority_sha256:
          stage.evidence.uat_reconciliation_authority_sha256,
        uat_reconciliation_activation_sha256:
          stage.evidence.uat_reconciliation_activation_sha256,
        sealed_security_projection_sha256: stage.evidence.sealed_security_projection_sha256,
        live_security_state_sha256: hash("rollback-live-security-state"),
        active_allow_connections: true,
        active_connection_limit: 64,
        active_default_transaction_read_only: false,
        active_allowed_session_role_set_sha256: hash("rollback-allowed-session-role-set"),
        active_session_observation_sha256: hash("rollback-active-session-observation"),
        active_session_client_policy_sha256: hash("rollback-session-client-policy"),
        active_writer_session_count: 0,
        active_unexpected_session_count: 0,
        active_prepared_xacts: 0,
        candidate_database_quarantine_marker:
          stage.evidence.candidate_database_quarantine_marker,
        candidate_database_quarantine_allow_connections: false,
        candidate_database_quarantine_connection_limit: 0,
        candidate_database_quarantine_sessions: 0,
        candidate_database_quarantine_prepared_xacts: 0,
      } : {
        candidate_volume_name: stage.evidence.retained_candidate_volume,
        candidate_volume_identity_sha256: stage.evidence.retained_candidate_volume_identity_sha256,
        candidate_volume_present: true,
        domain: stage.evidence.domain,
        runtime_plan_sha256: stage.evidence.runtime_plan_sha256,
        target_volume: stage.evidence.target_volume,
        target_volume_marker_sha256: stage.evidence.target_volume_marker_sha256,
        expected_tree_sha256: stage.evidence.expected_tree_sha256,
        target_root_identity_sha256: stage.evidence.target_root_identity_sha256,
        metadata_policy_sha256: stage.evidence.metadata_policy_sha256,
        metadata_state_sha256: stage.evidence.metadata_state_sha256,
        volume_restore_receipt_sha256: stage.evidence.volume_restore_receipt_sha256,
        helper_image_config_digest: stage.evidence.helper_image_config_digest,
        ...(domain === "backup_status" ? {
          backup_status_disposition: UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION,
          current_backup_readiness: false,
          post_rollback_backup_required: true,
        } : {}),
      }),
    };
  }
  const activation = rollback.stages[7].evidence;
  const values = {
    MIGRATION_HEAD: {
      migration_head: rollback.predecessor.migration_head,
      migration_ledger_file_sha256:
        rollback.stages[2].evidence.migration_ledger_file_sha256,
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
      predecessor_runtime_configuration_sha256:
        rollback.predecessor_runtime_configuration_sha256,
      rollback_runtime_configuration_sha256: rollback.rollback_runtime_configuration_sha256,
      rollback_runtime_projection_sha256: rollback.rollback_runtime_projection_sha256,
      compose_rollback_overlay_sha256: rollback.compose_rollback_overlay_sha256,
      deployment_environment_sha256: packageValue.sources.deployment_environment.sha256,
      activation_stage_result_sha256: rollback.stages[7].stage_result_sha256,
      runtime_plan_sha256: rollback.runtime_plan_sha256,
    },
    STRICT_RELEASE_IDENTITY: {
      release_identity_sha256: activation.release_identity_sha256,
      release_manifest_sha256: rollback.predecessor.release_manifest_sha256,
      rollback_postdeploy_receipt_sha256: activation.rollback_postdeploy_receipt_sha256,
      activation_stage_result_sha256: rollback.stages[7].stage_result_sha256,
      predecessor_runtime_configuration_sha256:
        rollback.predecessor_runtime_configuration_sha256,
      rollback_runtime_configuration_sha256: rollback.rollback_runtime_configuration_sha256,
    },
    HEALTH: (() => {
      const readiness = {
        deployment_class: "UAT",
        deployment_id: "chenyida-erp",
        version: rollback.predecessor.application_version,
        revision: rollback.predecessor.git_commit.slice(0, 12),
        migration_head: rollback.predecessor.migration_head,
        migration_manifest_sha256: rollback.predecessor.migration_manifest_sha256,
        database_time: checkedAt,
        components: {
          postgresql: "READY", migration: "READY", worker: "READY",
          uploads: "READY", attachments: "READY", runtime: "READY",
        },
      };
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
        runtime_configuration_sha256: rollback.rollback_runtime_configuration_sha256,
        backup_status_disposition: UAT_PROMOTION_ROLLBACK_BACKUP_STATUS_DISPOSITION,
        current_backup_readiness: false,
        post_rollback_backup_required: true,
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

function postverifyResult(
  rollback,
  intent = postverifyIntent(rollback),
  packageValue = executionPackage(),
  mutateEvidence = null,
) {
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
    const evidence = checkEvidence(
      check, rollback, packageValue, new Date(base + index * 1_000 + 250).toISOString(),
    );
    mutateEvidence?.(check, evidence);
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
      side_effect_receipts_sha256: hash(`check-side-effect-receipts:${check}`),
      evidence,
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
    uat_reconciliation_authority_sha256: rollback.uat_reconciliation_authority_sha256,
    uat_reconciliation_activation_sha256: rollback.uat_reconciliation_activation_sha256,
    sealed_security_projection_sha256: rollback.sealed_security_projection_sha256,
    snapshot_objects: rollback.snapshot_objects,
    predecessor: rollback.predecessor,
    database: rollback.database,
    restored_database: rollback.restored_database,
    candidate_database_quarantine: rollback.candidate_database_quarantine,
    boundary: rollback.boundary,
    predecessor_runtime_configuration_sha256:
      rollback.predecessor_runtime_configuration_sha256,
    rollback_runtime_configuration_sha256: rollback.rollback_runtime_configuration_sha256,
    rollback_runtime_projection_sha256: rollback.rollback_runtime_projection_sha256,
    compose_rollback_overlay_sha256: rollback.compose_rollback_overlay_sha256,
    check_result_sha256_chain: previous,
    checks,
    verified_at: checks.at(-1).completed_at,
  });
}

test("execution package v3 requires every immutable runtime privilege source", () => {
  const packageValue = executionPackage();
  assert.equal(packageValue.schema_version, 3);
  const missingSources = { ...packageValue.sources };
  delete missingSources.snapshot_runtime_privilege_access;
  assert.throws(
    () => validateUatPromotionRollbackExecutionPackage({
      ...packageValue,
      sources: missingSources,
    }),
    /UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_INVALID/,
  );
  assert.throws(
    () => validateUatPromotionRollbackExecutionPackage({
      ...packageValue,
      sources: {
        ...packageValue.sources,
        snapshot_runtime_privilege_policy: {
          ...packageValue.sources.snapshot_runtime_privilege_policy,
          sha256: hash("drifted-runtime-privilege-policy"),
        },
      },
    }),
    /UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_INVALID/,
  );
});

test("stage results reject a zero side-effect receipt aggregate after result rehash", () => {
  const stage = structuredClone(rollbackResult().stages[0]);
  stage.side_effect_receipts_sha256 = "0".repeat(64);
  const { stage_result_sha256: _previousDigest, ...body } = stage;
  stage.stage_result_sha256 = clusterSha256(body);
  assert.throws(
    () => validateUatPromotionRollbackStageResult(stage),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
});

test("PostgreSQL stage rejects rehashed staging identity and guarded-switch binding forgery", () => {
  const packageValue = executionPackage();
  const intent = rollbackIntent(packageValue);
  assert.throws(
    () => rollbackResult(intent, packageValue, (stage, evidence) => {
      if (stage !== "POSTGRESQL_RESTORE") return;
      const proof = evidence.pre_switch_content_proof;
      proof.staging_database_identity_sha256 = hash("forged-staging-identity");
      proof.proof_sha256 = clusterSha256(without(proof, "proof_sha256"));
      evidence.pre_switch_content_proof_sha256 = proof.proof_sha256;
      evidence.switch_receipt.before_identity_sha256 = proof.proof_sha256;
      evidence.switch_receipt.receipt_sha256 = clusterSha256(
        without(evidence.switch_receipt, "receipt_sha256"),
      );
      evidence.switch_receipt_sha256 = evidence.switch_receipt.receipt_sha256;
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
  for (const field of [
    "guarded_switch_state_sha256", "guarded_switch_expected_identity_sha256",
  ]) {
    assert.throws(
      () => rollbackResult(intent, packageValue, (stage, evidence) => {
        if (stage === "POSTGRESQL_RESTORE") evidence[field] = hash(`forged:${field}`);
      }),
      /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
    );
  }
});

test("checkpoint 14 rejects missing privilege evidence and unusable capacity or restore receipts", () => {
  const packageValue = executionPackage();
  const intent = rollbackIntent(packageValue);
  assert.throws(
    () => rollbackResult(intent, packageValue, (stage, evidence) => {
      if (stage === "POSTGRESQL_RESTORE") delete evidence.runtime_privilege_access_sha256;
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
  assert.throws(
    () => rollbackResult(intent, packageValue, (stage, evidence) => {
      if (stage === "POSTGRESQL_RESTORE") evidence.staging_create_receipt_sha256 = "0".repeat(64);
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
  assert.throws(
    () => rollbackResult(intent, packageValue, (stage, evidence) => {
      if (stage === "UPLOADS_RESTORE") evidence.volume_restore_receipt_sha256 = "0".repeat(64);
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
  assert.throws(
    () => rollbackResult(intent, packageValue, (stage, evidence) => {
      if (stage === "ATTACHMENTS_RESTORE") delete evidence.metadata_state_sha256;
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
});

test("checkpoint 15 rejects privilege, metadata, and restore-receipt drift from checkpoint 14", () => {
  const packageValue = executionPackage();
  const rollback = rollbackResult(rollbackIntent(packageValue), packageValue);
  const intent = postverifyIntent(rollback);
  for (const [check, field, drift] of [
    ["POSTGRESQL_CONTENT", "runtime_privilege_policy_sha256", hash("privilege-policy-drift")],
    ["UPLOADS_CONTENT", "metadata_state_sha256", hash("uploads-metadata-drift")],
    ["ATTACHMENTS_CONTENT", "volume_restore_receipt_sha256", hash("attachments-receipt-drift")],
  ]) {
    const result = postverifyResult(rollback, intent, packageValue, (label, evidence) => {
      if (label === check) evidence[field] = drift;
    });
    assert.throws(
      () => assertUatPromotionRollbackPostverifyResultMatchesIntent(result, intent, rollback),
      /UAT_PROMOTION_ROLLBACK_POSTVERIFY_RESULT_BINDING_INVALID/,
    );
  }
});

test("restored historical backup status cannot masquerade as current backup readiness", () => {
  const packageValue = executionPackage();
  const rollbackIntentValue = rollbackIntent(packageValue);
  assert.throws(
    () => rollbackResult(rollbackIntentValue, packageValue, (stage, evidence) => {
      if (stage === "BACKUP_STATUS_RESTORE") evidence.current_backup_readiness = true;
    }),
    /UAT_PROMOTION_ROLLBACK_STAGE_RESULT_INVALID/,
  );
  const rollback = rollbackResult(rollbackIntentValue, packageValue);
  const intent = postverifyIntent(rollback);
  assert.throws(
    () => postverifyResult(rollback, intent, packageValue, (check, evidence) => {
      if (check === "BACKUP_STATUS_CONTENT") evidence.current_backup_readiness = true;
    }),
    /UAT_PROMOTION_ROLLBACK_CHECK_RESULT_INVALID/,
  );
});

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

test("health completion time is independent from fresh database time but bounded to five seconds", () => {
  const rollback = rollbackResult();
  const intent = postverifyIntent(rollback);
  const fresh = postverifyResult(rollback, intent, executionPackage(), (check, evidence) => {
    if (check !== "HEALTH") return;
    evidence.readiness.database_time = new Date(
      Date.parse(evidence.checked_at) - 1_000,
    ).toISOString();
    evidence.readiness_sha256 = clusterSha256(evidence.readiness);
    evidence.health_sha256 = clusterSha256(
      Object.fromEntries(Object.entries(evidence).filter(([field]) => field !== "health_sha256")),
    );
  });
  assert.equal(validateUatPromotionRollbackPostverifyResult(fresh), fresh);
  assert.throws(
    () => postverifyResult(rollback, intent, executionPackage(), (check, evidence) => {
      if (check !== "HEALTH") return;
      evidence.readiness.database_time = new Date(
        Date.parse(evidence.checked_at) - 6_000,
      ).toISOString();
      evidence.readiness_sha256 = clusterSha256(evidence.readiness);
      evidence.health_sha256 = clusterSha256(
        Object.fromEntries(Object.entries(evidence).filter(([field]) => field !== "health_sha256")),
      );
    }),
    /UAT_PROMOTION_ROLLBACK_CHECK_RESULT_INVALID/,
  );
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
