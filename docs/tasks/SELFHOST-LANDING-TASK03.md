# SELFHOST-LANDING-TASK03 — 18888 公网 HTTPS 入口与受控切换

## 目标

将已完成真实 BOM 部分导入的 `chenyida-erp-parallel` PostgreSQL ERP 通过公网 `18888` 提供受认证访问，同时保留旧 Python 运行面为仅本机回退入口。

## 已授权范围

- 项目负责人于 2026-07-28 明确要求创建公网访问入口，并指定端口 `18888`。
- 允许为完成该入口调整 Compose/Caddy 运行配置并重启 Web、Worker 和旧 Python 服务。
- 不上传真实业务数据、备份、表格、凭证或逐行报告到第三方。

## 安全边界

- PostgreSQL 不发布宿主端口，Web 继续只绑定 `127.0.0.1:3000`。
- 公网流量只通过 Caddy TLS 入口进入 Web；禁止将 `3000` 直接暴露公网。
- `ERP_ENV=production`，认证 Cookie 必须包含 `HttpOnly`、`Secure` 和 `SameSite=Lax`。
- 入口使用解析到本机公网 IP 的 DNS 名称申请公开可信证书；该 DNS 只负责名称解析，不代理或存储 ERP 流量。
- 旧 Python 服务改为回环备用端口，不再直接暴露公网；不读取或修改旧 SQLite 业务正文。
- 不修改 PostgreSQL Schema/Migration，不写业务表，不创建库存、订单、生产、品质或财务事实。
- 不修改云厂商外部安全组；若 ACME 所需端口在云侧不可达，停止公网切换并回退。

## 验收

- `https://<入口主机>:18888` 可访问，HTTP 明文入口不得承载登录。
- 证书链和主机名校验通过，TLS 入口包含基础安全响应头。
- 匿名首页和健康检查可读；未认证业务 API 保持拒绝。
- 登录响应 Cookie 安全属性由不写数据库的单元测试或既有测试验证。
- PostgreSQL/Web/Worker 健康，Migration 仍为 `0034`，真实 BOM 核心计数不变。
- 旧 Python 服务仍运行，但只监听回环备用端口。
- 四个 ERP 持久卷、post-import 备份和 root-only 导入报告不变。
- 记录切换前后资源、OOM/RestartCount、回退方式和最终 URL。
