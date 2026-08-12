# 自托管非生产运维基线

> 当前判定：`PRODUCTION NO-GO`。本页描述运行中的非生产 UAT 及仓库已验证的运维工具；它不是生产运行手册批准，也不授权备份、恢复、Migration、部署、账号或网络变更。

## 当前运行面

- 唯一未来生产权威方向是 Node.js、PostgreSQL、本地持久文件和独立 Worker。
- `chenyida-erp-parallel`仍是受控非生产 UAT：Web `0.1.0-alpha.42` / source revision `569aa954d764309e239d1f6c174e582596d33a24`，PostgreSQL 40/head `0040_warehouse_receipt_readiness.sql`。
- 当前仓库源码为 `0.1.0-alpha.46` / 45/head `0045_runtime_worker_readiness.sql`；0041—0045均未 build、未部署或应用到 UAT。源码与运行面不得描述为同一候选。
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

TASK42已形成release manifest、Migration allowlist、content-addressed supervisor和`test:release`仓库工具；TASK46/TASK47已分别关闭38配置TypeScript和6文件Browser子门，TASK48的D-123源码合同又补上精确Git archive构建回执及installed Migration路径，见[自托管发布门V1](../testing/selfhost-release-gate.md)。host supervisor仍未安装；候选镜像级SBOM、新鲜漏洞PASS和完整gate PASS仍不存在，UAT仍为alpha.42/0040。因此G3为`REPOSITORY SUBGATES VERIFIED / INSTALLATION AND CANDIDATE EVIDENCE BLOCKED`，仍是投产阻断。

## 发布制品和Migration操作保护

- release gate只能由root通过固定`/var/lock/chenyida-erp-release-gate-v1.lock`运行；run ID最多80字符，证据根必须在仓库外且为root-owned `0750`，禁止环境变量改写锁路径。
- 高权限脚本只能由已安装、内容寻址的release supervisor凭root-only一次性授权调用；禁止直接执行仓库脚本绕过bundle/授权校验。首次安装或升级supervisor属于主机变更，必须专项授权并使用两提交bundle manifest、安装journal和receipt。
- Gate只检查已存在的精确Web/Worker镜像，不负责build、pull、push、run或deploy；运行前必须clean commit/tree，运行后再次确认源码和镜像身份未漂移。
- 经D-122同等专项授权的本机隔离build必须使用D-123构建器：clean HEAD→`git archive`→固定frontend/base→串行Web/Worker→仅loopback registry→按digest回拉→不可变构建回执→精确清理registry。依赖`npm ci`会访问公共源并由lockfile完整性约束，不能描述为全离线或可复现attestation；loopback digest也不是异机镜像恢复锚点。
- Manifest必须为`ELIGIBLE`且未过期；离线`SOURCE_LOCKFILE/NOT_EVALUATED`证据只能用于证明失败关闭，不能用于Migration或晋升。
- UAT/PRODUCTION Migration必须通过只读挂载的`release-manifest.json`及其SHA，显式确认精确deployment、数据库名、system identifier、OID、database comment marker、当前head和目标head。不得把秘密放入manifest或命令行。
- Migration前必须另行取得专项授权和可恢复快照；工具通过并不授权连接数据库、替换镜像、重启服务或发布runtime identity。

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

## 监控、备份和上线缺口

以下证据产生前，系统不能交给真实员工：

- 实际指标采集、外部告警投递和值班升级演练；
- 真实异机备份、隔离恢复、角色/ACL恢复、保留与过期告警；
- 同候选低资源负载、备份/恢复和重启 soak；
- 真实数据试迁移、表数/记录数/重复/孤儿/库存/金额/文件核对及回滚演练；
- 完整岗位权限矩阵、安全验收、核心跨岗 E2E 和少量员工签字试用；
- 正式切换窗口、责任人、验证清单、触发器和项目负责人专项授权。

上述任一缺失时，结论保持 `PRODUCTION NO-GO / NOT READY FOR REAL EMPLOYEES`。
