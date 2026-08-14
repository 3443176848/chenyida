import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import {
  assertIsolatedDatabaseTarget,
  DatabaseRuntimeError,
} from "../db/runtime-connection.ts";
import {
  runMigrationWorkflow,
  safeMigrationErrorCode,
} from "../scripts/migrate-postgres.ts";
import { MigrationGuardError } from "../scripts/release-migration-authorization.ts";

const CONTROLLED_TEST_DATABASE_URL = /^postgresql:\/\/(cyd_release_migrator|postgres)@\/(cyd_[a-z0-9_]+_release_test)\?host=(\/tmp\/cyd-release-migration-postgres\.[A-Za-z0-9]+\/socket)$/;

function reject(code: string): never {
  throw new MigrationGuardError(code);
}

function controlledTestDatabaseUrl(): string {
  if (process.env.ERP_ENV !== "test"
    || process.env.ERP_DEPLOYMENT_CLASS !== "test"
    || process.env.ERP_RELEASE_TEST_MODE !== "YES"
    || process.env.ERP_MIGRATION_TEST_HARNESS !== "CONTROLLED_RELEASE_MIGRATION"
    || process.env.ERP_SERVICE_KIND !== "MIGRATION"
    || typeof process.getuid !== "function"
    || process.getuid() !== 0) {
    reject("MIGRATION_CONTROLLED_TEST_DRIVER_FORBIDDEN");
  }
  const databaseUrl = process.env.TEST_RELEASE_MIGRATION_DATABASE_URL || "";
  const match = databaseUrl.match(CONTROLLED_TEST_DATABASE_URL);
  if (!match || match[2] !== process.env.ERP_MIGRATION_EXPECTED_DATABASE) {
    reject("MIGRATION_CONTROLLED_TEST_TARGET_INVALID");
  }
  try {
    assertIsolatedDatabaseTarget({ environment: "test", deploymentClass: "test" }, databaseUrl);
  } catch (error) {
    if (error instanceof DatabaseRuntimeError) reject("MIGRATION_CONTROLLED_TEST_TARGET_INVALID");
    throw error;
  }
  return databaseUrl;
}

export async function runControlledReleaseMigrationTest(): Promise<void> {
  const connectionString = controlledTestDatabaseUrl();
  let pool: Pool | undefined;
  const close = async (): Promise<void> => {
    const current = pool;
    pool = undefined;
    if (current) await current.end();
  };
  try {
    await runMigrationWorkflow({
      config: { environment: "production", deploymentClass: "uat" },
      isolatedDatabaseUrl: "",
      poolFactory: () => {
        if (pool) reject("MIGRATION_CONTROLLED_TEST_POOL_REUSED");
        pool = new Pool({
          connectionString,
          max: 2,
          idleTimeoutMillis: 10_000,
          connectionTimeoutMillis: 10_000,
          application_name: "chenyida-erp-controlled-release-migration-test",
        });
        return pool;
      },
      close,
    });
  } finally {
    await close().catch(() => undefined);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runControlledReleaseMigrationTest().catch((error) => {
    process.stderr.write(`${safeMigrationErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
