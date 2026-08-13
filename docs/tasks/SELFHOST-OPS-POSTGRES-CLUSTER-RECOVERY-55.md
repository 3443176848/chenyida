# SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-55 PostgreSQL 集群安全状态与 Tablespace 恢复闭环

> 状态：`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / ACTUAL RECOVERY AND RUNTIME PRIVILEGE BLOCKED / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@812ec2f0a5c2710c73e7c0e3cbd207f977e6256b` / tree `f4cc747a63ad9979e85ca91e407b3854f56e5149`
> 责任：Codex 主智能体为唯一写者、测试调度者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人继续保留真实数据库/凭据、UAT/生产、host 安装、备份恢复、账号权限、文件系统和切换的专项授权权力

## 1. 目标

关闭 TASK41/TASK54 明确保留的 PostgreSQL 逻辑恢复权限与集群状态缺口，使隔离恢复不再只证明表、行和四域文件一致，而能失败关闭地证明目标数据库具备预期的最小权限、安全所有权和可启动运行条件：

1. 版本化捕获并严格验证允许的数据库角色属性、角色成员关系、角色/数据库设置、数据库/Schema/对象所有权与 ACL、default privileges，以及 tablespace 身份和显式映射需求。
2. 恢复必须先在隔离目标建立无秘密、最小权限的角色骨架，再恢复数据与对象权限；登录凭据只能从 root-only 独立输入重新绑定，密码或 verifier 不得进入 Git、manifest、回执、argv、环境或输出。
3. 自定义 tablespace 必须显式映射到已批准的新空路径；缺映射、路径重叠、指向 PGDATA/文件卷、symlink、复用非空目录或目标身份漂移全部失败关闭。
4. 恢复后以独立、去敏、不可变回执证明角色/成员关系/设置/所有权/ACL/default privileges/tablespace 与批准的安全策略及源快照一致，并把该证据纳入当前恢复就绪、Dashboard、监控和发布 inventory；仅证明“源=目标”不能替代最小权限校验。

## 2. 起点事实

- 现有 `backup-selfhost.sh` 只执行 custom-format `pg_dump --no-owner --no-acl`；没有 `pg_dumpall` 或等价的 cluster-global 角色/成员关系捕获。
- 现有 `restore-selfhost.sh` 以 `pg_restore --no-owner --no-acl` 恢复，因此目标对象归属恢复执行者，源数据库/Schema/对象 ACL 与 default privileges 不会被恢复。
- TASK41/TASK54 已完成四域数据一致性、签名密文异机来源、双向回执、调度/保留和 V3 readiness，但明确排除了 cluster roles、ACL、default privileges 和 tablespace；当前 `recovery_ready` 不能证明这些安全状态。
- 当前源码仍为 alpha.46/0045，非生产 UAT 仍为 alpha.42/0040；TASK55 不连接 UAT/生产数据库，不读取业务行、真实备份、凭据、环境、日志或受保护 Volume 正文。
- 起点主机 available memory 约 1.9 GiB、Swap 541 MiB、根盘可用 16 GiB、Load 低于 1；四服务 restart 0/OOM false，PostgreSQL/Web healthy，Worker/Caddy 无 healthcheck。

## 3. 允许范围

- 三条智能体线只读审计现有 backup/restore、PostgreSQL catalog、Dashboard/monitor、release inventory 和测试边界，主智能体复核并保持唯一写者；
- 在仓库内实现严格版本化、确定性、去敏的 PostgreSQL cluster recovery snapshot、policy、preflight、apply/verify 和不可变 receipt；
- 仅对显式 allowlist 的合成角色、数据库和 tablespace 执行恢复；系统/内置角色、未知角色、SUPERUSER/BYPASSRLS/REPLICATION/CREATEDB/CREATEROLE 等越权属性必须失败关闭；
- 使用 root-only 合成凭据文件验证安全 owner/mode/no-follow/单硬链接边界，并在隔离目标完成凭据重新绑定；测试不得打印秘密或 verifier；
- 使用合成 fixture、临时目录以及最多一个临时 PostgreSQL 容器完成源/目标双 cluster 的正负向恢复、崩溃续跑、幂等和清理验证；所有重任务串行；
- 保持 TASK41 内层 V2 七文件数据核心和 TASK54 签名密文外层 v1 兼容；新增独立加密 cluster capsule、联合 transfer v2 与 readiness v4，不追改已发布合同；
- 更新 Dashboard、监控、恢复手册、release inventory/contract 和 content-addressed supervisor bundle。

## 4. 禁止范围

- 不读取`docs/ERP_CURRENT_STATUS_REPORT.md`、`.env`、真实凭据、容器环境、日志、业务数据库行、备份正文或受保护 Volume 正文；
- 不连接、dump、恢复或修改当前 UAT/生产 PostgreSQL，不创建或轮换真实数据库角色/密码，不读取 `pg_authid.rolpassword`；
- 不运行 UAT/生产 Migration、build/deploy、重启、登录、业务 API、真实数据迁移、员工试用或正式切换；
- 不写入`/usr/local`、`/etc`、`/var/lib/chenyida-erp`或正式证据根，不安装 supervisor/timer/monitor，不修改 systemd、网络、防火墙、Swap、内核或 Docker daemon；
- 不删除数据库、tablespace 目录、备份、镜像、cache、持久数据或四个受保护 Volume，不执行 prune；
- 不把 logical cluster recovery 描述为物理备份、WAL/PITR、HA、跨版本升级、真实灾备或已验证 RPO/RTO；这些能力不在本任务范围。

## 5. 拟实现合同

### 5.1 安全快照与秘密分离

- 快照只覆盖明确业务数据库和批准角色集合，使用稳定排序、规范 JSON 和 SHA-256；未知字段、重复对象、名称混淆、危险属性或 catalog 漂移拒绝。`PUBLIC`和`pg_database_owner`只允许作为策略中固定语义引用，不创建、快照或修改其角色属性；其余`pg_*`角色 owner、membership 或授权端点一律拒绝。
- 角色属性、membership options、四种 role/database setting scope、数据库属性、owner、对象/列 ACL、default ACL、large object、extension/publication owner、parameter ACL 门禁与 tablespace logical identity/`CREATE` privileges 必须关系化表达，不依赖可执行 SQL 文本或`aclitem::text`作为唯一权威。FDW/user mapping/subscription 等可能含秘密或未支持对象类必须失败关闭。
- 源安全快照必须在同一全局运维锁与备份 fence 内前后各捕获一次且规范摘要完全一致；临时`datconnlimit=0`和`default_transaction_read_only=on` guard overlay 必须按 durable intent 精确还原/剔除，不能污染快照。
- 独立安全策略固定 migration owner/runtime/NOLOGIN privilege group/unauthorized probe 的职责不变量、允许设置、grantor闭包、PUBLIC权限及支持对象类；源不满足最小权限时禁止生成可恢复 capsule，不能忠实复制越权状态。
- LOGIN 角色在恢复骨架阶段必须 `NOLOGIN` 且无密码；凭据绑定使用独立 root-only 输入和单独 receipt，只记录 key/role 指纹和结果，不记录密码、verifier 或连接字符串。

### 5.2 恢复顺序与事务边界

- preflight 固定源快照、V2/outer/cluster capsule摘要、目标 cluster/database identity、空目标边界、角色 allowlist 和 tablespace map；任何目标既有冲突或额外权限失败关闭。实际/受控回执发布与凭据绑定必须强制 UID 0；非 root TEST 只能形成 synthetic-only 结果。
- 恢复顺序固定为 durable intent → 单事务安全`NOLOGIN/PASSWORD NULL`角色骨架 → 逐个 custom tablespace → `CONNECTION LIMIT 0`数据库 → `pg_restore --role=<approved migration owner> --no-owner --no-acl --single-transaction` → 单事务 owner/ACL/default privileges/membership/settings → 精确再捕获比较 → root-only 凭据重新绑定 → 激活前后最小权限探针 → prepared/public receipt。
- 可事务化角色、membership与授权步骤必须单事务；`CREATE/DROP TABLESPACE`与`CREATE/DROP DATABASE`等非事务步骤使用`INTENT_DURABLE → COMMAND_DISPATCHED → RECONCILED_APPLIED → VERIFIED`状态、响应丢失 reconciliation 和精确补偿。相同输入幂等续跑，不同输入冲突拒绝；不确定状态只隔离并保持全部登录角色`NOLOGIN`、数据库`CONNECTION LIMIT 0`，不得 trap-only 清理、猜测删除或留下可登录半恢复角色。

### 5.3 Tablespace、验证与恢复就绪

- `pg_default`/`pg_global`以固定内置身份处理且禁止映射；自定义 tablespace 需要源 logical name 与目标新空路径的显式一对一映射，并保留源 logical name。路径必须在数据库服务器同一已证明 namespace 内逐组件 no-follow、固定 dev/ino/uid/gid/mode、远离 PGDATA、仓库、凭据/密钥/备份/恢复根与三个应用文件卷；Compose 未提供批准的持久共享 mount 时实际 custom tablespace 必须 NO-GO。
- PostgreSQL tablespace ACL 从`pg_tablespace.spcacl`关系化展开为`CREATE` privilege/grantor/grantee/grantable，并保留NULL、显式空ACL与effective ACL差异；不能用字符串ACL或仅用`has_tablespace_privilege`代替。目标 location 必须由获准运维预建为空目录，不能在其中放 marker；任务身份保存在 restore-root durable intent，并与 catalog OID/comment/location及 inode 交叉绑定。
- 验证必须覆盖角色属性、grantor/member/admin/inherit/set option、role/database settings、数据库/Schema/表/分区表/视图/物化视图/序列/列/重载 routine/type/default privileges/large object、extension/publication owner、tablespace owner/CREATE权限/location identity及应用/迁移/未授权角色的允许和拒绝操作。
- 当前恢复就绪证据必须版本化升级并要求 cluster receipt、credential binding receipt 与现有内外层恢复链交叉绑定；旧 V1—V3 和 synthetic evidence 保持可解析但不能成为真实 ready。

### 5.4 秘密、传输与当前运行面限制

- 凭据输入必须位于 root-only 专用根，逐组件 no-follow，文件`0400/0600`、uid 0、单硬链接，并以打开 FD 的前后身份核对防并发替换。密码只经受控 stdin/进程内存进入 PostgreSQL，不进入 argv、环境、stdout/stderr、manifest、intent、哈希或回执；文件摘要也不得成为离线猜测 oracle。
- cluster snapshot 不得只留本机 sidecar。独立 cluster capsule 必须签名、客户端加密并由异机接收方确认；联合 transfer v2 只引用并交叉绑定稳定 data envelope v1 与 cluster capsule链。V4 actual readiness 必须证明恢复机实际消费两条链，synthetic结果永远不能 ready。
- 当前 Compose 仍使用初始化 superuser式`POSTGRES_USER`并把数据库/管理员秘密放入环境，Web/Worker还未拆为独立最小 runtime role；当前 backup/restore operator也依赖superuser。TASK55必须将这些事实保持为后续 P0，不得把合成角色恢复通过写成实际运行权限或 secret delivery 已闭合。

## 6. 验收标准

- [x] 三条智能体线完成只读审计，主智能体复核实际 backup/restore、catalog、Dashboard/monitor、release inventory 和安全边界。
- [x] 记录单一架构决策：稳定 V2 数据核心与签名密文外层继续保留，cluster security/tablespace 和新的恢复就绪证据采用独立版本；明确秘密分离与旧证据降级语义。
- [x] 严格快照覆盖 allowlisted roles、memberships/options、四种role/database settings、数据库属性、owner、对象/列 ACL、default privileges、large object、extension/publication owner、parameter ACL门禁和tablespace owner/CREATE privilege；危险属性、非法内置引用、未知/重复/漂移及未支持对象类全部负测失败。
- [x] 恢复角色骨架默认 NOLOGIN；root-only 合成凭据绑定、错误权限/symlink/hardlink/缺角色/重复秘密和输出泄漏负测通过，秘密/verifier 不进入制品或日志。
- [x] 数据恢复后 owner/ACL/default privileges 与源一致；运行角色、迁移角色和未授权角色的正/负权限探针通过，未知 privilege escalation 为零。
- [x] `pg_default`与显式 custom tablespace map 通过；缺失/重复/非空/越界/PGDATA重叠/symlink/错误 owner-mode/崩溃负测不改变受信目标。
- [x] 非事务 cluster 步骤具备 durable intent、幂等续跑和精确补偿；各中断点不留下可登录半角色、错误 membership 或可用的半恢复数据库。
- [x] 单容器双 PostgreSQL cluster 合成恢复通过，包含角色、ACL/default privileges、custom tablespace、凭据重新绑定和最小权限运行连接；错误 snapshot/secret/map/target identity 不改变目标。
- [x] Dashboard/监控对旧 readiness 失败关闭并独立显示 cluster security、credential binding、tablespace 状态；浏览器不暴露角色清单、路径或秘密。
- [x] 既有 backup/offhost/readiness、Dashboard/monitor、release inventory/contract、typecheck/lint 不降级；新增测试进入正式 inventory，所有重型验证串行且最多一个临时容器。
- [x] 源码提交后重建 canonical manifest-only 直接子提交，TASK54 bundle 与全部旧候选标记`STALE / NOT AUTHORIZABLE`。
- [x] 不产生真实角色/凭据、真实 cluster receipt、host 安装、外部 push、UAT/生产/真实数据动作，不声称 WAL/PITR/HA/RPO/RTO 已完成。
- [x] 当前高权限共享角色、环境变量秘密、superuser operator与custom tablespace持久mount缺口形成明确后续P0；TASK55完成不解除这些实际运行面阻断。
- [x] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立 Git 提交。

## 7. 启动登记验证

- `git diff --check`通过；变更范围仅为本任务文档和六份项目治理文档，项目负责人既有未跟踪状态报告保持不读、不改、不提交。
- 宿主系统Python的`server.py --self-test`通过，但`smoke_test.py`在导入`openpyxl`前因系统环境缺依赖退出；未安装依赖或降低断言。切换到仓库既有`/opt/erp/.venv/bin/python`后self-test、smoke及任务专用临时SQLite的`go_live_check.py --no-backup`全部通过，临时SQLite与目录已逐项清理。
- 宿主没有Node；在资源门通过后使用一个断网、只读、drop-all、512 MiB限额的既有`node:22-bookworm`临时容器完成凭据门，结果为`CREDENTIAL_CHECK_OK (1604 repository files scanned)`，容器自动删除。
- 检查前后available memory均约1.9 GiB、Swap均541 MiB、根盘可用16 GiB、Load低于1；四服务restart0/OOM false，PostgreSQL/Web healthy、Worker/Caddy health none，没有遗留TASK55启动测试容器或临时SQLite目录。

## 8. 当前判定

`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / ACTUAL RECOVERY AND RUNTIME PRIVILEGE BLOCKED / PRODUCTION NO-GO`。TASK55只关闭仓库和合成隔离层的 PostgreSQL logical cluster security/tablespace 恢复缺口；真实目标、真实凭据、当前数据恢复、host 安装、WAL/PITR、RPO/RTO、UAT/生产与切换继续需要独立资源及专项明确授权。

## 9. 三线只读审计收敛

- 数据与迁移线确认V2七文件、outer v1均为exact-set合同；cluster状态必须进入独立加密异机链。catalog最小闭包还包括列ACL、large object、parameter ACL、extension/publication owner及四种GUC scope，未知外部对象失败关闭。
- 应用与测试线确认现有V3、Dashboard和monitor均没有cluster/credential/tablespace维度；旧V3必须显示`LEGACY_V3_NO_CLUSTER_SECURITY`且永不ready，浏览器只能收到状态与时间枚举。
- 运维与安全线确认当前恢复在首次`CREATE DATABASE`前没有durable intent，trap清理不能覆盖SIGKILL；tablespace目录namespace、凭据FD身份、响应丢失reconciliation、最终激活containment和root边界必须进入协议。
- 三线均未修改共享工作区，未访问数据库、容器环境、凭据、日志、备份正文、业务数据或受保护Volume；主智能体复核后形成D-132。

## 10. 第一批实现证据

- 新增严格 chenyida-erp-postgresql-cluster-recovery-policy/v1 生产基线与 postgresql-cluster-recovery-contract.mjs。合同已实现 canonical JSON、策略摘要、catalog 规范化、前后 capture 漂移拒绝、V2 恢复身份绑定和去敏 cluster receipt；危险角色属性、未知角色端点、PUBLIC 越权、runtime owner、pg_database_owner 语义滥用、未知对象类、非零 unsupported counter 和 parameter ACL 全部失败关闭。
- catalog 合同已覆盖角色及 PG16+ membership options、四种 setting scope 门禁、数据库属性、Schema/普通对象/列/routine/type/large object ACL、default privileges、extension/publication owner、custom tablespace owner/ACL/location 摘要；ACL 同时保留 NULL/EMPTY/EXPLICIT 和 explicit/effective tuple，不读取 pg_authid 或 verifier。
- 新增 custom tablespace map 校验：源 logical name exact-set、一对一 direct child、approved root、prohibited root、空目录、no-follow、owner/group/mode、realpath alias 和 dev/ino 身份检查。当前只是合成 namespace 合同，尚未证明 Compose 提供实际持久 mount。
- 新增 root-owned 凭据读取边界与去敏回执：专用 marker、逐级目录 owner/write 检查、O_NOFOLLOW、0400/0600、uid0、nlink1、打开 FD 前后及路径身份复核、exact login role set、口令长度/复用门禁；公开 binding/receipt 不含角色名、路径、口令、verifier 或文件 hash。合成测试使用临时假口令，未读取任何真实凭据。
- 新增不可变 intent 和 hash-chain 恢复状态：INTENT_DURABLE 先行，tablespace/database 分别要求 COMMAND_DISPATCHED → RECONCILED_APPLIED → VERIFIED，同输入幂等、冲突输入拒绝、缺失前序持久状态拒绝，之后才能进入 data/security/credential/activation/prepared/published；uncertain 状态只允许 quarantine/compensation。
- 单个断网、只读源码、drop-all、512 MiB Node 临时容器内，专项 7 个测试全部通过；targeted ESLint 零 error/零 warning；credential scan 通过 CREDENTIAL_CHECK_OK（1608 repository files scanned）。加入既有 backup/offhost/Dashboard/release identity 回归后共 65/65 通过。回归前两次因临时 tmpfs 未显式允许执行 fixture 自建的假 pg_restore/psql/docker 而分别出现相同 8 个环境失败；没有降低断言，明确使用 rw,exec,nosuid,nodev 临时 tmpfs 后原样全过。
- 测试后 available memory 约 1.8 GiB、Swap 520 MiB、根盘可用 16 GiB、Load 0.90/0.43/0.22；四服务 restart 0、OOM false，PostgreSQL/Web healthy、Worker/Caddy health none。测试容器均 --rm 清理，无 Node 临时容器遗留；未连接数据库、未读取环境或受保护 Volume 正文。
- 本批尚未实现 catalog SQL capture/apply、cluster capsule/joint transfer v2、实际双 cluster 恢复、readiness v4、Dashboard/monitor 和 release inventory；因此不勾选对应完成项，不改变 PRODUCTION NO-GO。

## 11. 第二批实现证据：真实 PostgreSQL 17 catalog 采集边界

- 新增`postgresql-cluster-catalog.sql`与严格 adapter。采集脚本先建立 session-local helper，再进入单个`REPEATABLE READ, READ ONLY`事务；输出固定顺序的 typed TSV/JSON record，adapter 要求 DATABASE/UNSUPPORTED 唯一、record phase 单调、JSON 无重复 key、数组规范排序，并通过 no-follow、单硬链接、稳定 inode/size/time 身份读取后独占写出`0600`规范 JSON。
- catalog 查询不读取`pg_authid`、`rolpassword`、raw `aclitem::text`或 tablespace 明文路径；ACL 统一经`aclexplode`关系化，tablespace location 只保留 SHA-256。列与 index placement 使用独立`schema`、`parent_identity`、`name`字段，后续 apply 不需要拆解可执行 SQL identity。当前 capture 身份统一映射为固定`RESTORE_ADMIN`语义，同时`capture_role_conflicts`确保其不得与三个策略角色重名。
- fail-closed counter 已覆盖用户 access method/cast/collation/conversion/operator/opclass/opfamily/transform/text-search、event trigger、FDW/server/user mapping/foreign table、subscription/replication origin、RLS/security label/statistics、unsupported relation/language、parameter ACL、策略角色外部 membership endpoint、外部 database setting 与未批准 setting。未批准 setting 的值不会进入原始 report；允许的四个非秘密运行参数才可输出，最终仍须与 policy required set 精确一致。
- extension member 与 publication table/schema/filter 以稳定对象地址/名称生成摘要，不绑定跨 cluster OID；`plpgsql`作为必需 platform extension 固定由`RESTORE_ADMIN`语义拥有，`pgcrypto`/`btree_gist`如存在必须由 migration owner 拥有。PG17 table-like ACL 新增`MAINTAIN`识别；`public` schema 只允许 PostgreSQL 17 默认的 PUBLIC USAGE，PUBLIC CREATE 继续失败关闭。
- 实际 PostgreSQL 17 最小隔离探针暴露并修复了三项不能由 mock 发现的问题：显式 read-only 事务内不能先建 temp table；autocommit 下`ON COMMIT DROP`会立即删除 helper；JavaScript`localeCompare`排序与 PostgreSQL/规范二进制排序对`PUBLIC`和小写身份不一致。最终使用一个断网、只读根文件系统、drop-all、512 MiB、1 CPU、128 pids 的临时`postgres:17-bookworm`容器建立三个无秘密合成角色和隔离数据库，真实执行 catalog SQL；严格 Node adapter 得到`CATALOG_VALID 3 1 1 0`，即3个策略角色、1个普通对象、1个必需 extension、全部 unsupported counter 为0。
- 最新专项测试8/8通过，targeted ESLint零error/零warning，`git diff --check`通过；credential scan为`CREDENTIAL_CHECK_OK (1610 repository files scanned)`。探针和检查均未连接当前常驻 PostgreSQL，未读取环境、凭据、日志、业务数据、备份或受保护Volume正文。
- 检查后available memory约1.8 GiB、Swap 521 MiB、根盘可用16 GiB、Load 0.43/0.48/0.41；常驻四服务仍运行，PostgreSQL/Web healthy。所有`cyd-task55-*`临时容器已`--rm`，两份临时 catalog 文件逐项 unlink、目录 rmdir，无测试数据库、容器或目录遗留。
- 本批只关闭“去敏、严格、真实 PG17 可执行的源 catalog 捕获”子边界；restore plan/apply、双 cluster 等价与权限探针、凭据 stdin 绑定、custom tablespace 实际恢复、cluster capsule/joint transfer v2、readiness v4、Dashboard/monitor和inventory仍未实现，系统继续`PRODUCTION NO-GO`。

## 12. 第三批实现证据：私有恢复计划与单容器双集群

- 新增严格、content-addressed 的`chenyida-erp-postgresql-cluster-restore-plan/v1`私有运维计划。计划由已验证 snapshot、policy、database profile 和 tablespace map 唯一派生，分成事务内 NOLOGIN/PASSWORD NULL 角色骨架、逐 tablespace 非事务命令、CONNECTION LIMIT 0 数据库、固定`pg_restore --role=<migration owner> --no-owner --no-acl --exit-on-error --single-transaction`、事务内 ACL/default privileges/membership/settings、stdin 凭据绑定、原子激活和 quarantine；任何 plan/SQL/hash 漂移拒绝。
- routine 不再保存或重放`pg_get_function_identity_arguments`可执行文本，而以有序`{schema,name}`类型身份重建安全引用；schema/table/view/materialized view/partition/index/sequence/column/routine/type/large object/database/tablespace 均使用独立 identifier quoting。ACL grantor进一步收紧为对象 owner 或`pg_database_owner`，custom tablespace options当前明确不支持并失败关闭。
- 凭据绑定只通过 psql `\\password`的 stdin 交互；child argv、environment、stdout/stderr和公开返回值不含口令，输入 Buffer在成功或失败路径均清零。真实合成测试用运行时随机生成的两份32-byte口令，通过 SCRAM 登录证明 owner/runtime 已绑定；错误口令失败，未读取`pg_authid`或 verifier。文件 mode、替换、symlink、hardlink、缺角色、重复角色、口令复用和公开泄漏负测均失败关闭。
- tablespace preflight 固定空目录 dev/ino/uid/gid/mode、server path与namespace；CREATE后再次逐组件 no-follow，要求同一 inode、非空 PostgreSQL目录、target catalog location hash匹配。tablespace receipt只绑定 tablespace catalog 子集，cluster security receipt再交叉绑定 map、post-create receipt、credential receipt、raw target catalog、规范源等价和目标system identifier，不允许调用方手工替换路径摘要。
- 新增单容器双 PostgreSQL 17 合成演练：源/目标使用不同 system identifier；fixture覆盖3个策略角色、PG16+ membership options、public/app schema、custom tablespace、表/分区/视图/物化视图/序列/列ACL、结构化routine、enum、large object、default privileges、`pgcrypto`/`btree_gist`/`plpgsql`和publication。目标先用角色冲突证明骨架事务回滚，再完成 tablespace、受限数据库、dump restore、安全状态应用、随机凭据绑定、激活、再采集及源等价回执。
- 实际权限探针证明 runtime 可SELECT/INSERT/UPDATE/DELETE、调用routine，但不能DDL或`SET ROLE` owner；owner可执行受控DDL；错误密码失败；无授权角色没有CONNECT且在`SET ROLE`后不能读取业务表。随后 quarantine将两个登录角色恢复NOLOGIN且数据库limit0，再次原子激活成功。
- 首次真实 custom tablespace采集暴露零维空ACL不能直接传给`aclexplode`，第二次暴露`pg_restore`必须显式提供`--dbname`；均修复根因且未降低断言。最终工作区单容器双集群输出`single-container dual-cluster PostgreSQL security recovery passed`，专项单测9/9、targeted ESLint、`sh -n`、`git diff --check`及`CREDENTIAL_CHECK_OK (1613 repository files scanned)`通过。
- 所有`cyd-task55-live-*`容器均自动或按精确身份删除，4次Node临时提取文件逐项unlink、临时目录rmdir；PostgreSQL fixture、随机口令、dump、catalog、SQL plan与测试日志都只存在于容器tmpfs并随容器删除。最终检查available memory约1.8 GiB、Swap 520 MiB、根盘可用16 GiB、Load 0.46/0.27/0.22；四个常驻服务restart 0、OOM false，PostgreSQL/Web healthy、Worker/Caddy health none，无任务容器或host临时目录遗留。
- 当前仍未把 durable state 与实际非事务 executor/响应丢失 reconciliation联成生产 CLI，也未实现 cluster capsule、joint transfer v2、readiness v4、Dashboard/monitor、release inventory或真实custom tablespace持久mount；这些继续保持`PRODUCTION NO-GO`。

## 13. 第四批实现证据：签名密文 cluster capsule 与联合传输 V2

- 新增独立`chenyida-erp-postgresql-cluster-capsule/v1`，不修改稳定的七文件数据V2或`chenyida-erp-offhost-transfer/v1`。capsule只公开backup/snapshot/policy/manifest/local receipt/recovery point摘要、位置与批准key fingerprint；完整canonical cluster snapshot以X25519临时密钥协商、HKDF-SHA256域分离和AES-256-GCM客户端加密，并由源端Ed25519签名。外层和ciphertext均不含角色名、对象名、system identifier或tablespace logical name/path。
- 接收端在独立marked root中执行exact-file-set、no-follow、单硬链接、owner/mode、payload bytes/hash、源签名、AEAD解密、严格JSON、snapshot SHA/policy/V2 binding全链验证；plaintext只在进程内验证，不写接收目录。验证后由独立receiver Ed25519 key签发`CLUSTER_CAPSULE_VERIFIED`回执；源端复核并签发`CLUSTER_RECEIVER_RECEIPT_ACCEPTED`。source/receiver location必须不同，相同传输ID同输入可幂等读取，任何不同输入、额外文件、错key、密文篡改、过期或签名漂移失败关闭且不覆盖既有包。
- 新增`chenyida-erp-joint-offhost-transfer/v2`。它不复制或改写两个payload，而是重新验证data envelope/receiver receipt/source acceptance与cluster capsule/receiver receipt/source acceptance的两组Ed25519链，再要求backup ID、manifest/local receipt SHA、recovery point/expiry、source/receiver location、source machine和三类key fingerprint一致。联合文件只保存两条链的content-addressed摘要与状态，由源端再次签名；TEST只允许`SYNTHETIC_TEST_ONLY`，UAT/PRODUCTION只能进入`ACTUAL_CONTROLLED`，实际制品创建强制UID 0。
- 合成测试在独立source key/outbox、receiver key/root和joint root中运行时生成Ed25519/X25519密钥，覆盖完整seal→receive→accept→verify→joint链、幂等重试与冲突、错误解密key、ciphertext篡改、extra file、stale evidence、data/cluster恢复点与签名篡改、公开制品无敏感目录；所有临时key、snapshot、ciphertext与目录均由fixture精确删除，未读取任何现有密钥、凭据、备份、数据库或受保护Volume。
- 新传输专项3/3、原cluster恢复与传输组合12/12、包含稳定backup/offhost/Dashboard/release identity的完整备份恢复回归70/70通过；targeted ESLint零error/零warning。首次专项执行发现已解析Ed25519 public `KeyObject`被重复解析而拒绝，修复为仍严格校验KeyObject visibility/type/fingerprint后原样全过，没有降低断言。
- 本批只关闭仓库和synthetic隔离层的cluster snapshot异机密文链及joint receipt子边界。尚未实现readiness v4、恢复机持久消费回执、Dashboard/monitor、release inventory、实际非事务executor或任何真实异机传输；因此旧V1—V3仍不得ready，系统继续`PRODUCTION NO-GO`。

## 14. 第五批实现证据：Readiness V4、Dashboard 与监控

- 新增`chenyida-erp-backup-verification/v4`恢复就绪合同。V4同时绑定稳定数据V2、签名密文data envelope、加密cluster capsule、joint transfer v2、恢复机消费回执、cluster security receipt、credential binding、tablespace receipt、当前runtime/database/Migration和操作策略；任一链缺失、过期、混代、摘要或身份漂移均失败关闭。V1—V3继续可解析但固定为legacy，所有`SYNTHETIC_TEST_ONLY`结果永远不能成为实际ready。
- Dashboard只公开去敏的scope/status/time和cluster security、credential binding、tablespace三项状态，不返回角色、对象、路径、口令、verifier或连接串。监控策略新增对应独立告警与恢复事件；旧readiness、缺消费回执或任一cluster子证据均保持CRITICAL，不以数据恢复成功掩盖安全状态缺失。
- V4与Dashboard/monitor专项、旧readiness兼容和泄漏负测通过；仓库未生成任何真实V4回执，也未将当前UAT标记ready。

## 15. 第六批实现证据：崩溃安全 Executor、Reconciliation 与补偿

- 新增实际`postgresql-cluster-recovery-executor.mjs`，把content-addressed restore plan与durable hash-chain state联成受控执行器。每个非事务命令在派发前持久化意图与命令指纹，响应成功或丢失后都从目标catalog重新核对；相同输入可幂等续跑，不同输入、越序、catalog漂移或伪造状态拒绝。
- tablespace/database创建、数据恢复、安全状态应用、凭据绑定、激活、quarantine和精确补偿分别有固定阶段。中断或不确定结果不会开放数据库：登录角色保持`NOLOGIN`、目标数据库保持`CONNECTION LIMIT 0`；只删除能够由本次intent、catalog身份和映射共同证明属于本任务的合成目标，未知对象不猜测清理。
- 故障注入覆盖命令前后、响应丢失、重复执行、状态损坏、目标身份变化、补偿中断和重新激活。单容器双PostgreSQL 17最终同时通过logical backup/restore与cluster security/tablespace恢复，输出`distinct-cluster PostgreSQL backup/restore integration passed`和`single-container dual-cluster PostgreSQL security recovery passed`。

## 16. 发布库存、可信执行与内容寻址证据

- 正式test inventory更新为`239 total / 215 required / 24 not applicable`：`PURE_NODE 113`、`POSTGRES 83`、`BROWSER 6`、`SPECIAL_POSIX 7`、`RELEASE_CONTRACT 6`、`POSTGRES_ALIAS 2`、`HISTORICAL 22`。cluster恢复测试进入SPECIAL POSIX及联合PostgreSQL恢复门，不再是仓库外专项证据。
- 联合恢复wrapper不再从候选archive执行可被候选修改的shell fixture；两份恢复fixture被纳入Supervisor bundle并从只读`/supervisor-tests`执行。备份guard轮询改为从`postgres`数据库读取`pg_db_role_setting`和连接限制，避免为观察只读设置而连接目标数据库、与零连接fence形成竞态；后台进程提前退出会立即报告真实状态。
- `package-lock.json`依赖身份漂移被精确刷新；没有删除依赖、跳过测试或降低断言。源码冻结提交为`b93d838067f3a463f80de04811a11a1dbb5e1848`/tree`269165d4fe054915fe3de77be0eee49ad38b8049`。其直接子提交`2136aa3c4178135a834b5a6e003e64948f78b5d3`/tree`c5b78dabe9ec2bea60c84b7109b5a4c11b35bfea`只修改canonical manifest；bundle含49文件，manifest SHA-256为`699cdd2a55058a38152718a09036255373757191b83d143bd501f995e6d47dd6`。TASK54 bundle、TASK51镜像/诊断和全部更早候选均为`STALE / NOT AUTHORIZABLE`。

## 17. 最终验证、资源与剩余阻断

- 精确源码提交`b93d838`通过：release inventory 6文件/51项及直接合同48/48、Supervisor Python31/31、Vinext build+Node 113文件/965项、PostgreSQL 83文件/396项、Browser 6文件/11项、SPECIAL POSIX 7文件/57项、TypeScript 38/38、release Migration PostgreSQL、联合backup/cluster recovery、Python self-test/smoke/go-live、Compose 6服务策略、六服务隔离runtime、凭据扫描1617文件及`git diff --check`。ESLint为0 error/17条既有warning。
- manifest-only最终HEAD`2136aa3`又复跑release 51+48、Supervisor31和凭据1617文件并通过。Compose独立调用首次因缺候选镜像身份按合同失败关闭；config-only确定性摘要验证通过。runtime实测使用本机已缓存的TASK51历史镜像只验证六服务内核策略，明确不作为`b93d838`源码匹配镜像或正式发布证据。
- 起点available约1.9GiB、Swap541MiB、根盘16GiB、Load低于1；最终检查available约2.0GiB、Swap632MiB、根盘16GiB、Load`0.08/0.43/0.92`、内核`oom_kill=0`，未达到资源停止线。四个常驻服务restart0/OOM false；任务临时容器、数据库、网络、Volume和host临时文件均清零，四个受保护Volume未读取正文、未删除或修改。
- 本任务没有生成与`b93d838`匹配的Web/Worker镜像、正式SBOM/漏洞证据、installed Supervisor或19步正式PASS；没有真实异机、真实密钥/凭据、当前数据恢复、custom tablespace持久mount、host调度/告警、UAT Migration/deploy、岗位验收、员工试用或切换。当前Compose仍以共享初始化superuser和环境变量传递数据库/管理员秘密，backup/restore operator仍依赖superuser，Web/Worker尚未使用独立最小runtime role。
- 下一项最高优先级、无需生产授权的安全任务是独立关闭未来Compose/PostgreSQL最小运行角色、secret-file delivery、受控operator与custom tablespace持久mount仓库合同；真实目标、真实数据和host/UAT动作继续按A1—A8专项授权执行。
