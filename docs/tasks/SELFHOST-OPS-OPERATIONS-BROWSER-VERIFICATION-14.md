# SELFHOST-OPS-OPERATIONS-BROWSER-VERIFICATION-14 执行报告

日期：2026-08-04（Asia/Shanghai）

最终状态：`OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION STILL INCOMPLETE`

## 1. 范围与严格起点

本任务只修复离线 targeted browser verifier，并使用当前正式 Canonical 的 operations 凭据执行只读身份验证。没有恢复、生成、修改或报告密码，没有创建 Canonical 候选，没有登录其他角色，没有进入 Supplier Mapping 或任何业务模块，没有执行业务 POST。

起点逐项通过：

- Branch `main`，HEAD `7864905`，Parent `7b95b13`，`origin/main...HEAD=behind 0 / ahead 137`，工作区 clean。
- 源码版本 `0.1.0-alpha.39`，PostgreSQL 38/head `0038_supplier_mapping_governance.sql`，Migration 文件为 0001—0038。
- Canonical 为 Schema v2、validator v2.1、writer v2，10 账号、0 错误、`SCHEMA_PASS`，root:root 0600、单硬链接且无候选。
- operations 唯一，role=operations、active=true、must-change=false、version 7、有效 Session 0；当前 Canonical 密码与数据库强哈希受控内存比对通过。
- Supplier Mapping/RFQ/Quote/Award 为 `0/0/0/0`；`PRQ-00000001` 唯一且为 ACCEPTED；Supplier 1/2 ACTIVE，Material 533—536 ACTIVE/PCS，legacy `base_unit_id` 仍为空。
- 排除身份/系统表的前置业务指纹为 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`，覆盖 217 张业务表和 203 个序列。

任一严格条件均未触发停止门禁。

## 2. Identity 权威登录合同

实际 Handler、类型、repository/service 与既有 Identity 测试共同确认：

- `POST /api/login` 成功返回 HTTP 200、JSON、`ok: true`、结构化 `user`、`setup_required: false` 和 CSRF 上下文。
- `user` 的权威字段包含 `username`、`display_name`、`role`、`is_active`、`must_change_password`、`version` 和 `permissions`。
- `authenticated` 是 `GET /api/session` 的字段，不是 login 成功合同。
- Identity 服务端合同未为 verifier 修改。

旧 verifier 错误要求 login 响应 `authenticated === true`，因此会拒绝真实权威成功响应，也可能接受缺少 `ok/user` 的伪成功。新 login verifier 同时要求：

1. HTTP 状态精确符合成功合同且 Content-Type 为 JSON。
2. `ok === true`，不存在错误代码，且 `user` 为结构化对象。
3. username 精确为 operations 目标账号，role 精确为 `operations`。
4. 若响应包含 active 状态则必须为 true；若包含 must-change 状态则必须为 false。
5. 页面必须进入“经营工作台”，登录页和“请先修改临时密码”页必须消失。
6. 当前用户标签必须与响应的 `display_name`（为空时退回 username）精确一致，角色标签必须为 `operations` 或“运营”。

因此，仅有 `authenticated=true`、HTTP 200 但 `ok=false`、缺 user、错身份或页面仍未认证都不能通过。

## 3. 实现与自动测试

新增纯函数合同模块和专项合成测试，正式 runner 改为从页面填写账号/密码并点击登录，直接验证捕获的 `/api/login` 响应，再验证工作台 DOM 和 `/api/session`。请求白名单只允许 Identity API、根页面/静态资源，以及工作台启动必需的 `/api/summary` 和 `/api/management-dashboard` GET；其他 API、页面、WebSocket 和业务写全部失败关闭。

最终专项 verifier 为 8/8，覆盖：

- 接受最小 `{ok:true,user:{正确 username,role}}`。
- 接受权威合法附加字段。
- 拒绝 `ok=false`、缺 user、错 username、错 role、must-change=true、inactive、只有 authenticated、错误代码。
- 拒绝 HTML、错误 Content-Type、401/403/429/500 和 malformed JSON。
- 拒绝响应成功但页面仍停留登录页，或页面进入强制改密页。
- 校验正式 runner 确实通过页面登录、合同函数、工作台 DOM 和安全退出接线。

其他结果：

- targeted offline recovery unit：5/5。
- legacy offline recovery unit：9/9。
- Identity unit/UI：9/9、10/10。
- `npm test`：3/3。
- Node `--check` 和适用 ESLint：通过；全仓 `npm run lint -- --no-cache` 为 0 error/10 个既有 warning。
- credentials scan：1,205 个仓库文件，通过。
- Python `.venv`：`server.py --self-test`、`smoke_test.py`、隔离临时 SQLite 的 `go_live_check.py --no-backup` 全部通过。
- `git diff --check`：通过。

系统 Python 首次组合执行在 `smoke_test.py` 导入阶段因缺项目依赖停止；该次只完成 self-test，未启动 smoke 服务或执行 smoke 写入。随后使用仓库既有 `.venv` 完整重跑三项并通过。全部合成数据与临时 SQLite 已自动清理，未连接 UAT PostgreSQL。

## 4. 唯一 Chromium 只读 UAT

首次 formal runner 调用在创建网络、Chromium 或 Session 前以 `TARGETED_BROWSER_MODULE_MISSING` 失败关闭。任务恢复 runner 既有的精确 Playwright 1.51.1 临时模块树并通过 root 权限和完整性检查；这次 preflight 没有浏览器流程。随后复用同一 run-id 启动本任务唯一一次实际 Chromium，未再启动第二次浏览器。

唯一实际流程已经通过以下顺序断言，因失败发生在更后阶段：

- login 响应为 HTTP 200 JSON，`ok=true`、user 存在、username 精确命中、role=operations、active=true、must-change=false且无错误代码。
- 页面没有进入强制改密页，已进入“经营工作台”；工作台当前用户标签与响应身份一致，角色显示 operations/运营。现有 Web 明确渲染 `display_name || username`，因此页面证明的是当前身份的 display name 标签；目标账号字符串则由 login/session 的精确 username 断言证明。本任务未修改 Web 以重复显示账号名。
- 认证后的初始页面和受保护历史页面均通过工作台 DOM 与 `/api/session` 复核。
- 未点击任何业务入口；网络门禁未允许 Supplier Mapping 或其他业务模块。
- 页面点击“退出”，服务端将最新验证 Session 以 `LOGOUT` 撤销；最终 operations 有效 Session 为 0。

实际失败为 `TARGETED_BROWSER_LOGOUT_JSON_INVALID`。原因不是 logout 服务端失败，而是页面成功消费 JSON 后立即执行 `location.replace("/")`；Playwright 的 click 等待导航完成后，verifier 再读取原 response body 时，该 body 已随旧文档释放。服务端 `LOGOUT` 和 Session 0 证明退出已提交，但 verifier 尚未来得及执行匿名页和历史 DOM 断言。

因此以下项目不能报告通过：

- 返回登录页：未完成 verifier 断言。
- back 不能恢复工作台：未执行。
- forward 不能恢复工作台：未执行。
- refresh 仍为登录页：未执行。
- 最终受保护 DOM=0：未执行。

任务随后离线修复这个竞态：logout response 只校验可在导航后稳定读取的 HTTP/Content-Type，JSON 是否被页面成功消费以及 logout 是否持久生效，则由匿名登录页、`/api/session` 和 history DOM 共同证明。该补丁的合成测试通过，但严格遵守“一次实际浏览器流程”上限，没有重跑，不能据此追认主 UAT 完成。

## 5. 身份、Canonical 与业务保护

浏览器前后受控比较证明：

- Canonical 字节与 root:root 0600/nlink1 元数据不变；任务后正式诊断仍为 Schema v2、validator v2.1、10 账号、0 错误、`SCHEMA_PASS`，无候选。
- operations password hash、role、active、must-change=false 和 version 7 不变。登录允许产生 last-login/Identity Audit 和一个随后正常撤销的验证 Session；最终有效 Session 0。
- 其他身份账号的受控非敏感/秘密状态未改变。
- 后置业务指纹仍为 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`（217 表/203 序列），与前置相同。
- Supplier Mapping/RFQ/Quote/Award 仍为 `0/0/0/0`；`PRQ-00000001` 仍为 ACCEPTED；Supplier 1/2 与 Material 533—536 保持。
- 业务 POST=0；只发生 Identity login/logout 与工作台只读 GET。

没有修改密码、Canonical、其他账号、业务记录或 Migration，也没有创建新的数据库备份；Recovery-13 正式备份继续保留。

## 6. 部署、资源、Git 与清理

- 未 build、替换或重启 Web、Worker、PostgreSQL、Caddy；未运行 Migration，未改 Compose、Origin、端口或 Volume。
- Web/Worker 镜像保持原值；Web/PostgreSQL healthy，Worker/Caddy running。四服务 RestartCount 0、OOM false；任务期内核 OOM 和服务 restart event 均为 0。
- 起点/终点 available memory 约 2.2/2.2 GiB，Swap 256/256 MiB，根分区可用 20/20 GiB，Load 从 `0.19/0.15/0.11` 到 `0.01/0.10/0.12`。
- 临时 Playwright 模块、Chromium Profile/cache、evidence、runner、合成/Python 临时目录、任务容器和内部网络均清理；浏览器残留进程 0。
- Recovery-13 正式备份与四个受保护 Volume 均保留；未 prune 或删除镜像。
- Git 提交：`1dcfc5a7d93d5f4092d088cecd3cc7c6c744b8b9`（`fix: align identity verifier with login contract`）、`82f29c9157ceea1602969f4301477a7b2d18aa61`（`fix: avoid rereading logout body after navigation`），本报告以 `ops: verify operations UAT identity` 收口。未 push、创建 PR 或改写历史。

## 7. 后续门禁

当前不能开始 purchase 创建并提交八条 Mapping，原因有二：operations logout/back/forward/refresh 的完整浏览器验收仍未完成；Mapping 业务写本身也未由本任务授权。

若继续，必须另立明确任务，只用当前凭据补做 operations 只读 logout/history 验证，禁止再次改密或修改 Canonical。该验证通过后仍需独立 Mapping 授权，才可开始 purchase 创建/提交八条 Mapping；本任务立即停止。
