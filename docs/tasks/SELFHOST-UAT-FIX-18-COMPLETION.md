# SELFHOST-UAT-FIX-18 完成报告

## 最终状态

`PURCHASE ACCEPTANCE HISTORY FIXED — UAT ACCEPTANCE VERIFIED`

采购接收历史凭证、即时成功凭证与 Plan 状态投影已修复；自动测试、隔离 PostgreSQL/Chromium、正式备份恢复、Web-only 部署及主 UAT 只读验收全部完成。主 `PRQ-00000001` 没有被再次接收、退回、编辑或重放，没有创建 RFQ 或任何下游单据。

## 起点与范围

- 严格起点为 clean `main@eff3df28e1781f13dc5a529f13e83e621bda5a28`，Parent `13da8a14d037d279278ef8c8ea86e52d79552512`，`origin/main...HEAD` behind 0 / ahead 127。
- 源码和运行版本保持 `0.1.0-alpha.38`；Migration 保持 `0001`—`0037`，0037 SHA-256 为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 起点 Web 为 `sha256:97dcabe8d15c66dc54aec3e6a1f3febf168605b30292fad532177f000e2f18df`；PostgreSQL/Web healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。
- 只修改自托管 Purchase Request 详情读模型、即时/历史凭证 UI、相关测试、保护/UAT runner 和项目文档；没有修改 Schema、Migration、版本、状态机、主 UAT 业务记录、历史 Sites/D1 或 Python 业务行为。

## 权威来源与状态结论

### Purchase ACCEPT 权威来源

- 权威业务事实是 `planning_material_requirement_events` 中同时精确绑定当前 `plan_id` 与 `purchase_request_id` 的不可变 `PURCHASE_ACCEPTED` / `PURCHASE_RETURNED` Event。
- `action/type` 由唯一事件类型确定；actor、occurred_at、request_id 直接读取该 Event；稳定 PRQ ID 读取 `planning_purchase_requests.id`；ACCEPT/RETURN 数量只统计当前 Plan+PRQ 的两类决策 Event。
- 已处理状态还必须与 PRQ 的 accepted/returned actor、时间、request_id 以及 Plan 的对应终态完全一致；任一事件缺失、重复、串入诱饵或事实矛盾均返回 `409 PURCHASE_REQUEST_CONFIRMATION_INCOMPLETE`。
- 不读取当前登录用户来补 actor，不从页面状态或队列数量反推决策，不把普通 Audit 猜作业务 Event，也不伪造失败事件或空请求号。

### `SUCCESS` 展示语义

事件表没有独立 result 列。Purchase 决策 Event、PRQ/Plan 状态转换、成功 Audit 和 Idempotency 记录由既有 Repository 在同一事务中提交；Event 只能在事务成功提交后被独立读取，回滚会同时移除这些写入。因此读模型把已验证的不可变 Event 精确投影为 `result=SUCCESS`。该语义已在服务端注释、D-090、UI 文案、事务故障测试和完成报告中说明，不表示数据库保存了 result 列，也不生成失败 Event。

### Plan 状态：分支 A

- 数据库中的 Material Requirement Plan 确实在 Purchase ACCEPT 事务中由 `SUBMITTED` 转为 `ACCEPTED`；PRQ 同时转为 `ACCEPTED`，二者各自使用权威表字段，不存在 DTO/UI 借用 PRQ 状态的问题。
- 该转换符合现有状态约束、CAS、同事务 Event/Audit/Idempotency 与故障回滚设计；主库 Plan ID 1/v1 当前为 `ACCEPTED`/row version 3。
- 页面已把 Plan 字段明确命名为“采购交接状态：ACCEPTED”，把 PRQ 独立显示为“PRQ 状态：ACCEPTED / 采购已接收”，并明确 Plan v1 的计算快照、行项目、分配及来源摘要没有被改写。
- 不需要修改主 UAT 历史数据，也不需要 0038。

## 实现结果

- 已处理详情新增与 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 分区的“采购决策凭证”，完整显示 Purchase Request ID、PRQ、决策/中文、Event 类型、Actor、Asia/Shanghai 时间、显式 SUCCESS、独立 ACCEPT/RETURN 数量和可复制请求号。
- 服务端只查询当前 Plan+PRQ 的决策 Event，并把相同权威对象同时放入顶层和 PRQ 嵌套 DTO；缺少或矛盾时失败关闭。
- 即时决定成功后不再从 Session 当前用户或 POST 页面状态拼凭证，而是重新 GET 已提交历史；只有完整权威 Event 与返回 request_id 一致时才显示即时 SUCCESS。读取失败时明确禁止重试决定。
- 已处理历史不渲染接收、退回、textarea 或编辑控件；刷新、重新登录和 Web 重启均从 PostgreSQL 重新恢复同一凭证。
- 390×844 与桌面均无页面级横向溢出；请求号可完整读取和复制；安全退出后 back/forward/refresh 均不能恢复内容。

## 主 UAT 完整 Purchase ACCEPT 凭证

| 字段 | 权威值 |
| --- | --- |
| Purchase Request ID | `1` |
| PRQ | `PRQ-00000001` |
| 决策 | `ACCEPT / 采购接收` |
| Event type | `PURCHASE_ACCEPTED` |
| Actor | `uat_20260729_purchase` |
| 时间 | `2026/08/04 06:06:15 Asia/Shanghai` |
| request_id | `80568b28-47f5-4f58-8901-afc053871998` |
| 结果 | `SUCCESS` |
| ACCEPT/RETURN | `1/0` |

Package ID 2/v2 和 Plan ID 1/v1 引用保持；Package ACCEPT、Plan GENERATE、PRQ SUBMIT 三段上游凭证仍独立显示，Purchase ACCEPT 没有被标成 Planning ACCEPT。

## 自动与隔离测试

| 验证 | 结果 | 覆盖 |
| --- | --- | --- |
| FIX-18 unit/UI | PASS 10/10 | 即时/历史 SUCCESS、四段凭证分区、独立计数、Plan/PRQ 各自字段、失败关闭、复制、无终态写控件、390px 合同 |
| FIX-18 PostgreSQL | PASS 8/8 | 0/0→1/0、actor/time/request_id 持久化、同键重放、异键并发单胜、诱饵隔离、权限/跨项目 403、历史查询零写、分支 A、故障零半记录和零下游 |
| 隔离 Chromium | PASS 1/1 | 单一隔离 ACCEPT、即时 SUCCESS、历史重开、刷新、Web 重启、重新登录、桌面/390×844、复制、终态无按钮和退出历史保护 |
| 适用静态/UI 回归 | PASS 63/63 | Purchase Request、Planning Package、Inventory、Procurement sourcing、Identity、CSRF、Origin |
| 跨域 PostgreSQL | PASS 34/34 | Planning 12、Inventory 3、Procurement 7、Procurement sourcing 2、Identity 10 |
| Schema/Migration | PASS 7/7 | 0037 Schema consistency 4/4、Material Requirement 既有数据升级/重放/回滚 3/3 |
| 文件/安全 | PASS | `npm test` 3/3、1,159 个仓库文件 credentials scan、`git diff --check` |
| 类型/构建/风格 | PASS | Material Requirement typecheck、production build、最终 Docker Web build；lint 0 error/10 个既有 warning |
| Python/SQLite | PASS 3/3 | `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup`；最终使用项目虚拟环境，临时数据清理 |

历史 D1 的 `run-api-smoke.mjs` 在任何 D1 migration 或业务断言前失败关闭，因为当前 package 依赖清单已不包含它引用的 Wrangler；没有连接或写 D1。该保留运行面不是本次自托管 Node/PostgreSQL Web 的适用回归，未为运行旧 smoke 擅自新增依赖或扩大任务。

主 UAT runner 前两次均在完成只读页面检查后被旁路测试假设拦截：第一次错误假设数量与 PCS 同行，第二次错误要求三个详情 GET，而旅程严格只有首次打开和刷新后重开两次。两次都在 `finally` 退出且保护指纹/Session 为零；最终将数量断言改为只忽略 DOM 空白、网络边界改为严格 `target_get=2`，没有删除任何业务内容、安全或零写断言，最终完整通过。

## 主 UAT 前后保护事实

- 正式扩展保护指纹在部署前主库、第二新空恢复库、部署后 UAT 前、两次 runner 旁路停止后和最终 UAT 后均为 `814811509c476e270f9cd82badb85aa8bb1bf8e1f01e8bb72b4cd9fec9c9a4ff`。
- PRQ ID 1/Plan ID 1 均保持 `ACCEPTED`；Package ID 2/v2 保持 `ACCEPTED`；待接收/已处理保持 `0/1`；Purchase ACCEPT/RETURN 保持 `1/0`。
- Material 533—536 均保持毛需求 10、快照库存可用/分配 0/0、快照在途可用/分配 0/0、净采购 10、PRQ 10 PCS；四个 Material 的九项当前供应继续全部为 0 PCS。
- Inventory Balance 行、Planning Allocation、RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 均保持 0。
- 主 UAT 只使用 `uat_20260729_purchase`，只访问目标 PRQ；最终 runner 为 `business_post=0`、`other_object_get=0`、login/logout 1/1、Session revoked。没有登录其他角色或访问其他业务对象。

## 备份、恢复与部署

- 正式备份：`/var/backups/chenyida-erp/purchase-history-fix18-predeploy-20260804T020210Z.dump`，root:root 0600，2,186,157 bytes。
- SHA-256：`3041980fa1d79e489360bdeacacfe15ee4686673334ee7b8158cea3ca6b7247a`；`pg_restore --list` 3,285 项通过。
- 第二新空库 `erp_fix18_restore_verify` 恢复为 37/head 0037；0037 checksum、身份非敏感计数和完整保护指纹 `814811509c…` 与主库一致。恢复库与容器内 dump 已精确删除，正式备份保留。
- 候选/运行 Web：`sha256:6eeba6409f51605fe422c39d674ddfa03d5f5079bb546566288336f15296df64`，88,472,258 bytes。
- 更新前 Web `sha256:97dcabe8d15c66dc54aec3e6a1f3febf168605b30292fad532177f000e2f18df` 保留为 `chenyida-erp-parallel-web:rollback-purchase-history-fix18-predeploy-20260804T020447Z`。
- 使用 `--no-deps --no-build` 只替换 Web。PostgreSQL `f3a2f3cb…`、Worker `fb68d9a8…`、Caddy `c209765b…` 的容器 ID、启动时间和镜像不变；没有运行 Migration，没有改变 Origin、端口、凭据或四个受保护 Volume。
- 部署后内外 `/api/health` 通过；Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOM false，数据库仍为 37/head 0037。

## Git、资源与清理

- 功能提交：`9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`（`fix: expose purchase acceptance history`）。
- 保护 runner、D-090、部署/UAT 事实和本报告由独立 `ops: accept purchase history traceability` 提交收口；实际 SHA 以 `git log` 为准。
- 未 push、创建 PR、amend、rebase、reset、stash、restore 或改写历史。
- 起点约 2.2 GiB available、Swap 309 MiB / 1 GiB、根分区可用 21 GiB、Load `0.15/0.14/0.08`；终点约 2.1 GiB、257 MiB / 1 GiB、21 GiB、Load `0.16/0.33/0.34`。
- 任务时段内核 OOM 匹配 0；四服务 RestartCount 0、OOM false；没有触发内存、Swap、磁盘或 Load 停止阈值。
- FIX-18 隔离/恢复数据库 0、临时容器 0、临时网络 0、Playwright/Python/SQLite 路径 0；任务生成的忽略构建目录已清理。正式备份、候选/当前/回退镜像及四个受保护 Volume 保留。
- 未执行 Docker prune，未修改 Swap、dockerd、内核、防火墙或 systemd。

## 后续条件

从业务前置事实看，已具备开始采购寻源与询价的条件：PRQ 已由采购接收，稳定 Plan/PRQ/四行物料及完整成功凭证可追溯，且当前没有 RFQ 或其他下游单据。实际创建 RFQ、询价、报价比较或任何采购下游记录仍必须另立独立任务并取得明确授权；本任务完成后立即停止，没有创建 RFQ。
