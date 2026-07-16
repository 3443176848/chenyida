/// <reference lib="webworker" />

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const CHUNK_BYTES = 1024 * 1024;
let cancelled = false;

self.addEventListener("message", async (event: MessageEvent<{ type: "HASH" | "CANCEL"; file?: File }>) => {
  if (event.data.type === "CANCEL") { cancelled = true; return; }
  const file = event.data.file;
  if (event.data.type !== "HASH" || !file) return;
  cancelled = false;
  const hasher = sha256.create();
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      if (cancelled) { self.postMessage({ type: "CANCELLED" }); return; }
      const end = Math.min(file.size, offset + CHUNK_BYTES);
      hasher.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
      self.postMessage({ type: "PROGRESS", processedBytes: end, totalBytes: file.size });
    }
    if (cancelled) { self.postMessage({ type: "CANCELLED" }); return; }
    self.postMessage({ type: "COMPLETED", sha256: bytesToHex(hasher.digest()), processedBytes: file.size, totalBytes: file.size });
  } catch {
    self.postMessage({ type: "FAILED", message: "无法计算文件摘要，请重新选择文件" });
  } finally {
    hasher.destroy();
  }
});

export {};
