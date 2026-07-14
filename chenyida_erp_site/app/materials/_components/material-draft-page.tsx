"use client";

import Link from "next/link";
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type ReactNode,
} from "react";
import { api, ErpApiError, safeMaterialReturnTo } from "../../../public/erp/api-client.js";
import {
  EMPTY_DRAFT, canCreateDraft, canEditDraft, canSubmitDraft, createWriteOperation,
  draftFromDetail, isDraftDirty, retryAfterSeconds, serializeDraft, unknownAttributeCodes,
  type AttributeSchema, type CategorySchema, type DraftForm, type DraftIssue, type WriteOperation,
} from "../_lib/material-draft";
import { flattenCategories, formatShanghaiDate, statusLabel, type CategoryOption } from "../_lib/material-ui";
import { redirectToExistingLogin, useMaterialSession } from "./material-shell";
import { MaterialStatusBadge } from "./material-primitives";

type Mode = "create" | "edit";
type PageState = "LOADING" | "READY" | "SAVING" | "SYNCING" | "SAVED_UNSYNCED" | "RESULT_UNKNOWN" | "SUBMITTING" | "BLOCKED";
type Detail = {
  material: Record<string, unknown> & { material_id: number; standard_name: string; material_status: string; current_version: number; created_by: string };
  attributes: { attribute_code: string; name: string; data_type: string; value: unknown; unit?: string }[];
  validation: { valid: boolean; errors: ServerIssue[]; warnings: ServerIssue[] };
  last_rejection?: { version: number; reason: string; reviewed_by: string; reviewed_at: string } | null;
};
type ServerIssue = { code?: string; severity?: string; field?: string; attribute_code?: string; message?: string };
type Confirmation = { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null;

const cloneEmptyDraft = (): DraftForm => JSON.parse(JSON.stringify(EMPTY_DRAFT)) as DraftForm;

function serverIssues(detail: Detail): DraftIssue[] {
  return [...(detail.validation?.errors || []), ...(detail.validation?.warnings || [])].map((issue) => ({
    source: "SERVER",
    code: String(issue.code || "MATERIAL_VALIDATION_ISSUE"),
    severity: issue.severity === "WARNING" ? "WARNING" : "ERROR",
    field: String(issue.field || (issue.attribute_code ? `attributes.${issue.attribute_code}` : "general")),
    ...(issue.attribute_code ? { attribute_code: String(issue.attribute_code) } : {}),
    message: String(issue.message || "服务端返回了无法映射的校验问题"),
  }));
}

function issueFromError(error: ErpApiError): DraftIssue[] {
  return (error.details || []).map((raw) => {
    const detail = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      source: "SERVER", code: String(detail.code || error.code || "MATERIAL_VALIDATION_FAILED"),
      severity: String(detail.severity || "ERROR") === "WARNING" ? "WARNING" : "ERROR",
      field: String(detail.field || (detail.attribute_code ? `attributes.${detail.attribute_code}` : "general")),
      ...(detail.attribute_code ? { attribute_code: String(detail.attribute_code) } : {}),
      message: String(detail.message || "服务端校验未通过，请检查输入"),
    };
  });
}

function fieldId(field: string): string {
  return `material-draft-${field.replaceAll(".", "-").replaceAll("_", "-").toLowerCase()}`;
}

function AccessibleConfirmDialog({ value, onCancel }: { value: NonNullable<Confirmation>; onCancel: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => trigger?.focus();
  }, []);
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button,input,select,textarea,[href]") || [])].filter((item) => !item.hasAttribute("disabled"));
    if (!controls.length) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="mm-modal-backdrop"><div className="mm-modal" role="dialog" aria-modal="true" aria-labelledby="mm-dialog-title" ref={dialogRef} onKeyDown={trap}>
    <h2 id="mm-dialog-title">{value.title}</h2><div className="mm-modal-body">{value.body}</div>
    <div className="mm-modal-actions"><button ref={cancelRef} onClick={onCancel}>取消</button><button className={value.danger ? "danger" : "primary"} onClick={() => { value.onConfirm(); onCancel(); }}>{value.confirmLabel}</button></div>
  </div></div>;
}

function WarningSubmitDialog({ detail, issues, comment, onComment, onCancel, onSubmit }: {
  detail: Detail; issues: DraftIssue[]; comment: string; onComment: (value: string) => void; onCancel: () => void; onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => trigger?.focus();
  }, []);
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button,textarea") || [])];
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
    if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
  };
  return <div className="mm-modal-backdrop"><div className="mm-modal" role="dialog" aria-modal="true" aria-labelledby="warning-title" ref={dialogRef} onKeyDown={trap}><h2 id="warning-title">存在校验警告</h2><p>草稿 V{String(detail.material.current_version)} 没有 ERROR，但有 {issues.length} 个 WARNING。本次确认只对当前版本和 Validation 有效。</p><ul>{issues.map((issue) => <li key={`${issue.code}-${issue.field}`}><b>{issue.code}</b>：{issue.message}</li>)}</ul><label>提交说明（可选）<textarea maxLength={1000} value={comment} onChange={(event) => onComment(event.target.value)} /></label><div className="mm-modal-actions"><button ref={cancelRef} onClick={onCancel}>返回修改</button><button className="primary" onClick={onSubmit}>确认警告并提交审核</button></div></div></div>;
}

export function MaterialDraftPage({ mode, materialId }: { mode: Mode; materialId?: number }) {
  const session = useMaterialSession();
  const permissions = useMemo(() => session.user?.permissions || [], [session.user?.permissions]);
  const username = session.user?.username || "";
  const initialAllowed = mode === "create" ? canCreateDraft(permissions) : permissions.includes("material.draft.edit_own") || permissions.includes("material.draft.edit_any");
  const [pageState, setPageState] = useState<PageState>(initialAllowed ? "LOADING" : "BLOCKED");
  const [formDraft, setFormDraft] = useState<DraftForm>(cloneEmptyDraft);
  const [serverSnapshot, setServerSnapshot] = useState<DraftForm | null>(mode === "create" ? cloneEmptyDraft() : null);
  const [expectedVersion, setExpectedVersion] = useState(0);
  const [schema, setSchema] = useState<CategorySchema | null>(null);
  const [schemaError, setSchemaError] = useState("");
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [localIssues, setLocalIssues] = useState<DraftIssue[]>([]);
  const [remoteIssues, setRemoteIssues] = useState<DraftIssue[]>([]);
  const [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState("");
  const [writeEnabled, setWriteEnabled] = useState(initialAllowed);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [submitComment, setSubmitComment] = useState("");
  const [pendingSubmitDetail, setPendingSubmitDetail] = useState<Detail | null>(null);
  const [conflictDetail, setConflictDetail] = useState<Detail | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const operationRef = useRef<WriteOperation | null>(null);
  const writeFlowBusyRef = useRef(false);
  const submitBusyRef = useRef(false);
  const allowProgrammaticNavigationRef = useRef(false);
  const [operation, setOperation] = useState<WriteOperation | null>(null);
  const [returnTo] = useState(() => typeof window === "undefined" ? "/materials" : safeMaterialReturnTo(new URLSearchParams(window.location.search).get("return_to")));
  const dirty = useMemo(() => isDraftDirty(serverSnapshot, formDraft), [formDraft, serverSnapshot]);
  const unknownCodes = useMemo(() => unknownAttributeCodes(formDraft, schema), [formDraft, schema]);
  const allIssues = [...localIssues, ...remoteIssues];

  const loadSchema = useCallback(async (categoryId: number, signal?: AbortSignal) => {
    setSchemaLoading(true); setSchemaError("");
    try {
      const response = await api<{ data: CategorySchema }>(`/api/material-master/categories/${categoryId}/schema`, { signal });
      setSchema(response.data);
      return response.data;
    } catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return null;
      if (reason instanceof ErpApiError && reason.status === 401) redirectToExistingLogin();
      setSchema(null); setSchemaError("属性 Schema 加载失败，保存和提交已停止");
      return null;
    } finally { setSchemaLoading(false); }
  }, []);

  const applyDetail = useCallback(async (loaded: Detail, signal?: AbortSignal) => {
    const canEdit = canEditDraft(permissions, username, loaded.material.created_by);
    setDetail(loaded);
    setExpectedVersion(Number(loaded.material.current_version || 0));
    setRemoteIssues(serverIssues(loaded));
    if (loaded.material.material_status !== "DRAFT" || !canEdit) {
      setWriteEnabled(false); setPageState("BLOCKED"); return false;
    }
    const nextDraft = draftFromDetail(loaded);
    const loadedSchema = nextDraft.category_id ? await loadSchema(nextDraft.category_id, signal) : null;
    if (!loadedSchema) { setFormDraft(nextDraft); setServerSnapshot(nextDraft); setPageState("BLOCKED"); return false; }
    setFormDraft(nextDraft); setServerSnapshot(nextDraft); setWriteEnabled(true); setPageState("READY");
    document.title = `${loaded.material.standard_name} - 编辑物料草稿 - 晨亿达 ERP`;
    return true;
  }, [loadSchema, permissions, username]);

  const readLatestDetail = useCallback(async (signal?: AbortSignal) => {
    if (!materialId) return null;
    const response = await api<{ data: Detail }>(`/api/material-master/materials/${materialId}`, { signal });
    return response.data;
  }, [materialId]);

  useEffect(() => {
    if (!initialAllowed) return;
    const controller = new AbortController();
    const start = async () => {
      try {
        const categoryResponse = await api<{ data: Parameters<typeof flattenCategories>[0] }>("/api/material-master/categories?view=tree", { signal: controller.signal });
        setCategories(flattenCategories(categoryResponse.data || []));
        if (mode === "edit") {
          const loaded = await readLatestDetail(controller.signal);
          if (loaded) await applyDetail(loaded, controller.signal);
        } else { setPageState("READY"); document.title = "新建物料草稿 - 晨亿达 ERP"; }
      } catch (reason) {
        if ((reason as { name?: string })?.name === "AbortError") return;
        if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
        if (reason instanceof ErpApiError && reason.status === 404) setNotice("草稿不存在或无权查看");
        else if (reason instanceof ErpApiError && reason.status === 403) setNotice("当前账号没有创建或编辑物料草稿的权限");
        else { setNotice("系统暂时无法加载草稿，请稍后重试"); setRequestId(reason instanceof ErpApiError ? reason.requestId : ""); }
        setWriteEnabled(false); setPageState("BLOCKED");
      }
    };
    void start();
    return () => controller.abort();
  }, [applyDetail, initialAllowed, mode, readLatestDetail]);

  useEffect(() => {
    if (!dirty && operation?.state !== "RESULT_UNKNOWN") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowProgrammaticNavigationRef.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, operation?.state]);

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setInterval(() => setRetryIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryIn]);

  const focusIssue = (issue: DraftIssue) => {
    const target = document.getElementById(fieldId(issue.field));
    target?.scrollIntoView({ behavior: "smooth", block: "center" }); target?.focus();
  };

  const updateBasic = (field: keyof DraftForm["basic_fields"], value: string | boolean | null) => {
    setFormDraft((current) => ({ ...current, basic_fields: { ...current.basic_fields, [field]: value } }));
    setLocalIssues([]); setRemoteIssues([]); setPendingSubmitDetail(null);
  };

  const updateAttribute = (code: string, patch: Partial<DraftForm["attributes"][string]>) => {
    setFormDraft((current) => ({ ...current, attributes: { ...current.attributes, [code]: { ...(current.attributes[code] || { value: null, unit: "" }), ...patch } } }));
    setLocalIssues([]); setRemoteIssues([]); setPendingSubmitDetail(null);
  };

  const setCategory = async (categoryId: number) => {
    setSchemaError("");
    if (!categoryId) {
      setSchema(null); setFormDraft((current) => ({ ...current, category_id: null }));
      setLocalIssues([]); setRemoteIssues([]); setPendingSubmitDetail(null); return;
    }
    const next = await loadSchema(categoryId);
    if (next) {
      setFormDraft((current) => ({ ...current, category_id: categoryId }));
      setLocalIssues([]); setRemoteIssues([]); setPendingSubmitDetail(null);
    }
  };

  const requestCategory = (categoryId: number) => {
    if (categoryId === formDraft.category_id) return;
    const hasInput = Object.values(formDraft.attributes).some((entry) => entry.value !== null && entry.value !== "");
    if (!hasInput) { void setCategory(categoryId); return; }
    setConfirmation({ title: "更换分类？", body: <p>当前动态属性已有输入。新 Schema 加载成功前不会删除输入，也不能保存；无法映射的属性必须单独确认删除。</p>, confirmLabel: "继续加载新分类", onConfirm: () => void setCategory(categoryId) });
  };

  const blockWrites = (message: string) => { setWriteEnabled(false); setPageState("BLOCKED"); setNotice(message); };

  const handleWriteError = async (reason: unknown, savedBeforeFailure = false) => {
    if (!(reason instanceof ErpApiError)) { setNotice("系统暂时无法完成写入"); setPageState("READY"); return; }
    setRequestId(reason.requestId);
    if (reason.code === "NETWORK_ERROR") {
      const current = operationRef.current;
      if (current) { const unknown = { ...current, state: "RESULT_UNKNOWN" as const }; operationRef.current = unknown; setOperation(unknown); setPageState("RESULT_UNKNOWN"); }
      setNotice("网络连接中断，写入结果待确认。只能使用原请求安全重试。"); return;
    }
    if (reason.status === 401) { setNotice("登录状态已失效；当前输入仍在本页内存中，重新登录会离开页面"); setPageState("READY"); return; }
    if (reason.status === 403) { blockWrites("当前权限已变化，写能力已关闭"); return; }
    if (reason.status === 404) { blockWrites("草稿不存在或无权查看"); return; }
    if (["DRAFT_NOT_EDITABLE", "MATERIAL_NOT_SUBMITTABLE"].includes(reason.code)) { blockWrites("当前物料状态已变化，不能继续编辑或提交"); return; }
    if (reason.code === "VERSION_CONFLICT") {
      setNotice("草稿已被其他用户修改；未覆盖任何服务器内容");
      try { const latest = await readLatestDetail(); if (latest) setConflictDetail(latest); } catch { setNotice("发生版本冲突，且暂时无法读取服务器版本"); }
      setPageState("READY"); return;
    }
    if (reason.status === 422 || reason.code === "MATERIAL_VALIDATION_FAILED") {
      setRemoteIssues(issueFromError(reason)); setNotice(savedBeforeFailure ? "草稿已保存，但尚未提交审核" : "校验未通过，已保留全部输入");
      if (formDraft.category_id) void loadSchema(formDraft.category_id); setPageState("READY"); return;
    }
    if (reason.status === 429) { const seconds = retryAfterSeconds(reason.retryAfter); setRetryIn(seconds); setNotice(`请求受限，请在 ${seconds} 秒后主动重试`); setPageState("READY"); return; }
    if (reason.code === "IDEMPOTENCY_CONFLICT") { setNotice("幂等请求与原载荷冲突，请核对内容后明确重新发起"); setPageState("READY"); return; }
    setNotice(savedBeforeFailure ? "草稿已保存，但尚未提交审核" : reason.status >= 500 ? "系统暂时无法处理当前请求" : reason.message);
    setPageState("READY");
  };

  const performWrite = async (type: WriteOperation["type"], method: "POST" | "PATCH", endpoint: string, payload: Record<string, unknown>, existing?: WriteOperation, savedBeforeFailure = false) => {
    if (!existing && ["PENDING", "RESULT_UNKNOWN"].includes(operationRef.current?.state || "")) return null;
    const op = existing || createWriteOperation({ key: crypto.randomUUID(), method, endpoint, payload, type });
    operationRef.current = op; setOperation(op); setPageState(type === "SUBMIT" ? "SUBMITTING" : "SAVING");
    try {
      const response = await api<{ data: Record<string, unknown>; request_id?: string }>(endpoint, {
        method, body: JSON.stringify(op.payload), protectedWrite: { idempotencyKey: op.key, csrfToken: session.csrf_token || "" },
      });
      const succeeded = { ...op, state: "SUCCEEDED" as const }; operationRef.current = succeeded; setOperation(succeeded);
      return response;
    } catch (reason) {
      if (!(reason instanceof ErpApiError) || reason.code !== "NETWORK_ERROR") {
        const failed = { ...op, state: "FAILED" as const }; operationRef.current = failed; setOperation(failed);
      }
      await handleWriteError(reason, savedBeforeFailure); return null;
    }
  };

  const syncAfterSave = async () => {
    setPageState("SYNCING");
    try {
      const latest = await readLatestDetail();
      if (!latest) throw new Error("missing detail");
      await applyDetail(latest); setNotice("草稿已保存并同步最新详情");
      return latest;
    } catch (reason) {
      setPageState("SAVED_UNSYNCED"); setNotice("草稿已保存，但无法同步最新详情");
      if (reason instanceof ErpApiError) setRequestId(reason.requestId);
      return null;
    }
  };

  const prepareSubmit = async (latest: Detail) => {
    const issues = serverIssues(latest); setRemoteIssues(issues);
    if (issues.some((issue) => issue.severity === "ERROR")) { setNotice("草稿已保存，但尚未提交审核"); return; }
    const warnings = issues.filter((issue) => issue.severity === "WARNING");
    if (warnings.length) { setPendingSubmitDetail(latest); return; }
    await submitNow(latest);
  };

  const saveDraft = async (submitAfter = false) => {
    if (writeFlowBusyRef.current) return;
    if (!writeEnabled || schemaLoading || schemaError || unknownCodes.length || retryIn > 0 || operation?.state === "RESULT_UNKNOWN") return;
    writeFlowBusyRef.current = true;
    try {
      const serialized = serializeDraft(formDraft, schema); setLocalIssues(serialized.issues);
      if (serialized.issues.some((issue) => issue.severity === "ERROR")) { setNotice("请先修正本地检查错误"); return; }
      const basicFields = serialized.basic_fields;
      const payload = mode === "create"
        ? { basic_fields: { ...basicFields, source_type: "MANUAL" }, category_id: serialized.category_id, attributes: serialized.attributes }
        : { expected_version: expectedVersion, basic_fields: basicFields, category_id: serialized.category_id, attributes: serialized.attributes };
      const endpoint = mode === "create" ? "/api/material-master/drafts" : `/api/material-master/drafts/${materialId}`;
      const response = await performWrite(mode === "create" ? "CREATE" : "SAVE", mode === "create" ? "POST" : "PATCH", endpoint, payload);
      if (!response) return;
      if (mode === "create") {
        const id = Number(response.data.material_id);
        allowProgrammaticNavigationRef.current = true;
        window.location.replace(`/materials/${id}/edit?return_to=${encodeURIComponent(returnTo)}`); return;
      }
      setExpectedVersion(Number(response.data.version || expectedVersion)); setServerSnapshot(formDraft);
      const latest = await syncAfterSave(); if (latest && submitAfter) await prepareSubmit(latest);
    } finally {
      writeFlowBusyRef.current = false;
    }
  };

  const submitNow = async (latest: Detail) => {
    if (submitBusyRef.current) return;
    if (!materialId || !canSubmitDraft(permissions, username, latest.material.created_by)) return;
    submitBusyRef.current = true;
    try {
      const payload = { expected_version: Number(latest.material.current_version), ...(submitComment.trim() ? { submit_comment: submitComment.trim() } : {}) };
      const response = await performWrite("SUBMIT", "POST", `/api/material-master/drafts/${materialId}/submit`, payload, undefined, true);
      if (response) {
        allowProgrammaticNavigationRef.current = true;
        window.location.replace(`/materials/${materialId}?return_to=${encodeURIComponent(returnTo)}`);
      }
    } finally {
      submitBusyRef.current = false;
    }
  };

  const saveAndSubmit = async () => {
    if (dirty) { await saveDraft(true); return; }
    if (writeFlowBusyRef.current) return;
    writeFlowBusyRef.current = true; setPageState("SYNCING");
    try {
      const latest = await readLatestDetail();
      if (!latest) return;
      if (latest.material.material_status !== "DRAFT") { blockWrites("当前物料不是可提交草稿"); return; }
      setExpectedVersion(Number(latest.material.current_version)); setDetail(latest); setPageState("READY"); await prepareSubmit(latest);
    } catch (reason) { await handleWriteError(reason); }
    finally { writeFlowBusyRef.current = false; }
  };

  const retryUnknown = async () => {
    const op = operationRef.current;
    if (!op || op.state !== "RESULT_UNKNOWN") return;
    const pending = { ...op, state: "PENDING" as const }; operationRef.current = pending; setOperation(pending);
    const response = await performWrite(op.type, op.method, op.endpoint, op.payload as Record<string, unknown>, pending);
    if (!response) return;
    if (op.type === "CREATE") { allowProgrammaticNavigationRef.current = true; window.location.replace(`/materials/${Number(response.data.material_id)}/edit?return_to=${encodeURIComponent(returnTo)}`); return; }
    if (op.type === "SUBMIT") { allowProgrammaticNavigationRef.current = true; window.location.replace(`/materials/${materialId}?return_to=${encodeURIComponent(returnTo)}`); return; }
    setExpectedVersion(Number(response.data.version || expectedVersion)); setServerSnapshot(formDraft); await syncAfterSave();
  };

  const reloadSaved = async () => {
    setPageState("SYNCING");
    try { const latest = await readLatestDetail(); if (latest) await applyDetail(latest); } catch (reason) { await handleWriteError(reason); setPageState("SAVED_UNSYNCED"); }
  };

  const discardForServer = () => {
    if (!conflictDetail) return;
    setConfirmation({ title: "放弃本地修改？", danger: true, body: <p>本地未保存输入将被服务器 V{String(conflictDetail.material.current_version)} 完整替换，此操作不能撤销。</p>, confirmLabel: "放弃并使用服务器版本", onConfirm: () => { void applyDetail(conflictDetail); setConflictDetail(null); setNotice("已使用服务器最新版本"); } });
  };

  const navigateSafely = (href: string) => {
    if (!dirty && operation?.state !== "RESULT_UNKNOWN") { window.location.assign(href); return; }
    setConfirmation({ title: "离开编辑页？", danger: true, body: <p>{operation?.state === "RESULT_UNKNOWN" ? "写入结果仍待确认，离开可能无法判断本次操作结果。" : "当前有尚未保存的修改，离开后这些修改会丢失。"}</p>, confirmLabel: "放弃并离开", onConfirm: () => { allowProgrammaticNavigationRef.current = true; window.location.assign(href); } });
  };

  if (!initialAllowed) return <DraftBlocked message="当前账号没有创建或编辑物料草稿的权限" />;
  if (pageState === "LOADING") return <section className="mm-detail-loading" role="status">正在加载服务端最新草稿和属性 Schema…</section>;
  if (pageState === "BLOCKED" && (!detail || detail.material.material_status === "DRAFT")) return <DraftBlocked message={notice || "当前账号没有创建或编辑物料草稿的权限"} requestId={requestId} />;
  if (detail && detail.material.material_status !== "DRAFT") return <DraftBlocked message={`当前物料状态为${statusLabel(detail.material.material_status)}，不能在本页面修改。`} materialId={materialId} />;

  const canSave = writeEnabled && Boolean(schema) && !schemaError && !schemaLoading && !unknownCodes.length && !allIssues.some((issue) => issue.severity === "ERROR") && !["SAVING", "SYNCING", "SUBMITTING", "SAVED_UNSYNCED", "RESULT_UNKNOWN"].includes(pageState) && retryIn === 0;
  const canSubmit = mode === "edit" && detail ? canSubmitDraft(permissions, username, detail.material.created_by) : false;
  const formDisabled = !writeEnabled || pageState !== "READY";
  return <section className="mm-page mm-draft-page" aria-busy={["SAVING", "SYNCING", "SUBMITTING"].includes(pageState)}>
    <nav className="mm-breadcrumb" aria-label="面包屑"><Link href="/materials">物料主数据</Link><span>/</span><span>{mode === "create" ? "新建草稿" : "编辑草稿"}</span></nav>
    <header className="mm-draft-head"><div><h2>{mode === "create" ? "新建物料草稿" : detail?.material.standard_name || "编辑物料草稿"}</h2><p>来源：人工 / MANUAL · {mode === "edit" ? `当前版本 V${expectedVersion}` : "首次保存后进入编辑页"}</p></div>{detail ? <MaterialStatusBadge value={detail.material.material_status} /> : <span className="mm-status mm-status-draft">新草稿</span>}</header>
    {detail?.last_rejection ? <section className="mm-rejection" aria-label="最近一次驳回"><h3>最近一次驳回</h3><div><span>驳回版本：V{detail.last_rejection.version}</span><span>审核人：{detail.last_rejection.reviewed_by}</span><span>时间：{formatShanghaiDate(detail.last_rejection.reviewed_at, true)}</span></div><p>{detail.last_rejection.reason}</p><small>该历史只读；旧原因不会自动写入本次提交说明。</small></section> : null}
    {notice ? <div className={`mm-draft-notice mm-draft-notice-${pageState.toLowerCase()}`} role="status" aria-live="polite"><strong>{notice}</strong>{requestId ? <span>请求编号：{requestId}</span> : null}
      {pageState === "SAVED_UNSYNCED" ? <button onClick={() => void reloadSaved()}>重新加载最新详情</button> : null}
      {pageState === "RESULT_UNKNOWN" ? <button onClick={() => void retryUnknown()}>使用原请求安全重试</button> : null}
    </div> : null}
    {conflictDetail ? <VersionConflict local={formDraft} server={conflictDetail} onDiscard={discardForServer} /> : null}
    <div className="mm-draft-layout">
      <main className="mm-draft-main">
        <section className="mm-card mm-draft-category" id="draft-section-category"><h3>分类</h3><label htmlFor={fieldId("category_id")}>启用的四级叶子分类 *</label><select id={fieldId("category_id")} value={formDraft.category_id || ""} disabled={schemaLoading || formDisabled} onChange={(event) => requestCategory(Number(event.target.value))}><option value="">请选择分类</option>{categories.map((category) => <option key={category.category_id} value={category.category_id} disabled={!category.is_leaf}>{`${"　".repeat(Math.max(0, category.level - 1))}${category.name}${category.is_leaf ? "" : "（非叶子）"}`}</option>)}</select>
          {allIssues.filter((issue) => issue.field === "category_id").map((issue) => <small className="mm-field-issue" key={`${issue.source}-${issue.code}`}>{issue.severity}：{issue.message}</small>)}
          {schemaLoading ? <p>正在加载当前属性 Schema…</p> : schema ? <p>{schema.category_path} · Schema {schema.schema_version.slice(0, 18)}…</p> : <p>{schemaError || "可先填写基础字段；选择有效叶子并加载 Schema 后才能保存。"}</p>}</section>
        <MaterialBasicFieldsSection value={formDraft} sourceRef={mode === "edit" ? String(detail?.material.source_ref || "") : ""} disabled={formDisabled} issues={allIssues} onChange={updateBasic} />
        <MaterialDynamicAttributes schema={schema} value={formDraft} disabled={formDisabled} issues={allIssues} onChange={updateAttribute} />
        {unknownCodes.length ? <section className="mm-card mm-unknown-attributes"><h3>当前 Schema 无法映射的现有属性</h3><p>这些属性不会被静默隐藏或删除；确认处置前不能保存。</p><table><thead><tr><th>attribute_code</th><th>原值</th><th>单位</th></tr></thead><tbody>{unknownCodes.map((code) => <tr key={code}><td>{code}</td><td>{String(formDraft.attributes[code]?.value ?? "—")}</td><td>{formDraft.attributes[code]?.unit || "—"}</td></tr>)}</tbody></table><button className="danger" onClick={() => setConfirmation({ title: "删除未知旧属性？", danger: true, body: <p>将从最终完整聚合中删除 {unknownCodes.length} 个无法映射属性，并进入未保存状态。</p>, confirmLabel: "确认删除", onConfirm: () => { setFormDraft((current) => ({ ...current, attributes: Object.fromEntries(Object.entries(current.attributes).filter(([code]) => !unknownCodes.includes(code))) })); setLocalIssues([]); setRemoteIssues([]); } })}>确认删除所列属性</button></section> : null}
      </main>
      <aside className="mm-draft-aside"><nav aria-label="快速定位"><h3>快速定位</h3><a href="#draft-section-category">分类</a><a href="#draft-section-basic">基本信息</a><a href="#draft-section-attributes">动态属性</a><a href="#draft-validation">校验结果</a></nav><MaterialValidationSummary issues={allIssues} onFocus={focusIssue} /></aside>
    </div>
    <div className="mm-draft-actions"><div><strong>{dirty ? "未保存修改" : pageState === "SAVED_UNSYNCED" ? "已保存但尚未同步" : `已保存${expectedVersion ? ` · V${expectedVersion}` : ""}`}</strong><span>{pageState === "SAVING" ? "保存中…" : pageState === "SYNCING" ? "同步中…" : pageState === "SUBMITTING" ? "提交中…" : pageState === "RESULT_UNKNOWN" ? "结果待确认" : "当前状态：草稿"}</span></div><button onClick={() => navigateSafely(returnTo)}>返回</button><button disabled={!canSave || !dirty} onClick={() => void saveDraft(false)}>保存草稿</button>{mode === "edit" && canSubmit ? <button className="primary" disabled={!canSave} onClick={() => void saveAndSubmit()}>保存并提交审核</button> : null}</div>
    {pendingSubmitDetail ? <WarningSubmitDialog detail={pendingSubmitDetail} issues={remoteIssues.filter((issue) => issue.severity === "WARNING")} comment={submitComment} onComment={setSubmitComment} onCancel={() => setPendingSubmitDetail(null)} onSubmit={() => { const pending = pendingSubmitDetail; setPendingSubmitDetail(null); void submitNow(pending); }} /> : null}
    {confirmation ? <AccessibleConfirmDialog value={confirmation} onCancel={() => setConfirmation(null)} /> : null}
  </section>;
}

function DraftBlocked({ message, materialId, requestId }: { message: string; materialId?: number; requestId?: string }) {
  return <section className="mm-error-state" role="alert"><h2>无法编辑草稿</h2><p>{message}</p>{requestId ? <p className="mm-request-id">请求编号：{requestId}</p> : null}<div className="mm-inline-actions"><Link href="/materials">返回物料列表</Link>{materialId ? <Link href={`/materials/${materialId}`}>查看详情</Link> : null}</div></section>;
}

function BasicSelect({ id, label, value, options, disabled, issues, onChange }: { id: string; label: string; value: string; options: [string, string][]; disabled: boolean; issues: DraftIssue[]; onChange: (value: string) => void }) {
  return <label htmlFor={id}>{label} *<select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select>{issues.map((issue) => <small className="mm-field-issue" key={`${issue.source}-${issue.code}`}>{issue.severity}：{issue.message}</small>)}</label>;
}

function MaterialBasicFieldsSection({ value, sourceRef, disabled, issues, onChange }: { value: DraftForm; sourceRef: string; disabled: boolean; issues: DraftIssue[]; onChange: (field: keyof DraftForm["basic_fields"], value: string | boolean | null) => void }) {
  const basic = value.basic_fields;
  const input = (field: keyof typeof basic, label: string, required = false, type = "text") => <label htmlFor={fieldId(`basic_fields.${field}`)}>{label}{required ? " *" : ""}<input id={fieldId(`basic_fields.${field}`)} type={type} value={String(basic[field] ?? "")} disabled={disabled} onChange={(event) => onChange(field, event.target.value)} />{issues.filter((issue) => issue.field === `basic_fields.${field}`).map((issue) => <small className="mm-field-issue" key={issue.code}>{issue.severity}：{issue.message}</small>)}</label>;
  return <section className="mm-card mm-basic-fields" id="draft-section-basic"><h3>基本信息</h3><div className="mm-form-grid">{input("standard_name", "标准名称", true)}{input("unit", "基本单位", true)}{input("brand", "品牌")}{input("manufacturer", "制造商")}{input("manufacturer_part_number", "制造商型号")}
    <BasicSelect id={fieldId("basic_fields.procurement_type")} label="采购类型" value={basic.procurement_type} disabled={disabled} issues={issues.filter((issue) => issue.field === "basic_fields.procurement_type")} onChange={(v) => onChange("procurement_type", v)} options={[["PURCHASE", "采购"], ["OUTSOURCE", "外协"], ["SELF_MADE", "自制"], ["NON_PURCHASABLE", "不可采购"]]} />
    <BasicSelect id={fieldId("basic_fields.inventory_type")} label="库存类型" value={basic.inventory_type} disabled={disabled} issues={issues.filter((issue) => issue.field === "basic_fields.inventory_type")} onChange={(v) => onChange("inventory_type", v)} options={[["STOCKED", "库存"], ["NON_STOCKED", "非库存"], ["CONSIGNMENT", "寄售"]]} />
    <label htmlFor={fieldId("basic_fields.lot_control_required")}>批次控制 *<select id={fieldId("basic_fields.lot_control_required")} value={basic.lot_control_required === null ? "" : String(basic.lot_control_required)} disabled={disabled} onChange={(event) => onChange("lot_control_required", event.target.value === "" ? null : event.target.value === "true")}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>{issues.filter((issue) => issue.field === "basic_fields.lot_control_required").map((issue) => <small className="mm-field-issue" key={`${issue.source}-${issue.code}`}>{issue.severity}：{issue.message}</small>)}</label>
    {input("shelf_life_days", "保质期天数", false, "text")}
    <BasicSelect id={fieldId("basic_fields.inspection_type")} label="检验类型" value={basic.inspection_type} disabled={disabled} issues={issues.filter((issue) => issue.field === "basic_fields.inspection_type")} onChange={(v) => onChange("inspection_type", v)} options={[["NONE", "免检"], ["NORMAL", "正常"], ["TIGHTENED", "加严"], ["REDUCED", "放宽"], ["FULL", "全检"]]} />
    <BasicSelect id={fieldId("basic_fields.environmental_requirement")} label="环保要求" value={basic.environmental_requirement} disabled={disabled} issues={issues.filter((issue) => issue.field === "basic_fields.environmental_requirement")} onChange={(v) => onChange("environmental_requirement", v)} options={[["UNSPECIFIED", "未指定"], ["ROHS", "RoHS"], ["ROHS_REACH", "RoHS + REACH"], ["HALOGEN_FREE", "无卤"], ["CUSTOMER_SPECIFIC", "客户指定"]]} />
  </div>{sourceRef ? <p className="mm-source-readonly"><b>来源引用（只读）：</b> {sourceRef}</p> : null}</section>;
}

function MaterialAttributeField({ definition, entry, disabled, issues, onChange }: { definition: AttributeSchema; entry: DraftForm["attributes"][string] | undefined; disabled: boolean; issues: DraftIssue[]; onChange: (patch: Partial<DraftForm["attributes"][string]>) => void }) {
  const id = fieldId(`attributes.${definition.attribute_code}`); const value = entry?.value ?? "";
  let control: ReactNode;
  if (definition.data_type === "BOOLEAN") control = <select id={id} value={value === "" || value === null ? "" : String(value)} disabled={disabled} onChange={(event) => onChange({ value: event.target.value === "" ? null : event.target.value === "true" })}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>;
  else if (definition.data_type === "ENUM") control = <select id={id} value={String(value)} disabled={disabled} onChange={(event) => onChange({ value: event.target.value })}><option value="">请选择</option>{definition.enum_options.map((option) => <option key={option.code} value={option.code}>{option.label || option.code}</option>)}</select>;
  else control = <input id={id} inputMode={definition.data_type === "INTEGER" ? "numeric" : definition.data_type === "DECIMAL" ? "decimal" : undefined} value={String(value)} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange({ value: event.target.value })} />;
  return <label className="mm-attribute-field" htmlFor={id}><span>{definition.name}{definition.required ? " *" : ""}</span><small>{definition.attribute_code} · {definition.data_type}{definition.standard_unit ? ` · ${definition.standard_unit}` : ""}</small><span className="mm-attribute-control">{control}{definition.input_contract.unit_mode === "REQUIRED" ? <select aria-label={`${definition.name}单位`} value={entry?.unit || ""} disabled={disabled} onChange={(event) => onChange({ unit: event.target.value })}><option value="">单位</option>{definition.compatible_units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select> : null}</span>{definition.description ? <small>{definition.description}</small> : null}{issues.map((issue) => <small className="mm-field-issue" key={`${issue.source}-${issue.code}`}>{issue.severity}：{issue.message}</small>)}</label>;
}

function MaterialDynamicAttributes({ schema, value, disabled, issues, onChange }: { schema: CategorySchema | null; value: DraftForm; disabled: boolean; issues: DraftIssue[]; onChange: (code: string, patch: Partial<DraftForm["attributes"][string]>) => void }) {
  return <section className="mm-card mm-dynamic-attributes" id="draft-section-attributes"><h3>动态属性</h3>{!schema ? <p className="mm-muted">选择启用的四级叶子并成功加载当前 Schema 后显示。</p> : <div className="mm-draft-attribute-grid">{schema.attributes.filter((definition) => definition.enabled).map((definition) => <MaterialAttributeField key={definition.attribute_code} definition={definition} entry={value.attributes[definition.attribute_code]} disabled={disabled} issues={issues.filter((issue) => issue.attribute_code === definition.attribute_code || issue.field === `attributes.${definition.attribute_code}`)} onChange={(patch) => onChange(definition.attribute_code, patch)} />)}</div>}</section>;
}

function MaterialValidationSummary({ issues, onFocus }: { issues: DraftIssue[]; onFocus: (issue: DraftIssue) => void }) {
  const errors = issues.filter((issue) => issue.severity === "ERROR"); const warnings = issues.filter((issue) => issue.severity === "WARNING");
  return <section id="draft-validation" className="mm-draft-validation"><h3>Validation 摘要</h3><p><b>错误 ERROR：{errors.length}</b><b>警告 WARNING：{warnings.length}</b></p>{issues.length ? <ul>{issues.map((issue, index) => <li key={`${issue.source}-${issue.code}-${index}`}><button onClick={() => onFocus(issue)}><span>{issue.source === "LOCAL" ? "本地检查" : "服务端校验"} · {issue.severity}</span><b>{issue.code}</b><small>{issue.message}</small></button></li>)}</ul> : <p className="mm-muted">暂无问题。服务端仍是最终校验边界。</p>}</section>;
}

function VersionConflict({ local, server, onDiscard }: { local: DraftForm; server: Detail; onDiscard: () => void }) {
  const serverDraft = draftFromDetail(server);
  return <section className="mm-version-conflict" role="alert"><h3>草稿已被其他用户修改</h3><p>本地编辑基于旧版本，服务器当前为 V{String(server.material.current_version)}。未覆盖任何服务器内容。</p><div><dl><dt>本地标准名称</dt><dd>{local.basic_fields.standard_name || "—"}</dd><dt>本地分类</dt><dd>{local.category_id || "—"}</dd></dl><dl><dt>服务器标准名称</dt><dd>{serverDraft.basic_fields.standard_name || "—"}</dd><dt>服务器分类</dt><dd>{serverDraft.category_id || "—"}</dd></dl></div><button className="danger" onClick={onDiscard}>放弃本地修改并使用服务器版本</button></section>;
}
