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

2026-08-13 第十次增量：`SELFHOST-RELEASE-CANDIDATE-EVIDENCE-48`已完成授权内工作。D-123—D-125形成精确Git archive构建回执、manifest/config身份分离、固定Wolfi/Node最小非root运行层及严格Wolfi+Node SBOM覆盖合同；`8952a815`/tree`1ac73360`的Web/Worker候选manifest为`sha256:27868850…92288`/`sha256:e85ce236…ee77c`。固定Trivy与7.5小时内数据库在断网、无Docker socket扫描中覆盖Web25+63、Worker25+60包，全部severity为0且数据库树前后一致。host supervisor未安装，正式镜像证据与18步门均在任何制品变更前失败关闭；因此没有正式PASS、`ELIGIBLE`manifest或UAT部署，整体判定继续`PRODUCTION NO-GO`。

2026-08-13 第十一次增量：`SELFHOST-OPS-MONITORING-ALERTING-49`启动为唯一`DOING`。范围固定为仓库和隔离环境中的统一去敏运行快照、资源/服务/身份/Migration/备份恢复证据阈值、告警状态生命周期、CLI、测试和运行手册；三条智能体线只读审计，主智能体唯一写入。没有host安装、真实通知渠道/值班人、UAT/生产连接或真实数据授权，任务启动不改变整体`PRODUCTION NO-GO`。

2026-08-13 第十二次增量：`SELFHOST-OPS-MONITORING-ALERTING-49`已完成。D-126固定严格去敏observation、单一资源阈值权威、服务/应用/release/Migration/备份恢复证据新鲜度和告警生命周期；最终源码`7debd4d`/tree`315276e`与manifest-only子提交`56535a0`形成bundle SHA-256`76b919cd…6a95`。Node113/964、PostgreSQL83/396、typecheck38/38及适用发布门通过；只读宿主诊断对旧UAT身份和缺失证据如实CRITICAL。没有host安装、真实渠道/值班人或投递演练，因此只把监控门从`FAIL`更新为仓库层`PARTIAL`，整体判定继续`PRODUCTION NO-GO`。

2026-08-13 第十三次增量：`SELFHOST-OPS-CONTAINER-RUNTIME-HARDENING-50`启动为唯一`DOING`。起点实际Docker metadata显示现行UAT PostgreSQL/Web/Worker/Caddy均`ReadonlyRootfs=false`且无显式cap drop/security option；TASK48镜像又因TASK49 Dashboard源码变化不再代表当前HEAD。任务范围固定为仓库策略、Compose/Dockerfile及隔离运行验证，不修改UAT/生产、业务数据、账号、网络或受保护Volume；启动不改变整体`PRODUCTION NO-GO`。

2026-08-13 第十四次增量：`SELFHOST-OPS-CONTAINER-RUNTIME-HARDENING-50`已完成。D-127固定六服务完整集合、精确写路径和内核态最小权限复核；实现`375869f…`/tree`ac5a5bfa…`与manifest-only直接子提交`f119c8f…`形成44文件bundle，SHA-256为`ab6b708e…8cbe`。六服务均采用只读rootfs、drop all及禁止提权，PostgreSQL零cap，Caddy仅保留`NET_BIND_SERVICE`；Compose静态门和一次一个容器的隔离runtime均通过。现行UAT未部署该配置，当前HEAD也尚无重建镜像/正式19步报告，整体继续`PRODUCTION NO-GO`。

2026-08-13 第十五次增量：`SELFHOST-RELEASE-CANDIDATE-REFRESH-51`启动为唯一`DOING`。TASK48镜像仍在本机但绑定旧`8952a815`，TASK49/TASK50后的当前HEAD没有对应镜像/扫描证据。任务范围固定为clean Git snapshot的本机串行构建、loopback digest、当前runtime policy、固定Trivy零发现诊断及正式19步入口失败关闭复核；不安装host supervisor、不外部push、不修改UAT/生产、账号、网络或受保护Volume。启动不改变整体`PRODUCTION NO-GO`。

2026-08-13 第十六次增量：`SELFHOST-RELEASE-CANDIDATE-REFRESH-51`已完成。D-128修正Docker29 manifest/config探针，`12beccf0`与manifest-only直接子提交`8084d6c3`形成44文件bundle；当前Web/Worker候选manifest为`sha256:249d0ce4…5b7f`/`sha256:0e07fded…8370`，六服务runtime通过。固定Trivy与11.8小时内数据库覆盖Web25+63、Worker25+60包，全部severity0且数据库树前后一致。正式镜像证据及19步门因installed supervisor缺失在6个制品变化前失败关闭；没有正式PASS、`ELIGIBLE`manifest或UAT部署，整体继续`PRODUCTION NO-GO`。

2026-08-13 第十七次增量：`SELFHOST-EXTERNAL-AUTHORIZATION-READINESS-52`启动为唯一`DOING`。任务只读核验现有控制面，把host supervisor、正式门、外部锚点、异机备份恢复、监控投递、UAT晋升、数据/岗位/员工试运行和正式切换拆成`A1`—`A8`独立授权；不创建可消费授权、不安装host组件、不连接或修改UAT/生产/真实数据。启动不改变整体`PRODUCTION NO-GO`。

2026-08-13 第十八次增量：TASK52已完成。D-129和[投产专项授权执行包](../self-hosting/production-authorization-packet.md)固定A1—A8依赖、影响、停止、验收和回退，并把真实数据读取/外传/第三域恢复、host安装、UAT部署、岗位/员工写及切换分别授权。只读审计发现现行Worker health none会让正式gate在19步前自锁，且loopback完整镜像引用不能作异机恢复锚点；因此当前不请求A1/A2，先执行TASK53仓库生命周期修复。没有host、UAT、生产或真实数据动作，整体继续`PRODUCTION NO-GO`。

2026-08-13 第十九次增量：`SELFHOST-RELEASE-GATE-LIFECYCLE-53`已从`e9d27eebb21a9f52c941f389ef7800508c0402e5`启动为唯一`DOING`。范围固定为仓库和隔离测试中的部署前既有运行面不退化、隔离候选严格health及部署后当前运行面严格身份三阶段合同；模式/版本必须绑定authorization、报告、manifest eligibility和runtime identity，错配失败关闭。TASK51 bundle/候选只保留历史审计价值；不安装host组件、不修改UAT/生产或真实数据，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十次增量：TASK53已完成。D-130固定部署前既有运行面稳定、隔离候选严格和部署后当前运行面严格三阶段；plan/report/manifest v2、独立postdeploy receipt及runtime identity v3闭合，崩溃中断可在重新验证当前运行面后幂等续跑。源码`08608eb1`与manifest-only直接子提交`d246cbde`形成47文件bundle；release候选侧51/51、supervisor侧48/48、Python31/31、Node113/964、PostgreSQL83/396及typecheck38/38通过。TASK51候选/bundle已为`STALE / NOT AUTHORIZABLE`；没有host安装、正式PASS、`ELIGIBLE`manifest、UAT/生产或真实数据动作，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十一次增量：`SELFHOST-OPS-BACKUP-OFFHOST-PROVENANCE-54`已从`61b752e2ad05e2b2a273a01ffba6a87cc77e6a4c`启动为唯一`DOING`。三线只读审计确认TASK41内层四域V2可复用，但现有明文`cp -a`与caller `transfer_id`不证明源签名、客户端加密、接收ACK、调度或保留。本任务只在仓库/合成隔离环境实现外层密文provenance、双向签名、失败恢复、恢复强制绑定、单飞调度、dry-run保留和Dashboard/监控失败关闭；不创建真实密钥/异机目标，不读取/外传真实数据，不安装timer或执行删除，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十二次增量：TASK54已完成。D-131固定稳定内层V2、Ed25519/X25519/HKDF-SHA256/AES-256-GCM外层、双向回执、恢复强绑定、UTC单飞、dry-run retention和root发布V3 readiness；旧V2及synthetic均不能ready。源码`fd0a9cff`与manifest-only直接子提交`315b1f3d`形成47文件bundle；合成密文双集群恢复和适用回归通过。没有真实密钥/异机目标、timer/WORM、数据外传/恢复或RPO/RTO，因此G2仍阻塞，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十三次增量：`SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-55`已从TASK54收口提交`812ec2f0a5c2710c73e7c0e3cbd207f977e6256b`启动为唯一`DOING`。只读核验确认现有logical backup/restore同时排除owner与ACL且未捕获cluster globals，roles/memberships/settings、owner/ACL/default privileges和custom tablespace没有可恢复证据。任务将在仓库与合成隔离环境实现allowlist快照、NOLOGIN角色骨架、root-only凭据重新绑定、显式tablespace map、精确权限验证和新的恢复就绪证据；不接触真实数据库、凭据、UAT/生产或host，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十四次增量：TASK55已完成。D-132固定严格PostgreSQL集群对象目录、NOLOGIN/PASSWORD NULL角色骨架、成员关系与4类设置恢复、数据库/Schema/对象/列/函数/类型/大对象ACL及default privileges恢复、显式custom tablespace映射、root-only标准输入凭据重新绑定、正反权限探针和失败后隔离；V4 readiness同时绑定数据与集群证据链。源码`b93d838067f3a463f80de04811a11a1dbb5e1848`与manifest-only直接子提交`2136aa3c4178135a834b5a6e003e64948f78b5d3`形成49文件bundle，manifest SHA-256为`699cdd2a55058a38152718a09036255373757191b83d143bd501f995e6d47dd6`。239/215/24清单、Node113/965、PostgreSQL83/396、Browser6/11、SPECIAL POSIX7/57、38/38 typecheck及单容器双集群恢复通过；没有真实凭据、数据、异机目标、host安装、UAT/生产或正式恢复，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十五次增量：`SELFHOST-OPS-POSTGRES-RUNTIME-PRIVILEGE-56`已从TASK55收口提交`fb1f7e8893b2affba0ca07ecd9629ae2726adca9`启动为唯一`DOING`。只读UAT catalog确认PostgreSQL 17只有1个非内置LOGIN，且该角色同时为superuser、数据库owner和全部433个public relation owner；Web/Worker活动连接共用该角色。Compose仍以环境变量交付数据库/初始化/Setup/Admin秘密，PostgreSQL没有custom tablespace持久mount。任务只在仓库与合成隔离环境拆分owner/migration、Web、Worker、backup capture和受控operator，改用严格secret-file并声明未来持久mount；不修改真实角色、凭据、Volume、UAT/生产或业务数据，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十六次增量：TASK56的Backup control/capture检查点完成。未来入口必须使用两个物理/逻辑身份独立的root-only service文件；高权限control只做稳定身份、零large-object、默认只读/精确CONNECT围栏和恢复控制，固定非superuser `chenyida_erp_backup`执行relation reconciliation、Migration只读核对和`pg_dump --no-large-objects --no-owner --no-acl`。隔离PG17验证崩溃中断恢复、capture越权拒绝、意外large object拒绝与零large-object新空恢复；access intent只剩PG17编译catalog blocker。没有真实角色、凭据、备份/恢复、Volume、Migration、部署或UAT变化，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十七次增量：TASK56关闭D-132 v1实际readiness误放行。V4 validate/create/publish与Dashboard消费端都拒绝legacy v1 `ACTUAL_OFFHOST/RECOVERY_READY`，稳定错误为`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`；v1 synthetic保持可解析但永不ready。发布先验证既有alias再写immutable history，十份D-132 v1核心文件摘要冻结。inventory保持`244/220/24`且SHA-256更新为`1a84dcd0…f4496ab`，Dashboard9/9、release合同27/27、inventory、定向lint、typecheck、credentials及文档/JSON门通过；未创建真实回执或修改运行面，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十八次增量：TASK56固定PG17.10/libc C/UTF8精确结构编译器，从46个Migration与access intent v2冻结234表、211序列、394 routine、6独立type、3 extension及3132列/1709约束/957索引/285非内部trigger；31类unsupported全零，同owner漂移、用户rule、TOAST、routine配置、extension指纹/owner/未知成员class等负测失败关闭。两次独立新空PG17运行逐字节重现，目录文件/制品/逻辑SHA-256为`4ca22dfa…1162`/`93af15b7…7674`/`40c8c620…7f8f`；inventory为`245/221/24`。该证据不创建角色或授予ACL，TASK56继续v2 policy/reconciler，运行UAT仍共享superuser，整体继续`PRODUCTION NO-GO`。

2026-08-13 第二十九次增量：TASK56 catalog检查点已形成可追溯两提交链。源码`8675efd28ed8b61900fb49f7644541103f5f60b0`/tree`21556c6695b5b49a62959797b1adcb3b116387ef`在干净归档上通过固定PG17正式84文件/401项及独立第二cluster目录重建；manifest-only直接子提交`633b42dca48393d7f24d48808c9046e0d2bd8fc4`/tree`241f808e73464275fc8472a92f35e9254ef9522b`绑定50文件，bundle SHA-256为`baf820f4d1647e427cae1409c5a3797edc4b38fa8eefa2d56c669c4c2094ddc1`。Supervisor31/31、官方凭据扫描1643文件和Python三基线通过。该bundle只冻结catalog检查点，完整角色/ACL、secret-file、operator、tablespace、源码匹配候选和最终bundle仍开放；UAT仍共享superuser且没有运行变化，整体继续`PRODUCTION NO-GO`。

2026-08-13 第三十次增量：TASK56最新静态运行边界检查点已形成。runtime/migration精确session profile、六份独立32-byte secret-file、UAT/production秘密环境拒绝、容器身份/资源/mount/tmpfs/network exact policy、独立tablespace Volume/PG17 child/recovery map及贯穿授权到commit的`runtime_configuration_sha256`已在仓库与隔离环境闭合。依赖provenance复核修正当前Next/React锁与`node_modules/.vite-temp`只读测试挂载点，源码`6ddfae92bf3ed95314944e95043240fbe26fdee3`/tree`73bafe754b07bc99d5f2268daf2a1b1d001405c9`与manifest-only直接子提交`ef409bbb8d8cefe0ce596759fc57b3d222bd6ea2`/tree`018fb3f8cc47b9c96296f53576e6aee6450fae83`形成53文件bundle`bac5e882…cd9e`。Node119/1005、PostgreSQL84/401、Browser6/11、POSIX7/57、typecheck38/38及完整适用门通过。没有创建真实角色、secret或Volume，也未修改UAT/生产；生产受控operator和可信预授权运行配置摘要探针仍为P0，后续源码会使当前静态bundle失效，整体继续`PRODUCTION NO-GO`。

2026-08-13 第三十一次增量：TASK56受控PostgreSQL权限operator仓库链已形成。D-134固定installed content-addressed Supervisor唯一入口、七个直接消费者值、共享全局release锁、authorization消费前durable intent、append-only/fsync journal、backup fence双向联锁、BOOTSTRAP predeploy target binding、RECONCILE strict postdeploy probe以及精确RECOVER/quarantine；一个事务同时收敛角色/ACL和五LOGIN口令，结构no-op也必须重置及核验五口令。固定PG17真实system adapter在46个Migration后提交事务并立即SIGKILL执行进程，随后由journal选择`CAPTURE_AND_VERIFY`完成恢复；stdout/stderr/PostgreSQL日志对七个fixture口令和完整SCRAM verifier扫描为零。operator16/16、Supervisor29/29、release/catalog34/34及真实适配器通过，临时容器/目录清理。旧静态bundle`bac5e882…cd9e`已失效，最终完整回归和新canonical bundle仍在执行；未安装host、创建真实secret或修改角色/ACL/Volume/UAT/生产，整体继续`PRODUCTION NO-GO`。

2026-08-13 第三十二次增量：TASK56仓库与合成隔离范围已完成。功能修复基线`076b840`通过Node121/1026、PG84/401加catalog、Browser6/11、POSIX7/57、typecheck38/38、release inventory57及直接54、Supervisor48、Python三基线、隔离Migration和备份/恢复；lint0 error/28 warning、credentials1665、JSON220、Shell44、Python50及Markdown395/237通过。TASK51历史镜像仅作当前runtime离线夹具时以`ADMIN_READ_ONLY_FIXTURE_GROUP_MISMATCH`失败关闭并清理任务container/Volume/network，没有被冒充为当前候选；TASK56按范围禁止build。最终文档源码检查点与唯一manifest-only直接子提交形成canonical bundle。实际角色/secret/ACL/Volume、host、同源码镜像、正式19步门、UAT/生产均未改变，整体继续`PRODUCTION NO-GO`。

## 2. 证据范围与未执行事项

- 主智能体核验 Git、源码、Migration、Docker/Compose、systemd、health、运行镜像、UAT 数据库 Migration 元数据、备份目录元数据和服务器资源。
- 数据迁移、应用测试、运维安全三个子智能体分别完成只读审计；主智能体复核关键代码路径并归并结论。
- UAT 数据库只在`transaction read only`中读取`schema_migrations`和 public 表数量；没有读取业务行或执行写入。
- 没有读取凭据、备份正文、受保护卷业务正文或用户未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`。
- TASK48已在本机Docker engine建立精确Web/Worker隔离候选及root-only诊断制品，但没有外部push、真实Migration、备份、恢复、上传、部署、服务重启、账号权限变化、真实员工登录或业务POST；当前四卷、业务数据库和日志正文均未读取。
- TASK49只读取宿主资源和四服务Docker name/image/status/health/restart/OOM metadata；没有读取容器环境、日志、API、数据库、受保护卷或备份正文。诊断缺失事实保持CRITICAL，没有生成真实通知或delivered记录。
- TASK50只读取同类Docker metadata并在任务私有隔离容器中验证未来候选策略；没有重建/重启UAT、读取其环境/日志/业务数据/卷正文或执行Migration/deploy。隔离容器、网络和Volume已清零。
- TASK51从clean Git archive在本机构建Web/Worker并使用loopback registry、任务私有runtime容器和断网无socketTrivy扫描；没有外部push、host安装、UAT/生产连接、Migration/deploy、账号或业务写。临时registry、容器、网络、Volume、tar和目录清零，UAT四服务及四个受保护Volume不变。
- TASK53只在clean Git snapshot、合成fixture和隔离PostgreSQL/Node容器中实现与验证三阶段发布合同；没有读取UAT环境、日志、API、业务数据库行、备份或受保护Volume正文。任务临时容器、数据库、网络、Volume、tar和目录清零；四服务restart0/OOM false。
- TASK54只在clean Git snapshot、合成密钥/四域fixture和隔离PostgreSQL中验证签名密文来源、调度/保留、Dashboard/监控及恢复；没有创建真实密钥/目标、读取当前数据/备份/卷正文、外传、安装timer或执行删除。临时容器、数据库、网络和Volume清零；四服务restart0/OOM false。
- TASK55只在clean Git snapshot、合成角色/ACL/tablespace/凭据fixture和隔离双PostgreSQL集群中验证恢复；组合恢复执行的是supervisor bundle内受信fixture，不执行候选archive中的任意脚本。没有读取真实凭据、业务行、备份/卷正文或日志，没有连接异机、安装host组件、修改UAT/生产或执行正式恢复；任务容器、数据库、网络、Volume和临时目录清零。
- TASK56启动审计只读取去敏的UAT PostgreSQL角色属性、对象owner计数、Migration元数据和活动连接角色去重计数，以及Docker/Compose mount与服务状态metadata；没有输出角色名/连接串/密码，没有读取`.env`、业务行、日志、备份/卷正文或未跟踪状态报告，也没有执行写入、重启或创建资源。
- TASK56 Backup检查点只在仓库和一个临时PostgreSQL 17容器的合成双cluster中验证独立control/capture、CONNECT围栏、零large-object及恢复；没有读取当前数据库/卷/备份/凭据，没有创建或修改UAT角色/ACL，临时容器、cluster和目录全部清理。
- TASK56 catalog检查点只在仓库和一次一个临时PostgreSQL 17容器的新空合成cluster中应用46个Migration、捕获只读结构并执行负测；没有连接UAT数据库、读取业务行/秘密/日志/备份/卷正文、创建真实角色/ACL或修改运行面，临时容器、cluster和目录全部清理。
- TASK56 D-132兼容检查点只在固定Node断网/只读临时容器与合成fixture中验证v1 actual失败关闭、v1 synthetic兼容、alias写入顺序及摘要冻结；没有访问PostgreSQL、创建真实readiness文件或触碰当前运行面。
- TASK56最新静态检查点只在仓库、固定断网Node/Browser环境和一次一个临时PostgreSQL 17容器中验证session、secret、container、tablespace与恢复合同；真实UAT角色、secret、Volume、环境和服务未改变。依赖重建临时目录和旧依赖备份已按精确路径清理，无测试容器遗留。
- TASK56受控operator检查点只在仓库、合成consumer凭据和一个临时PostgreSQL 17容器中验证真实system adapter、事务提交后SIGKILL、durable journal恢复、五口令探针和秘密日志扫描；没有读取真实凭据、UAT数据库/日志/环境、业务行、备份或卷正文，没有安装Supervisor或修改真实角色/ACL。测试container、source snapshot、credential/state目录已清理。
- TASK56最终回归只使用提交快照、合成数据库/文件和一次一个任务容器；Migration、备份/恢复与历史runtime夹具资源全部清零。旧TASK51镜像因当前secret-file属组合同失败关闭，没有被视为当前候选或修改。最终资源低于停止线，未读取未跟踪报告、`.env`、真实秘密/业务行/日志/备份/卷正文，也未执行build、push、UAT/生产或账号动作。

## 3. 当前身份与运行事实

| 证据项 | 当前事实 | 判定 |
| --- | --- | --- |
| 根仓库 | TASK56最终文档源码检查点与紧随其后的唯一manifest-only直接子提交形成canonical链，精确身份由manifest的`source_commit/source_tree`自证；旧`bac5e882…cd9e`失效，未fetch/push | 本机内容寻址链`PASS`；异机源码锚点仍缺失 |
| 私有源码锚点 | 本机最后已知跟踪引用为`recovery-private/main@1dcbf8d`；本任务未fetch、调用远端API或push，因此未声称其为远端实时状态，也未用本地提交差值冒充异机证明 | `FAIL`，当前完整历史未证明异机存在 |
| 源码 | `0.1.0-alpha.47`，Migration46/head`0046_runtime_lock_privilege_boundary.sql`；0046 SQL/Snapshot SHA-256为`ad68aaa4…6d66b`/`c8fe259a…1f60d`，0001—0045未修改；D-134受控operator、完整适用回归和最终canonical bundle已完成 | 仓库/合成隔离`PASS`；同源码候选镜像、可消费授权及运行激活仍缺 |
| 源码 Schema | 46 个 SQL、journal 和 snapshot 顺序一致；`db/schema.ts`与 0046 snapshot 为 233 张 public 表且列集合一致 | 静态及隔离Migration一致性`PASS` |
| UAT Web | `0.1.0-alpha.42`，revision `569aa954…d33a24`，Image ID `sha256:e7761e2c…f94964` | 与源码不一致 |
| UAT PostgreSQL | PostgreSQL 17，40/head `0040_warehouse_receipt_readiness.sql`，0040 checksum `b6781c94…a5a93`，227张public表；仅1个非内置LOGIN且为superuser、数据库owner及全部433个public relation owner，Web/Worker活动连接共用1个角色 | 与源码不一致；运行时最小权限`FAIL`，TASK56只修仓库候选 |
| 隔离候选 | TASK51的`8084d6c3` Web/Worker镜像仍可作历史审计证据，但TASK53—TASK56改变了发布源码与secret/runtime合同；以旧镜像执行当前策略已失败关闭并清理 | `STALE / NOT AUTHORIZABLE`；须从TASK56最终链重建并取得外部锚点 |
| 发布台账 | `RELEASES.md`记录alpha.46本机隔离候选但明确`NOT_RELEASED/NOT_ELIGIBLE`；没有正式gate report或`ELIGIBLE`manifest | `FAIL` |
| 运行健康 | Web/PostgreSQL healthy，Worker/Caddy running，restart 0、OOMKilled false；回环与公开 health仍来自alpha.42旧实现，Worker health为none | 仅证明当前空闲存活；TASK45源码真实性未部署 |
| Python 旧运行面 | `chenyida-erp.service` enabled/active、restart 0，当前监听`127.0.0.1:18889` | 开发/迁移来源；正式切换前须明确处置 |
| 数据卷 | PostgreSQL、uploads、attachments、backup-status 四卷存在 | 单机持久化，不是灾备 |
| 本机备份 | `/var/backups/chenyida-erp`存在 root-only 历史文件；与运行卷同在`/dev/vda1`，未发现自动 backup timer | `FAIL`，同一故障域 |
| 当前资源 | TASK56收口available约1.8GiB，Swap约723MiB/1.0GiB，根分区可用15GiB，Load低于4，`oom_kill=0`；四服务restart0/OOM false | 低于停止线且任务container/Volume/network清零；长期容量/soak仍未完成 |

本地远端跟踪引用只证明最后一次本地已知状态；在没有受控 fetch/远端 API 核验时，不把它表述为远端实时状态。

## 4. 投产完成门禁

| 门禁 | 当前状态 | 解除证据 |
| --- | --- | --- |
| 自托管唯一权威 | `PARTIAL` | 生产运行只保留 Node/PostgreSQL 权威；Python/SQLite 有明确只读迁移、停用或隔离决定 |
| 源码/提交/镜像/Migration一致 | `FAIL` | 一个不可变候选 manifest 同时绑定 Git SHA、版本、镜像 digest、Migration manifest/head；UAT 实况完全匹配 |
| 异机备份 | `FAIL / REPOSITORY PROVENANCE VERIFIED / ACTUAL OFFHOST ABSENT` | TASK54已验证签名密文传输、双向回执、调度/保留和失败关闭；仍须把当前四域加密传至获批异故障域，核验真实回执、保留、时效和责任人 |
| 隔离恢复 | `PARTIAL / DATA + CLUSTER SECURITY SYNTHETIC-ISOLATED PASS` | 从真实异机副本在新空隔离目标恢复四类数据及集群级对象，完成Migration、角色/ACL/默认权限/表空间/凭据正反权限、数量、摘要、库存和关键金额核对并记录真实RTO；现有合成密文双集群证据不替代真实数据 |
| 真实数据试迁移 | `FAIL` | 只读源快照、逐行结果、重复/孤儿/单位/文件处置、库存/金额核对和可重跑报告通过 |
| 核心服务端规则 | `PARTIAL` | 物料/BOM/采购/收货/IQC/库存/生产/销售/财务关键链及异常路径在同一候选通过自动与人工验收 |
| 权限/会话/安全/审计 | `PARTIAL / TASK56 REPOSITORY COMPLETE / CURRENT UAT SUPERUSER` | Web锁、Backup、PG17 catalog、v2角色/ACL、五身份探针、session、secret、container、tablespace、受控operator及最终bundle已闭合；仍须实际角色/secret/Volume部署及同候选运行复核。随后还需批准岗位矩阵、职责分离与最小数据域；当前UAT共享superuser和环境秘密不满足投产要求 |
| 强制发布测试门 | `PARTIAL / TASK56 FULL APPLICABLE REPOSITORY REGRESSION PASS / CURRENT CANDIDATE ABSENT` | inventory为248/224/24；Node121/1026、PG84/401加catalog、Browser6/11、POSIX7/57、typecheck38/38、release57+54、Supervisor48、Migration/恢复及Python三基线通过，canonical bundle已完成。TASK51镜像按当前runtime合同失败关闭，host supervisor未安装，正式provenance/SBOM/security evidence和同候选19步报告不存在 |
| 监控/容量/告警/手册 | `PARTIAL / REPOSITORY CONTRACT VERIFIED / HOST DELIVERY NOT CONFIGURED` | TASK49已验证严格快照、阈值、状态机、pending delivery及排障合同；仍须host安装/调度、真实渠道和值班升级演练，以及低资源负载/备份/恢复soak和升级/回滚演练 |
| 真实员工受控试用 | `FAIL` | 少量真实岗位用户按脚本完成跨岗正常/异常流程并签字，问题闭环后重验 |
| 正式切换与回滚授权 | `FAIL` | 明确窗口、冻结点、负责人、验证清单、回滚触发器与项目负责人专项授权 |
| 上线后观察 | `NOT_STARTED` | 健康、数据核对、告警、备份和恢复抽检在观察窗再次通过 |

## 5. P0 投产阻断

### PR-001 异故障域数据恢复能力不存在

- PostgreSQL、uploads、attachments、backup-status 及本机备份同处单机故障域；主机或磁盘损坏可能同时丢失运行数据与备份。
- 既有 private Git 与 GHCR 只保护源码和 alpha.42 Web 镜像，不保护业务数据。
- TASK54已给出版本化RPO/cadence/retention输入和加密接收合同，但当前仍没有经项目负责人确认并实际部署的RPO、RTO、保留周期、异机目标、密钥托管/轮换、WORM、调度或告警责任人。

解除条件：项目负责人指定异机目标、密钥托管、RPO/RTO、保留/WORM和责任人，并按A4分项授权真实快照、密文传输、第三域隔离恢复和常态重验；真实恢复须按TASK55合同验证角色、ACL、default privileges、tablespace映射与重新绑定凭据的正反权限。

### PR-002 V2/V3/V4 工具路径已完成，真实运用仍未授权

- `SELFHOST-OPS-BACKUP-RECOVERY-V2-41`已使数据库秘密退出 argv，改为严格 root-only libpq service 文件；四域 manifest 绑定实际 runtime/database/Migration 身份、RPO、完整制品和前后内容 reconciliation。
- 精确停止 writer、持久数据库 fence intent、SIGKILL 后精确恢复、不可变本机/异机/恢复回执、RPO 过期和不同 machine/cluster 证明均已实现并通过隔离测试。
- restore 使用 durable pinned source、全文件 staging、单事务数据库恢复、精确补偿、建库响应歧义处理和 prepared receipt 保全/补发；TASK54要求先验证签名密文外层后再短暂物化内层V2，并把全部摘要链写入V3 readiness。
- D-131/TASK54已实现Ed25519双向签名、X25519/HKDF-SHA256/AES-256-GCM、原子接收/ACK、中断续跑、UTC单飞和dry-run retention。Dashboard的V1/V2都为legacy/not-ready，synthetic evidence永远false；只有真实外层链、已安装调度、有效保留计划及当前身份全匹配才可能ready。
- D-132/TASK55已实现cluster catalog allowlist、NOLOGIN/PASSWORD NULL骨架、角色/成员/设置、owner/ACL/default privileges、custom tablespace显式映射、root-only标准输入凭据重新绑定、正反权限探针和崩溃安全恢复执行器；V4 readiness同时绑定数据链、集群链、恢复机器消费与安全回执。TASK56进一步在生产者、验证器、发布器和Dashboard四处拒绝D-132 v1 actual；V1—V3及synthetic都不能ready。
- 工具仍不提供真实异机/密钥托管、WORM、timer安装、保留删除执行、外部告警、真实凭据重绑或真实RTO；不可捕获的恢复进程/宿主硬故障会隔离保留带marker的TEST目标，而不是猜测删除。

状态：`G1 + OFFHOST PROVENANCE + CLUSTER SECURITY REPOSITORY RESOLVED / SYNTHETIC-ISOLATED VERIFIED`。只有完成PR-001/G2的真实异机副本与恢复、实际凭据重新绑定和权限核验，并部署调度/保留/告警后，才能把该工具链作为生产灾备证据。

### PR-003 运行候选身份不闭合

- TASK42已实现严格release manifest、content-addressed supervisor两提交链及精确Migration allowlist/目标数据库身份，仓库工具不再允许靠tag或目录排序冒充候选。
- TASK53已按D-130闭合部署前/隔离候选/部署后三阶段身份，并使runtime identity v3只能来自独立严格postdeploy回执；但这只关闭仓库生命周期缺口。
- TASK51的`8084d6c3`本机Web/Worker候选与零发现诊断因TASK53—TASK56源码变化成为`STALE / NOT AUTHORIZABLE`；TASK56旧静态bundle也被D-134 operator实现失效。UAT仍alpha.42/0040、当前GHCR锚点仍alpha.42；本机loopback digest不是外部恢复锚点，也没有正式supervisor安全证据或`ELIGIBLE`manifest。
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

- 当前机器清单为248文件（224 REQUIRED、24有明确别名/历史N/A）、19步`test:release`、固定执行器、资源/timeout/无skip、机器报告及候选manifest绑定；当前执行集合含Pure Node121、PostgreSQL84、Browser6、release contract6与SPECIAL harness7。TASK45—TASK55历史记录中的旧计数保持其当时快照语义，不能当作当前机器合同。
- TASK42最终源码快照曾通过Node 107文件/886、PostgreSQL 80文件/367等完整仓库门；TASK43—TASK45随后通过各自定向、隔离PostgreSQL、release contract及supervisor验证；TASK49最后一次重跑完整Node/PostgreSQL/typecheck。TASK50没有改业务/Schema/TypeScript，只运行适用release/runtime门；当前源码仍没有同候选19步正式报告。
- TASK46已按D-120修复真实类型债，固定精确38配置集合/摘要合同，并在源码与bundle两个连续干净快照38/38通过；该子门不再是仓库候选阻断。
- TASK47已按D-121固定Playwright 1.51.1/Chromium 134内容寻址运行时，并在源码`9a18a0f…`干净快照完成Browser 6文件/11项；该子门不再是仓库候选阻断。
- TASK48已在精确`8952a815`候选上以固定Trivy和新鲜数据库完成断网无socket的Web/Worker原生JSON与CycloneDX诊断，全部severity为0；严格合同要求Wolfi与Node双包清单并拒绝Debian/未知生态。该结果关闭“漏洞是否已诊断”的本机缺口，但没有installed supervisor签发的正式scan provenance/SBOM/security evidence。
- TASK53又在最新内容寻址链重跑release候选侧51/51、supervisor侧48/48、Node113/964、PostgreSQL83/396及typecheck38/38，并关闭首次晋升自锁；这些是仓库回归，不是正式19步候选报告。
- TASK54在新内容寻址链重跑release contract51/51、supervisor31/31、inventory237/213/24、typecheck及Compose/runtime，并完成签名密文双集群恢复；这些仍是仓库/合成隔离回归，不是正式19步同候选报告。
- TASK55在源码`b93d8380`与bundle`2136aa3c`上完成inventory239/215/24、release inventory51/51、直接合同48/48、supervisor31/31、Node113/965、PostgreSQL83/396、Browser6/11、SPECIAL POSIX7/57、typecheck38/38和组合恢复；这些仍是仓库/合成隔离回归，不是正式19步同候选报告。
- TASK56最终把inventory固定为248/224/24，并完成Node121/1026、PostgreSQL84/401加catalog、Browser6/11、SPECIAL POSIX7/57、typecheck38/38、release inventory57/直接54、Supervisor48、Migration/恢复及Python三基线；canonical manifest也已闭合。历史TASK51镜像按当前runtime secret合同失败关闭，未冒充新候选；这些仍是仓库/合成隔离回归，不是正式19步同候选报告。
- 同一候选19步全门仍未执行：TASK51的两个正式入口都在6个制品变化前因host supervisor未安装退出1，且该候选现已失效。因此完整候选门按设计保持阻断，不能把历史诊断零发现、runtime隔离或分项全回归解释为候选PASS。

解除条件：专项授权安装精确content-addressed supervisor，分别签发root-only一次性授权，在当前或后续精确候选上生成正式镜像provenance/SBOM/security evidence并运行完整19步门；任何缺失、跳过或失败继续阻止候选晋升。

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
- 当前UAT仅1个非内置LOGIN，且同时为superuser、数据库owner、全部public relation owner并被Web/Worker共用；TASK56只会修复未来仓库候选，真实角色/凭据切换仍需专项授权、备份和回滚窗口。
- TASK50使未来Compose六服务全面使用`read_only`、`no-new-privileges`和`cap_drop`，TASK51历史候选曾完成digest绑定与零发现诊断；TASK53—TASK55源码变化后该候选已失效。现行UAT未部署，也没有当前镜像外部锚点、签名/attestation或正式supervisor SBOM/安全证据。
- 公网入口仍为 nip.io 和非标准端口；没有公司域名、正式边缘策略、CSP、MFA或 break-glass 演练证据。
- TASK49已交付仓库级指标采集、告警状态与排障合同，但尚未安装到host、接入外部告警、指定值班升级或完成真实演练；运维手册中的运行事实仍需在同候选部署时复核。
- 空闲资源稳定不等于真实负载稳定；没有低资源业务负载、备份、恢复、数据库增长和重启 soak。
- Active 物料属性修订、`MECH/OTHER`、正式替代料、单位换算和客户专用限制仍未形成完整生产验收。

## 7. 依赖路线与逐阶段验收

| 阶段 | 任务簇 | 前置依赖 | 完成证据 | 失败处理 |
| --- | --- | --- | --- | --- |
| G0 | 投产事实基线 | 无 | 本文件、三线审计、`PRODUCTION NO-GO` | 发现新事实即更新，不放宽门禁 |
| G1 | 备份/恢复内层V2、外层来源与集群安全合同 | G0 | `DONE / DATA + CLUSTER SECURITY SYNTHETIC-ISOLATED`：四域manifest、凭据不进argv、原子恢复、签名密文来源、双向回执、角色/ACL/default privileges/tablespace/凭据验证、调度/保留失败关闭 | 任一部分状态或泄漏立即拒绝 |
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

1. TASK41/TASK54/TASK55已完成G1内层恢复、外层签名密文来源和集群安全恢复的合成/隔离证据；真实G2被异机目标、密钥托管、RPO/RTO、WORM/timer、真实凭据绑定与专项授权阻塞。
2. G3仓库工具已由TASK42完成，完整typecheck和Browser分别由TASK46/TASK47关闭，TASK50把六服务runtime policy加入第19步；TASK53按D-130关闭现行Worker health none造成的首次晋升自锁，并形成47文件content-addressed bundle。TASK51候选因源码变化失效；后续须重建精确候选、建立A3外部引用，再按A1→A3→A2推进。
3. G4的物料导入fallback仓库修复已由TASK43完成；运行面验证等待同候选与专项部署授权。
4. TASK44/TASK45已完成会话绝对时限和health/Worker/storage/Migration真实性仓库修复；运行面验证等待同候选完整gate及专项部署授权。
5. `SELFHOST-OPS-MONITORING-ALERTING-49`已完成仓库级监控、容量阈值、备份/恢复证据新鲜度、告警状态和排障合同；host安装、真实外部投递、值班责任人和演练仍需专项授权/资源。
6. TASK50已完成容器运行时最小权限加固；TASK53—TASK55已完成发布生命周期、异机provenance和集群安全恢复仓库合同。当前唯一`DOING`为`SELFHOST-OPS-POSTGRES-RUNTIME-PRIVILEGE-56`；Web锁、Backup、PG17 catalog、v2角色/ACL、session、secret、container和tablespace静态合同已闭合，现进入生产受控operator、host lock、持久intent/backup fence及可信预授权运行配置摘要探针。完成并重建最终bundle后再生成精确候选，A3外部锚点及A1/A2另按资源和授权依赖推进；岗位权限矩阵仍等待业务负责人确认。

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

TASK49增量验证保持一次一个重任务：监控14/14、release合同6文件/48项及直接45/45、supervisor20/20、Node113文件/964项、PostgreSQL83文件/396项、typecheck38/38、SPECIAL POSIX4文件/29项、lint和credentials通过。任务容器与测试数据库清零；起点/收口available约2.2/2.2 GiB、Swap734/719 MiB、根盘18/18 GiB、最终Load`0.64/1.16/1.35`，四服务restart0/OOM false。没有host安装、真实通知、UAT/生产连接、当前卷读取或真实数据操作。

TASK50增量验证保持串行且任何时刻最多一个临时容器：Compose policy、六服务实际runtime、runtime合同10/10、supervisor30/30、release6文件/48项及直接45/45、lint和1,588文件credentials通过。起点/收口available约2.2/2.2GiB、Swap718/714MiB、根盘18/18GiB、收口Load`0.16/0.41/0.45`；四服务restart0/OOM false，任务容器/网络/Volume清零。没有build当前候选、host安装、UAT/生产Migration/deploy、业务数据/日志/环境/当前卷正文读取或真实数据操作。

TASK51增量验证保持串行且任何时刻最多一个临时容器：当前精确候选build、Compose/六服务runtime、两镜像四次Trivy扫描完成；release48/48及直接45/45、supervisor31/31、lint和1,589文件credentials通过。起点/收口available约2.2/2.2GiB、Swap714/730MiB、根盘18/16GiB、收口Load`1.38/1.23/0.81`，`oom_kill=0`；四服务restart0/OOM false，任务registry/容器/网络/Volume/tar/目录清零。没有外部push、host安装、UAT/生产Migration/deploy、业务数据/日志/环境/当前卷正文读取或真实数据操作。

TASK53增量验证保持串行且任何时刻最多一个临时容器：release候选侧51/51、supervisor侧48/48、Python31/31、Node113文件/964项、PostgreSQL83文件/396项、typecheck38/38、lint和1,596文件credentials通过。一次512 MiB V8 heap不足未造成宿主/容器OOM，按门禁调整为640 MiB heap/896 MiB容器后通过。起点/收口available约2.1/2.2GiB、Swap715—716/719MiB、根盘16/16GiB、最终Load`0.91/1.23/1.25`；四服务restart0/OOM false，任务容器/数据库/网络/Volume/tar/目录清零。没有host安装、正式证据、外部push、UAT/生产Migration/deploy、业务数据/日志/环境/当前卷正文读取或真实数据操作。

TASK54增量验证保持串行且任何时刻最多一个临时容器：offhost/readiness8/8、备份/Dashboard58/58、监控/release41/41、release contract51/51、runtime Python11/11、supervisor31/31、inventory237/213/24、typecheck、Compose policy和六服务runtime通过；单容器双PostgreSQL cluster密文恢复及业务子测2/2通过。收口窗口available约1.8GiB、Swap`543→545MiB`、根盘16GiB、Load低于1；四服务restart0/OOM false，任务容器/数据库/网络/Volume清零。没有真实密钥/异机、timer/WORM、删除、外部push、host安装、UAT/生产或真实数据动作，1603文件credentials通过。

TASK55增量验证保持串行且任何时刻最多一个临时容器：release inventory51/51、直接合同48/48、supervisor31/31、Node113文件/965项、PostgreSQL83文件/396项、Browser6文件/11项、SPECIAL POSIX7文件/57项、typecheck38/38、lint、release Migration、Python基线、Compose/runtime policy和组合backup+cluster双集群恢复通过；inventory为239/215/24。收口available约2.0GiB、Swap632MiB/1.0GiB、根盘16GiB、Load`0.08/0.43/0.92`，`oom_kill=0`；四服务restart0/OOM false，任务容器/数据库/网络/Volume/文件清零。没有真实凭据/密钥/数据/异机、host安装、外部push、UAT/生产或正式恢复动作，1617文件credentials通过；runtime policy仅以已失效TASK51缓存镜像证明策略，不构成当前候选证据。

TASK56起点只读核验未创建临时容器、数据库、镜像、Volume或文件：available约2.0GiB、Swap603MiB/1.0GiB、根盘16GiB、Load`0.10/0.17/0.52`，`oom_kill=0`；四服务restart0/OOM false。没有读取`.env`、秘密、业务行、日志、备份/卷正文或未跟踪状态报告，没有真实角色、凭据、Migration、部署、重启或数据动作。

TASK56 Backup检查点验证保持串行且任何时刻最多一个临时容器：Backup/source定向13/13、release合同51/51、inventory `244/220/24`、access intent verify及PG17双cluster备份/恢复通过；PG17覆盖未知LOGIN/NOLOGIN CONNECT漂移拒绝、崩溃intent保留/恢复、非superuser采集越权拒绝、意外large object拒绝和零large-object新空恢复，Dashboard PostgreSQL 2/2通过。最终available约1.9GiB、Swap567MiB/1.0GiB、根盘16GiB、Load`0.19/0.25/0.26`，`oom_kill=0`；四服务restart0/OOM false，Web/PostgreSQL healthy且Worker/Caddy运行不变，任务容器、cluster和临时目录清零。Shell/JSON、394个Markdown/231本地链接、1631文件credentials和diff检查通过；没有真实角色/ACL/凭据、备份/恢复、Volume、Migration、部署或数据动作。

TASK56 catalog检查点验证保持串行且任何时刻最多一个临时容器：一次refresh及一次独立test均在新空PG17.10 cluster应用46个Migration，目录逐字节相同；真实extension TABLE成员未知class、extension owner/fingerprint、用户rule、TOAST/reloptions、routine配置、对象/owner及ACL/RLS负测均通过。inventory `245/221/24`、目录/发布/Dashboard33/33、release52/52、Supervisor31/31、typecheck38/38、lint0 error/17既有warning、credentials1643及Shell/JSON/Markdown/inventory/diff门通过；完整typecheck首次640 MiB进程堆不足后按正式768 MiB heap/1 GiB容器完整复跑通过。随后源码`8675efd…`的干净归档正式PG17门84文件/401项及独立catalog cluster通过，manifest-only直接子提交`633b42d…`绑定50文件、SHA-256`baf820f4…ddc1`；该提交上的Supervisor31/31、官方credentials1643和隔离Python三基线通过。最终available约1.8GiB、Swap543MiB/1.0GiB、根盘16GiB、Load`0.56/0.91/1.07`，`oom_kill=0`，四服务restart0/OOM false，任务容器/cluster/目录清零。`docker compose ps`因无secret shell而缺必需setup token并失败关闭，未读取或伪造凭据，改用四个精确容器inspect核验。没有真实角色/ACL/凭据、UAT/生产连接、Migration/deploy、备份恢复、Volume或数据动作。

TASK56静态运行边界验证保持串行且任何时刻最多一个临时容器：Node119/1005、PostgreSQL84/401及runtime privilege catalog、Browser6/11、SPECIAL POSIX7/57、typecheck38/38、release inventory6文件/56项、直接合同53/53、Supervisor40/40、Migration allowlist、不同cluster数据库/文件恢复、单容器双cluster安全恢复、Dashboard PostgreSQL2/2、UAT/production Compose policy和inventory `246/222/24`全部通过；lint为0 error/26 warning，credentials1653通过。PG全量首跑在Swap越过80%时中断并清理，低于80%稳定超过60秒后串行重跑；既有单任务曾短暂81.07%，期间未启动新重任务且随后回落。最新available约1.84GiB、Swap约71.23%、根盘16GiB、Load`1.11/0.96/1.21`、`oom_kill=0`，四服务restart0/OOM false，无遗留PG容器；依赖临时目录和旧树备份按精确路径清理。没有真实角色/secret/Volume、host安装、外部push、UAT/生产Migration/deploy、业务数据/日志/卷正文读取或运行面变更。

TASK46增量验证保持串行且一次一个临时重任务：首次完整门如实失败后修复真实类型/执行器问题，源码`f3bac028`及bundle`3d1243e2`两个干净快照分别38/38；定向287/287、release合同45/45、supervisor15/15、inventory235/211/24、干净快照lint和1,566文件credentials通过。一次错误包含`.wrangler/work`的直接lint发生V8 heap OOM退出139，但宿主/容器OOM为0、Swap增长约27 MiB，正式快照重跑通过。起点/收口available约1.9/2.0 GiB、Swap453/484 MiB、根盘30/31 GiB、Load1低于4，四服务restart0/OOM false，任务容器/目录清零；没有build、UAT/生产Migration、部署、当前卷读取或真实数据操作。

TASK47增量验证保持串行且任何时刻最多一个临时容器：第十三次干净快照Browser运行6文件/11项全部PASS，release合同45、supervisor20、完整typecheck38/38、lint和inventory235/211/24通过。Browser前available2,424,572KiB、Swap76.32%、根盘27GiB；Browser后Swap短暂80.14%即按规则暂停，未修改Swap或服务，自然回落到阈值内后才继续；最终available2,481,228KiB、Swap73.47%、根盘27GiB、Load`0.98/1.91/1.62`，内核OOM0、四服务restart0/OOM false，任务容器/目录清零。没有候选镜像build/push、UAT/生产Migration、部署、当前卷读取或真实数据操作。

TASK48增量验证严格串行且任何时刻最多一个临时容器：最终`8952a815`候选构建、运行时验证和两镜像四次扫描完成；release合同48/48、supervisor20/20、release typecheck、lint及1,575文件credentials通过。起点available约2.4GiB、Swap744MiB、根盘27GiB；收口约2.2GiB/734MiB/18GiB/Load`0.31/0.32/0.37`，`oom_kill=0`，四服务image/restart/OOM/health不变。临时registry、容器、tar和目录清零；成功候选、固定Trivy数据库与root-only只读证据按审计需要保留，未prune。没有外部push、正式supervisor动作、UAT/生产Migration/deploy、当前卷正文或真实数据访问。
