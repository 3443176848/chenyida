# 多供应商自适应物料导入 V1

任务：`PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT`

状态：`IMPLEMENTED / NON-PRODUCTION`

## 1. 范围

本任务只扩展现有 Material Import Parser、Mapping、Normalization 和 Review 链路，不创建第二套导入系统，不修改采购、库存、生产或品质模块，不连接或部署生产环境。

处理边界严格分为：

1. `Structure Analysis`：工作表评分、1～3 行表头识别、合并表头路径、数据起始行和标题/说明/空行/合计/页脚/重复表头分类。
2. `Field Mapping`：集中式字段别名、表头与样本联合评分、供应商历史 Profile 加权，以及 `EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT`。
3. `Specification Extraction`：优先使用独立规格列，允许型号/尺寸/材质/颜色/参数多列确定性组合；只有缺少独立规格时才从名称/描述提出可解释候选。推导候选必须人工确认，不得由 AI 静默补造。
4. `Canonical Import Row`：以现有不可变 `material_import_rows` 为原始事实，以现有 normalization row/payload 为映射结果载体，再进入既有 Validation、Approval 和 Draft Service。

## 2. Canonical Import Row 与现有模型对应

| Canonical 字段 | 现有或扩展载体 |
| --- | --- |
| `source_file_id` | `material_import_files.id`，由 batch 唯一文件关系取得 |
| `source_sheet_name/source_row_number` | `material_import_rows.sheet_name/row_number` 与 normalization lineage |
| `supplier_id` | V1 使用稳定 `supplier_key`；不伪造尚不存在的 Supplier FK |
| `supplier_profile_id` | `material_import_supplier_profiles.id`，可空 |
| `raw_values_json` | 只保留于不可变 `material_import_rows`，canonical payload 保存引用/hash，不复制覆盖 |
| `raw_*` | normalization payload 的 `canonical_import.raw_fields` |
| `mapped_values_json` | normalization payload 的既有 basic/attributes/category/supplier 映射投影 |
| `mapping_confidence/specification_confidence` | canonical payload 与 normalized row 关系化队列列 |
| `mapping_status/review_status` | canonical payload 与 normalized row 关系化队列列 |
| `created_at/updated_at` | 既有 normalized row 时间列 |

不在原始行表写入映射、提取、置信度或审核结果。

## 3. 结构识别规则

- 每个可见 Sheet 读取前 50 行并独立评分；不默认选择第一个工作表。
- Sheet 评分包含非空行/列、别名命中、关键字段覆盖、连续数据结构、文本/数值分布，以及封面/说明/统计页负向证据。
- 每个 Sheet 对 1、2、3 行连续表头组合评分。合并区域只用于把父级表头传播到其覆盖列，不修改原始单元格。
- 组合列名保留父子路径，例如 `物料信息/料号`、`规格信息/型号`。
- 数据区分类至少输出 `DATA/BLANK/TITLE_OR_NOTE/REPEATED_HEADER/SUBTOTAL/TOTAL/FOOTER`，并保存 reason codes。

## 4. Mapping 和规格规则

- 字段别名集中在单一版本化词典中，至少覆盖 `material_code/material_name/specification/model/brand/unit/category/description/manufacturer_part_no/supplier_part_no/drawing_no/quantity/price`。
- 标题匹配之外还使用样本类型、唯一率、长度、尺寸/型号/单位特征、相邻列和 Profile 历史。
- 一个目标可持有多个来源列和明确组合策略；不使用任意表达式。
- 规格来源优先级：独立规格列 > 型号/尺寸/材质/颜色/参数组合 > 名称/描述中的确定性候选。
- 名称/描述提取只产生 `SUGGESTED` 和人工复核问题；空规格不得被标为可提交，也不得写入 Draft 属性。
- `CONFLICT/SUGGESTED/UNMAPPED` 均 fail closed；`HIGH_CONFIDENCE` 仍需用户确认 Mapping。

## 5. 迁移、安全和生产边界

- 使用新增 `0008` 扩展既有 Mapping/Normalization 模型和 Supplier Profile，不修改 `0005`～`0007`。
- `0008` 的 Down 是受保护的兼容回退：确认不存在自适应 Profile、Mapping 和 Review 业务状态后恢复旧索引，但保留新增可空列供旧代码忽略。完整结构恢复必须使用执行迁移前的可恢复快照。
- Profile 只保存受控结构和 Mapping 规则，不保存完整供应商业务行、价格、联系方式或凭证。
- 所有值仍视为不可信文本；不执行公式、宏、网络关系、任意正则、脚本或 AI。
- 本任务只在隔离 D1 和合成脱敏夹具验证；没有真实样本文件时如实记录 `NO_REAL_SAMPLE_FILES`。
- 生产迁移、Profile 初始化、真实数据导入和部署均需独立授权。

## 6. 验收

- 覆盖不同 Sheet、标题/说明/空行、合并表头、2～3 行表头、重复打印表头、合计/页脚。
- 覆盖全部规格别名、多列规格组合、名称/描述规格候选、冲突和空规格阻断。
- 覆盖旧单行 Mapping 的向后兼容、Normalization lineage、Review 状态和 Draft fail-closed。
- Migration 覆盖空库升级、已有数据升级、约束/索引、失败原子性，以及有数据时拒绝、无数据时兼容回退。
- 运行在线基线、隔离 API smoke、凭证扫描、本地临时 SQLite 基线和 `git diff --check`。

实施与验收证据见 `material-import-adaptive-supplier-completion.md`。
