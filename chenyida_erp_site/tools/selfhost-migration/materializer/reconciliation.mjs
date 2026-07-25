import { sha256 } from "../digest.mjs";
import { fail } from "./errors.mjs";

async function targetValue(client, mapping) {
  const id = mapping.actual_target_id;
  switch (mapping.target_table) {
    case "app_users": return (await client.query("select username,role,is_active,must_change_password from app_users where username=$1", [id])).rows[0];
    case "units": return (await client.query("select id,code,enabled from units where id=$1", [id])).rows[0];
    case "material_categories": return (await client.query("select id,category_code,category_level,status from material_categories where id=$1", [id])).rows[0];
    case "material_master": return (await client.query("select id,internal_material_code,standard_name,category_id,base_unit_id,material_status,inventory_type from material_master where id=$1", [id])).rows[0];
    case "customers": return (await client.query("select id,customer_code,status from customers where id=$1", [id])).rows[0];
    case "suppliers": return (await client.query("select id,supplier_code,status from suppliers where id=$1", [id])).rows[0];
    case "products": return (await client.query("select id,product_code,customer_id,status,current_version_no from products where id=$1", [id])).rows[0];
    case "product_versions": return (await client.query("select id,product_id,version_no,version_code,status from product_versions where id=$1", [id])).rows[0];
    case "supplier_mappings": return (await client.query("select id,material_id,supplier_id,purchase_unit_id,supplier_item_code,status,valid_from from supplier_mappings where id=$1", [id])).rows[0];
    case "bom_headers": return (await client.query(`select h.id,h.bom_code,h.product_id,h.current_version_no,v.id::text version_id,v.status version_status,count(l.id)::int line_count from bom_headers h join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no left join bom_lines l on l.bom_version_id=v.id where h.id=$1 group by h.id,v.id,v.status`, [id])).rows[0];
    case "bom_lines": return (await client.query("select id,bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate from bom_lines where id=$1", [id])).rows[0];
    case "inventory_migration_openings": return (await client.query(`select o.id,o.inventory_adjustment_id,l.material_id,l.unit_id,l.on_hand_quantity,l.frozen_quantity from inventory_migration_openings o join inventory_migration_opening_lines l on l.inventory_opening_id=o.id where o.id=$1`, [id])).rows[0];
    case "finance_opening_sources": return (await client.query("select id,finance_document_id,direction,currency_code,opening_outstanding_amount from finance_opening_sources where id=$1", [id])).rows[0];
    case "synthetic_files": {
      const row = (await client.query("select relative_path,sha256,size_bytes,mime_type from migration_tool.synthetic_files where migration_run_id=$1 and relative_path=$2", [mapping.migration_run_id, id])).rows[0];
      return row ? { ...row, size_bytes: Number(row.size_bytes) } : row;
    }
    case "audit_log": return (await client.query("select id,action,result,route_code from audit_log where id=$1", [id])).rows[0];
    default: fail("MATERIALIZATION_TARGET_TABLE_INVALID", "reconcile 目标表不在允许列表");
  }
}

export async function reconcilePublicMaterialization(pool, context, expectedCount) {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const maps = await client.query("select * from migration_tool.public_id_map where migration_run_id=$1 order by source_kind,source_stable_reference_digest", [context.runId]);
    if (maps.rowCount !== expectedCount) fail("MATERIALIZATION_COUNT_MISMATCH", "public target ID map 数量不一致");
    for (const mapping of maps.rows) {
      const value = await targetValue(client, mapping);
      if (!value) fail("MATERIALIZATION_TARGET_MISSING", "actual public target 不存在");
      if (sha256(value) !== mapping.target_digest) fail("MATERIALIZATION_TARGET_DIGEST_CHANGED", `actual public target digest 已变化：${mapping.target_table}/${mapping.source_kind}`);
    }
    const erpRecords = Number((await client.query("select count(*)::int count from erp_records")).rows[0].count);
    if (erpRecords !== context.erpRecordsBaseline) fail("MATERIALIZATION_ERP_RECORDS_WRITE_FORBIDDEN", "物化不得写 erp_records");
    const orphans = Number((await client.query(`select count(*)::int count from migration_tool.public_id_map m left join migration_tool.runs r on r.run_id=m.migration_run_id where m.migration_run_id=$1 and r.run_id is null`, [context.runId])).rows[0].count);
    if (orphans) fail("MATERIALIZATION_PROVENANCE_ORPHAN", "public provenance 存在 orphan");
    await client.query("commit");
    return { grade: "PASS", actual_target_count: maps.rowCount, erp_records_delta: 0, provenance_orphans: 0 };
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}
