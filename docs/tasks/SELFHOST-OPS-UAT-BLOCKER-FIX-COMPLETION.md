# SELFHOST-OPS-UAT-BLOCKER-FIX 完成报告

最终状态：`ADMIN IDENTITY CSRF AND LOGOUT BLOCKERS FIXED IN PARALLEL ENVIRONMENT`

日期：2026-07-29（Asia/Shanghai）

## 1. 根因证据

真实 Chromium 复现时，页面 Origin、请求目标 Origin 和 Header Origin 均为 `http://127.0.0.1:<动态端口>`；代理 Host 也是同一回环地址，未携带 `Forwarded` 或 `X-Forwarded-*`。创建用户请求确实携带 Session Cookie、CSRF Cookie、与 Cookie 匹配的 CSRF Header、same-origin credentials 和幂等键；两个 logout 同样携带 Session 和匹配 CSRF。运行面原本只允许 `https://43.135.157.211.nip.io:18888`，因此受控 SSH/浏览器回环请求在业务处理前统一返回 `CSRF_INVALID`。同样门禁经精确公网 HTTPS Origin 可通过到达密码策略或成功 logout，排除了密码、Session 或 Token 本身为根因。

经营工作台和兼容工作台还分别用 `.catch(() => null)` 吞掉 logout 失败，并乐观清理/刷新页面。失败请求没有到达服务端 Session 撤销事务，所以会话继续有效；审计正确留下 `LOGOUT/failed/CSRF_INVALID`，页面却没有提示。

## 2. 实际修改

代码提交修改以下文件：

- 配置与来源边界：`chenyida_erp_site/.env.example`、`app/lib/infrastructure/config.ts`、`app/lib/infrastructure/request-origin.ts`、`app/lib/identity-selfhost/handler.ts`、`app/lib/selfhost-api.ts`、`compose.yml`。
- 统一退出与页面错误：`public/erp/api-client.js`、`public/erp/app.js`、`public/erp/index.html`、`app/_components/erp-workbench.tsx`、`app/lib/dashboard-selfhost/service.ts`。
- 回归测试：`tests/selfhost-request-origin-unit.test.mjs`、`tests/selfhost-identity-unit.test.mjs`、`tests/selfhost-identity-postgres.test.mjs`、`tests/selfhost-identity-ui-contract.test.mjs`、`tests/selfhost-dashboard-ui-contract.test.mjs`。

文档提交更新 `docs/self-hosting/identity-security.md`、`docs/project/MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`DECISIONS.md`、`CHANGELOG.md`、`STATUS.md`、当前任务文档和本报告。运行面 root-only `/etc/chenyida-erp/parallel.env` 只增加 `ERP_DEPLOYMENT_CLASS=uat` 与 `ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true`；值不含凭据，env 全文未输出或提交。

## 3. 安全边界为何没有降低

- 生产 deployment class 仍只接受规范化、显式配置的可信 HTTPS `ERP_PUBLIC_ORIGIN`，且拒绝启用 UAT loopback flag。
- UAT 例外必须双配置显式开启，只允许 HTTP(S) 的严格字面量 `localhost`、`127.0.0.1` 或 `[::1]`，并要求浏览器 Origin 和 Request URL origin 两边同时为回环。未知域名、外部 IP、单边回环、带凭据 URL、通配或非法配置继续 fail closed。
- 不读取或反射 `Host`、`Forwarded`、`X-Forwarded-Host`、`X-Forwarded-Proto`；没有 `Access-Control-Allow-Origin: *`。
- logout 仍是 POST，使用 same-origin credentials 和 Cookie/Header CSRF 双提交；成功必须服务端撤销 Session、成功审计并清 Cookie。没有把 Token 放入 URL，也没有用仅清浏览器状态代替服务端撤销。
- `ERP_ENV=production` 保持 Session/CSRF Cookie `Secure`；Session 为 `HttpOnly; SameSite=Lax; Path=/`，CSRF 为非 HttpOnly、`SameSite=Lax; Path=/`。清理响应使用相同 Path/Secure/SameSite/HttpOnly 边界和 `Max-Age=0`。
- 用户创建的 admin 权限、角色白名单、弱密码、重复用户名、幂等、请求编号和成功/失败审计均保持。

## 4. 自动测试

| 范围 | 结果 |
| --- | --- |
| request-origin unit | `6/6 PASS` |
| identity unit | `8/8 PASS` |
| identity UI contract | `6/6 PASS` |
| dashboard UI contract | `4/4 PASS` |
| 隔离 PostgreSQL identity | `10/10 PASS` |
| alpha.34 candidate build | `PASS` |
| alpha.34 Identity Compose/API smoke | initial `PASS`；restart `PASS` |

回归覆盖正确 Origin+CSRF 创建、缺失/错误 CSRF、未知外部 Origin、显式 UAT loopback、弱密码、重复用户名、未授权角色 403、创建/退出审计、logout 撤销、旧 Session 拒绝、重复退出、Cookie 对称清理和两个前端共用安全退出。PostgreSQL 测试只使用隔离临时库，结束后删除；没有自动测试写当前主库。

两次早期 harness 环境失败发生在业务请求前：一次为测试容器挂载权限/配置，一次为候选 smoke runner 依赖不可用。修正测试装配后上述正式测试全部通过，没有降低断言或跳过用例。

## 5. 真实浏览器验收

管理员凭据仅从 `/etc/chenyida-erp/parallel-admin.txt` 在关闭输出的 runner 内读取，未输出密码、Session、CSRF、Cookie 或请求正文。

- 网页创建唯一账号 `uat_fixcheck_manager_5317094938` 成功，角色为“经营负责人”；列表可见，审计 `USER_CREATED/success`。
- 经营工作台 logout 返回 200并回到登录页；旧 Session 查询为 `REVOKED`，成功审计存在。匿名重复 logout 200，无 500；随后重新登录成功。
- 兼容工作台 logout 同样返回 200并回到登录页；旧 Session 为 `REVOKED`，成功审计存在；随后再次登录成功。
- 两个入口都实际发送 Session/CSRF Cookie 与匹配 CSRF Header；响应对称清除 Session/CSRF Cookie。
- 临时账号未创建任何业务数据或进入角色试用。页面不支持删除，已通过用户管理页面停用；最终 `active=false`、`must_change_password=true`、version 2，审计 `USER_STATUS_CHANGED/success`。
- 复现审计 897—907 作为不可变失败/公网对照证据保留；部署后 908—920 全部成功，Web 日志没有新的身份失败或内部错误。

首次验收脚本在账号停用完成后的页面刷新检查处提前结束，留下一个已经丢失令牌、等待正常 8 小时 TTL 的会话。该会话不是两个 logout 目标之一；任务要求的经营/兼容 logout 和完整复验产生的所有旧 Session 均已立即服务端撤销。根据“不直接 SQL 删除、不改写真实身份/审计”的保护边界，没有删除该脚本残留。最终数据库为用户/active `3/2`、Session/有效 `14/5`、Audit `920`。

## 6. 版本、Migration、部署与恢复

- 源码：`0.1.0-alpha.35`，migration head `0035_bom_material_governance.sql`。
- 常驻运行面：alpha.34，PostgreSQL/Worker 为 `0034_supplier_receipt_lot_iqc.sql`。本任务没有结构变化，没有新增、修改或运行 Migration；0035 未应用。
- Web：只重建必要的 Web，最终镜像 `sha256:273aa687e74184d748bfa375826f30ccfd2252c3843d9e59fb2781e4a849fd28`。
- PostgreSQL、Worker、Caddy 容器未重建；PostgreSQL/Web healthy，Worker/Caddy running。四个 ERP 持久卷创建时间仍为 2026-07-25 21:05:58+08:00。
- 业务 Material/Product/BOM/Line 保持 `532/6/6/316`；未创建业务数据、修改现有管理员或访问 Python/SQLite/D1/外部数据库。

部署前备份位于 root-only `/var/backups/chenyida-erp/SELFHOST-OPS-UAT-BLOCKER-FIX-20260729T091452Z`。`postgresql.dump` 为 1,985,741 bytes，SHA-256 `d8951686192b500bee1770be258c8ee3eddb5e8d8509c0664cb6ca7b64714c79`；`pg_restore --list` 通过，并恢复到新临时库逐项核对 34/0034、用户 2、Audit 907、Session 8 和业务 `532/6/6/316` 后删除恢复库。任务前 env 副本与旧 Web 回滚 tag `rollback-uatfix-20260729T091452Z` 保留。

## 7. 资源、清理与 Git

- 起点约 2.4 GiB available、Swap 124 KiB、根盘可用 34 GiB、低负载；最终 2.3 GiB available、Swap 3.2 MiB、根盘可用 34 GiB、Load `0.01/0.21/0.30`。
- 最终 60 秒 MemAvailable `2,438,148→2,409,796 KiB`，Swap 使用 `3,252→3,252 KiB`，增长 0；没有达到停止阈值。
- PostgreSQL/Web/Worker/Caddy 的 RestartCount 均为 0、OOMKilled=false；内核 OOM 计数 0。
- 临时 PostgreSQL 测试/恢复库、测试/候选/浏览器容器、runner、浏览器端口、任务脚本和 alpha.34 build worktree 已删除。未执行 Docker/Volume 全局 prune；候选当前镜像、旧 Web 回滚镜像和已验证备份有意保留。
- 四个受保护卷和真实业务数据保留；`shujvbiao/` 始终未读取、修改、移动、暂存、提交或删除。
- 代码 Commit `dfa30bf7575a4cd3d06756a626480ca20204cec6`，Parent `5fc1266b70f57e1c5d44464f14f2a615dbeab3e4`，消息 `fix: secure UAT identity writes and logout`。
- 文档/验收提交消息为 `docs: record UAT identity blocker acceptance`，Parent 为 `dfa30bf7575a4cd3d06756a626480ca20204cec6`；该提交不能在自身内容中稳定写自身 SHA，实际值以 Git log 为准。未 amend、rebase、reset、push 或创建 PR。
- 最终要求为 tracked 工作区 clean，只保留获准的未跟踪真实资料目录 `shujvbiao/`；提交后以最终 Git 检查为准。

完成后立即停止，不开始 manager 或任何其他角色业务试用。
