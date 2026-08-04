import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import {
  chmod,
  chown,
  link,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { hashPassword, validatePassword, verifyPassword } from "../../app/lib/identity-selfhost/password.ts";
import { PostgresIdentityRepository } from "../../app/lib/identity-selfhost/repository.ts";

export const RECOVERY_ACTION = "OFFLINE_IDENTITY_RECOVERY";
export const RECOVERY_SESSION_CLEANUP_ACTION = "OFFLINE_IDENTITY_RECOVERY_SESSION_CLEANUP";
export const RECOVERY_REASON = "用户明确授权的非生产凭据恢复";
export const RECOVERY_REASON_CODE = "USER_AUTHORIZED_NON_PRODUCTION_CREDENTIAL_RECOVERY";
export const RECOVERY_ACTOR = "offline_identity_recovery";
export const UAT_CREDENTIAL_SCHEMA_VERSION = "chenyida-erp-uat-credentials-v2";
export const UAT_CREDENTIAL_VALIDATOR_VERSION = "offline-identity-recovery-uat-validator-v2.1";
export const UAT_CREDENTIAL_WRITER_VERSION = "offline-identity-recovery-credential-writer-v2";

export const RECOVERY_ACCOUNTS = [
  { username: "admin", role: "admin", mustChangePassword: false },
  { username: "uat_20260729_manager", role: "manager", mustChangePassword: true },
  { username: "uat_20260729_sales", role: "sales", mustChangePassword: true },
  { username: "uat_20260729_engineering", role: "engineering", mustChangePassword: true },
  { username: "uat_20260729_planning", role: "planning", mustChangePassword: true },
  { username: "uat_20260729_purchase", role: "purchase", mustChangePassword: true },
  { username: "uat_20260729_warehouse", role: "warehouse", mustChangePassword: true },
  { username: "uat_20260729_production", role: "production", mustChangePassword: true },
  { username: "uat_20260729_quality", role: "quality", mustChangePassword: true },
  { username: "uat_20260729_finance", role: "finance", mustChangePassword: true },
  { username: "uat_20260729_operations", role: "operations", mustChangePassword: true },
] as const;

export const ADMIN_CREDENTIAL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["format_version", "generated_at", "username", "password", "must_change_password", "recovery_run_id"],
  properties: {
    format_version: { const: "chenyida-erp-admin-credentials-v2" },
    generated_at: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\+08:00$" },
    username: { const: "admin" },
    password: { type: "string", minLength: 12, maxLength: 128 },
    must_change_password: { const: false },
    recovery_run_id: { type: "string", format: "uuid" },
  },
} as const;

export const UAT_CREDENTIAL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["format_version", "generated_at", "accounts", "recovery_run_id"],
  properties: {
    format_version: { const: UAT_CREDENTIAL_SCHEMA_VERSION },
    generated_at: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\+08:00$" },
    accounts: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["username", "role", "password", "must_change_password"],
        properties: {
          username: { type: "string" },
          role: { type: "string" },
          password: { type: "string", minLength: 12, maxLength: 128 },
          must_change_password: { type: "boolean" },
        },
      },
    },
    recovery_run_id: { type: "string", format: "uuid" },
  },
} as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORMAL_DATABASE = "chenyida_erp";
const FORMAL_DATABASE_USER = "chenyida_erp";
const FORMAL_STAGE_DIRECTORY = "/etc/chenyida-erp";
const FORMAL_ATTESTATION_DIRECTORY = "/run/chenyida-erp";
const FORMAL_WEB_IMAGE = "sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25";
const FORMAL_WORKER_IMAGE = "sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa";
const REHEARSAL_DATABASE = /^cyd_oir_(?:test|restore)_[0-9a-f]{12}$/;
const REHEARSAL_STAGE_ROOT = "/run/chenyida-erp/identity-recovery-tests";
const RECOVERY_MUTABLE_TABLES = new Set([
  "app_users",
  "app_sessions",
  "audit_log",
  "idempotency_keys",
]);
const IDENTITY_AND_SYSTEM_TABLES = new Set([
  ...RECOVERY_MUTABLE_TABLES,
  "identity_login_failures",
  "identity_write_rate_limit_buckets",
  "app_meta",
  "schema_migrations",
]);
const EXPECTED_MIGRATIONS = [
  ["0001_selfhost_baseline.sql", "c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702"],
  ["0002_material_master_workflow.sql", "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80"],
  ["0003_material_import_mapping.sql", "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf"],
  ["0004_material_import_normalization.sql", "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39"],
  ["0005_material_import_review.sql", "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc"],
  ["0006_identity_security.sql", "6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079"],
  ["0007_master_data_bom.sql", "0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6"],
  ["0008_inventory_ledger.sql", "49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b"],
  ["0009_procurement.sql", "351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7"],
  ["0010_production.sql", "d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35"],
  ["0011_sales.sql", "6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b"],
  ["0012_quality.sql", "64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf"],
  ["0013_finance.sql", "8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1"],
  ["0014_migration_openings.sql", "61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b"],
  ["0015_market_project_handoff.sql", "419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f"],
  ["0016_project_planning_handoff.sql", "26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076"],
  ["0017_planning_material_requirements.sql", "33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28"],
  ["0018_procurement_sourcing.sql", "64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9"],
  ["0019_sourcing_purchase_fulfillment.sql", "6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a"],
  ["0020_production_handoff_reservations.sql", "1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182"],
  ["0021_production_reporting_completions.sql", "1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec"],
  ["0022_production_quality_release.sql", "65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155"],
  ["0023_sales_delivery_receivable.sql", "5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d"],
  ["0024_finance_project_settlements.sql", "cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624"],
  ["0025_production_routings.sql", "39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9"],
  ["0026_production_operation_execution.sql", "b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0"],
  ["0027_production_final_output_reporting.sql", "b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76"],
  ["0028_production_operation_quality_gates.sql", "a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912"],
  ["0029_production_nonconformance_rework_handoff.sql", "6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c"],
  ["0030_production_rework_execution.sql", "37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c"],
  ["0031_production_batch_genealogy.sql", "ac0f6a63cfdb30d42edf50741afc7c8af632f74ff6fb08398d6b6e398a637fd4"],
  ["0032_finished_goods_inventory_lots.sql", "3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa"],
  ["0033_finished_goods_lot_fqc_shipment.sql", "ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44"],
  ["0034_supplier_receipt_lot_iqc.sql", "29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d"],
  ["0035_bom_material_governance.sql", "d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714"],
  ["0036_project_requirement_unit_resolution.sql", "a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0"],
] as const;
const EXPECTED_MIGRATION_HEAD = EXPECTED_MIGRATIONS.at(-1)![0];

export type RecoveryEnvironment = "parallel-uat" | "parallel-uat-rehearsal";

export class RecoveryError extends Error {
  readonly code: string;
  readonly phase: string;

  constructor(code: string, phase: string) {
    super(code);
    this.name = "RecoveryError";
    this.code = code;
    this.phase = phase;
  }
}

type CredentialAccount = {
  username: string;
  role: string;
  password: string;
  must_change_password: boolean;
};

export type AdminCredentialDocument = {
  format_version: "chenyida-erp-admin-credentials-v2";
  generated_at: string;
  username: "admin";
  password: string;
  must_change_password: false;
  recovery_run_id: string;
};

export type UatCredentialDocument = {
  format_version: "chenyida-erp-uat-credentials-v2";
  generated_at: string;
  accounts: CredentialAccount[];
  recovery_run_id: string;
};

export type CredentialDocuments = {
  admin: AdminCredentialDocument;
  uat: UatCredentialDocument;
};

export type StagePaths = {
  directory: string;
  adminStage: string;
  uatStage: string;
  adminCanonical: string;
  uatCanonical: string;
  oldCandidate: string | null;
};

type RecoveryHooks = {
  beforeStageWrite?: () => void | Promise<void>;
  afterStageLink?: (target: "admin" | "uat") => void | Promise<void>;
  beforeDatabaseConnect?: () => void | Promise<void>;
  afterUserUpdate?: (index: number) => void | Promise<void>;
  afterCommitAcknowledged?: () => void | Promise<void>;
  beforeCommitVerification?: () => void | Promise<void>;
  afterSessionCleanupCommitAcknowledged?: () => void | Promise<void>;
  beforePromotion?: (target: "admin" | "uat" | "candidate") => void | Promise<void>;
  beforeFinalization?: (target: "candidate" | "admin-stage" | "uat-stage" | "directory") => void | Promise<void>;
};

export type RecoveryOptions = {
  pool: Pool;
  environment: RecoveryEnvironment;
  deploymentClass: string;
  expectedMigration: string;
  recoveryRunId: string;
  confirmation: boolean;
  finalizationConfirmation?: boolean;
  sessionCleanupConfirmation?: boolean;
  sessionCleanupUsername?: string;
  effectiveUid: number;
  databaseUrl: string;
  expectedDatabaseName?: string;
  stageDirectory?: string;
  offlineAttestationPath?: string;
  browserVerificationEvidencePath?: string;
  promote: boolean;
  now?: Date;
  hooks?: RecoveryHooks;
};

export type RecoveryResult = {
  status: "canonical_active" | "completed" | "partial" | "staged";
  accountCount: number;
  sessionRevokedCount: number;
  auditCount: number;
  recoveryRunId: string;
  stages: StagePaths;
  promotionCode?: string;
  partialPhase?: "TRANSACTION_OUTCOME" | "PROMOTION" | "FINALIZATION";
};

export type SessionCleanupResult = {
  accountCount: number;
  sessionRevokedCount: number;
  auditCount: number;
  recoveryRunId: string;
};

type LockedUser = {
  username: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  version: number;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type JsonSchema = {
  type?: "object" | "array" | "string" | "boolean";
  const?: unknown;
  required?: readonly string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "uuid";
};

function validatesSchema(schema: JsonSchema, value: unknown): boolean {
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "uuid" && !UUID_V4.test(value)) return false;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => validatesSchema(schema.items!, item))) return false;
  }
  if (schema.type === "object") {
    if (!isPlainObject(value)) return false;
    if (schema.required && !schema.required.every((key) => Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && schema.properties
      && Object.keys(value).some((key) => !Object.hasOwn(schema.properties!, key))) return false;
    if (schema.properties && Object.entries(schema.properties).some(([key, child]) => Object.hasOwn(value, key) && !validatesSchema(child, value[key]))) return false;
  }
  return true;
}

export type UatSchemaDiagnosticKeyword =
  | "required"
  | "type"
  | "const"
  | "enum"
  | "additionalProperties"
  | "minItems"
  | "maxItems"
  | "uniqueItems"
  | "minLength"
  | "maxLength"
  | "pattern"
  | "format";

export type UatSchemaDiagnosticError = {
  pointer: string;
  keyword: UatSchemaDiagnosticKeyword;
  expectedType: string;
  actualType: string;
  field: string;
  username: string;
  role: string;
};

export type UatSchemaDiagnosis = {
  valid: boolean;
  schemaVersion: typeof UAT_CREDENTIAL_SCHEMA_VERSION;
  validatorVersion: typeof UAT_CREDENTIAL_VALIDATOR_VERSION;
  writerVersion: typeof UAT_CREDENTIAL_WRITER_VERSION;
  accountCount: number;
  errorCount: number;
  errors: UatSchemaDiagnosticError[];
};

const DIAGNOSTIC_ERROR_LIMIT = 256;
const EXPECTED_UAT_ACCOUNTS = RECOVERY_ACCOUNTS.slice(1);
const EXPECTED_UAT_USERNAMES = new Set(EXPECTED_UAT_ACCOUNTS.map((account) => account.username));
const EXPECTED_UAT_ROLES = new Set(EXPECTED_UAT_ACCOUNTS.map((account) => account.role));
const SAFE_DIAGNOSTIC_FIELDS = new Set([
  "root",
  "account",
  "format_version",
  "generated_at",
  "accounts",
  "recovery_run_id",
  "username",
  "role",
  "must_change_password",
]);

function diagnosticType(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function diagnosticField(value: string): string {
  const normalized = value.toLowerCase();
  return SAFE_DIAGNOSTIC_FIELDS.has(normalized) ? normalized : "<redacted>";
}

function diagnosticPointer(parent: string, field: string): string {
  return `${parent}/${diagnosticField(field)}`;
}

function diagnosticAccountContext(value: unknown): { username: string; role: string } {
  if (!isPlainObject(value)) return { username: "<unknown>", role: "<unknown>" };
  const username = typeof value.username === "string" && EXPECTED_UAT_USERNAMES.has(value.username as never)
    ? value.username
    : value.username === undefined ? "<missing>" : "<invalid>";
  const role = typeof value.role === "string" && EXPECTED_UAT_ROLES.has(value.role as never)
    ? value.role
    : value.role === undefined ? "<missing>" : "<invalid>";
  return { username, role };
}

export function diagnoseUatCredentialValue(
  value: unknown,
  expectedRecoveryRunId?: string,
): UatSchemaDiagnosis {
  const errors: UatSchemaDiagnosticError[] = [];
  let errorCount = 0;
  let accountCount = 0;
  const addError = (
    pointer: string,
    keyword: UatSchemaDiagnosticKeyword,
    expectedType: string,
    actualValue: unknown,
    field: string,
    context: { username: string; role: string } = { username: "<unknown>", role: "<unknown>" },
  ): void => {
    errorCount += 1;
    if (errors.length >= DIAGNOSTIC_ERROR_LIMIT) return;
    errors.push({
      pointer,
      keyword,
      expectedType,
      actualType: diagnosticType(actualValue),
      field: diagnosticField(field),
      username: context.username,
      role: context.role,
    });
  };

  if (!isPlainObject(value)) {
    addError("/", "type", "object", value, "root");
    return {
      valid: false,
      schemaVersion: UAT_CREDENTIAL_SCHEMA_VERSION,
      validatorVersion: UAT_CREDENTIAL_VALIDATOR_VERSION,
      writerVersion: UAT_CREDENTIAL_WRITER_VERSION,
      accountCount,
      errorCount,
      errors,
    };
  }

  const requiredTopLevel = UAT_CREDENTIAL_SCHEMA.required;
  for (const field of requiredTopLevel) {
    if (!Object.hasOwn(value, field)) {
      const expectedType = field === "accounts" ? "array" : "string";
      addError(diagnosticPointer("", field), "required", expectedType, undefined, field);
    }
  }
  for (const field of Object.keys(value)) {
    if (!requiredTopLevel.includes(field as never)) {
      addError(diagnosticPointer("", field), "additionalProperties", "absent", value[field], field);
    }
  }

  if (Object.hasOwn(value, "format_version")) {
    if (typeof value.format_version !== "string") {
      addError("/format_version", "type", "string", value.format_version, "format_version");
    } else if (value.format_version !== UAT_CREDENTIAL_SCHEMA_VERSION) {
      addError("/format_version", "const", "string", value.format_version, "format_version");
    }
  }
  if (Object.hasOwn(value, "generated_at")) {
    if (typeof value.generated_at !== "string") {
      addError("/generated_at", "type", "string", value.generated_at, "generated_at");
    } else if (!new RegExp(UAT_CREDENTIAL_SCHEMA.properties.generated_at.pattern).test(value.generated_at)) {
      addError("/generated_at", "pattern", "string", value.generated_at, "generated_at");
    }
  }
  if (Object.hasOwn(value, "recovery_run_id")) {
    if (typeof value.recovery_run_id !== "string") {
      addError("/recovery_run_id", "type", "string", value.recovery_run_id, "recovery_run_id");
    } else {
      if (!UUID_V4.test(value.recovery_run_id)) {
        addError("/recovery_run_id", "format", "string", value.recovery_run_id, "recovery_run_id");
      }
      if (expectedRecoveryRunId !== undefined && value.recovery_run_id !== expectedRecoveryRunId) {
        addError("/recovery_run_id", "const", "string", value.recovery_run_id, "recovery_run_id");
      }
    }
  }

  if (Object.hasOwn(value, "accounts")) {
    if (!Array.isArray(value.accounts)) {
      addError("/accounts", "type", "array", value.accounts, "accounts");
    } else {
      accountCount = value.accounts.length;
      if (value.accounts.length < 10) addError("/accounts", "minItems", "array", value.accounts, "accounts");
      if (value.accounts.length > 10) addError("/accounts", "maxItems", "array", value.accounts, "accounts");
      const usernames = new Set<string>();
      const passwords = new Set<string>();
      value.accounts.forEach((account, index) => {
        const parent = `/accounts/${index}`;
        const context = diagnosticAccountContext(account);
        if (!isPlainObject(account)) {
          addError(parent, "type", "object", account, "account", context);
          return;
        }
        const requiredAccountFields = UAT_CREDENTIAL_SCHEMA.properties.accounts.items.required;
        for (const field of requiredAccountFields) {
          if (!Object.hasOwn(account, field)) {
            const expectedType = field === "must_change_password" ? "boolean" : "string";
            addError(diagnosticPointer(parent, field), "required", expectedType, undefined, field, context);
          }
        }
        for (const field of Object.keys(account)) {
          if (!requiredAccountFields.includes(field as never)) {
            addError(diagnosticPointer(parent, field), "additionalProperties", "absent", account[field], field, context);
          }
        }

        if (Object.hasOwn(account, "username")) {
          if (typeof account.username !== "string") {
            addError(`${parent}/username`, "type", "string", account.username, "username", context);
          } else {
            if (usernames.has(account.username)) {
              addError(`${parent}/username`, "uniqueItems", "string", account.username, "username", context);
            }
            usernames.add(account.username);
            const expected = EXPECTED_UAT_ACCOUNTS[index];
            if (!EXPECTED_UAT_USERNAMES.has(account.username as never)
              || expected && account.username !== expected.username) {
              addError(`${parent}/username`, "enum", "string", account.username, "username", context);
            }
          }
        }
        if (Object.hasOwn(account, "role")) {
          if (typeof account.role !== "string") {
            addError(`${parent}/role`, "type", "string", account.role, "role", context);
          } else {
            const expected = EXPECTED_UAT_ACCOUNTS[index];
            if (!EXPECTED_UAT_ROLES.has(account.role as never)
              || expected && account.role !== expected.role) {
              addError(`${parent}/role`, "enum", "string", account.role, "role", context);
            }
          }
        }
        if (Object.hasOwn(account, "password")) {
          const pointer = diagnosticPointer(parent, "password");
          if (typeof account.password !== "string") {
            addError(pointer, "type", "string", account.password, "password", context);
          } else {
            if (account.password.length < 12) addError(pointer, "minLength", "string", account.password, "password", context);
            if (account.password.length > 128) addError(pointer, "maxLength", "string", account.password, "password", context);
            if (passwords.has(account.password)) {
              addError(pointer, "uniqueItems", "string", account.password, "password", context);
            }
            passwords.add(account.password);
            if (typeof account.username === "string") {
              try {
                validatePassword(account.password, account.username);
              } catch {
                addError(pointer, "pattern", "string", account.password, "password", context);
              }
            }
          }
        }
        if (Object.hasOwn(account, "must_change_password")) {
          if (typeof account.must_change_password !== "boolean") {
            addError(`${parent}/must_change_password`, "type", "boolean", account.must_change_password, "must_change_password", context);
          }
        }
      });
    }
  }

  return {
    valid: errorCount === 0,
    schemaVersion: UAT_CREDENTIAL_SCHEMA_VERSION,
    validatorVersion: UAT_CREDENTIAL_VALIDATOR_VERSION,
    writerVersion: UAT_CREDENTIAL_WRITER_VERSION,
    accountCount,
    errorCount,
    errors,
  };
}

export function diagnoseUatCredentialJson(
  raw: string | Buffer,
  expectedRecoveryRunId?: string,
): UatSchemaDiagnosis {
  try {
    return diagnoseUatCredentialValue(JSON.parse(raw.toString()), expectedRecoveryRunId);
  } catch {
    return diagnoseUatCredentialValue(undefined, expectedRecoveryRunId);
  }
}

export async function diagnoseUatCredentialFile(
  filePath: string,
  expectedRecoveryRunId?: string,
): Promise<UatSchemaDiagnosis> {
  await assertCredentialDiagnosticDirectory(path.dirname(filePath));
  const { payload, metadata } = await readRootOnlyRegularFile(filePath);
  if (metadata.size !== payload.length) throw new RecoveryError("RECOVERY_FILE_METADATA_INVALID", "FILE");
  return diagnoseUatCredentialJson(payload, expectedRecoveryRunId);
}

export function formatUatSchemaDiagnosis(diagnosis: UatSchemaDiagnosis): string[] {
  const lines = [
    `SCHEMA_VERSION ${diagnosis.schemaVersion}`,
    `VALIDATOR_VERSION ${diagnosis.validatorVersion}`,
    `WRITER_VERSION ${diagnosis.writerVersion}`,
    `COUNT ACCOUNTS ${diagnosis.accountCount}`,
  ];
  diagnosis.errors.forEach((error, index) => {
    lines.push([
      "ERROR", String(index + 1),
      "POINTER", error.pointer,
      "KEYWORD", error.keyword,
      "EXPECTED_TYPE", error.expectedType,
      "ACTUAL_TYPE", error.actualType,
      "FIELD", error.field,
      "USERNAME", error.username,
      "ROLE", error.role,
    ].join(" "));
  });
  lines.push(`COUNT ERRORS ${diagnosis.errorCount}`);
  if (diagnosis.errors.length !== diagnosis.errorCount) {
    lines.push(`COUNT DISPLAYED_ERRORS ${diagnosis.errors.length}`);
  }
  lines.push(`FINAL ${diagnosis.valid ? "SCHEMA_PASS" : "SCHEMA_INVALID"}`);
  return lines;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function shanghaiIso(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function generatePassword(username: string, used: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `R${randomBytes(24).toString("base64url")}!7a`;
    if (used.has(candidate)) continue;
    try {
      validatePassword(candidate, username);
      used.add(candidate);
      return candidate;
    } catch {
      // A fresh CSPRNG candidate is retried without exposing rejected material.
    }
  }
  throw new RecoveryError("RECOVERY_RANDOM_GENERATION_FAILED", "STAGE");
}

export function createCredentialDocuments(recoveryRunId: string, now = new Date()): CredentialDocuments {
  if (!UUID_V4.test(recoveryRunId)) throw new RecoveryError("RECOVERY_RUN_ID_INVALID", "PRECHECK");
  const used = new Set<string>();
  const generatedAt = shanghaiIso(now);
  const adminPassword = generatePassword("admin", used);
  const uatAccounts: CredentialAccount[] = RECOVERY_ACCOUNTS.slice(1).map((account) => ({
    username: account.username,
    role: account.role,
    password: generatePassword(account.username, used),
    must_change_password: true,
  }));
  const documents: CredentialDocuments = {
    admin: {
      format_version: "chenyida-erp-admin-credentials-v2",
      generated_at: generatedAt,
      username: "admin",
      password: adminPassword,
      must_change_password: false,
      recovery_run_id: recoveryRunId,
    },
    uat: {
      format_version: UAT_CREDENTIAL_SCHEMA_VERSION,
      generated_at: generatedAt,
      accounts: uatAccounts,
      recovery_run_id: recoveryRunId,
    },
  };
  assertRecoveryCredentialDocuments(documents, recoveryRunId);
  return documents;
}

function assertAdminDocument(value: unknown, recoveryRunId: string): asserts value is AdminCredentialDocument {
  if (!validatesSchema(ADMIN_CREDENTIAL_SCHEMA, value)
    || !isPlainObject(value)
    || !exactKeys(value, ADMIN_CREDENTIAL_SCHEMA.required)
    || value.recovery_run_id !== recoveryRunId) {
    throw new RecoveryError("RECOVERY_ADMIN_SCHEMA_INVALID", "SCHEMA");
  }
  validatePassword(value.password, "admin");
}

function assertUatDocument(value: unknown, recoveryRunId: string): asserts value is UatCredentialDocument {
  if (!validatesSchema(UAT_CREDENTIAL_SCHEMA, value)
    || !isPlainObject(value)
    || !exactKeys(value, UAT_CREDENTIAL_SCHEMA.required)
    || value.format_version !== UAT_CREDENTIAL_SCHEMA_VERSION
    || typeof value.generated_at !== "string"
    || !new RegExp(UAT_CREDENTIAL_SCHEMA.properties.generated_at.pattern).test(value.generated_at)
    || value.recovery_run_id !== recoveryRunId
    || !UUID_V4.test(recoveryRunId)
    || !Array.isArray(value.accounts)
    || value.accounts.length !== 10) {
    throw new RecoveryError("RECOVERY_UAT_SCHEMA_INVALID", "SCHEMA");
  }
  const used = new Set<string>();
  value.accounts.forEach((raw, index) => {
    const expected = RECOVERY_ACCOUNTS[index + 1];
    if (!isPlainObject(raw)
      || !exactKeys(raw, UAT_CREDENTIAL_SCHEMA.properties.accounts.items.required)
      || raw.username !== expected.username
      || raw.role !== expected.role
      || typeof raw.password !== "string"
      || typeof raw.must_change_password !== "boolean") {
      throw new RecoveryError("RECOVERY_UAT_SCHEMA_INVALID", "SCHEMA");
    }
    validatePassword(raw.password, expected.username);
    if (used.has(raw.password)) throw new RecoveryError("RECOVERY_PASSWORD_NOT_UNIQUE", "SCHEMA");
    used.add(raw.password);
  });
}

export function assertCanonicalDocuments(documents: CredentialDocuments, recoveryRunId: string): void {
  assertAdminDocument(documents.admin, recoveryRunId);
  assertUatDocument(documents.uat, recoveryRunId);
  if (documents.admin.generated_at !== documents.uat.generated_at
    || documents.admin.password === documents.uat.accounts[0]?.password
    || documents.uat.accounts.some((account) => account.password === documents.admin.password)) {
    throw new RecoveryError("RECOVERY_DOCUMENT_CROSS_CHECK_FAILED", "SCHEMA");
  }
}

export function assertRecoveryCredentialDocuments(documents: CredentialDocuments, recoveryRunId: string): void {
  assertCanonicalDocuments(documents, recoveryRunId);
  if (documents.uat.accounts.some((account) => account.must_change_password !== true)) {
    throw new RecoveryError("RECOVERY_UAT_INITIAL_STATE_INVALID", "SCHEMA");
  }
}

function resolveStagePaths(options: Pick<RecoveryOptions, "environment" | "recoveryRunId" | "stageDirectory">): StagePaths {
  if (options.environment === "parallel-uat") {
    if (options.stageDirectory && options.stageDirectory !== FORMAL_STAGE_DIRECTORY) {
      throw new RecoveryError("RECOVERY_STAGE_DIRECTORY_INVALID", "PRECHECK");
    }
    return {
      directory: FORMAL_STAGE_DIRECTORY,
      adminStage: path.join(FORMAL_STAGE_DIRECTORY, `.parallel-admin.txt.stage-${options.recoveryRunId}`),
      uatStage: path.join(FORMAL_STAGE_DIRECTORY, `.uat-role-accounts.txt.stage-${options.recoveryRunId}`),
      adminCanonical: path.join(FORMAL_STAGE_DIRECTORY, "parallel-admin.txt"),
      uatCanonical: path.join(FORMAL_STAGE_DIRECTORY, "uat-role-accounts.txt"),
      oldCandidate: path.join(FORMAL_STAGE_DIRECTORY, ".uat-role-accounts.txt.candidate-20260801025603-b821881a80"),
    };
  }
  const expected = path.join(REHEARSAL_STAGE_ROOT, options.recoveryRunId);
  if (options.stageDirectory !== expected) throw new RecoveryError("RECOVERY_STAGE_DIRECTORY_INVALID", "PRECHECK");
  return {
    directory: expected,
    adminStage: path.join(expected, `.parallel-admin.txt.stage-${options.recoveryRunId}`),
    uatStage: path.join(expected, `.uat-role-accounts.txt.stage-${options.recoveryRunId}`),
    adminCanonical: path.join(expected, "parallel-admin.txt"),
    uatCanonical: path.join(expected, "uat-role-accounts.txt"),
    oldCandidate: null,
  };
}

async function assertRootOnlyRegularFile(filePath: string): Promise<void> {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) {
    throw new RecoveryError("RECOVERY_FILE_METADATA_INVALID", "FILE");
  }
}

async function readRootOnlyRegularFile(filePath: string) {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()
      || metadata.uid !== 0
      || metadata.gid !== 0
      || (metadata.mode & 0o777) !== 0o600
      || metadata.nlink !== 1
      || metadata.size < 2
      || metadata.size > 65536) {
      throw new RecoveryError("RECOVERY_FILE_METADATA_INVALID", "FILE");
    }
    return { payload: await handle.readFile(), metadata };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_FILE_METADATA_INVALID", "FILE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function assertCredentialDiagnosticDirectory(directory: string): Promise<void> {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory()
      || metadata.isSymbolicLink()
      || metadata.uid !== 0
      || metadata.gid !== 0
      || (metadata.mode & 0o022) !== 0
      || await realpath(directory) !== directory) {
      throw new RecoveryError("RECOVERY_DIRECTORY_METADATA_INVALID", "FILE");
    }
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_DIRECTORY_METADATA_INVALID", "FILE");
  }
}

async function assertDirectoryMetadata(
  directory: string,
  formal: boolean,
  requireOldCandidate = true,
): Promise<void> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0
    || (stat.mode & 0o022) !== 0 || await realpath(directory) !== directory) {
    throw new RecoveryError("RECOVERY_DIRECTORY_METADATA_INVALID", "FILE");
  }
  if (formal) {
    await assertRootOnlyRegularFile(path.join(directory, "parallel-admin.txt"));
    await assertRootOnlyRegularFile(path.join(directory, "uat-role-accounts.txt"));
    if (requireOldCandidate) {
      await assertRootOnlyRegularFile(path.join(directory, ".uat-role-accounts.txt.candidate-20260801025603-b821881a80"));
    }
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveJson(
  filePath: string,
  value: unknown,
  afterLink?: () => void | Promise<void>,
): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.write-${randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let linkedTarget = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    await handle.chmod(0o600);
    await handle.chown(0, 0);
    await handle.close();
    handle = null;
    const verified = await open(temporary, "r");
    try { await verified.sync(); } finally { await verified.close(); }
    await link(temporary, filePath);
    linkedTarget = true;
    await afterLink?.();
    await safeUnlink(temporary);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await safeUnlink(temporary).catch(() => undefined);
    if (linkedTarget) await safeUnlink(filePath).catch(() => undefined);
    if (linkedTarget) await fsyncDirectory(path.dirname(filePath)).catch(() => undefined);
    throw error;
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(isPlainObject(error) && error.code === "ENOENT")) throw error;
  }
}

export async function writeCredentialStages(
  stages: StagePaths,
  documents: CredentialDocuments,
  hooks: RecoveryHooks = {},
): Promise<void> {
  let createdAdmin = false;
  let createdUat = false;
  try {
    await hooks.beforeStageWrite?.();
    await assertDirectoryMetadata(stages.directory, stages.directory === FORMAL_STAGE_DIRECTORY);
    await writeExclusiveJson(stages.adminStage, documents.admin, () => hooks.afterStageLink?.("admin"));
    createdAdmin = true;
    await writeExclusiveJson(stages.uatStage, documents.uat, () => hooks.afterStageLink?.("uat"));
    createdUat = true;
    await fsyncDirectory(stages.directory);
    const parsedAdmin = JSON.parse(await readFile(stages.adminStage, "utf8"));
    const parsedUat = JSON.parse(await readFile(stages.uatStage, "utf8"));
    assertRecoveryCredentialDocuments(
      { admin: parsedAdmin, uat: parsedUat } as CredentialDocuments,
      documents.admin.recovery_run_id,
    );
    await assertRootOnlyRegularFile(stages.adminStage);
    await assertRootOnlyRegularFile(stages.uatStage);
  } catch (error) {
    if (createdAdmin) await safeUnlink(stages.adminStage).catch(() => undefined);
    if (createdUat) await safeUnlink(stages.uatStage).catch(() => undefined);
    await fsyncDirectory(stages.directory).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_STAGE_WRITE_FAILED", "STAGE");
  }
}

async function installFromStage(stagePath: string, targetPath: string, expectedPayload?: Buffer): Promise<void> {
  await assertRootOnlyRegularFile(stagePath);
  const payload = await readFile(stagePath);
  if (expectedPayload && !payload.equals(expectedPayload)) {
    throw new RecoveryError("RECOVERY_STAGE_DATABASE_MISMATCH", "PROMOTION");
  }
  const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.install-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload);
      await handle.chmod(0o600);
      await handle.chown(0, 0);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, targetPath);
    await chmod(targetPath, 0o600);
    await chown(targetPath, 0, 0);
    const target = await open(targetPath, "r");
    try {
      await target.sync();
    } finally {
      await target.close();
    }
    await fsyncDirectory(path.dirname(targetPath));
  } catch (error) {
    await safeUnlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function promoteCredentialStages(
  stages: StagePaths,
  recoveryRunId: string,
  hooks: RecoveryHooks = {},
  expectedDocuments?: CredentialDocuments,
  candidateMayAlreadyBeRemoved = false,
): Promise<void> {
  try {
    await hooks.beforePromotion?.("admin");
    const expectedAdmin = expectedDocuments
      ? Buffer.from(`${JSON.stringify(expectedDocuments.admin, null, 2)}\n`)
      : undefined;
    await installFromStage(stages.adminStage, stages.adminCanonical, expectedAdmin);
    await hooks.beforePromotion?.("uat");
    const expectedUat = expectedDocuments
      ? Buffer.from(`${JSON.stringify(expectedDocuments.uat, null, 2)}\n`)
      : undefined;
    await installFromStage(stages.uatStage, stages.uatCanonical, expectedUat);

    const parsedAdmin = JSON.parse(await readFile(stages.adminCanonical, "utf8"));
    const parsedUat = JSON.parse(await readFile(stages.uatCanonical, "utf8"));
    assertRecoveryCredentialDocuments({ admin: parsedAdmin, uat: parsedUat } as CredentialDocuments, recoveryRunId);
    await assertRootOnlyRegularFile(stages.adminCanonical);
    await assertRootOnlyRegularFile(stages.uatCanonical);
    const adminStage = await readFile(stages.adminStage);
    const uatStage = await readFile(stages.uatStage);
    const adminCanonical = await readFile(stages.adminCanonical);
    const uatCanonical = await readFile(stages.uatCanonical);
    if (!adminStage.equals(adminCanonical) || !uatStage.equals(uatCanonical)) {
      throw new RecoveryError("RECOVERY_STAGE_CANONICAL_MISMATCH", "PROMOTION");
    }
    await fsyncDirectory(stages.directory);
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "RECOVERY_STAGE_DATABASE_MISMATCH") throw error;
    throw new RecoveryError("RECOVERY_CANONICAL_PROMOTION_FAILED", "PROMOTION");
  }
  try {
    if (stages.oldCandidate) {
      await hooks.beforePromotion?.("candidate");
      if (await exists(stages.oldCandidate)) {
        await assertRootOnlyRegularFile(stages.oldCandidate);
        await unlink(stages.oldCandidate);
        await fsyncDirectory(stages.directory);
      } else if (!candidateMayAlreadyBeRemoved) {
        throw new RecoveryError("RECOVERY_OLD_CANDIDATE_MISSING", "CLEANUP");
      }
    }
  } catch {
    throw new RecoveryError("RECOVERY_POST_PROMOTION_CLEANUP_FAILED", "CLEANUP");
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isPlainObject(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function browserVerificationEvidencePath(options: RecoveryOptions, stages: StagePaths): string {
  return options.environment === "parallel-uat"
    ? path.join(FORMAL_ATTESTATION_DIRECTORY, `identity-recovery-browser-${options.recoveryRunId}.json`)
    : path.join(stages.directory, "browser-verification.json");
}

async function assertBrowserVerificationEvidence(
  options: RecoveryOptions,
  stages: StagePaths,
  allowStale: boolean,
): Promise<{ issuedAtEpoch: number; promotedAtEpoch: number; digest: string }> {
  const expectedPath = browserVerificationEvidencePath(options, stages);
  if (options.browserVerificationEvidencePath !== expectedPath) {
    throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_REQUIRED", "FINALIZE");
  }
  try {
    const directory = path.dirname(expectedPath);
    const directoryMetadata = await lstat(directory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
      || directoryMetadata.uid !== 0 || directoryMetadata.gid !== 0
      || (directoryMetadata.mode & 0o022) !== 0 || await realpath(directory) !== directory) {
      throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_INVALID", "FINALIZE");
    }
    const metadata = await lstat(expectedPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
      || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1
      || metadata.size < 2 || metadata.size > 4096) {
      throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_INVALID", "FINALIZE");
    }
    const raw = await readFile(expectedPath);
    const value = JSON.parse(raw.toString("utf8"));
    const now = options.now ? Math.floor(options.now.getTime() / 1000) : Math.floor(Date.now() / 1000);
    if (!isPlainObject(value)
      || !exactKeys(value, [
        "format_version", "verifier_version", "recovery_run_id", "environment", "origin",
        "browser_image_id", "web_image_id", "accounts", "admin_login_count", "uat_login_count",
        "uat_force_change_count", "logout_count", "history_reload_count", "history_back_count",
        "history_forward_count", "blocked_request_count", "issued_at_epoch", "host_postcheck",
        "promoted_at_epoch",
      ])
      || value.format_version !== "chenyida-erp-browser-verification-v2"
      || value.verifier_version !== "offline-identity-recovery-browser-v2"
      || value.recovery_run_id !== options.recoveryRunId
      || value.environment !== options.environment
      || value.origin !== (options.environment === "parallel-uat"
        ? "https://43.135.148.43.nip.io:18888"
        : "http://127.0.0.1:3000")
      || value.browser_image_id !== "sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd"
      || value.web_image_id !== FORMAL_WEB_IMAGE
      || !Array.isArray(value.accounts)
      || value.accounts.length !== RECOVERY_ACCOUNTS.length
      || value.accounts.some((username, index) => username !== RECOVERY_ACCOUNTS[index].username)
      || value.admin_login_count !== 1
      || value.uat_login_count !== 10
      || value.uat_force_change_count !== 10
      || value.logout_count !== 11
      || value.history_reload_count !== 11
      || value.history_back_count !== 11
      || value.history_forward_count !== 11
      || value.blocked_request_count !== 0
      || !Number.isInteger(value.issued_at_epoch)
      || value.host_postcheck !== true
      || !Number.isInteger(value.promoted_at_epoch)
      || Number(value.promoted_at_epoch) < Number(value.issued_at_epoch)
      || Number(value.promoted_at_epoch) > now + 30
      || Number(value.issued_at_epoch) > now + 30
      || !allowStale && now - Number(value.issued_at_epoch) > 900) {
      throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_INVALID", "FINALIZE");
    }
    return {
      issuedAtEpoch: Number(value.issued_at_epoch),
      promotedAtEpoch: Number(value.promoted_at_epoch),
      digest: sha256(raw),
    };
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_INVALID", "FINALIZE");
  }
}

type FinalizationBinding = {
  browserEvidenceDigest: string;
  adminCanonicalDigest: string;
  uatCanonicalDigest: string;
  issuedAtEpoch: number;
  promotedAtEpoch: number;
};

export async function finalizeCredentialStages(
  stages: StagePaths,
  recoveryRunId: string,
  binding: FinalizationBinding,
  hooks: RecoveryHooks = {},
): Promise<void> {
  const preparedMarker = path.join(stages.directory, `.identity-recovery-finalize-${recoveryRunId}.prepared.json`);
  const completedMarker = path.join(stages.directory, `.identity-recovery-finalize-${recoveryRunId}.completed.json`);
  const preparedExists = await exists(preparedMarker);
  const completedExists = await exists(completedMarker);
  if (completedExists && !preparedExists) {
    throw new RecoveryError("RECOVERY_FINALIZE_MARKER_INVALID", "FINALIZE");
  }
  if (preparedExists) await assertFinalizationMarker(preparedMarker, recoveryRunId, "PREPARED", binding);
  if (completedExists) await assertFinalizationMarker(completedMarker, recoveryRunId, "COMPLETED", binding);
  await assertAvailableStagesMatchCanonical(stages, recoveryRunId, !preparedExists && !completedExists);
  try {
    if (!preparedExists) {
      await writeExclusiveJson(preparedMarker, {
        format_version: "chenyida-erp-identity-finalization-v2",
        recovery_run_id: recoveryRunId,
        state: "PREPARED",
        browser_evidence_sha256: binding.browserEvidenceDigest,
        admin_canonical_sha256: binding.adminCanonicalDigest,
        uat_canonical_sha256: binding.uatCanonicalDigest,
        issued_at_epoch: binding.issuedAtEpoch,
        promoted_at_epoch: binding.promotedAtEpoch,
        recorded_at_epoch: Math.floor(Date.now() / 1000),
      });
    }
    await hooks.beforeFinalization?.("admin-stage");
    await safeUnlink(stages.adminStage);
    await hooks.beforeFinalization?.("uat-stage");
    await safeUnlink(stages.uatStage);
    await hooks.beforeFinalization?.("directory");
    await fsyncDirectory(stages.directory);
    if (!await exists(completedMarker)) {
      await writeExclusiveJson(completedMarker, {
        format_version: "chenyida-erp-identity-finalization-v2",
        recovery_run_id: recoveryRunId,
        state: "COMPLETED",
        browser_evidence_sha256: binding.browserEvidenceDigest,
        admin_canonical_sha256: binding.adminCanonicalDigest,
        uat_canonical_sha256: binding.uatCanonicalDigest,
        issued_at_epoch: binding.issuedAtEpoch,
        promoted_at_epoch: binding.promotedAtEpoch,
        recorded_at_epoch: Math.floor(Date.now() / 1000),
      });
    }
    await assertFinalizationMarker(completedMarker, recoveryRunId, "COMPLETED", binding);
    await fsyncDirectory(stages.directory);
  } catch {
    try {
      if (await exists(completedMarker)) {
        await assertFinalizationMarker(completedMarker, recoveryRunId, "COMPLETED", binding);
        await safeUnlink(stages.adminStage);
        await safeUnlink(stages.uatStage);
        await fsyncDirectory(stages.directory);
        return;
      }
      if (!await exists(stages.adminStage)) await installFromStage(stages.adminCanonical, stages.adminStage);
      if (!await exists(stages.uatStage)) await installFromStage(stages.uatCanonical, stages.uatStage);
      await fsyncDirectory(stages.directory);
    } catch {
      throw new RecoveryError("RECOVERY_STAGE_FINALIZE_RESTORE_FAILED", "FINALIZE");
    }
    throw new RecoveryError("RECOVERY_STAGE_FINALIZE_FAILED", "FINALIZE");
  }
}

async function assertFinalizationMarker(
  markerPath: string,
  recoveryRunId: string,
  expectedState: "PREPARED" | "COMPLETED",
  binding?: FinalizationBinding,
): Promise<FinalizationBinding> {
  await assertRootOnlyRegularFile(markerPath);
  let value: unknown;
  try { value = JSON.parse(await readFile(markerPath, "utf8")); } catch {
    throw new RecoveryError("RECOVERY_FINALIZE_MARKER_INVALID", "FINALIZE");
  }
  if (!isPlainObject(value)
    || !exactKeys(value, [
      "format_version", "recovery_run_id", "state", "browser_evidence_sha256",
      "admin_canonical_sha256", "uat_canonical_sha256", "issued_at_epoch",
      "promoted_at_epoch", "recorded_at_epoch",
    ])
    || value.format_version !== "chenyida-erp-identity-finalization-v2"
    || value.recovery_run_id !== recoveryRunId
    || value.state !== expectedState
    || typeof value.browser_evidence_sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.browser_evidence_sha256)
    || typeof value.admin_canonical_sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.admin_canonical_sha256)
    || typeof value.uat_canonical_sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.uat_canonical_sha256)
    || !Number.isInteger(value.issued_at_epoch)
    || !Number.isInteger(value.promoted_at_epoch)
    || Number(value.issued_at_epoch) <= 0
    || Number(value.promoted_at_epoch) < Number(value.issued_at_epoch)
    || !Number.isInteger(value.recorded_at_epoch)
    || Number(value.recorded_at_epoch) <= 0
    || Number(value.recorded_at_epoch) > Math.floor(Date.now() / 1000) + 30
    || binding && (value.browser_evidence_sha256 !== binding.browserEvidenceDigest
      || value.admin_canonical_sha256 !== binding.adminCanonicalDigest
      || value.uat_canonical_sha256 !== binding.uatCanonicalDigest
      || value.issued_at_epoch !== binding.issuedAtEpoch
      || value.promoted_at_epoch !== binding.promotedAtEpoch)) {
    throw new RecoveryError("RECOVERY_FINALIZE_MARKER_INVALID", "FINALIZE");
  }
  return {
    browserEvidenceDigest: value.browser_evidence_sha256,
    adminCanonicalDigest: value.admin_canonical_sha256,
    uatCanonicalDigest: value.uat_canonical_sha256,
    issuedAtEpoch: Number(value.issued_at_epoch),
    promotedAtEpoch: Number(value.promoted_at_epoch),
  };
}

async function assertAvailableStagesMatchCanonical(
  stages: StagePaths,
  recoveryRunId: string,
  requireBothStages: boolean,
): Promise<void> {
  await assertRootOnlyRegularFile(stages.adminCanonical);
  await assertRootOnlyRegularFile(stages.uatCanonical);
  const adminCanonical = await readFile(stages.adminCanonical);
  const uatCanonical = await readFile(stages.uatCanonical);
  const adminStageExists = await exists(stages.adminStage);
  const uatStageExists = await exists(stages.uatStage);
  if (requireBothStages && (!adminStageExists || !uatStageExists)) {
    throw new RecoveryError("RECOVERY_STAGE_FINALIZE_STATE_UNKNOWN", "FINALIZE");
  }
  if (adminStageExists) {
    await assertRootOnlyRegularFile(stages.adminStage);
    if (!(await readFile(stages.adminStage)).equals(adminCanonical)) {
      throw new RecoveryError("RECOVERY_STAGE_CANONICAL_MISMATCH", "FINALIZE");
    }
  }
  if (uatStageExists) {
    await assertRootOnlyRegularFile(stages.uatStage);
    if (!(await readFile(stages.uatStage)).equals(uatCanonical)) {
      throw new RecoveryError("RECOVERY_STAGE_CANONICAL_MISMATCH", "FINALIZE");
    }
  }
  await validateRecoveryCredentialFiles(stages.adminCanonical, stages.uatCanonical, recoveryRunId);
}

export function assertStaticGuards(input: {
  environment: string;
  deploymentClass: string;
  expectedMigration: string;
  recoveryRunId: string;
  confirmation: boolean;
  effectiveUid: number;
}): asserts input is {
  environment: RecoveryEnvironment;
  deploymentClass: string;
  expectedMigration: string;
  recoveryRunId: string;
  confirmation: true;
  effectiveUid: 0;
} {
  if (input.environment !== "parallel-uat" && input.environment !== "parallel-uat-rehearsal") {
    throw new RecoveryError("RECOVERY_ENVIRONMENT_INVALID", "PRECHECK");
  }
  if (input.deploymentClass === "production") throw new RecoveryError("RECOVERY_PRODUCTION_FORBIDDEN", "PRECHECK");
  if (input.environment === "parallel-uat" && input.deploymentClass !== "uat") {
    throw new RecoveryError("RECOVERY_DEPLOYMENT_CLASS_INVALID", "PRECHECK");
  }
  if (input.environment === "parallel-uat-rehearsal" && !["test", "uat"].includes(input.deploymentClass)) {
    throw new RecoveryError("RECOVERY_DEPLOYMENT_CLASS_INVALID", "PRECHECK");
  }
  if (input.effectiveUid !== 0) throw new RecoveryError("RECOVERY_ROOT_REQUIRED", "PRECHECK");
  if (input.expectedMigration !== "0036") throw new RecoveryError("RECOVERY_EXPECTED_MIGRATION_INVALID", "PRECHECK");
  if (!UUID_V4.test(input.recoveryRunId)) throw new RecoveryError("RECOVERY_RUN_ID_INVALID", "PRECHECK");
  if (!input.confirmation) throw new RecoveryError("RECOVERY_CONFIRMATION_REQUIRED", "PRECHECK");
}

function parseDatabaseUrl(databaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new RecoveryError("RECOVERY_DATABASE_URL_REJECTED", "PRECHECK");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "postgres"
    || !["", "5432"].includes(parsed.port)
    || !parsed.username
    || !parsed.password
    || parsed.search
    || parsed.hash) {
    throw new RecoveryError("RECOVERY_DATABASE_URL_REJECTED", "PRECHECK");
  }
  return parsed;
}

async function assertOfflineAttestation(filePath: string | undefined, recoveryRunId: string): Promise<void> {
  const expectedPath = path.join(FORMAL_ATTESTATION_DIRECTORY, `offline-identity-recovery-${recoveryRunId}.json`);
  if (filePath !== expectedPath) throw new RecoveryError("RECOVERY_OFFLINE_ATTESTATION_REQUIRED", "OFFLINE");
  try {
    await assertRootOnlyRegularFile(expectedPath);
    const value = JSON.parse(await readFile(expectedPath, "utf8"));
    if (!isPlainObject(value)
      || !exactKeys(value, [
        "format_version", "recovery_run_id", "issued_at_epoch",
        "web_name", "web_state", "web_container_id", "web_image_id", "web_project", "web_service",
        "worker_name", "worker_state", "worker_container_id", "worker_image_id", "worker_project", "worker_service",
      ])
      || value.format_version !== "chenyida-erp-offline-attestation-v1"
      || value.recovery_run_id !== recoveryRunId
      || value.web_name !== "chenyida-erp-parallel-web-1"
      || value.worker_name !== "chenyida-erp-parallel-worker-1"
      || value.web_project !== "chenyida-erp-parallel"
      || value.worker_project !== "chenyida-erp-parallel"
      || value.web_service !== "web"
      || value.worker_service !== "worker"
      || value.web_image_id !== FORMAL_WEB_IMAGE
      || value.worker_image_id !== FORMAL_WORKER_IMAGE
      || !/^[0-9a-f]{64}$/.test(String(value.web_container_id))
      || !/^[0-9a-f]{64}$/.test(String(value.worker_container_id))
      || !Number.isInteger(value.issued_at_epoch)
      || Math.abs(Math.floor(Date.now() / 1000) - Number(value.issued_at_epoch)) > 120) {
      throw new RecoveryError("RECOVERY_OFFLINE_ATTESTATION_INVALID", "OFFLINE");
    }
    assertOfflineState(String(value.web_state), String(value.worker_state), 0, 0);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_OFFLINE_ATTESTATION_INVALID", "OFFLINE");
  }
}

export function assertOfflineState(
  webState: string,
  workerState: string,
  writerConnections: number,
  otherConnections: number,
): void {
  if (webState !== "exited" || workerState !== "exited"
    || writerConnections !== 0 || otherConnections !== 0) {
    throw new RecoveryError("RECOVERY_WRITERS_STILL_ACTIVE", "OFFLINE");
  }
}

export function assertObservedDatabaseState(row: {
  current_database: string;
  current_user: string;
  read_only: string;
  migration_count: number;
  migration_head: string;
}, expectedDatabase: string, expectedMigration: string, expectedReadOnly = "off"): void {
  if (row.current_database !== expectedDatabase
    || row.current_user !== FORMAL_DATABASE_USER
    || row.read_only !== expectedReadOnly) {
    throw new RecoveryError("RECOVERY_DATABASE_IDENTITY_REJECTED", "DATABASE");
  }
  if (expectedMigration !== "0036" || Number(row.migration_count) !== 36 || row.migration_head !== EXPECTED_MIGRATION_HEAD) {
    throw new RecoveryError("RECOVERY_MIGRATION_MISMATCH", "DATABASE");
  }
}

async function observedDatabaseState(client: Pool | PoolClient): Promise<{
  current_database: string;
  current_user: string;
  read_only: string;
  migration_count: number;
  migration_head: string;
  writer_connections: number;
  other_connections: number;
}> {
  const result = await client.query<{
    current_database: string;
    current_user: string;
    read_only: string;
    migration_count: number;
    migration_head: string;
    writer_connections: number;
    other_connections: number;
  }>(`
    select current_database(),current_user,current_setting('transaction_read_only') read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) migration_head,
      (select count(*)::int from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid()
          and application_name in ('chenyida-erp-web','chenyida-erp-worker')) writer_connections,
      (select count(*)::int from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid()
          and backend_type='client backend') other_connections
  `);
  const row = result.rows[0];
  if (!row) throw new RecoveryError("RECOVERY_DATABASE_IDENTITY_REJECTED", "DATABASE");
  return row;
}

async function assertObservedPreflight(
  client: Pool | PoolClient,
  expectedDatabase: string,
  expectedMigration: string,
  expectedReadOnly = "off",
): Promise<void> {
  const row = await observedDatabaseState(client);
  assertObservedDatabaseState(row, expectedDatabase, expectedMigration, expectedReadOnly);
  await assertExpectedMigrations(client);
  assertOfflineState("exited", "exited", Number(row.writer_connections), Number(row.other_connections));
}

async function assertExpectedMigrations(client: Pool | PoolClient): Promise<void> {
  const migrations = await client.query<{ version: string; checksum: string }>(
    "select version,checksum from schema_migrations order by version",
  );
  if (migrations.rowCount !== EXPECTED_MIGRATIONS.length
    || migrations.rows.some((migration, index) => migration.version !== EXPECTED_MIGRATIONS[index][0]
      || migration.checksum !== EXPECTED_MIGRATIONS[index][1])) {
    throw new RecoveryError("RECOVERY_MIGRATION_MISMATCH", "DATABASE");
  }
}

export async function assertInspectionDatabaseState(pool: Pool, expectedDatabase: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const row = await observedDatabaseState(client);
    assertObservedDatabaseState(row, expectedDatabase, "0036", "on");
    await assertExpectedMigrations(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_DATABASE_INSPECTION_FAILED", "DATABASE");
  } finally {
    client.release();
  }
}

async function assertDatabasePreflight(options: RecoveryOptions, parsedUrl: URL): Promise<string> {
  const expectedDatabase = options.environment === "parallel-uat"
    ? FORMAL_DATABASE
    : String(options.expectedDatabaseName || "");
  const urlDatabase = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  const urlUser = decodeURIComponent(parsedUrl.username);
  if (options.environment === "parallel-uat") {
    if (expectedDatabase !== FORMAL_DATABASE || urlDatabase !== FORMAL_DATABASE || urlUser !== FORMAL_DATABASE_USER) {
      throw new RecoveryError("RECOVERY_DATABASE_IDENTITY_REJECTED", "DATABASE");
    }
    await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
  } else if (!REHEARSAL_DATABASE.test(expectedDatabase)
    || urlDatabase !== expectedDatabase
    || urlUser !== FORMAL_DATABASE_USER) {
    throw new RecoveryError("RECOVERY_DATABASE_IDENTITY_REJECTED", "DATABASE");
  }

  await assertObservedPreflight(options.pool, expectedDatabase, options.expectedMigration);
  return expectedDatabase;
}

function requestDigest(environment: RecoveryEnvironment, expectedMigration: string): string {
  return sha256(JSON.stringify({
    environment,
    expected_migration: expectedMigration,
    accounts: RECOVERY_ACCOUNTS.map((account) => ({
      username: account.username,
      role: account.role,
      must_change_password: account.mustChangePassword,
    })),
  }));
}

async function assertRunIdNotCommitted(pool: Pool, recoveryRunId: string): Promise<void> {
  const markerDigest = sha256(`${RECOVERY_ACTION}\n${recoveryRunId}`);
  const result = await pool.query<{ count: number }>(
    "select count(*)::int count from idempotency_keys where key_digest=$1",
    [markerDigest],
  );
  if (Number(result.rows[0]?.count) !== 0) throw new RecoveryError("RECOVERY_RUN_REPLAYED", "PRECHECK");
}

type SessionLockState = {
  recovery: boolean;
  migration: boolean;
};

async function acquireRecoverySessionLocks(
  client: PoolClient,
  state: SessionLockState,
  phase: string,
): Promise<void> {
  const recoveryLock = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock(hashtextextended($1,0)) locked",
    [`${RECOVERY_ACTION}:GLOBAL`],
  );
  state.recovery = recoveryLock.rows[0]?.locked === true;
  const migrationLock = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock(hashtext('chenyida_erp_schema_migration')) locked",
  );
  state.migration = migrationLock.rows[0]?.locked === true;
  if (!state.recovery || !state.migration) {
    throw new RecoveryError("RECOVERY_CONCURRENT_OPERATION", phase);
  }
}

async function releaseRecoverySessionLocks(client: PoolClient, state: SessionLockState): Promise<boolean> {
  try {
    if (state.migration) {
      await client.query("select pg_advisory_unlock(hashtext('chenyida_erp_schema_migration'))");
      state.migration = false;
    }
    if (state.recovery) {
      await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [`${RECOVERY_ACTION}:GLOBAL`]);
      state.recovery = false;
    }
    return true;
  } catch {
    return false;
  }
}

async function performRecoveryTransaction(
  options: RecoveryOptions,
  documents: CredentialDocuments,
  expectedDatabase: string,
  client: PoolClient,
  lockState: SessionLockState,
): Promise<{ sessionRevokedCount: number; auditCount: number }> {
  const repository = new PostgresIdentityRepository(options.pool);
  const markerDigest = sha256(`${RECOVERY_ACTION}\n${options.recoveryRunId}`);
  let commitAttempted = false;
  try {
    await client.query("begin isolation level serializable");
    await acquireRecoverySessionLocks(client, lockState, "TRANSACTION");
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration);
    const marker = await client.query(`
      insert into idempotency_keys(
        key_digest,username,method,path,request_digest,status_code,response,expires_at,created_at
      ) values($1,$2,'OFFLINE',$3,$4,200,$5,'infinity',transaction_timestamp())
      on conflict(key_digest) do nothing returning key_digest
    `, [
      markerDigest,
      RECOVERY_ACTOR,
      `identity-recovery:${options.environment}`,
      requestDigest(options.environment, options.expectedMigration),
      { status: "COMMITTED", recovery_run_id: options.recoveryRunId, environment: options.environment, account_count: RECOVERY_ACCOUNTS.length },
    ]);
    if (marker.rowCount !== 1) throw new RecoveryError("RECOVERY_RUN_REPLAYED", "TRANSACTION");

    const usernames = RECOVERY_ACCOUNTS.map((account) => account.username);
    const locked = await client.query<LockedUser>(`
      select username,role,is_active,must_change_password,version
      from app_users where username=any($1::text[]) order by username for update
    `, [usernames]);
    if (locked.rowCount !== RECOVERY_ACCOUNTS.length) {
      throw new RecoveryError("RECOVERY_ACCOUNT_COUNT_MISMATCH", "TRANSACTION");
    }
    const byUsername = new Map(locked.rows.map((row) => [row.username, row]));
    for (const expected of RECOVERY_ACCOUNTS) {
      const row = byUsername.get(expected.username);
      if (!row || row.username !== expected.username || row.role !== expected.role || row.is_active !== true) {
        throw new RecoveryError("RECOVERY_ACCOUNT_INVARIANT_MISMATCH", "TRANSACTION");
      }
    }

    const secrets = new Map<string, string>([
      [documents.admin.username, documents.admin.password],
      ...documents.uat.accounts.map((account) => [account.username, account.password] as [string, string]),
    ]);
    let sessionRevokedCount = 0;
    for (let index = 0; index < RECOVERY_ACCOUNTS.length; index += 1) {
      const expected = RECOVERY_ACCOUNTS[index];
      const current = byUsername.get(expected.username)!;
      const password = secrets.get(expected.username);
      if (!password) throw new RecoveryError("RECOVERY_STAGE_ACCOUNT_MISMATCH", "TRANSACTION");
      validatePassword(password, expected.username);
      const newHash = await hashPassword(password);
      const updated = await client.query<LockedUser>(`
        update app_users set password_hash=$2,must_change_password=$3,
          version=version+1,updated_at=transaction_timestamp()
        where username=$1 and version=$4 and role=$5 and is_active=true
        returning username,role,is_active,must_change_password,version
      `, [expected.username, newHash, expected.mustChangePassword, current.version, expected.role]);
      const changed = updated.rows[0];
      if (updated.rowCount !== 1
        || !changed
        || changed.username !== expected.username
        || changed.role !== expected.role
        || changed.is_active !== true
        || changed.must_change_password !== expected.mustChangePassword
        || Number(changed.version) !== Number(current.version) + 1) {
        throw new RecoveryError("RECOVERY_USER_UPDATE_FAILED", "TRANSACTION");
      }
      const revoked = await repository.revokeUserSessions(client, expected.username, "PASSWORD_RESET");
      sessionRevokedCount += revoked;
      await repository.recordAudit(client, {
        actor: RECOVERY_ACTOR,
        action: RECOVERY_ACTION,
        targetUsername: expected.username,
        result: "success",
        requestId: options.recoveryRunId,
        operationId: options.recoveryRunId,
        idempotencyKeyDigest: markerDigest,
        oldVersion: Number(current.version),
        newVersion: Number(changed.version),
        safeDetails: {
          actor_type: "SYSTEM_RECOVERY_CLI",
          execution_mode: "OFFLINE",
          environment: options.environment,
          recovery_run_id: options.recoveryRunId,
          reason_code: RECOVERY_REASON_CODE,
          reason: RECOVERY_REASON,
          session_revoked_count: revoked,
        },
      });
      await options.hooks?.afterUserUpdate?.(index);
    }
    const remaining = await client.query<{ count: number }>(`
      select count(*)::int count from app_sessions
      where username=any($1::text[]) and revoked_at is null
    `, [usernames]);
    if (Number(remaining.rows[0]?.count) !== 0) {
      throw new RecoveryError("RECOVERY_SESSION_REVOCATION_INCOMPLETE", "TRANSACTION");
    }
    const audit = await client.query<{ target_username: string; count: number }>(`
      select target_username,count(*)::int count from audit_log
      where action=$1 and operation_id=$2::uuid and target_username=any($3::text[])
      group by target_username order by target_username
    `, [RECOVERY_ACTION, options.recoveryRunId, usernames]);
    if (audit.rowCount !== RECOVERY_ACCOUNTS.length
      || audit.rows.some((row) => Number(row.count) !== 1)
      || audit.rows.some((row) => !usernames.includes(row.target_username))) {
      throw new RecoveryError("RECOVERY_AUDIT_COUNT_MISMATCH", "TRANSACTION");
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration);
    commitAttempted = true;
    await client.query("commit");
    await options.hooks?.afterCommitAcknowledged?.();
    return { sessionRevokedCount, auditCount: RECOVERY_ACCOUNTS.length };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (commitAttempted) throw new RecoveryError("RECOVERY_COMMIT_OUTCOME_UNKNOWN", "TRANSACTION");
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_TRANSACTION_FAILED", "TRANSACTION");
  }
}

async function verifyCommitOutcome(
  options: RecoveryOptions,
  client: Pool | PoolClient = options.pool,
  requireNoActiveSessions = true,
): Promise<{ state: "committed"; sessionRevokedCount: number } | { state: "not_committed" } | { state: "unknown" }> {
  try {
    await options.hooks?.beforeCommitVerification?.();
    const markerDigest = sha256(`${RECOVERY_ACTION}\n${options.recoveryRunId}`);
    const usernames = RECOVERY_ACCOUNTS.map((account) => account.username);
    const evidence = await client.query<{
      marker_count: number;
      operation_audit_count: number;
      audit_count: number;
      audit_target_count: number;
      session_revoked_count: number;
      target_count: number;
      active_session_count: number;
      matched_target_count: number;
    }>(`
      select
        (select count(*)::int from idempotency_keys
          where key_digest=$1 and username=$2 and method='OFFLINE'
            and path=$6 and request_digest=$7 and status_code=200
            and response->>'status'='COMMITTED'
            and response->>'recovery_run_id'=$4::text
            and response->>'environment'=$8
            and (response->>'account_count')::int=11
            and expires_at='infinity') marker_count,
        (select count(*)::int from audit_log where operation_id=$4::uuid) operation_audit_count,
        (select count(*)::int from audit_log
          where username=$2 and action=$3 and operation_id=$4::uuid and result='success'
            and request_id=$4::uuid and route_code='IDENTITY'
            and idempotency_key_digest=$1 and old_version is not null
            and new_version=old_version+1 and error_code is null
            and target_username=any($5::text[])
            and detail->>'recovery_run_id'=$4::text
            and detail->>'reason_code'=$9
            and detail->>'reason'=$10
            and detail->>'actor_type'='SYSTEM_RECOVERY_CLI'
            and detail->>'execution_mode'='OFFLINE'
            and detail->>'environment'=$8) audit_count,
        (select count(distinct target_username)::int from audit_log
          where username=$2 and action=$3 and operation_id=$4::uuid and result='success'
            and request_id=$4::uuid and route_code='IDENTITY'
            and idempotency_key_digest=$1 and old_version is not null
            and new_version=old_version+1 and error_code is null
            and target_username=any($5::text[])
            and detail->>'recovery_run_id'=$4::text
            and detail->>'reason_code'=$9
            and detail->>'reason'=$10
            and detail->>'actor_type'='SYSTEM_RECOVERY_CLI'
            and detail->>'execution_mode'='OFFLINE'
            and detail->>'environment'=$8) audit_target_count,
        (select coalesce(sum((detail->>'session_revoked_count')::int),0)::int from audit_log
          where username=$2 and action=$3 and operation_id=$4::uuid and result='success'
            and request_id=$4::uuid and route_code='IDENTITY'
            and idempotency_key_digest=$1 and old_version is not null
            and new_version=old_version+1 and error_code is null
            and target_username=any($5::text[])
            and detail->>'recovery_run_id'=$4::text
            and detail->>'reason_code'=$9
            and detail->>'reason'=$10
            and detail->>'actor_type'='SYSTEM_RECOVERY_CLI'
            and detail->>'execution_mode'='OFFLINE'
            and detail->>'environment'=$8) session_revoked_count,
        (select count(*)::int from app_users where username=any($5::text[])) target_count,
        (select count(*)::int from app_sessions
          where username=any($5::text[]) and revoked_at is null) active_session_count,
        (select count(*)::int
          from app_users u join audit_log a
            on a.target_username=u.username and a.operation_id=$4::uuid
              and a.username=$2 and a.action=$3 and a.result='success'
              and a.request_id=$4::uuid and a.route_code='IDENTITY'
              and a.idempotency_key_digest=$1 and a.old_version is not null
              and a.new_version=a.old_version+1 and a.error_code is null
              and a.detail->>'recovery_run_id'=$4::text
              and a.detail->>'reason_code'=$9
              and a.detail->>'reason'=$10
              and a.detail->>'actor_type'='SYSTEM_RECOVERY_CLI'
              and a.detail->>'execution_mode'='OFFLINE'
              and a.detail->>'environment'=$8
          join (values
            ('admin','admin',false),
            ('uat_20260729_manager','manager',true),
            ('uat_20260729_sales','sales',true),
            ('uat_20260729_engineering','engineering',true),
            ('uat_20260729_planning','planning',true),
            ('uat_20260729_purchase','purchase',true),
            ('uat_20260729_warehouse','warehouse',true),
            ('uat_20260729_production','production',true),
            ('uat_20260729_quality','quality',true),
            ('uat_20260729_finance','finance',true),
            ('uat_20260729_operations','operations',true)
          ) expected(username,role,must_change_password)
            on expected.username=u.username
          where u.role=expected.role and u.is_active=true
            and u.must_change_password=expected.must_change_password
            and u.version=a.new_version) matched_target_count
    `, [
      markerDigest,
      RECOVERY_ACTOR,
      RECOVERY_ACTION,
      options.recoveryRunId,
      usernames,
      `identity-recovery:${options.environment}`,
      requestDigest(options.environment, options.expectedMigration),
      options.environment,
      RECOVERY_REASON_CODE,
      RECOVERY_REASON,
    ]);
    const row = evidence.rows[0];
    if (!row) return { state: "unknown" };
    if (Number(row.marker_count) === 0 && Number(row.audit_count) === 0) return { state: "not_committed" };
    if (Number(row.marker_count) === 1
      && Number(row.operation_audit_count) === RECOVERY_ACCOUNTS.length
      && Number(row.audit_count) === RECOVERY_ACCOUNTS.length
      && Number(row.audit_target_count) === RECOVERY_ACCOUNTS.length
      && Number(row.target_count) === RECOVERY_ACCOUNTS.length
      && (!requireNoActiveSessions || Number(row.active_session_count) === 0)
      && Number(row.matched_target_count) === RECOVERY_ACCOUNTS.length) {
      return { state: "committed", sessionRevokedCount: Number(row.session_revoked_count) };
    }
    return { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

async function assertCommittedAccountState(
  client: PoolClient,
  documents: CredentialDocuments,
): Promise<void> {
  const usernames = RECOVERY_ACCOUNTS.map((account) => account.username);
  const users = await client.query<LockedUser & { password_hash: string }>(`
    select username,role,is_active,must_change_password,version,password_hash
    from app_users where username=any($1::text[]) order by username
  `, [usernames]);
  if (users.rowCount !== RECOVERY_ACCOUNTS.length) {
    throw new RecoveryError("RECOVERY_ACCOUNT_COUNT_MISMATCH", "VERIFICATION");
  }
  const secrets = new Map<string, string>([
    [documents.admin.username, documents.admin.password],
    ...documents.uat.accounts.map((account) => [account.username, account.password] as [string, string]),
  ]);
  const byUsername = new Map(users.rows.map((row) => [row.username, row]));
  for (const expected of RECOVERY_ACCOUNTS) {
    const row = byUsername.get(expected.username);
    const secret = secrets.get(expected.username);
    if (!row || !secret || row.role !== expected.role || row.is_active !== true
      || row.must_change_password !== expected.mustChangePassword) {
      throw new RecoveryError("RECOVERY_ACCOUNT_INVARIANT_MISMATCH", "VERIFICATION");
    }
    let matches = false;
    try {
      matches = await verifyPassword(secret, row.password_hash);
    } catch {
      matches = false;
    }
    if (!matches) throw new RecoveryError("RECOVERY_STAGE_DATABASE_MISMATCH", "VERIFICATION");
  }
}

async function withCommittedRecoveryEvidence<T>(
  options: RecoveryOptions,
  parsedUrl: URL,
  documents: CredentialDocuments,
  operation: (outcome: { state: "committed"; sessionRevokedCount: number }, client: PoolClient) => Promise<T>,
): Promise<{ value: T; outcome: { state: "committed"; sessionRevokedCount: number } }> {
  const expectedDatabase = await assertDatabasePreflight(options, parsedUrl);
  const client = await options.pool.connect();
  let transactionOpen = false;
  const lockState: SessionLockState = { recovery: false, migration: false };
  let destroyClient = false;
  try {
    await client.query("begin isolation level repeatable read read only");
    transactionOpen = true;
    await acquireRecoverySessionLocks(client, lockState, "VERIFICATION");
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration, "on");
    const outcome = await verifyCommitOutcome(options, client);
    if (outcome.state !== "committed") {
      throw new RecoveryError("RECOVERY_COMMITTED_EVIDENCE_REQUIRED", "VERIFICATION");
    }
    await assertCommittedAccountState(client, documents);
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration, "on");
    await client.query("commit");
    transactionOpen = false;
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration);
    const value = await operation(outcome, client);
    return { value, outcome };
  } catch (error) {
    if (transactionOpen) await client.query("rollback").catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_VERIFICATION_FAILED", "VERIFICATION");
  } finally {
    if (!await releaseRecoverySessionLocks(client, lockState)) destroyClient = true;
    client.release(destroyClient);
  }
}

export async function executeRecovery(options: RecoveryOptions): Promise<RecoveryResult> {
  assertStaticGuards({
    environment: options.environment,
    deploymentClass: options.deploymentClass,
    expectedMigration: options.expectedMigration,
    recoveryRunId: options.recoveryRunId,
    confirmation: options.confirmation,
    effectiveUid: options.effectiveUid,
  });
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  const stages = resolveStagePaths(options);
  const expectedDatabase = await assertDatabasePreflight(options, parsedUrl);
  await assertRunIdNotCommitted(options.pool, options.recoveryRunId);
  const documents = createCredentialDocuments(options.recoveryRunId, options.now);
  await writeCredentialStages(stages, documents, options.hooks);
  let client: PoolClient;
  try {
    await options.hooks?.beforeDatabaseConnect?.();
    client = await options.pool.connect();
  } catch {
    await safeUnlink(stages.adminStage).catch(() => undefined);
    await safeUnlink(stages.uatStage).catch(() => undefined);
    await fsyncDirectory(stages.directory).catch(() => undefined);
    throw new RecoveryError("RECOVERY_DATABASE_CONNECT_FAILED", "DATABASE");
  }
  const lockState: SessionLockState = { recovery: false, migration: false };
  let destroyClient = false;
  try {
    let transaction: { sessionRevokedCount: number; auditCount: number };
    try {
      transaction = await performRecoveryTransaction(options, documents, expectedDatabase, client, lockState);
    } catch (error) {
      if (error instanceof RecoveryError && error.code === "RECOVERY_COMMIT_OUTCOME_UNKNOWN") {
        const outcome = await verifyCommitOutcome(options, client);
        if (outcome.state === "committed") {
          transaction = { sessionRevokedCount: outcome.sessionRevokedCount, auditCount: RECOVERY_ACCOUNTS.length };
        } else if (outcome.state === "unknown") {
          return {
            status: "partial",
            accountCount: 0,
            sessionRevokedCount: 0,
            auditCount: 0,
            recoveryRunId: options.recoveryRunId,
            stages,
            promotionCode: "RECOVERY_COMMIT_OUTCOME_UNKNOWN",
            partialPhase: "TRANSACTION_OUTCOME",
          };
        } else {
          await safeUnlink(stages.adminStage).catch(() => undefined);
          await safeUnlink(stages.uatStage).catch(() => undefined);
          await fsyncDirectory(stages.directory).catch(() => undefined);
          throw new RecoveryError("RECOVERY_TRANSACTION_FAILED", "TRANSACTION");
        }
      } else {
        await safeUnlink(stages.adminStage).catch(() => undefined);
        await safeUnlink(stages.uatStage).catch(() => undefined);
        await fsyncDirectory(stages.directory).catch(() => undefined);
        throw error;
      }
    }

    if (options.promote) {
      try {
        if (options.environment === "parallel-uat") {
          await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
        }
        await assertObservedPreflight(client, expectedDatabase, options.expectedMigration);
        await promoteCredentialStages(stages, options.recoveryRunId, options.hooks, documents);
      } catch (error) {
        return {
          status: "partial",
          accountCount: RECOVERY_ACCOUNTS.length,
          sessionRevokedCount: transaction.sessionRevokedCount,
          auditCount: transaction.auditCount,
          recoveryRunId: options.recoveryRunId,
          stages,
          promotionCode: error instanceof RecoveryError ? error.code : "RECOVERY_CANONICAL_PROMOTION_FAILED",
          partialPhase: "PROMOTION",
        };
      }
    }

    return {
      status: options.promote ? "canonical_active" : "staged",
      accountCount: RECOVERY_ACCOUNTS.length,
      sessionRevokedCount: transaction.sessionRevokedCount,
      auditCount: transaction.auditCount,
      recoveryRunId: options.recoveryRunId,
      stages,
    };
  } finally {
    if (!await releaseRecoverySessionLocks(client, lockState)) destroyClient = true;
    client.release(destroyClient);
  }
}

async function verifySessionCleanupOutcome(
  options: RecoveryOptions,
  username: string,
  cleanupMarker: string,
  client: Pool | PoolClient = options.pool,
): Promise<{ state: "committed"; sessionRevokedCount: number } | { state: "not_committed" } | { state: "unknown" }> {
  try {
    const cleanupRequestDigest = sha256(JSON.stringify({
      recovery_run_id: options.recoveryRunId,
      account: username,
    }));
    const result = await client.query<{
      marker_count: number;
      audit_count: number;
      session_revoked_count: number;
      remaining_session_count: number;
    }>(`
      with marker as (
        select response->>'operation_id' operation_id
        from idempotency_keys
        where key_digest=$1 and username=$2 and method='OFFLINE'
          and path=$3 and request_digest=$4 and status_code=200
          and response->>'status'='COMMITTED'
          and response->>'recovery_run_id'=$5::text
          and response->>'environment'=$6
          and response->>'username'=$7
          and expires_at='infinity'
      )
      select
        (select count(*)::int from marker) marker_count,
        (select count(*)::int from audit_log a join marker m on a.operation_id=m.operation_id::uuid
          where a.username=$2 and a.action=$8 and a.result='success'
            and a.request_id=$5::uuid and a.route_code='IDENTITY'
            and a.idempotency_key_digest=$1 and a.target_username=$7
            and a.old_version is null and a.new_version is null and a.error_code is null
            and a.detail->>'actor_type'='SYSTEM_RECOVERY_CLI'
            and a.detail->>'execution_mode'='OFFLINE_BROWSER_FAILURE_CLEANUP'
            and a.detail->>'environment'=$6
            and a.detail->>'recovery_run_id'=$5::text
            and a.detail->>'reason_code'='BROWSER_SESSION_CLEANUP_UNCERTAIN') audit_count,
        (select coalesce(sum((a.detail->>'session_revoked_count')::int),0)::int
          from audit_log a join marker m on a.operation_id=m.operation_id::uuid
          where a.username=$2 and a.action=$8 and a.result='success'
            and a.request_id=$5::uuid and a.route_code='IDENTITY'
            and a.idempotency_key_digest=$1 and a.target_username=$7
            and a.detail->>'recovery_run_id'=$5::text) session_revoked_count,
        (select count(*)::int from app_sessions
          where username=$7 and revoked_at is null) remaining_session_count
    `, [
      cleanupMarker,
      RECOVERY_ACTOR,
      `identity-recovery-session-cleanup:${options.environment}`,
      cleanupRequestDigest,
      options.recoveryRunId,
      options.environment,
      username,
      RECOVERY_SESSION_CLEANUP_ACTION,
    ]);
    const row = result.rows[0];
    if (!row) return { state: "unknown" };
    if (Number(row.marker_count) === 0 && Number(row.audit_count) === 0) return { state: "not_committed" };
    if (Number(row.marker_count) === 1
      && Number(row.audit_count) === 1
      && Number(row.remaining_session_count) === 0) {
      return { state: "committed", sessionRevokedCount: Number(row.session_revoked_count) };
    }
    return { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

export async function executeBrowserFailureSessionCleanup(options: RecoveryOptions): Promise<SessionCleanupResult> {
  assertStaticGuards({
    environment: options.environment,
    deploymentClass: options.deploymentClass,
    expectedMigration: options.expectedMigration,
    recoveryRunId: options.recoveryRunId,
    confirmation: options.confirmation,
    effectiveUid: options.effectiveUid,
  });
  if (options.sessionCleanupConfirmation !== true) {
    throw new RecoveryError("RECOVERY_SESSION_CLEANUP_CONFIRMATION_REQUIRED", "PRECHECK");
  }
  const cleanupAccount = RECOVERY_ACCOUNTS.find((account) => account.username === options.sessionCleanupUsername);
  if (!cleanupAccount) {
    throw new RecoveryError("RECOVERY_SESSION_CLEANUP_ACCOUNT_REQUIRED", "PRECHECK");
  }
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  const expectedDatabase = await assertDatabasePreflight(options, parsedUrl);
  const client = await options.pool.connect();
  const lockState: SessionLockState = { recovery: false, migration: false };
  const cleanupOperationId = randomUUID();
  const cleanupMarker = sha256(`${RECOVERY_SESSION_CLEANUP_ACTION}\n${options.recoveryRunId}\n${cleanupAccount.username}`);
  let transactionOpen = false;
  let commitAttempted = false;
  let destroyClient = false;
  let clientReleased = false;
  try {
    await client.query("begin isolation level serializable");
    transactionOpen = true;
    await acquireRecoverySessionLocks(client, lockState, "SESSION_CLEANUP");
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration);
    const recovery = await verifyCommitOutcome(options, client, false);
    if (recovery.state !== "committed") {
      throw new RecoveryError("RECOVERY_COMMITTED_EVIDENCE_REQUIRED", "SESSION_CLEANUP");
    }
    const existing = await verifySessionCleanupOutcome(options, cleanupAccount.username, cleanupMarker, client);
    if (existing.state === "committed") {
      await client.query("commit");
      transactionOpen = false;
      return {
        accountCount: 1,
        sessionRevokedCount: existing.sessionRevokedCount,
        auditCount: 1,
        recoveryRunId: options.recoveryRunId,
      };
    }
    if (existing.state === "unknown") {
      throw new RecoveryError("RECOVERY_SESSION_CLEANUP_COMMIT_OUTCOME_UNKNOWN", "SESSION_CLEANUP");
    }
    const locked = await client.query<Pick<LockedUser, "username" | "role" | "is_active">>(`
      select username,role,is_active from app_users
      where username=$1 for update
    `, [cleanupAccount.username]);
    if (locked.rowCount !== 1) {
      throw new RecoveryError("RECOVERY_ACCOUNT_COUNT_MISMATCH", "SESSION_CLEANUP");
    }
    const actual = locked.rows[0];
    if (actual.username !== cleanupAccount.username
      || actual.role !== cleanupAccount.role || actual.is_active !== true) {
      throw new RecoveryError("RECOVERY_ACCOUNT_INVARIANT_MISMATCH", "SESSION_CLEANUP");
    }
    const marker = await client.query(`
      insert into idempotency_keys(
        key_digest,username,method,path,request_digest,status_code,response,expires_at,created_at
      ) values($1,$2,'OFFLINE',$3,$4,200,$5,'infinity',transaction_timestamp())
      on conflict(key_digest) do nothing returning key_digest
    `, [
      cleanupMarker,
      RECOVERY_ACTOR,
      `identity-recovery-session-cleanup:${options.environment}`,
      sha256(JSON.stringify({ recovery_run_id: options.recoveryRunId, account: cleanupAccount.username })),
      {
        status: "COMMITTED",
        recovery_run_id: options.recoveryRunId,
        environment: options.environment,
        username: cleanupAccount.username,
        operation_id: cleanupOperationId,
      },
    ]);
    if (marker.rowCount !== 1) {
      throw new RecoveryError("RECOVERY_SESSION_CLEANUP_REPLAYED", "SESSION_CLEANUP");
    }
    const repository = new PostgresIdentityRepository(options.pool);
    const sessionRevokedCount = await repository.revokeUserSessions(client, cleanupAccount.username, "LOGOUT");
    await repository.recordAudit(client, {
      actor: RECOVERY_ACTOR,
      action: RECOVERY_SESSION_CLEANUP_ACTION,
      targetUsername: cleanupAccount.username,
      result: "success",
      requestId: options.recoveryRunId,
      operationId: cleanupOperationId,
      idempotencyKeyDigest: cleanupMarker,
      safeDetails: {
        actor_type: "SYSTEM_RECOVERY_CLI",
        execution_mode: "OFFLINE_BROWSER_FAILURE_CLEANUP",
        environment: options.environment,
        recovery_run_id: options.recoveryRunId,
        reason_code: "BROWSER_SESSION_CLEANUP_UNCERTAIN",
        session_revoked_count: sessionRevokedCount,
      },
    });
    const remaining = await client.query<{ count: number }>(`
      select count(*)::int count from app_sessions
      where username=$1 and revoked_at is null
    `, [cleanupAccount.username]);
    const audit = await client.query<{ count: number }>(`
      select count(*)::int count from audit_log
      where action=$1 and operation_id=$2::uuid and result='success'
        and target_username=$3
    `, [RECOVERY_SESSION_CLEANUP_ACTION, cleanupOperationId, cleanupAccount.username]);
    if (Number(remaining.rows[0]?.count) !== 0
      || Number(audit.rows[0]?.count) !== 1) {
      throw new RecoveryError("RECOVERY_SESSION_CLEANUP_INCOMPLETE", "SESSION_CLEANUP");
    }
    await assertObservedPreflight(client, expectedDatabase, options.expectedMigration);
    commitAttempted = true;
    await client.query("commit");
    transactionOpen = false;
    await options.hooks?.afterSessionCleanupCommitAcknowledged?.();
    return {
      accountCount: 1,
      sessionRevokedCount,
      auditCount: 1,
      recoveryRunId: options.recoveryRunId,
    };
  } catch (error) {
    if (!commitAttempted && transactionOpen) await client.query("rollback").catch(() => undefined);
    if (commitAttempted) {
      client.release(true);
      clientReleased = true;
      const outcome = await verifySessionCleanupOutcome(options, cleanupAccount.username, cleanupMarker);
      if (outcome.state === "committed") {
        return {
          accountCount: 1,
          sessionRevokedCount: outcome.sessionRevokedCount,
          auditCount: 1,
          recoveryRunId: options.recoveryRunId,
        };
      }
      throw new RecoveryError("RECOVERY_SESSION_CLEANUP_COMMIT_OUTCOME_UNKNOWN", "SESSION_CLEANUP");
    }
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_SESSION_CLEANUP_FAILED", "SESSION_CLEANUP");
  } finally {
    if (!clientReleased) {
      if (!await releaseRecoverySessionLocks(client, lockState)) destroyClient = true;
      client.release(destroyClient);
    }
  }
}

export async function executeRetainedStagePromotion(options: RecoveryOptions): Promise<RecoveryResult> {
  assertStaticGuards({
    environment: options.environment,
    deploymentClass: options.deploymentClass,
    expectedMigration: options.expectedMigration,
    recoveryRunId: options.recoveryRunId,
    confirmation: options.confirmation,
    effectiveUid: options.effectiveUid,
  });
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  const stages = resolveStagePaths(options);
  await assertDirectoryMetadata(stages.directory, stages.directory === FORMAL_STAGE_DIRECTORY, false);
  await assertRootOnlyRegularFile(stages.adminStage);
  await assertRootOnlyRegularFile(stages.uatStage);
  const documents = {
    admin: JSON.parse(await readFile(stages.adminStage, "utf8")),
    uat: JSON.parse(await readFile(stages.uatStage, "utf8")),
  } as CredentialDocuments;
  assertRecoveryCredentialDocuments(documents, options.recoveryRunId);
  let verifiedSessionRevokedCount: number | null = null;
  try {
    await withCommittedRecoveryEvidence(options, parsedUrl, documents, async (outcome) => {
      verifiedSessionRevokedCount = outcome.sessionRevokedCount;
      await promoteCredentialStages(stages, options.recoveryRunId, options.hooks, documents, true);
    });
  } catch (error) {
    if (verifiedSessionRevokedCount === null) throw error;
    return {
      status: "partial",
      accountCount: RECOVERY_ACCOUNTS.length,
      sessionRevokedCount: verifiedSessionRevokedCount,
      auditCount: RECOVERY_ACCOUNTS.length,
      recoveryRunId: options.recoveryRunId,
      stages,
      promotionCode: error instanceof RecoveryError ? error.code : "RECOVERY_CANONICAL_PROMOTION_FAILED",
      partialPhase: "PROMOTION",
    };
  }
  return {
    status: "canonical_active",
    accountCount: RECOVERY_ACCOUNTS.length,
    sessionRevokedCount: verifiedSessionRevokedCount || 0,
    auditCount: RECOVERY_ACCOUNTS.length,
    recoveryRunId: options.recoveryRunId,
    stages,
  };
}

export async function executeStageFinalization(options: RecoveryOptions): Promise<RecoveryResult> {
  assertStaticGuards({
    environment: options.environment,
    deploymentClass: options.deploymentClass,
    expectedMigration: options.expectedMigration,
    recoveryRunId: options.recoveryRunId,
    confirmation: options.confirmation,
    effectiveUid: options.effectiveUid,
  });
  if (options.finalizationConfirmation !== true) {
    throw new RecoveryError("RECOVERY_FINALIZE_CONFIRMATION_REQUIRED", "PRECHECK");
  }
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  const stages = resolveStagePaths(options);
  await assertDirectoryMetadata(stages.directory, stages.directory === FORMAL_STAGE_DIRECTORY, false);
  await assertRootOnlyRegularFile(stages.adminCanonical);
  await assertRootOnlyRegularFile(stages.uatCanonical);
  const preparedMarker = path.join(stages.directory, `.identity-recovery-finalize-${options.recoveryRunId}.prepared.json`);
  const preparedExists = await exists(preparedMarker);
  const adminCanonical = await readFile(stages.adminCanonical);
  const uatCanonical = await readFile(stages.uatCanonical);
  const documents = {
    admin: JSON.parse(adminCanonical.toString("utf8")),
    uat: JSON.parse(uatCanonical.toString("utf8")),
  } as CredentialDocuments;
  assertRecoveryCredentialDocuments(documents, options.recoveryRunId);
  const adminCanonicalDigest = sha256(adminCanonical);
  const uatCanonicalDigest = sha256(uatCanonical);
  const expectedBrowserEvidencePath = browserVerificationEvidencePath(options, stages);
  if (options.browserVerificationEvidencePath !== expectedBrowserEvidencePath) {
    throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_REQUIRED", "FINALIZE");
  }
  let finalizationBinding: FinalizationBinding;
  if (preparedExists) {
    const persistedBinding = await assertFinalizationMarker(preparedMarker, options.recoveryRunId, "PREPARED");
    if (persistedBinding.adminCanonicalDigest !== adminCanonicalDigest
      || persistedBinding.uatCanonicalDigest !== uatCanonicalDigest) {
      throw new RecoveryError("RECOVERY_FINALIZE_MARKER_INVALID", "FINALIZE");
    }
    if (await exists(expectedBrowserEvidencePath)) {
      const browserEvidence = await assertBrowserVerificationEvidence(options, stages, true);
      finalizationBinding = {
        browserEvidenceDigest: browserEvidence.digest,
        adminCanonicalDigest,
        uatCanonicalDigest,
        issuedAtEpoch: browserEvidence.issuedAtEpoch,
        promotedAtEpoch: browserEvidence.promotedAtEpoch,
      };
      await assertFinalizationMarker(preparedMarker, options.recoveryRunId, "PREPARED", finalizationBinding);
    } else {
      finalizationBinding = persistedBinding;
    }
  } else {
    const browserEvidence = await assertBrowserVerificationEvidence(options, stages, false);
    finalizationBinding = {
      browserEvidenceDigest: browserEvidence.digest,
      adminCanonicalDigest,
      uatCanonicalDigest,
      issuedAtEpoch: browserEvidence.issuedAtEpoch,
      promotedAtEpoch: browserEvidence.promotedAtEpoch,
    };
  }
  let verifiedSessionRevokedCount: number | null = null;
  try {
    await withCommittedRecoveryEvidence(options, parsedUrl, documents, async (outcome, client) => {
      verifiedSessionRevokedCount = outcome.sessionRevokedCount;
      const auditTime = await client.query<{ audit_epoch: number }>(`
        select floor(extract(epoch from max(created_at)))::bigint audit_epoch
        from audit_log where action=$1 and operation_id=$2::uuid
      `, [RECOVERY_ACTION, options.recoveryRunId]);
      if (Number(auditTime.rows[0]?.audit_epoch || 0) > finalizationBinding.issuedAtEpoch) {
        throw new RecoveryError("RECOVERY_BROWSER_EVIDENCE_PRECEDES_RECOVERY", "FINALIZATION");
      }
      if (stages.oldCandidate && await exists(stages.oldCandidate)) {
        await assertRootOnlyRegularFile(stages.oldCandidate);
        throw new RecoveryError("RECOVERY_OLD_CANDIDATE_RETAINED", "FINALIZATION");
      }
      await finalizeCredentialStages(stages, options.recoveryRunId, finalizationBinding, options.hooks);
    });
  } catch (error) {
    if (verifiedSessionRevokedCount === null) throw error;
    return {
      status: "partial",
      accountCount: RECOVERY_ACCOUNTS.length,
      sessionRevokedCount: verifiedSessionRevokedCount,
      auditCount: RECOVERY_ACCOUNTS.length,
      recoveryRunId: options.recoveryRunId,
      stages,
      promotionCode: error instanceof RecoveryError ? error.code : "RECOVERY_STAGE_FINALIZE_FAILED",
      partialPhase: "FINALIZATION",
    };
  }
  return {
    status: "completed",
    accountCount: RECOVERY_ACCOUNTS.length,
    sessionRevokedCount: verifiedSessionRevokedCount || 0,
    auditCount: RECOVERY_ACCOUNTS.length,
    recoveryRunId: options.recoveryRunId,
    stages,
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function calculateFingerprint(
  pool: Pool,
  excludedTables: ReadonlySet<string>,
  algorithm: string,
): Promise<{ fingerprint: string; tableCount: number; sequenceCount: number }> {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local timezone='UTC'");
    const catalog = await client.query<{ tablename: string }>(`
      select tablename from pg_catalog.pg_tables where schemaname='public' order by tablename
    `);
    const parts = [algorithm];
    let tableCount = 0;
    for (const { tablename } of catalog.rows) {
      if (excludedTables.has(tablename)) continue;
      const identifier = quoteIdentifier(tablename);
      const result = await client.query<{ row_count: string; table_digest: string }>(`
        select count(*)::text row_count,
          encode(digest(coalesce(string_agg(row_digest,'' order by row_digest collate "C"),''),'sha256'),'hex') table_digest
        from (
          select encode(digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') row_digest
          from public.${identifier} t
        ) rows
      `);
      parts.push(`table:${tablename}:${result.rows[0].row_count}:${result.rows[0].table_digest}`);
      tableCount += 1;
    }
    const sequences = await client.query<{ sequence_name: string }>(`
      select c.relname sequence_name
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='S' and c.relname<>'audit_log_id_seq'
      order by c.relname
    `);
    for (const row of sequences.rows) {
      const sequence = await client.query<{ last_value: string; is_called: boolean }>(
        `select last_value::text,is_called from public.${quoteIdentifier(row.sequence_name)}`,
      );
      parts.push(`sequence:${row.sequence_name}:${sequence.rows[0].last_value}:${sequence.rows[0].is_called}`);
    }
    await client.query("commit");
    return { fingerprint: sha256(parts.join("\n")), tableCount, sequenceCount: sequences.rowCount || 0 };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_FINGERPRINT_FAILED", "FINGERPRINT");
  } finally {
    client.release();
  }
}

export async function businessFingerprint(pool: Pool): Promise<{ fingerprint: string; tableCount: number; sequenceCount: number }> {
  return calculateFingerprint(pool, IDENTITY_AND_SYSTEM_TABLES, "chenyida-erp-business-fingerprint-v1");
}

export async function protectedDataFingerprint(pool: Pool): Promise<{ fingerprint: string; tableCount: number; sequenceCount: number }> {
  return calculateFingerprint(pool, RECOVERY_MUTABLE_TABLES, "chenyida-erp-protected-data-fingerprint-v1");
}

export async function validateCanonicalFiles(
  adminPath: string,
  uatPath: string,
  recoveryRunId: string,
): Promise<void> {
  const documents = await readCanonicalFiles(adminPath, uatPath);
  assertCanonicalDocuments(documents, recoveryRunId);
}

export async function validateRecoveryCredentialFiles(
  adminPath: string,
  uatPath: string,
  recoveryRunId: string,
): Promise<void> {
  const documents = await readCanonicalFiles(adminPath, uatPath);
  assertRecoveryCredentialDocuments(documents, recoveryRunId);
}

async function readCanonicalFiles(adminPath: string, uatPath: string): Promise<CredentialDocuments> {
  await assertRootOnlyRegularFile(adminPath);
  await assertRootOnlyRegularFile(uatPath);
  const admin = JSON.parse(await readFile(adminPath, "utf8"));
  const uat = JSON.parse(await readFile(uatPath, "utf8"));
  return { admin, uat } as CredentialDocuments;
}

export async function activeTargetSessionCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: number }>(`
    select count(*)::int count from app_sessions
    where username=any($1::text[]) and revoked_at is null and expires_at>now()
  `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
  return Number(result.rows[0]?.count || 0);
}
