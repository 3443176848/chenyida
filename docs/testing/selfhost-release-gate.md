# 自托管发布门 V1

> 当前状态：`TYPECHECK/BROWSER/EXACT LOCAL CANDIDATE/ZERO-FINDING DIAGNOSTIC VERIFIED / SUPERVISOR NOT INSTALLED / NO ELIGIBLE CANDIDATE / PRODUCTION NO-GO`。本页描述发布门合同和未来受控操作；它不授权候选镜像外部push、UAT/生产 Migration、部署、runtime identity 发布或切换。

## 目的与信任边界

发布门把同一候选的已提交 Git tree、包版本、Web/Worker 镜像、完整 Migration allowlist、测试计划/结果、镜像 SBOM 和漏洞评估绑定为不可变证据。未知字段、重复 JSON key、证据替换/过期、步骤缺失/跳过/失败、资源越线或临时容器残留都会阻止晋升。

候选源码本身不能决定“自己已经通过”。高权限入口由 root-owned、content-addressed release supervisor 提供；一次性授权只能映射到四个固定动作：创建镜像证据、运行 release gate、创建 release manifest、发布 runtime identity。授权不能携带 shell 命令或任意环境变量。工具会在授权消费前核验 bundle、授权文件、候选 commit/tree 和 clean worktree。

候选制品根必须位于仓库外、root-owned `0750`。工具创建并核验 root-owned `0440` marker；JSON 制品采用无覆盖原子发布、`0440`和单硬链接。gate plan/report与release manifest先写入隐藏、不可被普通消费者接受的prepared文件，外层完成最后一次Git/镜像核验后再按精确SHA-256原子发布。密码、Token、数据库 URL、扫描器凭据和完整命令输出不得进入制品、命令行、聊天或 Git。

## 已跟踪入口

- 计划：`release/release-gate-plan-v1.json`，18项全部为`REQUIRED`。
- 测试运行策略：`release/test-runtime-policy-v1.json`；Node/PostgreSQL引用、Docker RepoDigest、config digest、平台、依赖树和 Python runtime 分别固定。
- 漏洞策略：`release/vulnerability-policy-v1.json`，固定 Trivy `0.70.0`及其镜像引用，Web/Worker全部严重级别零已知漏洞。
- 快速合同：`npm test` / `npm run test:release:contracts`。
- 安装器合同：`npm run test:release:supervisor-python`。
- 完整候选门：`npm run test:release`，但只能由已安装 supervisor 调用。
- Migration隔离测试：`npm run test:release:migration-postgres`。
- Node源码门：`npm run test:release:node-source`，先 build，再按冻结清单串行运行112个纯Node测试文件；数据库、浏览器和专用POSIX文件由各自独立门负责。
- PostgreSQL清单门：`npm run test:release:postgres-regression`，在一个断网、只读、资源受限的PostgreSQL容器内，按冻结清单串行执行83个文件并为每个文件创建/销毁隔离数据库。
- POSIX专用门：`npm run test:release:special-posix`，使用内容寻址的完整Node/Python/Git镜像，在只读同路径快照和有界tmpfs内串行执行4个文件。
- Browser门：`npm run test:release:browser-e2e`调用固定执行器；D-121将官方Playwright 1.51.1/Chromium 134镜像、Chromium可执行SHA、PostgreSQL 17 rootfs、6文件清单、历史Migration模板、loopback端口和确认变量全部内容寻址。Git archive源码只读、构建/运行断网、同一时刻一个Browser容器，6文件/11项、无skip/todo及清理均失败关闭。
- 全TypeScript门：`npm run typecheck:release`，按D-120精确排序清单逐个执行38份`tsconfig*.json`并在前后复核集合/内容摘要；每份使用`--incremental false`，任一配置失败、漂移、漏跑或集合变化即停止。
- 隔离候选构建器：`scripts/build-release-candidate-images.sh`，只接受clean HEAD的精确commit/tree，从`git archive`构建Web/Worker并生成仓库外不可变构建回执。它不是supervisor高权限动作，不生成正式PASS或manifest，且只能在D-122同等的明确隔离构建授权下使用。

`test-runtime-policy-v1.json`中的 RepoDigest 仅证明当前 Docker engine 对精确本地引用的不可变解析；它不是候选 Web/Worker 的 registry provenance，也不能替代发布镜像的 registry digest、OCI identity、SBOM或漏洞报告。

## Supervisor 两提交安装协议

Supervisor bundle manifest 必须引用一个已经提交且不再修改的 source commit。流程固定为：

1. 提交所有 bundle 源文件，得到 source commit/tree；
2. 使用`create-release-supervisor-bundle-manifest.py`从该 commit 的 Git blob 生成规范 JSON；
3. 审阅后把`release/release-supervisor-bundle-v1.json`作为后续独立提交；
4. 由项目负责人对 source commit/tree、manifest commit/tree、bundle manifest SHA、launcher/installer SHA 和短时 nonce 签发 root-only 一次性安装授权；
5. 只从 root-owned、不可被 group/world 写的已审阅仓库路径运行 installer；安装器以非阻塞全局锁、`PREPARED/COMMITTED` journal、不可变 launcher store、receipt v2 和授权消费完成切换。`PREPARED`保存完整规范授权并立即归档pending授权，故原授权随后过期或丢失也不会造成不可恢复死锁；
6. 核验安装回执、active launcher、content-addressed bundle和安装后合同，再允许生成候选操作授权。

初次 installer 的 Python 代码会在其内部自校验前由 root 解释执行，因此不得从部署用户可写 checkout 或临时目录启动。当前仓库只提供受控安装器，不自动安装 supervisor；未来可再以极小的预装 root bootstrap 消除此初始信任边界。安装属于主机变更，必须专项授权。

## 候选证据与门禁顺序

候选任务必须先获得 build、联网漏洞库准备及相应主机操作授权，然后按以下顺序执行：

1. 从 clean、已提交的精确 Git SHA 串行构建不同的 Web 与 Worker 镜像，并得到 registry manifest digest reference、Docker image config digest、平台和 OCI/baked version/revision；禁止用浮动 tag 作为身份。D-123要求Dockerfile frontend与build base内容寻址，D-124分离manifest/config语义，D-125进一步固定Wolfi runtime base与精确Node APK；依赖安装按lockfile访问公共npm、应用build断网，并生成`candidate-build-provenance/v3`。该回执必须诚实标记本机/无外部锚点/无可复现attestation局限。
2. 准备固定 Trivy `0.70.0`镜像和不超过72小时的本地漏洞库。证据生产器先强制读取同run/candidate/image reference的root-owned构建回执，再使用`docker image save`后的离线archive，断网、无Docker socket、`--pull=never`运行Trivy，为Web/Worker分别生成原生JSON和CycloneDX；不得使用源码lockfile清单冒充镜像SBOM。D-125要求原生报告恰有`os-pkgs/wolfi`与`lang-pkgs/node-pkg`双包清单，CycloneDX要求唯一`wolfi 20230201`OS及`pkg:apk/wolfi`+`pkg:npm`覆盖，Debian/未知生态/缺包失败关闭。每个镜像两次扫描后立即删除临时archive。
3. 在仓库外创建唯一候选制品根；由项目负责人生成 root-owned、canonical、`0400`、24小时内有效且一次性的`CREATE_IMAGE_EVIDENCE`授权，调用已安装 launcher。完成后核对 producer/bundle/authorization摘要和全部原始证据摘要。
4. 生成新的`RUN_RELEASE_GATE`授权并调用 launcher。18步依次覆盖 release 合同、supervisor Python合同、凭证扫描、build+全部Node测试、83文件PostgreSQL回归、Browser E2E、POSIX专用测试、全部tsconfig、ESLint、隔离Migration、备份恢复、Python三基线、Compose config、`git diff --check`、镜像SBOM和漏洞证据。
5. 只有 gate report 为`PASS`且所有证据仍新鲜，才生成`CREATE_RELEASE_MANIFEST`授权。manifest同时绑定同一 commit/tree、镜像、Migration、plan/report、SBOM/security和允许的 deployment class。
6. 独立复核 manifest SHA、有效期和`promotion_status=ELIGIBLE`。UAT Migration/deploy、runtime identity发布、登录式验收和正式晋升仍分别需要新的专项授权；gate通过不会修改运行面。

所有 supervisor 授权字段由`release-supervisor-launcher.py`严格 allowlist；操作员不得直接调用 bundle 中的 shell 脚本来绕过 supervisor。launcher 在`execve`前消费一次性授权；若进程未成功启动，该授权保持已消费，必须调查回执/日志并签发新授权，不能复用或手工移回 pending。

## 资源与隔离语义

计划固定`COMPOSE_PARALLEL_LIMIT=1`、Node heap上限和单一临时容器。候选 Node 代码以root UID但无任何Linux capability，在断网、只读容器根和no-new-privileges约束下运行；宿主`node_modules`只读，Git archive源码快照与两个有界tmpfs承载构建及测试，其中通用`/tmp`为noexec、仅`/test-tmp`允许执行测试夹具。Python基线在 bubblewrap 的断网、clearenv、cap-drop环境中运行；Migration和备份恢复使用各自隔离 PostgreSQL 容器。所有镜像创建均`--pull=never`，所有候选 Git读取禁用 fsmonitor/hook、外部Git配置和textconv，并使用精确 commit archive。

资源门检查 available memory至少768 MiB、Swap不高于80%、60秒增长不超过256 MiB、根盘至少10 GiB、Load1不高于4、临时容器最多1个。现有容器消失、健康变化、新增OOM/restart或任务容器残留都会失败。首个失败后，剩余必需步骤记录为`BLOCKED`，不继续消耗资源。

命令输出只保存长度、SHA-256和有界安全摘要，不把原始 stdout/stderr写入 release report。完整日志若因排障保留，必须进入批准的 root-only任务目录并按敏感资料处理。

## 当前事实与未验证范围

- TASK42候选快照曾通过完整Node 107文件/886、PostgreSQL 80文件/367、POSIX 4文件/29等仓库门。TASK43/TASK44依次把inventory扩展为230/206/24和232/208/24；TASK45现扩展为235/211/24（Pure Node112、PostgreSQL83、Browser6、历史22、PG alias2、release contract6、special4），增加完整Migration/Worker租约/双卷/readiness合同。TASK45已通过定向42/42、隔离PG5/5、官方Migration harness、release44/44及supervisor15/15；完整112文件Node-source、83文件PostgreSQL和18步正式候选门仍须由已提交候选和受控supervisor执行。
- TASK46已按D-120把根运行合同对齐为Node 22/ES2022，固定精确38配置集合/摘要双重核验并修复真实类型债；源码`f3bac028…`和bundle`3d1243e…`两个连续干净快照均38/38。该证据关闭TypeScript子门，但不替代Node-source、PostgreSQL、Browser、镜像安全或完整18步同候选门。
- TASK47已按D-121固定Playwright 1.51.1/Chromium 134内容寻址运行时、历史Migration模板和断网只读单容器执行器；源码`9a18a0f…`干净快照6文件/11项全部PASS，manifest-only直接子提交`614ef7ac…`绑定39文件bundle。该证据关闭Browser子门，但不替代候选镜像安全、Node/PostgreSQL重跑或完整18步同候选门。
- TASK48已按D-123—D-125完成授权内工作：精确Git archive构建器、manifest/config身份分离、固定Wolfi/Node最小非root运行层、v3构建回执和严格双生态扫描合同均已落地。最终`8952a815`/tree`1ac73360`的Web/Worker manifest为`sha256:27868850…92288`/`sha256:e85ce236…ee77c`，config为`sha256:161ea63b…f6c53`/`sha256:f8dc4ac7…817c1`；6文件48/48、supervisor20/20、release typecheck和lint0 error通过。
- 当前没有安装 host supervisor，也没有修改 systemd、权限、网络、Docker daemon 或运行中的 Compose。
- alpha.46/0045已形成仅本机engine可解析的精确隔离候选。固定Trivy、7.5小时内数据库、断网无socket归档诊断覆盖Web25个Wolfi+63个npm包、Worker25+60，全部severity为0且数据库树前后一致；四份root-only诊断制品保存在仓库外。
- 上述制品明确是`diagnostic`而非正式证据。镜像证据入口与18步入口均在任何制品写入前因installed supervisor缺失退出1；不存在正式scan provenance/SBOM/security evidence、完整gate`PASS`或`ELIGIBLE`manifest。
- 完整多配置typecheck的既有ES2017/真实类型/示例边界问题已由TASK46修复，当前仓库合同38/38可重复通过；未来任何配置集合或内容漂移仍会失败关闭，不能把定向合同typecheck代替它。
- UAT继续运行 alpha.42/0040；没有执行 UAT/生产 Migration、deploy、runtime identity发布或真实用户验收。

## 失败处置

- 不覆盖或删除已有 report/manifest；修复后使用新 run/authorization ID。
- 不因门禁失败修改运行面、Migration history、当前镜像或持久卷。
- 只清理本任务精确命名、带本次 label且身份核验通过的临时容器/目录；清理失败本身是门禁失败。
- 出现OOM、反复重启、Swap/磁盘/Load越线、数据库不健康或身份漂移时，立即停止新重任务并保全证据。
- 当前结论始终是`PRODUCTION NO-GO`，直到真实候选、数据、备份恢复、权限安全、跨岗验收、员工试运行和正式切换全部具备证据。
