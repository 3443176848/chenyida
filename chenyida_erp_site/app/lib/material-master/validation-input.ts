import type { MaterialValidationInput } from "../material-validation/index.ts";
import type { MaterialRecord } from "./types.ts";

export function materialRecordToValidationInput(material: MaterialRecord): MaterialValidationInput {
  return {
    category_id: material.fields.categoryId,
    basic_fields: {
      standard_name: material.fields.standardName,
      unit: material.fields.baseUom,
      source_type: material.fields.sourceType,
    },
    attributes: Object.fromEntries(
      material.attributes.map((attribute) => [
        attribute.attributeCode,
        {
          value: attribute.value,
          ...(attribute.unit === "" ? {} : { unit: attribute.unit }),
          source: attribute.sourceType,
        },
      ]),
    ),
  };
}
