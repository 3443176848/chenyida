# Material Import Normalization & Staging V1 正式规格

> 任务：`PHASE3-TASK01`
> 状态：`PROPOSED`，等待项目负责人“规格确认”
> 范围：书面规格、未来数据模型和 API 契约；不实施代码、Schema、Migration、API、前端或生产资源

## 1. 目标与边界

Normalization 把当前 `MAPPING_CONFIRMED` Mapping 确定性地应用到当前已发布 parse run 的原始行，生成可追溯、可分页、可审计的标准字段候选、动态属性候选、`category_hint`、`supplier_reference` 和逐字段问题，并在完整核验后原子发布一个稳定结果快照。

本阶段负责：读取不可变 Mapping 快照、读取选中 Sheet 的原始行、应用受限默认值、保留原始 cell 与 lineage、执行确定性类型转换、生成 `ERROR/WARNING`、隔离暂存、核验并发布 current normalization run。

本阶段不负责：自动分类、`category_id` 认定、属性集合猜测、复杂拆分/拼接、单位换算、自由文本清洗、模糊匹配、去重、AI、Material Draft 创建、正式编码或任何正式物料写入。`NORMALIZED` 只表示规范化结果完整发布，不表示所有行可建 Draft、分类/匹配已完成或正式导入成功。

## 2. 已核验基线

- 当前批次状态可到 `MAPPING_CONFIRMED`；`material_import_batches` 有 `current_parse_run_id` 和 `current_version`，没有 normalization pointer。
- `material_import_parse_runs` 已使用独立 run、租约摘要、heartbeat、阶段、部分唯一活跃 run、失败/取消/替代历史和原子发布模式。
- `material_import_rows` 以 `(parse_run_id, sheet_index, row_number)` 唯一，保存类型化 `raw_values_json` 和 `raw_row_hash`，不得被下游覆盖。
- Mapping 永久绑定 `parse_run_id`、选中 Sheet、header、`mapping_version` 和 `metadata_digest`；状态为 `DRAFT/CONFIRMED/STALE/SUPERSEDED`。
- Target Registry 的稳定命名空间为 `basic`、`attribute`、`category_hint`、`supplier_reference`、`ignore`；Snapshot digest 已覆盖类型、默认值、单位和约束语义。
- 当前 Outbox、可注入调度器、at-least-once、租约、CAS 和 D1 batch 原子发布模式可复用，但 Outbox 只接受 Parser job type 且 `parse_run_id` 必填。
- Material Validation 当前需要确定的 `category_id`，运行时规则来自 D1 Metadata；Material Draft 写服务必须保持未调用。
- 任务开始时全量 Node 基线为 440 项；生产 Site、D1、R2 和 Queue 未改变。

平台设计依据（实施前必须重新核验）：D1 当前单字符串/BLOB/行上限 2,000,000 bytes、单 SQL 100 KB、每查询 100 个绑定参数、单查询 30 秒；`db.batch()` 中每条语句仍分别受这些限制，批次整体失败回滚。见 [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) 与 [D1 Database batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)。

## 3. 方案比较与推荐

| 主题 | 方案 A | 方案 B | 方案 C | 推荐 |
| --- | --- | --- | --- | --- |
| 执行状态 | 只使用批次状态 | 独立 run + 批次粗状态 | 每行任务状态 | B：复用 Parser 的恢复、租约和发布边界 |
| 行结果 | 全关系化列 | 版本化 JSON 行快照 | 单个批次大 JSON | B：字段/属性可演进且避开单批大行；常用筛选保留为关系列 |
| Issue | 嵌入每行 JSON | 独立表 | 只存计数 | B：支持分页、等级/code/target 筛选和审计恢复 |
| Validation | 全推迟 | 运行完整 Material Validation | Normalization 规则 + 显式 Deferred Validation | C：不伪造 `category_id`，也不放弃当前可确定的类型/Mapping 问题 |

推荐最小集合为独立 `normalization_runs`、行快照表、独立 issue 表和批次 current pointer。处理中的结果只按 run 可见；公共结果端点只读取成功发布的 current run。

## 4. 状态机与失败语义

### 4.1 批次状态

未来 `0006` 扩展：

```text
MAPPING_CONFIRMED
  -> QUEUED_FOR_NORMALIZATION
  -> NORMALIZING
  -> NORMALIZED
```

- `POST normalize` 在事务内创建 run/Outbox，并将首次运行批次从 `MAPPING_CONFIRMED` CAS 到 `QUEUED_FOR_NORMALIZATION`。
- Worker 首次取得有效租约时 CAS 到 `NORMALIZING`。
- 行中存在业务 `ERROR` 不导致 run 失败；所有目标行均产生结果并通过完整性核验后仍可发布为 `NORMALIZED`。
- 执行/基础设施失败写 `run_status=FAILED`。若没有旧 current result，批次恢复 `MAPPING_CONFIRMED`；若重新运行时已有旧 current result，批次恢复 `NORMALIZED` 并继续指向旧 run。
- V1 不新增 `NORMALIZATION_FAILED` 批次状态；失败详情属于 run，避免把可重试执行故障混入终态 `FAILED` 的保留/清理语义。
- `NORMALIZED` 可用新的 `processor_version` 显式重新运行；处理期间旧 current pointer 仍有效，只有新 run 发布事务成功才切换。

### 4.2 Run 状态与阶段

`run_status`：`QUEUED`,`RUNNING`,`STAGED`,`PUBLISHING`,`SUCCEEDED`,`FAILED`,`CANCELLED`,`SUPERSEDED`。

`current_stage`：`LOAD_MAPPING`,`READ_SOURCE_ROWS`,`NORMALIZE_ROWS`,`VERIFY_RESULT`,`PUBLISH_RESULT`,`COMPLETE`。

任务失败与行错误严格分离。`FAILED` 表示 run 无法形成完整可信快照；`row_status=ERROR` 表示快照完整，但该行包含阻断后续 Draft 的业务问题。

## 5. 异步执行与恢复

HTTP 不同步处理全表。启动事务完成：认证/能力/行级可见性/CSRF/限流/幂等校验，锁定 `batch + parse_run + mapping id/version + metadata_digest + processor_version`，创建 run，写启动 Outbox、事件、API 审计和幂等 `202` 结果，批次 CAS 后提交。

未来扩展同一个 `material_import_job_outbox`，增加可空 `normalization_run_id`，要求 `parse_run_id` 与 `normalization_run_id` 恰有一个非空；新增 job type：`START_NORMALIZATION`,`NORMALIZE_ROW_CHUNK`,`VERIFY_NORMALIZATION`,`PUBLISH_NORMALIZATION`。Queue 载荷只含稳定 ID、版本、Sheet/行范围和 job id，不含原始行或完整 payload。

- at-least-once 重复消息由 `job_id + normalization_run_id + stage + chunk_start` 吸收。
- 同一批次最多一个活跃 normalization run；部分唯一索引为最终防线，事务内检查和批次 CAS 提供清晰错误。
- 租约只保存 SHA-256 摘要；worker 持有原 token。过期后可接管，旧 token 的 heartbeat/写入/发布全部失败。
- 每个行块以 `(normalization_run_id, sheet_index, row_number)` 幂等；相同 payload hash 重放成功，不同 hash 触发版本冲突并令 run 失败。
- 历史 `FAILED/CANCELLED/SUPERSEDED` run、行和 issue 保留到受控清理；不覆盖 parse rows 或历史 normalized rows。

## 6. 未来数据模型（`0006` 设计，不实施）

### 6.1 `material_import_normalization_runs`

| 字段 | 约束与语义 |
| --- | --- |
| `id` | INTEGER PK |
| `batch_id` | FK batches, RESTRICT |
| `parse_run_id` | FK parse_runs, RESTRICT；永久绑定 |
| `mapping_id` | FK mappings, RESTRICT；永久绑定 |
| `mapping_version` | 正整数快照 |
| `processor_version` | 1–100 安全 ASCII；实现语义版本 |
| `payload_schema_version` | 正整数，V1 为 1 |
| `metadata_digest` | 64 位小写 hex |
| `run_status` | 上述 allowlist |
| `attempt_no` | 正整数；租约接管递增 |
| `lease_token_digest`,`lease_expires_at`,`heartbeat_at`,`worker_request_id` | 与 Parser 同类安全语义 |
| `current_stage` | 上述阶段 allowlist |
| `total_rows`,`processed_rows`,`valid_rows`,`warning_rows`,`error_rows` | 非负；发布时总数一致 |
| `normalized_json_bytes`,`issue_count` | 非负资源汇总 |
| `result_digest` | 发布前生成的整 run 规范摘要，可空 |
| `detail_retention_until` | 可空；非 current 历史详情的最早清理时间，current run 保持空 |
| `requested_by` | FK app_users；启动操作者 |
| `started_at`,`completed_at`,`created_at`,`updated_at` | UTC |
| `failure_code`,`safe_failure_message` | 仅 FAILED 非空；安全消息至多 500 字符 |

约束：同一 batch 只有一个 `QUEUED/RUNNING/STAGED/PUBLISHING`；`SUCCEEDED` 仅可在发布事务成为 current；租约列成对；汇总满足 `processed_rows <= total_rows` 且三类行数之和等于 processed rows。

### 6.2 `material_import_normalized_rows`

字段：`id`、`batch_id`、`normalization_run_id`、`parse_run_id`、`source_sheet_index`、`source_row_number`、`source_raw_row_hash`、`normalized_payload_json`、`normalized_payload_hash`、`row_status`、`error_count`、`warning_count`、`created_at`、`updated_at`。

约束：

- `UNIQUE(normalization_run_id, source_sheet_index, source_row_number)`；
- `row_status IN ('VALID','WARNING','ERROR')`，计数与状态一致；
- payload 必须是 object、hash 为 canonical JSON 的 SHA-256；
- 一行 payload 应用上限 262,144 bytes；绝不依赖 D1 2 MB 硬上限作为正常控制；
- 只处理 Mapping 选中 Sheet 中已发布的 raw rows；`SINGLE_ROW` 的 header row 排除，其余已存原始行均产生一条结果。

### 6.3 `material_import_normalization_issues`

字段：`id`、`normalization_run_id`、`normalized_row_id`、`issue_level`、`issue_code`、`target_code`、`source_sheet_index`、`source_row_number`、`source_column_index`、`safe_message`、`safe_details_json`、`created_at`。

约束：`issue_level IN ('ERROR','WARNING')`；`target_code` 使用完整稳定代码（如 `basic.STANDARD_NAME`、`attribute.RESISTANCE`）；source column 对默认值/行级问题可空；details 只允许安全 allowlist，不保存 SQL、堆栈、XML 路径、凭证或完整恶意正文。

### 6.4 批次指针

`material_import_batches.current_normalization_run_id` 可空 FK，只有发布成功时切换。处理中、失败或取消不得清空或覆盖旧 current pointer。

### 6.5 保留与清理

normalized payload 含原始值派生证据，安全等级不得低于原始行。current successful run 的 `detail_retention_until` 保持 null，在分类/匹配/Draft 尚未形成受控下游快照时不得自动清理。非 current 的 `FAILED/CANCELLED/SUPERSEDED` run 在 `completed_at + 30 天` 后可进入两阶段清理；先删 issue，再删 normalized rows，最后在没有 batch/current/downstream 引用时删 run。run 摘要、result digest、事件和审计按批次记录保留策略保存。

`parse_run_id` 使用 RESTRICT FK，因此原始 parse 详情的清理顺序必须先处理引用它的非 current normalization 详情；不得用关闭外键或孤儿引用绕过。未来下游阶段完成时应以独立任务定义 current 结果的归档/最小 lineage 快照和最终保留起点；`0006` 不创建自动清理 Cron。

## 7. 规范化行契约 V1

```json
{
  "schema_version": 1,
  "lineage": {
    "batch_id": 42,
    "parse_run_id": 7,
    "mapping_id": 9,
    "mapping_version": 3,
    "metadata_digest": "<sha256>",
    "processor_version": "normalizer-v1",
    "sheet_index": 0,
    "row_number": 12,
    "raw_row_hash": "<sha256>"
  },
  "basic": {
    "standard_name": {
      "target_code": "basic.STANDARD_NAME",
      "source": {"kind": "SOURCE_COLUMN", "column_index": 1, "cell_type": "TEXT", "value_state": "PRESENT", "raw_value": " 电阻 "},
      "candidate": "电阻",
      "status": "VALID"
    }
  },
  "attributes": {
    "RESISTANCE": {
      "target_code": "attribute.RESISTANCE",
      "source": {"kind": "DEFAULT_VALUE", "column_index": null, "cell_type": null, "value_state": "PRESENT", "raw_value": 10000},
      "candidate": {"value": 10000, "unit": "ohm"},
      "status": "VALID"
    }
  },
  "category_hint": {"target_code": "category_hint.CATEGORY_HINT", "source": {"kind": "SOURCE_COLUMN", "column_index": 4, "cell_type": "TEXT", "value_state": "PRESENT", "raw_value": "贴片电阻"}, "candidate": "贴片电阻", "status": "VALID"},
  "supplier_reference": {"SUPPLIER_ITEM_CODE": {"target_code": "supplier_reference.SUPPLIER_ITEM_CODE", "source": {"kind": "SOURCE_COLUMN", "column_index": 5, "cell_type": "TEXT", "value_state": "PRESENT", "raw_value": "SUP-001"}, "candidate": "SUP-001", "status": "VALID"}},
  "deferred_validation": ["CATEGORY_ASSIGNMENT_REQUIRED", "MATERIAL_VALIDATION_NOT_RUN"]
}
```

- 每个已映射目标保留 `target_code`、source kind、column index、原 cell 类型/原始值、value state、候选与字段状态。
- `category_hint` 永不表示 `category_id`；payload 不含 `material_id`、`material_code` 或 Draft id。
- 未映射来源列不进入 payload；可计入 run 安全统计。显式 `ignore` 不产生业务目标或未处理错误。
- API 列表默认不返回完整 payload；详情端点才返回有界 payload，所有字符串按纯文本处理。

## 8. Mapping 应用、空值与默认值

启动只接受当前批次的 `CONFIRMED` Mapping，且 `parse_run_id=current_parse_run_id`、digest 等于当前 Snapshot。`STALE/SUPERSEDED` 不得启动。发布前再次核对 batch pointer、Mapping 状态/id/version 和 digest；任一变化停止发布。

值状态冻结为：

| 状态 | 定义 |
| --- | --- |
| `MISSING` | `cells` 中没有该 `column_index` |
| `EMPTY` | 存在 `type=EMPTY` cell |
| `BLANK_TEXT` | `type=TEXT` 且原值为 `""` 或仅空白；以 `blank_kind` 区分 |
| `NULL_VALUE` | 受限默认值显式 JSON null；原始 cell 契约不使用 null 代替 EMPTY |
| `PRESENT` | 其他存在值 |

原始空格和原始值永远保留；文本候选执行 Unicode NFC 和首尾 trim，不做内部空白折叠。trim 后空文本不作为候选。V1 没有允许空字符串的业务目标。

Mapping mode：

- `SOURCE`：只读指定 cell；MISSING/EMPTY/BLANK 不自动补值。
- `SOURCE_WITH_DEFAULT`：只在 `MISSING` 或 `EMPTY` 使用默认值；不覆盖 `BLANK_TEXT` 或 `NULL_VALUE`。
- `DEFAULT`：始终使用 Registry 已批准的 scalar；保留默认来源 lineage。null 默认只能表达显式无候选，不能满足 required。
- 默认值不得是表达式、对象、数组、其他列、环境变量、当前时间或用户信息。

## 9. 类型转换

| 目标类型 | V1 接受 | 明确拒绝 |
| --- | --- | --- |
| TEXT | TEXT；NFC + 首尾 trim，原值保留 | NUMBER/BOOLEAN/DATE 展示值、FORMULA cache、ERROR |
| INTEGER | 原生 NUMBER 且有限/安全整数；或无前导零的 ASCII 整数字符串 | `00123`、小数截断、千分位、单位文本、科学计数、超安全范围 |
| DECIMAL/NUMBER | 原生 NUMBER 的精确十进制原文；或规范 ASCII 十进制文本，候选保存十进制字符串 | 千分位、百分号、逗号小数点、科学计数、NaN/Infinity |
| BOOLEAN | 原生 BOOLEAN；trim 后 ASCII `true`/`false`（大小写不敏感） | 0/1、是/否、真假、任意近似文本 |
| DATE | 已成功解释的 DATE cell；或严格 `YYYY-MM-DD` CSV/TEXT 且为真实日历日期 | 未解释 Excel NUMBER、locale 日期、时间戳、FORMULA cache |
| FORMULA | 不执行；V1 不使用 cached value | cached value 作为业务候选 |
| ERROR | 无候选并生成 ERROR | 任何静默转换 |
| EMPTY | 按值状态/默认规则处理 | 压成空字符串 |

`"00123" -> TEXT` 保持 `00123`；`"00123" -> NUMBER/INTEGER` 返回 `NORMALIZATION_NUMBER_INVALID`，避免静默丢失身份语义。负数仅在目标约束允许时通过；`SHELF_LIFE_DAYS` 还要求非负。

## 10. 基础字段规则

| 目标 | 类型/候选 | 最大长度 | 空值/默认 | Issue 与 Draft 阻断 |
| --- | --- | ---: | --- | --- |
| `STANDARD_NAME` | TEXT, trim | 500 | required；允许默认 | 缺失/空/超长 ERROR；阻断 |
| `UNIT` | TEXT, trim | 64 | required；允许默认 | 缺失/空/超长 ERROR；阻断 |
| `BRAND` | TEXT, trim | 200 | optional；允许默认 | 空值不报错；超长 ERROR；未知占位 WARNING；ERROR 阻断 |
| `MANUFACTURER` | TEXT, trim | 200 | optional；允许默认 | 超长 ERROR；阻断 |
| `MANUFACTURER_PART_NUMBER` | TEXT, trim | 255 | optional；允许默认 | 超长 ERROR；阻断 |
| `PURCHASE_TYPE` | ENUM | 64 | optional；允许默认 | allowlist `PURCHASE/OUTSOURCE/SELF_MADE/NON_PURCHASABLE`；非法 ERROR |
| `INVENTORY_TYPE` | ENUM | 64 | optional；允许默认 | `STOCKED/NON_STOCKED/CONSIGNMENT`；非法 ERROR |
| `LOT_CONTROL` | BOOLEAN | - | optional；允许默认 | 非受控 Boolean ERROR |
| `SHELF_LIFE_DAYS` | INTEGER | - | optional/null；允许默认 | 非安全整数或负数 ERROR |
| `INSPECTION_TYPE` | ENUM | 64 | optional；允许默认 | `NONE/NORMAL/TIGHTENED/REDUCED/FULL`；非法 ERROR |
| `ENVIRONMENTAL_REQUIREMENT` | ENUM | 64 | optional；允许默认 | `UNSPECIFIED/ROHS/ROHS_REACH/HALOGEN_FREE/CUSTOMER_SPECIFIC`；非法 ERROR |

所有 enum 按稳定 code 精确匹配，不按显示名或近似值猜测。Normalization 不填充 Draft 服务当前默认值；缺失仍作为缺失候选留给后续明确政策。

特殊文本上限：`CATEGORY_HINT` 500；供应商名称 255、料号 255、物料名称 500、规格 2,000、采购单位 64。超限为 ERROR 且不截断候选，API 安全文案不回显完整原值。

## 11. 动态属性

目标身份为 `attribute.<STABLE_CODE>`。只使用 run 启动时绑定并由 digest 保护的 Snapshot：`value_type`、`unit_policy`、`allowed_units`、`enabled/selectable`、default policy、enum、scale 和 normalization rule。不读取 seed、不暴露 `attribute_id`、不猜类别、不以 `category_hint` 限制属性集合。

- V1 没有 `attribute_unit.<CODE>` Mapping；固定 canonical unit 由 Snapshot 提供并写入候选 lineage。
- 不从 `"10 mm"` 自由文本拆值/单位，不执行单位换算。
- Snapshot 声明 `CANONICAL` 时，当前 Mapping 契约已经明确提供唯一 canonical unit，候选使用该单位；缺少或不在 `allowed_units` 的 Snapshot 在启动/发布新鲜度校验中 fail closed，分别形成 `NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED` 或 `NORMALIZATION_ATTRIBUTE_UNIT_INVALID`，不得猜测单位。
- `FORBIDDEN/NOT_APPLICABLE` 不写 unit；默认值仍只能是 scalar，不能自带对象单位。
- 禁用/不存在属性：`NORMALIZATION_ATTRIBUTE_DISABLED` ERROR；metadata digest 变化：run 不得发布。

## 12. Issue 与行状态

稳定 issue code 至少包括：

`NORMALIZATION_REQUIRED_VALUE_MISSING`、`NORMALIZATION_BLANK_VALUE`、`NORMALIZATION_TYPE_MISMATCH`、`NORMALIZATION_ENUM_INVALID`、`NORMALIZATION_NUMBER_INVALID`、`NORMALIZATION_INTEGER_REQUIRED`、`NORMALIZATION_BOOLEAN_INVALID`、`NORMALIZATION_DATE_INVALID`、`NORMALIZATION_FORMULA_NOT_EXECUTED`、`NORMALIZATION_SOURCE_ERROR_CELL`、`NORMALIZATION_TEXT_TOO_LONG`、`NORMALIZATION_DEFAULT_INVALID`、`NORMALIZATION_ATTRIBUTE_DISABLED`、`NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED`、`NORMALIZATION_ATTRIBUTE_UNIT_INVALID`、`NORMALIZATION_MAPPING_STALE`、`NORMALIZATION_METADATA_CHANGED`、`NORMALIZATION_ROW_TOO_LARGE`、`NORMALIZATION_ISSUE_LIMIT_EXCEEDED`、`NORMALIZATION_INTERNAL_ERROR`。

每条 issue 含 source sheet/row、可空 source column、target code、level 和安全中文消息。行级问题使用保留目标 `row.__ROW__`，target code 不为空。`safe_details_json` 只允许期望类型、最大长度、合法枚举/单位等安全元数据。单行达到 19 条明细后，若仍有问题，停止继续累积并以第 20 条 `NORMALIZATION_ISSUE_LIMIT_EXCEEDED` ERROR 表示截断；计数只表示已持久化问题，避免声称未计算规则已完整通过。

行状态：任一 ERROR -> `ERROR`；无 ERROR 且有 WARNING -> `WARNING`；否则 `VALID`。批次汇总只读已发布 run 的持久计数，不由浏览器重算。

## 13. Validation Service 边界

采用受控方案：Normalization 只运行其确定性 Mapping/类型/格式规则，不调用 `validateForCreate`、`validateForReview` 或 Material Draft 写服务。原因是当前 Material Validation 输入必须有真实 `category_id`，完整调用会伪造分类和叶子属性校验结果。

输出明确分三类：

- `Normalization Issue`：本阶段已执行并持久化的 ERROR/WARNING；
- `Material Validation Issue`：本阶段为空，因为服务没有运行；
- `Deferred Validation`：至少 `CATEGORY_ASSIGNMENT_REQUIRED`、`CATEGORY_BOUND_ATTRIBUTE_VALIDATION_REQUIRED`、`MATERIAL_VALIDATION_NOT_RUN`。

后续分类确认后必须构造真实 Draft DTO，再调用 Material Validation；未执行规则不得显示为通过。

## 14. 资源限制与分块（全部 PROPOSED）

| 项目 | 建议上限 |
| --- | ---: |
| 单批源行 | 50,000 |
| 单行 canonical payload | 262,144 bytes |
| 单批 payload 总量 | 268,435,456 bytes（256 MiB） |
| 每行持久 issue | 20 |
| 单批 issue 详情 | 200,000 |
| 单次逻辑行块 | 最多 100 行，且受 5 MiB 输入/输出预算约束 |
| 单条 SQL 绑定参数 | 小于平台 100；实现按列数计算，不固定 100 行 INSERT |
| 单次 D1 batch | 最多 50 条语句并以实测时延/30 秒限制收紧 |
| Worker 时间片 | 每约 10 秒或 100 行保存 heartbeat/checkpoint；单消息不承诺完整批次 |
| isolate 内存目标 | 64 MiB 工作集；不同时加载全批或全 issue |

超过行/批/issue 硬限制令 run `FAILED`，返回 `IMPORT_NORMALIZATION_LIMIT_EXCEEDED`；单行过大产生行级 `NORMALIZATION_ROW_TOO_LARGE`，保存最小错误 payload，仍可完成批次，但批次总预算不得突破。实施前必须用 1k/10k/50k 脱敏数据验证存储、读写计费、时延和清理成本。

## 15. 原子发布

进入发布事务前核验：有效租约；batch/current version；current parse run；Mapping 仍为 CONFIRMED 且 id/version 未变；metadata digest 未变；目标行全部处理；唯一位置无缺口/重复；行数、状态计数、issue 计数、JSON 字节和 result digest 一致；资源上限未超；取消标记不存在。`result_digest` 按 `(sheet_index,row_number,normalized_payload_hash,row_status,error_count,warning_count)` 升序投影及同序 issue 摘要计算 canonical SHA-256。

单一 D1 batch 事务原子执行：

1. run `STAGED -> PUBLISHING -> SUCCEEDED`（可在同一批事务的受控 CAS 中完成）；
2. 旧 current successful run（若有）转 `SUPERSEDED`；
3. 切换 `batch.current_normalization_run_id`；
4. batch 转 `NORMALIZED` 且 `current_version + 1`；
5. 写 `NORMALIZATION_PUBLISHED` 事件；
6. 写 API/系统审计；
7. 完成幂等结果。

任一语句失败整体回滚。失败/中断/旧租约/取消竞争不得切换 pointer。历史行和 issue 不在发布事务中复制或覆盖。

## 16. 重放、重新运行与取消

- Queue/块重放：同一 hash 幂等；不同 hash fail closed。
- 租约接管：递增 attempt，旧 token 失效；从未完成块继续，已完成块只校验不覆盖。
- HTTP 幂等：同 username/route/key/request digest 返回同一 202 操作；同 key 异请求返回 `IDEMPOTENCY_CONFLICT`。
- 业务重新运行：只允许 `NORMALIZED` 使用不同 `processor_version` 和非空 `rerun_reason` 创建新 run；相同版本不创建重复历史。
- Mapping、parse pointer 或 metadata 变化后，旧 run 可以留存但不得发布；新事实需要新 Mapping/新 run。
- 首次运行的 `QUEUED_FOR_NORMALIZATION/NORMALIZING` 可协作式取消并把批次置 `CANCELLED`；若已有旧 current result 的重新运行被取消，则恢复 `NORMALIZED` 并保留旧 pointer。
- 已稳定发布且无活跃 rerun 的 `NORMALIZED` 不允许取消；取消不是回滚导入，也不立即杀死 Worker/Queue 消息。
- 取消 CAS 胜出后 run 转 `CANCELLED`、租约清空、写事件；未发布暂存结果由可恢复清理任务删除。清理失败记录安全事件并可重试，不恢复发布资格。

## 17. API 契约摘要

完整草案见 `material-import-normalization-v1.openapi.yaml`。

| Method | Path | 语义 |
| --- | --- | --- |
| POST | `/api/material-master/import-batches/{batchId}/normalize` | 绑定版本并异步启动，返回 202 |
| GET | `/api/material-master/import-batches/{batchId}/normalization` | 当前发布结果 + 活跃/最近 attempt 汇总 |
| GET | `/api/material-master/import-batches/{batchId}/normalized-rows` | current run 行摘要，有界 cursor 分页/状态筛选 |
| GET | `/api/material-master/import-batches/{batchId}/normalized-rows/{rowId}` | current run 单行有界 payload |
| GET | `/api/material-master/import-batches/{batchId}/normalization-issues` | current run issue cursor 分页与 allowlist 筛选 |

POST 要求会话、`material.import.normalize`、批次可见、CSRF、`Idempotency-Key`、`expected_version`、`processor_version`、限流和 CAS。隐藏批次始终 404；可见但无能力 403。GET 要求 `material.import.read` 加 owner，或 `material.import.read_any`；不提供历史 run 无界枚举。

取消复用既有 `POST /api/material-master/import-batches/{batchId}/cancel`，未来 `0006` 只扩展其状态/CAS/Normalization run 协作语义；本草案不新增第二个取消路由。

列表默认 `limit=50`、最大 100，cursor 为摘要保护的不透明单向游标。允许筛选：rows 的 `row_status`；issues 的 `issue_level/issue_code/target_code/source_row_number`。任意未列参数返回 `IMPORT_NORMALIZATION_QUERY_INVALID`。响应 `Cache-Control: private, no-store`。

稳定 API 错误：`IMPORT_NORMALIZATION_NOT_ALLOWED`、`IMPORT_NORMALIZATION_ALREADY_RUNNING`、`IMPORT_NORMALIZATION_FAILED`、`IMPORT_NORMALIZATION_LIMIT_EXCEEDED`、`IMPORT_NORMALIZATION_MAPPING_STALE`、`IMPORT_NORMALIZATION_METADATA_CHANGED`、`IMPORT_NORMALIZATION_VERSION_CONFLICT`、`IMPORT_NORMALIZATION_CANCELLED`、`IMPORT_NORMALIZED_ROW_NOT_FOUND`、`IMPORT_NORMALIZATION_QUERY_INVALID`、`IMPORT_BATCH_NOT_FOUND`、`AUTH_REQUIRED`、`FORBIDDEN`、`CSRF_INVALID`、`IDEMPOTENCY_KEY_REQUIRED`、`IDEMPOTENCY_CONFLICT`、`RATE_LIMITED`、`INTERNAL_ERROR`。

统一错误为 `{ "error": { "code", "message", "request_id", "details": [] } }`；不返回 SQL、堆栈、原始敏感行、对象存储信息或内部凭证。

## 18. 权限与审计

新增能力 `material.import.normalize`。它不由 `read_any` 自动推导，也不按角色名在代码中硬编码。建议由权限配置显式授予受训导入操作者/物料管理员；最终角色映射仍为 `PROPOSED`。

启动、取消、发布、失败、限流和安全拒绝记录操作者/系统、动作、batch/run、结果、request id、时间和安全码；不记录 Idempotency key、CSRF、lease token、原始 payload 或完整 source value。

## 19. `0006` Migration 设计（不创建）

### 19.1 Up

1. 建立恢复快照并在一次性 D1 只读核对 `0005` 基线。
2. 创建 `material_import_normalization_runs/normalized_rows/normalization_issues`。
3. 重建 `material_import_batches`：扩展状态 CHECK，增加可空 `current_normalization_run_id` FK，扩展 current parse run CHECK 以覆盖新状态；已有 `MAPPING_CONFIRMED` 原样复制且 pointer 为 null。
4. 重建 `material_import_job_outbox`：`parse_run_id` 改可空、增加 `normalization_run_id`、主体恰一非空 CHECK、扩展 job type；保留全部 Parser 行。
5. 重建 `material_import_events` CHECK，增加排队/开始/发布/失败/取消/清理事件及新状态。
6. 增加 Drizzle 表、关系、CHECK、FK、索引和 snapshot/journal；不改 `0004/0005`。

### 19.2 索引与真实查询

- runs `(batch_id, run_status, id)`：批次进度/最近 attempt；partial unique active：并发启动。
- runs `(run_status, lease_expires_at, id)`：过期租约接管。
- runs `(detail_retention_until, id)`：只扫描到期且非 current 的历史详情清理候选。
- rows unique `(normalization_run_id, source_sheet_index, source_row_number)`：块幂等。
- rows `(normalization_run_id, row_status, id)`：current rows 分页/状态筛选。
- issues `(normalization_run_id, issue_level, issue_code, id)`：问题队列筛选。
- issues `(normalization_run_id, target_code, id)`：按字段定位。
- issues `(normalized_row_id, id)`：单行详情。
- Outbox 保留 pending 调度索引；分别为 parse subject 与 normalization subject 建 partial unique stage/chunk 索引。

不为没有具体查询的普通列建索引。实施前以 `EXPLAIN QUERY PLAN` 和 1k/10k/50k 数据验证。

### 19.3 Down、重升与失败恢复

Down 为受保护回滚：只有所有 normalization 表为空、所有 batch pointer 为空、没有新状态/新事件/新 Outbox job 时才允许恢复 `0005` 结构，否则 `RAISE(ABORT)`。重升重复执行要么由 migration journal 跳过，要么在空回滚后得到同一 schema/snapshot；不能用 `IF NOT EXISTS` 掩盖漂移。

D1 重建采用 `__new_*`、逐列复制、行数/状态/外键核验、原子 rename；任何失败整体回滚并从快照恢复。禁止在应用启动时迁移或回填生产数据。

## 20. 未来实施最低测试（54 项）

1. MAPPING_CONFIRMED 启动；2. 非法状态；3. 无 normalize 权限；4. 隐藏批次 404；5. 幂等重放；6. 同 key 异请求；7. Queue 重投；8. 租约接管；9. Mapping 变化阻止发布；10. Metadata 变化；11. parse run 变化；12. VALID；13. WARNING；14. ERROR；15. MISSING；16. EMPTY；17. BLANK_TEXT；18. TEXT `00123`；19. NUMBER；20. INTEGER 失败；21. BOOLEAN；22. enum 非法；23. DATE；24. FORMULA 不执行；25. ERROR cell；26. 默认值；27. ignore；28. category_hint；29. supplier_reference；30. 动态属性；31. 禁用属性；32. Snapshot canonical unit 缺失；33. Snapshot unit 非法；34. 超长文本；35. 单行 payload 超限；36. 批次总量超限；37. issue 上限与截断哨兵；38. 分块重放；39. 原子发布；40. 发布前取消；41. 发布竞争；42. 历史 run；43. SUPERSEDED；44. rows 分页；45. issue 筛选；46. 纯文本安全；47. 429；48. 500 安全错误；49. OpenAPI；50. Migration Up/Down/重升；51. 一次性 Miniflare D1；52. 隔离调度器；53. 拒绝生产 URL/远程 binding；54. 现有 440 项 Node 回归。

此外必须运行 lint、全量 test、隔离 API smoke、OpenAPI 引用/操作检查、Drizzle 无漂移、凭证扫描、临时 SQLite self-test/smoke/backup/go-live、`git diff --check` 和 docs-only 范围检查。

## 21. 待确认决定（全部 `Status: PROPOSED`）

以下每项均待项目负责人确认；未确认前不得实施。

### 决定 1：批次状态名称

- Status: PROPOSED
- 可选方案：A. 增加 `QUEUED_FOR_NORMALIZATION/NORMALIZING/NORMALIZED/NORMALIZATION_FAILED`；B. 只增加前三个；C. 完全不扩展批次状态。
- 推荐方案：B。
- 推荐理由：执行失败由 run 精确表达，批次恢复前一稳定业务状态，避免与现有终态 `FAILED` 的清理语义混淆。
- Schema 影响：batches/events CHECK 增加三个状态，不增加 `NORMALIZATION_FAILED`。
- API 影响：summary 从 latest attempt 返回失败，不依赖批次失败状态。
- 服务层影响：失败时根据是否有旧 current run 恢复 `MAPPING_CONFIRMED` 或 `NORMALIZED`。
- 安全影响：减少错误清理或错误隐藏 current result 的风险。
- 性能影响：无显著额外成本。
- 后续分类和匹配影响：只消费 `NORMALIZED + current pointer`，不会误消费失败 run。
- 实施复杂度：中。

### 决定 2：是否新增 normalization runs

- Status: PROPOSED
- 可选方案：A. 独立 runs；B. 把执行字段放入 batch；C. 只依赖 Queue 重试。
- 推荐方案：A。
- 推荐理由：支持租约、heartbeat、attempt、阶段、历史、重跑和 current pointer 原子发布，并与 Parser 模式一致。
- Schema 影响：新增 `material_import_normalization_runs` 和活跃 run 部分唯一索引。
- API 影响：启动返回 run id，summary 返回 current/latest attempt。
- 服务层影响：增加 claim/heartbeat/checkpoint/verify/publish 编排。
- 安全影响：租约只存摘要，失败消息脱敏。
- 性能影响：每批增加少量 run/heartbeat 写入。
- 后续分类和匹配影响：稳定引用具体 published run，支持结果版本化。
- 实施复杂度：中高。

### 决定 3：normalized rows 的存储形态

- Status: PROPOSED
- 可选方案：A. 每行版本化 JSON + 常用关系列；B. 全关系化字段/属性表；C. 整批单一 JSON。
- 推荐方案：A。
- 推荐理由：字段和动态属性可演进，同时避免整批触碰 D1 单行 2 MB 限制，并保留行状态分页能力。
- Schema 影响：新增 rows 表、payload/hash、位置唯一约束和状态索引。
- API 影响：列表返回摘要，详情才返回单行 payload。
- 服务层影响：需要 canonical JSON、hash、字节预算和 schema version 校验。
- 安全影响：payload 含原始派生证据，按原始数据等级保护并有界返回。
- 性能影响：比全关系化少属性写行，比单批 JSON 更易分页；需限制总字节。
- 后续分类和匹配影响：可按 run/row 稳定读取完整候选，后续无需解析数据库列扩展。
- 实施复杂度：中。

### 决定 4：Issue 独立表还是 JSON 内嵌

- Status: PROPOSED
- 可选方案：A. 独立 issue 表；B. 只内嵌 row payload；C. 只存计数。
- 推荐方案：A。
- 推荐理由：支持 level/code/target/row 的服务端筛选、分页、审计和恢复。
- Schema 影响：新增 issues 表、FK 和三类查询索引。
- API 影响：新增有界 issue 列表；row 详情可按 row id 查询关联 issue。
- 服务层影响：分块写 row 与 issue，并核对计数和截断哨兵。
- 安全影响：safe message/details allowlist，不回显完整恶意内容。
- 性能影响：增加写行数和索引成本，但避免扫描/解析所有 row JSON。
- 后续分类和匹配影响：可建立人工处置队列并精确定位阻断字段。
- 实施复杂度：中。

### 决定 5：空值和默认值语义

- Status: PROPOSED
- 可选方案：A. 默认只补 MISSING；B. 补 MISSING/EMPTY；C. 同时覆盖 BLANK_TEXT/null。
- 推荐方案：`SOURCE_WITH_DEFAULT` 补 MISSING/EMPTY，`SOURCE` 不补；BLANK_TEXT/null 不覆盖。
- 推荐理由：兼容已批准 Mapping 语义，又不掩盖用户显式输入的空白文本或 null 默认。
- Schema 影响：payload 冻结五种 value state，无额外业务列。
- API 影响：详情展示 source kind/value state；preview/normalize 必须一致。
- 服务层影响：统一 cell state 分类器和 default resolver。
- 安全影响：禁止默认表达式、跨列、环境/时间/用户引用。
- 性能影响：常量级判断。
- 后续分类和匹配影响：能区分缺失事实与显式空值，避免错误置信度。
- 实施复杂度：低。

### 决定 6：TEXT trim 策略

- Status: PROPOSED
- 可选方案：A. 不 trim；B. 全部候选边缘 trim；C. 每个目标单独配置。
- 推荐方案：B，先 NFC 再首尾 trim，内部空白不折叠，原值完整保留。
- 推荐理由：确定、locale 无关，满足当前 standard name/unit 校验，同时保持证据可追溯。
- Schema 影响：source raw 与 candidate 分离，不改关系字段。
- API 影响：详情同时返回原值与候选。
- 服务层影响：所有 TEXT 走同一纯函数。
- 安全影响：不执行 HTML/公式；文本仍按纯文本输出。
- 性能影响：线性于文本长度，受单字段上限约束。
- 后续分类和匹配影响：减少边缘空白造成的虚假差异，不做可能改变语义的内部清洗。
- 实施复杂度：低。

### 决定 7：NUMBER 转换范围

- Status: PROPOSED
- 可选方案：A. 只接受 NUMBER cell；B. 再接受规范 ASCII 十进制文本；C. 宽松 locale/千分位/科学计数/百分号。
- 推荐方案：B；拒绝前导零、千分位、科学计数、百分号和 locale 小数点。
- 推荐理由：CSV 可用且转换确定；`00123` 不会静默丢失身份语义。
- Schema 影响：DECIMAL candidate 使用精确十进制字符串，INTEGER 使用安全整数。
- API 影响：失败返回稳定 number/integer issue。
- 服务层影响：实现完整匹配的 ASCII grammar 和精度/范围检查。
- 安全影响：不调用 locale parser 或执行表达式。
- 性能影响：有界正则/解析，成本低。
- 后续分类和匹配影响：数值候选可比较，同时原始格式仍可审计。
- 实施复杂度：中。

### 决定 8：BOOLEAN 接受值

- Status: PROPOSED
- 可选方案：A. 只原生 BOOLEAN；B. 原生加 ASCII true/false；C. 再接受 0/1、是/否、真假等。
- 推荐方案：B，ASCII 文本 trim 后大小写不敏感。
- 推荐理由：支持 CSV 的明确布尔文本而不引入本地化猜测。
- Schema 影响：candidate 为原生 boolean。
- API 影响：非法值返回 `NORMALIZATION_BOOLEAN_INVALID`。
- 服务层影响：固定 allowlist 转换器。
- 安全影响：不把任意非空文本当 true。
- 性能影响：可忽略。
- 后续分类和匹配影响：布尔语义稳定，无“未知文本已转换”歧义。
- 实施复杂度：低。

### 决定 9：DATE 转换范围

- Status: PROPOSED
- 可选方案：A. 只接受成功解释的 DATE cell；B. 加严格 ISO date 文本；C. 支持 Excel NUMBER/locale/时间戳猜测。
- 推荐方案：B，只加真实日历 `YYYY-MM-DD`。
- 推荐理由：兼容 CSV，避免 Excel epoch、locale 和时区歧义。
- Schema 影响：candidate 为 ISO date string，source 保留 date system/原值。
- API 影响：非法日期返回 `NORMALIZATION_DATE_INVALID`。
- 服务层影响：严格日历校验，不使用宿主 locale。
- 安全影响：不执行公式或信任展示值。
- 性能影响：常量级。
- 后续分类和匹配影响：日期可稳定排序/比较，不携带隐含时区。
- 实施复杂度：中。

### 决定 10：FORMULA cached value

- Status: PROPOSED
- 可选方案：A. 直接使用；B. WARNING 后使用；C. V1 完全不作为候选。
- 推荐方案：C。
- 推荐理由：cache 可能陈旧，公式可能引用外部/未计算上下文；Mapping confirm 不等于认可计算结果。
- Schema 影响：source 仍可记录 FORMULA 元数据，candidate 为空。
- API 影响：返回 `NORMALIZATION_FORMULA_NOT_EXECUTED`。
- 服务层影响：禁止公式执行和 cache 转换分支。
- 安全影响：消除公式注入、外部引用和不可信计算结果进入候选的路径。
- 性能影响：减少计算和依赖。
- 后续分类和匹配影响：需要用户先把可信结果固化为值，证据更可靠。
- 实施复杂度：低。

### 决定 11：动态属性单位处理

- Status: PROPOSED
- 可选方案：A. 使用 Snapshot 唯一 canonical unit；B. 新增独立 unit source column；C. 从 `10 mm` 自由拆分并换算。
- 推荐方案：A。
- 推荐理由：当前 Mapping 没有 `attribute_unit.<CODE>`，Registry 已提供受 digest 保护的 canonical unit；V1 保持确定性。
- Schema 影响：attribute candidate 为 `{value,unit}`，不新增 unit Mapping 目标。
- API 影响：详情显示 canonical unit；Snapshot 缺失/非法时返回稳定 unit issue 并阻止发布。
- 服务层影响：启动/发布核验 unit policy，不做换算或自由拆分。
- 安全影响：防止恶意/模糊单位文本改变数量语义。
- 性能影响：只做 Snapshot 查表和精确匹配。
- 后续分类和匹配影响：单位一致便于比较；可变来源单位需独立设计与迁移。
- 实施复杂度：低。

### 决定 12：Validation Service 调用边界

- Status: PROPOSED
- 可选方案：A. 全推迟；B. 调用部分现有 Material Validation；C. 构造假 Draft 做完整 Validation。
- 推荐方案：Normalization 专属规则 + 显式 Deferred Validation，不调用现有完整服务，接近受控 A。
- 推荐理由：当前服务要求真实 `category_id`，调用 B/C 会耦合内部规则或伪造叶子校验结果。
- Schema 影响：payload 加 `deferred_validation`；Material Validation issue 本阶段为空。
- API 影响：详情明确区分 Normalization issue 与 Deferred Validation。
- 服务层影响：不调用 Draft/Review Validation 入口或 Draft 写服务。
- 安全影响：避免绕过分类确认或虚假“已通过”结论。
- 性能影响：避免每行 category metadata 查询。
- 后续分类和匹配影响：分类确认后必须用真实 DTO 运行完整 Validation。
- 实施复杂度：低。

### 决定 13：Normalization 权限映射

- Status: PROPOSED
- 可选方案：A. 复用 `material.import.map`；B. 复用 `read_any`；C. 新增 `material.import.normalize`。
- 推荐方案：C，角色到 capability 由权限配置决定，不在代码硬编码。
- 推荐理由：规范化是高成本写操作，不能由读取或 Mapping 编辑权限隐式获得。
- Schema 影响：用户权限 JSON/配置增加 capability，无业务表变化。
- API 影响：隐藏批次 404；可见但无 normalize 403。
- 服务层影响：启动/取消重跑均检查能力和行级可见性。
- 安全影响：符合最小权限与职责分离。
- 性能影响：仅增加常量级权限检查。
- 后续分类和匹配影响：不自动授予后续分类/匹配/审核能力。
- 实施复杂度：低。

### 决定 14：允许取消的状态

- Status: PROPOSED
- 可选方案：A. 只 queued；B. queued + running；C. 连稳定 NORMALIZED 也可取消。
- 推荐方案：B，协作式取消；稳定 NORMALIZED 不取消。
- 推荐理由：运行中可安全撤销发布资格，但取消不应伪装成已发布结果回滚。
- Schema 影响：扩展 batch cancel CHECK/event；run 增加 CANCELLED 约束。
- API 影响：复用现有 cancel 路由，要求 expected version/幂等。
- 服务层影响：取消与发布 CAS 竞争；有旧 current rerun 时恢复 NORMALIZED。
- 安全影响：取消胜出后撤销租约，旧消息不得发布。
- 性能影响：未发布暂存结果需后台分块清理。
- 后续分类和匹配影响：已发布 current 仍稳定；真正撤销需独立业务决策。
- 实施复杂度：中。

### 决定 15：资源限制

- Status: PROPOSED
- 可选方案：A. 只依赖平台硬限；B. 固定保守应用限；C. 按环境动态放大。
- 推荐方案：B：50k 行、256 KiB/行、256 MiB/批、20 issue/行、200k issue/批、100 行/5 MiB 逻辑块、50 语句/D1 batch、64 MiB 工作集目标。
- 推荐理由：在 D1 2 MB 行、100 参数、100 KB SQL、30 秒查询限制前留出明确余量。
- Schema 影响：run 保存字节/issue/行汇总，CHECK 非负。
- API 影响：超限使用 `IMPORT_NORMALIZATION_LIMIT_EXCEEDED`；单行过大用行级 issue。
- 服务层影响：每块前后预算检查、checkpoint 和 fail closed。
- 安全影响：限制恶意大行、issue 放大和内存耗尽。
- 性能影响：限制写放大；最终值需 1k/10k/50k 压测后确认。
- 后续分类和匹配影响：分页/批处理边界可复用，但不得把建议值当生产容量承诺。
- 实施复杂度：中。

### 决定 16：已发布结果重新运行策略

- Status: PROPOSED
- 可选方案：A. 覆盖 current rows；B. 同版本任意新 run；C. 只允许新 processor version + reason 创建新 run。
- 推荐方案：C；相同 key/请求只幂等重放，不创建历史。
- 推荐理由：避免不可解释重复与覆盖，保留算法升级证据和原子回退边界。
- Schema 影响：runs 保存 processor version、历史状态和 superseded 关系语义。
- API 影响：POST 在 NORMALIZED 重跑要求不同版本及 `rerun_reason`。
- 服务层影响：旧 pointer 在新 run 发布前持续有效；发布后旧 run 转 SUPERSEDED。
- 安全影响：防止未经说明的结果替换；审计记录 reason/actor 而不记录敏感正文。
- 性能影响：增加历史存储，按 detail retention 清理非 current 详情。
- 后续分类和匹配影响：下游绑定具体 run/hash，不会被后台重跑静默改变。
- 实施复杂度：中。

## 22. 完成与停止条件

本任务只在三份设计文档、项目治理同步、验证和独立提交完成后结束。未创建 `0006`，未修改运行时代码、Schema、API、前端、依赖、R2/Queue/hosting，未连接生产。完成后停止，等待项目负责人回复“规格确认”。
