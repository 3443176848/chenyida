# SELFHOST-RELEASE-GATE-LIFECYCLE-53 发布门禁生命周期闭环

> 状态：`DONE / REPOSITORY AND ISOLATED VERIFIED / NO HOST INSTALL / NO UAT OR PRODUCTION ACTION / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@e9d27eebb21a9f52c941f389ef7800508c0402e5` / tree `e3263230340ae5fc4e9346f366afcb025d478a51`
> 责任：Codex 主智能体为唯一写者、测试调度者和 Git 提交者；应用测试、数据迁移、运维安全智能体只读审计；项目负责人继续保留 host、外部目标、UAT、真实数据、账号、员工试用和切换的专项授权权力

## 1. 目标

关闭 TASK52 发现的首次晋升发布门自锁，同时不降低候选或部署后运行面真实性要求。发布生命周期必须显式区分：

1. 部署前既有运行面稳定门：证明门禁执行期间现行 UAT 服务集合、容器/镜像身份、运行状态、重启/OOM 和既有健康语义没有退化；旧版本没有 Worker healthcheck 时，不把“历史上不存在的健康状态”误作候选发布前置条件。
2. 隔离候选运行门：继续要求候选 Web、Worker、PostgreSQL、Caddy、Migration、存储探针及六服务运行策略全部严格通过；候选 Worker 必须为`healthy`，不得因兼容旧运行面而放宽。
3. 部署后当前运行面严格门：只接受与获准 manifest/候选身份一致的当前服务、镜像、Migration 和健康状态；Web、PostgreSQL、Worker 的强制健康要求必须完整生效。

模式必须由版本化计划、授权、门禁报告、release manifest 和部署阶段身份共同绑定，不能只靠可任意修改的环境变量、隐式探测或操作员口头约定。

## 2. 起点事实

- TASK51 本机候选精确绑定`8084d6c3e38e4246b79791414e84bfe2da4ea8f8`，但当前仓库已经前进到本任务严格起点；该候选及 bundle 只能作为历史审计快照，不能代表 TASK53 完成后的发布输入。
- canonical supervisor bundle 仍为 TASK51 的 44 文件快照，A1 不得绑定其摘要；TASK53 源码实现后必须以“源码提交 + 只改 canonical manifest 的直接子提交”重建 content-addressed bundle。
- 现行非生产 UAT 的 PostgreSQL/Web 为`healthy`，Worker/Caddy health 为`none`，四服务均 running、restart 0、OOM false。UAT 仍为 alpha.42/0040，TASK45 新 Worker healthcheck 尚未部署。
- 当前 gate runner 在执行第 1 步之前对既有运行面要求 Worker `healthy`，因此在任何候选测试发生前以`GATE_REQUIRED_RUNTIME_UNHEALTHY`失败；这不是候选质量失败，而是生命周期前置条件错误。
- host supervisor、正式授权/回执/journal、外部候选锚点、正式门报告和`ELIGIBLE`manifest仍不存在；本任务不会安装或伪造它们。

## 3. 允许范围

- 只读核验 Git、发布计划、runner、launcher、manifest、authorization、runtime identity、bundle 生成器和现有测试合同；
- 三条智能体线分别审计应用/测试、数据/恢复、运维/安全影响，主智能体复核并保持唯一写者；
- 在仓库内实现版本化生命周期模式、失败关闭验证、报告/manifest/授权绑定和必要的 supervisor 受限动作；
- 使用合成 fixture、临时目录和隔离 runtime 运行定向 Node/Python/合同测试；重任务严格串行，一次最多一个临时容器；
- 重建 content-addressed supervisor bundle 两提交链，标记旧候选/旧 bundle 过期，并更新治理文档；
- 完成凭据、JSON/Shell/Markdown、`git diff --check`、资源和 UAT 只读不变检查后创建独立 Git 提交。

## 4. 禁止范围

- 不读取`docs/ERP_CURRENT_STATUS_REPORT.md`、`.env`、凭据、容器环境、日志、业务数据库行、备份或受保护 Volume 正文；
- 不写入`/usr/local`、`/var/lib/chenyida-erp`、`/etc`或正式证据根，不安装 supervisor/monitor/timer，不修改 systemd、账号、权限、网络、防火墙、Swap、内核或 Docker daemon；
- 不连接或修改 UAT/生产数据库，不运行 UAT/生产 Migration、部署、重启、登录、业务 API、真实备份/恢复、真实数据迁移或员工试用；
- 不外部 push，不上传源码、镜像或数据；不生成可消费授权、nonce、正式 PASS、正式 release manifest 或 runtime identity；
- 不删除镜像、cache、备份、持久数据或四个受保护 Volume，不执行 prune；
- 不把部署前兼容模式用于隔离候选或部署后严格验证，不把 Worker health `none`描述成健康。

## 5. 拟实现合同

### 5.1 部署前既有运行面稳定门

- 模式名称和版本必须在机器可读计划中枚举并由授权显式绑定；缺失、未知或与动作不匹配时失败。
- 起点只接受机器计划声明的既有服务集合；门禁期间新增/缺失服务、容器 ID、镜像 ID/引用、运行状态、restart、OOM 或既有健康状态变化均失败。
- 只有计划明确标记为“legacy health absent at baseline”的服务可保持`none`；`none→unhealthy`、running 退化、restart 增长、OOM 或身份变化仍失败。
- PostgreSQL/Web 在起点已经`healthy`，必须始终保持`healthy`；不能用兼容 Worker 的例外弱化其他服务。

### 5.2 隔离候选和部署后严格门

- 隔离候选步骤继续使用完整候选运行策略，强制 Web/PostgreSQL/Worker `healthy`，Caddy 按已版本化运行策略验证；任何缺失 healthcheck、unhealthy、错误镜像或 Migration 漂移失败。
- 部署后严格验证只能绑定已获准 release manifest 的完整镜像引用、源码/tree、Migration manifest/head、运行策略和 gate report；禁止使用旧候选、local-only loopback 引用或部署前 legacy 模式。
- 发布前报告只能证明“允许部署”，不能冒充“已经部署且运行严格通过”；部署后当前身份必须生成独立、可追溯的严格回执。

### 5.3 失败关闭与证据

- authorization、gate plan、gate report、release manifest、launcher action 和 runtime identity 中的生命周期模式/版本必须一致。
- 报告记录起点/终点服务状态和允许的 legacy health 例外，不记录环境值、凭据、日志或敏感正文。
- 任何模式缺失、错配、计划降级、服务集合漂移、容器/镜像漂移、健康退化、restart/OOM、候选 Worker 非 healthy、部署后复用 legacy 模式或证据摘要漂移都必须有负向测试。

## 6. 验收标准

- [x] 三条智能体线完成只读审计，主智能体逐项复核当前 runner/launcher/manifest/runtime identity 实现与测试。
- [x] 形成并记录单一生命周期决策；部署前、隔离候选、部署后语义及允许/禁止的转换明确且机器可验证。
- [x] 发布计划、authorization、runner 报告、release manifest eligibility 与 runtime identity 的模式/版本绑定闭合，缺失或错配失败关闭。
- [x] 现行 alpha.42 Worker health `none`的合成部署前 fixture 可在不退化时通过；身份变化、服务集合变化、health 恶化、restart 或 OOM 必须失败。
- [x] 候选 Worker health `none/unhealthy`、缺失 healthcheck、错误镜像/Migration/运行策略必须继续失败；部署后使用 legacy 模式必须失败。
- [x] 定向 release contract、supervisor launcher、manifest 和负向测试全部通过；不降低断言、不跳过既有 REQUIRED 步骤。
- [x] TASK53 源码提交后，以 canonical manifest-only 直接子提交重建 supervisor bundle；旧 TASK51 bundle/候选明确标记`STALE / NOT AUTHORIZABLE`。
- [x] 不产生正式授权、正式 gate PASS、`ELIGIBLE`manifest、外部 push、host 安装、UAT/生产/真实数据动作。
- [x] 资源、UAT四服务restart/OOM和受保护 Volume 集合前后不变；任务临时容器、网络、Volume和目录精确清理。
- [x] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立 Git 提交。

## 7. 当前判定

`DONE / REPOSITORY AND ISOLATED VERIFIED / PRODUCTION NO-GO`。D-130固定三阶段生命周期；仓库合同已关闭首次晋升自锁，但现行UAT没有部署新Worker health或部署后严格身份，且不存在外部镜像锚点、正式supervisor、正式gate PASS、`ELIGIBLE`manifest或真实恢复证据。TASK51候选及44文件bundle为`STALE / NOT AUTHORIZABLE`，不得用于A1/A2。

## 8. 实现与提交证据

- 源码提交：`08608eb19ba0d82d60b248e2a0759dfc70fa2125`，tree `1a750f8587aae2dd0749547f0d02a8a1e92e81c8`，父提交为任务启动治理提交`9b580c2b3d9ffd4aaf035133bd999aebd9661b8e`。
- canonical manifest-only直接子提交：`d246cbde0bc559bb3555da65a82d49727b33a938`，tree `a93adc152a7d19058ad5899b8cac137a3281a544`；只更新`release-supervisor-bundle-v1.json`，其SHA-256为`94027198d2000b9eea1376489c8684593e38b2037d603f621aa2a5bb21f11c87`，绑定47个文件、源码提交/tree及launcher SHA-256 `b91595000a7b1a93dd60f405880465b9873b11f3ac0b803baeb5166279b8e7c5`。
- `release-gate-plan/v2`固定`PRE_DEPLOY_EXISTING_RUNTIME_STABILITY`、`ISOLATED_CANDIDATE_STRICT`、`POST_DEPLOY_CURRENT_RUNTIME_STRICT`；authorization、plan/report、release manifest v2与runtime identity v3逐层绑定模式、版本、运行策略和Migration身份。
- 部署后只接受独立严格回执：四服务、deployment class/id、完整Migration head/manifest SHA、镜像/容器身份和运行策略必须匹配；Web/Worker loopback-only引用、legacy模式、第五个Migration容器或非精确证据路径均失败。
- `VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY`采用prepared/published两阶段、canonical SHA和精确硬链接残留恢复；重试会重新验证当前运行面，已发布回执不会被后续identity失败伪装为未发布。旧的直接/manifest转identity入口保持失败关闭。

## 9. 测试与质量证据

- content-addressed两个连续提交链的干净快照：release contract候选侧51/51、supervisor信任侧48/48、Python supervisor 31/31全部通过；正式合同路径集SHA-256为`b42a442bee05bdd9b3c7b2ebad8004502161180128b771d7d8f8e1ab2cfd92bc`。
- 完整Node源码门113文件/964项通过，路径集SHA-256为`5464d29459d92c347436236d97bf2d3d05ce7c6b13c53b13adc2a23063b3da5f`；Vinext build、standalone资产一致性和裁剪合同一并通过。
- 隔离PostgreSQL全量回归83文件/396项通过，路径集SHA-256为`102253a0af4454f5ccbd63af27c2b998cb40d6b565d27d19cd6ede1fb4a1c366`；其中Dashboard实际45个Migration后的身份绑定2/2通过。
- 官方TypeScript配置38/38通过；第一次受控执行在512 MiB V8 heap下内存不足，未发生宿主或容器OOM，按资源门禁把heap/容器上限调至640/896 MiB后全量通过。ESLint为0 error、11个既有warning；生成器输出与已提交manifest逐字节一致。
- 凭据扫描通过，共1596个仓库文件；JSON、Shell、Python compile、Markdown链接、`git diff --check`和敏感信息差异检查在治理提交前再次执行。

## 10. 资源、安全与清理

- 起点约available 2.1 GiB、Swap 715—716 MiB/1 GiB、根盘可用16 GiB、Load低于4；收口采样为available 2.2 GiB、Swap 719 MiB/1 GiB、根盘可用16 GiB、Load `0.91/1.23/1.25`。
- 所有Docker build、Node、TypeScript和PostgreSQL重任务串行；任何时刻最多一个临时容器。任务隔离容器、数据库、网络、Volume、tar和目录均精确清零，没有prune或受保护Volume操作。
- UAT PostgreSQL/Web仍为healthy，Worker/Caddy仍为running且health `none`；四服务restart均为0、OOM均为false。没有读取容器环境、日志、业务数据库行、备份正文或受保护Volume正文。
- 未生成可消费授权、正式PASS、`ELIGIBLE`manifest或runtime identity；未安装host组件、外部push、build/deploy UAT、运行UAT Migration、重启服务、修改账号/网络/systemd/Swap或接触真实数据。

## 11. 后续依赖

仓库自锁已经关闭，但A1/A2仍不能直接执行：必须先从本任务精确提交链重建候选，并取得A3可异机解析的不可变源码/镜像锚点；host安装、正式门、UAT晋升及真实数据动作仍分别需要专项授权。持续交付下一安全优先级回到PR-001：在不读取当前数据的前提下补齐四域备份V2的异机传输provenance、加密/保留/调度与失败恢复合同，为A4a最小化外部输入做准备。
