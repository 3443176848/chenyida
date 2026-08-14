# 自托管非生产运维基线

> 当前判定：`PRODUCTION NO-GO`。本页描述运行中的非生产 UAT 及仓库已验证的运维工具；它不是生产运行手册批准，也不授权备份、恢复、Migration、部署、账号或网络变更。

## 当前运行面

- 唯一未来生产权威方向是 Node.js、PostgreSQL、本地持久文件和独立 Worker。
- `chenyida-erp-parallel`仍是受控非生产 UAT：Web `0.1.0-alpha.42` / source revision `569aa954d764309e239d1f6c174e582596d33a24`，PostgreSQL 40/head `0040_warehouse_receipt_readiness.sql`。
- 当前仓库源码为`0.1.0-alpha.46`/45/head`0045_runtime_worker_readiness.sql`及TASK53链`08608eb1`→`d246cbde`；TASK51的`8084d6c3`本机候选、六服务runtime和零发现诊断已为`STALE / NOT AUTHORIZABLE`，0041—0045仍未部署或应用到UAT。无当前候选、正式supervisor gate或`ELIGIBLE`manifest，源码/历史诊断/运行面不得描述为同一发布。
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
- Web 通过只读 `ERP_BACKUP_STATUS_FILE`读取root发布的V3 `recovery-readiness.json`；旧V1显示`LEGACY_LOCAL_ONLY`，任意V2显示`LEGACY_V2_INNER_ONLY`，synthetic evidence永远不ready。只有`ACTUAL_OFFHOST + RECOVERY_READY`且签名密文transfer、加密、已安装/观察到的调度、dry-run保留、内层恢复和当前运行身份全部匹配且新鲜，`recovery_ready`才为true。
- 浏览器没有备份或恢复写能力。详细合同与命令见 `backup-restore.md`。

## 受控变更顺序

任何候选升级必须独立完成并保留证据：

1. 冻结 Git SHA、应用版本、Migration manifest/head 和 Web/Worker 镜像 digest；
2. 运行机器可读的串行 release suite，缺失、跳过、超时或失败均拒绝晋升；
3. 取得精确 UAT/生产授权后，先建立可恢复快照并从异机副本完成隔离恢复；
4. 执行 Migration 前核对 allowlist、当前 head、checksum、容量与回滚条件；
5. 仅替换授权的服务；通过`POST_DEPLOY_CURRENT_RUNTIME_STRICT`独立复核实际四服务、镜像、Migration、runtime policy和readiness，先发布严格回执，再派生runtime identity v3；
6. 执行匿名健康、权限、核心业务、数据汇总、Worker 和备份时效验收；
7. 观察 restart/OOM、Load、内存、Swap、磁盘和错误率；触发回滚条件立即停止晋升。

TASK42已形成release manifest、Migration allowlist、content-addressed supervisor和`test:release`仓库工具；TASK46/TASK47分别关闭38配置TypeScript和6文件Browser子门；TASK53按D-130完成部署前/隔离候选/部署后三阶段合同及47文件bundle，见[自托管发布门V2](../testing/selfhost-release-gate.md)。TASK51本机候选与诊断已因源码变化成为`STALE / NOT AUTHORIZABLE`；host supervisor、当前精确候选、正式scan provenance/SBOM/security evidence和完整gate PASS仍不存在，UAT仍为alpha.42/0040。因此G3为`LIFECYCLE REPOSITORY VERIFIED / NO CURRENT ELIGIBLE CANDIDATE`，仍是投产阻断。

## 发布制品和Migration操作保护

- release gate只能由root通过固定`/var/lock/chenyida-erp-release-gate-v1.lock`运行；run ID最多80字符，证据根必须在仓库外且为root-owned `0750`，禁止环境变量改写锁路径。
- 高权限脚本只能由已安装、内容寻址的release supervisor凭root-only一次性授权调用；禁止直接执行仓库脚本绕过bundle/授权校验。首次安装或升级supervisor属于主机变更，必须专项授权并使用两提交bundle manifest、安装journal和receipt。
- Gate只检查已存在的精确Web/Worker镜像，不负责build、pull、push、run或deploy；运行前必须clean commit/tree，运行后再次确认源码和镜像身份未漂移。
- 经D-122同等专项授权的本机隔离build必须使用D-123构建器：clean HEAD→`git archive`→固定frontend/base→串行Web/Worker→仅loopback registry→按digest回拉→不可变构建回执→精确清理registry。依赖`npm ci`会访问公共源并由lockfile完整性约束，不能描述为全离线或可复现attestation；loopback digest也不是异机镜像恢复锚点。
- Manifest必须为`ELIGIBLE`且未过期；离线`SOURCE_LOCKFILE/NOT_EVALUATED`证据只能用于证明失败关闭，不能用于Migration或晋升。
- UAT/PRODUCTION Migration必须通过只读挂载的`release-manifest.json`及其SHA，显式确认精确deployment、数据库名、system identifier、OID、database comment marker、当前head和目标head。不得把秘密放入manifest或命令行。
- Migration前必须另行取得专项授权和可恢复快照；工具通过并不授权连接数据库、替换镜像、重启服务或发布runtime identity。

发布门生命周期不得混用：`PRE_DEPLOY_EXISTING_RUNTIME_STABILITY`只冻结并比较现行四服务，允许旧Worker在整个门期间保持“无healthcheck且health none”，但不把它标为健康；`ISOLATED_CANDIDATE_STRICT`仍要求候选Worker healthy。部署完成后只能使用`VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY`，`POST_DEPLOY_CURRENT_RUNTIME_STRICT`要求PostgreSQL/Web/Worker healthy、Caddy满足固定无healthcheck合同，并拒绝loopback Web/Worker引用、第五个Compose容器、完整Migration/runtime policy漂移。部署前PASS或`ELIGIBLE`manifest都不能冒充部署后回执。

部署后动作发生中断时，不删除、覆盖或手工编辑prepared/published回执或identity。使用同一授权和run ID重试前先确认没有存活进程；工具会重新复核当前运行面，只恢复canonical SHA与精确同inode残留。两个payload冲突、授权/manifest改变或运行漂移必须保全证据并停止晋升。

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

- V2已用合成数据和双独立PostgreSQL测试集群证明四域manifest、数据库守卫、内层回执、故障注入清理及prepared receipt补发；TASK54又以合成密文链证明Ed25519/X25519/HKDF/AES-GCM、双向ACK、恢复强绑定、调度评估和dry-run保留。两者都没有读取当前四卷或生成真实备份。
- TASK55/TASK56已在仓库和隔离PostgreSQL闭合cluster roles/ACL/default privileges/tablespace及当前9角色/5 LOGIN权限重建；TASK63又保持冻结V1执行引擎不变，以V2 policy把V1基础receipt、V2 recovery control和当前runtime privilege `BOOTSTRAP` receipt组合为actual证据。V2 raw/logical SHA-256为`1a092993…7aa`/`c30951ad…8b8`；TASK64进一步完成内容寻址逐代激活、回退与保全式恢复合同，但这些仍只是repository与合成验证。
- 当前仍没有真实异故障域副本、真实密钥托管/WORM/timer/保留删除、告警责任人、已激活actual policy、真实恢复或真实RTO；Dashboard不得把本机、旧V2、V1 policy、repository template或synthetic回执冒充灾备。
- actual policy固定host路径为`/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json`，激活状态根固定为`/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2`。TASK64已建立未来installed Supervisor使用的内容寻址发布合同，但当前host没有publisher、current或activation receipt。禁止手工复制、编辑、替换或自洽重签名policy/current/history/intent/receipt；缺失或不一致必须失败关闭，实际host激活仍须专项授权。
- 获专项授权后也必须先由installed Supervisor在全局release锁内prepare，逐字节复核template、bundle、environment/generation/previous、actor/approver、时效和固定路径，再消费对应一次性`ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2`授权；提交只允许intent→history→target→receipt→current顺序。操作后必须让V4、monitor backup publisher和installer interlock复核同一current链，任一消费者不一致即停止后续恢复或升级。
- 回退只能使用`ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2`精确绑定一个历史已提交代次，不能按文件名或“上一版”猜测。崩溃后保全全部现场，使用引用原已消费授权的新`RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION`授权；可证明partial才继续，过期或矛盾状态只隔离并升级事故，禁止删除后重试或手改current。
- 若备份进程中断且 `.backup-fence-v2.json`存在，数据库保持安全只读，且`CONNECT`只保留给固定的非superuser `chenyida_erp_backup`采集身份和当前一次性control身份；Web、Worker、Admin与Migration owner均被数据库级deny。禁止手工删除intent、手工补GRANT或直接重跑；只能由root调度的同一control service使用`recover-backup-guard.sh`核对v3 intent、稳定数据库/部署身份和精确ACL后，在一个事务中恢复默认读写与固定四个在线/owner角色的`CONNECT`。capture service不能执行恢复。
- TASK56之后，`backup-selfhost.sh`必须同时收到物理文件、libpq service名和登录角色都相互独立的control/capture凭据。control只做fence、backend终止、身份核验和恢复控制；所有业务relation reconciliation、Migration只读核对和`pg_dump --no-large-objects --no-owner --no-acl`都由`chenyida_erp_backup`执行。当前应用数据模型声明零large object，control在写入WORK/发布制品前按metadata强制计数为零；发现任一large object即失败关闭并精确解除本次fence，禁止临时给capture读取`pg_largeobject`正文的能力。
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
6. 发布runtime identity前必须通过`POST_DEPLOY_CURRENT_RUNTIME_STRICT`，同时看到精确PostgreSQL/Web/Worker容器为`healthy`、Caddy符合固定策略，并闭合四服务、deployment、完整Migration/runtime policy与稳定readiness；Web ready但Worker非healthy、版本/Migration身份不同或探针失败均拒绝。备份时效仍由独立Dashboard/recovery governance判断，不混入公开readiness。

完整合同和隔离证据见[任务45记录](../tasks/SELFHOST-RUNTIME-HEALTH-TRUTH-45.md)及[D-119](../project/DECISIONS.md#d-119-运行健康采用完整-migration-manifestworker-数据库租约与双侧文件卷探针)。

## 监控、告警与值班处置

TASK49提供`chenyida-erp-operations-monitoring/v1`评估合同，TASK61/D-137把它封装为内容寻址host delivery，TASK62/D-138加入权威components/backup投影producer，TASK63/D-139补齐V2 actual recovery验证边界，TASK64/D-140再加入installed policy逐代激活、回退与保全式恢复。当前canonical链为27文件monitor bundle及121文件Release Supervisor bundle，包含三身份launcher、七个固定unit/timer、安装/回退/停用事务、精确远端ACK、两项root-only投影操作及V2 recovery policy激活合同。当前状态为`REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / HOST NOT INSTALLED / POLICY NOT ACTIVATED / NOTIFIER EGRESS NOT AUTHORIZED`：没有在宿主创建账号、安装service/timer、激活实际policy、发布真实projection、开放notifier出口、配置真实target/凭据/值班表或取得外送确认。TASK65正在仓库与合成环境闭合目标绑定出口；以下是未来获专项授权后的运行合同，不是当前已经启用的生产监控。

### 信任边界与输入

- root采集器只读`/proc/meminfo`、`/proc/vmstat`、`/proc/loadavg`、`/proc/uptime`、boot ID和根分区`statfs`，boot ID只保留SHA-256；Docker只读取固定Compose project/service、容器名/ID、配置镜像引用、本地image ID、running、health、RestartCount和OOMKilled。
- 禁止采集`docker inspect`完整结果、`Config.Env`、日志、挂载、网络、API token、数据库、业务行、卷正文、机器ID正文、SQL、堆栈、完整URL、原始异常、备份位置或完整回执。Docker必须使用固定`/usr/bin/docker`、去敏环境、30秒超时和有界输出。
- Docker health取值固定使用`{{with (index .State "Health")}}{{.Status}}{{else}}none{{end}}`语义；直接读取`.State.Health.Status`或`.Config.Healthcheck`会在现行Docker上因缺失key失败。Caddy允许`none`，部署后/常态监控的PostgreSQL/Web/Worker必须`healthy`；部署前旧运行面稳定门的Worker例外不能复用于监控绿色判断。
- `operations/monitoring-policy-v1.json`只定义时间窗、服务健康和恢复要求；资源阈值唯一来自`release/release-gate-plan-v2.json.resource_policy`并由SHA-256绑定：available memory `<768 MiB`、Swap使用率`>80%`、60秒Swap增长`>256 MiB`、根盘可用`<10 GiB`、Load1连续3分钟`>4`。等于边界不触发，越过边界才触发。
- root受控配置必须从同一未过期`ELIGIBLE`release manifest及已发布runtime/backup身份生成，固定deployment/project、四个精确容器名、四个digest引用、版本、40位Git commit、release/supervisor/Migration manifest摘要、Migration head、backup policy/RPO和通知target。UAT/PRODUCTION的`notification.required`必须为true；不得使用tag或手填另一套摘要。
- 应用/release与backup必须分别由root控制的`components.json`和`backup.json`最小投影提供，绑定producer bundle、release activation/postdeploy receipt、generation、previous SHA和发布时间；backup还绑定真实V4 policy/runtime identity、恢复点和验证时间。TASK62 producer只能由installed Supervisor在全局release锁内从固定权威源发布；TASK63要求V1基础receipt、V2 control与当前runtime privilege receipt完整且policy已经受控激活。仓库实现完成不等于host已有投影。未安装、源缺失、V1/template/synthetic或无activation receipt时必须明确`NOT_COLLECTED`/失败关闭，不能手填JSON或得到绿色结果。

### 初始化与周期执行

禁止把可变Git checkout、宿主`node`搜索结果或手工复制目录作为安装源。未来A5a只能由已安装的content-addressed Release Supervisor在同一全局FLOCK下消费一次性root-only authorization并执行下列受控operation：

- `INSTALL_MONITORING_HOST_DELIVERY`：绑定27文件monitor manifest SHA、121文件Supervisor bundle SHA、root-owned Node路径/dev/inode/bytes/SHA和22.13—24版本、private config SHA、两个非特权uid/gid、activation/generation及前一activation；
- `ROLLBACK_MONITORING_HOST_DELIVERY`：除完整安装输入外，必须绑定唯一已有COMMITTED目标activation；不能按目录名或“上一版”猜测；
- `DISABLE_MONITORING_HOST_DELIVERY`：只停止/禁用精确unit并记录保全摘要，不删除bundle、runtime、config、state、outbox、delivery、journal或receipt。
- `PUBLISH_MONITORING_COMPONENTS_PROJECTION`：固定current activation、private config、current release identity和canonical postdeploy receipt的路径与完整metadata，重构deployment/Git/Migration/四服务/镜像/producer身份后发布；
- `PUBLISH_MONITORING_BACKUP_PROJECTION`：固定current V4 readiness、cluster recovery policy及TASK64 current activation链，只有当前identity、已受控激活且未过期的V2 actual链与`ACTUAL_OFFHOST + RECOVERY_READY`才能发布。D-132 V1、repository template、synthetic和无activation receipt均按设计失败关闭；TASK64已完成仓库publisher与消费者联锁，仍须专项授权才可在host实际激活和恢复。

上述源路径不可配置替换：monitor active、private config和release identity分别是`/var/lib/chenyida-erp/monitoring-v1/active.json`、`/etc/chenyida-erp/monitoring-v1/private/host-config.json`和`/var/lib/chenyida-erp/release-identity/release-identity.json`；postdeploy receipt必须位于`/var/lib/chenyida-erp/postdeploy/<run-id>/<run-id>.postdeploy-receipt.json`；backup readiness/policy固定为`/var/lib/chenyida-erp/backup-status/recovery-readiness.json`和`/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json`。这些路径当前并未由本任务在host创建或写入。

固定launcher是`/usr/local/sbin/chenyida-erp-monitoring-host-v1`，只从`/usr/local/libexec/chenyida-erp-monitoring-host-v1/bundles/<manifest-sha>`和`runtimes/<node-sha>`加载已验字节。private config位于`/etc/chenyida-erp/monitoring-v1/private/host-config.json`，evaluator/notifier只读各自group view。安装器先物化候选，再停止timer/service并取得collector/evaluator/notifier phase lock，随后按active switch、effective systemd复核、durable COMMITTED journal/receipt、activation receipt顺序提交；activation receipt缺失时launcher拒绝运行。

collector timer每分钟执行root metadata采集并在成功后触发evaluator；continuity与notifier retry timer也每分钟执行。四phase exit code为：`0`健康/idle/已ACK；evaluator `1`表示仍有活动告警、`2`表示有pending并按unit合同继续触发notifier；notifier非ACK/非idle返回`2`且不是成功状态；`3`输入/合同/采集错误，`4`continuity stale，`5`锁竞争。任何未列入对应unit成功集合的非零都必须由systemd记录为失败，不能吞掉。

运行数据拆为`observations/`、`state/`、`outbox/`、`delivery/`和`projections/`，分别使用root、evaluator或notifier精确owner/group/mode；launcher还要求每个phase持有同一inode的继承FLOCK。State wrapper以PREPARED transaction journal、canonical JSON、单调sequence、previous/integrity SHA-256、temp fsync、原子rename和目录fsync提交；outbox/delivery immutable文件以prepare temp加hard-link no-clobber发布。识别出的完整prepare crash point可恢复，未知条目、链接、owner/mode/nlink漂移、断链、sequence/时间回退或超限队列失败关闭。

Projection根固定为`/var/lib/chenyida-erp/monitoring-v1/projections`：marker为root-only `0400`，根和`components`/`backup` history目录为root:monitor-evaluator group `0750`，文件为`0440`。每类从generation 1/零前驱开始，history完整不可变，current alias必须逐字节等于精确history对象；canonical JSON、previous/source SHA、确定性temp、file/directory fsync和原子rename共同提交。只允许幂等完成同一canonical候选且未被current引用的已识别partial；未知temp、history/alias替换、旧代、跳代、未来时间或源metadata漂移必须保全现场并失败关闭。

进程异常后先停止精确timer、保全activation/journal/receipt及全部运行根，确认没有存活/卡住phase，再按稳定错误核对最后完整state、prepared temp和投递链。实现只自动恢复合同内可证明的完整prepare点；不得在timer里递归删除、重建状态、手改JSON或清空pending来恢复绿色。若确需新基线，必须记录旧状态摘要、原因、责任人和时间，并先解决OOM/restart/通知积压等原始问题。

### 告警生命周期与投递

- 新问题产生`FIRING`；相同dedupe key持续期间不重复刷屏，满3600秒才产生`REMINDER`；严重性提高产生`ESCALATED`；只有有效新快照证明问题消失才产生`RECOVERED`。
- 快照过期、时钟偏差、采样间隔超过90秒、重启、boot变化或持续窗口未形成均显式告警/重建窗口。UNKNOWN、NOT_COLLECTED、损坏输入和状态错误不能恢复旧告警。首次60秒Swap窗口和3分钟Load窗口预热期间出现warning属于预期，但在窗口完整且其余证据健康前不得宣布监控绿色。
- TEST合成adapter只允许fixture，UAT/PRODUCTION固定`HTTPS_JSON_ACK_V1`。Notifier在网络前依次持久化grant/claim/attempt；HTTP 2xx、send返回、exit 0或本机文件都不是成功，只有远端canonical body精确绑定event/target generation/idempotency/attempt才发布result/ack及原子`delivery/readiness/current.json`。当前unit固定`IPAddressDeny=any`，未获后续目标绑定出口合同与专项网络授权时真实事件只会保留pending，任何人不得手改成delivered。
- pending上限1024、活动告警上限128，投递各类不可变文件也有固定上限；达到上限会失败关闭并要求人工升级。旧耗尽事件继续可审计但不得饿死后续事件。通知器不得读取Docker socket、root private config、observation、projection或完整state；渠道凭据只通过systemd credential文件读取，不进入参数、普通环境、Git、事件或聊天。

### 告警处置矩阵

| 稳定code范围 | 立即动作 | 禁止动作与恢复条件 |
|---|---|---|
| `MONITOR_*`、exit 3/4/5 | 停止依赖该监控的晋升，核对宿主UTC、timer间隔、安装摘要、状态链和是否有真实并发；保全失败输出与状态根 | 不自动删锁/状态、不把缺样本补零；连续有效样本重建窗口且状态链通过后才恢复 |
| `HOST_MEMORY_*`、`HOST_SWAP_*`、`HOST_ROOT_*`、`HOST_LOAD_*` | 立即停止启动build/test/Migration/备份/恢复等新重任务，执行本页资源门禁只读检查并升级值班 | 未获专项授权不改Swap、内核、Docker daemon或删业务数据；资源回到门限内且持续窗口完整后才恢复 |
| `HOST_OOM_*`、`SERVICE_OOM_KILLED`、`SERVICE_RESTARTED` | 停止晋升和新写入风险动作，保全监控/发布证据，核对OOM/restart计数与受控变更时间 | 不清零计数、不盲目重启；原因、影响和新可信基线经事故记录确认后才能恢复 |
| `SERVICE_*` | 核对四个精确project/service/container/digest、running和health；实例变化必须与批准发布journal一致 | 不接受tag、未知容器、Worker `none`或手工跳过health；精确身份和必需health恢复后才关闭 |
| `APPLICATION_*` | 按“Liveness、Readiness与Worker租约处置”停止候选晋升，使用稳定code/request ID核对Web、Worker、Migration和双卷探针 | 不记录响应原文/堆栈，不改租约/healthcheck绕过；live/readiness新鲜且身份一致才恢复 |
| `RELEASE_*` | 按“Dashboard与运行身份”核对已安装supervisor、manifest摘要、运行容器与Migration；阻止切换 | 不从tag/API猜Git或manifest摘要，不手写identity；重新受控发布匹配且新鲜的identity后恢复 |
| `BACKUP_*` | 阻止上线/切换及风险写操作，保全回执，按`backup-restore.md`分别核对legacy/synthetic、transfer、encryption、schedule、retention、隔离恢复、policy/RPO和过期时间 | 不把本机/旧readiness/synthetic副本当真实异机、不改回执；新的真实V4 `ACTUAL_OFFHOST + RECOVERY_READY`链、V2 cluster policy与当前运行身份完全匹配后恢复 |
| `ALERT_DELIVERY_NOT_CONFIGURED`、exit 2 | 保留pending，按既定紧急联系路径人工升级并记录event ID；修复target/凭据/网络后做测试告警、恢复告警和重复投递演练 | 不把stdout/本机文件/人工口头通知标成delivered；确认幂等送达和ack证据后才清积压 |

### 安装、验证与回滚门

host安装必须另立专项任务并获项目负责人授权，至少固定：TASK62 source`0e38ac2e…`、monitor manifest-only`9d0eeb7b…`、Supervisor manifest-only`672a0695…`及两个manifest摘要`d1b0239f…8790`/`9d653c63…96f1`、Node绝对路径/dev/inode/bytes/SHA/版本、两个已预建非特权uid/gid、root采集边界、private config与三view摘要、projection根和两个未来权威源、状态/事件目录、七个unit/timer、真实渠道target与root-only凭据、值班/升级责任人、保留周期、安装journal和精确rollback/disable输入。账号创建、网络出口和systemd写入必须逐项列明；不得把应用账号加入Docker组，也不得给Web挂Docker socket。

安装验收需依次证明：Supervisor/monitor/runtime/config/账号与authorization完全闭合；effective `FragmentPath`、无drop-in/transient、User/Group/ExecStart/hardening/credential/读写路径精确；权威projection producer已发布当前身份；四服务和完整组件形成健康窗口；逐类合成故障产生预期FIRING/REMINDER/ESCALATED/RECOVERED；经单独批准的出口让真实渠道收到测试与恢复事件且重复event ID幂等；停止/重启monitor不丢状态；损坏/锁/时间倒退失败关闭；重启宿主后timer恢复；资源开销符合低资源门限。回滚只恢复唯一已提交activation，停用默认保全全部证据；不删除Docker服务、卷、备份或业务数据。

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
