# Material Import Field Mapping V1 规格

状态：`APPROVED / PHASE2-TASK04 IMPLEMENTED IN NON-PRODUCTION`

业务决定：`Status: APPROVED`

任务：`PHASE2-TASK03`（设计）/ `PHASE2-TASK04`（实施）

## 1. 目的和边界

本规格定义已发布 `parse_run` 的 Sheet、表头建议、字段 Mapping 草稿、预览和人工确认。它依赖 `material-import-parser-v1.md` 的 `PARSED` 恢复点和原始单元格契约。

本阶段不清洗数据、不自动分类、不匹配正式物料、不创建 Material Draft、不写 Material Master。Mapping 只声明“源列拟进入哪个稳定目标槽位”，不是已转换、已验证或已批准的物料数据。

## 2. 状态和用户行为

### 2.1 Mapping 准备

当前 `parse_run` 发布后，内部任务执行：

```text
PARSED
  -> PREPARE_MAPPING
  -> PUBLISH_MAPPING_PREPARATION
  -> AWAITING_MAPPING
```

`PARSED` 下允许读取 Sheet 和原始行，但不允许选择 Sheet、确认表头、编辑 Mapping 或确认 Mapping。准备失败时批次保持 `PARSED`，`mapping_preparation_status = FAILED`，内部调度或人工运维只重试 Mapping 准备。

准备成功后创建绑定当前 `parse_run_id` 的 Mapping draft，并以批次 CAS 进入 `AWAITING_MAPPING`。只有该状态允许用户编辑、预览和确认。

### 2.2 Mapping 状态

建议值：

- `DRAFT`：可以编辑；
- `CONFIRMED`：已人工确认，不原地编辑；
- `STALE`：新 parse run 发布或目标 metadata 失效，不能继续确认；
- `SUPERSEDED`：由新的 Mapping 版本明确替代。

`MAPPING_CONFIRMED` 批次在 V1 禁止重新解析。若 `PARSED` 或 `AWAITING_MAPPING` 发布新 run，旧 Mapping 保留审计可读性并转 `STALE`，不得静默删除。

## 3. Sheet 和表头建议

### 3.1 Sheet 选择

- 默认候选只来自非空 `VISIBLE` Sheet；隐藏和 very-hidden Sheet 不可选择。
- 建议排序：有结构化表头候选的 Sheet优先，其次非空行数较多者，再按原 `sheet_index`。
- 自动结果只标记为 `suggestion`，不写入最终用户确认字段。
- 用户最终选择由 `selected_sheet_index` 保存；必须仍属于当前 `parse_run_id` 且可见。

### 3.2 Header 候选

算法只读取每个可见 Sheet 的有界前导样本，候选至少保存：

- `parse_run_id`、`sheet_index`、`row_number`；
- `rank`、`score`、`algorithm_version`；
- 有界理由代码，如 `TEXT_DENSITY`、`UNIQUE_LABELS`、`DATA_ROWS_BELOW`、`LEADING_BLANK_ROWS`；
- `metadata_digest` 和生成时间。

候选评分不得把源值全文写入日志。候选不是最终事实，必须由用户确认。

### 3.3 V1 表头规则

- 支持单行表头；
- 支持无表头模式，使用稳定合成显示名 `COLUMN_A`、`COLUMN_B`，但源列身份仍是 `column_index`；
- 多行表头、合并表头不自动拼接；返回 WARNING，由用户选择单一表头行或无表头模式；
- 重复列名合法，使用 `source_column_index` 区分；
- 空列名显示为 `COLUMN_<REF>`，不改变原始 cell；
- 表头行必须位于当前 Sheet 的行范围内；数据预览从表头下一行开始，无表头模式从首个源行开始。

## 4. 数据模型补充

### 4.1 `material_import_mappings`

| 字段 | 约束与语义 |
| --- | --- |
| `id` | 稳定 Mapping id |
| `batch_id` | FK |
| `parse_run_id` | FK，永久绑定且不可改 |
| `selected_sheet_index` | 当前 run 的可见 Sheet |
| `header_mode` | `SINGLE_ROW` 或 `NO_HEADER` |
| `header_row_number` | `SINGLE_ROW` 时非空 |
| `mapping_status` | `DRAFT`,`CONFIRMED`,`STALE`,`SUPERSEDED` |
| `mapping_version` | 从 1 开始的乐观锁版本 |
| `metadata_digest` | 保存草稿时所见目标 catalog 摘要 |
| `suggestion_algorithm_version` | 可空，记录初始化来源 |
| `supersedes_mapping_id` | 可空 FK；新版本替代旧版本 |
| `created_by`,`updated_by`,`confirmed_by` | 服务端用户 id；确认人可空 |
| `created_at`,`updated_at`,`confirmed_at` | UTC；确认时间可空 |

同一 `parse_run_id` 最多一个非 `SUPERSEDED` 当前 Mapping。Mapping 与批次 current pointer 的一致性必须由事务和 CAS 保证。

### 4.2 `material_import_mapping_items`

| 字段 | 约束与语义 |
| --- | --- |
| `id` | 主键 |
| `mapping_id` | FK，随 Mapping 版本保存 |
| `source_column_index` | 0 开始；`DEFAULT` 项可空 |
| `source_header` | 仅显示/审计，不作为身份 |
| `target_namespace` | allowlist |
| `target_code` | 由服务端 target catalog 校验 |
| `mapping_mode` | `SOURCE`,`SOURCE_WITH_DEFAULT`,`DEFAULT`,`IGNORE` |
| `default_value_json` | 受限类型值，可空；含 schema version |
| `required` | 当次 target metadata 快照值 |
| `display_order` | 非负整数 |

约束：

- `(mapping_id, source_column_index)` 对非 DEFAULT/IGNORE 目标最多一条；
- 一个源列最多映射一个非 `ignore` 目标；
- 一个具体目标最多一个源列或一个 DEFAULT 项；
- `IGNORE` 只需要源列，不需要业务目标；
- 不允许客户端提交数据库列名、SQL、JSONPath、正则脚本、代码或公式。

## 5. 稳定目标 Catalog

服务端提供内部 target catalog 供 Mapping API 校验；目标代码不是任意字符串，也不直接成为 SQL 标识符。

### 5.1 基础字段

命名空间 `basic`，V1 候选：

- `STANDARD_NAME`
- `UNIT`
- `BRAND`
- `MANUFACTURER`
- `MANUFACTURER_PART_NUMBER`
- `PURCHASE_TYPE`
- `INVENTORY_TYPE`
- `LOT_CONTROL`
- `SHELF_LIFE_DAYS`
- `INSPECTION_TYPE`
- `ENVIRONMENTAL_REQUIREMENT`

基础字段 code 由服务端静态 allowlist 映射到未来导入 DTO，不暴露数据库字段名。

### 5.2 动态属性

命名空间 `attribute`，`target_code` 必须是当前 D1 metadata 的稳定属性 code：

```text
attribute.<STABLE_CODE>
```

不得读取 seed 文件作为运行时权威，不暴露 `attribute_id`，禁用属性不能创建新 Mapping。确认时重新读取当前 metadata，核验 code、类型、启用状态、单位维度和选项集合。

属性值与单位在 V1 不允许任意两列组合。规则为：

- 若属性 metadata 有固定 canonical unit，源列映射属性值，单位由 metadata 决定；
- 若未来需要可变来源单位，必须新增稳定 `attribute_unit.<CODE>` 目标和独立任务，本规格不提前开放；
- 不允许同一源列同时映射属性值和单位。

### 5.3 分类

V1 只使用 `category_hint`。源值作为后续分类任务的提示文本，不直接转为 `category_id` 或 `category_code`，也不自动分类。这样可以保留来源证据而不把未经审核的分类写成正式关系。

### 5.4 供应商参考

命名空间 `supplier_reference` 只能使用服务端 allowlist，例如：

- `SUPPLIER_NAME`
- `SUPPLIER_ITEM_CODE`
- `SUPPLIER_ITEM_NAME`
- `SUPPLIER_SPECIFICATION`
- `PURCHASE_UOM`

本任务只保存 Mapping；不会建立 `supplier_mappings`、价格历史或正式物料关系。

### 5.5 Ignore

`ignore` 表示源列明确不进入后续导入 DTO。未映射列与显式 ignore 都保留原始行，但 UI 应区分“尚未处理”和“已确认忽略”。确认时所有非空源列必须映射到目标或显式 ignore，避免无意丢列。

## 6. Mapping 规则

1. 一个源列最多一个目标，一个目标最多一个源列；复杂拆分、拼接和多列合并留给后续清洗任务。
2. `source_column_index` 是源列身份，重复或空表头不影响唯一性。
3. 必填目标缺失时，草稿可以保存但不能确认；预览返回逐目标错误。
4. 默认值只允许受限 JSON scalar：`string`、有限范围整数/十进制字符串、boolean 或 null；对象、数组、表达式和函数禁止。
5. `SOURCE_WITH_DEFAULT` 只在源 cell 为 `EMPTY` 或源索引未出现时使用默认值；`TEXT ""` 不自动等同 null。
6. 空字符串、显式 EMPTY、缺失 cell 和 JSON null 保持不同；未来清洗任务决定最终归一化。
7. BOOLEAN 预览只接受目标 catalog 声明的候选值集合，不全局猜测；转换失败明确返回错误。
8. NUMBER/DATE 预览使用原始类型和解释候选，不覆盖原值；CSV 文本不因像数字而自动转型。
9. 公式单元格默认不可作为需要可信计算结果的必填目标；若使用缓存值，预览必须标记 `UNTRUSTED_FORMULA_CACHE`，确认 Mapping 不代表认可值。
10. Mapping 确认后不原地编辑。修改需创建新版本、`supersedes_mapping_id` 指向旧版本并重新确认。

## 7. API 行为

### 7.1 读取 Sheet 和原始行

`GET /api/material-master/import-batches/{batchId}/sheets` 返回当前 `parse_run_id`、批次版本、Mapping 准备状态、Sheet 安全元数据及候选。隐藏 Sheet 只返回名称、索引、可见性和跳过摘要，不返回业务行计数细节以外的内容。

`GET /api/material-master/import-batches/{batchId}/rows` 必须指定 `sheet_index`，支持 `page/page_size` 或 `start_row/end_row`，两套模式不得混用。`page_size` 和行范围必须有上限；只返回当前有效 run，历史 run 不通过该公共端点枚举。

### 7.2 获取和保存 Mapping

`GET .../{batchId}/mapping` 返回当前 Mapping、items、版本、绑定 run、目标 catalog 摘要和状态。

`PUT .../{batchId}/mapping` 请求至少包含：

- `expected_version`：批次版本；
- `parse_run_id`：必须等于 `current_parse_run_id`；
- `expected_mapping_version`；
- Sheet、header mode/row；
- 完整 Mapping item 集合。

PUT 是完整替换当前 DRAFT 聚合，不是部分 patch。事务校验版本、状态、Sheet、表头、源列范围、目标 allowlist、重复目标和默认值，成功后 `mapping_version + 1` 并写事件/审计/幂等结果。

### 7.3 有界预览

`POST .../{batchId}/mapping/preview`：

- 只处理显式 `start_row` 和有上限 `row_limit` 的样本，最大 100 行；
- 可预览尚未保存的完整 Mapping payload，但同样执行 allowlist 和版本绑定校验；
- 返回每行的源 cell 摘要、目标对应、候选转换值、warning/error code；
- 不执行完整清洗、分类、匹配或 Draft 创建；
- 不返回无界 workbook、脚本执行结果或内部 SQL；
- 输出公式和 HTML 时按纯文本编码并截断到响应预算。

### 7.4 确认 Mapping

`POST .../{batchId}/mapping/confirm` 必须绑定：

- `batch_id`；
- `current_parse_run_id`；
- `mapping_id` 和 `expected_mapping_version`；
- 批次 `expected_version`；
- 当前 `metadata_digest`；
- `Idempotency-Key`。

确认事务重新读取当前 metadata，验证全部目标仍存在/启用、必填目标齐全、Sheet/表头有效、Mapping 无重复且状态为 `DRAFT`。成功后 Mapping 转 `CONFIRMED`、批次从 `AWAITING_MAPPING` 转 `MAPPING_CONFIRMED`、版本递增，并写事件、审计和幂等结果。

确认不读取所有数据行、不执行完整转换，也不写正式物料。

## 8. 并发与幂等

- 两个用户编辑同一 Mapping：只有匹配 `expected_mapping_version` 的请求成功，其他返回 `IMPORT_MAPPING_VERSION_CONFLICT`。
- Mapping 编辑与新 run 发布：run 发布事务把旧 Mapping 转 `STALE`；旧请求因 `parse_run_id` 或批次版本不匹配失败。
- Mapping 确认与 metadata 变化：确认时重读 metadata；摘要或目标状态变化返回 `IMPORT_MAPPING_TARGET_INVALID`。
- Mapping 确认与重复请求：相同 key/相同摘要返回同一确认结果；异载荷返回 `IDEMPOTENCY_CONFLICT`。
- Mapping 准备重复任务：绑定 `current_parse_run_id` 并以准备状态/版本 CAS；旧 run 任务不能发布。
- 不宣称 exactly-once。可信边界是事务约束、幂等记录、版本 CAS 和不可变历史。

## 9. 权限与信息披露

权限已批准用于非生产实施：

- `material.import.read`：读取本人有权批次的状态、Sheet、行和 Mapping；
- `material.import.read_any`：读取任意有权域内批次，但不自动允许 parse/map；
- `material.import.parse`：请求解析；
- `material.import.map`：编辑、预览和确认 Mapping。

API 不硬编码角色名。owner/read_any 行级条件必须进入 SQL 和 total 计算；不可见批次统一返回 `IMPORT_BATCH_NOT_FOUND` 404，不能泄露 Sheet、行数、Mapping 状态或目标选择。所有写接口执行 Origin/CSRF、请求大小、限流、幂等和审计。

## 10. 错误和安全显示

| Code | 使用场景 |
| --- | --- |
| `IMPORT_MAPPING_PREPARATION_FAILED` | 自动建议/初始化失败，批次仍为 PARSED |
| `IMPORT_SHEET_NOT_FOUND` | Sheet 不存在、隐藏或不属于当前 run |
| `IMPORT_HEADER_NOT_CONFIRMED` | 表头模式/行未确认或越界 |
| `IMPORT_MAPPING_NOT_FOUND` | 当前 run 无 Mapping |
| `IMPORT_MAPPING_INVALID` | item、默认值或完整性错误 |
| `IMPORT_MAPPING_TARGET_INVALID` | metadata 漂移、禁用或未知目标 |
| `IMPORT_MAPPING_DUPLICATE_TARGET` | 多源映射同一目标 |
| `IMPORT_MAPPING_VERSION_CONFLICT` | Mapping 或批次版本冲突 |
| `IMPORT_MAPPING_PREVIEW_FAILED` | 有界预览无法完成 |

用户消息为中文安全摘要，并带 `request_id`。不得返回堆栈、SQL、任意公式执行结果、完整恶意单元格、对象存储定位或敏感 metadata 内部标识。

## 11. 测试计划

### 11.1 Sheet/header

- 可见、多可见、空、隐藏、very-hidden Sheet；
- 默认 Sheet排序、空白前导行、单行/无表头、重复/空表头、多行和合并表头警告；
- 建议重复生成幂等、旧 run 建议不能发布。

### 11.2 Mapping

- 基础字段、动态属性、category_hint、供应商参考和 ignore；
- 一源一目标、一目标一源、重复目标、重复表头按 index；
- 缺失必填、受限默认值、null/EMPTY/空字符串、boolean 候选、日期解释、公式缓存警告；
- 禁用/删除属性、metadata 摘要变化、未知 target code 和任意 SQL/表达式拒绝；
- DRAFT、CONFIRMED、STALE、SUPERSEDED 生命周期及确认后新版本。

### 11.3 API/并发

- PARSED 只读但不能 map；AWAITING_MAPPING 可编辑/预览/确认；
- owner/read_any 最小披露、404、total；
- PUT 完整替换、预览 100 行上限、确认不创建 Draft；
- 并发编辑、确认与 metadata、新 run 与确认、幂等相同/异载荷、CSRF、限流和稳定错误。

## 12. 完成边界

`PHASE2-TASK04` 已完成 Mapping 关系表、Drizzle、服务端 API 和隔离测试，但不含 UI。任务完成后停止；不得执行生产 migration、连接生产、部署，或开始清洗、匹配、Material Draft 和正式物料任务。
