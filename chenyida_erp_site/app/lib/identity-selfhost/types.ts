import type { PoolClient } from "pg";

export const IDENTITY_ROLES = [
  "admin",
  "manager",
  "purchase",
  "engineering",
  "production",
  "warehouse",
  "quality",
  "sales",
  "finance",
  "operations",
] as const;

export type IdentityRole = (typeof IDENTITY_ROLES)[number];

export type IdentityActor = {
  username: string;
  display_name: string;
  role: IdentityRole;
  is_active: true;
  must_change_password: boolean;
  version: number;
  last_login_at: string | null;
  permissions: string[];
};

export type IdentityUserRow = {
  username: string;
  display_name: string;
  role: IdentityRole;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
};

export type IdentityUserDto = Omit<IdentityUserRow, "password_hash" | "created_at" | "updated_at" | "last_login_at"> & {
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type IdentitySessionContext = {
  state: "ANONYMOUS" | "AUTHENTICATED" | "EXPIRED" | "REVOKED";
  actor: IdentityActor | null;
  token_hash: string | null;
  revoked_reason?: string | null;
};

export type IdentityAuditInput = {
  actor?: string;
  action: string;
  targetUsername?: string;
  result?: "success" | "failed";
  requestId: string;
  operationId?: string | null;
  idempotencyKeyDigest?: string | null;
  oldVersion?: number | null;
  newVersion?: number | null;
  errorCode?: string | null;
  safeDetails?: Record<string, unknown>;
};

export type IdentityOperationResponse = {
  status: number;
  body: Record<string, unknown>;
  audit: Omit<IdentityAuditInput, "requestId" | "operationId" | "idempotencyKeyDigest">;
};

export type IdentityIdempotencyMeta = {
  actor: string;
  method: string;
  route: string;
  targetUsername: string;
  keyDigest: string;
  requestDigest: string;
  requestId: string;
  operationId: string;
  action: string;
};

export type IdentityOperationWork = (client: PoolClient) => Promise<IdentityOperationResponse>;

export type IdentityExecutedResponse = {
  status: number;
  body: Record<string, unknown>;
  replayed: boolean;
};
