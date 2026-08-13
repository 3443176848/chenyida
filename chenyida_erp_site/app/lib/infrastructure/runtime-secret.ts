import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { TextDecoder } from "node:util";

export type ControlledDeploymentClass = "uat" | "production";
export type RuntimeServiceKind = "WEB" | "WORKER" | "MIGRATION" | "ADMIN";
export type RuntimeSecretKind = "DATABASE_PASSWORD" | "ADMIN_PASSWORD";

const CONTROLLED_DEPLOYMENTS = new Set<string>(["uat", "production"]);
const SERVICE_KINDS = new Set<string>(["WEB", "WORKER", "MIGRATION", "ADMIN"]);
const CONTROLLED_SECRET_ENVIRONMENT = Object.freeze([
  "DATABASE_URL",
  "ERP_MIGRATION_DATABASE_URL",
  "POSTGRES_PASSWORD",
  "ERP_ADMIN_PASSWORD",
  "ERP_SETUP_TOKEN",
]);
const SECRET_ROOT = "/run/chenyida-erp-secrets";
const SECRET_PATHS: Readonly<Record<RuntimeServiceKind, Partial<Record<RuntimeSecretKind, string>>>> = Object.freeze({
  WEB: Object.freeze({ DATABASE_PASSWORD: `${SECRET_ROOT}/web-database-password` }),
  WORKER: Object.freeze({ DATABASE_PASSWORD: `${SECRET_ROOT}/worker-database-password` }),
  MIGRATION: Object.freeze({ DATABASE_PASSWORD: `${SECRET_ROOT}/migration-database-password` }),
  ADMIN: Object.freeze({
    DATABASE_PASSWORD: `${SECRET_ROOT}/admin-database-password`,
    ADMIN_PASSWORD: `${SECRET_ROOT}/admin-password`,
  }),
});
const SERVICE_SECRET_GIDS: Readonly<Record<RuntimeServiceKind, number>> = Object.freeze({
  WEB: 65_532,
  WORKER: 65_532,
  MIGRATION: 0,
  ADMIN: 65_532,
});
const O_CLOEXEC = 0o2_000_000;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export class RuntimeSecretError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RuntimeSecretError";
    this.code = code;
  }
}

function reject(code: string): never {
  throw new RuntimeSecretError(code);
}

export function isControlledDeployment(deploymentClass: string): deploymentClass is ControlledDeploymentClass {
  return CONTROLLED_DEPLOYMENTS.has(deploymentClass);
}

export function assertControlledSecretsAbsent(
  deploymentClass: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!isControlledDeployment(deploymentClass)) return;
  if (CONTROLLED_SECRET_ENVIRONMENT.some((name) => Object.prototype.hasOwnProperty.call(environment, name))) {
    reject("CONTROLLED_SECRET_ENVIRONMENT_FORBIDDEN");
  }
}

export function runtimeServiceKind(
  deploymentClass: string,
  value: string | undefined = process.env.ERP_SERVICE_KIND,
): RuntimeServiceKind | null {
  const candidate = value?.trim().toUpperCase() || "";
  if (!isControlledDeployment(deploymentClass)) {
    return SERVICE_KINDS.has(candidate)
      ? candidate as RuntimeServiceKind
      : null;
  }
  if (!SERVICE_KINDS.has(candidate)) {
    reject("CONTROLLED_SERVICE_KIND_INVALID");
  }
  return candidate as RuntimeServiceKind;
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertFileMetadata(
  metadata: BigIntStats,
  expectedUid: number,
  expectedGid: number,
  expectedMode: number,
  maximumBytes: number,
): void {
  if (!metadata.isFile()
    || metadata.nlink !== 1n
    || metadata.uid !== BigInt(expectedUid)
    || metadata.gid !== BigInt(expectedGid)
    || (metadata.mode & 0o7777n) !== BigInt(expectedMode)
    || metadata.size < 1n
    || metadata.size > BigInt(maximumBytes + 1)) {
    reject("RUNTIME_SECRET_FILE_METADATA_INVALID");
  }
}

export function readSecureSingleValueFile(input: Readonly<{
  path: string;
  expectedParent?: string;
  expectedUid: number;
  expectedGid: number;
  expectedMode?: number;
  minimumBytes?: number;
  maximumBytes?: number;
}>): string {
  const expectedMode = input.expectedMode ?? 0o440;
  const minimumBytes = input.minimumBytes ?? 24;
  const maximumBytes = input.maximumBytes ?? 256;
  if (!isAbsolute(input.path)
    || input.path === "/"
    || (input.expectedParent !== undefined && dirname(input.path) !== input.expectedParent)
    || !Number.isSafeInteger(input.expectedUid) || input.expectedUid < 0
    || !Number.isSafeInteger(input.expectedGid) || input.expectedGid < 0
    || !Number.isSafeInteger(expectedMode) || expectedMode < 0 || expectedMode > 0o7777
    || !Number.isSafeInteger(minimumBytes) || minimumBytes < 1
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < minimumBytes || maximumBytes > 4_096) {
    reject("RUNTIME_SECRET_FILE_POLICY_INVALID");
  }

  let descriptor: number | undefined;
  try {
    const before = lstatSync(input.path, { bigint: true });
    assertFileMetadata(before, input.expectedUid, input.expectedGid, expectedMode, maximumBytes);
    descriptor = openSync(input.path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC);
    const opened = fstatSync(descriptor, { bigint: true });
    assertFileMetadata(opened, input.expectedUid, input.expectedGid, expectedMode, maximumBytes);
    if (!sameIdentity(before, opened)) reject("RUNTIME_SECRET_FILE_CHANGED");
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(input.path, { bigint: true });
    assertFileMetadata(afterRead, input.expectedUid, input.expectedGid, expectedMode, maximumBytes);
    assertFileMetadata(afterPath, input.expectedUid, input.expectedGid, expectedMode, maximumBytes);
    if (!sameIdentity(opened, afterRead) || !sameIdentity(opened, afterPath) || BigInt(bytes.byteLength) !== opened.size) {
      reject("RUNTIME_SECRET_FILE_CHANGED");
    }
    let value: string;
    try { value = UTF8.decode(bytes); }
    catch { reject("RUNTIME_SECRET_CONTENT_INVALID"); }
    if (value.endsWith("\n")) value = value.slice(0, -1);
    const valueBytes = Buffer.byteLength(value, "utf8");
    if (valueBytes < minimumBytes || valueBytes > maximumBytes
      || value.trim() !== value
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) {
      reject("RUNTIME_SECRET_CONTENT_INVALID");
    }
    return value;
  } catch (error) {
    if (error instanceof RuntimeSecretError) throw error;
    reject("RUNTIME_SECRET_FILE_UNAVAILABLE");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readControlledRuntimeSecret(
  deploymentClass: ControlledDeploymentClass,
  service: RuntimeServiceKind,
  kind: RuntimeSecretKind,
): string {
  if (!isControlledDeployment(deploymentClass)) reject("CONTROLLED_SECRET_DEPLOYMENT_INVALID");
  if (kind === "ADMIN_PASSWORD" && service !== "ADMIN") reject("CONTROLLED_SECRET_SCOPE_INVALID");
  const secretPath = SECRET_PATHS[service][kind];
  if (!secretPath) reject("CONTROLLED_SECRET_SCOPE_INVALID");
  return readSecureSingleValueFile({
    path: secretPath,
    expectedParent: SECRET_ROOT,
    expectedUid: 0,
    expectedGid: SERVICE_SECRET_GIDS[service],
    expectedMode: 0o440,
    minimumBytes: 24,
    maximumBytes: 256,
  });
}

export function isolatedEnvironmentSecret(
  deploymentClass: string,
  name: "DATABASE_URL" | "ERP_ADMIN_PASSWORD" | "ERP_SETUP_TOKEN",
): string {
  if (isControlledDeployment(deploymentClass)) reject("CONTROLLED_SECRET_ENVIRONMENT_FORBIDDEN");
  const value = process.env[name] || "";
  if (!value) reject("ISOLATED_SECRET_ENVIRONMENT_REQUIRED");
  return value;
}
