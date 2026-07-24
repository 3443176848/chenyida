# SELFHOST-PHASE2-TASK02 完成报告

完成日期：2026-07-24（Asia/Shanghai）

状态：`DONE / NON-PRODUCTION / NOT RELEASED / NOT DEPLOYED`

## 1. Git 与版本

- 起始 Branch/HEAD：`main` / `e8cb7ebc0fa9d45575aeaffc0732183d2533f577`。
- 起始状态：工作区 clean，本地 `main` 领先 `origin/main` 2 个提交。
- 完成提交：通过 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK02-completion.md` 解析；提交信息 `feat: add self-hosted identity security`。
- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.1 -> 0.1.0-alpha.2`，同步 lockfile；alpha.2 未发布、未部署、未批准生产。
- 未 reset、clean、rebase、force push、push 或创建 PR；没有覆盖用户既有提交。

## 2. 实施结果

新增 `app/lib/identity-selfhost/` 的 `types.ts`、`errors.ts`、`password.ts`、`permissions.ts`、`repository.ts`、`service.ts` 和 `handler.ts`。`selfhost-api.ts` 不再承载基础身份业务，只负责身份 Handler 委托、可信 Session actor 注入和所有后续受保护模块前的统一 active/must-change 门禁。

已安全重构：

- `POST /api/setup`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`

已补齐并通过隔离 API 测试：

- `POST /api/me/password`
- `GET /api/users`
- `POST /api/users`
- `POST /api/users/status`
- `POST /api/users/reset-password`
- `GET /api/system/audit-logs`

角色固定为十个批准 code，permissions 只由服务端映射。admin-only 管理用户和查询系统审计；所有 active 已认证用户可本人改密。新用户 active/must-change/version 1；禁止修改 username、物理删除、任务内改角色、admin 自停用/自重置及停用最后 active admin。

密码执行 12—128 位、四类至少三类、用户名/项目默认/常见弱口令/新旧相同拒绝；PBKDF2-SHA256 310,000 次与常量时间比较。本身改密校验旧密码和 expected version，保留当前 session 并撤销其他 session；停用和管理员重置撤销目标全部 session，旧 Cookie 对受保护路由立即返回 `SESSION_REVOKED`。

must-change 只允许 session、logout 和本人改密；用户管理、系统审计及 Material/Import 等所有其他受保护接口统一返回 `PASSWORD_CHANGE_REQUIRED`。Session Cookie 为 HttpOnly/SameSite=Lax，CSRF Cookie 非 HttpOnly/SameSite=Lax；production 即使内部 URL 是 HTTP 也强制两类 Cookie Secure。有效 session logout 要求严格 Origin/CSRF。

登录失败按标准化 username digest 持久化 15 分钟/5 次门禁并返回安全 Retry-After；成功登录清理该 username 计数。身份写持久化每 actor 60 attempts/20 new keys/min；完成重放不计新 Key。四个 POST 的持久幂等 scope 包含 actor/method/route/target/key digest；相同 canonical 请求重放，异正文冲突。创建/启停/重置/改密的业务变化、版本、会话撤销、审计和幂等响应同事务提交或回滚。

系统审计默认 20、最大 100，支持 actor、target username、action、result、from/to 服务端筛选；只返回最小 DTO。审计与错误不含密码、Token、Cookie、password hash、原 Key 或完整正文，数据库异常不会返回浏览器。

## 3. PostgreSQL migration

新增 expand-only `drizzle-postgres/0006_identity_security.sql`、`meta/0006_snapshot.json` 和 journal entry，并同步 `db/schema.ts`。它增加登录失败表、身份写分钟桶、session 撤销字段/约束、audit target username、必要索引和用户格式/角色约束；复用 `app_users`、`app_sessions`、`audit_log`、`idempotency_keys`，没有重建表或迁移真实用户。

- `0006` SHA-256：`6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`。
- `0001`—`0005` checksum 全部与任务起始/`RELEASES.md` 一致，没有修改。
- 空库 `0001 -> 0006`、已记录 `0005 -> 0006`、重复 runner、故障事务回滚、CHECK/唯一/索引通过。
- 合成旧 user/session 升级后保持有效；旧 session 未被迁移静默删除。非法 legacy role 会使 0006 整体回滚，修正数据后可安全重试。

## 4. 前端兼容

现有身份交互改用 `temporary_password`、`expected_version`、CSRF 和页面内存 Idempotency 操作上下文。未知结果只可用原 key/原不可变请求重试；密码、token、key 不进入 localStorage、sessionStorage、URL 或日志。新增 must-change、version/幂等冲突、限流和 session 撤销处理。management-dashboard/backups 缺失时明确降级，没有在本任务实现 Dashboard 或备份 API。

## 5. 测试结果

所有 Node 验收均使用 Node 22；数据库测试使用 TASK02 专用一次性 PostgreSQL 17，数据库名包含 `test`。

| 测试 | 结果 |
| --- | --- |
| Identity unit | PASS 8/8 |
| Identity UI contract | PASS 4/4 |
| Identity PostgreSQL/API | PASS 8/8 |
| Identity migration upgrade | PASS 4/4 |
| Identity Compose lifecycle | PASS；setup、admin login、purchase 创建/首次登录、must-change、改密、Material read、停用/撤销、启用/重置、再次 must-change、系统审计 |
| Identity Compose restart | PASS；Web/PostgreSQL 重启后 user/version 5、审计 8 条及撤销状态持久 |
| npm 基础/FileStorage | PASS 3/3 |
| Phase 0 PostgreSQL/Worker | PASS 5/5 |
| Material | PASS：unit 6/6、UI 2/2、PostgreSQL 7/7 |
| Mapping | PASS：unit 3/3、UI 2/2、PostgreSQL 6/6、upgrade 1/1 |
| Normalization | PASS：unit 4/4、UI 3/3、PostgreSQL 4/4、upgrade 1/1 |
| Review | PASS：unit 7/7、UI 3/3、PostgreSQL 3/3 |
| TypeScript/lint/build/security | PASS；lint 保留 1 个任务前 unused warning，0 error |
| Python/SQLite | PASS：项目虚拟环境 self-test、smoke、临时 SQLite go-live `--no-backup` |
| Git checks | PASS：`git diff --check`、最终凭证扫描和变更范围核验 |

并发测试覆盖同 username 创建唯一性和两个 admin 同时停用仍至少保留一个 active admin；故障注入覆盖 user/audit/idempotency 无半提交，身份写限流计数独立保留。审计、幂等 DTO 和错误响应均验证不含测试密码或 Token。

## 6. 文件范围

- 身份运行时：`app/lib/identity-selfhost/*`、`app/lib/selfhost-api.ts`。
- Schema/migration：`db/schema.ts`、`drizzle-postgres/0006_identity_security.sql`、`drizzle-postgres/meta/0006_snapshot.json`、journal。
- 前端：`public/erp/api-client.js`、`public/erp/app.js`。
- 测试/脚本：四个 `selfhost-identity-*` 测试、`selfhost-identity-compose-smoke.mjs`、两个旧 PostgreSQL migration 清单断言、package scripts。
- 版本/文档：package/lock、TASK02 任务/诊断/完成、身份安全说明及项目 MASTER/TASKS/CONTEXT/DECISIONS/ARCHITECTURE/RELEASES/ROADMAP/CHANGELOG/STATUS/迁移计划。

## 7. 未完成与生产边界

- 未实现客户、供应商、产品、BOM、库存、采购、生产、销售、品质、财务、Dashboard 或备份。
- legacy iframe 登录后的 23 个业务 GET 仍未迁移；operations 只接通 users，Dashboard/backup 明确降级。
- 未升级依赖或处理既有 npm audit 风险。
- 未访问公开生产 Site、生产 D1、生产 PostgreSQL 或其他生产数据库；未迁移真实用户、密码、session、审计或业务数据。
- 未修改、重启或重新部署 Python systemd；未部署 Node/PostgreSQL。
- TASK02 Compose 和独立 PostgreSQL 测试容器、网络、卷已删除，测试数据不可恢复且不影响任何生产/非任务资源。
