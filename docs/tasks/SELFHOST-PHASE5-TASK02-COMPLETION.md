# SELFHOST-PHASE5-TASK02 完成报告

## 结论

`PRODUCTION OPERATION EXECUTION AND WIP ACCEPTED IN PARALLEL ENVIRONMENT`

本任务只完成基于 Work Order Routing Snapshot Operation 的分批派工、开工、工序报工、good 线性流转、scrap 损耗、WIP 数量投影和受控全额冲销；没有执行 Work Order 最终报工、Completion、成品库存或品质检验。

## Git、版本与 Migration

- 功能提交：`77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c`
- 功能 Parent：`d6554fcaea77cfe16320d98afcf9aed9c794bc3f`
- 功能消息：`feat: add production operation execution`
- 验收消息：`ops: accept production wip workflow in parallel environment`；严格以功能提交为 Parent，实际哈希以 Git log 为准。
- 版本：`0.1.0-alpha.26`
- Migration：`0026_production_operation_execution.sql`
- SHA-256：`b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0`
- 0001—0025 未修改；Drizzle Schema、journal、snapshot 与数据库一致。

## 实际 HTTP 四工序与两个批次

planned quantity 10、Routing Snapshot v1、完整净领料 10 的 Work Order 进入 `IN_PROGRESS`。production 账号按批次 4 和 6，逐工序执行派工、开工与报工：

| Sequence | 工序 | processed | good | scrap | 未转移 WIP | 末工序待最终报工 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 锡膏印刷 | 10 | 10 | 0 | 0 | 0 |
| 20 | SMT贴片 | 10 | 10 | 0 | 0 | 0 |
| 30 | 回流焊 | 10 | 10 | 0 | 0 | 0 |
| 40 | AOI | 10 | 10 | 0 | 0 | 10 |

两个批次均完整贯穿四工序。前三工序 good 已被下一工序精确消费，末工序 good 10 只留在 `final_output_available_qty`。Work Order 仍为 `IN_PROGRESS`；Production Report 0、Completion 0、Finished Goods Ledger 0、成品 Balance 0、IPQC/FQC 0。

## 模型、权限和事务保护

- Work Order Operation Projection、WIP Projection、Run、Input Allocation、Run Report、Run Event 和 Run Reversal 全部稳定引用 Snapshot Operation；不引用可变化 Routing Version Operation，不以 `process_stage` 为权威。
- 首工序以实际净领料支持量为来源；后序以具体前序 Run good 的不可变 Allocation 为来源。跳序、超前序 good、重复消费、Work Center 不匹配、inactive operator 和超量派工均拒绝。
- production 拥有 dispatch/execute；manager/admin 拥有相应管理和 reverse；warehouse/quality 只读；其他越权写返回 403。
- 重复/并发派工不能超量，重复/并发开工只一个成功；Idempotency-Key 同正文重放原结果、异正文冲突，CAS stale version 拒绝。
- `good + scrap = processed`、processed 不超 dispatched；scrap 不进入下一工序。未开工 Run 可取消并释放数量。
- 已报工事实不可修改或删除。已有下游消费时全额冲销 fail closed；无下游时追加 Reversal 并恢复 WIP；重复/并发冲销只一个成功。
- Run、事实、Projection、WIP、Audit 和 Idempotency 单事务提交；故障注入和数据库直接 SQL guard 均证明零半记录与数量守恒。

## 自动验证与回归

- TASK02 unit/UI、PostgreSQL/API、migration 全部通过；migration 覆盖空库、0025→0026、重复执行和失败回滚。
- Phase 4 TASK01—TASK10 PostgreSQL/API 与 migration upgrade、Phase 5 TASK01、Production、Routing、Inventory、Dashboard 回归通过。
- 未完整领料、跳序、后序超前序 good、Work Center、inactive operator、并发派工/开工、超派工、数量不守恒、scrap、取消、冲销门禁/恢复、幂等/CAS、故障零半记录、403 和 Routing Snapshot 不可变均有自动覆盖。
- 20 组正式 typecheck、Schema consistency、lint、build、916 文件 credentials scan、`git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py` 和临时 SQLite `go_live_check.py` 通过；临时 SQLite 已删除。

## Compose、重启、备份恢复与清理

- 只更新 `chenyida-erp-parallel`；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未占用 80/443。
- 整体重启后 Run 8、Run Report 8、Run Event 24、Operation Projection 4、WIP Projection 4、末工序输出 10、相关 Audit 24 保持。
- 停服备份 `backup-20260726T235722Z-77ff520e8dbd` 通过 SHA、大小、归档安全和 26 个 migration 清单校验；新空库恢复核对为 `26|2|1|4|8|8|24|4|10|0|0|0`，uploads/attachments 恢复文件 0/0。
- 最终主库为干净 0026：26 migrations、唯一启用管理员，所有合成业务、Audit、Idempotency、uploads 和 attachments 均为 0。
- 仅保留 PostgreSQL、Web、Worker 三个并行容器和 attachments、backup_status、postgres、uploads 四个持久卷；任务临时数据库、备份/恢复目录、测试 SQLite、依赖卷和迁移容器均已删除。

## 生产保护与外部状态

- 可信起点 Branch/HEAD/clean/origin ahead 40 behind 0、Compose、Web、Python PID `277640` 和 SQLite metadata 均严格匹配后才开始。
- 本任务从未执行 Python 重启或真实 SQLite 正文读写。长时间验证等待期间出现用户/外部并行修改与 Python 重启；这些修改未纳入本任务提交，最终 Python PID 为 `13737`，SQLite metadata 仍为 `64769:53827608:1784999031:1544192`。
- 未 push、未创建 PR、未迁移真实数据、未切流、未启用 HTTPS、未生产部署。
- 本任务完成后停止；未自动启动最终报工绑定、成品入库、返工、批次、设备或产能排程。
