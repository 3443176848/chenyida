# SELFHOST-PHASE4-TASK05 — 定标到采购订单、仓库收货及财务应付交接

## 状态与边界

- 状态：`DOING`
- 起始提交：`990279a5ff30a7ee4a23d2cb5b2c3142e1b81374`
- 目标版本：`0.1.0-alpha.19`
- 唯一新增迁移：`0019_sourcing_purchase_fulfillment.sql`
- 运行面：`chenyida_erp_site/` 自托管非生产方向与现有 `chenyida-erp-parallel`
- 明确排除：工单、领料、报工、完工、IQC/IPQC/FQC、付款、银行流水、总账、税票、生产部署、真实数据迁移与切流。

## 现状诊断

### 可复用权威能力

1. `0018_procurement_sourcing.sql` 与 `procurement-sourcing-selfhost` 已提供不可变 RFQ/报价版本、服务端确定性比较、人工 Award、Award version/CAS、幂等、审计及冲销事件；Award 目前不会自动创建 PO。
2. `ProcurementService` 已在一个 PostgreSQL 事务内创建 Receipt/Receipt Lines、更新 PO 数量与状态、调用 `InventoryService` 写不可变 Ledger/Balance、创建 purchase financial source，并写事件、审计和幂等结果。
3. `InventoryService` 已提供带 expected balance version 的受控过账与全额反向流水；Ledger 不原地修改，Balance 为事务内投影。
4. `FinanceService` 已提供财务人员显式从 purchase financial source 创建 AP、同一正向来源只消费一次、幂等/CAS/审计，以及下游财务单据存在时阻止采购来源冲销的数据库门禁。
5. 现有原生 Procurement、Inventory、Finance 和 Dashboard 页面/API 已有十角色服务端授权与稳定错误响应规范。

### 缺口

1. Award Line 与 PO Line 尚无稳定来源关系，现有 PO 来源约束不接受 `SOURCING_AWARD`。
2. 尚无关系化的行级到货计划、待入库队列、计划状态事件，以及 Receipt Line 到计划的分配关系。
3. Award 冲销尚未检查已生成 PO；Receipt 冲销尚未同步回退到货计划投影。
4. 尚无采购显式转单、仓库从待入库队列分批收货、财务待 AP 队列对应的 TASK05 原生操作面。
5. Dashboard 尚不能清楚区分“已收货待生成应付”和“已生成应付”。

## 实施决定

1. 不建立第二套采购、库存或财务核心：TASK05 新服务只负责编排，并在同一连接/事务内调用现有 `ProcurementService`、`InventoryService` 和既有 Finance API。
2. Award 转单必须由采购人员显式触发；按 `supplier_id + currency` 确定性分组，组内按 Award Line ID 排序；不同币种绝不混入同一 PO。
3. 每个 Award Line 只映射一个 PO Line；数据库唯一约束、行锁、CAS 和持久幂等共同保证并发时只有一个结果。
4. 每个 PO Line 建立一个权威到货计划；计划保存承诺日期和数量投影，待入库表只保存队列生命周期，不复制数量权威。
5. 到货计划创建不创建 Receipt、库存流水或财务来源；仓库收货才在单一事务中完成全部联动。
6. 分批收货金额沿用现有 Procurement 金额计算规则，等于收货行数量乘 PO 行单价；财务仍必须显式消费每笔来源创建 AP。
7. 已过账 Receipt 只允许既有全额冲销；TASK05 编排在同一事务回退计划、队列和来源链。若来源已有 AP，则沿用数据库门禁并映射稳定错误码。
8. 逾期为服务端查询时派生状态：未完成计划且承诺日期早于当前日期；不维护会漂移的第二个逾期布尔权威。

## 验收模型

- Award：数量 `10`、单价 `12`、供应商 A。
- 显式转 PO 后创建计划 `10`，此时 Receipt/Ledger/AP 均为 `0`。
- 首收 `4`：计划 `PARTIAL`，库存 `4`，purchase source `48`；财务显式生成 AP `48`。
- 次收 `6`：计划 `COMPLETED`，PO 完整收货，库存累计 `10`，第二来源 `72`；财务显式生成 AP `72`。
- 最终 AP 合计 `120`，全链路可从 Award Line 追溯到 PO Line、计划、Receipt Line、Ledger、purchase source 与 AP。

## 验收门禁

专项测试覆盖迁移、空库与 `0018→0019`、约束、幂等异正文、CAS、并发唯一转单、超收、故障回滚、权限、页面和真实 HTTP 旅程。完成后还须运行 TASK01—TASK04、Identity、Master Data、Supplier Mapping、Procurement、Inventory、Finance、Dashboard、正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 基线、Compose 重启、停服备份与新空库恢复。最终并行数据库只保留 19 个 migration、唯一启用管理员和零业务数据。
