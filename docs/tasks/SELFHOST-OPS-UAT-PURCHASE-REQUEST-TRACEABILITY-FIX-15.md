# SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15

## 状态与唯一范围

- 状态：`DOING`
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
