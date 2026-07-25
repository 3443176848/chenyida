# SELFHOST-PHASE3-TASK02：库存与财务期初来源及迁移物化安全边界

状态：`DONE`

开始日期：2026-07-25（Asia/Shanghai）

完成日期：2026-07-25（Asia/Shanghai）

## 可信起点

- `main` / `2c808f7a2ba2c293ff22e5dcc3ca3647a479a91c`，工作区 clean，相对 `origin/main` ahead 13 / behind 0。
- 版本 `0.1.0-alpha.11`；PostgreSQL migration `0001`—`0013` 校验和与发布台账一致。
- Python systemd 仅只读核验，PID `277640`；无运行中的 ERP Compose 项目。

## 唯一范围

仅解决 TASK01 的 MG-001（无 Shipment/Receipt 的 AR/AP 期初）和 MG-002（余额型库存期初物化）。新增 `0014_migration_openings.sql`、不可变关系来源、库存/财务期初及全额冲销、只可由测试迁移 CLI 调用的内部事务入口，并让合成 commit 写正式期初业务表。

不实施真实数据盘点、真实试迁移、身份/附件迁移、全域业务表物化、部署、切流、push 或 PR。

## 安全边界

- 只允许即时生成的合成 SQLite/D1 export、临时 PostgreSQL、隔离 Compose 和虚构主数据。
- 源路径与目标连接守卫必须先于任何源读取或数据库连接；拒绝 production、远程 PostgreSQL、非 `_migration_test` 数据库、仓库/备份/上传/附件/归档路径、非空或未受控目标。
- 浏览器、legacy API 和普通 admin 均无期初写路由；内部 actor 固定为 `migration_opening_actor`。
- staging 只保存证据；Ledger 与 Finance Document 是正式业务事实，不从 staging 自动物化。

## 验收

完成关系约束、直接 SQL guard、同事务 Ledger/Balance/Opening/Audit/Idempotency、Finance Document/Event/Opening/Audit/Idempotency、全额冲销、摘要失效和恢复幂等专项测试；运行 migration、PostgreSQL、Compose、既有业务回归、build/lint/typecheck、backup/restore、Python 隔离基线及安全扫描。

交付版本为 `0.1.0-alpha.12`，独立提交消息为 `feat: add controlled migration opening balances`，父提交必须为上述可信起点。MG-001/MG-002 只能标记 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`；最终仍为 `NO-GO FOR REAL DATA / PRODUCTION`。

## 完成结论

- `MG-001`：`RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。
- `MG-002`：`RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。
- 真实数据与生产：`NO-GO FOR REAL DATA / PRODUCTION`。
- 实施、专项/全量回归、隔离 Compose 重启、停服备份及新空库恢复均通过；没有读取或写入真实业务数据，没有重启 Python systemd、部署、push 或创建 PR。
