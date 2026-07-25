# Migration Opening 内部运行手册

1. 仅在 `ERP_ENV=test`、回环 PostgreSQL、库名含 `_migration_test`、全新且已由迁移工具标记的目标执行。
2. 先执行 inspect/validate/plan/dry-run；dry-run 不连接业务写入口且业务表零写入。
3. commit 显式创建固定测试 migration actor 与所需虚构引用，再逐条调用内部 opening service；不得从 staging 触发数据库函数自动物化。
4. 失败按 checkpoint 恢复；稳定来源和 operation 幂等键保证不重复 Ledger/Finance Document。
5. 库存冲销前锁原 opening、Balance 与 Ledger；余额已被下游消耗时停止。财务冲销前锁 document 与 settlements；有效收付款未冲销时停止。
6. 完成后核对来源、Ledger、Balance、Finance Documents/Events、Dashboard 与审计，清理临时容器、网络、卷和目录。

此手册不是生产操作授权。真实源、生产目标、远程连接或生产模式一律 fail closed。
