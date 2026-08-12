# SELFHOST-IDENTITY-SESSION-SAFETY-44 会话绝对寿命、原子认证与超时审计加固

> 状态：`DONE / REPOSITORY AND ISOLATED TESTS VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@0caa565f3954bade15526bbef1e3c3b742b44a17`
> 责任：Codex 主智能体为唯一写者、测试执行者、文档维护者和提交者；既有投产三线审计作为风险输入；项目负责人负责未来 UAT/生产 Migration、部署、账号和员工试用专项授权

## 1. 目标

推进 G4 权限/会话安全门，关闭持续访问可无限续期和认证/撤销竞态：为自托管 Node.js/PostgreSQL 会话增加持久绝对截止时间，以数据库时钟和行锁原子判定撤销、用户状态、idle 与 absolute deadline，超时只终态化和审计一次，并让身份与通用受保护 API 对失效会话返回稳定错误、对称清除 Session/CSRF Cookie。

本任务只修改仓库源码、append-only 0044、自动化测试和文档，并只使用合成身份与隔离 PostgreSQL。不得连接或改变当前非生产 UAT、生产数据、账号、运行容器、镜像、服务或部署身份。

## 2. 已核验缺口与优先级

- `app_sessions`只有可滑动的`expires_at`，没有不可延长的绝对截止；掌握token的客户端可持续访问并把服务端期限反复推进到未来8小时。
- `authenticate()`先SELECT、用Node `Date.now()`判断，再单独UPDATE延长；并发撤销可能使UPDATE零行但旧actor仍被返回，且应用/数据库时钟漂移会改变安全判定。
- 过期会话没有持久终态原因或一次性Audit；`/api/session`只清理已撤销Cookie，EXPIRED和未知token仍会重复发送。
- 通用受保护API对已撤销/过期会话返回401时不对称清除Session/CSRF Cookie。
- 岗位权限矩阵需要业务负责人批准，health/Worker/storage检查是独立运维边界；两者不阻塞本任务但不得借机扩大范围。

## 3. D-118实现边界

- 现有8小时idle期限保留；每个新会话增加创建时固定、不可延长的24小时absolute deadline。服务端续期只能取`least(now()+8 hours, absolute_expires_at)`。
- 0044采用expand/backfill/constraint方式：已有会话absolute deadline回填为`created_at+24 hours`，idle deadline向下夹紧；这会使已经超过24小时的旧会话在升级后失效，是明确的安全切换结果。
- deadline、用户active、撤销状态和续期必须使用PostgreSQL `now()`并在一致锁序下判定；续期零行或状态变化不得返回已认证actor。
- 首次观察到idle/absolute超时的请求把会话原子终态化为`IDLE_TIMEOUT`/`ABSOLUTE_TIMEOUT`并写一条去敏Identity Audit；并发重复请求不得重复审计。
- 对EXPIRED、REVOKED和带未知token的ANONYMOUS响应清除Session/CSRF Cookie；受保护路由分别返回`SESSION_EXPIRED`、`SESSION_REVOKED`或`AUTH_REQUIRED`，不泄露token、摘要、内部SQL或时间细节。
- 0044发布后不可修改；`db/schema.ts`、snapshot、journal、运行查询、release allowlist和空库/0043升级/重放/回滚测试保持一致。

## 4. 验收标准

- [x] 新会话以同一数据库时间写入8小时idle与24小时absolute deadline，数据库约束及不可变guard阻止absolute deadline、identity或created_at被延长/改写。
- [x] 有效访问只把idle deadline续到`min(now+8h, absolute)`；Node时钟不参与授权，absolute deadline永不滑动。
- [x] 认证以用户→会话一致锁序原子核验active/revoked/deadline；并发logout、停用、重置或超时不能在撤销已生效后返回AUTHENTICATED。
- [x] idle与absolute超时分别持久化稳定原因，最多写一条去敏Audit；并发重复请求结果稳定且不重复终态化。
- [x] `/api/session`及普通受保护API对失效/未知token清除两类Cookie；EXPIRED/REVOKED错误码、中文提示、request ID与`no-store`保持稳定，匿名无Cookie不产生副作用。
- [x] 0044覆盖空库升级、0043已有会话升级、老于24小时会话失效、近期会话保留、重复执行、约束、失败回滚、Schema/snapshot/journal一致性；0001—0043 checksum不变。
- [x] Identity unit、handler/UI、隔离PostgreSQL、并发、Migration、相关回归、TASK44 typecheck、lint、release inventory、敏感信息和`git diff --check`通过。
- [x] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`、`ROADMAP.md`、D-118及身份/运维/测试文档，形成源码、manifest-only和治理独立提交链。

## 5. 禁止范围

- 不调整岗位角色或业务权限，不实现MFA/VPN/CSP，不修改密码策略、登录失败阈值或并发会话数量。
- 不修改health/Worker/storage/backup探针，不顺带处理监控告警或容量压测。
- 不读取或修改UAT/生产账号、session、审计、数据库或四卷，不执行UAT/生产Migration、build/deploy/restart或真实登录。
- 不修改0001—0043，不改历史D1身份逻辑，不把浏览器隐藏或Cookie期限当作服务端绝对截止。
- 不修改Swap、systemd、网络、防火墙、Docker daemon，不删除镜像、Volume、备份或业务数据。
- 用户未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 6. 起点证据

- Git：唯一worktree，`main@0caa565f3954bade15526bbef1e3c3b742b44a17`，相对公开origin ahead 239；唯一既有未跟踪文件为受保护状态报告。
- 源码：`0.1.0-alpha.44`、43/head`0043_material_import_terminal_integrity.sql`；UAT沿用文档基线alpha.42/0040，本任务不连接复核。
- 会话实现：idle常量8小时；SELECT后用`Date.now()`判断，再执行不核对rowCount的独立延期UPDATE；数据库无absolute deadline。
- 主机：available约2.0 GiB、Swap439 MiB/1 GiB、根盘31 GiB、Load`1.00/0.60/0.53`；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false，内核当日OOM计数0。
- 团队：新一轮只读子智能体调度因运行器返回`agent thread limit reached`未创建；主智能体基于既有三线投产审计和当前源码只读复核继续，单写者边界不变。

## 7. 完成证据

- Git：源码提交`e7b0298f90ba85a5018709be1360a40dacbbaa59`/tree`43aa32601c8cd5a953de41e48c19f6e9860ed87c`将版本推进到`0.1.0-alpha.45`和0044；其直接子提交`c730fefe0857d2e4546f28364ca53d5e6506d099`只绑定36文件content-addressed supervisor bundle，manifest SHA-256为`ad1a66d3e1c30a4ac18fbdeff1e7d23d70488187826ecbc3ae9ebdf2cc961c86`。本治理收口是第三个独立提交。
- 数据库：append-only `0044_identity_session_absolute_lifetime.sql` SHA-256为`a24df94474403c4f235933d4450626ce65b40416264393db400cef08e7fcaa7e`；0001—0043未修改，Schema/snapshot/journal/allowlist与运行查询一致。
- 验证：最终定向与release合同组合55/55；会话专项PostgreSQL 7/7、既有身份PostgreSQL 10/10、身份升级4/4，合计21/21；官方release Migration harness在已提交源码上退出0；release inventory为232/208/24；supervisor 15/15、TASK44 typecheck、lint 0 error/11个既有warning通过。治理收口另通过只读控制器`IDLE`及134/134回归、Python三基线、99个本地Markdown链接、1,548文件凭据扫描和`git diff --check`。
- 能力结果：会话创建、续期、撤销、停用、重置和超时均使用PostgreSQL时钟及用户→会话锁序；24小时absolute不可滑动，超时只终态化/审计一次；身份与普通受保护API稳定返回错误并对称清除Session/CSRF Cookie。
- 边界：未运行完整110文件Node、82文件PostgreSQL、Browser、完整typecheck、候选build/SBOM/漏洞扫描或18步候选门；未连接或修改UAT/生产、账号、当前四卷、镜像或服务。运行UAT仍为alpha.42/0040，故任务只关闭仓库风险，系统继续`PRODUCTION NO-GO`。
- 资源/清理：最终available约2.0GiB、Swap约442MiB/1GiB、根盘31GiB、Load`0.21/0.21/0.33`；四服务restart0/OOM false、当日内核OOM 0。任务临时容器、测试库和进程清零，四个受保护卷保持。
