# SELFHOST-PHASE4-TASK06 — 计划到生产工单、齐套预留与仓库领料交接

## 状态与授权

- 状态：`DONE`
- 日期：2026-07-26（Asia/Shanghai）
- 授权：项目负责人已明确选择并授权“继续生产线”。
- 合法起点：`main` / `b45616e1115aab7d22d1b9a7e58f792005291524`；该提交是仅文档且不可改写的合法历史。
- 依赖：`SELFHOST-PHASE4-TASK03`、`SELFHOST-PHASE4-TASK05`、既有 Production/Inventory/Identity 权威模块。
- 结论门槛：只有功能、隔离测试、真实 HTTP、Compose 重启、备份恢复和清理全部通过，才能写入 `PLANNING TO PRODUCTION MATERIAL ISSUE ACCEPTED IN PARALLEL ENVIRONMENT`。

`PHASE0-TASK03` 与 `SELFHOST-PHASE4-TASK05` 保持历史 `DONE`，本任务不得重复执行发布基线复核。真实数据迁移、生产部署、HTTPS、切流、报工、完工和品质均未授权。

## 唯一业务链

```text
当前有效 ACCEPTED Planning Package
  -> planning 准备/提交版本化生产交接
  -> production 退回或接收
  -> 每个接收交接行唯一 DRAFT Work Order
  -> production 显式 RELEASE
  -> 不可变 BOM Snapshot + Material Requirements
  -> PostgreSQL numeric 齐套校验 + 可追溯库存预留
  -> warehouse 对有效预留分批领料/受控退料
```

本任务不创建第二套 Work Order、BOM Snapshot、Material Requirement、Material Issue/Return、Inventory Ledger/Balance 或身份模型。`production-handoff-selfhost` 只保存交接版本、来源快照和交接行到既有工单的唯一关系；工单和库存过账继续由 `production-selfhost` 与 `inventory-selfhost` 负责。

## 已确认业务规则

1. 来源只能是同一项目最新、状态为 `ACCEPTED` 且 version/digest 未变化的 Planning Package。
2. 交接固化 Package Item、Product/Product Version、BOM Version、成品 Material、Unit、数量和来源 SHA-256。Planning 只提交 DRAFT；RETURNED 版本冻结并作为新版本修订依据；Production 只决定接收/退回。
3. Planning Package 没有成品 Material 稳定关系，因此 planning 在准备交接时显式选择成品 Material ID；服务端只接受 ACTIVE/STOCKED、基础单位一致且客户限制一致的物料。Product/BOM/Quantity/Unit 一律从 Package Item 读取，浏览器覆盖字段直接拒绝。
4. 退回不覆盖历史版本；修订创建新的 Handoff Version。接收后每个 Handoff Item 最多关联一张既有权威 Work Order。
5. DRAFT 工单不创建 Snapshot、Requirement、Reservation、Issue 或生产出库 Ledger。
6. RELEASE 在同一 PostgreSQL 事务锁定来源、工单、需求位置和余额；复制不可变 BOM、用 `numeric(24,6)` 生成需求，并按 `available = on_hand_qty - reserved_qty - frozen_qty` 校验。
7. 缺料返回结构化 `shortages`，Snapshot、Requirement、Reservation、Balance、Event、Audit 和 Idempotency 均回滚。齐套时先写 Reservation 来源事实，再原子增加 Balance `reserved_qty`。
8. 并发工单按 Material ID 稳定顺序锁定 Inventory Position/Balance；条件更新阻止重复预留。
9. warehouse 只允许对 RELEASED/IN_PROGRESS 工单的 ACTIVE/PARTIAL Reservation 领料。Issue、Issue Line、Ledger 出库、on-hand/reserved、Requirement net issued、工单事件、审计和幂等同事务提交。
10. 已过账 Issue 不更新/删除。Return 使用既有反向库存事实，并恢复 on-hand、剩余需求的 reserved 和 Requirement net issued；任一引用或版本无法证明即拒绝。
11. 未领料 RELEASED 工单取消会释放未用 Reservation；已有 Issue/Return/Report/Completion 的工单不得直接取消。
12. planning、production、warehouse 分权；manager/admin 具备相应管理能力。所有写接口继续使用 Session/must-change、CSRF、正文上限、速率限制、持久幂等、CAS、安全中文错误、request_id 和事务 Audit。

## 数据库与版本

- 版本：`0.1.0-alpha.19` → `0.1.0-alpha.20`
- 仅新增：`drizzle-postgres/0020_production_handoff_reservations.sql`
- 新关系：Production Handoff、Handoff Item/Event、Handoff Item→Work Order 唯一链接、Inventory Reservation/Event。
- 约束：完整稳定外键、部分唯一索引、状态/数量/digest check、`numeric(24,6)`、来源一致性 trigger、Service GUC 和不可变事实 guard。
- `0001`—`0019` 不修改；Drizzle Schema、journal 和 `0020_snapshot.json` 同步。
- 迁移必须覆盖空库、`0019→0020`、重复执行、失败事务回滚和 checksum。

## API、页面与 Dashboard

- API：Planning Package→Handoff、Handoff Queue/Detail、Submit/Return/Accept、Handoff Item→Work Order；复用既有 Work Order Release、Requirement、Issue/Return API。
- 页面：`/planning/production-handoffs`、`/production/work-orders`、`/warehouse/production-issues`。
- Dashboard：按 `production.handoff.read`/业务权限裁剪“待生产接收、齐套不足、已释放待领料、部分领料”。

## 验收清单

- [x] 源码实现、Drizzle 元数据和版本升级
- [x] TASK06 unit/UI/typecheck
- [x] 隔离 PostgreSQL：v1 退回、v2 接收、唯一工单、预留 10、领料 4/6
- [x] 缺料零半记录、并发预留、超领、幂等重放/冲突、CAS、故障注入、取消释放、已领取消阻止、退料恢复、403
- [x] 空库/0019 升级/重复执行/失败回滚
- [x] TASK01—TASK05、Planning、Inventory、Production、Dashboard 和全量正式回归
- [x] 并行环境真实账号 HTTP 验收、Compose 重启、停服备份/新空库恢复
- [x] 清理至 20 migrations、唯一管理员、业务/上传/附件为 0
- [x] 两个独立提交和最终报告

## 明确排除

生产报工、完工入库、成品库存、IQC/IPQC/FQC、销售发货、付款、银行、总账、税票、真实数据迁移、HTTPS、切流和生产部署均不属于本任务。完成后停止，不自动启动后续任务。
