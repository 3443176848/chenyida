# SELFHOST-PHASE2-TASK08 诊断与设计记录

日期：2026-07-25（Asia/Shanghai）

## 恢复点

- `main` HEAD `0ad0687`，提交消息 `feat: add self-hosted sales`；工作区 clean，本地相对 `origin/main +8/-0`。
- PostgreSQL `0001`—`0011` checksum 保持提交基线；下一 migration/版本只能是 `0012` / `0.1.0-alpha.8`。
- TASK07 隔离 PostgreSQL/Compose/临时 SQLite/构建镜像已清理；未 push、PR、部署或访问生产。

## Legacy 事实与风险

- Python/SQLite 只有 Inspection 与 Defect 两表；`ref_type/ref_id` 为自由文本/弱整数，IQC 实际指向 PO Line 而非 Receipt Line，IPQC 指向 WO，FQC 指向 SO。
- 创建接口以 float 计算数量和状态；全合格自动写“合格放行”，不良时把 disposition 文本直接当状态。没有独立判定、处置、关闭、重开、幂等、expected version 或职责分离。
- 检验不会改变 Receipt/Inventory/WO/SO/Shipment；页面文案声称 FQC 确认出货前状态，但 legacy 发货没有读取品质记录，属于未兑现门禁。
- 历史 D1 `erp_records` 仅复制该自由 JSON 行为，不提供关系、事务或放行权威，不能作为新实现底座。

## 设计结论

- 用显式 nullable FK + 类型 CHECK 固定 IQC=Receipt Line、IPQC=Production Report、FQC=Completion Line+SO Line；FQC 校验两端 Material/Unit，并按六位数量建立可消费放行额度。
- Inspection、Result、Defect 为不可变事实；Disposition/Close/Reopen 只追加 Event，Header 的 lifecycle/decision/released_qty/version 是服务事务维护的投影。
- 全合格仍需独立处置和关闭；创建人与处置人职责分离。RELEASE 最多放行 passed quantity，CONCESSION 最多放行 inspected quantity，其他处置为 HOLD/零放行。
- Sales Shipment 在现有订单/库存锁事务内同时检查已关闭 FQC 放行余额；Quality 重开或降低放行也检查已发数量，避免历史 Shipment 被反向失去依据。
- IQC 库存隔离需要批次或隔离库位；当前 MAIN/空 lot 池化模型不能证明来源剩余量，因此本任务不执行全局 freeze，也不声称已实现可用库存品质门禁。
