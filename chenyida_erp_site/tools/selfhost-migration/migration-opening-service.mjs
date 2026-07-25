import { sha256, stableUuid } from "./digest.mjs";
import { fail } from "./errors.mjs";
import { MIGRATION_OPENING_ACTOR, validateFinanceOpening, validateInventoryOpening } from "./opening-rules.mjs";

function sameSource(row, command) {
  return ["manifest_sha256", "source_record_digest", "mapping_digest", "target_digest", "migration_run_id", "opening_type"].every((field) => String(row[field]) === String(command[field]));
}

export class MigrationOpeningService {
  constructor(pool, { environment = process.env, fault } = {}) {
    if (String(environment.ERP_ENV || "").toLowerCase() !== "test") fail("MIGRATION_ENVIRONMENT_FORBIDDEN", "期初内部服务只允许 ERP_ENV=test");
    this.pool = pool;
    this.fault = fault;
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const target = await client.query("select current_database() database_name,to_regclass('public.schema_migrations') migration_table,to_regnamespace('migration_tool') migration_schema");
      if (!String(target.rows[0].database_name).includes("_migration_test") || !target.rows[0].migration_table || !target.rows[0].migration_schema) fail("MIGRATION_OPENING_TARGET_UNCONTROLLED", "期初服务拒绝未受控测试目标");
      await client.query("select set_config('cyd.migration_opening_service_write','allowed',true),set_config('cyd.inventory_service_write','allowed',true),set_config('cyd.finance_service_write','allowed',true)");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async lockRun(client, command) {
    if (command.created_by !== MIGRATION_OPENING_ACTOR) fail("MIGRATION_OPENING_ACTOR_INVALID", "期初 actor 必须为受控 migration actor");
    const run = await client.query("select run_id,manifest from migration_tool.runs where run_id=$1 and state in ('COMMITTING','COMMITTED','RECONCILED') for update", [command.migration_run_id]);
    if (!run.rows[0]) fail("MIGRATION_OPENING_RUN_INVALID", "迁移 run 未受控或状态无效");
    const manifest = run.rows[0].manifest;
    if (sha256(manifest) !== command.manifest_sha256 || manifest.source_kind !== command.source_system || manifest.mapping_registry_digest !== command.mapping_digest || sha256(manifest.target_migrations) !== command.target_digest) fail("MIGRATION_OPENING_COMMAND_STALE", "期初 command 与受控迁移 run 摘要不一致");
    const staged = await client.query("select source_digest from migration_tool.synthetic_records where source_system=$1 and source_kind=$2 and source_stable_key_digest=$3", [command.source_system, command.source_entity_kind, command.source_stable_reference_digest]);
    if (!staged.rows[0] || staged.rows[0].source_digest !== command.source_record_digest) fail("MIGRATION_OPENING_COMMAND_STALE", "期初 command 的来源摘要已失效");
    const actor = await client.query("select username from app_users where username=$1 and is_active=false", [MIGRATION_OPENING_ACTOR]);
    if (!actor.rows[0]) fail("MIGRATION_OPENING_ACTOR_INVALID", "受控 migration actor 不存在或未禁用登录");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`MIGRATION_OPENING:${command.source_system}:${command.source_entity_kind}:${command.source_stable_reference_digest}:${command.opening_type}`]);
  }

  async existingSource(client, command) {
    const found = await client.query("select * from migration_opening_sources where source_system=$1 and source_entity_kind=$2 and source_stable_reference_digest=$3 and opening_type=$4 for update", [command.source_system, command.source_entity_kind, command.source_stable_reference_digest, command.opening_type]);
    if (!found.rows[0]) return null;
    if (!sameSource(found.rows[0], command)) fail("MIGRATION_OPENING_SOURCE_CHANGED", "稳定期初来源的摘要已变化");
    return found.rows[0];
  }

  async insertCommonSource(client, command) {
    await client.query(`insert into migration_opening_sources(id,migration_run_id,manifest_sha256,source_system,source_entity_kind,source_stable_reference_digest,source_record_digest,mapping_digest,target_digest,opening_type,cutoff_at,created_by,request_id,operation_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [command.migration_opening_source_id, command.migration_run_id, command.manifest_sha256, command.source_system, command.source_entity_kind, command.source_stable_reference_digest, command.source_record_digest, command.mapping_digest, command.target_digest, command.opening_type, command.cutoff_at, command.created_by, command.request_id, command.operation_id]);
  }

  async finish(client, command, action, objectId, response) {
    const keyDigest = sha256(`${action}:${command.operation_id}`);
    await client.query("insert into audit_log(username,action,detail,request_id,result,route_code,operation_id,idempotency_key_digest,retention_until) values($1,$2,$3,$4,'success','MIGRATION_OPENING',$5,$6,now()+interval '2555 days')", [MIGRATION_OPENING_ACTOR, action, { object_id: objectId, source_ref: command.source_ref }, command.request_id, command.operation_id, keyDigest]);
    await client.query("insert into idempotency_keys(key_digest,username,method,path,request_digest,status_code,response,expires_at) values($1,$2,'CLI',$3,$4,201,$5,now()+interval '24 hours') on conflict(key_digest) do nothing", [keyDigest, MIGRATION_OPENING_ACTOR, `/internal/migration-opening/${action}`, command.source_record_digest || sha256(response), response]);
    return response;
  }

  async postInventory(command) {
    validateInventoryOpening(command);
    return this.transaction(async (client) => {
      await this.lockRun(client, command);
      const existing = await this.existingSource(client, command);
      if (existing) {
        const prior = await client.query("select id,inventory_adjustment_id from inventory_migration_openings where migration_opening_source_id=$1", [existing.id]);
        if (!prior.rows[0]) fail("MIGRATION_OPENING_INCOMPLETE", "期初来源存在但业务事实缺失");
        return { ...prior.rows[0], replayed: true };
      }
      const refs = await client.query(`select m.id material_id,m.base_unit_id,u.id unit_id from material_master m join units u on u.code=$2 where m.internal_material_code=$1 and m.material_status='ACTIVE' and m.inventory_type='STOCKED' and m.base_unit_id=u.id and u.enabled=true`, [command.material_key, command.unit_key]);
      if (!refs.rows[0]) fail("MIGRATION_OPENING_MATERIAL_UNIT_INVALID", "库存期初必须引用 ACTIVE STOCKED Material 的有效基础单位");
      await this.insertCommonSource(client, command);
      const ids = await client.query("select nextval(pg_get_serial_sequence('inventory_adjustments','id')) adjustment_id,nextval(pg_get_serial_sequence('inventory_migration_openings','id')) opening_id,nextval(pg_get_serial_sequence('inventory_ledger_entries','id')) ledger_id");
      const { adjustment_id: adjustmentId, opening_id: openingId, ledger_id: ledgerId } = ids.rows[0];
      const code = `MIG-INV-${command.source_stable_reference_digest.slice(0, 16).toUpperCase()}`;
      await client.query("insert into inventory_migration_openings(id,migration_opening_source_id,opening_code,inventory_adjustment_id,effective_at,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)", [openingId, command.migration_opening_source_id, code, adjustmentId, command.cutoff_at, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      await client.query("insert into inventory_adjustments(id,adjustment_code,operation_type,reason,operation_id,created_by,request_id) values($1,$2,'MIGRATION_OPENING','migration opening balance',$3,$4,$5)", [adjustmentId, code, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      await client.query("insert into inventory_stock_balances(material_id,unit_id,location_code,lot_code,on_hand_qty,reserved_qty,frozen_qty,version) values($1,$2,'MAIN','',0,0,0,1) on conflict(material_id,location_code,lot_code) do nothing", [refs.rows[0].material_id, refs.rows[0].unit_id]);
      const balance = await client.query("select * from inventory_stock_balances where material_id=$1 and location_code='MAIN' and lot_code='' for update", [refs.rows[0].material_id]);
      const before = balance.rows[0];
      if (Number(before.on_hand_qty) !== 0 || Number(before.reserved_qty) !== 0 || Number(before.frozen_qty) !== 0 || Number(before.unit_id) !== Number(refs.rows[0].unit_id)) fail("MIGRATION_OPENING_POSITION_NOT_EMPTY", "库存期初位置不是受控空余额");
      await client.query(`insert into inventory_ledger_entries(id,operation_id,adjustment_id,line_no,balance_id,material_id,unit_id,entry_type,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after,source_type,source_id,created_by,request_id)
        values($1,$2,$3,1,$4,$5,$6,'MIGRATION_OPENING',$7,$8,0,$7,0,$8,$9,$9+1,'MIGRATION_OPENING',$10,$11,$12)`, [ledgerId, command.operation_id, adjustmentId, before.id, refs.rows[0].material_id, refs.rows[0].unit_id, command.on_hand_quantity, command.frozen_quantity, before.version, openingId, MIGRATION_OPENING_ACTOR, command.request_id]);
      await this.fault?.("after_inventory_opening_ledger");
      await client.query("update inventory_stock_balances set on_hand_qty=$2,frozen_qty=$3,version=version+1,last_ledger_entry_id=$4,updated_at=now() where id=$1", [before.id, command.on_hand_quantity, command.frozen_quantity, ledgerId]);
      await client.query(`insert into inventory_adjustment_lines(adjustment_id,line_no,balance_id,ledger_entry_id,material_id,unit_id,requested_qty,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after) values($1,1,$2,$3,$4,$5,$6,$6,$7,0,$6,0,$7,$8,$8+1)`, [adjustmentId, before.id, ledgerId, refs.rows[0].material_id, refs.rows[0].unit_id, command.on_hand_quantity, command.frozen_quantity, before.version]);
      await client.query("insert into inventory_migration_opening_lines(inventory_opening_id,line_no,material_id,unit_id,on_hand_quantity,frozen_quantity,inventory_ledger_entry_id) values($1,1,$2,$3,$4,$5,$6)", [openingId, refs.rows[0].material_id, refs.rows[0].unit_id, command.on_hand_quantity, command.frozen_quantity, ledgerId]);
      return this.finish(client, command, "POST_INVENTORY_OPENING", Number(openingId), { inventory_opening_id: Number(openingId), inventory_adjustment_id: Number(adjustmentId), replayed: false });
    });
  }

  async postFinance(command) {
    validateFinanceOpening(command);
    return this.transaction(async (client) => {
      await this.lockRun(client, command);
      const existing = await this.existingSource(client, command);
      if (existing) {
        const prior = await client.query("select id,finance_document_id from finance_opening_sources where migration_opening_source_id=$1", [existing.id]);
        if (!prior.rows[0]) fail("MIGRATION_OPENING_INCOMPLETE", "期初来源存在但业务事实缺失");
        return { finance_opening_source_id: Number(prior.rows[0].id), finance_document_id: Number(prior.rows[0].finance_document_id), replayed: true };
      }
      const party = command.direction === "AR" ? await client.query("select id from customers where customer_code=$1", [command.customer_key]) : await client.query("select id from suppliers where supplier_code=$1", [command.supplier_key]);
      if (!party.rows[0]) fail("MIGRATION_OPENING_COUNTERPARTY_INVALID", "财务期初内部往来方不存在");
      await this.insertCommonSource(client, command);
      const ids = await client.query("select nextval(pg_get_serial_sequence('finance_opening_sources','id')) opening_id,nextval(pg_get_serial_sequence('finance_documents','id')) document_id");
      const openingId = ids.rows[0].opening_id; const documentId = ids.rows[0].document_id;
      await client.query(`insert into finance_opening_sources(id,migration_opening_source_id,direction,customer_id,supplier_id,currency_code,opening_outstanding_amount,accounting_date,business_reference_digest,finance_document_id,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,'CNY',$6,$7,$8,$9,$10,$11,$12)`, [openingId, command.migration_opening_source_id, command.direction, command.direction === "AR" ? party.rows[0].id : null, command.direction === "AP" ? party.rows[0].id : null, command.opening_outstanding_amount, command.accounting_date, command.business_reference_digest, documentId, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      const code = `MIG-${command.direction}-${command.source_stable_reference_digest.slice(0, 16).toUpperCase()}`;
      await client.query(`insert into finance_documents(id,doc_code,doc_type,finance_opening_source_id,customer_id,supplier_id,currency_code,total_amount,settled_amount,status,accounting_date,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,'CNY',$7,0,'OPEN',$8,$9,$10,$11)`, [documentId, code, `OPENING_${command.direction}`, openingId, command.direction === "AR" ? party.rows[0].id : null, command.direction === "AP" ? party.rows[0].id : null, command.opening_outstanding_amount, command.accounting_date, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      await client.query("insert into finance_document_events(document_id,event_type,to_status,reason,created_by,request_id) values($1,'CREATED','OPEN','migration opening',$2,$3)", [documentId, MIGRATION_OPENING_ACTOR, command.request_id]);
      await this.fault?.("after_finance_opening_document");
      return this.finish(client, command, `POST_OPENING_${command.direction}`, Number(documentId), { finance_opening_source_id: Number(openingId), finance_document_id: Number(documentId), replayed: false });
    });
  }

  async reverseInventory(command) {
    return this.transaction(async (client) => {
      if (command.created_by !== MIGRATION_OPENING_ACTOR) fail("MIGRATION_OPENING_ACTOR_INVALID", "期初 actor 无效");
      const opening = await client.query("select * from inventory_migration_openings where id=$1 for update", [command.inventory_opening_id]);
      if (!opening.rows[0]) fail("MIGRATION_OPENING_NOT_FOUND", "库存期初不存在");
      const prior = await client.query("select id,inventory_adjustment_id from inventory_migration_opening_reversals where inventory_opening_id=$1", [command.inventory_opening_id]);
      if (prior.rows[0]) return { inventory_opening_reversal_id: Number(prior.rows[0].id), inventory_adjustment_id: Number(prior.rows[0].inventory_adjustment_id), replayed: true };
      const lines = await client.query(`select l.*,le.id original_ledger_id,b.id balance_id,b.on_hand_qty,b.reserved_qty,b.frozen_qty,b.version from inventory_migration_opening_lines l join inventory_ledger_entries le on le.id=l.inventory_ledger_entry_id join inventory_stock_balances b on b.material_id=l.material_id and b.location_code=l.location_code and b.lot_code=l.lot_code where l.inventory_opening_id=$1 order by l.material_id,l.id for update of b`, [command.inventory_opening_id]);
      for (const line of lines.rows) if (Number(line.on_hand_qty) - Number(line.on_hand_quantity) < Number(line.reserved_qty) + (Number(line.frozen_qty) - Number(line.frozen_quantity)) || Number(line.frozen_qty) < Number(line.frozen_quantity)) fail("MIGRATION_OPENING_REVERSAL_UNSAFE", "库存已被下游消耗，不能安全冲销期初");
      const ids = await client.query("select nextval(pg_get_serial_sequence('inventory_migration_opening_reversals','id')) reversal_id,nextval(pg_get_serial_sequence('inventory_adjustments','id')) adjustment_id");
      const reversalId = ids.rows[0].reversal_id; const adjustmentId = ids.rows[0].adjustment_id; const code = `REV-MIG-INV-${String(command.inventory_opening_id).padStart(8, "0")}`;
      await client.query("insert into inventory_migration_opening_reversals(id,inventory_opening_id,inventory_adjustment_id,reason,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7)", [reversalId, command.inventory_opening_id, adjustmentId, command.reason, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      await client.query("insert into inventory_adjustments(id,adjustment_code,operation_type,reversal_of_adjustment_id,reason,operation_id,created_by,request_id) values($1,$2,'REVERSAL',$3,$4,$5,$6,$7)", [adjustmentId, code, opening.rows[0].inventory_adjustment_id, command.reason, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      let lineNo = 0;
      for (const line of lines.rows) {
        lineNo += 1; const ledgerId = (await client.query("select nextval(pg_get_serial_sequence('inventory_ledger_entries','id')) id")).rows[0].id; const ledgerOperation = stableUuid("chenyida-migration-opening-reversal-line", `${command.operation_id}:${line.id}`);
        const afterOnHand = Number(line.on_hand_qty) - Number(line.on_hand_quantity); const afterFrozen = Number(line.frozen_qty) - Number(line.frozen_quantity);
        await client.query(`insert into inventory_ledger_entries(id,operation_id,adjustment_id,line_no,balance_id,material_id,unit_id,entry_type,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after,reversal_of_ledger_entry_id,source_type,source_id,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,'REVERSAL',-$8::numeric,-$9::numeric,$10,$11,$12,$13,$14,$14+1,$15,'MIGRATION_OPENING_REVERSAL',$16,$17,$18)`, [ledgerId, ledgerOperation, adjustmentId, lineNo, line.balance_id, line.material_id, line.unit_id, line.on_hand_quantity, line.frozen_quantity, line.on_hand_qty, afterOnHand, line.frozen_qty, afterFrozen, line.version, line.original_ledger_id, reversalId, MIGRATION_OPENING_ACTOR, command.request_id]);
        await client.query("update inventory_stock_balances set on_hand_qty=$2,frozen_qty=$3,version=version+1,last_ledger_entry_id=$4,updated_at=now() where id=$1", [line.balance_id, afterOnHand, afterFrozen, ledgerId]);
        await client.query(`insert into inventory_adjustment_lines(adjustment_id,line_no,balance_id,ledger_entry_id,material_id,unit_id,requested_qty,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after) values($1,$2,$3,$4,$5,$6,$7,-$7::numeric,-$8::numeric,$9,$10,$11,$12,$13,$13+1)`, [adjustmentId, lineNo, line.balance_id, ledgerId, line.material_id, line.unit_id, line.on_hand_quantity, line.frozen_quantity, line.on_hand_qty, afterOnHand, line.frozen_qty, afterFrozen, line.version]);
        await client.query("insert into inventory_migration_opening_reversal_lines(inventory_opening_reversal_id,original_opening_line_id,inventory_ledger_entry_id) values($1,$2,$3)", [reversalId, line.id, ledgerId]);
      }
      return this.finish(client, { ...command, source_ref: `inventory_opening:${command.inventory_opening_id}`, source_record_digest: sha256(command) }, "REVERSE_INVENTORY_OPENING", Number(reversalId), { inventory_opening_reversal_id: Number(reversalId), inventory_adjustment_id: Number(adjustmentId), replayed: false });
    });
  }

  async reverseFinance(command) {
    return this.transaction(async (client) => {
      if (command.created_by !== MIGRATION_OPENING_ACTOR) fail("MIGRATION_OPENING_ACTOR_INVALID", "期初 actor 无效");
      const document = await client.query("select d.*,f.id finance_opening_source_id from finance_documents d join finance_opening_sources f on f.id=d.finance_opening_source_id where d.id=$1 for update of d,f", [command.finance_document_id]);
      if (!document.rows[0]) fail("MIGRATION_OPENING_NOT_FOUND", "财务期初不存在");
      const prior = await client.query("select id from finance_opening_reversals where finance_opening_source_id=$1", [document.rows[0].finance_opening_source_id]);
      if (prior.rows[0]) return { finance_opening_reversal_id: Number(prior.rows[0].id), finance_document_id: Number(command.finance_document_id), replayed: true };
      await client.query("select id from finance_settlements where document_id=$1 order by id for update", [command.finance_document_id]);
      const settlements = await client.query("select coalesce(sum(amount),0)::numeric total from finance_settlements where document_id=$1", [command.finance_document_id]);
      if (Number(settlements.rows[0].total) !== 0 || document.rows[0].status !== "OPEN") fail("MIGRATION_OPENING_SETTLEMENTS_ACTIVE", "财务期初存在有效收付款，必须先冲销收付款");
      const created = await client.query("insert into finance_opening_reversals(finance_opening_source_id,finance_document_id,reason,operation_id,created_by,request_id) values($1,$2,$3,$4,$5,$6) returning id", [document.rows[0].finance_opening_source_id, command.finance_document_id, command.reason, command.operation_id, MIGRATION_OPENING_ACTOR, command.request_id]);
      await client.query("update finance_documents set status='REVERSED',version=version+1,updated_at=now() where id=$1", [command.finance_document_id]);
      await client.query("insert into finance_document_events(document_id,event_type,from_status,to_status,reason,created_by,request_id) values($1,'OPENING_REVERSED','OPEN','REVERSED',$2,$3,$4)", [command.finance_document_id, command.reason, MIGRATION_OPENING_ACTOR, command.request_id]);
      return this.finish(client, { ...command, source_ref: `finance_document:${command.finance_document_id}`, source_record_digest: sha256(command) }, "REVERSE_FINANCE_OPENING", Number(created.rows[0].id), { finance_opening_reversal_id: Number(created.rows[0].id), finance_document_id: Number(command.finance_document_id), replayed: false });
    });
  }
}
