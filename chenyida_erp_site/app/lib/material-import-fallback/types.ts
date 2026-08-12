export type MaterialImportFallbackActor = Readonly<{
  username: string;
  permissions: readonly string[];
  must_change_password?: boolean;
}>;

export type MaterialImportFallbackBatchStatus =
  | "CREATED"
  | "UPLOAD_PENDING"
  | "FILE_READY"
  | "QUEUED_FOR_PARSING"
  | "PARSING"
  | "PARSED"
  | "AWAITING_MAPPING"
  | "MAPPING_CONFIRMED"
  | "QUEUED_FOR_NORMALIZATION"
  | "NORMALIZING"
  | "NORMALIZED"
  | "RECONCILIATION_REQUIRED"
  | "FAILED"
  | "CANCELLED";

export type MaterialImportFallbackStorageStatus =
  | "STAGING"
  | "STAGED"
  | "STORED"
  | "RECONCILIATION_REQUIRED"
  | "STORAGE_FAILED"
  | "DELETE_PENDING"
  | "DELETED";

export type MaterialImportFallbackSecurityStatus =
  | "NOT_APPLICABLE"
  | "NOT_STARTED"
  | "PENDING"
  | "BASIC_CHECK_PASSED"
  | "REJECTED"
  | "LEGACY_UNVERIFIED";

export type MaterialImportFallbackBatchRow = Readonly<{
  id: string | number;
  batch_no: string;
  source_kind: string;
  status: MaterialImportFallbackBatchStatus;
  retry_of_batch_id: string | number | null;
  created_by: string;
  current_version: number;
  file_count: number;
  total_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  failure_stage: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}>;

export type MaterialImportFallbackFileRow = Readonly<{
  id: string | number;
  batch_id: string | number;
  storage_name: string;
  relative_path: string;
  staging_relative_path: string | null;
  original_filename: string;
  filename_extension: string | null;
  mime_type: string;
  declared_mime_type: string | null;
  sha256: string;
  declared_sha256: string | null;
  size_bytes: string | number;
  declared_size_bytes: string | number | null;
  detected_file_type: "CSV" | "XLS" | "XLSX" | null;
  actual_sha256: string | null;
  actual_size_bytes: string | number | null;
  storage_status: MaterialImportFallbackStorageStatus;
  security_check_status: MaterialImportFallbackSecurityStatus;
  security_failure_code: string | null;
  security_failure_message: string | null;
  security_warning_codes: readonly string[] | null;
  uploaded_at: Date | string | null;
  promoted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}>;

export type MaterialImportFallbackIdempotencyRow = Readonly<{
  id: string | number;
  username: string;
  method: string;
  route_scope: string;
  key_digest: string;
  request_digest: string;
  operation_id: string;
  state: "PENDING" | "COMPLETED";
  batch_id: string | number | null;
  file_id: string | number | null;
  response: Record<string, unknown> | null;
  status_code: number | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  expires_at: Date | string | null;
  recovery_until: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}>;

export type MaterialImportFallbackUploadOperationRow = Readonly<{
  operation_id: string;
  batch_id: string | number;
  expected_batch_version: number;
  declared_filename: string;
  filename_extension: ".csv" | ".xls" | ".xlsx";
  declared_mime_type: string;
  declared_sha256: string;
  declared_size_bytes: string | number;
  duplicate_action: "REJECT" | "ALLOW_DUPLICATE";
  staging_relative_path: string;
  final_relative_path: string;
  phase: "PREPARED" | "STAGED" | "SECURITY_PASSED" | "PROMOTED" | "PUBLISHED" | "FAILED" | "RECONCILIATION_REQUIRED";
  failure_code: string | null;
  failure_message: string | null;
  staged_at: Date | string | null;
  checked_at: Date | string | null;
  promoted_at: Date | string | null;
  completed_at: Date | string | null;
  request_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}>;

export type MaterialImportFallbackStoredResponse = Readonly<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Readonly<{ code: string; message: string; current_version?: number }>;
}>;

export type MaterialImportFallbackPreparedUpload = Readonly<{
  kind: "PREPARED";
  operationId: string;
  leaseToken: string;
  batchId: number;
  expectedBatchVersion: number;
  declaredFilename: string;
  filenameExtension: ".csv" | ".xls" | ".xlsx";
  declaredMimeType: string;
  declaredSha256: string;
  declaredSizeBytes: number;
  duplicateAction: "REJECT" | "ALLOW_DUPLICATE";
  stagingRelativePath: string;
  finalRelativePath: string;
  resumed: boolean;
}>;

export type MaterialImportFallbackResult<T = Record<string, unknown>> = Readonly<{
  data: T;
  statusCode: number;
  operationId?: string;
  replayed?: boolean;
}>;

export class MaterialImportFallbackError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentVersion?: number;
  readonly retryAfterSeconds?: number;
  readonly operationId?: string;
  readonly replayed: boolean;

  constructor(
    code: string,
    message: string,
    status = 400,
    options: Readonly<{ currentVersion?: number; retryAfterSeconds?: number; operationId?: string; replayed?: boolean }> = {},
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.currentVersion = options.currentVersion;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.operationId = options.operationId;
    this.replayed = options.replayed === true;
  }
}
