import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const UAT_PROMOTION_AUDIT_POLICY_CONTRACT = "chenyida-erp-uat-promotion-rollback-audit-policy/v1";
export const UAT_PROMOTION_AUDIT_ARTIFACT_CONTRACT = "chenyida-erp-uat-promotion-rollback-audit/v1";
export const UAT_PROMOTION_AUDIT_POLICY_PATH = "chenyida_erp_site/operations/uat-promotion-rollback-audit-policy-v1.json";
export const UAT_PROMOTION_AUDIT_ARTIFACT_PATH = "chenyida_erp_site/operations/uat-promotion-rollback-audit-v1.json";
export const UAT_PROMOTION_AUDIT_MARKDOWN_PATH = "docs/testing/selfhost-uat-promotion-rollback-audit-v1.md";
export const UAT_PROMOTION_AUDIT_GENERATOR_PATH = "chenyida_erp_site/scripts/uat-promotion-rollback-audit.mjs";
export const UAT_PROMOTION_AUDIT_INVENTORY_PATH = "chenyida_erp_site/release/release-test-inventory-v1.json";
export const UAT_PROMOTION_AUDIT_FIXED_EXECUTOR_TEST_PATH =
  "chenyida_erp_site/tests/selfhost-uat-promotion-rollback-fixed-executor.test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAFE_PATH = /^(?:chenyida_erp_site|docs)\/[A-Za-z0-9._/-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Z][A-Z0-9_]{2,100}$/;
const ALLOWED_STATUS = new Set(["SUPPORTED", "PARTIAL", "MISSING", "CONTRACT_ONLY"]);
const REQUIRED_STATUS = Object.freeze({
  CANDIDATE_SOURCE_SNAPSHOT: "SUPPORTED",
  ELIGIBLE_RELEASE_MANIFEST: "SUPPORTED",
  PRE_DEPLOY_RUNTIME_STABILITY: "SUPPORTED",
  PROMOTION_INTENT_AND_DURABLE_JOURNAL: "SUPPORTED",
  PROMOTION_BOUND_RECOVERABLE_SNAPSHOT: "SUPPORTED",
  WRITER_QUIESCE_RECEIPT: "SUPPORTED",
  ONE_TIME_MIGRATION_AUTHORIZATION: "SUPPORTED",
  MIGRATION_COMMIT_RECEIPT: "SUPPORTED",
  COMPOSE_DEPLOYMENT_RECEIPT: "SUPPORTED",
  POST_DEPLOY_RUNTIME_CONFIGURATION: "SUPPORTED",
  POST_DEPLOY_IDENTITY: "SUPPORTED",
  CROSS_ROLE_UAT_EXECUTION: "SUPPORTED",
  PROMOTION_FINAL_RECEIPT: "SUPPORTED",
  ROLLBACK_TO_UAT_EXECUTOR: "SUPPORTED",
  ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT: "SUPPORTED",
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function prettyJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readRepositoryFile(repositoryPath) {
  if (!SAFE_PATH.test(repositoryPath) || repositoryPath.includes("..")) throw new Error(`UAT_PROMOTION_AUDIT_PATH_INVALID:${repositoryPath}`);
  const absolute = resolve(ROOT, repositoryPath);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`UAT_PROMOTION_AUDIT_PATH_INVALID:${repositoryPath}`);
  return readFileSync(absolute, "utf8");
}

function error(errors, code, detail = "") {
  errors.push(detail ? `${code}:${detail}` : code);
}

function exactSet(actual, expected) {
  return canonicalJson([...actual].sort()) === canonicalJson([...expected].sort());
}

function extractPythonMappingKeys(source, mappingName, errors) {
  const match = source.match(new RegExp(`(?:^|\\n)${mappingName} = \\{\\n([\\s\\S]*?)\\n\\}`, "u"));
  if (!match) {
    error(errors, "SUPERVISOR_OPERATION_MAPPING_MISSING", mappingName);
    return [];
  }
  return [...match[1].matchAll(/^\s{4}"([A-Z][A-Z0-9_]+)"\s*:/gmu)].map((item) => item[1]);
}

function validateSourceFiles(policy, sourceBodies, errors) {
  const files = [];
  const seen = new Set();
  for (const entry of policy.source_files ?? []) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || !SAFE_PATH.test(entry.path) || entry.path.includes("..")) {
      error(errors, "AUDIT_SOURCE_PATH_INVALID", String(entry?.path));
      continue;
    }
    if (seen.has(entry.path)) error(errors, "AUDIT_SOURCE_DUPLICATE", entry.path);
    seen.add(entry.path);
    const body = sourceBodies.get(entry.path);
    if (typeof body !== "string") {
      error(errors, "AUDIT_SOURCE_MISSING", entry.path);
      continue;
    }
    if (!Array.isArray(entry.markers) || entry.markers.length < 1) error(errors, "AUDIT_SOURCE_MARKERS_INVALID", entry.path);
    for (const marker of entry.markers ?? []) {
      if (typeof marker !== "string" || marker.length < 4 || !body.includes(marker)) error(errors, "AUDIT_SOURCE_MARKER_DRIFT", `${entry.path}:${marker}`);
    }
    files.push({ path: entry.path, sha256: sha256(body), markers: [...(entry.markers ?? [])] });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, sha256: sha256(canonicalJson(files)) };
}

function evidenceMarkerPresent(evidence, sourceBodies) {
  if (typeof evidence !== "string" || !evidence.includes(":")) return false;
  const split = evidence.indexOf(":");
  const suffix = evidence.slice(0, split);
  const marker = evidence.slice(split + 1);
  const matches = [...sourceBodies.entries()].filter(([repositoryPath]) => repositoryPath.endsWith(`/${suffix}`) || repositoryPath.endsWith(suffix));
  return matches.length === 1 && marker.length >= 3 && matches[0][1].includes(marker);
}

function validateCapabilities(policy, sourceBodies, errors) {
  if (!Array.isArray(policy.capabilities)) {
    error(errors, "AUDIT_CAPABILITY_SET_INVALID");
    return [];
  }
  const ids = policy.capabilities.map((entry) => entry?.id);
  if (!exactSet(ids, Object.keys(REQUIRED_STATUS)) || !exactSet(policy.required_checkpoint_order ?? [], Object.keys(REQUIRED_STATUS))) error(errors, "AUDIT_CHECKPOINT_SET_DRIFT");
  if (canonicalJson(ids) !== canonicalJson(policy.required_checkpoint_order)) error(errors, "AUDIT_CHECKPOINT_ORDER_DRIFT");
  const seen = new Set();
  for (const capability of policy.capabilities) {
    if (!capability || typeof capability !== "object" || !IDENTIFIER.test(capability.id ?? "") || seen.has(capability.id)) {
      error(errors, "AUDIT_CAPABILITY_ID_INVALID", String(capability?.id));
      continue;
    }
    seen.add(capability.id);
    if (!ALLOWED_STATUS.has(capability.status) || capability.status !== REQUIRED_STATUS[capability.id]) error(errors, "AUDIT_CAPABILITY_STATUS_DRIFT", capability.id);
    if (!['P0', 'P1'].includes(capability.severity_if_incomplete)) error(errors, "AUDIT_CAPABILITY_SEVERITY_INVALID", capability.id);
    if (!Array.isArray(capability.evidence)) error(errors, "AUDIT_CAPABILITY_EVIDENCE_INVALID", capability.id);
    for (const evidence of capability.evidence ?? []) if (!evidenceMarkerPresent(evidence, sourceBodies)) error(errors, "AUDIT_CAPABILITY_EVIDENCE_DRIFT", `${capability.id}:${evidence}`);
    if (capability.status === "SUPPORTED" && capability.evidence.length < 2) error(errors, "AUDIT_SUPPORTED_EVIDENCE_INCOMPLETE", capability.id);
    if (capability.status === "SUPPORTED" && capability.finding !== null) error(errors, "AUDIT_SUPPORTED_FINDING_INVALID", capability.id);
    if (capability.status !== "SUPPORTED" && (typeof capability.finding !== "string" || capability.finding.length < 16)) error(errors, "AUDIT_BLOCKER_FINDING_MISSING", capability.id);
  }
  return policy.capabilities.map((entry, index) => ({ ...structuredClone(entry), ordinal: index + 1 }));
}

function inspectRepository(policy, sourceBodies, errors) {
  const launcher = sourceBodies.get("chenyida_erp_site/scripts/release-supervisor-launcher.py") ?? "";
  const mappings = [
    "ENTRYPOINTS", "RUNTIME_PRIVILEGE_OPERATIONS", "CLUSTER_POLICY_OPERATIONS",
    "NOTIFIER_EGRESS_OPERATIONS", "UAT_PROMOTION_OPERATIONS",
    "UAT_ROLLBACK_RUNTIME_ACTIVATION_OPERATIONS",
  ];
  const supervisorOperations = [...new Set(mappings.flatMap((name) => extractPythonMappingKeys(launcher, name, errors)))].sort();
  const required = policy.required_supervisor_operations ?? [];
  if (!Array.isArray(required) || required.length < 7 || required.some((item) => !IDENTIFIER.test(item))) error(errors, "AUDIT_REQUIRED_SUPERVISOR_OPERATIONS_INVALID");
  const implementedRequired = required.filter((item) => supervisorOperations.includes(item));
  const missingRequired = required.filter((item) => !supervisorOperations.includes(item));
  const expectedImplemented = policy.expected_implemented_supervisor_operations ?? [];

  const restore = sourceBodies.get("chenyida_erp_site/scripts/restore-selfhost.sh") ?? "";
  const migration = sourceBodies.get("chenyida_erp_site/scripts/release-migration-authorization.ts") ?? "";
  const migrationRunner = sourceBodies.get("chenyida_erp_site/scripts/migrate-postgres.ts") ?? "";
  const migrationControl = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-migration-control.py") ?? "";
  const migrationExecutionContract = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-migration-execution-contract.mjs") ?? "";
  const deploymentContract = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-compose-deployment-contract.mjs") ?? "";
  const deploymentControl = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs") ?? "";
  const rollbackContract = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-contract.mjs") ?? "";
  const rollbackControl = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-control.mjs") ?? "";
  const rollbackRuntimeContract = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-runtime-contract.mjs") ?? "";
  const rollbackRuntimeAdapter = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-runtime-adapter.py") ?? "";
  const rollbackFixedExecutorContract = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor-contract.mjs") ?? "";
  const rollbackFixedExecutor = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py") ?? "";
  const rollbackActivationPublisher = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-rollback-runtime-activation-publisher.mjs") ?? "";
  const promotionJournal = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs") ?? "";
  const promotionPolicy = sourceBodies.get("chenyida_erp_site/operations/uat-promotion-transaction-policy-v1.json") ?? "";
  const crossRoleResultContract = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-cross-role-evidence-contract.mjs") ?? "";
  const installer = sourceBodies.get("chenyida_erp_site/scripts/install-release-supervisor.py") ?? "";
  const compose = sourceBodies.get("chenyida_erp_site/compose.release.yml") ?? "";
  const crossRole = JSON.parse(sourceBodies.get("chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json") ?? "null");
  const observations = {
    supervisor_operation_count: supervisorOperations.length,
    supervisor_operations: supervisorOperations,
    required_promotion_operation_count: required.length,
    implemented_required_promotion_operations: implementedRequired,
    missing_required_promotion_operations: missingRequired,
    restore_target_policy: restore.includes('[ "$TARGET_CLASS" = TEST ]') && !restore.includes('[ "$TARGET_CLASS" = UAT ]') ? "TEST_ONLY" : "AMBIGUOUS",
    migration_authorization: launcher.includes("AUTHORIZE_UAT_PROMOTION_MIGRATION")
      && launcher.includes("RUN_UAT_PROMOTION_MIGRATION")
      && promotionJournal.includes("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_MIGRATION_EXECUTION_INTENT_CONTRACT")
      && promotionJournal.includes("MIGRATION_COMMIT_RECEIPT")
      && migration.includes("Legacy variables may select and validate evidence, but never authorize SQL")
      && migrationRunner.includes("MIGRATION_SUPERVISOR_EXECUTION_GRANT_REQUIRED")
      && migrationRunner.includes("MIGRATION_FENCED")
      && migrationControl.includes("DATABASE_FENCE_AND_EXACT_ALLOWLIST_MIGRATION")
      && migrationControl.includes("CONTAIN_EXACT_UAT_PROMOTION_MIGRATION_BEFORE_RECOVERY")
      && migrationExecutionContract.includes("UAT_PROMOTION_MIGRATION_RESULT_CONTRACT")
      ? "SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED" : "UNKNOWN",
    compose_release_image_binding: launcher.includes('"DEPLOY_UAT_RELEASE": "COMPOSE_DEPLOYMENT"')
      && deploymentContract.includes("UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_CONTRACT")
      && deploymentContract.includes("UAT_PROMOTION_ACTIVE_FENCE_TRANSFER_CONTRACT")
      && deploymentControl.includes("runUatPromotionComposeDeploymentControl")
      && deploymentControl.includes("CONTAINED_FOR_JOURNAL_QUARANTINE")
      && promotionJournal.includes("COMPOSE_DEPLOYMENT_RECEIPT")
      && promotionJournal.includes("AFTER_COMPOSE_DEPLOYMENT_CURRENT")
      && compose.includes("ERP_WEB_IMAGE") && compose.includes("ERP_WORKER_IMAGE")
      && compose.includes("chenyida.erp.uat-deployment-operation")
      && compose.includes("chenyida.erp.uat-deployment-authorization")
      ? "SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT" : "UNKNOWN",
    postdeploy_transaction_binding: launcher.includes('"VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION": "POSTDEPLOY_RUNTIME_CONFIGURATION"')
      && launcher.includes('"VERIFY_UAT_POSTDEPLOY_IDENTITY": "POSTDEPLOY_IDENTITY"')
      && launcher.includes("ERP_UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_SHA256")
      && promotionJournal.includes("UAT_PROMOTION_POSTDEPLOY_RUNTIME_INTENT_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_POSTDEPLOY_IDENTITY_INTENT_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_POSTDEPLOY_CONTROL_BINDING_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_MISMATCH")
      && promotionJournal.includes("UAT_PROMOTION_POSTDEPLOY_IDENTITY_EVIDENCE_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_POSTDEPLOY_CONTAINMENT_CONTRACT")
      && promotionJournal.includes("AFTER_POSTDEPLOY_RUNTIME_CURRENT")
      && promotionJournal.includes("AFTER_POSTDEPLOY_IDENTITY_CURRENT")
      ? "SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE" : "UNKNOWN",
    cross_role_uat_transaction_binding: launcher.includes('"VERIFY_UAT_CROSS_ROLE_EXECUTION": "CROSS_ROLE_UAT"')
      && launcher.includes("SUPERVISOR_UAT_PROMOTION_CROSS_ROLE_RECOVERY_REQUIRED")
      && promotionPolicy.includes('"operation": "VERIFY_UAT_CROSS_ROLE_EXECUTION", "status": "IMPLEMENTED"')
      && promotionJournal.includes("UAT_PROMOTION_CROSS_ROLE_INTENT_CONTRACT")
      && promotionJournal.includes("loadDurableCrossRoleResult")
      && promotionJournal.includes("AFTER_CROSS_ROLE_CURRENT")
      && promotionJournal.includes('checkpoint_id: "CROSS_ROLE_UAT_EXECUTION"')
      && crossRoleResultContract.includes("UAT_PROMOTION_CROSS_ROLE_RESULT_CONTRACT")
      && crossRoleResultContract.includes("human_execution_authorization_sha256")
      && crossRoleResultContract.includes("evidence_subject_sha256")
      && crossRoleResultContract.includes("approval_subject_sha256")
      ? "SUPERVISOR_CHECKPOINT_12_CONTENT_ADDRESSED_AND_RECOVERABLE" : "UNKNOWN",
    finalization_transaction_binding: launcher.includes('"FINALIZE_UAT_PROMOTION": "FINALIZATION"')
      && launcher.includes("SUPERVISOR_UAT_PROMOTION_FINALIZATION_RECOVERY_REQUIRED")
      && promotionPolicy.includes('"operation": "FINALIZE_UAT_PROMOTION", "status": "IMPLEMENTED"')
      && promotionJournal.includes("UAT_PROMOTION_FINALIZATION_INTENT_CONTRACT")
      && promotionJournal.includes("finalizationCheckpointAggregate")
      && promotionJournal.includes("AFTER_FINALIZATION_CURRENT")
      && promotionJournal.includes('checkpoint_id: "PROMOTION_FINAL_RECEIPT"')
      && installer.includes("assert_no_uat_promotion_finalization_interlock")
      && installer.includes("SUPERVISOR_INSTALL_UAT_PROMOTION_FINALIZATION_RECOVERY_REQUIRED")
      ? "SUPERVISOR_CHECKPOINT_13_AGGREGATED_AND_RECOVERABLE" : "UNKNOWN",
    rollback_transaction_binding: launcher.includes('"ROLLBACK_UAT_RELEASE": "ROLLBACK_EXECUTION"')
      && launcher.includes('"VERIFY_AND_FINALIZE_UAT_ROLLBACK": "ROLLBACK_POSTVERIFY"')
      && launcher.includes("ERP_UAT_PROMOTION_ROLLBACK_EXPECTED_RESULT_SHA256")
      && launcher.includes("SUPERVISOR_UAT_PROMOTION_ROLLBACK_RECOVERY_REQUIRED")
      && promotionPolicy.includes('"operation": "ROLLBACK_UAT_RELEASE", "status": "IMPLEMENTED"')
      && promotionPolicy.includes('"operation": "VERIFY_AND_FINALIZE_UAT_ROLLBACK", "status": "IMPLEMENTED"')
      && promotionJournal.includes("UAT_PROMOTION_ROLLBACK_INTENT_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_ROLLBACK_POSTVERIFY_INTENT_CONTRACT")
      && promotionJournal.includes("UAT_PROMOTION_ROLLBACK_EXPECTED_RESULT_MISMATCH")
      && promotionJournal.includes('"ROLLBACK_TO_UAT_EXECUTOR"')
      && promotionJournal.includes('"ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT"')
      && rollbackContract.includes("UAT_PROMOTION_ROLLBACK_EXECUTION_PACKAGE_CONTRACT")
      && rollbackContract.includes("UAT_PROMOTION_ROLLBACK_STAGE_INTENT_CONTRACT")
      && rollbackContract.includes("UAT_PROMOTION_ROLLBACK_CHECK_INTENT_CONTRACT")
      && rollbackControl.includes("preflightUatPromotionRollbackControl")
      && rollbackControl.includes("runUatPromotionRollbackControl")
      && rollbackControl.includes("CONTAINED_FOR_JOURNAL_QUARANTINE")
      && installer.includes("SUPERVISOR_INSTALL_UAT_PROMOTION_ROLLBACK_RECOVERY_REQUIRED")
      && installer.includes("SUPERVISOR_INSTALL_UAT_PROMOTION_ROLLBACK_POSTVERIFY_REQUIRED")
      ? "SUPERVISOR_CHECKPOINT_14_15_CONTENT_ADDRESSED_AND_RECOVERABLE" : "UNKNOWN",
    rollback_runtime_adapter: rollbackControl.includes('path.join(SITE_ROOT, "scripts/uat-promotion-rollback-runtime-adapter.py")')
      && launcher.includes('"chenyida_erp_site/scripts/uat-promotion-rollback-runtime-adapter.py"')
      && launcher.includes('"chenyida_erp_site/scripts/uat-promotion-rollback-runtime-contract.mjs"')
      && launcher.includes('"chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor-contract.mjs"')
      && launcher.includes('"chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py": "0555"')
      && launcher.includes('"chenyida_erp_site/scripts/uat-promotion-rollback-runtime-activation-publisher.mjs"')
      && launcher.includes("chenyida-erp-release-supervisor-authorization/v7")
      && launcher.includes('"ACTIVATE_UAT_ROLLBACK_RUNTIME_V2"')
      && launcher.includes('"ROLLBACK_UAT_ROLLBACK_RUNTIME_V2"')
      && launcher.includes('"RECOVER_UAT_ROLLBACK_RUNTIME_V2_ACTIVATION"')
      && rollbackRuntimeContract.includes("UAT_PROMOTION_ROLLBACK_RUNTIME_ACTION_MATRIX")
      && rollbackRuntimeContract.includes('RECOVERY: Object.freeze(["PREFLIGHT", "RECHECK", "PROBE", "CONTAIN"])')
      && rollbackRuntimeAdapter.includes("EXECUTOR_FILE = Path(\"/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1\")")
      && rollbackRuntimeAdapter.includes("/activation-v2.json")
      && rollbackRuntimeContract.includes("COMPOSE_PROJECT_COMPLETE_WRITER_SET")
      && rollbackRuntimeContract.includes("retained_candidate_volumes")
      && rollbackRuntimeContract.includes("STALE_INTENT")
      && rollbackRuntimeContract.includes("knownServiceContainerIds")
      && rollbackControl.includes("stopped_writers")
      && rollbackControl.includes("candidate_volume_present")
      && rollbackControl.includes("containment_attempt_receipt_sha256")
      && rollbackControl.includes("REFRESH_REJECTED")
      && rollbackControl.includes("retained_candidate_volumes_sha256")
      && rollbackRuntimeAdapter.includes("CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST")
      && rollbackRuntimeAdapter.includes("trusted_parent_chain")
      && rollbackRuntimeAdapter.includes("/proc/self/fd/")
      && rollbackRuntimeAdapter.includes("start_new_session=True")
      && rollbackRuntimeAdapter.includes("os.killpg")
      && rollbackRuntimeAdapter.includes("STALE_INTENT")
      && rollbackRuntimeAdapter.includes("known_service_container_ids")
      && rollbackRuntimeAdapter.includes("contain database, volume, or Compose mutation logic itself")
      && rollbackFixedExecutorContract.includes("UAT_ROLLBACK_FIXED_EXECUTOR_CATALOG_CONTRACT")
      && rollbackFixedExecutorContract.includes("UAT_ROLLBACK_EXECUTION_STAGES")
      && rollbackFixedExecutorContract.includes("UAT_ROLLBACK_POSTVERIFY_CHECKS")
      && rollbackFixedExecutorContract.includes("BLOCKED_MISSING_UAT_CAPABLE_HANDLERS")
      && rollbackFixedExecutorContract.includes("PROBE_THEN_CONTAIN_NEVER_BLINDLY_REEXECUTE")
      && rollbackFixedExecutor.includes('CAPABILITY_STATUS = "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS"')
      && rollbackFixedExecutor.includes("ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE")
      && rollbackFixedExecutor.includes("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
      && rollbackActivationPublisher.includes("chenyida-erp-uat-promotion-rollback-runtime-activation-context/v2")
      && rollbackActivationPublisher.includes("chenyida-erp-uat-promotion-rollback-runtime-activation-recovery/v2")
      && rollbackActivationPublisher.includes("prepareUatRollbackRuntimeActivation")
      && rollbackActivationPublisher.includes("executeUatRollbackRuntimeActivation")
      && rollbackActivationPublisher.includes("UAT_ROLLBACK_RUNTIME_ACTIVATION_PARTIAL_UNKNOWN")
      && installer.includes("assert_no_uat_rollback_runtime_activation_interlock")
      && installer.includes("SUPERVISOR_INSTALL_UAT_ROLLBACK_RUNTIME_RECOVERY_REQUIRED")
      ? "BUNDLED_FIXED_EXECUTOR_AND_RECOVERABLE_ACTIVATION_PROTOCOL_CAPABILITIES_BLOCKED_HOST_NOT_ACTIVATED" : "UNKNOWN",
    rollback_rehearsal_evidence: "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT",
    cross_role_uat_readiness: crossRole?.readiness?.status ?? "UNKNOWN",
  };
  if (!Array.isArray(expectedImplemented) || expectedImplemented.some((item) => !IDENTIFIER.test(item))
    || !exactSet(implementedRequired, expectedImplemented)) error(errors, "AUDIT_IMPLEMENTED_OPERATION_DRIFT", implementedRequired.join(","));
  if (observations.restore_target_policy !== "TEST_ONLY") error(errors, "AUDIT_RESTORE_BOUNDARY_DRIFT");
  if (observations.migration_authorization !== "SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED") error(errors, "AUDIT_MIGRATION_AUTHORIZATION_DRIFT");
  if (observations.compose_release_image_binding !== "SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT") error(errors, "AUDIT_COMPOSE_BINDING_DRIFT");
  if (observations.postdeploy_transaction_binding !== "SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE") error(errors, "AUDIT_POSTDEPLOY_TRANSACTION_BINDING_DRIFT");
  if (observations.cross_role_uat_transaction_binding !== "SUPERVISOR_CHECKPOINT_12_CONTENT_ADDRESSED_AND_RECOVERABLE") error(errors, "AUDIT_CROSS_ROLE_UAT_TRANSACTION_BINDING_DRIFT");
  if (observations.finalization_transaction_binding !== "SUPERVISOR_CHECKPOINT_13_AGGREGATED_AND_RECOVERABLE") error(errors, "AUDIT_FINALIZATION_TRANSACTION_BINDING_DRIFT");
  if (observations.rollback_transaction_binding !== "SUPERVISOR_CHECKPOINT_14_15_CONTENT_ADDRESSED_AND_RECOVERABLE") error(errors, "AUDIT_ROLLBACK_TRANSACTION_BINDING_DRIFT");
  if (observations.rollback_runtime_adapter !== "BUNDLED_FIXED_EXECUTOR_AND_RECOVERABLE_ACTIVATION_PROTOCOL_CAPABILITIES_BLOCKED_HOST_NOT_ACTIVATED") error(errors, "AUDIT_ROLLBACK_RUNTIME_BOUNDARY_DRIFT");
  if (observations.rollback_rehearsal_evidence !== "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT") error(errors, "AUDIT_ROLLBACK_REHEARSAL_BOUNDARY_DRIFT");
  if (observations.cross_role_uat_readiness !== "BLOCKED") error(errors, "AUDIT_CROSS_ROLE_UAT_BOUNDARY_DRIFT");
  return observations;
}

export function assertUatPromotionMayStart(artifact) {
  if (!artifact || artifact.contract !== UAT_PROMOTION_AUDIT_ARTIFACT_CONTRACT || artifact.audit_validation?.result !== "PASS") throw new Error("UAT_PROMOTION_AUDIT_INVALID");
  if (artifact.execution_readiness?.status !== "READY" || artifact.execution_readiness?.may_start !== true || artifact.capabilities.some((entry) => entry.status !== "SUPPORTED")) {
    const failure = new Error("UAT_PROMOTION_EXECUTOR_NOT_READY");
    failure.code = "UAT_PROMOTION_EXECUTOR_NOT_READY";
    throw failure;
  }
  return artifact;
}

export function buildUatPromotionRollbackAudit(inputs) {
  const { policy, sourceBodies, rawDigests, inventory } = inputs;
  const errors = [];
  if (policy.schema_version !== 1 || policy.contract !== UAT_PROMOTION_AUDIT_POLICY_CONTRACT || policy.authority !== "SELFHOSTED_NODE_POSTGRESQL_REPOSITORY_SOURCE" || policy.execution_class !== "AUDIT_ONLY_NOT_AUTHORIZED" || policy.deployment_class !== "UAT") error(errors, "AUDIT_POLICY_CONTRACT_INVALID");
  for (const [name, digest] of Object.entries(rawDigests ?? {})) if (!SHA256.test(digest ?? "")) error(errors, "AUDIT_INPUT_DIGEST_INVALID", name);
  if (inventory?.contract !== "chenyida-erp-release-test-inventory/v1" || inventory?.schema_version !== 1 || inventory?.total_tests !== inventory?.tests?.length) error(errors, "AUDIT_RELEASE_INVENTORY_INVALID");
  const fixedExecutorTest = inventory?.tests?.find((entry) =>
    entry.path === UAT_PROMOTION_AUDIT_FIXED_EXECUTOR_TEST_PATH.replace("chenyida_erp_site/", ""));
  const fixedExecutorTestBody = sourceBodies.get(UAT_PROMOTION_AUDIT_FIXED_EXECUTOR_TEST_PATH);
  if (!fixedExecutorTest || fixedExecutorTest.category !== "RELEASE_CONTRACT"
    || fixedExecutorTest.applicability !== "REQUIRED"
    || fixedExecutorTest.harness !== "NODE_RELEASE_CONTRACT"
    || fixedExecutorTest.sha256 !== sha256(fixedExecutorTestBody ?? "")) {
    error(errors, "AUDIT_FIXED_EXECUTOR_RELEASE_TEST_INVALID");
  }
  const manifest = validateSourceFiles(policy, sourceBodies, errors);
  const capabilities = validateCapabilities(policy, sourceBodies, errors);
  const observations = inspectRepository(policy, sourceBodies, errors);
  const incomplete = capabilities.filter((entry) => entry.status !== "SUPPORTED");
  const executionBlockers = [
    ...(observations.rollback_runtime_adapter === "BUNDLED_FIXED_EXECUTOR_AND_RECOVERABLE_ACTIVATION_PROTOCOL_CAPABILITIES_BLOCKED_HOST_NOT_ACTIVATED" ? [{
      id: "ROLLBACK_RUNTIME_CAPABILITIES_NOT_IMPLEMENTED_OR_HOST_NOT_ACTIVATED", severity: "P0",
      finding: "固定执行器、v2内容寻址激活协议、Supervisor v7一次性授权和安装互锁已进入bundle；但UAT数据库、四数据域及Web/Worker回退处理器仍显式不可用，且没有受信主机激活证据，预检会在授权消耗前失败。",
    }] : []),
    ...(observations.rollback_rehearsal_evidence === "NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT" ? [{
      id: "UAT_ROLLBACK_REHEARSAL_NOT_EXECUTED", severity: "P0",
      finding: "尚无受信UAT隔离回退演练回执，不能把仓库fake-root测试解释为真实恢复或回滚。",
    }] : []),
    ...(observations.cross_role_uat_readiness !== "READY" ? [{
      id: "HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED", severity: "P1",
      finding: "真实岗位人员、账号映射、事前授权、步骤证据与签字尚未闭合。",
    }] : []),
  ];
  const blocked = incomplete.length > 0 || executionBlockers.length > 0;
  const body = {
    schema_version: 1,
    contract: UAT_PROMOTION_AUDIT_ARTIFACT_CONTRACT,
    authority: policy.authority,
    execution_class: policy.execution_class,
    deployment_class: policy.deployment_class,
    generated_from: {
      policy: { path: UAT_PROMOTION_AUDIT_POLICY_PATH, sha256: rawDigests.policy },
      generator: { path: UAT_PROMOTION_AUDIT_GENERATOR_PATH, sha256: rawDigests.generator },
      release_test_inventory: { path: UAT_PROMOTION_AUDIT_INVENTORY_PATH, sha256: rawDigests.inventory, total_tests: inventory.total_tests, required_tests: inventory.required_tests, not_applicable_tests: inventory.not_applicable_tests },
      source_manifest: manifest,
    },
    observations,
    required_checkpoint_order: [...policy.required_checkpoint_order],
    capabilities,
    findings: incomplete.map((entry) => ({ id: entry.id, severity: entry.severity_if_incomplete, status: entry.status, finding: entry.finding })),
    execution_blockers: executionBlockers,
    execution_readiness: {
      status: blocked ? "BLOCKED" : "READY",
      may_start: !blocked,
      blocking_checkpoint_count: incomplete.length,
      blocking_condition_count: incomplete.length + executionBlockers.length,
      p0_blocker_count: incomplete.filter((entry) => entry.severity_if_incomplete === "P0").length
        + executionBlockers.filter((entry) => entry.severity === "P0").length,
      p1_blocker_count: incomplete.filter((entry) => entry.severity_if_incomplete === "P1").length
        + executionBlockers.filter((entry) => entry.severity === "P1").length,
      code: blocked ? "UAT_PROMOTION_EXECUTOR_NOT_READY" : "UAT_PROMOTION_EXECUTOR_READY",
      statement: !blocked
        ? "全部逐检查点执行、恢复与回退能力已由同一内容寻址控制链证明。"
        : "仓库检查点控制链与受信回退网关已闭合，但真实运行时执行器/激活、隔离回退演练和人工UAT证据尚未闭合；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。",
    },
    audit_validation: { result: errors.length ? "FAIL" : "PASS", errors: [...errors] },
  };
  const artifact = { ...body, artifact_sha256: sha256(canonicalJson(body)) };
  return { artifact, manifest, errors, markdown: renderMarkdown(artifact) };
}

export function loadUatPromotionRollbackAuditInputs() {
  const policyRaw = readRepositoryFile(UAT_PROMOTION_AUDIT_POLICY_PATH);
  const inventoryRaw = readRepositoryFile(UAT_PROMOTION_AUDIT_INVENTORY_PATH);
  const generatorRaw = readRepositoryFile(UAT_PROMOTION_AUDIT_GENERATOR_PATH);
  const policy = JSON.parse(policyRaw);
  const sourceBodies = new Map((policy.source_files ?? []).map((entry) => [entry.path, readRepositoryFile(entry.path)]));
  return {
    policy,
    inventory: JSON.parse(inventoryRaw),
    sourceBodies,
    rawDigests: { policy: sha256(policyRaw), inventory: sha256(inventoryRaw), generator: sha256(generatorRaw) },
  };
}

function inline(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMarkdown(artifact) {
  const lines = [
    "# 晨亿达 ERP UAT 晋升与快照回滚执行器审计 v1",
    "",
    "> 当前结论：`BLOCKED / CONTROL PLANE AND TRUSTED GATEWAY COMPLETE / EXECUTOR ACTIVATION AND REAL EVIDENCE MISSING`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。",
    "",
    "## 1. 审计结论",
    "",
    `- artifact SHA-256：\`${artifact.artifact_sha256}\``,
    `- source manifest SHA-256：\`${artifact.generated_from.source_manifest.sha256}\`（${artifact.generated_from.source_manifest.files.length}文件）`,
    `- release inventory SHA-256：\`${artifact.generated_from.release_test_inventory.sha256}\`（${artifact.generated_from.release_test_inventory.total_tests}项）`,
    `- 执行判定：\`${artifact.execution_readiness.code}\`；检查点缺口=${artifact.execution_readiness.blocking_checkpoint_count}，全部阻塞=${artifact.execution_readiness.blocking_condition_count}，P0=${artifact.execution_readiness.p0_blocker_count}，P1=${artifact.execution_readiness.p1_blocker_count}，may_start=\`${artifact.execution_readiness.may_start}\`。`,
    `- ${artifact.execution_readiness.statement}`,
    "",
    "仓库已有checkpoint 4—15的内容寻址意图、结果、恢复与隔离控制链，其中checkpoint 14/15绑定精确前代、四数据域、独立授权和ROLLED_BACK终态；受信无shell网关已进入bundle，但固定数据库/卷/容器物化执行器及其激活仍不存在，隔离UAT回退演练与人工UAT也尚未执行。",
    "",
    "## 2. Supervisor操作面",
    "",
    `当前识别${artifact.observations.supervisor_operation_count}个Supervisor操作；所需${artifact.observations.required_promotion_operation_count}个UAT晋升/回退操作中实现${artifact.observations.implemented_required_promotion_operations.length}个、缺失${artifact.observations.missing_required_promotion_operations.length}个。`,
    "",
    "缺失操作：",
    "",
    ...artifact.observations.missing_required_promotion_operations.map((item) => `- \`${item}\``),
    ...(artifact.observations.missing_required_promotion_operations.length === 0 ? ["- 无（仅表示Supervisor操作入口和仓库控制链存在）"] : []),
    "",
    "## 3. 逐检查点能力",
    "",
    "| 序号 | 检查点 | 状态 | 未闭合风险 |",
    "| ---: | --- | --- | --- |",
    ...artifact.capabilities.map((entry) => `| ${entry.ordinal} | \`${entry.id}\` | \`${entry.status}\` | ${inline(entry.finding ?? "已由当前源码合同支持")} |`),
    "",
    "## 4. 关键边界事实",
    "",
    `- UAT恢复目标：\`${artifact.observations.restore_target_policy}\`；当前恢复器只能写不同cluster上的可丢弃TEST目标。`,
    `- Migration授权：\`${artifact.observations.migration_authorization}\`；checkpoint 7与独立checkpoint 8授权、数据库围栏、逐文件事务、最终核对和不可覆盖提交回执已形成同一内容寻址链。`,
    `- Compose发布：\`${artifact.observations.compose_release_image_binding}\`；checkpoint 9绑定精确digest、受保护资源身份、数据库围栏交接和unknown/partial保全，但不代表后续postdeploy与业务UAT检查点已提交。`,
    `- Postdeploy事务：\`${artifact.observations.postdeploy_transaction_binding}\`；checkpoint 10/11使用彼此独立的一次性授权，绑定checkpoint 9结果、围栏交接、manifest、四服务运行身份；Supervisor外部控制摘要先形成不可变binding，journal核对后才按history→receipt→current单调提交。`,
    `- 跨岗位UAT事务：\`${artifact.observations.cross_role_uat_transaction_binding}\`；checkpoint 12只摄取已由事前人工授权、精确账号/人员映射、结构化步骤与控制、共同证据主题及三方签字闭合的结果；人工执行授权与后续Supervisor摄取授权必须不同，恢复只续写journal且不重跑人工步骤。`,
    `- 晋升终态事务：\`${artifact.observations.finalization_transaction_binding}\`；checkpoint 13以独立一次性授权聚合checkpoint 4—12 receipt、evidence、intent和authorization链，最终证据绑定checkpoint 12完整result摘要；不释放数据库或备份保护，也不声明checkpoint 14/15回退就绪。`,
    `- 回退事务：\`${artifact.observations.rollback_transaction_binding}\`；checkpoint 14逐阶段先写intent再调用适配器并绑定精确前代，checkpoint 15用独立授权逐项核验后只允许写入ROLLED_BACK；partial/unknown只能隔离，恢复不得重跑阶段。`,
    `- 回退运行时：\`${artifact.observations.rollback_runtime_adapter}\`；固定执行器、v2内容寻址激活/恢复、Supervisor v7一次性授权和bundle切换互锁均已纳入受信链，但生产catalog仍显式拒绝缺失的UAT数据库、四数据域及Web/Worker处理器，且没有主机激活证据。`,
    `- 回退演练：\`${artifact.observations.rollback_rehearsal_evidence}\`；fake-root自动测试不是UAT恢复或回退证据。`,
    "- Writer静默回执只覆盖精确Compose项目与working directory；checkpoint 8在SQL前重验静默并以数据库级围栏拒绝未标记或外部业务客户端，围栏保持至后续部署或保全恢复接管。",
    `- TASK67人工UAT状态：\`${artifact.observations.cross_role_uat_readiness}\`。`,
    "",
    "## 5. 失败关闭要求",
    "",
    "任何工具、手册或operator在本artifact仍为BLOCKED时调用晋升断言，必须得到`UAT_PROMOTION_EXECUTOR_NOT_READY`。不得用root手工Compose、可重复环境变量、TEST恢复回执、旧postdeploy receipt或最终health页面绕过缺失检查点。",
    "",
    "下一实现必须补齐受信、最小权限且可隔离测试的UAT数据库、四数据域及Web/Worker固定处理器，再经专项授权执行主机激活并形成真实UAT回退演练回执；实际人工UAT仍需独立事前授权、UAT资源、人员映射和签字，不能由仓库测试替代。",
    "",
    "## 6. 源码manifest",
    "",
    "| 路径 | SHA-256 |",
    "| --- | --- |",
    ...artifact.generated_from.source_manifest.files.map((entry) => `| \`${entry.path}\` | \`${entry.sha256}\` |`),
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function atomicWrite(repositoryPath, contents) {
  const destination = resolve(ROOT, repositoryPath);
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o644 });
  renameSync(temporary, destination);
}

function run(command) {
  const result = buildUatPromotionRollbackAudit(loadUatPromotionRollbackAuditInputs());
  if (result.errors.length) {
    for (const problem of result.errors) process.stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  const artifactRaw = prettyJson(result.artifact);
  if (command === "generate") {
    atomicWrite(UAT_PROMOTION_AUDIT_ARTIFACT_PATH, artifactRaw);
    atomicWrite(UAT_PROMOTION_AUDIT_MARKDOWN_PATH, result.markdown);
    process.stdout.write(`UAT PROMOTION AUDIT GENERATED status=${result.artifact.execution_readiness.status} blockers=${result.artifact.execution_readiness.blocking_condition_count} artifact_sha256=${result.artifact.artifact_sha256}\n`);
    return;
  }
  if (command === "verify" || command === "assert-ready") {
    if (readRepositoryFile(UAT_PROMOTION_AUDIT_ARTIFACT_PATH) !== artifactRaw) throw new Error("UAT_PROMOTION_AUDIT_ARTIFACT_DRIFT");
    if (readRepositoryFile(UAT_PROMOTION_AUDIT_MARKDOWN_PATH) !== result.markdown) throw new Error("UAT_PROMOTION_AUDIT_MARKDOWN_DRIFT");
    if (command === "assert-ready") assertUatPromotionMayStart(result.artifact);
    process.stdout.write(`UAT PROMOTION AUDIT VERIFY PASS status=${result.artifact.execution_readiness.status} blockers=${result.artifact.execution_readiness.blocking_condition_count} artifact_sha256=${result.artifact.artifact_sha256}\n`);
    return;
  }
  process.stderr.write("usage: uat-promotion-rollback-audit.mjs generate|verify|assert-ready\n");
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { run(process.argv[2]); } catch (failure) { process.stderr.write(`${failure instanceof Error ? failure.message : String(failure)}\n`); process.exitCode = 1; }
}
