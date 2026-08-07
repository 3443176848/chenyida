"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { decimalDisplay, type AwardDraft } from "./award-candidate-selection";

const focusableSelector = "button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

function dateOnly(value: string) {
  return String(value || "").slice(0, 10) || "—";
}

function supplierLabel(supplier: AwardDraft["selected_supplier"]) {
  if (!supplier) return "混合 Supplier";
  return `${supplier.supplier_code} · ${supplier.supplier_name}`;
}

export function AwardConfirmDialog({
  draft,
  busy,
  onCancel,
  onConfirm,
}: {
  draft: AwardDraft;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

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

  const selectedSupplier = draft.selected_supplier;
  const lowestSupplier = draft.lowest_supplier;
  return <div className="rfq-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section
      ref={dialogRef}
      className="rfq-dialog award-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="award-confirm-dialog-title"
      aria-busy={busy}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="rfq-dialog-heading">
        <div><p className="rfq-eyebrow">不可变 Sourcing Award 创建前复核</p><h2 id="award-confirm-dialog-title">正式定标确认</h2></div>
        <button type="button" className="rfq-dialog-close" aria-label="关闭定标确认窗口" disabled={busy} onClick={onCancel}>关闭</button>
      </div>
      <div className="rfq-dialog-body">
        <section className="rfq-confirm-section" aria-label="RFQ 与 Comparison 身份">
          <h3>RFQ 与 CURRENT Comparison</h3>
          <dl className="sourcing-facts award-confirm-identity">
            <div><dt>RFQ ID / 编号</dt><dd>ID {draft.rfq.id} / {draft.rfq.rfq_code}</dd></div>
            <div><dt>Round / CAS</dt><dd>Round {draft.rfq.round_no} / v{draft.rfq.version}</dd></div>
            <div><dt>Comparison Version</dt><dd>v{draft.comparison.version_no} / {draft.comparison.status}</dd></div>
            <div><dt>awardable_now</dt><dd>{String(draft.comparison.awardable_now)}</dd></div>
            <div className="wide"><dt>output digest</dt><dd><code className="rfq-trace-value">{draft.comparison.output_digest}</code></dd></div>
          </dl>
          <div className="award-confirm-basis">
            {draft.lines.map((line) => <article key={line.comparison_line_id}>
              <b>Comparison Line {line.comparison_line_id} · RFQ Line {line.rfq_line_id}</b>
              <span>Material {line.material_id} / {line.internal_material_code}</span>
              <span>basis_digest</span>
              <code className="rfq-trace-value">{line.comparison_basis_digest}</code>
            </article>)}
          </div>
        </section>

        <section className="rfq-confirm-section" aria-label="四行获选 Candidate">
          <h3>四行获选 Supplier 与固定 Candidate</h3>
          <div className="award-confirm-lines">
            {draft.lines.map((line) => <article key={line.rfq_line_id} data-selected-candidate-id={line.candidate.comparison_candidate_id}>
              <header><b>Line {line.line_no} · Material {line.material_id}</b><span>{line.internal_material_code} / {line.standard_name}</span></header>
              <strong>{line.candidate.supplier_code} · {line.candidate.supplier_name}</strong>
              <span>Candidate ID {line.candidate.comparison_candidate_id}</span>
              <span>Quote ID {line.candidate.quote_id} / v{line.candidate.quote_version_no}</span>
              <span>数量 {decimalDisplay(line.candidate.quoted_quantity)} {line.unit_code}</span>
              <span>单价 {decimalDisplay(line.candidate.unit_price, 2)} {line.candidate.currency_code}</span>
              <span>行金额 {decimalDisplay(line.candidate.line_amount, 2)} {line.candidate.currency_code}</span>
              <span>需求 {dateOnly(line.required_date)} / 承诺 {dateOnly(line.candidate.promised_delivery_date)}</span>
              <span>{line.candidate.delivery_status} / {line.candidate.delivery_explanation}</span>
              <span>价格排名 {line.candidate.price_rank ?? "—"}{line.candidate.lowest_price ? " / 最低价" : " / 非最低价"}</span>
            </article>)}
          </div>
        </section>

        <section className="rfq-confirm-section award-confirm-commercial" aria-label="金额与交期差异">
          <h3>金额与交期差异</h3>
          <dl className="sourcing-facts">
            <div><dt>获选 Supplier / 总额</dt><dd>{supplierLabel(selectedSupplier)}<br/>{decimalDisplay(draft.selected_total_amount, 2)} {draft.currency_code}</dd></div>
            <div><dt>最低价 Supplier / 总额</dt><dd>{supplierLabel(lowestSupplier)}<br/>{decimalDisplay(draft.lowest_total_amount, 2)} {draft.currency_code}</dd></div>
            <div><dt>价差</dt><dd>{decimalDisplay(draft.amount_difference, 2)} {draft.currency_code} / {decimalDisplay(draft.percentage_difference)}%</dd></div>
            <div><dt>交期对比</dt><dd>{selectedSupplier ? `${selectedSupplier.delivery_status} / ${selectedSupplier.delivery_explanation}` : "逐行见上"}<br/>{lowestSupplier ? `${lowestSupplier.delivery_status} / ${lowestSupplier.delivery_explanation}` : "—"}</dd></div>
          </dl>
          {draft.delivery_comparison ? <p><b>{draft.delivery_comparison}</b></p> : null}
          <p><b>最低价不等于自动获选；非最低价只能在服务端认可的原因代码和完整理由下定标。</b></p>
        </section>

        <section className="rfq-confirm-section" aria-label="定标理由">
          <h3>原因代码与完整理由</h3>
          <p><b>{draft.request.reason_code} / {draft.reason_label}</b></p>
          <p className="award-confirm-reason">{draft.request.reason}</p>
        </section>

        <section className="rfq-confirm-consequences" aria-label="定标后果">
          <h3>最终确认后果</h3>
          <ul>
            <li>服务端重新核对 RFQ ID/编号、Round、CAS、CURRENT Comparison Version、basis_digest 与 output digest。</li>
            <li>服务端按 Candidate ID 固定解析 Comparison Line、Quote ID/version、Supplier、数量、币种、单价与交期；页面值不能改写这些事实。</li>
            <li>本次只新增一个不可变 Sourcing Award 及其 Award Line。</li>
            <li><b>不会自动创建 PO、到货计划、收货、库存、应付或其他下游记录。</b></li>
          </ul>
        </section>
      </div>
      <div className="rfq-dialog-actions">
        <button ref={cancelRef} type="button" className="rfq-secondary" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" disabled={busy} onClick={(event) => {
          event.currentTarget.disabled = true;
          onConfirm();
        }}>{busy ? "正在创建 Award…" : "最终确认并创建 Award"}</button>
      </div>
    </section>
  </div>;
}
