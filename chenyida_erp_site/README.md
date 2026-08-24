# 晨亿达 ERP 自托管应用

当前生产方向是标准 Node.js Web、PostgreSQL、服务器本地持久化文件和独立后台 Worker。运行时不需要 OpenAI Site、Cloudflare Worker、D1、R2 或 Queue。历史 Cloudflare 代码和 `drizzle/` migration 暂留作后续数据迁移依据，不是启动依赖。

## 快速启动

需要 Docker Engine 和 Docker Compose。复制 `.env.example` 为 `.env`，替换全部 `CHANGE_ME`，然后执行：

```bash
docker compose -f compose.yml up -d --build postgres migrate web worker
docker compose -f compose.yml ps
curl --fail http://127.0.0.1:3000/api/health
```

首次管理员必须显式从命令环境传入，仓库不提供默认密码：

```bash
ERP_ADMIN_USERNAME=admin \
ERP_ADMIN_DISPLAY_NAME='系统管理员' \
ERP_ADMIN_PASSWORD='在此输入至少12位的随机密码' \
docker compose -f compose.yml --profile tools run --rm admin
```

开发入口默认只绑定 `127.0.0.1:3000`。生产 HTTPS 使用 Caddy profile，并要求 DNS 已指向服务器：

```bash
ERP_DOMAIN=erp.example.com docker compose -f compose.yml --profile production up -d
```

## 当前主机的隔离 UAT 合同

`compose.uat-isolated.yml`只用于同机、非生产UAT。它要求独立Compose项目名，完整替换Secret、release candidate、release identity宿主挂载，并把Web及可选`uat-edge`入口限制在loopback；命名Volume和网络随项目名隔离。`.env.uat-isolated.example`中的路径和端口只是待L2a核对的非Secret示例，不是容量、人数或产品限制。

以下命令只渲染和验证静态Compose，不创建目录、Secret、容器、网络、Volume或数据库：

```bash
COMPOSE_PARALLEL_LIMIT=1 ./scripts/run-isolated-uat-compose-config-test.sh
```

生产`compose.yml`、生产容器运行策略和固定生产root保持不变。当前PostgreSQL运行角色operator及release supervisor仍绑定生产控制root，不能用于这个同机UAT；必须先完成独立producer/operator适配并取得L2a授权，才可创建任何运行资源。

## 常用命令

```bash
npm ci
npm run dev
npm run lint
npm test
npm run db:generate
docker compose -f compose.yml run --rm migrate
docker compose -f compose.yml logs -f web worker postgres
```

PostgreSQL 集成测试必须显式提供独立 `TEST_DATABASE_URL`；Compose 冒烟测试需要已经初始化的隔离实例和测试管理员变量。任何测试数据库名称都应包含 `test`，不得指向生产。

完整说明：

- `docs/self-hosting/architecture.md`
- `docs/self-hosting/deployment.md`
- `docs/self-hosting/postgresql-migration.md`
- `docs/self-hosting/backup-restore.md`
- `docs/self-hosting/cloudflare-deprecation.md`
- `docs/tasks/SELFHOST-PHASE0-TASK01-completion.md`
