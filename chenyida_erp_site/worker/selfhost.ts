import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { getPool, closeDb } from "../db/index.ts";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
import { LocalFileStorage } from "../app/lib/infrastructure/file-storage.ts";
import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";
import { systemClock, uuidGenerator } from "../app/lib/infrastructure/primitives.ts";
import { SelfHostedWorker } from "../app/lib/selfhost-worker.ts";
import { PostgresMaterialImportNormalizationWorker } from "../app/lib/material-import-normalization-selfhost/worker.ts";
import { PostgresMaterialImportReviewWorker } from "../app/lib/material-import-review-selfhost/worker.ts";

const config = runtimeConfig(); const pool = getPool();
const queue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, config.workerLeaseSeconds);
const worker = new SelfHostedWorker(
  queue,
  new LocalFileStorage(config.uploadRoot),
  `${hostname()}:${process.pid}:${randomUUID()}`,
  config.workerPollMs,
  new PostgresMaterialImportNormalizationWorker(pool),
  new PostgresMaterialImportReviewWorker(pool),
  Math.max(1_000, Math.min(20_000, Math.floor(config.workerLeaseSeconds * 1_000 / 3))),
);
let stopping = false;
async function shutdown(signal: string) { if (stopping) return; stopping = true; console.info(JSON.stringify({ level: "info", event: "worker_shutdown", signal })); worker.stop(); setTimeout(() => process.exit(1), 25_000).unref(); }
process.on("SIGTERM", () => void shutdown("SIGTERM")); process.on("SIGINT", () => void shutdown("SIGINT"));
await worker.run(); await closeDb();
