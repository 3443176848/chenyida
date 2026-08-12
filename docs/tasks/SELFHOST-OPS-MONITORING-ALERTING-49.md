# SELFHOST-OPS-MONITORING-ALERTING-49 运行监控、告警与排障证据闭环

> 状态：`DONE / REPOSITORY MONITORING CONTRACT VERIFIED / HOST DELIVERY NOT CONFIGURED / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@d5df673c602fdc4e558c2799b31dbf1b208316e8` / tree `62c8feb425c7546db2afc7b2dc78f0050bf615e2`
> 责任：Codex 主智能体为唯一写者、重任务调度者、证据集成者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人负责未来 host 安装、真实告警渠道/凭据、值班责任人、UAT/生产与真实数据专项授权

## 1. 任务目标

在不安装宿主服务、不修改 UAT/生产、不读取凭据、日志、卷正文或业务数据的前提下，把现有零散的 health、Docker metadata、资源阈值、发布身份、Migration、备份与恢复证据整理为可重复测试、失败关闭、可交给运维执行的监控与告警合同。

本任务必须产出真实可运行的仓库工具和自动化测试，而不是只补一份监控清单。工具至少要能生成去敏、稳定、带版本的运行快照和告警事件；在没有真实通知渠道与值班责任人的情况下，必须明确记录“事件已生成但未外送”，不得声称已经建立生产告警。

## 2. 授权与保护边界

- 允许仓库内安全、可回滚的代码、测试和文档修改，以及合成输入或隔离环境中的验证。
- 允许只读检查宿主资源与现行 Compose 容器的名称、image、状态、health、restart 和 OOM metadata；不得读取容器日志、环境变量、网络/API、数据库或四个受保护 Volume 正文。
- 不安装 systemd/cron/宿主 supervisor，不修改 Docker daemon、网络、防火墙、Swap、内核、账号或权限，不创建外部监控账号，不发送真实通知。
- 不连接 UAT/生产数据库，不运行 Migration、备份、恢复、部署或业务写，不读取 `.env`、凭据文件、真实备份正文、客户/供应商资料或用户未跟踪的 `docs/ERP_CURRENT_STATUS_REPORT.md`。
- 不删除镜像、缓存、备份或 Volume；只精确清理本任务创建的临时文件、目录和容器。四个受保护 Volume 继续禁止删除。
- 外部告警渠道、root-only 凭据、值班责任人和宿主安装均作为后续专项授权项；缺少这些条件时交付状态只能是 `REPOSITORY MONITORING CONTRACT VERIFIED`。

## 3. 起点事实

- 源码为 alpha.46、45/head `0045_runtime_worker_readiness.sql`，0045 SHA-256 为 `cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`；本地精确候选为 `8952a815…11c4`，但无正式 supervisor gate、外部镜像锚点或部署。
- 受控非生产 UAT 仍为 Web alpha.42/source revision `569aa954…d33a24`、PostgreSQL 40/head `0040_warehouse_receipt_readiness.sql`。四服务 restart 0/OOM false，Web/PostgreSQL healthy，Worker/Caddy 无 Docker health；本任务不连接其 API、数据库、网络或卷正文。
- `/api/live`、失败关闭 `/api/health`、Worker 租约与双卷探针、备份/恢复回执合同和 release identity 原语已经存在，但没有统一的运行快照、阈值评估、告警生命周期、通知交付状态或可安装监控单元。
- 项目低资源停止线已经固定：available memory `<768 MiB`、Swap 使用率 `>80%`、60 秒 Swap 增长 `>256 MiB`、根盘可用 `<10 GiB`、1 分钟 Load 持续 3 分钟 `>4`，以及任何 OOM、反复重启、SSH 卡顿或数据库失去健康。
- 起点资源约 available 2.2 GiB、Swap 734 MiB/1 GiB（72%）、根盘 18 GiB、Load `0.31/0.32/0.37`、`oom_kill=0`；用户未跟踪状态报告保持不读、不改、不提交。

## 4. 验收标准

- [x] 定义版本化、严格字段、确定性排序的监控快照合同；未知字段、重复对象、非法数值、时间倒退、过期输入和不完整必需组件失败关闭。
- [x] 覆盖宿主内存/Swap/60 秒 Swap 增长/根盘/持续 Load/OOM，四个预期服务的存在、image、状态、health、restart/OOM，以及应用 live/readiness、release identity、Migration、备份与恢复证据的新鲜度和一致性。
- [x] 阈值与 AGENTS.md、运行手册和既有备份/发布合同只有一个权威定义；边界值、临界前后、持续窗口和缺失证据均有自动化测试。
- [x] 生成稳定 code、中文运维摘要、严重级别、首次/最后观测时间、去重键和处置手册引用；不得输出 SQL、堆栈、秘密、完整 URL、容器环境变量、卷路径正文或原始异常。
- [x] 告警状态机支持首次触发、持续去重、受控提醒、严重级别升级和恢复事件；状态写入必须原子、并发安全、权限收紧且不能把损坏/回退状态误判为健康。
- [x] 外部通知未配置时仍保留不可冒充的 pending/delivery 状态与非零退出语义；测试 webhook/邮件/聊天凭据不得写入仓库，未实际投递不得记录为 delivered。
- [x] 提供运维可执行的采集、检查、状态查看和故障处置说明；未来宿主安装、调度频率、保留期、真实渠道和值班人必须有明确输入、最小权限和回滚步骤。
- [x] 单元/合同测试覆盖正常、每类故障、组合故障、恶意/畸形输入、敏感信息去除、并发和恢复；适用 release、credentials、lint/typecheck 与 `git diff --check` 通过。
- [x] 重任务严格串行并记录前后资源、Swap、磁盘、Load、OOM/restart 和临时资源；不触发停止线，不修改现行四服务或受保护 Volume。
- [x] 更新 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`、运维/部署文档和必要 ADR，并形成独立聚焦 Git 提交。

## 5. 执行阶段

1. 三条智能体只读审计现有数据源、健康语义、备份/恢复证据、运行手册、威胁面和测试缺口；主智能体确认单一数据合同与范围。
2. 记录监控快照、阈值、告警状态、通知交付和去敏边界的架构决定。
3. 实现纯函数评估器、受控采集/CLI、原子状态存储和自动化测试；所有输入先用合成 fixture 验证。
4. 在不读取敏感正文的前提下对当前宿主 metadata 做一次只读诊断，证明输出不泄露秘密且不会修改服务。
5. 串行完成适用测试、资源/安全/差异检查，更新治理与运维文档并独立提交。

## 6. 当前结论

任务已完成授权范围内的仓库实现和隔离验证，结论为 `REPOSITORY MONITORING CONTRACT VERIFIED / HOST DELIVERY NOT CONFIGURED`。整体仍为 `PRODUCTION NO-GO`；本任务不替代 host 安装、真实通知渠道、值班机制、异机真实备份、UAT/生产部署或真实用户验收。

## 7. 实现与可追溯证据

- D-126 固定统一监控合同、单一资源策略、去敏边界和告警生命周期。`operations/monitoring-policy-v1.json`绑定既有发布资源策略摘要；`tools/ops-monitoring/`实现严格 observation、评估器、受控采集器、原子 hash-chain 状态存储和 CLI。
- 快照覆盖内存、Swap、60 秒 Swap 增量、根盘、180 秒持续 Load、内核 OOM、四服务存在/镜像/状态/health/restart/OOM，以及应用 live/readiness、release identity、Migration、备份和恢复证据。缺失、过期、回退、不一致或损坏证据均产生稳定中文告警并失败关闭。
- 状态机实际支持 `FIRING`、`REMINDER`、`ESCALATED`、`RECOVERED`；没有外部渠道时只生成不可冒充的 pending event 并非零退出。Dashboard 对 backup-status 的读取同时增加可信 root、marker、owner/mode、稳定 `O_NOFOLLOW` 读取和安全投影。
- 只读宿主 metadata 诊断如实得到 `CRITICAL`：现行 UAT 为旧 tag 镜像、Worker 无 health，且本任务没有读取应用、发布、Migration、备份正文来伪造证据，因此缺失证据被明确告警；Caddy 的 `running/none` 则按其无 healthcheck 合同接受。没有访问 API、数据库、日志、`.env`、四卷正文或用户未跟踪报告。
- 监控实现主提交为 `08f89c6174e887ef03eae2b98b66f0f3cac1c0f5`。最终内容寻址源码/测试提交为 `7debd4dbb0126be57796651921298846f7699027`、tree `315276e04ab4ab28db5a4f6a720b42430167429c`；manifest-only 子提交为 `56535a06600ce2fece2152d06d3597dfd0e470d9`，bundle SHA-256 为 `76b919cd412af0438f9fedd34cb0ba7e8a3ff244bb7d276e6af8867a2fca6a95`。
- TASK48 的零发现Web/Worker镜像严格绑定较早提交 `8952a815`；本任务包含Dashboard backup-status源码加固但未重建镜像，因此这些镜像只能保留为历史候选证据，不是当前 `7debd4d` 的可部署候选。

## 8. 验证、失败记录与资源

- 最终干净候选通过：监控专项 14/14；发布合同 6 文件/48 项及直接合同 45/45；supervisor Python 20/20；Node build + 113 文件/964 项；隔离 PostgreSQL 83 文件/396 项；typecheck 38/38；SPECIAL POSIX 4 文件/29 项；lint 0 error/11 个既有 warning；凭据扫描 1,582 个版本化文件；`git diff --check`通过。
- 完整验证先后诚实暴露三类陈旧测试夹具：AI 建议 Migration 测试仍把 0041 当当前 head；Normalization 夹具未模拟 parser 写入 batch counters；底层 queue 过期 lease 按合同返回 `false`，旧断言却要求直接抛错。均按实际运行契约最小修正并更新内容摘要，没有改写既有 Migration、降低断言、跳过测试或把失败记为环境问题；最终完整 Node/PostgreSQL 回归通过。
- 起点资源约 available 2.2 GiB、Swap 734 MiB/1 GiB、根盘 18 GiB、Load `0.31/0.32/0.37`；收口约 available 2.2 GiB、Swap 719 MiB/1 GiB、根盘 18 GiB、Load `0.64/1.16/1.35`。四个既有服务始终 restart 0、OOM false；Web/PostgreSQL healthy，旧 Worker/Caddy health 为 none。所有本任务临时容器和测试数据库已清理，没有创建或删除 Volume、镜像、备份或持久数据。
- 后续仍需项目负责人专项授权/外部输入：host 安装与调度、root-only 渠道凭据、真实接收端和值班升级人、真实告警演练、异机备份恢复、UAT/生产部署、真实迁移、员工试用和正式切换。
