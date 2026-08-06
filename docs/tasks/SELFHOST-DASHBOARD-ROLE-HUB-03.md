# SELFHOST-DASHBOARD-ROLE-HUB-03 — 登录后工作台八角色入口简化

## 状态与唯一范围

- 状态：`DONE / SOURCE VERIFIED`
- 开始：2026-08-06（Asia/Shanghai）
- 完成：2026-08-06（Asia/Shanghai）
- 负责人：Codex（角色入口信息架构、响应式实现、契约/构建验证、文档与独立提交）；项目负责人（指定八个工作台入口）
- 依赖：`SELFHOST-UI-REFRESH-01`、`SELFHOST-UI-REFRESH-DEPLOY-02`、`SELFHOST-PHASE2-TASK10`
- 唯一范围：只简化 `chenyida_erp_site/` 登录后的根工作台，把密集指标、待办和模块方块改为管理员、采购、市场、计划、工程、财务、生产、仓库八个角色入口。

## 严格起点

- 根仓库 `main@8aa3f70329a11cffb2ee43d2942b3c4484e6137f`，工作区 clean。
- 源码与当前非生产 UAT Web 均为 `0.1.0-alpha.40`；PostgreSQL 为 39/head `0039_rfq_traceability.sql`。
- 当前公开非生产 UAT 运行企业级 UI 镜像 `sha256:f139257b6b6b845bebbf9aa97eb909895158d637956f069b2c82f99b2b1d5b6d`；源码实现开始时没有新部署授权，项目负责人随后明确授权另立 Web-only 部署任务。
- 起点资源：available memory 约 2.1 GiB，Swap 292 MiB/1 GiB，根分区可用 19 GiB，Load `0.07/0.18/0.32`；Web/PostgreSQL healthy，Worker/Caddy running。

## 设计与权限边界

- 根工作台固定展示八个角色入口；桌面为角色导航 + 单一当前部门业务清单，窄屏改为纵向布局，初始页面不再同时展开全部指标和模块卡片。
- 每个部门下的业务链接必须仅由 `/api/summary` 返回的服务端授权模块组成；前端只分组、排序和展示，不自行授予链接或业务权限。
- 品质相关业务按实际协作环节归入生产或仓库入口；物料/BOM 归入工程，用户、运维、往来单位和运营审核归入管理员。
- 不修改认证、Session、权限定义、API、CSRF、幂等、业务状态、Schema、Migration、版本号、Compose、环境变量或受保护 Volume。
- 不登录或写入当前 UAT，不构建/替换在线镜像，不重启服务；部署必须另获明确授权。

## 验收标准

1. 登录后根工作台精确提供管理员、采购、市场、计划、工程、财务、生产、仓库八个入口，视觉上不再铺满指标卡、风险卡和全部模块方块。
2. 八部门完整覆盖当前 Dashboard 模块清单且无重复；每个部门只展示服务端已返回的获准模块，未授权部门不可进入。
3. 桌面和窄屏均无页面级横向溢出，键盘焦点、选中态、无权限态和 reduced motion 保持可用。
4. 登录、首次设置、强制改密、退出和历史恢复保护不变；根工作台只读取 Session 与 Summary。
5. 新增/更新 UI 契约，相关静态测试、TypeScript、lint、生产 build/postbuild、Python 基线、凭证扫描和 `git diff --check` 通过。
6. 同步 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`，创建独立 Git Commit；线上 UAT 保持未变。

## 允许最终状态

- `ROLE-BASED WORKBENCH COMPLETE — SOURCE ONLY`
- `ROLE-BASED WORKBENCH BLOCKED — UAT UNCHANGED`

## 完成结果

- 登录后的根页面已从指标、风险、治理、事件和全部模块同时铺开的密集卡片，改为“八部门导航 + 单一当前部门业务清单”。入口精确为管理员、采购、市场、计划、工程、财务、生产、仓库。
- 当前 40 个 Dashboard 模块均被唯一归入一个部门，零遗漏、零重复；实际链接继续只消费 `/api/summary` 返回的服务端授权模块，未授权部门显示为不可进入。
- 根工作台不再请求 Management Dashboard 或 Backup Governance，只读取 Session 与权限裁剪后的 Summary；认证、改密、退出、history restore、服务端权限和业务 API 均未改。
- 桌面采用清晰的左右分栏，720px 以下改为纵向导航与单一业务清单；保留可见焦点、选中/禁用态、无页面级横向溢出和 reduced motion。
- 项目负责人在实现期间明确要求“直接部署到线上”；该授权由后续独立 `SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04` 使用，本源码任务没有构建在线镜像、替换服务、登录或写入 UAT。

## 验证与资源

- 相关 UI 合同最终 `73/73`，其中新增八部门精确顺序、40 模块完整唯一分组、旧密集卡片退出和服务端裁剪合同；Dashboard/Review/Project/Planning/Procurement Sourcing 五组 TypeScript 通过。
- 完整 lint、生产 build 五阶段与 postbuild consistency、npm `3/3`、Python `server.py --self-test` / `smoke_test.py` / `go_live_check.py --no-backup`、1,241 文件凭证扫描和 `git diff --check` 通过。
- 构建在 768 MiB、0.75 CPU 的唯一只读临时容器中串行执行，`dist` 和 Vite 临时目录只使用 tmpfs；工作区没有构建输出，临时容器已清零。
- 资源从 available 约 2.1 GiB、Swap 292 MiB、根盘 19 GiB、Load `0.07/0.18/0.32` 到约 2.2 GiB、Swap 306 MiB、根盘 19 GiB、Load `2.51/1.97/1.03`；四服务 restart 0/OOM false，无遗留临时容器。

## 最终结论

`ROLE-BASED WORKBENCH COMPLETE — SOURCE ONLY`。源码和验证已完成；公开 UAT 此时仍运行旧工作台镜像，后续按已取得授权执行独立 Web-only 部署。
