import { stableStringify, type WriteOperation } from "./material-draft.ts";

export const REVIEW_QUERY_ORDER = [
  "page", "page_size", "keyword", "category_id", "source_type", "creator",
  "submitted_from", "submitted_to", "sort",
] as const;

export const REVIEW_SORTS = [
  "submitted_at_desc", "submitted_at_asc", "standard_name_asc", "standard_name_desc",
] as const;

export type ReviewQueueQuery = {
  page: number;
  page_size: 20 | 50 | 100;
  keyword: string;
  category_id: string;
  source_type: string;
  creator: string;
  submitted_from: string;
  submitted_to: string;
  sort: string;
};

export const DEFAULT_REVIEW_QUERY: ReviewQueueQuery = {
  page: 1,
  page_size: 20,
  keyword: "",
  category_id: "",
  source_type: "",
  creator: "",
  submitted_from: "",
  submitted_to: "",
  sort: "submitted_at_desc",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_TYPES = new Set(["MANUAL", "LEGACY_D1", "LEGACY_SQLITE", "GOVERNANCE_TEMPLATE", "API"]);

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseReviewQueueQuery(input: string | URLSearchParams): ReviewQueueQuery {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const pageSize = positiveInteger(params.get("page_size"), 20);
  const source = String(params.get("source_type") || "");
  const sort = String(params.get("sort") || DEFAULT_REVIEW_QUERY.sort);
  return {
    page: positiveInteger(params.get("page"), 1),
    page_size: ([20, 50, 100] as number[]).includes(pageSize) ? pageSize as 20 | 50 | 100 : 20,
    keyword: String(params.get("keyword") || "").trim().slice(0, 100),
    category_id: /^\d+$/.test(String(params.get("category_id") || "")) ? String(params.get("category_id")) : "",
    source_type: SOURCE_TYPES.has(source) ? source : "",
    creator: String(params.get("creator") || "").trim().slice(0, 64),
    submitted_from: ISO_DATE.test(String(params.get("submitted_from") || "")) ? String(params.get("submitted_from")) : "",
    submitted_to: ISO_DATE.test(String(params.get("submitted_to") || "")) ? String(params.get("submitted_to")) : "",
    sort: (REVIEW_SORTS as readonly string[]).includes(sort) ? sort : DEFAULT_REVIEW_QUERY.sort,
  };
}

export function serializeReviewQueueQuery(query: ReviewQueueQuery): string {
  const params = new URLSearchParams();
  for (const key of REVIEW_QUERY_ORDER) {
    const value = query[key];
    if (key === "page" || key === "page_size" || key === "sort" || value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function reviewQueueApiQuery(query: ReviewQueueQuery): string {
  return `/api/material-master/review-queue?${serializeReviewQueueQuery(query)}`;
}

export function hasReviewFilters(query: ReviewQueueQuery): boolean {
  return REVIEW_QUERY_ORDER.some((key) => !["page", "page_size", "sort"].includes(key) && query[key] !== "");
}

export function safeReviewReturnTo(value: unknown): string {
  const fallback = "/materials/review?page=1&page_size=20&sort=submitted_at_desc";
  if (typeof value !== "string" || !value.startsWith("/materials/review") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const base = "https://erp.invalid";
    const parsed = new URL(value, base);
    return parsed.origin === base && parsed.pathname === "/materials/review" ? `${parsed.pathname}${parsed.search}` : fallback;
  } catch {
    return fallback;
  }
}

export function reviewCapabilities(permissions: readonly string[]) {
  return {
    queue: permissions.includes("material.review.queue"),
    approve: permissions.includes("material.review.approve"),
    reject: permissions.includes("material.review.reject"),
  };
}

export type ReviewResponsibility = { created: boolean; lastEditor: boolean };

export function reviewResponsibility(username: string, createdBy: unknown, lastModifiedBy: unknown): ReviewResponsibility {
  return {
    created: username !== "" && username === String(createdBy || ""),
    lastEditor: username !== "" && username === String(lastModifiedBy || ""),
  };
}

export type ReviewValidationIssue = {
  code?: string;
  severity?: string;
  field?: string;
  attribute_code?: string;
  message?: string;
  metadata?: unknown;
};

export type ReviewValidation = {
  basis?: string;
  valid: boolean;
  errors: ReviewValidationIssue[];
  warnings: ReviewValidationIssue[];
};

function normalizedIssue(issue: ReviewValidationIssue) {
  return {
    code: String(issue.code || ""),
    severity: String(issue.severity || ""),
    field: String(issue.field || ""),
    attribute_code: String(issue.attribute_code || ""),
    message: String(issue.message || ""),
    metadata: issue.metadata ?? null,
  };
}

export function reviewValidationFingerprint(materialId: number, version: number, validation: ReviewValidation): string {
  return stableStringify({
    material_id: materialId,
    current_version: version,
    validation: {
      basis: String(validation.basis || ""),
      valid: Boolean(validation.valid),
      errors: (validation.errors || []).map(normalizedIssue),
      warnings: (validation.warnings || []).map(normalizedIssue),
    },
  });
}

export type ReviewWriteOperation = Omit<WriteOperation, "type"> & { type: "APPROVE" | "REJECT" };

export function reviewReason(value: string): { value: string; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { value: "", error: "请填写驳回原因" };
  if (trimmed.length > 1000) return { value: trimmed, error: "驳回原因最多 1000 字符" };
  return { value: trimmed, error: "" };
}

export function reviewComment(value: string): { value: string; error: string } {
  const trimmed = value.trim();
  if (trimmed.length > 1000) return { value: trimmed, error: "审核意见最多 1000 字符" };
  return { value: trimmed, error: "" };
}
