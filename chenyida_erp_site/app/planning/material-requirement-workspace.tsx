"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, createSessionWriteRegistry, ErpApiError, sessionPost } from "../../public/erp/api-client.js";
import "./planning.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null; csrf_token?: string };
type PackageRow = { id: number; project_code: string; project_name: string; customer_name: string; package_version_no: number; status: string; target_delivery_date?: string };
type PlanRow = { id: number; plan_version_no: number; required_date: string; status: string; version: number; purchase_request_id?: number | null; request_code?: string };
type PlanLine = { id: number; unit_code: string; material_snapshot: Record<string, unknown>; gross_requirement: string; stock_available: string; eligible_inbound: string; stock_allocated: string; inbound_allocated: string; net_purchase_requirement: string };
type PlanDetail = { header: PlanRow & { project_code: string; package_version_no: number; return_reason?: string }; lines: PlanLine[]; allocations: Array<{ id: number; allocation_type: string; quantity: string; po_code?: string }>; events: Array<{ id: number; event_type: string; actor: string; reason: string; created_at: string }> };
type RequestRow = { id: number; request_code: string; status: string; version: number; project_code: string; project_name: string; plan_version_no: number; required_date: string; line_count: number; requested_quantity: string; return_reason?: string };
type TraceEvent = { id: number; action: string; actor: string; occurred_at: string; request_id: string; result: "SUCCESS"; evidence_source: string };
type PackageTraceItem = { id: number; line_no: number; product_code: string; product_name: string; product_version_code: string; bom_code: string; bom_version_code: string; unit_resolution_version_no: number | null; unit_code: string };
type CurrentSupply = {
  inventory_location_scope: "MAIN"; inventory_position_count: number; inventory_lot_position_count: number;
  on_hand_qty: string; reserved_qty: string; frozen_qty: string; other_unavailable_supported: false; other_unavailable_qty: null;
  inventory_available_qty: string; stock_allocated_to_active_plans_qty: string; unallocated_inventory_available_qty: string;
  effective_inbound_qty: string; inbound_allocated_to_active_plans_qty: string; unallocated_inbound_available_qty: string;
  inbound_cutoff_date: string; posted_receipts_excluded: true; unposted_arrival_quantity_supported: false; unposted_arrival_qty: null;
  snapshot_unallocated_inventory_available_qty: string; snapshot_unallocated_inbound_available_qty: string;
  unallocated_inventory_delta_qty: string; unallocated_inbound_delta_qty: string; changed: boolean;
};
type RequestLine = { id: number; line_no: number; material_id: number; unit_code: string; material_snapshot: Record<string, unknown>; gross_requirement: string; stock_available: string; stock_allocated: string; eligible_inbound: string; inbound_allocated: string; net_purchase_requirement: string; requested_quantity: string; current_supply: CurrentSupply | null };
type RequestDetail = {
  header: RequestRow & { plan_id: number; planning_package_id: number; submitted_by: string; submitted_at: string };
  package: { id: number; version_no: number; status: string; digest: string; project_code: string; accept_event: TraceEvent | null; items: PackageTraceItem[] };
  plan: { id: number; version_no: number; status: string; source_package_id: number; source_package_version_no: number; prepared_by: string; calculated_at: string; snapshot_cutoff_at: string; submission_revalidated_at: string; generated_event: TraceEvent | null; note: null; note_captured: false };
  purchase_request: { id: number; request_code: string; status: string; source_plan_id: number; source_plan_version_no: number; project_code: string; required_date: string; submitted_by: string; submitted_at: string; submit_event: TraceEvent | null; line_count: number; total_requested_quantity: string; independently_versioned: false; supplier_selection: null; price: null; assignee: null; handling_deadline: null; handoff_note: null; handoff_note_captured: false };
  lines: RequestLine[];
  quantity_formula: string;
  current_supply_formula: { inventory_available: string; unallocated_inventory_available: string; effective_inbound: string; unallocated_inbound_available: string };
  current_supply_model: { inventory_location_scope: "MAIN"; active_plan_statuses: string[]; active_purchase_order_statuses: string[]; active_purchase_order_line_statuses: string[]; active_delivery_plan_statuses: string[]; posted_receipts_excluded: true; other_unavailable_supported: false; unposted_arrival_quantity_supported: false };
  current_supply_checked_at: string;
};
type DecisionPrompt = { kind: "accept" | "return"; reason: string; detail: RequestDetail };
type DecisionResult = { request_id: string; data: RequestRow & { accepted_by?: string; accepted_at?: string; returned_by?: string; returned_at?: string; return_reason?: string } };
type DecisionReceipt = { kind: "accept" | "return"; requestId: string; requestCode: string; requestRecordId: number; projectCode: string; status: string; actor: string; occurredAt: string; reason: string };

const labels: Record<string, string> = { DRAFT: "预览", STALE: "已失效", SUBMITTED: "待采购接收", ACCEPTED: "采购已接收", RETURNED: "采购已退回", STOCK: "库存", INBOUND: "在途", GENERATED: "已生成", REGENERATED: "已重新生成", PURCHASE_ACCEPTED: "采购接收", PURCHASE_RETURNED: "采购退回" };
const shanghaiTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const dateOnly = (value: string | undefined) => value ? value.slice(0, 10) : "";
const errorMessage = (reason: unknown) => reason instanceof ErpApiError ? `【${reason.code}】${reason.message}${reason.requestId ? `（请求 ${reason.requestId}）` : ""}` : "系统暂时无法完成请求";
const isZero = (value: string) => /^0(?:\.0+)?$/.test(value);
const compactQuantity = (value: string) => {
  const matched = String(value).match(/^(-?\d+)(?:\.(\d+))?$/);
  if (!matched) return String(value);
  const decimal = (matched[2] || "").replace(/0+$/, "");
  return decimal ? `${matched[1]}.${decimal}` : matched[1];
};
const materialCode = (line: Pick<RequestLine, "material_snapshot"> | Pick<PlanLine, "material_snapshot">) => String(line.material_snapshot?.internal_material_code || "未记录编码");
const materialName = (line: Pick<RequestLine, "material_snapshot"> | Pick<PlanLine, "material_snapshot">) => String(line.material_snapshot?.standard_name || "未记录名称");

function formatShanghaiTime(value: string) { return `${shanghaiTime.format(new Date(value))} Asia/Shanghai`; }
function Status({ value }: { value: string }) { return <span className={`planning-status status-${value.toLowerCase()}`}>{labels[value] || value}</span>; }
function State({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={error ? "planning-state planning-error" : "planning-state"} role={error ? "alert" : undefined}>{children}</div>; }
function Quantity({ value, unit = "PCS" }: { value: string; unit?: string }) { return <span className="planning-quantity">{compactQuantity(value)} <span>{unit}</span></span>; }
function DeltaQuantity({ value, unit }: { value: string; unit: string }) { const compact = compactQuantity(value); return <span className={`planning-quantity purchase-delta ${isZero(value) ? "same" : "changed"}`}>{!isZero(value) && !compact.startsWith("-") ? "+" : ""}{compact} <span>{unit}</span></span>; }
function Shell({ title, subtitle, user, children }: { title: string; subtitle: string; user: User; children: ReactNode }) {
  return <main className="planning-shell"><div className="planning-banner">并行验收环境 · 物料需求与采购申请交接；不询价、不选供应商、不创建采购订单或收货单</div><header className="planning-header"><div><Link href="/" className="planning-back">← 经营工作台</Link><p className="planning-kicker">PLANNING TO PURCHASE</p><h1>{title}</h1><p>{subtitle}</p></div><div className="planning-user"><b>{user.display_name || user.username}</b><span>{user.role}</span></div></header>{children}</main>;
}
function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1200); } catch { setCopied(false); } }
  return <div className="planning-copy-row"><span>{label}</span><code className="planning-trace-value">{value}</code><button type="button" className="planning-copy" onClick={() => void copy()}>{copied ? "已复制" : "复制"}</button></div>;
}
function useSessionMutation(session: Session | null) {
  const operations = useRef(createSessionWriteRegistry());
  useEffect(() => { operations.current.clear(); }, [session?.csrf_token, session?.user?.username]);
  useEffect(() => { const clear = () => operations.current.clear(); window.addEventListener("pagehide", clear); window.addEventListener("cyd-erp-auth-required", clear); return () => { clear(); window.removeEventListener("pagehide", clear); window.removeEventListener("cyd-erp-auth-required", clear); }; }, []);
  return useCallback((path: string, body: Record<string, unknown>) => { if (!session?.authenticated) throw new ErpApiError("当前会话已失效，请重新登录", { code: "SESSION_REQUIRED" }); return sessionPost(operations.current, path, body, session.csrf_token || ""); }, [session?.authenticated, session?.csrf_token, session?.user?.username]);
}

function ConfirmationDialog({ dialogId, title, kicker, className = "", busy, confirmLabel, busyLabel = "正在提交…", confirmClassName = "", onCancel, onConfirm, children }: { dialogId: string; title: string; kicker: string; className?: string; busy: boolean; confirmLabel: string; busyLabel?: string; confirmClassName?: string; onCancel: () => void; onConfirm: () => void; children: ReactNode }) {
  const cancelRef = useRef<HTMLButtonElement>(null); const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") || []);
      if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [busy, onCancel]);
  return <div className="planning-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><div ref={dialogRef} className={`planning-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={dialogId}><div className="planning-dialog-body"><div className="planning-dialog-heading"><div><p className="planning-kicker">{kicker}</p><h2 id={dialogId}>{title}</h2></div><button type="button" className="planning-dialog-close" disabled={busy} aria-label="关闭确认窗口" onClick={onCancel}>关闭</button></div>{children}</div><div className="planning-dialog-actions"><button ref={cancelRef} type="button" className="planning-secondary" disabled={busy} onClick={onCancel}>取消</button><button type="button" className={confirmClassName} disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button></div></div></div>;
}

export function MaterialRequirementWorkspace() {
  const [session, setSession] = useState<Session | null>(null), [packages, setPackages] = useState<PackageRow[]>([]), [selected, setSelected] = useState<PackageRow | null>(null), [plans, setPlans] = useState<PlanRow[]>([]), [detail, setDetail] = useState<PlanDetail | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState(""); const mutate = useSessionMutation(session);
  const load = useCallback(async () => { try { const current = await api<Session>("/api/session"); setSession(current); if (!current.authenticated || !can(current.user, "planning.requirement.read")) return; setPackages((await api<{ data: PackageRow[] }>("/api/planning-handoffs?status=ACCEPTED&page_size=100")).data); if (selected) setPlans((await api<{ data: PlanRow[] }>(`/api/planning-packages/${selected.id}/material-requirement-plans`)).data); } catch (reason) { setError(errorMessage(reason)); } }, [selected]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function choosePackage(row: PackageRow) { setSelected(row); setDetail(null); try { setPlans((await api<{ data: PlanRow[] }>(`/api/planning-packages/${row.id}/material-requirement-plans`)).data); } catch (reason) { setError(errorMessage(reason)); } }
  async function choosePlan(id: number) { try { setDetail((await api<{ data: PlanDetail }>(`/api/material-requirement-plans/${id}`)).data); } catch (reason) { setError(errorMessage(reason)); } }
  async function write(path: string, body: Record<string, unknown>, message: string) { if (!session) return; setBusy(true); setError(""); try { const result = await mutate(path, body) as { plan_id?: number }; setNotice(message); await load(); if (result.plan_id) await choosePlan(result.plan_id); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  function generate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (selected) void write(`/api/planning-packages/${selected.id}/material-requirement-plans`, { required_date: String(new FormData(event.currentTarget).get("required_date") || "") }, "已重新核算并保存 DRAFT 预览"); }
  if (!session) return <State>{error || "正在读取会话…"}</State>; if (!session.authenticated) return <State>请先登录。</State>; if (!can(session.user, "planning.requirement.read")) return <State error>没有权限读取物料需求计划。</State>;
  return <Shell title="物料需求计划工作台" subtitle="从最新已接收交接包汇总固化物料；提交时服务端加锁重算。" user={session.user!}><div className="planning-grid"><aside className="planning-panel"><div className="planning-title"><h2>已接收交接包</h2><span className="planning-count">{packages.length}</span></div><div className="planning-list">{packages.map((row) => <button className={`planning-row ${selected?.id === row.id ? "active" : ""}`} key={row.id} onClick={() => void choosePackage(row)}><b>{row.project_code} · 包 v{row.package_version_no}</b><Status value={row.status} /><strong>{row.project_name}</strong></button>)}</div>{selected ? <><h2 className="planning-section-title">计划版本</h2><div className="planning-list">{plans.map((row) => <button className="planning-row" key={row.id} onClick={() => void choosePlan(row.id)}><b>需求计划 v{row.plan_version_no}</b><Status value={row.status} /><strong>{dateOnly(row.required_date)} · {row.request_code || "无采购申请"}</strong></button>)}</div></> : null}</aside><section className="planning-panel">{selected && can(session.user, "planning.requirement.prepare") && !plans.some((row) => ["SUBMITTED", "ACCEPTED"].includes(row.status)) ? <form className="planning-card planning-form" onSubmit={generate}><label>需求日期<input type="date" name="required_date" defaultValue={dateOnly(selected.target_delivery_date)} required /></label><button disabled={busy}>{plans[0]?.status === "RETURNED" ? "创建修订版并重新核算" : "生成物料需求预览"}</button><small>DRAFT 不占用库存或在途；再次生成会使旧预览失效。</small></form> : null}{detail ? <PlanView detail={detail} /> : <State>选择交接包后生成预览，或查看历史计划。</State>}{detail?.header.status === "DRAFT" && can(session.user, "planning.requirement.submit") ? <div className="planning-actions"><button disabled={busy} onClick={() => void write(`/api/material-requirement-plans/${detail.header.id}/submit`, { expected_version: detail.header.version }, "提交成功：分配与采购申请已原子固化")}>加锁重算并提交采购部</button></div> : null}{notice ? <State>{notice}</State> : null}{error ? <State error>{error}</State> : null}</section></div></Shell>;
}

function planPurchaseFact(detail: PlanDetail) {
  if (detail.header.purchase_request_id && detail.header.request_code) return detail.header.request_code;
  if (["DRAFT", "STALE"].includes(detail.header.status)) return "尚未提交采购申请";
  if (detail.lines.length > 0 && detail.lines.every((line) => isZero(line.net_purchase_requirement))) return "提交快照净采购为 0；未生成 PRQ";
  return "未找到采购申请；请核验关系化提交事实";
}

function PlanView({ detail }: { detail: PlanDetail }) {
  return <><div className="planning-title"><h2>{detail.header.project_code} · 需求计划 v{detail.header.plan_version_no}</h2><Status value={detail.header.status} /></div>{detail.header.return_reason ? <div className="planning-return"><b>采购退回原因</b><p>{detail.header.return_reason}</p></div> : null}<dl className="planning-facts"><div><dt>需求日期</dt><dd>{dateOnly(detail.header.required_date)}</dd></div><div><dt>来源交接包</dt><dd>v{detail.header.package_version_no}</dd></div><div><dt>采购申请</dt><dd>{planPurchaseFact(detail)}</dd></div></dl><div className="planning-table-scroll" tabIndex={0}><table className="planning-lines"><thead><tr><th>固化物料 / 单位</th><th>毛需求</th><th>库存可用 / 分配</th><th>在途可用 / 分配</th><th>净采购</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td><b>{materialCode(line)} · {materialName(line)}</b><br />{line.unit_code}</td><td>{line.gross_requirement}</td><td>{line.stock_available} / {line.stock_allocated}</td><td>{line.eligible_inbound} / {line.inbound_allocated}</td><td><b>{line.net_purchase_requirement}</b></td></tr>)}</tbody></table></div><div className="planning-card"><h3>Planning Allocation</h3>{detail.allocations.length ? detail.allocations.map((row) => <p key={row.id}><Status value={row.allocation_type} /> {row.quantity}{row.po_code ? ` · ${row.po_code}` : " · MAIN 库存"}</p>) : <p>预览阶段不创建分配；提交后也不会修改正式 reserved_qty。</p>}</div><div className="planning-card"><h3>不可变事件</h3>{detail.events.map((event) => <div key={event.id}><Status value={event.event_type} /> <b>{event.actor}</b> · {formatShanghaiTime(event.created_at)}{event.reason ? <p>{event.reason}</p> : null}</div>)}</div></>;
}

export function PurchaseRequestWorkspace() {
  const [session, setSession] = useState<Session | null>(null), [pending, setPending] = useState<RequestRow[]>([]), [processed, setProcessed] = useState<RequestRow[]>([]), [view, setView] = useState<"PENDING" | "PROCESSED">("PENDING"), [detail, setDetail] = useState<RequestDetail | null>(null);
  const [decisionPrompt, setDecisionPrompt] = useState<DecisionPrompt | null>(null), [receipt, setReceipt] = useState<DecisionReceipt | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const mutate = useSessionMutation(session); const decisionInFlight = useRef(false); const decisionRefreshInFlight = useRef(false);
  const load = useCallback(async () => {
    try {
      const current = await api<Session>("/api/session"); setSession(current);
      if (!current.authenticated || !can(current.user, "planning.purchase_request.read")) return;
      const [pendingResult, processedResult] = await Promise.all([
        api<{ data: RequestRow[] }>("/api/purchase-requests?status=SUBMITTED&page_size=100"),
        api<{ data: RequestRow[] }>("/api/purchase-requests?status=PROCESSED&page_size=100"),
      ]);
      setPending(pendingResult.data); setProcessed(processedResult.data);
    } catch (reason) { setError(errorMessage(reason)); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function choose(id: number) { setError(""); setNotice(""); setReceipt(null); try { setDetail((await api<{ data: RequestDetail }>(`/api/purchase-requests/${id}`)).data); } catch (reason) { setDetail(null); setError(errorMessage(reason)); } }
  async function requestDecision(kind: "accept" | "return", reason = "") {
    if (!detail || detail.header.status !== "SUBMITTED") return;
    setError("");
    if (kind === "return") { setDecisionPrompt({ kind, reason, detail }); return; }
    if (decisionRefreshInFlight.current) return;
    decisionRefreshInFlight.current = true; setBusy(true);
    try {
      const refreshed = (await api<{ data: RequestDetail }>(`/api/purchase-requests/${detail.header.id}`)).data;
      if (refreshed.header.status !== "SUBMITTED") { setDetail(refreshed); setError("采购申请状态已变化，请重新核对后处理。"); return; }
      setDetail(refreshed); setDecisionPrompt({ kind, reason, detail: refreshed });
    } catch (refreshError) { setError(errorMessage(refreshError)); }
    finally { decisionRefreshInFlight.current = false; setBusy(false); }
  }
  function returnRequest(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") || "").trim(); if (reason) void requestDecision("return", reason); }
  const closeDecision = useCallback(() => { if (!decisionInFlight.current) setDecisionPrompt(null); }, []);
  async function confirmDecision() {
    if (!session || !decisionPrompt || decisionInFlight.current) return;
    decisionInFlight.current = true; setBusy(true); setError("");
    const prompt = decisionPrompt;
    try {
      const result = await mutate(`/api/purchase-requests/${prompt.detail.header.id}/${prompt.kind}`, { expected_version: prompt.detail.header.version, ...(prompt.kind === "return" ? { reason: prompt.reason } : {}) }) as DecisionResult;
      const actor = prompt.kind === "accept" ? result.data.accepted_by || session.user?.username || "" : result.data.returned_by || session.user?.username || "";
      const occurredAt = prompt.kind === "accept" ? result.data.accepted_at || "" : result.data.returned_at || "";
      setReceipt({ kind: prompt.kind, requestId: result.request_id, requestCode: prompt.detail.header.request_code, requestRecordId: prompt.detail.header.id, projectCode: prompt.detail.header.project_code, status: result.data.status, actor, occurredAt, reason: result.data.return_reason || prompt.reason });
      setNotice(prompt.kind === "accept" ? "接收完成；未自动创建 RFQ、定标、PO、收货或 AP。" : "退回完成；原需求计划快照保持不变。");
      setDecisionPrompt(null); setDetail(null); setView("PROCESSED"); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { decisionInFlight.current = false; setBusy(false); }
  }
  async function openReceiptDetail() { if (!receipt) return; setView("PROCESSED"); await choose(receipt.requestRecordId); }
  if (!session) return <State>{error || "正在读取会话…"}</State>; if (!session.authenticated) return <State>请先登录。</State>; if (!can(session.user, "planning.purchase_request.read")) return <State error>没有权限读取采购申请。</State>;
  const rows = view === "PENDING" ? pending : processed;
  return <Shell title="采购申请接收工作台" subtitle="核对 Package、需求计划、提交快照与当前供应后，只接收或退回 PRQ。" user={session.user!}><div className="planning-grid"><aside className="planning-panel"><div className="planning-view-tabs" role="tablist"><button type="button" role="tab" aria-selected={view === "PENDING"} className={view === "PENDING" ? "active" : ""} onClick={() => { setView("PENDING"); setDetail(null); setReceipt(null); }}>待接收申请 <span>{pending.length}</span></button><button type="button" role="tab" aria-selected={view === "PROCESSED"} className={view === "PROCESSED" ? "active" : ""} onClick={() => { setView("PROCESSED"); setDetail(null); setReceipt(null); }}>已处理 <span>{processed.length}</span></button></div><div className="planning-list" role="tabpanel">{rows.length ? rows.map((row) => <button type="button" className={`planning-row ${detail?.header.id === row.id ? "active" : ""}`} key={row.id} onClick={() => void choose(row.id)}><b>{row.request_code}</b><Status value={row.status} /><strong>{row.project_code} · {row.line_count} 行 · <Quantity value={row.requested_quantity} /></strong>{row.return_reason ? <small className="planning-row-reason">{row.return_reason}</small> : null}</button>) : <State>{view === "PENDING" ? "当前没有待接收申请。" : "当前没有本人已处理申请。"}</State>}</div></aside><section className="planning-panel">{detail ? <PurchaseRequestView detail={detail} canDecide={can(session.user, "planning.purchase_request.decide")} busy={busy} onAccept={() => void requestDecision("accept")} onReturn={returnRequest} /> : receipt ? <DecisionReceiptView receipt={receipt} onOpen={() => void openReceiptDetail()} /> : <State>选择 PRQ 查看固定来源、提交快照和当前供应状态。</State>}{notice ? <State>{notice}</State> : null}{error ? <State error>{error}</State> : null}</section></div>{decisionPrompt ? <PurchaseDecisionDialog prompt={decisionPrompt} busy={busy} onCancel={closeDecision} onConfirm={() => void confirmDecision()} /> : null}</Shell>;
}

function EventEvidence({ title, event }: { title: string; event: TraceEvent | null }) {
  if (!event) return <State error>{title} 的权威事件未找到；未补写请求号或结果。</State>;
  return <article className="planning-event"><div className="planning-event-heading"><div><code className="planning-event-code">{event.action}</code><b>{title}</b></div><span className="planning-event-result success">{event.result}</span></div><dl><div><dt>操作者</dt><dd>{event.actor}</dd></div><div><dt>时间</dt><dd>{formatShanghaiTime(event.occurred_at)}</dd></div><div><dt>结果</dt><dd>SUCCESS · 不可变事件已提交</dd></div><div><dt>证据来源</dt><dd>{event.evidence_source === "PACKAGE_EVENT" ? "Package Event" : "Material Requirement Event"}</dd></div></dl><CopyValue label="请求号" value={event.request_id} /></article>;
}

function PurchaseRequestView({ detail, canDecide, busy, onAccept, onReturn }: { detail: RequestDetail; canDecide: boolean; busy: boolean; onAccept: () => void; onReturn: (event: FormEvent<HTMLFormElement>) => void }) {
  const request = detail.purchase_request;
  return <><div className="planning-title"><div><p className="planning-kicker">PURCHASE REQUEST TRACEABILITY</p><h2>{request.request_code} · {detail.header.project_name}</h2></div><Status value={request.status} /></div>
    <section className="planning-card purchase-trace-section"><h3>Package 与 ACCEPT 谱系</h3><dl className="planning-facts planning-package-facts"><div><dt>来源 Package</dt><dd>ID {detail.package.id}/v{detail.package.version_no}</dd></div><div><dt>Package 状态</dt><dd>{detail.package.status}</dd></div><div><dt>项目</dt><dd>{detail.package.project_code}</dd></div><div><dt>固定产品行</dt><dd>{detail.package.items.length} 行</dd></div></dl><CopyValue label="完整 Package SHA-256 摘要" value={detail.package.digest} /><div className="purchase-source-items">{detail.package.items.map((item) => <article key={item.id}><b>Product {item.product_version_code}</b><span>{item.product_name} · 内部产品编码 {item.product_code}</span><span>BOM {item.bom_version_code}（{item.bom_code}）</span><span>Unit Resolution {item.unit_resolution_version_no ? `v${item.unit_resolution_version_no}` : "未记录"} · {item.unit_code}</span></article>)}</div><EventEvidence title="Package ACCEPT" event={detail.package.accept_event} /><p className="planning-gate-evidence">该 ACCEPT 仅确认工程 Package 进入计划阶段，不会自动生成采购单据。</p></section>
    <section className="planning-card purchase-trace-section"><h3>Material Requirement Plan 谱系</h3><dl className="planning-facts planning-package-facts"><div><dt>稳定 ID</dt><dd>Material Requirement Plan ID {detail.plan.id}</dd></div><div><dt>计划版本</dt><dd>v{detail.plan.version_no}</dd></div><div><dt>来源 Package</dt><dd>ID {detail.plan.source_package_id}/v{detail.plan.source_package_version_no}</dd></div><div><dt>计划状态</dt><dd>{detail.plan.status}</dd></div><div><dt>创建 / 计算人</dt><dd>{detail.plan.prepared_by}</dd></div><div><dt>计算时间</dt><dd>{formatShanghaiTime(detail.plan.calculated_at)}</dd></div><div><dt>数据快照截止时间</dt><dd>{formatShanghaiTime(detail.plan.snapshot_cutoff_at)}</dd></div><div><dt>提交锁定复核时间</dt><dd>{formatShanghaiTime(detail.plan.submission_revalidated_at)}</dd></div></dl><EventEvidence title="计划生成事件" event={detail.plan.generated_event} /><p className="planning-empty-fact">该版本未采集计划说明</p></section>
    <section className="planning-card purchase-trace-section purchase-supply-section" data-supply-section="snapshot"><h3>1. 提交时快照</h3><p className="planning-evidence-note">以下数量在计划提交时固化，只用于追溯；当前供应变化不会替换快照或自动改变 PRQ 申请量。</p><dl className="planning-facts"><div><dt>快照截止时间</dt><dd>{formatShanghaiTime(detail.plan.snapshot_cutoff_at)}</dd></div><div><dt>来源计划</dt><dd>ID {detail.plan.id}/v{detail.plan.version_no}</dd></div><div><dt>固定 PRQ 行数</dt><dd>{detail.lines.length} 条</dd></div></dl><p className="purchase-formula">净采购 = max(毛需求 - 快照库存分配 - 快照在途分配, 0)</p><div className="purchase-line-cards">{detail.lines.map((line) => <SnapshotSupplyCard key={line.id} line={line} />)}</div></section>
    <section className="planning-card purchase-trace-section purchase-supply-section" data-supply-section="current"><h3>2. 当前供应状态</h3><p className="purchase-query-time"><b>查询时间：</b>{formatShanghaiTime(detail.current_supply_checked_at)}</p><p className="planning-evidence-note">只汇总本 PRQ 已授权行对应 Material + Unit。库存位置域为 MAIN，并汇总该域的全部无批次与批次位置；计划分配不计入 Inventory 正式预留。</p><div className="purchase-line-cards">{detail.lines.map((line) => <CurrentSupplyCard key={line.id} line={line} />)}</div><details className="purchase-supply-formulas"><summary>查看权威供应公式与在途边界</summary><div><p><code>库存可用 = Σ在手 - Σ正式预留 - Σ冻结/Hold</code>（每个库存位置由数据库约束保证结果非负）</p><p><code>未分配库存可用 = max(库存可用 - 有效计划库存分配, 0)</code></p><p><code>未分配在途可用 = max(有效在途 - 有效计划在途分配, 0)</code></p><p>有效计划仅指 SUBMITTED / ACCEPTED。有效在途仅含截至 PRQ 需求日的 OPEN / PARTIALLY_RECEIVED PO 剩余量；存在 Delivery Plan 时，仅 PENDING / PARTIAL 的计划剩余量有效，COMPLETED / CANCELLED / CLOSED 排除。</p><p>已过账收货已通过 received quantity 从在途扣除并进入库存。当前模型没有“已到货但未完成入库”的独立数量字段，也没有“其他不可用”独立字段，因此均不伪造数量。</p></div></details></section>
    <section className="planning-card purchase-trace-section purchase-supply-section" data-supply-section="difference"><h3>3. 差异提示</h3><p className="planning-evidence-note">差额比较“提交时未分配可用量”与“当前未分配可用量”。无论是否变化，系统都不会自动重算或改写 PRQ；采购人员应通过正式退回或后续受控调整流程处理变化。</p><div className="purchase-difference-cards">{detail.lines.map((line) => <SupplyDifferenceCard key={line.id} line={line} />)}</div></section>
    <section className="planning-card purchase-trace-section"><h3>PRQ 提交凭证</h3><dl className="planning-facts planning-package-facts"><div><dt>稳定 ID</dt><dd>Purchase Request ID {request.id}</dd></div><div><dt>编号</dt><dd>{request.request_code}</dd></div><div><dt>状态</dt><dd>{labels[request.status] || request.status}</dd></div><div><dt>来源计划</dt><dd>ID {request.source_plan_id}/v{request.source_plan_version_no}</dd></div><div><dt>项目</dt><dd>{request.project_code}</dd></div><div><dt>需求日期</dt><dd>{dateOnly(request.required_date)}</dd></div><div><dt>提交人</dt><dd>{request.submitted_by}</dd></div><div><dt>提交时间</dt><dd>{formatShanghaiTime(request.submitted_at)}</dd></div><div><dt>行数 / 合计</dt><dd>{request.line_count} 行 · <Quantity value={request.total_requested_quantity} /></dd></div></dl><EventEvidence title="PRQ SUBMIT" event={request.submit_event} /><p className="planning-gate-evidence">PRQ未单独版本化；固定引用需求计划v{request.source_plan_version_no}</p><dl className="planning-facts planning-package-facts purchase-empty-facts"><div><dt>供应商</dt><dd>未选择供应商</dd></div><div><dt>价格</dt><dd>未填写价格</dd></div><div><dt>接收人</dt><dd>未指定接收人</dd></div><div><dt>处理时限</dt><dd>未配置处理时限</dd></div></dl><p className="planning-empty-fact">该版本未采集采购交接说明</p></section>
    {request.status === "SUBMITTED" && canDecide ? <div className="planning-actions planning-decision-actions"><button type="button" disabled={busy} onClick={onAccept}>接收采购申请</button><form className="planning-form" onSubmit={onReturn}><label>退回原因（必填）<textarea name="reason" required maxLength={1000} placeholder="说明需计划部门修订的需求或数量问题" /></label><button className="planning-danger" disabled={busy}>退回计划部</button></form></div> : request.status === "SUBMITTED" ? <State>当前账号仅可查看，没有接收或退回权限。</State> : <p className="planning-terminal">该 PRQ 已处理；关系化快照保持只读。</p>}
  </>;
}

function MaterialHeading({ line }: { line: RequestLine }) {
  return <div className="purchase-material-heading"><span>Material ID {line.material_id}</span><code>{materialCode(line)}</code><b>{materialName(line)}</b><small>单位 {line.unit_code}</small></div>;
}

function SnapshotSupplyCard({ line }: { line: RequestLine }) {
  return <article className="purchase-line-card purchase-snapshot-card"><MaterialHeading line={line} /><dl className="purchase-supply-grid"><div><dt>毛需求</dt><dd><Quantity value={line.gross_requirement} unit={line.unit_code} /></dd></div><div><dt>快照库存可用</dt><dd><Quantity value={line.stock_available} unit={line.unit_code} /></dd></div><div><dt>快照库存分配</dt><dd><Quantity value={line.stock_allocated} unit={line.unit_code} /></dd></div><div><dt>快照在途可用</dt><dd><Quantity value={line.eligible_inbound} unit={line.unit_code} /></dd></div><div><dt>快照在途分配</dt><dd><Quantity value={line.inbound_allocated} unit={line.unit_code} /></dd></div><div><dt>净采购</dt><dd><Quantity value={line.net_purchase_requirement} unit={line.unit_code} /></dd></div><div className="purchase-prq-quantity"><dt>PRQ 申请量</dt><dd><Quantity value={line.requested_quantity} unit={line.unit_code} /></dd></div></dl></article>;
}

function CurrentSupplyCard({ line }: { line: RequestLine }) {
  const supply = line.current_supply;
  return <article className="purchase-line-card purchase-current-card"><MaterialHeading line={line} />{supply ? <><dl className="purchase-supply-grid"><div><dt>当前在手总量</dt><dd><Quantity value={supply.on_hand_qty} unit={line.unit_code} /></dd></div><div><dt>当前正式预留</dt><dd><Quantity value={supply.reserved_qty} unit={line.unit_code} /></dd></div><div><dt>品质冻结/Hold</dt><dd><Quantity value={supply.frozen_qty} unit={line.unit_code} /></dd></div><div><dt>其他不可用</dt><dd>{supply.other_unavailable_supported ? <Quantity value={supply.other_unavailable_qty || "0"} unit={line.unit_code} /> : "模型未单独记录"}</dd></div><div><dt>当前库存可用</dt><dd><Quantity value={supply.inventory_available_qty} unit={line.unit_code} /></dd></div><div><dt>有效计划库存分配</dt><dd><Quantity value={supply.stock_allocated_to_active_plans_qty} unit={line.unit_code} /></dd></div><div className="purchase-key-current"><dt>当前未分配库存可用</dt><dd><Quantity value={supply.unallocated_inventory_available_qty} unit={line.unit_code} /></dd></div><div><dt>当前有效在途总量</dt><dd><Quantity value={supply.effective_inbound_qty} unit={line.unit_code} /></dd></div><div><dt>有效计划在途分配</dt><dd><Quantity value={supply.inbound_allocated_to_active_plans_qty} unit={line.unit_code} /></dd></div><div className="purchase-key-current"><dt>当前未分配在途可用</dt><dd><Quantity value={supply.unallocated_inbound_available_qty} unit={line.unit_code} /></dd></div><div><dt>已到货未入库</dt><dd>{supply.unposted_arrival_quantity_supported ? <Quantity value={supply.unposted_arrival_qty || "0"} unit={line.unit_code} /> : "模型未单独记录"}</dd></div><div><dt>聚合位置</dt><dd>{supply.inventory_location_scope} · {supply.inventory_position_count} 个位置（{supply.inventory_lot_position_count} 个批次位置）</dd></div></dl><p className="purchase-inbound-note">在途截止 {supply.inbound_cutoff_date}；已过账收货已从有效在途排除。</p></> : <State error>当前供应状态无法计算；提交快照和 PRQ 申请量未被替代。</State>}</article>;
}

function SupplyDifferenceCard({ line }: { line: RequestLine }) {
  const supply = line.current_supply;
  return <article className={`purchase-difference-card ${supply?.changed ? "changed" : "same"}`}><MaterialHeading line={line} />{supply ? <><strong>{supply.changed ? "当前供应与提交快照存在变化" : "当前未分配供应与提交快照一致"}</strong><dl><div><dt>库存未分配差额</dt><dd><DeltaQuantity value={supply.unallocated_inventory_delta_qty} unit={line.unit_code} /></dd></div><div><dt>在途未分配差额</dt><dd><DeltaQuantity value={supply.unallocated_inbound_delta_qty} unit={line.unit_code} /></dd></div><div><dt>PRQ 申请量（不自动改变）</dt><dd><Quantity value={line.requested_quantity} unit={line.unit_code} /></dd></div></dl></> : <p>当前值不可用；PRQ 申请量保持不变。</p>}</article>;
}

function PurchaseDecisionDialog({ prompt, busy, onCancel, onConfirm }: { prompt: DecisionPrompt; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const detail = prompt.detail; const request = detail.purchase_request;
  if (prompt.kind === "return") return <ConfirmationDialog dialogId="purchase-return-title" title="确认退回计划部门修订" kicker="RETURN CONFIRMATION" className="planning-handoff-dialog" busy={busy} confirmLabel="确认退回" confirmClassName="planning-danger" onCancel={onCancel} onConfirm={onConfirm}><section className="planning-confirm-section"><h3>PRQ 与来源</h3><dl className="planning-facts"><div><dt>PRQ</dt><dd>{request.request_code} · ID {request.id}</dd></div><div><dt>项目</dt><dd>{request.project_code}</dd></div><div><dt>来源 Package</dt><dd>ID {detail.package.id}/v{detail.package.version_no}</dd></div><div><dt>来源计划</dt><dd>ID {detail.plan.id}/v{detail.plan.version_no}</dd></div></dl></section><section className="planning-confirm-section"><h3>退回后果</h3><div className="planning-confirm-reason"><b>必填退回原因</b><p>{prompt.reason}</p></div><ul className="planning-consequence-list"><li>PRQ 返回计划部门修订。</li><li>写入一次不可变 PURCHASE_RETURNED 事件。</li><li>不修改原需求计划及提交时分配快照。</li><li>不创建 RFQ、定标、PO、收货、库存流水或 AP。</li></ul></section></ConfirmationDialog>;
  return <ConfirmationDialog dialogId="purchase-accept-title" title={`确认接收 ${request.request_code}`} kicker="PURCHASE ACCEPT CONFIRMATION" className="planning-handoff-dialog purchase-supply-confirm-dialog" busy={busy} confirmLabel="确认接收" onCancel={onCancel} onConfirm={onConfirm}><section className="planning-confirm-section"><h3>当前目标</h3><dl className="planning-facts"><div><dt>PRQ</dt><dd>{request.request_code} · ID {request.id}</dd></div><div><dt>项目</dt><dd>{request.project_code}</dd></div><div><dt>Package</dt><dd>{detail.package.id}/v{detail.package.version_no} · ACCEPT {detail.package.accept_event?.result || "事件缺失"}</dd></div><div><dt>需求计划</dt><dd>ID {detail.plan.id}/v{detail.plan.version_no}</dd></div><div><dt>当前供应查询时间</dt><dd>{formatShanghaiTime(detail.current_supply_checked_at)}</dd></div><div><dt>接收前刷新</dt><dd>已重新读取当前供应</dd></div></dl></section><section className="planning-confirm-section"><h3>提交数量与当前供应（{detail.lines.length} 条）</h3><div className="purchase-confirm-supply-cards">{detail.lines.map((line) => { const supply = line.current_supply; return <article key={line.id}><MaterialHeading line={line} />{supply ? <dl><div><dt>提交时 PRQ 数量</dt><dd><Quantity value={line.requested_quantity} unit={line.unit_code} /></dd></div><div><dt>当前在手 / 正式预留</dt><dd><Quantity value={supply.on_hand_qty} unit={line.unit_code} /> / <Quantity value={supply.reserved_qty} unit={line.unit_code} /></dd></div><div><dt>当前冻结/Hold</dt><dd><Quantity value={supply.frozen_qty} unit={line.unit_code} /></dd></div><div><dt>当前有效在途</dt><dd><Quantity value={supply.effective_inbound_qty} unit={line.unit_code} /></dd></div><div><dt>当前未分配库存 / 在途</dt><dd><Quantity value={supply.unallocated_inventory_available_qty} unit={line.unit_code} /> / <Quantity value={supply.unallocated_inbound_available_qty} unit={line.unit_code} /></dd></div><div><dt>快照→当前差额（库存 / 在途）</dt><dd><DeltaQuantity value={supply.unallocated_inventory_delta_qty} unit={line.unit_code} /> / <DeltaQuantity value={supply.unallocated_inbound_delta_qty} unit={line.unit_code} /></dd></div></dl> : <State error>当前供应不可用；为避免误导，未填充替代数量。</State>}</article>; })}</div><p><b>提交时 PRQ 合计：</b><Quantity value={request.total_requested_quantity} /></p><p className="planning-warning">当前供应及差异只用于接收前复核，不会自动重算或改变以上 PRQ 数量。</p></section><section className="planning-confirm-section"><h3>接收后果</h3><ul className="planning-consequence-list"><li>PRQ 转为采购已接收并写入一次不可变 PURCHASE_ACCEPTED 事件。</li><li>原 Package、需求计划、提交时分配快照和 PRQ 申请量保持不变。</li><li><b>接收不会修改库存、正式预留或 Planning Allocation。</b></li><li><b>接收不会自动创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP 或 Work Order。</b></li><li>当前未指定具体处理人，也未配置处理时限。</li></ul></section><section className="planning-confirm-section planning-next-stage"><h3>下一阶段</h3><p><b>采购部门基于已接收 PRQ 开展正式供应商寻源、询价和报价比较；所有下游动作均需独立受控流程。</b></p></section></ConfirmationDialog>;
}

function DecisionReceiptView({ receipt, onOpen }: { receipt: DecisionReceipt; onOpen: () => void }) {
  const accepted = receipt.kind === "accept";
  return <div className="planning-receipt" role="status"><p className="planning-kicker">PURCHASE DECISION RECEIPT</p><h2>操作完成凭证</h2><dl className="planning-facts"><div><dt>操作</dt><dd><code>{accepted ? "ACCEPT" : "RETURN"}</code></dd></div><div><dt>PRQ</dt><dd>{receipt.requestCode}</dd></div><div><dt>项目</dt><dd>{receipt.projectCode}</dd></div><div><dt>状态</dt><dd>{labels[receipt.status] || receipt.status}</dd></div><div><dt>操作者</dt><dd>{receipt.actor || "服务端未返回操作者"}</dd></div><div><dt>时间</dt><dd>{receipt.occurredAt ? formatShanghaiTime(receipt.occurredAt) : "服务端未返回操作时间"}</dd></div></dl><CopyValue label="请求号" value={receipt.requestId} />{accepted ? <p>下一队列：采购寻源与询价；接收本身未创建 RFQ、定标、PO、收货或 AP。</p> : <><div className="planning-confirm-reason"><b>数据库保存的退回原因</b><p>{receipt.reason}</p></div><p>下一队列：计划部门修订；原计划快照未修改。</p></>}<button type="button" onClick={onOpen}>从已处理记录查看凭证</button></div>;
}
