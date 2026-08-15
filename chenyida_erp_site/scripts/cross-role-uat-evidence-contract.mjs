import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CROSS_ROLE_UAT_POLICY_CONTRACT = "chenyida-erp-cross-role-uat-evidence-policy/v1";
export const CROSS_ROLE_UAT_ARTIFACT_CONTRACT = "chenyida-erp-cross-role-uat-evidence-contract/v1";
export const CROSS_ROLE_UAT_POLICY_PATH = "chenyida_erp_site/operations/cross-role-uat-evidence-policy-v1.json";
export const CROSS_ROLE_UAT_ARTIFACT_PATH = "chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json";
export const CROSS_ROLE_UAT_MARKDOWN_PATH = "docs/testing/selfhost-cross-role-uat-evidence-contract-v1.md";
export const CROSS_ROLE_UAT_GENERATOR_PATH = "chenyida_erp_site/scripts/cross-role-uat-evidence-contract.mjs";
export const CROSS_ROLE_UAT_MATRIX_PATH = "chenyida_erp_site/operations/application-authorization-matrix-v1.json";
export const CROSS_ROLE_UAT_INVENTORY_PATH = "chenyida_erp_site/release/release-test-inventory-v1.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^(?:chenyida_erp_site|docs)\/[A-Za-z0-9._/-]+$/;
const REQUIRED_WORKFLOWS = Object.freeze([
  "PROCURE_RECEIVE_IQC_AP",
  "PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE",
  "SALES_FQC_SHIPMENT_AR",
  "FINANCE_PAYMENT_REVERSAL",
]);
const REQUIRED_CONTROLS = Object.freeze([
  "UNAUTHORIZED_403",
  "CSRF_403",
  "IDEMPOTENCY_REPLAY",
  "IDEMPOTENCY_CONFLICT",
  "CAS_CONFLICT",
  "ATOMIC_FAILURE_ZERO_HALF_RECORD",
  "APPEND_ONLY_REVERSAL",
  "AUDIT_REQUEST_ID",
]);
const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  "business_role_matrix_approval_id",
  "uat_account_mapping_approval_id",
  "allowed_write_scope",
  "execution_window_start",
  "execution_window_end",
  "stop_authority_person",
  "rollback_owner_person",
]);
const REQUIRED_ACTORS = Object.freeze({
  purchase_executor: "purchase",
  warehouse_executor: "warehouse",
  quality_inspector: "quality",
  quality_dispositioner: "quality",
  production_executor: "production",
  sales_executor: "sales",
  finance_executor: "finance",
  operations_observer: "operations",
  business_acceptor: "manager",
  rollback_owner: "operations",
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

function copy(value) {
  return structuredClone(value);
}

function readRepositoryFile(repositoryPath) {
  if (!SAFE_PATH.test(repositoryPath) || repositoryPath.includes("..")) throw new Error(`UNSAFE_REPOSITORY_PATH:${repositoryPath}`);
  const absolute = resolve(ROOT, repositoryPath);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`UNSAFE_REPOSITORY_PATH:${repositoryPath}`);
  return readFileSync(absolute, "utf8");
}

function readJson(repositoryPath) {
  return JSON.parse(readRepositoryFile(repositoryPath));
}

function error(errors, code, detail = "") {
  errors.push(detail ? `${code}:${detail}` : code);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactSet(actual, expected) {
  return canonicalJson([...actual].sort()) === canonicalJson([...expected].sort());
}

function materializePath(template) {
  return template.replaceAll(/\{[a-z0-9_]+\}/g, "1");
}

function sourceManifest(policy, evidenceBodies, errors) {
  if (!Array.isArray(policy.evidence_sources) || policy.evidence_sources.length < 12) {
    error(errors, "EVIDENCE_SOURCE_SET_INCOMPLETE");
    return { files: [], sha256: sha256("[]") };
  }
  const files = [];
  const seen = new Set();
  for (const entry of policy.evidence_sources) {
    if (!isObject(entry) || typeof entry.path !== "string" || !SAFE_PATH.test(entry.path) || entry.path.includes("..")) {
      error(errors, "EVIDENCE_SOURCE_PATH_INVALID", String(entry?.path));
      continue;
    }
    if (seen.has(entry.path)) error(errors, "EVIDENCE_SOURCE_DUPLICATE", entry.path);
    seen.add(entry.path);
    const body = evidenceBodies.get(entry.path);
    if (typeof body !== "string") {
      error(errors, "EVIDENCE_SOURCE_MISSING", entry.path);
      continue;
    }
    if (!Array.isArray(entry.markers) || entry.markers.length < 1) error(errors, "EVIDENCE_SOURCE_MARKERS_INVALID", entry.path);
    for (const marker of entry.markers ?? []) {
      if (typeof marker !== "string" || marker.length < 4 || !body.includes(marker)) error(errors, "EVIDENCE_SOURCE_MARKER_DRIFT", `${entry.path}:${marker}`);
    }
    files.push({ path: entry.path, sha256: sha256(body), markers: [...(entry.markers ?? [])] });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, sha256: sha256(canonicalJson(files)) };
}

function validateMatrix(policy, matrix, errors) {
  if (matrix.schema_version !== 1 || matrix.authority !== "SELFHOSTED_NODE_POSTGRESQL_SOURCE") error(errors, "AUTHORIZATION_MATRIX_CONTRACT_INVALID");
  if (!SHA256.test(matrix.artifact_sha256 ?? "")) error(errors, "AUTHORIZATION_MATRIX_DIGEST_INVALID");
  else {
    const { artifact_sha256: actual, ...body } = matrix;
    if (actual !== sha256(canonicalJson(body))) error(errors, "AUTHORIZATION_MATRIX_SELF_DIGEST_INVALID");
  }
  const binding = policy.reviewed_authorization_matrix;
  if (!isObject(binding) || binding.path !== CROSS_ROLE_UAT_MATRIX_PATH) error(errors, "AUTHORIZATION_MATRIX_PATH_DRIFT");
  if (binding?.artifact_sha256 !== matrix.artifact_sha256) error(errors, "AUTHORIZATION_MATRIX_ARTIFACT_DRIFT");
  if (binding?.source_manifest_sha256 !== matrix.source_manifest?.sha256) error(errors, "AUTHORIZATION_MATRIX_SOURCE_DRIFT");
  if (!Array.isArray(matrix.operations) || !Array.isArray(matrix.roles)) error(errors, "AUTHORIZATION_MATRIX_SHAPE_INVALID");
}

function validateApproval(policy, errors) {
  if (policy.authority !== "REPOSITORY_SYNTHETIC_EVIDENCE_ONLY" || policy.execution_class !== "NOT_AUTHORIZED") error(errors, "EXECUTION_AUTHORITY_MUST_REMAIN_DENIED");
  if (policy.approval_gate?.status !== "BLOCKED") error(errors, "APPROVAL_GATE_MUST_REMAIN_BLOCKED");
  for (const field of REQUIRED_APPROVAL_FIELDS) if (policy.approval_gate?.[field] !== null) error(errors, "APPROVAL_FIELD_MUST_REMAIN_EMPTY", field);
  for (const [slot, role] of Object.entries(REQUIRED_ACTORS)) {
    const actor = policy.actor_slots?.[slot];
    if (!isObject(actor) || actor.role !== role) error(errors, "ACTOR_ROLE_DRIFT", slot);
    if (actor?.person_name !== null || actor?.account_username !== null) error(errors, "ACTOR_IDENTITY_MUST_REMAIN_EMPTY", slot);
  }
  if (!Array.isArray(policy.separation_rules) || policy.separation_rules.length < 4) error(errors, "SEPARATION_RULES_INCOMPLETE");
  for (const rule of policy.separation_rules ?? []) {
    if (!policy.actor_slots?.[rule.left] || !policy.actor_slots?.[rule.right] || rule.left === rule.right) error(errors, "SEPARATION_RULE_INVALID", `${rule.left}:${rule.right}`);
  }
}

function expandStep(workflow, step, matrixById, actorSlots, errors) {
  const operation = matrixById.get(step.operation_id);
  const prefix = `${workflow.id}:${step.id}`;
  if (!operation) {
    error(errors, "STEP_OPERATION_UNKNOWN", prefix);
    return { ...copy(step), authorization: null };
  }
  if (!operation.methods?.includes(step.method)) error(errors, "STEP_METHOD_NOT_AUTHORIZED", prefix);
  let pathMatches = false;
  try { pathMatches = new RegExp(operation.route_pattern).test(materializePath(step.path)); } catch { error(errors, "MATRIX_ROUTE_PATTERN_INVALID", step.operation_id); }
  if (!pathMatches) error(errors, "STEP_ROUTE_NOT_AUTHORIZED", `${prefix}:${step.path}`);
  const actor = actorSlots[step.actor_slot];
  if (!actor || !operation.allowed_roles?.includes(actor.role)) error(errors, "STEP_ACTOR_NOT_ALLOWED", `${prefix}:${step.actor_slot}`);
  if (!operation.denied_roles?.includes(step.denied_probe_role)) error(errors, "STEP_DENIED_PROBE_NOT_DENIED", `${prefix}:${step.denied_probe_role}`);
  if (operation.access !== "PROTECTED" || operation.csrf !== "REQUIRED" || operation.idempotency !== "REQUIRED" || operation.audit !== "REQUIRED_TRANSACTIONAL") error(errors, "STEP_WRITE_GUARDS_INCOMPLETE", prefix);
  if (!Array.isArray(operation.permissions_all) || operation.permissions_all.length < 1) error(errors, "STEP_PERMISSION_MISSING", prefix);
  if (!isObject(step.body_template) || !Array.isArray(step.cas_fields) || !Array.isArray(step.expected_db_delta) || step.expected_db_delta.length < 1) error(errors, "STEP_EVIDENCE_SHAPE_INVALID", prefix);
  const idempotency = `uat67-${workflow.id.toLowerCase()}-${step.id.toLowerCase()}-{attempt}`;
  return {
    ...copy(step),
    authorization: {
      operation_id: operation.id,
      permissions_all: copy(operation.permissions_all),
      allowed_roles: copy(operation.allowed_roles),
      actor_role: actor?.role ?? null,
      denied_probe_role: step.denied_probe_role,
      route_pattern: operation.route_pattern,
      source: operation.source,
      source_line: operation.source_line,
      csrf: operation.csrf,
      idempotency: operation.idempotency,
      audit: operation.audit,
    },
    request_evidence: {
      headers: {
        Origin: "{approved_uat_origin}",
        "Content-Type": "application/json",
        "X-Request-ID": `UAT67-${workflow.id}-${step.id}-{uuid}`,
        "X-CSRF-Token": "{redacted_capture_only_presence_and_result}",
        "Idempotency-Key": idempotency,
      },
      forbidden_capture: ["Authorization", "Cookie", "Set-Cookie", "X-CSRF-Token正文"],
    },
    response_evidence: ["http_status", "X-Request-ID", "body.request_id", "body_digest_sha256", "Idempotency-Replayed when replay"],
    server_evidence: ["before/after relation counts and selected non-sensitive projections", "audit_log action/object/result/request_id", "idempotency_keys result/request digest without key plaintext"],
  };
}

function validateAndExpandWorkflows(policy, matrix, errors) {
  if (!Array.isArray(policy.workflows) || !exactSet(policy.workflows.map((workflow) => workflow.id), REQUIRED_WORKFLOWS)) error(errors, "WORKFLOW_SET_DRIFT");
  if (!exactSet(policy.required_control_kinds ?? [], REQUIRED_CONTROLS)) error(errors, "REQUIRED_CONTROL_SET_DRIFT");
  const matrixById = new Map((matrix.operations ?? []).map((operation) => [operation.id, operation]));
  const stepIds = new Set();
  const expanded = [];
  for (const workflow of policy.workflows ?? []) {
    if (!Array.isArray(workflow.preconditions) || workflow.preconditions.length < 3 || !Array.isArray(workflow.steps) || workflow.steps.length < 4) error(errors, "WORKFLOW_SHAPE_INVALID", workflow.id);
    const localIds = new Set();
    const steps = [];
    for (const step of workflow.steps ?? []) {
      if (localIds.has(step.id) || stepIds.has(step.id)) error(errors, "STEP_ID_DUPLICATE", step.id);
      localIds.add(step.id); stepIds.add(step.id);
      steps.push(expandStep(workflow, step, matrixById, policy.actor_slots ?? {}, errors));
    }
    const controls = workflow.controls ?? [];
    if (!exactSet(controls.map((control) => control.kind), REQUIRED_CONTROLS)) error(errors, "WORKFLOW_CONTROL_SET_DRIFT", workflow.id);
    for (const control of controls) {
      if (control.target_step !== "ALL_STEPS" && !localIds.has(control.target_step)) error(errors, "CONTROL_TARGET_UNKNOWN", `${workflow.id}:${control.kind}`);
      if (typeof control.expected !== "string" || control.expected.length < 8) error(errors, "CONTROL_EXPECTATION_MISSING", `${workflow.id}:${control.kind}`);
    }
    if (!(workflow.steps ?? []).some((step) => step.branch_from_checkpoint)) error(errors, "REVERSAL_CHECKPOINT_MISSING", workflow.id);
    const signoff = workflow.signoff;
    if (!isObject(signoff) || !Array.isArray(signoff.executor_slots) || signoff.executor_slots.length < 1 || signoff.observer_slot !== "operations_observer" || signoff.business_acceptor_slot !== "business_acceptor") error(errors, "SIGNOFF_ROLES_INVALID", workflow.id);
    for (const field of ["executor_signed_at", "observer_signed_at", "business_accepted_at", "result"]) if (signoff?.[field] !== null) error(errors, "SIGNOFF_MUST_REMAIN_EMPTY", `${workflow.id}:${field}`);
    for (const slot of signoff?.executor_slots ?? []) if (!policy.actor_slots?.[slot] || ["operations_observer", "business_acceptor", "rollback_owner"].includes(slot)) error(errors, "SIGNOFF_EXECUTOR_INVALID", `${workflow.id}:${slot}`);
    expanded.push({ ...copy(workflow), steps });
  }
  return expanded;
}

function artifactWithoutDigest(policy, matrix, inventory, workflows, manifest, rawDigests, errors) {
  const allSteps = workflows.flatMap((workflow) => workflow.steps);
  const branchSteps = allSteps.filter((step) => step.branch_from_checkpoint);
  return {
    schema_version: 1,
    contract: CROSS_ROLE_UAT_ARTIFACT_CONTRACT,
    authority: policy.authority,
    execution_class: policy.execution_class,
    generated_from: {
      policy: { path: CROSS_ROLE_UAT_POLICY_PATH, sha256: rawDigests.policy },
      generator: { path: CROSS_ROLE_UAT_GENERATOR_PATH, sha256: rawDigests.generator },
      authorization_matrix: { path: CROSS_ROLE_UAT_MATRIX_PATH, file_sha256: rawDigests.matrix, artifact_sha256: matrix.artifact_sha256, source_manifest_sha256: matrix.source_manifest?.sha256 },
      release_test_inventory: { path: CROSS_ROLE_UAT_INVENTORY_PATH, sha256: rawDigests.inventory, total_tests: inventory.total_tests, required_tests: inventory.required_tests, not_applicable_tests: inventory.not_applicable_tests },
      evidence_source_manifest: manifest,
    },
    synthetic_fixture: copy(policy.synthetic_fixture),
    approval_gate: copy(policy.approval_gate),
    actor_slots: copy(policy.actor_slots),
    separation_rules: copy(policy.separation_rules),
    request_evidence_contract: copy(policy.request_evidence_contract),
    required_control_kinds: copy(policy.required_control_kinds),
    stop_conditions: copy(policy.stop_conditions),
    rollback_policy: copy(policy.rollback_policy),
    workflows,
    coverage: {
      workflow_count: workflows.length,
      step_count: allSteps.length,
      branch_reversal_step_count: branchSteps.length,
      role_count: new Set(Object.values(policy.actor_slots ?? {}).map((actor) => actor.role)).size,
      operation_count: new Set(allSteps.map((step) => step.operation_id)).size,
      control_assertion_count: workflows.reduce((sum, workflow) => sum + workflow.controls.length, 0),
      evidence_source_count: manifest.files.length,
    },
    readiness: {
      status: "BLOCKED",
      blockers: [
        "BUSINESS_ROLE_MATRIX_APPROVAL_PENDING",
        "UAT_ACCOUNT_MAPPING_APPROVAL_PENDING",
        "UAT_WRITE_SCOPE_AND_WINDOW_NOT_AUTHORIZED",
        "STOP_AND_ROLLBACK_OWNERS_NOT_ASSIGNED",
        "EXECUTOR_OBSERVER_BUSINESS_SIGNOFF_EMPTY",
        "HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED",
      ],
      statement: "该制品只定义合成执行与证据合同，不授权登录、写入、迁移、部署或生产操作。",
    },
    validation: { result: errors.length ? "FAIL" : "PASS", errors: [...errors] },
  };
}

export function buildCrossRoleUatEvidenceContract(inputs) {
  const { policy, matrix, inventory, evidenceBodies, rawDigests } = inputs;
  const errors = [];
  if (policy.schema_version !== 1 || policy.contract !== CROSS_ROLE_UAT_POLICY_CONTRACT) error(errors, "POLICY_CONTRACT_INVALID");
  for (const [name, digest] of Object.entries(rawDigests ?? {})) if (!SHA256.test(digest ?? "")) error(errors, "INPUT_DIGEST_INVALID", name);
  validateMatrix(policy, matrix, errors);
  validateApproval(policy, errors);
  const manifest = sourceManifest(policy, evidenceBodies, errors);
  if (policy.reviewed_evidence_source_manifest_sha256 !== manifest.sha256) error(errors, "EVIDENCE_SOURCE_MANIFEST_DRIFT");
  if (inventory.contract !== "chenyida-erp-release-test-inventory/v1" || inventory.schema_version !== 1 || inventory.total_tests !== inventory.tests?.length) error(errors, "RELEASE_TEST_INVENTORY_INVALID");
  const workflows = validateAndExpandWorkflows(policy, matrix, errors);
  const body = artifactWithoutDigest(policy, matrix, inventory, workflows, manifest, rawDigests, errors);
  const artifact = { ...body, artifact_sha256: sha256(canonicalJson(body)) };
  return { artifact, manifest, errors, markdown: renderMarkdown(artifact) };
}

export function loadCrossRoleUatInputs() {
  const policyRaw = readRepositoryFile(CROSS_ROLE_UAT_POLICY_PATH);
  const matrixRaw = readRepositoryFile(CROSS_ROLE_UAT_MATRIX_PATH);
  const inventoryRaw = readRepositoryFile(CROSS_ROLE_UAT_INVENTORY_PATH);
  const generatorRaw = readRepositoryFile(CROSS_ROLE_UAT_GENERATOR_PATH);
  const policy = JSON.parse(policyRaw);
  const evidenceBodies = new Map((policy.evidence_sources ?? []).map((entry) => [entry.path, readRepositoryFile(entry.path)]));
  return {
    policy,
    matrix: JSON.parse(matrixRaw),
    inventory: JSON.parse(inventoryRaw),
    evidenceBodies,
    rawDigests: { policy: sha256(policyRaw), matrix: sha256(matrixRaw), inventory: sha256(inventoryRaw), generator: sha256(generatorRaw) },
  };
}

function inline(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function list(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderMarkdown(artifact) {
  const lines = [
    "# 晨亿达 ERP 跨岗位 UAT 证据与签字合同 v1",
    "",
    "> 状态：`BLOCKED / SYNTHETIC CONTRACT ONLY / NOT AUTHORIZED TO EXECUTE`。本文件不授权登录、UAT写入、真实数据、迁移、部署、生产切换或恢复。",
    "",
    "## 1. 权威绑定与当前判定",
    "",
    `- 制品合同：\`${artifact.contract}\``,
    `- 制品 SHA-256：\`${artifact.artifact_sha256}\``,
    `- TASK66 权限矩阵 artifact：\`${artifact.generated_from.authorization_matrix.artifact_sha256}\``,
    `- TASK66 权限源码 manifest：\`${artifact.generated_from.authorization_matrix.source_manifest_sha256}\``,
    `- UAT证据源码 manifest：\`${artifact.generated_from.evidence_source_manifest.sha256}\``,
    `- release test inventory：\`${artifact.generated_from.release_test_inventory.sha256}\`（${artifact.generated_from.release_test_inventory.total_tests}项）`,
    `- 判定：\`${artifact.readiness.status}\`；${artifact.readiness.statement}`,
    "",
    "### 未解除阻塞项",
    "",
    list(artifact.readiness.blockers.map((item) => `\`${item}\``)),
    "",
    "## 2. 事前授权门禁（当前必须全部为空）",
    "",
    "| 字段 | 当前值 |",
    "| --- | --- |",
    ...REQUIRED_APPROVAL_FIELDS.map((field) => `| \`${field}\` | \`${artifact.approval_gate[field] === null ? "NULL / BLOCKED" : inline(artifact.approval_gate[field])}\` |`),
    "",
    "任何字段为空、部署身份不一致或签字未闭合时不得执行。后续填写必须来自项目负责人专项授权及独立受控证据包，不能直接修改此canonical模板来伪造READY。",
    "",
    "## 3. 合成数据与人员槽位",
    "",
    `固定fixture：\`${artifact.synthetic_fixture.fixture_id}\`，数量 \`${artifact.synthetic_fixture.planned_quantity}\`（两批 \`${artifact.synthetic_fixture.first_batch_quantity}\` + \`${artifact.synthetic_fixture.second_batch_quantity}\`），币种 \`${artifact.synthetic_fixture.currency}\`。`,
    "",
    "| 槽位 | 服务端角色 | 人员 | UAT账号 |",
    "| --- | --- | --- | --- |",
    ...Object.entries(artifact.actor_slots).map(([slot, actor]) => `| \`${slot}\` | \`${actor.role}\` | ${actor.person_name ?? "未指定"} | ${actor.account_username ?? "未指定"} |`),
    "",
    "职责分离：",
    "",
    list(artifact.separation_rules.map((rule) => `\`${rule.left}\` ≠ \`${rule.right}\`：${rule.reason}`)),
    "",
    "## 4. 通用证据合同",
    "",
    "每个写步骤都必须保存以下非敏感证据；不得保存Authorization、Cookie、Set-Cookie、CSRF正文、密码或Session正文。",
    "",
    list([
      "事前批准包编号、执行人员槽位与已核验账号映射。",
      "method/path、净化后的请求body、Origin存在性、X-Request-ID、Idempotency-Key摘要及CSRF验证结果。",
      "HTTP status、响应X-Request-ID、body.request_id、响应body SHA-256；重放时额外核对Idempotency-Replayed=true。",
      "步骤前后关系计数、指定投影数量/金额/版本、业务Event、audit_log与idempotency_keys摘要。",
      "失败用例必须证明所有相关业务表、Event、Audit和Idempotency均为零半记录。",
    ]),
    "",
  ];

  let section = 5;
  for (const workflow of artifact.workflows) {
    lines.push(`## ${section}. ${workflow.title}（\`${workflow.id}\`）`, "", "前置条件：", "", list(workflow.preconditions), "");
    for (const step of workflow.steps) {
      lines.push(
        `### ${step.id} ${step.title}`,
        "",
        `- 执行槽位/角色：\`${step.actor_slot}\` / \`${step.authorization?.actor_role}\`；越权探针：\`${step.denied_probe_role}\`。`,
        `- API：\`${step.method} ${step.path}\`；矩阵操作：\`${step.operation_id}\`；permission：${step.authorization?.permissions_all.map((value) => `\`${value}\``).join(" + ")}.`,
        `- 成功HTTP：\`${step.expected_status}\`；CAS：${step.cas_fields.length ? step.cas_fields.map((value) => `\`${value}\``).join("、") : "无显式版本字段，但仍受唯一性/来源锁约束"}.`,
        ...(step.branch_from_checkpoint ? [`- 隔离分支：\`${step.branch_from_checkpoint}\`；不得和主链下游在同一fixture上连续执行。`] : []),
        "- 净化请求模板：",
        "",
        "```json",
        JSON.stringify(step.body_template, null, 2),
        "```",
        "",
        "- 预期数据库增量：",
        "",
        ...step.expected_db_delta.map((delta) => `  - \`${delta.table}\`：\`${delta.delta}\`；${delta.assertion}`),
        "",
        `- 请求证据：\`X-Request-ID=${step.request_evidence.headers["X-Request-ID"]}\`；\`Idempotency-Key=${step.request_evidence.headers["Idempotency-Key"]}\`（实际证据只保存必要值/摘要）。`,
        "",
      );
    }
    lines.push(
      `### ${workflow.id} 异常、原子性与冲销门禁`,
      "",
      "| 控制 | 目标步骤 | 必须观察到 |",
      "| --- | --- | --- |",
      ...workflow.controls.map((control) => `| \`${control.kind}\` | \`${control.target_step}\` | ${inline(control.expected)} |`),
      "",
      "### 三方签字（当前为空，不能视为验收）",
      "",
      `- 执行人槽位：${workflow.signoff.executor_slots.map((slot) => `\`${slot}\``).join("、")}；签字时间：\`NULL\`。`,
      `- 技术观察人：\`${workflow.signoff.observer_slot}\`；签字时间：\`NULL\`。`,
      `- 业务验收人：\`${workflow.signoff.business_acceptor_slot}\`；接受时间：\`NULL\`；结果：\`NULL\`。`,
      "",
    );
    section += 1;
  }

  lines.push(
    `## ${section}. 停止与回退`,
    "",
    "停止条件：",
    "",
    list(artifact.stop_conditions),
    "",
    `回退模式为 \`${artifact.rollback_policy.mode}\`。直接SQL删除或改写业务事实为 \`${artifact.rollback_policy.direct_sql_delete_or_update}\`；快照恢复为 \`${artifact.rollback_policy.snapshot_restore}\`；下游阻塞时执行 \`${artifact.rollback_policy.downstream_blocked_action}\`。`,
    "",
    "回退后必须复核：",
    "",
    list(artifact.rollback_policy.required_post_rollback_checks),
    "",
    `## ${section + 1}. 证据源码manifest`,
    "",
    "| 路径 | SHA-256 |",
    "| --- | --- |",
    ...artifact.generated_from.evidence_source_manifest.files.map((entry) => `| \`${entry.path}\` | \`${entry.sha256}\` |`),
    "",
    `覆盖统计：${artifact.coverage.workflow_count}条链、${artifact.coverage.step_count}个步骤、${artifact.coverage.branch_reversal_step_count}个隔离冲销分支、${artifact.coverage.control_assertion_count}个异常/证据控制、${artifact.coverage.evidence_source_count}个摘要绑定证据源。`,
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function atomicWrite(repositoryPath, contents) {
  const destination = resolve(ROOT, repositoryPath);
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o644 });
  renameSync(temporary, destination);
}

function run(command) {
  const inputs = loadCrossRoleUatInputs();
  const result = buildCrossRoleUatEvidenceContract(inputs);
  if (command === "manifest") {
    process.stdout.write(`${result.manifest.sha256}\n`);
    for (const entry of result.manifest.files) process.stdout.write(`${entry.sha256}  ${entry.path}\n`);
    return;
  }
  if (result.errors.length) {
    for (const problem of result.errors) process.stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  const artifactRaw = prettyJson(result.artifact);
  if (command === "generate") {
    atomicWrite(CROSS_ROLE_UAT_ARTIFACT_PATH, artifactRaw);
    atomicWrite(CROSS_ROLE_UAT_MARKDOWN_PATH, result.markdown);
    process.stdout.write(`UAT CONTRACT GENERATED workflows=${result.artifact.coverage.workflow_count} steps=${result.artifact.coverage.step_count} artifact_sha256=${result.artifact.artifact_sha256}\n`);
    return;
  }
  if (command === "verify") {
    const artifactActual = readRepositoryFile(CROSS_ROLE_UAT_ARTIFACT_PATH);
    const markdownActual = readRepositoryFile(CROSS_ROLE_UAT_MARKDOWN_PATH);
    if (artifactActual !== artifactRaw) throw new Error("UAT_CONTRACT_ARTIFACT_DRIFT");
    if (markdownActual !== result.markdown) throw new Error("UAT_CONTRACT_MARKDOWN_DRIFT");
    process.stdout.write(`UAT CONTRACT VERIFY PASS workflows=${result.artifact.coverage.workflow_count} steps=${result.artifact.coverage.step_count} artifact_sha256=${result.artifact.artifact_sha256}\n`);
    return;
  }
  process.stderr.write("usage: cross-role-uat-evidence-contract.mjs manifest|generate|verify\n");
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { run(process.argv[2]); } catch (failure) { process.stderr.write(`${failure instanceof Error ? failure.message : String(failure)}\n`); process.exitCode = 1; }
}

export const repositoryRoot = ROOT;
export const repositoryRelative = (absolutePath) => relative(ROOT, absolutePath).replaceAll("\\", "/");
