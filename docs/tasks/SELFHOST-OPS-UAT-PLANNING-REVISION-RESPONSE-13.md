# SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13

## 状态

- 状态：`DONE`
- 开始日期：2026-08-02（Asia/Shanghai）
- 完成日期：2026-08-02（Asia/Shanghai）
- 严格起点：`main@174181991c0bf51ee397627ea8fce546d1b64e68`，Parent `180f6b58b583bd2dba350f017504be916db9673d`，behind 0 / ahead 117，工作区 clean。
- 起点运行面：`0.1.0-alpha.37`、36/head `0036_project_requirement_unit_resolution.sql`；Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 授权：项目负责人明确授权唯一新增 0037、版本升级 alpha.38、隔离迁移/恢复/Chromium、并行非生产 UAT 串行升级与 Web 部署，以及部署后 engineering-only 只读核验。
- 主 UAT 禁止事项：不填写工程回复、不生成 v2、不提交 v2、不登录 planning。

## 唯一目标

在 Planning RETURN 后增加关系化、版本化、可 CAS 的 Engineering Revision Response，并让后继 Package 固定形成 `v1 → Planning RETURN → Engineering Response → v2` 完整谱系。v2 必须复制 v1 的 Product/BOM/Unit Resolution/Material/Document 快照并把精确 Response Version 与正文摘要纳入 Package 摘要；v1、RETURN Event 和原因永久不改写。

## Schema 核验与决定

- 0036 只有 Product/BOM Resolution、Unit Resolution Version/Head、Package Snapshot 和 Event，没有保存工程回复、按 RETURN 独立 CAS Head、Response 固定消费或 Package 后继谱系字段，不能满足刷新恢复、并发单胜、摘要绑定和 SQL 不可变性。
- 因此按授权唯一新增 `0037_project_planning_revision_response_lineage.sql`，不修改或重排 0001—0036；包版本升级为 `0.1.0-alpha.38`。
- 新增 append-only `project_planning_revision_response_versions`，关系化保存 source Package、RETURN Event、Project、Response Version、NFC/LF 正文、SHA-256、supersedes、actor、时间和 request_id。
- 新增 `project_planning_revision_response_heads`，每个 RETURN Event 一个 Head，以独立 expected head version 作 CAS；不复用 Project 或 Package version。
- Package 新增 `previous_package_id`、`responds_to_return_event_id`、`revision_response_version_id`，以复合 FK 证明同 Project、源 Package、RETURN Event 与 Response Version 精确一致。
- 既有 RETURNED v1 保持无回复原样；Migration 不伪造历史 Engineering Response，不回填 Package 谱系。

## 服务与不可变边界

- 回复正文先做 CRLF/CR→LF、Unicode NFC 与首尾 trim，长度 10—2000 Unicode code point；保留中文全角标点并拒绝非法控制字符。
- 保存回复验证 RETURNED、唯一且归属正确的 RETURN Event、engineering owner/manager/admin、责任队列、CSRF、Origin、权限、幂等、限流和 expected Head；Response Version、Head、Audit、Idempotency 同事务提交。
- 生成后继验证源 v1 仍 RETURNED、Package CAS、当前精确 Response/Head、无既有后继、Product/BOM ACTIVE+RELEASED、Unit Resolution/Unit 有效；v2 DRAFT、CREATE Event、全部固定快照、Audit、Idempotency 同事务提交。
- 同 RETURN 最多一个直接后继；同项目 Response Version 最多消费一次。唯一索引、行锁、CAS 与关系 FK 共同保证并发保存/生成单胜。
- Response Version、Package、Package Item、BOM Snapshot、Document Link 与 Event 由数据库 trigger 禁止 UPDATE/DELETE 或绕过服务写入；Head 只允许逐一推进。后续 Head 变化不影响 v2 已固定的 Response Version。
- Package 摘要覆盖 previous Package、RETURN Event、Response Version、正文摘要、Product/BOM/Unit Resolution、需求数量、四条物料快照和文档快照。审计只记录对象、谱系 ID、版本和摘要，不记录完整回复正文。

## UI

- RETURNED v1 详情显示完整 RETURN 原因/Event、工程回复输入框、Response Version/actor/时间/request_id、固定复用 Product/BOM/Unit Resolution 与物料快照。
- 回复未保存、输入有未保存变化或已存在后继时禁用“生成 v2”；确认窗口显示源 Package、RETURN Event、完整回复、固定版本/物料和生成 DRAFT/CREATE/谱系的后果。
- 仅回复修订模式不渲染 Product/BOM 或 Unit 选择器，源解析和快照全部只读；未来改变解析必须另立明确流程。
- v2 详情显示 `v1 → Planning RETURN → Engineering Response → v2`，并始终展示生成时固定的 Response Version；390×844 响应式旅程通过。

## 已完成自动验证

- 定向与安全静态回归 `49/49`，包含 Planning unit/UI、CSRF、Origin、Identity、Project、BOM/Master Data、Unit Resolution contract 和 `npm test` 基线。
- 隔离 PostgreSQL Planning `12/12`，覆盖状态/权限、文本规范、刷新持久、追加 Version/Head CAS、幂等重放与异正文冲突、并发保存/生成、RETURN 归属、唯一后继、故障零半记录、SQL guard、固定 Response/快照和后续 Head 不漂移。
- Migration `4/4`：空库 0001→0037、0036→0037、重复执行、已有 RETURNED 无回复保持、约束/guard、失败回滚、journal/schema/snapshot 一致和 0001—0036 checksum 不变。
- 隔离 Chromium `1/1`：390×844 完成合成 v1 提交→planning 退回→engineering 保存/刷新→生成/提交 v2→planning 查看谱系/回复/四项物料→接收→退出；全部发生在隔离库。
- Planning typecheck、production build、lint 0 error 与 `git diff --check` 通过。最终部署 Web 镜像为 `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25`；Worker 不依赖本次变更。

## 备份、恢复与部署结果

- 功能提交：`58e011db0c8d9045c3919c36c2c64f1655f050b6`（`feat: add planning revision response lineage`）。
- 0037 SHA-256：`139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`；运行库为 37/head `0037_project_planning_revision_response_lineage.sql`，0001—0036 已执行 checksum 均未改变。
- 正式 pre-deploy custom dump：`/var/backups/chenyida-erp/parallel-planning-revision-response13-predeploy-20260802T124812Z.dump`，root:root 0600、2,140,261 bytes、SHA-256 `653b239b65f31a89b0a29281f8f68c1c0ab26d43df4cd936bb544b0d69bbad69`；`pg_restore --list` 通过。
- 第二新空库恢复为 36/head 0036，0036 checksum 与受保护指纹通过后已删除。另一恢复副本从 0036 升级 0037 时 Response/Head/v2 保持 0、保护指纹不变；同一副本随后 390×844 完整旅程再次 `1/1` 通过并已删除。
- 并行非生产 UAT 串行应用 0037；只把 Web 从 `sha256:fb88dd8afb8b7f08cf6c8dff9aa66566ad9aec0a203460e7fd09bc32af728edc` 替换为 `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25`。旧 Web 有精确 rollback tag；Worker 保持 `sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`，PostgreSQL/Worker/Caddy 容器及四个受保护 Volume 未重建。

## 主 UAT 只读结果

- 跨 Migration 业务保护指纹在部署前、0037 后和 engineering 只读 UAT 后均为 `a25be9c924bb2e7af54acd36c1c5f758e0caf0b2f4d8ccf426bf428aee41d739`；严格起点的完整任务指纹 `0dfc969bf0785326091e649c6af5fd8f52023d0caf43cc0ebf60b90e9db243c8` 对应事实未变化。
- 最终 Package v1/RETURN/Response/v2 为 `1/1/0/0`；CREATE/SUBMIT/RETURN/ACCEPT 为 `1/1/1/0`。v1 仍 `RETURNED`/row version 3/原摘要，RETURN Event actor/time/request/reason 未改；Product/BOM/Unit Resolution 仍 7/7/1，Material 533—536 各 10 PCS。
- 主 UAT Chromium 只使用 engineering：390px 下完整 RETURN、空工程回复输入框、禁用生成 v2、只读 A0/V1/Unit Resolution v1 和四条 10 PCS 可见，Product/BOM/Unit selector 为 0。网络门禁记录 login/logout `1/1`、业务 POST 0、Response write 0、successor write 0、planning login 0；最终 engineering 有效 Session 0。
- 公开根页/health 为 200，匿名 Planning 为 401；Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。

## 资源与清理

- 全部 build、Migration、备份恢复、测试和 Web 更新串行，`COMPOSE_PARALLEL_LIMIT=1`，一次一个临时容器；起点约 2.1 GiB available/227 MiB Swap/22 GiB 根盘/低 Load，最终 2.1 GiB/240 MiB/22 GiB/Load `0.04/0.16/0.27`，内核 OOM 0、四服务 restart 0/OOM false，未触发停止阈值。
- 三个隔离数据库、第二恢复库、临时容器、三个候选 app 提取目录、Playwright 模块目录和 Python 临时库均精确清理；最终任务命名临时数据库/容器/目录均为 0。正式备份、当前/候选 Web、精确 rollback 镜像和四卷有意保留；未 prune。

## 结论

`PLANNING REVISION RESPONSE DEPLOYED — UAT V1 UNCHANGED`
