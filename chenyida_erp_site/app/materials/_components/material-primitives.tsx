"use client";

import { presentMaterialError, statusLabel, type MaterialErrorPresentation } from "../_lib/material-ui";
import Link from "next/link";

export function MaterialStatusBadge({ value }: { value: unknown }) {
  const code = String(value || "UNKNOWN");
  return <span className={`mm-status mm-status-${code.toLowerCase().replaceAll("_", "-")}`} aria-label={`物料状态：${statusLabel(code)}`}>{statusLabel(code)}</span>;
}

export function MaterialErrorState({ error, onRetry, onReset }: {
  error: { status?: number; code?: string; requestId?: string } | null;
  onRetry?: () => void;
  onReset?: () => void;
}) {
  const view: MaterialErrorPresentation = presentMaterialError(error);
  return (
    <section className="mm-error-state" role="alert" aria-live="assertive">
      <h2>{view.title}</h2>
      <p>{view.message}</p>
      {view.requestId ? <p className="mm-request-id">请求编号：{view.requestId}</p> : null}
      <div className="mm-inline-actions">
        {onRetry ? <button onClick={onRetry}>重试</button> : null}
        {view.canReset && onReset ? <button onClick={onReset}>清除筛选并恢复默认</button> : null}
        {!onRetry && !onReset ? <Link href="/materials">返回物料列表</Link> : null}
      </div>
    </section>
  );
}

export type PaginationValue = { page: number; page_size: number; total: number; total_pages: number };

export function MaterialPagination({ value, pageSizes, disabled, onChange }: {
  value: PaginationValue;
  pageSizes: readonly number[];
  disabled?: boolean;
  onChange: (page: number, pageSize: number) => void;
}) {
  const last = value.total_pages;
  const start = Math.max(1, Math.min(value.page - 2, Math.max(1, last - 4)));
  const pages = Array.from({ length: Math.max(0, Math.min(5, last)) }, (_, index) => start + index).filter((page) => page <= last);
  return (
    <nav className="mm-pagination" aria-label="分页">
      <span>共 {value.total} 条</span>
      <label>每页 <select value={value.page_size} disabled={disabled} onChange={(event) => onChange(1, Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      <span>第 {last === 0 ? 0 : value.page} / {last} 页</span>
      <button disabled={disabled || value.page <= 1} onClick={() => onChange(value.page - 1, value.page_size)}>上一页</button>
      {pages.map((page) => <button key={page} className={page === value.page ? "active" : ""} aria-current={page === value.page ? "page" : undefined} disabled={disabled} onClick={() => onChange(page, value.page_size)}>{page}</button>)}
      <button disabled={disabled || last === 0 || value.page >= last} onClick={() => onChange(value.page + 1, value.page_size)}>下一页</button>
    </nav>
  );
}

export function LoadingRows({ columns = 10 }: { columns?: number }) {
  return <>{Array.from({ length: 10 }, (_, index) => <tr className="mm-skeleton-row" aria-hidden="true" key={index}>{Array.from({ length: columns }, (__, cell) => <td key={cell}><span /></td>)}</tr>)}</>;
}
