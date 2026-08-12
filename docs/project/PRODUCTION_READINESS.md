# 晨亿达 ERP 投产准入基线

> 基线任务：`SELFHOST-PRODUCTION-READINESS-40`
> 核验时间：2026-08-13（Asia/Shanghai）
> 当前判定：`PRODUCTION NO-GO / NOT READY FOR REAL EMPLOYEES`
> 唯一未来生产权威：自托管 Node.js、PostgreSQL、本地持久化文件与独立 Worker

## 1. 判定

当前系统不能投入真实员工使用。公开非生产 UAT 在空闲状态健康，已有较完整的服务端权限、CSRF、幂等、审计和业务状态机基础，但尚未形成可恢复的数据锚点、同一候选版本身份、可信发布测试门、真实数据迁移演练、完整跨岗位验收或正式切换回滚证据。

本文件是失败关闭的准入基线，不是上线批准。只有对应证据实际完成后，单项状态才能从`FAIL`或`PARTIAL`更新；文档完成、页面可访问或历史测试通过不会自动解除任何门禁。

2026-08-12 增量：`SELFHOST-OPS-BACKUP-RECOVERY-V2-41`已完成 G1 合成/隔离实现与验证。四域 V2 工具、分层不可变回执、数据库守卫/恢复、不同机器/集群证明、prepared receipt 补发和 runtime release identity 原语已通过 41/41 合同测试及双集群 PostgreSQL 恢复测试。没有读取当前卷、创建真实备份或连接异机目标，因此整体判定仍为 `PRODUCTION NO-GO`。

2026-08-12 第二次增量：`SELFHOST-OPS-RELEASE-GATE-42`已完成 G3 仓库工具和隔离验证。不可变release manifest/镜像安全证据合同、精确Migration allowlist、18步低资源串行门、content-addressed root supervisor及并发安全runtime identity已落地；最终提交快照通过Node、PostgreSQL、POSIX、Migration、恢复、Python、Compose、lint和凭证门。没有固定Browser运行时、通过完整typecheck的候选、获准Web/Worker镜像、镜像SBOM或新鲜漏洞PASS，故没有运行真实候选门或生成`ELIGIBLE`manifest，整体判定仍为`PRODUCTION NO-GO`。

2026-08-12 第三次增量：`SELFHOST-MATERIAL-IMPORT-SAFETY-43`已完成仓库实现与隔离验证。D-117要求的建批/上传持久幂等、批次owner/状态/CAS、私有staging、服务端实际文件检查、同根无覆盖原子提升、跨数据库/文件系统故障协调、job所有权和worker终态事务已在源码`5767c92…`与manifest-only直接子提交`dad7468`落地；0042发布后保持不可变，0043以append-only方式修正终态约束。运行UAT未部署该实现，因此PR-004只在仓库层关闭，整体判定仍为`PRODUCTION NO-GO`。

2026-08-12 第四次增量：`SELFHOST-IDENTITY-SESSION-SAFETY-44`已完成仓库实现与隔离验证。D-118要求的8小时idle、创建时不可延长的24小时absolute、PostgreSQL时钟和用户→会话锁序、首次超时单次终态/去敏审计以及失效Cookie对称清理已在源码`e7b0298…`与manifest-only直接子提交`c730fef`落地；append-only 0044及官方Migration harness通过。运行UAT仍是旧会话实现，因此只关闭仓库风险，整体判定继续`PRODUCTION NO-GO`。

2026-08-12 第五次增量：`SELFHOST-RUNTIME-HEALTH-TRUTH-45`已完成仓库实现与隔离验证。D-119要求的完整Migration manifest、数据库时钟Worker排他租约/CAS、Web/Worker双侧uploads/attachments写入+fsync+清理、live/readiness分离和Worker Docker healthcheck已在源码`7494086…`与manifest-only直接子提交`dcef6f6`落地；append-only 0045、官方Migration harness及发布合同通过。运行UAT仍是旧health实现，因此只关闭仓库风险，整体判定继续`PRODUCTION NO-GO`。

2026-08-12 第六次增量：`SELFHOST-RELEASE-TYPECHECK-CLOSURE-46`已完成仓库实现与重复验证。D-120固定Node 22/ES2022、精确38配置集合/摘要核验和`--incremental false`只读执行；源码`f3bac028…`与manifest-only直接子提交`3d1243e…`的两个干净快照均38/38通过。该证据只关闭完整typecheck子门，不包含Browser、候选build、SBOM、漏洞扫描、UAT部署或真实数据；整体判定继续`PRODUCTION NO-GO`。

2026-08-12 第七次增量：`SELFHOST-RELEASE-BROWSER-HARNESS-47`启动为唯一`DOING`。只读审计确认发布清单的6个REQUIRED Browser文件存在且没有skip，但原动作因缺少固定Chromium/Playwright运行时而失败关闭；任务范围固定为干净提交快照、固定Browser/Node/PostgreSQL运行时和隔离合成数据库。

2026-08-13 第八次增量：`SELFHOST-RELEASE-BROWSER-HARNESS-47`已完成。D-121固定的Playwright 1.51.1/Chromium 134内容寻址运行时、历史Migration模板、断网只读单容器执行器及真实`browser-e2e`动作落地；源码`9a18a0f…`与manifest-only直接子提交`614ef7ac…`形成39文件bundle，干净快照6文件/11项全部PASS，typecheck38/38及适用合同通过。该证据只关闭Browser仓库子门；没有候选Web/Worker镜像、镜像级SBOM/新鲜漏洞PASS或完整18步同候选报告，运行UAT仍为alpha.42/0040，整体判定继续`PRODUCTION NO-GO`。

2026-08-13 第九次增量：`SELFHOST-RELEASE-CANDIDATE-EVIDENCE-48`已按D-122启动为唯一`DOING`。范围是精确已提交源码的本地Web/Worker候选build、临时loopback registry digest、固定Trivy与新鲜漏洞数据库、镜像级SBOM/零漏洞证据及不旁路supervisor的18步门尝试；不外部push、不安装host supervisor、不修改UAT/生产或读取当前四卷/真实数据。任务启动不改变整体`PRODUCTION NO-GO`。

## 2. 证据范围与未执行事项

- 主智能体核验 Git、源码、Migration、Docker/Compose、systemd、health、运行镜像、UAT 数据库 Migration 元数据、备份目录元数据和服务器资源。
- 数据迁移、应用测试、运维安全三个子智能体分别完成只读审计；主智能体复核关键代码路径并归并结论。
- UAT 数据库只在`transaction read only`中读取`schema_migrations`和 public 表数量；没有读取业务行或执行写入。
- 没有读取凭据、备份正文、受保护卷业务正文或用户未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`。
- TASK47只生成隔离测试用standalone build；没有候选Web/Worker镜像build/push、真实Migration、备份、恢复、上传、部署、服务重启、账号权限变化、真实员工登录或业务POST。

## 3. 当前身份与运行事实

| 证据项 | 当前事实 | 判定 |
| --- | --- | --- |
| 根仓库 | TASK47源码`9a18a0f307348c974a6f341565e7d16d76df184c`/tree`8c182d38f1acbcebe10d46e3a09f73c9ec612f22`与manifest-only直接子提交`614ef7ac2aea5ec23029c81b17b8c21adc0935dd`形成已复核39文件bundle链，SHA-256为`e54019df…a7192`；未fetch/push | 本地可追踪；当前完整历史的异机锚点待更新 |
| 私有源码锚点 | 本机最后已知跟踪引用为`recovery-private/main@1dcbf8d`；本任务未fetch、调用远端API或push，因此未声称其为远端实时状态，也未用本地提交差值冒充异机证明 | `FAIL`，当前完整历史未证明异机存在 |
| 源码 | `0.1.0-alpha.46`，Migration 45/head `0045_runtime_worker_readiness.sql`；0045 SHA-256为`cc4685a0…80fc`，0001—0044未修改 | source-verified，不等于运行候选 |
| 源码 Schema | 45 个 SQL、journal 和 snapshot 顺序一致；`db/schema.ts`与 0045 snapshot 为 233 张 public 表且列集合一致 | 静态及隔离Migration一致性`PASS` |
| UAT Web | `0.1.0-alpha.42`，revision `569aa954…d33a24`，Image ID `sha256:e7761e2c…f94964` | 与源码不一致 |
| UAT PostgreSQL | 40/head `0040_warehouse_receipt_readiness.sql`，0040 checksum `b6781c94…a5a93`，227 张 public 表 | 与源码不一致 |
| 发布台账 | `RELEASES.md`尚未形成 alpha.46/0045 候选记录；没有`ELIGIBLE`manifest | `FAIL` |
| 运行健康 | Web/PostgreSQL healthy，Worker/Caddy running，restart 0、OOMKilled false；回环与公开 health仍来自alpha.42旧实现，Worker health为none | 仅证明当前空闲存活；TASK45源码真实性未部署 |
| Python 旧运行面 | `chenyida-erp.service` enabled/active、restart 0，当前监听`127.0.0.1:18889` | 开发/迁移来源；正式切换前须明确处置 |
| 数据卷 | PostgreSQL、uploads、attachments、backup-status 四卷存在 | 单机持久化，不是灾备 |
| 本机备份 | `/var/backups/chenyida-erp`存在 root-only 历史文件；与运行卷同在`/dev/vda1`，未发现自动 backup timer | `FAIL`，同一故障域 |
| 当前资源 | available memory约 2.0 GiB，Swap约 386 MiB/1.0 GiB，根分区可用约 31 GiB，Load约`0.15/0.20/0.15` | 未触发停止线；不代表容量验收 |

本地远端跟踪引用只证明最后一次本地已知状态；在没有受控 fetch/远端 API 核验时，不把它表述为远端实时状态。

## 4. 投产完成门禁

| 门禁 | 当前状态 | 解除证据 |
| --- | --- | --- |
| 自托管唯一权威 | `PARTIAL` | 生产运行只保留 Node/PostgreSQL 权威；Python/SQLite 有明确只读迁移、停用或隔离决定 |
| 源码/提交/镜像/Migration一致 | `FAIL` | 一个不可变候选 manifest 同时绑定 Git SHA、版本、镜像 digest、Migration manifest/head；UAT 实况完全匹配 |
| 异机备份 | `FAIL` | PostgreSQL及三个文件数据域加密传至异故障域，远端校验回执、保留策略、时效和责任人可核验 |
| 隔离恢复 | `PARTIAL / SYNTHETIC-ISOLATED PASS` | 从真实异机副本在新空隔离目标恢复四类数据，完成 Migration、数量、摘要、库存和关键金额核对并记录真实 RTO；现有合成双集群证据不替代真实数据 |
| 真实数据试迁移 | `FAIL` | 只读源快照、逐行结果、重复/孤儿/单位/文件处置、库存/金额核对和可重跑报告通过 |
| 核心服务端规则 | `PARTIAL` | 物料/BOM/采购/收货/IQC/库存/生产/销售/财务关键链及异常路径在同一候选通过自动与人工验收 |
| 权限/会话/安全/审计 | `PARTIAL / SOURCE SESSION AND RUNTIME HEALTH REMEDIATED` | 批准的岗位矩阵、职责分离、最小数据域、导入/会话/运行健康边界和审计安全测试在同候选及运行面通过；TASK43—TASK45源码完成不替代部署验收 |
| 强制发布测试门 | `PARTIAL / TYPECHECK AND BROWSER VERIFIED / IMAGE EVIDENCE OPEN` | 18步失败关闭suite及清单已实现；完整typecheck38/38与固定Browser 6文件/11项已在干净快照通过，候选镜像SBOM/新鲜漏洞PASS及同候选完整报告尚未通过 |
| 监控/容量/告警/手册 | `FAIL` | 指标、告警投递和值班升级演练；低资源负载/备份/恢复 soak；升级/回滚/故障手册通过演练 |
| 真实员工受控试用 | `FAIL` | 少量真实岗位用户按脚本完成跨岗正常/异常流程并签字，问题闭环后重验 |
| 正式切换与回滚授权 | `FAIL` | 明确窗口、冻结点、负责人、验证清单、回滚触发器与项目负责人专项授权 |
| 上线后观察 | `NOT_STARTED` | 健康、数据核对、告警、备份和恢复抽检在观察窗再次通过 |

## 5. P0 投产阻断

### PR-001 异故障域数据恢复能力不存在

- PostgreSQL、uploads、attachments、backup-status 及本机备份同处单机故障域；主机或磁盘损坏可能同时丢失运行数据与备份。
- 既有 private Git 与 GHCR 只保护源码和 alpha.42 Web 镜像，不保护业务数据。
- 当前没有 RPO、RTO、保留周期、异机目标、加密接收方或告警责任人。

解除条件：先完成不接触真实数据的备份/恢复契约 V2 与故障测试，再由项目负责人指定异机目标并专项授权真实快照、传输和隔离恢复。

### PR-002 V2 工具路径已完成，真实运用仍未授权

- `SELFHOST-OPS-BACKUP-RECOVERY-V2-41`已使数据库秘密退出 argv，改为严格 root-only libpq service 文件；四域 manifest 绑定实际 runtime/database/Migration 身份、RPO、完整制品和前后内容 reconciliation。
- 精确停止 writer、持久数据库 fence intent、SIGKILL 后精确恢复、不可变本机/异机/恢复回执、RPO 过期和不同 machine/cluster 证明均已实现并通过隔离测试。
- restore 使用 durable pinned source、全文件 staging、单事务数据库恢复、精确补偿、建库响应歧义处理和 prepared receipt 保全/补发；Dashboard 旧 V1 失败关闭，V2 只有全身份/策略/assurance 匹配才显示 ready。
- V2 仍不提供真实异机传输、客户端加密/密钥、保留删除、定时调度、告警、角色/ACL恢复或真实 RTO；不可捕获的恢复进程/宿主硬故障会隔离保留带 marker 的 TEST 目标，而不是猜测删除。

状态：`G1 RESOLVED IN SYNTHETIC/ISOLATED TOOLING`。只有完成 PR-001/G2 的真实异机副本与恢复、补齐集群级对象和运行策略后，才能把该工具链作为生产灾备证据。

### PR-003 运行候选身份不闭合

- TASK42已实现严格release manifest、content-addressed supervisor两提交链及精确Migration allowlist/目标数据库身份，仓库工具不再允许靠tag或目录排序冒充候选。
- 源码 alpha.46/0045、UAT alpha.42/0040和当前 GHCR alpha.42 锚点仍不是同一个已通过门禁的候选；没有获准alpha.46 Web/Worker镜像、镜像安全证据或`ELIGIBLE`manifest。
- 当前不能证明“拟投产代码＝已验收代码＝运行镜像＝数据库版本”。

解除条件：建立不可变 release manifest 与 migration allowlist；隔离 build/升级/回退通过后，经专项授权把 UAT 对齐到同一候选并重新验收。

### PR-004 物料导入 fallback 仓库缺口已修复，运行面尚未对齐

状态：`REPOSITORY REMEDIATED / ISOLATED VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`

- TASK43已实现建批/上传/取消/解析持久幂等，以及正文读取前owner、状态、CAS、权限、CSRF和幂等意图门禁。
- 文件使用私有staging、受限确定性路径、实际SHA/大小/签名/MIME/安全检查、`fsync`与同根无覆盖原子提升；失败由持久saga与reconciler处理，未知身份文件不猜测删除。
- job经outbox aggregate关联批次并复核owner/`material.import.read_any`；worker重新哈希并以单事务发布job和业务终态，过期lease不能提交。
- 0042与append-only 0043、Schema/snapshot/journal及隔离PostgreSQL升级/回滚/故障测试通过。源码/manifest提交链和证据摘要已固定。
- 当前非生产UAT仍为alpha.42/0040，未执行build、0040→0045 Migration、部署或端到端岗位验收，故运行面仍可能表现为旧缺口。

运行解除条件：在同一合格候选上通过完整release gate，取得专项授权后完成备份、0040→候选head升级、部署，以及上传/恢复/越权/并发/故障端到端验收；此前不得把PR-004写成运行环境已解决。

### PR-005 强制发布测试门工具已建立，但没有候选PASS

- 当前清单经TASK45扩展为235文件（211 REQUIRED、24有明确别名/历史N/A）、18步`test:release`、固定执行器、资源/timeout/无skip、机器报告及候选manifest绑定；其中Pure Node112、PostgreSQL83、Browser6、历史D1 22、PG alias2、release contract6、POSIX special4。
- TASK42最终源码快照曾通过Node 107文件/886、PostgreSQL 80文件/367等完整仓库门；TASK43—TASK45随后通过各自定向、隔离PostgreSQL、release contract及supervisor验证，但没有在当前源码提交上重跑完整112文件Node-source、83文件PostgreSQL或18步候选门。
- TASK46已按D-120修复真实类型债，固定精确38配置集合/摘要合同，并在源码与bundle两个连续干净快照38/38通过；该子门不再是仓库候选阻断。
- TASK47已按D-121固定Playwright 1.51.1/Chromium 134内容寻址运行时，并在源码`9a18a0f…`干净快照完成Browser 6文件/11项；该子门不再是仓库候选阻断。
- 仍没有候选Web/Worker镜像级SBOM和新鲜漏洞PASS，也没有在同一候选上完成18步全门。因此完整候选门按设计保持阻断，不能把typecheck或Browser子门通过解释为候选通过。

解除条件：在隔离候选镜像上生成镜像级SBOM/新鲜漏洞PASS并运行完整18步门；任何缺失、跳过或失败继续阻止候选晋升。

### PR-006 真实数据迁移与核对未闭环

- 通用 SQLite/D1 适配器仍仅接受合成标识；真实工具只允许本地 SQLite 只读快照且禁止目标物化/文件复制。
- 现有真实只读聚合 3,619 条中仅 49 条可规划、3,566 条 archive-only、4 条需业务审核；没有目标 ID、逐行物化或文件 checksum。
- 尚无旧 D1 真实 export 审计、真实规模迁移、重复/孤儿/单位/库存/关键金额核对和回滚演练。

解除条件：业务责任人先处置映射和 archive 边界；随后对批准快照完成幂等试迁移、逐行报告、完整核对及回滚演练。

### PR-007 真实员工与完整业务闭环没有证据

- 当前 UAT 只形成受控 PO/Line/Plan/queue `1/4/4/4`；最新收货验证仅预览并取消，收货、IQC、库存、AP、付款和生产下游仍为零。
- 没有真实岗位签字、跨角色交接、异常路径、值班或受控试运行记录。

解除条件：候选、迁移和恢复门禁先通过；再由指定真实员工按受控脚本完成核心流程，问题修复后重验并签字。

## 6. P1 高风险

- health仓库实现已由TASK45改为完整Migration、同候选Worker数据库租约和双文件卷真实探针，并把liveness/readiness分离；运行UAT仍为alpha.42旧实现，故运行风险保持`OPEN / REPOSITORY REMEDIATED`。备份过期继续由独立recovery governance阻止晋升而不混入公开readiness。
- 会话仓库实现已由TASK44补齐8小时idle、固定24小时absolute、数据库时钟原子认证与单次超时审计，并通过0044/并发/Migration隔离验证；运行UAT仍为alpha.42/0040旧实现，故运行风险保持`OPEN / REPOSITORY REMEDIATED`。
- 权限矩阵硬编码且多个业务角色可读取财务域；尚无岗位负责人批准的最小权限/职责分离矩阵。
- 容器基础镜像未全部锁定 digest；Compose 尚未全面使用`read_only`、`no-new-privileges`和`cap_drop`；没有当前候选 SBOM、漏洞扫描、签名验证证据。
- 公网入口仍为 nip.io 和非标准端口；没有公司域名、正式边缘策略、CSP、MFA或 break-glass 演练证据。
- 没有指标采集、外部告警、值班升级和告警演练；运维手册仍含旧版本/旧入口事实。
- 空闲资源稳定不等于真实负载稳定；没有低资源业务负载、备份、恢复、数据库增长和重启 soak。
- Active 物料属性修订、`MECH/OTHER`、正式替代料、单位换算和客户专用限制仍未形成完整生产验收。

## 7. 依赖路线与逐阶段验收

| 阶段 | 任务簇 | 前置依赖 | 完成证据 | 失败处理 |
| --- | --- | --- | --- | --- |
| G0 | 投产事实基线 | 无 | 本文件、三线审计、`PRODUCTION NO-GO` | 发现新事实即更新，不放宽门禁 |
| G1 | 备份/恢复契约 V2 | G0 | `DONE / SYNTHETIC-ISOLATED`：四域 manifest、凭据不进 argv、原子恢复、故障测试、分层回执 | 任一部分状态或泄漏立即拒绝 |
| G2 | 异机备份与隔离恢复 | G1、异机目标/RPO/RTO/专项授权 | 远端回执、从远端恢复、数量/摘要/库存/金额、RTO | 保留源和旧备份，不覆盖运行面 |
| G3 | 发布身份与强制测试门 | G0，可与 G1 串行推进 | release manifest、migration allowlist、`test:release`、SBOM/安全报告 | 候选不晋升，运行面不变 |
| G4 | 导入与会话/权限 P0 修复 | G3 测试门基础 | 隔离 PostgreSQL/文件故障测试、岗位矩阵、安全验收 | 回退候选，不触碰 UAT |
| G5 | 真实源只读分析与业务处置 | G2、数据读取授权、责任人 | 源快照、逐行分类、重复/孤儿/单位/文件/库存/金额报告 | 不物化目标，列明责任人 |
| G6 | 真实迁移与回滚演练 | G4、G5、隔离目标 | 幂等迁移、全量核对、重复执行、故障回滚、恢复快照 | 销毁任务临时目标，保留证据 |
| G7 | 同候选核心 E2E 与运维演练 | G2—G6、UAT部署授权 | 全岗位正常/异常链、告警、升级/回滚/故障手册演练 | 候选拒绝，问题回到安全任务 |
| G8 | 少量真实员工试运行 | G7、员工/账号/窗口授权 | 签字、问题清单、重验、备份再次验证 | 停止试用并按回滚手册恢复 |
| G9 | 正式切换 | G8、项目负责人专项授权 | 冻结、迁移、核对、健康、回滚窗口和责任人 | 达触发器即执行已验回滚 |
| G10 | 上线后观察 | G9 | 健康/数据/告警/备份/恢复抽检再次通过 | 降级或回滚并保全审计 |

除 G0 外，表中“完成证据”必须实际产生，不能由计划、代码存在或历史任务替代。Docker build、全量测试、Migration、备份和恢复始终串行。

## 8. 当前安全执行序列

1. `SELFHOST-OPS-BACKUP-RECOVERY-V2-41`已完成 G1 合成/隔离证据；真实 G2 被异机目标、RPO/RTO和专项授权阻塞。
2. G3仓库工具已由TASK42完成，完整typecheck和Browser分别由TASK46/TASK47关闭；候选Web/Worker镜像、镜像SBOM/新鲜漏洞PASS、完整18步同候选报告和UAT对齐仍保持失败关闭并需后续适用授权/资源。
3. G4的物料导入fallback仓库修复已由TASK43完成；运行面验证等待同候选与专项部署授权。
4. TASK44/TASK45已完成会话绝对时限和health/Worker/storage/Migration真实性仓库修复；运行面验证等待同候选完整gate及专项部署授权。
5. `SELFHOST-RELEASE-CANDIDATE-EVIDENCE-48`正建立隔离候选Web/Worker镜像、OCI/baked身份、镜像级SBOM/新鲜漏洞证据并在不旁路host supervisor的前提下尝试完整18步同候选门；岗位权限矩阵等待业务负责人确认，并继续更新/演练监控、升级、回滚和故障手册。

以上任务可在仓库和隔离环境安全推进；实际异机数据、UAT部署/Migration、真实数据和真实员工动作不因本序列自动获权。

## 9. 专项授权与外部资源矩阵

| 事项 | 需要项目负责人提供或确认 |
| --- | --- |
| 异机备份 | 目标位置、网络路径、RPO、RTO、保留期、不可变策略、加密接收方、责任人；root-only 凭据文件 |
| 当前数据恢复演练 | 允许读取当前 PostgreSQL 与四卷、生成快照、传输并在隔离目标恢复的精确范围和窗口 |
| 旧数据迁移 | 批准的 SQLite/D1/附件快照、截止时点、数据责任人、archive-only/映射/单位/库存/金额处置 |
| 候选部署 | 允许 build、应用 Migration、替换镜像、重启服务和登录式 UAT 的独立授权 |
| 身份与安全 | 岗位用户、最小权限、职责分离、财务可见域、会话绝对时限、MFA/VPN/公网策略 |
| 告警 | 外部接收渠道、值班人和升级路径；不得把 Token 粘贴到聊天，应写入 root-only 文件 |
| 真实试运行 | 用户名单、业务样本、窗口、验收人和允许的业务写范围 |
| 正式切换 | 停机/冻结窗口、迁移与回滚负责人、切换与回滚专项授权 |

## 10. 资源与清理基线

- 任务起点：available memory约 2.0 GiB，Swap约 386 MiB/1.0 GiB，根分区可用约 31 GiB，Load `0.12/0.17/0.13`。
- 三线审计后、串行验证收口：available memory约 2.0 GiB，Swap约 389 MiB/1.0 GiB，根分区可用约 31 GiB，Load`2.09/0.98/0.50`且未触发停止线；四服务 restart 0、OOMKilled false，内核未发现本任务窗口 OOM。
- 本任务没有创建临时容器、数据库、镜像、Volume或备份，没有需要清理的临时资源。

G1 增量验证使用一次一个受限临时容器：合同 41/41、双独立 PostgreSQL 集群恢复和 Dashboard PostgreSQL 2/2 通过，容器/测试库/临时目录清零；任务前后 available memory约 2.2 GiB、Swap约391 MiB、根盘31 GiB，四个 UAT 服务 restart 0/OOM false。没有 build、Migration、Compose 变更、UAT/生产写或持久卷操作。

TASK43增量验证同样串行且一次一个临时重任务：fallback unit/handler20/20、worker8/8、UI107/107、Migration4/4、parser/API client45/45、隔离PostgreSQL fallback17/17及真实XLSX worker1/1通过；release inventory为230/206/24。任务容器、测试库和临时目录清零；起点/收口available约2.2/2.0 GiB、Swap425/439 MiB、根盘31 GiB、Load1低于4，四服务restart0/OOM false。没有build、UAT/生产Migration、部署、当前卷读取或真实数据操作。

TASK44增量验证保持串行且一次一个临时重任务：定向/release合同55/55、隔离PostgreSQL会话/身份/升级21/21、官方release Migration harness、supervisor15/15和inventory232/208/24通过。任务容器、测试库和进程清零；起点/收口available约2.1/2.0 GiB、Swap439/442 MiB、根盘31 GiB、最终Load`0.21/0.21/0.33`，四服务restart0/OOM false、当日内核OOM 0。没有build、UAT/生产Migration、部署、当前卷读取或真实数据操作。

TASK45增量验证同样串行且一次一个临时重任务：runtime readiness定向42/42、隔离PostgreSQL5/5、官方release Migration harness、release44/44、supervisor15/15、TASK45/release-contract定向typecheck和inventory235/211/24通过；治理收口另通过1,564文件凭据扫描、109个本地Markdown链接与134项控制协议。任务容器、测试库和临时文件清零；验证期间available约1.9—2.0 GiB、Swap449→453 MiB、根盘约30 GiB、Load1低于1，四服务restart0/OOM false。没有build、UAT/生产Migration、部署、当前卷读取或真实数据操作。

TASK46增量验证保持串行且一次一个临时重任务：首次完整门如实失败后修复真实类型/执行器问题，源码`f3bac028`及bundle`3d1243e2`两个干净快照分别38/38；定向287/287、release合同45/45、supervisor15/15、inventory235/211/24、干净快照lint和1,566文件credentials通过。一次错误包含`.wrangler/work`的直接lint发生V8 heap OOM退出139，但宿主/容器OOM为0、Swap增长约27 MiB，正式快照重跑通过。起点/收口available约1.9/2.0 GiB、Swap453/484 MiB、根盘30/31 GiB、Load1低于4，四服务restart0/OOM false，任务容器/目录清零；没有build、UAT/生产Migration、部署、当前卷读取或真实数据操作。

TASK47增量验证保持串行且任何时刻最多一个临时容器：第十三次干净快照Browser运行6文件/11项全部PASS，release合同45、supervisor20、完整typecheck38/38、lint和inventory235/211/24通过。Browser前available2,424,572KiB、Swap76.32%、根盘27GiB；Browser后Swap短暂80.14%即按规则暂停，未修改Swap或服务，自然回落到阈值内后才继续；最终available2,481,228KiB、Swap73.47%、根盘27GiB、Load`0.98/1.91/1.62`，内核OOM0、四服务restart0/OOM false，任务容器/目录清零。没有候选镜像build/push、UAT/生产Migration、部署、当前卷读取或真实数据操作。
