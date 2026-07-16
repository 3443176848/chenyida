import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  handleMaterialMasterApi,
  MATERIAL_ROLE_PERMISSIONS,
} from "../app/lib/material-api/index.ts";
import {
  cleanupExpiredMaterialImportObjects,
  MemoryMaterialImportObjectStore,
} from "../app/lib/material-import/index.ts";
import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-15T08:00:00.000Z");
const csrf = "material-import-csrf-token";
let sequence = 0;

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const source = Buffer.from(text);
    const compressed = deflateRawSync(source);
    const crc = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    const localEntry = Buffer.concat([local, nameBytes, compressed]);
    localParts.push(localEntry);
    centralParts.push(Buffer.concat([central, nameBytes]));
    localOffset += localEntry.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, eocd]));
}

function xlsxBytes(extraEntries = []) {
  return makeZip([
    ["[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>"],
    ["_rels/.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>"],
    ["xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"></workbook>"],
    ...extraEntries,
  ]);
}

async function applyMigration(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  const statements = splitD1MigrationStatements(sql);
  await DB.batch(statements.map((statement) => DB.prepare(statement)));
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `material-import-api-${sequence}` },
  });
  const { DB } = await mf.getBindings();
  for (const name of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql"]) await applyMigration(DB, name);
  const users = new Map([
    ["admin1", { username: "admin1", role: "admin", must_change_password: false }],
    ["manager1", { username: "manager1", role: "manager", must_change_password: false }],
    ["purchase1", { username: "purchase1", role: "purchase", must_change_password: false }],
    ["purchase2", { username: "purchase2", role: "purchase", must_change_password: false }],
    ["warehouse1", { username: "warehouse1", role: "warehouse", must_change_password: false }],
  ]);
  await DB.batch([...users.values()].map((user) => DB.prepare(`INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES(?,?,?,'test',1,0,1,?,?)`).bind(user.username, user.username, user.role, fixedNow.toISOString(), fixedNow.toISOString())));
  const objectStore = new MemoryMaterialImportObjectStore();
  return {
    DB,
    mf,
    objectStore,
    dependencies: {
      database: DB,
      objectStore,
      objectPrefix: "test",
      currentUser: async (request) => users.get(request.headers.get("X-Test-User")) ?? null,
      userCan: (user, permission) => MATERIAL_ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false,
      clock: () => new Date(fixedNow),
    },
  };
}

function jsonHeaders(user, key) {
  return {
    "Content-Type": "application/json",
    "X-Test-User": user,
    Origin: "http://local.test",
    Cookie: `CYD_ERP_CSRF=${csrf}`,
    "X-CSRF-Token": csrf,
    ...(key ? { "Idempotency-Key": key } : {}),
  };
}

async function call(context, path, options = {}) {
  const response = await handleMaterialMasterApi(new Request(`http://local.test${path}`, options), context.dependencies);
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

async function createBatch(context, user, sourceKind = "CSV", key = crypto.randomUUID()) {
  return call(context, "/api/material-master/import-batches", {
    method: "POST",
    headers: jsonHeaders(user, key),
    body: JSON.stringify({ source_kind: sourceKind }),
  });
}

async function upload(context, { batchId, version, user, bytes, filename = "materials.csv", type = "text/csv", key = crypto.randomUUID(), sha, duplicateAction }) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  const headers = new Headers({
    "X-Test-User": user,
    Origin: "http://local.test",
    Cookie: `CYD_ERP_CSRF=${csrf}`,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": key,
    "X-Expected-Version": String(version),
    "X-File-SHA256": sha ?? createHash("sha256").update(bytes).digest("hex"),
    "X-File-Size": String(bytes.byteLength),
  });
  if (duplicateAction) headers.set("X-Duplicate-Action", duplicateAction);
  return call(context, `/api/material-master/import-batches/${batchId}/file`, { method: "POST", headers, body: form });
}

test("Material import API enforces capability and owner visibility without leaking hidden totals", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    assert.equal((await createBatch(context, "warehouse1", "CSV", "warehouse-denied")).response.status, 403);
    const created = await createBatch(context, "purchase1", "CSV", "create-owner-0001");
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.status, "CREATED");
    const replay = await createBatch(context, "purchase1", "CSV", "create-owner-0001");
    assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
    assert.equal(replay.payload.data.id, created.payload.data.id);

    const ownList = await call(context, "/api/material-master/import-batches?sort=created_at_desc", { headers: { "X-Test-User": "purchase1" } });
    assert.equal(ownList.payload.total, 1);
    const hiddenList = await call(context, "/api/material-master/import-batches", { headers: { "X-Test-User": "purchase2" } });
    assert.equal(hiddenList.payload.total, 0);
    const hiddenDetail = await call(context, `/api/material-master/import-batches/${created.payload.data.id}`, { headers: { "X-Test-User": "purchase2" } });
    assert.equal(hiddenDetail.response.status, 404);
    const managerList = await call(context, "/api/material-master/import-batches?created_by_me=false", { headers: { "X-Test-User": "manager1" } });
    assert.equal(managerList.payload.total, 1);
  } finally {
    await context.mf.dispose();
  }
});

test("Material import CSV upload streams, preserves safe metadata, and reaches FILE_READY", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const created = await createBatch(context, "purchase1", "CSV", "create-upload-0001");
    const bytes = new TextEncoder().encode("name,formula,html\n0603,=1+1,<script>\n0805,+2,<html>\n");
    const uploaded = await upload(context, { batchId: created.payload.data.id, version: 1, user: "purchase1", bytes, filename: "../供应商/../../materials.csv", key: "upload-csv-0000001" });
    assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.payload));
    assert.equal(uploaded.payload.data.batch.status, "FILE_READY");
    assert.equal(uploaded.payload.data.file.security_check_status, "BASIC_CHECK_PASSED");
    assert.equal(uploaded.payload.data.file.original_filename, "materials.csv");
    assert.equal(uploaded.payload.data.file.actual_size_bytes, bytes.byteLength);
    assert.ok(!JSON.stringify(uploaded.payload).includes("object_key"));
    assert.ok(!JSON.stringify(uploaded.payload).includes("test/material-import"));
    const stored = await context.DB.prepare("SELECT object_key,actual_sha256 FROM material_import_files WHERE batch_id=?").bind(created.payload.data.id).first();
    assert.match(stored.object_key, /^test\/material-import\//);
    assert.equal(context.objectStore.keys().length, 1);
    const events = await call(context, `/api/material-master/import-batches/${created.payload.data.id}/events`, { headers: { "X-Test-User": "purchase1" } });
    assert.deepEqual(events.payload.data.map((event) => event.event_type), ["BATCH_CREATED", "FILE_UPLOAD_STARTED", "FILE_STORED", "FILE_SECURITY_CHECK_PASSED", "FILE_UPLOAD_COMPLETED"]);
  } finally {
    await context.mf.dispose();
  }
});

test("Material import upload rejects hash mismatch and duplicate files without hidden cross-owner disclosure", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const bytes = new TextEncoder().encode("code,name\nA1,物料\n");
    const first = await createBatch(context, "purchase1", "CSV", "create-dup-one01");
    assert.equal((await upload(context, { batchId: first.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-dup-one01" })).response.status, 200);

    const hidden = await createBatch(context, "purchase2", "CSV", "create-dup-two01");
    const hiddenUpload = await upload(context, { batchId: hidden.payload.data.id, version: 1, user: "purchase2", bytes, key: "upload-dup-two01" });
    assert.equal(hiddenUpload.response.status, 200, JSON.stringify(hiddenUpload.payload));

    const visible = await createBatch(context, "purchase1", "CSV", "create-dup-three1");
    const rejected = await upload(context, { batchId: visible.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-dup-three1" });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.payload.error.code, "IMPORT_FILE_DUPLICATE");

    const allowed = await createBatch(context, "purchase1", "CSV", "create-dup-four01");
    const accepted = await upload(context, { batchId: allowed.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-dup-four01", duplicateAction: "ALLOW_DUPLICATE" });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));

    const mismatch = await createBatch(context, "purchase1", "CSV", "create-hash-bad01");
    const mismatchResult = await upload(context, { batchId: mismatch.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-hash-bad01", sha: "0".repeat(64) });
    assert.equal(mismatchResult.response.status, 422);
    assert.equal(mismatchResult.payload.error.code, "IMPORT_FILE_HASH_MISMATCH");
    const mismatchRow = await context.DB.prepare("SELECT status,terminal_at FROM material_import_batches WHERE id=?").bind(mismatch.payload.data.id).first();
    assert.equal(mismatchRow.status, "FAILED");
    assert.ok(mismatchRow.terminal_at);
  } finally {
    await context.mf.dispose();
  }
});

test("Material import result-unknown recovery and cancel race remain observable and terminal-safe", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const bytes = new TextEncoder().encode("code,name\nA1,物料\n");
    const created = await createBatch(context, "purchase1", "CSV", "create-unknown01");
    context.objectStore.failNextPut("after");
    const recovered = await upload(context, { batchId: created.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-unknown01" });
    assert.equal(recovered.response.status, 200, JSON.stringify(recovered.payload));
    assert.equal(context.objectStore.keys().length, 1);
    const replayed = await upload(context, { batchId: created.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-unknown01" });
    assert.equal(replayed.response.status, 200);
    assert.equal(replayed.response.headers.get("Idempotency-Replayed"), "true");
    assert.equal(context.objectStore.keys().length, 1);

    const cancel = await call(context, `/api/material-master/import-batches/${created.payload.data.id}/cancel`, {
      method: "POST",
      headers: jsonHeaders("purchase1", "cancel-ready-0001"),
      body: JSON.stringify({ expected_version: recovered.payload.data.batch.current_version, reason_code: "USER_CANCELLED" }),
    });
    assert.equal(cancel.response.status, 200, JSON.stringify(cancel.payload));
    assert.equal(cancel.payload.data.batch.status, "CANCELLED");
    assert.equal(context.objectStore.keys().length, 0);
    const latest = await context.DB.prepare("SELECT status,terminal_at FROM material_import_batches WHERE id=?").bind(created.payload.data.id).first();
    assert.equal(latest.status, "CANCELLED");
    assert.ok(latest.terminal_at);

    const late = await upload(context, { batchId: created.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-late-00001" });
    assert.equal(late.response.status, 409);
    assert.equal(late.payload.error.code, "IMPORT_BATCH_VERSION_CONFLICT");
  } finally {
    await context.mf.dispose();
  }
});

test("Material import cleanup is injectable, retryable, and never needs a production cron", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const created = await createBatch(context, "purchase1", "CSV", "create-cleanup01");
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    const uploaded = await upload(context, { batchId: created.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-cleanup01" });
    const cancelled = await call(context, `/api/material-master/import-batches/${created.payload.data.id}/cancel`, {
      method: "POST", headers: jsonHeaders("purchase1", "cancel-cleanup01"), body: JSON.stringify({ expected_version: uploaded.payload.data.batch.current_version }),
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(context.objectStore.keys().length, 0);
    const result = await cleanupExpiredMaterialImportObjects({ ...context.dependencies, clock: () => new Date("2026-08-15T08:00:00.000Z") });
    assert.deepEqual(result, { examined: 0, deleted: 0, failed: 0 });
  } finally {
    await context.mf.dispose();
  }
});

test("Material import enforces the 10 MiB streaming boundary and confirmed storage failures", { timeout: 120_000 }, async () => {
  const context = await fixture();
  try {
    const boundary = new Uint8Array(10 * 1024 * 1024);
    boundary.fill(0x61);
    const acceptedBatch = await createBatch(context, "purchase1", "CSV", "create-size-ok001");
    const accepted = await upload(context, { batchId: acceptedBatch.payload.data.id, version: 1, user: "purchase1", bytes: boundary, key: "upload-size-ok001" });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));

    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    oversized.fill(0x61);
    const largeBatch = await createBatch(context, "purchase1", "CSV", "create-size-bad01");
    const rejected = await upload(context, { batchId: largeBatch.payload.data.id, version: 1, user: "purchase1", bytes: oversized, key: "upload-size-bad01" });
    assert.equal(rejected.response.status, 413, JSON.stringify(rejected.payload));
    assert.equal(rejected.payload.error.code, "IMPORT_FILE_TOO_LARGE");

    const failedBatch = await createBatch(context, "purchase1", "CSV", "create-storebad1");
    context.objectStore.failNextPut("before");
    const failed = await upload(context, { batchId: failedBatch.payload.data.id, version: 1, user: "purchase1", bytes: new TextEncoder().encode("a,b\n1,2\n"), key: "upload-storebad1" });
    assert.equal(failed.response.status, 503, JSON.stringify(failed.payload));
    assert.equal(failed.payload.error.code, "IMPORT_FILE_STORAGE_FAILED");
  } finally {
    await context.mf.dispose();
  }
});

test("Material import XLSX checks reject disguises and macro parts without parsing worksheets", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const validBatch = await createBatch(context, "purchase1", "XLSX", "create-xlsx-ok01");
    const valid = await upload(context, { batchId: validBatch.payload.data.id, version: 1, user: "purchase1", bytes: xlsxBytes(), filename: "materials.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key: "upload-xlsx-ok01" });
    assert.equal(valid.response.status, 200, JSON.stringify(valid.payload));

    const fakeBatch = await createBatch(context, "purchase1", "XLSX", "create-xlsx-fake1");
    const fake = await upload(context, { batchId: fakeBatch.payload.data.id, version: 1, user: "purchase1", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), filename: "fake.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key: "upload-xlsx-fake1" });
    assert.equal(fake.response.status, 422);
    assert.equal(fake.payload.error.code, "IMPORT_FILE_SECURITY_CHECK_FAILED");

    const macroBatch = await createBatch(context, "purchase1", "XLSX", "create-xlsm-macro1");
    const macro = await upload(context, { batchId: macroBatch.payload.data.id, version: 1, user: "purchase1", bytes: xlsxBytes([["xl/vbaProject.bin", "macro"]]), filename: "macro.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", key: "upload-xlsm-macro1" });
    assert.equal(macro.response.status, 422);
    assert.equal(macro.payload.error.code, "IMPORT_FILE_SECURITY_CHECK_FAILED");

    const extensionBatch = await createBatch(context, "purchase1", "XLSX", "create-xlsm-ext01");
    const extension = await upload(context, { batchId: extensionBatch.payload.data.id, version: 1, user: "purchase1", bytes: xlsxBytes(), filename: "macro.xlsm", type: "application/vnd.ms-excel.sheet.macroEnabled.12", key: "upload-xlsm-ext01" });
    assert.equal(extension.response.status, 415);
    assert.equal(extension.payload.error.code, "IMPORT_FILE_TYPE_UNSUPPORTED");
  } finally {
    await context.mf.dispose();
  }
});

test("Material import mismatch evidence enters reconciliation and concurrent second files cannot win", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const bytes = new TextEncoder().encode("code,name\nA1,物料\n");
    const reconciliationBatch = await createBatch(context, "purchase1", "CSV", "create-reconcile1");
    context.objectStore.failNextPut("corrupt_after");
    const reconciliation = await upload(context, { batchId: reconciliationBatch.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-reconcile1" });
    assert.equal(reconciliation.response.status, 202, JSON.stringify(reconciliation.payload));
    assert.equal(reconciliation.payload.code, "IMPORT_BATCH_RECONCILIATION_REQUIRED");
    assert.equal(reconciliation.payload.data.batch.status, "RECONCILIATION_REQUIRED");

    const concurrentBatch = await createBatch(context, "purchase1", "CSV", "create-concurrent1");
    const [left, right] = await Promise.all([
      upload(context, { batchId: concurrentBatch.payload.data.id, version: 1, user: "purchase1", bytes, filename: "left.csv", key: "upload-concurrent-left" }),
      upload(context, { batchId: concurrentBatch.payload.data.id, version: 1, user: "purchase1", bytes, filename: "right.csv", key: "upload-concurrent-right" }),
    ]);
    assert.equal([left.response.status, right.response.status].filter((status) => status === 200).length, 1);
    assert.equal([left.response.status, right.response.status].filter((status) => status === 409).length, 1);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) AS count FROM material_import_files WHERE batch_id=?").bind(concurrentBatch.payload.data.id).first()).count, 1);
  } finally {
    await context.mf.dispose();
  }
});

test("Material import cancel can win while object upload is in flight and late completion cannot revive the batch", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    let release;
    let started;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const releasePromise = new Promise((resolve) => { release = resolve; });
    const delegate = context.objectStore;
    const gatedStore = {
      head: (key) => delegate.head(key),
      open: (key, range) => delegate.open(key, range),
      delete: (key) => delegate.delete(key),
      async putIfAbsent(input) {
        started();
        await releasePromise;
        return delegate.putIfAbsent(input);
      },
    };
    context.dependencies.objectStore = gatedStore;
    const batch = await createBatch(context, "purchase1", "CSV", "create-cancelrace");
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    const uploadPromise = upload(context, { batchId: batch.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-cancelrace" });
    await startedPromise;
    const pending = await context.DB.prepare("SELECT status,current_version FROM material_import_batches WHERE id=?").bind(batch.payload.data.id).first();
    assert.deepEqual(pending, { status: "UPLOAD_PENDING", current_version: 2 });
    const concurrentReplay = await upload(context, { batchId: batch.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-cancelrace" });
    assert.equal(concurrentReplay.response.status, 409);
    assert.equal(concurrentReplay.payload.error.code, "IDEMPOTENCY_REQUEST_IN_PROGRESS");
    const cancelled = await call(context, `/api/material-master/import-batches/${batch.payload.data.id}/cancel`, {
      method: "POST", headers: jsonHeaders("purchase1", "cancel-race-0001"), body: JSON.stringify({ expected_version: 2 }),
    });
    assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.payload));
    release();
    const lateCompletion = await uploadPromise;
    assert.equal(lateCompletion.response.status, 409);
    assert.equal((await context.DB.prepare("SELECT status FROM material_import_batches WHERE id=?").bind(batch.payload.data.id).first()).status, "CANCELLED");
    assert.equal(context.objectStore.keys().length, 0);
  } finally {
    await context.mf.dispose();
  }
});

test("Material import records reconciliation when R2 succeeds and the next D1 completion batch fails", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    let failNextBatch = false;
    const wrappedDatabase = {
      prepare: (query) => context.DB.prepare(query),
      async batch(statements) {
        if (failNextBatch) {
          failNextBatch = false;
          throw new Error("INJECTED_D1_COMPLETION_FAILURE");
        }
        return context.DB.batch(statements);
      },
    };
    const delegate = context.objectStore;
    const store = {
      head: (key) => delegate.head(key),
      open: (key, range) => delegate.open(key, range),
      delete: (key) => delegate.delete(key),
      async putIfAbsent(input) {
        const result = await delegate.putIfAbsent(input);
        failNextBatch = true;
        return result;
      },
    };
    context.dependencies.database = wrappedDatabase;
    context.dependencies.objectStore = store;
    const batch = await createBatch(context, "purchase1", "CSV", "create-d1failure");
    const result = await upload(context, { batchId: batch.payload.data.id, version: 1, user: "purchase1", bytes: new TextEncoder().encode("a,b\n1,2\n"), key: "upload-d1failure" });
    assert.equal(result.response.status, 202, JSON.stringify(result.payload));
    assert.equal(result.payload.data.batch.status, "RECONCILIATION_REQUIRED");
    assert.equal((await context.DB.prepare("SELECT status FROM material_import_batches WHERE id=?").bind(batch.payload.data.id).first()).status, "RECONCILIATION_REQUIRED");
    assert.equal(context.objectStore.keys().length, 1);
  } finally {
    await context.mf.dispose();
  }
});

test("Material import cleanup records deletion failure and resumes on the next manual run", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const batch = await createBatch(context, "purchase1", "CSV", "create-cleanfail1");
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    const uploaded = await upload(context, { batchId: batch.payload.data.id, version: 1, user: "purchase1", bytes, key: "upload-cleanfail1" });
    const terminal = "2026-07-15T08:00:00.000Z";
    await context.DB.prepare(`UPDATE material_import_batches SET status='CANCELLED',cancelled_by='purchase1',cancelled_at=?,terminal_at=?,raw_data_retention_until='2026-07-15T08:00:01.000Z',record_retention_until='2029-07-14T08:00:00.000Z',current_version=current_version+1 WHERE id=?`).bind(terminal, terminal, batch.payload.data.id).run();
    context.objectStore.failNextDelete();
    const first = await cleanupExpiredMaterialImportObjects({ ...context.dependencies, clock: () => new Date("2026-07-16T08:00:00.000Z") });
    assert.deepEqual(first, { examined: 1, deleted: 0, failed: 1 });
    assert.equal((await context.DB.prepare("SELECT storage_status FROM material_import_files WHERE batch_id=?").bind(batch.payload.data.id).first()).storage_status, "DELETE_PENDING");
    const second = await cleanupExpiredMaterialImportObjects({ ...context.dependencies, clock: () => new Date("2026-07-16T08:01:00.000Z") });
    assert.deepEqual(second, { examined: 1, deleted: 1, failed: 0 });
    assert.equal(context.objectStore.keys().length, 0);
    assert.equal(uploaded.payload.data.batch.status, "FILE_READY");
  } finally {
    await context.mf.dispose();
  }
});

test("Material import upload implementation never uses whole-file arrayBuffer buffering", async () => {
  const sources = await Promise.all([
    readFile(join(siteRoot, "app/lib/material-import/multipart.ts"), "utf8"),
    readFile(join(siteRoot, "app/lib/material-import/service.ts"), "utf8"),
    readFile(join(siteRoot, "app/lib/material-import/file-security.ts"), "utf8"),
  ]);
  for (const source of sources) assert.ok(!source.includes(".arrayBuffer("));
});
