import type { Pool, PoolClient } from "pg";
import { ProcurementSourcingError, mapProcurementSourcingError } from "./errors.ts";
import type { RfqBindingDto, SourcingMutationMeta, SourcingMutationResult, SourcingWork } from "./types.ts";

export class ProcurementSourcingRepository {
  readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async rfqMappingBindings(client: PoolClient, rfqId: number): Promise<RfqBindingDto[]> {
    const result = await client.query<Record<string, unknown>>(`select
        b.id::text binding_id,b.rfq_id,b.rfq_supplier_id,b.rfq_line_id,b.supplier_id,b.material_id,
        b.supplier_mapping_version_id,b.mapping_uid,b.mapping_uid mapping_id,b.mapping_version_no,
        b.mapping_version_no mapping_version,b.mapping_row_version,b.mapping_content_digest,
        b.supplier_part_number,b.purchase_unit_id,b.conversion_numerator::text conversion_numerator,
        b.conversion_denominator::text conversion_denominator,b.binding_source,b.binding_status,b.bound_by,
        b.bound_at,b.request_id binding_request_id,rs.status invitation_status,
        s.supplier_code,s.supplier_name,s.status supplier_status,
        m.internal_material_code,m.standard_name,m.material_status,
        pu.code purchase_unit_code,bu.code base_unit_code,
        sm.status current_status,sm.version current_bound_row_version,
        sm.mapping_version_no current_bound_mapping_version,sm.content_digest current_content_digest,
        latest.status latest_mapping_status,latest.mapping_version_no current_mapping_version,
        latest.version current_mapping_row_version,
        active_match.mapping_count current_active_count,
        active_match.mapping_version_id current_active_mapping_version_id,
        to_char(b.valid_from at time zone 'Asia/Shanghai','YYYY-MM-DD') valid_from,
        case when b.valid_to is null then null else to_char(b.valid_to at time zone 'Asia/Shanghai','YYYY-MM-DD') end valid_to,
        to_char(b.bound_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') bound_at_shanghai,
        (sm.status is distinct from b.binding_status) status_drift,
        (latest.id is distinct from b.supplier_mapping_version_id
          or sm.version is distinct from b.mapping_row_version
          or active_match.mapping_version_id is distinct from b.supplier_mapping_version_id) version_drift,
        (s.status='ACTIVE' and m.material_status='ACTIVE'
          and sm.status='ACTIVE' and sm.version=b.mapping_row_version
          and sm.mapping_version_no=b.mapping_version_no
          and sm.content_digest is not distinct from b.mapping_content_digest
          and active_match.mapping_count=1
          and active_match.mapping_version_id=b.supplier_mapping_version_id
          and latest.id=b.supplier_mapping_version_id
          and b.valid_from<=statement_timestamp()
          and (b.valid_to is null or b.valid_to>statement_timestamp())) scope_intact,
        (rs.status='INVITED' and s.status='ACTIVE' and m.material_status='ACTIVE'
          and sm.status='ACTIVE' and sm.version=b.mapping_row_version
          and sm.mapping_version_no=b.mapping_version_no
          and sm.content_digest is not distinct from b.mapping_content_digest
          and active_match.mapping_count=1
          and active_match.mapping_version_id=b.supplier_mapping_version_id
          and latest.id=b.supplier_mapping_version_id
          and b.valid_from<=statement_timestamp()
          and (b.valid_to is null or b.valid_to>statement_timestamp())) eligible
      from procurement_rfq_supplier_line_mapping_bindings b
      join procurement_rfq_suppliers rs on rs.id=b.rfq_supplier_id and rs.rfq_id=b.rfq_id
      join procurement_rfq_lines rl on rl.id=b.rfq_line_id and rl.rfq_id=b.rfq_id
        and rl.material_id=b.material_id
      join suppliers s on s.id=b.supplier_id
      join material_master m on m.id=b.material_id
      join units pu on pu.id=b.purchase_unit_id
      left join units bu on ((m.base_unit_id is not null and bu.id=m.base_unit_id)
        or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null
          and upper(bu.code)=upper(btrim(m.base_uom))))
      join supplier_mappings sm on sm.id=b.supplier_mapping_version_id
      left join lateral (
        select x.id,x.status,x.mapping_version_no,x.version
        from supplier_mappings x where x.mapping_uid=b.mapping_uid
        order by x.mapping_version_no desc,x.id desc limit 1
      ) latest on true
      left join lateral (
        select count(*)::int mapping_count,
          (array_agg(x.id order by x.mapping_version_no desc,x.id desc))[1] mapping_version_id
        from supplier_mappings x
        where x.supplier_id=b.supplier_id and x.material_id=b.material_id
          and x.purchase_unit_id=b.purchase_unit_id and x.status='ACTIVE'
          and x.conversion_numerator=x.conversion_denominator
          and x.valid_from<=statement_timestamp()
          and (x.valid_to is null or x.valid_to>statement_timestamp())
      ) active_match on true
      where b.rfq_id=$1
      order by s.supplier_code,b.supplier_id,m.internal_material_code,b.material_id,b.id`, [rfqId]);
    return result.rows.map((row) => ({
      ...row,
      binding_id: String(row.binding_id),
      rfq_id: Number(row.rfq_id),
      rfq_supplier_id: Number(row.rfq_supplier_id),
      rfq_line_id: Number(row.rfq_line_id),
      supplier_id: Number(row.supplier_id),
      material_id: Number(row.material_id),
      supplier_mapping_version_id: Number(row.supplier_mapping_version_id),
      mapping_version_no: Number(row.mapping_version_no),
      mapping_version: Number(row.mapping_version),
      mapping_row_version: Number(row.mapping_row_version),
      purchase_unit_id: Number(row.purchase_unit_id),
      current_bound_row_version: row.current_bound_row_version === null ? null : Number(row.current_bound_row_version),
      current_bound_mapping_version: row.current_bound_mapping_version === null ? null : Number(row.current_bound_mapping_version),
      current_mapping_version: row.current_mapping_version === null ? null : Number(row.current_mapping_version),
      current_mapping_row_version: row.current_mapping_row_version === null ? null : Number(row.current_mapping_row_version),
      current_active_count: Number(row.current_active_count || 0),
      current_active_mapping_version_id: row.current_active_mapping_version_id === null ? null : Number(row.current_active_mapping_version_id),
      status_drift: row.status_drift === true,
      version_drift: row.version_drift === true,
      scope_intact: row.scope_intact === true,
      eligible: row.eligible === true,
    } as RfqBindingDto));
  }

  private async consumeWriteRate(actor: string, keyDigest: string) {
    const known = await this.pool.query("select 1 from idempotency_keys where key_digest=$1 and expires_at>now()", [keyDigest]); const client = await this.pool.connect(); let limited = false;
    try { await client.query("begin"); const result = await client.query<{ attempt_count: number; new_key_count: number }>(`insert into identity_write_rate_limit_buckets(username,bucket_start,attempt_count,new_key_count,rejected_count,updated_at) values($1,date_trunc('minute',now()),1,$2,0,now()) on conflict(username,bucket_start) do update set attempt_count=identity_write_rate_limit_buckets.attempt_count+1,new_key_count=identity_write_rate_limit_buckets.new_key_count+excluded.new_key_count,updated_at=now() returning attempt_count,new_key_count`, [actor, known.rows[0] ? 0 : 1]); limited = Number(result.rows[0].attempt_count) > 60 || Number(result.rows[0].new_key_count) > 20; if (limited) await client.query("update identity_write_rate_limit_buckets set rejected_count=rejected_count+1,updated_at=now() where username=$1 and bucket_start=date_trunc('minute',now())", [actor]); await client.query("commit"); }
    catch (error) { await client.query("rollback").catch(() => undefined); throw mapProcurementSourcingError(error); } finally { client.release(); }
    if (limited) throw new ProcurementSourcingError("RATE_LIMITED", "采购询比价写操作过于频繁，请稍后重试", 429);
  }
  async execute(meta: SourcingMutationMeta, work: SourcingWork): Promise<SourcingMutationResult> {
    await this.consumeWriteRate(meta.actor.username, meta.keyDigest); const client = await this.pool.connect();
    try {
      await client.query("begin"); await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [meta.keyDigest]); await client.query("delete from idempotency_keys where key_digest=$1 and expires_at<=now()", [meta.keyDigest]);
      const existing = await client.query("select request_digest,response,status_code from idempotency_keys where key_digest=$1", [meta.keyDigest]);
      if (existing.rows[0]) { if (existing.rows[0].request_digest !== meta.requestDigest) throw new ProcurementSourcingError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同请求", 409); await client.query("commit"); const body = existing.rows[0].response as Record<string, unknown>; return { status: Number(existing.rows[0].status_code), body, objectId: Number(body.rfq_id || body.quote_id || body.comparison_id || body.award_id || 0), replayed: true }; }
      await client.query("select set_config('cyd.procurement_sourcing_service_write','allowed',true)"); const result = await work(client);
      await client.query("insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,old_version,new_version,retention_until) values($1,$2,$3,$4,'success','PROCUREMENT_SOURCING',$5,$6,$7,$8,now()+interval '1095 days')", [meta.actor.username, meta.action, { object_id: result.objectId }, meta.requestId, meta.operationId, meta.keyDigest, result.oldVersion ?? null, result.newVersion ?? null]);
      await client.query("insert into idempotency_keys(key_digest,username,method,path,request_digest,status_code,response,expires_at) values($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')", [meta.keyDigest, meta.actor.username, meta.method, meta.route, meta.requestDigest, result.status, result.body]); await client.query("commit"); return { ...result, replayed: false };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw mapProcurementSourcingError(error); } finally { client.release(); }
  }
  async failureAudit(actor: string, requestId: string, action: string, code: string) { await this.pool.query("insert into audit_log(username,action,detail,request_id,result,route_code,error_code,retention_until) values($1,$2,'{}'::jsonb,$3,'failed','PROCUREMENT_SOURCING',$4,now()+interval '1095 days')", [actor, action, requestId, code]).catch(() => undefined); }
}
