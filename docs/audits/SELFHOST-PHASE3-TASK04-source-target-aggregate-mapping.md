# TASK04 来源到目标聚合映射报告

## 总览

- 实际记录合计：`3,619`
- `READY/READY_WITH_TRANSFORM` 计划记录：`49`
- `NEEDS_BUSINESS_REVIEW`：`4`
- `ARCHIVE_ONLY`：`3,566`
- `MODEL_GAP`：`0`
- 行级 `BLOCKED` opaque reference：`0`
- Mapping registry digest：`2bd2d8349f7c2561fcd8e5eaad133a28187d25f5ba7ada132ecc81b4e8554cc0`

执行版报告中的 `duplicate=1` 来自 supplier mapping 的保守聚合：空 supplier item code 也进入了组合分组。该结果没有生成行级 conflict 或 opaque reference。提交版规则已收紧为“供应商料号非空，且同一规范化供应商/料号映射到不同内部物料”才计冲突；遵守单次真实快照边界，未重新读取真实库，因此该 `1` 只作为保守 review 提示，不宣称真实冲突成立或已解决。

## 逐表映射登记

| Source table | Target domain/table | Classification / status | Stable key 策略 | Dependency / risk |
|---|---|---|---|---|
| `app_users` | Identity / `app_users` | snapshot / `READY_WITH_TRANSFORM`（9） | normalized username；值不输出 | role/security review / high |
| `app_sessions` | none | `ARCHIVE_ONLY`（1） | 不迁移 token | users / high |
| `items` | Material / `material_master` | snapshot / `READY_WITH_TRANSFORM`（9） | internal code；值不输出 | Unit/Category / high |
| `supplier_mappings` | `supplier_mappings` | snapshot / `NEEDS_BUSINESS_REVIEW`（4） | opaque source row | Material/Supplier/Unit / high |
| `cleaning_rows` | import review archive | `ARCHIVE_ONLY` | opaque source row | import batch / medium |
| `material_import_batches` | import/file metadata | `READY_WITH_TRANSFORM`（19） | batch code digest | metadata only / high |
| `material_import_raw_rows` | immutable import archive | `ARCHIVE_ONLY` | opaque source row | batch / high |
| `products` | Product + Version | `READY_WITH_TRANSFORM`（1） | product code；值不输出 | Customer/Material / high |
| `customers` | `customers` | `READY_WITH_TRANSFORM`（1） | customer code；值不输出 | privacy review / high |
| `suppliers` | `suppliers` | `READY_WITH_TRANSFORM`（2） | supplier code；值不输出 | privacy review / high |
| `quotations` | quotation archive | `ARCHIVE_ONLY`（0） | opaque source row | Customer/Product / high |
| `product_boms` | `bom_headers` | `READY_WITH_TRANSFORM`（1） | BOM code digest | Product/Version / high |
| `bom_lines` | `bom_lines` | `READY_WITH_TRANSFORM`（3） | BOM + line position | Material/Unit / high |
| `inventory_balances` | Inventory Opening | `READY_WITH_TRANSFORM`（4） | Material + fixed location | Material/Unit / critical |
| `inventory_transactions` | inventory history archive | `ARCHIVE_ONLY` | opaque source row | source facts / critical |
| `inventory_adjustments` | inventory history archive | `ARCHIVE_ONLY` | opaque source row | Material / critical |
| `purchase_orders` / `purchase_order_lines` | Procurement snapshot/archive | `NEEDS_BUSINESS_REVIEW`（0） | code digest / line position | Supplier/Material/Unit / high |
| `work_orders` | Production snapshot/archive | `NEEDS_BUSINESS_REVIEW`（0） | code digest | BOM/Product / high |
| `work_order_materials` / `production_reports` | production history archive | `ARCHIVE_ONLY`（0） | opaque row / line position | Work order/Material / high |
| `sales_orders` | Sales snapshot/archive | `NEEDS_BUSINESS_REVIEW`（0） | code digest | Customer/Product / high |
| `shipments` | shipment archive | `ARCHIVE_ONLY`（0） | opaque source row | Sales/Inventory / critical |
| `quality_inspections` | Quality snapshot/archive | `NEEDS_BUSINESS_REVIEW`（0） | inspection digest | stable legacy source / high |
| `quality_defects` | quality archive | `ARCHIVE_ONLY`（0） | opaque source row | Inspection / high |
| `financial_documents` | Finance Opening | `READY_WITH_TRANSFORM`（0） | document digest | Shipment/Receipt source / critical |
| `financial_payments` | settlement archive | `ARCHIVE_ONLY`（0） | opaque source row | Finance document / critical |
| `activity_log` | legacy audit archive | `ARCHIVE_ONLY` | opaque source row | none / high |
| `local_schema_migrations` | none | `ARCHIVE_ONLY`（4 versions expected） | migration version | none / low |

`cleaning_rows`、raw rows、inventory history、activity log 等只在可提交报告中保留 `ARCHIVE_ONLY` 合计，不保存业务密度组合或正文。未来任务如需逐表 archive 处置，必须重新取得授权并生成新的 task-local opaque scope。

## 分类建议

- Inventory 只生成 opening 聚合计划，不生成 target ID、正式编码、adjustment 或 ledger entry。
- Finance 只评估 outstanding opening；本快照无 Finance opening。
- 已过账活动默认 archive-only；活动型 Procurement/Production/Sales/Quality 均为 `0`，没有历史活动被安全物化。
- 文件只迁移 metadata plan；本任务不读取存在性和实际 checksum。
