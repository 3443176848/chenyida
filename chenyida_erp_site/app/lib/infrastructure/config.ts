import { resolve } from "node:path";

export type RuntimeConfig = {
  environment: "development" | "test" | "production";
  databaseUrl: string;
  setupToken: string;
  uploadRoot: string;
  attachmentRoot: string;
  maxUploadBytes: number;
  workerPollMs: number;
  workerLeaseSeconds: number;
};

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
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
  return {
    environment,
    databaseUrl,
    setupToken,
    uploadRoot: resolve(process.env.ERP_UPLOAD_ROOT || "/data/chenyida-erp/uploads"),
    attachmentRoot: resolve(process.env.ERP_ATTACHMENT_ROOT || "/data/chenyida-erp/attachments"),
    maxUploadBytes: positiveInteger("ERP_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
    workerPollMs: positiveInteger("ERP_WORKER_POLL_MS", 1_000),
    workerLeaseSeconds: positiveInteger("ERP_WORKER_LEASE_SECONDS", 60),
  };
}
