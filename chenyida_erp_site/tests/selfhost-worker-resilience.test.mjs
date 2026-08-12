import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { attachPostgresPoolErrorHandler } from "../db/index.ts";
import { SelfHostedWorker } from "../app/lib/selfhost-worker.ts";

test("idle PostgreSQL client errors are handled and logged without sensitive details", () => {
  const pool = new EventEmitter();
  const lines = [];
  attachPostgresPoolErrorHandler(pool, (line) => lines.push(line));

  assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("secret database detail"), {
    code: "57P01",
    connectionParameters: { password: "must-not-be-logged" },
  })));
  assert.deepEqual(JSON.parse(lines[0]), { level: "error", event: "postgres_idle_client_error", code: "57P01" });
  assert.doesNotMatch(lines[0], /secret|password|must-not-be-logged/i);
});

test("worker retries a transient polling failure instead of exiting", async () => {
  let recoverCalls = 0;
  const codes = [];
  let worker;
  const queue = {
    async recoverExpired() {
      recoverCalls += 1;
      if (recoverCalls === 1) throw Object.assign(new Error("database restart detail"), { code: "57P01" });
      worker.stop();
      return 0;
    },
    async dispatchOutbox() { return 0; },
    async claim() { return null; },
    async enqueue() { throw new Error("not used"); },
    async heartbeat() { return false; },
    async complete() { return false; },
    async fail() { return false; },
  };
  worker = new SelfHostedWorker(queue, {}, "resilience-test", 1, undefined, undefined, 1_000, (code) => codes.push(code));

  await worker.run();

  assert.equal(recoverCalls, 2);
  assert.deepEqual(codes, ["WORKER_INFRASTRUCTURE_ERROR"]);
});

test("worker logs a bounded upload-reconciler failure and still advances the ordinary queue", async () => {
  const codes = []; let dispatches = 0; let claims = 0;
  const queue = {
    async recoverExpired() { return 0; },
    async dispatchOutbox() { dispatches += 1; return 0; },
    async claim() { claims += 1; return null; },
    async enqueue() { throw new Error("not used"); },
    async heartbeat() { return false; },
    async complete() { return false; },
    async fail() { return false; },
  };
  const reconciler = { async reconcileOneUpload() { throw Object.assign(new Error("secret path"), { code: "EACCES" }); } };
  const worker = new SelfHostedWorker(queue, {}, "reconciler-resilience", 1, undefined, undefined, 1_000, (code) => codes.push(code), undefined, reconciler);
  assert.equal(await worker.runOnce(), false);
  assert.deepEqual(codes, ["WORKER_INFRASTRUCTURE_ERROR"]);
  assert.equal(dispatches, 1); assert.equal(claims, 1);
});

test("successful upload reconciliation does not starve ordinary queue polling", async () => {
  let dispatches = 0; let claims = 0;
  const queue = {
    async recoverExpired() { return 0; },
    async dispatchOutbox() { dispatches += 1; return 0; },
    async claim() { claims += 1; return null; },
    async enqueue() { throw new Error("not used"); },
    async heartbeat() { return false; },
    async complete() { return false; },
    async fail() { return false; },
  };
  const reconciler = { async reconcileOneUpload() { return true; } };
  const worker = new SelfHostedWorker(queue, {}, "reconciler-fairness", 1, undefined, undefined, 1_000, () => undefined, undefined, reconciler);
  assert.equal(await worker.runOnce(), true);
  assert.equal(dispatches, 1); assert.equal(claims, 1);
});

test("terminal job failures pass one atomic domain publication callback to the queue", async () => {
  const content = Buffer.from("code,name\nA-1,Resistor\n");
  const job = parseJob(content, { payload: { ...parseJob(content).payload, actual_sha256: "0".repeat(64) }, attemptCount: 3, maxAttempts: 3 });
  let terminalCallbacks = 0;
  const queue = parseQueue(job, {
    async fail(failedJob, _workerId, code, _message, _forceTerminal, publishTerminal) {
      assert.equal(failedJob.id, job.id); assert.equal(code, "IMPORT_FILE_INTEGRITY_MISMATCH");
      assert.equal(typeof publishTerminal, "function"); terminalCallbacks += 1; return true;
    },
  });
  const worker = new SelfHostedWorker(queue, parseStorage(content), "terminal-callback", 1);
  assert.equal(await worker.runOnce(), true); assert.equal(terminalCallbacks, 1);
});

function parseQueue(job, overrides = {}) {
  let claimed = false;
  return {
    async recoverExpired() { return 0; },
    async dispatchOutbox() { return 0; },
    async claim() { if (claimed) return null; claimed = true; return job; },
    async enqueue() { throw new Error("not used"); },
    async heartbeat() { return true; },
    async complete() { return true; },
    async fail() { return true; },
    ...overrides,
  };
}

function parseJob(content, overrides = {}) {
  const storageName = randomUUID();
  return {
    id: randomUUID(),
    type: "material.import.parse",
    payload: {
      batch_id: 1,
      relative_path: `material-import/1/${storageName}.csv`,
      actual_sha256: createHash("sha256").update(content).digest("hex"),
      actual_size_bytes: content.byteLength,
    },
    attemptCount: 1,
    maxAttempts: 3,
    leaseToken: randomUUID(),
    version: 1,
    ...overrides,
  };
}

function parseStorage(content) {
  return {
    async open() { return Readable.from([content]); },
    async write() { throw new Error("not used"); },
    async delete() {},
  };
}

test("worker rehashes an import before parsing and never completes mismatched bytes", async () => {
  const content = Buffer.from("code,name\nA-1,Resistor\n");
  const job = parseJob(content, { payload: { ...parseJob(content).payload, actual_sha256: "0".repeat(64) } });
  let completes = 0;
  const failures = [];
  const queue = parseQueue(job, {
    async complete() { completes += 1; return true; },
    async fail(_job, _workerId, code) { failures.push(code); return true; },
  });
  const worker = new SelfHostedWorker(queue, parseStorage(content), "integrity-test", 1);
  assert.equal(await worker.runOnce(), true);
  assert.equal(completes, 0);
  assert.deepEqual(failures, ["IMPORT_FILE_INTEGRITY_MISMATCH"]);
});

test("worker aborts completion when an explicit lease renewal is lost", async () => {
  const content = Buffer.from("code,name\nA-1,Resistor\n");
  const job = parseJob(content);
  let completes = 0;
  const failures = [];
  const queue = parseQueue(job, {
    async heartbeat() { return false; },
    async complete() { completes += 1; return true; },
    async fail(_job, _workerId, code) { failures.push(code); return true; },
  });
  const worker = new SelfHostedWorker(queue, parseStorage(content), "lease-loss-test", 1);
  assert.equal(await worker.runOnce(), true);
  assert.equal(completes, 0);
  assert.deepEqual(failures, ["JOB_LEASE_LOST"]);
});

test("worker heartbeats are single-flight even when the timer is faster than the database", async () => {
  const content = Buffer.from("code,name\nA-1,Resistor\n");
  const job = parseJob(content);
  let active = 0;
  let maximumActive = 0;
  let heartbeatCalls = 0;
  let completes = 0;
  const queue = parseQueue(job, {
    async heartbeat() {
      heartbeatCalls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    },
    async complete() { completes += 1; return true; },
  });
  const worker = new SelfHostedWorker(queue, parseStorage(content), "single-flight-test", 1, undefined, undefined, 1);
  assert.equal(await worker.runOnce(), true);
  assert.equal(completes, 1);
  assert.ok(heartbeatCalls >= 2);
  assert.equal(maximumActive, 1);
  assert.equal(active, 0);
});

test("runtime lease guard is checked before polling and immediately before atomic publication", async () => {
  const content = Buffer.from("code,name\nA-1,Resistor\n");
  const job = parseJob(content);
  let guards = 0;
  let completes = 0;
  const queue = parseQueue(job, { async complete() { completes += 1; return true; } });
  const guard = { async assertCurrent() { guards += 1; } };
  const worker = new SelfHostedWorker(
    queue, parseStorage(content), "runtime-guard", 1,
    undefined, undefined, 1_000, undefined, undefined, undefined, guard,
  );
  assert.equal(await worker.runOnce(), true);
  assert.equal(guards, 2);
  assert.equal(completes, 1);
});

test("runtime lease loss before publication leaves the job for lease recovery instead of terminalizing it", async () => {
  const content = Buffer.from("code,name\nA-1,Resistor\n");
  const job = parseJob(content);
  let guards = 0;
  let completes = 0;
  let failures = 0;
  const queue = parseQueue(job, {
    async complete() { completes += 1; return true; },
    async fail() { failures += 1; return true; },
  });
  const guard = {
    async assertCurrent() {
      guards += 1;
      if (guards === 2) throw Object.assign(new Error("private database detail"), { code: "RUNTIME_LEASE_LOST" });
    },
  };
  const worker = new SelfHostedWorker(
    queue, parseStorage(content), "runtime-lease-loss", 1,
    undefined, undefined, 1_000, undefined, undefined, undefined, guard,
  );
  await assert.rejects(worker.runOnce(), (error) => error.code === "RUNTIME_LEASE_LOST");
  assert.equal(completes, 0);
  assert.equal(failures, 0);
});
