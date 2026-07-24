import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFileStorage } from "../app/lib/infrastructure/file-storage.ts";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "chenyida-selfhost-files-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("local storage rejects traversal and absolute paths", async () => fixture(async (root) => {
  const storage = new LocalFileStorage(root);
  await assert.rejects(storage.open("../outside"), /FILE_PATH_OUTSIDE_ROOT/);
  await assert.rejects(storage.open("/etc/passwd"), /FILE_PATH_INVALID/);
  await assert.rejects(storage.delete("a\\..\\outside"), /FILE_PATH_INVALID/);
}));

test("local storage atomically writes random names and records SHA-256", async () => fixture(async (root) => {
  const storage = new LocalFileStorage(root); const bytes = Buffer.from("atomic-content");
  const stored = await storage.write({ body: ReadableStream.from([bytes]), originalFilename: "../../supplier.csv", mimeType: "text/csv" });
  assert.equal(stored.originalFilename, "supplier.csv");
  assert.equal(stored.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(stored.sizeBytes, bytes.length); assert.match(stored.relativePath, /^[0-9a-f]{2}\/[0-9a-f-]{36}\.csv$/);
  assert.deepEqual(await readFile(join(root, stored.relativePath)), bytes);
  const names = await readdir(join(root, stored.relativePath.slice(0, 2))); assert.equal(names.some((name) => name.endsWith(".tmp")), false);
}));

test("failed source leaves no temporary or destination file", async () => fixture(async (root) => {
  const storage = new LocalFileStorage(root);
  async function* broken() { yield Buffer.from("partial"); throw new Error("source failed"); }
  await assert.rejects(storage.write({ body: broken(), originalFilename: "bad.csv", mimeType: "text/csv" }), /source failed/);
  const prefixes = await readdir(root); for (const prefix of prefixes) assert.deepEqual(await readdir(join(root, prefix)), []);
}));
