import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalMaterialImportFileStore } from "../app/lib/material-import-fallback/local-file-store.ts";
import {
  decodeMaterialImportFallbackCursor,
  encodeMaterialImportFallbackCursor,
  handleSelfhostMaterialImportFallbackApi,
} from "../app/lib/material-import-fallback/handler.ts";
import { normalizeMaterialImportUploadHeaders } from "../app/lib/material-import-fallback/service.ts";
import { MaterialImportFallbackError } from "../app/lib/material-import-fallback/types.ts";
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

function fallbackService(overrides = {}) {
  const unexpected = async () => { throw new Error("UNEXPECTED_SERVICE_CALL"); };
  return {
    createBatch: unexpected,
    listBatches: unexpected,
    batchDetail: unexpected,
    cancelBatch: unexpected,
    prepareUpload: unexpected,
    heartbeatUpload: async () => true,
    executeUpload: unexpected,
    failPreparedUpload: unexpected,
    queueParse: unexpected,
    job: unexpected,
    failureAudit: async () => undefined,
    ...overrides,
  };
}

function fallbackDependencies(service, overrides = {}) {
  return {
    pool: {},
    queue: {},
    actor: { username: "owner", permissions: ["material.import.read", "material.import.create", "material.import.parse", "material.import.cancel"] },
    requestId: randomUUID(),
    requireCsrf: () => undefined,
    uploadRoot: "/synthetic-unused",
    maximumBytes: 10 * 1024 * 1024,
    leaseSeconds: 60,
    service,
    ...overrides,
  };
}

function trackedMultipartRequest(path, headers = {}, method = "POST") {
  let pulls = 0;
  let cancellations = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(bytes("synthetic-body-that-must-not-be-read"));
      controller.close();
    },
    cancel() { cancellations += 1; },
  }, { highWaterMark: 0 });
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "multipart/form-data; boundary=cyd-handler-test", ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : body,
    duplex: "half",
  });
  return { request, facts: () => ({ pulls, cancellations }) };
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

test("symlinked storage ancestors cannot expose, delete or reuse an outside file", async () => {
  await fixture(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), "cyd-import-outside-"));
    try {
      const operationId = randomUUID();
      const relativePath = `material-import/.staging/${operationId}.ready`;
      await mkdir(join(root, "material-import"), { recursive: true });
      await symlink(outside, join(root, "material-import", ".staging"));
      await writeFile(join(outside, `${operationId}.ready`), "outside-evidence");
      const store = new LocalMaterialImportFileStore(root);
      await assert.rejects(store.inspect(relativePath), /IMPORT_FILE_DIRECTORY_INVALID/);
      await assert.rejects(store.open(relativePath), /IMPORT_FILE_DIRECTORY_INVALID/);
      await assert.rejects(store.delete(relativePath), /IMPORT_FILE_DIRECTORY_INVALID/);
      await assert.rejects(store.stage({
        relativePath,
        leaseToken: randomUUID(),
        body: stream("replacement"),
      }), /IMPORT_FILE_DIRECTORY_INVALID/);
      assert.equal(await readFile(join(outside, `${operationId}.ready`), "utf8"), "outside-evidence");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
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

test("upload header normalization binds filename, type, digest, size and the schema maximum", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(normalizeMaterialImportUploadHeaders({
    expectedVersion: "3",
    declaredFilename: "供应商清单.CSV",
    declaredMimeType: " TEXT/CSV ",
    declaredSha256: hash.toUpperCase(),
    declaredSizeBytes: "42",
    duplicateAction: "REJECT",
  }), {
    expectedVersion: 3,
    declaredFilename: "供应商清单.CSV",
    filenameExtension: ".csv",
    declaredMimeType: "text/csv",
    declaredSha256: hash,
    declaredSizeBytes: 42,
    duplicateAction: "REJECT",
  });
  assert.throws(() => normalizeMaterialImportUploadHeaders({
    expectedVersion: 1,
    declaredFilename: "unsafe.csv",
    filenameExtension: ".xlsx",
    declaredMimeType: "text/csv",
    declaredSha256: hash,
    declaredSizeBytes: 1,
    duplicateAction: "REJECT",
  }), (error) => error instanceof MaterialImportFallbackError && error.code === "IMPORT_FILE_NAME_INVALID");
  assert.throws(() => normalizeMaterialImportUploadHeaders({
    expectedVersion: 1,
    declaredFilename: "large.csv",
    declaredMimeType: "text/csv",
    declaredSha256: hash,
    declaredSizeBytes: 10 * 1024 * 1024 + 1,
    duplicateAction: "REJECT",
  }, 20 * 1024 * 1024), (error) => error instanceof MaterialImportFallbackError && error.code === "IMPORT_FILE_TOO_LARGE");
});

test("fallback cursors are opaque, query-bound and reject tampering", () => {
  const scope = { actor: "owner", status: "CREATED", source_kind: "CSV", sort: "created_at_desc", limit: 20 };
  const facts = { createdAt: "2026-08-12T08:00:00.000Z", id: 42 };
  const cursor = encodeMaterialImportFallbackCursor(facts, scope);
  assert.deepEqual(decodeMaterialImportFallbackCursor(cursor, scope), facts);
  assert.throws(() => decodeMaterialImportFallbackCursor(cursor, { ...scope, status: "FAILED" }), /cursor 无效或已失效/);
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  parsed.id = 43;
  assert.throws(() => decodeMaterialImportFallbackCursor(Buffer.from(JSON.stringify(parsed)).toString("base64url"), scope), /cursor 无效或已失效/);
});

test("fallback upload rejects permission, CSRF and owner failures before pulling the body", async () => {
  const route = "/api/material-master/import-batches/7/file";
  const denied = trackedMultipartRequest(route);
  const deniedResponse = await handleSelfhostMaterialImportFallbackApi(denied.request, fallbackDependencies(
    fallbackService(),
    { actor: { username: "reader", permissions: ["material.import.read"] } },
  ));
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).code, "PERMISSION_DENIED");
  assert.deepEqual(denied.facts(), { pulls: 0, cancellations: 1 });

  const csrf = trackedMultipartRequest(route);
  const csrfResponse = await handleSelfhostMaterialImportFallbackApi(csrf.request, fallbackDependencies(
    fallbackService(),
    { requireCsrf: () => { throw new Error("opaque upstream CSRF failure"); } },
  ));
  assert.equal(csrfResponse.status, 403);
  assert.equal((await csrfResponse.json()).code, "CSRF_INVALID");
  assert.deepEqual(csrf.facts(), { pulls: 0, cancellations: 1 });

  const headers = {
    "Idempotency-Key": `upload-${randomUUID()}`,
    "X-Expected-Version": "1",
    "X-File-Name": encodeURIComponent("safe.csv"),
    "X-File-Mime": "text/csv",
    "X-File-SHA256": "b".repeat(64),
    "X-File-Size": "7",
    "X-Duplicate-Action": "REJECT",
  };
  const invisible = trackedMultipartRequest(route, headers);
  const invisibleResponse = await handleSelfhostMaterialImportFallbackApi(invisible.request, fallbackDependencies(
    fallbackService({
      prepareUpload: async () => { throw new MaterialImportFallbackError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404); },
    }),
  ));
  assert.equal(invisibleResponse.status, 404);
  assert.equal((await invisibleResponse.json()).code, "IMPORT_BATCH_NOT_FOUND");
  assert.deepEqual(invisible.facts(), { pulls: 0, cancellations: 1 });
});

test("fallback replay cancels the unneeded upload and returns safe idempotency headers", async () => {
  const operationId = randomUUID();
  const tracked = trackedMultipartRequest("/api/material-master/import-batches/7/file", {
    "Idempotency-Key": `upload-${randomUUID()}`,
    "X-Expected-Version": "1",
    "X-File-Name": encodeURIComponent("safe.csv"),
    "X-File-Mime": "text/csv",
    "X-File-SHA256": "c".repeat(64),
    "X-File-Size": "7",
    "X-Duplicate-Action": "REJECT",
  });
  const response = await handleSelfhostMaterialImportFallbackApi(tracked.request, fallbackDependencies(fallbackService({
    prepareUpload: async () => ({
      data: { batch: { id: 7, status: "FILE_READY" } },
      statusCode: 201,
      operationId,
      replayed: true,
    }),
  })));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(response.headers.get("X-Operation-ID"), operationId);
  assert.deepEqual(tracked.facts(), { pulls: 0, cancellations: 1 });
  const payload = await response.json();
  assert.equal(payload.data.batch.status, "FILE_READY");
  assert.equal(payload.request_id.length, 36);
});

test("fallback upload dispatches the parser only after a durable prepared operation", async () => {
  const operationId = randomUUID();
  const leaseToken = randomUUID();
  const prepared = {
    kind: "PREPARED",
    operationId,
    leaseToken,
    batchId: 7,
    expectedBatchVersion: 2,
    declaredFilename: "safe.csv",
    filenameExtension: ".csv",
    declaredMimeType: "text/csv",
    declaredSha256: "d".repeat(64),
    declaredSizeBytes: 7,
    duplicateAction: "REJECT",
    stagingRelativePath: `material-import/.staging/${operationId}.ready`,
    finalRelativePath: `material-import/7/${operationId}.csv`,
    resumed: false,
  };
  const calls = [];
  const tracked = trackedMultipartRequest("/api/material-master/import-batches/7/file", {
    "Idempotency-Key": `upload-${randomUUID()}`,
    "X-Expected-Version": "2",
    "X-File-Name": encodeURIComponent("safe.csv"),
    "X-File-Mime": "text/csv",
    "X-File-SHA256": "d".repeat(64),
    "X-File-Size": "7",
    "X-Duplicate-Action": "REJECT",
  });
  const part = {
    filename: "safe.csv",
    declaredMimeType: "text/csv",
    stream: stream("a,b\n1\n"),
    completion: Promise.resolve({ actualSizeBytes: 7, actualSha256: "d".repeat(64), prefix: bytes("a,b\n1\n") }),
  };
  const service = fallbackService({
    prepareUpload: async (input) => { calls.push(["prepare", input.headers]); return prepared; },
    executeUpload: async (input) => {
      calls.push(["execute", input.preparation.operationId, input.part.filename]);
      return { data: { batch: { id: 7, status: "FILE_READY" } }, statusCode: 201, operationId, replayed: false };
    },
  });
  const response = await handleSelfhostMaterialImportFallbackApi(tracked.request, fallbackDependencies(service, {
    readFilePart: async () => { calls.push(["multipart"]); return part; },
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(calls.map((call) => call[0]), ["prepare", "multipart", "execute"]);
  assert.equal(calls[0][1].declaredFilename, "safe.csv");
  assert.equal(calls[1][0], "multipart");
  assert.equal(calls[2][1], operationId);
});

test("fallback cancel route enforces its independent capability and immutable request contract", async () => {
  const operationId = randomUUID();
  let captured;
  const request = new Request("http://localhost/api/material-master/import-batches/7/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `cancel-${randomUUID()}` },
    body: JSON.stringify({ expected_version: 4, reason_code: "USER_CANCELLED" }),
  });
  const response = await handleSelfhostMaterialImportFallbackApi(request, fallbackDependencies(fallbackService({
    cancelBatch: async (input) => {
      captured = input;
      return { data: { id: 7, status: "CANCELLED", current_version: 5 }, statusCode: 200, operationId };
    },
  })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Operation-ID"), operationId);
  assert.deepEqual(
    { batchId: captured.batchId, expectedVersion: captured.expectedVersion, reasonCode: captured.reasonCode },
    { batchId: 7, expectedVersion: 4, reasonCode: "USER_CANCELLED" },
  );

  const denied = await handleSelfhostMaterialImportFallbackApi(new Request(
    "http://localhost/api/material-master/import-batches/7/cancel",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `cancel-${randomUUID()}` },
      body: JSON.stringify({ expected_version: 4, reason_code: "USER_CANCELLED" }),
    },
  ), fallbackDependencies(fallbackService(), {
    actor: { username: "owner", permissions: ["material.import.read", "material.import.parse"] },
  }));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "PERMISSION_DENIED");
});

test("fallback routes return explicit 405 without dispatching a service operation", async () => {
  const response = await handleSelfhostMaterialImportFallbackApi(
    new Request("http://localhost/api/material-master/import-batches", { method: "DELETE" }),
    fallbackDependencies(fallbackService()),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST");
  assert.equal((await response.json()).code, "METHOD_NOT_ALLOWED");
});
