# SELFHOST-RELEASE-GATE-LIFECYCLE-53 发布门禁生命周期闭环

> 状态：`DOING / REPOSITORY AND ISOLATED TEST ONLY / NO HOST INSTALL / NO UAT OR PRODUCTION ACTION / PRODUCTION NO-GO`
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

- [ ] 三条智能体线完成只读审计，主智能体逐项复核当前 runner/launcher/manifest/runtime identity 实现与测试。
- [ ] 形成并记录单一生命周期决策；部署前、隔离候选、部署后语义及允许/禁止的转换明确且机器可验证。
- [ ] 发布计划、authorization、runner 报告、release manifest eligibility 与 runtime identity 的模式/版本绑定闭合，缺失或错配失败关闭。
- [ ] 现行 alpha.42 Worker health `none`的合成部署前 fixture 可在不退化时通过；身份变化、服务集合变化、health 恶化、restart 或 OOM 必须失败。
- [ ] 候选 Worker health `none/unhealthy`、缺失 healthcheck、错误镜像/Migration/运行策略必须继续失败；部署后使用 legacy 模式必须失败。
- [ ] 定向 release contract、supervisor launcher、manifest 和负向测试全部通过；不降低断言、不跳过既有 REQUIRED 步骤。
- [ ] TASK53 源码提交后，以 canonical manifest-only 直接子提交重建 supervisor bundle；旧 TASK51 bundle/候选明确标记`STALE / NOT AUTHORIZABLE`。
- [ ] 不产生正式授权、正式 gate PASS、`ELIGIBLE`manifest、外部 push、host 安装、UAT/生产/真实数据动作。
- [ ] 资源、UAT四服务restart/OOM和受保护 Volume 集合前后不变；任务临时容器、网络、Volume和目录精确清理。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立 Git 提交。

## 7. 当前判定

`DOING / PRODUCTION NO-GO`。本任务开始不意味着现行 UAT 健康契约已经修复、候选已经合格或任何部署已获授权；在实现、负向测试、bundle 重建和治理收口前，A1/A2继续不得请求。
