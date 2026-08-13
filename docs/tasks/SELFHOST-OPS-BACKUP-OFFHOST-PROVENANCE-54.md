# SELFHOST-OPS-BACKUP-OFFHOST-PROVENANCE-54 异机备份加密与来源证明闭环

> 状态：`DOING / REPOSITORY AND SYNTHETIC-ISOLATED ONLY / ACTUAL OFFHOST BLOCKED / NO DATA ACTION / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@61b752e2ad05e2b2a273a01ffba6a87cc77e6a4c` / tree `800bd1f3caa0c43695008c044e507ac17c582884`
> 责任：Codex 主智能体为唯一写者、测试调度者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人继续保留真实密钥、异机目标、数据读取/外传/恢复、host 安装、删除、UAT/生产和切换的专项授权权力

## 1. 目标

关闭 TASK41 后仍开放的异机传输真实性、机密性、重试、调度和保留证据缺口，同时保留已经验证的四域 V2 一致性捕获与隔离恢复核心：

1. 已通过 `LOCAL_VERIFIED` 的 PostgreSQL、uploads、attachments、backup-status 四域只能经版本化密文封包离开源端；明文人工复制不能再代表当前策略下的可恢复异机链。
2. 接收端先验证批准源的密码学签名、密文完整性、接收密钥和防重放边界，再在私有 staging 中解密、复验内层 V2 并原子发布不可覆盖的接收证据。
3. 恢复入口必须同时绑定外层传输来源证明和内层 V2/恢复证明；旧 V2 人工复制回执只作历史证据，不能产生新的 `recovery_ready=true`。
4. 仓库提供确定性的调度到期/漏跑/单飞合同和只读保留计划；本任务不安装 timer、不连接真实目标、不执行删除，也不声称 WORM 或真实 RPO/RTO 已验证。

## 2. 起点事实

- TASK41 已证明四域一致性捕获、数据库 fence、root-only libpq 边界、严格 manifest、不可变本机/异机/恢复回执、不同机器/集群和双集群隔离恢复；内层 V2 是本任务必须复用而非重写的稳定恢复核心。
- 当前测试中的“异机传输”实际为 `cp -a`；`verify-backup-selfhost.sh`只验证已经位于接收根的明文目录，`transfer_id`由调用者提供，不能证明发送来源、传输完成边界、客户端加密或接收 ACK。
- 现有 `LOCAL_VERIFIED`/`OFFHOST_VERIFIED` JSON 没有发送端或接收端签名。攻击者若能同时替换制品、manifest 和回执，可制造内部一致但来源不可信的副本。
- 当前没有统一的 backup/export/import/restore 非重叠合同，没有自动调度、漏跑状态、保留 hold/minimum generations/受保护恢复代或删除计划；`expires_at`只表达 RPO 新鲜度，不是保留期限。
- Dashboard 与监控仍可能把旧 V2 人工复制链解释为恢复就绪，也无法区分传输未完成、加密来源无效、漏调度和保留不安全。
- 现行 UAT 仍为 alpha.42/0040，四服务 running、restart 0、OOM false；PostgreSQL/Web healthy，Worker/Caddy health none。本任务不改变该运行面。

## 3. 允许范围

- 三条智能体线只读审计现有数据/恢复、应用/测试、运维/安全合同，主智能体复核并保持唯一写者；
- 在仓库内实现版本化外层传输 envelope、发送端 Ed25519 来源签名、X25519 密钥协商/HKDF-SHA256、AES-256-GCM 密文和接收端独立签名回执；只使用 Node.js 标准密码学原语，不引入外部密钥服务或网络 provider；
- 私钥只从合成 root-only 专用文件读取，验证 owner、mode、单硬链接、非 symlink 和安全祖先；私钥、口令和令牌不得进入 argv、环境、stdout/stderr、回执或 Git；
- 以私有 staging、fsync、no-clobber 原子晋升、不可变 per-attempt 状态和冲突检测实现中断恢复；相同 ID/相同 payload 可幂等续跑，相同 ID/不同 payload 必须失败关闭；
- 保持内层 V2 布局与 manifest 兼容，新增当前策略所需的外层 provenance/verification 证据；恢复、Dashboard 和监控必须失败关闭地消费该证据；
- 在仓库内实现 UTC 调度评估、统一重任务锁合同和确定性 dry-run retention planner；只输出计划和安全摘要，不安装调度器、不删除对象；
- 使用合成 fixture、临时目录及最多一个临时容器完成定向 Node/POSIX、Dashboard/监控、release inventory 和单容器双 PostgreSQL cluster 回归；所有重任务串行；
- 源码提交后按既有“源码提交 + 只更新 canonical bundle manifest 的直接子提交”重建 content-addressed supervisor bundle，并同步治理文档。

## 4. 禁止范围

- 不读取`docs/ERP_CURRENT_STATUS_REPORT.md`、`.env`、真实凭据、容器环境、日志、业务数据库行、备份正文或受保护 Volume 正文；
- 不创建、读取或轮换真实密钥，不连接/创建真实异机、对象存储、NAS、SFTP 或 WORM 目标，不上传或复制真实数据；
- 不运行当前/UAT/生产备份、恢复、Migration、部署、重启、登录、业务 API、试迁移或员工试用；
- 不写入`/usr/local`、`/var/lib/chenyida-erp`、`/etc`或正式证据根，不安装 cron/systemd timer、supervisor、monitor 或 notifier；
- 不修改账号、权限、网络、防火墙、Swap、内核或 Docker daemon，不外部 push；
- 不执行 retention 删除，不删除镜像、cache、备份、持久数据或四个受保护 Volume，不执行 prune；
- 不把合成接收机描述为真实异机，不把逻辑 no-clobber 描述为存储 WORM，不把仓库策略描述为已实现真实 RPO/RTO、值班或告警投递；
- PostgreSQL cluster roles、ACL、default privileges 和 tablespace 恢复不在本任务内，必须保留为独立投产缺口。

## 5. 拟实现合同

### 5.1 密文封包与发送来源

- 发送端只接受未过期且完整复验的 V2 `LOCAL_VERIFIED`代次，并建立不可覆盖的 `PREPARED → SEALED` attempt。
- envelope 严格绑定 backup/transfer/attempt、inner manifest 与 local receipt SHA、源/目标 location、policy/RPO、ciphertext SHA/bytes、算法版本、时间和公开 key fingerprint；未知/重复字段、非规范 JSON 或摘要漂移拒绝。
- 四域明文流以随机 content key 做 AES-256-GCM；content key 使用临时 X25519 + HKDF-SHA256 为批准接收方封装；Ed25519 源签名覆盖规范 envelope 和密文身份。
- 部分密文、截断、tag/AAD/signature/key/recipient 篡改、跨代混合、重放、过期/撤销 key 或同一 ID 不同 payload 全部失败关闭。

### 5.2 接收、回执与恢复绑定

- 接收端只在私有 no-follow staging 内处理输入；先验证源签名、allowlist、密文摘要/长度与重放边界，再解密到临时明文，只有 GCM 和内层 V2 全部通过后才允许原子晋升证据。
- 长期权威异机对象是密文 envelope；临时明文不得被描述为静态加密存储，失败/成功后的精确清理或隔离状态必须可验证。
- 接收端用独立 Ed25519 key 发布不可变 receipt，绑定源 envelope、密文、inner manifest/local receipt、receiver identity/location、接收时间和验证结果；源端只在验证批准接收方签名后接受异机成功。
- 恢复前置必须验证完整外层 provenance，再在受控私有 staging 物化精确内层 V2 给既有恢复核心；旧 V2 offhost receipt 在新策略下只能显示 legacy/not-ready。
- 每个故障点均有 durable intent；密文完成、接收完成、解密完成、内层复验、原子晋升和 receipt 发布之间的中断能够幂等续跑或明确隔离，不能覆写受信证据。

### 5.3 调度、保留、Dashboard 与监控

- 版本化 UTC 策略必须显式给出 cadence/RPO、grace、最少成功代次、受保护恢复代、hold 和 key allowlist；不得使用可投产的隐式默认值。
- 单飞 evaluator 以固定锁和 durable state 判断 due/missed/deferred/failed/succeeded；锁忙不是成功，只有完整的签名异机链才推进 last success，时钟回退/未来时间失败关闭。
- retention planner 只生成规范化 dry-run 计划；latest、inflight、hold、RPO 内、最低代数和最后/最低恢复验证代均不可删除。缺证据或容量压力只能告警，不能自动放宽或执行删除。
- Dashboard/backup-status 保留旧 V2 历史解析，但当前策略只有完整签名/加密/调度/保留/恢复链才可 `recovery_ready=true`；不向浏览器暴露密钥、内部路径或敏感 attempt 正文。
- 监控输出去敏的 transfer/encryption/schedule/retention 状态并分别告警；未安装真实 notifier 时仍为 `NOT_CONFIGURED/PENDING`，不得冒充 delivered。

## 6. 验收标准

- [x] 三条智能体线完成只读审计，主智能体复核 TASK41、恢复入口、Dashboard、监控和 release inventory 实现边界。
- [ ] 记录单一架构决策：内层 V2 保持稳定，外层 transfer/provenance 与当前恢复就绪证据版本化升级；旧人工复制链明确降级为 legacy/not-ready。
- [ ] 合成密文发送/接收完整链通过；源/接收签名、X25519/HKDF/AES-GCM、严格 schema、key 文件安全和所有篡改/重放/混代/错误 key 负向测试通过。
- [ ] 所有关键中断点、同 payload 幂等重试、冲突 payload、partial inbox、晋升/receipt 模糊失败和临时明文清理/隔离通过自动测试。
- [ ] 恢复只能消费已验证外层 provenance；单容器双 PostgreSQL cluster 以合成密文链恢复成功，wrong key/tamper/接收崩溃不改变目标。
- [ ] UTC 调度/单飞/漏跑/时钟异常与 dry-run retention planner 的 hold/min generations/recovery generation/inflight 保护通过正负测试；没有安装 timer 或执行删除。
- [ ] Dashboard 对 legacy V2 失败关闭，只有完整新链才 ready；监控能区分并恢复 schedule/transfer/encryption/retention 告警。
- [ ] 既有备份恢复、Dashboard、监控、release inventory/contract 和适用 typecheck/lint 不降级；新增测试进入正式 inventory，所有重型验证串行且最多一个临时容器。
- [ ] TASK54 源码提交后重建 canonical manifest-only 直接子提交；TASK53 bundle 和全部旧候选明确标记`STALE / NOT AUTHORIZABLE`。
- [ ] 不产生真实密钥、真实异机回执、真实 RPO/RTO、WORM、host 调度、数据删除、正式授权/PASS、外部 push、UAT/生产/真实数据动作。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，通过凭据/JSON/Shell/Markdown/差异检查并创建独立 Git 提交。

## 7. 当前判定

`DOING / PRODUCTION NO-GO`。本任务完成最多证明仓库与合成隔离机制具备密码学来源、机密性和可恢复状态机；真实故障域、密钥托管/轮换、实际传输、WORM、timer 安装、真实删除、当前数据恢复及 RPO/RTO 仍需外部资源与专项明确授权。
