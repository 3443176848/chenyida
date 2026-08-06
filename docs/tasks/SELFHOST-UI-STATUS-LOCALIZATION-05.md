# SELFHOST-UI-STATUS-LOCALIZATION-05 — ERP 可见状态中文化

## 状态与唯一范围

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 完成：2026-08-06（Asia/Shanghai）
- 负责人：Codex（状态展示盘点、统一中文词典、前端接入、测试、文档与独立提交）；项目负责人（指出多处英文状态并要求更改）
- 依赖：`SELFHOST-UI-REFRESH-01`、`SELFHOST-DASHBOARD-ROLE-HUB-03`、`SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04`
- 唯一范围：把 `chenyida_erp_site/` 原生页面与 legacy 兼容业务台中面向用户展示的业务状态、审核结果、执行结果和启停状态统一显示为中文。

## 严格起点

- 根仓库 clean `main@fb4c89bd`，behind 0/ahead 157。
- 源码与公开非生产 UAT Web 均为 `0.1.0-alpha.40`；PostgreSQL 为 39/head `0039_rfq_traceability.sql`。
- 当前 UAT Web 为 `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`，Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 起点资源：available memory 约 2.2 GiB，Swap 260 MiB/1 GiB，根分区可用 19 GiB，Load `0.04/0.19/0.37`。

## 展示边界

- 数据库、API、请求参数、状态机、权限、CSS 分类和测试夹具继续使用原始稳定英文枚举；只在最终用户可见的文本边界转换为中文。
- 覆盖状态徽标、状态栏、详情字段、列表字段、确认窗口和摘要中的裸英文状态；同一枚举在不同页面使用同一中文含义。
- 保留 ERP 行业标识与稳定业务缩写，例如 ERP、BOM、RFQ、PO、IQC、IPQC、FQC、AR、AP、ID、CAS；不得把编码、外部参考、请求编号或原始审计载荷误翻译。
- 未知新状态必须失败安全地保留原值，不能显示空白、猜测业务含义或改变提交值。
- 不修改认证、API、权限、业务规则、Schema、Migration、版本、Compose、环境变量或部署配置；不登录、写数据、构建在线镜像、重启或部署 UAT。

## 验收标准

1. 建立可测试的集中状态中文词典和格式化入口，覆盖代码中所有已知可见业务状态。
2. 原生 React 页面和 legacy 兼容台的状态徽标/状态栏不再直接输出已知英文枚举；布尔启停与成功/失败结果也显示明确中文。
3. 原始枚举仍用于 API、筛选、比较、提交、样式和审计，不改变任何服务端合同或状态转换。
4. 自动测试覆盖词典、未知值回退、典型页面接入及禁止裸状态回归；相关 UI、TypeScript、lint、生产 build/postbuild、npm/Python 和凭据扫描通过。
5. 同步 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 并创建独立 Git Commit。

## 允许最终状态

- `VISIBLE ERP STATUSES LOCALIZED — SOURCE ONLY`
- `STATUS LOCALIZATION BLOCKED — UAT UNCHANGED`

## 完成内容

- 新增共享 `status-localization.js` / 类型声明，以 `statusLabel`、`statusPairLabel` 和 `roleLabel` 统一业务状态、组合状态、审核/执行结果、启停状态与角色名称；未知新枚举原样保留，空值显示为 `—`。
- 原生 React 页面与 legacy 兼容台均接入同一词典；状态徽标、列表/详情状态、决策与操作凭证、审计结果、筛选显示和当前角色不再直接展示已知英文枚举。
- 工作台及业务页仍残留的纯英文眉题同步改为中文；ERP、BOM、RFQ、PO、IQC、IPQC、FQC、AR、AP、ID、CAS 等稳定行业缩写与技术标识保留。
- 所有 API 请求值、筛选 `value`、比较分支、CSS 状态分类、数据库枚举和审计原始动作码继续使用原值；没有改变认证、权限、业务规则、Schema、Migration、版本或部署配置。
- legacy 静态资源缓存标识更新为 `20260806-status-localization-05`，确保后续获准部署时浏览器能加载新显示层。

## 验证与资源

- 38 个适用 UI/物料/状态本地化测试文件全部通过；10 组正式 TypeScript 检查通过；五个受影响浏览器验证脚本通过语法检查，未连接 UAT 执行登录式或业务写入旅程。
- 全量 lint 为 0 error / 11 个既有 warning；`npm test` 为 3/3；Vinext production build 五阶段与 postbuild consistency 通过。
- Python 项目虚拟环境的 `server.py --self-test`、`smoke_test.py`、隔离临时 SQLite `go_live_check.py --no-backup` 全部通过；临时数据库已逐项删除。
- 凭据扫描通过 1,247 个仓库文件，`git diff --check` 通过；没有提交密码、Token、Cookie、Session 摘要、连接信息、数据库或备份。
- 构建使用唯一受限只读容器并把 `dist`、Vinext 与 Vite 临时目录放入 tmpfs；前两次仅暴露只读挂载点配置问题，均未进入实际编译，修正挂载后完整通过。任务容器、挂载点与临时 SQLite 已清零。
- 资源从 available memory 约 2.2 GiB、Swap 260 MiB/1 GiB、根盘可用 19 GiB、Load `0.04/0.19/0.37` 到约 2.2 GiB、Swap 272 MiB/1 GiB、根盘 19 GiB、Load `0.18/0.78/0.72`；内核 OOM 0，四个 UAT 服务 restart 0/OOM false，Web/PostgreSQL 仍 healthy。

## 运行边界与结论

- 当前公开非生产 UAT 继续运行既有 Web 镜像 `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`；未登录、未写业务数据、未构建在线镜像、未替换容器、未运行 Migration、未重启服务或部署。
- 结论：`VISIBLE ERP STATUSES LOCALIZED — SOURCE ONLY`。如需把中文状态显示发布到公开 UAT，必须新建部署任务并取得新的明确授权。
