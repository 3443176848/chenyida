"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { AwardConversionPreview } from "../../lib/procurement-fulfillment-selfhost/award-conversion-preview.ts";

const focusableSelector = "button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex='-1'])";
const compactDecimal = (value: string) => value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
const money = (value: string) => {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return value;
  const micros = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  const cents = (micros + 5_000n) / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
};

const display = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "—" : String(value);
const qualifiedText = (qualified: boolean) => qualified ? "qualified=true / 合格" : "qualified=false / 不合格";

function DialogFrame({ children, title, busy, onCancel, actions }: Readonly<{
  children: ReactNode;
  title: string;
  busy: boolean;
  onCancel: () => void;
  actions?: ReactNode;
}>) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    return () => { window.cancelAnimationFrame(frame); priorFocus.current?.focus(); };
  }, []);
  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    if (!nodes.length) { event.preventDefault(); dialog.focus(); return; }
    const first = nodes[0], last = nodes[nodes.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  }
  return <div className="rfq-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section ref={dialogRef} className="rfq-dialog award-po-dialog" role="dialog" aria-modal="true" aria-labelledby="award-po-dialog-title" aria-busy={busy} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="rfq-dialog-heading"><div><p className="rfq-eyebrow">AWARD → PURCHASE ORDER</p><h2 id="award-po-dialog-title">{title}</h2></div><button type="button" className="rfq-dialog-close" aria-label="关闭确认窗口" disabled={busy} onClick={onCancel}>关闭</button></header>
      <div className="rfq-dialog-body">{children}</div>
      <footer className="rfq-dialog-actions"><button ref={cancelRef} type="button" className="rfq-secondary" disabled={busy} onClick={onCancel}>取消</button>{actions}</footer>
    </section>
  </div>;
}

export function AwardPoConversionLoadingDialog({ onCancel }: Readonly<{ onCancel: () => void }>) {
  return <DialogFrame title="正在重新读取转换权威数据" busy={false} onCancel={onCancel}>
    <section className="rfq-confirm-section"><p>正在以只读请求核验 Award、RFQ、Comparison、Quote、摘要、完整行集及当前 PO／到货计划计数。此阶段不会发送业务 POST。</p></section>
  </DialogFrame>;
}

export function AwardPoConversionDialog({ preview, remark, onRemark, busy, submitted, error, onCancel, onConfirm }: Readonly<{
  preview: AwardConversionPreview;
  remark: string;
  onRemark: (value: string) => void;
  busy: boolean;
  submitted: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const total = preview.planned_result.totals_by_currency[0];
  const mappingQualification: AwardConversionPreview["mapping_qualification"] | undefined = preview.mapping_qualification;
  const mappingQualified = preview.po_convertible_now === true && mappingQualification?.all_qualified === true;
  return <DialogFrame title="定标转采购订单最终确认" busy={busy} onCancel={onCancel} actions={<button type="button" disabled={busy || submitted || !mappingQualified} onClick={(event) => { event.currentTarget.disabled = true; onConfirm(); }}>{busy ? "正在生成…" : submitted ? "本次确认已锁定" : "最终确认生成PO及到货计划"}</button>}>
    <section className="rfq-confirm-section award-po-identity"><h3>完整业务谱系</h3><dl className="rfq-receipt-facts">
      <div><dt>Award</dt><dd>#{preview.award.award_id} / v{preview.award.version} / {preview.award.status}</dd></div>
      <div><dt>RFQ</dt><dd>ID {preview.rfq.rfq_id} / {preview.rfq.rfq_code} / Round {preview.rfq.round_no} / {preview.rfq.status} / v{preview.rfq.version}</dd></div>
      <div><dt>Comparison</dt><dd>Version {preview.comparison.version} / {preview.comparison.status} / awardable_now={String(preview.comparison.awardable_now)}</dd></div>
      <div><dt>转换资格</dt><dd>po_convertible_now={String(preview.po_convertible_now)} / 当前PO {preview.current_counts.purchase_orders} / 当前计划 {preview.current_counts.delivery_plans}</dd></div>
    </dl><div className="award-po-quotes"><h4>Comparison固定Quote输入与获奖来源</h4>{preview.fixed_quotes.map((quote) => {
      const selected = preview.selected_quotes.find((item) => item.quote_id === quote.quote_id && item.quote_version_no === quote.quote_version_no);
      return <article key={`${quote.quote_id}-${quote.quote_version_no}`}><b>Quote {quote.quote_id}/v{quote.quote_version_no}</b><span>Supplier {quote.supplier_id} / {quote.supplier_code} / {quote.supplier_name}</span><span>外部报价引用：{quote.supplier_quote_reference}</span><span>{selected ? "获奖来源" : "固定比较输入（未获奖）"}</span>{selected ? <><span>付款条件：{selected.payment_terms}</span><span>{selected.tax_included ? "含税" : "未税"} / {selected.freight_included ? "含运费" : "不含运费"}</span></> : null}</article>;
    })}</div></section>

    <section className="rfq-confirm-section"><h3>Award成功Event</h3><dl className="rfq-receipt-facts">
      <div><dt>Event</dt><dd>ID {preview.award_event.event_id} / {preview.award_event.event_type}</dd></div><div><dt>结果</dt><dd>{preview.award_event.result}</dd></div>
      <div><dt>actor / 上海时间</dt><dd>{preview.award_event.actor}<br/>{preview.award_event.occurred_at_shanghai}</dd></div><div><dt>request_id</dt><dd className="rfq-trace-value">{preview.award_event.request_id}</dd></div>
    </dl></section>

    <section className="rfq-confirm-section"><h3>两类Award摘要</h3><div className="award-po-digests"><article><b>Award持久化摘要</b><code>{preview.digests.persisted_award_digest}</code></article><article><b>派生决策摘要 / {preview.digests.decision_digest_rule}</b><code>{preview.digests.decision_digest}</code><small>{preview.digests.decision_digest_source}</small></article><article><b>Comparison输出摘要</b><code>{preview.comparison.output_digest}</code></article></div></section>

    <section className="rfq-confirm-section"><h3>四条转换范围</h3><div className="sourcing-table-wrap award-po-lines-desktop"><table><thead><tr><th>Award Line</th><th>Material</th><th>数量</th><th>单价</th><th>金额</th><th>计划日期</th><th>固定来源</th></tr></thead><tbody>{preview.lines.map((line) => <tr key={line.award_line_id}><td>{line.award_line_id}</td><td>{line.material_id} / {line.internal_material_code}<br/>{line.standard_name}</td><td>{compactDecimal(line.selected_quantity)} {line.unit_code}</td><td>{money(line.selected_unit_price)} {line.currency_code}</td><td>{money(line.line_amount)} {line.currency_code}</td><td>{line.promised_delivery_date}</td><td>Comparison Line {line.comparison_line_id}<br/>Candidate {line.comparison_candidate_id}<br/>Quote {line.quote_id}/v{line.quote_version_no} / Line {line.quote_line_id}</td></tr>)}</tbody></table></div>
      <div className="award-po-lines-mobile">{preview.lines.map((line) => <article key={line.award_line_id}><header><b>Award Line {line.award_line_id}</b><span>{line.material_id} / {line.internal_material_code}</span></header><span>{line.standard_name}</span><span>{compactDecimal(line.selected_quantity)} {line.unit_code} × {money(line.selected_unit_price)} {line.currency_code}</span><strong>{money(line.line_amount)} {line.currency_code}</strong><span>计划日期：{line.promised_delivery_date}</span><span>Comparison {line.comparison_line_id} / Candidate {line.comparison_candidate_id} / Quote {line.quote_id}/v{line.quote_version_no} / Line {line.quote_line_id}</span></article>)}</div>
    </section>

    <section className="rfq-confirm-section"><h3>Supplier Mapping资格凭证</h3>{mappingQualification ? <>
      <dl className="rfq-receipt-facts">
        <div><dt>资格合同</dt><dd>{mappingQualification.contract_version}</dd></div>
        <div><dt>观测时间</dt><dd>{mappingQualification.observed_at}<br/>{mappingQualification.data_timezone}</dd></div>
        <div><dt>逐行结论</dt><dd>{qualifiedText(mappingQualification.all_qualified)}<br/>{mappingQualification.qualified_line_count}/{mappingQualification.line_count} 行合格</dd></div>
        <div><dt>资格摘要</dt><dd><code className="rfq-trace-value">{mappingQualification.qualification_digest}</code></dd></div>
      </dl>
      <div className="sourcing-table-wrap award-po-lines-desktop award-po-qualification-desktop"><table><caption className="sr-only">Supplier Mapping逐行资格凭证</caption><thead><tr><th>资格</th><th>固定业务谱系</th><th>Supplier / Material</th><th>Mapping Fact</th><th>料号 / Unit</th><th>换算 / 有效期</th><th>冲突</th><th>摘要 / 阻断原因</th></tr></thead><tbody>{mappingQualification.lines.map((line) => <tr key={`${line.award_line_id}-${line.mapping_fact_id}`} data-award-line-id={line.award_line_id} data-qualified={String(line.qualified)}>
        <td><strong>{qualifiedText(line.qualified)}</strong></td>
        <td>Award Line {line.award_line_id}<br/>Candidate {line.candidate_id}<br/>Quote Line {line.quote_line_id}<br/>RFQ Binding {line.rfq_binding_id}</td>
        <td>Supplier {line.supplier_id} / {line.supplier_code}<br/>Supplier状态：{line.supplier_status}<br/>Material {line.material_id}<br/>Material状态：{line.material_status}</td>
        <td><code className="rfq-trace-value">{line.mapping_uuid}</code><br/>Fact {line.mapping_fact_id} / v{line.mapping_version_no} / Row CAS {line.mapping_row_cas}<br/>Binding状态：{line.binding_status}<br/>Mapping状态：{line.mapping_status}</td>
        <td>{line.supplier_part_number}<br/>Supplier Unit {line.supplier_unit_id} / {line.supplier_unit_code}<br/>Internal Unit {line.internal_unit_id} / {line.internal_unit_code}</td>
        <td>{line.conversion_numerator}:{line.conversion_denominator}<br/>{line.valid_from}<br/>至 {display(line.valid_to)}</td>
        <td>Supplier/Material：{line.supplier_material_conflict_count}<br/>Supplier Part：{line.supplier_part_number_conflict_count}</td>
        <td><code className="rfq-trace-value">{line.content_digest}</code><br/>错误代码：{display(line.error_code)}<br/>原因：{display(line.reason)}</td>
      </tr>)}</tbody></table></div>
      <div className="award-po-lines-mobile award-po-qualification-mobile">{mappingQualification.lines.map((line) => <article key={`${line.award_line_id}-${line.mapping_fact_id}`} data-award-line-id={line.award_line_id} data-qualified={String(line.qualified)}>
        <header><b>Award Line {line.award_line_id}</b><strong>{qualifiedText(line.qualified)}</strong></header>
        <span>Candidate {line.candidate_id} / Quote Line {line.quote_line_id} / RFQ Binding {line.rfq_binding_id}</span>
        <span>Supplier {line.supplier_id} / {line.supplier_code} / {line.supplier_status}</span>
        <span>Material {line.material_id} / {line.material_status}</span>
        <span>Mapping UUID：<code className="rfq-trace-value">{line.mapping_uuid}</code></span>
        <span>Fact {line.mapping_fact_id} / v{line.mapping_version_no} / Row CAS {line.mapping_row_cas}</span>
        <span>Binding状态：{line.binding_status} / Mapping状态：{line.mapping_status}</span>
        <span>Supplier Part：{line.supplier_part_number}</span>
        <span>Supplier Unit {line.supplier_unit_id} / {line.supplier_unit_code}</span>
        <span>Internal Unit {line.internal_unit_id} / {line.internal_unit_code}</span>
        <span>换算：{line.conversion_numerator}:{line.conversion_denominator}</span>
        <span>有效期：{line.valid_from} 至 {display(line.valid_to)}</span>
        <span>冲突：Supplier/Material {line.supplier_material_conflict_count} / Supplier Part {line.supplier_part_number_conflict_count}</span>
        <span>content digest：<code className="rfq-trace-value">{line.content_digest}</code></span>
        <span>错误代码：{display(line.error_code)}</span>
        <span>原因：{display(line.reason)}</span>
      </article>)}</div>
    </> : <div className="sourcing-state sourcing-error" role="alert">Supplier Mapping资格凭证缺失，已禁止最终转换。</div>}</section>

    <section className="rfq-confirm-section"><h3>将创建的权威记录</h3><div className="award-po-summary">
      <span>转换操作 {preview.planned_result.conversion_operation_count}</span><span>PO聚合 {preview.planned_result.purchase_order_aggregate_count}</span><span>PO Line {preview.planned_result.purchase_order_line_count}</span><span>Delivery Plan计划记录／聚合 {preview.planned_result.delivery_plan_aggregate_count}</span><span>独立Delivery Plan Line {preview.planned_result.delivery_plan_line_count}</span><span>待入库队列 {preview.planned_result.receiving_queue_entry_count}</span>
    </div><p>每条PO Line固定引用对应Award Line；每条PO Line创建一项权威到货计划。{preview.model_capabilities.delivery_plan_semantics}</p><p>Supplier：{preview.suppliers.map((supplier) => `${supplier.supplier_id} / ${supplier.supplier_code} / ${supplier.supplier_name}`).join("；")}。总额：{total ? `${money(total.total_amount)} ${total.currency_code}` : "—"}。计划日期：{preview.planned_result.planned_delivery_dates.join("、")}。</p></section>

    <section className="rfq-confirm-section sourcing-form"><h3>可选PO字段</h3><p className="rfq-trace-warning">{preview.model_capabilities.external_reference_note}；不会挪用税务、地址、物料规格或其他字段。</p><label>PO备注（可选，最多{preview.model_capabilities.remark_max_length}字）<textarea maxLength={preview.model_capabilities.remark_max_length} value={remark} disabled={busy || submitted} onChange={(event) => onRemark(event.target.value)} placeholder="填写采购订单备注" /></label></section>

    <section className="rfq-confirm-consequences award-po-boundaries"><h3>最终确认合同与零自动创建范围</h3><p>本次最终确认将执行一次PO转换操作，并在同一事务创建上述PO、PO Line、逐行到货计划、待入库队列及Event/Audit。</p><p>Award、RFQ、Quote、Comparison不会被修改。</p><p>不会自动创建：</p><ul>{preview.protected_boundaries.not_created.map((item) => <li key={item}>{item}</li>)}</ul><p><b>下一阶段：</b>{preview.protected_boundaries.next_stage}</p></section>
    {error ? <div className="sourcing-state sourcing-error" role="alert">{error}<br/>系统不会自动重试；请关闭窗口后重新读取权威数据，再决定是否重新确认。</div> : null}
  </DialogFrame>;
}
