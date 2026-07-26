# SELFHOST-PHASE5-TASK01 完成报告

## 结论

`PRODUCTION ROUTING AND WORK ORDER SNAPSHOT ACCEPTED IN PARALLEL ENVIRONMENT`

本任务只完成 Work Center、产品版本 Routing 审核发布和 Work Order RELEASE 不可变 Routing Snapshot；没有执行工序派工、开工、完工、工序报工、WIP、返工、批次、设备、外协或库存过账。

## Git、版本与 Migration

- 功能提交：`8eedfa07573c37e46d93f208162a0842c8d90a48`
- 功能 Parent：`7485bb93dc4dad16fa5cfe54651bb8f82306a7d2`
- 功能消息：`feat: add production routing snapshots`
- 验收消息：`ops: accept production routing workflow in parallel environment`；严格以功能提交为 Parent，实际哈希以 Git log 为准。
- 版本：`0.1.0-alpha.25`
- Migration：`0025_production_routings.sql`
- SHA-256：`39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9`
- 0001—0024 未修改；Drizzle Schema、journal、snapshot 与数据库一致。

## 实际 HTTP 业务验收

operations 账号创建并保持四个 ACTIVE Work Center：

| Code | 中文名称 |
| --- | --- |
| `SMT-PRINT` | 锡膏印刷 |
| `SMT-MOUNT` | 贴片 |
| `REFLOW` | 回流焊 |
| `AOI` | 自动光学检测 |

engineering 为同一 RELEASED Product Version 创建、编辑并提交 Routing v1；不同账号 manager 发布。v1 工序按 `10/20/30/40` 固定为锡膏印刷、SMT贴片、回流焊和 AOI，digest 为 `d9756e1e1751c861953927dd299d89e57d90c5ddbcda2bde8d6600dcfa922f06`。

Phase 4 Production Handoff 生成唯一 DRAFT Work Order，planned quantity 10。production 显式释放后：BOM Snapshot 1、Routing Snapshot 1、Snapshot Operations 4、Reservation 10，且 Material Issue 0、Production Report 0、Completion 0；路线操作没有改变 Inventory on_hand。

随后 v2 只修改回流焊标准时间并经相同职责分离流程发布，digest 为 `2a3c5cda38ed6462f58b6d445a979fab58a3d6fccc255e1ee5be6bb934865962`。v1 保留为 SUPERSEDED；首张工单仍保持原 v1 digest、版本和四条快照工序，新工单使用 v2。

## 数据、事务与安全保护

- Work Center code 服务端标准化、唯一且不可修改；启停 CAS、持久幂等和审计通过。
- engineering 与 manager/admin 职责分离通过；operations、production、planning 最小权限和其他角色越权 403 通过。
- 空路线、重复/非法 sequence、Product Version 不匹配、Inactive Work Center、缺失 Released Routing 和 digest 不一致均 fail closed。
- 并发发布只产生一个 current RELEASED Version；Released Routing/Operation 和 Work Order Snapshot/Operation 的服务层及数据库不可变 guard 通过。
- 幂等同正文重放、异正文冲突、CAS stale version、故障注入回滚和直接 SQL guard 通过。
- Work Order RELEASE 在单一事务提交 BOM Snapshot、Requirement、Reservation、Routing Snapshot/Operations、状态 Event、Audit 和 Idempotency；失败时上述事实均为 0，不留下半记录。
- 历史 RELEASED/COMPLETED Work Order 未自动回填、不从 `process_stage` 猜测，显示 `LEGACY_UNSTRUCTURED`；既有报工事实未修改。

## 自动验证与回归

- Phase 5 TASK01 unit/UI、PostgreSQL/API、migration 全部通过。
- Migration 覆盖空库、0024→0025、重复执行、失败回滚和历史工单兼容。
- Phase 4 TASK01—TASK10 PostgreSQL/API 与 migration upgrade 回归通过；Production、Production Handoff、Completion、Planning、BOM、Inventory、Master Data、Dashboard 回归通过。
- 全部正式 Phase 4/Phase 5 typecheck、Schema consistency、build 和 902 文件凭证扫描通过。
- lint 为 0 error、6 个既有 warning；`git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py` 和临时 SQLite `go_live_check.py` 通过。

## Compose、重启、备份恢复与清理

- 只更新 `chenyida-erp-parallel`；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未占用 80/443。
- 整体重启后保留 25 migrations、4 Work Center、2 Routing、2 Routing Snapshot、8 Snapshot Operations、7 Routing Event 和 11 Audit。
- Web 三条新页面实际 HTTP 200；没有虚假开工、完工或报工按钮。
- 停服备份 `backup-20260726T144314Z-8eedfa07573c` 通过 SHA、大小、归档和 migration 校验；新空库恢复核对为 `25|4|2|2|7|0|0|0`。恢复保护曾正确拒绝包含 `production` 的临时目标名，拒绝发生在写入前；改用明确测试库名后成功恢复。
- 最终主库为干净 0025：25 migrations、唯一启用管理员，Work Center、Routing、Work Order、BOM/Routing Snapshot、Reservation、Issue、Report、Completion、Event、Audit、Idempotency 与 uploads/attachments 均为 0。
- 仅保留 PostgreSQL、Web、Worker 三个并行容器和 attachments、backup_status、postgres、uploads 四个持久卷；其他临时数据库、备份/恢复目录和迁移容器均已删除。

## 生产保护与排除

- Python PID `277640` 未重启。
- 真实 SQLite metadata 始终为 `64769:53827608:1784999031:1544192`；未读取或修改真实业务数据。
- 未 push、未创建 PR、未迁移真实数据、未切流、未启用 HTTPS、未生产部署。
- 本任务完成后停止；后续工序开工、完工、报工、WIP、返工、批次和设备任务均未自动启动。
