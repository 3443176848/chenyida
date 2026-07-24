import { materialFailure } from "./errors.ts";

export type MaterialWorkflowState = "DRAFT" | "PENDING_REVIEW" | "ACTIVE";
export type MaterialWorkflowAction = "SUBMIT" | "APPROVE" | "REJECT";

const TRANSITIONS: Readonly<Record<MaterialWorkflowAction, readonly [MaterialWorkflowState, MaterialWorkflowState]>> = {
  SUBMIT: ["DRAFT", "PENDING_REVIEW"],
  APPROVE: ["PENDING_REVIEW", "ACTIVE"],
  REJECT: ["PENDING_REVIEW", "DRAFT"],
};

export function transitionMaterialState(current: string, action: MaterialWorkflowAction): MaterialWorkflowState {
  const [from, to] = TRANSITIONS[action];
  if (current !== from) {
    materialFailure(action === "SUBMIT" ? "MATERIAL_NOT_SUBMITTABLE" : "MATERIAL_NOT_REVIEWABLE", `当前状态 ${current} 不能执行 ${action}`, 409);
  }
  return to;
}

export function assertReviewSeparation(actor: string, createdBy: string, lastModifiedBy: string): void {
  if (actor === createdBy) materialFailure("SELF_REVIEW_FORBIDDEN", "创建人不能审核自己创建的物料", 403);
  if (actor === lastModifiedBy) materialFailure("LAST_EDITOR_REVIEW_FORBIDDEN", "最后修改人不能审核该物料", 403);
}

export function buildInternalMaterialCode(categoryCode: string, sequence: number): string {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(categoryCode)) materialFailure("MATERIAL_CATEGORY_CODE_INVALID", "分类编码不符合正式编码规则", 422);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999_999) materialFailure("MATERIAL_CODE_SEQUENCE_EXHAUSTED", "该分类正式物料编码流水号已用尽", 409);
  return `CYD-${categoryCode}-${String(sequence).padStart(6, "0")}`;
}
