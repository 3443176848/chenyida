"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../public/erp/api-client.js";
import { normalizeImportUiError } from "../_lib/material-import";
import {
  MATERIAL_STANDARDIZATION_COLUMNS,
  materialStandardizationExportUrl,
  materialStandardizationPreviewUrl,
  type MaterialStandardizationResponse,
} from "../_lib/material-standardization";
import { redirectToExistingLogin } from "./material-shell";

export function MaterialStandardizationPreview({ batchId, onAdvancedMapping }: { batchId: number; onAdvancedMapping: () => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50>(50);
  const [data, setData] = useState<MaterialStandardizationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId: string } | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestSequence.current;
    setLoading(true); setError(null);
    try {
      const response = await api<MaterialStandardizationResponse>(materialStandardizationPreviewUrl(batchId, page, pageSize), { cache: "no-store" });
      if (current === requestSequence.current) setData(response);
    } catch (reason) {
      if (current !== requestSequence.current) return;
      const normalized = normalizeImportUiError(reason);
      if (normalized.status === 401) { redirectToExistingLogin(); return; }
      setData(null); setError({ message: normalized.message, requestId: normalized.requestId });
    } finally { if (current === requestSequence.current) setLoading(false); }
  }, [batchId, page, pageSize]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); requestSequence.current += 1; }; }, [load]);

  if (loading && !data) return <section className="mis-workbench" aria-busy="true"><p role="status">正在按 13 列标准整理来源数据…</p></section>;
  if (error && !data) return <section className="mis-workbench mis-error" role="alert"><h3>标准整理暂时不可用</h3><p>{error.message}</p>{error.requestId ? <p className="mm-request-id">请求编号：{error.requestId}</p> : null}<div className="mis-actions"><button onClick={() => void load()}>重试</button><button onClick={onAdvancedMapping}>检查高级字段 Mapping</button></div></section>;
  if (!data) return null;
  const issueRows = data.rows.filter((row) => row.issues.length > 0);
  return <section className="mis-workbench" aria-labelledby="mis-heading">
    <header className="mis-head"><div><h3 id="mis-heading">13 列标准物料整理</h3><p>系统按今天确认的模板整理；这是可审阅预览，不代表已经写入正式物料库。</p></div><span className={`mis-profile ${data.profile.ready ? "ready" : "pending"}`}>{data.profile.label}</span></header>
    <div className="mis-rule-note"><strong>{data.standard_version}</strong><span>需求数量 = 用量 × 订单数量；购买数量 = max(需求数量 − 库存数, 0)。未知值保持空白。</span></div>
    {!data.profile.ready ? <div className="mis-warning" role="status"><strong>当前结果为临时整理。</strong><span>来源结构还没有人工确认；请核对表头与高级字段 Mapping 后再用于后续审核。</span></div> : null}
    {data.global_issues.length ? <ul className="mis-global-issues">{data.global_issues.map((item) => <li key={item.code}><code>{item.code}</code>：{item.message}</li>)}</ul> : null}
    <dl className="mis-facts"><div><dt>来源文件</dt><dd>{data.source.filename}</dd></div><div><dt>来源 Sheet</dt><dd>{data.source.sheet_name}</dd></div><div><dt>整理结果</dt><dd>{data.summary.standardized_row_count} 行</dd></div><div><dt>折叠替代料</dt><dd>{data.summary.folded_alternative_count} 行</dd></div><div><dt>待核对行</dt><dd>{data.summary.issue_row_count} 行</dd></div><div><dt>错误 / 提醒</dt><dd>{data.summary.error_count} / {data.summary.warning_count}</dd></div></dl>
    <div className="mis-actions"><a className="mis-download" href={materialStandardizationExportUrl(batchId)} download>下载 13 列 CSV</a><button onClick={onAdvancedMapping}>高级字段 Mapping</button><button onClick={() => void load()} disabled={loading}>{loading ? "正在刷新…" : "刷新整理结果"}</button></div>
    <div className="mis-table-wrap" tabIndex={0} aria-label="13 列标准物料整理表，可横向滚动">
      <table><caption>按 CYD-MATERIAL-13C-v1 整理的物料预览</caption><thead><tr>{MATERIAL_STANDARDIZATION_COLUMNS.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{data.rows.map((row) => <tr key={`${row.source_row_number}-${row.sequence}`} className={row.issues.some((item) => item.level === "ERROR") ? "has-error" : row.issues.length ? "has-warning" : ""}>{MATERIAL_STANDARDIZATION_COLUMNS.map((column) => <td key={column.key} title={row.values[column.key] || "空白（来源无法证明）"}>{row.values[column.key] || <span aria-label="空白">—</span>}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {!data.rows.length ? <p className="mis-empty">当前页没有可整理的物料行。空白行、标题行和重复表头不会伪装成物料。</p> : null}
    <nav className="mis-pagination" aria-label="标准整理分页"><label>每页<select value={pageSize} onChange={(event) => { setPageSize(event.target.value === "20" ? 20 : 50); setPage(1); }}><option value="20">20</option><option value="50">50</option></select></label><span>第 {data.pagination.page} / {data.pagination.total_pages} 页，共 {data.pagination.total_rows} 行</span><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button disabled={page >= data.pagination.total_pages || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
    {issueRows.length ? <details className="mis-row-issues"><summary>查看当前页 {issueRows.length} 行的待核对问题</summary><ul>{issueRows.map((row) => <li key={row.source_row_number}><strong>原始第 {row.source_row_number} 行</strong>{row.alternative_source_rows.length ? `（含替代行 ${row.alternative_source_rows.join("、")}）` : ""}<ul>{row.issues.map((item) => <li key={`${item.code}-${item.message}`}><code>{item.code}</code>：{item.message}</li>)}</ul></li>)}</ul></details> : null}
    <footer className="mis-boundary"><strong>后续边界：</strong>先确认整理结果，再走现有数据归一化和物料审核；本页不会自动确认 Mapping、创建 Draft、批准物料或生成正式内部料号。</footer>
  </section>;
}
