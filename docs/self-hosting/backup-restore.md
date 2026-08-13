# 自托管备份、签名密文异机来源与隔离恢复 V2/V3

> 当前能力：`REPOSITORY AND ENCRYPTED SYNTHETIC-ISOLATED VERIFIED / ACTUAL OFFHOST BLOCKED`。本页描述已通过隔离测试的内层 V2、外层 transfer v1 与 readiness v3 合同，不代表已经存在真实异机备份，也不授权读取当前卷、传输真实数据、恢复当前数据或部署生产。

浏览器只读取去敏回执并失败关闭，不创建备份、不下载制品、不执行恢复。任何 UAT 或生产备份、外传、恢复和切换仍须项目负责人对精确数据源、目标、窗口和责任人专项授权。

## 1. 信任边界与数据范围

V2 同时保护四个数据域：

- PostgreSQL 完整应用数据库逻辑 dump；
- `uploads`；
- `attachments`；
- `backup-status` 回执历史。

数据库 dump 使用 `--no-owner --no-acl`，因此不包含集群角色、角色密码、tablespace 或集群级 ACL。正式灾备必须另行备份并受控恢复这些集群级对象；不得把 V2 应用 dump 表述为 PostgreSQL 集群物理备份。

工具信任 root 管理边界、唯一串行运维任务和已停止的精确 Compose Web/Worker。它通过数据库级 `CONNECTION LIMIT 0`、`default_transaction_read_only=on`、连接清退和前后全表内容摘要提供纵深保护，但不防御同时持有 root/PostgreSQL superuser 的恶意并发操作者。备份、恢复、Migration、部署必须继续共享外部全局重任务锁并串行执行。

## 2. 专用目录与凭据

每个目录必须是非符号链接、固定 owner/mode，并含匹配的只读 marker：

| 用途 | 推荐 mode | marker | marker 内容 |
| --- | ---: | --- | --- |
| 本机备份根 | `0700` | `.chenyida-erp-backup-root-v2` | `chenyida-erp-backup-root/v2` |
| 源端密文 outbox | `0700` | `.chenyida-erp-transfer-outbox-v1` | `chenyida-erp-transfer-outbox/v1` |
| 接收端密文根 | `0700` | `.chenyida-erp-transfer-receiver-v1` | `chenyida-erp-transfer-receiver/v1` |
| 源端/接收端密钥根 | `0700` | `.chenyida-erp-offhost-key-root-v1` | `chenyida-erp-offhost-key-root/v1` |
| 恢复临时物化根 | `0700` | `.chenyida-erp-offhost-root-v2` | `chenyida-erp-offhost-root/v2` |
| 调度/保留状态根 | `0700` | `.chenyida-erp-backup-operations-root-v1` | `chenyida-erp-backup-operations-root/v1` |
| 隔离恢复根 | `0700` | `.chenyida-erp-restore-root-v2` | `chenyida-erp-restore-root/v2` |
| 数据库凭据根 | `0700` | `.chenyida-erp-credential-root-v2` | `chenyida-erp-credential-root/v2` |
| Dashboard 回执根 | `2750`、Web 只读组 | `.chenyida-erp-receipt-root-v2` | `chenyida-erp-receipt-root/v2` |
| 运行发布身份根 | `0750`、Web 只读组 | `.chenyida-erp-release-identity-root-v1` | `chenyida-erp-release-identity-root/v1` |

marker 为 root-owned、单硬链接、`0400`或`0600`；运行发布身份 marker/file 固定为 root-owned、Web reader group、`0440`。目录不得与仓库、数据源、Migration、凭据或彼此危险重叠。

数据库认证只允许 root-only libpq service 文件，例如：

```ini
[erp_backup]
host=/run/postgresql
port=5432
dbname=chenyida_erp
user=erp_backup_operator
password=REDACTED_IN_ROOT_ONLY_FILE
```

文件必须位于凭据根内、root-owned、单硬链接、`0400`或`0600`。不要把密码、URL、Token 或私钥放入命令参数、环境输出、manifest、回执、Git 或聊天；工具也拒绝 service 文件中的外部 `passfile`/`sslkey` 引用。真实凭据文件的创建、轮换和权限属于独立受控运维动作。

## 3. 运行发布身份

Dashboard 只有在runtime identity v3与独立postdeploy PASS回执、数据库、完整Migration、runtime policy、备份策略和恢复回执全部匹配时才显示`recovery_ready=true`。候选部署后，不得直接运行仓库中的`write-release-identity.sh`，也不得使用旧的`--application-version`、`--git-commit`、`PUBLISH_RUNTIME_RELEASE_IDENTITY`或manifest-to-identity命令；这些入口不能证明四服务实际来自同一个已验候选。

当前唯一受控入口是已安装的content-addressed supervisor。项目负责人须针对精确的`ELIGIBLE`manifest、manifest SHA、bundle SHA、`POST_DEPLOY_CURRENT_RUNTIME_STRICT`、固定runtime policy、deployment/Compose project、reader GID和实际Caddy/PostgreSQL/Web/Worker四容器签发root-only、规范JSON、短时一次性`VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY`授权。授权参数固定为：

```text
release_manifest
release_manifest_sha256
postdeploy_root
identity_root
reader_gid
run_id
runtime_guard_contract
runtime_guard_mode
runtime_policy_sha256
deployment_class
deployment_id
caddy_container
postgres_container
web_container
worker_container
compose_project
```

授权文件只能位于`/var/lib/chenyida-erp/release-authorizations/pending/<authorization-id>.json`，owner/mode 固定为`root:root 0400`；不得把 nonce、凭据或授权正文放入聊天、Git 或普通 shell history。取得独立专项授权并核对安装回执后，调用形态为：

```bash
sudo /usr/local/sbin/chenyida-erp-release-supervisor-v1 \
  --bundle-sha256 "$SUPERVISOR_BUNDLE_SHA256" \
  --authorization-file "/var/lib/chenyida-erp/release-authorizations/pending/$AUTHORIZATION_ID.json"
```

launcher在执行前消费一次性授权并只映射到固定动作。验证器只读检查四个不同容器的实际ID、运行/OOM/restart/health、唯一Compose project/service、registry manifest/config、OCI version/revision、deployment class/id、完整Migration head/manifest SHA、runtime policy以及两次稳定readiness；Web/Worker loopback引用、第五个Compose容器或任一漂移均拒绝。它先以两阶段无覆盖方式发布规范postdeploy PASS回执，再只从该回执及其真实SHA派生`release-identity.json` v3。

回执已发布而identity提交中断时，不删除或手工覆盖回执；用同一授权/run ID重试，工具会重新严格验证当前运行面并恢复精确prepared/同inode published状态。payload冲突、伪摘要、授权或运行变化均失败关闭。动作不启动、停止或替换容器。当前host supervisor尚未获授权安装，UAT也仍是alpha.42/0040，因此本节只是未来受控操作合同，不是已执行记录。

## 4. 创建本机一致性备份

执行前必须：

1. 获得精确 UAT/生产备份授权和维护窗口；
2. 记录 Web/Worker 容器 ID、镜像 digest、版本、Git SHA、Migration head 和数据库稳定身份；
3. 通过受控 Compose 操作停止精确 Web 与 Worker，确认没有替代 writer；
4. 检查内存、Swap、磁盘、Load、容器 restart/OOM 与目标容量；
5. 确认没有残留 `.backup-fence-v2.json`。存在时不得重跑，必须按第 5 节恢复守卫。

入口为 `scripts/backup-selfhost.sh`。它要求显式 deployment class/token、专用根、root-only service 文件、四个源目录、精确已停止 Web/Worker、策略/RPO 和目标 reader GID。示意：

```bash
sudo scripts/backup-selfhost.sh \
  --credential-root /run/chenyida-erp/credentials \
  --db-service-file /run/chenyida-erp/credentials/pg_service.conf \
  --db-service erp_backup \
  --deployment-class UAT \
  --deployment-id chenyida-erp-parallel \
  --expected-database chenyida_erp \
  --uploads /var/lib/chenyida-erp/uploads \
  --attachments /var/lib/chenyida-erp/attachments \
  --backup-status /var/lib/chenyida-erp/backup-status \
  --migrations /opt/chenyida-erp/drizzle-postgres \
  --backup-root /var/backups/chenyida-erp-v2 \
  --receipt-root /var/lib/chenyida-erp/backup-status \
  --receipt-reader-gid "$ERP_WEB_READER_GID" \
  --web-container chenyida-erp-parallel-web-1 \
  --worker-container chenyida-erp-parallel-worker-1 \
  --location-id primary-host \
  --policy-id approved-policy-id \
  --rpo-hours 24 \
  --confirm UAT_BACKUP_V2_AUTHORIZED
```

生产 token 为 `PRODUCTION_BACKUP_V2_AUTHORIZED`，且必须由 root 执行。脚本会先持久化数据库守卫意图，再设置只读/连接边界并清退连接；随后计算数据库和三个文件树的前后内容摘要、生成 custom dump 与三个 tar、绑定完整 Migration 清单、应用/提交/两个实际镜像和容器 ID，最后发布不可变 `<backup-id>.local.json` 及单调别名。只有成功释放数据库守卫后才发布 `LOCAL_VERIFIED`。

manifest 的一致性声明固定为 `QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION`，dump 范围固定为 `COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL`。目录和制品使用 no-clobber、fsync、严格文件集合、大小与 SHA-256；本机回执还绑定 `/etc/machine-id` 摘要及备份根 device/inode。

## 5. 守卫中断恢复

若备份进程在守卫建立后异常终止，数据库会故意保持拒绝新连接/默认只读，且 `.backup-fence-v2.json` 保留。此时不要删除 intent、不要手工放开数据库、不要直接重跑备份。

在核对精确 deployment、数据库 system identifier/OID/comment、源 marker、原 connection limit、备份根 device/inode、零其他连接和凭据未变化后，运行：

```bash
sudo scripts/recover-backup-guard.sh \
  --credential-root /run/chenyida-erp/credentials \
  --db-service-file /run/chenyida-erp/credentials/pg_service.conf \
  --db-service erp_backup \
  --backup-root /var/backups/chenyida-erp-v2 \
  --deployment-class UAT \
  --deployment-id chenyida-erp-parallel \
  --expected-database chenyida_erp \
  --expected-database-system-identifier "$EXPECTED_SYSTEM_ID" \
  --expected-database-oid "$EXPECTED_DATABASE_OID" \
  --expected-database-marker UAT.chenyida-erp-parallel \
  --confirm RECOVER_EXACT_STALE_BACKUP_GUARD
```

恢复器只在 live 状态仍属于该精确守卫转换时复原原 connection limit 和 writable default，最终验证后才 fsync 删除 intent。身份或状态有歧义时失败关闭并要求人工隔离调查。

## 6. 签名密文异机链与 `OFFHOST_VERIFIED`

D-131/TASK54 已交付仓库合同，但没有创建真实密钥、异机或调度。项目负责人必须先指定与源主机不同的故障域、源/接收位置、密钥托管与轮换、RPO/RTO、cadence/grace、保留/WORM、责任人和告警，并按 A4 分项授权真实数据读取、外传及第三域恢复。

外层合同固定为：

1. 源端 `seal` 只接受完整复验且未过期的 V2 `LOCAL_VERIFIED`；以随机 content key 对四域做 AES-256-GCM，使用临时 X25519 + 接收方 X25519 与 HKDF-SHA256 封装 content key，并由源端 Ed25519 签名 canonical envelope。长期 outbox 只保留密文和严格 evidence，不把明文副本称为异机对象。
2. 接收端 `receive` 先验证批准源公钥、key allowlist、envelope 签名、密文大小/SHA、重放/时效/接收身份，再在私有 staging 解密并复验内层 V2；全部通过后才原子晋升密文 package 与接收方 Ed25519 `OFFHOST_VERIFIED`回执。
3. 源端 `accept-receipt` 复验独立接收签名及 envelope/inner 摘要链，再发布源端签名的 `RECEIVER_RECEIPT_ACCEPTED`。只有 receiver receipt 与 source acceptance 同时存在，才构成可供恢复消费的双向 ACK。
4. 恢复机 `materialize-for-restore` 必须再次验证 envelope、两份签名、operations policy、freshness、receiver/source location 与 key identity，然后把精确内层 V2 短暂物化到专用根。成功/失败后由恢复入口自动精确清理；身份不明时隔离保留，不猜测删除。

CLI 入口是 `scripts/offhost-transfer-contract.mjs`，动作仅为 `seal`、`receive`、`accept-receipt`、`materialize-for-restore`、`verify-materialized-for-restore`和带精确确认词的`cleanup-materialized-for-restore`。参数必须使用专用绝对路径和 root-only 文件；私钥、口令、Token 不得进入环境、stdout/stderr、回执、Git 或聊天。

源/接收私钥和公钥文件都要经过 owner、mode、单硬链接、非符号链接及安全祖先检查。算法、AAD、tag、签名、key fingerprint、backup/transfer ID、inner manifest/local receipt、source/receiver location 和 policy 任一漂移均失败关闭。相同 ID/相同 payload 可幂等续跑；相同 ID/不同 payload、partial inbox、截断、错误 key、混代或重放不得覆盖可信 evidence。

旧 `verify-backup-selfhost.sh` 与 V2 offhost receipt 只保留内层兼容/历史审计能力；明文人工复制不再满足当前策略，也不能产生 V3 recovery readiness。

### 6.1 调度与保留

`scripts/backup-operations-policy.mjs`只提供版本化 evaluator 和 planner：

- UTC policy 显式固定 schedule anchor、cadence、RPO、grace、最大运行时间、保留天数、最少成功/恢复代次、source/receiver location 与 key allowlist；UAT/PRODUCTION 不接受隐式默认。
- 单调 state/history、filesystem lock、CAS 与全局重任务锁共同保证单飞；锁忙、`MISSED`、`DEFERRED`、失败、未来时间或时钟倒退都不推进 last success。
- `evaluate`输出去敏 schedule/RPO/lock状态；只有完整签名密文链才能记录成功。
- `plan-retention`只输出 canonical `DRY_RUN_DELETION_FORBIDDEN`计划。latest、inflight、hold、RPO内、最低代数及最后/最低恢复验证代均受保护；本仓库没有删除执行器。

仓库 evaluator 不等于已安装 timer。真实 timer、WORM/object-lock、保留删除、密钥轮换及容量告警必须另获授权、安装并观察后才能进入 actual readiness。

## 7. 隔离恢复与 `RESTORE_VERIFIED`

恢复只接受：

- `--target-deployment-class TEST`；
- 与源 PostgreSQL system identifier 不同且带固定 cluster comment 的隔离集群；
- 独占 superuser 管理连接、零其他 client backend；
- 尚不存在、名称以 `_restore_test` 结尾的新数据库；
- 尚不存在的文件目标；
- 已验证的不可变密文 receiver package、receiver `OFFHOST_VERIFIED`、source `RECEIVER_RECEIPT_ACCEPTED`、批准公钥/接收私钥及匹配 operations policy；
- `RESTORE_SIGNED_ENCRYPTED_OFFHOST_TO_MARKED_DISPOSABLE_TEST_TARGET` 显式 token。

入口为 `scripts/restore-selfhost.sh`。完整参数以脚本 usage 为准，必须逐项给出 source deployment/database/profile/bytes、目标 cluster/marker/system ID、恢复 run/location、版本/镜像/Migration/策略/RPO、四个专用根和 root-only service 文件。

恢复器先复验完整外层 provenance 并在专用根短暂物化内层 V2，再把内层字节复制到 private durable staging 并再次校验；随后以 `CONNECTION LIMIT 0` 创建精确测试库、staging 解包三个文件域、单事务 `pg_restore`、核对 Migration、原子晋升文件、执行数据库和文件全量 reconciliation。数据库创建响应不确定时只清理由本任务在零目标前置条件下创建且仍为空/未标记的精确 OID；任何身份歧义都隔离保留，不猜测删除。外层物化在成功和可判定失败路径均精确清理，不能作为长期明文异机副本。

普通故障注入点会把本任务创建的数据库和文件目标清回空态。最终 active inspection 成功后，工具先在恢复根持久化 root-only `.prepared-<backup-id>-<restore-run-id>.json`，再进入保全边界：若公开回执失败，已验证测试目标与 prepared evidence 保留，避免把成功恢复误删。

只补发回执时使用：

```bash
sudo scripts/publish-restore-receipt-selfhost.sh \
  --restore-root /var/lib/chenyida-erp/isolated-restore \
  --receipt-root /var/lib/chenyida-erp/backup-status \
  --receipt-reader-gid "$ERP_WEB_READER_GID" \
  --backup-id "$BACKUP_ID" \
  --restore-run-id "$RESTORE_RUN_ID" \
  --confirm PUBLISH_PREPARED_RESTORE_RECEIPT
```

该补发工具只读取已经落盘的 prepared receipt，不重新连接数据库或读取可变恢复文件。成功生成不可变 `<backup-id>.<restore-run-id>.restore.json` 及单调 `restore.json`/`latest.json`。隔离恢复目标的后续删除是独立、精确、可审计的清理动作；脚本不会自动删除已成功验证目标。

## 8. Dashboard 判定

Dashboard 对旧 schema v1 只显示 `LEGACY_LOCAL_ONLY`，任意 V2 显示 `LEGACY_V2_INNER_ONLY`；两者都绝不视为当前策略下可恢复。权威合同是 root 发布的 `chenyida-erp-backup-verification/v3`，并分离：

- `verification_status`：回执层级或 `UNVERIFIED/INVALID/STALE`；
- `evidence_scope`：`ACTUAL_OFFHOST`或`SYNTHETIC_ISOLATED`；
- `transfer_status` / `encryption_status`：外层双向签名来源与密文链是否完整；
- `schedule_status` / `retention_status`：实际调度是否准时并已观察、dry-run保留计划是否有效；
- `identity_status`：回执与实际 runtime/database/Migration 身份是否匹配；
- `policy_status`：policy/RPO 是否匹配且未过期；
- `assurance_status`：是否为预期异机接收方和预期不同集群上的恢复证据；
- `recovery_ready`：仅当 V3 为 `ACTUAL_OFFHOST + RECOVERY_READY`，外层传输/加密、内层恢复、实际安装且观察到的调度、有效 dry-run 保留、identity/policy/assurance/trust 全匹配且未过期时为 true。`SYNTHETIC_ISOLATED`永远为 false。

Dashboard只读取固定名`recovery-readiness.json`，并要求回执根解析为真实目录、root-owned、与Web reader同组且精确`2750`；marker必须是同一根内root-owned单硬链接普通文件并为`0400`或`0440`，回执必须是同一根内root-owned、reader组、单硬链接普通文件并精确`0640`。读取前后路径、device/inode、size、mtime、ctime、owner、mode或link count任一变化都失败关闭；符号链接、硬链接替换、group/world writable根和非法当前时间均为`INVALID`。

浏览器/API只得到`backup_id`、结果枚举、验证时间、恢复点和过期时间的最小`latest_verification`投影，以及上列治理状态；不得返回数据库名、system identifier、OID、机器/集群/位置、文件路径、transfer ID、key fingerprint、原始摘要或完整回执。缺少、损坏、过期、替换、伪造或配置不完整均失败关闭。即便 `recovery_ready=true`，也只证明指定真实回执链与当前运行身份匹配，不能替代真实迁移核对、业务 UAT、监控、员工试用或正式切换授权。

## 9. 已验证与仍未完成

`SELFHOST-OPS-BACKUP-RECOVERY-V2-41`已在断网临时环境完成 41 项合同测试和双独立 PostgreSQL 集群恢复测试，覆盖守卫进程中断恢复、重复执行、过期/漂移/链接/路径攻击、各阶段故障、建库响应歧义、完整 schema/extension/publication/large object/sequence/时区与 interval、四文件域和补发回执。所有任务容器、测试库和临时目录已清理。

`SELFHOST-OPS-BACKUP-OFFHOST-PROVENANCE-54`又完成offhost/readiness 8/8、备份/Dashboard 58/58、监控/release 41/41及单容器双PostgreSQL cluster密文恢复，覆盖签名/tag/AAD/key/recipient/截断/重放/混代、partial inbox、模糊中断、同payload幂等、冲突payload、临时明文清理、调度漏跑/时钟异常和保留保护。源码`fd0a9cff`与manifest-only`315b1f3d`形成47文件bundle；所有临时容器、数据库、网络和Volume已清理。

以下仍是投产阻断：

- 尚无项目负责人指定并授权的真实异机目标、密钥托管/轮换、WORM、timer、真实保留删除和告警责任人；仓库加密/调度/保留合同不等于实际部署；
- 尚未对当前四个持久卷生成或外传真实快照，也未从真实异机副本恢复；
- 尚未核对真实记录数、重复、孤儿、库存、关键金额和文件摘要，也未测得真实 RTO；
- 尚无cluster roles、role membership、database/schema/table/sequence ACL、default privileges与tablespace的独立备份恢复方案；
- 不可捕获的恢复进程/宿主硬故障可能留下带任务 marker 的隔离 TEST 目标，需要人工按精确身份处置；工具不会猜测删除；
- 发布身份三阶段锁、完整release manifest、Migration allowlist与强制release suite已由TASK42/TASK53在仓库/隔离环境实现；尚无installed supervisor、正式PASS、部署后回执或runtime identity v3实况。

因此当前结论仍为 `PRODUCTION NO-GO`。
