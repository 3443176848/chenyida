# SELFHOST-OPS-POSTGRES-RUNTIME-PRIVILEGE-56 PostgreSQL 运行时最小权限与凭据边界闭环

> 状态：`DOING / READ-ONLY AUDIT AND REPOSITORY IMPLEMENTATION / ISOLATED-ONLY / NO RUNTIME CHANGE / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@fb1f7e8893b2affba0ca07ecd9629ae2726adca9` / tree `13fe6ce3d04b60bbc724f63b9fa7b5bdc5d16d3e`
> 责任：Codex 主智能体为唯一写者、测试调度者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人继续保留真实数据库/凭据、账号权限、host、UAT/生产 Migration 与部署、Volume、备份恢复和切换的专项授权权力

## 1. 目标

关闭 TASK55 明确保留的实际运行面数据库权限和秘密交付 P0，使未来自托管候选不再依赖一个同时拥有数据库、全部对象和集群管理能力的共享登录身份：

1. 为 PostgreSQL owner/migration、Web、Worker、备份读取、备份控制、恢复/bootstrap 和未授权探针建立版本化、精确、可复核的角色与权限合同；在线应用身份不得是 superuser、数据库/对象 owner、CREATEROLE、CREATEDB、REPLICATION、BYPASSRLS 或受控运维角色。
2. Web、Worker、Migration 和运维工具使用相互独立的登录身份、凭据和连接上限；服务端在连接后验证实际 session/current role、数据库、部署身份及禁止能力，错配立即失败关闭。
3. 未来 UAT/PRODUCTION Compose 不再通过环境变量携带数据库口令、PostgreSQL 初始化口令、Setup Token 或管理员临时口令；秘密仅从受控文件边界读取，不进入 Git、Compose 渲染输出、argv、环境、日志、回执或浏览器。
4. 备份数据读取必须由非 superuser 精确授权身份完成；不可避免的 cluster/bootstrap/restore 高权限只允许离线、root 调度、一次性授权、固定命令和完整回执，不能成为常驻应用凭据或网络服务。
5. 为 TASK55 custom tablespace 预留独立持久 mount 与受控 namespace，纳入 Compose/runtime/release/recovery 合同；只声明未来资源，不创建、挂载或修改当前 Volume。

## 2. 起点事实

- `compose.yml`把同一个`DATABASE_URL`放入 Web、Worker 与 Admin 的公共环境，并通过单独的`ERP_MIGRATION_DATABASE_URL`给 Migration；PostgreSQL 使用`POSTGRES_PASSWORD`，Admin 使用`ERP_ADMIN_PASSWORD`，Setup Token也在环境中。仓库尚无生产 secret-file 消费合同。
- `db/index.ts`只接受`process.env.DATABASE_URL`并建立共享 Pool；没有按进程绑定的预期角色、连接后权限断言或 secret-file owner/mode/no-follow 校验。
- D-132/TASK55 的合成恢复策略只有 migration owner、单一 runtime login 和 privilege group；它证明角色/ACL可恢复，但不证明当前 Web/Worker、Migration、Backup 或运行 Compose 已采用这些身份。
- 2026-08-13 只读 UAT catalog 核验：PostgreSQL 17；非内置可登录角色恰好1个且为superuser，同时拥有数据库；227张public表、433个public relation全部由该会话身份拥有；Web/Worker活动连接使用同一个数据库角色。核验仅读取catalog和Migration元数据，未读取业务行、凭据或日志。
- 同次只读核验确认UAT仍为40/head`0040_warehouse_receipt_readiness.sql`、checksum`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`；源码为45/head`0045_runtime_worker_readiness.sql`、checksum`cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`。本任务不得借权限修复之名升级UAT。
- 当前PostgreSQL只挂载`erp_postgres`到PGDATA，没有custom tablespace持久Volume；当前四个业务持久Volume保持受保护且不读取正文、不修改、不删除。
- 起点资源：available memory约2.0GiB、Swap603MiB/1.0GiB、根盘可用16GiB、Load`0.10/0.17/0.52`、内核`oom_kill=0`；四服务restart0/OOM false，PostgreSQL/Web healthy，Worker/Caddy无healthcheck。

## 3. 允许范围

- 三条智能体线只读审计Compose、数据库连接边界、SQL调用面、Migration、backup/restore、runtime policy、release gate和现有D-132合同；主智能体复核并保持唯一写者；
- 在仓库内新增版本化数据库权限/秘密交付/受控operator政策、严格解析器、preflight/reconcile/verify工具及去敏回执；
- 为UAT/PRODUCTION future candidate增加每服务secret-file引用、角色期望、custom tablespace命名Volume与失败关闭runtime/release检查；development/test可保留显式隔离兼容入口，但不得被生产模式接受；
- 在最多一个临时PostgreSQL容器和任务私有临时文件/Volume中验证角色创建、授权、默认权限、Migration、应用读写、Worker任务、备份读取、越权拒绝、凭据隔离、崩溃续跑和清理；重任务全部串行；
- 按实际SQL调用证据决定Web/Worker最小对象集合；无法证明必要的权限默认不授予，未知表、对象、角色、membership或默认权限漂移失败关闭；
- 更新Compose/runtime policy、TASK55恢复policy兼容层、monitor/readiness、release inventory/contract、运行手册和content-addressed Supervisor bundle。

## 4. 禁止范围

- 不读取`docs/ERP_CURRENT_STATUS_REPORT.md`、`.env`、真实密码/Token/连接串、容器环境、日志、业务数据库行、备份正文或受保护Volume正文；
- 不创建、修改或删除当前UAT/生产角色、密码、ACL、default privileges、database settings、tablespace、Migration或业务记录；不重启/重建服务、不部署、不build当前候选；
- 不创建当前`erp_postgres_tablespaces`Volume，不改变四个受保护Volume或PGDATA，不运行真实backup/restore、数据迁移、账号操作、员工试用或切换；
- 不安装host secret manager/supervisor/timer，不写`/etc`、`/usr/local`、`/var/lib/chenyida-erp`，不修改systemd、网络、防火墙、Swap、内核或Docker daemon；
- 不把Docker Compose secret文件描述为加密保险库，不把合成角色测试描述为当前运行面已加固，不宣称WAL/PITR、HA、RPO/RTO或真实灾备完成；
- 不通过放宽D-132危险角色/ACL门禁、保留生产环境秘密变量fallback、给应用授予owner/superuser或跳过负测来追求兼容。

## 5. 验收标准

- [x] 三条智能体线完成只读审计，主智能体复核当前Compose/连接池、UAT去敏catalog摘要、Migration身份合同、backup/restore能力、对象访问面和custom tablespace边界。
- [x] D-133固定owner/Migration、Web、Worker、Admin、backup capture、受控operator和恢复身份的登录性、membership、连接上限、对象权限、秘密生命周期及旧D-132/V4兼容升级方式。
- [x] Web原有19个需行锁目标全部改经16个owner控制、固定`search_path`且撤销PUBLIC EXECUTE的`SECURITY DEFINER`窄函数访问；Web对这些表保持零table/column UPDATE权限，20个关联trigger函数以owner安全路径执行。
- [x] 固定PG17.10/libc C/UTF8的新空隔离编译器以精确Migration/access/source binding生成完整结构catalog；两次独立运行逐字节一致，未知对象、结构/owner/extension/rule/ACL等负测失败关闭，且目录自身内容寻址。
- [x] 版本化权限策略使用exact set与稳定摘要覆盖角色属性、membership options、数据库/Schema/表/序列/routine/type/大对象/默认权限和custom tablespace；未知、额外、危险或漂移状态失败关闭。
- [ ] 在线Web/Worker使用不同LOGIN和不同凭据，均非owner/non-superuser且不能DDL、SET ROLE owner、创建角色/数据库、绕过RLS、读取系统秘密或访问对方未获准对象；连接后实际身份断言与正反权限测试通过。
- [x] Migration使用独立、非superuser、低连接数身份并满足精确数据库owner/对象owner合同；只有Migration可执行版本化DDL，应用与backup身份不能写Migration历史或改变owner/ACL/default privileges。
- [x] Backup capture不再依赖superuser且只获得当前零large-object完整逻辑备份所需的精确读取权限；ALTER DATABASE/terminate backend控制动作与常驻读取身份分离，并由root-only双service、固定目标、v3 intent和去敏输出约束。CREATE TABLESPACE/CREATEROLE仍只属于后续离线bootstrap/restore控制面，不进入本备份入口。
- [ ] UAT/PRODUCTION配置拒绝`DATABASE_URL`、`ERP_MIGRATION_DATABASE_URL`、`POSTGRES_PASSWORD`、`ERP_ADMIN_PASSWORD`、`ERP_SETUP_TOKEN`等秘密环境值；每服务secret文件具有独立路径、owner/group/mode/no-follow/单硬链接和内容边界，缺失、复用、错权限、symlink、hardlink、替换或泄漏负测通过。
- [ ] 开发/测试兼容入口只接受显式隔离身份，不能在UAT/PRODUCTION或release candidate中降级；错误不得回显连接串、口令、文件路径或角色清单。
- [ ] Compose声明独立`erp_postgres_tablespaces`持久Volume和固定容器namespace；runtime policy、恢复map与release gate验证精确mount、只读/读写边界、owner/mode和禁止与PGDATA/应用卷重叠，当前运行面未创建该Volume。
- [ ] 单容器隔离PostgreSQL 17完成空cluster bootstrap、46个Migration、角色/ACL reconcile、Web与Worker允许操作、备份dump、未授权拒绝、重复执行、故障回滚和新空目标权限复核；临时数据库、秘密、容器、网络、Volume和目录全部清理。
- [ ] 现有Node/PostgreSQL/Browser/POSIX、Migration、backup/restore、Dashboard/monitor、Compose/runtime和release合同不降级；新增测试进入正式inventory，所有重任务串行且最多一个临时容器。
- [ ] 源码冻结后重建canonical manifest-only直接子提交，TASK55 bundle和全部旧候选标记`STALE / NOT AUTHORIZABLE`；不把历史TASK51镜像当作新源码候选。
- [ ] 不产生真实角色/密码、可消费授权、真实secret文件、真实tablespace、host安装、外部push、UAT/生产/真实数据动作；系统保持`PRODUCTION NO-GO`。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立Git提交。

## 6. 启动核验

- 严格起点为TASK55收口提交`fb1f7e8893b2affba0ca07ecd9629ae2726adca9`/tree`13fe6ce3d04b60bbc724f63b9fa7b5bdc5d16d3e`；根仓库只保留项目负责人既有未跟踪状态报告，Site/Python目录均属于同一根仓库，没有嵌套提交边界。
- TASK55提交后release contracts 51/51、Supervisor Python31/31、Python self-test/smoke/go-live和1617文件credentials通过；TASK55临时容器与临时目录为零。
- 只读运行核验只输出角色能力布尔值、数量、Migration head/checksum、对象owner计数和连接角色计数；没有输出角色名、连接串、密码、业务值或容器环境。
- 启动时源码45个Migration与0045 checksum匹配文档；UAT只读为40/head、227表，Web alpha.42、启动源码alpha.46，四服务状态与挂载未变化。
- 启动文档门通过：394个Markdown文件/229个本地链接、214个JSON、38个Shell、1618个显式仓库文件凭据扫描、release contract 51/51及Python self-test/smoke/go-live全部通过；Node检查使用现有固定镜像、断网/只读/零capability且一次一个临时容器，Python使用现有项目`.venv`和自动清理的临时SQLite。
- 宿主缺少Node/jq，系统Python缺少`openpyxl`；这些首次检查均在业务断言前失败，随后改用既有固定Node镜像和项目`.venv`通过，未安装依赖或降低断言。带当前受控env文件的`docker compose ps`因缺少Migration变量在插值阶段失败；直接Docker metadata仍确认四服务running、restart0/OOM false，未读取或输出env内容。

## 7. 当前判定

`DOING / READ-ONLY AUDIT AND REPOSITORY IMPLEMENTATION / ISOLATED-ONLY / NO RUNTIME CHANGE / PRODUCTION NO-GO`。当前系统仍由单一superuser承担数据库owner、全部对象owner和Web/Worker连接，且秘密通过环境变量交付；在TASK56仓库闭环、源码匹配候选、正式门、专项授权部署与运行复核完成前，不得投入真实员工使用。

## 8. 三线审计结论与 D-133

- 数据与迁移线确认现有Migration gate要求`current_user=session_user=database owner`且无membership，故D-133保留owner/Migration合一而与常驻身份分离；D-132 v1不得改写，v2升级后才可激活。现有backup单一superuser同时做fence与capture，且`CONNECTION LIMIT 0`会阻断普通capture，必须升级为CONNECT allowlist fence。
- 应用与测试线确认Web覆盖全部业务域且会enqueue，Worker实际执行parse、normalize、review-finalize、上传恢复和DRAFT物料创建；两者需独立LOGIN与逐对象操作ACL，但部分导入/队列/物料对象必然共享，表ACL不能冒充行/状态隔离。现有Pool没有任何阻塞式session/capability断言，Worker还被迫加载Setup Token。
- 运维与安全线确认Compose、runtime policy和release合同仍把数据库、Setup、PostgreSQL及Admin秘密列为环境键，且无tablespace持久mount；受控部署还必须关闭浏览器Setup并改用root调度Admin工具。secret-file、逐服务mount、runtime exact set和release摘要必须同批升级，不能只改Compose文本。
- 主智能体据此记录[D-133](../project/DECISIONS.md#d-133-postgresql-运行权限采用独立登录nologin-权限组文件秘密与离线控制面)，当前进入版本化role/ACL、secret-file consumer与runtime identity实现；没有创建真实角色、凭据、host目录或Volume，也没有修改UAT/生产。

## 9. Web锁权限边界实施检查点

- `0046_runtime_lock_privilege_boundary.sql`以append-only方式新增16个窄锁函数，并把20个既有locking trigger函数固定为migration owner执行、`pg_catalog, public, pg_temp`搜索路径和无PUBLIC EXECUTE；关系Schema不变，0046 SQL/Snapshot SHA-256分别为`ad68aaa4…6d66b`/`c8fe259a…f60d`。
- Finance、Production、Quality与Sales的19个原始`SELECT ... FOR UPDATE/SHARE`调用已改经受控函数；正式access intent中`LOCK_TARGETS_REQUIRING_UPDATE`全部为空，Web无需为行锁取得任何table/column UPDATE。
- 源码候选同步为`0.1.0-alpha.47`、46/head`0046_runtime_lock_privilege_boundary.sql`；release inventory保持`244/220/24`，当前SHA-256为`cecbbbaf…7f67`，test runtime policy SHA-256为`a90e07ae…4c8a`。UAT仍为alpha.42/0040，本检查点没有Migration、build或deploy授权。
- 隔离PostgreSQL 17完整回归通过84文件/401项，专项权限测试5/5、迁移/源意图/版本11/11、发布/版本契约31/31、typecheck38/38、凭据扫描1631文件及clean-candidate等价lint 0 error/17条既有warning通过。首次直接`eslint .`因扫描未跟踪构建产物触发V8 heap OOM；容器未OOMKill、Swap仅小幅增长，排除不会进入Git快照的`dist/.wrangler/.task-tmp`后在同一1 GiB上限通过，未增加并发或降低规则。
- 权限源仍明确`BLOCKED`，Backup边界闭合后仅剩`POSTGRESQL17_COMPILED_CATALOG_REQUIRED`；下一步生成PG17精确catalog并执行完整角色/ACL reconcile。当前UAT共享superuser、环境变量秘密和运行服务均未改变，系统继续`PRODUCTION NO-GO`。

## 10. Backup control/capture 检查点

- `backup-selfhost.sh`不再接受单一数据库service：必须提供路径、inode和service name均独立的control/capture root-only文件。control会话仍要求superuser，只执行稳定身份/零large-object核验、数据库只读与`CONNECT`围栏、backend清退及守卫释放；relation reconciliation、Migration只读核对和dump均由固定非superuser `chenyida_erp_backup`执行。
- 围栏从修改`datconnlimit`升级为`chenyida-erp-backup-connect-fence/v1`：在一个事务中撤销owner、Web、Worker与Admin权限组的数据库`CONNECT`并设置默认只读，保留capture和当前control；释放/中断恢复也在一个事务中恢复固定四职责`CONNECT`和writable default。原connection limit在全过程必须不变，九角色/五登录/四围栏grantee/Backup grantee、PUBLIC CONNECT/TEMP、额外LOGIN或NOLOGIN CONNECT、错误角色属性或ACL均失败关闭。
- 守卫intent升级为`chenyida-erp-backup-fence/v3`，为中断发现兼容继续使用`.backup-fence-v2.json`文件名。`recover-backup-guard.sh`只接受同一control service和精确v3 intent；capture身份不能解除守卫，原始/围栏状态之外的任何漂移都拒绝自动恢复。
- 当前应用Migration/恢复catalog明确`large_objects: []`。control在创建WORK或发布artifact前要求`pg_largeobject_metadata`计数为零；capture不读取原始`pg_largeobject`，reconciliation只验证零metadata，dump固定`--no-large-objects --no-owner --no-acl`。隔离负测证明意外large object会拒绝备份并精确释放围栏，零large-object路径可完成备份、新空库恢复与业务reconciliation。
- PG17单容器双集群测试通过：普通capture可完整dump但无法读取`pg_largeobject`正文、写业务表或创建TEMP；崩溃守卫中capture保持可连接而owner被围栏，未知NOLOGIN CONNECT漂移会阻断恢复且保留intent，清除漂移后固定四职责CONNECT精确复原；意外large object拒绝和零large-object备份/恢复均通过，下游Dashboard PostgreSQL 2/2通过，临时集群/容器/目录清零。
- 更新后的access intent SHA-256为`218d7ff7e17124c6ff45b39f25a104016538d4a6e23f50ed8be3f6b500a2561f`，只剩PG17编译catalog blocker。Backup/source定向合同13/13、release合同51/51和inventory `244/220/24`验证通过；本检查点没有真实凭据、角色/ACL、备份、恢复、Volume、Migration、部署或服务变化。
- ACL签名收紧后的首次定向复跑因已生成access JSON按设计变成stale而12/13，重新生成后13/13；凭据扫描首次在不含Git的固定Node镜像中于文件扫描前退出，改用扫描器原生`COMMITTED_TREE`显式排序清单后1631文件通过。没有跳过文件、读取未跟踪报告或降低断言；PG17只出现既有合成publication `wal_level`与`PGPASSFILE=/dev/null`告警，不影响本次断言。

## 11. 权限源图与D-132兼容检查点

- 编译catalog前审计发现`mapping-target-registry.ts`只需要`MaterialImportParserServiceError`，却从legacy D1 `parser-service.ts`导入，因而把CSV/XLSX Parser及旧D1 SQL错误纳入Web可达图。现新增无数据库依赖的`parser-service-contract.ts`，legacy Service保持兼容re-export，Web图不再触达三个Parser实现文件。
- Web精确减少11个表操作：DELETE 4、INSERT 3、SELECT 2、UPDATE 2；同时撤销`material_import_parse_runs_id_seq`、`material_import_parse_sheets_id_seq`和`material_import_shared_string_chunks_id_seq`三个非Web INSERT所需USAGE。源文件173→171，表权限`18/201/211/82`→`14/198/209/80`，序列USAGE 182→179；完整移除集合由测试固定。
- 运行身份此前使用`*_acl`，而D-133及Backup围栏已固定`*_priv`。现统一Web/Worker/Admin职责组为`chenyida_erp_{web,worker,admin}_priv`，与`chenyida_erp_backup_priv`组成唯一四组命名；后续v2 catalog必须拒绝任何`*_acl`持久角色。
- D-132 v1 policy、fixture、snapshot与摘要按D-133不可变；三处误随当前包版本升级的fixture已恢复alpha.46及各自原始0045 head。alpha.47、九角色及完整ACL只进入新v2合同，不回写legacy v1。
- Parser拆分后又完成调用路径复核：将lease reader与writer/Worker supervisor、Web outbox enqueuer与完整Worker queue、初始Mapping publisher及normalization staging writer拆成单向模块。Web raw candidate由`14/199/205/80`收敛为`9/191/205/79`，只保留既有`app_meta INSERT`这一项显式reviewed exclusion；额外撤销14个表操作及6个sequence USAGE，Web最终表权限`9/190/209/79`、sequence USAGE 173，Web lease SELECT与Worker所需正向权限保持。
- 新access intent SHA-256为`b2defe953c59a6b37858ee90af1ae08fbd444486a814ebb1c10f7f0f4ee83aa1`。固定Node断网/只读/零cap TypeScript及六文件Node 36/36通过，隔离PG17 runtime-readiness 5/5验证writer acquire/renew/stop和reader行为不变；临时容器清零，UAT/生产角色、ACL、凭据、服务、Migration和数据均未改变。

- 正式测试绑定复核发现8份已改测试与旧inventory不一致。已同步更新每文件SHA-256、test inventory及runtime policy固定摘要；inventory保持`244/220/24`，SHA-256为`79b1c8126ce5a934b38f7c70ed0af9dcd582edf52babc2406f07dcc974b328db`；inventory verify、release/v1 transfer合同31/31及v1 recovery合同16/16通过。

## 12. 三线审计后的优先级调整

- 应用审计确认Web lease canary要求`SELECT=true`且`INSERT/UPDATE/DELETE=false`，此前文件图意图却包含INSERT/UPDATE；本检查点已从源合同消除该自相矛盾，完整物理登录正负探针仍须在v2 reconciler完成后执行。
- 数据审计确认PG17编译catalog必须把可寻址关系/sequence/routine与列、约束、索引、非内部trigger等稳定surface分开，并显式建模extension成员及owner对table/sequence/routine/type的有效未来default privileges；零`pg_default_acl`行不得被解释为安全。
- 运维安全审计确认`backup-recovery-readiness-v4.mjs`及Dashboard仍可能把D-132 v1 `ACTUAL_OFFHOST/RECOVERY_READY`解释为ready，与D-133“v1只作legacy/synthetic”的固定边界冲突。下一安全动作先在validate/create/publish/Dashboard外层失败关闭v1 actual，保留v1 synthetic历史解析，再进入PG17 catalog/reconcile。

## 13. D-132 v1 实际就绪失败关闭检查点

- `validateBackupRecoveryReadinessV4`、`createBackupRecoveryReadinessV4`和`publishBackupRecoveryReadinessV4`现在都在D-132 v1 policy与`ACTUAL_OFFHOST/RECOVERY_READY`组合进入深层验证或写入前，以稳定错误码`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`失败关闭；result/scope错配仍优先返回既有scope错误，不改变错误分类。
- Dashboard消费端另加独立外层守卫；即使未来调用路径意外绕过validator，v1 actual也只会投影为`INVALID / NONE / UNVERIFIED / recovery_ready=false`。D-132 v1 synthetic fixture仍可验证和解析，但assurance保持`MISMATCH`且永远不能ready。
- 发布顺序改为先验证现有权威alias，再写不可变history；坏alias不会留下孤儿history。同payload幂等发布仍复核/补齐同名history后返回，实际发布的root/确认词要求保持不变。
- 十份D-132 v1核心policy/catalog/restore/executor/transfer/test文件由精确SHA-256负向门冻结，禁止借本修复修改legacy实现。正式inventory保持`244/220/24`，SHA-256为`1a84dcd0cf10afbc4e14fd809d8b98877d5bedcad6fdd24d8229c9100f4496ab`；test runtime policy SHA-256为`a20718ef88702373e64283e0607aa1412fd6060eaf23b67733af68b4e7d59358`。
- 固定Node断网/只读/单容器验证中Dashboard 9/9、release manifest/gate 27/27、inventory verify、定向lint和`tsconfig.task10` typecheck通过；1637个显式tracked文件凭据扫描、216个JSON及394份Markdown/231个本地链接检查通过。typecheck首次在384 MiB V8 heap下进程内不足，确认宿主`oom_kill=0`、四服务restart0/OOM false及资源低于停止线后，以640 MiB heap/896 MiB容器同断言复跑通过；未跳过或降低检查。此前同源码边界的release/v1 transfer 31/31、v1 recovery 16/16保持通过。没有创建真实回执、角色、凭据、Volume或运行面资源，没有读取真实数据、备份、卷正文或未跟踪状态报告。
- 该P0入口已关闭，TASK56继续唯一`DOING`并进入PG17精确编译catalog与v2角色/ACL reconcile；当前UAT仍共享superuser且没有真实V4证据，系统继续`PRODUCTION NO-GO`。

## 14. PostgreSQL 17 精确结构编译catalog检查点

- 新增只读目录SQL、严格编译/验证器、单容器外层资源守卫和内层PG17测试。引擎固定`postgres@sha256:4f736ae2…b394`、server 17.10、libc/C/UTF8；46个Migration、drizzle snapshot/journal、access intent v2、数据库marker/system identifier及8份compiler source逐项内容寻址，任何输入漂移都拒绝复用制品。
- 最终catalog冻结234表、211序列、394 routine（170应用、224 extension）、6独立type、3 extension，以及3132列、1709约束、957索引和285个非内部trigger；31类unsupported surface计数全零。目录文件、artifact和逻辑catalog SHA-256分别为`4ca22dfa949a897a32296b392b6c1c396996a6c9e5bc0a94c35ae42f7d581162`、`93af15b7aa0ca0eec5c4bc0d67f0d8dc248ca335837d17ca466a46c8f3157674`、`40c8c620dc8b434798716270d5aecbfedb19499618a2fc792c31e529f63c7f8f`。
- 负测覆盖同owner rogue table、sequence/routine/type、owner、relation/TOAST options、合法用户rule、routine不安全`search_path`、extension成员指纹和operator owner、未知extension成员class、large object、column/default ACL及RLS policy。只读审计指出未知extension class最初只有字段而无非零触发后，已增加真实`ALTER EXTENSION ... ADD TABLE`和纯合同counter=1断言，再重新生成目录及下游摘要；未降低或跳过断言。
- 一次refresh与一次独立test都从新空PG17 cluster应用46个Migration并逐字节重现最终目录；目录/发布/Dashboard33/33、release52/52、Supervisor31/31、typecheck38/38、lint0 error/17既有warning、credentials1643、Shell42、JSON216、Markdown394/231、inventory及diff门通过。完整typecheck首次在640 MiB V8 heap内不足但没有宿主/容器OOM，按正式768 MiB heap/1 GiB容器上限完整重跑38/38，未跳过配置。正式inventory为`245/221/24`、SHA-256`1a7253b48894a4f6be9ffd4065b9246fb00fe61e9281d60bb4eb67c6201aee9e`，test/container runtime policy分别为`7ac07e933736eb0d38e85b3d8153824063c2bcffc6000753cf06f408cb3dae3a`和`74d3f8d24e7b15f0cc5ce4e0e21c963b0e95735c502a471666c02165c7e53c1b`。
- catalog源码提交`8675efd28ed8b61900fb49f7644541103f5f60b0`/tree`21556c6695b5b49a62959797b1adcb3b116387ef`又在干净Git归档中通过固定PG17正式84文件/401项，并在停掉第一cluster后由第二套新空cluster独立重建、逐字节验证catalog。manifest-only直接子提交`633b42dca48393d7f24d48808c9046e0d2bd8fc4`/tree`241f808e73464275fc8472a92f35e9254ef9522b`只修改canonical manifest，绑定50文件，bundle SHA-256为`baf820f4d1647e427cae1409c5a3797edc4b38fa8eefa2d56c669c4c2094ddc1`；manifest提交上的Supervisor31/31、官方固定Node凭据扫描1643文件及Python三项隔离基线通过。
- 该制品和bundle只闭合结构证据前置条件，不创建角色、不授予ACL、不改变UAT。TASK56保持唯一`DOING`，下一步以该catalog实现v2 exact role/ACL policy、幂等reconciler、default/extension ACL和五个物理身份正负探针，再闭合secret-file、operator、tablespace mount；任何后续源码变化都必须重建TASK56最终Supervisor bundle。
- 正式门收口available约1.8GiB、Swap543MiB/1.0GiB、根盘16GiB，最终Load`0.56/0.91/1.07`、`oom_kill=0`；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false，临时容器/cluster/目录清零。当前shell不含必需setup token，`docker compose ps`按配置失败关闭；未读取或伪造secret，改用四个精确容器只读inspect完成状态核验。宿主没有Node二进制时，凭据扫描改由既有固定digest、断网、只读官方Node sandbox运行并通过。未读取`.env`、真实秘密、业务行、日志、备份/卷正文或未跟踪状态报告，未修改真实角色/ACL/Volume、UAT/生产或服务。

## 15. PostgreSQL 17 v2角色与ACL合成检查点

- `postgresql-runtime-privilege-policy-v2.json`现固定9个角色、5个LOGIN、4个NOLOGIN职责组和4条无admin/set option membership；Migration owner、Web、Worker、Admin、Backup连接上限分别为1、12、6、1、2，对应池上限1、10、4、1、1。策略逻辑SHA-256为`fb7768aad873a4e2987248b57853cc34c72204e5d1b8623a00797cd944b85c8f`，文件SHA-256为`b36424f40b085000b2a835eeab63369b952f40571ec76b211eceb3b303c2d2b4`。
- exact非owner ACL共1261条：数据库4、Schema 4、表813、序列411、routine 29（覆盖28个routine），type/tablespace/large object均为0；完整物理ACL storage覆盖849个对象。`schema_migrations`只向Web、Worker和Backup职责组授予SELECT；仅owner可写。Schema内table/sequence保持owner隐式默认权限，global routine/type以2条物理default ACL撤销PUBLIC默认能力。
- 状态捕获绑定PG17引擎、数据库OID、数据库marker和system identifier摘要，并完整捕获角色、membership、settings、对象/列/default/parameter ACL、custom tablespace位置摘要和large-object计数。未知managed role、membership或ACL端点、LOGIN直授、grant option、列/参数ACL、自定义tablespace、large object、危险settings或结构漂移全部失败关闭；不读取口令、业务行或large-object正文。
- role bootstrap与常规reconcile严格分离：正常路径发现缺失角色即返回`RUNTIME_PRIVILEGE_ROLE_BOOTSTRAP_REQUIRED`；隔离bootstrap在单事务中先取得Migration advisory lock，再规范owner及1261条职责组ACL、owner-only default privileges和连接上限。相同最终状态再次计划必须为零语句no-op；v2 intent固定`INTENT_DURABLE → TRANSACTION_DISPATCHED → POSTCOMMIT_CAPTURED → VERIFIED`单调状态及未知第三状态`QUARANTINE`决策。
- 固定PG17隔离测试从新空cluster应用46个Migration，随后重命名并绑定目标身份，执行9角色bootstrap/reconcile、最终状态与结构复核、幂等no-op、五个LOGIN的`current_user=session_user`和正反向权限探针。Migration可DDL但不能CREATEROLE；Web可读audit及调用获准digest但不能读`app_meta`或DDL；Worker可读`background_jobs`但不能读`app_meta`、调用digest或DDL；Admin只获准其对象；Backup可完整`pg_dump -Fc`但不能DELETE或DDL。四个常驻身份对table高危权限、sequence UPDATE、column REFERENCES、standalone type、tablespace CREATE、数据库TEMP、Schema CREATE和superuser参数SET/ALTER SYSTEM的聚合结果精确为8个零。
- 生产执行器尚未开放：CLI只接受`NODE_ENV=test`、显式隔离确认和任务私有`/tmp/cyd-runtime-privilege-catalog-postgres.*`文件；尚未实现生产root runner、全局host lock、durable intent文件落盘、备份围栏联锁、真实secret-file绑定或专项授权入口，因此该检查点不能用于UAT/生产reconcile。
- 源码提交`88c9f1d25ee08debdf3ef06a533f0596a9047074`/tree`044bf539b0174b93229162c158a5d89c3290bcf3`与manifest-only直接子提交`1bc4ed5a8574c710aacd6e94f2f1ae67bd6ea440`/tree`accfcdc6774e3c3f4cc8ac4f82b192ad37e51c83`形成50文件检查点，bundle SHA-256为`2fadb84c18fcb6c82fe561d7ea8b973c51b55a6d395a2bc9480f954ffafd0edb`。catalog文件/artifact更新为`146b3cd…896`/`c35f4920…4e6`且逻辑catalog保持`40c8c620…7f8f`。
- 策略artifact verify与单测5/5、固定PG17完整角色/ACL演练、Node inventory 119文件/1001项、release contracts 6文件/52项、Supervisor Python31/31、inventory `246/222/24`、credentials1649及JSON/Shell/diff门通过。Node全量前两次只因隔离容器缺少仓库同级治理模板和`docs/`只读挂载而停止；补入测试既有路径的只读挂载后原用例及全套1001项通过，没有改测试或降低断言。
- 收口available约1.7GiB、Swap526MiB/1.0GiB、根盘16GiB、Load`0.20/0.86/0.89`、内核`oom_kill=0`；四服务restart0/OOM false，Web/PostgreSQL healthy，任务容器和临时清单清零。`docker compose ps`仍因缺少必需秘密在插值阶段失败关闭，随后只以精确容器metadata核验。没有真实角色/ACL/凭据、Volume、Migration、备份恢复、UAT/生产或服务变更；TASK56保持唯一`DOING`，下一步闭合secret-file delivery、生产受控operator和custom tablespace持久mount合同。
