import type { MaterialIssue } from "./errors.ts";

export type MaterialActor = Readonly<{
  username: string;
  permissions: readonly string[];
  must_change_password: boolean;
}>;

export type DraftBasicFields = Readonly<{
  standard_name: string;
  unit: string;
  brand: string;
  manufacturer: string;
  manufacturer_part_number: string;
  procurement_type: string;
  inventory_type: string;
  lot_control_required: boolean;
  shelf_life_days: number | null;
  inspection_type: string;
  environmental_requirement: string;
  source_type: string;
  source_ref: string;
}>;

export type AttributeInput = Readonly<{
  value: unknown;
  unit?: string;
  source?: string;
  confidence?: number;
}>;

export type NormalizedAttribute = Readonly<{
  definitionId: number;
  attributeCode: string;
  name: string;
  dataType: string;
  value: unknown;
  normalizedValue: string;
  unitCode: string;
  sourceType: string;
}>;

export type ValidatedDraft = Readonly<{
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  basic: DraftBasicFields;
  attributes: readonly NormalizedAttribute[];
  issues: readonly MaterialIssue[];
}>;

export type MaterialRow = Record<string, unknown> & {
  id: string | number;
  category_id: string | number;
  version: number;
  material_status: string;
  created_by: string;
  last_modified_by: string;
};

export type MutationResult = Readonly<{
  material_id: number;
  material_status: string;
  status: string;
  version: number;
  internal_material_code: string | null;
}>;
