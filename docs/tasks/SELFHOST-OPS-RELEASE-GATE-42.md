# SELFHOST-OPS-RELEASE-GATE-42 发布候选身份、Migration Allowlist 与强制测试门

> 状态：`DOING / SOURCE-AND-ISOLATED ONLY / NO BUILD OR DEPLOY`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@238682d003ec1d08ec85ec50e7dff319629b6979`
> 责任：Codex 主智能体为唯一写者、测试执行者和提交者；应用测试、数据迁移、运维安全智能体先行只读审计；项目负责人负责未来候选 build、UAT Migration/deploy 和发布专项授权

## 1. 目标

推进投产 G3 的仓库内安全阶段：建立不可变、机器可验证的 release manifest，防止源码/版本/镜像/Migration/测试报告互相漂移；让 Migration 只能执行 manifest 批准的精确有序 allowlist；建立低资源、串行、失败关闭且能生成去敏报告的 `test:release` 门；修复 TASK41 runtime release identity 的并发发布不确定性。

本任务只实现合同、runner、隔离测试和文档。没有本任务专用 build/UAT 授权，因此不构建镜像、不迁移/部署 UAT、不发布 runtime identity、不生成可晋升候选，也不访问当前业务数据或四卷。

## 2. 允许范围

- 审计现有 Dockerfile/Compose、版本来源、Migration runner、测试脚本和发布台账；
- 新增 release manifest、Migration allowlist、测试计划/报告与离线 SBOM/安全证据合同；
- 修改 Migration runner，使 UAT/PRODUCTION 对精确批准 manifest/allowlist 失败关闭，同时保留显式隔离 TEST 开发路径；
- 建立串行资源门、全局锁、超时、无跳过/无缺失、任务临时资源清理和机器可读结果；
- 对 runtime release identity 增加跨进程锁和并发/单调测试；
- 只在临时目录、断网 Node 容器和隔离 PostgreSQL 中测试；
- 更新发布/Migration/测试/运维及项目治理文档，创建独立提交。

## 3. 禁止范围

- 不 build/pull/push 镜像，不修改或运行现行 Compose，不重启/停止服务；
- 不连接、读取或写入 UAT/生产数据库，不运行 UAT/生产 Migration；
- 不读取当前 uploads、attachments、backup-status、PostgreSQL业务行或真实备份正文；
- 不更新 `RELEASES.md`为一个实际已构建/已验收 release，不伪造镜像 digest、SBOM、扫描或测试 PASS；
- 不安装依赖、不联网获取漏洞库、不降低/跳过既有测试；离线无法证明的漏洞状态必须明确为 `NOT_EVALUATED`；
- 不修改账号、权限、网络、systemd、Swap、内核、Docker daemon，不删除镜像、Volume、备份或业务数据；
- 用户未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 4. 验收标准

- [ ] release manifest 严格绑定完整 Git commit/tree、clean worktree、package version、Dockerfile/Compose摘要、Web/Worker实际镜像digest与OCI/baked identity、完整Migration allowlist/head、suite manifest/report、SBOM和安全报告；未知/额外字段、重复key、替换、过期或不完整失败关闭。
- [ ] manifest 只能由精确已提交源码和实际只读镜像检查证据产生；未build阶段只能生成/验证合成fixture，不把placeholder或计划写成release。
- [ ] runtime release identity 发布具备固定root锁、跨进程单写、严格单调和同一证据幂等；并发旧证据不能覆盖新证据。
- [ ] Migration runner 对 UAT/PRODUCTION 要求精确release manifest/allowlist、目标deployment/database稳定身份、当前head与逐文件checksum；缺失、额外、重排、漂移、已越过head或目标不匹配均在SQL前拒绝。
- [ ] 空库、已有数据升级、重复执行、checksum冲突、故障回滚和不允许Migration在隔离PostgreSQL通过；不修改既有Migration。
- [ ] `test:release`由版本化计划声明必需步骤、输入摘要、串行顺序、资源阈值、timeout、适用/不适用理由和输出；任何缺失、跳过、失败、超时、报告漂移或临时资源残留均阻断。
- [ ] 离线SBOM/安全证据诚实区分已验证和未联网评估，不把lockfile清单冒充实时漏洞扫描。
- [ ] 运行适用合同、单元、隔离PostgreSQL、typecheck、lint、Python基线、Compose config、链接、敏感信息和`git diff --check`；重任务串行并记录资源/OOM/restart/清理。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`及相关运行手册，创建独立Git提交。

## 5. 明确排除的后续阶段

真实候选镜像 build、SBOM/漏洞库联网评估、镜像签名、UAT Migration/deploy、runtime identity发布、登录式验收和正式release仍须独立任务及专项授权。TASK42完成只表示G3工具门可供候选任务使用，不表示alpha.44/0041已晋升或UAT已对齐。
