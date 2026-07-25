# SELFHOST-PHASE3-TASK02 完成报告

## 交付

- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.12`，非生产、未发布。
- Migration：新增 expand-only `0014_migration_openings.sql`，SHA-256 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`；`0001`—`0013` 未修改。
- 模型：关系化 migration source、Inventory Opening/Line/Reversal、Finance Opening/Reversal；库存复用不可变 Ledger/Balance，财务复用 Document/Event/Settlement 投影。
- 服务：仅供受控测试迁移 CLI 使用的 `MigrationOpeningService`，绑定 manifest/source/mapping/target digest，并在同一事务写业务事实、审计和幂等结果。
- 展示：Finance Service 和 Dashboard 能读取/汇总 `OPENING_AR`、`OPENING_AP`，不新增 HTTP 写接口。

## 验收

专项、既有全域回归、空库/升级/失败回滚、direct SQL guard、并发、幂等、冲销、Compose 重启、停服备份/校验/新空库恢复、Python 隔离基线和安全扫描均通过。详细数字见 `docs/audits/SELFHOST-PHASE3-TASK02-synthetic-opening-report.md`。

## Git 与边界

可信父提交为 `2c808f7a2ba2c293ff22e5dcc3ca3647a479a91c`；独立提交消息为 `feat: add controlled migration opening balances`。提交哈希通过 `git log -1` 获取，文档不自引用尚未产生的哈希。

`MG-001` 与 `MG-002` 均为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。没有真实数据迁移或生产动作；最终结论保持 `NO-GO FOR REAL DATA / PRODUCTION`，任务完成后不自动开始下一任务。
