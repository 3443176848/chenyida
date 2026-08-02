# SELFHOST-OPS-UAT-PLANNING-DECISION-HISTORY-FIX-12

## 状态

- 状态：`DONE`
- 开始日期：2026-08-02（Asia/Shanghai）
- 完成日期：2026-08-02（Asia/Shanghai）
- 起点：`main@eaeae1c816256eb48355bdb117ecc20f6ac8545f`，behind 0 / ahead 115，工作区 clean。
- 源码与运行面：`0.1.0-alpha.37`；PostgreSQL 为 36/head `0036_project_requirement_unit_resolution.sql`。
- 授权：项目负责人明确授权本任务的隔离 PostgreSQL/Chromium 验收、PostgreSQL 备份与第二库恢复、并行非生产 UAT Web-only 部署，以及部署后 planning-only 只读核验和安全退出。
- 最终允许状态：`PLANNING DECISION HISTORY FIXED — UAT V1 RETURN VERIFIED`、`PLANNING HISTORY FIXED — MAIN UAT NOT VERIFIED` 或 `BLOCKED — NO UNSAFE CHANGE`。

## 唯一目标

补齐 Planning “待接收 / 已处理”视图，让 `RETURNED` 与 `ACCEPTED` Package 可从历史重新打开并查看 Package 范围 CREATE、SUBMIT/RESUBMIT、RETURN/ACCEPT 全事件；增加接收/退回确认窗口、完成凭证和“查看已处理详情”入口。保持 Product/BOM、Unit Resolution、Material Package Snapshot 只读，不修改状态机、权限、Migration 或版本。

## 受保护起点

- Package ID 1 / v1 / `RETURNED`；Package 总数 1、RETURN 事件恰好 1、ACCEPT 事件 0、v2 0。
- 数据库权威退回原因：`UAT退回验证:请在工程交接说明中补充“本批计划数量10 PCS,按BOM V1四项物料整批齐套”。保持Product A0、BOM V1、Unit Resolution v1及四项物料数量不变后提交v2。`
- Package `return_reason` 与唯一 RETURN Event `reason` 必须逐字相同；历史值不得修改、补写或美化。
- 源码与运行面保持 alpha.37；Migration 保持 0001—0036，不新增 0037。

## Unicode 等价门禁

1. 先把预期文本与数据库原文作精确比较，结果必须为“不完全相同”。
2. 两侧分别执行标准 Unicode NFKC，结果必须完全相同。
3. 原始差异只能是 U+FF1A `：` → ASCII `:` 和 U+FF0C `，` → ASCII `,`；数字、数量、单位、Product/BOM/Unit Resolution/Material 信息、词语、顺序与退回目标均不得被忽略。
4. 数据库原文是权威历史值；本任务不更新 Package、Event 或任何既有原因字段。
5. 该现象登记为 LOW 体验问题，不阻断当前业务链。

## 实施与验收边界

- Planning 列表提供“待接收”和“已处理”两个明确视图；已处理统一包含 `RETURNED` 与 `ACCEPTED`，并按处理时间倒序。
- Package 详情继续使用 Package 范围授权和同一只读快照事务；planning 不获得 `system.audit.read`，权限集不扩大。
- RETURN 详情必须显示数据库实际完整原因、操作者、Asia/Shanghai 时间、请求号、`SUCCESS` 和工程/项目部修订责任队列；具体处理人及 SLA 未配置时明确显示空状态。
- 接收与退回在业务 POST 前显示确认窗口；成功后显示含动作、Package、操作者、时间、请求号和结果的凭证，并提供“查看已处理详情”。
- 390px 页面级无横向溢出；Product/BOM、Unit Resolution 和 Material 固定快照无编辑控件。
- 不处理全局跨角色导航，不登录 engineering，不创建 v2；主 UAT 部署后只允许 planning 只读浏览和安全退出，不执行任何业务写。

## 测试与部署

- 低资源门禁下串行运行定向 unit/UI/typecheck、隔离 PostgreSQL、权限/诱饵审计/CSRF/Origin/幂等回归和合成 Chromium 退回→完成凭证→已处理历史回看旅程。
- 执行 390px 检查、适用全回归、lint、凭据扫描和 `git diff --check`。
- 部署前创建 root:root 0600 PostgreSQL custom dump，执行 `pg_restore --list` 并恢复到第二新空库核验 36/head、业务状态和退回原因。
- 只替换 Web；PostgreSQL、Worker、Caddy、四个受保护 Volume、alpha.37 和 0036 保持。
- 部署后主 UAT 只读核验 Package ID 1/v1/RETURNED、RETURN 1、ACCEPT 0、v2 0、完整权威原因与 NFKC 等价、RETURN 追溯和责任队列，然后 planning 安全退出并停止。

## 实施结果

- 功能提交：`180f6b58b583bd2dba350f017504be916db9673d`（`fix: expose planning decision history`）。Planning 队列新增“待接收 / 已处理”页签；`PROCESSED` 服务端口径仅映射 `RETURNED + ACCEPTED`，终态按决策时间倒序并继续执行原有 Package 范围授权。
- 已处理列表显示稳定 `Package ID/version`、状态及完整退回原因；终态详情可重新打开，时间线统一投影 `CREATE`、`SUBMIT/RESUBMIT`、`RETURN/ACCEPT`，显示操作者、Asia/Shanghai 时间、请求号、结果和历史原因。
- RETURNED 责任队列明确为工程/项目部修订；未指定处理人和未配置时限分别显示空状态。Product/BOM、Unit Resolution 与四项 Material Snapshot 继续只读，终态没有接收/退回控件。
- 接收与退回在 POST 前增加确认窗口；成功响应只使用服务端返回的操作者、时间、请求号和数据库保存原因生成完成凭证，并提供“查看已处理详情”。没有增加 `system.audit.read`、扩大 planning 权限或处理全局跨角色导航。
- 版本保持 `0.1.0-alpha.37`，Migration 保持 36/head `0036_project_requirement_unit_resolution.sql`；没有 0037、Schema 或历史数据修复提交。

## Unicode 与历史数据结论

- 精确比较结果为“不完全相同”；预期 U+FF1A `：` / U+FF0C `，` 与数据库 ASCII U+003A `:` / U+002C `,` 是仅有的两处原始差异。
- 两侧分别执行标准 Unicode NFKC 后完全相同：原始文本经过全半角规范化，`NFKC` 语义核对 `PASS`。数字、数量、单位、Product/BOM/Unit Resolution/Material 信息、词语、句序和退回目标均未被忽略或改写。
- 数据库实际文本继续作为权威历史值，Package `return_reason` 与唯一 RETURN Event `reason` 逐字一致；历史数据未修改、补写或美化。该标点规范化现象登记为 `LOW` 体验问题，不阻断当前业务链。

## 自动验证

- TypeScript：Planning 与 Project 两组 typecheck 通过；Planning unit `4/4`、UI contract `7/7`。
- 隔离 PostgreSQL：Planning `11/11`；Identity/Project/Master-BOM `10/10 + 5/5 + 6/6`；0036 upgrade `6/6`。覆盖 `PROCESSED` 的 RETURNED/ACCEPTED 排序、Package 范围授权、RETURN 证据、权限、诱饵审计、CSRF、Origin、幂等、并发与回滚。
- 适用静态/安全回归 `65/65`，包含 File Storage、Identity/Project/Master Data、Planning 和 0036 contract；没有降低断言或跳过失败用例。
- 隔离 Chromium `1/1`：390×844 完成合成 v1 退回、确认窗口、服务端完成凭证、已处理重开、CREATE/SUBMIT/RETURN、完整 NFKC 原因、终态只读、v2/ACCEPT 0、退出与匿名 401。测试库和合成数据已清理。
- Production build、`git diff --check` 和断网凭据扫描通过；lint 为 `0 error / 10 existing warnings`。凭据扫描覆盖 1,137 个仓库文件。

## 备份、部署与主 UAT

- 部署前 custom dump：`/var/backups/chenyida-erp/parallel-planning-history-fix12-predeploy-20260802T0220Z.dump`，`root:root 0600`、2,139,142 bytes、SHA-256 `1d5cdd88257f2e53830598a498b609ac7208b792f7fcfdae2f8306b37d36eb5f`。`pg_restore --list` 与第二新空库 36/head 0036、Package/事件/快照核对通过，恢复库已删除；备份保留。
- 仅替换 Web：当前镜像 `sha256:fb88dd8afb8b7f08cf6c8dff9aa66566ad9aec0a203460e7fd09bc32af728edc`，候选 tag `alpha37-planning-history-fix12-candidate`；旧 Web `sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25` 以精确 rollback tag 保留。PostgreSQL、Worker、Caddy 容器 ID 未改变，没有运行 Migration 或重建四个受保护 Volume。
- 主 UAT 仅登录 planning，浏览器网络门禁只允许 login、GET/HEAD/OPTIONS 和 logout；未登录 engineering，未发起接收、退回或其他业务 POST。三个任务 runner 断言偏差均 fail closed 并自动撤销会话，修正后完整旅程通过；最终 planning 活跃 Session 为 0。
- 主 UAT 只读确认 Package ID 1/v1 在“已处理”可见并可重开，状态 `RETURNED`，CREATE/SUBMIT/RETURN 均为 `SUCCESS`；RETURN 操作者 `uat_20260729_planning`、Asia/Shanghai 时间和请求号完整，数据库实际原因完整显示，责任队列为工程/项目部、处理人/时限未配置。
- 最终数据库仍为 v1 1、v2 0、RETURN 1、ACCEPT 0。部署前备份恢复库与主 UAT 后主库的官方受保护摘要均为 `3960cf1f1fc3fdaca0bacd246732d27a0ff223e894953e7be2427fa22b150dca`（217 tables / 201 sequences），证明除允许的 login/logout 身份记录外业务数据未变化；第二恢复库已再次删除。

## 资源、清理与停止边界

- 起点约 2.2 GiB available、217 MiB Swap、20 GiB 根盘可用、Load `0.10/0.14/0.12`；所有重任务串行，`COMPOSE_PARALLEL_LIMIT=1`，一次最多一个临时容器。期间可用内存始终高于 2.1 GiB，Swap 约 217—231 MiB；一次构建后瞬时 1 分钟 Load 4.15，未持续三分钟且未触发停止门禁。
- 最终约 2.1 GiB available、221 MiB Swap、22 GiB 根盘可用、Load `0.08/0.10/0.21`；内核 OOM 0，四服务 restart 0 / OOM false。Web/PostgreSQL healthy，Worker/Caddy running。
- 隔离/恢复数据库、临时 Chromium/Node 容器、任务网络、448 个临时模块文件、2 个模块链接、任务 UAT 脚本和临时指纹文件均已清理。候选/回滚镜像、正式备份和四个受保护 Volume 有意保留；未执行 prune。
- 未 push、PR、amend、rebase、reset、stash 或改写历史；未访问 Sites/D1、Python/SQLite、生产环境或 `shujvbiao/`。完成后停止，不登录 engineering，不创建 v2。

## 结论

`PLANNING DECISION HISTORY FIXED — UAT V1 RETURN VERIFIED`
