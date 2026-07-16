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
  if (materialWrite) {
    if (!protectedWrite?.idempotencyKey || !protectedWrite?.csrfToken) {
      throw new ErpApiError("受保护写请求缺少幂等键或 CSRF Token", { code: "PROTECTED_WRITE_CONTEXT_REQUIRED" });
    }
    headers["Idempotency-Key"] = protectedWrite.idempotencyKey;
    headers["X-CSRF-Token"] = protectedWrite.csrfToken;
  } else if (method === "POST") headers["Idempotency-Key"] ||= crypto.randomUUID();

  let response;
  try {
    response = await fetch(path, { ...requestOptions, method, credentials: "same-origin", headers });
  } catch (error) {
    if (materialWrite) {
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
    throw new ErpApiError(parsed.message, { status: response.status, httpStatus: response.status, retryAfter: response.headers.get("Retry-After") || "", ...parsed });
  }
  return data;
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
