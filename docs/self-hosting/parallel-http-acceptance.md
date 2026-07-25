# 同机并行 HTTP 验收环境运维说明

本说明只适用于 Compose 项目 `chenyida-erp-parallel`。环境标识为 `PARALLEL HTTP ACCEPTANCE ONLY`，不是生产环境；不得迁入真实数据、切流、双写、启动 Caddy、开放 PostgreSQL、占用 80/443、修改 DNS 或防火墙。

## 固定边界

- 运行目录：`/opt/erp/chenyida_erp_site`
- Compose 项目：`chenyida-erp-parallel`
- 配置：`/etc/chenyida-erp/parallel.env`，`root:root`、`0600`
- 管理员临时凭据：`/etc/chenyida-erp/parallel-admin.txt`，`root:root`、`0600`
- Web：宿主机仅 `127.0.0.1:3000`
- PostgreSQL：只在 Compose 网络暴露 `5432/tcp`，无宿主机映射
- 旧 Python：继续独立监听 `0.0.0.0:18888`，不得由本环境操作

所有 Compose 命令都必须显式带项目名、env 文件和 compose 文件：

```bash
cd /opt/erp/chenyida_erp_site
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml ps -a
```

## 访问与首次登录

从客户端建立 SSH 隧道：

```bash
ssh -L 3000:127.0.0.1:3000 root@服务器IP
```

保持隧道会话打开，然后访问 `http://127.0.0.1:3000`。管理员凭据只允许通过服务器 SSH 读取：

```bash
sudo cat /etc/chenyida-erp/parallel-admin.txt
```

首次登录后必须在系统内修改密码，然后删除凭据文件。删除是人工确认动作，不由 Compose 或应用自动执行。禁止把密码复制进仓库、聊天、工单、Compose 长期 env 或 shell 命令参数。

## 日常检查

```bash
cd /opt/erp/chenyida_erp_site
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml config --quiet
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml ps -a
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:18888/
free -h
df -h /opt/erp
ss -lntp '( sport = :3000 or sport = :5432 or sport = :18888 )'
```

正常状态为 PostgreSQL healthy、migrate exited 0、Web healthy、Worker running；Web 只显示 `127.0.0.1:3000->3000/tcp`，PostgreSQL 不显示宿主端口。

## 日志与重启

```bash
cd /opt/erp/chenyida_erp_site
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml logs --no-color --tail=200 postgres web worker migrate
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml restart postgres web worker
```

PostgreSQL 短暂重启时 Worker 会记录去敏的 `postgres_idle_client_error` / `worker_poll_failed` 并重试；日志不得包含密码、token 或数据库 URL。重启后必须重新确认 14 个 migration、管理员登录、Web healthy 和 Worker running。

## 资源停止条件

若可用内存持续低于 500MB、swap 快速增长、load 持续异常、磁盘低于 15GB，或 Python PID/18888 异常，只停止新项目并保留 Volume：

```bash
cd /opt/erp/chenyida_erp_site
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml stop postgres web worker
```

不得终止其他系统进程，不得执行 `down -v`、清理 Docker 资源、删除 Trae 数据、修改 Python systemd 或真实 SQLite。后续升级、真实数据迁移、HTTPS、域名、生产恢复和切流均需另立任务并单独授权。
