# SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 公网 IP 与可信 HTTPS 入口切换

## 状态与授权

- 状态：`DONE / PUBLIC HTTPS CUTOVER COMPLETE`。
- 日期：2026-07-31（Asia/Shanghai）。
- 授权：项目负责人确认服务器公网 IP 已变化，并明确回复“切换”，授权把当前 18888 自托管 ERP 的公网入口从旧 IP 名称切换到新 IP 名称。

## 执行前已确认事实

- 两个独立公网出口查询均返回新 IPv4 `43.135.148.43`；服务器本地地址仍为私网/NAT 地址。
- 当前 Caddy `ERP_DOMAIN` 仍为 `43.135.157.211.nip.io`。
- 当前 Web `ERP_PUBLIC_ORIGIN` 仍为 `https://43.135.157.211.nip.io:18888`。
- Caddy 继续监听宿主 `80/18888`，Web 只监听 `127.0.0.1:3000`，PostgreSQL 不发布宿主端口。

## 执行范围

1. 新入口固定为 `https://43.135.148.43.nip.io:18888`。
2. 在 root-only 运行配置中只更新 `ERP_DOMAIN` 与 `ERP_PUBLIC_ORIGIN`；端口、部署类别、回环 UAT 门禁和所有凭据保持不变。
3. 先创建 root-only 原配置回退副本，再使用既有镜像串行重建 Web 与 Caddy；不 build、不拉取新镜像、不重建 PostgreSQL/Worker。
4. 复用既有 Caddy 持久卷自动申请新主机名证书；80 继续只承担 ACME 与 HTTPS 跳转。
5. 验证新主机名 DNS、可信 TLS/SAN、HTTPS 首页与健康检查、匿名业务 API 401、安全响应头、旧主机名不再由当前配置服务。
6. 核对 Migration、核心业务聚合、四个常驻容器、四个受保护卷、资源、restart/OOM 与临时资源。

## 禁止事项

- 不修改 Schema/Migration、业务数据、用户、密码、Session、权限、审计或幂等记录。
- 不修改防火墙、安全组、Swap、dockerd、systemd、Python/SQLite、历史 Sites/D1。
- 不部署 alpha.36、不应用 0035、不启动物料审核、供应商资料导入或其他业务任务。
- 不输出或提交 env 正文、数据库连接串、密码、Token、Cookie、摘要、备份或业务正文。

## 回退

- 恢复本任务创建的 root-only `parallel.env` 回退副本，并以 `COMPOSE_PARALLEL_LIMIT=1` 串行重建 Web、Caddy。
- Caddy 数据卷保留旧证书和状态；PostgreSQL、Worker、业务数据和四个受保护卷不参与回退。

## 验收标准

- 新入口 `https://43.135.148.43.nip.io:18888` 使用公开可信且主机名匹配的证书，首页和 `/api/health` 返回 200。
- HTTP 80 只重定向到新 HTTPS 18888；匿名受保护 API 仍返回 401。
- Web 运行时唯一公网 origin 与新入口精确一致；旧主机名不再由当前 Caddy 配置提供 TLS 服务。
- Web/Caddy 更新完成，PostgreSQL/Worker 容器 ID 不变；Migration/core counts 不变，四卷存在，restart/OOM 无异常。
- 更新项目文档、通过凭据和 Git 范围检查并创建独立提交；不 push/PR。

## 完成结果

- 新入口、可信证书、HTTP 308、HTTPS 首页/健康、安全响应头、匿名 401 和外部只读可达性均通过；旧主机名不再由当前 Caddy 配置提供 TLS。
- Web/Caddy 使用原镜像串行重建；PostgreSQL/Worker 未重建，Migration 仍为 0034，核心业务聚合未因本任务改变。
- 本任务没有调用身份或业务写接口。切换前并发发生的登录/改密流程和更早发生的四条物料批准已按不可变事实保留并在完成报告中单列，不归因于本任务。
- 完成报告：`docs/tasks/SELFHOST-OPS-PUBLIC-IP-CUTOVER-07-COMPLETION.md`。
