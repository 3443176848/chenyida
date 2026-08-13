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

- [ ] 三条智能体线完成只读审计，主智能体复核当前Compose/连接池、UAT去敏catalog摘要、Migration身份合同、backup/restore能力、对象访问面和custom tablespace边界。
- [ ] 记录单一架构决策，明确owner/migration、Web、Worker、backup capture、受控operator和恢复角色的登录性、membership、连接上限、对象权限、秘密生命周期及旧D-132/V4兼容升级方式。
- [ ] 版本化权限策略使用exact set与稳定摘要覆盖角色属性、membership options、数据库/Schema/表/序列/routine/type/大对象/默认权限和custom tablespace；未知、额外、危险或漂移状态失败关闭。
- [ ] 在线Web/Worker使用不同LOGIN和不同凭据，均非owner/non-superuser且不能DDL、SET ROLE owner、创建角色/数据库、绕过RLS、读取系统秘密或访问对方未获准对象；连接后实际身份断言与正反权限测试通过。
- [ ] Migration使用独立、非superuser、低连接数身份并满足精确数据库owner/对象owner合同；只有Migration可执行版本化DDL，应用与backup身份不能写Migration历史或改变owner/ACL/default privileges。
- [ ] Backup capture不再依赖superuser且只获得完整逻辑备份所需的精确读取权限；需要ALTER DATABASE/terminate backend/CREATE TABLESPACE/CREATEROLE的控制动作与常驻读取身份分离，并由root-only一次性授权、固定目标和去敏回执约束。
- [ ] UAT/PRODUCTION配置拒绝`DATABASE_URL`、`ERP_MIGRATION_DATABASE_URL`、`POSTGRES_PASSWORD`、`ERP_ADMIN_PASSWORD`、`ERP_SETUP_TOKEN`等秘密环境值；每服务secret文件具有独立路径、owner/group/mode/no-follow/单硬链接和内容边界，缺失、复用、错权限、symlink、hardlink、替换或泄漏负测通过。
- [ ] 开发/测试兼容入口只接受显式隔离身份，不能在UAT/PRODUCTION或release candidate中降级；错误不得回显连接串、口令、文件路径或角色清单。
- [ ] Compose声明独立`erp_postgres_tablespaces`持久Volume和固定容器namespace；runtime policy、恢复map与release gate验证精确mount、只读/读写边界、owner/mode和禁止与PGDATA/应用卷重叠，当前运行面未创建该Volume。
- [ ] 单容器隔离PostgreSQL 17完成空cluster bootstrap、45个Migration、角色/ACL reconcile、Web与Worker允许操作、备份dump、未授权拒绝、重复执行、故障回滚和新空目标权限复核；临时数据库、秘密、容器、网络、Volume和目录全部清理。
- [ ] 现有Node/PostgreSQL/Browser/POSIX、Migration、backup/restore、Dashboard/monitor、Compose/runtime和release合同不降级；新增测试进入正式inventory，所有重任务串行且最多一个临时容器。
- [ ] 源码冻结后重建canonical manifest-only直接子提交，TASK55 bundle和全部旧候选标记`STALE / NOT AUTHORIZABLE`；不把历史TASK51镜像当作新源码候选。
- [ ] 不产生真实角色/密码、可消费授权、真实secret文件、真实tablespace、host安装、外部push、UAT/生产/真实数据动作；系统保持`PRODUCTION NO-GO`。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立Git提交。

## 6. 启动核验

- 严格起点为TASK55收口提交`fb1f7e8893b2affba0ca07ecd9629ae2726adca9`/tree`13fe6ce3d04b60bbc724f63b9fa7b5bdc5d16d3e`；根仓库只保留项目负责人既有未跟踪状态报告，Site/Python目录均属于同一根仓库，没有嵌套提交边界。
- TASK55提交后release contracts 51/51、Supervisor Python31/31、Python self-test/smoke/go-live和1617文件credentials通过；TASK55临时容器与临时目录为零。
- 只读运行核验只输出角色能力布尔值、数量、Migration head/checksum、对象owner计数和连接角色计数；没有输出角色名、连接串、密码、业务值或容器环境。
- 源码45个Migration与0045 checksum匹配文档；UAT只读为40/head、227表，Web alpha.42、源码alpha.46，四服务状态与挂载未变化。
- 启动文档门通过：394个Markdown文件/229个本地链接、214个JSON、38个Shell、1618个显式仓库文件凭据扫描、release contract 51/51及Python self-test/smoke/go-live全部通过；Node检查使用现有固定镜像、断网/只读/零capability且一次一个临时容器，Python使用现有项目`.venv`和自动清理的临时SQLite。
- 宿主缺少Node/jq，系统Python缺少`openpyxl`；这些首次检查均在业务断言前失败，随后改用既有固定Node镜像和项目`.venv`通过，未安装依赖或降低断言。带当前受控env文件的`docker compose ps`因缺少Migration变量在插值阶段失败；直接Docker metadata仍确认四服务running、restart0/OOM false，未读取或输出env内容。

## 7. 当前判定

`DOING / READ-ONLY AUDIT AND REPOSITORY IMPLEMENTATION / ISOLATED-ONLY / NO RUNTIME CHANGE / PRODUCTION NO-GO`。当前系统仍由单一superuser承担数据库owner、全部对象owner和Web/Worker连接，且秘密通过环境变量交付；在TASK56仓库闭环、源码匹配候选、正式门、专项授权部署与运行复核完成前，不得投入真实员工使用。
