# 自托管身份安全边界

状态：`IMPLEMENTED IN NON-PRODUCTION`

适用版本：身份基线始于 `chenyida-erp-selfhosted@0.1.0-alpha.2`；2026-07-29 的 `SELFHOST-OPS-UAT-BLOCKER-FIX` 已作为 alpha.34 运行面聚焦 hotfix 部署到当前非生产并行环境，源码主线仍为 alpha.35。

## 1. 运行边界

自托管身份由 `app/lib/identity-selfhost/` 独立实现：Handler 负责精确路由、method、正文/query 上限、Origin/CSRF、Cookie、Idempotency-Key、稳定错误和请求编号；Service 负责密码、权限、本人保护、最后管理员及状态规则；Repository 负责 PostgreSQL 事务、CAS、会话撤销、审计、幂等和限流。

`selfhost-api.ts` 先委托身份路由；其他受保护路由统一从 Session 解析服务端 actor，再执行 active 和 must-change 门禁后注入 Material/Import 模块。浏览器只能提交 role code，不能提交 permissions、通配权限、hash 或 token。该链路不导入 Python/SQLite、D1、Miniflare、Cloudflare 或 Sites binding。

## 2. 角色与接口

允许角色固定为：`admin`、`manager`、`purchase`、`engineering`、`production`、`warehouse`、`quality`、`sales`、`finance`、`operations`。permissions 由服务端静态映射；只有 admin 可读取用户、创建用户、启停用户、重置他人密码和读取系统审计。所有 active 已认证用户可修改本人密码。

| Method | Route | 权限/说明 |
| --- | --- | --- |
| POST | `/api/setup` | setup token；只允许空用户库初始化首个 admin |
| POST | `/api/login` | 统一 `LOGIN_FAILED`；持久失败限流 |
| POST | `/api/logout` | 有有效会话时要求 Origin/CSRF；撤销当前会话并清 Cookie |
| GET | `/api/session` | 匿名/有效/过期/撤销状态；must-change 允许 |
| POST | `/api/me/password` | active 本人；旧密码、expected version、CSRF、幂等 |
| GET/POST | `/api/users` | admin；列表或创建 |
| POST | `/api/users/status` | admin；expected version；禁止自停用/最后 admin |
| POST | `/api/users/reset-password` | admin；禁止重置自己；expected version |
| GET | `/api/system/audit-logs` | admin；默认 20、最大 100，有界筛选 |

## 3. 密码、用户和并发

- username 创建时标准化为小写，必须为 3—32 字符、小写字母开头，仅含小写字母、数字、点、下划线和连字符；创建后不可修改。
- display name trim 后必须为 1—128 字符且不含控制字符。
- 密码 12—128 字符，大写、小写、数字、特殊字符四类至少三类；拒绝完整 username、项目默认密码、常见弱密码及新旧相同。
- hash 格式为 `pbkdf2_sha256$310000$<salt>$<digest>`；只接受不少于 310,000 次的合法格式，使用常量时间比较和不存在用户 dummy hash。
- 新用户由 admin 提供临时密码，服务端不生成、不回显、不记录；新用户为 active、must-change、version 1。
- 本人改密校验旧密码和 expected version，清除 must-change、version + 1，保留当前 session 并撤销其他 session。
- 管理员重置设置 must-change、version + 1 并撤销目标全部 session；启停使用 CAS，停用撤销全部 session，启用不创建 session。
- 最后 active admin 通过事务 advisory lock、`FOR UPDATE`、active admin 计数与 CAS 保护；用户名唯一由数据库约束和稳定 `USERNAME_EXISTS` 映射保护。

## 4. Session、Cookie 与门禁

随机 Session Token 仅送入 HttpOnly Cookie；数据库只保存 SHA-256 摘要。`app_sessions.revoked_at/revoked_reason` 明确区分 logout、inactive、deactivation、reset 和 own-password-change。过期/不存在返回认证失败，已撤销旧 Cookie 对受保护 API 返回 `SESSION_REVOKED`。

Session Cookie 为 `HttpOnly; SameSite=Lax`；CSRF Cookie 为 `SameSite=Lax` 且可由浏览器读取。`ERP_ENV=production` 时，即使内部 Request URL 为 HTTP，两类 Cookie 都强制 `Secure`。有效 session 的 logout 和所有身份写执行严格同源 Origin 与双提交 CSRF。

公网来源由规范化的单值 `ERP_PUBLIC_ORIGIN` 精确限定；生产部署类别只接受显式配置的可信 HTTPS Origin，不信任 `Host`、`Forwarded` 或 `X-Forwarded-*` 推导来源。当前 UAT 还需兼容 SSH 隧道和受控浏览器转发的动态回环端口，因此只有同时显式设置 `ERP_DEPLOYMENT_CLASS=uat` 与 `ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true` 时，才额外接受严格字面量 `localhost`、`127.0.0.1` 或 `[::1]`。该例外要求浏览器 `Origin` 和请求 URL 的 origin 都是 HTTP(S) 回环；未知域名、外部 IP、单边回环、带凭据或非 HTTP(S) URL 均继续拒绝。生产部署类别不能启用该例外。

经营工作台和兼容工作台统一调用 `public/erp/api-client.js` 的安全退出函数：固定 `POST /api/logout`、`credentials: same-origin`，并从 CSRF Cookie 发送匹配 Header。只有服务端返回成功、事务撤销 Session、写入成功审计并返回对称的 Cookie 清理头后，页面才清理本地状态并跳转登录页；失败时保留当前状态并显示稳定错误码和中文提示，不再吞错或伪装退出。匿名重复退出保持幂等成功，不产生 500。

must-change 账号只允许 `GET /api/session`、`POST /api/logout`、`POST /api/me/password`；其他身份或业务 API 在服务端统一返回 `403 PASSWORD_CHANGE_REQUIRED`。

## 5. 限流、幂等与审计

登录失败以标准化 username 的 SHA-256 digest 为 key，使用 PostgreSQL 15 分钟窗口；第五次失败后后续尝试返回 `429 RATE_LIMITED` 和 1—900 秒安全 `Retry-After`，成功登录清除该 username 的失败计数。不使用 X-Forwarded-For 作为唯一边界。

身份写每 actor/分钟最多 60 次尝试和 20 个新 Idempotency-Key。四个身份 POST 的 scope digest 包含 actor、method、route、target username 和原 key digest；request digest 使用排序后的 canonical JSON。相同 scope/body 重放保存的状态码和 DTO并设置 `Idempotency-Replayed: true`；不同正文返回 `409 IDEMPOTENCY_CONFLICT`。完成重放在计数前命中，因此不计新 Key。

创建、启停、重置和本人改密的业务变化、版本、会话撤销、审计和幂等响应在同一事务提交或回滚。审计记录 actor、action、target、result、request/operation ID、old/new version、error code 和时间；不记录密码、Token、Cookie、hash、原 Idempotency-Key 或请求正文。查询只返回最小 DTO，并支持 actor、target、action、result、from/to 服务端筛选。

## 6. PostgreSQL `0006`

`0006_identity_security.sql` 是 expand-only migration：增加登录失败窗口表、身份写分钟桶、session 撤销字段与约束、audit target username、身份查询索引及用户格式/角色约束。复用既有 `app_users`、`app_sessions`、`audit_log` 和 `idempotency_keys`，不重建表、不自动回填或迁移真实身份数据。

SHA-256：`6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`。历史 PostgreSQL `0001`—`0005` checksum 保持不变。

## 7. 运维与后续限制

身份基线及本次来源/退出聚焦修复已部署到当前 `chenyida-erp-parallel` 非生产环境；这不是生产发布。运行面仍为 alpha.34/0034，本次没有新增、修改或运行 Migration，alpha.35/0035 仍未部署。任何生产 migration、域名/Origin 切换或正式投用仍需快照、真实旧角色预检、受控试迁移、容量/安全验收和明确授权。身份模块不解决 Dashboard、备份、客户、供应商、产品、BOM、库存、采购、生产、销售、品质或财务；这些域不得通过扩展身份模块绕过独立任务。
