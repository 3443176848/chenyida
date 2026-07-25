# 自托管备份、校验与恢复

本流程只描述离线、受控操作。浏览器只显示最近一次去敏校验状态，不创建备份、不下载制品，也不执行恢复。TASK10 的验收只在隔离 PostgreSQL 和合成文件目录完成；生产执行仍需单独授权、恢复点和回退方案。

## 一致性边界

备份前必须停止 Web 与 Worker，使 PostgreSQL 和 `uploads`、`attachments` 处于同一维护窗口。脚本要求显式确认服务已停止，并把一致性写入 manifest。`pg_dump` 的数据库快照不能单独证明数据库与文件跨介质一致。

备份目录必须位于仓库和源文件目录之外，必须是尚不存在的新目录。输出包括：

- PostgreSQL custom-format `postgresql.dump`；
- `uploads.tar.gz` 与 `attachments.tar.gz`；
- `migrations.txt` 及当前数据库 migration checksum 对照；
- 含应用版本、Git 提交、工具版本、UTC 时间、大小和 SHA-256 的 `manifest.json`。

## 创建离线备份

```bash
ERP_ENV=test scripts/backup-selfhost.sh \
  --database-url "$DATABASE_URL" \
  --uploads /data/chenyida-erp/uploads \
  --attachments /data/chenyida-erp/attachments \
  --migrations ./drizzle-postgres \
  --output /backups/chenyida-erp-YYYYMMDDTHHMMSSZ \
  --app-version 0.1.0-alpha.10 \
  --git-commit "$FULL_GIT_COMMIT" \
  --confirm-services-stopped YES \
  --confirm NON_PRODUCTION_BACKUP
```

脚本拒绝 production 环境/疑似 production URL、符号链接源、已有输出目录、源目录内或仓库内输出、零字节制品以及数据库 migration 与当前源码不一致。成功只表示制品已创建，不能写成已校验或已演练恢复。

## 校验并发布只读状态

```bash
scripts/verify-backup-selfhost.sh \
  --backup /backups/chenyida-erp-YYYYMMDDTHHMMSSZ \
  --migrations ./drizzle-postgres \
  --status-output /data/chenyida-erp/backup-status/latest.json
```

校验会核对 manifest schema/status、文件名、大小、SHA-256、`pg_restore --list`、migration checksum，并拒绝 tar 绝对路径、`..` 路径、符号链接和硬链接。状态文件只包含有界去敏摘要，以原子替换和只读卷提供给 Web；不含数据库 URL、绝对备份路径、凭证或制品正文。`VERIFIED` 仍不等于恢复演练通过。

## 恢复到全新空的非生产目标

```bash
ERP_ENV=test scripts/restore-selfhost.sh \
  --database-url "$NEW_EMPTY_DATABASE_URL" \
  --backup /backups/chenyida-erp-YYYYMMDDTHHMMSSZ \
  --migrations ./drizzle-postgres \
  --uploads /restore/uploads \
  --attachments /restore/attachments \
  --confirm RESTORE_TO_NEW_EMPTY_NON_PRODUCTION_TARGET
```

恢复脚本先完整校验制品，只接受 public schema 无表的新数据库以及不存在或为空、且不是符号链接的文件目录。数据库使用 `pg_restore --single-transaction`；文件先解包到同父目录 staging，再原子移动。脚本不 drop、truncate 或覆盖当前运行目标。

恢复完成后仍必须离线核对 migration 数量/checksum、业务域记录数与汇总、孤儿引用、库存汇总、关键金额、文件 SHA、`/api/health`、管理员登录、Dashboard、Worker 新任务与 Web/Worker 重启持久性。全部通过并取得独立生产切换授权前不得开放流量。

## 故障域和保留

备份必须复制到与应用服务器/主数据库不同的故障域，并按批准的保留策略轮换。零字节文件、同库快照、仅有 checksum 校验或从未恢复过的制品都不能视为有效灾备。
