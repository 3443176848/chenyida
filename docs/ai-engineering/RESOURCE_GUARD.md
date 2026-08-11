# Token 与服务器资源保护

## 1. 资源模型

当前服务器按固定2核、约4 GiB内存、1 GiB Swap处理。资源策略不因瞬时空闲上调。常驻控制面必须是单个轻量确定性进程，常驻LLM会话为0；模型会话按任务短时存在。

## 2. 并发上限

| 工作 | 最大并发 | 说明 |
| --- | --- | --- |
| 正式DOING任务 | 1 | 与现有TASKS唯一active slot一致 |
| 产品写者 | 1 | 单一worktree/路径租约 |
| 轻量只读Agent | 2 | 仅在上下文和内存门通过时；优先顺序执行 |
| Docker build、全量测试、Migration、备份恢复、Compose动作 | 全局1 | 必须获得heavy lease，绝不并行 |
| 临时容器 | 1 | 当前任务精确命名；结束清理 |
| 临时测试数据库 | 1 | 与任何其他重任务串行 |

`COMPOSE_PARALLEL_LIMIT=1`固定。Node重任务优先`NODE_OPTIONS=--max-old-space-size=1024`；容器内heap必须低于容器memory limit。不得后台遗留重任务后启动下一项。

## 3. 硬停止线

每个重任务前后采集`free -h`、`df -h /`、`uptime`、`docker stats --no-stream`、`docker compose ps`（缺配置时失败关闭）和容器restart/OOM。任一条件成立时不启动新重任务：

- available memory `< 768 MiB`；
- Swap在60秒增长`> 256 MiB`；
- Swap使用率`> 80%`；
- 根分区可用空间`< 10 GiB`；
- 1分钟Load持续3分钟`> 4`；
- 发生OOM、容器反复重启、SSH明显卡顿或数据库失去健康。

运行中触线时先停止当前任务明确创建的临时进程/容器并保存检查点；不得重启现有Compose来“恢复资源”，不得修改Swap、dockerd、内核、防火墙或systemd。

## 4. Token与上下文预算

Task Packet按风险分配可配置预算，预算不是质量豁免：

| 风险级别 | 典型任务 | 初始角色 | Context策略 |
| --- | --- | --- | --- |
| L 文档/机械 | 链接、状态、无业务语义文档 | Orchestrator + QA/领域适用性检查 | L0—L2 + 精确diff |
| M 单模块 | 局部Service/UI/测试 | 实施 + 领域 + 对抗 + QA；安全按触发 | 每角色独立L3切片 |
| H 跨域/权限/状态 | API、AuthZ、库存/生产/品质交接 | 必需六类角色 + 专家 | 分阶段刷新，不全仓注入 |
| C 关键数据/UAT/生产 | Migration、财务、真实环境、发布 | H + DB/恢复/Release + 人工 | 必须另立授权；MVP默认拒绝 |

控制器追踪每角色输入/输出额度、重复读取率、失败尝试和上下文占比。到60%触发摘要与刷新；到硬上限停止新推理、保存检查点并由Orchestrator缩小问题或使用剩余预算处理安全收口。不能靠删测试、降低断言或省略门禁节省Token。

## 5. Progress、Retry与Failure预算

- 每轮只能有一个可验证目标，如“生成候选diff”“运行一组测试”“处理一个veto”。
- 只有产生新Evidence、缩小失败范围、形成新candidate或解决一个阻塞才算progress。
- 同一失败分类默认最多2次修复重试；第三次前必须改变假设、请求专家或重新规划。Task Packet可按风险设更低上限。
- 总失败预算独立于单项retry；耗尽后只有满足真BLOCKED才向人升级，否则回到PLANNING缩小方案。
- 等待外部事件时进入PARKED，释放Agent、租约和重资源；使用事件唤醒，不按固定间隔烧Token。

## 6. Docker与临时资源

允许清理的只有当前Task Packet登记且已核对名称/路径的临时资源。四个受保护卷：

- `chenyida-erp-parallel_erp_postgres`
- `chenyida-erp-parallel_erp_uploads`
- `chenyida-erp-parallel_erp_attachments`
- `chenyida-erp-parallel_erp_backup_status`

永不作为测试或清理目标。禁止`docker system prune -a`和`docker volume prune`。任何Compose restart、build、Migration、备份恢复或部署仍需独立任务授权；Agent系统设计/运行本身不能借机执行。

## 7. 可观测性

每个任务收口记录起止available memory、Swap使用、根盘可用、Load、内核OOM、服务restart/OOM、创建/清理的临时容器/数据库/目录，以及未能执行的检查原因。资源数据只用于停止和审计，不自动触发破坏性清理或服务重启。
