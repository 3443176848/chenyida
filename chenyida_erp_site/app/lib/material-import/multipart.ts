import { createHash } from "node:crypto";

export const MATERIAL_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_HEADER_BYTES = 16 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export class MaterialImportMultipartError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type MaterialImportFilePart = Readonly<{
  filename: string;
  declaredMimeType: string;
  stream: ReadableStream<Uint8Array>;
  completion: Promise<Readonly<{
    actualSizeBytes: number;
    actualSha256: string;
    prefix: Uint8Array;
  }>>;
}>;

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (!left.byteLength) return right;
  if (!right.byteLength) return left;
  const output = new Uint8Array(left.byteLength + right.byteLength);
  output.set(left, 0);
  output.set(right, left.byteLength);
  return output;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function boundaryFromContentType(value: string | null): string {
  if (!value || !/^multipart\/form-data(?:;|$)/i.test(value)) {
    throw new MaterialImportMultipartError("IMPORT_FILE_REQUIRED", "请求必须使用 multipart/form-data");
  }
  const match = value.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!boundary || boundary.length > 70 || /[\r\n\u0000-\u001f\u007f]/.test(boundary)) {
    throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart boundary 无效");
  }
  return boundary;
}

function parsePartHeaders(raw: string): { filename: string; declaredMimeType: string } {
  const headers = new Map<string, string>();
  for (const line of raw.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart part header 无效");
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (headers.has(name)) throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart part header 重复");
    headers.set(name, value);
  }
  const disposition = headers.get("content-disposition") ?? "";
  if (!/^form-data(?:;|$)/i.test(disposition)) {
    throw new MaterialImportMultipartError("IMPORT_FILE_REQUIRED", "缺少文件 part");
  }
  const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1] ?? "";
  const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] ?? "";
  if (name !== "file" || !filename) {
    throw new MaterialImportMultipartError("IMPORT_FILE_REQUIRED", "只接受名为 file 的一个文件 part");
  }
  if (disposition.match(/(?:^|;)\s*filename\*=/i)) {
    throw new MaterialImportMultipartError("INVALID_REQUEST", "不接受扩展文件名参数");
  }
  const declaredMimeType = (headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  return { filename, declaredMimeType };
}

export async function readSingleFilePart(
  request: Request,
  maximumBytes = MATERIAL_IMPORT_MAX_FILE_BYTES,
): Promise<MaterialImportFilePart> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > maximumBytes + MAX_MULTIPART_OVERHEAD_BYTES) {
      throw new MaterialImportMultipartError("IMPORT_FILE_TOO_LARGE", "文件超过 10 MiB 上限", 413);
    }
  }
  const boundary = boundaryFromContentType(request.headers.get("Content-Type"));
  if (!request.body) throw new MaterialImportMultipartError("IMPORT_FILE_REQUIRED", "缺少文件正文");
  const reader = request.body.getReader();
  const encoder = new TextEncoder();
  const initialPrefix = encoder.encode(`--${boundary}\r\n`);
  const headerTerminator = encoder.encode("\r\n\r\n");
  let pending = new Uint8Array(0);
  while (pending.byteLength <= MAX_MULTIPART_HEADER_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.byteLength) pending = concatBytes(pending, value);
    const headerEnd = indexOfBytes(pending, headerTerminator);
    if (headerEnd < 0) continue;
    if (pending.byteLength < initialPrefix.byteLength) break;
    for (let index = 0; index < initialPrefix.byteLength; index += 1) {
      if (pending[index] !== initialPrefix[index]) {
        await reader.cancel().catch(() => undefined);
        throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart 起始边界无效");
      }
    }
    const rawHeaders = new TextDecoder("utf-8", { fatal: true }).decode(
      pending.slice(initialPrefix.byteLength, headerEnd),
    );
    const parsed = parsePartHeaders(rawHeaders);
    pending = pending.slice(headerEnd + headerTerminator.byteLength);
    const delimiter = encoder.encode(`\r\n--${boundary}`);
    const hash = createHash("sha256");
    const prefixChunks: Uint8Array[] = [];
    let prefixSize = 0;
    let actualSizeBytes = 0;
    let settled = false;
    let resolveCompletion!: (value: { actualSizeBytes: number; actualSha256: string; prefix: Uint8Array }) => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<{ actualSizeBytes: number; actualSha256: string; prefix: Uint8Array }>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    const fail = async (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
      if (!settled) {
        settled = true;
        rejectCompletion(error);
      }
      await reader.cancel(error).catch(() => undefined);
      controller.error(error);
    };
    const record = (bytes: Uint8Array) => {
      if (!bytes.byteLength) return;
      actualSizeBytes += bytes.byteLength;
      if (actualSizeBytes > maximumBytes) {
        throw new MaterialImportMultipartError("IMPORT_FILE_TOO_LARGE", "文件超过 10 MiB 上限", 413);
      }
      hash.update(bytes);
      if (prefixSize < 8192) {
        const selected = bytes.slice(0, Math.min(bytes.byteLength, 8192 - prefixSize));
        prefixChunks.push(selected);
        prefixSize += selected.byteLength;
      }
    };
    const finish = async (controller: ReadableStreamDefaultController<Uint8Array>, suffix: Uint8Array) => {
      let remainder = suffix;
      while (remainder.byteLength < 2) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value?.byteLength) remainder = concatBytes(remainder, next.value);
      }
      if (remainder[0] === 45 && remainder[1] === 45) {
        remainder = remainder.slice(2);
      } else if (remainder[0] === 13 && remainder[1] === 10) {
        throw new MaterialImportMultipartError("IMPORT_FILE_MULTIPLE_NOT_ALLOWED", "只允许上传一个文件 part");
      } else {
        throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart 结束边界无效");
      }
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value?.byteLength) remainder = concatBytes(remainder, next.value);
        if (remainder.byteLength > 4) break;
      }
      const trailing = new TextDecoder().decode(remainder);
      if (trailing !== "" && trailing !== "\r\n") {
        throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart 结束后包含额外数据");
      }
      if (actualSizeBytes === 0) throw new MaterialImportMultipartError("IMPORT_FILE_EMPTY", "文件不能为空", 422);
      const prefix = new Uint8Array(prefixSize);
      let prefixOffset = 0;
      for (const chunk of prefixChunks) {
        prefix.set(chunk, prefixOffset);
        prefixOffset += chunk.byteLength;
      }
      settled = true;
      resolveCompletion({ actualSizeBytes, actualSha256: hash.digest("hex"), prefix });
      controller.close();
    };

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            const marker = indexOfBytes(pending, delimiter);
            if (marker >= 0) {
              const body = pending.slice(0, marker);
              record(body);
              if (body.byteLength) controller.enqueue(body);
              const suffix = pending.slice(marker + delimiter.byteLength);
              pending = new Uint8Array(0);
              await finish(controller, suffix);
              return;
            }
            const safeLength = pending.byteLength - delimiter.byteLength - 4;
            if (safeLength > 0) {
              const body = pending.slice(0, safeLength);
              pending = pending.slice(safeLength);
              record(body);
              controller.enqueue(body);
              return;
            }
            const next = await reader.read();
            if (next.done) throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart 文件未正常结束");
            if (next.value?.byteLength) pending = concatBytes(pending, next.value);
          }
        } catch (error) {
          await fail(controller, error);
        }
      },
      async cancel(reason) {
        if (!settled) {
          settled = true;
          rejectCompletion(reason ?? new Error("UPLOAD_STREAM_CANCELLED"));
        }
        await reader.cancel(reason).catch(() => undefined);
      },
    });
    return { ...parsed, stream, completion };
  }
  await reader.cancel().catch(() => undefined);
  throw new MaterialImportMultipartError("INVALID_REQUEST", "multipart header 过大或不完整");
}
