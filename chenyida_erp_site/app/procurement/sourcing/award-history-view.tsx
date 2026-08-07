"use client";

import { useState } from "react";
import type { AwardHistoryReadModel } from "../../lib/procurement-sourcing-selfhost/award-read-model";
import { statusLabel } from "../../../public/erp/status-localization.js";

type Props = { model: AwardHistoryReadModel };

function decimalDisplay(value: string, minimumFraction = 0) {
  const raw = String(value ?? "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw || "—";
  const [whole, fraction = ""] = raw.split(".");
  const visible = fraction.replace(/0+$/, "").padEnd(minimumFraction, "0");
  return visible ? `${whole}.${visible}` : whole;
}

function money(value: string) {
  return decimalDisplay(value, 2);
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }
  return <span className="comparison-copyable"><code title={value}>{value}</code><button type="button" onClick={() => void copy()} aria-label={copied ? `${label}已复制` : `复制${label}`} aria-live="polite">{copied ? "已复制" : "复制"}</button></span>;
}

function BooleanProof({ value }: { value: boolean }) {
  return <span className={value ? "rfq-proof success" : "rfq-proof warning"}>{String(value)}</span>;
}

function AwardLineIdentity({ line }: { line: AwardHistoryReadModel["lines"][number] }) {
  return <>
    <b>Award Line ID {line.award_line_id}</b>
    <span>RFQ Line {line.rfq_line_id} / Comparison Line {line.comparison_line_id}</span>
    <span>Candidate ID {line.comparison_candidate_id}</span>
  </>;
}

export function AwardHistoryView({ model }: Props) {
  const { identity, operation_receipt: receipt, projections } = model;
  const supplierLabels = new Map<string, string>(model.fixed_quotes.map((quote, index) => [quote.supplier_id, `Supplier ${String.fromCharCode(65 + index)}`] as const));
  const supplierLabel = (supplierId: string) => supplierLabels.get(supplierId) || `Supplier ID ${supplierId}`;
  const lineCountLabel = model.lines.length === 4 ? "四条" : `${model.lines.length}条`;
  return <section className="sourcing-panel award-history" data-award-history="server" data-award-id={identity.award_id}>
    <div className="sourcing-title award-history-heading">
      <div><p className="rfq-eyebrow">Award聚合只读历史</p><h2>{identity.display_identity}</h2></div>
      <span className={`sourcing-status status-${identity.status.toLowerCase()}`}>{statusLabel(identity.status)}</span>
    </div>
    <p className="award-history-governance">{identity.immutable_semantics}</p>

    <dl className="sourcing-facts award-history-identity">
      <div><dt>Award稳定数据库ID</dt><dd>{identity.award_id}</dd></div>
      <div><dt>独立Award业务编号</dt><dd>{identity.business_number_note}</dd></div>
      <div><dt>Award Version</dt><dd>v{identity.version}</dd></div>
      <div><dt>权威状态</dt><dd>{identity.status} / {statusLabel(identity.status)}</dd></div>
      <div className="wide"><dt>Version与不可变语义</dt><dd>{identity.version_note}</dd></div>
      <div><dt>RFQ</dt><dd>ID {identity.rfq_id} / {identity.rfq_code}</dd></div>
      <div><dt>Round</dt><dd>Round {identity.round_no}</dd></div>
      <div><dt>RFQ提交时CAS</dt><dd>{identity.rfq_submitted_cas === null ? "无权威历史值" : `v${identity.rfq_submitted_cas}`}</dd></div>
      <div><dt>当前RFQ CAS</dt><dd>v{identity.rfq_current_cas}</dd></div>
      <div><dt>Comparison Version</dt><dd>v{identity.comparison_version_no}</dd></div>
      <div><dt>Comparison状态</dt><dd>{identity.comparison_status}</dd></div>
      <div className="wide"><dt>权威字段来源</dt><dd>{identity.status_source}</dd></div>
      <div className="wide"><dt>Comparison output digest</dt><dd><Copyable label="Comparison output digest" value={identity.comparison_output_digest}/></dd></div>
    </dl>

    <section className="award-history-section" aria-label="固定Quote">
      <h3>Comparison固定Quote</h3>
      <p className="award-history-note">Supplier A/B是按固定Quote ID升序生成的页面展示标签；权威身份仍为Supplier ID、编码和名称。</p>
      <div className="award-history-quotes">{model.fixed_quotes.map(quote => <article key={quote.quote_id} data-fixed-quote-id={quote.quote_id}>
        <b>Quote ID {quote.quote_id} / v{quote.quote_version_no} / {supplierLabel(quote.supplier_id)}</b>
        <span>Supplier ID {quote.supplier_id} / {quote.supplier_code}</span>
        <span>{quote.supplier_name}</span>
        <small>外部参考：{quote.supplier_quote_reference} · {quote.currency_code}</small>
      </article>)}</div>
    </section>

    <section className="award-history-section award-history-reason" aria-label="定标原因">
      <h3>定标原因</h3>
      <dl className="sourcing-facts"><div><dt>原因代码</dt><dd>{model.reason.code}</dd></div><div className="wide"><dt>原因正文</dt><dd>{model.reason.text}</dd></div><div className="wide"><dt>摘要规范化值</dt><dd>{model.reason.normalized_text}</dd></div></dl>
    </section>

    <section className="award-history-section" aria-label="Award Line固定引用">
      <h3>{lineCountLabel}Award Line与固定引用</h3>
      <p className="award-history-note">Candidate ID 由 Award Line 的 Comparison ID + Quote Line ID 唯一关系确定；不是伪造的直接 candidate_id 字段。</p>
      <div className="award-history-desktop sourcing-table-wrap"><table><caption className="sr-only">Award Line固定引用</caption><thead><tr><th scope="col">Award / Comparison</th><th scope="col">Material</th><th scope="col">Quote固定引用</th><th scope="col">Supplier</th><th scope="col">数量</th><th scope="col">单价</th><th scope="col">金额</th></tr></thead><tbody>{model.lines.map(line => <tr key={line.award_line_id} data-award-line-id={line.award_line_id}>
        <td><AwardLineIdentity line={line}/></td>
        <td>Material ID {line.material_id}<br/><b>{line.internal_material_code}</b><br/>{line.standard_name}</td>
        <td>Quote ID {line.quote_id} / v{line.quote_version_no}<br/>Quote Line ID {line.quote_line_id}</td>
        <td>{supplierLabel(line.supplier_id)}<br/>Supplier ID {line.supplier_id}<br/><b>{line.supplier_code}</b><br/>{line.supplier_name}</td>
        <td>{decimalDisplay(line.selected_quantity)} {line.unit_code}</td>
        <td>{money(line.selected_unit_price)} {line.currency_code}</td>
        <td><b>{money(line.line_amount)} {line.currency_code}</b></td>
      </tr>)}</tbody></table></div>
      <div className="award-history-mobile">{model.lines.map(line => <article key={line.award_line_id} data-award-line-id={line.award_line_id}>
        <header><AwardLineIdentity line={line}/></header>
        <span>Material ID {line.material_id} / {line.internal_material_code}</span>
        <span>{line.standard_name}</span>
        <span>Quote ID {line.quote_id} / v{line.quote_version_no} / Quote Line ID {line.quote_line_id}</span>
        <span>{supplierLabel(line.supplier_id)} / Supplier ID {line.supplier_id} / {line.supplier_code} / {line.supplier_name}</span>
        <span>{decimalDisplay(line.selected_quantity)} {line.unit_code} × {money(line.selected_unit_price)} {line.currency_code}</span>
        <strong>{money(line.line_amount)} {line.currency_code}</strong>
      </article>)}</div>
    </section>

    <section className="award-history-section" aria-label="Award汇总">
      <h3>Award汇总</h3>
      <div className="award-history-summary">
        <article><small>Award Line</small><strong>{model.summary.award_line_count}</strong><span>{model.summary.split_note}</span><span>{model.summary.duplicate_material_note}</span></article>
        {model.summary.supplier_summaries.map(supplier => <article key={supplier.supplier_id} data-award-supplier-id={supplier.supplier_id}><small>{supplierLabel(supplier.supplier_id)} · {supplier.supplier_code} · {supplier.supplier_name}</small><strong>{money(supplier.total_amount)} {supplier.currency_code}</strong><span>Award Line {supplier.award_line_count}</span></article>)}
      </div>
    </section>

    <section className="award-history-section award-history-digests" aria-label="Award摘要">
      <h3>摘要证据边界</h3>
      <article><b>持久化 Award 摘要</b><small>{model.persisted_award_digest.source}</small><Copyable label="持久化Award摘要" value={model.persisted_award_digest.value}/><p>{model.persisted_award_digest.note}</p></article>
      <article><b>decision digest · {model.decision_digest.canonical_rule}</b><small>{model.decision_digest.source} / persisted={String(model.decision_digest.persisted)}</small><Copyable label="decision digest" value={model.decision_digest.value}/><p>{model.decision_digest.note}</p><p>固定排序：Award Line ID 数值升序；Supplier 与 Material 使用稳定内部ID。</p></article>
    </section>

    <section className="award-history-section award-history-event" aria-label="Award操作凭证">
      <h3>单一聚合级Award操作凭证</h3>
      <dl className="sourcing-facts">
        <div><dt>Event</dt><dd>ID {receipt.event_id} / {receipt.event_type}</dd></div>
        <div><dt>Event数量</dt><dd>{receipt.event_count}</dd></div>
        <div><dt>用户操作次数</dt><dd>{receipt.user_operation_count}</dd></div>
        <div><dt>Award Line数量</dt><dd>{receipt.award_line_count}</dd></div>
        <div><dt>actor</dt><dd>{receipt.actor}</dd></div>
        <div><dt>时间（Asia/Shanghai）</dt><dd>{receipt.occurred_at_shanghai}</dd></div>
        <div><dt>结果</dt><dd>{receipt.result}</dd></div>
        <div className="wide"><dt>request_id</dt><dd><Copyable label="Award request_id" value={receipt.request_id}/></dd></div>
      </dl>
      <p className="award-history-warning">{receipt.version_transition_note}</p>
      <div className="award-cas-evidence">
        <article><small>提交前RFQ CAS</small><strong>{receipt.cas_evidence.old_version === null ? "无权威历史值" : `v${receipt.cas_evidence.old_version}`}</strong><span>{receipt.cas_evidence.submitted_source}</span></article>
        <article><small>当前RFQ CAS</small><strong>v{receipt.cas_evidence.new_version}</strong><span>{receipt.cas_evidence.current_source}</span></article>
      </div>
      <p>{receipt.cas_evidence.note}{receipt.cas_evidence.audit_id ? ` Audit ID ${receipt.cas_evidence.audit_id}。` : ""}{receipt.cas_evidence.old_version !== null && receipt.cas_evidence.audit_new_version !== null ? ` Audit记录 v${receipt.cas_evidence.old_version} → v${receipt.cas_evidence.audit_new_version}。` : ""}</p>
    </section>

    <section className="award-history-section award-history-projections" aria-label="Award后状态投影">
      <h3>Award后状态投影</h3>
      <div className="award-history-projection-grid">
        <article><small>Comparison状态</small><strong>{projections.comparison_status}</strong><span>Comparison状态与能否再次定标是两个独立语义。</span></article>
        <article><small>awardable_now</small><strong><BooleanProof value={projections.awardable_now}/></strong><span>{projections.awardability_note}</span></article>
        <article><small>po_convertible_now</small><strong><BooleanProof value={projections.po_convertible_now}/></strong><span>当前PO计数 {projections.po_count}</span></article>
      </div>
      <ul className="award-history-conditions">
        <li>Award状态为AWARDED：{String(projections.po_conversion_conditions.award_status_awarded)}</li>
        <li>RFQ状态为CLOSED：{String(projections.po_conversion_conditions.rfq_status_closed)}</li>
        <li>{lineCountLabel}Award Line完整：{String(projections.po_conversion_conditions.award_lines_complete)}</li>
        <li>Comparison/Candidate/Quote Line引用闭合：{String(projections.po_conversion_conditions.references_complete)}</li>
        <li>来源采购申请仍为ACCEPTED：{String(projections.po_conversion_conditions.source_purchase_request_accepted)}</li>
        <li>PO计数为0：{String(projections.po_conversion_conditions.purchase_order_count_zero)}</li>
      </ul>
      <p>{projections.po_conversion_note}</p>
      <p className="award-history-warning"><b>转PO入口：</b>独立“定标转单与到货计划”模块；本页只显示资格，不提供链接、按钮或业务POST。</p>
    </section>
  </section>;
}
