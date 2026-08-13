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
4. 恢复后以独立、去敏、不可变回执证明角色/成员关系/设置/所有权/ACL/default privileges/tablespace 与源快照一致，并把该证据纳入当前恢复就绪、Dashboard、监控和发布 inventory。

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
- 保持 TASK41 内层 V2 数据核心和 TASK54 签名密文外层兼容，采用新版本证据闭合 cluster recovery，不追改已发布合同；
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

- 快照只覆盖明确业务数据库和批准角色集合，使用稳定排序、规范 JSON 和 SHA-256；未知字段、重复对象、名称混淆、系统角色、危险属性或 catalog 漂移拒绝。
- 角色属性、membership options、role/database settings、owner、ACL/default ACL 和 tablespace logical identity 必须关系化表达，不依赖可执行 SQL 文本作为唯一权威。
- LOGIN 角色在恢复骨架阶段必须 `NOLOGIN` 且无密码；凭据绑定使用独立 root-only 输入和单独 receipt，只记录 key/role 指纹和结果，不记录密码、verifier 或连接字符串。

### 5.2 恢复顺序与事务边界

- preflight 固定源快照、目标 cluster/database identity、空目标边界、角色 allowlist 和 tablespace map；任何目标既有冲突或额外权限失败关闭。
- 恢复顺序固定为安全角色骨架与 tablespace → 数据库/Schema/对象数据 → owner/ACL/default privileges/role settings → 凭据重新绑定 → runtime 连接与最小权限验证。
- 可事务化步骤必须单事务；cluster-global 非事务步骤使用 durable intent、prepared/applied/verified 状态和精确补偿。相同输入幂等续跑，不同输入冲突拒绝，不得留下可登录的半恢复角色。

### 5.3 Tablespace、验证与恢复就绪

- `pg_default`/`pg_global`以固定内置身份处理；自定义 tablespace 需要源 logical identity 与目标绝对路径的显式一对一映射，路径必须新建、空、no-follow、远离 PGDATA 与应用文件卷并受 owner/mode 检查。
- 验证必须覆盖角色属性、grantor/member/admin/inherit/set option、role/database settings、数据库/Schema/表/序列/函数 owner/ACL、default privileges、tablespace owner/ACL/location identity及应用/迁移角色的允许和拒绝操作。
- 当前恢复就绪证据必须版本化升级并要求 cluster receipt、credential binding receipt 与现有内外层恢复链交叉绑定；旧 V1—V3 和 synthetic evidence 保持可解析但不能成为真实 ready。

## 6. 验收标准

- [ ] 三条智能体线完成只读审计，主智能体复核实际 backup/restore、catalog、Dashboard/monitor、release inventory 和安全边界。
- [ ] 记录单一架构决策：稳定 V2 数据核心与签名密文外层继续保留，cluster security/tablespace 和新的恢复就绪证据采用独立版本；明确秘密分离与旧证据降级语义。
- [ ] 严格快照覆盖 allowlisted roles、memberships/options、role/database settings、owners、ACL/default privileges 和 tablespace；危险属性、系统角色、未知/重复/漂移全部负测失败。
- [ ] 恢复角色骨架默认 NOLOGIN；root-only 合成凭据绑定、错误权限/symlink/hardlink/缺角色/重复秘密和输出泄漏负测通过，秘密/verifier 不进入制品或日志。
- [ ] 数据恢复后 owner/ACL/default privileges 与源一致；运行角色、迁移角色和未授权角色的正/负权限探针通过，未知 privilege escalation 为零。
- [ ] `pg_default`与显式 custom tablespace map 通过；缺失/重复/非空/越界/PGDATA重叠/symlink/错误 owner-mode/崩溃负测不改变受信目标。
- [ ] 非事务 cluster 步骤具备 durable intent、幂等续跑和精确补偿；各中断点不留下可登录半角色、错误 membership 或可用的半恢复数据库。
- [ ] 单容器双 PostgreSQL cluster 合成恢复通过，包含角色、ACL/default privileges、custom tablespace、凭据重新绑定和最小权限运行连接；错误 snapshot/secret/map/target identity 不改变目标。
- [ ] Dashboard/监控对旧 readiness 失败关闭并独立显示 cluster security、credential binding、tablespace 状态；浏览器不暴露角色清单、路径或秘密。
- [ ] 既有 backup/offhost/readiness、Dashboard/monitor、release inventory/contract、typecheck/lint 不降级；新增测试进入正式 inventory，所有重型验证串行且最多一个临时容器。
- [ ] 源码提交后重建 canonical manifest-only 直接子提交，TASK54 bundle 与全部旧候选标记`STALE / NOT AUTHORIZABLE`。
- [ ] 不产生真实角色/凭据、真实 cluster receipt、host 安装、外部 push、UAT/生产/真实数据动作，不声称 WAL/PITR/HA/RPO/RTO 已完成。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立 Git 提交。

## 7. 启动登记验证

- `git diff --check`通过；变更范围仅为本任务文档和六份项目治理文档，项目负责人既有未跟踪状态报告保持不读、不改、不提交。
- 宿主系统Python的`server.py --self-test`通过，但`smoke_test.py`在导入`openpyxl`前因系统环境缺依赖退出；未安装依赖或降低断言。切换到仓库既有`/opt/erp/.venv/bin/python`后self-test、smoke及任务专用临时SQLite的`go_live_check.py --no-backup`全部通过，临时SQLite与目录已逐项清理。
- 宿主没有Node；在资源门通过后使用一个断网、只读、drop-all、512 MiB限额的既有`node:22-bookworm`临时容器完成凭据门，结果为`CREDENTIAL_CHECK_OK (1604 repository files scanned)`，容器自动删除。
- 检查前后available memory均约1.9 GiB、Swap均541 MiB、根盘可用16 GiB、Load低于1；四服务restart0/OOM false，PostgreSQL/Web healthy、Worker/Caddy health none，没有遗留TASK55启动测试容器或临时SQLite目录。

## 8. 当前判定

`DOING / READ-ONLY AUDIT AND REPOSITORY IMPLEMENTATION / SYNTHETIC-ISOLATED ONLY / PRODUCTION NO-GO`。TASK55只关闭仓库和合成隔离层的 PostgreSQL logical cluster security/tablespace 恢复缺口；真实目标、真实凭据、当前数据恢复、host 安装、WAL/PITR、RPO/RTO、UAT/生产与切换继续需要独立资源及专项明确授权。
