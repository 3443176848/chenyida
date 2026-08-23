# SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 新隔离UAT前置边界

> 状态：`DOING / BUILDKIT CLEANUP COMPLETE / RESOURCE GATE PASS / HOST PATH REQUIRED / PRODUCTION NO-GO`
> 日期：2026-08-24（Asia/Shanghai）
> 依赖：TASK91、D-172、低资源服务器保护规则
> 责任：项目负责人选择独立主机或同机隔离路径并授权；Codex只执行所选路径的最小前置任务

## 1. 目标

只解除新隔离UAT在宿主边界、精确镜像和磁盘资源上的前置阻断，为后续L2a空环境构建/部署申请建立可执行输入。本任务不创建UAT、不运行Migration、不创建账号或写业务数据。

## 2. 启动前二选一

### 2.0 本轮授权记录

- 2026-08-24，项目负责人明确指令：`先清理磁盘`。
- 结合TASK91已给出的唯一清理入口，本轮只授权在当前主机清理未使用BuildKit cache；禁止`docker system prune`、镜像清理、容器/网络/Volume删除、服务重启、数据库连接、Migration、部署或业务写。
- 本授权不等于选择当前主机承载新UAT，也不授权同机隔离配置改造。宿主路径A/B在清理完成后仍由项目负责人决定。

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
- 当前Compose/secret/operator/release控制使用固定宿主路径；项目名只能隔离网络和命名Volume。
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

## 5. 当前停止线与完成标准

磁盘清理子步骤已经完成，但TASK92继续`DOING`，因为项目负责人尚未选择独立UAT主机或当前主机同机隔离。固定宿主控制root和精确镜像阻断仍在；不得因磁盘恢复自动build、创建Volume、启动第二套数据库或部署。

- 只完成负责人选定的一条路径，不同时建设两套方案。
- 目标环境边界、资源上界、精确源码/镜像输入、secret/角色、空库Migration和失败清理清单明确。
- 现有UAT身份、数据、四个受保护Volume和常驻服务不变。
- TASK92完成后只允许提交L2a授权申请，不自动build、deploy或Migration。
