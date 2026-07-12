import {
  buildMaterialValidationResult,
  prepareMaterialValidationInput,
  validateCategoryRules,
  validateMaterialAttributes,
} from "./rules.ts";
import type {
  MaterialValidationInput,
  MaterialValidationRepository,
  MaterialValidationResult,
  MaterialValidationService,
  ValidationIssue,
} from "./types.ts";

class DefaultMaterialValidationService implements MaterialValidationService {
  private readonly repository: MaterialValidationRepository;

  constructor(repository: MaterialValidationRepository) {
    this.repository = repository;
  }

  validateForCreate(input: MaterialValidationInput): Promise<MaterialValidationResult> {
    return this.validate(input);
  }

  validateForReview(input: MaterialValidationInput): Promise<MaterialValidationResult> {
    return this.validate(input);
  }

  private async validate(input: MaterialValidationInput): Promise<MaterialValidationResult> {
    const prepared = prepareMaterialValidationInput(input);
    const issues: ValidationIssue[] = [...prepared.issues];

    if (prepared.categoryId === null) return buildMaterialValidationResult(issues);

    let category;
    try {
      category = await this.repository.getCategoryRules(prepared.categoryId);
    } catch {
      issues.push({
        code: "MATERIAL_VALIDATION_METADATA_UNAVAILABLE",
        severity: "ERROR",
        field: "category_id",
        message: "物料校验 metadata 暂时不可用",
      });
      return buildMaterialValidationResult(issues);
    }

    const categoryIssues = validateCategoryRules(category);
    issues.push(...categoryIssues);
    if (!category || categoryIssues.length > 0 || !prepared.attributes) {
      return buildMaterialValidationResult(issues, category);
    }

    issues.push(...validateMaterialAttributes(category, prepared.attributes));
    return buildMaterialValidationResult(issues, category);
  }
}

export function createMaterialValidationService(
  repository: MaterialValidationRepository,
): MaterialValidationService {
  return new DefaultMaterialValidationService(repository);
}
