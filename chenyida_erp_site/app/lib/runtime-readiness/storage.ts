import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import { RuntimeReadinessError } from "./identity.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROBE_BYTES = Buffer.from("chenyida-erp-runtime-readiness/v1\n", "utf8");

type FileIdentity = Readonly<{ dev: number | bigint; ino: number | bigint }>;
type ProbePhase = "directory-created" | "before-write" | "before-file-fsync" | "before-cleanup";

function sameIdentity(stat: FileIdentity, expected: FileIdentity): boolean {
  return stat.dev === expected.dev && stat.ino === expected.ino;
}

async function pathHasIdentity(target: string, identity: FileIdentity, kind: "file" | "directory"): Promise<boolean> {
  try {
    const stat = await lstat(target);
    return !stat.isSymbolicLink()
      && (kind === "file" ? stat.isFile() && stat.nlink === 1 : stat.isDirectory())
      && sameIdentity(stat, identity);
  } catch {
    return false;
  }
}

export async function probeStorageRoot(input: Readonly<{
  root: string;
  randomUuid?: () => string;
  testHook?: (phase: ProbePhase, probeDirectory: string) => void | Promise<void>;
}>): Promise<void> {
  const root = path.resolve(input.root);
  const uuid = (input.randomUuid || randomUUID)();
  if (!UUID.test(uuid) || root === path.parse(root).root) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
  const probeDirectory = path.join(root, `.erp-readiness-${uuid}`);
  const probeFile = path.join(probeDirectory, "probe");
  let rootHandle: FileHandle | undefined;
  let directoryHandle: FileHandle | undefined;
  let fileHandle: FileHandle | undefined;
  let rootIdentity: FileIdentity | undefined;
  let directoryIdentity: FileIdentity | undefined;
  let fileIdentity: FileIdentity | undefined;
  let directoryCreated = false;
  let fileCreated = false;
  let complete = false;

  try {
    if (await realpath(root) !== root) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    const rootPathStat = await lstat(root);
    if (!rootPathStat.isDirectory() || rootPathStat.isSymbolicLink()) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    rootHandle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootStat = await rootHandle.stat();
    if (!rootStat.isDirectory() || !sameIdentity(rootStat, rootPathStat)) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    rootIdentity = { dev: rootStat.dev, ino: rootStat.ino };

    await mkdir(probeDirectory, { mode: 0o700 });
    directoryCreated = true;
    const directoryStat = await lstat(probeDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    directoryIdentity = { dev: directoryStat.dev, ino: directoryStat.ino };
    await input.testHook?.("directory-created", probeDirectory);
    if (!await pathHasIdentity(probeDirectory, directoryIdentity, "directory")) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    directoryHandle = await open(probeDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

    fileHandle = await open(probeFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fileCreated = true;
    const openedFile = await fileHandle.stat();
    if (!openedFile.isFile() || openedFile.nlink !== 1 || (openedFile.mode & 0o777) !== 0o600) {
      throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    }
    fileIdentity = { dev: openedFile.dev, ino: openedFile.ino };
    await input.testHook?.("before-write", probeDirectory);
    const written = await fileHandle.write(PROBE_BYTES, 0, PROBE_BYTES.byteLength, 0);
    if (written.bytesWritten !== PROBE_BYTES.byteLength) throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    await input.testHook?.("before-file-fsync", probeDirectory);
    await fileHandle.sync();
    const afterWrite = await fileHandle.stat();
    if (!sameIdentity(afterWrite, fileIdentity) || afterWrite.size !== PROBE_BYTES.byteLength) {
      throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    }
    await fileHandle.close();
    fileHandle = undefined;

    await input.testHook?.("before-cleanup", probeDirectory);
    if (!await pathHasIdentity(probeDirectory, directoryIdentity, "directory")
      || !await pathHasIdentity(probeFile, fileIdentity, "file")) {
      throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    }
    await unlink(probeFile);
    fileCreated = false;
    await directoryHandle.sync();
    await directoryHandle.close();
    directoryHandle = undefined;
    await rmdir(probeDirectory);
    directoryCreated = false;
    await rootHandle.sync();
    const finalRoot = await rootHandle.stat();
    if (!sameIdentity(finalRoot, rootIdentity) || !await pathHasIdentity(root, rootIdentity, "directory")) {
      throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
    }
    complete = true;
  } catch {
    throw new RuntimeReadinessError("RUNTIME_STORAGE_UNAVAILABLE");
  } finally {
    await fileHandle?.close().catch(() => undefined);
    if (!complete && fileCreated && fileIdentity && directoryIdentity
      && await pathHasIdentity(probeDirectory, directoryIdentity, "directory")
      && await pathHasIdentity(probeFile, fileIdentity, "file")) {
      await unlink(probeFile).catch(() => undefined);
      fileCreated = false;
    }
    await directoryHandle?.close().catch(() => undefined);
    if (!complete && directoryCreated && directoryIdentity
      && await pathHasIdentity(probeDirectory, directoryIdentity, "directory")) {
      await rmdir(probeDirectory).catch(() => undefined);
    }
    await rootHandle?.close().catch(() => undefined);
  }
}
