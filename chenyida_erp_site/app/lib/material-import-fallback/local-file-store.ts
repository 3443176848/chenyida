import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type {
  MaterialImportObjectMetadata,
  MaterialImportObjectRange,
  MaterialImportObjectStore,
  MaterialImportPutResult,
} from "../material-import/object-store.ts";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalMaterialImportFileFacts = Readonly<{
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  prefix: Uint8Array;
}>;

export type LocalMaterialImportPaths = Readonly<{
  stagingRelativePath: string;
  finalRelativePath: string;
}>;

export type LocalMaterialImportPromotion = Readonly<{
  kind: "promoted" | "already_promoted";
  facts: LocalMaterialImportFileFacts;
}>;

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}_INVALID`);
  return value;
}

function safeExtension(value: string): string {
  const extension = String(value || "").toLowerCase();
  if (![".csv", ".xls", ".xlsx"].includes(extension)) throw new Error("IMPORT_FILE_EXTENSION_INVALID");
  return extension;
}

function safeUuid(value: string, name: string): string {
  if (!UUID.test(value)) throw new Error(`${name}_INVALID`);
  return value.toLowerCase();
}

function prefixFrom(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function sameFacts(facts: LocalMaterialImportFileFacts, expectedSha256: string, expectedSizeBytes: number): boolean {
  return facts.sha256 === expectedSha256 && facts.sizeBytes === expectedSizeBytes;
}

export class LocalMaterialImportFileStore implements MaterialImportObjectStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  paths(batchId: number, operationId: string, extension: string): LocalMaterialImportPaths {
    const batch = positiveSafeInteger(batchId, "IMPORT_BATCH_ID");
    const operation = safeUuid(operationId, "IMPORT_OPERATION_ID");
    const suffix = safeExtension(extension);
    return {
      stagingRelativePath: `material-import/.staging/${operation}.ready`,
      finalRelativePath: `material-import/${batch}/${operation}${suffix}`,
    };
  }

  async stage(input: Readonly<{
    relativePath: string;
    leaseToken: string;
    body: ReadableStream<Uint8Array>;
    maximumBytes?: number;
  }>): Promise<Readonly<{ kind: "stored" | "exists"; facts: LocalMaterialImportFileFacts }>> {
    const maximum = positiveSafeInteger(input.maximumBytes ?? DEFAULT_MAX_BYTES, "IMPORT_FILE_MAXIMUM");
    const lease = safeUuid(input.leaseToken, "IMPORT_UPLOAD_LEASE");
    const existing = await this.inspectOptional(input.relativePath, maximum);
    if (existing) {
      await input.body.cancel().catch(() => undefined);
      return { kind: "exists", facts: existing };
    }
    try {
      await this.ensureParent(input.relativePath);
    } catch (error) {
      await input.body.cancel(error).catch(() => undefined);
      throw error;
    }
    const destination = this.safePath(input.relativePath);
    const temporaryRelativePath = `${input.relativePath}.part.${lease}`;
    const temporary = this.safePath(temporaryRelativePath);
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
    const reader = input.body.getReader();
    let handle;
    try {
      handle = await open(temporary, flags, 0o640);
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      reader.releaseLock();
      throw error;
    }
    const hash = createHash("sha256");
    const prefixChunks: Uint8Array[] = [];
    let prefixSize = 0;
    let sizeBytes = 0;
    let writeFailure: unknown = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        sizeBytes += value.byteLength;
        if (sizeBytes > maximum) throw new Error("IMPORT_FILE_TOO_LARGE");
        hash.update(value);
        if (prefixSize < 8192) {
          const selected = value.slice(0, Math.min(value.byteLength, 8192 - prefixSize));
          prefixChunks.push(selected);
          prefixSize += selected.byteLength;
        }
        let offset = 0;
        while (offset < value.byteLength) {
          const written = await handle.write(value, offset, value.byteLength - offset);
          if (written.bytesWritten <= 0) throw new Error("IMPORT_FILE_STAGE_WRITE_FAILED");
          offset += written.bytesWritten;
        }
      }
      if (sizeBytes <= 0) throw new Error("IMPORT_FILE_EMPTY");
      await handle.sync();
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      writeFailure = error;
    } finally {
      reader.releaseLock();
      await handle.close().catch(() => undefined);
    }
    if (writeFailure) {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await this.fsyncDirectory(dirname(temporary)).catch(() => undefined);
      throw writeFailure;
    }

    const facts: LocalMaterialImportFileFacts = {
      relativePath: input.relativePath,
      sizeBytes,
      sha256: hash.digest("hex"),
      prefix: prefixFrom(prefixChunks, prefixSize),
    };
    try {
      await link(temporary, destination);
      await chmod(destination, 0o440);
      await this.fsyncDirectory(dirname(destination));
      return { kind: "stored", facts };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = await this.inspect(input.relativePath, maximum);
      return { kind: "exists", facts: winner };
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await this.fsyncDirectory(dirname(temporary)).catch(() => undefined);
    }
  }

  async inspect(relativePath: string, maximumBytes = DEFAULT_MAX_BYTES): Promise<LocalMaterialImportFileFacts> {
    const maximum = positiveSafeInteger(maximumBytes, "IMPORT_FILE_MAXIMUM");
    const absolute = this.safePath(relativePath);
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const hash = createHash("sha256");
    const prefixChunks: Uint8Array[] = [];
    let prefixSize = 0;
    let sizeBytes = 0;
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximum || metadata.nlink > 2) {
        throw new Error("IMPORT_FILE_STORAGE_FACTS_INVALID");
      }
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < metadata.size) {
        const read = await handle.read(buffer, 0, Math.min(buffer.byteLength, metadata.size - position), position);
        if (read.bytesRead <= 0) throw new Error("IMPORT_FILE_STORAGE_READ_INCOMPLETE");
        const chunk = buffer.subarray(0, read.bytesRead);
        hash.update(chunk);
        sizeBytes += read.bytesRead;
        if (prefixSize < 8192) {
          const selected = Uint8Array.from(chunk.subarray(0, Math.min(chunk.byteLength, 8192 - prefixSize)));
          prefixChunks.push(selected);
          prefixSize += selected.byteLength;
        }
        position += read.bytesRead;
      }
      if (sizeBytes !== metadata.size) throw new Error("IMPORT_FILE_STORAGE_READ_INCOMPLETE");
      const finalMetadata = await handle.stat();
      if (
        finalMetadata.dev !== metadata.dev
        || finalMetadata.ino !== metadata.ino
        || finalMetadata.size !== metadata.size
        || finalMetadata.mtimeMs !== metadata.mtimeMs
        || finalMetadata.ctimeMs !== metadata.ctimeMs
        || finalMetadata.nlink > 2
      ) throw new Error("IMPORT_FILE_STORAGE_CHANGED_DURING_READ");
    } finally {
      await handle.close();
    }
    return { relativePath, sizeBytes, sha256: hash.digest("hex"), prefix: prefixFrom(prefixChunks, prefixSize) };
  }

  async inspectOptional(relativePath: string, maximumBytes = DEFAULT_MAX_BYTES): Promise<LocalMaterialImportFileFacts | null> {
    try {
      return await this.inspect(relativePath, maximumBytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async promote(input: Readonly<{
    stagingRelativePath: string;
    finalRelativePath: string;
    expectedSha256: string;
    expectedSizeBytes: number;
    maximumBytes?: number;
  }>): Promise<LocalMaterialImportPromotion> {
    if (!/^[0-9a-f]{64}$/.test(input.expectedSha256)) throw new Error("IMPORT_FILE_SHA256_INVALID");
    positiveSafeInteger(input.expectedSizeBytes, "IMPORT_FILE_SIZE");
    const maximum = positiveSafeInteger(input.maximumBytes ?? DEFAULT_MAX_BYTES, "IMPORT_FILE_MAXIMUM");
    const existing = await this.inspectOptional(input.finalRelativePath, maximum);
    if (existing) {
      if (!sameFacts(existing, input.expectedSha256, input.expectedSizeBytes)) throw new Error("IMPORT_FILE_FINAL_MISMATCH");
      const staging = await this.inspectOptional(input.stagingRelativePath, maximum);
      if (staging && !sameFacts(staging, input.expectedSha256, input.expectedSizeBytes)) throw new Error("IMPORT_FILE_STAGE_MISMATCH");
      if (staging) await this.delete(input.stagingRelativePath);
      return { kind: "already_promoted", facts: existing };
    }
    const staging = await this.inspect(input.stagingRelativePath, maximum);
    if (!sameFacts(staging, input.expectedSha256, input.expectedSizeBytes)) throw new Error("IMPORT_FILE_STAGE_MISMATCH");
    await this.ensureParent(input.finalRelativePath);
    const finalPath = this.safePath(input.finalRelativePath);
    try {
      await link(this.safePath(input.stagingRelativePath), finalPath);
      await chmod(finalPath, 0o440);
      await this.fsyncDirectory(dirname(finalPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const promoted = await this.inspect(input.finalRelativePath, maximum);
    if (!sameFacts(promoted, input.expectedSha256, input.expectedSizeBytes)) throw new Error("IMPORT_FILE_FINAL_MISMATCH");
    await this.delete(input.stagingRelativePath);
    return { kind: "promoted", facts: promoted };
  }

  async cleanupOperationTemp(operationId: string, leaseToken: string): Promise<boolean> {
    const operation = safeUuid(operationId, "IMPORT_OPERATION_ID");
    const lease = safeUuid(leaseToken, "IMPORT_UPLOAD_LEASE");
    const relativePath = `material-import/.staging/${operation}.ready.part.${lease}`;
    const absolute = this.safePath(relativePath);
    try {
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("IMPORT_FILE_DELETE_TARGET_INVALID");
      await unlink(absolute);
      await this.fsyncDirectory(dirname(absolute));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async putIfAbsent(input: Readonly<{
    key: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    customMetadata?: Readonly<Record<string, string>>;
  }>): Promise<MaterialImportPutResult> {
    void input.contentType;
    void input.customMetadata;
    const result = await this.stage({ relativePath: input.key, leaseToken: randomUUID(), body: input.body });
    const metadata = await this.head(input.key);
    if (!metadata) throw new Error("IMPORT_FILE_STORAGE_RESULT_UNKNOWN");
    return { kind: result.kind, metadata };
  }

  async head(key: string): Promise<MaterialImportObjectMetadata | null> {
    const absolute = this.safePath(key);
    let metadata;
    try {
      metadata = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.nlink > 2) {
      throw new Error("IMPORT_FILE_STORAGE_FACTS_INVALID");
    }
    return {
      key,
      size: metadata.size,
      etag: `${metadata.dev}-${metadata.ino}-${metadata.size}-${Math.trunc(metadata.mtimeMs)}`,
      contentType: "application/octet-stream",
      customMetadata: {},
    };
  }

  async open(key: string, range?: MaterialImportObjectRange): Promise<ReadableStream<Uint8Array> | null> {
    const absolute = this.safePath(key);
    let handle;
    try {
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let metadata;
    try {
      metadata = await handle.stat();
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
    if (!metadata.isFile() || metadata.size <= 0 || metadata.nlink > 2) {
      await handle.close();
      throw new Error("IMPORT_FILE_STORAGE_FACTS_INVALID");
    }
    if (range?.suffix !== undefined && (range.offset !== undefined || range.length !== undefined)) {
      await handle.close();
      throw new Error("IMPORT_FILE_RANGE_INVALID");
    }
    for (const value of [range?.offset, range?.length, range?.suffix]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        await handle.close();
        throw new Error("IMPORT_FILE_RANGE_INVALID");
      }
    }
    let position = range?.suffix === undefined ? Math.min(metadata.size, range?.offset ?? 0) : Math.max(0, metadata.size - range.suffix);
    const end = range?.length === undefined ? metadata.size : Math.min(metadata.size, position + range.length);
    let closed = false;
    const close = async () => { if (!closed) { closed = true; await handle.close(); } };
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (position >= end) { await close(); controller.close(); return; }
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position));
          const read = await handle.read(buffer, 0, buffer.byteLength, position);
          if (read.bytesRead <= 0) throw new Error("IMPORT_FILE_STORAGE_READ_INCOMPLETE");
          position += read.bytesRead;
          controller.enqueue(Uint8Array.from(buffer.subarray(0, read.bytesRead)));
        } catch (error) {
          await close().catch(() => undefined);
          controller.error(error);
        }
      },
      async cancel() { await close(); },
    });
  }

  async delete(relativePath: string): Promise<void> {
    const absolute = this.safePath(relativePath);
    try {
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("IMPORT_FILE_DELETE_TARGET_INVALID");
      await unlink(absolute);
      await this.fsyncDirectory(dirname(absolute));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private safePath(relativePath: string): string {
    const value = String(relativePath || "");
    if (!value || value.includes("\0") || value.startsWith("/") || value.includes("\\")) throw new Error("FILE_PATH_INVALID");
    const segments = value.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("FILE_PATH_INVALID");
    const absolute = resolve(this.root, value);
    const fromRoot = relative(this.root, absolute);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || fromRoot.includes(`${sep}..${sep}`)) {
      throw new Error("FILE_PATH_OUTSIDE_ROOT");
    }
    return absolute;
  }

  private async ensureParent(relativePath: string): Promise<void> {
    const absolute = this.safePath(relativePath);
    await mkdir(this.root, { recursive: true, mode: 0o750 });
    const rootMetadata = await lstat(this.root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("IMPORT_FILE_ROOT_INVALID");
    const fromRoot = relative(this.root, dirname(absolute));
    let current = this.root;
    for (const segment of fromRoot.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      let created = false;
      await mkdir(current, { mode: 0o750 }).then(() => { created = true; }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const metadata = await lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("IMPORT_FILE_DIRECTORY_INVALID");
      if (created) await this.fsyncDirectory(dirname(current));
    }
  }

  private async fsyncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0));
    try { await handle.sync(); } finally { await handle.close(); }
  }
}
