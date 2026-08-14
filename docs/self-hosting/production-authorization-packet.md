# 晨亿达 ERP 投产专项授权执行包

> 权威基线任务：`SELFHOST-EXTERNAL-AUTHORIZATION-READINESS-52`
> 当前事实刷新：`SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-ACTIVATION-64` / D-140
> 事实快照：2026-08-15（Asia/Shanghai）
> 当前结论：`PRODUCTION NO-GO / CONTROL PLANE ONLY / NO AUTHORIZATION GRANTED`

## 1. 使用规则

本文件把后续投产动作拆成`A1`—`A8`八个授权域。它是影响、依赖、验收和回滚控制面，不是任何一项动作的授权书，也不包含可消费 nonce、密码、Token、私钥、数据库连接串或业务数据。

执行时固定以下规则：

1. 项目负责人只批准一个明确授权域；上游成功不会自动批准下游。一个授权域内如有多个写检查点，必须按本文件顺序执行，前一检查点失败即停止。
2. 每次授权前重新核对 Git、镜像、Migration、UAT、资源和外部目标；任一摘要、容器、数据库身份、窗口或责任人漂移都使旧授权范围失效。
3. 密码、Token、私钥、数据库 service/env 文件和一次性 canonical authorization 只由 root 在批准路径创建，固定为单硬链接、root-owned、`0400`或合同要求的更严格权限；不得粘贴到聊天、Git、命令参数或普通日志。
4. 主智能体负责执行集成和证据；项目负责人是批准者；每个会影响运行面的动作还须有一名明确观察人。执行人不能用“工具通过”替代批准者或业务验收人。
5. 正式动作一律串行，`COMPOSE_PARALLEL_LIMIT=1`，一次最多一个临时测试/构建容器。达到资源停止线或出现身份歧义时立即停止，不以删除、重试或放宽断言猜测收敛。
6. 证据默认保留，失败证据不得改写为成功。删除外部对象、备份、恢复目标、持久目录或审计证据始终是新的破坏性授权，不属于本执行包的隐含回滚。

## 2. 当前不可变事实

| 项目 | 当前事实 | 含义 |
| --- | --- | --- |
| TASK64严格起点 | `e527fcfe5fa0f779cbe4514ffa82376e1d0f3462` / tree `778b24a550215271bba248ea6367adc8d1b3fb92` | TASK64从该clean manifest-only根启动；最终提交链如下，治理收口提交以`git log`为准 |
| 当前快照输入 | `0e2328b58bc68cf09dc6b0638bb5ded82b0cf347` / tree `585b3c8d1d38f695422c5378eaa24691627de932` | alpha.47 / Migration 46/head；表示D-135—D-140 snapshot/reservation/monitor/projection/recovery policy仓库输入，不表示存在源码匹配Web/Worker镜像或已安装host |
| Web/Worker镜像 | TASK57 Web manifest/config `b7b21508…8a30`/`3c83d60f…f56e`、Worker `c5bf9d5c…b113`/`3bebff16…f971` | `STALE / NOT AUTHORIZABLE`；TASK59—TASK61改变Site输入后当前没有源码匹配镜像，A3不得使用这些历史对象 |
| supervisor source | `83d920b1ac017370270452d334e44fa36a6b3978` / tree `83084e980d794a37bfeb835fcbf89e7c5210fee7` | 包含monitor manifest、D-135—D-140 snapshot/host delivery/projection/V2 policy激活及121个固定文件的权威Supervisor源码提交 |
| supervisor manifest | `0e2328b58bc68cf09dc6b0638bb5ded82b0cf347` / tree `585b3c8d1d38f695422c5378eaa24691627de932` | source 的直接子提交，只更新 canonical Supervisor bundle manifest |
| supervisor bundle | `728f9a5f321c03c4a9b089ca4c3091c04273e6b7427f1df610c6756fa0735db9` | 121文件，生成器逐字节重放一致；本值是manifest文件SHA-256 |
| monitor bundle | source`b057f81b989eab07a4a40603c6a2a4486f326ee1`/tree`a571800f83d38209603e2bfe2a3e35b71bd2eb2b`，manifest-only`3327be43d026d83477fff9e79a0eb0f090902e86`，SHA-256`6782ec58536826e76e3954e73fb24d5f3b9ee9a8d720f1b1515435d4fa5aea07` | 27文件内容寻址host delivery；仓库可审阅，不表示已安装、已有账号/systemd、网络出口或真实ACK |
| installer | `d7d88662eac8941a6646f3dd817eb386bbfbd6aa817dc522fc558c0bb916737d` | 只接受固定安装动作和短时 root-only 授权；未解决的policy activation链会阻断bundle切换 |
| launcher | `55f88ca35e1d39c01568deed20fcae32534408cacdf94904e39a651cf12d60d8` | 先取得全局锁、验证候选快照/runtime/monitor/policy输入，再消费授权；正式wrapper在最终发布前再次验证 |
| snapshot工具 | `release-candidate-snapshot.py` SHA-256 `296f61efb552a5fdd327e7b60b567a4dc2a569f9ec1c93bd57ef4dfe0f4fe98d` | PREPARE/VERIFY/REMOVE、创建前reservation、同inode no-clobber提升与守恒恢复已验；未获A2授权时仍不能实际进入正式候选 |
| 历史构建回执 | `33b1b9219c17ac3000b058a2cf16ab25ccdd2d859a09039e58abc074f2107a9a` | 仅解释TASK57旧本机诊断来源；已失效，不是正式release evidence或当前A3输入 |
| UAT | Web alpha.42 / source `569aa954…d33a24`；PostgreSQL 0040；四服务旧运行配置 | 与候选不一致，且现行容器仍非只读 rootfs |
| installed supervisor | launcher、bundle根、install/release authorization、receipt、journal 路径全部不存在 | 正式镜像证据和19步门按设计失败关闭 |
| 恢复能力 | V2 合成/双集群隔离合同已通过；真实异机目标、当前四域副本和真实恢复回执不存在 | 不能宣称故障后可恢复 |
| 监控 | D-137—D-140内容寻址installer、三身份、unit/timer、state/outbox/delivery、权威投影、V2 policy激活和远端ACK仓库合同已验；未安装host，notifier默认deny-all，真实渠道/值班演练不存在 | 不能宣称持续监控或告警已启用；先完成TASK65目标绑定出口，再按A5a专项授权执行 |

TASK64收口只读资源快照：available memory约2.0 GiB、Swap约861 MiB/1 GiB、根盘可用13 GiB、Load低于1，`oom_kill=0`；四个UAT容器restart 0/OOM false。Swap已超过80%停止线，当前不得启动新的build、全量测试或数据库重任务；未来执行仍须重新预检。

本节已由TASK64刷新到D-140不可变链，但仍不是可消费授权。`728f9a5f…5db9`和`6782ec58…aea07`可作A1/A5设计复核输入；snapshot reservation、monitor host delivery、权威投影和V2 policy activation仓库合同已闭合，但TASK65及其他安全仓库任务仍会改变bundle，当前不应请求安装，A1/A5a均未授予。A3必须在这些候选输入变化收口后重建Web/Worker，并把最终同一对象锚定为批准私有registry完整digest；A2再使用对应精确快照、reservation/receipt摘要、借用runtime和新鲜正式安全证据。TASK57本机对象不得冒充当前候选或外部锚点。

## 3. 全局执行前门禁

每个授权域执行前必须同时满足：

- 当前任务文档状态、唯一`DOING`和项目负责人授权编号一致；工作区仅允许已登记的用户未跟踪文件，不能有未知代码或候选输入漂移。
- `free -h`、`df -h /`、`uptime`、`docker stats --no-stream`、精确`docker compose ps`和内核 OOM 计数已记录；四个受保护 Volume 集合已只读核对。
- available memory不少于768 MiB、Swap使用率不超过80%、60秒增长不超过256 MiB、根盘可用不少于10 GiB、Load1未持续三分钟高于4；没有 OOM、反复重启、SSH卡顿或数据库失去健康。
- 执行目标、来源、时间窗、执行人、观察人、业务验收人、停止条件、证据目录和回滚责任人均已填入当次任务文档。
- 所有 root-only 输入只记录路径、owner/mode、摘要和用途；任何输出先做敏感信息检查，再决定是否进入治理文档。
- 当前候选与授权所绑定的 commit/tree、bundle、镜像、Migration、数据库/部署身份完全一致。只要一项变化，停止并重新生成执行清单。

## 4. 授权依赖与当前状态

| 授权域 | 动作 | 当前状态 | 关键依赖 | 成功后仍未获权 |
| --- | --- | --- | --- | --- |
| `A1` | 安装 content-addressed host supervisor | `TASK64 121-FILE BUNDLE REVIEWABLE / INSTALL DEFERRED UNTIL FINAL SAFE REPOSITORY BUNDLE / AUTHORIZATION NOT GRANTED` | 剩余安全仓库变化收口后重新固定精确source/manifest/bundle/installer/launcher；执行前仍须独立任务、root bootstrap路径和项目负责人专项授权 | `A2`—`A8`全部仍未授权 |
| `A2` | 正式镜像证据、19步门、UAT-class manifest | `BLOCKED BY CURRENT IMAGES + A1 + A3` | 最终snapshot reservation/receipt+digest+runtime root、A1回执、A3不可变registry完整引用、新鲜Trivy DB | UAT部署、真实数据仍未授权 |
| `A3` | 私有异机源码与镜像锚点 | `CURRENT IMAGE CANDIDATE ABSENT / TARGET AND CREDENTIAL AUTHORIZATION REQUIRED` | 最终安全源码收口后的同一源码与重建Web/Worker对象、批准私有Git/registry、root-only短时凭据 | 正式门、数据备份、UAT部署仍未授权 |
| `A4a` | 三故障域/RPO/RTO/加密/保留设计与空目标准备 | `READY FOR NON-SECRET OWNER INPUT` | source/offhost/restore位置、责任人和策略；不复制数据 | A4b—A4e及UAT动作仍未授权 |
| `A4b`—`A4d` | 当前四域本机备份、异机接收、第三域恢复 | `BLOCKED BY A4a AND DATA AUTHORIZATION` | 精确数据源/窗口、root-only凭据、三个故障域 | UAT Migration/deploy仍未授权 |
| `A4e` | 部署后同身份恢复再验证与常态调度 | `NOT EXECUTION READY` | 先补调度/保留/角色ACL合同；A6后需新备份/恢复身份 | 生产切换仍未授权 |
| `A5a` | 安装监控/投递能力并在旧UAT验证告警交付 | `REPOSITORY DELIVERY+PROJECTION+POLICY DONE / EXECUTION BLOCKED BY TASK65 TARGET-BOUND EGRESS + A1 + OWNER INPUT` | 完成目标绑定出口合同；再提供渠道、值班责任人、账号/systemd/网络专项授权及A1回执 | 旧UAT允许保持CRITICAL；UAT部署仍未授权 |
| `A5b` | A6/A4e后绑定新runtime/backup身份并验证绿色窗口 | `BLOCKED BY A5a+A6+A4e` | 新身份、真实恢复回执、真实通知与ack | 员工试运行仍未授权 |
| `A6` | 同候选UAT Migration/deploy/回滚演练 | `BLOCKED BY A2+A4d+A5a` | `ELIGIBLE` manifest、升级前可恢复快照、精确UAT窗口、迁移角色、观察人 | 真实数据迁移、跨岗写和员工试用仍未授权 |
| `A7` | 当前源盘点、业务处置、试迁移、岗位批准、跨岗UAT写、员工试运行 | `BLOCKED BY BUSINESS INPUT AND PRECEDING EVIDENCE` | 逐检查点见第11节；不得以一次批准跨越 | 正式切换仍未授权 |
| `A8` | 正式切换与上线观察 | `BLOCKED BY A2—A7 EVIDENCE` | 全部门禁、停写点、执行/回滚责任人、正式窗口 | 无；但上线后G10观察仍须完成 |

首次晋升的正确主链是：TASK53生命周期、TASK54—TASK56恢复/权限、TASK59—TASK60快照与reservation主合同（均已完成）→ 剩余安全仓库合同 → 最终bundle及Web/Worker重建 → A1 → A3不可变源码/镜像引用 → A2正式证据与19步门 → A4b—A4d升级前真实恢复链 → A5a监控/投递能力 → A6技术晋升及部署后严格回执/identity → A4e对新runtime identity重新备份恢复 → A5b绿色窗口 → A7跨岗/员工 → A8。A4a策略设计、A7岗位审批等非重任务可提前准备，但本机重任务仍串行。

TASK53已把旧UAT Worker的`health=none`限制在`PRE_DEPLOY_EXISTING_RUNTIME_STABILITY`的不退化比较中，TASK59—TASK60又把独立detached snapshot、创建前reservation、receipt、runtime和锁内验证闭合。TASK57镜像已失效；只有最终镜像、A1安装回执和A3完整外部digest全部闭合，才可请求或运行A2。

## 5. A1：host supervisor 安装

### 5.1 允许影响

A1只允许：

- 由root先只创建`/var/lib/chenyida-erp/release-supervisor-install-authorizations`及其`pending`子目录，固定root:root `0700`，再放置一份短时 canonical `0400`授权；installer在读取授权前要求这两个bootstrap目录已经存在且可信；
- installer通过预检后创建`consumed`及其余安装状态根，不允许operator预建bundle、launcher、receipt或journal正文；
- 由固定installer创建或验证`/usr/local/libexec/chenyida-erp-release-supervisor/{bundles,launchers,installers}`、`/usr/local/sbin/chenyida-erp-release-supervisor-v1`、install receipt/journal及release authorization `{pending,consumed}`根；
- 创建固定安装锁`/var/lock/chenyida-erp-release-supervisor-install-v1.lock`，写入内容寻址bundle、launcher、installer、PREPARED/COMMITTED journal和install receipt；
- 使用`/tmp`中的installer预检/staging并由工具在正常路径精确清理。

A1不允许运行四个发布动作，不创建release manifest，不访问Docker/UAT/数据库/四卷，不安装systemd服务，不改网络、账号、权限模型、Docker daemon或应用配置。

### 5.2 授权绑定

root operator必须从批准的本机安全输入生成授权；聊天只确认范围。授权固定字段包括：

- contract `chenyida-erp-release-supervisor-install-authorization/v1`；
- 唯一authorization ID、UTC created/expires（最长24小时）、64位随机nonce；
- repository root `/opt/erp`；
- 本文件第2节的source/manifest commit/tree、bundle、launcher和installer SHA-256；
- confirmation `INSTALL_EXACT_RELEASE_SUPERVISOR_BUNDLE`。

授权文件必须位于固定pending根、文件名与authorization ID一致、canonical JSON、root:root `0400`、单硬链接。项目负责人不在聊天中提供nonce或文件正文。

### 5.3 执行检查点与验收

1. 只读复核安装路径仍全部不存在或属于同一已知未完成journal；未知已有文件立即停止。新装时只允许root bootstrap install authorization根和`pending`，两者均为`0700`且不使用符号链接。
2. 核对repository、commit/tree关系和三个SHA；记录installer文件的owner/mode/hash，不从可写临时checkout启动。
3. 执行固定installer CLI；只保存去敏状态码、receipt摘要和创建路径metadata。
4. 验证launcher为root-owned单硬链接`0555`且摘要匹配；bundle目录/文件集合、mode、bytes和摘要完全匹配；install receipt/journal为root-only且phase为COMMITTED；pending授权已原子移入consumed。
5. 再次确认没有进程、systemd unit、网络监听、Docker/UAT/Volume变化，四服务restart/OOM仍为0/false。

安装过程中如出现PREPARED但未COMMITTED，禁止删除journal、bundle或consumed授权；只能在身份完全闭合时用同一内容寻址installer恢复同一事务。身份歧义时保全现场并停止。

### 5.4 回退边界

supervisor本身没有后台进程；没有pending release authorization时保持惰性。因此首要功能回退是停止签发`A2`授权并保留安装回执/审计字节。若必须恢复为安装前物理文件集合，须另行批准`A1-R`精确host清理或切换任务；首次安装没有previous launcher可自动切回，禁止在失败处理中临时`rm -rf`。已有版本升级时只允许通过新的内容寻址安装授权切到已验前一版本，保留journal和receipt。

### 5.5 最小确认句

项目负责人只有在愿意承担上述host文件变化时，才使用不含秘密的确认：

> 我专项授权`A1 HOST_SUPERVISOR_INSTALL`，仅安装当次执行单固定且在全部安全仓库变化收口后重新验证一致的最终source/manifest/bundle/installer/launcher；允许创建列明的root-owned路径和安装回执，不授权`A2`—`A8`、systemd、UAT、数据库、账号、网络或业务数据动作。

## 6. A2：正式本机发布证据与19步门

### 6.1 前置与影响

A2必须等TASK53生命周期合同、TASK59—TASK60/D-135—D-136快照及创建前target reservation合同、A1安装回执、最终源码匹配Web/Worker和A3不可变外部镜像引用全部通过。TASK53已建立“旧运行面保持不退化、隔离候选严格验证Worker health、部署后再独立严格验证”的失败关闭合同，TASK59—TASK60已建立独立detached快照、reservation/receipt/runtime绑定及锁内双重验证；当前阻断为当前镜像不存在、A1未安装且A3外部完整引用不存在。

TASK64当前快照输入为`0e2328b58bc68cf09dc6b0638bb5ded82b0cf347`/tree`585b3c8d1d38f695422c5378eaa24691627de932`，reservation、monitor projection、V2 policy activation及121文件Supervisor bundle合同已逐字节复核，但TASK65及剩余安全仓库变化仍会使它成为历史输入，故不得预签正式A2授权。最终A2必须由D-135/D-136工具在仓库外root-owned、不可组/全局写的固定根，以同设备私有staging和创建前0400 reservation建立locked detached worktree，并以不可变prepared receipt、receipt SHA-256和canonical借用runtime root绑定authorization；launcher先取得全局锁再VERIFY，wrapper在制品发布前复核。不得回退或切换共享主工作区，不得把更晚治理HEAD、branch、foreign target、旧audit或路径名冒充候选所有权；REMOVE只处理reservation/receipt证明的对象，quarantine默认永久保留。

A2允许在仓库外唯一artifact root生成正式镜像provenance、SBOM/security evidence、19步gate report和条件式UAT-class manifest；镜像参数必须使用A3批准私有registry的完整`repository@sha256:digest`引用，不能使用已删除loopback registry留下的`127.0.0.1:32776/...`引用。它允许按计划串行启动隔离测试容器和数据库，但不修改UAT/生产、不push外部registry、不读真实业务数据或四卷。

### 6.2 三个一次性动作

1. `A2-EVIDENCE / CREATE_IMAGE_EVIDENCE`：绑定独立候选worktree、snapshot receipt及其SHA-256、canonical借用runtime root、Web/Worker digest引用、artifact root、run ID和不超过72小时且扫描前后不变的固定Trivy数据库。失败时不进入下一步。
2. `A2-GATE / RUN_RELEASE_GATE`：绑定同一worktree、镜像及上一步正式SBOM/security文件；执行全部19步，任何fail/skip/todo、超时、资源阈值或临时资源残留都拒绝。
3. `A2-MANIFEST / CREATE_RELEASE_MANIFEST`：只有gate为PASS且所有证据仍新鲜才执行；deployment class固定为UAT，绑定同一commit/tree、镜像、Migration、plan/report及SBOM/security。不得预先创建或把失败候选标为ELIGIBLE。

三个动作各使用一份不同的root-only短时一次性authorization，并在执行前原子消费；项目负责人分别确认`A2-EVIDENCE`、`A2-GATE`和`A2-MANIFEST`，不得预签三份或在上一检查点尚未验收时自动生成下一份。任一检查点失败即停止，不向A6扩权；A3必须已经独立完成。

### 6.3 验收与回退

- 正式证据必须带bundle和authorization摘要，artifact为root-owned、无覆盖、单硬链接、只读合同；报告输入全部指向同一候选。
- 19步包含release/supervisor/credentials、完整Node/PostgreSQL/Browser/POSIX/typecheck/lint/Migration/backup-recovery/Python/Compose/source diff、镜像安全和六服务runtime policy；不得并行重任务。
- manifest只有`promotion_status=ELIGIBLE`且验证器复核通过才算A2成功。失败/REJECTED报告照常保留，不能改名或重跑覆盖。
- A2不改变运行面，因此回退是停止晋升、精确清理任务临时worktree/容器/测试库，保留镜像与不可变证据。删除失败报告或候选镜像不是自动回退。

最小确认句：

> 我专项授权`A2 FORMAL_LOCAL_RELEASE_EVIDENCE`，仅针对当次执行单固定且已由A3锚定的候选，允许installed supervisor按三检查点生成正式镜像证据、运行19步门并在全PASS时创建UAT-class manifest；不授权新的外部push、UAT/生产Migration/deploy、真实数据、账号或员工动作。

## 7. A3：外部源码与镜像恢复锚点

A3在A2之前执行，需要项目负责人指定：批准的私有Git目标、私有OCI registry/repository、数据驻留/访问责任人、保留策略和root-only短时凭据文件。TASK57对象已失效；必须先完成剩余安全仓库变化，再从最终source/manifest精确重建Web/Worker，并只锚定该同一源码和镜像对象。公开origin继续禁止接收内部历史，不得使用`latest`或可变tag作为唯一身份。

执行范围应分成源码与镜像两条可核验链：

- 源码：普通fast-forward push完整当前内部历史到批准私有远端；从第二受控上下文fetch并验证目标commit/tree及bundle source/manifest两提交关系。
- 镜像：只push后续A2将消费的同一Web/Worker对象，以版本+完整commit的私有tag和registry digest固定；认证返回、registry查询和重新按digest pull三方一致，匿名读取拒绝，凭据随后logout/撤销。

A3只建立私有恢复锚点，不得称为发布晋升；随后A2必须使用该外部完整引用重新生成正式镜像证据、gate和manifest。若先用loopback引用运行A2，再把同一digest推到外部repository，既有证据仍绑定旧完整引用且不能改写，必须全部重新签发。外部对象默认保留；撤销凭据是执行收口，删除远端commit/tag/manifest需新的破坏性授权。

最小确认句必须同时给出非秘密目标：

> 我专项授权`A3 EXTERNAL_IMAGE_AND_SOURCE_ANCHOR`，目标为“<私有Git名称>”与“<私有registry/repository名称>”，仅锚定A2同一源码和Web/Worker对象；凭据由root-only文件提供，不授权真实数据上传、UAT/生产部署或删除远端对象。

## 8. A4：真实四域异机备份与隔离恢复

A4必须拆成五个独立检查点，不接受一次“同意备份恢复”跨越真实数据外传与第三域写入。批准前先由项目负责人提供非秘密决策：

- 源deployment和维护窗口；与源主机不同故障域的接收位置；与源/接收方均不同的隔离恢复位置；
- 加密传输协议、密钥保管责任人、RPO、RTO、保留代数/时长、不可变策略、容量和失败告警；
- 允许读取的PostgreSQL、uploads、attachments、backup-status精确范围，以及执行人、观察人和恢复验收人；
- 集群角色/ACL的独立备份恢复方案。现有V2 logical dump明确`--no-owner --no-acl`，不能单独证明角色/ACL可恢复。

执行检查点：

1. `A4a DESIGN_AND_EMPTY_TARGETS`：只固定三个故障域、传输/加密、密钥责任、RPO/RTO、保留/不可变、容量、责任人和空root-only边界；不复制数据。
2. `A4b LOCAL_FOUR_DOMAIN_BACKUP`：只读固定实际数据库/容器/Migration/文件根身份和容量，建立root-only libpq service文件；在窗口内停止精确Web/Worker并确认没有替代writer，运行V2本机一致性备份，数据库guard、前后reconciliation及四域`LOCAL_VERIFIED`全部成功后才恢复writer。
3. `A4c ENCRYPTED_OFFHOST_TRANSFER`：以批准加密通道传输完整不可变代次，在接收机运行offhost verifier并取得`OFFHOST_VERIFIED`；真实数据离开源主机必须单独批准。
4. `A4d THIRD_DOMAIN_RESTORE`：从异机副本向第三故障域全新TEST目标恢复，核对Migration、表/记录、重复、孤儿、库存、关键金额、三个文件域摘要及RTO，取得`RESTORE_VERIFIED`；第三位置临时持有真实数据必须单独批准。
5. `A4e CONTINUOUS_AND_POST_PROMOTION_REVALIDATION`：先补自动传输、调度、保留和角色/ACL重建的仓库合同；A6后必须针对新runtime/Migration身份再完成一代A4b—A4d并验证连续两代、过期/失败告警和RPO/RTO，不能复用升级前回执冒充当前可恢复。

备份中断且guard存在时禁止手工删除fence或放开数据库；只在精确身份、零其他连接和原状态闭合后运行guard recovery。A4失败时不覆盖源、不把本机副本冒充异机、不删除成功/失败证据。

最小确认句：

最小确认必须分别使用`A4a`、`A4b`、`A4c`、`A4d`或`A4e`编号。例如当前最小的design-only确认是：

> 我专项授权`A4a DESIGN_AND_EMPTY_TARGETS`，允许按执行单核验并准备三个不同故障域的空root-only边界、RPO/RTO、加密/密钥、保留和责任人；不授权读取、复制、传输或恢复任何真实数据，也不授权账号、网络、UAT/生产或删除动作。

## 9. A5：host监控与真实告警

A5当前仍不能直接批准执行。TASK61—TASK64/D-137—D-140已经完成27文件内容寻址monitor bundle、三身份、七个固定unit/timer、root-only配置view、安装/已提交回退/停用保全事务、权威投影、V2 actual policy逐代激活和至少一次投递/远端精确ACK仓库合同，但仍缺：

- TASK62 producer与TASK64 policy activation虽已在仓库/合成隔离闭合，但host尚未安装或激活；缺权威源时必须保持`NOT_COLLECTED`，repository template不能替代actual；
- TASK65正在实现目标绑定、内容寻址且可effective验证的notifier出口策略；当前unit固定`IPAddressDeny=any`，禁止以手改unit或drop-in绕过；
- 实际host上的预建非特权账号、A1 Supervisor回执、Node runtime/config、systemd安装、重启持续和资源开销证据；
- 真实渠道非秘密目标、root-only凭据路径、值班主责/备份、升级表、确认时限、演练窗口和保留策略。

TASK65仍可在仓库和隔离环境安全推进；实际host安装和真实渠道必须由项目负责人分别提供外部输入及专项host/账号/systemd/网络授权。TASK61—TASK64测试通过不等于要求现在安装，也不等于真实告警已经可送达。

未来A5授权还需要项目负责人指定渠道类型/非秘密目标、值班主责/备份、确认时限、升级路径、演练窗口和凭据root-only路径，并拆成：

- `A5a DELIVERY_CAPABILITY`：只有TASK62、TASK64、TASK65目标绑定出口合同、A1及账号/systemd/网络专项授权都通过后，才在A6前安装monitor/timer/notifier并证明60秒采集、重启持续、逐类合成故障、真实测试/恢复通知、重复event幂等、pending重放及资源开销。旧alpha.42/0040、Worker health none、缺release/restore identity时应如实CRITICAL；A5a成功只证明告警能送达，不要求旧UAT绿色。
- `A5b CURRENT_IDENTITY_GREEN_WINDOW`：A6部署及A4e当前身份恢复后，重新绑定runtime/Migration/backup证据，确认健康窗口、恢复告警、ack与值班升级均匹配。旧备份回执因identity漂移不能用于A5b。

回退只允许指向唯一已有COMMITTED activation；停用只停止/禁用精确unit并记录保全摘要。Bundle、runtime、配置、state、pending、delivery、journal和receipt默认保留，物理清理始终需要新的破坏性授权。

## 10. A6：同候选UAT晋升与回滚演练

A6只有A2同候选`ELIGIBLE`、A3可拉取镜像、A4d升级前当前数据恢复回执、A5a告警交付能力及专用Migration角色合同均通过后才可批准。授权必须固定UAT deployment/database稳定身份、0040 current head、候选target head、维护窗口、执行/观察/业务验收人和rollback restore point。

受控检查点：

1. 只读预检并新建同窗口可恢复快照；验证从异机副本恢复仍可执行。
2. 停止精确旧Web/Worker，保留原镜像digest、Compose配置和运行metadata；确认无writer。
3. 使用manifest同一Worker镜像、专用Migration角色和release overlay执行0040→当次候选Migration head；任何身份或checksum漂移在SQL前拒绝。
4. 按digest部署Web/Worker及当次批准的release overlay。若本窗口不重建PostgreSQL或Caddy，就只能声明Web/Worker已晋升，不能宣称TASK50六服务运行时加固已全部部署；若要重建PostgreSQL或Caddy，执行单必须分别列明连接/证书影响、精确Compose动作、健康门和回滚，并由项目负责人明确包含在A6授权中。Worker租约必须自然切换，禁止手工改租约。
5. 验证PostgreSQL、Web、Worker为healthy，Caddy满足已批准入口合同，完整Migration、双卷探针、六服务`read_only`/capability/security-option实际metadata、restart/OOM、资源和告警全部符合本次声明范围；随后以独立一次性`VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY`授权执行`POST_DEPLOY_CURRENT_RUNTIME_STRICT`，发布不可变PASS回执并从其派生runtime identity v3。部署前报告或manifest不能替代该步骤。
6. 运行匿名、权限负向和核心只读技术验收；登录式UAT只允许当次授权的固定测试账号/范围。跨岗位业务写必须等待A7岗位批准和独立`A7e`写授权，不得把页面打开视为业务验收。
7. 明确协调现有`chenyida-erp.service`：默认保持其启停/enable状态不变；任何stop/start/restart/disable/enable均属于执行单显式影响，不能由Compose动作隐含取得。
8. A6技术验收后立刻进入A4e当前候选身份备份/异机恢复和A5b绿色窗口；在两者通过前，UAT候选不得进入员工试用。

Migration提交后不能靠down SQL原地降级。触发条件包括Migration/health/租约/数据核对/资源/告警失败；回滚必须停止新容器，从已验证快照恢复PostgreSQL与三个文件域，恢复原镜像/Compose并复核原head/身份。若恢复身份有歧义，保持隔离和停写，不猜测重启接流。

最小确认句：

> 我专项授权`A6 UAT_CANDIDATE_PROMOTION`，仅在A2、A4d与A5a证据仍有效时，对执行单固定的UAT、窗口和`ELIGIBLE`manifest完成快照、0040→当次候选head、列明范围的按digest部署、runtime identity、验收及触发式快照回滚演练；PostgreSQL/Caddy重建和`chenyida-erp.service`动作仅在执行单逐项列明时授权，不授权真实旧数据迁入、正式员工业务写或生产切换。

## 11. A7：真实数据、岗位权限与员工试运行

A7不是一个可一次打包批准的写动作，固定拆成六个独立检查点：

### A7a CURRENT_SOURCE_READONLY_INVENTORY

项目负责人先提供批准的SQLite/D1/附件快照、只读截止时点、数据责任人及snapshot/archive-only/post-cutover分类责任。只读分析必须输出逐行结果、重复、孤儿、单位、编码、库存、金额和文件摘要；业务冲突未人工处置前不得物化。随后在隔离目标做幂等试迁移、重复执行、全量核对和回滚演练；真实UAT迁入另开写授权。

### A7b BUSINESS_DISPOSITION

业务负责人逐项批准映射、archive-only、单位、库存/财务期初、附件和冲突处置；未决项继续失败关闭，历史处置只可用新记录supersede，不能静默改写。

### A7c REAL_TRIAL_MIGRATION

只向新建隔离PostgreSQL/文件目标物化。当前工具固定历史0017导入基线，仓库尚无“0017物化后连续升级到当前0046、重复执行、失败回滚并重新全量reconciliation”的证据；必须先由独立合成/隔离任务闭合。真实演练验收包括逐行结果、断点续跑、重复执行无重复、全量核对及快照回滚。

### A7d ROLE_MATRIX_APPROVAL

岗位负责人批准用户/岗位、最小权限、职责分离、财务可见域、管理员/break-glass、账号创建/首改/重置/停用、会话撤销和审计责任。当前服务端财务域事实为：admin/manager/finance/operations/warehouse可读AR+AP，sales只读AR，purchase只读AP；engineering/planning/production/quality虽有`finance.read`但普通列表为空，engineering另有本人负责项目财务摘要。上述范围未被业务负责人批准前不得启用真实员工账号；若批准结果不同，先改源码和负向测试。

### A7e CROSS_ROLE_UAT_WRITES

只允许命名合成对象、固定测试账号和明确业务写范围执行同候选跨岗正常/异常E2E；验收必须覆盖403、CAS冲突、幂等重放、重复提交、冲销、审计/request ID和预期数据库增量。清理使用业务冲销或已验快照，不直接删表/改已过账记录。

### A7f EMPLOYEE_PILOT

在同候选、同数据、恢复和监控均有效后，指定少量真实员工、业务样本、允许写范围、窗口和验收人。按脚本覆盖采购→收货/IQC→库存/AP、生产领退/报工/IPQC/完工、销售/FQC/出货/AR、付款/冲销及异常/越权/重复提交；每天复核备份、告警、审计、资源和问题清单。任何高风险问题停止试用并按已验方案恢复。

六类最小确认必须分别给出；不得用“同意A7”自动创建账号或允许业务写，也不得把密码发到聊天。

## 12. A8：正式切换与上线观察

A8只有A2—A7全部有当期证据、所有关键差异已修复/接受/指定责任人，且项目负责人批准正式窗口后才可执行。执行单至少固定：

- 旧系统停写/只读时点、最终增量边界、数据/附件责任人；
- 最终备份、异机接收与隔离恢复回执；
- 精确production deployment/database/manifest/images/Migration；
- DNS/入口、监控、值班、业务负责人、执行人、观察人和回滚指挥；
- 表/记录、重复/孤儿、库存、金额、文件、health、租约、审计、备份和关键业务验证；
- 可量化回滚触发器、最晚回滚时点和旧系统恢复写入条件。

正式切换是新的专项授权，不因UAT或试运行通过自动开始。上线后G10至少再次完成健康/告警、数据汇总、备份传输、恢复抽检和资源观察；触发器命中时按已验方案降级或回滚，保全全部审计。

## 13. 仍可安全推进的仓库任务

TASK53已完成首次晋升自锁修复，TASK54关闭原异机传输合同，TASK55—TASK56关闭cluster/runtime权限与恢复合同，TASK59—TASK60关闭detached snapshot及创建前reservation主合同，TASK61—TASK64关闭内容寻址monitor host delivery、权威projection producer、V2 actual policy及其逐代激活；TASK57镜像已因后续Site变化失效。在等待任何外部授权期间，以下台账仍必须区分已完成与开放项，不能直接宣布“只剩用户授权”：

1. `DONE / TASK54`：四域V2异机传输provenance、客户端加密、不可变接收/保留、非重入调度和失败恢复合同已在合成fixture与本机隔离目标完成；真实异机和当前数据仍未授权。
2. `DONE / TASK59`：A2独立detached candidate worktree的PREPARE/VERIFY/REMOVE、不可变回执、借用runtime、锁内多次验证和跨代quarantine守恒已在合成隔离Git中闭合；没有实际创建host候选或运行A2。
3. `DONE / TASK60`：同设备私有staging、创建前0400 reservation receipt、target root dev/inode/mode绑定、NOREPLACE同inode提升、Git前后验证和target-only精确恢复已在合成隔离Git中闭合；receipt前崩溃、inode替换、非空、跨设备或Git未保留inode均失败关闭。新78文件bundle已重建，镜像仍待全部安全仓库变化收口后统一重建。
4. `DONE / TASK61`：三身份、七unit/timer、内容寻址runtime、配置view、安装/回退/停用事务和精确ACK已在仓库/合成隔离闭合；未实际安装，notifier默认deny-all。其27/105文件历史bundle已由TASK62新链替代。
5. `DONE / TASK62`：installed Supervisor双入口从postdeploy与V4 recovery权威链生成root-only、最小去敏、单调、崩溃安全投影；27/113文件历史bundle已闭合但未安装，V1 policy actual按设计拒绝。
6. `DONE / TASK63`：不可变cluster recovery policy V2及V1/V4/runtime privilege兼容门已闭合，使actual不能由legacy或synthetic降级形成；repository template不是host active policy。
7. `DONE / TASK64`：V2 policy的内容寻址逐代ACTIVATE/ROLLBACK/RECOVER、intent/history/target/receipt/current耐久发布、保全式恢复及V4/monitor/installer联锁已闭合；当前121文件bundle未安装，真实policy未激活。
8. `DOING / TASK65`：实现target/generation绑定的notifier HTTPS出口、固定IP/host/SNI/effective unit证明及Supervisor激活/回退/恢复；只用合成离线目标，不发送真实通知或修改host/network。
9. `OPEN`：以机器源生成11角色→permission→API/data domain矩阵和路由覆盖负向合同，附业务批准状态；现有若干手写角色测试遗漏planning，不能替代完整漂移检测。
10. `OPEN`：以合成隔离数据证明历史导入基线0017物化后连续升级至当前0046，覆盖重复执行、失败回滚和升级后全量reconciliation。该任务改动候选输入后必须重建镜像/证据。
11. `DONE / TASK55—TASK56`：PostgreSQL cluster roles/ACL/default privileges、tablespace及运行角色确定性重建合同和隔离测试已闭合；真实数据库恢复/激活仍未授权。
12. `OPEN`：编制统一跨岗位UAT脚本、预期数据库增量、审计证据、冲销/快照回滚和员工签字模板；不创建账号或执行写操作。
13. `OPEN`：复核UAT晋升/快照回滚的逐检查点执行器是否存在失败关闭缺口；仅对合成Compose/隔离PostgreSQL实现测试，不部署UAT。

后续调度按对A1/A2、恢复和运行安全的影响选择最高优先级，保持一次一个正式任务编号。

## 14. 当前最小外部请求

当前不需要项目负责人立即批准host或数据动作：D-135—D-140快照、reservation、monitor host delivery、权威projection、V2 cluster policy及其逐代激活仓库合同已完成，但当前镜像已失效，A2仍被最终镜像、A1和A3阻断；A4真实链缺目标/策略/真实数据授权，A5a还缺TASK65出口、实际安装、账号/systemd/网络授权和值班输入。持续交付负责人已按第13节第8项启动TASK65，再按依赖处理其余开放仓库任务。项目负责人若愿意并行准备非秘密外部信息，最小输入仍是A4a的三个故障域/RPO/RTO/加密/保留/责任人，未来A3的私有Git/registry目标名称，或A5a渠道类型/非秘密目标与值班责任人；密码、Token和密钥仍只放root-only文件，不发聊天。

第一个host变更请求最终仍是A1，但须等全部安全仓库变化收口并重建最终bundle/镜像后才请求；在此之前系统安全保持：UAT继续alpha.42/0040、历史候选和诊断证据只读保留但不可授权、正式入口失败关闭、无真实员工使用。

无论等待多久，以下结论不变：没有真实异机恢复、正式同候选门、host监控投递、UAT对齐、真实迁移和员工签字前，晨亿达ERP不能宣布可落地投入使用。
