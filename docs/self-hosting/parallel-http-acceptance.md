# 同机并行 HTTP 验收环境运维说明

本说明只适用于 Compose 项目`chenyida-erp-parallel`。环境标识为`CONTROLLED NON-PRODUCTION UAT`，不是生产环境；当前Caddy已按历史受控任务在公网18888终止TLS，但不得据此迁入真实数据、切生产流量、双写、开放PostgreSQL、修改DNS或防火墙。

## 固定边界

- 运行目录：`/opt/erp/chenyida_erp_site`
- Compose 项目：`chenyida-erp-parallel`
- 配置：`/etc/chenyida-erp/parallel.env`，`root:root`、`0600`
- 管理员临时凭据：`/etc/chenyida-erp/parallel-admin.txt`，`root:root`、`0600`
- Web：宿主机仅 `127.0.0.1:3000`
- PostgreSQL：只在 Compose 网络暴露 `5432/tcp`，无宿主机映射
- Caddy：历史受控公网入口为`https://43.135.148.43.nip.io:18888`，不得由普通验收任务修改
- 旧 Python：继续独立监听`127.0.0.1:18889`，不得由本环境操作

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
curl --fail http://127.0.0.1:18889/
free -h
df -h /opt/erp
ss -lntp '( sport = :3000 or sport = :5432 or sport = :18888 or sport = :18889 )'
```

当前alpha.42/0040旧运行面的事实为PostgreSQL/Web healthy、Worker/Caddy running且Worker `health=none`；这不是D-119通过。只有未来alpha.46/0045或后续同候选获准部署后，正常状态才要求PostgreSQL、Web、Worker全部healthy，`/api/live`返回LIVE、`/api/health`返回READY且version/revision/Migration head与候选一致。Web仍只显示`127.0.0.1:3000->3000/tcp`，PostgreSQL不得显示宿主端口。

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

PostgreSQL短暂重启时旧Worker会记录去敏的`postgres_idle_client_error`/`worker_poll_failed`并重试；0045候选还必须让运行租约失效并使Worker health失败，恢复后重新验证精确实例。日志不得包含密码、token、数据库URL、SQL、文件路径或instance UUID。当前UAT重启后必须只读确认40/head0040、既有受控业务基线、Web/PostgreSQL healthy、Worker/Caddy running及restart/OOM；未来0045部署后改为核对完整45行checksum和Web/Worker双healthy。历史TASK01/TASK05的15/19 migration只保留在各自验收记录中。

## 资源停止条件

若available memory低于768MiB、Swap使用率超过80%、60秒增长超过256MiB、根盘低于10GiB、Load1持续3分钟高于4，或出现OOM、反复重启、数据库失去健康、SSH卡顿、Python/18889异常，只停止新任务并保留Volume：

```bash
cd /opt/erp/chenyida_erp_site
docker compose --project-name chenyida-erp-parallel \
  --env-file /etc/chenyida-erp/parallel.env \
  -f compose.yml stop postgres web worker
```

不得终止其他系统进程，不得执行 `down -v`、清理 Docker 资源、删除 Trae 数据、修改 Python systemd 或真实 SQLite。后续升级、真实数据迁移、HTTPS、域名、生产恢复和切流均需另立任务并单独授权。
