export class ErpApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ErpApiError";
    this.status = options.status || 0;
    this.code = options.code || "NETWORK_ERROR";
    this.requestId = options.requestId || "";
    this.details = Array.isArray(options.details) ? options.details : [];
    this.retryAfter = options.retryAfter || "";
    this.httpStatus = options.httpStatus || this.status;
    this.resultUnknown = options.resultUnknown === true;
  }
}

export function isHistorySessionRestore(event, navigationEntry) {
  let entry = navigationEntry;
  if (entry === undefined && typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
    entry = performance.getEntriesByType("navigation")[0];
  }
  return event?.persisted === true || entry?.type === "back_forward";
}

export function setProtectedViewState(state) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.cydAuthState = state;
}

export function suspendProtectedViews() {
  setProtectedViewState("checking");
}

function errorBody(data) {
  if (data && typeof data === "object" && data.error && typeof data.error === "object") {
    return {
      code: String(data.error.code || "INTERNAL_ERROR"),
      message: String(data.error.message || "请求失败"),
      requestId: String(data.error.request_id || data.request_id || ""),
      details: Array.isArray(data.error.details) ? data.error.details : [],
    };
  }
  return {
    code: "REQUEST_FAILED",
    message: typeof data?.error === "string" ? data.error : typeof data === "string" && data ? data : "请求失败",
    requestId: String(data?.request_id || ""),
    details: [],
  };
}

export async function api(path, options = {}) {
  const { protectedWrite, ...requestOptions } = options;
  const method = String(options.method || "GET").toUpperCase();
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  headers["X-Request-Id"] ||= crypto.randomUUID();
  const materialWrite = path.startsWith("/api/material-master/") && (["POST", "PATCH"].includes(method) || method === "PUT");
  const identityWrite = ["/api/me/password", "/api/users", "/api/users/status", "/api/users/reset-password"].includes(path) && method === "POST";
  const masterDataWrite = (["/api/customers", "/api/suppliers", "/api/products", "/api/mappings", "/api/boms", "/api/bom-lines"].includes(path)
    || /^\/api\/(customers|suppliers|products|mappings|boms)\/[1-9]\d*\//.test(path)) && ["POST", "PATCH"].includes(method);
  const procurementWrite = (path === "/api/purchase-orders" || path === "/api/purchase-orders/from-shortage" || path === "/api/purchase-receipts" || path === "/api/purchase-receive"
    || /^\/api\/(purchase-orders|purchase-receipts)\/[1-9]\d*\/(close|reversal)$/.test(path) || /^\/api\/purchase-orders\/[1-9]\d*$/.test(path)) && ["POST", "PATCH"].includes(method);
  const productionWrite = (path === "/api/work-orders" || path === "/api/work-orders/from-bom" || path === "/api/work-orders/issue-materials" || path === "/api/work-orders/complete"
    || ["/api/production/material-issues", "/api/production/material-returns", "/api/production/reports", "/api/production/completions"].includes(path)
    || /^\/api\/work-orders\/[1-9]\d*(?:\/(?:release|close|cancel))?$/.test(path)
    || /^\/api\/production\/(?:reports|completions)\/[1-9]\d*\/reverse$/.test(path)
    || path === "/api/production/operation-execution/dispatch"
    || /^\/api\/production\/operation-runs\/[1-9]\d*\/(?:start|reports|cancel|reverse)$/.test(path)) && ["POST", "PATCH"].includes(method);
  const qualityWrite = (path === "/api/quality-inspections" || path === "/api/quality/finished-goods-allocations" || /^\/api\/quality-inspections\/[1-9]\d*\/(?:defects|dispositions|close|reopen)$/.test(path) || /^\/api\/quality\/finished-goods-allocations\/[1-9]\d*\/cancel$/.test(path)) && method === "POST";
  const financeWrite = (["/api/finance/documents", "/api/finance/settlements", "/api/financial-documents/from-source", "/api/financial-documents/from-sales-order", "/api/financial-documents/from-purchase-order", "/api/financial-payments"].includes(path)
    || /^\/api\/(?:financial-documents\/[1-9]\d*\/settlements|(?:financial-payments|finance-settlements)\/[1-9]\d*\/reversal)$/.test(path)) && method === "POST";
  const projectWrite = (path === "/api/projects" || /^\/api\/projects\/[1-9]\d*(?:\/(?:submit|accept|return|documents)(?:\/[1-9]\d*)?)?$/.test(path)) && ["POST", "PATCH", "DELETE"].includes(method);
  const logoutWrite = path === "/api/logout" && method === "POST";
  const protectedBusinessWrite = (materialWrite || identityWrite || masterDataWrite || procurementWrite || productionWrite || qualityWrite);
  const protectedWriteRequest = protectedBusinessWrite || projectWrite || financeWrite;
  if (protectedWriteRequest) {
    if (!protectedWrite?.idempotencyKey || !protectedWrite?.csrfToken) {
      throw new ErpApiError("受保护写请求缺少幂等键或 CSRF Token", { code: "PROTECTED_WRITE_CONTEXT_REQUIRED" });
    }
    headers["Idempotency-Key"] = protectedWrite.idempotencyKey;
    headers["X-CSRF-Token"] = protectedWrite.csrfToken;
  } else if (logoutWrite) {
    if (!protectedWrite?.csrfToken) throw new ErpApiError("退出请求缺少 CSRF Token", { code: "PROTECTED_WRITE_CONTEXT_REQUIRED" });
    headers["X-CSRF-Token"] = protectedWrite.csrfToken;
  } else if (method === "POST") headers["Idempotency-Key"] ||= crypto.randomUUID();

  let response;
  try {
    response = await fetch(path, { ...requestOptions, method, credentials: "same-origin", headers, cache: path === "/api/session" ? "no-store" : requestOptions.cache });
  } catch (error) {
    if (protectedWriteRequest) {
      throw new ErpApiError("操作结果尚未确认，请使用原操作标识安全恢复", { code: "RESULT_UNKNOWN", resultUnknown: true });
    }
    if (error?.name === "AbortError") throw error;
    throw new ErpApiError("网络连接失败，请检查网络后重试", { code: "NETWORK_ERROR" });
  }

  const contentType = response.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const parsed = errorBody(data);
    if (response.status === 401 && !["/api/session", "/api/login"].includes(path)) {
      window.dispatchEvent(new CustomEvent("cyd-erp-auth-required", { detail: { path } }));
    }
    if (parsed.code === "PASSWORD_CHANGE_REQUIRED") window.dispatchEvent(new CustomEvent("cyd-erp-password-change-required", { detail: { path } }));
    throw new ErpApiError(parsed.message, { status: response.status, httpStatus: response.status, retryAfter: response.headers.get("Retry-After") || "", ...parsed });
  }
  return data;
}

export async function logoutSession(csrfToken) {
  if (!csrfToken) throw new ErpApiError("退出请求缺少 CSRF Token，请刷新页面后重试", { code: "PROTECTED_WRITE_CONTEXT_REQUIRED" });
  return api("/api/logout", {
    method: "POST",
    body: "{}",
    protectedWrite: { csrfToken },
  });
}

function parseXhrBody(xhr) {
  const contentType = xhr.getResponseHeader("Content-Type") || "";
  const text = String(xhr.responseText || "");
  if (!contentType.includes("application/json")) return text;
  try { return JSON.parse(text); } catch { return ""; }
}

export function materialMultipart(path, options = {}) {
  const { file, protectedWrite, headers: inputHeaders = {}, onProgress, signal } = options;
  if (!(file instanceof Blob) || !protectedWrite?.idempotencyKey || !protectedWrite?.csrfToken) {
    return Promise.reject(new ErpApiError("受保护上传缺少文件、幂等键或 CSRF Token", { code: "PROTECTED_WRITE_CONTEXT_REQUIRED" }));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = false;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const unknown = () => finish(() => reject(new ErpApiError("操作结果尚未确认，请使用原操作标识安全恢复", { code: "RESULT_UNKNOWN", resultUnknown: true })));
    const abort = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE) xhr.abort();
      if (!sent) finish(() => reject(new DOMException("本地上传准备已取消", "AbortError")));
    };
    if (signal?.aborted) { abort(); return; }
    xhr.open("POST", path, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Request-Id", crypto.randomUUID());
    xhr.setRequestHeader("Idempotency-Key", protectedWrite.idempotencyKey);
    xhr.setRequestHeader("X-CSRF-Token", protectedWrite.csrfToken);
    for (const [name, value] of Object.entries(inputHeaders)) {
      if (name.toLowerCase() !== "content-type" && value !== undefined && value !== null) xhr.setRequestHeader(name, String(value));
    }
    xhr.upload.addEventListener("progress", (event) => {
      onProgress?.({ loaded: event.loaded, total: event.total, lengthComputable: event.lengthComputable });
    });
    xhr.addEventListener("load", () => {
      const data = parseXhrBody(xhr);
      if (xhr.status >= 200 && xhr.status < 300) { finish(() => resolve(data)); return; }
      const parsed = errorBody(data);
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent("cyd-erp-auth-required", { detail: { path } }));
      finish(() => reject(new ErpApiError(parsed.message, {
        status: xhr.status,
        httpStatus: xhr.status,
        retryAfter: xhr.getResponseHeader("Retry-After") || "",
        ...parsed,
      })));
    });
    xhr.addEventListener("error", unknown);
    xhr.addEventListener("timeout", unknown);
    xhr.addEventListener("abort", () => { if (sent) unknown(); });
    signal?.addEventListener("abort", abort, { once: true });
    const form = new FormData();
    form.append("file", file, options.filename || file.name || "upload");
    sent = true;
    xhr.send(form);
  });
}

export function safeMaterialReturnTo(value, fallback = "/materials") {
  if (typeof value !== "string" || !value.startsWith("/materials") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  try {
    const base = "https://erp.invalid";
    const parsed = new URL(value, base);
    const validPath = parsed.pathname === "/materials" || parsed.pathname.startsWith("/materials/");
    return parsed.origin === base && validPath ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}
