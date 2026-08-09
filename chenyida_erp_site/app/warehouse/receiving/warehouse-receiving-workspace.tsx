"use client";

import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  ErpApiError,
  isHistorySessionRestore,
  logoutSession,
  setProtectedViewState,
  suspendProtectedViews,
} from "../../../public/erp/api-client.js";
import { roleLabel, statusLabel } from "../../../public/erp/status-localization.js";
import type { WarehouseReceiptReadiness } from "../../lib/procurement-fulfillment-selfhost/warehouse-receipt-readiness.ts";
import "../../procurement/sourcing/sourcing.css";
import "./warehouse-receiving.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null; csrf_token?: string };
type Queue = {
  queue_id: number;
  queue_version: number;
  id: number;
  purchase_order_id: number;
  po_code: string;
  po_status: string;
  po_version: number;
  version: number;
  purchase_order_line_id: number;
  purchase_order_line_version: number;
  supplier_code: string;
  supplier_name: string;
  internal_material_code: string;
  standard_name: string;
  unit_code: string;
  inventory_type: string;
  inspection_type: string;
  planned_quantity: string;
  received_quantity: string;
  remaining_quantity: string;
  promised_delivery_date: string;
  balance_version: number;
  on_hand_quantity: string;
  overdue: boolean;
};
type ReceiptDraft = {
  quantity: string;
  evidence_type: string;
  evidence_reference: string;
  evidence_document_date: string;
  supplier_lot_code: string;
  early_arrival_reason: string;
  early_arrival_confirmed: boolean;
  physical_receipt_confirmed: boolean;
  reason: string;
};
type ReceiptPreviewError = { deliveryPlanId: number; text: string };

const EMPTY_DRAFT: ReceiptDraft = {
  quantity: "",
  evidence_type: "",
  evidence_reference: "",
  evidence_document_date: "",
  supplier_lot_code: "",
  early_arrival_reason: "",
  early_arrival_confirmed: false,
  physical_receipt_confirmed: false,
  reason: "",
};
const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const message = (error: unknown) => error instanceof ErpApiError
  ? `${error.message}（${error.code}${error.requestId ? ` · 请求 ${error.requestId}` : ""}）`
  : "系统暂时无法完成请求";
const display = (value: string | null | undefined) => value?.trim() || "未填写";
const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function WarehouseReceivingWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Queue[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<WarehouseReceiptReadiness | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft>(EMPTY_DRAFT);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [previewError, setPreviewError] = useState<ReceiptPreviewError | null>(null);
  const previewRun = useRef(0);
  const postInFlight = useRef(false);
  const idempotencyKey = useRef("");
  const trigger = useRef<HTMLElement | null>(null);

  const clearProtectedState = useCallback(() => {
    setRows([]); setPreview(null); setDraft(EMPTY_DRAFT); setDialogError("");
    setPreviewLoading(false); setPosting(false); setSubmitted(false); setPreviewError(null);
    previewRun.current += 1; postInFlight.current = false; idempotencyKey.current = ""; trigger.current = null;
  }, []);
  const load = useCallback(async () => {
    suspendProtectedViews();
    setError("");
    try {
      const current = await api<Session>("/api/session", { cache: "no-store" });
      setSession(current);
      if (!current.authenticated || !can(current.user, "procurement.fulfillment.read")) {
        clearProtectedState(); setProtectedViewState(current.authenticated ? "authenticated" : "anonymous"); return;
      }
      const response = await api<{ data: Queue[] }>("/api/procurement/fulfillment/receiving-queue?page_size=100", { cache: "no-store" });
      setRows(response.data); setProtectedViewState("authenticated");
    } catch (loadError) {
      clearProtectedState(); setSession(null); setProtectedViewState("anonymous"); setError(message(loadError));
    }
  }, [clearProtectedState]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const hide = () => suspendProtectedViews();
    const show = (event: PageTransitionEvent) => { if (isHistorySessionRestore(event)) void load(); };
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show);
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); };
  }, [load]);

  function resetConfirmationState(restoreFocus = false) {
    previewRun.current += 1; postInFlight.current = false; idempotencyKey.current = "";
    setPreviewLoading(false); setPreview(null); setDraft(EMPTY_DRAFT); setPosting(false);
    setSubmitted(false); setDialogError("");
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus());
  }

  async function openPreview(event: FormEvent<HTMLFormElement>, row: Queue) {
    event.preventDefault();
    if (previewLoading || posting) return;
    trigger.current = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const values = new FormData(event.currentTarget);
    const nextDraft: ReceiptDraft = {
      quantity: String(values.get("quantity") || "").trim(),
      evidence_type: String(values.get("evidence_type") || ""),
      evidence_reference: String(values.get("evidence_reference") || "").trim(),
      evidence_document_date: String(values.get("evidence_document_date") || ""),
      supplier_lot_code: String(values.get("supplier_lot_code") || "").trim(),
      early_arrival_reason: String(values.get("early_arrival_reason") || "").trim(),
      early_arrival_confirmed: values.get("early_arrival_confirmed") === "on",
      physical_receipt_confirmed: values.get("physical_receipt_confirmed") === "on",
      reason: String(values.get("reason") || "").trim(),
    };
    const run = previewRun.current + 1; previewRun.current = run;
    setDraft(nextDraft); setPreview(null); setDialogError(""); setPreviewError(null); setError(""); setNotice("");
    setPosting(false); setSubmitted(false); postInFlight.current = false; idempotencyKey.current = ""; setPreviewLoading(true);
    try {
      const parameters = new URLSearchParams();
      if (nextDraft.quantity) parameters.set("quantity", nextDraft.quantity);
      if (nextDraft.evidence_document_date) parameters.set("evidence_document_date", nextDraft.evidence_document_date);
      const encoded = parameters.toString(), query = encoded ? `?${encoded}` : "";
      const response = await api<{ data: WarehouseReceiptReadiness }>(`/api/procurement/delivery-plans/${row.id}/receipt-preview${query}`, { cache: "no-store" });
      if (previewRun.current !== run) return;
      if (response.data.contract_version !== "WAREHOUSE_RECEIPT_READINESS_V1"
          || response.data.read_only !== true || response.data.selected_receipt.delivery_plan_id !== String(row.id)) {
        throw new Error("receipt readiness preview mismatch");
      }
      idempotencyKey.current = crypto.randomUUID();
      setPreview(response.data);
    } catch (previewError) {
      if (previewRun.current === run) {
        resetConfirmationState();
        setPreviewError({ deliveryPlanId: row.id, text: message(previewError) });
      }
    } finally { if (previewRun.current === run) setPreviewLoading(false); }
  }

  function cancelPreview() {
    if (posting) return;
    resetConfirmationState(true);
  }

  function confirmationReady(value: WarehouseReceiptReadiness) {
    const supplierLotReady = value.selected_receipt.supplier_lot.applicability === "NOT_APPLICABLE" || Boolean(draft.supplier_lot_code);
    const earlyReady = !value.selected_receipt.is_early_arrival || (Boolean(draft.early_arrival_reason) && draft.early_arrival_confirmed);
    const evidenceDateReady = canonicalDatePattern.test(draft.evidence_document_date)
      && draft.evidence_document_date === value.selected_receipt.evidence_document_date
      && draft.evidence_document_date <= value.selected_receipt.server_date_shanghai;
    return value.selected_receipt.authoritative_state_ready && value.selected_receipt.quantity !== null
      && Boolean(draft.evidence_type && draft.evidence_reference && draft.reason) && evidenceDateReady
      && draft.physical_receipt_confirmed && supplierLotReady && earlyReady;
  }

  async function confirmReceipt(button: HTMLButtonElement) {
    if (!session?.csrf_token || !preview || postInFlight.current || submitted || !confirmationReady(preview)) return;
    button.disabled = true;
    postInFlight.current = true; setSubmitted(true); setPosting(true); setDialogError("");
    try {
      const result = await api<{ lot_code?: string; data?: { inventory_lots?: Array<{ lot_code: string }> } }>(
        `/api/procurement/delivery-plans/${preview.selected_receipt.delivery_plan_id}/receipts`,
        {
          method: "POST",
          body: JSON.stringify({
            expected_purchase_order_version: preview.confirmation.expected_purchase_order_version,
            expected_line_version: preview.confirmation.expected_line_version,
            expected_version: preview.confirmation.expected_version,
            expected_queue_version: preview.confirmation.expected_queue_version,
            expected_balance_version: preview.confirmation.expected_balance_version,
            expected_early_arrival: preview.confirmation.expected_early_arrival,
            expected_target_location_code: preview.confirmation.expected_target_location_code,
            quantity: draft.quantity,
            supplier_lot_code: draft.supplier_lot_code,
            evidence_type: draft.evidence_type,
            evidence_reference: draft.evidence_reference,
            evidence_document_date: draft.evidence_document_date,
            early_arrival_reason: preview.selected_receipt.is_early_arrival ? draft.early_arrival_reason : "",
            early_arrival_confirmed: preview.selected_receipt.is_early_arrival && draft.early_arrival_confirmed,
            physical_receipt_confirmed: draft.physical_receipt_confirmed,
            reason: draft.reason,
          }),
          protectedWrite: { csrfToken: session.csrf_token, idempotencyKey: idempotencyKey.current },
        },
      );
      const lot = result.lot_code ?? result.data?.inventory_lots?.[0]?.lot_code;
      setNotice(lot
        ? `实际物理收货已原子过账；内部Lot ${lot} 已进入IQC冻结，quality放行前可用量为0。`
        : "实际物理收货、关系化证据、计划、queue、库存Ledger与采购金额来源已在同一事务过账；未自动创建AP或生产记录。");
      setPreview(null); setDraft(EMPTY_DRAFT); await load();
    } catch (postError) {
      setDialogError(`${message(postError)}。本窗口不会自动重试；请关闭后重新执行“核对收货”。`);
    } finally { setPosting(false); }
  }

  async function logout() {
    if (!session?.csrf_token) { setError("当前页面缺少CSRF上下文，请刷新后再安全退出。"); return; }
    suspendProtectedViews();
    try {
      await logoutSession(session.csrf_token); clearProtectedState(); setSession({ authenticated: false, user: null });
      window.location.replace("/");
    } catch (logoutError) { setProtectedViewState("authenticated"); setError(message(logoutError)); }
  }

  if (!session) return <main className="sourcing-shell">{error || "正在读取会话…"}</main>;
  if (!session.authenticated) return <main className="sourcing-shell">请先登录。</main>;
  if (!can(session.user, "procurement.fulfillment.read")) return <main className="sourcing-shell"><div className="sourcing-state sourcing-error">没有仓库收货读取权限。</div></main>;

  return <main className="sourcing-shell warehouse-readiness" data-cyd-protected-view>
    <div className="sourcing-banner">实际物理收货 · 必须先GET权威核对再最终确认 · 供应商通知或在途登记当前未建模</div>
    <header className="sourcing-header"><div><Link href="/" className="sourcing-back">← 经营工作台</Link><p className="sourcing-kicker">WAREHOUSE RECEIPT READINESS</p><h1>仓库收货准备与证据核对</h1><p>PO OPEN不代表已到货；Plan PENDING不代表已收货；queue OPEN_PENDING不代表库存增加。</p></div><div><b>{session.user!.display_name || session.user!.username}</b><span>{roleLabel(session.user!.role)}</span><button type="button" className="warehouse-quiet" onClick={() => void logout()}>安全退出</button></div></header>
    <section className="warehouse-boundary" aria-label="职责与过账边界">
      <strong>职责边界</strong><span>warehouse只登记实际物理收货；IQC检验、处置与关闭由quality负责。</span><span>收货不会自动创建AP、付款、Work Order或其他生产记录。</span>
    </section>
    <section className="sourcing-panel"><h2>待入库队列</h2>{rows.map((row) => {
      const iqc = row.inventory_type === "STOCKED" && row.inspection_type === "IQC";
      return <article className="sourcing-card warehouse-receipt-card" key={row.id}><div><b>PO #{row.purchase_order_id} · {row.po_code} · v{row.po_version}</b><span className={`sourcing-status status-${row.overdue ? "late" : "pending"}`}>{row.overdue ? "逾期未收" : "计划待到货"}</span></div><p>{row.supplier_code} · {row.supplier_name} · Line #{row.purchase_order_line_id} · {row.internal_material_code}</p><small>{row.standard_name} · Plan #{row.id}/v{row.version} · queue #{row.queue_id}/v{row.queue_version}<br/>计划 {row.planned_quantity} · 已收 {row.received_quantity} · 未收 {row.remaining_quantity} {row.unit_code} · 承诺 {String(row.promised_delivery_date).slice(0, 10)}<br/>当前现存 {row.on_hand_quantity} · 检验 {row.inspection_type}</small>{can(session.user, "procurement.receiving.receive") ? <form className="warehouse-receipt-form" onSubmit={(event) => void openPreview(event, row)} noValidate>
        <label>本次收货数量（不预填）<input name="quantity" inputMode="decimal" autoComplete="off" placeholder="核对后填写；可留空先看预览" /></label>
        <label>送货凭证类型<select name="evidence_type" defaultValue=""><option value="">未选择</option><option value="DELIVERY_NOTE">送货单</option><option value="LOGISTICS_HANDOVER">物流交接凭证</option><option value="OTHER_EQUIVALENT">其他等价来源凭证</option></select></label>
        <label>送货凭证编号<input name="evidence_reference" autoComplete="off" maxLength={128} placeholder="不填写虚假凭证" /></label>
        <label>凭证日期<input name="evidence_document_date" type="date" autoComplete="off" /></label>
        {iqc ? <label>Supplier批次（IQC必填）<input name="supplier_lot_code" autoComplete="off" maxLength={64} placeholder="由实物标签或真实凭证取得" /></label> : <><input name="supplier_lot_code" type="hidden" value=""/><p className="warehouse-model-note">当前实际模式不需要Supplier批次，不得伪造供应商批次。</p></>}
        <label>提前到货原因（仅提前时）<textarea name="early_arrival_reason" maxLength={1000} placeholder="不预填；必须基于真实提前到货事实" /></label>
        <label className="warehouse-check"><input name="early_arrival_confirmed" type="checkbox" />若服务端判定提前到货，我已明确核对并确认该原因</label>
        <label className="warehouse-check"><input name="physical_receipt_confirmed" type="checkbox" />我确认实物已实际到达系统固定MAIN库位；不是通知或在途登记</label>
        <label>收货说明（不预填）<textarea name="reason" maxLength={1000} placeholder="记录实际收货说明；可留空先看预览" /></label>
        <button type="submit" disabled={previewLoading || posting}>核对收货</button>
      </form> : null}{previewError?.deliveryPlanId === row.id ? <div className="sourcing-state sourcing-error" role="alert" data-receipt-preview-error>{previewError.text}</div> : null}</article>;
    })}{!rows.length ? <div className="sourcing-state">当前没有待入库计划。</div> : null}</section>
    {notice ? <div className="sourcing-state">{notice}</div> : null}{error ? <div className="sourcing-state sourcing-error" role="alert">{error}</div> : null}
    {previewLoading ? <ReceiptLoadingDialog onCancel={cancelPreview} /> : null}
    {preview ? <ReceiptConfirmationDialog preview={preview} draft={draft} ready={confirmationReady(preview)} busy={posting} submitted={submitted} error={dialogError} onCancel={cancelPreview} onConfirm={confirmReceipt} /> : null}
  </main>;
}

const focusableSelector = "button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
function DialogFrame({ title, busy, onCancel, children, actions }: { title: string; busy: boolean; onCancel: () => void; children: ReactNode; actions?: ReactNode }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  function keyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    if (!nodes.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
    const first = nodes[0], last = nodes[nodes.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) { event.preventDefault(); first.focus(); }
  }
  return <div className="rfq-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><section ref={dialogRef} className="rfq-dialog warehouse-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="warehouse-receipt-dialog-title" aria-busy={busy} tabIndex={-1} onKeyDown={keyDown}><header className="rfq-dialog-heading"><div><p className="rfq-eyebrow">实际物理收货 · 权威GET预览</p><h2 id="warehouse-receipt-dialog-title">{title}</h2></div><button type="button" className="rfq-dialog-close" aria-label="关闭收货确认窗口" disabled={busy} onClick={onCancel}>关闭</button></header><div className="rfq-dialog-body">{children}</div><footer className="rfq-dialog-actions"><button ref={cancelRef} type="button" className="rfq-secondary" disabled={busy} onClick={onCancel}>返回修改</button>{actions}</footer></section></div>;
}
function ReceiptLoadingDialog({ onCancel }: { onCancel: () => void }) {
  return <DialogFrame title="正在重新读取PO、Line、Plan与queue" busy={false} onCancel={onCancel}><div className="sourcing-state"><span className="sourcing-spinner"/>只执行权威GET；返回修改不会发送业务POST。</div></DialogFrame>;
}
function ReceiptConfirmationDialog({ preview, draft, ready, busy, submitted, error, onCancel, onConfirm }: {
  preview: WarehouseReceiptReadiness;
  draft: ReceiptDraft;
  ready: boolean;
  busy: boolean;
  submitted: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (button: HTMLButtonElement) => Promise<void>;
}) {
  const po = preview.purchase_order, selected = preview.selected_receipt, counts = preview.downstream;
  return <DialogFrame title={`核对 ${po.po_code} 收货准备`} busy={busy} onCancel={onCancel} actions={<button type="button" className="warehouse-final-post" disabled={busy || submitted || !ready} onClick={(event) => void onConfirm(event.currentTarget)}>{busy ? "正在原子过账…" : submitted ? "本窗口已提交，不会重试" : "确认过账收货"}</button>}>
    <p className="warehouse-confirm-warning">{selected.is_early_arrival ? "服务端判定：提前到货。缺少真实送货凭证、提前原因或明确确认时，最终按钮保持禁用且服务端拒绝。" : "服务端判定：当前不属于提前到货；仍须有真实送货凭证并确认实物已到MAIN。"}</p>
    <section className="warehouse-preview-section"><h3>PO聚合与创建证据</h3><dl className="warehouse-preview-grid"><div><dt>稳定PO</dt><dd>#{po.id} · {po.po_code} · v{po.version} · {statusLabel(po.status)}</dd></div><div><dt>Project</dt><dd>#{po.project.id} · {po.project.code} · {po.project.name}</dd></div><div><dt>Supplier</dt><dd>#{po.supplier.id} · {po.supplier.code} · {po.supplier.name}</dd></div><div><dt>金额</dt><dd>{po.total_amount} {po.currency_code} · {po.tax_included ? "含税" : "未税"} · {po.freight_included ? "含运费" : "不含运费"}</dd></div><div className="wide"><dt>付款条件</dt><dd>{po.payment_terms} · 来源 {po.commercial_terms_source}</dd></div><div><dt>创建actor / 上海时间</dt><dd>{preview.creation_evidence.actor} · {preview.creation_evidence.created_at_shanghai}</dd></div><div className="wide"><dt>请求与操作</dt><dd>request_id {preview.creation_evidence.request_id}<br/>operation {preview.creation_evidence.operation_id}<br/>{preview.creation_evidence.action} · {preview.creation_evidence.result}</dd></div></dl></section>
    <section className="warehouse-preview-section"><h3>四层稳定谱系</h3><div className="warehouse-lineage-list">{preview.lines.map((line) => <article key={line.purchase_order_line_id}><b>PO Line #{line.purchase_order_line_id} / v{line.version} · Award Line #{line.award_line_id}</b><span>Material #{line.material_id} · {line.material_code} · {line.material_name}</span><span>数量 {line.quantity} · 已收 {line.received_quantity} · 未收 {line.remaining_quantity} {line.unit_code}</span><span>Plan #{line.delivery_plan.id}/v{line.delivery_plan.version} · {line.delivery_plan.status} · 计划 {line.delivery_plan.promised_delivery_date}</span><span>queue #{line.queue.id}/v{line.queue.version} · {line.queue.status}</span></article>)}</div></section>
    <section className="warehouse-preview-section"><h3>本次权威收货核对</h3><dl className="warehouse-preview-grid"><div><dt>服务端当前时间</dt><dd>{selected.server_time_shanghai}</dd></div><div><dt>承诺/计划日期</dt><dd>{selected.promised_delivery_date}</dd></div><div className="wide"><dt>实际收货时间规则</dt><dd>{selected.actual_receipt_time_rule}</dd></div><div><dt>提前到货</dt><dd>{selected.is_early_arrival ? "是" : "否"}</dd></div><div><dt>本次 / 过账前剩余 / 过账后剩余</dt><dd>{display(selected.quantity)} / {selected.remaining_quantity} / {selected.remaining_after_receipt ?? "待填写数量"}</dd></div><div><dt>目标仓库</dt><dd>{selected.target.warehouse_note}</dd></div><div><dt>目标库位</dt><dd>{selected.target.location_code} · {selected.target.location_note}</dd></div><div><dt>经办账号</dt><dd>{selected.operator_username}</dd></div><div><dt>Supplier批次</dt><dd>{selected.supplier_lot.note}<br/>输入：{display(draft.supplier_lot_code)}</dd></div><div><dt>送货凭证</dt><dd>{display(draft.evidence_type)} · {display(draft.evidence_reference)} · {display(draft.evidence_document_date)}</dd></div><div><dt>提前到货原因 / 确认</dt><dd>{display(draft.early_arrival_reason)} · {draft.early_arrival_confirmed ? "已确认" : "未确认"}</dd></div><div><dt>物理到货确认</dt><dd>{draft.physical_receipt_confirmed ? "已确认实物到MAIN" : "未确认"}</dd></div><div className="wide"><dt>收货说明</dt><dd>{display(draft.reason)}</dd></div></dl></section>
    <section className="warehouse-preview-section"><h3>当前下游计数</h3><div className="warehouse-count-grid">{[["Receipt", counts.receipt], ["Warehouse Receipt Line", counts.warehouse_receipt], ["Inventory Ledger", counts.inventory_ledger], ["RML Lot", counts.lot], ["IQC", counts.iqc], ["采购金额来源", counts.purchase_financial_source], ["AP", counts.ap], ["Payment", counts.payment], ["Work Order", counts.work_order], ["Production Report", counts.production_report], ["Production Completion", counts.production_completion]].map(([label, value]) => <span key={String(label)}><small>{label}</small><b>{String(value)}</b></span>)}</div><p>{String(counts.scope_note)}</p></section>
    <section className="warehouse-preview-section"><h3>本次过账后果与职责边界</h3><ul><li>{preview.receipt_accounting_boundary.warehouse_receipt_model}</li><li>{preview.receipt_accounting_boundary.iqc_material_internal_lot}</li><li>{preview.receipt_accounting_boundary.iqc_material_inventory}</li><li>{preview.receipt_accounting_boundary.available_inventory_rule}</li><li>{preview.receipt_accounting_boundary.ledger_rule}</li><li>{preview.receipt_accounting_boundary.next_responsibility}</li><li>{preview.receipt_accounting_boundary.exceptions_are_separate_operations}</li><li>不会自动创建：{preview.receipt_accounting_boundary.no_automatic_records.join("、")}。</li></ul></section>
    <section className="warehouse-preview-section warehouse-protected-boundaries"><h3>不可误读边界</h3><ul>{preview.protected_boundaries.map((item) => <li key={item}>{item}</li>)}</ul><p>{preview.exposed_fields_note}</p></section>
    {!ready ? <div className="sourcing-state sourcing-error" role="status">当前确认资料不完整或权威状态不可过账；“确认过账收货”保持禁用。返回修改后可基于真实实物与凭证重新核对。</div> : null}
    {error ? <div className="sourcing-state sourcing-error" role="alert">{error}</div> : null}
  </DialogFrame>;
}
