# SELFHOST-PHASE4-TASK07 — 生产报工、分批完工与成品入库交接

## 状态与授权

- 状态：`DONE`
- 日期：2026-07-26（Asia/Shanghai）
- 授权：项目负责人已明确授权继续生产线，且本轮仅执行 TASK07。
- 合法起点：`main` / `26ccb95782478645720c8284c59b0afadca68649`，工作区 clean，`origin/main...HEAD` behind 0/ahead 30。
- 依赖：`SELFHOST-PHASE4-TASK06`、既有 Production/Inventory/Identity/Quality/Sales 权威模块。
- 结论门槛：功能、迁移、隔离测试、真实 HTTP、Compose 重启、备份恢复和最终清理全部通过后，才能写入 `PRODUCTION REPORTING AND FINISHED GOODS RECEIPT ACCEPTED IN PARALLEL ENVIRONMENT`。

`b45616e` 是保留历史，不回退、不改写、不重复执行 `PHASE0-TASK03`。品质检验、销售发货和财务过账不属于本任务。

## 唯一业务链

```text
TASK06 已完整领料的 RELEASED/IN_PROGRESS Work Order
  -> production 分批追加 Report
  -> Report 未消费 good quantity
  -> warehouse 显式分批 Completion
  -> Report→Completion Allocation
  -> 成品 Inventory Ledger/Balance
  -> Work Order COMPLETED（不自动 CLOSED）
```

复用既有 `production_work_orders`、`production_reports`、`production_completions`、BOM Snapshot/Material Requirement、TASK06 Handoff/Reservation/Issue 以及 Inventory Ledger/Balance。本任务不创建第二套生产或库存权威。

## 已确认业务规则

1. Report 只允许 RELEASED/IN_PROGRESS 工单，事实 append-only；reported > 0，good/scrap >= 0，good+scrap <= reported，累计 reported 不超过 planned。
2. 报工支持量在 PostgreSQL numeric 中按 BOM Snapshot 与净领料计算；累计 reported 不得超过所有需求行共同支持的生产数量。浏览器不得提交累计投影，Report 不修改库存、不创建 IPQC/FQC。
3. Completion 必须显式分配一个或多个 Report 的未消费 good quantity；累计分配不得超过 Report good、工单 planned 剩余量，scrap 永不入库。
4. warehouse Completion 在单一事务写 Completion/Line、Allocation、成品 Ledger/Balance、Work Order 投影/状态、Event、Audit 和 Idempotency；校验 Work Order、Report、Balance expected version并按稳定顺序加锁。
5. completed_qty 等于 planned_qty 时进入 COMPLETED，否则保持 IN_PROGRESS；不自动 CLOSED，不创建品质、Shipment、销售金额来源、AR/AP。
6. Report 全额冲销只允许尚未被 Completion 消费且无 IPQC 等下游引用；追加 reversal fact/event 并原子恢复报工投影，原事实不改写。
7. Completion 全额冲销只允许无 FQC、Shipment 或其他下游消费且当前成品库存可安全反向；追加 reversal Completion/Allocation，通过 Inventory Service 写反向 Ledger，并恢复 Report 可用量与 Work Order 投影/状态。
8. 无法证明安全一律 fail closed；不得用通用库存调整冒充生产完工冲销。
9. production 创建/按授权冲销 Report；warehouse 创建/冲销 Completion；manager/admin 具备管理能力；其他角色不得写。quality 只读合法来源。
10. 全部写接口继续执行 Session/must-change、CSRF、正文上限、速率限制、持久幂等、CAS、安全中文错误、request_id、事务 Audit 和故障回滚。

## 数据库与版本

- 版本：`0.1.0-alpha.20` → `0.1.0-alpha.21`
- 仅新增：`drizzle-postgres/0021_production_reporting_completions.sql`
- 最小扩展：Report→Completion Allocation、Report reversal、Completion reversal、必要的事件/version/投影约束和数据库不可变 guard。
- `0001`—`0020` 不修改；同步 Drizzle Schema、journal 和 `0021_snapshot.json`。
- 覆盖空库、`0020→0021`、重复执行、失败事务回滚、历史 Report/Completion 兼容与 SHA-256。

## API、页面与 Dashboard

- API：Report 创建/详情/全额冲销；待入库良品；Completion 创建/详情/全额冲销；Work Order 进度。
- 页面：`/production/reporting`、`/warehouse/production-completions`；扩展 `/production/work-orders`。
- Dashboard：按权限裁剪待报工工单、已报工待入库良品、部分完工工单、已完成待品质处理数量；最后一项只读提示，不创建 FQC。

## 验收清单

- [x] 源码实现、Drizzle 元数据和版本升级
- [x] TASK07 unit/UI/PostgreSQL/API/migration
- [x] 两批 Report `4/6` 与两批 Completion `4/6`，成品 Ledger/Balance 合计 `10`
- [x] 领料支持量、good/scrap、Report 消费、工单剩余、并发、幂等、CAS、故障注入、403 与 scrap 零库存
- [x] Report/Completion 安全全额冲销及 IPQC/FQC/Shipment 下游门禁
- [x] TASK01—TASK06、Production、Inventory、Quality、Sales、Dashboard 及正式全回归
- [x] 并行真实账号 HTTP、Compose 整体重启、停服备份/校验/新空恢复
- [x] 最终 21 migrations、唯一启用管理员、业务/上传/附件为 0，仅保留既有四卷
- [x] 两个独立提交和最终报告

## 明确排除

工艺路线、工位、设备、班次、WIP、OEE、工时成本、补料、返工工艺、IQC/IPQC/FQC 创建、销售发货、财务、真实数据迁移、HTTPS、80/443、切流、生产部署、push 和 PR 均不属于本任务。完成后停止。
