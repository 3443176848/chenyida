# 低资源服务器运行保护

## 适用边界

本仓库所在主机固定按 2 核、约 4 GiB 内存、1 GiB Swap 的低资源服务器管理。2026-07-27 曾发生服务器重启或不可用；现有证据不足以确定根因，根因记为 `UNKNOWN`，不得宣称由 OOM 导致。

本保护只降低资源耗尽、Swap 风暴、容器重启循环和 SSH 失联风险，不表示 ERP 已生产上线。Python/SQLite 开发服务仍保留；停用或切流必须另立任务并获得明确授权。

## 强制执行规则

- 固定 `COMPOSE_PARALLEL_LIMIT=1`。Docker build、全量测试、Migration、备份恢复和 Compose 重启必须串行，一次只允许一个临时测试或构建容器。
- 禁止同时运行 build、全量测试、多个 typecheck 或多个 PostgreSQL 测试库。宿主 Node 重任务优先设置 `NODE_OPTIONS=--max-old-space-size=1024`。
- 每项重任务前后执行 `free -h`、`df -h /`、`uptime`、`docker stats --no-stream` 和带受控 env-file 的 `docker compose ps`。
- available memory 小于 768 MiB、Swap 60 秒增长超过 256 MiB、Swap 使用率超过 80%、根分区可用小于 10 GiB、1 分钟 Load 持续 3 分钟超过 4，或出现 OOM、反复重启、SSH 卡顿、数据库不健康时，立即停止启动新重任务。
- 只清理当前任务明确创建的临时资源。禁止 `docker system prune -a`、`docker volume prune`，禁止删除四个 `chenyida-erp-parallel` 持久卷。
- 未经授权不得修改 Swap、dockerd、内核、防火墙或 systemd 运行状态。

## 运行限额

| Compose 服务 | CPU | Memory | Memory+Swap | PIDs | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| PostgreSQL | 0.75 | 768 MiB | 1 GiB | 128 | 保留现有数据卷；不压低数据库 shared memory 参数 |
| Migrate | 0.75 | 768 MiB | 1 GiB | 128 | 只允许串行一次性运行 |
| Web | 0.75 | 512 MiB | 768 MiB | 128 | Node heap 384 MiB；只绑定 `127.0.0.1:3000` |
| Worker | 0.50 | 512 MiB | 768 MiB | 128 | Node heap 384 MiB；Worker 循环一次只认领一个 Job |
| Admin | 0.50 | 512 MiB | 768 MiB | 128 | 只通过 tools profile 按需运行 |
| Caddy | 0.25 | 128 MiB | 192 MiB | 64 | production profile 未启动 |

Web 与 Worker 各自数据库池默认最多 10 个连接，合计低于 PostgreSQL `max_connections=100`；本任务没有在缺少容量证据时继续压低。Docker service runtime limits 不保护镜像 build，所以 build 仍必须串行并单独执行资源检查。

Python 源码使用 `ERPThreadingHTTPServer`：默认最多 16 个活跃请求线程，容量等待最多 1 秒，超限返回固定去敏 `503/SERVER_BUSY`；已接受 socket 超时 30 秒，daemon thread 与非阻塞 close 防止关闭时无限等待。正常、异常请求均在 `finally` 释放槽位。仓库 systemd 源配置为 `CPUQuota=75%`、`MemoryHigh=512M`、`MemoryMax=768M`、`TasksMax=256`、`LimitNOFILE=4096`。只读核验确认任务起点的 `/etc/systemd/system/chenyida-erp.service` 已与仓库源内容和时间戳一致，当前 systemd 实际属性也显示这些限额；本任务没有复制 unit、daemon-reload 或重启 Python。PID `13737` 保持不变，因此 cgroup 限额已生效，但 16 线程新源码会在后续获准重启后才进入当前服务进程。

## 2026-07-27 应用与验证记录

- 起点：available memory 约 2.2 GiB、Swap 42 MiB、根分区可用 26 GiB、Load `0.33/0.27/0.49`；三个容器 restart 0、OOM false。
- PostgreSQL custom dump 保存为 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump`，mode 600、大小 1,383,645 bytes、SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`，已通过 `pg_restore --list`。该恢复备份被保留，不属于临时清理项。
- PostgreSQL 已具备目标限额且保持原容器；Web、Worker 使用原镜像和 `COMPOSE_PARALLEL_LIMIT=1` 逐个串行重建，没有 build。PostgreSQL `/dev/shm` 为 64 MiB、使用 9.1 MiB，`shared_buffers=128MB`、dynamic shared memory=`posix`，启动与 26 migrations 均正常。
- 更新后：available memory 约 2.2 GiB、Swap 42 MiB、根分区可用 26 GiB、Load `0.05/0.14/0.32`。60 秒内 Swap 使用固定 43,180 KiB，增长 0；三个容器 restart 0、OOM false，PostgreSQL/Web 全程 healthy，Worker running。
- 数据与网络：migration head 为 `0026_production_operation_execution.sql`，唯一启用管理员 1，Audit/Idempotency/Operation Run 均为 0；Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 四个卷 `erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status` 的名称、driver、scope 和 `2026-07-25T21:05:58+08:00` 创建时间前后一致，没有更换或删除。
- Python PID 保持 `13737`、systemd restart 0；实际 cgroup 属性为 CPU 75%、MemoryHigh 512M、MemoryMax 768M、Tasks 256、NOFILE 4096。SQLite 保持 inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`。
- 专项测试、self-test、smoke、临时 SQLite go-live、Compose config、systemd verify、受限单容器 TypeScript check、环境守卫、919 文件凭据扫描和 Git 检查按串行执行。临时 SQLite 目录和全部 `--rm` 检查容器均已清理。

结论仅为 `LOW RESOURCE SERVER SAFEGUARDS ACTIVE`；未迁移真实数据、未切流、未生产部署。

## 2026-07-27 Docker 构建缓存安全清理记录

- `SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02` 起点确认默认且唯一 builder 为 `default*`（docker driver、BuildKit v0.30.0），且无 `docker build`、`buildx build`、Compose build、测试容器或 Migration 运行。
- 受控执行 `docker buildx prune --all --force`，退出码 0、输出合计 `Total: 25.11GB`；Build Cache 从 25.11 GB（24.3 GB private reclaimable）降为 0B。未执行任何 system/image/container/network/volume 通用 prune。
- 唯一 dangling image `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612` 经 `docker ps -a --no-trunc` 和 `docker image inspect` 确认无 tag、digest 或容器引用后逐 ID 删除；Images 从 13/27.45 GB 降为 12/6.511 GB，所有 tagged image 保留。
- 根分区可用从 14 GiB 恢复到 37 GiB。清理前后 available memory 约 2.4 GiB、Swap 约 147 MiB；独立 60 秒采样为 available `2503064→2499940` KiB、Swap `151064→151064` KiB、Load `0.79/0.60/0.44→0.37/0.52/0.42`。
- PostgreSQL/Web/Worker 未停止、重建或删除，容器 ID/镜像保持，RestartCount 0、OOMKilled false；PostgreSQL/Web 全程 healthy、Worker running。Web 仍仅绑定 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 四个 ERP 持久卷、`trae_mysql_data`、六个匿名卷、Trae/MySQL 容器与 tagged image 全部保留。resource-guard 备份大小 1,383,645 bytes、mode 600、SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570` 不变。
- 数据保持 31 migrations、唯一启用 admin 1、其余 public 业务/Audit/Idempotency 0、uploads/attachments 0。Python PID `13737`、systemd restart 0；SQLite 仅核验 metadata，inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`。
- `git diff --check`、`npm test` 3/3、lint 0 error/9 warning、credentials 980 files 串行通过。宿主 PATH 无 npm，因此 Node 验证使用已有 tagged image 在一次一个、无网络、只读 bind、受限 `--rm` 容器中执行；四个临时容器均已自动清理，未创建 Volume，Build Cache 保持 0B。

固定结论：`DOCKER BUILD CACHE SAFELY CLEANED`。未启动 `SELFHOST-PHASE5-TASK08`。
