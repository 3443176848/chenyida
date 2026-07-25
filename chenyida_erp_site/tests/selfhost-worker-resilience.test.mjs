import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
  assert.deepEqual(codes, ["57P01"]);
});
