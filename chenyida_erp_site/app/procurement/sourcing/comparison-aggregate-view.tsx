"use client";

import { useState } from "react";

export type ComparisonFixedQuoteInput = {
  comparison_line_id: string;
  comparison_candidate_id: string;
  quote_id: string;
  quote_version_no: number;
  quote_line_id: string;
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  supplier_quote_reference: string;
  material_id: string;
  internal_material_code: string;
  quote_input_current: boolean;
};

export type ComparisonSupplierSummary = {
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  quote_id: string;
  quote_version_no: number;
  supplier_quote_reference: string;
  total_amount: string;
  currency_code: string;
  latest_promised_delivery_date: string;
  delivery_status: "ON_TIME" | "LATE";
  delivery_delta_days: number;
  delivery_explanation: string;
  valid_until: string;
  payment_terms: string;
  tax_included: boolean;
  freight_included: boolean;
};

export type ComparisonMaterialOffer = {
  comparison_candidate_id: string;
  quote_line_id: string;
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  quoted_quantity: string;
  unit_price: string;
  line_amount: string;
  price_rank: number | null;
  lowest_price: boolean;
  promised_delivery_date: string;
  delivery_status: "ON_TIME" | "LATE";
  delivery_delta_days: number;
  delivery_explanation: string;
};

export type ComparisonMaterialSummary = {
  comparison_line_id: string;
  rfq_line_id: string;
  material_id: string;
  internal_material_code: string;
  standard_name: string;
  requested_quantity: string;
  unit_code: string;
  required_date: string;
  amount_difference: string;
  offers: ComparisonMaterialOffer[];
};

export type ComparisonOperationReceipt = {
  actor: string;
  occurred_at_shanghai: string;
  request_id: string;
  result: string;
  old_version: number | null;
  new_version: number | null;
  comparison_version_no: number;
  event_count: number;
  events: Array<{
    event_id: string;
    comparison_line_id: string;
    rfq_line_id: string;
    material_id: string;
    internal_material_code: string;
  }>;
};

export type ComparisonVersionReadModel = {
  rfq_id: string;
  rfq_code: string;
  round_no: number;
  comparison_version_no: number;
  status: "CURRENT" | "SUPERSEDED" | "INPUT_DRIFT";
  persisted_status: false;
  quote_inputs_current: boolean;
  input_drift: boolean;
  awardable_now: boolean;
  generated_by: string;
  generated_at_shanghai: string;
  request_id: string;
  comparison_rows: Array<{
    comparison_line_id: string;
    rfq_line_id: string;
    material_id: string;
    internal_material_code: string;
    standard_name: string;
    requested_quantity: string;
    unit_code: string;
    required_date: string;
    basis_digest: string;
    basis_digest_source: string;
  }>;
  fixed_quote_inputs: ComparisonFixedQuoteInput[];
  output_summary: {
    digest: string;
    canonical_rows: Array<Record<string, string | number | boolean | null>>;
    note: string;
  };
  supplier_summaries: ComparisonSupplierSummary[];
  material_summaries: ComparisonMaterialSummary[];
  aggregate_differences: null | {
    higher_supplier_id: string;
    lower_supplier_id: string;
    amount_difference: string;
    percentage_basis_supplier_id: string;
    percentage_difference: string;
    earlier_supplier_id: string;
    later_supplier_id: string;
    delivery_day_difference: number;
    lowest_price_supplier_id: string;
    on_time_supplier_ids: string[];
    late_risk_supplier_ids: string[];
  };
  operation_receipts: ComparisonOperationReceipt[];
};

export type ComparisonReadModel = {
  identity_note: string;
  status_note: string;
  input_summary_note: string;
  output_summary_note: string;
  has_independent_header_id: false;
  comparison_header_id: null;
  versions: ComparisonVersionReadModel[];
  current_version: ComparisonVersionReadModel | null;
  generation: {
    enabled: boolean;
    already_generated: boolean;
    reason_code: string;
    label: string;
  };
};

type Props = {
  model: ComparisonReadModel;
  busy: boolean;
  showGenerateAction: boolean;
  onGenerate: () => void;
};

const NO_HEADER_NOTE = "未设置独立Comparison Header ID；版本身份由RFQ、Round、Comparison Version及basis_digest共同确定。";
const STATUS_NOTE = "状态为服务端读模型投影，不是独立数据库状态列。";
const OUTPUT_NOTE = "确定性输出摘要，由不可变Comparison Line重算；不是伪造的历史持久化字段。";

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

function dateOnly(value: string) {
  return String(value || "").slice(0, 10) || "—";
}

function projectedStatus(status: ComparisonVersionReadModel["status"]) {
  if (status === "CURRENT") return "CURRENT / 当前比价版本";
  if (status === "SUPERSEDED") return "SUPERSEDED / 历史比价版本";
  return "INPUT_DRIFT / 固定Quote输入已漂移";
}

function deliveryStatus(status: "ON_TIME" | "LATE") {
  return status === "ON_TIME" ? "ON_TIME / 满足需求日期" : "LATE / 延期风险";
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }
  return <span className="comparison-copyable"><code title={value}>{value || "—"}</code><button type="button" onClick={() => void copy()} aria-label={`复制${label}`}>{copied ? "已复制" : "复制"}</button></span>;
}

function SupplierSummaryCard({ row }: { row: ComparisonSupplierSummary }) {
  return <article className="comparison-supplier-card" data-supplier-id={row.supplier_id}>
    <header><div><small>Supplier ID {row.supplier_id}</small><h3>{row.supplier_code} · {row.supplier_name}</h3></div><span className={`comparison-delivery status-${row.delivery_status.toLowerCase()}`}>{deliveryStatus(row.delivery_status)}</span></header>
    <div className="comparison-total"><span>总额</span><strong>{money(row.total_amount)} {row.currency_code}</strong></div>
    <dl>
      <div><dt>固定Quote</dt><dd>ID {row.quote_id} / v{row.quote_version_no}</dd></div>
      <div><dt>外部参考</dt><dd>{row.supplier_quote_reference}</dd></div>
      <div><dt>最晚承诺日期</dt><dd>{dateOnly(row.latest_promised_delivery_date)}</dd></div>
      <div><dt>交期结论</dt><dd>{row.delivery_explanation}</dd></div>
      <div><dt>有效期</dt><dd>{dateOnly(row.valid_until)}</dd></div>
      <div><dt>报价口径</dt><dd>{row.tax_included ? "含税" : "未税"} / {row.freight_included ? "含运费" : "不含运费"}</dd></div>
      <div className="wide"><dt>付款条件</dt><dd>{row.payment_terms}</dd></div>
    </dl>
  </article>;
}

function MaterialIdentity({ row }: { row: ComparisonMaterialSummary }) {
  return <><b>Material ID {row.material_id} / {row.internal_material_code}</b><span>{row.standard_name}</span><small>{decimalDisplay(row.requested_quantity)} {row.unit_code} · 需求 {dateOnly(row.required_date)}</small></>;
}

function SupplierOffer({ offer, currency = "CNY" }: { offer: ComparisonMaterialOffer; currency?: string }) {
  return <div className="comparison-offer" data-comparison-candidate-id={offer.comparison_candidate_id}>
    <b>{offer.supplier_code} · {offer.supplier_name}</b>
    <span>Comparison Candidate ID {offer.comparison_candidate_id}</span>
    <span>固定Quote Line ID {offer.quote_line_id}</span>
    <span>数量 {decimalDisplay(offer.quoted_quantity)}</span>
    <span>单价 {money(offer.unit_price)} {currency}</span>
    <strong>行金额 {money(offer.line_amount)} {currency}</strong>
    <span>排名 {offer.price_rank ?? "—"}{offer.lowest_price ? " · 最低价" : ""}</span>
    <span>{dateOnly(offer.promised_delivery_date)} · {offer.delivery_status} · {offer.delivery_explanation}</span>
  </div>;
}

function AggregateDifferences({ version }: { version: ComparisonVersionReadModel }) {
  const row = version.aggregate_differences;
  if (!row) return null;
  const supplier = (id: string) => {
    const item = version.supplier_summaries.find(candidate => candidate.supplier_id === id);
    return item ? `${item.supplier_code} · ${item.supplier_name}` : `Supplier ID ${id}`;
  };
  return <section className="comparison-differences" aria-label="聚合差异">
    <h3>聚合差异</h3>
    <ul>
      <li>{supplier(row.higher_supplier_id)} 比 {supplier(row.lower_supplier_id)} 高 {money(row.amount_difference)} CNY</li>
      <li>以 {supplier(row.percentage_basis_supplier_id)} 为基准，高 {decimalDisplay(row.percentage_difference)}%</li>
      <li>{supplier(row.earlier_supplier_id)} 比 {supplier(row.later_supplier_id)} 早 {row.delivery_day_difference} 天</li>
      <li>最低价格：{supplier(row.lowest_price_supplier_id)}</li>
      <li>满足需求日期：{row.on_time_supplier_ids.map(supplier).join("、") || "无"}</li>
      <li>延期风险：{row.late_risk_supplier_ids.map(supplier).join("、") || "无"}</li>
    </ul>
    <p><b>比价不等于定标；不自动产生Award。</b></p>
  </section>;
}

function VersionTrace({ model, version }: { model: ComparisonReadModel; version: ComparisonVersionReadModel }) {
  return <details className="rfq-receipt comparison-trace">
    <summary>固定输入、摘要与Comparison生成操作凭证</summary>
    <section>
      <h3>固定输入追溯</h3>
      <p>{model.input_summary_note}</p>
      <div className="comparison-trace-grid">
        {version.fixed_quote_inputs.map(row => <article key={`${row.comparison_candidate_id}:${row.quote_line_id}`}>
          <b>Quote ID {row.quote_id} / v{row.quote_version_no}</b>
          <span>{row.supplier_code} · {row.supplier_name}</span>
          <span>外部参考：{row.supplier_quote_reference}</span>
          <span>固定Quote Line ID：{row.quote_line_id}</span>
          <span>Comparison Line ID：{row.comparison_line_id}</span>
          <span>Comparison Candidate ID：{row.comparison_candidate_id}</span>
          <span>Material ID {row.material_id} / {row.internal_material_code}</span>
          <span>当前Quote版本：{row.quote_input_current ? "是" : "否（输入漂移）"}</span>
        </article>)}
      </div>
      <h3>逐RFQ Line持久化输入摘要</h3>
      {version.comparison_rows.map(row => <div className="comparison-digest-row" key={row.comparison_line_id}>
        <span>Comparison Line ID {row.comparison_line_id} · RFQ Line {row.rfq_line_id} · Material {row.material_id} / {row.internal_material_code}</span>
        <small>{row.basis_digest_source}</small>
        <Copyable label={`basis_digest ${row.comparison_line_id}`} value={row.basis_digest}/>
      </div>)}
      <h3>确定性输出摘要</h3>
      <p>{model.output_summary_note || version.output_summary.note || OUTPUT_NOTE}</p>
      <Copyable label="输出摘要" value={version.output_summary.digest}/>
      <p className="comparison-canonical-note">canonical排序：Material ID、Supplier ID、Comparison Line ID、Comparison Candidate ID · {version.output_summary.canonical_rows.length} 条不可变输出行</p>
      <h3>Comparison生成操作凭证</h3>
      {version.operation_receipts.map(receipt => <article className="comparison-operation" key={`${receipt.request_id}:${receipt.comparison_version_no}`}>
        <dl>
          <div><dt>actor</dt><dd>{receipt.actor}</dd></div>
          <div><dt>时间（Asia/Shanghai）</dt><dd>{receipt.occurred_at_shanghai}</dd></div>
          <div><dt>结果</dt><dd>{receipt.result}</dd></div>
          <div><dt>RFQ CAS</dt><dd>{receipt.old_version === null ? "—" : `v${receipt.old_version}`} → {receipt.new_version === null ? "—" : `v${receipt.new_version}`}</dd></div>
          <div><dt>Comparison Version</dt><dd>v{receipt.comparison_version_no}</dd></div>
          <div><dt>Event数量</dt><dd>{receipt.event_count}条Line级Event</dd></div>
          <div className="wide"><dt>request_id</dt><dd><Copyable label="request_id" value={receipt.request_id}/></dd></div>
        </dl>
        <p>这些Line级Event组成一次Comparison生成操作，不是多次用户点击或多个Comparison Version。</p>
        <ul>{receipt.events.map(event => <li key={event.event_id}>Event {event.event_id} · Comparison Line ID {event.comparison_line_id} · RFQ Line {event.rfq_line_id} · Material {event.material_id} / {event.internal_material_code}</li>)}</ul>
      </article>)}
    </section>
  </details>;
}

export function ComparisonAggregateView({ model, busy, showGenerateAction, onGenerate }: Props) {
  const version = model.current_version;
  return <section className="sourcing-panel comparison-aggregate" data-comparison-read-model="server">
    <div className="sourcing-title comparison-heading">
      <div><p className="rfq-eyebrow">Comparison聚合读模型</p><h2>服务端横向比价</h2></div>
      {showGenerateAction ? <button type="button" disabled={busy || !model.generation.enabled} onClick={onGenerate}>{model.generation.label}</button> : null}
    </div>
    <p className="sourcing-note">按固定Quote输入和不可变Comparison Line生成确定性汇总。比价结果不代表自动审批，也不会自动产生Award。</p>
    {!version ? <div className="sourcing-state">尚未生成Comparison Version。</div> : <>
      <dl className="sourcing-facts comparison-identity">
        <div><dt>RFQ</dt><dd>ID {version.rfq_id} / {version.rfq_code}</dd></div>
        <div><dt>Round</dt><dd>Round {version.round_no}</dd></div>
        <div><dt>Comparison Version</dt><dd>v{version.comparison_version_no}</dd></div>
        <div><dt>状态投影</dt><dd><span className={`comparison-version-status status-${version.status.toLowerCase()}`}>{projectedStatus(version.status)}</span></dd></div>
        <div><dt>独立Comparison Header ID</dt><dd>{model.comparison_header_id ?? "无"}</dd></div>
        <div><dt>固定Quote输入</dt><dd>{version.quote_inputs_current ? "仍为当前版本" : "已发生漂移"}</dd></div>
        <div><dt>输入漂移</dt><dd>{version.input_drift ? "存在" : "不存在"}</dd></div>
        <div><dt>当前可定标</dt><dd>{version.awardable_now ? "服务端读模型允许进入定标" : "否"}</dd></div>
        <div><dt>生成操作者</dt><dd>{version.generated_by}</dd></div>
        <div><dt>生成时间（Asia/Shanghai）</dt><dd>{version.generated_at_shanghai}</dd></div>
        <div><dt>生成request_id</dt><dd><Copyable label="生成request_id" value={version.request_id}/></dd></div>
      </dl>
      <p className="comparison-governance-note">{model.has_independent_header_id ? model.identity_note : NO_HEADER_NOTE}</p>
      <p className="comparison-governance-note">{model.status_note || STATUS_NOTE} Award仍由服务端验证最新Comparison Version，不能信任页面标签。</p>
      {model.versions.length > 1 ? <div className="comparison-version-list" aria-label="Comparison版本列表">{model.versions.map(item => <span key={`${item.comparison_version_no}:${item.request_id}`}>v{item.comparison_version_no} · {projectedStatus(item.status)}</span>)}</div> : null}
      <div className="comparison-supplier-cards">{version.supplier_summaries.map(row => <SupplierSummaryCard key={row.supplier_id} row={row}/>)}</div>
      <AggregateDifferences version={version}/>
      <div className="comparison-desktop sourcing-table-wrap">
        <table><thead><tr><th>Material / 数量</th><th>Comparison Line ID</th>{version.supplier_summaries.map(supplier => <th key={supplier.supplier_id}>{supplier.supplier_code} · {supplier.supplier_name}</th>)}<th>每行差额</th></tr></thead><tbody>{version.material_summaries.map(material => <tr key={material.comparison_line_id}>
          <td><MaterialIdentity row={material}/></td>
          <td>{material.comparison_line_id}</td>
          {version.supplier_summaries.map(supplier => {const offer=material.offers.find(candidate=>candidate.supplier_id===supplier.supplier_id);return <td key={supplier.supplier_id}>{offer?<><span>Candidate ID {offer.comparison_candidate_id} / Quote Line {offer.quote_line_id}</span><span>单价 {money(offer.unit_price)} {supplier.currency_code}</span><b>行金额 {money(offer.line_amount)} {supplier.currency_code}</b><span>{dateOnly(offer.promised_delivery_date)}</span><span>{offer.delivery_status} / {offer.delivery_explanation}</span></>:"—"}</td>})}
          <td>{money(material.amount_difference)} CNY</td>
        </tr>)}</tbody></table>
      </div>
      <div className="comparison-material-cards">{version.material_summaries.map(material => <article className="comparison-material-card" key={material.rfq_line_id}>
        <header><MaterialIdentity row={material}/><span>Comparison Line ID {material.comparison_line_id}</span><strong>行差额 {money(material.amount_difference)} CNY</strong></header>
        <div>{material.offers.map(offer => <SupplierOffer key={offer.comparison_candidate_id} offer={offer}/>)}</div>
      </article>)}</div>
      <VersionTrace model={model} version={version}/>
    </>}
  </section>;
}
