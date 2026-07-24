# SELFHOST-PHASE2-TASK02 身份安全诊断

诊断日期：2026-07-24（Asia/Shanghai）

源码基线：`e8cb7ebc0fa9d45575aeaffc0732183d2533f577`

数据边界：只读源码、Schema、migration 和测试；未访问公开 Site、生产数据库或真实身份数据。

## 1. 已有能力

- PostgreSQL `app_users` 已包含 username、display name、role、PBKDF2 hash、active、must-change、version 和登录时间。
- `app_sessions` 已按 token SHA-256 摘要存储并具备用户/过期索引。
- `audit_log` 已包含 actor、action、request ID、result、operation ID、旧/新 version 和 error code 等通用字段。
- `idempotency_keys` 已包含 key/request digest、actor、method/path、状态码、响应和有效期，可复用为已完成身份响应存储。
- 自托管入口已有 setup、login、logout、session，以及 Material/Import 模块所需的服务端权限投影。

## 2. 必须修复的缺口

1. setup、login、logout、session、密码哈希、权限和 Cookie 全部集中在 `selfhost-api.ts`，没有独立 Repository/Service/Handler 测试边界。
2. 登录失败没有持久限流；inactive、用户不存在和密码错误虽统一返回 `LOGIN_FAILED`，但没有 15 分钟五次门禁和 `Retry-After`。
3. 登录成功会删除该用户全部旧会话，无法支持本人改密保留当前会话、撤销其他会话的明确语义。
4. `app_sessions` 没有撤销时间/原因；已撤销、过期和不存在的 session 无法稳定区分。
5. logout 即使存在有效会话也不校验 Origin/CSRF；session 新发 CSRF Cookie 时缺少生产强制 Secure。
6. Cookie 的 Secure 只由内部 Request URL 是否为 HTTPS 决定，不满足 `ERP_ENV=production` 强制 Secure。
7. 当前密码策略只有 setup 长度下限；没有字符类别、用户名包含、默认/弱口令、长度上限或新旧相同检查。
8. `/api/me/password`、用户列表/创建/启停/重置和系统审计查询在自托管入口缺失。
9. must-change 只在部分业务模块拦写，GET 和其他受保护入口仍可能访问；错误码也不是统一的 `PASSWORD_CHANGE_REQUIRED`。
10. 没有身份写 60 次/分钟、20 个新 Key/分钟的持久限流；没有最后 active admin、禁止自停用/自重置和并发保护。
11. legacy 用户管理前端仍提交 `password`/`version`，本人改密不提交 expected version，也没有把身份写 CSRF 与原幂等操作上下文显式交给共享 Client。

## 3. Migration 结论

现有 user/version/hash、通用审计和完成态幂等响应字段可以复用，不重建这些表。`0006_identity_security.sql` 只需扩展：

- session 撤销时间和安全原因；
- audit 的明确 target username 及筛选索引；
- 持久登录失败窗口；
- 每 actor 的身份写分钟桶；
- 角色、username、display name 和计数的有界约束/必要索引。

不修改 `0001`—`0005`，不回填或迁移真实用户、密码、会话或审计正文。

## 4. 模块方案

- `types.ts`：共享 actor/session/DTO/事务元数据类型。
- `errors.ts`：稳定 code、HTTP status 和中文安全消息。
- `password.ts`：username/display name/password policy、310,000 次 PBKDF2-SHA256 和常量时间验证。
- `permissions.ts`：固定角色白名单及服务端 capability 投影。
- `repository.ts`：PostgreSQL 事务、CAS、最后管理员锁、会话撤销、审计、完成态幂等和持久限流。
- `service.ts`：权限、本人保护、密码和状态业务规则。
- `handler.ts`：精确路由、method、Origin/CSRF、Cookie、正文/query 上限、请求编号和稳定错误。

`selfhost-api.ts` 只委托身份 Handler、接收可信 actor，并在所有受保护业务模块前执行统一 must-change 门禁。
