"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { statusLabel,statusPairLabel } from "../../../public/erp/status-localization.js";

export type RfqCreationReceipt = {
  authority: "IMMUTABLE_EVENT" | "EXACT_SUCCESS_AUDIT" | "UNVERIFIED";
  event_type: string;
  immutable: boolean;
  authority_note: string;
  actor: string;
  occurred_at: string;
  occurred_at_shanghai: string;
  request_id: string;
  result: "SUCCESS" | "UNVERIFIED";
  idempotency_key_digest: string | null;
  old_version: number | null;
  new_version: number | null;
  operation_id: string | number | null;
  scope_digest?: string | null;
};

export type RfqMappingRow = {
  binding_id?: string | null;
  rfq_id?: number | null;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  supplier_status: string;
  invitation_status?: string | null;
  rfq_supplier_id?: number | null;
  rfq_line_id?: number | null;
  material_id: number;
  internal_material_code: string;
  standard_name: string;
  supplier_part_number: string | null;
  mapping_id: string | null;
  mapping_version: number | null;
  mapping_row_version: number | null;
  purchase_unit_code: string | null;
  base_unit_code: string | null;
  conversion_numerator: string | number | null;
  conversion_denominator: string | number | null;
  valid_from: string | null;
  valid_to: string | null;
  binding_status: string;
  binding_source: string;
  bound_by?: string | null;
  bound_at?: string | null;
  binding_request_id?: string | null;
  bound_at_shanghai?: string | null;
  binding_scope_digest?: string | null;
  current_status: string | null;
  current_bound_mapping_version?: number | null;
  current_bound_row_version?: number | null;
  latest_mapping_status?: string | null;
  current_mapping_version?: number | null;
  current_mapping_row_version?: number | null;
  status_drift: boolean;
  version_drift: boolean;
  scope_intact: boolean;
  eligible: boolean;
  issue_reason?: string;
};

export type RfqMappingBindingReceipt = {
  authority: "IMMUTABLE_EVENT" | "UNVERIFIED";
  verified: boolean;
  event_type: "RFQ_CREATED" | "RFQ_MAPPING_CONFIRMED";
  immutable: boolean;
  authority_note: string;
  actor: string | null;
  occurred_at: string | null;
  occurred_at_shanghai: string;
  request_id: string | null;
  result: "SUCCESS" | "UNVERIFIED";
  idempotency_key_digest: string | null;
  old_version: number | null;
  new_version: number | null;
  from_status: string | null;
  to_status: string | null;
  scope_digest: string | null;
  computed_scope_digest: string;
  binding_count: number;
  binding_ids: string[];
  issues: string[];
};

export type RfqMappingTraceability = {
  mode: "BOUND_AT_CREATE" | "BOUND_BY_EXPLICIT_CONFIRMATION" | "UNBOUND_LEGACY_DRAFT";
  complete: boolean;
  scope_intact: boolean;
  can_issue: boolean;
  summary: string;
  cas_semantics: string;
  drift_basis: string[];
  issues: string[];
  bindings: RfqMappingRow[];
  current_qualification: RfqMappingRow[];
};

export type RfqDownstreamCounts = {
  quotes: number;
  awards: number;
  purchase_orders: number;
};

export type RfqIssueReceipt = {
  event_type?: string;
  event?: string;
  actor: string;
  occurred_at: string;
  occurred_at_shanghai?: string;
  request_id: string;
  result: "SUCCESS";
  old_version?: number | null;
  before_version?: number | null;
  new_version?: number;
  after_version?: number;
  final_status?: string;
  status?: string;
  from_status?: string;
  to_status?: string;
  scope_summary?: string;
  frozen_scope_summary?: string;
  scope_digest?: string;
  supplier_count?: number;
  mapping_count?: number;
  bindings?: RfqMappingRow[];
  mapping_bindings?: RfqMappingRow[];
  downstream_counts?: RfqDownstreamCounts;
  quote_count?: number;
  award_count?: number;
  purchase_order_count?: number;
  quote_entry_enabled?: boolean;
};

export type RfqDialogDetail = {
  header: {
    id: number;
    rfq_code: string;
    round_no: number;
    status: string;
    version: number;
    purchase_request_id: number;
    request_code: string;
    project_code: string;
    project_name: string;
    response_deadline: string;
    currency_code: string;
  };
  lines: Array<{
    id: string;
    line_no: number;
    material_id?: number;
    internal_material_code: string;
    standard_name: string;
    unit_code: string;
    requested_quantity: string;
    required_date: string;
  }>;
  suppliers: Array<{
    supplier_id: number;
    supplier_code: string;
    supplier_name: string;
    status: string;
    supplier_status: string;
  }>;
  creation_receipt: RfqCreationReceipt | null;
  mapping_binding_receipt: RfqMappingBindingReceipt | null;
  mapping_traceability: RfqMappingTraceability | null;
  downstream_counts: RfqDownstreamCounts;
  issue_receipt: RfqIssueReceipt | null;
};

export type RfqMappingQualificationPreview = {
  rfq: {
    id: number;
    rfq_code: string;
    round_no: number;
    version: number;
    expected_version: number;
    status: string;
    status_text: string;
    purchase_request_id: number;
    request_code: string;
    source_purchase_request_version: number;
    current_purchase_request_version: number;
    project_id: number;
    project_code: string;
    project_name: string;
    response_deadline: string;
    currency_code: string;
  };
  lines: Array<{
    id: number;
    line_no: number;
    purchase_request_line_id: number;
    material_id: number;
    internal_material_code: string;
    standard_name: string;
    material_status: string;
    unit_id: number;
    unit_code: string;
    requested_quantity: string;
    required_date: string;
  }>;
  suppliers: Array<{
    rfq_supplier_id: number;
    supplier_id: number;
    supplier_code: string;
    supplier_name: string;
    status: string;
    invitation_status: string;
    required_material_count: number;
    eligible_mapping_count: number;
    coverage: string;
    missing_material_count: number;
    supplier_material_conflict_count: number;
    supplier_part_number_conflict_count: number;
    conflict_count: number;
    eligible: boolean;
  }>;
  qualification_passed: boolean;
  expected_binding_count: number;
  actual_candidate_count: number;
  current_binding_count: number;
  missing_combination_count: number;
  supplier_material_conflict_count: number;
  supplier_part_number_conflict_count: number;
  blocking_reasons: Array<{
    code: string;
    message: string;
    suggestion: string;
    supplier_id?: number;
    material_id?: number;
    mapping_id?: string | null;
  }>;
  observed_at: string;
  data_timezone: "Asia/Shanghai";
  qualification_digest: string;
  combinations: Array<{
    rfq_supplier_id: number;
    rfq_line_id: number;
    supplier_id: number;
    supplier_code: string;
    supplier_name: string;
    supplier_status: string;
    invitation_status: string;
    material_id: number;
    internal_material_code: string;
    standard_name: string;
    material_status: string;
    mapping_version_id: number | null;
    mapping_id: string | null;
    mapping_version: number | null;
    mapping_row_version: number | null;
    mapping_content_digest: string | null;
    supplier_part_number: string | null;
    purchase_unit_id: number | null;
    purchase_unit_code: string | null;
    base_unit_code: string | null;
    conversion_numerator: string | null;
    conversion_denominator: string | null;
    conversion_text: string;
    valid_from: string | null;
    valid_to: string | null;
    mapping_status: string | null;
    current_active_supplier_material_count: number;
    current_active_supplier_part_number_count: number;
    supplier_material_conflict: boolean;
    supplier_part_number_conflict: boolean;
    eligible: boolean;
    issues: Array<{ code: string; message: string; suggestion: string }>;
  }>;
};

const shanghaiFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const focusableSelector =
  "button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";

function shortDate(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : "—";
}

export function formatShanghaiTime(value: string | null | undefined, exact?: string | null) {
  if (exact) return exact.includes("Asia/Shanghai") ? exact : `${exact}（Asia/Shanghai）`;
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return `${value}（Asia/Shanghai）`;
  return `${shanghaiFormatter.format(parsed)}（Asia/Shanghai）`;
}

function TraceValue({ children }: { children: string | number | null | undefined }) {
  return <code className="rfq-trace-value">{children === null || children === undefined || children === "" ? "—" : children}</code>;
}

export function CreationReceiptView({
  receipt,
  compact = false,
}: {
  receipt: RfqCreationReceipt | null;
  compact?: boolean;
}) {
  if (!receipt) {
    return (
      <div className="rfq-trace-warning" role="status">
        当前响应没有可验证的 RFQ 创建成功凭证，不能由“页面可打开”反推创建成功。
      </div>
    );
  }
  const isAudit = receipt.authority === "EXACT_SUCCESS_AUDIT";
  const isBusinessEvent = receipt.authority === "IMMUTABLE_EVENT";
  const title = receipt.result !== "SUCCESS"
    ? "RFQ 创建凭证未验证"
    : isAudit
      ? "RFQ 创建成功审计"
      : "RFQ_CREATED 业务事件";
  return (
    <section className={compact ? "rfq-receipt compact" : "rfq-receipt"} aria-label={title}>
      <div className="rfq-section-heading">
        <div>
          <p className="rfq-eyebrow">{isAudit ? "创建审计" : "创建业务事件"}</p>
          <h3>{title}</h3>
        </div>
        <span className={receipt.result === "SUCCESS" ? "rfq-proof success" : "rfq-proof"}>{statusLabel(receipt.result)}</span>
      </div>
      <dl className="rfq-receipt-facts">
        <div><dt>凭证类型</dt><dd>{isAudit ? "精确匹配的成功审计" : isBusinessEvent ? "独立 RFQ_CREATED 业务事件" : "未验证"}</dd></div>
        <div><dt>{isAudit ? "审计操作" : "业务事件"}</dt><dd>{receipt.event_type} · ID {receipt.operation_id ?? "—"}</dd></div>
        <div><dt>独立 RFQ_CREATED 事件</dt><dd>{isBusinessEvent ? "是" : "否"}</dd></div>
        <div><dt>创建操作者</dt><dd>{receipt.actor}</dd></div>
        <div><dt>精确时间</dt><dd>{formatShanghaiTime(receipt.occurred_at, receipt.occurred_at_shanghai)}</dd></div>
        <div><dt>创建前后 Version / CAS</dt><dd>{receipt.old_version === null ? "不存在" : `v${receipt.old_version}`} → {receipt.new_version === null ? "未验证" : `v${receipt.new_version}`}</dd></div>
        <div><dt>结果</dt><dd>{statusLabel(receipt.result)}</dd></div>
      </dl>
      <div className="rfq-trace-line"><span>request_id</span><TraceValue>{receipt.request_id}</TraceValue></div>
      {receipt.scope_digest ? <div className="rfq-trace-line"><span>冻结范围摘要</span><TraceValue>{receipt.scope_digest}</TraceValue></div> : null}
      <div className="rfq-trace-line"><span>Idempotency-Key 摘要</span><TraceValue>{receipt.idempotency_key_digest}</TraceValue></div>
      {isAudit ? <p className="rfq-proof-note"><b>这是与本 RFQ 精确匹配的成功审计，不是独立 RFQ_CREATED 业务事件。</b></p> : null}
      <p className="rfq-proof-note">{receipt.authority_note}</p>
    </section>
  );
}

const modeLabels: Record<RfqMappingTraceability["mode"], string> = {
  BOUND_AT_CREATE: "创建时已固定 Mapping",
  BOUND_BY_EXPLICIT_CONFIRMATION: "已由采购显式确认并固定 Mapping",
  UNBOUND_LEGACY_DRAFT: "历史草稿尚未固定 Mapping",
};

function groupMappings(rows: RfqMappingRow[]) {
  const groups = new Map<number, RfqMappingRow[]>();
  const sorted = [...rows].sort((left, right) => {
    const leftBindingId = Number(left.binding_id);
    const rightBindingId = Number(right.binding_id);
    const leftHasBinding = Number.isSafeInteger(leftBindingId) && leftBindingId > 0;
    const rightHasBinding = Number.isSafeInteger(rightBindingId) && rightBindingId > 0;
    if (leftHasBinding && rightHasBinding && leftBindingId !== rightBindingId) return leftBindingId - rightBindingId;
    if (leftHasBinding !== rightHasBinding) return leftHasBinding ? -1 : 1;
    return left.supplier_code.localeCompare(right.supplier_code)
      || left.supplier_id - right.supplier_id
      || Number(left.rfq_line_id || 0) - Number(right.rfq_line_id || 0)
      || left.material_id - right.material_id;
  });
  for (const row of sorted) groups.set(row.supplier_id, [...(groups.get(row.supplier_id) || []), row]);
  return [...groups.entries()];
}

function MappingRows({ rows }: { rows: RfqMappingRow[] }) {
  if (!rows.length) return <div className="rfq-trace-warning">当前没有可展示的 Mapping 关系。</div>;
  return (
    <div className="rfq-mapping-groups">
      {groupMappings(rows).map(([supplierId, supplierRows]) => {
        const supplier = supplierRows[0];
        return (
          <section className="rfq-mapping-group" key={supplierId} aria-label={`Supplier ${supplierId} Mapping`}>
            <div className="rfq-mapping-supplier">
              <b>Supplier ID {supplierId} · {supplier.supplier_code} · {supplier.supplier_name}</b>
              <span>当前供应商状态：{statusLabel(supplier.supplier_status)}</span>
            </div>
            <div className="rfq-mapping-list">
              {supplierRows.map((row) => {
                const mappingHealthy = row.binding_source === "CURRENT_QUALIFICATION" ? row.eligible : row.scope_intact;
                return <article className={mappingHealthy && !row.status_drift && !row.version_drift ? "rfq-mapping-card" : "rfq-mapping-card drift"} key={row.binding_id || `${supplierId}:${row.material_id}:${row.mapping_id}`}>
                  <div className="rfq-mapping-title">
                    <b>{row.binding_id ? `Binding ID ${row.binding_id} → Supplier ID ${row.supplier_id} / RFQ Line ID ${row.rfq_line_id ?? "—"} / Material ID ${row.material_id}` : `Material ID ${row.material_id}`}</b>
                    <span>{row.internal_material_code} · {row.standard_name}</span>
                  </div>
                  <div className="rfq-authoritative-statuses" aria-label="Binding、Mapping 与邀请状态">
                    <span data-rfq-status="binding">Binding状态：<b>{row.binding_source === "CURRENT_QUALIFICATION" ? "尚未固定（无 Binding 记录）" : statusLabel(row.binding_status)}</b></span>
                    <span data-rfq-status="mapping">Mapping状态：<b>{statusLabel(row.current_status)}</b></span>
                    <span data-rfq-status="invitation">邀请状态：<b>{statusLabel(row.invitation_status)}</b></span>
                  </div>
                  <dl>
                    <div className="wide"><dt>Binding ID</dt><dd><TraceValue>{row.binding_id}</TraceValue></dd></div>
                    <div><dt>RFQ ID</dt><dd>{row.rfq_id ?? "—"}</dd></div>
                    <div><dt>RFQ Line ID</dt><dd>{row.rfq_line_id ?? "—"}</dd></div>
                    <div><dt>Supplier ID</dt><dd>{row.supplier_id}</dd></div>
                    <div><dt>Supplier 编码</dt><dd>{row.supplier_code}</dd></div>
                    <div className="wide"><dt>Supplier 名称</dt><dd>{row.supplier_name}</dd></div>
                    <div><dt>Material ID</dt><dd>{row.material_id}</dd></div>
                    <div><dt>supplier_part_number</dt><dd>{row.supplier_part_number || "—"}</dd></div>
                    <div className="wide"><dt>Mapping ID</dt><dd><TraceValue>{row.mapping_id}</TraceValue></dd></div>
                    <div><dt>Mapping Version</dt><dd>{row.mapping_version === null ? "—" : `v${row.mapping_version}`} / {row.mapping_row_version === null ? "Row —" : `Row v${row.mapping_row_version}`}</dd></div>
                    <div><dt>Supplier Unit</dt><dd>{row.purchase_unit_code || "—"}</dd></div>
                    <div><dt>Internal Unit</dt><dd>{row.base_unit_code || "—"}</dd></div>
                    <div><dt>换算</dt><dd>{row.conversion_numerator ?? "—"}:{row.conversion_denominator ?? "—"}</dd></div>
                    <div><dt>有效期</dt><dd>{shortDate(row.valid_from)} — {shortDate(row.valid_to) === "—" ? "长期" : shortDate(row.valid_to)}</dd></div>
                    <div><dt>Binding固定来源</dt><dd>{row.binding_source === "CURRENT_QUALIFICATION" ? "当前资格检查（尚未固定）" : row.binding_source}</dd></div>
                    <div><dt>已绑定 Mapping 版本当前值</dt><dd>v{row.current_bound_mapping_version ?? row.mapping_version ?? "—"} / Row v{row.current_bound_row_version ?? row.mapping_row_version ?? "—"}</dd></div>
                    <div><dt>最新 Mapping 版本</dt><dd>{statusLabel(row.latest_mapping_status || row.current_status)} · v{row.current_mapping_version ?? row.mapping_version ?? "—"} / Row v{row.current_mapping_row_version ?? row.mapping_row_version ?? "—"}</dd></div>
                    <div><dt>状态漂移（Binding ↔ Mapping）</dt><dd>{row.binding_source === "CURRENT_QUALIFICATION" ? "不适用（尚未固定）" : row.status_drift ? "是" : "否"}</dd></div>
                    <div><dt>版本漂移（固定 ↔ 当前）</dt><dd>{row.binding_source === "CURRENT_QUALIFICATION" ? "不适用（尚未固定）" : row.version_drift ? "是" : "否"}</dd></div>
                    {row.bound_by || row.bound_at || row.binding_request_id ? <div className="wide"><dt>固定凭证归属</dt><dd>{row.bound_by || "—"} · {formatShanghaiTime(row.bound_at, row.bound_at_shanghai)} · <TraceValue>{row.binding_request_id}</TraceValue></dd></div> : null}
                    {row.binding_scope_digest ? <div className="wide"><dt>固定范围摘要</dt><dd><TraceValue>{row.binding_scope_digest}</TraceValue></dd></div> : null}
                  </dl>
                  {row.issue_reason ? <p className="rfq-mapping-issue">{row.issue_reason}</p> : null}
                </article>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function MappingBindingReceiptView({ receipt, compact = false }: { receipt: RfqMappingBindingReceipt | null; compact?: boolean }) {
  if (!receipt) return <div className="rfq-trace-warning" role="status">当前响应缺少 Mapping 固定凭证，发出已失败关闭。</div>;
  const stableBindingIds = [...receipt.binding_ids].sort((left, right) => Number(left) - Number(right));
  return (
    <details className={compact ? "rfq-receipt compact" : "rfq-receipt"} open>
      <summary><b>Mapping 固定凭证</b> · {statusLabel(receipt.event_type)} · {statusLabel(receipt.result)}</summary>
      <section aria-label="Mapping 固定凭证">
        <div className="rfq-section-heading">
          <div><p className="rfq-eyebrow">字段映射固定凭证</p><h3>Mapping 固定凭证</h3></div>
          <span className={receipt.verified ? "rfq-proof success" : "rfq-proof warning"}>{statusLabel(receipt.result)}</span>
        </div>
        <dl className="rfq-receipt-facts">
          <div><dt>事件</dt><dd>{statusLabel(receipt.event_type)}</dd></div>
          <div><dt>操作者</dt><dd>{receipt.actor || "—"}</dd></div>
          <div><dt>精确时间</dt><dd>{formatShanghaiTime(receipt.occurred_at, receipt.occurred_at_shanghai)}</dd></div>
          <div><dt>结果</dt><dd>{statusLabel(receipt.result)}</dd></div>
          <div><dt>RFQ Version / CAS</dt><dd>{receipt.old_version === null ? "不存在" : `v${receipt.old_version}`} → {receipt.new_version === null ? "未验证" : `v${receipt.new_version}`}</dd></div>
          <div><dt>固定 Binding 数量</dt><dd>{receipt.binding_count}</dd></div>
        </dl>
        <div className="rfq-trace-line"><span>request_id</span><TraceValue>{receipt.request_id}</TraceValue></div>
        <div className="rfq-trace-line"><span>固定范围摘要</span><TraceValue>{receipt.scope_digest}</TraceValue></div>
        <div className="rfq-trace-line"><span>Binding 稳定 ID（按 ID 升序）</span><TraceValue>{stableBindingIds.join(" · ")}</TraceValue></div>
        <p className="rfq-proof-note"><b>身份关联口径：</b>权威关联以下方逐条 Binding 的数据库 ID 与外键字段为准；固定摘要的规范化计算与身份展示相互独立，不按任何摘要输入序列位置配对。</p>
        <p className="rfq-proof-note"><b>不可变快照说明：</b>{receipt.authority_note}</p>
        {receipt.issues.length ? <div className="rfq-trace-issues" role="alert"><b>固定凭证校验失败</b><ul>{receipt.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
      </section>
    </details>
  );
}

export function MappingTraceabilityView({ trace }: { trace: RfqMappingTraceability | null }) {
  if (!trace) return <div className="rfq-trace-warning">当前响应缺少 Mapping 追溯模型，RFQ 不可安全发出。</div>;
  const proposed = trace.mode === "UNBOUND_LEGACY_DRAFT";
  const rows = proposed ? trace.current_qualification : trace.bindings;
  return (
    <section className="rfq-mapping-trace" aria-label="Supplier Mapping 追溯">
      <div className="rfq-section-heading">
        <div>
          <p className="rfq-eyebrow">字段映射追溯</p>
          <h3>Supplier / Material Mapping 追溯</h3>
        </div>
        <span className={trace.complete ? "rfq-proof success" : "rfq-proof warning"}>{modeLabels[trace.mode]}</span>
      </div>
      <p className="rfq-proof-note">{trace.summary}</p>
      <div className={trace.scope_intact ? "rfq-trace-ok" : "rfq-trace-warning"}>
        <b>RFQ CAS与固定范围判定</b>
        <p>{trace.cas_semantics}</p>
        <p>范围漂移权威字段：{trace.drift_basis.join("；")}。</p>
      </div>
      {proposed ? (
        <div className="rfq-trace-warning">
          <b>当前资格检查 / 尚未冻结的拟绑定 Mapping</b>
          <p>这些记录是当前已生效 Mapping 的资格检查结果，不代表 RFQ 创建时已经绑定。只有采购人员显式确认后，才会形成可追溯的稳定 Mapping ID 与 Version；本页不会自动执行该操作。</p>
        </div>
      ) : (
        <div className="rfq-trace-ok">
          <b>已固定 Mapping 关系</b>
          <p>以下稳定 Mapping ID 与 Version 已关系化绑定；发出成功后作为不可变范围快照，不再动态冒充为其他历史状态。</p>
        </div>
      )}
      {trace.issues.length ? <div className="rfq-trace-issues" role="alert"><b>当前阻断项</b><ul>{trace.issues.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div> : null}
      <MappingRows rows={rows} />
    </section>
  );
}

export function IssueReceiptView({ detail }: { detail: RfqDialogDetail }) {
  const receipt = detail.issue_receipt;
  if (!receipt) return null;
  const oldVersion = receipt.old_version ?? receipt.before_version;
  const newVersion = receipt.new_version ?? receipt.after_version;
  const bindings = receipt.bindings || receipt.mapping_bindings || detail.mapping_traceability?.bindings || [];
  const downstream = receipt.downstream_counts || { quotes: receipt.quote_count ?? detail.downstream_counts.quotes, awards: receipt.award_count ?? detail.downstream_counts.awards, purchase_orders: receipt.purchase_order_count ?? detail.downstream_counts.purchase_orders };
  return (
    <section className="rfq-issue-receipt" aria-label="RFQ 发出成功凭证">
      <div className="rfq-section-heading">
        <div><p className="rfq-eyebrow">询价发出凭证</p><h3>RFQ 发出成功凭证</h3></div>
        <span className="rfq-proof success">{statusLabel(receipt.result)}</span>
      </div>
      <dl className="rfq-receipt-facts">
        <div><dt>事件</dt><dd>{statusLabel(receipt.event_type || receipt.event || "ISSUED")}</dd></div>
        <div><dt>操作者</dt><dd>{receipt.actor}</dd></div>
        <div><dt>精确时间</dt><dd>{formatShanghaiTime(receipt.occurred_at, receipt.occurred_at_shanghai)}</dd></div>
        <div><dt>发出前后 Version / CAS</dt><dd>{oldVersion === null || oldVersion === undefined ? "—" : `v${oldVersion}`} → {newVersion === undefined ? "—" : `v${newVersion}`}</dd></div>
        <div><dt>最终状态</dt><dd>{statusLabel(receipt.to_status || receipt.final_status || receipt.status || detail.header.status)}</dd></div>
        <div><dt>冻结数量</dt><dd>{receipt.supplier_count ?? detail.suppliers.length} Suppliers · {receipt.mapping_count ?? bindings.length} Mappings</dd></div>
      </dl>
      <div className="rfq-trace-line"><span>request_id</span><TraceValue>{receipt.request_id}</TraceValue></div>
      {receipt.scope_digest ? <div className="rfq-trace-line"><span>冻结范围 SHA-256</span><TraceValue>{receipt.scope_digest}</TraceValue></div> : null}
      <p className="rfq-proof-note">{receipt.scope_summary || receipt.frozen_scope_summary || "RFQ 行、Supplier 与 Mapping 稳定 ID / Version 已冻结。"}</p>
      <div className="rfq-downstream-proof">
        <span>Quote 入口：{receipt.quote_entry_enabled === false ? "未启用" : "已启用"}</span>
        <span>Quote：{downstream.quotes}</span>
        <span>Award：{downstream.awards}</span>
        <span>PO：{downstream.purchase_orders}</span>
      </div>
      <MappingRows rows={bindings} />
    </section>
  );
}

function QualificationMappingRows({ preview }: { preview: RfqMappingQualificationPreview }) {
  return (
    <div className="rfq-mapping-groups">
      {preview.suppliers.map((supplier) => {
        const rows = preview.combinations.filter((row) => row.supplier_id === supplier.supplier_id);
        return (
          <section className="rfq-mapping-group" key={supplier.supplier_id} aria-label={`Supplier ${supplier.supplier_id} 资格 Mapping`}>
            <div className="rfq-mapping-supplier">
              <b>Supplier ID {supplier.supplier_id} · {supplier.supplier_code} · {supplier.supplier_name}</b>
              <span>当前已生效 · 覆盖 {supplier.coverage} · 冲突 {supplier.conflict_count}</span>
            </div>
            <div className="rfq-mapping-list">
              {rows.map((row) => (
                <article className={row.eligible ? "rfq-mapping-card" : "rfq-mapping-card drift"} key={`${row.rfq_line_id}:${row.supplier_id}`}>
                  <div className="rfq-mapping-title">
                    <b>RFQ Line ID {row.rfq_line_id} · Material ID {row.material_id}</b>
                    <span>{row.internal_material_code} · {row.standard_name}</span>
                  </div>
                  <dl>
                    <div><dt>supplier_part_number</dt><dd>{row.supplier_part_number || "—"}</dd></div>
                    <div><dt>当前 Mapping 状态</dt><dd>{statusLabel(row.mapping_status)}</dd></div>
                    <div className="wide"><dt>Mapping ID</dt><dd><TraceValue>{row.mapping_id}</TraceValue></dd></div>
                    <div><dt>Mapping Version / CAS</dt><dd>{row.mapping_version === null ? "—" : `v${row.mapping_version}`} / {row.mapping_row_version === null ? "—" : `Row v${row.mapping_row_version}`}</dd></div>
                    <div><dt>单位换算</dt><dd>{row.purchase_unit_code || "—"} → {row.base_unit_code || "—"} · {row.conversion_text}</dd></div>
                    <div><dt>有效期</dt><dd>{shortDate(row.valid_from)} — {row.valid_to ? shortDate(row.valid_to) : "长期"}</dd></div>
                    <div><dt>相同 Supplier/Material 当前已生效数量</dt><dd>{row.current_active_supplier_material_count}</dd></div>
                    <div><dt>Supplier 内相同 supplier_part_number 当前已生效数量</dt><dd>{row.current_active_supplier_part_number_count}</dd></div>
                    <div><dt>Supplier/Material 冲突</dt><dd>{row.supplier_material_conflict ? "是" : "否"}</dd></div>
                    <div><dt>供应商料号冲突</dt><dd>{row.supplier_part_number_conflict ? "是" : "否"}</dd></div>
                    <div><dt>当前资格</dt><dd>{row.eligible ? "通过" : "未通过"}</dd></div>
                  </dl>
                  {row.issues.length ? (
                    <div className="rfq-mapping-issue" role="alert">
                      {row.issues.map((issue) => <p key={issue.code}><b>{issue.code}</b>：{issue.message}<br />处理建议：{issue.suggestion}</p>)}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MappingQualificationPreviewView({ preview }: { preview: RfqMappingQualificationPreview }) {
  return (
    <>
      <section className="rfq-confirm-section rfq-qualification-summary" aria-label="当前 Mapping 资格检查结论">
        <div className="rfq-section-heading">
          <div>
            <p className="rfq-eyebrow">权威资格核验</p>
            <h3>当前资格检查：{preview.qualification_passed ? "全部通过" : "未通过"}</h3>
          </div>
          <span className={preview.qualification_passed ? "rfq-proof success" : "rfq-proof warning"}>{preview.qualification_passed ? "符合条件" : "已阻断"}</span>
        </div>
        <p className="rfq-proof-note">服务端观测时间：{formatShanghaiTime(preview.observed_at)} · 数据时区：{preview.data_timezone}</p>
        <dl className="rfq-receipt-facts">
          <div><dt>RFQ</dt><dd>ID {preview.rfq.id} · {preview.rfq.rfq_code}</dd></div>
          <div><dt>Round / 当前 CAS / expected_version</dt><dd>Round {preview.rfq.round_no} / 当前 v{preview.rfq.version} / 页面 expected_version v{preview.rfq.expected_version}</dd></div>
          <div><dt>当前状态</dt><dd>{statusPairLabel(preview.rfq.status_text)}</dd></div>
          <div><dt>来源 PRQ 稳定 ID</dt><dd>ID {preview.rfq.purchase_request_id} · {preview.rfq.request_code}</dd></div>
          <div><dt>来源 PRQ Version</dt><dd>固定 v{preview.rfq.source_purchase_request_version} · 当前 v{preview.rfq.current_purchase_request_version}</dd></div>
          <div><dt>项目</dt><dd>ID {preview.rfq.project_id} · {preview.rfq.project_code} · {preview.rfq.project_name}</dd></div>
        </dl>
        <div className="rfq-qualification-counts">
          <span>缺失组合：{preview.missing_combination_count}</span>
          <span>Supplier/Material 冲突：{preview.supplier_material_conflict_count}</span>
          <span>供应商料号冲突：{preview.supplier_part_number_conflict_count}</span>
          <span>候选 Mapping：{preview.actual_candidate_count}</span>
          <span>预期 Binding：{preview.expected_binding_count}</span>
          <span>当前 Binding：{preview.current_binding_count}</span>
          <span>Binding {preview.current_binding_count} → 预期 {preview.expected_binding_count}</span>
        </div>
      </section>

      <section className="rfq-confirm-section" aria-label="RFQ 四条 Line">
        <h3>权威 RFQ Line · {preview.lines.length} 条</h3>
        <div className="rfq-confirm-lines">
          {preview.lines.map((line) => (
            <article key={line.id}>
              <b>RFQ Line ID {line.id} · Line {line.line_no} · Material {line.material_id}</b>
              <span>{line.internal_material_code} · {line.standard_name} · {statusLabel(line.material_status)}</span>
              <strong>{line.requested_quantity} {line.unit_code}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="rfq-confirm-section" aria-label="两家 Supplier 资格覆盖">
        <h3>Supplier 资格覆盖 · {preview.suppliers.length} 家</h3>
        <div className="rfq-qualification-suppliers">
          {preview.suppliers.map((supplier) => (
            <article className={supplier.eligible ? "eligible" : "blocked"} key={supplier.supplier_id}>
              <b>Supplier {supplier.supplier_id}：{supplier.coverage}</b>
              <span>{supplier.supplier_code} · {supplier.supplier_name} · {statusLabel(supplier.status)}</span>
              <small>必需 {supplier.required_material_count} · 合格 {supplier.eligible_mapping_count} · 缺失 {supplier.missing_material_count} · Supplier/Material 冲突 {supplier.supplier_material_conflict_count} · 供应商料号冲突 {supplier.supplier_part_number_conflict_count}</small>
            </article>
          ))}
        </div>
      </section>

      {preview.blocking_reasons.length ? (
        <section className="rfq-trace-issues" role="alert" aria-label="资格阻断项">
          <b>当前不可固定</b>
          <ul>{preview.blocking_reasons.map((reason, index) => (
            <li key={`${reason.code}:${reason.supplier_id || 0}:${reason.material_id || 0}:${index}`}>
              <b>{reason.code}</b>：{reason.message}；处理建议：{reason.suggestion}
              {reason.mapping_id ? <>；Mapping <TraceValue>{reason.mapping_id}</TraceValue></> : null}
            </li>
          ))}</ul>
        </section>
      ) : null}

      <section className="rfq-confirm-section" aria-label="八条 Mapping 资格证据">
        <h3>Supplier × RFQ Line Mapping · {preview.combinations.length} 条</h3>
        <QualificationMappingRows preview={preview} />
      </section>

      <section className="rfq-confirm-consequences" aria-label="不可变关系化快照说明">
        <h3>不可变关系化快照说明</h3>
        <p><b>确认后将生成{preview.expected_binding_count}条关系化、不可变的Supplier×RFQ Line Mapping Binding。</b></p>
        <p><b>每条Binding固定引用本次确认的Mapping ID和Version。后续Supplier Mapping状态、版本或内容发生变化时，不会自动替换或改写本RFQ已固定的Binding。</b></p>
        <ul>
          <li>固定字段映射不等于发出询价单；确认后询价单继续保持草稿 / 待发出。</li>
          <li>本操作不创建 Quote、Award、PO、库存或财务记录。</li>
          <li>正式发出仍需后续独立确认，并由服务端再次校验全部事实。</li>
          <li>当前预览不是提交锁；正式 POST 仍执行 CAS、幂等、并发、事务和完整资格重验。</li>
        </ul>
        <div className="rfq-trace-line"><span>资格摘要 SHA-256</span><TraceValue>{preview.qualification_digest}</TraceValue></div>
      </section>
    </>
  );
}

function ScopeSummary({ detail, rows }: { detail: RfqDialogDetail; rows: RfqMappingRow[] }) {
  return (
    <>
      <section className="rfq-confirm-section" aria-label="RFQ 标识与来源">
        <h3>RFQ 与来源</h3>
        <dl className="rfq-receipt-facts">
          <div><dt>RFQ</dt><dd>ID {detail.header.id} · {detail.header.rfq_code}</dd></div>
          <div><dt>Round / Version</dt><dd>Round {detail.header.round_no} / v{detail.header.version}</dd></div>
          <div><dt>当前状态</dt><dd>{statusLabel(detail.header.status)} / 待发出</dd></div>
          <div><dt>来源 PRQ</dt><dd>ID {detail.header.purchase_request_id} · {detail.header.request_code}</dd></div>
          <div><dt>项目</dt><dd>{detail.header.project_code} · {detail.header.project_name}</dd></div>
          <div><dt>报价截止</dt><dd>{shortDate(detail.header.response_deadline)}</dd></div>
          <div><dt>币种</dt><dd>{detail.header.currency_code}</dd></div>
        </dl>
      </section>
      <CreationReceiptView receipt={detail.creation_receipt} compact />
      <MappingBindingReceiptView receipt={detail.mapping_binding_receipt} compact />
      <section className="rfq-confirm-section" aria-label="发出前固定范围检查">
        <h3>发出前固定范围检查</h3>
        <dl className="rfq-receipt-facts">
          <div><dt>固定凭证</dt><dd>{detail.mapping_binding_receipt?.verified ? "完整 / 成功" : "缺失或未验证"}</dd></div>
          <div><dt>Binding 稳定 ID</dt><dd>{detail.mapping_binding_receipt?.binding_ids.length || 0} / {detail.lines.length * detail.suppliers.length}</dd></div>
          <div><dt>当前状态漂移</dt><dd>{rows.some((row) => row.status_drift) ? "存在" : "无"}</dd></div>
          <div><dt>当前版本漂移</dt><dd>{rows.some((row) => row.version_drift) ? "存在" : "无"}</dd></div>
        </dl>
      </section>
      <section className="rfq-confirm-section" aria-label="RFQ 行">
        <h3>固定范围 · {detail.lines.length} 条 Material</h3>
        <div className="rfq-confirm-lines">
          {detail.lines.map((line) => (
            <article key={line.id}>
              <b>Line {line.line_no} · Material {line.material_id ?? "—"}</b>
              <span>{line.internal_material_code} · {line.standard_name}</span>
              <strong>{line.requested_quantity} {line.unit_code}</strong>
            </article>
          ))}
        </div>
      </section>
      <section className="rfq-confirm-section" aria-label="受邀供应商">
        <h3>受邀 Supplier · {detail.suppliers.length} 家</h3>
        <div className="rfq-confirm-suppliers">
          {detail.suppliers.map((supplier) => <span key={supplier.supplier_id}>ID {supplier.supplier_id} · {supplier.supplier_code} · {supplier.supplier_name}</span>)}
        </div>
      </section>
      <section className="rfq-confirm-section" aria-label="Mapping 稳定标识与版本">
        <h3>{detail.mapping_traceability?.mode === "UNBOUND_LEGACY_DRAFT" ? "拟固定 Mapping" : "权威逐行关联（按 Binding ID 升序）"} · {rows.length} 条</h3>
        <MappingRows rows={rows} />
      </section>
    </>
  );
}

export function hasCompleteBindingIdentifiers(detail: RfqDialogDetail, rows: RfqMappingRow[]) {
  const expected = detail.lines.length * detail.suppliers.length;
  const receipt = detail.mapping_binding_receipt;
  const ids = rows.map((row) => String(row.binding_id || ""));
  const receiptIds = new Set(receipt?.binding_ids || []);
  return expected > 0
    && rows.length === expected
    && ids.every((bindingId) => /^[1-9]\d*$/.test(bindingId))
    && new Set(ids).size === expected
    && rows.every((row) => Boolean(row.mapping_id) && Number.isSafeInteger(Number(row.mapping_version)))
    && receipt?.verified === true
    && receipt.result === "SUCCESS"
    && receipt.binding_count === expected
    && receipt.binding_ids.length === expected
    && receiptIds.size === expected
    && ids.every((bindingId) => receiptIds.has(bindingId));
}

export function RfqScopeDialog({
  kind,
  detail,
  mappingPreview,
  previewLoading = false,
  previewError = "",
  busy,
  onCancel,
  onConfirm,
}: {
  kind: "issue" | "bind";
  detail: RfqDialogDetail;
  mappingPreview?: RfqMappingQualificationPreview | null;
  previewLoading?: boolean;
  previewError?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const trace = detail.mapping_traceability;
  const rows = kind === "bind" || trace?.mode === "UNBOUND_LEGACY_DRAFT" ? trace?.current_qualification || [] : trace?.bindings || [];
  const expectedMappings = detail.lines.length * detail.suppliers.length;
  const confirmReady = kind === "issue"
    ? Boolean(detail.creation_receipt?.result === "SUCCESS" && trace?.complete && trace.can_issue && trace.mode !== "UNBOUND_LEGACY_DRAFT" && rows.length === expectedMappings && hasCompleteBindingIdentifiers(detail, rows))
    : Boolean(mappingPreview?.qualification_passed);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus.current?.focus();
    };
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  const title = kind === "issue" ? "发出询价并冻结范围" : "确认并固定当前 Mapping";
  const confirmLabel = kind === "issue" ? "确认发出" : title;
  return (
    <div className="rfq-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section
        ref={dialogRef}
        className="rfq-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rfq-scope-dialog-title"
        aria-busy={busy || previewLoading}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="rfq-dialog-heading">
          <div><p className="rfq-eyebrow">{kind === "issue" ? "询价发出确认" : "字段映射固定确认"}</p><h2 id="rfq-scope-dialog-title">{title}</h2></div>
          <button type="button" className="rfq-dialog-close" aria-label="关闭确认窗口" disabled={busy} onClick={onCancel}>关闭</button>
        </div>
        <div className="rfq-dialog-body">
          {kind === "bind" ? (
            previewLoading ? (
              <div className="rfq-trace-warning" role="status"><b>正在重新查询当前权威资格与冲突证据…</b><p>服务端正在读取 RFQ、PRQ、四条 Line、两家 Supplier、Mapping 与既有 Binding；此查询零业务写入。</p></div>
            ) : previewError ? (
              <div className="rfq-trace-issues" role="alert"><b>权威预览读取失败，已禁止固定</b><p className="rfq-copyable-error">{previewError}</p><p>请取消并刷新页面后重试；当前不会发送固定请求。</p></div>
            ) : mappingPreview ? <MappingQualificationPreviewView preview={mappingPreview} /> : (
              <div className="rfq-trace-issues" role="alert"><b>权威预览缺失，已禁止固定</b></div>
            )
          ) : (
            <>
              <ScopeSummary detail={detail} rows={rows} />
              <section className="rfq-confirm-consequences" aria-label="发出后果">
                <h3>发出后果</h3>
                <ul>
                  <li>发出前服务端重新校验 PRQ、Supplier、Mapping、截止日期、CAS 与当前草稿状态。</li>
                  <li>Mapping 失效、版本漂移或组合冲突时整笔失败，不留下半记录，并显示具体组合。</li>
                  <li>发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结，不可原地修改。</li>
                  <li>只有发出成功后才允许录入 Supplier 报价。</li>
                </ul>
                <p><b>本次发出不会自动创建或修改以下下游记录：</b></p>
                <ul>
                  <li>Quote（供应商报价）</li>
                  <li>Award（定标）</li>
                  <li>PO（采购订单）</li>
                  <li>Delivery Plan（交付计划）</li>
                  <li>Receipt／收货</li>
                  <li>Inventory Ledger／库存流水</li>
                  <li>AP／采购应付</li>
                  <li>Work Order／生产工单</li>
                  <li>其他生产记录</li>
                  <li>财务记录</li>
                </ul>
              </section>
            </>
          )}
          {kind === "issue" && !confirmReady ? (
            <div className="rfq-trace-issues" role="alert">
              <b>当前不可发出</b>
              <p>{trace?.mode === "UNBOUND_LEGACY_DRAFT" ? "历史草稿尚未固定 Mapping。请先退出本窗口，使用独立的显式固定操作。" : trace?.issues.join("；") || `Mapping 覆盖必须精确为 ${detail.suppliers.length} × ${detail.lines.length}，每条都必须有真实且唯一的 Binding ID、Mapping ID / Version 和完整固定事件凭证，且全部有效、无漂移。`}</p>
            </div>
          ) : null}
        </div>
        <div className="rfq-dialog-actions">
          <button ref={cancelRef} type="button" className="rfq-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" disabled={busy || previewLoading || !confirmReady} onClick={(event) => {
            event.currentTarget.disabled = true;
            onConfirm();
          }}>{busy ? "正在提交…" : previewLoading ? "正在查询…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
