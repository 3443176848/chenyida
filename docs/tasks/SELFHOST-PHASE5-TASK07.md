# SELFHOST-PHASE5-TASK07 — 生产批次身份与全过程谱系

## 状态与授权

- 状态：`DONE / PARALLEL ACCEPTED`
- 日期：2026-07-27（Asia/Shanghai）
- 授权：项目负责人明确授权只执行 TASK07，包括代码、`0031`、隔离测试、现有 `chenyida-erp-parallel` 回环非生产环境实际 HTTP 验收、Compose 串行重启、停服备份恢复、限定清理、文档和独立 Git 提交；不得启动 TASK08。
- 合法起点：`main` / `93902d9c3f7be94044cf9903af6e6fbebc685cc3`，Parent `1f6a143adbf78d7fb70fbed1ea7d7dfea62cfd4b`；工作区 clean，`origin/main...HEAD` behind 0/ahead 54。
- 依赖：`SELFHOST-PHASE5-TASK01`—`SELFHOST-PHASE5-TASK06`，以及既有 Production、Routing、Operation、Quality、Nonconformance、Rework、Completion、Inventory、Identity、Dashboard 与备份恢复权威模块。
- 完成门槛：代码、Migration、专项与适用回归、实际 HTTP 4+6、Compose 重启持久、接受态停服备份/固定第二新空库恢复、主库干净 0031、资源清理、文档和独立提交全部通过后才能改为 DONE。

## 唯一业务链与边界

```text
Work Order -> DRAFT Batch Set -> Manufacturing Batch 4 / 6
  -> RELEASED + digest -> NORMAL Run by Batch
  -> IPQC / NCR / Rework / Reinspection on same Batch
  -> Final Output / Report / Completion by Batch
  -> existing Inventory Adjustment / Ledger
```

本任务建立 Manufacturing Batch genealogy，不建立仓库 Inventory Lot。既有 Inventory Ledger/Balance 继续使用 `MAIN` 与空 `lot_code`，不得解除 `INVENTORY_LOT_NOT_SUPPORTED`。页面和谱系响应必须明确：**生产批次谱系已建立，但仓库批次库存尚未启用。**

## 实施与验收范围

1. 每工单至多一个 `DRAFT/RELEASED/CANCELLED` Batch Set、服务端唯一 Batch code、发布 digest/快照和不可变事件；DRAFT 变更执行 CAS，发布数量严格等于工单计划量且工单尚无 Run。
2. Operation Run 增加 nullable Batch 稳定外键；Batch 模式 NORMAL Run 必须绑定同工单已发布 Batch，首工序不得超 planned，后序 Input Allocation 不得跨 Batch；REWORK 只能继承原 NCR/Inspection/Run Report 的 Batch。
3. Production Report、Completion 建立单 Batch 稳定关系；Final Output、Report、Completion 不得混批，Completion 仍复用 Inventory Service 且 Ledger `lot_code=''`。
4. 提供 Batch 列表、详情、code 精确查询、WIP、genealogy 和 Work Order 汇总；状态从不可变事实投影为 PLANNED/READY/IN_PROGRESS/QUALITY_HOLD/REWORK/COMPLETED/CANCELLED。
5. production 管理 Batch Set/Run；quality、warehouse、engineering 按职责只读；manager/admin 管理；planning/purchase/sales/finance 不得写。所有写操作延续既有安全、幂等、CAS、事务审计和整体回滚。
6. 版本 `0.1.0-alpha.30` → `0.1.0-alpha.31`，唯一新增 `drizzle-postgres/0031_production_batch_genealogy.sql`；不得修改 `0001`—`0030`。
7. 页面覆盖 `/production/batches` 及相关生产、品质、返工、完工页面；Dashboard 按权限展示 Batch 待办。
8. 自动测试覆盖 unit、UI、PostgreSQL/API、Migration、Compose acceptance 和 TASK01—TASK06 回归；实际 HTTP 验收 Batch A 4、Batch B 6、B 原检 4+失败 2、返工 2、复检 2，最终两笔 Completion/Ledger 4+6、空 lot、Balance 10。
9. 修改主库前创建 TASK07 停服备份；验收后串行重启、接受态备份、固定第二新空库恢复、主库清理至 31 migrations/唯一启用管理员/业务与审计幂等及文件为 0，并仅保留原三容器四卷和 resource-guard 备份。

## 低资源与排除边界

固定 `COMPOSE_PARALLEL_LIMIT=1`；重任务全部串行，一次最多一个临时容器/测试库；宿主 Node heap 1024 MiB，Web/Worker heap 384 MiB。每项重任务前后记录资源、60 秒 Swap、RestartCount/OOMKilled；磁盘低于 12 GiB 不启动新镜像构建，触发其余停止条件立即停止。只清理 TASK07 明确创建的资源。

不实现 Inventory Lot Balance、原材料/供应商/成品仓库批次、批次冻结、Shipment 批次消费、序列号、标签/条码/二维码、自动 Batch 创建、设备/OEE、外协、产能排程、成本会计、FQC/Shipment/AR/财务动作、历史迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push/PR 或 TASK08。

## 验收清单

- [x] `0031`、Schema、journal、snapshot、完整 SHA-256 `ac0f6a63cfdb30d42edf50741afc7c8af632f74ff6fb08398d6b6e398a637fd4`、版本升级
- [x] TASK07 unit、UI、PostgreSQL/API、Migration、Compose acceptance
- [x] 数量、不可变、CAS、幂等、并发、故障、SQL guard、权限 403、ORDER 兼容
- [x] 实际 HTTP Batch A 4 / Batch B 6 与完整 genealogy
- [x] typecheck、Schema consistency、lint、build、credentials、diff 与 Python 三项基线
- [x] 修改前备份、Compose 重启、接受态备份、恢复核对和最终清理
- [x] 功能提交、完成报告和独立 ops 验收提交
