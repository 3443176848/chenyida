export type MaterialImportObjectMetadata = Readonly<{
  key: string;
  size: number;
  etag: string;
  contentType: string;
  customMetadata: Readonly<Record<string, string>>;
}>;

export type MaterialImportObjectRange = Readonly<{
  offset?: number;
  length?: number;
  suffix?: number;
}>;

export type MaterialImportPutResult =
  | Readonly<{ kind: "stored"; metadata: MaterialImportObjectMetadata }>
  | Readonly<{ kind: "exists"; metadata: MaterialImportObjectMetadata }>;

export interface MaterialImportObjectStore {
  putIfAbsent(input: Readonly<{
    key: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    customMetadata?: Readonly<Record<string, string>>;
  }>): Promise<MaterialImportPutResult>;
  head(key: string): Promise<MaterialImportObjectMetadata | null>;
  open(key: string, range?: MaterialImportObjectRange): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
}

type R2ObjectLike = Readonly<{
  key: string;
  size: number;
  etag: string;
  httpMetadata?: Readonly<{ contentType?: string }>;
  customMetadata?: Readonly<Record<string, string>>;
}>;

export type R2BucketLike = Readonly<{
  head(key: string): Promise<R2ObjectLike | null>;
  get(
    key: string,
    options?: Readonly<{ range?: MaterialImportObjectRange }>,
  ): Promise<(R2ObjectLike & Readonly<{ body: ReadableStream<Uint8Array> }>) | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options: Readonly<{
      onlyIf: Readonly<{ etagDoesNotMatch: string }>;
      httpMetadata: Readonly<{ contentType: string }>;
      customMetadata: Readonly<Record<string, string>>;
    }>,
  ): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}>;

function projectR2Object(object: R2ObjectLike): MaterialImportObjectMetadata {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    customMetadata: { ...(object.customMetadata ?? {}) },
  };
}

export class R2MaterialImportObjectStore implements MaterialImportObjectStore {
  readonly #bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.#bucket = bucket;
  }

  async putIfAbsent(input: Readonly<{
    key: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    customMetadata?: Readonly<Record<string, string>>;
  }>): Promise<MaterialImportPutResult> {
    let stored: R2ObjectLike | null;
    try {
      stored = await this.#bucket.put(input.key, input.body, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: input.contentType },
        customMetadata: { ...(input.customMetadata ?? {}) },
      });
    } catch (error) {
      await input.body.cancel(error).catch(() => undefined);
      throw error;
    }
    if (stored) return { kind: "stored", metadata: projectR2Object(stored) };
    const existing = await this.#bucket.head(input.key);
    if (!existing) throw new Error("OBJECT_STORE_CONDITIONAL_RESULT_UNKNOWN");
    return { kind: "exists", metadata: projectR2Object(existing) };
  }

  async head(key: string): Promise<MaterialImportObjectMetadata | null> {
    const object = await this.#bucket.head(key);
    return object ? projectR2Object(object) : null;
  }

  async open(key: string, range?: MaterialImportObjectRange): Promise<ReadableStream<Uint8Array> | null> {
    const object = await this.#bucket.get(key, range ? { range } : undefined);
    return object?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    await this.#bucket.delete(key);
  }
}

type MemoryObject = Readonly<{
  bytes: Uint8Array;
  metadata: MaterialImportObjectMetadata;
}>;

export class MemoryMaterialImportObjectStore implements MaterialImportObjectStore {
  readonly #objects = new Map<string, MemoryObject>();
  #nextPutFailure: "before" | "after" | "corrupt_after" | null = null;
  #nextDeleteFailure = false;

  failNextPut(stage: "before" | "after" | "corrupt_after" = "before"): void {
    this.#nextPutFailure = stage;
  }

  failNextDelete(): void {
    this.#nextDeleteFailure = true;
  }

  keys(): readonly string[] {
    return [...this.#objects.keys()].sort();
  }

  async putIfAbsent(input: Readonly<{
    key: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    customMetadata?: Readonly<Record<string, string>>;
  }>): Promise<MaterialImportPutResult> {
    const existing = this.#objects.get(input.key);
    if (existing) return { kind: "exists", metadata: existing.metadata };
    if (this.#nextPutFailure === "before") {
      this.#nextPutFailure = null;
      await input.body.cancel(new Error("MEMORY_OBJECT_STORE_PUT_FAILED")).catch(() => undefined);
      throw new Error("MEMORY_OBJECT_STORE_PUT_FAILED");
    }
    const reader = input.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        chunks.push(value.slice());
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const metadata: MaterialImportObjectMetadata = {
      key: input.key,
      size,
      etag: `memory-${crypto.randomUUID()}`,
      contentType: input.contentType,
      customMetadata: { ...(input.customMetadata ?? {}) },
    };
    this.#objects.set(input.key, { bytes, metadata });
    if (this.#nextPutFailure === "corrupt_after") {
      this.#nextPutFailure = null;
      const corrupted = bytes.slice();
      if (corrupted.byteLength) corrupted[0] ^= 0xff;
      this.#objects.set(input.key, { bytes: corrupted, metadata: { ...metadata, size: corrupted.byteLength } });
      throw new Error("MEMORY_OBJECT_STORE_RESULT_UNKNOWN");
    }
    if (this.#nextPutFailure === "after") {
      this.#nextPutFailure = null;
      throw new Error("MEMORY_OBJECT_STORE_RESULT_UNKNOWN");
    }
    return { kind: "stored", metadata };
  }

  async head(key: string): Promise<MaterialImportObjectMetadata | null> {
    return this.#objects.get(key)?.metadata ?? null;
  }

  async open(key: string, range?: MaterialImportObjectRange): Promise<ReadableStream<Uint8Array> | null> {
    const object = this.#objects.get(key);
    if (!object) return null;
    const size = object.bytes.byteLength;
    let start = 0;
    let end = size;
    if (range?.suffix !== undefined) start = Math.max(0, size - range.suffix);
    else {
      start = Math.min(size, Math.max(0, range?.offset ?? 0));
      if (range?.length !== undefined) end = Math.min(size, start + Math.max(0, range.length));
    }
    const selected = object.bytes.slice(start, end);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < selected.byteLength; offset += chunkSize) {
          controller.enqueue(selected.slice(offset, Math.min(selected.byteLength, offset + chunkSize)));
        }
        controller.close();
      },
    });
  }

  async delete(key: string): Promise<void> {
    if (this.#nextDeleteFailure) {
      this.#nextDeleteFailure = false;
      throw new Error("MEMORY_OBJECT_STORE_DELETE_FAILED");
    }
    this.#objects.delete(key);
  }
}
