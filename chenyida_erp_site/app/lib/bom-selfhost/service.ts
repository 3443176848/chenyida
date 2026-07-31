import type { PoolClient } from "pg";
import { MasterDataError } from "../master-data-selfhost/errors.ts";
import { PostgresMasterDataRepository } from "../master-data-selfhost/repository.ts";
import type { MutationMeta, MutationResult } from "../master-data-selfhost/types.ts";

const positiveInt = (value: unknown, field: string) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };
const boundedText = (value: unknown, field: string, maximum = 2000, required = false) => { const result = String(value ?? "").normalize("NFKC").trim(); if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; };
const quantity = (value: unknown, field: string) => { const raw = String(value ?? ""); if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 必须是正数且最多六位小数`); return raw; };
const loss = (value: unknown) => { const raw = String(value ?? "0"); if (!/^(0(\.\d{1,8})?)$/.test(raw) || Number(raw) >= 1) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "loss_rate 必须在 0（含）到 1（不含）之间"); return raw; };
const assertOnlyKeys = (input: Record<string, unknown>, allowed: string[]) => { const extra = Object.keys(input).find((key) => !allowed.includes(key)); if (extra) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `请求正文不能指定字段：${extra}`); };

export class BomService {
  readonly repository: PostgresMasterDataRepository;
  constructor(repository: PostgresMasterDataRepository) { this.repository = repository; }

  private async lineValues(client: PoolClient, bomVersionId: number, input: Record<string, unknown>, excludeLineId = 0) {
    const materialId = positiveInt(input.material_id, "material_id"); const unitId = positiveInt(input.unit_id, "unit_id");
    const material = await client.query(`select id,internal_material_code,standard_name,base_unit_id,base_uom,material_status from material_master where id=$1 for share`, [materialId]);
    if (!material.rows[0]) throw new MasterDataError("BOM_MATERIAL_NOT_FOUND", "BOM 行物料不存在", 422);
    if (material.rows[0].material_status !== "ACTIVE" || !String(material.rows[0].internal_material_code || "").trim()) throw new MasterDataError("BOM_MATERIAL_NOT_ACTIVE", "BOM 行物料未启用或尚无正式内部编码", 422);
    const unit = await client.query("select id,code,enabled from units where id=$1 for share", [unitId]);
    if (!unit.rows[0] || unit.rows[0].enabled !== true) throw new MasterDataError("BOM_UNIT_NOT_ACTIVE", "BOM 行单位不存在或未启用", 422);
    const matchesMasterUnit = material.rows[0].base_unit_id !== null
      ? Number(material.rows[0].base_unit_id) === unitId
      : String(material.rows[0].base_uom || "").trim().toUpperCase() === String(unit.rows[0].code || "").trim().toUpperCase();
    if (!matchesMasterUnit) throw new MasterDataError("BOM_UNIT_MISMATCH", "BOM 行单位必须与物料主数据单位一致", 422);
    const duplicate = await client.query("select 1 from bom_lines where bom_version_id=$1 and material_id=$2 and id<>$3 limit 1", [bomVersionId, materialId, excludeLineId]);
    if (duplicate.rows[0]) throw new MasterDataError("BOM_MATERIAL_DUPLICATE", "同一物料不能在同一 BOM 版本中重复添加", 409);
    return { materialId, unitId, lineNo: positiveInt(input.line_no, "line_no"), quantityPer: quantity(input.quantity_per ?? input.qty_per, "quantity_per"), lossRate: loss(input.loss_rate), processStage: boundedText(input.process_stage, "工序", 100), remark: boundedText(input.remark, "备注"), material: material.rows[0], unit: unit.rows[0] };
  }

  private async editableLine(client: PoolClient, lineId: number, input: Record<string, unknown>) {
    const result = await client.query(`select l.*,v.status version_status,v.version_no,h.id bom_id,h.current_version_no from bom_lines l join bom_versions v on v.id=l.bom_version_id join bom_headers h on h.id=v.bom_header_id where l.id=$1 for update of h,v,l`, [lineId]);
    const line = result.rows[0]; if (!line) throw new MasterDataError("BOM_LINE_NOT_FOUND", "BOM 行不存在", 404);
    if (line.version_status !== "DRAFT") throw new MasterDataError("BOM_RELEASED_IMMUTABLE", "已发布 BOM 不可修改，请新建版本", 409);
    if (Number(line.version_no) !== Number(line.current_version_no)) throw new MasterDataError("BOM_VERSION_STATE_CONFLICT", "只有当前 DRAFT BOM Version 可以修改", 409);
    if (positiveInt(input.bom_id, "bom_id") !== Number(line.bom_id)) throw new MasterDataError("BOM_LINE_REFERENCE_INVALID", "BOM 行与 BOM 不匹配", 422);
    return line;
  }

  async create(meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    return this.repository.execute(meta, async (client) => {
      let productId = input.product_id ? positiveInt(input.product_id, "product_id") : 0;
      if (!productId) { const code = boundedText(input.product_code, "产品编码", 40, true).toUpperCase(); const found = await client.query("select id from products where product_code=$1 and status='ACTIVE'", [code]); productId = Number(found.rows[0]?.id || 0); }
      const product = await client.query(`select p.*,pv.id product_version_id,pv.status product_version_status from products p join product_versions pv on pv.product_id=p.id and pv.version_no=p.current_version_no where p.id=$1 and p.status='ACTIVE' for update of p`, [productId]);
      if (!product.rows[0] || product.rows[0].product_version_status !== "RELEASED") throw new MasterDataError("PRODUCT_VERSION_NOT_RELEASED", "产品不存在、未启用或当前产品版本未发布", 422);
      const supplied = boundedText(input.bom_code, "BOM 编码", 40); const bomCode = supplied ? supplied.toUpperCase() : await this.repository.nextCode(client, "BOM", "BOM");
      if (supplied && !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(bomCode)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "BOM 编码格式无效");
      const header = await client.query(`insert into bom_headers(bom_code,product_id,created_by,updated_by,request_id) values($1,$2,$3,$3,$4) returning *`, [bomCode, productId, meta.actor.username, meta.requestId]);
      const versionCode = boundedText(input.version_code ?? input.bom_version ?? "A0", "BOM 版本", 40, true).toUpperCase();
      const version = await client.query(`insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,remark,created_by,updated_by,request_id) values($1,$2,1,$3,$4,$5,$5,$6) returning *`, [header.rows[0].id, product.rows[0].product_version_id, versionCode, boundedText(input.remark, "备注"), meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, bom_id: Number(header.rows[0].id), data: { ...header.rows[0], current_version: version.rows[0] }, request_id: meta.requestId }, targetType: "BOM", targetId: Number(header.rows[0].id), newVersion: 1 };
    });
  }

  async addLine(headerId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    return this.repository.execute(meta, async (client) => {
      const header = await client.query(`select h.*,v.id bom_version_id,v.status version_status from bom_headers h join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no where h.id=$1 for update of h,v`, [headerId]);
      if (!header.rows[0]) throw new MasterDataError("BOM_NOT_FOUND", "BOM 不存在", 404); if (header.rows[0].version_status !== "DRAFT") throw new MasterDataError("BOM_RELEASED_IMMUTABLE", "已发布 BOM 不可修改，请新建版本", 409);
      const values = await this.lineValues(client, Number(header.rows[0].bom_version_id), input); const result = await client.query(`insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,remark,created_by,updated_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) returning *`, [header.rows[0].bom_version_id, values.lineNo, values.materialId, values.quantityPer, values.unitId, values.lossRate, values.processStage, values.remark, meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: { ...result.rows[0], internal_material_code: values.material.internal_material_code, standard_name: values.material.standard_name, unit_code: values.unit.code }, request_id: meta.requestId }, targetType: "BOM_LINE", targetId: Number(result.rows[0].id) };
    });
  }

  async updateLine(lineId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    return this.repository.execute(meta, async (client) => {
      const line = await this.editableLine(client, lineId, input);
      assertOnlyKeys(input, ["bom_id", "line_no", "material_id", "unit_id", "quantity_per", "qty_per", "loss_rate", "process_stage", "remark"]);
      const merged = { line_no: input.line_no ?? line.line_no, material_id: input.material_id ?? line.material_id, unit_id: input.unit_id ?? line.unit_id, quantity_per: input.quantity_per ?? input.qty_per ?? line.quantity_per, loss_rate: input.loss_rate ?? line.loss_rate, process_stage: input.process_stage ?? line.process_stage, remark: input.remark ?? line.remark };
      const values = await this.lineValues(client, Number(line.bom_version_id), merged, lineId);
      const result = await client.query(`update bom_lines set line_no=$2,material_id=$3,quantity_per=$4,unit_id=$5,loss_rate=$6,process_stage=$7,remark=$8,updated_by=$9,updated_at=now(),request_id=$10 where id=$1 returning *`, [lineId, values.lineNo, values.materialId, values.quantityPer, values.unitId, values.lossRate, values.processStage, values.remark, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: { ...result.rows[0], internal_material_code: values.material.internal_material_code, standard_name: values.material.standard_name, unit_code: values.unit.code }, request_id: meta.requestId }, targetType: "BOM_LINE", targetId: lineId };
    });
  }

  async deleteLine(lineId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    return this.repository.execute(meta, async (client) => {
      await this.editableLine(client, lineId, input); assertOnlyKeys(input, ["bom_id"]);
      const result = await client.query("delete from bom_lines where id=$1 returning id", [lineId]);
      return { status: 200, body: { ok: true, deleted: true, line_id: Number(result.rows[0].id), request_id: meta.requestId }, targetType: "BOM_LINE", targetId: lineId };
    });
  }

  async release(headerId: number, versionId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const expected = positiveInt(input.expected_version, "expected_version");
    return this.repository.execute(meta, async (client) => {
      const header = await client.query("select * from bom_headers where id=$1 for update", [headerId]); if (!header.rows[0]) throw new MasterDataError("BOM_NOT_FOUND", "BOM 不存在", 404);
      if (Number(header.rows[0].version) !== expected) throw new MasterDataError("VERSION_CONFLICT", "BOM 版本已变化，请刷新后重试", 409);
      await client.query(`select m.id material_id,u.id unit_id from bom_versions v join bom_lines l on l.bom_version_id=v.id join material_master m on m.id=l.material_id join units u on u.id=l.unit_id where v.id=$1 and v.bom_header_id=$2 for share of m,u`, [versionId, headerId]);
      const validation = await client.query(`select v.status,v.version_no,pv.status product_status,count(l.id)::int line_count,count(*) filter (where l.id is not null and (m.id is null or m.material_status<>'ACTIVE' or nullif(btrim(m.internal_material_code),'') is null or u.id is null or u.enabled=false or not ((m.base_unit_id is not null and l.unit_id=m.base_unit_id) or (m.base_unit_id is null and nullif(btrim(m.base_uom),'') is not null and upper(u.code)=upper(btrim(m.base_uom))))))::int invalid_count from bom_versions v join product_versions pv on pv.id=v.product_version_id left join bom_lines l on l.bom_version_id=v.id left join material_master m on m.id=l.material_id left join units u on u.id=l.unit_id where v.id=$1 and v.bom_header_id=$2 group by v.status,v.version_no,pv.status`, [versionId, headerId]);
      const row = validation.rows[0]; if (!row || row.status !== "DRAFT") throw new MasterDataError("BOM_VERSION_STATE_CONFLICT", "BOM 版本不存在或不能发布", 409);
      if (row.product_status !== "RELEASED") throw new MasterDataError("PRODUCT_VERSION_NOT_RELEASED", "关联产品版本未发布", 422);
      if (Number(row.line_count) < 1 || Number(row.invalid_count) > 0) throw new MasterDataError("BOM_STRUCTURE_INVALID", "BOM 必须至少有一行，且全部物料为 ACTIVE 正式物料并使用主数据单位", 422);
      const version = await client.query(`update bom_versions set status='RELEASED',released_by=$3,released_at=now(),updated_by=$3,updated_at=now(),request_id=$4 where id=$1 and bom_header_id=$2 and status='DRAFT' returning *`, [versionId, headerId, meta.actor.username, meta.requestId]);
      await client.query("update bom_headers set version=version+1,updated_by=$2,updated_at=now(),request_id=$3 where id=$1", [headerId, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: version.rows[0], request_id: meta.requestId }, targetType: "BOM_VERSION", targetId: versionId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  async revise(headerId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const expected = positiveInt(input.expected_version, "expected_version");
    return this.repository.execute(meta, async (client) => {
      const header = await client.query(`select h.*,v.id source_version_id,v.product_version_id,v.status source_status from bom_headers h join bom_versions v on v.bom_header_id=h.id and v.version_no=h.current_version_no where h.id=$1 for update of h`, [headerId]);
      if (!header.rows[0]) throw new MasterDataError("BOM_NOT_FOUND", "BOM 不存在", 404); if (Number(header.rows[0].version) !== expected) throw new MasterDataError("VERSION_CONFLICT", "BOM 版本已变化，请刷新后重试", 409); if (header.rows[0].source_status !== "RELEASED") throw new MasterDataError("BOM_VERSION_STATE_CONFLICT", "只有已发布版本可创建修订", 409);
      const nextNo = Number(header.rows[0].current_version_no) + 1; const versionCode = boundedText(input.version_code, "BOM 版本", 40, true).toUpperCase();
      const productVersionId = input.product_version_id ? positiveInt(input.product_version_id, "product_version_id") : Number(header.rows[0].product_version_id);
      const productVersion = await client.query("select 1 from product_versions where id=$1 and product_id=$2 and status='RELEASED'", [productVersionId, header.rows[0].product_id]);
      if (!productVersion.rows[0]) throw new MasterDataError("PRODUCT_VERSION_NOT_RELEASED", "修订版本必须属于同一产品且已发布", 422);
      const version = await client.query(`insert into bom_versions(bom_header_id,product_version_id,version_no,version_code,remark,created_by,updated_by,request_id) values($1,$2,$3,$4,$5,$6,$6,$7) returning *`, [headerId, productVersionId, nextNo, versionCode, boundedText(input.remark, "备注"), meta.actor.username, meta.requestId]);
      await client.query(`insert into bom_lines(bom_version_id,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,remark,created_by,updated_by,request_id) select $1,line_no,material_id,quantity_per,unit_id,loss_rate,process_stage,remark,$2,$2,$3 from bom_lines where bom_version_id=$4`, [version.rows[0].id, meta.actor.username, meta.requestId, header.rows[0].source_version_id]);
      await client.query("update bom_headers set current_version_no=$2,version=version+1,updated_by=$3,updated_at=now(),request_id=$4 where id=$1", [headerId, nextNo, meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: version.rows[0], request_id: meta.requestId }, targetType: "BOM_VERSION", targetId: Number(version.rows[0].id), oldVersion: expected, newVersion: expected + 1 };
    });
  }
}
