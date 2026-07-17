# Material Import Normalization Review UI V1：低保真线框

## 0. 使用说明

这些线框只定义信息层级、状态、动作和安全文案，不是视觉稿。共同布局：Material Shell → Batch 标题 → 七步 Stepper → 状态横幅 → `normalize/normalized/issues` 工作区。所有正文绑定服务端 Batch、`current_run` 和 `latest_attempt`；状态不只靠颜色。

缩写：`N`=`material.import.normalize`，`X`=`material.import.cancel`，`R`=`material.import.read` 或 `read_any` 后的合法可见性。`—` 表示不存在。

## 1. MAPPING_CONFIRMED 等待启动

状态：Batch=`MAPPING_CONFIRMED`；Current=—；Latest=—；View=`normalize`；动作=启动/回看 Mapping；能力=`R+N`；轮询=否；Unknown=否；旧结果=否。

```text
[文件✓ 解析✓ 表头✓ 字段映射✓ 映射确认✓ 数据归一化● 结果审阅🔒]
数据归一化尚未启动
将生成只读候选快照；不会创建物料，结果可以包含 ERROR 行。
[回看已确认 Mapping]                         [启动数据归一化]
```

## 2. 无 Normalize 权限

状态：Batch=`MAPPING_CONFIRMED`；Current=—；Latest=—；View=`normalize`；动作=只读回看；能力=`R`；轮询=否；Unknown=否；旧结果=否。

```text
字段映射已确认
当前账号可以查看批次，但没有启动数据归一化的权限。
[回看已确认 Mapping]                     （无启动按钮）
```

## 3. 启动确认 Dialog

状态：Batch=`MAPPING_CONFIRMED`；Current=—；Latest=—；View=`normalize`；动作=确认/取消；能力=`R+N`；轮询=否；Unknown=否；旧结果=否。

```text
┌─ 启动数据归一化 ───────────────────────────────┐
│ 将创建新的 Normalization Run。                 │
│ 不创建正式物料；ERROR 行不会使完整任务失败。   │
│ Processor Version 在支持信息中只读显示。       │
│                         [返回] [确认启动]       │
└────────────────────────────────────────────────┘
```

## 4. 启动 RESULT_UNKNOWN

状态：Batch/Attempt=服务端待确认；Current=可有可无；View=`normalize` 或旧结果 View；动作=原请求重放；能力=`R+N`；轮询=读状态；Unknown=启动；旧结果=按 API。

```text
[写入结果待确认]
请求已发出，但未收到权威响应。不得生成新 Key、取消或重新启动。
[保留页面等待] [使用原请求安全重试]
旧 Current Run 如仍有效，结果正文继续只读显示。
```

## 5. QUEUED_FOR_NORMALIZATION

状态：Batch=`QUEUED_FOR_NORMALIZATION`；Current=—；Latest=`QUEUED`；View=`normalize`；动作=取消；能力=`R`，按钮另需 `X`；轮询=是；Unknown=否；旧结果=否。

```text
数据归一化请求已受理，正在等待处理
阶段：读取并核对已确认映射（无 ETA、无 Queue 位置）
[手动刷新]                                  [取消任务]
```

## 6. NORMALIZING 初期

状态：Batch=`NORMALIZING`；Current=—；Latest=`RUNNING`；View=`normalize`；动作=取消；能力=`R+X`；轮询=是；Unknown=否；旧结果=否。

```text
数据归一化正在运行
正在读取源数据行
行处理进度：总行数尚不可用于百分比
[最近状态更新时间：…]                       [取消任务]
```

## 7. NORMALIZING 真实进度

状态：Batch=`NORMALIZING`；Current=—；Latest=`RUNNING/NORMALIZE_ROWS`；View=`normalize`；动作=取消；能力=`R+X`；轮询=是；Unknown=否；旧结果=否。

```text
正在生成规范化候选
行处理进度 42%  [████████░░░░]  420 / 1,000 行
已处理统计：VALID 360  WARNING 40  ERROR 20
这不是总任务完成度。                       [取消任务]
```

## 8. NORMALIZING 网络退避

状态：Batch/Run=保留最后一次合法快照；View=`normalize`；动作=手动刷新；能力=`R`；轮询=5/10/30s 退避；Unknown=否；旧结果=按 API。

```text
[状态刷新暂时中断]
无法取得最新状态；页面不会把旧快照宣称为当前进度。
下一次读取将按网络退避进行。                 [立即刷新]
```

## 9. 429 等待

状态：保留最后合法快照；View=原 View；动作=到期后刷新；能力=`R`；轮询=`Retry-After` 暂停；Unknown=否；旧结果=按 API。

```text
[请求过于频繁]
请在 37 秒后重试。到期前不会高频请求。
[等待中…]                                  [到期后主动刷新]
```

## 10. 取消确认

状态：Batch=`QUEUED_FOR_NORMALIZATION/NORMALIZING`；Current=可有可无；Latest=活动；View=`normalize`；动作=确认取消；能力=`R+X`；轮询=继续；Unknown=否；旧结果=按 API。

```text
┌─ 取消数据归一化 ───────────────────────────────┐
│ 取消为协作式，后台可能短暂继续计算。           │
│ 首次运行：取消胜出后不发布暂存结果。           │
│ 重跑：取消胜出后保留上一次已发布结果。         │
│                         [返回] [确认取消]       │
└────────────────────────────────────────────────┘
```

## 11. 取消处理中

状态：Batch=尚未乐观改变；Current=按 API；Latest=活动；View=`normalize`；动作=无第二写；能力=`R`；轮询=是；Unknown=否；旧结果=按 API。

```text
取消请求处理中
正在读取服务端最终状态。发布可能先于取消胜出。
（启动、重跑和再次取消均锁定）
```

## 12. CANCELLED

状态：首次取消后权威 Batch=`CANCELLED` 或正式恢复态；Current=—；Latest=`CANCELLED`；View=`normalize`；动作=刷新/返回；能力=`R`；轮询=否；Unknown=否；旧结果=否。

```text
首次数据归一化已取消
未发布的暂存结果不可查看；取消不表示 Queue 消息被物理删除。
[返回导入列表]                               [刷新状态]
```

## 13. Run FAILED

状态：Batch=`MAPPING_CONFIRMED`；Current=—；Latest=`FAILED`；View=`normalize`；动作=按资格重试；能力=`R+N`；轮询=否；Unknown=否；旧结果=否。

```text
规范化任务未完成
{safe_failure_message}
支持编号：{request_id，如有}
[回看 Mapping]                       [重试规范化（如允许）]
```

## 14. Limit Exceeded

状态：Latest=`FAILED`；Current=可有可无；View=无旧结果时 `normalize`，有旧结果时 `normalized`；动作=刷新；能力=`R`；轮询=否；Unknown=否；旧结果=按 API。

```text
[规范化任务未发布完整结果]
输入超过当前安全处理限制。不会展示 D1、SQL 或内存细节。
有旧结果：继续展示上一次已发布结果；无旧结果：不显示 Rows/Issues。
```

## 15. Mapping Stale

状态：Latest=`FAILED`；Current=按 API；View=`normalize/normalized`；动作=只读回看；能力=`R`；轮询=否；Unknown=否；旧结果=按 API。

```text
已确认 Mapping 不再适用于当前处理
可以只读回看 Mapping；不能在此原地编辑或自动创建新 Mapping。
[回看已确认 Mapping]                         [刷新]
```

## 16. Metadata Changed

状态：Latest=`FAILED` 或启动拒绝；Current=按 API；View=合法落点；动作=复合刷新；能力=`R`；轮询=否；Unknown=否；旧结果=按 API。

```text
物料元数据已变化
未提交的启动/重跑准备已失效。旧结果仍使用其历史快照 Code。
[重新读取 Batch、Mapping 与 Normalization]
```

## 17. NORMALIZED 全部 VALID

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；Latest=同 Current；View=`normalized`；动作=筛选/详情；能力=`R`；轮询=否；Unknown=否；旧结果=当前结果。

```text
规范化结果已发布
总行 1,000 | VALID 1,000 | WARNING 0 | ERROR 0 | Issues 0
当前结果没有需要处理的 ERROR 行；不表示分类或 Material Validation 已完成。
[全部行] [Issues]
```

## 18. NORMALIZED 含 WARNING

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；Latest=同 Current；View=`normalized`；动作=WARNING 筛选；能力=`R`；轮询=否；Unknown=否；旧结果=当前结果。

```text
规范化结果已发布
总行 1,000 | VALID 920 | WARNING 80 | ERROR 0
80 行需要人工关注，但完整结果已经发布。
[查看 WARNING 行] [查看 Issues]
```

## 19. NORMALIZED 含 ERROR

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；Latest=同 Current；View=`normalized`；动作=ERROR 筛选；能力=`R`；轮询=否；Unknown=否；旧结果=当前结果。

```text
规范化已完成，其中 20 行需要处理
总行 1,000 | VALID 900 | WARNING 80 | ERROR 20
ERROR 行不会把任务改写为失败，也不能进入 Draft。
[查看 ERROR 行] [查看 Issues]
```

## 20. 结果行列表

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；Latest=同/其他终态；View=`normalized`；动作=筛选/翻页/Drawer；能力=`R`；轮询=按 Latest；Unknown=否；旧结果=Current。

```text
[状态：全部▼] [每页：50▼]
Sheet索引 | 来源行 | 状态    | Warning | Error | Raw Hash       | 操作
0         | 12     | WARNING | 2       | 0     | a1b2c3d4…90ef  | [详情]
                                                  [上一页] [下一页]
```

## 21. Status 筛选

状态：同上；View=`normalized&row_status=ERROR`；动作=更改筛选；能力=`R`；轮询=按 Latest；Unknown=否；旧结果=Current。

```text
行状态 [ERROR▼]    每页 [50▼]
筛选变化已清除旧 Cursor；API 只收到 row_status/limit/cursor。
[清除筛选]
```

## 22. 空筛选结果

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；View=`normalized`；动作=清筛选；能力=`R`；轮询=否；Unknown=否；旧结果=Current。

```text
当前筛选条件下没有结果。
ERROR 筛选：当前结果没有需要处理的 ERROR 行。
不得显示“全部校验通过”。                    [清除筛选]
```

## 23. Row Drawer：Basic

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；View=`normalized/issues`；动作=关闭/展开；能力=`R`；轮询=否；Unknown=否；旧结果=Current。

```text
│ 行详情：Sheet 0 / 来源行 12 / WARNING                     [关闭] │
│ Basic                                                           │
│ 标准名称  candidate="电阻"  状态 VALID                          │
│ 来源：列 0 / TEXT / PRESENT；原值按有界纯文本展示                │
│ 候选 Null、空字符串、False、0 分别显示                           │
```

## 24. Row Drawer：Attributes

状态：同 23；View=`normalized/issues`；动作=展开有界值；能力=`R`；轮询=否；Unknown=否；旧结果=Current。

```text
│ Dynamic Attributes                                               │
│ RESISTANCE_VALUE  { value: "10", unit: "kΩ" }  VALID           │
│ TOLERANCE         candidate 为 Null              ERROR           │
│ 只显示历史稳定 Code；不以当前 Catalog 名称冒充历史标签。         │
```

## 25. Row Drawer：Lineage

状态：同 23；View=`normalized/issues`；动作=折叠支持信息；能力=`R`；轮询=否；Unknown=否；旧结果=Current。

```text
│ Lineage：Sheet 0 / 来源行 12 / 来源列 0 / SOURCE_COLUMN          │
│ [运行详情/支持信息 ▸]                                             │
│ Run/Parse/Mapping/Processor/Digest 仅真实字段；Hash 8…8 缩略。    │
```

## 26. Row Drawer：Issue 上下文

状态：同 23；View=`issues`；动作=返回问题列表/按源行筛选；能力=`R`；轮询=否；Unknown=否；旧结果=Current。

```text
│ Issue Summary：2 WARNING / 1 ERROR                               │
│ 当前选中问题：类型不匹配（仅本次页面内存上下文）                 │
│ [返回问题列表] [按来源行 12 查看问题]                            │
│ 注意：可能包含其他 Sheet 的同号行。                              │
│ SCOPED GATE：不显示“该行全部问题”。                              │
```

## 27. Issue 总列表

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；View=`issues`；动作=筛选/翻页/Drawer；能力=`R`；轮询=按 Latest；Unknown=否；旧结果=Current。

```text
Level | 问题             | Sheet/行/列 | Target Code         | 操作
ERROR | 类型不匹配       | 0 / 12 / 0  | basic.STANDARD_NAME | [查看行]
      | safe_message（有界纯文本）
                                              [上一页] [下一页]
```

## 28. Issue 筛选

状态：同 27；View=`issues`；动作=筛选；能力=`R`；轮询=按 Latest；Unknown=否；旧结果=Current。

```text
Level [ERROR▼] Code [类型不匹配▼] Target [________]
来源行 [12____] 每页 [50▼]     [应用] [清除]
无 Row Status、Sheet、Sort、Page 或 Offset 控件。
```

## 29. Row Not Found 或无权限

状态：Current=已变化或 Row 不可见；View=`normalized/issues`；动作=返回列表/刷新；能力=`R` 或已失效；轮询=否；Unknown=否；旧结果=不显示。

```text
该规范化行不存在或当前不可访问。
不会说明它属于其他 Batch、历史 Run、已删除或无权限。
[返回当前结果列表]
```

## 30. 重跑确认

状态：Batch=`NORMALIZED`；Current=`SUCCEEDED`；Latest=无活动；View=`normalize`；动作=确认重跑；能力=`R+N`；轮询=否；Unknown=否；旧结果=是。

```text
┌─ 重新运行规范化 ───────────────────────────────┐
│ 将创建新 Run；旧结果在新结果发布前保持有效。   │
│ 理由（必填，1–500）：[____________________]    │
│ 不修改原始行/Mapping，不创建 Material Draft。  │
│                         [返回] [确认重新运行]   │
└────────────────────────────────────────────────┘
```

## 31. Confirmed Mapping 回看

状态：Batch=`MAPPING_CONFIRMED` 或以后；Current=按 API；Latest=按 API；View=`confirmed`；动作=返回合法 View；能力=`R`；轮询=按活动 Attempt；Unknown=否；旧结果=按 API。

```text
已确认 Mapping（只读）
Sheet、Header、Target 和默认值均不可在此修改。
无“返回编辑 Mapping”。                 [返回数据归一化/结果审阅]
```

## 32. 1366×768

状态：任一合法状态；View=原 View；动作=完整可达；能力=按状态；轮询=按状态；Unknown=按状态；旧结果=按状态。

```text
┌────────── Shell ─────────────────────────────────────────────────┐
│ [七步 Stepper：短标签或横向滚动，不缩成不可读图标]              │
│ [Summary / Filters]                                              │
│ [有界表格，Sticky 不遮挡最后一行或焦点]                          │
└──────────────────────────────────────────────────────────────────┘
```

## 33. 700px 窄屏

状态：任一合法状态；View=原 View；动作=业务一致；能力=按状态；轮询=按状态；Unknown=按状态；旧结果=按状态。

```text
┌─ 700px ───────────────────┐
│ Stepper 纵向/可滚动        │
│ Filters 单列               │
│ Rows/Issues 横向可访问     │
│ Drawer 全宽覆盖            │
│ [固定、可访问关闭按钮]     │
└────────────────────────────┘
```

## 34. 401

状态：会话失效；Current/Latest=立即清除；View=安全 Return To；动作=登录；能力=无；轮询=停止；Unknown=若存在先提示；旧结果=不显示。

```text
登录状态已失效，请重新登录。
已清除 Batch、Summary、Rows、Issues、Drawer 和选中 Issue 上下文。
[进入现有登录流程]
```

## 35. 403

状态：权限失效；Current/Latest=立即清除；View=无权限页；动作=返回；能力=无；轮询=停止；Unknown=终止未发送准备；旧结果=不显示。

```text
当前账号没有访问或继续处理该导入批次的权限。
不会继续显示此前加载的结果。               [返回 ERP 首页]
```

## 36. 404

状态：资源隐藏；Current/Latest=清除；View=隐藏状态；动作=返回列表；能力=不推断；轮询=停止；Unknown=否；旧结果=不显示。

```text
导入批次不存在或无权查看。
页面不区分资源不存在与权限隐藏。             [返回导入列表]
```

## 37. 500 安全错误

状态：保留或清除按错误矩阵；View=原安全位置；动作=刷新；能力=按当前会话；轮询=有界退避；Unknown=结构化 500 时否；旧结果=若仍合法可保留。

```text
服务暂时无法完成请求，请稍后重试。
支持编号：{request_id}
不会显示 SQL、堆栈、数据库、Queue 或原始 Payload。      [刷新]
```

## 38. 线框覆盖结论

本文件逐一覆盖任务要求的 37 个状态。Row Drawer Issue 状态明确采用局部门禁降级；所有写状态、权限、轮询、Unknown、旧 Current Run 和关键安全文案均已标注。

## 39. 实施后的视觉验收

`PHASE3-TASK04` 已按本线框实现统一工作区。隔离 Chromium 实测结果：

| 截图 | 视口 | 结论 |
| --- | --- | --- |
| `normalization-results-1366.png` | 1366×768 | 七步 Stepper、Current 汇总、50 Rows、筛选和文字状态可读 |
| `normalization-row-drawer-1366.png` | 1366×768 | Drawer 保留列表上下文，Basic/Attributes/Lineage 分区与关闭按钮可达 |
| `normalization-issues-1366.png` | 1366×768 | 100 Issues 当前页、五类真实筛选、文字 Level、Issue→Row 入口可达 |
| `normalization-row-drawer-700.png` | 700×768 | Drawer 实测宽度 700px，使用同一业务逻辑与焦点约束 |

截图位于 `chenyida_erp_site/output/playwright/` 且按仓库规则不提交。目视检查未发现 Sticky 遮挡、背景可交互、仅颜色状态或窄屏逻辑分叉。
