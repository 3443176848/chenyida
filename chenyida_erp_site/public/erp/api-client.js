export class ErpApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ErpApiError";
    this.status = options.status || 0;
    this.code = options.code || "NETWORK_ERROR";
    this.requestId = options.requestId || "";
    this.details = Array.isArray(options.details) ? options.details : [];
  }
}

function errorBody(data) {
  if (data && typeof data === "object" && data.error && typeof data.error === "object") {
    return {
      code: String(data.error.code || "INTERNAL_ERROR"),
      message: String(data.error.message || "请求失败"),
      requestId: String(data.error.request_id || ""),
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
  const method = String(options.method || "GET").toUpperCase();
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  headers["X-Request-Id"] ||= crypto.randomUUID();
  if (method === "POST") headers["Idempotency-Key"] ||= crypto.randomUUID();

  let response;
  try {
    response = await fetch(path, { ...options, method, credentials: "same-origin", headers });
  } catch (error) {
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
    throw new ErpApiError(parsed.message, { status: response.status, ...parsed });
  }
  return data;
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
