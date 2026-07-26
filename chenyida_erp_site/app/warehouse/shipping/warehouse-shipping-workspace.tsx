"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null; csrf_token?: string };
type Line = { id: number; version: number; sales_order_line_version: number; quantity: string; executed_qty: string; balance_version: number; inventory_available_qty: string; finished_item_code: string; uom: string };
type Detail = { header: { id: number; delivery_code: string; status: string; version: number; sales_order_version: number; sales_order_code: string }; lines: Line[] };

const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const message = (error: unknown) => error instanceof ErpApiError ? `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}` : "系统暂时无法完成请求";

export function WarehouseShippingWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Detail[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await api<Session>("/api/session");
      setSession(current);
      if (current.authenticated && can(current.user, "sales.delivery.read")) {
        const list = await api<{ data: Array<{ id: number }> }>("/api/delivery-instructions?page_size=100");
        const details = await Promise.all(list.data.map((row) => api<{ data: Detail }>(`/api/delivery-instructions/${row.id}`)));
        setRows(details.map((item) => item.data));
      }
    } catch (cause) {
      setError(message(cause));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function transition(row: Detail, verb: "accept" | "return") {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/delivery-instructions/${row.header.id}/${verb}`, {
        method: "POST",
        body: JSON.stringify({ expected_version: row.header.version, reason: verb === "return" ? "仓库退回待销售核对" : "" }),
        protectedWrite: { csrfToken: session.csrf_token!, idempotencyKey: crypto.randomUUID() },
      });
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function ship(event: FormEvent<HTMLFormElement>, row: Detail) {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    const line = row.lines[0];
    setBusy(true);
    setError("");
    try {
      await api(`/api/delivery-instructions/${row.header.id}/execute`, {
        method: "POST",
        body: JSON.stringify({
          expected_instruction_version: row.header.version,
          expected_sales_order_version: row.header.sales_order_version,
          reason: "仓库按已接收指令分批发货",
          lines: [{
            instruction_line_id: line.id,
            quantity: String(form.get("quantity")),
            expected_line_version: line.version,
            expected_sales_order_line_version: line.sales_order_line_version,
            expected_balance_version: line.balance_version,
          }],
        }),
        protectedWrite: { csrfToken: session.csrf_token!, idempotencyKey: crypto.randomUUID() },
      });
      setNotice("Shipment、逐笔 FQC 消费、成品出库、SO 投影与金额来源已原子过账；未自动创建 AR");
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <main className="sourcing-shell">正在读取会话…</main>;
  if (!session.authenticated) return <main className="sourcing-shell">请先登录。</main>;
  if (!can(session.user, "sales.delivery.read")) return <main className="sourcing-shell">没有仓库发货读取权限。</main>;

  return <main className="sourcing-shell">
    <div className="sourcing-banner">仓库只能执行已接收指令 · 分批发货精确消费 CLOSED/RELEASED FQC</div>
    <header className="sourcing-header"><div><Link href="/" className="sourcing-back">← 经营工作台</Link><p className="sourcing-kicker">WAREHOUSE SHIPPING</p><h1>销售分批发货</h1></div></header>
    <section className="sourcing-panel">{rows.map((row) => <article className="sourcing-card" key={row.header.id}>
      <div><b>{row.header.delivery_code} · {row.header.sales_order_code}</b><span className="sourcing-status status-pending">{row.header.status}</span></div>
      {row.lines.map((line) => <p key={line.id}>{line.finished_item_code} · 指令 {line.quantity} · 已发 {line.executed_qty} {line.uom} · 库存可用 {line.inventory_available_qty}</p>)}
      {row.header.status === "SUBMITTED" && can(session.user, "sales.delivery.accept") ? <><button disabled={busy} onClick={() => void transition(row, "accept")}>接收指令</button><button disabled={busy} onClick={() => void transition(row, "return")}>退回销售</button></> : null}
      {["ACCEPTED", "PARTIAL"].includes(row.header.status) && can(session.user, "sales.delivery.execute") && row.lines[0] ? <form className="sourcing-form" onSubmit={(event) => ship(event, row)}><label>本批发货数量<input name="quantity" required defaultValue={String(Number(row.lines[0].quantity) - Number(row.lines[0].executed_qty))} /></label><button disabled={busy}>原子过账发货</button></form> : null}
    </article>)}</section>
    {notice ? <div className="sourcing-state">{notice}</div> : null}
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
  </main>;
}
