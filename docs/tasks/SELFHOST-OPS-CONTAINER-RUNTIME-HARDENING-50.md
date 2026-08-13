# SELFHOST-OPS-CONTAINER-RUNTIME-HARDENING-50 容器运行时最小权限加固

> 状态：`DONE / REPOSITORY AND ISOLATED VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@1a4bd16e3428fded7cd5569595fa47df82831f7c` / tree `518cbdd9001e933c6577ccbed499eb8287ec5666`
> 责任：Codex 主智能体为唯一写者、重任务调度者、证据集成者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人负责未来 UAT/生产部署、网络、账号、host 安装和真实数据专项授权

## 1. 任务目标

在不修改现行 UAT、不读取业务数据或凭据、不触碰受保护 Volume 的前提下，为自托管 Compose 和候选镜像建立可执行、失败关闭的容器最小权限合同，减少可写 rootfs、Linux capability、提权、host namespace/socket/device 和无界临时写入风险。

本任务必须产出可自动验证的版本化策略、Compose/Dockerfile 加固和隔离运行证据。仅在文档中建议 `read_only`、`cap_drop` 或 `no-new-privileges` 不算完成；同时也不得为了追求形式上的“全部为零”破坏 PostgreSQL 初始化、Caddy 证书持久化、Web/Worker 文件卷或 release supervisor 的可信读取边界。

## 2. 授权与保护边界

- 允许仓库内安全、可回滚的 Compose、Dockerfile、策略、测试、脚本和文档修改；允许固定公共镜像只读使用、本机隔离 build 和一次一个临时容器的合成运行验证。
- 允许只读核验宿主资源、现行四服务 name/image/status/health/restart/OOM、`ReadonlyRootfs`、user、capability 和 security options；允许在只读事务中查询 UAT `schema_migrations` 元数据，不读取任何业务表。
- 不修改、重建、重启或登录现行 UAT/生产服务，不运行 UAT/生产 Migration/deploy，不读取 `.env`、容器环境变量、日志、受保护 Volume/备份正文、业务数据或用户未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md`。
- 不安装 host 服务，不修改 network/firewall/systemd/Swap/kernel/Docker daemon，不创建外部账号，不发送通知，不 push 镜像或源码。
- 不删除镜像、缓存、备份或既有 Volume；只精确清理本任务创建且已核对名称的临时容器、网络、目录和 Volume。四个受保护 Volume 永不删除。
- 任何需要改变运行 UAT、持久数据、账号、网络或宿主配置的验证必须停止并记录为后续专项授权项。

## 3. 起点事实

- 当前应用源码为 alpha.46、45/head `0045_runtime_worker_readiness.sql`，0045 SHA-256 为 `cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`；TASK49内容寻址应用源码/测试为 `7debd4d…9027`，但没有对应重建镜像。
- TASK48 的零发现 Web/Worker 候选严格绑定较早 `8952a815`；TASK49包含Dashboard源码变化，因此该候选已不能代表当前应用源码。后续重新构建候选应在本任务最小权限合同稳定后另行执行，避免再次立刻失效。
- UAT 只读 Migration 元数据实际为40/head `0040_warehouse_receipt_readiness.sql`，checksum `b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`；Web仍为alpha.42/revision `569aa954…d33a24`。源码/UAT差距不在本任务部署。
- 现行 PostgreSQL、Web、Worker、Caddy 的 Docker metadata 均为 `ReadonlyRootfs=false`、无显式 `CapDrop`/`CapAdd`/`SecurityOpt`；Web/Worker image user 为 `node`，PostgreSQL/Caddy user 为空。四服务 privileged=false、restart0/OOM false；Web/PostgreSQL healthy，旧 Worker/Caddy health none。
- `compose.yml`起点只对 `migrate`声明只读 rootfs、drop all capabilities 和 `no-new-privileges`；`admin`及 Web/Worker/PostgreSQL/Caddy 尚未形成完整一致的最小权限合同。PostgreSQL/Caddy 的必要写路径与 capability 例外必须用隔离运行证据证明，不得凭猜测删除。
- 起点资源约 available 2.2 GiB、Swap 718 MiB/1 GiB、根盘 18 GiB、Load `0.05/0.21/0.71`；用户未跟踪状态报告保持不读、不改、不提交。

## 4. 验收标准

- [x] 建立版本化、严格字段、内容寻址的容器运行时策略，逐服务声明用户、只读 rootfs、capability、security option、writable mount、tmpfs、端口和必要例外；未知服务/字段、集合漂移或弱化均失败关闭。
- [x] Web 与 Worker 使用非 root user、只读 rootfs、`cap_drop: [ALL]`、`no-new-privileges:true`和有界 `nosuid,nodev,noexec` tmpfs；仅业务需要的 uploads/attachments 及只读证据挂载可见，不能写应用源码或 release identity。
- [x] migrate/admin 保持只读 rootfs、drop all capability 和禁止提权；两者均以非 root `65532`运行，migrate 只读固定 release identity，不存在通用 root shell 例外。
- [x] PostgreSQL 与 Caddy 按隔离实测收紧 rootfs、capability、security option 和写路径；PostgreSQL以`999:999`、零 capability 运行，Caddy仅保留 root 绑定低端口所需的`NET_BIND_SERVICE`，两者均通过负向写入和热重启测试。
- [x] Compose 禁止 privileged、Docker socket、host PID/IPC/network、device、任意 host root bind、未固定可写路径和无界 tmpfs；端口、资源、PID、restart、日志轮转及四个持久数据域保持原业务边界。
- [x] 提供纯合同测试和隔离 runtime 测试，覆盖正常启动/健康、只读 root 写失败、允许卷写成功、禁止 capability/提权/host资源、错误例外、恶意Compose漂移和临时资源清理。
- [x] 不修改 Schema/Migration、业务状态机、权限矩阵、API语义或当前 UAT；本任务没有应用业务改动。
- [x] 适用 release contract、Node、lint、credentials、Compose config、Shell/JSON、Markdown链接及 `git diff --check`通过；PostgreSQL业务回归和typecheck因Schema/TypeScript均未改而不重复作为本任务重型门，PostgreSQL镜像本身已完成隔离SQL/热重启验证。
- [x] 重任务严格串行，记录前后内存、Swap、磁盘、Load、OOM/restart及本任务容器/网络/Volume清理；未触发停止线，未删除受保护资源。
- [x] 更新 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`、运维文档和D-127，形成独立聚焦 Git 提交。

## 5. 执行阶段

1. 三条智能体只读审计 Compose/Dockerfile、数据写路径、镜像用户/capability、release supervisor 依赖和测试缺口；主智能体核对实际运行 metadata。
2. 记录逐服务最小权限、必要例外、可写路径和失败关闭验证的架构决定。
3. 实现策略、validator、Compose/Dockerfile加固和负向合同测试，先以静态/合成输入验证。
4. 按一次一个临时容器串行执行 PostgreSQL、Caddy、Web、Worker及工具服务的隔离运行验证；任何不确定写路径都先失败关闭再最小修正。
5. 完成适用发布门、资源/安全/范围检查、治理文档和独立提交；随后再决定是否重建当前源码候选。

## 6. 完成证据

- Git/供应链：实现提交为`375869f7d1544fa6fe437e2603af78a4021c4c91`、tree`ac5a5bfa68d3a76c7a6121a0a8d204e8169f3644`；其直接子提交`f119c8f6d99f98778975ad83df2b736de148e69f`只更新canonical supervisor bundle。bundle含44个逐blob条目，SHA-256为`ab6b708e9cfe74f0902296f0a32e74620cf3368e883ba536326789e0b7828cbe`。
- 策略：`container-runtime-policy-v1.json`的SHA-256为`8c9f9fd06eb4533faeeed4c316eb93568c38b3a42ac8c48dd081fbb4e7a2f444`；固定Docker Engine 29.5.2、Compose 5.1.4、完整六服务/profile集合、两条网络、精确用户/组/capability/security/mount/tmpfs/port/resource/logging/lifecycle/process/health/environment合同。
- Compose：六服务均`read_only`、`cap_drop: [ALL]`及`no-new-privileges`；backend为internal、edge仅承载Caddy/Web；PostgreSQL/Caddy固定到内容digest，Web/Worker继续要求候选manifest digest与config digest；变量化任意host bind被移除。
- 隔离运行：`CONTAINER_RUNTIME_POLICY_TEST_OK services=6 ... max_containers=1`。Web、Worker、Admin、Migrate逐一核对uid/gid、groups、内核capability/NNP、只读rootfs和写路径；PostgreSQL完成init、SQL、拒绝rootfs写、data/tmpfs写与热重启；Caddy核对唯一`NET_BIND_SERVICE`、80/443 TCP与443 UDP监听、持久目录及热重启。
- 自动验证：干净HEAD Compose policy PASS；runtime policy 10/10、supervisor 30/30、Node release contract 6文件/48项及直接45/45均PASS；lint为0 error/11项既有warning；canonical bundle生成器逐字节一致；1,588个已跟踪文件凭据扫描、Shell/JSON、Markdown链接和diff检查通过。
- 诚实失败：首次runtime wrapper因调用遗漏`ERP_RELEASE_IDENTITY_READER_GID`在创建容器前失败关闭，补入已核验GID 1000后通过；一次临时单文件凭据容器因host bind不可见在读取前退出，随后由官方Git archive/固定Node沙箱完成全仓扫描。两次均未留下容器、网络、Volume或目录。
- 资源/清理：起点/收口available约2.2/2.2 GiB、Swap718/714 MiB、根盘18/18 GiB，收口Load约`0.16/0.41/0.45`；UAT PostgreSQL/Web/Worker/Caddy始终restart0/OOM false。本任务临时容器、网络和Volume均为0，四个受保护Volume未触碰。

## 7. 当前结论

任务按`DONE / REPOSITORY AND ISOLATED VERIFIED / RUNTIME NOT DEPLOYED`关闭并释放active slot。未来候选的容器最小权限合同已失败关闭，但现行UAT仍是alpha.42/0040且四服务仍为可写rootfs；TASK48镜像也不代表当前HEAD。本任务没有重建当前候选、安装host supervisor、部署UAT、建立异机备份或完成真实员工验收，因此整体继续`PRODUCTION NO-GO`。下一安全任务应从本提交链重建当前精确Web/Worker候选，生成新鲜镜像证据并尝试完整19步发布门；任何host安装、UAT Migration/deploy或真实数据动作仍须专项授权。
