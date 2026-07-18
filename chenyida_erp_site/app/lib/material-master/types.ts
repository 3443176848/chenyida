import type {
  MaterialAttributeInput,
  MaterialValidationResult,
  MaterialValidationService,
} from "../material-validation/index.ts";

export const MATERIAL_SOURCE_TYPES = [
  "MANUAL",
  "LEGACY_D1",
  "LEGACY_SQLITE",
  "GOVERNANCE_TEMPLATE",
  "API",
  "MATERIAL_IMPORT",
] as const;

export const MATERIAL_PROCUREMENT_TYPES = [
  "PURCHASE",
  "OUTSOURCE",
  "SELF_MADE",
  "NON_PURCHASABLE",
] as const;

export const MATERIAL_INVENTORY_TYPES = ["STOCKED", "NON_STOCKED", "CONSIGNMENT"] as const;
export const MATERIAL_INSPECTION_TYPES = ["NONE", "NORMAL", "TIGHTENED", "REDUCED", "FULL"] as const;
export const MATERIAL_ENVIRONMENTAL_REQUIREMENTS = [
  "UNSPECIFIED",
  "ROHS",
  "ROHS_REACH",
  "HALOGEN_FREE",
  "CUSTOMER_SPECIFIC",
] as const;

export type MaterialSourceType = (typeof MATERIAL_SOURCE_TYPES)[number];
export type MaterialProcurementType = (typeof MATERIAL_PROCUREMENT_TYPES)[number];
export type MaterialInventoryType = (typeof MATERIAL_INVENTORY_TYPES)[number];
export type MaterialInspectionType = (typeof MATERIAL_INSPECTION_TYPES)[number];
export type MaterialEnvironmentalRequirement = (typeof MATERIAL_ENVIRONMENTAL_REQUIREMENTS)[number];
export type MaterialStatus = "DRAFT" | "PENDING_APPROVAL" | "PENDING_REVIEW" | "ACTIVE" | "FROZEN" | "INACTIVE";

export type MaterialMasterAction = "CREATE_DRAFT" | "EDIT_DRAFT" | "SUBMIT_DRAFT" | "APPROVE" | "REJECT" | "CODE_GENERATE";
export type MaterialChangeType = "CREATE" | "UPDATE" | "STATUS_CHANGE" | "APPROVAL" | "REJECTION" | "CODE_ASSIGNMENT";

export const MATERIAL_ACTION_CHANGE_TYPES: Readonly<Record<MaterialMasterAction, MaterialChangeType>> = {
  CREATE_DRAFT: "CREATE",
  EDIT_DRAFT: "UPDATE",
  SUBMIT_DRAFT: "STATUS_CHANGE",
  APPROVE: "APPROVAL",
  REJECT: "REJECTION",
  CODE_GENERATE: "CODE_ASSIGNMENT",
};

export type MaterialOperationContext = Readonly<{
  actor: string;
  request_id: string;
  transaction_companion?: MaterialApiTransactionCompanion;
  import_trace?: MaterialImportDraftTrace;
}>;

export type MaterialDuplicateCandidateWrite = Readonly<{
  candidateMaterialId: number;
  matchLevel: "EXACT" | "HIGH_CONFIDENCE" | "POSSIBLE";
  confidenceBasisPoints: number;
  matchedFields: readonly string[];
}>;

export type MaterialImportDraftTrace = Readonly<{
  batchId: number;
  fileId: number;
  sourceRowId: number;
  normalizedRowId: number;
  normalizationApprovalId: number;
  baseUnitId: number;
  brandId: number | null;
  duplicateCandidates: readonly MaterialDuplicateCandidateWrite[];
}>;

export type MaterialApiTransactionCompanion = Readonly<{
  idempotencyRecordId: number;
  username: string;
  routeCode: "MATERIAL_DRAFT_CREATE" | "MATERIAL_DRAFT_EDIT" | "MATERIAL_DRAFT_SUBMIT" | "MATERIAL_DRAFT_APPROVE" | "MATERIAL_DRAFT_REJECT";
  physicalRequestId: string;
  operationId: string;
  keyDigest: string;
  requestDigest: string;
  leaseTokenDigest: string;
  statusCode: 200 | 201;
  expiresAt: number;
  retentionUntil: number;
}>;

export type CreateMaterialDraftCommand = Readonly<{
  basic_fields: Readonly<{
    category_id: number;
    standard_name: unknown;
    unit: unknown;
    brand?: unknown;
    manufacturer?: unknown;
    manufacturer_part_number?: unknown;
    procurement_type: unknown;
    inventory_type: unknown;
    lot_control_required?: unknown;
    shelf_life_days?: unknown;
    inspection_type: unknown;
    environmental_requirement: unknown;
    source_ref: unknown;
  }>;
  attributes: Readonly<Record<string, MaterialAttributeInput>>;
  source_type: unknown;
  context: MaterialOperationContext;
}>;

export type ReviewMaterialDraftCommand = Readonly<{
  material_id: number;
  expected_version: number;
  reason?: string;
  context: MaterialOperationContext;
}>;

export type EditMaterialDraftCommand = Readonly<{
  material_id: number;
  expected_version: number;
  category_id: number;
  basic_fields: Readonly<{
    standard_name: unknown;
    unit: unknown;
    brand?: unknown;
    manufacturer?: unknown;
    manufacturer_part_number?: unknown;
    procurement_type: unknown;
    inventory_type: unknown;
    lot_control_required?: unknown;
    shelf_life_days?: unknown;
    inspection_type: unknown;
    environmental_requirement: unknown;
  }>;
  attributes: Readonly<Record<string, MaterialAttributeInput>>;
  context: MaterialOperationContext;
}>;

export type SubmitMaterialDraftCommand = Readonly<{
  material_id: number;
  expected_version: number;
  submit_comment?: string;
  context: MaterialOperationContext;
}>;

export type MaterialDraftFields = Readonly<{
  categoryId: number;
  standardName: string;
  baseUom: string;
  brand: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  procurementType: MaterialProcurementType;
  inventoryType: MaterialInventoryType;
  lotControlRequired: 0 | 1;
  shelfLifeDays: number | null;
  inspectionType: MaterialInspectionType;
  environmentalRequirement: MaterialEnvironmentalRequirement;
  sourceType: MaterialSourceType;
  sourceRef: string;
}>;

export type MaterialAttributeStorageDefinition = Readonly<{
  id: number;
  code: string;
  dataType: string;
  decimalScale: number;
  normalizationRule: string;
  isRequired: boolean;
}>;

export type MaterialAttributeStorageSnapshot = Readonly<{
  categoryLevel: number;
  categoryStatus: string;
  metadataGuard: string;
  definitions: readonly MaterialAttributeStorageDefinition[];
}>;

export type MaterialAttributeValueWrite = Readonly<{
  attributeDefinitionId: number;
  attributeCode: string;
  rawValue: string | number | boolean;
  valueText: string | null;
  valueInteger: number | null;
  valueDecimalScaled: number | null;
  valueBoolean: 0 | 1 | null;
  valueDate: string | null;
  normalizedValue: string;
  unitCode: string;
  sourceType: MaterialSourceType;
  sourceRef: string;
}>;

export type MaterialAttributeRecord = Readonly<{
  attributeDefinitionId: number;
  attributeCode: string;
  dataType: string;
  decimalScale: number;
  value: string | number | boolean;
  unit: string;
  sourceType: MaterialSourceType;
  sourceRef: string;
  createdBy: string;
  createdAt: string;
}>;

export type MaterialRecord = Readonly<{
  id: number;
  internalMaterialCode: string | null;
  fields: MaterialDraftFields;
  materialStatus: MaterialStatus;
  version: number;
  lastModifiedBy: string;
  submittedBy: string;
  submittedAt: string | null;
  approvedBy: string;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  requestId: string;
  reviewGuard: string;
  attributes: readonly MaterialAttributeRecord[];
}>;

export type MaterialCodeRule = Readonly<{
  id: number;
  categoryId: number;
  prefix: string;
  majorSegment: string;
  minorSegment: string;
  separator: string;
  sequenceWidth: number;
  nextSequence: number;
  version: number;
}>;

export type CreateDraftWrite = Readonly<{
  fields: MaterialDraftFields;
  attributes: readonly MaterialAttributeValueWrite[];
  createdBy: string;
  createdAt: string;
  requestId: string;
  metadataGuard: string;
  snapshotJson: string;
  transactionCompanion?: MaterialApiTransactionCompanion;
  importTrace?: MaterialImportDraftTrace;
}>;

export type EditDraftWrite = Readonly<{
  materialId: number;
  expectedVersion: number;
  fields: MaterialDraftFields;
  attributes: readonly MaterialAttributeValueWrite[];
  changedFields: readonly string[];
  changedBy: string;
  changedAt: string;
  requestId: string;
  metadataGuard: string;
  snapshotJson: string;
  oldSnapshotJson: string;
  validationSummary: Readonly<{ valid: true; errorCount: 0; warningCount: number }>;
  transactionCompanion?: MaterialApiTransactionCompanion;
}>;

export type SubmitDraftWrite = Readonly<{
  materialId: number;
  expectedVersion: number;
  submittedBy: string;
  submittedAt: string;
  requestId: string;
  comment: string;
  reviewGuard: string;
  snapshotJson: string;
  transactionCompanion?: MaterialApiTransactionCompanion;
}>;

export type ApproveDraftWrite = Readonly<{
  materialId: number;
  expectedVersion: number;
  code: string;
  rule: MaterialCodeRule;
  reviewedBy: string;
  reviewedAt: string;
  requestId: string;
  reason: string;
  reviewGuard: string;
  snapshotJson: string;
  transactionCompanion?: MaterialApiTransactionCompanion;
}>;

export type RejectDraftWrite = Readonly<{
  materialId: number;
  expectedVersion: number;
  reviewedBy: string;
  reviewedAt: string;
  requestId: string;
  reason: string;
  reviewGuard: string;
  snapshotJson: string;
  transactionCompanion?: MaterialApiTransactionCompanion;
}>;

export type MaterialDraftResult = Readonly<{
  material: MaterialRecord;
  validation: MaterialValidationResult;
}>;

export type MaterialApprovalResult = Readonly<{
  material: MaterialRecord;
  validation: MaterialValidationResult;
}>;

export type MaterialServiceErrorDetails = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;

export type MaterialMasterServiceErrorCode =
  | "MATERIAL_CREATE_VALIDATION_FAILED"
  | "MATERIAL_REVIEW_VALIDATION_FAILED"
  | "MATERIAL_DRAFT_INPUT_INVALID"
  | "MATERIAL_ATTRIBUTE_STORAGE_INVALID"
  | "MATERIAL_ATTRIBUTE_VALUE_INVALID"
  | "MATERIAL_ATTRIBUTE_STORAGE_METADATA_INVALID"
  | "MATERIAL_ATTRIBUTE_STORAGE_METADATA_CONFLICT"
  | "MATERIAL_DRAFT_NOT_FOUND"
  | "MATERIAL_DRAFT_NOT_REVIEWABLE"
  | "MATERIAL_DRAFT_NOT_EDITABLE"
  | "MATERIAL_DRAFT_NOT_CHANGED"
  | "MATERIAL_DRAFT_NOT_SUBMITTABLE"
  | "MATERIAL_VERSION_CONFLICT"
  | "MATERIAL_CODE_RULE_NOT_FOUND"
  | "MATERIAL_CODE_RULE_AMBIGUOUS"
  | "MATERIAL_CODE_RULE_INVALID"
  | "MATERIAL_CODE_SEQUENCE_EXHAUSTED"
  | "MATERIAL_CODE_ALLOCATION_CONFLICT"
  | "MATERIAL_WRITE_FAILED";

export class MaterialMasterServiceError extends Error {
  readonly code: MaterialMasterServiceErrorCode;
  readonly details?: MaterialServiceErrorDetails;
  readonly validation?: MaterialValidationResult;

  constructor(
    code: MaterialMasterServiceErrorCode,
    message: string,
    options: Readonly<{
      details?: MaterialServiceErrorDetails;
      validation?: MaterialValidationResult;
      cause?: unknown;
    }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MaterialMasterServiceError";
    this.code = code;
    this.details = options.details;
    this.validation = options.validation;
  }
}

export type MaterialMasterRepositoryErrorKind =
  | "MATERIAL_ID_CONFLICT"
  | "MATERIAL_VERSION_CONFLICT"
  | "CODE_SEQUENCE_CONFLICT"
  | "CODE_DUPLICATE"
  | "WRITE_FAILED";

export class MaterialMasterRepositoryError extends Error {
  readonly kind: MaterialMasterRepositoryErrorKind;

  constructor(kind: MaterialMasterRepositoryErrorKind, cause?: unknown) {
    super(kind, cause === undefined ? undefined : { cause });
    this.name = "MaterialMasterRepositoryError";
    this.kind = kind;
  }
}

export interface MaterialMasterRepository {
  getAttributeStorageDefinitions(categoryId: number): Promise<MaterialAttributeStorageSnapshot>;
  createDraft(input: CreateDraftWrite): Promise<MaterialRecord>;
  editDraft(input: EditDraftWrite): Promise<MaterialRecord>;
  submitDraft(input: SubmitDraftWrite): Promise<MaterialRecord>;
  getMaterialForReview(materialId: number): Promise<MaterialRecord | null>;
  getApplicableCodeRules(categoryId: number, effectiveDate: string): Promise<readonly MaterialCodeRule[]>;
  materialCodeExists(code: string): Promise<boolean>;
  advanceOccupiedCodeSequence(
    rule: MaterialCodeRule,
    actor: string,
    timestamp: string,
    requestId: string,
  ): Promise<boolean>;
  approveDraftWithCode(input: ApproveDraftWrite): Promise<MaterialRecord>;
  rejectDraft(input: RejectDraftWrite): Promise<MaterialRecord>;
}

export interface MaterialDraftService {
  createDraft(command: CreateMaterialDraftCommand): Promise<MaterialDraftResult>;
  editDraft(command: EditMaterialDraftCommand): Promise<MaterialDraftResult>;
  submitDraft(command: SubmitMaterialDraftCommand): Promise<MaterialDraftResult>;
}

export interface MaterialCodeService {
  activateDraft(
    draft: MaterialRecord,
    command: ReviewMaterialDraftCommand,
    reviewedAt: string,
  ): Promise<MaterialRecord>;
}

export interface MaterialReviewService {
  approveDraft(command: ReviewMaterialDraftCommand): Promise<MaterialApprovalResult>;
  rejectDraft(command: ReviewMaterialDraftCommand): Promise<MaterialRecord>;
}

export type MaterialMasterServiceDependencies = Readonly<{
  repository: MaterialMasterRepository;
  validationService: MaterialValidationService;
  clock?: () => Date;
}>;
