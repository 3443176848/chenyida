"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

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
  current_status: string | null;
  current_bound_mapping_version?: number | null;
  current_bound_row_version?: number | null;
  latest_mapping_status?: string | null;
  current_mapping_version?: number | null;
  current_mapping_row_version?: number | null;
  status_drift: boolean;
  version_drift: boolean;
  eligible: boolean;
  issue_reason: string;
};

export type RfqMappingTraceability = {
  mode: "BOUND_AT_CREATE" | "BOUND_BY_EXPLICIT_CONFIRMATION" | "UNBOUND_LEGACY_DRAFT";
  complete: boolean;
  can_issue: boolean;
  summary: string;
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
    id: number;
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
  mapping_traceability: RfqMappingTraceability | null;
  downstream_counts: RfqDownstreamCounts;
  issue_receipt: RfqIssueReceipt | null;
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
  return (
    <section className={compact ? "rfq-receipt compact" : "rfq-receipt"} aria-label="RFQ 创建凭证">
      <div className="rfq-section-heading">
        <div>
          <p className="rfq-eyebrow">CREATION RECEIPT</p>
          <h3>{receipt.result === "SUCCESS" ? "RFQ 创建成功凭证" : "RFQ 创建凭证未验证"}</h3>
        </div>
        <span className={receipt.result === "SUCCESS" ? "rfq-proof success" : "rfq-proof"}>{receipt.result}</span>
      </div>
      <dl className="rfq-receipt-facts">
        <div><dt>权威来源</dt><dd>{receipt.authority}</dd></div>
        <div><dt>不可变事件 / 操作</dt><dd>{receipt.event_type} · ID {receipt.operation_id ?? "—"}</dd></div>
        <div><dt>创建 actor</dt><dd>{receipt.actor}</dd></div>
        <div><dt>精确时间</dt><dd>{formatShanghaiTime(receipt.occurred_at, receipt.occurred_at_shanghai)}</dd></div>
        <div><dt>创建前后 Version / CAS</dt><dd>{receipt.old_version === null ? "不存在" : `v${receipt.old_version}`} → {receipt.new_version === null ? "未验证" : `v${receipt.new_version}`}</dd></div>
        <div><dt>不可变</dt><dd>{receipt.immutable ? "是" : "否"}</dd></div>
      </dl>
      <div className="rfq-trace-line"><span>request_id</span><TraceValue>{receipt.request_id}</TraceValue></div>
      {receipt.scope_digest ? <div className="rfq-trace-line"><span>冻结范围摘要</span><TraceValue>{receipt.scope_digest}</TraceValue></div> : null}
      <div className="rfq-trace-line"><span>Idempotency-Key 摘要</span><TraceValue>{receipt.idempotency_key_digest}</TraceValue></div>
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
  for (const row of rows) groups.set(row.supplier_id, [...(groups.get(row.supplier_id) || []), row]);
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
              <span>当前供应商状态：{supplier.supplier_status}</span>
            </div>
            <div className="rfq-mapping-list">
              {supplierRows.map((row) => (
                <article className={row.eligible && !row.status_drift && !row.version_drift ? "rfq-mapping-card" : "rfq-mapping-card drift"} key={`${supplierId}:${row.material_id}:${row.mapping_id}`}>
                  <div className="rfq-mapping-title">
                    <b>Material ID {row.material_id} · {row.internal_material_code}</b>
                    <span>{row.standard_name}</span>
                  </div>
                  <dl>
                    <div><dt>supplier_part_number</dt><dd>{row.supplier_part_number || "—"}</dd></div>
                    <div className="wide"><dt>Mapping ID</dt><dd><TraceValue>{row.mapping_id}</TraceValue></dd></div>
                    <div><dt>Mapping Version</dt><dd>{row.mapping_version === null ? "—" : `v${row.mapping_version}`} / {row.mapping_row_version === null ? "Row —" : `Row v${row.mapping_row_version}`}</dd></div>
                    <div><dt>单位换算</dt><dd>{row.purchase_unit_code || "—"} → {row.base_unit_code || "—"} · {row.conversion_numerator ?? "—"}:{row.conversion_denominator ?? "—"}</dd></div>
                    <div><dt>有效期</dt><dd>{shortDate(row.valid_from)} — {shortDate(row.valid_to) === "—" ? "长期" : shortDate(row.valid_to)}</dd></div>
                    <div><dt>{row.binding_source === "CURRENT_QUALIFICATION" ? "资格状态 / 来源" : "绑定时状态 / 来源"}</dt><dd>{row.binding_source === "CURRENT_QUALIFICATION" ? `${row.current_status || "—"} · 当前资格检查（尚未固定）` : `${row.binding_status || "尚未固定"} · ${row.binding_source}`}</dd></div>
                    <div><dt>RFQ 邀请状态</dt><dd>{row.invitation_status || "—"}</dd></div>
                    <div><dt>已绑定版本当前状态</dt><dd>{row.current_status || "—"} · v{row.current_bound_mapping_version ?? row.mapping_version ?? "—"} / Row v{row.current_bound_row_version ?? row.mapping_row_version ?? "—"}</dd></div>
                    <div><dt>最新 Mapping 版本</dt><dd>{row.latest_mapping_status || row.current_status || "—"} · v{row.current_mapping_version ?? row.mapping_version ?? "—"} / Row v{row.current_mapping_row_version ?? row.mapping_row_version ?? "—"}</dd></div>
                    <div><dt>当前状态漂移</dt><dd>{row.binding_source === "CURRENT_QUALIFICATION" ? "不适用（尚未固定）" : row.status_drift ? "是" : "否"}</dd></div>
                    <div><dt>当前版本漂移</dt><dd>{row.binding_source === "CURRENT_QUALIFICATION" ? "不适用（尚未固定）" : row.version_drift ? "是" : "否"}</dd></div>
                    {row.bound_by || row.bound_at || row.binding_request_id ? <div className="wide"><dt>固定凭证</dt><dd>{row.bound_by || "—"} · {formatShanghaiTime(row.bound_at)} · <TraceValue>{row.binding_request_id}</TraceValue></dd></div> : null}
                  </dl>
                  {row.issue_reason ? <p className="rfq-mapping-issue">{row.issue_reason}</p> : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
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
          <p className="rfq-eyebrow">MAPPING TRACEABILITY</p>
          <h3>Supplier / Material Mapping 追溯</h3>
        </div>
        <span className={trace.complete ? "rfq-proof success" : "rfq-proof warning"}>{modeLabels[trace.mode]}</span>
      </div>
      <p className="rfq-proof-note">{trace.summary}</p>
      {proposed ? (
        <div className="rfq-trace-warning">
          <b>当前资格检查 / 尚未冻结的拟绑定 Mapping</b>
          <p>这些记录是当前 ACTIVE Mapping 的资格检查结果，不代表 RFQ 创建时已经绑定。只有采购人员显式确认后，才会形成可追溯的稳定 Mapping ID 与 Version；本页不会自动执行该操作。</p>
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
        <div><p className="rfq-eyebrow">ISSUANCE RECEIPT</p><h3>RFQ 发出成功凭证</h3></div>
        <span className="rfq-proof success">{receipt.result}</span>
      </div>
      <dl className="rfq-receipt-facts">
        <div><dt>Event</dt><dd>{receipt.event_type || receipt.event || "ISSUED"}</dd></div>
        <div><dt>actor</dt><dd>{receipt.actor}</dd></div>
        <div><dt>精确时间</dt><dd>{formatShanghaiTime(receipt.occurred_at, receipt.occurred_at_shanghai)}</dd></div>
        <div><dt>发出前后 Version / CAS</dt><dd>{oldVersion === null || oldVersion === undefined ? "—" : `v${oldVersion}`} → {newVersion === undefined ? "—" : `v${newVersion}`}</dd></div>
        <div><dt>最终状态</dt><dd>{receipt.to_status || receipt.final_status || receipt.status || detail.header.status} / 已发出</dd></div>
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

function ScopeSummary({ detail, rows }: { detail: RfqDialogDetail; rows: RfqMappingRow[] }) {
  return (
    <>
      <section className="rfq-confirm-section" aria-label="RFQ 标识与来源">
        <h3>RFQ 与来源</h3>
        <dl className="rfq-receipt-facts">
          <div><dt>RFQ</dt><dd>ID {detail.header.id} · {detail.header.rfq_code}</dd></div>
          <div><dt>Round / Version</dt><dd>Round {detail.header.round_no} / v{detail.header.version}</dd></div>
          <div><dt>当前状态</dt><dd>{detail.header.status} / 草稿 / 待发出</dd></div>
          <div><dt>来源 PRQ</dt><dd>ID {detail.header.purchase_request_id} · {detail.header.request_code}</dd></div>
          <div><dt>项目</dt><dd>{detail.header.project_code} · {detail.header.project_name}</dd></div>
          <div><dt>报价截止</dt><dd>{shortDate(detail.header.response_deadline)}</dd></div>
          <div><dt>币种</dt><dd>{detail.header.currency_code}</dd></div>
        </dl>
      </section>
      <CreationReceiptView receipt={detail.creation_receipt} compact />
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
        <h3>{detail.mapping_traceability?.mode === "UNBOUND_LEGACY_DRAFT" ? "拟固定 Mapping" : "已固定 Mapping"} · {rows.length} 条</h3>
        <MappingRows rows={rows} />
      </section>
    </>
  );
}

export function RfqScopeDialog({
  kind,
  detail,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: "issue" | "bind";
  detail: RfqDialogDetail;
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
  const qualificationReady = rows.length === expectedMappings && expectedMappings > 0
    && rows.every((row) => row.eligible && !row.status_drift && !row.version_drift && Boolean(row.mapping_id));
  const confirmReady = kind === "issue"
    ? Boolean(detail.creation_receipt?.result === "SUCCESS" && trace?.complete && trace.can_issue && trace.mode !== "UNBOUND_LEGACY_DRAFT" && rows.length === expectedMappings)
    : Boolean(trace?.mode === "UNBOUND_LEGACY_DRAFT" && qualificationReady);

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
  return (
    <div className="rfq-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section
        ref={dialogRef}
        className="rfq-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rfq-scope-dialog-title"
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="rfq-dialog-heading">
          <div><p className="rfq-eyebrow">{kind === "issue" ? "ISSUANCE CONFIRMATION" : "MAPPING BINDING CONFIRMATION"}</p><h2 id="rfq-scope-dialog-title">{title}</h2></div>
          <button type="button" className="rfq-dialog-close" aria-label="关闭确认窗口" disabled={busy} onClick={onCancel}>关闭</button>
        </div>
        <div className="rfq-dialog-body">
          <ScopeSummary detail={detail} rows={rows} />
          {kind === "issue" ? (
            <section className="rfq-confirm-consequences" aria-label="发出后果">
              <h3>发出后果</h3>
              <ul>
                <li>发出前服务端重新校验 PRQ、Supplier、Mapping、截止日期、CAS 与当前 DRAFT 状态。</li>
                <li>Mapping 失效、版本漂移或组合冲突时整笔失败，不留下半记录，并显示具体组合。</li>
                <li>发出成功后 RFQ 行、Supplier 与 Mapping ID / Version 范围冻结，不可原地修改。</li>
                <li>只有发出成功后才允许录入 Supplier 报价。</li>
                <li>本操作不自动创建 Quote、Award、PO、库存或财务记录。</li>
              </ul>
            </section>
          ) : (
            <section className="rfq-confirm-consequences" aria-label="Mapping 固定后果">
              <h3>显式固定说明</h3>
              <ul>
                <li>此操作仅为历史草稿建立当前 2 × 4 Mapping 的稳定 ID 与 Version 绑定，不会伪造为创建时绑定。</li>
                <li>服务端将重新校验当前 Mapping 的有效性、冲突、版本与 RFQ CAS，并记录 actor、时间和 request_id。</li>
                <li>确认后 RFQ 仍保持 DRAFT / 草稿 / 待发出；不会发出 RFQ，也不会创建任何下游记录。</li>
              </ul>
            </section>
          )}
          {!confirmReady ? (
            <div className="rfq-trace-issues" role="alert">
              <b>{kind === "issue" ? "当前不可发出" : "当前不可固定"}</b>
              <p>{kind === "issue" && trace?.mode === "UNBOUND_LEGACY_DRAFT" ? "历史草稿尚未固定 Mapping。请先退出本窗口，使用独立的显式固定操作。" : trace?.issues.join("；") || `Mapping 覆盖必须精确为 ${detail.suppliers.length} × ${detail.lines.length}，且全部有效、无漂移。`}</p>
            </div>
          ) : null}
        </div>
        <div className="rfq-dialog-actions">
          <button ref={cancelRef} type="button" className="rfq-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" disabled={busy || !confirmReady} onClick={(event) => {
            event.currentTarget.disabled = true;
            onConfirm();
          }}>{busy ? "正在提交…" : title}</button>
        </div>
      </section>
    </div>
  );
}
