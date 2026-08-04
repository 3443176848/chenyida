# SELFHOST-UAT-FIX-19 — 修复 RFQ 草稿的 Purchase Request 稳定 ID 绑定

## 状态与唯一范围

- 状态：`DOING`
- 开始时间：2026-08-04 11:38 CST（Asia/Shanghai）
- 负责人：Codex（严格门禁、隔离复现、稳定 ID/DTO/幂等修复、串行测试、备份恢复、Web-only 部署与 purchase-only 主 UAT 只读验收）；项目负责人（固定主 UAT 保护事实、部署授权和零下游边界）
- 依赖：`SELFHOST-PHASE4-TASK04`、`SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15`、`SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16`、`SELFHOST-UAT-FIX-17`、`SELFHOST-UAT-FIX-18`
- 唯一范围：只修复合法 Purchase Request 稳定数据库 ID `1` 在建立 RFQ 草稿请求边界被错误拒绝的问题；保持 RFQ、报价、定标和所有下游业务规则不变。
- 明确禁止：不得在主 UAT 创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 或任何其他下游记录；不得修改现有 PRQ、Supplier、失败请求证据、Migration、Origin、端口、凭据或受保护 Volume。

## 已核验严格起点

- Branch：`main`。
- HEAD：`5a7cb547a07b1e113d89c51366fc099d851fe1cb`。
- Parent：`9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`。
- `origin/main...HEAD`：behind 0 / ahead 129；tracked/untracked 工作区 clean；无 gitlink或嵌套仓库。
- 源码版本：`0.1.0-alpha.38`。
- 源码与 PostgreSQL Migration：`0001`—`0037`；PostgreSQL 37/head。
- `0037_project_planning_revision_response_lineage.sql` SHA-256：`139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 运行 Web：`sha256:6eeba6409f51605fe422c39d674ddfa03d5f5079bb546566288336f15296df64`。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOM false。
- 起点资源：available memory 约 2.2 GiB，Swap 258 MiB / 1 GiB，根分区可用 21 GiB，Load `0.42/0.35/0.31`；没有并发 build/test/migration 或异常数据库事务。

## 主 UAT 保护合同

- 只读目标为 Purchase Request ID 1 / `PRQ-00000001` / 项目 `PRJ-00000001` / `ACCEPTED`，Purchase ACCEPT/RETURN `1/0`；Material 533—536 各 10 PCS。
- 只读目标 Supplier 为 ID 1 / `SUP-000001` / `UAT快速交付供应商A-042576` 与 ID 2 / `SUP-000002` / `UAT低价延期供应商B-042576`，两者均须为本轮 UAT ACTIVE 记录。
- 起点及终点 RFQ/Quote/Award 必须为 `0/0/0`，PO、Delivery Plan、Receipt、Ledger、AP、Work Order 必须为 0。
- 失败证据 request_id `e2d8caab-a39d-4756-894b-329ae548e3f5` 与中文提示 `purchase_request_id 必须是正整数` 只读保留，不删除、不改写。
- 主 UAT 只允许 purchase 登录、打开采购寻源页、选择但不提交目标 PRQ 与两个 Supplier、核对四行/40 PCS/可提交状态、清空或离开未保存表单并安全退出；业务 POST 必须为 0。

## 实现合同

- RFQ 选项唯一 value 为稳定 Purchase Request 数据库 ID；编号、项目名只用于显示。Supplier 选项同样只以稳定 Supplier ID 提交。
- UI 请求边界只执行一次明确的十进制正整数规范化；DTO 字段在 UI、Handler、Service 与测试中统一。
- Handler/Service 继续拒绝空值、0、负数、小数、NaN、非十进制文本、布尔值、数组和对象；不从 PRQ 编号、项目名、供应商编号、名称或显示标签反向解析 ID。
- Supplier ID 去重并精确绑定选择；幂等摘要只使用规范化后的 Purchase Request ID、Supplier IDs 和其余规范业务字段。
- 服务端继续验证 PRQ 存在且 ACCEPTED、actor 权限和对象范围、Supplier 存在且 ACTIVE、四条来源保持及同 PRQ 活动 RFQ Round 唯一；业务、邀请、行、Event、Audit、Idempotency 同事务提交或整体回滚。
- 预计不新增 Migration；如确认需要 0038，立即停止并提交诊断。

## 测试、部署与完成边界

- 单元/UI、隔离 PostgreSQL、隔离 Chromium和 Purchase Request/Procurement Sourcing/Supplier/Inventory/Identity/CSRF/Origin/CAS/Idempotency 回归全部串行执行；包含 390×844、错误中文和 request_id。
- build、全量测试、备份恢复和 Web 更新固定 `COMPOSE_PARALLEL_LIMIT=1`，每项重任务前后记录资源与服务状态。
- 部署前创建 root:root 0600 custom dump，完成 SHA、`pg_restore --list`、第二新空库恢复和主保护指纹核对；只替换 Web，不运行 Migration，不重建 PostgreSQL/Worker/Caddy。
- 完成后更新项目文档并创建聚焦功能提交与独立运维/验收提交；不 push、不建 PR、不 amend/rebase/reset/stash/restore。

## 允许的最终状态

- `RFQ PURCHASE REQUEST ID BINDING FIXED — UAT RFQ NOT CREATED`
- `RFQ PURCHASE REQUEST ID BINDING FIXED — MAIN UAT NOT VERIFIED`
- `BLOCKED — NO UNSAFE CHANGE`
