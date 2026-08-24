# SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 新隔离UAT前置边界

> 状态：`DOING / SAME-HOST B SELECTED / ISOLATED COMPOSE CONSUMER CONTRACT PASS / PRODUCER-OPERATOR AND EXACT IMAGE REQUIRED / PRODUCTION NO-GO`
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
- release supervisor和PostgreSQL runtime privilege operator仍固定生产producer/state/secret/backup root；它们尚不能为同机UAT生成独立发布文件或角色凭据，且不得直接用于该UAT。
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

## 6. 当前停止线与完成标准

磁盘清理和Compose消费者隔离合同已经完成，但TASK92继续`DOING`。release producer/operator仍固定生产控制root，当前HEAD匹配Web/Worker镜像仍缺失；不得据此创建Secret/Volume、启动第二套数据库、build或部署。

- 只完成负责人选定的一条路径，不同时建设两套方案。
- 目标环境消费者边界和资源上界已明确；producer/operator适配、精确源码/镜像输入、Secret/角色、空库Migration执行包和失败清理清单仍待完成。
- 现有UAT身份、数据、四个受保护Volume和常驻服务不变。
- TASK92完成后只允许提交L2a授权申请，不自动build、deploy或Migration。
