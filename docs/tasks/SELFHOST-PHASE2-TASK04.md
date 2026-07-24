# SELFHOST-PHASE2-TASK04：自托管不可变库存账本

状态：`DONE`（非生产实施、隔离验收完成；独立提交以本文件最近一次 Git 提交为准）

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（通过连续任务指令批准本任务范围与禁止事项）

## 1. 起始基线

- Branch：`main`。
- Task start HEAD：`3565d56f24ca904dd0b8d0c55960c702a8895406`。
- 起始工作区：clean；本地 `main` 领先 `origin/main` 4 个提交。
- 自托管版本：`chenyida-erp-selfhosted@0.1.0-alpha.3`，非生产、尚未发布。
- PostgreSQL migration：`0001`—`0007`；下一版本固定为 `0008_inventory_ledger.sql`。
- 根仓库没有 gitlink、submodule 或嵌套仓库。

## 2. 任务范围

- 新建稳定 `material_id`/`unit_id` 关系化库存余额、不可变库存流水、库存调整 Header/Line 与冲销关系。
- 支持通用库存入库、出库、盘点调整、冻结、解冻和全额冲销；它们不是采购收货、生产领退料、完工或销售发货单据。
- 新建独立 `inventory-selfhost/` Repository/Service/Handler；`selfhost-api.ts` 只做统一身份门禁与精确委托。
- 接通 `/api/inventory`、库存流水、库存调整查询、调整过账与冲销；legacy 调整页面只提交服务端稳定 Material ID。
- 库存余额是账本的事务投影，并提供逐余额账本汇总核对；BOM readiness 只读取已发布库存投影，不创建或修改库存。

## 3. 固定业务边界

- V1 只允许逻辑库位 `MAIN`，不启用批次、序列号、库位转移、预留写入或单位换算；请求携带其他库位/批次时 fail closed。
- 只有 `ACTIVE`、`STOCKED` 且配置启用基础单位的 Material 可以发生新库存业务；操作单位必须等于基础单位。
- `on_hand_qty >= 0`、`reserved_qty >= 0`、`frozen_qty >= 0` 且 `on_hand_qty >= reserved_qty + frozen_qty`。任何出库、冻结或冲销导致负库存/负可用量都拒绝。
- 入库/出库/冻结/解冻数量必须为正；盘点数量必须非负且必须产生非零差异。每条 Line 要求 `expected_balance_version`，不存在余额时固定为 `0`。
- 同一请求内余额按 `material_id/location/lot` 稳定顺序加锁；调整、账本、余额、审计和幂等结果在一个 PostgreSQL 事务提交或整体回滚。
- 已过账 Header、Line 和 Ledger 不允许 UPDATE/DELETE。更正只能对原调整做一次全额冲销，追加完全相反的账本；冲销本身不可再次冲销。
- `0001` 的 `inventory_balances`/`inventory_transactions` 文本编码表继续保留为 legacy 迁移证据，不是新权威，不自动回填、双写或由新 API 返回。

## 4. 权限、安全与验收

- `inventory.read`、`inventory.adjust`、`inventory.reverse` 分离；warehouse 执行调整/冲销，manager/admin 同样具备，其他业务角色只读。
- 写操作执行 Session/must-change、服务端权限、Origin/CSRF、256 KiB 正文、24 小时持久幂等、限流、request ID、CAS/行锁与成功/失败审计。
- 验收覆盖领域单元、legacy UI 契约、隔离 PostgreSQL/API、空库/0007 存量/重复 runner/失败回滚/约束/索引、并发、故障回滚、余额账本一致性、Compose smoke/restart 和全部适用回归。

## 5. 禁止事项

不迁移或回填真实库存；不实现采购订单/收货、工单/领退料/完工、销售发货、品质处置或财务来源；不实现负库存、直接余额修改、部分冲销、单位换算、批次/序列号或多库位；不访问生产、不部署、不 push、不创建 PR。

## 6. 实施与验收结论

- 新增 PostgreSQL `0008_inventory_ledger.sql`、Drizzle schema/snapshot/journal，以及独立 `inventory-selfhost` Repository/Service/Handler。
- legacy 库存页改用稳定 `material_id`、`unit_id` 和 `expected_balance_version`；BOM readiness 只读新权威余额投影并返回真实 shortage，不创建库存。
- 专项 unit 3/3、UI contract 2/2、PostgreSQL/API 3/3、migration 3/3、Compose 空库/重启通过；适用 Identity/Material/Mapping/Normalization/Review/Phase0/Python 回归通过。
- 旧导入 UI 的 6 条源码正则断言在未改动文件上仍失败，已作为起点既有测试债记录，不跨域修改；导入 parser/file-inspector/adaptive-supplier 49/49 通过。
- 版本递增为 `0.1.0-alpha.4`；没有真实数据迁移、生产访问、部署、push 或 PR。完整证据见完成报告。
