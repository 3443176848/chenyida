# SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83 低资源服务器停止线只读归因

> 状态：`DOING / READ-ONLY RESOURCE ATTRIBUTION / NO HOST MUTATION / PRODUCTION NO-GO`
> 日期：2026-08-16（Asia/Shanghai）
> 严格起点：`main@aa777324b08d06a27b1ade72a01d8d850b9a1688` / tree `a734aa13e4cb732ffc3726b56e9a62d82c34f3d0`
> 责任：Codex主智能体只读采样、归因、文档与独立提交；项目负责人保留Swap、systemd、服务、Docker daemon、网络、持久数据和重启专项授权

## 1. 背景与目标

TASK82收口时available约1.2GiB，但Swap为897MiB/1GiB并超过80%硬停止线，根盘可用约11GiB也接近10GiB下限。TASK70的隔离PostgreSQL/Compose动态验证、源码匹配候选构建和完整发布门均不得启动。本任务只读识别内存/Swap/OOM/磁盘压力来源、变化趋势和最小恢复入口，判断能否自然解除停止线，或形成一项精确的专项授权请求。

## 2. 验收标准

- [ ] 记录任务前后`free -h`、`df -h /`、`uptime`、`docker stats --no-stream`、精确Compose状态、容器restart/OOM与内核`oom_kill`。
- [ ] 在不读取进程argv、env、日志或业务正文的前提下，以PID、UID、`comm`和cgroup归因主要RSS/Swap持有者，并记录总量守恒与采样限制。
- [ ] 完成至少60秒只读稳定窗口，核对Swap增长、memory PSI、pgscan/pgsteal、major fault、OOM和服务身份变化；期间不启动重任务。
- [ ] 只读核对Docker空间与仓库/运行目录容量，不执行prune、删除、压缩、备份、build或全盘高并发扫描。
- [ ] 给出按风险排序的自然等待、应用级释放、受控服务重启、Swap/宿主维护等选项；任何会修改host或服务的方案只形成影响/停止/验证/回滚说明，不执行。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS和当前任务文档，完成敏感信息、diff和临时资源检查并创建独立Git提交；若只剩专项授权或外部资源，提出一个最小化问题。

## 3. 禁止事项

- 不执行`swapoff`/`swapon`、修改Swap、内核、systemd、Docker daemon、网络或防火墙，不kill进程、不重启/停止/替换容器或宿主。
- 不读取`/proc/*/cmdline`、`environ`、应用日志、数据库、env文件、Volume、备份、凭据或业务数据正文。
- 不运行build、全量Node/PostgreSQL测试、Migration、backup/restore、Compose变更、镜像扫描、部署、真实UAT或业务写。
- 不执行Docker prune、删除镜像/卷/缓存、清理用户文件或扩大临时资源范围；四个受保护持久卷不得触碰。

## 4. 起点事实

- TASK82已形成source`c2f071c`→manifest-only`aa77732`的156文件canonical bundle，仓库handler和fake-root回归闭合，但catalog、host activation及TASK70动态验证仍失败关闭。
- 起点资源：available约1.2GiB、Swap897MiB/1GiB、根盘约11GiB、Load`0.24/0.22/0.18`，宿主`oom_kill=2`；四服务running、Web/PostgreSQL healthy、全部restart0/OOM false。
- 任何资源恢复动作都可能影响当前非生产UAT或宿主稳定性，超出本任务的只读授权。
