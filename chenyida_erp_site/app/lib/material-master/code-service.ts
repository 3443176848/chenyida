import {
  MaterialMasterRepositoryError,
  MaterialMasterServiceError,
  type MaterialCodeRule,
  type MaterialCodeService,
  type MaterialMasterRepository,
  type MaterialRecord,
  type ReviewMaterialDraftCommand,
} from "./types.ts";

const SEGMENT_PATTERN = /^[A-Z0-9]+$/;
const SEPARATOR_PATTERN = /^[-_./]$/;
const MAX_ALLOCATION_ATTEMPTS = 16;

function assertRule(rule: MaterialCodeRule): void {
  if (
    !SEGMENT_PATTERN.test(rule.prefix) ||
    !SEGMENT_PATTERN.test(rule.majorSegment) ||
    !SEGMENT_PATTERN.test(rule.minorSegment) ||
    !SEPARATOR_PATTERN.test(rule.separator) ||
    !Number.isSafeInteger(rule.sequenceWidth) ||
    rule.sequenceWidth < 4 ||
    rule.sequenceWidth > 12 ||
    !Number.isSafeInteger(rule.nextSequence) ||
    rule.nextSequence <= 0 ||
    !Number.isSafeInteger(rule.version) ||
    rule.version <= 0
  ) {
    throw new MaterialMasterServiceError(
      "MATERIAL_CODE_RULE_INVALID",
      "物料编码规则 metadata 无效",
      { details: { rule_id: rule.id } },
    );
  }
}

export function formatMaterialCode(rule: MaterialCodeRule): string {
  assertRule(rule);
  const sequence = String(rule.nextSequence);
  if (sequence.length > rule.sequenceWidth) {
    throw new MaterialMasterServiceError(
      "MATERIAL_CODE_SEQUENCE_EXHAUSTED",
      "物料编码规则的流水号已用尽",
      { details: { rule_id: rule.id } },
    );
  }
  return [
    rule.prefix,
    rule.majorSegment,
    rule.minorSegment,
    sequence.padStart(rule.sequenceWidth, "0"),
  ].join(rule.separator);
}

function approvalSnapshot(
  draft: MaterialRecord,
  code: string,
  command: ReviewMaterialDraftCommand,
  reviewedAt: string,
): string {
  return JSON.stringify({
    id: draft.id,
    internal_material_code: code,
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
    source_type: draft.fields.sourceType,
    source_ref: draft.fields.sourceRef,
    material_status: "ACTIVE",
    version: command.expected_version + 1,
    approved_by: command.context.actor,
    approved_at: reviewedAt,
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

class DefaultMaterialCodeService implements MaterialCodeService {
  private readonly repository: MaterialMasterRepository;

  constructor(repository: MaterialMasterRepository) {
    this.repository = repository;
  }

  async activateDraft(
    draft: MaterialRecord,
    command: ReviewMaterialDraftCommand,
    reviewedAt: string,
  ): Promise<MaterialRecord> {
    if (
      draft.materialStatus !== "DRAFT" ||
      draft.internalMaterialCode !== null ||
      draft.version !== command.expected_version
    ) {
      throw new MaterialMasterServiceError(
        "MATERIAL_VERSION_CONFLICT",
        "物料草稿版本或状态已变化，请刷新后重试",
      );
    }

    const effectiveDate = reviewedAt.slice(0, 10);
    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      let rules: readonly MaterialCodeRule[];
      try {
        rules = await this.repository.getApplicableCodeRules(
          draft.fields.categoryId,
          effectiveDate,
        );
      } catch {
        throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料编码规则暂时不可用");
      }

      if (rules.length === 0) {
        throw new MaterialMasterServiceError(
          "MATERIAL_CODE_RULE_NOT_FOUND",
          "当前物料分类没有有效编码规则",
          { details: { category_id: draft.fields.categoryId } },
        );
      }
      if (rules.length > 1) {
        throw new MaterialMasterServiceError(
          "MATERIAL_CODE_RULE_AMBIGUOUS",
          "当前物料分类存在多个有效编码规则",
          { details: { category_id: draft.fields.categoryId } },
        );
      }

      const rule = rules[0];
      const code = formatMaterialCode(rule);

      let occupied: boolean;
      try {
        occupied = await this.repository.materialCodeExists(code);
      } catch {
        throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料编码唯一性检查失败");
      }
      if (occupied) {
        const advanced = await this.advanceOccupiedSequence(
          rule,
          command,
          reviewedAt,
        );
        if (!advanced) continue;
        continue;
      }

      try {
        return await this.repository.approveDraftWithCode({
          materialId: draft.id,
          expectedVersion: command.expected_version,
          code,
          rule,
          reviewedBy: command.context.actor,
          reviewedAt,
          requestId: command.context.request_id,
          reason: command.reason?.trim() ?? "",
          reviewGuard: draft.reviewGuard,
          snapshotJson: approvalSnapshot(draft, code, command, reviewedAt),
          transactionCompanion: command.context.transaction_companion,
        });
      } catch (error) {
        if (error instanceof MaterialMasterRepositoryError) {
          if (error.kind === "MATERIAL_VERSION_CONFLICT") {
            throw new MaterialMasterServiceError(
              "MATERIAL_VERSION_CONFLICT",
              "物料草稿已被其他审核者处理，请刷新后重试",
            );
          }
          if (error.kind === "CODE_SEQUENCE_CONFLICT") continue;
          if (error.kind === "CODE_DUPLICATE") {
            const advanced = await this.advanceOccupiedSequence(
              rule,
              command,
              reviewedAt,
            );
            if (!advanced) continue;
            continue;
          }
        }
        throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料批准事务失败");
      }
    }

    throw new MaterialMasterServiceError(
      "MATERIAL_CODE_ALLOCATION_CONFLICT",
      "物料编码分配持续发生并发冲突，请重试",
    );
  }

  private async advanceOccupiedSequence(
    rule: MaterialCodeRule,
    command: ReviewMaterialDraftCommand,
    reviewedAt: string,
  ): Promise<boolean> {
    try {
      return await this.repository.advanceOccupiedCodeSequence(
        rule,
        command.context.actor,
        reviewedAt,
        command.context.request_id,
      );
    } catch {
      throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料编码序列更新失败");
    }
  }
}

export function createMaterialCodeService(repository: MaterialMasterRepository): MaterialCodeService {
  return new DefaultMaterialCodeService(repository);
}
