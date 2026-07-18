# PHASE3-MATERIAL-LIBRARY-01 内部物料库落地说明

## 目标与边界

本任务把既有 Material Import Normalization 接到既有 Material Master Draft，不重写 Import、不创建第二套物料主表、不改变人工审核为正式编码的流程。目标链路为：

```text
Excel/CSV -> Import Batch -> Mapping -> Normalization Review
          -> Normalization Approval -> Material Draft
          -> 既有人工提交/审核 -> ACTIVE + 正式内部编码
```

本任务只实施在线 Site 的 Cloudflare D1/Drizzle 非生产代码和版本化迁移。未连接生产 D1/R2/Queue，未执行生产迁移、真实文件导入、Sites 保存或部署，也未修改本地 Python 版业务模型。

## 既有模型复用

用户目标字段不按一张宽表重复建设，而映射到现有关系边界：

| 目标语义 | 既有/本次权威模型 |
| --- | --- |
| `materials` | 复用 `material_master`；正式编码为 `internal_material_code` |
| `legacy_code`、多语言/旧名称 | `material_aliases`、`legacy_material_mapping` |
| 分类 code/name/parent/level/path/enabled | `material_categories`；path 由 parent 链确定性投影，状态使用 `ACTIVE/INACTIVE` |
| 品牌 | 本次新增 `brands`、`brand_aliases`，`material_master.brand_id` 为结构化引用；旧 `brand` 文本保留兼容 |
| 基础单位 | 本次新增 `units`、`unit_aliases`，`material_master.base_unit_id` 为结构化引用；旧 `base_uom` 保留兼容 |
| specification/model/drawing 等动态属性 | 复用 `material_attribute_definitions`、`material_category_attributes`、`material_attribute_values`，以稳定 `attribute_code` 定义 |
| 制造商料号 | 复用 `material_master.manufacturer_part_number` |
| 供应商料号/名称/规格 | 复用 `supplier_mappings` 和 Import `supplier_reference`，不得成为业务主键 |
| description | 分类 description、属性定义和别名边界；不新增无约束 Material JSON |
| 状态/version/审计 | 复用 `material_master`、`material_versions`、`material_change_logs` 和 `audit_log` |

`material_attribute_values` 已有 `(material_id, attribute_definition_id)` 唯一约束，因此同一物料同一稳定属性 code 只能有一个当前值。既有服务只允许四级启用叶子分类。

## 0007 增量模型

新增：

- `units`、`unit_aliases`
- `brands`、`brand_aliases`
- `material_import_normalization_approvals`
- `material_import_draft_links`
- `material_duplicate_candidates`

扩展 `material_master`：

- `brand_id`
- `base_unit_id`
- `source_import_batch_id`
- `source_import_file_id`
- `source_import_row_id`

所有变化均为新增表、可空列、外键、唯一约束和索引；未删除、重命名或重建既有表。迁移内置 `PCS/KG/G/M/MM` 标准单位以及 `个/件/pcs -> PCS` 别名。受保护 Down 只在没有品牌、批准、Draft 关联、候选或正式引用，且标准 seed 未被修改时允许回滚。

## Import 到 Draft 规则

1. 只读取批次当前 `SUCCEEDED` 且原子发布的 Normalization Run。
2. Approval 绑定批次版本和 `result_digest`；有 ERROR 行禁止批准，有 WARNING 行需明确确认。
3. `material.import.commit` 只授予 admin/manager；读取仍执行 owner/`read_any` 行级可见性。
4. dry-run 解析唯一启用四级分类、标准单位/别名、品牌/别名，并调用既有 Material Validation。
5. 创建复用既有 Draft Service；单行事务同时写 `DRAFT`、属性、版本、变更日志、Import 关联和重复候选。
6. Draft 没有正式编码，不能直接 `ACTIVE`；后续继续使用既有 submit/review/approve 服务。
7. 同一 Normalized Row 只能关联一个 Material；请求幂等与行幂等共同阻止重复导入。

## 重复候选

候选比较现有 `material_master`、`material_aliases`、`supplier_mappings` 和动态属性中的：

- material code / legacy code（当导入供应商料号与其相等时）
- standard name
- brand
- model
- specification
- manufacturer + manufacturer part number
- supplier part number

等级为 `EXACT`、`HIGH_CONFIDENCE`、`POSSIBLE`，最多返回并保存 20 个候选：

- `EXACT`：阻断 Draft。
- `HIGH_CONFIDENCE`：阻断 Draft 并等待人工确认；当前尚无已审计的逐行解除流程。
- `POSSIBLE`：只提示。

任何等级都不自动合并、不删除、不覆盖。

## 命令

```bash
npm run material-library:import -- inspect --file /path/to/materials.xlsx
npm run material-library:import -- inspect --api-base http://127.0.0.1:3000 --batch-id 1
npm run material-library:import -- dry-run --api-base http://127.0.0.1:3000 --batch-id 1
npm run material-library:import -- commit --api-base http://127.0.0.1:3000 --batch-id 1
npm run material-library:import -- report --api-base http://127.0.0.1:3000 --batch-id 1
```

本地 `inspect --file` 不需要 API 或 Cookie，只读处理不超过 10 MiB 的 `.xlsx/.csv`，输出文件类型、大小、SHA-256、Sheet/CSV 行列、编码/分隔符、表头候选和可能标准字段，不输出业务数据行、不修改源文件。

批次命令只接受回环地址；`commit` 还要求 `ERP_ENV=test/local/development`、现有登录 Cookie、CSRF、Origin。命令复用 API，不直接连接 D1。dry-run/report 分页读取后只输出总数、成功/错误/警告/重复/待审，以及分类、单位、品牌和重复等级的安全计数汇总，不逐行打印物料正文。实际批次必须先 inspect/dry-run，再由有权限操作者批准和 commit。

## 已知限制

- 本次不向既有 Mapping Target 增加“旧编码”或“内部编码”目标，以避免重写 Import；旧编码命中依赖现有供应商料号/别名证据。
- 分类、单位和品牌不自动创建；无法唯一命中时该行保持 `NEEDS_REVIEW`，不能创建 Draft。
- `HIGH_CONFIDENCE` 当前采用 fail-closed 阻断；逐行人工确认、审计和解除流程仍待后续实现。
- 本次只准备 Draft 生成能力，未在既有 Review UI 增加新写按钮。
- 尚未对真实企业物料文件做 dry-run；仓库内只发现治理模板和示例数据。
- 生产迁移、真实导入、外部备份、容量验收和部署必须另行授权。
