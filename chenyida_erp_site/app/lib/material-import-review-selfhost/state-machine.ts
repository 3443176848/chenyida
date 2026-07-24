import { reviewFailure } from "./errors.ts";
import type { ReviewSessionStatus } from "./types.ts";

const transitions: Readonly<Record<ReviewSessionStatus, readonly ReviewSessionStatus[]>> = {
  DRAFT: ["IN_REVIEW", "CANCELLED"],
  IN_REVIEW: ["READY_TO_FINALIZE", "CANCELLED"],
  READY_TO_FINALIZE: ["IN_REVIEW", "FINALIZING", "CANCELLED"],
  FINALIZING: ["FINALIZED", "FINALIZE_FAILED"],
  FINALIZED: [],
  FINALIZE_FAILED: ["FINALIZING", "CANCELLED"],
  CANCELLED: [],
};

export function assertReviewTransition(current: ReviewSessionStatus, next: ReviewSessionStatus): void {
  if (!transitions[current]?.includes(next)) {
    reviewFailure("IMPORT_REVIEW_STATUS_CONFLICT", `复核状态不能从 ${current} 转换为 ${next}`, 409);
  }
}

export function assertReviewEditable(status: ReviewSessionStatus): void {
  if (!["DRAFT", "IN_REVIEW", "READY_TO_FINALIZE"].includes(status)) {
    reviewFailure("IMPORT_REVIEW_NOT_EDITABLE", "复核已经进入最终处理，不能直接修改；请创建新复核版本", 409);
  }
}
