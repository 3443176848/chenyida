# Linux 自托管部署

当前Compose项目`chenyida-erp-parallel`是受控非生产UAT，不是production部署：Web只绑定`127.0.0.1:3000`，Caddy另在公网18888提供受控TLS入口，PostgreSQL无宿主端口。运行面仍为alpha.42/0040；仓库alpha.46/0045已形成仅本机隔离零发现诊断候选，但没有正式supervisor gate、`ELIGIBLE`manifest或部署。固定命令、安全边界和停止条件见`parallel-http-acceptance.md`。

## 本地开发首次启动

1. 安装 Docker Engine 与 Docker Compose，克隆仓库并进入 `chenyida_erp_site`。
2. `cp .env.example .env`，生成随机 PostgreSQL 密码和一次性 setup token；同步修改 `DATABASE_URL`，不要把 `.env` 提交。
3. 运行：

```bash
docker compose -f compose.yml config --quiet
docker compose -f compose.yml up -d --build postgres migrate web worker
docker compose -f compose.yml ps
curl --fail http://127.0.0.1:3000/api/live
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

以上命令只适用于新建的本地开发/隔离环境，不得照抄到UAT或生产。alpha.46开始，`/api/live`只证明Web进程与版本元数据可读；`/api/health`必须同时验证数据库完整Migration、同候选新鲜Worker租约及Web侧uploads/attachments可写。Worker容器也必须显示`healthy`。任一项不满足都不能把环境解释为ready。

## 开发与生产

开发默认只把 Web 绑定到 `127.0.0.1:3000`。直接 Node 开发需要 Node >=22.13、可用 PostgreSQL、`npm ci`、`npm run db:migrate`、`npm run dev`；Worker 另开终端运行 `npm run worker`。

生产不得使用本页的本地`--build`或直接`up`命令。必须先取得同一Git/tree、alpha.46或后续版本、Web/Worker registry digest、完整Migration allowlist、镜像SBOM/漏洞证据和18步gate PASS形成的`ELIGIBLE`manifest，再按[发布门](../testing/selfhost-release-gate.md)、[Migration说明](postgresql-migration.md)和[运维基线](operations-runbook.md)取得分别的build、Migration、部署和runtime identity专项授权。真实执行同时加载`compose.yml`与`compose.release.yml`，只接受已核验digest且`--pull never`。

Caddy持久化证书数据。只开放经批准的HTTP/HTTPS入口，不要暴露PostgreSQL。alpha.46候选的`web`和`worker`使用数值非root身份`65532:65532`，容器日志轮转、`unless-stopped`、Web/Worker健康检查和30秒Worker停机窗口已配置。0045部署编排必须等待旧Worker停止或租约过期，禁止手工改租约绕过排他。

生产部署还必须安装与候选精确绑定的监控策略、root-only配置、受保护状态目录和真实值班通知target，并完成首次窗口预热及投递/恢复演练。监控的Docker模板必须安全处理不存在的health key：Caddy允许`none`，PostgreSQL/Web/Worker必须`healthy`；任何tag镜像、身份不一致、缺失证据或pending通知均不能作为上线绿色证据。当前仓库仅验证了监控合同，尚未授权host安装或真实通知，具体见[监控、告警与值班处置](operations-runbook.md#监控告警与值班处置)。

## 验证与升级

```bash
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail=200 web worker postgres migrate
curl --fail https://ERP_DOMAIN/api/live
curl --fail https://ERP_DOMAIN/api/health
```

ready验收要求PostgreSQL、Web和Worker均为`healthy`，health响应为`READY`且版本/revision/Migration head与候选一致；`/api/live`成功不能替代readiness。升级前必须先有异机可恢复快照。按已批准顺序执行Migration、Worker、Web与runtime identity发布并观察租约/重启/OOM；任一步失败即停止晋升并按已验证快照或前向修复路径处理。未经单独授权不得把旧SQLite/D1数据导入、部署候选或切换公网流量。
