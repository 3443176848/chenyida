# SELFHOST-RELEASE-BROWSER-HARNESS-47 固定浏览器运行时与发布 E2E 门闭环

> 状态：`DONE / REPOSITORY BROWSER GATE VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`
> 日期：2026-08-12—2026-08-13（Asia/Shanghai）
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

- [x] 固定 Browser 镜像的完整仓库 digest、config digest、`linux/amd64`平台和 Playwright/Chromium 版本；包锁与镜像任一漂移均失败关闭。
- [x] 固定并核对 6 个 REQUIRED Browser 文件的精确顺序、摘要、数据库名、目标 Migration head、服务端口和确认变量；新增、删除、漏跑、跳过或提前成功均失败关闭。
- [x] 在干净已提交源码快照中使用固定 Node 镜像生成仅供测试的 standalone build；执行和构建均不使用工作区未提交内容或网络依赖。
- [x] 使用固定 PostgreSQL 17 rootfs 和单一 Browser 容器在同一隔离网络命名空间运行；任何时刻最多一个临时容器，不连接 UAT、不挂载受保护 Volume。
- [x] 六个 Browser 文件及其全部嵌套测试串行通过；测试只写合成隔离数据库，服务、数据库、浏览器和临时目录均在成功或失败后清理。
- [x] `browser-e2e`发布动作从明确缺失改为真实失败关闭执行；运行策略、清单、supervisor bundle 和机器报告能绑定并核验 Browser runtime 证据。
- [x] 适用 release 合同、负向漂移测试、typecheck、lint、凭据扫描、Markdown 链接、控制协议和`git diff --check`通过；不降低断言、不增加 skip/todo。
- [x] 记录重任务前后 memory/Swap/disk/load、OOM/restart及清理；停止阈值触发时暂停，恢复到阈值内后才继续。
- [x] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`、`ROADMAP.md`及发布测试文档，并形成聚焦源码、bundle和治理提交链。

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

## 8. 完成证据

- 固定官方 Playwright `1.51.1` Browser 镜像完整 Repo/config digest、`linux/amd64`平台、Chromium revision 1161/version `134.0.6998.35`、可执行路径及 SHA-256；包锁、依赖树、inventory、runtime policy、机器报告和 supervisor 负向合同对任一漂移失败关闭。
- 第十三次完整干净快照运行以`task47-thirteenth-clean`串行执行6个文件/11项，planning revision response、purchase traceability、requirement unit resolution、RFQ binding、RFQ traceability和supplier mapping全部PASS；测试文件路径集SHA-256为`71742177a734c12b1a53f63a93f8a68344c68c9400a7c3e0d9a9f9a4ad08ac86`，无skip/todo、服务和合成数据库均清理。
- 最终源码提交为`9a18a0f307348c974a6f341565e7d16d76df184c`，tree为`8c182d38f1acbcebe10d46e3a09f73c9ec612f22`；manifest-only直接子提交`614ef7ac2aea5ec23029c81b17b8c21adc0935dd`绑定39个文件，bundle SHA-256为`e54019dfde0af7a9a8367b5ade53976b1ffc4b24f9b36e46ae3778ed963a7192`。
- 最终bundle快照通过release合同6文件/45项、supervisor Python 20项、完整typecheck 38/38和lint 0 error/11条既有warning；inventory保持235/211/24。治理收口另核验JSON、Shell、Markdown链接、控制协议、凭据模式、范围与`git diff --check`。
- Browser前资源为available 2,424,572 KiB、Swap 801,036/1,049,596 KiB、根盘27 GiB、Load`0.23/0.34/0.56`；Browser后Swap短暂到841,112 KiB（80.14%）时停止新重任务，未修改Swap或服务。其自然回落到阈值内后才继续typecheck/lint；最终available 2,481,228 KiB、Swap771,176 KiB（73.47%）、根盘27 GiB、Load`0.98/1.91/1.62`，内核OOM 0、四服务restart 0/OOM false，TASK47临时容器和目录为0。
- 全程只使用Git快照、固定镜像与合成隔离数据库；未连接或修改UAT/生产，未读取四个受保护Volume正文、凭据或业务数据，未build/push Web/Worker候选镜像，未部署、运行真实Migration或生成`ELIGIBLE`候选。系统继续`PRODUCTION NO-GO`。
