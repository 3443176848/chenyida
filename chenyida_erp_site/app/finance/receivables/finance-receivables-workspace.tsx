"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null; csrf_token?: string };
type Source = { source_entry_id: number; shipment_id: number; source_code: string; amount: string; currency_code: string; customer_code: string; customer_name: string; source_date: string };
type Ar = { id: number; doc_code: string; total_amount: string; settled_amount: string; status: string; customer_name: string };

const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const message = (error: unknown) => error instanceof ErpApiError ? `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}` : "系统暂时无法完成请求";

export function FinanceReceivablesWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [ars, setArs] = useState<Ar[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await api<Session>("/api/session");
      setSession(current);
      if (current.authenticated && can(current.user, "finance.read")) {
        const documents = await api<{ data: Ar[] }>("/api/financial-documents?doc_type=AR&page_size=100");
        setArs(documents.data);
        if (can(current.user, "finance.post")) {
          const options = await api<{ data: Source[] }>("/api/finance/source-options?document_type=AR&limit=100");
          setSources(options.data);
        }
      }
    } catch (cause) {
      setError(message(cause));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function createAr(row: Source) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api("/api/finance/documents", {
        method: "POST",
        body: JSON.stringify({ doc_type: "AR", sales_source_entry_id: row.source_entry_id, accounting_date: today, due_date: today }),
        protectedWrite: { csrfToken: session.csrf_token!, idempotencyKey: crypto.randomUUID() },
      });
      setNotice(`已核对 ${row.source_code} 并显式生成 AR ${row.amount} ${row.currency_code}`);
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <main className="sourcing-shell">正在读取会话…</main>;
  if (!session.authenticated) return <main className="sourcing-shell">请先登录。</main>;
  if (!can(session.user, "finance.read")) return <main className="sourcing-shell">没有应收读取权限。</main>;

  return <main className="sourcing-shell">
    <div className="sourcing-banner">Shipment 只形成稳定金额来源 · AR 由 finance 显式创建 · 收款在受控收付款页登记</div>
    <header className="sourcing-header"><div><Link href="/" className="sourcing-back">← 经营工作台</Link><p className="sourcing-kicker">SALES RECEIVABLE HANDOFF</p><h1>销售发货应收交接</h1><p>Customer、Currency、Amount 全部继承 Shipment Source，浏览器不提交总金额或客户。</p></div></header>
    <section className="sourcing-metrics"><div><small>已发货待生成 AR</small><strong>{sources.length}</strong></div><div><small>AR 单据</small><strong>{ars.length}</strong></div><div><small>收付款工作台</small><strong><Link href="/finance/settlements">进入</Link></strong></div></section>
    <section className="sourcing-panel"><h2>待核对销售金额来源</h2>{sources.map((row) => <article className="sourcing-card" key={row.source_entry_id}><div><b>{row.source_code}</b><span className="sourcing-status status-pending">待生成 AR</span></div><p>{row.customer_code} · {row.customer_name} · <b>{row.amount} {row.currency_code}</b></p>{can(session.user, "finance.post") ? <button disabled={busy} onClick={() => void createAr(row)}>核对并显式生成 AR</button> : null}</article>)}{!sources.length ? <div className="sourcing-state">当前没有待生成 AR 的有效 Shipment Source。</div> : null}</section>
    <section className="sourcing-panel"><h2>AR 未结</h2>{ars.map((row) => <article className="sourcing-card" key={row.id}><b>{row.doc_code} · {row.status}</b><p>应收 {row.total_amount} · 已结 {row.settled_amount}</p></article>)}</section>
    {notice ? <div className="sourcing-state">{notice}</div> : null}
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
  </main>;
}
