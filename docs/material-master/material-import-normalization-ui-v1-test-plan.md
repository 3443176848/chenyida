# Material Import Normalization Review UI V1：未来实施测试计划

## 0. 规则

本计划共 104 项唯一测试。`写` 表示会发送受保护写请求；`D1` 表示未来实施时需要隔离 Miniflare D1；`PW` 表示需要 Playwright。任何测试不得连接生产 URL、远程 Binding 或真实业务数据。当前 Node 基线必须在未来实施前重新核验；本 docs-only 任务不运行这些未来测试。

## A. 路由、恢复及 Stepper（12）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-RS-001 | `MAPPING_CONFIRMED`、无 Current | 无 View 打开 | `replaceState` 到 `view=normalize` | 组件 | 否 | 否 | 是 |
| NUI-RS-002 | `NORMALIZED`、Current 存在 | 无 View 打开 | 默认 `view=normalized` | 组件 | 否 | 否 | 是 |
| NUI-RS-003 | 首次活动、无 Current | URL 为 `normalized` | 修正为 `normalize`，不请求 Rows | 集成 | 否 | 是 | 否 |
| NUI-RS-004 | 重跑活动、旧 Current 存在 | 打开 `normalized` | 可读旧结果，Latest 继续轮询 | 集成 | 否 | 是 | 是 |
| NUI-RS-005 | 无 Current | URL 带合法 Row | 移除 Row，不请求 Detail | 组件 | 否 | 否 | 否 |
| NUI-RS-006 | `view=normalize` | URL 带 Row | 仅移除 Row，保留其他合法参数 | 单元 | 否 | 否 | 否 |
| NUI-RS-007 | URL 含未知 View/参数 | 初始加载 | Allowlist 规范化且最多一次自动重读 | 单元 | 否 | 否 | 否 |
| NUI-RS-008 | `MAPPING_CONFIRMED` | 查看 Stepper | 前五完成、第六当前、第七锁定 | 组件 | 否 | 否 | 否 |
| NUI-RS-009 | 首次 Latest Failed | 查看 Stepper | 第六失败、第七锁定 | 组件 | 否 | 否 | 否 |
| NUI-RS-010 | 重跑 Failed + 旧 Current | 查看 Stepper | 第六辅助失败、第七仍可访问 | 组件 | 否 | 否 | 否 |
| NUI-RS-011 | 1366×768 | 键盘遍历 Stepper/主区 | 标签可读、焦点不被遮挡 | E2E | 否 | 否 | 是 |
| NUI-RS-012 | 700px | 打开工作区和 Drawer | Stepper 可滚动/纵向，Drawer 全宽，逻辑不分叉 | E2E | 否 | 否 | 是 |

## B. 启动、幂等及 RESULT_UNKNOWN（12）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-ID-001 | 首次启动资格满足 | 点击启动 | 先复合读取 B/M/S，再打开确认 | 集成 | 否 | 是 | 否 |
| NUI-ID-002 | Mapping 非 Confirmed/Parse 不匹配 | 点击入口 | 前端不发送 POST，显示安全刷新 | 集成 | 否 | 是 | 否 |
| NUI-ID-003 | 有 N、无活动 Run | 确认首次启动 | Body 仅含最新 Version 与共享 Processor 常量 | API 集成 | 是 | 是 | 否 |
| NUI-ID-004 | 首次启动 | 捕获请求 Body | 省略 `rerun_reason`，常量不来自输入/URL | 单元 | 是 | 否 | 否 |
| NUI-ID-005 | 首次 Failed，后端恢复允许 | 点击业务重试 | 新 Key、新 Version、同发布常量、新 Run | API 集成 | 是 | 是 | 否 |
| NUI-ID-006 | 原启动响应丢失 | 点击安全重试 | 原 Key/Method/Endpoint/冻结 Body 逐字节复用 | API 集成 | 是 | 是 | 否 |
| NUI-ID-007 | 启动 Unknown | 尝试取消/新启动/重跑 | 全部阻断，GET 与原重放仍允许 | 组件 | 否 | 否 | 否 |
| NUI-ID-008 | 明确 409/422/429/结构化 500 | 处理错误 | 记录 FAILED，不进入 Unknown | 单元 | 否 | 否 | 否 |
| NUI-ID-009 | Unknown 存在 | 离开页面 | 触发离开保护；普通轮询不触发 | E2E | 否 | 否 | 是 |
| NUI-ID-010 | Unknown 后刷新 | 重载页面 | 不恢复 Key/Unknown；只显示权威状态与凭证丢失说明 | E2E | 否 | 是 | 是 |
| NUI-ID-011 | Current Processor 等于发布常量 | 查看重跑区 | 仅显示本版本说明，无按钮 | 组件 | 否 | 否 | 否 |
| NUI-ID-012 | Current Processor 不同 | 提交重跑理由 | Trim 1–500、无控制字符；冻结理由且新 Key | API 集成 | 是 | 是 | 否 |

## C. 轮询、进度、限流及取消（14）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-PC-001 | 新轮询会话 | 推进 0–10s | 每 2s 调度且不重叠 | 单元 | 否 | 否 | 否 |
| NUI-PC-002 | 同会话 | 推进 10–60s | 每 5s 调度 | 单元 | 否 | 否 | 否 |
| NUI-PC-003 | 同会话 | 推进 60s 后 | 每 10s 调度 | 单元 | 否 | 否 | 否 |
| NUI-PC-004 | 连续网络错误 | 推进重试 | 5/10/30/30s 退避 | 单元 | 否 | 否 | 否 |
| NUI-PC-005 | 429 秒数/HTTP 日期 | 轮询 | 到期前不请求，正确恢复 | 单元 | 否 | 否 | 否 |
| NUI-PC-006 | 页面隐藏 | 等待并恢复 | 隐藏暂停；可见立即刷新且无重叠 | E2E | 否 | 否 | 是 |
| NUI-PC-007 | 一轮 B 成功、S 失败 | 提交状态 | 不拼接新 B 与旧 S | 集成 | 否 | 是 | 否 |
| NUI-PC-008 | 慢旧 Generation | 新轮已完成 | 旧响应不覆盖 | 单元 | 否 | 否 | 否 |
| NUI-PC-009 | 合法 Total/Processed | 显示进度 | Floor 百分比且标签为行处理进度 | 组件 | 否 | 否 | 否 |
| NUI-PC-010 | Processed=Total、Stage Verify/Publish | 显示进度 | 行处理完成但任务未称完成 | 组件 | 否 | 否 | 否 |
| NUI-PC-011 | 计数负数/超界/不安全整数 | 连续读取 | 隐藏数字、刷新一次、仍错则安全异常并停高频 | 集成 | 否 | 是 | 否 |
| NUI-PC-012 | Latest 进入终态 | 轮询 | 停 Timer，最终 B/S 复合读取后落点 | 集成 | 否 | 是 | 否 |
| NUI-PC-013 | 活动 Batch、有 X | 确认取消 | 仅发送 Version + `USER_CANCELLED`，独立 Key/冻结 Body | API 集成 | 是 | 是 | 否 |
| NUI-PC-014 | 取消与发布竞争 | 分别让两方胜出 | 首次取消无结果；重跑取消保旧结果；发布胜出显示新结果 | API/E2E | 是 | 是 | 是 |

## D. Normalization 汇总一致性（8）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-SM-001 | Current/Latest 同 ID | 打开结果页 | 只渲染一份汇总 | 组件 | 否 | 否 | 否 |
| NUI-SM-002 | Current/Latest 不同且 Latest Failed | 打开结果页 | 旧汇总不变，显示最近尝试失败横幅 | 组件 | 否 | 否 | 否 |
| NUI-SM-003 | Total=Valid+Warning+Error | 展示汇总 | 四类数字及 Issue 数正常显示 | 组件 | 否 | 否 | 否 |
| NUI-SM-004 | 分类合计不等于 Total | 展示汇总 | 拒绝错误数字，显示一致性异常 | 集成 | 否 | 是 | 否 |
| NUI-SM-005 | Current Run 缺失但 Batch Normalized | 初始读取 | 不猜 Latest，进入安全刷新 | 集成 | 否 | 是 | 否 |
| NUI-SM-006 | 结果含 Error Rows | 查看标题 | 显示“已完成，其中 N 行需要处理”，不称任务失败 | 组件 | 否 | 否 | 否 |
| NUI-SM-007 | Run 详情部分字段缺失 | 展开支持信息 | 缺失项不渲染，不补 Null | 组件 | 否 | 否 | 否 |
| NUI-SM-008 | 64 位 Digest | 展示支持信息 | 仅 8…8 缩略，不复制、不写 URL | 单元 | 否 | 否 | 否 |

## E. Normalized Rows 与 Cursor（12）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-RW-001 | Current 存在 | 初始 Rows | 请求 `limit=50`，不带虚构参数 | API 集成 | 否 | 是 | 否 |
| NUI-RW-002 | 选择 Error | 应用筛选 | 仅发送 `row_status=ERROR`，清 Cursor | API 集成 | 否 | 是 | 否 |
| NUI-RW-003 | Limit 50 | 切换 100 | Allowlist 接受并清 Cursor；任意数字拒绝 | 单元 | 否 | 否 | 否 |
| NUI-RW-004 | 返回 Next Cursor | 下一页 | 原样 URL 编码、Push Row Page Marker | E2E | 否 | 是 | 是 |
| NUI-RW-005 | 同一合法历史链 | 上一页 | 使用 `history.back`，不计算 Prev Cursor | E2E | 否 | 否 | 是 |
| NUI-RW-006 | 直接 Cursor URL | 打开 | 可加载当前页但无伪上一页/页码/总页数 | 组件 | 否 | 是 | 是 |
| NUI-RW-007 | 响应 Batch ID 不匹配 | 加载 | 整页拒绝，不静默过滤 | 集成 | 否 | 是 | 否 |
| NUI-RW-008 | 响应 Run ID 不匹配 | 加载 | 整页拒绝并安全刷新 | 集成 | 否 | 是 | 否 |
| NUI-RW-009 | 两 Sheet 有相同行号 | 渲染 | React Key 使用 Row ID，无冲突 | 组件 | 否 | 否 | 否 |
| NUI-RW-010 | 50 行摘要 | 渲染列表 | 只显示批准字段，无任何 Detail N+1 | 集成 | 否 | 是 | 否 |
| NUI-RW-011 | Current Run 切换 | 旧 Rows 请求晚返 | Abort/废弃，清 Cursor，从新 Run 第一页读取 | 集成 | 否 | 是 | 否 |
| NUI-RW-012 | 总行 0/筛选空/Error 0/Warning 0 | 查看空状态 | 四种文案区分且不称全部校验通过 | 组件 | 否 | 否 | 否 |

## F. Drawer、候选与 Lineage（10）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-DR-001 | Rows 页有 Row | 点击详情 | Push Drawer Marker，保留筛选/Cursor/滚动 | E2E | 否 | 是 | 是 |
| NUI-DR-002 | 直接合法 Row URL | 打开 | B/S/Current/Detail 顺序，不先加载列表 | 集成 | 否 | 是 | 否 |
| NUI-DR-003 | Row 为 `1e3`/空白/负数/超界 | 打开 | 不用 Number 宽松转换；移除参数且不请求 | 单元 | 否 | 否 | 否 |
| NUI-DR-004 | Detail 顶层/Lineage 任一归属矛盾 | 加载 | 整个正文拒绝，不选择相信某层 | 集成 | 否 | 是 | 否 |
| NUI-DR-005 | Candidate 为 Null/空串/False/0/空容器 | 渲染 | 六种存在性准确区分 | 组件 | 否 | 否 | 否 |
| NUI-DR-006 | Column Index=0、未知枚举 | 渲染 | 0 正常显示；未知值安全降级不崩 Drawer | 组件 | 否 | 否 | 否 |
| NUI-DR-007 | 深层/大数组/长字符串 | 展开值 | 类型化预算截断，不隐藏完整 JSON/HTML | 组件安全 | 否 | 否 | 否 |
| NUI-DR-008 | 200 动态属性 | 打开/折叠 | 按 Code 稳定排序，不请求当前 Catalog 标签 | 性能组件 | 否 | 否 | 是 |
| NUI-DR-009 | Category/Supplier/Deferred 多状态 | 查看 | 非正式分类、非内部 ID、后续校验语义准确 | 组件 | 否 | 否 | 否 |
| NUI-DR-010 | 关闭、Row/Run 快切 | 操作 Drawer | Abort 旧请求、释放大型对象、三级焦点恢复 | E2E | 否 | 是 | 是 |

## G. Issues 与筛选（12）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-IS-001 | Current 存在 | 初始 Issues | 只发送 `limit=50` | API 集成 | 否 | 是 | 否 |
| NUI-IS-002 | 合法 Level/Code/Target/Row | 应用筛选 | 正确映射参数并 URL 编码，清 Cursor | API 集成 | 否 | 是 | 否 |
| NUI-IS-003 | URL 含 Row Status/Sheet/Sort/Page | 初始加载 | 参数不发送 API，并由 `replaceState` 清理 | 单元 | 否 | 否 | 否 |
| NUI-IS-004 | `issue_row` 为小数/科学计数/超界 | 加载 | 删除坏参数，最多自动重读一次 | 单元 | 否 | 否 | 否 |
| NUI-IS-005 | Next Cursor | 下一页/上一页 | 使用独立 Issue Marker；不混 Rows Marker | E2E | 否 | 是 | 是 |
| NUI-IS-006 | 直接 Issue Cursor URL | 打开 | 无伪 Prev/页码/总页数，不解析 Cursor | 组件 | 否 | 是 | 是 |
| NUI-IS-007 | Batch/Run 归属不匹配 | 加载 | 整页拒绝，不过滤后展示 | 集成 | 否 | 是 | 否 |
| NUI-IS-008 | Source Column=0 | 渲染列表 | 列 0 正常显示，Level 有文字和非颜色标识 | 组件 | 否 | 否 | 否 |
| NUI-IS-009 | 18 个稳定 Code + 未知 Code | 渲染 | 中文标签正确；未知不近似匹配且保留服务端 Level | 单元 | 否 | 否 | 否 |
| NUI-IS-010 | Safe Details 含五个合法键及未知键 | 展开 | 五键有界展示，未知键忽略，无 JSON 降级 | 组件安全 | 否 | 否 | 否 |
| NUI-IS-011 | Issue 含 Normalized Row ID | 点击查看行 | 保持 Issue 筛选/Cursor，打开同一 Drawer | E2E | 否 | 是 | 是 |
| NUI-IS-012 | Drawer Issue 区 | 查看/刷新 | 只显示 Summary+当前单条；刷新不伪恢复；提示局部门禁 | 组件 | 否 | 否 | 否 |

## H. 权限、安全及可访问性（16）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-SA-001 | 无 Read | 打开工作区 | 不请求受保护正文 | 集成 | 否 | 是 | 否 |
| NUI-SA-002 | 有 Read Any、无 N/X | 查看他人可见批次 | 可读，启动/重跑/取消按钮均不存在 | 组件 | 否 | 否 | 否 |
| NUI-SA-003 | 有 N、无 X | 活动任务 | 不由 N 推导取消权限 | 组件 | 否 | 否 | 否 |
| NUI-SA-004 | 轮询收到 401 | 处理 | Abort/停 Timer/清全部正文与操作，进入登录 | 集成 | 否 | 是 | 否 |
| NUI-SA-005 | Rows/Issues/Drawer 收到 403 | 处理 | 清 Current、列表、Drawer、Issue Context，显示无权限 | 集成 | 否 | 是 | 否 |
| NUI-SA-006 | 详情收到 404 | 处理 | 不存在或无权查看，不区分原因 | 组件 | 否 | 否 | 否 |
| NUI-SA-007 | Safe Message/Target 含 HTML/Markdown/URL | 渲染 | 纯文本、无链接、无执行、无原始 DOM ID | 组件安全 | 否 | 否 | 否 |
| NUI-SA-008 | 长 Message/Value | 打开有界详情 | 按钮可聚焦，Dialog 焦点循环/Escape/恢复 | E2E | 否 | 否 | 是 |
| NUI-SA-009 | 观察 Storage/History | 浏览 Rows/Drawer/Issues | 无 Payload、Key、Reason、Issue 正文或大对象持久化 | E2E 安全 | 否 | 否 | 是 |
| NUI-SA-010 | 捕获日志/遥测 | 完成浏览与错误 | 不含 Raw/Candidate/Message/Details/Cursor/Key/CSRF | 集成安全 | 否 | 否 | 否 |
| NUI-SA-011 | Stepper/Status/Issue Level | 关闭颜色样式检查 | 仍可通过文字理解 | 可访问性 | 否 | 否 | 是 |
| NUI-SA-012 | 进度连续逐行变化 | 使用屏幕阅读器 | 只在阶段/状态/终态变化播报 | 可访问性 | 否 | 否 | 是 |
| NUI-SA-013 | Rows/Issues 表格 | 检查语义 | 正确 Caption/Headers，筛选有可见 Label | 可访问性 | 否 | 否 | 是 |
| NUI-SA-014 | Issue 打开 Drawer | 检查关联 | 安全生成唯一 ID；Issue 与字段程序化关联 | 可访问性 | 否 | 否 | 是 |
| NUI-SA-015 | 触发按钮因翻页/Run 变化消失 | 关闭 Drawer | 焦点回列表容器，再降级到主标题 | E2E | 否 | 否 | 是 |
| NUI-SA-016 | 1366/700、键盘全流程 | 完成浏览 | Sticky 不遮焦点；无 Hover/拖拽/整行点击依赖 | E2E | 否 | 否 | 是 |

## I. 性能门禁（8）

| ID | 前置条件 | 操作 | 期望结果 | 层级 | 写 | D1 | PW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NUI-PF-001 | 50 Rows、每行计数 | 渲染/筛选 | 仅当前页 DOM，无 Detail 请求或长任务回归 | 性能 | 否 | 否 | 是 |
| NUI-PF-002 | 100 Issues | 渲染/筛选 | 仅当前页 DOM，无 Row Detail N+1 | 性能 | 否 | 否 | 是 |
| NUI-PF-003 | 200 Attributes | 打开/滚动 Drawer | 有界节点、可交互、无 Catalog 请求 | 性能 | 否 | 否 | 是 |
| NUI-PF-004 | 最大允许 Row Payload | 打开/关闭 | 有界展示，关闭后大型引用可回收 | 性能 | 否 | 是 | 是 |
| NUI-PF-005 | 最大合法 Safe Details 集合 | 展开 | 项数/字符预算生效，无隐藏全文 | 性能安全 | 否 | 否 | 是 |
| NUI-PF-006 | 快速切换 Rows/Issues 筛选和连续翻页 | 操作 | Abort/Stale Guard 正确，无缓存混合或请求爆发 | 性能集成 | 否 | 是 | 是 |
| NUI-PF-007 | Current Run 变化 | 加载旧列表/Drawer后切换 | 旧缓存/请求/History 参数清理，无旧正文残留 | 性能集成 | 否 | 是 | 是 |
| NUI-PF-008 | 1366×768 与 700px | 键盘/屏幕阅读器基础巡检 | 无新 Data Grid/大型状态库，布局和语义门禁通过 | 性能/E2E | 否 | 否 | 是 |

## 10. 计数汇总

| 分组 | 数量 |
| --- | ---: |
| A 路由、恢复及 Stepper | 12 |
| B 启动、幂等及 RESULT_UNKNOWN | 12 |
| C 轮询、进度、限流及取消 | 14 |
| D Normalization 汇总 | 8 |
| E Rows 与 Cursor | 12 |
| F Drawer、候选与 Lineage | 10 |
| G Issues 与筛选 | 12 |
| H 权限、安全及可访问性 | 16 |
| I 性能门禁 | 8 |
| **总计** | **104** |
