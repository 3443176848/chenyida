# SELFHOST-PHASE2-TASK09：自托管应收应付、收付款、余额与冲销

状态：`DONE`（非生产；未发布、未部署、未迁真实数据）

开始日期：2026-07-25（Asia/Shanghai）

## 起始基线

- Branch `main`；Task start HEAD `ee3e6585d5f0366187f62ef3f6012c3abaf28150`（`feat: add self-hosted quality management`），工作区 clean，本地相对 `origin/main +9/-0`。
- 包版本 `0.1.0-alpha.8`；PostgreSQL `0001`—`0012`，下一合法 migration 为 `0013_finance.sql`；`0012` SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`。

## 权威来源与业务边界

- AR 只能从 TASK07 `sales_financial_source_entries` 的正向 Shipment 来源创建；AP 只能从 TASK05 `purchase_financial_source_entries` 的正向 Receipt 来源创建。SO/PO 头、名称和浏览器金额不是过账来源。
- 每个正向来源最多一张财务单据；币种和金额原样继承来源，首期不换汇。金额统一 PostgreSQL `numeric(24,6)`。
- 财务单据保存稳定 Customer/Supplier、来源、原始金额、已结投影、状态和 optimistic version；收款/付款/冲销为不可变追加事实与事件。
- 对已有结算或财务单据的销售/采购来源，不允许在上游再做会令财务依据失效的冲销；必须先按财务规则处理，无法证明安全时 fail closed。

## 安全和首期规则

- 固定 `OPEN -> PARTIALLY_SETTLED -> SETTLED`；收付款不得超过未结余额。冲销只允许对原收付款一次全额反向，恢复单据投影；原单据和原收付款不可 UPDATE/DELETE。
- admin/manager/finance 可制单、结算和冲销；创建人不得审批自己的付款不在当前单步模型中伪造为已实现，后续多节点审批另立任务。其他角色只读其业务需要的财务摘要/单据。
- 写接口执行 Session/must-change、CSRF、256 KiB、输入校验、24h 幂等、expected version、限流、请求编号、中文安全错误和事务审计。

## 验收与禁止事项

- 覆盖 AR/AP 稳定来源、精度、重复来源、部分/全部结清、超额、并发结算、冲销、汇总核对、幂等/CAS、故障回滚、legacy UI、migration、Compose restart 和适用回归。
- 不迁真实金额，不读生产财务数据，不接银行、税务、发票、汇率、信用、关账、会计期间锁或总账，不自动过账，不部署、不 push、不创建 PR；TASK09 完成前不创建 TASK10 代码或 migration。

## 完成结果

- PostgreSQL `0013_finance.sql` 新增关系化 AR/AP Document、不可变 Settlement/Reversal 与 append-only Event；Header 只保存可核对余额/状态/version 投影。
- Finance Repository/Service/Handler、legacy 兼容 UI/API、固定权限、CSRF、256 KiB、24h 幂等、限流、expected version、请求编号和事务审计已实现。
- 专项 unit/UI 4/4、PostgreSQL/API 3/3、migration 3/3；Compose 首次与 Web/Worker 重启持久性、采购 7/7、销售 3/3、品质 8/8 及基础安全/构建/Python 回归通过。
- Migration SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1`；包版本 `0.1.0-alpha.9`。所有隔离 PostgreSQL/Compose/临时 SQLite 资源已清理。
