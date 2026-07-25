# 自托管合成迁移 CLI Runbook

## 范围

该 CLI 只用于 `ERP_ENV=test`、操作系统临时目录和回环 `_migration_test` PostgreSQL。它不支持真实数据、生产连接或 Web/API 自动触发；所有运行必须显式 `--confirm SYNTHETIC_MIGRATION_ONLY`。

## 前置条件

1. 使用 `mktemp -d --suffix=_migration_test` 建立 source、workspace 和空 file target；不要使用仓库、备份、上传、附件或归档目录。
2. 创建全新数据库，名称必须包含 `_migration_test`；只绑定 `127.0.0.1/localhost/::1`。
3. 使用既有 `scripts/migrate-postgres.ts` 将空目标升级到 `0001`—`0013`；不得存在任何业务行。
4. 使用 fixture CLI 生成合成 SQLite 或 D1 JSON export，不复制真实样本。

示例（占位参数不可直接用于生产）：

```bash
ERP_ENV=test node scripts/selfhost-migration-fixture.mjs \
  --output /tmp/example_migration_test/source --kind valid --format sqlite

ERP_ENV=test node tools/selfhost-migration/cli.mjs \
  --source-kind sqlite \
  --source /tmp/example_migration_test/source/valid.sqlite3 \
  --workspace /tmp/example_migration_test/work \
  --file-target /tmp/example_migration_test/files \
  --database-url postgresql://test_user:test_password@127.0.0.1/example_migration_test \
  --mode dry-run \
  --confirm SYNTHETIC_MIGRATION_ONLY
```

`synthetic-commit` 只写目标的独立 `migration_tool` schema，用来证明 manifest/ID map/checkpoint/关系/幂等/核对；不把合成事实写入业务权威表，不代表生产 materialization 已获批准。

## 恢复与重复执行

中断后使用相同 source、workspace、database、run ID 和 mapping 版本重跑；CLI 校验 checkpoint digest 后从最近完成 domain 继续。source snapshot、mapping/normalization、目标 migration 或 plan digest 任一变化会返回 `CHECKPOINT_STALE`，必须建立新 workspace 和新 run。

同一 snapshot 重复 commit 使用确定性 target ID 与 source digest，不重复创建；相同 stable key 的 source digest 改变会返回 `MIGRATION_SOURCE_CHANGED`，不会覆盖目标。

## 输出与清理

stdout 只有 run/state/grade/安全计数；workspace 仅有安全 manifest、checkpoint 和聚合 report，不含业务行、连接串或个人信息。完成后停止并删除本任务创建的容器、网络、卷、临时数据库和临时目录。不得提交任何 `.sqlite/.sqlite3/.db`、dump、backup、report 运行产物或合成文件。
