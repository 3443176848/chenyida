"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { roleLabel, statusLabel, statusPairLabel } from "../../../public/erp/status-localization.js";
import type { AwardConversionPreview } from "../../lib/procurement-fulfillment-selfhost/award-conversion-preview.ts";
import { AwardPoConversionDialog, AwardPoConversionLoadingDialog } from "./award-po-conversion-dialog.tsx";
import "../sourcing/sourcing.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null; csrf_token?: string };
type Award = { award_id: number; award_version: number; rfq_id: number; rfq_code: string; request_code: string; line_count: number; total_quantity: string; converted_line_count: number; selected_at: string };
type Order = { purchase_order_id: number; po_code: string; po_status: string; currency_code: string; po_version: number; supplier_code: string; supplier_name: string; line_count: number; plan_count: number; ordered_quantity: string; received_quantity: string; receipt_count: number; receipt_codes: string; internal_lots: string; supplier_lots: string; iqc_status: string };

const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const message = (error: unknown) => error instanceof ErpApiError ? `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}` : "系统暂时无法完成请求";
async function post(session: Session, path: string, body: Record<string, unknown>, idempotencyKey: string = crypto.randomUUID()) {
  return api(path, { method: "POST", body: JSON.stringify(body), protectedWrite: { csrfToken: session.csrf_token!, idempotencyKey } });
}

export function ProcurementFulfillmentWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [conversionPreview, setConversionPreview] = useState<AwardConversionPreview | null>(null);
  const [conversionRemark, setConversionRemark] = useState("");
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionSubmitted, setConversionSubmitted] = useState(false);
  const [conversionError, setConversionError] = useState("");
  const previewRun = useRef(0);
  const conversionInFlight = useRef(false);
  const conversionKey = useRef("");

  const load = useCallback(async () => {
    try {
      const current = await api<Session>("/api/session");
      setSession(current);
      if (current.authenticated && can(current.user, "procurement.fulfillment.read")) {
        const [awardResponse, orderResponse] = await Promise.all([
          api<{ data: Award[] }>("/api/procurement/fulfillment/pending-awards?page_size=100"),
          api<{ data: Order[] }>("/api/procurement/fulfillment/orders?page_size=100"),
        ]);
        setAwards(awardResponse.data); setOrders(orderResponse.data);
      }
    } catch (loadError) { setError(message(loadError)); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function write(path: string, body: Record<string, unknown>, success: string) {
    if (!session) return;
    setBusy(true); setError("");
    try { await post(session, path, body); setNotice(success); await load(); }
    catch (writeError) { setError(message(writeError)); }
    finally { setBusy(false); }
  }

  async function openConversion(row: Award) {
    if (previewLoading || conversionBusy) return;
    const run = previewRun.current + 1; previewRun.current = run;
    conversionInFlight.current = false; conversionKey.current = crypto.randomUUID();
    setConversionPreview(null); setConversionRemark(""); setConversionError(""); setConversionSubmitted(false);
    setError(""); setNotice(""); setPreviewLoading(true);
    try {
      const result = await api<{ data: AwardConversionPreview }>(`/api/procurement/awards/${row.award_id}/purchase-order-conversion-preview`, { cache: "no-store" });
      if (previewRun.current !== run) return;
      if (result.data.contract_version !== "AWARD_PO_CONFIRMATION_V2"
        || result.data.award.award_id !== String(row.award_id)
        || result.data.award.version !== row.award_version
        || result.data.rfq.rfq_id !== String(row.rfq_id)
        || result.data.mapping_qualification.contract_version !== "AWARD_PO_MAPPING_QUALIFICATION_V1"
        || !/^[0-9a-f]{64}$/.test(result.data.mapping_qualification.qualification_digest)) throw new Error("conversion preview mismatch");
      setConversionPreview(result.data);
    } catch (previewError) {
      if (previewRun.current === run) setError(message(previewError));
    } finally { if (previewRun.current === run) setPreviewLoading(false); }
  }

  function cancelConversion() {
    previewRun.current += 1;
    conversionInFlight.current = false; conversionKey.current = "";
    setPreviewLoading(false); setConversionPreview(null); setConversionRemark("");
    setConversionError(""); setConversionSubmitted(false); setConversionBusy(false);
  }

  async function confirmConversion() {
    if (!session || !conversionPreview || conversionInFlight.current
      || conversionPreview.po_convertible_now !== true || conversionPreview.mapping_qualification.all_qualified !== true) return;
    conversionInFlight.current = true;
    setConversionSubmitted(true); setConversionBusy(true); setConversionError("");
    try {
      await post(session, `/api/procurement/awards/${conversionPreview.award.award_id}/purchase-orders`, {
        ...conversionPreview.confirmation,
        remark: conversionRemark,
      }, conversionKey.current);
      setNotice("采购订单、PO Line与逐行到货计划已在同一事务生成；未自动创建收货、库存、IQC、应付或生产记录");
      setConversionPreview(null); setConversionRemark("");
      await load();
    } catch (conversionFailure) {
      setConversionError(message(conversionFailure));
    } finally { setConversionBusy(false); }
  }

  if (!session) return <main className="sourcing-shell">正在读取会话…</main>;
  if (!session.authenticated) return <main className="sourcing-shell">请先登录。</main>;
  if (!can(session.user, "procurement.fulfillment.read")) return <main className="sourcing-shell"><div className="sourcing-state sourcing-error">没有采购履约读取权限。</div></main>;

  return <main className="sourcing-shell">
    <div className="sourcing-banner">并行验收环境 · 定标转PO必须先读取权威预览并最终确认；采购只读查看收货单 → 供应商批次 → IQC状态</div>
    <header className="sourcing-header"><div><Link href="/procurement/sourcing" className="sourcing-back">← 供应商询价与定标</Link><p className="sourcing-kicker">寻源履约</p><h1>定标转单、到货计划与来料谱系</h1><p>采购确认不可变定标来源；仓库与品质分别负责收货和IQC放行。</p></div><div><b>{session.user!.display_name || session.user!.username}</b><span>{roleLabel(session.user!.role)}</span></div></header>
    <section className="sourcing-metrics"><div><small>待转PO定标</small><strong>{awards.length}</strong></div><div><small>采购订单</small><strong>{orders.length}</strong></div><div><small>待建计划采购订单</small><strong>{orders.filter((order) => order.plan_count < order.line_count).length}</strong></div></section>
    <div className="sourcing-grid"><section className="sourcing-panel"><h2>待显式转PO的定标</h2>{awards.map((row) => <article className="sourcing-card" key={row.award_id}><div><b>{row.rfq_code} · 定标 #{row.award_id}</b><span className="sourcing-status status-awarded">已定标</span></div><p>{row.request_code} · {row.line_count} 行 · 数量 {row.total_quantity}</p><small>已转行 {row.converted_line_count} · 定标 v{row.award_version}</small>{can(session.user, "procurement.award.convert") ? <button disabled={busy || previewLoading || conversionBusy} onClick={() => void openConversion(row)}>显式生成采购订单</button> : null}</article>)}{!awards.length ? <div className="sourcing-state">没有待转单定标。</div> : null}</section>
      <section className="sourcing-panel"><h2>采购订单与到货计划</h2>{orders.map((row) => <article className="sourcing-card" key={row.purchase_order_id}><div><b>{row.po_code} · {row.supplier_code}</b><span className={`sourcing-status status-${row.po_status.toLowerCase()}`}>{statusLabel(row.po_status)}</span></div><p>{row.supplier_name} · {row.currency_code} · 订购 {row.ordered_quantity} · 已收 {row.received_quantity}</p><small>{row.plan_count}/{row.line_count} 行已有计划 · PO v{row.po_version}</small>{row.receipt_count ? <p>收货单：{row.receipt_codes}<br/>内部批次：{row.internal_lots || "兼容空批次"}<br/>供应商批次：{row.supplier_lots || "—"}<br/>IQC：{row.iqc_status ? statusPairLabel(row.iqc_status) : "待创建"}</p> : null}{row.plan_count === 0 && can(session.user, "procurement.delivery_plan.manage") ? <button disabled={busy || conversionBusy} onClick={() => void write(`/api/procurement/purchase-orders/${row.purchase_order_id}/delivery-plans`, { expected_version: row.po_version }, "到货计划和待入库记录已建立；库存与应付仍为零")}>建立到货计划</button> : null}</article>)}</section></div>
    {notice ? <div className="sourcing-state">{notice}</div> : null}{error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
    {previewLoading ? <AwardPoConversionLoadingDialog onCancel={cancelConversion} /> : null}
    {conversionPreview ? <AwardPoConversionDialog preview={conversionPreview} remark={conversionRemark} onRemark={setConversionRemark} busy={conversionBusy} submitted={conversionSubmitted} error={conversionError} onCancel={cancelConversion} onConfirm={() => void confirmConversion()} /> : null}
  </main>;
}
