import { Pool } from "pg";

const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const username = process.env.ERP_ADMIN_USERNAME || "";
const password = process.env.ERP_ADMIN_PASSWORD || "";
const databaseUrl = process.env.DATABASE_URL || "";
const batchId = Number(process.env.ERP_SMOKE_BATCH_ID);
const runId = Number(process.env.ERP_SMOKE_NORMALIZATION_RUN_ID);
const reviewSessionId = Number(process.env.ERP_SMOKE_REVIEW_SESSION_ID);
const materialDraftId = Number(process.env.ERP_SMOKE_MATERIAL_DRAFT_ID);
const activeMaterialId = Number(process.env.ERP_SMOKE_ACTIVE_MATERIAL_ID);
if (
  process.env.ERP_ENV !== "test"
  || !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)
  || !username
  || !password
  || ![batchId, runId, reviewSessionId, materialDraftId, activeMaterialId].every(Number.isSafeInteger)
) {
  throw new Error("review restart smoke requires isolated test mode, credentials and persisted ids");
}

let cookie = "";
async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (setCookies.length) cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

await api("/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const history = await api(`/api/material-master/import-batches/${batchId}/reviews/history?limit=20`);
const rows = await api(`/api/material-master/import-batches/${batchId}/reviews/${reviewSessionId}/rows?limit=50`);
const progress = await api(`/api/material-master/import-batches/${batchId}/reviews/${reviewSessionId}/finalization`);
if (history.items.length < 2 || history.items[0].review_version !== 2 || history.items[1].review_version !== 1) {
  throw new Error("review version history was not preserved");
}
if (progress.data.review_session.status !== "FINALIZED" || progress.data.review_session.completed_rows !== rows.items.length) {
  throw new Error("finalized review state was not preserved");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "selfhost-review-restart-smoke" });
try {
  const persisted = await pool.query(`
    select
      (select count(*)::integer from material_import_rows where batch_id=$1) parser_rows,
      (select count(*)::integer from material_import_normalized_rows where normalization_run_id=$2) normalized_rows,
      (select count(*)::integer from material_import_review_material_bindings where review_session_id=$3 and material_id=$4) bindings,
      (select count(*)::integer from material_import_review_draft_links where review_session_id=$3 and material_draft_id=$5) draft_links
  `, [batchId, runId, reviewSessionId, activeMaterialId, materialDraftId]);
  const draft = await pool.query(
    "select material_status,internal_material_code,submitted_at,approved_at from material_master where id=$1",
    [materialDraftId],
  );
  const active = await pool.query("select material_status from material_master where id=$1", [activeMaterialId]);
  const facts = persisted.rows[0];
  if (facts.parser_rows < rows.items.length || facts.normalized_rows !== rows.items.length || facts.bindings !== 1 || facts.draft_links !== 1) {
    throw new Error(`persisted review relations mismatch: ${JSON.stringify(facts)}`);
  }
  if (
    draft.rows[0]?.material_status !== "DRAFT"
    || draft.rows[0]?.internal_material_code != null
    || draft.rows[0]?.submitted_at != null
    || draft.rows[0]?.approved_at != null
  ) {
    throw new Error("persisted Material Draft crossed the approval/code boundary");
  }
  if (active.rows[0]?.material_status !== "ACTIVE") throw new Error("persisted binding target is no longer ACTIVE");
  console.info(JSON.stringify({
    ok: true,
    batch_id: batchId,
    normalization_run_id: runId,
    review_session_id: reviewSessionId,
    review_versions: history.items.length,
    review_rows: rows.items.length,
    material_draft_id: materialDraftId,
    active_material_id: activeMaterialId,
  }));
} finally {
  await pool.end();
}
