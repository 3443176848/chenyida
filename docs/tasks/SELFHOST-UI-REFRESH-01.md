# SELFHOST-UI-REFRESH-01 — 自托管 ERP 企业级 UI 统一改造

## 状态与唯一范围

- 状态：`DONE / SOURCE ONLY`
- 开始：2026-08-06（Asia/Shanghai）
- 完成：2026-08-06（Asia/Shanghai）
- 负责人：Codex（视觉基线、共享样式、响应式实现、静态/构建验证、文档与独立提交）；项目负责人（提出参考用友 ERP 界面改造）
- 依赖：`SELFHOST-PHASE2-TASK10`、`SELFHOST-LANDING-TASK04`、`SELFHOST-UAT-FIX-27`
- 唯一范围：只改 `chenyida_erp_site/` 自托管 Node/PostgreSQL 运行面的界面结构与样式，使登录、经营工作台、原生业务工作区和 legacy 兼容业务台形成统一的晨亿达企业 UI。

## 严格起点

- 根仓库 `main@70045998c765d95e1abf57041cd46a8da4f9ed7e`，`origin/main...HEAD` behind 0 / ahead 153，工作区 clean。
- 源码与当前非生产 UAT Web 均为 `0.1.0-alpha.40`；PostgreSQL 为 39/head `0039_rfq_traceability.sql`。
- 起点资源：available memory 约 2.2 GiB，Swap 286 MiB/1 GiB，根分区可用 18 GiB，Load `0.01/0.12/0.16`。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 restart 0/OOM false。

## 设计方向

- 参考用友 YonSuite 官方展示的一体化工作门户、角色工作台和紧凑业务信息布局，提取浅灰背景、白色工作区、清晰分区、蓝色主操作、紧凑表格与统一状态色等通用企业软件模式。
- 保留“晨亿达 ERP”名称和自有蓝色品牌，不复制用友商标、Logo、插图、截图或受保护素材。
- 建立统一设计令牌：品牌色、文字层级、边框、阴影、圆角、间距、表单、按钮、焦点、状态和响应式断点。

## 实现边界

- 改造登录/首次设置/强制改密状态、经营工作台、物料主数据壳、项目/计划/寻源共享工作区、Supplier Mapping/RFQ 扩展界面和 legacy 兼容业务台。
- 允许为视觉层次增加无业务语义的结构化容器、品牌标识和辅助说明；不得改变 API 调用、认证、权限、CSRF、幂等、状态转换或服务端业务规则。
- 不改数据库 Schema、Migration、版本号、Compose、环境变量、Origin、端口或受保护 Volume。
- 不登录或写入当前 UAT，不执行部署、备份恢复、Migration、生产动作或浏览器业务验收；部署必须另获明确授权。

## 验收标准

1. 登录页从暗色单卡改为响应式的品牌信息区 + 白色认证区，错误、加载、设置和改密状态继续可读且认证语义不变。
2. 经营工作台采用紧凑顶栏、统一指标卡、模块入口、风险/事件面板，桌面与窄屏均无页面级横向溢出。
3. Material、Project、Planning、Sourcing 及复用 Sourcing 样式的生产/品质/仓储/销售/财务页面使用同一颜色、圆角、边框、表单、按钮与状态体系。
4. legacy 兼容业务台同步同一视觉语言，不恢复已退役入口，不改变缓存或退出保护。
5. 键盘焦点可见，表单控件与按钮具备明确 hover/focus/disabled 状态；支持 `prefers-reduced-motion`。
6. 新增静态 UI 设计合同并通过；现有 Dashboard、Identity、Material、Project、Planning、Sourcing、Supplier Mapping UI 合同、TypeScript 检查、lint、生产 build/postbuild 和 `git diff --check` 通过。
7. `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 同步并创建一个独立 Git Commit；版本保持 alpha.40、Migration 保持 0039、UAT 保持未部署。

## 允许最终状态

- `SELF-HOSTED ERP UI REFRESH COMPLETE — SOURCE ONLY`
- `SELF-HOSTED ERP UI REFRESH BLOCKED — NO UAT CHANGE`

## 完成结果

- 登录、首次设置、强制改密和加载状态已统一为响应式品牌信息区 + 白色认证区；认证请求、错误合同、退出和强制改密逻辑未改。
- 经营工作台改为紧凑白色顶栏、角色/环境上下文条、指标卡、模块入口和事件面板；物料、项目、计划、寻源、Supplier Mapping、RFQ 扩展及复用页面统一为浅灰背景、白色面板、蓝色主操作和一致状态色。
- legacy 兼容业务台同步晨亿达自有 `CY` 标识、白色顶栏、深蓝侧栏和统一表单/表格；未恢复退役入口，缓存版本统一为 `20260806-enterprise-ui-refresh-01`。
- 新增 `selfhost-enterprise-ui-contract.test.mjs` 和 `test:ui:enterprise`，固定设计令牌、认证结构、路由、响应式、可见焦点、减弱动效和 legacy 身份一致性；未复制用友商标、Logo、截图或其他受保护素材。
- 未修改 API、认证、权限、CSRF、幂等、业务规则、Schema、Migration、版本、Compose 或环境变量；源码仍为 alpha.40，Migration 仍为 0039。

## 验证与资源

- 静态 UI 合同共 `72/72` 通过；Dashboard、Identity、Material、Project、Planning、Material Requirement、Sourcing、Supplier Mapping、Inventory、Procurement、Production、Sales、Quality 和 Finance 均包含在内。
- Dashboard、Review、Project、Planning、Procurement Sourcing 五组 TypeScript 检查通过；完整 lint 为 0 error / 11 个既有 warning；生产 build 五阶段和 postbuild consistency 通过。
- `npm test` 3/3、Python `server.py --self-test` / `smoke_test.py` / `go_live_check.py` 三项通过；凭证扫描 1,238 个仓库文件通过；`git diff --check` 通过。
- 首次生产 build 因只读 `node_modules` 无法建立 Vite 临时目录而失败；在同一受限临时容器中只为该目录提供 64 MiB tmpfs 后完整通过，未向工作区写入构建产物。未执行浏览器/UAT 业务验收、镜像构建、服务重启或部署。
- 资源从 available 约 2.2 GiB、Swap 286 MiB、根盘 18 GiB、Load `0.01/0.12/0.16` 到约 2.2 GiB、Swap 289 MiB、根盘 18 GiB、Load `0.38/0.62/0.52`；内核 OOM 0，四服务 restart 0/OOM false。
- 任务生成的三个参考图、全部受限测试容器、Python go-live 测试备份和对应单条活动记录已精确删除，均不可恢复；历史备份、业务数据、运行中的 Python 18889 服务、现有 `dist`、四个受保护 Volume 和全部常驻容器保持。

## 最终结论

`SELF-HOSTED ERP UI REFRESH COMPLETE — SOURCE ONLY`。当前 18888 非生产 UAT 仍运行改造前界面；如需部署或浏览器验收，必须另立任务并取得明确授权。
