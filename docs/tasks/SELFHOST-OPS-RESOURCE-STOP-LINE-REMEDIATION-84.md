# SELFHOST-OPS-RESOURCE-STOP-LINE-REMEDIATION-84 受控资源停止线恢复

> 状态：`BLOCKED / CODEX RESTART AND READ-ONLY RESOURCE GATE VERIFIED / BUILDKIT-ONLY CLEANUP AUTHORIZATION REQUIRED / PRODUCTION NO-GO`
> 日期：2026-08-20（Asia/Shanghai）
> 依赖：`SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83`
> 责任：项目负责人授予精确BuildKit清理授权；Codex获权后执行受限清理、清理后门禁、验证、文档和独立提交

## 1. 阻断事实

TASK83在2026-08-16的两段60秒窗口证明memory PSI、OOM和服务状态稳定，但Swap仍约82.7%，根盘仅约11GiB。长期Codex session cgroup约317MiB Swap/2.01GiB memory，BuildKit有至少约7.87GB private可回收缓存；当时既不能安全自行重启当前Codex进程，也没有删除BuildKit cache的专项授权。

2026-08-20只读复核证明宿主已在2026-08-18 20:11:57外部重启，当前Codex PID `2688`于20:12:25启动，已不是TASK83采样的旧进程；外部重启的原因和授权来源不可从现场事实推断，也不作追溯性授权。新的清理前60秒窗口数值门全部通过：MemAvailable最低`1,995,564 KiB`，Swap始终`10,204/1,049,596 KiB`且增长0，根盘最低`11,403,153,408 B`（约10.62GiB），Load1最高0.72，memory PSI与`oom_kill`增量均为0；四服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy running，四个受保护卷身份及挂载完整。

当前唯一立即解除条件仍是精确BuildKit-only删除授权及获权后的串行执行。Build Cache为192项/10.79GB，其中6.149GB reclaimable、active 0；根盘只比`>10 GiB`硬线多约0.62GiB。清理前数值自然恢复不能替代D-158要求的受控清理、对象复核和清理后新鲜60秒门，TASK70不得启动。

## 2. 解除条件

1. `已满足（只读事实）`：现场宿主和Codex均已在TASK83之后重新启动；本次只读复核未发起或授权该外部重启，也未主动重启ERP、Docker daemon、PostgreSQL、Web、Worker或Caddy。
2. 项目负责人明确授权：仅删除最后访问超过24小时、标记为reclaimable的BuildKit cache，拟执行命令为`docker builder prune --force --filter until=24h`。
3. 明确不授权`docker system prune`、image prune、volume prune、镜像/容器/卷删除、Swap/内核/systemd/网络修改、宿主重启或任何UAT/生产/数据动作。

## 3. 获权后的串行步骤

- 已完成重连后的强制文档读取和只读基线：根仓库`main`起点HEAD为`6c3055bdc4b7ee728fb26cfa8bbe05ba7d9f6f25`、tree为`29116f4bcf9e75e394ac7b1b3090ea8881155eca`；源码为alpha.47/0046，运行Web仍为alpha.42/source `569aa954…d33a24`，未访问运行数据库确认其Migration head。
- 只有Codex重启后资源仍安全且授权文本精确匹配时，先记录`docker system df`摘要，再执行一次BuildKit-only prune；任何目标歧义立即停止。
- 记录删除结果和可恢复性（cache可重建，不删除镜像/容器/卷），复核Docker对象集合、根盘、OOM和服务状态。
- 完成清理后的新鲜60秒资源窗口。只有available≥768MiB、Swap≤80%、Swap增长≤256MiB、根盘>10GiB、Load/OOM/restart/health均通过，才允许TASK70从BLOCKED转DOING；否则停止并形成新的最小授权请求。2026-08-20清理前窗口只证明当前可安全等待授权，不替代该步骤。

## 4. 验收标准与当前结果

| 验收项 | 当前结果 | 证据/剩余动作 |
| --- | --- | --- |
| Codex旧进程已释放 | PASS / EXTERNAL FACT | 宿主与Codex均在TASK83之后启动；原因和授权来源不推断 |
| 精确删除授权存在 | BLOCKED | 仍需项目负责人专项授权唯一命令；“继续”不扩大到删除授权 |
| BuildKit-only清理完成 | NOT RUN | 不得在授权前执行；镜像、容器和Volume始终排除 |
| Docker对象保护 | PASS / PRE-CLEANUP | 四服务身份/状态和四个受保护卷完整；清理后必须重新核对 |
| 60秒资源门 | PASS / PRE-CLEANUP ONLY | 当前数值门通过；清理后必须再完成一次新鲜窗口 |
| 治理与轻量验证 | PASS / CHECKPOINT | 177个本地链接、DOING=0、状态一致性、发布清单精确字节单元测试1/1、增量敏感信息及diff门通过 |
| TASK70可启动 | NO | 仅在本表所有清理与清理后证据通过、TASK84收口后转换状态 |
| 生产可用 | NO | 动态回退、host激活、真实异机恢复/迁移、人工UAT与正式切换仍缺证据 |

## 5. 禁止事项

- 不由当前Codex进程自行kill/restart；不猜测客户端守护会自动拉起。
- 不重启或替换ERP/Docker服务，不触碰数据库、业务数据、备份、日志正文、env、凭据或四个受保护Volume。
- 不清理镜像、容器、Volume、日志、`/root/.codex`、用户文件或任何未逐项授权对象。
- 不因PSI为0或Swap增长低而放宽Swap≤80%的硬门。
