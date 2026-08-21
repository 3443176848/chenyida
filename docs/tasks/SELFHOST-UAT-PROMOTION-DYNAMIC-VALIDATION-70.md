# SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 UAT晋升与回滚隔离动态验证

> 状态：`DOING / DV70-PG-SWITCH-01 VERIFIED PARTIAL / DV70-PG-RESTORE-02 NEXT / ISOLATED SYNTHETIC ONLY / PRODUCTION NO-GO`
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

- 新增`uat-promotion-dynamic-validation-policy-v2.json`与失败关闭verifier，固定`ISOLATED_SYNTHETIC_ONLY`、`TEST`、`PARTIAL_ONLY`、唯一case、PG17镜像摘要、单容器限制、精确tmpfs、64MiB宿主磁盘增量上界、资源硬门、对象指纹、零残留和六项明确非声明。
- 证据读取使用`O_NOFOLLOW`、普通文件/单硬链接/大小/权限门和读取前后inode/mtime/ctime复核；版本号与Migration head绑定真实`package.json`及`0046_runtime_lock_privilege_boundary.sql`，资源字段类型、端点、计数和峰值必须交叉一致。
- 晋升审计已把`HANDLERS_IMPLEMENTED_DORMANT`、隔离动态证据、host activation、真实UAT回退及人工UAT分别表达；当前固定为4项阻断（P0=3、P1=1），`PARTIAL_ONLY`回执不能移除任何一项。
- 断网、只读rootfs、受限Node镜像容器中，两份生成器重放、Python24/24、Node动态审计20/20、release29/29及inventory262/238/24通过；动态artifact缺失和`assert-ready`分别稳定返回`TASK70_DYNAMIC_ARTIFACT_NOT_EXECUTED`与`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 运行前后全局容器、镜像、Volume与四服务集合摘要完全相同；无任务容器、网络、Volume、临时目录或进程残留。available约1.8GiB、Swap 48MiB/1GiB、根盘约10.74GiB、Load1 0.61，四服务稳定且无restart/OOM变化。

## 7. `DV70-PG-SWITCH-01`验收结果

2026-08-21该case在最终source`c793cdd07d2d9b5fedd63055558aed3ac90723cf`、tree`c7453b28db2db46c4bc7483a4176354195131478`上通过，范围仍严格为隔离合成：

1. 最终运行`dv70-f2tu2jie`只使用本机已存在的固定摘要PostgreSQL 17.10镜像；`network=none`、只读rootfs、全部data/socket/tmp为有界tmpfs，无bind、Volume、build或pull。
2. 生产executor生成的`PG_RB_ATOMIC_SWITCH_V1`按原始SQL执行；`EXACT_SUCCESS`、`REPEAT_FAIL_CLOSED`、`PRECONDITION_DRIFT_REJECTED`、`FIRST_RENAME_FAULT_ROLLBACK`和`CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION_READ_ONLY_OBSERVATION`五个场景通过。九项断言覆盖生产SQL摘要、NEW_SEALED、OID保持、重复失败关闭、漂移拒绝、首rename故障事务回滚、调用方丢弃结果后的只读观察、无稳定混合布局及既有运行面/保护卷不变。
3. 最终artifact为`root:root 0400`、单硬链接、359,133 bytes；语义SHA-256`867f3a7c2ee0b1c3ff6dc70bd167d55e76aa55ccf5969a0b6ad2923420272f56`、raw SHA-256`8e7b9c6576fe369f9264445947ece3cc94ac79832871311fa2e59296c3260f91`，独立Node/Git复算PASS。audit SHA-256`a9d2e03132e387dd19cde9f312f9dc05c5202e231742183c5884fe2df75ddd1d`仍为4 blockers、`may_start=false`。
4. 资源证据含37样本/180秒及60秒前检：最低available 1,900,601,344 bytes、最大Swap 6.704%且rolling增长0、根盘最低11,386,380,288 bytes、峰值磁盘增量4,890,624/67,108,864 bytes、Load1最高0.23、restart/OOM增量0。cleanup receipt`68ee1d2002ed0b3c1514c7fb15cc44a38939739d51ffe5e9f428b6ad9350a700`，任务容器/网络/Volume/tmp根/进程均为0。
5. 首次真实运行按设计暴露psql advisory-lock在错误前输出精确`\n`，以`422a26f`修复并补测试；有效旧证据因当前状态断言需改为双状态而主动失效，以`2dcc011`修复。下一次运行又由独立Node门拦截Python `2.0`/Node `2`的顶层及resource双摘要分歧，以`c793cdd`加入递归数值规范化、safe integer拒绝和Python/Node共享golden vector。两份失效artifact均在精确核验身份/摘要后删除重跑，所有失败路径零残留。
6. 适用测试为Python24/24、Node20/20、release29/29、inventory262/238/24、官方凭据扫描1,785文件、生成物重放和diff门。该结果仅为`PASS_PARTIAL / VERIFIED_PARTIAL_ONLY`，明确不证明传输层COMMIT响应丢失、dump/Migration/ACL、文件域、Compose、host activation、真实UAT、人工UAT或生产就绪。
7. 证据提交`526fd4af306441a65090f33c66cfdefc7ecfcf74`在敏感信息检查后从private main `3e30dc36a63461ed7bebe39d0b46fd8742b5dd66`普通fast-forward送达`recovery-private/main`；本条治理提交按同一授权继续普通快进。未force、未推送公开origin，且未扩大任何运行或数据权限。

## 8. 下一切片验收标准

下一切片固定为`DV70-PG-RESTORE-02`，仍属于同一TASK70且只允许隔离合成：

1. 先只读映射现有PostgreSQL staging restore handler、46项Migration allowlist/ledger、目标角色/ACL/default privilege及失败保全路径，形成版本化case和独立失败关闭证据合同；不得把`DV70-PG-SWITCH-01`外推为完整数据库恢复。
2. 只使用本机固定摘要镜像、单一任务容器、断网/只读rootfs/有界tmpfs、无bind/Volume、无build/pull；先证明最坏磁盘和内存上界并通过新鲜60/180秒资源门。
3. 合成dump必须去敏且可丢弃，覆盖空目标/已有目标、Migration ledger 0001—0046、角色与schema/table/default privileges、失败回滚、重复执行和只读reconciliation；不得连接UAT/生产或读取真实备份正文。
4. 证据继续最多为`PARTIAL_ONLY`，必须保留host activation、真实UAT回退、人工UAT和生产阻断；任何source、镜像、Migration、资源或清理漂移均失败关闭。
