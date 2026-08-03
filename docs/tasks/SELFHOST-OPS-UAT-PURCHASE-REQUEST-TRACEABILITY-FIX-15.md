# SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15

## 状态与唯一范围

- 状态：`DONE`
- 开始日期：2026-08-03（Asia/Shanghai）
- 负责人：Codex（严格门禁、权威 DTO、范围授权、确认 UX、隔离测试、备份恢复、Web-only 部署、主 UAT 只读核验、文档与独立提交）；项目负责人（固定主 UAT 保护状态与执行边界）
- 唯一范围：补齐采购需求接收页的 Package ACCEPT、Material Requirement Plan、数量分配快照与 PRQ SUBMIT 谱系，修复矛盾文案，并增加接收/退回确认与前端单请求保护。
- 明确禁止：不得接收或退回主 UAT `PRQ-00000001`，不得创建 RFQ、Quote、Award、PO、Receipt、Ledger、AP 或其他下游单据；不得修改或重放现有 Package、Plan、PRQ、Event、Audit 或业务快照。

## 严格起点

- clean `main@977fa3d942a5af830ec36981a1a3cb3e9adcc8cc`，`origin/main...HEAD` 为 behind 0 / ahead 121。
- 源码版本 `0.1.0-alpha.38`；源码与 PostgreSQL Migration 均为 `0001`—`0037`。
- `0037_project_planning_revision_response_lineage.sql` SHA-256 为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- Web 镜像为 Handoff Confirmation 完成报告记录的 `sha256:a6327f593a6d084c609127e1bdb09e60b2bd07ff6a2c85213b36f1315c622a78`；Web/PostgreSQL healthy，Worker/Caddy running，restart 0、OOM false。
- Canonical purchase 凭据经 root-only 文件、当前账号角色/状态与密码哈希离线比对有效；未输出凭据、摘要、Token、Cookie、Session 或连接串。
- 起点资源约为 available 2.2 GiB、Swap 270 MiB、根盘可用 22 GiB、Load `0.01/0.08/0.11`，未触发停止阈值。

## 主 UAT 保护事实

- 唯一 PRQ 为 ID 1 / `PRQ-00000001` / `SUBMITTED`（页面中文为“待采购接收”），项目 `PRJ-00000001`，需求日期 `2026-10-30`。
- 来源 Plan ID 1/v1 为 `SUBMITTED`；Package ID 2/v2 为 `ACCEPTED`，摘要为 `d67acce3f1e1a049a4025b29adbc3ec1651f398cd43000a445368b04a28bd822`。
- Package ACCEPT Event、Plan GENERATED Event 和 Plan/PRQ SUBMITTED Event 均为现有关系化事实；四条 Material 533—536 的毛需求、提交时库存/在途可用与分配、净采购、PRQ 申请量均已持久化。
- 四行各为 `10 PCS` 毛需求、`0/0 PCS` 库存、`0/0 PCS` 在途、`10 PCS` 净采购和 `10 PCS` PRQ，合计 `40 PCS`。
- 起点全库计数：PRQ 1、Purchase ACCEPT Event 0、RFQ/Quote/Award/PO/Receipt/Ledger/Finance Document 均为 0。

## 权威来源与诚实空状态

- 只复用 `project_planning_packages` 及固定 Snapshot/Event、`planning_material_requirement_plans/lines/allocations/events`、`planning_purchase_requests/lines` 和稳定 Material/Unit 关系。
- Package ACCEPT 与 Plan/PRQ SUBMIT 只读取对象范围 Event 或精确对象范围审计；不得授予 purchase `system.audit.read` 或开放其他 Package 全局审计。
- 当前值必须单独读取当前 Inventory/Inbound 事实，不能覆盖或冒充提交时快照。
- Plan 无说明字段时显示“该版本未采集计划说明”；PRQ 无采购交接说明字段时显示“该版本未采集采购交接说明”。不得伪造说明、请求号或业务版本。
- PRQ 的 `version` 是状态机/CAS 行版本，不是独立业务版本；页面显示“PRQ未单独版本化；固定引用需求计划v1”。

## 实施与验收边界

- 不新增 0038，不修改 0001—0037，不修改 package 版本。
- 服务端详情在单一 repeatable-read read-only 快照内先做权限与对象范围判断，再投影完整来源 DTO、当前供应状态和固定事件。
- purchase 只看待处理队列及本人已处理历史；诱饵/越界 PRQ 详情返回 403。manager/admin 保持既有全能力，不增加其他角色写权限。
- 接收/退回继续复用既有服务端权限、CSRF、Origin、CAS、幂等、事务和状态门禁；确认取消/关闭/ESC 零业务请求，确认立即禁用，双击只发一个请求。
- 隔离 Chromium 必须完成“待接收→打开接收并取消→零写→确认接收→已处理凭证”；主 UAT 只允许打开接收确认并取消。
- 测试、build、备份/恢复和 Web 更新严格串行，`COMPOSE_PARALLEL_LIMIT=1`，一次一个临时重任务容器。

## 允许的最终状态

- `PURCHASE REQUEST TRACEABILITY FIXED — UAT PRQ STILL PENDING`
- `PURCHASE TRACEABILITY FIXED — MAIN UAT NOT VERIFIED`
- `PROCUREMENT TRACEABILITY SCHEMA GAP — UAT PRQ UNCHANGED`
- `BLOCKED — NO UNSAFE CHANGE`

## 实现结果

- 功能提交：`22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`（`fix: expose purchase request traceability`）；完成 runner、部署事实与文档由独立 `ops: accept purchase review traceability fix` 收口。
- `requestDetail` 在单一 repeatable-read/read-only 事务中先读取 PRQ→Plan→Package 头并执行对象范围授权，再读取 Package Item、精确 Package ACCEPT Event、Plan GENERATED/REGENERATED Event、精确绑定该 PRQ 的 SUBMITTED Event 和固定行快照。purchase 可见待接收队列及本人已处理记录；其他 purchase 的已处理诱饵为 403；未增加 `system.audit.read`。
- DTO 显式提供 Package ID/version/status/完整摘要、Product Version/BOM Version/Unit Resolution、Plan 稳定 ID/version/创建计算人/计算时间/提交锁定快照截止时间、PRQ 稳定 ID/来源计划/提交凭证，以及每行稳定 Material/Unit、毛需求、库存可用/分配、在途可用/分配、净采购和 PRQ 申请量。
- 当前库存与在途按当前关系事实重新计算并单独置于 `current_supply`，不覆盖提交快照。Plan/PRQ 无说明字段时分别显示“该版本未采集计划说明”“该版本未采集采购交接说明”；PRQ 明确为未单独业务版本化，只固定引用 Plan v1。
- 非零净采购不再显示“净需求为 0，不生成”；零净采购只显示“提交快照净采购为 0；未生成 PRQ”；关系事实不一致时 fail visible，不用本地过期状态冒充已接收。
- 接收/退回确认沿用服务端 permission、CSRF、Origin、CAS、幂等、事务和状态门禁；取消、关闭、背景与 ESC 不发业务请求，同步 ref 拦截双击，提交中按钮禁用。接收确认显示 Package ACCEPT、Plan、四条 Material/编码/数量、40 PCS、后果、assignee/SLA 空状态和精确下一阶段；退回确认显示必填原因、返回计划部与原快照不变。
- 390×844 使用四条卡片；Material ID、编码、毛需求、净采购与申请量默认可见，详细库存/在途及当前供应可展开；数量和 PCS 不拆分，无页面级横向溢出。

## 自动验证

- Material Requirement 定向 unit/UI、安全、CSRF、Origin、Planning、Inventory、Procurement、Identity 回归最终均通过；记录的分组执行为 `47/47`、PostgreSQL `5/5`、跨域 PostgreSQL `32/32`、跨域 UI `31/31`、最终 material unit/UI `10/10`。
- PostgreSQL 覆盖完整 Package→ACCEPT→Plan→PRQ DTO、稳定 Material/Unit 映射、快照/当前供应分离、精确 SUBMIT Event、诚实空状态、purchase 对象范围 403、零净采购、双击同幂等键单事件、过期 CAS 409 和接收不创建 RFQ/Quote/Award/PO/Receipt/Ledger/AP。
- 最终候选镜像的隔离 Chromium `1/1`：390×844 下待接收→详情→接收取消/关闭/ESC 三路径零写→退回取消零写→接收双击只形成一个事件→已处理记录重开；隔离下游全为 0，临时库/容器/卷已清理。
- Material Requirement typecheck、alpha.38 production build、最终 lint `0 error / 10 warning`、仓库凭据扫描和 `git diff --check` 通过；Python `server.py --self-test`、`smoke_test.py`、任务专属临时 SQLite `go_live_check.py --no-backup` 为 `3/3`，临时 venv/SQLite 已删除。
- 开发期曾分别遇到隔离 fixture 状态序列、响应包装读取、浏览器 fixture 项目编码和 React Compiler memoization 检查问题，均只在隔离环境或提交前检查中暴露并修正；最终上述门禁全部重跑通过，没有降低断言或跳过用例。

## 备份、恢复与 Web-only 部署

- pre-deploy custom dump：`/var/backups/chenyida-erp/purchase-request-traceability-fix15-predeploy-20260803T030456Z.dump`，root:root、0600、2,184,317 bytes，SHA-256 `b1fbf44297b52e151b597d9c9f31a3297e6ee25c73d02ba6e4429a07aba853bb`。
- 宿主未安装 `pg_restore`，首次宿主清单命令在读取正文前退出；随后改用运行 PostgreSQL 容器内同版本工具从标准输入执行，`pg_restore --list` 3,285 项通过。第二新空库恢复为 37/head 0037，0037 checksum、Package/Plan/PRQ/Event、四行数量和 PRQ/Purchase ACCEPT/全部下游计数与主库逐项一致；恢复库已精确删除，正式备份保留。
- 最终候选/运行 Web 为 `sha256:d5c514ab8ef497c702ef5c16c69da4d58c5ce849b96d09fa781fa679963c29dc`（88,463,228 bytes）；旧 Web `sha256:a6327f593a6d084c609127e1bdb09e60b2bd07ff6a2c85213b36f1315c622a78` 保留 `rollback-purchase-traceability-predeploy-20260803T0307Z` 标签。
- 部署使用 `COMPOSE_PARALLEL_LIMIT=1`、`--no-deps --no-build --pull never --force-recreate web`，只重建 Web。PostgreSQL、Worker、Caddy 的容器 ID/启动时间不变，四个受保护 Volume 不变；Web/PostgreSQL healthy、Worker/Caddy running，restart 0、OOM false。
- package 保持 `0.1.0-alpha.38`；未新增 0038，0001—0037 未修改，0037 SHA-256 仍为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。

## 主 UAT 只读验收与保护结果

- Canonical purchase 账号只用于受控浏览器登录；路由层只放行同源 GET/HEAD/OPTIONS 与 login/logout，其他业务 POST 记录后立即阻断。最终 390×844 验收完整显示 Package 2/v2/ACCEPTED/摘要/ACCEPT actor/上海时间/请求号/SUCCESS、Plan ID 1/v1/生成与快照时间、PRQ SUBMIT、四行 533—536 的全部快照/当前分栏和 40 PCS。
- 接收确认显示 `2/v2 · ACCEPT SUCCESS`、Plan v1、四条 Material/编码/10 PCS、合计 40 PCS、后果、无处理人/时限和精确下一阶段；仅点击取消。最终浏览器证据为 login/logout `1/1`、business POST 0、ACCEPT 0、RETURN 0、downstream 0。
- 前两次 runner 在详情断言阶段因同一时间、同一行数在多个合法位置显示而触发 strict locator 二义并安全停止；均未进入确认窗、未发采购业务 POST，`finally` 完成 LOGOUT，业务指纹保持。收窄 locator 后最终完整旅程通过。
- 主 UAT 业务指纹前后均为 `c3c1cfbecee7dcb2199bacc6425dcc02d875cb546049eacc5982ca4a6eb22fca`：`PRQ-00000001` 仍为 `SUBMITTED` / 待采购接收，Plan ID 1/v1 仍 `SUBMITTED`，Package 2/v2 仍 `ACCEPTED`，四行仍各 10 PCS，PRQ 总数 1，Purchase ACCEPT/RETURN 与 RFQ/Quote/Award/PO/Receipt/Ledger/AP 全为 0。
- 本任务最近三条 purchase UAT Session 均为 `REVOKED/LOGOUT`；数据库已有四条更早有效 purchase Session，不属于本次浏览器且未获权撤销，因此保持原状。

## 资源与清理

- 起点约 available 2.2 GiB、Swap 270 MiB、根盘 22 GiB、低 Load；终点 available 2.3 GiB、Swap 289 MiB、根盘 22 GiB、Load `0.15/0.20/0.31`。任务窗口内核 OOM 0，四服务 restart 0/OOM false，未触发停止阈值。
- build、测试、备份恢复、部署均串行，一次只有一个临时重任务容器。任务隔离/恢复数据库、Node/Playwright/Python 容器、临时 Volume、venv 和 SQLite 均精确清理；正式备份、候选/当前/回退 Web 镜像及四个受保护 Volume 有意保留。未执行任何 prune。

## 最终结论

`PURCHASE REQUEST TRACEABILITY FIXED — UAT PRQ STILL PENDING`

本任务立即停止；不接收或退回主 UAT PRQ，不创建 RFQ 或任何下游单据。
