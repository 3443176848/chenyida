# Material Import Normalization Review UI V1：状态矩阵

## 0. 符号

- `B`：Batch Detail。
- `M`：Confirmed Mapping。
- `S`：Normalization Summary。
- `R`：Normalized Rows。
- `D`：Row Detail。
- `I`：Normalization Issues。
- `N/X`：`material.import.normalize` / `material.import.cancel`。
- 所有写操作还要求最新复合读取、CSRF、独立 Key、冻结 Body、最新 Version、无冲突写及无 `RESULT_UNKNOWN`。

## 1. 主状态矩阵

| Batch / Run 状态 | Current Run | Latest Attempt | 默认 View | 可读 API | 可执行写 | Capability | 轮询 | Stepper | 主要文案 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MAPPING_CONFIRMED`，未启动 | — | — | `normalize` | B/M/S | 首次启动 | N | 否 | 1–5 完成，6 当前，7 锁定 | 数据归一化尚未启动 |
| `MAPPING_CONFIRMED`，首次失败 | — | `FAILED` | `normalize` | B/M/S | 业务重试（API 允许时） | N | 否 | 6 失败，7 锁定 | 规范化任务未完成 |
| `QUEUED_FOR_NORMALIZATION`，首次 | — | `QUEUED` | `normalize` | B/M/S | 取消 | X | 2/5/10 | 6 当前，7 锁定 | 请求已受理，等待处理 |
| `NORMALIZING`，首次 | — | `RUNNING/STAGED/PUBLISHING` | `normalize` | B/M/S | 取消 | X | 2/5/10 | 6 当前，7 锁定 | 按真实阶段处理 |
| 首次取消 | — | `CANCELLED` | `normalize` 处置 | B/M/S | 无 | R | 最终读取后停 | 6 取消，7 锁定 | 首次数据归一化已取消 |
| `NORMALIZED`，稳定 | `SUCCEEDED` | 同 Current 或终态 | `normalized` | B/M/S/R/D/I | 新版本重跑 | N | 否 | 6 完成，7 当前 | 规范化结果已发布 |
| 重跑排队 | 旧 `SUCCEEDED` | 新 `QUEUED` | `normalize` | B/M/S；旧 R/D/I | 取消 | X | 2/5/10 | 6 当前；7 可回看旧结果 | 正在重新运行，旧结果仍有效 |
| 重跑运行 | 旧 `SUCCEEDED` | 新活动态 | `normalize` | B/M/S；旧 R/D/I | 取消 | X | 2/5/10 | 同上 | 按 Latest 显示进度 |
| 重跑失败 | 旧 `SUCCEEDED` | `FAILED`，ID 不同 | `normalized` | B/M/S/R/D/I | 新版本且 API 允许时重跑 | N | 最终读取后停 | 6 辅助失败；7 可读 | 最近一次重新运行未成功，当前仍展示上一次已发布结果 |
| 重跑取消 | 旧 `SUCCEEDED` | `CANCELLED`，ID 不同 | `normalized` | B/M/S/R/D/I | 新版本且 API 允许时重跑 | N | 最终读取后停 | 6 辅助取消；7 可读 | 最近一次重新运行已取消 |
| 新 Run 发布 | 新 `SUCCEEDED` | 同 Current | `normalized` | B/M/S/R/D/I | 以后新版本重跑 | N | 最终读取后停 | 6 完成，7 当前 | 规范化结果已更新 |
| `RECONCILIATION_REQUIRED` | 按 API，不猜测 | 按 API | 专用处置 | B/M/S；结果仅后端明确允许 | 无 | R | 否 | 一致性处置 | 刷新并联系管理员 |

## 2. View 合法化

| 权威状态 | 输入 View | 结果 | History |
| --- | --- | --- | --- |
| `MAPPING_CONFIRMED`，无 Current | 缺失/`normalize` | `normalize` | 保留/无写 |
| 同上 | `normalized/issues` | `normalize` | `replaceState` |
| 首次活动，无 Current | 任意结果 View | `normalize` | `replaceState` |
| 重跑活动，有 Current | `normalize/normalized/issues` | 原合法 View | 保留 |
| `NORMALIZED` | 缺失 | `normalized` | `replaceState` |
| `NORMALIZED` | `normalize/normalized/issues/confirmed` | 原 View | 保留 |
| 首次失败/取消，无 Current | `normalized/issues` | `normalize` 处置 | `replaceState` |
| `RECONCILIATION_REQUIRED` | 任意正文 View | 专用处置 | `replaceState` |
| 任意无 Current | 带 `row` | 移除 `row` | `replaceState` |
| 任意 `view=normalize` | 带 `row` | 移除 `row` | `replaceState` |

## 3. Run 状态与显示

| Run Status | 活动 | 进度来源 | 是否可读其 Rows/Issues | 终态动作 |
| --- | --- | --- | --- | --- |
| `QUEUED` | 是 | Stage，不伪造百分比 | 仅当它也是旧 Current（正常不成立） | 继续轮询 |
| `RUNNING` | 是 | Stage + 合法行进度 | 否，除非另有旧 Current | 继续轮询 |
| `STAGED` | 是 | 行处理完成，正在核验/准备发布 | 否 | 继续轮询 |
| `PUBLISHING` | 是 | 行处理完成，正在发布 | 否 | 继续轮询 |
| `SUCCEEDED` | 否 | 最终复合读取确认 | 仅当 Summary 明确为 Current | 最终读取 |
| `FAILED` | 否 | 安全失败信息 | 否；旧 Current 仍可读 | 最终读取 |
| `CANCELLED` | 否 | 取消结果 | 否；旧 Current 仍可读 | 最终读取 |
| `SUPERSEDED` | 否 | 历史状态，不提供历史浏览 | 否 | 最终读取 |

## 4. Stage 与行进度

| Stage | 文案 | 百分比条件 | 100% 时文案 |
| --- | --- | --- | --- |
| `LOAD_MAPPING` | 正在读取并核对已确认映射 | 通常不显示 | 仍是阶段，不称完成 |
| `READ_SOURCE_ROWS` | 正在读取源数据行 | 仅字段合法且服务端已有总数 | 行读取完成，不代表任务完成 |
| `NORMALIZE_ROWS` | 正在生成规范化候选 | `0<=processed<=total` 且 `total>0` | 行处理已完成，等待核验 |
| `VERIFY_RESULT` | 正在核对结果完整性 | 可保留“行处理 100%” | 行处理已完成，正在核对 |
| `PUBLISH_RESULT` | 正在原子发布规范化结果 | 可保留“行处理 100%” | 行处理已完成，正在发布 |
| `COMPLETE` | 数据归一化处理已结束 | 不单凭 Stage 宣称发布 | Final Read 确认 Current 后才进入结果 |
| 未知 | 正在处理规范化任务 | 不显示 | 保留安全 Code |

以下任一条件隐藏百分比并刷新：非安全整数、负数、`processed>total`、分类行合计超过 Processed、已发布行合计不等于 Total。再次矛盾则停止高频轮询，显示安全异常与 Request ID。

## 5. 启动、重试与重跑资格

| 动作 | Batch | Current | Latest | Processor | Reason | Key | 入口文案 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 首次启动 | `MAPPING_CONFIRMED` | — | 无活动 | 发布常量 | 省略 | 新 | 启动数据归一化 |
| 业务重试 | `MAPPING_CONFIRMED` | — | 允许重试终态 | 发布常量 | 省略 | 新 | 重试规范化 |
| 原操作恢复 | 任意 | 任意 | 任意 | 冻结值 | 冻结值 | 原 Key | 使用原请求安全重试 |
| 业务重跑 | `NORMALIZED` | 存在 | 无活动 | 必须不同于 Current | Trim 后 1–500 | 新 | 重新运行规范化 |
| 同版本 | `NORMALIZED` | 存在 | 无活动 | 相同 | 任意 | 不生成 | 当前结果已使用本版本处理 |

首次启动还要求 Confirmed Mapping 绑定当前 Parse Run；所有入口均要求 N、Fresh Composite Read、无冲突写及 Unknown。

## 6. 写操作互斥与 `RESULT_UNKNOWN`

| 当前操作 | Unknown 时允许 | 禁止 | 清除条件 |
| --- | --- | --- | --- |
| 首次启动 | B/M/S GET；原请求重放；旧 Current 可读 | 新启动、业务重试/重跑、取消 | 原 Key 得到权威响应 |
| 业务重试 | 同上 | 新重试、重跑、取消 | 同上 |
| 业务重跑 | B/M/S GET；旧 R/D/I；原重放 | 新重跑、取消 | 同上 |
| 取消 | B/M/S GET；旧 R/D/I；原重放 | 新取消、启动、重试、重跑 | 同上 |

刷新丢失 Key 后不创建 Unknown 或恢复按钮，只读取服务端状态。离开保护仅覆盖 Unknown、未提交理由和尚未获权威结果的写请求；普通轮询/查看不保护。

## 7. 取消竞争

| 场景 | 服务端结果 | Current | 页面落点 | 禁止误述 |
| --- | --- | --- | --- | --- |
| 首次取消胜出 | 正式 Cancel/恢复态 | — | `normalize` 取消处置 | 不称 Queue 已删除 |
| 重跑取消胜出 | 通常恢复 `NORMALIZED` | 旧 Current | `normalized` + 非阻断横幅 | 不隐藏旧结果 |
| 发布先胜出 | `NORMALIZED` | 新 Current | 新结果页 | 不称取消成功，不回退 |
| Version/State 冲突 | 真实最新状态 | 按 Summary | 复合刷新后规范化 | 不自动新 Key 取消 |

## 8. Rows 参数、响应与缓存

| 事件 | URL | API 参数 | Cursor | 缓存 |
| --- | --- | --- | --- | --- |
| 初始 | `view=normalized&row_limit=50` | `limit=50` | 无 | 当前页 |
| Status 变化 | 更新 `row_status` | `row_status` | 清除 | 清旧页 |
| Limit 变化 | `row_limit=50/100` | `limit` | 清除 | 清旧页 |
| 下一页 | 写 `row_cursor` | 原样 `cursor` | `pushState` | 不存 History |
| 上一页 | History 链合法 | 前一 URL | `history.back` | 重取/短期页缓存 |
| 直接 Cursor | 原 URL | 原样 | 无 Previous | 当前页 |
| Current Run 变化 | 清全部 Rows 参数 | 第一页 | 清除 | Abort、全清 |

响应必须同时通过 Batch/Run 归属核验；任何 Item/顶层矛盾整页拒绝。主列表不含 Candidate，稳定 Key 用 Row ID。

## 9. Issues 参数、响应与缓存

| URL | API | 校验 |
| --- | --- | --- |
| `issue_level` | `issue_level` | `ERROR/WARNING` |
| `issue_code` | `issue_code` | `^[A-Z][A-Z0-9_]{2,99}$` |
| `issue_target` | `target_code` | 3–160 字，有界 URL 编码 |
| `issue_row` | `source_row_number` | 规范十进制安全正整数 |
| `issue_limit` | `limit` | 50/100 |
| `issue_cursor` | `cursor` | Opaque，不解析 |

不发送 `row_status/source_sheet_index/normalized_row_id/page/offset/sort`。筛选/Limit 变化清 Cursor；Run 变化清全部 Issue 参数与缓存。响应绑定 Current Run，异常整页拒绝。

## 10. Row Drawer 与 History

| 入口 | History Marker | 初始读取 | 关闭 | 焦点恢复 |
| --- | --- | --- | --- | --- |
| Rows 按钮 | `normalization-row-drawer` | Row Detail | 可信 Entry `back` | 原按钮→Rows 容器→标题 |
| Issue 按钮 | 同上；不混 Issue Page Marker | Row Detail + 页面内存 Issue Context | 同上 | 原按钮→Issues 容器→标题 |
| 直接 URL | 无可信 Marker | B/S→Current→Detail | `replaceState` 移除 Row | 列表容器→标题 |
| 刷新 URL | Marker 不可信 | 只恢复 Row Detail | `replaceState` | 列表容器→标题 |

Row 只接受规范十进制正整数。Batch/Run/Row/Sheet/Source Row/Raw Hash/Lineage 任一矛盾都拒绝整个 Drawer 正文。

## 11. Candidate 存在性与显示

| 实际状态 | UI |
| --- | --- |
| 字段对象不存在 | 未生成该字段候选 |
| `candidate=null` | 候选值为 Null |
| `candidate=""` | 候选值为空字符串 |
| `candidate=false` | Boolean False |
| `candidate=0` | Number 0 |
| 空 Array/Object | 空数组/空对象，有界类型仍保留 |
| `MISSING/EMPTY/BLANK_TEXT/NULL_VALUE/PRESENT` | 五种独立标签 |
| `column_index=0` | 显示列 0，不按 Falsy 隐藏 |

Basic 按稳定业务顺序后 Code；Attributes 按 Code；Category Hint 与 Supplier Reference 均显示非正式语义；Deferred Validation 空不称全部通过。

## 12. Issue 与 Drawer 关联

| 能力 | V1 行为 | 状态 |
| --- | --- | --- |
| Issue→Row | 使用 `normalized_row_id` 打开批次作用域 Detail | 可实施 |
| 当前选中 Issue | 页面内存展示单条安全上下文 | 可实施 |
| 刷新恢复选中 Issue | 无 Issue Detail/精确查询 | 非阻塞限制 |
| Drawer Issue Summary | 使用 Row Detail 真实计数 | 可实施 |
| Drawer 完整 Issue 集合 | 无 `normalized_row_id`/Sheet 筛选或有界数组 | 局部门禁 |
| 按 Source Row 查看 | 设置 `issue_row`，提示跨 Sheet 同号 | 降级可实施 |

## 13. 缓存失效

| 事件 | Summary | Rows | Issues | Drawer | Operation |
| --- | --- | --- | --- | --- | --- |
| Current Run ID 变化 | 替换 | Abort/全清/第一页 | Abort/全清/第一页 | 关闭或重验 | 已完成操作归档 |
| Batch ID 变化 | 全清 | 全清参数/缓存 | 全清参数/缓存 | 关闭 | 页面内存全清 |
| Row 变化 | 保留 | 保留当前页 | 保留当前页 | Abort 旧 Detail | 保留 |
| Filter/Limit 变化 | 保留 | 对应清页/Cursor | 对应清页/Cursor | 按 View 关闭或重验 | 保留 |
| 401/403 | 清 | 清 | 清 | 清 | 清 |
| 404 | 清 | 清 | 清 | 清 | 清 |
| 页面刷新 | 重取 | 按 URL 重取 | 按 URL 重取 | 可重取 Row，不恢复 Issue Context | Key/Body 不恢复 |

## 14. 权限变化

| 响应 | Timer/Request | 正文 | 写操作 | 页面 |
| --- | --- | --- | --- | --- |
| 401 | 全停/Abort | 全清 | 全清 | 现有登录流程；安全 Return To 不带 Cursor/Row |
| 403 | 全停/Abort | 全清 | 全清 | 通用无权限 |
| 404 | 全停/Abort | 全清 | 全清 | 批次不存在或无权查看 |

`read_any` 只改变行级可见性，不授予 N/X。按钮分别按 Capability，不能按角色。

## 15. 错误分派矩阵

| Code | 页面状态与安全文案 | 保留 URL | 保留 Current 正文 | 原 Key 重放 | 轮询 | 清受保护数据 |
| --- | --- | --- | --- | --- | --- | --- |
| `AUTH_REQUIRED` | 登录失效 | 安全 Return To 子集 | 否 | 否 | 停 | 是 |
| `FORBIDDEN` | 当前无权继续 | 否 | 否 | 否 | 停 | 是 |
| `IMPORT_BATCH_NOT_FOUND` | 不存在或无权查看 | 否 | 否 | 否 | 停 | 是 |
| `IMPORT_NORMALIZATION_NOT_ALLOWED` | 当前状态不允许 | 规范化 View | 若仍合法则是 | 否 | 最终刷新 | 否 |
| `IMPORT_NORMALIZATION_ALREADY_RUNNING` | 已有任务运行 | 转活动 View | 是 | 否 | 启动 | 否 |
| `IMPORT_NORMALIZATION_FAILED` | 首次失败或最近尝试失败 | 是 | 有 Current 则是 | 否 | 最终读取 | 否 |
| `IMPORT_NORMALIZATION_LIMIT_EXCEEDED` | 未发布完整结果 | 是 | 有 Current 则是 | 否 | 停 | 否 |
| `IMPORT_NORMALIZATION_MAPPING_STALE` | Mapping 不再适用 | 是 | 有 Current 则是 | 否 | 停 | 否 |
| `IMPORT_NORMALIZATION_METADATA_CHANGED` | Metadata 已变化 | 是 | 有 Current 则是 | 否 | 复合刷新 | 否 |
| `IMPORT_NORMALIZATION_VERSION_CONFLICT` | 服务端版本已变化 | 是 | 是 | 不改 Body；仅原幂等恢复 | 复合刷新 | 否 |
| `IMPORT_NORMALIZATION_CANCELLED` | 依据最终状态落点 | 规范化 | 有 Current 则是 | 否 | 最终读取 | 否 |
| `IMPORT_NORMALIZED_ROW_NOT_FOUND` | Row 不可访问 | 移除 Row | 列表保留 | 否 | 不变 | Drawer 清 |
| `IMPORT_NORMALIZATION_QUERY_INVALID` | 规范化参数，一次重读 | 删除坏参数 | 是 | 不适用 | 最多一次 | 否 |
| `IDEMPOTENCY_KEY_REQUIRED` | 客户端写边界错误 | 是 | 是 | 否 | 停写 | 否 |
| `IDEMPOTENCY_CONFLICT` | 幂等载荷冲突 | 是 | 是 | 不自动新 Key | 停写 | 否 |
| `CSRF_INVALID` | 安全上下文失效 | 是 | 是 | 否 | 停写 | 否 |
| `RATE_LIMITED` | 按 Retry-After 等待 | 是 | 是 | 依原操作规则 | 暂停 | 否 |
| `INTERNAL_ERROR` | 服务暂不可用 + Request ID | 是 | 若仍合法则是 | 明确响应时否 | 退避 | 否 |
| `RESULT_UNKNOWN` | 写入结果待确认 | 是 | 是 | 仅原 Key/Body | GET 可继续 | 否 |
| `IMPORT_BATCH_STATE_INVALID` | Cancel 状态已变化 | 规范化 | 按 Summary | 否 | 复合刷新 | 否 |
| `IMPORT_BATCH_VERSION_CONFLICT` | Cancel 版本冲突 | 是 | 按 Summary | 仅原冻结请求恢复 | 复合刷新 | 否 |
| `IDEMPOTENCY_KEY_REUSED` | Cancel Key 冲突 | 是 | 是 | 不自动换 Key | 停写 | 否 |

明确 4xx/409/422/429/结构化 500 均为权威失败；只有无权威响应的已发送写请求进入 Unknown。

## 16. 门禁矩阵

| 核验项 | 结论 | 降级/影响 |
| --- | --- | --- |
| Summary 字段足够 | RESOLVED | Current/Latest/计数/阶段可用 |
| Rows 稳定分页 | RESOLVED | Opaque Cursor、50/100 |
| Issue 基础筛选 | RESOLVED | 真实五类筛选可用 |
| Issue Row Status/Sheet 筛选 | NON_BLOCKING_LIMITATION | 不显示对应控件 |
| 精确完整 Row Issues | SCOPED_IMPLEMENTATION_GATE | Drawer 不称全部问题 |
| Row Detail Lineage | RESOLVED | 真实快照字段可核验 |
| Batch Current Pointer 暴露 | NON_BLOCKING_LIMITATION | 以 Summary Current + 结果响应 Run ID 绑定 |
| 重跑语义 | RESOLVED | 新版本 + 理由 |
| 取消语义 | RESOLVED | 复用 Cancel；兼容旧错误码 |
| 完整 Run 历史 | NON_BLOCKING_LIMITATION | 只显示 Current/Latest |
| Safe Details | RESOLVED WITH ALLOWLIST | 五键有界展示 |
| Permission DTO | RESOLVED | 使用 `user.permissions` Capability |
| 性能与可访问性 | PASS (LOCAL ISOLATED MOCK) | 50 Rows、100 Issues、200 Attributes、1366/700px、键盘与语义实测通过；不代表生产容量 |

## 17. 实施状态

`PHASE3-TASK04` 已把本矩阵落实为前端协议与组件状态，并通过 104 项唯一测试 ID。实际实现保持：

- Batch Detail 与 Summary 同一 Generation 复合提交；Current Run 变化同时清 Rows、Issues、Drawer、Cursor 和旧正文。
- Normalize 与 Cancel 各自维护内存冻结 Body/Key；只有客户端未取得权威响应时进入 `RESULT_UNKNOWN`。
- Rows 与 Issues 使用独立 Marker、独立 Cursor 和归属核验；直接 Cursor URL 不伪造上一页或总页数。
- 401/403/404 停止轮询、Abort 并清受保护状态；`read_any` 不授予 Normalize 或 Cancel。
- 性能与可访问性 Gate 从 `REQUIRED` 转为 `PASS (LOCAL ISOLATED MOCK)`；生产容量、远程网络和部署仍未验收。
