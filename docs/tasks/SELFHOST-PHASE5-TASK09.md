# SELFHOST-PHASE5-TASK09 — FQC Lot 放行与销售发货 Lot 精确消费

## 状态、起点与依赖

- 状态：`DOING`。
- 日期：2026-07-27（Asia/Shanghai）。
- 授权：只执行 TASK09；允许唯一 `0033_finished_goods_lot_fqc_shipment.sql`、版本 `0.1.0-alpha.33`、现有回环非生产 Compose 验收、受控备份恢复、限定清理、文档与独立提交。禁止 TASK10、push/PR、真实迁移和生产动作。
- 起点：`main` / `279d284738b8ee01f6579a91333ad958a6c36dc8`，工作区 clean，`origin/main...HEAD` behind 0/ahead 71；`0.1.0-alpha.32`；PostgreSQL `0001`—`0032`，0032 SHA-256 `3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa`。
- 运行门禁：PostgreSQL/Web healthy、Worker running；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口；RestartCount 0、OOMKilled false、Build Cache 0B、四个受保护卷存在。
- 合法基线：唯一启用管理员 1、Audit 1、ACTIVE Session 1，Audit 为 `IDENTITY/LOGIN/success`，二者 `created_at=2026-07-27 12:32:57.201019+00`；其余业务/幂等/uploads/attachments 0。审计安全摘要 `476a91c9c6adf6596c56abc21a092b24`，会话排除 token 后摘要 `7d1f767ef0409e814a72bda3fe4e9eee`。会话主键本身是禁止读取的 token hash，不读取、不记录。
- 依赖：Phase 4 TASK08 的 Completion→SO Allocation/FQC、Phase 4 TASK09 的 Delivery/Shipment/FQC 消费/Sales Source、Phase 5 TASK03/TASK07/TASK08 的结构化 Report、Manufacturing Batch 和 Finished Goods Inventory Lot，以及 Inventory、Quality、Sales、Production、Identity、Dashboard、备份恢复模块。

## 现状诊断与 Lot 断点

当前 Batch Completion 已经由 `production_completion_inventory_lots` 稳定绑定 `inventory_lots`，Ledger/Balance 以 `inventory_lot_id` 为权威；ORDER Completion 保持 null/空 Lot。`finished_goods_sales_allocations` 只保存 Completion Line 与 Sales Order Line，FQC 只保存该 Allocation，Shipment 的 FQC 消费按 Sales Order Line 自动分摊；`sales_shipment_lines` 与 `sales_shipment_line_fqc_allocations` 均无 Lot 外键，Inventory ISSUE 仍消费历史空 Lot Balance。Lot code 未用于猜测，但稳定 Lot 身份在 FQC→Shipment 之间中断。

## 新关系模型与事务边界

1. `finished_goods_sales_allocations.inventory_lot_id`：nullable 外键。BATCH Completion Allocation 必须从 `production_completion_inventory_lots` 保存原 Lot；ORDER 必须为 null。
2. `quality_inspections.inventory_lot_id`：nullable 外键。FQC 必须与 Allocation Lot 完全一致；IQC/IPQC 保持 null。BATCH FQC 的 inspected/released/consumed/available 均按 Lot、Allocation、SO Line、Material、Unit 锁定核算。
3. `sales_shipment_lines.inventory_lot_id`：nullable 外键。warehouse 对 BATCH 行必须显式提交 Lot；ORDER 行必须省略 Lot。Ledger 必须保存同一 `inventory_lot_id`/`lot_code`。
4. `sales_shipment_line_fqc_allocations.inventory_lot_id`：nullable 外键。BATCH 消费只选择同 Lot CLOSED/RELEASED FQC；ORDER 保持 null 和历史订单级规则。
5. 不新增并行业务权威。Quality/Sales 继续通过现有 Repository transaction；Inventory ISSUE/REVERSAL 继续由 Inventory Service 写不可变 Ledger/Balance。Shipment、Delivery/SO 投影、FQC 消费、Sales Source、Event、Audit、Idempotency 在同一 PostgreSQL 事务提交。

锁顺序固定为：幂等 advisory lock → Delivery/Order/Order Line → Allocation/FQC（稳定 ID 顺序）→ Inventory Lot（稳定 ID 顺序）→ Lot Balance → Shipment/投影。并发请求不能超用 Delivery、SO、Lot available 或同 Lot FQC available。

## 权限矩阵

- quality：读取待检 Lot、建立/处置/关闭 FQC 和按 Lot 放行；不得创建 Shipment、冻结 Lot或改库存。
- sales：建立/提交 Delivery，读取订单及可发 Lot/FQC 摘要；不得过账 Shipment、冻结 Lot或执行 FQC。
- warehouse：接收 Delivery、显式选择 Lot、发货、无下游时冲销；freeze/unfreeze 沿 TASK08。
- production：仅查看自身 Batch/Lot genealogy；不得 FQC、Shipment、freeze/unfreeze。
- finance：只读 Sales Financial Source；本任务不创建 AR。
- manager/admin：相应管理能力。其余角色服务端 403，页面隐藏不作为权限边界。

## 幂等、CAS、守恒与冲销

- 所有写接口继续要求 Session/must-change、CSRF、正文上限、权限、Idempotency-Key、expected version、request_id、安全中文错误和同事务 Audit。
- 同 Key 同正文重放同一事实；同 Key 异正文冲突。Lot Balance、Lot、Order、Order Line、Delivery、Delivery Line 使用 CAS。
- Shipment 数量不得超过 Delivery 剩余、SO Line 剩余、Lot `on_hand-frozen-reserved` 或同 Lot FQC available；冻结、REVERSED、DEPLETED/不足 Lot 均拒绝。
- 冲销必须引用原 Shipment Line 的原 `inventory_lot_id`，由原 Inventory Adjustment 追加反向 Ledger，恢复原 Lot Balance/FQC/Delivery/SO，并追加反向 Sales Source。存在 AR 或其他不可逆下游继续 fail closed。
- 已消费 FQC 不得 reopen、改写或跨 Lot 转移；Completion 在已有 FQC/Shipment 后不能冲销。

## ORDER 兼容

只有无 Manufacturing Batch/Inventory Lot 的历史 ORDER Completion 可保存 null Lot，继续使用空 `lot_code` Balance 与订单级 FQC/Shipment 规则。服务端不得把 ORDER 来源自动猜为任一 Lot；BATCH 来源不得退化到空 Lot。

## Migration、回滚与恢复

- 唯一 Up 为 `0033_finished_goods_lot_fqc_shipment.sql`；不修改 0001—0032。同步 `db/schema.ts`、snapshot、journal、manifest/checksum 文档。
- 采用扩展式 nullable 列、外键、CHECK、唯一/查询索引、服务写 guard、不可变事实 trigger 和 deferred reconciliation。0032 干净库无业务回填；非空升级按稳定 Completion→Lot 关系校验后回填 BATCH Allocation/FQC，无法证明唯一关系则 migration fail closed。
- 回滚采用已验证的 0032 停服 custom dump，不提供破坏性自动 Down。变更前备份；0033 clean 备份作为主库最终恢复点；接受态再备份并恢复到固定第二新空数据库核验。

## 自动测试矩阵

- unit/UI：Lot 字段、BATCH 必选、ORDER null、权限和页面契约。
- PostgreSQL/API：完整 Lot FQC/Shipment/Reversal、幂等/CAS/并发/故障、跨 Lot/Batch/Material/Unit/SO Line、冻结/状态/额度、直接 SQL guard、ORDER 回归。
- migration：空库 0001→0033、0032→0033、重复执行、失败回滚、约束/索引、旧 checksum、Schema/snapshot/journal 一致。
- 回归：Phase 4 TASK08/TASK09，Phase 5 TASK03/TASK07/TASK08，Production/Inventory/Quality/Sales/Finance Source/Dashboard/Identity/Permissions/Environment。
- 正式检查：相关 typecheck、Drizzle consistency、`npm test`、lint、Web/Worker 分开 build、credentials、diff，以及 Python self-test/smoke/临时 SQLite go-live。

## 实际 HTTP 验收与低资源顺序

使用真实 Node/PostgreSQL HTTP 创建 SO 10×20 CNY、Batch/Lot A 4 与 B 6、各 Lot FQC 4/6、Delivery 10；发 Lot A 4，冻结 Lot B 2 并证明发 6 零半记录，解冻后发 6；冲销原 Lot A 4并恢复同 Lot/FQC，再从同 Lot A 发 4。核对 Ledger、余额、FQC、SO、Delivery、Source 80/120、AR/Settlement 0、历史冲销事实和 genealogy。

所有 Migration、测试、build、备份恢复和 Compose 重启严格串行，`COMPOSE_PARALLEL_LIMIT=1`；Web/Worker 分开 build，Node 重任务 heap 1024 MiB，一次一个临时容器/数据库。每项重任务前后检查内存、Swap、磁盘、Load、Docker stats/ps；触发附件停止线立即停止。

## 明确排除

不实现原材料/供应商/采购 Receipt/生产领料 Lot、序列号、条码/二维码/标签、自动选 Lot/FIFO/FEFO、收款/Settlement/银行/税票/总账、AR、成本/利润、Routing/WIP/返工规则变更、真实迁移、Python 服务操作、HTTPS/防火墙/80/443/切流/生产部署、push/PR 或 TASK10。
