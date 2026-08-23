# SELFHOST-SMALL-TEAM-UAT-ENVIRONMENT-READINESS-91 UAT环境只读就绪核对

> 状态：`TODO / TARGET ENVIRONMENT AND L1 AUTHORIZATION REQUIRED / PRODUCTION NO-GO`
> 日期：2026-08-24（Asia/Shanghai）
> 依赖：TASK90、D-170、D-171、低资源服务器保护规则
> 责任：项目负责人指定目标环境并授权只读核对；Codex形成最小升级、回退和写入授权包

## 1. 目标

在不写业务数据、不部署和不运行Migration的前提下，确认拟用于虚构样本员工UAT的目标环境、当前版本/数据库head、现有数据边界、恢复点能力和alpha.47/0046升级差异，形成下一步可逐项批准的最小执行方案。

## 2. 启动前必须确认

- 目标环境二选一：现有`chenyida-erp-parallel`非生产UAT，或新建独立UAT。
- L1只读授权范围：允许读取哪些版本、health、Migration清单、容器身份、非敏感数据库汇总和备份状态；禁止读取哪些业务正文。
- 是否允许在后续任务建立快照、构建候选、运行0041—0046、创建临时账号和写入虚构样本；这些均不是本任务默认授权。

## 3. 允许范围

- 只读核对Git候选、应用版本、Migration数量/head、容器health/restart/OOM、数据库非敏感汇总和恢复点存在性。
- 形成版本差异、资源上界、快照/恢复、部署、Migration、账号、测试数据清理和回退步骤清单。
- 文档、轻量静态验证和独立提交。

## 4. 禁止范围

- 不build、deploy、restart、Migration、创建账号或业务写。
- 不读取真实客户/供应商/联系人、订单正文、价格、银行信息、附件、凭据、备份正文或受保护Volume。
- 不把只读就绪核对解释为L2/L3执行授权，更不构成生产批准。

## 5. 当前停止线

项目负责人尚未指定目标环境或L1只读授权范围，因此保持`TODO`。
