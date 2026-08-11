# SELFHOST-PRODUCTION-READINESS-40 投产事实基线与失败关闭准入门禁

> 状态：`DONE / PRODUCTION NO-GO BASELINE ESTABLISHED`
> 日期：2026-08-12（Asia/Shanghai）
> 起点：`main@bc14eb022528b8d0f242fec1d31ee41b9166b4cd`
> 责任：Codex 主智能体负责唯一写入、证据归并、验收、文档和 Git 提交；数据迁移、应用测试、运维安全三个子智能体只读审计；项目负责人负责后续生产数据、异机目标、真实用户和正式切换专项授权

## 1. 任务目标

以实际 Git、源码、镜像、Migration、运行服务、数据库只读元数据、备份设施和服务器资源为证据，建立当前自托管 Node.js/PostgreSQL 方向的投产差距基线。任务必须给出失败关闭的当前结论、带依赖与验收标准的推进路线、可自主执行项和必须专项授权项，不能把页面可访问、历史测试通过或非生产 UAT 等同于可投产。

## 2. 严格起点

- 根仓库为唯一 worktree，`main@bc14eb022528b8d0f242fec1d31ee41b9166b4cd`；本地相对 `origin/main` ahead 220。`recovery-private/main`落后当前本地一个提交，当前源码提交尚未形成最新私有 Git 恢复锚点。
- 用户既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不暂存、不提交。
- 源码为`0.1.0-alpha.44`、Migration 41/head `0041_ai_governance_suggestion_evidence.sql`；并行非生产 UAT 实际运行`0.1.0-alpha.42`、source revision `569aa954d764309e239d1f6c174e582596d33a24`、数据库 40/head `0040_warehouse_receipt_readiness.sql`。
- Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0、OOMKilled false；公开与回环 health 均返回 alpha.42。Python/SQLite 开发服务仍 active，仅监听回环端口，不是未来生产底座。
- PostgreSQL、uploads、attachments、backup-status 四个受保护卷存在；`/var/backups/chenyida-erp`只有本机 root-only 备份，没有已核验的异机数据锚点、自动备份 timer 或近期隔离恢复证据。既有 backup/restore 脚本明确只允许非生产停机备份，尚不是可投产备份体系。
- 起点资源约为 available memory 2.0 GiB、Swap 386 MiB/1.0 GiB、根分区可用 31 GiB、Load `0.12/0.17/0.13`；未触发低资源停止线。

## 3. 允许范围

- 只读检查 Git、Docker/Compose、systemd、health、镜像标签、Migration 元数据、数据库只读事务、备份目录元数据和服务器资源；
- 三个子智能体分别审计数据迁移、应用测试、运维安全，默认不改文件；
- 新增投产差距证据、依赖路线、验收门禁和授权矩阵；
- 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`ROADMAP.md`、`CHANGELOG.md`和`STATUS.md`中经核验的事实；
- 运行不写生产数据的文档、控制器、静态和低资源测试，创建聚焦 Git 提交。

## 4. 禁止范围

- 不读取或修改正式生产数据，不执行业务写、账号/权限变化、真实数据迁移、正式备份恢复、部署、切流、停机或回滚；
- 不 build 镜像、不运行 UAT/生产 Migration、不重建或重启 Compose/systemd 服务；
- 不上传数据库 dump、真实附件或凭据到外部目标，不创建/修改网络、防火墙、systemd、Swap、内核或 Docker daemon；
- 不读取凭据正文、备份正文、受保护卷业务正文或用户未跟踪状态报告；
- 不删除镜像、容器、Volume、备份、业务数据或用户文件，不执行 prune；
- 不自动恢复`PHASE4-TASK03`、不运行正式 holdout、不扩大 AI 功能范围。

## 5. 交付物

1. `docs/project/PRODUCTION_READINESS.md`：证据化现状、P0/P1差距、失败关闭结论、依赖路线、逐阶段验收和授权矩阵。
2. 三条只读审计结论归并记录，明确事实、推断和未验证范围。
3. 项目权威文档同步，旧的“零 DOING / 无自动下一任务”基线改为本次项目负责人明确授权的持续交付状态。
4. 独立 Git 提交；既有未跟踪文件保持未读、未改、未提交。

## 6. 验收标准

- [x] Git/source/image/Migration/runtime 身份差异均有精确证据且没有混称生产版本。
- [x] 数据迁入、核对、异机备份、隔离恢复、回滚和真实切换的缺口与依赖完整登记。
- [x] 核心服务端规则、权限、会话、安全、审计、错误处理、自动测试和人工验收缺口完整登记。
- [x] 监控、容量、告警、升级、回滚、故障手册和低资源稳定性缺口完整登记。
- [x] 每个阶段有进入条件、验收证据、失败处理、责任和专项授权边界。
- [x] 当前结论明确为`PRODUCTION NO-GO`，且只由证据解除，不因文档完成而升级。
- [x] 适用低资源测试、Markdown 链接、`git diff --check`、安全范围和敏感信息门禁通过。
- [x] 记录任务前后内存、Swap、磁盘、Load、OOM/restart及临时资源清理结果。
- [x] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`和`STATUS.md`并创建独立 Git 提交。

## 7. 后续调度原则

本任务完成后不等待重复“继续”指令。主智能体从已核验路线中选择最高优先级、未阻塞且不需要新增生产授权的任务继续推进；遇到生产数据、异机上传、部署、身份权限或正式切换边界时停止该动作并转向其他安全任务。只有全部安全任务均被阻塞时，才向项目负责人提出一个最小化问题。

## 8. 完成证据

- 三条只读审计均独立得出`NO-GO`，主智能体复核源码、运行版本、UAT Migration 元数据、备份/恢复脚本、默认测试门、导入 fallback、health、会话和备份状态投影。
- 新增[投产准入基线](../project/PRODUCTION_READINESS.md)，记录十二项门禁、PR-001—PR-007 P0、P1、G0—G10依赖路线、逐阶段验收、失败处理和专项授权矩阵。
- 验证通过：Markdown 本地链接 88 个、控制器/协议 unittest 134/134、R1 实况`IDLE`、Python self-test/smoke/go-live 3/3、断网只读 Node 默认测试 3/3；lint退出0并诚实保留11个既有warning。Compose ps因当前Shell未注入`DATABASE_URL`而失败关闭，未读取env重试，改以Docker inspect确认服务状态。
- 起点/收口资源约为 available memory 2.0/2.0 GiB、Swap 386/389 MiB、根盘31/31 GiB，收口Load`2.09/0.98/0.50`且低于停止线；四服务restart 0、OOMKilled false，任务窗口内核OOM 0。
- 没有创建临时容器、数据库、镜像、Volume或备份；没有访问业务行、凭据、备份正文、受保护卷正文或用户未跟踪报告。
- 任务启动提交为`d890987`；完成提交消息固定为`docs: establish production readiness baseline`，实际 SHA 以`git log`为准。
