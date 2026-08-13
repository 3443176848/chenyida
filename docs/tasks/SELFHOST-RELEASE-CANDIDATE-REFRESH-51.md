# SELFHOST-RELEASE-CANDIDATE-REFRESH-51 当前精确候选重建与发布门复核

> 状态：`DOING / LOCAL ISOLATED CANDIDATE ONLY / NO HOST INSTALL / NO DEPLOYMENT / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@11785d4dac3e1afeb936f7a7a0626a25443fa371` / tree `91a6e752c3265e98208f4ae18a2e8437ecffe2fa`
> 责任：Codex 主智能体为唯一写者、重任务调度者、证据集成者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人负责未来 host supervisor 安装、UAT/生产 Migration/deploy、真实数据、账号权限、员工试用和正式切换专项授权

## 1. 任务目标

从 TASK50 已验证的内容寻址运行时合同继续，重建代表当前精确 Git commit/tree 的 Web 与 Worker 本机隔离候选，重新核对 OCI/baked 身份、六服务运行时策略、镜像级 SBOM 与全部 severity 零发现，并在不绕过 installed supervisor 的前提下尝试当前 19 步发布门。

TASK48 的 `8952a815`候选及零发现报告继续保留为历史证据，但 TASK49/TASK50 改变了当前候选输入，不能复用为当前 HEAD 的发布结论。本任务只关闭仍可在本机隔离环境安全推进的刷新证据；本地镜像、诊断报告或单项测试通过都不等于`ELIGIBLE`、UAT部署或投产批准。

## 2. 授权与保护边界

- 允许仓库内安全、可回滚的最小构建/证据合同修复、测试和文档；允许从精确 clean Git snapshot 串行构建本机候选、使用任务专用 loopback registry、固定公共工具/漏洞库只下载及隔离扫描。
- 允许只读核验宿主资源、Docker版本/镜像/cache元数据、现行四服务name/image/status/health/restart/OOM/ReadonlyRootfs及源码Migration元数据；不得读取UAT业务表、容器环境、日志、`.env`、受保护Volume或备份正文。
- 不安装host supervisor，不创建host授权，不修改systemd、network/firewall、Swap、kernel或Docker daemon；不向外部registry推送源码或镜像。
- 不部署、重建、重启或登录现行UAT/生产，不运行UAT/生产Migration，不发布runtime identity，不生成或宣称`ELIGIBLE`生产候选。
- 不prune或删除既有镜像、cache、备份、数据库或Volume。只精确清理TASK51创建且已核对名称/标签/路径的临时容器、registry、网络、tar和目录；四个受保护Volume永不删除或挂载。
- 不读取、修改或提交项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`。

## 3. 起点事实

- Git：唯一worktree为`main@11785d4dac3e1afeb936f7a7a0626a25443fa371`/tree`91a6e752c3265e98208f4ae18a2e8437ecffe2fa`；唯一既有未跟踪文件为受保护状态报告。TASK50实现`375869f`与manifest-only子提交`f119c8f`形成44文件supervisor bundle，SHA-256为`ab6b708e…8cbe`。
- 源码：`0.1.0-alpha.46`，PostgreSQL Migration为45/head`0045_runtime_worker_readiness.sql`，SHA-256为`cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`；Schema/Migration工作区无差异。
- 历史候选：TASK48 Web/Worker本机manifest分别为`sha256:27868850…92288`/`sha256:e85ce236…ee77c`且镜像仍可解析，但绑定较早`8952a815`；不能冒充当前候选或外部恢复锚点。
- 容器工具：Docker Engine 29.5.2、Compose 5.1.4；当前19步计划与TASK50 policy SHA-256`8c9f9fd0…f444`已通过仓库和六服务隔离验证。host installed supervisor仍未获授权。
- UAT：PostgreSQL/Web/Worker/Caddy均restart0/OOM false，Web/PostgreSQL healthy、旧Worker/Caddy health none，四服务仍`ReadonlyRootfs=false`；运行Web仍为alpha.42镜像。四个受保护Volume存在且本任务不挂载。
- 资源：available约2.2 GiB、Swap714 MiB/1 GiB、根盘18 GiB、Load`0.23/0.35/0.43`；Docker images约23.09 GB、Build Cache约6.977 GB。资源虽未触发停止线，但构建必须串行并在每个重步骤前后复核。

## 4. 验收标准

- [ ] 三条智能体线只读审计构建/迁移输入、应用/runtime测试、scanner/资源/清理和supervisor边界；主智能体复核并记录结论，保持唯一写者。
- [ ] 候选只从一个精确已提交、tracked-clean Git commit/tree构建；Web/Worker version、OCI revision/version、baked runtime身份、Migration allowlist及各自manifest/config digest严格一致且可复核。
- [ ] 构建和临时loopback registry严格串行；按digest回拉/解析，任一时刻最多一个TASK51临时容器，不创建`latest`或外部tag，不挂载四个受保护Volume。
- [ ] TASK50六服务Compose policy与实际候选runtime probe在当前候选上通过；只读rootfs、capability/NNP、用户/组、唯一可写路径、PostgreSQL/Caddy例外及清理没有回退。
- [ ] 固定Trivy 0.70.0及不超过72小时、扫描前后payload tree一致的数据库对Web/Worker分别生成原生漏洞报告与CycloneDX；Wolfi+Node包覆盖完整，`UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL`全部为0，禁止ignore或severity降级。
- [ ] 构建/扫描证据位于仓库外任务专用root-owned目录，使用无覆盖、只读、单硬链接合同；报告明确标注本机diagnostic，不把本机engine引用冒充外部锚点或正式证据。
- [ ] 正式镜像证据与19步门只经installed content-addressed supervisor入口；未获host安装授权时必须在制品变化前失败关闭，不设置伪造环境变量、不直接调用producer/runner冒充PASS。
- [ ] 适用release/supervisor/runtime/credential/lint/Shell/JSON/Markdown及diff门通过；任何真实失败均修复或记录，不跳过REQUIRED、不降低断言。
- [ ] UAT四服务image/status/health/restart/OOM和四卷集合前后一致；不连接API/数据库、读日志/环境/卷正文或执行业务写/Migration/deploy。
- [ ] 重任务前后记录memory、Swap、disk、Load、OOM/restart和TASK51临时资源；不触发停止线，不清理非TASK51资源。
- [ ] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`与必要运行手册，形成独立Git提交。

## 5. 执行阶段

1. 登记唯一任务并由三条智能体线完成只读输入/风险审计，主智能体核对实际Git、Migration、Docker、旧候选、扫描数据库、supervisor和资源状态。
2. 先修复任何阻止精确构建、runtime policy或严格镜像证据的最小仓库合同问题，并完成轻量测试和内容寻址bundle链；没有缺口则不制造代码变化。
3. 串行构建Web/Worker，在任务专用loopback registry取得manifest digest并按digest核对；精确清理registry和临时构建资源。
4. 串行执行当前候选六服务runtime probe及固定Trivy离线扫描；只有全部severity为0且包覆盖/数据库完整才继续。
5. 从正式入口尝试镜像证据和19步门；host supervisor未授权时记录失败关闭证据，不安装或旁路。
6. 完成资源、安全、范围、UAT不变和临时清理复核，更新治理文档并独立提交；然后自动选择下一项未阻塞安全任务。

## 6. 当前结论

任务已启动，整体仍为`PRODUCTION NO-GO`。本轮刷新最多能建立当前HEAD的本机隔离候选与诊断证据；host supervisor、外部镜像锚点、异机真实恢复、UAT Migration/deploy、岗位权限、真实迁移、员工试用和正式切换均不在本任务授权内，不能因候选构建或零发现而宣称可投入真实员工使用。
