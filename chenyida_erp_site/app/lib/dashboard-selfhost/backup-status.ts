import { lstat, readFile } from "node:fs/promises";
import type { BackupVerification } from "./types.ts";

const SHA = /^[0-9a-f]{64}$/;
const BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const VERSION = /^0\.1\.0-alpha\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const FILES = { postgresql_dump: "postgresql.dump", uploads: "uploads.tar.gz", attachments: "attachments.tar.gz" } as const;
const iso = (value: unknown) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

export function parseBackupVerification(value: unknown): BackupVerification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>; const artifacts = row.artifacts;
  if (row.schema_version !== 1 || row.result !== "VERIFIED" || typeof row.backup_id !== "string" || !BACKUP_ID.test(row.backup_id) || !iso(row.created_at) || !iso(row.verified_at) || typeof row.application_version !== "string" || !VERSION.test(row.application_version) || typeof row.git_commit !== "string" || !COMMIT.test(row.git_commit) || typeof row.migration_head !== "string" || !MIGRATION.test(row.migration_head)) return null;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) return null;
  const entries = artifacts as Record<string, unknown>;
  for (const key of ["postgresql_dump", "uploads", "attachments"] as const) {
    const artifact = entries[key]; if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
    const item = artifact as Record<string, unknown>;
    if (item.file !== FILES[key] || typeof item.sha256 !== "string" || !SHA.test(item.sha256) || typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || (item.entries !== undefined && (!Number.isSafeInteger(item.entries) || Number(item.entries) < 0))) return null;
  }
  return row as unknown as BackupVerification;
}

export async function backupGovernance(statusFile: string) {
  const base = {
    mode: "OFFLINE_ONLY", browser_create_enabled: false, browser_restore_enabled: false,
    restore_target: "NEW_EMPTY_TARGET_ONLY", cross_failure_domain_required: true,
    consistency: "STOP_WEB_AND_WORKER_DURING_CAPTURE", verification_status: "UNVERIFIED",
    latest_verification: null as BackupVerification | null,
  };
  try {
    const stat = await lstat(statusFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024) return { ...base, verification_status: "INVALID" };
    const parsed = parseBackupVerification(JSON.parse(await readFile(statusFile, "utf8")));
    return parsed ? { ...base, verification_status: "VERIFIED", latest_verification: parsed } : { ...base, verification_status: "INVALID" };
  } catch (error) {
    return { ...base, verification_status: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "UNVERIFIED" : "INVALID" };
  }
}
