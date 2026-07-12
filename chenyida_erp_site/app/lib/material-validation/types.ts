export const MATERIAL_ATTRIBUTE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export type ValidationSeverity = "ERROR" | "WARNING";

export type ValidationIssueMetadataValue = string | number | boolean | readonly string[];

export type ValidationIssue = Readonly<{
  code: string;
  severity: ValidationSeverity;
  field: string;
  message: string;
  attribute_code?: string;
  metadata?: Readonly<Record<string, ValidationIssueMetadataValue>>;
}>;

export type MaterialValidationResult = Readonly<{
  valid: boolean;
  errors: readonly ValidationIssue[];
  warnings: readonly ValidationIssue[];
}>;

export type MaterialAttributeInput = Readonly<{
  value: unknown;
  unit?: string;
  source?: string;
  confidence?: number;
}>;

export type MaterialValidationInput = Readonly<{
  category_id: number;
  basic_fields: Readonly<{
    standard_name: unknown;
    unit: unknown;
    source_type: unknown;
  }>;
  attributes: Readonly<Record<string, MaterialAttributeInput>>;
}>;

export type MaterialAttributeRule = Readonly<{
  code: string;
  name: string;
  dataType: string;
  decimalScale: number;
  canonicalUnit: string;
  allowedValuesJson: string;
  isRequired: boolean;
  sortOrder: number;
}>;

export type MaterialCategoryRules = Readonly<{
  id: number;
  code: string;
  level: number;
  status: string;
  attributes: readonly MaterialAttributeRule[];
}>;

export interface MaterialValidationRepository {
  getCategoryRules(categoryId: number): Promise<MaterialCategoryRules | null>;
}

export interface MaterialValidationService {
  validateForCreate(input: MaterialValidationInput): Promise<MaterialValidationResult>;
  validateForReview(input: MaterialValidationInput): Promise<MaterialValidationResult>;
}
