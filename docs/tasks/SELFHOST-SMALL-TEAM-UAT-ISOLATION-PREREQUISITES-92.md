# SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 新隔离UAT前置边界

> 状态：`DOING / D-188 L2A BUILD PREPARATION COMPLETE / DEPLOYMENT PACKAGE INCOMPLETE / NEW UAT NOT CREATED / PRODUCTION NO-GO`
> 日期：2026-08-25（Asia/Shanghai）
> 依赖：TASK91、D-172、低资源服务器保护规则
> 责任：项目负责人已选择当前主机同机隔离并接受同一故障域，且已明确授权L2a构建准备；Codex已构建并冻结精确本机候选，但未获得部署、Migration、Secret、数据库或账号授权

## 1. 目标

只解除新隔离UAT在宿主边界、精确镜像和磁盘资源上的前置阻断，为后续L2a空环境构建/部署申请建立可执行输入。本任务不创建UAT、不运行Migration、不创建账号或写业务数据。

## 2. 启动前二选一

### 2.0 本轮授权记录

- 2026-08-24，项目负责人明确指令：`先清理磁盘`。
- 结合TASK91已给出的唯一清理入口，本轮只授权在当前主机清理未使用BuildKit cache；禁止`docker system prune`、镜像清理、容器/网络/Volume删除、服务重启、数据库连接、Migration、部署或业务写。
- 本授权不等于选择当前主机承载新UAT，也不授权同机隔离配置改造。宿主路径A/B在清理完成后仍由项目负责人决定。
- 2026-08-24，项目负责人随后明确选择`B`：当前主机同机隔离，并授权仓库内独立host-root/Compose override合同及静态测试。该授权不创建目录、Secret、容器、网络、Volume、数据库，不build、deploy、Migration、restart、创建账号或写业务数据。
- 同机选择明确接受与现有UAT处于同一宿主故障域；隔离目标是防止项目名、网络、Volume、端口、Secret和发布文件相互碰撞，不伪装成异机灾备。
- 2026-08-24，项目负责人继续要求“进行下一步”。本段仅把D-174请求编译为默认只读的确定性one-shot计划并建立执行拒绝门；不把该指令扩张为L2a，不实现或调用目录、Secret、Docker、数据库、Migration、发布或部署动作。
- 2026-08-24，项目负责人再次要求“下一步”。本段只把九步计划绑定到封闭handler/method/source/input/output目录并做静态顺序测试；仍不实现或调用宿主runtime adapter。
- 2026-08-24，项目负责人继续要求“下一步”。在实现adapter前先对D-176做只读可执行性审计；发现P0顺序冲突后，本段只保留历史v1、新增D-177/v2并做静态测试，不在错误合同上补executor，也不扩大为L2a运行授权。
- 2026-08-24，项目负责人继续要求“下一步”。本段只实现D-178三族纯意图、未来回执字段目录和注入式fake-port顺序测试；fixture固定为未执行/未发布/无运行证据，真实validator、publisher、host/Docker/PostgreSQL/HTTP backend仍不实现，不扩大为L2a。
- 2026-08-24，项目负责人再次要求“下一步”。本段只在仓库内把D-178字段目录收敛为D-179纯语义validator、前驱摘要链和binding v3；外部摘要根、publisher及host/Docker/PostgreSQL/HTTP backend保持未实现，未创建UAT或扩大为L2a。
- 2026-08-24，项目负责人继续要求“下一步”。本段只新增D-180外部锚点纯合同、binding/plan v4和静态负测；输入仍由调用方注入且未认证，publisher/backend继续固定拒绝。本指令不授权宿主observer、目录、Secret、Docker、数据库、Migration、build、部署或运行写入。
- 2026-08-25，项目负责人继续要求“下一步”。本段只新增D-181 owner完成日志纯合同、固定D-179/D-180重验和binding/plan v5；不实现publisher、runtime observer/backend，不创建或读取UAT目录、Secret、Docker、数据库或业务数据，也不把该指令扩张为L2a。
- 2026-08-25，项目负责人再次要求“下一步”。本段只新增D-182 Caddy Host/SNI纯intent、evidence intent v2及binding/plan v6，并关闭隔离Compose中production-mode HTTP Origin与默认`erp.invalid`的静态矛盾；不运行HTTP/TLS探针，不创建证书或UAT，不实现publisher/runtime observer/backend，也不扩大为L2a。
- 2026-08-25，项目负责人继续要求“下一步”。本段只新增D-183独立声明源码闭包policy/纯validator和静态负测，从冻结v6重建有界依赖图；不修改v1—v6、不新增v7，不读取运行文件、build镜像、实现publisher/runtime backend或扩大为L2a。
- 2026-08-25，项目负责人继续要求“下一步”。本段只新增D-184固定文件系统FD快照入口并从已验bytes重跑D-183；不执行one-shot、不实现publisher/runtime backend，也不扩大为L2a。
- 2026-08-25，项目负责人再次要求“下一步”。本段只把D-184已验证bytes交给固定只读`plan`编译器并增加未来外部宿主钉扎清单；`execute`不可用，不安装宿主锚、不创建UAT，不运行Docker、数据库、Migration、build、部署、HTTP/TLS或业务写。
- 2026-08-25，项目负责人在已明确“只安装并只读核对D-185宿主外部摘要钉扎，不创建UAT、不build/deploy、不运行Migration、不接触数据库或四个保护卷”的下一步后确认继续。本段只在固定同级路径`/etc/chenyida-erp-isolated-uat-pre-import-v1/manifest.sha256`以create-only方式安装manifest raw SHA并连续两次只读回读；不安装launcher、不运行`plan/execute`，不创建账号、Secret、Docker或UAT资源。
- 2026-08-25，项目负责人继续要求“下一步”，并已多次明确系统少于20名内部用户、应从第一性原理避免复杂化。本段只在仓库文档中接受“受信root管理员 + root-owned宿主OS/Python/Docker”为同机、空库、无真实数据UAT的运维信任边界，冻结D-174—D-186中以同机独立信任根为目标的高级attestation实现，不再把独立writer trust root、CPython/stdlib全量attestation、通用publisher/observer/backend作为L2a阻断；隔离root、技术角色/凭据映射、动作顺序、Migration后ACL、Host/SNI及部署后只读运行核对继续强制。历史文件、测试和宿主pin全部保留且不改；本指令不授权`plan`、build、Migration、deploy、创建UAT、账号或业务写。
- 2026-08-25，项目负责人明确指令：`确认授权L2a构建准备`。D-188授权边界只包括从新的root-owned干净detached worktree构建精确Web/Worker本机候选、回读manifest/config digest、冻结静态resolved Compose和无数据回退输入、运行无业务写测试及记录证据；构建器所需的任务专用临时registry/provenance容器属于本范围并须收口清零。不包括创建Secret、证书、PostgreSQL、UAT运行容器、项目网络、命名Volume、账号或业务数据，也不包括Migration、`docker compose up/down`、现有UAT备份读取、恢复、部署或生产动作。

### A. 独立UAT主机（推荐）

- 项目负责人提供或指定目标主机，并授权L1只读metadata核对。
- 只核对2核/约4 GiB/1 GiB低资源边界、磁盘余量、Docker/Compose、端口、固定root和目标空状态。
- 不安装软件、不创建目录/secret/容器/网络/Volume，不build/deploy/Migration。

### B. 当前主机同机隔离

- 项目负责人明确接受同一故障域。
- 先授权仓库内独立host root/Compose override合同实现与静态测试；不得创建运行资源。
- BuildKit-only清理必须作为精确对象、命令和保护清单明确后单独授权；不得把配置授权解释为清理授权。

执行前后必须核对容器、镜像、Volume、网络、四个受保护卷、常驻服务身份及资源门；任何对象异常立即停止。实际清理按最小影响逐步放宽：先删除24小时前普通缓存，再删除24小时前全部BuildKit内部缓存，最后仅在确认剩余缓存全部`RECLAIMABLE`且`ACTIVE=0`后清空未使用BuildKit cache。

## 3. 已知阻断

- D-188已从固定commit/tree构建匹配alpha.47的Web/Worker本机候选并回读manifest/config digest；旧`78d96c6198ab4b7255572186ea580c463b5eeba3`镜像仍不得复用。候选只存在于本机Docker Engine，临时loopback registry已移除，尚无外部镜像恢复锚点。
- `compose.uat-isolated.yml`已关闭容器消费者侧固定root：独立项目名、Secret、release candidate/identity、命名Volume、网络和loopback端口均有失败关闭静态合同。生产Compose未参数化、未改变。
- D-182已把`127.0.0.1`连接、`localhost` Host/SNI和HTTPS Public Origin收敛为纯合同；D-183—D-187历史/简化边界保持。D-188又冻结精确镜像、静态resolved Compose和第一阶段回退输入。当前新的P0是：Compose尚未挂载`/run/chenyida-erp-promotion/migration-execution-grant.json`或传入对应`ERP_UAT_PROMOTION_MIGRATION_*`，技术角色bootstrap与Migration后ACL reconcile也没有最小root运维执行接线；因此现有Compose不能直接执行空库L2a。另仍缺独立Secret实物、ELIGIBLE release manifest及动态数据库身份/grant、现有UAT异故障域备份与隔离恢复验证、新鲜资源门和新的明确部署授权。
- TASK92清理阶段曾把根盘恢复到约16.68 GiB；D-188构建后当前available为`14,907,346,944`B（约13.88GiB），仍高于10GiB停止线。Build Cache现为46项/2.431GB、active 0；不得自动再次清理，任何后续重任务仍须新鲜资源门并串行控制上界。
- L2a部署/Migration、账号、公开HTTPS、L3虚构业务写、真实样本与生产均未授权；D-188的构建准备完成不等于可以`up`或试运行。

## 4. BuildKit清理结果

| 检查 | 清理前 06:38 CST | 最终 06:45 CST |
| --- | --- | --- |
| MemAvailable | `2,547,175,424` bytes | `2,467,676,160` bytes |
| Swap used | `179,859,456` bytes | `179,859,456` bytes；最终60秒增长0 |
| 根盘available | `10,825,478,144` bytes | `17,909,628,928` bytes |
| Load | `0.04/0.13/0.25` | `0.24/0.28/0.26` |
| Memory PSI / kernel OOM | 全0 / 0 | 全0 / 0 |
| Docker对象 | 6容器/75镜像/277 Volume/174 Cache | 6/75/277/0；前三类集合摘要不变 |
| 常驻ERP | 四服务restart0/OOM false；Web/PostgreSQL healthy | ID与状态不变 |

- 清理前：Build Cache `174 / ACTIVE 0 / 10.31 GB`，`docker system df`显示5.674 GB可回收，根盘available为`10,825,478,144` bytes；第一遍后再由`docker builder du`确认剩余9.703 GB全部标记为可回收。
- 第一遍`docker builder prune --force --filter until=24h`退出0，报告回收607.3 MB，Cache降为164项。
- 第二遍`docker builder prune --all --force --filter until=24h`退出0，报告回收35.76 MB，Cache降为149项；剩余9.58 GB成为private/reclaimable且active仍为0。
- 最后一遍`docker builder prune --all --force`退出0，报告回收9.667 GB，Build Cache最终为`0 / 0 B`。
- 根盘最终available为`17,909,628,928` bytes，较起点实际增加`7,084,150,784` bytes（约6.60 GiB），比10 GiB硬线高`7,172,210,688` bytes（约6.68 GiB）。Docker报告值与文件系统实际增量因共享层计量口径不同，分别保留，不相互替代。
- 容器/镜像/Volume/网络集合SHA-256前后分别保持`850123d8…76c3`、`aab625ed…4c19`、`34f0df6a…a97`、`d2df52cd…d2ff`；数量保持6容器、75镜像、277 Volume，未删除任何运行镜像或数据卷。
- Web、PostgreSQL、Worker、Caddy精确ID不变，restart均为0、OOM false；Web/PostgreSQL保持healthy。四个受保护Volume存在且metadata不变，TASK92运行资源残留为0。
- 清理前60秒与最终60秒观察中Swap used均为`179,859,456` bytes、增长0；最终MemAvailable `2,467,676,160` bytes、Load`0.24/0.28/0.26`、Memory PSI和kernel OOM为0。
- 适用验证：`git diff --check`通过，变更范围仅为治理/准备包Markdown；宿主没有`npm`或`node`可执行文件，release inventory只读测试两种入口均以rc127在启动前失败，因此没有将其记录为PASS，也没有改用容器或重建缓存扩大授权。

## 5. 同机B路径静态合同结果

- 新增`chenyida_erp_site/compose.uat-isolated.yml`：通过Compose `!override`完整替换五个服务的宿主挂载和Web/Caddy端口；任何必要UAT变量缺失时在渲染阶段失败。Caddy profile改为显式`uat-edge`，三个入口均只监听`127.0.0.1`。
- 新增非Secret `.env.uat-isolated.example`。项目名、三个宿主root和三个端口均为部署输入；示例值不是人数、并发、容量或产品硬条件。
- 新增`isolated-uat-compose-policy.py`和静态runner。有效配置通过；缺少root、生产root、生产项目名、生产Web端口和遗漏UAT overlay五类负向输入均失败关闭。验证只调用`docker compose config`和Python解析，不访问Docker数据面。
- 解析结果固定为六服务、七个项目作用域命名Volume、两个项目作用域网络；Secret/release bind全部`read_only + create_host_path:false`，Web和可选Caddy无非loopback端口，release overlay后所有服务均使用digest镜像且无运行时build字段。
- 生产`compose.yml`、`compose.release.yml`、生产container runtime policy、runtime secret policy、operator和supervisor均未修改；现有运行对象和数据面未触碰。
- 静态门结果：`ISOLATED_UAT_COMPOSE_POLICY_PASS`、`ISOLATED_UAT_COMPOSE_CONFIG_TEST_PASS`。检查点约2.3GiB MemAvailable、171MiB Swap、根盘约17GiB available、Load`0.07/0.08/0.07`；四个常驻服务保持运行，Web/PostgreSQL healthy、restart0/OOM false。
- 生产Compose直接回归渲染成功，但既有`container-runtime-policy-v1.json`在本任务前的HEAD已经与`Dockerfile`/`compose.release.yml`摘要漂移：策略期望`6e3e6f…`/`1f9216…`，HEAD实际为`bb4aec…`/`ca8aef…`，因此验证器按设计返回`POLICY_SOURCE_DIGEST_MISMATCH`。本任务未修改这三个生产文件或降低断言，不把该项记录为PASS；生产发布门继续失败关闭并留待独立任务修复。
- 仓库要求的本地Python基线：`server.py --self-test`、venv内`smoke_test.py`、`go_live_check.py`分别输出`SELF_TEST_OK`、`SMOKE_TEST_OK`、`GO_LIVE_CHECK_OK`；系统Python首次smoke因缺`openpyxl`在导入阶段失败，改用仓库既有venv后通过。`go_live_check.py`按既有行为幂等初始化本地legacy SQLite并生成`erp-backup-20260824-084748.sqlite3`及一条活动记录；两项均以精确文件名/条件清理，删除记录前确认唯一1条、删除后为0。未连接自托管PostgreSQL、现有UAT或生产数据库。
- 静态子步骤起点08:39 CST约2.3GiB MemAvailable、171MiB Swap、17GiB根盘available、Load`0.07/0.08/0.07`；收口08:52 CST为`2,452,017,152`B available、`179,843,072`B Swap used、根盘`17,893,322,752`B available、Load`0.19/0.17/0.12`、kernel `oom_kill=0`。最终Docker为6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务精确ID保持、restart0/OOM false，Web/PostgreSQL healthy，四个受保护Volume metadata完整。UAT Compose测试临时目录、手工render JSON、本地测试backup和对应activity记录残留均为0。

## 6. 同机UAT控制请求合同结果

- 新增`operations/isolated-uat-control-plane-policy-v1.json`和严格Python验证器/runner；D-182在D-181 source之上绑定Host/SNI policy/module、Caddyfile、应用Origin配置及binding v6，当前Policy内部SHA-256为`b9fabb5ec573ae98eaec044470b6ca28f0647e49980d557fc0e055d5e8fade8e`。`deployment_authorized=false`且`runtime_actions_authorized=[]`保持不变。
- 七类root由同一个可配置项目名派生：runtime Secret、operator credential、release candidate、release identity、operator state、one-shot state和synthetic backup；必须彼此不重叠并避开三类生产受保护root。共享全局lock只允许串行协调，不承载任何环境数据。
- release producer和PostgreSQL operator的合同身份均为`DEDICATED_ISOLATED_UAT_ONE_SHOT`，未来只能由专用adapter实现。生产`release-supervisor-launcher.py`和`postgresql-runtime-privilege-runner.mjs`在该UAT请求中明确禁止；生产政策和默认行为未修改。
- 数据库服务角色固定为现有五个技术登录角色，六份runtime Secret加独立backup capture service提供凭据；这些是服务边界，不是员工席位。工程、计划、市场等暂按2人仅属于后续实名账号配置，任何`staff_count`类字段都被请求schema拒绝。
- 合同机械重算当前`0.1.0-alpha.47`、46项Migration、`EMPTY → 0046_runtime_lock_privilege_boundary.sql`及allowlist SHA-256 `8bb2b2d6…8eed`；L2a请求还必须提供精确Git commit/tree、Web/Worker registry/config digest和resolved Compose摘要，浮动tag失败关闭。
- 当前有效policy/request和5项Unit均通过：生产项目/root、旧Migration、浮动或全零Git/Compose/OCI摘要、任何运行动作、角色/source漂移、非字符串策略/source摘要、重复JSON key和人员数量基础设施字段均被拒绝。`.env.uat-isolated.example`同步增加operator credential/state和synthetic backup root，但仍不含Secret或授权值。
- 本段只有仓库静态文件。没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，没有build、deploy、Migration、restart、账号或业务写；现有UAT/生产数据面未访问。
- 09:26 CST起点约2.3GiB available memory、171MiB Swap、17GiB根盘available、Load`0.21/0.20/0.18`；09:34收口为`2,445,348,864`B available、`179,769,344`B Swap used、根盘`17,871,294,464`B available、Load`0.03/0.11/0.15`。Memory PSI和kernel `oom_kill`均为0，Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；现有四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四个受保护Volume存在。本段没有任务临时资源。

## 7. 默认禁用one-shot计划入口结果

> D-177已取代本节/D-175中的历史动作顺序；D-179加入内部回执链，D-180加入外部锚点，D-181加入owner完成接线，D-182再把当前入口升级为plan/binding v6；D-183不修改计划版本，只建立独立派生闭包。默认拒绝语义保持，物理顺序见第9节，内部链见第11节，外锚见第12节，owner接线见第13节，Host/SNI见第14节，声明source closure见第15节。

- 新增`isolated-uat-one-shot.py`。同一个已验证request会确定性输出规范JSON和`plan_sha256`；默认命令只有读取、校验和输出，不导入subprocess，不创建目录，不连接Docker或数据库。
- 九步只表达技术依赖：精确输入、私有root、独立凭据、PostgreSQL、五角色权限原语、`EMPTY → 0046`、release identity、Web/Worker和loopback就绪。项目名和root仍由request派生，未写死人员、席位、账号或并发数量。
- `execute`在当前`deployment_authorized=false / runtime_actions_authorized=[] / CONTRACT_ONLY_NOT_EXECUTABLE`下，在输出计划或调用任何执行器前固定返回`ISOLATED_UAT_ONE_SHOT_EXECUTION_NOT_AUTHORIZED`。
- 生产supervisor/runner只进入禁用清单，不成为任何步骤executor；生产策略、源码、路径和运行面未修改。
- 原控制请求4项Unit与新入口5项Unit全部通过；覆盖默认只读输出、确定性摘要、执行前拒绝、非法运行动作、计划篡改、生产入口隔离和无staff字段。Shell语法与`git diff --check`通过。
- 本段没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，没有build、deploy、Migration、restart、账号或业务写，也没有访问现有UAT/生产数据面。
- 10:02 CST起点MemAvailable `2,432,094,208`B、Swap used `179,748,864`B、根盘available `17,864,470,528`B、Load`0.07/0.21/0.20`；10:09收口分别为`2,449,072,128`B、`179,748,864`B、`17,874,239,488`B和`0.29/0.26/0.21`。Memory PSI和kernel `oom_kill=0`；Docker保持6容器/75镜像/277 Volume/0 Build Cache，四服务运行、restart0/OOM false且Web/PostgreSQL healthy，四个受保护Volume存在；Compose静态临时目录和任务`.pyc`残留均为0。

## 8. 固定动作绑定合同结果

> 本节记录D-176 v1历史证据。D-177确认其物理顺序不可执行，v1文件和摘要保留不改，但不再作为one-shot当前绑定。

- 新增`isolated-uat-one-shot-action-bindings-v1.json`，body SHA-256为`b5b3a7eb5a1a782290e2a37c5fed0ae8e09230696ae9da26d80398b0b2070276`；状态明确为`FIXED_BINDINGS_RUNTIME_ADAPTER_NOT_IMPLEMENTED`。
- 九步各有唯一`handler_id`和`adapter_method`，并声明受控sources、inputs和outputs。验证器机械检查先后依赖、输出不复用、source全部进入当前policy摘要且生产入口不在绑定中。
- Binding禁止shell和自由argv。Compose只绑定三份隔离渲染来源；PostgreSQL只复用policy/operator/reconciler/journal原语；Migration只绑定现有engine/authorization模块；release identity只绑定原子身份合同。
- Migration步骤显式同时产出release candidate和Migration执行回执，identity随后消费，Web/Worker再消费identity；不能跳过中间凭证或提前启动应用。
- one-shot计划输出新增binding ID/SHA/status以及每步固定handler/method。当前`execute`拒绝行为不变，binding静态PASS不构成runtime adapter。
- 控制请求4项Unit与one-shot 7项Unit全部通过；新增覆盖source全部受policy绑定、无shell/argv/人员字段、重算摘要后的tampered binding仍被拒绝。隔离Compose回归输出`ISOLATED_UAT_COMPOSE_POLICY_PASS`和`ISOLATED_UAT_COMPOSE_CONFIG_TEST_PASS`，两个runner的Shell语法及`git diff --check`通过。
- 本段仍没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，没有build、deploy、Migration、restart、账号或业务写，也没有访问现有UAT/生产数据面。
- 15:55→16:05 CST静态段MemAvailable `2,449,465,344 → 2,445,877,248`B，Swap used保持`179,671,040`B，根盘available `17,836,396,544 → 17,830,621,184`B，Load `0.00/0.08/0.13 → 0.85/0.50/0.26`，Memory PSI和kernel `oom_kill`为0。Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务restart0/OOM false，Web/PostgreSQL healthy，四个受保护Volume存在。测试临时目录为0、本段新增`.pyc`为0；历史`__pycache__`未修改或清理。

## 9. D-177 v2依赖顺序勘误结果

- 两项并行只读审计均确认不能直接实现D-176：完整runtime privilege reconcile依赖0046对象目录，必须在Migration后；生产v3 identity依赖Caddy/PostgreSQL/Web/Worker真实容器身份和postdeploy receipt，且绑定生产runtime policy/supervisor语义，不能用于无生产supervisor的隔离UAT。
- `isolated-uat-one-shot-action-bindings-v1.json`原文件和body SHA `b5b3a7eb…0276`保持不变，仅作历史；D-177新增v2，body SHA为`6f28881beb767f25e469b60f6ef9ae15e62d703659619ce3e7c8aa63e76d463a`，当时one-shot切换读取v2。D-179后v2转为历史，D-180后v3只作为内部receipt-chain基座，D-181后v4作为外锚基座；D-182后v5成为owner基座，当前入口读取v6。
- v2九步为：输入核对；七root准备；独立凭据；仅PostgreSQL；数据库marker/owner/Migration及技术登录角色初始化；`EMPTY → 0046`；最终权限收敛；启动Caddy/Web/Worker；loopback核验并发布隔离UAT专用证据。
- 第5步只建立Migration前最小身份/角色，第7步消费Migration执行回执后处理完整Schema ACL；第9步输出名不表示生产release identity已生成，其专用合同和publisher仍未实现。
- reader GID由policy固定为Web主GID`65532`，Compose source、非Secret示例和policy三者机械核对；这是容器技术身份，不是人员硬编码。package version/git进入服务启动输入，避免strict readiness静态通过、运行必失败。
- 当前只验证动作列出的直接source受摘要保护，传递依赖闭包仍是runtime path前置；v2已移除完整privilege原语对空库bootstrap、以及现有生产受控/临时TEST Migration入口的伪实现绑定，它们不能冒充专用database-bootstrap或UAT candidate/execution receipt。
- 静态结果为控制请求4/4、one-shot 9/9、隔离Compose policy/config双PASS；`execute`仍在任何副作用前拒绝。本段未创建或访问任何UAT/生产运行资源。
- 16:09→16:42资源核对：MemAvailable `2,395,615,232 → 2,395,176,960`B，Swap used `179,658,752 → 179,642,368`B，根盘available `17,809,903,616 → 17,764,696,064`B，Load `0.05/0.29/0.24 → 0.62/0.29/0.18`，Memory PSI/kernel OOM均0。Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务restart0/OOM false、Web/PostgreSQL healthy，四个保护卷存在。当前任务临时目录/pyc残留0；8月15—16日既有26个`/tmp/cyd-uat-promotion-*`及历史pycache不属本任务且未清理。

## 10. D-178纯意图与合成端口结果

- 新增`isolated-uat-runtime-contract-policy-v1.json`和单一`isolated-uat-runtime-contracts.py`。三族合同分别描述database-bootstrap、Migration/release candidate及isolated evidence意图；固定当前alpha.47、`EMPTY → 0046`/46项allowlist、标准UAT数据库marker、五角色独立凭据映射、loopback和GID`65532`。
- 意图状态固定为`STRUCTURE_VALID / NOT_EXECUTED / NOT_PUBLISHED / NOT_AVAILABLE / predecessor NOT_VALIDATED`。回执部分只提供`INCOMPLETE_DESCRIPTOR_ONLY`字段目录；真实receipt validator、publisher和runtime backend均为`NOT_IMPLEMENTED`，任何fixture都不能作为运行证据。
- Source closure只覆盖纯模块单文件：固定raw SHA、无仓库内传递import、固定标准库import allowlist；validation scope明确`NOT_A_SANDBOX`。v2文件字节不变，仍只声明`DIRECT_CONTRACT_REFERENCES_ONLY`，未冒充九步全动作闭包。
- typed fake ports按`DATABASE_BOOTSTRAP → MIGRATION → EVIDENCE`执行；覆盖逐步异常、重算摘要后的畸形字段目录、自洽重签intent、非法source/import扩张、输入别名和跨族source漂移。全部首错停止且不调用后续port，不产生真实回执或秘密。
- D-178当时因新增runtime policy/closure字段把one-shot升级为plan/v2；`execute`真实控制流只在授权门后到达唯一backend seam并精确拒绝，测试证明backend调用为0。Runtime policy SHA为`5f24335a…6586`，closure为`978741a0…c939`，当时control policy为`dd442418…6150`；binding v1/v2 raw SHA保持`3244d550…7b3a`/`9cc4e3c1…5232`。D-179的plan/binding v3见第11节，D-180 v4见第12节，D-181 v5见第13节，D-182当前v6见第14节。
- 静态结果为控制请求4/4、one-shot 10/10、新runtime contracts 7/7及隔离Compose policy/config双PASS；未创建或访问UAT/生产运行资源。
- 18:31→18:50 CST资源核对：available memory `2,399,928,320 → 2,383,667,200`B，Swap used `179,617,792 → 179,580,928`B，根盘available `17,775,542,272 → 17,746,591,744`B，Load `0.05/0.09/0.08 → 0.62/0.33/0.21`；Memory PSI和kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络，四服务restart0/OOM false且Web/PostgreSQL healthy。当前任务`.pyc`/临时资源0；既有26个8月15—16日UAT promotion临时目录和历史pycache不属本任务，未清理。

## 11. D-179纯回执语义与内部前驱链结果

- 新增`isolated-uat-runtime-receipt-policy-v1.json`和纯函数`isolated-uat-runtime-receipts.py`；模块只接收调用方注入的JSON/已绑定source bytes，不具备文件系统、Docker、数据库、网络、时钟、随机数、进程、Secret或publisher能力。深层恶意嵌套和畸形字段均转换为稳定合同错误。Receipt policy内部摘要为`58c34e46…9f6e`、raw SHA为`1eee47ed…7aac`，四成员source closure为`0a343c32…90d8`。
- 严格语义覆盖database target/bootstrap、release candidate、Migration execution、runtime privilege、readiness、isolated postdeploy与runtime identity八类回执，以及database bootstrap observation、Migration applied ledger/observation、runtime privilege observation、container identity set五类证据体。固定producer、project/request/operation、release/image、数据库身份、完整五角色属性、ACL、容器网络/health/loopback与前驱摘要必须连续；重算自摘要不能掩盖字段漂移。
- Migration必须精确匹配46项allowlist（`8bb2b2d6…8eed`）和按序applied ledger（`e4a7bc4b…6a34`）。PostgreSQL OID/system identifier范围、NFC/非法surrogate、非零Git/OCI/容器身份、四容器ID唯一、规范毫秒UTC、300秒未来偏差及从首个bootstrap observation起算的1小时最大链龄均失败关闭。新鲜度只相对调用方注入且未认证的verification time成立，不声称宿主可信时钟。
- 新增binding v3和18节点predecessor目录，body/raw SHA分别为`50ddd73f…74bd`/`da69ce3a…de5c4`；历史v1/v2 raw SHA继续保持`3244d550…7b3a`/`9cc4e3c1…5232`。Receipt policy同时钉住v3 body和raw SHA，拒绝由调用方自选一个重签binding；D-179时one-shot升级为plan/v3，D-180后v3原字节只作为内部链基座。
- Plan/v3只输出`runtime_receipt_validation_status=NOT_RUN_NO_RECEIPTS`及成功输出合同模板，不把尚未消费回执的模板写成验证结果；输出前会二次读取source state并与策略/请求包核对，发现规划期间HEAD、Migration目录或摘要漂移即失败关闭。
- 成功输出只能写作`VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS`，同时固定`external_anchor_validation_status=NOT_EVALUATED`、`control_plan_anchor_status=NOT_EVALUATED`、`runtime_evidence_status=NOT_ESTABLISHED_BY_PURE_VALIDATION`和`verification_time_source_status=CALLER_INJECTED_NOT_ATTESTED`。三个依赖policy raw SHA由执行validator常量锁定；receipt policy raw/internal SHA只匹配调用方给定expected roots，不把调用方本身描述为受信。四个业务external digest anchor和plan只验证格式/链内引用，未验证真实来源。
- D-180当时，Runtime privilege只是按既有policy形成的隔离UAT acceptance projection，owner侧完成日志validator尚无隔离operator profile；该owner缺口已由D-181闭合为纯合同。D-178 evidence intent v1仍未承载Caddy server name，故本段只核对loopback leaf observation，不声称Host/SNI信任绑定。
- `require_receipt_publisher()`固定失败关闭；one-shot在未来即使先获得执行授权，也会在旧runtime backend之前因publisher未实现而停止。全动作传递source closure、原子publisher、host/Docker/PostgreSQL/HTTP adapter和精确Web/Worker镜像仍缺失。
- 静态结果为控制请求5/5、runtime contracts 7/7、runtime receipts 16/16、one-shot 11/11，共39项Unit PASS；聚合runner输出`ISOLATED_UAT_ONE_SHOT_TEST_PASS`，隔离Compose policy/config双PASS。没有创建或访问UAT/生产运行资源，没有build、deploy、Migration、restart、账号或业务写。
- 19:09→20:05 CST资源核对：available memory `2,395,295,744 → 2,338,922,496`B，Swap used `179,580,928 → 179,576,832`B，根盘available `17,755,828,224 → 17,713,516,544`B，Load `0.01/0.04/0.09 → 0.58/0.39/0.32`；Memory PSI和kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络，四服务restart0/OOM false且Web/PostgreSQL healthy。精确删除本段生成的2个`.pyc`后，任务pyc及Compose测试临时目录残留0；历史及运行资源均未清理。

## 12. D-180外部摘要锚点纯合同结果

- 新增`isolated-uat-external-anchor-policy-v1.json`和纯函数`isolated-uat-external-anchor-contracts.py`。模块只消费调用方注入JSON/source bytes，无filesystem runtime observer、Docker、数据库、网络、时钟、随机、进程、shell或Secret能力；通过状态明确为`SOURCE_CALLER_INJECTED_NOT_ATTESTED`，不是宿主事实。
- Control plan必须精确为v4；执行模块常量锁定v4 binding body/status、runtime contract/receipt policy及其closure/capability、receipt成功模板和完整chain binding。自洽重签`publisher=IMPLEMENTED`、`runtime_evidence=ESTABLISHED`或任意v99 chain均返回稳定合同错误。
- Namespace receipt固定七个project派生root。每个root必须为directory、非symlink、权限匹配，并携带从`/`到parent的完整ancestor chain；每级必须root所有、不可被group/other写、为directory且非symlink。identity同时记录device/inode和mount ID/point/root/source；受保护mount root/source、双前导斜杠、`..`组件与按不同mount ID伪装的同一`device+inode`均失败关闭。重复路径identity必须一致，parent摘要精确绑定，七root彼此不重叠且避开生产受保护root。
- Credential receipt固定六份runtime Secret加独立backup service的七条metadata，严格核对consumer/root/filename/uid/gid/mode/nlink/size、`REGULAR_FILE`、非symlink、所属root mount描述和物理identity；凭据不得与root/ancestor或其他凭据物理别名，FIFO/directory均被拒绝。Schema拒绝Secret正文与内容摘要；各Secret值不同只保留为producer assertion，不在纯validator中暴露或重算Secret。
- PostgreSQL container identity固定Compose/project、非零容器ID、manifest/config digest、完整且唯一的内部backend network、对应network mode、`published_ports=[]`、两个项目Volume、只读bootstrap Secret bind、三项精确tmpfs、runtime secret root及running/healthy；额外生产网络、host network、宿主发布端口、额外bind、错误Secret source/target/read-only、生产Volume或镜像漂移均失败关闭。Cluster identity再绑定credential/container前驱、数据库名和合法system identifier投影。
- 四对象时间只验证规范UTC毫秒和单调顺序；没有可信时钟或新鲜度结论。输出固定为`PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID / AUTHORIZATION_NOT_ESTABLISHED / NOT_ESTABLISHED_BY_PURE_VALIDATION`。外锚结果尚未与D-179内部链运行时机械join，`require_external_anchor_publisher()`继续固定拒绝。
- 新增binding v4，body/raw SHA为`fb83e0f20823b632525823f3d6c012769501fff1aec9763abc64d8d10d2b050b`/`4858b8c14846a69ed969f5476828631362830675399e788f705c35e1cfe34262`。v4精确继承v3九动作和18节点，只增加external policy/validator source及五外层节点/四anchor映射；v1—v3 raw SHA保持不变。
- External policy内部/raw/source closure SHA为`66afa1ee…9a6b`/`92c59a9f…6ef3`/`4452221d…aff4`，纯模块raw SHA为`fc6e76d4…be61`，one-shot raw SHA为`8cd1a345…b7f7`，control policy内部/raw SHA为`9a09a3f1…d6c8`/`45bdf961…b83c`。摘要闭包为DAG且全部source hash匹配。
- 聚合runner最终为控制5/5、one-shot 12/12、runtime contracts 7/7、runtime receipts 16/16、external anchors 13/13，共53项Unit；隔离Compose policy/config双PASS。两路独立审计报告的plan重签、稳定错误、祖先/mount、路径规范化、容器完整网络/端口/mount问题均已修复并进入负测；稳定树最终复核均为P0=0/P1=0，其中一路1342个逐字段变体为0绕过/0异常泄漏。
- 本段没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，没有build、deploy、Migration、restart、账号或业务写；既有UAT/生产数据面未访问。21:42→22:52资源门：available memory `2,363,518,976 → 2,256,683,008`B，Swap used `179,556,352 → 179,613,696`B，根盘available `17,812,017,152 → 17,746,034,688`B，Load `0.03/0.35/0.25 → 0.23/0.20/0.22`，Memory PSI和kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务精确ID不变、restart0/OOM false，Web/PostgreSQL healthy，四个受保护Volume完整。精确删除本段5个`.pyc`后，任务pyc与Compose临时目录残留均为0。

## 13. D-181 owner完成日志与operator root纯合同结果

- 新增`isolated-uat-owner-completion-policy-v1.json`与纯函数`isolated-uat-owner-completion-contracts.py`。入口不再接收调用方可自签的D-179/D-180 validation envelope，而是接收原始外锚、四类intent、八类receipt、五类evidence及固定policy/source bytes，依次重跑D-180 plan/external validator和D-179 receipt-chain validator后再做owner join。
- External policy对象必须等于owner source closure中raw SHA固定的文件；D-179 binding、intent/receipt/privilege policy及源码继续由固定模块校验。Owner source closure对每个path的usage逐项固定，生产journal/operator/reconciler只允许`REFERENCE_PRIMITIVES_ONLY_NOT_EXECUTABLE`，不能重签成可执行上游validator。
- Owner日志固定同一operation/request/project、active v5控制摘要、base v4收据摘要、namespace/credential/container/cluster/database/Migration/runtime privilege摘要，以及`operator_state_root`固定路径和准备/完成身份相等。正常成功只接受六阶段`PREPARED → AUTHORIZATION_CONSUMED → TRANSACTION_DISPATCHED → POSTCOMMIT_CAPTURED → VERIFIED → COMMITTED`、空recovery authorization、`COMPLETED`归档和`VERIFIED`回执；`final_privilege_projection_sha256`只表示权限投影，不冒充生产structure report。
- 时间连续性固定为external cluster observation不晚于Migration observation/completion，不晚于owner intent；runtime observation必须落在transaction dispatched与postcommit capture之间，runtime receipt不晚于COMMITTED，owner receipt不晚于调用方verification time。倒序或未来拼接即失败关闭。
- Binding/plan v5 body/raw SHA为`349fb247d271d3c749129c151ebb0b3c7054b64f5ee0c5646ea9e1d238c49c3f`/`95bbf9a263818886072a29f486a53acb752687dcd4d5cd086283336dcbb77363`。v5只对冻结v4作additive extension，显式路由active v5摘要与v4 legacy receipt摘要，并列出action 7/9新增输入、三个runtime束组、完整validator参数映射和四步验证顺序；v1—v4 raw SHA保持`3244d550…7b3a`/`9cc4e3c1…5232`/`da69ce3a…de5c4`/`4858b8c1…34262`。
- Owner policy内部/raw/closure SHA为`47d70021…87d0`/`e86831d5…5cf5`/`4238653e…055b`，module/one-shot/control policy内部/raw分别为`1a6d2848…9c17`/`0ce8417f…d198`/`a62a9664…2681`/`013d50d6…549b`。成功输出仍固定`SOURCE_CALLER_INJECTED_NOT_ATTESTED / AUTHORIZATION_NOT_ESTABLISHED / NOT_PUBLISHED / NOT_ESTABLISHED_BY_PURE_VALIDATION`；publisher、runtime observer/backend门继续固定拒绝。
- 聚合runner为控制5/5、one-shot 13/13、runtime contracts 7/7、runtime receipts 16/16、external anchors 13/13、owner completion 15/15，共69项Unit；隔离Compose policy/config双PASS。两路最终独立只读复核均为P0=0/P1=0，先前发现的双plan摘要、action 9输入闭包、上游validation伪造、结构摘要误命名、跨链时间及source usage漂移均已修复并进入负测。
- 本段没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，没有build、deploy、Migration、restart、账号或业务写；既有UAT/生产数据面未访问。00:52→01:00收口静态门前后：available memory `2,262,908,928 → 2,247,430,144`B，Swap used保持`180,166,656`B且10秒采样`si/so=0/0`，根盘available `17,742,811,136 → 17,757,143,040`B，Load `0.14/0.20/0.20 → 0.53/0.38/0.27`，Memory PSI和kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整。Compose `ps`在未注入`ERP_DEPLOYMENT_CLASS`时严格拒绝插值，改用只读Docker metadata核对；隔离Compose临时目录和本段`.pyc`残留均0。

## 14. D-182 Caddy Host/SNI纯intent与三层计划摘要结果

- 第一性原理边界固定为单一同机UAT：TCP连接只到`127.0.0.1`，`ERP_DOMAIN`、HTTP authority host、Host header、TLS SNI和Public Origin host统一为`localhost`，Public Origin为`https://localhost:<隔离Caddy HTTPS发布端口>`。没有引入DNS、证书平台、探针服务、队列或人员基数配置。
- 修正隔离静态配置：Web不再在`ERP_ENV=production`下使用会被拒绝的HTTP直连Origin；Caddy不再继承`erp.invalid`默认值。Overlay固定`ERP_DOMAIN=localhost / ERP_HTTPS_PORT=443`并把Web Origin绑定到隔离Caddy HTTPS端口；Compose validator同时精确核对四个应用服务的HTTPS Origin及Caddy环境。HTTP Origin负例失败关闭。
- 新增`isolated-uat-caddy-host-sni-policy-v1.json`和纯模块。Expectation固定两个未来探针意图：HTTP与HTTPS都直接连接loopback并显式发送localhost authority，HTTPS额外固定SNI=`localhost`、要求受信链和精确DNS name、禁用`insecure_skip_verify`、runtime DNS、proxy环境和redirect following。模块没有HTTP、TLS、Docker、进程、时钟、Secret或publisher能力。
- Host/SNI source closure绑定env、两层Compose、Caddyfile、应用Origin配置、D-178/D-179 policy和执行模块；内部/raw/closure/module SHA分别为`dad404daf3d0d6348242184e9157fa8e80615a3b2b630f5c54708896fb753010`/`c3edf759d2b342f91931c4b529f993c89cae72656a4fa951b06b9be72c30f39a`/`cde30bd66d1973768ac0be29f41c1b077843ca69cef9496350ddd28ca250cedc`/`53283460f5c868efaed57bc977499dd69d88d43cacbd6e2e7e1178826db0a6ff`。所有公开builder/validator都重新校验policy及调用方注入source bytes，且D-178/D-179固定upstream raw锚点必须与closure成员及注入bytes三方一致；该结果仍不是宿主attestation。
- Evidence intent v2先完整重验D-178 evidence intent v1，再携带active v6、owner base v5与external/receipt base v4三个完整计划对象，核对固定角色/合同/摘要、v6→v5→v4确定性投影，以及request/project/ports/policy/source/Compose/Web与Worker镜像对基础证据的连续性；状态明确为`ROLE_IDENTITY_AND_DIGEST_PROJECTION_VALID_FULL_ACTIVE_PLAN_SEMANTICS_NOT_REVALIDATED`，不冒充全动作语义closure。Binding v6 body/raw为`f1a3fd38d0a49eea284caa704016d92de336e2eafb4d46a4fd23c59113266dc5`/`459bb65d42c71551797bf4cbf56a022700780caeb8a3d987b51bd96560d9f1f0`；v1—v5 raw SHA保持`3244d550…7b3a`/`9cc4e3c1…5232`/`da69ce3a…de5c4`/`4858b8c1…34262`/`95bbf9a2…7363`。
- v6只为action 8/9增加Host/SNI policy、expectation和intent v2接线。历史readiness v1、18个内部节点和5个外部节点原样继承，仍明确`NOT_VALIDATED_MISSING_BOUND_SERVER_NAME`；没有追加虚假的Host/SNI runtime receipt。
- 当前one-shot源码raw SHA为`5ec47d3c43668945c872e3d4f4a485499dc8730b4d6e7d1ac50692b663dea674`，control policy内部/raw SHA为`b9fabb5ec573ae98eaec044470b6ca28f0647e49980d557fc0e055d5e8fade8e`/`a4809ee36160804ee5a11a36f8432437aa4c2e516aeb68e261f2d962b0df67f0`。聚合runner为控制5/5、one-shot 13/13、runtime contracts 7/7、runtime receipts 16/16、external anchors 13/13、owner completion 15/15、Host/SNI 11/11，共80项Unit；隔离Compose policy/config连续两次双PASS。
- 纯合同仍不证明Caddy本地CA信任、证书SAN、错误Host/SNI拒绝、HTTPS反代或HTTP高端口重定向。容器内443到宿主高端口的Location转换未观察，因此redirect状态保持`NOT_ESTABLISHED_CONTAINER_HOST_PORT_TRANSLATION_UNOBSERVED`；publisher、observer和backend继续固定未实现。
- 本段没有创建或访问UAT目录、Secret、证书、容器、网络、Volume、数据库或业务数据，没有build、deploy、Migration、restart、账号、HTTP/TLS探针或回执发布。02:00→02:07最终门前后available memory `2,210,680,832 → 2,199,441,408`B，Swap `181,915,648 → 185,536,512`B（增长3,620,864B），根盘available `17,697,169,408 → 17,684,115,456`B，Load `1.16/0.79/0.46 → 0.44/0.57/0.48`，kernel `oom_kill=0`。Docker保持6容器/75镜像/277 Volume/6网络；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整。精确清理本任务3个`.pyc`后，任务pyc和Compose临时目录残留0。两路修复后独立只读复核均为P0=0/P1=0；其中先发现的upstream raw/closure自重签P1已修复并进入负测。

## 15. D-183 冻结v6声明源码传递闭包结果

- 第一性原理边界仍是单一小团队UAT：不新增通用依赖平台、daemon、队列、服务、v7计划或人员基数字段。独立`isolated-uat-action-source-closure-policy-v1.json`和纯validator只消费调用方注入的JSON/source bytes，不读仓库或运行文件，不导入被绑定模块，也不执行UAT动作。
- Validator从固定v3—v6 raw锚点重建冻结v6的九动作目录，得到54个action source引用和21个唯一直接root；历史v1—v6 raw SHA保持`3244d550…7b3a`/`9cc4e3c1…5232`/`da69ce3a…de5c4`/`4858b8c1…34262`/`95bbf9a2…7363`/`459bb65d…f1f0`，没有用v7制造循环绑定。
- 闭包固定为83成员：当前control的29项`SOURCE_PATHS`，再加`package.json`、Migration journal、46个SQL Migration、`runtime-secret.ts`和5个传递ESM模块。依赖模型精确核对8个Python模块及8条固定模块装载、3个TypeScript成员/2条本地import、8个ESM成员/23条本地import、Compose→Caddyfile资源边、46项journal顺序及全成员raw SHA；所有成员必须从21个root可达，代码import图必须无环。
- 失败关闭覆盖固定策略自摘要、闭包摘要、成员hash/usage/path、重复key、非法Unicode、非有限数/超大整数、bool冒充integer、动态JS import/require/re-export、Python间接导入、生产runner进入ESM图、Migration/journal/package和Compose资源漂移。固定`EXPECTED_POLICY_SHA256`使攻击者不能同时重签policy、member hash与未单独解析的source漂移。
- Policy内部/closure/raw SHA分别为`a85d6abbad072ce5981690f0e266b3b657beb3a707f7ca04db96d97d0bb52d11`/`19e518819ede89a2b5ad4925d0c71b27fa2b5bba41759ffb0e51e90bd7cc0fb3`/`7c2a22928c5c80dc21ee21fc8cc99693a480717b7a76f39c4f9b784663c680a8`；validator/test/聚合runner raw SHA为`f4705be0…81ad`/`5efbc604…ad8b`/`37e19d8c…ef6`。
- 诚实边界：成功值只为`FULL_DECLARED_NINE_ACTION_TRANSITIVE_SOURCE_CLOSURE_FOR_FROZEN_V6_VALID`和`SOURCE_BYTES_CALLER_INJECTED_HASH_MATCHED_NOT_ATTESTED`。它不证明filesystem attestation、Python/Node/Compose/Docker实现、OCI内容、运行时文件读取或PostgreSQL policy JSON来源；生产privilege ESM只作reference primitive。当前one-shot会在调用该派生证明前导入固定模块，因此trusted pre-import bootstrap明确为`NOT_IMPLEMENTED`，publisher、runtime backend和执行授权也继续固定拒绝。
- 测试/复核：D-183专项12/12，聚合控制5 + one-shot13 + runtime contracts7 + runtime receipts16 + external anchors13 + owner completion15 + Host/SNI11 + D-183 12，共92/92；隔离Compose policy/config本段连续两次双PASS。Shell语法、严格JSON、直接policy验证、冻结v1—v6摘要和`git diff --check`通过；两路最终只读复核均为P0=0/P1=0/P2=0。
- 资源/完整性：07:33→08:02 CST，available memory `2,209,591,296 → 2,185,998,336`B，Swap used `171,536,384 → 178,974,720`B（增长`7,438,336`B；10秒采样`si/so=0/0`），根盘available `17,541,615,616 → 17,579,905,024`B，Load `0.25/0.10/0.07 → 0.80/0.53/0.31`，Memory PSI和kernel `oom_kill`均0。本段未调用Docker变更；收口只读统计为6容器/75镜像/277 Volume/6网络，四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整。`docker compose ps`因未注入必填`ERP_RELEASE_EXPECTED_DEPLOYMENT_ID`而在解析期失败关闭，故服务核对使用只读Docker metadata；任务`.pyc`和`/tmp/isolated-uat-*`残留0。
- 本段没有产品业务代码、Schema、Migration、API、页面、依赖、员工角色或生产配置变化；没有创建或访问UAT目录、Secret、证书、容器、网络、Volume、数据库、备份或业务数据，没有build、deploy、Migration、restart、账号、HTTP/TLS探针或回执发布。

## 16. D-184 stage-1 pre-import文件系统快照结果

- 第一性原理边界保持最小：没有修改冻结binding v1—v6、D-183 policy/validator、one-shot或业务代码，也没有新增v7、daemon、队列、服务或通用供应链平台。D-184只新增一个固定policy、一个标准库-only stage-1 verifier和10项专项测试。
- 现有真实风险已机械确认：one-shot在`main()`前执行6个唯一仓库模块，owner又重复执行2次；因此不能把gate放进one-shot。D-184 CLI固定为绝对bootstrap路径、`/usr/bin/python3 -I -S -B`、optimization 0和由bootstrap父目录派生的唯一site root；没有`--site-root`或环境覆盖。Caller-root函数仅供临时fixture，结果固定`TEST_ONLY_CALLER_SUPPLIED_SOURCE_ROOT_AND_RUNTIME_NOT_ATTESTED`。
- 文件系统读取从`/`目录FD开始逐组件`openat`：目录使用`O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC`并要求root owner、不可group/other写、与filesystem root同device；文件使用`O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK`并要求regular、root owner、不可group/other写、`nlink=1`、与source root同device、有界。读取前后device/inode/mode/uid/gid/nlink/size/mtime/ctime必须相同；成功与异常路径均关闭全部FD。
- 固定单向锚为外部待绑定bootstrap → D-184 policy → D-183 policy/validator → 83成员：bootstrap raw为`ccb9365ca6ef61e983a4b4b4436231a69fe66fdb39b45f513e11bdbb8163a9c5`，D-184 policy内部/raw为`c5359216b393df265d707c764cee53b6430471e0ba16ca5252d98ee4fc232a45`/`708c96cc3ff5d9fdfff1dfbc752e24f62421ee8c556ff2ea72cba2a73bdbcf1a`；D-183 policy raw/internal/closure继续为`7c2a2292…0a8`/`a85d6abb…d11`/`19e51881…fb3`，validator raw继续`f4705be0…81ad`。全部83成员、合计`2,092,585` bytes先匹配member hash，之后才从已验validator bytes执行一次`compile/exec`并重跑D-183语义；没有caller source map。
- 负测覆盖错误Python flags/命令、双前导斜杠、bootstrap/D-183 policy或validator漂移、自重签policy+member、最后成员漂移时validator调用0、payload/validator顶层sentinel执行0、root/祖先/末级symlink、可写root/目录/文件、wrong owner、FIFO、hardlink、读中同inode变化、FD泄漏及handoff调用；AST固定标准库import、模块顶层调用和唯一`compile/exec`位置，防止未来在校验前加入shell/exec/eval旁路。
- 成功状态严格为`FILESYSTEM_FD_BYTES_HASH_MATCHED_BOOTSTRAP_NOT_EXTERNALLY_ATTESTED`。`payload_execution_status=NOT_EXECUTED_BY_THIS_BOOTSTRAP`、`prior_process_execution_status=NOT_ATTESTED`、`execution_handoff_status=NOT_IMPLEMENTED_FAIL_CLOSED`、`authorization=NOT_ESTABLISHED`、`publication=NOT_PUBLISHED`；bootstrap自身及CPython/stdlib仍需payload外部known-good锚。
- D-184专项10/10；更新聚合为控制5 + one-shot13 + runtime contracts7 + runtime receipts16 + external anchors13 + owner15 + Host/SNI11 + D-183 12 + D-184 10，共102/102；隔离Compose policy/config连续两次双PASS。最终三路只读复核确认当前stage-1范围P0=0/P1=0/P2=0。
- 08:24→08:46 CST资源/完整性：available memory `2,147,934,208 → 2,125,922,304`B，Swap used `180,957,184 → 182,300,672`B（增长`1,343,488`B），根盘available `17,484,529,664 → 17,505,542,144`B，Load `0.46/0.22/0.25 → 0.36/0.34/0.29`，Memory PSI及kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络；四服务ID与D-183后基线一致、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整。任务fixture、task pycache及精确`/tmp/d184-bootstrap-report.json`残留0。
- 本段没有创建或访问UAT目录、Secret、证书、容器、网络、Volume、数据库、备份或业务数据，没有build、deploy、Migration、restart、账号、HTTP/TLS探针或回执发布。测试仅在`/opt/erp`安全父目录串行创建并自动清理小型fixture；运行bootstrap本身为只读，未生成payload执行树。

## 17. D-185 已验证字节到只读计划的直接交接结果

- 第一性原理边界继续按少于20人的单一同机UAT收敛：只读计划需要的是“验证过的输入字节被同一次编译消费”，不需要把84个文件复制成私有树、启动子进程或建设通用publisher。冻结binding v1—v6、D-183、one-shot和产品业务代码均未修改。
- Bootstrap CLI现在只接受`verify`或`plan`，仍固定绝对入口、`/usr/bin/python3 -I -S -B`和bootstrap派生site root；请求仅从有界stdin读取，输入上限2 MiB、输出上限4 MiB。`execute`、额外参数、caller-selected root/policy均在捕获前失败关闭。
- `plan`先按D-184规则一次性FD捕获D-183的83成员，再捕获固定D-174 control policy，形成84成员、合计`2,100,283` bytes。路径集合SHA为`5cd4a2e2a6696a3c79e24d6893374d732fcba08dbe93ba1a328ca7ccb60203a0`，路径+内容映射SHA为`80fafed8f27377fac43b038327bfdc16984260bb4cd077bae04872c4fd088843`；D-174 raw/internal继续为`a4809ee3…67f0`/`b9fabb5e…ade8e`。
- 固定内存适配器只在“当前线程是唯一活动主线程”时临时接管精确的module/path读取，并在`finally`恢复全部全局适配器。它按固定顺序提供8条`(module_name, path)`装载边；计划编译器的仓库读取轨迹精确为258次/78个唯一路径，集合/顺序SHA为`0403a5e1…6969a`/`b6d158d6…025b01`，每次读取都命中已验证map。捕获后不重开原仓source/pyc，不创建文件系统publisher或子进程。
- 输出是只读薄封套：`VERIFIED_SOURCE_BYTES_DELIVERED_TO_FIXED_READ_ONLY_PLAN_COMPILER / ONE_SHOT_PLAN_GENERATED_NO_UAT_ACTION_EXECUTED`，内含原计划及按request内容计算的`plan_sha256`；固定专项测试request得到`04e12045…95ea`。授权、runtime evidence和UAT状态仍为`NOT_ESTABLISHED / NOT_CREATED`，runtime publisher/observer/backend仍未实现。
- 新增launch manifest只把bootstrap raw `bc33d4da…e028`与policy v2 raw/internal `809989aa…241d`/`4358ef2d…fe1`绑定；manifest raw/internal为`ba8e7337…a7e5`/`b71662a4…672a`。仓库副本明确不是payload外部信任根，未在宿主安装或钉扎；bootstrap、CPython/stdlib和direct one-shot入口仍未attest。
- D-185专项20/20；完整聚合为控制5 + one-shot13 + runtime contracts7 + runtime receipts16 + external anchors13 + owner15 + Host/SNI11 + D-183 12 + D-185 20，共112/112；隔离Compose policy/config连续两次双PASS。三路独立只读复核均为P0=0/P1=0/P2=0，覆盖捕获后原路径替换、未消费成员篡改、source set/value替换、错误请求恢复、后台线程、execute/额外参数及临时残留。
- 本切片起点→09:37 CST资源/完整性：available memory `2,130,964,480 → 2,127,458,304`B，Swap used `182,296,576 → 182,812,672`B（+`516,096`B），根盘available `17,551,732,736 → 17,520,386,048`B，Load `0.05/0.07/0.15 → 0.44/0.28/0.29`，Memory PSI和kernel `oom_kill`均0。Docker保持6容器/75镜像/277 Volume/6网络；四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四保护卷完整。`docker compose ps`因未注入必填`ERP_DEPLOYMENT_CLASS`在插值期失败关闭，故以只读Docker metadata核对；D184/D185 fixture、临时目录及本切片新增pyc残留0，既有历史pyc未清理。
- 本段没有创建或访问UAT目录、Secret、证书、容器、网络、Volume、数据库、备份或业务数据，没有build、deploy、Migration、restart、账号、HTTP/TLS探针或回执发布。人数不进入文件数、动作数、容量或验收合同。

## 18. D-186 仓库外manifest摘要钉扎与只读回读结果

- 第一性原理边界保持为一个65-byte固定事实，不建设通用安装平台：新增标准库-only create-only安装器及12项专项测试，唯一宿主目标为`/etc/chenyida-erp-isolated-uat-pre-import-v1/manifest.sha256`。该路径是受保护`/etc/chenyida-erp`的同级路径，不与`/etc/chenyida-erp`、`/var/lib/chenyida-erp`或`/var/backups/chenyida-erp-v2`重叠；调用方不能覆盖source root、target、摘要或命令。
- 安装前固定核对manifest/bootstrap/policy raw SHA `ba8e7337…a7e5`/`bc33d4da…e028`/`809989aa…241d`及manifest/policy内部SHA `b71662a4…672a`/`4358ef2d…fe1`。目录链逐组件dir-FD、`O_NOFOLLOW`、root:root、不可group/other写且同device；文件还必须regular、`nlink=1`、有界，FD读取前后和读后pathname→inode完整identity均一致。
- 发布只允许目录`root:root 0700`、文件`root:root 0400`。同目录随机prepared文件经`O_EXCL|O_NOFOLLOW`创建，完整写入后`fchown/fchmod/fsync`，再以`renameat2(RENAME_NOREPLACE)`发布并`fsync`目录；既有正确pin只读幂等，任何错误内容、type、mode、owner/group、hardlink、symlink、可写祖先或额外目录项均失败且不覆盖。
- 执行时installer/test raw SHA为`033772b17f0e0cba23a31f9d51cacd9431681f761e9796ab261511c4875e8733`/`43807f8301829413b1db24b6e010ee1c2663656a68e01ca365e762564ebe063c`。10:19 CST实际一次前台安装返回`CREATED_AND_VERIFIED`。最终pin保存manifest raw SHA加换行，文件raw SHA为`83bea3c086538c5eaea83446c5e54bbc5d8446ff69fcd0d1687baeab2bb56065`，size 65、device 64769、inode 101991324、uid/gid 0/0、mode 0400、nlink 1；目录仅含`manifest.sha256`。安装报告SHA为`ae0bbd55…fdcfa`，随后两次独立只读verify输出逐字一致、identity不变，verify报告SHA为`9dc339be…65c6`。
- 诚实边界固定为`EXTERNAL_MANIFEST_PIN_INSTALLED_AND_READ_BACK`，同时明确`OUTSIDE_REPOSITORY_WORKTREE_NOT_INDEPENDENT_WRITER_TRUST_ROOT / WORKTREE_CODE_NOT_EXTERNALLY_ATTESTED / WRITER_SEPARATION_NOT_ESTABLISHED / TRUSTED_PLAN_LAUNCH_NOT_ESTABLISHED / PYTHON_RUNTIME_NOT_ATTESTED / UAT_NOT_CREATED`。本切片没有执行bootstrap `plan`或任何payload；uid 0仍可改写anchor，不能据此称为受信启动链。
- Crash recovery/rollback不在本切片：若SIGKILL或断电留下精确`.manifest.sha256.prepared.*.tmp`，后续install/verify必须`DIRECTORY_NOT_EXACT`失败关闭，不得自动删除；任何精确清理或回滚都需另行授权。正常异常路径会只清理本次创建的精确temp，专项负测已固定该边界。
- D-186专项12/12；完整聚合为控制5 + one-shot13 + runtime contracts7 + runtime receipts16 + external anchors13 + owner15 + Host/SNI11 + D-183 12 + D-185 20 + D-186 12，共124/124；隔离Compose policy/config连续两次双PASS。三路只读复核均为P0=0/P1=0；唯一讨论项是上述已显式合同化的crash prepared residue边界，没有安装阻断。
- 10:00→10:21 CST资源/完整性：available memory `2,102,263,808 → 2,101,612,544`B，Swap used `182,804,480 → 184,582,144`B（+`1,777,664`B），根盘available `17,453,727,744 → 17,463,406,592`B，Load `0.21/0.12/0.13 → 0.25/0.28/0.27`，Memory PSI及kernel `oom_kill`均0。四常驻服务均running、restart0/OOM false，Web/PostgreSQL healthy；四保护卷存在且未读取正文。当前Compose `ps`先后因缺`ERP_DEPLOYMENT_CLASS`及运行env缺当前源码必填`ERP_RELEASE_EXPECTED_DEPLOYMENT_ID`失败关闭，故以Docker metadata核对；D186 fixture/pyc/prepared temp残留0，唯一新增宿主对象是预期pin目录和文件。
- 本段未连接数据库、未读取业务数据/备份/Volume正文，未创建UAT、Secret、证书、容器、网络、Volume或账号，未build、deploy、Migration、restart、HTTP/TLS探针或业务写。

## 19. D-187 同机非生产UAT信任边界简化结果

- 第一性原理结论：同一宿主上的uid 0可以同时修改kernel、Docker daemon、仓库、pin、launcher和Python；继续在该宿主内叠加独立writer trust root、CPython/stdlib全量attestation或通用publisher/observer/backend作为证明平台不会产生真正独立的信任域。对单一空库、无真实数据、loopback-only的非生产UAT，这些控制的成本高于实际风险降低；部署后对实际隔离、Migration、ACL和health的最小只读核对不在精简范围内。
- 接受的运维假设固定为`ROOT_ADMIN_TRUSTED_NONPRODUCTION_BOUNDARY`：root管理员及root-owned宿主OS/Python/Docker属于受信控制面，普通运行身份不得写构建快照、发布文件或宿主控制输入。该假设不是cryptographic attestation、异机信任根、生产供应链证明或灾备证明。
- 冻结的是D-174—D-186中以同机独立信任根为目标的高级证明实现：历史源码、测试、摘要、回读事实和`/etc/chenyida-erp-isolated-uat-pre-import-v1/manifest.sha256`原样保留，不删除、不放宽权限、不继续演进。D-174—D-183确定的隔离root、技术角色/凭据映射、动作依赖/顺序、Migration后ACL reconcile、localhost Host/SNI/Public Origin继续为L2a `MUST`。D-187未运行新的宿主/运行面plan；D-185历史只读plan事实保留，任何execute动作均未获权或产生副作用；历史one-shot证明链和通用publisher/observer/backend不成为L2a必经平台。
- L2a最小P0只保留会改变结果的安全门：从新的root-owned `0700`干净detached Git worktree固定commit/tree构建；Web/Worker绑定该提交的精确image/config digest并禁止浮动tag；独立项目名、host roots、网络、Volume、loopback端口和空PostgreSQL；Secret使用独立新值，宿主根目录`root:root 0700`，每个regular/`nlink=1`文件严格继承`operations/runtime-secret-file-policy-v1.json`的owner uid 0、固定consumer gid和`0440`，不入日志且容器只读挂载；严格`0001 → 0046` allowlist；部署后只读核对实际初始空库、Migration ledger、技术角色/owner/ACL、镜像/config、Secret/mount、network/Volume/loopback及health；无生产凭据、受保护Volume、Docker socket、host network或privileged容器；现有UAT数据库与文件域备份必须位于不同故障域、摘要/清单通过并完成隔离恢复验证，同机dump或快照不算灾备；新空UAT仍按`DISPOSABLE`由固定输入重建；另须精确回退命令、新鲜资源门及执行后四服务/四保护卷不变核对。
- 人员数量不进入路径、线程、容器、角色、容量或验收硬条件。工程、计划、市场等暂按两人只是后续账号规划输入；本阶段不创建账号。
- 分层边界保持：L2a只可在新的明确授权后串行build、空库Migration、部署和上述只读运行不变量核对；L3虚构样本写、L4真实样本/实名员工、公开访问和L5生产均需各自独立授权和更高恢复/访问控制门。
- 本切片只修改治理文档并运行无业务写的现有静态测试；没有修改产品代码、Schema、Migration、Compose或生产配置；D-187没有运行新的宿主/运行面plan，D-185历史只读plan事实保留且任何execute动作均未获权或产生副作用；没有运行build、deploy、Migration、数据库、HTTP/TLS、账号或业务写，新UAT仍未创建。
- 既有准备链聚合`124/124`通过，隔离Compose policy/config连续两次双PASS，`git diff --check`通过。多路独立只读评估促成冻结范围、恢复门和Secret模式收紧，最终两路均为P0/P1/P2=0；本段没有新增测试代码或降低既有断言。
- 10:54→11:07 CST资源/完整性：available memory `2,115,837,952 → 2,106,703,872`B，Swap used `185,061,376 → 186,945,536`B（+`1,884,160`B），根盘available `17,477,898,240 → 17,530,789,888`B，Load `0.31/0.17/0.16 → 0.69/0.42/0.31`；Memory PSI和kernel `oom_kill`均0。四服务restart0/OOM false，Web/PostgreSQL healthy，四保护卷存在；`/tmp/isolated-uat-*`和本段新增pyc残留0。

## 20. D-188 L2a构建准备结果

- 授权与边界：项目负责人明确授权`L2a构建准备`。本段执行了精确本机构建、摘要回读、静态Compose冻结和无业务写测试；构建器所需的任务专用临时registry/provenance容器已在收口清零。没有连接数据库、读取业务/备份/Volume正文，没有创建Secret、证书、UAT运行容器、项目网络、命名Volume或账号，没有运行Migration、`compose up/down`、HTTP/TLS探针、部署或生产动作。
- 固定源码：新建root-owned `0700` detached worktree，精确绑定commit `74fbeeebe95432e5f17e3313b1d14b273a91f7b9`、tree `db1edef51e21e69bd7571ef0f765e602c940fec9`、version `0.1.0-alpha.47`、46项Migration/head `0046_runtime_lock_privilege_boundary.sql`及allowlist `8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed`。Git archive为`73,031,680` bytes、SHA-256 `580627abeb381fe23c1a297f736e32f699d9356eba6db76c1c1f8d2e77fab095`；构建后worktree保持tracked/index/untracked全clean，并在收口时精确移除。
- 精确候选：Web manifest/config为`sha256:42b4154088b4cad04ee27cb7c30b30e4db89f60d4d6706e8cdb638e6dfe40ffd` / `sha256:d4da6cba1dc85fb1a1498db2e8c5209056ca4a57f53e6833864c1653ae2c8dd3`；Worker为`sha256:861d71ae3c69a5a0aa8f9afcde0a1b56d8b96ad7a962bb1bc10b7f5a9d974b9b` / `sha256:bd34dfd26e6d72e4ec5ba64233d6e04d0c6d8343d8f820dd80be5f3b4ec227c1`。两者均为`linux/amd64`、`65532:65532`，baked/OCI version和revision精确，Web/Worker CMD分别正确。root:root `0440`构建回执位于`/var/lib/chenyida-erp-uat-isolated/release-candidate/task92-d188-74fbeee.build-provenance.json`，SHA-256为`172cf8601bdf917653e6e353676fd03f81c8ef7264629748f2d3d1ba4df20f82`，状态为`LOCAL_LOOPBACK_DIGEST_VERIFIED`。
- 供应链边界：依赖阶段使用公共npm lockfile integrity和固定Wolfi APK包，应用build阶段断网；临时loopback registry、producer容器和`/tmp/chenyida-erp-release-candidate-build.*`均已清零。候选只有本机Engine身份，不是可异机恢复的registry锚点，也没有可复现构建attestation；部署前必须重新精确inspect并强制`--pull never`。
- 冻结Compose：root-only父链`/var/lib/chenyida-erp-uat-isolated/build-preparation/task92-d188-74fbeee`保存三份Compose、Caddyfile、Secret policy、静态validator、非Secret `render.env`、`active-services.txt`、规范化`resolved-compose.json`及摘要清单，文件均root:root `0440`（validator `0550`）。`render.env` SHA-256为`87cbe38868a0364db697e81afe76d4ce6a655e16ccf72280a84520a3d8873a62`，resolved Compose SHA-256为`f9ec23b4c8851c6cb27e6c3b276f230978fa496f1a6efb9e3047815db8568e99`，输入清单SHA-256为`42d0f896db90f135a40f309eecc7f205bd9e4d40fbf877915946a3e65e8f9ece`。两次clean-env规范化渲染逐字一致，冻结env-file复渲染也一致。
- 静态等值门：`ISOLATED_UAT_COMPOSE_POLICY_PASS`与`D188_RESOLVED_COMPOSE_EQUIVALENCE_PASS`通过。项目固定`chenyida-erp-uat-isolated`，端口`33001/33080/33443`当前无监听碰撞；Web精确使用Web候选，worker/migrate/admin精确使用Worker候选，runtime image/config环境值与回读值相等；PostgreSQL/Caddy也使用固定digest。所有服务无`build`、Docker socket、host network或privileged，应用UID非root，read-only/cap-drop/no-new-privileges保持。完整审计渲染包含六服务；未来运行profile只允许`uat-edge`，实际启用集合固定为`postgres/migrate/web/worker/caddy`，不得启用`tools/admin`。
- 明确未授权态：冻结配置将`EMPTY → 0046`及数据库marker写为预期值，但保留system identifier、database OID、release manifest SHA、Migration confirm及production migration开关为空，Web/Worker deployment operation/authorization标签固定`not-uat-promotion`。这使制品可审计但不可冒充deploy-ready。
- 精确第一阶段回退输入：新UAT无前代镜像，回退语义是“回到未运行状态”。只有另获回退授权后，才可使用同一冻结输入执行以下命令；命令刻意不带`--volumes`、`--rmi`或任何prune，以保留失败取证：

  ```sh
  env -i PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC \
    COMPOSE_PARALLEL_LIMIT=1 COMPOSE_DISABLE_ENV_FILE=1 \
    docker compose \
      --env-file /var/lib/chenyida-erp-uat-isolated/build-preparation/task92-d188-74fbeee/render.env \
      --project-name chenyida-erp-uat-isolated \
      --project-directory /var/lib/chenyida-erp-uat-isolated/build-preparation/task92-d188-74fbeee \
      --profile uat-edge \
      -f /var/lib/chenyida-erp-uat-isolated/build-preparation/task92-d188-74fbeee/compose.yml \
      -f /var/lib/chenyida-erp-uat-isolated/build-preparation/task92-d188-74fbeee/compose.release.yml \
      -f /var/lib/chenyida-erp-uat-isolated/build-preparation/task92-d188-74fbeee/compose.uat-isolated.yml \
      down --remove-orphans
  ```

  只有在按项目label复核精确7个新卷且再次取得删除授权后，才可另行恢复到“卷也不存在”；四个保护卷和现有项目永远不在该命令范围内。
- 发现的部署P0：当前`migrate`服务需要ELIGIBLE release manifest、动态PostgreSQL system identifier/OID/marker、受控Migration grant及授权摘要，但Compose没有挂载固定grant路径，也未传递相应UAT promotion Migration变量；技术登录角色初始化和Migration后ACL reconcile也没有最小root执行包。因此禁止直接`docker compose up`，也禁止切到test mode、复用生产runner或绕过守卫。下一独立切片应只实现并测试这份最小root运维接线；仍不部署。
- 测试：候选构建器完成Web→Worker串行build和loopback digest回读；隔离Compose policy/config runner通过；受控`/opt/erp`源码根上的准备链聚合`124/124`通过。首次从`/var/tmp` detached worktree运行时，前92项通过，pre-import的20项因共享可写`/var/tmp`祖先按设计出现8 failure/6 error并停止；未放宽断言，改从相同commit/tree的安全`/opt/erp`根重跑后全绿。
- 资源/完整性：11:56→12:12 CST，MemAvailable `2,163,392,512 → 2,112,208,896`B，Swap used `190,021,632 → 327,303,168`B（增加`137,281,536`B，低于256MiB停止线），根盘available `17,355,300,864 → 14,991,380,480`B，Load `0.38/0.40/0.33 → 0.44/0.57/0.56`，Memory PSI及kernel `oom_kill`均0。Docker为6容器、77镜像、277 Volume、6网络，正好新增2个候选镜像；Build Cache为46项/2.431GB、active 0。`docker compose ps`只读复核四服务running；四个常驻服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四个保护卷完整；构建专用临时registry/provenance容器、worktree、监听端口和临时目录残留0。
- 两路独立只读复核：构建回执/镜像复核P0=P1=P2=0；Compose复核确认静态冻结可闭合，但上述Migration/角色/ACL接线是部署前P0。新UAT仍未创建，现有alpha.42/0040 UAT及生产运行面未改变。

## 21. 当前停止线与完成标准

磁盘、Compose消费者隔离、D-174—D-186历史准备证据、D-187比例适当的信任边界及D-188精确本机候选/静态Compose/第一阶段回退输入已经明确；TASK92继续`DOING`。当前仍缺最小root运维执行包（PostgreSQL-only启动、技术角色bootstrap、ELIGIBLE manifest与Migration grant接线、`0001→0046`、Migration后ACL reconcile）、独立Secret实物门、动态数据库身份、现有UAT异故障域备份与隔离恢复验证、部署前新鲜资源门和新的明确部署授权。不得据此创建Secret/Volume、启动第二套数据库、运行Migration或部署。

- 只完成负责人选定的一条路径，不同时建设两套方案。
- 目标环境消费者边界、资源上界、Secret/角色映射、空库Migration范围、部署后只读运行核对、精确镜像和静态Compose/回退输入已明确。下一步是另行实现并测试最小root运维执行包；即使该包完成，也必须再取得部署授权并补齐Secret、异故障域恢复和动态数据库门，才可执行L2a。
- 现有UAT身份、数据、四个受保护Volume和常驻服务不变。
- TASK92完成前不自动deploy或Migration；D-188构建准备授权已消费完毕，不能复用为后续启动授权。
