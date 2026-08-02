# SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13

## 状态

- 状态：`IMPLEMENTED / DEPLOYMENT PENDING`
- 开始日期：2026-08-02（Asia/Shanghai）
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
- Planning typecheck、production build、lint 0 error 与 `git diff --check` 通过。候选 Web 镜像为 `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25`；Worker 不依赖本次变更。

## 部署前剩余门禁

- 再次核对主 UAT 业务指纹与起点完全一致。
- 创建 root:root 0600 PostgreSQL custom dump，记录 SHA-256，完成 `pg_restore --list`、第二新空库恢复、真实 0036 备份隔离升级 0037 与完整隔离旅程。
- 串行应用 0037并只替换 Web；PostgreSQL、Worker、Caddy 和四个受保护 Volume 不重建。
- 部署后仅以 engineering 只读确认 v1 RETURNED、RETURN 1、Response 0、v2 0、回复输入存在及解析选择器不存在，然后安全退出；不登录 planning。

## 当前结论

`REVISION RESPONSE IMPLEMENTED — DEPLOYMENT NOT YET PERFORMED`
