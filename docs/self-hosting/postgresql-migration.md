# PostgreSQL 迁移说明

`chenyida_erp_site/drizzle-postgres/0001_selfhost_baseline.sql` 是新的自托管空库 baseline，共 46 张表：45 张现有业务/治理结构加 `background_jobs`。它不是旧 D1 `0000`～`0008` 的机械翻译，也不代表那些 migration 已在 PostgreSQL 执行。

主要类型决策：主业务行使用 `bigserial/bigint` 保持既有数值 ID API；任务、请求、操作和租约使用 UUID；时间使用 `timestamp with time zone`；开关使用 boolean；结构化快照使用 JSONB；数量和价格使用明确精度 numeric；状态、version、唯一性、外键和高频队列查询使用 check/index/unique/FK。

执行：

```bash
docker compose -f compose.yml run --rm migrate
```

脚本持有 PostgreSQL advisory lock、记录 SHA-256 checksum、单 migration transaction 执行并可重复运行。已执行文件若被修改会 fail closed。`ERP_ENV=production` 时还必须显式提供 `ERP_ALLOW_PRODUCTION_MIGRATION=YES`；生产执行本身仍需另行授权、快照和维护窗口。

旧 SQLite/D1 数据迁移不在本任务内。后续必须按扩展、回填、切换、收缩执行，并核对用户、分类、物料、版本、重复、孤儿、导入批次、库存数量和审计链；不得把旧 ID 或 JSON 直接无校验灌入 baseline。
