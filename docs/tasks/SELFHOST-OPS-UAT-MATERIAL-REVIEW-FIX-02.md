# SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02 — operations 人工物料审核队列修复

状态：`DONE — UAT APPROVAL NOT EXECUTED`

日期：2026-07-30（Asia/Shanghai）

## 目标与授权

在不审批、退回或修改现有 UAT 物料的前提下，为 `operations` 增加人工物料审核所需的精确能力，使队列数量、筛选、列表、详情和动作入口统一使用 `material_master.material_status='PENDING_REVIEW'` 及同一服务端权限边界。

严格起点为根仓库 `main` / `78701d16dcea6b4ae5a2ff73d138c8ec838c8498`，Parent `0959b6374ef83ab9decae403624891ac3516cc99`，`origin/main...HEAD=0/92`。源码保持 `0.1.0-alpha.35` / `0035`；常驻运行面保持 `0.1.0-alpha.34` / `0034`。

## 权限差异

只给 `operations` 增加：

- `material.review.queue`
- `material.review.approve`
- `material.review.reject`

不得增加 `material.draft.edit_any`、用户/角色/admin 管理、`system.audit.read`、工程物料正文代编辑能力，或 BOM、采购、库存、生产、销售、品质、财务写权限。`engineering` 继续只能查看自己的待审记录，且创建人/最后修改人不得批准或退回；其他无关角色继续由服务端返回稳定 403 和中文提示。

## 业务与 UI 边界

- 审核队列、数量、筛选、列表与详情统一使用 `PENDING_REVIEW` 和 `material.review.queue`。
- 批准/退回继续复用现有权限、职责分离、幂等、`expected_version`/CAS、事务、正式编码和审计边界。
- 审核工作台只读展示物料正文；`operations` 不获得编辑入口或编辑 API 能力。
- legacy“清洗审核”明确标记为退役导入清洗入口，并引导至原生“物料 / 导入 / 审核”；不得恢复旧清洗队列。
- Dashboard 待处理数字必须明确为全局 `DRAFT + PENDING_REVIEW` 汇总，或调整为当前角色可处理队列；不得与明细 0 条互相矛盾。

## 受保护 UAT 记录

以下主库记录只允许只读核对：

| ID | 名称 |
| ---: | --- |
| 533 | `UAT-BB-MAT-PCBA-042576` |
| 534 | `UAT-BB-MAT-SENSOR-042576` |
| 535 | `UAT-BB-MAT-HARNESS-042576` |
| 536 | `UAT-BB-MAT-CASE-042576` |

四条必须始终保持 `PENDING_REVIEW`、版本 `V2`、来源 `MANUAL`、单位 `PCS`、无正式内部编码。浏览器验收不得点击批准或退回。

## 实施与测试边界

- 原则上不新增 Migration，不修改 `0001`—`0035`，保持 0035 SHA-256 `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- 所有写测试使用独立 PostgreSQL 和合成记录；不得连接主库执行测试写入。
- 专项覆盖精确权限差异、跨创建人队列/详情、自审拒绝、无关角色 403、无正文编辑、编码、退回原因、幂等冲突、CAS、并发、故障回滚、审计和 UI/legacy/Dashboard 一致性。
- 串行执行 Identity、Material、Import、Normalization、Review、BOM Governance、Dashboard 回归，以及 typecheck、Schema consistency、lint、build、credentials、`git diff --check` 和 Python 三项基线。
- 固定 `COMPOSE_PARALLEL_LIMIT=1`；每项重任务前后执行资源、容器、RestartCount/OOM 门禁，一次只运行一个临时容器。

## 运行面部署门禁

部署前生成 PostgreSQL custom dump，验证 `pg_restore --list` 并恢复到独立临时库；确认主库仍为 34/0034、四个受保护卷 metadata 不变。运行镜像只能从当前 alpha.34 兼容 Web 基线构建，叠加本任务最小修复和运行面已存在的 Origin/CSRF/logout hotfix；不得把 alpha.35/0035 整体部署到 0034 数据库，不运行 Migration，不重建或重启 PostgreSQL，原则上不重启 Worker/Caddy。

部署后只用 `uat_20260729_operations` 登录回环 `http://127.0.0.1:3000`，完成指定只读浏览器验收并安全退出，确认旧 Session 失效。不得登录其他角色，不创建产品/BOM，不 push 或创建 PR。

## 完成标准

- 自动测试、alpha.34/0034 兼容 smoke、备份恢复、部署健康和浏览器只读验收全部通过。
- 533—536 全部可见且详情可打开，批准/退回按钮存在、正文不可编辑。
- 533—536 状态、版本、来源、单位和空正式编码前后完全不变。
- 更新 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、必要安全/权限文档和完成报告，并创建聚焦源码提交及部署验收提交。

最终结论只能是：

- `OPERATIONS MATERIAL REVIEW QUEUE FIXED — UAT APPROVAL NOT EXECUTED`
- `OPERATIONS MATERIAL REVIEW QUEUE PARTIALLY FIXED — UAT APPROVAL NOT EXECUTED`
- `BLOCKED — NO UNSAFE CHANGE`

## 完成结果

最终结论：`OPERATIONS MATERIAL REVIEW QUEUE FIXED — UAT APPROVAL NOT EXECUTED`。

- 源码提交 `54f648051a8454b022a6f12c41fe3f1558875a7c` 只为 `operations` 增加 `material.review.queue`、`material.review.approve`、`material.review.reject`，并收敛 legacy 清洗入口和 Dashboard 全局统计文案；验收提交为本文所在的 `ops: accept operations material review queue fix`，其 SHA 以 `git log` 为准。
- operations 精确权限、跨创建人队列/详情、engineering 自审拒绝、无关角色 403、正文不可编辑、批准编码、退回原因、幂等/CAS/并发、故障回滚、审计和 UI 一致性均在隔离 PostgreSQL 或合成 UI 合同中通过；未在主库执行审核写入。
- alpha.34/0034 兼容 hotfix 镜像为 `sha256:f31199de3b8aea025c317b7d67aa26b42a60e037eca7ea7a20f7533dd2e6af38`。只替换 Web；PostgreSQL、Worker、Caddy 未重建，主库仍为 34 migrations / `0034_supplier_receipt_lot_iqc.sql`，0035 未运行。
- 真实 Chromium 仅登录 `uat_20260729_operations`，以 `042576` 检索确认 533—536 全部可见、详情可打开、批准/退回按钮存在、正文编辑控件为 0；安全退出后旧 Session 返回 `SESSION_REVOKED`。浏览器没有点击批准或退回。
- 533—536 最终均为 `PENDING_REVIEW`、version 2（UI `V2`）、`MANUAL`、`PCS`、无正式内部编码；四条的 APPROVE/REJECT version、change log 和 audit 计数均为 0。
- 完整证据、测试矩阵、备份恢复、容器/Volume/资源和清理记录见 `SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02-COMPLETION.md`。
