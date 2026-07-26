# SELFHOST-PHASE4-TASK08 — 生产过程检验、成品订单归属与 FQC 放行

## 状态与授权

- 状态：`DONE / PARALLEL ACCEPTED`
- 日期：2026-07-26（Asia/Shanghai）
- 授权：项目负责人已明确授权继续生产线，且本轮只执行 TASK08。
- 合法起点：`main` / `7d9c2dbaf62664e46c4f984822bb43903999f5fd`，工作区 clean，`origin/main...HEAD` behind 0/ahead 32。
- 依赖：`SELFHOST-PHASE4-TASK07`、既有 Quality/Production/Sales/Inventory/Identity 权威模块。
- 结论门槛：功能、迁移、隔离测试、真实 HTTP、Compose 重启、停服备份恢复和最终清理全部通过后，才能写入 `PRODUCTION QUALITY RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`。

`PHASE0-TASK03`、TASK06 和 TASK07 保持历史 `DONE`，不得重复或改写。本任务不实际发货，不创建销售金额来源、AR 或收款。

## 唯一业务链

```text
Production Report
  -> IPQC 检验、处置、关闭
Production Completion Line
  -> Sales 显式稳定分配到当前 Sales Order Line
  -> FQC 只能引用该分配
  -> 处置、关闭
  -> closed released FQC - effective shipped quantity
  -> 订单级可发货额度（本任务不创建 Shipment）
```

复用既有 `quality-selfhost` 的 Inspection/Result/Defect/Event、职责分离、Disposition、Close/Reopen 和 Sales Shipment FQC 门禁；复用 TASK07 Report/Completion/Reversal 与既有 Inventory/Sales 权威。本任务不创建第二套品质、生产、库存、销售订单或放行模型。

## 已确认业务规则

1. Completion Line→Sales Order Line Allocation 是 FQC 的唯一新来源。Sales Order 必须为当前 `OPEN/PARTIALLY_SHIPPED`；Customer、Product、Product Version、Finished Material、Unit 必须与 Work Order 一致；Completion 必须未冲销。
2. Allocation quantity 必须大于零；Completion 和 Sales Order Line 两侧累计有效分配均不得超量；同一 Completion Line/Sales Order Line 只能有一个有效分配；事务行锁、CAS、唯一约束和数据库 guard 防止并发超额。
3. Allocation 不修改 Inventory `reserved_qty`。未创建 FQC 时 sales 可受控取消；已有 FQC 后不可取消、改写或删除；Completion 存在有效 Allocation 时冲销 fail closed。
4. IPQC 只能绑定未冲销 Report；累计 inspected 不超过 Report reported quantity。`passed + failed = inspected`；failed 大于零时必须同时有 FAIL Result 和 Defect，无不良时禁止伪造 FAIL/Defect。
5. IPQC Inspection/Result/Defect/Event 和来源事实不可修改或删除。创建人不能执行最终处置。IPQC 不修改 Work Order、Report、Completion 或库存，不自动触发返工、补料、报废或 FQC。
6. FQC 只能绑定有效 Allocation ID，浏览器不得自由组合 Completion Line/Sales Order Line；累计 inspected 不得超过 Allocation quantity。
7. `RELEASE` 最多放行 passed；`CONCESSION` 最多放行 inspected 且必须保留明确原因；`REWORK`/`SCRAP` 保持 HOLD。创建人与最终处置人必须不同；关闭前必须完成处置。
8. 只有 CLOSED/RELEASED 数量形成订单级额度；可用量为 closed released FQC 减有效 Shipment。浏览器不得提交累计 released/shipped 投影。被有效 Shipment 消费的放行不得重开、降低或撤销。
9. sales 创建/取消分配；quality 创建 IPQC/FQC、Result、Defect、Close；manager/admin 处置和必要 Reopen；production/warehouse 只读各自合法来源。其他无权限角色写入返回 403。
10. 所有关键写继续执行 Session/must-change、CSRF、正文上限、速率限制、24 小时持久幂等、CAS、稳定锁顺序、中文安全错误、request_id、数据库 guard、事务 Event/Audit 和故障回滚。

## 数据库与版本

- 版本：`0.1.0-alpha.21` → `0.1.0-alpha.22`
- 仅新增：`drizzle-postgres/0022_production_quality_release.sql`
- 最小扩展：Completion Line→Sales Order Line Allocation、状态与不可变事件、Quality Inspection 对 Allocation 的稳定兼容引用、必要唯一/索引/数据库 guard。
- `0001`—`0021` 不修改；同步 Drizzle Schema、journal 和 `0022_snapshot.json`。
- 覆盖空库、`0021→0022`、重复执行、失败事务回滚、历史 Quality Inspection 兼容与 SHA-256。

## API、页面与 Dashboard

- API：Allocation 候选/列表/详情/创建/取消；IPQC/FQC 来源；既有 Inspection/Result/Defect/Disposition/Close/Reopen；订单行 FQC Eligibility。
- 页面：`/sales/finished-goods-allocation`、`/quality/production`，真实调用自托管 API 并处理 loading、empty、403、CAS、幂等结果未知和冲突。
- Dashboard：按权限裁剪待 IPQC 报工、已完工待订单分配、待 FQC 成品、HOLD 数量、已放行待发货数量。

## 验收清单

- [x] 源码实现、Drizzle 元数据和版本升级
- [x] TASK08 unit/UI/PostgreSQL/API/migration
- [x] TASK07 真实 4/6 链、Allocation 4/6、IPQC 4/6、FQC 4/6、released 10
- [x] 成品库存保持 10；Shipment、Sales Financial Source、AR 均为 0
- [x] 来源一致性、超分配/超检、并发、职责分离、幂等、CAS、故障回滚、403 和下游门禁
- [x] TASK01—TASK07 与 Production/Quality/Sales/Inventory/Dashboard 正式回归
- [x] Compose 整体重启、停服备份/校验/新空恢复
- [x] 最终 22 migrations、唯一启用管理员、业务/上传/附件为 0，仅保留既有三容器和四卷
- [x] 两个独立提交和最终报告

## 明确排除

Shipment、成品库存减少、销售金额来源、AR、收款、IQC 池化库存隔离、批次/序列、隔离库位、AQL/SPC、返工工艺、报废库存过账、真实数据迁移、HTTPS、80/443、切流、生产部署、push 和 PR 均不属于本任务。完成后停止。
