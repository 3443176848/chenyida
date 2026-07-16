"use client";

import { useMemo, useState } from "react";
import { importCellText, importColumnReference, type ImportRawCell } from "../_lib/material-import";
import { MaterialImportDialog } from "./material-import-primitives";

export type MaterialImportSheet = {
  sheet_index: number; sheet_name: string; visibility: "VISIBLE" | "HIDDEN" | "VERY_HIDDEN"; parse_disposition: string;
  parsed_row_count: number; source_column_max: number; is_default_suggestion: boolean;
  header_suggestions: { row_number: number; rank: number; score: number; reason_codes: string[]; algorithm_version: string }[]; warnings: unknown[];
};
export type MaterialImportRow = { sheet_index: number; row_number: number; schema_version: number; source_column_count: number; cells: ImportRawCell[]; raw_row_hash: string };

function cellDetail(cell: ImportRawCell | undefined): string {
  if (!cell) return "该单元格未在稀疏行契约中提供。";
  if (cell.type === "FORMULA") return `公式，未执行\n公式文本：${cell.formula || cell.raw_value || ""}\n不可信缓存值：${cell.cached_value ?? "无"}`;
  if (cell.type === "DATE") return `原始值：${cell.raw_value ?? ""}\n日期系统：${cell.date_system || "未提供"}\n格式：${cell.format_code || "未提供"}\n解释状态：${cell.interpretation_status || "未提供"}\n解释值：${cell.interpreted_iso_value || "无"}`;
  if (cell.type === "ERROR") return `ERROR\n安全错误值：${cell.raw_value || "未知"}`;
  return `${cell.type}\n原始值：${cell.raw_value ?? ""}\n显示值：${cell.display ?? ""}`;
}

export function MaterialImportSheetSelector({ sheets, selected, disabled, onSelect }: { sheets: MaterialImportSheet[]; selected: number | null; disabled?: boolean; onSelect: (sheet: MaterialImportSheet) => void }) {
  return <div className="mi-sheet-selector" role="list" aria-label="Workbook Sheets">{[...sheets].sort((a, b) => a.sheet_index - b.sheet_index).map((sheet) => {
    const selectable = sheet.visibility === "VISIBLE" && sheet.parse_disposition === "PARSED";
    return <button type="button" role="listitem" key={sheet.sheet_index} className={selected === sheet.sheet_index ? "selected" : ""} disabled={disabled || !selectable} onClick={() => onSelect(sheet)}>
      <strong>{sheet.sheet_index} · {sheet.sheet_name}</strong><span>{sheet.visibility} · {selectable ? `${sheet.parsed_row_count} 行 / ${sheet.source_column_max} 列` : "仅安全元数据，不读取 Rows"}</span>{sheet.is_default_suggestion ? <small>建议</small> : null}
    </button>;
  })}</div>;
}

export function MaterialImportRowPreview({ rows, columnCount, page, pageSize, totalRows, loading, onPage, onPageSize }: {
  rows: MaterialImportRow[]; columnCount: number; page: number; pageSize: 20 | 50; totalRows: number; loading?: boolean;
  onPage: (page: number) => void; onPageSize: (pageSize: 20 | 50) => void;
}) {
  const columns = useMemo(() => Array.from({ length: Math.max(0, Math.min(256, columnCount)) }, (_, index) => index), [columnCount]);
  const [detail, setDetail] = useState<{ label: string; text: string } | null>(null); const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  return <section className="mi-rows-section"><div className="mi-rows-wrap" tabIndex={0} role="region" aria-label="原始行横向滚动表格">
    <table className="mi-rows-table" aria-rowcount={totalRows + 1} aria-colcount={columns.length + 1}><caption>当前 Sheet 原始行；公式不会执行</caption><thead><tr><th className="mi-row-number" scope="col">行号</th>{columns.map((index) => <th scope="col" key={index}>{importColumnReference(index)}</th>)}</tr></thead><tbody>
      {loading ? <tr><th className="mi-row-number" scope="row">—</th><td colSpan={Math.max(1, columns.length)}>正在加载 Rows…</td></tr> : null}
      {!loading && rows.map((row) => { const cells = new Map(row.cells.map((cell) => [cell.column_index, cell])); return <tr key={row.row_number}><th className="mi-row-number" scope="row">{row.row_number}</th>{columns.map((index) => { const cell = cells.get(index); const text = importCellText(cell); const expandable = text.length > 28 || ["DATE", "FORMULA", "ERROR"].includes(cell?.type || ""); return <td key={index} data-cell-type={cell?.type || "MISSING"}><span>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</span>{expandable ? <button className="mi-cell-expand" aria-label={`展开第 ${row.row_number} 行 ${importColumnReference(index)} 列详情`} onClick={() => setDetail({ label: `${importColumnReference(index)}${row.row_number}`, text: cellDetail(cell) })}>详情</button> : null}</td>; })}</tr>; })}
      {!loading && rows.length === 0 ? <tr><th className="mi-row-number" scope="row">—</th><td colSpan={Math.max(1, columns.length)}>当前页没有原始行</td></tr> : null}
    </tbody></table>
  </div><nav className="mi-row-pagination" aria-label="Rows 分页"><span>第 {page} / {totalPages} 页，共 {totalRows} 行</span><label>每页 <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value) as 20 | 50)}><option value="20">20</option><option value="50">50</option></select></label><button disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>上一页</button><button disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>下一页</button></nav>
    {detail ? <MaterialImportDialog title={`单元格 ${detail.label}`} primaryLabel="关闭" onPrimary={() => setDetail(null)} onClose={() => setDetail(null)}><pre className="mi-cell-detail">{detail.text}</pre></MaterialImportDialog> : null}
  </section>;
}
