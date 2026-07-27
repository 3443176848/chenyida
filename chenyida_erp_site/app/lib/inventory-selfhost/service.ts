import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { InventoryError } from "./errors.ts";
import { formatQuantity, parseDatabaseQuantity, parseOperationInput, parseReversalVersions } from "./rules.ts";
import { PostgresInventoryRepository } from "./repository.ts";
import type { InventoryLineInput, InventoryMutationMeta, InventoryMutationResult, InventoryOperationType } from "./types.ts";

type MaterialRow = { id: string; base_unit_id: string; internal_material_code: string; standard_name: string; unit_code: string };
type BalanceRow = { id: string; material_id: string; unit_id: string; inventory_lot_id: string | null; lot_code: string; on_hand_qty: string; reserved_qty: string; frozen_qty: string; version: number };
type CalculatedLine = {
  input: InventoryLineInput;
  balance: BalanceRow | null;
  beforeOnHand: bigint;
  beforeFrozen: bigint;
  reserved: bigint;
  onHandDelta: bigint;
  frozenDelta: bigint;
  afterOnHand: bigint;
  afterFrozen: bigint;
  versionBefore: number;
  versionAfter: number;
};

function calculate(operationType: InventoryOperationType, input: InventoryLineInput, balance: BalanceRow | null): CalculatedLine {
  const beforeOnHand = parseDatabaseQuantity(balance?.on_hand_qty ?? "0");
  const beforeFrozen = parseDatabaseQuantity(balance?.frozen_qty ?? "0");
  const reserved = parseDatabaseQuantity(balance?.reserved_qty ?? "0");
  const actualVersion = balance ? Number(balance.version) : 0;
  if (actualVersion !== input.expectedBalanceVersion) throw new InventoryError("INVENTORY_VERSION_CONFLICT", "库存余额版本已变化，请刷新后重试", 409);
  let onHandDelta = 0n; let frozenDelta = 0n;
  if (operationType === "RECEIPT") onHandDelta = input.quantityMicros!;
  if (operationType === "ISSUE") onHandDelta = -input.quantityMicros!;
  if (operationType === "ADJUSTMENT") onHandDelta = input.countedMicros! - beforeOnHand;
  if (operationType === "FREEZE") frozenDelta = input.quantityMicros!;
  if (operationType === "UNFREEZE") frozenDelta = -input.quantityMicros!;
  if (onHandDelta === 0n && frozenDelta === 0n) throw new InventoryError("INVENTORY_ZERO_DELTA", "库存操作不能产生零变动", 422);
  const afterOnHand = beforeOnHand + onHandDelta; const afterFrozen = beforeFrozen + frozenDelta;
  if (afterOnHand < 0n || afterFrozen < 0n || afterOnHand < reserved + afterFrozen) throw new InventoryError("INVENTORY_INSUFFICIENT_AVAILABLE", "库存不足或冻结数量超过可用量", 409);
  return { input, balance, beforeOnHand, beforeFrozen, reserved, onHandDelta, frozenDelta, afterOnHand, afterFrozen, versionBefore: actualVersion, versionAfter: actualVersion + 1 };
}

export class InventoryService {
  readonly repository: PostgresInventoryRepository;
  constructor(repository: PostgresInventoryRepository) { this.repository = repository; }

  async listBalances(limit: number, offset: number) {
    return this.repository.pool.query(`
      select m.id material_id,m.internal_material_code,m.standard_name,m.inventory_type,c.category_code item_category,
        u.id unit_id,u.code base_uom,coalesce(sum(b.on_hand_qty),0)::text on_hand_qty,coalesce(sum(b.reserved_qty),0)::text reserved_qty,
        coalesce(sum(b.frozen_qty),0)::text frozen_qty,(coalesce(sum(b.on_hand_qty),0)-coalesce(sum(b.reserved_qty),0)-coalesce(sum(b.frozen_qty),0))::text available_qty,
        coalesce(max(b.version) filter(where b.inventory_lot_id is null),0) balance_version,max(b.updated_at) updated_at,count(b.inventory_lot_id)::int lot_count
      from material_master m join material_categories c on c.id=m.category_id join units u on u.id=m.base_unit_id and u.enabled=true
      left join inventory_stock_balances b on b.material_id=m.id and b.unit_id=u.id and b.location_code='MAIN'
      where m.material_status='ACTIVE' and m.inventory_type='STOCKED'
      group by m.id,c.category_code,u.id,u.code order by m.internal_material_code,m.id limit $1 offset $2
    `, [limit, offset]);
  }

  async listLedger(limit: number, offset: number, materialId?: number) {
    const values: unknown[] = []; const where = materialId ? (values.push(materialId), "where l.material_id=$1") : ""; values.push(limit, offset);
    return this.repository.pool.query(`
      select l.*,m.internal_material_code,m.standard_name,u.code unit_code,a.adjustment_code,a.reason
      from inventory_ledger_entries l join material_master m on m.id=l.material_id join units u on u.id=l.unit_id
      join inventory_adjustments a on a.id=l.adjustment_id ${where}
      order by l.created_at desc,l.id desc limit $${values.length - 1} offset $${values.length}
    `, values);
  }

  async listAdjustments(limit: number, offset: number) {
    return this.repository.pool.query(`
      select a.*,count(l.id)::int line_count,r.adjustment_code reversal_adjustment_code
      from inventory_adjustments a join inventory_adjustment_lines l on l.adjustment_id=a.id
      left join inventory_adjustments r on r.reversal_of_adjustment_id=a.id
      group by a.id,r.adjustment_code order by a.created_at desc,a.id desc limit $1 offset $2
    `, [limit, offset]);
  }

  async getAdjustment(id: number) {
    const header = await this.repository.pool.query("select a.*,r.adjustment_code reversal_adjustment_code from inventory_adjustments a left join inventory_adjustments r on r.reversal_of_adjustment_id=a.id where a.id=$1", [id]);
    if (!header.rows[0]) throw new InventoryError("INVENTORY_ADJUSTMENT_NOT_FOUND", "库存调整不存在", 404);
    const lines = await this.repository.pool.query(`select l.*,m.internal_material_code,m.standard_name,u.code unit_code from inventory_adjustment_lines l join material_master m on m.id=l.material_id join units u on u.id=l.unit_id where l.adjustment_id=$1 order by l.line_no`, [id]);
    return { header: header.rows[0], lines: lines.rows };
  }

  async reconcile() {
    return this.repository.pool.query(`
      select b.id balance_id,b.material_id,m.internal_material_code,b.on_hand_qty::text,b.frozen_qty::text,
        coalesce(sum(l.on_hand_delta),0)::text ledger_on_hand_qty,coalesce(sum(l.frozen_delta),0)::text ledger_frozen_qty,
        (b.on_hand_qty=coalesce(sum(l.on_hand_delta),0) and b.frozen_qty=coalesce(sum(l.frozen_delta),0)) consistent
      from inventory_stock_balances b join material_master m on m.id=b.material_id
      left join inventory_ledger_entries l on l.balance_id=b.id group by b.id,m.internal_material_code order by b.id
    `);
  }

  private async activeMaterials(client: PoolClient, lines: InventoryLineInput[]): Promise<Map<number, MaterialRow>> {
    const result = await client.query<MaterialRow>(`select m.id,m.base_unit_id,m.internal_material_code,m.standard_name,u.code unit_code
      from material_master m join units u on u.id=m.base_unit_id and u.enabled=true
      where m.id=any($1::bigint[]) and m.material_status='ACTIVE' and m.inventory_type='STOCKED'`, [lines.map((line) => line.materialId)]);
    const found = new Map(result.rows.map((row) => [Number(row.id), row]));
    for (const line of lines) {
      const material = found.get(line.materialId);
      if (!material) throw new InventoryError("INVENTORY_MATERIAL_NOT_STOCKABLE", "物料不存在、未启用或不是库存物料", 422);
      if (Number(material.base_unit_id) !== line.unitId) throw new InventoryError("INVENTORY_UNIT_MISMATCH", "库存单位必须等于物料启用的基础单位", 422);
    }
    return found;
  }

  private positionKey(materialId: number, inventoryLotId: number | null) { return `${materialId}:${inventoryLotId ?? 0}`; }

  private async balancesForUpdate(client: PoolClient, lines: InventoryLineInput[]): Promise<Map<string, BalanceRow>> {
    const found = new Map<string, BalanceRow>();
    for (const line of [...lines].sort((a,b)=>this.positionKey(a.materialId,a.inventoryLotId).localeCompare(this.positionKey(b.materialId,b.inventoryLotId)))) {
      const result = await client.query<BalanceRow>("select * from inventory_stock_balances where material_id=$1 and location_code='MAIN' and inventory_lot_id is not distinct from $2::bigint for update", [line.materialId,line.inventoryLotId]);
      if(result.rows[0])found.set(this.positionKey(line.materialId,line.inventoryLotId),result.rows[0]);
    }
    return found;
  }

  async post(meta: InventoryMutationMeta, rawInput: Record<string, unknown>): Promise<InventoryMutationResult> {
    const parsed = parseOperationInput(rawInput);
    return this.repository.execute(meta, (client) => this.postParsedInTransaction(client, meta, parsed));
  }

  async postInTransaction(client: PoolClient, meta: InventoryMutationMeta, rawInput: Record<string, unknown>): Promise<InventoryMutationResult> {
    return this.postParsedInTransaction(client, meta, parseOperationInput(rawInput));
  }

  async postLotInTransaction(client: PoolClient, meta: InventoryMutationMeta, input: { inventoryLotId: number; operationType: "RECEIPT"|"FREEZE"|"UNFREEZE"; quantity: string; expectedBalanceVersion: number; reason: string }): Promise<InventoryMutationResult> {
    const lot = await client.query("select * from inventory_lots where id=$1 for update",[input.inventoryLotId]);
    if(!lot.rows[0])throw new InventoryError("INVENTORY_LOT_NOT_FOUND","成品库存 Lot 不存在",404);
    const parsed = parseOperationInput({operation_type:input.operationType,reason:input.reason,lines:[{material_id:Number(lot.rows[0].material_id),unit_id:Number(lot.rows[0].unit_id),quantity:input.quantity,expected_balance_version:input.expectedBalanceVersion}]});
    const normalized={...parsed,lines:parsed.lines.map((line)=>({...line,inventoryLotId:input.inventoryLotId,lotCode:String(lot.rows[0].lot_code)}))};
    return this.postParsedInTransaction(client,meta,normalized);
  }

  async issuePositionsInTransaction(client: PoolClient, meta: InventoryMutationMeta, input: { reason: string; lines: ReadonlyArray<{ materialId: number; unitId: number; inventoryLotId: number | null; quantity: string; expectedBalanceVersion: number; expectedLotVersion: number | null }> }): Promise<InventoryMutationResult> {
    if (!input.lines.length || input.lines.length > 100) throw new InventoryError("REQUEST_VALIDATION_FAILED", "库存操作必须包含 1 到 100 行");
    const normalizedLines: InventoryLineInput[] = [];
    let reason = "";
    for (const source of [...input.lines].sort((a,b)=>this.positionKey(a.materialId,a.inventoryLotId).localeCompare(this.positionKey(b.materialId,b.inventoryLotId)))) {
      const parsed = parseOperationInput({ operation_type:"ISSUE", reason:input.reason, material_id:source.materialId, unit_id:source.unitId, quantity:source.quantity, expected_balance_version:source.expectedBalanceVersion });
      reason = parsed.reason;
      if (source.inventoryLotId === null) { normalizedLines.push(parsed.lines[0]); continue; }
      const lot = await client.query("select * from inventory_lots where id=$1 for update",[source.inventoryLotId]);
      const row=lot.rows[0];
      if(!row)throw new InventoryError("INVENTORY_LOT_NOT_FOUND","成品库存 Lot 不存在",404);
      if(source.expectedLotVersion===null||Number(row.version)!==source.expectedLotVersion)throw new InventoryError("INVENTORY_LOT_VERSION_CONFLICT","成品库存 Lot 版本已变化，请刷新后重试",409);
      if(row.status!=="AVAILABLE")throw new InventoryError("INVENTORY_LOT_NOT_AVAILABLE","冻结、耗尽或已冲销 Lot 不能发货",409);
      if(Number(row.material_id)!==source.materialId||Number(row.unit_id)!==source.unitId)throw new InventoryError("INVENTORY_LOT_POSITION_MISMATCH","Lot 的物料或单位与发货明细不一致",422);
      normalizedLines.push({...parsed.lines[0],inventoryLotId:source.inventoryLotId,lotCode:String(row.lot_code)});
    }
    return this.postParsedInTransaction(client,meta,{operationType:"ISSUE",reason,lines:normalizedLines});
  }

  private async postParsedInTransaction(client: PoolClient, meta: InventoryMutationMeta, parsed: ReturnType<typeof parseOperationInput>): Promise<InventoryMutationResult> {
      const lines:InventoryLineInput[]=parsed.lines.map((line)=>({ ...line,inventoryLotId:(line as InventoryLineInput).inventoryLotId??null,lotCode:(line as InventoryLineInput).lotCode??"" }));
      await this.repository.lockPositions(client, lines);
      await this.activeMaterials(client, lines);
      const balances = await this.balancesForUpdate(client, lines);
      const calculated = lines.map((line) => calculate(parsed.operationType, line, balances.get(this.positionKey(line.materialId,line.inventoryLotId)) ?? null));
      const code = await this.repository.nextCode(client);
      const header = await client.query(`insert into inventory_adjustments(adjustment_code,operation_type,reason,operation_id,created_by,request_id)
        values($1,$2,$3,$4,$5,$6) returning *`, [code, parsed.operationType, parsed.reason, meta.operationId, meta.actor.username, meta.requestId]);
      const adjustmentId = Number(header.rows[0].id); const outputLines: Record<string, unknown>[] = [];
      for (let index = 0; index < calculated.length; index += 1) outputLines.push(await this.persistLine(client, meta, adjustmentId, index + 1, parsed.operationType, calculated[index]));
      const body = { ok: true, data: { ...header.rows[0], lines: outputLines }, adjustment_id: adjustmentId, adjustment_code: code, request_id: meta.requestId };
      return { status: 201, body, adjustmentId, materialIds: lines.map((line) => line.materialId), inventoryLotIds: lines.flatMap((line)=>line.inventoryLotId==null?[]:[line.inventoryLotId]) };
  }

  private async persistLine(client: PoolClient, meta: InventoryMutationMeta, adjustmentId: number, lineNo: number, entryType: string, line: CalculatedLine, reversalOfLedgerEntryId: number | null = null): Promise<Record<string, unknown>> {
    let balanceId: number;
    if (!line.balance) {
      const inserted = await client.query(`insert into inventory_stock_balances(material_id,unit_id,inventory_lot_id,lot_code,on_hand_qty,reserved_qty,frozen_qty,version)
        values($1,$2,$3,$4,$5,0,$6,1) returning id`, [line.input.materialId, line.input.unitId,line.input.inventoryLotId,line.input.lotCode, formatQuantity(line.afterOnHand), formatQuantity(line.afterFrozen)]);
      balanceId = Number(inserted.rows[0].id);
    } else balanceId = Number(line.balance.id);
    const ledgerOperationId = randomUUID();
    const ledger = await client.query(`insert into inventory_ledger_entries(operation_id,adjustment_id,line_no,balance_id,material_id,unit_id,inventory_lot_id,lot_code,entry_type,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after,reversal_of_ledger_entry_id,source_id,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$2,$19,$20) returning *`, [ledgerOperationId, adjustmentId, lineNo, balanceId, line.input.materialId, line.input.unitId,line.input.inventoryLotId,line.input.lotCode, entryType, formatQuantity(line.onHandDelta), formatQuantity(line.frozenDelta), formatQuantity(line.beforeOnHand), formatQuantity(line.afterOnHand), formatQuantity(line.beforeFrozen), formatQuantity(line.afterFrozen), line.versionBefore, line.versionAfter, reversalOfLedgerEntryId, meta.actor.username, meta.requestId]);
    const ledgerId = Number(ledger.rows[0].id);
    if (line.balance) {
      const updated = await client.query("update inventory_stock_balances set on_hand_qty=$2,frozen_qty=$3,version=$4,last_ledger_entry_id=$5,updated_at=now() where id=$1 and version=$6 returning id", [balanceId, formatQuantity(line.afterOnHand), formatQuantity(line.afterFrozen), line.versionAfter, ledgerId, line.versionBefore]);
      if (!updated.rows[0]) throw new InventoryError("INVENTORY_VERSION_CONFLICT", "库存余额版本已变化，请刷新后重试", 409);
    } else await client.query("update inventory_stock_balances set last_ledger_entry_id=$2,updated_at=now() where id=$1", [balanceId, ledgerId]);
    const requested = line.input.quantityMicros === null ? null : formatQuantity(line.input.quantityMicros);
    const counted = line.input.countedMicros === null ? null : formatQuantity(line.input.countedMicros);
    const saved = await client.query(`insert into inventory_adjustment_lines(adjustment_id,line_no,balance_id,ledger_entry_id,material_id,unit_id,inventory_lot_id,lot_code,requested_qty,counted_qty,on_hand_delta,frozen_delta,before_on_hand_qty,after_on_hand_qty,before_frozen_qty,after_frozen_qty,balance_version_before,balance_version_after)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`, [adjustmentId, lineNo, balanceId, ledgerId, line.input.materialId, line.input.unitId,line.input.inventoryLotId,line.input.lotCode, requested, counted, formatQuantity(line.onHandDelta), formatQuantity(line.frozenDelta), formatQuantity(line.beforeOnHand), formatQuantity(line.afterOnHand), formatQuantity(line.beforeFrozen), formatQuantity(line.afterFrozen), line.versionBefore, line.versionAfter]);
    return { ...saved.rows[0], ledger_entry_id: ledgerId };
  }

  async reverse(adjustmentId: number, meta: InventoryMutationMeta, rawInput: Record<string, unknown>): Promise<InventoryMutationResult> {
    const parsed = parseReversalVersions(rawInput);
    return this.repository.execute(meta, (client) => this.reverseParsedInTransaction(client, adjustmentId, meta, parsed));
  }

  async reverseInTransaction(client: PoolClient, adjustmentId: number, meta: InventoryMutationMeta, rawInput: Record<string, unknown>): Promise<InventoryMutationResult> {
    return this.reverseParsedInTransaction(client, adjustmentId, meta, parseReversalVersions(rawInput));
  }

  private async reverseParsedInTransaction(client: PoolClient, adjustmentId: number, meta: InventoryMutationMeta, parsed: ReturnType<typeof parseReversalVersions>): Promise<InventoryMutationResult> {
      const original = await client.query("select * from inventory_adjustments where id=$1 for update", [adjustmentId]);
      if (!original.rows[0]) throw new InventoryError("INVENTORY_ADJUSTMENT_NOT_FOUND", "库存调整不存在", 404);
      if (original.rows[0].operation_type === "REVERSAL") throw new InventoryError("INVENTORY_REVERSAL_NOT_ALLOWED", "冲销记录不能再次冲销", 409);
      if ((await client.query("select 1 from inventory_adjustments where reversal_of_adjustment_id=$1", [adjustmentId])).rows[0]) throw new InventoryError("INVENTORY_ALREADY_REVERSED", "库存调整已经冲销", 409);
      const source = await client.query(`select l.*,al.unit_id from inventory_ledger_entries l join inventory_adjustment_lines al on al.ledger_entry_id=l.id where l.adjustment_id=$1 order by l.material_id,l.line_no`, [adjustmentId]);
      const materialIds = source.rows.map((row) => Number(row.material_id));
      if (parsed.versions.size !== materialIds.length || materialIds.some((id) => !parsed.versions.has(id))) throw new InventoryError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 必须完整匹配原调整物料");
      const sourceLines:InventoryLineInput[]=source.rows.map((row)=>({materialId:Number(row.material_id),unitId:Number(row.unit_id),inventoryLotId:row.inventory_lot_id==null?null:Number(row.inventory_lot_id),lotCode:String(row.lot_code),expectedBalanceVersion:Number(parsed.versions.get(Number(row.material_id))),quantityMicros:null,countedMicros:null}));
      await this.repository.lockPositions(client, sourceLines);
      const balances = await this.balancesForUpdate(client, sourceLines);
      const calculated = source.rows.map((row) => {
        const materialId = Number(row.material_id),inventoryLotId=row.inventory_lot_id==null?null:Number(row.inventory_lot_id); const balance = balances.get(this.positionKey(materialId,inventoryLotId));
        if (!balance || Number(balance.version) !== parsed.versions.get(materialId)) throw new InventoryError("INVENTORY_VERSION_CONFLICT", "库存余额版本已变化，请刷新后重试", 409);
        const beforeOnHand = parseDatabaseQuantity(balance.on_hand_qty); const beforeFrozen = parseDatabaseQuantity(balance.frozen_qty); const reserved = parseDatabaseQuantity(balance.reserved_qty);
        const onHandDelta = -parseDatabaseQuantity(row.on_hand_delta); const frozenDelta = -parseDatabaseQuantity(row.frozen_delta);
        const afterOnHand = beforeOnHand + onHandDelta; const afterFrozen = beforeFrozen + frozenDelta;
        if (afterOnHand < 0n || afterFrozen < 0n || afterOnHand < reserved + afterFrozen) throw new InventoryError("INVENTORY_REVERSAL_WOULD_VIOLATE_BALANCE", "当前库存状态不允许冲销原调整", 409);
        const quantity = onHandDelta === 0n ? (frozenDelta < 0n ? -frozenDelta : frozenDelta) : (onHandDelta < 0n ? -onHandDelta : onHandDelta);
        const input: InventoryLineInput = { materialId, unitId: Number(row.unit_id),inventoryLotId,lotCode:String(row.lot_code), expectedBalanceVersion: Number(balance.version), quantityMicros: quantity, countedMicros: null };
        return { input, balance, beforeOnHand, beforeFrozen, reserved, onHandDelta, frozenDelta, afterOnHand, afterFrozen, versionBefore: Number(balance.version), versionAfter: Number(balance.version) + 1, sourceLedgerId: Number(row.id) };
      });
      const code = await this.repository.nextCode(client);
      const header = await client.query(`insert into inventory_adjustments(adjustment_code,operation_type,reversal_of_adjustment_id,reason,operation_id,created_by,request_id)
        values($1,'REVERSAL',$2,$3,$4,$5,$6) returning *`, [code, adjustmentId, parsed.reason, meta.operationId, meta.actor.username, meta.requestId]);
      const reversalId = Number(header.rows[0].id); const outputLines: Record<string, unknown>[] = [];
      for (let index = 0; index < calculated.length; index += 1) outputLines.push(await this.persistLine(client, meta, reversalId, index + 1, "REVERSAL", calculated[index], calculated[index].sourceLedgerId));
      const body = { ok: true, data: { ...header.rows[0], lines: outputLines }, adjustment_id: reversalId, adjustment_code: code, reversal_of_adjustment_id: adjustmentId, request_id: meta.requestId };
      return { status: 201, body, adjustmentId: reversalId, materialIds,inventoryLotIds:sourceLines.flatMap((line)=>line.inventoryLotId==null?[]:[line.inventoryLotId]) };
  }
}
