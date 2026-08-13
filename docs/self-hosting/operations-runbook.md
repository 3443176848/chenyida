# 自托管非生产运维基线

> 当前判定：`PRODUCTION NO-GO`。本页描述运行中的非生产 UAT 及仓库已验证的运维工具；它不是生产运行手册批准，也不授权备份、恢复、Migration、部署、账号或网络变更。

## 当前运行面

- 唯一未来生产权威方向是 Node.js、PostgreSQL、本地持久文件和独立 Worker。
- `chenyida-erp-parallel`仍是受控非生产 UAT：Web `0.1.0-alpha.42` / source revision `569aa954d764309e239d1f6c174e582596d33a24`，PostgreSQL 40/head `0040_warehouse_receipt_readiness.sql`。
- 当前仓库源码为`0.1.0-alpha.46`/45/head`0045_runtime_worker_readiness.sql`；TASK48已从精确`8952a815`/tree`1ac73360`构建仅本机隔离候选并完成零发现诊断，但0041—0045仍未部署或应用到UAT。无正式supervisor gate或`ELIGIBLE`manifest，源码/诊断候选/运行面不得描述为同一发布。
- Python/SQLite 常驻面仍是开发运行和迁移来源，不是未来生产底座；正式切换前必须另有停写、只读或隔离决定。
- 入口、受控业务事实与历史操作见 `parallel-http-acceptance.md`；未经任务授权不得登录、发送业务 POST 或查询业务行。

## 每次重任务的资源门禁

Docker build、全量测试、Migration、备份、恢复和 Compose 变更必须串行，固定 `COMPOSE_PARALLEL_LIMIT=1`，一次只允许一个临时测试/构建容器。任务前后记录：

```bash
free -h
df -h /
uptime
docker stats --no-stream
COMPOSE_PARALLEL_LIMIT=1 docker compose -p chenyida-erp-parallel -f compose.yml ps
docker inspect --format '{{.Name}} restart={{.RestartCount}} oom={{.State.OOMKilled}} status={{.State.Status}}' \
  chenyida-erp-parallel-web-1 \
  chenyida-erp-parallel-worker-1 \
  chenyida-erp-parallel-postgres-1 \
  chenyida-erp-parallel-caddy-1
```

Compose 配置展开需要数据库和 setup 变量；只读状态检查可使用受控 root-only env 文件，不能把值写入日志或聊天。停止启动新重任务的硬阈值见仓库根 `AGENTS.md`：available memory `<768 MiB`、Swap 使用率 `>80%`、Swap 60 秒增长 `>256 MiB`、根盘 `<10 GiB`、Load1 持续高于 4、OOM、反复重启、SSH 卡顿或数据库失去健康。

## Dashboard 与运行身份

- 根 `/` 是原生 Vinext 工作台；`/erp/index.html`只是显式 legacy 兼容工作区。
- `/api/summary`和`/api/management-dashboard`只读查询 PostgreSQL 权威关系表；权限裁剪仍由服务端执行。
- 最近系统审计要求 `system.audit.read`；备份治理要求 `system.backup.read`。
- Web 通过只读 `ERP_RELEASE_IDENTITY_FILE`核对 root 发布的实际 Web/Worker 容器 ID、镜像 digest、版本和 Git SHA；缺失、过期、伪造或与 baked runtime/database/Migration 不符时身份为 `UNCONFIGURED/MISMATCH`。
- Web 通过只读 `ERP_BACKUP_STATUS_FILE`读取 V2 回执；旧 V1 只能显示 `LEGACY_LOCAL_ONLY`。只有未过期的 `RESTORE_VERIFIED`同时匹配运行身份、策略、异机接收方和隔离恢复目标，`recovery_ready`才为 true。
- 浏览器没有备份或恢复写能力。详细合同与命令见 `backup-restore.md`。

## 受控变更顺序

任何候选升级必须独立完成并保留证据：

1. 冻结 Git SHA、应用版本、Migration manifest/head 和 Web/Worker 镜像 digest；
2. 运行机器可读的串行 release suite，缺失、跳过、超时或失败均拒绝晋升；
3. 取得精确 UAT/生产授权后，先建立可恢复快照并从异机副本完成隔离恢复；
4. 执行 Migration 前核对 allowlist、当前 head、checksum、容量与回滚条件；
5. 仅替换授权的服务，核对实际容器/镜像/runtime identity，发布 release identity；
6. 执行匿名健康、权限、核心业务、数据汇总、Worker 和备份时效验收；
7. 观察 restart/OOM、Load、内存、Swap、磁盘和错误率；触发回滚条件立即停止晋升。

TASK42已形成release manifest、Migration allowlist、content-addressed supervisor和`test:release`仓库工具；TASK46/TASK47分别关闭38配置TypeScript和6文件Browser子门，TASK48又按D-123—D-125完成精确Git archive构建回执、manifest/config身份、固定Wolfi/Node运行层及本机新鲜零发现诊断，见[自托管发布门V1](../testing/selfhost-release-gate.md)。host supervisor仍未安装；正式scan provenance/SBOM/security evidence和完整gate PASS仍不存在，UAT仍为alpha.42/0040。因此G3为`LOCAL CANDIDATE DIAGNOSTIC VERIFIED / FORMAL SUPERVISOR GATE BLOCKED`，仍是投产阻断。

## 发布制品和Migration操作保护

- release gate只能由root通过固定`/var/lock/chenyida-erp-release-gate-v1.lock`运行；run ID最多80字符，证据根必须在仓库外且为root-owned `0750`，禁止环境变量改写锁路径。
- 高权限脚本只能由已安装、内容寻址的release supervisor凭root-only一次性授权调用；禁止直接执行仓库脚本绕过bundle/授权校验。首次安装或升级supervisor属于主机变更，必须专项授权并使用两提交bundle manifest、安装journal和receipt。
- Gate只检查已存在的精确Web/Worker镜像，不负责build、pull、push、run或deploy；运行前必须clean commit/tree，运行后再次确认源码和镜像身份未漂移。
- 经D-122同等专项授权的本机隔离build必须使用D-123构建器：clean HEAD→`git archive`→固定frontend/base→串行Web/Worker→仅loopback registry→按digest回拉→不可变构建回执→精确清理registry。依赖`npm ci`会访问公共源并由lockfile完整性约束，不能描述为全离线或可复现attestation；loopback digest也不是异机镜像恢复锚点。
- Manifest必须为`ELIGIBLE`且未过期；离线`SOURCE_LOCKFILE/NOT_EVALUATED`证据只能用于证明失败关闭，不能用于Migration或晋升。
- UAT/PRODUCTION Migration必须通过只读挂载的`release-manifest.json`及其SHA，显式确认精确deployment、数据库名、system identifier、OID、database comment marker、当前head和目标head。不得把秘密放入manifest或命令行。
- Migration前必须另行取得专项授权和可恢复快照；工具通过并不授权连接数据库、替换镜像、重启服务或发布runtime identity。

## 容器运行时最小权限门

TASK50已经在仓库和任务私有隔离容器中验证[D-127](../project/DECISIONS.md#d-127-容器运行合同采用完整服务集合精确写路径和内核态最小权限复核)，但没有修改现行UAT。未来候选只有同时通过release gate的`compose-config`和`container-runtime-policy`两步，才证明候选配置与固定镜像兼容；这两步通过仍不授权部署。

- `operations/container-runtime-policy-v1.json`内容寻址绑定Dockerfile、Compose release overlay、Caddyfile、Engine 29.5.2和Compose 5.1.4。任何版本、源摘要或策略漂移都会失败；升级Engine/Compose或基础镜像前先另立审阅任务，不能改成宽松版本范围。
- `compose-config`必须解析`--profile '*'`的六个服务，并在隔离bwrap中把JSON直接通过stdin交给策略解析器。解析结果可能含凭据，禁止写临时文件、执行`tee`、复制到工单/聊天或在失败时打印；合法输出只有`CONTAINER_RUNTIME_POLICY_OK ...`，失败只有`CONTAINER_RUNTIME_POLICY_FAILED:<CODE>`。
- `container-runtime-policy`使用精确候选Web/Worker digest及config digest，串行演练Admin、Migrate、Web、Worker、PostgreSQL、Caddy；每次最多一个临时容器，不发布宿主端口。合法输出为`CONTAINER_RUNTIME_POLICY_TEST_OK services=6 ... max_containers=1`。任何失败、超时、中断或残留都阻止后续gate步骤。
- Docker 29.5.2/containerd image store中，按digest拉取镜像的`.Id`与`.Descriptor.digest`是registry manifest digest，OCI config digest位于`.Descriptor.annotations["config.digest"]`。运行探针必须用候选引用分别闭合前者、用不可变构建回执中的config digest闭合后者；严禁把manifest值当作config参数、从`.Id`猜config，或省略任一身份核验。
- 运行合同要求全部服务只读rootfs、drop ALL和`NoNewPrivs=1`。Caddy只允许`0:0 + NET_BIND_SERVICE`，Migrate只允许`65532:0`读取root-owned制品，Web只允许一个发布身份reader GID；其他额外group、capability或root身份都不是排障手段。
- PostgreSQL只写`erp_postgres`、`/tmp`和`/var/run/postgresql`；Caddy只写`caddy_data`/`caddy_config`；Web/Worker只写uploads/attachments，backup/release挂载只读。不得通过增加rootfs写权限、bind宿主目录、关闭`noexec`或挂Docker socket修复启动失败。
- Backend网络必须为internal；PostgreSQL、Migrate、Worker、Admin只接backend，Caddy只接edge，Web接两者。Web宿主IP固定loopback，Caddy宿主IP固定公开入口，容器目标端口固定3000/80/443。端口或网络变化必须更新策略并重做隔离证据。

未来获准部署前，先从可恢复快照开始，并在不读取卷正文的授权检查中核对现有PostgreSQL数据目录为UID/GID 999可写、uploads/attachments为65532可写、release identity为root:`reader_gid`且目录/文件分别0750/0440、Caddy两卷可由其受控root进程写入。若owner/mode不符，停止部署并提交精确路径、当前/目标metadata、影响、备份和回滚方案；禁止在Compose入口中递归`chown`，也禁止先重建服务“试试看”。

运行门失败时只保留稳定code、候选digest、gate run ID、资源快照和任务资源清理状态。先核对是否为策略/源/Engine版本漂移、镜像声明卷、用户/GID、只读挂载、tmpfs、能力、listener、PostgreSQL热重启或残留资源；不得收集/粘贴Compose JSON、环境、数据库连接串或容器日志来绕过此门。本地出现`chenyida.erp.container-runtime-policy-test`标签残留时，停止新gate并按精确ID升级事故处置；不按前缀批量删除，更不得触碰四个受保护卷。

## 备份、恢复与故障处理

- V2 已用合成数据和双独立 PostgreSQL 测试集群证明四域 manifest、数据库守卫、不可变本机/异机/恢复回执、故障注入清理及 prepared receipt 补发；没有读取当前四卷或生成真实备份。
- 当前仍没有真实异故障域副本、加密传输/保留策略、自动调度、告警责任人或真实恢复 RTO；Dashboard 不得把本机回执冒充灾备。
- 若备份进程中断且 `.backup-fence-v2.json`存在，数据库保持安全只读/连接受限。禁止手工删除 intent 或直接重跑；使用 `recover-backup-guard.sh`按精确稳定身份恢复。
- 若隔离恢复在 prepared receipt 后发布失败，保留精确 TEST 数据库、文件目标和 prepared evidence；使用 `publish-restore-receipt-selfhost.sh`补发，不重跑恢复。
- 若容器 OOM/反复重启、数据库不健康、身份漂移、回执过期/损坏、Migration 不符或关键数据核对失败，立即停止新写操作，保全日志/审计/证据，不清理持久卷或备份，按已批准的事故任务升级。

## 物料导入恢复处置

TASK43已在源码实现D-117安全合同，但当前alpha.42/0040 UAT未部署。未来同候选部署后，出现`RESULT_UNKNOWN`、`RECONCILIATION_REQUIRED`或长期`DELETE_PENDING`时：

1. 停止为同一批次生成新幂等键或执行依赖写入，只记录request ID、batch ID、operation ID和预期version，不记录文件正文、路径、Cookie或Token。
2. 只读核对幂等、batch、file、outbox/job及协调状态，并按确定性身份核对staging/正式文件存在性与SHA-256；不得靠文件名猜测归属。
3. 优先让有界reconciler复用同一operation恢复。不得覆盖正式文件、直接改业务终态、手工删除intent，或清理身份不明文件。
4. 确需人工处置时，先固定可恢复数据库/文件快照并另立受控事故任务；处置后核对终态、Audit、无可消费孤儿文件和资源清理。

详细状态机和安全边界见[自托管物料导入安全与恢复合同V1](../material-master/material-import-selfhost-safety-v1.md)。

## 会话超时与撤销处置

alpha.46源码继承0044的8小时 idle、24小时 absolute和一次性超时终态；当前UAT未部署。未来获准部署后，运维只按稳定响应和审计排障：

1. `SESSION_EXPIRED`表示`IDLE_TIMEOUT`或`ABSOLUTE_TIMEOUT`，用户应重新登录；不得手工延长`expires_at`或`absolute_expires_at`。
2. `SESSION_REVOKED`表示logout、停用、密码重置/修改等明确撤销；先核对受控账号操作和对应Identity Audit，不得恢复旧Token。
3. `AUTH_REQUIRED`可能是无Cookie或未知Token；接口会清理客户端Cookie，但服务端不会记录Token正文或摘要。排障只使用request ID、稳定错误码、目标username和审计时间。
4. 同一Session超时只能有一条`SESSION_EXPIRED`成功审计。出现重复审计、超时后仍返回actor、absolute deadline漂移、Cookie未清理或数据库时钟异常时，立即停止候选晋升并保全去敏日志。
5. 0043→0044升级会让创建超过24小时的旧Session失效。受控Migration前应统计受影响Session数量但不得导出Token摘要；升级通知应明确要求用户重新登录。

完整安全合同和隔离测试范围见[自托管身份安全边界](identity-security.md)。

## Liveness、Readiness与Worker租约处置

alpha.46/0045源码已按D-119实现下列合同，但当前alpha.42/0040 UAT仍未部署；当前Worker显示`running/health=none`只能记录为旧运行事实，不能冒充新合同通过：

1. `/api/live`必须在PostgreSQL Pool初始化前返回，只证明Web进程和版本元数据可读取；它不能用于接流或发布身份。
2. `/api/health`是readiness。HTTP 200要求Web运行version/Git有效、镜像内root-owned只读Migration allowlist与数据库完整history/checksum一致、数据库时钟下同候选Worker租约新鲜，并且Web实际完成uploads与attachments的随机私有写入、fsync和清理。
3. Worker启动前执行同一Migration/身份和双卷探针，随后以数据库时钟、generation和CAS version单飞续租；Docker healthcheck还必须读取本进程node-owned `0600` UUID文件并核对同一实例。有效旧租约存在时新实例失败关闭，只能等待旧实例停止或租约过期，禁止手工UPDATE/DELETE租约绕过排他。
4. `RUNTIME_DATABASE_UNAVAILABLE`、`RUNTIME_MIGRATION_MISMATCH`、`RUNTIME_WORKER_UNAVAILABLE`、`RUNTIME_UPLOADS_UNAVAILABLE`、`RUNTIME_ATTACHMENTS_UNAVAILABLE`或身份/超时类稳定代码出现时，先停止候选晋升，记录request ID、时间和component状态；不得记录连接串、SQL、路径、instance ID、堆栈或原始异常。
5. 检查Worker日志中的`worker_runtime_lease_lost`、`worker_runtime_stop_failed`和`worker_instance_cleanup_failed`稳定事件，再核对Docker health、数据库Migration及挂载权限。不得通过改healthcheck、延长陈旧租约或删除业务文件恢复绿色状态。
6. 发布runtime identity前必须同时看到精确Web与Worker容器为`healthy`；Web ready但Worker非healthy、版本/Migration身份不同或探针失败均拒绝发布。备份时效仍由独立Dashboard/recovery governance判断，不混入公开readiness。

完整合同和隔离证据见[任务45记录](../tasks/SELFHOST-RUNTIME-HEALTH-TRUTH-45.md)及[D-119](../project/DECISIONS.md#d-119-运行健康采用完整-migration-manifestworker-数据库租约与双侧文件卷探针)。

## 监控、告警与值班处置

TASK49提供仓库级`chenyida-erp-operations-monitoring/v1`合同、去敏采集器、纯函数评估器、原子状态存储和CLI。当前状态仅为`REPOSITORY MONITORING CONTRACT VERIFIED`：没有在宿主安装服务或定时器，没有真实通知target、凭据、值班表、外送确认或演练记录。以下是未来获专项授权后的安装/运行合同，不是当前已经启用的生产监控。

### 信任边界与输入

- root采集器只读`/proc/meminfo`、`/proc/vmstat`、`/proc/loadavg`、`/proc/uptime`、boot ID和根分区`statfs`，boot ID只保留SHA-256；Docker只读取固定Compose project/service、容器名/ID、配置镜像引用、本地image ID、running、health、RestartCount和OOMKilled。
- 禁止采集`docker inspect`完整结果、`Config.Env`、日志、挂载、网络、API token、数据库、业务行、卷正文、机器ID正文、SQL、堆栈、完整URL、原始异常、备份位置或完整回执。Docker必须使用固定`/usr/bin/docker`、去敏环境、30秒超时和有界输出。
- Docker health取值固定使用`{{with (index .State "Health")}}{{.Status}}{{else}}none{{end}}`语义；直接读取`.State.Health.Status`或`.Config.Healthcheck`会在现行Docker上因缺失key失败。Caddy允许`none`，PostgreSQL/Web/Worker必须`healthy`。
- `operations/monitoring-policy-v1.json`只定义时间窗、服务健康和恢复要求；资源阈值唯一来自`release/release-gate-plan-v1.json.resource_policy`并由SHA-256绑定：available memory `<768 MiB`、Swap使用率`>80%`、60秒Swap增长`>256 MiB`、根盘可用`<10 GiB`、Load1连续3分钟`>4`。等于边界不触发，越过边界才触发。
- root受控配置必须从同一未过期`ELIGIBLE`release manifest及已发布runtime/backup身份生成，固定deployment/project、四个精确容器名、四个digest引用、版本、40位Git commit、release/supervisor/Migration manifest摘要、Migration head、backup policy/RPO和通知target。UAT/PRODUCTION的`notification.required`必须为true；不得使用tag或手填另一套摘要。
- 应用、release、backup和notification组件通过独立root控制的去敏JSON适配层交给`--components`。readiness只提供version/revision/head，完整Migration manifest摘要来自release evidence；backup只提供状态枚举、恢复点/过期时间、policy/RPO和`recovery_ready`。省略组件文件会明确生成`NOT_COLLECTED`并告警，不能得到绿色结果。

### 初始化与周期执行

安装时应把精确候选中的`tools/ops-monitoring/`、policy和release resource plan复制到root-owned只读版本目录，把配置放入root-only配置目录；运行时状态根建议为`/var/lib/chenyida-erp/monitoring-v1`。以下占位路径必须替换为安装回执中的绝对固定路径，不能直接让定时任务跟随可变Git checkout：

```bash
sudo <installed-node> <installed-cli> init \
  --state-root /var/lib/chenyida-erp/monitoring-v1

sudo <installed-node> <installed-cli> run \
  --policy <installed-monitoring-policy-v1.json> \
  --resource-plan <installed-release-gate-plan-v1.json> \
  --config <root-only-monitoring-config-v1.json> \
  --components <root-generated-safe-components-v1.json> \
  --state-root /var/lib/chenyida-erp/monitoring-v1

sudo <installed-node> <installed-cli> status \
  --policy <installed-monitoring-policy-v1.json> \
  --config <root-only-monitoring-config-v1.json> \
  --state-root /var/lib/chenyida-erp/monitoring-v1
```

`collect`只生成严格observation，`evaluate`只评估一个已落盘observation，`run`串行完成两者和状态提交，`status`只返回去敏活动告警。常规调度为每60秒一个前台、非重入任务；不得后台重叠。exit code固定为：`0`无活动/待投递；`1`有活动告警但无pending；`2`存在未配置或待投递事件；`3`未初始化、输入/采集/合同错误；`4`状态、hash或回退错误；`5`已有锁。任何非零都必须由外层supervisor记录为失败并升级，不能用shell的`|| true`吞掉。

状态根必须与运行CLI的同一uid/gid一致并精确`0700`，marker`.chenyida-erp-monitoring-state-root-v1`为`0400`，`current.json`为`0600`。每次写入用非阻塞`0700`目录锁、单调sequence、previous/integrity SHA-256、`O_EXCL`临时文件、fsync、原子rename和目录fsync把样本、活动告警及pending事件一起提交。目录出现任何未知条目、链接、owner/mode漂移、hash断链、sequence/时间倒退或超限队列都会失败关闭。

进程异常后遗留`.monitor.lock`或临时项时，先停止调度、保全整个状态根及supervisor evidence，确认没有存活/卡住任务，再由受控事故任务核对owner、pid上下文、最后完整state和文件身份。当前实现不会自动清理未知项；不得在timer里`rm -rf`、重建状态或修改JSON来恢复绿色。若确需新基线，必须记录旧状态摘要、原因、责任人和时间，并先解决OOM/restart/通知积压等原始问题。

### 告警生命周期与投递

- 新问题产生`FIRING`；相同dedupe key持续期间不重复刷屏，满3600秒才产生`REMINDER`；严重性提高产生`ESCALATED`；只有有效新快照证明问题消失才产生`RECOVERED`。
- 快照过期、时钟偏差、采样间隔超过90秒、重启、boot变化或持续窗口未形成均显式告警/重建窗口。UNKNOWN、NOT_COLLECTED、损坏输入和状态错误不能恢复旧告警。首次60秒Swap窗口和3分钟Load窗口预热期间出现warning属于预期，但在窗口完整且其余证据健康前不得宣布监控绿色。
- TEST可明确使用`EVENT_FILE_ONLY`；它只证明事件进入本地状态。UAT/PRODUCTION事件必须为`NOT_CONFIGURED`或`PENDING`直到未来最小权限通知器按event ID至少一次、幂等送达并留下受控确认。当前仓库没有真实通知器/ack通道，任何人不得手改pending或写成delivered。
- pending上限1024、活动告警上限128；达到上限会拒绝覆盖旧状态并要求人工升级。通知器不得读取Docker socket、root配置或完整状态之外的敏感源；渠道凭据只放root-only文件，不进入参数、环境输出、Git或聊天。

### 告警处置矩阵

| 稳定code范围 | 立即动作 | 禁止动作与恢复条件 |
|---|---|---|
| `MONITOR_*`、exit 3/4/5 | 停止依赖该监控的晋升，核对宿主UTC、timer间隔、安装摘要、状态链和是否有真实并发；保全失败输出与状态根 | 不自动删锁/状态、不把缺样本补零；连续有效样本重建窗口且状态链通过后才恢复 |
| `HOST_MEMORY_*`、`HOST_SWAP_*`、`HOST_ROOT_*`、`HOST_LOAD_*` | 立即停止启动build/test/Migration/备份/恢复等新重任务，执行本页资源门禁只读检查并升级值班 | 未获专项授权不改Swap、内核、Docker daemon或删业务数据；资源回到门限内且持续窗口完整后才恢复 |
| `HOST_OOM_*`、`SERVICE_OOM_KILLED`、`SERVICE_RESTARTED` | 停止晋升和新写入风险动作，保全监控/发布证据，核对OOM/restart计数与受控变更时间 | 不清零计数、不盲目重启；原因、影响和新可信基线经事故记录确认后才能恢复 |
| `SERVICE_*` | 核对四个精确project/service/container/digest、running和health；实例变化必须与批准发布journal一致 | 不接受tag、未知容器、Worker `none`或手工跳过health；精确身份和必需health恢复后才关闭 |
| `APPLICATION_*` | 按“Liveness、Readiness与Worker租约处置”停止候选晋升，使用稳定code/request ID核对Web、Worker、Migration和双卷探针 | 不记录响应原文/堆栈，不改租约/healthcheck绕过；live/readiness新鲜且身份一致才恢复 |
| `RELEASE_*` | 按“Dashboard与运行身份”核对已安装supervisor、manifest摘要、运行容器与Migration；阻止切换 | 不从tag/API猜Git或manifest摘要，不手写identity；重新受控发布匹配且新鲜的identity后恢复 |
| `BACKUP_*` | 阻止上线/切换及风险写操作，保全回执，按`backup-restore.md`核对异机、隔离恢复、policy/RPO和过期时间 | 不把本机副本当异机、不改回执；新的真实`RESTORE_VERIFIED`链与当前运行身份完全匹配后恢复 |
| `ALERT_DELIVERY_NOT_CONFIGURED`、exit 2 | 保留pending，按既定紧急联系路径人工升级并记录event ID；修复target/凭据/网络后做测试告警、恢复告警和重复投递演练 | 不把stdout/本机文件/人工口头通知标成delivered；确认幂等送达和ack证据后才清积压 |

### 安装、验证与回滚门

host安装必须另立专项任务并获项目负责人授权，至少固定：源commit/tree和bundle摘要、Node绝对路径及版本、运行uid/gid、root采集器与非特权通知器边界、配置/状态/事件目录、60秒timer、真实渠道target与root-only凭据、值班/升级责任人、保留周期、安装journal和卸载/回滚命令。不得把应用账号加入Docker组，也不得给Web挂Docker socket。

安装验收需依次证明：配置与`ELIGIBLE`manifest闭合；权限和内容摘要无漂移；四服务和完整组件形成健康窗口；逐类合成故障产生预期FIRING/REMINDER/ESCALATED/RECOVERED；真实渠道收到测试事件且重复event ID幂等；停止/重启monitor不会丢状态；损坏/锁/时间倒退失败关闭；重启宿主后timer恢复；资源开销符合低资源门限。回滚只停止/禁用精确monitor单元并恢复前一已验版本；状态和pending事件默认保留，不删除Docker服务、卷、备份或业务数据。

2026-08-13只读宿主metadata诊断使用修正后的安全health模板，结果为`CRITICAL`且没有读取API、数据库、日志、环境或卷：available memory约2214 MiB、Swap约715.8 MiB/69.8%、根盘约17.3 GiB、Load1约0.25、宿主OOM计数0；四服务restart 0/OOM false，PostgreSQL/Web healthy，Caddy/Worker health `none`，四个运行镜像均与候选digest配置不一致；应用、release和backup组件未采集也被明确告警。一次性诊断容器和临时目录已精确清理，现行四服务未修改。这是“旧UAT正确失败关闭”的证据，不是生产监控绿色证据。

## 监控、备份和上线缺口

以下证据产生前，系统不能交给真实员工：

- 已安装的持续指标采集、真实外部告警投递、pending确认和值班升级/恢复演练；
- 真实异机备份、隔离恢复、角色/ACL恢复、保留与过期告警；
- 同候选低资源负载、备份/恢复和重启 soak；
- 真实数据试迁移、表数/记录数/重复/孤儿/库存/金额/文件核对及回滚演练；
- 完整岗位权限矩阵、安全验收、核心跨岗 E2E 和少量员工签字试用；
- 正式切换窗口、责任人、验证清单、触发器和项目负责人专项授权。

上述任一缺失时，结论保持 `PRODUCTION NO-GO / NOT READY FOR REAL EMPLOYEES`。
