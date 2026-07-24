import Link from "next/link";
import { actionLabel, attributeDisplay, displayValue, formatShanghaiDate, sourceLabel, statusLabel } from "../_lib/material-ui";

export type MaterialIssue = {
  code?: string;
  severity?: string;
  field?: string;
  message?: string;
  attribute_code?: string;
  metadata?: unknown;
};

export type MaterialVersionSummary = {
  version: number;
  event_type: string;
  changed_by?: string;
  created_at?: string;
};

export type MaterialChangeSummary = {
  change_type: string;
  field_name?: string;
  changed_by?: string;
  created_at?: string;
};

export type MaterialDetail = {
  material: Record<string, unknown> & {
    material_id: number;
    material_code?: string | null;
    standard_name: string;
    material_status: string;
    current_version: number;
  };
  category_path: { category_id: number; category_code: string; category_name: string; level: number }[];
  attributes: { attribute_code: string; name: string; data_type: string; value: unknown; unit?: string; source_type?: string }[];
  validation: { basis?: string; validated_at?: string; valid: boolean; errors: MaterialIssue[]; warnings: MaterialIssue[] };
  history_summary: {
    versions: { items: MaterialVersionSummary[]; total: number; has_more: boolean };
    change_logs: { items: MaterialChangeSummary[]; total: number; has_more: boolean };
    audit_logs?: { total: number; has_more: boolean };
  };
  last_rejection?: { version: number; reason: string; reviewed_by: string; reviewed_at: string } | null;
};

export function materialAttributeTargetId(code: string): string {
  return `material-attribute-${code.replaceAll("_", "-").toLowerCase()}`;
}

export function MaterialFieldGrid({ fields }: { fields: [string, unknown][] }) {
  return <dl className="mm-field-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{displayValue(value)}</dd></div>)}</dl>;
}

export function MaterialBasicCard({ detail }: { detail: MaterialDetail }) {
  const material = detail.material;
  const categoryPath = detail.category_path.map((node) => node.category_name).join(" / ");
  return <section className="mm-card mm-card-basic"><h3>基本信息</h3><MaterialFieldGrid fields={[
    ["正式物料编码", material.material_code], ["标准名称", material.standard_name], ["状态", statusLabel(material.material_status)],
    ["分类路径", categoryPath], ["基本单位", material.unit], ["来源", sourceLabel(material.source_type)],
    ["来源引用", material.source_ref], ["当前版本", `V${material.current_version}`], ["品牌", material.brand],
    ["制造商", material.manufacturer], ["制造商型号", material.manufacturer_part_number], ["采购类型", material.procurement_type],
    ["库存类型", material.inventory_type], ["批次控制", material.lot_control_required === true ? "是" : material.lot_control_required === false ? "否" : "—"],
    ["保质期（天）", material.shelf_life_days], ["检验类型", material.inspection_type], ["环保要求", material.environmental_requirement],
  ]} /></section>;
}

export function MaterialResponsibilitiesCard({ detail }: { detail: MaterialDetail }) {
  const material = detail.material;
  return <section className="mm-card"><h3>职责信息</h3><MaterialFieldGrid fields={[
    ["创建人", material.created_by], ["最后修改人", material.last_modified_by], ["提交人", material.submitted_by],
    ["提交时间", formatShanghaiDate(material.submitted_at, true)], ["批准人", material.approved_by], ["批准时间", formatShanghaiDate(material.approved_at, true)],
    ["创建时间", formatShanghaiDate(material.created_at, true)], ["更新时间", formatShanghaiDate(material.updated_at, true)],
  ]} /></section>;
}

export function MaterialAttributesCard({ detail }: { detail: MaterialDetail }) {
  return <section className="mm-card mm-attributes"><h3>类型化属性</h3>{detail.attributes.length ? <div className="mm-attribute-grid">{detail.attributes.map((attribute) => <div id={materialAttributeTargetId(attribute.attribute_code)} tabIndex={-1} key={attribute.attribute_code} className="mm-attribute"><span>{attribute.name}</span><small>{attribute.attribute_code}</small><strong>{attributeDisplay(attribute)}</strong></div>)}</div> : <p className="mm-muted">暂无类型化属性</p>}</section>;
}

export function MaterialValidationPanel({ validation, onFocusIssue, heading = "当前校验结果" }: {
  validation: MaterialDetail["validation"];
  onFocusIssue?: (issue: MaterialIssue) => void;
  heading?: string;
}) {
  const issues = [...(validation.errors || []), ...(validation.warnings || [])];
  return <section className="mm-card mm-validation"><h3>{heading}</h3><div className="mm-validation-summary"><strong>{validation.valid ? "校验通过" : "校验未通过"}</strong><span>错误 ERROR {validation.errors?.length || 0}</span><span>警告 WARNING {validation.warnings?.length || 0}</span></div><p className="mm-validation-basis">依据：{displayValue(validation.basis)} · {formatShanghaiDate(validation.validated_at, true)}</p>{issues.length ? <ul>{issues.map((issue, index) => <li className={`mm-issue mm-issue-${String(issue.severity).toLowerCase()}`} key={`${issue.code}-${index}`}><b>{issue.severity === "ERROR" ? "错误 ERROR" : "警告 WARNING"}</b><span>{displayValue(issue.code)} · {displayValue(issue.field || issue.attribute_code)}</span><p>{displayValue(issue.message)}</p>{onFocusIssue && issue.attribute_code ? <button type="button" onClick={() => onFocusIssue(issue)}>定位到 {issue.attribute_code}</button> : null}</li>)}</ul> : <p className="mm-muted">没有错误或警告。</p>}</section>;
}

function HistoryCard({ title, total, href, children }: { title: string; total: number; href: string; children: React.ReactNode }) {
  return <section className="mm-card mm-history-card"><h3>{title}（最多 5 条）</h3><ul>{children}</ul><Link href={href}>查看完整{title.replace("最近", "")}（共 {total} 条）</Link></section>;
}

export function MaterialRecentVersionsCard({ detail, materialId, returnParam }: { detail: MaterialDetail; materialId: number; returnParam: string }) {
  return <HistoryCard title="最近版本" total={detail.history_summary.versions.total} href={`/materials/${materialId}/versions?page=1&page_size=20&${returnParam}`}>
    {detail.history_summary.versions.items.slice(0, 5).map((item) => <li key={`${item.version}-${item.created_at}`}><b>V{item.version} {actionLabel(item.event_type)}</b><span>{displayValue(item.changed_by)} · {formatShanghaiDate(item.created_at, true)}</span></li>)}
  </HistoryCard>;
}

export function MaterialRecentChangesCard({ detail, materialId, returnParam }: { detail: MaterialDetail; materialId: number; returnParam: string }) {
  return <HistoryCard title="最近变更" total={detail.history_summary.change_logs.total} href={`/materials/${materialId}/change-logs?page=1&page_size=20&${returnParam}`}>
    {detail.history_summary.change_logs.items.slice(0, 5).map((item, index) => <li key={`${item.created_at}-${index}`}><b>{actionLabel(item.change_type)} · {displayValue(item.field_name)}</b><span>{displayValue(item.changed_by)} · {formatShanghaiDate(item.created_at, true)}</span></li>)}
  </HistoryCard>;
}

export function MaterialLastRejectionCard({ detail }: { detail: MaterialDetail }) {
  if (!detail.last_rejection) return null;
  return <section className="mm-card mm-rejection mm-review-last-rejection" aria-label="最近一次驳回"><h3>最近一次驳回</h3><div><span>驳回版本：V{detail.last_rejection.version}</span><span>审核人：{detail.last_rejection.reviewed_by}</span><span>时间：{formatShanghaiDate(detail.last_rejection.reviewed_at, true)}</span></div><p>{detail.last_rejection.reason}</p><small>该历史只读，不会自动成为本次审核意见。</small></section>;
}

export function MaterialDetailSections({ detail, materialId, returnParam }: { detail: MaterialDetail; materialId: number; returnParam: string }) {
  return <div className="mm-detail-grid">
    <MaterialBasicCard detail={detail} />
    <MaterialValidationPanel validation={detail.validation} />
    <MaterialResponsibilitiesCard detail={detail} />
    <MaterialRecentVersionsCard detail={detail} materialId={materialId} returnParam={returnParam} />
    <MaterialAttributesCard detail={detail} />
    <MaterialRecentChangesCard detail={detail} materialId={materialId} returnParam={returnParam} />
  </div>;
}
