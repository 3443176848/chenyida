# SELFHOST-OPS-DOCKER-CACHE-CLEANUP-03 完成报告

## 完成结论

`SELFHOST-OPS-DOCKER-CACHE-CLEANUP-03 — 受控 Docker 空间清理` 已完成。

固定结论：`DOCKER SPACE SAFELY RECLAIMED`

根分区可用空间已从 17 GiB 恢复到 32,581,345,280 bytes，即 30.34 GiB（`df -h` 显示 31G）。任务达到精确停止目标后没有继续扩大镜像删除范围。

## 授权、Git 与范围

- 项目负责人于 2026-08-11 在收到只读磁盘归因后明确回复“同意”。
- 起点为唯一 worktree、`main@1dcbf8de800410c0352a9a2c7cfb4b41b7e8bd37`、`origin/main...HEAD` behind 0/ahead 219。
- 项目负责人既有未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md` 全程不读、不改、不提交。
- 本任务独立提交消息为 `ops: reclaim docker cache space safely`，实际 SHA 以 `git log` 为准；不 push、不创建 PR、不改写历史。
- 未修改业务代码、Schema、Migration、Compose、package/version、Docker daemon、Swap、内核、防火墙、systemd 或部署配置。

## 删除前门禁与基线

- 根分区 60 GB，used 44 GB、available 17 GiB、使用率 74%；`/var/lib/containerd` 为 24 GB。
- available memory 约 1.7 GiB，Swap used 382 MiB，Load `0.10/0.19/0.16`，全部高于或低于相应安全停止线。
- `docker system df`：Images 58、active 6、24.45 GB、reclaimable 12.39 GB；Build Cache 105、10.92 GB；Volumes 13、733.3 MB。
- `docker buildx du`：Shared 2.647 GB、Private 8.273 GB、Reclaimable/Total 10.92 GB。
- 默认且唯一 builder 为 `default*`，BuildKit v0.30.0、状态 running；进程检查只命中内核 migration thread，没有 Docker/Compose build、buildx build、Node 测试、Playwright、Migration、Drizzle、dump/restore 或临时重任务。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOMKilled false。第一次未传受保护 env 的 Compose 状态检查只在插值阶段失败，随后使用既有 root-only env 文件完成只读 `ps`，没有输出 env 值或改变服务。

## BuildKit cache 清理

- 删除前再次确认 builder、资源和进程门禁。
- 执行且只执行一次 `docker buildx prune --all --force`；命令退出 0，输出 `Total: 10.92GB`。
- 清理后 Build Cache 105/10.92 GB→0/0B，`docker buildx du` Reclaimable/Total 均为 0B。
- 根分区先恢复到 25 GiB；尚未达到任务固定的 30 GiB 停止目标，因此进入精确测试镜像核验。

## 四个测试/旧任务镜像逐 ID 清理

清理前 dangling image 清单为空；没有执行任何通配或 prune 型镜像删除。

1. `mcr.microsoft.com/playwright:v1.51.1-noble`
   - 精确 ID：`sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd`
   - `docker system df -v` unique size：3.551 GB；创建于 2025-03-17。
   - `docker ps -a --filter ancestor=<ID>` 为空，不等于任何保护镜像。
   - 仅以该完整 ID 删除，根盘随后为 28 GiB。
2. `chenyida-erp-unit-resolution-builder:alpha37`
   - 精确 ID：`sha256:72d489ebcc4f4ba6943328d980c9d48c4995ab6ca876522f254aa6d76add6ec5`
   - `docker system df -v` unique size：1.673 GB；创建于 2026-07-31。
   - `docker ps -a --filter ancestor=<ID>` 为空，不等于任何保护镜像。
   - 仅以该完整 ID 删除；`df -h` 此时显示 30G。

随后使用 `df -B1` 复核，发现显示的 30G 是舍入值：实际 available 为 31,345,692,672 bytes，即 29.19 GiB，仍低于合同要求的精确 30 GiB。因此继续核验最小必要的两个无引用旧任务/测试基镜像：

3. `chenyida-erp-parallel-migrate:alpha37-unit-resolution-candidate`
   - 精确 ID：`sha256:24fcacdc89baf3fdc11afb78441e5b3137d6a775c7cd60c9ff10854b33dcf98f`
   - `docker system df -v` unique size：716 MB；创建于 2026-07-31。
   - 容器数为 0，完整 ancestor 过滤为空；仅以完整 ID 删除。
4. `postgres:16-bookworm`
   - 精确 ID：`sha256:92620daddcd947f8d5ab5ba66e848702fe443d87fed30c4cea8e389fd78dfc55`
   - `docker system df -v` unique size：504.8 MB；创建于 2026-07-14。
   - 容器数为 0，完整 ancestor 过滤为空；当前运行的 `postgres:17-bookworm` 是不同 ID并固定保护。
   - 仅以完整 ID 删除后，available 达到 32,581,345,280 bytes/30.34 GiB，随即停止扩大范围。

没有删除任何历史 Web 镜像，包括当前 alpha.42、private GHCR 本地恢复锚点、alpha.41 明确回滚、FIX38 被拒证据和更早 tagged candidate/rollback。

## 最终磁盘与 Docker 状态

- 根分区 available 17→32,581,345,280 bytes/30.34 GiB，used 74%→50%；`/var/lib/containerd` 24→8.9 GB。
- Images 58→54，最终 active 6、size 9.505 GB、reclaimable 5.942 GB；Build Cache 0B。
- Containers 保持 6/active 4，容器可写层约 4 KiB；Volumes 保持 13/733.3 MB。
- 仍被 Docker 标记可回收的其他 tagged image 没有自动删除；未来如需继续清理必须另按保护清单授权和逐项核验。

## 服务、Volume、备份与运行面保护

- Web 容器 `f0066fe6…1a35f` / 镜像 `e7761e2c…f94964`、Worker `fb68d9a8…7f6e0` / `32d1ae33…96aa`、PostgreSQL `f3a2f3cb…2ead3` / `4f736ae2…f394`、Caddy `c209765b…18df` / `4c6e91c6…530d` 前后不变。
- Web/PostgreSQL healthy，Worker/Caddy running；回环和公开 HTTPS `/api/health` 均返回 PostgreSQL/local/PostgreSQL-jobs 和 `0.1.0-alpha.42`。
- alpha.41 回滚 `0cf98937…d5f19`、FIX38 被拒证据 `81126136…4278e`、当前 GHCR 本地锚点、Trae/MySQL 镜像和退出容器均保持。
- 全部 13 个 Volume 保持。四个 ERP 保护卷仍为 local driver/local scope，创建时间均为 `2026-07-25T21:05:58+08:00`。
- `/var/backups/chenyida-erp` 保持 89 MB、root mode 700、mtime 不变；未读取备份正文。
- Python systemd 保持 active/running、PID 1119、NRestarts 0；SQLite 只核验 metadata，size 1,544,192、mode 600、inode和mtime前后不变，未读取或写入正文。

## 资源稳定观察

- 最终 60 秒窗口：available memory `2112798720→2102812672` bytes；Swap used `406355968→406355968` bytes，增长 0；Load1 `0.14→0.09`。
- 四个 ERP 服务 RestartCount 始终为 0、OOMKilled 始终 false、状态始终 running；观察窗口没有内核 OOM 记录。
- 全部验证结束后 available 约 2.0 GiB、Swap used 约 388 MiB、根盘 30.34 GiB，未触发安全停止条件。

## 串行验证与临时资源

- 断网、只读源码挂载、单 CPU、受限 Memory/PID 的 `--rm` Node 容器串行通过：`npm test` 3/3、`npm run lint` 退出 0、最终 `npm run security:credentials` 扫描 1,469 个 tracked repository files 并返回 `CREDENTIAL_CHECK_OK`。
- Python 项目 venv 在自动清理的任务专用临时 SQLite 中通过 `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 3/3；没有连接常驻 SQLite。
- 首个 shell 临时目录包装命令被执行环境在进程创建前拒绝，没有创建目录或运行测试；随后使用标准库 `TemporaryDirectory` 完成同一隔离目标。
- 三个临时 Node 容器、Python 临时目录/SQLite均已清理；没有临时数据库、镜像、Volume 或 Build Cache 残留。
- `git diff --check` 通过；最终 Git 状态只包含本任务文档变更和项目负责人既有未跟踪文件。

## 明确未执行

未执行 `docker system prune -a`、`docker image prune -a`、`docker volume prune`、container/network prune 或通配删除；未删除任何 Volume、历史 Web 镜像、运行/回滚/被拒证据/恢复锚点镜像、Trae/MySQL、备份或业务数据；未停止、重启、重建或部署 Compose 服务；未执行 build、Migration、备份恢复、数据库业务查询/写入、Python 服务操作、真实数据迁移、生产动作、Git push 或 PR。
