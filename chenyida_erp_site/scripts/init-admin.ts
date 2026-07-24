import { randomUUID } from "node:crypto";
import { getPool, closeDb } from "../db/index.ts";
import { initializeAdmin } from "../app/lib/selfhost-api.ts";
import { MATERIAL_ATTRIBUTES, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_BINDINGS } from "../seeds/material-category-v1.ts";

const get = (name: string) => { const value = process.env[name] || ""; if (!value) throw new Error(`${name} is required`); return value; };
const username = get("ERP_ADMIN_USERNAME"); const displayName = get("ERP_ADMIN_DISPLAY_NAME"); const password = get("ERP_ADMIN_PASSWORD");
const pool = getPool(); const client = await pool.connect(); const requestId = randomUUID();
try {
  await client.query("BEGIN"); await initializeAdmin(client, { username, displayName, password, requestId });
  const categoryIds = new Map<string, number>();
  for (const item of MATERIAL_CATEGORIES) {
    const parentId = item.parentCode ? categoryIds.get(item.parentCode) : null; if (item.parentCode && !parentId) throw new Error(`Missing category parent ${item.parentCode}`);
    const inserted = await client.query<{ id: string }>(`insert into material_categories (category_code,category_name_cn,parent_id,category_level,status,sort_order,version,created_by,updated_by,request_id)
      values ($1,$2,$3,$4,'ACTIVE',$5,1,$6,$6,$7) returning id`, [item.code, item.name, parentId, item.level, item.sortOrder, username, requestId]); categoryIds.set(item.code, Number(inserted.rows[0].id));
  }
  const attributeIds = new Map<string, number>();
  for (const item of MATERIAL_ATTRIBUTES) {
    const inserted = await client.query<{ id: string }>(`insert into material_attribute_definitions (attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,normalization_rule,status,version,created_by,updated_by,request_id)
      values ($1,$2,$3,$4,$5,$6::jsonb,'NONE','ACTIVE',1,$7,$7,$8) returning id`, [item.code, item.name, item.type, item.scale || 0, item.unit || "", JSON.stringify(item.values || []), username, requestId]); attributeIds.set(item.code, Number(inserted.rows[0].id));
  }
  for (const binding of MATERIAL_CATEGORY_BINDINGS) for (const [sortOrder, code] of binding.attributeCodes.entries()) {
    await client.query(`insert into material_category_attributes (category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,updated_by,request_id)
      values ($1,$2,$3,false,true,$4,'ACTIVE',$5,$5,$6)`, [categoryIds.get(binding.categoryCode), attributeIds.get(code), binding.requiredCodes.includes(code), sortOrder, username, requestId]);
  }
  await client.query("COMMIT"); console.info(JSON.stringify({ ok: true, username, categories: categoryIds.size, attributes: attributeIds.size }));
} catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); await closeDb(); }
