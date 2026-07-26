# SELFHOST-PHASE5-TASK02 — 工序派工、执行事件与线性 WIP 流转

## 状态与授权

- 状态：`DOING`
- 日期：2026-07-26（Asia/Shanghai）
- 授权：项目负责人已明确授权继续细化生产，本轮自主执行且只执行本任务。
- 合法起点：`main` / `d6554fcaea77cfe16320d98afcf9aed9c794bc3f`；工作区 clean，`origin/main...HEAD` behind 0/ahead 40。
- 依赖：`SELFHOST-PHASE5-TASK01`、`SELFHOST-PHASE4-TASK06`、`SELFHOST-PHASE4-TASK07`，以及既有 Production、Inventory、Routing、Identity 与 Dashboard 权威模块。
- 结论门槛：功能、0026、隔离测试、实际 HTTP、Compose 重启、停服备份/新空恢复及最终清理全部通过后，才能写入 `PRODUCTION OPERATION EXECUTION AND WIP ACCEPTED IN PARALLEL ENVIRONMENT`。

## 唯一业务链

```text
Work Order Routing Snapshot
  -> Snapshot Operation 受控投影
  -> 按可用投入量分批派工
  -> READY Run 开工
  -> Run 追加工序报工
  -> good 精确分配给下一工序 Run
  -> scrap 留作工序损耗
  -> 末工序 good 形成待 Work Order 最终报工数量
```

本任务不执行既有 Work Order 级 Production Report、Completion、成品 Inventory Ledger/Balance、IPQC/FQC，也不把 WIP 当作库存。执行只引用不可变 Work Order Routing Snapshot Operation，不引用可变化 Routing Version Operation，不以自由文本 `process_stage` 作为权威。

## 已确认业务规则

1. 每个 Snapshot Operation 建立 `WAITING/READY/IN_PROGRESS/COMPLETED/CANCELLED` 受控投影；首工序来源为所有物料需求共同证明的实际净领料支持量，后续来源为前工序未冲销 good。
2. Run 是分批派工与执行聚合：稳定引用 Work Order、Snapshot Operation、快照 Work Center 和 active、具备 `production.execute` 能力的 assigned operator；数量为正，计划起止可选，身份、摘要、操作者和审计字段由服务端维护。
3. 后序 Run 使用不可变 Input Allocation 精确消费前序 Run 的 good；同一来源 good 不得重复消费。派工不写 Inventory Ledger/Balance。
4. 只有有效 READY Run 可开工；并发或重复开工只能一个成功。已开工或已有报工的 Run 不得删除或原地改派。
5. 工序报工只对已开工 Run 追加：`processed_qty > 0`、`good_qty >= 0`、`scrap_qty >= 0`、`good_qty + scrap_qty = processed_qty`，累计 processed 不得超过 dispatched quantity。scrap 永不进入下一工序。
6. WIP 是可由不可变 Run/Report/Input Allocation/Reversal 核对的数量投影，至少包含 waiting input、dispatched、in progress、completed good、scrap、transferred、available for next 和 final output available；浏览器不得提交投影值。
7. 未开工 Run 可取消并释放当前/上游可派数量。已报工 Run 只能追加式全额冲销；已有下一工序消费、末工序已有 Work Order Report 消费、IPQC/FQC 或其他下游引用时 fail closed。
8. Run 冲销保留原 Run、Report、Allocation 与 Event；追加 Reversal，并恢复当前工序、上游 transfer 和后续 readiness。并发冲销只能一个成功。
9. Work Order 取消继续遵守既有领料/生产事实门禁；只有无执行事实的工单取消时，工序投影随之进入 CANCELLED。
10. Run、Report、Event、Input Allocation、Reversal、Operation/WIP Projection、Audit 与 Idempotency 必须在单一 PostgreSQL 事务提交或整体回滚；数据库 guard 同时校验稳定引用、不可变事实和数量守恒。

## 数据库、版本、权限与页面

- 版本：`0.1.0-alpha.25` → `0.1.0-alpha.26`
- 唯一新增：`drizzle-postgres/0026_production_operation_execution.sql`
- 关系：Work Order Operation Projection、Operation Run、Run Input Allocation、Run Report、Run Event、WIP Projection、Run Reversal。
- 同步：`db/schema.ts`、journal、`0026_snapshot.json`；不修改 `0001`—`0025`。
- 权限：`production.dispatch`、`production.execute`、`production.operation.reverse`、`production.read`；现有 production 角色获得 dispatch/execute，manager/admin 获管理能力，warehouse/quality 按规定只读。
- 页面：`/production/dispatch`、`/production/operations`、`/production/wip`，全部提交 Snapshot Operation ID。
- Dashboard：READY 待派工、IN_PROGRESS Run、工序间 WIP、末工序待最终报工、前序不足 WAITING。

## 验收清单

- [ ] 0026、Schema、journal、snapshot、SHA-256
- [ ] 派工/取消、开工、工序报工、线性 good 流转、scrap、Run 冲销
- [ ] 权限、职责、active operator、Work Center、幂等、CAS、并发、事务与直接 SQL guard
- [ ] 三条原生页面与 Dashboard 五项指标
- [ ] TASK02 unit/UI/PostgreSQL/API/migration 与 Phase 4/Phase 5/关联全回归
- [ ] 实际 HTTP 四工序、两个批次 4/6；每工序 10/10/0，末工序 final output 10
- [ ] Work Order 保持 IN_PROGRESS，Production Report/Completion/成品库存/IPQC/FQC 全为 0
- [ ] Compose 整体重启、停服备份/新空恢复、最终干净 0026 清理
- [ ] 功能与验收两个独立提交

## 明确排除

Work Order 最终报工绑定、Completion、成品入库、IPQC/FQC、返工、批次/序列、设备、外协、产能排程、成本、真实数据迁移、HTTPS、80/443、切流、生产部署、push 和 PR 均不属于本任务。完成后停止。
