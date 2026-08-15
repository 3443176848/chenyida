# SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 UAT晋升与回滚隔离动态验证

> 状态：`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES / ISOLATED SYNTHETIC ONLY / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 责任：Codex主智能体串行调度；项目负责人保留任何UAT/生产、真实数据、host和凭据动作的专项授权

## 1. 目标

在全部晋升/回滚仓库执行器及适配器完成后，以合成Compose、隔离PostgreSQL和可丢弃文件域验证逐检查点失败、崩溃恢复、Migration提交、部署、postdeploy、触发式快照回退及回退后全量核对。该任务只允许隔离合成数据，不授权访问或修改UAT/生产。

## 2. 当前阻断

- Swap使用率超过80%，违反低资源服务器重任务启动线。
- TASK69及后续快照、writer quiesce、Migration、Compose、rollback适配器尚未完成；当前机器审计返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 解除前不得以静态测试、旧TEST恢复回执、手工Compose或旧postdeploy证据替代动态验证。

## 3. 解除与验收边界

- 资源连续满足AGENTS.md全部门禁，且所有前置执行器提交、bundle和release inventory已锁定。
- 只使用新建可丢弃TEST目标、合成数据、独立网络和临时文件域，重任务严格串行并清理本任务精确资源。
- 覆盖空库/已有数据升级、重复执行、每个崩溃点、失败回滚、unknown/partial恢复、快照内容核对、库存/金额守恒和最终零临时资源。
- 通过不构成A6、A7或生产授权；真实UAT仍需项目负责人专项明确批准。
