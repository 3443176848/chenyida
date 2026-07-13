import type { MaterialValidationService } from "../material-validation/index.ts";
import { createMaterialCodeService } from "./code-service.ts";
import { materialRecordToValidationInput } from "./validation-input.ts";
import {
  MaterialMasterRepositoryError,
  MaterialMasterServiceError,
  type MaterialApprovalResult,
  type MaterialCodeService,
  type MaterialMasterRepository,
  type MaterialRecord,
  type MaterialReviewService,
  type ReviewMaterialDraftCommand,
} from "./types.ts";

export type MaterialReviewServiceDependencies = Readonly<{
  repository: MaterialMasterRepository;
  validationService: MaterialValidationService;
  codeService?: MaterialCodeService;
  clock?: () => Date;
}>;

function requiredContext(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MaterialMasterServiceError(
      "MATERIAL_DRAFT_INPUT_INVALID",
      `字段“${field}”必须是非空字符串`,
      { details: { field } },
    );
  }
  return value.trim();
}

function reviewTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "服务端时间不可用");
  }
  return value.toISOString();
}

function rejectionSnapshot(
  draft: MaterialRecord,
  command: ReviewMaterialDraftCommand,
  reviewedAt: string,
  reason: string,
): string {
  return JSON.stringify({
    id: draft.id,
    internal_material_code: null,
    category_id: draft.fields.categoryId,
    standard_name: draft.fields.standardName,
    base_uom: draft.fields.baseUom,
    brand: draft.fields.brand,
    manufacturer: draft.fields.manufacturer,
    manufacturer_part_number: draft.fields.manufacturerPartNumber,
    procurement_type: draft.fields.procurementType,
    inventory_type: draft.fields.inventoryType,
    lot_control_required: draft.fields.lotControlRequired === 1,
    shelf_life_days: draft.fields.shelfLifeDays,
    inspection_type: draft.fields.inspectionType,
    environmental_requirement: draft.fields.environmentalRequirement,
    material_status: "DRAFT",
    version: command.expected_version + 1,
    review_result: "REJECT",
    review_reason: reason,
    reviewed_by: command.context.actor,
    reviewed_at: reviewedAt,
    source_type: draft.fields.sourceType,
    source_ref: draft.fields.sourceRef,
    attributes: Object.fromEntries(
      draft.attributes.map((attribute) => [
        attribute.attributeCode,
        {
          value: attribute.value,
          unit: attribute.unit,
          source_type: attribute.sourceType,
        },
      ]),
    ),
  });
}

class DefaultMaterialReviewService implements MaterialReviewService {
  private readonly repository: MaterialMasterRepository;
  private readonly validationService: MaterialValidationService;
  private readonly codeService: MaterialCodeService;
  private readonly clock: () => Date;

  constructor(dependencies: MaterialReviewServiceDependencies) {
    this.repository = dependencies.repository;
    this.validationService = dependencies.validationService;
    this.codeService = dependencies.codeService ?? createMaterialCodeService(dependencies.repository);
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async approveDraft(command: ReviewMaterialDraftCommand): Promise<MaterialApprovalResult> {
    const draft = await this.loadReviewableDraft(command);
    const normalizedCommand: ReviewMaterialDraftCommand = {
      ...command,
      reason: command.reason?.trim(),
      context: {
        actor: command.context.actor.trim(),
        request_id: command.context.request_id.trim(),
        transaction_companion: command.context.transaction_companion,
      },
    };
    const validation = await this.validationService.validateForReview(
      materialRecordToValidationInput(draft),
    );
    if (!validation.valid) {
      throw new MaterialMasterServiceError(
        "MATERIAL_REVIEW_VALIDATION_FAILED",
        "物料草稿未通过审核校验",
        { validation },
      );
    }

    const reviewedAt = reviewTimestamp(this.clock);
    const material = await this.codeService.activateDraft(draft, normalizedCommand, reviewedAt);
    return { material, validation };
  }

  async rejectDraft(command: ReviewMaterialDraftCommand): Promise<MaterialRecord> {
    const reason = requiredContext(command.reason, "reason");
    const draft = await this.loadReviewableDraft(command);
    const normalizedCommand: ReviewMaterialDraftCommand = {
      ...command,
      reason,
      context: {
        actor: command.context.actor.trim(),
        request_id: command.context.request_id.trim(),
        transaction_companion: command.context.transaction_companion,
      },
    };
    const reviewedAt = reviewTimestamp(this.clock);

    try {
      return await this.repository.rejectDraft({
        materialId: draft.id,
        expectedVersion: command.expected_version,
        reviewedBy: normalizedCommand.context.actor,
        reviewedAt,
        requestId: normalizedCommand.context.request_id,
        reason,
        reviewGuard: draft.reviewGuard,
        snapshotJson: rejectionSnapshot(draft, normalizedCommand, reviewedAt, reason),
        transactionCompanion: normalizedCommand.context.transaction_companion,
      });
    } catch (error) {
      if (
        error instanceof MaterialMasterRepositoryError &&
        error.kind === "MATERIAL_VERSION_CONFLICT"
      ) {
        throw new MaterialMasterServiceError(
          "MATERIAL_VERSION_CONFLICT",
          "物料草稿已被其他审核者处理，请刷新后重试",
        );
      }
      throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料拒绝事务失败");
    }
  }

  private async loadReviewableDraft(command: ReviewMaterialDraftCommand): Promise<MaterialRecord> {
    if (!Number.isSafeInteger(command.material_id) || command.material_id <= 0) {
      throw new MaterialMasterServiceError(
        "MATERIAL_DRAFT_INPUT_INVALID",
        "物料 ID 必须是正整数",
        { details: { field: "material_id" } },
      );
    }
    if (!Number.isSafeInteger(command.expected_version) || command.expected_version <= 0) {
      throw new MaterialMasterServiceError(
        "MATERIAL_DRAFT_INPUT_INVALID",
        "预期版本必须是正整数",
        { details: { field: "expected_version" } },
      );
    }
    requiredContext(command.context.actor, "context.actor");
    requiredContext(command.context.request_id, "context.request_id");

    let material: MaterialRecord | null;
    try {
      material = await this.repository.getMaterialForReview(command.material_id);
    } catch {
      throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料草稿读取失败");
    }
    if (!material) {
      throw new MaterialMasterServiceError("MATERIAL_DRAFT_NOT_FOUND", "物料草稿不存在");
    }
    if (material.version !== command.expected_version) {
      throw new MaterialMasterServiceError(
        "MATERIAL_VERSION_CONFLICT",
        "物料草稿版本已变化，请刷新后重试",
      );
    }
    if (material.materialStatus !== "DRAFT" || material.internalMaterialCode !== null) {
      throw new MaterialMasterServiceError(
        "MATERIAL_DRAFT_NOT_REVIEWABLE",
        "当前物料状态不允许执行草稿审核",
      );
    }
    return material;
  }
}

export function createMaterialReviewService(
  dependencies: MaterialReviewServiceDependencies,
): MaterialReviewService {
  return new DefaultMaterialReviewService(dependencies);
}
