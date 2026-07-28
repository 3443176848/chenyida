# SELFHOST-LANDING-TASK01 完成报告

## 结论

- 状态：`DONE / READY_FOR_OFFHOST_COPY`。
- 固定结论：`ALPHA.34 RECOVERY PACKAGE VERIFIED AND READY FOR OFFHOST COPY`。
- 仅在当前回环非生产服务器生成 root-only 灾备包；`offhost_copy_completed=false`，未 push、上传、scp、SFTP 或向任何外部目标传输。

## Git、版本与 Migration

- 起点为 `main` / `82e9f07ce1666ace2677853408c7fb4339808cfc`，clean，behind 0/ahead 76；`git fsck --full` 退出 0，只有历史 dangling objects，无损坏对象。
- 76 个本地提交全部可达；Phase 5 TASK01—TASK10 完成文档提交均是 HEAD 祖先；无 gitlink、`.gitmodules` 或嵌套 Git 仓库，`git archive HEAD` 可恢复全部 tracked 源码。
- 文档提交消息为 `ops: prepare alpha.34 disaster recovery package`，Parent 严格为起点；实际提交 SHA 由 `git log -1 -- docs/tasks/SELFHOST-LANDING-TASK01-COMPLETION.md` 解析。Bundle 必须在该提交之后创建，因此 Bundle SHA 只进入灾备目录，不回写仓库文档以避免循环改变 Bundle。
- 版本保持 `0.1.0-alpha.34`；34 个 PostgreSQL migration 按 `0001`—`0034` 排序，仓库 SHA 与 `schema_migrations.checksum` 全一致；0034 SHA 保持 `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`。

## 灾备工件

目录：`/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z`，root:root 0700；全部文件 root:root 0600。

- `postgresql-clean-0034.dump`：1,677,933 bytes，SHA-256 `72e8cbc6c3c4666b0e95dbcacf395787c5b520eb05a2bf3a8837ed4cfc68d702`，custom format，`pg_restore --list` 通过。
- `erp_uploads.tar`：10,240 bytes，SHA-256 `9344f054c1629102048959978b3f8cbacdda2c249a896473131d08328bec8360`；源 0 文件/0 bytes。
- `erp_attachments.tar`：10,240 bytes，SHA-256 `be920e3f8d18393b383b8e8b1dbc3c9ecf6b54442ca92985e04a7afb55c5caf8`；源 0 文件/0 bytes。
- `erp_backup_status.tar`：10,240 bytes，SHA-256 `12e104f6c006d3988f133a152af846553b59bd775c6e8f36a3551fd71480af5b`；源 1 文件/752 bytes。
- `chenyida-erp-alpha34.bundle` 的最终 size/SHA、最终文档提交、全部工件和 `offhost_copy_completed=false` 记录在 `MANIFEST.json` 与 `SHA256SUMS`。

## 恢复验证

- 数据库：固定新空库通过 `pg_restore --single-transaction` 恢复；210 张 public 表与主库一致，34 个 migration/checksum 一致，admin/setup/audit/session=`1/1/1/1`，Audit ID/时间及 Session 时间匹配；205 张非基线表、幂等、业务和文件元数据均为 0。未读取 token hash、密码哈希、请求正文或 Cookie。验证库已删除并证明不存在。
- 文件卷：三个 tar 均无绝对路径、`..`、hardlink 或 symlink；分别恢复后相对路径、文件计数/字节、SHA-256、uid/gid/mode/mtime 全一致，源摘要前后不变。root-only 临时恢复目录已删除，未创建临时 Docker Volume。
- Git Bundle：在文档提交后创建，`git bundle verify` 及新的 root-only 临时目录实际 clone 通过；clone HEAD、clean 状态、alpha.34、34 migrations、0034 SHA、TASK10/LANDING 文档由包内验证记录证明；临时 clone 已删除。
- `npm test` 3/3、`npm run lint` 0 error、`npm run security:credentials`、`docker compose config -q`、HTTP health、Git/diff、最终数据库安全计数和 `sha256sum -c SHA256SUMS` 均通过；未执行 build 或全量业务测试。

## 运行保护与未完成事项

任务期间 `COMPOSE_PARALLEL_LIMIT=1`，备份/恢复/测试严格串行；65 秒起点 Swap 增长 0，available memory、Swap、磁盘、Load 均未触发停止线。PostgreSQL/Web/Worker 最终 healthy/healthy/running，RestartCount 0、OOMKilled false、Build Cache 0B。四个受保护 ERP Volume 和 resource-guard 保留；Python PID `13737`/NRestarts 0，SQLite 仅核验 inode/size/mode/mtime且不变。

异机复制尚未完成。用户必须通过受控 scp/SFTP/VPN 下载整个目录，在异机目录运行 `sha256sum -c SHA256SUMS` 并返回结果；校验通过前不得把 `offhost_copy_completed` 视为 true，也不得删除服务器灾备目录。

未执行生产访问/迁移/部署、真实业务数据整理、Git push/PR、外部上传、Python/SQLite 操作、密码轮换、系统配置修改、build、通用 Docker prune 或后续业务任务。
