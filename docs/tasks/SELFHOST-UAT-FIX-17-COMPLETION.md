# SELFHOST-UAT-FIX-17 完成报告

## 最终状态

`PURCHASE DECISION CONFIRMATION FIXED — MAIN UAT NOT VERIFIED`

功能、自动验收、隔离写验收、正式备份恢复和 Web-only 部署均完成；主 UAT 不标记通过。唯一一次打开主 `PRQ-00000001` 接收确认窗口后，验收 runner 对“状态”标签使用非精确定位，同时匹配 PRQ 状态与 Package 状态并安全中止。任务遵守“一次打开”限制，没有重跑主窗口，没有点击确认接收或退回，也没有开始 RFQ 或创建任何下游单据。

## 起点与范围

- 起点为 clean `main@af7496babe8b704d04b22ad33bbb98a270519529`，Parent `ce3f14a0c989875e7527e42136967f9efe6ee548`，`origin/main...HEAD` behind 0 / ahead 125。
- 源码版本保持 `0.1.0-alpha.38`；Migration 保持 `0001`—`0037`，0037 SHA-256 为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 起点 Web 为 FIX-16 的 `sha256:d7ced686803c1f5f71ec101ebe28e3080005d534480dd39bfc8a91913ef12a5d`；PostgreSQL/Web healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 只修改自托管 Purchase Request 详情/确认读取与展示、对应测试及任务运维材料；没有修改历史 Sites、Python 业务行为、Schema、Migration、状态机或主 UAT 业务记录。

## 根因与权威来源

### 根因

FIX-15/FIX-16 已提供 Package→Plan→PRQ 谱系和当前供应投影，但采购接收确认仍存在四类可核验性缺口：

1. 上游事件 DTO 缺少明确 `type`、`timezone` 和顶层结构化别名，确认窗口只显示摘要，不能逐段核对完整凭证。
2. 页面用待接收/已处理队列数量代替当前 PRQ 的真实 Purchase ACCEPT/RETURN 决策计数。
3. 接收确认只显示当前供应摘要，没有逐 Material 展示全部九项供应和七项固定快照数量。
4. 打开确认时没有独立加载窗口与前后端完整性门禁；关键事件或供应字段缺失时，客户端没有第二道失败关闭保护。

### 权威事件与供应来源

- Package ACCEPT：`project_planning_handoff_events` 中精确绑定当前 Package + Project 的不可变 `ACCEPTED` Event。
- Plan GENERATE：`planning_material_requirement_events` 中精确绑定当前 Plan 的 `GENERATED/REGENERATED` Event。
- PRQ SUBMIT：同一不可变事件表中同时绑定当前 Plan + Purchase Request 的 `SUBMITTED` Event。
- 决策计数：只统计当前 Plan + PRQ 的 `PURCHASE_ACCEPTED` / `PURCHASE_RETURNED` 不可变 Event，不由状态或队列推断。
- 当前供应：复用 FIX-16/D-089 的 `current-supply.ts`，以 MAIN Inventory Balance、SUBMITTED/ACCEPTED Planning Allocation、有效 PO/Line/Delivery Plan 剩余量为权威，只读计算九项供应。
- 事件插入与对应业务状态变更处于既有同一事务；只有已提交不可变 Event 才投影 `result=SUCCESS`。未从无关 Audit 拼接，也未建立第二权威模型；0037 足以表达全部事实，未创建 0038。

## 实现结果

- 服务端详情新增/复用 `decision_counts.accept_count`、`decision_counts.return_count`、`package_accept_event`、`plan_generate_event`、`prq_submit_event` 和 `current_supply_observed_at`；嵌套兼容字段保持。
- 每段事件包含 `action`、`type`、actor、occurred_at、`timezone=Asia/Shanghai`、request_id、`result=SUCCESS` 和证据来源。查询精确限定当前 Package/Project、Plan、PRQ，并要求关键事件唯一。
- 详情继续在单个 `REPEATABLE READ READ ONLY` 事务内先执行认证、purchase capability 和对象范围校验，再查询精确行集。查询不写业务、Audit、Idempotency、Inventory 或 Allocation。
- 行数、Package 摘要/状态、三段事件、决策计数、观察时间或任一 Material 九项供应缺失/异常时，服务端稳定返回 `409 PURCHASE_REQUEST_CONFIRMATION_INCOMPLETE`；客户端也保持确认按钮禁用。
- 接收按钮先显示“正在重新读取当前供应”窗口；默认焦点为取消，等待按钮禁用。刷新完成后显示查询时间，只有完整数据才进入确认窗口。
- 确认窗完整显示 PRQ/Project/日期/状态、Package 2/v2 摘要和 ACCEPT、Plan 1/v1 计算/快照时间和 GENERATE、PRQ SUBMIT、显式决策计数、四个 Material 的七项固定数量与九项当前供应、三条公式/边界及接收后果。
- 取消、关闭、背景及 ESC 不发业务写；确认点击同步防重并保留既有 Cookie/Header CSRF、Origin、CAS、持久幂等、事务和状态保护。桌面与 390×844 均无页面级横向溢出。

## 修改文件

### 功能与测试

- `chenyida_erp_site/app/lib/material-requirement-selfhost/service.ts`
- `chenyida_erp_site/app/planning/material-requirement-workspace.tsx`
- `chenyida_erp_site/app/planning/planning.css`
- `chenyida_erp_site/tests/selfhost-material-requirement-unit.test.mjs`
- `chenyida_erp_site/tests/selfhost-material-requirement-ui-contract.test.mjs`
- `chenyida_erp_site/tests/selfhost-material-requirement-postgres.test.mjs`
- `chenyida_erp_site/tests/selfhost-purchase-traceability-browser.test.mjs`
- `chenyida_erp_site/tests/selfhost-procurement-sourcing-postgres.test.mjs`（仅修复既有 sourcing fixture：使用真实 Inventory Service/Ledger 和合法 `STOCKED` 物料，断言改为 ledger delta；产品行为未改）

### 运维与文档

- `chenyida_erp_site/scripts/selfhost-purchase-confirmation-fix17-protection.mjs`
- `chenyida_erp_site/scripts/selfhost-purchase-confirmation-fix17-uat-readonly-browser.mjs`
- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/project/STATUS.md`
- `docs/project/CHANGELOG.md`
- `docs/tasks/SELFHOST-UAT-FIX-17.md`
- 本报告

没有形成新的业务或安全决策，因此未新增或修改 `DECISIONS.md`。

## 自动测试

| 验证 | 结果 | 覆盖 |
| --- | --- | --- |
| FIX-17 unit/UI | PASS 10/10 | 三段完整凭证、显式计数、九项供应、缺字段失败关闭、刷新时间、取消/关闭/ESC、390px 合同 |
| 适用静态/UI 回归 | PASS 62/62 | Material Requirement、Planning Package、Inventory、Procurement sourcing、Identity/CSRF/Origin |
| FIX-17 PostgreSQL | PASS 8/8 | 精确事件归属、诱饵隔离、真实计数、零查询写、purchase/未授权/跨项目、非零供应公式、刷新新值、正式接收安全、幂等/CAS/故障回滚 |
| 跨域 PostgreSQL | PASS 34/34 | Planning 12、Inventory 3、Procurement 7、Sourcing 2、Identity 10 |
| 隔离 Chromium | PASS 1/1 | 桌面与 390×844、加载窗/安全焦点、缺字段禁用、取消/关闭/ESC 零写、双击单 ACCEPT、历史重开、logout 后 back/forward/refresh 保护 |
| Schema/Migration consistency | PASS 4/4 | 0037 Schema/Journal/不可变校验和、空库升级/重放、0036→0037、DDL 失败回滚 |
| 文件与安全 | PASS | `npm test` 3/3、CSRF/Origin 11/11、1,155 个仓库文件凭据扫描、`git diff --check` |
| 类型/构建/风格 | PASS | Material Requirement typecheck、production build、最终 Docker Web build；lint 0 error/10 个既有 warning |
| Python/SQLite | PASS 3/3 | `server.py --self-test`、`smoke_test.py`、一次性临时 SQLite `go_live_check.py --no-backup`；临时数据已清理 |

非零供应场景精确验证：在手 12、正式预留 2、品质冻结 1 → 库存可用 9；计划库存分配 3 → 未分配库存 6；有效在途 8、计划在途分配 2 → 未分配在途 6。初次详情后把在手改为 13，再次打开读取为库存可用 10、未分配库存 7，证明每次打开均重新查询。

隔离正式接收只生成一条 `PURCHASE_ACCEPTED`，重放不重复，异正文冲突、过期 CAS 和并发双确认安全；接收后计数为 1/0，全部下游仍为 0。故障注入后 PRQ/Plan/Event/Audit/Idempotency 均无半记录。

## 主 UAT 前后保护事实

### 起点与正式保护指纹

- 起点检查清单指纹：`6be53bc4c50b39fc0bd482ba9495723998e30cb1d4567b098a40d0c7a0f92688`。
- 扩展正式保护指纹：部署前主库、第二新空恢复库、部署后 UAT 前和 UAT 中止后均为 `e80ed1795079a3467ba4f05e2751fd8a9575e1b441b2433b371651479ca2cab0`。
- PRQ ID 1 / `PRQ-00000001` 始终 `SUBMITTED` / 待采购接收；Plan ID 1/v1 始终 `SUBMITTED`；Package ID 2/v2 始终 `ACCEPTED`。
- Purchase ACCEPT/RETURN 始终 `0/0`；待接收/已处理始终 `1/0`。
- Material 533、534、535、536 始终各为毛需求 10、快照库存可用/分配 0/0、快照在途可用/分配 0/0、净采购 10、PRQ 10 PCS。
- 四个 Material 的在手、正式预留、品质冻结、库存可用、计划库存分配、未分配库存、有效在途、计划在途分配、未分配在途始终全部 0 PCS。
- 对应 Inventory Balance 行 0、Planning Allocation 0；RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 全部 0。

### 三段事件凭证

- Package ACCEPT：actor `uat_20260729_planning`，`2026/08/03 00:19:09 Asia/Shanghai`，request_id `61fcf8bd-3d35-4324-b748-5c34541cbed9`，SUCCESS。
- Plan GENERATE：actor `uat_20260729_planning`，计算/事件时间 `2026/08/03 08:55:59 Asia/Shanghai`，快照截止 `2026/08/03 09:00:02 Asia/Shanghai`，request_id `cd625756-4e4c-451f-8230-eb8b77d4f6e0`，SUCCESS。
- PRQ SUBMIT：actor `uat_20260729_planning`，`2026/08/03 09:00:02 Asia/Shanghai`，request_id `5cd10203-a200-464b-9cf1-fd6955273baf`，SUCCESS。

自动/隔离 Chromium 已验证上述三段凭证、显式 0/0 和四个 Material 九项供应在完整确认窗口中显示。主 UAT 只确认了 purchase 登录、队列 1/0、详情显式 ACCEPT/RETURN 0/0、刷新等待窗、默认取消焦点、完整确认窗已打开且确认按钮通过完整性门禁；runner 随后在读取“状态”时因定位二义停止，故不声称主 UAT 已逐项核对三段凭证或九项供应。

### 主 UAT 安全停止与 Session

- 主 UAT 只登录 `uat_20260729_purchase`，没有登录其他角色或访问其他 PRQ。
- 唯一一次打开确认窗后没有点击确认、退回或任何下游操作；中止清理只执行 logout。保护指纹证明业务 POST 结果为 0。
- 本次最新 purchase Session 创建于 `2026-08-03 20:44:08 Asia/Shanghai`，最终 `revoked=true / LOGOUT`。任务前已有一条仍有效的 purchase Session，任务后有效数仍为 1；该既有 Session 未越权撤销，也未冒充本次 Session。
- runner 的状态定位已在仓库脚本中收窄到“PRQ 与项目”区块并通过语法/lint，但因主 UAT 只允许打开一次，本任务未重跑。

## 备份、恢复与部署

- 正式备份：`/var/backups/chenyida-erp/purchase-confirmation-fix17-predeploy-20260803T123649Z.dump`，root:root 0600，2,185,361 bytes。
- SHA-256：`896b92493480fe3aa08d3b84600e1804df60794108c776ef29aabee2fce0e8e8`；`pg_restore --list` 3,285 项通过。
- 第二新空库 `erp_fix17_restore_verify` 恢复为 37/head 0037，0037 checksum、身份非敏感计数和正式保护指纹 `e80ed179…` 与主库一致；恢复库与容器内临时 dump 已精确删除，正式备份保留。
- 候选/运行 Web：`sha256:97dcabe8d15c66dc54aec3e6a1f3febf168605b30292fad532177f000e2f18df`，88,469,082 bytes。
- Web-only 更新前为 `sha256:d7ced686803c1f5f71ec101ebe28e3080005d534480dd39bfc8a91913ef12a5d`；旧镜像保留 `chenyida-erp-parallel-web:rollback-purchase-confirmation-fix17-predeploy-20260803T123806Z`。
- 只重建 Web；PostgreSQL `f3a2f3cb…`、Worker `fb68d9a8…`、Caddy `c209765b…` 的容器 ID/启动时间/镜像不变。没有运行 Migration，没有改变 Origin、端口、凭据或四个受保护 Volume。
- 部署后 Web/PostgreSQL healthy，Worker/Caddy running；内外 `/api/health` 通过，四服务 restart 0/OOM false，数据库仍为 37/head 0037。

## Git、资源与清理

- 功能提交：`13da8a14d037d279278ef8c8ea86e52d79552512`（`fix: complete purchase acceptance confirmation`）。
- 保护 runner、部署/UAT 事实与本完成报告由独立 `ops: accept purchase confirmation fix` 提交收口；实际 SHA 以 `git log` 为准。
- 未 push、创建 PR、amend、rebase、reset、stash、restore 或改写历史。
- 起点约 available memory 2.1 GiB、Swap 302 MiB / 1 GiB、根盘可用 21 GiB、Load `0.18/0.48/0.42`；终点约 2.2 GiB、304 MiB / 1 GiB、21 GiB、Load `0.24/0.32/0.27`。
- 任务时段内核 OOM 匹配 0；四服务 RestartCount 0、OOM false。未触发内存、Swap、磁盘或 Load 停止阈值。
- FIX-17 临时数据库 0、临时容器 0、临时网络 0、临时 Playwright/Python/SQLite 路径 0；恢复库和容器内 dump 已清理。正式备份、候选/当前/回退镜像及四个受保护 Volume 保留。
- 未执行任何 Docker prune，未修改 Swap、dockerd、内核、防火墙或 systemd。

完成后立即停止：不得接收或退回 `PRQ-00000001`，不得开始询价，亦不得创建任何下游单据。
