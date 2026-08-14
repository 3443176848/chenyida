# SELFHOST-RELEASE-CANDIDATE-REFRESH-57 当前权限边界候选重建与发布证据复核

> 状态：`DOING / STARTUP AUDIT / LOCAL ISOLATED BUILD ONLY / NO DEPLOYMENT / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@e34a861f168ef8afb71a812d186099c33d952902` / tree `66e7d001c90f0e8beeb41fed2a55755efb1c37e4`
> 责任：Codex主智能体为唯一写者、重任务调度者、证据集成者和Git提交者；沿用持续交付总目标中数据迁移、应用测试、运维安全三条只读审计结论并由主智能体复核；项目负责人保留host安装、外部push、真实数据、UAT/生产Migration/deploy、账号权限、员工试用和切换的专项授权权力

## 1. 目标

从TASK56最终content-addressed Supervisor链重建代表当前精确Git commit/tree、alpha.47和46/head `0046_runtime_lock_privilege_boundary.sql`的Web与Worker本机候选，重新闭合OCI manifest/config、baked runtime身份、Migration allowlist、六服务secret/container/tablespace运行策略以及镜像级SBOM/漏洞诊断。

TASK51的alpha.46候选仍可作历史审计证据，但已经被TASK53—TASK56的发布生命周期、集群恢复、session/secret、tablespace和受控operator合同失效；它在TASK56按当前策略实测返回`ADMIN_READ_ONLY_FIXTURE_GROUP_MISMATCH`，不得再作为当前候选。TASK57只关闭本机隔离环境可安全推进的候选刷新，不生成部署授权或投产资格。

## 2. 允许范围

- 在仓库内创建任务文档、必要的最小构建/证据合同修复、测试和内容寻址bundle；若无代码缺口，不制造产品变化。
- 从精确tracked-clean Git snapshot串行构建本机Web/Worker候选，使用任务专属loopback registry、固定公共基础镜像/工具和任务专属临时目录；一次只运行一个临时测试或构建容器，`COMPOSE_PARALLEL_LIMIT=1`。
- 只读核验Git、Migration、Docker/Compose版本、镜像/cache元数据、四服务name/image/status/health/restart/OOM和服务器资源；不读取容器环境、日志、UAT业务行、`.env`、备份或受保护Volume正文。
- 在任务专属隔离container/network/Volume中验证六服务runtime；只允许精确清理TASK57创建且按标签/路径确认的临时资源。
- 使用固定Trivy及可验证数据库执行断网、无Docker socket的逐archive诊断；若数据库过期、缺失或发现非零，不下载不受控工具、不忽略或降级severity，按失败关闭记录。

## 3. 禁止范围

- 不安装或修改host Supervisor、systemd、network/firewall、Swap、kernel或Docker daemon，不创建可消费授权，不写正式runtime identity。
- 不向外部registry或服务器push源码、镜像、SBOM、报告或真实数据；本机loopback引用不能描述为异机恢复锚点。
- 不部署、重建、重启或登录UAT/生产，不执行UAT/生产Migration，不创建/修改真实角色、ACL、secret、账号、tablespace或业务数据。
- 不prune或删除既有image、BuildKit cache、Volume、备份或诊断制品；四个受保护Volume及未来`erp_postgres_tablespaces`永不挂载、删除或修改。
- 不读取、修改、暂存或提交项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`。

## 4. 起点事实

- Git为`main@e34a861f168ef8afb71a812d186099c33d952902`/tree`66e7d001c90f0e8beeb41fed2a55755efb1c37e4`；其唯一父提交`b8b702a4d3501295f9b8c1e44b7037093f862f37`是TASK56文档源码检查点，manifest-only提交只改一文件并绑定76个受信文件，manifest SHA-256为`3e3dfc141607b3d7f0075d332447ec1c8f9f3b35e39cd147fef8dcb2bb9bb262`。
- 源码为`0.1.0-alpha.47`、46/head `0046_runtime_lock_privilege_boundary.sql`；TASK56功能基线已通过Node121/1026、PG84/401加catalog、Browser6/11、POSIX7/57、typecheck38/38、release57+54、Supervisor48、Migration/恢复及Python三基线。
- Docker Engine 29.5.2、Compose 5.1.4；73个本机image约25.27GB，Build Cache约8.726GB且无active build。既有资源不因可回收标记获得删除授权。
- 起点available约1.9GiB、Swap722MiB/1.0GiB、根盘可用15GiB、Load`0.37/0.28/0.66`、`oom_kill=0`；四个UAT服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy health none。
- UAT仍为alpha.42/0040、共享数据库superuser及环境秘密；TASK56实际角色/secret/Volume激活、host Supervisor和正式19步门均未执行。

## 5. 验收标准

- [x] 当前任务文档、依赖、范围和唯一`DOING`已登记，主智能体复核Git/Migration/Docker/资源/旧候选和Supervisor事实。
- [ ] 构建输入先形成当前任务源码检查点及唯一manifest-only直接子提交；候选只从该精确clean commit/tree的Git archive生成。
- [ ] Web/Worker version、OCI revision/version、baked runtime身份、Migration allowlist、manifest digest与config digest分别精确一致；不存在`latest`或外部tag晋升。
- [ ] 构建、loopback registry、digest解析和按digest本机引用全程串行，最多一个任务临时容器，不挂载任何受保护Volume；任务临时资源清零。
- [ ] 当前UAT/production Compose策略和六服务候选runtime probe通过；Admin/Migrate/Web/Worker secret目录/文件uid/gid/mode、只读rootfs、capability/NNP、用户/组、唯一写路径、PostgreSQL tablespace namespace及Caddy例外均保持。
- [ ] 固定Trivy及不超过72小时、前后payload tree相同的数据库覆盖Web/Worker原生报告与CycloneDX；Wolfi+Node包集合完整，全部severity和unknown为0，未使用ignore或降级。
- [ ] 构建与诊断证据位于仓库外任务专属root-owned、无覆盖目录；明确标注`LOCAL_DIAGNOSTIC / NOT FORMAL / NOT EXTERNAL ANCHOR`。
- [ ] 正式镜像证据与19步门只经installed content-addressed Supervisor入口；缺少A1授权/安装时必须在制品变化前失败关闭，不旁路或伪造PASS。
- [ ] 适用release/supervisor/runtime/credential/lint/JSON/Shell/Python/Markdown/diff门通过；若发现实现缺口，保留失败证据、修复根因并从新canonical链重建，不降低断言。
- [ ] UAT四服务和受保护Volume前后一致，未发生Migration/deploy、业务/账号写、真实角色/secret/ACL/Volume或外部push。
- [ ] 每个重任务前后记录memory、Swap、disk、Load、OOM/restart；触发停止线立即停止新重任务，TASK57临时资源精确清理。
- [ ] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，形成独立Git提交并自动转入下一未阻塞任务。

## 6. 执行顺序

1. 完成只读起点审计和资源门，登记TASK57唯一`DOING`。
2. 形成任务源码检查点和canonical manifest-only直接子提交，验证拓扑/生成器/凭据/合同。
3. 串行构建Web/Worker并取得本机manifest/config/baked身份与构建回执。
4. 串行执行Compose与六服务runtime；失败则只修当前源码/合同根因并重建。
5. 串行执行固定Trivy断网诊断，核对包覆盖、全部severity和数据库tree。
6. 从正式入口验证host未授权时的失败关闭，复核UAT/资源/清理，更新文档并独立提交。

## 7. 当前判定

`DOING / STARTUP AUDIT / LOCAL ISOLATED BUILD ONLY / NO DEPLOYMENT / PRODUCTION NO-GO`。TASK57尚未建立当前源码匹配镜像；TASK56 canonical bundle只证明仓库与合成隔离权限实现。现行UAT共享superuser、环境秘密、alpha.42/0040和旧容器策略均未改变，系统不能投入真实员工使用。
