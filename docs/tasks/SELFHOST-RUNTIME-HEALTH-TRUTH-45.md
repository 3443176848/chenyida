# SELFHOST-RUNTIME-HEALTH-TRUTH-45 运行健康、Worker 租约与文件卷真实性加固

> 状态：`DOING / REPOSITORY AND ISOLATED TESTS ONLY / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@43b6d81d21a9c5cecd567893b1ab6cf320afff05`
> 责任：Codex 主智能体为唯一写者、测试执行者、文档维护者和提交者；数据迁移、应用测试、运维安全三个子智能体只读审计；项目负责人负责未来 build、UAT/生产 Migration、部署、监控凭据、员工试用和正式切换专项授权

## 1. 目标

关闭 `/api/health` 对数据库、Migration、Worker 和本地文件卷的固定成功误报：以完整有序 Migration manifest、数据库时钟、Worker 运行租约、Web/Worker 双侧可写探针和不可伪造的运行版本身份形成失败关闭 readiness；为 Worker 增加独立 Docker healthcheck，并保持公开响应有界、去敏、可监控。

本任务只修改仓库源码、append-only 0045、自动化测试和运维文档，并只使用合成目录与隔离 PostgreSQL。不得连接或改变当前非生产 UAT、生产数据库、当前四个持久卷、账号、容器、镜像、服务或部署身份。

## 2. 已核验缺口与优先级

- 当前 health 只读取 package version 并执行 `select 1`，随后固定返回 `storage=local`、`worker=postgresql-jobs`；Worker 停止、Migration 缺失/漂移或 uploads/attachments 不可写仍可返回 HTTP 200。
- `background_jobs.heartbeat_at`只在存在运行任务时更新，不能证明空闲 Worker 进程存活；Worker 容器没有 healthcheck，宿主只能看到 `running`。
- Web 与 Worker 都挂载 uploads/attachments，但启动或运行期间没有真实创建、fsync、删除探针，权限错误、只读挂载和容量故障只能等到业务写入时发现。
- 运行版本只证明 Web package；health 没有比对 baked version/Git、数据库完整 Migration manifest或 Worker 镜像写入的同一身份。
- TASK41 已把备份/RPO/隔离恢复放入独立、带权限的 recovery governance。备份过期必须告警并阻止投产/切换，但不应通过公开 HTTP readiness 把仍可读写业务的 Web 主动下线；本任务不得复制或弱化该合同。

## 3. D-119 实现边界

- 新增 append-only `0045_runtime_worker_readiness.sql`，建立单服务、带 instance UUID、版本/Git/Migration身份、数据库时间、heartbeat、lease、终止状态和 CAS version 的运行租约。有效租约未过期时第二实例不得覆盖；过期或已停止租约才可受控接管。
- Worker 启动前必须验证 package/baked身份、完整数据库 Migration manifest和两文件卷可写，再获取租约；运行期间以数据库时钟单飞续租。每次进程启动原子生成独立、`0600`、仅容器内可读的instance UUID文件，Docker healthcheck必须核对该精确实例，不能用singleton或hostname冒充。无法续租、身份漂移或文件卷持续不可用时租约自然过期，Worker 不得伪报健康。
- Web readiness 使用实际数据库 Migration 行生成规范 manifest并与源码固定 head/digest精确比较；同时要求新鲜 Worker 租约的版本、Git和Migration身份与 Web 完全一致。
- 文件卷探针只在配置根内创建随机私有临时目录/文件，执行有界写、fsync、unlink/rmdir和目录fsync；无论成功失败都只清理本次明确创建的路径，不扫描或删除业务文件，不返回真实路径。匿名Web readiness必须使用模块级single-flight和短TTL缓存，缓存不得越过Worker租约有效期，防止公开请求放大写入/fsync。
- `/api/health`保留 `ok/database/storage/worker/version/time`兼容字段，新增有界 revision、migration head和component状态；数据库、Migration、Worker、任一Web文件卷或生产运行身份失败时返回 HTTP 503、稳定中文错误与 request ID，不泄露SQL、路径、连接串、instance ID、文件名、堆栈或原始异常。健康失败日志同样只记录稳定code和request ID，不能记录原始`error.message`。
- 新增轻量 `/api/live`只证明 Web 进程和版本元数据可读取，不替代 readiness，并必须在初始化PostgreSQL Pool前分流；Compose Web继续用 readiness，Worker使用绑定本进程UUID的独立数据库租约探针作为 healthcheck。发布身份工具只在 Web与Worker均 healthy 后接受运行面。
- Migration身份统一采用release allowlist的`sha256(canonicalJson([{ordinal,filename,sha256},...]))`规则；不得与TASK41备份工具的`checksum  filename\n`文本digest共用同名字段。Web/Worker镜像内Migration目录须为root-owned只读于node进程，数据库观测值不得反推期望allowlist。
- 0045发布后不可修改；`db/schema.ts`、snapshot、journal、运行查询、release allowlist及空库/0044升级/重放/失败回滚测试保持一致。

## 4. 验收标准

- [ ] 0045 单服务租约具备有效实例排他、数据库时钟、过期接管、同实例CAS续租、幂等停止、格式/时序约束和待健康查询索引；0001—0044 checksum不变。
- [ ] Worker 启动时验证 runtime version/Git、完整Migration manifest、uploads和attachments双卷可写；空闲时仍持续单飞heartbeat，丢失租约后停止新轮询并最终非健康。
- [ ] Web readiness 精确拒绝缺失/额外/重排/checksum漂移Migration，拒绝缺失/过期/STOPPED/身份漂移Worker，并使用PostgreSQL时间判断新鲜度。
- [ ] Web与Worker文件卷探针覆盖成功、只读/权限失败、非目录、symlink/替换、写入/fsync/清理失败；只删除本次随机探针，不接触业务正文或返回路径。
- [ ] 匿名并发health共享single-flight短TTL结果，不造成按请求次数写盘；缓存不掩盖已到期Worker租约或持续存储失败。
- [ ] `/api/live`与`/api/health`语义分离；ready响应保留兼容字段且新增有界事实，失败统一503/稳定代码/中文提示/request ID/no-store且无敏感泄露。
- [ ] Compose为Worker增加healthcheck，Web healthcheck继续消费readiness；release identity publisher要求Worker `healthy`，配置合同和回退说明一致。
- [ ] `/api/live`在Pool初始化前可用；Worker healthcheck读取本次进程`0600` UUID并只查询同一实例，Docker restart不能在旧租约窗口假健康。
- [ ] 0045覆盖空库、0044已有数据升级、重复执行、活租约拒绝、过期接管、约束、失败回滚、Schema/snapshot/journal一致性；隔离PostgreSQL验证不接触UAT。
- [ ] 定向unit/handler/Worker/Storage/Migration/PostgreSQL、相关回归、TASK45 typecheck、lint、release inventory、敏感信息和`git diff --check`通过。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`、`ROADMAP.md`、D-119及运维/部署/测试文档，形成源码、manifest-only和治理独立提交链。

## 5. 禁止范围

- 不修改岗位角色或业务权限，不实现外部监控平台、告警通知、VPN/MFA、容量压测或生产SLO。
- 不把备份状态混入公开 readiness，不修改 TASK41 的 backup/recovery receipt、RPO或Dashboard治理合同。
- 不读取或修改UAT/生产数据库、当前uploads/attachments/backup-status卷正文、账号、Session、审计或业务数据，不执行UAT/生产Migration、build/deploy/restart或真实登录。
- 不修改0001—0044，不用`background_jobs`任务heartbeat冒充进程heartbeat，不用Docker `running`或固定字符串冒充健康。
- 不修改Swap、systemd、网络、防火墙、Docker daemon，不删除镜像、Volume、备份或业务数据。
- 用户未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 6. 起点证据

- Git：唯一worktree，`main@43b6d81d21a9c5cecd567893b1ab6cf320afff05`、tree`c034ac2a324b6d5bc1a7a274cda219f3537d4bf8`，相对公开origin ahead 243；唯一既有未跟踪文件为受保护状态报告。
- 源码：`0.1.0-alpha.45`、44/head`0044_identity_session_absolute_lifetime.sql`，0044 SHA-256为`a24df94474403c4f235933d4450626ce65b40416264393db400cef08e7fcaa7e`；UAT沿用文档基线alpha.42/0040，本任务不连接复核。
- 健康实现：`handleSelfhostHealth()`只查询`select 1`并固定声明storage/worker正常；Worker入口只有业务Job lease，Compose Worker没有healthcheck。
- 主机：available约2.0 GiB、Swap442 MiB/1 GiB、根盘31 GiB、Load`0.14/0.22/0.30`；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false。四个受保护Volume仅核验metadata存在，不读取正文。
- 团队：三个只读子智能体已分别受限审计数据/Migration、应用/测试和运维/安全；主智能体保持唯一写者，Docker、Migration、PostgreSQL测试和全量门继续串行。

## 7. 完成证据

执行中；只有源码、隔离测试、文档与独立提交全部完成后填写。运行UAT在获得专项授权并完成同候选build/Migration/deploy前仍保留旧误报行为，系统继续`PRODUCTION NO-GO`。
