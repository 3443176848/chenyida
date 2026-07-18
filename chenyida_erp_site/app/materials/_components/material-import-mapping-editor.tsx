"use client";

import { useMemo } from "react";
import { duplicateMappingSources, importCellText, importColumnReference, requiredMappingTargetsMissing, type ImportMappingItem, type ImportMappingTarget } from "../_lib/material-import";
import type { MaterialImportRow } from "./material-import-row-preview";

export function MaterialImportTargetSelector({ sourceIndex, value, targets, invalid, disabled, onChange }: {
  sourceIndex: number; value: ImportMappingItem | null; targets: ImportMappingTarget[]; invalid?: boolean; disabled?: boolean; onChange: (target: ImportMappingTarget | null) => void;
}) {
  const selected = value ? `${value.target_namespace}\u0000${value.target_code}` : "";
  return <select aria-label={`${importColumnReference(sourceIndex)} 列目标字段`} aria-invalid={invalid || undefined} disabled={disabled} value={selected} onChange={(event) => {
    const target = targets.find((item) => `${item.target_namespace}\u0000${item.target_code}` === event.target.value) || null; onChange(target);
  }}><option value="">尚未处理</option>{["BASIC", "ATTRIBUTE", "SPECIAL"].map((group) => <optgroup label={group} key={group}>{targets.filter((target) => target.group_code === group).map((target) => <option value={`${target.target_namespace}\u0000${target.target_code}`} key={`${target.target_namespace}.${target.target_code}`}>{target.display_name}（{target.target_code}）</option>)}</optgroup>)}</select>;
}

function sourceHeader(rows: MaterialImportRow[], sourceIndex: number, headerMode: "SINGLE_ROW" | "NO_HEADER", headerRow: number | null): string | null {
  if (headerMode === "NO_HEADER" || headerRow === null) return null;
  const row = rows.find((item) => item.row_number === headerRow); const cell = row?.cells.find((item) => item.column_index === sourceIndex);
  return cell ? importCellText(cell) : null;
}

function samples(rows: MaterialImportRow[], sourceIndex: number, headerMode: "SINGLE_ROW" | "NO_HEADER", headerRow: number | null): string[] {
  const start = headerMode === "SINGLE_ROW" && headerRow !== null ? headerRow + 1 : 1;
  return rows.filter((row) => row.row_number >= start).map((row) => importCellText(row.cells.find((cell) => cell.column_index === sourceIndex))).filter((value) => !["未提供", "空单元格"].includes(value)).slice(0, 3);
}

export function MaterialImportMappingEditor({ columnCount, rows, headerMode, headerRow, targets, catalogQuery, catalogHasMore, items, dirty, readOnly, busy, previewValid, onCatalogQuery, onCatalogMore, onItems, onReset, onSave, onPreview, onConfirm }: {
  columnCount: number; rows: MaterialImportRow[]; headerMode: "SINGLE_ROW" | "NO_HEADER"; headerRow: number | null;
  targets: ImportMappingTarget[]; catalogQuery: string; catalogHasMore: boolean; items: ImportMappingItem[]; dirty: boolean; readOnly: boolean; busy: boolean; previewValid: boolean;
  onCatalogQuery: (query: string) => void; onCatalogMore: () => void; onItems: (items: ImportMappingItem[]) => void; onReset: () => void; onSave: () => void; onPreview: () => void; onConfirm: () => void;
}) {
  const bySource = useMemo(() => new Map(items.filter((item) => item.source_column_index !== null).map((item) => [item.source_column_index as number, item])), [items]);
  const duplicates = new Set(duplicateMappingSources(items)); const missing = requiredMappingTargetsMissing(items);
  const changeTarget = (index: number, target: ImportMappingTarget | null) => {
    const without = items.filter((item) => item.source_column_index !== index);
    if (!target) { onItems(without); return; }
    const header = sourceHeader(rows, index, headerMode, headerRow);
    const next: ImportMappingItem = { source_column_index: index, source_column_indexes: [index], source_header: header, source_headers: header ? [header] : [], target_namespace: target.target_namespace, target_code: target.target_code, mapping_mode: target.target_namespace === "ignore" ? "IGNORE" : "SOURCE", required: target.required_for_confirm, display_order: index, combination_strategy: "FIRST_NON_EMPTY", combination_separator: " ", mapping_confidence: 1, adaptive_mapping_status: "CONFIRMED", mapping_evidence: ["MANUAL_MAPPING"] };
    onItems([...without, next].sort((a, b) => a.display_order - b.display_order));
  };
  const update = (index: number, patch: Partial<ImportMappingItem>) => onItems(items.map((item) => item.source_column_index === index ? { ...item, ...patch } : item));
  return <section className="mi-mapping-editor" aria-label="字段 Mapping 编辑器">
    <header className="mi-catalog-toolbar"><div><h3>字段 Mapping</h3><p>目标来自当前批次的权威 Catalog；不执行公式、表达式、清洗、分类或 AI。</p></div><label>搜索目标<input value={catalogQuery} maxLength={64} disabled={readOnly || busy} onChange={(e) => onCatalogQuery(e.target.value)} /></label><button disabled={!catalogHasMore || busy} onClick={onCatalogMore}>加载更多目标</button></header>
    {items.some((item) => (item.source_column_indexes?.length || 0) > 1) ? <div className="mi-mapping-warning" role="status"><strong>多列组合 Mapping</strong>{items.filter((item) => (item.source_column_indexes?.length || 0) > 1).map((item) => <p key={`${item.target_namespace}.${item.target_code}`}>{item.target_namespace}.{item.target_code} ← {(item.source_headers?.length ? item.source_headers : item.source_column_indexes?.map(importColumnReference))?.join(" + ")}；策略 {item.combination_strategy}；置信度 {Math.round((item.mapping_confidence || 0) * 100)}%；状态 {item.adaptive_mapping_status}。SUGGESTED/规格提取结果必须人工确认。</p>)}</div> : null}
    {missing.length ? <div className="mi-mapping-warning" role="status">确认前缺少：{missing.join("、")}。草稿可保存，但预览和确认已锁定。</div> : null}
    <div className="mi-mapping-head" aria-hidden="true"><span>来源列及样本</span><span>目标字段</span><span>默认值及问题</span></div>
    <div className="mi-mapping-rows">{Array.from({ length: Math.max(0, Math.min(256, columnCount)) }, (_, index) => {
      const item = bySource.get(index) || null; const sample = samples(rows, index, headerMode, headerRow); const duplicate = duplicates.has(index);
      const types = [...new Set(rows.map((row) => row.cells.find((cell) => cell.column_index === index)?.type).filter(Boolean))].slice(0, 4).join(" / ") || "未提供";
      return <article className="mi-mapping-row" key={index} aria-labelledby={`mi-source-${index}`}><div className="mi-mapping-source"><strong id={`mi-source-${index}`}>{importColumnReference(index)} / {item?.source_headers?.join("/") || sourceHeader(rows, index, headerMode, headerRow) || `COLUMN_${importColumnReference(index)}`}</strong><small>source_column_index={index} · {types}</small><p>{sample.length ? sample.join(" | ") : "无非空样本"}</p></div><div className="mi-mapping-target"><MaterialImportTargetSelector sourceIndex={index} value={item} targets={targets} invalid={duplicate || Boolean(item && !targets.some((target) => target.target_namespace === item.target_namespace && target.target_code === item.target_code))} disabled={readOnly || busy} onChange={(target) => changeTarget(index, target)} />{item && item.target_namespace !== "ignore" ? <select aria-label={`${importColumnReference(index)} 列 Mapping 模式`} value={item.mapping_mode} disabled={readOnly || busy} onChange={(e) => update(index, { mapping_mode: e.target.value as ImportMappingItem["mapping_mode"], default_value_json: e.target.value === "SOURCE" ? undefined : item.default_value_json })}><option value="SOURCE">使用来源值</option><option value="SOURCE_WITH_DEFAULT">来源为空时用默认值</option></select> : null}</div><div className="mi-mapping-problem">{item?.mapping_mode === "SOURCE_WITH_DEFAULT" ? <label>默认值<input value={String(item.default_value_json ?? "")} disabled={readOnly || busy} onChange={(e) => update(index, { default_value_json: e.target.value })} /></label> : null}<span id={`mi-source-issue-${index}`}>{!item ? "尚未处理" : duplicate ? "ERROR：目标字段重复" : item.target_namespace === "ignore" ? "已明确忽略" : !targets.some((target) => target.target_namespace === item.target_namespace && target.target_code === item.target_code) ? "ERROR：当前 Catalog 中目标已失效" : `${item.adaptive_mapping_status || "MANUAL"} · ${Math.round((item.mapping_confidence || 0) * 100)}%`}</span></div></article>;
    })}</div>
    <footer className="mi-mapping-actions"><div><strong>{readOnly ? "只读" : dirty ? "未保存更改" : "已保存"}</strong><span>{previewValid ? "当前页面存在有效预览" : "预览未建立或已失效"}</span></div>{!readOnly ? <><button disabled={!dirty || busy} onClick={onReset}>放弃本地更改</button><button disabled={!dirty || busy || items.length === 0 || duplicates.size > 0} onClick={onSave}>保存 Mapping</button><button disabled={dirty || busy || missing.length > 0} onClick={onPreview}>预览</button><button className="mi-primary" disabled={!previewValid || dirty || busy || missing.length > 0} onClick={onConfirm}>确认 Mapping</button></> : null}</footer>
  </section>;
}

export function MaterialImportMappingPreview({ rows }: { rows: { row_number: number; values: { target_namespace: string; target_code: string; source_column_index: number | null; status: string; raw_value: unknown; candidate_value: unknown; issues: { code: string; message: string }[] }[] }[] }) {
  return <section className="mi-mapping-preview"><h3>Mapping 有界预览</h3><p>只显示原始样本、目标字段、默认值候选与安全问题；不执行清洗、分类、匹配、AI 或 Draft 创建。</p><div className="mm-table-wrap"><table><thead><tr><th>行</th><th>目标</th><th>原始值</th><th>候选值</th><th>状态与问题</th></tr></thead><tbody>{rows.flatMap((row) => row.values.map((value, index) => <tr key={`${row.row_number}-${value.target_namespace}-${value.target_code}-${index}`}><td>{row.row_number}</td><td>{value.target_namespace}.{value.target_code}</td><td>{String(value.raw_value ?? "—")}</td><td>{String(value.candidate_value ?? "—")}</td><td>{value.status}{value.issues.length ? `：${value.issues.map((item) => item.message).join("；")}` : ""}</td></tr>))}</tbody></table></div></section>;
}
