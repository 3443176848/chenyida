# SELFHOST-RELEASE-TYPECHECK-CLOSURE-46 完整发布 TypeScript 类型门闭环

> 状态：`DOING / REPOSITORY TYPECHECK CLOSURE / NO BUILD OR DEPLOY / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@ffd0ba6e705f79d4c0bef06952d725d7510b8782`
> 责任：Codex 主智能体为唯一写者、串行测试执行者、文档维护者和提交者；项目负责人负责未来候选 build、UAT/生产 Migration/deploy、真实数据、账号权限、员工试用和正式切换专项授权

## 1. 目标

关闭 D-116 发布门中“全部 `tsconfig*.json`”的已知失败：在固定、断网、资源受限的 Node 22 沙箱和干净已提交快照中逐个执行当前全部 38 份 TypeScript 配置，修复真实类型与工具链债务，使 `npm run typecheck:release` 完整通过并能证明没有漏配、跳过或用定向 typecheck 冒充全门通过。

本任务只处理仓库源码、TypeScript 配置、发布 typecheck 执行器/合同、必要回归测试和文档；不 build 镜像或应用，不连接或修改 UAT/生产，不运行 UAT/生产 Migration，不读取当前四卷正文、凭据或业务数据。

## 2. 已核验起点

- Git：唯一 worktree，`main@ffd0ba6e705f79d4c0bef06952d725d7510b8782`；唯一既有未跟踪文件为项目负责人状态报告，继续不读、不改、不提交。
- 源码：`0.1.0-alpha.46`、45/head `0045_runtime_worker_readiness.sql`；仓库顶层共有 38 份 `tsconfig*.json`。
- 发布门：`release-gate-plan-v1.json`第8步要求执行全部 TypeScript 配置；固定 Node 镜像为`node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`，断网、只读容器、1 CPU、1 GiB memory、1.25 GiB memory+swap、768 MiB Node heap。
- 既有失败：TASK42已证明完整门因根配置ES2017 BigInt、历史类型和示例依赖等问题失败；TASK43—TASK45只通过各自定向配置，不能替代完整门。
- 运行面：现场只读核验 Web alpha.42/source revision `569aa954d764309e239d1f6c174e582596d33a24`、UAT数据库40/head 0040；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false，四个受保护Volume metadata存在。本任务不改变运行面。
- 资源：起点available约1.9 GiB、Swap453 MiB/1 GiB、根盘30 GiB、Load`0.93/0.61/0.38`，当日内核OOM匹配0。

## 3. 验收标准

- [ ] 固定并核对全部38份`tsconfig*.json`的确定性执行顺序；新增、删除、重命名、漏跑或命令提前成功均失败关闭。
- [ ] 在提交快照、固定离线Node镜像和既有资源限制中实际执行完整门，保留按配置归类的首次失败证据。
- [ ] 修复所有真实错误；不得关闭`strict`/`noEmit`/`isolatedModules`、使用`skip`、`@ts-ignore`或空声明掩盖错误，也不得通过扩大`exclude`隐藏可发布源码。
- [ ] 如调整ECMAScript target、lib或模块合同，必须与Node 22/Vinext/浏览器实际运行边界一致，并用回归证明不改变业务规则、权限、事务、Migration或运行数据。
- [ ] `npm run typecheck:release`在干净已提交快照中对38/38配置通过；重复执行结果一致，任务临时容器和目录清零。
- [ ] 适用release合同、Node定向回归、lint、凭据扫描、Markdown链接、控制协议、`git diff --check`及路径范围门通过；不降低断言或把环境失败写成PASS。
- [ ] 记录重任务前后memory/Swap/disk/load、OOM/restart及清理；停止阈值任一触发时不启动下一重任务。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`、`ROADMAP.md`及发布测试文档，并创建聚焦源码、适用bundle和治理独立提交。

## 4. 禁止范围

- 不 build/pull/push Web、Worker或Browser镜像，不生成或发布候选manifest/runtime identity，不安装host supervisor。
- 不连接、读取或修改UAT/生产业务数据，不运行UAT/生产Migration、deploy、restart、真实登录或业务POST。
- 不修改Schema或新增Migration，不借类型修复改变岗位权限、业务状态机、金额/数量规则、审计或错误语义。
- 不修改Swap、systemd、网络、防火墙、Docker daemon，不删除镜像、备份、Volume或业务数据。
- 不读取、修改或提交`docs/ERP_CURRENT_STATUS_REPORT.md`和`shujvbiao/`。

## 5. 后续边界

本任务完成只关闭完整TypeScript门；固定Browser运行时、候选镜像build、镜像SBOM/新鲜漏洞PASS、完整18步候选门、UAT对齐、真实异机恢复和员工试用仍分别保持失败关闭并需要适用资源或专项授权。
