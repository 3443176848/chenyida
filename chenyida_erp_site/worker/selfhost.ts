import { randomUUID } from "node:crypto";
import { getPool, closeDb } from "../db/index.ts";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
import { LocalFileStorage } from "../app/lib/infrastructure/file-storage.ts";
import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";
import { systemClock, uuidGenerator } from "../app/lib/infrastructure/primitives.ts";
import { SelfHostedWorker } from "../app/lib/selfhost-worker.ts";
import { PostgresMaterialImportNormalizationWorker } from "../app/lib/material-import-normalization-selfhost/worker.ts";
import { PostgresMaterialImportReviewWorker } from "../app/lib/material-import-review-selfhost/worker.ts";
import { LocalMaterialImportFileStore } from "../app/lib/material-import-fallback/local-file-store.ts";
import { PostgresMaterialImportFallbackRepository } from "../app/lib/material-import-fallback/repository.ts";
import { MaterialImportFallbackService } from "../app/lib/material-import-fallback/service.ts";
import { runtimeReadinessErrorCode, RuntimeReadinessError } from "../app/lib/runtime-readiness/identity.ts";
import { prepareWorkerRuntime, WorkerRuntimeLeaseSupervisor } from "../app/lib/runtime-readiness/worker-runtime-service.ts";
import {
  removeWorkerInstanceFile,
  writeWorkerInstanceFile,
  type WorkerLeaseState,
} from "../app/lib/runtime-readiness/worker-lease.ts";

let stopping = false;
let worker: SelfHostedWorker | undefined;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ level: "info", event: "worker_shutdown", signal }));
  worker?.stop();
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function main(): Promise<void> {
  const config = runtimeConfig();
  const pool = getPool();
  const instanceId = randomUUID();
  let instanceFileWritten = false;
  let supervisor: WorkerRuntimeLeaseSupervisor | undefined;
  let finalState: WorkerLeaseState | undefined;
  let prepared: Awaited<ReturnType<typeof prepareWorkerRuntime>> | undefined;
  try {
    await writeWorkerInstanceFile(instanceId);
    instanceFileWritten = true;
    prepared = await prepareWorkerRuntime({ database: pool, config, instanceId });
    finalState = prepared.state;
    if (stopping) return;

    const queue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, config.workerLeaseSeconds);
    const importStore = new LocalMaterialImportFileStore(config.uploadRoot);
    const importFallback = new MaterialImportFallbackService(
      new PostgresMaterialImportFallbackRepository(pool),
      importStore,
      queue,
      { maximumBytes: config.maxUploadBytes, leaseSeconds: config.workerLeaseSeconds },
    );
    supervisor = new WorkerRuntimeLeaseSupervisor({
      repository: prepared.repository,
      database: pool,
      identity: prepared.identity,
      migrations: prepared.migrations,
      state: prepared.state,
      uploadRoot: config.uploadRoot,
      attachmentRoot: config.attachmentRoot,
      intervalMs: Math.max(1_000, Math.min(20_000, Math.floor(config.workerLeaseSeconds * 1_000 / 3))),
      onLost: (code) => {
        console.error(JSON.stringify({ level: "error", event: "worker_runtime_lease_lost", code }));
        worker?.stop();
      },
    });
    worker = new SelfHostedWorker(
      queue,
      new LocalFileStorage(config.uploadRoot),
      `runtime:${instanceId}`,
      config.workerPollMs,
      new PostgresMaterialImportNormalizationWorker(pool),
      new PostgresMaterialImportReviewWorker(pool),
      Math.max(1_000, Math.min(20_000, Math.floor(config.workerLeaseSeconds * 1_000 / 3))),
      undefined,
      importStore,
      importFallback,
      supervisor,
    );
    supervisor.start();
    await worker.run();
    if (supervisor.isLost()) throw new RuntimeReadinessError("RUNTIME_LEASE_LOST");
  } finally {
    if (supervisor) finalState = await supervisor.stop();
    if (prepared && finalState) {
      await prepared.repository.stop(finalState).catch((error) => {
        console.error(JSON.stringify({ level: "error", event: "worker_runtime_stop_failed", code: runtimeReadinessErrorCode(error) }));
      });
    }
    if (instanceFileWritten) {
      await removeWorkerInstanceFile(instanceId).catch((error) => {
        console.error(JSON.stringify({ level: "error", event: "worker_instance_cleanup_failed", code: runtimeReadinessErrorCode(error) }));
      });
    }
    await closeDb();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "error", event: "worker_runtime_failed", code: runtimeReadinessErrorCode(error) }));
  process.exitCode = 1;
});
