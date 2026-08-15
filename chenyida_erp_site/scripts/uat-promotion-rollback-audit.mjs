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
  MIGRATION_COMMIT_RECEIPT: "MISSING",
  COMPOSE_DEPLOYMENT_RECEIPT: "MISSING",
  POST_DEPLOY_RUNTIME_CONFIGURATION: "SUPPORTED",
  POST_DEPLOY_IDENTITY: "SUPPORTED",
  CROSS_ROLE_UAT_EXECUTION: "CONTRACT_ONLY",
  PROMOTION_FINAL_RECEIPT: "MISSING",
  ROLLBACK_TO_UAT_EXECUTOR: "MISSING",
  ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT: "MISSING",
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
  const mappings = ["ENTRYPOINTS", "RUNTIME_PRIVILEGE_OPERATIONS", "CLUSTER_POLICY_OPERATIONS", "NOTIFIER_EGRESS_OPERATIONS", "UAT_PROMOTION_OPERATIONS"];
  const supervisorOperations = [...new Set(mappings.flatMap((name) => extractPythonMappingKeys(launcher, name, errors)))].sort();
  const required = policy.required_supervisor_operations ?? [];
  if (!Array.isArray(required) || required.length < 7 || required.some((item) => !IDENTIFIER.test(item))) error(errors, "AUDIT_REQUIRED_SUPERVISOR_OPERATIONS_INVALID");
  const implementedRequired = required.filter((item) => supervisorOperations.includes(item));
  const missingRequired = required.filter((item) => !supervisorOperations.includes(item));
  const expectedImplemented = policy.expected_implemented_supervisor_operations ?? [];

  const restore = sourceBodies.get("chenyida_erp_site/scripts/restore-selfhost.sh") ?? "";
  const migration = sourceBodies.get("chenyida_erp_site/scripts/release-migration-authorization.ts") ?? "";
  const migrationRunner = sourceBodies.get("chenyida_erp_site/scripts/migrate-postgres.ts") ?? "";
  const promotionJournal = sourceBodies.get("chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs") ?? "";
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
      && promotionJournal.includes("UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT")
      && migration.includes("Legacy variables may select and validate evidence, but never authorize SQL")
      && migrationRunner.includes("MIGRATION_SUPERVISOR_EXECUTION_ADAPTER_NOT_IMPLEMENTED")
      ? "SUPERVISOR_ONE_TIME_APPROVAL_SQL_BLOCKED" : "UNKNOWN",
    compose_release_image_binding: compose.includes("ERP_WEB_IMAGE") && compose.includes("ERP_WORKER_IMAGE") ? "DIGEST_OVERRIDE_WITHOUT_PROMOTION_RECEIPT" : "UNKNOWN",
    cross_role_uat_readiness: crossRole?.readiness?.status ?? "UNKNOWN",
  };
  if (!Array.isArray(expectedImplemented) || expectedImplemented.some((item) => !IDENTIFIER.test(item))
    || !exactSet(implementedRequired, expectedImplemented)) error(errors, "AUDIT_IMPLEMENTED_OPERATION_DRIFT", implementedRequired.join(","));
  if (observations.restore_target_policy !== "TEST_ONLY") error(errors, "AUDIT_RESTORE_BOUNDARY_DRIFT");
  if (observations.migration_authorization !== "SUPERVISOR_ONE_TIME_APPROVAL_SQL_BLOCKED") error(errors, "AUDIT_MIGRATION_AUTHORIZATION_DRIFT");
  if (observations.compose_release_image_binding !== "DIGEST_OVERRIDE_WITHOUT_PROMOTION_RECEIPT") error(errors, "AUDIT_COMPOSE_BINDING_DRIFT");
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
  const manifest = validateSourceFiles(policy, sourceBodies, errors);
  const capabilities = validateCapabilities(policy, sourceBodies, errors);
  const observations = inspectRepository(policy, sourceBodies, errors);
  const incomplete = capabilities.filter((entry) => entry.status !== "SUPPORTED");
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
    execution_readiness: {
      status: incomplete.length === 0 ? "READY" : "BLOCKED",
      may_start: incomplete.length === 0,
      blocking_checkpoint_count: incomplete.length,
      p0_blocker_count: incomplete.filter((entry) => entry.severity_if_incomplete === "P0").length,
      p1_blocker_count: incomplete.filter((entry) => entry.severity_if_incomplete === "P1").length,
      code: incomplete.length === 0 ? "UAT_PROMOTION_EXECUTOR_READY" : "UAT_PROMOTION_EXECUTOR_NOT_READY",
      statement: incomplete.length === 0
        ? "全部逐检查点执行、恢复与回退能力已由同一内容寻址控制链证明。"
        : "当前只允许继续仓库实施和隔离验证；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。",
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
    "> 当前结论：`BLOCKED / EXECUTOR INCOMPLETE / NOT AUTHORIZED TO PROMOTE OR ROLLBACK`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。",
    "",
    "## 1. 审计结论",
    "",
    `- artifact SHA-256：\`${artifact.artifact_sha256}\``,
    `- source manifest SHA-256：\`${artifact.generated_from.source_manifest.sha256}\`（${artifact.generated_from.source_manifest.files.length}文件）`,
    `- release inventory SHA-256：\`${artifact.generated_from.release_test_inventory.sha256}\`（${artifact.generated_from.release_test_inventory.total_tests}项）`,
    `- 执行判定：\`${artifact.execution_readiness.code}\`；P0=${artifact.execution_readiness.p0_blocker_count}，P1=${artifact.execution_readiness.p1_blocker_count}，may_start=\`${artifact.execution_readiness.may_start}\`。`,
    `- ${artifact.execution_readiness.statement}`,
    "",
    "仓库已有候选source snapshot、ELIGIBLE manifest、pre-deploy runtime guard、promotion intent/journal、promotion-bound actual-offhost snapshot验收、同一Compose Web/Worker持续静默回执、postdeploy probe和runtime identity；但尚未把Migration数据库围栏、Compose部署、业务UAT和回退适配器全部接入同一耐久逐检查点事务。",
    "",
    "## 2. Supervisor操作面",
    "",
    `当前识别${artifact.observations.supervisor_operation_count}个Supervisor操作；所需${artifact.observations.required_promotion_operation_count}个UAT晋升/回退操作中实现${artifact.observations.implemented_required_promotion_operations.length}个、缺失${artifact.observations.missing_required_promotion_operations.length}个。`,
    "",
    "缺失操作：",
    "",
    ...artifact.observations.missing_required_promotion_operations.map((item) => `- \`${item}\``),
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
    `- Migration授权：\`${artifact.observations.migration_authorization}\`；checkpoint 7只形成一次性批准证明，受控SQL在checkpoint 8适配器完成前明确失败关闭。`,
    `- Compose发布：\`${artifact.observations.compose_release_image_binding}\`；digest override不等于受控部署回执。`,
    "- Writer静默回执只覆盖精确Compose项目与working directory；未标记或外部数据库客户端必须由下一步一次性Migration数据库围栏拒绝。",
    `- TASK67人工UAT状态：\`${artifact.observations.cross_role_uat_readiness}\`。`,
    "",
    "## 5. 失败关闭要求",
    "",
    "任何工具、手册或operator在本artifact仍为BLOCKED时调用晋升断言，必须得到`UAT_PROMOTION_EXECUTOR_NOT_READY`。不得用root手工Compose、可重复环境变量、TEST恢复回执、旧postdeploy receipt或最终health页面绕过缺失检查点。",
    "",
    "下一实现必须接入独立的一次性Migration执行授权、数据库级writer围栏和提交回执，并继续沿用内容寻址history/receipts/current、每步一次性授权、精确前代回退及unknown/partial保全；执行器完整后才可在合成Compose和隔离PostgreSQL做动态验证。",
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
    process.stdout.write(`UAT PROMOTION AUDIT GENERATED status=${result.artifact.execution_readiness.status} blockers=${result.artifact.execution_readiness.blocking_checkpoint_count} artifact_sha256=${result.artifact.artifact_sha256}\n`);
    return;
  }
  if (command === "verify" || command === "assert-ready") {
    if (readRepositoryFile(UAT_PROMOTION_AUDIT_ARTIFACT_PATH) !== artifactRaw) throw new Error("UAT_PROMOTION_AUDIT_ARTIFACT_DRIFT");
    if (readRepositoryFile(UAT_PROMOTION_AUDIT_MARKDOWN_PATH) !== result.markdown) throw new Error("UAT_PROMOTION_AUDIT_MARKDOWN_DRIFT");
    if (command === "assert-ready") assertUatPromotionMayStart(result.artifact);
    process.stdout.write(`UAT PROMOTION AUDIT VERIFY PASS status=${result.artifact.execution_readiness.status} blockers=${result.artifact.execution_readiness.blocking_checkpoint_count} artifact_sha256=${result.artifact.artifact_sha256}\n`);
    return;
  }
  process.stderr.write("usage: uat-promotion-rollback-audit.mjs generate|verify|assert-ready\n");
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { run(process.argv[2]); } catch (failure) { process.stderr.write(`${failure instanceof Error ? failure.message : String(failure)}\n`); process.exitCode = 1; }
}
