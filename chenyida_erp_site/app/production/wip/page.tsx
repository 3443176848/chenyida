"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type Wip = {
  snapshot_operation_id: number; work_order_code: string; sequence_no: number; operation_code: string; operation_name: string; work_center_code: string;
  quality_gate_mode: "NONE" | "IPQC"; status: string; source_input_qty: string; waiting_input_qty: string; dispatched_qty: string; in_progress_qty: string;
  completed_good_qty: string; scrap_qty: string; quality_required_qty: string; quality_inspected_qty: string; quality_released_qty: string; quality_hold_qty: string;
  transferred_to_next_qty: string; available_for_next_qty: string; final_output_available_qty: string; wip_version: number;
};
type Rework={id:number;request_code:string;ncr_code:string;work_order_code:string;target_operation_code:string;original_failed_qty:string;accepted_rework_qty:string;rework_waiting_dispatch_qty:string;rework_dispatched_qty:string;rework_in_progress_qty:string;rework_reported_good_qty:string;rework_reported_scrap_qty:string;rework_pending_reinspection_qty:string;rework_released_qty:string;rework_completed_qty:string;unresolved_rework_qty:string;status:string};

export default function WipPage() {
  const [rows, setRows] = useState<Wip[]>([]),[rework,setRework]=useState<Rework[]>([]), [error, setError] = useState("");
  useEffect(() => { void Promise.all([api<{ rows: Wip[] }>("/api/production/operation-execution/wip"),api<{rows:Rework[]}>("/api/production/rework-executions")]).then(([normal,executions])=>{setRows(normal.rows);setRework(executions.rows);}).catch((cause) => setError(cause instanceof ErpApiError ? cause.message : "读取失败")); }, []);
  return <main className="sourcing-shell">
    <header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>线性工序与 Batch WIP</h1><p>Work Order 汇总和 Manufacturing Batch 投影来自稳定事实；返工加工次数不增加净数量。WIP 不是 MAIN 库存 Ledger。生产批次谱系已建立，但仓库批次库存尚未启用。</p><nav><Link href="/production/batches">Batch genealogy</Link> · <Link href="/production/dispatch">分批派工</Link> · <Link href="/production/operations">工序执行</Link> · <Link href="/production/reporting">末工序正式报工</Link></nav></div></header>
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
    <section className="sourcing-panel"><h2>净生产 WIP（NORMAL）</h2>{rows.map((row) => <article className="sourcing-card" key={row.snapshot_operation_id}>
      <b>{row.work_order_code} · {row.sequence_no} {row.operation_code} {row.operation_name} · {row.status}</b>
      <small>Snapshot Operation #{row.snapshot_operation_id} · Work Center {row.work_center_code} · 门禁 {row.quality_gate_mode} · 投影 v{row.wip_version}</small>
      <p>来源 {row.source_input_qty} · 待派 {row.waiting_input_qty} · 已派 {row.dispatched_qty} · 在制 {row.in_progress_qty}</p>
      <p>good {row.completed_good_qty} · 待检 {row.quality_required_qty} · 已检 {row.quality_inspected_qty} · released {row.quality_released_qty} · Quality Hold {row.quality_hold_qty}</p>
      <p>损耗 {row.scrap_qty} · 已转下工序 {row.transferred_to_next_qty} · available_for_next {row.available_for_next_qty} · 末工序待最终报工 {row.final_output_available_qty}</p>
    </article>)}</section><section className="sourcing-panel"><h2>返工执行数量边界</h2>{rework.map(row=><article className="sourcing-card" key={row.id}><b>{row.request_code} · {row.ncr_code} · {row.target_operation_code} · {row.status}</b><small>{row.work_order_code} · 原 failed {row.original_failed_qty}</small><p>accepted = 待派 {row.rework_waiting_dispatch_qty} + READY {row.rework_dispatched_qty} + 在制 {row.rework_in_progress_qty} + good 待复检 {row.rework_pending_reinspection_qty} + released {row.rework_released_qty} + scrap {row.rework_reported_scrap_qty}</p><p>reported good {row.rework_reported_good_qty} · completed {row.rework_completed_qty} · unresolved {row.unresolved_rework_qty}；不得与原 failed 重复计算。</p></article>)}</section>
  </main>;
}
