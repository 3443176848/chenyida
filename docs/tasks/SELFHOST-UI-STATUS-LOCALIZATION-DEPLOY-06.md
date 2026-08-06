# SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06 — ERP 可见状态中文化 Web-only 部署

## 状态与授权

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 完成：2026-08-06（Asia/Shanghai）
- 负责人：Codex（部署保护、当前事实核验、候选镜像、备份恢复、Web-only 替换、匿名只读在线验收、清理、文档与独立提交）；项目负责人（在源码任务完成后明确回复“授权”）
- 依赖：`SELFHOST-UI-STATUS-LOCALIZATION-05`、`SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04`
- 授权目标：把 `main@943c7fa5da44182617fa8a4f1d75b49b6d6c3795` 的可见状态中文化部署到当前 `https://43.135.148.43.nip.io:18888` 公开非生产 UAT。

## 唯一范围与影响

- 只构建并替换 `chenyida-erp-parallel-web-1`，使原生 React 与 legacy 兼容台显示共享中文状态、角色、审核/执行结果和启停文案。
- 替换前固定当前 Web 镜像的精确回退标签，执行当前业务保护指纹、root-only 一致性备份、list 与第二新空库恢复验证。
- 在线验收只允许匿名 HTTPS、健康、认证门禁、静态资源与 bundle 文本读取；不登录，不发送业务 POST，不创建 Session、Audit 或业务数据。
- 不运行 Migration，不修改 PostgreSQL、Worker、Caddy、Compose、环境变量、Origin、端口、防火墙、systemd、Swap 或四个受保护 Volume。
- 备份一致性窗口只短暂停止 Web/Worker；完成后恢复 Worker，并以已验证候选替换 Web。任何失败优先恢复旧 Web。
- `chenyida_erp_site/.openai/hosting.json` 属于历史 Sites/D1 运行面，本任务不发布历史 Sites，不让 D1 重新成为业务权威。

## 严格起点

- Git：clean `main@943c7fa5da44182617fa8a4f1d75b49b6d6c3795`，behind 0/ahead 158；功能提交为 `feat: localize visible ERP statuses`。
- 版本与数据库：源码/UAT Web `0.1.0-alpha.40`，PostgreSQL 39/head `0039_rfq_traceability.sql`、226 张 public 表，没有 0040。
- 当前 Web：`sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`；Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 当前实际数据：Session 209/有效 10、Audit 1,455；主 `RFQ-00000001` 为 `ISSUED v6`、Binding 8，Supplier A/B Quote `1/1`，Quote/Award/PO `2/0/0`。这与旧项目快照不同，本任务以只读实际值为准，不回退、不补写、不解释其来源。
- 起点匿名访问：HTTPS 根页与 health 200，匿名 Session false/null且无 Set-Cookie，Summary/Materials 401；明文请求直接发往 TLS 端口得到 400，不视为 HTTPS 服务异常。
- 起点资源：available memory 约 2.2 GiB，Swap 272 MiB/1 GiB，根分区可用 19 GiB，Load `0.25/0.24/0.43`；内核 OOM 0。

## 验收标准

1. 候选镜像必须由精确功能提交 `943c7fa` 串行构建，production build/postbuild、状态中文化/企业 UI/Dashboard 合同、npm 基线与容器内健康通过。
2. 旧 Web 镜像必须有唯一可解析的 rollback 标签；正式备份必须 root-only、非零、list 可读，并在第二新空库恢复 39/head、226 表及与当前主库相同的业务保护指纹。
3. 只使用 `--no-deps --no-build --force-recreate web` 替换 Web；PostgreSQL、Worker、Caddy 和四个受保护 Volume 保持，不创建或运行 migrate。
4. 外部 HTTPS 根页/health/legacy/状态词典与新 bundle 中文文本、private/no-store、安全头和匿名业务 API 401 通过；不登录或发送业务写请求。
5. 部署前后业务保护指纹、Migration head、当前 RFQ/Quote/Award/PO、Session/Audit 事实一致；如出现外部并发变化，必须停止并核验，不得把变化归因于本任务。
6. 资源阈值、60 秒稳定性、OOM/restart、临时容器/恢复库与任务工件清理通过；正式备份和 current/candidate/rollback 镜像保留。
7. 同步 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md` 并创建独立运维提交。

## 允许最终状态

- `STATUS LOCALIZATION DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`
- `STATUS LOCALIZATION DEPLOYMENT ROLLED BACK — NO TASK DATA CHANGE`
- `STATUS LOCALIZATION DEPLOYMENT BLOCKED — OLD WEB RETAINED`

## 完成结果

- 最终结论：`STATUS LOCALIZATION DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`。
- 候选镜像：从精确功能提交 `943c7fa5da44182617fa8a4f1d75b49b6d6c3795` 串行构建 `sha256:89e7677538751f2c0a049a113f3d24372a18edaf752bf837038580ac951bd153`（88,572,838 bytes），保留 `alpha40-status-localization-deploy06-candidate` 标签；镜像 revision/task 标签与授权任务一致。
- 回退镜像：部署前 Web `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`（88,560,525 bytes）已固定为 `rollback-status-localization-deploy06-predeploy-20260806T110008Z`。
- 正式备份：`/var/backups/chenyida-erp/status-localization-deploy06-predeploy-20260806T110129Z/` 为 `root:root 0700`；`postgresql.dump` 为 `0600`、2,291,624 bytes、SHA-256 `2beeaeb2ba2d7f7e5c07c7099d0d5985df1bb2ac6a67cc240bcfda0121418d99`，`pg_restore --list` 3,359 项。Uploads 1 个、Attachments 0 个文件也进入一致性备份。
- 恢复验证：第二新库 `cyd_status_deploy06_restore_20260806` 完整恢复 39/head `0039_rfq_traceability.sql`、226 张 public 表、Session 209、Audit 1,455、RFQ ISSUED v6/Binding 8、Supplier A/B Quote `1/1`、Quote/Award/PO `2/0/0`，业务指纹与主库相同；恢复库与恢复文件随后精确删除。
- 部署范围：只用 `--no-deps --no-build --force-recreate web` 替换 Web。新容器 `91d15f8d88e8…` healthy、restart 0、OOM false；PostgreSQL `f3a2f3cb…`、Worker `fb68d9a8…`、Caddy `c209765b…` 身份和镜像不变，Worker 只在一致性窗口短停后以原容器恢复。未创建或运行 migrate，四个受保护 Volume 保持原挂载。
- 在线验收：公开 HTTP 入口 308 到 HTTPS；HTTPS 根页、health、legacy、`status-localization.js` 和 `app.js` 均为 200。状态词典在线 SHA-256 `4ce87e370f2df0fe18e1c0b31997a60ad179d9dcbc927dfc1cb0ff8471da87d0`，legacy `app.js` 在线 SHA-256 `4efe1b1aff5a7c275bd1da26cd3c9c8b9d2b2a1e20dce08565f5a28d6cb61e63`，均与源码一致；缓存标识为 `20260806-status-localization-05`，中文角色、启停、提交/生效和审核结果文本存在。
- 匿名边界：Session 返回未认证 false/null且没有 Set-Cookie，Summary/Materials 返回 401；响应保持 private/no-store、nosniff 和 frame deny。没有登录、业务 POST、Session/Audit 新增或业务写入。
- 数据保护：部署前、恢复库、部署后及最终复核的业务指纹均为 `590579989e2c2c14d37a3970a2392cd5d486f61385adf171eacbb481d6bdbc24`（218 表、204 sequences）；主库最终仍为 39/head、226 表、Session 209、Audit 1,455、RFQ ISSUED v6/Binding 8、Supplier A/B Quote `1/1`、Quote/Award/PO `2/0/0`。以当前时间计算的未过期 Session 数会随时钟自然减少，不代表行写入；本任务以 Session 总行数、Audit 和业务指纹证明零任务写入。
- 自动验证：候选 production build/postbuild、状态中文化/企业 UI/Dashboard 合同 `13/13`、npm `3/3`、候选容器健康与静态合同通过；功能提交的 38 个 UI 文件、10 组 typecheck、lint、完整 build、npm/Python/credentials 证据保持。部署收口又通过 Python `server.py --self-test`、`smoke_test.py`、隔离临时 SQLite `go_live_check.py --no-backup` 和 1,249 文件 credentials 扫描，临时库已删除。
- 稳定性：公开域名连续 60 秒 health `7/7` 为 200，SwapFree `766600→766676 KiB`；终检 available memory 约 2.2 GiB、Swap 276 MiB/1 GiB、根分区可用 19 GiB、Load `0.21/0.20/0.24`，内核 OOM 0，四服务 restart 0/OOM false。

## 保护过程与清理

- 首次业务指纹容器以普通 `node` 用户读取 root-only 工具挂载时在连接数据库前失败；改用受限 root 用户后只读指纹通过，没有执行 SQL 写入。
- 最终通用 inspector 因其旧的固定 Migration 断言在查询指纹前失败关闭；随后直接调用同一 `businessFingerprint` 的 repeatable-read/read-only 实现完成 39/head 主库复核，没有绕过数据保护或修改断言。
- 一次对 `https://127.0.0.1:18888` 的稳定性探针因 SNI/TLS 主机名不匹配失败；该请求不计入应用健康结果，最终另以公开证书域名重新连续计满 60 秒并取得 `7/7`。
- 临时 worktree、候选 smoke、指纹容器、第二恢复库、恢复文件、在线响应文件和 Python 临时 SQLite 均已精确删除；未运行 Docker prune。正式备份以及 current/candidate/rollback 镜像按计划保留。

完成报告见 [SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06-COMPLETION.md](SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06-COMPLETION.md)。
