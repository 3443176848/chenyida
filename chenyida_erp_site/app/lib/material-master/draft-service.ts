import type { MaterialValidationInput } from "../material-validation/index.ts";
import {
  MATERIAL_ENVIRONMENTAL_REQUIREMENTS,
  MATERIAL_INSPECTION_TYPES,
  MATERIAL_INVENTORY_TYPES,
  MATERIAL_PROCUREMENT_TYPES,
  MATERIAL_SOURCE_TYPES,
  MaterialMasterRepositoryError,
  MaterialMasterServiceError,
  type CreateMaterialDraftCommand,
  type MaterialAttributeStorageDefinition,
  type MaterialAttributeStorageSnapshot,
  type MaterialAttributeValueWrite,
  type MaterialDraftFields,
  type MaterialDraftResult,
  type MaterialDraftService,
  type MaterialMasterServiceDependencies,
  type MaterialSourceType,
} from "./types.ts";

const SOURCE_TYPES = new Set<string>(MATERIAL_SOURCE_TYPES);
const PROCUREMENT_TYPES = new Set<string>(MATERIAL_PROCUREMENT_TYPES);
const INVENTORY_TYPES = new Set<string>(MATERIAL_INVENTORY_TYPES);
const INSPECTION_TYPES = new Set<string>(MATERIAL_INSPECTION_TYPES);
const ENVIRONMENTAL_REQUIREMENTS = new Set<string>(MATERIAL_ENVIRONMENTAL_REQUIREMENTS);

function inputError(field: string, message: string): never {
  throw new MaterialMasterServiceError("MATERIAL_DRAFT_INPUT_INVALID", message, {
    details: { field },
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return inputError(field, `字段“${field}”必须是非空字符串`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return inputError(field, `字段“${field}”必须是字符串`);
  return value.trim();
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    return inputError(field, `字段“${field}”不在允许值范围内`);
  }
  return value as T;
}

function sourceType(value: unknown, field: string): MaterialSourceType {
  return enumValue<MaterialSourceType>(value, field, SOURCE_TYPES);
}

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "服务端时间不可用");
  }
  return value.toISOString();
}

function normalizeFields(command: CreateMaterialDraftCommand): MaterialDraftFields {
  const fields = command.basic_fields;
  const lotControl = fields.lot_control_required ?? false;
  if (typeof lotControl !== "boolean") {
    return inputError("basic_fields.lot_control_required", "批次控制标志必须是布尔值");
  }

  const shelfLife = fields.shelf_life_days ?? null;
  if (
    shelfLife !== null &&
    (!Number.isSafeInteger(shelfLife) || (shelfLife as number) < 0)
  ) {
    return inputError("basic_fields.shelf_life_days", "保质期天数必须是非负整数或空值");
  }

  return {
    categoryId: fields.category_id,
    standardName: requiredString(fields.standard_name, "basic_fields.standard_name"),
    baseUom: requiredString(fields.unit, "basic_fields.unit"),
    brand: optionalString(fields.brand, "basic_fields.brand"),
    manufacturer: optionalString(fields.manufacturer, "basic_fields.manufacturer"),
    manufacturerPartNumber: optionalString(
      fields.manufacturer_part_number,
      "basic_fields.manufacturer_part_number",
    ),
    procurementType: enumValue(
      fields.procurement_type,
      "basic_fields.procurement_type",
      PROCUREMENT_TYPES,
    ),
    inventoryType: enumValue(
      fields.inventory_type,
      "basic_fields.inventory_type",
      INVENTORY_TYPES,
    ),
    lotControlRequired: lotControl ? 1 : 0,
    shelfLifeDays: shelfLife as number | null,
    inspectionType: enumValue(
      fields.inspection_type,
      "basic_fields.inspection_type",
      INSPECTION_TYPES,
    ),
    environmentalRequirement: enumValue(
      fields.environmental_requirement,
      "basic_fields.environmental_requirement",
      ENVIRONMENTAL_REQUIREMENTS,
    ),
    sourceType: sourceType(command.source_type, "source_type"),
    sourceRef: requiredString(fields.source_ref, "basic_fields.source_ref"),
  };
}

function formatScaledInteger(value: number, scale: number): string {
  if (scale === 0) return String(value);
  const negative = value < 0;
  const digits = String(Math.abs(value)).padStart(scale + 1, "0");
  const split = digits.length - scale;
  return `${negative ? "-" : ""}${digits.slice(0, split)}.${digits.slice(split)}`;
}

function normalizedValue(
  definition: MaterialAttributeStorageDefinition,
  rawValue: string | number | boolean,
  decimalScaled: number | null,
): string {
  switch (definition.normalizationRule) {
    case "NONE":
      return typeof rawValue === "boolean" ? (rawValue ? "1" : "0") : String(rawValue);
    case "TRIM_UPPER":
      if (typeof rawValue !== "string") break;
      return rawValue.trim().toUpperCase();
    case "DECIMAL_SCALE":
      if (decimalScaled !== null) return formatScaledInteger(decimalScaled, definition.decimalScale);
      if (typeof rawValue === "number") return String(rawValue);
      break;
    case "ENUM_CODE":
      if (typeof rawValue !== "string") break;
      return rawValue;
    case "DATE_ISO":
      break;
  }
  throw new MaterialMasterServiceError(
    "MATERIAL_ATTRIBUTE_STORAGE_INVALID",
    "属性规范化 metadata 无法安全应用",
    { details: { attribute_code: definition.code } },
  );
}

function serializeAttribute(
  definition: MaterialAttributeStorageDefinition,
  entry: CreateMaterialDraftCommand["attributes"][string],
  fields: MaterialDraftFields,
): MaterialAttributeValueWrite {
  let valueText: string | null = null;
  let valueInteger: number | null = null;
  let valueDecimalScaled: number | null = null;
  let valueBoolean: 0 | 1 | null = null;
  const valueDate: string | null = null;

  switch (definition.dataType) {
    case "TEXT":
    case "ENUM":
      if (typeof entry.value !== "string") break;
      valueText = entry.value;
      break;
    case "INTEGER":
      if (!Number.isSafeInteger(entry.value)) break;
      valueInteger = entry.value as number;
      break;
    case "DECIMAL": {
      if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) break;
      const factor = 10 ** definition.decimalScale;
      const scaled = entry.value * factor;
      const rounded = Math.round(scaled);
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
      if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > tolerance) {
        throw new MaterialMasterServiceError(
          "MATERIAL_ATTRIBUTE_STORAGE_INVALID",
          "属性值超过允许的小数精度",
          {
            details: {
              attribute_code: definition.code,
              decimal_scale: definition.decimalScale,
            },
          },
        );
      }
      valueDecimalScaled = rounded;
      break;
    }
    case "BOOLEAN":
      if (typeof entry.value !== "boolean") break;
      valueBoolean = entry.value ? 1 : 0;
      break;
    default:
      break;
  }

  if (
    valueText === null &&
    valueInteger === null &&
    valueDecimalScaled === null &&
    valueBoolean === null &&
    valueDate === null
  ) {
    throw new MaterialMasterServiceError(
      "MATERIAL_ATTRIBUTE_STORAGE_INVALID",
      "属性值无法写入已定义的类型列",
      { details: { attribute_code: definition.code } },
    );
  }

  const attributeSource = entry.source === undefined
    ? fields.sourceType
    : sourceType(entry.source, `attributes.${definition.code}.source`);
  const unit = entry.unit === undefined ? "" : requiredString(entry.unit, `attributes.${definition.code}.unit`);
  const rawValue = entry.value as string | number | boolean;

  return {
    attributeDefinitionId: definition.id,
    attributeCode: definition.code,
    rawValue,
    valueText,
    valueInteger,
    valueDecimalScaled,
    valueBoolean,
    valueDate,
    normalizedValue: normalizedValue(definition, rawValue, valueDecimalScaled),
    unitCode: unit,
    sourceType: attributeSource,
    sourceRef: fields.sourceRef,
  };
}

function buildSnapshot(
  fields: MaterialDraftFields,
  attributes: readonly MaterialAttributeValueWrite[],
): string {
  const attributeSnapshot = Object.fromEntries(
    attributes.map((attribute) => [
      attribute.attributeCode,
      {
        value: attribute.rawValue,
        value_decimal_scaled: attribute.valueDecimalScaled,
        unit: attribute.unitCode,
        source_type: attribute.sourceType,
      },
    ]),
  );

  return JSON.stringify({
    internal_material_code: null,
    category_id: fields.categoryId,
    standard_name: fields.standardName,
    base_uom: fields.baseUom,
    brand: fields.brand,
    manufacturer: fields.manufacturer,
    manufacturer_part_number: fields.manufacturerPartNumber,
    procurement_type: fields.procurementType,
    inventory_type: fields.inventoryType,
    lot_control_required: fields.lotControlRequired === 1,
    shelf_life_days: fields.shelfLifeDays,
    inspection_type: fields.inspectionType,
    environmental_requirement: fields.environmentalRequirement,
    source_type: fields.sourceType,
    source_ref: fields.sourceRef,
    material_status: "DRAFT",
    version: 1,
    attributes: attributeSnapshot,
  });
}

class DefaultMaterialDraftService implements MaterialDraftService {
  private readonly dependencies: Required<MaterialMasterServiceDependencies>;

  constructor(dependencies: MaterialMasterServiceDependencies) {
    this.dependencies = {
      ...dependencies,
      clock: dependencies.clock ?? (() => new Date()),
    };
  }

  async createDraft(command: CreateMaterialDraftCommand): Promise<MaterialDraftResult> {
    const validationInput: MaterialValidationInput = {
      category_id: command.basic_fields.category_id,
      basic_fields: {
        standard_name: command.basic_fields.standard_name,
        unit: command.basic_fields.unit,
        source_type: command.source_type,
      },
      attributes: command.attributes,
    };
    let validation = await this.dependencies.validationService.validateForCreate(validationInput);
    if (!validation.valid) {
      throw new MaterialMasterServiceError(
        "MATERIAL_CREATE_VALIDATION_FAILED",
        "物料草稿未通过创建校验",
        { validation },
      );
    }

    const fields = normalizeFields(command);
    const actor = requiredString(command.context.actor, "context.actor");
    const requestId = requiredString(command.context.request_id, "context.request_id");
    const createdAt = timestamp(this.dependencies.clock);

    let storageSnapshot: MaterialAttributeStorageSnapshot;
    try {
      storageSnapshot = await this.dependencies.repository.getAttributeStorageDefinitions(fields.categoryId);
    } catch {
      throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料属性 metadata 暂时不可用");
    }

    if (storageSnapshot.categoryLevel !== 4 || storageSnapshot.categoryStatus !== "ACTIVE") {
      throw new MaterialMasterServiceError(
        "MATERIAL_ATTRIBUTE_STORAGE_INVALID",
        "物料分类 metadata 在校验后发生变化",
        { details: { category_id: fields.categoryId } },
      );
    }

    validation = await this.dependencies.validationService.validateForCreate(validationInput);
    if (!validation.valid) {
      throw new MaterialMasterServiceError(
        "MATERIAL_CREATE_VALIDATION_FAILED",
        "物料草稿未通过提交前复核",
        { validation },
      );
    }

    const missingRequired = storageSnapshot.definitions.find(
      (definition) => definition.isRequired && !(definition.code in command.attributes),
    );
    if (missingRequired) {
      throw new MaterialMasterServiceError(
        "MATERIAL_ATTRIBUTE_STORAGE_INVALID",
        "必填属性 metadata 在校验后发生变化",
        { details: { attribute_code: missingRequired.code } },
      );
    }

    const definitionsByCode = new Map(
      storageSnapshot.definitions.map((definition) => [definition.code, definition]),
    );
    const attributes = Object.entries(command.attributes).map(([code, entry]) => {
      const definition = definitionsByCode.get(code);
      if (!definition) {
        throw new MaterialMasterServiceError(
          "MATERIAL_ATTRIBUTE_STORAGE_INVALID",
          "属性 metadata 在校验后发生变化",
          { details: { attribute_code: code } },
        );
      }
      return serializeAttribute(definition, entry, fields);
    });

    try {
      const material = await this.dependencies.repository.createDraft({
        fields,
        attributes,
        createdBy: actor,
        createdAt,
        requestId,
        metadataGuard: storageSnapshot.metadataGuard,
        snapshotJson: buildSnapshot(fields, attributes),
      });
      return { material, validation };
    } catch (error) {
      if (error instanceof MaterialMasterRepositoryError && error.kind === "MATERIAL_ID_CONFLICT") {
        throw new MaterialMasterServiceError(
          "MATERIAL_WRITE_FAILED",
          "物料草稿编号分配冲突，请重试",
        );
      }
      throw new MaterialMasterServiceError("MATERIAL_WRITE_FAILED", "物料草稿创建失败");
    }
  }
}

export function createMaterialDraftService(
  dependencies: MaterialMasterServiceDependencies,
): MaterialDraftService {
  return new DefaultMaterialDraftService(dependencies);
}
