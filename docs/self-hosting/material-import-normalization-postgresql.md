# 自托管 Material Import Normalization PostgreSQL 设计

适用任务：`SELFHOST-PHASE1-TASK03`

## 边界

本模块把已确认 Mapping 和不可变 Parser 原始行转换为只读候选快照。它不执行人工最终确认、相似物料判断、ACTIVE 绑定、Material Draft 创建、正式编码、生产数据迁移或部署。

权威链路为：

```text
CONFIRMED Mapping snapshot + immutable parser rows
  -> PostgreSQL Outbox/background job
  -> deterministic row normalizer
  -> run-isolated staged rows/candidates/lineage/issues
  -> verification
  -> atomic published pointer
  -> read-only Review UI
```

## PostgreSQL 模型

### `material_import_normalization_runs`

一个批次可有多个 `run_version`。Run 固定引用 `parse_run_id`、`mapping_id`、`mapping_version`、`mapping_digest`、`source_schema_digest`、`metadata_digest`、`mapping_snapshot` 和规则版本。`expected_version` 提供运行级 CAS；`supersedes_run_id` 记录重跑关系。

唯一/并发约束：

- `(batch_id, run_version)` 唯一。
- 一个批次最多一个 QUEUED/RUNNING/PUBLISHING/CANCEL_REQUESTED。
- Mapping、文件、Sheet、用户和 superseded run 使用 restrict 外键。
- published、cancelled、failed 状态分别有一致性 check。
- 行/问题/字节统计非负且相互一致。

### `material_import_normalized_rows`

每个来源行在同一 run 内只有一条结果，稳定引用 `source_row_id`、`source_sheet_id`、Sheet/行号和原始摘要。`normalized_payload` 是兼容 Review UI 的不可变快照；`mapped_values` 不是正式 Material 值。行状态为 VALID/WARNING/ERROR/SKIPPED。

### 核心字段候选

`material_import_normalized_field_candidates` 保存：

- `target_namespace`：basic/category_hint/supplier_reference
- `target_field_code`
- `raw_value` 与 `normalized_value`
- `value_state`
- `validation_status`
- `transformation_rule_code/version`
- `display_order`

同一 run/row/namespace/code 唯一。

### 动态属性候选

`material_import_normalized_attribute_candidates` 保存稳定 `attribute_code`、当时的中文名称快照、数据类型、原值、标准化值、canonical unit、校验状态和规则。长期业务引用不使用易变 attribute id。

### Lineage

`material_import_normalization_lineage` 为每个候选和每个来源列保存独立记录：

- run/row/目标 namespace/code/attribute code
- source Sheet 外键、名称、行、列、列名和标准化源字段 key
- 有界原值/标准化值摘要
- Mapping id/digest
- 规则 code/version 和转换步骤

多列组合产生多个 ordinal，不压扁来源。Lineage 与候选在同一 run 发布边界内，历史 Mapping 状态变化不影响读取。

### Issue

`material_import_normalization_issues` 保存 run、row、ERROR/WARNING、稳定 code、稳定 `issue_key`、目标/属性/来源定位、安全中文说明、安全详情/来源摘要和规则 code。同一 run 的 `issue_key` 唯一，安全重试不会堆积重复问题。

当前确定性业务代码：

| Code | 含义 |
| --- | --- |
| `NORMALIZATION_REQUIRED_VALUE_MISSING` | 必填来源缺失 |
| `NORMALIZATION_BLANK_VALUE` | 必填来源为空白 |
| `NORMALIZATION_TYPE_MISMATCH` | 来源单元格类型不适用 |
| `NORMALIZATION_NUMBER_INVALID` | 十进制格式非法 |
| `NORMALIZATION_INTEGER_REQUIRED` | 不是安全整数 |
| `NORMALIZATION_BOOLEAN_INVALID` | 布尔值非法 |
| `NORMALIZATION_DATE_INVALID` | 日期非法 |
| `NORMALIZATION_ENUM_INVALID` | 枚举值不在允许集合 |
| `NORMALIZATION_TEXT_TOO_LONG` | 文本超过目标上限 |
| `NORMALIZATION_FORMULA_NOT_EXECUTED` | 来源为未执行公式 |
| `NORMALIZATION_SOURCE_ERROR_CELL` | 来源单元格为错误 |
| `NORMALIZATION_DEFAULT_INVALID` | 默认值不符合目标类型 |
| `NORMALIZATION_BRAND_UNKNOWN` | 品牌占位值需人工确认 |
| `NORMALIZATION_ATTRIBUTE_DISABLED` | 动态属性不可用 |
| `NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED` | 属性要求单位但元数据不完整 |
| `NORMALIZATION_ATTRIBUTE_UNIT_INVALID` | 属性单位不兼容 |
| `NORMALIZATION_ROW_TOO_LARGE` | 单行结果超过限制 |
| `NORMALIZATION_ISSUE_LIMIT_EXCEEDED` | 单行问题达到限制 |

运行/接口错误另使用 `IMPORT_NORMALIZATION_*`，包括 Mapping required/stale/invalid、source schema mismatch、version conflict、lease lost、result incomplete 和 publish conflict。

## 确定性规则

- 文本 NFC + trim；缺失、空单元格、空白文本、显式 null 和 present 分开。
- INTEGER 只接受安全整数；DECIMAL 使用严格十进制语法和固定 scale；BOOLEAN 使用旧契约的确定集合；DATE 必须是有效 ISO 日期；ENUM 严格匹配 code。
- Mapping 目标来自服务端动态 Catalog 和 CONFIRMED 不可变快照，不接受客户端目标定义。
- 相同 raw row、Mapping/rule/metadata 产生相同候选和 payload hash；对象键顺序不改变 canonical digest。
- 不调用 AI、外部服务或当前时间决定业务值。
- 不自动做单位换算、同义词改写、分类、模糊匹配或供应商料号纠错。

## 状态机

```text
QUEUED -> RUNNING -> PUBLISHING -> SUCCEEDED -> SUPERSEDED
   |         |           |
   +-------> FAILED <-----+
   |         |
   +-> CANCELLED
             ^
RUNNING/PUBLISHING -> CANCEL_REQUESTED

FAILED -> QUEUED   (同 run retry)
```

非法转换由 Service/Worker 拒绝；数据库状态 check 防止未知值。FAILED 重试增加 attempt/retry count 并清理本 run 暂存，不创建新 run。重跑创建新 run_version；发布成功后旧 current 变 SUPERSEDED。取消是幂等操作，运行中只在安全 checkpoint 或 publication transaction 胜出。

## Worker、租约和原子发布

- Source row keyset chunk 固定 100 行，结果摘要每页 500 行/问题；单运行最多 50,000 行、200,000 issue、256 MiB normalized JSON。
- 每个 chunk 是短事务，先校验 `background_jobs` RUNNING + lease token + lease expiry，再校验 run token；失去租约的旧 Worker 不能写或发布。
- 同 run 重试用唯一位置约束和 replace staging，候选、lineage、issue 先删除后重建，不重复累积。
- 所有行完成后核对来源行数、状态计数、issue 计数和候选-lineage 覆盖，再转 PUBLISHING。
- 普通读取只查询 `published_at IS NOT NULL` 且 SUCCEEDED/SUPERSEDED；暂存表物理有数据也不可见。
- publication callback 在 `BackgroundJobQueue.complete` 的同一 PostgreSQL 事务内完成：lease 校验、旧 current SUPERSEDED、新 run SUCCEEDED/published、批次 pointer/统计、Event/Audit 和 Job SUCCEEDED。
- callback 或 Job CAS 失败时整体回滚，上一已发布 pointer 保持可见。
- 非重试错误强制 Job DEAD 并把 run 标为 FAILED；临时错误按最大尝试次数恢复，租约过期由 recovery 重新排队。

## API 契约

所有响应 `Cache-Control: no-store`、`X-Request-ID`；错误只返回稳定 code、中文安全说明和请求编号。

| Method | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/material-master/import-batches/:batchId/normalize` | 创建 run 或重跑；需 expected_version、processor_version，可指定 confirmed mapping id/reason |
| GET | `/api/material-master/import-batches/:batchId/normalization` | Current、Latest Attempt 和可选已发布 selected run |
| GET | `/api/material-master/import-batches/:batchId/normalization/runs` | run_version keyset 历史，limit 最大 50 |
| GET | `/api/material-master/import-batches/:batchId/normalization/runs/:runId` | 已发布运行摘要 |
| POST | `/api/material-master/import-batches/:batchId/normalization/runs/:runId/retry` | FAILED 同 run 重试 |
| POST | `/api/material-master/import-batches/:batchId/normalization/runs/:runId/cancel` | 取消未完成 run |
| GET | `/api/material-master/import-batches/:batchId/normalized-rows` | 已发布行 keyset 分页，按 run/status/issue level |
| GET | `/api/material-master/import-batches/:batchId/normalized-rows/:rowId` | raw row、payload、两类候选、lineage、issues |
| GET | `/api/material-master/import-batches/:batchId/normalization-issues` | 已发布问题 keyset 分页，按 level/code/target/source row |

POST 必须通过同源/CSRF、`Idempotency-Key`、256 KiB body、正文摘要冲突检查和 expected_version。Cursor 绑定 batch/run/filter scope 并带摘要，最大 2048 字符；Rows/Issues limit 最大 100。

## 权限矩阵

| 操作 | 能力 |
| --- | --- |
| 当前/历史/行/问题/详情 | `material.import.read`；跨创建人读取另需 `material.import.read_any` |
| 创建、重跑、同 run 重试 | `material.import.normalize` |
| 取消 | `material.import.cancel` |
| 管理员 | `*`，但仍需 CSRF、幂等和 CAS |

成功与失败请求均审计；Worker start/publish/fail/cancel 写 Import Event/Audit。审计不保存 token、完整 raw row、Mapping 正文或数据库错误。

## Review UI

沿用 `/materials/imports/:batchId` 七步工作区和 URL 查询参数。UI 展示：

- Latest 进度与 Current published 双轨；
- 运行历史切换；
- VALID/WARNING/ERROR/SKIPPED 行分页；
- ERROR/WARNING、code、target、来源行问题筛选；
- Drawer 分开显示不可变 raw row、核心候选、动态属性、category/supplier 候选和关系化 lineage；
- 同运行重试、重跑理由和取消确认。

UI 不保存人工候选修改，不创建 Draft，不绑定 ACTIVE。

## Migration 与恢复

`0004_material_import_normalization.sql`：

- 从 `0003` 升级现有占位 run/row/issue，回填 source file/sheet/row、run version、Mapping snapshot、published time、issue count 和 normalized bytes。
- 新建候选和 lineage 表，增加外键、唯一/部分索引、状态/计数/JSONB 大小约束和已发布结果不可变 trigger。
- 支持空库通过 `0001 -> 0004`，也支持已有 `0003` 数据升级；migration runner 以版本+checksum 防重复/漂移。
- 生产执行前仍必须另行授权、快照、只读试迁移、记录数/孤儿/摘要核对和恢复演练。本任务未执行生产迁移。

## Compose 隔离验收步骤

1. 使用 `ERP_ENV=test`、名称含 test 的 PostgreSQL URL 和独立 Compose project/volumes。
2. `docker compose up -d --build postgres migrate web worker`。
3. tools profile 初始化显式测试管理员。
4. `node scripts/selfhost-compose-smoke.mjs` 执行登录、CSV、Parse、Mapping、Normalization、筛选、详情、lineage、重跑、取消、结构漂移和 Material 不变检查。
5. 整栈 stop/up，执行 `node scripts/selfhost-normalization-restart-smoke.mjs`。
6. `docker compose down -v --remove-orphans` 并核对容器、网络、卷为空。

脚本在连接前拒绝非 test 环境；不得把示例凭证或测试 URL用于生产。
