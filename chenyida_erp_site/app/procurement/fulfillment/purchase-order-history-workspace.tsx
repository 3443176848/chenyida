"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { roleLabel } from "../../../public/erp/status-localization.js";
import type { PurchaseOrderHistoryReadModel } from "../../lib/procurement-fulfillment-selfhost/purchase-order-history.ts";
import "./purchase-order-history.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null };

const can = (user: User | null | undefined, permission: string) => Boolean(
  user && (user.permissions.includes("*") || user.permissions.includes(permission)),
);
const errorMessage = (error: unknown) => error instanceof ErpApiError
  ? `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}`
  : "系统暂时无法读取采购订单历史";
const trimDecimal = (value: string) => value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
const amount = (value: string) => Number(value).toFixed(2);

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }
  return <span className="po-history-copy-value"><code>{value}</code><button type="button" onClick={() => void copy()} aria-label={`复制${label}`}>{copied ? "已复制" : "复制"}</button></span>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="po-history-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function LineCard({ line }: { line: PurchaseOrderHistoryReadModel["lines"][number] }) {
  return <article className="po-history-mobile-card" data-testid={`po-line-card-${line.purchase_order_line_id}`}>
    <header><strong>PO Line {line.purchase_order_line_id}</strong><span>{line.status} · v{line.version}</span></header>
    <dl>
      <Fact label="稳定来源">Award Line {line.award_line_id} / Candidate {line.candidate_id}</Fact>
      <Fact label="Quote / Binding">Quote Line {line.quote_line_id} · Quote {line.quote_id}/v{line.quote_version} · Binding {line.binding_id}</Fact>
      <Fact label="Material">{line.material_id} / {line.material_code}<br/>{line.material_name}</Fact>
      <Fact label="Mapping">Fact {line.mapping_fact_id}/v{line.mapping_version}/CAS{line.mapping_row_cas}<CopyValue value={line.mapping_uuid} label="Mapping UUID"/></Fact>
      <Fact label="Supplier">{line.supplier_label} · {line.supplier_code}<br/>{line.supplier_name}</Fact>
      <Fact label="数量 / 已收">{trimDecimal(line.quantity)} {line.unit_code} / {trimDecimal(line.received_quantity)} {line.unit_code}</Fact>
      <Fact label="价格 / 行额">{amount(line.unit_price)} {line.currency_code}/{line.unit_code} · {amount(line.line_amount)} {line.currency_code}</Fact>
      <Fact label="计划日期">{line.planned_delivery_date}</Fact>
    </dl>
  </article>;
}

function PlanCard({ plan }: { plan: PurchaseOrderHistoryReadModel["delivery_plans"][number] }) {
  return <article className="po-history-mobile-card" data-testid={`delivery-plan-card-${plan.delivery_plan_id}`}>
    <header><strong>Delivery Plan {plan.delivery_plan_id}</strong><span>{plan.status} / {plan.status_label} · v{plan.version}</span></header>
    <dl>
      <Fact label="PO / PO Line">{plan.purchase_order_id} / {plan.purchase_order_line_id}</Fact>
      <Fact label="Award Line">{plan.award_line_id}</Fact>
      <Fact label="Material">{plan.material_id} / {plan.material_code}<br/>{plan.material_name}</Fact>
      <Fact label="数量 / 日期">{trimDecimal(plan.quantity)} {plan.unit_code} · {plan.planned_delivery_date}</Fact>
      <Fact label="Plan Event">ID {plan.plan_event_id} · {plan.plan_event_type}</Fact>
      <Fact label="actor / 时间">{plan.actor}<br/>{plan.occurred_at_shanghai} Asia/Shanghai</Fact>
      <Fact label="request_id"><CopyValue value={plan.request_id} label="Plan request_id"/></Fact>
      <Fact label="queue">ID {plan.queue_id} · {plan.queue_status} / {plan.queue_status_label} · v{plan.queue_version}</Fact>
    </dl>
  </article>;
}

export function PurchaseOrderHistoryWorkspace({ purchaseOrderId }: { purchaseOrderId: number }) {
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<PurchaseOrderHistoryReadModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await api<Session>("/api/session", { cache: "no-store" });
      setSession(current);
      if (!current.authenticated || !can(current.user, "procurement.fulfillment.read")) return;
      const response = await api<{ data: PurchaseOrderHistoryReadModel }>(
        `/api/procurement/purchase-orders/${purchaseOrderId}/history`,
        { cache: "no-store" },
      );
      if (response.data.contract_version !== "PO_HISTORY_TRACEABILITY_V1"
        || response.data.read_only !== true
        || response.data.purchase_order.purchase_order_id !== String(purchaseOrderId)) {
        throw new Error("purchase order history contract mismatch");
      }
      setHistory(response.data);
    } catch (loadError) {
      setHistory(null); setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [purchaseOrderId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (loading && !session) return <main className="po-history-shell"><div className="po-history-state">正在读取只读PO历史…</div></main>;
  if (session && !session.authenticated) return <main className="po-history-shell"><div className="po-history-state">请先登录。</div></main>;
  if (session && !can(session.user, "procurement.fulfillment.read")) return <main className="po-history-shell"><div className="po-history-state po-history-error">没有采购履约读取权限。</div></main>;
  if (!history) return <main className="po-history-shell"><Link href="/procurement/fulfillment" className="po-history-back">← 返回采购履约</Link><div className="po-history-state po-history-error">{error || "没有可展示的采购订单历史。"}</div><button className="po-history-refresh" type="button" onClick={() => void load()}>重新读取</button></main>;

  const po = history.purchase_order;
  const event = history.credentials.purchase_order_event;
  const audit = history.credentials.audit;
  const idem = history.credentials.idempotency;
  const failed = history.credentials.historical_failed_attempt;
  const lineage = history.lineage;
  const downstream = history.downstream;

  return <main className="po-history-shell" data-contract={history.contract_version}>
    <div className="po-history-banner"><strong>只读历史视图</strong><span>关系化事实快照 · 不执行任何业务写入</span></div>
    <header className="po-history-header">
      <div><Link href="/procurement/fulfillment" className="po-history-back">← 返回采购履约</Link><p className="po-history-kicker">采购订单稳定历史</p><h1>{po.po_code}</h1><p>PO数据库ID {po.purchase_order_id} · Version v{po.version}</p></div>
      <div className="po-history-header-actions"><span className="po-history-status">{po.status} / {po.status_label}</span><button className="po-history-refresh" type="button" disabled={loading} onClick={() => void load()}>{loading ? "读取中…" : "刷新只读快照"}</button><small>{session?.user?.display_name || session?.user?.username} · {roleLabel(session?.user?.role || "")}</small></div>
    </header>

    <section className="po-history-section" aria-labelledby="po-summary-heading">
      <div className="po-history-section-title"><div><p>Aggregate</p><h2 id="po-summary-heading">PO聚合摘要</h2></div><span>观测时间 {history.observed_at}</span></div>
      <dl className="po-history-facts po-history-summary-grid">
        <Fact label="PO身份"><CopyValue value={po.purchase_order_id} label="PO ID"/> · {po.po_code} · v{po.version}</Fact>
        <Fact label="状态">{po.status} / {po.status_label}</Fact>
        <Fact label="Supplier">ID {po.supplier_id} · {po.supplier_code}<br/>{po.supplier_name}</Fact>
        <Fact label="商业条件">{po.currency_code} · {po.tax_label} · {po.freight_label}<br/>付款条件：{po.payment_terms}（{po.commercial_terms_source}）</Fact>
        <Fact label="数量">订购 {trimDecimal(po.ordered_quantity)} {po.unit_code}<br/>已收 {trimDecimal(po.received_quantity)} {po.unit_code}</Fact>
        <Fact label="总额">{amount(po.total_amount)} {po.currency_code}</Fact>
        <Fact label="实际存储备注"><span className="po-history-preserved">{po.remark}</span></Fact>
        <Fact label="创建actor / 时间">{po.created_by}<br/>{po.created_at_shanghai} Asia/Shanghai</Fact>
        <Fact label="request_id"><CopyValue value={po.request_id} label="PO request_id"/></Fact>
        <Fact label="conversion operation"><CopyValue value={po.conversion_operation_id} label="conversion operation"/></Fact>
        <Fact label="PO operation"><CopyValue value={po.po_operation_id} label="PO operation"/></Fact>
        <Fact label="Action / 可再次转单">{po.conversion_action}<br/>po_convertible_now={String(po.po_convertible_now)}</Fact>
      </dl>
      <aside className="po-history-governance"><strong>控制边界</strong><p>{history.governance_boundary.note}</p></aside>
    </section>

    <section className="po-history-section" aria-labelledby="lineage-heading">
      <div className="po-history-section-title"><div><p>Lineage</p><h2 id="lineage-heading">完整上游谱系</h2></div></div>
      <ol className="po-history-lineage">
        <li><small>Project</small><strong>{lineage.project.id}</strong><span>{lineage.project.code}</span></li>
        <li><small>MRP</small><strong>{lineage.material_requirement_plan.id} / v{lineage.material_requirement_plan.version}</strong><span>{lineage.material_requirement_plan.status}</span></li>
        <li><small>PRQ</small><strong>{lineage.purchase_request.id} / v{lineage.purchase_request.version}</strong><span>{lineage.purchase_request.code}</span></li>
        <li><small>RFQ</small><strong>{lineage.rfq.id} / v{lineage.rfq.version}</strong><span>{lineage.rfq.code}</span></li>
        <li><small>Comparison</small><strong>Version {lineage.comparison.version}</strong><span>{lineage.comparison.status}</span></li>
        <li><small>Quote</small><strong>{lineage.quote.id} / v{lineage.quote.version}</strong><span>选中商业条款来源</span></li>
        <li><small>Award</small><strong>{lineage.award.id} / v{lineage.award.version}</strong><span>{lineage.award.status}</span></li>
        <li><small>PO</small><strong>{lineage.purchase_order.id} / v{lineage.purchase_order.version}</strong><span>{lineage.purchase_order.status}</span></li>
      </ol>
      <div className="po-history-digests">
        <Fact label="Comparison output digest"><CopyValue value={history.digests.comparison_output_digest} label="Comparison output digest"/></Fact>
        <Fact label="Award持久化摘要"><CopyValue value={history.digests.persisted_award_digest} label="Award持久化摘要"/></Fact>
        <Fact label="Award派生决策摘要"><CopyValue value={history.digests.derived_award_decision_digest} label="Award派生决策摘要"/></Fact>
      </div>
    </section>

    <section className="po-history-section" aria-labelledby="lines-heading">
      <div className="po-history-section-title"><div><p>Lines</p><h2 id="lines-heading">PO Line稳定谱系</h2></div><span>{history.line_summary.line_count} 条 · {history.line_summary.duplicate_material_note}</span></div>
      <div className="po-history-supplier-summary">{history.supplier_summaries.map((supplier) => <article key={supplier.supplier_id}><strong>{supplier.label}</strong><span>{supplier.supplier_code} · {supplier.supplier_name}</span><b>PO行 {supplier.line_count} · {amount(supplier.total_amount)} {supplier.currency_code}</b></article>)}</div>
      <div className="po-history-table-wrap po-history-desktop-table"><table><thead><tr><th>PO Line</th><th>Award / Candidate</th><th>Quote / Binding</th><th>Material</th><th>Mapping</th><th>商业与交付</th></tr></thead><tbody>{history.lines.map((line) => <tr key={line.purchase_order_line_id} data-testid={`po-line-row-${line.purchase_order_line_id}`}><td><b>{line.purchase_order_line_id}</b><br/>Line No. {line.line_no}<br/>{line.status} · v{line.version}</td><td>Award Line {line.award_line_id}<br/>Comparison {line.comparison_line_id}<br/>Candidate {line.candidate_id}</td><td>Quote {line.quote_id}/v{line.quote_version}<br/>Quote Line {line.quote_line_id}<br/>Binding {line.binding_id}</td><td>{line.material_id} / {line.material_code}<br/>{line.material_name}</td><td>Fact {line.mapping_fact_id}/v{line.mapping_version}/CAS{line.mapping_row_cas}<CopyValue value={line.mapping_uuid} label="Mapping UUID"/></td><td>{line.supplier_label}<br/>{trimDecimal(line.quantity)} {line.unit_code} · 已收 {trimDecimal(line.received_quantity)}<br/>{amount(line.unit_price)} {line.currency_code}/{line.unit_code} · {amount(line.line_amount)} {line.currency_code}<br/>{line.planned_delivery_date}</td></tr>)}</tbody></table></div>
      <div className="po-history-mobile-list">{history.lines.map((line) => <LineCard key={line.purchase_order_line_id} line={line}/>)}</div>
    </section>

    <section className="po-history-section" aria-labelledby="plans-heading">
      <div className="po-history-section-title"><div><p>Delivery</p><h2 id="plans-heading">Delivery Plan与queue</h2></div><span>{history.delivery_plans.length} 条直接对应关系</span></div>
      <aside className="po-history-info">{history.delivery_model.note} queue是待处理队列，不代表已收货或已入库。</aside>
      <div className="po-history-table-wrap po-history-desktop-table"><table><thead><tr><th>Delivery Plan</th><th>稳定来源</th><th>Material / 数量</th><th>Plan Event</th><th>actor / request</th><th>queue</th></tr></thead><tbody>{history.delivery_plans.map((plan) => <tr key={plan.delivery_plan_id} data-testid={`delivery-plan-row-${plan.delivery_plan_id}`}><td><b>ID {plan.delivery_plan_id}</b><br/>{plan.status} / {plan.status_label}<br/>v{plan.version} · {plan.planned_delivery_date}</td><td>PO {plan.purchase_order_id}<br/>PO Line {plan.purchase_order_line_id}<br/>Award Line {plan.award_line_id}</td><td>{plan.material_id} / {plan.material_code}<br/>{trimDecimal(plan.quantity)} {plan.unit_code}<br/>已收 {trimDecimal(plan.received_quantity)}</td><td>ID {plan.plan_event_id}<br/>{plan.plan_event_type}</td><td>{plan.actor}<br/>{plan.occurred_at_shanghai}<CopyValue value={plan.request_id} label="Plan request_id"/></td><td>ID {plan.queue_id}<br/>{plan.queue_status} / {plan.queue_status_label}<br/>v{plan.queue_version}</td></tr>)}</tbody></table></div>
      <div className="po-history-mobile-list">{history.delivery_plans.map((plan) => <PlanCard key={plan.delivery_plan_id} plan={plan}/>)}</div>
    </section>

    <section className="po-history-section" aria-labelledby="credentials-heading">
      <div className="po-history-section-title"><div><p>Credentials</p><h2 id="credentials-heading">Event、Audit与幂等凭证</h2></div><span>PO受限DTO · 无通用system.audit.read</span></div>
      <div className="po-history-credential-grid">
        <details><summary>PO Event · ID {event.event_id} · {event.result}</summary><dl><Fact label="转换">{event.event_type} · {event.from_status ?? "null"} → {event.to_status}</Fact><Fact label="actor / 时间">{event.actor}<br/>{event.occurred_at_shanghai} Asia/Shanghai</Fact><Fact label="request_id"><CopyValue value={event.request_id} label="PO Event request_id"/></Fact></dl></details>
        <details><summary>Audit · ID {audit.audit_id} · {audit.result}</summary><dl><Fact label="Action">{audit.action}</Fact><Fact label="actor / 时间">{audit.actor}<br/>{audit.occurred_at_shanghai} Asia/Shanghai</Fact><Fact label="request_id"><CopyValue value={audit.request_id} label="Audit request_id"/></Fact><Fact label="operation"><CopyValue value={audit.operation_id} label="Audit operation"/></Fact></dl></details>
        <details><summary>Idempotency · HTTP {idem.http_status}</summary><dl><Fact label="key digest"><CopyValue value={idem.key_digest} label="Idempotency digest"/></Fact><Fact label="request digest"><CopyValue value={idem.request_digest} label="request digest"/></Fact><Fact label="公开边界">{idem.exposed_fields_note}</Fact></dl></details>
        <details className="po-history-failed"><summary>历史失败请求 · {failed.available ? `${failed.result} / HTTP ${failed.http_status ?? "未知"}` : "无可安全归属项"}</summary><dl>{failed.available ? <><Fact label="关系">{failed.relation}</Fact><Fact label="request_id"><CopyValue value={failed.request_id || ""} label="失败request_id"/></Fact><Fact label="结果 / 业务记录">{failed.result} · HTTP {failed.http_status ?? "未知"}（{failed.http_status_source}）<br/>业务记录 {failed.business_record_count}</Fact></> : null}<Fact label="隔离说明">{failed.note}</Fact></dl></details>
      </div>
    </section>

    <section className="po-history-section" aria-labelledby="downstream-heading">
      <div className="po-history-section-title"><div><p>Downstream</p><h2 id="downstream-heading">下游零写入状态</h2></div><span className={downstream.all_zero ? "po-history-zero" : "po-history-nonzero"}>{downstream.all_zero ? "全部为0" : "存在下游记录"}</span></div>
      <div className="po-history-counts">
        <article><span>Receipt</span><strong>{downstream.receipt}</strong></article><article><span>Warehouse Receipt</span><strong>{downstream.warehouse_receipt}</strong></article><article><span>Inventory Ledger</span><strong>{downstream.inventory_ledger}</strong></article><article><span>Lot</span><strong>{downstream.lot}</strong></article><article><span>IQC</span><strong>{downstream.iqc}</strong></article><article><span>AP</span><strong>{downstream.ap}</strong></article><article><span>Payment</span><strong>{downstream.payment}</strong></article><article><span>Work Order</span><strong>{downstream.work_order}</strong></article><article><span>生产报告</span><strong>{downstream.production_report}</strong></article><article><span>完工记录</span><strong>{downstream.production_completion}</strong></article>
      </div>
      <ul className="po-history-boundaries">{history.protected_boundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
      <p className="po-history-scope-note">{downstream.scope_note}</p>
    </section>
  </main>;
}
