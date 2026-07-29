# SELFHOST-OPS-UAT-BLOCKER-FIX 用户创建来源校验与退出登录修复

## 状态与授权

- 状态：`DONE — ADMIN IDENTITY CSRF AND LOGOUT BLOCKERS FIXED IN PARALLEL ENVIRONMENT`。
- 日期：2026-07-29（Asia/Shanghai）。
- 负责人：Codex（诊断、安全修复、隔离测试、并行环境部署、真实浏览器验收、文档与独立提交），项目负责人（明确任务范围、运行环境操作与验收授权）。
- 依赖：`SELFHOST-PHASE2-TASK02`、`SELFHOST-PHASE2-TASK10`、`SELFHOST-OPS-TRUSTED-ORIGIN-05`、`SELFHOST-LANDING-TASK03`。

## 已确认黑盒问题

1. 管理员从网页创建用户连续两次显示“请求来源校验失败”，审计为 `USER_CREATED/failed/CSRF_INVALID`。
2. 经营工作台和兼容工作台的退出入口都未撤销会话、未显示错误，审计为 `LOGOUT/failed/CSRF_INVALID`。
3. 管理员登录正常，尚未创建 UAT 角色账号。

## 任务范围

1. 分别从真实网页复现 `POST /api/users` 与两个 `POST /api/logout` 入口，脱敏核对页面/请求 Origin、Host/可信代理边界、CSRF Cookie/Header、credentials、Cookie 属性和端口变化。
2. 给出证据明确的根因；不得关闭 CSRF、通配 Origin、信任任意转发头、把 logout 改为 GET 或仅清浏览器状态。
3. 修复管理员网页创建用户与两个入口统一安全退出；服务端 Session 撤销、Cookie 对称清理、审计、幂等、密码、权限和稳定中文错误保持。
4. 增加正确/错误 CSRF、未知外部 Origin、受控 loopback/SSH、用户创建、logout 撤销、Cookie 属性、审计及双入口合同回归。
5. 自动测试全部使用隔离临时数据库；适用测试通过后才备份并串行更新当前 `chenyida-erp-parallel` 非生产 Web，不运行或修改 Migration。
6. 使用 `/etc/chenyida-erp/parallel-admin.txt` 中现有管理员凭据完成真实浏览器验收；凭据和 Cookie/Token 不输出。创建唯一 `uat_fixcheck_manager_<时间后缀>` 经营负责人账号，验收后仅通过页面停用或删除。

## 固定保护边界

- 不访问、读取、修改、移动、提交或删除 `/opt/erp/shujvbiao/` 及用户上传资料。
- 不访问或修改 SQLite、D1、历史 Sites、外部数据库或 Python 服务。
- 不修改或删除真实业务数据、现有管理员、既有 Migration 和四个 ERP 持久卷；不 push、不建 PR、不改写 Git 历史。
- 生产环境只接受显式配置的可信 HTTPS Origin；loopback/SSH 兼容必须有明确非生产配置或严格 loopback 判断，未知/恶意 Origin 继续拒绝。
- 所有测试、build、备份与 Compose 操作串行，`COMPOSE_PARALLEL_LIMIT=1`、`NODE_OPTIONS=--max-old-space-size=1024`，每项重任务前后执行资源/OOM/restart 门禁。
- 完成后立即停止，不开始 manager 或其他角色业务试用。

## 验收结论枚举

- `ADMIN IDENTITY CSRF AND LOGOUT BLOCKERS FIXED IN PARALLEL ENVIRONMENT`
- `CODE FIXED — PARALLEL ACCEPTANCE BLOCKED`
- `BLOCKED — NO RUNTIME CHANGE`

## 根因与修复

真实 Chromium 通过本机受控转发访问 `http://127.0.0.1:<动态端口>` 时，页面 Origin、请求目标 Origin 和 Header Origin 都是同一回环 origin；请求包含 Session Cookie、CSRF Cookie、与 Cookie 匹配的 CSRF Header，创建用户还包含幂等键。运行面当时却只配置公网 `https://43.135.157.211.nip.io:18888` 为唯一允许来源，因此请求在身份服务真正处理前以 `CSRF_INVALID` 拒绝。相同请求经精确公网 HTTPS Origin 可越过来源门禁，证明 Session/Token 本身不是根因。

经营工作台与兼容工作台各自发送 logout，且都用 `.catch(() => null)` 吞掉失败后乐观清除页面状态或刷新。服务端从未撤销失败请求对应的 Session，审计正确记录 `LOGOUT/failed/CSRF_INVALID`，但前端没有把失败告诉用户。

修复增加独立 deployment class。只有明确配置 `ERP_DEPLOYMENT_CLASS=uat` 和 `ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true` 才允许严格字面量 loopback，并要求浏览器 Origin 与请求 URL origin 同时为回环；生产类别仍只接受显式公网 HTTPS Origin。两个工作台统一调用共享安全 logout：`POST`、`credentials: same-origin`、Cookie/Header CSRF 双提交，只在成功撤销服务端 Session、写成功审计并对称清 Cookie 后跳转，失败显示稳定错误码和中文提示。

## 自动验证

- 来源、身份、身份 UI、Dashboard UI 合计 `24/24` 通过；覆盖合法公网/回环、缺失或错误 CSRF、未知外部 Origin、错误部署配置、两个前端共享 logout 和可见失败。
- 隔离临时 PostgreSQL 身份回归 `10/10` 通过；覆盖管理员创建、弱密码、重复用户名、未授权角色 403、创建审计、logout 撤销、旧 Session 拒绝、Cookie 对称清理与重复退出。临时数据库已删除，未写当前主库。
- 基于运行 alpha.34 的候选镜像 build 通过；现有 Compose Identity API smoke 在初次运行与服务重启后均通过，分别验证 version 5、8 条任务测试审计。所有测试、build、备份和 Compose 操作串行。

## 并行环境与浏览器验收

- 部署前 custom PostgreSQL dump 已完成 `pg_restore --list`，并恢复到新临时库核对 34/0034、用户、审计、Session 和 `532/6/6/316` 业务基线；恢复库随后删除。未创建、修改或运行 Migration。
- 只更新 Web；PostgreSQL、Worker、Caddy 容器和四个受保护卷保持。最终 Web 镜像为 `sha256:273aa687e74184d748bfa375826f30ccfd2252c3843d9e59fb2781e4a849fd28`，运行包仍为 alpha.34，数据库仍为 34/0034。
- 真实 Chromium 使用现有管理员凭据创建唯一 `uat_fixcheck_manager_5317094938`，角色为经营负责人；列表可见，`USER_CREATED/success` 审计存在。账号未用于业务试用，验收后通过页面停用，`USER_STATUS_CHANGED/success` 存在，最终 active=false、must-change=true、version 2。
- 经营工作台 logout 200，旧 Session 对 `/api/session` 为 `REVOKED`；重新登录成功。兼容工作台 logout 200，旧 Session 同样为 `REVOKED`；再次登录成功。两次成功 logout 均有成功审计，匿名重复 logout 200，Session/CSRF Cookie 清理的 Path、Secure、SameSite 和 HttpOnly 属性与设置对称。
- 浏览器复现阶段保留失败审计 897—907 作为不可变诊断证据；部署后的审计 908—920 全部成功，无新增身份失败或 500。首次验收脚本在页面停用后的刷新检查提前结束，留下一个已丢失令牌、等待正常 8 小时 TTL 的会话；没有直接 SQL 删除。两条目标 logout 和完整复验产生的所有旧 Session 均已服务端撤销。

## 提交与停止边界

- 代码提交：`dfa30bf7575a4cd3d06756a626480ca20204cec6`，Parent `5fc1266b70f57e1c5d44464f14f2a615dbeab3e4`，消息 `fix: secure UAT identity writes and logout`。
- 文档与验收记录使用后续独立提交，Parent 为上述代码提交；实际 SHA 以 Git log 为准，不 amend。
- 不 push、不建 PR，不访问或操作 Python、SQLite、D1、历史 Sites 或外部数据库；不读取、修改、移动、提交或删除 `shujvbiao/`。完成后停止，不开始 manager 或任何其他角色业务试用。
