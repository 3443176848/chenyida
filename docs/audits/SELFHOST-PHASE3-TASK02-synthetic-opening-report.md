# SELFHOST-PHASE3-TASK02 合成期初物化报告

日期：2026-07-25（Asia/Shanghai）

## 结论

- `MG-001`（无 Shipment/Receipt 的 AR/AP 期初）：`RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。
- `MG-002`（余额型库存期初物化）：`RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。
- 整体准入：`NO-GO FOR REAL DATA / PRODUCTION`。

该结论只证明虚构来源、临时 PostgreSQL 和隔离 Compose 下的关系模型与事务边界成立；不证明真实来源字段、金额、数量、单位、冻结状态、往来主体、规模、附件、RPO/RTO 或生产切换。

## 合成物化结果

| 项目 | 结果 |
| --- | --- |
| Migration | `0001`—`0014` 共 14 个，head 为 `0014_migration_openings.sql` |
| 期初来源 | 4：库存 2、财务 2 |
| 库存 Ledger | 2 条 `MIGRATION_OPENING`；on-hand 合计 `112.000000`，frozen 合计 `4.000000` |
| 库存 Balance | on-hand 合计 `112.000000`，frozen 合计 `4.000000`，与 Ledger 一致 |
| 财务期初 | `OPENING_AR` 1 条、余额 `6.500000 CNY`；`OPENING_AP` 1 条、余额 `7.250000 CNY` |
| Dashboard | AR/AP outstanding 包含上述期初，`REVERSED` 不计入余额 |
| 重放 | 同摘要返回同一结果；摘要变化被稳定来源唯一性阻断 |
| 失败 | 注入失败整事务回滚，无部分来源、Ledger、Balance、Document、Event、Audit 或幂等结果 |

## 更正与并发证据

- 库存期初只允许一次全额冲销；原始 Header/Line/Ledger 不修改、不删除。余额未被下游消费时追加反向 Adjustment/Ledger；已消费导致无法安全反向时拒绝。
- 财务期初可走既有核销/核销冲销；存在有效收付款时拒绝期初冲销，全部核销事实已冲销后才允许将 Document 追加投影为 `REVERSED`。
- 财务核销与期初冲销并发测试只允许一个事务成功，另一个按锁定后的当前状态 fail closed。
- 浏览器和普通管理员没有期初写路由；直接 SQL 缺少内部事务 GUC 时由数据库 trigger 拒绝。

## Migration 与恢复证据

- 空库升级、`0013 -> 0014` 已有数据升级、重复运行、DDL 失败回滚、旧 migration checksum 和 schema 一致性均通过；`0014` 不回填旧数据。
- 隔离 Compose PostgreSQL/Web/Worker 构建、健康检查和整体重启通过。
- Web/Worker 停止后创建 PostgreSQL + 空 uploads/attachments 快照，checksum/manifest 校验通过；恢复到全新空 `task02_restore_migration_test` 后，14 个 migration、4 个来源、Ledger/Balance 与 AR/AP 余额逐项一致。
- 测试容器、网络、卷、临时数据库、备份和 override 已清理。

## 回归摘要

- TASK02 专项：unit 3/3、PostgreSQL 2/2、migration upgrade 3/3；迁移工具 8/8。
- 既有 PostgreSQL/API：42/42；Material/Mapping/Normalization/Review：20/20；migration upgrade 合计 30/30。
- TASK02—TASK10 unit/UI、Dashboard coverage、各域 typecheck、schema consistency、`npm test`、build、lint、environment guard 与凭证扫描通过。Lint 仅保留任务前已存在的一条无关 unused warning。
- Python 项目虚拟环境：`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；常驻 PID `277640` 未重启。

## 未授权范围

没有读取真实 SQLite/D1 业务数据、真实附件或备份，没有连接远程/生产 PostgreSQL，没有执行生产 migration、部署、切流、systemd 重启、push 或 PR。真实 source inventory、人工映射、逐行冲突处置、容量和异故障域恢复仍须独立任务与明确授权。
