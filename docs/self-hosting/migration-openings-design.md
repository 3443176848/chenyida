# Migration Opening 0014 设计

## 关系模型

- `migration_opening_sources`：UUID 稳定 ID、run/manifest/source/mapping/target 摘要、opening type、cutoff、actor/request/operation；事实不可变且稳定来源唯一。
- `inventory_migration_openings` / `inventory_migration_opening_lines`：来源、期初 adjustment、Material/Base Unit/MAIN/空 lot、on-hand/frozen 与对应 Ledger。
- `inventory_migration_opening_reversals`：原期初唯一、反向 adjustment 唯一；状态由是否存在 reversal 投影。
- `finance_opening_sources`：AR/customer 或 AP/supplier 严格互斥、CNY、正数余额、会计日和 Finance Document。
- `finance_opening_reversals`：原财务期初唯一；Finance Document 投影进入 `REVERSED`。

## 数据库保护

新增表 INSERT 必须同时设置 `cyd.migration_opening_service_write=allowed`；UPDATE/DELETE 永远拒绝。库存 Balance 仍要求 Inventory Service GUC，Finance Document/Fact 仍要求 Finance Service GUC。0014 只做扩展，不回填、不启动时物化、不修改 0001—0013。

## 摘要与幂等

类型化 command 绑定 manifest、source record、mapping 与 target digest。稳定来源唯一键阻止重复；相同 operation/request 由唯一约束和 `idempotency_keys` 返回同一安全结果；任一摘要变化导致 command 校验失败或稳定来源冲突。
