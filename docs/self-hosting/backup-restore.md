# 备份与恢复

## 一致性

最佳做法是在短维护窗口停止 Web/Worker 后备份，使 PostgreSQL 元数据和文件目录处于同一业务时间点。若不停写，`pg_dump` 自身是数据库一致快照，但它与文件 tar 的时间点不同；恢复后必须运行文件引用核对，不能宣称跨介质强一致。

容器内可使用 PostgreSQL 17 客户端运行：

```bash
scripts/backup-selfhost.sh \
  --database-url "$DATABASE_URL" \
  --uploads /data/chenyida-erp/uploads \
  --attachments /data/chenyida-erp/attachments \
  --output /backups/chenyida-erp-YYYYMMDDTHHMMSSZ
```

输出包含 custom-format `postgresql.dump`、两个 tar、UTC 时间和 SHA-256。脚本拒绝复用现有输出目录，不删除源数据。备份应复制到与服务器不同的故障域并定期恢复演练。

恢复必须使用全新空数据库和空文件目录，并显式确认：

```bash
scripts/restore-selfhost.sh \
  --database-url "$EMPTY_DATABASE_URL" \
  --backup /backups/chenyida-erp-YYYYMMDDTHHMMSSZ \
  --uploads /restore/uploads \
  --attachments /restore/attachments \
  --confirm RESTORE_TO_EMPTY_TARGET
```

脚本先核验 checksum，拒绝非空数据库/目录，不 drop、不 truncate、不覆盖。恢复后执行 migration checksum、`/api/health`、管理员登录、分类/草稿读取、文件 SHA/存在性、任务状态和 Worker 新任务冒烟；通过前不要开放流量。
