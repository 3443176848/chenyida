# SELFHOST-PHASE3-TASK01 合成试迁移验收计划

## Fixture 组

- `valid`：固定十角色 allowlist 内的 disabled 管理员计划、Unit/Category/Material、客户/供应商/客户专用产品、Supplier Mapping、Released BOM、正库存、PO部分收货、WO部分完工、SO部分发货、IQC/IPQC/FQC、稳定来源 AR/AP 与部分结算、匹配的文件 checksum 元数据。
- `reviewable`：同名不同 Material code，保留确定 source identity 且不自动合并。
- `blocked`：未知角色、重复 Material code、orphan BOM line、负库存、缺 Unit、未知状态、超过六位精度、币种不一致、附件 SHA 错误。
- `resume`：在指定 domain/chunk 注入中断并恢复。
- `repeat`：同一 snapshot 重复 dry-run/commit；随后分别改变 source digest 和 mapping digest。

所有 fixture 只使用 `mktemp` 或平台临时目录生成，名称、人员、料号、电话和金额均完全虚构；fixture 文件和迁移结果不提交 Git。

## 测试矩阵

1. 纯单元：environment guard、manifest、fingerprint、registry、ID map、checkpoint、normalizer、validator、planner、reconciliation/report。
2. Adapter：临时 SQLite、临时 D1 JSON export、回环 `_migration_test` PostgreSQL；验证 inspect 只读、dry-run 目标零写、非空目标拒绝。
3. 合成 E2E：空 PostgreSQL 17 应用 `0001`—`0013`；valid commit/reconcile；blocked fail closed；重复执行与中断恢复。
4. 数量/金额：库存 source=staging；PO/Receipt、WO/Completion、SO/Shipment 数量链；稳定来源 AR/AP/Settlement。public 业务表与 Dashboard 明细属于后续准入，不由 staging 聚合冒充。
5. 恢复：合成目标 backup→第二个新空 `_migration_test` 目标，文件 SHA/计数/外键/重启持久性复核。
6. 全回归：lint、npm test、TASK02—TASK10 unit/UI、PostgreSQL/API、migration upgrade、typecheck、build、schema consistency、credentials、environment、Compose、backup/restore、Python self-test/smoke/临时 SQLite go-live、`git diff --check`。

## 结果分级

- `PASS`：无 blocker/conflict/orphan/model gap，全部核对一致。
- `PASS_WITH_REVIEW`：只有不影响引用完整性的明确人工项。
- `BLOCKED`：存在负数、重复稳定键、孤儿、未知状态/角色、精度或模型缺口。
- `FAILED`：工具/连接/事务/核对异常。
