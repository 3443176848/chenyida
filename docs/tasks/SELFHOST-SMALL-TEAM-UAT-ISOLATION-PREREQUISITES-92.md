# SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 新隔离UAT前置边界

> 状态：`DOING / V2 DEPENDENCY BINDINGS PASS / RUNTIME PATH + EXACT IMAGE REQUIRED / PRODUCTION NO-GO`
> 日期：2026-08-24（Asia/Shanghai）
> 依赖：TASK91、D-172、低资源服务器保护规则
> 责任：项目负责人已选择当前主机同机隔离并接受同一故障域；Codex只执行仓库内静态前置，运行资源仍逐层授权

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

- 当前HEAD没有匹配Web/Worker镜像；唯一alpha.47镜像绑定旧提交`78d96c6198ab4b7255572186ea580c463b5eeba3`。
- `compose.uat-isolated.yml`已关闭容器消费者侧固定root：独立项目名、Secret、release candidate/identity、命名Volume、网络和loopback端口均有失败关闭静态合同。生产Compose未参数化、未改变。
- D-176 v1虽冻结字段但物理顺序不可执行，D-177已用保留历史v1、新增v2的方式纠正。合同仍是`CONTRACT_ONLY_NOT_EXECUTABLE`；隔离UAT专用database-bootstrap/Migration/evidence回执、传递source闭包和宿主runtime path尚未实现，不能生成目录、发布文件、角色或凭据。
- TASK92已把根盘可用恢复到约16.68 GiB、比10 GiB硬线高约6.68 GiB；磁盘停止线阻断已解除，但任何后续build仍须重新执行新鲜资源门并串行控制上界。
- L2a、账号、公开HTTPS、L3虚构业务写、真实样本与生产均未授权。

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

- 新增`operations/isolated-uat-control-plane-policy-v1.json`和严格Python验证器/runner；D-177切换binding v2并补运行输入后，Policy SHA-256更新为`2197a633db282423f40ba0ac22e94dc27206bca6ed20f8eb332165811eac6271`。`deployment_authorized=false`且`runtime_actions_authorized=[]`保持不变。
- 七类root由同一个可配置项目名派生：runtime Secret、operator credential、release candidate、release identity、operator state、one-shot state和synthetic backup；必须彼此不重叠并避开三类生产受保护root。共享全局lock只允许串行协调，不承载任何环境数据。
- release producer和PostgreSQL operator均只允许后续专用`DEDICATED_ISOLATED_UAT_ONE_SHOT_ADAPTER`入口。生产`release-supervisor-launcher.py`和`postgresql-runtime-privilege-runner.mjs`在该UAT请求中明确禁止；生产政策和默认行为未修改。
- 数据库服务角色固定为现有五个技术登录角色，六份runtime Secret加独立backup capture service提供凭据；这些是服务边界，不是员工席位。工程、计划、市场等暂按2人仅属于后续实名账号配置，任何`staff_count`类字段都被请求schema拒绝。
- 合同机械重算当前`0.1.0-alpha.47`、46项Migration、`EMPTY → 0046_runtime_lock_privilege_boundary.sql`及allowlist SHA-256 `8bb2b2d6…8eed`；L2a请求还必须提供精确Git commit/tree、Web/Worker registry/config digest和resolved Compose摘要，浮动tag失败关闭。
- 有效policy/request和4项Unit均通过，覆盖9类失败关闭case：生产项目/root、旧Migration、浮动镜像、任何运行动作、角色/source漂移、重复JSON key和人员数量基础设施字段均被拒绝。`.env.uat-isolated.example`同步增加operator credential/state和synthetic backup root，但仍不含Secret或授权值。
- 本段只有仓库静态文件。没有创建目录、Secret、发布文件、容器、网络、Volume、数据库或备份，没有build、deploy、Migration、restart、账号或业务写；现有UAT/生产数据面未访问。
- 09:26 CST起点约2.3GiB available memory、171MiB Swap、17GiB根盘available、Load`0.21/0.20/0.18`；09:34收口为`2,445,348,864`B available、`179,769,344`B Swap used、根盘`17,871,294,464`B available、Load`0.03/0.11/0.15`。Memory PSI和kernel `oom_kill`均为0，Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；现有四服务ID不变、restart0/OOM false，Web/PostgreSQL healthy，四个受保护Volume存在。本段没有任务临时资源。

## 7. 默认禁用one-shot计划入口结果

> D-177已取代本节/D-175中“权限→Migration→生产identity→Web/Worker”的历史动作顺序；默认拒绝语义保持，当前有效顺序见第9节。

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
- `isolated-uat-one-shot-action-bindings-v1.json`原文件和body SHA `b5b3a7eb…0276`保持不变，仅作历史；新增v2，body SHA为`6f28881beb767f25e469b60f6ef9ae15e62d703659619ce3e7c8aa63e76d463a`，one-shot入口只读取v2。
- v2九步为：输入核对；七root准备；独立凭据；仅PostgreSQL；数据库marker/owner/Migration及技术登录角色初始化；`EMPTY → 0046`；最终权限收敛；启动Caddy/Web/Worker；loopback核验并发布隔离UAT专用证据。
- 第5步只建立Migration前最小身份/角色，第7步消费Migration执行回执后处理完整Schema ACL；第9步输出名不表示生产release identity已生成，其专用合同和publisher仍未实现。
- reader GID由policy固定为Web主GID`65532`，Compose source、非Secret示例和policy三者机械核对；这是容器技术身份，不是人员硬编码。package version/git进入服务启动输入，避免strict readiness静态通过、运行必失败。
- 当前只验证动作列出的直接source受摘要保护，传递依赖闭包仍是runtime path前置；v2已移除完整privilege原语对空库bootstrap、以及现有生产受控/临时TEST Migration入口的伪实现绑定，它们不能冒充专用database-bootstrap或UAT candidate/execution receipt。
- 静态结果为控制请求4/4、one-shot 9/9、隔离Compose policy/config双PASS；`execute`仍在任何副作用前拒绝。本段未创建或访问任何UAT/生产运行资源。
- 16:09→16:42资源核对：MemAvailable `2,395,615,232 → 2,395,176,960`B，Swap used `179,658,752 → 179,642,368`B，根盘available `17,809,903,616 → 17,764,696,064`B，Load `0.05/0.29/0.24 → 0.62/0.29/0.18`，Memory PSI/kernel OOM均0。Docker保持6容器/75镜像/277 Volume/6网络/0 Build Cache；四服务restart0/OOM false、Web/PostgreSQL healthy，四个保护卷存在。当前任务临时目录/pyc残留0；8月15—16日既有26个`/tmp/cyd-uat-promotion-*`及历史pycache不属本任务且未清理。

## 10. 当前停止线与完成标准

磁盘、Compose消费者隔离、producer/operator请求和默认只读计划已经完成；D-177/v2只关闭已知依赖顺序错误，TASK92继续`DOING`。专用database-bootstrap/Migration/evidence合同、传递source闭包、宿主runtime path和当前HEAD匹配Web/Worker镜像仍缺失；不得据此创建Secret/Volume、启动第二套数据库、build或部署。

- 只完成负责人选定的一条路径，不同时建设两套方案。
- 目标环境消费者和控制请求边界、资源上界、Secret/角色映射及v2九步依赖已明确；专用回执合同、source闭包、runtime adapter、精确源码/镜像输入和空库Migration执行包仍待完成。
- 现有UAT身份、数据、四个受保护Volume和常驻服务不变。
- TASK92完成后只允许提交L2a授权申请，不自动build、deploy或Migration。
