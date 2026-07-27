# SELFHOST-PHASE5-TASK08 — 成品 Inventory Lot、批次余额与完工入库绑定

## 状态与授权

- 状态：`DONE / PARALLEL ACCEPTED`
- 日期：2026-07-27（Asia/Shanghai）
- 授权：项目负责人明确授权只执行 TASK08，包括代码、唯一 `0032` Migration、隔离测试、现有 `chenyida-erp-parallel` 回环非生产环境实际 HTTP 验收、Compose 串行重启、停服备份恢复、限定清理、文档和独立 Git 提交；不得启动 TASK09。
- 合法起点：`main` / `809efadd2cafd1a7b55a0824b87c67c70ad2814b`，Parent `dfece35cda381ff31c376aad9ed78242861ada73`；工作区 clean，`origin/main...HEAD` behind 0/ahead 59。
- 依赖：`SELFHOST-PHASE5-TASK01`—`SELFHOST-PHASE5-TASK07`，以及既有 Inventory、Production Completion、Manufacturing Batch、Quality、Sales、Identity、Dashboard 和备份恢复权威模块。
- 完成门槛：代码、Migration、专项与适用回归、实际 HTTP 4+6、Completion 冲销与同 Lot 恢复、freeze/unfreeze、Compose 重启持久、接受态停服备份/固定第二新空库恢复、主库干净 0032、资源清理、文档和独立提交全部通过后才能改为 DONE。
- 完成记录：上述门槛已全部通过，详见 `docs/tasks/SELFHOST-PHASE5-TASK08-COMPLETION.md`；固定结论为 `FINISHED GOODS INVENTORY LOTS ACCEPTED IN PARALLEL ENVIRONMENT`。TASK09 未启动。

## 唯一业务链与权威边界

```text
Manufacturing Batch
  -> Production Report
  -> warehouse Completion
  -> stable Finished Goods Inventory Lot
  -> Inventory Ledger by stable lot id
  -> Inventory Balance by Material + Location + Lot
  -> Batch Genealogy returns Lot + Ledger + Balance
```

本任务只建立 `MANUFACTURING_FINISHED_GOODS` Inventory Lot。一个已发布 Manufacturing Batch 只能对应一个稳定 Lot；同 Batch 多次 Completion 必须复用同一 Lot。ORDER 模式历史 Completion 继续使用 `inventory_lot_id=null`、`lot_code=''`，不得猜测 Lot。

## 实施范围

1. 新增关系化 `inventory_lots` 或等价权威模型，保存稳定 ID、服务端唯一 code、类型、Material、Unit、Production Batch、来源 Completion、制造时间、状态投影、operation/request/audit 信息；Lot code 创建后不可修改。
2. 为 Ledger/Balance 增加 nullable `inventory_lot_id`。成品 Lot Balance 唯一键为 `material_id + location_code + inventory_lot_id`；`lot_code` 仅作兼容显示。历史空 Lot 保持兼容。
3. Batch Completion 在单一事务锁定 Batch、Report、Completion、Lot、Balance，首次创建 Lot、后续复用；Completion、Allocation、Ledger、Balance、Lot/Batch 投影、Event、Audit、Idempotency 原子提交。
4. Completion 冲销必须向原 Lot 追加反向 Ledger；冻结、FQC、Shipment 或无法证明安全的其他下游一律拒绝。全部来源 Completion 冲销且净余额为零时 Lot 投影为 `REVERSED`；重新 Completion 复用原 Lot。
5. warehouse 可对 Lot 执行正数 freeze/unfreeze，复用 Inventory Service 的追加式事实、CAS、持久幂等、事务审计和守恒；production、quality、engineering 只按职责读取，其他角色不得执行 Lot 写操作。
6. 提供 Lot 列表、详情、Ledger、Material Lot Balance、freeze/unfreeze、Inventory 汇总，以及 Completion 和 Batch genealogy 的 Lot 返回；页面展示 Lot、Batch、Material/Unit、on-hand/frozen/reserved/available、Completion、Ledger 和状态。
7. 版本 `0.1.0-alpha.31` → `0.1.0-alpha.32`，唯一新增 `drizzle-postgres/0032_finished_goods_inventory_lots.sql`；不得修改 `0001`—`0031`。同步 Schema、journal、snapshot、package 版本和 migration checksum 文档。
8. PostgreSQL guard 必须阻止跨 Batch/Material/Unit、错误 lot_code、重复 Lot、Batch Completion 空 Lot、Ledger/Balance 不一致和 Completion→Lot→Ledger 不守恒；守恒核对使用 deferred reconciliation。

## 测试与实际验收

- 新增 TASK08 unit、UI contract、PostgreSQL/API、Migration 和 Compose acceptance，覆盖 Lot 唯一/复用、Material 汇总、freeze/unfreeze、冲销恢复、冻结门禁、ORDER 兼容、幂等/CAS/并发/权限/故障/直接 SQL guard。
- 串行执行 Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK07、Production/Batch/Inventory/Quality/Sales/Dashboard、Identity/Permissions、Migration manifest、typecheck、Schema consistency、lint、Web/Worker 分开 build、credentials、diff 和 Python 三项基线。
- 实际 HTTP 创建四 Work Center 与 `NONE/NONE/IPQC/NONE` Routing，planned 10 Work Order 完整领料，Batch A 4 / Batch B 6，全部 IPQC 通过，Report/Completion 4/6。
- 核对 Lot A 4、Lot B 6、Material Aggregate 10；Lot B freeze 2/unfreeze 2；Lot A Completion 安全冲销为 0/REVERSED 后重新 Completion 4 并复用同 Lot；验证并发不重复建 Lot、跨 Batch/Material 拒绝、冻结冲销拒绝、production freeze 403、ORDER 空 Lot 兼容。
- 最终 Work Order `10/10/10/0/10 COMPLETED`，FQC/Shipment/Sales Source/AR/Settlement 为 0；Compose 重启后 Lot、Ledger、Balance、冻结事件与 genealogy 保持。

## 低资源、备份恢复与清理

- 固定 `COMPOSE_PARALLEL_LIMIT=1`；所有 build、Migration、测试、typecheck、备份恢复和 Compose 重启串行，一次最多一个临时容器/测试库。宿主 Node heap 1024 MiB，Web/Worker heap 384 MiB。
- 每项重任务前后记录内存、Swap、磁盘、Load、Docker stats/ps/system df、RestartCount/OOMKilled；严格执行用户指定停止线。
- 修改主库前创建 TASK08 专用停服 custom dump 并验证非零、SHA-256、0600 和 `pg_restore --list`；不得修改 resource-guard 备份。
- 验收后创建接受态停服备份，恢复到固定第二新空数据库并核对 32 migrations、Lot 4/6 和 Material 10；随后把主库恢复为干净 0032，仅保留唯一管理员、三容器、四卷及既有 tagged image/resource-guard 备份。
- 只删除 TASK08 创建的临时资源。确认无构建任务后允许且只允许一次 `docker buildx prune --all --force` 清理本任务生成的未使用 BuildKit cache，并记录前后数据。

## 明确排除

不实现供应商批次、原材料 Lot、采购 Receipt Lot、生产领料 Lot、Shipment Lot 消费、FQC Lot 放行、序列号、条码/二维码/标签、Completion 事务外自动 Lot、设备/OEE、外协、产能排程、成本会计、历史数据迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push/PR 或 TASK09。
