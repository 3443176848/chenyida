# Linux 自托管部署

## 首次启动

1. 安装 Docker Engine 与 Docker Compose，克隆仓库并进入 `chenyida_erp_site`。
2. `cp .env.example .env`，生成随机 PostgreSQL 密码和一次性 setup token；同步修改 `DATABASE_URL`，不要把 `.env` 提交。
3. 运行：

```bash
docker compose -f compose.yml config --quiet
docker compose -f compose.yml up -d --build postgres migrate web worker
docker compose -f compose.yml ps
curl --fail http://127.0.0.1:3000/api/health
```

4. 用命令环境初始化唯一首位管理员：

```bash
ERP_ADMIN_USERNAME=admin \
ERP_ADMIN_DISPLAY_NAME='系统管理员' \
ERP_ADMIN_PASSWORD='人工生成的强随机密码' \
docker compose -f compose.yml --profile tools run --rm admin
```

重复初始化会返回 `SETUP_COMPLETE`，不会覆盖账号。完成后应轮换/移除 setup token 并重建 Web 容器。

## 开发与生产

开发默认只把 Web 绑定到 `127.0.0.1:3000`。直接 Node 开发需要 Node >=22.13、可用 PostgreSQL、`npm ci`、`npm run db:migrate`、`npm run dev`；Worker 另开终端运行 `npm run worker`。

生产先把域名 DNS 指向服务器，设置 `ERP_ENV=production`、真实 `ERP_DOMAIN`、强密码与受控备份，再运行：

```bash
docker compose -f compose.yml --profile production up -d
```

Caddy 持久化证书数据。只开放 80/443；不要暴露 PostgreSQL。`web` 和 `worker` 使用非 root `node` 用户，容器日志轮转、`unless-stopped`、健康检查和 30 秒 Worker 停机窗口已配置。

## 验证与升级

```bash
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail=200 web worker postgres migrate
curl --fail https://ERP_DOMAIN/api/health
```

升级前先备份。拉取代码后先构建、审阅 migration，在维护窗口执行 migrate，再滚动重建 Worker/Web。未经单独授权不得把旧 SQLite/D1 数据导入或切换公网流量。
