# SELFHOST-PHASE3-TASK01 合成试迁移报告

执行日期：2026-07-25（Asia/Shanghai）

结论：`PASS FOR SYNTHETIC READINESS / NO-GO FOR REAL DATA OR PRODUCTION`。

## 数据与环境边界

- 源只使用运行时在 `/tmp/*_migration_test_*` 生成的 28 条完全虚构记录，分别覆盖 SQLite 和 D1 JSON export adapter；未打开仓库内或现运行面的 SQLite/D1 数据。
- 目标只使用回环 PostgreSQL 17、库名含 `_migration_test` 的新空数据库和隔离 Compose；Python systemd PID `277640` 只读核验，未重启。
- synthetic commit 只写目标库独立 `migration_tool` schema，不写 `public` 业务表。该设计验证迁移计划、稳定 ID、关系、恢复和核对框架，不冒充已完成生产业务表物化。
- 合成文件只保存固定摘要与状态，不使用真实附件；所有报告均只输出计数、摘要、稳定 source ref 和安全错误码。

## 合成数据覆盖

合法集包含 Identity、Unit/Category/Material、Customer/Supplier/Product、Supplier Mapping、Product Version/BOM、库存期初、PO/部分收货、WO/部分完工、SO/部分发货、IQC/IPQC/FQC、稳定来源 AR/AP/部分结算、文件与审计，共 28 条记录、45 条稳定关系。库存汇总 `112.000000`，AR/AP 金额汇总 `19.000000`。

阻断集额外覆盖重复用户名/稳定键、未知角色、重复 Material 编码、同名不同物料、orphan BOM、负库存、缺失 Unit、无效状态、非 CNY、超过 6 位精度、超量、负金额、无来源 Finance opening、文件缺失和 checksum 错误。reviewable、resume、repeat 作为独立 fixture 类型生成。

## 核心结果

| 验证项 | 结果 | 证据摘要 |
| --- | --- | --- |
| 环境/真实路径拒绝 | PASS | 在连接或读取前拒绝 production、D1 binding、非回环 PostgreSQL、非 `_migration_test` 库、仓库/现运行面数据库、备份/上传/附件/归档、符号链接、非临时或非空目标 |
| SQLite / D1 adapter | PASS | 两种即时合成源均形成确定 schema fingerprint、snapshot SHA 和逐文件 SHA；源保持只读 |
| Manifest / mapping / ID map | PASS | 必填字段、敏感字段、稳定摘要、确定 UUID、同 key 幂等及 source digest 冲突均 fail closed |
| Checkpoint / dry-run | PASS | 输入/映射/计划摘要绑定；dry-run 不建立目标 schema；旧 checkpoint 在摘要变化后失效 |
| blocked/review 分流 | PASS | duplicate/orphan/precision/status/unit/inventory/finance/file 问题以安全 code 阻断，不按名称猜测或随机选候选 |
| 中断恢复 | PASS | 在 BOM 阶段注入中断后从已完成 domain checkpoint 继续，最终 `RECONCILED` |
| 重复执行 | PASS | 同 run/同 snapshot 重复执行仍为 28 records、28 ID maps、45 relations，不重复创建 |
| 核对 | PASS | orphan `0`；库存 `112.000000`；稳定来源 AR/AP `19.000000`；状态 `RECONCILED` |
| PostgreSQL 业务 schema | PASS / NO CHANGE | 新空目标 migration 为 13 条、head `0013_finance.sql`；`public` 有 281 个 FK 约束；本任务不修改 0001—0013，也不写业务行 |
| backup → restore | PASS | 合成目标 custom dump 恢复到第二个新空 `_migration_test` 库；13 migrations、28 records、28 maps、45 relations、`RECONCILED` 一致 |
| Web/Worker restart | PASS | 恢复目标 Web/Worker 健康；重启后 28/28/`RECONCILED` 保持；隔离 Compose PostgreSQL/Web/Worker 整体重启后 `/api/health` 正常 |

## 自动验证结果

- 新增迁移工具单元：8/8；PostgreSQL 合成 E2E：1/1。
- 非数据库基线：`npm test` 3/3、environment 6/6；TASK02—TASK10 unit/UI/coverage 合计 87/87。
- PostgreSQL/API：Material 7、Mapping 6、Normalization 4、Review 3、Identity 8、Master 3、Inventory 3、Procurement 7、Production 5、Sales 3、Quality 8、Finance 3、Dashboard 2，加基线 5，共 67/67。
- migration upgrade：Identity 4、Mapping 1、Normalization 1、Master/Inventory/Procurement/Production/Sales/Quality/Finance 各 3，共 27/27。
- TASK03—TASK10 typecheck：8/8；Vinext build、lint、652 文件凭据扫描均通过。
- Python 项目虚拟环境：`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py` 均通过。
- PostgreSQL migration checksum 逐文件复核与既有 0001—0013 基线一致；未创建 0014，`db/schema.ts` 和 migration 无 diff。

首次运行中出现的失败均在写业务数据前停止并按原断言修正测试环境：容器只挂 Site 时环境清单不可见、通用测试库缺少各专项 marker、两个 upgrade 套件误共用数据库、宿主机缺少 `pg_dump`。分别改为挂载全仓库、每套测试独立 marker 数据库、每个 upgrade 独立数据库和 PostgreSQL 17 工具容器后全部通过；未降低断言。

Compose build 中 `npm ci` 仍报告既有依赖审计项（Web 1 low / 4 moderate / 8 high，Worker 3 high）。本任务未获依赖升级授权，保留为独立安全风险。

## 未证明与准入结论

本任务没有读取真实 schema/data fingerprint、没有把合成行物化到 `public` 业务表、没有调用真实 Dashboard 业务汇总、没有迁移真实文件，也没有证明容量、RPO/RTO 或生产恢复。无业务来源 AR/AP 仍为 `MODEL_GAP`；仅有余额的库存只能形成期初计划。

因此完成结论仅为“合成迁移框架和生产前准入证据完成”。真实数据试迁移、业务表物化适配、Dashboard 明细核对和生产切换仍须单独任务、只读快照、业务审批和新的授权。
