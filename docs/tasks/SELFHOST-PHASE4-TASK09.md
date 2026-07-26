# SELFHOST-PHASE4-TASK09 — 销售发货、成品出库与应收交接

## 状态与授权

- 状态：`DONE / PARALLEL ACCEPTED`
- 日期：2026-07-26（Asia/Shanghai）
- 授权：项目负责人已明确授权继续完整业务链，本轮仅执行 TASK09。
- 合法起点：`main` / `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea`，工作区 clean，`origin/main...HEAD` behind 0/ahead 34。
- 依赖：`SELFHOST-PHASE4-TASK08`、既有 Sales/Quality/Inventory/Finance/Identity 权威模块。
- 目标版本：`0.1.0-alpha.23`；唯一新增迁移 `0023_sales_delivery_receivable.sql`。
- 结论门槛：功能、迁移、隔离测试、真实 HTTP、Compose 重启、停服备份恢复和最终清理全部通过后，才能写入 `FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT`。

`PHASE0-TASK03`、TASK05、TASK07 和 TASK08 保持历史 `DONE`，不得重复或改写。本任务不执行客户收款、Finance Settlement、银行、总账、税票或收入确认。

## 唯一业务链

```text
CLOSED/RELEASED FQC
  -> sales 创建发货指令
  -> warehouse 接收并分批执行
  -> Shipment Line 精确分配并消费 FQC Release
  -> 成品 Inventory Ledger/Balance 出库
  -> Sales Order 发货投影
  -> 唯一 Sales Financial Source
  -> finance 显式生成 AR
```

复用既有 Sales Order/Line、Shipment/Line/Reversal、TASK08 Completion→SO Allocation、Quality Inspection/Release、Inventory Ledger/Balance、Sales Financial Source 和 Finance Document AR。本任务不创建第二套发货、库存、金额来源、应收或结算模型。

## 已确认业务规则

1. sales 只能为有效 `OPEN/PARTIALLY_SHIPPED` Sales Order 创建关系化发货指令；指令行稳定引用 SO Line，并固化 Customer、Material、Unit、数量、收货信息和来源 digest。
2. 指令不得超过订单未发量，也不得超过未被其他有效指令占用的 FQC 可发额度。创建、提交、取消使用服务端权限、幂等、CAS、稳定锁顺序和数据库约束。
3. 指令本身不减少库存、不消费 FQC、不创建 Shipment、金额来源或 AR。warehouse 只能接收、退回或执行；已产生 Shipment 的指令不得取消或改写，未执行取消必须释放占用。
4. Shipment Line 必须通过稳定分配精确消费一个或多个 `CLOSED/RELEASED` FQC 来源；FQC 必须属于 TASK08 有效 Completion→SO Allocation，且 Customer、Product、Material、Unit 和 SO Line 一致。
5. 一个 FQC 可被多批 Shipment 消费，但累计不得超过 released quantity；并发发货不得重复消费。Shipment 全额冲销恢复原 FQC 可用量；已有 AR 时沿用 Finance 门禁 fail closed。
6. warehouse 执行发货必须在一个 PostgreSQL 事务内锁定 Instruction、SO/Lines、FQC Sources 和 Inventory Balance，复核订单、指令、FQC 和库存后原子创建 Shipment/Lines、Shipment→FQC Allocation、Ledger/Balance、SO/Instruction 投影、唯一 Sales Financial Source、Event/Audit/Idempotency。
7. 已过账 Shipment 不修改、不删除，只允许既有全额冲销；冲销原子恢复库存、SO、指令和 FQC 额度，并追加既有负金额来源。任何步骤失败不得留下半记录。
8. Shipment 只创建稳定正向销售金额来源，不自动创建 AR。金额由服务端按 `shipment quantity × SO unit price` 使用 PostgreSQL `numeric(24,6)` 计算；浏览器不得提交 Customer、Currency 或总金额。
9. finance 必须显式核对并消费每个正向 Shipment Source；每个来源最多一张 AR，Customer/Currency/Amount 只能继承来源。AR 事务失败不得影响已完成 Shipment，也不得留下半张 AR。
10. sales 创建、提交、取消指令；warehouse 接收、退回、执行和受控冲销；finance 读取来源并显式创建 AR；quality 只读消费状态；manager/admin 具备相应管理能力；其他越权写返回 403。

## 数据库、API、页面与 Dashboard

- `0023_sales_delivery_receivable.sql` 仅新增 Sales Delivery Instruction/Line、Instruction Event、Shipment Line→FQC Release Allocation 及必要投影、索引和直接 SQL guard。
- 不修改 `0001`—`0022`，不重复 Shipment、Inventory、Financial Source 或 Finance Document 权威表；同步 `db/schema.ts`、Drizzle journal 和 `0023_snapshot.json`。
- 页面至少为 `/sales/delivery`、`/warehouse/shipping`、`/finance/receivables`。
- Dashboard 按权限增加待仓库接收发货指令、FQC 已放行待发货、部分发货订单、已发货待生成 AR、AR 未结余额。

## 验收清单

- [x] TASK09 unit/UI、PostgreSQL/API、migration；空库、`0022→0023`、重复执行、失败回滚与约束
- [x] TASK08 业务链复现，发货指令创建零副作用
- [x] Shipment/FQC/库存/SO/Instruction/Source 两批 `4/6` 原子交接
- [x] finance 显式创建 AR `80/120`，Finance Settlement/客户收款为 0
- [x] 超订单、超指令、超库存、超 FQC、并发、幂等异正文、CAS、故障注入、403
- [x] 无 AR 冲销完整恢复；已有 AR 冲销阻止；FQC Reopen 消费门禁回归
- [x] TASK01—TASK08 与 Sales/Quality/Inventory/Finance/Dashboard 正式回归
- [x] 全部 typecheck、Schema consistency、lint/build、credentials scan、`git diff --check` 与 Python 临时库基线
- [x] `chenyida-erp-parallel` 实际多账号 HTTP、整体重启、停服备份/校验/新空库恢复
- [x] 最终 23 migrations、唯一启用管理员、业务/上传/附件为 0，仅保留既有三容器和四卷
- [x] 两个独立提交和最终报告

## 明确排除

客户收款、Finance Settlement、银行、支付网关、总账、税票、收入确认、外币/汇率、退货/换货、部分 Shipment 冲销、真实数据迁移、HTTPS、80/443、切流、生产部署、push 和 PR 均不属于本任务。完成后停止。
