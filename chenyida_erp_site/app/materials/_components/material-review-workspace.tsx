"use client";

import Link from "next/link";
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { createWriteOperation, retryAfterSeconds } from "../_lib/material-draft";
import {
  reviewCapabilities, reviewComment as normalizeReviewComment, reviewReason, reviewResponsibility,
  reviewValidationFingerprint, safeReviewReturnTo, type ReviewWriteOperation,
} from "../_lib/material-review";
import { sourceLabel } from "../_lib/material-ui";
import {
  MaterialAttributesCard, MaterialBasicCard, MaterialLastRejectionCard,
  MaterialRecentChangesCard, MaterialRecentVersionsCard, MaterialResponsibilitiesCard,
  MaterialValidationPanel, materialAttributeTargetId, type MaterialDetail, type MaterialIssue,
} from "./material-detail-sections";
import { redirectToExistingLogin, useMaterialSession } from "./material-shell";
import { MaterialErrorState, MaterialStatusBadge } from "./material-primitives";

type UiError = { status?: number; code?: string; requestId?: string };
type ConflictState = { previousVersion: number; currentVersion: number; message: string } | null;
type DialogShellProps = {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  initialFocus?: "cancel" | "first";
  busy?: boolean;
  actions: ReactNode;
};

function DialogShell({ title, children, onCancel, initialFocus = "cancel", busy, actions }: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (initialFocus === "cancel") cancelRef.current?.focus();
    else dialogRef.current?.querySelector<HTMLElement>("textarea,input,button")?.focus();
    return () => trigger?.focus();
  }, [initialFocus]);
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button,input,textarea,[href]") || [])].filter((item) => !item.hasAttribute("disabled"));
    if (!controls.length) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="mm-modal-backdrop"><div className="mm-modal" role="dialog" aria-modal="true" aria-labelledby="material-review-dialog-title" ref={dialogRef} onKeyDown={trap}><h2 id="material-review-dialog-title">{title}</h2><div className="mm-modal-body">{children}</div><div className="mm-modal-actions"><button ref={cancelRef} disabled={busy} onClick={onCancel}>返回复核</button>{actions}</div></div></div>;
}

function responsibilityMessage(value: { created: boolean; lastEditor: boolean }): string {
  if (value.created && value.lastEditor) return "你既是该物料的创建人，也是当前版本最后修改人，不能审核该物料。";
  if (value.created) return "创建人不能审核自己创建的物料。";
  if (value.lastEditor) return "当前版本最后修改人不能审核该版本。";
  return "当前用户未命中创建人或最后修改人禁审规则。";
}

function asUiError(reason: unknown): UiError { return reason instanceof ErpApiError ? reason : {}; }

export function MaterialReviewWorkspace({ materialId }: { materialId: number }) {
  const session = useMaterialSession();
  const capabilities = useMemo(() => reviewCapabilities(session.user?.permissions || []), [session.user?.permissions]);
  const username = session.user?.username || "";
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [loading, setLoading] = useState(capabilities.queue);
  const [error, setError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState("");
  const [warningConfirmed, setWarningConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionsClosed, setActionsClosed] = useState(false);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const [activeOperation, setActiveOperation] = useState<ReviewWriteOperation | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const returnTo = useMemo(() => typeof window === "undefined" ? "/materials/review?page=1&page_size=20&sort=submitted_at_desc" : safeReviewReturnTo(new URLSearchParams(window.location.search).get("return_to")), []);
  const loadSequenceRef = useRef(0);
  const shownFingerprintRef = useRef("");
  const approveConfirmationRef = useRef<{ fingerprint: string; loadSequence: number } | null>(null);
  const allowNavigationRef = useRef(false);
  const approveOperationRef = useRef<ReviewWriteOperation | null>(null);
  const rejectOperationRef = useRef<ReviewWriteOperation | null>(null);
  const inflightRef = useRef<Promise<{ data: Record<string, unknown> } | null> | null>(null);

  const responsibilities = useMemo(() => detail ? reviewResponsibility(username, detail.material.created_by, detail.material.last_modified_by) : { created: false, lastEditor: false }, [detail, username]);
  const responsibilityBlocked = responsibilities.created || responsibilities.lastEditor;
  const hasErrors = Boolean(detail?.validation.errors?.length);
  const dirty = reviewComment.length > 0 || rejectReason.length > 0;
  const resultUnknown = activeOperation?.state === "RESULT_UNKNOWN";

  const applyDetail = useCallback((loaded: MaterialDetail) => {
    loadSequenceRef.current += 1;
    setDetail(loaded);
    shownFingerprintRef.current = reviewValidationFingerprint(materialId, Number(loaded.material.current_version), loaded.validation);
    approveConfirmationRef.current = null;
    setApproveOpen(false); setWarningConfirmed(false); setConflict(null);
    if (loaded.material.material_status !== "PENDING_REVIEW") setActionsClosed(true);
    document.title = `${loaded.material.standard_name} - 物料审核 - 晨亿达 ERP`;
  }, [materialId]);

  const readLatest = useCallback(async (signal?: AbortSignal) => {
    const response = await api<{ data: MaterialDetail }>(`/api/material-master/materials/${materialId}`, { signal });
    return response.data;
  }, [materialId]);

  const loadDetail = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try { applyDetail(await readLatest(signal)); }
    catch (reason) {
      if ((reason as { name?: string })?.name === "AbortError") return;
      if (reason instanceof ErpApiError && reason.status === 401) { redirectToExistingLogin(); return; }
      setError(asUiError(reason));
    } finally { setLoading(false); }
  }, [applyDetail, readLatest]);

  useEffect(() => {
    if (!capabilities.queue) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadDetail(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [capabilities.queue, loadDetail]);

  useEffect(() => {
    if (!dirty && !resultUnknown) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, resultUnknown]);

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setInterval(() => setRetryIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryIn]);

  const focusIssue = (issue: MaterialIssue) => {
    if (!issue.attribute_code) return;
    const target = document.getElementById(materialAttributeTargetId(issue.attribute_code));
    target?.scrollIntoView({ behavior: "smooth", block: "center" }); target?.focus();
  };

  const refreshAfterConflict = async (message: string) => {
    try {
      const latest = await readLatest();
      const previousVersion = Number(detail?.material.current_version || 0);
      applyDetail(latest);
      setConflict({ previousVersion, currentVersion: Number(latest.material.current_version), message });
      if (latest.material.material_status !== "PENDING_REVIEW") setActionsClosed(true);
    } catch (reason) { setNotice(`${message}，且暂时无法读取最新详情`); setRequestId(reason instanceof ErpApiError ? reason.requestId : ""); }
  };

  const prepareLatest = async (kind: "APPROVE" | "REJECT") => {
    if (!detail || busy || resultUnknown || retryIn > 0) return null;
    setBusy(true); setNotice(""); setRequestId("");
    const previousVersion = Number(detail.material.current_version);
    const previousFingerprint = shownFingerprintRef.current;
    try {
      const latest = await readLatest();
      const latestFingerprint = reviewValidationFingerprint(materialId, Number(latest.material.current_version), latest.validation);
      const latestResponsibility = reviewResponsibility(username, latest.material.created_by, latest.material.last_modified_by);
      applyDetail(latest);
      if (latest.material.material_status !== "PENDING_REVIEW") { setNotice("当前物料已不再处于待审核状态，审核动作已关闭。"); setActionsClosed(true); return null; }
      if (latestResponsibility.created || latestResponsibility.lastEditor) { setNotice(responsibilityMessage(latestResponsibility)); setActionsClosed(true); return null; }
      if (previousVersion !== Number(latest.material.current_version) || previousFingerprint !== latestFingerprint) {
        setConflict({ previousVersion, currentVersion: Number(latest.material.current_version), message: "物料版本或当前 Validation 已变化，旧确认已失效。请重新检查完整内容。" });
        return null;
      }
      if (kind === "APPROVE" && latest.validation.errors.length) { setNotice("当前 Validation 存在 ERROR，不能批准；可按权限驳回修改。"); return null; }
      return latest;
    } catch (reason) {
      if (reason instanceof ErpApiError && reason.status === 401) { setNotice("登录状态已失效；重新登录会离开并丢失当前页面内存意见。"); return null; }
      if (reason instanceof ErpApiError && reason.status === 403) { setError(asUiError(reason)); setDetail(null); setActionsClosed(true); return null; }
      setNotice(reason instanceof ErpApiError && reason.status >= 500 ? "系统暂时无法重新加载最新详情" : "网络连接失败，未发起审核写操作");
      setRequestId(reason instanceof ErpApiError ? reason.requestId : "");
      return null;
    } finally { setBusy(false); }
  };

  const prepareApprove = async () => {
    const comment = normalizeReviewComment(reviewComment);
    if (comment.error) { setNotice(comment.error); return; }
    const latest = await prepareLatest("APPROVE");
    if (!latest) return;
    approveConfirmationRef.current = {
      fingerprint: reviewValidationFingerprint(materialId, Number(latest.material.current_version), latest.validation),
      loadSequence: loadSequenceRef.current,
    };
    setWarningConfirmed(false); setApproveOpen(true);
  };

  const returnWithResult = (result: { kind: "approve" | "reject"; message: string }) => {
    allowNavigationRef.current = true;
    window.history.pushState({ ...(window.history.state || {}), materialReviewResult: result }, "", returnTo);
    window.location.reload();
  };

  const handleWriteFailure = async (reason: unknown, operation: ReviewWriteOperation) => {
    if (!(reason instanceof ErpApiError)) { setNotice("系统暂时无法完成审核操作"); return; }
    setRequestId(reason.requestId);
    if (reason.code === "NETWORK_ERROR") {
      const unknown = { ...operation, state: "RESULT_UNKNOWN" as const };
      if (operation.type === "APPROVE") approveOperationRef.current = unknown; else rejectOperationRef.current = unknown;
      setActiveOperation(unknown); setNotice("网络连接中断，审核结果待确认；只能使用原请求安全重试，不能执行相反操作。"); return;
    }
    if (reason.code === "IDEMPOTENCY_IN_PROGRESS") {
      const unknown = { ...operation, state: "RESULT_UNKNOWN" as const };
      if (operation.type === "APPROVE") approveOperationRef.current = unknown; else rejectOperationRef.current = unknown;
      setActiveOperation(unknown); setRetryIn(retryAfterSeconds(reason.retryAfter)); setNotice("相同审核请求仍在处理中；到期后只能使用原请求安全重试。"); return;
    }
    const failed = { ...operation, state: "FAILED" as const };
    if (operation.type === "APPROVE") approveOperationRef.current = failed; else rejectOperationRef.current = failed;
    setActiveOperation(failed);
    if (reason.status === 401) { setNotice("登录状态已失效；当前意见仍在本页内存，系统不会自动重放写请求。"); return; }
    if (reason.code === "SELF_REVIEW_FORBIDDEN") { setNotice("创建人不能审核自己创建的物料。"); setActionsClosed(true); await refreshAfterConflict("服务端职责分离检查已拒绝本次审核"); return; }
    if (reason.code === "LAST_EDITOR_REVIEW_FORBIDDEN") { setNotice("当前版本最后修改人不能审核该版本。"); setActionsClosed(true); await refreshAfterConflict("服务端职责分离检查已拒绝本次审核"); return; }
    if (reason.status === 403) { setError(asUiError(reason)); setDetail(null); setActionsClosed(true); return; }
    if (reason.status === 404) { setError(asUiError(reason)); setDetail(null); setActionsClosed(true); return; }
    if (reason.code === "VERSION_CONFLICT") { await refreshAfterConflict("物料版本已变化；未自动重试旧版本，已保留页面内存中的意见"); return; }
    if (["MATERIAL_NOT_REVIEWABLE", "INVALID_MATERIAL_STATE"].includes(reason.code)) { await refreshAfterConflict("当前物料状态已变化，审核动作已关闭"); setActionsClosed(true); return; }
    if (reason.status === 422 || reason.code === "MATERIAL_VALIDATION_FAILED") { await refreshAfterConflict("批准未完成；当前 Validation 已变化，旧确认已失效"); return; }
    if (reason.code === "IDEMPOTENCY_CONFLICT") { setNotice("幂等载荷冲突；系统没有自动更换 Key。请重新核对当前内容并重新发起实质操作。"); return; }
    if (reason.status === 429) { const seconds = retryAfterSeconds(reason.retryAfter); setRetryIn(seconds); setNotice(`审核请求过于频繁，请在 ${seconds} 秒后主动重试。`); return; }
    setNotice(reason.status >= 500 ? "系统暂时无法处理当前审核请求" : reason.message);
  };

  const performReview = async (kind: "APPROVE" | "REJECT", payload: Record<string, unknown>, existing?: ReviewWriteOperation) => {
    if (inflightRef.current) return inflightRef.current;
    const endpoint = `/api/material-master/drafts/${materialId}/${kind === "APPROVE" ? "approve" : "reject"}`;
    const created = existing || createWriteOperation({ key: crypto.randomUUID(), method: "POST", endpoint, payload, type: kind }) as ReviewWriteOperation;
    const pending = { ...created, state: "PENDING" as const };
    if (kind === "APPROVE") approveOperationRef.current = pending; else rejectOperationRef.current = pending;
    setActiveOperation(pending); setBusy(true); setNotice(""); setRequestId("");
    const request = api<{ data: Record<string, unknown> }>(endpoint, {
      method: "POST", body: JSON.stringify(pending.payload),
      protectedWrite: { idempotencyKey: pending.key, csrfToken: session.csrf_token || "" },
    }).then(async (response) => {
      const succeeded = { ...pending, state: "SUCCEEDED" as const };
      if (kind === "APPROVE") approveOperationRef.current = succeeded; else rejectOperationRef.current = succeeded;
      setActiveOperation(succeeded); setActionsClosed(true); setApproveOpen(false); setRejectOpen(false);
      const latest = await readLatest().catch(() => null);
      if (latest) applyDetail(latest);
      if (kind === "APPROVE") {
        const code = String(response.data.internal_material_code || latest?.material.material_code || "");
        if (!latest || latest.material.material_status !== "ACTIVE" || !code) { setNotice("审核已返回成功，但暂时无法确认最新 ACTIVE 详情；审核动作保持关闭。"); return response; }
        setReviewComment(""); returnWithResult({ kind: "approve", message: `审核通过，正式物料编码：${code}` });
      } else {
        if (!latest || latest.material.material_status !== "DRAFT" || !latest.last_rejection) { setNotice("驳回已返回成功，但暂时无法确认最新 DRAFT 与驳回历史；审核动作保持关闭。"); return response; }
        setRejectReason(""); returnWithResult({ kind: "reject", message: "已驳回为草稿，创建或编辑人员可以重新修改并提交。" });
      }
      return response;
    }).catch(async (reason) => { await handleWriteFailure(reason, pending); return null; }).finally(() => { setBusy(false); inflightRef.current = null; });
    inflightRef.current = request;
    return request;
  };

  const confirmApprove = async () => {
    if (!detail || detail.validation.errors.length || (detail.validation.warnings.length && !warningConfirmed)) return;
    const confirmation = approveConfirmationRef.current;
    const currentFingerprint = reviewValidationFingerprint(materialId, Number(detail.material.current_version), detail.validation);
    if (!confirmation || confirmation.loadSequence !== loadSequenceRef.current || confirmation.fingerprint !== currentFingerprint) {
      setApproveOpen(false); setWarningConfirmed(false);
      setNotice("当前详情加载或 Validation 已变化，旧确认已失效；请重新复核后再批准。");
      return;
    }
    const comment = normalizeReviewComment(reviewComment);
    if (comment.error) { setNotice(comment.error); setApproveOpen(false); return; }
    const payload = { expected_version: Number(detail.material.current_version), ...(comment.value ? { review_comment: comment.value } : {}) };
    await performReview("APPROVE", payload);
  };

  const confirmReject = async () => {
    const reason = reviewReason(rejectReason); setRejectError(reason.error);
    if (reason.error) return;
    const latest = await prepareLatest("REJECT");
    if (!latest) { setRejectOpen(false); return; }
    const payload = { expected_version: Number(latest.material.current_version), reason: reason.value };
    await performReview("REJECT", payload);
  };

  const retryUnknown = async () => {
    const operation = activeOperation;
    if (!operation || operation.state !== "RESULT_UNKNOWN" || retryIn > 0) return;
    await performReview(operation.type, operation.payload as Record<string, unknown>, operation);
  };

  const navigateSafely = (href: string) => {
    if (!dirty && !resultUnknown) { window.location.assign(href); return; }
    setLeaveTarget(href);
  };

  if (!capabilities.queue) return <MaterialErrorState error={{ status: 403, code: "FORBIDDEN" }} />;
  if (loading && !detail) return <section className="mm-detail-loading" role="status">正在加载最新物料详情与当前 Validation…</section>;
  if (error || !detail) return <MaterialErrorState error={error} onRetry={error?.status === 404 ? undefined : () => loadDetail()} />;

  const returnParam = `return_to=${encodeURIComponent(returnTo)}`;
  const categoryPath = detail.category_path.map((node) => node.category_name).join(" / ");
  const reviewable = detail.material.material_status === "PENDING_REVIEW" && !actionsClosed && !responsibilityBlocked && !resultUnknown;
  const approveAllowed = reviewable && capabilities.approve && !hasErrors && retryIn === 0;
  const rejectAllowed = reviewable && capabilities.reject && retryIn === 0;

  return <section className="mm-page mm-review-workspace" aria-busy={busy}>
    <nav className="mm-breadcrumb" aria-label="面包屑"><Link href="/materials">物料主数据</Link><span>/</span><button className="mm-breadcrumb-button" onClick={() => navigateSafely(returnTo)}>审核队列</button><span>/</span><span>{detail.material.standard_name}</span></nav>
    <header className="mm-detail-head mm-review-head"><div><button className="mm-back-link mm-link-button" onClick={() => navigateSafely(returnTo)}>← 返回审核队列</button><div className="mm-detail-title"><h2>{detail.material.standard_name}</h2><MaterialStatusBadge value={detail.material.material_status} /></div><p>{detail.material.material_code || "尚无正式编码"} · V{detail.material.current_version} · {sourceLabel(detail.material.source_type)} · {categoryPath || "—"}</p></div><Link href={`/materials/${materialId}?return_to=${encodeURIComponent(returnTo)}`}>查看只读详情</Link></header>
    {notice ? <div className="mm-review-notice" role="status" aria-live="polite"><strong>{notice}</strong>{requestId ? <span>请求编号：{requestId}</span> : null}{resultUnknown ? <button disabled={retryIn > 0 || busy} onClick={() => void retryUnknown()}>{retryIn > 0 ? `${retryIn} 秒后可安全重试` : "使用原请求安全重试"}</button> : null}</div> : null}
    {conflict ? <section className="mm-version-conflict" role="alert"><h3>物料已发生变化</h3><p>{conflict.message}</p><p>本次复核原版本：V{conflict.previousVersion || "—"}；服务器当前：V{conflict.currentVersion || "—"}。已输入意见保留在页面内存，但不会自动提交。</p><button onClick={() => { setConflict(null); setNotice("请重新检查完整内容与当前 Validation 后再发起审核。"); }}>我已了解，重新复核</button></section> : null}
    {detail.material.material_status !== "PENDING_REVIEW" ? <section className="mm-review-state-closed" role="status"><h3>当前物料已不再处于待审核状态</h3><p>审核动作已关闭；页面不会披露其他审核人的敏感操作细节。</p><div><button onClick={() => navigateSafely(returnTo)}>返回审核队列</button><Link href={`/materials/${materialId}?return_to=${encodeURIComponent(returnTo)}`}>查看只读详情</Link></div></section> : null}

    <div className="mm-review-layout">
      <main className="mm-review-main">
        <MaterialBasicCard detail={detail} />
        <MaterialResponsibilitiesCard detail={detail} />
        <MaterialAttributesCard detail={detail} />
        <MaterialLastRejectionCard detail={detail} />
        <div className="mm-review-history-grid"><MaterialRecentVersionsCard detail={detail} materialId={materialId} returnParam={returnParam} /><MaterialRecentChangesCard detail={detail} materialId={materialId} returnParam={returnParam} /></div>
      </main>
      <aside className="mm-review-aside">
        <MaterialValidationPanel validation={detail.validation} onFocusIssue={focusIssue} heading="当前 Validation" />
        <section className={`mm-card mm-review-responsibility ${responsibilityBlocked ? "blocked" : ""}`}><h3>职责分离</h3><p>{responsibilityMessage(responsibilities)}</p>{responsibilityBlocked ? <small>当前页面仅供只读复核；批准和驳回均已关闭。无管理员例外。</small> : <small>提交人 submitted_by 本身不单独禁止审核；服务端继续最终校验。</small>}</section>
        <section className="mm-card mm-review-actions"><h3>审核操作</h3>
          {!capabilities.approve && !capabilities.reject ? <p>当前账号没有批准或驳回权限，仍可只读查看。</p> : <>
            {capabilities.approve ? <label>审核意见（可选）<textarea maxLength={1000} disabled={busy || resultUnknown || actionsClosed} value={reviewComment} onChange={(event) => { setReviewComment(event.target.value); if (approveOperationRef.current?.state === "FAILED") approveOperationRef.current = null; }} /><small>{reviewComment.length} / 1000</small></label> : null}
            {hasErrors ? <p className="mm-review-block-message">当前 Validation 存在 ERROR，不能批准，需要驳回修改。</p> : null}
            <div className="mm-review-action-buttons">{capabilities.reject ? <button className="danger" disabled={!rejectAllowed || busy} onClick={() => { setRejectError(""); setRejectOpen(true); }}>驳回修改</button> : null}{capabilities.approve ? <button className="primary" disabled={!approveAllowed || busy} onClick={() => void prepareApprove()}>审核通过</button> : null}</div>
          </>}
        </section>
      </aside>
    </div>

    {approveOpen ? <DialogShell title={detail.validation.warnings.length ? "确认警告并审核通过？" : "确认审核通过？"} onCancel={() => { if (!busy) setApproveOpen(false); }} busy={busy} actions={<button className="primary" disabled={busy || Boolean(detail.validation.warnings.length && !warningConfirmed)} onClick={() => void confirmApprove()}>确认审核通过</button>}>
      <p>物料：{detail.material.standard_name}</p><p>当前版本：V{detail.material.current_version}</p><p>Validation：{detail.validation.errors.length} 个错误，{detail.validation.warnings.length} 个警告</p><p>审核意见：{reviewComment.trim() || "—"}</p>
      {detail.validation.warnings.length ? <><ul>{detail.validation.warnings.map((issue, index) => <li key={`${issue.code}-${index}`}><b>警告 WARNING · {issue.code}</b><br />{issue.message}</li>)}</ul><label className="mm-warning-confirm"><input type="checkbox" checked={warningConfirmed} onChange={(event) => setWarningConfirmed(event.target.checked)} />我已核对当前版本和当前 Validation</label><small>此确认只绑定当前 material_id、版本、本次 Validation 摘要和本次详情加载；服务端仍会最终重校验。</small></> : null}
      <p>审核通过后将生成唯一正式物料编码并转为 ACTIVE。</p>
    </DialogShell> : null}

    {rejectOpen ? <DialogShell title="驳回物料修改" initialFocus="first" onCancel={() => { if (!busy) setRejectOpen(false); }} busy={busy} actions={<button className="danger" disabled={busy} onClick={() => void confirmReject()}>确认驳回修改</button>}>
      <p>物料：{detail.material.standard_name}</p><p>当前版本：V{detail.material.current_version}</p><label>驳回原因 *<textarea maxLength={1000} aria-describedby="review-reason-count review-reason-error" value={rejectReason} onChange={(event) => { setRejectReason(event.target.value); setRejectError(""); if (rejectOperationRef.current?.state === "FAILED") rejectOperationRef.current = null; }} /></label><p id="review-reason-count">{rejectReason.length} / 1000</p>{rejectError ? <p id="review-reason-error" className="mm-field-issue" role="alert">{rejectError}</p> : null}<p>驳回后状态回到 DRAFT；创建或编辑人员可以重新修改和提交。</p>{reviewComment ? <p>已输入的批准意见仍保留在页面内存，不会作为驳回原因。</p> : null}
    </DialogShell> : null}

    {leaveTarget ? <DialogShell title="离开物料审核页？" onCancel={() => setLeaveTarget("")} actions={<button className="danger" onClick={() => { allowNavigationRef.current = true; window.location.assign(leaveTarget); }}>放弃意见并离开</button>}><p>{resultUnknown ? "审核结果仍待确认，离开后可能无法判断本次操作结果。" : "当前有尚未发送的审核意见或驳回原因，离开后这些内容会丢失。"}</p><p>本页面不会把意见保存到浏览器存储。</p></DialogShell> : null}
  </section>;
}
