import { randomUUID } from "node:crypto";
import { routingDigest } from "../../app/lib/production-routing-selfhost/digest.ts";

export async function ensureReleasedRouting(pool, refs, prefix = "TEST") {
  const existing = await pool.query("select id from production_routing_versions where product_version_id=$1 and status='RELEASED'", [refs.productVersionId]);
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const client = await pool.connect();
  try {
    await client.query("begin"); await client.query("select set_config('cyd.production_routing_service_write','allowed',true)");
    const wc = (await client.query("insert into production_work_centers(work_center_code,name_cn,work_center_type,created_by,updated_by,request_id) values($1,$2,'TEST','admin01','admin01',$3) returning id", [`${prefix}-WC`, `${prefix} 测试工作中心`, randomUUID()])).rows[0];
    const header = (await client.query("insert into production_routing_headers(routing_code,product_id,created_by,updated_by,request_id) values($1,$2,'admin01','admin01',$3) returning id", [`${prefix}-RT`, refs.productId, randomUUID()])).rows[0];
    const version = (await client.query("insert into production_routing_versions(routing_header_id,product_version_id,version_no,version_code,created_by,updated_by,request_id) values($1,$2,1,'V1','admin01','admin01',$3) returning id", [header.id, refs.productVersionId, randomUUID()])).rows[0];
    await client.query("insert into production_routing_operations(routing_version_id,sequence_no,operation_code,operation_name,work_center_id,setup_minutes,run_minutes_per_unit,created_by,request_id) values($1,10,'OP10','测试工序',$2,0,1,'admin01',$3)", [version.id, wc.id, randomUUID()]);
    const canonical = routingDigest({ routing_code: `${prefix}-RT`, product_id: refs.productId, product_version_id: refs.productVersionId, version_no: 1, version_code: "V1", operations: [{ sequence_no: 10, operation_code: "OP10", operation_name: "测试工序", work_center_id: Number(wc.id), work_center_code: `${prefix}-WC`, work_center_name: `${prefix} 测试工作中心`, setup_minutes: "0.000000", run_minutes_per_unit: "1.000000", description: "" }] });
    await client.query("update production_routing_versions set status='SUBMITTED',submitted_by='admin01',submitted_at=now(),version=2 where id=$1", [version.id]);
    await client.query("update production_routing_versions set status='RELEASED',canonical_digest=$2,released_by='manager01',released_at=now(),version=3 where id=$1", [version.id, canonical]);
    await client.query("commit"); return Number(version.id);
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

// Test-only fixture conversion for Phase 4 compatibility suites. Production code and
// migrations never delete immutable routing snapshots; migrated historical work orders
// can legitimately have no snapshot and must retain their legacy report API.
export async function convertReleasedWorkOrderToLegacyFixture(pool, workOrderId) {
  const client=await pool.connect();
  try {
    await client.query("begin");await client.query("set local session_replication_role=replica");
    await client.query("delete from production_operation_wip_projections where operation_projection_id in(select id from production_work_order_operation_projections where work_order_id=$1)",[workOrderId]);
    await client.query("delete from production_work_order_operation_projections where work_order_id=$1",[workOrderId]);
    await client.query("delete from production_work_order_routing_snapshot_operations where snapshot_id in(select id from production_work_order_routing_snapshots where work_order_id=$1)",[workOrderId]);
    await client.query("delete from production_work_order_routing_snapshots where work_order_id=$1",[workOrderId]);
    await client.query("commit");
  } catch(error) { await client.query("rollback").catch(()=>undefined);throw error; } finally { client.release(); }
}
