"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { statusLabel } from "../../../public/erp/status-localization.js";
import "../../procurement/sourcing/sourcing.css";

type Session = { authenticated: boolean; csrf_token?: string; user: { permissions: string[] } | null };
type Route = { routing_id: number; routing_code: string; product_code: string; product_name: string; routing_version_id: number; version_code: string; status: string; version: number; operation_count: number; canonical_digest?: string };
type Operation = { sequence_no: number; operation_code: string; operation_name: string; work_center_id: number; work_center_code: string; work_center_name: string; setup_minutes: string; run_minutes_per_unit: string; description: string; quality_gate_mode: "NONE" | "IPQC" };
type Detail = { header: Route & { id: number; version: number; status: string }; operations: Operation[] };
const can = (session: Session | null, permission: string) => Boolean(session?.user && (session.user.permissions.includes("*") || session.user.permissions.includes(permission)));

export default function RoutingsPage() {
  const [session, setSession] = useState<Session | null>(null), [rows, setRows] = useState<Route[]>([]), [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState("");
  async function load() { const current = await api<Session>("/api/session"); setSession(current); if (current.authenticated) setRows((await api<{ rows: Route[] }>("/api/production/routings")).rows); }
  useEffect(() => { void Promise.resolve().then(load).catch((cause) => setError(cause instanceof ErpApiError ? cause.message : "读取失败")); }, []);
  async function inspect(versionId: number) { try { setDetail((await api<{ data: Detail }>(`/api/production/routing-versions/${versionId}`)).data); } catch (cause) { setError(cause instanceof ErpApiError ? cause.message : "读取路线失败"); } }
  async function write(path: string, body: Record<string, unknown>, method = "POST") { if (!session?.csrf_token) return; setError(""); try { await api(path, { method, body: JSON.stringify(body), protectedWrite: { csrfToken: session.csrf_token, idempotencyKey: crypto.randomUUID() } }); setDetail(null); await load(); } catch (cause) { setError(cause instanceof ErpApiError ? `${cause.message} (${cause.code})` : "操作失败"); } }
  async function saveGates() { if (!detail) return; await write(`/api/production/routing-versions/${detail.header.id}/operations`, { expected_version: detail.header.version, operations: detail.operations }, "PATCH"); }
  return <main className="sourcing-shell">
    <header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>产品工艺路线与质量门禁</h1><p>工程部门仅在草稿状态配置直通或 IPQC；门禁进入规范摘要，发布版本与工单快照不可修改。</p><nav><Link href="/operations/work-centers">工作中心</Link> · <Link href="/production/dispatch">生产派工</Link></nav></div></header>
    <section className="sourcing-panel"><h2>路线版本</h2>{rows.map((row) => <article className="sourcing-card" key={row.routing_version_id}><b>{row.routing_code} · {row.product_code} {row.product_name} · {row.version_code}</b><small>{statusLabel(row.status)} · {row.operation_count} 工序 · v{row.version}</small>{row.canonical_digest ? <code>{row.canonical_digest}</code> : null}<div><button onClick={() => void inspect(row.routing_version_id)}>查看工序与门禁</button> {row.status === "DRAFT" && can(session, "production.routing.manage") ? <button onClick={() => void write(`/api/production/routing-versions/${row.routing_version_id}/submit`, { expected_version: row.version })}>提交审核</button> : null}{row.status === "SUBMITTED" && can(session, "production.routing.review") ? <><button onClick={() => void write(`/api/production/routing-versions/${row.routing_version_id}/release`, { expected_version: row.version })}>异人发布</button><button onClick={() => void write(`/api/production/routing-versions/${row.routing_version_id}/return`, { expected_version: row.version, reason: "工艺资料需修订" })}>退回</button></> : null}</div></article>)}</section>
    {detail ? <section className="sourcing-panel"><h2>路线版本 #{detail.header.id} · {statusLabel(detail.header.status)}</h2>{detail.operations.map((operation, index) => <article className="sourcing-card" key={`${operation.sequence_no}-${operation.operation_code}`}><b>{operation.sequence_no} · {operation.operation_code} {operation.operation_name}</b><small>工作中心 {operation.work_center_code} {operation.work_center_name}</small><label>质量门禁 <select value={operation.quality_gate_mode} disabled={detail.header.status !== "DRAFT" || !can(session, "production.routing.manage")} onChange={(event) => setDetail({ ...detail, operations: detail.operations.map((item, position) => position === index ? { ...item, quality_gate_mode: event.target.value as "NONE" | "IPQC" } : item) })}><option value="NONE">直通</option><option value="IPQC">IPQC（受控放行）</option></select></label></article>)}{detail.header.status === "DRAFT" && can(session, "production.routing.manage") ? <button onClick={() => void saveGates()}>保存草稿工序门禁</button> : <p>当前版本只读；发布门禁已固化。</p>}</section> : null}
    {error ? <div className="sourcing-state sourcing-error">{error}</div> : null}
  </main>;
}
