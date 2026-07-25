import { createHash, randomBytes } from "node:crypto";
import { initializeAdmin } from "../../../app/lib/identity-selfhost/service.ts";
import { LocalFileStorage } from "../../../app/lib/infrastructure/file-storage.ts";
import { sha256, stableUuid } from "../digest.mjs";
import { fail } from "./errors.mjs";
import { recordArchiveOnly } from "./provenance.mjs";
import { ensureMaterializationTables, mappedTarget, recordTarget, requireMappedTarget } from "./target-id-map.mjs";
import { inTransaction } from "./transaction.mjs";

const FIXED_ROLES = new Set(["admin", "manager", "purchase", "engineering", "production", "warehouse", "quality", "sales", "finance", "operations"]);
const code = (value, field, maximum = 100) => {
  const result = String(value || "").normalize("NFKC").trim().toUpperCase();
  if (!result || result.length > maximum || !/^[A-Z0-9][A-Z0-9._\/-]*$/.test(result)) fail("MATERIALIZATION_CODE_INVALID", `${field} 编码无效`);
  return result;
};
const text = (value, field, maximum = 200) => {
  const result = String(value || "").normalize("NFKC").trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) fail("MATERIALIZATION_TEXT_INVALID", `${field} 无效`);
  return result;
};
const relation = (row, kind, name) => row.relations.find((item) => item.kind === kind && (!name || item.name === name))?.key;
const requestId = (context, value) => stableUuid("cyd-public-materialization-request", `${context.runId}:${value}`);

async function replayOrNull(client, context, row) {
  const existing = await mappedTarget(client, context, row);
  return existing ? { ...existing, replayed: true } : null;
}

async function fault(context, stage, row) {
  if (context.fault) await context.fault(stage, row);
}

export async function initializeIdentity(context, rows) {
  return inTransaction(context.pool, async (client) => {
    await ensureMaterializationTables(client);
    const count = Number((await client.query("select count(*)::int count from app_users")).rows[0].count);
    if (count === 0) {
      const username = context.setupAdmin?.username || "synthetic_setup_admin";
      const password = context.setupAdmin?.password || `Aa1!${randomBytes(18).toString("base64url")}`;
      await initializeAdmin(client, { username, displayName: "Synthetic controlled setup administrator", password, requestId: requestId(context, "controlled-setup-admin") });
    }
    const admin = await client.query("select username from app_users where role='admin' and is_active=true order by username limit 1");
    if (!admin.rows[0]) fail("MATERIALIZATION_SETUP_ADMIN_REQUIRED", "必须先通过受控 setup 建立测试管理员");
    await client.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,'Synthetic migration materializer','operations','!MIGRATION_DISABLED_NO_PASSWORD!',false,true,1) on conflict(username) do nothing", [context.actor]);
    const results = [];
    for (const row of rows) {
      const replay = await replayOrNull(client, context, row); if (replay) { results.push(replay); continue; }
      const username = String(row.data.username || row.stable_key).normalize("NFKC").trim().toLowerCase();
      const role = String(row.data.role || "");
      if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) || !FIXED_ROLES.has(role)) fail("MATERIALIZATION_IDENTITY_INVALID", "迁移身份 username 或 role 无效");
      const conflict = await client.query("select 1 from app_users where username=$1", [username]);
      if (conflict.rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", "迁移 username 与已有账号冲突");
      await client.query("insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values($1,$2,$3,'!MIGRATED_DISABLED_NO_PASSWORD!',false,true,1)", [username, `Migrated synthetic ${role}`, role]);
      await fault(context, "identity:after_business", row);
      results.push(await recordTarget(client, context, row, "app_users", username, { username, role, is_active: false, must_change_password: true }));
    }
    return results;
  });
}

export async function materializeReferences(context, rows) {
  const results = [];
  for (const row of rows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    if (row.kind === "unit") {
      const unitCode = code(row.data.code || row.stable_key, "Unit", 40);
      if ((await client.query("select 1 from units where code=$1", [unitCode])).rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", "Unit code 已存在但不属于当前 run");
      const inserted = await client.query("insert into units(code,name,symbol,unit_type,enabled) values($1,$1,$1,'COUNT',true) returning id,code,enabled", [unitCode]);
      await fault(context, "reference:after_business", row);
      return recordTarget(client, context, row, "units", inserted.rows[0].id, inserted.rows[0]);
    }
    const categoryCode = code(row.data.code || row.stable_key, "Category", 80);
    if (Number(row.data.level) !== 4) fail("MATERIALIZATION_CATEGORY_NOT_LEAF", "Material Category 必须为四级叶子");
    if ((await client.query("select 1 from material_categories where category_code=$1", [categoryCode])).rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", "Category code 已存在但不属于当前 run");
    const inserted = await client.query("insert into material_categories(category_code,category_name_cn,category_level,status,created_by,updated_by,request_id) values($1,$2,4,'ACTIVE',$3,$3,$4) returning id,category_code,category_level,status", [categoryCode, `Synthetic ${categoryCode}`, context.actor, requestId(context, row.source_ref)]);
    await fault(context, "reference:after_business", row);
    return recordTarget(client, context, row, "material_categories", inserted.rows[0].id, inserted.rows[0]);
  }));
  return results;
}

export async function materializeMaterials(context, rows) {
  const results = [];
  for (const row of rows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    const unit = await requireMappedTarget(client, context, "unit", relation(row, "unit"));
    const category = await requireMappedTarget(client, context, "category", relation(row, "category"));
    const materialCode = code(row.data.code || row.stable_key, "Material", 100);
    if ((await client.query("select 1 from material_master where internal_material_code=$1", [materialCode])).rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", "Material code 已存在但不属于当前 run");
    const unitRow = await client.query("select id,code,enabled from units where id=$1", [unit.actual_target_id]);
    const categoryRow = await client.query("select id,category_level,status from material_categories where id=$1", [category.actual_target_id]);
    if (!unitRow.rows[0]?.enabled || Number(categoryRow.rows[0]?.category_level) !== 4 || categoryRow.rows[0]?.status !== "ACTIVE") fail("MATERIALIZATION_REFERENCE_INACTIVE", "Material 的 Unit/Category 不可用");
    const inserted = await client.query(`insert into material_master(internal_material_code,standard_name,category_id,base_uom,base_unit_id,material_status,procurement_type,inventory_type,inspection_type,environmental_requirement,source_type,source_ref,last_modified_by,approved_by,approved_at,created_by,updated_by,request_id)
      values($1,$2,$3,$4,$5,'ACTIVE','PURCHASE','STOCKED','IQC','ROHS','MIGRATION',$6,$7,$7,now(),$7,$7,$8) returning id,internal_material_code,standard_name,category_id,base_unit_id,material_status,inventory_type`, [materialCode, text(row.data.name, "Material name"), categoryRow.rows[0].id, unitRow.rows[0].code, unitRow.rows[0].id, row.source_ref, context.actor, requestId(context, row.source_ref)]);
    await fault(context, "material:after_business", row);
    return recordTarget(client, context, row, "material_master", inserted.rows[0].id, inserted.rows[0]);
  }));
  return results;
}

export async function materializeParties(context, rows) {
  const results = [];
  for (const row of rows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    const isCustomer = row.kind === "customer";
    const table = isCustomer ? "customers" : "suppliers";
    const businessCode = code(row.data.code || row.stable_key, row.kind, 40);
    const name = text(row.data.name, row.kind);
    const codeColumn = isCustomer ? "customer_code" : "supplier_code";
    if ((await client.query(`select 1 from ${table} where ${codeColumn}=$1`, [businessCode])).rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", `${row.kind} code 已存在但不属于当前 run`);
    const inserted = await client.query(`insert into ${table}(${codeColumn},${isCustomer ? "customer_name" : "supplier_name"},normalized_name,status,created_by,updated_by,request_id) values($1,$2,$3,'ACTIVE',$4,$4,$5) returning id,${codeColumn},status`, [businessCode, name, name.normalize("NFKC").toUpperCase(), context.actor, requestId(context, row.source_ref)]);
    await fault(context, "master_data:after_business", row);
    return recordTarget(client, context, row, table, inserted.rows[0].id, inserted.rows[0]);
  }));
  return results;
}

export async function materializeProducts(context, productRows, versionRows) {
  const results = [];
  for (const row of productRows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    const versionRow = versionRows.find((item) => relation(item, "product") === row.stable_key);
    if (!versionRow) fail("MATERIALIZATION_UPSTREAM_BLOCKED", "Product 缺少显式 Product Version");
    const customerKey = relation(row, "customer");
    const customer = customerKey ? await requireMappedTarget(client, context, "customer", customerKey) : null;
    const productCode = code(row.data.code || row.stable_key, "Product", 40);
    if ((await client.query("select 1 from products where product_code=$1", [productCode])).rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", "Product code 已存在但不属于当前 run");
    const product = await client.query("insert into products(product_code,product_name,customer_id,status,current_version_no,created_by,updated_by,request_id) values($1,$2,$3,'ACTIVE',1,$4,$4,$5) returning id,product_code,customer_id,status,current_version_no", [productCode, text(row.data.name, "Product name"), customer?.actual_target_id || null, context.actor, requestId(context, row.source_ref)]);
    const versionCode = `V${Number(versionRow.data.version || 1)}`;
    const version = await client.query(`insert into product_versions(product_id,version_no,version_code,status,product_type,lifecycle_status,released_by,released_at,created_by,updated_by,request_id) values($1,1,$2,'RELEASED','FPC','SAMPLE',$3,now(),$3,$3,$4) returning id,product_id,version_no,version_code,status`, [product.rows[0].id, versionCode, context.actor, requestId(context, versionRow.source_ref)]);
    await fault(context, "product:after_business", row);
    const headerMap = await recordTarget(client, context, row, "products", product.rows[0].id, product.rows[0]);
    await recordTarget(client, context, versionRow, "product_versions", version.rows[0].id, version.rows[0]);
    return headerMap;
  }));
  return results;
}

export async function materializeMappings(context, rows) {
  const results = [];
  for (const row of rows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    const supplier = await requireMappedTarget(client, context, "supplier", relation(row, "supplier"));
    const material = await requireMappedTarget(client, context, "material", relation(row, "material"));
    const unit = await requireMappedTarget(client, context, "unit", relation(row, "unit"));
    const supplierPart = code(row.data.supplier_part_code, "Supplier part", 160);
    const refs = await client.query("select s.supplier_name,s.supplier_code,u.code unit_code from suppliers s cross join units u where s.id=$1 and s.status='ACTIVE' and u.id=$2 and u.enabled=true", [supplier.actual_target_id, unit.actual_target_id]);
    if (!refs.rows[0]) fail("MATERIALIZATION_REFERENCE_INACTIVE", "Supplier Mapping 引用不可用");
    const inserted = await client.query(`insert into supplier_mappings(material_id,supplier_id,supplier_name,supplier_key,supplier_item_code,purchase_uom,purchase_unit_id,conversion_numerator,conversion_denominator,status,valid_from,created_by,updated_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,1,1,'ACTIVE','2026-01-01T00:00:00Z',$8,$8,$9) returning id,material_id,supplier_id,purchase_unit_id,supplier_item_code,status,valid_from`, [material.actual_target_id, supplier.actual_target_id, refs.rows[0].supplier_name, refs.rows[0].supplier_code, supplierPart, refs.rows[0].unit_code, unit.actual_target_id, context.actor, requestId(context, row.source_ref)]);
    await fault(context, "bom_mapping:after_business", row);
    return recordTarget(client, context, row, "supplier_mappings", inserted.rows[0].id, inserted.rows[0]);
  }));
  return results;
}

export async function materializeBoms(context, bomRows, lineRows) {
  const results = [];
  for (const row of bomRows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    const productVersion = await requireMappedTarget(client, context, "product_version", relation(row, "product_version"));
    const pv = await client.query("select id,product_id,status from product_versions where id=$1", [productVersion.actual_target_id]);
    if (pv.rows[0]?.status !== "RELEASED") fail("MATERIALIZATION_REFERENCE_INACTIVE", "BOM Product Version 未发布");
    const bomCode = code(row.data.code, "BOM", 40);
    if ((await client.query("select 1 from bom_headers where bom_code=$1", [bomCode])).rows[0]) fail("MATERIALIZATION_CODE_CONFLICT", "BOM code 已存在但不属于当前 run");
    const lines = lineRows.filter((item) => relation(item, "bom") === row.stable_key);
    if (!lines.length) fail("MATERIALIZATION_BOM_EMPTY", "BOM 必须至少一行");
    const header = await client.query("insert into bom_headers(bom_code,product_id,status,current_version_no,created_by,updated_by,request_id) values($1,$2,'ACTIVE',1,$3,$3,$4) returning id,bom_code,product_id,current_version_no", [bomCode, pv.rows[0].product_id, context.actor, requestId(context, row.source_ref)]);
    const version = await client.query("insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,status,created_by,updated_by,request_id) values($1,$2,1,'V1','DRAFT',$3,$3,$4) returning id", [header.rows[0].id, pv.rows[0].id, context.actor, requestId(context, `${row.source_ref}:version`)]);
    for (const line of lines) {
      const material = await requireMappedTarget(client, context, "material", relation(line, "material"));
      const unit = await requireMappedTarget(client, context, "unit", relation(line, "unit"));
      const inserted = await client.query(`insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,created_by,updated_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$7,$8) returning id,bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate`, [version.rows[0].id, Number(line.data.line_no), material.actual_target_id, String(line.data.quantity), unit.actual_target_id, String(line.data.loss_rate || "0"), context.actor, requestId(context, line.source_ref)]);
      await recordTarget(client, context, line, "bom_lines", inserted.rows[0].id, inserted.rows[0]);
    }
    await client.query("update bom_versions set status='RELEASED',released_by=$2,released_at=now(),updated_by=$2,updated_at=now() where id=$1", [version.rows[0].id, context.actor]);
    await fault(context, "bom_mapping:after_business", row);
    return recordTarget(client, context, row, "bom_headers", header.rows[0].id, { ...header.rows[0], version_id: String(version.rows[0].id), version_status: "RELEASED", line_count: lines.length });
  }));
  return results;
}

export async function materializeFiles(context, rows) {
  const storage = new LocalFileStorage(context.fileTarget);
  const results = [];
  for (const row of rows) {
    const prior = await context.pool.query("select m.*,f.relative_path,f.sha256 file_sha256,f.size_bytes from migration_tool.public_id_map m join migration_tool.synthetic_files f on f.migration_run_id=m.migration_run_id and f.source_stable_reference_digest=m.source_stable_reference_digest where m.migration_run_id=$1 and m.source_kind='file' and m.source_stable_reference_digest=$2", [context.runId, sha256(row.stable_key)]);
    if (prior.rows[0]) {
      const stream = await storage.open(prior.rows[0].relative_path); const digest = createHash("sha256"); let size = 0;
      for await (const chunk of stream) { digest.update(chunk); size += chunk.length; }
      if (digest.digest("hex") !== prior.rows[0].file_sha256 || size !== Number(prior.rows[0].size_bytes)) fail("MATERIALIZATION_FILE_CHECKSUM_MISMATCH", "已物化文件 checksum/size 已变化");
      results.push({ ...prior.rows[0], replayed: true }); continue;
    }
    const body = row.data.content_marker === "SYNTHETIC_FILE_V1" || row.stable_key === "synthetic-upload.bin" ? Buffer.from("synthetic-file-v1") : null;
    if (!body) fail("MATERIALIZATION_FILE_SOURCE_INVALID", "合成文件内容标识无效");
    if (body.length !== Number(row.data.bytes) || sha256(body) !== row.data.sha256 || row.data.checksum_status !== "MATCHED") fail("MATERIALIZATION_FILE_CHECKSUM_MISMATCH", "合成文件 size/SHA 不一致");
    const stored = await storage.write({ body: (async function* () { yield body; })(), originalFilename: row.stable_key, mimeType: row.data.mime_type || "application/octet-stream" });
    try {
      const result = await inTransaction(context.pool, async (client) => {
        await fault(context, "files:after_file_write", row);
        await client.query("insert into migration_tool.synthetic_files(migration_run_id,source_stable_reference_digest,relative_path,sha256,size_bytes,mime_type) values($1,$2,$3,$4,$5,$6)", [context.runId, sha256(row.stable_key), stored.relativePath, stored.sha256, stored.sizeBytes, stored.mimeType]);
        return recordTarget(client, context, row, "synthetic_files", stored.relativePath, { relative_path: stored.relativePath, sha256: stored.sha256, size_bytes: stored.sizeBytes, mime_type: stored.mimeType });
      });
      results.push(result);
    } catch (error) { await storage.delete(stored.relativePath).catch(() => undefined); throw error; }
  }
  return results;
}

export async function materializeAuditEvidence(context, rows) {
  const results = [];
  for (const row of rows) results.push(await inTransaction(context.pool, async (client) => {
    const replay = await replayOrNull(client, context, row); if (replay) return replay;
    const identityKey = relation(row, "identity"); if (identityKey) await requireMappedTarget(client, context, "identity", identityKey);
    const created = await client.query("insert into audit_log(username,action,detail,request_id,result,route_code,retention_until) values($1,'SYNTHETIC_ARCHIVE_EVIDENCE',$2,$3,'success','MIGRATION_MATERIALIZER',now()+interval '2555 days') returning id,action,result,route_code", [context.actor, { source_ref: row.source_ref }, requestId(context, row.source_ref)]);
    return recordTarget(client, context, row, "audit_log", created.rows[0].id, created.rows[0]);
  }));
  return results;
}

export async function classifyArchiveOnly(context, items) {
  return inTransaction(context.pool, async (client) => { for (const item of items) await recordArchiveOnly(client, context, item); return items.length; });
}
