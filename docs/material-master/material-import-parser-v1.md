# Material Import Excel/CSV Parser V1 规格

状态：`APPROVED / PHASE2-TASK04 IMPLEMENTED IN NON-PRODUCTION`

业务与资源决定：`Status: APPROVED`

任务：`PHASE2-TASK03`（设计）/ `PHASE2-TASK04`（实施）

## 1. 目的与范围

本规格定义 Material Import Batch 从 `FILE_READY` 到结构化原始行、可恢复的 Mapping 准备以及 `AWAITING_MAPPING` 的服务端边界。它补充既有 `material-import-batch-v1.md`，不替代 `0004_material_import_batch_foundation.sql`，也不改变已实现的上传、安全检查、对象存储和批次可见性行为。

`PHASE2-TASK04` 已在非生产代码中实现 Parser、OOXML/CSV 适配器、`0005`、Drizzle schema、Outbox/可注入调度、Mapping 准备与 API。仍不在本任务范围：

- 生产 Queue、Cron、R2 binding、hosting 或部署配置；
- 前端、清洗、AI、自动分类、候选匹配、Material Draft 或正式物料写入；
- 生产 D1/R2、生产数据、生产 migration、部署或权限变更。

## 2. 已核验基线

- `0004` 当前批次状态只包含 `CREATED`、`UPLOAD_PENDING`、`FILE_READY`、`RECONCILIATION_REQUIRED`、`FAILED`、`CANCELLED`。
- `material_import_rows` 当前以 `(batch_id, sheet_index, row_number)` 唯一，且当前运行时代码尚不写入该表。
- 当前对象存储接口支持有界 `open(key, range?)`，可作为后续 R2 Range 与流式读取边界。
- 当前文件级安全检查已经限制 ZIP 条目、展开大小、压缩比、宏、加密、路径和 CSV 基础编码风险，但尚未解析 workbook、Sheet 或业务行。
- `.openai/hosting.json` 仍无生产 R2 binding；生产 Queue、Cron、migration 和部署均未获授权。

## 3. 核心语义

### 3.1 业务状态机

```text
FILE_READY
  -> QUEUED_FOR_PARSING
  -> PARSING
  -> PARSED
  -> AWAITING_MAPPING
  -> MAPPING_CONFIRMED
```

`PARSED` 是持久恢复检查点，精确定义为：

> 当前 Parser 策略允许解析的全部可见 Sheet，其指定 `parse_run` 的原始行、Sheet 元数据及解析汇总已经完整写入，并通过一次原子发布切换为当前有效解析结果。

由于隐藏和 very-hidden Sheet 不写入业务行，`PARSED` 不表示整个工作簿所有 Sheet 的每一行都已写入。

进入 `PARSED` 前必须同时满足：

1. 所有允许 Sheet 已完成；
2. 原始行、行数、Sheet 汇总和 `raw_row_hash` 已核对；
3. 总字节与存储预算核对通过；
4. `parse_run` 已从 `STAGED` 原子发布为 `SUCCEEDED`；
5. `current_parse_run_id` 已通过批次版本 CAS 切换；
6. 旧有效 run 已转为 `SUPERSEDED`；
7. 业务事件、审计和幂等结果已在同一 D1 事务写入；
8. 不存在部分发布的行集。

`AWAITING_MAPPING` 表示默认 Sheet 建议、`header_row` 候选、基础表头分析和 Mapping 初始化信息已准备完成。Mapping 准备失败时批次保持 `PARSED`，原始行不重写，使用 `IMPORT_MAPPING_PREPARATION_FAILED` 记录安全失败信息。

### 3.2 执行状态与业务状态分离

批次状态用于用户可见业务进度；`parse_run` 和 Outbox 用于至少一次任务执行、租约、重试、阶段检查点与可靠调度。不得把 Queue 投递状态、Worker 心跳或任务尝试次数塞入批次状态。

## 4. 方案比较与推荐

### 4.1 解析方案

| 方案 | 内容 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A | `@zip.js/zip.js@2.8.26` + `sax-wasm@3.1.4` + 受限 OOXML 适配层；CSV 使用 `csv-parse@7.0.1` browser ESM | Web Streams、有界读取、保留原始类型、可按 Sheet 恢复 | 不是完整 Excel 引擎；真实生产并发、远程配额和冷启动尚未验证 | `APPROVED / IMPLEMENTED` |
| B | SheetJS 整本读取 | Excel 语义成熟，实施较快 | 读取过程通常需要整文件/工作簿驻留，压缩 XLSX 峰值内存不可控 | 仅保留为严格小文件降级研究候选；V1 不维护第二条生产路径 |
| C | 外部容器解析服务 | 格式覆盖和资源弹性较强 | 新增服务、凭证、网络、隐私和运维边界 | 不采用 |

`zip.js` 是 ZIP/Web Streams 工具，不是 Excel 解析引擎；`sax-wasm` 是 XML 流式解析器，不是 OOXML 语义引擎；OOXML workbook、relationships、styles、shared strings 和 worksheet 语义必须由受限适配层实现。`csv-parse` 的 browser ESM 也不等于已经通过 Workers 验证。

参考资料：[`zip.js` 官方文档](https://gildas-lormeau.github.io/zip.js/)、[`sax-wasm` 官方仓库](https://github.com/justinwilaby/sax-wasm)、[`csv-parse` browser ESM](https://csv.js.org/parse/distributions/browser_esm/)、[SheetJS 大数据读取说明](https://docs.sheetjs.com/docs/demos/bigdata/stream/)。实际依赖版本、许可证文本、维护状态和供应链风险必须在实施任务锁定依赖时重新核验。

### 4.2 实施前兼容性门禁

方案 A 已通过下列本机隔离矩阵并进入非生产实现；进入生产仍需真实远程环境、并发容量与基础设施审批：

| 验证项 | 最低通过标准 |
| --- | --- |
| Vinext 构建 | production build 无 Node 文件系统或动态执行依赖；产物可追溯 |
| Miniflare | 隔离测试中可加载解析模块并处理代表性文件 |
| Workers Web Streams | 支持背压、取消、异常关闭和资源释放 |
| WASM 加载 | 部署形态、初始化方式和并发实例行为通过测试 |
| R2 Range | 范围、边界、短读、对象变化和读取失败行为确定 |
| ZIP 条目流 | 不将整个压缩包或所有展开条目常驻内存 |
| XML 流 | 跨 chunk token、UTF-8 边界、损坏 XML 和深度限制通过 |
| CSV 分块 | 引号内换行、转义、BOM、编码边界和尾随空列通过 |
| Bundle | 依赖与 WASM 大小在部署限制和冷启动预算内 |
| 峰值内存 | 单任务及低并发压力下均不越过批准预算 |
| 中断释放 | stream reader、WASM、缓存和临时对象在失败/取消时释放 |

未通过任一门禁时，不得以“文档已推荐”为由进入生产；必须调整库、适配层或资源上限，并重新审批。

## 5. 异步调度与可靠投递

### 5.1 不在上传请求中解析

`POST /api/material-master/import-batches/{batchId}/parse` 只负责认证、授权、CSRF、幂等、限流和 D1 CAS。成功后返回 `202 Accepted`，不得下载文件、解析业务行或等待整个 workbook 完成。

### 5.2 Outbox 边界

D1 事务与 Cloudflare Queue 发送之间不存在分布式事务，禁止描述为“创建 `parse_run` 并原子发送 Queue 消息”。推荐新增 `material_import_job_outbox`：

| 字段 | 约束与语义 |
| --- | --- |
| `id` | 服务端稳定 job id，主键 |
| `batch_id` | FK，任务所属批次 |
| `parse_run_id` | FK，任务绑定 run |
| `job_type` | allowlist：七个持久阶段之一 |
| `payload_version` | 正整数，任务载荷契约版本 |
| `dispatch_status` | `PENDING`,`DISPATCHING`,`DISPATCHED`,`RETRY_WAIT`,`DEAD` |
| `attempt_count` | 非负整数 |
| `available_at` | 下次可调度时间 |
| `last_attempt_at` | 最近发送尝试时间，可空 |
| `safe_failure_code` | 稳定安全码，不含内部异常 |
| `created_at`,`dispatched_at` | UTC 时间；`dispatched_at` 可空 |

可靠流程：

1. D1 事务创建 `parse_run`、写 `PENDING` Outbox、批次 CAS 至 `QUEUED_FOR_PARSING`、写事件及幂等结果；
2. 提交后调度适配器尝试发送；
3. 明确成功后以 Outbox 版本 CAS 标记 `DISPATCHED`；
4. 发送结果未知时协调器重试，允许重复消息；
5. 消费者以 `job_id + parse_run_id + stage` 吸收重复；
6. 每个阶段完成后，在保存下一阶段 Outbox 后才确认当前 Queue 消息。

下一阶段发送失败不得丢失已经完成的解析阶段。代码已提供 Cloudflare Queue 适配器和 D1 Outbox dispatcher，但没有创建 binding 或生产 Queue；真实基础设施仍需独立授权。Queue 至少一次投递要求见 [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)。

### 5.3 Queue 与租约建议

- Parser consumer `max_batch_size = 1`，已批准为部署配置要求；本任务未创建生产 Queue 配置；
- 消费者并发从低值开始，通过脱敏大文件压测决定；
- 同一批次同一时刻只允许一个有效执行租约；
- 单个 consumer 不并发解析多个大型 XLSX；
- 只有任务持久状态、Outbox 和检查点已安全保存后才显式 ack；
- isolate 内存由并发任务共享，64 MiB 是应用目标，不是单消息独占或安全保证。

## 6. 持久任务阶段与恢复

V1 使用以下持久阶段：

1. `INSPECT_WORKBOOK`
2. `PREPARE_SHARED_RESOURCES`
3. `PARSE_SHEET`
4. `VERIFY_PARSE_RUN`
5. `PUBLISH_PARSE_RUN`
6. `PREPARE_MAPPING`
7. `PUBLISH_MAPPING_PREPARATION`

每个 `PARSE_SHEET` 任务至少绑定 `batch_id`、`parse_run_id`、`sheet_index`、`parser_version`、`job_id` 和 `lease_token`。

V1 以 Sheet 为真正恢复边界。每 500 行或约 10 秒进行预算检查、保存统计/心跳和幂等写入进度，但该检查点不表示可从下一行恢复 ZIP 解压、SAX 状态、Shared Strings 或 XML 上下文。中断后允许从头重跑当前未完成 Sheet；已标记完成的其他 Sheet不得重写。

只有未来实现并验证可序列化解析游标，才能把行级检查点升级为真正断点续传。不得在 V1 文档或 UI 宣称已经具备行级续传。

### 6.1 `material_import_parse_runs`

建议字段：

- 身份：`id`、`batch_id`、`parser_version`、`attempt_no`、`source_file_sha256`；
- 状态：`run_status`，值为 `QUEUED`,`RUNNING`,`STAGED`,`PUBLISHING`,`SUCCEEDED`,`FAILED`,`CANCELLED`,`SUPERSEDED`；
- 租约：`lease_token_digest`、`lease_expires_at`、`heartbeat_at`、`worker_request_id`；
- 时间：`started_at`、`completed_at`；
- 结果：`rows_written`、`parsed_sheet_count`、`normalized_json_bytes`、`decoded_text_bytes`、`warning_count`、`error_count`；
- 失败：`failure_code`、`safe_failure_message`；
- Mapping 准备：`mapping_preparation_status`、`mapping_preparation_attempt_count`、`mapping_preparation_failure_code`、`mapping_preparation_safe_message`、`mapping_preparation_updated_at`。

`mapping_preparation_status` 值为 `NOT_STARTED`,`QUEUED`,`RUNNING`,`READY`,`FAILED`。它不改变已经完成的 `run_status = SUCCEEDED`。

### 6.2 活跃 run 唯一性

不得限制同一 `(batch_id, parser_version)` 历史上只能有一条 run。失败、取消或被替代后允许创建新 run。

约束目标是：同一批次同一时刻最多一个状态为 `QUEUED`,`RUNNING`,`STAGED`,`PUBLISHING` 的活跃 run。`0005` 实施时评估 D1/SQLite 部分唯一索引；若兼容性或迁移复杂度不接受，则以批次 `current_version` CAS、事务内活跃计数检查和明确索引实现等价服务层约束。

## 7. Parser 可注入接口

概念输入：

```json
{
  "batch_id": "batch-id",
  "parse_run_id": "run-id",
  "file_reference": "opaque-object-reference",
  "original_filename": "materials.xlsx",
  "detected_file_type": "XLSX",
  "file_sha256": "sha256-hex",
  "parser_version": "xlsx-v1",
  "stage": "PARSE_SHEET",
  "sheet_index": 0,
  "lease_token": "opaque"
}
```

概念输出：

```json
{
  "batch_id": "batch-id",
  "parse_run_id": "run-id",
  "parser_version": "xlsx-v1",
  "workbook_metadata": {},
  "sheets": [],
  "row_count": 1200,
  "warning_count": 2,
  "error_count": 0,
  "warnings": [],
  "errors": []
}
```

接口不得直接写正式物料、创建 Draft、调用 AI、执行公式、覆盖原文件或发布未核验结果。Repository 可分片写入 run 隔离行，但只有发布事务可以改变当前有效解析结果。

## 8. XLSX 解析契约

### 8.1 Workbook 与 Sheet

- 按 workbook 顺序生成从 0 开始的稳定 `sheet_index`；`sheet_name` 必须非空。
- 重复 Sheet 名称视为 `IMPORT_PARSE_INVALID_XLSX`，不依靠名称定位。
- 保存 `VISIBLE`、`HIDDEN`、`VERY_HIDDEN` 可见性。
- 只解析全部可见 Sheet；隐藏和 very-hidden Sheet 只保存安全元数据、警告和跳过计数，不写业务行、不能用于 Mapping。
- 保存 `1900` 或 `1904` 日期系统；无效或矛盾配置产生结构化错误。
- 空的可见 Sheet 保存 Sheet 汇总，行数为 0，不自动成为默认 Sheet。
- merged cells 保存范围元数据或警告，不复制左上值到其他格，不自动拼接表头。

发布汇总必须分别记录：`workbook_sheet_count`、`visible_sheet_count`、`hidden_sheet_count`、`very_hidden_sheet_count`、`parsed_sheet_count`、`skipped_sheet_count`、`parsed_row_count`、`skipped_sheet_warnings`。

### 8.2 单元格语义

- 支持 Shared Strings、Inline Strings、数字、布尔、错误、显式空单元格、公式缓存值和格式码。
- 不执行公式；公式只保存文本、缓存值、显示信息和风险标记。
- 数字格式用于产生显示候选和日期解释，但不覆盖原始数字。
- 外部 links/relationships 不跟随、不请求网络；外部公式缓存值仍视为不可信。
- 超大 dimension 不用于预分配数组，实际读取仍受行、列、单元格和字节预算限制。

### 8.3 XML/OOXML 安全

适配层必须拒绝或忽略 DOCTYPE，禁用外部实体，不访问网络，不跟随外部 Relationship，不加载宏，不解密工作簿，不执行公式。必须限制 XML 深度、节点属性数、单属性长度、文本节点长度和总解码字节，并在 Parser 层再次核验 ZIP 条目数、单条目展开大小、总展开大小、压缩比、路径和加密标志。

所有单元格、公式、Relationship、格式码和 XML 文本均是不可信输入。损坏 XML 返回 `IMPORT_PARSE_INVALID_XLSX`；响应不得包含内部 ZIP 路径、XML 片段或完整恶意单元格。

## 9. Shared Strings 策略

以下三种方案均需评估：

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A | run 级 D1 Shared Strings 表，分块预取 | 推荐候选；事务和清理清晰，但占 D1 容量 |
| B | R2 run 级分块索引对象 | 大数据成本较低，但新增临时对象生命周期和一致性边界 |
| C | 在严格总字节上限内驻留内存 | 只适用于小 Shared Strings，不能作为 200,000 项默认实现 |

V1 推荐 A，并要求实现任务用脱敏样本验证 D1 容量与查询成本；若不通过，再单独审批 B。不得为每个单元格单独查询 D1。读取必须按连续 string index 分块预取，并使用有界 LRU/窗口缓存。

限制同时包括最大项数、总解码字节、单项字节数和缓存字节数。run 失败或被替代后，Shared Strings 暂存数据遵循未发布结果清理策略。

## 10. CSV 解析契约

- 支持 UTF-8、UTF-8 BOM 和 GB18030；严格 UTF-8 失败后才尝试 GB18030，不进行静默替换解码。
- 实施前必须验证 Workers `TextDecoder` 的 GB18030 行为；若不支持，必须引入经审计的有界 decoder 或拒绝该编码，不能伪装成已支持。
- 分隔符候选为逗号、Tab、分号；对有界前导样本按一致列数、有效引号和非空结构评分。并列或低置信度返回明确警告/错误，不静默猜测。
- 支持双引号、双引号转义、引号内换行、CRLF/LF、空行和尾随空列。
- 不规则列数保留每行 `source_column_count` 并产生警告；超过列上限失败。
- CSV 所有字段默认是 `TEXT` 或显式 `EMPTY`，不自动转数字、布尔或日期；`00123` 必须保持文本。
- 以 `=`,`+`,`-`,`@` 开头的文本不拒绝，但标记 `formula_injection_risk = true`，供未来导出安全处理。
- CSV 约定 `sheet_index = 0`、`sheet_name = "__CSV__"`、可见性 `VISIBLE`。

## 11. 原始行与单元格契约

### 11.1 行结构

```json
{
  "schema_version": 1,
  "source_column_count": 5,
  "cells": [
    {
      "column_index": 0,
      "column_ref": "A",
      "type": "TEXT",
      "source_type": "TEXT",
      "raw_value": "00123",
      "display": "00123",
      "format_code": null,
      "formula_injection_risk": false
    }
  ]
}
```

- `cells` 按 `column_index` 严格升序且不得重复。
- `source_column_count` 是源行可恢复宽度，必须包含 CSV 连续分隔符和尾随空列。
- XLSX 缺失索引表示源格式没有出现该 cell；显式空 cell 使用 `EMPTY`。缺失索引不能自动解释为 `TEXT ""`。
- `raw_row_hash = SHA-256(canonical_json(schema_version, source_column_count, cells))`；规范化规则固定键顺序、Unicode 字符原样、数字十进制字符串语义和 null 表达。
- 映射、预览或未来清洗结果不得覆盖 `raw_values_json`。
- HTML、脚本和 XML 片段只按不可信文本保存与输出编码。

### 11.2 单元格类型

允许 `EMPTY`,`TEXT`,`NUMBER`,`BOOLEAN`,`DATE`,`FORMULA`,`ERROR`。`DATE` 是解释结果，不是 Excel 原始独立类型；必须同时保存：

```json
{
  "column_index": 2,
  "column_ref": "C",
  "type": "DATE",
  "source_type": "NUMBER",
  "raw_value": "45292",
  "display": "2024-01-01",
  "date_system": "1900",
  "format_code": "yyyy-mm-dd",
  "interpreted_iso_value": "2024-01-01",
  "interpretation_status": "INTERPRETED"
}
```

日期解释失败时保留原始值，`interpretation_status = FAILED` 并产生 WARNING。公式示例必须保存 `formula`、可空 `cached_value`、缓存类型和显示值，不执行也不信任缓存值。

## 12. 行写入、隔离与原子发布

### 12.1 行定位

CSV 与 XLSX 统一使用 1 开始的源文件 `row_number`。建议 `material_import_rows` 保存 `batch_id` 作为查询冗余和 FK 边界，同时以 `parse_run_id` 确定版本。

唯一约束必须从：

```text
UNIQUE(batch_id, sheet_index, row_number)
```

调整为：

```text
UNIQUE(parse_run_id, sheet_index, row_number)
```

同一 run 重放同一行时，已有 `raw_row_hash` 相同可视为幂等；不同则以 `IMPORT_PARSE_VERSION_CONFLICT` 失败，禁止覆盖。不同 parser 版本或新的失败重试可以生成新的 run，旧已发布 run 和行保留至其保留期或受控清理。

### 12.2 分片写入

“逻辑批次 100 行”不是“一条 INSERT 固定包含 100 行”。实现必须按 D1 每条查询的绑定参数上限计算：

```text
max_rows_per_statement = floor((100 - fixed_parameter_count) / parameters_per_row)
```

可以用有界 `db.batch()` 执行多条语句，但必须测试单条绑定数、SQL 长度、batch 语句数、Worker 子请求预算、D1 执行时间和失败事务行为。D1 当前平台限制须在实施时从[官方限制](https://developers.cloudflare.com/d1/platform/limits/)重新核验。

### 12.3 发布事务

`PUBLISH_PARSE_RUN` 必须在一个 D1 事务中：

1. 校验租约、批次 `PARSING`、`expected_version` 和 run `STAGED`；
2. 核验全部允许 Sheet 已完成；
3. 核验行数、Sheet 汇总、哈希累计值和全部资源预算；
4. 将旧 current run 更新为 `SUPERSEDED`；
5. 当前 run 更新为 `SUCCEEDED`；
6. 更新 `batch.current_parse_run_id`、`status = PARSED`、`current_version + 1`；
7. 写业务事件、审计和幂等结果；
8. 写 `PREPARE_MAPPING` Outbox。

任一步失败整体回滚；Outbox 在事务提交后至少一次派发。取消 CAS 已先成功、run 不再是活跃 run 或 `current_parse_run_id` 变化时，旧任务不得发布。

## 13. Mapping 准备恢复

`PREPARE_MAPPING` 只读取 `current_parse_run_id` 的 Sheet 元数据和有界原始行样本，生成默认 Sheet suggestion、header candidates、基础表头分析与新的 Mapping draft。它不重新读取原始文件、不写 `material_import_rows`。

失败时：

- 批次保持 `PARSED`；
- `mapping_preparation_status = FAILED`；
- 记录 `IMPORT_MAPPING_PREPARATION_FAILED` 和安全消息；
- 内部协调器或人工运维命令可重新写 Outbox，仅重试 Mapping 准备；
- V1 不新增公开重试 API。

`PUBLISH_MAPPING_PREPARATION` 必须绑定 `batch_id + current_parse_run_id + expected_version`。两个准备任务竞争时只有一个 CAS 可发布；run 已变化的旧任务停止发布。成功后将准备状态转为 `READY`，批次转为 `AWAITING_MAPPING` 并递增版本。

## 14. 应用级资源限制

全部数值已批准并在非生产实现中同时生效；进入生产前仍需使用脱敏现场样本、并发批次数、30 天原始行保留期和 D1 容量/成本压测确认。

| 限制 | 推荐起点 |
| --- | ---: |
| 原文件 | 沿用已批准 10 MiB |
| workbook Sheet | 32 |
| 可见 Sheet 总行数 | 50,000 |
| 每行列数 | 256 |
| 单元格文本 | 32,767 字符 |
| 非空单元格总数 | 2,000,000 |
| Shared Strings 项数 | 200,000 |
| `max_total_shared_string_bytes` | 64 MiB |
| `max_single_shared_string_bytes` | 256 KiB |
| `max_shared_string_cache_bytes` | 8 MiB |
| 公式文本 | 8,192 字符 |
| 单行规范化 JSON | 512 KiB |
| `max_total_normalized_json_bytes` | 256 MiB |
| `max_total_decoded_text_bytes` | 384 MiB |
| `max_total_warning_detail_bytes` | 256 KiB |
| `max_total_error_detail_bytes` | 256 KiB |
| warning/error 明细条数 | 各 100 |
| 逻辑写入批次 | 100 行 |
| 进度/预算检查 | 每 500 行或约 10 秒 |
| Parser 应用内存目标 | 64 MiB/isolate 目标，不是保证 |

“约 10 秒”不得依赖不可验证的精确 CPU 计时；必须同时使用行数、解码/规范化字节数、阶段和任务租约控制。平台硬限制不是业务正常工作区；Workers 的内存、CPU 和 Queue 限制应在实施时从[官方文档](https://developers.cloudflare.com/workers/platform/limits/)重新核验。

最先命中的限制立即终止当前 run：run 转 `FAILED`，批次进入安全失败状态，不切换 `current_parse_run_id`，保留有界汇总，清理未发布行、Shared Strings 和临时对象。发布前必须再次执行存储预算检查。

## 15. API、权限与用户可见性

完整契约见 `material-import-parser-v1.openapi.yaml`。

| API | 作用 |
| --- | --- |
| `POST .../{batchId}/parse` | 以 202 创建 run 与 Outbox |
| `GET .../{batchId}/sheets` | 读取当前有效 run 的 Sheet 与建议 |
| `GET .../{batchId}/rows` | 有界分页读取当前有效 run 原始行 |
| `GET .../{batchId}/mapping` | 获取当前 Mapping draft/confirmed 版本 |
| `PUT .../{batchId}/mapping` | 保存 Mapping 草稿 |
| `POST .../{batchId}/mapping/preview` | 对有界样本生成映射预览 |
| `POST .../{batchId}/mapping/confirm` | 原子确认 Mapping 并进入 `MAPPING_CONFIRMED` |

权限候选：`material.import.parse`、`material.import.map`、`material.import.read`、`material.import.read_any`。API 只判断 capability，不硬编码角色；`read_any` 不自动包含 parse 或 map。用户不可见批次统一返回 404，列表 total、Sheet 数和行数都必须在行级授权后计算。

`PARSED` 下允许读取 Sheet 和原始行，UI 显示“解析完成，正在准备字段映射”；不允许选择、编辑或确认 Mapping。只有 `AWAITING_MAPPING` 才开放 Mapping 操作。

所有写接口要求 Session、capability、同源/CSRF、`Idempotency-Key`、`expected_version`、稳定 `request_id` 和 CAS。不得返回堆栈、SQL、对象 key/凭证、内部 XML 路径、Token 或无界恶意内容。

## 16. 并发、取消与重新解析

- 两个 parse 请求：同一幂等键和相同摘要返回同一结果；异载荷返回 `IDEMPOTENCY_CONFLICT`；已有活跃 run 返回 `IMPORT_PARSE_ALREADY_RUNNING`。
- parse 与 cancel：先完成批次版本 CAS 者获胜；取消后任务不得发布 `PARSED`。
- parse 与 cleanup：活跃 run 或非终态批次禁止清理；清理租约与解析租约互斥。
- 重复任务：`job_id + stage + parse_run_id` 幂等；行哈希不一致 fail closed。
- 进程中断：当前 Sheet 可从头重跑；已完成 Sheet 不重写；已发布 current run 不覆盖。
- 短暂基础设施失败：批次保持 `QUEUED_FOR_PARSING` 或 `PARSING`，阶段任务通过 Outbox/租约重试；只有格式无效、资源超限、重试耗尽或其他明确不可恢复错误才把 run 和批次转为 `FAILED`。
- 重新解析：仅 `PARSED` 或 `AWAITING_MAPPING` 可通过后续批准的显式操作创建新 run；`MAPPING_CONFIRMED` 在 V1 禁止重新解析。
- 新 run 发布后旧 Mapping 永久绑定旧 `parse_run_id` 并转 `STALE` 或 `SUPERSEDED`，不得删除或继续确认。

## 17. 稳定错误码

至少冻结：

- Parser：`IMPORT_PARSE_NOT_ALLOWED`、`IMPORT_PARSE_ALREADY_RUNNING`、`IMPORT_PARSE_FAILED`、`IMPORT_PARSE_LIMIT_EXCEEDED`、`IMPORT_PARSE_UNSUPPORTED_ENCODING`、`IMPORT_PARSE_INVALID_XLSX`、`IMPORT_PARSE_INVALID_CSV`、`IMPORT_PARSE_FORMULA_UNSAFE`、`IMPORT_PARSE_CANCELLED`、`IMPORT_PARSE_VERSION_CONFLICT`；
- 准备与 Mapping：`IMPORT_MAPPING_PREPARATION_FAILED`、`IMPORT_SHEET_NOT_FOUND`、`IMPORT_HEADER_NOT_CONFIRMED`、`IMPORT_MAPPING_NOT_FOUND`、`IMPORT_MAPPING_INVALID`、`IMPORT_MAPPING_TARGET_INVALID`、`IMPORT_MAPPING_DUPLICATE_TARGET`、`IMPORT_MAPPING_VERSION_CONFLICT`、`IMPORT_MAPPING_PREVIEW_FAILED`；
- 通用：`IMPORT_BATCH_NOT_FOUND`、`AUTH_REQUIRED`、`FORBIDDEN`、`CSRF_INVALID`、`IDEMPOTENCY_CONFLICT`、`RATE_LIMITED`、`INTERNAL_ERROR`。

错误结构固定包含 `error.code`、中文 `error.message`、`request_id` 和可选有界 `details`。安全失败消息不能包含 XML、公式或单元格全文。

## 18. `0005` Migration 设计（不实施）

建议名称：`0005_material_import_parser_mapping_v1.sql`。不得修改或重排 `0004`。

### 18.1 Up/扩展

1. 新增 `material_import_parse_runs`、`material_import_parse_sheets`、`material_import_header_suggestions`、`material_import_job_outbox`、Shared Strings 暂存表、`material_import_mappings`、`material_import_mapping_items`；
2. 扩展批次状态 CHECK，并新增 `current_parse_run_id`；
3. 通过 SQLite/D1 表重建调整 `material_import_rows`，新增非空 `parse_run_id`，唯一约束改为 `(parse_run_id,sheet_index,row_number)`；
4. 为 run 状态/租约、Outbox 待发送、Sheet 分页、current run 行读取、Mapping current version 建索引；
5. 更新 `db/schema.ts`、Drizzle snapshot 与 journal。

`0005` 把既有 `material_import_rows` 逐行保留到固定版本的 `legacy-0004-backfill-v1`、`SUPERSEDED` legacy run，并核对行数；不会把它发布为当前解析结果，也不会静默丢行。已有 `FILE_READY` 批次原样保留，可在新 API 中开始解析。

### 18.2 回填、切换与收缩

- 扩展：先创建新表与索引；
- 回填：验证旧行计数为零，复制批次和行表；
- 切换：外键检查、行数核对、状态 CHECK、索引和 `PRAGMA foreign_key_check` 通过后替换旧表；
- 收缩：删除 migration 内临时表；不删除历史 run 或 Mapping。

### 18.3 Down 与失败恢复

Down 必须先拒绝存在新状态、parse runs、Mappings、Outbox 或带 `parse_run_id` 的业务行，防止数据丢失。只有空的新结构可重建回 `0004`。Up 任一步失败必须回滚到完整 `0004`；重升应在空库、已有 `FILE_READY` 数据和失败回滚后三类场景通过。

## 19. 测试与验收计划

### 19.1 库与运行时

- 完整兼容性矩阵；依赖版本、许可证、Bundle、WASM、峰值内存和资源释放；
- Queue `max_batch_size=1`、低并发和重复投递；Outbox 发送成功、失败、结果未知和协调重试。

### 19.2 Parser

- XLSX 单/多 Sheet、隐藏/very-hidden、空 Sheet、重复名称、1900/1904、shared/inline string、数字格式、日期、布尔、错误、空、公式缓存、合并单元格、损坏 XML、外链、宏、加密和 ZIP 再检查；
- CSV UTF-8/BOM/GB18030、逗号/Tab/分号、引号/转义/内嵌换行、CRLF/LF、空行、尾随空列、不规则列、超长单元格、编码失败、`00123` 和公式注入标记；
- 所有资源限制单独及组合命中，保证不进入 `PARSED`。

### 19.3 数据与恢复

- sparse cells、显式 EMPTY、缺失 cell、`source_column_count` 和稳定 hash；
- 当前 Sheet 中断重跑、已完成 Sheet 不重写、重复 job/行不重复、哈希冲突失败；
- publish 前后故障、取消竞争、旧 run 保留、current pointer 原子性；
- Mapping 准备失败保持 `PARSED`，只重试准备，旧 run 任务不能发布。

### 19.4 Migration 与 API

- `0005` 空库升级、已有 `FILE_READY`、既有行保留回填、失败回滚、Down 数据保护、重升、外键/等价引用触发器与唯一约束；
- 七个 API 的权限、隐藏 404、CSRF、幂等、限流、分页、版本冲突、metadata 漂移和安全错误结构；
- 测试仅使用本机一次性 D1、内存对象存储和内存任务调度器，拒绝生产 URL/远程绑定并清理数据。

### 19.5 最小 46 项实施追踪矩阵

实施测试必须逐项保留编号和验收证据；`PHASE2-TASK04` 已形成 54 项专项测试并覆盖本矩阵：

1. XLSX 单 Sheet；2. XLSX 多 Sheet；3. 隐藏 Sheet；4. 空 Sheet；
5. Shared Strings；6. Inline Strings；7. 1900 日期系统；8. 1904 日期系统；
9. 公式不执行；10. 公式缓存值；11. 合并单元格；12. 损坏 XML；
13. CSV UTF-8；14. CSV UTF-8 BOM；15. GB18030 策略；16. 引号和换行；
17. 尾随空列；18. 不规则列数；19. `00123` 保持文本；20. 公式前缀标记但不拒绝；
21. Sheet 限制；22. 行限制；23. 列限制；24. 单元格长度限制；
25. 解析任务重复投递；26. 解析中断恢复；27. parse/cancel 竞争；28. 幂等 parse；
29. 原始行重放不重复；30. Sheet 分页；31. 行分页；32. Header 建议；
33. Header 确认；34. 重复表头；35. 字段 Mapping；36. 动态属性 Mapping；
37. 无效 `attribute_code`；38. 重复目标；39. Mapping 预览；40. Mapping 版本冲突；
41. metadata 变化；42. 重新解析使旧 Mapping 失效；43. 权限和行级隐藏；44. 稳定错误结构；
45. 不连接生产 D1/R2/Queue；46. 现有 224 个 Node 测试继续通过。

补充约束中的 Outbox 结果未知、Sheet 重跑、Shared Strings 分块、总字节预算、Mapping 准备失败恢复、OOXML 安全和兼容性矩阵必须作为额外用例，不得用它们替换上述 46 项。

## 20. 已批准决策表

下列决定已由项目负责人批准用于 `PHASE2-TASK04` 非生产实施；生产资源、迁移和部署仍未批准。

| # | 决定 | 可选方案 | 推荐方案与理由 | Schema/API 影响 | 安全/性能/成本影响 | Status |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 同步或异步 | 上传内同步；HTTP 后台；持久任务 | 持久异步任务，避免请求生命周期承载解析 | 状态、run、Outbox、202 API | 至少一次；增加调度运维 | APPROVED |
| 2 | parse runs | 复用 batch；独立 run | 独立 `parse_runs`，隔离任务和业务状态 | 新表/FK/租约字段 | 可审计重试，增加存储 | APPROVED |
| 3 | XLSX 库 | 组合流式；SheetJS；外部服务 | 方案 A，需兼容门禁 | 无直接 API；实现模块化 | 有界内存但适配复杂 | APPROVED |
| 4 | CSV 库 | csv-parse；自研；其他库 | `csv-parse` browser ESM，需 Workers 测试 | 解析器依赖 | 避免自研状态机风险 | APPROVED |
| 5 | CSV 编码 | 仅 UTF-8；UTF-8+GB18030 | 后者，满足现场历史文件 | 错误码和 encoding 元数据 | decoder 必须严格且有界 | APPROVED |
| 6 | 隐藏 Sheet | 全解析；显式选择；跳过业务行 | 保存元数据但跳过业务行和 Mapping | Sheet 可见性/汇总 | 降低隐蔽数据误导入 | APPROVED |
| 7 | Sheet/header 建议 | 自动事实；suggestion；全人工 | 有界 suggestion，人工确认 | 建议表与 Mapping draft | 不把启发式变业务事实 | APPROVED |
| 8 | 资源上限 | 平台硬限；应用组合限 | 本规格组合限，样本压测后确认 | 统计/失败字段 | 提前止损；需容量规划 | APPROVED |
| 9 | 行重放版本 | 删除重写；run 隔离；临时复制 | `parse_run_id` 隔离 + current pointer 原子发布 | 重建 rows 唯一约束 | 幂等恢复，历史占用增加 | APPROVED |
| 10 | Mapping 模型 | 单 JSON；主从关系表 | 主表+item 表 | 新表、版本/CAS API | 防止任意字段/表达式 | APPROVED |
| 11 | 分类语义 | category_id；code；hint | 仅 `category_hint` | 目标 catalog | 不自动分类或污染正式 FK | APPROVED |
| 12 | 确认后编辑 | 原地编辑；新版本；禁止一切 | 不原地编辑；新版本需重新确认 | Mapping 状态/版本 | 审计完整，增加版本行 | APPROVED |
| 13 | 权限 | 角色硬编码；capability | parse/map/read/read_any capability | Session 授权 | 最小权限；需角色映射审批 | APPROVED |
| 14 | Queue | 同步；Cron polling；Queue+Outbox | Queue+Outbox；基础设施另批 | Outbox/调度器 | 可靠投递，增加 Queue 成本 | APPROVED |
| 15 | Shared Strings | D1；R2 索引；全内存 | D1 run 级分块 + 有界预取，压测失败再评估 R2 | 暂存表/清理 | 避免逐 cell 查询和常驻内存 | APPROVED |
| 16 | 恢复粒度 | 行游标；Sheet；整本 | Sheet 为恢复边界，行 checkpoint 仅观测 | Sheet 完成状态 | 重跑有限、语义可信 | APPROVED |

## 21. 完成边界

`PHASE2-TASK04` 在完成非生产实现、隔离测试和文档同步后停止。不得自动创建生产 Queue/R2/Cron/binding、执行生产 migration、连接生产、部署，或开始后续清洗、匹配、Material Draft 和正式物料任务。
