# SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 完成报告

## 最终结论

`PLANNING CSRF AND RELEASED BOM IMMUTABILITY FIXED — UAT HANDOFF NOT CREATED`

Planning Handoff 写请求已统一进入当前会话双提交 CSRF 共享客户端；RELEASED BOM 在前端只显示不可变事实，服务端对行新增、修改和删除统一 fail closed；BOM 页初次进入不再自动披露第一条历史 BOM 明细。

完整 Planning 写旅程只在全新隔离 PostgreSQL 0034 和合成账号/项目中执行。主库只允许 engineering 登录、只读查看和退出；没有登录 planning，没有点击保存解析、生成、提交或任何 BOM 写动作。

## Git 与范围

- 起点：`main@3cb5c38bcfc9502bfb41cdd5d1aeec5f869722e8`，Parent `b66e742abe866aa7e1644c09c4fc28efb5e373e4`，`origin/main...HEAD = behind 0 / ahead 103`，工作区 clean。
- CSRF 功能提交：`2b923da44d94567e5e23fd0f428d9d3b5e7f506e`，`fix: use current csrf token for planning writes`。
- BOM 功能提交：`fbaf34a001a976dfcb307da4bcf8e3730d5cb1ca`，`fix: enforce released bom read-only ui`。
- 代码、隔离验收与部署完成时 HEAD 为 `fbaf34a001a976dfcb307da4bcf8e3730d5cb1ca`，此时 `origin/main...HEAD = behind 0 / ahead 105`；文档与运维验收以本报告所属的独立 `ops: accept planning csrf and bom immutability fixes` 提交收口，提交后应为 `behind 0 / ahead 106` 且工作区 clean，其最终 SHA 由提交后的 `git log` 和 `git status` 给出（提交不能自包含自身 SHA）。
- 未 amend、rebase、reset、stash、restore、push 或创建 PR；既有历史未改写。
- 未读取、修改或提交 `shujvbiao/` 及任何工作簿。没有将账号、密码、Cookie、Token、数据库正文、备份或 env 写入 Git。
- 没有修改 `db/schema.ts`、`drizzle-postgres/`、package/lockfile 或 Compose；没有新增 0036、修改 0035 或应用任何 Migration。

## CSRF 精确根因

Planning React 页面原本已向共享 `api()` 传入 `protectedWrite`，因此问题不是页面忘记配置 `credentials`，也不是 `X-CSRF-Token` 名称拼错。共享客户端的 protected-write 路由分类只识别一般 Project 路由，没有匹配：

- `/api/projects/{id}/requirement-resolutions`
- `/api/projects/{id}/planning-packages`
- `/api/planning-packages/{id}/submit|accept|return`
- 同模块的 Material Requirement、Purchase Request 和 Production Handoff 写路由

这些请求因而落入普通 POST 分支：固定的 `credentials: same-origin` 仍然存在，但调用方提供的 CSRF Token 和 Idempotency-Key 被丢弃，没有发送 `X-CSRF-Token`，并被换成临时随机幂等键。所以三次重新登录都会继续失败：Session/CSRF Cookie 虽然已换新，但 Header 始终根本没有发出。回环 UAT 和公网 HTTPS 使用同一错误的 Planning 客户端路径；旧/未知 Origin 则会更早被服务端来源门禁拒绝。

## 共享客户端与 Token 生命周期

`public/erp/api-client.js` 现在显式识别所有 Planning 写路由，并提供共享 `sessionPost()` 上下文。Planning 的保存解析、生成交接包、提交、退回后修订/重提及同模块后续写路由不再直接管理 fetch。

1. 每次发送都从当前 `CYD_ERP_CSRF` Cookie 重新读取 Token，而不把页面初始 `/api/session` 值当成长期权威。
2. 请求固定使用 POST、`credentials: same-origin`、`X-CSRF-Token`、`Idempotency-Key` 和 `X-Request-Id`。
3. 页内 Idempotency-Key 以当前 CSRF Session 标识、method/path 和排序后 canonical JSON 正文绑定。仅在 `RESULT_UNKNOWN` 且同会话/同正文时保留以供安全重放；明确成功或失败后删除。
4. Cookie 变更、logout、Session 撤销、重新登录、认证失效、pagehide 或历史恢复会清空旧操作上下文；不写 localStorage/sessionStorage。
5. 客户端缺失当前 Token 时先返回稳定 `PROTECTED_WRITE_CONTEXT_REQUIRED`；服务端仍是最终权威。
6. Planning UI 错误同时显示中文消息、稳定 error code 和 request_id。

## 服务端安全未放宽

- Planning 写路由仍只接受 POST（GET 只读路由保持），并在解析正文、检查权限和调用业务服务之前执行现有 CSRF 校验。
- Cookie/Header 缺失或不一致仍为 `403 CSRF_INVALID`；旧 Session Token 在 logout→login 后无法使用。
- 公网仍只接受精确 `https://43.135.148.43.nip.io:18888`；只有显式 UAT 类别才接受浏览器与 Request URL 均为字面量 loopback。旧公网和未知 Origin 拒绝。
- 不信任 `Forwarded`、`X-Forwarded-Host`、`X-Forwarded-Proto` 或其他客户端转发头。
- Session、must-change、permission、rate limit、幂等、CAS、事务和 Audit 合同未改变。
- 错误日志仅保留 event/request_id/code；不记录 Token、Cookie、幂等原值或敏感请求正文。

## RELEASED BOM 前后端不可变

前端现在以所选当前 BOM Version 状态决定详情模式：

- RELEASED 时显示“已发布，只读；如需修改请创建新版本”。
- Material 搜索/候选、行号、数量、损耗率和工序输入不渲染为可编辑控件。
- “加入明细”、编辑、删除、保存和发布动作不可操作；真实浏览器验收中可变控件数为 0。
- 切换 BOM 时会撤销迟到请求并清空旧 DRAFT Material 候选、选择和输入，不把草稿状态带入 RELEASED 详情。
- RELEASED 四行只以文本事实显示，DRAFT 在具备 `master.bom.manage` 时仍可按原合同编辑。

服务端新增 BOM Line PATCH/DELETE 路由，使“DRAFT 允许、RELEASED 拒绝”可经真实 HTTP 合同验收。新增、修改和删除在同一 Repository 事务中锁定 BOM Header、Version 和 Line；非当前 DRAFT 统一返回 `409 BOM_RELEASED_IMMUTABLE`。隔离测试证明失败时 Line、Header/Version version、Event 和成功 Audit 均没有部分写入。`0007` 既有 RELEASED Line INSERT/UPDATE/DELETE trigger 没有放宽或替换。

## BOM 默认最小披露

- 初次进入 BOM 管理页时 `selectedBomId` 为空，页面固定显示“请选择或搜索 BOM”，不请求 `/api/bom-lines`。
- `GET /api/boms?q=&limit=` 只返回有界 BOM Header/Product 摘要，支持 BOM 编码、Product 编码和 Product 名称；不通过读入全量明细实现搜索。
- 只有用户明确选择搜索结果后才读取对应 BOM Line，不改变有权用户的主动查询范围。
- 桌面和 390px 视口的搜索、选择、只读提示和表格均可用，没有整页横向溢出。

## 自动验证

所有写测试均使用隔离 PostgreSQL 和合成数据，严格串行：

- 当前 alpha.36 源码：Identity 10/10、Project 3/3、Planning 3/3、Master/BOM 6/6、Material 7/7、operations review 4/4、Dashboard 2/2；TASK09 标准化 14/14。
- 当前关联 unit/UI/handler/API 回归通过。首次组合 coverage runner 因测试容器未挂载 `/docs` 出现 139/140 的单项 harness 失败；补齐同一真实路由后 coverage 2/2 通过，没有降低业务断言。
- 当前源码 project/planning/review/dashboard/standardization/production-routing typecheck 通过；Schema consistency 为 218 tables/无变更；lint `0 error / 10 warnings`；alpha.36 buildcheck 通过。
- alpha.34 兼容源合同 140/140；Identity+Project+Planning PostgreSQL 16/16，Master/BOM+Material+operations+Dashboard 19/19；project/planning/review/dashboard/production-routing typecheck、209-table Schema consistency、lint `0 error / 9 warnings`、build 和 1,030 个可见稀疏文件 credentials scan 通过。
- 两套 lint 都为 0 error；warning 为 hook dependency 提示与既有警告，没有被误报为零 warning。
- Python：`server.py --self-test` 通过；宿主首次 `smoke_test.py` 因未安装 `openpyxl` 在测试前停止，按仓库 requirements 创建临时 venv 后完整运行并得到 `SMOKE_TEST_OK`；隔离临时 SQLite 的 `go_live_check.py --no-backup` 通过。venv/SQLite 已精确清理，未操作 Python 常驻服务。
- 最终稀疏 credentials scan 实际检查 1,108 个 repository files，敏感范围复核和 `git diff --check` 通过；扫描明确排除 `shujvbiao/`、工作簿和业务治理资料目录，没有为扫描而读取被禁内容。

## 隔离 0034 真实浏览器写旅程

兼容候选镜像以全新 0034 数据库、合成 engineering/planning 账号、合成 Project/Product/BOM 和真实 Chromium 完成：

- 正确当前 Cookie/Header 写入成功；缺失、错误和旧 Session Token 拒绝。
- logout→login 后只有新 Token 可用。
- 严格 UAT loopback 和当前公网 HTTPS Origin 合法；旧公网、未知 Origin 与伪造 Forwarded 不能放行。
- 共享客户端完成保存 Resolution→生成 Package v1→submit→planning return→engineering 修订 v2→resubmit→planning accept。
- 同正文幂等重放、异正文冲突和 CAS 保持。
- DRAFT BOM 依权限可编辑；RELEASED 前端可变控件 0、服务端增改删拒绝且零半记录。
- BOM 页初始 line request 0，明确选择后 1，code-first Material 选择器和 Product/BOM/Planning 稳定 ID 关系保持。

最终安全摘要为：共享受保护写 18、Planning 写 11、CSRF Cookie/Header 匹配 18；Package v1 `RETURNED`、v2 `ACCEPTED`；BOM Line 4；视口 390px。隔离测试库、容器和包含合成凭据的 runner 随后全部删除。

## 备份与隔离恢复

- 备份：`/var/backups/chenyida-erp/SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05/postgresql-20260731T022228Z.dump`
- 大小/权限：2,027,218 bytes，0600，`root:root`。
- SHA-256：`b30fa30408da026bd4114a52011e56485956fb72529e6e3467dfa5e4d5aa0d44`。
- restore list：298,566 bytes，0600，3,065 行，213 个 TABLE DATA 项。
- `pg_restore --single-transaction` 恢复到独立新库，核对 34/head 0034、210 张表、项目/产品/BOM/四行、Planning resolution/package 0、三条历史 Planning `CSRF_INVALID` 失败证据与 533—536 不变后删除恢复库。
- 该备份是部署前同机 root-only 可恢复点，不冒充已完成异机灾备。

## alpha.34/0034 兼容构建与部署

兼容源从 alpha.34 基线 `cda8c7eebf93d1ba3b558a700b535dbf00fd92b2` 开始，只按 parent→commit 白名单顺序重放已部署 Origin/CSRF/logout、operations 审核、审核详情、Dashboard/no-store、BOM code-first 及本任务两个提交的精确差异。

- 兼容差异 46 个文件，binary patch SHA-256 `b842ae9cbbb74b7b5a383b6d062fc500746361a0b53a46f551085d25e1`。
- package 仍为 `0.1.0-alpha.34`，仅 34 个 Migration/head `0034_supplier_receipt_lot_iqc.sql`。
- `package.json`、`package-lock.json`、`db/schema.ts` 和 `drizzle-postgres/` 与 alpha.34 基线完全一致。候选树不含 0035、0036、TASK09 标准化模块或完整 alpha.36。
- 候选镜像/部署镜像：`sha256:7e0a3040acd17277db49fc1b7541c072c566e95e12b70bce9170dd39165a6bde`。
- 部署前 Web：`sha256:cb6a5c1fae89608e07e72d458b4466e0b571e36374b16f3b592248280f8dc6e1`，已保留为 `chenyida-erp-parallel-web:rollback-fix05-predeploy-20260731T022228Z`。
- 只以 `--pull never --no-build --no-deps --force-recreate --wait web` 替换 Web；新 Web 容器 `a338ebc5a865...`。PostgreSQL `f3a2f3cb32f4...`、Worker `fb68d9a81b87...`、Caddy `c209765be0b4...` 容器 ID 未变，三者未重建。
- PostgreSQL 仍为 34/head 0034；内部 `127.0.0.1:3000/api/health` 与公网 HTTPS health 通过。
- `ERP_PUBLIC_ORIGIN` 保持 `https://43.135.148.43.nip.io:18888`，没有恢复旧 IP/Origin。

## 部署后主库只读验收

真实 Chromium 使用当前 engineering 账号和当前公网 Origin。测试路由层主动阻断除 `/api/login` 和 `/api/logout` 外的全部 POST，以防脚本偏差产生主库业务写。

- BOM 页初次进入的 `/api/bom-lines` 请求数为 0，没有显示任何历史 BOM 详情。
- 搜索并明确选择 `BOM-UAT-BB-PROD-042576-V1` 后只读显示 RELEASED、提示文案和四行 533—536；可变控件数 0，UI 选择动作的明细加载请求数 1。验收脚本随后另用一次只读 GET 核对响应中的精确行号、material_id、数量、单位和损耗率。
- 390px 视口工作台无整页横向溢出。
- engineering Planning 页识别 Product Version `A0`、BOM Version `V1` 和对应 BOM code；没有点击保存解析、生成或提交。
- 没有使用 planning 账号或登录 planning。
- 安全退出后，back、forward 和 reload 均保持匿名。
- 实际 POST 路径精确为 `[/api/login, /api/logout]`；新增 Audit 精确为 1 LOGIN/success 和 1 LOGOUT/success，对应 Session 为 1 revoked/0 active。

## UAT 数据前后证明

| 对象 | 部署前/备份恢复 | 最终主库 | 结论 |
| --- | --- | --- | --- |
| Project 1 / `PRJ-00000001` | ACCEPTED，requirement v1，数量 10 | 相同 | 未变 |
| Product 7 | `UAT-BB-PROD-042576`，ACTIVE，current version 1 | 相同 | 未变 |
| Product Version 7 | A0 / RELEASED | 相同 | 未变 |
| BOM Header 7 | `BOM-UAT-BB-PROD-042576-V1`，ACTIVE，current version 1 | 相同 | 未变 |
| BOM Version 7 | V1 / RELEASED，product_version_id 7 | 相同 | 未变 |
| BOM Line | 10/533、20/534、30/535、40/536；均 1 PCS，loss 0 | 相同 | 未变 |
| Material 533—536 | 编码、名称、ACTIVE、version 3 与 BOM 稳定引用一致 | 相同 | 未变 |
| Planning Resolution/Package/Item/Event | `0/0/0/0` | `0/0/0/0` | 未创建 Handoff |
| 历史 Planning CSRF 失败 | `PLANNING_HANDOFF_REQUEST/failed/CSRF_INVALID = 3` | 3 | 未删除或改写 |

全库最终为 34/head 0034，Material/Product/Product Version/BOM Header/BOM Version/Line 计数 `536/7/7/7/7/320`。本任务的主库增量仅为允许的登录/退出 Session 与对应成功审计。

## 资源、容器与清理

- 起点约 2.2 GiB available memory、196—197 MiB Swap、29 GiB 根盘可用，Load 低于停止阈值。
- 部署、最终扫描及清理后为约 2.3 GiB available、223 MiB Swap、28 GiB 根盘可用、Load `0.12/0.14/0.17`。Swap 从未在 60 秒增长超过 256 MiB，Swap 使用远低于 80%，根盘可用远高于 10 GiB。
- 所有 Node 重任务、PostgreSQL 测试、build、dump/restore、Compose Web 替换和浏览器均串行；任一时刻只有一个临时测试/构建容器。
- 最终 Web/PostgreSQL restart 0、OOM false 且 healthy；Worker/Caddy restart 0、OOM false 且 running；任务时段内核 OOM 记录 0。
- 隔离测试库、备份恢复库、临时浏览器容器、候选服务容器、runner/合成凭据、临时 venv/SQLite、Playwright 镜像、alpha.34 worktree 和 candidate tag 已精确清理。
- 保留当前部署 Web 镜像、精确旧 Web 回退 tag 和 root-only 备份。未执行 `docker system prune -a`、`docker volume prune` 或任何广泛 cache prune；四个受保护持久卷未删除或替换。

## 后续使用决定

Planning CSRF 客户端 blocker 和 RELEASED BOM 不可变/默认披露 blocker 已解除，技术上可以重新开始 engineering Planning Handoff 试用。但本任务按指令在验收后立即停止，不自动继续 UAT；后续试用应由项目负责人重新授权，并继续以现有 Product/BOM/四行为不可变起点。本报告不授权 0035、alpha.36、生产 Migration/部署、凭据轮换或其他业务动作。
