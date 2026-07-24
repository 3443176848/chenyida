import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type StoredFile = {
  storageName: string;
  relativePath: string;
  originalFilename: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
};

export interface FileStorage {
  write(input: { body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>; originalFilename: string; mimeType: string }): Promise<StoredFile>;
  open(relativePath: string): Promise<Readable>;
  delete(relativePath: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  private safePath(relativePath: string): string {
    if (!relativePath || relativePath.includes("\0") || relativePath.startsWith("/") || relativePath.includes("\\")) throw new Error("FILE_PATH_INVALID");
    const absolute = resolve(this.root, relativePath);
    const fromRoot = relative(this.root, absolute);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || fromRoot.includes(`${sep}..${sep}`)) throw new Error("FILE_PATH_OUTSIDE_ROOT");
    return absolute;
  }

  async write(input: { body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>; originalFilename: string; mimeType: string }): Promise<StoredFile> {
    const originalFilename = basename(String(input.originalFilename || "upload.bin")).replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255) || "upload.bin";
    const extension = extname(originalFilename).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
    const storageName = randomUUID();
    const relativePath = `${storageName.slice(0, 2)}/${storageName}${extension}`;
    const destination = this.safePath(relativePath);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await mkdir(dirname(destination), { recursive: true, mode: 0o750 });
    const digest = createHash("sha256"); let sizeBytes = 0;
    const source = Readable.from(input.body as AsyncIterable<Uint8Array>);
    source.on("data", (chunk: Buffer) => { digest.update(chunk); sizeBytes += chunk.length; });
    try {
      await pipeline(source, createWriteStream(temporary, { flags: "wx", mode: 0o640 }));
      const handle = await open(temporary, "r"); try { await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, destination);
      const directory = await open(dirname(destination), "r"); try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    return { storageName, relativePath, originalFilename, mimeType: String(input.mimeType || "application/octet-stream").slice(0, 255), sha256: digest.digest("hex"), sizeBytes };
  }

  async open(relativePath: string): Promise<Readable> {
    const path = this.safePath(relativePath); const info = await stat(path); if (!info.isFile()) throw new Error("FILE_NOT_REGULAR"); return createReadStream(path);
  }

  async delete(relativePath: string): Promise<void> { await rm(this.safePath(relativePath), { force: true }); }
}
