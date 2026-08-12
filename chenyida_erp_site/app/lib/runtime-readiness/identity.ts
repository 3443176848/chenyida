import type { RuntimeConfig } from "../infrastructure/config.ts";
import { getApplicationVersion } from "../application-version.ts";

const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

const SAFE_MESSAGES = Object.freeze<Record<string, string>>({
  RUNTIME_DATABASE_UNAVAILABLE: "数据库就绪检查失败",
  RUNTIME_ATTACHMENTS_UNAVAILABLE: "附件存储尚未就绪",
  RUNTIME_HEALTH_TIMEOUT: "运行就绪检查超时",
  RUNTIME_IDENTITY_INVALID: "运行版本身份校验失败",
  RUNTIME_INSTANCE_FILE_INVALID: "Worker 进程身份校验失败",
  RUNTIME_LEASE_ACTIVE: "已有 Worker 持有有效运行租约",
  RUNTIME_LEASE_LOST: "Worker 运行租约已失效",
  RUNTIME_MIGRATION_MISMATCH: "数据库迁移版本与运行版本不一致",
  RUNTIME_MIGRATION_SOURCE_INVALID: "运行镜像迁移清单不可用",
  RUNTIME_STORAGE_UNAVAILABLE: "文件存储就绪检查失败",
  RUNTIME_UPLOADS_UNAVAILABLE: "上传存储尚未就绪",
  RUNTIME_WORKER_UNAVAILABLE: "后台 Worker 尚未就绪",
});

export class RuntimeReadinessError extends Error {
  readonly code: string;

  constructor(code: keyof typeof SAFE_MESSAGES | string) {
    super(SAFE_MESSAGES[code] || "运行就绪检查失败");
    this.name = "RuntimeReadinessError";
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : "RUNTIME_READINESS_FAILED";
  }
}

export function runtimeReadinessErrorCode(error: unknown): string {
  return error instanceof RuntimeReadinessError ? error.code : "RUNTIME_READINESS_FAILED";
}

export type RuntimeIdentity = Readonly<{
  deploymentClass: RuntimeConfig["deploymentClass"];
  deploymentId: string;
  applicationVersion: string;
  gitCommit: string;
}>;

export function resolveRuntimeIdentity(input: Readonly<{
  config: Pick<RuntimeConfig, "environment" | "deploymentClass">;
  environment?: NodeJS.ProcessEnv;
  applicationVersion?: () => string;
}>): RuntimeIdentity {
  const environment = input.environment || process.env;
  let applicationVersion: string;
  try {
    applicationVersion = (input.applicationVersion || getApplicationVersion)();
  } catch {
    throw new RuntimeReadinessError("RUNTIME_IDENTITY_INVALID");
  }
  const strict = input.config.environment === "production"
    || input.config.deploymentClass === "uat"
    || input.config.deploymentClass === "production";
  const bakedVersion = String(environment.ERP_RUNTIME_BUILD_VERSION || (strict ? "" : applicationVersion));
  const expectedVersion = String(environment.ERP_RELEASE_EXPECTED_VERSION || (strict ? "" : applicationVersion));
  const gitCommit = String(environment.ERP_RUNTIME_GIT_COMMIT || (strict ? "" : "0".repeat(40)));
  const expectedCommit = String(environment.ERP_RELEASE_EXPECTED_GIT_COMMIT || (strict ? "" : gitCommit));
  const deploymentId = String(environment.ERP_RELEASE_EXPECTED_DEPLOYMENT_ID || (strict ? "" : `${input.config.deploymentClass}-local`));

  if (!VERSION.test(applicationVersion)
    || bakedVersion !== applicationVersion
    || expectedVersion !== applicationVersion
    || !COMMIT.test(gitCommit)
    || expectedCommit !== gitCommit
    || !IDENTIFIER.test(deploymentId)) {
    throw new RuntimeReadinessError("RUNTIME_IDENTITY_INVALID");
  }

  return Object.freeze({
    deploymentClass: input.config.deploymentClass,
    deploymentId,
    applicationVersion,
    gitCommit,
  });
}
