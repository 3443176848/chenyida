# SELFHOST-SMALL-TEAM-UAT-ENVIRONMENT-READINESS-91 UAT环境只读就绪核对

> 状态：`DONE / L1 READ-ONLY COMPLETE / SAME-HOST L2 NO-GO / NEW UAT NOT CREATED / PRODUCTION NO-GO`
> 日期：2026-08-24（Asia/Shanghai）
> 依赖：TASK90、D-170、D-171、低资源服务器保护规则
> 责任：项目负责人指定目标环境并授权只读核对；Codex形成最小升级、回退和写入授权包

## 1. 目标

在不写业务数据、不部署和不运行Migration的前提下，确认拟用于虚构样本员工UAT的目标环境、当前版本/数据库head、现有数据边界、恢复点能力和alpha.47/0046升级差异，形成下一步可逐项批准的最小执行方案。

## 2. 启动前必须确认

- 已确认目标环境：新建独立UAT；不得复用或升级现有`chenyida-erp-parallel`非生产UAT。
- 已授权L1只读范围：源码/版本、Migration清单、Compose与安全模板、主机资源、Docker容器/镜像/网络/Volume名称级metadata和恢复能力配置；不得读取现有UAT或生产业务正文、凭据、环境变量值、备份正文或受保护Volume内容。
- 是否允许在后续任务建立快照、构建候选、运行0041—0046、创建临时账号和写入虚构样本；这些均不是本任务默认授权。

## 2.1 授权记录

- 2026-08-24 01:47 CST，项目负责人明确指令：`使用新建隔离UAT，授权L1只读核对`。
- 本授权只启动TASK91的只读就绪核对，不授权创建容器、网络、Volume、数据库或账号，不授权build、deploy、restart、Migration、备份、恢复或任何业务写。

## 3. 允许范围

- 只读核对Git候选、应用版本、Migration数量/head、容器health/restart/OOM、数据库非敏感汇总和恢复点存在性。
- 形成版本差异、资源上界、快照/恢复、部署、Migration、账号、测试数据清理和回退步骤清单。
- 文档、轻量静态验证和独立提交。

## 4. 禁止范围

- 不build、deploy、restart、Migration、创建账号或业务写。
- 不读取真实客户/供应商/联系人、订单正文、价格、银行信息、附件、凭据、备份正文或受保护Volume。
- 不把只读就绪核对解释为L2/L3执行授权，更不构成生产批准。

## 5. 当前停止线

L1已经完成，L2及更高动作继续失败关闭。当前主机根盘仅高于10 GiB硬线约43.23 MiB，且同机项目名不能隔离固定secret/release/operator宿主root；不得在本机启动build、新Volume、第二套PostgreSQL或UAT写操作。

## 6. 核对结果

- 当前源码为alpha.47、46/head `0046_runtime_lock_privilege_boundary.sql`，0046 snapshot为233张public表，journal顺序与46项Migration一致。
- 新UAT采用空库`EMPTY → 0046`，不升级、复制或读取现有alpha.42/0040 UAT数据库；0041—0046对空库没有既有业务数据回填冲突。
- Compose以独立项目名渲染通过，基础服务、两个网络和五个基础Volume可以获得独立前缀；Web端口也可以单独绑定loopback。
- Compose和权限控制仍引用固定`/etc/chenyida-erp`、`/var/lib/chenyida-erp`、全局lock与backup root；仓库没有独立UAT override。同机只换项目名不构成完整隔离。
- 本机唯一alpha.47 Web/Worker镜像绑定旧提交`78d96c6198ab4b7255572186ea580c463b5eeba3`。当前HEAD之后已有运行代码、Dockerfile和发布合同变化，没有可授权的当前源码匹配镜像。
- 首轮虚构UAT可采用`DISPOSABLE_SYNTHETIC / RECREATE_FROM_EMPTY`回退，不伪造备份恢复READY；真实样本和生产仍必须另做恢复演练。
- 完整事实、Migration摘要、隔离矩阵和下一授权包见[新建隔离UAT L1只读就绪报告](../uat/small-team-v1/environment-readiness.md)。

## 7. 推荐与下一任务

- 第一选择是独立UAT主机/VM，使固定secret、release identity、operator状态、Docker资源和磁盘天然独占；这比为小团队继续建设同机多租户控制平面更简单。
- 当前主机同机方案只作备选，必须先独立授权宿主root隔离配置和精确BuildKit-only清理，并在清理后重做资源门。
- 下一任务为`SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92`，等待项目负责人选择独立主机或同机路径。TASK92只解除前置，不自动取得L2a部署/Migration、账号或L3业务写权限。

## 8. 验证、资源与非动作

- 使用`--env-file /dev/null`和非敏感占位值完成基础及release overlay的Compose静态渲染，均退出0；候选项目名、服务、profile、网络、Volume和固定bind source得到确认，没有读取`.env`。
- 0041—0046 SHA-256、0046 snapshot SHA-256、46项文件数、journal尾和233张表静态核对通过；没有运行数据库测试或Migration。
- 起点约2.4 GiB MemAvailable、171.62 MiB Swap、根盘`10,791,727,104` bytes、Load`0.15/0.14/0.11`；收口约2.37 GiB、171.62 MiB、`10,782,752,768` bytes、`0.18/0.15/0.12`。Memory PSI和kernel OOM为0。
- Docker保持6容器、75镜像、277 Volume、174项Build Cache；四个常驻ERP服务restart 0/OOM false，Web/PostgreSQL healthy。TASK91容器、网络、Volume和`/dev/shm`残留均为0。
- 未连接数据库、读取业务/备份/Volume正文，未创建或修改运行资源，未执行build、pull/push、清理、部署、重启、账号或业务写。
