# 合成业务表物化设计

## 边界

`tools/selfhost-migration/materializer/` 是 Web 启动路径之外的离线受控模块。调用链为：

`validated plan -> guarded dispatcher -> aggregate transaction -> public business row -> actual target ID/provenance -> checkpoint -> reconciliation`

浏览器没有写路由，普通 admin 没有 migration capability。模块只接受已通过 TASK01 validator、manifest 摘要绑定并已写 staging 的同一 migration run。

## 模块

- `types/errors/plan`：模式、领域、命令和稳定错误。
- `dispatcher/transaction`：依赖顺序、每聚合事务、故障注入和 fail-closed。
- `domain-materializers`：identity/reference/material/master-data/product/BOM/mapping/opening/file。
- `target-id-map/provenance`：将 staging UUID 映射更新为实际 public table + bigint/username stable key，并保存 source/target digest、request/operation/time；不保存正文。
- `checkpoint`：按领域绑定 manifest/source/mapping/plan/target digest，成功后原子写文件 checkpoint。
- `reconciliation/report`：确认目标存在、target digest 未漂移、public 数量/Opening/文件 SHA/`erp_records` 零新增。

## 领域事务

Identity、每个 Unit/Category/Material、每个 Customer/Supplier、Product 聚合、Supplier Mapping、BOM 聚合、每条 Opening、每个 File 都是独立事务。业务记录、audit/provenance 和 actual target ID 更新在同一数据库事务提交；文件使用临时文件、fsync/rename 原子写，数据库 provenance 只在 checksum/size 复核后提交。

Product 聚合包含 Header + Version；BOM 聚合包含 Header + Version + Lines 并以 RELEASED 状态结束。Material/Unit/Category、Customer/Supplier、Mapping 和 BOM 全部重查稳定 code 与显式 ID map；同名不合并。发布后不可变规则继续由数据库约束/trigger 保护。

Inventory/Finance Opening 复用 TASK02 `MigrationOpeningService`，不直接改 Balance、Ledger 或 Finance Document。采购、生产、销售、品质和稳定来源财务不由 snapshot materializer 插表，而由 cutover 后正常 Service/API 创建。

## 空目标与重放

首次 materialize 要求 public 除 `schema_migrations` 外无业务行；受控 setup admin 可以在 snapshot 之前通过正常 Identity setup 创建，并被 manifest/run 明确登记。恢复只允许同 manifest、同 run、同 input digest 和同 checkpoint；不同 manifest 或 source digest 在已有目标上 fail closed。

actual target digest 由业务表固定字段与稳定外键计算。Reconcile 重新读取 public 行；缺行或 digest 漂移立即失败。`migration_tool` 仅保存执行证据，Dashboard 永远只查询 public 权威表。
