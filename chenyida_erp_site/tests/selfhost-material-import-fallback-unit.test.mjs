import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalMaterialImportFileStore } from "../app/lib/material-import-fallback/local-file-store.ts";
import {
  MaterialImportFileSecurityError,
  runMaterialImportBasicSecurityCheck,
} from "../app/lib/material-import/file-security.ts";
import {
  readSingleFilePart,
  validateSingleFileMultipartHeaders,
} from "../app/lib/material-import/multipart.ts";

function bytes(value) {
  return new TextEncoder().encode(value);
}

function stream(value) {
  const content = value instanceof Uint8Array ? value : bytes(value);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(content);
      controller.close();
    },
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function collect(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "cyd-import-fallback-store-"));
  try { await run(root, new LocalMaterialImportFileStore(root)); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("local import store derives private deterministic paths and rejects unsafe identities", async () => {
  await fixture(async (_root, store) => {
    const operationId = randomUUID();
    assert.deepEqual(store.paths(41, operationId, ".CSV"), {
      stagingRelativePath: `material-import/.staging/${operationId}.ready`,
      finalRelativePath: `material-import/41/${operationId}.csv`,
    });
    assert.throws(() => store.paths(0, operationId, ".csv"), /IMPORT_BATCH_ID_INVALID/);
    assert.throws(() => store.paths(1, "not-a-uuid", ".csv"), /IMPORT_OPERATION_ID_INVALID/);
    assert.throws(() => store.paths(1, operationId, ".pdf"), /IMPORT_FILE_EXTENSION_INVALID/);
    await assert.rejects(store.inspect("../outside"), /FILE_PATH_INVALID/);
    await assert.rejects(store.inspect("/absolute"), /FILE_PATH_INVALID/);
    await assert.rejects(store.inspect("material-import\\outside"), /FILE_PATH_INVALID/);
  });
});

test("staging is durable, bounded and never overwrites an existing operation object", async () => {
  await fixture(async (root, store) => {
    const operationId = randomUUID();
    const lease = randomUUID();
    const paths = store.paths(9, operationId, ".csv");
    const content = bytes("supplier_code,name\nA-1,Resistor\n");
    const first = await store.stage({ relativePath: paths.stagingRelativePath, leaseToken: lease, body: stream(content) });
    assert.equal(first.kind, "stored");
    assert.equal(first.facts.sizeBytes, content.byteLength);
    assert.equal(first.facts.sha256, sha256(content));
    assert.deepEqual(first.facts.prefix, content);
    const second = await store.stage({ relativePath: paths.stagingRelativePath, leaseToken: randomUUID(), body: stream("different") });
    assert.equal(second.kind, "exists");
    assert.equal(second.facts.sha256, sha256(content));
    assert.deepEqual(await readFile(join(root, paths.stagingRelativePath)), Buffer.from(content));
    assert.equal((await stat(join(root, paths.stagingRelativePath))).mode & 0o777, 0o440);
    const stagingEntries = await readdir(join(root, "material-import/.staging"));
    assert.deepEqual(stagingEntries, [`${operationId}.ready`]);
  });
});

test("failed or oversized staging removes only its exact temporary file", async () => {
  await fixture(async (root, store) => {
    const operationId = randomUUID();
    const paths = store.paths(7, operationId, ".csv");
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes("partial"));
        controller.error(new Error("SOURCE_FAILED"));
      },
    });
    await assert.rejects(store.stage({ relativePath: paths.stagingRelativePath, leaseToken: randomUUID(), body: broken }), /SOURCE_FAILED/);
    assert.equal(await store.inspectOptional(paths.stagingRelativePath), null);
    assert.deepEqual(await readdir(join(root, "material-import/.staging")), []);
    await assert.rejects(store.stage({ relativePath: paths.stagingRelativePath, leaseToken: randomUUID(), body: stream("12345"), maximumBytes: 4 }), /IMPORT_FILE_TOO_LARGE/);
    assert.equal(await store.inspectOptional(paths.stagingRelativePath), null);
    assert.deepEqual(await readdir(join(root, "material-import/.staging")), []);
  });
});

test("promotion uses no-overwrite hard-link publication and is idempotent after interruption", async () => {
  await fixture(async (root, store) => {
    const operationId = randomUUID();
    const paths = store.paths(3, operationId, ".csv");
    const content = bytes("a,b\n1,2\n");
    const expectedSha256 = sha256(content);
    await store.stage({ relativePath: paths.stagingRelativePath, leaseToken: randomUUID(), body: stream(content) });
    const first = await store.promote({ ...paths, expectedSha256, expectedSizeBytes: content.byteLength });
    assert.equal(first.kind, "promoted");
    assert.equal(await store.inspectOptional(paths.stagingRelativePath), null);
    assert.deepEqual(await readFile(join(root, paths.finalRelativePath)), Buffer.from(content));
    assert.equal((await stat(join(root, paths.finalRelativePath))).mode & 0o777, 0o440);
    const second = await store.promote({ ...paths, expectedSha256, expectedSizeBytes: content.byteLength });
    assert.equal(second.kind, "already_promoted");
    assert.deepEqual(await readFile(join(root, paths.finalRelativePath)), Buffer.from(content));
  });
});

test("temporary cleanup requires the exact operation and lease without scanning siblings", async () => {
  await fixture(async (root, store) => {
    const operationId = randomUUID();
    const lease = randomUUID();
    const otherLease = randomUUID();
    const directory = join(root, "material-import/.staging");
    await store.stage({ relativePath: `material-import/.staging/${randomUUID()}.ready`, leaseToken: randomUUID(), body: stream("keep") });
    const exact = join(directory, `${operationId}.ready.part.${lease}`);
    const sibling = join(directory, `${operationId}.ready.part.${otherLease}`);
    await writeFile(exact, "remove");
    await writeFile(sibling, "keep");
    assert.equal(await store.cleanupOperationTemp(operationId, lease), true);
    assert.equal(await store.cleanupOperationTemp(operationId, lease), false);
    assert.deepEqual(await readFile(sibling), Buffer.from("keep"));
  });
});

test("promotion preserves evidence when an existing final object does not match", async () => {
  await fixture(async (root, store) => {
    const operationId = randomUUID();
    const paths = store.paths(5, operationId, ".csv");
    const expected = bytes("expected");
    const unexpected = bytes("unexpected");
    await store.stage({ relativePath: paths.stagingRelativePath, leaseToken: randomUUID(), body: stream(expected) });
    await store.stage({ relativePath: paths.finalRelativePath, leaseToken: randomUUID(), body: stream(unexpected) });
    await assert.rejects(store.promote({ ...paths, expectedSha256: sha256(expected), expectedSizeBytes: expected.byteLength }), /IMPORT_FILE_FINAL_MISMATCH/);
    assert.deepEqual(await readFile(join(root, paths.stagingRelativePath)), Buffer.from(expected));
    assert.deepEqual(await readFile(join(root, paths.finalRelativePath)), Buffer.from(unexpected));
  });
});

test("object-store range reads support bounded security inspection", async () => {
  await fixture(async (_root, store) => {
    const key = `material-import/.staging/${randomUUID()}.ready`;
    const content = bytes("0123456789");
    await store.stage({ relativePath: key, leaseToken: randomUUID(), body: stream(content) });
    async function collect(range) {
      const opened = await store.open(key, range);
      assert.ok(opened);
      const chunks = [];
      for await (const chunk of opened) chunks.push(chunk);
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString();
    }
    assert.equal(await collect({ offset: 2, length: 4 }), "2345");
    assert.equal(await collect({ suffix: 3 }), "789");
    await assert.rejects(store.open(key, { suffix: 2, offset: 1 }), /IMPORT_FILE_RANGE_INVALID/);
  });
});

test("symlinked storage directories fail closed without writing outside the root", async () => {
  const outside = await mkdtemp(join(tmpdir(), "cyd-import-fallback-outside-"));
  try {
    await fixture(async (root, store) => {
      await symlink(outside, join(root, "material-import"));
      const paths = store.paths(1, randomUUID(), ".csv");
      await assert.rejects(store.stage({ relativePath: paths.stagingRelativePath, leaseToken: randomUUID(), body: stream("safe") }), /IMPORT_FILE_DIRECTORY_INVALID/);
      assert.deepEqual(await readdir(outside), []);
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("multipart preflight is body-free and parser returns independently verified facts", async () => {
  const boundary = "cyd-safe-boundary";
  const content = bytes("code,name\nR-1,Resistor\n");
  const raw = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="safe.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(raw);
      controller.close();
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  });
  assert.equal(validateSingleFileMultipartHeaders(request).boundary, boundary);
  assert.equal(pulls, 0);
  const part = await readSingleFilePart(request);
  assert.equal(part.filename, "safe.csv");
  assert.equal(part.declaredMimeType, "text/csv");
  assert.deepEqual(await collect(part.stream), Buffer.from(content));
  assert.deepEqual(await part.completion, {
    actualSizeBytes: content.byteLength,
    actualSha256: sha256(content),
    prefix: content,
  });
});

test("multipart parser cancels oversized headers and rejects trailing or additional parts", async () => {
  const boundary = "cyd-malformed-boundary";
  let cancelled = 0;
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes(`--${boundary}\r\nX-Fill: ${"x".repeat(17 * 1024)}`));
    },
    cancel() { cancelled += 1; },
  });
  const oversizedRequest = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: oversized,
    duplex: "half",
  });
  await assert.rejects(readSingleFilePart(oversizedRequest), /multipart header 过大或不完整/);
  assert.equal(cancelled, 1);

  for (const suffix of [
    `\r\n--${boundary}--\r\nEXTRA`,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.csv"\r\n\r\nsecond\r\n--${boundary}--\r\n`,
  ]) {
    const raw = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="first.csv"\r\nContent-Type: text/csv\r\n\r\nfirst${suffix}`;
    const part = await readSingleFilePart(new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: raw,
    }));
    const completion = assert.rejects(part.completion, /multipart|只允许上传一个文件 part/);
    await assert.rejects(collect(part.stream), /multipart|只允许上传一个文件 part/);
    await completion;
  }
});

test("security checks enforce strict extension/type binding and cancel failed range reads", async () => {
  let opened = 0;
  const unopenedStore = {
    async open() { opened += 1; return null; },
  };
  await assert.rejects(runMaterialImportBasicSecurityCheck({
    store: unopenedStore,
    objectKey: "unused",
    actualSizeBytes: 4,
    detectedType: "CSV",
    filenameExtension: ".xlsx",
    declaredMimeType: "application/octet-stream",
  }), (error) => error instanceof MaterialImportFileSecurityError && error.code === "IMPORT_FILE_TYPE_UNSUPPORTED");
  assert.equal(opened, 0);

  let cancelled = 0;
  const maliciousRangeStore = {
    async open() {
      return new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(101)); },
        cancel() { cancelled += 1; },
      });
    },
  };
  await assert.rejects(runMaterialImportBasicSecurityCheck({
    store: maliciousRangeStore,
    objectKey: "oversized-range",
    actualSizeBytes: 100,
    detectedType: "XLSX",
    filenameExtension: ".xlsx",
    declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), (error) => error instanceof MaterialImportFileSecurityError && error.code === "IMPORT_FILE_SECURITY_CHECK_FAILED");
  assert.equal(cancelled, 1);
});

test("CSV security failures cancel their stream and preserve storage error identity", async () => {
  let cancelled = 0;
  const nulStore = {
    async open() {
      return new ReadableStream({
        pull(controller) { controller.enqueue(Uint8Array.of(65, 0, 66)); },
        cancel() { cancelled += 1; },
      });
    },
  };
  await assert.rejects(runMaterialImportBasicSecurityCheck({
    store: nulStore,
    objectKey: "nul.csv",
    actualSizeBytes: 3,
    detectedType: "CSV",
    filenameExtension: ".csv",
    declaredMimeType: "text/csv",
  }), (error) => error instanceof MaterialImportFileSecurityError && error.code === "IMPORT_FILE_SECURITY_CHECK_FAILED");
  assert.equal(cancelled, 1);

  const storageFailure = new Error("SYNTHETIC_STORAGE_FAILURE");
  const brokenStore = { async open() { throw storageFailure; } };
  await assert.rejects(runMaterialImportBasicSecurityCheck({
    store: brokenStore,
    objectKey: "broken.csv",
    actualSizeBytes: 3,
    detectedType: "CSV",
    filenameExtension: ".csv",
    declaredMimeType: "text/csv",
  }), (error) => error === storageFailure);
});
