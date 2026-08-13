# SELFHOST-OPS-BACKUP-RECOVERY-V2-41 备份恢复契约 V2 与隔离故障测试

> 状态：`DONE / SYNTHETIC-ISOLATED COMPLETE / ACTUAL OFFHOST BLOCKED / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@9156c9e5dea93bc1666b8c75d087a3950a3422e1`；任务启动治理提交 `338a3d46dac97805a14e08dd451ff2dd032b01b7`
> 责任：Codex 主智能体为唯一写者、测试执行者和提交者；数据迁移、应用测试、运维安全子智能体先行只读审计/独立实现建议；项目负责人负责未来异机目标、真实快照、真实恢复和生产动作专项授权

## 1. 目标与结论

本任务在不读取当前 PostgreSQL 或四个受保护卷、不连接外部目标的前提下，把备份、校验、恢复和 Dashboard 状态升级为版本化 V2 契约，并用合成文件、故障注入和两个独立隔离 PostgreSQL 集群验证失败关闭、完整性和清理边界。

结论为：G1 仓库工具与隔离验证完成；PR-002 中旧工具的四域遗漏、URL argv、调用者自报静止、部分恢复和单级回执问题已在 V2 路径解决。PR-001 真实异故障域数据锚点仍不存在，真实数据、外传、恢复、部署和切换均未授权；系统继续 `PRODUCTION NO-GO`。

## 2. 实施结果

### 四域备份与一致性

- 新增严格 `chenyida-erp-backup-manifest/v2`、`chenyida-erp-backup-verification/v2`、内容 reconciliation 和共享合同 helper。
- manifest 绑定 deployment class/id、数据库 name/system identifier/OID/comment/profile/估算 bytes、应用版本、完整 Git SHA、实际 Web/Worker 容器 ID 与镜像 digest、完整 Migration manifest/head，以及 PostgreSQL、uploads、attachments、backup-status 四类制品。
- PostgreSQL 使用 custom logical dump、`--no-owner --no-acl`；明确不包含集群角色/ACL。日期、时区、interval、bytea 和浮点输出固定为可复现设置。
- 备份脚本不再接受数据库 URL；只接受 root-only、固定根内的 libpq service 文件，并验证 owner/mode/hardlink/ancestor、加共享锁和内容摘要防替换。秘密不进入 argv、stdout、manifest 或回执。
- 精确 Compose Web/Worker 必须已停止，实际容器 ID/镜像/版本/revision 必须匹配；数据库另以持久 intent、connection limit、默认只读、连接清退和前后全关系内容摘要建立一致性边界。

### 中断、异机与不可变证据

- `.backup-fence-v2.json`在数据库变更前持久化；正常结束精确恢复原状态。`recover-backup-guard.sh`只在 deployment、system ID、OID、comment、原 connection limit、根 device/inode、零并发连接和 credential/intent 全部匹配时解除中断守卫。
- 本机回执绑定 source machine identity 与 source root device/inode；异机回执要求接收机 machine identity 不同，并绑定 receiver root。测试 override 仅在 `NODE_ENV=test`、root-owned `0400/0600`文件下可用。
- 每一代使用不可变 `<backup-id>.local.json`、`<backup-id>.offhost.json`、`<backup-id>.<restore-run-id>.restore.json`；别名和 `latest.json`只允许单调前进。同一语义重复验证复用原不可变证据，不覆盖历史。

### 隔离恢复与回执发布

- 恢复只允许带 marker 的独立 TEST 集群、与源不同 system identifier、独占 superuser 管理边界、全新 `_restore_test`数据库和不存在的文件目标。
- 异机源先复制为 private durable pinned bytes 并再验证；文件全在 staging 解包，数据库用单事务 `pg_restore`，随后核对 Migration、原子晋升文件并执行数据库/文件 reconciliation。
- 故障点覆盖建库响应不确定、建库后、数据库恢复中/后、文件晋升后、最终核验和回执发布。普通失败只删除本任务精确创建且身份闭合的 TEST 数据库/文件；任何歧义隔离保留，不猜测删除。
- active inspection 成功后先持久化 root-only prepared receipt。回执发布失败进入保全边界；新增 `publish-restore-receipt-selfhost.sh`只消费 prepared evidence 补发，不连接数据库或读取可变文件。

### Dashboard 与运行身份

- Dashboard 严格区分 `LOCAL_VERIFIED`、`OFFHOST_VERIFIED`、`RESTORE_VERIFIED`、`STALE`、`INVALID`和旧 V1 `LEGACY_LOCAL_ONLY`，分离 identity/policy/assurance 状态。
- 只有最新恢复回执、实际 runtime/database/Migration、策略/RPO、异机接收方和不同集群恢复目标全部匹配且未过期，`recovery_ready=true`；缺失、替换、伪造或配置不完整均失败关闭。
- 新增 root 发布的 runtime release identity：绑定实际运行 Web/Worker 容器 ID、镜像 digest、Compose 身份、OCI version/revision和 baked runtime version/Git；Web 只读挂载。Dockerfile 从已验证 source `package.json`生成最小 runtime metadata，并把同一 build args 写入两个最终镜像的 OCI label 与 baked env。

## 3. 验收结果

- [x] V2 manifest 绑定 deployment identity、应用版本、Git SHA、实际镜像 digest、精确 Migration 和四类 artifact。
- [x] 数据库认证只通过权限受限的 libpq service 文件；秘密不进入 argv、stdout、manifest 或 receipt，未知/宽松权限失败关闭。
- [x] 备份工具核验 writer 实际停止，并以持久数据库 guard 和前后内容 reconciliation 提供纵深一致性。
- [x] verifier 拒绝缺失/额外 artifact、摘要/大小漂移、过期、路径穿越、链接/特殊文件、Migration/revision/digest 不匹配和不完整传输。
- [x] receipt 分离本机、异机和恢复证据；Dashboard 对 V2/RPO/运行身份失败关闭，旧 V1 不冒充生产可恢复。
- [x] restore 仅接受明确 TEST、新空数据库/文件目标和不同集群；全部 artifact 先 staging，所有正常故障注入均回到空态，回执发布歧义则安全保全已验证目标。
- [x] 覆盖重复执行、晋升/最终核验失败、凭据泄漏、危险路径、建库响应歧义、补发回执和精确清理；未读取当前卷。
- [x] 串行完成合同、脚本故障、双集群 PostgreSQL、Dashboard typecheck、lint、Python适用基线、Compose config、链接、敏感信息和 `git diff --check`。
- [x] 记录前后资源、OOM/restart 和临时资源清理。
- [x] 同步项目治理文档并创建独立 Git 提交。

## 4. 测试证据

| 验证 | 结果 |
| --- | --- |
| `npm run test:backup-recovery`（断网、源码只读、1 CPU、768 MiB 临时 Node 容器） | `41/41 PASS` |
| `scripts/run-backup-recovery-postgres-test.sh`（一个 768 MiB 临时 PostgreSQL 容器内两个独立集群） | `PASS`；Dashboard PostgreSQL `2/2 PASS` |
| `npm run typecheck:dashboard` | `PASS` |
| `npm run lint` | `0 error / 11 existing unrelated warnings` |
| shell `sh -n`、Dockerfile/release identity/UI 合同 | `PASS` |
| Compose 配置展开 | `PASS`；只使用占位必填值，不读取或输出凭据 |
| Python `server.py --self-test` | `SELF_TEST_OK` |
| Python `go_live_check.py --no-backup` | `GO_LIVE_CHECK_OK`；只检查本地开发面 |
| Python `.venv/bin/python smoke_test.py` | `SMOKE_TEST_OK`；首次误用系统 Python 因缺少 `openpyxl`在启动前失败，改用项目既有虚拟环境后通过，未安装依赖或降低断言 |
| 完整项目 typecheck | 既有一次在 512 MiB 自限 heap 下 exit 139；无宿主/UAT OOM。定向 Dashboard typecheck 通过，完整 release suite 留待 G3 |

一次误用不带 `--no-backup`的本地 `go_live_check.py`生成了唯一开发 SQLite 备份 `erp-backup-20260812-043649.sqlite3`；发现后只删除该任务精确创建文件并以 `--no-backup`重跑通过，原本地开发数据库保持。该事件不涉及 UAT/生产或受保护卷。

## 5. 资源、安全与清理

- 重任务前 available memory 约 `2.2 GiB`、Swap `391 MiB / 1.0 GiB`、根盘 `31 GiB`、Load1 约 `0.15`；未触发停止线。
- 任务测试全部串行，一次最多一个临时容器，Node heap `384/512 MiB`；没有 Docker build、Migration、Compose 变更或服务重启。
- 收口为 available memory `2.2 GiB`、Swap `391 MiB / 1.0 GiB`、根盘 `31 GiB`、Load `0.35/0.28/0.32`；内核任务窗口 OOM匹配0，四个 UAT 服务持续 running/healthy、restart 0、OOM false。
- 所有 `cyd-backup-v2-*`临时容器、两个测试集群、测试数据库和 `/tmp/cyd-backup-v2-runtime.*`目录均清理；未创建或删除 Volume/镜像，未 prune。
- 未读取业务行、当前 uploads/attachments/backup-status 正文、真实备份正文、凭据或用户未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md`；未访问外部目标或公开 UAT。

## 6. 后续阻断

G2 需要项目负责人提供异机目标、RPO/RTO、加密与密钥边界、保留/删除策略、调度/告警责任人，并专项授权当前四域真实快照、传输和隔离恢复。在此之前 PR-001、异机备份和隔离恢复门禁保持 `FAIL/BLOCKED`。

不依赖这些外部资源的下一安全任务转入 G3：建立并发安全的 release identity/不可变 release manifest、Migration allowlist 和低资源串行强制 `test:release`。本任务不授权 build、UAT Migration/deploy、真实数据、员工试用或正式切换。

## 7. TASK56 后续替代说明（2026-08-13）

本页保留 TASK41 当时的合成验证事实，不回写历史结论。后续 [TASK56](SELFHOST-OPS-POSTGRES-RUNTIME-PRIVILEGE-56.md) 已替代其中“单一superuser同时负责数据库guard和logical capture”及“以connection limit构成fence”的运行合同：未来候选使用物理与逻辑身份均分离的root-only control/capture service文件，control只持有一次性高权限控制面，固定非superuser `chenyida_erp_backup`只执行已批准读取、reconciliation、Migration只读核对和`pg_dump`。

TASK56的fence改为数据库默认只读加精确`CONNECT`撤销/恢复，不再改写原`datconnlimit`；持久intent升级为`chenyida-erp-backup-fence/v3`，但为中断发现兼容继续使用`.backup-fence-v2.json`文件名。当前应用合同声明零PostgreSQL large object，备份在生成WORK或发布artifact前强制核对metadata计数为零，并用`--no-large-objects`执行dump；非零即失败关闭并恢复本次fence，capture身份不会获授读取原始`pg_largeobject`内容的能力。TASK41旧脚本、旧intent语义和旧测试证据不得作为TASK56之后候选的授权依据。
