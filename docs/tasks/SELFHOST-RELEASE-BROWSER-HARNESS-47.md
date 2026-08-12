# SELFHOST-RELEASE-BROWSER-HARNESS-47 固定浏览器运行时与发布 E2E 门闭环

> 状态：`DOING / SOURCE IMPLEMENTED / 9 OF 11 OBSERVED PASS / RESOURCE THRESHOLD PAUSE / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@fbbf2a5d034d11d8a50f823a55ef78d2d32d682d`
> 责任：Codex 主智能体为唯一写者、串行构建/测试执行者、文档维护者和提交者；项目负责人负责未来候选 Web/Worker 镜像、UAT/生产 Migration/deploy、真实数据、账号权限、员工试用和正式切换专项授权

## 1. 目标

关闭 D-116 发布门中已知的 Browser 失败：建立固定到精确 digest、平台与 Playwright 版本的浏览器运行时，在只读已提交源码快照、隔离 PostgreSQL 和低资源串行约束中实际执行发布清单的全部 6 个 `BROWSER_E2E` 文件，使缺失运行时、依赖漂移、Migration 漂移、跳过测试、进程泄漏或清理失败均失败关闭。

本任务只处理仓库测试运行时、执行器、发布合同、必要测试依赖和治理文档。允许为隔离测试拉取一个固定 Browser runtime 镜像，并在固定 Node 镜像中生成仅供测试的 standalone build；不 build/push Web 或 Worker 候选镜像，不连接或修改 UAT/生产，不读取当前四卷正文、凭据或业务数据。

## 2. 已核验起点

- Git：唯一 worktree，`main@fbbf2a5d034d11d8a50f823a55ef78d2d32d682d`；唯一既有未跟踪文件为项目负责人状态报告，继续不读、不改、不提交。
- 源码：`0.1.0-alpha.46`、45/head `0045_runtime_worker_readiness.sql`；TASK46 的完整 TypeScript 门已经在源码和 bundle 两个干净快照 38/38 通过。
- Browser 清单：`release-test-inventory-v1.json`精确列出 6 个 REQUIRED 文件，共覆盖 planning revision response、purchase traceability、requirement unit resolution、RFQ binding、RFQ traceability 和 supplier mapping。
- 既有失败：`scripts/run-release-node-sandbox.sh browser-e2e`固定返回`RELEASE_TEST_REQUIRED_HARNESS_NOT_AVAILABLE:browser-e2e`；宿主、当前 Web/Worker 镜像和仓库依赖均没有可执行 Chromium/Playwright runtime。
- 隔离要求：六文件需要 PostgreSQL 17、standalone Web server 以及历史精确 Migration head 0036—0039；现有测试均使用合成账号和独立测试库，不得连接运行 UAT。
- 运行面：只读核验 UAT 仍为 Web alpha.42/source revision `569aa954d764309e239d1f6c174e582596d33a24`、数据库 40/head 0040；四服务 restart 0/OOM false，四个受保护 Volume metadata 存在。本任务不改变运行面。
- 资源：起点 available 约 2.0 GiB、Swap 484 MiB/1 GiB、根盘 31 GiB、Load `0.06/0.22/0.71`，当日内核 OOM 匹配 0。

## 3. 验收标准

- [ ] 固定 Browser 镜像的完整仓库 digest、config digest、`linux/amd64`平台和 Playwright/Chromium 版本；包锁与镜像任一漂移均失败关闭。
- [ ] 固定并核对 6 个 REQUIRED Browser 文件的精确顺序、摘要、数据库名、目标 Migration head、服务端口和确认变量；新增、删除、漏跑、跳过或提前成功均失败关闭。
- [ ] 在干净已提交源码快照中使用固定 Node 镜像生成仅供测试的 standalone build；执行和构建均不使用工作区未提交内容或网络依赖。
- [ ] 使用固定 PostgreSQL 17 rootfs 和单一 Browser 容器在同一隔离网络命名空间运行；任何时刻最多一个临时容器，不连接 UAT、不挂载受保护 Volume。
- [ ] 六个 Browser 文件及其全部嵌套测试串行通过；测试只写合成隔离数据库，服务、数据库、浏览器和临时目录均在成功或失败后清理。
- [ ] `browser-e2e`发布动作从明确缺失改为真实失败关闭执行；运行策略、清单、supervisor bundle 和机器报告能绑定并核验 Browser runtime 证据。
- [ ] 适用 release 合同、负向漂移测试、typecheck、lint、凭据扫描、Markdown 链接、控制协议和`git diff --check`通过；不降低断言、不增加 skip/todo。
- [ ] 记录重任务前后 memory/Swap/disk/load、OOM/restart及清理；未触发项目停止阈值。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`、`ROADMAP.md`及发布测试文档，并形成聚焦源码、bundle和治理提交链。

## 4. 精确 Browser 文件

1. `tests/selfhost-planning-revision-response-browser.test.mjs`
2. `tests/selfhost-purchase-traceability-browser.test.mjs`
3. `tests/selfhost-requirement-unit-resolution-browser.test.mjs`
4. `tests/selfhost-rfq-binding-fix19-browser.test.mjs`
5. `tests/selfhost-rfq-traceability-fix22-browser.test.mjs`
6. `tests/selfhost-supplier-mapping-browser.test.mjs`

执行器必须从发布清单读取并复核上述集合，不允许维护另一个可静默分叉的较小集合。

## 5. 资源与安全设计

- Browser runtime 候选固定为官方 Playwright `v1.51.1-noble`的`linux/amd64`内容寻址镜像；正式纳入策略前必须拉取后本机核对 RepoDigest、config、平台、Node、Playwright 和 Chromium 可执行身份。
- PostgreSQL 使用 D-116 已固定的 PostgreSQL 17 digest。允许先创建、导出并删除一个临时 PostgreSQL 容器，再把只读 rootfs 挂入唯一 Browser 容器；不得同时保留两个临时容器。
- Browser 容器默认`--network none`、只读 rootfs、`no-new-privileges`、受限 CPU/memory/PID 和临时 tmpfs。若 PostgreSQL chroot 需要最小 capability，只允许在本任务容器中显式增加并由负向合同约束。
- 构建、rootfs 导出、Browser 执行和合同测试严格串行；每项重任务前后检查资源与当前四服务 restart/OOM 状态。
- 只清理`cyd-task47-*`、`cyd-release-browser-*`及本任务精确临时目录；不 prune，不删除既有镜像、备份、数据库、Volume 或用户文件。

## 6. 禁止范围

- 不 build/push Web、Worker 或最终候选镜像，不生成`ELIGIBLE`发布晋升，不部署或重启 UAT/生产。
- 不连接、读取或修改 UAT/生产业务数据，不运行 UAT/生产 Migration，不挂载或读取四个受保护 Volume 正文。
- 不修改 Schema、Migration、业务规则、岗位权限、账号、systemd、Swap、网络、防火墙或 Docker daemon。
- 不读取、修改或提交`docs/ERP_CURRENT_STATUS_REPORT.md`和`shujvbiao/`。

## 7. 后续边界

本任务完成只关闭固定 Browser runtime 与 6 项 Browser E2E 子门。候选 Web/Worker 镜像 build、镜像级 SBOM/新鲜漏洞 PASS、完整 18 步同候选门、UAT 对齐、真实异机恢复、岗位权限批准、真实迁移、员工试用和正式切换仍分别保持失败关闭并需要适用资源或专项授权。

## 8. 当前执行证据（尚未收口）

- 固定 Browser 镜像、Chromium 可执行身份、精确依赖树、6 文件 inventory、历史模板升级到当前 0045、同容器 PostgreSQL/standalone Web/Chromium、真实 `browser-e2e` 分发及 supervisor 合同均已落入源码；执行器保持断网、只读 rootfs、最小 capability、单临时容器与失败清理。
- 十二次串行干净提交快照执行用于逐项关闭运行时和历史测试漂移；最近一次执行中 planning revision、purchase traceability、requirement unit resolution、RFQ binding 及 RFQ traceability 前五项共 9/11 已实际通过。第 10 项 Award→PO 的失败路径因测试替身使用非 UUID `request_id` 被当前安全客户端正确升级为 `RESULT_UNKNOWN`；测试现已改为合法固定 UUID，并继续断言错误消息、请求号、无自动重试和数据库零写。第 10 项修正及第 11 项 Supplier Mapping 尚待整套重跑验证，不能标记完成。
- 最近一次重任务后 available memory 约 2.3 GiB、根盘可用 27 GiB、Load 低于阈值，内核 OOM 0、四服务 restart 0/OOM false，TASK47 临时容器和目录均为 0；但 Swap 为约 831 MiB/1 GiB，超过全仓库 80% 停止阈值。当前只允许轻量检查和文档，禁止启动新的 build、Browser、全量测试或数据库重任务；未修改 Swap、服务或 daemon。
- 当前最新聚焦修正提交为 `2a230a919ab0e7555ede1b0316b6f2dacaeef9ef`；完整 6 文件/11 测试 PASS、最终 bundle、typecheck、lint及治理收口仍是本任务未完成验收项。
