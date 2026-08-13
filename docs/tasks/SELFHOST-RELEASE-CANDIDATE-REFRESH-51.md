# SELFHOST-RELEASE-CANDIDATE-REFRESH-51 当前精确候选重建与发布门复核

> 状态：`DONE / CURRENT EXACT LOCAL CANDIDATE BUILT / ZERO-FINDING DIAGNOSTIC VERIFIED / FORMAL SUPERVISOR GATE BLOCKED / NO DEPLOYMENT / PRODUCTION NO-GO`
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

- [x] 总目标启动时三条智能体线已完成投产差距只读审计；TASK51尝试新开三线时平台返回agent thread limit，主智能体按数据/应用/运维三域清单复核当前事实并保持唯一写者，未将并发限制冒充独立复核。
- [x] 候选只从一个精确已提交、tracked-clean Git commit/tree构建；Web/Worker version、OCI revision/version、baked runtime身份、Migration allowlist及各自manifest/config digest严格一致且可复核。
- [x] 构建和临时loopback registry严格串行；按digest回拉/解析，任一时刻最多一个TASK51临时容器，不创建`latest`或外部tag，不挂载四个受保护Volume。
- [x] TASK50六服务Compose policy与实际候选runtime probe在当前候选上通过；只读rootfs、capability/NNP、用户/组、唯一可写路径、PostgreSQL/Caddy例外及清理没有回退。
- [x] 固定Trivy 0.70.0及不超过72小时、扫描前后payload tree一致的数据库对Web/Worker分别生成原生漏洞报告与CycloneDX；Wolfi+Node包覆盖完整，`UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL`全部为0，未使用ignore或severity降级。
- [x] 构建/扫描证据位于仓库外任务专用root-owned目录，使用无覆盖、只读、单硬链接合同；报告明确标注本机diagnostic，不把本机engine引用冒充外部锚点或正式证据。
- [x] 正式镜像证据与19步门只经installed content-addressed supervisor入口；未获host安装授权时在制品变化前失败关闭，未设置伪造环境变量或直接调用producer/runner冒充PASS。
- [x] 适用release/supervisor/runtime/credential/lint/Shell/JSON/Markdown及diff门通过；真实digest语义失败已修复并记录，未跳过REQUIRED或降低断言。
- [x] UAT四服务image/status/health/restart/OOM和四卷集合前后一致；未连接API/数据库、读日志/环境/卷正文或执行业务写/Migration/deploy。
- [x] 重任务前后记录memory、Swap、disk、Load、OOM/restart和TASK51临时资源；未触发停止线，未清理非TASK51资源。
- [x] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`与必要运行手册，形成独立Git提交。

## 5. 执行阶段

1. 登记唯一任务并由三条智能体线完成只读输入/风险审计，主智能体核对实际Git、Migration、Docker、旧候选、扫描数据库、supervisor和资源状态。
2. 先修复任何阻止精确构建、runtime policy或严格镜像证据的最小仓库合同问题，并完成轻量测试和内容寻址bundle链；没有缺口则不制造代码变化。
3. 串行构建Web/Worker，在任务专用loopback registry取得manifest digest并按digest核对；精确清理registry和临时构建资源。
4. 串行执行当前候选六服务runtime probe及固定Trivy离线扫描；只有全部severity为0且包覆盖/数据库完整才继续。
5. 从正式入口尝试镜像证据和19步门；host supervisor未授权时记录失败关闭证据，不安装或旁路。
6. 完成资源、安全、范围、UAT不变和临时清理复核，更新治理文档并独立提交；然后自动选择下一项未阻塞安全任务。

## 6. 实施与证据

### 6.1 真实失败与身份修复

- 从启动提交`79f8dee0cadcf237463b3bb45d3fff35421eebcc`构建的首个候选使静态Compose合同通过，但实际runtime probe以`IMAGE_CONFIG_DIGEST_MISMATCH`失败。Docker 29.5.2/containerd image store实况证明`.Id`及`.Descriptor.digest`是manifest digest，OCI config digest在`.Descriptor.annotations["config.digest"]`；TASK50旧调用曾把manifest误传成config并掩盖探针缺陷。
- D-128固定manifest/config双身份。修复提交`12beccf0d1c49ec9c67c77e128849d807f52390e`/tree`a195669a8e251addf9f9f367df9c095994945b07`分别核对精确RepoDigest manifest与构建回执config；其唯一直接子提交`8084d6c3e38e4246b79791414e84bfe2da4ea8f8`只刷新44文件canonical bundle，bundle SHA-256为`f4481316abb5e3c69e5fd8cb92891f9a2880a2f2375e2611cda3628cf84f5ce6`。
- 新增正确双身份、错误manifest和错误config负向测试；supervisor回归为31/31。首个`79f8dee`候选只保留为缺陷发现诊断，不是最终候选或晋升证据。

### 6.2 最终候选、运行时与安全诊断

- 最终候选从clean `8084d6c3e38e4246b79791414e84bfe2da4ea8f8`/tree`a54473f6b05cdfaa014f286149a740b90d5067fe`的精确Git archive串行构建。root-only构建回执为`/var/lib/chenyida-erp/release-artifacts/task51-alpha46-8084d6c3e38e/task51-alpha46-8084d6c3e38e.build-provenance.json`，SHA-256`f490b96984579b0b99fd9cdcc0f7dd70726dd68f7c6b7d226939415ed972c1b2`；源码归档为60,938,240 bytes、SHA-256`1e9500e63c3e003c2cfecf64a7cd829233f0399c4c2d91b88057855028e686fa`，Migration allowlist摘要`09d34ac7f6e26fb2570d22b95866d212a2b4dda4e651d1b1b51ed3e0e79504a1`。
- Web manifest/config为`sha256:249d0ce44a595f306e6423219d530bcf3d017e5c87bcd4da13d103def8b75b7f`/`sha256:7c7b0d388ce74747c1bcaef4b2d18118ee0d56789870bf403f12ba2e53c63de5`；Worker为`sha256:0e07fded39ce07122246752a29a2960493811b55f9aa9059e7d674bf90eb8370`/`sha256:af000408278ce6e7c2db822a4151a523a2b39c6f2a01b217ff4001c679484e88`。两者均绑定alpha.46、同一revision、UID/GID65532；loopback registry已删除，引用只在当前engine可解析且不是异机锚点。
- Compose静态合同与修正后六服务runtime probe均通过，策略SHA-256为`8c9f9fd06eb4533faeeed4c316eb93568c38b3a42ac8c48dd081fbb4e7a2f444`、`max_containers=1`。没有把TASK50旧双身份断言继续当成有效证据。
- 固定Trivy 0.70.0在断网、无Docker socket、只读rootfs的逐archive扫描中使用schema2数据库；UpdatedAt距扫描11.8小时，payload tree扫描前后均为`def6b0231ddeedfecbeff0d8d9ce2d1663905f722189915fbd3e8fead254986b`。Web覆盖Wolfi25+npm63、Worker25+60，全部severity为0且CycloneDX漏洞数为0。
- 四份root:root `0440`单硬链接诊断制品SHA-256分别为Web Trivy`28dedbc0d5f1d7d6c7b9f90ac0d349b268a1994a2ab243c6225373b90bb6cd06`、Web CycloneDX`f59717bc1510834dade50d0cc998f853c5477a969ce7b29784b987d74cee7804`、Worker Trivy`2d03bd342a630fd8c62fd96a3c0a9e5deb114af306663dc7846f1fcebec6200f`、Worker CycloneDX`26fab8a2f3f931f53c4f4419896ab73001fa7395e9e6ec3dea0dea4b4662a1e5`。它们是diagnostic，不是正式supervisor签发证据。

### 6.3 正式边界、回归和资源

- 正式镜像证据入口和19步门分别以状态1及`release image evidence must be launched by the installed supervisor`、`release gate must be launched by the installed supervisor`失败；6个制品的内容/metadata指纹前后均为`d11361733d567b9410552e133c1cf2686a189bde21f4187d2d7512f2b5796b4f`。`/usr/local`没有installed supervisor，未伪造授权、正式SBOM/security/gate PASS或`ELIGIBLE`manifest。
- release inventory 6文件/48项、直接合同45/45、supervisor31/31、lint 0 error/11项既有warning、凭据扫描1,589个已跟踪文件、35个Shell、211个JSON、387个Markdown中的211个本地链接、bundle逐字节重生成及`git diff --check`均通过。Schema/TypeScript未改，未重复全量PostgreSQL业务回归或38配置typecheck。
- 起点/收口available约2.2/2.2GiB，Swap714/730MiB，根盘18/16GiB，收口Load`1.38/1.23/0.81`；内核`oom_kill=0`，四服务restart0/OOM false。构建registry、扫描/测试容器、runtime网络/Volume、tar和临时目录清零；最终/中间候选、构建回执、诊断和固定数据库按审计需要保留，未prune或删除既有资源。

## 7. 完成结论

TASK51已完成全部当前授权内工作并释放active slot。精确`8084d6c3`候选基线已有本机可解析、六服务最小权限兼容且零发现的隔离候选，但仍没有外部不可变镜像锚点、installed supervisor签发的正式镜像证据、19步PASS或`ELIGIBLE`manifest；UAT仍为alpha.42/0040及可写rootfs。host supervisor安装、异机真实恢复、UAT Migration/deploy、岗位权限、真实迁移、员工试用和正式切换均需要专项授权或外部资源，整体继续`PRODUCTION NO-GO`。
