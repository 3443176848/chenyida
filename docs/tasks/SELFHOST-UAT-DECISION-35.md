# SELFHOST-UAT-DECISION-35 Controlled Retention Decision for Unauthorized UAT PO

## 结论

`CONTROLLED UAT PO RETENTION DECISION RECORDED`

D-105 `Controlled retention of unauthorized UAT PO-00000001`已正式记录。该决定将现有对象置于受控保留状态，是只向未来生效的控制事件；它提供前向授权并明确“不追溯性授权”，不改变原始PO写入无法证明事前授权的结论。

## 任务范围

- 任务编号：`SELFHOST-UAT-DECISION-35`
- 日期：2026-08-08（Asia/Shanghai）
- 仓库：`/opt/erp`
- 授权范围：只修改项目文档并创建一个聚焦提交。
- 禁止范围：PostgreSQL连接或写入、UAT登录、Identity或业务API、PO/Award/Plan/queue/Event及任何下游修改、凭据、Migration、build、部署、服务重启、备份/镜像/Volume删除。

## 起点门禁

| 门禁 | 结果 |
| --- | --- |
| Branch / HEAD | `main@e67c9209bc24314000f70760b7b79282c4a9b469` |
| 起点HEAD Parent | `9a8a3bd8a84bacb2836ac116d3b8a80783e96fe6` |
| 同步 | `behind 0 / ahead 172` |
| 工作区 | tracked/untracked clean |
| Worktree | 仅`/opt/erp`一个worktree；无嵌套Git仓库 |
| 并发 | 无并发UAT、PO、仓库或IQC任务；仅既有常驻服务 |
| 必读材料 | 完整阅读`AGENTS.md`、MASTER、TASKS、PROJECT_CONTEXT、DECISIONS、`SELFHOST-UAT-AUDIT-34`及Award→PO/FIX-23/FIX-25/FIX-32/FIX-33相关完成报告 |

门禁与用户给定起点完全匹配；没有执行reset、stash、restore或覆盖。

## 权威事实基线

本任务不连接PostgreSQL。下列事实全部沿用并引用[SELFHOST-UAT-AUDIT-34](SELFHOST-UAT-AUDIT-34.md)的限定只读取证结果：

| 事实 | 值 |
| --- | --- |
| PO | `ID 1 / PO-00000001` |
| 创建请求 | `773c23b6-0923-4ab5-a451-bb80aa4bdf9d` |
| actor | `uat_20260729_purchase` |
| 创建时间 | `2026-08-08 14:11:45.086372 Asia/Shanghai` |
| 结构 | `PO / PO Line / Delivery Plan / queue = 1 / 4 / 4 / 4` |
| Award | `ID 1 / v1 / AWARDED` |
| Supplier | `ID 1 / SUP-000001` |
| 金额 | `480.00 CNY` |
| 下游 | Receipt、Ledger、IQC、AP、付款和生产记录均为0 |

该对象的数据结构完整但来源授权不可证明。关系化谱系与Event/Audit/Idempotency闭合只能证明写入发生、结构和来源业务对象一致，不能证明它属于仓库内事前授权的任务执行流。

## D-105 控制决定

1. 原始PO写入无法绑定到仓库内事前授权的任务执行流。
2. 不把该写入追溯描述为具有事前授权。
3. 分类继续为“未经事前授权但结构完整的UAT写入”。
4. 原样保留PO、四条PO Line、四条Delivery Plan、四条queue以及Event/Audit/Idempotency证据。
5. 不删除、不修改、不取消、不重建、不重试或重复执行Award→PO转换。
6. 从本书面决定正式提交后，允许把现有`PO-00000001`作为后续UAT的固定起点。
7. 本决定只授权后续只读PO追溯验收。
8. 本决定不自动授权到货、收货、IQC、入库、库存、AP、付款或生产操作。
9. 每个后续写阶段仍需独立明确授权。
10. 在进入仓库或IQC前，必须先补齐并验收PO历史页面的完整谱系和凭证。

授权属性固定为受控保留、前向授权和“不追溯性授权”。这次书面决定是控制事件，不改变原始写入分类，也不扩大到任何履约、品质、财务或生产写阶段。

## 项目文档更新

- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/project/DECISIONS.md`
- `docs/project/CHANGELOG.md`
- `docs/project/STATUS.md`
- `docs/tasks/SELFHOST-UAT-DECISION-35.md`

`TASKS.md`已明确Award→PO转换不再重试、`PO-00000001`作为固定UAT起点、下一任务为PO历史追溯页面修复/验收、warehouse/quality/finance试用仍未授权，以及Receipt/IQC/Ledger/AP/生产记录必须保持0。

## 非数据库验证

全部验证串行执行：

| 验证 | 结果 | 隔离边界 |
| --- | --- | --- |
| 文档链接/引用检查 | PASS / 7 FILES / 38 REFERENCES | 检查本任务七份Markdown的全部本地目标和Markdown heading，其中包含D-105/AUDIT34引用 |
| `git diff --check` | PASS | 仅工作区文本差异 |
| 凭据扫描 | PASS / 1,280 FILES | 直接运行同一`check-credentials.mjs`，只读扫描tracked/untracked仓库文件 |
| Python `server.py --self-test` | PASS / `SELF_TEST_OK` | 脚本自带临时SQLite |
| Python `smoke_test.py` | PASS / `SMOKE_TEST_OK` | 脚本自带临时目录、SQLite和本地动态服务 |
| Python `go_live_check.py --no-backup` | PASS / `GO_LIVE_CHECK_OK` | 显式`ERP_ENV=test`、任务专用`/tmp/chenyida-erp-test-retention-*` SQLite和未监听端口；目录退出时精确删除 |
| 轻量`npm test` | PASS / 3/3 | 宿主npm不存在时命令在启动测试前返回127；随后用本机已有`node:22-bookworm-slim`断网、只读挂载、1 CPU/1 GiB、自动删除单容器复验通过 |

未运行PostgreSQL集成测试、Migration、生产build、Docker build、部署或服务重启；没有登录UAT或调用Identity/业务API。

## 资源与清理

- 任务起点：available memory约1.9 GiB，Swap 238 MiB/1.0 GiB，根分区可用18 GiB，Load`0.15/0.14/0.10`。
- 验证前：available memory约1.8 GiB，Swap 238 MiB/1.0 GiB，根分区可用18 GiB，Load`0.25/0.21/0.13`。
- 四个既有服务验证前restart均为0、OOM false；Web/PostgreSQL healthy，Worker/Caddy running。内核本次启动期OOM事件计数为0。
- 根目录首次`docker compose ps`因没有Compose配置只读退出；随后在`chenyida_erp_site`使用显式parallel project/env/file复核通过，未读取env正文、未改变容器。
- self-test/smoke临时目录由脚本自动清理；go-live任务专用SQLite目录由受控trap精确删除；npm复验容器使用`--rm`自动删除。没有创建PostgreSQL测试库、网络、Volume、镜像或备份，没有prune，四个受保护Volume保持。
- 验证后/提交前：available memory约1.9 GiB，Swap 238 MiB/1.0 GiB，根分区可用18 GiB，Load`0.01/0.10/0.10`；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart 0/OOM false，内核OOM事件0。
- 最终清理：任务临时目录、容器、网络和Volume均为0；四个受保护Volume `erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status`均保留。没有删除备份、镜像或Volume。

## Git收口

- 提交消息：`docs: retain unauthorized UAT purchase order under control`
- 本提交Parent：`e67c9209bc24314000f70760b7b79282c4a9b469`
- 本提交SHA：以`git log -1`为准；提交内容不能稳定自写自身SHA。
- 预期提交后：`main`相对`origin/main`为behind0/ahead173，tracked/untracked clean。
- 不push、不建PR、不amend、不rebase、不改写历史。

## 下一任务

下一任务只能是PO历史追溯页面修复/验收，并且UAT阶段只能执行只读PO追溯验收；不是仓库收货或IQC任务。warehouse、quality及finance试用和任何Receipt/IQC/Ledger/AP/生产写入仍须新的独立明确授权。
