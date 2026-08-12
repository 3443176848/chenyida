import { isAbsolute, relative, resolve } from "node:path";
import { normalizePublicOrigin } from "./request-origin.ts";

export type RuntimeConfig = {
  environment: "development" | "test" | "production";
  deploymentClass: "development" | "test" | "uat" | "production";
  databaseUrl: string;
  setupToken: string;
  publicOrigin: string | null;
  allowUatLoopbackOrigin: boolean;
  uploadRoot: string;
  attachmentRoot: string;
  backupStatusFile: string;
  maxUploadBytes: number;
  workerPollMs: number;
  workerLeaseSeconds: number;
};

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function workerLeaseSeconds(): number {
  const value = positiveInteger("ERP_WORKER_LEASE_SECONDS", 60);
  if (value < 15 || value > 300) throw new Error("ERP_WORKER_LEASE_SECONDS must be between 15 and 300 seconds");
  return value;
}

export function resolveOriginPolicy(
  environment: RuntimeConfig["environment"],
  deploymentClassValue: string | undefined,
  allowLoopbackValue: string | undefined,
): Pick<RuntimeConfig, "deploymentClass" | "allowUatLoopbackOrigin"> {
  const deploymentClass = (deploymentClassValue?.trim().toLowerCase() || environment) as RuntimeConfig["deploymentClass"];
  if (!["development", "test", "uat", "production"].includes(deploymentClass)) {
    throw new Error("ERP_DEPLOYMENT_CLASS must be development, test, uat, or production");
  }
  const candidate = allowLoopbackValue?.trim().toLowerCase() || "false";
  if (!["true", "false"].includes(candidate)) throw new Error("ERP_UAT_ALLOW_LOOPBACK_ORIGIN must be true or false");
  const allowUatLoopbackOrigin = candidate === "true";
  if (allowUatLoopbackOrigin && deploymentClass !== "uat") {
    throw new Error("ERP_UAT_ALLOW_LOOPBACK_ORIGIN requires ERP_DEPLOYMENT_CLASS=uat");
  }
  return { deploymentClass, allowUatLoopbackOrigin };
}

export function runtimeConfig(): RuntimeConfig {
  const environment = (process.env.ERP_ENV || "development") as RuntimeConfig["environment"];
  if (!["development", "test", "production"].includes(environment)) throw new Error("ERP_ENV must be development, test, or production");
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (environment === "test" && !/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) {
    throw new Error("Test DATABASE_URL must identify an isolated test database or localhost");
  }
  const setupToken = process.env.ERP_SETUP_TOKEN || "";
  if (environment === "production" && setupToken.length < 24) throw new Error("ERP_SETUP_TOKEN must be at least 24 characters in production");
  const publicOrigin = normalizePublicOrigin(process.env.ERP_PUBLIC_ORIGIN);
  if (environment === "production" && publicOrigin?.startsWith("http://")) throw new Error("ERP_PUBLIC_ORIGIN must use HTTPS in production");
  const originPolicy = resolveOriginPolicy(environment, process.env.ERP_DEPLOYMENT_CLASS, process.env.ERP_UAT_ALLOW_LOOPBACK_ORIGIN);
  const uploadRoot = resolve(process.env.ERP_UPLOAD_ROOT || "/data/chenyida-erp/uploads");
  const attachmentRoot = resolve(process.env.ERP_ATTACHMENT_ROOT || "/data/chenyida-erp/attachments");
  const uploadToAttachment = relative(uploadRoot, attachmentRoot);
  const attachmentToUpload = relative(attachmentRoot, uploadRoot);
  if (!uploadToAttachment || !attachmentToUpload
    || (!uploadToAttachment.startsWith("..") && !isAbsolute(uploadToAttachment))
    || (!attachmentToUpload.startsWith("..") && !isAbsolute(attachmentToUpload))) {
    throw new Error("ERP_UPLOAD_ROOT and ERP_ATTACHMENT_ROOT must be separate storage boundaries");
  }
  return {
    environment,
    ...originPolicy,
    databaseUrl,
    setupToken,
    publicOrigin,
    uploadRoot,
    attachmentRoot,
    backupStatusFile: resolve(process.env.ERP_BACKUP_STATUS_FILE || "/data/chenyida-erp/backup-status/latest.json"),
    maxUploadBytes: positiveInteger("ERP_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
    workerPollMs: positiveInteger("ERP_WORKER_POLL_MS", 1_000),
    workerLeaseSeconds: workerLeaseSeconds(),
  };
}
