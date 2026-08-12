# SELFHOST-RELEASE-CANDIDATE-EVIDENCE-48 隔离候选镜像与安全证据闭环

> 状态：`DONE / ISOLATED CANDIDATE BUILT AND ZERO-FINDING DIAGNOSTIC VERIFIED / FORMAL SUPERVISOR GATE BLOCKED / NO DEPLOYMENT / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@d554a150a2f9cb4b672dc49785ed63bf3e0edfc8`
> 责任：Codex 主智能体为唯一写者、重任务调度者、证据集成者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人负责未来 host supervisor 安装、UAT/生产 Migration/deploy、真实数据、账号权限、员工试用和正式切换专项授权

## 1. 目标

关闭 D-116/PR-003/PR-005 中尚可在隔离环境安全推进的候选证据缺口：从一个精确已提交 Git commit/tree 串行构建 Web 与 Worker，固定 OCI 与 baked runtime 身份，取得可供严格合同消费的 registry digest 引用，使用固定 Trivy 0.70.0 与不超过 72 小时的漏洞数据库生成两镜像 CycloneDX SBOM 和零已知漏洞证据，并在不绕过 root supervisor 的前提下尝试同候选 18 步发布门。

项目负责人本轮明确授权“隔离环境中的测试、构建和迁移演练”。因此本任务允许本机隔离候选 build、只从公共源下载固定工具/漏洞数据库及使用临时 loopback registry；不允许向外部 registry 推送候选、不部署或重启 UAT/生产、不访问真实业务数据或受保护四卷。host supervisor 的持久安装仍属于宿主高权限发布能力启用，未获专项授权时不得执行或用环境变量旁路。

## 2. 已核验起点

- Git：唯一 worktree，`main@d554a150a2f9cb4b672dc49785ed63bf3e0edfc8`，相对 `origin/main` 为 behind 0/ahead 268；唯一既有未跟踪文件为 `docs/ERP_CURRENT_STATUS_REPORT.md`，继续不读、不改、不提交。
- 源码：`0.1.0-alpha.46`、45/head `0045_runtime_worker_readiness.sql`，0045 SHA-256 为 `cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`。
- UAT：只读事务确认 40/head `0040_warehouse_receipt_readiness.sql`、227 张 public 表；运行 Web image ID 仍为 `sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。本任务不得使其变化。
- 发布工具：18 步计划、镜像证据 producer、严格 manifest 及 content-addressed supervisor bundle 已存在；固定 Node 工具镜像在本机，固定 Trivy 镜像和新鲜数据库尚不存在。host supervisor 未安装，相关 launcher/bundle/authorization 路径均不存在。
- 资源：available memory 约 2.4 GiB，Swap 744 MiB/1.0 GiB（约 72.7%），根分区可用 27 GiB，Load `0.05/0.49/0.88`，内核 `oom_kill=0`；四服务 restart 0/OOM false，BuildKit cache 0B。

## 3. 验收标准

- [x] 候选构建只使用精确已提交、tracked-clean 的 Git commit/tree；Web 与 Worker 均从该身份构建，版本为 `0.1.0-alpha.46`，OCI version/revision 与 baked runtime env 精确一致且两镜像 config digest不同。
- [x] 构建、临时 loopback registry、工具拉取、漏洞数据库准备、扫描和全门测试严格串行；任一时刻最多一个本任务临时容器，绝不挂载 UAT/生产数据库或四个受保护 Volume。
- [x] 候选只推送到任务专用 loopback registry以取得registry digest，随后按digest回拉并核验；未登录或推送任何外部registry，未创建`latest`或模糊候选tag。
- [x] 固定 Trivy 0.70.0 镜像的完整digest/config/platform/binary身份；漏洞数据库metadata与payload tree digest在扫描前后相同且数据库年龄不超过72小时。
- [x] Web/Worker分别生成镜像级CycloneDX SBOM和漏洞报告；`CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN`均为0，未使用ignore、severity降级、过期数据库或lockfile清单冒充PASS。
- [x] 证据文件位于仓库外任务专用root-owned目录，采用无覆盖、只读、单硬链接合同；大制品、扫描数据库、镜像、日志、凭据和潜在敏感输出均未提交。
- [x] 正式镜像证据/18步门仍只允许D-116 installed content-addressed supervisor与一次性授权；host supervisor未获授权，两个仓库入口均已证明在任何制品变更前失败关闭，未设置或伪造supervisor环境变量，诊断结果未写成正式PASS。
- [x] 全程只读取现行`chenyida-erp-parallel`四服务Docker名称、状态、restart、OOM、health和image元数据并核对前后一致；未连接容器网络/API/数据库、读取日志/卷正文或修改服务。
- [x] 在可安全执行范围内完成仓库/隔离验证；发现的Debian SBOM合同漂移已以严格Wolfi+Node双覆盖修复并重建，没有降低断言或跳过REQUIRED步骤。
- [x] 每项重任务前后均记录memory、Swap、disk、Load、OOM/restart与临时资源；未触发本轮停止线。
- [x] 已同步更新项目、发布和运维文档，并准备独立聚焦治理提交。

## 4. 执行阶段

1. 只读审计候选构建、registry digest、Trivy DB、证据 producer、supervisor 与 18 步门的实际前置和清理路径。
2. 对发现的仓库合同缺口做最小修复并运行轻量/定向测试；形成精确候选源码提交。
3. 串行构建 Web、Worker，建立仅 loopback 可达的临时 registry digest 身份并清理 registry。
4. 拉取/核验固定 Trivy，生成新鲜数据库与两镜像 SBOM/漏洞结果；零发现才继续。
5. 在不越过 host supervisor 授权边界下尝试正式镜像证据与 18 步门；若外部授权阻塞，则冻结已完成证据、记录最小解除条件并转入其他安全任务。
6. 复核运行面未变、资源/临时资源、凭据/范围/`git diff --check`，更新治理资料并独立提交。

## 5. 禁止范围

- 除官方发布门所需的四服务Docker状态/restart/OOM/health元数据只读基线外，不连接、读取或修改 UAT/生产运行面；不访问业务API/数据库/日志，不运行 UAT/生产 Migration，不挂载或读取 `chenyida-erp-parallel_erp_postgres`、`chenyida-erp-parallel_erp_uploads`、`chenyida-erp-parallel_erp_attachments`、`chenyida-erp-parallel_erp_backup_status` 正文。
- 不向 GHCR 或其他外部 registry 推送候选，不发布 runtime identity，不创建 `ELIGIBLE` production release，不部署、重启或替换当前服务。
- 不安装 host supervisor，不创建长期 host authorization，不修改 systemd、Swap、网络、防火墙、内核或 Docker daemon；除非项目负责人另行给出专项明确授权。
- 不 prune，不删除既有镜像、备份、数据库、Volume 或用户文件；只清理本任务精确名称/路径的临时资源。
- 不读取、修改或提交 `docs/ERP_CURRENT_STATUS_REPORT.md`、`.env`、凭据文件、备份正文或 `shujvbiao/`。

## 6. 失败关闭与后续边界

本任务即使生成本地候选镜像和零漏洞证据，也不等于 UAT 或生产候选已晋升。只有正式 18 步同候选报告、不可变 release manifest、UAT 对齐与后续验收全部完成后，PR-003/PR-005 才能解除。host supervisor 安装、UAT Migration/deploy、真实异机恢复、岗位矩阵、真实迁移、员工试用和正式切换继续分别需要外部资源、业务批准或专项授权。

## 7. 阶段一至二证据（源码提交前）

- 三条只读审计与主智能体复核确认：正式installed bundle不含`drizzle-postgres`，原gate相对目录allowlist会确定性失败；Dockerfile的frontend/Node基线仍浮动；扫描证据没有构建来源回执；loopback digest只能作为当前Docker engine本地身份，不能冒充外部恢复锚点。
- D-123已在源码层修复：固定linux/amd64 Dockerfile frontend及Node完整digest；新增只从clean HEAD精确Git archive构建Web/Worker的串行入口、固定Registry 2.8.3 loopback回拉和不可变构建回执；scan provenance升级v2并强绑同run/candidate/reference构建回执；installed supervisor从可信bundle加载代码但显式读取候选仓库Migration目录。
- 依赖安装会按`package-lock.json`访问公共npm；只有应用build阶段断网。回执明确记录`PUBLIC_NPM_FETCH_WITH_LOCKFILE_INTEGRITY`、无外部registry锚点、无可复现build attestation及本机engine局限，未夸大为完全离线或可恢复镜像。
- 固定Node单容器定向38/38、官方release-contract 6文件/48项、lint 0 error/11条既有warning及Shell/差异检查通过；临时容器均精确删除，available约2.3—2.4 GiB、Swap约72%、根盘27 GiB、OOM0，四个UAT服务restart0/OOM false且health元数据不变。
- 仍未执行候选build、Trivy数据库准备/扫描、正式supervisor动作或18步门；上述验证只证明仓库合同可进入精确已提交候选阶段。

## 8. 最终候选与不可变证据

- Git链：运行层/依赖加固源码提交`864789c80b0bf7bca10df1b6a4067deb5154b42c`，其bundle直接子提交`cc9ebbf48bc16da5b685fc919bb0f55e8f6e5a44`；严格Wolfi扫描覆盖合同提交`13c422944c1eb7c4de83ac0b40414b7b1b822a18`，最终canonical bundle直接子提交`8952a815cac837d201ff821df16d4a21b61711c4`。最终候选精确tree为`1ac733601c26564347a5bd5cabeda0e42142faf4`，bundle manifest绑定父源码且SHA-256为`53729db38bd6515f3508422f1f23973a7901c2cd840dfe2d34b2046aa21561f9`。
- 构建回执：`/var/lib/chenyida-erp/release-artifacts/task48-alpha46-8952a815cac8/task48-alpha46-8952a815cac8.build-provenance.json`为root:root `0440`、单硬链接，SHA-256为`dc24889dbfe986def5b61f6d02cc0df9b573579e16eb4f58860937b3987b34d9`；合同为`candidate-build-provenance/v3`，绑定精确Git archive、Dockerfile/lockfile/producer、构建/运行基础镜像、Wolfi APK和Migration allowlist。
- Web：本机digest引用`127.0.0.1:32772/chenyida-erp/web@sha256:27868850dacca381ab28c2c12c32504d8df21dad851f0784c60f60c2a7592288`，config digest`sha256:161ea63b6242b9d6bffc6535890a3db20805a3121e1516e7d2bf6dbd537f6c53`；Worker引用`127.0.0.1:32772/chenyida-erp/worker@sha256:e85ce23673cda8b5107f167731859b4a05bb921b1d8af499e7ba87dad1dee77c`，config digest`sha256:f8dc4ac7b20a12f09aa1036f6dfb76152d4e345d16f94a51e39a5349566817c1`。loopback registry已删除；这些引用只在当前本机engine可解析，不是外部恢复锚点。
- 运行层：两镜像均为Wolfi `20230201`、`nodejs-22-minimal=22.23.2-r1`、UID/GID`65532:65532`且无npm。Web不含`image-size`、Migration目录/文件分别为`0555/0444`，无数据库配置时`/api/live`返回`200/LIVE/alpha.46`；Worker保留精确生产依赖、剔除开发依赖，缺少数据库配置时以状态1和净化`RUNTIME_READINESS_FAILED`失败关闭。

## 9. 扫描、测试与资源结果

- 固定Trivy镜像为`ghcr.io/aquasecurity/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c`。数据库schema 2，UpdatedAt`2026-08-12T13:01:58.90781992Z`、DownloadedAt`2026-08-12T19:13:44.99203311Z`；扫描开始时分别距今7.5小时和1.3小时，payload tree在扫描前后均为`def6b0231ddeedfecbeff0d8d9ce2d1663905f722189915fbd3e8fead254986b`。
- 扫描使用`docker image save`归档、断网、无Docker socket、只读rootfs、固定Trivy、全部pkg type/severity、无ignore。Web归档config与回执一致，覆盖25个Wolfi包+63个npm包；Worker覆盖25+60。两镜像`UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL`全部为0，当前严格原生JSON与CycloneDX合同均直接接受。
- 四份root:root`0440`单硬链接诊断制品位于上述artifact root：Web CycloneDX/Trivy SHA-256分别为`622ffbdf273e2b5ff883d621e042dd4aaa77916bf035028b63d436be15da2d4f`/`17821da06332caa44bddb231ffc6b1de4471d143b0a93a9384440c8dd649c74a`；Worker分别为`588569d59f3a76079850e7898acc5f2c504e5fa39bb50c6d3f1680be8070edd5`/`32751ea379d7a432516c1abd1af94ca65bce0c238fcdec0d47595ec78e619c93`。它们明确标记`diagnostic`，不替代正式supervisor provenance/SBOM/security evidence。
- 仓库验证：6文件发布合同48/48、supervisor Python 20/20、release typecheck、lint 0 error/11项既有warning、1,575文件credentials和`git diff --check`通过；真实前序扫描报告也被修正后的严格合同直接接受。
- 起点约available 2.4GiB、Swap744MiB/1GiB、根盘27GiB；最终available 2.2GiB、Swap734MiB（72%）、根盘18GiB、Load`0.31/0.32/0.37`、内核`oom_kill=0`。四个UAT服务全过程restart0/OOM false、Web/PostgreSQL health仍healthy、Worker/Caddy仍无health且image ID不变；任务临时registry、容器、tar和目录已清零。成功候选镜像、Trivy数据库与只读证据按审计需要保留，未prune或删除其他资源。

## 10. 完成结论与外部阻断

- 直接调用正式镜像证据入口在制品变更前以`release image evidence must be launched by the installed supervisor`退出1；18步入口同样以`release gate must be launched by the installed supervisor`退出1，artifact root摘要前后完全一致。`/usr/local/libexec/chenyida-erp-release-supervisor`不存在，未安装、旁路或伪造授权。
- TASK48因此按“完成全部可安全隔离工作并证明正式边界失败关闭”收口。当前候选是本机隔离零发现诊断候选，不是`ELIGIBLE`、UAT或production release；源码/UAT仍为alpha.46/0045对alpha.42/0040。
- 正式镜像证据与18步门的最小解除条件是：项目负责人专项授权安装当前content-addressed host supervisor并生成两份root-only一次性授权。外部registry不可变锚点、UAT Migration/deploy、真实数据、账号、员工试用和切换仍分别需要后续资源或专项授权。
