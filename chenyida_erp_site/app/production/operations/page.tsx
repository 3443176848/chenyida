"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type Session = { authenticated: boolean; csrf_token?: string; user?: { permissions: string[] } };
type Run = {
  id: number; run_code: string; run_kind:"NORMAL"|"REWORK";rework_request_id?:number;nonconformance_id?:number;source_inspection_id?:number;source_operation_run_report_id?:number;work_order_code: string; snapshot_operation_id: number; sequence_no: number; operation_code: string; operation_name: string; work_center_code: string;
  quality_gate_mode: "NONE" | "IPQC"; assigned_operator: string; assigned_operator_name: string; dispatched_qty: string; processed_qty: string; good_qty: string; scrap_qty: string;
  quality_required_qty: string; quality_inspected_qty: string; quality_released_qty: string; quality_hold_qty: string; available_for_next_qty: string; final_output_available_qty: string;
  status: string; version: number;
};

export default function OperationsPage() {
  const [session, setSession] = useState<Session | null>(null), [rows, setRows] = useState<Run[]>([]), [error, setError] = useState("");
  async function load() { const current = await api<Session>("/api/session"); setSession(current); if (current.authenticated) setRows((await api<{ rows: Run[] }>("/api/production/operation-execution/runs")).rows); }
  useEffect(() => { const timer = setTimeout(() => void load().catch((cause) => setError(cause instanceof ErpApiError ? cause.message : "读取失败")), 0); return () => clearTimeout(timer); }, []);
  async function post(run: Run, action: string, body: Record<string, unknown>) { if (!session?.csrf_token) return; setError(""); try { await api(`/api/production/operation-runs/${run.id}/${action}`, { method: "POST", body: JSON.stringify({ expected_version: run.version, ...body }), protectedWrite: { csrfToken: session.csrf_token, idempotencyKey: crypto.randomUUID() } }); await load(); } catch (cause) { setError(cause instanceof ErpApiError ? `${cause.message} (${cause.code})` : "操作失败"); } }
  async function report(event: FormEvent<HTMLFormElement>, run: Run) { event.preventDefault(); const form = new FormData(event.currentTarget); await post(run, "reports", { processed_qty: String(form.get("processed_qty")), good_qty: String(form.get("good_qty")), scrap_qty: String(form.get("scrap_qty")), remark: String(form.get("remark") || "") }); }
  const mayReverse = session?.user?.permissions?.some((permission) => permission === "*" || permission === "production.operation.reverse");
  return <main className="sourcing-shell">
    <header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>工序执行事件与质量状态</h1><p>工序报工只形成不可变 Run Report；配置 IPQC 时同步形成 Quality Hold，不自动创建检验。</p><nav><Link href="/production/dispatch">分批派工</Link> · <Link href="/production/wip">WIP 看板</Link> · <Link href="/quality/production">IPQC</Link></nav></div></header>
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
    <section className="sourcing-panel">{rows.map((run) => <article className="sourcing-card" key={run.id}>
      <b>{run.run_kind} · {run.run_code} · {run.work_order_code} · {run.sequence_no} {run.operation_code} {run.operation_name}</b>
      <small>Snapshot Operation #{run.snapshot_operation_id} · Work Center {run.work_center_code} · 门禁 {run.quality_gate_mode} · {run.assigned_operator_name} · {run.status}</small>
      <p>派工/处理/good/scrap {run.dispatched_qty}/{run.processed_qty}/{run.good_qty}/{run.scrap_qty}</p>
      {run.run_kind==="REWORK"?<p>NCR #{run.nonconformance_id} · Rework Request #{run.rework_request_id} · 原 Inspection #{run.source_inspection_id} / Run Report #{run.source_operation_run_report_id}；此处理量是重复加工次数，不增加工单净产量。</p>:null}
      <p>待检/已检/released/Hold {run.quality_required_qty}/{run.quality_inspected_qty}/{run.quality_released_qty}/{run.quality_hold_qty} · 下工序可用 {run.available_for_next_qty} · 最终报工可用 {run.final_output_available_qty}</p>
      {run.status === "READY" ? <div><button onClick={() => void post(run, "start", {})}>开工</button> <button onClick={() => void post(run, "cancel", { reason: "取消未开工派工" })}>取消派工</button></div> : null}
      {run.status === "IN_PROGRESS" ? <form onSubmit={(event) => void report(event, run)}><label>处理 <input name="processed_qty" type="number" min="0.000001" step="0.000001" required /></label><label>良品 <input name="good_qty" type="number" min="0" step="0.000001" required /></label><label>损耗 <input name="scrap_qty" type="number" min="0" step="0.000001" required /></label><input name="remark" placeholder="备注" /><button type="submit">工序报工</button></form> : null}
      {mayReverse && ["IN_PROGRESS", "COMPLETED"].includes(run.status) && Number(run.processed_qty) > 0 ? <button onClick={() => void post(run, "reverse", { reason: "工序报工全额冲销" })}>全额冲销</button> : null}
    </article>)}</section>
  </main>;
}
