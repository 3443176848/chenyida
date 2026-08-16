# SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83 低资源服务器停止线只读归因

> 状态：`DONE / READ-ONLY RESOURCE ATTRIBUTION COMPLETE / EXTERNAL REMEDIATION REQUIRED / NO HOST MUTATION / PRODUCTION NO-GO`
> 日期：2026-08-16（Asia/Shanghai）
> 严格起点：`main@aa777324b08d06a27b1ade72a01d8d850b9a1688` / tree `a734aa13e4cb732ffc3726b56e9a62d82c34f3d0`
> 责任：Codex主智能体只读采样、归因、文档与独立提交；项目负责人保留Swap、systemd、服务、Docker daemon、网络、持久数据和重启专项授权

## 1. 背景与目标

TASK82收口时available约1.2GiB，但Swap为897MiB/1GiB并超过80%硬停止线，根盘可用约11GiB也接近10GiB下限。TASK70的隔离PostgreSQL/Compose动态验证、源码匹配候选构建和完整发布门均不得启动。本任务只读识别内存/Swap/OOM/磁盘压力来源、变化趋势和最小恢复入口，判断能否自然解除停止线，或形成一项精确的专项授权请求。

## 2. 验收标准

- [x] 记录任务前后`free -h`、`df -h /`、`uptime`、`docker stats --no-stream`、精确Compose状态、容器restart/OOM与内核`oom_kill`。
- [x] 在不读取进程argv、env、日志或业务正文的前提下，以PID、UID、`comm`和cgroup归因主要RSS/Swap持有者，并记录总量守恒与采样限制。
- [x] 完成两段各60秒只读稳定窗口，核对Swap增长、memory PSI、pgscan/pgsteal、major fault、OOM和服务身份变化；期间未启动重任务。
- [x] 只读核对Docker空间与仓库/运行目录容量，未执行prune、删除、压缩、备份、build或全盘高并发扫描。
- [x] 给出按风险排序的自然等待、Codex运行时释放、BuildKit-only清理、ERP/Docker重启和Swap维护选项；任何host或服务变化均未执行。
- [x] MASTER、TASKS、CHANGELOG、STATUS、PROJECT_CONTEXT、DECISIONS和当前任务文档同步更新；敏感信息、diff和临时资源检查完成并创建独立Git提交，只剩一项最小化外部恢复请求。

## 3. 禁止事项

- 不执行`swapoff`/`swapon`、修改Swap、内核、systemd、Docker daemon、网络或防火墙，不kill进程、不重启/停止/替换容器或宿主。
- 不读取`/proc/*/cmdline`、`environ`、应用日志、数据库、env文件、Volume、备份、凭据或业务数据正文。
- 不运行build、全量Node/PostgreSQL测试、Migration、backup/restore、Compose变更、镜像扫描、部署、真实UAT或业务写。
- 不执行Docker prune、删除镜像/卷/缓存、清理用户文件或扩大临时资源范围；四个受保护持久卷不得触碰。

## 4. 起点事实

- TASK82已形成source`c2f071c`→manifest-only`aa77732`的156文件canonical bundle，仓库handler和fake-root回归闭合，但catalog、host activation及TASK70动态验证仍失败关闭。
- 起点资源：available约1.2GiB、Swap897MiB/1GiB、根盘约11GiB、Load`0.24/0.22/0.18`，宿主`oom_kill=2`；四服务running、Web/PostgreSQL healthy、全部restart0/OOM false。
- 任何资源恢复动作都可能影响当前非生产UAT或宿主稳定性，超出本任务的只读授权。

## 5. 只读归因结果

### 5.1 内存与Swap持有者

起点`MemAvailable=1,232,648 KiB`、Swap使用`894,348/1,049,596 KiB`（约85.2%）。152个可读进程的`VmSwap`合计764,664 KiB、`VmRSS`合计2,138,252 KiB；与全机Swap相差约129,684 KiB，原因包括共享页/cgroup记账、内核页及采样瞬时差异，不能把逐进程和全机值强行视为完全相等。

| 归因对象 | 只读观察 | 结论 |
| --- | --- | --- |
| Codex长期会话 | PID 270288、UID 0、`comm=codex`，进程RSS约1.29GiB、VmSwap约324MiB；所在session cgroup memory约2.01GiB、Swap约317MiB，启动于2026-07-29 | 最大单一可释放来源；结束本次回复不会保证释放，安全方式是项目负责人从客户端重启Codex运行时，智能体不能自杀式重启 |
| Docker daemon | PID 1241、UID 0、`comm=dockerd`，VmSwap约97MiB；docker.service cgroup Swap约102MiB | 重启daemon会影响运行控制面且单独释放仍未必形成足够余量，本任务不执行 |
| PostgreSQL容器 | cgroup memory约58MiB、Swap约194MiB、cgroup OOM/kill为0；逐进程VmSwap约68MiB，差额主要是共享/cgroup页 | 重启会中断数据库并破坏restart0基线，不作为首选 |
| Web/Worker/Caddy | cgroup Swap约43/48/5MiB，cgroup OOM/kill均为0 | 当前稳定，不为释放历史页重启业务服务 |
| 其他长期系统服务 | 剩余Swap分散于安全代理、面板、旧Python服务及container runtime | 不属于ERP任务授权，且逐项重启会扩大影响面 |

### 5.2 两段稳定窗口

- 第一段60秒：Swap `894,280→894,260 KiB`，`pswpout`零增长、`pswpin +9`、`pgmajfault +15`，kswapd scan/steal零增长，memory PSI some/full始终0，`oom_kill=2`不变。
- 只读BuildKit容量枚举触发历史页读取，Swap净降至约846MiB但同时发生页换入/换出，available短暂降至979MiB；未出现PSI、OOM、容器重启或健康丢失。该命令因此不再重复运行。
- 第二段空闲60秒：Swap `868,120→868,164 KiB`（增长44KiB，远低于256MiB停止线），`pswpin +14`、`pswpout +21`，中途kswapd scan/steal约`+9,380/+5,830`页后稳定；PSI始终0，`oom_kill=2`不变。
- 最终空闲窗口仍约82.7% Swap，虽无持续高压，却违反不可放宽的“Swap使用率不超过80%”门；不能用“PSI为0”替代硬阈值，也不能启动TASK70或候选构建。

### 5.3 磁盘与Docker容量

- 根分区60GiB、已用50GiB、可用约11GiB/82%，inode仅5%；尚未越过10GiB硬线，但只约1GiB余量，不能安全承受隔离PG/构建临时空间。
- Docker为75镜像/28.07GB、192项Build Cache/10.79GB、277卷/733.3MB；BuildKit显示全部cache可回收，其中private约7.87GB，最后访问均至少41小时。13.81GB“reclaimable images”和380.1MB“reclaimable volumes”未做删除候选，因为可能包含历史回退/证据镜像或受保护数据边界。
- `/opt/erp`约1.00GiB（其中Site约899MiB、Git约61MiB），`/root/.codex`约5.17GiB、`/var/log`约868MiB、`/root/.cache`约127MiB。这里只读取大小；Codex状态、日志和缓存未清理。

## 6. 恢复选项与决策

1. **推荐、最低业务影响**：完成本任务提交后，由项目负责人从客户端重启长期Codex运行时，不重启ERP、Docker或宿主。按当前cgroup观察预计释放约317MiB Swap及约2GiB memory charge；重连后必须先核对本任务提交、受保护工作区和服务身份，再做60秒资源门。
2. **推荐、需专项删除授权**：Codex重启后仅运行`docker builder prune --force --filter until=24h`，目标是可重建且最后访问超过24小时的BuildKit cache；预计释放至少约7.87GB private cache。禁止`docker system prune`、image/volume prune及任何镜像、容器、Volume删除，执行前后均核对当前六个有引用镜像和四个受保护卷未变。
3. **不作为首选**：重启Worker、PostgreSQL、Docker daemon或其他systemd服务。它们会造成运行面中断、restart计数变化或非ERP影响，且无需在Codex与BuildKit路径尚未尝试时承担该风险。
4. **明确拒绝**：`swapoff/swapon`会把约848MiB换出页压回内存，使available可能跌破768MiB并触发OOM；增加Swap只会稀释百分比而掩盖压力。两者均需专项授权且当前不具备安全前提。

## 7. 完成结论

TASK83已证明停止线主要由长期驻留的Codex、Docker/容器历史换出页和磁盘BuildKit缓存共同造成，而非当前ERP服务持续失控；但硬阈值仍不满足，系统保持`PRODUCTION NO-GO`。下一入口`SELFHOST-OPS-RESOURCE-STOP-LINE-REMEDIATION-84`登记为`BLOCKED`，等待项目负责人完成Codex运行时重启并专项授权BuildKit-only清理。未创建临时文件/容器，未修改任何host、服务、Swap、Docker对象、数据库或Volume。
