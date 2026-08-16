# SELFHOST-UAT-PROMOTION-ROLLBACK-CAPABILITY-HANDLERS-82 UAT回退能力处理器与物化边界

> 状态：`DONE / REPOSITORY UAT ROLLBACK HANDLERS AND MATERIALIZATION BOUNDARY VERIFIED / CATALOG AND HOST ACTIVATION BLOCKED / DYNAMIC VALIDATION DEFERRED / PRODUCTION NO-GO`
> 日期：2026-08-16（Asia/Shanghai）
> 严格代码起点：`main@7a1ef5619c4fd5258f0e3acd40d0979c92217993` / tree `cf81fb7b8f22456f329a2feeae5a60ff8d7b6d37`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库、四文件域、host安装/激活、Compose、UAT/生产回退和破坏性动作专项授权

## 1. 背景与目标

TASK81/D-156已建立固定executor、activation v2、Supervisor v7及bundle切换联锁，但catalog诚实声明数据库、四文件域、前代Web/Worker和postverify所需的UAT-capable handler尚不存在，正式prepare在授权消费前失败。

本任务只在仓库、fake-root和断网fixture中实现每个能力的专用处理器协议、不可变输入物化与结果校验，让固定executor可在全部UAT前置真实存在时封闭分派；不得安装host、连接数据库、读取真实Volume/备份、运行真实restore/Migration/Compose/postdeploy/rollback或业务写。

## 2. 验收标准

- [x] 为writer containment、PostgreSQL staging restore/switch、uploads/attachments/backup_status新目标恢复、runtime configuration、前代Web/Worker激活及十三项postverify建立逐项专用handler；handler只接受固定FD、固定schema和固定argv，不接受shell、环境扩展或operator路径。
- [x] PostgreSQL和四文件域只能物化到与active/candidate均不相交的新身份；任何rename/switch前必须绑定签名snapshot、promotion前代、容量、cluster/volume marker、source/target位置和保护对象，TEST-only目标仍不可用于UAT。
- [x] 前代Web/Worker只接受execution package绑定的完整registry digest和已验证本机content identity；禁止pull、build、latest、任意tag或替换Caddy/PostgreSQL/网络/受保护Volume。
- [x] handler采用PREPARE/EXECUTE/PROBE/CONTAIN分离协议和逐动作幂等键；intent-only、partial、timeout、signal、daemon、输出越界、source/path/identity漂移只保全、隔离并返回typed UNKNOWN，不自动重跑破坏性阶段。
- [x] 逐动作幂等键至少绑定`action`与`execution_mode`；root-only durable state位于四文件域之外，以原子写、`fsync`和追加审计记录绑定每次action的intent、开始、逐副作用receipt、probe及终态，进程崩溃后不依赖control层dangling intent猜测结果。
- [x] PostgreSQL切换只允许从独立管理库执行同一显式事务内的`active -> quarantine`与`staging -> active`双rename；切换前拒绝连接、prepared transaction、名称/OID/marker漂移，提交结果不确定时进入typed UNKNOWN并以OID/marker只读探测，不盲目重放。真实PG17事务、锁与故障窗口继续由TASK70动态证明。
- [x] 前代历史`predecessor_runtime_configuration_sha256`只作为来源锚；派生数据库/卷激活后生成并绑定真实`rollback_runtime_configuration_sha256`，回退receipt、postverify及strict identity同时证明历史来源和新运行态。
- [x] runtime projection只接受签名计划派生的三个active external卷及固定回退overlay；candidate原卷、Caddy、PostgreSQL容器和网络保持不变。文件恢复同时验证内容、目录、owner/group、mode及隔离读写探针；`backup_status`历史快照不能冒充回退后的当前异机备份就绪证据。
- [x] 固定executor只有在能力声明、内容摘要、隔离动态证明及host激活均闭合后才允许把catalog从BLOCKED提升为SUPPORTED；本任务没有这些动态事实，因此仍保持`BLOCKED_MISSING_UAT_CAPABLE_HANDLERS`并在授权消费前拒绝。
- [x] fake-root/断网测试覆盖22项handler、目标冲突、空间/身份漂移、重复调用、发布崩溃点、结果替换、containment及保护对象；installer/launcher/journal/audit/inventory适用回归通过。
- [x] MASTER、TASKS、CHANGELOG、STATUS、PROJECT_CONTEXT、DECISIONS、当前任务文档和授权包同步更新；资源、敏感信息和diff检查通过，形成独立source→manifest提交链并自动选择下一未阻塞任务。

## 3. 禁止事项

- 不安装或激活host handler/executor，不连接UAT/生产数据库，不读取业务行、env、日志、Volume、备份或凭据正文，不运行真实restore、Migration、Compose、postdeploy、rollback或业务写。
- 不创建/修改账号、权限、systemd、网络、防火墙、Swap或Docker daemon；不停止、替换或删除当前容器，不触碰四个受保护持久卷。
- 不把fake-root handler、静态SUPPORTED或合成结果描述为真实UAT回退演练、host已激活或可投产。

## 4. 起点与资源判定

- TASK81 source`57f1f4a`→manifest-only`7a1ef56`形成149文件bundle`bd8cf7c3…3fc1`；固定executor/activation事务边界闭合，但catalog因UAT-capable handler缺失而稳定阻断，隔离动态演练和人工UAT也未完成。
- available约1.4GiB、Swap832MiB/1GiB、根盘约12GiB，Swap仍超过80%。只允许仓库静态、受限Node/Python和fake-root轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + CAPABILITY HANDLER DYNAMIC VALIDATION`。

## 5. 只读审计后的实施顺序调整

2026-08-16三路只读审计确认，直接把catalog切为`SUPPORTED`会留下五类不可接受的误放行：PREPARE/EXECUTE/PROBE幂等键碰撞；外部副作用后无durable receipt；`PARTIAL_OR_UNKNOWN`与control终态校验矛盾；派生卷无法由现有Compose/runtime verifier表达；新运行态哈希被错误要求等于前代历史哈希。因此本任务先修复上述契约和定向fixture，再实现真实固定处理器，最后才允许评估catalog切换。该顺序不扩大任务范围，也不授权任何host、Docker、数据库、Volume或UAT动作。

## 6. 实施中核验事实与局部阻塞

- rollback result/check evidence已升级为v5，分别记录数据库切换提交时的封存态、服务激活时的受控解封收据和postverify时的live session/connection观测；前代Web/Worker同时绑定registry reference与本机image config digest，避免把历史封存证据误当作切换后运行态。
- 固定executor现在要求每个stage声明的有序副作用集合全部具有耐久receipt才允许终态。PROBE不得启动未开始的副作用；只允许对已开始且经只读观测确认物理提交的副作用补写带非零观测摘要的`RECOVERED_COMMITTED` receipt，任何receipt前缀均只能返回typed UNKNOWN。
- PostgreSQL工具面已限制为固定Docker FD、固定数据库集合、执行器生成并封存的SQL memfd、`--no-password`、custom-format restore、固定locale和每次重绕的snapshot FD；尚未连接任何数据库。
- PostgreSQL 17官方`ALTER DATABASE`文档仅说明当前连接数据库不能重命名；页面中的transaction block限制属于`SET TABLESPACE`参数，而非`RENAME TO`（<https://www.postgresql.org/docs/17/sql-alterdatabase.html>）。数据库双rename继续采用独立管理库连接与单一显式事务的候选设计，但在低资源停止条件解除后仍必须用隔离PostgreSQL 17动态证明事务语义、锁与故障窗口；证明前catalog不得提升为`SUPPORTED`。2026-08-16曾短暂记录的相反结论属于文档上下文误读，已在任何提交前撤回，未形成架构决策。

## 7. 完成证据

- 逐阶段固定处理器、结果解析器和runtime adapter已进入feature source `c2f071ce474460e2be7aa3e0911a34fcfe948f08` / tree `3e262bd047f76747c4822f5f12322db170dbb90f`；直接单文件manifest子提交为`aa777324b08d06a27b1ade72a01d8d850b9a1688` / tree `a734aa13e4cb732ffc3726b56e9a62d82c34f3d0`。
- canonical Supervisor bundle manifest SHA-256为`3674e01121b09bf11014f1bcc68fd9743c4d2b60f340aa9f3089731d46c235fb`，精确绑定156文件/7,285,043 bytes；逐文件Git blob摘要、source commit/tree、launcher摘要及source→manifest唯一父子拓扑均通过复核。
- release inventory为262/238/24，raw SHA-256 `74094fe2a98de757ecab741aa81858666f42d58df4f13fdde5bec082f13251b4`；跨岗合同与回退审计raw SHA-256分别为`50cf7b9c…7135`和`d93a1b24…8083`，各自self/source/inventory链闭合。
- 最终轻量组合回归201/201通过；manifest生成后installer再验21/21。11个Python、7个JSON、2个POSIX shell变更解析通过，262个inventory文件零漂移，35文件高置信敏感信息扫描零命中，`git diff --check`通过。三名只读复核智能体分别从数据迁移、应用测试和运维安全边界复核，最终均未发现残留P0/P1。
- 收口只读资源为available约1.2GiB、Swap897MiB/1GiB、根盘约11GiB、Load`0.24/0.22/0.18`；宿主`oom_kill=2`相对任务起点无增量，四服务running、Web/PostgreSQL healthy、全部restart0/OOM false。未留下任务容器或manifest临时文件。

## 8. 完成结论与后续边界

TASK82只关闭仓库与fake-root能力处理器缺口，不证明实际host能力、数据库双rename、卷回灌、前代镜像激活或回退成功。Swap仍超过80%硬停止线，TASK70继续`BLOCKED`；下一正式任务为`SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83`，只读归因内存、Swap、OOM和磁盘压力，不修改Swap、systemd、服务或Docker。源码匹配镜像、A1/A3、真实异机恢复、UAT晋升/回退、业务批准、员工试用及正式切换仍须后续证据和专项授权，系统保持`PRODUCTION NO-GO`。
