"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type Session = { authenticated: boolean; csrf_token?: string };
type Operator = { username: string; display_name: string };
type Operation = {
  snapshot_operation_id: number; work_order_code: string; sequence_no: number; operation_code: string; operation_name: string;
  work_center_code: string; quality_gate_mode: "NONE" | "IPQC"; quality_required_qty: string; quality_inspected_qty: string;
  quality_released_qty: string; quality_hold_qty: string; available_for_next_qty: string; status: string; waiting_input_qty: string; version: number;
};

export default function DispatchPage() {
  const [session, setSession] = useState<Session | null>(null), [rows, setRows] = useState<Operation[]>([]), [operators, setOperators] = useState<Operator[]>([]), [error, setError] = useState("");
  async function load() { const current = await api<Session>("/api/session"); setSession(current); if (current.authenticated) { const [operations, users] = await Promise.all([api<{ rows: Operation[] }>("/api/production/operation-execution/operations"), api<{ rows: Operator[] }>("/api/production/operation-execution/operators")]); setRows(operations.rows); setOperators(users.rows); } }
  useEffect(() => { const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof ErpApiError ? cause.message : "读取失败")), 0); return () => clearTimeout(timer); }, []);
  async function submit(event: FormEvent<HTMLFormElement>, row: Operation) { event.preventDefault(); if (!session?.csrf_token) return; const form = new FormData(event.currentTarget); setError(""); try { await api("/api/production/operation-execution/dispatch", { method: "POST", body: JSON.stringify({ snapshot_operation_id: row.snapshot_operation_id, quantity: String(form.get("quantity")), assigned_operator: String(form.get("assigned_operator")), planned_start: String(form.get("planned_start") || ""), planned_end: String(form.get("planned_end") || ""), expected_operation_version: row.version }), protectedWrite: { csrfToken: session.csrf_token, idempotencyKey: crypto.randomUUID() } }); await load(); } catch (cause) { setError(cause instanceof ErpApiError ? `${cause.message} (${cause.code})` : "派工失败"); } }
  return <main className="sourcing-shell">
    <header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>工序分批派工</h1><p>生产派工准备以 Work Order Routing Snapshot Operation ID 为权威；第一待执行工序从固化快照确定，IPQC 门禁只允许消费已关闭且已放行额度。本页不提供开工、完工或报工按钮；LEGACY_UNSTRUCTURED 工单继续走兼容路径。</p><nav><Link href="/production/operations">工序执行</Link> · <Link href="/production/wip">WIP 看板</Link></nav></div></header>
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
    <section className="sourcing-panel"><h2>READY / IN_PROGRESS 工序</h2>{rows.map((row) => <article className="sourcing-card" key={row.snapshot_operation_id}>
      <b>{row.work_order_code} · {row.sequence_no} {row.operation_code} {row.operation_name}</b>
      <small>Snapshot Operation #{row.snapshot_operation_id} · Work Center {row.work_center_code} · 门禁 {row.quality_gate_mode} · {row.status} · 可派 {row.waiting_input_qty}</small>
      <p>需检/已检/passed released/Quality Hold {row.quality_required_qty}/{row.quality_inspected_qty}/{row.quality_released_qty}/{row.quality_hold_qty} · 下工序可用 {row.available_for_next_qty}</p>
      {["READY", "IN_PROGRESS"].includes(row.status) && Number(row.waiting_input_qty) > 0 ? <form onSubmit={(event) => void submit(event, row)}><label>数量 <input name="quantity" type="number" min="0.000001" step="0.000001" max={row.waiting_input_qty} required /></label><label>执行人 <select name="assigned_operator" required>{operators.map((item) => <option value={item.username} key={item.username}>{item.display_name} ({item.username})</option>)}</select></label><label>计划开始 <input name="planned_start" type="datetime-local" /></label><label>计划结束 <input name="planned_end" type="datetime-local" /></label><button type="submit">创建派工</button></form> : <p>{row.quality_gate_mode === "IPQC" && Number(row.quality_hold_qty) > 0 ? "Quality Hold 尚未形成可消费放行额度。" : "当前没有可派投入。"}</p>}
    </article>)}</section>
  </main>;
}
