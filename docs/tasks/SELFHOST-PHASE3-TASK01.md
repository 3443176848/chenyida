# SELFHOST-PHASE3-TASK01：生产前数据迁移框架与合成试迁移基线

状态：`DONE`（合成迁移框架和生产前准入证据完成）

开始日期：2026-07-25（Asia/Shanghai）

## 起始基线

- Branch `main`；完整 HEAD `14bc68791a34ece9086b889f23d473e84a761cf0`，父提交为 TASK10 功能提交 `96fbaaedf1b11da42de53e48afe714f1ee640f44`，工作区 clean。
- 相对 `origin/main` ahead 12 / behind 0；包版本 `0.1.0-alpha.10`。
- PostgreSQL 应用 migration 为 `0001`—`0013`；本任务保持其内容和顺序不变，不创建 `0014`。
- Python systemd 主进程 PID `277640`，只读核验且不重启；没有运行中的 ERP Compose。

## 目标与交付

建立只能由显式 CLI 运行、可审阅、可恢复、幂等和可断点续跑的生产前迁移工具。交付 SQLite 与 D1 export source adapter、PostgreSQL target adapter、manifest、稳定 ID map、checkpoint、dry-run、合成 commit、逐行安全结果、冲突/重复/orphan 报告、库存与 AR/AP 核对框架，以及合成跨域试迁移证据。

## 强制安全边界

- 所有源文件必须在操作系统临时目录中即时生成并带 `_migration_test` 标识；拒绝仓库内现有 `.sqlite/.sqlite3/.db`、当前 `chenyida_erp_app/data/erp.sqlite3`、备份/上传/附件/归档目录和非临时源目录。
- 拒绝 `ERP_ENV=production`、生产 D1 binding、公开 URL、非回环 PostgreSQL、目标库名缺少 `_migration_test` 标识、非空目标数据库和非空目标文件目录；拒绝发生在任何连接或源文件读取之前。
- 不输出业务行、个人信息、密码/哈希、Session、Token、连接串或真实绝对业务路径；报告只含稳定 source reference、安全错误代码和聚合。
- 不访问、读取、导出、复制或修改真实 SQLite、D1、PostgreSQL、备份、上传、附件和归档；不部署、不切流、不重启 Python、不 push、不建 PR。

## 状态机与阶段

运行状态：`CREATED -> INSPECTED -> PLANNED -> DRY_RUN_PASSED -> COMMITTING -> COMMITTED -> RECONCILED`；验证阻断进入 `BLOCKED`，异常进入 `FAILED`，显式取消进入 `CANCELLED`。`COMMITTED` 不是完成，必须成功 Reconcile。

执行阶段按 `Inspect / Extract / Normalize / Validate / Plan / Dry-run / Commit / Reconcile / Finalize`；每阶段 checkpoint 绑定 source snapshot、mapping registry、normalization、target migration 与 plan digest。任一摘要变化使旧 checkpoint 失效。

## 领域顺序与 fail-closed 规则

Identity → Unit/Category/Material → Customer/Supplier/Product → Supplier Mapping → Product Version/BOM → Inventory Opening → Procurement → Production → Sales → Quality → Finance Opening → Audit/附件引用 → Reconciliation。上游映射缺失时下游标记 `BLOCKED`，不创建 orphan，不按名称或排序随机选择候选。

## 验收

- 单元覆盖环境守卫、manifest/fingerprint、mapping/ID map、checkpoint、dry-run 无写、非空目标与生产拒绝、两种源 adapter、重复/orphan/精度、库存期初、Finance model gap、核对、中断恢复、重复执行与摘要变化。
- 合成 E2E 使用即时生成的临时 SQLite/D1 export 和全新空 PostgreSQL 17，证明 `0001`—`0013`、staging 关系、幂等、恢复、库存/数量链/AR/AP 核对及 backup→新空目标 restore；public 业务表物化与真实 Dashboard 明细核对明确保留为后续生产准入项。
- 完成时版本为 `0.1.0-alpha.11`，提交消息固定为 `feat: add synthetic migration readiness tooling`，提交父必须为本任务起点 `14bc68791a34ece9086b889f23d473e84a761cf0`。

## DONE 语义

DONE 仅表示“合成迁移框架和生产前准入证据完成”。不表示真实数据已迁移、生产试迁移或恢复通过、账号/库存/财务期初已确认、可以立即上线或已获得切流批准。

完成日期：2026-07-25（Asia/Shanghai）。验收明细见 `docs/audits/SELFHOST-PHASE3-TASK01-synthetic-migration-report.md`，生产结论保持 `NO-GO FOR REAL DATA / PRODUCTION`。
