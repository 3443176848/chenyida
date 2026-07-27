# SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 完成报告

## 完成结论

`SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 — 安全清理 Docker 构建缓存` 已完成。

固定结论：`DOCKER BUILD CACHE SAFELY CLEANED`

未启动 `SELFHOST-PHASE5-TASK08`。

## Git、版本与执行边界

- 起点为 `main` / `dfece35cda381ff31c376aad9ed78242861ada73`，工作区 clean，`origin/main...HEAD` 为 behind 0/ahead 58。
- 本任务独立提交消息为 `ops: clean docker build cache safely`，Parent 必须且实际保持为上述起点；不 amend、rebase、reset、push 或创建 PR。提交后实际 SHA 与最终 Git 状态以提交后复核为准。
- 版本保持 `0.1.0-alpha.31`；源码与 PostgreSQL migration 保持 `0001`—`0031`，head 为 `0031_production_batch_genealogy.sql`。
- 未修改业务代码、Schema、Migration、Compose、版本、Docker daemon、Swap、内核、systemd 或 Python 服务。

## 删除前只读清单

- 默认且唯一 BuildKit builder 为 `default*`，driver/endpoint 为 `docker/default`，状态 running，BuildKit v0.30.0。
- 进程和容器核验未发现 `docker build`、`buildx build`、Compose build、Node 测试、一次性测试容器或 Migration 运行。
- `docker system df`：Images 13、active 5、27.45 GB、reclaimable 4.271 GB；Build Cache 228、25.11 GB、reclaimable 24.3 GB；Local Volumes 11、723.3 MB；Containers 5、active 3。
- `docker buildx du`：Shared 814.9 MB、Private 24.3 GB、Reclaimable/Total 25.11 GB。
- 根分区可用 14 GiB；available memory 约 2.4 GiB；Swap 使用约 147 MiB；Load `0.22/0.26/0.32`。
- 运行容器及镜像：PostgreSQL `be4e942f2850…` / `sha256:4f736ae29268…`，Web `7c4e1cd0c58a…` / `sha256:0078e5cacad1…`，Worker `5d12200e2682…` / `sha256:02e1aacd507e…`。三者 RestartCount 0、OOMKilled false；PostgreSQL/Web healthy、Worker running。
- Web 仅 `127.0.0.1:3000`，PostgreSQL 的 `5432/tcp` 无宿主绑定。

## BuildKit cache 清理

- 删除前再次确认默认目标为 `default*` 且无构建、测试或 Migration 进程。
- 执行且只执行受控命令 `docker buildx prune --all --force`。命令退出码 0，逐项输出缓存记录，最终输出 `Total: 25.11GB`。
- 清理后 `docker system df` 与 `docker buildx du` 均显示 Build Cache 0、Total/Reclaimable 0B。
- 该缓存可由未来获准的串行 build 重新生成；本任务没有停止、重建或删除任何 ERP 容器。

## dangling image 逐项清理

- BuildKit 清理后唯一 dangling image 为 `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612`，`docker system df -v` 显示 unique size 701.4 MB。
- `docker image inspect` 确认其 `RepoTags=[]`、`RepoDigests=[]`，comment 为 `buildkit.dockerfile.v0`；`docker ps -a --no-trunc --filter ancestor=...` 为空，且不等于三台 ERP 容器镜像。
- 仅以明确 ID 执行 `docker image rm sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612`，退出码 0。最终 dangling image 清单为空。
- Images 从 13/27.45 GB/reclaimable 4.271 GB 降为 12/6.511 GB/reclaimable 3.57 GB。未执行 `docker image prune -a`，未删除任何 tagged image。

## 磁盘与运行资源结果

- 根分区可用从 14 GiB 恢复到 37 GiB（78% used→40% used），超过 30 GiB 目标，因此未进入也无需请求第二阶段清理。
- 清理后内存仍约 2.4 GiB available，运行内存没有明显变化，符合预期。
- 60 秒观察：available memory `2503064→2499940` KiB；Swap `151064→151064` KiB、增长 0；Load `0.79/0.60/0.44→0.37/0.52/0.42`。
- 观察期间 PostgreSQL/Web 全程 healthy、Worker running；三容器 RestartCount 始终 0、OOMKilled 始终 false。

## 容器、镜像、Volume 与数据保护

- PostgreSQL/Web/Worker 三个容器 ID 与清理前一致，当前镜像 ID 均未变化；`postgres:17-bookworm` 保持 `sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394`。
- 四卷 `chenyida-erp-parallel_erp_postgres`、`chenyida-erp-parallel_erp_uploads`、`chenyida-erp-parallel_erp_attachments`、`chenyida-erp-parallel_erp_backup_status` 均保持 local driver、local scope 和 `2026-07-25T21:05:58+08:00` 创建时间。
- `trae-app-1`、`trae-mysql-1` 保持原退出状态；`trae-app:latest`、`mysql:8.0`、`trae_mysql_data` 保留。六个匿名 Volume 全部保留，全部 11 个 Volume 前后不变。
- 所有其他 tagged image 均保留；未执行 system/container/network/volume prune，未删除任何 Volume 或业务数据。
- resource-guard 备份 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump` 保持 1,383,645 bytes、mode 600、SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。

## 数据库、文件与 Python/SQLite 核验

- PostgreSQL 精确核验为 31 migrations，范围 `0001_selfhost_baseline.sql`—`0031_production_batch_genealogy.sql`。
- `app_meta=1`、`app_users=1`，唯一启用管理员 1、active must-change 0；逐表精确计数确认其余所有 public 业务、Audit、Idempotency 表均为 0。
- uploads 0、attachments 0。
- Python systemd 服务保持 active/running，PID `13737`、restart 0，未停止或重启。
- SQLite 只核验 metadata，未读取正文：inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`、birth `2026-07-18 14:42:31.155704728 +0800`。

## 串行验证与 Git

- `git diff --check` 通过；`npm test` 3/3 通过；`npm run lint` 0 error/9 warning；`npm run security:credentials` 扫描 980 个 repository files 并返回 `CREDENTIAL_CHECK_OK`。
- 宿主 PATH 没有 npm，首次宿主 `npm test` 在测试启动前以 127 退出；随后使用仓库既有 tagged Node image 运行。凭据扫描首次只读挂载没有包含 Git 根目录，在 `git ls-files` 前置阶段退出；改为只读挂载完整仓库并使用含 Git 的既有 `node:22-bookworm` 后通过。两次均为环境预检失败，不是测试或凭据发现失败。
- Node 验证使用一次一个、无网络、只读 bind、CPU/Memory/PID 受限的 `--rm` 容器串行执行；共四个临时验证容器均已自动清理，没有创建 Volume、数据库或遗留临时资源，Build Cache 保持 0B。
- 最终 Git 提交、工作区和 `origin/main...HEAD` 状态在独立提交后复核；不 push、不创建 PR。

## 明确未执行

未停止或重启 Compose，未停止、重建或删除 ERP 三容器，未删除或替换四个 ERP Volume，未删除匿名 Volume、Trae/MySQL、任何 tagged image 或业务数据；未执行被禁止的 prune 命令；未操作 Python 服务；未修改业务代码、Schema、Migration、Compose 或版本；未启动 `SELFHOST-PHASE5-TASK08`。
