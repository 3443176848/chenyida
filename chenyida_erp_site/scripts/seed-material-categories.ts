import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { MATERIAL_ATTRIBUTES, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_BINDINGS, MATERIAL_CATEGORY_SEED_VERSION, validateMaterialCategorySeed } from "../seeds/material-category-v1.ts";

interface LocalD1Statement { first<T>(): Promise<T | null> }
interface LocalD1Database { prepare(sql: string): LocalD1Statement; batch(statements: readonly LocalD1Statement[]): Promise<unknown> }

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const args = process.argv.slice(2);
const valueOf = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const env = process.env.ERP_ENV;
if (env !== "test" && env !== "local") throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] ERP_ENV must be test or local`);
if (args.includes("--remote") || args.some((arg) => /production|prod/i.test(arg))) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] remote or production D1 is forbidden`);
const config = valueOf("--config"); const persistTo = valueOf("--persist-to");
if (!config || !persistTo) throw new Error(`[${MATERIAL_CATEGORY_SEED_VERSION}] --config and --persist-to are required`);
validateMaterialCategorySeed();

const now = "2026-07-12T00:00:00.000Z"; const actor = `seed:${MATERIAL_CATEGORY_SEED_VERSION}`; const requestId = `seed-${MATERIAL_CATEGORY_SEED_VERSION}`;
const categoryCodes = MATERIAL_CATEGORIES.map((item) => quote(item.code)).join(","); const attributeCodes = MATERIAL_ATTRIBUTES.map((item) => quote(item.code)).join(",");
const sql: string[] = [];
for (let level = 1; level <= 4; level += 1) {
  const values = MATERIAL_CATEGORIES.filter((item) => item.level === level).map((item) => `(${quote(item.code)},${quote(item.name)},${item.parentCode ? `(SELECT id FROM material_categories WHERE category_code=${quote(item.parentCode)})` : "NULL"},${item.level},'ACTIVE',${item.sortOrder},${quote(`Seed ${MATERIAL_CATEGORY_SEED_VERSION}`)},${quote(actor)},${quote(now)},${quote(actor)},${quote(now)},${quote(requestId)})`).join(",");
  sql.push(`INSERT INTO material_categories(category_code,category_name_cn,parent_id,category_level,status,sort_order,description,created_by,created_at,updated_by,updated_at,request_id) VALUES ${values} ON CONFLICT(category_code) DO UPDATE SET category_name_cn=excluded.category_name_cn,parent_id=excluded.parent_id,category_level=excluded.category_level,status=excluded.status,sort_order=excluded.sort_order,description=excluded.description,updated_by=excluded.updated_by,updated_at=excluded.updated_at,request_id=excluded.request_id;`);
}
const attributeValues = MATERIAL_ATTRIBUTES.map((item) => { const normalization = item.type === "DECIMAL" ? "DECIMAL_SCALE" : item.type === "ENUM" ? "ENUM_CODE" : item.type === "TEXT" ? "TRIM_UPPER" : "NONE"; return `(${quote(item.code)},${quote(item.name)},${quote(item.type)},${item.scale ?? 0},${quote(item.unit ?? "")},${quote(JSON.stringify(item.values ?? []))},${quote(normalization)},'ACTIVE',${quote(actor)},${quote(now)},${quote(actor)},${quote(now)},${quote(actor)},${quote(now)},${quote(requestId)})`; }).join(",");
sql.push(`INSERT INTO material_attribute_definitions(attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values_json,normalization_rule,status,created_by,created_at,updated_by,updated_at,approved_by,approved_at,request_id) VALUES ${attributeValues} ON CONFLICT(attribute_code) DO UPDATE SET attribute_name_cn=excluded.attribute_name_cn,data_type=excluded.data_type,decimal_scale=excluded.decimal_scale,canonical_unit=excluded.canonical_unit,allowed_values_json=excluded.allowed_values_json,normalization_rule=excluded.normalization_rule,status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at,approved_by=excluded.approved_by,approved_at=excluded.approved_at,request_id=excluded.request_id;`);
const bindingRows = MATERIAL_CATEGORY_BINDINGS.flatMap((binding) => binding.attributeCodes.map((attributeCode, index) => `((SELECT id FROM material_categories WHERE category_code=${quote(binding.categoryCode)}),(SELECT id FROM material_attribute_definitions WHERE attribute_code=${quote(attributeCode)}),${binding.requiredCodes.includes(attributeCode) ? 1 : 0},0,1,${(index + 1) * 10},'ACTIVE',${quote(actor)},${quote(now)},${quote(actor)},${quote(now)},${quote(requestId)})`));
for (let offset = 0; offset < bindingRows.length; offset += 40) sql.push(`INSERT INTO material_category_attributes(category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,created_at,updated_by,updated_at,request_id) VALUES ${bindingRows.slice(offset, offset + 40).join(",")} ON CONFLICT(category_id,attribute_definition_id) DO UPDATE SET is_required=excluded.is_required,is_unique_key_component=excluded.is_unique_key_component,is_searchable=excluded.is_searchable,sort_order=excluded.sort_order,status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at,request_id=excluded.request_id;`);
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local seed'); } }", compatibilityDate: "2026-05-22", d1Databases: { DB: "local-test-only" }, d1Persist: resolve(persistTo) });
try {
  const { DB } = await mf.getBindings<{ DB: LocalD1Database }>();
  const existingCategories = await DB.prepare(`SELECT count(*) count FROM material_categories WHERE category_code IN (${categoryCodes})`).first<{ count: number }>();
  const existingAttributes = await DB.prepare(`SELECT count(*) count FROM material_attribute_definitions WHERE attribute_code IN (${attributeCodes})`).first<{ count: number }>();
  const existingBindings = await DB.prepare(`SELECT count(*) count FROM material_category_attributes b JOIN material_categories c ON c.id=b.category_id JOIN material_attribute_definitions a ON a.id=b.attribute_definition_id WHERE c.category_code IN (${categoryCodes}) AND a.attribute_code IN (${attributeCodes})`).first<{ count: number }>();
  await DB.batch(sql.map((statement) => DB.prepare(statement)));
  const totalBindings = MATERIAL_CATEGORY_BINDINGS.reduce((sum, item) => sum + item.attributeCodes.length, 0);
  const stats = [
    { kind: "categories", inserted: MATERIAL_CATEGORIES.length - (existingCategories?.count ?? 0), updated: existingCategories?.count ?? 0 },
    { kind: "attributes", inserted: MATERIAL_ATTRIBUTES.length - (existingAttributes?.count ?? 0), updated: existingAttributes?.count ?? 0 },
    { kind: "bindings", inserted: totalBindings - (existingBindings?.count ?? 0), updated: existingBindings?.count ?? 0 },
  ];
  process.stdout.write(JSON.stringify({ version: MATERIAL_CATEGORY_SEED_VERSION, stats }) + "\n");
} finally { await mf.dispose(); }
