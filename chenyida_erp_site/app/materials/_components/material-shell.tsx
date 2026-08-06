"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, ErpApiError, isHistorySessionRestore, safeMaterialReturnTo, setProtectedViewState, suspendProtectedViews } from "../../../public/erp/api-client.js";

export type SessionUser = { username?: string; display_name?: string; role?: string; role_label?: string; permissions?: string[] };
export type MaterialSession = { authenticated: boolean; setup_required?: boolean; user?: SessionUser | null; csrf_token?: string };

const MaterialSessionContext = createContext<MaterialSession | null>(null);

export function useMaterialSession(): MaterialSession {
  const value = useContext(MaterialSessionContext);
  if (!value) throw new Error("Material 页面必须位于 MaterialShell 内");
  return value;
}

export function currentMaterialLocation(): string {
  return safeMaterialReturnTo(`${window.location.pathname}${window.location.search}`);
}

export function redirectToExistingLogin(): void {
  const returnTo = encodeURIComponent(currentMaterialLocation());
  window.location.replace(`/?return_to=${returnTo}`);
}

export function MaterialShell({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MaterialSession | null>(null);
  const [error, setError] = useState("");

  const verifySession = useCallback(async () => {
    suspendProtectedViews();
    setSession(null);
    setError("");
    try {
      const result = await api<MaterialSession>("/api/session");
      if (!result.authenticated || result.setup_required) {
        setProtectedViewState("anonymous");
        redirectToExistingLogin();
        return;
      }
      setSession(result);
      window.requestAnimationFrame(() => setProtectedViewState("authenticated"));
    } catch (reason: unknown) {
      setProtectedViewState("anonymous");
      if (reason instanceof ErpApiError && reason.status === 401) redirectToExistingLogin();
      else setError("系统暂时无法验证登录状态，请稍后重试");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const onPageHide = () => suspendProtectedViews();
    const onPageShow = (event: PageTransitionEvent) => { if (active && isHistorySessionRestore(event)) void verifySession(); };
    const timer = window.setTimeout(() => { if (active) void verifySession(); }, 0);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [verifySession]);

  const user = session?.user;
  return (
    <div className="mm-app-shell" data-cyd-protected-view={session ? "" : undefined}>
      <header className="mm-topbar">
        <div className="mm-topbar-brand"><span className="mm-brand-mark" aria-hidden="true">CY</span><div><h1>晨亿达 ERP</h1><p>物料主数据工作区</p></div></div>
        <div className="mm-topbar-actions">
          {user ? <span className="mm-user"><b>{user.display_name || user.username || "当前用户"}</b><small>{user.role_label || user.role || "已登录"}</small></span> : null}
          <Link href="/" className="mm-ghost-link">返回 ERP</Link>
        </div>
      </header>
      <div className="mm-layout">
        <nav className="mm-sidebar" aria-label="主导航">
          <span className="mm-nav-section mm-nav-section-first">工作门户</span>
          <Link href="/" className="mm-nav">ERP 总览</Link>
          <Link href="/materials" className="mm-nav active" aria-current="page">物料主数据</Link>
          <Link href="/materials" className="mm-nav mm-nav-child">物料列表</Link>
          {session?.user?.permissions?.includes("material.import.read") ? <Link href="/materials/imports" className="mm-nav mm-nav-child">物料导入</Link> : null}
          {session?.user?.permissions?.includes("material.review.queue") ? <Link href="/materials/review" className="mm-nav mm-nav-child">审核队列</Link> : null}
          <span className="mm-nav-section">业务协同</span>
          <Link href="/" className="mm-nav">客户与供应商</Link>
          <Link href="/" className="mm-nav">产品与 BOM</Link>
          <Link href="/" className="mm-nav">采购与库存</Link>
          <Link href="/" className="mm-nav">生产协同</Link>
          <Link href="/" className="mm-nav">品质管理</Link>
        </nav>
        <main className="mm-content">
          {error ? <div className="mm-error-state" role="alert"><h2>登录状态验证失败</h2><p>{error}</p><button onClick={() => window.location.reload()}>重试</button></div> : null}
          {!session && !error ? <div className="mm-shell-loading" role="status">正在验证登录状态…</div> : null}
          {session ? <MaterialSessionContext.Provider value={session}>{children}</MaterialSessionContext.Provider> : null}
        </main>
      </div>
    </div>
  );
}
