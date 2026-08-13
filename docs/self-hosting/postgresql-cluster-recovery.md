# PostgreSQL 逻辑集群安全状态恢复合同

> 版本：`postgresql-cluster-recovery-v1`
> 状态：`REPOSITORY DESIGN AND SYNTHETIC-ISOLATED IMPLEMENTATION ONLY / PRODUCTION NO-GO`
> 适用任务：`SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-55`

## 目的与边界

本合同补足 custom-format `pg_dump --no-owner --no-acl` 无法保存的集群级身份、安全授权与自定义 tablespace 定义。它只覆盖经 allowlist 批准的一个晨亿达 ERP 数据库及其业务角色，不是物理备份、WAL/PITR、HA、跨 major 升级或通用 PostgreSQL 集群克隆工具。

TASK41 的 `chenyida-erp-backup/v2` 七文件和 TASK54 的 `chenyida-erp-offhost-transfer/v1` 保持不变。新恢复代次由以下相互独立且交叉绑定的证据组成：

1. V2 data core 与本机验证回执；
2. data envelope v1 的签名、密文、接收与 source acceptance 链；
3. canonical cluster snapshot 与签名密文 cluster capsule 链；
4. joint transfer v2 receipt，把两条异机链绑定到同一 backup ID、manifest、recovery point、source cluster和目标恢复代次；
5. cluster/tablespace、credential binding、四域恢复与 operations policy 回执；
6. `chenyida-erp-backup-verification/v4` 当前就绪回执。

任一旧V1—V3、仅本机sidecar、仅内容摘要、未异机接收的capsule或synthetic证据都不能产生真实`recovery_ready=true`。

## 源端安全策略

安全策略是快照与恢复共同的权威，不以“源端当前存在”为自动批准。它必须固定：

- PostgreSQL major 17，业务数据库和源/目标逻辑名称；
- migration owner、runtime login、NOLOGIN privilege group、backup capture、restore admin与unauthorized probe的精确职责；
- 可登录角色、NOLOGIN角色、允许的非危险属性、连接上限与有效期；
- 允许的role/database GUC键和值范围；
- 支持的对象类、grantor/grantee闭包、PUBLIC和`pg_database_owner`的唯一内置语义；
- database/schema/object/default/tablespace安全不变量；
- 不支持对象的失败关闭清单和custom tablespace要求。

所有业务角色必须`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`。runtime不得成为数据库、Schema、extension或普通对象owner，不得拥有DDL、SET ROLE或可传递的管理成员关系。migration owner必须继续符合release migration gate；runtime不能为了恢复ACL而加入owner role。PUBLIC不得保留业务Schema CREATE或敏感数据库CONNECT。任一未知grantor、未知role端点、危险属性、越权ACL或不支持对象都阻断capture。

固定内置引用只允许：

- `PUBLIC`作为ACL伪grantee；
- `pg_database_owner`作为现有public Schema安全owner语义；
- 策略明确允许的内置对象owner引用。

不得创建、ALTER或快照内置角色属性，也不得允许其他`pg_*`角色出现在owner、membership或grant端点。

## Canonical cluster snapshot

禁止读取`pg_authid`或任何密码/verifier。角色从`pg_roles`取得名称、安全属性、LOGIN意图、connlimit和valid-until；设置的唯一权威是`pg_db_role_setting`，不得重复使用`pg_roles.rolconfig`。

快照至少关系化覆盖：

- `pg_auth_members`的role/member/grantor与admin/inherit/set options；restore admin grantor用固定sentinel映射；
- `(role|ALL) × (database|ALL)`四种setting scope，按第一个`=`拆分键值并执行显式key allowlist；
- `pg_database` owner、default tablespace、allow-connect、connlimit、ACL；
- namespace owner/ACL；
- table、partitioned table、view、materialized view、sequence、foreign table的owner/ACL与关系tablespace；index/partitioned index只保存placement；
- column ACL；
- overload-safe routine identity、owner/ACL；
- 用户base/domain/enum/range/multirange/独立composite type owner/ACL；
- global/schema default privileges；
- large object owner/ACL；
- extension与publication identity/owner；
- custom tablespace logical name、owner、options、source-location去敏指纹和可重建`CREATE` privileges。

所有ACL以`aclexplode()`规范为grantor、grantee、privilege type、grantable tuple，不以`aclitem::text`为权威；同时保留NULL、显式空ACL和effective ACL差异。tablespace从`pg_tablespace.spcacl`取得显式ACL，并以`acldefault('t', spcowner)`计算effective `CREATE`权限。`pg_parameter_acl`若存在非策略允许项必须拒绝。

extension成员使用`pg_depend.deptype='e'`分流，固定extension name/version/schema/owner和成员权限指纹；恢复archive必须以批准migration owner创建extension，不能假设存在`ALTER EXTENSION OWNER`。FDW/server/user mapping/subscription、event trigger及任何未覆盖的用户对象类默认拒绝；其中可能含凭据的catalog不得写入capsule。

backup writer停止后取得全局运维锁。capture在同一V2 fence内前后执行两次；临时guard引入的数据库connlimit与`default_transaction_read_only=on`必须依据durable intent的原值精确还原/剔除。两次规范摘要、catalog generation和V2 recovery point任一漂移都中止备份。

## Cluster capsule与联合异机链

plaintext snapshot位于V2目录之外的私有临时根，生成后立即封装。cluster capsule采用与data envelope同等级的Ed25519来源签名、X25519/HKDF-SHA256密钥协商与AES-256-GCM客户端加密，绑定：

- backup ID、V2 manifest SHA、local receipt SHA、recovery point；
- source system identifier、database OID/marker、PostgreSQL major；
- migration head/manifest、application revision；
- security policy ID/SHA、cluster snapshot SHA；
- source/receiver location与批准key fingerprints。

接收端必须验证、去重、no-clobber并签发receiver receipt；源端验证后签发acceptance。joint transfer v2不复制或改写两个payload，只以canonical receipt把data envelope v1链与cluster capsule链绑定成同一恢复代次。恢复机必须实际解密并消费两者；仅保存cluster摘要或本机sidecar不是异机恢复证据。

## Tablespace map与路径安全

`pg_default`与`pg_global`禁止出现在map。每个custom tablespace必须以原logical name精确映射到一个目标新空目录，key集合必须与snapshot完全一致；missing、extra、duplicate、realpath alias、祖先/后代重叠一律拒绝。

目标路径必须：

- 是绝对路径且位于批准的数据库服务器专用根；
- 执行器与postmaster共享同一已证明namespace，host path与server path不得靠假设相等；
- 每个祖先与final component均no-follow，前后固定dev/ino/uid/gid/mode；
- 由获准运维预建为PostgreSQL OS uid/gid、`0700`且为空；仓库工具不得自行chown正式路径；
- 与`/`、PGDATA/`pg_tblspc`、仓库、uploads、attachments、backup-status、backup/outbox/receiver/materialization/restore/credential/key/temp根既不相等也无祖先/后代关系；
- 在数据库服务器文件系统通过容量门，并属于批准的持久mount。

不能在location内预放marker，因为`CREATE TABLESPACE`要求空目录。恢复身份保存于restore-root durable intent，并与logical name、catalog OID、owner、COMMENT、location和path inode交叉绑定。PostgreSQL创建版本子目录后不再要求location为空。Compose未提供批准的PGDATA外持久共享mount时，发现custom tablespace必须NO-GO。

## 恢复状态机

任何mutation前先写入并fsync不可变intent，绑定全部输入摘要、目标system ID、目标空态、路径inode和run ID。固定阶段为：

```text
INTENT_DURABLE
  -> ROLE_SKELETON_APPLIED
  -> TABLESPACE_n_RECONCILED_VERIFIED
  -> DATABASE_RECONCILED_VERIFIED
  -> DATA_APPLIED
  -> SECURITY_VERIFIED
  -> CREDENTIALS_VERIFIED
  -> ACTIVATE_PREPARED
  -> PREPARED
  -> PUBLISHED
```

角色骨架、安全属性和可先应用的membership在单事务创建，全部`NOLOGIN PASSWORD NULL`。custom tablespace逐个非事务创建；数据库以源owner/default tablespace、`CONNECTION LIMIT 0`创建并撤销PUBLIC CONNECT。`pg_restore`固定使用批准migration owner、`--no-owner --no-acl --single-transaction`。随后单事务恢复owner、ACL、default privileges、membership和settings，再从目标catalog独立重捕获并与策略及源快照比较。

每个`CREATE/DROP TABLESPACE`与`CREATE/DROP DATABASE`执行`INTENT_DURABLE → COMMAND_DISPATCHED → RECONCILED_APPLIED → VERIFIED`，覆盖服务端成功但客户端响应丢失。相同run ID和payload可resume；相同ID不同payload拒绝。prepared receipt发布中断只补发，不重新执行apply。

补偿先把目标数据库connlimit置0、全部任务login role置NOLOGIN，再依次处理精确数据库、tablespace、角色。只有名称、OID、owner、marker/comment、依赖、path dev/ino与intent完全一致的本任务对象才可补偿；任一歧义只quarantine。目录仅可在DROP成功、catalog无引用、inode仍相同且内容为空时用精确`rmdir`删除，禁止递归猜删。

## 凭据重新绑定与激活

actual/controlled binder强制UID 0。credential root及祖先逐组件no-follow、uid0且不可组/其他写；marker固定，credential file必须regular、uid0、`0400/0600`、nlink1、大小受限，并通过`O_NOFOLLOW`打开FD前后核对dev/ino/size/mtime/ctime/uid/gid/mode/nlink。TEST的`/tmp`例外只能形成synthetic结果。

文件只含非秘密`credential_generation_id`、exact login role set与口令；不得把整文件SHA写入intent或receipt，避免形成离线口令猜测oracle。口令和SCRAM verifier不得进入argv、环境、stdout/stderr、日志、错误、manifest或任何回执；同一进程内可用内存摘要发现并发替换，跨崩溃靠generation ID、role-set fingerprint和实际登录探针判定。

密码先绑定但角色保持NOLOGIN。最终激活前写`ACTIVATE_PREPARED`，在单事务恢复LOGIN意图、数据库connlimit与CONNECT权限；随后用每个runtime/migration凭据执行允许与拒绝探针。失败立即事务性containment为NOLOGIN/PASSWORD NULL与数据库connlimit0，保留intent供resume/inspect。公开credential receipt只含generation、角色集合去敏指纹、数量、时间和状态，不含角色名、路径、密码、verifier、DSN、文件hash或密码派生信息。

## 验证、Dashboard与监控

cluster receipt必须同时证明policy compliant和source equivalent。至少验证：

- role属性、membership端点/grantor/options、四种GUC scope；
- database/schema/object/column/routine/type/large-object owner与ACL；
- default privileges、extension/publication owner；
- tablespace owner、CREATE privileges、logical placement和target identity；
- migration owner满足release migration gate；runtime只能执行批准DML，不能DDL/SET ROLE/取得owner能力；unauthorized probe不能CONNECT或访问Schema/表/routine。

readiness v4独立显示`cluster_security_status`、`credential_binding_status`、`tablespace_status`。旧V3统一为`LEGACY_V3_NO_CLUSTER_SECURITY`并永不ready；synthetic v4也永不ready。浏览器只可获得合同版本、状态枚举、evidence scope与必要时间，不暴露角色名、对象名、路径、key fingerprint、内部hash或错误正文。

监控采用可信root读取v4 canonical evidence的adapter，不接受调用者自报`VERIFIED`。三个独立CRITICAL条件为`BACKUP_CLUSTER_SECURITY_NOT_READY`、`BACKUP_CREDENTIAL_BINDING_NOT_READY`和`BACKUP_TABLESPACE_NOT_READY`，各自保留FIRING/REMINDER/ESCALATED/RECOVERED生命周期。

## 当前明确不由TASK55关闭的P0

- Compose初始化/应用共享高权限数据库身份，Web/Worker尚未拆为最小runtime role；
- `DATABASE_URL`、`POSTGRES_PASSWORD`和admin密码仍通过容器环境传递；
- backup/restore operator仍依赖superuser，尚未职责分离；
- Compose没有custom tablespace批准持久mount或host↔server namespace合同；
- 没有真实密钥、异机目标、真实current数据capsule、第三域恢复或真实credential bind；
- 没有物理备份、WAL/PITR、HA、跨major恢复和已验证RPO/RTO。

这些项目必须在后续独立任务与专项授权中关闭；TASK55合成隔离PASS不得降级任何阻断。
