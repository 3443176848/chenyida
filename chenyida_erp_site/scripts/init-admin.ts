import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { getPool, closeDb } from "../db/index.ts";
import { initializeAdmin } from "../app/lib/selfhost-api.ts";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
import {
  isControlledDeployment,
  assertControlledRuntimeServiceKind,
  isolatedEnvironmentSecret,
  readControlledRuntimeSecret,
} from "../app/lib/infrastructure/runtime-secret.ts";
import {
  MATERIAL_ATTRIBUTES,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_BINDINGS,
  MATERIAL_CATEGORY_SEED_VERSION,
  validateMaterialCategorySeed,
} from "../seeds/material-category-v2.ts";

const get = (name: string) => { const value = process.env[name] || ""; if (!value) throw new Error(`${name} is required`); return value; };

export class AdminInitializationError extends Error {
  readonly code = "ADMIN_INITIALIZATION_FAILED";

  constructor() {
    super("ADMIN_INITIALIZATION_FAILED");
    this.name = "AdminInitializationError";
  }
}

type AdminTransactionClient = Pick<PoolClient, "query">;

export async function runAdminInitializationTransaction<T>(
  client: AdminTransactionClient,
  work: (client: AdminTransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new AdminInitializationError();
  }
}

export async function closeAdminRuntime(
  client: Pick<PoolClient, "release"> | undefined,
  close: () => Promise<void> = closeDb,
): Promise<void> {
  try { client?.release(); } catch { /* Do not expose or replace the initialization result with cleanup detail. */ }
  await close().catch(() => undefined);
}

export async function runAdminInitialization(): Promise<void> {
  let client: PoolClient | undefined;
  try {
    validateMaterialCategorySeed();
    const config = runtimeConfig();
    assertControlledRuntimeServiceKind(config.deploymentClass, "ADMIN");
    const username = get("ERP_ADMIN_USERNAME"); const displayName = get("ERP_ADMIN_DISPLAY_NAME");
    const password = isControlledDeployment(config.deploymentClass)
      ? readControlledRuntimeSecret(config.deploymentClass, "ADMIN", "ADMIN_PASSWORD")
      : isolatedEnvironmentSecret(config.deploymentClass, "ERP_ADMIN_PASSWORD");
    const pool = getPool(); client = await pool.connect(); const requestId = randomUUID();
    const summary = await runAdminInitializationTransaction(client, async (transaction) => {
      await initializeAdmin(transaction as PoolClient, { username, displayName, password, requestId });
      const categoryIds = new Map<string, number>();
      for (const item of MATERIAL_CATEGORIES) {
        const parentId = item.parentCode ? categoryIds.get(item.parentCode) : null;
        if (item.parentCode && !parentId) throw new AdminInitializationError();
        const inserted = await transaction.query<{ id: string }>(`insert into material_categories (category_code,category_name_cn,parent_id,category_level,status,sort_order,version,created_by,updated_by,request_id)
          values ($1,$2,$3,$4,'ACTIVE',$5,1,$6,$6,$7) returning id`, [item.code, item.name, parentId, item.level, item.sortOrder, username, requestId]);
        categoryIds.set(item.code, Number(inserted.rows[0].id));
      }
      const attributeIds = new Map<string, number>();
      for (const item of MATERIAL_ATTRIBUTES) {
        const inserted = await transaction.query<{ id: string }>(`insert into material_attribute_definitions (attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,normalization_rule,status,version,created_by,updated_by,request_id)
          values ($1,$2,$3,$4,$5,$6::jsonb,'NONE','ACTIVE',1,$7,$7,$8) returning id`, [item.code, item.name, item.type, item.scale || 0, item.unit || "", JSON.stringify(item.values || []), username, requestId]);
        attributeIds.set(item.code, Number(inserted.rows[0].id));
      }
      for (const binding of MATERIAL_CATEGORY_BINDINGS) for (const [sortOrder, code] of binding.attributeCodes.entries()) {
        await transaction.query(`insert into material_category_attributes (category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,updated_by,request_id)
          values ($1,$2,$3,false,true,$4,'ACTIVE',$5,$5,$6)`, [categoryIds.get(binding.categoryCode), attributeIds.get(code), binding.requiredCodes.includes(code), sortOrder, username, requestId]);
      }
      return { categories: categoryIds.size, attributes: attributeIds.size };
    });
    console.info(JSON.stringify({ ok: true, seed_version: MATERIAL_CATEGORY_SEED_VERSION, ...summary }));
  } catch (error) {
    if (error instanceof AdminInitializationError) throw error;
    throw new AdminInitializationError();
  } finally {
    await closeAdminRuntime(client);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runAdminInitialization().catch(() => {
    process.stderr.write("ADMIN_INITIALIZATION_FAILED\n");
    process.exitCode = 1;
  });
}
