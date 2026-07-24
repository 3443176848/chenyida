import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import * as schema from "./schema.ts";

let sharedPool: Pool | undefined;

function connectionConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return {
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: process.env.ERP_PROCESS_NAME || "chenyida-erp-web",
  };
}

export function getPool(): Pool {
  sharedPool ??= new Pool(connectionConfig());
  return sharedPool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  if (pool) await pool.end();
}
