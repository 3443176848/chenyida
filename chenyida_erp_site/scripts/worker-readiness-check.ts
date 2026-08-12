import { closeDb, getPool } from "../db/index.ts";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
import { resolveRuntimeIdentity, runtimeReadinessErrorCode } from "../app/lib/runtime-readiness/identity.ts";
import { loadRuntimeMigrationManifest } from "../app/lib/runtime-readiness/migration.ts";
import {
  PostgresWorkerRuntimeLease,
  readWorkerInstanceFile,
  workerRuntimeIdentity,
} from "../app/lib/runtime-readiness/worker-lease.ts";

async function main(): Promise<void> {
  const config = runtimeConfig();
  const identity = resolveRuntimeIdentity({ config });
  const migrations = await loadRuntimeMigrationManifest();
  const instanceId = await readWorkerInstanceFile();
  const repository = new PostgresWorkerRuntimeLease(getPool(), config.workerLeaseSeconds);
  await repository.assertExactInstance(instanceId, workerRuntimeIdentity(identity, migrations));
}

main()
  .catch((error) => {
    process.stderr.write(`${runtimeReadinessErrorCode(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => undefined));
