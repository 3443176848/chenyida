export const LIST_QUERY_ORDER = [
  "page", "page_size", "keyword", "material_status", "category_id", "category_path",
  "source_type", "created_by", "created_from", "created_to", "updated_from", "updated_to", "sort",
] as const;

export const MATERIAL_STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "FROZEN", "INACTIVE"] as const;
export const SOURCE_TYPES = ["MANUAL", "LEGACY_D1", "LEGACY_SQLITE", "GOVERNANCE_TEMPLATE", "API"] as const;
export const MATERIAL_SORTS = [
  "updated_at_desc", "updated_at_asc", "created_at_desc", "created_at_asc",
  "standard_name_asc", "standard_name_desc", "material_code_asc", "material_code_desc",
] as const;

export type MaterialListQuery = {
  page: number;
  page_size: 20 | 50 | 100;
  keyword: string;
  material_status: string;
  category_id: string;
  category_path: string;
  source_type: string;
  created_by: string;
  created_from: string;
  created_to: string;
  updated_from: string;
  updated_to: string;
  sort: string;
};

export const DEFAULT_LIST_QUERY: MaterialListQuery = {
  page: 1, page_size: 20, keyword: "", material_status: "", category_id: "", category_path: "",
  source_type: "", created_by: "", created_from: "", created_to: "", updated_from: "", updated_to: "",
  sort: "updated_at_desc",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseListQuery(input: string | URLSearchParams): MaterialListQuery {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const pageSize = positiveInt(params.get("page_size"), 20);
  const status = String(params.get("material_status") || "");
  const source = String(params.get("source_type") || "");
  const sort = String(params.get("sort") || DEFAULT_LIST_QUERY.sort);
  return {
    page: positiveInt(params.get("page"), 1),
    page_size: ([20, 50, 100] as number[]).includes(pageSize) ? pageSize as 20 | 50 | 100 : 20,
    keyword: String(params.get("keyword") || "").trim().slice(0, 100),
    material_status: (MATERIAL_STATUSES as readonly string[]).includes(status) ? status : "",
    category_id: /^\d+$/.test(String(params.get("category_id") || "")) ? String(params.get("category_id")) : "",
    category_path: String(params.get("category_path") || "").trim().slice(0, 300),
    source_type: (SOURCE_TYPES as readonly string[]).includes(source) ? source : "",
    created_by: String(params.get("created_by") || "").trim().slice(0, 64),
    created_from: ISO_DATE.test(String(params.get("created_from") || "")) ? String(params.get("created_from")) : "",
    created_to: ISO_DATE.test(String(params.get("created_to") || "")) ? String(params.get("created_to")) : "",
    updated_from: ISO_DATE.test(String(params.get("updated_from") || "")) ? String(params.get("updated_from")) : "",
    updated_to: ISO_DATE.test(String(params.get("updated_to") || "")) ? String(params.get("updated_to")) : "",
    sort: (MATERIAL_SORTS as readonly string[]).includes(sort) ? sort : DEFAULT_LIST_QUERY.sort,
  };
}

export function serializeListQuery(query: MaterialListQuery): string {
  const params = new URLSearchParams();
  for (const key of LIST_QUERY_ORDER) {
    const value = query[key];
    if (key === "page" || key === "page_size" || key === "sort" || value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function materialApiQuery(query: MaterialListQuery): string {
  return `/api/material-master/materials?${serializeListQuery(query)}`;
}

export function hasActiveFilters(query: MaterialListQuery): boolean {
  return LIST_QUERY_ORDER.some((key) => !["page", "page_size", "sort"].includes(key) && query[key] !== "");
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿", PENDING_REVIEW: "待审核", ACTIVE: "生效", FROZEN: "冻结",
  INACTIVE: "停用", OBSOLETE: "废止", REPLACED: "已替代",
};

export function statusLabel(value: unknown): string {
  return STATUS_LABELS[String(value)] || "未知状态";
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "人工", LEGACY_D1: "旧版在线系统", LEGACY_SQLITE: "本地旧版系统",
  GOVERNANCE_TEMPLATE: "治理模板", API: "API",
};

export function sourceLabel(value: unknown): string {
  return SOURCE_LABELS[String(value)] || "未知来源";
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: "创建", UPDATE: "更新", SUBMIT: "提交", APPROVE: "批准", REJECT: "驳回",
  STATUS_CHANGE: "状态变更", APPROVAL: "批准", REJECTION: "驳回", CODE_ASSIGNMENT: "编码分配",
};

export function actionLabel(value: unknown): string {
  return ACTION_LABELS[String(value)] || "未知动作";
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function attributeDisplay(attribute: { data_type?: unknown; value?: unknown; unit?: unknown }): string {
  const type = String(attribute.data_type || "");
  const value = attribute.value;
  if (value === null || value === undefined || value === "") return "—";
  if (type === "BOOLEAN") return value === true ? "是" : value === false ? "否" : "无法显示的属性类型";
  if (!["TEXT", "INTEGER", "DECIMAL", "ENUM"].includes(type)) return "无法显示的属性类型";
  let rendered = String(value);
  if (type === "ENUM" && typeof value === "object" && value) {
    const enumValue = value as { label?: unknown; code?: unknown };
    const code = displayValue(enumValue.code);
    const label = displayValue(enumValue.label);
    rendered = label === code ? label : `${label}（${code}）`;
  }
  const unit = displayValue(attribute.unit);
  return unit === "—" ? rendered : `${rendered} ${unit}`;
}

export function formatShanghaiDate(value: unknown, withSeconds = false): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}), hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}${withSeconds ? `:${parts.second}` : ""}`;
}

export function compactTrackingId(value: unknown): string {
  const text = String(value || "");
  return text ? `…${text.slice(-8)}` : "—";
}

function limited(value: unknown, depth: number): unknown {
  if (depth >= 4) return "[内容深度已截断]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => limited(item, depth + 1)).concat(value.length > 100 ? ["[其余数组项已截断]"] : []);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, limited(item, depth + 1)]));
  return value;
}

export function boundedPreview(value: unknown): string {
  const text = JSON.stringify(limited(value, 0), null, 2) ?? displayValue(value);
  return text.length > 4096 ? `${text.slice(0, 4096)}\n[内容过长，界面仅展示有界预览]` : text;
}

export type MaterialErrorPresentation = { title: string; message: string; requestId: string; canReset: boolean };

export function presentMaterialError(error: { status?: number; code?: string; requestId?: string } | null): MaterialErrorPresentation {
  const status = Number(error?.status || 0);
  if (status === 400) return { title: "查询参数错误", message: "查询条件有误，请检查后重试", requestId: error?.requestId || "", canReset: true };
  if (status === 403) return { title: "没有权限访问此功能", message: "没有权限访问此功能", requestId: error?.requestId || "", canReset: false };
  if (status === 404 || error?.code === "MATERIAL_NOT_FOUND") return { title: "物料不存在或无权查看", message: "物料不存在或无权查看", requestId: error?.requestId || "", canReset: false };
  if (status >= 500) return { title: "系统暂时无法加载数据", message: "系统暂时无法加载数据，请稍后重试", requestId: error?.requestId || "", canReset: false };
  return { title: "网络连接失败", message: "网络连接失败，请检查网络后重试", requestId: error?.requestId || "", canReset: false };
}

export type CategoryNode = {
  category_id: number; code: string; name: string; level: number; full_path: string;
  is_leaf: boolean; children: CategoryNode[];
};

export type CategoryOption = CategoryNode & { code_path: string };

export function flattenCategories(nodes: CategoryNode[], parents: string[] = []): CategoryOption[] {
  return nodes.flatMap((node) => {
    const path = [...parents, node.code];
    return [{ ...node, code_path: path.join("/") }, ...flattenCategories(node.children || [], path)];
  });
}

export function parseHistoryQuery(input: string | URLSearchParams): { page: number; page_size: 20 | 50 } {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const pageSize = positiveInt(params.get("page_size"), 20);
  return { page: positiveInt(params.get("page"), 1), page_size: pageSize === 50 ? 50 : 20 };
}
