# SELFHOST-PHASE3-TASK03：合成全域业务表物化与 Dashboard 核对

状态：`DONE`（仅合成、非生产）

开始日期：2026-07-25（Asia/Shanghai）

## 可信起点

- Branch `main`，HEAD `8f30798464476b53f435d53022c45ed731804e95`，Parent `2c808f7a2ba2c293ff22e5dcc3ca3647a479a91c`，工作区 clean，相对 `origin/main` ahead 14 / behind 0。
- 版本 `0.1.0-alpha.12`；PostgreSQL migration 严格为 `0001`—`0014`，`0014` SHA-256 为 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`。
- Python systemd PID `277640` 仅只读记录；无 ERP Compose 资源。现有 `ai`/`trae` 退出资源属于其他项目，本任务不触碰。

## 唯一范围

把 TASK01 的完全合成 staging 计划受控物化到 PostgreSQL public 业务表，并通过正常领域 Service/API 运行 cutover 后采购、生产、销售、品质和财务旅程，最后核对 Dashboard、23 个 legacy GET、文件、备份与新空目标恢复。

本任务不读取真实 SQLite/D1、现有数据库、backup、upload、attachment 或 archive；不访问远程/生产环境；不部署、切流、重启 Python、push 或创建 PR。所有输入必须即时生成于带 `_migration_test` 的 `mktemp` 路径，目标只能是回环且库名带 `_migration_test` 的新空 PostgreSQL。

## 模式与依赖顺序

1. Cutover Snapshot：identity plan → reference → material → party → product/version → supplier mapping → BOM → inventory opening → finance opening → files → provenance。
2. Post-cutover Synthetic Journey：procurement → production → IQC/IPQC prerequisites → sales/FQC/shipment → finance settlement/reversal。
3. Reconciliation：public facts → API/Dashboard → backup/restore → restart → repeat/reconcile。

Snapshot 与 journey 不得表达同一历史事实。来源中的 purchase/production/sales/quality/稳定来源 finance 活动记录仅用于计划分类与 cutover 后合成旅程契约，不作为历史回放直接插入 public 表。

## 事务与恢复

- Materializer 不由 Web API 调用，只能由显式 CLI/测试入口调用；环境、路径和数据库守卫必须先于 source read/target connect。
- 每个聚合单独事务，public 写入成功、actual target ID/digest/provenance 更新成功后才完成领域 checkpoint。
- 上游失败使依赖领域 `BLOCKED`；不按名称猜测、不绕过 stable ID map、不写 `erp_records`。
- 同一 manifest/run 可恢复和幂等重放；不同 manifest 不得写入已有目标；source/mapping/plan/target digest 改变使 checkpoint 失效。

## 验收与结论词

专项覆盖 dry-run、public materialization、actual target ID、重放、非空目标拒绝、中断恢复、摘要变化、聚合回滚、引用/编码/单位冲突、Opening、全域 journey、文件 SHA、Dashboard/API、23 legacy GET、backup→新空目标 restore、整栈重启与 `erp_records` 零写入。

只有全部执行证据通过后才能标记：`PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`。生产结论始终为：`NO-GO FOR REAL DATA / PRODUCTION`。

## 完成证据

- 合成 SQLite 30 条来源经 dry-run 后，cutover snapshot 将 18 条记录写入实际 public 业务表并保存 actual target ID/digest；12 条历史活动明确归为 `ARCHIVE_ONLY`，未重复过账。
- Identity、Reference、Material、Customer/Supplier、Product/Version、Mapping、BOM、Inventory/Finance Opening、File 和 Audit 全部通过；同 manifest/run 恢复、摘要漂移、code 冲突、聚合故障回滚和恢复不重复通过。
- 正常 Service/API 全域旅程通过，Dashboard AR `56.500001`、AP `27.250000`，opening inventory `112.000000`，4 个 Quality 检验关闭，23 个 legacy GET 全部 200，`erp_records` 始终为 0。
- 停服 backup/verify 恢复到第二个新空目标；14 个 migration、18 个 public map、业务表计数和合成文件 SHA-256 一致。同 manifest 复跑无重复，PostgreSQL/Web/Worker 整体重启后 API/Dashboard 仍通过。
- 适用 unit/UI、PostgreSQL/API、全部 migration upgrade、TASK01—TASK03 专项、8 组 typecheck、Schema consistency、lint、build、credentials、environment 与 Python 三项基线全部通过。
- PostgreSQL migration 保持 `0001`—`0014`，未创建 `0015`，`db/schema.ts` 未修改；版本更新为 `0.1.0-alpha.13`。

最终结论：`PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`。这不包含真实数据、真实账号、容量、安全、生产恢复、部署或切换批准；生产保持 `NO-GO FOR REAL DATA / PRODUCTION`。
