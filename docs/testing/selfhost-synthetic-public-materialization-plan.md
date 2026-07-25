# TASK03 合成 public 物化与全域核对计划

1. 单元：plan/dispatcher/checkpoint、实际 ID map、target digest、上下游 BLOCKED、code/orphan/unit/manifest 冲突、文件路径/SHA/MIME、production/remote/真实路径拒绝。
2. PostgreSQL：dry-run public 零写、snapshot 成功、每聚合故障回滚、Opening、重放、中断恢复、不同 manifest/非空目标拒绝、`erp_records` 零写。
3. 全域 journey：正常 Service/API 建立采购、生产、销售、IQC/IPQC/FQC、稳定来源 AR/AP、结算/冲销；逐域核对数量、金额、状态、库存 Ledger/Balance 和质量门禁。
4. API/Dashboard：`/api/summary`、`/api/management-dashboard`、`/api/finance-summary`、六域列表/详情、权限裁剪、23 legacy GET。
5. 文件/恢复：原子写、重放、missing/mismatch 阻断；停 Web/Worker 后 backup/verify，恢复到第二个新空目标，核对 14 migrations、public facts、ID map/provenance 和文件 SHA。
6. 重启与回归：PostgreSQL/Web/Worker 整体重启、同 manifest 重放无重复、restore 后 reconcile；全量 unit/UI/PG/upgrade/typecheck/lint/test/build/schema/credentials/environment/Python/diff。

所有运行资源均使用独立 Compose project、回环 `_migration_test` 数据库和 `mktemp` 目录；完成后只清理 TASK03 创建的资源。
