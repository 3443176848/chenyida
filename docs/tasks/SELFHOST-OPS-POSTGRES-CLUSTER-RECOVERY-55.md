# SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-55 PostgreSQL 集群安全状态与 Tablespace 恢复闭环

> 状态：`DOING / READ-ONLY AUDIT AND REPOSITORY IMPLEMENTATION / SYNTHETIC-ISOLATED ONLY / NO DATA ACTION / PRODUCTION NO-GO`
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
- [ ] 严格快照覆盖 allowlisted roles、memberships/options、四种role/database settings、数据库属性、owner、对象/列 ACL、default privileges、large object、extension/publication owner、parameter ACL门禁和tablespace owner/CREATE privilege；危险属性、非法内置引用、未知/重复/漂移及未支持对象类全部负测失败。
- [ ] 恢复角色骨架默认 NOLOGIN；root-only 合成凭据绑定、错误权限/symlink/hardlink/缺角色/重复秘密和输出泄漏负测通过，秘密/verifier 不进入制品或日志。
- [ ] 数据恢复后 owner/ACL/default privileges 与源一致；运行角色、迁移角色和未授权角色的正/负权限探针通过，未知 privilege escalation 为零。
- [ ] `pg_default`与显式 custom tablespace map 通过；缺失/重复/非空/越界/PGDATA重叠/symlink/错误 owner-mode/崩溃负测不改变受信目标。
- [ ] 非事务 cluster 步骤具备 durable intent、幂等续跑和精确补偿；各中断点不留下可登录半角色、错误 membership 或可用的半恢复数据库。
- [ ] 单容器双 PostgreSQL cluster 合成恢复通过，包含角色、ACL/default privileges、custom tablespace、凭据重新绑定和最小权限运行连接；错误 snapshot/secret/map/target identity 不改变目标。
- [ ] Dashboard/监控对旧 readiness 失败关闭并独立显示 cluster security、credential binding、tablespace 状态；浏览器不暴露角色清单、路径或秘密。
- [ ] 既有 backup/offhost/readiness、Dashboard/monitor、release inventory/contract、typecheck/lint 不降级；新增测试进入正式 inventory，所有重型验证串行且最多一个临时容器。
- [ ] 源码提交后重建 canonical manifest-only 直接子提交，TASK54 bundle 与全部旧候选标记`STALE / NOT AUTHORIZABLE`。
- [ ] 不产生真实角色/凭据、真实 cluster receipt、host 安装、外部 push、UAT/生产/真实数据动作，不声称 WAL/PITR/HA/RPO/RTO 已完成。
- [ ] 当前高权限共享角色、环境变量秘密、superuser operator与custom tablespace持久mount缺口形成明确后续P0；TASK55完成不解除这些实际运行面阻断。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立 Git 提交。

## 7. 启动登记验证

- `git diff --check`通过；变更范围仅为本任务文档和六份项目治理文档，项目负责人既有未跟踪状态报告保持不读、不改、不提交。
- 宿主系统Python的`server.py --self-test`通过，但`smoke_test.py`在导入`openpyxl`前因系统环境缺依赖退出；未安装依赖或降低断言。切换到仓库既有`/opt/erp/.venv/bin/python`后self-test、smoke及任务专用临时SQLite的`go_live_check.py --no-backup`全部通过，临时SQLite与目录已逐项清理。
- 宿主没有Node；在资源门通过后使用一个断网、只读、drop-all、512 MiB限额的既有`node:22-bookworm`临时容器完成凭据门，结果为`CREDENTIAL_CHECK_OK (1604 repository files scanned)`，容器自动删除。
- 检查前后available memory均约1.9 GiB、Swap均541 MiB、根盘可用16 GiB、Load低于1；四服务restart0/OOM false，PostgreSQL/Web healthy、Worker/Caddy health none，没有遗留TASK55启动测试容器或临时SQLite目录。

## 8. 当前判定

`DOING / READ-ONLY AUDIT AND REPOSITORY IMPLEMENTATION / SYNTHETIC-ISOLATED ONLY / PRODUCTION NO-GO`。TASK55只关闭仓库和合成隔离层的 PostgreSQL logical cluster security/tablespace 恢复缺口；真实目标、真实凭据、当前数据恢复、host 安装、WAL/PITR、RPO/RTO、UAT/生产与切换继续需要独立资源及专项明确授权。

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
