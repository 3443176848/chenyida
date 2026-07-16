"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { importStatusLabel, type MaterialImportBatchStatus, type MaterialImportView } from "../_lib/material-import";

export function MaterialImportStatusBadge({ value }: { value: MaterialImportBatchStatus | string }) {
  const code = String(value || "UNKNOWN");
  return <span className={`mi-status mi-status-${code.toLowerCase().replaceAll("_", "-")}`} aria-label={`导入批次状态：${importStatusLabel(code)}`}>{importStatusLabel(code)}</span>;
}

const STEPS: { view: MaterialImportView; label: string }[] = [
  { view: "file", label: "文件" }, { view: "parse", label: "解析" }, { view: "sheet", label: "Sheet 与表头" },
  { view: "mapping", label: "字段 Mapping" }, { view: "confirmed", label: "Mapping 确认" },
];

function currentStep(status: MaterialImportBatchStatus): number {
  if (["CREATED", "UPLOAD_PENDING"].includes(status)) return 0;
  if (["FILE_READY", "QUEUED_FOR_PARSING", "PARSING"].includes(status)) return 1;
  if (status === "PARSED") return 2;
  if (status === "AWAITING_MAPPING") return 3;
  if (status === "MAPPING_CONFIRMED") return 4;
  return Math.max(0, ["FILE_STORAGE", "FILE_SECURITY", "PARSER"].indexOf(status));
}

export function MaterialImportStepper({ status, view, canMap, onView }: {
  status: MaterialImportBatchStatus; view: MaterialImportView; canMap: boolean; onView: (view: MaterialImportView) => void;
}) {
  const current = currentStep(status);
  const terminalFailure = ["FAILED", "CANCELLED", "RECONCILIATION_REQUIRED"].includes(status);
  return <ol className="mi-stepper" aria-label="导入进度">
    {STEPS.map((step, index) => {
      const complete = !terminalFailure && index < current; const selected = step.view === view;
      const readable = index <= current || (status === "MAPPING_CONFIRMED" && ["sheet", "mapping", "confirmed"].includes(step.view));
      const locked = !readable || (step.view === "mapping" && !canMap && status !== "MAPPING_CONFIRMED");
      return <li key={step.view} className={`${complete ? "complete" : ""} ${selected ? "current" : ""} ${locked ? "locked" : ""} ${terminalFailure && index === current ? "failed" : ""}`} aria-current={selected ? "step" : undefined}>
        <button type="button" disabled={locked} onClick={() => onView(step.view)} aria-label={`${step.label}：${complete ? "已完成" : selected ? "当前步骤" : locked ? "尚未开放" : "只读可查看"}`}>
          <span aria-hidden="true">{complete ? "✓" : terminalFailure && index === current ? "!" : index + 1}</span>{step.label}
        </button>
      </li>;
    })}
  </ol>;
}

export function MaterialImportErrorState({ title = "无法加载导入数据", message, requestId, onRetry, clearProtected = false }: {
  title?: string; message: string; requestId?: string; onRetry?: () => void; clearProtected?: boolean;
}) {
  return <section className="mm-error-state mi-error-state" role="alert" aria-live="assertive">
    <h2>{title}</h2><p>{message}</p>{requestId ? <p className="mm-request-id">请求编号：{requestId}</p> : null}
    {clearProtected ? <p>已清除当前页面中的批次、Rows、Mapping 与写操作内容。</p> : null}
    <div className="mm-inline-actions">{onRetry ? <button onClick={onRetry}>重试</button> : null}<Link href="/materials/imports">返回导入批次</Link></div>
  </section>;
}

export function MaterialImportDialog({ title, children, busy = false, primaryLabel, danger = false, onPrimary, onClose }: {
  title: string; children: ReactNode; busy?: boolean; primaryLabel: string; danger?: boolean; onPrimary: () => void; onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null); const dialogRef = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    trigger.current = document.activeElement as HTMLElement; cancelRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]")];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); trigger.current?.focus(); };
  }, [busy, onClose]);
  return <div className="mm-modal-backdrop" role="presentation"><div className="mm-modal" role="dialog" aria-modal="true" aria-labelledby="mi-dialog-title" ref={dialogRef}>
    <h2 id="mi-dialog-title">{title}</h2><div className="mm-modal-body">{children}</div>
    <div className="mm-modal-actions"><button ref={cancelRef} disabled={busy} onClick={onClose}>返回</button><button className={danger ? "danger" : "primary"} disabled={busy} onClick={onPrimary}>{busy ? "正在处理…" : primaryLabel}</button></div>
  </div></div>;
}

export function useMaterialImportUnsavedGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return;
      if (!window.confirm("当前文件、未保存 Mapping 或结果未知状态只保存在本页。确定离开吗？")) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [active]);
}

export function MaterialImportCursorNavigation({ total, hasMore, disabled, onNext }: { total: number; hasMore: boolean; disabled: boolean; onNext: () => void }) {
  return <nav className="mi-cursor-nav" aria-label="导入批次结果导航"><span>当前条件共 {total} 条；本页仅显示当前服务端结果批次</span><button disabled={disabled || !hasMore} onClick={onNext}>下一批</button></nav>;
}
