# 晨亿达ERP变更日志

本文件记录可审计的项目变化。每个任务提交前必须增加一条记录，包含 Git Commit、功能、数据库、API 和文档影响。当前提交无法在自身内容中稳定写入自身哈希，因此使用“任务编号 + 提交消息”作为本条标识，实际哈希以 `git log` 为准。

## 2026-08-25

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: verify isolated UAT source snapshot`

- 第一性原理：单一小团队UAT只增加一个stage-1 policy、标准库-only verifier和专项负测；不修改冻结v1—v6、D-183或one-shot，不新增v7、daemon、队列、服务、临时payload publisher或按职能人数硬编码容量。
- 真实文件系统观察：CLI固定绝对bootstrap路径和`/usr/bin/python3 -I -S -B`，不接受caller source root。从`/`逐组件dir-FD打开，目录/文件必须root所有且不可group/other写；文件还必须regular、`nlink=1`、同device、有界，读取前后完整identity一致。Symlink、双前导斜杠、可写路径、wrong owner、FIFO、hardlink和读中变化失败关闭。
- 单向摘要链：先固定核对D-184 policy raw/internal，再核对D-183 policy raw/internal/closure、D-183 validator raw和全部83成员hash；只有83成员共`2,092,585` bytes全部通过，才从已验validator bytes执行一次D-183完整语义校验。Bootstrap raw为`ccb9365c…a9c5`，policy内部/raw为`c5359216…2a45`/`708c96cc…cf1a`；bootstrap raw只作为下一外部锚输入。
- 诚实停止线：Stage-1不导入one-shot且`require_execution_handoff()`固定失败；输出明确`NOT_EXECUTED_BY_THIS_BOOTSTRAP / PRIOR_PROCESS NOT_ATTESTED / BOOTSTRAP IDENTITY NOT EXTERNALLY ATTESTED / NOT PUBLISHED`。Bootstrap、CPython/stdlib和direct one-shot未建立known-good关系，不能称`TRUSTED_PRE_IMPORT_ENFORCED`或UAT可试运行。
- 测试/复核：D-184专项10/10，完整聚合`5+13+7+16+13+15+11+12+10=102/102`；隔离Compose policy/config连续两次双PASS。AST锁定标准库import、模块顶层调用及唯一verified-byte `compile/exec`；policy/validator/member自重签、最后成员漂移和payload sentinel均在validator/payload执行前拒绝。三路最终只读复核为P0=0/P1=0/P2=0。
- 资源：08:24→08:46 available memory `2,147,934,208 → 2,125,922,304`B，Swap `180,957,184 → 182,300,672`B（+`1,343,488`B），根盘available `17,484,529,664 → 17,505,542,144`B，Load `0.46/0.22/0.25 → 0.36/0.34/0.29`，Memory PSI/OOM0。Docker保持6/75/277/6；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整；任务fixture、pycache及精确临时报告残留0。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；未创建或访问UAT目录、Secret、证书、容器、网络、Volume、数据库、备份或业务数据，未build/deploy/Migration/restart/账号/HTTP-TLS探针/业务写。测试fixture在安全父目录串行创建并自动清理，bootstrap验证本身只读。
- 文档：新增D-184并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一独立切片把外部内容寻址bootstrap锚/原子publisher与same-verified-bytes只读handoff合并处理，仍不开放execute。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: validate isolated UAT action source closure`

- 第一性原理：单一小团队UAT只增加独立派生policy、一个纯validator和静态负测；不建设依赖平台、daemon、队列、服务或按工程/计划/市场“各2人”硬编码容量，也不修改冻结binding v1—v6或新增v7。
- 声明闭包：从固定v3—v6 raw锚点重建九动作目录，固定54个action source引用、21个直接root和83个成员。成员由control 29项source、package、Migration journal、46个SQL Migration、`runtime-secret.ts`和5个传递ESM模块组成；descriptor/validator不加入payload，避免自引用摘要循环。
- 依赖验证：精确核对8个Python模块/8条固定模块装载、3个TypeScript成员/2条本地import、8个ESM成员/23条本地import、Compose→Caddyfile资源边、46项journal顺序、成员usage/hash/path及完整可达性。JS动态import/require/re-export、Python间接导入、生产runner、异常JSON、bool/int混淆和自重签source漂移失败关闭。
- 摘要：policy内部/closure/raw为`a85d6abbad072ce5981690f0e266b3b657beb3a707f7ca04db96d97d0bb52d11`/`19e518819ede89a2b5ad4925d0c71b27fa2b5bba41759ffb0e51e90bd7cc0fb3`/`7c2a22928c5c80dc21ee21fc8cc99693a480717b7a76f39c4f9b784663c680a8`；validator/test/runner raw为`f4705be0…81ad`/`5efbc604…ad8b`/`37e19d8c…ef6`。v1—v6 raw SHA保持不变。
- 诚实边界：成功只证明调用方注入bytes在固定code-import/control-read/Migration数据集内闭合；不证明filesystem attestation、runtime filesystem I/O、Python/Node/Docker实现、OCI内容、publisher/backend或执行授权。当前one-shot导入固定模块早于该派生证明，trusted pre-import仍明确未实现；生产privilege ESM仅作reference primitive。
- 测试/复核：D-183专项12/12，完整聚合`5+13+7+16+13+15+11+12=92/92`；隔离Compose policy/config连续两次双PASS。Shell语法、严格JSON、直接policy、冻结v1—v6摘要及`git diff --check`通过；两路最终独立只读复核均为P0=0/P1=0/P2=0。
- 资源：07:33→08:02 available memory `2,209,591,296 → 2,185,998,336`B，Swap `171,536,384 → 178,974,720`B（增长7,438,336B；10秒`si/so=0/0`），根盘available `17,541,615,616 → 17,579,905,024`B，Load `0.25/0.10/0.07 → 0.80/0.53/0.31`，PSI/OOM0。收口为6容器/75镜像/277 Volume/6网络；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整，任务pyc/临时目录0。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；未创建或访问UAT目录、Secret、证书、Docker资源、数据库、备份或业务数据，未build/deploy/Migration/restart/账号/HTTP-TLS探针/业务写。
- 文档：新增D-183并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一独立切片只处理固定trusted pre-import source verification/bootstrap，再分别处理publisher、runtime observer/backend和精确镜像，不自动运行。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: bind isolated UAT Caddy host and SNI`

- 第一性原理：不到20人的单一同机UAT只增加localhost Host/SNI纯合同和既有one-shot的声明式v6扩展；没有引入DNS、证书平台、探针服务、队列、多租户控制面或人员基数配置。
- 静态配置：隔离Web Public Origin由production-mode下无效的HTTP直连改为`https://localhost:<Caddy HTTPS发布端口>`；Caddy显式固定`ERP_DOMAIN=localhost / ERP_HTTPS_PORT=443`。Compose validator精确核对四个应用服务的HTTPS Origin、Caddy环境和端口，HTTP Origin及漂移失败关闭。
- Host/SNI合同：新增policy和纯模块，固定连接`127.0.0.1`、HTTP authority/Host、TLS SNI和Origin host均为`localhost`；未来HTTPS观察必须验证受信链及精确DNS name，禁用insecure skip verify、runtime DNS、proxy环境和redirect following。模块不具备HTTP/TLS/Docker/进程/时钟/Secret/publisher能力。
- Evidence intent v2：完整重验D-178 evidence v1，并携带active v6、owner v5、external/receipt v4三个完整计划对象；固定角色/合同/摘要、v6→v5→v4确定性投影，以及request/project/ports/policy/source/Compose/Web/Worker镜像对基础证据的连续性。状态明确为`FULL_ACTIVE_PLAN_SEMANTICS_NOT_REVALIDATED`，不冒充九步全动作closure。
- 失败关闭加固：所有公开builder/validator重新验证固定policy和调用方注入source bytes；D-178/D-179固定upstream raw、source closure member和注入bytes必须三方一致。独立复核发现的upstream自重签P1已修复并加入负测；plan swap/digest swap、伪policy、source/image漂移、畸形类型、非有限值、深嵌套和非法surrogate均稳定拒绝。
- Binding/摘要：v6 body/raw为`f1a3fd38d0a49eea284caa704016d92de336e2eafb4d46a4fd23c59113266dc5`/`459bb65d42c71551797bf4cbf56a022700780caeb8a3d987b51bd96560d9f1f0`，v1—v5 raw字节保持不变。Host policy内部/raw/closure/module为`dad404da…3010`/`c3edf759…f39a`/`cde30bd6…cedc`/`53283460…a6ff`；one-shot raw及control内部/raw为`5ec47d3c…a674`、`b9fabb5e…ade8e`/`a4809ee3…67f0`。
- 测试/复核：控制5/5、one-shot 13/13、runtime contracts 7/7、runtime receipts 16/16、external anchors 13/13、owner completion 15/15、Host/SNI 11/11，共80/80；隔离Compose policy/config连续两次双PASS。严格JSON、Shell语法、冻结v1—v5摘要、摘要闭包和`git diff --check`通过；两路修复后独立只读复核均为P0=0/P1=0。
- 资源：02:00→02:07最终门前后available memory `2,210,680,832 → 2,199,441,408`B，Swap `181,915,648 → 185,536,512`B（增长3,620,864B），根盘available `17,697,169,408 → 17,684,115,456`B，Load `1.16/0.79/0.46 → 0.44/0.57/0.48`，kernel `oom_kill=0`。Docker保持6容器/75镜像/277 Volume/6网络；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整。精确清理本任务3个`.pyc`后，任务pyc和Compose临时目录残留0。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；未创建或访问UAT目录、Secret、证书、容器、网络、Volume、数据库、备份或业务数据，未build/deploy/Migration/restart/账号/HTTP-TLS探针/业务写。
- 文档：新增D-182并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一独立切片只处理九步全动作传递source closure，再分别处理publisher、runtime observer/backend和精确镜像，不自动运行。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: validate isolated UAT owner completion`

- 第一性原理：不到20人的单一内部UAT只增加一份owner completion policy、一个纯validator和binding/plan v5；不建设证据平台、队列、daemon、多租户控制面，也不把工程、计划、市场等人数写入合同。
- 固定上游重验：owner入口不接收可自签的D-179/D-180 validation envelope，而从原始外锚、四类intent、八类receipt和五类evidence调用固定D-180/D-179模块重验。External policy必须等于owner source closure内固定raw，source usage按path精确锁定。
- Owner连续性：固定同一operation/request/project、active v5与base v4双摘要、namespace/credential/container/cluster/database/Migration/runtime privilege前驱和`operator_state_root`准备/完成identity。正常成功只接受六阶段journal、空recovery authorization及`COMPLETED/VERIFIED`终态；`final_privilege_projection_sha256`不冒充生产structure report。
- 失败关闭：external anchor→Migration→owner→runtime observation/receipt→verification的因果时间不可倒置；自签v99 observation、privilege policy、external policy、plan、source usage、state root、phase、terminal或摘要混用均被拒绝。
- Binding/plan：v5 body/raw为`349fb247d271d3c749129c151ebb0b3c7054b64f5ee0c5646ea9e1d238c49c3f`/`95bbf9a263818886072a29f486a53acb752687dcd4d5cd086283336dcbb77363`；显式路由active v5控制摘要和v4 legacy receipt摘要，完整声明action 7/9输入、三个runtime束组、validator参数映射及四步验证顺序。v1—v4 raw字节不变。
- 诚实边界：成功仍固定`SOURCE_CALLER_INJECTED_NOT_ATTESTED / AUTHORIZATION_NOT_ESTABLISHED / NOT_PUBLISHED / NOT_ESTABLISHED_BY_PURE_VALIDATION`；publisher、runtime observer/backend继续固定失败。纯合同PASS不表示宿主已观察、UAT已创建或运行证据已发布。
- 摘要：owner policy内部/raw/closure为`47d70021…87d0`/`e86831d5…5cf5`/`4238653e…055b`，module/one-shot/control policy内部/raw为`1a6d2848…9c17`/`0ce8417f…d198`/`a62a9664…2681`/`013d50d6…549b`。
- 测试/复核：控制5/5、one-shot 13/13、runtime contracts 7/7、runtime receipts 16/16、external anchors 13/13、owner completion 15/15，共69项Unit及隔离Compose policy/config双PASS；`git diff --check`通过。两路最终独立只读复核均为P0=0/P1=0。
- 资源：00:52→01:00收口静态门前后available memory `2,262,908,928 → 2,247,430,144`B，Swap保持`180,166,656`B且10秒`si/so=0/0`，根盘available `17,742,811,136 → 17,757,143,040`B，Load `0.14/0.20/0.20 → 0.53/0.38/0.27`，PSI/OOM0。Docker保持6容器/75镜像/277 Volume/6网络/0 Cache，四服务ID不变、restart0/OOM false且保护卷完整；Compose `ps`在未注入`ERP_DEPLOYMENT_CLASS`时严格拒绝插值，改用只读Docker metadata核对；任务`.pyc`/Compose临时目录残留0。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；未创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产数据。
- 文档：新增D-181并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一独立切片只处理Caddy Host/SNI纯intent/contract，再处理全动作closure、publisher/runtime backend和精确镜像，不自动运行。

## 2026-08-24

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: validate isolated UAT external anchors`

- 第一性原理：少于20人的单一隔离UAT只增加一份external anchor policy、一个纯函数validator和binding/plan v4；不建设证据服务、队列、daemon、多租户控制面，也不把工程、计划、市场等人数写入基础设施合同。
- 外部合同：严格验证同一plan下七类namespace root、从`/`起的完整ancestor/mount身份、七份不含Secret正文或内容摘要的普通凭据文件metadata、PostgreSQL容器完整network/port/mount/tmpfs集合及cluster system identifier投影，并输出四个external digest anchors。
- 失败关闭：祖先必须root所有且不可group/other写；directory/regular-file、非symlink、mount point/root/source及`device+inode`唯一性固定。生产保护mount、双前导斜杠、`..`组件、跨mount-ID别名、FIFO凭据、额外网络/端口/bind、生产Volume、Secret挂载和镜像config漂移均进入负测。
- Binding/plan：v4 body/raw SHA为`fb83e0f2…b050b`/`4858b8c1…34262`，以`EXACT_NO_OVERRIDE`继承v3九动作/18节点，只增加external policy/validator source及五外层节点/四anchor映射；v1—v3 raw字节保持不变。执行validator常量锁定runtime policy/closure/capability、receipt policy/closure/capability/success template和完整chain binding。
- 诚实证据边界：成功只允许`PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID / SOURCE_CALLER_INJECTED_NOT_ATTESTED / AUTHORIZATION_NOT_ESTABLISHED / NOT_ESTABLISHED_BY_PURE_VALIDATION`。外锚尚未与D-179在运行时机械join，publisher/backend继续固定未实现；纯合同通过不表示宿主已观察、UAT已创建或运行证据已发布。
- 摘要：External policy内部/raw/source closure为`66afa1ee…9a6b`/`92c59a9f…6ef3`/`4452221d…aff4`，module/one-shot/control internal/raw为`fc6e76d4…be61`/`8cd1a345…b7f7`/`9a09a3f1…d6c8`/`45bdf961…b83c`；20项control source binding全部匹配，摘要依赖为无环DAG。
- 测试/复核：控制5/5、one-shot 12/12、runtime contracts 7/7、runtime receipts 16/16、external anchors 13/13，共53项Unit及隔离Compose policy/config双PASS；shell语法、摘要DAG和`git diff --check`通过。两路最终独立只读复核均为P0=0/P1=0，一路1342个逐字段变体为0绕过/0异常泄漏。
- 资源：21:42→22:52 available memory `2,363,518,976 → 2,256,683,008`B、Swap `179,556,352 → 179,613,696`B、根盘available `17,812,017,152 → 17,746,034,688`B、Load `0.03/0.35/0.25 → 0.23/0.20/0.22`，PSI/OOM0。Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整；精确清理5个任务`.pyc`后任务残留0。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；未创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产业务数据。
- 文档：新增D-180并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一独立切片只补owner完成日志纯合同，再处理Host/SNI和全动作closure，不自动运行。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: validate isolated UAT receipt chain`

- 第一性原理：单一小团队UAT只需要固定、可审阅的回执链，不建设通用证据平台。本切片新增一份receipt policy、一个无运行能力的纯validator和binding v3；不增加队列、daemon、服务、多租户或人员基数配置。
- 回执语义：严格验证database target/bootstrap、release candidate、Migration execution、runtime privilege、readiness、postdeploy及runtime identity八类回执和五类证据体；固定producer、project/request/operation、数据库身份、46项allowlist/applied ledger、五角色完整属性、ACL、release/image、容器网络/health、loopback、时间和前驱摘要连续性。
- 失败关闭：控制请求和回执层均拒绝全零Git、Compose与OCI摘要；策略摘要的非字符串值及深层恶意嵌套都转换为稳定合同错误。跨项目/跨意图拼接、自洽policy/receipt重签、局部证据重签、过期重放、非法Unicode、PostgreSQL OID/system identifier越界、全零容器身份、重复容器ID、角色或镜像漂移均被拒绝；链龄从bootstrap observation起上限1小时、future skew 300秒，调用方不能注入任意intent validator或自选expected binding SHA。
- Binding/plan：新增v3及18节点predecessor目录，body/raw SHA为`50ddd73fb4745c8fcc0b91fd7e4130e2cb3a9ef0d2f52773c64cd6112afc74bd`/`da69ce3a276ef68f9f6cece12f281ea89584930d481afef19fcf930dae8de5c4`；receipt policy同时钉住两者，one-shot升级plan/v3。计划只输出`runtime_receipt_validation_status=NOT_RUN_NO_RECEIPTS`和成功输出合同模板，不把未运行结果写成validation output；返回前二次读取source state并拒绝并发漂移。历史v1/v2 raw SHA保持`3244d550…7b3a`/`9cc4e3c1…5232`。
- 诚实证据边界：成功状态只为`VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS`；四个业务external anchors和control plan固定`NOT_EVALUATED`，verification time固定`CALLER_INJECTED_NOT_ATTESTED`，runtime evidence固定`NOT_ESTABLISHED_BY_PURE_VALIDATION`。三个dependency policy raw SHA由执行validator常量固定，receipt expected roots仍明确来自调用方；合成fixture不是运行证据。
- 能力停止线：全动作传递closure、atomic publisher及host/Docker/PostgreSQL/HTTP backend仍为`NOT_IMPLEMENTED`；`require_receipt_publisher()`固定失败关闭。`deployment_authorized=false`、空运行动作和生产入口禁用不变。
- 摘要：receipt policy内部/raw/source closure SHA为`58c34e46…9f6e`/`1eee47ed…7aac`/`0a343c32…90d8`，control policy内部SHA更新为`d899da83…68d2`；Migration allowlist/applied ledger SHA为`8bb2b2d6…8eed`/`e4a7bc4b…6a34`。
- 测试：控制请求5/5、runtime contracts 7/7、runtime receipts 16/16、one-shot 11/11，共39项Unit PASS；聚合runner输出`ISOLATED_UAT_ONE_SHOT_TEST_PASS`，隔离Compose policy/config双PASS。
- 资源：19:09→20:05静态段available memory `2,395,295,744 → 2,338,922,496`B、Swap `179,580,928 → 179,576,832`B、根盘available `17,755,828,224 → 17,713,516,544`B、Load `0.01/0.04/0.09 → 0.58/0.39/0.32`，Memory PSI和kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络；四服务restart0/OOM false，Web/PostgreSQL healthy。精确删除本段生成的2个`.pyc`后，任务pyc和Compose测试临时目录残留均0；未清理任何历史或运行资源。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；未创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产数据。
- 文档：新增D-179并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一切片是external anchor/owner日志/Caddy Host-SNI validator与全动作closure，再到publisher/runtime adapter和精确镜像，不是运行部署。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: define isolated UAT runtime contract intents`

- 第一性原理：不到20人的单一隔离UAT不建设通用工作流/多租户平台。本切片只增加一份runtime contract policy、一个纯函数模块和内存fake ports；不增加daemon、队列、服务或人员基数配置。
- 三族意图：database-bootstrap固定标准UAT数据库marker/system identifier和五角色独立凭据映射；Migration固定alpha.47、`EMPTY → 0046`/46项allowlist和release source；evidence固定四容器、loopback、Compose/source及GID`65532`。产物只标记`STRUCTURE_VALID / NOT_EXECUTED / NOT_PUBLISHED / NOT_AVAILABLE / predecessor NOT_VALIDATED`。
- 诚实能力边界：future receipt只有`INCOMPLETE_DESCRIPTOR_ONLY`字段目录，真实validator、publisher和runtime backend均`NOT_IMPLEMENTED`。fixture固定`SYNTHETIC_CONTRACT_FIXTURE_ONLY`，不生成真实回执或证明前驱摘要链。
- Source closure：纯模块为唯一root，无仓库内传递import，固定raw SHA和标准库import allowlist；validation scope明示`NOT_A_SANDBOX`。binding v1/v2字节不变，v2继续只声明`DIRECT_CONTRACT_REFERENCES_ONLY`，未冒充九步全动作closure。
- 合成/执行门：三个typed fake ports覆盖逐步异常、重签畸形字段、自洽重签intent、非法source/import扩张、跨族source漂移和输入别名，全部首错停止。one-shot新增字段后明确升级为plan/v2并绑定runtime policy/closure摘要；`execute`在真实唯一backend seam之前继续精确拒绝，backend调用0。
- 摘要：runtime contract policy/closure SHA-256为`5f24335aa436309427465b6cb1c5c7ecb3778f0945f3d7ed48598008a0456586`/`978741a0bf244cd40076cca49fbedd0a3e3045e047b795c488e40a40436bc939`，control policy SHA-256更新为`dd442418af220070b133063ea555dde0a1e1b4cfcc266ad1aa1706829b5c6150`；binding v1/v2 raw SHA保持`3244d550…7b3a`/`9cc4e3c1…5232`。
- 测试：控制请求4/4、one-shot 10/10、runtime contracts 7/7、隔离Compose policy/config双PASS；覆盖zero/stale SHA、角色凭据漂移、标准marker、非法head/loopback、全局alias和执行前零backend。
- 资源：18:31→18:50静态段available memory `2,399,928,320 → 2,383,667,200`B、Swap `179,617,792 → 179,580,928`B、根盘 `17,775,542,272 → 17,746,591,744`B、Load `0.05/0.09/0.08 → 0.62/0.33/0.21`，PSI/OOM0。Docker保持6容器/75镜像/277 Volume/6网络，四服务restart0/OOM false且Web/PostgreSQL healthy；本任务`.pyc`/临时资源0，既有26个历史UAT promotion目录和历史pycache保持不动。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖、员工角色或运行配置变化；没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产数据。
- 文档：新增D-178并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一切片是完整receipt semantics/validator、前驱摘要链和binding v3接线，不是运行部署。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: correct isolated UAT execution order`

- 审计结论：实现runtime adapter前的两项并行只读审计确认D-176 v1存在P0物理冲突：空库不能先做0046完整对象ACL，生产v3 identity也不能在Caddy/Web/Worker真实身份和postdeploy receipt产生前发布；生产runtime policy/supervisor语义不得冒充隔离UAT证据。
- 版本处理：D-176的`isolated-uat-one-shot-action-bindings-v1.json`原文件和body SHA保持不变，仅作历史证据；新增v2并由one-shot入口切换使用。v2 body SHA-256为`6f28881beb767f25e469b60f6ef9ae15e62d703659619ce3e7c8aa63e76d463a`，状态为`FIXED_BINDINGS_DEPENDENCY_ORDER_CORRECTED_RUNTIME_PATH_NOT_IMPLEMENTED`。
- v2顺序：精确输入→七类namespace roots→独立凭据→仅PostgreSQL→数据库身份/登录角色→`EMPTY → 0046`→最终runtime privilege reconcile→Caddy/Web/Worker→隔离UAT专用postdeploy/runtime identity evidence。第5步不再假称空库已有完整ACL，第9步不复用生产release identity合同。
- 精确输入：新增`one_shot_state_root`；reader GID由policy机械绑定Web主GID`65532`，不是人数/席位；package version/git显式进入Compose启动输入，以供strict readiness使用。Policy SHA-256更新为`2197a633db282423f40ba0ac22e94dc27206bca6ed20f8eb332165811eac6271`。
- 诚实停止线：v2不再把完整privilege原语冒充空库database-bootstrap，也不再把现有生产受控/临时TEST Migration入口列为UAT实现来源；当前只摘要动作列出的直接合同source，专用database-bootstrap/Migration/evidence合同、传递依赖闭包和host filesystem、Docker/Compose、PostgreSQL、HTTP、证据发布typed ports均未实现。`execute`继续在任何副作用前返回拒绝；fake adapter PASS也不得描述为真实backend可执行。
- 测试：控制请求4/4、one-shot 9/9、隔离Compose policy/config双PASS，runner Shell语法通过；覆盖v1不改写、角色初始化/Migration/最终ACL顺序、四服务身份后置证据、GID/source drift和执行前拒绝。
- 资源：16:09→16:42静态段available memory `2,395,615,232 → 2,395,176,960`B、Swap `179,658,752 → 179,642,368`B、根盘 `17,809,903,616 → 17,764,696,064`B、Load `0.05/0.29/0.24 → 0.62/0.29/0.18`，PSI/OOM0。Docker保持6/75/277/6、Cache0，四服务restart0/OOM false且Web/PostgreSQL healthy，四个保护卷完整；本任务临时目录/pyc残留0，8月15—16日既有26个UAT promotion临时目录与历史pycache保持不动。
- 代码/数据：无产品业务代码、Schema、Migration、API、页面、依赖或员工角色变化；没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产数据。
- 文档：新增D-177并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`；下一切片是专用database-bootstrap/Migration/evidence合同、source闭包和注入式合成adapter，不是运行部署。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: bind isolated UAT one-shot actions`

- 第一性原理：不为不到20人的单一UAT建设通用编排平台；只把D-175九步顺序锁定到可审阅的方法和现有原语，同时诚实保持runtime adapter未实现。人数、岗位约2人和席位不进入合同。
- Binding：新增`isolated-uat-one-shot-action-bindings-v1.json`，九项动作各有唯一`handler_id + adapter_method + sources + inputs + outputs`；body SHA-256为`b5b3a7eb5a1a782290e2a37c5fed0ae8e09230696ae9da26d80398b0b2070276`，状态固定为`FIXED_BINDINGS_RUNTIME_ADAPTER_NOT_IMPLEMENTED`。
- 执行边界：目录和验证器禁止shell、自由argv及生产runner/supervisor；Migration同时产出release candidate与执行回执，release identity消费两者，Web/Worker只能在identity后启动。`execute`仍在任何副作用前拒绝。
- Policy：所有binding source纳入control policy摘要，policy SHA-256更新为`01e35bd96971b45cf596767d7db7c554fd93225ec4c68223e092119c736ecb47`；`deployment_authorized=false / runtime_actions_authorized=[] / CONTRACT_ONLY_NOT_EXECUTABLE`不变。
- 测试：控制请求4/4、one-shot 7/7、隔离Compose policy/config双PASS；覆盖受policy绑定source、无shell/argv/人员字段、跨步依赖、生产入口禁止和重算摘要后篡改仍失败关闭。Shell语法、`git diff --check`和针对性凭据模式扫描通过。
- 资源：15:55→16:05静态段available memory `2,449,465,344 → 2,445,877,248`B、Swap保持`179,671,040`B、根盘 `17,836,396,544 → 17,830,621,184`B、Load `0.00/0.08/0.13 → 0.85/0.50/0.26`，PSI/OOM0。Docker保持6容器/75镜像/277 Volume/6网络/0 Cache，四服务restart0/OOM false且Web/PostgreSQL healthy，保护卷完整；测试临时目录和本段新增`.pyc`为0。
- 代码/数据：无产品代码、Schema、Migration、API、页面、依赖或员工角色变化；没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产数据。
- 文档：新增D-176并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`，下一缺口为专用runtime adapter的合成隔离测试和当前源码精确Web/Worker镜像；新UAT仍未创建、不能试运行。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: add isolated UAT one-shot plan`

- 第一性原理：不复制生产supervisor、不建设通用多租户编排器；先把单个隔离UAT真正需要的顺序机械固定，同时让无L2a授权的入口保持零副作用。
- 入口：新增`isolated-uat-one-shot.py`。同一D-174 request确定性生成九步规范JSON计划与`plan_sha256`；默认命令只读，不创建目录、不读取Secret值、不连接Docker或数据库。
- 执行门：当前policy继续`deployment_authorized=false / runtime_actions_authorized=[] / CONTRACT_ONLY_NOT_EXECUTABLE`；`execute`在输出计划或调用执行器前固定返回`ISOLATED_UAT_ONE_SHOT_EXECUTION_NOT_AUTHORIZED`。
- 隔离：九步仅表达输入、root、凭据、PostgreSQL、既有权限原语、`EMPTY → 0046`、release identity、Web/Worker及loopback核对的技术依赖；不含人员、席位、账号或并发基数。生产supervisor/runner只在禁用清单中。
- Policy：one-shot入口加入source binding；control policy SHA-256更新为`bc507050de94470f722a1d11cfc06370ee6f8e379d446a89e2c17405d404ecab`，授权状态和既有业务/数据库合同不变。
- 测试：原控制请求4项Unit和新入口5项Unit全部PASS；覆盖默认只读、确定性/摘要、执行前拒绝、非法动作、计划篡改、生产入口隔离和无staff字段。Shell语法及`git diff --check`通过。
- 资源：10:02→10:09静态段available memory `2,432,094,208 → 2,449,072,128`B、Swap保持`179,748,864`B、根盘 `17,864,470,528 → 17,874,239,488`B、Load `0.07/0.21/0.20 → 0.29/0.26/0.21`；PSI/OOM0。Docker保持6容器/75镜像/277 Volume/0 Cache，四服务restart0/OOM false且保护卷完整，临时目录/pyc残留0。
- 代码/数据：无产品代码、Schema、Migration、API、页面、依赖或员工角色变化；没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，未build/deploy/Migration/restart/账号/业务写，也未访问现有UAT或生产数据。
- 文档：新增D-175并同步MASTER、TASKS、PROJECT_CONTEXT、当前任务、STATUS和CHANGELOG。TASK92继续`DOING`，下一缺口为固定动作执行绑定与当前源码精确Web/Worker镜像；新UAT仍未创建、不能试运行。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: define isolated UAT control request`

- 第一性原理：生产release supervisor和`ACTUAL_CONTROLLED` PostgreSQL runner继续生产专用；不为单个小团队UAT参数化或复制完整生产控制面。新增D-174，后续只允许一个专用one-shot UAT入口。
- Policy：新增`chenyida-erp-isolated-uat-control-plane-policy/v1`，SHA-256为`cd52627b3a27952f1cf7556c93a6d8c93b4e5404b01203e459aae8ce610a7b61`；固定`deployment_authorized=false`、空运行动作和`CONTRACT_ONLY_NOT_EXECUTABLE`，静态PASS不构成L2a授权。
- Namespace：同一可配置项目名派生runtime Secret、operator credential、release candidate/identity、operator state和synthetic backup六类root；生产受保护root和相互重叠失败关闭，共享global lock只作串行协调。
- 角色/Secret：复用Admin、Backup、Owner、Web、Worker五个技术数据库登录角色及既有reconciler/journal原语；六份runtime Secret和独立backup capture service精确映射。员工人数、各职能约2人和总席位不进入合同。
- 精确输入：机械重算alpha.47、46项Migration、`EMPTY → 0046`及allowlist `8bb2b2d6…8eed`；未来请求还必须绑定Git commit/tree、Web/Worker registry/config digest和resolved Compose SHA-256，浮动tag或旧head被拒绝。
- 测试：policy CLI与4项Python Unit PASS，覆盖9类负例：生产项目/root、旧Migration、浮动镜像、运行动作、source/角色漂移、重复JSON key及人员数字段。Compose消费者静态合同回归保持PASS。
- 资源：静态段起点约2.3GiB available/171MiB Swap/17GiB磁盘/Load`0.21/0.20/0.18`，收口为`2,445,348,864`B/`179,769,344`B/`17,871,294,464`B/`0.03/0.11/0.15`；PSI/OOM0，6容器/75镜像/277 Volume/6网络/0 Cache，四服务restart0/OOM false且Web/PostgreSQL healthy，任务临时资源0。
- 配置/文档：非Secret UAT示例补充operator credential/state和synthetic backup root；同步MASTER、TASKS、PROJECT_CONTEXT、DECISIONS、当前任务、CHANGELOG和STATUS。产品代码、Schema、Migration、API、员工角色和依赖不变。
- 生产保护：没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份；未build、deploy、Migration、restart、账号或业务写，未访问现有UAT/生产数据。专用adapter和精确当前镜像仍缺失，TASK92继续`DOING`。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: add isolated UAT Compose contract`

- 路径决定：项目负责人选择当前主机同机隔离并接受同一故障域；不同时建设独立主机方案。人数、岗位约2人和总用户少于20人不进入项目名、端口、容量、账号或验收硬条件。
- Compose：新增`compose.uat-isolated.yml`，必要UAT项目/root/端口为空即失败；用`!override`完整替换PostgreSQL、Migration、Web、Worker、Admin宿主挂载和Web/Caddy端口。命名Volume/网络按独立项目隔离，Secret/release bind只读且禁止自动创建宿主路径，所有入口只监听loopback。
- 合同：新增非Secret `.env.uat-isolated.example`、严格Python validator和静态runner。有效配置双PASS；缺root、生产root、生产项目名、生产Web端口和遗漏overlay五类输入全部失败关闭。
- 回归边界：生产Compose直接渲染成功；既有production runtime policy对`Dockerfile`/`compose.release.yml`摘要在本任务前HEAD已漂移，验证器正确返回`POLICY_SOURCE_DIGEST_MISMATCH`。本任务不修改生产policy或降低断言，该发布门继续失败关闭。
- 生产保护：生产`compose.yml`、`compose.release.yml`、container runtime/runtime secret/operator/supervisor政策均未修改。未创建UAT目录、Secret、容器、网络、Volume或数据库，未build、deploy、Migration、restart、账号或业务写；未连接自托管PostgreSQL、现有UAT或生产数据。
- Python基线：self-test、venv smoke和go-live均PASS；系统Python smoke先因缺`openpyxl`在导入前失败。go-live按既有行为写入本地legacy SQLite并生成一份测试备份/活动记录；精确备份文件已删除，唯一活动记录已事务删除并复核为0，未触碰自托管PostgreSQL或UAT/生产。
- 资源与清理：静态子步骤约2.3GiB available/171MiB Swap/17GiB磁盘/Load`0.07/0.08/0.07`起步，收口为`2,452,017,152`B/`179,843,072`B/`17,893,322,752`B/`0.19/0.17/0.12`，kernel OOM0；6容器/75镜像/277 Volume/6网络/0 Cache，四服务restart0/OOM false且Web/PostgreSQL healthy。Compose temp、render JSON和本地测试副作用残留0。
- 当前边界：只关闭Compose消费者侧固定root。release supervisor/operator仍固定生产producer/state/secret/backup root，当前HEAD匹配Web/Worker镜像仍缺失；TASK92保持`DOING`，新UAT和生产继续NO-GO。
- 文档：D-173及MASTER、TASKS、PROJECT_CONTEXT、当前任务、UAT就绪报告、CHANGELOG、STATUS同步；产品代码、Schema、Migration、业务API、角色和依赖不变。

### SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 - `ops: clear unused BuildKit cache`

- 授权：项目负责人明确要求`先清理磁盘`。范围只含未使用BuildKit cache，不等于选择同机UAT；禁止system/image/container/volume prune、网络/服务/数据库/Migration/部署/账号和业务写。
- 清理：按最小影响证据逐步执行三次BuildKit-only命令，均退出0并分别报告607.3MB、35.76MB和9.667GB；Build Cache由174项/10.31GB经164/149项降为0/0B，active始终为0。
- 磁盘：根盘available由`10,825,478,144`增至`17,909,628,928` bytes，文件系统实际增加约6.60GiB，最终约16.68GiB可用、比10GiB停止线高约6.68GiB。Docker逻辑回收量与文件系统增量按不同计量口径分别保留。
- 完整性：容器/镜像/Volume/网络集合摘要前后一致，数量保持6/75/277；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四个受保护Volume metadata不变，TASK92运行资源残留0。
- 资源门：清理前与最终60秒窗口Swap增长均为0；最终MemAvailable约2.30GiB、Swap171.53MiB、Load`0.24/0.28/0.26`、Memory PSI/kernel OOM0。
- 运行面：未删除任何镜像、容器、网络或Volume，未读取数据库/Volume/备份正文，未build、restart、deploy、Migration、创建UAT资源或写业务数据。无产品代码、Schema、API、依赖或部署配置变化。
- 下一门：磁盘阻断已解除；固定宿主控制root和当前源码匹配镜像仍缺失。TASK92保持`DOING`，等待负责人选择独立UAT主机（推荐）或当前主机同机隔离。

### SELFHOST-SMALL-TEAM-UAT-ENVIRONMENT-READINESS-91 - `docs: audit isolated UAT environment readiness`

- 授权与结论：项目负责人选择新建隔离UAT并授权L1只读核对。D-172固定新环境从`EMPTY → 0046`且不接触现有UAT；L1完成不等于环境已创建、可试运行或可上线。
- 源码/Migration：当前alpha.47、46项Migration/head 0046、233表snapshot和0041—0046摘要静态一致。0041 AI表保持冻结，0042/0043导入安全、0044 Session绝对寿命、0045 Worker租约和0046窄锁/trigger安全路径已逐项映射；未运行数据库或Migration。
- 隔离核对：自定义Compose项目名和release overlay使用`--env-file /dev/null`、非敏感占位值渲染退出0，网络、命名Volume和loopback端口可独立前缀；但secret、release identity/candidate、权限operator、全局lock和backup仍是固定宿主root，仓库无独立UAT override，同机只改项目名失败关闭。
- 镜像/恢复：本机唯一alpha.47 Web/Worker镜像绑定旧`78d96c6`，当前HEAD没有匹配镜像。首轮虚构UAT只采用`DISPOSABLE_SYNTHETIC / RECREATE_FROM_EMPTY`，不伪造备份恢复READY；推荐独立UAT主机，当前主机同机方案需配置和BuildKit清理分别授权。
- 资源/非动作：起点约2.4GiB available/171.62MiB Swap/`10,791,727,104`B/Load`0.15/0.14/0.11`，收口约2.37GiB/171.62MiB/`10,782,752,768`B/`0.18/0.15/0.12`；根盘只高于10GiB硬线43.23MiB。PSI/OOM0，6容器/75镜像/277 Volume/174 Build Cache和四服务身份不变，TASK91残留0。未连接数据库，未读取业务/凭据/备份/Volume正文，未创建资源、清理、build、pull/push、deploy、restart、账号或业务写。
- 文档：新增L1报告和TASK92前置任务，更新准备包入口、MASTER、TASKS、PROJECT_CONTEXT、DECISIONS、CHANGELOG和STATUS。无产品代码、Schema/Migration、API、依赖或部署配置变化。
- 下一门：TASK92等待项目负责人选择独立UAT主机（推荐）或同机隔离路径。独立主机先授权L1 metadata；同机路径先分别授权隔离配置和精确BuildKit-only清理，均不自动获得L2a/L3或生产权限。

### SELFHOST-SMALL-TEAM-REAL-SAMPLE-UAT-PLAN-90 - `docs: add synthetic small-team UAT starter pack`

- 无样本起点：新增小团队V1试运行准备包、`CYD-UAT-SYN-001` 10件虚构控制板样本及员工执行/核对清单；不等待或擅自读取真实客户、供应商、联系人、价格、账号或附件。
- 可复算旅程：固定27步岗位交接和8项负向检查，覆盖主数据、现代Mapping、项目/工程/计划、需求、商务门、RFQ/PO、收货/IQC/AP、工单/领料/报工/完工、FQC/出货/AR及收款反向记录。采购10×12=120 CNY，销售10×20=200 CNY，原料/成品/WIP期末均预期为0。
- 业务边界：D-171保持`SO_REQUIRED / PRE_SALES_EXCEPTION`待项目负责人确认；常规订单推荐先有已接受SO，样品/打样/备货例外必须有负责人授权编号、金额上限和有效期。该选择未写入产品规则。
- 人员与授权：一个岗位占位不等于一个固定席位，人数和兼岗按实际名单变化；L0—L5区分文档、只读环境核对、部署/Migration/账号、虚构UAT写入、真实样本和生产授权。本轮只获L0授权。
- 数据库/API/运行面：只新增/更新Markdown；无产品代码、Schema、Migration、API、角色、页面、依赖或部署配置变化。未连接UAT/生产，未创建账号、读取数据/备份/Volume，未build/deploy/restart。
- 验证/资源：13个相关Unit文件`61/61 PASS`；内部链接、27步/8负测/6级授权结构门、`git diff --check`、仅`docs/`变更门及凭据扫描1803文件通过。起点约2.4GiB available/171MiB Swap/根盘约11GiB/Load`0.63/0.24/0.13`，收口约2.4GiB/171MiB/`10,788,438,016`B/`0.09/0.17/0.12`；宿主OOM0、四服务restart0/OOM false且Web/PostgreSQL healthy，任务残留0。本任务未启动临时容器或数据库。
- 结论：TASK90只完成“可以申请独立UAT试跑”的准备包，不代表已经试运行。TASK91等待项目负责人选择现有并行UAT或新建隔离UAT并授权L1只读核对。

## 2026-08-23

### SELFHOST-SMALL-TEAM-UNIFIED-GOLDEN-JOURNEY-89 - `test: add unified small-team golden journey`

- 统一旅程：新增`selfhost-small-team-unified-golden-journey-postgres.test.mjs`，强制全新0046隔离数据库、精确确认短语、空业务库和最多2连接；`test:small-team:golden-journey:postgres`与兼容入口`test:full-erp:compose`统一选择现代测试，历史全ERP脚本保留但不再作为正式入口。
- 业务链：连续完成正式物料与产品/BOM、Supplier Mapping草稿→提交→异人审核、市场项目→工程→计划→净需求10、RFQ/报价/中选→PO/到货/AP、生产领料/报工/完工、品质放行、销售订单→出货/AR、结算及追加式冲销。原料稳定ID贯穿，采购/领料/完工/出货均为10，采购金额120、销售金额200。
- 安全边界：旧Mapping直写继续409，无权仓库项目写入继续403；物料/工单幂等、当前版本CAS、异人审核与财务追加式反向记录均有断言。合成账号仅用于角色交接，不把每职能2人、总人数或席位写入测试约束。
- 失败归类：首次运行沿用采购接收前PRQ版本，RFQ创建正确返回`409 VERSION_CONFLICT`；测试改为读取交接后当前版本2。这是测试工具CAS假设，无产品P0，也未放宽服务端规则。
- 验证：两次从空库顺序应用0001—0046后，统一旅程均`1/1 PASS`；Material、Mapping、Project、Planning Handoff、Material Requirement、Sourcing、Fulfillment、Production Handoff/Operation/Final Output、Quality、Sales和Finance共13组相关Unit合同通过。包脚本中的精确Node命令已原样通过；宿主npm因容器根路径重解析无法启动，JSON解析、Node语法和最终lint/diff/凭据门另行收口。
- 数据库/API/运行面：无产品代码、Schema、Migration、正式API、角色、页面、依赖、build或部署变化；UAT继续alpha.42/0040。未访问真实数据、账号、凭据、备份、受保护Volume或UAT/生产数据库，未重启常驻服务。
- 资源/清理：重任务前约2.4GiB available/171MiB Swap/根盘`10,773,078,016`B/Load`0.07/0.11/0.09`；唯一临时PG限制1 CPU/512MiB并使用tmpfs。清理后约2.4GiB/171MiB/`10,755,850,240`B/Load`0.22/0.45/0.29`，最终静态门后为约2.4GiB/171MiB/`10,811,756,544`B/`0.18/0.22/0.22`；宿主OOM0、四服务restart0/OOM false/healthy，任务容器、数据库、端口、网络、Volume和内存盘残留0。
- 结论：D-170把现代同库合成旅程固定为当前测试基线，TASK89关闭；这不等于真实员工可用或生产准入。TASK90只登记为等待项目负责人批准样本、实名参与者、目标环境和逐项授权的TODO。

### SELFHOST-MATERIAL-REQUIREMENT-DATE-ONLY-FIX-88 - `fix: preserve material requirement calendar dates`

- 修复：新增Material Requirement单一`normalizeDateOnly`边界。规范`YYYY-MM-DD`字符串继续严格验证真实日历；node-postgres返回的有效`Date`按Node进程本地日历分量生成业务日，不再经UTC时间点转换后决定PostgreSQL `date`。
- 消费点：`requiredDate`复用同一规则，提交锁内重算和采购追溯当前供应截止日两个已知消费点统一调用；计算摘要内容、库存/在途SQL、Allocation、权限、事务、幂等、CAS、审计和既有失败关闭错误均未放宽。
- 验证：Unit在`TZ=UTC`和`TZ=Asia/Shanghai`各`4/4`，UI合同`6/6`；同一个全新PostgreSQL 17数据库顺序应用0001—0046并确认233张public表后，Material Requirement PG在UTC与Asia/Shanghai各`8/8 PASS`。即时生成→提交不再因业务日后退而错误返回重算拒绝，合法的权限/并发/来源变化/追溯失败关闭仍按测试预期触发。
- 运行时说明：宿主没有Node；首次宿主命令和只读容器根Node的默认子进程隔离均在测试断言前因可执行路径缺失退出。最终使用Web容器根文件系统中的只读Node 22.23.2及当前进程test isolation执行本地源码，全部目标结果通过；未修改运行容器或建立Node临时容器。
- 数据库/API/运行面：无Schema、Migration、表、角色、权限、页面、依赖或部署结构变化；UAT继续alpha.42/0040且未含本修复。未连接UAT/生产、真实数据、账号、凭据、备份或受保护Volume，未build、deploy或重启常驻服务。
- 资源/清理：启动门约2.4GiB available/171MiB Swap/`10,758,881,280`B根盘/低Load；唯一临时PG容器限制1 CPU/512MiB且数据为tmpfs。清理后60秒SwapFree增长0；收口终检约2.4GiB/171MiB/`10,779,873,280`B/Load`0.65/0.30/0.20`，宿主`oom_kill=0`、四服务restart0/OOM false、Web/PostgreSQL healthy，任务容器、库、端口、网络、Volume和`/dev/shm`残留均为0。
- 结论：D-169把ST-04提升为源码/隔离PG `READY`，当前十条闭环为`10 READY / 0 FIX_REQUIRED / 0 PARKED`，但系统仍为`PRODUCTION NO-GO`。下一任务`SELFHOST-SMALL-TEAM-UNIFIED-GOLDEN-JOURNEY-89`只更新现代Supplier Mapping和跨域API的同库连续旅程。

### SELFHOST-SMALL-TEAM-GOLDEN-JOURNEY-READINESS-87 - `docs: audit small-team golden journey readiness`

- 结论：D-168按ST-01—ST-10收口为`9 READY / 1 FIX_REQUIRED / 0 PARKED`。ST-01、02、03、05、06、07、08、09、10可进入后续真实样本/UAT；ST-04必须先修P0，`READY`不等于已投产。
- 唯一P0：Material Requirement同一隔离PG套件在UTC为`8/8`、Asia/Shanghai为`1/8`。PostgreSQL `date`由`pg`返回Date后经`toISOString().slice(0,10)`转换到前一日，导致即时生成后提交错误返回`MATERIAL_REQUIREMENT_RECALC_REQUIRED`；当前UAT Web为UTC只是在环境上掩盖问题。
- 证据矩阵：任务报告逐条映射页面、`selfhost-api.ts` Dispatcher、Service、Migration/关系边界和动态测试。44个相关Unit/UI文件`194/194`、21组现代Service隔离PG/UTC `99/99`、主数据PG `6/6`、Supplier Mapping PG `10/10`通过；没有把独立库的局部套件描述成统一现代黄金旅程。
- 全ERP smoke：在全新PG17/46项Migration上分别以alpha.42和源码修订`78d96c61…`对应的历史alpha.47本机镜像运行；两次均先完成Identity，再因脚本调用已退役的`POST /api/mappings`被`409 SUPPLIER_MAPPING_GOVERNANCE_REQUIRED`拒绝，restart未到达。治理门保持正确，脚本必须改用现代Mapping草稿→提交→异人审核；现代同库整链缺口另行处理。
- 资源失败关闭：首次计划补跑Supplier Mapping PG 10项前，根盘只比10 GiB硬线高约3.5 MiB，立即停止并清理；空间自然恢复到`10,767,990,784`B且完整新鲜门再次通过后，才以另一隔离库完成`10/10`，未执行任何额外清理。补验窗口起点available约2.3GiB、Swap160MiB、根盘`10,776,580,096`B、Load`0.02/0.13/0.17`；最终约2.4GiB、172MiB、`10,750,689,280`B、`0.13/0.13/0.14`，仍只高于硬线约12.7MiB。
- 对象/运行面：宿主`oom_kill=0`，常驻Web/PostgreSQL restart0、OOM false、healthy；临时Web自身无OOM，PG集群、库、监听、容器和内存盘目录已精确清零。未连接UAT/生产数据库、读取受保护Volume/真实备份/凭据/业务数据，未build、pull、现有Compose重启、部署、账号创建或员工UAT。
- 代码/数据库/API：只新增TASK87报告、TASK88最小任务文档和D-168，并同步MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS；无业务代码、Schema/Migration、API、依赖、镜像或运行服务变化。
- 下一步：`SELFHOST-MATERIAL-REQUIREMENT-DATE-ONLY-FIX-88`只处理date-only规范化与UTC/Asia双时区回归，不新增页面、角色、表、Migration或基础设施；新鲜资源门通过前保持TODO。

### SELFHOST-SMALL-TEAM-BUSINESS-BASELINE-86 - `docs: define small-team ERP business baseline`

- 决策：项目负责人确认九个业务职能暂按每职能2人、约18人估算，但人数不得写死；D-167明确该数字不进入Schema、Seed、权限、并发、许可证或验收条件，`admin`/`operations`只作治理职责。
- 业务基线：新增十大核心闭环、V1完成定义、必需单据/报表和“有效主数据+Opening+未结事项+旧系统只读历史”的首期数据范围；真实数据盘点、试迁移和切换仍需明确授权。
- 源码处置：核心Node/PostgreSQL、数据安全底线和已发布Migration为`KEEP`；AI、高级控制面、历史Sites/D1和Python新增业务开发为`PARK`；只有依赖审计、恢复点和回归齐备时才可在独立任务处理`REMOVE_LATER`。
- 只读盘点：现有11技术角色没有席位限制；自托管源码有50个原生页面、37个一级模块目录、233张表和46项Migration。源码对象存在不等于员工UAT完成，alpha.47/0046与UAT alpha.42/0040差距保持。
- 代码/数据库/API：仅新增业务/任务Markdown并同步MASTER、TASKS、PROJECT_CONTEXT、DECISIONS、CHANGELOG和STATUS；无业务代码、Schema/Migration、API、依赖、账号、镜像、Compose或运行服务变化。
- 验证：身份/授权/工作台Node合同38/38、发布Node合同76/76、fixed-executor Python合同130/130及`server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup`通过；lint退出0，`git diff --check`和精确变更文件敏感信息检查通过。历史D1 smoke不属于未来自托管方向，本任务未恢复退役依赖或启动数据库测试。
- 资源/清理：前后available均约2.3GiB，Swap 139→143MiB/1GiB，根盘均约11GiB，Load由`0.39/0.38/0.24`到`0.32/0.60/0.43`；四个常驻服务restart0/OOM false、宿主`oom_kill=0`。全部断网只读限额Node容器以`--rm`清零，无任务临时文件、数据库、网络或Volume；Compose状态命令因缺必填deployment变量无法渲染，已用只读Docker状态/inspect核验且未修改配置。
- 下一步：`SELFHOST-SMALL-TEAM-GOLDEN-JOURNEY-READINESS-87`只在隔离PostgreSQL证明现有代码黄金旅程覆盖，先标记`READY / FIX_REQUIRED / PARKED`，没有实际P0阻断前不新增功能。

### SELFHOST-SMALL-TEAM-SCOPE-RESET-85 - `docs: reset ERP scope for small team`

- 决策：项目负责人确认系统少于20人使用并确认按小团队版重置；D-166固定Caddy+Node单体+PostgreSQL+本地文件、必要时单Worker，业务闭环和真实员工UAT优先于平台级合成治理。
- 调度：TASK70由`DOING`转为`BLOCKED / OWNER-REQUESTED SMALL-TEAM RESCOPE / NO AUTOMATIC RESUME`；TASK59—TASK82扩展、R2—R5和AI路线冻结。历史源码、证据、Migration和任务记录保留，不伪装完成、不立即删除。
- 保留边界：稳定内部ID、关系约束、事务、幂等、并发、服务端权限、审计、版本化Migration、可恢复备份和已过账事实冲销规则继续是强制底线。
- 代码/数据库/API：仅更新MASTER、TASKS、PROJECT_CONTEXT、DECISIONS、CHANGELOG、STATUS及TASK70/TASK85文档；无业务代码、Schema/Migration、API、依赖、镜像或Compose变化。
- 验证：Node发布合同在断网只读单容器内通过76/76，配套Python fixed-executor合同130/130；`server.py --self-test`、项目虚拟环境`smoke_test.py`和`go_live_check.py --no-backup`通过。lint退出0，为0 error/50个既有warning；`git diff --check`通过。历史D1 smoke不适用于当前自托管方向，未恢复退役Wrangler依赖。
- 运行面：未连接自托管UAT/生产数据库、读取受保护Volume/正式备份正文或执行build、Migration、部署、重启、业务写。首次go-live默认生成的本任务时间戳本地备份经精确核对后删除，并以`--no-backup`重跑通过；UAT继续alpha.42/0040，源码继续alpha.47/0046，系统保持`PRODUCTION NO-GO`。
- 资源/清理：前后available均约2.4GiB，Swap 145→147MiB/1GiB，根盘均约11GiB，Load由`0.49/0.50/0.36`降至`0.16/0.35/0.35`；四服务restart0/OOM false、宿主`oom_kill=0`。本任务测试容器和精确时间戳备份均已清零；Compose状态命令因本机缺必填release deployment ID未渲染，已用只读Docker状态/inspect核验且未修改配置。

## 2026-08-21

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `docs: clarify TASK70 private source anchor`

- 自指边界：治理提交不能在自身正文稳定嵌入自身commit。MASTER/STATUS只固定已验证的D-165源码锚点`e192f1d`和“后续只允许普通快进”事实；当前分支tip由`git rev-parse HEAD`与`git ls-remote`在提交后回读，不用下一笔文档提交追写上一笔治理哈希。
- 范围/验证：仅更正MASTER、STATUS及本条CHANGELOG的Git追溯措辞；不修改源码、Migration、API、测试、镜像、Compose或运行面。继续使用前一治理提交的1,791文件敏感门、静态测试和diff门，系统状态与资源阻断不变。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `docs: record TASK70 psql guard correction`

- Git恢复锚点：D-165源码提交`e192f1d7bb63bfafcd39d77a3d543d604364c9c6`在clean HEAD再次通过官方1,791文件committed-tree敏感信息检查；`recovery-private/main`经祖先关系确认后从`28128de`普通快进，远端回读精确等于local HEAD。未force、未推送公开origin或改写历史。
- 验证结论：server-side exception、精确rc/stdout/stderr、security state零副作用、八类源码带参quit静态禁令及派生摘要链均由前一源码提交闭合；冻结V2五文件和历史Supervisor V1 bundle字节不变。治理收口只更新MASTER/TASKS/CHANGELOG/STATUS/DECISIONS和当前任务事实，不修改业务代码、Migration、API、镜像、Compose或运行面。
- 资源失败关闭：提交后available约1.9GiB、Swap166MiB/1GiB、Load1 0.97、宿主`oom_kill=0`，四服务restart0/OOM false且Web/PostgreSQL healthy；根盘精确可用10,724,749,312 bytes，仍比10GiB硬线少12,668,928 bytes。未启动PG17 catalog refresh/test或正式V3 producer，未重复TASK84，未删除镜像、容器或Volume。
- 下一步：只有根盘重新达到至少10GiB且新鲜资源门全部通过，才从clean/private一致的`e192f1d`串行运行PG17负测、catalog refresh/test和`DV70-PG-GUARDED-SWITCH-02`正式证据。当前仍无V3 artifact，audit保持4 blockers与`may_start=false`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `fix: fail closed on TASK70 psql guard errors`

- clean source前提：D-164提交`28128de0ca03453234f760f5b5b3fa8b0562319c`经1,791文件committed-tree敏感门普通快进到`recovery-private/main`，local/private精确一致。其后正式run`dv70-g2g36ygu`由`TASK70_V3_GUARDED_FAILURE_EXECUTION_INVALID`拒绝，没有发布artifact且任务资源零残留。
- 根因证据：有界诊断`dv70-1bzn9rfk`证明PostgreSQL 17.10的psql对`\quit 3`输出`extra argument "3" ignored`、保留guard marker并以rc=0退出。psql的`\quit`不接受退出状态；旧实现因此不能提供调用方所依赖的失败关闭回执。
- 修复：cluster catalog、runtime privilege catalog/state、operator、reconciler和rollback fixed executor的全部生产可达带参quit分支改为server-side `DO ... RAISE EXCEPTION`，由既有`ON_ERROR_STOP`稳定产生rc=3；事务路径保持先`ROLLBACK`再抛错。全仓静态门覆盖`.cjs/.js/.mjs/.mts/.py/.sh/.sql/.ts`并禁止任何带参数的`\quit`或`\q`回归。
- 动态合同：Node与Python verifier只接受rc=3、stdout精确`b"\\n"`和stderr精确`b"ERROR:  guarded switch runtime privilege mismatch\\n"`，明确拒绝旧rc=0 warning、伪造marker、CRLF和宽松文本。security-drift场景新增失败前后security state非空、32MiB有界、逐字节一致及双SHA-256相等；真实PG17 integration脚本新增缺失变量、非法target、reconciler/operator强制advisory-lock失败和状态零副作用负测。
- 追溯：V3 reconciliation/production normalized SHA-256为`067255c7…339`/`56700c1f…abb`，policy raw/canonical为`e8c642ec…cdcd`/`30b81e06…0e9`。compiled catalog raw/semantic/artifact为`915ee9bf…7a41`/`e0070514…e8c`/`a386c384…aa53`；runtime/operator/cluster policy raw为`2aba8ed9…a7c`/`4767a070…9fa`/`3537a90a…016`，release inventory/runtime为`97e599da…51e6`/`1b0637e2…efc8`。audit semantic/raw/Markdown/source-manifest为`ab52a095…123`/`c180f6f7…8ef`/`5b1175d1…5f45`/`605cdacc…bdf8`，仍为4 blockers、`may_start=false`。
- 验证：受影响Node六文件68/68、catalog/release gate/manifest35/35，Python V3 19/19、fixed executor130/130、Supervisor受影响套件46/46、audit20/20，inventory263/239/24、policy/audit直接门、shell语法及静态quit门通过；`assert-ready`继续按预期以exit 1和`UAT_PROMOTION_EXECUTOR_NOT_READY`拒绝。五个V2冻结文件与历史`release-supervisor-bundle-v1.json`不变。D-132 dashboard中的cluster catalog源码哈希只按D-165安全修复更新，历史D-132提交/证据不改写。
- 资源/未验证范围：收口前available约1.9GiB、Swap166MiB/1GiB、Load低、宿主`oom_kill=0`，四个常驻服务restart0/OOM false且Web/PostgreSQL healthy；但根盘精确可用10,717,696,000 bytes，低于10GiB硬线。按规则未启动官方PG17-backed catalog refresh/test或正式V3 producer；仓库编译产物虽由固定生成器更新，仍不得冒充真实PG17闭环，也不得重复已消耗的TASK84命令。
- 数据库/API/运行面：无Schema/Migration、普通业务API、镜像、Compose、UAT或生产运行面变化；未访问真实数据库、业务数据、备份正文、凭据或受保护Volume。D-165随后以`e192f1d`形成独立提交并在敏感门后普通快进到private；空间门恢复后继续PG17验证和正式动态重跑。TASK70保持唯一`DOING`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `fix: correct TASK70 guarded SQL coalesce syntax`

- clean source前提：D-163提交`4dbe266c271eb90ca4e02fcb632ef26b24986cd4`先后通过候选与committed-tree各1,791文件敏感信息检查，并由`recovery-private/main`从`63c301f`非强制普通快进接收；local/private精确一致，公开`origin`未推送。精确历史组合在该clean source通过110/110。
- 失败关闭：首个producer`dv70-9cvw_3r_`因确认精确测试门而在PG创建前主动中止，零临时资源；正式run`dv70-6kvqa_9c`通过60秒前检并启动唯一断网、只读rootfs、全tmpfs PostgreSQL 17.10容器，在第二条生产fixed executor调用后以`SIDE_EFFECT_OUTCOME_UNKNOWN`拒绝且没有发布artifact。
- 根因证据：有界诊断`dv70-mqr7yjwr`证明第一条reconciliation调用rc=0、stderr空、observer PASS；`dv70-q51u17a0`证明第二条guarded switch调用rc=3，stderr为`function pg_catalog.coalesce(numeric, integer) does not exist`。PostgreSQL把`COALESCE`作为内建语法构造，不能以`pg_catalog.coalesce`调用；D-163修复使真实SQL首次到达该执行点，从而暴露既有缺陷。
- 修复：只把fixed executor中六处`pg_catalog.coalesce(...)`改为`coalesce(...)`，覆盖四个聚合分片、extension inventory和Migration inventory；不做类型强转，不修改内容、Migration、ACL、事务、rename、UNKNOWN/no-replay或副作用守卫。测试增加禁止该非法token的精确断言。
- 合同/追溯：完整production normalized SHA-256更新为`fd129b85c4f23937d62e2f6838e113a609d9cf5d305b3424480f096391e39e24`，reconciliation保持`067255c7…339`；V3 policy raw/canonical为`56b57120…c34a`/`192b1cab…773f`，release inventory/runtime policy为`a378c049…f993`/`9dfc7f9f…1c40`，release manifest source为`68350570…c00c`。固定生成器重放promotion audit为semantic/raw/Markdown/source-manifest `9ee02ef4…f22b`/`f0a8a64c…630d`/`ab4d4197…d1f7`/`ed3974f7…ce80`，仍为4 blockers与`may_start=false`。
- 验证：12个去重Node文件的完整并集195/195且0 skip/todo/fail，Python V3+fixed executor147/147，inventory263/239/24、V3 policy verify PASS、audit verify PASS/BLOCKED，`assert-ready`以精确exit 1和`UAT_PROMOTION_EXECUTOR_NOT_READY`按预期拒绝。首次组合门包装器误把预期退出码写成3而自身退出1；核对源码合同后以精确exit 1重跑通过，产品输出始终正确。一个过宽的总`coalesce(`计数测试准确暴露文件内另有35个合法非限定用法后，被收紧为直接禁止`pg_catalog.coalesce(`；产品断言没有降低。提交后还须从clean/private一致源码复跑精确110项和动态producer，成功artifact必须再经Node verifier与整件篡改harness。
- 资源/清理：所有正式/诊断run均只使用单一隔离PG17容器且串行；任务容器、网络、Volume、tmp根、进程和V3 artifact均为0。提交前available约2.1GiB、Swap133MiB/1GiB、根盘约11GiB、Load低、宿主`oom_kill=0`，四个常驻服务restart/OOM保持0。未重复TASK84，未删除镜像、容器或Volume。
- 数据库/API/运行面：无Schema/Migration文件、普通业务API、镜像、Compose或运行面变化；未访问UAT/生产数据库、受保护Volume、真实备份、凭据或业务数据。TASK70保持`DOING / CLEAN COMMIT AND DYNAMIC RETRY PENDING`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `fix: bound TASK70 SQL normalization`

- 失败关闭：D-162提交`63c301f`完成committed-tree敏感门并普通快进到private main后，clean run`dv70-nc3x52ls`通过60秒资源门与隔离PG17启动，在artifact发布前以`TASK70_V3_SQL_NORMALIZATION_INVALID`拒绝且任务容器、tmp根和artifact均为0。未连接UAT/生产或受保护Volume。
- 根因：旧归一化用无边界64位hex搜索，误把完整448行报告中的长关系/序列identity切成摘要；相同摘要的全部JSON路径直接拼接又使production normalized扩张到约2.9MiB。旧production golden `058a924…c0a`来自2行小夹具，不是实际234 relation、211 sequence、2 extension及1 large-object行的生产SQL。
- 修复：先严格解析content-report行类型，保护SQL单双引号中的合法关系、序列和扩展hex；未知64位及更长hex继续失败关闭。system identifier、candidate/restored OID只在四个精确SQL槽位替换，数量、sequence值和无关JSON数字不做全局替换；重复摘要路径改用`PATH_SET_<count>_SHA256_<digest>`有界标签，producer/verifier同时限制raw、normalized和gzip/gunzip为1MiB。
- 合同/追溯：完整448行双语归一化固定reconciliation/production SHA-256为`067255c7…339`/`b4e0c24f…a140`；V3 policy raw/canonical为`6c66291a…7486`/`87cadfcf…bd50`，release inventory/runtime policy为`91caeaca…4419`/`16e4428b…6711`。inventory变更由固定生成器重放当前promotion audit，semantic/raw/Markdown/source-manifest为`072cf6a2…8cbe`/`688179d8…aa7`/`40f807be…dd5a`/`78990c03…d80e`，仍为4 blockers与`may_start=false`。V2五文件SHA-256继续保持`888e8da9…6308`、`a62db066…2c3`、`43de9dc9…5b01`、`fe9932e2…c6b8`、`8e7b9c65…f91`。
- 验证：完整受影响组合110/110、Python V3 18/18、fixed executor129/129、Node V3 14/14、promotion audit/rollback34/34、release gate/manifest29/29、扩展release组合76/76、inventory263/239/24和V3 policy verify通过；audit组合首跑33/34按预期发现旧生成物摘要，固定生成器重放后原断言34/34。跨语言独立只读复核未发现可复现P0/P1。该修复随后以`4dbe266`完成候选及committed-tree敏感门、private普通快进和clean-source精确110/110；正式动态run到达下一执行点后由D-164记录的PostgreSQL语法错误继续失败关闭，未生成artifact。
- 资源/清理：提交前available约2.0—2.1GiB、Swap133MiB/1GiB、根盘11GiB、Load低；四服务running且Web/PostgreSQL healthy，所有`cyd-task70-*`测试容器均已消失。未重复TASK84、未删除镜像/容器/Volume，未运行build、现有Compose、Migration、部署或业务写。
- 数据库/API/运行面：无Schema/Migration、普通业务API、镜像、Compose或运行面变化；只修正隔离证据producer/verifier、policy和发布摘要链。D-163源码已提交/private同步，但TASK70仍保持`DOING`且系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `fix: verify frozen TASK70 evidence from bound Git blobs`

- 发现：owner ACL修复`d7ce5f6`经1,791文件committed-tree敏感门普通快进到private main后，clean-source组合实际运行110项得到106/110。四个失败集中在当前UAT promotion audit：冻结V2 artifact绑定c793的14个source blobs，但loader向verifier传入当前inventory/runtime/fixed-executor bodies，产生source-binding/runtime-boundary错误并使audit JSON/Markdown过期。
- 边界决策：五个V2 producer/verifier/audit-test/policy/artifact继续逐字节冻结；当前audit的source manifest与能力检查继续读取当前工作树。仅当输入artifact SHA精确等于repository loader最初读取值时，V2验证改用其已证明为HEAD祖先的commit/source blob；synthetic或tamper fixture SHA不同，继续使用caller bodies，避免历史源码掩盖负测。
- Git读取安全：固定绝对`/usr/bin/git cat-file blob`、`shell=false`、净化Git环境、禁replace/lazy fetch/prompt、5秒timeout、2MiB上界和fatal UTF-8；path顺序、40hex object及唯一性先验证，随后冻结V2 verifier仍重算SHA-256、Git blob SHA-1、commit/tree/ancestor。任何读取、类型、内容或摘要失败都进入`INVALID_FAIL_CLOSED`。
- 生成物：重新生成audit JSON/Markdown；semantic/raw/Markdown/source-manifest SHA-256分别为`6aa3f2bf…a4a3`/`de3a5b49…57d6`/`53418ec4…2bbb`/`758044cf…fbf2`。结论仍为4 blockers（P0=3、P1=1）、`may_start=false`，`assert-ready`仍精确返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 验证：audit专项20/20、完整clean-source组合110/110、V3 13/13、release29/29、inventory263/239/24、audit generate/verify、V3 policy verify及预期assert-ready阻断通过；两条独立只读复核P0=0/P1=0，`git diff --check`通过。此前文档的108项来自旧测试集合，当前真实组合为110项。
- 资源/清理：组合测试前后available约2.0GiB、Swap133MiB/1GiB、根盘11GiB、Docker service `oom_kill=0`，四服务资源稳定；所有`cyd-task70-*`临时容器均为0。未重复TASK84或删除镜像/Volume，未运行现有Compose/数据库、UAT/生产、Migration、部署或业务写。
- 数据库/API/运行面：无Schema/Migration、普通业务API、镜像、Compose或运行面变化；只修正仓库审计对历史证据的source时态并刷新审计生成物。当前仍无V3动态artifact，TASK70保持`DOING / CLEAN COMMIT AND DYNAMIC RETRY PENDING`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `fix: restore TASK70 owner ACL materialization`

- 失败关闭：输出上限修复`cb731df`完成敏感门并普通快进到private main后，隔离run`dv70-aazofvib`通过60秒前检、PG17.10启动和baseline物化，在任何rename前由`ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID`拒绝；只读诊断run`dv70-mz485olk`把首差异固定为`$.object_acl_storage[0].acl_item_count actual=4 expected=5`。没有生成V3 artifact，任务容器、tmp根和进程均为0。
- 根因：fixed executor按合同先撤销owner、`CURRENT_USER`和`pg_database_owner`显式ACL，却只重新授予4个service group；canonical Node reconciler和状态投影均要求owner ACL存在。两条独立只读审计分别从PostgreSQL ACL语义和跨语言合同确认该结论，未修改parser或降低security断言。
- 修复：在service grants前恢复database、schema、all tables、all sequences、394个routine和6个standalone type的owner权限，共404条`GRANT ALL PRIVILEGES`。executor继续明确禁止tablespace GRANT/REVOKE；仅fresh synthetic cluster为内建`pg_default`/`pg_global`物化owner ACL，Python/Node setup固定为2,538 bytes、SHA-256`919ec372…626`。
- 合同/追溯：reconciliation normalized SHA-256更新为`067255c7…339`，V3 policy raw/canonical为`e62b16cc…5e4d`/`90188fad…d12`；release inventory/runtime policy为`bc5045f7…bb4f`/`8d86bac3…cd2`。历史V2五文件哈希保持不变。
- 验证：当前修复已通过Python V3 16/16、fixed executor 129/129、Node V3 13/13、release 29/29及inventory263/239/24。初始V3 source的受影响合同108/108不冒充当前结果；本提交通过diff/敏感门并普通快进后，必须在clean source离线容器重新串行运行108项，再执行动态case。
- 资源/清理：提交前available约2.0GiB、Swap133MiB/1GiB、根盘11GiB、Load1约0.90；Docker service和四容器cgroup `oom_kill=0`，四服务running、Web/PostgreSQL healthy、restart0/OOM false。未重复TASK84，未删除镜像/容器/Volume，未访问UAT/生产数据库、真实备份、凭据、业务数据或四个受保护Volume。
- 数据库/API/运行面：无Schema/Migration文件、普通业务API、镜像、Compose或运行面变化；只修正仓库fixed executor ACL重建及隔离fixture。当前无有效V3动态artifact，TASK70保持`DOING / CLEAN COMMIT AND DYNAMIC RETRY PENDING`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `fix: align TASK70 content report output limit`

- 失败关闭：source`d1d8ae8`通过1,791文件敏感信息检查并普通快进到private main后，run`dv70-3tbcp9x1`完成60秒前检和隔离PG17.10启动，但baseline content capture在执行前返回`TASK70_V3_PSQL_INPUT_INVALID`；没有生成artifact或进入既有/UAT数据库。
- 根因/修复：producer通用psql包装器上限为32MiB，而fixed executor的`POSTGRES_CONTENT_REPORT_MAX_BYTES`合同固定64MiB。改为直接复用同一权威常量，避免两处魔数漂移；新增精确64MiB接受、64MiB+1拒绝及实际docker调用参数断言。
- 验证/清理：Python V3仍为16/16、Node V3 13/13、inventory263/239/24通过；失败run后任务容器、tmp根和artifact均为0，宿主`oom_kill=0`，四服务和受保护卷未变化。修复必须经独立提交、重复敏感信息检查和private普通fast-forward后才允许重跑。
- 数据库/API/运行面：无Schema/Migration、业务API、镜像、Compose或运行UAT变化；只修正隔离证据runner输入上界。TASK70保持`DOING / RETRY PENDING`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `test: add TASK70 guarded switch dynamic contract`

- 调度/边界：D-160将原计划`DV70-PG-RESTORE-02`拆为当前可由固定生产executor精确复用的`DV70-PG-GUARDED-SWITCH-02`和仍未证明的dump/Volume恢复；本提交只完成V3源码与合成合同，动态artifact必须在clean source提交后运行。未连接UAT/生产、读取备份/受保护卷/凭据或执行业务Migration、部署与host动作。
- PostgreSQL/权限：V3单case物化全部0001—0046 Migration、9个受管角色、4项membership、relation/large-object canonical content report及live ACL/default privilege/role/security摘要；生产`PG_RB_GUARDED_SWITCH_V3`拒绝内容、Migration ledger和security漂移，ordinary role不能进入sealed staging，首rename故障必须事务回滚。
- fixed executor回执：`ClosedDockerRunner`新增默认关闭的完成态observer，仅V3隔离runner注入；在EOF、退出码及无遗留daemon确定后，9次生产psql调用分别绑定argv、固定env、stdin、timeout/output上界、side-effect、rc、原始stdout/stderr和自摘要。回调在副作用后异常转typed UNKNOWN；默认路径不增加stdin哈希或复制。
- 恢复/no-replay：场景覆盖OLD布局一次耐久恢复、恢复attempt unknown不二次执行及调用方丢弃已完成NEW_SEALED结果不重放。字段与17项non-claim明确该合成模型不证明进程终止/新进程恢复、传输层PostgreSQL COMMIT响应丢失、dump/Volume、完整handler request/result commit边界或真实UAT。
- 证据安全：Python/Node独立重建固定executor SQL/argv/env/序列/原始输出；setup/reset/drift SQL均有精确receipt。SQL只接受单一mtime=0 canonical gzip member；artifact为稳定root-owned `0400`单硬链接，整件篡改harness在合法级联重哈希后仍须语义拒绝。发布失败仅按本次inode清理精确路径，并覆盖hardlink后unlink/fsync失败。
- 资源/对象：monotonic elapsed与wall clock逐样本绑定，最大漂移1.5秒，容器创建前≥60秒前检且总窗口≥180秒；仍限制一个本机已有固定摘要PG17容器、断网、只读rootfs、全有界tmpfs、无bind/Volume/build/pull。当前源码测试前后available约2.0—2.1GiB、Swap126MiB/1GiB、根盘11GiB、Load低，四服务无restart/OOM变化且无当前任务容器残留。
- 验证：Python V3 16/16、fixed executor 129/129、Node V3 13/13、受影响合同108/108、release合同29/29、inventory263/239/24及Node syntax/diff门通过，两条独立终审P0=0/P1=0。首次108项组合的35个失败均为drop-all容器无法覆盖`0440`夹具并chown reader GID的同源EACCES；离线容器仅补`DAC_OVERRIDE`/`CHOWN`后108/108，无断言修改。
- 追溯：V2 producer/verifier/audit-test/policy/artifact五个SHA-256保持`888e8da9…6308`、`a62db066…2c3`、`43de9dc9…5b01`、`fe9932e2…c6b8`、`8e7b9c65…f91`。V3 policy raw SHA-256`9245a099…dc22`；release inventory/runtime policy为`c4775f60…6485`/`8f6fb710…85d2`。敏感信息门和私有普通fast-forward是提交后动态执行的强制前置，不提前声称artifact或远端同步完成。
- 数据库/API/运行面：无Schema/Migration文件或普通业务API变化；修改的是runtime privilege/recovery合同、rollback fixed executor/control/adapter、V3证据producer/verifier/policy和发布测试链。系统继续`PRODUCTION NO-GO`，TASK70保持唯一`DOING`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `test: publish TASK70 PostgreSQL switch evidence`

- 实施/追溯：在合同提交`9db10d7`后，以`422a26f`修正psql advisory-lock命令成功执行前输出的精确单换行，以`2dcc011`使当前审计断言同时覆盖“无证据”和`VERIFIED_PARTIAL_ONLY`合法状态，以`c793cdd`统一Python/Node整数型浮点规范化并拒绝超JavaScript safe integer；最终证据绑定source`c793cdd07d2d9b5fedd63055558aed3ac90723cf`、tree`c7453b28db2db46c4bc7483a4176354195131478`、alpha.47及Migration`0046_runtime_lock_privilege_boundary.sql`。
- 动态数据库：`dv70-f2tu2jie`仅在固定摘要、本机已存在的PostgreSQL 17.10镜像中运行；`network=none`、只读rootfs、无bind/Volume、data/socket/tmp全在有界tmpfs。5个场景和9项断言验证生产`PG_RB_ATOMIC_SWITCH_V1`精确成功、数据库OID保持、重复执行失败关闭、前置漂移拒绝、首rename后故障事务回滚、调用方丢弃完成结果后的只读观察及无稳定混合布局。
- 失败关闭修复：首次真实运行因psql在错误前输出advisory-lock的`\n`而拒绝，独立最小PG诊断确认rc=3/stdout=`0a`后新增精确合同；后续Node门拦截采样`load1: 2.0`导致的Python `2.0`/Node `2`双层摘要分歧。两份失效合成artifact均在核对owner/mode/link/inode/摘要后精确删除并重跑，没有手工改摘要或降低断言。
- 证据/审计：最终不可变artifact为`root:root 0400`、单硬链接、359,133 bytes，语义SHA-256`867f3a7c2ee0b1c3ff6dc70bd167d55e76aa55ccf5969a0b6ad2923420272f56`、raw SHA-256`8e7b9c6576fe369f9264445947ece3cc94ac79832871311fa2e59296c3260f91`；独立Node/Git复算PASS。晋升audit SHA-256`a9d2e03132e387dd19cde9f312f9dc05c5202e231742183c5884fe2df75ddd1d`仍为4 blockers（P0=3、P1=1）和`may_start=false`。
- 测试：Python专项24/24、Node动态审计20/20、release合同29/29、inventory262/238/24、官方凭据扫描1,785文件及`git diff --check`通过；Python/Node共享固定数值golden SHA-256`bea9d5d7…207b`，覆盖`2.0`、`-0.0`、`0.0`、`2.4`和真实Swap百分比。
- 资源/清理：最终机器证据37样本/180秒、60秒前检；最低available 1,900,601,344 bytes、最大Swap 6.704%且rolling增长0、根盘最低11,386,380,288 bytes、峰值磁盘增量4,890,624/67,108,864 bytes、Load1最高0.23、restart/OOM增量0。cleanup receipt`68ee1d20…a700`，任务容器/网络/Volume/tmp根/进程全部为0，常驻四服务及四个受保护卷不变。
- Git恢复锚点：证据提交`526fd4af306441a65090f33c66cfdefc7ecfcf74`在敏感信息检查后，从已证明为本地祖先的private main `3e30dc36a63461ed7bebe39d0b46fd8742b5dd66`普通fast-forward送达`recovery-private/main`；本条治理提交按同一授权继续普通快进并复核远端与本地HEAD一致。未force、未推送公开origin或改写历史。
- 数据库/API/运行面：无Schema、Migration、业务API、镜像、Compose或运行UAT变化；没有连接UAT数据库、读取受保护卷/真实备份/凭据或执行业务写。结果仅为`PASS_PARTIAL / VERIFIED_PARTIAL_ONLY`，TASK70保持`DOING`并转入`DV70-PG-RESTORE-02`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 - `test: add fail-closed TASK70 dynamic evidence contract`

- 调度/范围：TASK84完成后将TASK70转为唯一`DOING`；数据、应用测试、运维安全三条智能体线只读审计，主智能体唯一写入。首提交只建立隔离合成动态证据合同与审计消费，不连接PostgreSQL、不读取Volume/备份/凭据、不运行UAT/生产或host activation。
- 合同：新增版本化policy/verifier，固定`ISOLATED_SYNTHETIC_ONLY`、TEST、`PARTIAL_ONLY`、唯一`DV70-PG-SWITCH-01`、既有PG17镜像摘要、64MiB宿主磁盘增量、1 CPU/768MiB/192 PIDs、断网/只读rootfs/精确tmpfs以及资源、全局对象、保护卷、服务和零残留收据。
- 安全/追溯：artifact使用`O_NOFOLLOW`、单硬链接/大小/权限/TOCTOU门；数值类型、端点、Swap/Load/OOM/restart/磁盘关系严格交叉校验。source bindings绑定policy、verifier、executor、inventory/runtime policy、`package.json`与0046 Migration，六项non-claim禁止越权解释。
- 审计：仓库handler固定为`HANDLERS_IMPLEMENTED_DORMANT`，隔离动态、host activation、真实UAT回退和人工UAT分别建模；当前artifact self-digest`b6b3c244…58d4b`且4项阻断（P0=3、P1=1），有效`PARTIAL_ONLY`回执也不能移除阻断或放行`assert-ready`。
- 测试：既有Node镜像中断网、只读、384MiB/1 CPU/128 PIDs串行运行；跨岗与回退审计生成器逐字节重放，policy验证及17/17专项测试通过。缺失动态artifact返回`TASK70_DYNAMIC_ARTIFACT_NOT_EXECUTED`，晋升门返回`UAT_PROMOTION_EXECUTOR_NOT_READY`；inventory262/238/24，raw SHA-256`ba303db7…7f696`。
- 资源/清理：测试前后容器、镜像、Volume、四服务集合SHA-256完全一致；临时容器按精确label/ID删除，无网络、Volume、数据库、临时目录或进程残留。收口available约1.8GiB、Swap48MiB/1GiB、根盘约10.74GiB、Load`0.61/0.49/0.46`，四服务稳定且无restart/OOM变化。
- 数据库/API/运行面：无Schema、Migration、业务API、镜像、Compose或运行面变化；生成artifact仅为仓库审计资料。TASK70保持`DOING`，下一提交只执行`DV70-PG-SWITCH-01`，系统继续`PRODUCTION NO-GO`。

### SELFHOST-OPS-RESOURCE-STOP-LINE-REMEDIATION-84 - `ops: complete bounded BuildKit cache cleanup`

- 调度/授权：从clean `main@9fc999cde40a03071cc295a99e357b78f4ea92a5`、tree`0fbbb79ea78e778971f71e68ab9a60befa95598b`恢复TASK84。项目负责人专项授权仅执行一次`docker builder prune --force --filter until=24h`并禁止镜像、容器和Volume删除；数据迁移、应用测试、运维安全三条智能体线只读审计，主智能体唯一写入和执行Docker mutation。
- 执行：清理前default BuildKit running、active0且无任务build/test/Migration重任务；原样命令唯一执行、退出0、删除18项并回收475MB。Build Cache由192项/10.79GB/6.149GB reclaimable变为174项/10.31GB/5.674GB reclaimable；未第二次执行或扩大到system/image/volume prune。
- 对象保护：容器/镜像/Volume前后均为6/75/277，集合SHA-256分别保持`9b56a70b…f2c27`、`7c35e42b…dd5e`、`c6c0b391…53e8`；PostgreSQL/Web/Worker/Caddy四容器ID、镜像ID、running、restart0/OOM false、Web/PostgreSQL health及四个受保护卷metadata不变。
- 清理后门：18:45:10—18:46:11七点窗口最低MemAvailable`1,955,749,888 B`、最高Swap`33,832,960/1,074,786,304 B`（3.14%）、增长`1,212,416 B`、最低根盘`11,153,551,360 B`（约10.39GiB）、Load1最高1.51，memory PSI始终0且`oom_kill`增量0；全部D-158硬门通过。
- Git/版本/运行面：源码保持alpha.47/46项Migration/head 0046，运行Web仍为alpha.42；没有访问运行数据库或业务数据，没有build、Migration、部署、备份恢复、服务重启、UAT/生产或业务写。项目负责人保护的状态报告保持不读、不改、不提交。
- 验证：任务治理Markdown本地链接、状态一致性、发布bundle literal allowlist/精确blob字节单元测试、高置信敏感信息和`git diff --check`通过；没有以重型全量测试替代本任务对象/资源证据。
- 资源/清理：本任务未创建临时文件、容器、网络、Volume、数据库或测试数据，无任务资源残留。根盘最低只比10GiB硬线高约0.39GiB，TASK70每个切片必须先证明磁盘上界并重做资源门。
- 治理：TASK84转`DONE`，TASK70从`BLOCKED`转`TODO / READY FOR FORMAL START`；该转换只允许隔离合成动态验证，不授权真实target/凭据、host activation、UAT/生产、真实数据、员工签字或切换，系统继续`PRODUCTION NO-GO`。

## 2026-08-20

### SELFHOST-OPS-RESOURCE-STOP-LINE-REMEDIATION-84 - `docs: record TASK84 resource gate revalidation`

- 调度/范围：用户继续持续目标后按强制文档链恢复，以TASK84为唯一正式任务编号；三条智能体线分别只读复核数据动态切片、应用测试入口和运维安全门。主智能体唯一写文档，未读取受保护状态报告，未启动TASK70或任何重任务。
- Git/版本：起点根仓库`main@6c3055bdc4b7ee728fb26cfa8bbe05ba7d9f6f25`、tree`29116f4bcf9e75e394ac7b1b3090ea8881155eca`，源码alpha.47/46项Migration/head 0046；运行Web只读health仍为alpha.42/source`569aa954…d33a24`。本轮没有访问运行数据库确认Migration head，也没有build、Migration、部署或业务写。
- 外部重启事实：宿主已于2026-08-18 20:11:57外部重启，当前Codex PID `2688`于20:12:25启动；重启原因和授权来源不推断，不作追溯性授权。四服务在宿主启动后稳定约43小时，identity保持，restart0/OOM false，Web/PostgreSQL healthy、Worker/Caddy running，四个受保护卷身份和挂载完整。
- 资源门：清理前60秒7点窗口的MemAvailable最低`1,995,564 KiB`、Swap始终`10,204/1,049,596 KiB`且增长0、根盘最低`11,403,153,408 B`（约10.62GiB）、Load1最高0.72，memory PSI与`oom_kill`增量均为0。根盘只比10GiB硬线多约0.62GiB，不启动无最坏磁盘上界的动态任务。
- Docker容量：Build Cache为192项/10.79GB，其中6.149GB reclaimable、active 0。镜像13.81GB和Volume 380.1MB虽被Docker报告为reclaimable也始终禁止触碰；未执行prune、对象删除、Compose/服务重启或host修改。
- 治理：D-158保持不变。清理前数值通过不能替代精确BuildKit-only专项授权、一次受控清理、对象复核和清理后新鲜60秒门；“继续”不扩大到删除授权。TASK84保持`BLOCKED`、当前零`DOING`，TASK70继续失败关闭，系统仍`PRODUCTION NO-GO`。
- 验证：六份治理Markdown的177个本地链接、唯一active状态（DOING=0）、跨文档状态标记、发布bundle literal allowlist/精确blob字节单元测试1/1、增量高置信敏感信息与`git diff --check`通过。未运行Node全量、build、PG/Compose、Migration、备份恢复或UAT测试。
- 资源/临时项：起点available约2.39GiB、Swap约0.8MiB、根盘约11.10GiB、Load1 0.17；收口available约1.94GiB、Swap约9.97MiB、根盘约10.88GiB、Load1 0.17，内核`oom_kill=0`。四服务identity、restart0/OOM false和health保持，四个受保护卷完整；本任务未创建临时文件、容器、网络、Volume、数据库或测试数据，无需清理。
- 数据库/API/产品：无Schema、Migration、API、业务代码或运行面变化；真实异机恢复、迁移、账号、员工UAT和正式切换仍未完成或未授权。

## 2026-08-16

### SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83 - `docs: attribute resource stop line and request bounded remediation`

- 调度/范围：TASK82收口后自动启动唯一只读任务；不读取进程argv/env、日志、数据库、Volume、备份或凭据正文，不修改Swap/systemd/服务/Docker daemon/网络，不启动build、全量测试、PG/Compose或数据任务。
- 进程/cgroup归因：152个进程VmSwap合计约747MiB。长期Codex进程RSS约1.29GiB/VmSwap约324MiB，session cgroup约2.01GiB memory/317MiB Swap；Docker daemon cgroup约102MiB Swap，PostgreSQL/Web/Worker/Caddy约194/43/48/5MiB Swap，全部cgroup OOM/kill为0。
- 稳定窗口：首段60秒Swap净降20KiB、无pswpout/kswapd增长；容量读取后第二段60秒仅增长44KiB，PSI始终0、`oom_kill=2`不变、容器identity/health/restart/OOM不变。最终Swap仍约82.7%，不得以低PSI放宽≤80%硬门。
- 磁盘：根盘60GiB中约50GiB已用/11GiB可用、inode5%。Docker有75镜像/28.07GB、192项Build Cache/10.79GB、277卷/733.3MB；BuildKit private可回收至少约7.87GB且最后访问≥41小时。镜像和Volume虽被Docker标记部分reclaimable，但未列为清理目标。
- 决策：D-158拒绝swapoff/swapon、扩Swap、ERP/PostgreSQL/Docker重启或以PSI替代硬门。最低业务影响路径为项目负责人侧重启长期Codex运行时，再专项授权仅执行`docker builder prune --force --filter until=24h`；禁止system/image/volume prune及任何服务/数据变化。
- 验证/资源：只读Git、版本/Migration、free/df/uptime/vmstat/PSI、Docker stats/Compose ps/inspect、cgroup、两段60秒和受限容量检查完成；未创建临时文件/容器。最终available约1.1GiB、Swap约848MiB/1GiB、根盘约11GiB，四服务running、Web/PostgreSQL healthy、restart0/OOM false。
- 治理：TASK83转`DONE`，新增`SELFHOST-OPS-RESOURCE-STOP-LINE-REMEDIATION-84`为`BLOCKED`并回到零`DOING`；TASK70继续BLOCKED。等待唯一最小外部动作/授权，不自动扩大到host或UAT。

### SELFHOST-UAT-PROMOTION-ROLLBACK-CAPABILITY-HANDLERS-82 - `feat: add fixed UAT rollback capability handlers` / `build: refresh release supervisor bundle manifest` / `docs: close UAT rollback handlers and start resource attribution`

- 调度/范围：从TASK81最终Supervisor提交`7a1ef56`/tree`cf81fb7b`启动唯一active task；三名智能体分别只读复核数据迁移、应用测试和运维安全边界，主智能体唯一写入。只实现仓库/fake-root处理器，不连接数据库、不读Volume/备份、不运行Compose或真实回退。
- 边界决策：D-157固定PREPARE/EXECUTE/PROBE/CONTAIN、逐动作幂等键和逐副作用耐久intent/started/receipt/probe/terminal链。commit-before-receipt只能凭精确OID/marker/layout或release状态补写`RECOVERED_COMMITTED`，receipt前缀、漂移、超时、signal、daemon及输出越界保持typed UNKNOWN并保全。
- 数据库/运行态：PG staging restore与active/quarantine双rename只使用独立管理库、固定SQL/FD和新身份；pre/postactivation分别重新读取数据库内容、46项Migration ledger、ACL/default privileges、角色、session及服务identity。双rename事务/锁/故障窗口仍须TASK70在隔离PG17动态证明，证明前catalog不得提升。
- 文件域/镜像：uploads、attachments、backup_status只恢复到互不相交的新卷，内容及owner/group/mode/读写探针均须闭合；backup_status历史快照不冒充当前异机就绪。固定Wolfi helper镜像绑定source labels、SBOM、Trivy数据库树身份/新鲜度、零漏洞和跨阶段60秒资源门；无外部registry/Trivy更新回执时证据明确降级且不授权。
- 前代服务/恢复：Web/Worker仅接受execution package固定registry digest和本机content identity，禁止pull/build/latest；Caddy/PostgreSQL/网络/保护卷不变。派生runtime hash与历史predecessor hash分别绑定，postverify读取live state而非复用预激活事实。
- 审计/发布链：release inventory为262/238/24，raw SHA-256`74094fe2…1b4`；跨岗/回退审计raw SHA-256为`50cf7b9c…7135`/`d93a1b24…8083`。source`c2f071c`/tree`3e262bd0`→Supervisor`aa77732`/tree`a734aa13`形成156文件/7,285,043-byte链，manifest raw SHA-256为`3674e011…35fb`，逐blob和唯一父子拓扑通过。
- 验证：最终轻量组合201/201通过，manifest生成后installer再验21/21；11 Python、7 JSON、2 POSIX shell解析、262 inventory零漂移、两生成制品self/source/inventory链、35文件高置信敏感信息和diff门通过。三路最终复核均未发现残留P0/P1。
- 资源/边界：未运行Node全量、build、Docker/Compose/PostgreSQL、Migration、backup/restore、镜像构建/扫描、部署、真实UAT、回退或业务写。收口available约1.2GiB、Swap897/1024MiB、根盘约11GiB、Load`0.24/0.22/0.18`；四服务running、Web/PostgreSQL healthy、restart0/OOM false，宿主`oom_kill=2`无任务内增量，无任务临时容器/manifest temp残留。
- 数据库/API：无Schema、Migration或普通业务API变化；新增的是root固定处理器、PG/卷恢复与postverify合同、helper镜像证据、runtime adapter和发布联锁。真实A4/A6/A7、账号、员工UAT、数据库和生产动作均未授权。
- 治理：TASK82转`DONE`并新增D-157；catalog保持`BLOCKED_MISSING_UAT_CAPABLE_HANDLERS`，TASK70继续等待Swap≤80%和动态证明。自动启动`SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83`为唯一`DOING`，只读归因资源停止线。

### SELFHOST-UAT-PROMOTION-ROLLBACK-FIXED-EXECUTOR-81 - `feat: add fixed UAT rollback executor boundary` / `build: bind fixed UAT rollback executor bundle` / `docs: close fixed rollback executor and start capability handlers`

- 调度/范围：从TASK80最终Supervisor提交`3509a71`/tree`c7d063db`启动唯一active task；只在仓库、fake-root和断网轻量测试中实现fixed executor与activation，不连接真实数据库、不读取Volume/备份、不运行Compose或UAT/生产回退。
- 边界决策：D-156固定九阶段/十三检查closed catalog与trusted-FD manifest v2。catalog明确`BLOCKED_MISSING_UAT_CAPABLE_HANDLERS`，executor验证全部request/descriptor/identity后只返回稳定能力blocker；TEST-only restore和前向Compose controller不能获得UAT执行权。
- activation/Supervisor：content-addressed intent/executor/plan/history/receipt/current/alias/recovery支持install、upgrade、rollback与七个崩溃点fresh-authorization续写。Supervisor v7新增ACTIVATE/ROLLBACK/RECOVER精确授权；能力检查先于授权消费且阻断时不创建activation state。
- installer/恢复：bundle切换联锁逐字段验证activation代际、plan/executor content identity、history/receipt/current/alias/recovery链；partial、额外字段、外来alias或previous/rollback target漂移均失败关闭。
- 审计/发布链：15/15 checkpoint保持SUPPORTED，但UAT能力/host activation、隔离回退演练和人工UAT三项条件继续阻断；`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。source`57f1f4a`/tree`ea4a53b0`→Supervisor`7a1ef56`/tree`cf81fb7b`形成149文件链，manifest raw SHA-256为`bd8cf7c3…3fc1`。
- 验证：Node合同组合80/80、transaction journal71/71、Python installer/launcher/adapter56/56、manifest9/9、installer21/21、inventory262/238/24、cross-role/audit生成物重放、Node syntax、Python AST、凭据扫描1770文件和diff门通过。
- 资源/边界：未运行build、Docker全量测试、Compose/PostgreSQL、backup/restore、Migration、镜像、部署、真实UAT、回退或业务写。收口available约1.4GiB、Swap832/1024MiB、根盘约12GiB、Load`0.64/0.58/0.37`；四服务restart0/OOM false，宿主`oom_kill=2`无任务内增量，无任务临时容器/manifest temp残留。
- 数据库/API：无Schema、Migration或普通业务API变化；只扩展root Supervisor、fixed executor/catalog、activation publisher、gateway trusted manifest、安装联锁和机器审计。真实A4/A6/A7、账号、员工UAT、数据库和生产动作均未授权。
- 治理：新增D-156，TASK81转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-ROLLBACK-CAPABILITY-HANDLERS-82`为唯一`DOING`，实现UAT专用handler与物化边界，TASK70继续等待资源与动态验证依赖。

## 2026-08-15

### SELFHOST-UAT-PROMOTION-ROLLBACK-RUNTIME-ADAPTER-80 - `feat: add trusted UAT rollback runtime gateway` / `build: bind UAT rollback runtime gateway bundle` / `docs: close rollback runtime gateway and start fixed executor`

- 调度/范围：从TASK79最终Supervisor提交`cd9c9de`/tree`e6f035b1`启动唯一active task；只在仓库、fake-root和断网轻量测试中实现受信gateway，不连接真实数据库、不读取Volume/备份、不运行Compose或UAT/生产回退。
- 边界决策：D-155将本任务限定为runtime gateway而非执行权。gateway只接受canonical plan/request/intent、固定activation/executor/Docker/source摘要和root-owned不可写父链；executor通过打开描述符及`/proc/self/fd`启动，环境、argv、deadline、输出和process group均受限。固定executor与activation另立TASK81。
- 观察/保护：运行观察覆盖完整Compose project成员、unexpected writer、数据库和四服务identity、active及retained candidate volumes、derived targets和保护对象；未知container复用任何已知service ID、对象缺失/替换或摘要漂移均失败关闭。
- containment/恢复：unknown/partial最多三次，每次先持久化内容寻址intent，再执行PROBE→CONTAIN→PROBE并写追加式attempt receipt。before/after drift、`STALE_INTENT`、refresh拒绝、非法响应或连续漂移只保全证据并阻断；不得自动删除candidate数据库/Volume或猜测重跑restore/switch。
- 审计/发布链：15/15 checkpoint保持SUPPORTED，但固定executor/activation、隔离回退演练和人工UAT三项条件继续阻断；`assert-ready`精确返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。source`dff6793`/tree`71fb080f`→Supervisor`3509a71`/tree`c7d063db`形成145文件链，manifest raw SHA-256为`b3ecdf11…ab7e5`。
- 验证：runtime contract9/9、Python gateway17/17、containment定向11/11、Python Supervisor/installer59/59、发布链Node组合48/48、manifest门20/20、inventory261/237/24、cross-role/audit生成物重放、Node syntax、Python AST、凭据和diff门通过。定向ESLint曾在192MiB V8 heap下退出134，未提高heap或继续全仓库lint。
- 资源/边界：未运行build、Docker全量测试、Compose/PostgreSQL、backup/restore、Migration、镜像、部署、真实UAT、回退或业务写。收口available约1.3GiB、Swap813/1024MiB、根盘约12GiB、Load`0.04/0.28/0.26`；四服务restart0/OOM false，宿主`oom_kill=2`无任务内增量，无任务临时容器/manifest temp残留。
- 数据库/API：无Schema、Migration或普通业务API变化；只扩展root Supervisor、rollback runtime合同/gateway、journal containment、安装联锁和机器审计。真实A4/A6/A7、账号、员工UAT、数据库和生产动作均未授权。
- 治理：新增D-155，TASK80转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-ROLLBACK-FIXED-EXECUTOR-81`为唯一`DOING`，实现固定executor与activation合同，TASK70继续等待资源与动态验证依赖。

### SELFHOST-UAT-PROMOTION-ROLLBACK-EXECUTOR-79 - `feat: add recoverable UAT rollback checkpoints` / `build: bind UAT rollback supervisor bundle` / `docs: close rollback checkpoints and start runtime adapter`

- 调度/范围：从TASK78最终Supervisor提交`1baa01a`/tree`e3e6b435`启动唯一active task；只在仓库、fake-root和可注入无副作用adapter中实现checkpoint 14/15，不连接真实数据库、不读取Volume/备份、不运行Compose或UAT/生产回退。
- 边界决策：D-154固定checkpoint 14/15使用两个独立短时授权。execution package绑定同promotion/generation、checkpoint 13、精确前代数据库/四域snapshot/Web/Worker/Compose/runtime、三方actor和执行期限；禁止down SQL、直接改账或自动业务冲销。
- Supervisor/事务：新增`ROLLBACK_UAT_RELEASE`与`VERIFY_AND_FINALIZE_UAT_ROLLBACK`，九个rollback stage和十三个postverify check均先写canonical intent、复核immutable source，再接收typed result。preflight先于授权消费，history→receipt→current无覆盖发布，checkpoint 15只提交`ROLLED_BACK`。
- 恢复/联锁：stage/check intent-only、partial、source替换、结果冲突或journal quarantine只调用containment并保全；即使typed result完整也不得越过journal决定，unknown永不自动重跑。全局pending-intent及installer bundle-switch在checkpoint 15前持续阻断。
- 运行时边界：生产adapter故意不进入bundle并在授权消费前失败，fake-root测试才允许注入无副作用adapter。机器审计15项checkpoint全部SUPPORTED，但runtime adapter、隔离回退演练和人工UAT三项动态条件继续阻断（P0=2、P1=1）。
- 审计/发布链：artifact/source-manifest SHA-256为`cc12d613…56187`/`74893a76…39605`；source`1015b53`/tree`d8dc52cb`→Supervisor`cd9c9de`/tree`e6f035b1`形成141文件链，manifest raw SHA-256为`e635792d…4645d`。
- 验证：journal52/52、release contract83/83、审计/跨岗21/21、Python Supervisor71/71、manifest9/9、inventory260/236/24、Node syntax、Python compile、bundle重放、凭据和diff门通过。定向ESLint在192MiB V8 heap下退出134，未提高heap或继续全仓库lint。
- 资源/边界：Swap持续高于80%，未运行typecheck、build、Docker全量测试、Compose/PostgreSQL、backup/restore、Migration、镜像、部署、真实UAT、回滚或业务写。收口available约1.6GiB、Swap870/1024MiB、根盘约12GiB、Load`0.20/0.51/0.36`；四服务restart0/OOM false，宿主`oom_kill=2`无增量，无任务临时容器/manifest temp残留。
- 数据库/API：无Schema、Migration或普通业务API变化；只扩展root Supervisor、rollback合同/控制器、promotion journal、安装联锁和机器审计。真实A4/A6/A7、账号、员工UAT、数据库和生产动作均未授权。
- 治理：新增D-154，TASK79转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-ROLLBACK-RUNTIME-ADAPTER-80`为唯一`DOING`，实现受信runtime adapter，TASK70继续等待资源与动态验证依赖。

### SELFHOST-UAT-PROMOTION-FINAL-RECEIPT-78 - `feat: add UAT promotion final receipt` / `build: bind UAT final receipt supervisor bundle` / `docs: close final receipt and start rollback executor`

- 调度/范围：从TASK77最终Supervisor提交`2798862`/tree`2c74e6b0`启动唯一active task；只在仓库、fake-root和轻量Node/Python中实现checkpoint 13，不创建账号、不访问真实UAT/数据库、不把合成checkpoint 12冒充员工验收。
- 边界决策：D-153固定checkpoint 13只接受同generation ordinal 4—12完整receipt/evidence/intent/authorization严格前缀及全部单调binding；checkpoint 12必须绑定含签字最终result，finalization使用独立15分钟一次性授权。
- Supervisor/事务：新增`FINALIZE_UAT_PROMOTION`、精确root-owned current/cross-role source验证、消费前final intent、全局pending联锁和installer bundle-switch联锁。history→receipt→current无覆盖发布ordinal 13 `PROMOTION_FINAL_RECEIPT / COMMITTED`。
- 恢复：三个failpoint均只用新恢复授权续写；恢复只排除由intent精确计算的本操作目标history/receipt，source替换、授权复用、跨promotion、链/binding漂移和其他unknown partial均保全/quarantine，不重跑UAT/Migration/Compose/postdeploy。
- 审计/发布链：机器审计收敛为13项SUPPORTED、2项P0阻断，人工readiness继续`HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED`。source`c39caad`/tree`f4deb34e`→Supervisor`1baa01a`/tree`e3e6b435`形成138文件链，manifest raw SHA-256为`7dd7a83c…591c3`。
- 验证：Node组合111/111、Python Supervisor65/65、manifest逐字节重放、inventory259/235/24及generator/syntax/JSON/diff/敏感门通过。首次完整journal 47/48暴露staged回执恢复缺口，精确修复后定向1/1及完整48/48通过，未降低断言。
- 资源/边界：Swap持续高于80%，未运行typecheck、全量测试、Docker build、Compose/PostgreSQL、backup/restore、Migration、镜像、部署、真实UAT、回滚或业务写。收口available约1.8GiB、Swap858/1024MiB、根盘约13GiB、Load`0.74/0.51/0.31`；四服务restart0/OOM false，宿主`oom_kill=2`无增量，临时Node目录已清理。
- 数据库/API：无Schema、Migration或普通业务API变化；只扩展root Supervisor、promotion journal、安装联锁和机器审计。真实A4/A6/A7、账号、员工UAT、数据库和生产动作均未授权。
- 治理：新增D-153，TASK78转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-ROLLBACK-EXECUTOR-79`为唯一`DOING`，关闭checkpoint 14/15，TASK70继续等待资源与完整执行器依赖。

### SELFHOST-UAT-CROSS-ROLE-TRANSACTION-77 - `feat: add cross-role UAT promotion checkpoint` / `build: refresh release supervisor bundle manifest` / `docs: close cross-role checkpoint and start final receipt`

- 调度/范围：从TASK76最终Supervisor提交`694f485`/tree`45007b67`启动唯一active task；只在仓库、fake-root和轻量Node/Python中实现checkpoint 12，不创建账号、不访问真实UAT/数据库、不执行业务写或伪造员工签字。
- 边界决策：D-152固定非循环双摘要。全部4条workflow的32步骤、32控制、6冲销先完成并计算预签名全局`evidence_subject_sha256`，所有执行/观察/业务签字必须晚于全局执行完成；最终`result_sha256`再封装签字并由checkpoint发布。
- Supervisor/事务：新增独立`VERIFY_UAT_CROSS_ROLE_EXECUTION`授权、精确checkpoint 11/bundle/合同/矩阵/result/source/actor绑定、消费前intent和全局pending联锁。internal result→history→receipt→current无覆盖发布ordinal 12，journal保持IN_PROGRESS。
- 恢复：四个failpoint均可恢复。内部root-owned 0400 result同步后只依赖该精确raw/logical SHA、不可变bundle合同和checkpoint 11续写；external staging删除、替换或窗口过期不触发UAT重跑，内部副本不存在时仍严格复验外部source。
- 审计/发布链：机器审计收敛为12项SUPPORTED、3项P0阻断，人工readiness继续`HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED`。source`018586d`/tree`e7da7106`→Supervisor`2798862`/tree`2c74e6b0`形成138文件链，manifest raw SHA-256为`d5398d78…b2ce2`。
- 验证：Node组合62/62、journal4/4、Python UAT29/29、launcher/installer31/31、manifest定向4/4、inventory259/235/24及generator/syntax/JSON/diff/敏感门通过；未跳过或降低断言。
- 资源/边界：Swap持续高于80%，未运行typecheck、全量测试、Docker build、Compose/PostgreSQL、backup/restore、Migration、镜像、部署、真实UAT、回滚或业务写。收口available约1.9GiB、Swap887/1024MiB、根盘约13GiB、Load`0.08/0.21/0.21`；四服务restart0/OOM false，宿主`oom_kill=2`无增量。
- 数据库/API：无Schema、Migration或普通业务API变化；只扩展root Supervisor、结构化UAT结果合同、promotion journal和机器审计。真实A4/A6/A7、账号、员工UAT、数据库和生产动作均未授权。
- 治理：新增D-152，TASK77转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-FINAL-RECEIPT-78`为唯一`DOING`，先关闭checkpoint 13单调终态回执，TASK70继续等待资源与rollback执行器依赖。

### SELFHOST-UAT-POSTDEPLOY-TRANSACTION-76 - `feat: integrate postdeploy promotion checkpoints` / `fix: bind postdeploy results before publication` / `build: refresh release supervisor bundle manifest` / `docs: close postdeploy transaction and start cross-role checkpoint`

- 调度/范围：从TASK75最终Supervisor提交`86be6d4`/tree`006c2309`启动唯一active task；只在仓库、fake-root、受限Node与可注入postdeploy adapter中实现checkpoint 10/11，不运行真实postdeploy、Compose、数据库或修改UAT/生产。
- 边界决策：D-151固定runtime configuration与strict identity使用两个不同的一次性Supervisor v6授权；消费前intent绑定同一promotion、checkpoint 9 receipt/result/transfer、manifest、Compose、四服务、runtime policy及三方actor，checkpoint 11后journal仍为IN_PROGRESS。
- Supervisor/runtime：postdeploy统一使用Supervisor受信Node，子进程进入独立process group并按TERM→最多30秒→KILL收敛；阶段化containment/anomaly、全局interlock和trusted-root/partial分类覆盖失败与恢复。
- 发布前绑定：只有原始postdeploy execute接收外部control digest。journal在任何result/history/receipt/current发布前持久化单一、不可变、自摘要的`postdeploy-control-bindings`并复核；缺失、不匹配、重复、不同binding、source替换、runtime漂移和`.publish.tmp`均失败关闭或保全/quarantine。
- 回执/恢复：checkpoint 10/11按history→receipt→current无覆盖发布，保持完整授权摘要链；恢复只从同一精确binding和完整result继续，不猜测重跑postdeploy、不删除容器/证据或修改数据库。
- 审计/发布链：机器审计保持11项SUPPORTED、4项阻断并继续拒绝；独立只读复核未发现P0/P1/P2。source`8c7d51c`/tree`49ac3a2c`→binding fix`2309927`/tree`ddae0954`→Supervisor`694f485`/tree`45007b67`形成134文件链，manifest raw SHA-256为`ccb0e462…f03d`。
- 验证：journal40/40、Python launcher/UAT37/37、postdeploy17/17、audit/cross-role18/18、release gate/manifest29/29、installer/generator18/18、inventory258/234/24，以及Python/Node/shell语法、bundle重放、高置信凭据和diff门通过；未跳过或降低断言。
- 资源/边界：Swap持续高于80%，未运行typecheck、全量测试、Docker build、Compose/PostgreSQL、backup/restore、Migration、镜像、部署、回滚或业务写。收口available约1.9GiB、Swap889/1024MiB、根盘约13GiB、Load`2.76/1.38/0.73`；四服务restart0/OOM false，精确临时Node目录已清理。
- 数据库/API：无Schema或Migration文件变化，不改变普通业务API；只扩展root Supervisor、promotion journal和postdeploy控制边界。真实A4/A6、账号、员工UAT、数据库和生产动作均未授权。
- 治理：新增D-151，TASK76转`DONE`；自动启动`SELFHOST-UAT-CROSS-ROLE-TRANSACTION-77`为唯一`DOING`，先把跨岗证据合同接入checkpoint 12，真实员工执行仍受外部输入/授权阻塞，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-COMPOSE-DEPLOY-75 - `feat: add fenced UAT compose deployment checkpoint` / `fix: expand supervisor bundle for deployment controls` / `build: bind compose deployment supervisor bundle` / `docs: close compose deployment and start postdeploy transaction`

- 调度/范围：从TASK74最终Supervisor提交`52242f8`/tree`6a20ec8f`启动唯一active task；只在仓库、fake-root、可注入Compose/database adapter和当前daemon只读metadata中实现checkpoint 9，不运行真实Compose、连接数据库或修改UAT/生产。
- 边界决策：D-150固定checkpoint 9使用独立最长15分钟deployment authorization；只替换精确Web/Worker，PostgreSQL、Caddy、Compose project/working directory、网络和四个受保护Volume必须不变。数据库handoff只在新两服务身份、digest、启动、health及runtime configuration全部验证后发生。
- Supervisor/事务：新增`DEPLOY_UAT_RELEASE`与精确RECOVER路径，deployment intent及旧/新容器计划先于授权消费；ordinal-8前代、promotion/candidate/runtime/database/snapshot、Migration result/active fence、manifest、Web/Worker digest、Compose source和三方actor完整绑定。checkpoint 9按history→receipt→current无覆盖发布。
- 部署控制：新增deployment contract/control；production adapter固定`create --no-build --pull never --force-recreate --no-deps`且只接受Supervisor派生输入。完整四服务/保护面before-after校验、新Web/Worker health/runtime验证及单一database handoff形成不可变deployment result与active-fence transfer双结果。
- 恢复/联锁：checkpoint 8 active fence只允许精确checkpoint 9部署或对应恢复接管。完整result+transfer只重放journal发布；malformed/partial/漂移先emergency seal数据库并只停止精确operation+authorization候选，随后保全/quarantine，不猜测重跑或删除未知容器/证据。
- 审计/发布链：机器审计收敛为11项SUPPORTED、4项阻断（P0=3、P1=1），artifact/source-manifest为`881ca1cf…c7119`/`b6f01c11…a98c`且`assert-ready`继续拒绝。source`d383c10`/tree`d900fd6b`→cap fix`c6c4864`/tree`2627d383`→Supervisor`86be6d4`/tree`006c2309`形成132文件链，manifest raw SHA-256为`249d28fe…3071`。
- 验证：受限Node事务/部署35/35、跨岗/manifest/审计26/26，Python Supervisor50/50，inventory258/234/24、bundle逐字节重放、7文件内存编译、凭据扫描1,751文件及diff检查通过；未跳过或降低断言。
- 资源/边界：Swap持续高于80%，未运行typecheck、全量测试、Docker build、Compose/PostgreSQL动态测试、backup/restore、Migration、镜像、部署、回滚或业务写。收口available约1.9GiB、Swap881/1024MiB、根盘约13GiB、Load低；四服务restart0/OOM false，宿主`oom_kill=2`不作新OOM归因；任务临时Node目录已清理。
- 数据库/API：无Schema或Migration文件变化，不改变普通业务API；只扩展root Supervisor、promotion journal与部署控制器。真实A4/A6、数据库围栏交接、账号、UAT/生产和数据动作均未授权。
- 治理：新增D-150，TASK75转`DONE`；只读核对确认既有postdeploy工具尚未进入promotion journal，自动启动`SELFHOST-UAT-POSTDEPLOY-TRANSACTION-76`为唯一`DOING`，先事务化checkpoint 10/11，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-MIGRATION-COMMIT-74 - `feat: add fenced UAT migration commit adapter` / `fix: bound expanded supervisor bundle` / `chore: publish UAT migration supervisor bundle` / `docs: close migration commit and start compose deployment`

- 调度/范围：从TASK73最终Supervisor提交`302661c`/tree`0a05618b`启动唯一active task；只在仓库、fake-root、模拟数据库与只读Docker metadata中实现checkpoint 8，不连接真实数据库、不执行Migration、不修改UAT/生产。
- 边界决策：D-149固定checkpoint 8使用独立最长15分钟execution authorization/grant；checkpoint 7批准SHA不可复用。成功后的database active fence必须保持到checkpoint 9精确接管或同operation保全恢复，未知/部分结果不得重跑SQL、运行down SQL或自动释放writer。
- Supervisor/事务：新增`RUN_UAT_PROMOTION_MIGRATION`与精确RECOVER路径，execution intent先于授权消费；ordinal-7前代、promotion/candidate/runtime/database/snapshot/quiesce/approval、allowlist、current/target head、角色和三方actor完整绑定。checkpoint 8继续按history→receipt→current无覆盖发布。
- 数据库/执行器：完整release artifact目录在源root identity前后重验并冻结；控制器在任何业务SQL前验证released角色/ACL/session基线，设置default-read-only、CONNECT/connection-limit围栏，只启动精确worker digest/label的Migration容器。SQL lexer拒绝顶层事务控制，每文件单事务并在commit前复核deadline/identity/ledger，最终核对完整有序`schema_migrations`摘要并把数据库seal为零连接。
- 恢复/联锁：active fence阻断除同一operation精确恢复外的全部Supervisor操作。恢复先emergency seal数据库，再按operation+grant唯一label定位候选并stop→kill→退出证明；已消费未执行、部分提交、结果/围栏/发布未知均保全/quarantine，不删除容器或证据。
- 审计/发布链：机器审计收敛为10项SUPPORTED、5项阻断（P0=4、P1=1），artifact/source-manifest为`e4aa3687…e2fc`/`53a1515a…4239`且`assert-ready`继续拒绝。source`ce7bb23`/tree`f5043439`→fix`5610a0d`/tree`26edea69`→Supervisor`52242f8`/tree`6a20ec8f`形成130文件链，manifest raw SHA-256为`17efe85d…aad5`。
- 验证：受限Node专项120/120、Python专项57/57、inventory258/234/24、Python compile、Node/TS syntax、cross-role/audit生成物重放、发布门、凭据扫描30+3文件及diff检查通过；未跳过或降低断言。
- 资源/边界：Swap持续高于80%，未运行typecheck、全量测试、Docker build、Compose/PostgreSQL动态测试、backup/restore、Migration、镜像、部署、回滚或业务写。收口前available 1.9GiB、Swap879/1024MiB、根盘12,699MiB、Load`0.33/0.26/0.16`；四服务restart0/OOM false。宿主`oom_kill=2`缺同窗口起点，不作增量结论；两个临时Node目录精确清零。
- 数据库/API：无Schema或Migration文件变化，不改变普通业务API；只扩展root Supervisor、Migration受控入口和运行连接身份。真实A4/A6、数据库围栏、账号、UAT/生产和数据动作均未授权。
- 治理：新增D-149，TASK74转`DONE`；自动启动`SELFHOST-UAT-COMPOSE-DEPLOY-75`为唯一`DOING`，以独立部署授权关闭checkpoint 9，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-MIGRATION-TRANSACTION-73 - `feat: add UAT migration approval checkpoint` / `chore: refresh monitoring delivery manifest` / `chore: refresh release supervisor manifest` / `docs: close migration approval and start commit receipt`

- 调度/范围：从TASK72最终Supervisor提交`ad98661`/tree`8912ce10`启动唯一active task；原计划覆盖checkpoint 7/8，只在仓库/fake-root/可注入client中核对与实现，不连接数据库、不运行Migration或修改UAT/生产。
- 边界决策：D-148确认授权SHA不得跨检查点复用，数据库client/session/role围栏只能在执行窗口证明，因此TASK73收敛为checkpoint 7批准，checkpoint 8独立为TASK74。批准intent固定`APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE`，不得把批准回执冒充执行权。
- Supervisor/事务：authorization v6新增`AUTHORIZE_UAT_PROMOTION_MIGRATION`；短时三方授权精确绑定ordinal-6、promotion/quiesce/candidate/runtime/database、current/target head、allowlist、Migration角色与四个权威source。intent先于授权消费，checkpoint 7通过history→receipt→current发布非零binding，RECOVER覆盖三个发布崩溃点并对替换、链接、冲突和未知状态保全/quarantine。
- SQL失败关闭：受控release evidence存在时，`migrate-postgres.ts`在数据库pool创建前调用执行adapter门并返回`MIGRATION_SUPERVISOR_EXECUTION_ADAPTER_NOT_IMPLEMENTED`。旧`ERP_ALLOW_PRODUCTION_MIGRATION`/`ERP_MIGRATION_CONFIRM`可参与legacy证据验证，但不能授权受控SQL；隔离测试入口保持独立。
- 审计/发布链：机器审计收敛为9项SUPPORTED、6项阻断（P0=5、P1=1），artifact self SHA-256为`ed37e980…e520`且`assert-ready`继续拒绝。source`32860b8`/tree`b950a299`→monitor`18b93e9`/tree`a5967c5b`→Supervisor`302661c`/tree`0a05618b`形成30/128文件链，manifest raw SHA-256为`59ea1084…7c0`/`090c3a23…800`。
- 验证：Supervisor专项9/9、受限Node三个专项37/37、monitor host delivery14/14、installer17/17、targeted ESLint、Python compile、Node syntax、凭据扫描、生成物重放和diff检查通过；未跳过或降低断言。
- 资源/边界：起点/收口available约1.9GiB、Swap868MiB/1GiB、根盘13GiB、Load低且未持续越线；四个项目容器restart0/OOM false。只运行192MiB/0.5 CPU断网只读Node临时容器和轻量Python，未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、backup/restore、Migration、镜像、Compose、部署、回滚或业务写。
- 数据库/API：无Schema、Migration文件或业务API变化；仅扩展root Supervisor、promotion journal和Migration执行前门。真实A4/A6、数据库围栏、账号、UAT/生产和数据动作均未授权。
- 治理：新增D-148，TASK73转`DONE`；自动启动`SELFHOST-UAT-MIGRATION-COMMIT-74`为唯一`DOING`，以独立执行授权关闭checkpoint 8，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-WRITER-QUIESCE-72 - `feat: add UAT writer quiesce checkpoint` / `chore: refresh monitoring delivery manifest` / `chore: refresh release supervisor manifest` / `docs: close writer quiesce and start migration transaction`

- 调度/范围：从TASK71最终Supervisor提交`bc339b6`/tree`f7fd37bd`启动唯一active task；只实现仓库quiesce adapter和fake-root恢复，不停止/启动容器、不连接数据库、不读取备份/Volume或修改UAT/生产。
- 边界决策：D-147只把同一Compose project/working directory内的原Web/Worker纳入持续静默证明。未标注容器、其他主机及外部数据库client不在checkpoint 6证明范围，必须由TASK73的数据库连接围栏关闭，禁止把容器metadata冒充全局停写。
- Supervisor/事务：authorization v6新增`QUIESCE_UAT_WRITERS`；独立短时operation ID、三方actor和精确source metadata在prepare前、消费前、消费后重验。quiesce intent先于消费，checkpoint 6通过history→receipt→current发布非零writer binding，RECOVER精确绑定原已消费授权和intent。
- 只读证据：production probe固定`/usr/bin/docker`、无shell、净化环境和有界输出，只读取精确容器metadata；要求snapshot绑定的Web/Worker同ID/名称/镜像/runtime/Migration、stopped/exited 0、restart0/OOM false、未在snapshot后重启且无同project替代writer。running/restarted/replaced/extra writer和身份漂移均失败关闭。
- 审计/发布链：审计收敛为8项SUPPORTED、7项阻断（P0=6、P1=1），artifact self SHA-256`7085cd75…3fc`且`assert-ready`继续拒绝。source`8ab249e`/tree`af751336`→monitor`55c1b91`/tree`2f5005c0`→Supervisor`ad98661`/tree`8912ce10`形成30/128文件链，manifest为`c369bc16…70eb`/`4704aad8…ab5`。
- 验证：受限Node专项合计62/62、Supervisor Python112/112、monitor manifest31/31、Supervisor manifest40/40、inventory257/233/24、cross-role/audit生成物重放、Python compile、Node syntax、只读Docker Go template及diff/敏感门通过；未跳过或降低断言。
- 诚实失败：第一次只读Docker template验证使用了不完整的猜测容器ID，精确返回`No such container`且无副作用；改为只读列出完整ID后，对同一选定字段的template语法验证通过。`docker compose ps`没有重试或通过读取`.env`绕过既有插值保护。
- 资源/边界：起点/收口available约1.9GiB、Swap868MiB/1GiB、根盘13GiB、Load未持续越线；四个项目容器restart0/OOM false，受限Node临时容器自动清理，两个既有额外容器未触碰。未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、backup/restore、Migration、镜像、部署、回滚或业务写。
- 数据库/API：无Schema、Migration或业务API行为变化；只扩展root Supervisor仓库控制面。真实A4/A6、writer、数据库、账号、UAT/生产和数据动作均未授权。
- 治理：新增D-147，TASK72转`DONE`；自动启动`SELFHOST-UAT-MIGRATION-TRANSACTION-73`为唯一`DOING`，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-PROMOTION-BOUND-SNAPSHOT-71 - `feat: bind promotion snapshot checkpoint` / `chore: refresh monitoring delivery manifest` / `chore: refresh release supervisor manifest` / `docs: close bound snapshot and start writer quiesce`

- 调度/范围：从TASK69最终Supervisor提交`a3fbbfd`/tree`5e275be8`启动唯一active task；只实现仓库snapshot adapter和fake-root恢复，不停止writer、不连接数据库、不读取备份/Volume或修改UAT/生产。
- 依赖决策：源码核对确认`backup-selfhost.sh`要求精确Web/Worker在采集前后均停止，采集四域并只释放数据库fence、不重启writer。D-146保持checkpoint 5→6顺序：V4证明采集时停写，下一检查点再证明Migration前持续停写。
- Supervisor/事务：authorization v6新增`CAPTURE_UAT_PROMOTION_SNAPSHOT`；独立短时operation ID、三方actor和精确source metadata在prepare前、消费前、消费后重验。snapshot intent先于消费，checkpoint 5通过history→receipt→current发布非零snapshot binding，RECOVER v2精确绑定原已消费授权和intent。
- 证据边界：生产路径完整验证V4 actual-offhost、V2 policy/activation、current release identity、同promotion/candidate/database/runtime及本授权窗口新鲜性；绑定PostgreSQL/uploads/attachments/backup-status四域及inner restore、joint transfer、cluster security、credential、tablespace、final state和activation。旧、synthetic、same-host、cross-database、缺域或partial失败关闭。
- 审计/发布链：审计收敛为7项SUPPORTED、8项阻断（P0=7、P1=1），artifact self SHA-256`a7004c2e…1eae9`且`assert-ready`继续拒绝。source`e8dea20`/tree`8c29bc22`→monitor`7c645ab`/tree`8861d444`→Supervisor`bc339b6`/tree`f7fd37bd`形成30/128文件链，manifest为`5c0ccda1…b27b`/`5889e746…cabe`。
- 验证：受限Node专项62/62、monitor15/15、Supervisor Python110/110、monitor Python14/14、inventory257/233/24、cross-role 4链/32步骤、生成物重放、1742文件凭据扫描及diff/敏感门通过；未跳过或降低断言。
- 诚实失败：cross-role生成器首次在不完整Site-only挂载中返回`UNSAFE_REPOSITORY_PATH`，恢复完整仓库布局后同一验证通过；凭据扫描首次因固定Node镜像无Git失败，改由宿主Git生成不含受保护未跟踪路径的显式排序清单后通过并精确清理；`docker compose ps`因未读取`.env`且缺必需插值变量退出1，精确Docker inspect仍确认四服务running/restart0/OOM false，未修改环境或Compose。
- 资源/边界：起点/收口available约1.9GiB、Swap由约867MiB至868MiB/1GiB、根盘13GiB、Load低于1；Swap持续超过80%停止线，仅运行单个受限Node容器和轻量Python，临时容器自动清理。未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、backup/restore、Migration、镜像、部署、回滚或业务写。
- 数据库/API：无Schema、Migration或业务API行为变化；只扩展root Supervisor仓库控制面。真实A4/A6、writer、账号、UAT/生产和数据动作均未授权。
- 治理：新增D-146，TASK71转`DONE`；自动启动`SELFHOST-UAT-WRITER-QUIESCE-72`为唯一`DOING`，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-PROMOTION-TRANSACTION-JOURNAL-69 - `feat: add UAT promotion transaction journal` / `release: bind monitoring bundle to promotion journal` / `release: bind supervisor bundle to promotion journal` / `docs: close promotion journal and start bound snapshot`

- 调度/范围：从TASK68最终Supervisor提交`1c70602`/tree`46ec0e9a`启动唯一active task；只实现仓库事务控制与fake-root恢复，不连接数据库、读取备份/Volume或修改UAT/生产。
- 事务合同：新增版本化policy与1,120行journal，固定15检查点、候选/manifest/镜像/Migration/runtime/数据库/恢复证据/三方actor；intent先于授权消费持久化，generation/history/receipt为内容寻址无覆盖对象，current为核验前代后的原子指针，文件与目录逐级fsync。
- Supervisor/恢复：新增authorization v6及`BEGIN_UAT_PROMOTION`/`RECOVER_UAT_PROMOTION`，窗口最多60分钟且requester/approver/executor互异；恢复新授权精确绑定原已消费授权和原intent，可证明partial收敛，替换/断链/hardlink/symlink/过期只写recovery/quarantine并保留现场。
- 失败关闭：checkpoint严格单调并绑定同一intent/candidate/database/runtime/recovery/snapshot和完整唯一授权摘要链；跳步、隔步授权复用、UNKNOWN/PARTIAL继续、跨代或摘要漂移拒绝。其余snapshot/quiesce/Migration/Compose/postdeploy/UAT/rollback adapter保持NOT_IMPLEMENTED。
- 审计/发布链：审计由5项SUPPORTED/10项阻断收敛为6项SUPPORTED/9项阻断（P0=8、P1=1），artifact/source-manifest为`353abf12…5a67`/`68fd118d…1f91`且`assert-ready`继续拒绝。source`175873a`/tree`c7bfcfb2`→monitor`c2d9944`/tree`e50b7a50`→Supervisor`a3fbbfd`/tree`5e275be8`形成30/128文件链，manifest为`292d8aea…65b8`/`ff086ff7…a412`。
- 验证：事务7/7、审计8/8、release合同57/57、Supervisor108/108、inventory257/233/24、credentials 1,740文件、JSON/AST及diff门通过；未跳过或降低断言。
- 资源/边界：收口available约1.9GiB、Swap867MiB/1GiB、根盘13GiB、Load`0.69/0.37/0.22`；四服务restart0/OOM false，Web/PostgreSQL healthy，临时容器及扫描清单清零。未运行build、backup、Compose/PostgreSQL、Migration、镜像、快照、恢复、部署、回滚或业务写。
- 数据库/API：无Schema、Migration或业务API行为变化；只新增root Supervisor仓库控制面。真实A1/A6、备份恢复、账号、UAT/生产和数据动作均未授权。
- 治理：新增D-145，TASK69转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-BOUND-SNAPSHOT-71`为唯一`DOING`，TASK70继续等待资源与执行器依赖。

### SELFHOST-UAT-PROMOTION-ROLLBACK-CHECKPOINT-AUDIT-68 - `test: audit UAT promotion rollback checkpoints` / `release: bind monitoring bundle to UAT audit source` / `release: bind supervisor bundle to UAT audit source` / `test: update UAT audit runtime policy anchor` / `release: rebind monitoring bundle after audit anchor fix` / `release: rebind supervisor bundle after audit anchor fix` / `docs: close promotion audit and start transaction journal`

- 调度/范围：从TASK67最终Supervisor提交`186e117c`/tree`c36d57a9`启动唯一active task；只读审计candidate、预部署、快照/备份、Migration、Compose部署、postdeploy、业务UAT和回退后复核，不连接数据库或修改UAT/生产。
- 机器审计：新增版本化policy、确定性generator、canonical artifact和人读报告，绑定15个有序检查点与15个权威源码文件。artifact/source-manifest SHA-256为`c0a5a561…6f24d`/`eab97c64…de093`。
- 结论/失败关闭：当前只有5项SUPPORTED，10项阻断（P0=9、P1=1）；19个Supervisor操作中7个必需晋升/回滚操作实现0个。restore仍TEST-only、Migration授权仍为可重复环境确认、Compose digest override没有晋升回执、TASK67人工UAT仍BLOCKED；`assert-ready`精确返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 发布链：release inventory更新为256/232/24；最终source`79e4e80`/tree`a756b1b0`→monitor manifest-only`84a2c78`/tree`4de5f247`→Supervisor manifest-only`1c70602`/tree`46ec0e9a`形成30/126文件chain，manifest raw SHA-256为`9c1e9052…5ac39`/`56009eb7…12b5`且逐字节重放一致。早先`7257034→3795a15→dba6066`链因Python摘要锚点漂移只保留历史审计价值。
- 验证：专项8/8、release gate+manifest合同29/29、Supervisor Python105/105、inventory verify、credentials 1,734文件及diff门通过。第一次完整Supervisor复跑诚实发现旧runtime-policy摘要锚点1/105失败，精确更新后原105项全部通过，未跳过或降低断言。
- 资源/边界：起点available约1.9GiB、Swap863MiB/1GiB，收口约1.9GiB/865MiB，根盘13GiB、Load低；四服务restart0/OOM false，Web/PostgreSQL healthy，临时容器0。Swap持续超过80%，未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、Migration、镜像、快照、恢复、部署或业务写。
- 数据库/API：无Schema/Migration或业务API行为变化；新增审计和发布拒绝门，不声称缺失执行器已实现。动态Compose/隔离PostgreSQL验收已拆为TASK70`BLOCKED`。
- 治理：新增D-144，TASK68转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-TRANSACTION-JOURNAL-69`为唯一`DOING`，先闭合内容寻址promotion transaction journal和BEGIN/RECOVER，不触发任何真实适配器。

### SELFHOST-CROSS-ROLE-UAT-EVIDENCE-CONTRACT-67 - `test: lock cross-role UAT evidence contract` / `test: refresh supervisor runtime policy anchor` / `build: refresh monitoring host bundle` / `build: refresh release supervisor bundle` / `docs: close cross-role UAT evidence and start promotion rollback audit`

- 调度/范围：从TASK66最终Supervisor提交`9b657f24`/tree`2f104665`启动唯一active task；只在仓库审计核心业务链、授权矩阵和既有测试，不创建/登录账号，不连接数据库或修改UAT/生产。
- 合同：新增canonical policy、确定性generator、artifact与人读执行/签字文档，固定4条核心链、32步骤、6检查点/冲销分支、32控制项和16类证据源。artifact/证据manifest SHA-256为`0068b8aa…6f5`/`a7900553…0fc`。
- 失败关闭：每条链逐步绑定TASK66角色、permission、method/path、data domain与源码摘要，并覆盖403、CSRF、幂等重放/冲突、CAS、事务失败零半记录、追加式冲销及audit/request ID；批准、账号/角色映射、范围、窗口、停止条件、回退责任和三方签字为空时整体保持`BLOCKED`。
- 发布链：最终source`ac4f294d`/tree`8ae8a12a`→monitor manifest-only`c70b6bfc`/tree`3b09213f`→Supervisor manifest-only`186e117c`/tree`c36d57a9`形成30/126文件chain，manifest raw SHA-256为`f90a6609…eee3`/`5e2f8ba7…7254`且逐字节重放一致。旧`b8495dc→bb1da17→7b7bbd1`链仅保留历史审计价值。
- 验证：专项9/9、release gate20/20、授权矩阵10/10、release manifest9/9、Supervisor Python105/105、inventory255/231/24、credentials1728及diff门通过。第一次bundle后完整Supervisor回归诚实发现旧runtime-policy摘要锚点1/105失败，精确修正后原断言全通过，未跳过或降低断言。
- 资源/边界：available约1.9GiB、Swap约860MiB/1GiB且超过80%、根盘约13GiB、Load低；四服务restart0/OOM false，临时资源清零。未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、Migration、镜像、真实快照/恢复或业务写。
- 数据库/API：无Schema/Migration或业务API行为变化；只增加合成证据合同与release门。真实A7d—A7f仍未授权，系统保持`PRODUCTION NO-GO`。
- 治理：新增D-143，TASK67转`DONE`；自动启动`SELFHOST-UAT-PROMOTION-ROLLBACK-CHECKPOINT-AUDIT-68`为唯一`DOING`，停止线解除前先做逐检查点仓库静态/轻量合成审计，不以此冒充Compose/PostgreSQL动态验收。

### SELFHOST-AUTHORIZATION-ROLE-PERMISSION-MATRIX-66 - `feat: lock application authorization matrix` / `build: refresh monitoring host bundle` / `build: refresh release supervisor bundle` / `docs: close role matrix and start cross-role UAT evidence`

- 调度/范围：从TASK65最终Supervisor提交`7c69385c`/tree`7d19d1d9`启动唯一active task；只在仓库审计11角色、动态permission、Dashboard domain及全部self-hosted handler，不创建账号、连接数据库或修改UAT/生产。
- 机器矩阵：新增canonical policy、186条route contract、确定性generator和artifact；固定158个授权permission、154个源码使用permission、30个dispatcher handler、56个授权源码文件、254个route literal及11角色逐操作决策。artifact/source-manifest SHA-256为`741bb742…9a34`/`2c4870ca…1863`。
- 失败关闭：175条受保护操作均有允许证据；154条有明确拒绝，21条当前全员只读以业务待批准finding阻断，110条受保护写全部绑定CSRF、幂等和事务审计。admin是唯一通配但不是任何操作的唯一正向证据；2个legacy grant等待业务处置。
- 发布链：release inventory更新为254/230/24并绑定矩阵测试；source`925f8a45`/tree`922221a6`→monitor manifest-only`c1f1d526`/tree`edc80361`→Supervisor manifest-only`9b657f24`/tree`2f104665`形成30/126文件链，manifest raw SHA-256为`3a9192af…b6f6`/`66a604fa…0da6`且逐字节重放一致。
- 验证：授权矩阵10/10、release gate20/20、release manifest contract9/9、Supervisor Python36/36、inventory verify、源码阶段1,722文件credentials、治理收口1,723文件显式staged-tree credentials、10文件本地Markdown链接及`git diff --check`通过。首轮release计数锁真实失败已修复；BusyBox `flock`差异改用锁定Debian Node重跑同一断言通过，未跳过或降低断言。
- 资源/边界：available约1.9GiB、Swap约860MiB/1GiB且持续超过80%、根盘13GiB、Load低于1；四服务restart0/OOM false，临时容器/扫描文件清零。未运行build、全量Node/PostgreSQL、typecheck、Migration、镜像或数据库任务，未读凭据、日志、业务行、备份/Volume正文或用户未跟踪报告。
- 数据库/API：无Schema/Migration或服务端行为变化；仅把Dashboard role-domain常量导出给同一源码验证器，并新增授权证据与发布负向门。A7d岗位职责、21条全员只读和legacy grant处置仍为业务待批准，系统保持`PRODUCTION NO-GO`。
- 治理：新增D-142，TASK66转`DONE`；因Swap停止线阻断0017→0046 PostgreSQL重任务，自动启动`SELFHOST-CROSS-ROLE-UAT-EVIDENCE-CONTRACT-67`，先建立断网、无账号/无数据库写的跨岗合成证据与签字合同。

### SELFHOST-OPS-MONITORING-HOST-DELIVERY-61 - `feat: add crash-safe monitoring host delivery` / `build: pin monitoring host delivery bundle` / `build: refresh release supervisor bundle` / `docs: close monitoring host delivery`

- 交付：新增27文件内容寻址monitor bundle、Node 22.13—24内容寻址runtime、root collector/非特权evaluator/notifier、七个固定systemd unit/timer、严格private/evaluator/notifier配置view以及Release Supervisor的install/rollback/disable三项一次性授权入口。
- 事务：installer要求同一inode的全局Supervisor FLOCK及独立install锁，materialize后冻结三phase，按active switch→effective systemd verify→durable COMMITTED journal/receipt→activation publication收口；稳定重试、显式已提交rollback及disable-and-preserve均失败关闭，物理删除不在范围。
- 监控/投递：补齐root components/backup投影解析与单调watermark、future-time/回退拒绝、完整内容observation ID、崩溃安全state/outbox、grant/claim/attempt/result/ACK链、HTTPS断连失败关闭、至少一次语义和原子delivery readiness；HTTP 2xx或send返回不能单独成为delivered。
- 安全：notifier默认`IPAddressDeny=any`，真实出口必须另获内容寻址策略与专项网络授权；没有安装host、创建账号、写systemd、读取真实渠道凭据或发送通知。权威postdeploy/V4 recovery投影producer转交TASK62，缺失继续`NOT_COLLECTED`。
- 不可变链：source`b057f81b989eab07a4a40603c6a2a4486f326ee1`/tree`a571800f83d38209603e2bfe2a3e35b71bd2eb2b`→monitor manifest-only`3327be43d026d83477fff9e79a0eb0f090902e86`/tree`23da2f11b1ae9f6612063c0b8b4634cbf2ac11b7`→Supervisor manifest-only`222584c03cd016c69daa96013c6420dfcbfc5647`/tree`2286082369969dd6c8b94df2aeb227dbac2f3e72`；27/105文件manifest为`6782ec58…aea07`/`56157a68…efcb`且逐字节重放一致。
- 验证：固定断网只读Node 22容器通过monitor+delivery`30/30`和release contract`20/20`；Python Supervisor launcher+delivery`23/23`；Python AST5、JSON4、inventory摘要、双manifest replay、敏感模式与diff门通过。Swap持续超过80%，未运行build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- 数据库/API：无Schema、Migration或业务API变化；未连接UAT/生产数据库，未读业务行、备份/Volume正文、日志、`.env`或用户未跟踪状态报告。
- 治理：新增D-137，TASK61转`DONE`；自动启动`SELFHOST-OPS-MONITORING-PROJECTION-PUBLISHERS-62`为唯一`DOING`。系统仍`PRODUCTION NO-GO`。

### SELFHOST-OPS-MONITORING-PROJECTION-PUBLISHERS-62 - `docs: start authoritative monitoring projections` / `feat: publish authoritative monitoring projections` / `release: bind monitoring projection layout bundle` / `build: pin monitoring projection supervisor bundle` / `docs: close authoritative projections and start recovery policy v2`

- 调度：从TASK61最终Supervisor manifest-only提交`222584c03cd016c69daa96013c6420dfcbfc5647`/tree`2286082369969dd6c8b94df2aeb227dbac2f3e72`启动唯一active task。
- 目标：只在仓库和合成隔离环境从installed Supervisor/postdeploy与V4 recovery权威回执生成root-only、最小去敏、单调、崩溃安全的components/backup投影，禁止调用者自报摘要或旧证据冒充当前健康。
- 发布器：新增Supervisor专用components/backup双入口和内容寻址Node发布器；授权消费前后多次固定源路径/SHA/bytes/dev/inode/uid/gid/mode/nlink，components重构current release identity，backup默认只接受当前且未过期的V4 `ACTUAL_OFFHOST + RECOVERY_READY`。
- 事务：两类投影均从generation 1/零前驱启动，完整不可变history、previous/source SHA和精确current alias采用canonical JSON、确定性temp、file/directory fsync及原子rename；可证明partial幂等恢复，未知/被引用差异/未来/回退/跳代失败关闭。
- legacy边界：D-132 V1 cluster recovery policy不能证明actual，默认V4以`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`拒绝。正向存储fixture只能显式注入test validator，生产路径没有兼容旁路；V2政策转交TASK63。
- 不可变链：source`0e38ac2e286abf4f9b95b46258448df5f9bc67cd`/tree`f48b5b08c043119db56421562490db8f5a8dda25`→monitor manifest-only`9d0eeb7b3f67855c8e2af57c3296a5c9b9b57a2f`/tree`8585afce3631f5a0cffe93186f1e175d3f27642b`→Supervisor manifest-only`672a0695b761a50093c15401cf8d9e39951ced36`/tree`2d5b30bf72a5b1b08ad9ccdb35cf16008c376e76`；27/113文件manifest为`d1b0239f…8790`/`9d653c63…96f1`且逐字节重放一致。
- 验证：Python专项`28/28`、固定断网只读受限Node投影`6/6`、release contract`20/20`、inventory`250/226/24`、JSON/Python静态、敏感模式和diff门通过。首次fixture在最小capability下改写`0440`文件得到`EACCES`，修复测试helper后完整重跑通过，断言未降低。
- 资源/边界：available约1.9—2.0GiB，Swap约870—871MiB/1GiB且超过80%，根盘13GiB，Load低于1，`oom_kill=0`；未运行build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像。未读取真实回执/业务数据、`.env`、日志、备份/Volume正文，未安装host、创建账号、写systemd、开放网络、发送通知或执行备份恢复/Migration/deploy。
- 数据库/API：无Schema、Migration或业务API变化；只新增运维发布器与Supervisor受控操作。系统保持`PRODUCTION NO-GO`。
- 治理：新增D-138，TASK62转`DONE`；自动启动`SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-V2-63`为唯一`DOING`。

### SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-V2-63 - `docs: close authoritative projections and start recovery policy v2` / `feat: add PostgreSQL cluster recovery policy V2` / `build: refresh release supervisor bundle` / `docs: close recovery policy v2 and start policy activation`

- 调度：从TASK62最终Supervisor manifest-only提交`672a0695b761a50093c15401cf8d9e39951ced36`/tree`2d5b30bf72a5b1b08ad9ccdb35cf16008c376e76`启动唯一active task；只审计V1/V4/runtime privilege并在仓库和合成隔离中实现V2。
- 架构纠正：冻结D-132 V1 policy/contract/executor字节和语义，拒绝把其3个legacy角色/2份LOGIN credential receipt伪装成TASK56当前9角色/5 LOGIN/4 membership/1261 ACL来源。V2作为独立编排层嵌入精确V1 policy和当前runtime/operator/catalog/Migration/镜像/四域摘要。
- actual合同：V1基础恢复receipt、V2 recovery control和当前runtime privilege `BOOTSTRAP` receipt共同证明完整恢复；actual policy绑定environment/generation/previous、当前Supervisor bundle、分离authorization/approval/operator/approver、独立TEST目标、源/目标location/system/machine、RPO/RTO、最长24小时及销毁/保全决定。
- 失败关闭：repository template只允许synthetic TEST；V1 actual、模板actual、synthetic冒充、同机/同源、空目标/围栏不符、跨环境、过期/未来、旧代/跳代、身份/摘要漂移及连同摘要一起重签名的替换政策均有稳定拒绝。Dashboard、V4和monitor backup publisher使用同一默认V2边界，测试validator没有生产旁路。
- 不可变链：source`de993c0326b959f7f7c451504a6ef3a753e09c11`/tree`5d427f26eeafec4fbaf7c4faa6abf9516d0a8921`→Supervisor manifest-only`e527fcfe5fa0f779cbe4514ffa82376e1d0f3462`/tree`778b24a550215271bba248ea6367adc8d1b3fb92`；117文件manifest raw SHA-256为`4c3b801fc2fa33f3f047bc8a40dabf003376c079187a576a5c3108cf7f665582`。V2 raw/logical SHA为`1a092993…7aa`/`c30951ad…8b8`，V1 contract/executor SHA不变。
- 验证：V2/V1/Dashboard/monitor`41/41`、release contracts`29/29`，同任务此前Supervisor launcher/monitoring`28/28`及manifest后installer+launcher`25/25`；inventory`251/227/24`、policy/manifest重放、JSON/JS静态、1,705文件credentials和diff门通过。
- 资源/边界：available约2.0GiB、Swap约870MiB/1GiB且超过80%、根盘13GiB、Load低于1、`oom_kill=0`；四服务restart0/OOM false且任务临时资源清零。没有build、全量Node/PostgreSQL、Docker数据库、typecheck、镜像、数据库连接、真实备份恢复、host、凭据/账号/ACL、UAT/生产或数据动作。
- 数据库/API：无Schema、Migration或业务API变化；新增运维V2 policy、contract/builder及V4/Dashboard/monitor验证边界。repository template不等于host active policy或真实恢复ready。
- 治理：新增D-139，TASK63转`DONE`；自动启动`SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-ACTIVATION-64`为唯一`DOING`。系统保持`PRODUCTION NO-GO`。

### SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-ACTIVATION-64 - `docs: close recovery policy v2 and start policy activation` / `feat: activate PostgreSQL cluster recovery policy` / `build: refresh release supervisor bundle` / `docs: close policy activation and start notifier egress`

- 调度：从TASK63最终Supervisor manifest-only提交`e527fcfe5fa0f779cbe4514ffa82376e1d0f3462`/tree`778b24a550215271bba248ea6367adc8d1b3fb92`启动唯一active task；仅在仓库与合成fake-root实施。
- 激活合同：新增固定内容寻址policy state/target与Supervisor authorization v4的`ACTIVATE`、`ROLLBACK`、`RECOVER`操作；prepare先于一次性授权消费，授权绑定template raw/logical SHA、Supervisor bundle、environment/generation/previous、actor/approver和24小时有效期，任何固定源身份漂移均失败关闭。
- 事务/恢复：提交顺序固定为intent→history→target→receipt→current，全部canonical JSON、no-clobber、file/directory fsync；每个已提交receipt必须且只能对应一个intent。回退必须精确指向历史已提交代次；partial recovery必须使用引用原已消费授权的新授权，过期partial只能保全隔离，未知/矛盾状态永不自动删除。
- 消费边界：V4 recovery、monitor backup publisher及installer bundle切换只接受同一固定current activation、完整receipt/intent/history链和精确release identity；未解决或无效链阻断运行、投影及升级，repository template不能冒充host active policy。
- 不可变链：source`83d920b1ac017370270452d334e44fa36a6b3978`/tree`83084e980d794a37bfeb835fcbf89e7c5210fee7`→Supervisor manifest-only直接子提交`0e2328b58bc68cf09dc6b0638bb5ded82b0cf347`/tree`585b3c8d1d38f695422c5378eaa24691627de932`；121文件manifest raw SHA-256为`728f9a5f321c03c4a9b089ca4c3091c04273e6b7427f1df610c6756fa0735db9`，逐字节重放一致。
- 验证：Python policy/monitor/installer/launcher `37/37`；固定Debian Node环境Dashboard/monitor/activation/release gate `52/52`；inventory `252/228/24`、manifest contract `9/9`及cluster transfer `4/4`通过。一次Worker BusyBox `flock`不支持GNU `-E`导致组合夹具`51/52`，随后在正式固定Debian环境重跑相关release gate `20/20`；未降低断言。首次Compose只读状态命令因缺必需变量失败，补入非秘密dummy值后成功且未改变运行面。
- 资源/边界：收口available约2.0GiB、Swap约861MiB/1GiB且超过80%、根盘13GiB、Load低于1、`oom_kill=0`；四服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy无healthcheck。没有build、全量Node/PostgreSQL、Docker数据库、typecheck、真实host/policy/备份/恢复、数据库、凭据、账号、systemd、网络、UAT/生产或数据动作；临时文件/容器清零。
- 数据库/API：无Schema、Migration或业务API变化；新增的是运维政策激活、回退、恢复及消费证明。TASK64转`DONE`，系统保持`PRODUCTION NO-GO`。

### SELFHOST-OPS-MONITORING-NOTIFIER-EGRESS-65 - `docs: close policy activation and start notifier egress` / `feat: bind monitoring notifier egress` / `build: refresh monitoring host bundle` / `build: refresh release supervisor bundle` / `docs: close notifier egress and start role matrix`

- 调度：从TASK64最终Supervisor manifest-only提交`0e2328b58bc68cf09dc6b0638bb5ded82b0cf347`/tree`585b3c8d1d38f695422c5378eaa24691627de932`启动唯一active task。
- 目标：在仓库与合成fake-root/effective-unit/offline adapter中建立内容寻址、target/generation绑定的notifier出口政策，固定HTTPS host/SNI/path、端口、精确IP集合、adapter/credential/config/bundle和值班升级来源，并由Supervisor一次性授权控制activate/rollback/recover。
- 失败关闭：现有`IPAddressDeny=any`在没有有效current egress activation时保持；运行时不得依赖未绑定DNS、代理、redirect或手工drop-in，delivery readiness必须同时证明同代target与effective unit。真实目标、DNS、凭据、账号、systemd、网络和通知均不在本任务授权范围。
- policy/事务：V1 canonical policy/template/receipt只接受最多8个精确公网`/32`或`/128`地址、HTTPS443和最长24小时；Supervisor authorization V5以intent→consume→apply→effective verify→finalize执行ACTIVATE/ROLLBACK/RECOVER，使用历史高水位generation、精确前代回退、相同intent幂等和unknown/partial quarantine。
- 运行核验：base unit继续deny-all，只有内容寻址专用drop-in可增加精确allow；launcher核对root-owned物理unit、专用drop-in唯一成员/内容、loaded systemd属性和零环境。HTTPS adapter固定批准IP并保持Host/SNI，禁用runtime DNS/proxy/redirect并核对remote address；collector/notifier/readiness绑定current policy、receipt和effective摘要。
- 不可变链：source`05502fda0bcac7952d12374dfab78cccf8284bb3`/tree`3dcb05738561e16d866675f1349a9ba5d2cd7832`→monitor manifest-only`013e61fd16f679f453ab0a1abfeade65dbd9de7d`/tree`d9dbf8ebef7edbe3b84b61a75f862c16256719c4`→Supervisor manifest-only`7c69385c5ee35d517e9611fe04f55ae17be4f194`/tree`7d19d1d9fa161dc273652ce21f1478708035d507`；30/126文件manifest为`8260bed4…302`/`aab36e62…53a3`且逐字节重放一致。
- 验证：受限断网Node25/25、Python Supervisor36/36、release gate20/20、inventory253/229/24、Python AST7、JSON4、bundle计数、模板logical摘要、敏感模式和diff门通过。完全cap-drop初跑有7个fixture `chown EPERM`，按fake-root最小`CHOWN/FOWNER/DAC_OVERRIDE`能力重跑后原断言全部通过，未降低断言。
- 治理收口偏差：首次从仓库根调用宿主`node`和Site Python模块分别因宿主无`node`、工作目录错误失败；改用显式11文件Python链接校验并从Site目录重跑Python36/36后通过。没有修改断言、代码或运行面。
- 资源/边界：测试前后available约2.0→1.9GiB、Swap858→860MiB/1GiB且超过80%、根盘13GiB、Load低于1；四服务restart0/OOM false，临时容器清零。没有build、全量Node/PostgreSQL、Docker数据库、typecheck、镜像、真实网络/target/credential、host/systemd、通知、数据库、备份、Volume、UAT/生产或数据动作。
- 数据库/API：无Schema、Migration或业务API变化；新增运维出口政策、激活/恢复、HTTPS adapter和监控readiness合同。TASK65转`DONE`，新增D-141；系统保持`PRODUCTION NO-GO`。
- 调度：自动启动`SELFHOST-AUTHORIZATION-ROLE-PERMISSION-MATRIX-66`为唯一`DOING`，只在仓库生成11角色→permission→API/data-domain机器矩阵与负向漂移合同；业务批准保持pending，不创建账号、Session或数据库角色/ACL。

## 2026-08-14

### SELFHOST-OPS-MONITORING-HOST-DELIVERY-61 - `docs: start monitoring host delivery closure`

- 调度：TASK60收口提交`08483c04231961ba5ac25757391793bfe208f926`/tree`c18d4f49d5ca9b491529c64ecd3f715ab9e53688`后从零`DOING`自动登记TASK61为唯一active task。
- 目标：为TASK49/D-126建立内容寻址monitor host delivery：一次性授权installer、固定service/timer、root collector与非特权evaluator/notifier边界、root-only配置schema、pending/ack回执、升级/惰性回退/卸载事务和隔离攻击测试。
- 资源边界：起点available约2.0GiB、Swap873MiB/1GiB并超过80%停止线、根盘13GiB、Load`0.19/0.16/0.20`、`oom_kill=0`。先只执行文档、只读审计、轻量源码与合成fixture，不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- 授权边界：不实际安装host、不创建账号或写systemd，不配置/读取真实渠道凭据、不发送通知，不修改网络、Docker daemon、UAT/生产、数据库、Volume或业务数据；系统继续`PRODUCTION NO-GO`。

### SELFHOST-RELEASE-SNAPSHOT-RESERVATION-60 - `docs: start release snapshot reservation closure` / `feat: reserve release snapshot targets` / `build: refresh release supervisor bundle` / `docs: close release snapshot reservation`

- 调度：TASK59收口提交`d7780864eb239cbeadf4aa84e92a3a6bb62016c1`/tree`2a9ecd452ca53cb7691ad58ce0dc3082a7aa4d84`后从零`DOING`自动登记TASK60为唯一active task。
- 目标：以同设备私有staging和创建前0400 canonical reservation receipt绑定target root dev/inode/mode，再以NOREPLACE提升同一inode，并在Git add前后与target-only崩溃恢复中保持所有权证明；foreign、替换、非空、跨设备或证据缺失一律失败关闭。
- D-136实现：新增私有`staging/`与`reservations/`状态根；在target出现前发布root-owned `0400` reservation，绑定intent/source/state/candidate/bundle/runtime/lock/admin/generation、target/staging、可信父链、mount及root dev/inode/mode/uid/gid。固定父目录fd并用`renameat2(RENAME_NOREPLACE)`提升同一inode，Git `worktree add --detach --lock --reason`前后持续核对；没有copy或覆盖回退。
- 恢复边界：仅完整temp receipt可补发canonical reservation；部分、缺失或篡改证据保持现场并失败关闭。只有与reservation完全相同的reserved target可经显式`RECOVER`隔离，foreign inode保持不变；后续代次必须绑定上一代终态恢复审计和永久保留quarantine。
- 不可变链：source提交`15501787f5cd304dfe5f8c75fb5df15d4e9a2258`/tree`3718593b8b6d362922bc4e84be6b6cf4adbd00a6`与manifest-only直接子提交`ffaaa9091cf09afa80918e87664ed6660f0556cf`/tree`9d42de1626ed6f8cf13308c7bbc2e83685f7341e`形成78文件bundle；manifest SHA-256`17fb9f99af2aae24390d060344114d1d1089c1fb19a87280c83161e277fab5b8`逐字节重放一致。TASK59的`7927bb24…e5855`因此为`STALE / NOT AUTHORIZABLE`。
- 验证：candidate snapshot 23/23、六个Supervisor Python模块72/72、Python compile、bundle replay、`git diff --check`及1671个跟踪仓库文件凭据扫描通过；替换inode、symlink/mount/非空/权限/父目录漂移、EXDEV/EEXIST、receipt缺失或篡改、最新证据缺失和并发均有负测。
- 资源边界：起点available约1.9GiB、Swap887MiB/1GiB并超过80%停止线、根盘13GiB、Load`0.09/0.19/0.47`、`oom_kill=0`。先只执行轻量文档、源码、纯Git/Python fixture和只读审计，不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- 收口资源：available约2.0GiB、Swap873MiB/1GiB、根盘13GiB、Load低于1、`oom_kill=0`；四服务running、restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy无healthcheck，任务扫描容器已自动删除且无任务临时资源遗留。Swap仍超过80%停止线。
- 授权边界：未安装host、未生成A1/A2授权、未外部push、未build/deploy，未修改UAT/生产、账号、角色、secret、ACL、Volume、网络、systemd、Swap、Docker daemon或数据。reservation仓库缺口已闭合，但当前源码匹配Web/Worker镜像、A1、A3和正式A2证据仍不存在；系统继续`PRODUCTION NO-GO`，下一安全项为TASK49监控能力的内容寻址host delivery包。

### SELFHOST-RELEASE-CANDIDATE-SNAPSHOT-59 - `feat: add release candidate snapshot lifecycle` / `test: stabilize snapshot cap-drop fixture` / `release: synchronize snapshot contract inventory` / `release: bind final task59 snapshot input` / `docs: close release candidate snapshot lifecycle`

- 调度/范围：从clean `ad87edc45a32521cfcec36b6214f4d510d750e54`/tree`5831507e94a40641dab9a630ce3a95620c037689`启动唯一`DOING`。只实施仓库工具、合成隔离Git fixture、发布合同与治理文档；共享主工作区不切换/清理，不安装host、不生成正式授权、不外部push、不修改UAT/生产、账号、角色、secret、ACL、Volume或真实数据。
- D-135实现：新增`release-candidate-snapshot.py`，以全局release锁和lifecycle锁串行PREPARE/VERIFY/REMOVE；固定唯一manifest-only父子链、detached locked worktree、canonical 0400 intent/receipt、file+directory fsync、no-clobber发布、Git admin/target/index/HEAD/clean/inode/mount/权限及runtime全身份验证。A2 launcher先锁后验再消费授权，三个正式wrapper在制品变化前和最终发布前复核。
- 借用运行时：detached worktree只读借用既有Node/Python runtime，不复制约806MiB依赖；回执绑定可信祖先、完整依赖树、lock/requirements、解释器dev/inode/mode/bytes/digest及source policy，六个消费者只读挂载，REMOVE永不删除或更改借用根。
- 崩溃/所有权：恢复代次、intent/audit/quarantine逐代守恒，split-brain只用同设备`renameat2(RENAME_NOREPLACE)`移入root-only永久保留区。admin-only/REMOVE单边状态有精确所有权证明；PREPARE target-only在缺少创建前reservation时返回`SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN`并保持foreign对象不变，后续任务须用同设备私有staging和0400 reservation绑定root dev/inode/mode。
- Git/发布：最终source`7b9abec45a50da5655a2e78a0f42647536321290`/tree`0ae35f87cf2e14279f9e93f581557ce17f8e13a4`与唯一manifest-only直接子提交`89504045e4066bbe5236b19cf1a8bfa09701d508`/tree`13809b3b46f46f375b3af6a0c0874d9af5bff5a7`形成78文件bundle；manifest SHA-256`7927bb242cad9784a48ebaa8269ac9cc53cf56808c7dffc8f3d148111c7e5855`逐字节重放一致，脚本SHA-256为`71361ac9…d9add8a`。TASK57的76文件bundle及本机Web/Worker镜像因此成为`STALE / NOT AUTHORIZABLE`。
- 验证：snapshot17/17、三条独立攻击探针、Supervisor66/66、release inventory 6文件/57项与直接54/54、SPECIAL POSIX 7文件/57项、隔离Python self-test/smoke/go-live、browser policy5/5、credentials1670、JSON220、Shell44、Python AST52、Markdown398/242、source/diff门通过；lint0 error/28 warning。cap-drop夹具和release合同SHA漂移两个真实失败均修复并重跑，未跳过或降低断言。
- 验证偏差：一次误用非隔离旧Python go-live，对Git忽略的`chenyida_erp_app/data/erp.sqlite3`执行初始化检查并创建root-only备份`data/backups/erp-backup-20260814-222753.sqlite3`。未读取业务行、未删除/回滚，随后改由bubblewrap、临时`/state`和`--no-backup`完整复跑通过；删除或改写仍需专项授权，该偏差不涉及Node/PostgreSQL UAT或四个受保护Volume。
- 资源/结论：全部重任务串行且一次最多一个临时容器；lint后Swap约769→889MiB/1GiB并超过80%，立即停止启动新的typecheck/Node source等重任务。收口available约1.9GiB、根盘13GiB、Load约0.41、`oom_kill=0`，四服务running/restart0/OOM false，任务container/临时目录清零。A1、源码匹配A3镜像、reservation和正式A2均未完成，系统继续`PRODUCTION NO-GO`。

### SELFHOST-EXTERNAL-AUTHORIZATION-PACKET-REFRESH-58 - `docs: refresh current release authorization inputs`

- 触发：TASK57收口后复核发现投产专项授权执行包仍把TASK53/TASK51的47文件bundle、历史候选和0045描述为当前输入；直接照旧包请求A1会安装过期Supervisor，故从零`DOING`自动建立TASK58 docs-only失败关闭任务。
- 不可变身份：授权包现固定source`4d4586b1`/tree`a551144e`、manifest-only `78d96c61`/tree`3dbd20dd`、76文件bundle`631d76e6…e763`、installer`f12e5250…7cb3`、launcher`92cabc07…68c6`，并记录当前Web/Worker manifest/config及root-only本机构建回执。
- 授权依赖：A1为“当前bundle就绪但未授权”；A3为“当前本机候选就绪但缺目标/凭据授权”；A2由A1+A3+detached snapshot合同阻断，且必须使用A3外部完整digest和精确`78d96c61…eba3`快照，不得把更晚治理提交或本机engine引用冒充候选/外部锚点。
- 路线：TASK54、TASK55—TASK56及TASK57已关闭项与六个开放安全仓库项逐项区分；下一项为A2独立candidate snapshot准备/验证/清理合同，随后还有监控host delivery、11角色矩阵、0017→0046合成升级、跨岗UAT模板及晋升/回滚执行器复核。
- 边界：仅治理文档和轻量只读验证；未生成可消费授权、创建凭据、安装host、push外部对象、连接UAT/数据库或修改账号、网络、Volume、镜像和业务数据。系统继续`PRODUCTION NO-GO`。
- 验证/资源：专项授权包身份合同、Markdown397/240、JSON220、Shell44、Python AST50、credentials1667、范围和diff门通过。起点/收口available约1.9GiB、Swap765/764MiB、根盘13GiB、Load低于1、`oom_kill=0`；四服务restart0/OOM false，扫描容器/目录清零，未运行重任务或prune。

### SELFHOST-RELEASE-CANDIDATE-REFRESH-57 - `release: bind task57 candidate refresh input` / `docs: close current privilege candidate refresh`

- 源码链：启动文档源码`4d4586b1086470d32ce19a7f4eabbc2d2a33fa74`/tree`a551144e032f80f50fbd6c432059c97afbff7ece`与manifest-only直接子提交`78d96c6198ab4b7255572186ea580c463b5eeba3`/tree`3dbd20dd6803d485fca17f72f7ee90de277c3b9d`形成76文件canonical链，manifest SHA-256为`631d76e650082de299fe836f1216b057d1ca7deabe29bd5e11e1a071a21ae763`且生成器逐字节重放一致。
- 候选构建：clean `78d96c61` Git archive串行生成alpha.47/0046 Web/Worker。Web manifest/config为`sha256:b7b21508…8a30`/`sha256:3c83d60f…f56e`，Worker为`sha256:c5bf9d5c…b113`/`sha256:3bebff16…f971`；OCI/baked version/revision、UID/GID、CMD和Migration allowlist逐项一致。root-only构建回执SHA-256为`33b1b921…a9a`。
- Runtime：UAT/production静态Compose与六服务实际runtime均通过策略`e4920820…f00`；Admin/Migrate/Web/Worker secret、只读rootfs、NNP/capability、用户/组/写路径、PostgreSQL custom tablespace、Caddy例外和warm restart均验证，`max_containers=1`。
- 安全诊断：固定Trivy0.70.0使用46.6小时内schema2数据库，payload tree前后同为`def6b023…986b`。Web覆盖Wolfi25+npm63、Worker覆盖25+60，CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN及CycloneDX漏洞全部为0；九份`local-diagnostic`文件均root:root`0440`、单硬链接，明确不是正式证据或外部锚点。
- 正式边界：installed Supervisor不存在，正式镜像证据和19步门分别以受信入口错误退出1；11文件制品指纹前后均为`ed7ef447…137f`，未旁路、伪造授权或生成正式PASS。UAT继续alpha.42/0040、共享superuser和环境秘密，四服务restart0/OOM false。
- 验证/资源：release inventory57及直接54、Supervisor host/官方sandbox各48、Python三基线、Compose/runtime、lint0 error/28 warning、credentials1666、JSON220、Shell44、Python50、Markdown396/238和source/diff门通过。起点/收口available约1.9/1.8GiB、Swap722/770MiB、根盘15/13GiB，任务窗口未观察到宿主或容器OOM；任务registry、container/network/Volume/tar/目录清零，未prune或执行外部push、host/UAT/生产/真实数据动作。TASK57完成但整体继续`PRODUCTION NO-GO`。

## 2026-08-13

### SELFHOST-RELEASE-CANDIDATE-REFRESH-57 - `docs: start current privilege candidate refresh`

- 调度：TASK56收口后从零`DOING`自动选择当前候选身份缺口，登记TASK57为唯一`DOING`；严格起点为TASK56 manifest-only提交`e34a861f168ef8afb71a812d186099c33d952902`/tree`66e7d001c90f0e8beeb41fed2a55755efb1c37e4`。
- 目标：从新的TASK57 canonical manifest提交串行构建alpha.47/0046 Web/Worker，分别核对OCI manifest/config、baked runtime和Migration allowlist，并重新执行当前六服务secret/container/tablespace策略与固定Trivy镜像诊断。
- 起点：Docker Engine29.5.2、Compose5.1.4；73个image约25.27GB、Build Cache约8.726GB且无active build。available约1.9GiB、Swap722MiB/1.0GiB、根盘15GiB、`oom_kill=0`，四服务restart0/OOM false。
- 边界：不复用TASK51历史镜像，不安装host Supervisor、不外部push、不修改UAT/生产、真实角色/secret/ACL/Volume、账号或数据；不prune既有image/cache/Volume，只清理TASK57精确创建的临时资源。系统继续`PRODUCTION NO-GO`。

### SELFHOST-OPS-POSTGRES-RUNTIME-PRIVILEGE-56 - `docs: start PostgreSQL runtime privilege closure` / `feat: close Web runtime lock privilege boundary` / `feat: split backup control and capture privileges` / `fix: align runtime privilege source boundaries` / `fix: reject legacy actual recovery readiness` / `feat: compile PostgreSQL runtime catalog` / `release: bind task56 catalog bundle` / `docs: record PostgreSQL catalog checkpoint` / `feat: reconcile PostgreSQL runtime privileges` / `release: bind task56 privilege checkpoint` / `docs: record PostgreSQL privilege checkpoint` / `feat: harden controlled runtime identity` / `fix: align release browser dependency provenance` / `fix: bind release test temp mountpoint provenance` / `release: bind task56 hardened runtime checkpoint` / `feat: harden PostgreSQL runtime privilege operator` / `test: bind centralized release lock contract` / `fix: feed runtime privilege transactions through stdin` / `docs: close PostgreSQL runtime privilege closure` / `release: bind task56 runtime privilege operator`

- 调度/范围：从TASK55收口提交`fb1f7e8893b2affba0ca07ecd9629ae2726adca9`/tree`13fe6ce3d04b60bbc724f63b9fa7b5bdc5d16d3e`启动TASK56为唯一`DOING`；主智能体唯一写入，数据迁移、应用测试、运维安全三线只读审计。
- 起点事实：只读UAT catalog摘要确认PostgreSQL 17当前只有1个非内置LOGIN，且该角色同时为superuser、数据库owner和全部433个public relation owner；Web/Worker活动连接共用1个数据库角色。源码为45/head`0045_runtime_worker_readiness.sql`，UAT仍为40/head`0040_warehouse_receipt_readiness.sql`。
- 目标：在仓库和合成隔离环境固定owner/migration、Web、Worker、backup capture与受控operator的精确角色、ACL、default privileges、连接身份/上限和正负权限探针；以root控制的文件秘密替代UAT/生产环境变量秘密，并为未来custom tablespace声明独立持久mount。
- 验收：D-133、版本化角色/权限引导、应用安全secret-file加载、Compose/runtime/release合同、单容器PostgreSQL 17全量Migration及角色正反向测试、适用回归和新内容寻址bundle全部通过；不得降低现有D-132恢复合同。
- 启动验证：394个Markdown/229个本地链接、214个JSON、38个Shell、1618文件凭据扫描、release contract 51/51及Python三基线通过；固定Node镜像断网/只读/零capability运行，临时容器与SQLite自动清理。宿主工具/依赖缺失在业务断言前如实失败，改用项目既有隔离运行时后通过，未安装依赖或降低断言。
- 边界：不创建或修改真实角色、凭据、Volume，不读取`.env`、真实秘密、业务行、备份/卷正文或未跟踪状态报告，不修改/重启UAT/生产，不执行真实Migration、备份、恢复、host安装、部署或网络动作。系统继续`PRODUCTION NO-GO`。
- Web锁边界：append-only 0046新增16个owner控制、固定`search_path`、无PUBLIC EXECUTE的窄锁函数，替代Finance/Production/Quality/Sales的19个直接行锁；20个关联trigger函数固定owner安全执行路径，Web对全部锁目标保持零table/column UPDATE。
- 版本/门禁：源码同步为alpha.47/0046，release inventory为244/220/24；隔离PG17完整回归84文件/401项、专项5/5、typecheck38/38、发布/版本契约、凭据1631与clean-candidate等价lint 0 error通过。首次live workspace lint因未跟踪构建产物触发V8 heap OOM，容器未OOMKill；排除Git快照不存在的构建目录后同限额通过，未降低规则。
- Backup最小权限：备份入口强制两个物理和逻辑身份均独立的root-only libpq service文件；高权限control只负责稳定身份、零large-object、只读/CONNECT围栏与恢复控制，固定非superuser `chenyida_erp_backup`只执行关系reconciliation、Migration读取和`pg_dump --no-large-objects --no-owner --no-acl`。PUBLIC/额外LOGIN CONNECT、TEMP、危险角色属性或错误ACL均失败关闭。
- 崩溃/恢复：持久intent升级为v3但保留兼容文件名；数据库connection limit全过程不变，owner/Web/Worker/Admin的CONNECT和默认只读在事务中精确切换，capture保持连接。隔离PG17验证未知LOGIN/NOLOGIN grantee漂移拒绝且不解除围栏、capture越权拒绝、意外large object拒绝/清理及零large-object备份到新空库恢复，下游Dashboard PostgreSQL 2/2通过。
- 内容寻址/验证：access intent SHA-256为`218d7ff7…2561f`，release inventory保持`244/220/24`且SHA-256更新为`cecbbbaf…7f67`，test runtime policy为`a90e07ae…4c8a`；Backup/source合同13/13、release合同51/51及inventory verify通过。
- 当前阻塞：access intent只剩`POSTGRESQL17_COMPILED_CATALOG_REQUIRED`；本检查点不代表角色/ACL reconcile、secret-file Compose集成、tablespace、候选bundle、UAT部署或真实运行加固完成，TASK56继续`DOING`。
- 源图修正：`mapping-target-registry.ts`改为只依赖新拆出的无数据库Parser contract，不再通过legacy D1 `parser-service.ts`把CSV/XLSX Parser SQL纳入Web图；Web从173降至171个源文件，先撤销11个表操作和3个sequence USAGE。
- 调用路径修正：应用审计又确认共享文件内的Worker lease写入、background job dispatch、初始header suggestion发布及五张normalization暂存表替换只由Worker调用。现拆分lease reader/writer与Worker supervisor、Web enqueuer/Worker queue、初始Mapping publisher和normalization staging writer，使Web raw candidate由`14/199/205/80`自然收敛为`9/191/205/79`；reviewed exclusion只剩既有`app_meta INSERT`，额外撤销Web 14个表操作与6个sequence USAGE，最终为`9/190/209/79`和173个sequence USAGE，同时保留Web lease SELECT及Worker正向权限。
- 角色/v1兼容：runtime identity职责组统一为D-133及Backup fence已使用的`*_priv`，后续v2 catalog将`*_acl`视为禁止漂移；D-132 v1三份fixture恢复为alpha.46及各自原始0045 head，保持policy/fixture/snapshot/digest不可变，alpha.47/current语义只进入v2。
- 本检查点验证：新access intent SHA-256为`b2defe953c59a6b37858ee90af1ae08fbd444486a814ebb1c10f7f0f4ee83aa1`；固定Node隔离TypeScript、六文件Node 36/36及runtime-readiness PG17 5/5通过。三线审计另确认readiness v4可能接受D-132 v1实际恢复证据，已将fail-closed门禁调到PG17 catalog之前；检查前后available约1.7—1.8GiB、Swap568—574MiB、根盘16GiB、`oom_kill=0`，四服务restart0/OOM false，任务容器清零；未读取未跟踪报告、`.env`、真实数据/备份/卷正文。

- 正式测试绑定：本检查点影响的8份正式测试SHA-256、test inventory与runtime policy已同步重绑；inventory保持`244/220/24`，新SHA-256为`79b1c8126ce5a934b38f7c70ed0af9dcd582edf52babc2406f07dcc974b328db`，inventory verify、release/v1 transfer合同31/31及v1 recovery合同16/16通过。
- D-132实际readiness门禁：V4 validate/create/publish在legacy v1 policy与`ACTUAL_OFFHOST/RECOVERY_READY`组合进入深层逻辑或文件系统前统一返回`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`；Dashboard另有独立消费端守卫并投影为`INVALID / recovery_ready=false`。result/scope错配继续保留原错误，v1 synthetic仍可解析但assurance不匹配且永不ready。
- 发布原子性：既有权威alias现在必须先通过安全元数据和完整证据校验，之后才允许写immutable history；恶意、损坏或回退alias不会留下孤儿history，同payload幂等路径仍补齐/验证相同history。actual入口的root与精确确认词要求未放宽。
- Legacy冻结/发布绑定：十份D-132 v1 policy/catalog/restore/executor/transfer/test文件以精确SHA-256冻结；正式inventory仍为`244/220/24`，SHA-256更新为`1a84dcd0cf10afbc4e14fd809d8b98877d5bedcad6fdd24d8229c9100f4496ab`，test runtime policy为`a20718ef88702373e64283e0607aa1412fd6060eaf23b67733af68b4e7d59358`。Dashboard 9/9、release manifest/gate 27/27、inventory verify、定向lint、`tsconfig.task10` typecheck、credentials1637、JSON216及Markdown394/231链接通过；此前release/v1 transfer31/31与v1 recovery16/16保持。typecheck首次在384 MiB V8 heap内不足，确认宿主`oom_kill=0`、四服务restart0/OOM false后以640/896 MiB同断言复跑通过，未降级。本检查点未创建真实回执、读取真实数据或修改UAT/生产。
- PG17结构编译：新增固定PostgreSQL 17.10/libc C/UTF8、新空cluster、46个Migration与access intent v2的只读编译器；8份compiler/source输入逐项SHA绑定，数据库marker/system identifier、Migration ledger、drizzle snapshot/journal与目标数据库身份都必须匹配。最终目录冻结234表、211序列、394 routine、6独立type、3 extension及3132列、1709约束、957索引、285非内部trigger，31类unsupported计数全零。
- 失败关闭：同owner rogue table、sequence/routine/type/owner/reloptions/TOAST漂移、真实用户rule、routine不安全`search_path`、extension成员指纹与operator owner漂移、未知extension成员class、large object、column/default ACL和RLS policy均在发布前拒绝；目录SQL只读且不访问密码或large-object正文。审计发现未知extension class最初只有计数器而无非零测试后，补入真实`ALTER EXTENSION ... ADD TABLE`与纯合同counter=1负测，再重新生成全部内容摘要。
- 内容寻址/重放：目录文件/制品/逻辑SHA-256分别为`4ca22dfa949a897a32296b392b6c1c396996a6c9e5bc0a94c35ae42f7d581162`、`93af15b7aa0ca0eec5c4bc0d67f0d8dc248ca335837d17ca466a46c8f3157674`、`40c8c620dc8b434798716270d5aecbfedb19499618a2fc792c31e529f63c7f8f`；两次独立新空PG17运行逐字节重现。inventory为`245/221/24`、SHA-256`1a7253b48894a4f6be9ffd4065b9246fb00fe61e9281d60bb4eb67c6201aee9e`，test/container runtime policy为`7ac07e933736eb0d38e85b3d8153824063c2bcffc6000753cf06f408cb3dae3a`/`74d3f8d24e7b15f0cc5ce4e0e21c963b0e95735c502a471666c02165c7e53c1b`；目录/发布/Dashboard33/33、release52/52、Supervisor31/31、typecheck38/38、lint0 error/17既有warning、credentials1643、Shell42、JSON216、Markdown394/231、inventory及diff门通过。完整typecheck首次在640 MiB V8 heap内不足但无宿主/容器OOM，按正式768 MiB heap/1 GiB容器上限完整重跑通过，未跳过配置。
- 边界/后续：该catalog是合成隔离结构证据，不创建角色、不授予ACL，也不证明UAT已加固；TASK56保持`DOING`并继续v2角色/ACL policy、reconciler、五身份正负探针、secret-file、operator与tablespace mount。收口available约1.7GiB、Swap555MiB、根盘16GiB、Load低于停止线、`oom_kill=0`，四服务restart0/OOM false且目录/Node测试容器清零；未读`.env`、真实数据、备份、卷正文或未跟踪报告。
- Git/发布检查点：catalog源码提交`8675efd28ed8b61900fb49f7644541103f5f60b0`/tree`21556c6695b5b49a62959797b1adcb3b116387ef`与只修改canonical manifest的直接子提交`633b42dca48393d7f24d48808c9046e0d2bd8fc4`/tree`241f808e73464275fc8472a92f35e9254ef9522b`形成50文件bundle；manifest SHA-256为`baf820f4d1647e427cae1409c5a3797edc4b38fa8eefa2d56c669c4c2094ddc1`。角色/ACL后续源码会使该检查点过期，TASK56结束前仍须重建最终bundle。
- 干净提交验证：源码Git归档在固定PG17中完成84文件/401项正式回归，随后停掉第一cluster并由第二套新空cluster重建、逐字节验证catalog；manifest提交上的Supervisor31/31、官方固定Node断网凭据扫描1643文件及Python `self-test`、`smoke`、`go-live --no-backup`三项隔离基线通过。旧Python基线仅证明兼容性，不改变其非未来生产权威定位。
- 资源/安全：最终available约1.8GiB、Swap543MiB/1.0GiB、根盘16GiB、Load`0.56/0.91/1.07`、`oom_kill=0`；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false，任务容器/cluster/临时目录清零。当前shell没有必需setup token，`docker compose ps`按配置失败关闭；未读取或伪造secret，使用四个精确容器只读inspect核验。没有真实角色/ACL/凭据、Volume、UAT/生产、Migration/deploy、备份恢复或数据动作，系统继续`PRODUCTION NO-GO`。
- v2角色/ACL策略：新增内容寻址policy、PG17状态捕获SQL及严格reconciler，固定9角色、5个LOGIN、4个NOLOGIN职责组、4条membership、五身份连接/角色上限、1261条非owner ACL、849个物理ACL对象和2条global default ACL。策略逻辑/文件SHA-256为`fb7768aa…c8f`/`b36424f4…2b4`；catalog因测试编译器输入更新为文件`146b3cd0…896`、artifact`c35f4920…4e6`，逻辑catalog继续为`40c8c620…7f8f`。
- 失败关闭/reconcile：状态捕获绑定PG17、数据库OID、marker和system identifier摘要，拒绝未知managed角色、membership、ACL端点、LOGIN直授、grant option、危险settings、列/参数ACL、custom tablespace、large object及结构漂移。缺失角色只允许显式隔离bootstrap；常规reconcile拒绝隐式建角。单事务先取得Migration advisory lock，再精确规范owner/group ACL与default privileges；相同最终状态重复执行必须为no-op。durable v2 intent状态和未知第三态quarantine已由纯合同覆盖。
- 五身份PG17：新空cluster应用46个Migration后完成bootstrap/reconcile、最终状态/结构校验、五个LOGIN实际身份和正反探针；只有Migration能DDL，Web、Worker、Admin、Backup均按对象最小权限分离，Backup能够`pg_dump -Fc`但不能写或DDL。table高危权限、sequence UPDATE、column REFERENCES、standalone type、tablespace CREATE、数据库TEMP、Schema CREATE和superuser参数权限8类聚合均为零。
- 测试/发布绑定：policy artifact verify与单测5/5、PG17完整角色/ACL演练、Node inventory 119文件/1001项、release contracts 6文件/52项、Supervisor Python31/31、inventory `246/222/24`及1649文件credentials通过。Node全量前两次仅因隔离容器缺少仓库同级治理模板和`docs/`只读挂载而停止，补入测试既有绝对路径的只读挂载后原断言全部通过；没有改测试或降低断言。
- Git/清单：源码`88c9f1d25ee08debdf3ef06a533f0596a9047074`/tree`044bf539b0174b93229162c158a5d89c3290bcf3`与manifest-only直接子提交`1bc4ed5a8574c710aacd6e94f2f1ae67bd6ea440`/tree`accfcdc6774e3c3f4cc8ac4f82b192ad37e51c83`形成50文件bundle，SHA-256为`2fadb84c18fcb6c82fe561d7ea8b973c51b55a6d395a2bc9480f954ffafd0edb`。旧catalog bundle与TASK51候选均继续`STALE / NOT AUTHORIZABLE`。
- 当前边界：reconciler CLI只接受test/isolated确认和任务私有临时路径，生产root runner、全局host lock、持久intent文件、备份围栏联锁、secret-file delivery、受控operator及custom tablespace mount仍待闭合。收口available约1.7GiB、Swap526MiB/1.0GiB、根盘16GiB、Load`0.20/0.86/0.89`、`oom_kill=0`，四服务restart0/OOM false，临时容器/清单清零；没有真实角色/ACL/凭据、Volume、Migration、备份恢复、UAT/生产或服务动作，系统继续`PRODUCTION NO-GO`。
- 静态运行边界：runtime连接固定`pg_catalog,public,pg_temp`，migration固定`public,pg_temp`，pool checkout逐次核对实际身份与session设置，失败client销毁；UAT/production拒绝秘密环境变量，六份独立secret要求32-byte base64url、唯一inode/value、no-follow/单硬链接及逐服务gid/mode。Compose/runtime/release同步固定容器用户、资源、mount/tmpfs、network和独立`erp_postgres_tablespaces`，恢复map精确绑定PG17 child `PG_17_202406281`；`runtime_configuration_sha256`贯穿授权、回执、prepare/recovery与commit。
- 依赖provenance：旧lock/tree常量与当前Next16.3.0、React/RSC19.2.8及eslint-config-next16.3.0漂移，固定Node容器以`npm ci --ignore-scripts --no-audit --no-fund`重建508包并使`npm ls --all`通过。首次Browser在执行测试前因只读`node_modules`缺`.vite-temp`嵌套tmpfs mountpoint失败；恢复精确root:root`0755`空目录后lock/tree SHA-256固定为`9c3949bfdce05d355287550bdc7981a0e4cc455e99ae1735e39ee0b4c9252eb5`/`e3b363049ea538e0a95c9984d73719c1402c645cd37250f8cca947affea01659`，原6文件/11项Browser断言全部通过。
- 完整验证：最终源码检查点通过Node119文件/1005项、PostgreSQL84文件/401项加runtime privilege catalog、Browser6/11、SPECIAL POSIX7/57、typecheck38/38、release inventory6文件/56项及直接合同53/53、Supervisor40/40、Migration allowlist、异集群数据库/文件与双cluster安全恢复、Dashboard PG2/2、UAT/production Compose六服务runtime policy和inventory `246/222/24`；lint为0 error/26 warning，credentials覆盖1653文件。未跳过或降低断言。
- Git/清单：运行加固源码`e158c228…c29`后以`b0458d40…5b7`修正依赖provenance，再以`6ddfae92bf3ed95314944e95043240fbe26fdee3`/tree`73bafe754b07bc99d5f2268daf2a1b1d001405c9`绑定测试mountpoint；manifest-only直接子提交`ef409bbb8d8cefe0ce596759fc57b3d222bd6ea2`/tree`018fb3f8cc47b9c96296f53576e6aee6450fae83`形成53文件静态bundle，SHA-256为`bac5e882b6a698fe496fbf1b8d6d5e4ea3f206081ab27d12f9ee19af615dcd9e`，生成器复跑逐字节一致。生产operator后续源码会使本bundle失效。
- 资源/边界：PG全量首跑在Swap越过80%时主动中断并由trap清理；稳定低于80%超过60秒后串行重跑，既有单任务期间短暂达到81.07%，没有启动新重任务，最终自然回落且宿主OOM、四服务restart/OOM均为0。最新只读快照available约1.84GiB、Swap约71.23%、根盘16GiB、Load`1.11/0.96/1.21`；四服务正常且无临时PG容器。没有读取`.env`、真实秘密/数据/日志/备份/卷正文或未跟踪报告，没有创建真实角色/secret/Volume、部署、Migration或运行面变更。TASK56仍`DOING`，下一P0是生产受控operator与可信预授权运行配置摘要探针，系统继续`PRODUCTION NO-GO`。
- 受控入口/D-134：installed content-addressed Supervisor成为唯一actual入口，全局release lock从launcher验证贯穿intent、authorization消费、数据库事务、核验和receipt；独立contender证明锁真实busy。active/preparing/quarantine operator证据阻断release/backup，固定backup fence反向阻断operator，混合状态只quarantine。
- 直接消费者凭据：删除aggregate password file/provisioner语义，五数据库LOGIN直接读取Admin DB、Migration、Web、Worker最终secret文件和物理独立backup libpq service；Admin应用与PostgreSQL bootstrap值共同执行七值规范32-byte/43字符base64url和两两不复用。公开证据只绑定路径/metadata identity，不保存秘密摘要；backup service在password后再遇重复/未知字段也会清零buffer后失败。
- 分时守卫：BOOTSTRAP只接受精确manifest/runtime configuration/container/database identity生成的`PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND`，不伪造postdeploy四服务回执；RECONCILE只接受同bundle的`POST_DEPLOY_CURRENT_RUNTIME_STRICT` probe receipt。结构完全相等时仍在一个事务重置并核验五个LOGIN口令。
- 崩溃一致性：authorization消费前fsync `PREPARED` intent，append-only journal覆盖消费、dispatch、postcommit capture、verify、commit；中断prepare、内容寻址pending写、postcommit capture/receipt双写均可精确恢复。RECOVER使用新authorization绑定原operation/authorization/intent；冲突、backup fence并存或未知状态不猜测反向SQL。
- 真实PG17故障注入：新空cluster应用46个Migration后，真实system adapter通过container本地socket提交角色/ACL/五口令事务并立即SIGKILL进程；新进程从journal选择`CAPTURE_AND_VERIFY`完成归档，随后结构no-op RECONCILE再次重置五口令并完成正确/错误TCP loopback登录探针。stdout/stderr/PostgreSQL日志对七个fixture口令和完整SCRAM verifier扫描为零，临时container/source/credential/state全部清理。
- 内容绑定/定向验证：operator policy文件/逻辑摘要更新为`53b502fd…d163`/`85c7d2ea…7acc`，catalog文件/artifact为`e5f3c321…c71e3`/`b8536bc1…9beb`；inventory `248/224/24`的SHA-256为`1112404d…5ab5`，test runtime policy为`df82237b…36e7`。operator16/16、Supervisor29/29、release/catalog34/34及真实system adapter通过；干净Node与后续定向合同先后发现release测试摘要漏绑、postdeploy wrapper锁路径断言及release identity内联`flock`断言，均按集中锁合同修正且未降低安全语义。
- 正式PG门发现并修复：集中锁重绑后的干净Node完成121文件/1025项；PG inventory 84文件/401项全部通过，但包装器的后续catalog门在`RUNTIME_PRIVILEGE_RECONCILE`失败关闭。独立重放证明新事务把五个`\password`及口令响应放在同一buffer，旧测试却仍使用`psql -f`而从外部stdin等待口令。BOOTSTRAP与结构no-op RECONCILE两处现均以stdin重定向消费，新增静态断言禁止`-f`回归；隔离refresh及完整catalog test退出0，正确/错误口令、日志秘密/SCRAM扫描保持原强度。最终全套从修复提交重新执行。
- release identity定向合同在catalog修复后以81/82失败关闭，唯一失败是旧测试要求`write-release-identity.sh`自身包含`flock -n 9`。实际writer已source受信`release-gate-lock.sh`并调用统一获取函数；测试现改为核对helper路径、source、调用及其位于Node/Docker动作之前，同时明确禁止wrapper重复内联`flock`。inventory与policy因此再次内容寻址，更新后的identity/manifest/gate合同43/43、browser policy 5/5及inventory 248/248内容核对通过。
- 文档/边界：新增[受控Operator手册](../self-hosting/postgresql-runtime-privilege-operator.md)，记录直接consumer、三操作、授权字段、唯一入口、停止线、恢复和回退。没有安装host、创建真实凭据或修改角色/ACL/Volume/UAT/生产；旧静态bundle`bac5e882…cd9e`已失效，系统继续`PRODUCTION NO-GO`。
- 最终完整回归：功能修复基线`076b84083c04b1618ea9f94ca5e4ef0f675ec5f3`/tree`d3a7783316e502375ee6d96a31ccda101c545f8f`通过Node121文件/1026项、PG84文件/401项加catalog、Browser6/11、SPECIAL POSIX7/57、typecheck38/38、release inventory6文件/57项及直接54/54、Supervisor48/48、Python Supervisor48与三基线。Migration allowlist、备份只读子测2/2、异cluster恢复、双cluster安全恢复及UAT/production Compose policy均通过；lint0 error/28 warning，credentials1665。
- 历史镜像失败关闭：TASK51 `8084d6c3`镜像仅作为旧离线夹具执行当前六服务runtime policy时返回`ADMIN_READ_ONLY_FIXTURE_GROUP_MISMATCH`，任务container/Volume/network自动清零。没有降低secret-file属组断言，也没有把旧镜像写成当前候选PASS；TASK56按范围禁止build，同源码镜像、正式SBOM/漏洞证据和19步门转交下一候选刷新任务。
- 静态/资源：JSON220、Shell44、Python50、Markdown395/本地链接237及官方source diff通过。收口available约1.8GiB、Swap约723MiB/1.0GiB、根盘15GiB、Load低于4、`oom_kill=0`；四服务restart0/OOM false且所有任务临时资源清零。未读取未跟踪状态报告、`.env`、秘密、业务行、日志、备份或受保护卷正文。
- 最终状态：TASK56文档源码检查点与紧随其后的唯一manifest-only直接子提交形成canonical bundle，精确Git/树身份由manifest自证；任务按`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / ACTUAL ACTIVATION AND CURRENT CANDIDATE BLOCKED`释放active slot。现有UAT仍alpha.42/0040共享superuser和环境秘密，真实角色/secret/Volume/host/UAT/生产未改变，整体继续`PRODUCTION NO-GO`。

### SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-55 - `docs: start PostgreSQL cluster recovery closure` / `docs: record PostgreSQL cluster recovery decision` / `feat: add PostgreSQL cluster recovery contract` / `feat: capture PostgreSQL cluster recovery catalog` / `feat: secure PostgreSQL cluster restore` / `feat: encrypt PostgreSQL cluster transfer` / `feat: enforce PostgreSQL cluster recovery readiness` / `feat: expose cluster recovery operations status` / `feat: execute crash-safe PostgreSQL cluster recovery` / `test: bind cluster recovery release gate` / `test: execute trusted recovery fixtures` / `build: bind exact release dependencies` / `test: make recovery gate deterministic and trusted` / `release: bind task55 supervisor bundle` / `docs: close PostgreSQL cluster recovery`

- 调度/范围：TASK54收口文档提交`812ec2f0a5c2710c73e7c0e3cbd207f977e6256b`/tree`f4cc747a63ad9979e85ca91e407b3854f56e5149`后的零`DOING`自动切换为TASK55唯一active task；主智能体唯一写入，数据迁移/应用测试/运维安全三线只读审计。
- 起点事实：`backup-selfhost.sh`使用`pg_dump --no-owner --no-acl`且未捕获cluster globals，`restore-selfhost.sh`又以`pg_restore --no-owner --no-acl`恢复；现有证据因此不能证明roles/memberships/settings、owner/ACL/default privileges或custom tablespace可恢复。
- 目标：保持TASK41内层V2和TASK54签名密文外层稳定，新增规范化、去敏、allowlist驱动的cluster security/tablespace快照、preflight、apply/verify与不可变回执；角色骨架默认`NOLOGIN`，登录秘密只从独立root-only输入重新绑定。
- 验收：危险角色属性/系统角色/未知或重复对象失败关闭；owner/ACL/default privileges、membership options、settings与显式tablespace map在单容器双PostgreSQL cluster中通过正负向、崩溃续跑、幂等和最小权限验证；新证据进入Dashboard、监控、readiness与release inventory/bundle。
- 边界：只做仓库与合成隔离实施，不读取真实凭据、业务行、备份或受保护Volume正文，不连接或修改UAT/生产，不创建真实角色/密码，不安装host组件、不build/deploy、不执行真实恢复或数据外传；WAL/PITR、HA、跨版本与RPO/RTO不在本任务范围。系统继续`PRODUCTION NO-GO`。
- 决策/实现：D-132固定稳定数据V2与data envelope v1，独立增加严格cluster catalog/policy、加密cluster capsule、joint transfer v2和readiness v4。catalog覆盖allowlisted roles、PG16+ memberships、四种settings、数据库/Schema/对象/列/routine/type/large object ACL、default privileges、extension/publication及tablespace；未知对象、危险属性、PUBLIC越权和unsupported counter失败关闭。
- 恢复安全：私有restore plan先建立`NOLOGIN/PASSWORD NULL`角色骨架，再显式映射custom tablespace、受限建库、`pg_restore --no-owner --no-acl --single-transaction`、应用owner/ACL/default privileges/membership/settings、从root-only文件经stdin重新绑定随机合成凭据，最后执行正负权限探针与原子激活。密码、verifier、角色清单和明文路径不进入公开制品或输出。
- 崩溃一致性：实际executor把durable hash-chain intent、命令指纹、非事务dispatch、目标catalog reconciliation、幂等续跑、quarantine及精确补偿闭合；命令前后/响应丢失/重试/状态损坏/身份漂移均有负测。未知状态保持全部登录角色NOLOGIN、数据库limit0，不猜测删除。
- 传输/readiness：cluster snapshot使用X25519/HKDF-SHA256/AES-256-GCM客户端加密及Ed25519双向签名；joint transfer v2交叉绑定data与cluster两条链。V4要求真实恢复机消费、cluster security/credential/tablespace三类回执及当前runtime/database/Migration；旧V1—V3与synthetic结果永远不ready。Dashboard/monitor只显示去敏状态并对每类缺失独立失败关闭。
- 发布/Git：inventory为`239/215/24`，新增cluster测试进入7文件/57项SPECIAL POSIX与联合PostgreSQL恢复门。恢复wrapper只从Supervisor只读根执行两份可信fixture；备份guard改为从`postgres`读取catalog设置，消除观察连接与零连接fence竞态。冻结源码`b93d838067f3a463f80de04811a11a1dbb5e1848`/tree`269165d4fe054915fe3de77be0eee49ad38b8049`与manifest-only直接子提交`2136aa3c4178135a834b5a6e003e64948f78b5d3`/tree`c5b78dabe9ec2bea60c84b7109b5a4c11b35bfea`形成49文件bundle，manifest SHA-256`699cdd2a55058a38152718a09036255373757191b83d143bd501f995e6d47dd6`；全部旧bundle/候选为`STALE / NOT AUTHORIZABLE`。
- 验证：release inventory 6文件/51项及直接合同48/48、Supervisor31/31、Vinext build+Node113文件/965项、PostgreSQL83文件/396项、Browser6/11、SPECIAL POSIX7/57、typecheck38/38、release Migration、联合backup/cluster recovery、Python三基线、Compose 6服务策略、六服务隔离runtime、credentials1617及diff门通过；lint为0 error/17条既有warning。最终manifest HEAD又复跑release 51+48、Supervisor31和credentials并通过。runtime使用历史缓存镜像只证明六服务策略，不构成TASK55源码匹配镜像证据。
- 资源/结论：所有重任务串行且最多一个临时容器；起点/最终检查available约1.9/2.0GiB、Swap541/632MiB、根盘16/16GiB、Load`0.08/0.43/0.92`，内核`oom_kill=0`。四服务restart0/OOM false，任务容器/数据库/网络/Volume/临时文件清零；未读用户未跟踪报告、`.env`、真实数据/备份/卷正文，未push、host安装、UAT/生产或数据动作。当前高权限共享角色、环境变量秘密、superuser operator与custom tablespace持久mount作为下一P0，系统继续`PRODUCTION NO-GO`。

### SELFHOST-OPS-BACKUP-OFFHOST-PROVENANCE-54 - `docs: start offhost backup provenance closure` / `feat: add signed encrypted offhost backup provenance` / `test: stabilize backup guard crash rehearsal` / `test: bind synthetic offhost receiver identity` / `feat: enforce encrypted offhost recovery readiness` / `chore: refresh release supervisor bundle` / `docs: close offhost backup provenance`

- 调度/范围：TASK53收口`61b752e2ad05e2b2a273a01ffba6a87cc77e6a4c`/tree`800bd1f3caa0c43695008c044e507ac17c582884`后的零`DOING`自动切换为TASK54唯一active task；主智能体唯一写入，数据迁移/应用测试/运维安全三线完成只读审计。
- 起点事实：TASK41已证明四域V2一致性、回执和双集群隔离恢复，但当前异机步骤实际为明文`cp -a`后人工声明`transfer_id`；没有源/接收签名、客户端加密、接收状态机、统一调度锁或保留计划，旧V2仍可能被Dashboard误判ready。
- 目标：保持内层V2稳定，新增Ed25519来源与接收回执、X25519/HKDF-SHA256/AES-256-GCM密文 envelope、私有staging/原子晋升/幂等恢复、外层恢复绑定、UTC单飞调度和dry-run retention planner；Dashboard/监控对旧人工复制链失败关闭。
- 验收：严格schema、密钥文件边界、篡改/截断/错误key/混代/重放/冲突与每阶段中断负测，合成密文链到单容器双PostgreSQL cluster恢复，Dashboard/监控与release inventory/bundle回归全部通过；不得降低内层V2断言。
- 边界：不创建真实密钥或异机目标，不读取/复制/上传/恢复真实数据，不安装host timer/supervisor/notifier，不执行保留删除，不修改UAT/生产/账号/网络/四卷，不把合成验证称为真实异机、WORM或RPO/RTO完成。系统继续`PRODUCTION NO-GO`。
- 决策/实现：D-131固定“稳定内层V2 + 签名密文外层v1 + root发布V3 readiness”。Ed25519源/接收签名、X25519/HKDF-SHA256、AES-256-GCM、receiver receipt/source acceptance、私有staging、fsync/no-clobber、冲突检测和中断续跑闭合；restore必须验证外层链后短暂物化内层V2，旧V2和synthetic evidence均不能ready。
- 调度/保留：`chenyida-erp-backup-operations-policy/v1`固定UTC cadence/RPO/grace、全局锁、CAS单调状态、漏跑/时钟异常和key allowlist；retention planner只生成`DRY_RUN_DELETION_FORBIDDEN`，保护latest/inflight/hold/RPO/min generations/recovery generations。本任务未安装timer、创建WORM或执行删除。
- Dashboard/监控：权威别名改为`recovery-readiness.json`；只有`ACTUAL_OFFHOST + RECOVERY_READY`且transfer/encryption/schedule/retention/runtime/database/Migration/trust全部匹配才可`recovery_ready=true`。浏览器只得到去敏状态；legacy、synthetic-only、transfer、encryption、schedule和retention分别告警并独立恢复。
- Git/证据：源码`fd0a9cff751ad3e6619600066693403b7ace0655`/tree`b7c3849daacc7b8aa58328b0a939ddc8317eb520`；manifest-only直接子提交`315b1f3dac21a9d8cd634ba9d3dcdcbff4fe0806`/tree`2031fcf5ea3d0f729b0b56ea3835576dd3a35c72`形成47文件bundle，manifest SHA-256为`ae6e2bd7fd1bd1b6655238503b1914aa96f43988a9816601db116303b43282b8`。runtime policy SHA-256为`163ccf00…c77e`；inventory为`237/213/24`、SHA-256`48bcaff7…b1a3`。
- 验证：offhost/readiness8/8、备份/Dashboard58/58、监控/release41/41、release contract51/51、runtime Python11/11、supervisor Python31/31、typecheck、inventory、Compose policy及六服务runtime通过；单容器双PostgreSQL cluster密文恢复和2个业务一致性子测通过。发现并修复V2 reconciliation序列化受对象插入顺序影响的真实兼容缺陷，未降低断言。
- 资源/结论：重任务串行且runtime实测`max_containers=1`；收口available约1.8GiB、Swap`543→545MiB`、根盘16GiB、Load低于1。四服务restart0/OOM false，临时容器/数据库/网络/Volume清零，1603文件凭据扫描和diff门通过。未读取未跟踪状态报告、`.env`、真实数据/备份/卷正文，未push、host安装、UAT/生产或数据动作；结论为`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / ACTUAL OFFHOST BLOCKED / PRODUCTION NO-GO`。

### SELFHOST-RELEASE-GATE-LIFECYCLE-53 - `docs: start release gate lifecycle closure` / `fix: close release gate lifecycle` / `build: bind release lifecycle supervisor bundle` / `docs: close release gate lifecycle`

- 调度/范围：TASK52收口`e9d27eebb21a9f52c941f389ef7800508c0402e5`/tree`e3263230340ae5fc4e9346f366afcb025d478a51`后的零`DOING`自动切换为TASK53唯一active task；主智能体唯一写入，应用测试/数据迁移/运维安全三线只读审计。
- 起点事实：现行UAT PostgreSQL/Web为healthy，Worker/Caddy health为none，四服务running、restart0/OOM false；旧runner在第1步前要求Worker healthy，导致首次晋升在候选测试前自锁。TASK51 bundle/候选已落后当前治理HEAD，不能签发A1/A2。
- 目标：显式绑定部署前既有运行面稳定、隔离候选严格health和部署后当前运行面严格身份三种生命周期语义；兼容旧Worker无health只能用于不退化比较，不得弱化候选Worker或部署后严格门。
- 验收：模式/版本须进入计划、authorization、报告、manifest eligibility和runtime identity；缺失/错配、服务或身份漂移、health退化、restart/OOM、候选Worker非healthy及部署后复用legacy模式都有负向测试；实现后重建canonical bundle两提交链并标记旧候选过期。
- 边界：不安装host supervisor、不生成可消费授权或正式PASS、不外部push、不连接或修改UAT/生产/账号/网络/四卷/真实数据，不读取凭据、日志、环境、卷/备份正文或未跟踪状态报告。系统继续`PRODUCTION NO-GO`。
- 决策/实现：D-130固定`chenyida-erp-release-lifecycle/v1`三模式。plan/report/manifest升级v2；部署后由受限`VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY`动作严格复核四服务、外部镜像引用、deployment、完整Migration/runtime policy/readiness，发布独立回执后再派生runtime identity v3。模式错配、legacy跨阶段、loopback引用、第五个容器、证据路径/摘要或运行漂移均失败关闭。
- 崩溃一致性：回执和identity采用prepared/published两阶段、canonical SHA、无覆盖硬链接、fsync与全局锁；重试重新验证当前运行面并可恢复精确同inode残留，冲突payload或伪摘要拒绝，已发布回执不因identity后续失败而删除。旧direct/manifest-to-identity入口保留为稳定失败入口。
- Git/证据：源码`08608eb19ba0d82d60b248e2a0759dfc70fa2125`/tree`1a750f8587aae2dd0749547f0d02a8a1e92e81c8`；manifest-only直接子提交`d246cbde0bc559bb3555da65a82d49727b33a938`/tree`a93adc152a7d19058ad5899b8cac137a3281a544`形成47文件bundle，manifest SHA-256为`94027198d2000b9eea1376489c8684593e38b2037d603f621aa2a5bb21f11c87`。TASK51候选、诊断和44文件bundle均为`STALE / NOT AUTHORIZABLE`。
- 验证：连续干净快照release候选侧51/51、supervisor侧48/48、Python31/31；完整Node113文件/964项、PostgreSQL83文件/396项、typecheck38/38、lint0 error/11既有warning和credentials1596通过。首次512 MiB V8 heap不足如实失败，未发生宿主/容器OOM；改为640 MiB heap/896 MiB容器后38/38通过，未降低断言。
- 资源/结论：所有重任务串行且最多一个临时容器；起点/收口available约2.1/2.2GiB、Swap715—716/719MiB、根盘16/16GiB、最终Load`0.91/1.23/1.25`。四服务restart0/OOM false，临时容器/数据库/网络/Volume/tar/目录清零；无host、UAT/生产、真实数据或正式证据动作。结论为`DONE / REPOSITORY AND ISOLATED VERIFIED / PRODUCTION NO-GO`。

### SELFHOST-EXTERNAL-AUTHORIZATION-READINESS-52 - `docs: start external authorization readiness` / `docs: close external authorization readiness`

- 调度/范围：TASK51闭环提交`cbc219490fd88eda4edb6f0e54ad0ba933438ab4`/tree`216e08ee176406d5df01c6976f74c826a6cab5de`后的零`DOING`自动切换为TASK52唯一active task。三条智能体线只读审计，主智能体保持唯一写者。
- 起点事实：当前bundle/installer/launcher摘要分别为`f4481316…5ce6`/`f7ace184…ba0`/`3e72a81d…c4e0`；`/usr/local` installed supervisor及install/release authorization、receipt、journal根全部不存在，正式证据和19步门继续失败关闭。
- 目标：把host supervisor、正式门、外部镜像/源码锚点、异机备份恢复、监控投递、UAT晋升、数据/岗位/员工试运行和正式切换拆成`A1`—`A8`逐项最小授权，明确影响、前置、停止、验收、失败和回滚边界。
- 边界：只改`docs/`控制面，不创建可消费授权或nonce，不读取凭据/环境/日志/卷/备份/业务数据，不安装host组件、不push、不连接或修改UAT/生产/账号/网络/四卷，不运行重任务。系统继续`PRODUCTION NO-GO`。
- 三线审计：应用线对齐当前236/212/24、Pure Node113和19步机器合同，并确认11角色尚无业务批准矩阵；数据线确认四域V2仅为合成/隔离证据、logical dump排除cluster roles/ACL/tablespace且历史物化停在0017；运维线发现旧Worker health none会让正式gate在19步前自锁，完整loopback镜像引用不能作外部锚点，监控也缺host delivery与真实通知/ack。
- 控制面：D-129与[投产专项授权执行包](../self-hosting/production-authorization-packet.md)把A1—A8拆到host安装、外部源码/镜像、三份正式门动作、四域五阶段备份恢复、监控投递/绿色窗口、UAT技术晋升、数据/岗位/跨岗/员工及正式切换。每步都固定影响、排除、root-only输入、停止线、验收和回退；A6还区分Web/Worker晋升与PostgreSQL/Caddy/`chenyida-erp.service`显式动作。
- 调度结论：当前TASK51摘要只保留审计快照；TASK53会修改候选输入，A1必须等待新bundle，A3必须先于A2的完整外部digest引用。当前不索取会注定失败或绑定旧身份的授权，下一安全任务固定为`SELFHOST-RELEASE-GATE-LIFECYCLE-53`。
- 验证/资源：Markdown389文件/222本地链接、JSON211、断网只读容器credentials1,591及`git diff --check`通过；范围仅docs。收口available约2.0GiB、Swap724MiB/1GiB、根盘16GiB、Load低于1、内核OOM0；四服务restart0/OOM false、受保护Volume集合不变，临时扫描容器/清单清零。
- 结论：`DONE / AUTHORIZATION CONTROL PLANE COMPLETE / REPOSITORY PREREQUISITES OPEN / PRODUCTION NO-GO`。没有安装host组件、创建可消费授权、连接或修改UAT/生产、读取真实数据、外传、账号或切换动作。

### SELFHOST-RELEASE-CANDIDATE-REFRESH-51 - `docs: start current candidate refresh` / `fix: separate candidate manifest and config identity` / `build: bind candidate identity supervisor bundle` / `docs: close current candidate refresh`

- 调度/范围：TASK50收口`11785d4dac3e1afeb936f7a7a0626a25443fa371`后的零`DOING`自动切换为TASK51唯一active task；严格起点tree为`91a6e752c3265e98208f4ae18a2e8437ecffe2fa`、alpha.46/0045，UAT仍alpha.42/0040。
- 事实：TASK48 Web/Worker本机manifest仍可解析但绑定旧`8952a815`；TASK49/TASK50改变候选输入，不能复用历史零发现为当前HEAD结论。TASK50 policy SHA-256`8c9f9fd0…f444`、六服务隔离probe和19步计划已验证但尚无当前镜像。
- 目标：从clean Git snapshot串行重建Web/Worker，在任务loopback registry取得digest，复核TASK50 runtime policy，以固定Trivy/72小时内数据库生成当前镜像CycloneDX与全部severity零发现，并只从正式入口尝试19步门。
- 边界：不安装host supervisor、不外部push、不修改/重启UAT或运行真实Migration/deploy，不读取业务数据、`.env`、容器环境、日志、四卷/备份正文或未跟踪状态报告，不prune或删除既有资源。
- 起点资源：available约2.2GiB、Swap714MiB/1GiB、根盘18GiB、Load`0.23/0.35/0.43`；Docker images23.09GB、Build Cache6.977GB，四服务restart0/OOM false。所有build/扫描串行，一次最多一个TASK51临时容器。
- 真实失败/修复：首个`79f8dee`候选使静态Compose合同通过，但旧runtime probe将Docker29 `.Id`的manifest语义误作OCI config而失败；TASK50又曾误传manifest为config并掩盖该断言。D-128与`12beccf0`分别闭合精确RepoDigest manifest和descriptor annotation config，错误manifest/config均有负向测试；`8084d6c3`作为唯一直接子提交只更新44文件bundle，SHA-256`f4481316…5ce6`。
- 最终候选：从clean `8084d6c3`/tree`a54473f6`精确重建。Web manifest/config为`sha256:249d0ce4…5b7f`/`sha256:7c7b0d38…3de5`，Worker为`sha256:0e07fded…8370`/`sha256:af000408…4e88`；root-only构建回执SHA-256`f490b969…c1b2`，Compose和六服务runtime probe均通过且`max_containers=1`。loopback registry已删除，本机引用不是外部恢复锚点。
- 安全诊断：固定Trivy0.70.0及UpdatedAt距扫描11.8小时的schema2数据库，断网无socket逐archive扫描；数据库树前后均为`def6b023…86b`。Web覆盖Wolfi25+npm63、Worker25+60，全部severity0、CycloneDX漏洞0；四份root:root0440 diagnostic制品摘要已写入任务记录。
- 正式边界：镜像证据与19步门入口均在制品变化前因installed supervisor缺失退出1，6制品指纹`d1136173…6b4f`不变；没有伪造授权、正式SBOM/security evidence、gate PASS或`ELIGIBLE`manifest。
- 最终验证/资源：release48/48及直接45/45、supervisor31/31、lint0 error/11既有warning、credentials1,589、35个Shell、211个JSON、211个本地Markdown链接、bundle重生成和diff门通过。起点/收口available约2.2/2.2GiB、Swap714/730MiB、根盘18/16GiB、收口Load`1.38/1.23/0.81`，内核OOM0；四服务restart0/OOM false，任务临时容器/网络/Volume/tar/目录清零，UAT和四卷未变。
- 结论：`DONE / CURRENT EXACT LOCAL CANDIDATE BUILT / ZERO-FINDING DIAGNOSTIC VERIFIED / FORMAL SUPERVISOR GATE BLOCKED / PRODUCTION NO-GO`。host supervisor、外部镜像锚点、异机恢复、UAT部署、真实迁移、员工试用和切换继续需要专项授权或外部资源。

### SELFHOST-OPS-CONTAINER-RUNTIME-HARDENING-50 - `docs: start container runtime hardening` / `feat: harden container runtime policy` / `build: bind container runtime supervisor bundle` / `docs: close container runtime hardening`

- 调度/范围：TASK49治理收口`1a4bd16e3428fded7cd5569595fa47df82831f7c`后的零`DOING`自动切换为TASK50唯一active task；严格起点tree为`518cbdd9001e933c6577ccbed499eb8287ec5666`、alpha.46/0045，UAT仍alpha.42/0040。
- 实际风险：只读Docker metadata显示现行PostgreSQL/Web/Worker/Caddy均`ReadonlyRootfs=false`、无显式`CapDrop`/`CapAdd`/`SecurityOpt`；Web/Worker user为`node`，PostgreSQL/Caddy未声明user。Compose起点只对migrate形成部分加固，admin和当前四服务都没有统一失败关闭合同。
- 目标：建立版本化逐服务最小权限策略，收紧只读rootfs、capability、no-new-privileges、tmpfs与精确可写挂载；禁止privileged、Docker socket、host namespace/device和任意host root bind，并用负向合同及一次一个临时容器的隔离运行证据验证必要例外。
- 边界：不修改/重建/重启现行UAT，不读取业务表、`.env`、容器环境、日志、四卷/备份正文或未跟踪状态报告，不运行真实Migration/deploy，不修改账号、网络、systemd、Swap、kernel或Docker daemon。只读事务确认UAT为40/head0040；所有后续build/测试串行且只清理TASK50精确创建的临时资源。
- 起点资源：available约2.2GiB、Swap718MiB/1GiB、根盘18GiB、Load`0.05/0.21/0.71`；四服务restart0/OOM false，Web/PostgreSQL healthy、旧Worker/Caddy health none。系统继续`PRODUCTION NO-GO`。
- 决策/实现：D-127固定完整六服务/profile集合、精确写路径和内核态复核。版本化policy及标准库validator绑定Docker Engine29.5.2/Compose5.1.4、源码hash、用户/组、只读rootfs、capability/NNP、mount/tmpfs/port/network/resource/logging/lifecycle/process/health/environment；未知服务/字段、变量host bind或弱化失败关闭。六服务均drop all/NNP/read-only，PostgreSQL为999:999零cap，Caddy仅保留`NET_BIND_SERVICE`。
- 发布门：新增第19步`CONTAINER_RUNTIME_TEST:RUNTIME_POLICY`，由content-addressed supervisor在只读Git快照中串行执行；runtime probe使用固定标签/名称、无host端口、最多一个临时容器，明确拒绝四个受保护Volume并验证应用、工具、PostgreSQL和Caddy的内核身份、允许/拒绝写入及热重启。
- Git/证据：实现提交`375869f7d1544fa6fe437e2603af78a4021c4c91`/tree`ac5a5bfa68d3a76c7a6121a0a8d204e8169f3644`；只改canonical manifest的直接子提交`f119c8f6d99f98778975ad83df2b736de148e69f`形成44文件bundle，SHA-256`ab6b708e9cfe74f0902296f0a32e74620cf3368e883ba536326789e0b7828cbe`；policy SHA-256`8c9f9fd06eb4533faeeed4c316eb93568c38b3a42ac8c48dd081fbb4e7a2f444`。
- 最终验证：干净HEAD Compose policy和六服务实际runtime probe通过，`max_containers=1`；runtime合同10/10、supervisor30/30、release6文件/48项及直接45/45、lint0 error/11既有warning、1,588文件凭据扫描、Shell/JSON/Markdown链接和diff检查通过。Schema/TypeScript未改，故不重复运行完整PG业务回归/typecheck；PostgreSQL镜像已完成隔离init/SQL/负向写入/热重启。
- 诚实失败/资源：一次漏传reader GID在建容器前失败关闭，补齐GID1000后通过；一次ad-hoc凭据容器因host bind不可见在读文件前退出，官方Git archive固定Node沙箱随后全仓通过，均无残留。起点/收口available约2.2/2.2GiB、Swap718/714MiB、根盘18/18GiB、收口Load`0.16/0.41/0.45`；UAT四服务restart0/OOM false，任务容器/网络/Volume清零，四个受保护Volume未触碰。
- 结论：`DONE / REPOSITORY AND ISOLATED VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`。现行UAT仍为alpha.42/0040和旧运行配置；下一安全任务重建当前精确候选并取得新鲜镜像安全/19步门证据。

### SELFHOST-OPS-MONITORING-ALERTING-49 - `docs: start monitoring and alerting closure` / `feat: add fail-closed operations monitoring` / focused contract and regression fixes / `docs: close monitoring and alerting closure`

- 调度/范围：TASK48治理收口`d5df673c602fdc4e558c2799b31dbf1b208316e8`后的零`DOING`自动切换为TASK49唯一active task；严格起点tree为`62c8feb425c7546db2afc7b2dc78f0050bf615e2`、alpha.46/0045，UAT仍alpha.42/0040。
- 目标：把既有live/readiness、Worker租约、Docker metadata、低资源阈值、release/Migration身份及备份恢复证据统一为严格版本化、确定性、去敏的运行快照和告警生命周期，并交付可运行CLI、合成/隔离测试与排障手册。
- 边界：主智能体唯一写入，数据迁移、应用测试、运维安全三线只读审计；不安装systemd/cron/supervisor，不发送真实通知，不连接UAT/生产数据库或网络，不读取日志、环境、卷正文、备份正文、凭据、业务数据或用户未跟踪状态报告。
- 起点资源/运行：available约2.2GiB、Swap734MiB/1GiB、根盘18GiB、Load`0.31/0.32/0.37`、`oom_kill=0`；四服务restart0/OOM false，Web/PostgreSQL healthy、Worker/Caddy health none。仅观察Docker metadata，未修改服务或受保护Volume，系统继续`PRODUCTION NO-GO`。
- 决策/实现：D-126固定最小去敏observation、单一资源阈值权威、严格字段/时间与四服务集合、应用/release/Migration/备份恢复证据新鲜度、稳定中文告警和FIRING/REMINDER/ESCALATED/RECOVERED。`operations/monitoring-policy-v1.json`绑定既有资源策略，`tools/ops-monitoring/`交付contract、collector、原子hash-chain state store和CLI；无外部渠道时只写pending且非零退出。
- 安全加固：Dashboard backup-status读取增加可信root/marker、owner/mode、稳定`O_NOFOLLOW`读取和有界安全投影；采集器只接受显式去敏事实，不输出SQL、堆栈、完整URL、环境变量、卷正文或原始异常。Caddy可为running/none，PostgreSQL/Web/Worker必须healthy的发布健康语义与TASK45保持一致。
- 宿主诊断：只读Docker/资源metadata采集对现行alpha.42/0040旧镜像、Worker health none及缺失的应用/release/Migration/备份证据如实生成CRITICAL；Caddy `running/none`按其无healthcheck合同接受。没有连接UAT API/网络/数据库、读取日志、`.env`、四卷或业务数据，也没有用缺失证据伪造健康。
- 测试驱动修正：完整Node门发现AI建议Migration测试仍把0041误作当前head；完整PostgreSQL门发现Normalization夹具没有模拟parser写入batch counters，且底层queue过期lease按接口返回`false`而旧断言要求直接抛错。三处均按当前生产契约最小修正并更新内容摘要，未改写Migration、放宽约束、跳过测试或把失败记为环境问题。
- Git/证据：监控主实现提交`08f89c6174e887ef03eae2b98b66f0f3cac1c0f5`；最终内容寻址源码/测试提交`7debd4dbb0126be57796651921298846f7699027`、tree`315276e04ab4ab28db5a4f6a720b42430167429c`，manifest-only子提交`56535a06600ce2fece2152d06d3597dfd0e470d9`，bundle SHA-256`76b919cd412af0438f9fedd34cb0ba7e8a3ff244bb7d276e6af8867a2fca6a95`。
- 最终验证：监控14/14；release合同6文件/48项及直接45/45；supervisor Python20/20；Vinext build与Node113文件/964项；隔离PostgreSQL83文件/396项；typecheck38/38；SPECIAL POSIX4文件/29项；lint0 error/11个既有warning；credentials扫描1,582个版本化文件及`git diff --check`通过。
- 资源/结论：所有重任务串行。起点/收口available约2.2/2.2GiB、Swap734/719MiB、根盘18/18GiB、最终Load`0.64/1.16/1.35`；四服务restart0/OOM false，本任务临时容器/测试数据库清零。未安装host服务、发送真实通知、运行真实Migration/deploy或修改持久数据；结论为`REPOSITORY MONITORING CONTRACT VERIFIED / HOST DELIVERY NOT CONFIGURED / PRODUCTION NO-GO`。

### SELFHOST-RELEASE-CANDIDATE-EVIDENCE-48 - staged source hardening / `fix: validate Wolfi candidate package coverage` / `build: bind Wolfi scan coverage supervisor bundle` / `docs: close isolated candidate evidence`

- 调度/范围：TASK47释放active slot后，按持续交付目标把TASK48登记为唯一`DOING`。严格起点为`main@d554a150a2f9cb4b672dc49785ed63bf3e0edfc8`、alpha.46/0045；UAT只读仍为alpha.42/0040、227表，当前服务不变。
- 授权边界：依据项目负责人本轮明确允许的“隔离环境中的测试、构建和迁移演练”，D-122允许本地候选build、固定公共工具/漏洞库只下载和临时loopback registry；禁止外部push、host supervisor安装、UAT/生产Migration/deploy、当前四卷或真实数据访问。
- 验收方向：精确Git commit/tree构建Web/Worker、固定registry digest及OCI/baked身份、Trivy 0.70.0与72小时内数据库、两镜像CycloneDX SBOM、全severity零发现，并只通过正式supervisor路径尝试18步同候选门。host supervisor未安装时必须失败关闭，不得旁路冒充PASS。
- 运行观察：官方18步门会只读记录现行四服务Docker status/restart/OOM/health并要求前后一致；本任务将其限定为元数据观察，禁止连接UAT网络/API/数据库、读取日志/卷正文或修改服务。
- 起点资源/安全：available约2.4GiB、Swap744MiB/1GiB、根盘27GiB、Load`0.05/0.49/0.88`、内核OOM0，四服务restart0/OOM false、BuildKit cache0B；唯一未跟踪状态报告继续不读、不改、不提交。
- 源码审计/修复：D-123固定Dockerfile frontend和三个Node阶段完整digest；新增clean HEAD精确Git archive、Web/Worker串行build、Registry 2.8.3 loopback digest回拉及不可变`candidate-build-provenance/v1`。scan provenance升级v2并强绑同run/candidate/reference回执；installed supervisor从可信bundle加载合同代码但显式哈希候选仓库Migration目录。依赖安装诚实记录为公共npm+lockfile integrity，应用build断网；本地digest明确不是外部恢复锚点或可复现attestation。
- 源码验证：固定Node单容器定向38/38、官方release-contract 6文件/48项、inventory235/211/24及lint 0 error/11条既有warning通过；Shell语法和`git diff --check`通过。每次临时容器精确清理，OOM0、四服务restart0/OOM false及health元数据不变。本阶段尚未build候选、准备Trivy数据库、扫描或运行正式18步门。
- 漏洞驱动加固：首批候选被新鲜Trivy严格拒绝后，最终运行层从Debian/完整Node改为固定Wolfi manifest加精确`nodejs-22-minimal=22.23.2-r1`；Next升级16.3.0、React族19.2.8，Worker只复制离线prune后的production依赖，Web在完整运行图证明后删除仅构建可达的`image-size@2.0.2`。最终两镜像均以`65532:65532`运行、无npm，公共npm/APK输入及不可复现/无外部锚点局限写入v3构建回执。
- 身份合同：D-124把registry manifest、本机inspect identity与OCI config digest分开绑定；D-125把Trivy原生/CycloneDX覆盖严格固定为唯一`wolfi 20230201`、`os-pkgs/wolfi`、`lang-pkgs/node-pkg`及`pkg:apk/wolfi`+`pkg:npm`双清单，Debian、未知生态、缺包或重复OS失败关闭。6文件48/48、supervisor20/20、release typecheck、lint0 error/11既有warning及1,575文件credentials通过。
- Git/构建：运行层源码`864789c80b0bf7bca10df1b6a4067deb5154b42c`与bundle子提交`cc9ebbf48bc16da5b685fc919bb0f55e8f6e5a44`，严格覆盖合同`13c422944c1eb7c4de83ac0b40414b7b1b822a18`与最终bundle直接子提交`8952a815cac837d201ff821df16d4a21b61711c4`形成链；bundle SHA-256为`53729db3…61f9`。最终精确tree`1ac73360…faf4`的Web/Worker manifest为`sha256:27868850…92288`/`sha256:e85ce236…ee77c`，config为`sha256:161ea63b…f6c53`/`sha256:f8dc4ac7…817c1`；构建回执SHA-256为`dc24889d…34d9`。
- 运行与安全诊断：Web/Worker均为Wolfi/Node22.23.2、非root、无npm；Web Migration为只读且`/api/live`返回alpha.46，Worker无数据库配置时只返回净化失败码。固定Trivy 0.70.0、7.5小时内数据库、断网、无Docker socket归档扫描覆盖Web 25+63、Worker 25+60包，`UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL`全部为0；数据库树摘要前后均为`def6b023…86b`，四份root-only诊断制品按SHA保存于仓库外。
- 正式门/结论：`create-release-image-evidence.sh`与`run-release-gate.sh`在任何制品写入前分别以“必须由installed supervisor启动”退出1，artifact root不变；未安装、旁路或伪造host supervisor。TASK48按授权内完成收口，但没有正式provenance/SBOM/security evidence、18步PASS、`ELIGIBLE`manifest、外部registry锚点或UAT部署，系统继续`PRODUCTION NO-GO`。
- 资源/保护：起点available约2.4GiB/Swap744MiB/根盘27GiB，最终2.2GiB/734MiB/18GiB/Load`0.31/0.32/0.37`，`oom_kill=0`；四服务image/restart/OOM/health未漂移，临时registry、容器、tar和目录清零，成功候选及审计证据保留。未读未跟踪状态报告、`.env`、业务数据、日志或四卷正文，未prune、部署、Migration、账号或系统变更。

### SELFHOST-RELEASE-BROWSER-HARNESS-47 - `docs: start release browser harness closure` / focused runtime and test fixes / `docs: record browser gate validation pause` / `build: bind release browser supervisor bundle` / `docs: close release browser gate`

- 调度/范围：TASK46治理收口`fbbf2a5d034d11d8a50f823a55ef78d2d32d682d`后的零DOING自动切换为TASK47唯一active task，完成后按`DOING→DONE`释放active slot。任务只关闭发布清单中的6个REQUIRED Browser E2E；不把历史手工Chromium、宿主偶然依赖或定向Node测试冒充发布Browser门。
- 运行时/执行器：固定官方Playwright `1.51.1`镜像完整Repo/config digest、`linux/amd64`、Chromium revision 1161/version `134.0.6998.35`、可执行路径/SHA和精确依赖树；Git archive干净快照在固定Node镜像断网生成测试standalone，PostgreSQL 17 rootfs与Web/Chromium在唯一Browser容器内运行，保持只读rootfs、最小capability、资源限制和失败清理。
- 历史数据库/合同：6文件inventory固定路径、摘要、数据库、loopback端口、确认变量和历史目标head；0036—0039模板先按正式不可变Migration事务性升级到0045，再逐库逐文件执行。`browser-e2e`从运行时不可用占位改为真实失败关闭动作，runtime policy、gate report和supervisor负向合同绑定Browser身份。
- Browser证据：第十三次完整干净快照运行`task47-thirteenth-clean`实际通过6文件/11项，覆盖planning revision response、purchase traceability、requirement unit resolution、RFQ binding、RFQ traceability和supplier mapping；无skip/todo，路径集SHA-256为`71742177a734c12b1a53f63a93f8a68344c68c9400a7c3e0d9a9f9a4ad08ac86`，服务、合成数据库和临时资源全部清理。
- Git/证据：最终源码`9a18a0f307348c974a6f341565e7d16d76df184c`/tree`8c182d38f1acbcebe10d46e3a09f73c9ec612f22`与manifest-only直接子提交`614ef7ac2aea5ec23029c81b17b8c21adc0935dd`形成39文件证据链；bundle SHA-256为`e54019dfde0af7a9a8367b5ade53976b1ffc4b24f9b36e46ae3778ed963a7192`。
- 最终验证：release合同6文件/45项、supervisor Python20项、完整typecheck38/38、lint0 error/11条既有warning及inventory235/211/24通过；治理收口另通过JSON、Shell、Markdown链接、控制协议、凭据模式、范围和`git diff --check`。
- 资源/安全：Browser前available2,424,572KiB、Swap76.32%、根盘27GiB；Browser后Swap短暂80.14%时按规则停止新重任务且未修改Swap或服务，自然回落后才继续；最终available2,481,228KiB、Swap73.47%、Load`0.98/1.91/1.62`、内核OOM0、四服务restart0/OOM false、任务临时资源0。未连接UAT/生产、读取四卷正文/凭据/业务数据、build/push候选镜像、运行真实Migration或deploy，系统继续`PRODUCTION NO-GO`。

## 2026-08-12

### SELFHOST-RELEASE-BROWSER-HARNESS-47 - `docs: start release browser harness closure`

- 调度/范围：TASK46治理收口`fbbf2a5d034d11d8a50f823a55ef78d2d32d682d`后的零DOING自动切换为TASK47唯一active task。目标只关闭发布清单中的6个REQUIRED Browser E2E，不把历史手工Chromium、宿主偶然依赖或定向Node测试冒充发布Browser门。
- 起点事实：6个文件全部存在且无skip，分别需要隔离合成PostgreSQL、历史Migration head 0036—0039和standalone Web；现有`browser-e2e`动作明确返回运行时不可用。UAT保持Web alpha.42/数据库0040，四服务restart0/OOM false，本任务不连接运行面。
- 设计边界：固定官方Playwright/Chromium镜像的digest/config/platform、精确包锁、固定PostgreSQL 17 rootfs和只读Git快照；构建、数据库导出、Browser测试串行且任何时刻最多一个临时容器。允许仅为隔离测试拉取固定Browser runtime和生成测试build，不build/push Web/Worker候选镜像。
- 保护/资源：不访问UAT/生产业务数据、凭据或四卷正文，不运行真实Migration/deploy/restart，不改变账号或宿主配置，不prune。起点available约2.0GiB、Swap484MiB/1GiB、根盘31GiB、Load`0.06/0.22/0.71`，内核OOM0；用户未跟踪状态报告保持不读不改不提交。

### SELFHOST-RELEASE-TYPECHECK-CLOSURE-46 - `docs: start release typecheck closure` / `fix: close release typecheck gate` / `build: bind release typecheck supervisor bundle` / `docs: close release typecheck gate`

- 调度/范围：TASK45治理收口`ffd0ba6e705f79d4c0bef06952d725d7510b8782`后的零DOING自动切换为TASK46唯一active task。目标只关闭固定离线Node沙箱中的全部38份`tsconfig*.json`发布门，不以TASK43—TASK45定向typecheck替代。
- 保护：不build/pull/push镜像，不连接或修改UAT/生产、当前四卷、账号或业务数据，不运行真实Migration/deploy/restart；用户未跟踪状态报告及`shujvbiao/`不读、不改、不提交。
- 起点：源码alpha.46/0045；现场只读核验UAT仍为Web alpha.42/source revision`569aa954…d33a24`和数据库40/head0040，四服务restart0/OOM false、四卷metadata存在。资源约available1.9GiB、Swap453MiB/1GiB、根盘30GiB、Load`0.93/0.61/0.38`，当日内核OOM匹配0。
- 验收：完整门必须在干净提交快照、固定Node镜像、断网和资源限制内38/38通过；禁止降低strict/noEmit/isolatedModules、跳过配置、用ignore或扩大exclude隐藏可发布源码。Browser、候选build/SBOM/漏洞、UAT对齐及production readiness仍不在本任务授权内。
- 类型合同：D-120把自托管运行边界对齐到Node 22/ES2022；根配置只排除历史D1示例和废弃本地D1 seed，不隐藏自托管可发布源码。真实类型修复覆盖Material查询/Validation、导入/Normalization、文件大小、Material UI判别联合、API泛型、离线身份、Browser evidence和rehearsal模块边界，没有修改业务规则、Schema/Migration、权限、事务或API语义。
- 失败关闭执行器：`release-test-inventory.mjs`固定精确排序的38配置清单，执行前后核对集合、普通文件与内容摘要；每个配置使用`--incremental false`，新增、删除、重命名、漏跑、执行中漂移或提前成功均拒绝。`npm run typecheck:release`和release sandbox复用同一入口，清单/运行策略摘要及漂移负测同步更新。
- Git/证据：源码`f3bac028bdb9ccf4c79be279ea7c4f698cbdd4f5`/tree`87fb1340bc1b7067e67be29677960546b0f8cd5c`与manifest-only直接子提交`3d1243e294236602975d3beb29e8f991b84db96d`形成证据链；bundle manifest SHA-256为`a92c0a4088693b7bd23493a4820457b3f9dae4e2807e416f20218cb0e1d3b97b`。
- 验证：首次完整门如实记录ES2017/真实类型/历史示例/只读增量失败；修复后源码和bundle两个连续干净提交快照均38/38并输出`TYPECHECK SET PASS configs=38`。定向Node287/287、release合同6文件45/45、supervisor15/15、inventory235/211/24、干净快照lint 0 error/11既有warning、credentials 1,566文件以及JSON/Shell/Markdown链接/控制协议/敏感/范围/`git diff --check`通过。
- 资源/边界：一次错误包含`.wrangler/work`的直接工作区lint在768 MiB V8 heap内存耗尽退出139；宿主内核与容器OOM均为0、Swap只约增加27 MiB，随后正式干净快照lint通过。起点/收口available约1.9/2.0 GiB、Swap453/484 MiB、根盘30/31 GiB、Load1低于4，四服务restart0/OOM false，任务容器/目录清零。未build、连接UAT/生产、运行Migration/deploy、读取当前四卷正文或业务数据；UAT保持alpha.42/0040，系统继续`PRODUCTION NO-GO`。

### SELFHOST-RUNTIME-HEALTH-TRUTH-45 - `fix: enforce truthful runtime readiness` / `build: bind runtime readiness supervisor bundle` / `docs: close runtime readiness hardening`

- 调度/边界：TASK44收口后的零DOING按持续交付路线切换为TASK45唯一active task，再按`DOING→DONE`释放active slot。严格起点为`main@43b6d81d21a9c5cecd567893b1ab6cf320afff05`、alpha.45/0044；UAT只引用既有文档事实alpha.42/0040，本任务未连接复核。
- 健康语义：新增数据库初始化前的`/api/live`；`/api/health`改为失败关闭readiness，精确核对Web运行身份、源码root-owned只读Migration清单、数据库完整history/checksum、同候选Worker新鲜租约及uploads/attachments真实写入、fsync与清理。公开失败只返回稳定代码、中文提示、request ID和component状态，不返回SQL、路径、instance ID或原始异常。
- Worker/文件：0045建立固定service slot、UUID、generation、CAS version、数据库时钟和RUNNING/STOPPED租约；有效租约排斥第二实例，过期或停止后才能接管。Worker启动前核验身份/Migration/双卷，运行期单飞续租并在轮询/发布前核对精确实例；容器内`0600` UUID文件使Docker healthcheck不能借旧租约假健康。随机私有探针只清理本次inode闭合对象。
- Migration/发布：新增append-only`0045_runtime_worker_readiness.sql`，SHA-256为`cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`；0001—0044前缀digest保持`16d9b316…34d8`，Schema/snapshot/journal/运行查询/release allowlist一致。发布身份工具要求Web与Worker同时healthy，源码版本为alpha.46/head0045。
- Git/证据：源码`74940866f7deac7b2751278479e8cefb4df35c1c`/tree`d4673e36b6822deb0f6d2d6058b36c6ffb3cf2f1`与manifest-only直接子提交`dcef6f67c75d771ad3a3dd9fe6f5aa385fc81f92`形成证据链；bundle SHA-256为`090f72189bab8c61fec11810550da4426f123adac6d3d4391da5d49b62028606`。
- 验证：runtime readiness定向42/42、隔离PostgreSQL5/5、官方release Migration harness、release合同44/44、supervisor Python15/15、TASK45/release-contract定向typecheck、Compose config和lint 0 error/11既有warning通过；inventory为235/211/24（Pure Node112、PostgreSQL83、Browser6、历史22、PG alias2、release contract6、special4）。治理收口再通过1,564文件凭据扫描、109个本地Markdown链接、134项控制协议、只读控制器、Shell/JSON、范围与`git diff --check`。
- 安全/资源：未运行完整候选Node/PostgreSQL/Browser/全部tsconfig、build/SBOM/漏洞或18步候选门；未访问UAT/生产、当前卷正文、账号或业务数据。验证期间available约1.9—2.0GiB、Swap449→453MiB/1GiB、根盘约30GiB、Load1低于1；四服务restart0/OOM false，临时容器/数据库/文件清零。UAT仍alpha.42/0040旧实现，系统继续`PRODUCTION NO-GO`。

### SELFHOST-IDENTITY-SESSION-SAFETY-44 - `fix: enforce absolute session lifetime` / `build: bind session safety supervisor bundle` / `docs: close session lifetime hardening`

- 调度/边界：TASK43收口后的零DOING按持续交付路线切换为TASK44唯一active task，再按`DOING→DONE`释放active slot。严格起点为`main@0caa565f3954bade15526bbef1e3c3b742b44a17`、alpha.44/0043；UAT只引用既有文档事实alpha.42/0040，本任务未连接复核。
- 身份/会话：D-118的8小时idle、创建时固定24小时absolute、PostgreSQL `now()`和用户→会话锁序已落地。创建与续期受`least(now()+8 hours, absolute)`约束；并发撤销、停用、重置或超时后不得返回旧actor，idle/absolute只终态化并去敏审计一次。
- API/Cookie：`/api/session`与普通受保护API稳定区分`SESSION_EXPIRED`、`SESSION_REVOKED`和`AUTH_REQUIRED`，携带expired/revoked/unknown token时对称清除Session/CSRF Cookie；request ID、中文提示与`no-store`保持，匿名无Cookie不产生副作用。
- Migration：新增append-only `0044_identity_session_absolute_lifetime.sql`，SHA-256为`a24df94474403c4f235933d4450626ce65b40416264393db400cef08e7fcaa7e`；0001—0043未修改，Schema/snapshot/journal/运行查询/release allowlist一致，源码为alpha.45/head 0044。
- Git/证据：源码`e7b0298f90ba85a5018709be1360a40dacbbaa59`/tree`43aa32601c8cd5a953de41e48c19f6e9860ed87c`与manifest-only直接子提交`c730fefe0857d2e4546f28364ca53d5e6506d099`形成36文件证据链；bundle SHA-256为`ad1a66d3e1c30a4ac18fbdeff1e7d23d70488187826ecbc3ae9ebdf2cc961c86`。
- 验证：最终定向与release合同55/55；会话专项PG7/7、既有身份PG10/10、身份升级4/4共21/21；官方release Migration harness在已提交源码上退出0；inventory为232/208/24，supervisor15/15、TASK44 typecheck、lint 0 error/11既有warning通过。治理收口另通过只读控制器`IDLE`及134/134回归、Python三基线、99个本地Markdown链接、1,548文件凭据扫描与`git diff --check`。
- 安全/资源：未运行完整Node/PostgreSQL/Browser/typecheck、候选build/SBOM/漏洞或18步候选门；未访问UAT/生产、账号、当前四卷或业务数据。收口available约2.0GiB、Swap442MiB/1GiB、根盘31GiB、Load`0.21/0.21/0.33`，四服务restart0/OOM false、内核当日OOM 0；任务临时容器/测试库/进程清零。运行UAT仍alpha.42/0040，系统继续`PRODUCTION NO-GO`。

### SELFHOST-MATERIAL-IMPORT-SAFETY-43 - `feat: complete recoverable material import fallback` / `chore: bind material import release supervisor bundle` / `docs: close material import fallback hardening`

- 调度/决策：TASK42收口后的零DOING按持续交付路线切换为TASK43唯一active task；D-117固定数据库意图、私有staging、服务端实际检查、同根无覆盖原子提升、最终发布和可恢复协调，不把PostgreSQL与文件系统误称为单一ACID事务。任务现已`DOING→DONE`并释放active slot。
- API/幂等：建批、上传、取消和解析均使用持久幂等；上传在读取正文前完成认证、权限、CSRF、必填头、owner/状态/CAS与幂等意图校验。不可见统一404；错误使用稳定code、中文message、request ID和no-store。保护写响应不确定时，UI保留精确operation/key/payload并阻止替代或依赖写入。
- 文件/saga：新增私有staging、服务端确定性受限路径、有界写入、实际SHA/大小/签名/MIME/安全检查、`fsync`与无覆盖hard-link promotion；XLS CFB、XLM/VBA/宏和伪装输入失败关闭。promotion、reconciliation、过期、取消、delete-pending及显式retry lineage持久化，未知身份文件不猜测删除。
- Job/Worker：job通过outbox aggregate关联批次并复核owner或`material.import.read_any`，只返回有界DTO；worker消费前重新哈希文件，并在单事务发布job terminal和parse/normalization/review终态，过期或失去lease的worker不能终态化。
- Migration：0042建立fallback安全模型并在发布后保持不可变；追加0043修正终态约束，0001—0042未回写。源码head为43，0041/0042/0043 SHA-256分别为`676626b9…bf2`、`c0eeab63…85bf`、`0fdb3d4b…52d9`，Schema/snapshot/journal/运行查询与release allowlist一致。
- Git/证据：源码提交`5767c92e51e4f25ba49fa4431299f265ef4cb7aa`/tree`bb4ef005cc9d9eb858e553d6a1825298845352bb`与manifest-only直接子提交`dad7468`形成两提交链，bundle SHA-256为`b948e08861e5114660650e21faa9374cef879b354cb59c6c0d0bdb62960228e9`。
- 验证：fallback unit/handler20/20、worker8/8、UI107/107、Migration4/4、parser/API client45/45、隔离PostgreSQL fallback17/17与真实XLSX worker1/1、相关组合176/176、TASK43 typecheck、lint 0 error/11既有warning、release contract44/44和supervisor15/15通过。inventory为230/206/24（Node109、PostgreSQL81、Browser6等）；凭据扫描在源码/收口阶段分别覆盖1,538/1,539文件，源码stage 43文件、任务累计61路径均在白名单，`git diff --check`通过。
- 边界/资源：完整Node-source/Browser/typecheck/候选镜像/SBOM/漏洞及18步候选门未运行；未连接UAT/生产、读取当前四卷、build/deploy/restart、运行真实Migration或使用真实数据。UAT保持alpha.42/0040。起点/收口available约2.2/2.0GiB、Swap425/439MiB、根盘31GiB、Load1低于4，四服务restart0/OOM false；任务容器、数据库和临时目录清零。系统继续`PRODUCTION NO-GO`。

### SELFHOST-OPS-RELEASE-GATE-42 - `feat: enforce immutable release candidate gate` / focused hardening / `chore: bind release supervisor bundle`

- 发布身份：新增严格release manifest、镜像SBOM/漏洞证据、测试计划/报告和完整Migration allowlist合同；prepared证据在外层二次核验Git/镜像身份后才不可变发布，runtime identity以root锁、两阶段prepare/commit/abort、单调及同证据幂等防止并发旧证据覆盖。
- Root边界：高权限动作改由content-addressed supervisor、短时一次性root授权和四个固定动作映射执行；安装器使用全局锁、不可变launcher/installer store、PREPARED/COMMITTED journal和可恢复授权消费。去capability测试发现并修复冻结目录跨父rename依赖DAC override；最终源码`d022f2c`及manifest-only `f67cc41`形成36文件bundle，SHA-256 `2ea4e4c…`。
- Migration/门禁：UAT/PRODUCTION只接受合格manifest、精确deployment/database稳定身份、专用非superuser数据库owner、当前/目标head和逐文件checksum；锁前后重验且空库拒绝未知public对象。18步低资源串行门固定执行器、资源阈值/timeout、无skip/todo、临时容器清理、既有服务restart/OOM及去敏机器报告。
- 隔离缺陷修复：所有发布Git调用禁用replace refs并固定archive `tar.umask=0022`；PostgreSQL快照预创建只读依赖挂载点；只读盘点PII扫描仅对白名单字段中的规范SHA/Git摘要和不透明引用豁免，普通文本手机号继续拒绝。上述缺陷均由正式提交快照门禁发现并新增回归。
- 验证：最终快照合同6文件/44及二次41/41、Node 107文件/886并隔离build、PostgreSQL 80文件/367、POSIX 4文件/29、supervisor 15/15、Migration allowlist、异集群备份恢复及Dashboard 2/2、Python三基线、Compose config和credentials 1,521文件通过；lint 0 error/11既有warning，`git diff --check`通过。完整多tsconfig仍因既有ES2017 BigInt/历史类型债失败，固定Browser运行时不可用。
- 边界/结论：没有build/pull/push候选镜像、联网扫描、host supervisor安装、UAT/生产连接、Migration/deploy、runtime identity发布、账号/服务/数据/四卷变更。没有候选镜像、Browser、镜像SBOM或新鲜Trivy PASS，故真实18步候选门未运行、未生成`ELIGIBLE`manifest；UAT保持alpha.42/0040，系统继续`PRODUCTION NO-GO`。
- 资源/清理：最终验证前后available约2.2GiB、Swap约427MiB/1GiB且无增长、根盘31GiB、Load1低于4；四服务restart0/OOM false。任务容器、隔离数据库和临时目录清零，未建删Volume/镜像或prune；用户既有未跟踪状态报告保持不读、不改、不提交。

### SELFHOST-OPS-BACKUP-RECOVERY-V2-41 - `feat: harden backup recovery evidence chain`

- 合同：新增D-115与严格四域V2 manifest/reconciliation/verification合同，绑定deployment、数据库system ID/OID/comment/profile/bytes、alpha.44、完整Git、实际Web/Worker容器及镜像digest、完整Migration 0041 manifest/head和PostgreSQL/uploads/attachments/backup-status。数据库dump明确为完整应用逻辑范围且排除owner/ACL/集群角色。
- 凭据/一致性：数据库URL退出argv，改为固定credential root内root-owned单硬链接`0400/0600` libpq service文件；凭据身份/摘要全程锁定。精确停止Compose writer、持久数据库fence intent、connection limit/默认只读/连接清退和前后全关系内容摘要共同形成一致性边界；中断恢复只接受精确稳定身份。
- 证据/恢复：本机、异机、恢复回执按backup/run生成不可变历史并单调更新别名；异机要求不同machine identity，恢复要求不同PostgreSQL system identifier和带marker独占TEST集群。恢复先pin异机字节、全文件staging、单事务pg_restore、Migration/数据库/文件reconciliation；故障精确补偿，建库响应歧义不误删，prepared receipt先落盘后发布并支持无数据库/文件重读的安全补发。
- Dashboard/镜像：旧V1固定`LEGACY_LOCAL_ONLY`；V2分离verification/identity/policy/assurance，只有未过期RESTORE证据与实际runtime/database/Migration/receiver/target全匹配才ready。新增root运行身份发布器、只读Compose挂载、Dockerfile source package一次验证、Web/Worker OCI+baked version/Git，以及legacy中文状态/cachebuster同步。
- 验证：断网只读受限Node容器`test:backup-recovery` 41/41；一个768MiB临时PostgreSQL容器内两独立集群完整备份/恢复、故障注入、守卫恢复、回执补发与Dashboard 2/2通过；Dashboard typecheck通过，lint 0 error/11条既有warning，shell/Dockerfile/UI/Compose/链接/JSON/敏感/`git diff --check`通过。Python self-test、项目既有`.venv` smoke和no-backup go-live全部通过；首次系统Python因缺`openpyxl`在启动前失败，未安装依赖或降低断言。
- 边界/资源：未读取当前PostgreSQL业务行或四卷正文，未生成/外传真实备份，未build、Migration、deploy、restart、登录或业务POST。收口available2.2GiB、Swap391MiB/1GiB、根盘31GiB、Load`0.35/0.28/0.32`，内核窗口OOM匹配0，四服务restart0/OOM false；任务容器、两测试集群/库和临时目录清零，未建删Volume/镜像或prune。G1合成隔离完成，G2仍等待异机目标/RPO/RTO/专项授权，系统继续production no-go。

### SELFHOST-PRODUCTION-READINESS-40 - `docs: establish production readiness baseline`

- 现场：从`main@bc14eb022528b8d0f242fec1d31ee41b9166b4cd`启动并以`d890987`登记唯一DOING；源码 alpha.44/0041、UAT alpha.42/0040、运行镜像/revision、私有跟踪引用、四服务、Python旧运行面、四卷、本机备份和资源均以实际只读证据核验。
- 结论：新增[投产准入基线](PRODUCTION_READINESS.md)，明确`PRODUCTION NO-GO`及十二项门禁。P0包括异机备份/当前隔离恢复缺失、备份恢复工具部分状态风险、发布身份断层、导入 fallback 幂等/文件/授权缺口、默认测试门不完整、真实迁移与员工验收缺失。
- 路线：固化 G0—G10 依赖、逐阶段验收和失败处理；下一安全任务为不接触真实数据的备份/恢复契约 V2。异机目标、真实数据、UAT Migration/build/deploy、身份权限、员工试用和切换继续需要专项授权。
- 数据库/API：没有修改 Schema、Migration、API或业务代码；UAT 数据库只在只读事务核验 Migration 元数据和表数，没有读取业务行或写入。
- 验证/资源：三条子智能体只读审计、主智能体代码复核、Markdown链接88、控制器/协议134/134、Python三基线、断网只读Node默认测试3/3通过；lint退出0并保留11个既有warning。Compose ps因缺`DATABASE_URL`失败关闭且未读取env重试；Docker inspect确认四服务restart0/OOM false。收口available约2.0 GiB、Swap389 MiB、根盘31 GiB、Load`2.09/0.98/0.50`，无OOM或临时资源；`git diff --check`、范围和增量敏感信息门禁通过。

## 2026-08-11

### SELFHOST-OPS-DOCKER-CACHE-CLEANUP-03 - `ops: reclaim docker cache space safely`

- 授权/边界：项目负责人在只读归因后明确回复“同意”。任务从唯一worktree、`main@1dcbf8de800410c0352a9a2c7cfb4b41b7e8bd37`、public behind0/ahead219起步；既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`不读、不改、不提交。只授权无引用BuildKit cache及达到30 GiB所需的逐ID历史candidate/test镜像清理；当前/alpha.41回滚/FIX38被拒证据/private GHCR本地锚点、Trae/MySQL、备份、Python/SQLite和四个ERP持久卷固定保护。
- 起点：根盘60 GB中可用17 GiB/74% used，`/var/lib/containerd`24 GB；Images 58/active6/24.45 GB/reclaimable12.39 GB，Build Cache 105/10.92 GB，Buildx Shared/Private 2.647/8.273 GB，Volumes 13/733.3 MB。available约1.7 GiB、Swap382 MiB、Load`0.10/0.19/0.16`；四ERP服务restart0/OOM false。唯一`default*` builder running，未发现build、测试、Migration或临时重任务。
- 清理：受控执行且只执行一次`docker buildx prune --all --force`，输出`Total: 10.92GB`且Build Cache归零；磁盘先恢复至25 GiB。随后分别确认并逐ID删除零容器引用的旧Playwright v1.51.1 `146d046a…cbbbd`（unique 3.551 GB）和alpha.37专用builder `72d489eb…d6ec5`（1.673 GB）。`df -h`此时显示30G，但精确检查只有31,345,692,672 bytes/29.19 GiB；因此继续逐ID删除alpha.37 migrate `24fcacdc…cf98f`（716 MB）和PostgreSQL 16测试基镜像`92620dad…dfc55`（504.8 MB），达到精确30 GiB阈值后停止。没有批量删除Web历史或其他tagged image。
- 结果：根盘可用17→32,581,345,280 bytes/30.34 GiB（`df -h`为31G）、used 74%→50%，containerd 24→8.9 GB；Images 58→54/9.505 GB/reclaimable5.942 GB，Build Cache 0B。当前Web/Worker/PostgreSQL 17/Caddy容器ID与镜像不变，Web/PostgreSQL healthy、Worker/Caddy running；回环/公开health均为alpha.42。当前、alpha.41回滚、FIX38被拒证据、GHCR本地锚点、Trae/MySQL、全部13个Volume和四卷创建时间保持，备份仍89 MB。
- 稳定/资源：最终60秒窗口available `2112798720→2102812672` bytes、Swap used `406355968→406355968` bytes（增长0）、Load1 `0.14→0.09`；四服务restart0/OOM false，窗口内核OOM记录0。最终available约2.0 GiB、Swap约388 MiB、根盘30.34 GiB，未触发资源停止线。
- 验证/清理：断网只读临时Node容器串行完成`npm test`3/3、lint退出0和1,469文件credentials扫描；Python项目venv在自动清理的临时SQLite中通过self-test/smoke/go-live 3/3。临时Node容器、Python目录、数据库和Volume均无残留，Build Cache保持0B，`git diff --check`通过。未修改业务代码、Schema/Migration、Compose、package/version或部署配置，未连接业务数据库、停止/重启服务、部署、push或创建PR。

### AGENT-R1-5 - `feat: add native ERP agent protocol MVP` / repair series / `docs: record native agent review evidence` / `docs: close native agent MVP`

- 实现：交付严格`chenyida-erp-agent-task/v2`、`erp-agent-message/v1`和`erp-agent-context/v1` Schema，扩展R1只读控制器支持v2，并新增Python标准库无状态validator。协议绑定单一写者、六角色唯一身份/能力/可见性、candidate/revision/lease、Context和artifact摘要、Evidence/Test、旧候选失效、VETO/Minority Report处置、checkpoint和`RESULT_UNKNOWN`恢复；Schema无法表达的跨数组身份关系由执行前标准库validator强制且文档明确披露。
- 合成试点：确定性bundle覆盖候选拒绝→修复、ERP/安全/对抗/QA门禁、旧PASS失效、Reviewer写入、路径/文件读取、重复/未知/错误摘要、Minority Report及恢复边界。最终候选固定为`25cbbfab87925a8601b844fe59c634ae0b651297`；从协议起点`1f55696b…d2f`到候选恰好20条允许控制文档/工具路径，无ERP产品、产品测试、Schema/Migration或部署路径。
- 独立门禁：ERP、Security、Adversarial、QA及全新源码盲审Black-box五份最终Message均绑定candidate `25cbbfa`、revision 2、lease 1和各自Context Manifest摘要并PASS。最终Message Schema、Context canonical digest、声明工件byte digest、input/evidence locator对应及26个Message ID唯一性通过；历史旧候选收据保留不可变，已知旧Security收据按最终Schema预期失败。
- 黑盒：只公开合成retry接口及按四类observable risk派生的四个Persona。第一次受限容器因UID 65534无权读取root-owned mode-0600 fixture而在执行前失败关闭；第二次在network none、只读rootfs、cap-drop ALL、no-new-privileges、单一只读fixture挂载、256 MiB、1 CPU、64 PID下返回四Persona PASS。两次均无OOM且仅见`/fixture`挂载，容器精确删除；随后全新Blind-box Agent只读三份公开工件独立PASS。
- 验证：协议unittest 87/87、控制器unittest 47/47，共134项通过；validator `0.5.4`对有效bundle双跑逐字节一致，stdout SHA-256为`f9923bb07c39e0bf3d62fb1383b200551429a7a7678d3b33bbf0c6339dc235d2`。R1在DOING时`READY`/errors空；本地Python `SELF_TEST_OK`、`SMOKE_TEST_OK`和127.0.0.1:18889/no-backup `GO_LIVE_CHECK_OK`通过。产品Node lint/build不适用于本控制面增量且未运行；公开Node黑盒runner已在隔离容器实际通过。
- Git/审计：起始状态提交`1f55696`，实现`470519c`，随后十一个聚焦失败关闭修复至最终候选`25cbbfa`；84份历史/最终审查证据由`ace4dc5`独立提交。治理收口使用本条标题中的独立`docs: close native agent MVP`提交，实际SHA以`git log`为准。项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交，未fetch/push或修改远端。
- 资源/清理：起点/最终available约`2.2/2.2 GiB`、Swap`354/357 MiB`、根盘`17/17 GiB`、Load`0.07/0.16/0.24`→`0.05/0.13/0.20`；内核OOM0，四服务restart0/OOM false，四个受保护Volume保持。Compose状态检查因必需env缺失而失败关闭且未读取env重试；任务容器及五个任务期Python缓存文件清零，无测试数据库/镜像/Volume，未prune。
- 收口/边界：`AGENT-R1-5 DOING→DONE`后零DOING/`IDLE`，不自动启动下一任务。未修改ERP业务/测试、产品Schema/Migration、API/UI/Worker、package、版本或部署配置，未执行holdout、模型、数据库、网络、UAT/生产、build、Migration、备份恢复、Compose变更、部署或发布。`PHASE4-TASK03`继续冻结，R2—R5、OS级身份、Control Store、强制lease和Capability Broker仍未授权。

### AGENT-R1-5 - `docs: start native ERP agent MVP`

- 决策/调度：项目负责人明确接受D-114并授权`AGENT-R1-5`，台账从零DOING按`AGENT-R1-5 TODO→DOING`切换唯一active task。`PHASE4-TASK03`继续`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`，不自动恢复。
- 范围：新增[任务合同](../tasks/AGENT-R1-5.md)和引导Task Packet；只授权Task Packet v2、Message/Context Schema、Python标准库无状态验证器、合成docs/test候选与故障注入、Codex原生只读门禁角色及源盲黑盒fixture。
- 边界：不修改ERP业务/测试代码、Schema/Migration、API/Service/UI、package或部署配置；不创建Control Store/daemon/R2身份或能力代理，不访问网络/UAT/生产/数据库/真实资料，不执行holdout/build/deploy/restart/backup/restore或Git push。
- 起点：唯一worktree、`main@4dd4abea02fe876665c8721e57d81f300da94c0a`、public本地behind0/ahead204；既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交。available约2.2 GiB、Swap354 MiB、根盘17 GiB、Load`0.07/0.16/0.24`，内核OOM0、四服务restart0/OOM false；Compose因缺DATABASE_URL失败关闭且未读取env。

### PM-002 - `docs: complete ERP multi-agent operating design`

- 现场核验：输入中的`0d6b5961…`、clean/private同步及`PHASE4-TASK03 IMPLEMENTATION NOT STARTED`已被后续仓库事实取代；任务从`main@2c8f8b2…`、public ahead203、既有未跟踪状态报告、alpha.44/0041 source-ready且TASK03 owner-hold、PM-001/D-113/R1已完成的现场开始。冲突已显式记录，未fetch/push或读取用户未跟踪文件正文。
- 设计：新增[多智能体执行设计包](../ai-engineering/README.md)和[PM-002任务合同](../tasks/PM-002.md)，覆盖4个常驻逻辑职责/单一确定性进程/0常驻LLM、动态核心角色/专家、单写者、七维能力、worktree/测试隔离、结构化消息、状态机、分层Context、Token/服务器资源门、有界持续运行、真BLOCKED和中断恢复。
- 独立性：ERP合同、安全、QA及适用DB门禁不可由多数覆盖；实现者不能批准自己的候选，Reviewer/Security/QA/Black-box默认无产品写权限。Minority Report必须通过证据/修复/决定处理；真正Black-box要求全新Agent、无源码或`.git`、合成fixture及browser/HTTP-only通道。
- ERP/AI边界：绑定Node/PostgreSQL唯一未来生产方向、Python/SQLite迁移来源和历史Sites/D1证据边界；明确研发Agent控制状态不得使用D-112五张产品`ai_governance_suggestion_*`表，也不能把Agent意见、敏感正文或产品AI建议混为研发事实。
- 路线/决策：提出D-114，状态为`PROPOSED / OWNER DECISION REQUIRED / IMPLEMENTATION NOT STARTED`；推荐Codex原生临时编排优先的R1.5 docs/test-only合成MVP，再按独立授权进入R2隔离底座和R3有界循环。R1.5与R2—R5均未开始，TASK03保持BLOCKED。
- 范围：仅新增/更新Markdown；未修改业务/测试代码、Schema/Migration、API/Service、package、版本或部署配置，未创建Runtime/Control Store/worktree/测试库，未执行holdout、模型、build、Migration、UAT/生产访问、deploy、restart或Compose动作。
- 验证：13份设计文件、102个本地链接/断链0、指定Message字段、0035/0040/0041 checksum、alpha.44、docs-only范围、敏感模式及`git diff --check`通过。AGENT-R1专项24/24且仓库IDLE/errors空；Python self-test/smoke/loopback no-backup go-live通过；断网、源码只读、1 CPU、1,280 MiB/heap 768 MiB的单Node容器`npm test`3/3与lint退出0。
- 资源/清理：起点/终态available约`2.3/2.2 GiB`、Swap`354/354 MiB`、根盘`17/17 GiB`、Load`0.17/0.17/0.16`→`2.35/1.04/0.44`；内核OOM0，四服务restart0/OOM false，临时Node容器清零。根目录Compose ps因无配置失败关闭，未读取env、启动/重启服务或执行prune；独立提交消息为本条标题，实际SHA以`git log`为准。

### AGENT-R1 - `feat: add read-only ERP agent controller` / `docs: complete read-only ERP agent controller`

- 实现：新增Python标准库无状态CLI、版本化机器Task Packet和最小运行说明；固定检查D-113、零/唯一DOING、Task/Packet一致性、Git branch/base/worktree与允许路径、源码版本及Migration编号/head/checksum/snapshot/journal，只向stdout输出确定性JSON。实现提交为`903e2108bf71a1b4488a6b9d69da0e10aae07880`。
- 失败关闭：文件读取拒绝缺失、不可读、非UTF-8、超限、symlink/hardlink；Packet拒绝重复键、未知字段、路径穿越、任务文档遗漏及检查目标重定向。Git只走固定白名单且`GIT_OPTIONAL_LOCKS=0`，失败返回稳定去敏错误；不调用shell、网络、数据库或文件写API。
- 验证：专项unittest 24/24通过；R1为唯一DOING时仓库实况连续两次`READY`、errors为空、输出逐字节一致且运行前后Git状态不变，完成后零DOING连续两次`IDLE`。既有8个历史任务的状态一致重复终态行只产生`TASK_LEDGER_DUPLICATE_ROWS`告警，不在本任务内改写；重复active/nonterminal或冲突状态仍失败关闭。
- 基线：本地Python `SELF_TEST_OK`、`SMOKE_TEST_OK`、`GO_LIVE_CHECK_OK`；go-live检查仅访问`127.0.0.1`既有开发服务/SQLite且显式`--no-backup`。控制器静态网络/数据库/写入边界、敏感信息、diff及无pycache检查通过。
- 状态：`AGENT-R1 DOING→DONE / READ_ONLY_CONTROLLER_COMPLETE / NO_RUNTIME_AUTHORITY`，当前零DOING且控制器返回`IDLE`；`PHASE4-TASK03`继续`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`，未自动启动R2—R5。
- 边界：未访问UAT/生产网页、API、SSH或数据库，未执行holdout、Migration、Node全量测试、build、Compose变更、部署、备份恢复、重启、外部AI或Git push；未修改ERP业务逻辑、Schema/Migration、package、版本或部署配置。项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交。
- 资源/清理：起点/收口available约`2.3/2.3 GiB`、Swap`354/354 MiB`、根盘可用`17/17 GiB`、Load`0.30/0.19/0.13`→`0.03/0.11/0.09`；任务窗口内核OOM匹配0，四个既有容器running/restart0/OOM false。临时fixture自动清理，无pycache、临时容器、数据库、镜像或Volume，未prune；`docker compose ps`因当前Shell未注入受保护env继续失败关闭，没有读取env补跑。

### AGENT-R1 - `docs: start read-only ERP agent controller`

- 决策：项目负责人接受D-113；接受仅确立控制面设计权威，不代表OS/容器隔离、Control Store、租约、Policy Engine、Capability Broker、Agent Runtime或R2—R5已实施。
- 调度：按`PHASE4-TASK03 DOING→BLOCKED / OWNER_PRIORITY_HOLD`、`AGENT-R1 TODO→DOING`切换唯一active task。TASK03的alpha.44/0041 source-ready、holdout待重验、release未授权和UAT alpha.42/0040边界原样保留，恢复须另获项目负责人明确指示。
- R1范围：新增[AGENT-R1任务合同](../tasks/AGENT-R1.md)，只授权无状态只读控制器、机器可读Task Packet、错误注入/恢复测试和治理文档；目标是读取本地Git/文档/package/Migration文件并向stdout生成去敏清单。
- 禁止事项：不连接UAT/生产或数据库，不运行holdout/Migration/build/deploy/restart/backup/restore，不读取真实资料、秘密、受保护Volume或用户未跟踪状态报告正文，不修改ERP业务逻辑、Schema/Migration、API、版本或部署配置。
- 起点：唯一worktree、`main@fd5bf3f7ab1d710053c88aa460614ec79d77e66b`；既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交。available约2.3 GiB、Swap354 MiB、根盘17 GiB、Load`0.30/0.19/0.13`，四容器running/restart0/OOM false。

### PM-001 - `docs: design ERP multi-agent development system`

- 设计：新增[晨亿达ERP多智能体研发系统设计](../AI_AGENT_TEAM_DESIGN.md)，不是通用Agent模板；绑定自托管Node/PostgreSQL唯一生产方向、Python/SQLite与历史Sites/D1边界、当前alpha.44/0041源码和alpha.42/0040 UAT差异、受控PO零下游及`PHASE4-TASK03`发布未授权事实。
- 角色/权限：定义24个逻辑角色，把Planning、Production、Warehouse和Quality职责分开，覆盖ERP CTO/PM、业务领域、架构/数据库/前后端、QA、安全、独立代码/DB审查、用户模拟、数据迁移、AI治理和Release/SRE；以细粒度capability、精确SHA/对象/次数/时限、独立worktree/身份和默认拒绝替代Prompt权限，UAT默认无连接，生产和真实资料当前全部拒绝。
- 流程/状态：定义G0—G10门禁、单一active task slot和单一写者、Task Packet、TASKS四态/交付阶段/工作项运行态分离、Git TASKS blob与SQLite slot的PREPARED→状态Commit→COMMITTED两阶段协议、知识权威、Bug/技术债，以及lease token/version、hard deadline、fencing、修复预算、PARKED事件唤醒、完整检查点、全局heavy锁与DONE/BLOCKED停止条件；状态分歧全局失败关闭，禁止忙循环或自动启动下一任务。
- ERP门禁：显式固定Migration不可破坏、生产数据安全、服务端权限优先、业务闭环优先和历史逻辑禁止删除；补齐Material、BOM/工艺准确状态、计划提交时不可变PR→Purchase接收→RFQ→Award→PO、Receipt→IQC→AP、Planning Handoff→Production→IPQC→Warehouse Completion、返工复检、SO→FQC→Shipment→AR和冲销链路。
- 决策/边界：提出D-113，状态为`PROPOSED / DESIGN BASELINE / IMPLEMENTATION NOT STARTED`。owner优先级按`PHASE4-TASK03 DOING→BLOCKED`、`PM-001 TODO→DOING→DONE`、`PHASE4-TASK03 BLOCKED→DOING`顺序切换，无并行DOING；控制器、Agent Runtime、OS/容器隔离和Capability Broker均未实现。TASK03产品阶段、holdout和release门禁不变；用户输入`ERP_CURRENT_STATUS_REPORT.md`保持未跟踪且不纳入提交。
- 影响：只新增/更新六份治理Markdown；未改业务/测试代码、package、Schema/Migration、API、版本或部署配置，未登录/调用UAT、读写数据库、build、deploy、restart、调用外部AI、读取真实资料或执行生产动作。
- 验证：ERP业务、权限/安全、状态机/持续循环三项独立终审均PASS。Python self-test、仓库`.venv` smoke和18889 loopback `go_live_check --no-backup`通过；既有Node 22镜像在断网、源码只读、1 CPU/1,280 MiB/heap 768 MiB、串行临时容器中完成`npm test` 3/3与lint退出0。系统Python/npm和非特权容器首次环境探测分别因缺依赖/命令和root-owned源码EACCES未启动有效测试，未安装或修改环境；有效验证随后使用既有隔离运行时完成。
- 资源/清理：起点/最终available `2.3/2.3 GiB`、Swap `354/354 MiB`、根盘`17/17 GiB`、Load `0.31/0.30/0.27`→`0.16/0.20/0.32`；内核OOM0，四服务restart0/OOM false。命名临时Node容器清零，未创建数据库/镜像/Volume或执行prune。

## 2026-08-10

### PHASE4-TASK03 - `feat: add AI suggestion evidence persistence` / `feat: add deterministic AI suggestion service` / `docs: record AI suggestion source readiness`

- 持久层：提交`8b839a64b219b91f7b83ab8ce5a0819ac2486105`新增expand-only `0041_ai_governance_suggestion_evidence.sql`、五表Drizzle Schema、snapshot/journal。Run/Suggestion/Item/Evidence/Event使用真实/复合FK、RESTRICT、kind-specific/typed-value/digest/TTL/score/version CHECK、业务唯一/部分唯一索引、`cyd.ai_governance_suggestion_service_write` INSERT门禁、五表UPDATE/DELETE拒绝及延迟完整性/版本/事件链触发器；0041 SHA-256为`676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`，0035/0040 checksum不变。
- Migration测试修正：0034/0035/0037/0039历史合同改为按自身`idx/tag`查journal entry，不再用`entries.at(-1)`错误证明旧Migration是当前head；未修改0001—0040、删除约束断言、降低数量或skip。0041负责断言idx/head 41；Schema/snapshot/journal与运行查询一致。
- 确定性服务：提交`218ef1b483cbd915c6e83013d7193e37c53a0eb1`新增独立types/errors/canonical/config/adapter/repository/service/handler并只在`selfhost-api.ts`接线。身份固定`LOCAL_DETERMINISTIC/NONE/NONE`及D-111完整rule/evaluator/config/threshold/dataset/source revision；四能力只接受唯一ACTIVE/严格身份/严格类型和证据，缺失、歧义、冲突、漂移或超限均安全`ABSTAIN`，不使用模糊名称、总分或概率confidence。
- 事务/读取：服务端按数据库时间重读batch/run/group/rows/specs/lineage和全部目标引用；canonical摘要排除随机/时间/展示字段。一个事务写run/suggestion/items/evidence/CREATED、必要SUPERSEDED、Audit和持久幂等响应；同key+摘要或run digest重放、异正文409、连续版本/CAS、故障全回滚。GET以只读同一快照重算摘要和有效性，过期/终止/group/输入/引用/合同漂移失败关闭且零业务写；正式业务表写入0。
- API/安全：新增候选POST/list/detail GET，复用`material.import.governance.run/read`及批次可见性；must-change、Origin/CSRF、Idempotency-Key、256 KiB流式上限、精确字段、request ID、no-store、稳定中文错误、去敏Audit/通用500均覆盖。没有discard/approve/accept/correct/formalize或TASK04人工审核/正式提交API。
- 验证：0041静态合同5/5、隔离Migration升级/约束7/7、Suggestion Unit/Handler9/9、隔离Service5/5、专项typecheck、0035 Migration合同5/5、0035 Governance Unit/Handler/Metadata61/61、TASK02 Evaluator17/17、`npm test`3/3通过；lint 0 error/11条既有无关warning且任务新增warning0，`git diff --check`及敏感扫描通过。隔离PostgreSQL证明原子Audit/幂等、并发单run、v2/SUPERSEDED、过期/漂移、GET零写、正式表零写和故障全回滚。
- D-111/版本边界：源码升为alpha.44/head0041；TASK02 calibration、holdout、manifest、标签、阈值和既有机器报告未修改，正式holdout未重跑且没有新正式报告。UAT镜像仍alpha.42/source revision`569aa954…a24`，UAT PostgreSQL仍0040；未登录/调用UAT、未build、Docker build、部署、运行UAT Migration、调用模型、读取凭据或启动TASK04/TASK05，`RELEASES.md`不变。
- 状态/Git：TASK03保持唯一`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`，最终判定为`PHASE4-TASK03 AI SUGGESTION/EVIDENCE SOURCE READY — HOLDOUT REVALIDATION REQUIRED / NOT BUILT / NOT DEPLOYED`。严格起点`main@0d6b5961b2ed280ca80b15678ac42665aad1b45e`、Parent`df254a6f…ac7`、public behind0/ahead195、private behind0/ahead0；三个聚焦提交完成并复核后只允许一次普通fast-forward push到`recovery-private/main`，不向public origin推送。
- 资源/清理：Node/Migration/PostgreSQL测试全部串行、断网、源码只读、1 CPU、受控heap且一次一个临时容器/数据库。起点/源码验证后available约`2.2/2.3GiB`、Swap`348/352MiB`、根盘`17/17GiB`、最终Load`0.27/0.71/0.53`；内核OOM匹配0，四服务restart0/OOM false。任务测试库、容器和目录清零，四个受保护Volume保持且未读取正文，未prune。

### PHASE4-TASK03 - `docs: define AI suggestion evidence candidate layer`

- 0035审计：逐表复核九张`material_governance_*`表及对应Handler/Service/Repository/Source Adapter/类型/兼容层和无数据库、升级、PostgreSQL测试；确认run/group/row/spec/candidate属于确定性事实，decision/event属于人工治理事实，material link属于正式交接。AI不得写入或冒充这些表，也不得旁路Material Master或Supplier Mapping权威服务。
- D-112：接受`AI Suggestion/Evidence Relational Candidate Contract`。AI只能位于已发布Normalization和0035确定性治理之后，绑定既有group/run/version/digest；四项能力固定为Classification、Attribute Extraction、Material Match、Supplier Mapping，disposition仅`SUGGEST/ABSTAIN`，不表示批准、建档、绑定、合并或正式业务事实。
- 五表蓝图：计划关系表为`ai_governance_suggestion_runs`、`ai_governance_suggestions`、`ai_governance_suggestion_items`、`ai_governance_suggestion_evidence`、`ai_governance_suggestion_events`。显式FK、kind-specific CHECK、唯一/部分唯一索引和延迟完整性约束取代任意polymorphic ID或单表无约束JSON；原始导入正文、供应商/客户敏感正文和模型正文不复制进入候选层。
- 生命周期/并发：run、suggestion、item、evidence和event均为不可变/追加事实；当前有效性由服务端按过期、终止事件、group/输入/引用版本、完整合同、D-111阈值和停用开关实时派生。TTL最多30日；`INVALIDATED/DISCARDED/SUPERSEDED`互斥追加，过期不依赖事件。`run_digest`及业务唯一约束保证同合同重放复用，变化创建新run和递增suggestion version；TASK04以后仍须独立人工决定、CAS、审计并调用既有权威服务。
- D-111继承：当前只允许`LOCAL_DETERMINISTIC/NONE/NONE`，不得伪造confidence；正确性、证据、复现和covered accuracy保持1.000000，安全/formal action/错误候选保持0，六项最低coverage保持`0.50/0.75/0.75/0.75/0.25/0.25`，ABSTAIN留在分母且零support保持undefined。
- 状态/范围：TASK01/TASK02保持DONE，TASK03为唯一`DOING / RELATIONAL_CONTRACT_ACCEPTED / IMPLEMENTATION_NOT_STARTED`，TASK04/TASK05保持TODO。下一实施阶段只计划`0041_ai_governance_suggestion_evidence.sql`，本阶段未创建。变更精确限于九份Markdown；未修改0035/0040、代码、Schema/Migration、API/UI/Service、Evaluator、数据集、机器报告、测试、package或`RELEASES.md`，未调用模型、访问UAT数据库、build、部署或重启。
- Git：严格从clean `main@df254a6f8018292708f60c712c451368484deac7`、Parent`d5f4e970f0570c7838c23e3813ee9b4deaf0e2d8`、public behind0/ahead194、private behind0/ahead0开始；以本条提交消息创建单一提交，实际SHA以`git log`为准。验证后只允许普通fast-forward push到`recovery-private/main`，不向public origin推送。
- 验证/资源：九份Markdown、61个本地链接、唯一D-112/任务标题/DOING、状态矩阵、0035/0040 checksum、无0041、`git diff --check`、全仓1,325文件/1,303文本及九文件增量敏感扫描通过。断网、源码只读、单容器、1 CPU且串行的lint为0 error/11条既有warning，`npm test`3/3、TASK02 Evaluator17/17、0035治理无数据库Unit61/61通过；未重跑正式holdout、创建PostgreSQL测试库或执行Migration。额外纯读journal/schema合同检查4/5，唯一失败为既有测试写死head35而当前合法head为40（`40 !== 35`）；其余0035结构/约束/守卫4项通过，本docs-only任务不修改测试或降低断言。验证前后available约`2.2/2.2GiB`、Swap`346/347MiB`、根盘可用`17/17GiB`、Load`0.02/0.13/0.11`→`0.81/0.75/0.38`；内核OOM匹配0，四服务restart0/OOM false。任务Node容器自动清零，四个受保护Volume保持，未prune。

### PHASE4-TASK02 - `docs: approve deterministic AI evaluation thresholds`

- D-111：新增`deterministic-ai-governance-thresholds-v1`，只绑定当前`LOCAL_DETERMINISTIC/NONE/NONE`、`bom-material-governance-v1`、`ai-governance-evaluator-v1`、`synthetic-material-governance-v1@1.0.0`和冻结source revision `d69f6dff…194ec`。通用decision exact/evidence/stable/covered accuracy要求1.000000，禁止数据/formal action/关键安全违规和错误候选要求0。
- Coverage：最低门槛批准为overall 0.500000、Classification 0.750000、Attribute record/field各0.750000、Material Match 0.250000、Supplier Mapping 0.250000；ABSTAIN继续留在分母，有样本分层exact/evidence必须1.000000且安全违规0，零support保持undefined。当前calibration/holdout逐项满足，治理层为`THRESHOLD_ASSESSMENT=PASS`。
- 历史/边界：不回写生成时为`threshold_status=UNAPPROVED / release_decision=NOT_AUTHORIZED`的机器报告，不重跑正式holdout。TASK02收口为`DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`；TASK03—TASK05仍TODO，外部AI、真实数据、候选层、试点、Migration、部署和生产切换均未授权。
- 变更范围：只更新九份Markdown；Evaluator、calibration/holdout、manifest、标签、机器报告、业务/测试代码、`package.json`、Schema、Migration和运行环境均未修改。源码仍alpha.43，UAT仍原alpha.42，PostgreSQL仍40/head0040。
- Git：严格从clean `main@d5f4e970f0570c7838c23e3813ee9b4deaf0e2d8`、Parent`d69f6dff795377109244e788c2ffee73ef6194ec`、public behind0/ahead193、private behind0/ahead0开始；以本条提交消息创建单一提交，实际SHA以`git log`为准。验证后只普通fast-forward push到`recovery-private/main`，不向public origin推送。
- 验证/资源：九份Markdown、54个本地引用、状态/阈值/报告完整性、敏感信息和`git diff --check`通过；Python self-test、smoke、临时测试库go-live及断网只读源码容器`npm test` 3/3通过，正式holdout未执行。起点/验证后available约`2.2/2.2GiB`、Swap`346/346MiB`、根盘`17/17GiB`、Load`0.38/0.18/0.21`→`0.05/0.07/0.12`；内核OOM匹配0，四服务restart0/OOM false。临时Python目录/Node容器自动清理，四个受保护Volume存在且未读取正文，未prune。

### PHASE4-TASK02 - `feat: add offline AI governance evaluator` / `docs: record AI governance baseline metrics`

- 数据集：新增`synthetic-material-governance-v1@1.0.0`，calibration/holdout各32条、四项能力每split各8条，覆盖RES/CAP/IND/IC/CON/OSC及MECH/OTHER/UNKNOWN放弃场景；文件SHA分别为`d2512719…ed95`、`73e3d843…bde3`，dataset digest为`4bde669d…4adb`。严格schema、manifest、全局ID/顺序/统计/摘要、未知字段、断裂引用、非合成身份、禁止数据、路径和symlink均失败关闭。
- 工具：在独立`tools/ai-governance-evaluation/`实现canonical JSON、四项只读确定性适配器、比率/分类/属性/top-k/错误候选/abstention/coverage/分层/安全/复现指标、固定报告schema及受控CLI；provider/model/prompt/rule/evaluator固定为`LOCAL_DETERMINISTIC/NONE/NONE/bom-material-governance-v1/ai-governance-evaluator-v1`。运行时app不导入工具或评估集，不新增依赖、API、页面、Worker、Schema或Migration。
- 冻结测量：功能提交`d69f6dff795377109244e788c2ffee73ef6194ec`严格Parent`432551b1c8dbf9213954d57a77f0b022c843227e`。提交后未修改工具/数据/标签/规则/package/测试，只执行一次正式all-splits测量；calibration与holdout均32/32 decision exact、证据32/32、稳定复现32/32、关键安全违规0，coverage分别18/32与19/32，失败sample_id为空。报告SHA`e2ed87e6…8a5e`、稳定result digest`f1b5b6b9…ac316`。
- 阈值：报告明确为`dataset_integrity=PASS / critical_safety_gate=PASS / accuracy_measurement=MEASURED / threshold_status=UNAPPROVED / release_decision=NOT_AUTHORIZED`。64条合成集结果不等于production ready；准确率和最低coverage仍等待项目负责人决定，不创建D-111，不启动TASK03。
- 版本/运行面：源码候选升至`0.1.0-alpha.43`，运行UAT继续alpha.42原Image、PostgreSQL继续40/head0040；未调用AI/外部服务、未使用真实数据、未连接数据库、未读取Volume正文、未build、部署、重启或修改既有治理规则。
- 验证：专项17/17、专项typecheck、治理回归61/61、`npm test`3/3通过；lint 0 error/11条既有warning且任务新增warning0，`git diff --check`、去敏/凭据/路径/运行时边界扫描通过。所有Node操作均断网、只读源码、1 CPU、受限内存、单容器串行运行。

### PHASE4-TASK01 - `docs: define AI governance approval boundaries`

- 决策/治理：新增D-110与《AI治理评估与审批边界V1》，固定AI只产生可丢弃建议和逐字段证据；确定性冲突及既有服务端权限、事务、CAS、幂等、审核、审计优先，异常失败关闭。采购、工程、品质和主数据管理员继续承担来源、规格、质量与最终建档/合并责任，AI不是审批人。
- 外部模型：默认禁用；本任务不选择供应商、模型或地域，不创建/读取Key，不发送真实供应商/客户/生产数据。未来准入必须另行完成数据分类、去标识化、保留/训练/删除条款、地域/跨境、合同/分包商和凭据生命周期审批。
- 评估合同：版本化不可变去敏数据集、整体摘要、固定holdout、场景分层、四类能力分别评估；最低指标包含precision/recall/F1、exact match、top-k recall、错误候选、abstention/coverage、复现率和安全违规。直接正式写入、绕过审核等关键安全违规允许值为0；准确率阈值留待TASK02用已标注样本测量并由项目负责人批准。
- 路线/状态：Phase 4固定为TASK01治理基线、TASK02评估集/基线/Evaluator、TASK03 Suggestion/Evidence候选层、TASK04人工审核API/UI、TASK05非生产试点门禁/漂移/停用/回退。TASK01为DONE，TASK02—TASK05为TODO且未自动开始；最终判定`PHASE4-TASK01 AI GOVERNANCE BASELINE ACCEPTED — IMPLEMENTATION NOT STARTED`。
- 影响边界：只更新九份Markdown；没有模型调用、API、页面、业务代码、测试代码、`package.json`、Dockerfile、Schema、Migration、部署配置或业务数据变化。未登录UAT、调用业务API、查询/写入数据库、运行Migration/build/deploy/restart、访问Volume或执行GHCR动作；`RELEASES.md`不变。
- 验证/资源：九份目标文档53个本地引用、D-110/任务H1/TASK01—TASK05台账行唯一、DOING为0、精确路径、敏感信息和`git diff --check`通过。断网、源码只读、1 CPU/受限内存容器中的lint为0 error/11条既有warning，只读采购履约UI合同6/6。验证前后available约`2.2/2.2 GiB`、Swap`338/343 MiB`、根盘`17/17 GiB`、Load`0.01/0.12/0.20`→`0.14/0.14/0.19`；内核OOM0、四服务restart0/OOM false、任务Node容器清零，四个受保护Volume保持。

### SELFHOST-OPS-RECOVERY-FOUNDATION-39 - `docs: close recovery foundation scope`

- 项目负责人证明已通过GitHub网页完成“`GHCR ONE-TIME PAT REVOKED`”；本项目只记录该用户证明，没有读取、恢复、测试或验证PAT正文、scope或远端认证状态。
- TASK39按`DONE / OWNER-CLOSED AFTER GIT AND IMAGE ANCHORS / DATA ANCHOR DEFERRED`行政收口：D-108 private Git与D-109 private GHCR镜像锚点已建立并验证；PostgreSQL dump及uploads、attachments、backup-status异机锚点未建立，并由项目负责人主动延期。
- 数据锚点延期后单机数据恢复风险继续`OPEN`；当前仍为alpha.42/0040非生产UAT、`NO UAT RECEIPT`且非production ready，不能把行政关闭写成三锚点全部完成。
- 本收口没有执行备份、dump、Volume读取、恢复演练、上传、清理、UAT登录、业务API、数据库业务查询/写入、Migration、build、部署或重启，也没有删除当前/回退/被拒镜像、容器或受保护Volume。
- 严格起点为唯一worktree、clean `main@19b770c0219d2592b6b94aa2a22f0af8465db88b`、Parent `c96f9bfc912cb2a5dc6f4a3ad47bb51260847dbd`；public `origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`且behind0/ahead189，private main等于起点且behind0/ahead0。收口使用独立提交，最终与PHASE4-TASK01提交一并只普通推送到private main，public不推送。
- 验证：八份Markdown的48个本地引用、TASK39/D-109/PHASE4-TASK01当前行唯一性、当前DOING为0、精确路径、`git diff --check`通过；断网、源码只读、1 CPU/受限内存的lint为0 error/0 warning，既有只读UI合同6/6。仓库凭据脚本因Node slim无Git未启动，等价本机只读扫描1,304个仓库文件/1,282个文本文件通过。起点/验证后资源约为available `2.2/2.2 GiB`、Swap `337/338 MiB`、根盘`17/17 GiB`、Load `0.14/0.13/0.10`→`0.84/0.77/0.37`；内核OOM0、四服务restart0/OOM false，任务容器清零。

### SELFHOST-OPS-RECOVERY-FOUNDATION-39 - `docs: record private image recovery anchor`

- 授权/准入：项目负责人明确给出`GHCR CREDENTIAL READY`。独立root-only配置确认临时classic PAT身份为`3443176848`、normalized scope只有`write:packages`；认证GitHub API和registry分别证明package及精确tag尚不存在，PAT正文未进入聊天、日志、Git、remote URL、命令参数或文档。
- 唯一push：只把已验收且仍由运行Web引用的Image ID标记为`ghcr.io/3443176848/chenyida-erp-web:0.1.0-alpha.42-fix38-569aa954d764309e239d1f6c174e582596d33a24`，只执行一次精确push且成功，没有重试、第二tag、第二registry、`latest`、alpha.41或被拒候选。
- digest闭合：push返回、认证registry顶层manifest与唯一tag的GitHub package version digest三方均为`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。OCI index的linux/amd64 child为`sha256:36fd3118…482f`、attestation为`sha256:f4a82ba3…621b`、config为`sha256:72452032…32c7`，9个compressed layer digest与D-109预检逐项一致。
- 私有/恢复验证：package为`PRIVATE`且没有repository association；三个预期OCI对象中只有顶层index携带唯一计划tag，没有`latest`。只执行一次按registry digest pull，回拉Image ID、平台、config、9层与运行合同全部匹配且未run/deploy/replace；独立空Docker配置的匿名查询被`HTTP_401_AUTHENTICATION_REQUIRED`拒绝。
- 凭据/运行保护：验证后精确`docker logout ghcr.io`并逐项清理`/run/cyd-ghcr-auth`、PAT、Docker config、临时GitHub API配置及匿名配置目录；默认GitHub身份和默认Docker配置未改。四服务容器/Image身份、health、restart0/OOM false和四个受保护Volume不变；没有UAT登录/API、数据库读写、Migration、build、备份恢复、部署或重启。
- 文档验证：变更范围精确为六份治理Markdown，48个本地链接、D-109/TASK39/唯一DOING、`git diff --check`通过；既有Node镜像在断网、源码只读、1 CPU、1,280 MiB、串行条件下完成lint 0 error/0 warning和UI contract 6/6，两个临时容器清零且没有安装依赖或连接数据库。
- 状态/边界：六份治理Markdown把阶段更新为`ALPHA.42 PRIVATE GHCR IMAGE ANCHOR ESTABLISHED — DATA RECOVERY ANCHOR PENDING`。任务继续`DOING`；PostgreSQL dump与uploads、attachments、backup-status文件卷异机锚点未开始，不构成production ready。项目负责人仍须在GitHub网站手工撤销本次一次性classic PAT。

### SELFHOST-OPS-RECOVERY-FOUNDATION-39 - `docs: prepare private image recovery anchor`

- 阶段纠偏：实际Git/GitHub状态证明前一治理提交`e1eff533eb7cb38d169f266bdf3a97b0d3dc7e71`已经普通推送到`recovery-private/main`，private仓库为`PRIVATE / ADMIN / main`且behind0/ahead0；D-108、总控、台账和状态统一改为`GIT PRIVATE RECOVERY ANCHOR ESTABLISHED`。公开`origin/main=39946f6b…5c0`、fetch/push URL、upstream、remote HEAD和public visibility保持不变。
- 镜像审计：只读核验运行Web确实引用alpha.42完整Image ID`sha256:e7761e2c…f94964`，version/revision/task labels、`linux/amd64`、非root用户、Entrypoint/Cmd/port、88,679,975 bytes及最小runtime package全部匹配。config digest、linux/amd64 manifest digest、9层压缩blob/rootfs diff ID和SLSA provenance均逐项校验。
- 一次性archive：唯一`mktemp`目录中只执行一次`docker image save`；archive为88,699,904 bytes、SHA-256`d7c78654…bea2`，15/15 OCI blob和全部layer digest匹配。该同机archive只用于审计，不是异机恢复锚点；审计后目录、archive、解包层、报告和扫描进程均精确清零。
- 出站扫描：config/Env/history/OCI metadata及8,112个regular file/metadata record、266,026,785 bytes完成多规则扫描，结果`CONFIRMED_SECRET=0 / POSSIBLE_SECRET=0 / TEST_FIXTURE=10 / DOCUMENTATION_PLACEHOLDER=1 / FALSE_POSITIVE=566`。10个fixture以GnuTLS ELF内`crypto-selftests-pk.c`边界和`gnutls_pk_self_test`符号证明为算法自检向量；路径穿越、非法/逃逸link、层内重复路径和world-writable regular file均0。空npm配置、Debian公共keyring/安装日志及source map/TypeScript/test运行残留已列为后续镜像最小化风险，没有业务原始文件或凭据。
- D-109：候选private目标固定为`ghcr.io/3443176848/chenyida-erp-web`，唯一计划tag为`0.1.0-alpha.42-fix38-569aa954d764309e239d1f6c174e582596d33a24`；禁止latest、覆盖未知package/tag、上传回退或被拒镜像。当前`TARGET EXISTENCE UNRESOLVED — CREDENTIAL REQUIRED`；后续只接受任务外安全准备的最小`write:packages` classic PAT，认证后复核private visibility，push后按实际registry digest回拉验证。
- 门禁/边界：仅六份Markdown，`RELEASES.md`不变；diff、48个本地链接、标题/唯一`DOING`、敏感信息通过。既有Node镜像在断网、源码只读、1 CPU、1,280 MiB、串行条件下完成lint 0 error/0 warning和UI contract 6/6，两个临时容器清零。独立提交增量扫描为0 confirmed/0 possible后只把精确SHA普通推到private main。本阶段没有docker login/tag/push、build、UAT登录/API、数据库读写、Migration、备份恢复、部署或重启；结论为`ALPHA.42 IMAGE OUTBOUND REVIEW PASSED — GHCR CREDENTIAL REQUIRED / NO IMAGE PUSH`，任务继续`DOING`且PostgreSQL/文件卷异机锚点未开始。

### SELFHOST-OPS-RECOVERY-FOUNDATION-39 - `docs: define alpha42 recovery foundation`

- 决策/范围：新增D-108和任务文档，把alpha.42恢复基础拆为Git、容器镜像、PostgreSQL dump+文件卷三个独立锚点；当前只执行Git private remote阶段并保持任务`DOING`。恢复remote不是release，不修改`RELEASES.md`，也不授权UAT、业务写、Migration、build、Compose、数据库/Volume操作或生产动作。
- 出站门禁：既有186个提交为纯fast-forward且秘密扫描无confirmed/possible secret，但包含内部文档、UAT标识和服务器/网络/容器/备份拓扑，继续禁止推到public `3443176848/chenyida`。公开`origin`的HTTPS fetch、SSH push、upstream和`origin/main=39946f6b…5c0`必须保持。
- GitHub配置：按官方DNF4流程安装`gh 2.97.0`，两个官方签名主指纹核对通过；项目负责人亲自在设备页授权，活动账号精确为`3443176848`。认证正文未读取，root配置元数据为`root:root / 0600`。
- 私有仓库：认证后先确认目标不存在，再创建空`3443176848/chenyida-erp-recovery-private`；元数据为`PRIVATE / ADMIN / non-fork / size 0`，branch/tag/release均为0。只允许增量复扫后的精确治理提交普通推到private `main`，不force、tags、PR或改写历史。
- 验证：47个本地Markdown链接、任务/D-108唯一性、唯一`DOING`、精确六文件范围、`RELEASES.md`未修改及`git diff --check`通过；断网、源码只读、1 CPU容器中的lint为0 error/11条既有warning，纯本地读文件的采购履约UI contract为6/6。
- 运行保护：本阶段不登录UAT、不调用API、不触碰数据库、镜像或备份，不运行Migration/build/deploy/restart。alpha.42/0040、NO UAT RECEIPT、四服务restart0/OOM false和四个受保护Volume沿用只读核验基线；镜像与数据库/文件卷的异机风险仍开放。

## 2026-08-09

### SELFHOST-UAT-FIX-38 - `fix: validate receipt evidence date before confirmation` / `fix: expose runtime version in health` / `build: preserve runtime package version` / `docs: record FIX38 rebuild requirement` / `ops: build warehouse receipt date guard candidate` / `ops: deploy warehouse receipt date guard`

#### Web-only部署与零业务写复验 — `ops: deploy warehouse receipt date guard`

- 部署：从clean`main@fc551c6571b57593a3232a14617935b3e3c3171f`、behind0/ahead185及旧Web`1e539434…`/`sha256:0cf98937…d5f19`起步；建立精确alpha.41回退tag，把通过候选标记latest，仅一次以`COMPOSE_PARALLEL_LIMIT=1`和`--no-deps --no-build --pull never --force-recreate web`替换Web。新容器`f0066fe6…a35f`实际运行`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`；Worker/PostgreSQL/Caddy完整ID不变，未重建、未重启或运行Migration。
- 运行门禁：镜像package及OCI version/revision/task再次匹配alpha.42/`569aa954…d33a24`/FIX38；本地和公开health均HTTP200并返回`version=0.1.0-alpha.42`，Caddy的HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、no-store和request ID通过。匿名warehouse页面/API受保护标记0、API401；Web日志敏感信息/SQL堆栈命中0。
- 唯一黑盒：一个隔离Chromium和Profile、warehouse恰好一次login/logout；从根工作台实际初始“管理员”分组经可见“仓库”及“仓库待入库”导航进入页面。`2099-12-31`随preview GET发送并得到HTTP422、`RECEIPT_EVIDENCE_FUTURE_DATE`、指定中文提示和一致request ID，确认窗/最终按钮不可达且草稿保留。合法日期只取PostgreSQL只读事务的`2026-08-09`，4次preview200/4次确认窗只投影NORMAL实际结果；返回修改、关闭、ESC、背景和390×844键盘/无溢出均通过并保留草稿。
- 请求/数据：login/logout POST `1/1`、未来422 `1`、合法200 `4`、Dialog `4`，Business POST/PUT/PATCH/DELETE、Receipt POST及UAT收货过账均0。退出后Back/Forward/Refresh及直接匿名路由不恢复受保护内容；warehouse Session`0→1→0`，成功LOGIN/LOGOUT Audit由`9/8→10/9`。前后只读事务均ROLLBACK，migration/业务指纹`822e0e5b…a2b19`/`89915aae…dd3b`不变，PO/Line/Plan/queue`1/4/4/4`、已收0及Receipt全部下游0。
- 回滚/清理：latest最终为alpha.42；旧alpha.41回退tag指向`sha256:0cf98937…d5f19`，被拒`sha256:81126136…278e`仍为`REJECTED — DO NOT DEPLOY`，无需回滚。518文件/13MiB浏览器Profile/模块/runner和任务容器清零，四卷保留，未prune。资源约从1.9GiB available/312MiB Swap/17GiB/Load`0.06/0.20/0.25`到2.0GiB/320MiB/17GiB/`0.05/0.16/0.16`，Docker/内核OOM及restart event0，四服务restart0/OOM false。
- Git/风险：只更新FIX38任务/完成报告与六份项目状态文档，以本小节标题所列ops提交收口；未push Git或镜像。未新增备份，FIX37正式dump保留但异机复制仍未完成；最终仅为`SELFHOST-UAT-FIX-38 DEPLOYED AND REVALIDATED — NO UAT RECEIPT`和`NON-PRODUCTION UAT ONLY / NOT PRODUCTION READY`。

#### alpha.42版本化候选镜像与隔离烟测

- 构建/镜像：从唯一clean `main@569aa954d764309e239d1f6c174e582596d33a24`的`HEAD:chenyida_erp_site` Git archive只执行一次Web target build；tree`19384bbc10f15f382d6ac70040827125e839653f`，Dockerfile/`.dockerignore` SHA分别为`3131dd62…e49`/`53fce31d…a69`，敏感context路径命中0。新tag`chenyida-erp-parallel-web:0.1.0-alpha.42-fix38-569aa95`，完整Image ID及本地内容digest均为`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`，linux/amd64、88,679,975 bytes；没有latest、远端digest或镜像push。
- 版本门禁：OCI version/revision/task精确为`0.1.0-alpha.42`/`569aa954…d33a24`/`SELFHOST-UAT-FIX-38`；非root node、`node server.js`、9 layers及无自动Migration保持。network-none只读检查确认`/app/package.json`恰好含`name/version/private/type`且version为alpha.42，三个FIX38标记齐全；scripts、devDependencies、registry、Token、数据库URL、敏感history及ARG/ENV命中0。
- 隔离烟测：唯一最小权限库/角色显式隔离于UAT；运行Worker镜像仅装载0001—0034后删除，当前Git归档的40个既有migration逐SHA核对并以非root只读方式补齐0035—0040，最终40/head0040、227张public表。候选使用restart=no、0.75 CPU、512/768 MiB、只读rootfs、内部网络及临时bind启动，health为HTTP200、原字段加`version=0.1.0-alpha.42`、no-store/request ID；根页/warehouse页及匿名Session正常且不泄漏PO/Supplier/Material/审计信息。仅调用health、根、warehouse和匿名Session，登录、Receipt preview及业务POST均为0，隔离库Session/Receipt及全部下游0。
- 安全头/清理：Standalone不含HSTS、X-Frame-Options、nosniff、Referrer-Policy或Permissions-Policy符合Caddy边缘责任，待后续获授权部署后从公开入口验收。按候选容器→测试库→测试角色→临时网络→任务目录清理并在删除前覆盖随机秘密，五类临时资源均为0；候选、alpha.41、已拒镜像、build cache和受保护Volume保留，未prune。
- UAT/部署门禁：Web/Worker/PostgreSQL/Caddy完整容器身份、镜像、restart0/OOM false和受保护Volume不变；运行Web/latest仍为alpha.41的`sha256:0cf98937…d5f19`。migration/业务指纹在隔离初始化前后及清理后逐字节一致：40/head0040、Session0、PO/Line/Plan/queue`1/4/4/4`、已收0及Receipt全部下游0。未替换或重启UAT、未登录、未调用UAT Receipt preview/业务POST、未运行UAT Migration；通过候选只有另获授权后才能精确Image ID Web-only部署并以旧完整Image ID回滚。
- 风险/状态：已拒镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`继续`REJECTED — DO NOT DEPLOY`且无latest/容器。最新正式dump仍为2,298,941 bytes、SHA`28e07b9d…0868`，异机复制未完成；`origin/main`仍落后本地184个提交，文档提交后预期185，源码与候选镜像只在本机且未push。资源从available约2.2GiB/Swap311MiB/根盘17GiB/Load`0.23/0.29/0.27`到约1.9GiB/313MiB/17GiB/`0.52/0.31/0.28`，60秒Swap增量0、内核OOM0。FIX38保持`DOING / IMAGE_READY / DEPLOYMENT_NOT_AUTHORIZED`，结论仅为`FIX38 ALPHA.42 VERSIONED IMAGE CANDIDATE READY — NOT DEPLOYED`。

#### 运行时版本合同补救

- 门禁原因：上一次候选`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`的`/app/package.json`只有`private/type`且旧health无version，OCI label不能代替应用证据；该镜像与唯一FIX38 tag原样保留为`REJECTED — DO NOT DEPLOY`，没有latest或容器。运行Web/latest继续是alpha.41的`sha256:0cf98937…d5f19`。
- 应用/health：新增严格的运行时版本模块，以`process.cwd()/package.json`及SemVer验证为唯一来源，成功值只缓存一次；不可读、损坏、缺失或非法version失败关闭，不回退unknown/latest/development。health保留`ok/database/storage/worker/time`与数据库检查，新增version并继续no-store/request ID；失败响应非2xx且不泄漏路径、堆栈、环境或原始metadata。提交`13f72b5f7aa51905af597733356420cc7b017b74`。
- Docker：builder从源码package机械验证并确定性生成仅含`name/version/private/type`的JSON，Web final在standalone之后复制为`/app/package.json`；无alpha.42硬编码、完整依赖或环境变量替代。基础镜像、node用户、端口、`node server.js`、Worker、Compose、Caddy及Migration行为不变。提交`61f0b56788ef68b9b7aa6d34583d2ddc3bde3f66`。
- 测试：按无网络、源码只读、单容器/1 CPU/Node heap 1024 MiB顺序通过版本4/4、health3/3、Dockerfile4/4、FIX38 Unit17/17、UI6/6、专项typecheck、lint 0 error/0 warning及npm3/3。Docker合同首轮仅因测试fixture的Worker历史快照错误为3/4，核对HEAD后只修正fixture并重跑4/4；typecheck首次无诊断但清理发现compile cache，精确删除、禁用cache后原命令重跑通过且临时资源清零。
- 边界/历史状态：该源码阶段当时只负责health/version/Cache-Control/匿名保护/无泄漏合同，HSTS/X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy继续归Caddy；当时未build、Docker build、启动候选、Migration、部署、重启、登录UAT、Receipt preview、业务POST、备份、恢复或push，结论为`SELFHOST-UAT-FIX-38 VERSION CONTRACT SOURCE READY — REBUILD REQUIRED`。当前状态已由上方版本化候选镜像阶段接续。
- 运行保护：最终只读事务并ROLLBACK确认40/head0040、warehouse active/version5/Session0、PO/Line/Plan/queue`1/4/4/4`、已收0及Receipt/Evidence/Lot/IQC/Ledger/Purchase Source/AP/Payment/Work Order/生产全0。起点/测试后available约2.2/2.2GiB、Swap约300/311MiB、根盘17GiB，测试后Load`1.18/0.87/0.45`；四服务restart0/OOM false、内核OOM0，无任务临时资源。

#### 收货预检源码阶段

- 决策/缺陷：D-107固定服务端日期、实际inspection mode投影和返回修改语义。实施前`openPreview`未传`evidence_document_date`、preview不校验且`confirmationReady`只检查非空，使未来日期可进入确认窗；最终Receipt POST和0040一直独立安全，主UAT没有因此产生写入。
- 服务端：新增共享严格日历解析，Handler把证据日期传给preview Service；既有`REPEATABLE READ READ ONLY`事务以`transaction_timestamp() at time zone 'Asia/Shanghai'`取得同事务业务日期。未来日期稳定返回HTTP422、`RECEIPT_EVIDENCE_FUTURE_DATE`、指定中文提示和request_id；非法格式/日期返回`RECEIPT_EVIDENCE_DATE_INVALID`。最终POST复用同一规则但仍在自己的写事务独立重验，0040未修改。
- UI/模式：预览URL只安全编码quantity和非空证据日期；422在对应编辑卡片显示code/message/request_id，清除确认、loading、submitted、error、提交锁及幂等状态，modal与最终按钮不可达。确认只接受与服务端已验证值一致且不晚于`server_date_shanghai`的日期，不使用浏览器当前时间。底部改为“返回修改”，关闭/ESC/背景复用相同零POST路径；不`form.reset()`或清空本行，未发送表单值保留。NORMAL只显示普通Receipt/`RECEIPT`/available结果，实际IQC才显示RML/FROZEN/`IQC_RECEIPT`/UNFREEZE。
- 测试：日期最小1/1、专项Unit17/17、UI contract最终6/6、隔离Fulfillment PostgreSQL/API handler 10/10、0040数据库防线3/3、专项目typecheck、lint 0 error/11条既有warning及`npm test`3/3通过。两个唯一隔离测试库在测试后精确删除；测试库内部装载/重置既有0001—0040夹具，不是UAT Migration。现有Compose smoke会命中运行UAT、历史`npm run test:api`针对D1，均不适用于本源码阶段且未运行。
- 版本/范围：源码候选升为`0.1.0-alpha.42`并同步lockfile；功能提交`401e16b04e3b8cb70ddfd3508661353ff758fdec`。没有Schema/Migration、依赖、部署配置、历史Sites/D1或Python/SQLite变化；未build、Docker build、deploy、restart、登录UAT、调用UAT Receipt preview、发送UAT业务POST、备份、恢复或push。
- UAT/资源：运行UAT仍为alpha.41/0040/Web`sha256:0cf98937…d5f19`；最终只读事务复核PO/Line/Plan/queue `1/4/4/4`、已收0、warehouse Session0及Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/生产全0。起点/文档提交前available约2.2/2.2GiB、Swap290/294MiB（1GiB）、根盘17GiB，最终Load`0.14/0.23/0.28`；四服务restart0/OOM false、内核OOM0，任务临时资源清零。该收货预检源码阶段当时保持`DOING / SOURCE_READY`且只允许`SOURCE READY — NOT BUILT / NOT DEPLOYED`；当前状态已由上方运行时版本合同补救阶段接续。

## 2026-08-08

### SELFHOST-UAT-FIX-37 - `feat: safeguard warehouse receipt readiness` / `fix: project receipt accounting by inspection mode` / `ops: deploy warehouse receipt readiness safeguards`

- Schema/版本：现有Receipt/Allocation模型没有可关系化保存送货单、证据日期、提前到货理由/显式确认及Plan/queue CAS谱系的位置，故版本升为`0.1.0-alpha.41`并唯一新增`0040_warehouse_receipt_readiness.sql`。新`warehouse_receipt_evidence`不可变绑定Receipt/Line/Allocation/PO/Line/Plan/queue，保存送货凭证、Supplier批次适用值、证据日期、提前判断/原因/确认、MAIN、预期版本、actor/request及服务端时间；触发器检查完整谱系与事务推进。0039及更早未修改。
- DTO/API：新增warehouse专用`WAREHOUSE_RECEIPT_READINESS_V1`及`GET /api/procurement/delivery-plans/:id/receipt-preview`，最小投影PO商务/创建SUCCESS凭证、四Line/Award Line/Material、Plan/queue版本状态和Receipt/Lot/IQC/Ledger/AP/付款/生产计数。跨数据域403；warehouse不获`system.audit.read`，不返回请求正文、Cookie、Session、敏感Header或审计正文。
- UI/两阶段：收货入口改为“核对收货”权威GET后才显示确认窗口；数量、说明及证据字段默认空，取消默认焦点。取消、关闭、ESC、背景关闭均零业务POST；最终按钮只在证据完整时启用，点击同步禁用且不自动重试。页面明确当前是实际物理收货，不是通知/在途登记，并展示服务端时间规则、计划日期、提前判断、目标MAIN、本次数量/剩余量、经办账号及下游边界。
- 服务端门禁：拒绝客户端实际收货时间和未来证据日期；提前到货必须有可审计送货凭证、原因及显式确认，否则返回稳定`EARLY_ARRIVAL_EVIDENCE_REQUIRED`中文错误。最终事务锁定并重验PO/Line/Plan/queue、剩余量、四类CAS、权限、CSRF、Origin、限流及正文幂等；创建Receipt/Allocation/Evidence、状态推进、Lot/IQC/Ledger和Audit全在同一事务，故障零半记录。
- IQC/会计：实际语义按Material inventory/inspection mode投影。IQC物料生成内部RML冻结Lot和`IQC_RECEIPT` Ledger，可用量保持0并进入quality责任队列；NORMAL物料不生成RML/IQC冻结或IQC队列，生成普通`RECEIPT` Ledger并立即重算可用量。warehouse的IQC写接口为403，quality保持既有权限；warehouse首页不再把供应商来料IQC列为获准业务。不合格、退货、让步接收均是独立操作，收货不自动创建AP、Payment、Work Order或生产记录。
- 测试：Unit/UI/Dashboard/Procurement组合22/22；Identity19、Mapping11、Sourcing36、Fulfillment21回归通过。完整隔离Fulfillment PostgreSQL 9/9及NORMAL/IQC专项2/2覆盖空/0/负/超量、未来日期、提前缺证据/完整成功、四类CAS、幂等重放/冲突、并发单胜、CSRF/Origin/角色/限流、故障回滚、IQC隔离和实际Ledger语义。0040空库/0039升级/重放/约束/回滚3/3；typecheck、production Docker build、Origin回归、敏感扫描及diff检查通过。
- 备份/恢复/部署：正式dump`warehouse-receipt-readiness-fix37-predeploy-20260808T120636Z.dump`为root:root0600、2,298,941 bytes、SHA-256`28e07b9dc04e686d5077fe9f68968ffb1a4253979d64b80317307f8543bc0868`，list3,359行。第二新库恢复39/head0039、核对业务后升级0040并重放无变化，随后删除；主库受控应用0040。仅把Web从`sha256:664e0ac6…a4ec89`替换为`sha256:0cf98937…b8a0d5f19`，PostgreSQL/Worker/Caddy和四卷未替换，旧Web回退tag保留。
- 主UAT/保护：第一次只读UAT因页面把NORMAL物料误述为IQC收货而安全中止，未发业务POST并安全退出；随后按实际服务端mode修正文案、重建并Web-only替换。最终只登录`uat_20260729_warehouse`，桌面四种取消与390×844取消、跨域403、back/forward/refresh及退出通过；未填写虚假证据，`business_post=0`、Session0。业务指纹前后`48e2f2138541aea589f3e6a2a5b9c9b312036786ff13f27bb3baf2722c4bd013`一致，PO/Line/Plan/queue保持`1/4/4/4`且全部收货/库存/财务/生产下游0。
- Git/资源：功能提交`a6fc8b33af73d5ffd0da03566ef1f28d4207722b`，语义修正提交`20a9123741862d81ac18af9e6bdee896674fe95c`，部署/验收/文档由独立ops提交收口；未push/PR或改写历史。起点/收口available约`2.0/2.1GiB`、Swap`273/285MiB`、根盘17GiB，最终Load`0.45/0.37/0.44`；OOM0、四服务restart0/OOM false。临时库/验证容器删除，Playwright目录移入可恢复Trash，未prune。最终`WAREHOUSE RECEIPT READINESS FIXED — UAT RECEIPT NOT POSTED`。

### SELFHOST-UAT-FIX-36 - `feat: add restricted PO history traceability` / `ops: deploy PO history traceability fix`

- 读模型/API：新增`GET /api/procurement/purchase-orders/:id/history`和`PO_HISTORY_TRACEABILITY_V1`。先沿PO→Award→RFQ→PRQ复用purchase数据域判断，再在单一`REPEATABLE READ READ ONLY`快照读取PO聚合、Project→MRP→PRQ→RFQ→Comparison→Quote→Award→PO、四条Line稳定引用、四条Plan/queue及下游计数；缺失、重复或漂移时失败关闭。
- 凭证/权限：DTO只公开目标PO精确CREATED Event、成功`SOURCING_AWARD_CONVERTED` Audit、HTTP201与两项digest，不返回请求/响应正文、Cookie、Session或敏感Header，也不授予purchase `system.audit.read`。唯一未绑定失败Audit只按同actor/action受限时间窗且业务记录0单独显示；422明确来自旧错误合同投影，不与成功PO合并。
- UI/语义：新增可刷新、可历史重开的独立PO详情URL；桌面显示谱系/Line/Plan/凭证，390×844使用摘要、Line和Plan/queue卡及折叠凭证。状态有代码和中文，稳定ID/UUID/digest/request_id可换行复制；无PO/Line/Plan/queue编辑或到货、收货、IQC、库存、AP、生产按钮。页面明确OPEN/PENDING/OPEN_PENDING均不代表下游动作。
- 数据域：purchase跨项目/跨数据域详情返回403，订单、queue及应付列表同步按现有PRQ数据域过滤，避免由列表泄漏其他PO/Supplier。非GET历史路由返回405且不写失败Audit。
- D-105边界：产品不硬编码目标PO或D-105，不显示“授权已验证”。PO结构完整与原始写入授权不可证明保持并存；D-105只在治理/验收报告说明前向授权且不追溯授权原始写入。
- 测试：专项Unit/UI9、Fulfillment PG6及Award41/PO1偏移专项、Sourcing/Binding PG20、0019/0038/0039升级`3+5+6`、安全/Identity/Origin、两个typecheck、lint、npm3、Python三项、credentials功能1287/最终文档1288及Chromium1全部通过。Chromium覆盖4 Line/4 Plan/4 queue、桌面/390×844、刷新/重开/服务重启、下游0及Session0；首次因测试遗留390px viewport失败，补齐桌面前置后原断言重跑通过。
- 主库保护/Schema：只读保护得到状态指纹`721f25f875e4e3af7cc8401f9bff9dadcc959092047844d446461999afa60594`和历史指纹`d11b46bc41f59bcc7b10a19041940664c37c0753c65160a17551322652b14ae7`，business POST0、下游0且前后相同。实际成功UUID为`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`；任务原文漏末尾`d`，未改库。无0040，0039 SHA仍`3cbf5738…e3f37`。
- 备份/恢复：正式root:root0600 custom dump为2,297,975 bytes、SHA-256`0e6f8215512eb28c1dc72d2dec84b1d645a173bd9cbf93127adf1a2205df38f1`；`pg_restore --list`3,359行/3,348 TOC，第二新库单事务恢复39/head0039、226表、PO/Line/Plan/queue`1/4/4/4`及下游0，主/恢复指纹一致后精确删除恢复库。
- Web-only部署：Web`sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664→sha256:664e0ac6bd289251f289a8785ac05d955470064a3f921c3ae834f79665a4ec89`，旧Web精确回退tag保留；只recreate Web，没有Migration或PostgreSQL/Worker/Caddy/四卷替换，HTTPS及60秒health`7/7`。
- 主UAT/收口：只登录purchase，桌面1440和390×844核对聚合、谱系、四Line、四Plan/queue、凭证和下游0，刷新/历史重开/退出通过；`business_post=0`、Session0，浏览器指纹`ae02a432…cc68`与主库状态/历史指纹前后不变。功能提交`bdb4fd07e76e405f418833aeaf5b0c9c4b5e5ae7`，部署验收独立提交；最终`PO HISTORY TRACEABILITY FIXED — UAT DOWNSTREAM UNCHANGED`。

### SELFHOST-UAT-DECISION-35 - `docs: retain unauthorized UAT purchase order under control`

- 决策：新增D-105 `Controlled retention of unauthorized UAT PO-00000001`。本书面决定及独立提交是控制事件，只提供前向授权并明确“不追溯性授权”；现有PO继续分类为未经事前授权但结构完整的UAT写入，即数据结构完整但来源授权不可证明。
- 事实：受控对象为`PO ID 1 / PO-00000001`，request`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`，actor`uat_20260729_purchase`，时间`2026-08-08 14:11:45.086372 Asia/Shanghai`；PO/Line/Plan/queue `1/4/4/4`，Award`1/v1/AWARDED`，Supplier`1/SUP-000001`，金额480.00 CNY。Receipt、Ledger、IQC、AP、付款和生产记录为0；事实来源为`SELFHOST-UAT-AUDIT-34`，本任务没有连接数据库重新取数。
- 控制：原样保留PO、四条Line、四条Plan、四条queue及Event/Audit/Idempotency证据；不删除、修改、取消或重建，不重试Award→PO。正式提交后，`PO-00000001`只作为后续UAT固定起点；本决定只放行后续只读PO追溯验收，每个后续写阶段仍须独立明确授权。
- 下一步：下一任务只能是PO历史追溯页面修复/验收，并在仓库/IQC前先补齐完整谱系和凭证。warehouse、quality及finance试用仍未授权；Receipt/IQC/Ledger/AP/生产记录必须保持0，不得从本决定启动到货、收货、IQC、入库、库存、AP、付款或生产。
- 范围/验证：只更新项目文档；未登录UAT、连接PostgreSQL、调用Identity或业务API、修改凭据、运行Migration/build、部署或重启。项目`.venv`的Python self-test、smoke、任务专用临时SQLite `go_live_check --no-backup`均通过；宿主`npm`不存在而在测试启动前返回127，随后以本机已有Node镜像在断网、只读、1 CPU/1 GiB、自动删除容器中通过`npm test` 3/3。七份Markdown/38个本地引用、1,280文件credentials及`git diff --check`全部通过。
- 资源/清理：起点/收口available约1.9/1.9GiB，Swap`238/238MiB`，根盘18GiB，Load由`0.15/0.14/0.10`收口到`0.01/0.10/0.10`；内核OOM0，四服务restart0/OOM false。任务临时目录、容器、网络和Volume清零，四个受保护Volume保留；未prune、未删除备份或镜像。
- Git：从clean`main@e67c9209bc24314000f70760b7b79282c4a9b469`、Parent`9a8a3bd8a84bacb2836ac116d3b8a80783e96fe6`、behind0/ahead172起步，只形成一个聚焦文档提交；提交后ahead173，实际SHA以Git log为准。不push/PR/amend/rebase/reset/stash/restore。

### SELFHOST-UAT-AUDIT-34 - `docs: audit existing UAT PO provenance`

- 范围/分支：仅对Award ID1、`PO-00000001`及直接谱系执行`REPEATABLE READ READ ONLY`取证；未运行Migration、重做转换、补写Event/Audit或创建任何下游。采用分支B：`UNAUTHORIZED UAT PO WRITE CONFIRMED — DATA PRESERVED`。
- 来源：唯一SUCCESS request为`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`，actor`uat_20260729_purchase`，时间2026-08-08 14:11:45.086372；Audit1491、Idempotency201、PO CREATED Event及对象计数一致。历史422 request`f30a7801…`仍为failed且业务记录0。
- 授权判断：成功请求在purchase LOGIN/LOGOUT时间窗内，但数据库没有task/runner/browser/session绑定；FIX33明确主UAT business POST0并要求新授权，仓库内无后续转换任务、授权记录或提交。因此不能证明授权来源，也不能凭关系化事实证明或排除隔离runner误连；不推断凭据泄露或自然人身份。
- 完整性：PO/Line/Delivery Plan/queue精确`1/4/4/4`，Award Line1—4→Candidate`2/4/6/8`→Quote Line1—4→Binding/Mapping fact1—4→Material533—536逐条闭合，各10 PCS×12.00=120.00 CNY、计划日2026-10-20；重复、第五行、Supplier B行、孤儿和错配均0。实际备注使用半角逗号，不等于要求的全角原文，未改写。
- 上下游：Award1/v1/AWARDED和RFQ1/CLOSED/v7保持，转换不改上游CAS；目标Receipt、Warehouse Receipt、Ledger/Lot、IQC、AP、Payment、Work Order及生产记录全0，禁止继续履约。
- 只读UAT/保护：桌面1440×900与390×844及detail/queue GET通过，页面缺少独立详情/Audit组件已如实记录；`business_post=0`、Session0。目标指纹前后均`12d2c02031f34a5212bec80f5f9a5edcc8b1983fe24b96570f87fb17e2f5af18`。
- 测试/资源/Git：项目`.venv`串行通过Python self-test、smoke和临时SQLite `go_live_check --no-backup`；首次系统Python smoke缺依赖而在导入阶段停止，切回既有项目环境后通过，未连接主UAT。起点至最终available约2.1→1.9GiB、Swap235→237MiB、根盘18GiB，内核OOM0、四服务restart0/OOM false；任务临时资源清零、未prune、受保护卷未改。仅更新五个审计文档并形成一个聚焦提交，不push/PR/改写历史。

### SELFHOST-UAT-FIX-33 - `fix: unify Award to PO mapping qualification` / `ops: deploy Award to PO mapping validation fix`

- 分支/根因：采用分支A。四条固定Supplier A Mapping及RFQ Binding权威有效；GET预览此前只返回Award历史粗布尔值，POST却忽略固定Binding重新按Supplier/Material/Unit查询，并额外要求`material.base_unit_id=unit.id`。主UAT四条legacy Material为`base_unit_id=NULL/base_uom=PCS`，按D-091可唯一解析PCS，因此旧POST把四条合法事实全部过滤为0并返回泛化422。
- Mapping/谱系：Award Line1—4固定到Candidate`2/4/6/8`、Quote Line1—4、Binding1—4及Mapping fact1—4/v1/row CAS3；UUID分别为`224d1965…07ff8`、`43ca04d8…18030`、`aa16f7e7…f257e`、`9659ad2d…c63f`。关联不使用名称、supplier part、价格、数组位置或Event join。
- 统一合同：新增`AWARD_PO_MAPPING_QUALIFICATION_V1`服务端loader和逐行DTO，GET与POST共用transaction as-of、`[from,to)`、稳定字符串ID、Unit/正数等值换算、状态、固定version/CAS/digest及两类冲突规则。确认窗口升级V2并在桌面/390×844展示四行完整凭证；`po_convertible_now`只在全行qualified和PO/Line/Plan全0时为true。
- 事务/并发：最终POST锁定Award/Line、Candidate、Quote/Line、Binding、Mapping、Supplier、Material和Unit，锁后重算相同摘要；PO Line只保存固定Mapping fact。资格读与Mapping写统一part→material advisory顺序并锁后重读版本，状态/有效期/version/CAS/digest真实漂移失败关闭，无关Mapping变化不阻断；业务/Event/Audit/幂等继续原子提交。
- 测试/隔离：无数据库组合93/93、资格/履约/Mapping Unit22/22、Fulfillment PG5/5、Supplier Mapping PG10/10、0038/0039`5/5+6/6`、Sourcing PG9/9、Binding PG18/18、upgrade3/3、npm3/3、Python三项、三个typecheck、production build、lint0 error/11既有warning、最终1,278文件credentials、diff及Chromium1/1通过。成功为PO/Line/Plan/queue`1/4/4/4`，全部失败路径业务计数0。
- 备份/恢复：正式custom dump为root:root0600、单硬链接、2,294,665 bytes，SHA-256`d3cf053f09948c6e4ae54caff028a7663a3750249bcaf3e8758e2f0ace49c5c2`，`pg_restore --list`3,359项；第二新库单事务恢复39/head0039、226表、四条Mapping/Binding谱系、失败请求一次及PO/Line/Plan/queue全0后删除。备份窗口`compose start worker`因已不存在的一次性migrate依赖在启动前安全退出，未改容器；随后以`docker start`恢复完全相同Worker和旧Web。
- 部署/UAT：仅替换Web`2396c8bc…→83c1bff3…`，旧镜像保留精确FIX33回退tag；PostgreSQL/Worker/Caddy及四卷不变，未运行Migration。purchase-only桌面与390×844只执行一次预览，四行均qualified且`po_convertible_now=true`，填写本地备注后取消并logout；`preview_get=1`、`business_post=0`、Session0，失败请求和四条Mapping不变，PO/Line/Plan/queue前后`0/0/0/0`。
- 资源/清理/Git：起点/收口available约2.1GiB，Swap`233→250MiB`，根盘18GiB，收口Load`0.55/0.39/0.39`；任务时段内核OOM0，四服务restart0/OOM false。七个隔离库、恢复库、任务容器/网络/runtime和Python临时目录精确清理，正式dump和回退镜像保留，未prune。功能提交`1f205af0bf81379345a09353d9d32ab5c7545971`，部署/文档以独立`ops: deploy Award to PO mapping validation fix`收口；未push/PR或改写历史。

## 2026-08-07

### SELFHOST-UAT-FIX-32 - `fix: add Award to PO conversion confirmation` / `ops: deploy Award to PO confirmation fix`

- 根因/合同：旧“显式生成采购订单”按钮首击直接POST。现改为先以无缓存权威GET重新读取Award/RFQ/Comparison/Quote/Event/摘要/四行/PO计数/Supplier/付款条件并打开本地确认窗口；取消、关闭、ESC和背景关闭均零业务POST，默认焦点取消。只有明确最终确认才POST，按钮在DOM事件内同步禁用并由同步ref防双击；失败后不自动重试。
- 字段/模型：现有PO Header只有正常`remark`（最多2,000字），没有外部参考字段；窗口允许备注并准确提示“当前PO模型未采集外部参考”，不挪用其他字段、不增0040。Delivery Plan没有独立Header/Line层，每个计划记录直接唯一绑定一条PO Line；样本语义为一次转换、1个PO、4条PO Line、4个Delivery Plan。
- 服务端/事务：最终DTO仅接受Award/RFQ CAS、两类摘要、完整Line ID、PO零计数等确认断言和备注；Supplier、Material、Unit、数量、价格、币种、交期及范围均从不可变Award来源重读。幂等回放先判定，随后在Award advisory lock和同一事务连接内重算完整预览并锁定Award/RFQ/PRQ/Line/Quote/Mapping；同事务创建PO/Line/Award Link/逐行Plan/Queue/Event/Audit/幂等结果，任一失败零半记录。
- 下游边界：转换不自动创建Receipt、Warehouse Receipt、Inventory Ledger、IQC、AP、Payment、Work Order或其他生产/财务记录；供应商到货、仓库收货和IQC须独立任务。Award、RFQ、Quote和Comparison不修改。
- 测试/隔离：Fulfillment Unit4/UI3/PG3，Sourcing Unit12/UI24、Sourcing/Binding PG27，0018/0019/0039升级`3/3 + 3/3 + 6/6`，安全30、npm3、Python三项、typecheck、production build、lint 0 error/11既有warning、凭证扫描及diff check通过。隔离正式转换为`1 PO / 4 PO Line / 4 Delivery Plan / 4 queue`，并发单胜、故障零半记录；Chromium覆盖延迟取消、全部退出零POST、失败无重试、同步禁用/双击单POST及桌面/390×844无页面级横向溢出。
- 备份/恢复：正式dump为root:root0600、单硬链接、2,294,098 bytes、SHA-256`75e45758f3f220f118ec98c8e2351274c4e640aa3c046507a2b294cebdaf3d97`，`pg_restore --list`3,359项；第二新库恢复39/head、226表、四basis摘要、Award/Line/Event、金额/交期及全部下游0后删除。
- 部署/UAT：仅替换Web`bb544f89…→2396c8bc…`，旧Web有FIX32精确回退tag；PostgreSQL/Worker/Caddy身份和四卷不变，未运行Migration。purchase-only桌面/390×844打开、核验、填备注并取消通过，`preview_get=1`、`business_post=0`、Session0，PO/Plan前后0。首次流程已完成取消和logout，但验收器误等该履约页未维护的sourcing专用auth dataset而超时；确认Session/业务计数全0后改用真实“请先登录。”匿名UI断言，复验通过。
- 资源/Git：起点/最终available约2.1/2.1GiB、Swap274/239MiB、根盘18GiB、最终Load`0.71/0.38/0.62`，内核OOM0、四服务restart0/OOM false；临时库/容器/runtime/SQLite清零。功能提交`a4ffb8ee022234ea25add4ce636050366ac6887a`，部署/UAT文档由独立ops提交收口；未push/PR或改写历史。结论`AWARD TO PO CONFIRMATION FIXED — UAT PO NOT CREATED`。

### SELFHOST-UAT-FIX-31 - `fix: add RFQ award history traceability` / `ops: deploy RFQ award history traceability fix`

- 权威模型：采用分支A并如实显示模型边界。Award聚合稳定主键为`procurement_sourcing_awards.id=1`，无独立业务编号，有真实`version=1`与持久化`status=AWARDED`；四条稳定Award Line ID 1—4分别闭合到Comparison Line/Candidate/Quote Line `1/2/1`、`2/4/2`、`3/6/3`、`4/8/4`，均引用Quote 1/v1、Supplier 1和Material 533—536。缺失、重复或跨RFQ引用时详情失败关闭，不回填历史。
- 摘要边界：既有`award_digest=7ac6bf2e…a66e55`继续作为创建时持久化Award摘要展示，明确不等同于decision digest。Schema没有`decision_digest`字段；新增服务端`AWARD_DECISION_V1`，按Award Line ID稳定排序，从Award/RFQ/Round、Comparison Version/output digest、Line/Comparison/Candidate/Quote/Quote Line/Supplier/Material、数量/单价/金额和规范化理由确定性重算，并明确标注非持久化来源。
- Event/CAS：只接受与Award actor、时间、request_id、结果及理由精确一致的唯一`AWARDED` Event；主数据Event ID9没有版本字段，页面显示“历史Award Event未记录版本转换”。同request_id唯一成功Audit ID1469独立证明RFQ CAS `v6→v7`，当前`v7`来自RFQ Head，Audit不冒充Event字段且不显示`vnull`。
- 状态/UI：Comparison可以继续投影`CURRENT`，但存在Award或RFQ不再`ISSUED`时`awardable_now=false`，并显示“Comparison仍是当前版本，但RFQ已完成定标，不可再次创建Award。”；Award历史替代创建表单和确认按钮。`po_convertible_now`只读核验Award/RFQ状态、四行完整引用、来源PRQ和PO计数，本页不提供转PO写操作。
- 测试/边界：typecheck、Unit12/12、UI24/24、Sourcing/Binding PG27/27、0039 6/6、安全30/30、隔离Chromium5/5、npm3/3、environment6/6、Python三项、lint、credentials和diff check通过。隔离浏览器结果Award1/Line4/PO0，历史阶段business POST0；没有0040、Migration或主UAT业务写。
- 备份/恢复：正式dump为root:root0600、2,293,634 bytes、SHA-256`7a3eb8720a0a7075a56288543ee9aeaaa0d3901d0699fdb2b4cd4d5b289cd4fa`，`pg_restore --list`3,359项；第二新库恢复39/head0039、226表、RFQ CLOSED v7和Award/Line/Event/PO`1/4/1/0`及四条引用后删除。
- 部署/UAT：仅替换Web`f1184385…→bb544f89…`，旧Web有FIX31精确回退tag；PostgreSQL/Worker/Caddy身份和四卷不变，未运行Migration。purchase-only桌面/390×844、刷新重开和安全退出通过，decision digest为`7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a`，`business_post=0`、Session0、Award/PO保持1/0；没有创建PO。
- 资源/Git：起点/最终available约2.1/2.2GiB、Swap252/273MiB、根盘18GiB、最终Load`0.11/0.20/0.37`，内核OOM0、四服务restart0/OOM false；临时库/容器/runtime/SQLite清零。功能提交`a014742`，部署/UAT文档由独立ops提交收口；未push/PR或改写历史。结论`RFQ AWARD HISTORY TRACEABILITY FIXED — UAT PO NOT CREATED`。

### SELFHOST-UAT-FIX-30 - `fix: complete RFQ award confirmation contract` / `ops: deploy RFQ award confirmation contract fix`

- Git/范围：从唯一worktree、clean`main@92adf4646ec45c6ae317c81e974219e75ab54612`、Parent`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`、behind0/ahead163起步；功能提交`22aa4dc053c9e0a8dc523956afe7742cf5d66fbc`，部署/UAT/清理和文档由独立ops提交收口。只补齐现有正式Award确认合同，不改Award提交DTO或服务端写语义，不创建主UAT Award/PO，不push/PR或改写历史。
- Quote/字段：确认窗口从CURRENT Comparison/Candidate/Quote DTO固定展示Supplier A Quote`1/v1`、Supplier`1 / SUP-000001`、`UAT-Q-A-042576`、480.00 CNY、2026-10-20、ON_TIME/提前10天，以及Supplier B Quote`2/v1`、Supplier`2 / SUP-000002`、`UAT-Q-B-042576`、400.00 CNY、2026-11-05、LATE/延期6天。稳定ID保持字符串，不按Supplier名称、价格或日期反向查找。
- 操作/保护合同：逐字明确本次只创建一次不可变Award操作并在其下恰好四条Award Line；显示操作1/Line4、Comparison Line1—4、Candidate`2/4/6/8`、全部Supplier A、不拆分数量。逐项声明RFQ、两份Quote、Comparison Version/Line/Candidate、Binding/Mapping不修改；逐项列出PO、Delivery Plan、Receipt、Inventory Ledger、AP、Work Order、其他生产及财务记录零自动创建。
- 下一阶段/UI：明确“定标转PO与到货计划”为独立后续任务，本次不自动执行；处理人未指定、时限未配置如实显示。RFQ/Round/CAS、basis/output digest、Material 533—536各10 PCS、金额/价差/交期差、原因与完整理由保留；默认焦点取消，桌面/390×844及长理由/digest/request_id无页面级横向溢出。
- 安全/测试：Award提交DTO精确键集合保持，服务端Comparison Version、Candidate、Quote、CAS、原因、purchase权限、Origin/CSRF、幂等、并发、审计和回滚未放宽。Unit11/11、UI22/22、隔离PostgreSQL27/27、0039 upgrade6/6、安全20/20、浏览器RFQ全套5/5、typecheck、lint0 error/11既有warning、production/Docker build、npm3/3、environment6/6及Python三项通过。
- 隔离Award：取消、关闭和ESC均为业务POST0；同步双击最终确认只形成一次Award操作和恰好四条Line，Candidate为`2/4/6/8`，PO0。隔离数据库/runtime已清理，没有影响主库。
- 备份/部署：正式dump root:root0600、2,292,405 bytes、SHA-256`19d563f424cb5bd628f2b2dc6114c74cc58eb7c66f3fb75038b14690a281e39e`、list3359；第二新库恢复39/head0039、226表、Award/Award Line/PO0/0/0及保护指纹后删除。仅替换Web`f239ffe3…→f1184385…`，旧Web精确rollback tag保留；未运行Migration，未重建PostgreSQL/Worker/Caddy，四卷未变。
- 主UAT/结论：只登录purchase，本地选择Candidate`2/4/6/8`和`DELIVERY_PRIORITY`，桌面/390×844核对确认窗口后取消，刷新草稿清空并安全退出；`business_post=0`、Session0。RFQ仍ISSUED v6、Comparison v1/CURRENT、Award/Award Line/PO`0/0/0`，output digest与保护指纹不变。结论`RFQ AWARD CONFIRMATION FIXED — UAT AWARD NOT CREATED`。
- 资源/清理：重任务串行；available约`2.1→2.2GiB`、Swap`242→252MiB`、根盘18GiB、Load`0.90/0.49/0.28→0.16/0.34/0.58`；内核OOM0、四服务restart0/OOM false。任务临时容器/runtime/SQLite/恢复与隔离库清零，正式dump、current/candidate/rollback镜像和受保护卷保留，未prune。

### SELFHOST-UAT-FIX-29 - `fix: bind RFQ awards to comparison candidates` / `ops: deploy RFQ award candidate selection fix`

- Git/范围与根因：从唯一worktree、clean`main@8665f21577f2b5f5ab2b9e5ac442487dd6c2335d`、Parent`80e1ad60fa1272017545e150721c8b71f7c68828`、behind0/ahead161起步；功能提交`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`，部署/UAT/清理和文档由独立ops提交收口。根因是RFQ Line bigint字符串与旧Quote Line数字严格比较使四行过滤为空，且旧UI错误使用Quote Line ID选择/提交。
- DTO/关联与分组：Comparison DTO显式投影Candidate、Comparison Line、固定Quote Header/version/Line、Supplier、金额、交期、排名与可定标事实；bigint稳定ID统一为规范十进制字符串，UI只按Comparison Line ID关联并以Candidate ID作为option/Award值。四行精确为`1/2`、`3/4`、`5/6`、`7/8`，B固定Quote2/v1，A固定Quote1/v1。
- UI/确认窗口：每行默认“请选择”且恰好两个Supplier；A rank2与B rank1均可选。确认窗口显示RFQ/Round/CAS、v1/CURRENT、basis/output digest、四行Candidate/Quote/Supplier、A480/B400、差80/20%、提前10/延期6/早16天、`DELIVERY_PRIORITY / 交期优先`及完整理由，默认焦点取消并明确不自动创建PO或其他下游。
- 服务端安全：Award DTO绑定Candidate及预期Quote身份；事务按RFQ先锁并重验CURRENT、固定Quote、CAS、摘要、完整行集、Candidate归属、金额和非最低价理由。跨Line、历史Version、错Quote、缺/重/额外行、CAS/输入/输出漂移、非CURRENT、数字Candidate ID和不适用理由拒绝；Origin/CSRF/purchase权限/幂等/并发/审计/回滚未放宽。保持alpha.40/0039，不改0039、不增0040。
- 测试/隔离Award：Unit/UI33/33、Sourcing PG9/9、既有Binding/Quote/0039 PG18/18、upgrade6/6、安全20/20、typecheck、lint0 error/11既有warning、Docker build、npm/Python/environment/credentials通过。隔离Chromium取消POST0；正式只POST一次并选择`2/4/6/8`，结果Award1/Line4/PO0，桌面/390×844无页面级溢出。
- 备份/部署：正式dump root:root0600、2,291,936bytes、SHA-256`151910bc0ee6a993ed71bfded7e790bd50dc23a3070649524f041fdf60e2e712`、list3359；第二新库恢复39/head0039、226表及保护指纹后删除。仅替换Web`0dfcc0a8…→f239ffe3…`，旧Web精确rollback tag保留；不运行Migration，不重建PostgreSQL/Worker/Caddy，不更换四卷。
- 主UAT/结论：唯一登录purchase，桌面/390×844本地选择A Candidate`2/4/6/8`、填写正式理由并打开确认后取消、清表退出；business POST0、Session0。RFQ仍ISSUED v6、Binding8、Quote2、Comparison v1/CURRENT、Line4、Candidate8、Award/Award Line/PO`0/0/0`；output digest`79554d88…619ec`和指纹`16d70f18…cf5bc`不变。结论`RFQ AWARD CANDIDATE SELECTION FIXED — UAT AWARD NOT CREATED`。
- 资源/清理：重任务串行；available约2.1GiB保持，Swap`272→250MiB`、根盘18GiB、最终Load`0.04/0.10/0.16`；内核OOM0、四服务restart0/OOM false。恢复/隔离库、临时容器/runtime/SQLite/目录清零，任务误拉且未使用的`alpine:3.20`已删除，未prune；正式dump、current/candidate/rollback镜像和受保护卷保留。

## 2026-08-06

### SELFHOST-UAT-FIX-28 - `feat: add RFQ comparison aggregate read model` / `ops: deploy RFQ comparison aggregate read model`

- Git/范围：从唯一worktree、clean`main@0d4e28842130a3289bea24c4eb9762c250de9809`、Parent`943c7fa5da44182617fa8a4f1d75b49b6d6c3795`、behind0/ahead159起步；功能提交`80e1ad60fa1272017545e150721c8b71f7c68828`，部署/UAT/清理与项目文档由独立ops提交收口。只补齐现有Comparison的聚合读模型和幂等保护，不创建Award/PO，不push/PR或改写历史。
- 模型/摘要：逐行`procurement_quote_comparisons.id`继续是稳定数据库ID，无独立Header ID；Version权威身份为RFQ、Round、Version和逐行持久化basis集合。CURRENT/SUPERSEDED/INPUT_DRIFT是服务端投影，输出摘要按Material/Supplier/Comparison Line/Candidate由不可变输出重算；主UAT摘要`79554d88…619ec`。
- 汇总/Event/UI：服务端投影固定Quote Header/Version/Line、Supplier总额/交期、逐Material金额/日期和A/B差异。真实四条Line级Event按共享actor/时间/request_id/result显示为一个生成凭证，不改历史。桌面表与390×844 Supplier/Material卡、可折叠追溯和长ID复制通过；生成按钮在当前输入时禁用，定标入口仅保持可见。
- 幂等/安全：同输入POST在隔离环境返回现有Version且Comparison/Candidate/Event/RFQ CAS零增量；Quote修订后才允许完整v2，v1不可变。历史Version Award拒绝、权限、Origin/CSRF、CAS、并发、幂等和故障回滚均通过。保持alpha.40/0039，未修改0039或新增0040。
- 验证：Unit/UI`10/10+18/18`、隔离PostgreSQL`3/3`、0039`6/6`、Schema consistency、隔离Comparison/完整RFQ Chromium`1/1+4/4`、typecheck、production/Docker build、npm3/3、environment6/6、Python三项、1,254文件credentials和diff check通过；lint0 error/11既有warning。
- 备份/部署：正式dump为root:root0600、2,291,624bytes、SHA-256`8e8589838c31f044c7741df9958556369b3eba4746d42c98b82dbb2d8bffa`；list3,359，第二新库39/head/226表和指纹一致后删除。仅替换Web`89e76775…→0dfcc0a8…`，无Migration；PostgreSQL/Worker/Caddy和四卷不变，旧Web精确rollback tag保留。
- 主UAT/结论：purchase-only桌面/390×844只读通过，`business_post=0`、Session0；RFQ ISSUED v6、Binding8、Quote2、Comparison Line/Candidate/Event`4/8/4`、Award/PO`0/0`。保护指纹始终为`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`。结论`RFQ COMPARISON AGGREGATE READ MODEL FIXED — UAT AWARD NOT CREATED`；`awardable_now=true`仅表示可另立定标任务。
- 资源/清理：重任务串行；起点/终点available约2.2/1.9GiB、Swap275/269MiB、根盘18GiB、最终Load`0.11/0.26/0.44`；内核OOM0、四服务restart0/OOM false。恢复/隔离库、临时容器/runtime/SQLite/Schema输出清零，起点既有测试库恢复为空，正式备份和current/candidate/rollback镜像保留，未prune。

### SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06 - `ops: deploy localized ERP statuses`

- 授权/范围：项目负责人在状态中文化源码任务完成后明确回复“授权”；从clean`main@943c7fa5da44182617fa8a4f1d75b49b6d6c3795`、behind0/ahead158起步，只把该提交Web-only部署到18888公开非生产UAT并做匿名只读验收。不登录、不发业务POST，不运行Migration，不替换PostgreSQL/Worker/Caddy/四卷，不部署历史Sites或生产。
- 备份/恢复：正式目录`status-localization-deploy06-predeploy-20260806T110129Z`为root:root0700；custom dump为0600、2,291,624bytes、SHA-256`2beeaeb2ba2d7f7e5c07c7099d0d5985df1bb2ac6a67cc240bcfda0121418d99`，list3,359项。第二新库恢复39/head、226表、文件卷、Session/Audit、RFQ/Quote事实和业务指纹一致后已删，正式备份保留。
- 镜像/替换：旧Web`sha256:f45d734b…`固定为`rollback-status-localization-deploy06-predeploy-20260806T110008Z`；精确`943c7fa`构建新Web`sha256:89e76775…`、88,572,838bytes。仅`--no-deps --no-build --force-recreate web`替换；PostgreSQL/Caddy容器身份不变，Worker只在一致性窗口短停并以原容器恢复，migrate未创建或运行，四卷不变。
- 在线/保护：HTTP308，HTTPS根页/health/legacy/status asset/app.js200；两个在线资产SHA与源码一致，缓存标识和中文角色、状态、审核/执行结果通过。匿名Session false/null且无Cookie，Summary/Materials401，private/no-store和安全头保持。部署前/恢复库/部署后业务指纹均为`59057998…bdbc24`；39/head、226表、Session209、Audit1455、RFQ ISSUED v6/Binding8、Supplier A/B Quote1/1、Quote/Award/PO2/0/0保持。
- 验证/资源：候选production build/postbuild、状态/企业UI/Dashboard合同13/13、npm3/3、候选健康、最终Python三项和1,249文件credentials通过；功能提交完整验证证据保持。公开域名连续60秒health7/7、SwapFree`766600→766676KiB`；起点/终检available约2.2/2.2GiB、Swap272/276MiB、根盘19/19GiB、Load`0.25/0.24/0.43`→`0.21/0.20/0.24`，OOM0、四服务restart0/OOM false。
- 清理/结论：本机SNI探针和旧Migration断言 inspector均失败关闭，不计入在线健康且无数据写；最终使用公开域名与直接read-only业务指纹复核。临时worktree、容器、恢复库/文件、响应文件和SQLite清零，正式备份与current/candidate/rollback镜像保留，未prune。结论`STATUS LOCALIZATION DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`。

### SELFHOST-UI-STATUS-LOCALIZATION-05 - `feat: localize visible ERP statuses`

- 范围：从 clean `main@fb4c89bd`、behind0/ahead157 起步，只修改自托管原生 React 与 legacy 兼容台的最终用户显示层、对应 UI/浏览器验证期望和项目文档。版本保持 alpha.40，Migration保持0039；不改认证、权限、API合同、状态机、数据库枚举、Compose或环境变量。
- 实现：新增共享 `status-localization.js` 与类型声明，用 `statusLabel/statusPairLabel/roleLabel` 统一业务状态、组合状态、审核/执行结果、启停状态与角色名称；未知值原样回退，筛选值、比较、提交、CSS分类和审计原始码保持英文稳定枚举。工作台及业务页纯英文眉题同步中文化，稳定ERP业务缩写保留；legacy缓存标识更新为`20260806-status-localization-05`。
- 验证：38个适用UI/物料/状态测试文件、10组typecheck、Vinext production build/postbuild、npm3/3和Python三项通过；lint 0 error/11既有warning，五个浏览器验证脚本语法通过，1,247文件credentials和diff check通过。登录式浏览器旅程未连接UAT执行。
- 资源/边界：受限只读构建容器使用tmpfs，任务容器/挂载点/临时SQLite清零；available约2.2→2.2GiB、Swap260→272MiB、根盘19GiB、Load`0.04/0.19/0.37`→`0.18/0.78/0.72`，内核OOM0、四服务restart0/OOM false。
- 结论：`VISIBLE ERP STATUSES LOCALIZED — SOURCE ONLY`。公开UAT仍运行Web`sha256:f45d734b…`；未登录、写入、构建在线镜像、重启、运行Migration或部署，发布须新明确授权。

### SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04 - `ops: deploy role-based ERP workbench`

- 授权/范围：项目负责人明确要求直接部署；从 clean `main@4767c3db3cf66eb0978f07d044437790c0d4b87f`、behind0/ahead156起步，只把八角色工作台 Web-only部署到18888公开非生产UAT并做匿名只读验收。不登录、不发业务POST，不运行Migration，不替换PostgreSQL/Worker/Caddy/四卷，不部署历史Sites或执行生产切流。
- 备份/恢复：正式predeploy custom dump为root:root0600、2,288,824bytes、SHA-256`dad839eff68d649e1098b0df33ba3316245a93f65893aea985d012362df266d6`，list3,359项；第二新库恢复39/head、226表、Session207、Audit1446、Quote/Award/PO`1/0/0`和保护指纹一致后已删，正式备份保留。
- 镜像/替换：旧Web`sha256:f139257b…`固定为`rollback-role-hub-deploy04-predeploy-20260806T083541Z`；精确`4767c3d`源码构建新Web`sha256:f45d734b…`、88,560,525bytes。仅`--no-deps --no-build --force-recreate web`替换；PostgreSQL/Caddy容器身份不变，Worker仅在一致性备份窗口短停并恢复，migrate未运行，四卷不变。
- 在线/保护：HTTP308，HTTPS根页/health/legacy200，新bundle含管理员、采购、市场、计划、工程、财务、生产、仓库及角色工作台CSS；private/no-store、安全头、匿名无Cookie和Summary/Materials401通过。部署前/恢复库/部署后指纹均为`597eb456…9f9f`，Session/Audit与RFQ/Quote事实不变，业务POST0。
- 最终仓库校验：只读Node22容器内Dashboard/企业UI合同10/10、1,243文件credentials和diff check通过；完整功能构建与回归沿用功能提交的73/73 UI、五组typecheck、lint、production build/postbuild、npm/Python全通过证据。
- 保护修正/资源：运行类别门禁和一次遗漏Compose项目名均在正式替换前失败关闭；未一致停服的dump不作恢复依据并已精确删除，旧服务恢复后以精确项目名完成正式备份和部署。60秒health7/7、SwapFree不降；available约2.2→2.1GiB、Swap306→260MiB、根盘19GiB、Load`2.51/1.97/1.03`→`0.40/0.38/0.57`，OOM0、四服务restart0/OOM false。临时资源清零，正式备份和current/candidate/rollback镜像保留。
- 结论：`ROLE-BASED WORKBENCH DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`。

### SELFHOST-DASHBOARD-ROLE-HUB-03 - `feat: simplify ERP workbench role entrances`

- 范围/信息架构：从 clean `main@8aa3f70329a11cffb2ee43d2942b3c4484e6137f` 起步，只简化登录后根工作台；密集指标、风险、治理、事件和模块方块退出首屏，改为管理员、采购、市场、计划、工程、财务、生产、仓库八部门导航与单一当前部门业务清单。登录/设置/改密/退出、业务页面和 legacy 内容未改。
- 权限/模块：40 个现有 Dashboard 模块被完整且唯一归入八部门；页面只从 `/api/summary` 消费服务端已裁剪模块，未授权部门不可进入，业务路由仍二次执行服务端认证授权。根工作台不再无用请求 Management Dashboard/Backup Governance；API 实现、权限定义、CSRF、幂等、业务、Schema/Migration、alpha.40 均不变。
- 响应式/验证：桌面为角色导航+单清单，720px 以下纵向，保留焦点、选中/禁用态、无横向溢出和 reduced motion。UI 合同73/73、五组typecheck、lint、生产build/postbuild、npm3/3、Python三项、1,241文件credentials和diff check通过。
- 资源/边界：唯一受限只读构建容器使用tmpfs且已清零；available约2.1→2.2GiB、Swap292→306MiB、根盘19→19GiB、Load`0.07/0.18/0.32`→`2.51/1.97/1.03`，四服务restart0/OOM false。本提交未登录、写入、构建在线镜像或部署UAT；项目负责人随后明确授权独立Web-only部署任务。
- 结论：`ROLE-BASED WORKBENCH COMPLETE — SOURCE ONLY`。

### SELFHOST-UI-REFRESH-DEPLOY-02 - `ops: deploy enterprise ui refresh`

- 授权/范围：项目负责人在`SELFHOST-UI-REFRESH-01`完成后明确授权；从clean`main@aac6f349f39e81b886916c639cbfc8a541bd0b7b`、behind0/ahead154起步，只把企业级UI Web-only部署到18888非生产UAT并做匿名只读验收。不登录、不发业务POST，不运行Migration，不替换PostgreSQL/Worker/Caddy/四卷，不部署历史Sites或生产。
- 备份/恢复：predeploy custom dump为root:root0600、2,288,827bytes、SHA-256`8dd0141bb047d75b0bfea87011d7ac56db46d27b7fe51907045b8a173c93de7d`，list3,359项；第二新库恢复39/head、226表、Session207/有效10、Audit1446和保护指纹一致后已删，正式备份保留。
- 镜像/替换：旧Web`sha256:20b41bd3…`固定为`rollback-ui-refresh-deploy02-predeploy-20260806T080240Z`；精确`aac6f34`源码构建新Web`sha256:f139257b…`、88,560,352bytes。Docker生产build/postbuild、UI4/4、Dashboard5/5、npm3/3、Python三项、1,240文件credentials、diff check及候选静态/运行合同通过；仅`--no-deps --no-build --force-recreate web`替换，migrate未创建或运行。
- 在线/保护：HTTPS根页/health/legacy/CSS200，新bundle、`20260806-enterprise-ui-refresh-01`、蓝色令牌、focus/reduced-motion、private/no-store和安全头通过；匿名Session false/null、不发Cookie，Summary/Materials401。部署后39/head、226表、Session/Audit和指纹`597eb456…9f9f`完全不变，RFQ ISSUED v4、Binding8、Supplier A/B Quote1/0、Quote/Award/PO1/0/0不变。
- 资源/结论：60秒health7/7、SwapFree无下降，内核OOM0、四服务restart0/OOM false；available约2.2→2.2GiB、Swap289→292MiB、根盘18→19GiB、Load`0.21/0.35/0.43`→`0.28/0.49/0.49`。临时容器/恢复库/Python临时SQLite/工作区构建输出清零，未prune；正式备份、current/candidate/rollback镜像和四卷保留。结论`ENTERPRISE UI DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`。

### SELFHOST-UI-REFRESH-01 - `feat: refresh self-hosted ERP interface`

- Git/范围：从 strict clean `main@70045998c765d95e1abf57041cd46a8da4f9ed7e`、behind 0/ahead153起步；只统一自托管 Node/PostgreSQL ERP 的登录、经营工作台、原生共享业务壳、Supplier Mapping/RFQ扩展和legacy兼容台。版本保持alpha.40，Migration保持0039；不改API、认证、权限、业务、Schema、Compose或环境变量，不push/PR或改写历史。
- 视觉：参考用友YonSuite官方展示的一体化门户、角色工作台和紧凑信息密度，提取浅灰背景、白色工作区、蓝色主操作、深蓝导航、紧凑表格与统一状态色等通用模式；保留晨亿达自有名称和`CY`标识，不复制用友商标、Logo、截图或素材。登录/设置/改密改为品牌信息区+白色认证区，工作台改为紧凑顶栏/上下文条/指标卡/模块与事件面板，原生和legacy业务区共享一致令牌、焦点和响应式边界。
- 合同/缓存：新增`selfhost-enterprise-ui-contract.test.mjs`及`test:ui:enterprise`，固定设计令牌、认证结构、稳定路由、响应式、可见焦点、reduced motion和legacy身份一致性；Dashboard与legacy缓存版本统一为`20260806-enterprise-ui-refresh-01`。没有改变认证请求、退出保护、API调用或任何服务端业务规则。
- 验证：静态UI合同最终72/72；Dashboard、Review、Project、Planning、Procurement Sourcing五组typecheck通过；生产build五阶段及postbuild consistency、npm3/3、Python三项、1,238文件credentials和diff check通过，lint 0 error/11既有warning。首次build仅因只读node_modules不能建立Vite临时目录失败，以64MiB tmpfs隔离后完整通过，工作区未写构建产物；未运行浏览器/UAT业务验收。
- 资源/清理：available约2.2→2.2GiB、Swap286→289MiB、根盘18→18GiB、Load`0.01/0.12/0.16`→`0.38/0.62/0.52`；内核OOM0、四服务restart0/OOM false。三个参考图、受限测试容器、Python go-live测试备份及其单条活动记录已精确清零且不可恢复；历史备份、业务数据、Python 18889服务、既有dist、四卷和常驻容器保持，未prune。
- 结论：`SELF-HOSTED ERP UI REFRESH COMPLETE — SOURCE ONLY`。没有登录、写入、构建镜像、重启或部署当前18888非生产UAT；线上仍为改造前界面，浏览器验收或部署必须另立明确授权任务。

### SELFHOST-UAT-FIX-27 - `fix: correct rfq quote traceability semantics` / `ops: deploy rfq quote traceability fix`

- Git/范围：从strict clean`main@119dd04f724fccb0ef2b849b974d3e93c5c55008`、Parent`f6f7d2a`、behind 0/ahead151起步；功能提交`1be492e68f6635bc00ea3fb8ce461eac0617d8e7`，部署/UAT/清理和文档由独立ops提交收口。只修复RFQ Quote聚合CAS/邀请语义、固定范围漂移和Quote追溯；不改Migration/版本，不删除、修订或重建Supplier A Quote，不创建主UAT Supplier B Quote/Award/PO，不push/PR或改写历史。
- 权威语义/根因：采用分支A。Quote首版在单事务中锁RFQ CAS、写Header/Lines、邀请`INVITED→RESPONDED`、RFQ Version+1和唯一`QUOTE_SUBMITTED`；因此主RFQ`v3→v4`和Supplier A RESPONDED均正常。旧详情把要求INVITED的`eligible`用于已固定Binding阻断并以“Mapping Version/CAS漂移”兜底，错误把正常响应当范围漂移；现以Binding/Supplier-Line/Mapping ID-Version-Row CAS-content-status-effective/唯一性和scope digest为唯一范围依据，真实漂移仍fail closed。
- Quote追溯：服务端显式投影稳定Quote数据库ID、独立业务编号存在性、RFQ/Supplier/Quote版本状态、actor/上海时间/request_id、行金额/总额、需求/承诺日期、提前/延期和`ON_TIME|LATE`。页面显示Quote ID 1、无独立业务编号、Supplier 1/RFQ 1/Round1、SUBMITTED v1、`UAT-Q-A-042576`、四行各120.00/总额480.00、提前10天；单事务直接提交只有`QUOTE_SUBMITTED`，无CREATE，历史Event空版本显示“事件未记录版本转换”，无`vnull`。
- Supplier独立入口：Supplier A显示RESPONDED且不再出现在首版Quote下拉；Supplier B显示INVITED且`quote_entry_enabled=true`。隔离环境验证Supplier B成功及并发单胜后删除测试库；主UAT只观察入口，未进入/填写/提交，Supplier B Quote始终0。
- 自动验证：Unit/UI`9/9+12/12`、隔离PostgreSQL`21/21`、Chromium`3/3`、0018 upgrade`3/3`、0039`6/6`、npm`3/3`、environment`6/6`和Python三项通过；typecheck、production/Docker build、1,236文件credentials和diff check通过，lint 0 error/11既有warning。首次environment因容器漏挂根config失败，修正挂载后通过；没有改断言。
- 备份/部署：predeploy dump为root:root 0600、2,286,915 bytes、SHA-256`4fa038e093a846ae0d8380f383b5fc9a89cb926aded1c3bc98746269f89a400d`；list 3,359行，第二新库恢复39/head/226表和指纹一致后已删。仅替换Web`c8c3fdd5…→20b41bd3…`，无Migration；PostgreSQL/Worker/Caddy和四卷不变，旧Web精确rollback tag保留。
- 主UAT/结论：保护指纹在部署前、恢复库、部署后、首次runner停止后和最终UAT后始终为`597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`。首次runner仅因移动端把分栏文字错断言为连续字符串而停止，logout/Session0/业务零写；修正runner后purchase-only桌面/390×844通过，`business_post=0`、Session0。最终RFQ ISSUED v4、Binding8、摘要`9765f8fd…4848d`、Supplier A Quote ID1保留、Supplier B Quote0、Quote/Award/PO 1/0/0。结论`RFQ QUOTE VERSION SEMANTICS FIXED — SUPPLIER A RETAINED`。
- 资源/清理：起点/最终available约2.1/2.2GiB、Swap290/287MiB、根盘19/18GiB、最终Load`0.14/0.17/0.33`；瞬时Load6.21未持续三分钟，Swap最高约292MiB，内核OOM0、四服务restart0/OOM false。临时库/恢复库/容器/runtime/SQLite清零，未prune；正式备份、当前/候选/rollback Web和四卷保留。

### SELFHOST-UAT-FIX-26 - `fix: clarify rfq issuance confirmation` / `ops: deploy rfq issuance confirmation contract`

- Git/范围：从 strict clean `main@f0202b083387c4f60eb5537221b1ce51d2dd93de`、Parent `08af2f4`、behind 0/ahead 149起步；功能提交`f6f7d2a`，部署/UAT/清理和文档由独立ops提交收口。只补齐发出确认UI合同、只读UAT/保护runner和测试；不改发出服务端业务规则、Migration、版本、Binding/Mapping/Event/摘要或主业务数据，不push/PR或改写历史。
- 状态/身份：0039确有独立`binding_status`且限定ACTIVE，故Binding ACTIVE、Mapping ACTIVE、邀请INVITED分栏，并另列固定来源和两类漂移；尚未固定行不伪造状态。主表改为按数值Binding ID 1—8展示同一行的Supplier/RFQ Line/Material/Mapping外键；旧`3,4,1,2,7,8,5,6`序列退出身份主字段，摘要规范化与身份展示明确解耦。canonical摘要保持`9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`。
- 确认合同：入口保持“发出询价并冻结范围”，最终写按钮精确为“确认发出”，默认焦点取消；取消、关闭、ESC/背景关闭零业务请求，确认同步禁用。窗口逐项列出Quote、Award、PO、Delivery Plan、Receipt、Inventory Ledger、AP、Work Order、其他生产记录和财务记录均不会自动创建或修改。
- 测试：UI 10/10、Unit 8/8、隔离PostgreSQL 20/20、Chromium 2/2、0039 Migration 6/6、npm 3/3和Python三项通过；typecheck、production build/postbuild、功能树1,231/最终文档树1,232文件credentials及diff check通过，lint 0 error/11既有warning。隔离双击只产生一个issue POST、一条`RFQ_ISSUED` Event和一次CAS，权限/CSRF/Origin/过期CAS/幂等冲突失败关闭，全部下游0，桌面/390×844无溢出。
- 备份/部署：predeploy dump为root:root 0600、2,284,946 bytes、SHA-256`b810d5a588a0a262ace478569815e1ca7e8c84dab7218368d435d8400263497d`；list 3,359行，第二空库恢复39/head/226表和保护指纹一致后已删除。仅替换Web`315f0b79…→c8c3fdd5…`，未运行Migration；PostgreSQL/Worker/Caddy和四卷不变，旧Web rollback tag保留。
- 主 UAT/结论：purchase-only在桌面和390×844核对八条权威关联、三状态、摘要、最终按钮与完整下游保护，两次只取消；`business_post=0`、Session 0。最终RFQ仍DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO及全部下游0，指纹仍`9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`。结论`RFQ ISSUANCE CONFIRMATION FIXED — UAT RFQ STILL DRAFT`；正式发出需新任务明确授权。

### SELFHOST-UAT-FIX-25 - `docs: correct rfq binding association baseline`

- Git/范围：从 strict clean `main@08af2f4`、Parent `e329931`、behind 0/ahead 148起步；只诊断 RFQ ID 1 的授权对象并更正任务/项目文档。不修改业务代码、Migration、数据库、部署配置或镜像，不登录 UAT，不执行业务 POST、备份恢复或部署，不 push/PR或改写历史。
- 权威诊断：单一 `REPEATABLE READ READ ONLY` 快照逐条核对 Binding→RFQ Supplier/Supplier、Binding→RFQ Line/Material、Binding→Mapping fact/version/UUID以及 supplier part、Unit、1:1、状态/CAS。八条关联按 PK 为 1→S1/M533/`224d…`、2→S1/M534/`43ca…`、3→S1/M535/`aa16…`、4→S1/M536/`9659…`、5→S2/M533/`45a3…`、6→S2/M534/`5bd2…`、7→S2/M535/`3ac2…`、8→S2/M536/`5432…`；错配、重复、孤儿、跨 RFQ均为 0。
- 摘要/代码链：以源码现有 `canonicalDigest` 复算固定范围为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`，与唯一成功 Event 完全一致。Repository 直接投影 `b.id::text` 并用稳定 FK连接；DTO/UI对整行对象排序，未使用数组下标、位置或 `index + 1` 重配身份。
- 根因/基线：采用分支 B。FIX-24 明细表本身正确，但摘要只列当次显示顺序 `3,4,1,2,7,8,5,6`；把它与 RFQ Line/Material 顺序 533—536按位置 zip，产生错误旧基线。项目文档现明确显示顺序不是身份，旧位置配对由逐行权威表替代；没有 UI旧值→新值或 Web部署。
- 回归/结论：断网只读容器的 Node `3/3 + 8/8 + 9/9`、临时 SQLite Python三项、1,228文件凭据扫描、diff check、终点只读计数和资源检查通过；备份、恢复、Migration、Chromium和部署均不适用且未运行。主 RFQ前后均为 DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO 0，业务数据改写/POST均为 0；内核 OOM和四服务 restart/OOM均为0，任务临时资源清零。结论 `RFQ BINDING BASELINE CORRECTED — UAT RFQ STILL DRAFT`。

### SELFHOST-UAT-FIX-24 - `fix: expose rfq binding identifiers` / `ops: deploy rfq binding traceability`

- Git/范围：从 strict clean `main@3bea653`、Parent `f919890`、behind 0/ahead 146起步；功能提交 `e329931`，最终镜像、主 UAT、清理和文档由独立 ops提交收口。仅贯通 RFQ Binding真实主键、固定凭证和发出前展示；不再次固定 Mapping、不发出主 RFQ、不修改 RFQ/Supplier/Mapping/PRQ/截止日、不创建 Quote/Award/PO，不 push/PR或改写历史。
- 模型/API：0039 已有 `id bigserial PRIMARY KEY NOT NULL`，采用分支 A；Repository 将 bigint显式投影为文本 `binding_id`，经 DTO/Service/Handler进入详情和发出预览。没有 0040、不改 0001—0039，保持 alpha.40。GET为 purchase权限和对象范围内的只读事务；POST继续复核 CAS、Binding数量/唯一性/归属、摘要、Mapping/状态漂移、PRQ和截止日。
- UI/凭证：八条 Binding按 Supplier/Material/ID稳定排序并独立显示 Supplier/Material、Mapping、单位、换算、有效期和漂移；Binding/Mapping/Line/Material ID标签分离。可重开的 `RFQ_MAPPING_CONFIRMED` 凭证显示 actor、上海时间、request_id、SUCCESS、v1→v2、八 ID和固定摘要；缺 ID或凭证未验证时禁用发出。发出窗口同时显示创建 Audit、四 Material、两 Supplier、截止日/CNY和零自动下游说明。FIX-25 后续明确：排序移动的是完整 DTO 行，显示次序不能按位置重配身份。
- 自动验证：Unit/UI `17/17`、隔离 PostgreSQL `20/20`、Chromium `2/2`、0039 `6/6`、0018 upgrade `3/3`、Material Requirement `18/18`、npm `3/3`、environment `6/6`和 Python三项通过；typecheck、Schema consistency、最终 build/postbuild、1,226文件凭据扫描和 diff check通过，lint 0 error/11既有 warning。首次主 UAT发现逐卡 Supplier信息缺失后安全停止、指纹/Session不变；补齐并重建后最终通过。
- 备份/部署：predeploy dump为 root:root 0600、2,284,331 bytes、SHA-256 `e937d7bcabbc78cc415dacf8565a58e7255724997b9332834acff8d5ec705ab6`；list 3,359行，第二空库恢复 39/head/226表及保护指纹一致。只替换 Web `5fe40694…→315f0b79…`；PostgreSQL/Worker/Caddy和四卷不变，四服务 restart 0/OOM false，旧 Web精确 rollback tag保留。
- 主 UAT/结论：purchase-only 最终 runner按当次页面显示顺序读取 Binding ID `3,4,1,2,7,8,5,6`，重开完整固定凭证，在桌面与390×844分别打开发出窗口并取消；该序列不代表与 RFQ Line/Material 列表的位置关联。`business_post=0`、Session 0。RFQ仍 DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO 0，保护指纹仍 `9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`。结论 `RFQ BINDING IDENTIFIERS DEPLOYED — UAT RFQ STILL DRAFT`；正式发出必须另获授权。

## 2026-08-05

### SELFHOST-UAT-FIX-23 - `fix: expose rfq mapping qualification evidence` / `ops: deploy rfq binding preview safeguards`

- Git/范围：从 strict clean `main@7cd9cd011e8c770933a061aa9ee51f8104b01ba3`、Parent `b339acd97f08e4cc09451173b48580015817d9f8`、behind 0/ahead 144 起步；功能提交 `f919890436662265bb22e2bec9ae00f5c2761372`，部署、主 UAT 只读 runner、最终验收与文档由独立 `ops: deploy rfq binding preview safeguards` 收口。只修改 RFQ Mapping 固定预览/重验、创建 Audit/Event 措辞、UI/测试/文档；不新增 Migration，不固定或发出主 RFQ，不录 Quote/Award/PO，不 push/PR 或改写历史。
- 权威预览/POST：新增 manage 权限与 RFQ/PRQ 数据域保护的 repeatable-read/read-only GET，重新读取 RFQ/PRQ CAS、四行、两 Supplier、Material、当前 Mapping ID/Version/CAS/digest、Unit/1:1/有效期、稳定 supplier part claim、Binding和下游；成功/失败零 Audit/Event/Idempotency/Binding。正式 POST 共用同一资格加载器，在事务锁后复核数据域、全规则和资格摘要；摘要不是锁，CAS/幂等/并发/回滚保持。
- 冲突/UI：同一 Supplier/Material 当前有效 ACTIVE 1:1 数必须为 1；同 Supplier 的标准化 supplier part 不得多 ACTIVE 或由其他 Mapping UID 稳定占用。缺失/失效/来源状态/CAS/已有 Binding等均返回稳定阻断和中文建议。确认窗显示两家 4/4、两类冲突 0、八条 Mapping、observed_at、Binding 0→8和不可变关系化快照；默认取消，加载/错误/取消/关闭/ESC及 390px 通过。
- Audit/Event：历史主 RFQ 标记为“RFQ 创建成功审计”，显示真实 actor、上海时间、request_id、SUCCESS和不存在→v1，并明确不是独立 RFQ_CREATED Event；新 RFQ 的 `RFQ_CREATED 业务 Event` 独立显示，事件区与 Audit 分列。
- 自动验证：Unit/UI `16/16`、Sourcing/FIX-23 PostgreSQL `19/19`、隔离 Chromium `2/2`、0018 upgrade `3/3`、FIX-22/0039 Migration `6/6`、Material Requirement `18/18`、npm `3/3`、environment `6/6`及 Python三项通过。typecheck、build/postbuild、1,222 文件 credentials、diff check通过；lint 0 error/11 既有 warning。原始 HEAD 与任务树的 `db:generate` 都提出语义等价 CHECK 表限定化 0040，故作为起点 Drizzle 漂移记录并丢弃生成物；0039 schema/snapshot/journal 契约仍 `6/6`，无 Schema/Migration 变化。
- 备份/部署：predeploy dump `/var/backups/chenyida-erp/rfq-binding-preview-fix23-predeploy-20260805T131610Z.dump` 为 root:root 0600、2,282,691 bytes、SHA-256 `ef5855252729ec072886e14a0dc4d40bac839b407989a63c8f3baab9fe7ece77`；list 3,359 行，第二空库恢复 39/head/226 表及保护指纹一致后已删除。只替换 Web `58d97778…→5fe40694…`，未运行 Migration或重建 PostgreSQL/Worker/Caddy，四卷/Origin/端口保持，旧 Web 精确 rollback tag 保留。
- 主 UAT/结论：唯一 purchase-only Chromium 一次通过。服务端结果为 Supplier 1/2 各 4/4、缺失 0、Supplier/Material 冲突 0、supplier part 冲突 0、八条 Mapping、预期 8/当前 Binding 0；桌面 ESC、390×844 取消，`business_post=0`，安全退出 Session 0。最终 RFQ DRAFT v1、Binding/Event/ISSUED/Quote/Award/PO 全 0，指纹仍 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`。结论 `RFQ BINDING PREVIEW FIXED — UAT BINDINGS STILL ZERO`；可在新明确授权任务中固定，实际发出仍需再次授权。

### SELFHOST-UAT-FIX-22 - `fix: expose rfq draft traceability` / `ops: deploy rfq issuance safeguards`

- Git/范围：从 strict clean `main@60538d08509f91eeb0df91718c7276172c23557d`、Parent `a86d9adceefb45efca1c43f1f8475703e8fa943d`、behind 0/ahead 142 起步；功能提交 `b339acd97f08e4cc09451173b48580015817d9f8`，部署、Asia/Shanghai 日期投影修复、最终 UAT 与文档由独立 `ops: deploy rfq issuance safeguards` 提交收口。只修改 RFQ 创建凭证、Supplier×Line Mapping 绑定/追溯、发出确认/重验/凭证、0039、测试/保护/UAT runner 和项目文档；不固定或发出主 RFQ，不录 Quote、Award、PO，不 push/PR 或改写历史。
- 权威模型/版本：现有 0018/0038 只有 RFQ Line→PRQ Line、RFQ Supplier→Supplier 和邀请级 Mapping 摘要，没有精确 Mapping version fact，故采用分支 B。alpha.40 新增唯一 `0039_rfq_traceability.sql`，SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；0001—0038 未改。新 generation 2 RFQ 在创建事务固定 2×4 Mapping 并写不可变 `RFQ_CREATED/SUCCESS` credential；历史 generation 1 草稿不回填、不伪造。
- 创建凭证/读模型：新 RFQ 读取唯一不可变 Event；0039 前 RFQ 只在唯一成功 Audit 精确匹配 object、actor、request_id、创建时间、Idempotency 摘要和 `null→v1` 时显示 `EXACT_SUCCESS_AUDIT`，否则 `UNVERIFIED` 并禁止发出。详情明确 `DRAFT / 草稿 / 待发出`、来源 PRQ/项目/截止日/CNY，以及历史未绑定的“当前资格/拟绑定”与发出后冻结快照。
- 发出保护：确认窗口列出创建凭证、四条各 10 PCS、两 Supplier、八 Mapping ID/Version、截止日/CNY和下游后果；默认取消、取消/关闭/ESC 零请求、同步双击门禁。服务端和数据库共同重验 PRQ、Supplier/邀请、Material、Mapping stable ID/version/CAS/content/status/effective period/1:1/唯一性、上海截止日、DRAFT/CAS；成功只写单个 ISSUED credential/Audit/Idempotency，不自动创建 Quote/Award/PO/库存/财务。
- 自动验证：Migration 6/6；Unit/UI 14/14、Sourcing/FIX-22 PostgreSQL 12/12（合计 26/26）；Material Requirement 12/12；真实 Sourcing→Award→Fulfillment 2/2；隔离 Chromium 1/1。typecheck、Schema consistency、build/postbuild、credentials、diff check、Python三项通过；lint 0 error/11 个既有 warning。最终隔离发出证明 Event 1、Binding 8、单 issue POST、重启持久、桌面/390px、下游 0和 Session 0。
- 备份/恢复：predeploy dump `/var/backups/chenyida-erp/rfq-traceability-fix22-predeploy-20260805T094629Z.dump` 为 root:root 0600、2,232,310 bytes、SHA-256 `960cd6a882b1ab923f2ee38dd83e9fc41f53942048bd5c1c07fcc44f1f3ae6c2`；`pg_restore --list` 3,321 行。第二新空库恢复 0038、匹配保护指纹、升级 0039 后再次匹配，随后精确删除。
- 部署/保护：主库停写、备份和指纹复核后串行应用 0039并替换 Web；最终为 alpha.40 Web `sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651`、88,531,959 bytes。PostgreSQL、Worker、Caddy和四卷未更换，restart 0/OOM false。旧 Web 保留回滚 tag；UTC 截日只读投影在不改 Migration/绑定快照下修为 Asia/Shanghai 并经最终镜像重验，该修复属于运维收口提交。
- 主 UAT/结论：前两次 runner 均在确认窗口前分别因响应合同断言和真实时区投影问题安全停止，业务写 0、Session 0、指纹不变；修复后 purchase-only 最终只读验收通过，桌面/390×844 各打开确认并取消，`business_post=0`。最终 RFQ DRAFT v1、Binding 0、Quote/Award/PO 0/0/0、Session 0，指纹始终为 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`。结论 `RFQ TRACEABILITY DEPLOYED — UAT RFQ STILL DRAFT`；必须另立任务先显式固定 Mapping，不能直接发出。

### SELFHOST-UAT-FIX-21 - `fix: add supplier mapping approval confirmation` / `ops: deploy supplier mapping approval safeguards`

- Git/范围：从 strict clean `main@2d0cf5f033cad724bf2215e77e4fda953a499cd4`、behind 0/ahead 140 起步；功能提交 `a86d9adceefb45efca1c43f1f8475703e8fa943d`。只修改 operations Supplier Mapping 审核预览、确认、意见、凭证、列表/UI及对应测试/只读运维脚本和项目文档；不批准或退回主 UAT 剩余七条，不重做既有 ACTIVE，不创建 RFQ，不 push/PR 或改写历史。
- 模型/版本：采用分支 A。0038 的不可变 `supplier_mapping_events.reason` 保存独立 APPROVE `review_comment`，Mapping.review_reason 继续只承载退回原因；APPROVED Event+同 request_id 成功 Audit 已具备 actor/time/result/status 与 CAS 前后，足以投影持久凭证。无 0039，不改 0001—0038，版本保持 alpha.39；历史空意见不回填，固定显示“历史批准未采集审核意见”。D-094 记录该决定。
- 服务/API：新增 operations 权限保护的 GET review-preview，以 repeatable-read/read-only 快照返回稳定 Mapping/Version/CAS、Supplier/Material 当前主表状态、Unit/换算/有效期、创建/提交 SUCCESS Event、Supplier part claim、ACTIVE 1:1 有效期冲突、可批准条件和批准后 RFQ/零下游语义；GET 成功和失败均零 Audit。APPROVE 只接受必填 `review_comment`，事务内重验权限、自审、引用、稳定占用、冲突、摘要、CAS、幂等和故障回滚，并返回完整成功凭证。
- UI：operations 列表新增状态、Mapping ID、Supplier/Material ID/编码/名称、supplier part 后缀筛选，展示 Version/CAS、当前来源状态、冲突和创建/提交/审核 provenance。批准按钮先打开确认窗；意见独立必填、默认焦点安全、取消/关闭/ESC 零请求、同步双击保护、确认前二次预览。成功/历史凭证在刷新、重登和 Web 重启后可重开；桌面和 390×844 无页面级横向溢出。
- 自动验证：Supplier Mapping Unit `6/6`、UI `5/5`、隔离 PostgreSQL `10/10`、0038 Migration `5/5`、隔离 Chromium `1/1`；Sourcing/FIX-19 PostgreSQL `5/5`、Identity PostgreSQL `10/10`，适用静态/UI、npm、CSRF/Origin 回归与 Python `3/3` 通过。typecheck、38/38 migration checksum/Schema consistency、production build/postbuild、credentials 和 diff check 通过；完整 lint 0 error/10 个既有 warning。隔离浏览器最终 8 Mapping/1 APPROVED/7 PENDING、单 APPROVE、下游 0、Session 0。
- 备份/恢复：predeploy custom dump `/var/backups/chenyida-erp/supplier-mapping-fix21-predeploy-20260805T031625Z.dump` 为 root:root 0600、2,227,987 bytes、SHA-256 `fb14cf1ba9220ca8eafd564eb673b62cacd5ac2db92bf928e8fec99222e77f71`；`pg_restore --list` 3,306 项，第二新空库恢复为 38/head 0038、225 表及同一完整保护指纹，恢复库已精确删除。
- 部署/保护：Web-only 从 `sha256:c1576bd2…` 替换为 `sha256:c98d3e8a…`，旧镜像以 `rollback-approval-safeguards-fix21-predeploy-20260805T031959Z` 保留；没有运行 Migration，PostgreSQL/Worker/Caddy 容器身份、Origin、端口与四卷不变。保护指纹在部署前、恢复库、部署后及主 UAT 前后始终为 `2562f52e82eebbede265e367a5e13e31aa13ab34b5fee16b279d074b10266cd8`。
- 主 UAT：只用 operations 登录。首次 runner 在任何预览打开前因卡片 Version 文案断言不符安全停止，finally 撤销 Session且指纹不变；收紧为实际完整 Version Fact 文案后只读复验通过：7 条待审、指定 PENDING 完整预览/意见/取消、唯一 ACTIVE 真实凭证及历史空意见、状态/后缀/Mapping ID、桌面/390px和安全退出。业务 POST 0，最终 1 ACTIVE / 7 PENDING / 0 REJECTED，Event CREATED/SUBMITTED/APPROVED 为 8/8/1，RFQ/Quote/Award/PO 0/0/0/0，Session 0。
- 结论：`SUPPLIER MAPPING APPROVAL SAFEGUARDS DEPLOYED — UAT 1 ACTIVE 7 PENDING`。剩余七条是否批准或退回必须另立明确任务；本任务立即停止，不创建 RFQ。

## 2026-08-04

### SELFHOST-OPS-OPERATIONS-BROWSER-VERIFICATION-14 - `fix: align identity verifier with login contract` / `fix: avoid rereading logout body after navigation` / `ops: verify operations UAT identity`

- Git/范围：从 strict clean `main@7864905`、Parent `7b95b13`、behind 0/ahead 137 起步；登录合同提交 `1dcfc5a7d93d5f4092d088cecd3cc7c6c744b8b9`，UAT 后竞态补丁 `82f29c9157ceea1602969f4301477a7b2d18aa61`。只修改离线 targeted browser verifier、合成测试、脚本入口和项目文档；不改 Identity 服务端合同、Web 运行代码、版本、Migration、镜像、Compose、Origin、端口或 Volume，不 push/PR/改写历史。
- 权威合同/修复：`POST /api/login` 的成功合同为 HTTP 200、`application/json`、`ok=true`、结构化 `user`、精确 username/role；`is_active`/`must_change_password` 返回时必须为 true/false，且无错误代码。页面还必须进入“经营工作台”，当前用户标签必须绑定响应 user、角色为 operations/运营，登录页和强制改密页必须消失。旧 verifier 的 `authenticated=true` 属于 `/api/session` 合同，已删除；只有 `authenticated=true` 而缺 `ok/user` 明确拒绝。
- 合成/回归：新 verifier 最终 8/8，覆盖最小合法合同、合法附加字段、`ok=false`、缺 user、错 username/role、must-change=true、inactive、仅 authenticated、错误码、HTML/错误 Content-Type、401/403/429/500、malformed JSON、成功响应但仍在登录页、强制改密页和正式 runner 接线。targeted recovery 5/5、legacy recovery 9/9、Identity unit/UI 9/9+10/10、npm 3/3、全仓 lint 0 error/10 既有 warning、1,205 文件 credentials scan、Node 静态检查、Python 三项和 diff check 通过。
- Chromium：首次 runner 调用在创建网络/Chromium/Session 前以 `TARGETED_BROWSER_MODULE_MISSING` fail closed；恢复精确 1.51.1 临时模块树后，唯一实际 Chromium 通过登录响应全部合同、精确 operations 身份、两次已认证工作台、当前用户标签/角色和 must-change=0，未点击任何业务入口。实际 logout 已由服务端以 `LOGOUT` 撤销，最终有效 Session 0。
- 未完成原因/补丁：页面 logout 成功后立即 `location.replace("/")`；runner 等待 click 导航完成后再读取已释放 response body，得到 `TARGETED_BROWSER_LOGOUT_JSON_INVALID`，因此匿名页、back、forward、refresh 和最终 protected DOM 断言未执行。后续补丁只校验 logout HTTP/Content-Type，并以页面成功消费 JSON 后呈现的匿名页、`/api/session` 和 history DOM 作为持久证据；按一次实际流程上限未重跑，不能把该补丁视为主 UAT 通过。
- 保护/清理：Canonical v2/v2.1 仍 10 账号、0 错误/PASS且字节/元数据不变；operations password/role/active/must-change/version 保持，其他身份保持，最终有效 Session 0。排除身份/系统表的业务指纹前后均为 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`（217 表/203 序列），Mapping/RFQ/Quote/Award `0/0/0/0`、PRQ ACCEPTED、Supplier 1/2 和 Material 533—536 保持，业务 POST 0。临时模块/Profile/evidence/容器/网络/测试目录和浏览器进程清零，Recovery-13 正式备份与四卷保留。
- 结论：`OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION STILL INCOMPLETE`。不允许从本任务开始 purchase 创建/提交八条 Mapping；补做 operations logout/history 仍需新授权，Mapping 业务本身也需独立明确授权。

### SELFHOST-OPS-TARGETED-OPERATIONS-IDENTITY-RECOVERY-13 - `feat: add targeted offline identity recovery` / `ops: activate operations UAT identity safely`

- Git/范围：从 strict clean `main@b7221a94375487a9656fff84f46dbabb95a5a26a`、behind 0/ahead 135 起步；功能提交 `7b95b13cd1e6c64d0f7fd4536e3456ca2a9d25db`。只新增 operations 单账号离线最终化 CLI/runner/测试并执行经授权的非生产 UAT 恢复；不改 alpha.39、0001—0038、镜像、角色/权限或业务代码，不 push/PR。
- 安全模式：精确绑定 operations、role/active/version、UUID run-id、确认短语、root、非生产数据库、0038、Web/Worker 停写和固定镜像；禁止通配/列表/其他账号/重复 run-id。密码由 CSPRNG 生成，只经匿名管道在内存中进入强哈希和 v2 候选；候选必须 root:root 0600、十账号、v2.1 PASS且只存在 password/must-change 两项差异。
- 事务/补偿：SERIALIZABLE 单事务锁定账号与 Migration，CAS 更新目标密码、must-change/version，撤销目标 Session并写唯一恢复审计/run marker；事务内证明其他账号非敏感/秘密指纹、其他 Session和业务指纹不变。Canonical 只在数据库提交后原子提升/fsync；保留候选补偿只复用同一 run-id/密码，禁止生成第二密码。
- 测试：targeted unit 5/5、legacy unit 9/9、隔离 PostgreSQL 4/4、适用 typecheck/lint、npm 3/3、1,202 文件 credentials scan 和 diff check 通过。覆盖单目标十一身份、强哈希、Session/审计、重复 run、错误目标/role/version/database/Migration/service、候选/数据库/提升故障、事务零半记录和浏览器失败清理。
- 备份：正式 prewrite dump root:root 0600、2,212,808 bytes、SHA-256 `9b18cb329dfe8775b03f5288a900b31f0ebb7d5d6599c91d1a40a6a8605269cd`；`pg_restore --list` 3,321 项，第二空库 38/head 0038、225 表、身份计数、FIX-20 指纹和业务零事实恢复一致。恢复库已删，备份保留。
- 正式结果：run-id `e0fec2fb-3894-4a19-93af-79eb85d9dfd4` 只把 operations must-change `true→false`、version `6→7`；username/role/active、其他十个受控账号、其他全部账号/Session 与业务表保持。恢复事务既有 Session 撤销 0、恢复审计恰好 1；Canonical 10 账号/0 错误/PASS、root:root 0600且与数据库秘密一致，候选消失。
- 浏览器：attempt-1 在登录前因未预置临时 Playwright 模块 fail closed并清理 0 Session；固定版本模块断网启停自检后唯一 attempt-2 实际产生 LOGIN success，但 verifier 错误要求 `/api/login` 响应含 `authenticated` 而报失败，随后 best-effort Session 检查产生 LOGOUT success。最终有效 Session 0；按两次上限不修复后重跑，页面 must-change/角色与 back/forward/refresh 未完成。
- 业务/服务/结论：排除身份/系统表的业务指纹前后均为 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`；Mapping/RFQ/Quote/Award `0/0/0/0`，PRQ、Supplier 1/2、Material 533—536 和全部下游不变。原 Web/Worker 恢复，四服务 restart 0/OOM false；临时库/容器/网络/Profile/候选/模块清零，四卷保留。结论 `OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION INCOMPLETE`；本任务不放行八条 Mapping。

### SELFHOST-OPS-CANONICAL-SCHEMA-RECONCILIATION-12 - `fix: diagnose canonical credential schema safely`

- Git/范围：从 strict clean `main@2f2a62b81622afd708538da5f9cfd9afc835dda6`、Parent `1e9221d90db621becc2badf40b3e0ed3017b73e6`、behind 0/ahead 134 起步；只修改离线恢复 Canonical Schema/解析验证边界、脱敏诊断 CLI、合成测试和项目文档。不访问 PostgreSQL、正式 API、浏览器、身份或业务数据，不改 Migration、版本、镜像、Compose 或部署。
- 根因 A：正式 v2 是有效 JSON、固定十账号且除三项外全部严格约束通过；旧 validator 仅在 engineering/planning/purchase 的 `/must_change_password` 上以 `const` 拒绝 boolean。恢复 writer 的初始全 true 被错误当成 Canonical 生命周期永久值；后续受控 UAT 已证明三个当前 false 状态有效，故不是 C/D 类文件或账号损坏。
- 修复：`chenyida-erp-uat-credentials-v2` 把必需 `must_change_password` 定义为严格 boolean；密码策略、唯一密码、固定账号/角色/顺序、字段集合、run-id 和顶层格式不变。恢复 writer、Stage、提升、保留 Stage 恢复和最终化改用独立强校验，继续只接受初始全 true，不能以长期 Schema 绕过恢复门禁。
- 安全诊断：新增 `offline-identity-recovery-uat-validator-v2.1` 的 `--diagnose-schema`。固定正式/演练路径、root/deployment class/run-id，使用 root-only 文件句柄、`O_NOFOLLOW`、0600/nlink1 与大小上限，在构建 PostgreSQL Pool 前结束；只输出脱敏 Pointer/关键字/类型/白名单账号角色/计数，密码和秘密类字段固定 `<redacted>`，异常不输出正文或环境材料。
- 文件/正式复验：`/etc/chenyida-erp/uat-role-accounts.txt` 全程只读，size/inode/mtime/owner/mode/nlink 与起点一致，没有候选或副本；最终 Schema 为账号 10、错误 0、PASS。密码、角色、顺序、must-change 和全部账号语义字节保持。
- 测试：离线恢复 unit 9/9 覆盖必需字段、类型、多余字段、重复用户名、非法角色、密码错误、must-change、顶层版本、恶意注释、malformed JSON 和 CLI 数据库隔离/泄漏路径；npm 3/3、Python compile/self-test/smoke/go-live、lint 0 error/10 既有 warning、1,194 文件 credentials scan 和 diff check 通过。绝对禁止 PostgreSQL，故不运行 PG 集成测试。
- 资源/结论：available memory 约 2.2→2.2 GiB、Swap 258→258 MiB、根盘 20→20 GiB、Load `0.01/0.23/0.28`→`0.45/0.46/0.47`；内核 OOM 0、四服务 RestartCount 0/OOM false。全部测试断网、只读、限额且串行；任务容器/Python 目录和 Canonical 临时材料清零，服务未重启，四卷不变。结论 `CANONICAL VALIDATOR FIXED — FILE UNCHANGED`；operations 首次改密可在新的明确授权 Identity 任务重试，本任务不登录 operations、不开始 Mapping。

### SELFHOST-UAT-FIX-20 - `feat: add governed supplier material mappings` / `fix: resolve legacy material units for supplier mappings` / `ops: deploy supplier mapping governance`

- Git/范围：从 strict clean `main@2cdbc43d1293b6f13bf5bba1e140ec6808b05dd5`、Parent `23d654c383015864be9a2ade71e78d94eb77adaf`、behind 0/ahead 131 起步；功能提交 `ddab02a57e0e87255c7a35d125959ac750b108e1`，legacy Unit 兼容修复 `1e9221d90db621becc2badf40b3e0ed3017b73e6`。没有改写 0001—0037、历史或未知文件，不 push/PR/amend/rebase/reset/stash/restore。
- 模型/Migration：诊断确认既有 `supplier_mappings` 是导入、采购、收货和 RFQ 共用权威，但缺少 DRAFT/PENDING_REVIEW/REJECTED、跨版本稳定 ID、提交/审核事实和不可变 Event，故采用分支 B。唯一新增 `0038_supplier_mapping_governance.sql`（SHA-256 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`），扩展稳定身份/版本、provenance、Event、Supplier part claim、partial unique/GIST exclusion/guard，版本升级为 alpha.39。
- 权限/生命周期：purchase 仅获 `supplier_mapping.read/create/edit_draft/submit`，operations 仅获 `read/review_queue/approve/reject`，engineering 保持只读；创建人自审、purchase 审核和 operations 正文编辑均由服务端禁止。DRAFT→PENDING_REVIEW→ACTIVE/REJECTED，提交后冻结、退回原因必填、ACTIVE 不原改，替代版本与 Event/Audit/Idempotency 同事务固化。
- 页面/RFQ：新增 purchase 维护页和 operations 只读审核页，提供稳定 ID、编码优先有界搜索、筛选、完整版本/单位/换算/有效期/provenance/request_id 事实和 390px 布局。RFQ page/create/issue 共用当前有效 1:1 Mapping coverage；逐 Supplier 显示 x/y 与缺失 Material，0/4 或部分覆盖禁选，伪造请求以 `SUPPLIER_MAPPING_INCOMPLETE` fail closed，4/4 才允许 DRAFT。
- legacy Unit 修复：主 UAT 暴露 Material 533—536 为既有 `base_unit_id=NULL`、`base_uom=PCS`。复用 BOM 治理规则，优先关系化 Unit ID，否则仅把 base_uom 精确匹配唯一 enabled Unit.code；无匹配继续失败关闭，不回填主库、不新增 0039、不修改已应用 0038。
- 测试：Supplier Mapping Unit/UI 最终 12/12、PostgreSQL 8/8、Migration 5/5；sourcing/FIX-19 5/5、master 6/6、跨域 PostgreSQL 42/42、适用静态/UI 87/87、npm 3/3、Python 3/3，typecheck、production build/postbuild consistency、lint 0 error/10 既有 warning、credentials 和 diff check 通过。隔离 Chromium 完成 8 Mapping 创建/提交/异人批准、两家 4/4、RFQ DRAFT 1，Quote/Award/PO 0，桌面/390×844和退出失效通过。
- 备份/部署：predeploy custom dump 为 root:root 0600、2,189,463 bytes、SHA-256 `2d1fe44fd42c7a7281fd50d0d7d20144228ee4b26f62c2fe6c93e2df24dcb96c`；容器内 list 3,285 项，第二空库 0037 恢复、0037→0038、重复 runner 和保护事实通过。停 Web/Worker并确认应用连接 0 后串行应用 0038，再替换 Web/恢复 Worker；Unit 修复只做 Web-only 替换。最终 Web `sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`，PostgreSQL/Caddy/四卷未更换，精确回退 tag 保留。
- 主 UAT/结论：purchase 只读验收入口、Material 搜索、两家 0/4、各缺 533—536、不可勾选、桌面/390px与安全退出通过，business POST 0。operations Canonical/数据库账号既有 `must_change_password=true`，runner 在登录前安全停止；未改凭据或绕过身份。前后业务指纹均为 `8ad0c2e19863808ed9fed62b0da8f5ef4e78bbaf586fe1be146a286bcf3f0ce0`，Mapping/RFQ/Quote/Award/PO/全部下游仍 0，历史失败请求保留。
- 资源/停止：available memory 约 2.2→2.2 GiB、Swap 265→263 MiB（峰值约 301）、根盘约 20 GiB、Load `0.20/0.11/0.09`→`0.37/0.38/0.38`；内核 OOM 0、四服务 RestartCount 0/OOM false，临时库/容器/目录清零，未 prune。结论 `SUPPLIER MAPPING GOVERNANCE DEPLOYED — MAIN UAT NOT VERIFIED`；operations 身份阻断解除并获新授权前不开始八条主 UAT Mapping。

### SELFHOST-UAT-FIX-19 - `fix: bind rfq draft to stable purchase request id` / `ops: accept rfq draft binding fix`

- Git/范围：从 strict clean `main@5a7cb547a07b1e113d89c51366fc099d851fe1cb`、Parent `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`、behind 0/ahead 129 起步；功能提交 `23d654c383015864be9a2ade71e78d94eb77adaf`。只修改 RFQ create 稳定 ID/DTO/幂等边界、响应式 CSS、测试、保护/UAT runner 和项目文档；不新增 0038、不改 0001—0037/alpha.38，不 push/PR 或改写历史。
- 根因/DTO：PostgreSQL bigint Purchase Request ID 为字符串 `"1"`，旧 UI 用 `row.id === Number(formValue)` 比较，导致 request 未命中；FormData 的稳定 value 正确，但 JSON 最终只剩 `supplier_ids` 和 `response_deadline`。没有字段名不一致、闭包/表单重置或按 PRQ/项目标签反查。原残缺幂等摘要与失败 request_id/审计只读保留。
- 修复：PRQ/Supplier option 只保存稳定数据库 ID；UI 请求边界一次 canonical decimal→safe positive integer，Supplier 验证、去重和数值排序。Handler 与 Service 复用同一四字段规范函数，并只以规范化后的 PR ID、Supplier IDs、日期和 expected_version 计算幂等摘要；既有权限、状态、Mapping、四行来源、Round 唯一、CAS、CSRF、Origin、事务和失败审计门禁未放宽。
- 测试：RFQ unit/UI 6/6+4/4、PostgreSQL 5/5、隔离 Chromium 1/1；适用静态/UI 68/68+环境守卫 6/6、Schema 4/4、sourcing upgrade 3/3、Material Requirement 8/8、Master/Supplier/BOM 6/6、Mapping 6/6、Inventory 3/3、Identity/CSRF/Origin/CAS/Idempotency 10/10、`npm test` 3/3、Python 3/3。typecheck、production build、最终 lint 0 error/10 既有 warning、1,166 文件凭据扫描和 diff check 通过。
- 隔离旅程：合成 PR ID 1、四条 Material 533—536 各 10 PCS、Supplier 1/2 创建唯一 DRAFT；四行和两邀请精确绑定，规范等价重放返回同 RFQ、异正文冲突、并发单胜、非 ACCEPTED/不存在/越权/无效 Supplier 拒绝，故障注入零半记录。Quote/Award/PO/Receipt/Ledger/AP/Work Order 全为 0。
- 备份/部署：root:root 0600 custom dump 2,188,178 bytes、SHA-256 `55e169b4ad372391117aea6c042aa1ec3d87a9e85e01dbbba1456b9f9ecc3a28`，list 3,285 项及第二空库 37/head 0037/checksum/身份计数/完整指纹恢复通过。使用 `--no-deps --no-build` 只替换 Web `sha256:6eeba640…→sha256:6622029f…`；PostgreSQL/Worker/Caddy、Migration、Origin、端口和四卷不变，restart 0/OOM false。
- 主 UAT：只用 `uat_20260729_purchase` 直接打开采购寻源页，确认唯一 PRQ value 1、Supplier value 集合 1/2、四行/40 PCS 和合法未提交表单，桌面/390×844 通过后清空并退出。最终 business POST 0、Session revoked；RFQ/Quote/Award 前后 `0/0/0`，正式保护指纹始终为 `fc48f001fe3b0afaff69ac245a1fefc8bf6731d38358004314cc12daa308cff4`。
- 资源/结论：起点约 2.2 GiB available/258 MiB Swap/21 GiB，终点约 2.2 GiB/266 MiB/20 GiB/Load `0.19/0.22/0.45`；内核 OOM 0、四服务 RestartCount 0/OOM false。任务生成树曾使两个临时 Node lint 进程 V8 heap exhaustion，精确清理后完整 lint 通过；临时库/恢复库/容器/Playwright/Python/SQLite 路径清零，正式备份、镜像和四卷保留，未 prune。结论：`RFQ PURCHASE REQUEST ID BINDING FIXED — UAT RFQ NOT CREATED`；可以在新的明确授权任务中从单个 RFQ 草稿重新开始黑盒试用，本任务停止。

### SELFHOST-UAT-FIX-18 - `fix: expose purchase acceptance history` / `ops: accept purchase history traceability`

- Git/范围：从 strict clean `main@eff3df28e1781f13dc5a529f13e83e621bda5a28`、Parent `13da8a14d037d279278ef8c8ea86e52d79552512`、behind 0/ahead 127 起步；功能提交 `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`。只修改 Purchase Request 详情读模型、历史/即时凭证 UI、相关测试、保护/UAT runner 和项目文档；不新增 0038、不改 0001—0037/alpha.38，不 push/PR 或改写历史。
- 权威合同：Purchase ACCEPT/RETURN 只读取同时绑定当前 Plan+PRQ 的不可变 `planning_material_requirement_events`；稳定 PRQ ID/状态分别读取 PRQ 表，Plan 状态读取 Plan 表。Event actor/time/request_id 必须与 PRQ accepted/returned 字段一致，计数必须与终态一致；不从 Session、页面/队列状态或 Audit 推断，缺失/重复/矛盾返回 `409 PURCHASE_REQUEST_CONFIRMATION_INCOMPLETE`。
- SUCCESS/Plan 语义：决策 Event、PRQ/Plan 转换、成功 Audit 和 Idempotency 同事务提交，独立读取只看到已提交 Event，故读模型可精确投影 `SUCCESS`；不伪造失败 Event。主 Plan 属于分支 A，Purchase ACCEPT 使 Plan 与 PRQ 各自转为 ACCEPTED；页面标注“采购交接状态”，明确 v1 计算快照/行/分配/来源摘要仍不可变。D-090 正式记录该语义。
- UI：已处理详情新增独立“采购决策凭证”，显示 Purchase Request ID、PRQ、决策/中文、Event 类型、Actor、Asia/Shanghai 时间、显式 SUCCESS、独立 1/0 与可复制 request_id，并与 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 分区。即时成功后重新 GET 权威 Event，不再以当前用户或占位值拼接；终态无接收/退回/编辑控件，桌面和 390×844 无页面横向溢出。
- 测试：FIX-18 unit/UI 10/10、PostgreSQL 8/8、隔离 Chromium 1/1、适用静态/UI 63/63、跨域 PostgreSQL 34/34、Schema/Migration 7/7、`npm test` 3/3、Python 3/3；typecheck、production/Docker build、lint 0 error/10 warning、1,159 文件凭据扫描和 diff check 通过。覆盖 0/0→1/0、持久 actor/time/request、幂等/并发/CAS、诱饵/权限、零查询写、Web 重启/刷新/重新登录、复制、退出历史保护和零自动下游。
- 备份/部署：root:root 0600 custom dump 2,186,157 bytes、SHA-256 `3041980fa1d79e489360bdeacacfe15ee4686673334ee7b8158cea3ca6b7247a`，list 3,285 项及第二空库 37/head 0037/checksum/身份计数/完整指纹恢复通过。使用 `--no-deps --no-build` 只替换 Web `sha256:97dcabe8…→sha256:6eeba640…`；PostgreSQL/Worker/Caddy、Migration、Origin、端口和四卷不变，restart 0/OOM false。
- 主 UAT：只用 `uat_20260729_purchase` 打开目标已处理 PRQ；完整 ACCEPT/SUCCESS/1/0、Plan/PRQ 状态、三段上游、四行 10 PCS、九项供应 0、复制、刷新、桌面/390px 和退出历史保护通过。最终 runner 为 business POST 0、其他对象 GET 0、Session revoked。正式保护指纹在主库、恢复库和全部 UAT 前后均为 `814811509c476e270f9cd82badb85aa8bb1bf8e1f01e8bb72b4cd9fec9c9a4ff`，没有重复决定或下游写。
- 资源/结论：起点约 2.2 GiB available/309 MiB Swap/21 GiB，终点约 2.1 GiB/257 MiB/21 GiB/Load `0.16/0.33/0.34`；内核 OOM 0、四服务 RestartCount 0/OOM false。临时库/容器/网络/Playwright/Python/SQLite/build 路径清零，正式备份、镜像和四卷保留，未 prune。结论：`PURCHASE ACCEPTANCE HISTORY FIXED — UAT ACCEPTANCE VERIFIED`；已具备寻源/询价业务前置条件，但实际 RFQ/下游写须另立授权任务，本任务停止。

## 2026-08-03

### SELFHOST-UAT-FIX-17 - `fix: complete purchase acceptance confirmation` / `ops: accept purchase confirmation fix`

- Git/范围：从 strict clean `main@af7496babe8b704d04b22ad33bbb98a270519529`、Parent `ce3f14a0c989875e7527e42136967f9efe6ee548`、behind 0/ahead 125 起步；功能提交 `13da8a14d037d279278ef8c8ea86e52d79552512`。只修改 Purchase Request 确认读取/展示、对应测试、保护/UAT runner 和项目文档；不新增 0038、不改 0001—0037/alpha.38，不 push/PR 或改写历史。
- 权威合同：Package ACCEPT、Plan GENERATE、PRQ SUBMIT 直接读取精确 Package/Project、Plan、Plan+PRQ 的不可变 Event，返回 action/type/actor/timezone/request_id/result；Purchase ACCEPT/RETURN 直接按当前 Plan+PRQ 的真实不可变 Event 计数。九项当前供应复用 FIX-16 的 MAIN Inventory/有效 Planning Allocation/有效 PO 与 Delivery Plan 投影；没有从状态、队列或无关 Audit 推断，也没有第二权威模型。
- 失败关闭/零写：详情在现有认证、purchase capability、对象范围之后使用单一 repeatable-read/read-only 事务；关键 Event、摘要/行、计数、观察时间或九项供应缺失即 `409 PURCHASE_REQUEST_CONFIRMATION_INCOMPLETE`，客户端确认保持禁用。读取不写业务、Audit、Idempotency、Inventory 或 Allocation；接收 POST 的 Origin、Cookie/Header CSRF、CAS、持久幂等、事务和状态门禁未放宽。
- UI：接收前显示“正在重新读取当前供应”和安全取消焦点；完整后显示刷新时间、PRQ/项目/日期/状态、Package 2/v2 摘要与 ACCEPT、Plan 1/v1 计算/快照与 GENERATE、PRQ SUBMIT、显式 0/0、四 Material 七项固定量与九项当前供应、公式/边界/接收后果。取消/关闭/ESC 零业务写，桌面和 390×844 无页面级横向溢出。
- 测试：FIX-17 unit/UI 10/10、适用静态/UI 62/62、FIX-17 PostgreSQL 8/8、跨域 PostgreSQL 34/34、隔离 Chromium 1/1、0037 Schema/Migration 4/4、`npm test` 3/3、CSRF/Origin 11/11、Python 3/3；typecheck、production/Docker build、lint 0 error/10 warning、1,155 文件凭据扫描和 diff check 通过。覆盖 12−2−1=9、库存 Allocation 3→未分配 6、在途 8/Allocation 2→未分配 6、重新打开新值、权限/诱饵、零查询写、单 ACCEPT、幂等/CAS/并发/故障零半记录和零下游。
- 备份/部署：root:root 0600 custom dump 2,185,361 bytes、SHA-256 `896b92493480fe3aa08d3b84600e1804df60794108c776ef29aabee2fce0e8e8`，list 3,285 项和第二空库 37/head 0037/checksum/身份非敏感计数/保护指纹恢复通过。只替换 Web `sha256:d7ced686…→sha256:97dcabe8…`；PostgreSQL/Worker/Caddy、Migration、Origin、端口和四卷不变，restart 0/OOM false。
- 主 UAT/安全停止：只用 purchase 登录；确认队列 1/0、详情 ACCEPT/RETURN 0/0、加载窗和安全焦点，并唯一一次打开确认窗。runner 因“状态”标签同时匹配 PRQ 与 Package 而中止；未确认/退回、未重跑、未创建下游，最新任务 Session 为 `LOGOUT`。保护指纹在部署前、恢复库、UAT 前后均为 `e80ed1795079a3467ba4f05e2751fd8a9575e1b441b2433b371651479ca2cab0`，PRQ 仍待接收、四项九供应/Inventory/Allocation/全部下游不变。
- 资源/结论：起点约 2.1 GiB available/302 MiB Swap/21 GiB，终点约 2.2 GiB/304 MiB/21 GiB/Load `0.24/0.32/0.27`；内核 OOM 0、四服务 restart 0/OOM false。FIX-17 临时库/容器/网络/模块/SQLite 路径清零，正式备份、当前/候选/回退镜像和四卷保留，未 prune。结论：`PURCHASE DECISION CONFIRMATION FIXED — MAIN UAT NOT VERIFIED`；完成后停止，不接收/退回主 PRQ，不开始 RFQ。

### SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16 - `fix: expose purchase current supply breakdown` / `ops: accept purchase supply review fix`

- Git/范围：从 strict clean `main@231813f4cbb7db364a26fba5d358d76e06c69604`、Parent `22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`、behind 0/ahead 123 起步；只修改 Purchase Request 当前供应只读投影、GET 失败审计边界、Purchase UI/CSS、测试、只读 UAT runner 和项目文档。功能提交 `ce3f14a0c989875e7527e42136967f9efe6ee548`；不新增 0038、不修改 0001—0037或 alpha.38，不 push/PR 或改写历史，不读取/修改 `shujvbiao/`。
- 当前库存：服务端在已授权 PRQ 的精确 Material+Unit 行集内，以 repeatable-read/read-only 事务一次聚合 `location_code='MAIN'` 的全部无批次与 Lot 位置。`库存可用 = Σ在手 - ΣInventory 正式预留 - Σ品质冻结`；有效计划的库存 Allocation 仅含 SUBMITTED/ACCEPTED Plan，并与 `reserved_qty` 独立；`未分配库存可用 = max(库存可用 - 有效计划库存分配, 0)`。当前模型无多仓库和“其他不可用”独立数量，页面诚实标注而不造字段。
- 当前在途：PO 头/行只含 OPEN/PARTIALLY_RECEIVED 且在需求截止日内的剩余量；有 Delivery Plan 时只含 PENDING/PARTIAL 的 `planned-received`，否则使用 PO `order-received`。完成、取消、关闭、已收货部分及超期来源排除；在途 Allocation 还必须引用当前有效 PO Line，取消/完成来源的历史 Allocation 不抵扣其他在途。`未分配在途可用 = max(有效在途 - 有效计划在途分配, 0)`；模型未单列“已到货但未入库”，响应不伪造该数量。
- 页面/确认：每个 Material 明确分为“1. 提交时快照 / 2. 当前供应状态 / 3. 差异提示”，显示快照截止、当前查询时间、九项当前数量和真实公式；差异只提示正式退回/调整，不修改固化快照或 PRQ。接收按钮在打开确认前重新 GET，窗口显示四条 PRQ、当前在手/预留/有效在途、未分配库存/在途与差异，并明确接收不改库存、不自动创建 RFQ/PO；原 POST 的状态、CAS、幂等和事务门禁未改。390×844 卡片、折叠公式、数量不逐字符拆分且无页面级横向溢出。
- 权限/零写：先完成既有 purchase 对象范围授权，再查询该 PRQ 行 Material；诱饵 PRQ 403，不能枚举全部库存、Lot、供应商或项目。响应不含供应商价格/下游明细，未授予 Inventory/Ledger 写或 `system.audit.read`。GET 失败不再写 Audit，授权/正常查询及确认刷新均对 Inventory、Allocation、Audit 和下游零业务写入。
- 测试：定向 unit/UI 10/10、静态及 Inventory/Procurement/Planning/Identity/CSRF/Origin 回归 78/78、当前供应 PostgreSQL 6/6、跨域 PostgreSQL 32/32、隔离 Chromium 1/1、`npm test` 3/3 与 Python self-test/smoke/隔离 go-live 3/3 全部通过；另有 typecheck、alpha.38 production build、lint 0 error/10 warning、凭据扫描和 diff check。覆盖 0/正数库存、正式预留、冻结、多 Lot 守恒、Allocation 分离、有效/部分收货/完成/取消在途、在途分配、快照差异不改 PRQ、诱饵 403/零 Audit 及 390px 接收确认。
- 备份/恢复：pre-deploy custom dump `/var/backups/chenyida-erp/purchase-supply-breakdown-fix16-predeploy-20260803T080434Z.dump` 为 root:root 0600、2,185,039 bytes、SHA-256 `43f4e4620e51c5b2ee5876e13556907e38817399dd0eac0fedd2320bc95c75c6`；`pg_restore --list` 3,285 项通过，第二新空库恢复为 37/head 0037/checksum。正式部署指纹在主库部署前、恢复库和主 UAT 后均为业务 `cc6a9d4f4350b6aa2846a9f681e6f47c451ba8bdf5f49c6a42848885633f6d66`、供应 `c93374feeeb48fe1a978bfb6e844cdf3f32b9fab26477e022956932364d9efb1`，恢复库已删除。
- 部署/主 UAT：只替换 Web `sha256:d5c514ab8ef497c702ef5c16c69da4d58c5ce849b96d09fa781fa679963c29dc→sha256:d7ced686803c1f5f71ec101ebe28e3080005d534480dd39bfc8a91913ef12a5d` 并保留精确回退 tag；PostgreSQL、Worker、Caddy 未重建，0037 与四卷保持。purchase-only 390×844 只读 runner 分别核对 Material 533—536 的九项当前供应全部 0 PCS，确认窗口重新 GET 后取消并安全退出；浏览器业务 POST 0、ACCEPT/RETURN 0、Inventory/Allocation 与全部下游不变。
- 数据/资源：最终 `PRQ-00000001`/Plan 1/v1 仍 SUBMITTED，Package 2/v2 仍 ACCEPTED，四条仍各 10 PCS；Allocation 与 RFQ/Quote/Award/PO/Delivery Plan/Receipt/Ledger/AP/Work Order 均为 0。起点/终点 available memory 均约 2.3 GiB，Swap 295→303 MiB，根盘 22→21 GiB，最终 Load `0.19/0.20/0.29`；内核 OOM 0、四服务 restart 0/OOM false。FIX-16 临时库/容器/Volume/`/tmp` 路径均清零，四个受保护 Volume、正式备份和当前/回退镜像保留，未 prune。
- 结论：`PURCHASE SUPPLY BREAKDOWN FIXED — UAT PRQ STILL PENDING`。立即停止，不接收或退回主 PRQ，不修改库存/分配，不创建 RFQ 或任何下游单据。

### SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15 - `fix: expose purchase request traceability` / `ops: accept purchase review traceability fix`

- Git/范围：从 strict clean `main@977fa3d942a5af830ec36981a1a3cb3e9adcc8cc`、behind 0/ahead 121 起步；只修改 Purchase Request 关系化详情投影、对象范围授权、Planning/Purchase UI/CSS、测试、只读 UAT runner 和项目文档。功能提交 `22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`；未 push/PR 或改写历史，未读取/修改 `shujvbiao/`，未提交凭据、连接信息、数据库或备份正文。
- 数据/API：不新增 0038、不修改 0001—0037、不改 alpha.38。PRQ 详情在 repeatable-read/read-only 事务中复用 Package Snapshot/ACCEPT Event、Material Requirement Plan/Line/Allocation、PRQ/Line 与精确 PRQ SUBMIT Event，返回 Package→Plan→PRQ 完整 DTO；先做对象范围判断，再读取源对象 Event，不开放全局 Audit。purchase 可读待处理与本人已处理记录，其他 purchase 已处理诱饵为 403；未增加 `system.audit.read`。
- 快照/诚实状态：四行显示稳定 Material ID/内部编码/名称/单位、毛需求、提交时库存可用与分配、提交时在途可用与分配、净采购和 PRQ 申请量；当前库存/供应另栏计算，不覆盖提交快照。Plan/PRQ 无说明显示“未采集”，PRQ 明确未单独业务版本化；供应商、价格、接收人和时限不伪造。非零净采购与零 PRQ 的矛盾文案已按关系事实修正。
- UI/确认：详情显示 Package 2/v2/ACCEPTED/完整摘要、A0/V1/Unit Resolution v1、ACCEPT/GENERATE/SUBMIT actor/Asia/Shanghai/request_id/SUCCESS、Plan ID/v1、PRQ ID/来源与 40 PCS。接收/退回均先确认；默认取消焦点、焦点约束、取消/关闭/背景/ESC 零业务请求、同步 ref 防双击、提交中禁用。接收后果明确“进入寻源、询价和报价比较；接收本身不创建 RFQ/定标/PO/收货/AP”，退回保持原计划快照。390px 卡片无页面横向溢出，PCS 不逐字符拆分。
- 测试：分组执行 47/47 定向 unit/UI/安全/CSRF/Origin/Planning/Inventory/Procurement/Identity、Material PostgreSQL 5/5、跨域 PostgreSQL 32/32、跨域 UI 31/31、最终 Material unit/UI 10/10 与最终候选隔离 Chromium 1/1；另有 typecheck、alpha.38 production build、lint 0 error/10 warning、仓库凭据扫描、diff check 和 Python 三项 3/3。隔离浏览器验证三类接收取消、退回取消、双击单事件、已处理凭证、CAS/幂等及零下游。
- 备份/恢复：pre-deploy custom dump `/var/backups/chenyida-erp/purchase-request-traceability-fix15-predeploy-20260803T030456Z.dump` 为 root:root 0600、2,184,317 bytes、SHA-256 `b1fbf44297b52e151b597d9c9f31a3297e6ee25c73d02ba6e4429a07aba853bb`；容器内 `pg_restore --list` 3,285 项通过，第二新空库的 37/head 0037/checksum、Package/Plan/PRQ/Event、四行和全部下游计数与主库一致，恢复库已删除。
- 部署/主 UAT：只替换 Web `sha256:a6327f593a6d084c609127e1bdb09e60b2bd07ff6a2c85213b36f1315c622a78→sha256:d5c514ab8ef497c702ef5c16c69da4d58c5ce849b96d09fa781fa679963c29dc`；PostgreSQL、Worker、Caddy 未重建，四卷不变。主 UAT 仅用 purchase 在 390×844 打开详情、展开四行、打开接收确认并取消；最终浏览器业务 POST 0、ACCEPT/RETURN 0、下游 0，当前 Session 正常 LOGOUT。两次前置 runner locator 二义均在详情断言阶段安全停止且指纹不变，收窄断言后完整通过。
- 数据/资源：主 UAT 业务指纹前后均为 `c3c1cfbecee7dcb2199bacc6425dcc02d875cb546049eacc5982ca4a6eb22fca`；`PRQ-00000001` 与 Plan v1 仍 SUBMITTED，Package 2/v2 仍 ACCEPTED，四行仍各 10 PCS，PRQ 1、Purchase ACCEPT/RETURN 与全部下游 0。起点/终点约 2.2→2.3 GiB available、Swap 270→289 MiB、根盘 22 GiB、低 Load，内核 OOM 0、四服务 restart 0/OOM false；临时库/容器/Volume/venv/SQLite 精确清理，正式备份与候选/回退镜像保留，未 prune。
- 结论：`PURCHASE REQUEST TRACEABILITY FIXED — UAT PRQ STILL PENDING`。立即停止，不接收或退回主 UAT PRQ，不创建 RFQ 或任何下游单据。

## 2026-08-02

### SELFHOST-OPS-UAT-PLANNING-HANDOFF-CONFIRMATIONS-FIX-14 - `fix: complete planning handoff confirmations` / `ops: accept handoff confirmation fix`

- Git/范围：从 strict clean `main@9c2a7ea436e9b8b5e95ad8eb82e52a43090b109a`、behind 0/ahead 119 起步；只修改 Planning Handoff 确认界面、前端提交保护、测试、只读主 UAT runner 和项目文档。功能提交 `f19a91b680a58150378626d4800e9fb0af12f484`；未 push/PR、改写历史、读取/修改 `shujvbiao/`，未修改 Package、Event、业务数据、Schema、Migration、package 或版本。
- ACCEPT 确认：窗口内完整显示 PRJ-00000001、目标 Package 2/v2/SUBMITTED/摘要/提交人/RESUBMIT 时间、前驱 1/v1/RETURNED/RETURN Event 2/操作者/上海时间/请求号/完整原因、Response 1/v1/操作者/时间/请求号/完整正文，以及 A0/V1/Unit Resolution v1/件·PCS/四项 10 PCS 不可变 v2 快照。后果明确为单 ACCEPT、v2 ACCEPTED、v1 继续 RETURNED、终态不可重复，以及不创建采购申请/工单/库存/财务。
- RESUBMIT 确认：窗口内显示项目、源 v1、RETURN Event/原因、Engineering Response、目标 v2、Product/BOM/Unit Resolution、四项物料与数量、提交后进入计划部待接收队列且不自动创建下游单据；仅在隔离环境执行写验收，主 v2 未重放。
- 流程依据：沿用 D-059 的“ACCEPT 只形成交接事实、不自动启动下阶段”和 D-060/TASK03 的“最新 ACCEPTED Package 供计划部门做物料需求计算/缺料分析，再经独立操作形成采购需求交接”。确认窗同时明确当前无具体处理人、无时限、接收本身不自动执行下一阶段；未新增 ADR。
- 交互/权限：共享可访问模态框默认焦点为取消，焦点约束、ESC/关闭/背景关闭等价取消，固定底栏与 390×844 换行/无页面横向溢出通过；同步 ref 防双击、按钮立即禁用、稳定 Package DTO/ID、无自动重试。服务端既有权限、CSRF、Origin、CAS、幂等、状态和对象范围门禁保持；越权 403、过期状态 409。未增加 `system.audit.read` 或业务权限，全局跨角色导航债务继续为 HIGH。
- 测试：Planning UI 12/12、Planning/Identity/CSRF/Origin 静态回归 35/35、Planning PostgreSQL 12/12、0037 Migration 4/4、Identity PostgreSQL 10/10、隔离 Chromium 1/1，共 74/74；另有 Python self-test/smoke/隔离 go-live 3/3、typecheck、production build 和 lint 0 error/10 既有 warning。隔离浏览器完成 RETURN→Response→v2，RESUBMIT 与 ACCEPT 各自取消/关闭/ESC 零业务请求后双击确认，最终各只有一个事件；v1 RETURNED、无下游记录。
- 备份/恢复：pre-deploy custom dump `/var/backups/chenyida-erp/handoff-confirmation-fix-20260802T1510Z.dump` 为 root:root 0600、2,179,303 bytes、SHA-256 `518bf47f797ff2e4817458b5c7e5e4090b0f8aaf77519c80c5c1598e9690efee`；标准 `pg_restore --list` 3285 项与第二新空库恢复通过，恢复库 37/head 0037/checksum、主 UAT 对象和业务指纹一致后已删除。
- 部署/主 UAT：只替换 Web `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25→sha256:a6327f593a6d084c609127e1bdb09e60b2bd07ff6a2c85213b36f1315c622a78`；PostgreSQL、Worker、Caddy 未重建，四服务 restart 0/OOM false。主 UAT 只用 planning 在 390×844 打开 Package 2/v2 ACCEPT 窗并取消，页面业务 POST 0、当前 Session 正常 LOGOUT；未登录 engineering。保护指纹前后均为 `5ddca35cab36890c20b88ecadc758a32bd60b87e2a136c477d8fde6c7e4538c2`，v1/v2 为 RETURNED/SUBMITTED，Response/RETURN/RESUBMIT/ACCEPT/v3 `1/1/1/0/0`，物料需求计划/采购需求 0。
- 资源/清理：全部重任务串行、一次一个临时容器；约 2.2 GiB available、Swap 252→258 MiB、根盘 22 GiB、低 Load，未触发门槛，内核 OOM 0。隔离数据库/恢复库、测试容器、候选提取目录和一次性 Python venv/SQLite 均精确清理；正式备份、当前/回退 Web 镜像与四个受保护 Volume 保留，未 prune。
- 结论：`HANDOFF DECISION CONFIRMATIONS FIXED — UAT V2 STILL SUBMITTED`。确认窗口阻断已解除，可在下一次明确授权后重新开始 planning 最终接收；本任务停止，不 ACCEPT、不创建物料需求。

### SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13 - `feat: add planning revision response lineage` / `ops: deploy planning revision workflow`

- Git/范围：从 strict clean `main@174181991c0bf51ee397627ea8fce546d1b64e68`、Parent `180f6b58b583bd2dba350f017504be916db9673d`、behind 0/ahead 117 起步；只实现 Planning RETURN 后工程回复、固定后继谱系、测试和项目文档，不读取/修改 `shujvbiao/`，不 push/PR 或改写历史。
- Schema/版本：0036 无完整合规模型，故唯一新增 `0037_project_planning_revision_response_lineage.sql`，升级 `0.1.0-alpha.38`；0001—0036 未修改。新增追加式 Response Version、每 RETURN 独立 CAS Head、Package previous/RETURN/Response 复合外键、唯一后继/单次消费、索引和不可变 SQL guard；既有 RETURNED v1 不回填或伪造回复。
- 服务/摘要：回复按 LF、Unicode NFC、trim 和 10—2000 字符保存并保留中文全角标点；权限/owner/责任队列、Origin/CSRF、限流、幂等、CAS、并发和故障回滚 fail closed。v2 原子复制 Product/BOM/Unit Resolution/Material/Document 固定快照并把源 Package、RETURN、精确 Response Version/正文摘要纳入 Package 摘要；Audit 不存完整正文。
- UI：RETURNED v1 显示完整退回事实、工程回复、Version/actor/time/request_id、固定复用和确认后果；未保存或脏回复禁用 v2。仅回复模式不渲染 Product/BOM/Unit 选择器；v2 显示 `v1 → Planning RETURN → Engineering Response → v2` 完整固定谱系。
- 测试：静态/安全回归 49/49、Planning PostgreSQL 12/12、Migration 4/4、隔离 Chromium 1/1，共 66/66；Planning typecheck、production build、lint 0 error 与 diff check 通过。覆盖文本、持久化、CAS/追加版本、幂等异正文、并发、权限、RETURN 归属、唯一后继、零半记录、SQL guard、固定回复/快照和 390px 完整接收旅程。
- Git：功能提交 `58e011db0c8d9045c3919c36c2c64f1655f050b6`；部署、只读验收、清理与完成文档由独立 `ops: deploy planning revision workflow` 收口。不 push/PR 或改写历史。
- 备份/恢复：root:root 0600 custom dump 2,140,261 bytes、SHA-256 `653b239b65f31a89b0a29281f8f68c1c0ab26d43df4cd936bb544b0d69bbad69`，list 通过；第二新空库恢复为 0036且保护指纹一致，另一真实恢复副本升级 0037 后 Response/Head/v2 0、指纹不变并完成第二次隔离 Chromium 旅程，临时库均删除。
- 部署：并行非生产 UAT 串行应用 0037，checksum `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`；只替换 Web `sha256:fb88dd8afb8b...→sha256:694a3190f517...`。Worker 保持 `sha256:32d1ae335610...`，PostgreSQL/Worker/Caddy 容器和四卷未重建，旧 Web 精确 rollback tag 保留。
- 主 UAT：engineering-only 网络白名单核验 login/logout 1/1、业务 POST 0、Response/v2 write 0、planning login 0；空回复输入、v2 禁用、Product/BOM/Unit selector 0、A0/V1/Unit Resolution v1/四条 10 PCS 与 390px 通过并退出。跨迁移保护指纹前后均 `a25be9c924bb2e7af54acd36c1c5f758e0caf0b2f4d8ccf426bf428aee41d739`；v1/RETURN/Response/v2 `1/1/0/0`，历史原因/Event 未改。
- 资源/清理：67 次自动执行、三项 Python 基线、typecheck/build/lint/credentials/diff 通过；起点约 2.1 GiB available/227 MiB Swap/22 GiB/低 Load，最终 2.1 GiB/240 MiB/22 GiB/Load `0.04/0.16/0.27`，内核 OOM 0、四服务 restart 0/OOM false。临时数据库、容器、app 提取、Playwright 与 Python 目录清零；正式备份、当前/候选/回滚 Web 和四个受保护卷保留，未 prune。
- 结论：`PLANNING REVISION RESPONSE DEPLOYED — UAT V1 UNCHANGED`。可在下一独立授权任务重新开始 engineering v2 黑盒试用；本轮停止，不填写回复、不生成/提交 v2、不登录 planning。

### SELFHOST-OPS-UAT-PLANNING-DECISION-HISTORY-FIX-12 - `fix: expose planning decision history` / `ops: accept planning decision history in parallel environment`

- Git/范围：从 strict clean `main@eaeae1c816256eb48355bdb117ecc20f6ac8545f`、behind 0/ahead 115 起步；功能提交 `180f6b58b583bd2dba350f017504be916db9673d`。只修改 Planning Handoff 服务投影、UI/CSS、测试和项目文档；未 push/PR、改写历史、访问生产或处理全局导航债务。
- Unicode/历史：预期全角标点与数据库 ASCII 标点先精确比较为不相同；仅 U+FF1A→U+003A 和 U+FF0C→U+002C 两处，分别 NFKC 后完全相同。原始文本经过全半角规范化，NFKC 语义核对 PASS；数据库实际原因保持权威，Package/RETURN Event 历史没有修改、补写或美化。登记 `LOW` 体验问题，不阻断链路。
- 服务/UI：Planning 新增待接收/已处理双视图；`PROCESSED` 服务端只映射 RETURNED/ACCEPTED 并按终态时间倒序。已处理 Package 可按稳定 ID/version 重开，显示 CREATE/SUBMIT/RESUBMIT/RETURN/ACCEPT、操作者、Asia/Shanghai、请求号、SUCCESS、完整原因、责任队列及 assignee/SLA 空状态。
- 决策安全：接收/退回在业务 POST 前弹出确认窗口；完成凭证只使用服务端返回的动作、操作者、时间、请求号、结果和数据库保存原因，并提供“查看已处理详情”。Product/BOM、Unit Resolution、Material Snapshot 和终态详情只读；没有增加 `system.audit.read`、扩大 planning 权限或改变状态机。
- 测试：Planning unit/UI/PG `4/7/11`，Identity/Project/Master-BOM PG `10/5/6`，0036 upgrade `6/6`，适用静态/安全回归 `65/65`；两组 typecheck、production build、lint `0 error / 10 existing warnings`、1,137 文件凭据扫描和 diff check 通过。隔离 Chromium `1/1` 在 390×844 完成合成退回、确认、凭证、历史重开、NFKC、退出与匿名 401。
- 备份/部署：root:root 0600 custom dump 2,139,142 bytes、SHA-256 `1d5cdd88257f2e53830598a498b609ac7208b792f7fcfdae2f8306b37d36eb5f` 的 list 与第二新空库 36/head 0036 恢复通过。只替换 Web 为 `sha256:fb88dd8afb8b7f08cf6c8dff9aa66566ad9aec0a203460e7fd09bc32af728edc`；旧 Web 有精确 rollback tag，PostgreSQL/Worker/Caddy、四卷、alpha.37/0036 不变。
- 主 UAT：只登录 planning，浏览器门禁只允许 login、只读请求与 logout；未登录 engineering、未接收/退回、未创建 v2。Package ID 1/v1 在已处理可见并重开，最终 RETURNED、RETURN 1、ACCEPT 0、v2 0，RETURN 操作者/上海时间/请求号/结果/实际原因和工程/项目部责任队列完整；活跃 planning Session 0。
- 数据/清理：部署前备份恢复库与主 UAT 后主库的受保护摘要均为 `3960cf1f1fc3fdaca0bacd246732d27a0ff223e894953e7be2427fa22b150dca`（217 tables / 201 sequences）。任务临时库/容器/网络/模块/脚本/指纹已清理；正式备份、候选/回滚镜像和四卷保留，未 prune。最终约 2.1 GiB available、221 MiB Swap、22 GiB、Load `0.08/0.10/0.21`，内核 OOM 0、四服务 restart 0/OOM false。
- 结论：`PLANNING DECISION HISTORY FIXED — UAT V1 RETURN VERIFIED`。完成后停止，不登录 engineering，不创建 v2。

## 2026-08-01

### SELFHOST-OPS-OFFLINE-IDENTITY-RECOVERY-11 - `ops: add guarded offline identity recovery` / `ops: complete canonical credential recovery`

- Git/范围：从 strict clean `main@753c68c84427de93536a1f282b6e80987f7c9466`、behind 0/ahead 113 起步；只获权处理当前并行非生产 UAT 的 admin 与固定十个 UAT 账号。工具/测试提交 `a48dcc8a290b96da1ea6e426aaa2c6d73416c2fc`；未 push/PR 或改写历史，未读取/修改 `shujvbiao/`。
- 离线工具：新增不接 Web 路由的 root-only Identity Recovery CLI、正式 runner、离线状态证明、受控检查、Canonical Stage/提升、隔离 Web/浏览器与证据最终化。严格拒绝 production、非 root、未知数据库、非 0036、可写服务、缺确认和重复 run-id；复用现有 Password/Identity/PostgreSQL 事务，不独立实现密码算法或 HTTP 恢复入口。
- 测试/演练：unit 7/7、隔离 PostgreSQL 12/12；最终 0036 主库备份恢复演练完成 11 账号原子更新、12 Session 撤销、11 审计、Canonical 与单 Chromium admin+十 UAT 登录/强制改密门禁/退出，最终目标有效 Session 0，业务与受保护指纹不变，演练资源已清理。
- 正式备份：root:root 0600 custom dump 2,134,619 bytes，SHA-256 `4c071223172d8a0fcb8c196690ec57c0f414eb83fde40f316449d5200f6bc42a`；`pg_restore --list` 与第二新空库 36/head 0036、身份非敏感计数和两类业务指纹通过。恢复库已删除，正式备份保留。
- 正式恢复：run-id `3b03aaab-11ef-4dfe-963b-001a6ece660f`；单事务锁定并更新 11 账号、撤销 12 条目标既有 Session、写 11 条 `OFFLINE_IDENTITY_RECOVERY` 审计与唯一持久证据。用户名、角色、active、其他用户/Session、业务表、Migration/Schema/版本均不在变更范围。
- Canonical/浏览器：两份正式文件标准 JSON Schema PASS、单硬链接普通文件、`root:root 0600`；双文件成功后删除旧 candidate，最终化后删除 Stage。单 Chromium 验证 admin 不强制改密并退出、十 UAT 全部仅到强制改密页并退出，历史导航/刷新不恢复受保护内容；最终目标有效与未撤销 Session 均为 0，未进入业务页面。
- 业务/服务：业务指纹 `04cdbc8a49112bc43b5652760408d46d10dbdda1801c1c9b816aa9891a5b5c3c` 与受保护指纹 `5414589704ac085792cab1a546e658a61b39c2988800a23ad091e756275e7d41` 前后一致；Planning 表只被受控备份/恢复与整体指纹核对覆盖读取，未做 Package 对象级核验、修改或业务操作。Web/Worker 停写合计 113 秒并恢复原容器/镜像，PostgreSQL/Caddy 保持运行，四服务 restart 0/OOM false。
- 验证/清理：Site lint、`npm test` 3/3、Python 三项、仓库凭据扫描和 `git diff --check` 通过。隔离库、临时容器/网络/浏览器运行材料/测试 Stage/临时 SQLite 均清理；四个受保护 Volume、正式备份、Canonical、完成标记与无秘密浏览器证据保留，未 prune。
- 结论：`OFFLINE IDENTITY RECOVERY COMPLETED — CANONICAL CREDENTIALS ACTIVE`。完成后立即停止，不开始 Planning 核验、接收、退回或其他业务任务。

### SELFHOST-OPS-UAT-CREDENTIAL-RECONCILIATION-10 - `ops: record blocked credential reconciliation`

- Git/范围：从 clean `main@a4eff293668e24f4f780eb5df840bfc7e510365e`、Parent `615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、behind 0/ahead 112 起步；获权范围仅为管理员本人改密、manager 二次重置、十账号 Identity 验证/退出和候选提升，不包含业务、数据库直改、重启或部署。
- 严格门禁：Branch/HEAD/Parent/同步、clean worktree、alpha.37、0001—0036、运行库 36/head、指定 Web 摘要、root-only 0600 凭据文件、候选存在、服务健康、无其他浏览器/执行流和资源阈值均通过。
- Fail closed：单一受控进程在凭据结构预检阶段返回 FAIL，并在建立管理员候选、启动 Chromium 或发送任何 Identity/业务 API 请求前停止。失败输出只含阶段、FAIL 和计数；没有输出或持久化密码、Token、Cookie、CSRF、Session 摘要、密码摘要或凭据正文。该结果不区分文件事实异常和解析器格式覆盖不足，本轮不重跑或扩大诊断。
- 身份/文件：管理员本人改密、旧/新密码验证、manager 二次重置、十账号验证、退出、审计页面核对和正式提升均未运行；身份变更与本任务 Identity 事件均为 0。管理员/UAT 正式文件及既有 UAT 候选未变化，均保持 `root:root 0600`；本轮隐藏阶段路径最终不存在。上一轮 Admin/manager Session 风险保持开放，没有新增 Session。
- 业务/服务：没有打开 Identity、强制改密、经营或 Planning 页面，没有 API/Package/业务请求；未读身份表、Session 表或密码摘要。没有 build、Migration、PostgreSQL 测试、Compose 重建、服务重启、部署、prune 或资源删除；alpha.37/0036 和四服务保持 restart 0/OOM false。
- 资源/清理：起点约 2.2 GiB available/218 MiB Swap/22 GiB/Load `0.19/0.14/0.10`；最终约 2.2 GiB/217 MiB/22 GiB/`0.40/0.23/0.20`，内核 OOM 0。受控容器自动删除且浏览器未启动；控制脚本、临时依赖/cache 和精确 `/run` 目录已删除。遵守保护规则，未删除已拉取镜像、Volume 或备份。
- 提交门禁：断网只读凭据扫描通过 1,119 个仓库文件，`git diff --check`、Python self-test/smoke 和隔离临时 SQLite go-live 通过；没有连接或写入常驻 PostgreSQL/SQLite。
- 结论：`BLOCKED — NO FURTHER IDENTITY CHANGE`。需另立并明确授权安全格式核验/身份收口任务；在 Admin/manager 风险、十账号退出与正式文件提升全部完成前，不得开始 planning 核验或退回流程。

### SELFHOST-OPS-UAT-ROLE-CREDENTIAL-ROTATION-09 - `ops: rotate exposed UAT role credentials`

- Git/范围：从 clean `main@615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、Parent `682e79378660ef7859617655836f02e2112df244`、behind 0/ahead 111 起步；只处理十个指定 UAT 角色账号，不修改业务代码、Migration、部署配置或其他用户，不 push/PR 或改写历史。
- 受控重置：单 Chromium、顺序隔离 Context、Identity-only API allowlist；十个目标账号均经管理员网页重置成功，每次成功立即原子更新/fsync 候选。角色与 active 状态保持，`admin`、UAT admin-check 及其他账号未重置，管理员凭据文件未修改；Identity audit 成功 10、失败 0。
- 验证/安全停止：首个账号旧密码返回 `LOGIN_FAILED`，新临时密码认证成功并进入首次强制改密页，未执行实际改密或越过该页；页面退出/Session 失效未形成完成证明，流程立即停止，其余九个未验证。管理员退出也未到达完成证明，因此两类任务 Session 均按风险开放处理，未直接读取或修改 Session 表。
- 恢复：保留 `/etc/chenyida-erp/.uat-role-accounts.txt.candidate-20260801025603-b821881a80`（`root:root 0600`）；候选未提升，正式文件保持 `root:root 0600`，其中十个旧密码已失效。没有旧凭据副本，不对普通文件底层不可恢复性作声明。
- 业务保护：没有进入经营工作台或 Planning Package 详情，没有发起接收、退回、v2 或任何业务域请求；本轮没有读取 Package 数据，FIX-08 的 Package 基线不冒充本轮黑盒结果。未 build、Migration、PostgreSQL 测试、Compose 重建或服务重启。
- 提交门禁：仓库凭据扫描通过 1,118 个文件，`git diff --check` 通过；扫描器排除禁止读取的 `shujvbiao/`。Git 变更只含无秘密项目状态和任务报告。
- 资源/清理：起点约 2.3 GiB available/218 MiB Swap/22 GiB/Load `0.44/0.31/0.21`；最终约 2.3 GiB/218 MiB/22 GiB/`0.13/0.18/0.20`，内核 OOM 0、四服务 restart 0/OOM false。临时 Chromium 容器、profile/cache、依赖、控制脚本和目录已清理；未 prune、删除镜像/Volume/备份，恢复候选按失败规则保留。
- 结论：`PARTIAL UAT CREDENTIAL ROTATION — RECOVERY CANDIDATE RETAINED`。另行授权完成 Session 风险处置、十账号验证和候选提升前，停止所有 UAT/Planning 登录。

### SELFHOST-OPS-UAT-PLANNING-REVIEW-TRACEABILITY-FIX-08 - `fix: expose planning handoff traceability` / `ops: record blocked planning traceability rollout`

- Git/范围：从 clean `main@a254bca5d59dd3f17047c9d6495dfdf2df1a798e`、Parent `91c0fd29d534246c55ddd669e894cdde9b774e52`、behind 0/ahead 109 起步；功能提交 `682e79378660ef7859617655836f02e2112df244`。只改 Planning Handoff 详情的只读合同、展示、测试和项目文档；未 push/PR 或改写历史。
- 权威查询：详情使用单连接 `REPEATABLE READ READ ONLY`，先执行现有 `planning.read` 与 Package 范围授权，再从不可变 Package Snapshot、精确 Package Event、Package Item 固定 `unit_resolution_id` 和稳定关联对象投影。CREATE 请求只精确匹配该 Package 的成功准备审计；没有授予 planning 全局审计权限，也没有补写历史。
- UI：新增 Package 稳定 ID/version/完整摘要/责任队列/assignee 与 SLA 空状态、CREATE/SUBMIT/RETURN/ACCEPT 时间线和 Asia/Shanghai 标注；Product/BOM 创建服务门禁证据与当前状态分开，销售源单位 pending 与工程 `件 · PCS`/Unit ID 1/Resolution v1 并列；四条 Material 显示稳定 ID、正式编码、名称、1 PCS、损耗和 10 PCS。退回文案、决策后果、终态只读原因和 390px 卡片布局完成。
- 测试：适用 Node 103/103，Planning unit/UI/PostgreSQL `4/7/11`，两个 typecheck、lint 0 error/10 既有 warning、1,117 文件凭据扫描通过。隔离 Chromium 1/1 在 390×844 完成合成查看→退回、无全局溢出、v2/ACCEPT 0、退出 Session 失效；没有对主 UAT 执行退回。
- 数据库/版本：没有新增 0037，没有修改 0001—0036，alpha.37 不变；0036 SHA-256 仍为 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。功能核验没有发现历史追溯缺口。
- 备份/部署：root:root 0600 custom dump 2,131,480 bytes、SHA-256 `25c302316d415602825d1d9d85e8456a5c46db5c4167cc5f8da27b0ea8f42ff2`，`pg_restore --list` 与第二新空库 36/head 0036 恢复通过。只替换 Web `sha256:6667bd2ca64e...→sha256:6b94a9c73a18...`；PostgreSQL/Worker/Caddy、Origin/端口和四卷保持。
- UAT 保护：部署前后业务指纹均为 `a7869b3ae5d75b7b68fac1234e04288c755622ee3f549497b2c96dc366701679`。Package ID 1/v1 仍 SUBMITTED、总数 1、v2/RETURN/ACCEPT 0；Unit Resolution、Product/BOM、Material 533—536、Event/Audit 均未修改。
- 安全停止：准备主 UAT planning 只读浏览器核验时，shell 诊断错误输出暴露 root-only UAT 角色凭据正文；后续只读计数确认 10 组仍有效，其中 1 组为 planning。立即停止登录，未创建 Session、未登录 planning/engineering、未执行接收/退回。凭据值和身份信息未写入仓库；因轮换属于新的权限变化且未获授权，主 UAT 浏览器验收未执行，任务以 `BLOCKED — NO UNSAFE CHANGE` 收口。
- 资源/清理：最终 available 2.2 GiB、Swap 214 MiB、根盘 22 GiB、Load `0.17/0.54/0.74`；四服务 restart 0/OOM false。隔离库、恢复库、临时浏览器/构建镜像和精确临时目录已清理，正式备份与当前/回退 Web 保留；未 prune 或删除受保护卷。

## 2026-07-31

### SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07 - `feat: add versioned requirement unit resolution` / `ops: deploy requirement unit resolution in parallel environment`

- Git/版本：从 clean `main@d06b44f5958527707f38e4c12f0d3143ce31875b`、Parent `525ad2907287d736ecd40d3df24b77c6c5be8ff4`、behind 0/ahead 107 起步；功能提交 `91c0fd29d534246c55ddd669e894cdde9b774e52`。包升级为 `0.1.0-alpha.37`；未 push/PR 或改写历史。
- Schema：唯一新增 `0036_project_requirement_unit_resolution.sql`，SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。`0001`—`0035` 无修改，逐文件 SHA 汇总仍为 `504ba2fdc555135935436fccc8d618225fad47e3de169af9fd9cb7ae99a511c0`，0035 仍为 `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- 模型/API：新增追加式 Unit Resolution Version、每 Requirement Item 独立 CAS Head、稳定 Unit/需求链外键、受控来源类型、Version UPDATE/DELETE 禁止和 Package Item 精确 provenance。正式写接口执行 Session、Origin、Cookie/Header CSRF、角色权限、canonical-body 幂等、CAS、enabled Unit、Audit 与故障零半记录；Package 创建不再从源 nullable Unit 或 BOM 推断。
- UI：pending 行显示 enabled Unit 的 `中文名 · CODE` 选择器且不自动预选 PCS；Product/BOM 与 Unit 完整性分别显示，缺失行明确，未完整时保存/生成门禁生效，刷新保留 Resolution Version，390px 无页面级横向溢出，并说明确认不改销售原始需求。
- 测试：Migration 6/6、Project PostgreSQL 5/5、Planning PostgreSQL 10/10、静态适用回归 89/89、其他适用 PostgreSQL 25/25、`npm test` 3/3；两个 typecheck、lint `0 error / 10 existing warnings` 和 production build 通过。真实 Chromium 隔离全旅程 1/1，覆盖无预选/停用 Unit、CSRF/Origin、幂等/CAS、退回修订重提接收、四行各 10 PCS、固定 v1/v2 provenance、源 Requirement 不变和退出失效。
- 隔离升级/回退：在线一致 0034 隔离 dump SHA-256 `52bd21d05dcb9fda9d98a3a4b8949e2513ba8b818a8c2e60e243cded9f6c19a1`；空库 0001→0036、0035→0036、0034 恢复库的 0035→0036、重放、失败回滚和约束均通过。升级库删除后从同一备份恢复到另一新空库为 34/head 0034，保护事实一致；临时库已删除。
- 正式备份/部署：停服 root:root 0600 custom dump SHA-256 `75e1ffbf2ea846761ece1d4c73dea96e871eca5fcde86d28f24782b10f862df7`，`pg_restore --list` 和第二新空库 34/head 0034 恢复通过。暂停 Web/Worker 写入后串行应用 0035、0036；只替换 Web `sha256:7e0a3040acd172...→sha256:6667bd2ca64e...`，旧 Web 回退 tag 保留。Worker 保持 `sha256:32d1ae335610...`，Caddy 未重建，PostgreSQL Volume、公网 Origin/端口和四个受保护卷保持。
- UAT 保护：业务保护指纹 `fb71309bf73dce907f0bcb2e294d1b31` 升级前后相同。Requirement Item 1 仍 `unit_id=NULL/unit_pending=true`、数量 10；Product/BOM Resolution 仍 7/7/7/7；Unit Resolution Version/Head `0/0`，Package/Item/Event/待接收 `0/0/0/0`；Product/BOM/Material 533—536/四行各 1 PCS 未变。
- 只读验收：Engineering 页面出现未预选的单位选择器，显示 Product/BOM 完成与 Unit 缺失，保存/生成禁用，390px 通过；未选择/保存 PCS、未生成 Package、未登录 planning，退出后会话失效。凭据格式探测曾产生 1 次 engineering 登录 401，无会话或业务写；随后只在内存核对密码摘要完成正式验收，不影响业务指纹。
- 运行状态：最终四服务 restart 0/OOM false，Web/PostgreSQL healthy、Worker/Caddy running；精确清理后 available memory 2.3 GiB、Swap 210 MiB、根盘 26 GiB、Load `0.30/0.30/0.40`，未触发停止阈值。临时库/容器/worktree/runner/在线隔离 dump/Playwright 镜像已清理；正式备份、当前/旧 Web 回退镜像和四个受保护卷保留。

### SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-FIX-06 - `docs: diagnose planning unit resolution schema gap`

- 严格门禁：从 clean `main`/`525ad2907287d736ecd40d3df24b77c6c5be8ff4`、behind 0/ahead 106 起步；源码 alpha.36/0035，常驻 alpha.34/0034，Web 镜像与唯一公网 Origin 精确符合任务要求。无未知执行流或重型容器，四服务 restart 0/OOM false。
- 根因：当前 Requirement Item 为 `unit_id=NULL/unit_pending=true`；0015 的数据库触发器禁止改写已提交需求。0016/0034 的 Product/BOM Resolution 不含 Unit/版本/CAS，“保存解析”只能保存 Product/BOM；快照 INNER JOIN `project_requirement_items.unit_id` 和 enabled Unit 后排除该行，再统一抛出误导性的 `REQUIREMENT_ITEMS_UNRESOLVED`。
- 分支 B：确认没有 alpha.34/0034 合规热修位置。禁止写回需求、从 BOM/名称/产品类型推断 PCS、用 JSON/备注旁路或放宽完整性门禁；未修改代码、0035、Schema、migration、测试断言或部署配置。
- 数据方案：proposed D-086 定义 0036 追加式 Unit Resolution 版本事实、独立 CAS Head、复合归属 FK、enabled Unit 双阶段校验和 Package Item `unit_resolution_id` provenance；Product/BOM Resolution 保留稳定 ID。0034→0035→0036 必须另行授权、备份、隔离升级与验收。
- UAT 保护：只读确认 Project ACCEPTED/10、Product/BOM 7/7 RELEASED、BOM 四行 533—536 各 1 PCS；Product/BOM Resolution/Package/Item/Event `1/0/0/0`，待接收 0。三条指定 failed/`REQUIREMENT_ITEMS_UNRESOLVED` 记录保持。综合指纹前后均为 `b239c62091cf51de8fa5b3ff6fb6521a`；本轮没有 engineering/planning 登录或业务写。
- 测试/部署：Branch B 没有运行 Planning 功能或隔离 PostgreSQL 写测试，未伪造用户列出的验收项；Python 文档基线三项通过。Node unit/UI 因当前镜像看不到沙箱只读源码挂载而在发现测试前退出，断言 0，临时容器已自动删除。未 build、backup/restore、deploy、restart 或创建 Package；最终 available memory 约 2.3 GiB、Swap 222 MiB、根盘 28 GiB、Load `0.09/0.11/0.09`，四服务 restart 0/OOM false。

### SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 - `fix: use current csrf token for planning writes` / `fix: enforce released bom read-only ui` / `ops: accept planning csrf and bom immutability fixes`

- CSRF 根因/修复：Planning 页面虽传入 `protectedWrite`，但共享客户端的路由分类没有覆盖 requirement resolution、planning package 和 submit/accept/return 等路由，请求落入普通 POST 分支，因而丢失 `X-CSRF-Token` 和调用方 Idempotency-Key；`credentials: same-origin` 与 Header 名本身正确。现在所有 Planning 写统一使用 `sessionPost`，发送时读当前 `CYD_ERP_CSRF` Cookie，以当前 Token+method/path+canonical 正文绑定页内幂等键，Session/logout/重新登录/页历史变化清空旧上下文。
- 服务端安全：Planning 仍只允许 POST，在读取正文和进入业务前执行现有 Origin/CSRF/Session/权限校验；缺失、错误、旧 Session Token、旧公网和未知 Origin 继续 fail closed，不信任 `Forwarded`/`X-Forwarded-*`。中文稳定错误码、request_id、日志去敏和审计边界未放宽。
- BOM 不可变：RELEASED 详情不再显示 Material 搜索/选择、行号/数量/损耗输入或新增/编辑/删除/保存/发布动作，明示“已发布，只读；如需修改请创建新版本”，切换详情会清除旧 DRAFT 输入。新增 line PATCH/DELETE 服务路由，DRAFT 可依权限修改，RELEASED POST/PATCH/DELETE 均稳定返回 `409 BOM_RELEASED_IMMUTABLE`，失败时无 Line/Version/Event/成功 Audit 半记录；既有 DB trigger 保持。
- 最小披露：BOM 页默认显示“请选择或搜索 BOM”，不自动选中或读取第一条历史明细。`GET /api/boms?q=&limit=` 只返回有界 Header/Product 摘要，支持 BOM 编码、Product 编码和名称；只在用户明确选择后读取 BOM Line，桌面与 390px 通过。
- 隔离验证：当前源码专项/适用回归、TASK09 14 项、六组 typecheck、218-table Schema consistency、lint `0 error / 10 warnings`、alpha.36 buildcheck、credentials、`git diff --check` 和 Python 三项通过。alpha.34/0034 兼容源合同 140/140、五组 typecheck、209-table Schema consistency、lint `0 error / 9 warnings`、build、credentials 通过；隔离 PostgreSQL Identity+Project+Planning `16/16`、Master/BOM+Material+operations+Dashboard `19/19`。
- 隔离浏览器：全新 0034 数据库与合成账号/项目完成 current/缺失/错误/旧 Session CSRF、logout→login、可信公网/回环、旧公网/未知/伪造转发头、保存→生成→提交→退回→修订→重提→接收、幂等重放/异正文/CAS、DRAFT/RELEASED BOM 和默认空选择。结果 package v1 RETURNED/v2 ACCEPTED，共享受保护写 18、Planning 写 11、Cookie/Header 匹配 18；全部仅在隔离库，库已删除。
- 备份/部署：pre-deploy custom dump 2,027,218 bytes/0600/root，SHA-256 `b30fa30408da026bd4114a52011e56485956fb72529e6e3467dfa5e4d5aa0d44`，3,065 list 行/213 TABLE DATA，独立单事务 0034 恢复核对通过。兼容 patch SHA-256 `b842ae9cbbb74b7b5a383b6d062fc500746361a0b53a46f551085d25e1`，只替换 Web `sha256:cb6a5c1fae896... → sha256:7e0a3040acd172...`；PostgreSQL/Worker/Caddy 未重建，34/head 0034、新公网 Origin 和四卷保持，0035/0036/TASK09/完整 alpha.36 未进入镜像。
- 主库/清理：engineering 只读 Chromium 仅发出 login/logout POST；首次 BOM Line 请求 0，明确选择的 UI 动作只加载该明细 1 次，脚本另以只读 GET 核对精确四行；RELEASED 可变控件 0，A0/V1 可识别，logout 后 back/forward/refresh 匿名。`PRJ-00000001` ACCEPTED/10、Product 7/A0 RELEASED、BOM 7/V1 RELEASED 及四行 533—536/1 PCS/0 不变，Planning `0/0/0/0`，三条旧 CSRF 失败保持；只新增 1 LOGIN/1 LOGOUT，有效任务 Session 0。测试/恢复库、临时容器、浏览器、Playwright 镜像、worktree/candidate tag 已清理，备份、当前镜像和精确回退 tag 保留，未 prune/push/PR。

### SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 - `fix: make bom material selection code-first` / `ops: accept bom selector fix`

- 根因/Selector：旧兼容页从全量 `/api/items` 读取当前字段，却以旧 `internal_item_code` 作为 option value/写入回退，没有搜索且依赖长下拉。新增有界 `/api/bom-material-candidates`，只返回 ACTIVE、正式编码非空、enabled 主单位可解析的 `material_id/internal_code/name/unit_id/unit/status/version`；精确编码单一命中，否则支持编码前缀和名称。
- UI/生命周期：结果显示 `正式编码 · 名称 · 单位`，选择与提交只使用稳定 material_id/unit_id；空/加载/无结果/错误/清除和竞态状态明确，桌面与 390px 可换行。Product Version、BOM Version、产品/生命周期/BOM 状态分开显示，并说明 BOM 属于 Product Version、Project 在 Planning Handoff 关联、先草稿校验后发布、发布后不可原地修改。
- 服务端：保存和发布事务均锁定并重新验证 Material 存在、ACTIVE、正式编码、Unit enabled 与主单位；alpha.34 的 `base_unit_id=NULL` 只按 `base_uom` 精确兼容。同一 BOM Version 重复 material_id 被拒绝；数量精度、发布权限、幂等、CAS、审计、故障回滚和不可变规则保持。
- 权威模型：Product/BOM/Planning 继续使用同一 PostgreSQL Product Version、BOM Version 和稳定 ID；真实 BOM release API 已存在并由 UI 调用，Planning 只接收 RELEASED Product/BOM，没有新增 Schema、Migration、状态机或伪按钮。
- 验证/备份：隔离 PostgreSQL Master/Planning/Identity/Material/operations/Dashboard、兼容 120 项、TASK09 14 项、typecheck、209-table Schema consistency、lint、alpha.34 build、credentials、Python 三项与 diff check 通过。custom dump 2,023,590 bytes、SHA-256 `8facc469c6bbdf3d2dedce57ce2d8a740d58cd2d2f8cd6e85c714421d05c35b9` 已完成清单、独立 0034 恢复与 candidate HTTP smoke。
- 部署/UAT：只替换 Web `sha256:881c033dc97e...→sha256:cb6a5c1fae896...`，PostgreSQL/Worker/Caddy ID 不变，Origin 保持 `https://43.135.148.43.nip.io:18888`，34/head 0034、0035 count 0。Chromium 对四码各唯一命中 IDs 533—536/PCS，只选择后清除，A0/V1 与发布说明清楚；只产生 2 LOGIN/2 LOGOUT，最终有效 engineering Session 0。
- 数据/清理：项目 ACCEPTED/10、产品 ACTIVE+A0/DRAFT/样品、四物料 V3/ACTIVE/PCS 和比较指纹不变；目标/全部 UAT BOM `0/0`、Planning `0`。临时测试/恢复库、容器、浏览器、Playwright 镜像、worktree、candidate tag 和可归属 BuildKit cache 已清理；备份、当前镜像和旧 Web 回退 tag 保留。未运行 0035、创建 0036、部署 alpha.36、操作 Python 服务、push 或 PR。

### SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 - `ops: record public IP cutover`

- 入口：项目负责人明确授权“切换”后，公网入口从 `https://43.135.157.211.nip.io:18888` 改为 `https://43.135.148.43.nip.io:18888`；Caddy 域名和 Web 单值 `ERP_PUBLIC_ORIGIN` 同步更新，不保留双公网 Origin。
- 配置/回退：root-only env 只改变两项公开值，其他内容经安全比较一致；原文件以 0600 回退副本保留。复用原镜像和卷串行重建 Web/Caddy，不 build/pull，不重建 PostgreSQL/Worker。
- TLS/网络：Let's Encrypt 新证书 CN/SAN 与新主机名匹配；ACME、外部 18888 登录页、HTTPS 首页/健康 200、HTTP 308→新 HTTPS 18888、匿名业务 API 401、安全头和旧 SNI 失败通过。
- 数据边界：34/head 0034 及核心 `536/7/7/6/6/316` 不变。Web 重建前的并发外部身份流程使 Session/Audit/Idempotency `103/1147/43→105/1152/44`，时间证明确实早于切换；切换后三类新增为 0。533—536 更早已由外部正式流程成为 ACTIVE/version 3/有编码，本任务没有审核或改写。
- 验证/资源：来源+身份 unit `15/15`、基础 `3/3`、lint `0 error / 8 个既有 warning`、1103 文件凭据扫描通过；最终 `2,474,940 KiB` available、`204,964 KiB` Swap、30 GiB、Load `0.02/0.29/0.28`，60 秒 Swap -4 KiB，内核 OOM 0、四服务 restart 0/OOM false、四卷保持，临时测试容器已删除。
- Git/保密：只提交脱敏任务和状态文档；env、证书私钥、凭据、Token、Cookie、摘要、数据库正文和备份不进 Git。未 push/PR、未运行 0035、部署 alpha.36、修改安全组/systemd/Python/SQLite 或启动其他业务任务。

## 2026-07-30

### SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY - `fix: clarify material review decision context` / `fix: invalidate protected views after logout` / `fix: enforce no-store on legacy shell` / `ops: accept material review blocker fixes`

- 审核详情：API 从现有当前 SUBMIT version 返回提交说明、提交人、时间和版本；UI 原样显示待审名称、分类/单位/来源、创建/提交事实、状态、工程说明或“未保存”、正式编码状态、审核范围、批准/退回后果和工程建立 BOM 下一步。不解析名称中的 `·`，不伪造外部编号、供应商、报价或价格。
- Dashboard/权限：新增权限绑定的 PENDING_REVIEW 精确待办，当前 API、卡片和原生队列均为 4，非零时不显示“当前没有立即待办”；legacy 统计继续明确为全局 DRAFT+PENDING_REVIEW。operations 仍只有 queue/approve/reject 三项审核增量，正文编辑和无关角色服务端 403。
- 退出/缓存：经营、Material 和 legacy 在 pagehide 先隐藏受保护内容，pageshow persisted/back_forward 重新校验 Session，legacy 刷新 fail closed；根页、Material 与 legacy 响应统一 `private, no-store, max-age=0, must-revalidate`。POST logout、Origin/CSRF、Session 撤销和 Cookie 清理保持，不禁用浏览器历史。
- 测试：隔离 PostgreSQL operations/Identity/Dashboard/Material 为 `4+10+2+7`，最终相关 unit/UI/handler/API coverage 118 项，TASK09 标准化 14 项；三组 typecheck、218 表 Schema consistency、lint 0 error、alpha.34 与 alpha.36 buildcheck、credentials、Python 三项和 diff check 通过。
- 备份/部署：custom dump 2,019,961 bytes、SHA-256 `281e25978b9db99000488779b858431cb20a2535364f64a01dec13bf7037972b`，3,065 entries/213 table-data，独立 0034 恢复通过。只替换 Web 为 `sha256:881c033dc97e...`；原 `sha256:f31199de3b8...` 以明确回滚 tag 保留，PostgreSQL/Worker/Caddy 容器与四卷不变，0035 未运行、alpha.36 未部署。
- 只读 UAT：operations Dashboard/队列均为 4，搜索 `042576` 并打开 533—536，详情和决策说明可见、正文编辑控件 0、approve/reject 请求 0；两套工作台 logout→back/forward/refresh 保持未登录。四条最终仍 PENDING_REVIEW/V2/MANUAL/PCS/空编码，APPROVE/REJECT version/change/audit 为 0，有效 operations Session 0。
- 资源/清理：最终约 2.3 GiB available、187 MiB Swap、30 GiB 根盘、Load `0.21/0.45/0.68`，内核 OOM 0，四服务 restart 0/OOM false。测试/恢复库、临时容器、浏览器、脚本、buildcheck 镜像和 worktree 已清理；备份、当前镜像和单一回滚 tag 保留。

### SELFHOST-LANDING-TASK09 - `feat: add supplier material standardization workbench`

- 工作流：把 TASK07 获确认的 `CYD-MATERIAL-13C-v1` 整理方式接入现有供应商导入；解析结构准备完成后默认进入“标准整理”，列表/新建页明确新路径，来源表头、高级 Mapping、Normalization 和 Review 继续保留。
- 规则：模板 13 列逐字/列位命中时直通；其他来源只使用明确表头、当前 Mapping、可证明标题上下文和显式主替状态。供应商料号不得冒充内部型号，未知项目/板型/型号/数量留空；公式和错误单元格不执行，替代料只按显式标记折叠。
- API/安全：新增 owner/`read_any` 保护的分页预览与 UTF-8 CSV；repeatable-read 只读快照、5,000 行/32 MiB、`private, no-store`、请求编号、稳定中文错误、导出审计、RFC 4180 与公式注入保护。需求/购买数量用字符串+BigInt 精确计算。
- UI：固定 13 列表格展示 Profile 状态、来源、统计、问题明细、分页和下载，并反复说明预览/CSV 不等于正式入库、建稿、审核或编码。工作区由七个可见步骤扩展为八个。
- 验证：Standardization 14 项，Mapping 5 项、Normalization 12 项、Review 10 项、Adaptive 5 项、FileStorage 3 项通过；两组 typecheck、lint `0 error / 8 个既有 warning`、credentials、Python 三项和 diff check 通过。
- 边界：源码提升到 `0.1.0-alpha.36`，Migration head 仍为 0035；未处理新真实表格正文、写业务数据、运行 Migration、build/restart/deploy、push 或 PR。当前 18888 仍为 alpha.34/0034。

### SELFHOST-LANDING-TASK08 - `docs: define bulk material standardization workflow`

- 流程：把 TASK07 固化为一批一任务/一对话的大批量 SOP；固定 `CYD-MATERIAL-13C-v1`、规则包、`CYD-MAT-YYYYMMDD-NNN/Rxxx`、默认 10 文件/5,000 行/100 MiB 上限和超限拆分规则。
- 恢复：定义 root-only 私有总索引、来源 manifest、批次卡、追加式决定日志和唯一 `checkpoint.next_action`；提供三份合法 JSON 示例与新建/继续/批准批次的复制指令，新对话不依赖旧聊天。
- 映射/审核：已知结构必须命中版本化来源档案，未知布局进入 `PROFILE_PENDING`；Codex 最高推进到 `REVIEW_REQUIRED`，项目负责人明确批准批次/修订/输出摘要后才能进入批准汇总。
- 汇总边界：临时汇总允许含机器验证的待确认批次但禁止入库；批准汇总只拼接最新未取代批准批次，仍不执行跨批模糊去重、正式编码、单位/供应商/替代关系审批或数据库写入。D-083 已记录。
- 验证/范围：JSON 3/3、文档一致性、Python 三项、Node 3/3、lint、credentials 1,083 文件和 diff/scope 检查通过；仅文档和无业务数据示例，未读取新业务文件、实现通用执行器、连接数据库、运行 Migration、build/restart/deploy、push 或 PR。

### SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02 - `fix: authorize operations material review queue` / `ops: accept operations material review queue fix`

- 权限/口径：`operations` 静态权限只增加 `material.review.queue`、`material.review.approve`、`material.review.reject`，没有草稿代编辑、admin/身份、系统审计或其他业务写增量。人工队列继续以 `material_status=PENDING_REVIEW` 为权威；engineering 创建人不可自审，无关角色返回稳定 403 中文错误。
- UI：原生队列、筛选、total、详情与动作入口复用同一权限/状态口径；legacy“清洗审核”明确为退役导入清洗入口并引导 `/materials/review`、`/materials/imports`。兼容 Dashboard 的待处理指标明确标注为全局 `DRAFT + PENDING_REVIEW`，不再冒充当前角色队列。
- 测试：Review UI 52/52、Identity 9/9、Dashboard UI 5/5、非数据库适用回归 275 项通过；隔离 PostgreSQL operations 4/4、Identity 10/10、Material 7/7、Normalization 5/5、Review 4/4、BOM Governance 16/16、Mapping 6/6。typecheck、Schema consistency、lint 0 error、alpha.35 build、最终 credentials 1,077 文件、diff check 和 Python 三项通过。
- 备份/部署：pre-deploy custom dump 2,013,262 bytes、SHA-256 `afe2cc5aa68940c1cf303317d4936d20814f2d2cfc36a55b48709d6b489dee15`，3,050 list entries/213 table-data，独立 0034 恢复与 candidate API smoke 通过。只把 alpha.34 兼容 Web 替换为 `sha256:f31199de3b8...`；PostgreSQL/Worker/Caddy 未重建，34/head 0034 和四卷不变，0035 未运行。
- 浏览器/数据：真实 Chromium 只登录 operations，以 `042576` 确认 533—536 全部可见、详情可开、批准/退回按钮存在且正文无编辑控件；未点击审核动作并安全退出。四条最终均为 PENDING_REVIEW/V2/MANUAL/PCS/空编码，APPROVE/REJECT version/change/audit 计数均为 0。
- 安全/清理：一次凭据文件脱敏失败和一次失败清理约束错误使凭据材料/Session 摘要只在本次授权会话工具输出中显露；未写 Git、文件、日志或外部系统，凭据文件未改，遗留浏览器 Session 已按有效约束撤销并审计。建议在独立审核试用前另行轮换该 UAT 账号。临时库、容器、runner 与 worktree 已清理；备份和显式回滚镜像保留，未 prune、push、PR 或操作 Python systemd。

### SELFHOST-LANDING-TASK07 - `feat: standardize source material workbooks`

- 语义纠正：按项目负责人澄清，以 `moban.xlsx` 第一张 `原BOM` 为真实原始数据、第二张 `Sheet1` 为目标格式；53 个原始主料组与 53 个目标行的规格证据、上下文和用量全部自动核对通过。
- 离线整理：8 份来源分别生成同一 13 列标准页，再合并为 591 行 `全部物料汇总`；另有 591 行来源追溯、94 条异常和来源说明。A118 42 行完全重复区段只计一次；A200 同逻辑旧版不重复计入，4 处差异按模板优先保留证据。
- 缺项边界：57 行无可验证用量、21 行无可证明板型，均留空；供应商仅取模板或来源明确供应商列。9 条 PCB/PCBA/空板本体依模板排除，J587 文件名/表内版本冲突保留人工确认，不猜测库存、订单或正式编码。
- 输出/验证：root-only 工作簿 197,821 bytes、SHA `aeea74c2...1c91`；专项 7/7、既有回归 3/3、Python 三项、Node 3/3、lint、credentials 1,076 文件、ZIP/openpyxl/13 列/2,364 公式及来源摘要不变全部通过。
- 边界：业务文件、逐行报告和 GPT 下载副本均在仓库外；未连接或写 PostgreSQL/SQLite/D1，未改 Schema/Migration/API/UI/Compose，未 build/restart/deploy、push 或 PR。

### SELFHOST-LANDING-TASK06 - `feat: add guarded internal material library export`

- 模板：项目负责人确认 `moban.xlsx` 第一张 `原BOM` 仅作原版对照，第二张 `Sheet1` 为整理后标准；导出器固定验证其首行 13 列，并把后续分段的列位变化统一映射回标准列。
- 离线整理：复用 LANDING-TASK02 root-only manifest、逐行 profile/classification 和既有 payload；8 份来源/1,113 行及模板前后不变。532 个既有正式编码原样沿用；147 个来源候选和 45 个模板候选无正式编码，缺项/冲突 fail closed。
- 结果：仓库外 root-only `内部物料库.xlsx` 含 724 行物料库、997 行标准明细、484 行待确认、1,006 行来源映射和来源说明；完整覆盖 953 条非归档来源+53 条模板。输出 SHA `01d0239a...5fa0`，宏/外链/电话/敏感内容 0。
- 工具/测试：新增固定确认、输入漂移门禁、稀疏 XLSX 区段解析、严格匹配、候选隔离、原子输出和自校验工具及合成集成测试。专项+classifier 7/7、Python 三项、Node 3/3、lint 0 error/8 既有 warning、最终 credentials 1,070 文件和 ZIP 完整性通过。
- 边界：`shujvbiao/` 加入 `.gitignore`，源表/模板/结果表/逐行业务报告不进入 Git。未连接或写 PostgreSQL/SQLite/D1，未改 Schema/Migration/API/UI/Compose，未 build/restart/deploy、push 或 PR。

## 2026-07-29

### SELFHOST-OPS-UAT-BLOCKER-FIX - `fix: secure UAT identity writes and logout` / `docs: record UAT identity blocker acceptance`

- 根因：真实 SSH/Codex 浏览器转发使用动态端口回环 Origin，而并行环境此前只接受精确公网 HTTPS Origin；即使 Session、CSRF Cookie/Header、credentials 和幂等键正确，请求仍被来源门禁拒绝。经营与兼容工作台又分别吞掉 logout 403 并乐观清页面状态，服务端 Session 实际未撤销。
- 安全修复：增加独立 deployment class；只有显式 `uat`+flag 才接受浏览器 Origin 与 Request URL origin 均为严格字面量 loopback。生产仍只接受显式可信 HTTPS Origin，不信任 Host/Forwarded/X-Forwarded、不允许通配。两个工作台统一安全 POST logout、same-origin credentials 与双提交 CSRF，只在服务端撤销/成功审计/对称清 Cookie 后跳转，失败显示稳定错误码和中文提示。
- 回归：request-origin/identity/双 UI 合计 `24/24`，隔离 PostgreSQL identity `10/10`，alpha.34 candidate build 与 Compose/API smoke initial/restart 均通过；未知外部 Origin、错误/缺失 CSRF、弱密码、重复用户名、未授权角色、审计、旧 Session、重复退出和 Cookie 对称属性均覆盖。测试库/容器已清理，未写主库。
- 浏览器：使用既有管理员凭据创建唯一临时 manager 并在列表确认，经营/兼容两个入口 logout 后旧 Session 均为 `REVOKED`、成功审计存在，重新登录和匿名重复退出通过；账号未做业务试用，最终通过页面停用。部署后审计 908—920 全部成功。首次脚本提前结束遗留一个丢失令牌、等待 TTL 的会话，按禁止直接 SQL 删除边界保留并记录。
- 部署/数据：部署前 dump 1,985,741 bytes、SHA-256 `d8951686192b500bee1770be258c8ee3eddb5e8d8509c0664cb6ca7b64714c79` 的 list/新库恢复核对通过；只更新 Web 到 `sha256:273aa687e741...`。运行仍为 alpha.34/0034，无 Migration；PostgreSQL/Worker/Caddy、四卷和业务 `532/6/6/316` 保持。
- 资源/Git：最终 2.3 GiB available、Swap 3.2 MiB、根盘 34 GiB、60 秒 Swap 增长 0，四服务 restart 0/OOM false、内核 OOM 0。代码 `dfa30bf` 的 Parent 为 `5fc1266b`；文档提交以 `dfa30bf` 为 Parent。未 push/PR/改写历史、prune 或操作 Python/SQLite/D1；任务脚本、临时库/容器和 build worktree 已清理，备份/回滚镜像保留。

### SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 - `ops: waive admin2 first password change`

- 授权/范围：项目负责人明确要求 `admin2` 不用首次改密。本次只清除该账号 must-change 标记并递增 version；密码、active admin、角色、合法 Session 和其他账号保持，不新增通用豁免 API。
- 事务/审计：使用 serializable 事务、任务 advisory lock、目标行锁、active/role/version 2/must-change true 前置门禁和 CAS；账号更新与唯一 `USER_FIRST_PASSWORD_CHANGE_WAIVED/success` Identity Audit 同事务。任务重放实际为 no-op，审计仍只有 1 条。
- 核对：`admin2` must-change/version `true/2→false/3`，密码二次指纹、Session/有效 `3/1`、身份幂等 3 不变；Audit/Identity `887/15→888/16`。34/head 0034、checksum manifest `b2ff69f7...13b8b` 和业务 `532/6/6/316` 保持。
- 运行/边界：Identity unit 8/8，本机/TLS health 与匿名 Session 200；四服务容器、四卷、restart/OOM 和资源门禁通过。没有 build/restart/Migration/deploy、push/PR、Sites/D1/Python 操作；task SQL 已删除，Git 不含密码、摘要、Cookie、Token、凭据或业务数据。

### SELFHOST-OPS-TRUSTED-ORIGIN-05 - `fix: trust configured public origin behind TLS`

- 根因/修复：Caddy 在公网终止 TLS 后以内部 HTTP 反代，旧身份与通用写请求却把浏览器 HTTPS `Origin` 直接和内部 `Request.url` 比较，导致合法首次改密返回 `CSRF_INVALID`。新增规范化的单值 `ERP_PUBLIC_ORIGIN`；配置存在时只接受精确协议、主机和端口，不接受凭据、通配、路径或客户端转发头。
- 安全/测试：身份写继续强制 Origin，Cookie/Header CSRF 双提交、Session、must-change、幂等、限流、权限和审计不变。合法代理形态、错误/缺失/内部 HTTP Origin、非法配置和错误 Token 已由 unit `11/11` 与隔离 PostgreSQL `9/9` 覆盖；部署 UI `4/4`、build 和镜像 health 通过。公网合法 Origin 无凭据探针进入 `AUTH_REQUIRED/401`，不再被来源门禁误拦。
- 部署边界：最终镜像基于 `0.1.0-alpha.34` 运行基线只叠加该 hotfix，Web 镜像为 `sha256:f9c34a11b900...`。首个从当前 alpha.35 源码生成的候选镜像在最终交付前因超出最小边界被拦截；0035 从未应用，任务时段只有两条身份认证探针，无治理请求/写入；候选容器和镜像已删除。
- 数据/运行：只重建 Web，PostgreSQL/Worker/Caddy 容器未更换；34/head 0034 及 checksum manifest `b2ff69f7...13b8b`、用户/admin `2/2`、Session/有效 `3/1`、幂等 3、业务 `532/6/6/316` 不变。两次无凭据探针使 Audit/Identity `885/13→887/15`，均为合法 `AUTH_REQUIRED` 记录。
- 资源/保密：临时 Origin 测试库、runner、容器、alpha.34 build worktree 和越界候选镜像已清理；四卷、旧 Web 回滚镜像和 root-only 0600 env 回滚副本保留。未 prune、push、PR、发布 Sites/D1、操作 Python，Git 不含密码、Cookie、Token、凭据或真实业务数据。

### SELFHOST-OPS-ADMIN-ACCOUNT-04 - `ops: provision second administrator safely`

- 身份变更：只在当前 `chenyida-erp-parallel` 通过正式 Identity Service 新增 `admin2`；用户/active admin `1→2`，账号为 active admin、version 2、首次登录必须改密。PBKDF2-SHA256/310,000 次、管理员权限映射及临时密码验证通过；现有管理员和 Session `2/0` 不变。
- 门禁/审计：首次弱密码由 `PASSWORD_WEAK` 原子拒绝；新合规临时密码创建成功。最终只读核对曾误输出创建时摘要，随即通过正式管理员重置用同一临时密码生成新随机盐，使旧摘要失效。最终 Audit/Identity `877/5→881/9`，幂等 `0→3`，限流 attempt/new/rejected `0/0/0→3/3/0`，全部安全证据保留。
- 数据/运行边界：34 migrations/head 0034、Material/Product/BOM/Line `532/6/6/316`、四卷和部署均不变；本机/TLS health 200、匿名用户 API 401，四服务 restart 0/OOM false。Identity unit 8/8、部署 Web UI 合同 4/4 通过；临时 runner/目录全部删除。
- 保密/Git：密码只经关闭回显 stdin 进入一次性 root-only runner，未进入命令参数、环境文件、脚本、系统日志、报告或 Git；最终摘要、Token、凭据和业务数据未提交。未 build/restart/deploy、push/PR 或操作 Python 服务。

### SELFHOST-LANDING-TASK05 - `ops: stage guarded bom v9 reimport`

- 输入/门禁：对单个 SHA 绑定 XLSX 做只读显式字段解析；1 Sheet、197 行、0 公式/外链。197 个 ERP 编码有效、唯一、连续，来源追踪完整且精确身份重复 0；“使用次数”519 仅为来源统计，不解释为数量。
- staging：新增只允许 root-only 输出的 `prepare.py` 与只允许 `ERP_ENV=test`、受控 staging 库名、0034 和 payload digest 的 PostgreSQL stager；首次写入 197、同 payload 重放新增 0。缺显式单位 197，因此 `ELIGIBLE=0`、`NEEDS_REVIEW=197`；表格没有产品/版本/BOM 行结构，相关实体均为 0。
- 主库保护：只读生成 213 表计数和 5,556 条拟删除清单；因 staging 无合格行，没有执行任何主库清理或导入。主库逐表计数 manifest 前后完全一致，旧 532 Material、6 Product/Version、6 BOM/Version、316 Line 及 872 业务导入审计保持。
- 灾备/系统：pre-clean custom dump 1,982,039 bytes、SHA `b21b484bc4dbb11fcc9354af649267a10bff4a125dcf84c8ba639164191916e2`，list 3,065 项和新空库 213 表逐表恢复通过；34 Migration/checksum、管理员、初始化、Session、Identity audit 不变。因无主库导入，post-import dump 不适用。
- 保密/清理：原 XLSX metadata/SHA 不变；真实 payload、逐行 review、计数和 dump 仅在仓库外 root-only 目录。临时 staging 库/runner/cache 已删除，四卷和四服务保留，60 秒 Swap 增长 0、restart 0/OOM false。未 build/restart/deploy、push/PR 或操作 Python 服务。结论 `STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`。

### SELFHOST-PHASE6-TASK01 - `feat: add BOM material governance pipeline`

- 范围/规则：在既有 CSV/XLS/XLSX Parser→Mapping→Normalization→Review 后增加可配置 `bom-material-governance-v1`；以品类+类型化关键规格+性能等级严格判同，使用精确十进制量纲，只对完整 READY 身份归组。`0201WMJ0000TCE` 与完整的 `0201,0R,±5%` 样例通过明示规则/默认归组；`1uF` 与 `100pF`、任一必需容量/耐压/介质/精度差异都不归并。型号敏感品类使用完整 MPN+封装，不做词干/模糊合并。
- 数据库：新增唯一 expand-only `0035_bom_material_governance.sql`，九张 Governance Run/Group/Row/Spec、Material/Alternative Candidate、Decision/Link/Event 关系表；`material_import_mappings` 增加表头始/终行、数据起始行、结构置信/状态/算法版本 6 列，metadata v2 增加 4 属性、6 分类节点和更严精度/叶子必填绑定。Schema/snapshot/journal 一致，`0001—0034` 未修改，0035 未应用常驻库。
- API/安全：增加批次 latest/list/create governance run，run/group/row 读取，`materials|bom-mapping|duplicates|exceptions|alternatives` 五类报告，以及 `BIND_EXISTING|CREATE_DRAFT|EXCLUDE` 决策端点。读取执行 owner/`read_any`；写入执行 capability、CSRF、`Idempotency-Key`/digest、CAS、限流、单事务审计；响应使用稳定错误码、中文提示、`X-Request-ID` 和 `no-store`。
- 全局身份门禁：治理建稿、治理 Draft 批准与普通 Draft 批准共享 advisory identity lock；`CREATED_DRAFT` 持久预留防止竞争产生二码。绑定时 live revalidation 允许快照后新出现的精确 ACTIVE 收敛；INACTIVE/FROZEN、已有 Draft 和无法可靠重建身份的旧正式行 fail closed。旧 Import Review 不能对受治理类别旁路 CREATE/BIND。
- 报告/追溯：不可变来源保存原始料号、描述、厂商、BOM/批次、数量/单位和解析证据，可沿 `material_id <- governance group <- source row <- normalization/import batch` 追溯。标准候选 key 不是正式 ERP 编码；替代项始终是待审候选，不自动写 Supplier Mapping 或正式替代关系。
- 验证：治理 unit `61/61`、PostgreSQL `16/16`、migration contract/0034-upgrade `5/5 + 5/5`；Material/Normalization/Import Worker/Review PostgreSQL `7/7 + 5/5 + 1/1 + 4/4`；Material unit/UI `63/63`；`npm test` `3/3`、`typecheck:governance`、credentials 最终 1,050 文件扫描通过，lint `0 error / 8 既有 warning`。
- 边界/限制：历史正式物料兼容问题只检测和阻断，无 ACTIVE 属性修订流程；`MECH/OTHER` 为 `UNSUPPORTED`；无治理 UI、真实回填、正式替代料审批或生产部署。`shujvbiao/` 未修改/暂存/提交；但断网只读凭据扫描器原默认 `--others` 曾对该未跟踪路径发起读取，未输出或传输内容，已记录为边界偏差。扫描器已在打开内容前排除该受保护未跟踪目录，最终复扫通过。未 build/restart 常驻服务；两个隔离测试库和临时容器已删除，四个受保护卷保留。

### SELFHOST-LANDING-TASK04 - `ops: record task04 web deployment`

- 授权/范围：项目负责人明确授权把 `cda8c7e` 部署到当前 18888 运行面并允许 build/restart。实际严格串行构建 Web，并以 `--no-deps --force-recreate --wait` 只更换 Web；未运行 migrate，PostgreSQL/Worker/Caddy 容器未更换。
- 验收：新镜像 `sha256:2db38e312586...` 为 healthy；公网/回环 health 200，匿名业务 API 401。公网 `index.html` 与 `app.js` SHA 精确匹配源码，新 `/materials/imports/new`、CSV/XLS/XLSX 和版本标识生效，旧 CSV 控件、`file.text()` 与退役 API 标记消失。
- 缓存事实：响应已含 `private, no-store, max-age=0, must-revalidate` 和 `Pragma: no-cache`；Vinext 同时并列冗余 `public, max-age=3600`。`no-store` 为更严格指令，但精确消除矛盾响应头须另立收缩任务。
- 数据/回滚：34 migrations 与 `0034` 不变，Material/Product/Product Version/BOM/BOM Version/Line 为 `532/6/6/6/6/316`，交易表仍为 0。旧 Web 镜像 `sha256:1c07cb1b5708...` 保留为 `task04-predeploy-20260729`；未改 Schema/Migration/Compose/数据，未做 Excel→PostgreSQL E2E。
- 资源/清理：起点 available 2.1 GiB、Swap 114 MiB、根盘 36 GiB；最终 2.2 GiB、123 MiB、35 GiB。build 后与部署后 60 秒 Swap 分别 +100/-24 KiB，restart 0/OOM false、内核 OOM 0、临时验证容器无残留。Build Cache 1.401 GB 和回滚镜像有意保留，未执行未授权 prune。

## 2026-07-28

### SELFHOST-LANDING-TASK04 - `fix: route compatibility supplier import to native workflow`

- 根因：PostgreSQL Parser/Worker 已支持 CSV/XLS/XLSX，但 `public/erp/` 仍保留初版 CSV 文本页，且其 `/api/import`、`/api/import-file`、`/api/sample-import` 已被自托管运行面明确退役为 410，因此旧入口既只显示 CSV 又不可用。
- 入口：兼容业务台“供应商导入”改为直达 `/materials/imports/new`，明确 CSV/XLS/XLSX；删除 CSV 文本框、示例载入、`file.text()` 与旧提交函数，Tab 事件不再绑定原生链接。所有工作台→兼容页 URL 增加统一版本标识，兼容 HTML 配置 `no-store`。
- 回归：增加兼容入口→原生工作区、三类 Worker parser 静态路由、缓存保护与 legacy 410 合同；收窄两条被 Mapping 版本历史误伤的既有 Import UI 正则而不降低原语义。Dashboard 12/12、Import UI 102/102、Parser 38/38、typecheck、语法、lint、credentials 和 diff 通过。Parser 内容单测覆盖 CSV/XLSX，XLS 只覆盖 OLE 签名分类；未做 Excel→PG E2E。
- 边界：版本保持 `0.1.0-alpha.34`，Migration 保持 `0034`；不改 API/Schema/Compose/业务数据，未 build、重启、部署或导入真实文件。在线页面仍为旧资源，生产部署须另行明确授权。
- 后续：只读审计确认列表实际 `{items,next_cursor}` 与页面期望 `{data,total,page}` 失配且 cursor 被忽略；解析失败终态、创建/上传幂等及版本/SHA/重复/安全语义也需独立任务。本提交不以入口修复冒充这些合同已验收。

### SELFHOST-LANDING-TASK03 - `ops: expose parallel erp through https 18888`

- 入口：用户明确指定公网 `18888`；Caddy 通过 `43.135.157.211.nip.io` 获取公开可信证书，`https://43.135.157.211.nip.io:18888` 指向新 Node/PostgreSQL ERP，80 只承担 ACME 和 308 HTTPS 跳转。DNS 服务只解析名称，ERP 流量不经过第三方代理。
- 隔离：Web 保持 `127.0.0.1:3000`，PostgreSQL 不发布宿主端口；旧 Python 从公网 `18888` 移到 `127.0.0.1:18889` 并保持 active/enabled。新增 Caddy data/config 两卷，原四个 ERP 持久卷不变。
- 安全：运行环境切为 `ERP_ENV=production`，轮换 setup token，认证 Cookie 的 `HttpOnly/Secure/SameSite=Lax` 单测 8/8；公网匿名业务 API 返回 401，TLS 主机名/链校验及 HSTS、nosniff、DENY frame、Referrer/Permissions Policy 通过。
- 数据：未修改 Schema/Migration 或业务数据；仍为 34 migrations、532 ACTIVE Material、6 Product/Version、6 DRAFT BOM/Version、316 BOM Line，Inventory/PO/Receipt/WO/Shipment/Finance 为 0。post-import 备份与 root-only 报告保持。
- 资源：PostgreSQL/Web/Worker/Caddy 为 healthy/healthy/running/running，restart 0、OOM false；60 秒 Swap 增长 0，最终 available 2.2 GiB、Swap 114 MiB、磁盘可用 36 GiB。未 push、创建 PR、部署 Sites/D1 或上传真实数据。

### SELFHOST-LANDING-TASK02 - `feat: import classified real bom history`

- 用户澄清：项目不具备逐行人工分类人力，因此在不猜测冲突数据的前提下，由离线确定性规则完成来源编码/MPN/严格规格组合、类别、位号与可数件单位判定；旧 `d63078b` 结论不改写，以连续独立提交取代当前状态。
- 分类：8 文件/13 Sheet/1,113 条中 ELIGIBLE 515、NEEDS_REVIEW 438、ARCHIVE_ONLY 160；806 条物料级可映射来源经 274 条重复归并为 532 Material，488 条 BOM 来源形成 316 行。A200 注意事项归档，跨文件无严格同一身份时不合并。
- 导入：新增通用离线分类器、受确认口令/目标库白名单/payload digest/0034/唯一管理员门禁的 PostgreSQL migration adapter 与单元测试；真实 payload、逐行映射和报告只在 root-only 目录。staging/主库首次执行和重放均通过，6 Product/Version、6 DRAFT BOM/Version、316 Line，第二次新增 0。
- 约束：147 条物料级与 291 条 BOM 级待复核没有进入对应正式实体；孤儿、重复编码、非法数量/单位为 0。Inventory/PO/Receipt/WO/Shipment/Finance 保持 0；Migration 仍为 34、版本仍为 alpha.34。
- 灾备：pre/post custom dump 的 list、新空库恢复及主库/恢复库关键摘要一致；临时库和容器副本清理，Web/PostgreSQL healthy、Worker running。结论 `PARTIAL REAL BOM IMPORT COMPLETED — REVIEW REQUIRED`；post-import dump 仍待用户异机复制。

### SELFHOST-LANDING-TASK02 - `docs: record guarded real bom staging`

- 输入/保密：指定 8 个文件的数量、名称和 SHA-256 全部通过；13 个 Sheet 离线只读盘点，原件 metadata 不变。详细逐行结果只保存于仓库外 root-only 目录，未联网、上传或提交真实正文。
- 分类：1,113 条记录中 ELIGIBLE 0、NEEDS_REVIEW 950、ARCHIVE_ONLY 163、BLOCKED 0；全部结构化候选缺明确单位，另有稳定身份冲突、重复来源、数量和身份缺失问题。A200 注意事项只归档，BOM/清单无精确稳定身份交集，不猜测合并。
- staging：停服 pre-import custom dump 的 list/新空库恢复通过；唯一空 staging 使用正式 runner 升级到 0034，两次重放新增 0，孤儿/重复编码/非法数量单位/交易副作用均 0。
- 主库：Unit/Category/ACTIVE Material 均为 0，Product/BOM 也缺任务要求的行级来源字段；正式 Service mutation 为 0，主库 Material/Product/BOM 和全部交易事实保持 0。需要独立 provenance Schema/Migration 任务后才能继续。
- 结论：`STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`；无 post-import 备份、build、代码/Schema/Migration/部署/push/PR 或 Python/SQLite 写入。

### SELFHOST-LANDING-TASK01 - `ops: prepare alpha.34 disaster recovery package`

- Git：严格起点 `82e9f07ce1666ace2677853408c7fb4339808cfc`、behind 0/ahead 76、clean；fsck、76 个可达本地提交、TASK01—TASK10 链、tracked archive、无 gitlink/嵌套仓库和 credentials 通过。提交只含项目文档，Bundle 在提交后生成并实际 clone。
- 数据库：Web/Worker 严格停服时生成 clean-0034 custom dump，1,677,933 bytes、SHA `72e8cbc6c3c4666b0e95dbcacf395787c5b520eb05a2bf3a8837ed4cfc68d702`；固定新空库单事务恢复，34 migrations/checksum、210 表、admin/setup/audit/session 与 205 张零业务表通过后删除。
- 文件：只读打包 uploads、attachments、backup-status；三个 tar 分别恢复验证路径、文件 SHA、uid/gid/mode/mtime，源不变且 root-only 临时目录清理。PostgreSQL 原始 Volume 未归档。
- 灾备：`/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z` 为 root:root 0700，文件 0600；包含无秘密配置/恢复清单、MANIFEST 和 SHA256SUMS。PostgreSQL dump 按秘密材料处理，`offhost_copy_completed=false`。
- 边界：未 push、上传、外传、build、访问生产、迁真实数据、改代码/Schema/Migration/Compose/package、重启 Python 或删除四卷/resource-guard；结论 `ALPHA.34 RECOVERY PACKAGE VERIFIED AND READY FOR OFFHOST COPY`。

### SELFHOST-PHASE5-TASK10 - `ops: accept supplier receipt lot iqc in parallel environment`

- 实际验收：两条真实 HTTP Project→Planning→Purchase Request→Award→PO→Delivery Plan；SQL 只建稳定主数据 fixture。主链 `10×12 CNY` 收货形成 RML Lot、Source 120、余额 10/10/0，IQC 10/8/2 后异人 RELEASE 8/Close 为 10/2/8，AP/Production Issue 0；3 件支线沿原 Lot 全额冲销为 REVERSED，主链已有 IQC 冲销 409。
- 恢复：Web/Worker 串行重启后事实保持；最终完整 HTTP 接受态备份恢复固定第二库，核对 Project/Planning/Purchase Request/Award/PO/Receipt/Lot=`2/2/2/2/2/2/2`、34 migrations、10/2/8、REVERSED 与 Source 120/0。主库由 clean-0034 恢复为原 admin/audit/session `1/1/1`、205 个业务表/幂等/files 0。
- 验证：TASK10 专项、Procurement/Quality/TASK08/TASK09 和共享回归、typecheck、Schema、lint、双 build、credentials、Python 临时 SQLite 三项和 diff check 通过。首次系统 Python smoke 只因缺 `openpyxl` 在导入阶段停止，改用项目既有虚拟环境后通过。
- 资源：Build Cache 2.569 GB→0B，任务依赖镜像删除；四受保护卷、alpha.34 tagged images、三服务和 Python 保留。未 push/PR、未启动后续任务。
- 结论：`SUPPLIER RECEIPT LOT AND IQC RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK10 - `test: accept supplier receipt lot iqc flow`

- 新增真实 Compose HTTP 主链/冲销支线与重启持久性验收；把 TASK08/TASK09 历史 migration journal 断言改为精确查找不可变 tag，使其与新增 0034 共存而不降低 snapshot/checksum/回滚断言。

### SELFHOST-PHASE5-TASK10 - `feat: add supplier receipt lot iqc flow`

- Git/版本：功能提交 `a10264020738d5ff281db9a6f7b6774df8cbb61b` 严格 Parent `55f8fe9693ebc0f630920e92eca1f74584d852af`；版本 `0.1.0-alpha.34`。
- 数据库：只新增 expand-only `0034_supplier_receipt_lot_iqc.sql`，SHA-256 `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`；来源 XOR、Receipt Line 唯一 Lot、外键/CHECK、不可变/服务写 guard 和 deferred 守恒；0001—0033 不变。
- 服务/UI：Procurement 收货原子创建 RML Lot 和 frozen Balance；Quality IQC RELEASE 追加 UNFREEZE Ledger；安全整单冲销复用原 Lot。新增/完善 receiving、incoming IQC、inventory lots、fulfillment 和 Dashboard。
- 测试：新增 TASK10 unit/UI/PostgreSQL/migration/Compose 套件并保持 FGL/FQC/Shipment/ORDER/null Lot 回归。

## 2026-07-27

### SELFHOST-PHASE5-TASK09 - `ops: accept finished goods lot shipment in parallel environment`

- 实际验收：SO `10×20 CNY`、Lot A/B `4/6` 与各自 FQC；A 发 4 后 B 冻结 2、发 6 被拒且跨表零半记录，解冻后 B 发 6；冲销 A 4 恢复原 Lot/FQC 后再次从同一个 A 发 4。最终有效 Shipment/FQC `4/6`、Material 0、Source 200、AR/Settlement 0；ORDER 全链 null Lot。
- 恢复：整栈串行重启后事实保持；接受态恢复固定第二空库核对正向 `{4,6,4}`、Lot `{A,B,A}`、A reversal、FQC `{4,6}` 与 ORDER null Lot。主库恢复为 33 migrations、原合法 admin/session/audit `1/1/1`，业务/幂等/files 0；临时库与任务备份删除。
- 验证：TASK09 unit/UI/PG/migration、`npm test`、75 项适用回归、11 typecheck、Drizzle consistency、lint 0 error/8 既有 warning、Web/Worker 分开 build、1003 文件 credentials、Python 临时库三项和 diff check 通过。
- 资源：最终 Build Cache `2.105 GB→0B`、磁盘 36 GiB、available 2.38 GiB、Swap 146 MiB；restart 0/OOM false，四卷/tagged image/resource-guard/Python/SQLite 保持。未 push/PR、未启动 TASK10。
- 结论：`FINISHED GOODS LOT RELEASE AND SHIPMENT ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK09 - `feat: add finished goods lot shipment flow`

- Git/版本：功能提交 `02dfa0d3c18c16b0e8ee07af94f11de7a0ca77e7` 严格 Parent `279d284738b8ee01f6579a91333ad958a6c36dc8`；版本 `0.1.0-alpha.33`。
- 数据库：只新增 expand-only `0033_finished_goods_lot_fqc_shipment.sql`，SHA-256 `ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44`；Allocation、FQC、Shipment Line 和 FQC Fact 保存 nullable Lot 外键，BATCH 强制同 Lot、ORDER 兼容 null，并有索引、service guard、不可变事实和 deferred reconciliation。0001—0032 不变。
- 服务/UI：Quality 服务端推导 FQC Lot；Sales/Inventory 同事务执行显式 Lot Shipment、FQC 消费、Lot Ledger/状态/事件、Delivery/SO/Source 与原 Lot 冲销恢复；原生 FQC、Allocation、Shipping、Lot/Batch genealogy 页面展示稳定 Lot 追溯。
- 测试：新增 TASK09 unit/UI/PostgreSQL/migration/Compose HTTP 套件，并更新 TASK08/TASK09 历史契约以继续断言新的稳定 Lot 权威。

### SELFHOST-OPS-PARALLEL-DB-CREDENTIAL-ROTATION-03 - `ops: rotate parallel database credential safely`

- 起点：`main`/`0d24eddcc5176602370214bfc8f8003844ab2b80`、behind 0/ahead 70、工作区 clean；版本 `0.1.0-alpha.32`，32 个 PostgreSQL migration 与 `0032` checksum 完全匹配。
- 数据基线：唯一启用 admin；唯一 `IDENTITY/LOGIN/success` 审计和同时间创建的唯一 ACTIVE session 属于合法管理员登录并完整保留；其余业务/幂等表、uploads/attachments 0。
- 轮换：生成 256-bit URL-safe 随机密码，只在进程内存与 root:root 0600 回滚副本中短暂存在；停 Web/Worker 后通过 PostgreSQL 容器本地 stdin 修改角色，只原子更新 env 的 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 密码段，随后逐个重建 Web/Worker。PostgreSQL 未重启。
- 验证：新密码经 Compose 网络 `SELECT 1` 成功，旧密码由 `scram-sha-256` 返回 `28P01`；Web healthy、Worker running、PG healthy，restart 0/OOM false。Compose config、HTTP health/session、`npm test` 3/3、lint 0 error/9 warning、credentials 994 files、diff/scope 均通过。
- 回滚演练：前两次尝试分别发现 localhost `trust` 路径不能证明旧密码失效，以及 Bash `ERR` trap 将预期认证失败误分类；两次均恢复旧角色/env、串行恢复 Web/Worker并删除临时副本。最终改用 Worker→PostgreSQL SCRAM 路径和显式条件判断后通过；未降低断言。
- 保护：凭据值、连接字符串、token/hash、CSRF、密码哈希、请求正文和 env 内容未输出或提交；临时容器/回滚副本全部清理，Build Cache 0B，四受保护卷与 Python/SQLite 不变。
- TASK09：未启动且未授权。未来必须以基线主键或不可逆摘要建立 baseline-delta，完成后返回同一合法审计/会话记录集和计数；不得删除不可变审计。

### SELFHOST-PHASE5-TASK08 - `ops: accept finished goods lot workflow in parallel environment`

- 提交：功能提交 `43808f85bc3a662825cc2421d97e9eb631e0c469` 严格 Parent `809efadd2cafd1a7b55a0824b87c67c70ad2814b`；其后仅追加九个聚焦修正，独立 ops 提交实际哈希以 Git log 为准。
- 实际 HTTP：planned 10 工单发布 Batch A/B `4/6`，四工序及 IPQC 全部通过；Completion 形成唯一 Lot A/B、Ledger `+4/+6`、Lot Balance `4/6` 和 Material Aggregate 10。Lot B freeze/unfreeze 2；Lot A 冲销 `-4` 至 REVERSED 后重新 Completion `+4`，复用同一 Lot。
- 保护：同批并发 Completion 不重复建 Lot，跨 Batch/Material、错误 code、重复 Lot、冻结冲销和直接 SQL 伪造拒绝；production freeze 实际 403；ORDER Completion 保持 null/空 Lot。FQC/Shipment/Sales Source/AR/Settlement 0。
- 验证：212 项不重复 Node 测试、13 组适用 typecheck、Schema consistency、lint、Web/Worker 分开 build、992 文件 credentials scan、diff 和 Python 三项通过。
- 重启与恢复：Compose 串行 restart 后 Lot/Ledger/Balance/冻结/genealogy 保持；接受态 dump 1,684,486 bytes、SHA-256 `416541cb78062657640458f6dd104c86a8cf3432332302cb2c58ab683a4b3949` 恢复至固定第二库并复核 32 migrations、Lot `4/6`、Material 10。主库最终恢复为干净 0032。
- 清理：TASK08 库/角色/临时文件/三份任务备份已删除，resource-guard、三容器、四卷、Trae/MySQL、匿名卷和 tagged image 保留。Build Cache 起点 0B、峰值 2.627 GB、一次获授权 prune 后 0B；磁盘最终 37 GiB。
- 结论：`FINISHED GOODS INVENTORY LOTS ACCEPTED IN PARALLEL ENVIRONMENT`；只实现制造成品 Lot，未启动 TASK09。

### SELFHOST-PHASE5-TASK08 - `feat: add finished goods inventory lots`

- 数据库：只新增 expand-only `0032_finished_goods_inventory_lots.sql`；增加唯一 Finished Goods Inventory Lot、Ledger/Balance nullable Lot 外键、关系索引、不可变/一致性/服务写/deferred 守恒 guard；同步 Schema/journal/snapshot/package/checksum，不修改 0001—0031。
- 服务/API：Batch Completion 在同事务创建/复用稳定 Lot，冲销反向写原 Lot；Inventory Query 返回 Lot position 和同单位 Material aggregate；新增 Lot list/detail/ledger/freeze/unfreeze，并扩展 Completion、genealogy 和 Dashboard。
- 页面：Inventory、production completion、Batch/genealogy 和 Dashboard 展示 Lot code、Batch、Material/Unit、on-hand/frozen/reserved/available、Completion、Ledger 与状态，并明确原材料和供应商批次仍未启用。
- 安全：所有写接口复用 Session/must-change、CSRF、正文/限速、持久幂等、CAS、固定锁序、request_id、中文安全错误、Audit 和单事务回滚；warehouse 写，production/quality/engineering 只读职责受控。

### SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 - `ops: clean docker build cache safely`

- 起点：`main`/`dfece35cda381ff31c376aad9ed78242861ada73`、behind 0/ahead 58、工作区 clean；版本保持 `0.1.0-alpha.31`，PostgreSQL migration 保持 `0001`—`0031`。
- BuildKit：确认默认且唯一 `default*` docker builder、BuildKit v0.30.0，无 build/buildx/Compose build、测试容器或 migration 运行后，执行 `docker buildx prune --all --force`；命令退出 0、输出 `Total: 25.11GB`，Build Cache 25.11 GB（24.3 GB private reclaimable）→0B。
- Image：唯一 dangling image `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612` 无 tag/digest/容器引用，逐 ID 删除；Images 13/27.45 GB→12/6.511 GB，未执行 `image prune -a`，所有 tagged image 保留。
- 保护：PostgreSQL/Web/Worker 容器 ID 与镜像不变，RestartCount 0、OOM false；Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口。四个 ERP 卷、Trae/MySQL、六个匿名卷、resource-guard 备份均保留。
- 数据与资源：31 migrations、唯一启用 admin 1、其余 public 业务/Audit/Idempotency 0、uploads/attachments 0；Python PID `13737` 和 SQLite metadata 不变。根分区可用 14→37 GiB；60 秒 Swap 固定 151,064 KiB、Load1 0.79→0.37，PostgreSQL/Web 全程 healthy、Worker running。
- 验证：`git diff --check`、`npm test` 3/3、lint 0 error/9 warning、credentials 980 files 全部通过；Node 命令在一次一个的受限 `--rm` 容器中串行执行，未创建 Volume，容器均已清理，Build Cache 保持 0B。
- 结论：`DOCKER BUILD CACHE SAFELY CLEANED`；未停止或重建 Compose，未删除 Volume、匿名 Volume、tagged image 或业务数据，未启动 TASK08。

### SELFHOST-PHASE5-TASK07 - `ops: accept manufacturing batch workflow in parallel environment`

- 提交：功能提交 `3162edf5559512dd82ec363cf859d39bae2d5a0d` 严格 Parent `93902d9c3f7be94044cf9903af6e6fbebc685cc3`；聚焦修正 `dfd1581bc2e3cb072cd7f238e6a1b0097f8912f4`、`cd9f016570cf94eb2990362b56e8f51ef5d43db1`；独立 ops 提交实际哈希以 Git log 为准。
- 实际 HTTP：Work Order 10 建立 RELEASED Batch Set 和 digest；Batch A 4 完成四工序/IPQC，Batch B 6 的原检为 `6/4/2/4`、NCR v1 RETURNED/v2 ACCEPTED、同批 REWORK `2/2/0`、复检 `2/2/0/2`、AOI `4/2`。B REFLOW 加工次数 8、净量仍为 6。
- Report/Completion/Inventory：Final Output、Production Report、Completion 和 Ledger 分别为 `4/6`；Report/Completion 混批与跨 Batch Input Allocation 实际拒绝。Ledger `lot_code=''`、MAIN Balance 10；FQC/Shipment/Sales Source/AR/Settlement 0。生产批次谱系已建立，但仓库批次库存尚未启用。
- 保护与查询：发布数量不等、发布后修改、越权 403、CAS、幂等重放、同 Batch 返工继承、ORDER 模式、并发/故障/直接 SQL guard 和稳定 genealogy 查询通过。Batch 列表、详情、code 精确查询、WIP、Work Order 汇总和七项 Dashboard 指标按权限返回。
- 验证：208 项不重复 Node 自动测试通过（unit/UI 82、PostgreSQL/API 67、migration 40、npm/environment/manifest/coverage 19）；9 组 typecheck、Schema consistency、lint、双镜像 build、credentials、`git diff --check` 和 Python 三项通过。
- 重启与恢复：Compose 串行重启后 Batch/digest/Run/Inspection/NCR/Rework/Report/Completion/Ledger 全部保持；接受态 dump 1,638,643 bytes、SHA-256 `6a19e3a850dbb0014c00497f1916ba6f0c103f3035b631f348a4fe0e76f0f936` 恢复至固定第二新空库并核对完整 4/6 链。最终任务备份按清理计划删除，resource-guard 保留。
- 清理与资源：主库 31 migrations、唯一启用 admin，其余公共业务/Audit/Idempotency/临时账号/uploads/attachments 0；仅三容器四卷。起点/最终 available 约 2.4 GiB，Swap 148→148 MiB，磁盘 15→14 GiB；最终 60 秒 Swap 155,295,744→155,295,744 bytes，RestartCount 0/OOM false。
- 结论：`MANUFACTURING BATCH GENEALOGY ACCEPTED IN PARALLEL ENVIRONMENT`；未启动 TASK08。

### SELFHOST-PHASE5-TASK07 - `test: preserve rework migration journal assertion`

- 把 TASK06 的 0030 migration 回归从“journal 最后一项必须为 0030”改为精确查找并校验不可变 0030 项，使其可与新增 0031 共存；业务、回滚、Schema、snapshot 和完整 SHA-256 断言不变，重跑 5/5 通过。

### SELFHOST-PHASE5-TASK07 - `fix: satisfy manufacturing batch lint contract`

- 将 Batch 页面初始加载改为稳定 callback 与 effect 异步调度，避免同步 effect state update；移除 Batch Service 未使用 import。TASK07 unit/UI、typecheck、lint 0 error/9 warning、Vinext build 及 Web/Worker 串行镜像重建通过。

### SELFHOST-PHASE5-TASK07 - `feat: add manufacturing batch genealogy`

- 数据库：只新增 expand-only `0031_production_batch_genealogy.sql`；增加 Batch Set/Batch/Event、Operation Run nullable Batch ID、Report/Completion 单 Batch 关系、索引、服务写 guard、发布后不可变与 deferred 守恒；同步 Schema/journal/snapshot，不修改 0001—0030。
- 服务/API：新增 Batch 管理、列表/详情/code/WIP/genealogy/Work Order 汇总；NORMAL Run 强制同批、REWORK 沿稳定来源继承，跨 Batch Allocation、Report/Completion 混批与结构化 legacy 绕过 fail closed。
- UI/Dashboard：新增 `/production/batches`，扩展生产、品质、NCR、返工与完工页面显示 Batch code、NORMAL/REWORK、Hold、genealogy 和 Inventory Lot 边界；Dashboard 增加 DRAFT/待执行/WIP/Hold/Rework/Final Output/Completed Batch 指标。

### SELFHOST-PHASE5-TASK06 - `ops: accept production rework execution in parallel environment`

- 提交：功能提交 `1f6a143adbf78d7fb70fbed1ea7d7dfea62cfd4b` 严格 Parent `11bc680a91c59258c94f8ddca3d56af71981811e`；独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.30`/30 migrations；`0030` SHA-256/数据库 checksum 为 `37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：原 REFLOW IPQC inspected/passed/failed/released=`10/8/2/8`；v1 RETURNED/v2 ACCEPTED 后显式 REWORK 派工/开工/报工 `2/2/0`，未复检时 AOI available 保持 8；新 IPQC 异人关闭放行 `2/2/0/2` 后 available 变 10、Execution COMPLETED、NCR RESOLVED。AOI、Final Output、Production Report、Completion 和 Ledger 均为 `8/2`，Balance 10，工单 `10/10/10/0/10 COMPLETED`。
- 数量边界：SMT-PRINT、SMT-MOUNT、REFLOW NORMAL、AOI processed 均为 10，REFLOW REWORK processed 2；返工是重复加工次数，REFLOW 总加工次数 12 不增加净产品，正式报工/完工/成品仍为 10，原 failed 2 保持不改写。
- 保护：未复检派满 AOI、超 ACCEPTED quantity、已有复检冲销、错误状态/目标/跨工单、非 active operator、NORMAL/REWORK 伪造、权限 403、职责分离、幂等异正文、CAS、并发、故障半记录和直接 SQL 绕过均 fail closed。
- 持久与恢复：整体串行重启后完整返工闭环、Audit 56、Idempotency 46 保持；接受态备份 1,569,512 bytes、SHA-256 `f5e8011c4ef55b0393cceedfbb2ebbbf8171e44fe8cccea92012452d77f8e379` 恢复到固定第二新空库并核对 30 migrations 与完整 `8+2` 链。
- 清理与资源：最终主库 30 migrations、唯一启用管理员、其余业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；TASK06 测试/恢复库、两份任务备份、临时容器/辅助镜像/标签删除，resource-guard 备份保留。起点/最终 available 均约 2.4 GiB，Swap 141→153 MiB，磁盘 18→15 GiB，60 秒 Swap 正增长 0，RestartCount 0/OOM false。
- 结论：`PRODUCTION REWORK EXECUTION AND REINSPECTION ACCEPTED IN PARALLEL ENVIRONMENT`；未启动 TASK07。

### SELFHOST-PHASE5-TASK06 - `feat: add production rework execution`

- 数据库：只新增 expand-only `0030_production_rework_execution.sql`；既有 Run 增加 `NORMAL/REWORK` 类型与稳定 lineage，新增 Rework Run Allocation、Execution Projection/Event、唯一/队列索引、不可变和 deferred reconciliation guard；同步 Drizzle Schema/journal/snapshot，不修改 0001—0029。
- 服务/API：ACCEPTED Request 显式派工复用 TASK02 start/report/cancel/reverse；服务端派生工单、目标、来源和工作中心，返工 good 进入新 IPQC Hold，只有显式复检 `CLOSED + RELEASED` 才进入后序 WIP。取消/冲销只在无品质/下游时恢复请求余额和投影。
- UI/Dashboard：返工请求、派工、工序、WIP、生产质量与 NCR 页面区分 NORMAL/REWORK，并展示原 failed、派工/处理/good/scrap、待复检/放行和 Execution 状态；Dashboard 增加待派、在制、待复检、复检未过和完成数量，保持权限裁剪只读。
- 验证：178 项不重复自动测试通过（unit/UI 78、PostgreSQL/API 46、migration 37、npm 3、environment 6、manifest 8）；8 组 typecheck、Schema consistency、lint 0 error、build、965 文件凭证扫描、`git diff --check` 和 Python 三项通过。

### SELFHOST-PHASE5-TASK05 - `ops: accept production rework request workflow in parallel environment`

- 提交：功能提交 `1de057a6a248ca3346d7d2b0f201252a3965eced` 严格 Parent `736f14b9510ca52ce39fea7154872dffe7818986`；独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.29`/29 migrations；`0029` SHA-256/数据库 checksum 为 `6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：四 Work Center 与 `NONE/NONE/IPQC/NONE` Routing，planned/issued 10；REFLOW IPQC inspected 10/passed 8/failed 2，AOI available 8、Quality Hold 2。唯一 NCR 由 OPEN 进入 REWORK_PENDING/REWORK_ACCEPTED；v1 RETURNED 释放占用，v2 以新不可变提交快照和 digest 重提后 ACCEPTED，最终 active rework 2、scrap 0、unresolved 0。
- 保护：failed=0/缺 FAIL/Defect、超量、重复 Rework/SCRAP、后序/跨工单目标、职责分离、403、幂等重放/异正文、CAS、并发 submit/accept/SCRAP、故障零半记录、直接 SQL guard、ACCEPTED 修改/取消、Inspection reopen 和来源 Run 冲销均 fail closed；SCRAP 自动测试确认不可逆且不写 Inventory。
- 下游为零：接收申请未增加 AOI available，未创建 Rework Run、额外 Run Report、Production Report、Completion、Finished Goods Ledger/Balance、FQC、Shipment、AR 或 Settlement。
- 持久与恢复：Compose 整体串行重启后 NCR、v1/v2、2 个提交快照、6 个请求事件、digest、数量、Audit 44、Idempotency 30 保持；接受态备份 1,517,240 bytes、SHA-256 `440fae8efd3427a341d7c8d2d24ebf516de9ef9dfd9acb50b5e841ebf069afbc` 恢复到固定第二新空库并核对完整链。
- 清理与边界：最终主库 29 migrations、唯一启用管理员、其余所有业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；恢复库、两份 TASK05 备份、临时目录/容器/辅助镜像删除，resource-guard 备份保留。未操作 Python 服务、读取真实 SQLite 正文、执行返工工序、迁真实数据、启 HTTPS、切流、生产部署、push、PR 或 TASK06。
- 结论：`IPQC NONCONFORMANCE TO REWORK REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK05 - `feat: add production nonconformance handoff`

- 数据库：只新增 expand-only `0029_production_nonconformance_rework_handoff.sql` 与 NCR/Event、Rework Request/Version/Event、Allocation、Scrap Disposition 关系表；numeric、稳定外键、唯一/状态/索引、不可变 guard、服务写入口与 deferred 守恒阻止超量、跨工单和伪造目标；同步 Drizzle Schema/journal/snapshot，不修改 0001—0028。
- 服务/API：扩展既有 Quality/Production 边界，Inspection→唯一 NCR、DRAFT 编辑/提交、RETURN/ACCEPT、修订重提、SCRAP、队列/详情/数量/上下文全部执行 Session/must-change、CSRF、正文/速率限制、持久幂等、CAS、固定锁顺序、request_id、中文安全错误、Audit 与单事务回滚。
- UI/Dashboard：新增 `/quality/nonconformances`、`/quality/rework-requests`、`/production/rework-requests`；Dashboard 增加待处置 NCR、未分配数量、待接收、已接收待执行和最终工序报废五项权限裁剪只读指标。
- 验证：166 项不重复 Node 自动测试（unit/UI 72、PG/API 47、migration 38、npm 3、environment 6）通过；正式 TASK05 typecheck、Drizzle consistency、lint 0 error/8 个既有 warning、Vinext build、955 文件 credentials scan、`git diff --check` 和 Python 三项通过。

### SELFHOST-PHASE5-TASK04 - `ops: accept production quality gate workflow in parallel environment`

- 提交：功能提交 `5379550d0381818ad970518ac4fb8261c4679989` 严格 Parent `f6e5ff2e8344e79a35f56311b02b514613484f59`；Dashboard 验收路径聚焦修正 `56f63ca714ed6f359bc51f681b6a532259747f1b`，Parent 为功能提交；独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.28`/28 migrations；`0028` SHA-256/数据库 checksum 为 `a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：REFLOW Run Report good `4/6` 先形成 Hold 10、released 0、AOI available 0；两条 quality 显式稳定来源 IPQC 经异人处置/关闭后 inspected/passed/released=`4/6`、Hold `10→6→0`、AOI available `0→4→10`。随后 AOI、Final Output Allocation、Production Report、Completion 均为 `4/6`，Ledger `+4/+6`、Balance 10、Work Order `10/10/10/0/10 COMPLETED`，FQC/Shipment/Sales Source/AR/Settlement 0。
- 保护：未检派工拒绝、warehouse 越权 403、同正文幂等重放/异正文冲突、CAS、职责分离、超量、并发、直接 SQL、故障零半记录、有 IPQC 阻止 Run 冲销及下游消费阻止 reopen 均通过实际 HTTP 或专项 PostgreSQL 测试；NONE 直通和 TASK02/TASK03 冲销门禁回归通过。
- 持久与恢复：Compose 整体重启后 8 Run/Report、2 Inspection/Result、6 Quality Event、2 Report/Final Allocation/Completion、2 Ledger、Balance 10 保持；接受态停服备份 1,438,390 bytes、SHA-256 `4da56e4303afae15ac0e5e7e8f550711ec66cbcae669dcac8b4b1f4c8e360a65` 恢复到固定第二新空库并核对完整 4/6 链。
- 清理与边界：最终主库 28 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；恢复库、两份 TASK04 备份、临时目录/测试镜像/build 产物删除，resource-guard 备份保留。未操作 Python 服务、读取真实 SQLite 正文、迁真实数据、启 HTTPS、切流、生产部署、push、PR 或 TASK05。
- 结论：`PRODUCTION OPERATION IPQC GATE ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK04 - `feat: add production operation quality gates`

- 数据库：只新增 expand-only `0028_production_operation_quality_gates.sql`；Routing/Snapshot Operation 增加 `quality_gate_mode`，Quality Inspection 增加稳定 Run Report 互斥来源，WIP 增加 required/inspected/released/hold/available/final 投影；同步 Drizzle Schema/journal/snapshot，不修改 0001—0027。
- 服务/API：Routing 发布 digest 与 Work Order Snapshot 固化门禁；既有 Quality Service 显式创建工序 IPQC并由服务端确定来源属性；下一工序和 TASK03 最终报工只消费 CLOSED/RELEASED 额度。历史 `production_report_id` IPQC 与 NONE 直通保持兼容。
- UI/Dashboard：Routing、dispatch、operations、WIP 和现有 Quality 页面展示稳定来源及 Hold/Release；Dashboard 增加待 IPQC、检验中、Hold、已放行待下工序/最终报工五项权限裁剪指标，保持只读。
- 验证：TASK04 专项 15 项，记录的 unit/UI、PostgreSQL/API、migration、manifest/coverage/environment 回归均通过；正式 typecheck、Schema consistency、lint、Vinext build、credentials scan、`git diff --check` 和 Python 三项通过。

### SELFHOST-PHASE5-TASK03 - `ops: accept structured final output workflow in parallel environment`

- 提交：功能提交 `1dae9661d07f7af7e866a1654804742372b8bc76` 严格 Parent `a6448ac42da737e31fee76085fb699e80f3c621b`；验收脚本职责分离和固定恢复目标聚焦修正为 `1a01172f14e9d4b3b51ec10430b188aa79efa96d`、`2eb5120bf98c9d45705cf96e2a25afb37cc154a3`，独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.27`/27 migrations；`0027` SHA-256/数据库 checksum 为 `b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：四 Work Center、四 Snapshot Operations 均以 `4/6` 执行，AOI final output `10→6→0`；有效 Production Report、Final Output Allocation、Completion、Report→Completion Allocation 均为 `4/6`，Ledger `+4/+6`、Balance 10、Work Order `10/10/10/0/10 COMPLETED`。正式 Report 前 Completion/成品库存/品质为 0；最终 IPQC/FQC/Shipment/Sales Source/AR 仍为 0。
- 保护：同正文幂等重放、异正文冲突、Work Order/final-output CAS、并发唯一消费、跨工单/非末序/冲销来源、直接 SQL guard、故障零半记录、403、无下游 Report 冲销恢复、Completion 下游阻止 Report 冲销及 Report 消费阻止 Run 冲销均通过专项或实际 HTTP。
- 持久与恢复：整体串行停/启后 8 Run、8 Run Report、3 Report（1 冲销）、3 Final Allocation、2 Completion、2 Completion Allocation、2 Ledger、Balance 10、Audit 51、Idempotency 41 保持；接受态备份 SHA-256 `16d63e5cbe1f85aa1a70f1414edb5a66d008faefe076b9739e92f9a71976f9f6` 恢复到固定第二新空库并核对完整事实。
- 清理与边界：最终主库 27 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；TASK03 测试库、恢复库、恢复目录和两份任务备份删除，既有 resource-guard 备份保留。未重启 Python、读取真实 SQLite 正文、迁真实数据、启 HTTPS、切流、部署、push 或创建 PR。
- 结论：`STRUCTURED FINAL OUTPUT TO FINISHED GOODS ACCEPTED IN PARALLEL ENVIRONMENT`；不启动 PHASE5-TASK04。

### SELFHOST-PHASE5-TASK03 - `feat: bind final operation output to production reporting`

- 数据库：只新增 expand-only `0027_production_final_output_reporting.sql` 和稳定 `production_report_operation_allocations`；同步 Drizzle Schema/journal/snapshot，不修改 0001—0026。外键、numeric、唯一/索引、不可变和 deferred reconciliation 防止超量、跨工单、非末序、伪造来源与投影失配。
- 服务/API：结构化 Report 只接受具体末工序 Run Report Allocation、Work Order/final-output CAS 和 Idempotency-Key；服务端生成数量、阶段与 operator，legacy 无 Snapshot 工单保持兼容，结构化 legacy report/complete 快捷路径 fail closed。详情、来源查询、冲销恢复、WIP/Work Order 和 Dashboard 已扩展。
- UI：`/production/reporting` 结构化模式只展示稳定来源和可用量，历史表单明确标记兼容；`/production/wip` 明示 WIP 非 MAIN 库存，warehouse 页面继续消费既有 Report。
- 验证：TASK03 专项 12 项，Phase 4 TASK06/TASK07、Phase 5 TASK01/TASK02、Production/Routing/Inventory/Dashboard/Identity 等回归 82 项，共 94 项自动测试通过；正式 typecheck、Schema consistency、lint 0 error、Vinext build、928 文件 credentials scan、`git diff --check` 与 Python 三项通过。

### SELFHOST-OPS-RESOURCE-GUARD-01 - `ops: add low-resource server safeguards`

- Git：严格 Parent `120e1524eaebd9d921cab6a036b3203bf7d39226`；保留并审阅既有 `server.py`、`compose.yml`、systemd unit 三项修改，追加根规则、专项测试和文档；不改版本、migration 或历史。
- Python：`ERPThreadingHTTPServer` 默认最多 16 个活跃请求线程，容量等待 1 秒后固定去敏 503；30 秒 socket timeout、daemon/non-blocking close 和正常/异常槽位释放通过轻量 2 项测试。通用 500 响应不再回显异常正文。
- Compose/systemd：PostgreSQL/Web/Worker/Migrate/Admin/Caddy 均配置 CPU、Memory、Memory+Swap、PID 限额；Web/Worker Node heap 384 MiB。unit 源含 CPU 75%、MemoryHigh 512M、MemoryMax 768M、Tasks 256、NOFILE 4096 并通过 verify；只读核验确认起点 installed unit 已一致且实际属性生效，本任务未复制、reload 或重启 Python。
- 运行应用：校验 PostgreSQL custom dump 后，固定 `COMPOSE_PARALLEL_LIMIT=1`、不 build，只逐个重建 Web/Worker；PostgreSQL 保持原容器。实际 inspect 与配置目标一致，26 migrations、唯一管理员、空业务基线、网络边界和四卷保持。
- 资源观察：起止 available memory 均约 2.2 GiB、Swap 约 42 MiB、磁盘可用 26 GiB，Load `0.33/0.27/0.49` → `0.05/0.14/0.32`；60 秒 Swap 增长 0，restart 0、OOM false，PostgreSQL/Web healthy、Worker running。
- 事故边界：2026-07-27 服务器重启/不可用根因 `UNKNOWN`，不得写成 OOM。Python 仍保留且只能由独立授权任务停用；结论不表示生产上线。
- 验证：Python 专项/self-test/smoke/临时 SQLite go-live、Compose config、systemd verify、受限单容器 TypeScript check、环境守卫、credentials scan 与 Git 检查串行执行；临时资源清理完成，恢复备份按计划保留。
- 结论：`LOW RESOURCE SERVER SAFEGUARDS ACTIVE`；未启动 PHASE5-TASK03，未 push、迁真实数据、切流或生产部署。

### SELFHOST-PHASE5-TASK02 - `ops: accept production wip workflow in parallel environment`

- 提交：功能提交 `77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c`，Parent 严格为 `d6554fcaea77cfe16320d98afcf9aed9c794bc3f`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.26`/26 migrations；`0026` SHA-256/数据库 checksum 为 `b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：production 账号对锡膏印刷、SMT贴片、回流焊、AOI 四个 Snapshot Operation 依次执行批次 `4/6` 的派工、开工和工序报工；每工序 processed/good/scrap=`10/10/0`，前三工序未转移 WIP 0，末工序 final output available 10。
- 业务边界：Work Order 保持 `IN_PROGRESS`；Production Report、Completion、Finished Goods Ledger/Balance、IPQC/FQC 均为 0。工序 WIP 未写入库存，也未虚构库位、批次或成品数量。
- 保护：权限 403、active operator、Work Center、前序来源、跳序、超量/并发派工、重复/并发开工、数量守恒、幂等重放/异正文冲突、CAS、scrap 隔离、取消、下游消费冲销阻断、无下游冲销恢复、故障零半记录和直接 SQL guard 通过。
- 持久与恢复：整体重启后 8 Run、8 Report、24 Event、4 Operation Projection、4 WIP 和 24 相关 Audit 保持；停服备份 `backup-20260726T235722Z-77ff520e8dbd` 校验并恢复到新空库，核对 `26|2|1|4|8|8|24|4|10|0|0|0`。
- 清理与保护：最终 26 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0，仅三容器四卷；临时数据库、备份/恢复目录、测试 SQLite、依赖卷和迁移容器均删除。任务未重启 Python；开始时 PID `277640`，外部并行变更后最终 PID 为 `13737`，SQLite metadata 最终仍为 `64769:53827608:1784999031:1544192`。
- 结论：`PRODUCTION OPERATION EXECUTION AND WIP ACCEPTED IN PARALLEL ENVIRONMENT`。未执行最终报工绑定、成品入库、返工、批次、设备、产能排程、真实数据迁移、切流、生产部署、push 或 PR。

### SELFHOST-PHASE5-TASK02 - `feat: add production operation execution`

- Git：功能提交 `77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c` 严格以 `d6554fcaea77cfe16320d98afcf9aed9c794bc3f` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0026_production_operation_execution.sql`，建立 Work Order Operation/WIP Projection、Run、Input Allocation、Run Report/Event/Reversal；完整外键、唯一、numeric、索引、不可变事实、服务写投影和延迟数量守恒 guard，同步 Drizzle Schema/journal/snapshot，不修改 0001—0025。
- 服务/API：Snapshot Operation 为工单执行权威；首工序取净领料支持量，后序按前序 Run good 的稳定 Allocation 线性消费；派工/取消、开工、追加报工和受控全额冲销在单事务内提交事实、投影、Audit 和 Idempotency。
- 权限/UI：新增 `production.dispatch`、`production.execute`、`production.operation.reverse`；production 获得 dispatch/execute，manager/admin 获管理能力，warehouse/quality 只读；新增 `/production/dispatch`、`/production/operations`、`/production/wip` 和五项 Dashboard 指标。
- 验证：TASK02 unit/UI/PostgreSQL/migration、Phase 4 TASK01—TASK10、Phase 5 TASK01、Production/Routing/Inventory/Dashboard、全部正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 临时库三项和 `git diff --check` 通过。
- 边界：WIP 不是 Inventory Ledger；最后工序 good 只形成待最终报工量，不自动创建 Production Report、Completion、库存或品质事实。

## 2026-07-26

### SELFHOST-PHASE5-TASK01 - `ops: accept production routing workflow in parallel environment`

- 提交：功能提交 `8eedfa07573c37e46d93f208162a0842c8d90a48`，Parent 严格为 `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.25`/25 migrations；`0025` SHA-256/数据库 checksum 为 `39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：operations 创建 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI`；engineering 提交 v1，异人 manager 发布；planned quantity 10 的工单释放后获得 BOM Snapshot 1、Routing Snapshot 1、10/20/30/40 四工序与 Reservation 10。
- 版本快照：v1 digest `d9756e1e1751c861953927dd299d89e57d90c5ddbcda2bde8d6600dcfa922f06`；v2 修改回流焊标准时间后发布，digest `2a3c5cda38ed6462f58b6d445a979fab58a3d6fccc255e1ee5be6bb934865962`。首张工单仍完整保持 v1，新工单使用 v2。
- 原子性与保护：路线缺失、停用、digest/产品版本不匹配和故障注入均整体回滚；职责分离、403、并发唯一 current、幂等重放/异正文冲突、CAS、Released/Snapshot 数据库不可变 guard 通过。路线本身不改变 on-hand；Material Issue、Production Report、Completion 均为 0。
- 持久与恢复：整体重启后 4 Work Center、2 Routing、2 Snapshot、8 Snapshot Operations、7 Routing Event 和 11 Audit 保持；停服备份 `backup-20260726T144314Z-8eedfa07573c` 校验并恢复到新空库，精确核对 `25|4|2|2|7|0|0|0`。
- 清理与保护：最终 25 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0，仅三容器四卷；临时数据库、备份/恢复目录和迁移容器删除。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PRODUCTION ROUTING AND WORK ORDER SNAPSHOT ACCEPTED IN PARALLEL ENVIRONMENT`。未执行工序开工/完工/报工、WIP、库存过账、真实数据迁移、切流、生产部署、push 或 PR。

### SELFHOST-PHASE5-TASK01 - `feat: add production routing snapshots`

- Git：功能提交 `8eedfa07573c37e46d93f208162a0842c8d90a48` 严格以 `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0025_production_routings.sql`，建立 Work Center、Routing Header/Version/Operation/Event 与 Work Order Routing Snapshot/Operation；补全外键、唯一、numeric、索引、不可变 guard 和服务 GUC，同步 Drizzle Schema/journal/snapshot，不修改 0001—0024。
- 服务/API：Work Center code 标准化、不可改、CAS 启停；Routing `DRAFT -> SUBMITTED -> RELEASED` 与退回、异人发布、服务端 canonical digest、并发唯一 current；Work Order RELEASE 在 TASK06 单事务中追加路线复核与不可变快照，失败零半记录。
- 权限/UI：operations 管理 Work Center，engineering 编辑/提交，manager/admin 发布/退回，production/planning 受限读取；新增 `/operations/work-centers`、`/engineering/routings`、`/production/dispatch` 及四项权限裁剪 Dashboard 指标，不提供虚假工序执行按钮。
- 验证：TASK01 unit/UI/PostgreSQL/migration、Phase 4 TASK01—TASK10 与 Production/Planning/BOM/Inventory/Dashboard 回归、正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 三项和 `git diff --check` 通过。
- 边界：旧 `process_stage` 只保留历史兼容，不自动生成路线；历史工单显示 `LEGACY_UNSTRUCTURED`；未实现派工、开工、完工、工序报工、WIP、返工、批次、设备、外协或库存过账。

### SELFHOST-PHASE4-TASK10 - `ops: accept project cashflow workflow in parallel environment`

- 提交：功能提交 `23fef6098a88466b94fcac104bba9317ba310d15`，Parent 严格为 `e63c726e0d274a8b7b654819794b4bd1044c6f82`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.24`/24 migrations；`0024` SHA-256 `cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：AR `80/120`、AP `48/72`；收款 `30/50/120`、付款 `48/30/42`；Sales/Purchase Source `200/120`，未结 `0/0`、交易贡献/净现金 `80/80 CNY`、UNATTRIBUTED 0、Settlement Reversal 0、银行写入 0。
- 保护：类型错配、零/负/超额、并发、幂等/CAS、全额/重复/并发冲销、故障回滚、多 Project、UNATTRIBUTED、rounding、币种隔离、403 及 TASK05/TASK09 冲销门禁通过。
- 持久与恢复：整体重启后事实保持；停服备份 `backup-20260726T133340Z-23fef6098a88` 校验并恢复到新空库，精确核对 24 migrations、AR/AP、6 Settlement、4 Allocation、200/120 来源、UNATTRIBUTED/冲销 0。
- 清理与保护：最终 24 migrations、唯一启用管理员、业务/上传/附件 0，仅三容器四卷；临时恢复与备份工件删除。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PROJECT RECEIPT PAYMENT AND CASHFLOW ACCEPTED IN PARALLEL ENVIRONMENT`。未连接银行、迁真实数据、切流、生产部署、push 或 PR，也不宣称会计利润。

### SELFHOST-PHASE4-TASK10 - `feat: add project settlement traceability`

- Git：功能提交 `23fef6098a88466b94fcac104bba9317ba310d15` 严格以 `e63c726e0d274a8b7b654819794b4bd1044c6f82` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0024_finance_project_settlements.sql`，保存 Financial Source 行→Project/UNATTRIBUTED、数量/单价/金额/digest，补充外键、唯一/索引、延迟总额核对、不可变和稳定来源直接 SQL guard；同步 Drizzle Schema/journal/snapshot，不修改 0001—0023。
- 服务/API：复用唯一 Finance Document/Settlement/Reversal；AR 只收款、AP 只付款，部分/多次核销和追加式全额冲销保持单事务、并发锁、CAS、幂等、Event/Audit；项目视图按 Project/Currency 汇总来源、收付款和未结。
- 权限/UI：finance 管理收付款，manager/admin 查看项目汇总，sales/purchase 职责只读，engineering 查看本人项目去敏汇总；新增 `/finance/settlements`、`/finance/projects` 和六项 Dashboard 指标。
- 验证：TASK10 专项、TASK01—TASK09 回归、正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 隔离基线和 `git diff --check` 通过。
- 边界：`net_cash` 不是会计利润；未实现银行、总账、税票、汇率、成本会计、公司费用、正式利润、真实迁移或生产部署。

### SELFHOST-PHASE4-TASK09 - `ops: accept sales delivery receivable workflow in parallel environment`

- 提交：功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4`，Parent 严格为 `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.23`/23 migrations；`0023` checksum/SHA-256 为 `5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启 HTTPS/80/443。
- 实际 HTTP：Instruction 10 分两批 Shipment/FQC `4/6`；成品库存 `10→6→0`，SO 最终 SHIPPED，Sales Source `80/120`，finance 显式 AR `80/120`，Settlement/客户收款 0；三个原生页面 HTTP 200。
- 保护：实际验证指令零副作用、幂等重放、quality 越权 403、已有 AR 冲销门禁；隔离测试覆盖超订单/指令/库存/FQC、并发消费/执行/AR、CAS、异正文冲突、故障零半记录、无 AR 冲销恢复和 FQC Reopen 门禁。
- 持久与恢复：整体重启后 4/6 数量、库存、来源、AR、事件和审计保持；停服备份 `backup-20260726T105516Z-dfda1c5597cc` 校验并恢复到新空库为 `23|7|1|2|10|-10|200|200|0`。
- 清理与保护：最终 23 migrations、唯一启用管理员、业务/上传/附件 0，只保留三容器四卷；临时库和备份/恢复工件已删除。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT`。未收款、未迁真实数据、切流、生产部署、push 或 PR。

### SELFHOST-PHASE4-TASK09 - `feat: add fqc controlled sales delivery workflow`

- Git：功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4` 严格以 `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0023_sales_delivery_receivable.sql`，建立发货指令/行/事件、执行行和 Shipment Line→FQC Release Allocation，补充容量、来源、不可变、FQC reopen 与可信金额数据库 guard；同步 Drizzle Schema/journal/snapshot，不修改 0001—0022。
- 服务/API：复用 Sales Order/Shipment/Reversal、TASK08 Allocation/FQC、Inventory Ledger/Balance、Sales Financial Source 和 Finance AR；Instruction 创建零副作用，warehouse 分批执行原子更新全部跨域事实，finance 仍显式创建 AR。
- 权限/UI：sales、warehouse、quality、finance 和 manager/admin 最小分权；新增 `/sales/delivery`、`/warehouse/shipping`、`/finance/receivables` 与五项 Dashboard 指标。
- 验证：TASK09 unit/UI/PG/migration、TASK01—TASK08 及 Sales/Quality/Inventory/Finance/Dashboard 回归、17 个正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 三项和 `git diff --check` 通过。
- 边界：未实现或执行客户收款、Settlement、银行、总账、税票、收入确认、真实数据迁移或生产部署。

### SELFHOST-PHASE4-TASK08 - `ops: accept production quality workflow in parallel environment`

- 提交：功能提交 `4a638522b7ca295b41d2f35adbc464b23762b007`，Parent 严格为 `7d9c2dbaf62664e46c4f984822bb43903999f5fd`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.22`/22 migrations；`0022` 数据库 checksum 与源码 SHA-256 均为 `65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 HTTPS/80/443。
- 实际 HTTP：production/warehouse/sales/quality/manager 真实隔离账号完成 Report、Completion、成品订单稳定 Allocation、IPQC 和 FQC 各 `4/6`；manager RELEASE、quality Close 后 FQC inspected/passed/released=`10/10/10`，订单行 available=10，成品库存保持 10。
- 边界与保护：Shipment、Sales Financial Source、AR 均为 0；实际验证职责分离、越权 403、幂等重放和 CAS，隔离自动测试覆盖来源不一致、双侧超分配/并发、取消与 Completion 冲销门禁、超检、Defect 守恒、处置上限、HOLD、消费后重开门禁和故障零半记录。
- 持久与恢复：整体重启后 2 Allocation/2 Allocation Event、4 Inspection/Result、12 Inspection Event、放行 10、库存 10 和 14 个关键成功审计保持；停服备份 `backup-20260726T062301Z-4a638522b7ca` 校验并恢复到新空库为 `22:2:4:4:12:10:10:0:0:0`。
- 清理与保护：主库最终 22 migrations、唯一启用管理员、业务/上传/附件 0；临时数据库、备份/恢复目录、辅助容器/镜像已删除且不可从本机临时工件恢复，保留三容器和四卷。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PRODUCTION QUALITY RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`。未迁真实数据、切流、生产部署、push 或 PR；未启动 Shipment、AR、收款或其他任务。

### SELFHOST-PHASE4-TASK08 - `feat: add production quality release workflow`

- Git：功能提交 `4a638522b7ca295b41d2f35adbc464b23762b007` 严格以 `7d9c2dbaf62664e46c4f984822bb43903999f5fd` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0022_production_quality_release.sql`，建立 Completion Line→Sales Order Line Allocation/Event、Quality Inspection 稳定 Allocation 引用、容量/来源/不可变/冲销数据库 guard；保留历史 Quality 兼容并同步 Drizzle Schema/journal/snapshot，不修改 0001—0021。
- 服务/API：复用 `quality-selfhost` 的 Inspection/Result/Defect/Event、职责分离、Disposition、Close/Reopen 与 Shipment 门禁；新增分配候选/列表/创建/取消和订单行 eligibility，IPQC 只引用未冲销 Report，FQC 只引用有效 Allocation。
- 权限/UI：sales 管理分配，quality 创建/关闭检验，manager/admin 处置/重开，production/warehouse 受限读取；新增两条原生页面和五项权限裁剪 Dashboard 指标。
- 验证：TASK08 unit/UI/PostgreSQL/migration、TASK01—TASK07 与 Production/Quality/Sales/Inventory/Dashboard 回归、16 组 typecheck、Schema consistency、lint/build、凭证扫描、Python 三项和 `git diff --check` 通过。
- 边界：功能不执行 Shipment、不扣减成品库存、不创建销售金额来源、AR 或收款，不扩展 IQC 隔离、批次/序列、返工/报废过账，不迁真实数据或生产部署。

### SELFHOST-PHASE4-TASK07 - `ops: accept production completion workflow in parallel environment`

- 提交：功能提交 `323e85d44a2a4202811944591d0a4f6b96ae6751`，Parent 严格为 `26ccb95782478645720c8284c59b0afadca68649`；独立 ops 提交以功能提交为 Parent，不 amend，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.21`/21 migrations；数据库 `0021` checksum 与源码 SHA-256 均为 `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 HTTPS/80/443。
- 实际 HTTP：复现 TASK06 完整领料 10；production 分批 Report `4/6`，warehouse 分批 Completion `4/6`，Allocation、Completion Line 和成品 Ledger 均为 `4/6`，Work Order reported/good/completed=10、scrap=0、状态 `COMPLETED` 且无 `CLOSED` 事件，成品 Balance=10。
- 下游与保护：IQC/IPQC/FQC、Shipment、销售金额来源和 AR 均为 0；隔离自动测试覆盖领料支持量、good/scrap、Report/工单余量、并发消费、幂等异正文、CAS、故障零半记录、越权、scrap 零库存以及 Report/Completion 冲销与 IPQC/FQC/Shipment 门禁。
- 持久与恢复：PostgreSQL/Web/Worker 整体重启后全部 Handoff/Reservation/Issue/Report/Allocation/Completion/Ledger/Event/Audit 持久；接受态备份 `backup-20260726T050445Z-323e85d44a2a` 恢复为 21 migrations、2 Report/Allocation/Completion、Balance 10、下游 0；干净态备份 `backup-20260726T050530Z-323e85d44a2a` 恢复为 21 migrations、唯一管理员、业务/文件 0。
- 清理与保护：两份临时备份、恢复数据库/目录、隔离测试数据库、辅助容器/镜像均已删除且不可从本机临时工件恢复；最终仅三容器和四个并行持久卷。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PRODUCTION REPORTING AND FINISHED GOODS RECEIPT ACCEPTED IN PARALLEL ENVIRONMENT`。未创建品质/发货/财务事实，未迁真实数据、切流、生产部署、push 或 PR。

### SELFHOST-PHASE4-TASK07 - `feat: add production reporting and completion handoff`

- Git：以 `26ccb95782478645720c8284c59b0afadca68649` 为严格 Parent；不 revert/reset/amend/rebase，不 push 或创建 PR。
- 数据库：仅新增 expand-only `0021_production_reporting_completions.sql`，复用既有 Work Order/Report/Completion/Inventory 权威并增加 Report→Completion Allocation、Report/Completion reversal、不可变事件和 version/投影 guard；同步 Drizzle Schema/journal/snapshot，SHA-256 `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`，不修改 `0001`—`0020`。
- 服务/API：Report 只消费 BOM Snapshot 与净领料共同支持量；Completion 必须显式消费未占用 good quantity，并在同一事务原子写 Allocation、成品 Ledger/Balance、工单投影/状态、Event/Audit/Idempotency。Report/Completion 全额冲销均追加反向事实并执行 IPQC/FQC/Shipment/库存下游门禁。
- 权限/UI：production 报工并按授权冲销，warehouse 分批完工入库/冲销，manager/admin 管理，其他角色无写权限；新增 `/production/reporting`、`/warehouse/production-completions`，扩展工单进度和四项权限裁剪 Dashboard 指标。
- 验证：TASK07 unit/UI/PostgreSQL/migration，TASK01—TASK06、Production/Inventory/Quality/Sales/Dashboard 回归，全部正式 typecheck、Drizzle consistency、lint/build、凭证扫描、环境/API coverage、Python 三项和 `git diff --check` 已通过；并行真实 HTTP、整栈重启、备份恢复与最终清理将在独立 ops 验收提交完成。
- 边界：未创建 IQC/IPQC/FQC、Shipment、销售金额来源或 AR/AP；未迁真实数据、启用 HTTPS/80/443、切流或生产部署。

### SELFHOST-PHASE4-TASK06 - `ops: accept production material issue workflow in parallel environment`

- 提交：功能提交 `a8272b7c968e0fdcbce017aa0e41bad281702e50`，Parent 严格为保留的 `b45616e1115aab7d22d1b9a7e58f792005291524`；独立 ops 提交不 amend，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.20`/20 migrations；`0020` 数据库 checksum 与源码 SHA-256 均为 `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 HTTPS/80/443。
- 实际 HTTP：planning/production/warehouse 真实隔离账号完成 v1 提交→production 退回、planning 新建并提交 v2→production 接收→唯一 DRAFT 工单；DRAFT reserved/Issue/Ledger 为 0。释放后 requirement/on-hand/reserved/available=`10/10/10/0`；warehouse 分批领料 4/6 后余额依次 `6/6`、`0/0`，net issued 依次 4/10，两个出库 Ledger 合计 -10，工单为 IN_PROGRESS。
- 下游与保护：Production Report、Completion、Finished Goods Ledger、IQC/IPQC/FQC 均为 0；隔离测试覆盖缺料零半记录、并发预留、重复工单、超领、持久幂等、CAS、故障注入、未领取消释放、已领取消阻止、退料恢复和越权 403。
- 持久与恢复：整栈重启后 2 个 Handoff、1 个 WO、1 个 Reservation、2 个 Issue 和下游零事实保持；接受态 0020 停服备份恢复到新空库通过，最终干净 0020 再次备份并恢复到第二个新空库为 20 migrations/唯一管理员/业务 0。
- 清理与保护：并行主库最终 20 migrations、唯一启用管理员，所有业务表、uploads、attachments 为 0；临时数据库、恢复目录、备份工件、临时容器/镜像已清理，四个并行持久卷保留。Python systemd 仍 `enabled/active`、PID `277640`、SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PLANNING TO PRODUCTION MATERIAL ISSUE ACCEPTED IN PARALLEL ENVIRONMENT`。未执行报工、完工、品质、真实数据迁移、HTTPS、切流、生产部署、push 或 PR。

### SELFHOST-PHASE4-TASK06 - `feat: add planning to production material handoff`

- Git：以必须保留的仅文档提交 `b45616e1115aab7d22d1b9a7e58f792005291524` 为严格 Parent；不 revert/reset/amend/rebase，不 push 或创建 PR。
- 数据库：仅新增 expand-only `0020_production_handoff_reservations.sql`，建立版本化 Handoff/Item/Event、交接行→既有 Work Order 唯一链接和 Production Inventory Reservation/Event；同步 Drizzle Schema/journal/snapshot，SHA-256 `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`，不修改 `0001`—`0019`。
- 服务/API：新增 `production-handoff-selfhost` 编排边界；接收后调用既有 Production 事务入口创建唯一 DRAFT 工单。RELEASE 在同一事务复制既有 BOM Snapshot/Requirement、结构化核验缺料、写 Reservation 来源事实并更新 Balance；领退料继续复用既有 Production/Inventory 权威入口。
- 权限/UI：planning 准备/提交，production 接收/退回/建单/释放，warehouse 分批领退料，manager/admin 管理；新增 `/planning/production-handoffs`、`/production/work-orders`、`/warehouse/production-issues` 和四项权限裁剪 Dashboard 指标。
- 验证：TASK06 unit/UI/typecheck、隔离 PostgreSQL 主旅程与保护、TASK01—TASK05、Planning/Inventory/Production/Dashboard、空库/0019 升级/重复/失败回滚、全部正式 typecheck、Drizzle consistency、lint/build、凭证/环境/API coverage 和 Python 三项已通过；并行 HTTP/重启/恢复/清理将在独立 ops 验收提交完成。
- 边界：未实现或执行报工、完工、成品库存、品质、发货、付款/银行/总账/税票、真实数据迁移、HTTPS、切流或生产部署。

### PHASE0-TASK03 - `docs: establish self-hosted release tracking baseline`

- Git：以 clean 的 `main` / `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4` 为起点；只读远端核验 `origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`，本地任务开始时领先 27 个提交，不再沿用“已同步”的旧描述。
- 发布：保留 2026-07-24 的 `0.1.0-alpha.1`/PostgreSQL `0001`—`0005` 原始非生产定义；当前源码与回环并行验收面记录为 `chenyida-erp-selfhosted@0.1.0-alpha.19`/`0001`—`0019`，没有降级 package 或升级依赖。
- Migration：重新核对 PostgreSQL `0001`—`0019`、D1 `0000`—`0008`、SQLite `0001`—`0004` 的仓库文件与 SHA-256；并行 PostgreSQL 19 个已应用 checksum 和本机 SQLite 四个已应用版本均通过只读核验，未访问生产 D1/数据库。
- 运行面：确认 Python/SQLite systemd 仍 `enabled/active`、PID `277640`、监听 `0.0.0.0:18888`；Node/PostgreSQL 仅为回环并行开发验收环境，未生产发布。真实账号、文件和业务数据未迁移，采购、库存、生产、销售、品质、财务仍依赖 Python/SQLite。
- 文档：更新 `RELEASES.md` 的版本矩阵、验收/回退模板和后续复核记录，同步 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`STATUS.md`，并在 TASK04 完成报告中只追加后续提交事实而不改写原始 dirty 状态。
- 验证：Node lint 0 error/5 个既有 warning、test 3/3、review typecheck、Vinext build 5/5、凭证扫描 819 文件；Python self-test、smoke、临时 SQLite go-live 与 `git diff --check` 通过。仅文档变更，未访问生产、部署、迁移真实数据、重启服务、push 或创建 PR。

### SELFHOST-PHASE4-TASK05 - `ops: accept sourcing fulfillment workflow in parallel environment`

- 部署：在既有 `chenyida-erp-parallel` 原地从 `0018` 升级到 `0019`，PostgreSQL/Web healthy、Worker running；Web 仍仅绑定 `127.0.0.1:3000`，PostgreSQL 不暴露宿主端口。
- 实际旅程：purchase 显式把供应商 A 的 Award `10 × 12` 转为 PO 并建立到货计划；创建计划时 Receipt/Ledger/AP 均为 0。warehouse 分两批收货 `4/6`，库存为 `4/10`，采购财务来源为 `48/72`；finance 分别显式生成 AP `48/72`，AP 合计 `120`。
- 安全与一致性：实际 HTTP 验证分权、同正文幂等重放、异正文冲突、CAS、超收拒绝、已有 PO 阻止 Award 撤销、已有 AP 阻止 Receipt 冲销；专项 PostgreSQL 测试覆盖并发唯一转单和故障注入零半记录。
- 持久与恢复：Compose 整体重启后 Award→PO→Plan→Receipt→Ledger/Balance→Source→AP 数量、金额、事件和审计保持；停服备份通过校验并恢复到第二个新空数据库，随后用干净 `0019` 恢复点清理当前并行库。
- 清理与保护：最终 19 migrations、唯一启用管理员、零临时账号和零合成业务；Python PID `277640`、18888 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变；未 push、未切流、未迁真实数据、未部署生产，不启动 TASK06。
- 结论：`SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK05 - `feat: connect sourcing awards to receiving and payables`

- 数据库：新增且仅新增 expand-only `0019_sourcing_purchase_fulfillment.sql`，建立 Award Line→PO Line、到货计划、待入库队列、Receipt Line 分配和不可变计划事件；同步 Drizzle schema/journal/snapshot，SHA-256 为 `6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a`，不修改 `0001`—`0018`。
- 服务/API：新增 `procurement-fulfillment-selfhost` 编排边界，显式转 PO、显式建计划、分批收货/冲销；单事务复用既有 Procurement Receipt、Inventory Ledger/Balance 和 purchase financial source，Finance 仍由财务人员显式消费来源生成 AP。
- 规则：关系唯一约束、行锁、持久幂等、expected version/CAS 和数据库 guard 保证 Award Line 最多转一次、来源事实不静默变化、禁止超收和部分提交；已生成 PO 的 Award、已有 AP 的 Receipt 均 fail closed。
- 权限/UI：purchase、warehouse、finance 与 manager/admin 最小分权；新增 `/procurement/fulfillment`、`/warehouse/receiving`、`/finance/payables` 三条原生可操作页面，Dashboard 区分待生成和已生成 AP。
- 验证：TASK05 unit/UI、PostgreSQL/API、migration、TASK01—TASK04 及 Identity/Master Data/Supplier Mapping/Procurement/Inventory/Finance/Dashboard 回归、全部正式 typecheck、Schema consistency、lint/build/凭证/Python 基线通过；功能提交为 `859454c97acddbff8c5199d91c41d636a6ca24e0`。

### SELFHOST-PHASE4-TASK04 - `ops: accept procurement sourcing workflow in parallel environment`

- 部署：从功能提交 `4506db2579c07080afe27b33bb2e50623c3d1366` 重建并行 migrate/Web/Worker，只应用 `0018`；PostgreSQL/Web healthy、Worker running，Web 保持 `127.0.0.1:3000`。
- 实际旅程：临时 planning/purchase 账号通过 must-change 和分权；A 报价 `12.000000`、准时、排名 2，B 报价 `10.000000`、晚交、排名 1；采购以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”选择 A。
- 下游证据：Award=1、Sourcing Event=5、成功采购审计=6，而 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 为 `2.000000` 且未变。
- 持久与清理：Compose 整体重启后 Award/理由/API/UI 持久；随后整体恢复干净 0018 点，最终 18 migrations、唯一管理员、全部验收业务 0；临时账号、脚本和 root-only 恢复工件已删除。
- 保护：Python PID `277640`、18888 和 SQLite metadata `64769:53827608:1784999031:1544192` 不变；未迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK05。
- 结论：`PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK04 - `feat: add procurement sourcing workflow`

- 数据库：新增 expand-only `0018` 十表 RFQ/报价版本/比较版本/Sourcing Award/Event 模型、`numeric(24,6)`、有效 Round/当前报价/每行唯一 Award 索引、稳定外键、服务写守卫与不可变/来源完整性 trigger；不修改 0001—0017。
- 规则/API：新增独立 `procurement-sourcing-selfhost` 边界和 9 组路由；只接最新 ACCEPTED 采购申请与 ACTIVE/1:1 Mapping 供应商，固定 CNY/单位口径，服务端按税费/运费分组确定性排名，人工理由定标与保留历史撤销。
- 权限/UI：purchase 全部询比价能力，planning 进度只读，manager/admin 全部；新增两条原生采购询价路由与 Dashboard 三项待办，不提供创建采购订单入口。
- 安全/边界：Session/must-change、权限、CSRF、有界正文、持久幂等、CAS、并发锁、Event/Audit/Idempotency 单事务；Award 不创建 PO/Receipt/Inventory/AP，不修改 Planning Allocation 或 `reserved_qty`。
- 验证：专项 unit/UI 6/6、PostgreSQL/API 2/2、migration 3/3、Schema consistency 与目标 typecheck 通过；Identity、Supplier Mapping/Master Data、Procurement、Project、Planning、Material Requirement、Dashboard、FileStorage 与环境守卫回归通过；ESLint 0 error、Vinext build 5/5、800 文件凭证扫描、diff check 和 Python 三项通过。并行环境验收在功能提交后独立记录。

### SELFHOST-PHASE4-TASK03 - `ops: accept planning material requirement workflow in parallel environment`

- 部署：从功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969` 重建并行 migrate/Web/Worker，只应用 `0017`；PostgreSQL/Web healthy、Worker running，Web 继续只绑定 `127.0.0.1:3000`。
- 实际旅程：临时 planning/purchase 身份完成 `100.000000 - 55.000000 - 40.000000 = 5.000000` 的 v1 提交、采购退回释放、v2 重算重提和最终接收；正式 `reserved_qty` 保持 `10.000000`。
- 持久与清理：Compose 重启后 v2 Plan/PR ACCEPTED 与页面/API 保持；随后用已验证 `0016` 恢复点清理并重新应用 `0017`，最终 17 migrations、唯一管理员，全部 TASK03/Project/PO/Receipt/WO 业务为 0，临时恢复工件已删除。
- 保护：没有新增 PO、收货或工单；Python PID `277640`/18888 保持，未读/迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK04。
- 结论：`PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK03 - `feat: add planning material requirement handoff`

- 数据库：新增 expand-only `0017` 六表、`numeric(24,6)` 数量、关系约束/索引、服务写守卫、不可变与延迟完整性 trigger；Planning Allocation 独立于 Inventory `reserved_qty`。
- 规则/API：只聚合最新 ACCEPTED Package 固化 Material+Unit；SUBMIT 锁定来源并由 PostgreSQL 重算库存/有效在途/其他计划分配，来源变化稳定冲突；只为正净需求创建 PRQ，退回释放有效分配且必须新版本重算。
- 权限/UI：planning prepare/submit，purchase decide，manager/admin 全部；新增 7 组 API、计划物料需求与采购申请工作台、Dashboard 待办，不创建 RFQ/供应商/比价/PO/收货/生产事实。
- 验证：TASK03 unit/UI 6/6、PG/API 3/3、migration 3/3；TASK02、Dashboard、migration tool、FileStorage、typecheck、lint/build、780 文件凭证、diff check 与 Python 三项通过。功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969`。

## 2026-07-25

### SELFHOST-PHASE4-TASK02 - `ops: accept project planning workflow in parallel environment`

- 部署：从功能提交 `9236884f6cd96385c9c7050b29f57e7268142208` 重建并行 migrate/Web/Worker，只应用 `0016`；PostgreSQL/Web healthy、Worker running，Web 继续只绑定回环。
- 实际旅程：临时 sales/engineering/planning 身份完成项目接收、显式 Product/BOM Resolution、v1 不可变快照提交、计划退回、项目修订生成 v2、重提与最终接收；numeric 毛数量为 `34.375000`。
- 持久与清理：Compose 重启后 Project、两个包、事件、队列 API 与原生页面保持；随后整体恢复干净 0016 点，最终 16 migrations、唯一管理员，所有合成主数据/项目/交接/采购/生产记录为 0。
- 保护：Python PID `277640`、18888 和 SQLite metadata 不变；未读/迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK03。
- 结论：`PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK02 - `feat: add project planning handoff workflow`

- Identity/权限：新增正式 planning 角色及 read/accept 能力；engineering 获 read/prepare/submit，manager/admin 全能力，production 不代替计划员。
- 数据库：新增 expand-only `0016` 六表独立 Project→Planning 模型、稳定 Resolution、不可变版本包/BOM/文件快照和只追加事件；同步 schema/journal/snapshot/checksum，不修改 0001—0015 或 TASK01 事实。
- API/UI：新增独立 planning-handoff 服务边界、8 条 API、项目解析/版本工作台、计划待办/接收/退回工作台和 Dashboard 待接收指标。
- 规则：只接受 ACCEPTED 项目负责人、客户一致 RELEASED Product/BOM、ACTIVE Material/enabled Unit；PostgreSQL numeric 固化毛数量，不读库存、不创建需求/采购/生产单据。
- 验证：TASK02 unit/UI 6/6、PG/API 3/3、migration 3/3、Schema consistency、typecheck、lint、build 通过；功能提交为 `9236884f6cd96385c9c7050b29f57e7268142208`，后续并行验收由独立 ops 记录。

### SELFHOST-PHASE4-TASK01 - `ops: accept market project workflow in parallel environment`

- 部署：从功能提交重建 `chenyida-erp-parallel` migrate/Web/Worker，只应用 `0015`；管理员保留，Web/PostgreSQL healthy、Worker running。
- 实际旅程：两个独立 sales/engineering 账号完成直接接收，以及退回原因→不可变需求 v2→重新提交→最终接收；两个项目最终 ACCEPTED，四类事件和 Project Audit/request_id 完整。
- 持久与清理：Compose 重启后事实保持；随后恢复 0015 已应用的空验收点，临时账号、客户、项目和事件清零，Schema/唯一管理员保留，临时 root-only 恢复点删除。
- 保护：Python PID `277640`、18888 与 SQLite inode/size/mtime/mode 不变；未读/迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK02。
- 结论：`MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK01 - `feat: add market project handoff workflow`

- 数据库：新增 expand-only PostgreSQL `0015` 六表关系模型、稳定项目编号、需求版本/行、受控文件引用、交接投影和不可变事件；同步 Drizzle journal/snapshot/schema 与固定 checksum，不修改 0001—0014。
- 服务端：新增独立 Project Repository/Service/Handler/Validation；sales 市场和 engineering 项目严格分权，执行 CSRF、24h 持久幂等、CAS、并发锁、职责分离、中文稳定错误、request_id 和单事务 Audit。
- UI：新增 `/business/projects` 与 `/engineering/projects`，覆盖草稿/修订/提交、退回原因/重提、待接收/已接收和安全资料元数据；Dashboard 增加“市场部门”“项目部门”入口。
- 验证：专项 unit/UI 7/7、PG/API 3/3、migration 3/3；Identity/Master/Sales unit/UI 21/21、PG/API 14/14；typecheck、lint、build、manifest、credentials、diff check 和 Python 临时 SQLite 三项通过。
- 边界：功能提交后才部署并行验收环境；当前不标记 DONE，不启动 TASK02，不迁真实数据，不创建下游 Product/BOM/计划/采购/生产对象。

### SELFHOST-PHASE3-TASK05 - `ops: deploy parallel self-hosted acceptance environment`

- 部署：创建并保持运行 Compose 项目 `chenyida-erp-parallel`，只启动 PostgreSQL 17、migrate、Web、Worker和四个持久 Volume；版本保持 `0.1.0-alpha.14`，migration 保持 `0001`—`0014`。
- 安全：配置和一次性管理员凭据位于 `/etc/chenyida-erp/`，root-only 0600；管理员密码不进长期 env。setup token 初始化后已轮换；Web 只绑定 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启动 Caddy/80/443。
- 管理员与验收：创建唯一 `admin`，重复初始化返回 `SETUP_COMPLETE`；health、根工作台、login/session/logout、Dashboard 空状态和 23/23 legacy GET 通过，完整重启后 14 migrations 与管理员持久。
- Bug 修复：处理 PostgreSQL restart 时 `pg` Pool 空闲连接 `57P01`，只记录去敏 code；Worker 轮询对短暂基础设施错误重试。新增 2 个专项测试，并通过 typecheck、目标 lint、镜像 build 与只重启数据库的 Worker 进程连续性验收。
- 资源保护：部署前后 Python PID 均为 `277640`、18888 返回 200，SQLite inode/mode/size/mtime 不变；稳态可用内存约 2.2GiB、磁盘 39GB，未触发停止条件。
- 文档：新增任务/完成报告和 `parallel-http-acceptance.md`，同步 MASTER/TASKS/PROJECT_CONTEXT/ARCHITECTURE/RELEASES/STATUS。
- 边界：结论仅为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`；未迁真实数据、未双写、未切流、未启 HTTPS、未修改 Python systemd/SQLite、未访问 D1/远程数据库、未 push/PR。

### SELFHOST-PHASE3-TASK04 - `feat: add authorized readonly migration inventory`

- 快照：新增精确本机源守卫、SQLite `mode=ro`/`query_only` online backup、manifest/SHA/Schema fingerprint 绑定、成功/失败临时资源清理和源/PID 不变核验。
- 工具：迁移 CLI 新增 `REAL_READONLY_INVENTORY`，强制显式确认、snapshot manifest/SHA、Git/tool version、`--no-materialize`、`--no-files`、任务临时输出和无 target；不创建 PostgreSQL adapter、staging/public/Opening。
- 脱敏：对获准快照执行 Schema、计数、固定枚举、质量错误和数量/金额聚合；自由文本不 DISTINCT，行级处置仅使用 task-local HMAC opaque reference。
- 真实执行：29 表、3,619 条；planned 49、archive-only 3,566、needs-review 4、blocked/model-gap/orphan 0；Inventory Opening 只读计划 4 条，Finance 0；target NONE、物化 0、文件正文读取 0，快照已删除。
- 验收：TASK04 3/3、tool 8/8、unit/UI 98/98、npm 3/3、PG/API 73、upgrade 30、backup/restore、全 HTTP journey、8 组 typecheck、lint/build/environment/credentials 和 Python 三项通过。
- 版本/数据库：`0.1.0-alpha.14`；PostgreSQL migration 保持 `0001`—`0014`，未创建 `0015`，checksum 与 `db/schema.ts` 不变。
- 边界：结论仅为 `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`；未执行真实 PostgreSQL 试迁移、D1/附件盘点、生产恢复、部署、push 或 PR。

### SELFHOST-PHASE3-TASK03 - `feat: materialize synthetic migration into business tables`

- 功能：新增仅 CLI 可达的受控 public materializer、actual public ID/provenance/target digest、聚合事务 checkpoint、合成文件原子写和 snapshot/archive-only 分类；post-cutover 采购、生产、销售、品质和财务只通过正常领域 Service/API 创建。
- 核对：30 条合成来源形成 18 个 actual public targets、12 个 archive-only；Inventory Opening `112.000000/4.000000`、Finance Opening `6.500000/7.250000`。全域旅程后 Dashboard AR/AP `56.500001/27.250000`、4 个 Quality CLOSED、23/23 legacy GET，`erp_records=0`。
- 恢复：停服 backup/verify 恢复到第二个新空目标；14 migrations、关键业务表、18 maps 和 17-byte 文件 SHA 一致。同 manifest replay 无重复，PostgreSQL/Web/Worker 整体重启后 Dashboard/API 再通过。
- 验收：tool 8/8、materializer PG 3/3、TASK01/TASK02 专项、TASK02—TASK10 unit/UI、全部 PG/API 和 migration upgrade、8 组 typecheck、Schema consistency、npm test、lint/build/environment/credentials 与 Python 三项通过。
- 版本/数据库：`0.1.0-alpha.13`；PostgreSQL migration 保持 `0001`—`0014`，未创建 `0015`，旧 checksum 与 `db/schema.ts` 不变。
- 边界：未读取真实数据库、备份、上传、附件或归档；未访问生产、重启 Python、部署、push 或建 PR。结论仅为 `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`，生产仍为 `NO-GO FOR REAL DATA / PRODUCTION`。

### SELFHOST-PHASE3-TASK02 - `feat: add controlled migration opening balances`

- 数据库：新增 expand-only PostgreSQL `0014`，建立去正文的 migration source、Inventory Opening/Line/Reversal、Finance Opening/Reversal；扩展 Inventory/Finance 约束、索引、不可变 trigger 和内部 service-write guard，不修改 `0001`—`0013`、不自动回填。
- 物化：类型化 command 绑定 manifest/source/mapping/target digest；内部 Service 在同一事务写库存 Adjustment/Ledger/Balance 或财务 `OPENING_AR/AP`/Event，并伴随 Audit、Idempotency；无 Web/legacy 写路由。
- 更正：原期初事实不可更新/删除，只允许一次全额冲销；库存被下游消费或财务存在有效收付款时 fail closed；普通 Finance 核销/冲销与期初并发锁定通过。
- 展示：Finance Service 与实时 Dashboard 读取/汇总期初应收应付，`REVERSED` 不计入余额；迁移 synthetic fixture 从 staging 正式物化 2 条库存与 2 条财务期初。
- 验收：专项 unit 3/3、PG 2/2、migration 3/3；全量 PG/API、migration、unit/UI、typecheck、schema consistency、build/lint/environment/credentials 通过；隔离 Compose 重启和停服 backup→全新空库 restore 后 14 migrations、库存 `112/4` 与 AR/AP 余额一致；Python 三项通过。
- 版本/边界：`0.1.0-alpha.12`，`0014` SHA-256 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`。MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`；未读真实数据、未迁移/部署/重启 Python/push/建 PR，生产为 `NO-GO FOR REAL DATA / PRODUCTION`。

### SELFHOST-PHASE3-TASK01 - `feat: add synthetic migration readiness tooling`

- 迁移框架：新增只能显式执行的离线 CLI，包含 SQLite/D1 export source、PostgreSQL staging target、manifest、mapping registry、稳定 ID map、digest checkpoint、dry-run、合成 commit、reconcile 与安全报告。
- 安全：所有 source read/target connect 前拒绝 production、真实/仓库路径、公开或远程目标、非 `_migration_test` 库和非空目标；不输出业务正文、个人信息、凭证、连接串或绝对业务路径。
- 合成验收：五类虚构 fixture 覆盖跨域合法/复核/阻断/恢复/重复；中断恢复、重复执行、输入变化、库存和稳定来源 AR/AP 核对、backup→新空 restore 与 PostgreSQL/Web/Worker 重启通过。
- 回归：迁移 tool 8/8、PG E2E 1/1、非数据库 87/87、PG/API 67/67、upgrade 27/27、typecheck 8/8、build/lint/652 文件凭据、Compose 与 Python 三项通过。
- 版本/边界：`0.1.0-alpha.11`；业务 migration 保持 `0001`—`0013`，未创建 `0014`。未读取真实数据库/备份/附件，未迁真实数据、重启 Python、访问生产、部署、push 或创建 PR；生产保持 NO-GO。

### SELFHOST-PHASE2-TASK10 - `feat: add self-hosted operations workbench`

- Dashboard：新增独立 Repository/Service/Handler，在 `REPEATABLE READ READ ONLY` 快照中实时聚合 TASK02—TASK09 权威关系表；固定 DTO 按服务端权限裁剪，numeric 以文本返回，库存按单位分组而不跨单位相加。
- 根工作台：`/` 改为原生 Vinext 会话与经营工作台，覆盖 setup/login/must-change/logout、指标、风险、模块入口和独立错误/重试，不再加载 iframe。
- legacy/API：`/erp/index.html` 仅作显式白名单 tab 深链和回滚证据；64 个盘点操作与 23 个 legacy 刷新 GET 有实现或稳定退役合同，浏览器 backup create/restore 返回 `OFFLINE_OPERATION_REQUIRED`。
- 备份治理：离线 backup/verify/restore 生成并核对 app/Git/tool/migration/size/SHA manifest，拒绝危险 tar/link、已有输出、生产目标和非空恢复目标；Web 只读去敏状态，不返回路径、URL、凭证或制品正文。
- 验收：Dashboard unit/UI/coverage 10/10；全量非数据库 selfhost 87/87、PostgreSQL/API 67/67、migration upgrade 27/27、environment 6/6、TASK03—TASK10 typecheck、build、lint、凭证和 Python 三项通过；隔离 PostgreSQL backup→新空目标 restore，以及 TASK02→TASK10 同库 Compose 全旅程/重启通过。
- 验收补充：64 项逐条复核为 COVERED 52/REPLACED 2/RETIRED 10；全域备份恢复到第二个新空 Compose 后，115 张表、13 个 migration、跨域计数、0 个 Material orphan、两个文件 SHA、backup `VERIFIED` 与 23 GET 在整体重启后再次通过。
- 版本/边界：`0.1.0-alpha.10`；无需新 projection，migration 保持 `0001`—`0013`。未迁真实数据、执行生产备份恢复、访问生产、部署、切流、push 或创建 PR。

### SELFHOST-PHASE2-TASK09 - `feat: add self-hosted finance management`

- 数据库：新增 PostgreSQL `0013`，关系化 AR/AP Document、Receipt/Payment/全额 Reversal 和 append-only Event；来源、往来单位、金额、币种和结算事实不可原地修改，Header 只保存受控余额/状态/version 投影。
- 服务端：新增独立 Finance Repository/Service/Handler；仅从未冲销正向 Shipment/Receipt 金额来源过账，单来源唯一，收付款不超余额，正向 Settlement 最多一次全额冲销。
- 安全/原子性：admin/manager/finance 写权限与 sales/purchase scoped read 分离；CSRF、256 KiB、24h 幂等、限流、expected version、请求编号、中文安全错误和事务审计通过；业务事实、投影、审计与幂等共同提交或回滚。
- 跨域/legacy：财务过账后上游发货/收货冲销 fail closed；legacy 页面只选择稳定来源 ID，不提交总额、币种、往来单位或操作者权威字段，所有路由委托同一 Finance Service。
- 验收：Finance unit/UI 4/4、PG/API 3/3、migration 3/3、Compose 首次/重启；Procurement 7/7、Sales 3/3、Quality 8/8、FileStorage/environment、lint/typecheck/build/credentials、Python 三项通过。
- 版本/边界：`0.1.0-alpha.9`，`0013` SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1`；非生产且未发布，未迁真实金额，未接银行/税务/发票/汇率/总账，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK08 - `feat: add self-hosted quality management`

- 数据库：新增 PostgreSQL `0012`，关系化 IQC/IPQC/FQC Inspection、Result、Defect 与 append-only Event；稳定 FK 固定 Receipt Line、Production Report、Completion Line + SO Line 来源，事实不可变且数量/来源/跨对象一致性 fail closed。
- 服务端：新增独立 Quality Repository/Service/Handler；创建、追加缺陷、异人处置、关闭、管理者重开执行权限、CSRF、256 KiB、24h 幂等、限流、expected version、请求编号和事务审计。
- 联动：Sales Shipment 在原 SO/Inventory 锁事务内消费 `CLOSED/RELEASED` FQC 额度；冲销恢复额度，仍有有效发货时禁止重开；不改写 Receipt、Report、Completion、Shipment 或金额来源历史。
- Legacy UI：使用稳定来源选项和稳定 ID；失败检验原子提交 result+defect，处置/关闭/重开为独立受保护动作，不由浏览器自动放行或计算权威数量。
- 验收：unit/UI 5/5、Quality PG/API 8/8、migration 3/3、Sales PG 3/3、Compose 首次/重启；shared unit/UI 70/70、跨域 PG、FileStorage/environment、lint/build/typecheck/credentials、Python 三项均通过。
- 版本/边界：`0.1.0-alpha.8`，`0012` SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`；非生产且未发布，未迁真实检验数据、实现批次/AQL/SPC/IQC 库存隔离或财务联动，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK07 - `feat: add self-hosted sales`

- 数据库：新增 PostgreSQL `0011`，关系化 Quote Header/Version/Line/Status Event、SO Header/Version/Line/Status Event、唯一 Quote→SO Link、Shipment/全额冲销和 append-only Sales Financial Source；已过账事实与非草稿版本不可修改/删除。
- 服务端：新增独立 Sales Repository/Service/Handler，稳定与 legacy 报价/销售订单/发货路由统一委托；固定权限、CSRF、256 KiB、24h 幂等、限流、expected version、稳定错误、请求编号和事务审计由服务端执行。
- 业务：报价 DRAFT 版本、发布/接受/拒绝/过期/取消/转换；只有 ACCEPTED 可原子转单一次；直接 SO 为 OPEN；部分/全部发货与一次全额冲销；CNY 六位金额由 PostgreSQL numeric 计算。
- 原子联动：Shipment/冲销复用 TASK04 Inventory Service 事务入口，销售事实、SO 投影、Ledger/Balance、状态、金额来源、审计和幂等共同提交或整体回滚。
- Legacy UI：客户、Product Version、成品 Material 和 Unit 使用稳定 ID；受保护报价/转单/订单/单行发货不计算客户端权威总额或提交操作者字段。
- 验收：专项 unit/UI 5/5、PG/API 3/3、migration 3/3、Schema consistency、Compose 初始/整栈重启；shared unit/UI 65/65、PG 54/54、升级 21/21、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项均通过。
- 版本/边界：`0.1.0-alpha.7`，非生产且未发布；未迁真实销售/库存/金额数据，未实现税/折扣/汇率、销售审批、退换货/部分冲销、FQC、应收/收款/总账，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK06 - `feat: add self-hosted production`

- 数据库：新增 PostgreSQL `0010`，关系化 WO、状态事件、不可变 BOM 快照/需求、领退料、报工、完工和客户专用料限制；已过账事实与快照有数据库不可变 guard，旧 `erp_records` 不回填、不双写。
- 服务端：新增独立 Production Repository/Service/Handler；RELEASE 固化 RELEASED Product/BOM Version，PostgreSQL numeric 计算六位需求；状态、客户/物料/单位、超领/超退/报工/超产、expected version、幂等和并发均由服务端执行。
- 原子联动：领料、退料和完工复用 TASK04 Inventory Service 事务入口；Production、Ledger/Balance、状态事件、audit 和 idem 共同提交或回滚，完工不重复扣已领原料。
- API/legacy：接通工单 list/detail/create/update/release/cancel/close、快照/需求/进度、领退料、报工、完工及六条 legacy 生产路径；兼容层只转换稳定 ID DTO，不直接写库或调用 Python。
- 验证：TASK06 unit/UI 4/4、PG/API 5/5、migration 3/3、Schema consistency、Compose 首次运行/整栈重启；shared unit/UI 60/60、PG 51/51、旧升级 18/18、Import 53/53、lint/build/typecheck/credentials/environment/Python 三项均通过。
- 版本/边界：`0.1.0-alpha.6`，非生产且未发布；未迁真实生产数据，未实现 MRP/排程、设备/工时/成本、WIP/批次/单位换算、品质/财务过账或销售，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK05 - `feat: add self-hosted procurement`

- 数据库：新增 PostgreSQL `0009`，关系化 PO Header/Line、来源、状态事件、Receipt/全额冲销和 append-only 财务来源；Receipt/Line/Status/Source/Financial 不可变并有跨对象完整性 guard，旧 `erp_records` 不回填、不双写。
- 服务端：新增独立 Procurement Repository/Service/Handler，提供 PO list/detail/create/update/close、可收明细、BOM 缺料建议/显式建单、Receipt list/detail/create/reversal 和财务来源读取；并发编码、numeric 精度、状态机、权限、CSRF、幂等、限流、expected version、请求编号与审计均由服务端执行。
- 原子联动：TASK04 Inventory Service 新增兼容的事务内入口；收货/冲销在同一 PostgreSQL 事务完成 Receipt、PO 投影、Ledger/Balance、状态事件、财务来源、审计和幂等。故障注入、审计失败和并发超收均整体回滚。
- legacy：采购页面只转换稳定 Material/Supplier Mapping/Unit ID 和受保护 payload，再委托同一采购 Service；不直接写库、不写 `erp_records`、不调用 Python 创建采购记录。
- 验证：TASK05 unit/UI 5/5、PG/API 7/7、migration 3/3、Schema consistency、Compose 首次运行/重启；共享 unit/UI 56/56、PG 46/46、旧升级 15/15、Import 53/53、lint/build/typecheck/credentials/environment/Python 三项均通过。
- 版本/边界：`0.1.0-alpha.5`，非生产且未发布；未迁真实 PO/在途/库存，未实现 PO 审批/取消、部分冲销、超收、单位换算、完整应付/付款/总账，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK04 - `feat: add immutable inventory ledger`

- 模块：新增独立 `inventory-selfhost` Repository/Service/Handler；稳定 Material/Unit ID、不可变 Ledger、事务余额投影、调整 Header/Line 和核对查询，不写 legacy `erp_records` 或文本编码库存表。
- 业务：支持通用入库、出库、盘点调整、冻结、解冻和一次全额冲销；单一 MAIN 库位、基础单位、禁止负库存/负可用量，已过账 Header/Line/Ledger 由数据库 trigger 禁止修改或删除。
- API/安全：接通 inventory、ledger、reconciliation、adjustment list/detail/post/reverse；服务端权限、CSRF、256 KiB、24h 幂等、限流、expected balance version、稳定加锁、请求编号和同事务审计。
- BOM/UI：readiness 只读新余额投影并返回 required/available/shortage；legacy 调整页提交 material_id/unit_id/version，不再以物料编码作为写引用。
- Migration：新增 PostgreSQL `0008_inventory_ledger.sql`、schema/snapshot/journal；SHA-256 `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`，`0001`—`0007` checksum 不变。
- 验证：专项 unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3、Compose 空库/重启通过；适用 Identity/Material/Mapping/Normalization/Review/Phase0/build/lint/typecheck/凭证/Python 回归通过。未改动旧导入 UI 文件上的 6 条既有源码正则断言仍失败，已记录为非 TASK04 回归债务；parser/file-inspector/adaptive-supplier 49/49 通过。
- 版本/生产：`0.1.0-alpha.4`，非生产、未发布；未回填真实库存、实现 PO/WO/SO 业务过账、访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK03 - `feat: add self-hosted master data and bom`

- 模块：新增独立 `master-data-selfhost` 与 `bom-selfhost` Repository/Service/Handler，统一入口只做身份门禁和精确分派；新写不进入 `erp_records`。
- 数据：关系化 Customer、Supplier、Product/Product Version、BOM Header/Version/Line 与原子业务编码序列；Supplier Mapping 增加稳定 Supplier/Material/Unit FK、状态/版本/有效期，价格历史只追加。
- 版本/不可变：Product/BOM 使用 DRAFT→RELEASED；数据库 trigger 禁止发布 Product Version、BOM Version 和 Lines 被 UPDATE/DELETE，修正只能新建版本。BOM 发布重查 Product、Material ACTIVE、Unit enabled 和行完整性。
- API/安全：接通 legacy `/api/items|mappings|products|customers|suppliers|boms|bom-lines|bom-readiness` 及版本/状态/价格路由；固定服务端权限、CSRF、256 KiB、每分钟 60/20 限流、24小时幂等、CAS/锁、请求编号、同事务业务/审计/幂等结果。
- readiness：TASK04 前只做结构与 required quantity，明确 `inventory_evaluated=false`、`all_ready=false`，不查询 `inventory_balances`/`inventory_transactions` 或伪造齐套。
- Migration：新增 PostgreSQL `0007_master_data_bom.sql`、schema/snapshot/journal；SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`，`0001`—`0006` checksum 不变。
- 验证：TASK03 unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration 3/3；Compose 空库 E2E 与 Web/PostgreSQL 重启通过；Identity/Material/Mapping/Normalization/Review、Phase0、lint/build/typecheck/凭证和 Python 三项回归通过，测试资源已清理。
- 版本与边界：`0.1.0-alpha.2 -> 0.1.0-alpha.3`，未升级依赖；未实现库存/采购/生产，未访问生产、迁移真实数据、部署、重启 systemd、push 或创建 PR。

## 2026-07-24

### SELFHOST-PHASE2-TASK02 - `feat: add self-hosted identity security`

- 模块：将自托管身份从 `selfhost-api.ts` 拆为 `identity-selfhost` 的 Types/Errors/Password/Permissions/Repository/Service/Handler；入口只保留精确委托、可信 actor 注入和所有后续业务模块前的统一 active/must-change 门禁。
- API：安全保留 setup/login/logout/session，补齐本人改密、用户列表/创建/启停/重置和系统审计查询；admin-only 管理、固定十角色、用户名不可变、禁止自停用/自重置和最后 active admin 并发保护。
- 密码/会话：12—128 位且四类至少三类，拒绝用户名/默认/弱口令/新旧相同；PBKDF2-SHA256 310,000 次、常量时间比较、token 只存 SHA-256。停用/重置撤销全部会话，本人改密保留当前并撤销其他会话；生产内部 HTTP 仍强制 Secure Cookie。
- 安全：登录 15 分钟 5 次失败限流，身份写每分钟 60 次/20 个新 Key；四个 POST 使用 CSRF、canonical body、持久 Idempotency、CAS、事务审计和稳定错误；系统审计默认 20/最大 100 并最小披露。
- Migration：新增 expand-only PostgreSQL `0006_identity_security.sql`、schema/snapshot/journal；SHA-256 `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`，`0001`—`0005` checksum 不变，未迁移真实用户或静默删除旧 session。
- 前端：现有 legacy 身份交互改用 temporary_password/expected_version/CSRF/页面内存幂等上下文；处理 must-change、版本/幂等冲突、限流和撤销。Dashboard/备份仍缺失时明确降级，不在本任务补业务 API。
- 验证：Identity 单元 8/8、UI 4/4、PostgreSQL/API 8/8、migration 4/4；隔离 Compose 完整生命周期及 Web/PostgreSQL 重启持久性通过；指定 Material/Mapping/Normalization/Review、Phase0、build/lint/typecheck/凭证与 Python 回归通过。
- 版本与边界：`0.1.0-alpha.1 -> 0.1.0-alpha.2`，仅非生产开发记录；未访问生产、迁移真实数据、部署、重启 systemd、升级依赖、push 或创建 PR。

### SELFHOST-PHASE2-TASK01 - `docs: plan full erp api migration`

- API 盘点：只读核验 Python `AppHandler` 共 64 个 HTTP 操作（GET 34、POST 30）；按身份系统11、基础主数据/工程/物料22、采购库存9、生产6、销售7、品质3、财务6 分类，逐项记录页面、权限、输入、读写表、事务、联动、审计、过账、自托管覆盖、PG结构、缺口、风险和依赖。
- 覆盖结论：以等价服务能力统计，自托管已覆盖4、部分覆盖9、未覆盖51；Material/Import 的新工作流不能因语义相近就冒充 legacy 路径兼容，`erp_records` 或库存占位表也不能作为业务迁移证据。
- 首页断链：根页面仍加载 `/erp/index.html`；登录后 `refreshAll()` 并发的23个 legacy业务GET在 `selfhost-api.ts` 均返回404，Operations额外的Dashboard/backups/users也缺失，因此当前自托管不能描述为完整ERP。
- 数据与事务：记录稳定内部ID、BOM版本、库存不可变流水/余额投影、采购收货、领料/完工、发货、品质处置、应收应付/收付款不变量；确认旧 quote→SO 存在双commit窗口，所有过账更正必须使用调整/冲销/反向记录。
- 迁移建议：提出待逐项授权的 TASK02—TASK10；先身份与审计、再主数据，独立建立库存账本后并行承接采购/生产/销售，再品质/财务，最后 Dashboard、备份恢复治理和 iframe 退出。候选任务均未批准实施。
- 验证：`git diff --check`；Node lint 0 error/1既有warning、`npm test` 3/3、review typecheck、Vinext build 5/5、凭证扫描458文件；项目虚拟环境 Python self-test、smoke、临时SQLite go-live 均通过。
- 边界：只修改文档；未修改 Python/TypeScript/React/Schema/migration/依赖/Compose/部署配置，未读取真实业务数据，未访问公开Site或生产数据库，未重启服务、启动Compose、部署、push或创建PR。

### PHASE0-TASK03 - `docs: establish self-hosted release tracking baseline`

- 发布追踪：新增 `docs/project/RELEASES.md`，区分历史 Sites、当前 Python/SQLite 开发常驻、自托管 Node/PostgreSQL 开发基线和不存在的自托管生产版本；统一记录 Git、version、migration、测试、部署、真实数据迁移、回退和批准状态。
- 版本：将包名从 starter 标识改为 `chenyida-erp-selfhosted`，版本改为 `0.1.0-alpha.1` 并同步 lockfile；不升级或改变任何依赖，该版本明确为非生产、尚未发布。
- Migration：建立 PostgreSQL `0001`—`0005`、历史 D1 `0000`—`0008` 和 SQLite `0001`—`0004` 的 SHA-256 基线；本地开发 SQLite 只读确认四个版本，未访问生产 D1/PostgreSQL。
- 运行面：只读确认 systemd Python/SQLite 开发服务 `enabled/active`、监听 `0.0.0.0:18888`，Node/PostgreSQL 无运行中 Compose 项目且未生产部署；明确采购、库存、生产、销售、品质和财务仍依赖旧 Python API。
- 模板：新增发布身份、快照/恢复点、空库/升级/重复/失败回滚、真实数据核对、lint/build/单元/集成/Compose/人工验收、安全/HTTPS/备份恢复/容量、批准执行与回退条件模板。
- 验证：lint 0 error/1既有warning、`npm test` 3/3、review typecheck、Vinext build 5/5、455文件凭证扫描、项目虚拟环境 Python self-test/smoke/临时SQLite go-live、`git diff --check` 均通过；宿主机无Node/npm，Node命令在一次性Node 22容器执行。
- 已知风险：`npm ci` 报告12个既有依赖审计项（1 low、4 moderate、7 high）；按本任务范围不升级依赖，留待独立安全任务。Python首轮误用系统解释器时smoke在导入依赖前停止，改用常驻服务实际项目虚拟环境后完整通过。
- 边界：未修改业务逻辑、API、Schema、migration、Compose、systemd 或生产配置；未访问公开生产 Site、生产数据库/D1，未重启服务、部署、迁移真实数据、push 或创建 PR。

### SELFHOST Phase 0 / Phase 1 后续 Git 结果说明

- 下列 SELFHOST-PHASE0-TASK01 与 SELFHOST-PHASE1-TASK01—04 条目中的“未提交”准确记录各原任务结束时状态；后续已由 `39946f6`（`feat: complete SELFHOST PHASE1 TASK04 material review workflow`）汇总提交。PHASE0-TASK03 开始时该提交已与 `origin/main` 同步且工作区 clean，不改写原任务历史。

### SELFHOST-PHASE1-TASK04 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0005_material_import_review.sql`、Drizzle schema/snapshot/journal；增加11张Review/覆盖/Issue/finalization/binding/draft link/history表、42个索引、restrict外键、互斥/大小/唯一/CAS约束和终态不可变trigger，未修改`0001`～`0004`。
- 服务端：新增独立 Material Import Review Repository/Service/API/Worker，覆盖已发布run固定引用、Session版本、三层值、SET/CLEAR/REVERT、行决定、Issue处理、ACTIVE分页精确绑定、finalization进度/失败/retry和历史。
- Material接入：通过TASK01 `MaterialWorkflowService.createDraftWithClient` 在同一行级事务创建未编码DRAFT并保存稳定link；不直接写物料表，不提交、批准、生成正式编码或修改ACTIVE。
- Worker与安全：Outbox/background_jobs、100行快照、50行处理、lease/heartbeat/CAS、行级operation key、部分失败和旧Worker租约拒绝；Session/Row expected_version、CSRF、细粒度权限、强幂等和安全审计通过。
- 前端：复用`/materials/imports/:batchId`七步工作区、现有view/row深链接和Drawer，增加Review版本/历史、三层值、覆盖、Issue确认、决定、ACTIVE选择、Draft选择、批量、进度和失败恢复；没有自动匹配/建稿/审批/编码入口。
- 验证：专项unit7/7、UI3/3、PG3/3；39个unit/UI/environment、25个PostgreSQL及2个旧migration upgrade共66个Node test通过；101行跨Worker chunk、空库/重复/0004升级、build、strict定向类型、lint 0 error/1既有warning、454文件凭证扫描和`git diff --check`通过。
- Compose：CSV→Parser→Mapping→Normalization→Review→排除/绑定/Draft→finalize通过；整栈stop/up后Normalization、Review历史、binding和DRAFT保持，一次性容器/网络/卷已清理。
- 边界：未连接生产、迁移真实数据、部署、提交、推送或创建PR；旧D1代码保留但不进入自托管依赖图。

## 2026-07-23

### SELFHOST-PHASE1-TASK03 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0004_material_import_normalization.sql`、Drizzle snapshot/journal；扩展 run/row/issue，关系化新增核心字段候选、动态属性候选和 lineage，并增加唯一索引、外键、状态/统计/发布约束及已发布数据不可变 trigger。
- 服务端：新增独立 Normalization Repository/Service/Normalizer/API/Worker，复用旧确定性规则，覆盖 create/summary/history/detail/rows/issues、同 run 重试、新版本重跑、取消、100 行分块暂存和 500 行摘要读取。
- 原子性与安全：Session/权限/行级可见性、CSRF、Idempotency-Key+正文摘要、expected version、Job lease/heartbeat/CAS、Event/Audit 和稳定错误通过；发布 pointer 与 Job success 同一 PostgreSQL 事务，失败、丢失 lease 或取消不得暴露暂存。
- 前端：现有 Normalization Review 增加运行历史选择、run-specific Rows/Issues、VALID/WARNING/ERROR/SKIPPED、raw row、核心/动态候选、关系化 lineage、重试/重跑/取消。
- 验证：专项 unit4/4、UI3/3、PG/API4/4、升级1/1；既有回归41/41，strict定向类型检查、build、lint 0 error/1既有warning、空库/重复/升级迁移、Compose v1→v2→取消及整栈重启持久性通过。
- 边界：未实现人工最终复核、ACTIVE绑定或Draft Commit；未连接生产、迁移真实数据、部署、提交、推送或创建PR。

### SELFHOST-PHASE1-TASK02 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0003_material_import_mapping.sql`、Drizzle snapshot/journal；原始行绑定 parse run，Mapping 增加源结构摘要、动态目标 metadata、确认快照、版本关系、复用来源、STALE 原因和不可变 trigger；旧不可证明确认版本升级为 `LEGACY_SNAPSHOT_INCOMPLETE`。
- 服务端：新增独立 Import Mapping Catalog/Rules/Service/API，覆盖 Sheets、Rows、动态 Targets、Mapping 保存/预览/确认、版本列表/新版本、有效性、复用候选和显式应用；D1/Miniflare/Cloudflare 不进入自托管运行依赖。
- 一致性与安全：权限、创建人行级可见性、CSRF、请求大小、稳定错误、请求编号、批次/Mapping 乐观锁、事务内强幂等、Import Event/Audit、并发锁顺序和失败整体回滚通过。
- 版本与复用：确认版本和 Items 数据库不可变；相同 digest 禁止重复确认；新版本确认后旧版本 SUPERSEDED；跨批次来源不变，复用只复制到 DRAFT，metadata 变化需重确认，已用目标类型变化为 STALE 并拒绝应用。
- Worker/UI：解析完成事务内原子发布 parse run、Sheet、Rows、Header 建议和初始 Mapping DRAFT；现有工作区增加当前版本/状态、版本历史、新草稿和复用候选/应用提示。
- 验证：Mapping 单元3/3、UI2/2、PG/API6/6、旧数据升级1/1；Material单元6/6、UI2/2、PG/API7/7、FileStorage3/3、PG/Worker5/5、环境6/6回归；strict定向类型检查、build、lint 0 error/1既有warning、空库/升级/重复迁移、Compose解析→Mapping v2→确认和Web/Worker重启持久性通过。
- 边界：未实现或连接行级Normalizer，未连接生产、迁移真实数据、部署、提交、推送或创建PR。

### SELFHOST-PHASE1-TASK01 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0002_material_master_workflow.sql`、Drizzle snapshot/journal、分类编码序列表、审核队列/版本事件索引及草稿/ACTIVE编码一致性约束；未改 `0001`。
- 服务端：新增独立 Material Repository/Service/状态机/Validation/API，覆盖分类、草稿创建编辑、提交、审核通过/驳回、ACTIVE查询、版本、变更和审计；Session、权限、职责分离、CSRF、24小时强幂等、请求摘要、乐观锁和安全错误均由服务端执行。
- 编码与事务：批准时锁定草稿，以 PostgreSQL原子 upsert 领取分类流水并生成 `CYD-{CATEGORY_CODE}-{NNNNNN}`；主记录、属性、版本、变更、审计、幂等和编码同事务提交或回滚，并发测试无重复编码。
- 前端：复用现有Material创建/编辑/详情/审核页面契约，新增真实审计历史路由和 `material.audit.read` 能力页签，不展示敏感审计正文。
- 验证：单元6/6、UI契约2/2、PostgreSQL/API 7/7、既有Material UI 142/142、Phase0文件3/3和PG/Worker 5/5回归、build、lint 0 error/1既有warning及Compose双用户审批/整体重启持久性通过。
- 既有问题清理：只把 `xls-parser.ts` 的 `let flags` 改为 `const`，无行为变化；workbook unused warning和依赖审计风险继续记录，未强制升级。
- 边界：未移植Import Mapping/Normalizer，未连接生产、迁移真实数据、部署、提交、推送或创建PR；旧D1/Miniflare仅保留为参照，不进入新运行依赖。

## 2026-07-22

### SELFHOST-PHASE0-TASK01 - 未提交（用户明确禁止提交）

- 架构：标准 Node.js/Vinext Web、PostgreSQL、服务器本地 FileStorage、PostgreSQL Outbox/租约 Worker、Docker Compose 与 Caddy production profile 取代 OpenAI Site/Cloudflare 运行依赖。
- 数据库：新增 Drizzle PostgreSQL schema 和新的 `0001` 空库 baseline，46 表覆盖既有 45 张业务/治理结构及 `background_jobs`；migration advisory lock、checksum、transaction 和生产显式门禁。
- 文件：随机存储名、路径穿越保护、SHA-256/大小/MIME/原名元数据、同目录临时文件、fsync、原子 rename、受控读删和持久卷。
- Worker：Outbox、`FOR UPDATE SKIP LOCKED`、lease owner/token、heartbeat、CAS、重试、超时恢复、幂等、业务结果与任务状态原子发布、安全停机；CSV 解析和规范化基线 handler 已接入。
- 运维：Web/Worker/PostgreSQL/Caddy Compose、非 root 用户、健康检查、日志轮转、admin/migrate CLI、无覆盖备份恢复脚本与 Linux 文档。
- 验证：单元 3/3、PostgreSQL 5/5、Vinext build、定向 lint、凭证/差异检查、Compose 登录/分类/草稿/上传/Worker/重启持久性和隔离备份→新空库恢复通过；全量 lint 有 1 个本任务前既有 `prefer-const` error。
- 边界：未连接或修改生产、未迁移真实数据、未部署公网、未提交/推送/PR；完整旧 API、审批写 Repository 和行级 Normalizer PostgreSQL 移植留待后续任务。

## 2026-07-19

### PHASE3-MATERIAL-LIBRARY-SPEC-PRECISION-GATE-01 - `feat: enforce specification precision gates`

- 精度门禁：CATEGORY 不再作为足以区分内部编号的证据；少于两类鉴别参数返回“规格不足”、置信度 0 且不提供候选。自动匹配要求来源与候选至少三类参数、包含锚点、集合完整一致且候选唯一。
- 参数扩展：确定性支持分数功率、工程量范围、频率/阻抗组合、带宽、dB、嵌入电阻码、长度、针数、间距、铜厚和常用接口；Type-C `16P` 不再误识别为电容。
- 来源选择：未知表头可按样本规格丰富度选中；普通型号列不再拼入规格，只有型号或低信息规格保持人工审核。
- 审核 UI：摘要增加“规格不足”，清洗行明确显示证据类数、候选内部缺项和歧义，不由浏览器重新计算匹配。
- 真实回归：J587 隔离复算为 105 新物料、5 疑似、12 规格不足；旧逻辑中 4 条只凭连接器大类产生的错误候选归零。三份附件和业务正文不提交。
- 数据：无 Schema/Migration；9 Material、122 Cleaning、17 Batch 和 3176 Raw 保持不变，旧 Cleaning 不静默重算。
- 验证与部署：联合单元 58/58、self-test、smoke、go-live、编译和 diff 检查通过；部署前备份 SHA-256 为 `898b3dab3da5b3e4239773789afebca73f1c91428646c2c2c3f476e2d8efc536`，systemd active/enabled，本机和公网 HTTP 200。

## 2026-07-18

### PHASE3-MATERIAL-LIBRARY-GENERAL-SPEC-MATCH-01 - `feat: match generalized specification tokens`

- 来源识别：在明确规格、多列组合、描述和物料名称中按确定性参数丰富度选择详细规格，保存完整 raw spec、来源列、置信度和证据；型号/MPN 继续独立保存。
- Matcher：新增通用类型化 token，覆盖品类、封装、容量、阻值、电感值、电流、电压、功率、频率、百分比/绝对误差、介质/材质和尺寸；量纲归一后按集合比较，参数顺序不影响相似度。
- 边界：同类型冲突排除，缺项降低置信度；MPN/品牌只作为独立标识证据，不进入通用规格分数，也不能代替详细规格。名称仍不参与编号评分，AI 不补造参数。
- 数据库：新增本地 `0004_cleaning_general_spec_tokens`，只扩展既有 Cleaning 的来源、来源/候选 token 和匹配证据 JSON；旧行不回填、不重算。
- 审核 UI：同时显示型号/MPN、完整原始详细规格、规格来源、来源逐项参数和候选内部参数，不再用型号覆盖原始规格。
- 建档：人工确认的新内部物料在 `value_spec` 保留完整详细规格，结构化列作为附加投影，不丢弃尚无独立列的电流或绝对误差参数。
- 验证与部署：联合单元 48/48、self-test、smoke、go-live 通过；备份和迁移后完整性 `ok`，9 条物料、444 条 Cleaning、16 个 Batch 和 3037 条 Raw Rows 未改变；systemd active/enabled，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-REVIEW-SPEC-DISPLAY-01 - `feat: show structured specification comparison`

- 审核 UI：新增“来源分项规格”和“候选内部规格”，按品类、封装、容量/阻值、耐压、误差、介质/材质、型号/MPN、品牌逐项展示；内部缺项显示“未维护”。
- 字段语义：原列改为“原始型号/规格”；富结构化物料描述作为 raw spec 来源，物料型号独立保存为 raw model，不再让厂商型号冒充规格。
- 权威边界：候选内部规格从已加载的 `/api/items` 只读数据展示；匹配、候选编号、权限和确认仍由服务端决定。
- 置信度：来源介质存在但内部候选未维护时仍为疑似，并将置信度上限改为 0.95，避免显示 1.0。
- 数据：无 Schema/Migration，无旧行回填，无物料或 Cleaning 写入。
- 验证与部署：联合单元 38/38、self-test、smoke、go-live 通过；systemd active/enabled，本机和公网 HTTP 200，线上静态资源已核验两组规格字段，当前 9 条物料和 25 条 Cleaning 未改变。

### PHASE3-MATERIAL-LIBRARY-STRUCTURED-SPEC-MATCH-01 - `feat: match structured specification components`

- 机制：取消把型号/描述压成整体文字进行匹配；分别提取并比较品类、封装、容量/阻值、耐压、误差、介质和 MPN，关键属性任一冲突立即排除。
- Parser：1928C 的物料型号、物料描述和生产厂家分别保留；增加生产厂家品牌别名，支持 `NPO/NP0/COG/C0G` 与 `100P=100PF` 等确定性表达。
- 数据库：新增本地 `0003_cleaning_structured_specification`，扩展现有 Cleaning 的 raw model/category 和 parsed tolerance/material；不建第二套导入系统，不回填旧清洗。
- 建档：电子规格分别写入 value/package/voltage/tolerance/material/MPN，不再把可解析的完整长描述只塞进 `value_spec`。
- 真实回归：1928C 截图行得到 CAP/0201/5%/C0G-NP0/50V/10PF/MPN；当前内部库无该 10PF 规格，按预期保持新物料。
- 验证与部署：联合单元 37/37、self-test、smoke、go-live 通过；迁移前快照完整性通过，`0003` 已应用，9 条物料、25 条 Cleaning、12 个 Batch 保持不变，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-SPEC-MATCH-01 - `feat: match supplier rows by specification`

- 样本：审计 1928C、G20-G15G、J587 三份 XLSX；G20 的 Description-only 表头原先被名称门禁拒绝，J587 描述/备注冲突会导致规格为空。
- Parser：增加 HC_CODE、VendorCode；Description-only 作为 SUGGESTED 规格/名称候选；正式描述优先备注；全部 Canonical 字段为空的行标记 `UNMAPPED_NON_DATA`，Raw 保留。
- 规格：三文件隔离得到 221 Cleaning Rows，其中 216 条有规格；G20 5 条原始 Description 为空，不用料号冒充规格。
- Matcher：删除名称相似度评分；来源规格硬冲突立即排除，完整唯一规格才自动确认编号，部分唯一候选保持疑似，多候选同分不随机给号；支持 0.1uF=100nF、5.0V=5V、+5%=5%。
- 当前库：三文件没有完整唯一匹配编号 1～5 的行；J587 5 条缺误差，不能在 1/2/3 中唯一选码。未创建新内部物料。
- 验证：规格编号 7/7、Parser/真实样本 12/12、隔离文件导入 3 Batch/316 Raw/221 Cleaning/0 Material，联合基线 33/33、smoke/self-test/go-live 通过；systemd 已部署且未重写现有数据。

### PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01 - `feat: safely clear cleaning rows`

- 权限：清空接口要求 `system`，仅管理员页面显示按钮，普通角色服务端拒绝。
- 确认：浏览器确认之外，`POST /api/cleaning/clear` 还要求固定 `CLEAR_CLEANING_ROWS`；缺失返回稳定错误且不删除。
- 恢复：成功操作先自动创建 SQLite 备份，再清空 Cleaning Rows；响应返回删除数量和备份信息。
- 事务/审计：删除与操作日志在 `BEGIN IMMEDIATE` 事务内完成，记录操作者与行数；保留 Batch、Raw Rows、原文件归档、物料和供应商映射。
- 测试：清空专项 3/3、与排序联合 7/7、smoke 通过；systemd 公网开发服务已部署。部署过程未调用真实清空，229 条 V700 记录不变。

### PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01 - `feat: sort cleaning rows by confidence`

- API：`GET /api/cleaning` 增加 `confidence_sort=newest|desc|asc`，未知值回退 newest；SQL 排序只使用固定白名单。
- 顺序：服务端对完整 Cleaning 查询按匹配置信度排序后再应用 500 条上限；同分按 ID 降序，默认保持最新记录。
- UI：“清洗审核”增加“匹配置信度排序”，可选最新、由高到低、由低到高；切换只刷新清洗列表。
- 测试：排序单元 4/4，smoke 覆盖升降序和未知值回退，self-test/go-live 通过。
- 部署：systemd 开发服务已重启为 `enabled/active`，公网 HTML/JS 已核验新控件。
- 真实队列：部署期间用户已网页重导入 V700；229 条、21 个置信度层级（0.00～1.00）的升降序检查均通过。

### PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01 - `docs: record capacitor matching test seed`

- 用户数据：只采用项目负责人更正后的五条电容规格，按临时内部编码 1～5 建入开发服务器物料库；首次重复版本未执行。
- 结构化字段：CAP、容量、规范化误差、电压、0201 封装、PCS；名称保留用户输入的正号，未创建供应商映射。
- 清理：单一事务删除 543 条旧 Cleaning Rows；保留 2 个 Import Batch、766 条不可变 Raw Rows 和完整 SHA 原文件归档。
- 恢复：写入前备份 `erp-backup-20260718-182230.sqlite3`，SHA-256 为 `f97337052aa9fcc0258355a9a0d7655e6d51f865c28189e6f901ec673f597613`；先在备份副本执行同一事务。
- 验证：内部物料 4→9；五条输入分别自动匹配编码 1～5，置信度均为 1.00；SQLite integrity `ok`，systemd `enabled/active`，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02 - `feat: stage real BOM imports for review`

- 用户确认：项目负责人明确 A118/V700 是正确且需要入库的正式表格，不应因缺独立名称/单位或 XFD 异常声明宽度拒绝整份文件。
- A118：完整原文件按 SHA 归档；从第 44 行可信表头和 256 列安全分析窗口生成 314 条待审核行，不把异常 XFD 列映射到 Canonical 字段。
- V700：正确选择 BOM 第 1～2 行；规格描述同时生成 `SUGGESTED` 名称候选，生成 229 条待审核行，不自动确认名称。
- 数据：新增 `0002_material_import_file_archive`；实际写入 2 Batch、766 Raw Rows、543 Cleaning Rows，543 条全部 `NEEDS_REVIEW`，22 条空规格、543 条空单位，内部物料保持 4 条。
- 恢复：写入前备份 `erp-backup-20260718-174855.sqlite3`；迁移副本和写入后 `PRAGMA integrity_check` 均为 `ok`。
- 验证：环境/Spreadsheet/Migration/真实样本联合单元 15/15、self-test、含二进制 Excel 的 smoke 和公网开发服务检查通过。

### PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT - `feat: enable local spreadsheet imports`

- 运行面：修复实际常驻的 `chenyida_erp_app`，网页文件选择器和后端现已接受 `.csv/.xlsx/.xls`，不再把 Excel 当 CSV 文本读取。
- 解析：按强签名识别 CSV/OOXML/OLE，固定 `defusedxml==0.7.1`、`openpyxl==3.1.5`、`xlrd==2.0.2`；限制 10 MiB、50 Sheet、50,000 行/Sheet、256 列，并拒绝 XLSX 宏、加密、外链、路径和压缩资源异常。
- 自适应：评分全部 Sheet、前 50 行、1～3 行和合并表头；集中字段别名、样本特征、多列规格组合及非数据行分类。缺少明确名称、规格证据不足或 Mapping 冲突时 fail closed/进入复核，不由 AI 补造。
- 建档门禁：清洗行创建内部物料前，页面和服务端均要求人工确认标准名称、规格和基本单位；空规格或空单位禁止建档，不再自动补 `PCS`。
- 数据库：新增本地版本化迁移 `0001_material_import_source_lineage`，保存文件 SHA、Sheet/表头/Mapping 快照、不可变原始行，以及清洗行来源、mapped values、Mapping/规格置信度和 Review 状态。
- 测试：Spreadsheet 6/6、Migration 3/3、联合单元 13/13、self-test、含 XLSX 二进制 API 的 smoke、go-live、快照副本试迁移和完整性检查均通过。
- 部署：迁移前备份 `erp-backup-20260718-172714.sqlite3`；systemd 改用 `/opt/erp/.venv/bin/python` 后重启为 `enabled/active`，本机和公网 HTML 已验证新文件类型。
- 真实样本：V700 仍因缺少明确物料名称阻断，A118 仍因 XFD 超宽阻断；没有截断、补造或写入这两份真实附件。

### PHASE3-MATERIAL-LIBRARY-PUBLIC-VERIFY - `chore: enable port 18888 public verification`

- 运行：服务器应用改为绑定 `0.0.0.0:18888`，公网验证地址为 `http://43.135.157.211:18888`。
- 范围：只验证健康接口和网页可达性；不配置域名、TLS、反向代理或其他端口，不输出凭证。
- 前置：项目负责人提供公网 IP 及 TCP 18888 IPv4/IPv6 入站允许规则截图。
- 结果：本机与 `43.135.157.211:18888/api/health` 均返回 HTTP 200，登录页返回 HTTP 200；发现登录页预填默认密码，验证后立即停止公网进程并移除页面预填凭证。
- 常驻：项目负责人随后确认开发阶段保持常开；新增并安装 `chenyida-erp.service`，systemd `enabled/active`，开机自启且异常自动重启。

### PHASE3-MATERIAL-LIBRARY-SERVER-RUNTIME - `chore: switch local server delivery runtime`

- 运行面：根据项目负责人新要求，后续默认交付目标改为服务器本地 `chenyida_erp_app`，不再默认把新功能整合到 `chenyida_erp_site`。
- 端口：`server.py`、前台/后台启动、停止脚本和上线健康检查默认统一为 `127.0.0.1:18888`；测试脚本继续使用隔离端口，不与默认服务冲突。
- 安全：未绑定 `0.0.0.0`，未修改防火墙、反向代理、TLS、公网入口或生产数据库；本次没有启动服务器。
- 验证：`server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过；Site 中已完成的 `.xls` 代码未自动回写本地应用，服务器端 `.xlsx/.xls` 迁移另立任务。

### PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT - `feat: support legacy xls imports`

- 文件格式：网页预检和上传安全检查新增 `.xls`；旧式 OLE/BIFF 工作簿进入独立解析路径，现有 `.xlsx` 继续使用 OOXML 解析器，`.csv` 行为不变。
- 解析：新增有界 OLE Compound File/BIFF 读取器，支持可见/隐藏 Sheet、共享字符串、文本、数字、RK、布尔/错误、公式缓存、合并单元格和原始行哈希；加密/损坏/超限文件 fail-closed。
- 链路：继续复用现有 Import Batch、File、Raw Rows、Mapping、Normalization、Review、Event/Audit 和 Draft 门禁；不新增第二套导入系统或数据库表。
- UI/Inspect：文件选择器与本地 inspect 同时接受 `.xlsx/.xls/.csv`，`.xls` 保留 `XLS_LEGACY_BINARY` 安全证据；批次原有 `XLSX` 来源分类不变以保持迁移兼容。
- 生产：仅修改本地代码，未连接生产 D1/R2/Queue，未上传、迁移、创建 Draft 或部署。

### PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01 - `fix: adapt imports to real supplier BOMs`

- Git Commit：`cea940a`。
- 样本：只读检查用户提供的 A118/V700 两份附件；两者均为 XLSX 内容但使用 `.csv` 后缀。只记录文件哈希、大小、Sheet、表头、列名、行数估计和安全原因，未提交附件或业务行。
- V700：修正前误选“变更记录”；修正后以 `HIGH_CONFIDENCE` 选择 `BOM` 第 1～2 行组合表头，正确识别规格、型号和数量。标准名称、单位仍未确认，故不进入 Mapping Confirm/Normalization/Draft。
- A118：识别 `SHEET1` 第 44 行表头，正确映射名称、规格、厂商料号和用量；第 197～203 行周期性扩展到 XFD，继续以 256 列安全上限阻断，不静默截断。只读前 9 列估计不视为成功导入。
- 兼容：只允许 `.csv` 后缀但强签名为 XLSX 的单向兼容，完整 OOXML 安全检查不变，并把原后缀、检测类型和 warning code 写入既有安全事件。
- 识别：Inspect 复用自适应前 50 行摘要；增加 BOM 正向、变更/历史负向 Sheet 证据，限定“厂商物料编码”为制造商料号，增加“用量”数量别名和嵌入式 BOM 标题分类。
- 安全错误：XLSX 超宽 Promise 立即挂接拒绝处理，CLI 返回稳定中文错误，不再产生未处理拒绝堆栈。
- 验证：自适应 11/11、Parser 37/37、Inspector 4/4、Batch API 12/12；Vinext build + 全量 Node 593/593、lint 0 error/1 个既有 warning、隔离 API smoke、凭证扫描及 Python self-test/smoke/go-live 通过。
- 生产：未连接生产 D1/R2/Queue，未上传真实附件、执行 dry-run、创建 Draft、迁移、Sites 保存或部署。

### PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT - `feat: adapt supplier material imports`

- Git Commit：`41e293f`。
- 审计：复用既有 Batch、Parser、Raw Rows、Mapping、Normalization、Review、Validation、Event/Audit 和 Draft；确认旧实现默认首个可见 Sheet、前 10 行单表头、单来源映射和只跳过精确表头行，是多供应商兼容失败的主要原因。
- 结构识别：对全部可见 Sheet 的前 50 行评分，支持 1～3 行和合并父级表头、稳定父子列路径、数据起始行，以及说明/空行/重复表头/小计/合计/页脚的可解释分类。
- Mapping/规格：集中版本化别名，结合样本类型、唯一率、长度、尺寸/型号/单位特征和受控 Supplier Profile；支持 `EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT`、多来源列与确定性规格组合。名称/描述只给候选，不调用 AI；空规格产生 ERROR 并阻断 Draft。
- Canonical Row：在现有 Normalization 保存文件、Sheet、行、Supplier/Profile、raw/mapped 投影、置信度和 Review 状态；完整原始值继续只存在不可变 Raw Row。非数据行保留 lineage 并标记 `SKIPPED/REJECTED`。
- 数据库/UI：新增 `0008`、Supplier Profile 及 Mapping/Normalization 扩展，旧 `0005` 兼容；工作区展示结构范围、置信度、多来源 Mapping 和规格确认提示。Down 是受保护的兼容回退，完整结构恢复依赖迁移前快照。
- 样本：仅检查 `/opt/erp` 内受控目录，未发现真实供应商样本；治理模板未冒充真实验证，未输出完整业务数据、价格或联系方式。
- 验证：全量 Node 589/589，自适应 9/9、Migration 3/3、运行时闭环 2/2，build、lint 0 error/1 个既有 warning、隔离 API smoke、1k/10k/100k 查询计划、最终文档范围 328 文件凭证扫描、Python self-test/smoke/go-live 和 `git diff --check` 通过。
- 生产：未连接生产 D1/R2/Queue，未执行生产迁移、真实上传、Draft 创建、Sites 保存或部署。

### PHASE3-MATERIAL-LIBRARY-02 NO_REAL_DATA_MODE - `feat: harden material import governance`

- Git Commit：`b3d26c3`。
- 文件检查：只扫描 `/opt/erp`、`/home`；发现 20 个路径，按 SHA 去重为 1 个 10-Sheet XLSX 和 9 个 CSV，均为已跟踪治理模板/样例及其 Site 镜像；`/home` 无候选，未发现、上传或导入真实企业物料文件。
- Inspect：扩展 `material-library:import inspect --file`，复用既有有界 XLSX/CSV Parser，只读输出类型、大小、SHA-256、Sheet/CSV 行列、编码、分隔符、表头候选和可能标准字段；不输出业务数据行、不修改源文件。
- 治理：dry-run 显式返回分类、单位和品牌的 `EXACT/MATCHED/NEEDS_REVIEW` 及冲突/候选原因；不自动创建分类、单位或品牌。CLI 分页读取后只输出分类/单位/品牌、错误/警告/待审和重复等级安全汇总，不逐行打印物料正文。
- 重复：EXACT 候选直接阻断 Draft；HIGH_CONFIDENCE 候选保持人工确认门禁并阻断；POSSIBLE 只提示。所有等级继续禁止自动合并、删除或覆盖。
- 测试：新增本地 CSV/XLSX inspect 与类型错配测试，扩展分类名称、单位别名、品牌别名、EXACT/HIGH_CONFIDENCE、Draft/权限/幂等回归；专项 9/9、全量 Node 575/575、build、lint 0 error/1 个既有 warning、隔离 API smoke、319 文件凭证扫描和本地临时 SQLite 基线通过。
- 数据库/结果：未修改 Schema、Migration、Drizzle 或生产配置；真实 dry-run 未执行，Material DRAFT 数量为 0。任务保持 `BLOCKED / NO_REAL_DATA_MODE`，等待真实文件和隔离上传目录。
- 生产：未连接生产 D1/R2/Queue，未迁移、部署或创建生产资源。

### PHASE3-MATERIAL-LIBRARY-01 - `feat: add material master database schema`

- Git Commit：`2ff8d9c`。
- 审计：确认在线目标为 Cloudflare D1/SQLite 语义、Drizzle ORM/SQL Migration；既有 `material_master`、分类、动态属性、别名、供应商映射、Import Batch/File/Row/Event、Normalization 和 Draft/Review 服务可直接复用，因此未创建第二套物料主表或重写 Import。
- 数据库：新增 `0007`、受保护 Down、snapshot/journal；增加 units/unit aliases、brands/brand aliases、Normalization approvals、Import Draft links、duplicate candidates，并为 Material 增加品牌、单位和批次/文件/行来源外键；全部为增量表/可空列/约束/索引，无删除或破坏性重建。
- 业务/API：新增 inspect/dry-run/report、Normalization Approval 和 Draft commit；admin/manager 独立 `material.import.commit`，CSRF、版本/摘要、ERROR/WARNING 门禁、请求/行幂等、Validation、EXACT/HIGH_CONFIDENCE/POSSIBLE 候选和原子来源关联；创建结果只能是无正式编码的 `DRAFT`，后续继续复用人工提交/审核。
- 命令：新增只允许回环 URL 和 test/local/development commit 的 `material-library:import`，复用 API 提供 inspect/dry-run/commit/report，不直接连接 D1。
- 文件检查：只扫描 `/opt/erp`、`/home`；仅发现两套内容相同的治理模板/样例（XLSX 10 表和 9 个 CSV），未发现真实首批物料文件，未上传或执行真实 dry-run。
- 验证：迁移 3/3、闭环/权限/CSRF/幂等 3/3、既有 Material 生命周期 14/14、全量 Node 569/569、Vinext build、Drizzle 44 表无漂移、隔离 API smoke、314 文件凭证扫描、远程 URL 拒绝和临时 SQLite 基线通过；lint 0 error/1 个任务外既有 warning。
- 生产：未连接生产 D1/R2/Queue，未执行生产迁移、真实数据导入、Sites 保存或部署。
- 文档：新增 Material Library 落地说明和审计报告，记录模型复用、文件清单、风险、测试及下一步。

## 2026-07-17

### PHASE3-TASK04 实现 - `feat: add import normalization review ui`

- 前端：在 `/materials/imports/:batchId` 统一工作区增加七步 Stepper、`normalize/normalized/issues`、Current/Latest 双轨、启动/重试/版本重跑/取消、冻结幂等与 `RESULT_UNKNOWN`、2/5/10 复合轮询和真实行进度。
- 审阅：增加 Current Run 汇总、50/100 Rows 与 Issues opaque cursor、批次作用域 Row Drawer、Basic/200 动态属性/分类提示/供应商引用/Deferred Validation/Lineage、有界类型化值和五键 `safe_details`。
- 安全与可访问性：Capability 独立判断、401/403/404 清理、Batch/Run/Row/Lineage 归属核验、纯文本与安全 ID、Drawer 背景隔离/焦点约束/三级恢复、700px 全宽和状态文字语义。
- 测试：104/104 计划 ID、100/100 既有 Import UI 回归；本地 Playwright 50 Rows 801 ms、Drawer 398 ms、100 Issues、200 Attributes、1366/700px、无 N+1/Storage/History 正文及 0 console warning/error。
- 数据库/API/生产：未修改 Schema、Migration、后端 API、Normalization 业务逻辑、依赖或 hosting；未连接、迁移或部署生产资源。完整 Row Issues 局部门禁与七项非阻塞限制继续保留。

### PHASE3-TASK03 规格确认 - `docs: approve import normalization review ui`

- 项目负责人在正式设计提交 `c694045` 后明确回复“规格确认”；主规格中的 14 项 UI 决定从 `PROPOSED` 转为 `APPROVED`，并新增 D-023 决策记录。
- 确认范围仅为统一工作区、七步 Stepper、Current/Latest 双轨、启动/重跑/取消、Rows/Issues、Row Drawer、可访问性与性能门禁等书面规格；不自动创建或授权实施任务。
- Row Drawer 完整 Issue 查询局部门禁、`PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 和 7 项非阻塞限制继续有效，不因规格确认而视为已解决。
- 本次仍为 docs-only；未修改前端、API、Schema、Migration、业务逻辑、依赖或生产环境。

### PHASE3-TASK03 设计 - `docs: design import normalization review ui`

- 新增功能：无；本任务只形成 Material Import Normalization Review UI V1 正式规格、37 状态低保真线框、状态矩阵和 104 项未来实施测试计划。
- UI 契约：推荐继续 `/materials/imports/:batchId` 统一工作区、七步 Stepper、`normalize/normalized/issues` View、`batch/current_run/latest_attempt` 三层状态、固定 Processor Version、页面内存幂等、`RESULT_UNKNOWN`、2/5/10 轮询、真实行进度和协作式取消。
- 结果审阅：Rows 与 Issues 使用独立 URL 参数和 opaque cursor；Row Detail 使用批次作用域 Drawer，展示 Basic、动态属性、非正式分类提示、供应商引用、Deferred Validation 与 Lineage；结果全部只读，不实施分类、匹配、Draft 或正式导入。
- 门禁：记录 Row Drawer 完整 Issue 查询局部门禁、`PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 和完整历史、Batch Pointer、部分筛选、列表候选摘要、选中 Issue 刷新恢复等 7 项非阻塞限制；14 项决定全部保持 `PROPOSED`，等待提交后的“规格确认”。
- 验证：复用上一提交的可信运行时基线，只执行文档结构/链接、104 项编号与分组、37 线框、状态矩阵、14 项决定、门禁/限制、`git diff --check`、docs-only 范围和用户未跟踪文件保护检查；未重复运行无关 Node/build/API/Drizzle/Migration/SQLite/Playwright/全仓凭证扫描。
- 范围：未修改前端、API、Schema、Migration、Normalization/Mapping 业务逻辑、依赖、hosting 或 Legacy SQLite；未连接、迁移或部署生产 D1/R2/Queue；未创建 Draft 或正式物料。

### PHASE3-TASK02 实现 - `feat: add material import normalization`

- 决策与边界：批准 D-022 和正式规格的 16 项推荐决定；Normalization 只生成可追溯候选与 Deferred Validation，不调用 Draft/正式物料写服务，不执行分类、匹配或去重。
- 数据库：新增 `0006_material_import_normalization.sql`、三张关系表、批次 current pointer 与状态、events/outbox 扩展、约束/索引/绑定 trigger、Drizzle snapshot/journal，以及只在无 Normalization 业务状态时允许的受保护 Down。
- 运行与恢复：实现独立 normalization run、Mapping/Metadata 快照绑定、行级 JSON/Issue 暂存、Outbox、租约/心跳、幂等分块、资源上限、完整性摘要和单 D1 batch 原子发布；失败/取消清理未发布行，重跑在成功发布前保留旧 pointer。
- API/安全：实现异步启动、汇总、行列表、行详情和 Issue 列表五个 API；新增 `material.import.normalize`，保持 owner/read_any 可见性先于能力判断，支持 CSRF、强幂等、版本 CAS、读写限流、opaque cursor、稳定错误和安全审计。
- 测试：正式矩阵 54/54，Normalization/Migration 专项 18/18；覆盖 Up/受保护 Down/重升/失败回滚、约束/trigger、稳定发布、ERROR 行共存、幂等/块重放、分页、不同 processor 重跑、取消清理、Mapping/Metadata/parse 冻结、50,001 行与 payload 资源边界、发布竞争、五 API、权限/404、CSRF、429 和安全 500；全量 Node 458/458、build、隔离 API smoke、OpenAPI、Drizzle 无漂移、凭证扫描和临时 SQLite 基线通过，lint 0 error/1 个任务外既有 warning。
- 范围：未修改 hosting 或生产 binding，未连接、迁移或部署生产 D1/R2/Queue，未创建 Material Draft 或正式物料；根目录既有未跟踪 `.obsidian/` 保持不变。

### PHASE3-TASK01 设计 - `docs: design material import normalization`

- 新增功能：无；本任务只完成 Material Import Normalization & Staging V1 书面规格、未来数据模型和 API 契约。
- 架构与状态：推荐独立 normalization run、复用 Outbox/租约/CAS/原子发布，批次增加排队/运行/发布状态；执行失败与行级 ERROR 分离，不新增批次 `NORMALIZATION_FAILED`。
- 数据契约：推荐每行版本化 JSON 快照、独立 issue 表和 current pointer；冻结完整 lineage、空值/默认值、基础字段、动态属性、类型、公式禁用、Deferred Validation 和行状态语义。
- API/安全：设计异步启动、汇总、行列表/详情和 issue 五个路由；新增独立 `material.import.normalize` 能力，保持 owner/read_any 行级可见性、404/403、CSRF、强幂等、限流、稳定错误和纯文本安全边界。
- Migration/测试：只设计未来 `0006` 三表、batches/events/outbox 重建、索引、受保护 Down/重升和 54 项最低测试；16 项选择全部为 `PROPOSED`。
- 验证：OpenAPI 3.1 的 5 个操作/98 个本地引用、16 项决定逐项 11 字段、54 项测试/docs-only 检查通过；lint 0 error/1 个既有 warning；build 与 Node 440/440、隔离 API smoke、Drizzle 34 表无漂移、296 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 均通过并清理。
- 范围：未修改运行时代码、Schema、Migration、API、前端、依赖、R2/Queue/hosting 或本地旧版；未连接、迁移或部署生产环境。实际提交哈希以 `git log -1` 为准。

### PHASE2-TASK08 实现 - `feat: add material import workspace ui`

- 路由与工作区：新增 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`，实现权限驱动入口、opaque cursor 列表、状态 Stepper、非法 URL 规范化、错误/终态处置和服务端状态权威恢复。
- 文件与写安全：新增 10 MiB 单文件预检、`@noble/hashes@2.2.0`（MIT）增量 SHA Worker、确认后创建、受控单文件 multipart XHR、真实网络进度、独立幂等操作记录、重复文件新批次恢复及 RESULT_UNKNOWN 原 Key/原载荷恢复边界。
- 解析与 Mapping：实现 2/5/10 秒轮询、5/10/30 秒网络退避、Retry-After、可见性暂停、协作式取消、Sheets/Rows/Header、完整 256 列横滚、动态 Catalog、Mapping 保存/preview/confirm 新鲜度和 confirmed 只读；不创建 Draft 或正式物料。
- 测试与门禁：UI-001—UI-100 全部通过；Playwright Chromium 1366×768 的 50×256 + 256 Mapping 门禁通过，初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、30,285 DOM、123,423,127 bytes JS heap，sticky/键盘/语义/700 窄屏及控制台 0 error/0 warning通过。
- 全量验证：build 与 Node 440/440、lint 0 error/1 个任务外既有 warning、隔离 API smoke、5 份 OpenAPI 3.1/434 本地引用与 Batch 6 操作、Drizzle 34 表无漂移、289 文件凭证扫描和临时 SQLite self-test/smoke/go-live 通过；首次并行全量触发历史迁移用例 120 秒超时，串行复跑 440/440。
- 范围：仅修改 Site 前端、共享浏览器 Client、依赖锁、专项测试和治理文档；未修改后端 route/service、Schema、Migration、Metadata、hosting、本地旧版业务逻辑或生产环境，未部署。

## 2026-07-16

### PHASE2-TASK07 实现 - `feat: add import mapping target catalog`

- API：实现批次作用域 `GET /api/material-master/import-batches/:batchId/mapping-targets`，支持 BASIC/ATTRIBUTE/SPECIAL、`namespace/q/limit/cursor`、稳定排序、规范化搜索、摘要保护的不透明 cursor、Metadata/展示变化 409 和 `private, no-store`。
- 共享规则：新增 `MaterialImportMappingTargetRegistry`、运行时 D1 ACTIVE Metadata Repository 与 `MaterialImportMappingMetadataSnapshotService`；`material-import-mapping-metadata-v1` 规范 JSON SHA-256 覆盖 namespace/code、enabled/selectable、type、required、modes、default、unit、value constraints 等业务语义，展示文案只进入 cursor 搜索投影摘要。
- Mapping 统一：Parser Mapping 准备、PUT 保存、preview、confirm 和 Catalog 全部调用同一 Snapshot；保留现有请求、状态机、必填、唯一性、category_hint、supplier_reference、ignore 和历史失效 target 语义。
- 权限与安全：要求认证、read + map、owner/read_any 行级可见性；隐藏批次 404、可见但无 map 403。GET 无 CSRF/幂等要求，执行独立读取限流、request_id、安全错误和不记录 q/cursor/metadata 正文的 API 审计；不返回 attribute_id、表/列/SQL 或 Repository 内部信息。
- 测试：Catalog 专项 51/51；build 与全量 Node 339/339；lint 0 error/1 个既有 warning；隔离 API smoke、OpenAPI 解析/契约检查、Drizzle 无漂移、凭证扫描和临时 SQLite 环境守卫/self-test/smoke/backup-restore/go-live 通过。
- 门禁与范围：`BLOCKED_BY_MAPPING_TARGET_CATALOG` 已标记 `RESOLVED`；Import Workspace UI 尚未实施，仍受 50×256 性能与可访问性门禁。本任务未修改 Schema、Migration、Metadata 数据、前端、R2/Queue/hosting，未连接、迁移或部署生产环境。

### PHASE2-TASK06 设计 - `docs: design import mapping target catalog`

- Git Commit：Material Import Mapping Target Catalog V1 正式规格、OpenAPI 和治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `d1c6763`。
- 路由与权限：比较批次作用域、全局作用域和混入现有 Mapping 三种方案，推荐 `GET /api/material-master/import-batches/:batchId/mapping-targets`；要求 `material.import.read` + `material.import.map`、owner/`read_any` 行级可见性和隐藏 404，`read_any` 不自动等于 map。
- 数据来源：基础和特殊目标来自后续共享 Target Registry；动态属性只读运行时 D1 ACTIVE metadata，不读 seed、fixture 或历史 Mapping，不暴露 attribute id、表名、列名或 SQL。
- digest 审计：确认当前实现只摘要基础/供应商 code 与属性 code/type/status，且 Parser 准备与 Mapping Service 各自投影；规格要求实施前抽取共享 Registry + `MappingMetadataSnapshotV1`，由 Catalog、准备、保存、preview 和 confirm 共同使用，禁止第二套 digest。
- 契约：定义 BASIC/ATTRIBUTE/SPECIAL 三组、保留现有小写 namespace 与大写 target code、完整 target DTO、统一有界搜索/cursor、Metadata/展示双摘要、`private, no-store`、历史失效目标和稳定安全错误。
- 测试与决定：记录 43 项未来实施测试和 12 项 `PROPOSED` 决定；Catalog 不可用时整体阻断 TargetSelector，不允许降级到基础字段或前端硬编码。
- 验证与范围：5 份 OpenAPI YAML/本地引用、规格 43 项编号/12 项决定、lint 0 error/1 个既有 warning、build 与全量 Node 288/288、隔离 API smoke、Drizzle 34 表无漂移、272 文件凭证扫描和临时 SQLite 完整基线通过；最终 `git diff --check` 与 docs-only 范围在提交前复核。未修改运行时代码、Mapping 语义、Schema、Migration、Metadata、前端、R2/Queue/hosting 或生产环境。

### PHASE2-MAINT-01 修复 - `fix: ignore comment-only rollback statements`

- Git Commit：共享 breakpoint-aware Migration statement 过滤、隔离回归测试和治理文档在独立维护提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `f965ddb`。
- 根因：Migration 测试 helper 按既有 breakpoint 分割后仅执行 `trim().filter(Boolean)`；0005 protected Down 尾部 `-- End of protected 0005 rollback.` 非空，因此被作为没有可执行 SQL 的 D1 statement 提交。
- 修复：在共享测试/开发辅助层识别空白、`--`、`/* ... */`、单/双引号和成对引号转义，只过滤没有可执行内容的片段；提交 D1 的仍是未修改原片段。未闭合字符串或块注释 fail-closed 保留给 D1 报错；不支持 SQLite 本身不支持的嵌套块注释。
- 复用：0003、0004、0005 Down 测试和仓库内确认使用相同 breakpoint 语义的 Migration 夹具统一调用共享辅助器；未按分号切分，也未针对 0005 特判。
- 回归：新增 10 个隔离 D1 用例覆盖尾部行注释、块注释、空白、SQL 前后注释、字符串内注释标记/分号、混合注释和异常片段 fail-closed；0003、0004、0005 Down 专项均通过。
- 验证：Migration 专项 20/20；build 与全量 Node 288/288；lint 0 error/1 个既有 warning；隔离 API smoke、4 份 OpenAPI、Drizzle 34 表无漂移、凭证扫描、临时 SQLite 完整基线和范围检查通过。
- 边界：0003/0004/0005 Up/Down、Schema、Drizzle snapshot/journal、API 和生产配置均未修改；0005 尾部保护说明保留，Migration 业务语义不变；未连接、迁移或部署生产环境。

### PHASE2-TASK05 设计 - `docs: design material import workspace ui`

- Git Commit：Material Import Workspace UI V1 的三份正式设计文档与项目治理更新在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `73435a3`。
- 路由与状态：定义 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`，采用服务端状态驱动的单工作区 Stepper；`view` 仅为展示意图，非法参数 replaceState 规范化；列表使用不透明单向 cursor 的单批结果导航。
- 文件与上传：确定先预检/SHA/确认再创建批次；推荐专用 Worker 的真实增量 SHA-256；共享 API Client 内受控 multipart XHR transport；精确区分网络上传进度、服务端存储/安全检查、取消和 RESULT_UNKNOWN；重复 REJECT 后按新批次 ALLOW_DUPLICATE 流程恢复。
- 解析与查看：定义 parse 前重读、独立幂等、2/5/10 秒受控轮询、网络与 Retry-After 退避、协作式取消和粗粒度真实状态；Sheet/Rows 使用真实分页并保留稀疏 cell、日期、公式、错误、列宽与尾随空列语义。
- Mapping：采用三列编辑器、显式保存、已保存版本预览和当前页面最新 preview 门禁；confirmed 只读且不虚构确认人/时间、不显示正式导入；100 项未来实施测试逐条记录。
- 门禁：记录 `BLOCKED_BY_MAPPING_TARGET_CATALOG`，禁止从 seed、测试数据或前端硬编码绕过动态目标；记录 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`，50×256 未验收前不开放完整实施或 page_size=100。
- 决策：16 项均保持 `Status: PROPOSED`，只有完整文档审阅后收到“规格确认”才能转为 `APPROVED`。
- 验证：lint 0 error/1 个既有 warning、环境守卫 6/6、隔离 API smoke、4 份 OpenAPI 解析、268 文件凭证扫描、100 项测试编号/16 项决定/22 状态线框结构检查和临时 SQLite 基线通过。`npm test` 构建成功但基线未全绿：并发运行 275/278 通过，两个超时迁移串行复跑通过；`0005 protected Down` 单独复跑仍因 rollback SQL 尾部纯注释被测试 helper 当作 D1 statement 而失败。本任务按 docs-only 边界不修改既有迁移或测试运行时代码。
- 范围与生产：仅新增/更新文档；未修改前端运行时代码、API、Schema、Migration、R2/Queue、hosting 或生产配置，未连接、迁移或部署生产环境。

### PHASE2-TASK04 实施 - `feat: add material import parser and mapping`

- Git Commit：Parser 与字段 Mapping V1 非生产实现、测试和治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `a16b2f3`。
- 数据库：新增不可修改的 `0005_material_import_parser_mapping.sql`、Drizzle schema/快照/journal 和数据保护 Down；扩展批次状态与 current run，新增 parse run、Sheet、Shared Strings 分块、Outbox、header suggestion、Mapping 主从表，并按 legacy run 保留既有原始行。
- Parser：固定 `@zip.js/zip.js@2.8.26`、`sax-wasm@3.1.4`、`csv-parse@7.0.1`；实现 Web Streams 有界 XLSX/CSV、UTF-8/BOM/GB18030、三种分隔符、OOXML/XML 安全、日期/公式/隐藏 Sheet、组合资源限制和稳定 raw row hash。
- 调度与恢复：实现 D1 Outbox dispatcher、可注入 scheduler、Cloudflare Queue adapter、至少一次去重、run 租约/接管/心跳、Sheet 恢复、分阶段失败、原始行原子发布和 Mapping 准备独立重试；没有创建 Queue binding 或部署配置。
- Mapping/API：实现 Sheet/行读取、header candidates、关系化 Mapping 完整替换、静态与动态 target allowlist、100 行预览、metadata 摘要确认、乐观锁、事务幂等/审计及七个精确 API；明确不创建 Material Draft 或正式物料。
- 权限：新增 `material.import.parse` 与 `material.import.map` capability；admin/manager/purchase/engineering 获显式授权，`read_any` 不隐含 parse/map；继续执行 owner/read_any 最小披露、Origin/CSRF 和隐藏 404。
- 验证：专项 Parser 36、集成 11、migration 4、兼容 3，共 54/54；全量 Node 278/278、build、隔离 Parser TypeScript 夹具、隔离 API smoke、OpenAPI YAML、Drizzle 无漂移、265 文件凭证扫描及本地临时 SQLite 基线通过，lint 0 error/1 个任务外既有 warning。全仓 `tsc --noEmit` 的 10 个既有任务外错误未在本任务修复。
- 依赖审计：`npm audit --omit=dev` 仍报告 Next 内置 PostCSS 的 2 个 moderate，建议修复会触发破坏性版本变化；本任务不执行 force fix。新增 Parser 依赖的固定版本、许可证、构建和运行时兼容测试通过。
- 生产影响：无。未连接生产 D1/R2/Queue，未创建 bucket/binding/Cron，未执行生产 migration、修改 hosting 或部署；未实施前端、清洗、分类、匹配、AI、Material Draft 或正式物料写入。

### PHASE2-TASK03 设计 - `docs: design material import parser and mapping`

- Git Commit：Parser 与字段 Mapping V1 文档在独立提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `63e0483`。
- 规格：新增 Parser 主规格、OpenAPI 草案、Mapping 规格和 Mermaid 流程图，覆盖 `FILE_READY -> MAPPING_CONFIRMED`、`PARSED` 原子发布恢复点、用户可见性和失败分类。
- 调度与恢复：明确 D1/Queue 无分布式事务，推荐持久 Outbox；Queue 至少一次、`max_batch_size=1`、低并发和租约保持 `PROPOSED`。V1 以 Sheet 为真正恢复边界，500 行检查点只用于观测、预算、心跳和幂等写入。
- 数据模型：设计 `parse_runs`、Sheet/header、Outbox、Shared Strings、Mapping 主从表、`current_parse_run_id` 及 `material_import_rows` 唯一约束重建；只提出 `0005` Up/Down/回滚方案，未创建 migration 或修改 Drizzle。
- 解析与安全：方案 A `zip.js + sax-wasm + 受限 OOXML`、CSV `csv-parse` 均为待兼容验证候选；定义 XML/OOXML、公式、外链、隐藏 Sheet、编码、稀疏 cell、行宽、日期解释、Shared Strings 和组合资源预算。
- Mapping/API：定义 Sheet/header suggestion、稳定 target catalog、`category_hint`、一源一目标、受限默认值、预览、确认、旧 Mapping 失效、七个 API、权限、CSRF、幂等、CAS 和稳定错误。
- 决策：集中记录 16 项 `Status: PROPOSED` 决策；设计方向确认不等于正式规格确认、实施批准或生产批准。
- 验证：文档完成后运行 Site lint、全量 Node、隔离 API smoke、凭证扫描、临时 SQLite 基线、OpenAPI YAML 解析、`git diff --check` 和范围核对；实际结果记录在 `STATUS.md`。
- 生产影响：无。未实施 Parser、Schema、`0005`、Queue、R2/Cron、API、前端、生产迁移或部署，未连接生产 D1/R2。

## 2026-07-15

### PHASE2-TASK02 实施 - `feat: add material import batch foundation`

- Git Commit：Material Import Batch Foundation V1 的非生产实现、测试和治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `050d134`。
- 数据库：新增 `0004_material_import_batch_foundation.sql`、Drizzle schema/快照及带数据保护的 Down 文件；创建批次、文件、冻结原始行契约、不可变事件和专用幂等五表，包含 V1 状态、外键、唯一性、终态与完整性约束。
- 对象存储：新增可注入接口、R2 适配器和内存测试替身；确定性环境前缀 key 使用条件写入且不覆盖，支持 HEAD、范围读取和受控删除；没有创建生产 bucket、binding 或密钥。
- 上传与安全：实现恰好一个 `file` part 的有界流式 multipart、10 MiB 实际计数、增量 SHA-256、声明哈希核对与文件类型探测；XLSX 检查 OOXML/ZIP 结构、加密/宏/条目/展开/压缩比/路径边界，CSV 检查 UTF-8/GB18030、NUL、二进制和完整 HTML 伪装，不解析工作表或业务行。
- API、权限与 Saga：实现创建、列表、详情、上传、事件、取消六个精确路由；复用 Session/Origin/CSRF，以 capability + owner/`read_any` 执行行级可见性和隐藏 404，并实现专用幂等、限流、乐观并发、重复 SHA 策略、D1/R2 故障协调、取消竞争及手工清理服务。
- 验证：新增迁移 3/3、导入 API/Saga/安全 12/12；全量 Node 224/224、build、隔离 API smoke 和 247 文件凭证扫描通过，lint 0 error/1 个任务外既有 warning。
- 本地基线：项目 Python 3.12 在临时 SQLite 中运行 `server.py --self-test`、`smoke_test.py` 和 `go_live_check.py --no-backup` 全部通过，临时数据已清理。
- 文档：12 项决定转为 `APPROVED`；同步正式规格、OpenAPI、数据流/状态图、MASTER、TASKS、ROADMAP、DECISIONS、STATUS 和 CHANGELOG；Excel/CSV 行解析顺延为 `PHASE2-TASK03`。
- 数据库与生产：未连接生产 URL/D1/R2，未执行生产迁移，未创建生产 R2 资源、生命周期或 Cron，未部署；没有解析 Excel/CSV 行、写入 `material_import_rows` 或创建 Material Draft。

### PHASE2-TASK01 设计评审 - `docs: design material import batch foundation`

- Git Commit：正式规格、OpenAPI 草案、数据流图和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `353c6d9`。
- 新增功能：无；本任务只完成 Material Import Batch Foundation V1 书面设计，12 项决定全部保持 `PROPOSED`。
- 存储架构：推荐私有 Cloudflare R2 保存原始文件、D1 保存批次/文件元数据/原始行契约/幂等/不可变事件；记录当前 `.openai/hosting.json` 的 `r2` 为 `null` 且仓库没有可用 binding，不把待新增基础设施表述为现有能力。
- 上传与恢复：定义创建批次后单文件 multipart Worker 代理上传；以确定性、不可覆盖 object key 和实际 SHA/字节数构成可恢复 Saga，不宣称跨 D1/R2 分布式事务或 exactly-once。
- 状态与安全：分离文件 `storage_status` 与 `security_check_status`；只有 STORED、基础检查通过、实际摘要/大小和有效检测类型同时满足才进入 `FILE_READY`；增加批次级 `RECONCILIATION_REQUIRED`、取消竞态和清理事件。
- 数据契约：定义批次、文件、0-based 工作表原始行、不可变事件和专用导入幂等技术表；冻结 `EMPTY/TEXT/NUMBER/BOOLEAN/DATE/FORMULA/ERROR` 类型化单元格契约，CSV 固定 `sheet_index=0`、`sheet_name=__CSV__`。
- API、安全与并发：OpenAPI 草案包含创建/列表/详情/上传/事件/取消 6 个操作；服务端 capability 与 owner/`read_any` 行级可见性、CSRF、限流、CAS、规范化 multipart 摘要、重复 SHA 显式动作和安全错误码均有定义，不提供下载或对象地址。
- 保留与 Migration：建议以 `terminal_at` 计算原始数据和批次记录保留期，采用两阶段可恢复清理；只描述未来 `0004` 的五表、V1 CHECK、候选索引查询依据和扩展式迁移，不创建任何迁移文件。
- 平台依据：Worker 内存/请求体、D1 行/BLOB、R2 私有访问、上传与价格事实均引用 2026-07-15 当前 Cloudflare 官方文档；10 MiB 业务上限仍为保守建议，仓库没有历史样本容量证据。
- 验证：OpenAPI YAML 与 93 个本地引用解析通过，6 个操作；12 项决定结构检查通过。build 通过；全量 Node 串行 209/209、隔离 API smoke、环境守卫 6/6、凭证扫描 236 个文件、lint 0 error/1 个既有 warning通过。首次并行全量中一个迁移用例因 120 秒资源竞争取消，单独 1/1 与串行全量均通过。
- 本地基线：项目 Python 3.12 临时 SQLite 环境守卫 4/4、`server.py --self-test`、`smoke_test.py`、备份恢复和 `go_live_check.py --no-backup` 全部通过；临时数据已清理。
- 数据库与生产：未修改运行时代码、Schema、Migration、索引、对象存储、Binding、API、前端或部署配置；未连接生产 URL/D1/R2，未创建 bucket、密钥、生产版本或部署。
- 停止条件：提交后停止，等待项目负责人逐项选择并统一回复“规格确认”；此前任何推荐方案都不得转为 `APPROVED` 或进入实施。

### PHASE1-TASK14 实施 - `feat: add material review ui`

- Git Commit：前端实现、UI 测试、规格和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `c6ddf3b`。
- 页面与入口：新增 `/materials/review` 与 `/materials/:materialId/review`；`MaterialShell` 只按 `material.review.queue` 显示审核队列入口，不按角色名推断权限。
- 审核队列：实现 URL 权威筛选、300ms 关键词、叶子分类、来源、创建人、提交日期、四种 allowlist 排序及 20/50/100 服务端分页；展示 `submitted_by` 但不伪造服务端不支持的筛选，服务端 `total` 为唯一权威。
- 工作台与复用：按方案 A 实现左侧完整只读详情、右侧约 310px sticky Validation/职责分离/审核操作；提取共享只读详情组件供既有详情与审核工作台复用，既有只读 UI 37/37 回归通过。
- 批准与驳回：最终动作前重读统一详情；ERROR 禁止批准但不自动驳回，WARNING 在单一最终对话框列出并明确确认；批准复读 ACTIVE/正式编码，驳回复读 DRAFT/`last_rejection` 后返回原队列状态。
- 权限与职责：queue/approve/reject 独立能力驱动；创建人或最后修改人禁审，提交人本身不禁审；前端提示与关闭动作，既有服务端权限、职责、状态和 Validation 校验保持最终权威。
- 幂等与并发：approve/reject 使用独立的页面内存 Key、不可变 endpoint/payload 快照和共享 Client 受保护写；覆盖重复点击、`RESULT_UNKNOWN` 原请求安全重试、`IDEMPOTENCY_IN_PROGRESS`、冲突、状态变化、422、429、401/403/404/5xx 和 request_id。
- 安全与可访问性：实现安全 `return_to`、dirty/beforeunload、离开确认、纯文本渲染、焦点定位、对话框初始焦点/Tab 循环/Escape/焦点恢复及 live region；不写 localStorage/sessionStorage，不引入第二套认证或 HTTP Client。
- 测试：新增 Review UI 51/51；全量 Node 209/209；build 通过；lint 0 error/1 个任务外既有 warning；一次性隔离 D1 API smoke 与 233 文件凭证扫描通过。
- 浏览器验收：本地 Vinext + Playwright 在 1366×768 完成队列、310px sticky 审核栏、WARNING 确认和批准后返回原队列的完整往返；验收网络夹具及截图未提交。
- 本地基线：临时 SQLite `server.py --self-test`、`smoke_test.py`、备份恢复、环境保护 4/4 和 `go_live_check.py --no-backup` 全部通过；临时数据已清理。
- 数据库与生产：未修改 API、Schema、Migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 URL/D1，未迁移真实数据、创建生产版本或部署。
- 已知限制：队列 API 仍不支持 `submitted_by` 筛选；远程 Test D1、候选索引、`PENDING_APPROVAL` 收缩及生产迁移/部署均需独立任务与授权。

### PHASE1-TASK13 设计评审 - `docs: design material review ui`

- Git Commit：正式规格、低保真线框和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `9278bea`。
- 新增功能：无；本任务只完成 Material Review Queue 与审核工作台 V1 书面设计，不修改任何运行时代码。
- 路由与布局：定义 `/materials/review` 和 `/materials/:materialId/review`；推荐方案 A，即左侧完整只读详情、右侧 sticky Validation/职责分离/审核操作，方案 B 仅作比较。
- 队列与返回：筛选、排序和分页由 URL 管理；批准或驳回成功后安全返回原队列状态，当前页清空时回到最后有效页；展示 `submitted_by`，但不提供服务端尚不支持的提交人筛选。
- 权限与职责：按 `user.permissions` 展示入口和动作，不硬编码角色；`created_by` 或 `last_modified_by` 命中当前用户时先提示并关闭审核动作，服务端 `403 SELF_REVIEW_FORBIDDEN` / `LAST_EDITOR_REVIEW_FORBIDDEN` 继续作为最终判断。
- 批准与驳回：批准前重新 GET 最新详情并使用单一最终确认；WARNING 确认绑定物料、版本和规范化 Validation 摘要，但摘要仅是前端新鲜度标记。驳回要求 1–1000 字原因；approve/reject 使用相互独立的页面内存幂等状态。
- 错误与可访问性：结构化 `error.code` 优先；覆盖 VERSION_CONFLICT、RESULT_UNKNOWN、401/403/404/422/429/500、文字状态、键盘对话框、焦点恢复、问题定位和纯文本渲染。
- 测试设计：保留并分组定义全部 51 项实施测试，附方案 A/B、主要状态、确认对话框和 1366×768 线框；写测试只能使用一次性本地隔离 D1，并拒绝 production、公共 URL 和远程 binding。
- 验证结果：lint 0 error/1 个既有 warning；构建与 Node 158/158、一次性本地 D1 API smoke、226 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查全部通过；临时数据已清理。
- 数据库与生产：未修改前端运行时代码、API、Schema、Migration、索引、业务服务或部署配置；未连接生产 URL/D1，未迁移真实数据或部署。

### PHASE1-TASK12 实施 - `feat: add material draft ui`

- Git Commit：前端实现、UI 测试、规格和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `7e6844d`。
- 页面与入口：新增 `/materials/new` 和 `/materials/:materialId/edit`；列表创建入口与 DRAFT 详情编辑入口仅依据 `/api/session -> user.permissions` 和 own/any 能力显示，不硬编码角色。
- 表单：实现布局 C、分类树和当前叶子 Schema、TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/compatible unit、严格数值、完整 attributes、0/false、未知旧属性显式删除和分类切换确认。
- 写链路：实现创建 POST、编辑 PATCH 完整替换、GET 回读、Validation ERROR/WARNING、WARNING 版本绑定确认和 submit；保存成功后同步、部分成功、结果未知和提交成功返回只读详情均有独立状态。
- 安全与并发：共享 Client 对受保护 Material 写请求强制显式 Idempotency-Key 与 CSRF；同一操作仅允许原 Key、原 method、原 endpoint、原 payload 重试；覆盖 VERSION_CONFLICT、Retry-After、重复点击、dirty/beforeunload、Schema 漂移和状态/权限变化。
- 驳回与错误：编辑页只读展示 `last_rejection`；401/403/404/409/422/429/5xx 使用安全中文提示和 request_id，不向浏览器暴露 SQL、堆栈或敏感正文。
- 验收：Draft UI 54/54、全量 Node 158/158；build、lint 0 error/1 个既有 warning、隔离 API smoke、224 文件凭证扫描和临时 SQLite 五项基线通过。
- 浏览器：一次性本地 D1 实机完成创建、编辑、PATCH/GET/submit 至 `PENDING_REVIEW`；1366/1280/1024/768 无横向溢出，三列按断点降级，离开保护和程序内成功跳转通过。
- 数据库与生产：未修改 API、Schema、migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 URL/D1，未迁移真实数据或部署。
- 已知限制：统一详情没有历史 `schema_version`；V1 使用当前 Schema、未知 code 保护和服务端 422 重载 fail-closed，不自动迁移旧属性。

### PHASE1-TASK11 实施 - `feat: add last rejection material projection`

- Git Commit：实现、隔离测试、OpenAPI 和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `402ef9b`。
- 历史来源：单一使用不可变 `material_versions` 的 `event_type='REJECT'` 行；现有原子写事务已完整保存版本、驳回原因、审核人和审核时间，不关联 change logs，不修改历史。
- Query Service：新增统一 `lastRejection()` 有界投影；`/materials/:materialId` 与 `/drafts/:materialId` 在既有行级可见性之后复用同一查询，列表不执行且无 N+1。
- 确定性与安全：固定 `version_no DESC, reviewed_at DESC, id DESC LIMIT 1`；无记录返回 null，reason 原样作为纯文本，缺少任一必需历史字段时 fail-closed 为带 request_id 的脱敏 `INTERNAL_ERROR`。
- 查询计划：隔离 D1 返回 `SEARCH material_versions USING INDEX material_versions_material_version_uq (material_id=?)`，未出现全表扫描；本任务未新增索引或 migration。
- 测试：新增 1 个顶层隔离 D1 场景，覆盖 null、单次/多次驳回、摘要窗口外驳回、重编/重提/最终 ACTIVE、两详情一致、drafts 状态限制、隐藏 404、纯文本、损坏历史、确定性 SQL、查询计划和分页/摘要回归；Node 104/104 通过。
- 全量验证：build、lint 0 error/1 个既有 warning、OpenAPI YAML、一次性 D1 API smoke、219 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复、go-live 检查和 `git diff --check` 全部通过。
- 数据库与生产：未修改 schema、migration、索引、审核写服务、前端或历史记录；未连接生产 URL/D1，未迁移或部署。
- 已知限制：现有索引按 material_id/version_no 搜索，没有专用 REJECT 索引；当前单详情计划满足有界要求，若单物料版本规模显著增长需独立复测和审批。

## 2026-07-14

### PHASE1-TASK10 设计评审 - `docs: design material draft ui`

- Git Commit：书面规格、低保真线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `9bb1756`。
- 新增功能：无；本任务只完成 Material Draft 创建、编辑与提交审核界面 V1 书面设计。
- 路由与布局：定义 `/materials/new`、`/materials/:materialId/edit`，采用顶部分类/基础信息、全宽动态属性和约 200px 右侧快速定位/Validation 的布局 C；窄宽下辅助栏移动到顶部。
- 表单与 Schema：只读取当前分类 Reference Schema，按 display_order 和中性分段渲染 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位；PATCH 使用完整可编辑聚合，未知旧属性和分类切换不得静默删除。
- 写状态：定义 POST 创建后 GET 重载、PATCH/GET/submit、WARNING 确认、页面内存 IdempotencyKeyController、RESULT_UNKNOWN 安全重试、SAVED_UNSYNCED、规范化 dirty 和 VERSION_CONFLICT 只读对照。
- 权限与安全：动作只读取 `/api/session -> user.permissions`；复用现有会话、CSRF、安全 return_to 和共享 Client；source_ref 只读，POST 省略、PATCH 不发送；不硬编码角色或复制服务端 Validation。
- API 前置：记录统一详情 `last_rejection` 最小只读投影为正式前端实施阻断前置；本任务未修改 API、Schema、Migration 或写服务。
- 测试设计：定义单元、组件、集成、原 47 项加 7 项扩展 E2E，以及 1366×768 人工视觉/键盘验收；文档阶段运行完整隔离基线。
- 验证结果：lint 0 error/1 个既有 warning；构建和 Node 103/103、一次性本地 D1 API 烟测、219 文件凭证扫描、临时 SQLite 环境守卫/自测/烟测/备份恢复/go-live 检查及 `git diff --check` 全部通过。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK09 实施 - `feat: add material master read ui`

- Git Commit：前端实现、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `7b0527c`。
- 页面路由：新增 `/materials`、`/materials/:materialId`、`/versions` 和 `/change-logs` 四条原生 Vinext 路由；刷新、深链接和浏览器历史不依赖 hash 或 iframe 内 tab。
- 列表：实现紧凑筛选、高密度横向滚动表格、固定编码/名称列、服务端分页/排序、20/50/100 page_size、300ms keyword debounce、分类树和 URL 权威状态；分类失败不阻断基础列表。
- 详情与历史：实现基本、职责、类型化属性、Validation、最近 5 条版本/变更摘要分区；完整历史独立分页、comment 折叠、快照/diff 有界行下展开和 operation_id 安全显示，不提供恢复或写操作。
- 认证与请求：抽取唯一 `public/erp/api-client.js`，legacy 与 Material 页面共同使用相对 URL、同源 Cookie、Material/legacy 错误解析和 401 事件；Material 未认证访问使用现有根页面登录遮罩并通过安全 `return_to` 返回。
- 状态与错误：INACTIVE 独立显示“停用”，OBSOLETE/REPLACED 仅作防御性展示，未知状态安全降级；400/401/403/404/500、网络失败、request_id、加载、空数据库和筛选无结果均有页面状态。
- 测试：UI 单元/契约 37/37；全量 Node 103/103；四条本地 Vinext 开发路由均返回 200；lint 0 error/1 个任务外既有 warning；build、隔离 API smoke、217 文件凭证扫描和临时 SQLite 完整基线通过。
- 数据库/API：未修改 API、Schema、Migration、索引、Material 业务服务或 legacy SQLite；前端不执行行级权限过滤并以服务端 total 为唯一总数。
- 已知限制：当前普通 Node production start 不能加载 Vinext 构建中的 `cloudflare:` 模块，本地深链接验证使用既有开发运行面和正式 build；生产 Site 仍为旧版本。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK09 设计评审 - `docs: design material master read ui`

- Git Commit：书面规格、文字线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `4d2f54b`。
- 新增功能：无；本阶段只完成 Material Master 只读管理界面 V1 书面设计。
- 页面设计：列表采用高密度紧凑筛选和企业表格，详情采用高密度分区卡片；版本历史与变更日志保留独立 URL 并作为详情工作区页签。
- URL 与交互：定义列表查询规范化、keyword debounce、前进后退、深链接、安全 `return_to`、分类 ID/path 语义、服务端分页/排序和固定关键列。
- 权限与错误：前端不复制行级权限；隐藏对象统一 404；定义 401/403/400/500、网络失败、request_id、Material 嵌套错误和 private/no-store 边界。
- 历史与属性：定义 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位/空值展示、Validation ERROR/WARNING、最近 5 条摘要、有界版本快照和变更详情。
- 架构：记录现有 iframe/tab、无通用组件和 legacy 错误包装差异；建议使用真正 Vinext 路由、唯一共享浏览器请求边界，不新增大型状态或请求依赖。
- 验证：规格占位符/路由/范围自检通过；Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、203 文件凭证扫描和临时 SQLite 完整基线通过；临时数据已清理。
- 数据库/API/代码：无变化；未修改前端、API、Schema、Migration、索引、业务服务或 legacy SQLite。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK08 实施 - `feat: add material reference and query api`

- Git Commit：实现、测试、查询计划证据和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置规格提交为 `928e08f`。
- Query Service：统一 materials/drafts 的列表、可见性、详情聚合、类型化属性、当前 metadata 校验和历史读取；drafts 只保留工作流兼容字段与分页外壳，审核队列保持独立。
- API：新增分类 tree/flat、四级叶子 Schema、`/materials` 列表/详情、版本分页和变更日志分页 6 个路由；详情历史摘要各最多 5 条，完整历史默认 20、最大 50。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 扩展；授权谓词与筛选在 SQL/count 取交集，隐藏记录不返回、不计 total，不可见详情/历史返回 404。
- Metadata 与缓存：Schema 只读当前 D1，不读 seed；description 缺失为空字符串，enum label 缺失等于 code；共享 Validation 单位策略；Reference 使用强内容摘要 ETag/304，物料及历史使用 `private, no-store`。
- 性能：列表分类路径与审核 metadata 批量加载，新增查询次数防 N+1 回归；1k/10k/100k 查询计划和采样已记录，发现候选优化方向但未创建索引或 migration。
- 测试：Site build、Node 66/66、隔离 API smoke、lint 0 error/1 个任务外既有 warning、201 文件凭证扫描、查询计划脚本和临时 SQLite 完整基线通过；全量 tsc 仍只有 `db/schema.ts` 两处既有 Drizzle TS2740，按范围未修改。
- 已知限制：继续双读 `PENDING_APPROVAL`；leading-wildcard keyword 没有专用全文索引；候选索引需再次审批；无前端、写接口、导入、AI、候选匹配、真实迁移或下游业务变化。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK08 设计评审 - `docs: design material reference and query api`

- Git Commit：书面规格、OpenAPI 和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `0edede0`。
- 新增功能：无；本阶段只完成 Material Master Reference & Query API V1 书面设计。
- API 设计：新增统一 `/materials` 列表/详情、分类树、叶子 Schema、版本分页和变更日志分页契约；`/drafts` 保留为复用统一 Query Service 的兼容层，`/review-queue` 保持独立。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 取交集；列表在 SQL/count 中过滤，不可见详情返回 `404 MATERIAL_NOT_FOUND`。
- 缓存与性能：分类 tree/flat 和叶子 Schema 使用规范化内容摘要 ETag 与私有可验证缓存；物料、历史和工作流响应统一 private/no-store；列表不逐项 Validation，详情只执行单物料当前校验，历史有界分页。
- 数据库变化：无；未创建 migration 或索引。只列出候选组合索引，要求后续先完成 1k/10k/100k 合成数据的 `EXPLAIN QUERY PLAN` 和延迟证据，并再次审批。
- 文档变化：新增 `reference-query-api-v1.md` 和 OpenAPI；D-014 记录已确认架构与读取范围；同步更新 MASTER、TASKS、STATUS。
- 待确认：规格最终字段、分页、缓存 Header，以及现有 metadata 无 description/枚举显示名时采用空 description 和 `label = code` 的 V1 表达。
- 验证：OpenAPI YAML、9 个路由/35 个 schema 引用和占位符检查通过；Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 Miniflare API smoke、196 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时数据已清理，`git diff --check` 通过。
- 生产影响：无；未修改 Schema、migration、API 代码、业务服务或前端，未连接生产 D1、迁移真实数据或部署。

### PHASE1-TASK07 实施 - `feat: add material draft lifecycle`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `3dbf2b0`。
- 状态机：实现 `DRAFT -> PENDING_REVIEW -> ACTIVE` 和 `PENDING_REVIEW -> DRAFT`；驳回后允许完整替换编辑并重新提交，批准/驳回不再接受 `DRAFT`。
- API：新增 PATCH 草稿完整可编辑聚合替换、POST 提交和 GET 审核队列；补充 OpenAPI 非 Merge Patch 契约、稳定状态错误、默认分页/排序、allowlist 筛选和当前 metadata 校验摘要。
- 权限与职责：新增 edit-own/edit-any/submit/review-queue；提交同时校验 own/edit-any；创建人永久禁审、当前提交版本最后修改人禁审，无 admin 例外，`submitted_by` 本身不构成禁审。
- 数据库：新增 `0003_material_draft_lifecycle.sql`、受保护 Down 和 Drizzle snapshot/journal；增加三个职责字段、双状态过渡约束、PATCH 幂等 method 和四个审核队列索引；可验证旧待审数据回填，无法恢复职责时预检失败，历史快照不改写。
- 并发与安全：PATCH、submit、approve、reject 继续使用严格 Origin/CSRF、24 小时幂等、60/20 限流和乐观锁；业务、属性、版本、变更日志、幂等完成与 API 成功审计在单一 D1 batch 提交。并发 PATCH/提交/审核均验证仅一个成功。
- 测试：build 和 Node 62/62 通过；lint 0 error/1 个既有 warning；`0003` 升级、失败预检、约束、索引、空库 Down/重升、完整生命周期、职责分离、N+1 边界及一次性 D1 smoke 通过；194 文件凭证扫描和本地临时 SQLite 基线通过。
- 已知限制：过渡 schema 仍接受 `PENDING_APPROVAL`，破坏性收缩必须另建任务；无页面、多级审核、break-glass、导入、AI、真实物料迁移或下游业务修改；既有 Drizzle 自引用 TypeScript 诊断未在本任务修复。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK07 设计评审 - `docs: design material draft lifecycle`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成草稿生命周期、重新提交和审核队列 V1 书面设计。
- 修改功能：无；未修改现有 Validation、Draft/Review Service、Material API、页面或 legacy 运行面。
- 数据库变化：无；规格提出后续前向 migration 增加 `last_modified_by`、`submitted_by`、`submitted_at`，分步统一 `PENDING_REVIEW`，扩展 PATCH 幂等 method 并增加审核队列索引，当前未创建或执行 migration。
- API 变化：无已实现路由；规格拟议 PATCH 草稿、POST 提交和 GET 审核队列，并收紧批准/驳回只能操作 `PENDING_REVIEW`。
- 权限与职责：拟议 edit-own/edit-any/submit/review-queue 权限；所有角色继续禁止创建人自审，并新增最后实质修改人不得审核当前版本。
- 文档变化：新增 `docs/material-master/draft-lifecycle-v1.md`；D-013 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险和下一步。
- 待确认：当前职责字段方案、物理状态更名、PATCH 完整替换、编辑 Validation 阻断、提交人审核、队列校验口径、提交说明、权限矩阵和 migration 分步方案。
- 验证：Site build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；一次性 Miniflare API smoke、189 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore 和 `go_live_check --no-backup` 通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK06 实施 - `feat: add material draft and review api`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `e55318c`。
- 新增功能：实现创建、列表、详情、批准、驳回 5 个 Material 路由；复用现有会话并增加细粒度权限、全员禁止自审、严格 Origin/双提交 CSRF、稳定错误和只读 Query Service。
- 数据库变化：新增 `0002_material_draft_review_api.sql`、空隔离库 Down、Drizzle snapshot/journal；增加 `material_api_idempotency`、`material_api_rate_limit_buckets`，扩展关系化 API 审计列及 Material 列表/审计索引；未修改 `0000`/`0001`，未执行生产 migration。
- 并发与安全：幂等作用域为用户、方法、具体路径和 Key 摘要；保存 canonical 请求摘要、120 秒租约和 24 小时结果，成功完成/审计与 Material 业务 batch 原子提交；每用户每分钟 60 次写尝试/20 个新 Key，admin 不豁免，测试可降低阈值。
- 审计：Material API 审计关系化记录物理请求、稳定操作、Key 摘要、对象和版本，在线保留目标为 1095 天；admin 完整查看、manager 只读查看，提供受控分页导出，`material_change_logs` 不随 API 或幂等清理删除。
- 业务边界：公共创建只允许 `MANUAL`，非 MANUAL 返回 `SOURCE_TYPE_NOT_ALLOWED`；V1 只提供单步最终审核，不实现页面、草稿编辑、多级会签、break-glass、导入、AI 或下游业务变更。
- 验证：build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；版本化迁移已有数据升级、约束、Down/重升通过；一次性 Miniflare 登录/CSRF/API smoke、凭证扫描、`git diff --check` 和本地临时 SQLite 基线通过。TypeScript 全量检查仍只有 `db/schema.ts` 两处既有自引用类型错误。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署、未修改生产配置。

## 2026-07-13

### PHASE1-TASK06 设计评审 - `docs: design material draft and review api`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成受认证授权 Draft/Review API V1 书面设计。
- 修改功能：无；未修改现有 Draft/Review/Validation Service、API、页面或 legacy 运行面。
- 数据库变化：无；只提出后续新增 `0002`、专用 `material_api_idempotency`、有界速率桶、关系化通用审计字段、列表/审计索引和隔离迁移测试，未创建 migration 或连接 D1。
- API 变化：无已实现路由；规格拟议创建、列表、详情、批准、驳回 5 个路由，明确现有会话认证、细粒度权限、Origin/CSRF、持久幂等、乐观锁和稳定错误映射。
- 文档变化：新增 `docs/material-master/draft-review-api-v1.md`；D-012 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险、下一步和验证状态。
- 待确认：审核角色、创建人自审、多节点审核边界、批准/驳回角色是否相同、幂等与审计保留期、写速率阈值及人工 API 来源范围。
- 验证：Site build、Node 52/52、lint（0 error/1 个既有 warning）、一次性 D1 API smoke、177 文件凭证检查通过；本地环境守卫 4/4、self-test、smoke、backup/restore、临时 SQLite go-live 检查通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK05 - `feat: add material draft and review service`

- Git Commit：规格、实现、测试和项目文档在本任务独立提交完成，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：新增 `material-master` 六模块，提供 `createDraft()`、`approveDraft()`、`rejectDraft()`、类型化属性持久化、正式编码格式和统一导出。
- 状态流转：创建固定写 `DRAFT` 且无正式编码；批准重新校验后以单一 D1 batch 原子写 `ACTIVE`、编码、批准信息、版本和审计；拒绝保持 `DRAFT`、递增版本并记录拒绝历史。
- 并发与安全：物料使用 `expected_version` 乐观锁，编码规则使用 version/sequence CAS 和唯一索引；创建/批准事务比较 metadata/属性守卫，校验后规则变化会冲突回滚；服务错误不返回 SQL 或底层 D1 异常。
- 数据库变化：无 schema 或 migration 变化；只使用现有 V2 表和约束，未写生产数据。审计业务动作映射为 `CREATE_DRAFT -> CREATE`、`APPROVE -> APPROVAL`、`REJECT -> REJECTION`、`CODE_GENERATE -> CODE_ASSIGNMENT`。
- API 变化：无；未修改路由、`erp-api.ts` 或页面。
- 文档变化：新增草稿/审核服务 V1 规格与实施结果；D-011 确认所有未来来源统一经过该服务及最终审核启用时生成正式编码；同步更新总控、任务和状态。
- 验证：新增 12 个隔离 D1 服务测试，覆盖校验阻断、提交前复核、并发审核、重复编码、防 TOCTOU 和故障回滚；完整 Node 52/52、build、lint（0 error/1 个既有 warning）、隔离 API smoke、176 文件凭证检查和差异检查通过；未连接生产 D1。

## 2026-07-12

### PHASE1-TASK04 - `feat: add material validation service`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `e239c35`。
- 新增功能：新增 Repository + Rules + Service 三层 `material-validation` 模块，提供创建前和审核前校验、D1/Memory Repository、25 个结构化 code 及稳定错误顺序。
- 修改功能：测试入口显式启用 Node TypeScript stripping，以兼容项目声明的 Node 22.13 最低版本；未修改现有业务行为。
- Bug 修复：无现有业务 Bug；实现期间补足绑定属性优先、未绑定属性随后输出的稳定排序。
- 数据库变化：无 schema、migration 或生产数据变化；D1 Repository 只读现有分类、绑定和属性定义 metadata，不缓存、不读取 seed。
- API 变化：无；未接入路由或现有 `erp-api.ts`。
- 文档变化：完成物料校验服务 V1 规格与实施结果；D-010 记录 D1 metadata 唯一运行时规则来源；同步更新项目状态。
- 验证：新增 28 个校验测试，完整 Node 40/40；lint、build、隔离 API 烟测、凭证检查和差异检查通过；未连接生产 D1。

### PHASE1-TASK03 - `feat: add material category and attribute templates`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `ebef667`。
- 新增功能：新增 `material-category-v1` TypeScript 声明数据和 test/local 专用 seed 执行器，输出分类、属性、绑定的插入/更新统计。
- 修改功能：无现有业务功能变化；不接入 AI、Excel、真实物料、BOM、采购、库存或生产。
- Bug 修复：无。
- 数据库变化：无 schema 或 migration 变化；seed 可向已迁移的隔离 D1 幂等写入 101 个分类、34 个属性定义和 228 条四级叶子显式绑定，使用本地 D1 原子 batch。
- API 变化：无。
- 文档变化：新增分类标准 V1 与设计规格；D-009 明确模板复制而非父子继承；同步更新项目状态文档。
- 验证：seed 声明、父子层级、关键必填模板、幂等、环境拒绝和原 migration 测试通过；未连接生产 D1。

### PHASE1-TASK02 - `feat: implement material master v2 schema`

- Git Commit：本任务独立提交，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无业务功能；新增 Material Master V2 数据契约与可回滚迁移框架。
- 修改功能：无；现有 API、页面、BOM、采购、库存和 legacy SQLite 不变。
- Bug 修复：无。
- 数据库变化：新增 12 张在线 D1 V2 表的 Drizzle schema、`0001` Up、Down、快照、约束与索引；正式编码仅允许审核后生命周期，供应商映射唯一身份包含 supplier/code/manufacturer/mpn/revision 与有效期。
- API 变化：无。
- 文档变化：更新设计基线和项目状态，新增 `docs/audits/phase1-task02-schema-report.md`。
- 验证：本机一次性 D1 完成空库 Up、防重、结构/约束、Down 和重建；完整基线结果见审计报告。未连接生产 D1。

## 2026-07-11

### PHASE1-TASK01 设计评审 - `docs: design material master v2 data model`

- Git Commit：设计评审独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无；当前只完成设计。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无；仅设计 11 张在线 D1 V2 关系表、约束、索引和 Up/Down 迁移顺序，未创建数据库对象。
- API 变化：无。
- 文档变化：新增 `docs/material-master/database-model-v2.md`，包含 ER 图、字段说明、`legacy_material_mapping`、来源追踪、迁移/回滚方案、测试矩阵、AI 接入边界和风险；记录在线 D1 唯一目标及动态属性决策。
- 验证：文档占位符、内部一致性、11/11 表级 `created_at` 覆盖和 `git diff --check` 通过；Site lint 0 错误/1 个既有警告、构建与 Node 测试 8/8、凭证检查通过；本地 ERP 自测、烟测和上线检查在一次性临时 SQLite 中通过且目录已清理。等待人工设计审批。

### PHASE0-TASK02 - `security: establish environment isolation baseline`

- Git Commit：本任务独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：统一 development/test/production 环境清单；本机一次性 Miniflare D1 烟测运行器；生产/公开 URL/非临时路径拒绝；凭证扫描；本地 SQLite 环境与备份恢复测试。
- 修改功能：仅修改开发与测试配置；Site 本地 Cloudflare 绑定关闭远程资源，烟测数据采用 `TEST-` 标识并自动销毁；本地数据目录支持环境覆盖以隔离测试。
- Bug 修复：本地烟测备份不再写入正式数据目录；在线写入型烟测不能再直接指向任意远程 URL。
- 数据库变化：无 schema 或迁移变化；未创建云端 D1，未连接或修改生产 D1。
- API 变化：无业务 API 新增、删除或行为修改；备份/恢复只在一次性测试数据库验证。
- 文档变化：新增测试环境说明、安全隔离审计和设计规格；更新 README、MASTER、TASKS、PROJECT_CONTEXT、ARCHITECTURE、DECISIONS、STATUS。
- 验证：Site lint、build、Node 测试、一次性 D1 API 烟测、凭证扫描及本地 ERP 自测/烟测/上线检查/备份恢复均通过。

### PHASE0-TASK01-B - `fix: convert site gitlink to tracked source`

- Git Commit：本任务独立合并提交；第一父提交为任务开始时根仓库 `a1a8d6a`，第二父提交为 Site 开发基线 `9f2c2dc`；完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：移除无 `.gitmodules`、无可用远端的 Site gitlink；把原 Site tree 的 77 个文件按普通文件纳入根仓库，使新克隆可恢复完整源码。
- 数据库变化：无；未修改 schema、迁移或生产 D1。
- API 变化：无。
- 文档变化：更新根 README、项目总控、状态、任务、架构、上下文和决策记录；新增 `docs/audits/phase0-task01-source-management-report.md`。
- 版本关系：生产 Site `2b4f178`；纳管前开发 Site `9f2c2dc`；两者运行时代码一致，且 `2b4f178` 是 `9f2c2dc` 的祖先。

### PM-000 - `docs: establish project operating system`

- Git Commit：本任务独立提交，完成后以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：新增 `docs/project/` 项目管理体系；更新 `AGENTS.md` 的文档驱动开发流程；纳入现有技术审计和物料 V2 准备文档作为上下文基线。

### `bbefb2e` - `feat: add chenyida erp site project files`

- 新增功能：根仓库记录在线 Site 项目入口。
- 修改功能：无本次重新审计的业务行为变化。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：无。
- 已知问题：该入口为无 `.gitmodules` 的 gitlink，新克隆不可恢复完整 Site 源码。

### `3e45f05` - `Document online ERP architecture`

- 新增功能：无。
- 修改功能：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：记录在线 ERP 架构。

## 历史基线

下列提交已存在于根仓库历史。本次只建立索引，不重新解释未审计的每一行变化：

| Commit | 提交消息 | 主要类别 |
| --- | --- | --- |
| `7654d45` | `Add quotation workflow` | 功能 |
| `42bdd8c` | `Add customer and supplier master data` | 功能 |
| `1255f6f` | `Add inventory count adjustments` | 功能 |
| `a58c20d` | `Add finance settlement module` | 功能 |
| `07562bc` | `Add go-live operations package` | 功能/运维 |
| `8d0138b` | `Add ERP login and operations controls` | 功能/安全 |
| `7748ade` | `Merge remote-tracking branch 'origin/main'` | Git 历史 |
| `f189de9` | `Initial ChenYida ERP system` | 初始系统 |
| `a4b63b3` | `Initial commit` | 初始化 |

## 记录模板

```text
### TASK-ID - `type: commit message`
- Git Commit：提交后以 git log 为准
- 新增功能：
- 修改功能：
- Bug 修复：
- 数据库变化：
- API 变化：
- 文档变化：
```
