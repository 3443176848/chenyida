# SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 UAT晋升与回滚隔离动态验证

> 状态：`TODO / RESOURCE AND EXECUTOR DEPENDENCIES CLEARED / ISOLATED SYNTHETIC ONLY / PRODUCTION NO-GO`
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
