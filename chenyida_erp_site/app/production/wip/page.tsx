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

export default function WipPage() {
  const [rows, setRows] = useState<Wip[]>([]), [error, setError] = useState("");
  useEffect(() => { void api<{ rows: Wip[] }>("/api/production/operation-execution/wip").then((value) => setRows(value.rows)).catch((cause) => setError(cause instanceof ErpApiError ? cause.message : "读取失败")); }, []);
  return <main className="sourcing-shell">
    <header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>线性工序 WIP 与质量门禁</h1><p>数量来自不可变执行事实、显式 IPQC 和正式下游分配；WIP 不是 MAIN 库存 Ledger。</p><nav><Link href="/production/dispatch">分批派工</Link> · <Link href="/production/operations">工序执行</Link> · <Link href="/production/reporting">末工序正式报工</Link></nav></div></header>
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
    <section className="sourcing-panel">{rows.map((row) => <article className="sourcing-card" key={row.snapshot_operation_id}>
      <b>{row.work_order_code} · {row.sequence_no} {row.operation_code} {row.operation_name} · {row.status}</b>
      <small>Snapshot Operation #{row.snapshot_operation_id} · Work Center {row.work_center_code} · 门禁 {row.quality_gate_mode} · 投影 v{row.wip_version}</small>
      <p>来源 {row.source_input_qty} · 待派 {row.waiting_input_qty} · 已派 {row.dispatched_qty} · 在制 {row.in_progress_qty}</p>
      <p>good {row.completed_good_qty} · 待检 {row.quality_required_qty} · 已检 {row.quality_inspected_qty} · released {row.quality_released_qty} · Quality Hold {row.quality_hold_qty}</p>
      <p>损耗 {row.scrap_qty} · 已转下工序 {row.transferred_to_next_qty} · available_for_next {row.available_for_next_qty} · 末工序待最终报工 {row.final_output_available_qty}</p>
    </article>)}</section>
  </main>;
}
