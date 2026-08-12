import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { RuntimeReadinessError } from "./identity.ts";

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MIGRATION_BYTES = 32 * 1024 * 1024;

export type MigrationAllowlistEntry = Readonly<{
  ordinal: number;
  filename: string;
  sha256: string;
}>;

export type RuntimeMigrationManifest = Readonly<{
  entries: readonly MigrationAllowlistEntry[];
  head: string;
  allowlistSha256: string;
}>;

export type RuntimeQuery = Readonly<{
  query(sql: string, values?: readonly unknown[]): Promise<{ rows?: unknown[] }>;
}>;

export function canonicalRuntimeJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function migrationAllowlistSha256(entries: readonly MigrationAllowlistEntry[]): string {
  return createHash("sha256").update(canonicalRuntimeJson(entries)).digest("hex");
}

export function validateRuntimeMigrationEntries(entries: readonly MigrationAllowlistEntry[]): readonly MigrationAllowlistEntry[] {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 9_999) {
    throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
  }
  let previous = "";
  entries.forEach((entry, index) => {
    const match = typeof entry?.filename === "string" ? entry.filename.match(MIGRATION_FILE) : null;
    if (!match
      || entry.ordinal !== index + 1
      || Number(match[1]) !== entry.ordinal
      || entry.filename <= previous
      || !SHA256.test(entry.sha256)) {
      throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
    }
    previous = entry.filename;
  });
  return entries;
}

async function readStableMigration(file: string, requireImmutable: boolean): Promise<Buffer> {
  let handle;
  try {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 1 || before.size > MAX_MIGRATION_BYTES
      || (requireImmutable && (before.uid !== 0 || (before.mode & 0o222) !== 0))) {
      throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
    }
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
    }
    const raw = await handle.readFile();
    const afterHandle = await handle.stat();
    const afterPath = await lstat(file);
    if (afterHandle.dev !== opened.dev || afterHandle.ino !== opened.ino || afterHandle.size !== opened.size
      || afterHandle.mtimeMs !== opened.mtimeMs || afterHandle.ctimeMs !== opened.ctimeMs
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino || afterPath.nlink !== 1) {
      throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
    }
    return raw;
  } catch (error) {
    if (error instanceof RuntimeReadinessError) throw error;
    throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function loadRuntimeMigrationManifest(input: Readonly<{
  directory?: string;
  requireImmutable?: boolean;
}> = {}): Promise<RuntimeMigrationManifest> {
  const directory = path.resolve(input.directory || process.env.ERP_MIGRATION_ROOT || path.join(process.cwd(), "drizzle-postgres"));
  const requireImmutable = input.requireImmutable ?? process.env.ERP_ENV === "production";
  try {
    if (await realpath(directory) !== directory) throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || (requireImmutable && (directoryStat.uid !== 0 || (directoryStat.mode & 0o222) !== 0))) {
      throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
    }
    const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    const entries: MigrationAllowlistEntry[] = [];
    for (let index = 0; index < names.length; index += 1) {
      const filename = names[index];
      const match = filename.match(MIGRATION_FILE);
      if (!match || Number(match[1]) !== index + 1) throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
      const raw = await readStableMigration(path.join(directory, filename), requireImmutable);
      entries.push(Object.freeze({ ordinal: index + 1, filename, sha256: createHash("sha256").update(raw).digest("hex") }));
    }
    validateRuntimeMigrationEntries(entries);
    return Object.freeze({
      entries: Object.freeze(entries),
      head: entries.at(-1)!.filename,
      allowlistSha256: migrationAllowlistSha256(entries),
    });
  } catch (error) {
    if (error instanceof RuntimeReadinessError) throw error;
    throw new RuntimeReadinessError("RUNTIME_MIGRATION_SOURCE_INVALID");
  }
}

export function assertDatabaseMigrationRows(
  rows: readonly unknown[],
  expected: RuntimeMigrationManifest,
): void {
  if (!Array.isArray(rows) || rows.length !== expected.entries.length) {
    throw new RuntimeReadinessError("RUNTIME_MIGRATION_MISMATCH");
  }
  rows.forEach((candidate, index) => {
    const row = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    if (Object.keys(row).sort().join("|") !== "checksum|version"
      || row.version !== expected.entries[index].filename
      || row.checksum !== expected.entries[index].sha256) {
      throw new RuntimeReadinessError("RUNTIME_MIGRATION_MISMATCH");
    }
  });
}

export async function verifyDatabaseMigrationManifest(
  database: RuntimeQuery,
  expected: RuntimeMigrationManifest,
): Promise<void> {
  try {
    await database.query("select 1 as runtime_ready");
  } catch {
    throw new RuntimeReadinessError("RUNTIME_DATABASE_UNAVAILABLE");
  }
  try {
    const result = await database.query("select version::text,checksum::text from only public.schema_migrations order by version");
    assertDatabaseMigrationRows(result.rows || [], expected);
  } catch {
    throw new RuntimeReadinessError("RUNTIME_MIGRATION_MISMATCH");
  }
}
