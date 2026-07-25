# 自托管迁移字段与关系映射规格 V1

## 稳定标识

每条 ID map 固定保存 `source_system/source_kind/source_stable_key_digest/target_table/target_id/mapping_status/source_digest/target_digest/migration_run_id`。明文 stable key 只在受控内存计划中使用，不落报告或 staging；同 snapshot + digest 重放返回相同目标，digest 变化进入 `SOURCE_CHANGED` 冲突并禁止覆盖。目标 ID 由 source identity 的 SHA-256 确定性派生或由目标唯一键返回，绝不按名称猜测。

## 领域映射

| 顺序 | 来源 kind | 目标关系 | 必要映射与门禁 |
| ---: | --- | --- | --- |
| 1 | identity | `app_users` 迁移计划 | username 唯一；固定十角色；Session/明文/未知 hash 不迁；disabled + must-change |
| 2 | unit/category/material | `units/material_categories/material_master` | Unit/Category 先行；Material code 重复、缺 Unit、非叶子分类阻断 |
| 3 | customer/supplier/product | `master_*`、`product_*` | code 为 source key；名称只展示；customer-specific product 必须有 Customer ID |
| 4 | supplier_mapping | `master_supplier_mappings` | Supplier/Material/Unit 三个 ID map 均存在；supplier part 不是主键 |
| 5 | product_version/bom | `product_versions/bom_*` | released 版本；每行 Material/Unit FK；orphan line 阻断整个 BOM 下游 |
| 6 | inventory_balance | 期初计划 / `inventory_*` | 仅 MAIN/空 lot/基础单位；非负、六位；不伪造历史单据 |
| 7 | purchase | `purchase_*` | Supplier/Material/Unit、PO/Receipt 数量链稳定且状态合法 |
| 8 | production | `production_*` | released BOM snapshot、需求、领料、报工、完工数量链一致 |
| 9 | sales | `sales_*` | Customer/Product/Material/Unit、订单/发货链一致，客户专用限制成立 |
| 10 | quality | `quality_*` | IQC→Receipt Line、IPQC→Report、FQC→Completion+SO Line；禁止弱 ref 猜测 |
| 11 | finance | `finance_*` | AR→Shipment source，AP→Receipt source；孤立期初为 `MODEL_GAP` |
| 12 | audit/attachment | 安全审计计划/受控文件 | 只保留 stable object ref、大小、SHA；不迁正文、凭证或绝对路径 |

## 状态与精度

来源状态必须经过版本化 allowlist；未知状态记录 `INVALID_STATUS` 并阻断依赖链。数量与金额以十进制定点解析，最多六位小数；超过六位不静默截断，记录 `PRECISION_EXCEEDED`。币种首期只允许 CNY；单位换算在未确认规则时不自动执行。

## 映射注册表版本

初始版本 `selfhost-source-map-v1`，normalization 版本 `selfhost-normalization-v1`。注册表内容采用 canonical JSON SHA-256；任何变化使 Plan/Checkpoint 失效并要求重新 Inspect/Plan/Dry-run。
