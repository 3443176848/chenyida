# SELFHOST-UI-REFRESH-DEPLOY-02 — 企业级 UI Web-only 部署与只读验收

## 状态与授权

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 完成：2026-08-06（Asia/Shanghai）
- 负责人：Codex（保护基线、备份恢复、候选镜像、Web-only 替换、只读在线验收、清理与文档）；项目负责人（2026-08-06 在 `SELFHOST-UI-REFRESH-01` 完成后明确授权部署）
- 依赖：`SELFHOST-UI-REFRESH-01`、`SELFHOST-UAT-FIX-27`
- 授权目标：把 `aac6f34` 的企业级 UI 部署到当前 `https://43.135.148.43.nip.io:18888` 非生产 UAT。

## 唯一范围

- 只构建并替换 `chenyida-erp-parallel-web-1`，部署登录、经营工作台、原生业务壳和 legacy 兼容业务台的新 UI。
- 正式替换前固定当前 Web 镜像回退标签，执行数据库保护指纹、受控备份/list/第二新库恢复验证。
- 在线验收只允许匿名 HTTPS、健康、认证门禁、静态资源/缓存版本与响应头读取；不登录任何账号，不执行业务 POST，不创建 Session 或业务数据。
- 不运行 Migration，不改 PostgreSQL、Worker、Caddy、Compose、环境变量、Origin、端口、防火墙、systemd、Swap 或四个受保护 Volume。
- 不部署历史 OpenAI Sites/D1 运行面，不进入真实生产迁移或切流。

## 严格起点

- Git：clean `main@aac6f349f39e81b886916c639cbfc8a541bd0b7b`（短 SHA `aac6f34`），`origin/main...HEAD` behind 0 / ahead 154。
- 版本与数据库：源码/UAT Web `0.1.0-alpha.40`，PostgreSQL 39/head `0039_rfq_traceability.sql`，没有 0040。
- 当前 Web：`sha256:20b41bd34741758e707f3748baaa1018232df6be5d44cd63bed290fd49c9f4f9`；线上 legacy 缓存仍为 `20260731-csrf-bom-immutable-fix-05`。
- 容器：Web/PostgreSQL healthy，Worker/Caddy running；已核对的 Web/PostgreSQL restart 0/OOM false，其余服务将在替换前补齐精确基线。
- 资源：available memory 约 2.2 GiB，Swap 289 MiB/1 GiB，根分区可用 18 GiB，Load `0.21/0.35/0.43`。

## 验收标准

1. 候选镜像必须由 `aac6f34` 的精确站点源码串行构建，生产 build/postbuild 和企业 UI/既有 Dashboard 合同通过。
2. 旧 Web 镜像必须有唯一、可解析的 rollback 标签；新镜像须通过离线静态资产合同与容器内健康检查。
3. 只使用 `--no-deps --no-build` 替换 Web；PostgreSQL、Worker、Caddy 容器身份和四个受保护 Volume 不变，不运行 `migrate`。
4. 外部 HTTPS `/`、`/api/health`、`/erp/index.html`、新 CSS/JS 缓存版本和匿名业务 API 认证门禁通过；不得登录或发送业务写请求。
5. 部署前后数据库保护指纹、Migration head、RFQ/Quote/Award/PO 事实一致。
6. 资源阈值、OOM/restart、临时容器/恢复库和工件清理核对通过；旧 Web rollback 镜像与正式备份保留。
7. `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`RELEASES.md` 同步，并创建独立运维提交。

## 允许最终状态

- `ENTERPRISE UI DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`
- `ENTERPRISE UI DEPLOYMENT ROLLED BACK — NO DATA CHANGE`
- `ENTERPRISE UI DEPLOYMENT BLOCKED — OLD WEB RETAINED`

## 完成结果

- 正式备份 `/var/backups/chenyida-erp/ui-refresh-deploy02-predeploy-20260806T080240Z.dump` 为 root:root 0600、单硬链接、2,288,827 bytes、SHA-256 `8dd0141bb047d75b0bfea87011d7ac56db46d27b7fe51907045b8a173c93de7d`；`pg_restore --list` 3,359 项。
- 第二新库恢复为 39/head、226 张 public 表，Session 207/有效 10、Audit 1,446，业务保护指纹 `597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f` 完全一致；恢复库随后精确删除。
- 旧 Web `sha256:20b41bd34741758e707f3748baaa1018232df6be5d44cd63bed290fd49c9f4f9` 已固定为 `rollback-ui-refresh-deploy02-predeploy-20260806T080240Z`。候选镜像由 `aac6f34` 构建为 `sha256:f139257b6b6b845bebbf9aa97eb909895158d637956f069b2c82f99b2b1d5b6d`、88,560,352 bytes。
- Docker build 内生产五阶段和 postbuild consistency 通过；企业 UI 4/4、Dashboard UI 5/5、npm 3/3、Python 三项、1,240 文件 credentials 和 diff check通过；候选静态合同、临时容器运行健康和匿名 401 门禁通过。首次多端点临时检查因 `docker exec` 未开启 stdin 未实际执行，未计为通过；启用只读 stdin 后完整重跑通过。
- 仅以 `--no-deps --no-build --force-recreate web` 替换 Web。PostgreSQL、Worker、Caddy 容器 ID/启动时间保持，`migrate` 未创建或运行，四个受保护 Volume 未更换。
- 外部 HTTPS 根页/健康/legacy/CSS 为 200；根 bundle 含新认证壳、统一业务门户和缓存版本 `20260806-enterprise-ui-refresh-01`，CSS 含 `#2468c5`、可见焦点与 reduced motion。匿名 Session 为 false/null、不发 Cookie，Summary/Materials 均为 401；安全响应头与 private/no-store 保持。
- 部署后主库仍为 39/head、226 表、Session 207/有效 10、Audit 1,446；保护指纹及 RFQ/Binding/Supplier A/B Quote/Quote/Award/PO 事实完全一致。未登录、未发送业务 POST、未创建 Session 或 Audit 增量。
- 60 秒稳定观察 7/7 health 200，SwapFree `750084→750088 kB`，无 Swap 增长；四服务 RestartCount 0/OOM false，内核 OOM 0。
- 资源从 available 约 2.2 GiB、Swap 289 MiB、根盘 18 GiB、Load `0.21/0.35/0.43` 到约 2.2 GiB、Swap 292 MiB、根盘 19 GiB、Load `0.28/0.49/0.49`。临时容器、恢复库和Python临时SQLite清零，工作区无 `.vinext`；正式备份、当前/候选/rollback 镜像与四卷保留，未 prune。

## 最终结论

`ENTERPRISE UI DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`。新界面已在 `https://43.135.148.43.nip.io:18888` 生效；本任务没有执行登录式浏览器验收、业务写入、Migration 或生产切流。
