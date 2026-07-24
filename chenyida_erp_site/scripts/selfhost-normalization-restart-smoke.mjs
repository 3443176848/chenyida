const base = process.env.ERP_SMOKE_BASE_URL || "http://web:3000";
const username = process.env.ERP_ADMIN_USERNAME || "";
const password = process.env.ERP_ADMIN_PASSWORD || "";
const batchId = Number(process.env.ERP_SMOKE_BATCH_ID);
const runId = Number(process.env.ERP_SMOKE_NORMALIZATION_RUN_ID);
if (process.env.ERP_ENV !== "test" || !username || !password || !Number.isSafeInteger(batchId) || !Number.isSafeInteger(runId)) {
  throw new Error("restart smoke requires test mode, credentials, batch id and normalization run id");
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
const summary = await api(`/api/material-master/import-batches/${batchId}/normalization`);
const history = await api(`/api/material-master/import-batches/${batchId}/normalization/runs?limit=20`);
const rows = await api(`/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}&limit=50`);
const issues = await api(`/api/material-master/import-batches/${batchId}/normalization-issues?run_id=${runId}&limit=100`);
if (summary.current_run?.id !== runId || summary.current_run.run_status !== "SUCCEEDED") throw new Error("published run pointer was not preserved");
if (history.items.length < 3 || !history.items.some((item) => item.run_status === "SUPERSEDED") || !history.items.some((item) => item.run_status === "CANCELLED")) {
  throw new Error("normalization history was not preserved");
}
if (!rows.items.length) throw new Error("published rows were not preserved");
const detail = await api(`/api/material-master/import-batches/${batchId}/normalized-rows/${rows.items[0].id}?run_id=${runId}`);
if (!detail.raw_row || !detail.field_candidates?.length || !detail.lineage?.length) throw new Error("row evidence was not preserved");
if (!issues.items.length) throw new Error("published issues were not preserved");
console.info(JSON.stringify({
  ok: true,
  batch_id: batchId,
  normalization_run_id: runId,
  rows: rows.items.length,
  issues: issues.items.length,
  history: history.items.length,
}));
