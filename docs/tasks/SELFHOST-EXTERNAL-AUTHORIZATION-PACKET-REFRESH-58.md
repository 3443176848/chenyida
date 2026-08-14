# SELFHOST-EXTERNAL-AUTHORIZATION-PACKET-REFRESH-58 当前候选授权包不可变身份刷新

> 状态：`DONE / CURRENT AUTHORIZATION INPUTS VERIFIED / NO AUTHORIZATION GRANTED / PRODUCTION NO-GO`
> 日期：2026-08-14（Asia/Shanghai）
> 严格起点：`main@04619b8a6a89cb410d8464751c733d472d7007cc` / tree `05ef60ac2f517e158778446437cb0c3f8bdba6f7`
> 责任：Codex主智能体唯一写入、验证和提交；项目负责人保留host、外部push、真实数据、UAT/生产、账号、员工试用与切换的专项授权权力

## 1. 目标

修复[投产专项授权执行包](../self-hosting/production-authorization-packet.md)仍绑定TASK53/TASK51历史source、bundle和候选的治理漂移，把A1—A3当前输入精确刷新到TASK57 canonical链与本机候选，同时保留“执行包不是授权书”的失败关闭边界。

本任务只更新治理文档，不生成可消费authorization，不创建root-only凭据，不安装host Supervisor，不push外部源码/镜像，也不连接或修改UAT、生产、数据库、账号、网络、Volume或业务数据。

## 2. 验收标准

- [x] 复核TASK57源码/manifest父子拓扑、bundle manifest、installer、launcher、Web/Worker manifest/config、构建回执及UAT/Supervisor现场状态。
- [x] 授权包当前事实只引用TASK57不可变身份；TASK53/TASK51只保留明确历史语境，不得成为未来A1/A2/A3输入。
- [x] A1固定source/manifest/bundle/installer/launcher，A3固定当前候选与待提供的私有目标，A2明确只能使用A3外部完整digest和独立精确候选快照。
- [x] 第13节逐项标明TASK54/TASK55/TASK57已关闭的仓库前置与仍可安全推进事项，不得错误宣称只剩外部授权。
- [x] 当前Migration统一为46/head `0046_runtime_lock_privilege_boundary.sql`，UAT保持alpha.42/0040且未改变。
- [x] `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`与`PRODUCTION_READINESS.md`同步，唯一`DOING`与任务结论一致。
- [x] Markdown链接、JSON、Shell、Python AST、凭据、范围和`git diff --check`通过；只暂存本任务列明文档并形成独立提交。

## 3. 禁止事项

- 不读取、修改、暂存或提交项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`。
- 不读取`.env`、凭据、日志、业务行、备份或受保护Volume正文。
- 不创建A1安装目录/授权，不运行正式发布动作，不向外部目标传输任何对象。
- 不把TASK57本机loopback/engine候选描述为外部恢复锚点或正式SBOM/security evidence。
- 不修改代码、Schema、Migration、Compose、镜像、运行服务、账号、systemd、网络、Swap、kernel或Docker daemon。

## 4. 实施与证据

- TASK57 canonical source`4d4586b1086470d32ce19a7f4eabbc2d2a33fa74`/tree`a551144e032f80f50fbd6c432059c97afbff7ece`与manifest-only直接子提交`78d96c6198ab4b7255572186ea580c463b5eeba3`/tree`3dbd20dd6803d485fca17f72f7ee90de277c3b9d`拓扑复核通过；唯一变更为`release-supervisor-bundle-v1.json`。
- 76文件bundle SHA-256为`631d76e650082de299fe836f1216b057d1ca7deabe29bd5e11e1a071a21ae763`，installer为`f12e52500540da4f17cbb7f021397cb50c2cf0b7bf18f037e6f31e56072d7cb3`，launcher为`92cabc075208b05d529f883e3fad4cd9951cb417308c262203985ae9383e68c6`；manifest内source/tree、launcher和76文件集合均逐项核对。
- 授权包已固定当前Web manifest/config`b7b21508…8a30`/`3c83d60f…f56e`、Worker`c5bf9d5c…b113`/`3bebff16…f971`及构建回执`33b1b921…a9a`，并明确它们仅为本机engine/diagnostic，不是A3外部锚点或A2正式证据。
- A1状态更新为“当前bundle就绪但未授权”，A3更新为“当前本机候选就绪但缺目标/凭据授权”；A2还被A1、A3和开放的detached snapshot合同共同阻塞，精确候选快照必须是`78d96c61…eba3`，不得用更晚治理提交冒充镜像revision。
- 第13节确认TASK54和TASK55—TASK56已关闭原第1/6项，TASK57关闭当前候选；仍开放A2 detached snapshot、监控host delivery、11角色机器矩阵、0017→0046合成升级、跨岗UAT模板和晋升/回滚执行器复核，下一项固定为第2项。
- 专项授权包身份合同通过，Markdown397文件/240本地链接、JSON220、Shell44、Python AST50、credentials1667及`git diff --check`通过；变更范围精确为八份治理Markdown。
- 起点/收口available约1.9/1.9GiB、Swap765/764MiB、根盘13/13GiB、Load低于1，`oom_kill=0`；四服务restart0/OOM false，Web/PostgreSQL healthy。唯一临时凭据扫描容器和目录已清理，没有build、Migration、数据库、Volume、镜像或prune。

## 5. 完成判定

`DONE / CURRENT AUTHORIZATION INPUTS VERIFIED / NO AUTHORIZATION GRANTED / PRODUCTION NO-GO`。授权包已从过期TASK53/TASK51身份刷新到TASK57当前链，但没有生成任何可消费授权或外部锚点。active slot释放后自动进入A2独立候选快照合同这一下一安全仓库任务；系统仍不能投入真实员工使用。
