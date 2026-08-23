# SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92 新隔离UAT前置边界

> 状态：`TODO / OWNER HOST PATH AND AUTHORIZATION REQUIRED / PRODUCTION NO-GO`
> 日期：2026-08-24（Asia/Shanghai）
> 依赖：TASK91、D-172、低资源服务器保护规则
> 责任：项目负责人选择独立主机或同机隔离路径并授权；Codex只执行所选路径的最小前置任务

## 1. 目标

只解除新隔离UAT在宿主边界、精确镜像和磁盘资源上的前置阻断，为后续L2a空环境构建/部署申请建立可执行输入。本任务不创建UAT、不运行Migration、不创建账号或写业务数据。

## 2. 启动前二选一

### A. 独立UAT主机（推荐）

- 项目负责人提供或指定目标主机，并授权L1只读metadata核对。
- 只核对2核/约4 GiB/1 GiB低资源边界、磁盘余量、Docker/Compose、端口、固定root和目标空状态。
- 不安装软件、不创建目录/secret/容器/网络/Volume，不build/deploy/Migration。

### B. 当前主机同机隔离

- 项目负责人明确接受同一故障域。
- 先授权仓库内独立host root/Compose override合同实现与静态测试；不得创建运行资源。
- BuildKit-only清理必须作为精确对象、命令和保护清单明确后单独授权；不得把配置授权解释为清理授权。

## 3. 已知阻断

- 当前HEAD没有匹配Web/Worker镜像；唯一alpha.47镜像绑定旧提交`78d96c6198ab4b7255572186ea580c463b5eeba3`。
- 当前Compose/secret/operator/release控制使用固定宿主路径；项目名只能隔离网络和命名Volume。
- 当前主机根盘仅高于10 GiB硬线约43.23 MiB，禁止启动build、新Volume或第二套数据库。
- L2a、账号、公开HTTPS、L3虚构业务写、真实样本与生产均未授权。

## 4. 完成标准

- 只完成负责人选定的一条路径，不同时建设两套方案。
- 目标环境边界、资源上界、精确源码/镜像输入、secret/角色、空库Migration和失败清理清单明确。
- 现有UAT身份、数据、四个受保护Volume和常驻服务不变。
- TASK92完成后只允许提交L2a授权申请，不自动build、deploy或Migration。
