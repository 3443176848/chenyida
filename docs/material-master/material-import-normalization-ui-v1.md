# Material Import Normalization Review UI V1

## 0. 文档状态

| 项目 | 值 |
| --- | --- |
| 任务 | `PHASE3-TASK03`（规格）/ `PHASE3-TASK04`（实施） |
| 类型 | UI 规格及非生产前端实施记录 |
| 状态 | `IMPLEMENTED / VALIDATED LOCALLY` |
| 日期 | 2026-07-17 |
| 实施授权 | `PHASE3-TASK04` 已授权非生产前端及直接相关测试；未授权 API、Schema、Migration、业务逻辑、生产迁移或部署 |
| 决策状态 | 项目负责人于 2026-07-17 回复“规格确认”；第 34 节 14 项决定全部为 `APPROVED` |

本规格设计从已确认 Mapping 启动数据归一化、查看异步进度、取消活动任务、审阅当前已发布结果、分页查看规范化行与 Issues，以及在批次作用域 Drawer 中核对单行候选和 Lineage。它不实施 UI，也不改变任何运行时契约。

关联文档：

- [低保真线框](material-import-normalization-ui-v1-wireframes.md)
- [状态矩阵](material-import-normalization-ui-v1-state-matrix.md)
- [104 项测试计划](material-import-normalization-ui-v1-test-plan.md)
- [Normalization 后端规格](material-import-normalization-v1.md)
- [Normalization OpenAPI](material-import-normalization-v1.openapi.yaml)
- [既有 Import Workspace UI](material-import-ui-v1.md)

## 1. 目标与非目标

### 1.1 目标

形成中文、桌面优先、窄屏可用的 Review UI V1：

1. 从 `MAPPING_CONFIRMED` 安全启动或重试 Normalization。
2. 从 `NORMALIZED` 以新 Processor Version 和理由重新运行。
3. 区分 `batch`、`current_run` 和 `latest_attempt`。
4. 展示真实阶段、行处理进度、协作式取消和 `RESULT_UNKNOWN`。
5. 只读审阅 `summary.current_run` 对应的汇总、Rows、Row Detail 和 Issues。
6. 保持权限、幂等、版本、URL、缓存、隐私、可访问性和有界渲染边界。

### 1.2 非目标

V1 不设计或实施：候选编辑、Issue 编辑/解决/忽略、Mapping 原地编辑、自动分类、`category_id` 确认、模糊匹配、去重、AI、Draft 创建、正式导入、正式物料写入、结果删除、原始文件下载、全量 JSON 导出、完整 Run 历史浏览器或生产部署。

`NORMALIZED` 仅表示完整规范化结果已原子发布；它可以包含 `ERROR` 行，不表示分类、匹配、Material Validation 或正式导入完成。

## 2. 已核验契约基线

- POST Normalize：`POST /api/material-master/import-batches/{batchId}/normalize`。
- Summary：`GET /api/material-master/import-batches/{batchId}/normalization`，明确返回 `current_run` 与 `latest_attempt`。
- Rows：`GET /api/material-master/import-batches/{batchId}/normalized-rows`，只支持 `row_status/limit/cursor`。
- Row Detail：`GET /api/material-master/import-batches/{batchId}/normalized-rows/{rowId}`。
- Issues：`GET /api/material-master/import-batches/{batchId}/normalization-issues`，只支持 `issue_level/issue_code/target_code/source_row_number/limit/cursor`。
- Cancel：复用 `POST /api/material-master/import-batches/{batchId}/cancel`。
- Run 状态：`QUEUED/RUNNING/STAGED/PUBLISHING/SUCCEEDED/FAILED/CANCELLED/SUPERSEDED`。
- Run 阶段：`LOAD_MAPPING/READ_SOURCE_ROWS/NORMALIZE_ROWS/VERIFY_RESULT/PUBLISH_RESULT/COMPLETE`。
- Row 状态：`VALID/WARNING/ERROR`。
- 当前前端尚无 Normalization 协议常量、路由状态、组件和写操作类型；这些属于未来实施，不在本任务修改。

## 3. 信息架构与路由

继续使用统一工作区：

```text
/materials/imports/:batchId
```

新增查看位置：

```text
view=normalize | normalized | issues
```

既有 `view=confirmed` 只用于回看已确认 Mapping。不得新增顶层 Normalization 模块、独立 Row 子路由或 URL Run 选择器。

受控参数：

| 范围 | URL 参数 |
| --- | --- |
| Rows | `row_status`、`row_limit`、`row_cursor` |
| Issues | `issue_level`、`issue_code`、`issue_target`、`issue_row`、`issue_limit`、`issue_cursor` |
| Drawer | `row` |

URL 不保存 Payload、Issue 正文、Hash 全值、Run ID、Key、CSRF、理由或来源值。无效参数使用 `replaceState` 修正；筛选变化清除对应 Cursor；Batch 或 Current Run 变化清除失效查看参数。

## 4. 七步 Stepper

1. 文件
2. 解析
3. 表头
4. 字段映射
5. 映射确认
6. 数据归一化
7. 结果审阅

状态语义：

- `MAPPING_CONFIRMED`：前五步完成，第六步当前，第七步锁定。
- `QUEUED_FOR_NORMALIZATION/NORMALIZING`：第六步当前；无旧结果时第七步锁定，有旧 `current_run` 时标记“可回看旧结果”。
- `NORMALIZED`：第六步完成，第七步当前。
- 首次 Attempt 失败且无 `current_run`：第六步失败，第七步锁定。
- 重跑失败/取消且旧结果有效：第六步显示最近尝试辅助状态，第七步仍可访问，不把整个 Stepper 标为失败结束。

状态不能只靠颜色或图标。1366×768 可用短标签或横向滚动；700px 可纵向或滚动展示。

## 5. 前端权威状态模型

必须分别保存：

```text
batch
summary.current_run
summary.latest_attempt
```

- `current_run`：服务端明确返回的当前已发布、可读结果。
- `latest_attempt`：最近一次尝试，可能活动、成功、失败、取消或被替代。
- 不得以 Batch Status、最大 ID、时间或 URL 推断二者。
- 二者 ID 相同时只渲染一份 Run 和计数。
- `latest_attempt` 失败/取消不得覆盖、隐藏或改写仍有效的 `current_run`。

下列矛盾进入安全一致性状态，不由客户端修复：活跃 Batch 无 Attempt、`NORMALIZED` 无 Current Run、活动 Batch 对应终态 Attempt、已发布 Attempt 尚未成为 Current Run，或响应归属/计数冲突。

## 6. View 合法性与落点

| 权威状态 | 默认 View | 其他合法 View |
| --- | --- | --- |
| `MAPPING_CONFIRMED`，无 Current Run | `normalize` | `confirmed` 只读回看 |
| 首次排队/运行，无 Current Run | `normalize` | 无结果正文 |
| 重跑排队/运行，有旧 Current Run | `normalize` | `normalized`、`issues` 只读旧结果 |
| `NORMALIZED` | `normalized` | `normalize`、`issues`、`confirmed` |
| 首次失败/取消，无 Current Run | `normalize` 处置 | 无结果正文 |
| 最近失败/取消，有 Current Run | `normalized` | `normalize`、`issues` |
| `RECONCILIATION_REQUIRED` | 专用处置 | 仅后端明确允许时可读旧结果 |

`view` 只是查看位置。无效 View 使用 `replaceState` 改到最近合法位置。`view=normalize` 时移除 `row`；无 Current Run 时不请求 Row Detail、Rows 或 Issues。

## 7. 启动前复合读取

启动、重试、重跑和取消前重新读取：

1. Batch Detail。
2. Confirmed Mapping。
3. Normalization Summary。

前端只在同一 Generation 的数据全部成功并交叉核验后启用操作。服务端继续最终裁决 Capability、行级可见性、Batch/Mapping/Parse Run/Metadata/Processor Version、活跃 Run 唯一性和版本 CAS。

首次启动要求：`batch.status=MAPPING_CONFIRMED`、Mapping 为 `CONFIRMED` 且绑定当前 Parse Run、无 Current Run、无活动 Attempt、有 `material.import.normalize`、无冲突写及 `RESULT_UNKNOWN`。

## 8. Processor Version

未来前端在单一共享协议模块定义：

```text
MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION = "material-import-normalizer-v1"
```

启动、重试和重跑共用该常量。它不能来自输入框、URL、存储、环境查询参数或时间，也不能在组件中复制字符串。普通页面不突出技术版本；运行详情和重跑说明可显示 API 真实值。

## 9. 首次启动与业务重试

首次请求冻结为：

```json
{"expected_version": 1, "processor_version": "material-import-normalizer-v1"}
```

实际 `expected_version` 使用发送前读取的最新正整数；首次启动省略 `rerun_reason`。

首次失败后的“重试规范化”只在 Batch 已恢复 `MAPPING_CONFIRMED`、`current_run=null`、Latest Attempt 为后端允许重试的终态且无活动 Run 时提供。它使用新 Key、最新版本和当前发布常量，省略理由并创建新 Run。原 Key 等价重放仍属于原操作恢复，不是业务重试。

确认文案必须说明：生成候选快照、不创建物料、允许结果含 ERROR 行。

## 10. 已发布结果后的重跑

“重新运行规范化”只在以下条件成立时提供：

- Batch 为 `NORMALIZED`，Current Run 存在且无活动 Attempt。
- 前端发布常量与 `current_run.processor_version` 不同。
- 有 `material.import.normalize`，无冲突写及 `RESULT_UNKNOWN`。
- API 明确允许从 `NORMALIZED` 启动。

`rerun_reason` 去除首尾空白后必须为 1–500 字，不接受只含不可见控制字符；冻结后不得修改，不写 URL、持久存储或完整日志。相同版本只显示“当前结果已使用本版本处理。”，不得显示按钮。

确认框说明：创建新 Run；旧结果在新 Run 成功发布前保持有效；不修改原始行或 Confirmed Mapping；不创建 Draft；Processor/Metadata 变化可能使结果不同。

## 11. 写操作与幂等

Normalize 与 Cancel 分别维护页面内存记录：

```text
operation_type, key, method, endpoint,
frozen_body, payload_digest, status,
started_at, last_error_code
```

状态为 `READY/PENDING/COMPLETED/FAILED/RESULT_UNKNOWN`。创建记录时冻结序列化后的 Body 字符串并基于它计算摘要；重放直接复用原 Key、Method、Endpoint 和冻结 Body，不重新排序字段、Trim 理由、读取版本或生成 Processor Version。

Key、Body、摘要和理由不持久化。相同操作重复点击共享进行中 Promise；Normalize Unknown 与 Cancel Unknown 互相锁定所有 Normalization 写操作。

## 12. `RESULT_UNKNOWN`

只在写请求已经发送但客户端未获得任何权威响应时进入。明确 4xx、409、422、429 或结构化 500 都是权威失败，不进入 Unknown。

Unknown 时：

- 只允许 GET 和原请求逐字节等价重放。
- 禁止新启动、业务重试、重跑、取消和依赖 Normalization 的冲突写。
- 旧 Current Run 仍可读时，Unknown 横幅不得遮蔽结果正文。
- GET 可显示服务端当前状态，但不能单凭观察到 Attempt 声称原操作成功。
- 离开页面需要确认。

刷新后原凭证不可恢复：不创建伪 Unknown、不显示“重试原请求”，只显示服务端权威状态及“页面已刷新，无法恢复原请求凭证。当前仅展示服务端可确认的状态。”

## 13. 轮询

每轮用同一 Generation 读取 Batch 和 Summary；可串行或并行，但必须全部成功并交叉核验后原子提交 UI。不得拼接新 Batch 与旧 Summary；Batch、组件或 Generation 变化时废弃整轮；禁止重叠请求和旧响应覆盖。

当前轮询会话节奏：

- 0–10 秒：2 秒。
- 10–60 秒：5 秒。
- 60 秒后：10 秒。
- 连续网络失败：5、10、30、30 秒。
- 429：严格按 `Retry-After`。

会话起点不是服务端时间。页面隐藏暂停；重新可见立即刷新；重新进入 Batch 或切换 Latest Attempt 可重启会话节奏。401/403/404 停止并清理。Latest Attempt 终态后停止 Timer，执行一次最终复合读取；失败则按网络退避有界重试，不提前宣称终态。

## 14. 真实阶段与行处理进度

进度绑定 Latest Attempt；旧结果绑定 Current Run。阶段文案：

| Stage | 文案 |
| --- | --- |
| `LOAD_MAPPING` | 正在读取并核对已确认映射 |
| `READ_SOURCE_ROWS` | 正在读取源数据行 |
| `NORMALIZE_ROWS` | 正在生成规范化候选 |
| `VERIFY_RESULT` | 正在核对结果完整性 |
| `PUBLISH_RESULT` | 正在原子发布规范化结果 |
| `COMPLETE` | 数据归一化处理已结束 |
| 未知 | 正在处理规范化任务 |

只有 `total_rows` 与 `processed_rows` 为安全整数、`total_rows>0`、`0<=processed_rows<=total_rows`，且 Run/Stage 允许时，显示 `floor(processed_rows/total_rows*100)`，标签固定为“行处理进度”。不显示 ETA、Queue 位置或总任务完成度。

行处理 100% 但仍在 Verify/Publish 时显示“行处理已完成，正在核对/发布”。只有最终复合读取确认新 Run 已成为 Current Run，才显示“规范化结果已发布，可进入结果审阅。”

`updated_at` 只能称最近状态更新时间；API 无 `heartbeat_at`，UI 不设计 Heartbeat。计数矛盾时隐藏百分比、立即刷新一次；仍矛盾则停止高频轮询并显示安全异常。

## 15. 取消

取消仅在 Batch 为 `QUEUED_FOR_NORMALIZATION/NORMALIZING`、Latest Attempt 为对应活动 Run、有 `material.import.cancel`，且无 Normalize/Cancel Unknown 时显示。不得只依据 Attempt。

冻结请求只含：

```json
{"expected_version": 1, "reason_code": "USER_CANCELLED"}
```

不得发送 Run ID、Processor Version、Stage 或 Current Run ID。取消使用新 Key、最新 Batch Version 和独立记录。

取消是协作式的；发送后不乐观改状态，显示“取消请求处理中”并继续权威读取：

- 发布先胜出：显示最新已发布结果，取消未成功，不回退。
- 取消先胜出且无旧 Current Run：显示首次运行已取消，不显示暂存结果。
- 取消先胜出且有旧 Current Run：恢复旧结果，显示“最近一次重新运行已取消”。

最终落点由 Batch 与 Summary 共同决定，不固定假设 Batch 为 `CANCELLED`。

## 16. 已发布结果汇总

结果页只绑定 `summary.current_run`。展示总行数、VALID/WARNING/ERROR 行数、Issue/Warning/Error Issue 数量以及契约真实时间字段。若 `completed_at` 仅表示 Run 完成，则文案为“规范化完成时间”，不得冒充 `published_at`。

展示前要求安全非负整数，且 `valid_rows + warning_rows + error_rows = total_rows`；Issue 分类计数符合契约。矛盾时不截断、不修正、不展示错误数字，进入安全一致性状态。

运行详情折叠展示实际存在的 Run/Parse/Mapping 引用、`processor_version`、`payload_schema_version`、`mapping_digest`、`metadata_digest`、`result_digest`、`normalized_json_bytes`、`started_at/completed_at/created_at/updated_at`；缺失字段不渲染。Digest 只显示前 8…后 8，不复制，不参与授权或判断。

## 17. Rows 列表

API 参数只有 `row_status/limit/cursor`。URL 对应 `row_status/row_limit/row_cursor`：

- `row_status` Allowlist 为 `VALID/WARNING/ERROR`。
- 默认 50，只允许 50/100；不提供任意数字。
- Cursor 为空读取第一页；筛选、Limit、Batch 或 Current Run 变化时移除。
- 不发送 Sheet、Row Number、Candidate、Sort、Offset 或 Page。

提交响应前核验实际 `batch_id` 与 `normalization_run_id`；任一不一致时整页不展示，不静默过滤。稳定 UI Key 使用公开 Row ID。

主列表只显示：Sheet Index、Source Row Number、Status、Warning Count、Error Count、Source Raw Row Hash 缩略和详情按钮。禁止逐行 Detail 请求或从 Hash/计数推断候选。

## 18. Rows Cursor 与 History

下一页使用 `next_cursor` 和 `pushState`，Marker 为 `normalization-row-page`，只保存 Batch、Current Run、筛选、Limit 和导航类型，不保存正文。

不计算 Previous Cursor。只有当前 Entry 与上一 Entry 均属于同一合法列表链时显示“上一页”并调用 `history.back()`。直接打开 Cursor URL 可读取该页，但不伪造上一页、页码或总页数。

## 19. Row 参数与 Drawer History

OpenAPI 正式定义正整数 `rowId` 为批次作用域公开资源 ID；它不是授权凭证。URL 解析仅接受规范十进制正整数，不接受符号、小数、科学计数、空白、精度变化或超出 API/安全整数边界的值。

打开 Drawer 使用 `pushState`，Marker 为 `normalization-row-drawer`，与分页 Marker 分离；记录安全焦点恢复标识，不保存正文。关闭时，可信 Drawer Entry 使用 `history.back()`；直接 URL、刷新或 Marker 不可信时用 `replaceState` 仅移除 `row`。

`row` 只在 `view=normalized/issues` 且存在 Current Run 时有效。

## 20. Row Detail 加载与归属

直接 URL 顺序：Batch → Summary → Current Run → 校验 Row 参数 → Row Detail → 归属核验 → 打开 Drawer；不要求先加载 Rows。

请求支持 Abort、Batch/Run/Row 变化废弃和 Stale Response 保护。至少核验实际存在的 Batch ID、Normalization Run ID、Row ID、Sheet、Source Row 和 Raw Row Hash；Lineage 对应字段必须一致。任何矛盾都清除正文、移除 Row、显示安全一致性异常，不选择相信某一层继续展示。

404、跨 Batch/Run、旧结果替换或安全隐藏统一为：“该规范化行不存在或当前不可访问。”

## 21. Drawer 结构与焦点

分区顺序：行概览、Basic、Dynamic Attributes、分类提示、供应商引用、Deferred Validation、Issue 上下文、Lineage、支持信息。

打开后初始焦点在标题或关闭按钮，背景不可键盘操作；关闭后依次恢复：原触发按钮 → 当前列表容器 → 页面主标题。700px 下为全宽覆盖层，固定可访问关闭按钮，不创建第二套业务逻辑。

每个 Row 只请求一次 Detail；展开分区不重取；切 Row 废弃旧请求与正文；关闭释放大型对象，不预取下一行或整页详情。

## 22. FieldCandidate 与有界值渲染

实际 FieldCandidate 展示 `target_code/candidate/status/source.kind/source.column_index/source.cell_type/source.value_state/source.blank_kind/source.raw_value`。字段不存在与 Candidate 为 Null、空字符串、False、0、空数组、空对象必须区分；不得用 Falsy 判断。Column Index 0 必须显示。

Candidate 和 Raw Value 使用统一类型化渲染器，区分 String/Number/Boolean/Null/Array/Object，并限制深度、节点、单字符串、数组项、对象属性和总字符预算。超限显示“内容过大，已进行有界展示”，不把剩余内容藏入 DOM，不用无界 `JSON.stringify`、HTML、Markdown 或自动链接。

未知枚举显示通用安全标签及安全 Code，不令整个 Drawer 崩溃。

## 23. Basic 与 Dynamic Attributes

Basic 优先按正式稳定业务顺序，未来未知 Code 追加并按 `target_code` 稳定排序；不假设字段必有。基础稳定 UI 文案可冻结在产品内，支持信息仍显示 Code。

Dynamic Attributes 按稳定 Attribute Code 排序。历史结果未携带标签时只显示 Code，可说明“当前结果未保存历史显示名称”；不得读取当前 Catalog 后冒充历史标签。

## 24. Category Hint、Supplier Reference 与 Deferred Validation

- 标题为“分类提示（非正式分类）”，说明不是 `category_id`、未正式确认、不限制属性展示、未通过分类绑定校验。字段不存在与 Candidate Null 分开文案。
- 标题为“供应商引用候选”，说明不等于内部 Material ID、正式 Supplier ID，也不会创建/关联 Supplier；不生成链接。
- Deferred Validation 只映射真实枚举：仍需确定正式分类；分类后仍需校验绑定属性；尚未执行正式物料校验。未知值显示通用后续校验提示及安全 Code。
- Deferred Validation 为空时不称“全部校验通过”。

## 25. Lineage 与支持信息

普通 Lineage 展示来源 Sheet/Row、来源列/默认值、Cell Type 和 Value State。折叠支持信息只显示 API 实际字段：Row/Run/Parse/Mapping 引用与版本、Processor/Payload Schema、Digest、Row/Payload Hash、Created At 等；不存在不补 Null。

Hash/Digest 只缩略，不写 URL、不复制、不称数字签名、不用于客户端授权。

## 26. Issues 列表

只发送 `issue_level/issue_code/target_code/source_row_number/limit/cursor`。URL 使用 `issue_level/issue_code/issue_target/issue_row/issue_limit/issue_cursor`：

- Level 使用真实 Enum；Limit 只允许 50/100，默认 50。
- Issue Code 按 OpenAPI 字符约束；Target 按长度约束；Source Row 使用规范十进制安全正整数。
- 所有值 URL 编码；筛选/Limit/Run/Batch 变化清除失效参数。
- 不发送 Row Status、Sheet Index、Normalized Row ID、Page、Offset 或 Sort。

响应归属必须绑定 Current Run；异常时整页拒绝展示。列表显示真实 DTO 的 Level、Code、安全标签、Safe Message、Sheet/Row/Column、Target Code 和 Row Detail 入口；Column 0 正常显示。状态同时使用文字与非颜色标识。

## 27. Issues Cursor、Drawer 关联与局部门禁

Issue 下一页 Marker 为 `normalization-issue-page`；规则与 Rows 相同但 Marker 不得混用。Issue DTO 的 `normalized_row_id` 可打开同一 Drawer，并保留 Issue 筛选、Cursor 和列表位置。

当前选中 Issue 可在页面内存展示 Level/Code/Message/Target/Source Context，但不写 History。刷新后不能恢复，显示安全说明并记录非阻塞限制。

Row Detail 只有 `issue_summary`，Issue API 又无 `normalized_row_id` 或 Sheet 筛选，因此：

```text
SCOPED_IMPLEMENTATION_GATE:
ROW_DETAIL_COMPLETE_ISSUE_LOOKUP_NOT_AVAILABLE
```

Drawer 只能显示计数、当前会话选中的单条 Issue、返回列表和“按源行号查看”。后者保留 Level/Code/Target、设置 Source Row、清 Cursor，并提示可能包含其他 Sheet 同号行。禁止无界扫描或标题“该行全部问题”。解除门禁需后端提供 Normalized Row ID 筛选、有界完整 Issue 数组或批次作用域 Issue Detail；本任务不改 API。

## 28. Issue Code 与安全详情

实际映射：

| Code | 中文标签 | 默认安全说明 | 定位 | Level 展示 |
| --- | --- | --- | --- | --- |
| `NORMALIZATION_REQUIRED_VALUE_MISSING` | 必填值缺失 | 未取得必填候选 | 字段 | 服务端 Level |
| `NORMALIZATION_BLANK_VALUE` | 空白值 | 来源为只含空白的文本 | 字段 | 服务端 Level |
| `NORMALIZATION_TYPE_MISMATCH` | 类型不匹配 | 来源类型与目标不兼容 | 字段 | 服务端 Level |
| `NORMALIZATION_ENUM_INVALID` | 枚举值非法 | 候选不在允许范围 | 字段 | 服务端 Level |
| `NORMALIZATION_NUMBER_INVALID` | 数字格式非法 | 候选不是允许的数字格式 | 字段 | 服务端 Level |
| `NORMALIZATION_INTEGER_REQUIRED` | 需要安全整数 | 候选不满足整数约束 | 字段 | 服务端 Level |
| `NORMALIZATION_BOOLEAN_INVALID` | 布尔值非法 | 仅接受允许的布尔格式 | 字段 | 服务端 Level |
| `NORMALIZATION_DATE_INVALID` | 日期非法 | 日期不满足契约格式 | 字段 | 服务端 Level |
| `NORMALIZATION_FORMULA_NOT_EXECUTED` | 公式未执行 | 不使用公式缓存值作为候选 | 字段 | 服务端 Level |
| `NORMALIZATION_SOURCE_ERROR_CELL` | 来源单元格错误 | 来源为错误 Cell | 字段 | 服务端 Level |
| `NORMALIZATION_TEXT_TOO_LONG` | 文本过长 | 超出字段长度上限 | 字段 | 服务端 Level |
| `NORMALIZATION_DEFAULT_INVALID` | 默认值无效 | 默认值不满足目标约束 | 字段 | 服务端 Level |
| `NORMALIZATION_BRAND_UNKNOWN` | 品牌占位值需确认 | 品牌候选需要人工核对 | 字段 | 服务端 Level |
| `NORMALIZATION_ATTRIBUTE_DISABLED` | 属性不可用 | 属性已停用、不可选或 Mapping 目标失效 | 字段 | 服务端 Level |
| `NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED` | 属性单位缺失 | 属性缺少标准单位元数据 | 字段 | 服务端 Level |
| `NORMALIZATION_ATTRIBUTE_UNIT_INVALID` | 属性单位非法 | 标准单位不在允许范围 | 字段 | 服务端 Level |
| `NORMALIZATION_ROW_TOO_LARGE` | 单行结果过大 | 单行规范化结果超过限制 | 行级 | 服务端 Level |
| `NORMALIZATION_ISSUE_LIMIT_EXCEEDED` | 单行问题达到上限 | 仅保留有界问题集合 | 行级 | 服务端 Level |

未知 Code 标为“规范化问题”，保留安全 Code 和服务端 Level，不近似匹配。`safe_message` 仍按不可信纯文本、有界截断和可聚焦详情展示，不放 Title、URL 或日志。

`safe_details` 只允许 `expected_type/allowed_values/decimal_scale/max_length/max_bytes`。每键独立类型与预算校验；整数必须安全非负；数组限制项数和单项字符。未知键和值异常时忽略，不显示键名或完整 JSON。

## 29. 错误与恢复

完整分派列在状态矩阵。原则：优先 Error Code，不把所有 409/422 合并；记录页面状态、安全文案、URL/Current Run 保留、原 Key 重放、轮询和数据清除。

Normalization Codes 覆盖 `AUTH_REQUIRED/FORBIDDEN/IMPORT_BATCH_NOT_FOUND/IMPORT_NORMALIZATION_NOT_ALLOWED/IMPORT_NORMALIZATION_ALREADY_RUNNING/IMPORT_NORMALIZATION_FAILED/IMPORT_NORMALIZATION_LIMIT_EXCEEDED/IMPORT_NORMALIZATION_MAPPING_STALE/IMPORT_NORMALIZATION_METADATA_CHANGED/IMPORT_NORMALIZATION_VERSION_CONFLICT/IMPORT_NORMALIZATION_CANCELLED/IMPORT_NORMALIZED_ROW_NOT_FOUND/IMPORT_NORMALIZATION_QUERY_INVALID/IDEMPOTENCY_KEY_REQUIRED/IDEMPOTENCY_CONFLICT/CSRF_INVALID/RATE_LIMITED/INTERNAL_ERROR/RESULT_UNKNOWN`。

Cancel 兼容 Codes 单独处理：

- `IMPORT_BATCH_STATE_INVALID`：复合刷新，不自动再次取消。
- `IMPORT_BATCH_VERSION_CONFLICT`：采用最新状态，不修改冻结 Body 后重放。
- `IDEMPOTENCY_KEY_REUSED`：显示操作冲突，不自动换 Key，不标 Unknown。

Query Invalid 最多自动规范化并重读一次，避免循环。Mapping Stale 不提供返回编辑；Metadata Changed 失效未提交准备并复合刷新；Limit Exceeded 不读取该 Attempt 暂存结果，有旧 Current Run 时只显示非阻断横幅。

## 30. 权限变化与安全 Return To

- `material.import.read/read_any` 只控制读取和行级可见性；`read_any` 不授予 Normalize/Cancel。
- 启动/重试/重跑分别要求 `material.import.normalize`；取消要求 `material.import.cancel`。
- 不按角色名硬编码；服务端最终裁决。

任何轮询、Rows、Issues 或 Drawer 请求收到 401/403 时，中止全部请求/Timer，清 Batch、Summary、Rows、Issues、Drawer、Issue Context 和写操作，不继续显示旧结果。401 进入现有登录流程；安全 Return To 不带 Cursor、Row 或可能失效的受保护参数。403 显示通用无权限。404 不区分不存在和无权限。

## 31. 安全、隐私与浏览器存储

Payload、Candidate、Raw Value、Safe Message 全文、Safe Details、Key、CSRF、Cursor、Reason、Row Detail 和 Issue 正文不得写日志或第三方分析。安全遥测只可含路由、状态码、Request ID、操作类型、结果数量、筛选存在性和安全枚举/摘要。

上述数据也不得写 Local Storage、Session Storage、IndexedDB、Service Worker 持久缓存或 URL 正文。长内容用可访问的有界详情 Dialog，定义初始焦点、Tab 约束、Escape 和恢复；不把全文预埋 DOM。

## 32. 可访问性与性能实施门禁

```text
PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED
```

未来实施必须验证七步 Stepper、克制 Live Region、状态文字、可见 Filter Label、Rows/Issues 表头、Cursor 按钮名称、Drawer 标题/关闭/背景隔离、三级焦点恢复、安全 Issue 关联、Sticky 不遮挡、不依赖 Hover/拖拽/整行点击，以及 700px 全宽 Drawer。

性能至少测量：50 Rows、100 Issues、200 Attributes、最大 Row Payload、最大 Safe Details、快速筛选、连续翻页、Drawer 开关、Run 切换清理、1366×768、700px、键盘和屏幕阅读器基础语义。必须无 Rows/Issues N+1、无详情预取、无全量 50k/Issues 加载、无大型 History State；关闭 Drawer 与 Run 变化释放缓存；不引入新 Data Grid 或大型状态库。

文档阶段不声称门禁通过。

## 33. 空状态与只读动作

线框覆盖尚未启动、首次排队/运行/失败/取消、重跑中/失败/取消且旧结果有效、0 行、Rows/Issue 筛选空、ERROR/WARNING/Issue 为 0、无 Basic/Attributes、Category Hint 不存在/Null、无 Supplier Reference、Deferred Validation 空、Issue Context 刷新丢失、权限变化、Current Run 更新、Reconciliation 和安全 500。

空状态不得称全部校验通过、已分类、可创建物料或正式导入。只读错误处置只允许刷新、查看来源/Mapping/安全问题、按现有流程新建导入批次，或在 API 允许时重试/重跑。

## 34. 14 项已确认决定

项目负责人于 2026-07-17 在正式规格提交后明确回复“规格确认”，以下均转为 `Status: APPROVED`。该确认批准 UI 规格，不授权开始编码、修改后端契约或操作生产环境；实施仍需独立任务。

| # | 决定 | 可选方案 | 推荐方案与理由 | API 影响 | 前端状态影响 | 权限影响 | 安全影响 | 可访问性影响 | 性能影响 | 复杂度 | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | IA | 独立路由 / 统一工作区 | 统一 `/materials/imports/:batchId`；上下文连续 | 无 | View 状态扩展 | 无 | URL 不越权 | 单一语义流 | 少重复加载 | 中 | APPROVED |
| 2 | Stepper | 六步 / 七步 | 七步；分开 Mapping 确认与结果审阅 | 无 | 增第 6/7 步 | 无 | 不作授权 | 状态更清晰 | 可忽略 | 低 | APPROVED |
| 3 | Mapping Confirmed 落点 | Confirmed / Normalize | Normalize；下一合法动作明确 | 无 | 默认 View | Normalize 控钮独立鉴权 | 不自动发送 | 焦点明确 | 少一次导航 | 低 | APPROVED |
| 4 | Normalized 落点 | Progress / Results | Results；优先审阅已发布结果 | 无 | 默认 View | 只读权限 | 不暴露 Attempt 暂存 | 主标题明确 | 少一次请求 | 低 | APPROVED |
| 5 | Row 详情 | Drawer / Dialog / 路由 | Drawer；保留列表与 URL 恢复 | 无 | `row` + Marker | 仍由 API 鉴权 | 批次作用域核验 | 焦点约束/恢复 | 一次 Detail | 中 | APPROVED |
| 6 | 轮询 | 固定 / 指数 / 分段 | 2/5/10；网络 5/10/30，复用现有模式 | 无 | 单 Generation | 401/403 停止 | 防请求风暴 | 克制播报 | 有界请求 | 中 | APPROVED |
| 7 | 百分比 | 总进度 / 行进度 / 无百分比 | 仅合法 `processed/total` 行进度 | 无 | 校验后显示 | 无 | 不伪造 | 标签清楚 | 常量计算 | 低 | APPROVED |
| 8 | Rows 默认数量 | 20 / 50 / 100 | 50；契约默认与核对密度平衡 | 无 | `row_limit` | 无 | 有界 | 表格可读 | 最多 50 初始 DOM | 低 | APPROVED |
| 9 | Rows 字段 | 候选摘要 / 真实 DTO | 仅真实摘要；避免 N+1 和误导 | 无 | 列表/Drawer 分层 | 无 | 最小披露 | 短表头 | 无 N+1 | 低 | APPROVED |
| 10 | Issue 导航 | Client 全量 / Cursor + Drawer | 真实筛选、Opaque Cursor、Issue→Drawer | 无 | 独立参数/Marker | Read | 不扫描全量 | 表格与焦点关联 | 当前页请求 | 中 | APPROVED |
| 11 | Lineage 展开 | 全开 / 全折叠 / 分层 | 普通来源展开，技术信息折叠 | 无 | Drawer 分区 | Read | Hash 缩略 | 标题层级 | 少初始节点 | 低 | APPROVED |
| 12 | 重跑 | 直接 / Dialog / 独立页 | Dialog + 必填理由 + 新版本 | 无 | 独立 Operation | Normalize | 冻结 Body | 焦点与说明 | 常量开销 | 中 | APPROVED |
| 13 | 窄屏 | 新页面 / 全宽 Drawer | 700px 全宽覆盖，逻辑一致 | 无 | 响应式布局 | 无 | 同一核验 | 关闭按钮固定 | 不重复加载 | 中 | APPROVED |
| 14 | 实施门禁 | 文档通过即实施 / 硬验证 | 先通过性能与可访问性门禁 | 无 | Gate 状态 | 无 | 防无界展示 | 必须实测 | 必须实测 | 中高 | APPROVED |

## 35. 门禁与非阻塞限制汇总

局部门禁：

```text
SCOPED_IMPLEMENTATION_GATE:
ROW_DETAIL_COMPLETE_ISSUE_LOOKUP_NOT_AVAILABLE
```

全局实施门禁：

```text
PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED
```

非阻塞限制：

```text
FULL_NORMALIZATION_RUN_HISTORY_NOT_AVAILABLE
BATCH_DETAIL_CURRENT_NORMALIZATION_RUN_ID_NOT_EXPOSED
ISSUE_FILTER_ROW_STATUS_NOT_AVAILABLE
ISSUE_FILTER_SOURCE_SHEET_INDEX_NOT_AVAILABLE
NORMALIZED_ROW_LIST_CANDIDATE_SUMMARY_NOT_AVAILABLE
IMPORT_BATCH_LIST_NORMALIZATION_STATUS_FILTER_NOT_AVAILABLE
SELECTED_ISSUE_CONTEXT_NOT_RESTORABLE_AFTER_RELOAD
```

这些限制不阻断启动、进度、取消、Current Run 汇总、Rows、Row Detail、Issue 总列表、筛选或 Issue→Drawer；对应缺失功能必须不展示或明确降级。

## 36. 实施边界与验收顺序

本任务仅创建规格、线框、矩阵和测试计划。未来实施必须：

1. 规格确认已于 2026-07-17 完成。
2. 另立实施任务，形成实施计划并重新核验当前契约。
3. 不修改 API 以绕过局部门禁，除非另立后端任务获批。
4. 完成 104 项计划测试、现有 Node 回归和性能/可访问性门禁。
5. 未经独立授权，不连接、迁移或部署生产资源。

## 37. 本任务验证策略

设计提交沿用前一运行时提交的可信基线，并通过文档结构、内部链接/引用、104 项测试编号与分组、37 个线框、状态矩阵、14 项决定、门禁/限制、`git diff --check`、docs-only 范围及用户文件保护检查。规格确认提交只更新决策状态与治理记录，不重复运行无关全量检查。

## 38. `PHASE3-TASK04` 实施结果

2026-07-17 已在现有 `/materials/imports/:batchId` 工作区完成非生产前端实现：

- `material-import-normalization.ts` 集中定义 Processor Version、DTO、URL Allowlist、Rows/Issues API 参数、安全整数、归属/计数核验、Issue 标签、`safe_details` Allowlist 与有界类型化值模型。
- `material-import-normalization-review.tsx` 实现 `batch/current_run/latest_attempt` 双轨状态、2/5/10 复合轮询、启动/业务重试/版本重跑/取消、独立页面内存冻结操作、`RESULT_UNKNOWN` 原请求重放、Current Run 汇总、Rows/Issues opaque cursor、Row Drawer 和权限失效清理。
- 七步 Stepper 与既有 Import Workspace 共用同一路由；`view=normalize|normalized|issues|confirmed`，Rows 使用 `row_status/row_limit/row_cursor/row`，Issues 使用 `issue_level/issue_code/issue_target/issue_row/issue_limit/issue_cursor`。
- Drawer 采用单次详情读取、Batch/Run/Row/Lineage 归属核验、背景隔离、Escape/Tab 约束和三级焦点恢复；700px 下为同一业务逻辑的全宽覆盖层。
- `ROW_DETAIL_COMPLETE_ISSUE_LOOKUP_NOT_AVAILABLE` 保持为局部门禁：只展示 Row `issue_summary`、当前页面内存选中的单条 Issue 和按来源行筛选入口，不伪造“该行全部 Issues”。七项非阻塞限制均保持。
- 未修改 Normalization 后端 API、Schema、Migration、业务服务、依赖或 hosting；未连接、迁移或部署生产资源。

实施后的性能与可访问性门禁已在本地隔离 Mock 中通过：50 Rows 首屏 801 ms、200 动态属性 Drawer 398 ms、100 Issues、最大有界值与五键 `safe_details`、Current Run 切换清理、1366×768、700px、键盘焦点、表格语义、无列表详情 N+1、无控制台警告/错误、无 Storage/大 History State。截图保存在 `chenyida_erp_site/output/playwright/`，不进入 Git。
