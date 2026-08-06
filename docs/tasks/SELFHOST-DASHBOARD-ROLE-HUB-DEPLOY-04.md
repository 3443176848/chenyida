# SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04 — 八角色工作台 Web-only 部署

## 状态与授权

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 完成：2026-08-06（Asia/Shanghai）
- 负责人：Codex（部署保护、备份恢复、候选镜像、Web-only 替换、匿名只读在线验收、清理与文档）；项目负责人（明确要求“直接部署到线上”）
- 依赖：`SELFHOST-DASHBOARD-ROLE-HUB-03`、`SELFHOST-UI-REFRESH-DEPLOY-02`、`SELFHOST-UAT-FIX-27`
- 授权目标：把 `main@4767c3db3cf66eb0978f07d044437790c0d4b87f` 的八角色工作台部署到当前 `https://43.135.148.43.nip.io:18888` 公开非生产 UAT。

## 唯一范围

- 只构建并替换 `chenyida-erp-parallel-web-1`，使登录后根工作台显示管理员、采购、市场、计划、工程、财务、生产、仓库八入口。
- 替换前固定当前 Web 镜像的精确回退标签，执行业务保护指纹、受控备份/list/第二新空库恢复验证。
- 在线验收只允许匿名 HTTPS、健康、认证门禁、静态资源和新 bundle 文本读取；不登录，不发送业务 POST，不创建 Session 或业务数据。
- 不运行 Migration，不改 PostgreSQL、Worker、Caddy、Compose、环境变量、Origin、端口、防火墙、systemd、Swap 或四个受保护 Volume。
- 备份的一致性窗口只短暂停止 Web/Worker，完成后恢复 Worker 并以新候选替换 Web；任何失败优先恢复旧 Web。

## 严格起点

- Git：clean `main@4767c3db3cf66eb0978f07d044437790c0d4b87f`；独立功能提交为 `feat: simplify ERP workbench role entrances`。
- 版本与数据库：源码/UAT Web `0.1.0-alpha.40`，PostgreSQL 39/head `0039_rfq_traceability.sql`，没有 0040。
- 当前 Web：`sha256:f139257b6b6b845bebbf9aa97eb909895158d637956f069b2c82f99b2b1d5b6d`，Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 起点资源：available memory 约 2.2 GiB，Swap 306 MiB/1 GiB，根分区可用 19 GiB，Load `2.51/1.97/1.03`。

## 验收标准

1. 候选镜像必须由精确提交 `4767c3d` 串行构建，生产 build/postbuild、八角色/Dashboard/企业 UI 合同和容器内健康通过。
2. 旧 Web 镜像必须有唯一可解析的 rollback 标签；正式备份必须为 root-only、非零、list 可读并在第二新空库恢复 39/head/226 表及相同保护指纹。
3. 只使用 `--no-deps --no-build --force-recreate web` 替换 Web；PostgreSQL、Worker、Caddy 和四个受保护 Volume 保持，不创建或运行 migrate。
4. 外部 HTTPS 根页/健康/legacy/CSS、新 bundle 八角色文字、private/no-store、安全头和匿名业务 API 401 通过；不登录或发送业务写请求。
5. 部署前后数据库保护指纹、Migration head、RFQ/Quote/Award/PO 事实一致，Session/Audit 不因本任务增加。
6. 资源阈值、OOM/restart、临时容器/恢复库和工件清理通过；正式备份与当前/rollback 镜像保留。
7. 同步项目文档并创建独立运维提交。

## 允许最终状态

- `ROLE-BASED WORKBENCH DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`
- `ROLE-BASED WORKBENCH DEPLOYMENT ROLLED BACK — NO DATA CHANGE`
- `ROLE-BASED WORKBENCH DEPLOYMENT BLOCKED — OLD WEB RETAINED`

## 完成结果

- 候选镜像：由精确功能提交 `4767c3db3cf66eb0978f07d044437790c0d4b87f` 串行构建，得到 `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`（88,560,525 bytes），并保留 `alpha40-role-hub-deploy04-candidate` 标签。
- 回退镜像：旧 Web `sha256:f139257b6b6b845bebbf9aa97eb909895158d637956f069b2c82f99b2b1d5b6d` 已固定为 `rollback-role-hub-deploy04-predeploy-20260806T083541Z`。
- 正式备份：`/var/backups/chenyida-erp/role-hub-deploy04-predeploy-20260806T084050Z/postgresql.dump` 为 `root:root 0600`、2,288,824 bytes，SHA-256 `dad839eff68d649e1098b0df33ba3316245a93f65893aea985d012362df266d6`，`pg_restore --list` 为 3,359 项。
- 恢复验证：备份已恢复到第二新库 `rfq_quote_fix27_restore_26080604`；39/head `0039_rfq_traceability.sql`、226 表、Session 207、Audit 1446、Quote/Award/PO `1/0/0` 和业务保护指纹均一致，随后删除恢复库与临时目录。
- 部署：仅以 `--no-deps --no-build --force-recreate web` 替换 Web。新容器 `b31654e386f1...` healthy、restart 0、OOM false；PostgreSQL 和 Caddy 容器身份/启动时间不变，Worker 镜像与容器身份不变并在备份一致性窗口后恢复运行。Migration 未创建或运行，四个受保护 Volume 未更换。
- 在线验收：公网 HTTP→HTTPS 308，HTTPS 根页、`/api/health`、legacy 均为 200；新 bundle 含管理员、采购、市场、计划、工程、财务、生产、仓库八个入口和新角色工作台样式。响应保持 `private, no-store`、`nosniff`、frame deny；匿名 Session 为 false/null、无 Set-Cookie，Summary/Materials 均为 401。
- 最终仓库校验：只读 Node 22 容器内 Dashboard/企业 UI 合同 `10/10`，凭据扫描 `1,243` 个仓库文件，`git diff --check` 通过；容器运行后自动删除。完整功能构建与回归证据沿用功能提交的 `73/73` UI、五组 typecheck、lint、production build/postbuild、npm/Python 全通过结果。
- 数据保护：部署前、恢复库和部署后的保护指纹均为 `597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`；主 RFQ 仍为 ISSUED v4、Binding 8、Supplier A/B Quote `1/0`、Quote/Award/PO `1/0/0`。Session 207/有效 1、Audit 1446 未因本任务增加；未登录或发送业务 POST。
- 稳定性：60 秒内 health `7/7` 为 200，SwapFree `782520→782520 KiB`。最终 available memory 约 2.1 GiB、Swap 260 MiB/1 GiB、根分区可用 19 GiB、Load `0.40/0.38/0.57`；内核 OOM 0，四服务 restart 0/OOM false。

## 保护过程与清理

- 首次备份尝试因运行时 `ERP_ENV=production` 被保护脚本在 dump 前拒绝；当前部署类别实际为 UAT，旧服务立即恢复且未产生备份文件。
- 一次 Compose 调用遗漏项目名，未停止实际 Web/Worker；该 dump 未被当作一致性备份并已精确删除，不可恢复。随后固定 `-p chenyida-erp-parallel`，确认实际 Web/Worker 均停止后重新完成正式备份。
- 一次 `compose start worker` 因 migrate 依赖被拒绝；已用原容器 ID 立即恢复旧 Web/Worker，数据库和 Volume 未变化，随后按精确 Web-only命令完成部署。
- 无临时容器、恢复数据库或临时目录残留；未运行 prune。正式备份、当前镜像、候选标签、回退镜像及四个受保护 Volume 按计划保留。

## 最终结论

`ROLE-BASED WORKBENCH DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`
