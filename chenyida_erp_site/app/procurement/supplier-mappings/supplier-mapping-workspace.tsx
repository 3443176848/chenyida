"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
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
  review_outcome: string | null; review_reason: string; request_id: string; result: string; event_type: string | null; event_actor: string | null; event_at: string | null; event_request_id: string | null;
};

const can = (user: User | null | undefined, permission: string) => Boolean(user && (user.permissions.includes("*") || user.permissions.includes(permission)));
const statusLabels: Record<string, string> = { DRAFT: "草稿", PENDING_REVIEW: "待审核", ACTIVE: "已生效", REJECTED: "已退回", INACTIVE: "历史失效" };
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
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const readRows = useCallback(async (filters = "") => {
    const path = mode === "review" ? "/api/supplier-mappings/review-queue?page_size=100" : `/api/supplier-mappings?page_size=100${filters}`;
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
    for (const key of ["supplier", "material", "supplier_part_number", "status"]) {
      const value = String(form.get(key) || "").trim(); if (value) query.set(key, value);
    }
    void readRows(query.size ? `&${query}` : "").catch((reason) => setError(errorText(reason)));
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

    {mode === "review" ? <section className="sourcing-panel"><div className="sourcing-title"><h2>PENDING_REVIEW 审核队列</h2><strong>{rows.length}</strong></div><p className="sourcing-note">正文已冻结且没有编辑入口。批准后 RFQ 才可使用；创建人不能审核自己的 Mapping。</p></section> : null}

    {mode === "manage" ? <>
      <section className="sourcing-panel">
        <h2>搜索和筛选</h2>
        <form className="sm-filter" onSubmit={filter}>
          <label>Supplier ID / 编码 / 名称<input name="supplier" maxLength={100}/></label>
          <label>Material ID / 正式编码 / 名称<input name="material" maxLength={100}/></label>
          <label>supplier_part_number<input name="supplier_part_number" maxLength={100}/></label>
          <label>状态<select name="status"><option value="">全部</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button disabled={busy}>筛选</button>
        </form>
      </section>
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
      <div className="sourcing-title"><h2>{mode === "review" ? "只读待审核正文" : "草稿、待审核、已生效与历史版本"}</h2><span>{rows.length} 条版本事实</span></div>
      <div className="sm-list">{rows.map((row) => <MappingCard key={row.mapping_version_id} row={row} mode={mode} user={session.user!} busy={busy} write={write}/>)}</div>
      {!rows.length ? <State>{mode === "review" ? "当前审核队列为 0。" : "没有符合条件的 Supplier Mapping。"}</State> : null}
    </section>
    {notice ? <State>{notice}</State> : null}{error ? <State error>{error}</State> : null}
  </main>;
}

function OptionSearch({ label, onSearch }: { label: string; onSearch: (value: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  return <label>{label}<span><input value={value} maxLength={80} onChange={(event) => setValue(event.target.value)}/><button type="button" onClick={() => void onSearch(value)}>有界搜索</button></span></label>;
}

function StableSelect({ name, label, options }: { name: string; label: string; options: Option[] }) {
  return <label>{label}<select name={name} required><option value="">请选择稳定 ID</option>{options.map((option) => <option value={option.id} key={option.id}>ID {option.id} / {option.code} / {option.name}{option.base_unit ? ` / 主单位 ${option.base_unit}` : ""}</option>)}</select></label>;
}

function MappingCard({ row, mode, user, busy, write }: {
  row: MappingRow; mode: "manage" | "review"; user: User; busy: boolean;
  write: (path: string, method: "POST" | "PATCH", body: Record<string, unknown>, success: string) => Promise<void>;
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
      <div><dt>Supplier Part</dt><dd>{row.supplier_part_number}</dd></div>
      <div><dt>Supplier / Internal Unit</dt><dd>{row.supplier_unit} / {row.internal_unit}</dd></div>
      <div><dt>换算关系</dt><dd>{row.conversion_numerator} : {row.conversion_denominator}</dd></div>
      <div><dt>有效期</dt><dd>{shanghaiDate(row.valid_from)} → {row.valid_to ? shanghaiDate(row.valid_to) : "长期"}</dd></div>
      <div><dt>供应商正文</dt><dd>{row.supplier_item_name || "—"} / {row.supplier_specification || "—"}</dd></div>
      <div><dt>制造商 / MPN / Revision</dt><dd>{row.manufacturer || "—"} / {row.mpn || "—"} / {row.revision || "—"}</dd></div>
      <div><dt>创建</dt><dd>{row.created_by} · {shanghaiTime(row.created_at)}</dd></div>
      <div><dt>提交</dt><dd>{row.submitted_by || "—"} · {shanghaiTime(row.submitted_at)}</dd></div>
      <div><dt>审核</dt><dd>{row.reviewed_by || "—"} · {shanghaiTime(row.reviewed_at)} · {row.review_outcome || "—"}</dd></div>
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
      <button disabled={busy || !can(user, "supplier_mapping.approve")} onClick={() => void write(`${path}/approve`, "POST", { expected_version: row.expected_version, reason: "" }, "审核 SUCCESS：Mapping 已生效，RFQ 现在可以按有效期重新计算覆盖率")}>批准并生效</button>
      <form onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") || ""); void write(`${path}/reject`, "POST", { expected_version: row.expected_version, reason }, "审核 SUCCESS：Mapping 已退回，正文历史保持不可变"); }}><label>退回原因（必填）<textarea name="reason" required maxLength={500}/></label><button className="danger" disabled={busy || !can(user, "supplier_mapping.reject")}>退回</button></form>
    </div> : null}
  </article>;
}
