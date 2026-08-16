# SELFHOST-OPS-RESOURCE-STOP-LINE-REMEDIATION-84 受控资源停止线恢复

> 状态：`BLOCKED / OWNER-SIDE CODEX RUNTIME RESTART + BUILDKIT-ONLY CLEANUP AUTHORIZATION REQUIRED / PRODUCTION NO-GO`
> 日期：2026-08-16（Asia/Shanghai）
> 依赖：`SELFHOST-OPS-RESOURCE-STOP-LINE-ATTRIBUTION-83`
> 责任：项目负责人从客户端重启Codex运行时并授予精确BuildKit清理授权；Codex重连后执行门禁、受限清理、验证、文档和独立提交

## 1. 阻断事实

TASK83两段60秒窗口证明memory PSI、OOM和服务状态稳定，但Swap仍约82.7%，根盘仅约11GiB。长期Codex session cgroup约317MiB Swap/2.01GiB memory，BuildKit有至少约7.87GB private可回收缓存。智能体不能安全地自行终止并重启承载当前任务的Codex进程，也没有删除BuildKit cache的专项授权。

## 2. 解除条件

1. 项目负责人从Codex客户端结束并重新启动该运行时/任务连接；不得重启ERP、Docker daemon、PostgreSQL、Web、Worker或Caddy。
2. 项目负责人明确授权：仅删除最后访问超过24小时、标记为reclaimable的BuildKit cache，拟执行命令为`docker builder prune --force --filter until=24h`。
3. 明确不授权`docker system prune`、image prune、volume prune、镜像/容器/卷删除、Swap/内核/systemd/网络修改、宿主重启或任何UAT/生产/数据动作。

## 3. 获权后的串行步骤

- 重连后先完整读取AGENTS、MASTER、TASKS、PROJECT_CONTEXT和本任务，核对Git HEAD/工作区、四服务identity/health/restart/OOM、四个受保护卷集合及资源。
- 只有Codex重启后资源仍安全且授权文本精确匹配时，先记录`docker system df`摘要，再执行一次BuildKit-only prune；任何目标歧义立即停止。
- 记录删除结果和可恢复性（cache可重建，不删除镜像/容器/卷），复核Docker对象集合、根盘、OOM和服务状态。
- 完成新的60秒资源窗口。只有available≥768MiB、Swap≤80%、Swap增长≤256MiB、根盘>10GiB、Load/OOM/restart/health均通过，才允许TASK70从BLOCKED转DOING；否则停止并形成新的最小授权请求。

## 4. 禁止事项

- 不由当前Codex进程自行kill/restart；不猜测客户端守护会自动拉起。
- 不重启或替换ERP/Docker服务，不触碰数据库、业务数据、备份、日志正文、env、凭据或四个受保护Volume。
- 不清理镜像、容器、Volume、日志、`/root/.codex`、用户文件或任何未逐项授权对象。
- 不因PSI为0或Swap增长低而放宽Swap≤80%的硬门。
