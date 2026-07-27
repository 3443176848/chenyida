# SELFHOST-PHASE5-TASK10 — 供应商来料 Inventory Lot 与 IQC 隔离放行

## 状态与范围

- 状态：`IMPLEMENTED / PENDING PARALLEL ACCEPTANCE`
- 起点：`main` / `55f8fe9693ebc0f630920e92eca1f74584d852af`，版本 `0.1.0-alpha.33`，PostgreSQL migration `0001—0033`。
- 目标：`0.1.0-alpha.34`；唯一新增 migration `0034_supplier_receipt_lot_iqc.sql`。
- 只实现 Supplier Receipt Lot、收货即 IQC 冻结、合格量解冻、谱系和无下游整单冲销；不实现生产领料 Lot、FIFO/FEFO、效期、序列号、标签、MRB、退货或报废。
- 仅回环非生产 `chenyida-erp-parallel`；不迁真实数据、不部署生产、不切流、不 push、不建 PR。

## 起点诊断

- `inventory_lots` 原来只允许 `MANUFACTURING_FINISHED_GOODS`；采购收货只写 pooled/null Lot 库存。
- IQC 原来能引用 Receipt Line，但没有来料 Lot、冻结余额或放行 Ledger，不能证明隔离守恒。
- 复用既有 `ProcurementFulfillmentService → ProcurementService → InventoryService` 和 `QualityService`，不创建第二套权威。
- clean-0033 合法数据库只含 33 migrations、唯一管理员、原 IDENTITY/LOGIN/success 审计及对应原会话；其他业务、幂等和文件均为 0。
- 修改主库前停服备份：`/var/backups/chenyida-erp/task10-clean-0033-20260727.dump`，1,659,329 bytes，0600，SHA-256 `9eaf3ed717d1258a6553aed2608157b580a535a2ec97cbb96ef5a1125485dc0a`，`pg_restore --list` 通过。

## 实现

- `SUPPLIER_RECEIPT` Lot 使用服务端 `RML-########`；一条正常 Receipt Line 唯一一个 Lot，Supplier Lot 只作标准化外部标识。
- IQC 管理的 ACTIVE/STOCKED 物料收货同事务写 Receipt/Line、Lot、`IQC_RECEIPT` Adjustment/Ledger、on-hand/frozen Balance、Financial Source、事件、审计和幂等；非 IQC 继续 null Lot。
- IQC 沿 Receipt Line 解析 Lot/Material/Unit/Supplier。RELEASE 锁定 Inspection→Lot→Balance，使用 `UNFREEZE` 追加事实；released 不超过 passed，不良余额继续 frozen。
- 无 IQC 且余额/账本完整时，整单冲销沿原 Lot 追加反向 Ledger 并置 `REVERSED`；IQC、AP 或其他库存下游 fail closed。
- 0034 包含来源 XOR、外键/唯一/CHECK、不可变/服务写 guard、Receipt posting 延迟核对及 Lot/Receipt/IQC/Ledger/Balance/released 守恒。

## 隔离验证

- 空库与 0033 升级、重复执行、0034 失败回滚：3/3。
- TASK10 PostgreSQL：3/3；已证明 Receipt 10 / Source 120 / AP 0、IQC 10/8/2、最终 10/2/8、同 Lot 冲销、409 阻断、幂等/CAS/并发/故障回滚/SQL guard。
- TASK10 unit/UI：4/4；正式 typecheck、lint（0 error，8 个既有 warning）、`npm test` 3/3 和凭证扫描通过。

## 待完成验收

- Web/Worker 串行 build，前序 PostgreSQL 回归和 Python 临时 SQLite 基线。
- 主库 0034、clean-0034 备份、真实 HTTP 主链/冲销支线、重启持久化、接受态备份、第二空库恢复和最终 clean-0034 恢复清理。
