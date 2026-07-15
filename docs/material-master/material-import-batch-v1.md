# Material Import Batch Foundation V1 正式规格

- 任务编号：`PHASE2-TASK01`
- 文档状态：`PROPOSED`
- 适用运行面：`chenyida_erp_site/`（在线 Sites / Vinext / TypeScript / D1）
- 文档日期：2026-07-15
- 审阅门槛：只有用户统一回复“规格确认”后，选中的方案才可转为 `APPROVED`
- 实施状态：未实施。本任务不创建 Schema、Migration、对象存储、Binding、API、前端或部署配置。

## 1. 目的与边界

本规格定义物料历史文件批量导入的 V1 基础：批次、单个原始文件、不可变事件、后续解析所需的原始行契约，以及围绕私有对象存储的可恢复上传流程。它为 `PHASE2-TASK02` 的 Excel/CSV 解析提供稳定边界，但不在本任务中实现任何功能。

### 1.1 V1 范围

- 创建一个导入批次。
- 每个批次接收一个 `.xlsx` 或 `.csv` 文件。
- Worker 服务端代理上传，并将原始文件保存到私有 Cloudflare R2。
- D1 只保存批次、文件元数据、原始行契约、幂等记录和不可变事件。
- 服务端统计实际字节数、计算 SHA-256、检测文件类型并执行文件级基础安全检查。
- 支持批次查询、事件查询、取消、幂等重放、跨 D1/R2 故障协调，以及按保留策略清理原始对象和原始行。
- 权限、行级可见性、并发版本、稳定错误码和请求编号均由服务端执行。

### 1.2 明确不在 V1 上传阶段执行

- 不解析 Excel 工作表内容、不识别表头、不生成原始行。
- 不做字段映射、清洗、单位换算、匹配、AI 分类或 Material Draft 创建。
- 不支持多文件批次、浏览器预签名直传、S3 兼容凭证下发或浏览器直接访问 R2。
- 不提供原始文件下载 API 或公开 URL。
- 不承诺分布式事务、exactly-once 或接近平台请求体上限的上传能力。
- 不创建生产 bucket、binding、密钥、迁移或部署配置。

`material_import_rows` 的结构在本规格中冻结为 `PHASE2-TASK02` 的写入契约；本任务本身不产生行记录。

## 2. 已核验的仓库与平台基线

### 2.1 仓库实际配置

截至 2026-07-15，仓库实际状态如下：

- `.openai/hosting.json` 的 `r2` 为 `null`。
- `chenyida_erp_site` 当前没有可用 R2 binding；Worker `Env` 也没有 R2 绑定声明。
- 现有物料 API 只接收有界 JSON，请求体上限为 64 KiB；仓库没有 multipart 文件上传实现。
- 现有 `material_api_idempotency` 支持具体路由上的 `POST`/`PATCH`、64 位十六进制请求摘要、`PENDING`/`COMPLETED` 两种状态和约 24 小时清理；`material_id` 可以为空，但没有 `batch_id` 或通用资源引用，也没有 multipart 规范化摘要语义。
- 开发、测试、生产环境已经有分离概念，但当前没有任何环境具备本规格所需的 R2 能力。

因此，R2 是待新增基础设施，而不是现有能力。文档阶段不得创建 bucket、binding、密钥或生产资源。未来实施时，开发、测试、生产必须使用独立 bucket，或使用明确隔离前缀与独立 binding；任何生产资源创建仍需再次显式审批。

### 2.2 当前官方平台事实

- Cloudflare Workers 当前每个 isolate 的内存上限为 128 MB；请求体上限按账号计划区分，不能直接作为 ERP 的业务文件上限。参见 [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。
- D1 单个字符串、BLOB 和单行大小上限为 2,000,000 bytes，因此不适合作为原始文件二进制或 Base64 容器。参见 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)。
- R2 bucket 默认私有，只有显式启用公共访问后才公开；本方案禁止启用公开访问。参见 [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) 和 [Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/)。
- R2 单次 PUT 的对象上限高于本方案建议值，但官方建议较大对象使用 multipart；平台对象上限不等于本应用经验证能力。参见 [Upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/)。
- Workers 的 R2 binding `put` 接受 `ReadableStream`，并支持 `head` 与条件写入；Workers 还提供不保留输入数据的 `crypto.DigestStream("SHA-256")` 增量摘要扩展。未来实现可用有界 multipart 文件流、计数 `TransformStream`、流分叉和共享取消信号同时完成 R2 写入与摘要，而不需要整文件缓冲。参见 [R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) 和 [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。
- R2 按存储量和请求类别计费；保留期、重试、HEAD 检查和清理都会影响成本。参见 [R2 pricing](https://developers.cloudflare.com/r2/pricing/)。

这些事实只用于约束设计，不构成对当前仓库能力或可承载文件大小的承诺。

## 3. 推荐架构

### 3.1 存储职责

| 组件 | 推荐职责 | 禁止事项 |
| --- | --- | --- |
| 私有 R2 | 保存原始上传对象；通过确定性 `object_key` 支持恢复；保存少量非敏感对象元数据 | 公开 URL、客户端指定 key、覆盖已有不一致对象、存放凭证或敏感错误 |
| D1 | 保存批次、文件元数据、实际摘要和大小、原始行契约、幂等状态、不可变事件 | 保存文件二进制/Base64、宣称与 R2 同事务提交 |
| Worker | 鉴权、授权、CSRF、限流、multipart 流式接收、计数、摘要、类型检查、Saga 协调 | 整文件 `arrayBuffer()`、把临时文件系统当持久存储、上传阶段解析工作表 |
| 浏览器 | 选择单个文件、提交请求、展示受权限控制的状态和错误 | 直接访问 R2、获取对象存储凭证、决定最终 MIME/大小/哈希或状态 |

### 3.2 两步 API 流程

1. `POST /api/material-master/import-batches` 创建空批次。
2. `POST /api/material-master/import-batches/{batchId}/file` 以单文件 `multipart/form-data` 上传；Worker 代理写入私有 R2。

创建与上传分离可以先建立批次所有权、版本和审计边界，再对文件上传实施 CAS、幂等和恢复。V1 不支持在一个批次上追加第二个文件。

### 3.3 可注入对象存储边界

未来实现必须定义可注入的对象存储接口，至少具备：`putIfAbsent`、`head`、必要时受控读取、`delete`。生产使用 R2 实现；测试使用内存或隔离的本地替身。测试不得依赖生产 R2 或远程 binding。

## 4. 推荐数据模型

本节全部为 `PROPOSED`。正式 Migration 只能在“规格确认”后另行创建。

### 4.1 `material_import_batches`

| 字段 | 建议类型/约束 | 语义 |
| --- | --- | --- |
| `id` | INTEGER PK | 内部稳定标识 |
| `batch_no` | TEXT NOT NULL UNIQUE | 服务端生成的可展示批次号，不作为授权依据 |
| `source_kind` | TEXT NOT NULL CHECK | V1 为 `XLSX` 或 `CSV` |
| `status` | TEXT NOT NULL CHECK | 仅接受本规格 5.1 的 V1 状态 |
| `retry_of_batch_id` | INTEGER NULL FK self | 新批次对失败批次的重试来源；不得指向自身 |
| `created_by` | INTEGER/TEXT NOT NULL FK current user | 所有者，用于行级可见性 |
| `current_version` | INTEGER NOT NULL DEFAULT 1 CHECK > 0 | 所有写操作的乐观并发版本 |
| `file_count` | INTEGER NOT NULL DEFAULT 0 CHECK 0..1 | V1 单文件约束的冗余计数，事务内维护 |
| `total_rows` | INTEGER NOT NULL DEFAULT 0 CHECK >= 0 | TASK02 后续写入 |
| `accepted_rows` | INTEGER NOT NULL DEFAULT 0 CHECK >= 0 | 后续阶段统计，V1 默认为 0 |
| `rejected_rows` | INTEGER NOT NULL DEFAULT 0 CHECK >= 0 | 后续阶段统计，V1 默认为 0 |
| `failure_stage` | TEXT NULL | `STORAGE`、`FILE_SECURITY`、`RECONCILIATION` 等稳定 code |
| `failure_code` | TEXT NULL | 对外可安全展示的稳定失败 code |
| `failure_message` | TEXT NULL | 脱敏中文提示，不存 SQL、堆栈、凭证或对象存储内部异常 |
| `cancelled_by` | INTEGER/TEXT NULL FK current user | 取消操作者 |
| `cancelled_at` | TEXT NULL | UTC ISO-8601 |
| `terminal_at` | TEXT NULL | 进入 `FAILED`、`CANCELLED` 或未来 `COMPLETED` 时设置；非终态必须为空 |
| `raw_data_retention_until` | TEXT NULL | 基于 `terminal_at` 与获批原始数据保留期计算 |
| `record_retention_until` | TEXT NULL | 基于 `terminal_at` 与获批批次/事件保留期计算 |
| `created_at` / `updated_at` | TEXT NOT NULL | UTC ISO-8601 |

一致性要求：

- `FAILED` 必须同时有 `failure_stage` 和 `failure_code`；非 `FAILED` 通常必须为空。`RECONCILIATION_REQUIRED` 的原因放在事件和安全的协调原因字段中，不伪装成已确定失败。
- `terminal_at` 一经设置不得清空；终态不恢复。需要重新执行时创建新批次并设置 `retry_of_batch_id`。
- `retry_of_batch_id <> id`；服务端必须阻止更深的引用环。普通用户只有对来源批次可见时才能提交引用，内部重试也不得通过错误或响应泄露隐藏批次。
- `file_count` 与文件唯一约束共同保护 V1 单文件规则；不能只信任计数。

### 4.2 `material_import_files`

| 字段 | 建议类型/约束 | 语义 |
| --- | --- | --- |
| `id` | INTEGER PK | 文件内部标识 |
| `batch_id` | INTEGER NOT NULL UNIQUE FK | V1 一个批次最多一个文件 |
| `object_key` | TEXT NOT NULL UNIQUE | 服务端生成的确定性私有对象定位符 |
| `original_filename` | TEXT NOT NULL | 清理后的展示元数据，不参与路径解释 |
| `filename_extension` | TEXT NULL | 从清理后文件名得到的声明性扩展名 |
| `declared_mime_type` | TEXT NULL | multipart 客户端声明，仅供比较 |
| `declared_sha256` | TEXT NOT NULL CHECK 64 lower-hex | 客户端声明，用于完整性对比，不作为最终摘要 |
| `declared_size_bytes` | INTEGER NULL CHECK >= 0 | 客户端声明，可缺省，不作为最终大小 |
| `detected_file_type` | TEXT NULL CHECK | 服务端检测的 `XLSX` 或 `CSV`；最终权威 |
| `actual_sha256` | TEXT NULL CHECK 64 lower-hex | Worker 流式计算；对象成功写入后记录 |
| `actual_size_bytes` | INTEGER NULL CHECK > 0 | Worker 实际计数；对象成功写入后记录 |
| `object_etag` | TEXT NULL | 用于恢复比对的非敏感 R2 元数据 |
| `storage_status` | TEXT NOT NULL CHECK | 见 5.2 |
| `security_check_status` | TEXT NOT NULL CHECK | 见 5.3 |
| `security_failure_code` / `security_failure_message` | TEXT NULL | 基础安全检查拒绝的稳定 code 与脱敏提示 |
| `uploaded_at` | TEXT NULL | 已确认对象存储成功的时间 |
| `retention_until` | TEXT NULL | 与批次原始数据保留基准一致 |
| `created_at` / `updated_at` | TEXT NOT NULL | UTC ISO-8601 |

`object_key` 由服务端根据环境、批次 ID、文件 ID 或服务端稳定随机标识组合生成，例如 `env/material-import/{batchId}/{fileStableId}`。它不得直接使用原始文件名，不得包含用户路径、`../` 或可解释的客户端路径片段，也不得作为可访问地址暴露给无权限客户端。

确定性 key 只用于定位同一对象，不代表允许覆盖：重试前必须先 `HEAD` 或读取安全元数据。已存在对象的实际哈希和大小完全匹配时可以安全重放 D1 完成步骤；不匹配时必须进入 `RECONCILIATION_REQUIRED`，不得覆盖。

### 4.3 `material_import_rows`

此表由 `PHASE2-TASK02` 写入，本规格只冻结边界。

| 字段 | 建议类型/约束 | 语义 |
| --- | --- | --- |
| `id` | INTEGER PK | 原始行内部标识 |
| `batch_id` | INTEGER NOT NULL FK | 所属批次 |
| `sheet_index` | INTEGER NOT NULL CHECK >= 0 | 统一使用从 0 开始的工作表序号 |
| `sheet_name` | TEXT NOT NULL | 展示名称，不参与唯一性 |
| `row_number` | INTEGER NOT NULL CHECK > 0 | 源文件中的 1-based 行号 |
| `raw_values_json` | TEXT NOT NULL CHECK json_valid | 冻结的类型化单元格对象，不得覆盖 |
| `raw_row_sha256` | TEXT NOT NULL CHECK 64 lower-hex | 规范化原始行摘要，用于诊断与幂等解析 |
| `created_at` | TEXT NOT NULL | UTC ISO-8601 |

完整性约束：`UNIQUE(batch_id, sheet_index, row_number)`。CSV 固定为 `sheet_index = 0`、`sheet_name = "__CSV__"`。`sheet_name` 不是稳定身份，重名工作表不得造成行冲突。

#### 4.3.1 `raw_values_json` 冻结契约

顶层是按电子表格列标识（`A`、`B`、`C`……）索引的对象，XLSX 与 CSV 均使用相同列标识。每个值必须是以下类型之一：

| `type` | 必填字段 | 可选字段/规则 |
| --- | --- | --- |
| `EMPTY` | 仅 `type` | 不用空字符串代替 |
| `TEXT` | `value: string` | `display` 可保留源显示文本 |
| `NUMBER` | `value: number` | `display` 可保留千分位等显示；不可用自由文本替代数值 |
| `BOOLEAN` | `value: boolean` | `display` 可选 |
| `DATE` | `value: ISO-8601 string` | `serial` 可保留源序列值；只有解析器确定为日期时才使用 |
| `FORMULA` | `formula: string` | `cached_value` 可为 `null` 或安全的 JSON primitive；公式永不执行 |
| `ERROR` | `error_code: string` | `display` 可选，不执行或解释错误表达式 |

示例：

```json
{
  "A": { "type": "TEXT", "value": "0603" },
  "B": { "type": "NUMBER", "value": 1000, "display": "1,000" },
  "C": { "type": "FORMULA", "formula": "=A1", "cached_value": null }
}
```

原始行一经写入不得由映射、清洗或审核步骤覆盖；后续结果必须存入独立结构。字符串中的 HTML、脚本或公式前缀只作为数据保存，绝不能解释为可执行内容。TASK02 可以添加向后兼容字段，但不得破坏上述类型边界。

### 4.4 `material_import_events`

| 字段 | 建议类型/约束 | 语义 |
| --- | --- | --- |
| `id` | INTEGER PK | 事件标识 |
| `batch_id` | INTEGER NOT NULL FK | 所属批次 |
| `event_type` | TEXT NOT NULL CHECK | 稳定事件 code |
| `actor_type` | TEXT NOT NULL CHECK | `USER` 或 `SYSTEM` |
| `actor_identifier` | TEXT NULL | 脱敏操作者标识；系统事件可为空或固定 code |
| `previous_status` / `new_status` | TEXT NULL | 批次状态变化；非状态事件可为空 |
| `request_id` | TEXT NOT NULL | 与 API 响应/审计关联 |
| `safe_details_json` | TEXT NULL CHECK json_valid | 仅保存非敏感诊断 code、计数和引用，不存正文或内部异常 |
| `created_at` | TEXT NOT NULL | UTC ISO-8601 |

事件只追加，不更新、不删除。V1 至少定义：

- `BATCH_CREATED`
- `FILE_UPLOAD_STARTED`
- `FILE_STORED`
- `FILE_UPLOAD_COMPLETED`
- `FILE_UPLOAD_FAILED`
- `FILE_SECURITY_CHECK_PASSED`
- `FILE_SECURITY_CHECK_FAILED`
- `RECONCILIATION_REQUIRED`
- `BATCH_CANCELLED`
- `FILE_DELETE_REQUESTED`
- `FILE_DELETED`
- `FILE_DELETE_FAILED`

原始文件或行清理不得删除事件历史。未来若批次/事件保留期到期，必须使用独立、受控且已获批准的归档/删除流程，而不是原始对象清理任务顺带删除。

### 4.5 `material_import_idempotency`（技术安全表）

推荐复用现有幂等算法与安全工具，但不直接复用现有 `material_api_idempotency` 表。原因是导入上传需要批次/文件引用、multipart 规范化摘要、跨 R2/D1 恢复窗口和与普通 JSON 写接口不同的清理规则。

现有表核验结果：

| 核验项 | 仓库实际情况 | 对导入的结论 |
| --- | --- | --- |
| `material_id` | 可为空 | 技术上不会强迫伪造物料 ID，但也不能拿它冒充批次 ID |
| 批次/资源引用 | 没有 `batch_id` 或安全通用资源引用 | 无法关系化定位上传恢复对象 |
| multipart | 当前安全模块只定义规范化 JSON 请求行为 | 不能宣称现有代码已支持 multipart 摘要或流恢复 |
| 状态 | 只有 `PENDING`、`COMPLETED`，没有 `FAILED` | 业务错误可完成并重放，但跨存储不确定性必须由批次/文件状态承载 |
| `request_digest` | 固定 64 位十六进制 | 足以保存 SHA-256 规范化请求摘要 |
| method/route | CHECK 接受 `POST`/`PATCH`，作用域使用具体路由 | 与本任务 POST 路由兼容，但不解决文件语义 |
| 清理 | 完成结果约 24 小时，现有清理面向普通 API | 对上传意图、孤立对象和待协调恢复可能过短 |

建议字段：`username`、`method`、`route_scope`、`key_digest`、`request_digest`、`operation_id`、`state`（V1 仅 `PENDING`/`COMPLETED`）、`batch_id`、`file_id`、lease 摘要/到期时间、响应状态/安全响应 JSON、`created_at`、`updated_at`、`expires_at`、`recovery_until`。唯一约束为 `(username, method, route_scope, key_digest)` 与 `operation_id`。

关键规则：

- 不得把批次 ID 填进现有表的 `material_id`。
- `PENDING` 记录只在确认没有待协调对象后才能清理；不能机械沿用约 24 小时的现有清理窗口。
- 业务失败响应可以被记录为 `COMPLETED` 幂等结果；跨存储不确定性由批次/文件的 `RECONCILIATION_REQUIRED` 表达，不需要伪造 `FAILED` 幂等状态。
- 同一 key 只有在规范化请求摘要一致时才能重放；摘要不一致返回 `IDEMPOTENCY_KEY_REUSED`。

## 5. 批次与文件状态机

### 5.1 批次 V1 状态

V1 Migration 的 CHECK 只应接受以下实际状态：

| 状态 | 含义 | 可由普通 API 离开 |
| --- | --- | --- |
| `CREATED` | 批次已创建，尚无上传意图 | 上传、取消 |
| `UPLOAD_PENDING` | D1 已登记上传意图，R2/D1 完成尚未确认 | 上传恢复、取消 CAS、协调 |
| `SECURITY_CHECK_PENDING` | R2 对象及实际元数据已在 D1 确认，基础安全检查未完成 | 检查完成、取消 CAS、协调 |
| `FILE_READY` | 文件满足所有 ready 不变量，可交给后续解析任务 | 取消；未来 TASK02 扩展 |
| `RECONCILIATION_REQUIRED` | R2/D1 或并发结果不确定，需要受控协调 | 仅协调器到 `FILE_READY`、`FAILED` 或 `CANCELLED` |
| `FAILED` | 已确定、不可原地恢复的终态失败 | 无；重试创建新批次 |
| `CANCELLED` | 业务终态取消；不表示对象已经删除 | 无 |

`FAILED` 与 `CANCELLED` 是 V1 终态，进入时设置 `terminal_at`。未来 `COMPLETED` 也属于终态，但不应提前加入 V1 CHECK。

以下状态只记录为路线图，必须由后续 Migration 扩展 CHECK 后才能使用：`QUEUED_FOR_PARSING`、`PARSING`、`PARSED`、`AWAITING_MAPPING`、`VALIDATING`、`AWAITING_REVIEW`、`COMPLETED`。

### 5.2 文件存储状态

- `UPLOAD_PENDING`
- `STORED`
- `RECONCILIATION_REQUIRED`
- `STORAGE_FAILED`
- `DELETE_PENDING`
- `DELETED`

### 5.3 文件安全检查状态

- `NOT_STARTED`
- `PENDING`
- `BASIC_CHECK_PASSED`
- `REJECTED`

`FILE_READY` 必须同时满足：

1. 文件 `storage_status = STORED`；
2. `security_check_status = BASIC_CHECK_PASSED`；
3. `actual_sha256` 存在；
4. `actual_size_bytes > 0`；
5. `detected_file_type` 是允许类型。

R2 写入成功不等于文件安全检查通过。基础检查失败是 `FILE_SECURITY` 阶段的安全拒绝，不是 R2 存储失败。

### 5.4 状态转换与 CAS

所有批次写入必须携带 `expected_version`，使用类似 `UPDATE ... WHERE id = ? AND current_version = ? AND status IN (...)` 的单语句 CAS，并在同一 D1 事务中更新版本、联动记录和事件。受影响行数为 0 时重新读取：不存在或不可见返回 `IMPORT_BATCH_NOT_FOUND`，状态不允许返回 `IMPORT_BATCH_STATE_INVALID`，版本变化返回 `IMPORT_BATCH_VERSION_CONFLICT`。

取消与上传完成竞争由 D1 CAS 决定：

- 取消先赢：批次进入 `CANCELLED`，后到的上传完成不得转为 `FILE_READY`；若对象已存在，文件进入 `DELETE_PENDING` 或 `RECONCILIATION_REQUIRED`。
- 上传完成先赢：取消必须基于最新版本重新判断；若 `FILE_READY` 仍在获批取消范围，可用新版本再次取消。
- `CANCELLED` 只表示业务状态，绝不等于对象已经删除；删除通过独立事件记录。

## 6. 可恢复上传 Saga

本设计不声称 D1 与 R2 存在分布式事务或 exactly-once。目标是确定性定位、幂等重放、可观察协调和不覆盖原始证据。

### A. D1 原子登记上传意图

- 服务端鉴权、授权、CSRF、限流，验证 batch 可见性、状态和 `expected_version`。
- 读取 multipart part headers 后得到清理文件名、声明 MIME 等规范化字段，登记或命中幂等 key。
- 创建文件元数据、生成确定性 `object_key`、写 `FILE_UPLOAD_STARTED`。
- 批次转为 `UPLOAD_PENDING` 并递增版本；文件 `storage_status = UPLOAD_PENDING`、`security_check_status = NOT_STARTED`。

### B. Worker 流式写入私有 R2

- 只接受一个 file part；边读边统计实际字节数并计算 SHA-256。
- 推荐实现边界是：有界 multipart 解析器产出文件 `ReadableStream`，计数/上限 `TransformStream` 与 `crypto.DigestStream("SHA-256")` 在受背压控制的流分支上消费，R2 `put` 直接接收存储分支；三方必须由共享取消/失败传播统一中止并被同时等待。这里描述的是后续实现约束，不是本任务代码。
- `Content-Length` 与声明大小只用于提前拒绝；最终大小以实际计数为准。
- 超过应用上限立即中止读取和 R2 写入，并执行可恢复清理。
- 不信任客户端文件名扩展名、MIME、大小或 SHA；不使用整文件 `arrayBuffer()`。
- 写入前如果 key 已存在，先比对安全元数据；匹配则走恢复，不匹配则停止并协调，绝不覆盖。

### C. R2 成功后的 D1 原子“已存储”完成

- 把文件更新为 `STORED`，记录实际 SHA、实际大小、检测类型、非敏感 ETag/元数据和 `uploaded_at`。
- 声明 SHA 与实际 SHA 不一致时，不完成成功；返回 `IMPORT_FILE_HASH_MISMATCH`，将对象置于受控删除或协调流程，批次不得进入 `FILE_READY`。
- 匹配时将安全检查状态设为 `PENDING`、批次设为 `SECURITY_CHECK_PENDING`，写 `FILE_STORED`。

### D. 基础文件安全检查

- 对已存储对象执行 8.3 的文件级检查。
- 通过：同一 D1 事务设 `BASIC_CHECK_PASSED`、批次 `FILE_READY`，写 `FILE_SECURITY_CHECK_PASSED` 与 `FILE_UPLOAD_COMPLETED`，完成幂等响应。
- 拒绝：设 `REJECTED`，记录脱敏 code，批次以 `failure_stage = FILE_SECURITY` 进入 `FAILED`，写 `FILE_SECURITY_CHECK_FAILED`；原始对象进入 `DELETE_PENDING` 或受控隔离清理。

### E. D1 完成阶段失败

- 不创建新对象，也不把已有对象直接视为上传失败。
- 如果 D1 当时完全不可写，不能声称已成功写入协调状态；此前的 `UPLOAD_PENDING` 意图、确定性 key 和 R2 对象共同构成恢复依据。后续请求或协调器在 D1 恢复后才以 CAS 写入完成事实或 `RECONCILIATION_REQUIRED`。
- 使用确定性 key 检查 R2；哈希和大小一致时安全重放 D1 完成步骤。
- 缺失或不一致、取消竞争、响应丢失后结果不确定时，批次和/或文件进入 `RECONCILIATION_REQUIRED` 并写同名事件。
- 协调器在确认事实后只能转到 `FILE_READY`、`FAILED` 或 `CANCELLED`；不得绕过安全检查。

### F. R2 写入失败

- D1 记录 `FILE_UPLOAD_FAILED`，文件进入 `STORAGE_FAILED`，批次以 `failure_stage = STORAGE` 进入可确定的 `FAILED`，或在写入结果不确定时进入 `RECONCILIATION_REQUIRED`。
- 只保存稳定、脱敏失败 code；不保存对象存储内部异常、请求签名、凭证或堆栈。

## 7. API 契约摘要

完整机器可读草案见 `material-import-batch-v1.openapi.yaml`。所有响应都包含 `request_id`；错误使用稳定 code 和中文安全提示。

| Method / Path | 权限 | 幂等/并发 | 成功语义 |
| --- | --- | --- | --- |
| `POST /api/material-master/import-batches` | `material.import.create` | `Idempotency-Key`；请求摘要；无版本 | 201 创建 `CREATED` 批次 |
| `POST /api/material-master/import-batches/{batchId}/file` | `material.import.create` 且可见 | `Idempotency-Key`、`X-Expected-Version`、声明 SHA | 200 `FILE_READY`；不确定时 202 协调状态 |
| `GET /api/material-master/import-batches` | `material.import.read` | 只读；游标分页 | 仅本人，或 `read_any` 范围 |
| `GET /api/material-master/import-batches/{batchId}` | `material.import.read` | 只读 | 批次和可安全展示的文件元数据，不返回 object key/URL |
| `GET /api/material-master/import-batches/{batchId}/events` | `material.import.read` | 只读；游标分页 | 不可变事件，不返回内部异常 |
| `POST /api/material-master/import-batches/{batchId}/cancel` | `material.import.cancel` 且可见 | `Idempotency-Key`、body `expected_version` | 200 取消；对象清理由后续流程完成 |

### 7.1 创建批次

请求包含 `source_kind`，可选 `retry_of_batch_id`。重试永远创建独立批次、文件、版本、事件和审计轨迹；不得复用或清空旧失败批次。

### 7.2 单文件上传

建议请求：

- `Content-Type: multipart/form-data; boundary=...`
- `Idempotency-Key: <opaque client key>`
- `X-Expected-Version: <positive integer>`
- `X-File-SHA256: <64 lower-hex>`（必填声明摘要）
- `X-File-Size: <nonnegative integer>`（可选声明大小）
- `X-Duplicate-Action: REJECT | ALLOW_DUPLICATE`
- 恰好一个名为 `file` 的 part。

`duplicate_action` 不使用 `CREATE_NEW`，避免与失败批次重试混淆。`ALLOW_DUPLICATE` 只是明确允许同一实际 SHA 重新导入；仍然创建当前批次自己的独立文件记录和对象，不复用旧批次状态。

### 7.3 错误码

至少定义：

- `IMPORT_BATCH_NOT_FOUND`
- `IMPORT_BATCH_STATE_INVALID`
- `IMPORT_BATCH_VERSION_CONFLICT`
- `IMPORT_BATCH_RECONCILIATION_REQUIRED`
- `IMPORT_FILE_ALREADY_ATTACHED`
- `IMPORT_FILE_REQUIRED`
- `IMPORT_FILE_MULTIPLE_NOT_ALLOWED`
- `IMPORT_FILE_TYPE_UNSUPPORTED`
- `IMPORT_FILE_TOO_LARGE`
- `IMPORT_FILE_EMPTY`
- `IMPORT_FILE_HASH_MISMATCH`
- `IMPORT_FILE_DUPLICATE`
- `IMPORT_FILE_SECURITY_CHECK_FAILED`
- `IMPORT_FILE_STORAGE_FAILED`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_KEY_REUSED`
- `IDEMPOTENCY_REQUEST_IN_PROGRESS`
- `PERMISSION_DENIED`
- `CSRF_VALIDATION_FAILED`
- `RATE_LIMITED`

404 必须合并“不存在”和“无权查看”，避免批次枚举。服务端异常、SQL、R2 内部信息和敏感请求内容不得进入浏览器响应。

## 8. 文件完整性与安全

### 8.1 分离记录的事实

必须分别保存并展示：客户端声明 MIME、客户端扩展名、服务端检测文件类型、服务端实际 SHA-256、服务端实际字节数。最终数据库事实以服务端检测、计算和计数结果为准。

### 8.2 文件大小

推荐 V1 应用上限为 **10 MiB**，仍属 `PROPOSED` 决定。仓库中没有 PCB/FPC/SMT 历史物料文件样本分布或峰值证据，因此该值是保守起点，不是已验证业务容量。实施前应以脱敏样本统计大小、行数、工作表数和压缩比，再决定是否调整。

较小上限的依据：

- Worker 128 MB isolate 内存要求避免整文件缓冲。
- 服务端代理上传受客户端链路、Worker 执行时间和超时影响。
- XLSX 是 ZIP 容器，存在高压缩比/解压炸弹风险；上传大小不等于解析成本。
- 后续 TASK02 的解析内存、CPU、行数和公式/共享字符串成本尚未压测。
- R2 存储、Class A/B 操作、重试 HEAD 和清理均产生运维与费用。

不得把 Cloudflare 请求体上限写成业务上限，也不得在未压测前宣称支持接近平台上限的文件。

### 8.3 基础安全检查边界

上传阶段只做文件级、非业务解析检查：

- 扩展名、声明 MIME 与魔数/结构类型的交叉检查。
- XLSX 仅允许预期 OOXML 容器；拒绝明显错误签名、加密/受密码保护文件、宏启用格式、超出获批 ZIP 条目数/展开大小/压缩比边界的容器。
- CSV 可拒绝 NUL 字节、明显完整 HTML 文档、错误二进制签名和不在获批编码策略中的内容。建议 V1 支持 UTF-8（含 BOM）与 GB18030，但仍需在 TASK02 实现前用样本验证。
- 不执行公式、宏、外部链接、HTML、脚本或嵌入对象。

CSV 单元格包含 `<script>`、`<html>`、`=`、`+`、`-`、`@` 不能作为整文件拒绝理由；它们可能是合法业务文本。TASK02 应把公式样文本保持为数据，未来导出还必须单独防范 CSV/Spreadsheet Formula Injection。

V1 不把独立杀毒/恶意文件扫描服务视为现有能力。若后续接入，应放在 `STORED` 与 `BASIC_CHECK_PASSED` 之间，并保持状态机和对象存储接口可扩展。

### 8.4 R2 私有与不可变证据

- bucket 禁止公开访问，不生成公共 URL。
- API 响应不返回 `object_key`、ETag、bucket 名或内部存储错误。
- R2 custom metadata 仅允许批次/文件稳定 ID、实际哈希、大小、版本等非敏感字段；不得存用户名、原始路径、凭证或完整错误。
- 同一确定性 key 上存在不一致对象时进入协调，绝不覆盖。

## 9. 权限与行级可见性

权限使用服务端 capability，不在 API 内硬编码角色名称：

- `material.import.create`
- `material.import.read`
- `material.import.read_any`
- `material.import.cancel`

默认可见性：拥有 `material.import.read` 的用户只能读取 `created_by = 当前用户` 的批次、文件和事件；同时拥有 `material.import.read_any` 才能跨所有者查询。`cancel` 还必须满足相同可见性；取消他人批次需要 `read_any` 与 `cancel`。

所有列表过滤、详情、事件和重试来源检查都必须在 SQL/服务端查询层施加所有者条件，不得先读出再在浏览器隐藏。隐藏资源统一返回 404。未来谁获得 `read_any` 属于第 7 项待确认决定。

写接口沿用现有服务端会话、严格同源 Origin、CSRF cookie/header 双提交校验、请求编号与用户级限流模式；multipart 上传必须增加独立的文件请求大小和并发配额。

## 10. 幂等、重复与并发

### 10.1 multipart 规范化摘要

请求摘要不得包含原始 multipart 字节、随机 boundary 或 `Content-Length`。建议按稳定序列编码以下字段后计算 SHA-256：

- HTTP method
- 规范化具体 path
- `batch_id`
- `expected_version`
- `declared_sha256`
- 清理后的 `sanitized_filename`
- 规范化的 `declared_mime_type`
- `declared_size`（如提供）
- `duplicate_action`

同一用户、method、route scope、key 只有摘要一致才能重放。随机 multipart boundary 改变不影响摘要；字段改变时返回 `IDEMPOTENCY_KEY_REUSED`。

由于文件 part headers 是摘要输入，流式 multipart 处理器必须先安全读取有限的 part headers，再登记上传意图；不得为计算幂等摘要而缓冲整个文件。

### 10.2 响应丢失与恢复

- 已有幂等记录 `COMPLETED` 且摘要相同：返回原安全响应。
- `PENDING` 且 lease 有效：返回 `IDEMPOTENCY_REQUEST_IN_PROGRESS`。
- lease 过期：先检查 D1 文件状态与 R2 对象；事实一致才接管恢复。
- R2 对象存在且哈希/大小匹配：重放 D1 存储完成和安全检查，不重新 PUT。
- R2 对象不存在：根据已记录进度决定允许重新上传或进入协调。
- R2 对象存在但哈希/大小不一致：进入 `RECONCILIATION_REQUIRED`，禁止覆盖。

### 10.3 重复 SHA

默认 `REJECT`。若系统发现当前用户可见范围内存在相同实际 SHA 的历史导入，返回 `IMPORT_FILE_DUPLICATE`。客户端只有显式提交 `ALLOW_DUPLICATE` 才可创建独立再导入证据；响应可提供不泄露隐藏批次的安全提示。隐藏或其他租户/权限范围的重复记录不得暴露批次标识。

### 10.4 审计

D1 业务事务写入不可变 `material_import_events`；同时沿用系统审计日志记录操作者、动作、对象类型/ID、结果、请求编号和时间。不得记录文件正文、单元格值、令牌、multipart 原文或内部对象存储异常。

## 11. 保留、取消与清理

### 11.1 保留基准

建议原始 R2 对象和原始行从 `terminal_at` 起保留 30 天；批次元数据与事件建议从 `terminal_at` 起保留 1095 天。两项仍分别处于 `PROPOSED`。

- 非终态批次的 `terminal_at`、`raw_data_retention_until`、`record_retention_until` 均为空，不得因创建时间较早而自动清理。
- 进入 `FAILED`、`CANCELLED` 或未来 `COMPLETED` 时，在同一 D1 事务中设置 `terminal_at` 和对应保留截止时间。
- 文件与原始行使用相同的批次终态基准。文件可复制 `retention_until` 便于对象清理；行清理以批次 `raw_data_retention_until` 查询。
- 原始文件/行清理保留批次和事件；事件删除只能由独立的长期保留流程执行。

### 11.2 两阶段清理

1. D1 CAS 把文件设为 `DELETE_PENDING`，写 `FILE_DELETE_REQUESTED`。
2. 对象存储删除成功后，D1 设为 `DELETED`，清空可访问存储定位信息或转为不可用墓碑，写 `FILE_DELETED`。
3. 删除失败时保持可恢复状态并写 `FILE_DELETE_FAILED`；不得伪装为已删除。
4. 原始行按批次和保留截止时间分块删除；重试必须幂等、可断点续跑。

孤立对象扫描必须以环境前缀、对象元数据和 D1 记录比对为依据，只生成候选并走受控删除；不得看到“无当前引用”就直接删除。取消、哈希不匹配、安全拒绝和 Saga 不确定均可能产生待协调对象。

## 12. Migration 设计（不实施）

建议后续单独创建 `0004_material_import_batch_foundation.sql`，但本任务不得创建该文件。

### 12.1 迁移内容

1. 创建四张业务表：`material_import_batches`、`material_import_files`、`material_import_rows`、`material_import_events`。
2. 创建一张技术安全表：`material_import_idempotency`。
3. 为全部状态、摘要格式、正数/非负数、JSON 有效性、终态字段一致性建立 CHECK。
4. 建立外键、V1 单文件唯一约束、原始行位置唯一约束和幂等作用域唯一约束。
5. 同步更新 `db/schema.ts`，并新增迁移测试；不得靠运行时 `CREATE TABLE IF NOT EXISTS` 掩盖基线。

V1 CHECK 只能包含本规格当前实际状态。路线图状态必须在实现对应行为的后续迁移中扩展，避免数据库允许应用尚不理解的状态。

### 12.2 候选普通索引及查询依据

以下只是待 `EXPLAIN QUERY PLAN` 验证的候选，不是本任务创建的索引：

| 候选索引 | 支持的 API/任务 | 过滤、排序与权限 | 重叠/验证要求 |
| --- | --- | --- | --- |
| `batches(created_by, created_at DESC, id DESC)` | 本人批次列表 | owner 行级过滤 + 时间游标 | 与 `batch_no UNIQUE` 不重叠；验证分页 |
| `batches(status, created_at DESC, id DESC)` | `read_any` 状态队列 | 状态过滤 + 时间排序 | 仅跨用户治理队列需要；若选择率差则不建 |
| `batches(retry_of_batch_id)` | 重试链检查 | 精确来源查询 | 用于环检测和详情；验证频率 |
| `batches(raw_data_retention_until, id)` | 原始数据清理扫描 | 非空截止时间范围 + 稳定游标 | 仅清理任务；不能绕过终态条件 |
| `files(actual_sha256, batch_id)` | 重复 SHA 检查 | 摘要匹配后回连批次做 owner/`read_any` 权限 | 与 `object_key UNIQUE` 不重叠；不得直接泄露命中 |
| `files(storage_status, updated_at, id)` | 协调/清理待办 | 待处理状态 + 老化排序 | 可能与保留索引重叠，需按真实队列验证 |
| `rows(batch_id, sheet_index, row_number)` | TASK02 原始行顺序读取 | 批次过滤 + 工作表/行排序 | 已由唯一约束提供索引时不重复创建 |
| `events(batch_id, created_at, id)` | 事件分页 | 批次可见性先验证 + 时间游标 | 高频详情查询，验证排序方向 |
| `idempotency(state, recovery_until, id)` | 过期 lease/协调扫描 | 状态与恢复截止时间 | 不替代唯一作用域索引 |

唯一约束属于完整性设计，不以“性能候选”方式删除。所有普通索引在 Migration 审阅时必须说明查询、过滤、排序、行权限和已有索引重叠，并在隔离 D1 上用代表性数据验证。

### 12.3 扩展、回填、切换、收缩

- 扩展：只增加新表、约束和经验证索引，不改旧业务表行为。
- 回填：V1 无旧导入批次回填；若未来导入历史元数据，必须另建幂等、可断点任务并逐行报告。
- 切换：只有代码、迁移、绑定、隔离测试和部署审批全部完成后，才允许启用路由。
- 收缩：V1 无破坏性删列。未来状态或字段调整必须新增迁移。

回滚以停止新路由、保留新表和从部署前快照恢复为主；不能假定跨 R2/D1 的简单 down migration 可恢复已经上传的对象。生产执行前必须有 D1 可恢复快照、R2 生命周期/对象清单核对和明确责任人。

## 13. 测试与验收设计（后续实施）

### 13.1 单元测试

- 状态转换、终态与 `terminal_at` 不变量。
- object key 生成、文件名清理、类型检测、实际计数与 SHA。
- multipart 规范化摘要忽略 boundary、原始字节与 Content-Length。
- CSV 文件级安全边界和 XLSX 容器限制。
- owner/`read_any` 可见性、隐藏资源 404、重试环检查。
- 保留截止时间和清理状态转换。

### 13.2 D1/R2 替身集成测试

必须覆盖：

- R2 成功、D1 “已存储”或最终完成失败。
- R2 写入失败与写入结果不确定。
- 响应丢失后的幂等恢复。
- 同一 object key 已存在且哈希/大小一致。
- 同一 object key 已存在但哈希或大小不一致。
- 声明 SHA 与实际 SHA 不一致。
- 取消与上传完成竞争，分别让两方赢。
- 安全检查拒绝但 R2 存储成功。
- 孤立对象发现、候选确认和清理。
- 清理失败后的可恢复状态。
- 测试只使用内存/隔离对象存储和临时 D1，拒绝生产 URL/binding。

### 13.3 Migration 与 API 验收

- 空库升级、已有数据升级、重复执行、失败回滚、CHECK/UNIQUE/FK 约束。
- OpenAPI 响应、稳定错误码、中文安全提示、请求编号。
- 大于应用上限时在流中中止且不进入 `FILE_READY`。
- 不产生业务代码之外的公开对象 URL，不泄露 object key、内部异常或隐藏批次。
- `npm run lint`、`npm test` 和隔离测试数据库上的 `tests/erp-api-smoke.mjs`。

## 14. 12 项待确认决定

以下每一项均保持 `Status: PROPOSED`。推荐方案只是审阅建议，不是已批准决定。

### 决定 1：原始文件存储方式

- Status: PROPOSED
- 可选方案：A. 私有 R2 保存原文件、D1 保存元数据；B. D1 BLOB/Base64；C. Worker 临时文件系统；D. 外部存储服务。
- 推荐方案：A，私有 Cloudflare R2，禁止公开访问；D1 只保存元数据、原始行契约和事件。
- 推荐理由：符合大对象存储边界，避免 D1 行/BLOB 限制和 Worker 临时存储不持久；R2 可通过确定性 key 做恢复。
- Schema影响：需要文件对象元数据、实际哈希/大小、存储与安全状态；不增加文件二进制字段。
- API影响：Worker 服务端代理上传；详情不返回对象 URL 或 object key。
- 安全影响：bucket 保持私有，服务端鉴权访问；禁止客户端 key 和凭证。
- 成本和运维影响：增加 R2 存储、请求、清理、监控和环境隔离成本。

### 决定 2：一个批次允许的文件数

- Status: PROPOSED
- 可选方案：A. V1 单文件；B. 固定少量多文件；C. 任意多文件。
- 推荐方案：A，V1 每批次恰好一个 `.xlsx` 或 `.csv` 文件。
- 推荐理由：把批次版本、状态、重复检测、恢复和后续解析边界保持清晰，先覆盖当前历史物料文件导入场景。
- Schema影响：`material_import_files.batch_id UNIQUE`，批次 `file_count` 约束为 0..1。
- API影响：上传只接收一个名为 `file` 的 part；第二个文件返回 `IMPORT_FILE_ALREADY_ATTACHED`。
- 安全影响：减小 multipart 解析、混合文件类型和资源耗尽攻击面。
- 成本和运维影响：实现和排障成本较低；多文件需求需以后扩展模型和迁移。

### 决定 3：V1 应用级文件大小上限

- Status: PROPOSED
- 可选方案：A. 10 MiB；B. 25 MiB；C. 50 MiB；D. 直接采用 Cloudflare 计划请求体上限。
- 推荐方案：A，10 MiB，并在脱敏历史样本统计与压测后复审。
- 推荐理由：仓库没有历史文件大小证据；需控制 128 MB isolate 内存风险、代理上传超时、XLSX 压缩炸弹和 TASK02 解析成本。平台请求体上限不是业务容量。
- Schema影响：保存实际字节数和可选声明字节数；上限作为版本化应用配置，不写死为数据库事实。
- API影响：Content-Length 可提前拒绝，流式实际计数超限立即中止并返回 `IMPORT_FILE_TOO_LARGE`。
- 安全影响：降低内存/CPU/带宽耗尽和恶意压缩容器风险；仍需 ZIP 展开边界。
- 成本和运维影响：降低 R2、带宽、重试和解析成本；可能需要业务拆分或以后调高。

### 决定 4：原始文件与原始行保留期

- Status: PROPOSED
- 可选方案：A. 终态后 7 天；B. 终态后 30 天；C. 终态后 90 天；D. 永久保留。
- 推荐方案：B，从 `terminal_at` 起 30 天；文件与原始行使用同一基准。
- 推荐理由：为失败排查、映射复核和短期重放保留证据，同时限制敏感业务数据暴露窗口和存储增长。
- Schema影响：批次 `terminal_at`、`raw_data_retention_until`，文件 `retention_until`；原始行通过批次截止时间清理。
- API影响：详情可显示保留截止时间和已清理状态；取消不等于立即删除。
- 安全影响：减少长期暴露；清理必须可审计、幂等且不删除事件历史。
- 成本和运维影响：需要定期清理、失败重试和孤立对象协调；比长期保留降低 R2/D1 成本。

### 决定 5：批次元数据与事件保留期

- Status: PROPOSED
- 可选方案：A. 365 天；B. 1095 天；C. 永久；D. 与原始文件同为 30 天。
- 推荐方案：B，从 `terminal_at` 起 1095 天；到期后的归档/删除使用独立受控流程。
- 推荐理由：支持较长期审计、问题追溯和批次重试链，同时避免默认无限增长；不让原始对象清理顺带删除历史事件。
- Schema影响：批次 `record_retention_until`；事件保持只追加，后续归档方案需另行设计。
- API影响：到期前列表和事件查询可用；未来归档查询或删除响应需单独定义。
- 安全影响：长期元数据应最小化，不保留文件正文、单元格值或内部异常。
- 成本和运维影响：D1 索引和长期数据增长高于短期方案；需要容量监控与归档任务。

### 决定 6：相同 SHA-256 的显式再次导入

- Status: PROPOSED
- 可选方案：A. 永久拒绝重复；B. 默认拒绝，但允许显式 `ALLOW_DUPLICATE`；C. 默认允许；D. 自动复用旧批次结果。
- 推荐方案：B，默认 `REJECT`，用户明确选择 `ALLOW_DUPLICATE` 后创建独立导入证据。
- 推荐理由：防止误重复，同时保留同一来源文件因业务时点或规则变化需要再次处理的能力；不混淆失败重试。
- Schema影响：文件实际 SHA 候选索引；每次允许重复仍有独立批次、文件和事件。
- API影响：`X-Duplicate-Action` 仅接受 `REJECT` 或 `ALLOW_DUPLICATE`；默认返回 `IMPORT_FILE_DUPLICATE`。
- 安全影响：重复查询必须遵守 owner/`read_any`，不得泄露隐藏批次存在或标识。
- 成本和运维影响：允许重复会增加 R2 与后续解析成本；事件可用于监控滥用。

### 决定 7：谁可读取所有人的导入批次

- Status: PROPOSED
- 可选方案：A. 所有人只能看自己；B. 以 `material.import.read_any` 授予指定物料治理/审核人员；C. 所有拥有 read 的用户均可看全部；D. 按硬编码角色判断。
- 推荐方案：B，服务端 capability 控制，初始只授予经确认的物料数据治理、审核或管理账号；具体角色映射在批准时确认。
- 推荐理由：满足协同治理和故障处理，同时保持最小权限；避免 API 与角色名称耦合。
- Schema影响：批次保存 `created_by`；常用 owner 查询候选索引；权限映射沿用现有认证体系。
- API影响：列表、详情、事件、取消和重试来源统一施加 owner/`read_any` 条件。
- 安全影响：隐藏资源返回 404，防止 ID、重复 SHA 和重试链枚举。
- 成本和运维影响：需要维护 capability 映射和定期权限复核；查询需兼顾 owner 与治理队列索引。

### 决定 8：用户可取消的批次状态

- Status: PROPOSED
- 可选方案：A. 仅 `CREATED`；B. `CREATED`、`UPLOAD_PENDING`、`SECURITY_CHECK_PENDING`、`FILE_READY`；C. 任意非终态；D. 包括已终态。
- 推荐方案：B；`RECONCILIATION_REQUIRED` 只能由受控协调流程转为取消。
- 推荐理由：覆盖上传前后但尚未进入解析的用户撤销需求，同时避免普通取消干扰不确定的跨存储协调或终态审计。
- Schema影响：状态 CHECK、CAS 转换、`cancelled_by/at`、`terminal_at` 和删除待办状态。
- API影响：取消要求 `expected_version`；不允许状态返回 `IMPORT_BATCH_STATE_INVALID`。
- 安全影响：取消与上传竞争由 D1 CAS 决定；取消后对象仍需受控删除，不能继续变为 `FILE_READY`。
- 成本和运维影响：可能产生待删或待协调对象，需要异步清理和失败重试。

### 决定 9：失败后的重试方式

- Status: PROPOSED
- 可选方案：A. 原批次原地恢复并清空旧状态；B. 创建新批次并设置 `retry_of_batch_id`；C. 客户端复制全部字段但不建立关系。
- 推荐方案：B，新批次独立文件、事件、版本、审计和幂等记录。
- 推荐理由：保持终态不可变和完整失败证据，避免历史被覆盖；重试链仍可追踪。
- Schema影响：自引用 `retry_of_batch_id`，禁止自指和服务端深层环；不复用旧文件行。
- API影响：创建 API 可提交可见的失败来源批次；隐藏来源按不存在处理。
- 安全影响：引用校验不得泄露他人批次；内部自动重试也受审计和权限边界约束。
- 成本和运维影响：会增加元数据和可能的对象存储，但排障、恢复和审计更简单可靠。

### 决定 10：V1 是否提供原始文件下载

- Status: PROPOSED
- 可选方案：A. 不提供；B. Worker 鉴权代理下载；C. 短期签名 URL；D. 公开 URL。
- 推荐方案：A，V1 不提供下载 API；后续如有审计需求另行设计。
- 推荐理由：当前任务目标是导入基础，不是文件分发；减少权限、内容处置、带宽和 URL 泄露面。
- Schema影响：不需要下载令牌、下载审计或公开地址字段。
- API影响：OpenAPI 不包含下载路径；详情不返回 object key/bucket/URL。
- 安全影响：显著降低原始业务文件外泄风险；内部协调读取仍限服务端。
- 成本和运维影响：减少 R2 Class B、出口链路和下载审计成本；人工取证需受控后台流程。

### 决定 11：V1 是否接入独立文件安全扫描服务

- Status: PROPOSED
- 可选方案：A. 仅 Worker 基础结构/类型检查；B. 接入独立恶意文件扫描服务；C. 不做任何安全检查。
- 推荐方案：A，V1 执行本规格基础检查，并保留在 `STORED` 与通过之间接入扫描器的接口；不宣称具备杀毒能力。
- 推荐理由：当前仓库没有扫描基础设施；基础检查可先拦截错误类型、异常 ZIP 和明显文件级风险，又不虚构未知服务能力。
- Schema影响：独立 `security_check_status` 和安全失败 code，能够以后增加扫描状态/提供方结果。
- API影响：只有基础检查通过才返回 `FILE_READY`；拒绝使用稳定安全错误码。
- 安全影响：基础检查不能发现所有恶意内容；私有存储、禁止执行和后续内容转义仍是必要纵深防御。
- 成本和运维影响：V1 无外部扫描服务费用；未来扫描将增加延迟、费用、供应商管理和失败协调。

### 决定 12：是否新增对象存储基础设施

- Status: PROPOSED
- 可选方案：A. 新增按环境隔离的私有 R2 bucket/binding；B. 共享 bucket 仅靠未审阅前缀；C. 不新增对象存储并把文件放 D1；D. 使用第三方对象存储。
- 推荐方案：A；开发、测试、生产使用独立 bucket，或至少明确隔离前缀与独立 binding，生产创建需再次显式审批。
- 推荐理由：当前 `hosting.json` 的 `r2` 为 `null`，没有可用 binding；私有对象存储是本架构的必要新能力，必须显式治理而不能假装已存在。
- Schema影响：Schema 只保存抽象 object key 与元数据，不绑定公开域名；环境资源名不进入业务数据。
- API影响：实现前路由必须保持不可用或特性关闭；测试通过可注入替身，不依赖远程 binding。
- 安全影响：独立环境降低测试误写生产和跨环境泄露；bucket 必须私有，密钥不得提交仓库。
- 成本和运维影响：新增 bucket、binding、监控、配额、生命周期、备份/恢复演练和生产审批工作；产生 R2 使用费用。

## 15. 规格确认与停止条件

本文件、OpenAPI 草案和数据流图提交后，任务停止在 `PROPOSED`。不得基于推荐方案提前创建任何基础设施或代码。只有收到用户精确回复“规格确认”后，用户选中的决定才能在后续独立任务中转为 `APPROVED`，并进入 Migration 与实现规划。
