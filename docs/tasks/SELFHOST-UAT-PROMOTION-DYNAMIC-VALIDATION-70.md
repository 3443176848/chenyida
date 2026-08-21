# SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 UAT晋升与回滚隔离动态验证

> 状态：`DOING / DYNAMIC EVIDENCE CONTRACT VERIFIED / DV70-PG-SWITCH-01 NEXT / ISOLATED SYNTHETIC ONLY / PRODUCTION NO-GO`
> 日期：2026-08-21（Asia/Shanghai）
> 责任：Codex主智能体串行调度；项目负责人保留任何UAT/生产、真实数据、host和凭据动作的专项授权

## 1. 目标

在TASK69—TASK82的晋升/回滚仓库执行器、适配器和固定handler完成后，以合成Compose、隔离PostgreSQL和可丢弃文件域验证逐检查点失败、崩溃恢复、Migration提交、部署、postdeploy、触发式快照回退及回退后全量核对。该任务只允许隔离合成数据，不授权访问或修改UAT/生产。

## 2. 当前准入事实

- TASK82及全部执行器依赖已经完成；仓库catalog仍须由本任务动态证据决定，不能因源码存在直接提升。
- TASK84已按D-158仅执行一次授权的24小时BuildKit cache清理，Docker对象保护和清理后60秒资源门通过；TASK70可从`TODO`正式转换为唯一`DOING`。
- 根盘最低可用约10.39GiB，只比10GiB硬线高约0.39GiB。首个切片必须先建立机器可审计的测试矩阵、资源上界和清理收据；任何无磁盘上界的镜像构建、拉取或并发容器均禁止。

## 3. 执行与验收边界

- 只使用新建可丢弃TEST目标、合成数据、独立网络和临时文件域；禁止连接UAT/生产数据库、读取受保护Volume/备份正文或使用真实凭据。
- Docker、PostgreSQL、Migration和测试严格串行，任一时刻至多一个任务临时容器；每个重任务前后执行完整资源门并记录对象/服务保护结果。
- 覆盖空库/已有数据升级、重复执行、逐崩溃点、失败回滚、unknown/partial恢复、快照内容核对、库存/金额守恒和最终零临时资源。
- 结果必须形成机器可审计的阶段/故障矩阵、逐项PASS/FAIL、持久回执、资源证据和精确清理收据；测试失败不得以降低断言或跳过替代。
- 通过不构成A6、A7或生产授权；真实UAT、host activation、员工签字、部署和切换仍需项目负责人专项明确批准。

## 4. 首个安全切片

先只读核对现有九阶段/十三检查runner与隔离PostgreSQL harness，补齐TASK70专用动态矩阵、资源/对象前置和清理合同；在确认单切片最坏磁盘占用不会跌破10GiB后，再串行运行最小隔离PostgreSQL事务/故障注入验证。不得以静态测试、旧TEST恢复回执、手工Compose或旧postdeploy证据冒充本任务动态结果。

## 5. 当前执行切片与验收

TASK70于2026-08-21正式启动为唯一`DOING`。首个提交先完成版本化动态证据合同、失败关闭verifier与机器审计状态拆分；必须把“仓库handler已实现但dormant”“隔离动态证明缺失”“host activation缺失”“真实UAT回退未执行”作为四个独立事实，任何隔离合成回执都不得关闭后三项。

首个动态case固定为`DV70-PG-SWITCH-01`，只证明当前executor生成的`PG_RB_ATOMIC_SWITCH_V1`在单一隔离PostgreSQL 17中的原子切换、事务失败和结果未知只读判定。该case通过后仍不证明dump/Migration/ACL、文件域、Compose、host activation、真实UAT或整体回退就绪，TASK70保持`DOING`并继续失败关闭。

## 6. 动态证据合同切片验收结果

2026-08-21首个仓库切片已通过，TASK70本身仍为`DOING`：

- 新增`uat-promotion-dynamic-validation-policy-v1.json`与失败关闭verifier，固定`ISOLATED_SYNTHETIC_ONLY`、`TEST`、`PARTIAL_ONLY`、唯一case、PG17镜像摘要、单容器限制、精确tmpfs、64MiB宿主磁盘增量上界、资源硬门、对象指纹、零残留和六项明确非声明。
- 证据读取使用`O_NOFOLLOW`、普通文件/单硬链接/大小/权限门和读取前后inode/mtime/ctime复核；版本号与Migration head绑定真实`package.json`及`0046_runtime_lock_privilege_boundary.sql`，资源字段类型、端点、计数和峰值必须交叉一致。
- 晋升审计已把`HANDLERS_IMPLEMENTED_DORMANT`、隔离动态证据、host activation、真实UAT回退及人工UAT分别表达；当前固定为4项阻断（P0=3、P1=1），`PARTIAL_ONLY`回执不能移除任何一项。
- 断网、只读rootfs、384MiB/1 CPU/128 PIDs的既有Node镜像容器中，两份生成器重放及17/17专项测试通过；动态artifact缺失和`assert-ready`分别稳定返回`TASK70_DYNAMIC_ARTIFACT_NOT_EXECUTED`与`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 运行前后全局容器、镜像、Volume与四服务集合摘要完全相同；无任务容器、网络、Volume、临时目录或进程残留。available约1.8GiB、Swap 48MiB/1GiB、根盘约10.74GiB、Load1 0.61，四服务稳定且无restart/OOM变化。

## 7. 下一切片验收标准

下一提交只实现并运行`DV70-PG-SWITCH-01`：

1. 仅使用本机已存在的固定摘要PostgreSQL 17镜像，不build、不pull、`network=none`、只读rootfs、全部数据/socket/temp位于有界tmpfs，不挂载任何Volume。
2. 原样执行现有executor生成的生产`PG_RB_ATOMIC_SWITCH_V1`成功SQL，并验证新库封存、数据库OID保持和重复执行失败关闭。
3. 覆盖前置漂移拒绝、首个rename后固定故障触发事务回滚、COMMIT响应丢失后的只读判定且绝不重放，以及任何时点都不存在持久混合布局。
4. 运行前后完成至少60秒Swap窗口、180秒Load停止线监控、OOM/restart、根盘64MiB上界及全局Docker/保护对象指纹；只按精确任务label/ID清理并生成机器收据。
5. 结果最多形成`VERIFIED_PARTIAL_ONLY`，不得声称九阶段/十三检查、host activation、真实UAT、人工UAT或生产就绪。
