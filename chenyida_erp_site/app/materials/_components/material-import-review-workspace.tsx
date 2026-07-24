"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../public/erp/api-client.js";
import { normalizeImportUiError, type ImportUiError, type MaterialImportBatch } from "../_lib/material-import";

type ReviewSession = {
  review_session_id: number; normalization_run_id: number; normalization_run_version: number;
  review_version: number; status: string; total_rows: number; pending_rows: number; reviewed_rows: number;
  kept_rows: number; excluded_rows: number; bind_existing_rows: number; create_draft_rows: number;
  completed_rows: number; failed_rows: number; expected_version: number;
};
type ReviewRow = {
  review_row_id: number; normalized_row_id: number; source_row_number: number; normalization_row_status: string;
  error_count: number; warning_count: number; row_status: string; disposition: string;
  existing_material_id: number | null; material_draft_id: number | null; expected_version: number;
  failure_code: string | null; failure_message_safe: string | null;
};
type RowBundle = {
  row: ReviewRow; raw: { raw_values?: unknown } | null;
  field_candidates: { target_field_code: string; raw_value: unknown; normalized_value: unknown; validation_status: string }[];
  attribute_candidates: { attribute_code: string; attribute_name_snapshot: string; data_type: string; raw_value: unknown; normalized_value: unknown; unit_code: string | null }[];
  field_overrides: { target_field_code: string; value_semantics: string; override_value: unknown; revision_number: number }[];
  attribute_overrides: { attribute_code: string; value_semantics: string; override_value: unknown; revision_number: number }[];
  normalization_issues: { id: number; issue_level: string; issue_code: string; safe_message: string }[];
  issue_resolutions: { normalization_issue_id: number; resolution_status: string }[];
  review_validation_issues: { id: number; issue_level: string; issue_code: string; safe_message: string }[];
  lineage: Record<string, unknown>[];
  effective_values: { fields: Record<string, unknown>; attributes: Record<string, { value: unknown; unit: string | null }> };
};
type ActiveMaterial = { id: number; internal_material_code: string; standard_name: string; category_id: number; brand: string; manufacturer_part_number: string; version: number };

const jsonValue = (value: unknown) => value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);

export function MaterialImportReviewWorkspace({ batchId, batch, permissions, csrfToken }: {
  batchId: number; batch: MaterialImportBatch; permissions: string[]; csrfToken: string;
}) {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [history, setHistory] = useState<ReviewSession[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null);
  const [afterId, setAfterId] = useState(0);
  const [rowStatus, setRowStatus] = useState("");
  const [disposition, setDisposition] = useState("");
  const [issueLevel, setIssueLevel] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [detail, setDetail] = useState<RowBundle | null>(null);
  const [fieldCode, setFieldCode] = useState("STANDARD_NAME");
  const [fieldValue, setFieldValue] = useState("");
  const [attributeCode, setAttributeCode] = useState("");
  const [attributeValue, setAttributeValue] = useState("");
  const [comment, setComment] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [materials, setMaterials] = useState<ActiveMaterial[]>([]);
  const [progress, setProgress] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImportUiError | null>(null);
  const [notice, setNotice] = useState("");
  const canCreate = permissions.includes("*") || permissions.includes("material.import.review.create");
  const canEdit = permissions.includes("*") || permissions.includes("material.import.review.edit");
  const canDecide = permissions.includes("*") || permissions.includes("material.import.review.decide");
  const canBulk = permissions.includes("*") || permissions.includes("material.import.review.bulk");
  const canFinalize = permissions.includes("*") || permissions.includes("material.import.review.finalize");

  const handleError = useCallback((reason: unknown) => {
    const value = normalizeImportUiError(reason);
    setError(value);
    if (value.status === 409) setNotice("数据已被其他用户修改（409）。页面没有覆盖新状态，请刷新后继续。");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api<{ data: ReviewSession | null }>(`/api/material-master/import-batches/${batchId}/reviews/current`, { cache: "no-store" });
      setSession(response.data); setError(null);
      if (response.data) {
        const versions = await api<{ items: ReviewSession[] }>(`/api/material-master/import-batches/${batchId}/reviews/history?limit=50`, { cache: "no-store" });
        setHistory(versions.items);
      }
    } catch (reason) { handleError(reason); }
  }, [batchId, handleError]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const loadRows = useCallback(async () => {
    if (!session) return;
    const query = new URLSearchParams({ after_id: String(afterId), limit: "50" });
    if (rowStatus) query.set("row_status", rowStatus);
    if (disposition) query.set("disposition", disposition);
    if (issueLevel) query.set("issue_level", issueLevel);
    try {
      const response = await api<{ items: ReviewRow[]; next_after_id: number | null }>(`/api/material-master/import-batches/${batchId}/reviews/${session.review_session_id}/rows?${query}`, { cache: "no-store" });
      setRows(response.items); setNextAfter(response.next_after_id); setSelected([]);
      const requested = Number(new URLSearchParams(window.location.search).get("review_row"));
      if (Number.isSafeInteger(requested) && requested > 0) {
        const row = response.items.find((item) => item.review_row_id === requested);
        if (row) {
          const bundle = await api<{ data: RowBundle }>(`/api/material-master/import-batches/${batchId}/reviews/${session.review_session_id}/rows/${row.review_row_id}`, { cache: "no-store" });
          setDetail(bundle.data);
        }
      }
    } catch (reason) { handleError(reason); }
  }, [afterId, batchId, disposition, handleError, issueLevel, rowStatus, session]);
  useEffect(() => { const timer = window.setTimeout(() => void loadRows(), 0); return () => window.clearTimeout(timer); }, [loadRows]);

  const pollingSessionId = session?.review_session_id;
  const pollingStatus = session?.status;
  useEffect(() => {
    if (!pollingSessionId || !pollingStatus || !["FINALIZING", "FINALIZE_FAILED", "FINALIZED"].includes(pollingStatus)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await api<{ data: Record<string, unknown> }>(`/api/material-master/import-batches/${batchId}/reviews/${pollingSessionId}/finalization`, { cache: "no-store" });
        if (!stopped) { setProgress(response.data); await refresh(); }
      } catch (reason) { if (!stopped) handleError(reason); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [batchId, handleError, pollingSessionId, pollingStatus, refresh]);

  const write = async <T,>(endpoint: string, body: Record<string, unknown>): Promise<T> => api<T>(endpoint, {
    method: "POST", body: JSON.stringify(body),
    protectedWrite: { csrfToken, idempotencyKey: crypto.randomUUID() },
  });

  const createSession = async (supersedes?: number) => {
    setBusy(true);
    try {
      let runId = Number(new URLSearchParams(window.location.search).get("run_id"));
      if (!Number.isSafeInteger(runId) || runId < 1) {
        const normalization = await api<{ current_run: { id: number } | null }>(`/api/material-master/import-batches/${batchId}/normalization`, { cache: "no-store" });
        runId = Number(normalization.current_run?.id);
      }
      if (!Number.isSafeInteger(runId) || runId < 1) throw Object.assign(new Error("没有可复核的已发布 Normalization Run"), { status: 422, code: "IMPORT_REVIEW_NORMALIZATION_NOT_PUBLISHED" });
      const response = await write<{ data: ReviewSession }>(`/api/material-master/import-batches/${batchId}/reviews`, {
        normalization_run_id: runId,
        ...(supersedes ? { supersedes_review_session_id: supersedes } : {}),
      });
      setSession(response.data); setNotice(`已创建复核 v${response.data.review_version}，固定引用 Normalization Run ${response.data.normalization_run_id}。`);
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  const openRow = async (row: ReviewRow) => {
    try {
      const response = await api<{ data: RowBundle }>(`/api/material-master/import-batches/${batchId}/reviews/${session!.review_session_id}/rows/${row.review_row_id}`, { cache: "no-store" });
      setDetail(response.data); setComment(row.failure_message_safe || "");
      const url = new URL(window.location.href); url.searchParams.set("view", "review"); url.searchParams.set("row", String(row.normalized_row_id)); url.searchParams.set("review_row", String(row.review_row_id)); window.history.pushState({}, "", url);
    } catch (reason) { handleError(reason); }
  };

  const closeRow = () => {
    setDetail(null);
    const url = new URL(window.location.href); url.searchParams.delete("row"); url.searchParams.delete("review_row"); window.history.replaceState({}, "", url);
  };

  const mutateRow = async (kind: "field" | "attribute" | "decision" | "issue", body: Record<string, unknown>, issueId?: number) => {
    if (!session || !detail) return;
    setBusy(true);
    const endpoint = kind === "field" ? "field-overrides" : kind === "attribute" ? "attribute-overrides" : kind === "decision" ? "decision" : `issues/${issueId}/resolution`;
    try {
      await write(`/api/material-master/import-batches/${batchId}/reviews/${session.review_session_id}/rows/${detail.row.review_row_id}/${endpoint}`, {
        expected_session_version: session.expected_version, expected_row_version: detail.row.expected_version, ...body,
      });
      await refresh(); await loadRows(); await openRow(detail.row); setNotice("复核修改已保存；原始行和 Normalization 候选未被覆盖。");
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  const parseInput = (value: string): unknown => {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return value;
  };

  const searchMaterials = async () => {
    try {
      const response = await api<{ items: ActiveMaterial[] }>(`/api/material-master/import-batches/${batchId}/reviews/active-materials?q=${encodeURIComponent(materialQuery.trim())}&page=1&page_size=20`, { cache: "no-store" });
      setMaterials(response.items);
    } catch (reason) { handleError(reason); }
  };

  const bulk = async (choice: "KEEP" | "EXCLUDE") => {
    if (!session || !selected.length) return;
    setBusy(true);
    try {
      await write(`/api/material-master/import-batches/${batchId}/reviews/${session.review_session_id}/bulk-decision`, {
        expected_session_version: session.expected_version, review_row_ids: selected, disposition: choice,
        decision_reason_code: choice === "EXCLUDE" ? "USER_EXCLUDED" : "", decision_comment: choice === "EXCLUDE" ? comment || "批量人工排除" : comment,
      });
      await refresh(); await loadRows();
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (!session || !window.confirm(`最终提交复核 v${session.review_version}：排除 ${session.excluded_rows}，绑定 ${session.bind_existing_rows}，创建 DRAFT ${session.create_draft_rows}。继续？`)) return;
    setBusy(true);
    try {
      await write(`/api/material-master/import-batches/${batchId}/reviews/${session.review_session_id}/finalize`, { expected_version: session.expected_version });
      setNotice("最终处理已进入后台 Worker。重复点击不会重复绑定或建稿。"); await refresh();
    } catch (reason) { handleError(reason); } finally { setBusy(false); }
  };

  const resolutionByIssue = useMemo(() => new Map(detail?.issue_resolutions.map((item) => [Number(item.normalization_issue_id), item.resolution_status]) ?? []), [detail]);

  if (!session) return <section className="min-review" data-review-workspace><h2>Normalization 人工复核</h2>
    <p>人工复核固定引用一个已发布 Normalization Run；不会修改 Parser 原始行、Mapping 快照或机器候选。</p>
    {error ? <p role="alert">{error.message}</p> : null}
    {canCreate ? <button disabled={busy} onClick={() => void createSession()}>创建复核会话</button> : <p>当前账号只有查看权限，尚无复核会话。</p>}
  </section>;

  const readOnly = ["FINALIZING", "FINALIZED", "FINALIZE_FAILED", "CANCELLED"].includes(session.status);
  return <section className="min-review" data-review-workspace>
    <header><h2>{batch.batch_no} · Normalization 人工复核 · v{session.review_version}</h2><p>Run {session.normalization_run_id} / v{session.normalization_run_version} · {session.status} · CAS {session.expected_version}</p></header>
    {notice ? <div role="status" className="min-banner">{notice}</div> : null}
    {error ? <div role="alert" className="min-banner min-banner-error"><strong>{error.message}</strong>{error.requestId ? <p>请求编号：{error.requestId}</p> : null}<button onClick={() => void refresh()}>刷新权威状态</button></div> : null}
    <div className="min-metrics"><span>待复核 <strong>{session.pending_rows}</strong></span><span>已复核 <strong>{session.reviewed_rows}</strong></span><span>排除 <strong>{session.excluded_rows}</strong></span><span>绑定 ACTIVE <strong>{session.bind_existing_rows}</strong></span><span>待建 DRAFT <strong>{session.create_draft_rows}</strong></span><span>失败 <strong>{session.failed_rows}</strong></span></div>
    <details><summary>复核历史版本（只读）</summary><ul>{history.map((item) => <li key={item.review_session_id}>v{item.review_version} · {item.status} · Run {item.normalization_run_id}{item.review_session_id !== session.review_session_id ? "（历史）" : "（当前）"}</li>)}</ul>{["FINALIZED", "FINALIZE_FAILED"].includes(session.status) && canCreate ? <button disabled={busy} onClick={() => void createSession(session.review_session_id)}>基于同一 Run 创建新复核版本</button> : null}</details>
    <div className="min-filters">
      <label>行状态<select value={rowStatus} onChange={(e) => { setAfterId(0); setRowStatus(e.target.value); }}><option value="">全部</option><option>PENDING</option><option>REVIEWED</option><option>COMPLETED</option><option>FAILED</option></select></label>
      <label>最终决定<select value={disposition} onChange={(e) => { setAfterId(0); setDisposition(e.target.value); }}><option value="">全部</option><option>PENDING</option><option>KEEP</option><option>EXCLUDE</option><option>BIND_EXISTING</option><option>CREATE_DRAFT</option></select></label>
      <label>问题<select value={issueLevel} onChange={(e) => { setAfterId(0); setIssueLevel(e.target.value); }}><option value="">全部</option><option>ERROR</option><option>WARNING</option></select></label>
    </div>
    <div className="min-table-wrap"><table><caption>服务端分页复核行</caption><thead><tr><th>选择</th><th>来源行</th><th>Normalization</th><th>复核状态</th><th>决定</th><th>问题</th><th>结果</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.review_row_id}>
      <td><input type="checkbox" disabled={readOnly} checked={selected.includes(row.review_row_id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, row.review_row_id] : current.filter((id) => id !== row.review_row_id))} /></td>
      <td>{row.source_row_number}</td><td>{row.normalization_row_status}</td><td>{row.row_status}</td><td>{row.disposition}</td><td>{row.error_count} ERROR / {row.warning_count} WARNING</td>
      <td>{row.material_draft_id ? <Link href={`/materials/${row.material_draft_id}`}>DRAFT #{row.material_draft_id}</Link> : row.existing_material_id ? <Link href={`/materials/${row.existing_material_id}`}>ACTIVE #{row.existing_material_id}</Link> : row.failure_message_safe || "—"}</td>
      <td><button onClick={() => void openRow(row)}>复核详情</button></td>
    </tr>)}</tbody></table></div>
    <div className="min-page-actions"><button disabled={afterId === 0} onClick={() => setAfterId(0)}>首页</button><button disabled={!nextAfter} onClick={() => setAfterId(nextAfter || 0)}>下一页</button></div>
    {canBulk && !readOnly ? <div className="min-actions"><label>批量备注<input value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label><button disabled={!selected.length || busy} onClick={() => void bulk("KEEP")}>批量保留</button><button disabled={!selected.length || busy} onClick={() => void bulk("EXCLUDE")}>批量排除</button></div> : null}
    <section><h3>最终提交</h3><p>KEEP 只是“保留待决定”，最终提交前必须改为精确绑定 ACTIVE 或创建 Material Draft；未解决 ERROR 和未确认 WARNING 会阻止提交。</p>
      {canFinalize && !readOnly ? <button className="mi-primary" disabled={busy} onClick={() => void finalize()}>验证并最终提交</button> : null}
      {progress ? <pre aria-label="finalization 进度">{JSON.stringify(progress, null, 2)}</pre> : null}
      {session.status === "FINALIZE_FAILED" && (permissions.includes("*") || permissions.includes("material.import.review.retry")) ? <button disabled={busy} onClick={async () => { try { await write(`/api/material-master/import-batches/${batchId}/reviews/${session.review_session_id}/finalization/retry`, { expected_version: session.expected_version }); await refresh(); } catch (reason) { handleError(reason); } }}>安全重试失败行</button> : null}
    </section>
    {detail ? <div className="min-drawer-backdrop"><aside className="min-drawer" role="dialog" aria-modal="true" aria-labelledby="mir-row-title"><header><h3 id="mir-row-title">来源行 {detail.row.source_row_number} · 三层值复核</h3><button onClick={closeRow}>关闭</button></header><div className="min-drawer-body">
      <section><h4>不可变 Parser 原始值</h4><pre>{JSON.stringify(detail.raw?.raw_values ?? null, null, 2)}</pre></section>
      <section><h4>Normalization 候选 / 人工最终值</h4><div className="min-table-wrap"><table><thead><tr><th>字段</th><th>候选</th><th>人工最终值</th><th>覆盖语义</th></tr></thead><tbody>{detail.field_candidates.map((candidate) => {
        const override = detail.field_overrides.find((item) => item.target_field_code === candidate.target_field_code);
        return <tr key={candidate.target_field_code}><td><code>{candidate.target_field_code}</code></td><td>{jsonValue(candidate.normalized_value)}</td><td>{jsonValue(detail.effective_values.fields[candidate.target_field_code])}</td><td>{override?.value_semantics ?? "无覆盖"}</td></tr>;
      })}</tbody></table></div>
      {canEdit && !readOnly ? <div className="min-filters"><label>核心字段<input value={fieldCode} onChange={(e) => setFieldCode(e.target.value.toUpperCase())} /></label><label>值<input value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} /></label><button disabled={busy} onClick={() => void mutateRow("field", { target_field_code: fieldCode, value_semantics: "SET", override_value: parseInput(fieldValue), reason_code: "MANUAL_CORRECTION", comment })}>保存覆盖</button><button disabled={busy} onClick={() => void mutateRow("field", { target_field_code: fieldCode, value_semantics: "CLEAR", reason_code: "MANUAL_CLEAR", comment })}>显式清空</button><button disabled={busy} onClick={() => void mutateRow("field", { target_field_code: fieldCode, value_semantics: "REVERT", reason_code: "RESTORE_CANDIDATE", comment })}>恢复候选</button></div> : null}</section>
      <section><h4>动态属性（稳定 attribute_code）</h4><div className="min-table-wrap"><table><thead><tr><th>Code</th><th>候选</th><th>人工最终值</th></tr></thead><tbody>{detail.attribute_candidates.map((candidate) => <tr key={candidate.attribute_code}><td><code>{candidate.attribute_code}</code></td><td>{jsonValue(candidate.normalized_value)}</td><td>{jsonValue(detail.effective_values.attributes[candidate.attribute_code]?.value)}</td></tr>)}</tbody></table></div>
      {canEdit && !readOnly ? <div className="min-filters"><label>Attribute Code<input value={attributeCode} onChange={(e) => setAttributeCode(e.target.value.toUpperCase())} /></label><label>值<input value={attributeValue} onChange={(e) => setAttributeValue(e.target.value)} /></label><button onClick={() => void mutateRow("attribute", { attribute_code: attributeCode, value_semantics: "SET", override_value: parseInput(attributeValue), reason_code: "MANUAL_CORRECTION", comment })}>保存属性覆盖</button><button onClick={() => void mutateRow("attribute", { attribute_code: attributeCode, value_semantics: "CLEAR", reason_code: "MANUAL_CLEAR", comment })}>显式清空</button><button onClick={() => void mutateRow("attribute", { attribute_code: attributeCode, value_semantics: "REVERT", reason_code: "RESTORE_CANDIDATE", comment })}>恢复候选</button></div> : null}</section>
      <section><h4>Issues 与确认</h4>{detail.normalization_issues.map((issue) => <article key={issue.id}><strong>{issue.issue_level} · {issue.issue_code}</strong><p>{issue.safe_message}</p><p>处理状态：{resolutionByIssue.get(issue.id) ?? "UNRESOLVED"}</p>{issue.issue_level === "WARNING" && canEdit && !readOnly ? <button onClick={() => void mutateRow("issue", { resolution_status: "WARNING_ACKNOWLEDGED", resolution_code: "WARNING_REVIEWED", comment }, issue.id)}>确认 WARNING</button> : null}{issue.issue_level === "ERROR" && canEdit && !readOnly ? <button onClick={() => void mutateRow("issue", { resolution_status: "RESOLVED_BY_OVERRIDE", resolution_code: "OVERRIDE_REVALIDATED", comment }, issue.id)}>标记由人工覆盖解决</button> : null}</article>)}
      {detail.review_validation_issues.map((issue) => <p role="alert" key={issue.id}>{issue.issue_level} · {issue.issue_code} · {issue.safe_message}</p>)}</section>
      <section><h4>Lineage（按需读取）</h4><pre>{JSON.stringify(detail.lineage, null, 2)}</pre></section>
      {canDecide && !readOnly ? <section><h4>最终决定</h4><label>原因或备注<textarea value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label><div className="min-actions"><button onClick={() => void mutateRow("decision", { disposition: "KEEP", decision_comment: comment })}>保留待决定</button><button onClick={() => void mutateRow("decision", { disposition: "EXCLUDE", decision_reason_code: "USER_EXCLUDED", decision_comment: comment || "人工排除" })}>排除</button><button onClick={() => void mutateRow("decision", { disposition: "CREATE_DRAFT", decision_comment: comment })}>最终提交时创建 Material Draft</button></div>
        <div className="min-filters"><label>精确搜索 ACTIVE 物料<input value={materialQuery} onChange={(e) => setMaterialQuery(e.target.value)} /></label><button onClick={() => void searchMaterials()}>搜索</button></div>
        <ul>{materials.map((material) => <li key={material.id}><code>{material.internal_material_code}</code> · {material.standard_name} · {material.manufacturer_part_number || "无 MPN"} <button onClick={() => void mutateRow("decision", { disposition: "BIND_EXISTING", existing_material_id: material.id, decision_comment: comment })}>明确绑定此 ACTIVE</button></li>)}</ul>
      </section> : null}
    </div></aside></div> : null}
    <p>本页面没有创建 ACTIVE、自动审批、自动编码、自动匹配或 AI 修正入口。新建结果只会进入现有 Material DRAFT 流程。</p>
  </section>;
}
