import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://127.0.0.1:3000";
const username = process.env.ERP_ADMIN_USERNAME; const password = process.env.ERP_ADMIN_PASSWORD;
const databaseUrl = process.env.DATABASE_URL || "";
if (process.env.ERP_ENV !== "test" || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error("compose smoke requires an isolated test database");
if (!username || !password) throw new Error("ERP_ADMIN_USERNAME and ERP_ADMIN_PASSWORD are required");
let cookie = ""; let csrf = "";
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "selfhost-compose-smoke" });

async function apiResult(path, init = {}) {
  const headers = new Headers(init.headers); if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (setCookies.length) cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { response, data: await response.json() };
}
async function api(path, init = {}) {
  const result = await apiResult(path, init);
  if (!result.response.ok) throw new Error(`${path}: ${result.response.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
const writeHeaders = (key) => ({ Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": key, "Content-Type": "application/json" });
const health = await api("/api/health"); if (health.database !== "postgresql") throw new Error("health database mismatch");
const login = await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); csrf = login.csrf_token;
const session = await api("/api/session"); if (!session.authenticated) throw new Error("session not authenticated");
const categories = await api("/api/material-master/categories?view=tree");
const flatten = (nodes) => nodes.flatMap((node) => node.is_leaf ? [node] : flatten(node.children || []));
const leaf = flatten(categories.data)[0]; if (!leaf) throw new Error("no leaf category");
const schema = (await api(`/api/material-master/categories/${leaf.category_id}/schema`)).data;
const smokeValue = (definition) => definition.data_type === "TEXT"
  ? "SMOKE"
  : definition.data_type === "BOOLEAN"
    ? false
    : definition.data_type === "ENUM"
      ? definition.enum_options[0].code
      : definition.data_type === "DATE"
        ? "2026-07-24"
        : 1;
const attributes = Object.fromEntries(schema.attributes.filter((item) => item.required).map((item) => [item.attribute_code, { value: smokeValue(item), ...(item.input_contract.unit_mode === "REQUIRED" ? { unit: item.standard_unit } : {}), source: "MANUAL", confidence: 1 }]));
const draft = await api("/api/material-master/drafts", { method: "POST", headers: writeHeaders(`smoke-draft-${crypto.randomUUID()}`), body: JSON.stringify({ category_id: leaf.category_id, basic_fields: { standard_name: "Compose 冒烟物料", unit: "PCS", brand: "", manufacturer: "", manufacturer_part_number: "", procurement_type: "PURCHASE", inventory_type: "STOCKED", lot_control_required: false, shelf_life_days: null, inspection_type: "NORMAL", environmental_requirement: "UNSPECIFIED", source_type: "MANUAL" }, attributes }) });
await api(`/api/material-master/materials/${draft.data.material_id}`);
const activeFixture = await pool.query(`
  insert into material_master(
    internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,
    material_status,procurement_type,inventory_type,lot_control_required,shelf_life_days,inspection_type,
    environmental_requirement,source_type,source_ref,version,last_modified_by,created_by,updated_by,request_id,
    approved_by,approved_at
  ) values($1,'Compose 精确绑定 ACTIVE',$2,'SMOKE','SMOKE','SMOKE-ACTIVE','PCS','ACTIVE','PURCHASE','STOCKED',
    false,null,'NORMAL','UNSPECIFIED','MANUAL','compose-test-fixture',1,$3,$3,$3,$4,$3,now())
  returning id,standard_name,version
`, [`CYD-${leaf.category_code}-999999`, leaf.category_id, username, crypto.randomUUID()]);
const activeFixtureId = Number(activeFixture.rows[0].id);
const batch = await api("/api/material-master/import-batches", { method: "POST", headers: writeHeaders(`smoke-batch-${crypto.randomUUID()}`), body: JSON.stringify({ source_kind: "CSV", retry_of_batch_id: null }) });
const bytes = await readFile(new URL("../tests/fixtures/selfhost-smoke.csv", import.meta.url)); const form = new FormData(); form.append("file", new File([bytes], "selfhost-smoke.csv", { type: "text/csv" }));
await api(`/api/material-master/import-batches/${batch.data.id}/file`, { method: "POST", headers: { Origin: base, "X-CSRF-Token": csrf, "Idempotency-Key": `smoke-upload-${crypto.randomUUID()}` }, body: form });
const queued = await api(`/api/material-master/import-batches/${batch.data.id}/parse`, { method: "POST", headers: writeHeaders(`smoke-parse-${crypto.randomUUID()}`), body: JSON.stringify({ expected_version: 2 }) });
let job; for (let attempt = 0; attempt < 40; attempt += 1) {
  try { job = await api(`/api/jobs/${queued.data.job_id}`); } catch (error) { if (!String(error).includes("JOB_NOT_FOUND")) throw error; }
  if (job && ["SUCCEEDED", "DEAD"].includes(job.data.status)) break; await new Promise((resolve) => setTimeout(resolve, 500));
}
if (job?.data?.status !== "SUCCEEDED") throw new Error(`worker did not finish: ${JSON.stringify(job)}`);
const detail = await api(`/api/material-master/import-batches/${batch.data.id}`); if (detail.data.batch.status !== "AWAITING_MAPPING" || detail.data.batch.total_rows < 1) throw new Error("parse and mapping draft were not published");
const sheets = await api(`/api/material-master/import-batches/${batch.data.id}/sheets`);
if (sheets.mapping_preparation_status !== "READY" || sheets.sheets.length !== 1) throw new Error("mapping preparation is not ready");
const current = await api(`/api/material-master/import-batches/${batch.data.id}/mapping`);
if (current.mapping.mapping_status !== "DRAFT" || current.mapping.items.length < 3) throw new Error("initial mapping suggestions are incomplete");
const brandField = current.mapping.source_fields.find((field) => field.normalized_header === "brand");
if (!brandField) throw new Error("brand source field was not parsed");
const smokeMappingItems = [...current.mapping.items, {
  source_column_index: brandField.column_index,
  source_column_indexes: [brandField.column_index],
  source_header: brandField.source_header,
  source_headers: [brandField.source_header],
  target_namespace: "basic",
  target_code: "BRAND",
  mapping_mode: "SOURCE",
  default_value_json: null,
  required: false,
  display_order: current.mapping.items.length,
  combination_strategy: "FIRST_NON_EMPTY",
  combination_separator: " ",
  mapping_confidence: 1,
  adaptive_mapping_status: "CONFIRMED",
  mapping_evidence: ["COMPOSE_TEST_EXPLICIT_MAPPING"],
}];
const saved = await api(`/api/material-master/import-batches/${batch.data.id}/mapping`, {
  method: "PUT",
  headers: writeHeaders(`smoke-mapping-save-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: detail.data.batch.current_version,
    parse_run_id: current.mapping.parse_run_id,
    expected_mapping_version: current.mapping.mapping_version,
    selected_sheet_index: current.mapping.selected_sheet_index,
    header_mode: current.mapping.header_mode,
    header_row_number: current.mapping.header_row_number,
    items: smokeMappingItems,
  }),
});
const preview = await api(`/api/material-master/import-batches/${batch.data.id}/mapping/preview`, {
  method: "POST",
  headers: writeHeaders(`smoke-mapping-preview-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: detail.data.batch.current_version,
    parse_run_id: saved.mapping.parse_run_id,
    mapping: {
      selected_sheet_index: saved.mapping.selected_sheet_index,
      header_mode: saved.mapping.header_mode,
      header_row_number: saved.mapping.header_row_number,
      items: saved.mapping.items,
    },
    start_row: 2,
    row_limit: 20,
  }),
});
if (preview.sampled_row_count !== 3) throw new Error("mapping preview row count mismatch");
const confirmed = await api(`/api/material-master/import-batches/${batch.data.id}/mapping/confirm`, {
  method: "POST",
  headers: writeHeaders(`smoke-mapping-confirm-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: detail.data.batch.current_version,
    parse_run_id: saved.mapping.parse_run_id,
    mapping_id: saved.mapping.id,
    expected_mapping_version: saved.mapping.mapping_version,
    metadata_digest: saved.mapping.metadata_digest,
  }),
});
if (confirmed.batch_status !== "MAPPING_CONFIRMED" || confirmed.mapping.mapping_status !== "CONFIRMED") throw new Error("mapping was not confirmed");
const versions = await api(`/api/material-master/import-batches/${batch.data.id}/mapping/versions`);
if (versions.items.length !== 1 || versions.items[0].mapping_status !== "CONFIRMED") throw new Error("mapping version history mismatch");
const materialBefore = await pool.query("select id,material_status,version from material_master order by id");
const normalization = await api(`/api/material-master/import-batches/${batch.data.id}/normalize`, {
  method: "POST",
  headers: writeHeaders(`smoke-normalization-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: confirmed.current_version,
    mapping_version_id: confirmed.mapping.id,
    processor_version: "material-import-normalizer-v1",
  }),
});
async function waitForRun(runId, statuses) {
  let value;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    value = await api(`/api/material-master/import-batches/${batch.data.id}/normalization`);
    if (value.latest_attempt?.id === runId && statuses.includes(value.latest_attempt.run_status)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`normalization run did not reach ${statuses.join("/")}: ${JSON.stringify(value)}`);
}
let normalizationSummary = await waitForRun(normalization.normalization_run_id, ["SUCCEEDED", "FAILED", "CANCELLED"]);
if (normalizationSummary?.current_run?.id !== normalization.normalization_run_id || normalizationSummary.current_run.run_status !== "SUCCEEDED") {
  throw new Error(`normalization did not publish: ${JSON.stringify(normalizationSummary)}`);
}
const normalizedRows = await api(`/api/material-master/import-batches/${batch.data.id}/normalized-rows?run_id=${normalization.normalization_run_id}&limit=50`);
if (normalizedRows.items.length !== 3 || !["VALID", "WARNING", "ERROR"].every((status) => normalizedRows.items.some((row) => row.row_status === status))) {
  throw new Error("normalized rows are incomplete");
}
const normalizedDetail = await api(`/api/material-master/import-batches/${batch.data.id}/normalized-rows/${normalizedRows.items[0].id}?run_id=${normalization.normalization_run_id}`);
if (!normalizedDetail.raw_row || !Array.isArray(normalizedDetail.field_candidates) || !Array.isArray(normalizedDetail.lineage)) {
  throw new Error("normalized row evidence is incomplete");
}
const normalizationIssues = await api(`/api/material-master/import-batches/${batch.data.id}/normalization-issues?run_id=${normalization.normalization_run_id}&limit=100`);
if (!normalizationIssues.items.some((issue) => issue.issue_level === "WARNING") || !normalizationIssues.items.some((issue) => issue.issue_level === "ERROR")) {
  throw new Error("normalization WARNING/ERROR issues are incomplete");
}
for (const status of ["VALID", "WARNING", "ERROR"]) {
  const filtered = await api(`/api/material-master/import-batches/${batch.data.id}/normalized-rows?run_id=${normalization.normalization_run_id}&row_status=${status}&limit=50`);
  if (!filtered.items.length || filtered.items.some((row) => row.row_status !== status)) throw new Error(`${status} row filter mismatch`);
}

const rerun = await api(`/api/material-master/import-batches/${batch.data.id}/normalize`, {
  method: "POST",
  headers: writeHeaders(`smoke-normalization-rerun-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: normalizationSummary.current_version,
    mapping_version_id: confirmed.mapping.id,
    processor_version: "material-import-normalizer-v1",
    rerun_reason: "Compose 验证历史运行保留",
  }),
});
normalizationSummary = await waitForRun(rerun.normalization_run_id, ["SUCCEEDED", "FAILED", "CANCELLED"]);
if (rerun.run_version !== 2 || normalizationSummary.current_run?.id !== rerun.normalization_run_id) throw new Error("rerun did not publish v2");
const history = await api(`/api/material-master/import-batches/${batch.data.id}/normalization/runs?limit=20`);
if (history.items.length !== 2 || history.items[0].run_status !== "SUCCEEDED" || history.items[1].run_status !== "SUPERSEDED") throw new Error("normalization history mismatch");
const oldRows = await api(`/api/material-master/import-batches/${batch.data.id}/normalized-rows?run_id=${normalization.normalization_run_id}&limit=50`);
if (oldRows.items.length !== normalizedRows.items.length) throw new Error("superseded run rows are no longer queryable");

const cancelledRun = await api(`/api/material-master/import-batches/${batch.data.id}/normalize`, {
  method: "POST",
  headers: writeHeaders(`smoke-normalization-cancel-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: normalizationSummary.current_version,
    mapping_version_id: confirmed.mapping.id,
    processor_version: "material-import-normalizer-v1",
    rerun_reason: "Compose 验证取消不发布",
  }),
});
let cancelResult;
for (let attempt = 0; attempt < 10; attempt += 1) {
  const latest = await api(`/api/material-master/import-batches/${batch.data.id}/normalization`);
  const response = await apiResult(`/api/material-master/import-batches/${batch.data.id}/normalization/runs/${cancelledRun.normalization_run_id}/cancel`, {
    method: "POST",
    headers: writeHeaders(`smoke-normalization-cancel-request-${crypto.randomUUID()}`),
    body: JSON.stringify({ expected_version: latest.latest_attempt.expected_version }),
  });
  if (response.response.ok) { cancelResult = response.data; break; }
  if (response.response.status !== 409) throw new Error(`cancel failed: ${response.response.status} ${JSON.stringify(response.data)}`);
}
if (!cancelResult) throw new Error("cancel never won optimistic concurrency");
const cancelledSummary = await waitForRun(cancelledRun.normalization_run_id, ["CANCELLED", "SUCCEEDED"]);
if (cancelledSummary.latest_attempt.run_status !== "CANCELLED" || cancelledSummary.current_run.id !== rerun.normalization_run_id) throw new Error("cancelled rerun changed published pointer");
const cancelledRows = await apiResult(`/api/material-master/import-batches/${batch.data.id}/normalized-rows?run_id=${cancelledRun.normalization_run_id}&limit=50`);
if (cancelledRows.response.status !== 404) throw new Error("cancelled staging became visible");
const materialAfterNormalization = await pool.query("select id,material_status,version from material_master order by id");
if (JSON.stringify(materialAfterNormalization.rows) !== JSON.stringify(materialBefore.rows)) {
  throw new Error("normalization changed Material Draft or ACTIVE material");
}

const reviewCreated = await api(`/api/material-master/import-batches/${batch.data.id}/reviews`, {
  method: "POST",
  headers: writeHeaders(`smoke-review-create-${crypto.randomUUID()}`),
  body: JSON.stringify({ normalization_run_id: rerun.normalization_run_id }),
});
let review = reviewCreated.data;
const reviewRows = await api(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/rows?limit=50`);
if (reviewRows.items.length !== normalizedRows.items.length) throw new Error("review rows do not cover the published run");
const reviewByStatus = new Map(reviewRows.items.map((row) => [row.normalization_row_status, row]));
const validReviewRow = reviewByStatus.get("VALID"); const warningReviewRow = reviewByStatus.get("WARNING"); const errorReviewRow = reviewByStatus.get("ERROR");
if (!validReviewRow || !warningReviewRow || !errorReviewRow) throw new Error("review status coverage mismatch");

async function mutateReviewRow(row, endpoint, body) {
  const value = await api(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/rows/${row.review_row_id}/${endpoint}`, {
    method: "POST",
    headers: writeHeaders(`smoke-review-${endpoint.replaceAll("/", "-")}-${crypto.randomUUID()}`),
    body: JSON.stringify({ expected_session_version: review.expected_version, expected_row_version: row.expected_version, ...body }),
  });
  review = { ...review, expected_version: value.session_version };
  row.expected_version = value.row_version;
  return value;
}

await mutateReviewRow(validReviewRow, "field-overrides", {
  target_field_code: "CATEGORY_ID", value_semantics: "SET", override_value: leaf.category_id,
  reason_code: "CATEGORY_SELECTED", comment: "Compose 人工选择分类",
});
for (const definition of schema.attributes.filter((item) => item.required)) {
  await mutateReviewRow(validReviewRow, "attribute-overrides", {
    attribute_code: definition.attribute_code, value_semantics: "SET", override_value: smokeValue(definition),
    unit_or_format: definition.input_contract.unit_mode === "REQUIRED" ? definition.standard_unit : "",
    reason_code: "ATTRIBUTE_CONFIRMED", comment: "Compose 人工确认必填属性",
  });
}
await mutateReviewRow(validReviewRow, "field-overrides", {
  target_field_code: "BRAND", value_semantics: "CLEAR", reason_code: "MANUAL_CLEAR", comment: "验证显式清空",
});
await mutateReviewRow(validReviewRow, "field-overrides", {
  target_field_code: "BRAND", value_semantics: "REVERT", reason_code: "RESTORE_CANDIDATE", comment: "验证恢复候选",
});
await mutateReviewRow(validReviewRow, "decision", { disposition: "CREATE_DRAFT", decision_comment: "Compose 人工明确建稿" });

const warningDetail = await api(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/rows/${warningReviewRow.review_row_id}`);
for (const issue of warningDetail.data.normalization_issues.filter((item) => item.issue_level === "WARNING")) {
  await mutateReviewRow(warningReviewRow, `issues/${issue.id}/resolution`, {
    resolution_status: "WARNING_ACKNOWLEDGED", resolution_code: "WARNING_REVIEWED", comment: "Compose 人工确认 WARNING",
  });
}
await mutateReviewRow(warningReviewRow, "decision", {
  disposition: "BIND_EXISTING", existing_material_id: activeFixtureId, decision_comment: "Compose 人工精确选择 ACTIVE",
});
await mutateReviewRow(errorReviewRow, "decision", {
  disposition: "EXCLUDE", decision_reason_code: "SOURCE_INVALID", decision_comment: "Compose 人工排除 ERROR 行",
});

const staleReview = await apiResult(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/rows/${validReviewRow.review_row_id}/decision`, {
  method: "POST",
  headers: writeHeaders(`smoke-review-stale-${crypto.randomUUID()}`),
  body: JSON.stringify({ expected_session_version: 1, expected_row_version: 1, disposition: "KEEP" }),
});
if (staleReview.response.status !== 409) throw new Error("review expected_version conflict was not enforced");

const finalizationKey = `smoke-review-finalize-${crypto.randomUUID()}`;
const finalizationBody = JSON.stringify({ expected_version: review.expected_version });
const finalization = await api(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/finalize`, {
  method: "POST", headers: writeHeaders(finalizationKey), body: finalizationBody,
});
const replayedFinalization = await apiResult(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/finalize`, {
  method: "POST", headers: writeHeaders(finalizationKey), body: finalizationBody,
});
if (!replayedFinalization.response.ok || replayedFinalization.response.headers.get("Idempotency-Replayed") !== "true") throw new Error("finalization idempotency replay failed");
let finalizationProgress;
for (let attempt = 0; attempt < 80; attempt += 1) {
  finalizationProgress = await api(`/api/material-master/import-batches/${batch.data.id}/reviews/${review.review_session_id}/finalization`);
  if (["FINALIZED", "FINALIZE_FAILED"].includes(finalizationProgress.data.review_session.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (finalizationProgress?.data?.review_session?.status !== "FINALIZED") throw new Error(`review finalization failed: ${JSON.stringify(finalizationProgress)}`);
const generatedDraftId = finalizationProgress.data.review_session.create_draft_rows
  ? Number((await pool.query("select material_draft_id from material_import_review_draft_links where review_session_id=$1", [review.review_session_id])).rows[0]?.material_draft_id)
  : 0;
const generatedDraft = await pool.query("select material_status,internal_material_code,submitted_at,approved_at from material_master where id=$1", [generatedDraftId]);
if (generatedDraft.rows[0]?.material_status !== "DRAFT" || generatedDraft.rows[0]?.internal_material_code != null || generatedDraft.rows[0]?.submitted_at != null || generatedDraft.rows[0]?.approved_at != null) {
  throw new Error("review-created material crossed the DRAFT/approval/code boundary");
}
const activeFixtureAfter = await pool.query("select standard_name,version from material_master where id=$1", [activeFixtureId]);
if (activeFixtureAfter.rows[0].standard_name !== activeFixture.rows[0].standard_name || activeFixtureAfter.rows[0].version !== activeFixture.rows[0].version) throw new Error("review binding changed ACTIVE material");
const reviewVersion2 = await api(`/api/material-master/import-batches/${batch.data.id}/reviews`, {
  method: "POST", headers: writeHeaders(`smoke-review-version2-${crypto.randomUUID()}`),
  body: JSON.stringify({ normalization_run_id: rerun.normalization_run_id, supersedes_review_session_id: review.review_session_id }),
});
const reviewHistory = await api(`/api/material-master/import-batches/${batch.data.id}/reviews/history?limit=20`);
if (reviewVersion2.data.review_version !== 2 || reviewHistory.items.length !== 2 || reviewHistory.items[1].status !== "FINALIZED") throw new Error("review version history mismatch");

const duplicateJobs = await pool.query(`
  select count(*)::integer count from background_jobs
  where type='material.import.normalize' and (payload->>'normalization_run_id')::bigint=$1
`, [rerun.normalization_run_id]);
if (duplicateJobs.rows[0].count !== 1) throw new Error("duplicate normalization job was persisted");
const materialAfterReview = await pool.query("select id,material_status,version from material_master order by id");
if (materialAfterReview.rows.length !== materialBefore.rows.length + 1) {
  throw new Error("review finalization did not create exactly one Material Draft");
}

await pool.query("update material_import_parse_runs set source_structure_digest=$2 where id=$1", [confirmed.mapping.parse_run_id, "9".repeat(64)]);
const staleSource = await apiResult(`/api/material-master/import-batches/${batch.data.id}/normalize`, {
  method: "POST",
  headers: writeHeaders(`smoke-normalization-stale-source-${crypto.randomUUID()}`),
  body: JSON.stringify({
    expected_version: cancelledSummary.current_version,
    mapping_version_id: confirmed.mapping.id,
    processor_version: "material-import-normalizer-v1",
    rerun_reason: "结构漂移必须拒绝",
  }),
});
if (staleSource.response.status !== 422 || staleSource.data.code !== "IMPORT_NORMALIZATION_SOURCE_SCHEMA_MISMATCH") throw new Error("changed source schema was not rejected");

console.info(JSON.stringify({
  ok: true,
  category_roots: categories.data.length,
  material_id: draft.data.material_id,
  batch_id: batch.data.id,
  parse_job_id: queued.data.job_id,
  rows: detail.data.batch.total_rows,
  mapping_version: confirmed.mapping.mapping_version,
  normalization_run_id: rerun.normalization_run_id,
  superseded_run_id: normalization.normalization_run_id,
  cancelled_run_id: cancelledRun.normalization_run_id,
  normalization_rows: normalizedRows.items.length,
  normalization_issues: normalizationIssues.items.length,
  normalization_history: history.items.length,
  review_session_id: review.review_session_id,
  review_version_2_id: reviewVersion2.data.review_session_id,
  finalization_job_id: finalization.job_id,
  generated_draft_id: generatedDraftId,
  bound_active_material_id: activeFixtureId,
  material_rows_unchanged_by_normalization: materialAfterNormalization.rows.length,
  material_rows_after_review: materialAfterReview.rows.length,
}));
await pool.end();
