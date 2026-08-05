"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ErpApiError, logoutSession } from "../../../public/erp/api-client.js";
import "../sourcing/sourcing.css";
import "./supplier-mappings.css";

type User = { username: string; display_name: string; role: string; permissions: string[] };
type Session = { authenticated: boolean; user: User | null; csrf_token?: string };
type Option = { id: number; code: string; name: string; status: string | boolean; base_unit_id?: number; base_unit?: string };
type MappingRow = {
  mapping_version_id: number; mapping_id: string; mapping_version: number; expected_version: number; status: string;
  supplier_id: number; supplier_code: string; supplier_name: string; material_id: number; internal_material_code: string; standard_name: string;
  supplier_part_number: string; supplier_item_name: string; supplier_specification: string; manufacturer: string; mpn: string; revision: string;
  purchase_unit_id: number; supplier_unit: string; internal_unit_id: number; internal_unit: string;
  conversion_numerator: string; conversion_denominator: string; valid_from: string; valid_to: string | null;
  created_by: string; created_at: string; submitted_by: string | null; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null;
  created_request_id: string; submitted_request_id: string | null; reviewed_request_id: string | null;
  review_outcome: string | null; review_reason: string; request_id: string; result: string; event_type: string | null; event_actor: string | null; event_at: string | null; event_request_id: string | null;
  supplier_status: string; material_status: string; active_mapping_count: number; active_conflict_count: number; supplier_part_conflict_count: number;
  approval_comment?: string | null; approval_actor?: string | null; approval_at?: string | null; approval_request_id?: string | null;
};
type ApprovalReceipt = {
  mapping_id: string; mapping_version_id: number; decision: "APPROVE"; actor: string; occurred_at: string; request_id: string; result: string;
  review_comment: string | null; review_comment_display: string; historical_comment_missing: boolean;
  before: { mapping_version: number; cas: number | null }; after: { mapping_version: number; cas: number | null }; final_status: "ACTIVE";
  supplier: { id: number; code: string; name: string }; material: { id: number; code: string; name: string };
  supplier_part_number: string; units: { supplier: string; internal: string | null };
  conversion: { numerator: string; denominator: string }; validity: { valid_from: string; valid_to: string | null };
};
type ReviewPreview = {
  mapping: {
    mapping_version_id: number; mapping_id: string; mapping_version: number; expected_version: number; status: string;
    supplier: { id: number; code: string; name: string; status: string };
    material: { id: number; code: string; name: string; status: string };
    supplier_part_number: string; units: { supplier: string; internal: string | null };
    conversion: { numerator: string; denominator: string }; validity: { valid_from: string; valid_to: string | null };
  };
  lifecycle: {
    created: { actor: string | null; occurred_at: string | null; request_id: string | null; result: string | null };
    submitted: { actor: string | null; occurred_at: string | null; request_id: string | null; result: string | null };
  };
  conflicts: { active_mapping_count: number; active_conflict_count: number; supplier_part_conflict_count: number };
  approval_conditions: { can_approve: boolean; issues: Array<{ code: string; message: string; suggestion: string }> };
  approval_projection: {
    before: { mapping_version: number; cas: number }; after: { mapping_version: number; cas: number }; final_status: "ACTIVE";
    rfq_coverage_eligible_after_approval: boolean; rfq_coverage_note: string;
    creates_downstream: { rfq: false; quote: false; award: false; purchase_order: false };
  };
  approval_receipt: ApprovalReceipt | null;
};

const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const statusLabels: Record<string, string> = { DRAFT: "草稿", PENDING_REVIEW: "待审核", ACTIVE: "已生效", REJECTED: "已退回", INACTIVE: "历史失效" };
const HISTORICAL_APPROVAL_COMMENT_MISSING = "历史批准未采集审核意见";
const errorText = (error: unknown) => error instanceof ErpApiError
  ? `${error.message}${error.requestId ? `（请求 ${error.requestId}）` : ""}`
  : "系统暂时无法完成请求";
const shanghaiTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date(value))
  : "—";
const shanghaiDate = (value: string | null) => {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const todayShanghai = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

function State({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={error ? "sourcing-state sourcing-error" : "sourcing-state"}>{children}</div>;
}

function Status({ value }: { value: string }) {
  return <span className={`sourcing-status status-${value.toLowerCase()}`}>{statusLabels[value] || value}</span>;
}

function mappingBody(form: FormData) {
  return {
    supplier_id: Number(form.get("supplier_id")),
    material_id: Number(form.get("material_id")),
    supplier_item_code: String(form.get("supplier_item_code") || ""),
    supplier_item_name: String(form.get("supplier_item_name") || ""),
    supplier_specification: String(form.get("supplier_specification") || ""),
    manufacturer: String(form.get("manufacturer") || ""),
    mpn: String(form.get("mpn") || ""),
    revision: String(form.get("revision") || ""),
    purchase_unit_id: Number(form.get("purchase_unit_id")),
    conversion_numerator: Number(form.get("conversion_numerator")),
    conversion_denominator: Number(form.get("conversion_denominator")),
    valid_from: String(form.get("valid_from") || ""),
    valid_to: String(form.get("valid_to") || ""),
  };
}

export function SupplierMappingWorkspace({ mode }: { mode: "manage" | "review" }) {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<Option[]>([]);
  const [materialOptions, setMaterialOptions] = useState<Option[]>([]);
  const [unitOptions, setUnitOptions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "approve" | "receipt"; preview: ReviewPreview } | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [dialogError, setDialogError] = useState("");
  const filtersRef = useRef("");
  const approvalBusyRef = useRef(false);

  const readRows = useCallback(async (filters?: string) => {
    if (filters !== undefined) filtersRef.current = filters;
    const suffix = filters ?? filtersRef.current;
    const path = mode === "review"
      ? `/api/supplier-mappings/review-queue?page_size=100${suffix}`
      : `/api/supplier-mappings?page_size=100${suffix}`;
    const result = await api<{ data: MappingRow[] }>(path, { cache: "no-store" });
    setRows(result.data || []);
  }, [mode]);

  const readOptions = useCallback(async (kind: "supplier" | "material" | "unit", query = "") => {
    const result = await api<{ data: Option[] }>(`/api/supplier-mappings/options?type=${kind}&limit=20&q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (kind === "supplier") setSupplierOptions(result.data || []);
    if (kind === "material") setMaterialOptions(result.data || []);
    if (kind === "unit") setUnitOptions(result.data || []);
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const current = await api<Session>("/api/session", { cache: "no-store" });
      setSession(current);
      if (!current.authenticated || !current.user) return;
      const permission = mode === "review" ? "supplier_mapping.review_queue" : "supplier_mapping.read";
      if (!can(current.user, permission)) return;
      await readRows();
      if (mode === "manage" && can(current.user, "supplier_mapping.create")) {
        await readOptions("supplier");
        await readOptions("material");
        await readOptions("unit");
      }
    } catch (reason) { setError(errorText(reason)); }
  }, [mode, readOptions, readRows]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  async function write(path: string, method: "POST" | "PATCH", body: Record<string, unknown>, success: string) {
    if (!session?.csrf_token) { setError("当前会话缺少 CSRF 上下文，请刷新后重试"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(path, { method, body: JSON.stringify(body), protectedWrite: { csrfToken: session.csrf_token, idempotencyKey: crypto.randomUUID() } });
      setNotice(success);
      await readRows();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (!session?.csrf_token) { setError("退出失败：当前会话缺少 CSRF 上下文"); return; }
    setBusy(true); setError("");
    try { await logoutSession(session.csrf_token); window.location.replace("/"); }
    catch (reason) { setError(`退出失败：${errorText(reason)}`); setBusy(false); }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void write("/api/supplier-mappings", "POST", mappingBody(new FormData(event.currentTarget)), "Supplier Mapping 草稿已保存；尚未进入 RFQ 有效范围");
  }

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of ["mapping_id", "supplier", "material", "supplier_part_number", "status"]) {
      const value = String(form.get(key) || "").trim(); if (value) query.set(key, value);
    }
    if (!String(form.get("status") || "") && mode === "review") query.set("status", "");
    void readRows(`&${query}`).catch((reason) => setError(errorText(reason)));
  }

  async function openReview(row: MappingRow, kind: "approve" | "receipt") {
    setBusy(true); setError(""); setDialogError(""); setReviewComment("");
    try {
      const preview = await api<ReviewPreview>(
        `/api/supplier-mappings/${row.mapping_id}/review-preview?expected_version=${row.expected_version}`,
        { cache: "no-store" },
      );
      setDialog({ kind, preview });
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function confirmApproval() {
    if (!dialog || dialog.kind !== "approve" || approvalBusyRef.current) return;
    const comment = reviewComment.trim();
    if (!comment) { setDialogError("审核意见必填，确认前请记录本次核验结论。"); return; }
    if (!session?.csrf_token) { setDialogError("当前会话缺少 CSRF 上下文，请刷新后重试"); return; }
    approvalBusyRef.current = true;
    setApprovalBusy(true); setDialogError(""); setNotice("");
    try {
      const fresh = await api<ReviewPreview>(
        `/api/supplier-mappings/${dialog.preview.mapping.mapping_id}/review-preview?expected_version=${dialog.preview.mapping.expected_version}`,
        { cache: "no-store" },
      );
      setDialog({ kind: "approve", preview: fresh });
      if (!fresh.approval_conditions.can_approve) {
        setDialogError("服务端复核未通过，未发送批准请求。请按阻断项处理后刷新。");
        return;
      }
      const approved = await api<{ approval_receipt: ApprovalReceipt }>(
        `/api/supplier-mappings/${fresh.mapping.mapping_id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ expected_version: fresh.mapping.expected_version, review_comment: comment }),
          protectedWrite: { csrfToken: session.csrf_token, idempotencyKey: crypto.randomUUID() },
        },
      );
      setDialog({ kind: "receipt", preview: { ...fresh, approval_receipt: approved.approval_receipt } });
      setNotice("审核 SUCCESS：Mapping 已生效；未自动创建 RFQ、Quote、Award 或 PO");
      await readRows();
    } catch (reason) { setDialogError(errorText(reason)); }
    finally { approvalBusyRef.current = false; setApprovalBusy(false); }
  }

  if (!session) return <State>{error || "正在读取 Supplier Mapping…"}</State>;
  if (!session.authenticated || !session.user) return <State>请先登录。</State>;
  const requiredPermission = mode === "review" ? "supplier_mapping.review_queue" : "supplier_mapping.read";
  if (!can(session.user, requiredPermission)) return <State error>没有权限读取 Supplier Mapping。</State>;

  const title = mode === "review" ? "供应商映射运营审核" : "供应商物料映射";
  return <main className="sourcing-shell sm-shell">
    <div className="sourcing-banner">并行验收环境 · Mapping 只有异人批准后才进入 RFQ；本页不会自动创建 RFQ、Quote、Award 或 PO</div>
    <header className="sourcing-header">
      <div><Link href="/" className="sourcing-back">← 经营工作台</Link><p className="sourcing-kicker">SUPPLIER MAPPING GOVERNANCE</p><h1>{title}</h1><p>{mode === "review" ? "只读核验已提交正文；批准或退回都形成不可变决策事实。" : "采购保存草稿并提交；ACTIVE 只能由运营异人审核产生。"}</p></div>
      <div className="sm-user"><b>{session.user.display_name || session.user.username}</b><span>{session.user.role}</span><button className="sm-quiet" disabled={busy} onClick={() => void logout()}>安全退出</button></div>
    </header>

    <nav className="sm-links">
      <Link href="/procurement/supplier-mappings">映射维护与历史</Link>
      {can(session.user, "supplier_mapping.review_queue") ? <Link href="/operations/supplier-mappings">运营审核队列</Link> : null}
      <Link href="/procurement/sourcing">RFQ 覆盖率与询价</Link>
    </nav>

    {mode === "review" ? <section className="sourcing-panel"><div className="sourcing-title"><h2>运营审核与历史凭证</h2><strong>{rows.length}</strong></div><p className="sourcing-note">默认显示 PENDING_REVIEW。正文已冻结且没有编辑入口；批准先预览、再确认，创建人不能自审。</p></section> : null}

    <section className="sourcing-panel">
      <h2>搜索和筛选</h2>
      <form className="sm-filter" onSubmit={filter}>
        <label>Mapping ID<input name="mapping_id" maxLength={36}/></label>
        <label>Supplier ID / 编码 / 名称<input name="supplier" maxLength={100}/></label>
        <label>Material ID / 正式编码 / 名称<input name="material" maxLength={100}/></label>
        <label>supplier_part_number / 后缀<input name="supplier_part_number" maxLength={100}/></label>
        <label>状态<select name="status" defaultValue={mode === "review" ? "PENDING_REVIEW" : ""}><option value="">全部</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button disabled={busy}>筛选</button>
      </form>
    </section>

    {mode === "manage" ? <>
      {can(session.user, "supplier_mapping.create") ? <section className="sourcing-panel">
        <div className="sourcing-title"><div><h2>新建映射</h2><p className="sourcing-note">所有选项提交稳定 ID；编码优先的检索最多返回 20 条，不按名称反向解析 ID。</p></div><Status value="DRAFT"/></div>
        <ol className="sm-workflow"><li>新建映射</li><li>保存草稿</li><li>提交审核（保存后启用）</li><li>operations 异人批准或退回</li></ol>
        <div className="sm-option-searches">
          <OptionSearch label="搜索 Supplier" onSearch={(value) => readOptions("supplier", value)}/>
          <OptionSearch label="搜索 Material" onSearch={(value) => readOptions("material", value)}/>
          <OptionSearch label="搜索 Unit" onSearch={(value) => readOptions("unit", value)}/>
        </div>
        <form className="sourcing-form sm-create" onSubmit={create}>
          <StableSelect name="supplier_id" label="Supplier 稳定 ID / 编码" options={supplierOptions}/>
          <StableSelect name="material_id" label="Material 稳定 ID / 正式编码" options={materialOptions}/>
          <label>supplier_part_number<input name="supplier_item_code" required maxLength={160}/></label>
          <label>Supplier 物料名称<input name="supplier_item_name" maxLength={200}/></label>
          <label>Supplier 规格<textarea name="supplier_specification" maxLength={1000}/></label>
          <label>制造商<input name="manufacturer" maxLength={160}/></label>
          <label>MPN<input name="mpn" maxLength={160}/></label>
          <label>Revision<input name="revision" maxLength={80}/></label>
          <StableSelect name="purchase_unit_id" label="Supplier Unit 稳定 ID / 编码" options={unitOptions}/>
          <label>换算分子<input type="number" name="conversion_numerator" min="1" max="1000000000" defaultValue="1" required/></label>
          <label>换算分母<input type="number" name="conversion_denominator" min="1" max="1000000000" defaultValue="1" required/></label>
          <label>有效开始（Asia/Shanghai）<input type="date" name="valid_from" defaultValue={todayShanghai()} required/></label>
          <label>有效结束（可空、结束日不含）<input type="date" name="valid_to"/></label>
          <button disabled={busy}>保存草稿</button>
          <button type="button" disabled>提交审核（保存草稿后可用）</button>
        </form>
      </section> : null}
    </> : null}

    <section className="sourcing-panel">
      <div className="sourcing-title"><h2>{mode === "review" ? "待审核、已生效与已退回事实" : "草稿、待审核、已生效与历史版本"}</h2><span>{rows.length} 条版本事实</span></div>
      <div className="sm-list">{rows.map((row) => <MappingCard key={row.mapping_version_id} row={row} mode={mode} user={session.user!} busy={busy} write={write} openReview={openReview}/>)}</div>
      {!rows.length ? <State>没有符合条件的 Supplier Mapping。</State> : null}
    </section>
    {notice ? <State>{notice}</State> : null}{error ? <State error>{error}</State> : null}
    {dialog ? <ReviewDialog
      kind={dialog.kind}
      preview={dialog.preview}
      reviewComment={reviewComment}
      setReviewComment={setReviewComment}
      error={dialogError}
      busy={approvalBusy}
      onClose={() => { if (!approvalBusyRef.current) { setDialog(null); setDialogError(""); } }}
      onConfirm={() => void confirmApproval()}
    /> : null}
  </main>;
}

function OptionSearch({ label, onSearch }: { label: string; onSearch: (value: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  return <label>{label}<span><input value={value} maxLength={80} onChange={(event) => setValue(event.target.value)}/><button type="button" onClick={() => void onSearch(value)}>有界搜索</button></span></label>;
}

function StableSelect({ name, label, options }: { name: string; label: string; options: Option[] }) {
  return <label>{label}<select name={name} required><option value="">请选择稳定 ID</option>{options.map((option) => <option value={option.id} key={option.id}>ID {option.id} / {option.code} / {option.name}{option.base_unit ? ` / 主单位 ${option.base_unit}` : ""}</option>)}</select></label>;
}

function MappingCard({ row, mode, user, busy, write, openReview }: {
  row: MappingRow; mode: "manage" | "review"; user: User; busy: boolean;
  write: (path: string, method: "POST" | "PATCH", body: Record<string, unknown>, success: string) => Promise<void>;
  openReview: (row: MappingRow, kind: "approve" | "receipt") => Promise<void>;
}) {
  const ownDraft = mode === "manage" && row.status === "DRAFT" && row.created_by === user.username && can(user, "supplier_mapping.edit_draft");
  const canSubmit = ownDraft && can(user, "supplier_mapping.submit");
  const canVersion = mode === "manage" && ["ACTIVE", "REJECTED"].includes(row.status) && can(user, "supplier_mapping.create");
  const review = mode === "review" && row.status === "PENDING_REVIEW";
  const path = `/api/supplier-mappings/${row.mapping_id}`;
  return <article className="sm-card">
    <div className="sourcing-title"><div><b>Mapping {row.mapping_id}</b><small>Version {row.mapping_version} · Version Fact #{row.mapping_version_id} · CAS {row.expected_version}</small></div><Status value={row.status}/></div>
    <dl className="sm-facts">
      <div><dt>Supplier</dt><dd>ID {row.supplier_id} / <b>{row.supplier_code}</b> / {row.supplier_name}</dd></div>
      <div><dt>Material</dt><dd>ID {row.material_id} / <b>{row.internal_material_code}</b> / {row.standard_name}</dd></div>
      <div><dt>Supplier / Material 当前状态</dt><dd>{row.supplier_status} / {row.material_status}</dd></div>
      <div><dt>Supplier Part</dt><dd>{row.supplier_part_number}</dd></div>
      <div><dt>Supplier / Internal Unit</dt><dd>{row.supplier_unit} / {row.internal_unit}</dd></div>
      <div><dt>换算关系</dt><dd>{row.conversion_numerator} : {row.conversion_denominator}</dd></div>
      <div><dt>有效期</dt><dd>{shanghaiDate(row.valid_from)} → {row.valid_to ? shanghaiDate(row.valid_to) : "长期"}</dd></div>
      <div><dt>供应商正文</dt><dd>{row.supplier_item_name || "—"} / {row.supplier_specification || "—"}</dd></div>
      <div><dt>制造商 / MPN / Revision</dt><dd>{row.manufacturer || "—"} / {row.mpn || "—"} / {row.revision || "—"}</dd></div>
      <div><dt>当前 ACTIVE / 冲突</dt><dd>{row.active_mapping_count} 条 / {row.active_conflict_count === 0 && row.supplier_part_conflict_count === 0 ? "无冲突" : `关系 ${row.active_conflict_count} · 料号 ${row.supplier_part_conflict_count}`}</dd></div>
      <div><dt>创建</dt><dd>{row.created_by} · {shanghaiTime(row.created_at)}<br/><span className="sm-mono">{row.created_request_id}</span></dd></div>
      <div><dt>提交</dt><dd>{row.submitted_by || "—"} · {shanghaiTime(row.submitted_at)}<br/><span className="sm-mono">{row.submitted_request_id || "—"}</span></dd></div>
      <div><dt>审核</dt><dd>{row.reviewed_by || "—"} · {shanghaiTime(row.reviewed_at)} · {row.review_outcome || "—"}<br/><span className="sm-mono">{row.reviewed_request_id || "—"}</span></dd></div>
      <div><dt>退回原因</dt><dd>{row.review_reason || "—"}</dd></div>
      <div><dt>最新结果</dt><dd>{row.result || "—"} · {row.event_actor || "—"} · {shanghaiTime(row.event_at)}</dd></div>
      <div><dt>request_id</dt><dd className="sm-mono">{row.event_request_id || row.request_id}</dd></div>
    </dl>

    {ownDraft ? <details className="sm-edit"><summary>编辑当前草稿正文</summary><form className="sourcing-form" onSubmit={(event) => { event.preventDefault(); void write(`${path}/draft`, "PATCH", { expected_version: row.expected_version, ...mappingBody(new FormData(event.currentTarget)) }, "草稿已按 CAS 保存"); }}>
      <label>Supplier 稳定 ID（创建后固定）<input type="number" min="1" name="supplier_id" defaultValue={row.supplier_id} readOnly required/><small>{row.supplier_code} / {row.supplier_name}</small></label>
      <label>Material 稳定 ID<input type="number" min="1" name="material_id" defaultValue={row.material_id} required/><small>{row.internal_material_code} / {row.standard_name}</small></label>
      <label>supplier_part_number（创建后固定）<input name="supplier_item_code" defaultValue={row.supplier_part_number} readOnly required maxLength={160}/></label>
      <label>Supplier 物料名称<input name="supplier_item_name" defaultValue={row.supplier_item_name} maxLength={200}/></label>
      <label>Supplier 规格<textarea name="supplier_specification" defaultValue={row.supplier_specification} maxLength={1000}/></label>
      <label>制造商<input name="manufacturer" defaultValue={row.manufacturer} maxLength={160}/></label>
      <label>MPN<input name="mpn" defaultValue={row.mpn} maxLength={160}/></label>
      <label>Revision<input name="revision" defaultValue={row.revision} maxLength={80}/></label>
      <label>Supplier Unit 稳定 ID<input type="number" min="1" name="purchase_unit_id" defaultValue={row.purchase_unit_id} required/><small>{row.supplier_unit}</small></label>
      <label>换算分子<input type="number" min="1" max="1000000000" name="conversion_numerator" defaultValue={row.conversion_numerator} required/></label>
      <label>换算分母<input type="number" min="1" max="1000000000" name="conversion_denominator" defaultValue={row.conversion_denominator} required/></label>
      <label>有效开始<input type="date" name="valid_from" defaultValue={shanghaiDate(row.valid_from)} required/></label>
      <label>有效结束<input type="date" name="valid_to" defaultValue={shanghaiDate(row.valid_to)}/></label>
      <button disabled={busy}>保存草稿修改</button>
    </form></details> : null}
    {canSubmit ? <button disabled={busy} onClick={() => void write(`${path}/submit`, "POST", { expected_version: row.expected_version }, "Mapping 已提交；正文冻结并等待 operations 审核")}>提交审核</button> : null}
    {canVersion ? <button className="sm-quiet" disabled={busy} onClick={() => void write(`${path}/versions`, "POST", { expected_version: row.expected_version }, "已从不可变历史建立新 DRAFT 版本")}>创建受控新版本</button> : null}
    {review ? <div className="sm-review-actions">
      <button disabled={busy || !can(user, "supplier_mapping.approve")} onClick={() => void openReview(row, "approve")}>批准并生效</button>
      <form onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") || ""); void write(`${path}/reject`, "POST", { expected_version: row.expected_version, reason }, "审核 SUCCESS：Mapping 已退回，正文历史保持不可变"); }}><label>退回原因（必填）<textarea name="reason" required maxLength={500}/></label><button className="danger" disabled={busy || !can(user, "supplier_mapping.reject")}>退回</button></form>
    </div> : null}
    {mode === "review" && ["ACTIVE", "INACTIVE"].includes(row.status) && row.review_outcome === "APPROVED"
      ? <button className="sm-quiet" disabled={busy} onClick={() => void openReview(row, "receipt")}>查看批准凭证</button>
      : null}
  </article>;
}

function ReviewDialog({ kind, preview, reviewComment, setReviewComment, error, busy, onClose, onConfirm }: {
  kind: "approve" | "receipt"; preview: ReviewPreview; reviewComment: string;
  setReviewComment: (value: string) => void; error: string; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const mapping = preview.mapping;
  const conditions = preview.approval_conditions;
  return <div className="sm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="sm-dialog" role="dialog" aria-modal="true" aria-labelledby="sm-review-title">
      <header>
        <div><p className="sourcing-kicker">SERVER REVIEW PREVIEW</p><h2 id="sm-review-title">{kind === "approve" ? "确认批准并生效" : "批准成功凭证"}</h2></div>
        <button type="button" className="sm-dialog-close" aria-label="关闭审核窗口" disabled={busy} onClick={onClose}>×</button>
      </header>
      {kind === "receipt"
        ? (preview.approval_receipt
          ? <ApprovalReceiptView receipt={preview.approval_receipt}/>
          : <State error>没有找到可验证的 APPROVE 成功事件，未生成凭证。</State>)
        : <>
          <p className="sm-dialog-warning">批准将使该稳定 Mapping 进入 ACTIVE。请逐项核对，系统不会自动创建 RFQ、Quote、Award 或 PO。</p>
          <dl className="sm-facts sm-preview-facts">
            <div><dt>Mapping ID</dt><dd className="sm-mono">{mapping.mapping_id}</dd></div>
            <div><dt>Version / CAS / 状态</dt><dd>V{mapping.mapping_version} / CAS {mapping.expected_version} / {mapping.status}</dd></div>
            <div><dt>Supplier</dt><dd>ID {mapping.supplier.id} / <b>{mapping.supplier.code}</b> / {mapping.supplier.name} / {mapping.supplier.status}</dd></div>
            <div><dt>Material</dt><dd>ID {mapping.material.id} / <b>{mapping.material.code}</b> / {mapping.material.name} / {mapping.material.status}</dd></div>
            <div><dt>supplier_part_number</dt><dd>{mapping.supplier_part_number}</dd></div>
            <div><dt>Supplier / Internal Unit</dt><dd>{mapping.units.supplier} / {mapping.units.internal || "—"}</dd></div>
            <div><dt>换算关系</dt><dd>{mapping.conversion.numerator} : {mapping.conversion.denominator}</dd></div>
            <div><dt>有效期</dt><dd>{shanghaiDate(mapping.validity.valid_from)} → {mapping.validity.valid_to ? shanghaiDate(mapping.validity.valid_to) : "长期"}</dd></div>
            <div><dt>创建成功事实</dt><dd>{preview.lifecycle.created.actor || "—"} · {shanghaiTime(preview.lifecycle.created.occurred_at)} · {preview.lifecycle.created.result || "—"}<br/><span className="sm-mono">{preview.lifecycle.created.request_id || "—"}</span></dd></div>
            <div><dt>提交成功事实</dt><dd>{preview.lifecycle.submitted.actor || "—"} · {shanghaiTime(preview.lifecycle.submitted.occurred_at)} · {preview.lifecycle.submitted.result || "—"}<br/><span className="sm-mono">{preview.lifecycle.submitted.request_id || "—"}</span></dd></div>
            <div><dt>相同 Supplier / Material ACTIVE</dt><dd>{preview.conflicts.active_mapping_count} 条；冲突 {preview.conflicts.active_conflict_count} 条</dd></div>
            <div><dt>Supplier 内料号冲突</dt><dd>{preview.conflicts.supplier_part_conflict_count} 条</dd></div>
            <div><dt>批准推进语义</dt><dd>V{preview.approval_projection.before.mapping_version} / CAS {preview.approval_projection.before.cas} → V{preview.approval_projection.after.mapping_version} / CAS {preview.approval_projection.after.cas}；最终 ACTIVE</dd></div>
            <div><dt>RFQ 覆盖校验</dt><dd>{preview.approval_projection.rfq_coverage_eligible_after_approval ? "可参与" : "不可计入"} · {preview.approval_projection.rfq_coverage_note}</dd></div>
            <div><dt>下游副作用</dt><dd>RFQ 0 / Quote 0 / Award 0 / PO 0</dd></div>
            <div><dt>批准条件</dt><dd>{conditions.can_approve ? "满足" : "不满足"}</dd></div>
          </dl>
          {conditions.issues.length ? <div className="sm-blockers" role="alert"><b>禁止批准</b><ul>{conditions.issues.map((item) => <li key={item.code}><code>{item.code}</code>：{item.message}<br/><span>{item.suggestion}</span></li>)}</ul></div> : null}
          <label className="sm-review-comment">审核意见（独立字段，必填）
            <textarea autoFocus required maxLength={500} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="记录本次 Supplier、Material、单位、换算与冲突核验结论"/>
          </label>
          {error ? <State error>{error}</State> : null}
          <footer>
            <button type="button" className="sm-quiet" disabled={busy} onClick={onClose}>取消</button>
            <button type="button" disabled={busy || !conditions.can_approve || !reviewComment.trim()} onClick={onConfirm}>{busy ? "服务端复核中…" : "确认批准并生效"}</button>
          </footer>
        </>}
      {kind === "receipt" ? <footer><button type="button" autoFocus className="sm-quiet" onClick={onClose}>关闭凭证</button></footer> : null}
    </section>
  </div>;
}

function ApprovalReceiptView({ receipt }: { receipt: ApprovalReceipt }) {
  return <div className="sm-receipt">
    <div className="sm-receipt-banner">APPROVE · {receipt.result} · {statusLabels[receipt.final_status] || receipt.final_status}</div>
    <dl className="sm-facts">
      <div><dt>Mapping ID</dt><dd className="sm-mono">{receipt.mapping_id}</dd></div>
      <div><dt>决策 / 结果</dt><dd>{receipt.decision} / {receipt.result}</dd></div>
      <div><dt>Actor</dt><dd>{receipt.actor}</dd></div>
      <div><dt>Asia/Shanghai 时间</dt><dd>{shanghaiTime(receipt.occurred_at)}</dd></div>
      <div><dt>request_id</dt><dd className="sm-mono">{receipt.request_id}</dd></div>
      <div><dt>审核意见</dt><dd className={receipt.historical_comment_missing ? "sm-history-missing" : ""}>{receipt.review_comment_display || HISTORICAL_APPROVAL_COMMENT_MISSING}</dd></div>
      <div><dt>批准前 Version / CAS</dt><dd>V{receipt.before.mapping_version} / {receipt.before.cas == null ? "历史未记录" : `CAS ${receipt.before.cas}`}</dd></div>
      <div><dt>批准后 Version / CAS</dt><dd>V{receipt.after.mapping_version} / {receipt.after.cas == null ? "历史未记录" : `CAS ${receipt.after.cas}`}</dd></div>
      <div><dt>最终状态</dt><dd>{receipt.final_status} / 生效</dd></div>
      <div><dt>Supplier</dt><dd>ID {receipt.supplier.id} / <b>{receipt.supplier.code}</b> / {receipt.supplier.name}</dd></div>
      <div><dt>Material</dt><dd>ID {receipt.material.id} / <b>{receipt.material.code}</b> / {receipt.material.name}</dd></div>
      <div><dt>supplier_part_number</dt><dd>{receipt.supplier_part_number}</dd></div>
      <div><dt>单位及换算</dt><dd>{receipt.units.supplier} → {receipt.units.internal || "—"} · {receipt.conversion.numerator}:{receipt.conversion.denominator}</dd></div>
      <div><dt>有效期</dt><dd>{shanghaiDate(receipt.validity.valid_from)} → {receipt.validity.valid_to ? shanghaiDate(receipt.validity.valid_to) : "长期"}</dd></div>
    </dl>
  </div>;
}
