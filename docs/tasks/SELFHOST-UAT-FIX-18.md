# SELFHOST-UAT-FIX-18 — 补齐采购接收历史凭证并澄清 Plan 状态投影

## 状态与唯一范围

- 状态：`DONE`
- 开始日期：2026-08-04（Asia/Shanghai）
- 负责人：Codex（严格门禁、只读保护指纹、权威事件/状态诊断、历史凭证 UI、隔离测试、备份恢复、Web-only 部署、purchase-only 主 UAT 只读验收、文档与独立提交）；项目负责人（固定已接收主 UAT 事实、部署授权与只读验收边界）
- 依赖：`SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15`、`SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16`、`SELFHOST-UAT-FIX-17`
- 唯一范围：只修复已处理 Purchase Request 历史和即时成功凭证展示，补齐当前 PRQ 的不可变 Purchase ACCEPT 决策凭证、真实 ACCEPT/RETURN 计数，并按各自权威字段澄清 Material Requirement Plan 与 PRQ 状态。
- 明确禁止：主 UAT `PRQ-00000001` 已接收，严禁再次接收、退回、编辑、重放或修改历史；不得创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 或其他下游单据；不得修改 Package、Plan、PRQ、Event、Audit、Inventory、Allocation 或业务快照。

## 严格起点门禁

- Branch：`main`。
- 完整 HEAD：`eff3df28e1781f13dc5a529f13e83e621bda5a28`。
- 完整 Parent：`13da8a14d037d279278ef8c8ea86e52d79552512`。
- `origin/main...HEAD`：behind 0 / ahead 127；tracked/untracked 工作区 clean；无 gitlink。
- 源码版本 `0.1.0-alpha.38`；源码与 PostgreSQL Migration 均为 `0001`—`0037`。
- `0037_project_planning_revision_response_lineage.sql` SHA-256：`139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 运行 Web 完整镜像摘要：`sha256:97dcabe8d15c66dc54aec3e6a1f3febf168605b30292fad532177f000e2f18df`。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOM false；PostgreSQL 37/head、活动事务/idle-in-transaction/超过 60 秒事务均为 0。
- 起点资源：available memory 约 2.2 GiB，Swap 309 MiB / 1 GiB，根分区可用 21 GiB，Load `0.15/0.14/0.08`；未发现其他 build/test/migration、临时重型容器或并发执行流。

## 主 UAT 保护边界

- 只读目标：PRQ ID 1 / `PRQ-00000001`，预期 `ACCEPTED` / 采购已接收；待接收/已处理预期 `0/1`。
- 预期 Purchase 决策事实：ACCEPT/RETURN `1/0`；ACCEPT actor `uat_20260729_purchase`，时间 `2026/08/04 06:06:15 Asia/Shanghai`，request_id `80568b28-47f5-4f58-8901-afc053871998`。
- Package ID 2/v2 与 Plan ID 1/v1 引用必须保持；Material 533—536 各 10 PCS，九项当前供应均为 0。
- RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 不得因 Purchase ACCEPT 自动创建；本任务主 UAT 业务 POST 必须为 0。
- 开发、部署、第二新空恢复库与主 UAT 前后均使用同一脱敏、确定性保护清单计算 SHA-256；不得把身份秘密、Token、Cookie、Session、连接串或业务正文写入指纹输入或输出。

## 权威诊断问题

1. Purchase ACCEPT 历史凭证只允许读取当前 PRQ 精确归属的不可变 `PURCHASE_ACCEPTED` / `PURCHASE_RETURNED` 业务事件；action/type、actor、occurred_at、request_id、稳定 PRQ ID 与计数不得由当前登录用户、页面状态、队列数量或普通 Audit 反推。
2. 若事件表没有 result 字段，只有在该不可变事件只能于业务事务成功提交后存在的事实经代码、事务与测试证实时，才把已持久化事件投影为 `SUCCESS`；不得伪造失败事件。
3. Plan 状态必须从 `planning_material_requirement_plans.status` 读取，PRQ 状态必须从 `planning_purchase_requests.status` 读取。若 Plan 的确随 Purchase ACCEPT 从 SUBMITTED 转 ACCEPTED，则按分支 A 明确显示“采购交接状态：ACCEPTED”，并说明 Plan v1 计算快照仍不可变；若数据库 Plan 仍 SUBMITTED，则按分支 B 分别显示 Plan SUBMITTED 与 PRQ ACCEPTED。
4. 若发现错误历史写入且修复需要修改主 UAT 数据，或现有关系模型无法完整追溯并需要 0038，立即停止并提交诊断，不扩展本任务。

## 实现与验收合同

- 已处理历史详情新增独立“采购决策凭证”区块，显示 Purchase Request ID、PRQ、决策/中文、Actor、Asia/Shanghai 时间、可完整读取与复制的请求号、显式 `SUCCESS`、独立 ACCEPT/RETURN 数量。
- Purchase 决策凭证与 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 三段上游凭证分区展示；不得把 Purchase ACCEPT 冒充 Planning ACCEPT。
- 只读取当前 PRQ 的决策事件；关键事件缺失时失败关闭，不使用占位 actor 或空 request_id 冒充完整凭证。
- 已处理页不渲染再次接收、退回或编辑控件；即时成功凭证同样显式显示 `结果：SUCCESS`。
- 刷新、重新登录和 Web 重启后只依赖 PostgreSQL 权威事件恢复凭证；桌面与 390×844 无页面级横向溢出，安全退出后 back/forward/refresh 不恢复受保护内容。
- 不新增 Migration、不修改 `0001`—`0037` 或 alpha.38；预期只替换 Web，PostgreSQL、Worker、Caddy、Origin、端口、凭据与四个受保护 Volume 保持。

## 测试、备份、部署与主 UAT

- unit/UI 覆盖即时/历史 SUCCESS、独立计数、四段凭证分区、Plan/PRQ 独立权威状态、390×844、请求号复制和历史无写控件。
- 隔离 PostgreSQL 覆盖 0/0→1/0、actor/time/request_id 持久化、幂等、并发单胜、诱饵隔离、权限/跨项目 403、零自动下游、Plan 真实状态机和历史查询零写。
- 隔离 Chromium 覆盖接收后历史重开、刷新/Web 重启持久、桌面/390×844和退出历史保护；全部写旅程只在隔离数据库进行。
- 适用回归、typecheck、Schema consistency、lint、production build、credentials scan、`git diff --check` 与 Python 三项基线严格串行执行。
- 部署前创建 root:root 0600 PostgreSQL custom dump，记录大小/SHA-256，`pg_restore --list` 及第二新空库恢复核对通过后，只替换 Web，不运行 Migration。
- 主 UAT 只使用 `uat_20260729_purchase` 登录、打开已处理 `PRQ-00000001`、执行桌面/390×844只读核验并安全退出；禁止访问其他记录或角色，业务 POST 必须为 0，验收前后保护指纹必须相同。

## 允许的最终状态

- `PURCHASE ACCEPTANCE HISTORY FIXED — UAT ACCEPTANCE VERIFIED`
- `PURCHASE ACCEPTANCE HISTORY FIXED — MAIN UAT NOT VERIFIED`
- `BLOCKED — NO UNSAFE CHANGE`

## 完成结果

- 最终状态：`PURCHASE ACCEPTANCE HISTORY FIXED — UAT ACCEPTANCE VERIFIED`。
- Plan 状态属于分支 A；Purchase ACCEPT 权威来源、SUCCESS 投影语义、测试、备份恢复、Web-only 部署、主 UAT 前后保护指纹和资源清理详见 `docs/tasks/SELFHOST-UAT-FIX-18-COMPLETION.md`。
- 完成后停止；未创建 RFQ、未登录其他角色、未执行任何主 UAT 业务 POST。
