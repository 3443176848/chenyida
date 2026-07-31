# SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05

## 状态

- 状态：`DOING`
- 开始日期：2026-07-31（Asia/Shanghai）
- 执行面：源码 `0.1.0-alpha.36` / `0035`；运行面 `0.1.0-alpha.34` / `0034`
- 可信起点：`main@3cb5c38bcfc9502bfb41cdd5d1aeec5f869722e8`，Parent `b66e742abe866aa7e1644c09c4fc28efb5e373e4`，`origin/main...HEAD = behind 0 / ahead 103`，工作区 clean。

## 唯一目标

修复 Planning Handoff 全部写请求未复用当前会话 CSRF 双提交客户端的问题；消除 RELEASED BOM 页面仍可编辑的假象，并让 BOM 管理页首次进入时保持空选择，不自动披露第一条历史 BOM 详情。不得推进或创建现有 UAT Planning Handoff。

## 受保护 UAT 事实

- Project `PRJ-00000001` 为 `ACCEPTED`，数量 `10`。
- Product ID `7`；Product Version ID `7`，`A0 / RELEASED`。
- BOM Header ID `7`；BOM Version ID `7`，`BOM-UAT-BB-PROD-042576-V1 / V1 / RELEASED`。
- BOM Line 固定为 material `533/534/535/536`，行号 `10/20/30/40`，数量均 `1 PCS`，损耗率均 `0`。
- Planning Package 历史版本为 `0`，没有成功 Planning 草稿或交接包。此前三次 `CSRF_INVALID` 失败请求作为不可变证据保留。

本任务不得对上述项目执行保存解析、生成交接包、提交、修订或重提；不得修改 Product/BOM/Line、创建 V2、登录 planning，或通过自动测试连接主库写入。

## 实施边界

1. Planning 所有写请求统一使用共享安全 API 客户端：`POST`、`credentials: same-origin`、从当前会话 CSRF Cookie 读取并发送正确 Header；登录、退出、撤销、重新登录后不复用旧 Token。
2. 页面内存 Idempotency-Key 同时绑定当前 Session 与 canonical 正文；重放、异正文冲突和 CAS 合同保持。
3. Origin、CSRF、Session、权限、限流、审计和安全错误继续由服务端 fail closed；不信任 `Forwarded`/`X-Forwarded-*`，不记录 Token、Cookie 或敏感正文。
4. RELEASED BOM 只展示只读事实及“已发布，只读；如需修改请创建新版本”，不渲染可编辑 Material、数量、损耗率、行号或新增/删除/保存/发布控件；详情切换清除旧 DRAFT 输入状态。
5. 服务端对 RELEASED BOM 新增、修改和删除行继续稳定拒绝，且失败不得产生 Line、Version、Event 或成功 Audit 半记录。
6. BOM 页默认显示“请选择或搜索 BOM”；只有明确选择后才加载详情。搜索支持 BOM 编码、产品编码或名称，服务端有界查询，不以加载全量明细实现搜索。
7. 不新增或运行 Migration；不得把 `0035`、TASK09 或完整 alpha.36 带入运行面。兼容构建必须基于现有 alpha.34/0034 hotfix 链，只替换 Web。

## 验收与部署

- 所有写测试只使用隔离 PostgreSQL、合成账号和合成项目；覆盖当前/缺失/错误/旧 Session CSRF、公网/回环/旧公网/未知 Origin、logout→login Token 轮换、Planning 四类写请求、幂等/CAS，以及 DRAFT/RELEASED BOM 前后端合同、零半记录、默认空选择和 code-first 回归。
- 严格串行执行专项、Identity/Project/Planning/Product/BOM/Material/Dashboard/TASK09 回归、typecheck、Schema consistency、lint、build、credentials、`git diff --check` 和 Python 三项基线。
- 部署前创建 PostgreSQL custom dump，完成清单和独立 0034 恢复；在隔离 0034 环境完成合成 Planning 全写旅程及真实浏览器验收。
- 部署只替换 Web；PostgreSQL、Worker、Caddy 原则上不重建。部署后主库只允许 engineering 登录/只读检查/logout 及对应审计，Planning 写请求为 0。

## 最终状态枚举

- `PLANNING CSRF AND RELEASED BOM IMMUTABILITY FIXED — UAT HANDOFF NOT CREATED`
- `PARTIALLY FIXED — UAT DATA UNCHANGED`
- `BLOCKED — NO UNSAFE CHANGE`
