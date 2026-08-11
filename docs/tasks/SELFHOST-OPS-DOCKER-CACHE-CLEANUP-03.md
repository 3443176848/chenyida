# SELFHOST-OPS-DOCKER-CACHE-CLEANUP-03 受控 Docker 空间清理

## 授权与目标

- 项目负责人于 2026-08-11 在收到只读磁盘归因后明确回复“同意”，授权本任务执行受控 Docker 空间清理。
- 目标是将根分区可用空间从约 17 GiB 恢复到至少 30 GiB，同时保持当前非生产 UAT、数据卷、备份和恢复锚点不变。
- 本任务只处理 Docker BuildKit 无引用缓存，以及在精确 ID、标签和容器引用核验后确认不再承担当前运行或明确恢复职责的历史 candidate/test 镜像。

## 固定保护对象

- 当前 Web、Worker、PostgreSQL、Caddy 容器及其镜像。
- 当前 Web 的本地标签和 private GHCR 恢复锚点；alpha.41 明确回滚镜像；FIX38 被拒候选镜像（只作证据，禁止部署）。
- `trae-app-1`、`trae-mysql-1` 及其镜像和数据卷。
- 四个 ERP 持久卷：
  - `chenyida-erp-parallel_erp_postgres`
  - `chenyida-erp-parallel_erp_uploads`
  - `chenyida-erp-parallel_erp_attachments`
  - `chenyida-erp-parallel_erp_backup_status`
- `/var/backups/chenyida-erp`、Python/SQLite 运行面、Docker daemon、Swap、内核、防火墙和 systemd。
- 项目负责人既有未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md`。

## 执行门禁

1. 开始前记录 Git、内存、Swap、磁盘、Load、容器资源、Compose 状态、RestartCount、OOMKilled、Volume 和镜像基线。
2. 确认没有 Docker/buildx/Compose build、测试、Migration 或临时重任务运行；默认 builder 必须明确且可用。
3. 先且只执行 `docker buildx prune --all --force` 清理无引用 BuildKit cache，然后重新核验磁盘。
4. 只有根分区仍低于 30 GiB 时，才逐 ID 清理无容器引用、非保护对象的历史 candidate/test 镜像；不得使用通配删除、`docker image prune -a`、`docker system prune -a` 或 `docker volume prune`。
5. 达到 30 GiB 后立即停止扩大镜像清理范围。
6. 完成后复核服务健康、公开健康接口、Volume 身份、备份元数据、RestartCount/OOM、Docker 空间、临时资源和 Git 范围，并观察至少 60 秒 Swap/restart/OOM。

## 验收标准

- 根分区可用空间至少 30 GiB。
- BuildKit 无引用缓存已受控清理；任何镜像删除都有精确 ID、零容器引用和保护清单排除证据。
- 当前四个 ERP 容器身份、镜像和运行状态保持；四个受保护 Volume 名称、driver、scope 和创建时间保持。
- PostgreSQL/Web 健康，Worker/Caddy 运行；公开健康接口返回当前 alpha.42。
- 所有容器 RestartCount 不增加、OOMKilled 为 false，60 秒 Swap 增长不超过 256 MiB。
- 未修改业务代码、Schema、Migration、Compose、版本、数据库、备份、Python/SQLite 或生产配置。
- 同步更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 并创建独立 Git 提交；不 push、不创建 PR。
