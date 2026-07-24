import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "selfhost-integration-test" });
const clock = { now: () => new Date() }; let sequence = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` };

test.beforeEach(async () => { await pool.query("truncate background_jobs, material_import_job_outbox restart identity cascade"); });
test.after(async () => { await pool.end(); });

async function enqueue(queue, key = "job-key") {
  const client = await pool.connect(); try { await client.query("begin"); const id = await queue.enqueue(client, { type: "material.import.parse", payload: { batch_id: 1 }, idempotencyKey: key, aggregateType: "test", aggregateId: "1" }); await client.query("commit"); return id; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

test("migration creates PostgreSQL baseline tables and constraints", async () => {
  const tables = await pool.query("select count(*)::int count from information_schema.tables where table_schema='public'"); assert.ok(tables.rows[0].count >= 21);
  await assert.rejects(pool.query("insert into background_jobs (id,type,idempotency_key,payload,status) values (gen_random_uuid(),'x','bad', '{}'::jsonb,'INVALID')"), /background_jobs_status_ck/);
});

test("transaction rollback does not leave outbox rows", async () => {
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 30); const client = await pool.connect();
  try { await client.query("begin"); await queue.enqueue(client, { type: "material.import.parse", payload: {}, idempotencyKey: "rollback", aggregateType: "test", aggregateId: "1" }); await client.query("rollback"); } finally { client.release(); }
  assert.equal(Number((await pool.query("select count(*) count from material_import_job_outbox")).rows[0].count), 0);
});

test("idempotent enqueue publishes one job", async () => {
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 30); await enqueue(queue, "same"); await enqueue(queue, "same"); await queue.dispatchOutbox();
  assert.equal(Number((await pool.query("select count(*) count from background_jobs")).rows[0].count), 1);
});

test("concurrent workers claim a job only once and heartbeat uses the lease token", async () => {
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 30); await enqueue(queue); await queue.dispatchOutbox();
  const claims = await Promise.all(["w1", "w2", "w3", "w4"].map((worker) => queue.claim(worker))); const claimed = claims.filter(Boolean); assert.equal(claimed.length, 1);
  assert.equal(await queue.heartbeat(claimed[0], "wrong-worker"), false); assert.equal(await queue.heartbeat(claimed[0], claims.findIndex(Boolean) >= 0 ? `w${claims.findIndex(Boolean) + 1}` : ""), true);
});

test("retry and expired lease recovery preserve CAS state", async () => {
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 1); await enqueue(queue); await queue.dispatchOutbox(); const first = await queue.claim("worker-a"); assert.ok(first);
  assert.equal(await queue.fail(first, "worker-a", "TEST_RETRY", "retry"), true); const retry = await pool.query("select status,attempt_count,last_error_code from background_jobs"); assert.equal(retry.rows[0].status, "QUEUED"); assert.equal(retry.rows[0].attempt_count, 1);
  await pool.query("update background_jobs set available_at=now()-interval '1 second'"); const second = await queue.claim("worker-b"); assert.ok(second); await pool.query("update background_jobs set lease_expires_at=now()-interval '1 second'"); assert.equal(await queue.recoverExpired(), 1); const recovered = await pool.query("select status,lease_token from background_jobs"); assert.equal(recovered.rows[0].status, "QUEUED"); assert.equal(recovered.rows[0].lease_token, null);
});
