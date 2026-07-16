# Material Import Workspace UI V1

> 规格任务：PHASE2-TASK05；实施任务：PHASE2-TASK08
> 文档状态：APPROVED / IMPLEMENTED（非生产）
> 日期：2026-07-17
> 适用范围：在线 `chenyida_erp_site` 的前端交互规格与非生产实现；实施未修改后端 API、数据库、迁移、Metadata、R2、Queue、hosting 或生产环境。

## 1. 目标与非目标

本规格定义物料导入 V1 的批次列表、新建、文件上传、解析、Sheet/Rows 核对、Header 选择、Mapping 保存/预览/确认及异常恢复。服务端状态、权限、版本、幂等结果和已发布数据始终是权威来源。

V1 到 `MAPPING_CONFIRMED` 为止。它不执行数据清洗、自动分类、匹配去重、Material Draft 创建、正式物料创建、正式编码生成或写入 Material Master，也不调用 AI。

## 2. 依据与真实契约边界

UI 只使用现有 Import Batch、Parser 与 Mapping OpenAPI/实现公开的字段和端点：

- `POST /api/material-master/import-batches`
- `POST /api/material-master/import-batches/:batchId/file`
- `GET /api/material-master/import-batches`
- `GET /api/material-master/import-batches/:batchId`
- `GET /api/material-master/import-batches/:batchId/events`
- `POST /api/material-master/import-batches/:batchId/cancel`
- `POST /api/material-master/import-batches/:batchId/parse`
- `GET /api/material-master/import-batches/:batchId/sheets`
- `GET /api/material-master/import-batches/:batchId/rows`
- `GET /api/material-master/import-batches/:batchId/mapping`
- `PUT /api/material-master/import-batches/:batchId/mapping`
- `POST /api/material-master/import-batches/:batchId/mapping/preview`
- `POST /api/material-master/import-batches/:batchId/mapping/confirm`

UI ViewModel 可以规范化真实字段名，但不得要求后端为页面虚构列数、进度、确认人或确认时间字段。当前批次详情未公开解析阶段、heartbeat、完成 Sheet 数、当前行数、百分比或预计时间；confirmed Mapping 也未公开确认人和确认时间。

## 3. 路由、信息架构与 URL

| 路由 | 用途 | 权威数据 |
| --- | --- | --- |
| `/materials/imports` | 批次列表 | 列表 API 与 URL allowlist |
| `/materials/imports/new` | 选文件、预检、SHA、确认后创建并上传 | 页面内存中的 File 身份与写操作结果 |
| `/materials/imports/:batchId` | 单一路由、状态驱动工作区 | 批次详情、Sheets、Rows、Mapping |

工作区使用 Stepper，不拆额外子路由：文件 → 解析 → Sheet 与表头 → 字段 Mapping → Mapping 确认。Stepper 必须区分已完成、当前、尚不可访问、只读可查看、失败/协调；`PARSED` 不是全部完成，`MAPPING_CONFIRMED` 只表示字段对应关系已确认。

`view` 仅为展示意图，不得改变状态、绕过权限、解锁步骤、替代 `current_parse_run_id`/Mapping 状态或触发写操作。刷新后先 GET 服务端状态，再落到合法面板；非法参数使用安全默认并通过 `history.replaceState` 规范化，不将原始非法值回显或送入请求。

合法落点：

| 批次状态 | 合法落点 |
| --- | --- |
| CREATED、UPLOAD_PENDING | `file` |
| FILE_READY、QUEUED_FOR_PARSING、PARSING | `parse` |
| PARSED | `sheet` |
| AWAITING_MAPPING | `sheet` 或 `mapping` |
| MAPPING_CONFIRMED | `confirmed` |
| FAILED、CANCELLED、RECONCILIATION_REQUIRED | 状态处置页 |

保留现有安全 `return_to` 规则。批次、parse run 或权限变化时重新校验全部查看参数。

## 4. 权限与数据清理

能力按服务端 capability 判断，不按角色名硬编码：`material.import.create`、`read`、`read_any`、`cancel`、`parse`、`map`。`read_any` 不隐含 parse/map；前端隐藏或禁用只是体验，服务端继续最终裁决。

- 无 read：不得请求批次正文。
- 无 create：移除新建入口。
- 无 parse：允许读状态，不允许启动解析。
- 无 map：允许读已授权内容，不允许保存、预览或确认。
- 无 cancel：不显示活动取消操作。
- 401：停止轮询，进入现有登录流程并使用安全 `return_to`。
- 页面已加载后收到 403：停止轮询与尚未发送的写准备，移除写操作，清除受保护的批次正文、Rows、Mapping 和本地缓存，显示通用无权限状态。
- 404：停止轮询，显示“导入批次不存在或无权查看”；不利用 403/404 差异推断隐藏资源。

## 5. 批次列表与 cursor

列表 URL 只允许：`status`、`source_kind`、`created_by_me`、`sort`、`limit`、`cursor`。所有值先 allowlist/规范化；筛选、排序或 limit 变化时立即清除 cursor。

cursor 是不透明字符串：不得解析、修改、推断内部结构、写日志或错误详情，只能使用服务端 `next_cursor`。V1 采用“单批结果导航”：首批 URL 无 cursor；“下一批”把真实 `next_cursor` 写入新历史记录并只显示该批结果；后退恢复上一 URL；刷新重取当前 cursor。无 `next_cursor` 时关闭继续前进。不得设计随机页码、总页数、伪造上一页 cursor、无限追加或客户端 cursor 链。

列表只展示 API 实际返回并获授权的批次摘要；文件名只在真实列表投影提供时显示。`total` 仅按服务端真实语义显示，不换算总页数。

## 6. 新建、客户端预检与文件身份

顺序固定为：选择文件 → 客户端预检 → SHA-256 → 用户确认 → 创建批次 → 默认 REJECT 上传 → 重读批次详情。

客户端只检查：单文件、`.xlsx`/`.csv`、非空、不超过 10 MiB、明显扩展名/MIME 异常、清理后的文件名。成功文案只能是“客户端预检通过”，不得表述文件安全、病毒扫描通过、内容已验证或服务端必然接受。服务端检查是唯一权威结果。

当前选择在页面内存中绑定 `File` 对象引用、`name`、`size`、`type`、`lastModified`、`sha256`。同名不等于同一文件。重选立即终止旧 Worker，并清除旧 SHA、重复确认、上传准备、预检结果及不可变摘要。

不得把 File、文件内容、Base64、SHA 操作上下文、幂等 Key、CSRF、上传载荷、Mapping 草稿、preview 有效状态或 RESULT_UNKNOWN 快照写入 localStorage、sessionStorage、IndexedDB、URL、持久缓存或日志。重新打开 CREATED 批次时显示“继续选择并上传文件”，要求重新选择，不自动建新批次，也不恢复本地 File。

## 7. SHA-256

推荐专用 Web Worker 分块读取 File，并使用经审计的小型增量 SHA-256 或兼容验证的 WASM 实现。浏览器原生 `crypto.subtle.digest` 不提供增量摘要；不得对分块分别 digest 后拼接，或将分块哈希简单组合冒充整文件 SHA-256，也不得宣称“原生增量 Web Crypto”。

实施前核验许可证、维护状态、Worker 兼容、Bundle 体积、10 MiB 内存、取消行为和标准测试向量。Worker 按已处理字节报告真实哈希进度且可终止。主线程读取不超过 10 MiB 后调用 `subtle.digest` 仅为待单独批准的受限备选；V1 不实现双方案或静默降级。

## 8. 创建与上传操作记录

创建只在预检、SHA 和用户确认后发生。创建、上传、解析、取消、Mapping 保存、预览、确认各自维护独立操作记录，至少含 Key、method、endpoint、规范化不可变载荷快照/摘要和状态。上传另绑定 batch_id、File 身份、sha256、expected_version、duplicate_action。创建 Key 不得用于上传，REJECT Key 不得用于 ALLOW_DUPLICATE。

写请求发出后响应丢失才进入 RESULT_UNKNOWN。此时不得生成新 Key 或改变载荷，只能以原 Key、原 endpoint、原载荷安全重放；GET 仅辅助判断，不能在所有情况下代替权威幂等结果。明确结构化业务失败不属于 RESULT_UNKNOWN。

创建成功后采用服务端返回的 `batch_id`、`batch_no`、`current_version`。创建结果未知时禁止创建第二批次。

## 9. multipart XHR transport 与进度

共享 API Client 内增加受控 `MaterialImportMultipartTransport`；页面组件不得直接散落使用 XHR。普通 JSON 继续使用现有 fetch transport。两者共用认证 Cookie、CSRF、幂等、登录跳转、结构化错误、request_id 和安全日志规则。

浏览器自动生成 multipart boundary，仅包含一个名为 `file` 的文件 part；只发送真实契约支持的头：CSRF、`Idempotency-Key`、`X-Expected-Version`、`X-File-SHA256`、`X-Duplicate-Action`，以及当前契约允许的可选 `X-File-Size`。文件大小仍以服务端实际字节计数为准，`Content-Length` 由浏览器/传输层处理。

仅当 `event.lengthComputable === true` 显示真实上传百分比，且明确只是浏览器向网络发送字节的进度。达到 100% 后改为“文件已发送，正在等待服务端存储和安全检查”。不可计算时仅显示“正在上传”，不得估算百分比、剩余时间或后端处理完成率。

`xhr.send()` 前取消可安全终止本地准备；send 后取消或连接中断进入 RESULT_UNKNOWN，不得宣称服务端未收到。页面内存保留原 File、Key、摘要、duplicate_action、expected_version；禁止新建批次、新 Key 或反向 action，只允许原操作重放或读取状态辅助判断。

## 10. 重复文件

默认 `REJECT` 命中重复时，真实行为是当前批次进入终态 FAILED；页面显示“重复文件，上传未完成”，说明当前批次已失败、未创建解析结果、未复用其他批次、未创建 Material Draft。不得把原 FAILED 批次恢复为 FILE_READY。

用户明确允许重复后的恢复流程：确认原批次仍为 FAILED 且安全 `failure_code` 为重复结果；保留或重选同一文件并重新预检/SHA；SHA 一致后创建新批次，`retry_of_batch_id` 指向原批次；创建与上传均使用新 Key、最新版本，上传 action 为 `ALLOW_DUPLICATE`；随后重读新批次。不得复用原 Key、修改原批次或泄露命中的其他批次。

File、SHA、大小、原批次、状态、failure_code 变化，页面刷新丢失 File，或新批次创建结果未知，都会使允许重复确认失效。无可见关联信息时只显示“检测到内容相同的历史导入文件”。

## 11. 启动解析

按钮可用必须同时满足：状态 FILE_READY、安全检查 `BASIC_CHECK_PASSED`、拥有 `material.import.parse`、无进行中的创建/上传/取消/Mapping 写、无 RESULT_UNKNOWN、数据为最新。

点击后重新 GET 批次，核对 batch_id、状态、安全结果和最新 `current_version`，再显示确认并以独立 Key 调用 parse。`parser_version` 是共享协议常量，不是用户输入，不从 URL/存储/表单读取；服务端 allowlist 才是权威，常量过期按稳定错误处理，不猜版本。

确认说明：公式不会执行；hidden/very-hidden Sheet 不写业务原始行且不用于 Mapping；不会创建 Material Draft 或正式编码；解析可能需要时间。不得承诺成功、精确时间、所有 Sheet 可映射或业务校验完成。

## 12. 轮询与粗粒度进度

V1 不用 SSE/WebSocket。单一 Polling Controller 串行请求：开始后 0–10 秒每 2 秒，10–60 秒每 5 秒，60 秒后每 10 秒；10 秒是前台正常状态的最大间隔上限。网络错误按 5、10、30 秒退避，后续保持 30 秒。429 严格遵循 Retry-After（秒数或 HTTP 日期），无法解析时使用安全退避，期限前不请求。

轮询只在同一 batch_id 工作区运行；页面隐藏暂停，重新可见立即刷新一次；稳定状态、卸载或 batch 变化停止；手动刷新始终可用。使用 AbortController、请求序号和单定时器，防重叠、防旧响应覆盖、防离页更新。页面隐藏不得中止已发送上传/写操作。

活跃：UPLOAD_PENDING、QUEUED_FOR_PARSING、PARSING、PARSED + preparation 为 NOT_STARTED/QUEUED/RUNNING。稳定：CREATED、FILE_READY、AWAITING_MAPPING、MAPPING_CONFIRMED、FAILED、CANCELLED、RECONCILIATION_REQUIRED、PARSED + FAILED。PARSED + READY 立即重读一次，仍未进入 AWAITING_MAPPING 时转正常有界轮询，不紧密循环、不由客户端推进。

QUEUED/PARSING 只展示真实状态、安全文案、`updated_at`（标为“最近更新时间”）、手动刷新和合法取消。不得从更新时间、文件大小、等待时间、events、Outbox、Queue 或内部状态推断阶段、heartbeat、行数、百分比或 ETA。

## 13. PARSED 与 Mapping preparation

进入 PARSED 后读取 `/sheets`：

- NOT_STARTED/QUEUED/RUNNING：可看已发布 Sheets/Rows，Mapping 锁定，显示“解析结果已发布，正在准备字段映射”，继续轮询。
- FAILED：批次仍为 PARSED，显示“解析结果已发布，但字段映射准备失败”；不误称解析失败、不重新 parse、不伪造重试。提供刷新和联系管理员说明。
- READY：重读批次，等待服务端进入 AWAITING_MAPPING；不由客户端解锁 Mapping。

## 14. 取消与竞争

实际可取消状态：CREATED、UPLOAD_PENDING、FILE_READY、QUEUED_FOR_PARSING、PARSING。操作前重读详情，以最新 expected_version、独立 Key、CSRF、契约允许的固定安全 reason_code 和不可变载荷请求，由服务端最终裁决。

文案分别说明：CREATED 取消空批次；UPLOAD_PENDING 取消不表示对象立即删除；FILE_READY 后文件不再进入解析但按保留/清理策略处理；QUEUED 是请求阻止尚未完成结果发布，不承诺物理删除队列消息；PARSING 是协作式取消，后台可短暂计算，但成功后旧任务不得发布。

取消 CAS 先成功，旧解析不得发布；解析发布先成功，旧版本取消应冲突。冲突后重读状态，不以新 Key 自动重试旧载荷，不回退已发布结果。解析 RESULT_UNKNOWN 时禁止取消/再解析/上传；取消 RESULT_UNKNOWN 时禁止解析/新取消/其他冲突写，均只允许原操作重放或 GET 辅助。

## 15. Sheet、Rows 与 Header

PARSED、AWAITING_MAPPING、MAPPING_CONFIRMED 后读取 `/sheets`，按 `sheet_index` 稳定排序。列结构使用 `/sheets` 或 `/rows` 真实返回的列数、最大列索引或等效字段，经 ViewModel 规范化，不要求后端新增字段。Sheet 可选性同时依据 visibility、是否已解析业务行、批次状态和 `material.import.map`。hidden/very-hidden 只显示安全元数据，不请求业务 Rows。

查看 URL 允许 `view=sheet`、`sheet=<整数>`、`row_page=<正整数>`、`row_page_size=<allowlist>`；sheet 必须与服务端 Sheet 列表核对。sheet/page size 变化将 page 重置为 1；batch/run 变化全部重验；这些参数不代表正式 Mapping 选择，也不能绕过权限、可见性、parse run 或 Mapping 状态。

Rows 使用 `GET /rows?sheet_index=N&page=P&page_size=S`，默认 50，UI 初始只提供 20/50。API 允许的 100 只有完成 1366×768、256 列和低性能设备验收后才能开放。禁止全量 50,000 行、无界拼接、假页码、混用 page 与 start/end、把当前页数量当总行数。

原始 Rows 浏览保留真实 `row_number`、候选表头和服务端分页；不因 header 选择删除/重编号。Mapping 样本另行有界生成：SINGLE_ROW 从 header 后取样，NO_HEADER 从首个源数据行取样，不改变原始行。

AWAITING_MAPPING 先读当前 Mapping：已有未确认版本以其 sheet/header 为编辑基线；没有 Mapping 才把服务端 Header suggestion 标为建议。正式选择随 `PUT mapping` 持久化，不新增独立确认接口，URL sheet 不覆盖已保存选择。MAPPING_CONFIRMED 以确认记录为准。

Header 只允许 SINGLE_ROW、NO_HEADER。SINGLE_ROW 必须属于当前 run 和可选 Sheet；重复/空标题以 `source_column_index` 与 column_ref 区分，不拼多行。NO_HEADER 用 COLUMN_A…COLUMN_IV 作为展示标签，索引仍为身份，source_header 按真实契约表达。列字母必须覆盖 A、Z、AA、AZ、BA、IV。

## 16. 单元格、表格与性能

区分：cell 对象不存在（未提供）、EMPTY（明确空单元格）、TEXT 且 `value=""`（空文本）、NUMBER、BOOLEAN、DATE、FORMULA、ERROR。JSON null 仅按所属字段解释，如无缓存值或日期未解释，不能作为新 cell 类型。

DATE 详情可看 source_type、raw_value、date_system、format_code、interpreted_iso_value、interpretation_status；失败保留原始值并写“日期解释失败”。FORMULA 写“公式，未执行”，公式纯文本，cached value 标“不可信缓存值”。ERROR 只显示安全类型/code，不执行、不修复、不暴露内部路径或堆栈。

表格横向滚动、sticky 行号列和标题行，不截断列。普通单元格不进入 Tab 顺序；滚动容器可聚焦，展开按钮等真实控件进入 Tab。长内容默认安全摘要，按钮打开有界纯文本详情，支持键盘/Escape/焦点恢复，不用 `dangerouslySetInnerHTML`，不把全部长文本预置进 DOM。

Gate: `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`。50×256 是实施硬验收，记录初次渲染、翻页、横向滚动、sticky、展开、键盘、DOM、内存、屏幕阅读器、1366×768 与窄屏。未通过则停止该部分并另立列窗口化/轻量虚拟化任务；不得静默减列、只渲染前若干列或自行引入大型 Data Grid。

## 17. Mapping 编辑、保存与预览

1366×768 使用三列对照：来源、目标、问题同一行；窄屏按来源列拆成完整单列映射单元，保持来源→目标→问题顺序，不依赖拖拽。

一个 `source_column_index` 最多一个 item；每个非 ignore 业务目标最多映射一个源列；多个源列可分别 ignore；无 item 是“尚未处理”，ignore 是明确忽略。目标使用真实稳定 namespace/code，不由 UI 改写。现契约要求的 `basic.standard_name`、`basic.unit` 可在草稿缺失，但预览阻断、确认禁用，服务端最终校验。

默认值只使用契约允许的 mapping_mode、default_value_json/等效字段及受限 scalar；不得新增表达式、JSONPath、模板、多列拼接、条件计算、SQL、JavaScript 或公式执行。每列最多显示 3 个真实安全样本，来自当前有界 Rows 或 preview，不全表扫描。

进入 AWAITING_MAPPING 依次读取详情、当前 Mapping、Sheets 和未来真实 target catalog。已有 Mapping 是权威基线，本地修改为 dirty 副本；无 Mapping 才使用建议且不自动保存。

PUT 保存完整规范化 Mapping，绑定 batch expected_version、current_parse_run_id、Mapping current_version、sheet/header、items、CSRF 与独立 Key。成功后采用服务端版本并清除对应 dirty；VERSION_CONFLICT 不覆盖，run 变化将副本标为 STALE。

可计算冻结规范化算法的 Mapping payload digest 作为页面新鲜度标记：按正式载荷字段和稳定键序列化，不含 UI 排序/展开/标签、request_id、CSRF、Key。它不是安全证明、metadata 证明、幂等 Key、凭证或确认 token。

preview 条件：AWAITING_MAPPING、Mapping 已成功保存、无 dirty、sheet/header 属于当前 run、Mapping 非 STALE、无进行中写/RESULT_UNKNOWN。preview 必须针对服务端已保存版本。页面内存绑定实际存在的 batch/run/batch version/mapping id（若有）/mapping version/payload digest/metadata digest/request snapshot/Key/request_id；request_id 只用于支持。

本地修改、重新保存、版本/sheet/header/batch/run/status变化、刷新、重取不一致或 metadata/目标冲突都使 preview 失效。当前 API 无持久 preview token，因此前端门禁不是防篡改证明；confirm 服务端重读和校验才是安全边界。

## 18. Mapping 确认与 Metadata 漂移

确认前依次重读批次、Mapping、Sheets，核对 AWAITING_MAPPING、batch/Mapping 版本、run 与当前页面最新 preview 绑定，显示最终确认，再以独立 Key 调用 confirm；服务端在 confirm 时重读当前 metadata 并裁决。成功后重读并确认 MAPPING_CONFIRMED。

确认文案明确只确认字段对应关系，不创建 Draft/正式物料/编码，不清洗、分类、匹配、去重或调用 AI。成功后只读，清除 dirty/preview，关闭保存/预览/确认，不显示“开始正式导入”或伪重新编辑。

metadata/target 冲突时保留可恢复 Mapping、使 preview 失效、重读批次/Mapping/Sheets；catalog 可用后重载，标记失效目标，要求重新保存/预览/确认。不得自动删除或替换目标。

当前 confirmed 响应不提供确认人/确认时间，因此页面只显示真实状态、版本、run、sheet/header、items；不从事件历史推断正式字段。

### Implementation Gate: RESOLVED

PHASE2-TASK07 已实现并测试独立只读 `GET /api/material-master/import-batches/:batchId/mapping-targets`，共享 Registry/Snapshot/digest 已被 Catalog、Mapping 准备、保存、preview 和 confirm 共同使用，OpenAPI 已更新，因此 `BLOCKED_BY_MAPPING_TARGET_CATALOG` 标记为 `RESOLVED`。

接口安全返回 target_namespace、target_code、display_name、value_type、unit_policy、enabled/selectable、必填/约束摘要和 metadata_digest；动态属性来自运行时 D1 ACTIVE metadata。接口要求 read + map + 批次行级可见性，返回有界 BASIC/ATTRIBUTE/SPECIAL 分组，不暴露 SQL、列名、内部 ID 或禁用目标。仍禁止 seed、前端硬编码、测试数据枚举、attribute_id、历史 Mapping 反推或只实现基础字段冒充完整 UI。

本门禁解除不代表 Import Workspace UI 已实施。完整 UI 仍须先通过 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`，本任务不开始前端实现。

## 19. 失效、dirty 与对话框

切换 Sheet 清除 Header 本地选择、Mapping 编辑、preview、重复目标和字段校验；修改 Header 清除 preview、列标题缓存并重验 items；parse_run 变化清除 Sheet、Rows 缓存、Header、Mapping 编辑、preview、metadata 绑定和旧写准备。dirty 时切换 Sheet/Header 或离开页面必须确认；取消则保留原状态。

所有对话框定义初始焦点、Tab 循环、Escape、关闭后焦点恢复。请求未发送时可取消/Escape；发送后按钮 busy、防重复，不得仅关闭并假装未发送，网络中断按 RESULT_UNKNOWN；上传取消按 send 前/后语义。

## 20. 组件边界

复用：MaterialShell、Session/权限、安全 return_to、共享 API Client、CSRF/幂等原则、MaterialErrorState、现有对话框与 Unsaved Guard、日期与纯文本格式化、现有 Material 视觉语言。

新增：MaterialImportListPage、MaterialImportCreatePage、MaterialImportWorkspace、MaterialImportStepper、MaterialImportHashWorkerController、MaterialImportMultipartTransport、MaterialImportPollingController、MaterialImportSheetSelector、MaterialImportRowPreview、MaterialImportHeaderSelector、MaterialImportMappingEditor、MaterialImportTargetSelector、MaterialImportMappingPreview、MaterialImportActions、MaterialImportUnsavedGuard、MaterialImportStatusBadge、MaterialImportCursorNavigation。

导入 StatusBadge 与 DRAFT/PENDING_REVIEW/ACTIVE 等物料生命周期 badge 分离；cursor navigation 不复用页码型 MaterialPagination。禁止引入新状态、表单、请求、表格、拖拽或大型 UI 库。

当前共享 Client 的受保护写识别只覆盖 POST/PATCH，尚未覆盖 Mapping PUT。未来实施必须在同一 Client 边界内扩展 PUT 的 CSRF、显式幂等 Key、错误归一化和登录处理；这不是新建第二套 Client。本 docs-only 任务不修改该运行时代码。

## 21. 错误归一化与恢复矩阵

实际 Import handler 错误形态为顶层 `request_id` 加嵌套 `error.code/message`；其他既有契约可能把 request_id 放在 `error.request_id`。未来共享 Client 只读归一化优先采用正式嵌套字段，兼容经核验的顶层字段，并输出 `error.code`、安全 message、request_id、details、Retry-After；本任务不修改后端，也不直显完整原始错误。

| 实际 code/类别 | UI 状态与安全文案 | 保留输入 | 原 Key 重放 | 停轮询 |
| --- | --- | --- | --- | --- |
| 401/认证 | 登录已失效 | 否；清受保护正文 | 否 | 是 |
| 403/权限 | 当前无权继续 | 否；清正文/Rows/Mapping | 否 | 是 |
| 404/资源隐藏 | 批次不存在或无权查看 | 否 | 否 | 是 |
| 状态冲突 | 状态已变化，已刷新 | 可恢复 dirty | 否；重读后新意图 | 视新状态 |
| VERSION_CONFLICT | 版本已变化，请核对 | 是 | 否 | 否 |
| IDEMPOTENCY_CONFLICT | 同一操作标识绑定了不同请求 | 是 | 仅核对，不自动换 Key | 否 |
| 幂等处理中 | 操作仍在处理 | 是 | 是，原载荷；或等待 | 否 |
| IMPORT_FILE_DUPLICATE | 重复文件，上传未完成 | 保留同一 File 时是 | 否；按新批次流程 | 是 |
| 文件安全/存储/资源失败 | 文件未完成服务端检查或存储 | 视终态与 File 身份 | 仅 unknown 时 | 是 |
| Parser 失败 | 文件解析失败 | 不重启旧操作 | 否 | 是 |
| Mapping 422 | 请修正标记字段 | 是 | 否；修正后新操作 | 否 |
| IMPORT_MAPPING_TARGET_INVALID / metadata 冲突 | 映射目标已变化，请重新核对 | 是 | 否 | 否 |
| 429 | 请求过于频繁，按 Retry-After 等待 | 是 | 原操作规则 | 暂停至期限 |
| 5xx 明确结构化失败 | 服务暂时不可用；显示 request_id | 是 | 仅契约允许 | 退避 |
| 网络中断且写已发送 | 操作结果尚未确认 | 是，页面内存 | 是且只能原 Key/载荷 | 写依赖暂停 |

Mapping details 仅将安全字段映射到 source_column_index、target_code、default_value、Header、Sheet 或顶部问题区；不得把内部路径当 DOM selector、显示数据库名/HTML，或因单项错误清空整个 Mapping。

## 22. 可访问性与窄屏

Stepper、状态、dirty、ERROR/WARNING 不只靠颜色。文件选择和目标选择有可见 label；状态更新使用克制 live region；Rows 保留行列标题和可聚焦滚动区；Mapping 来源/目标/问题程序化关联，错误用 `aria-describedby`；重复目标标记所有冲突列。sticky 区不遮挡内容、焦点或滚动条。

窄屏将 Sheet 选择移至表格上方，Rows 保持横向表格，不转 256 字段卡片、不隐藏列；Mapping 逐来源单列化。核心操作不依赖 hover、整行点击或拖拽。

## 23. 实施顺序与门禁

1. 完成本次 UI 设计文档。
2. 单独设计 Mapping Target Catalog 只读 API。
3. 实现并测试 catalog 兼容能力。
4. 更新 OpenAPI。
5. 通过 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 后实施完整 Import Workspace UI。

解析粗粒度进度和 confirmed 缺少确认人/时间是已接受的非阻断降级；target catalog 缺口和 50×256 验收是硬门禁。

## 24. 16 项设计决定

以下 16 项推荐已由项目负责人通过 `PHASE2-TASK08` 指令批准，作为本次非生产 UI 实施约束。

| # / 决定 | 可选方案 | 推荐方案与理由 | API 影响 | 前端状态影响 | 安全影响 | 可访问性影响 | 性能影响 | 实施复杂度 | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 路由与工作区 IA | 多子路由 / 单工作区 | 三条顶层路由 + 状态驱动单工作区；刷新恢复明确 | 无新增 API | view 非权威、统一恢复 | 防 URL 绕状态/权限 | 单一 Stepper 语义连续 | 少重复加载 | 中 | APPROVED |
| 2 创建前是否选文件 | 先建空批次 / 先选文件 | 先选、预检、SHA、确认，再建批次；减少空批次 | 调用顺序变化，契约不变 | File 身份先于创建操作 | 降低误建与重复建 | 确认点清楚 | 多一次本地哈希 | 中 | APPROVED |
| 3 SHA-256 | 整文件 subtle / Worker 增量 / 主线程库 | Worker + 经审计增量实现；响应且可取消 | 无 | Worker 生命周期绑定 File | 哈希非凭证，服务端复核 | 真实进度 live region | 分块、低主线程阻塞 | 中高 | APPROVED |
| 4 multipart transport | fetch / 共享 Client 内 XHR | 受控 XHR adapter；获得真实 upload 事件且不分裂 Client | 真实头和 multipart 不变 | 独立上传操作记录 | 复用 auth/CSRF/错误/幂等 | 可播报阶段与取消结果 | 真实事件，无伪进度 | 中 | APPROVED |
| 5 上传进度 | 阶段 / 精确百分比 | lengthComputable 时百分比，否则阶段文案 | 无 | send 100% 后仍等待服务端 | 不误称安全检查完成 | 文本同步表达 | 事件开销低 | 低 | APPROVED |
| 6 轮询节奏 | 固定 / 指数 / 分段有界 | 2s→5s→10s；网络 5/10/30s，429 Retry-After | 无 | 单 controller、active/stable | 防请求风暴 | 克制 live region | 有界请求 | 中 | APPROVED |
| 7 Stepper 或 Tabs | Tabs / Stepper | Stepper；能表达完成、当前、锁定、只读和失败 | 无 | 状态驱动合法步骤 | 不作为授权边界 | 状态文字不只颜色 | 可忽略 | 中 | APPROVED |
| 8 Rows 默认 page_size | 20 / 50 / 100 | 默认 50，UI 20/50；兼顾核对与 DOM | 使用真实分页 | 页码/size URL 化 | 不扩大数据访问 | 表格语义仍完整 | 50×256 需硬验收 | 中高 | APPROVED |
| 9 Mapping 布局 | 三列 / 卡片 / 矩阵 | 1366 三列，窄屏单映射单元；便于同一行核对 | 无 | dirty 以 source 为单元 | 明确错误归属 | label/description 关联 | 有界样本 | 中 | APPROVED |
| 10 样本数量 | 0 / 3 / 更多 | 每来源最多 3 个真实样本；足够核对且有界 | 不新增 sample API | 来自当前 Rows/preview | 纯文本、最小披露 | 类型有文字 | 不全表扫描 | 低中 | APPROVED |
| 11 动态目标选择 | 硬编码 / 平铺 / 可搜索分组 catalog | **Recommended: 可搜索分组 Catalog**；动态、稳定、可核对。**Implementation Gate: RESOLVED BY PHASE2-TASK07** | 已新增批次作用域只读 Catalog 并更新 OpenAPI | catalog digest 绑定编辑/preview | 认证授权、不泄露内部 ID | 可见 label、键盘搜索/分组 | 有界分组 | 高 | APPROVED |
| 12 自动或显式保存 | 自动 / 显式 | 显式保存；清楚建立服务端基线和 preview 依赖 | 使用现有 PUT | dirty、saved、unknown 分开 | 避免隐式写和竞态 | 状态文字明确 | 减少写请求 | 中 | APPROVED |
| 13 确认前最新预览 | 可选 / 强制 | 当前页面会话强制最新 preview；帮助核对但不冒充服务端证明 | 无 token 新增 | 绑定版本/digest，刷新失效 | confirm 服务端仍最终校验 | 问题摘要可导航 | 一次有界请求 | 中 | APPROVED |
| 14 confirmed 默认落点 | 保留编辑 / 只读摘要 | `confirmed` 只读；不显示正式导入入口 | 只读现有响应 | 清 dirty/preview/写操作 | 防伪造后续业务 | 状态清晰 | 低 | 低 | APPROVED |
| 15 列表默认筛选排序 | 仅我的 / 全部可见；多种排序 | 无 status/source 筛选、`created_by_me=true`、`created_at_desc`、`limit=50`；均沿用真实 API 默认，服务端仍执行行级可见性 | 仅真实 query | URL 规范化，cursor 清除 | 不用 read_any 推断可见数据 | 控件有 label | 单批 50 条 | 低中 | APPROVED |
| 16 窄屏降级 | 卡片 / 隐藏列 / 横向表格 | Rows 横向完整表格；Mapping 单列映射单元 | 无 | Sheet selector 上移 | 不因布局扩大/隐藏数据 | 保持阅读/焦点顺序 | 横向滚动、有界 DOM | 中 | APPROVED |

## 25. 未来实施测试计划（100 项）

所有写测试只能连接隔离本地环境，不连接生产 D1、R2 或 Queue。`写=是` 表示必须使用隔离环境；API 模拟不产生真实外部写入。

### A. 路由、权限与列表（UI-001—UI-020）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 |
| --- | --- | --- | --- | --- | --- |
| UI-001 | 有 read | 打开列表 | 请求并显示可见批次 | 集成 | 否 |
| UI-002 | 无 read | 打开列表 | 不请求正文，显示无权限 | 组件 | 否 |
| UI-003 | 无 create | 查看列表 | 新建入口不存在 | 组件 | 否 |
| UI-004 | 仅 create/read 自己 | 查看列表 | 仅呈现服务端可见结果 | API 模拟 | 否 |
| UI-005 | 有 read_any 无 parse | 打开 FILE_READY | 状态可读、解析按钮移除 | 组件 | 否 |
| UI-006 | 有 parse 无 map | 打开 AWAITING | Mapping 只读、无写操作 | 组件 | 否 |
| UI-007 | 有 map 无 cancel | 打开可取消批次 | Mapping 权限不产生取消按钮 | 组件 | 否 |
| UI-008 | 页面已加载 | 刷新返回 403 | 清正文/Rows/Mapping并停轮询 | 集成 | 否 |
| UI-009 | detail 返回 404 | 打开工作区 | 显示统一隐藏文案 | 组件 | 否 |
| UI-010 | 会话过期 | 轮询返回 401 | 停止并走安全登录流程 | 集成 | 否 |
| UI-011 | URL 含非法 status | 打开列表 | 默认值请求，replaceState 清理 | 组件 | 否 |
| UI-012 | URL 含未知参数 | 打开列表 | 未知值不进入 API | 单元 | 否 |
| UI-013 | 首批有 next_cursor | 点击下一批 | opaque cursor 写入新历史 | 组件 | 否 |
| UI-014 | 当前 URL 有 cursor | 刷新 | 仅重取该批结果 | 集成 | 否 |
| UI-015 | 已进入第二批 | 浏览器后退 | 恢复前一 URL/结果 | Playwright | 否 |
| UI-016 | 无 next_cursor | 查看导航 | 下一批禁用 | 组件 | 否 |
| UI-017 | 当前有 cursor | 改 status | cursor 立即清除 | 单元 | 否 |
| UI-018 | 当前有 cursor | 改 sort/limit | cursor 清除并重取首批 | 组件 | 否 |
| UI-019 | cursor 含特殊字符 | 发请求/报错 | 原样作为参数且不写日志/详情 | 集成 | 否 |
| UI-020 | 列表返回 total | 查看页脚 | 不推导页码或总页数 | 组件 | 否 |

### B. 文件、SHA、创建与上传（UI-021—UI-040）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 |
| --- | --- | --- | --- | --- | --- |
| UI-021 | 未选文件 | 提交 | 显示单文件要求，不创建 | 组件 | 否 |
| UI-022 | 选择两个文件 | 预检 | 拒绝且不哈希 | 组件 | 否 |
| UI-023 | 选择空文件 | 预检 | 显示非空错误 | 单元 | 否 |
| UI-024 | 选择 >10 MiB | 预检 | 拒绝且不创建批次 | 单元 | 否 |
| UI-025 | 选择非 xlsx/csv | 预检 | 扩展名错误 | 单元 | 否 |
| UI-026 | MIME 明显冲突 | 预检 | 提示异常且不称安全 | 组件 | 否 |
| UI-027 | 合法文件名含控制字符 | 展示 | 只显示清理后纯文本 | 单元 | 否 |
| UI-028 | 预检成功 | 查看文案 | 仅写“客户端预检通过” | 组件 | 否 |
| UI-029 | Worker 哈希中 | 查看页面 | 主线程可交互且进度按字节 | Playwright | 否 |
| UI-030 | Worker 哈希中 | 重选文件 | 旧 Worker 终止、旧状态失效 | 组件 | 否 |
| UI-031 | 已算 SHA | 选择同名不同 File | 重新哈希，不视为同一文件 | 单元 | 否 |
| UI-032 | 标准 SHA 测试向量 | 执行 Worker | 得到整文件正确摘要 | 单元 | 否 |
| UI-033 | 哈希失败 | 查看状态 | 不创建批次，可安全重选 | 组件 | 否 |
| UI-034 | 预检/SHA 未完成 | 点击确认 | 创建 API 不调用 | 组件 | 否 |
| UI-035 | 已确认 | 创建成功 | 采用服务端 id/version 进入上传 | 集成 | 是 |
| UI-036 | 创建响应丢失 | 恢复 | 只允许原 Key/载荷重放 | 集成 | 是 |
| UI-037 | 创建 unknown | 再点新建 | 禁止第二批次与新 Key | 组件 | 否 |
| UI-038 | XHR 组装 | 发送上传 | 仅 file part，浏览器 boundary，真实头 | 集成 | 是 |
| UI-039 | lengthComputable=true | 上传 | 百分比只表达网络字节 | 组件 | 否 |
| UI-040 | lengthComputable=false | 上传 | 仅显示“正在上传” | 组件 | 否 |

### C. 上传恢复、重复、解析与取消（UI-041—UI-060）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 |
| --- | --- | --- | --- | --- | --- |
| UI-041 | 上传到 100% | 等待响应 | 切换服务端存储/安全检查文案 | 组件 | 否 |
| UI-042 | send 前准备中 | 取消 | 本地终止，不进 unknown | 组件 | 否 |
| UI-043 | send 后 | 取消 XHR | 进入 RESULT_UNKNOWN | 集成 | 是 |
| UI-044 | 上传中断 | 点击恢复 | 仅原 File/Key/action/version 重放 | 集成 | 是 |
| UI-045 | REJECT 重复 | 收到明确失败 | 原批次显示 FAILED 重复处置 | 集成 | 是 |
| UI-046 | 原重复批次 FAILED | 确认允许重复 | 创建 retry_of 新批次和新 keys | 集成 | 是 |
| UI-047 | 重复确认后 File 变化 | 继续 | 确认失效并重新 SHA | 组件 | 否 |
| UI-048 | 页面刷新丢 File | 恢复重复 | 要求重选并校验相同 SHA | Playwright | 否 |
| UI-049 | 无可见重复信息 | 展示提示 | 不泄露批次/用户/文件名 | 组件 | 否 |
| UI-050 | FILE_READY + 安全通过 + parse | 点击解析 | 先 GET 最新详情再确认 | 集成 | 是 |
| UI-051 | FILE_READY 但安全未通过 | 查看按钮 | 解析不可用 | 组件 | 否 |
| UI-052 | parse 确认框 | 检查文案 | 不承诺成功/时长/业务校验 | 组件 | 否 |
| UI-053 | parser_version 常量过期 | 服务端拒绝 | 稳定错误，不猜其他版本 | 集成 | 是 |
| UI-054 | parse 响应丢失 | 恢复 | 原 parse Key/载荷重放，取消锁定 | 集成 | 是 |
| UI-055 | CREATED | 取消 | 使用最新版本与独立 Key | 集成 | 是 |
| UI-056 | UPLOAD_PENDING | 打开取消确认 | 不承诺对象立即删除 | 组件 | 否 |
| UI-057 | QUEUED | 打开取消确认 | 不承诺 Queue 消息物理删除 | 组件 | 否 |
| UI-058 | PARSING | 取消成功 | 说明协作式取消并重读终态 | 集成 | 是 |
| UI-059 | 解析发布先于取消 | 收到冲突 | 重读 PARSED，不回退 | 集成 | 是 |
| UI-060 | 取消 unknown | 尝试 parse | 阻断并仅允许原取消恢复 | 组件 | 否 |

### D. 轮询、Sheet、Rows 与单元格（UI-061—UI-080）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 |
| --- | --- | --- | --- | --- | --- |
| UI-061 | 活跃状态开始 | 推进时间 | 2s/5s/10s 分段调度 | 单元 | 否 |
| UI-062 | 连续网络错 | 推进时间 | 5/10/30/30s 退避 | 单元 | 否 |
| UI-063 | 429 秒数 Retry-After | 轮询 | 期限前不请求 | 单元 | 否 |
| UI-064 | 429 HTTP 日期 | 轮询 | 正确解析并等待 | 单元 | 否 |
| UI-065 | 页面隐藏 | 等待 | 轮询暂停、写不取消 | Playwright | 否 |
| UI-066 | 页面重新可见 | 恢复 | 立即一次刷新且无重叠 | Playwright | 否 |
| UI-067 | 慢旧请求后返回 | 新请求已成功 | 旧响应不覆盖 | 单元 | 否 |
| UI-068 | PARSED+RUNNING | 查看 | Sheets/Rows 可读、Mapping 锁定并轮询 | 集成 | 否 |
| UI-069 | PARSED+FAILED | 查看 | 映射准备失败，不称 parser 失败 | 组件 | 否 |
| UI-070 | PARSED+READY | 刷新 | 立即重读一次后有界轮询 | 单元 | 否 |
| UI-071 | hidden Sheet | 选择 | 不请求 Rows 且不可映射 | 组件 | 否 |
| UI-072 | sheets 乱序 | 展示 | 按 sheet_index 稳定排序 | 单元 | 否 |
| UI-073 | URL sheet 不在列表 | 加载 | replaceState 到合法 sheet | 组件 | 否 |
| UI-074 | 切换 sheet | 查看 URL | row_page 重置 1 | 单元 | 否 |
| UI-075 | page_size 改 50→20 | 查看 URL | page 重置 1，仅真实分页 | 组件 | 否 |
| UI-076 | 原始 Rows 含 header | 选表头 | 原始 row_number/分页不变 | 组件 | 否 |
| UI-077 | NO_HEADER 256 列 | 生成标签 | A/Z/AA/AZ/BA/IV 正确 | 单元 | 否 |
| UI-078 | 缺失/EMPTY/空文本 | 渲染 | 三种状态文字不同 | 组件 | 否 |
| UI-079 | DATE 解释失败 | 展开 | 保留 raw 并标失败 | 组件 | 否 |
| UI-080 | FORMULA/ERROR | 渲染 | 纯文本、不执行、不信缓存 | 安全组件 | 否 |

### E. Mapping、错误、可访问性与门禁（UI-081—UI-100）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 |
| --- | --- | --- | --- | --- | --- |
| UI-081 | catalog API 缺失 | 进入编辑器 | 阻断完整 TargetSelector 实施/使用 | 集成门禁 | 否 |
| UI-082 | catalog 返回分组目标 | 键盘搜索 | 可按组/名称选择稳定 code | 组件 | 否 |
| UI-083 | 两源选同非-ignore 目标 | 保存前校验 | 两项均标重复错误 | 组件 | 否 |
| UI-084 | 多源各选 ignore | 校验 | 均合法 | 单元 | 否 |
| UI-085 | 来源无 item | 展示 | 写“尚未处理”，不当 ignore | 组件 | 否 |
| UI-086 | 缺 standard_name/unit | 保存 | 草稿可保存，preview/confirm 阻断 | 集成 | 是 |
| UI-087 | dirty Mapping | 点击 preview | 阻断并提示先保存 | 组件 | 否 |
| UI-088 | PUT 成功 | 保存 | 采用服务端版本并清 dirty | 集成 | 是 |
| UI-089 | PUT VERSION_CONFLICT | 保存 | 保留 dirty，不自动覆盖 | 集成 | 是 |
| UI-090 | 共享 Client 发 PUT | 保存 | CSRF/Key/错误归一化与 POST 一致 | 集成门禁 | 是 |
| UI-091 | 保存后 preview 成功 | 不改内容 | 建立页面内存绑定 | 集成 | 是 |
| UI-092 | preview 后修改一项 | 查看确认 | preview 立即失效 | 单元 | 否 |
| UI-093 | 页面刷新 | 读取已存 Mapping | 不恢复 preview，要求重预览 | Playwright | 否 |
| UI-094 | confirm 前服务端版本变化 | 最终核对 | 阻断确认并刷新 | 集成 | 是 |
| UI-095 | confirm metadata target invalid | 恢复 | 保留 Mapping、标失效目标、重走保存预览 | 集成 | 是 |
| UI-096 | confirm 成功 | 重读页面 | confirmed 只读，无正式导入按钮 | Playwright | 是 |
| UI-097 | confirmed 响应无人员/时间 | 渲染 | 不虚构确认人/确认时间 | 组件门禁 | 否 |
| UI-098 | import 顶层 request_id 错误 | 归一化 | UI 获得安全 request_id/details | 集成门禁 | 否 |
| UI-099 | 50×256 数据 | 渲染/滚动/翻页/键盘/读屏 | 记录全部性能与可访问性指标，不截列 | 验收门禁 | 否 |
| UI-100 | 1366×768 与窄屏 | 检查布局/焦点 | 三列核对；窄屏表格横滚与 Mapping 单列顺序正确 | Playwright | 否 |

回归时同时保留既有 Node 测试基线。`PHASE2-TASK08` 已将 UI-001—UI-100 落地到 `tests/material-import-ui.test.mjs`，并与全量 440 项 Node 测试一起通过。

## 26. PHASE2-TASK08 实施结果

### 26.1 路由与组件

实际路由为 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`。运行时组件按列表、创建/上传、状态工作区、Rows、Mapping、共享原语拆分；状态、URL、写操作、轮询、SHA 与 XHR 边界分别位于可独立测试模块。MaterialShell 只在具备 `material.import.read` 时显示导入入口。

共享 Client 已增加受保护 PUT、顶层/嵌套 `request_id` 与 details 归一化、写后网络不确定的 `RESULT_UNKNOWN`，以及单文件 multipart XHR transport。浏览器不手设 boundary；上传进度只在 `lengthComputable` 时显示百分比。创建、上传、parse、cancel、save、preview、confirm 使用独立页面内存操作记录与不可变载荷摘要。

### 26.2 SHA Worker 与依赖

Worker 使用固定依赖 `@noble/hashes@2.2.0` 的增量 `sha256.create/update/digest`，许可证为 MIT、零运行时依赖。按 1 MiB 分块读取最多 10 MiB File，按字节上报进度，支持重选/卸载取消，不把 File、摘要上下文或 Key 写入持久存储。标准 `abc` 向量与 10 MiB 分块/整块一致性测试通过。

### 26.3 Catalog 与 Mapping

编辑器只读批次作用域 `/mapping-targets` Catalog，按 BASIC/ATTRIBUTE/SPECIAL 分组并使用服务端 q/cursor；无前端硬编码业务目标 fallback。完整 Mapping 保存后采用服务端版本，preview 绑定当前页面的 batch/run/version/mapping/payload/metadata，confirm 前重读详情、Mapping、Sheets 与 Catalog；metadata、run、版本或本地内容变化会失效 preview。`MAPPING_CONFIRMED` 只读且不显示 API 未提供的确认人/时间或正式导入入口。

### 26.4 50×256 性能与可访问性门禁

2026-07-17 使用 Playwright Chromium、本地 Vinext 与浏览器级隔离 API fixture，在 1366×768 下同时渲染 50 行×256 列 Rows 和 256 条 Mapping：初渲染 1751 ms、翻页 1083 ms、横向滚动到底 197 ms；DOM 30,285 节点、HTML 908,994 bytes、JS heap 123,423,127 bytes。表格实际有 257 个 header（含行号），末列为 IV，滚动宽 33,854 px、可视宽 889 px，未截列。

sticky 标题、sticky 行号、sticky Mapping 操作栏、可聚焦横滚 region、table caption、`aria-rowcount=101`、`aria-colcount=257`、键盘打开长内容、对话框初始焦点、Escape 与焦点恢复全部通过。1366 宽屏 Mapping 为三列；700×768 为单列，Rows 仍可横滚，sticky 操作栏不失效；浏览器控制台 0 error / 0 warning。门禁结论为 `PASS`，但未开放 page_size=100。

验收记录和未提交截图位于：

- `chenyida_erp_site/output/playwright/material-import-qa-result.json`
- `chenyida_erp_site/output/playwright/material-import-50x256-1366.png`
- `chenyida_erp_site/output/playwright/material-import-mapping-1366.png`
- `chenyida_erp_site/output/playwright/material-import-mapping-700.png`

### 26.5 验证、差异与限制

UI-001—UI-100 全部通过；全量 Node 440/440、build、lint 0 error（1 个任务外既有 warning）、隔离 API smoke、5 份 OpenAPI 3.1/434 个本地引用与 Batch 6 操作、Drizzle 34 表无漂移、289 文件凭证扫描及临时 SQLite self-test/smoke/go-live 全部通过。

实现没有扩大为后端或数据任务：未修改 API route/service、Schema、Migration、Metadata、hosting 或本地旧版业务逻辑，未连接生产。与规格的已知限制是继续只开放 Rows page_size 20/50；浏览器 File、RESULT_UNKNOWN 操作记录与 preview 只在当前页面内存中，刷新后必须按权威服务端状态恢复或重新选择文件；真实远程 R2/Queue、生产配额、冷启动和部署仍未验收。
