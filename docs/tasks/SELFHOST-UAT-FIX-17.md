# SELFHOST-UAT-FIX-17 — 补齐采购接收确认窗口的完整追溯、决策计数与九项供应明细

## 状态与唯一范围

- 状态：`DOING`
- 开始日期：2026-08-03（Asia/Shanghai）
- 负责人：Codex（严格门禁、权威事件与供应诊断、服务端读取合同、确认窗口、隔离测试、备份恢复、Web-only 部署、purchase-only 主 UAT 只读验收、文档与独立提交）；项目负责人（固定主 UAT 保护事实、执行边界和最终状态）
- 依赖：`SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15`、`SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16`
- 唯一范围：只修复采购接收确认窗口的可核验性，补齐当前 PRQ 精确归属的 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 完整凭证，真实不可变 Purchase ACCEPT/RETURN 决策计数，以及每个 Material 的九项当前供应。
- 明确禁止：不得接收或退回主 UAT `PRQ-00000001`，不得开始询价，不得创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 或其他下游单据；不得修改或重放现有 Package、Plan、PRQ、Event、Audit、Inventory、Allocation 或业务快照。

## 严格起点门禁

- Branch：`main`。
- 完整 HEAD：`af7496babe8b704d04b22ad33bbb98a270519529`。
- 完整 Parent：`ce3f14a0c989875e7527e42136967f9efe6ee548`。
- `origin/main...HEAD`：behind 0 / ahead 125；tracked/untracked 工作区 clean；无 gitlink。
- 源码版本 `0.1.0-alpha.38`；源码与 PostgreSQL Migration 均为 `0001`—`0037`。
- `0037_project_planning_revision_response_lineage.sql` SHA-256：`139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 运行 Web 完整镜像摘要：`sha256:d7ced686803c1f5f71ec101ebe28e3080005d534480dd39bfc8a91913ef12a5d`；Worker 完整镜像摘要：`sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOM false；PostgreSQL 37/head、无其他 active/idle-in-transaction/超过 60 秒事务。
- 起点资源：available memory 约 2.1 GiB，Swap 302 MiB / 1 GiB，根分区可用 21 GiB，Load `0.18/0.48/0.42`；未发现其他 build/test/migration、重型容器或数据库异常。

## 权威诊断与实现边界

1. Package ACCEPT、Plan GENERATE 和 PRQ SUBMIT 必须从当前 Package、Plan、PRQ 精确归属的不可变业务 Event 读取 actor、occurred_at、request_id 和 SUCCESS result；Audit 只可作为现有关系化事件已明确绑定的补充，不得从不相关记录拼接。
2. `decision_counts.accept_count` 与 `decision_counts.return_count` 必须分别统计当前 PRQ 的真实不可变 Purchase ACCEPT/RETURN Event，不得由状态、待办或历史队列数量推断。
3. 当前供应复用 D-089 与 FIX-16 的 Inventory、Planning Allocation 和有效在途只读投影；每次打开确认窗口前重新查询，并返回 `current_supply_observed_at`。
4. 每个 Material 必须结构化返回并展示：在手、正式预留、品质冻结、库存可用、计划库存分配、未分配库存、有效在途、计划在途分配、未分配在途。
5. 详情/预览继续在服务端执行认证、purchase capability、PRQ 对象范围和项目数据域校验；任何关键事件、计数或供应字段缺失时 fail closed，确认按钮不可用。
6. 读取不得写业务、Audit、Idempotency、Inventory 或 Allocation；接收 POST 的既有 Origin、Cookie/Header CSRF、CAS、持久幂等、单事务和重复提交保护不放宽。
7. 预计不新增 Schema/Migration；若 0037 无法准确表达任一权威事实，立即以 Schema 缺口停止，不创建 0038。

## UI 与验收边界

- 确认窗口必须完整显示 PRQ/Project/需求日期/状态、Package 2/v2 摘要与 ACCEPT 凭证、Plan 1/v1 生成及快照时间与 GENERATE 凭证、PRQ SUBMIT 凭证、显式 ACCEPT/RETURN 计数、四个 Material 的提交快照和九项当前供应。
- 打开时显示“正在重新读取当前供应”，完成后显示明确查询时间；只有全部关键字段完整时确认按钮启用。
- 默认焦点安全；取消、关闭、背景和 ESC 零业务写请求；确认点击同步禁用并保持既有单请求保护。
- 桌面和 390×844 无页面级横向溢出；移动端每个 Material 保持标签与数量可对应。
- 接收后果必须明确仅新增一条不可变 Purchase ACCEPT，不改 Package/Plan/PRQ 明细、Inventory、Reservation 或 Allocation，不自动创建任何下游单据；无 assignee/SLA 时如实显示。

## 测试、部署与主 UAT

- 自动测试严格串行覆盖 unit/UI、隔离 PostgreSQL、Chromium、Purchase Request、Material Requirement、Planning Package、Inventory、Procurement、Identity/CSRF/Origin、typecheck、Schema consistency、lint、production build、credentials scan、`git diff --check` 和 Python 三项基线。
- 隔离 PostgreSQL 必须包含非零供应公式、事件诱饵隔离、读取零写、权限/跨项目 403、刷新后新值、单 ACCEPT、幂等重放/异正文/CAS/并发/故障回滚和零下游。
- 部署前创建 root:root 0600 custom dump，完成 `pg_restore --list` 与第二新空库恢复核对；只替换 Web，不运行 Migration，不重建 PostgreSQL/Worker/Caddy，不改变公网 Origin、端口、凭据或受保护 Volume。
- 主 UAT 只允许 `uat_20260729_purchase` 登录、打开 `PRQ-00000001`、核对完整凭证/计数/九项供应/查询时间、取消、安全退出和 Session 失效；业务 POST 必须为 0。

## 允许的最终状态

- `PURCHASE DECISION CONFIRMATION FIXED — UAT PRQ STILL PENDING`
- `PURCHASE DECISION CONFIRMATION FIXED — MAIN UAT NOT VERIFIED`
- `BLOCKED — NO UNSAFE CHANGE`

