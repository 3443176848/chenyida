import type { PoolClient, QueryResultRow } from "pg";
import {
  MATERIAL_GOVERNANCE_LIMITS,
  MASTER_CATEGORY_GOVERNANCE_MAP,
} from "./config.ts";
import { governMaterialSource } from "./engine.ts";
import { materialSource } from "./source-adapter.ts";
import type { GovernedSource } from "./types.ts";

export class FormalMaterialScanLimitError extends Error {
  constructor() {
    super("GOVERNANCE_ACTIVE_MATERIAL_SCAN_LIMIT_EXCEEDED");
    this.name = "FormalMaterialScanLimitError";
  }
}

function governedFormalMaterial(material: QueryResultRow): GovernedSource | null {
  try {
    const source = materialSource(material);
    return source ? governMaterialSource(source) : null;
  } catch {
    return null;
  }
}

export async function scanFormalGovernanceMaterials(
  client: Pick<PoolClient, "query">,
  statuses: readonly ("ACTIVE" | "FROZEN" | "INACTIVE")[],
  visit: (material: QueryResultRow, governed: GovernedSource | null) => boolean | void,
): Promise<void> {
  let afterMaterialId = 0;
  let scanned = 0;
  while (true) {
    const materials = await client.query(`
      with material_page as (
        select material.id,material.internal_material_code,material.standard_name,material.brand,
               material.manufacturer,material.manufacturer_part_number,material.material_status,
               material.version,category.category_code
        from material_master material
        join material_categories category on category.id=material.category_id
        where material.material_status=any($1::text[]) and material.id>$2
          and category.category_code=any($3::text[])
        order by material.id
        limit $4
      )
      select material_page.*,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                 'code',definition.attribute_code,
                 'value',value.normalized_value,
                 'unit',definition.canonical_unit
               ) order by definition.attribute_code)
               from material_attribute_values value
               join material_attribute_definitions definition on definition.id=value.attribute_definition_id
               where value.material_id=material_page.id
             ),'[]'::jsonb) attributes
      from material_page order by material_page.id
    `, [statuses, afterMaterialId, Object.keys(MASTER_CATEGORY_GOVERNANCE_MAP), MATERIAL_GOVERNANCE_LIMITS.chunkRows]);
    if (!materials.rows.length) return;
    scanned += materials.rows.length;
    if (scanned > MATERIAL_GOVERNANCE_LIMITS.maxActiveMaterialScanRows) throw new FormalMaterialScanLimitError();
    for (const material of materials.rows) {
      if (visit(material, governedFormalMaterial(material)) === false) return;
    }
    afterMaterialId = Number(materials.rows.at(-1)!.id);
  }
}
