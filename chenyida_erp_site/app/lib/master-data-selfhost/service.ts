import type { PoolClient } from "pg";
import { MasterDataError } from "./errors.ts";
import { PostgresMasterDataRepository } from "./repository.ts";
import type { MutationMeta, MutationResult } from "./types.ts";

const STATUS = new Set(["ACTIVE", "INACTIVE"]);
const text = (value: unknown, field: string, maximum = 200, required = false) => {
  const result = String(value ?? "").normalize("NFKC").trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 无效`);
  return result;
};
const integer = (value: unknown, field: string, optional = false) => {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result;
};
const decimal = (value: unknown, field: string, optional = false) => {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const raw = String(value); if (!/^(0|[1-9]\d*)(\.\d{1,8})?$/.test(raw) || Number(raw) <= 0) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 必须是正数`); return raw;
};
const nonnegativeDecimal = (value: unknown, field: string, optional = false) => {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const raw = String(value); if (!/^(0|[1-9]\d*)(\.\d{1,8})?$/.test(raw)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 必须是非负数`); return raw;
};
const date = (value: unknown, field: string, fallback?: Date) => {
  const result = value === null || value === undefined || value === "" ? fallback ?? null : new Date(String(value));
  if (!result || Number.isNaN(result.getTime())) throw new MasterDataError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result;
};
const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
const status = (value: unknown) => { const result = String(value || "ACTIVE").toUpperCase(); if (!STATUS.has(result)) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "status 无效"); return result; };

export class MasterDataService {
  readonly repository: PostgresMasterDataRepository;
  constructor(repository: PostgresMasterDataRepository) { this.repository = repository; }

  async createParty(kind: "customer" | "supplier", meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const isCustomer = kind === "customer"; const table = isCustomer ? "customers" : "suppliers"; const nameField = isCustomer ? "customer_name" : "supplier_name";
    const name = text(input[nameField], isCustomer ? "客户名称" : "供应商名称", 200, true); const normalizedName = normalized(name);
    return this.repository.execute(meta, async (client) => {
      const code = await this.repository.nextCode(client, isCustomer ? "CUSTOMER" : "SUPPLIER", isCustomer ? "CUS" : "SUP");
      const values = [code, name, normalizedName, status(input.status ?? input[isCustomer ? "customer_status" : "supplier_status"]), text(input.contact_name, "联系人", 128), text(input.phone, "电话", 64), text(input.email, "邮箱", 254), text(input.address, "地址", 1000), text(input.payment_terms, "付款条件", 200), text(input.owner, "负责人", 128), text(input.remark, "备注", 2000)];
      const extraColumn = isCustomer ? "" : ",supplier_level"; const extraValue = isCustomer ? [] : [text(input.supplier_level, "供应商等级", 64)];
      const businessValues = [...values.slice(0, 9), ...extraValue, ...values.slice(9)];
      const actorParameter = businessValues.length + 1; const requestParameter = businessValues.length + 2;
      const result = await client.query(`insert into ${table}(${isCustomer ? "customer_code,customer_name" : "supplier_code,supplier_name"},normalized_name,status,contact_name,phone,email,address,payment_terms${extraColumn},owner,remark,created_by,updated_by,request_id) values(${businessValues.map((_, index) => `$${index + 1}`).join(",")},$${actorParameter},$${actorParameter},$${requestParameter}) returning *`, [...businessValues, meta.actor.username, meta.requestId]);
      const row = result.rows[0]; const body = { ok: true, data: row, [isCustomer ? "customer_code" : "supplier_code"]: code, request_id: meta.requestId };
      return { status: 201, body, targetType: kind.toUpperCase(), targetId: Number(row.id), newVersion: 1 };
    });
  }

  async setPartyStatus(kind: "customer" | "supplier", id: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const table = kind === "customer" ? "customers" : "suppliers"; const next = status(input.status); const expected = integer(input.expected_version, "expected_version")!;
    return this.repository.execute(meta, async (client) => {
      const result = await client.query(`update ${table} set status=$3,version=version+1,updated_by=$4,updated_at=now(),request_id=$5 where id=$1 and version=$2 returning *`, [id, expected, next, meta.actor.username, meta.requestId]);
      if (!result.rows[0]) throw new MasterDataError("VERSION_CONFLICT", "主数据版本已变化，请刷新后重试", 409);
      return { status: 200, body: { ok: true, data: result.rows[0], request_id: meta.requestId }, targetType: kind.toUpperCase(), targetId: id, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  async createProduct(meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const name = text(input.product_name, "产品名称", 200, true); const customerId = input.customer_id ? integer(input.customer_id, "customer_id") : null;
    const versionCode = text(input.version_code ?? input.product_version ?? "A0", "产品版本", 40, true).toUpperCase();
    return this.repository.execute(meta, async (client) => {
      if (customerId) { const customer = await client.query("select 1 from customers where id=$1 and status='ACTIVE'", [customerId]); if (!customer.rows[0]) throw new MasterDataError("CUSTOMER_NOT_ACTIVE", "客户不存在或未启用", 422); }
      const supplied = text(input.product_code, "产品编码", 40); const productCode = supplied || await this.repository.nextCode(client, "PRODUCT", "PRD");
      if (supplied && !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(supplied.toUpperCase())) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "产品编码格式无效");
      const product = await client.query(`insert into products(product_code,product_name,customer_id,created_by,updated_by,request_id) values($1,$2,$3,$4,$4,$5) returning *`, [productCode.toUpperCase(), name, customerId, meta.actor.username, meta.requestId]);
      const version = await this.insertProductVersion(client, Number(product.rows[0].id), 1, versionCode, meta, input);
      return { status: 201, body: { ok: true, data: { ...product.rows[0], current_version: version }, request_id: meta.requestId }, targetType: "PRODUCT", targetId: Number(product.rows[0].id), newVersion: 1 };
    });
  }

  async setProductStatus(productId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const next = status(input.status); const expected = integer(input.expected_version, "expected_version")!;
    return this.repository.execute(meta, async (client) => {
      const result = await client.query("update products set status=$3,version=version+1,updated_by=$4,updated_at=now(),request_id=$5 where id=$1 and version=$2 returning *", [productId, expected, next, meta.actor.username, meta.requestId]);
      if (!result.rows[0]) throw new MasterDataError("VERSION_CONFLICT", "产品版本已变化，请刷新后重试", 409);
      return { status: 200, body: { ok: true, data: result.rows[0], request_id: meta.requestId }, targetType: "PRODUCT", targetId: productId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  private async insertProductVersion(client: PoolClient, productId: number, versionNo: number, versionCode: string, meta: MutationMeta, input: Record<string, unknown>) {
    const result = await client.query(`insert into product_versions(product_id,version_no,version_code,product_type,lifecycle_status,layer_count,board_thickness,min_line_width,min_hole,surface_finish,smt_required,engineering_owner,remark,created_by,updated_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15) returning *`, [productId, versionNo, versionCode, text(input.product_type ?? "FPC", "产品类型", 40, true), text(input.lifecycle_status ?? "SAMPLE", "生命周期", 40, true), integer(input.layer_count, "层数", true), decimal(input.board_thickness, "板厚", true), decimal(input.min_line_width, "最小线宽", true), decimal(input.min_hole, "最小孔径", true), text(input.surface_finish, "表面处理", 100), input.smt_required === true || String(input.smt_required).toUpperCase() === "Y", text(input.engineering_owner, "工程负责人", 128), text(input.remark, "备注", 2000), meta.actor.username, meta.requestId]);
    return result.rows[0];
  }

  async createProductVersion(productId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    return this.repository.execute(meta, async (client) => {
      const product = await client.query("select * from products where id=$1 for update", [productId]); if (!product.rows[0]) throw new MasterDataError("PRODUCT_NOT_FOUND", "产品不存在", 404);
      const expected = integer(input.expected_version, "expected_version"); if (Number(product.rows[0].version) !== expected) throw new MasterDataError("VERSION_CONFLICT", "产品版本已变化，请刷新后重试", 409);
      const nextNo = Number(product.rows[0].current_version_no) + 1; const versionCode = text(input.version_code, "产品版本", 40, true).toUpperCase();
      const version = await this.insertProductVersion(client, productId, nextNo, versionCode, meta, input);
      await client.query("update products set current_version_no=$2,version=version+1,updated_by=$3,updated_at=now(),request_id=$4 where id=$1", [productId, nextNo, meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: version, request_id: meta.requestId }, targetType: "PRODUCT", targetId: productId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  async releaseProductVersion(productId: number, versionId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const expected = integer(input.expected_version, "expected_version")!;
    return this.repository.execute(meta, async (client) => {
      const product = await client.query("select * from products where id=$1 for update", [productId]);
      if (!product.rows[0]) throw new MasterDataError("PRODUCT_NOT_FOUND", "产品不存在", 404);
      if (Number(product.rows[0].version) !== expected) throw new MasterDataError("VERSION_CONFLICT", "产品版本已变化，请刷新后重试", 409);
      const result = await client.query(`update product_versions set status='RELEASED',released_by=$3,released_at=now(),updated_by=$3,updated_at=now(),request_id=$4 where id=$2 and product_id=$1 and version_no=$5 and status='DRAFT' returning *`, [productId, versionId, meta.actor.username, meta.requestId, product.rows[0].current_version_no]);
      if (!result.rows[0]) throw new MasterDataError("PRODUCT_VERSION_STATE_CONFLICT", "产品版本不存在或不能发布", 409);
      await client.query("update products set version=version+1,updated_by=$2,updated_at=now(),request_id=$3 where id=$1", [productId, meta.actor.username, meta.requestId]);
      return { status: 200, body: { ok: true, data: result.rows[0], request_id: meta.requestId }, targetType: "PRODUCT_VERSION", targetId: versionId, oldVersion: expected, newVersion: expected + 1 };
    });
  }

  async addPrice(mappingId: number, meta: MutationMeta, input: Record<string, unknown>): Promise<MutationResult> {
    const effectiveFrom = date(input.effective_from, "生效时间", new Date()); const effectiveTo = input.effective_to ? date(input.effective_to, "失效时间") : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) throw new MasterDataError("REQUEST_VALIDATION_FAILED", "价格失效时间必须晚于生效时间");
    return this.repository.execute(meta, async (client) => {
      const mapping = await client.query("select 1 from supplier_mappings where id=$1 and supplier_id is not null", [mappingId]); if (!mapping.rows[0]) throw new MasterDataError("MAPPING_NOT_FOUND", "供应商物料映射不存在", 404);
      const result = await client.query(`insert into supplier_mapping_price_history(supplier_mapping_id,price,currency_code,price_uom,minimum_order_qty,effective_from,effective_to,source_document_ref,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [mappingId, decimal(input.price, "价格"), text(input.currency_code ?? "CNY", "币种", 3, true).toUpperCase(), text(input.price_uom, "价格单位", 40, true), input.minimum_order_qty === undefined ? null : nonnegativeDecimal(input.minimum_order_qty, "最小订购量", true), effectiveFrom, effectiveTo, text(input.source_document_ref, "来源单据", 200), meta.actor.username, meta.requestId]);
      return { status: 201, body: { ok: true, data: result.rows[0], request_id: meta.requestId }, targetType: "SUPPLIER_MAPPING_PRICE", targetId: Number(result.rows[0].id) };
    });
  }

}
