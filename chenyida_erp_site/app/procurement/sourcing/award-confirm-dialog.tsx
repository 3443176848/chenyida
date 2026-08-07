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

function supplierContractAlias(index: number, count: number) {
  if (count === 2 && index < 2) return `Supplier ${index === 0 ? "A" : "B"}`;
  return `Supplier ${index + 1}`;
}

function awardLineCountLabel(count: number) {
  return count === 4 ? "四" : String(count);
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
  const selectedSupplierIndex = selectedSupplier
    ? draft.quote_summaries.findIndex((summary) => summary.supplier_id === selectedSupplier.supplier_id)
    : -1;
  const selectedSupplierAlias = selectedSupplierIndex >= 0
    ? supplierContractAlias(selectedSupplierIndex, draft.quote_summaries.length)
    : "混合Supplier";
  const awardLineCount = awardLineCountLabel(draft.lines.length);
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
            <div className="wide"><dt>Comparison request_id</dt><dd><code className="rfq-trace-value">{draft.comparison.request_id}</code></dd></div>
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

        <section className="rfq-confirm-section" aria-label="两份固定 Quote 引用">
          <h3>两份固定 Quote 引用</h3>
          <div className="award-confirm-quotes">
            {draft.quote_summaries.map((quote, index) => <article key={`${quote.supplier_id}:${quote.quote_id}:v${quote.quote_version_no}`} data-supplier-id={quote.supplier_id} data-quote-id={quote.quote_id}>
              <header><b>{supplierContractAlias(index, draft.quote_summaries.length)}</b><span>{quote.supplier_name}</span></header>
              <strong>Supplier ID {quote.supplier_id} / {quote.supplier_code}</strong>
              <span>Quote ID {quote.quote_id}/v{quote.quote_version_no}</span>
              <span>Supplier Quote Reference {quote.supplier_quote_reference || "—"}</span>
              <span>总额 {decimalDisplay(quote.total_amount, 2)} {quote.currency_code}</span>
              <span>最晚承诺交付 {dateOnly(quote.latest_promised_delivery_date)}</span>
              <span>{quote.delivery_status} / {quote.delivery_explanation}</span>
            </article>)}
          </div>
        </section>

        <section className="rfq-confirm-section award-confirm-operation" aria-label="Award 操作与行数量">
          <h3>Award 操作与行数量</h3>
          <p className="award-confirm-contract-statement"><b>本次确认只创建一次不可变Award操作，并在该操作下创建恰好{awardLineCount}条Award Line。</b></p>
          <dl className="sourcing-facts">
            <div><dt>Award操作</dt><dd>1</dd></div>
            <div><dt>Award Line</dt><dd>{draft.lines.length}</dd></div>
            <div><dt>Supplier归属</dt><dd>{awardLineCount}条均为{selectedSupplierAlias}{selectedSupplier ? `（${selectedSupplier.supplier_code}）` : ""}</dd></div>
            <div><dt>数量策略</dt><dd>不拆分数量</dd></div>
          </dl>
        </section>

        <section className="rfq-confirm-section" aria-label="四行获选 Candidate">
          <h3>四行获选 Supplier 与固定 Candidate</h3>
          <div className="award-confirm-lines">
            {draft.lines.map((line, index) => <article key={line.rfq_line_id} data-selected-candidate-id={line.candidate.comparison_candidate_id}>
              <header><b>Award Line {index + 1} · Comparison Line {line.comparison_line_id}</b><span>RFQ Line {line.rfq_line_id} · Material {line.material_id}</span><span>{line.internal_material_code} / {line.standard_name}</span></header>
              <strong>{line.candidate.supplier_code} · {line.candidate.supplier_name}</strong>
              <span>Candidate ID {line.candidate.comparison_candidate_id}</span>
              <span>Quote ID {line.candidate.quote_id} / v{line.candidate.quote_version_no}</span>
              <span>数量 {decimalDisplay(line.candidate.quoted_quantity)} {line.unit_code} / 不拆分数量</span>
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
            <li>服务端继续执行权限、CSRF、Origin、CAS、原因、幂等、并发与事务回滚保护。</li>
          </ul>
        </section>

        <section className="rfq-confirm-section award-confirm-boundary" aria-label="上游不可变保护">
          <h3>上游不可变保护</h3>
          <ul>
            <li>不修改RFQ已冻结范围</li>
            {draft.quote_summaries.map((quote) => <li key={`${quote.quote_id}:v${quote.quote_version_no}`}>不修改Quote ID {quote.quote_id}/v{quote.quote_version_no}</li>)}
            <li>不修改Comparison Version {draft.comparison.version_no}</li>
            <li>不修改Comparison Line或Candidate</li>
            <li>不修改Binding或Mapping</li>
          </ul>
        </section>

        <section className="rfq-confirm-section award-confirm-boundary" aria-label="下游零自动创建">
          <h3>下游零自动创建</h3>
          <p><b>本次定标不会自动创建以下任何下游记录：</b></p>
          <ul>
            <li>PO</li>
            <li>Delivery Plan</li>
            <li>Receipt／收货</li>
            <li>Inventory Ledger／库存流水</li>
            <li>AP／采购应付</li>
            <li>Work Order／生产工单</li>
            <li>其他生产记录</li>
            <li>其他财务记录</li>
          </ul>
        </section>

        <section className="rfq-confirm-section award-confirm-next-stage" aria-label="下一业务阶段">
          <h3>下一业务阶段</h3>
          <p><b>下一业务阶段：通过独立的‘定标转PO与到货计划’任务，将已生效Award转换为采购订单及到货计划。本次定标不会自动执行该阶段。</b></p>
          <p>具体处理人：未指定</p>
          <p>处理时限：未配置</p>
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
