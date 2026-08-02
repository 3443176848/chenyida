# 晨亿达ERP变更日志

本文件记录可审计的项目变化。每个任务提交前必须增加一条记录，包含 Git Commit、功能、数据库、API 和文档影响。当前提交无法在自身内容中稳定写入自身哈希，因此使用“任务编号 + 提交消息”作为本条标识，实际哈希以 `git log` 为准。

## 2026-08-02

### SELFHOST-OPS-UAT-PLANNING-HANDOFF-CONFIRMATIONS-FIX-14 - `fix: complete planning handoff confirmations` / `ops: accept handoff confirmation fix`

- Git/范围：从 strict clean `main@9c2a7ea436e9b8b5e95ad8eb82e52a43090b109a`、behind 0/ahead 119 起步；只修改 Planning Handoff 确认界面、前端提交保护、测试、只读主 UAT runner 和项目文档。功能提交 `f19a91b680a58150378626d4800e9fb0af12f484`；未 push/PR、改写历史、读取/修改 `shujvbiao/`，未修改 Package、Event、业务数据、Schema、Migration、package 或版本。
- ACCEPT 确认：窗口内完整显示 PRJ-00000001、目标 Package 2/v2/SUBMITTED/摘要/提交人/RESUBMIT 时间、前驱 1/v1/RETURNED/RETURN Event 2/操作者/上海时间/请求号/完整原因、Response 1/v1/操作者/时间/请求号/完整正文，以及 A0/V1/Unit Resolution v1/件·PCS/四项 10 PCS 不可变 v2 快照。后果明确为单 ACCEPT、v2 ACCEPTED、v1 继续 RETURNED、终态不可重复，以及不创建采购申请/工单/库存/财务。
- RESUBMIT 确认：窗口内显示项目、源 v1、RETURN Event/原因、Engineering Response、目标 v2、Product/BOM/Unit Resolution、四项物料与数量、提交后进入计划部待接收队列且不自动创建下游单据；仅在隔离环境执行写验收，主 v2 未重放。
- 流程依据：沿用 D-059 的“ACCEPT 只形成交接事实、不自动启动下阶段”和 D-060/TASK03 的“最新 ACCEPTED Package 供计划部门做物料需求计算/缺料分析，再经独立操作形成采购需求交接”。确认窗同时明确当前无具体处理人、无时限、接收本身不自动执行下一阶段；未新增 ADR。
- 交互/权限：共享可访问模态框默认焦点为取消，焦点约束、ESC/关闭/背景关闭等价取消，固定底栏与 390×844 换行/无页面横向溢出通过；同步 ref 防双击、按钮立即禁用、稳定 Package DTO/ID、无自动重试。服务端既有权限、CSRF、Origin、CAS、幂等、状态和对象范围门禁保持；越权 403、过期状态 409。未增加 `system.audit.read` 或业务权限，全局跨角色导航债务继续为 HIGH。
- 测试：Planning UI 12/12、Planning/Identity/CSRF/Origin 静态回归 35/35、Planning PostgreSQL 12/12、0037 Migration 4/4、Identity PostgreSQL 10/10、隔离 Chromium 1/1，共 74/74；另有 Python self-test/smoke/隔离 go-live 3/3、typecheck、production build 和 lint 0 error/10 既有 warning。隔离浏览器完成 RETURN→Response→v2，RESUBMIT 与 ACCEPT 各自取消/关闭/ESC 零业务请求后双击确认，最终各只有一个事件；v1 RETURNED、无下游记录。
- 备份/恢复：pre-deploy custom dump `/var/backups/chenyida-erp/handoff-confirmation-fix-20260802T1510Z.dump` 为 root:root 0600、2,179,303 bytes、SHA-256 `518bf47f797ff2e4817458b5c7e5e4090b0f8aaf77519c80c5c1598e9690efee`；标准 `pg_restore --list` 3285 项与第二新空库恢复通过，恢复库 37/head 0037/checksum、主 UAT 对象和业务指纹一致后已删除。
- 部署/主 UAT：只替换 Web `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25→sha256:a6327f593a6d084c609127e1bdb09e60b2bd07ff6a2c85213b36f1315c622a78`；PostgreSQL、Worker、Caddy 未重建，四服务 restart 0/OOM false。主 UAT 只用 planning 在 390×844 打开 Package 2/v2 ACCEPT 窗并取消，页面业务 POST 0、当前 Session 正常 LOGOUT；未登录 engineering。保护指纹前后均为 `5ddca35cab36890c20b88ecadc758a32bd60b87e2a136c477d8fde6c7e4538c2`，v1/v2 为 RETURNED/SUBMITTED，Response/RETURN/RESUBMIT/ACCEPT/v3 `1/1/1/0/0`，物料需求计划/采购需求 0。
- 资源/清理：全部重任务串行、一次一个临时容器；约 2.2 GiB available、Swap 252→258 MiB、根盘 22 GiB、低 Load，未触发门槛，内核 OOM 0。隔离数据库/恢复库、测试容器、候选提取目录和一次性 Python venv/SQLite 均精确清理；正式备份、当前/回退 Web 镜像与四个受保护 Volume 保留，未 prune。
- 结论：`HANDOFF DECISION CONFIRMATIONS FIXED — UAT V2 STILL SUBMITTED`。确认窗口阻断已解除，可在下一次明确授权后重新开始 planning 最终接收；本任务停止，不 ACCEPT、不创建物料需求。

### SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13 - `feat: add planning revision response lineage` / `ops: deploy planning revision workflow`

- Git/范围：从 strict clean `main@174181991c0bf51ee397627ea8fce546d1b64e68`、Parent `180f6b58b583bd2dba350f017504be916db9673d`、behind 0/ahead 117 起步；只实现 Planning RETURN 后工程回复、固定后继谱系、测试和项目文档，不读取/修改 `shujvbiao/`，不 push/PR 或改写历史。
- Schema/版本：0036 无完整合规模型，故唯一新增 `0037_project_planning_revision_response_lineage.sql`，升级 `0.1.0-alpha.38`；0001—0036 未修改。新增追加式 Response Version、每 RETURN 独立 CAS Head、Package previous/RETURN/Response 复合外键、唯一后继/单次消费、索引和不可变 SQL guard；既有 RETURNED v1 不回填或伪造回复。
- 服务/摘要：回复按 LF、Unicode NFC、trim 和 10—2000 字符保存并保留中文全角标点；权限/owner/责任队列、Origin/CSRF、限流、幂等、CAS、并发和故障回滚 fail closed。v2 原子复制 Product/BOM/Unit Resolution/Material/Document 固定快照并把源 Package、RETURN、精确 Response Version/正文摘要纳入 Package 摘要；Audit 不存完整正文。
- UI：RETURNED v1 显示完整退回事实、工程回复、Version/actor/time/request_id、固定复用和确认后果；未保存或脏回复禁用 v2。仅回复模式不渲染 Product/BOM/Unit 选择器；v2 显示 `v1 → Planning RETURN → Engineering Response → v2` 完整固定谱系。
- 测试：静态/安全回归 49/49、Planning PostgreSQL 12/12、Migration 4/4、隔离 Chromium 1/1，共 66/66；Planning typecheck、production build、lint 0 error 与 diff check 通过。覆盖文本、持久化、CAS/追加版本、幂等异正文、并发、权限、RETURN 归属、唯一后继、零半记录、SQL guard、固定回复/快照和 390px 完整接收旅程。
- Git：功能提交 `58e011db0c8d9045c3919c36c2c64f1655f050b6`；部署、只读验收、清理与完成文档由独立 `ops: deploy planning revision workflow` 收口。不 push/PR 或改写历史。
- 备份/恢复：root:root 0600 custom dump 2,140,261 bytes、SHA-256 `653b239b65f31a89b0a29281f8f68c1c0ab26d43df4cd936bb544b0d69bbad69`，list 通过；第二新空库恢复为 0036且保护指纹一致，另一真实恢复副本升级 0037 后 Response/Head/v2 0、指纹不变并完成第二次隔离 Chromium 旅程，临时库均删除。
- 部署：并行非生产 UAT 串行应用 0037，checksum `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`；只替换 Web `sha256:fb88dd8afb8b...→sha256:694a3190f517...`。Worker 保持 `sha256:32d1ae335610...`，PostgreSQL/Worker/Caddy 容器和四卷未重建，旧 Web 精确 rollback tag 保留。
- 主 UAT：engineering-only 网络白名单核验 login/logout 1/1、业务 POST 0、Response/v2 write 0、planning login 0；空回复输入、v2 禁用、Product/BOM/Unit selector 0、A0/V1/Unit Resolution v1/四条 10 PCS 与 390px 通过并退出。跨迁移保护指纹前后均 `a25be9c924bb2e7af54acd36c1c5f758e0caf0b2f4d8ccf426bf428aee41d739`；v1/RETURN/Response/v2 `1/1/0/0`，历史原因/Event 未改。
- 资源/清理：67 次自动执行、三项 Python 基线、typecheck/build/lint/credentials/diff 通过；起点约 2.1 GiB available/227 MiB Swap/22 GiB/低 Load，最终 2.1 GiB/240 MiB/22 GiB/Load `0.04/0.16/0.27`，内核 OOM 0、四服务 restart 0/OOM false。临时数据库、容器、app 提取、Playwright 与 Python 目录清零；正式备份、当前/候选/回滚 Web 和四个受保护卷保留，未 prune。
- 结论：`PLANNING REVISION RESPONSE DEPLOYED — UAT V1 UNCHANGED`。可在下一独立授权任务重新开始 engineering v2 黑盒试用；本轮停止，不填写回复、不生成/提交 v2、不登录 planning。

### SELFHOST-OPS-UAT-PLANNING-DECISION-HISTORY-FIX-12 - `fix: expose planning decision history` / `ops: accept planning decision history in parallel environment`

- Git/范围：从 strict clean `main@eaeae1c816256eb48355bdb117ecc20f6ac8545f`、behind 0/ahead 115 起步；功能提交 `180f6b58b583bd2dba350f017504be916db9673d`。只修改 Planning Handoff 服务投影、UI/CSS、测试和项目文档；未 push/PR、改写历史、访问生产或处理全局导航债务。
- Unicode/历史：预期全角标点与数据库 ASCII 标点先精确比较为不相同；仅 U+FF1A→U+003A 和 U+FF0C→U+002C 两处，分别 NFKC 后完全相同。原始文本经过全半角规范化，NFKC 语义核对 PASS；数据库实际原因保持权威，Package/RETURN Event 历史没有修改、补写或美化。登记 `LOW` 体验问题，不阻断链路。
- 服务/UI：Planning 新增待接收/已处理双视图；`PROCESSED` 服务端只映射 RETURNED/ACCEPTED 并按终态时间倒序。已处理 Package 可按稳定 ID/version 重开，显示 CREATE/SUBMIT/RESUBMIT/RETURN/ACCEPT、操作者、Asia/Shanghai、请求号、SUCCESS、完整原因、责任队列及 assignee/SLA 空状态。
- 决策安全：接收/退回在业务 POST 前弹出确认窗口；完成凭证只使用服务端返回的动作、操作者、时间、请求号、结果和数据库保存原因，并提供“查看已处理详情”。Product/BOM、Unit Resolution、Material Snapshot 和终态详情只读；没有增加 `system.audit.read`、扩大 planning 权限或改变状态机。
- 测试：Planning unit/UI/PG `4/7/11`，Identity/Project/Master-BOM PG `10/5/6`，0036 upgrade `6/6`，适用静态/安全回归 `65/65`；两组 typecheck、production build、lint `0 error / 10 existing warnings`、1,137 文件凭据扫描和 diff check 通过。隔离 Chromium `1/1` 在 390×844 完成合成退回、确认、凭证、历史重开、NFKC、退出与匿名 401。
- 备份/部署：root:root 0600 custom dump 2,139,142 bytes、SHA-256 `1d5cdd88257f2e53830598a498b609ac7208b792f7fcfdae2f8306b37d36eb5f` 的 list 与第二新空库 36/head 0036 恢复通过。只替换 Web 为 `sha256:fb88dd8afb8b7f08cf6c8dff9aa66566ad9aec0a203460e7fd09bc32af728edc`；旧 Web 有精确 rollback tag，PostgreSQL/Worker/Caddy、四卷、alpha.37/0036 不变。
- 主 UAT：只登录 planning，浏览器门禁只允许 login、只读请求与 logout；未登录 engineering、未接收/退回、未创建 v2。Package ID 1/v1 在已处理可见并重开，最终 RETURNED、RETURN 1、ACCEPT 0、v2 0，RETURN 操作者/上海时间/请求号/结果/实际原因和工程/项目部责任队列完整；活跃 planning Session 0。
- 数据/清理：部署前备份恢复库与主 UAT 后主库的受保护摘要均为 `3960cf1f1fc3fdaca0bacd246732d27a0ff223e894953e7be2427fa22b150dca`（217 tables / 201 sequences）。任务临时库/容器/网络/模块/脚本/指纹已清理；正式备份、候选/回滚镜像和四卷保留，未 prune。最终约 2.1 GiB available、221 MiB Swap、22 GiB、Load `0.08/0.10/0.21`，内核 OOM 0、四服务 restart 0/OOM false。
- 结论：`PLANNING DECISION HISTORY FIXED — UAT V1 RETURN VERIFIED`。完成后停止，不登录 engineering，不创建 v2。

## 2026-08-01

### SELFHOST-OPS-OFFLINE-IDENTITY-RECOVERY-11 - `ops: add guarded offline identity recovery` / `ops: complete canonical credential recovery`

- Git/范围：从 strict clean `main@753c68c84427de93536a1f282b6e80987f7c9466`、behind 0/ahead 113 起步；只获权处理当前并行非生产 UAT 的 admin 与固定十个 UAT 账号。工具/测试提交 `a48dcc8a290b96da1ea6e426aaa2c6d73416c2fc`；未 push/PR 或改写历史，未读取/修改 `shujvbiao/`。
- 离线工具：新增不接 Web 路由的 root-only Identity Recovery CLI、正式 runner、离线状态证明、受控检查、Canonical Stage/提升、隔离 Web/浏览器与证据最终化。严格拒绝 production、非 root、未知数据库、非 0036、可写服务、缺确认和重复 run-id；复用现有 Password/Identity/PostgreSQL 事务，不独立实现密码算法或 HTTP 恢复入口。
- 测试/演练：unit 7/7、隔离 PostgreSQL 12/12；最终 0036 主库备份恢复演练完成 11 账号原子更新、12 Session 撤销、11 审计、Canonical 与单 Chromium admin+十 UAT 登录/强制改密门禁/退出，最终目标有效 Session 0，业务与受保护指纹不变，演练资源已清理。
- 正式备份：root:root 0600 custom dump 2,134,619 bytes，SHA-256 `4c071223172d8a0fcb8c196690ec57c0f414eb83fde40f316449d5200f6bc42a`；`pg_restore --list` 与第二新空库 36/head 0036、身份非敏感计数和两类业务指纹通过。恢复库已删除，正式备份保留。
- 正式恢复：run-id `3b03aaab-11ef-4dfe-963b-001a6ece660f`；单事务锁定并更新 11 账号、撤销 12 条目标既有 Session、写 11 条 `OFFLINE_IDENTITY_RECOVERY` 审计与唯一持久证据。用户名、角色、active、其他用户/Session、业务表、Migration/Schema/版本均不在变更范围。
- Canonical/浏览器：两份正式文件标准 JSON Schema PASS、单硬链接普通文件、`root:root 0600`；双文件成功后删除旧 candidate，最终化后删除 Stage。单 Chromium 验证 admin 不强制改密并退出、十 UAT 全部仅到强制改密页并退出，历史导航/刷新不恢复受保护内容；最终目标有效与未撤销 Session 均为 0，未进入业务页面。
- 业务/服务：业务指纹 `04cdbc8a49112bc43b5652760408d46d10dbdda1801c1c9b816aa9891a5b5c3c` 与受保护指纹 `5414589704ac085792cab1a546e658a61b39c2988800a23ad091e756275e7d41` 前后一致；Planning 表只被受控备份/恢复与整体指纹核对覆盖读取，未做 Package 对象级核验、修改或业务操作。Web/Worker 停写合计 113 秒并恢复原容器/镜像，PostgreSQL/Caddy 保持运行，四服务 restart 0/OOM false。
- 验证/清理：Site lint、`npm test` 3/3、Python 三项、仓库凭据扫描和 `git diff --check` 通过。隔离库、临时容器/网络/浏览器运行材料/测试 Stage/临时 SQLite 均清理；四个受保护 Volume、正式备份、Canonical、完成标记与无秘密浏览器证据保留，未 prune。
- 结论：`OFFLINE IDENTITY RECOVERY COMPLETED — CANONICAL CREDENTIALS ACTIVE`。完成后立即停止，不开始 Planning 核验、接收、退回或其他业务任务。

### SELFHOST-OPS-UAT-CREDENTIAL-RECONCILIATION-10 - `ops: record blocked credential reconciliation`

- Git/范围：从 clean `main@a4eff293668e24f4f780eb5df840bfc7e510365e`、Parent `615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、behind 0/ahead 112 起步；获权范围仅为管理员本人改密、manager 二次重置、十账号 Identity 验证/退出和候选提升，不包含业务、数据库直改、重启或部署。
- 严格门禁：Branch/HEAD/Parent/同步、clean worktree、alpha.37、0001—0036、运行库 36/head、指定 Web 摘要、root-only 0600 凭据文件、候选存在、服务健康、无其他浏览器/执行流和资源阈值均通过。
- Fail closed：单一受控进程在凭据结构预检阶段返回 FAIL，并在建立管理员候选、启动 Chromium 或发送任何 Identity/业务 API 请求前停止。失败输出只含阶段、FAIL 和计数；没有输出或持久化密码、Token、Cookie、CSRF、Session 摘要、密码摘要或凭据正文。该结果不区分文件事实异常和解析器格式覆盖不足，本轮不重跑或扩大诊断。
- 身份/文件：管理员本人改密、旧/新密码验证、manager 二次重置、十账号验证、退出、审计页面核对和正式提升均未运行；身份变更与本任务 Identity 事件均为 0。管理员/UAT 正式文件及既有 UAT 候选未变化，均保持 `root:root 0600`；本轮隐藏阶段路径最终不存在。上一轮 Admin/manager Session 风险保持开放，没有新增 Session。
- 业务/服务：没有打开 Identity、强制改密、经营或 Planning 页面，没有 API/Package/业务请求；未读身份表、Session 表或密码摘要。没有 build、Migration、PostgreSQL 测试、Compose 重建、服务重启、部署、prune 或资源删除；alpha.37/0036 和四服务保持 restart 0/OOM false。
- 资源/清理：起点约 2.2 GiB available/218 MiB Swap/22 GiB/Load `0.19/0.14/0.10`；最终约 2.2 GiB/217 MiB/22 GiB/`0.40/0.23/0.20`，内核 OOM 0。受控容器自动删除且浏览器未启动；控制脚本、临时依赖/cache 和精确 `/run` 目录已删除。遵守保护规则，未删除已拉取镜像、Volume 或备份。
- 提交门禁：断网只读凭据扫描通过 1,119 个仓库文件，`git diff --check`、Python self-test/smoke 和隔离临时 SQLite go-live 通过；没有连接或写入常驻 PostgreSQL/SQLite。
- 结论：`BLOCKED — NO FURTHER IDENTITY CHANGE`。需另立并明确授权安全格式核验/身份收口任务；在 Admin/manager 风险、十账号退出与正式文件提升全部完成前，不得开始 planning 核验或退回流程。

### SELFHOST-OPS-UAT-ROLE-CREDENTIAL-ROTATION-09 - `ops: rotate exposed UAT role credentials`

- Git/范围：从 clean `main@615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、Parent `682e79378660ef7859617655836f02e2112df244`、behind 0/ahead 111 起步；只处理十个指定 UAT 角色账号，不修改业务代码、Migration、部署配置或其他用户，不 push/PR 或改写历史。
- 受控重置：单 Chromium、顺序隔离 Context、Identity-only API allowlist；十个目标账号均经管理员网页重置成功，每次成功立即原子更新/fsync 候选。角色与 active 状态保持，`admin`、UAT admin-check 及其他账号未重置，管理员凭据文件未修改；Identity audit 成功 10、失败 0。
- 验证/安全停止：首个账号旧密码返回 `LOGIN_FAILED`，新临时密码认证成功并进入首次强制改密页，未执行实际改密或越过该页；页面退出/Session 失效未形成完成证明，流程立即停止，其余九个未验证。管理员退出也未到达完成证明，因此两类任务 Session 均按风险开放处理，未直接读取或修改 Session 表。
- 恢复：保留 `/etc/chenyida-erp/.uat-role-accounts.txt.candidate-20260801025603-b821881a80`（`root:root 0600`）；候选未提升，正式文件保持 `root:root 0600`，其中十个旧密码已失效。没有旧凭据副本，不对普通文件底层不可恢复性作声明。
- 业务保护：没有进入经营工作台或 Planning Package 详情，没有发起接收、退回、v2 或任何业务域请求；本轮没有读取 Package 数据，FIX-08 的 Package 基线不冒充本轮黑盒结果。未 build、Migration、PostgreSQL 测试、Compose 重建或服务重启。
- 提交门禁：仓库凭据扫描通过 1,118 个文件，`git diff --check` 通过；扫描器排除禁止读取的 `shujvbiao/`。Git 变更只含无秘密项目状态和任务报告。
- 资源/清理：起点约 2.3 GiB available/218 MiB Swap/22 GiB/Load `0.44/0.31/0.21`；最终约 2.3 GiB/218 MiB/22 GiB/`0.13/0.18/0.20`，内核 OOM 0、四服务 restart 0/OOM false。临时 Chromium 容器、profile/cache、依赖、控制脚本和目录已清理；未 prune、删除镜像/Volume/备份，恢复候选按失败规则保留。
- 结论：`PARTIAL UAT CREDENTIAL ROTATION — RECOVERY CANDIDATE RETAINED`。另行授权完成 Session 风险处置、十账号验证和候选提升前，停止所有 UAT/Planning 登录。

### SELFHOST-OPS-UAT-PLANNING-REVIEW-TRACEABILITY-FIX-08 - `fix: expose planning handoff traceability` / `ops: record blocked planning traceability rollout`

- Git/范围：从 clean `main@a254bca5d59dd3f17047c9d6495dfdf2df1a798e`、Parent `91c0fd29d534246c55ddd669e894cdde9b774e52`、behind 0/ahead 109 起步；功能提交 `682e79378660ef7859617655836f02e2112df244`。只改 Planning Handoff 详情的只读合同、展示、测试和项目文档；未 push/PR 或改写历史。
- 权威查询：详情使用单连接 `REPEATABLE READ READ ONLY`，先执行现有 `planning.read` 与 Package 范围授权，再从不可变 Package Snapshot、精确 Package Event、Package Item 固定 `unit_resolution_id` 和稳定关联对象投影。CREATE 请求只精确匹配该 Package 的成功准备审计；没有授予 planning 全局审计权限，也没有补写历史。
- UI：新增 Package 稳定 ID/version/完整摘要/责任队列/assignee 与 SLA 空状态、CREATE/SUBMIT/RETURN/ACCEPT 时间线和 Asia/Shanghai 标注；Product/BOM 创建服务门禁证据与当前状态分开，销售源单位 pending 与工程 `件 · PCS`/Unit ID 1/Resolution v1 并列；四条 Material 显示稳定 ID、正式编码、名称、1 PCS、损耗和 10 PCS。退回文案、决策后果、终态只读原因和 390px 卡片布局完成。
- 测试：适用 Node 103/103，Planning unit/UI/PostgreSQL `4/7/11`，两个 typecheck、lint 0 error/10 既有 warning、1,117 文件凭据扫描通过。隔离 Chromium 1/1 在 390×844 完成合成查看→退回、无全局溢出、v2/ACCEPT 0、退出 Session 失效；没有对主 UAT 执行退回。
- 数据库/版本：没有新增 0037，没有修改 0001—0036，alpha.37 不变；0036 SHA-256 仍为 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。功能核验没有发现历史追溯缺口。
- 备份/部署：root:root 0600 custom dump 2,131,480 bytes、SHA-256 `25c302316d415602825d1d9d85e8456a5c46db5c4167cc5f8da27b0ea8f42ff2`，`pg_restore --list` 与第二新空库 36/head 0036 恢复通过。只替换 Web `sha256:6667bd2ca64e...→sha256:6b94a9c73a18...`；PostgreSQL/Worker/Caddy、Origin/端口和四卷保持。
- UAT 保护：部署前后业务指纹均为 `a7869b3ae5d75b7b68fac1234e04288c755622ee3f549497b2c96dc366701679`。Package ID 1/v1 仍 SUBMITTED、总数 1、v2/RETURN/ACCEPT 0；Unit Resolution、Product/BOM、Material 533—536、Event/Audit 均未修改。
- 安全停止：准备主 UAT planning 只读浏览器核验时，shell 诊断错误输出暴露 root-only UAT 角色凭据正文；后续只读计数确认 10 组仍有效，其中 1 组为 planning。立即停止登录，未创建 Session、未登录 planning/engineering、未执行接收/退回。凭据值和身份信息未写入仓库；因轮换属于新的权限变化且未获授权，主 UAT 浏览器验收未执行，任务以 `BLOCKED — NO UNSAFE CHANGE` 收口。
- 资源/清理：最终 available 2.2 GiB、Swap 214 MiB、根盘 22 GiB、Load `0.17/0.54/0.74`；四服务 restart 0/OOM false。隔离库、恢复库、临时浏览器/构建镜像和精确临时目录已清理，正式备份与当前/回退 Web 保留；未 prune 或删除受保护卷。

## 2026-07-31

### SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07 - `feat: add versioned requirement unit resolution` / `ops: deploy requirement unit resolution in parallel environment`

- Git/版本：从 clean `main@d06b44f5958527707f38e4c12f0d3143ce31875b`、Parent `525ad2907287d736ecd40d3df24b77c6c5be8ff4`、behind 0/ahead 107 起步；功能提交 `91c0fd29d534246c55ddd669e894cdde9b774e52`。包升级为 `0.1.0-alpha.37`；未 push/PR 或改写历史。
- Schema：唯一新增 `0036_project_requirement_unit_resolution.sql`，SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。`0001`—`0035` 无修改，逐文件 SHA 汇总仍为 `504ba2fdc555135935436fccc8d618225fad47e3de169af9fd9cb7ae99a511c0`，0035 仍为 `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- 模型/API：新增追加式 Unit Resolution Version、每 Requirement Item 独立 CAS Head、稳定 Unit/需求链外键、受控来源类型、Version UPDATE/DELETE 禁止和 Package Item 精确 provenance。正式写接口执行 Session、Origin、Cookie/Header CSRF、角色权限、canonical-body 幂等、CAS、enabled Unit、Audit 与故障零半记录；Package 创建不再从源 nullable Unit 或 BOM 推断。
- UI：pending 行显示 enabled Unit 的 `中文名 · CODE` 选择器且不自动预选 PCS；Product/BOM 与 Unit 完整性分别显示，缺失行明确，未完整时保存/生成门禁生效，刷新保留 Resolution Version，390px 无页面级横向溢出，并说明确认不改销售原始需求。
- 测试：Migration 6/6、Project PostgreSQL 5/5、Planning PostgreSQL 10/10、静态适用回归 89/89、其他适用 PostgreSQL 25/25、`npm test` 3/3；两个 typecheck、lint `0 error / 10 existing warnings` 和 production build 通过。真实 Chromium 隔离全旅程 1/1，覆盖无预选/停用 Unit、CSRF/Origin、幂等/CAS、退回修订重提接收、四行各 10 PCS、固定 v1/v2 provenance、源 Requirement 不变和退出失效。
- 隔离升级/回退：在线一致 0034 隔离 dump SHA-256 `52bd21d05dcb9fda9d98a3a4b8949e2513ba8b818a8c2e60e243cded9f6c19a1`；空库 0001→0036、0035→0036、0034 恢复库的 0035→0036、重放、失败回滚和约束均通过。升级库删除后从同一备份恢复到另一新空库为 34/head 0034，保护事实一致；临时库已删除。
- 正式备份/部署：停服 root:root 0600 custom dump SHA-256 `75e1ffbf2ea846761ece1d4c73dea96e871eca5fcde86d28f24782b10f862df7`，`pg_restore --list` 和第二新空库 34/head 0034 恢复通过。暂停 Web/Worker 写入后串行应用 0035、0036；只替换 Web `sha256:7e0a3040acd172...→sha256:6667bd2ca64e...`，旧 Web 回退 tag 保留。Worker 保持 `sha256:32d1ae335610...`，Caddy 未重建，PostgreSQL Volume、公网 Origin/端口和四个受保护卷保持。
- UAT 保护：业务保护指纹 `fb71309bf73dce907f0bcb2e294d1b31` 升级前后相同。Requirement Item 1 仍 `unit_id=NULL/unit_pending=true`、数量 10；Product/BOM Resolution 仍 7/7/7/7；Unit Resolution Version/Head `0/0`，Package/Item/Event/待接收 `0/0/0/0`；Product/BOM/Material 533—536/四行各 1 PCS 未变。
- 只读验收：Engineering 页面出现未预选的单位选择器，显示 Product/BOM 完成与 Unit 缺失，保存/生成禁用，390px 通过；未选择/保存 PCS、未生成 Package、未登录 planning，退出后会话失效。凭据格式探测曾产生 1 次 engineering 登录 401，无会话或业务写；随后只在内存核对密码摘要完成正式验收，不影响业务指纹。
- 运行状态：最终四服务 restart 0/OOM false，Web/PostgreSQL healthy、Worker/Caddy running；精确清理后 available memory 2.3 GiB、Swap 210 MiB、根盘 26 GiB、Load `0.30/0.30/0.40`，未触发停止阈值。临时库/容器/worktree/runner/在线隔离 dump/Playwright 镜像已清理；正式备份、当前/旧 Web 回退镜像和四个受保护卷保留。

### SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-FIX-06 - `docs: diagnose planning unit resolution schema gap`

- 严格门禁：从 clean `main`/`525ad2907287d736ecd40d3df24b77c6c5be8ff4`、behind 0/ahead 106 起步；源码 alpha.36/0035，常驻 alpha.34/0034，Web 镜像与唯一公网 Origin 精确符合任务要求。无未知执行流或重型容器，四服务 restart 0/OOM false。
- 根因：当前 Requirement Item 为 `unit_id=NULL/unit_pending=true`；0015 的数据库触发器禁止改写已提交需求。0016/0034 的 Product/BOM Resolution 不含 Unit/版本/CAS，“保存解析”只能保存 Product/BOM；快照 INNER JOIN `project_requirement_items.unit_id` 和 enabled Unit 后排除该行，再统一抛出误导性的 `REQUIREMENT_ITEMS_UNRESOLVED`。
- 分支 B：确认没有 alpha.34/0034 合规热修位置。禁止写回需求、从 BOM/名称/产品类型推断 PCS、用 JSON/备注旁路或放宽完整性门禁；未修改代码、0035、Schema、migration、测试断言或部署配置。
- 数据方案：proposed D-086 定义 0036 追加式 Unit Resolution 版本事实、独立 CAS Head、复合归属 FK、enabled Unit 双阶段校验和 Package Item `unit_resolution_id` provenance；Product/BOM Resolution 保留稳定 ID。0034→0035→0036 必须另行授权、备份、隔离升级与验收。
- UAT 保护：只读确认 Project ACCEPTED/10、Product/BOM 7/7 RELEASED、BOM 四行 533—536 各 1 PCS；Product/BOM Resolution/Package/Item/Event `1/0/0/0`，待接收 0。三条指定 failed/`REQUIREMENT_ITEMS_UNRESOLVED` 记录保持。综合指纹前后均为 `b239c62091cf51de8fa5b3ff6fb6521a`；本轮没有 engineering/planning 登录或业务写。
- 测试/部署：Branch B 没有运行 Planning 功能或隔离 PostgreSQL 写测试，未伪造用户列出的验收项；Python 文档基线三项通过。Node unit/UI 因当前镜像看不到沙箱只读源码挂载而在发现测试前退出，断言 0，临时容器已自动删除。未 build、backup/restore、deploy、restart 或创建 Package；最终 available memory 约 2.3 GiB、Swap 222 MiB、根盘 28 GiB、Load `0.09/0.11/0.09`，四服务 restart 0/OOM false。

### SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 - `fix: use current csrf token for planning writes` / `fix: enforce released bom read-only ui` / `ops: accept planning csrf and bom immutability fixes`

- CSRF 根因/修复：Planning 页面虽传入 `protectedWrite`，但共享客户端的路由分类没有覆盖 requirement resolution、planning package 和 submit/accept/return 等路由，请求落入普通 POST 分支，因而丢失 `X-CSRF-Token` 和调用方 Idempotency-Key；`credentials: same-origin` 与 Header 名本身正确。现在所有 Planning 写统一使用 `sessionPost`，发送时读当前 `CYD_ERP_CSRF` Cookie，以当前 Token+method/path+canonical 正文绑定页内幂等键，Session/logout/重新登录/页历史变化清空旧上下文。
- 服务端安全：Planning 仍只允许 POST，在读取正文和进入业务前执行现有 Origin/CSRF/Session/权限校验；缺失、错误、旧 Session Token、旧公网和未知 Origin 继续 fail closed，不信任 `Forwarded`/`X-Forwarded-*`。中文稳定错误码、request_id、日志去敏和审计边界未放宽。
- BOM 不可变：RELEASED 详情不再显示 Material 搜索/选择、行号/数量/损耗输入或新增/编辑/删除/保存/发布动作，明示“已发布，只读；如需修改请创建新版本”，切换详情会清除旧 DRAFT 输入。新增 line PATCH/DELETE 服务路由，DRAFT 可依权限修改，RELEASED POST/PATCH/DELETE 均稳定返回 `409 BOM_RELEASED_IMMUTABLE`，失败时无 Line/Version/Event/成功 Audit 半记录；既有 DB trigger 保持。
- 最小披露：BOM 页默认显示“请选择或搜索 BOM”，不自动选中或读取第一条历史明细。`GET /api/boms?q=&limit=` 只返回有界 Header/Product 摘要，支持 BOM 编码、Product 编码和名称；只在用户明确选择后读取 BOM Line，桌面与 390px 通过。
- 隔离验证：当前源码专项/适用回归、TASK09 14 项、六组 typecheck、218-table Schema consistency、lint `0 error / 10 warnings`、alpha.36 buildcheck、credentials、`git diff --check` 和 Python 三项通过。alpha.34/0034 兼容源合同 140/140、五组 typecheck、209-table Schema consistency、lint `0 error / 9 warnings`、build、credentials 通过；隔离 PostgreSQL Identity+Project+Planning `16/16`、Master/BOM+Material+operations+Dashboard `19/19`。
- 隔离浏览器：全新 0034 数据库与合成账号/项目完成 current/缺失/错误/旧 Session CSRF、logout→login、可信公网/回环、旧公网/未知/伪造转发头、保存→生成→提交→退回→修订→重提→接收、幂等重放/异正文/CAS、DRAFT/RELEASED BOM 和默认空选择。结果 package v1 RETURNED/v2 ACCEPTED，共享受保护写 18、Planning 写 11、Cookie/Header 匹配 18；全部仅在隔离库，库已删除。
- 备份/部署：pre-deploy custom dump 2,027,218 bytes/0600/root，SHA-256 `b30fa30408da026bd4114a52011e56485956fb72529e6e3467dfa5e4d5aa0d44`，3,065 list 行/213 TABLE DATA，独立单事务 0034 恢复核对通过。兼容 patch SHA-256 `b842ae9cbbb74b7b5a383b6d062fc500746361a0b53a46f551085d25e1`，只替换 Web `sha256:cb6a5c1fae896... → sha256:7e0a3040acd172...`；PostgreSQL/Worker/Caddy 未重建，34/head 0034、新公网 Origin 和四卷保持，0035/0036/TASK09/完整 alpha.36 未进入镜像。
- 主库/清理：engineering 只读 Chromium 仅发出 login/logout POST；首次 BOM Line 请求 0，明确选择的 UI 动作只加载该明细 1 次，脚本另以只读 GET 核对精确四行；RELEASED 可变控件 0，A0/V1 可识别，logout 后 back/forward/refresh 匿名。`PRJ-00000001` ACCEPTED/10、Product 7/A0 RELEASED、BOM 7/V1 RELEASED 及四行 533—536/1 PCS/0 不变，Planning `0/0/0/0`，三条旧 CSRF 失败保持；只新增 1 LOGIN/1 LOGOUT，有效任务 Session 0。测试/恢复库、临时容器、浏览器、Playwright 镜像、worktree/candidate tag 已清理，备份、当前镜像和精确回退 tag 保留，未 prune/push/PR。

### SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 - `fix: make bom material selection code-first` / `ops: accept bom selector fix`

- 根因/Selector：旧兼容页从全量 `/api/items` 读取当前字段，却以旧 `internal_item_code` 作为 option value/写入回退，没有搜索且依赖长下拉。新增有界 `/api/bom-material-candidates`，只返回 ACTIVE、正式编码非空、enabled 主单位可解析的 `material_id/internal_code/name/unit_id/unit/status/version`；精确编码单一命中，否则支持编码前缀和名称。
- UI/生命周期：结果显示 `正式编码 · 名称 · 单位`，选择与提交只使用稳定 material_id/unit_id；空/加载/无结果/错误/清除和竞态状态明确，桌面与 390px 可换行。Product Version、BOM Version、产品/生命周期/BOM 状态分开显示，并说明 BOM 属于 Product Version、Project 在 Planning Handoff 关联、先草稿校验后发布、发布后不可原地修改。
- 服务端：保存和发布事务均锁定并重新验证 Material 存在、ACTIVE、正式编码、Unit enabled 与主单位；alpha.34 的 `base_unit_id=NULL` 只按 `base_uom` 精确兼容。同一 BOM Version 重复 material_id 被拒绝；数量精度、发布权限、幂等、CAS、审计、故障回滚和不可变规则保持。
- 权威模型：Product/BOM/Planning 继续使用同一 PostgreSQL Product Version、BOM Version 和稳定 ID；真实 BOM release API 已存在并由 UI 调用，Planning 只接收 RELEASED Product/BOM，没有新增 Schema、Migration、状态机或伪按钮。
- 验证/备份：隔离 PostgreSQL Master/Planning/Identity/Material/operations/Dashboard、兼容 120 项、TASK09 14 项、typecheck、209-table Schema consistency、lint、alpha.34 build、credentials、Python 三项与 diff check 通过。custom dump 2,023,590 bytes、SHA-256 `8facc469c6bbdf3d2dedce57ce2d8a740d58cd2d2f8cd6e85c714421d05c35b9` 已完成清单、独立 0034 恢复与 candidate HTTP smoke。
- 部署/UAT：只替换 Web `sha256:881c033dc97e...→sha256:cb6a5c1fae896...`，PostgreSQL/Worker/Caddy ID 不变，Origin 保持 `https://43.135.148.43.nip.io:18888`，34/head 0034、0035 count 0。Chromium 对四码各唯一命中 IDs 533—536/PCS，只选择后清除，A0/V1 与发布说明清楚；只产生 2 LOGIN/2 LOGOUT，最终有效 engineering Session 0。
- 数据/清理：项目 ACCEPTED/10、产品 ACTIVE+A0/DRAFT/样品、四物料 V3/ACTIVE/PCS 和比较指纹不变；目标/全部 UAT BOM `0/0`、Planning `0`。临时测试/恢复库、容器、浏览器、Playwright 镜像、worktree、candidate tag 和可归属 BuildKit cache 已清理；备份、当前镜像和旧 Web 回退 tag 保留。未运行 0035、创建 0036、部署 alpha.36、操作 Python 服务、push 或 PR。

### SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 - `ops: record public IP cutover`

- 入口：项目负责人明确授权“切换”后，公网入口从 `https://43.135.157.211.nip.io:18888` 改为 `https://43.135.148.43.nip.io:18888`；Caddy 域名和 Web 单值 `ERP_PUBLIC_ORIGIN` 同步更新，不保留双公网 Origin。
- 配置/回退：root-only env 只改变两项公开值，其他内容经安全比较一致；原文件以 0600 回退副本保留。复用原镜像和卷串行重建 Web/Caddy，不 build/pull，不重建 PostgreSQL/Worker。
- TLS/网络：Let's Encrypt 新证书 CN/SAN 与新主机名匹配；ACME、外部 18888 登录页、HTTPS 首页/健康 200、HTTP 308→新 HTTPS 18888、匿名业务 API 401、安全头和旧 SNI 失败通过。
- 数据边界：34/head 0034 及核心 `536/7/7/6/6/316` 不变。Web 重建前的并发外部身份流程使 Session/Audit/Idempotency `103/1147/43→105/1152/44`，时间证明确实早于切换；切换后三类新增为 0。533—536 更早已由外部正式流程成为 ACTIVE/version 3/有编码，本任务没有审核或改写。
- 验证/资源：来源+身份 unit `15/15`、基础 `3/3`、lint `0 error / 8 个既有 warning`、1103 文件凭据扫描通过；最终 `2,474,940 KiB` available、`204,964 KiB` Swap、30 GiB、Load `0.02/0.29/0.28`，60 秒 Swap -4 KiB，内核 OOM 0、四服务 restart 0/OOM false、四卷保持，临时测试容器已删除。
- Git/保密：只提交脱敏任务和状态文档；env、证书私钥、凭据、Token、Cookie、摘要、数据库正文和备份不进 Git。未 push/PR、未运行 0035、部署 alpha.36、修改安全组/systemd/Python/SQLite 或启动其他业务任务。

## 2026-07-30

### SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY - `fix: clarify material review decision context` / `fix: invalidate protected views after logout` / `fix: enforce no-store on legacy shell` / `ops: accept material review blocker fixes`

- 审核详情：API 从现有当前 SUBMIT version 返回提交说明、提交人、时间和版本；UI 原样显示待审名称、分类/单位/来源、创建/提交事实、状态、工程说明或“未保存”、正式编码状态、审核范围、批准/退回后果和工程建立 BOM 下一步。不解析名称中的 `·`，不伪造外部编号、供应商、报价或价格。
- Dashboard/权限：新增权限绑定的 PENDING_REVIEW 精确待办，当前 API、卡片和原生队列均为 4，非零时不显示“当前没有立即待办”；legacy 统计继续明确为全局 DRAFT+PENDING_REVIEW。operations 仍只有 queue/approve/reject 三项审核增量，正文编辑和无关角色服务端 403。
- 退出/缓存：经营、Material 和 legacy 在 pagehide 先隐藏受保护内容，pageshow persisted/back_forward 重新校验 Session，legacy 刷新 fail closed；根页、Material 与 legacy 响应统一 `private, no-store, max-age=0, must-revalidate`。POST logout、Origin/CSRF、Session 撤销和 Cookie 清理保持，不禁用浏览器历史。
- 测试：隔离 PostgreSQL operations/Identity/Dashboard/Material 为 `4+10+2+7`，最终相关 unit/UI/handler/API coverage 118 项，TASK09 标准化 14 项；三组 typecheck、218 表 Schema consistency、lint 0 error、alpha.34 与 alpha.36 buildcheck、credentials、Python 三项和 diff check 通过。
- 备份/部署：custom dump 2,019,961 bytes、SHA-256 `281e25978b9db99000488779b858431cb20a2535364f64a01dec13bf7037972b`，3,065 entries/213 table-data，独立 0034 恢复通过。只替换 Web 为 `sha256:881c033dc97e...`；原 `sha256:f31199de3b8...` 以明确回滚 tag 保留，PostgreSQL/Worker/Caddy 容器与四卷不变，0035 未运行、alpha.36 未部署。
- 只读 UAT：operations Dashboard/队列均为 4，搜索 `042576` 并打开 533—536，详情和决策说明可见、正文编辑控件 0、approve/reject 请求 0；两套工作台 logout→back/forward/refresh 保持未登录。四条最终仍 PENDING_REVIEW/V2/MANUAL/PCS/空编码，APPROVE/REJECT version/change/audit 为 0，有效 operations Session 0。
- 资源/清理：最终约 2.3 GiB available、187 MiB Swap、30 GiB 根盘、Load `0.21/0.45/0.68`，内核 OOM 0，四服务 restart 0/OOM false。测试/恢复库、临时容器、浏览器、脚本、buildcheck 镜像和 worktree 已清理；备份、当前镜像和单一回滚 tag 保留。

### SELFHOST-LANDING-TASK09 - `feat: add supplier material standardization workbench`

- 工作流：把 TASK07 获确认的 `CYD-MATERIAL-13C-v1` 整理方式接入现有供应商导入；解析结构准备完成后默认进入“标准整理”，列表/新建页明确新路径，来源表头、高级 Mapping、Normalization 和 Review 继续保留。
- 规则：模板 13 列逐字/列位命中时直通；其他来源只使用明确表头、当前 Mapping、可证明标题上下文和显式主替状态。供应商料号不得冒充内部型号，未知项目/板型/型号/数量留空；公式和错误单元格不执行，替代料只按显式标记折叠。
- API/安全：新增 owner/`read_any` 保护的分页预览与 UTF-8 CSV；repeatable-read 只读快照、5,000 行/32 MiB、`private, no-store`、请求编号、稳定中文错误、导出审计、RFC 4180 与公式注入保护。需求/购买数量用字符串+BigInt 精确计算。
- UI：固定 13 列表格展示 Profile 状态、来源、统计、问题明细、分页和下载，并反复说明预览/CSV 不等于正式入库、建稿、审核或编码。工作区由七个可见步骤扩展为八个。
- 验证：Standardization 14 项，Mapping 5 项、Normalization 12 项、Review 10 项、Adaptive 5 项、FileStorage 3 项通过；两组 typecheck、lint `0 error / 8 个既有 warning`、credentials、Python 三项和 diff check 通过。
- 边界：源码提升到 `0.1.0-alpha.36`，Migration head 仍为 0035；未处理新真实表格正文、写业务数据、运行 Migration、build/restart/deploy、push 或 PR。当前 18888 仍为 alpha.34/0034。

### SELFHOST-LANDING-TASK08 - `docs: define bulk material standardization workflow`

- 流程：把 TASK07 固化为一批一任务/一对话的大批量 SOP；固定 `CYD-MATERIAL-13C-v1`、规则包、`CYD-MAT-YYYYMMDD-NNN/Rxxx`、默认 10 文件/5,000 行/100 MiB 上限和超限拆分规则。
- 恢复：定义 root-only 私有总索引、来源 manifest、批次卡、追加式决定日志和唯一 `checkpoint.next_action`；提供三份合法 JSON 示例与新建/继续/批准批次的复制指令，新对话不依赖旧聊天。
- 映射/审核：已知结构必须命中版本化来源档案，未知布局进入 `PROFILE_PENDING`；Codex 最高推进到 `REVIEW_REQUIRED`，项目负责人明确批准批次/修订/输出摘要后才能进入批准汇总。
- 汇总边界：临时汇总允许含机器验证的待确认批次但禁止入库；批准汇总只拼接最新未取代批准批次，仍不执行跨批模糊去重、正式编码、单位/供应商/替代关系审批或数据库写入。D-083 已记录。
- 验证/范围：JSON 3/3、文档一致性、Python 三项、Node 3/3、lint、credentials 1,083 文件和 diff/scope 检查通过；仅文档和无业务数据示例，未读取新业务文件、实现通用执行器、连接数据库、运行 Migration、build/restart/deploy、push 或 PR。

### SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02 - `fix: authorize operations material review queue` / `ops: accept operations material review queue fix`

- 权限/口径：`operations` 静态权限只增加 `material.review.queue`、`material.review.approve`、`material.review.reject`，没有草稿代编辑、admin/身份、系统审计或其他业务写增量。人工队列继续以 `material_status=PENDING_REVIEW` 为权威；engineering 创建人不可自审，无关角色返回稳定 403 中文错误。
- UI：原生队列、筛选、total、详情与动作入口复用同一权限/状态口径；legacy“清洗审核”明确为退役导入清洗入口并引导 `/materials/review`、`/materials/imports`。兼容 Dashboard 的待处理指标明确标注为全局 `DRAFT + PENDING_REVIEW`，不再冒充当前角色队列。
- 测试：Review UI 52/52、Identity 9/9、Dashboard UI 5/5、非数据库适用回归 275 项通过；隔离 PostgreSQL operations 4/4、Identity 10/10、Material 7/7、Normalization 5/5、Review 4/4、BOM Governance 16/16、Mapping 6/6。typecheck、Schema consistency、lint 0 error、alpha.35 build、最终 credentials 1,077 文件、diff check 和 Python 三项通过。
- 备份/部署：pre-deploy custom dump 2,013,262 bytes、SHA-256 `afe2cc5aa68940c1cf303317d4936d20814f2d2cfc36a55b48709d6b489dee15`，3,050 list entries/213 table-data，独立 0034 恢复与 candidate API smoke 通过。只把 alpha.34 兼容 Web 替换为 `sha256:f31199de3b8...`；PostgreSQL/Worker/Caddy 未重建，34/head 0034 和四卷不变，0035 未运行。
- 浏览器/数据：真实 Chromium 只登录 operations，以 `042576` 确认 533—536 全部可见、详情可开、批准/退回按钮存在且正文无编辑控件；未点击审核动作并安全退出。四条最终均为 PENDING_REVIEW/V2/MANUAL/PCS/空编码，APPROVE/REJECT version/change/audit 计数均为 0。
- 安全/清理：一次凭据文件脱敏失败和一次失败清理约束错误使凭据材料/Session 摘要只在本次授权会话工具输出中显露；未写 Git、文件、日志或外部系统，凭据文件未改，遗留浏览器 Session 已按有效约束撤销并审计。建议在独立审核试用前另行轮换该 UAT 账号。临时库、容器、runner 与 worktree 已清理；备份和显式回滚镜像保留，未 prune、push、PR 或操作 Python systemd。

### SELFHOST-LANDING-TASK07 - `feat: standardize source material workbooks`

- 语义纠正：按项目负责人澄清，以 `moban.xlsx` 第一张 `原BOM` 为真实原始数据、第二张 `Sheet1` 为目标格式；53 个原始主料组与 53 个目标行的规格证据、上下文和用量全部自动核对通过。
- 离线整理：8 份来源分别生成同一 13 列标准页，再合并为 591 行 `全部物料汇总`；另有 591 行来源追溯、94 条异常和来源说明。A118 42 行完全重复区段只计一次；A200 同逻辑旧版不重复计入，4 处差异按模板优先保留证据。
- 缺项边界：57 行无可验证用量、21 行无可证明板型，均留空；供应商仅取模板或来源明确供应商列。9 条 PCB/PCBA/空板本体依模板排除，J587 文件名/表内版本冲突保留人工确认，不猜测库存、订单或正式编码。
- 输出/验证：root-only 工作簿 197,821 bytes、SHA `aeea74c2...1c91`；专项 7/7、既有回归 3/3、Python 三项、Node 3/3、lint、credentials 1,076 文件、ZIP/openpyxl/13 列/2,364 公式及来源摘要不变全部通过。
- 边界：业务文件、逐行报告和 GPT 下载副本均在仓库外；未连接或写 PostgreSQL/SQLite/D1，未改 Schema/Migration/API/UI/Compose，未 build/restart/deploy、push 或 PR。

### SELFHOST-LANDING-TASK06 - `feat: add guarded internal material library export`

- 模板：项目负责人确认 `moban.xlsx` 第一张 `原BOM` 仅作原版对照，第二张 `Sheet1` 为整理后标准；导出器固定验证其首行 13 列，并把后续分段的列位变化统一映射回标准列。
- 离线整理：复用 LANDING-TASK02 root-only manifest、逐行 profile/classification 和既有 payload；8 份来源/1,113 行及模板前后不变。532 个既有正式编码原样沿用；147 个来源候选和 45 个模板候选无正式编码，缺项/冲突 fail closed。
- 结果：仓库外 root-only `内部物料库.xlsx` 含 724 行物料库、997 行标准明细、484 行待确认、1,006 行来源映射和来源说明；完整覆盖 953 条非归档来源+53 条模板。输出 SHA `01d0239a...5fa0`，宏/外链/电话/敏感内容 0。
- 工具/测试：新增固定确认、输入漂移门禁、稀疏 XLSX 区段解析、严格匹配、候选隔离、原子输出和自校验工具及合成集成测试。专项+classifier 7/7、Python 三项、Node 3/3、lint 0 error/8 既有 warning、最终 credentials 1,070 文件和 ZIP 完整性通过。
- 边界：`shujvbiao/` 加入 `.gitignore`，源表/模板/结果表/逐行业务报告不进入 Git。未连接或写 PostgreSQL/SQLite/D1，未改 Schema/Migration/API/UI/Compose，未 build/restart/deploy、push 或 PR。

## 2026-07-29

### SELFHOST-OPS-UAT-BLOCKER-FIX - `fix: secure UAT identity writes and logout` / `docs: record UAT identity blocker acceptance`

- 根因：真实 SSH/Codex 浏览器转发使用动态端口回环 Origin，而并行环境此前只接受精确公网 HTTPS Origin；即使 Session、CSRF Cookie/Header、credentials 和幂等键正确，请求仍被来源门禁拒绝。经营与兼容工作台又分别吞掉 logout 403 并乐观清页面状态，服务端 Session 实际未撤销。
- 安全修复：增加独立 deployment class；只有显式 `uat`+flag 才接受浏览器 Origin 与 Request URL origin 均为严格字面量 loopback。生产仍只接受显式可信 HTTPS Origin，不信任 Host/Forwarded/X-Forwarded、不允许通配。两个工作台统一安全 POST logout、same-origin credentials 与双提交 CSRF，只在服务端撤销/成功审计/对称清 Cookie 后跳转，失败显示稳定错误码和中文提示。
- 回归：request-origin/identity/双 UI 合计 `24/24`，隔离 PostgreSQL identity `10/10`，alpha.34 candidate build 与 Compose/API smoke initial/restart 均通过；未知外部 Origin、错误/缺失 CSRF、弱密码、重复用户名、未授权角色、审计、旧 Session、重复退出和 Cookie 对称属性均覆盖。测试库/容器已清理，未写主库。
- 浏览器：使用既有管理员凭据创建唯一临时 manager 并在列表确认，经营/兼容两个入口 logout 后旧 Session 均为 `REVOKED`、成功审计存在，重新登录和匿名重复退出通过；账号未做业务试用，最终通过页面停用。部署后审计 908—920 全部成功。首次脚本提前结束遗留一个丢失令牌、等待 TTL 的会话，按禁止直接 SQL 删除边界保留并记录。
- 部署/数据：部署前 dump 1,985,741 bytes、SHA-256 `d8951686192b500bee1770be258c8ee3eddb5e8d8509c0664cb6ca7b64714c79` 的 list/新库恢复核对通过；只更新 Web 到 `sha256:273aa687e741...`。运行仍为 alpha.34/0034，无 Migration；PostgreSQL/Worker/Caddy、四卷和业务 `532/6/6/316` 保持。
- 资源/Git：最终 2.3 GiB available、Swap 3.2 MiB、根盘 34 GiB、60 秒 Swap 增长 0，四服务 restart 0/OOM false、内核 OOM 0。代码 `dfa30bf` 的 Parent 为 `5fc1266b`；文档提交以 `dfa30bf` 为 Parent。未 push/PR/改写历史、prune 或操作 Python/SQLite/D1；任务脚本、临时库/容器和 build worktree 已清理，备份/回滚镜像保留。

### SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 - `ops: waive admin2 first password change`

- 授权/范围：项目负责人明确要求 `admin2` 不用首次改密。本次只清除该账号 must-change 标记并递增 version；密码、active admin、角色、合法 Session 和其他账号保持，不新增通用豁免 API。
- 事务/审计：使用 serializable 事务、任务 advisory lock、目标行锁、active/role/version 2/must-change true 前置门禁和 CAS；账号更新与唯一 `USER_FIRST_PASSWORD_CHANGE_WAIVED/success` Identity Audit 同事务。任务重放实际为 no-op，审计仍只有 1 条。
- 核对：`admin2` must-change/version `true/2→false/3`，密码二次指纹、Session/有效 `3/1`、身份幂等 3 不变；Audit/Identity `887/15→888/16`。34/head 0034、checksum manifest `b2ff69f7...13b8b` 和业务 `532/6/6/316` 保持。
- 运行/边界：Identity unit 8/8，本机/TLS health 与匿名 Session 200；四服务容器、四卷、restart/OOM 和资源门禁通过。没有 build/restart/Migration/deploy、push/PR、Sites/D1/Python 操作；task SQL 已删除，Git 不含密码、摘要、Cookie、Token、凭据或业务数据。

### SELFHOST-OPS-TRUSTED-ORIGIN-05 - `fix: trust configured public origin behind TLS`

- 根因/修复：Caddy 在公网终止 TLS 后以内部 HTTP 反代，旧身份与通用写请求却把浏览器 HTTPS `Origin` 直接和内部 `Request.url` 比较，导致合法首次改密返回 `CSRF_INVALID`。新增规范化的单值 `ERP_PUBLIC_ORIGIN`；配置存在时只接受精确协议、主机和端口，不接受凭据、通配、路径或客户端转发头。
- 安全/测试：身份写继续强制 Origin，Cookie/Header CSRF 双提交、Session、must-change、幂等、限流、权限和审计不变。合法代理形态、错误/缺失/内部 HTTP Origin、非法配置和错误 Token 已由 unit `11/11` 与隔离 PostgreSQL `9/9` 覆盖；部署 UI `4/4`、build 和镜像 health 通过。公网合法 Origin 无凭据探针进入 `AUTH_REQUIRED/401`，不再被来源门禁误拦。
- 部署边界：最终镜像基于 `0.1.0-alpha.34` 运行基线只叠加该 hotfix，Web 镜像为 `sha256:f9c34a11b900...`。首个从当前 alpha.35 源码生成的候选镜像在最终交付前因超出最小边界被拦截；0035 从未应用，任务时段只有两条身份认证探针，无治理请求/写入；候选容器和镜像已删除。
- 数据/运行：只重建 Web，PostgreSQL/Worker/Caddy 容器未更换；34/head 0034 及 checksum manifest `b2ff69f7...13b8b`、用户/admin `2/2`、Session/有效 `3/1`、幂等 3、业务 `532/6/6/316` 不变。两次无凭据探针使 Audit/Identity `885/13→887/15`，均为合法 `AUTH_REQUIRED` 记录。
- 资源/保密：临时 Origin 测试库、runner、容器、alpha.34 build worktree 和越界候选镜像已清理；四卷、旧 Web 回滚镜像和 root-only 0600 env 回滚副本保留。未 prune、push、PR、发布 Sites/D1、操作 Python，Git 不含密码、Cookie、Token、凭据或真实业务数据。

### SELFHOST-OPS-ADMIN-ACCOUNT-04 - `ops: provision second administrator safely`

- 身份变更：只在当前 `chenyida-erp-parallel` 通过正式 Identity Service 新增 `admin2`；用户/active admin `1→2`，账号为 active admin、version 2、首次登录必须改密。PBKDF2-SHA256/310,000 次、管理员权限映射及临时密码验证通过；现有管理员和 Session `2/0` 不变。
- 门禁/审计：首次弱密码由 `PASSWORD_WEAK` 原子拒绝；新合规临时密码创建成功。最终只读核对曾误输出创建时摘要，随即通过正式管理员重置用同一临时密码生成新随机盐，使旧摘要失效。最终 Audit/Identity `877/5→881/9`，幂等 `0→3`，限流 attempt/new/rejected `0/0/0→3/3/0`，全部安全证据保留。
- 数据/运行边界：34 migrations/head 0034、Material/Product/BOM/Line `532/6/6/316`、四卷和部署均不变；本机/TLS health 200、匿名用户 API 401，四服务 restart 0/OOM false。Identity unit 8/8、部署 Web UI 合同 4/4 通过；临时 runner/目录全部删除。
- 保密/Git：密码只经关闭回显 stdin 进入一次性 root-only runner，未进入命令参数、环境文件、脚本、系统日志、报告或 Git；最终摘要、Token、凭据和业务数据未提交。未 build/restart/deploy、push/PR 或操作 Python 服务。

### SELFHOST-LANDING-TASK05 - `ops: stage guarded bom v9 reimport`

- 输入/门禁：对单个 SHA 绑定 XLSX 做只读显式字段解析；1 Sheet、197 行、0 公式/外链。197 个 ERP 编码有效、唯一、连续，来源追踪完整且精确身份重复 0；“使用次数”519 仅为来源统计，不解释为数量。
- staging：新增只允许 root-only 输出的 `prepare.py` 与只允许 `ERP_ENV=test`、受控 staging 库名、0034 和 payload digest 的 PostgreSQL stager；首次写入 197、同 payload 重放新增 0。缺显式单位 197，因此 `ELIGIBLE=0`、`NEEDS_REVIEW=197`；表格没有产品/版本/BOM 行结构，相关实体均为 0。
- 主库保护：只读生成 213 表计数和 5,556 条拟删除清单；因 staging 无合格行，没有执行任何主库清理或导入。主库逐表计数 manifest 前后完全一致，旧 532 Material、6 Product/Version、6 BOM/Version、316 Line 及 872 业务导入审计保持。
- 灾备/系统：pre-clean custom dump 1,982,039 bytes、SHA `b21b484bc4dbb11fcc9354af649267a10bff4a125dcf84c8ba639164191916e2`，list 3,065 项和新空库 213 表逐表恢复通过；34 Migration/checksum、管理员、初始化、Session、Identity audit 不变。因无主库导入，post-import dump 不适用。
- 保密/清理：原 XLSX metadata/SHA 不变；真实 payload、逐行 review、计数和 dump 仅在仓库外 root-only 目录。临时 staging 库/runner/cache 已删除，四卷和四服务保留，60 秒 Swap 增长 0、restart 0/OOM false。未 build/restart/deploy、push/PR 或操作 Python 服务。结论 `STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`。

### SELFHOST-PHASE6-TASK01 - `feat: add BOM material governance pipeline`

- 范围/规则：在既有 CSV/XLS/XLSX Parser→Mapping→Normalization→Review 后增加可配置 `bom-material-governance-v1`；以品类+类型化关键规格+性能等级严格判同，使用精确十进制量纲，只对完整 READY 身份归组。`0201WMJ0000TCE` 与完整的 `0201,0R,±5%` 样例通过明示规则/默认归组；`1uF` 与 `100pF`、任一必需容量/耐压/介质/精度差异都不归并。型号敏感品类使用完整 MPN+封装，不做词干/模糊合并。
- 数据库：新增唯一 expand-only `0035_bom_material_governance.sql`，九张 Governance Run/Group/Row/Spec、Material/Alternative Candidate、Decision/Link/Event 关系表；`material_import_mappings` 增加表头始/终行、数据起始行、结构置信/状态/算法版本 6 列，metadata v2 增加 4 属性、6 分类节点和更严精度/叶子必填绑定。Schema/snapshot/journal 一致，`0001—0034` 未修改，0035 未应用常驻库。
- API/安全：增加批次 latest/list/create governance run，run/group/row 读取，`materials|bom-mapping|duplicates|exceptions|alternatives` 五类报告，以及 `BIND_EXISTING|CREATE_DRAFT|EXCLUDE` 决策端点。读取执行 owner/`read_any`；写入执行 capability、CSRF、`Idempotency-Key`/digest、CAS、限流、单事务审计；响应使用稳定错误码、中文提示、`X-Request-ID` 和 `no-store`。
- 全局身份门禁：治理建稿、治理 Draft 批准与普通 Draft 批准共享 advisory identity lock；`CREATED_DRAFT` 持久预留防止竞争产生二码。绑定时 live revalidation 允许快照后新出现的精确 ACTIVE 收敛；INACTIVE/FROZEN、已有 Draft 和无法可靠重建身份的旧正式行 fail closed。旧 Import Review 不能对受治理类别旁路 CREATE/BIND。
- 报告/追溯：不可变来源保存原始料号、描述、厂商、BOM/批次、数量/单位和解析证据，可沿 `material_id <- governance group <- source row <- normalization/import batch` 追溯。标准候选 key 不是正式 ERP 编码；替代项始终是待审候选，不自动写 Supplier Mapping 或正式替代关系。
- 验证：治理 unit `61/61`、PostgreSQL `16/16`、migration contract/0034-upgrade `5/5 + 5/5`；Material/Normalization/Import Worker/Review PostgreSQL `7/7 + 5/5 + 1/1 + 4/4`；Material unit/UI `63/63`；`npm test` `3/3`、`typecheck:governance`、credentials 最终 1,050 文件扫描通过，lint `0 error / 8 既有 warning`。
- 边界/限制：历史正式物料兼容问题只检测和阻断，无 ACTIVE 属性修订流程；`MECH/OTHER` 为 `UNSUPPORTED`；无治理 UI、真实回填、正式替代料审批或生产部署。`shujvbiao/` 未修改/暂存/提交；但断网只读凭据扫描器原默认 `--others` 曾对该未跟踪路径发起读取，未输出或传输内容，已记录为边界偏差。扫描器已在打开内容前排除该受保护未跟踪目录，最终复扫通过。未 build/restart 常驻服务；两个隔离测试库和临时容器已删除，四个受保护卷保留。

### SELFHOST-LANDING-TASK04 - `ops: record task04 web deployment`

- 授权/范围：项目负责人明确授权把 `cda8c7e` 部署到当前 18888 运行面并允许 build/restart。实际严格串行构建 Web，并以 `--no-deps --force-recreate --wait` 只更换 Web；未运行 migrate，PostgreSQL/Worker/Caddy 容器未更换。
- 验收：新镜像 `sha256:2db38e312586...` 为 healthy；公网/回环 health 200，匿名业务 API 401。公网 `index.html` 与 `app.js` SHA 精确匹配源码，新 `/materials/imports/new`、CSV/XLS/XLSX 和版本标识生效，旧 CSV 控件、`file.text()` 与退役 API 标记消失。
- 缓存事实：响应已含 `private, no-store, max-age=0, must-revalidate` 和 `Pragma: no-cache`；Vinext 同时并列冗余 `public, max-age=3600`。`no-store` 为更严格指令，但精确消除矛盾响应头须另立收缩任务。
- 数据/回滚：34 migrations 与 `0034` 不变，Material/Product/Product Version/BOM/BOM Version/Line 为 `532/6/6/6/6/316`，交易表仍为 0。旧 Web 镜像 `sha256:1c07cb1b5708...` 保留为 `task04-predeploy-20260729`；未改 Schema/Migration/Compose/数据，未做 Excel→PostgreSQL E2E。
- 资源/清理：起点 available 2.1 GiB、Swap 114 MiB、根盘 36 GiB；最终 2.2 GiB、123 MiB、35 GiB。build 后与部署后 60 秒 Swap 分别 +100/-24 KiB，restart 0/OOM false、内核 OOM 0、临时验证容器无残留。Build Cache 1.401 GB 和回滚镜像有意保留，未执行未授权 prune。

## 2026-07-28

### SELFHOST-LANDING-TASK04 - `fix: route compatibility supplier import to native workflow`

- 根因：PostgreSQL Parser/Worker 已支持 CSV/XLS/XLSX，但 `public/erp/` 仍保留初版 CSV 文本页，且其 `/api/import`、`/api/import-file`、`/api/sample-import` 已被自托管运行面明确退役为 410，因此旧入口既只显示 CSV 又不可用。
- 入口：兼容业务台“供应商导入”改为直达 `/materials/imports/new`，明确 CSV/XLS/XLSX；删除 CSV 文本框、示例载入、`file.text()` 与旧提交函数，Tab 事件不再绑定原生链接。所有工作台→兼容页 URL 增加统一版本标识，兼容 HTML 配置 `no-store`。
- 回归：增加兼容入口→原生工作区、三类 Worker parser 静态路由、缓存保护与 legacy 410 合同；收窄两条被 Mapping 版本历史误伤的既有 Import UI 正则而不降低原语义。Dashboard 12/12、Import UI 102/102、Parser 38/38、typecheck、语法、lint、credentials 和 diff 通过。Parser 内容单测覆盖 CSV/XLSX，XLS 只覆盖 OLE 签名分类；未做 Excel→PG E2E。
- 边界：版本保持 `0.1.0-alpha.34`，Migration 保持 `0034`；不改 API/Schema/Compose/业务数据，未 build、重启、部署或导入真实文件。在线页面仍为旧资源，生产部署须另行明确授权。
- 后续：只读审计确认列表实际 `{items,next_cursor}` 与页面期望 `{data,total,page}` 失配且 cursor 被忽略；解析失败终态、创建/上传幂等及版本/SHA/重复/安全语义也需独立任务。本提交不以入口修复冒充这些合同已验收。

### SELFHOST-LANDING-TASK03 - `ops: expose parallel erp through https 18888`

- 入口：用户明确指定公网 `18888`；Caddy 通过 `43.135.157.211.nip.io` 获取公开可信证书，`https://43.135.157.211.nip.io:18888` 指向新 Node/PostgreSQL ERP，80 只承担 ACME 和 308 HTTPS 跳转。DNS 服务只解析名称，ERP 流量不经过第三方代理。
- 隔离：Web 保持 `127.0.0.1:3000`，PostgreSQL 不发布宿主端口；旧 Python 从公网 `18888` 移到 `127.0.0.1:18889` 并保持 active/enabled。新增 Caddy data/config 两卷，原四个 ERP 持久卷不变。
- 安全：运行环境切为 `ERP_ENV=production`，轮换 setup token，认证 Cookie 的 `HttpOnly/Secure/SameSite=Lax` 单测 8/8；公网匿名业务 API 返回 401，TLS 主机名/链校验及 HSTS、nosniff、DENY frame、Referrer/Permissions Policy 通过。
- 数据：未修改 Schema/Migration 或业务数据；仍为 34 migrations、532 ACTIVE Material、6 Product/Version、6 DRAFT BOM/Version、316 BOM Line，Inventory/PO/Receipt/WO/Shipment/Finance 为 0。post-import 备份与 root-only 报告保持。
- 资源：PostgreSQL/Web/Worker/Caddy 为 healthy/healthy/running/running，restart 0、OOM false；60 秒 Swap 增长 0，最终 available 2.2 GiB、Swap 114 MiB、磁盘可用 36 GiB。未 push、创建 PR、部署 Sites/D1 或上传真实数据。

### SELFHOST-LANDING-TASK02 - `feat: import classified real bom history`

- 用户澄清：项目不具备逐行人工分类人力，因此在不猜测冲突数据的前提下，由离线确定性规则完成来源编码/MPN/严格规格组合、类别、位号与可数件单位判定；旧 `d63078b` 结论不改写，以连续独立提交取代当前状态。
- 分类：8 文件/13 Sheet/1,113 条中 ELIGIBLE 515、NEEDS_REVIEW 438、ARCHIVE_ONLY 160；806 条物料级可映射来源经 274 条重复归并为 532 Material，488 条 BOM 来源形成 316 行。A200 注意事项归档，跨文件无严格同一身份时不合并。
- 导入：新增通用离线分类器、受确认口令/目标库白名单/payload digest/0034/唯一管理员门禁的 PostgreSQL migration adapter 与单元测试；真实 payload、逐行映射和报告只在 root-only 目录。staging/主库首次执行和重放均通过，6 Product/Version、6 DRAFT BOM/Version、316 Line，第二次新增 0。
- 约束：147 条物料级与 291 条 BOM 级待复核没有进入对应正式实体；孤儿、重复编码、非法数量/单位为 0。Inventory/PO/Receipt/WO/Shipment/Finance 保持 0；Migration 仍为 34、版本仍为 alpha.34。
- 灾备：pre/post custom dump 的 list、新空库恢复及主库/恢复库关键摘要一致；临时库和容器副本清理，Web/PostgreSQL healthy、Worker running。结论 `PARTIAL REAL BOM IMPORT COMPLETED — REVIEW REQUIRED`；post-import dump 仍待用户异机复制。

### SELFHOST-LANDING-TASK02 - `docs: record guarded real bom staging`

- 输入/保密：指定 8 个文件的数量、名称和 SHA-256 全部通过；13 个 Sheet 离线只读盘点，原件 metadata 不变。详细逐行结果只保存于仓库外 root-only 目录，未联网、上传或提交真实正文。
- 分类：1,113 条记录中 ELIGIBLE 0、NEEDS_REVIEW 950、ARCHIVE_ONLY 163、BLOCKED 0；全部结构化候选缺明确单位，另有稳定身份冲突、重复来源、数量和身份缺失问题。A200 注意事项只归档，BOM/清单无精确稳定身份交集，不猜测合并。
- staging：停服 pre-import custom dump 的 list/新空库恢复通过；唯一空 staging 使用正式 runner 升级到 0034，两次重放新增 0，孤儿/重复编码/非法数量单位/交易副作用均 0。
- 主库：Unit/Category/ACTIVE Material 均为 0，Product/BOM 也缺任务要求的行级来源字段；正式 Service mutation 为 0，主库 Material/Product/BOM 和全部交易事实保持 0。需要独立 provenance Schema/Migration 任务后才能继续。
- 结论：`STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`；无 post-import 备份、build、代码/Schema/Migration/部署/push/PR 或 Python/SQLite 写入。

### SELFHOST-LANDING-TASK01 - `ops: prepare alpha.34 disaster recovery package`

- Git：严格起点 `82e9f07ce1666ace2677853408c7fb4339808cfc`、behind 0/ahead 76、clean；fsck、76 个可达本地提交、TASK01—TASK10 链、tracked archive、无 gitlink/嵌套仓库和 credentials 通过。提交只含项目文档，Bundle 在提交后生成并实际 clone。
- 数据库：Web/Worker 严格停服时生成 clean-0034 custom dump，1,677,933 bytes、SHA `72e8cbc6c3c4666b0e95dbcacf395787c5b520eb05a2bf3a8837ed4cfc68d702`；固定新空库单事务恢复，34 migrations/checksum、210 表、admin/setup/audit/session 与 205 张零业务表通过后删除。
- 文件：只读打包 uploads、attachments、backup-status；三个 tar 分别恢复验证路径、文件 SHA、uid/gid/mode/mtime，源不变且 root-only 临时目录清理。PostgreSQL 原始 Volume 未归档。
- 灾备：`/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z` 为 root:root 0700，文件 0600；包含无秘密配置/恢复清单、MANIFEST 和 SHA256SUMS。PostgreSQL dump 按秘密材料处理，`offhost_copy_completed=false`。
- 边界：未 push、上传、外传、build、访问生产、迁真实数据、改代码/Schema/Migration/Compose/package、重启 Python 或删除四卷/resource-guard；结论 `ALPHA.34 RECOVERY PACKAGE VERIFIED AND READY FOR OFFHOST COPY`。

### SELFHOST-PHASE5-TASK10 - `ops: accept supplier receipt lot iqc in parallel environment`

- 实际验收：两条真实 HTTP Project→Planning→Purchase Request→Award→PO→Delivery Plan；SQL 只建稳定主数据 fixture。主链 `10×12 CNY` 收货形成 RML Lot、Source 120、余额 10/10/0，IQC 10/8/2 后异人 RELEASE 8/Close 为 10/2/8，AP/Production Issue 0；3 件支线沿原 Lot 全额冲销为 REVERSED，主链已有 IQC 冲销 409。
- 恢复：Web/Worker 串行重启后事实保持；最终完整 HTTP 接受态备份恢复固定第二库，核对 Project/Planning/Purchase Request/Award/PO/Receipt/Lot=`2/2/2/2/2/2/2`、34 migrations、10/2/8、REVERSED 与 Source 120/0。主库由 clean-0034 恢复为原 admin/audit/session `1/1/1`、205 个业务表/幂等/files 0。
- 验证：TASK10 专项、Procurement/Quality/TASK08/TASK09 和共享回归、typecheck、Schema、lint、双 build、credentials、Python 临时 SQLite 三项和 diff check 通过。首次系统 Python smoke 只因缺 `openpyxl` 在导入阶段停止，改用项目既有虚拟环境后通过。
- 资源：Build Cache 2.569 GB→0B，任务依赖镜像删除；四受保护卷、alpha.34 tagged images、三服务和 Python 保留。未 push/PR、未启动后续任务。
- 结论：`SUPPLIER RECEIPT LOT AND IQC RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK10 - `test: accept supplier receipt lot iqc flow`

- 新增真实 Compose HTTP 主链/冲销支线与重启持久性验收；把 TASK08/TASK09 历史 migration journal 断言改为精确查找不可变 tag，使其与新增 0034 共存而不降低 snapshot/checksum/回滚断言。

### SELFHOST-PHASE5-TASK10 - `feat: add supplier receipt lot iqc flow`

- Git/版本：功能提交 `a10264020738d5ff281db9a6f7b6774df8cbb61b` 严格 Parent `55f8fe9693ebc0f630920e92eca1f74584d852af`；版本 `0.1.0-alpha.34`。
- 数据库：只新增 expand-only `0034_supplier_receipt_lot_iqc.sql`，SHA-256 `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`；来源 XOR、Receipt Line 唯一 Lot、外键/CHECK、不可变/服务写 guard 和 deferred 守恒；0001—0033 不变。
- 服务/UI：Procurement 收货原子创建 RML Lot 和 frozen Balance；Quality IQC RELEASE 追加 UNFREEZE Ledger；安全整单冲销复用原 Lot。新增/完善 receiving、incoming IQC、inventory lots、fulfillment 和 Dashboard。
- 测试：新增 TASK10 unit/UI/PostgreSQL/migration/Compose 套件并保持 FGL/FQC/Shipment/ORDER/null Lot 回归。

## 2026-07-27

### SELFHOST-PHASE5-TASK09 - `ops: accept finished goods lot shipment in parallel environment`

- 实际验收：SO `10×20 CNY`、Lot A/B `4/6` 与各自 FQC；A 发 4 后 B 冻结 2、发 6 被拒且跨表零半记录，解冻后 B 发 6；冲销 A 4 恢复原 Lot/FQC 后再次从同一个 A 发 4。最终有效 Shipment/FQC `4/6`、Material 0、Source 200、AR/Settlement 0；ORDER 全链 null Lot。
- 恢复：整栈串行重启后事实保持；接受态恢复固定第二空库核对正向 `{4,6,4}`、Lot `{A,B,A}`、A reversal、FQC `{4,6}` 与 ORDER null Lot。主库恢复为 33 migrations、原合法 admin/session/audit `1/1/1`，业务/幂等/files 0；临时库与任务备份删除。
- 验证：TASK09 unit/UI/PG/migration、`npm test`、75 项适用回归、11 typecheck、Drizzle consistency、lint 0 error/8 既有 warning、Web/Worker 分开 build、1003 文件 credentials、Python 临时库三项和 diff check 通过。
- 资源：最终 Build Cache `2.105 GB→0B`、磁盘 36 GiB、available 2.38 GiB、Swap 146 MiB；restart 0/OOM false，四卷/tagged image/resource-guard/Python/SQLite 保持。未 push/PR、未启动 TASK10。
- 结论：`FINISHED GOODS LOT RELEASE AND SHIPMENT ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK09 - `feat: add finished goods lot shipment flow`

- Git/版本：功能提交 `02dfa0d3c18c16b0e8ee07af94f11de7a0ca77e7` 严格 Parent `279d284738b8ee01f6579a91333ad958a6c36dc8`；版本 `0.1.0-alpha.33`。
- 数据库：只新增 expand-only `0033_finished_goods_lot_fqc_shipment.sql`，SHA-256 `ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44`；Allocation、FQC、Shipment Line 和 FQC Fact 保存 nullable Lot 外键，BATCH 强制同 Lot、ORDER 兼容 null，并有索引、service guard、不可变事实和 deferred reconciliation。0001—0032 不变。
- 服务/UI：Quality 服务端推导 FQC Lot；Sales/Inventory 同事务执行显式 Lot Shipment、FQC 消费、Lot Ledger/状态/事件、Delivery/SO/Source 与原 Lot 冲销恢复；原生 FQC、Allocation、Shipping、Lot/Batch genealogy 页面展示稳定 Lot 追溯。
- 测试：新增 TASK09 unit/UI/PostgreSQL/migration/Compose HTTP 套件，并更新 TASK08/TASK09 历史契约以继续断言新的稳定 Lot 权威。

### SELFHOST-OPS-PARALLEL-DB-CREDENTIAL-ROTATION-03 - `ops: rotate parallel database credential safely`

- 起点：`main`/`0d24eddcc5176602370214bfc8f8003844ab2b80`、behind 0/ahead 70、工作区 clean；版本 `0.1.0-alpha.32`，32 个 PostgreSQL migration 与 `0032` checksum 完全匹配。
- 数据基线：唯一启用 admin；唯一 `IDENTITY/LOGIN/success` 审计和同时间创建的唯一 ACTIVE session 属于合法管理员登录并完整保留；其余业务/幂等表、uploads/attachments 0。
- 轮换：生成 256-bit URL-safe 随机密码，只在进程内存与 root:root 0600 回滚副本中短暂存在；停 Web/Worker 后通过 PostgreSQL 容器本地 stdin 修改角色，只原子更新 env 的 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 密码段，随后逐个重建 Web/Worker。PostgreSQL 未重启。
- 验证：新密码经 Compose 网络 `SELECT 1` 成功，旧密码由 `scram-sha-256` 返回 `28P01`；Web healthy、Worker running、PG healthy，restart 0/OOM false。Compose config、HTTP health/session、`npm test` 3/3、lint 0 error/9 warning、credentials 994 files、diff/scope 均通过。
- 回滚演练：前两次尝试分别发现 localhost `trust` 路径不能证明旧密码失效，以及 Bash `ERR` trap 将预期认证失败误分类；两次均恢复旧角色/env、串行恢复 Web/Worker并删除临时副本。最终改用 Worker→PostgreSQL SCRAM 路径和显式条件判断后通过；未降低断言。
- 保护：凭据值、连接字符串、token/hash、CSRF、密码哈希、请求正文和 env 内容未输出或提交；临时容器/回滚副本全部清理，Build Cache 0B，四受保护卷与 Python/SQLite 不变。
- TASK09：未启动且未授权。未来必须以基线主键或不可逆摘要建立 baseline-delta，完成后返回同一合法审计/会话记录集和计数；不得删除不可变审计。

### SELFHOST-PHASE5-TASK08 - `ops: accept finished goods lot workflow in parallel environment`

- 提交：功能提交 `43808f85bc3a662825cc2421d97e9eb631e0c469` 严格 Parent `809efadd2cafd1a7b55a0824b87c67c70ad2814b`；其后仅追加九个聚焦修正，独立 ops 提交实际哈希以 Git log 为准。
- 实际 HTTP：planned 10 工单发布 Batch A/B `4/6`，四工序及 IPQC 全部通过；Completion 形成唯一 Lot A/B、Ledger `+4/+6`、Lot Balance `4/6` 和 Material Aggregate 10。Lot B freeze/unfreeze 2；Lot A 冲销 `-4` 至 REVERSED 后重新 Completion `+4`，复用同一 Lot。
- 保护：同批并发 Completion 不重复建 Lot，跨 Batch/Material、错误 code、重复 Lot、冻结冲销和直接 SQL 伪造拒绝；production freeze 实际 403；ORDER Completion 保持 null/空 Lot。FQC/Shipment/Sales Source/AR/Settlement 0。
- 验证：212 项不重复 Node 测试、13 组适用 typecheck、Schema consistency、lint、Web/Worker 分开 build、992 文件 credentials scan、diff 和 Python 三项通过。
- 重启与恢复：Compose 串行 restart 后 Lot/Ledger/Balance/冻结/genealogy 保持；接受态 dump 1,684,486 bytes、SHA-256 `416541cb78062657640458f6dd104c86a8cf3432332302cb2c58ab683a4b3949` 恢复至固定第二库并复核 32 migrations、Lot `4/6`、Material 10。主库最终恢复为干净 0032。
- 清理：TASK08 库/角色/临时文件/三份任务备份已删除，resource-guard、三容器、四卷、Trae/MySQL、匿名卷和 tagged image 保留。Build Cache 起点 0B、峰值 2.627 GB、一次获授权 prune 后 0B；磁盘最终 37 GiB。
- 结论：`FINISHED GOODS INVENTORY LOTS ACCEPTED IN PARALLEL ENVIRONMENT`；只实现制造成品 Lot，未启动 TASK09。

### SELFHOST-PHASE5-TASK08 - `feat: add finished goods inventory lots`

- 数据库：只新增 expand-only `0032_finished_goods_inventory_lots.sql`；增加唯一 Finished Goods Inventory Lot、Ledger/Balance nullable Lot 外键、关系索引、不可变/一致性/服务写/deferred 守恒 guard；同步 Schema/journal/snapshot/package/checksum，不修改 0001—0031。
- 服务/API：Batch Completion 在同事务创建/复用稳定 Lot，冲销反向写原 Lot；Inventory Query 返回 Lot position 和同单位 Material aggregate；新增 Lot list/detail/ledger/freeze/unfreeze，并扩展 Completion、genealogy 和 Dashboard。
- 页面：Inventory、production completion、Batch/genealogy 和 Dashboard 展示 Lot code、Batch、Material/Unit、on-hand/frozen/reserved/available、Completion、Ledger 与状态，并明确原材料和供应商批次仍未启用。
- 安全：所有写接口复用 Session/must-change、CSRF、正文/限速、持久幂等、CAS、固定锁序、request_id、中文安全错误、Audit 和单事务回滚；warehouse 写，production/quality/engineering 只读职责受控。

### SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 - `ops: clean docker build cache safely`

- 起点：`main`/`dfece35cda381ff31c376aad9ed78242861ada73`、behind 0/ahead 58、工作区 clean；版本保持 `0.1.0-alpha.31`，PostgreSQL migration 保持 `0001`—`0031`。
- BuildKit：确认默认且唯一 `default*` docker builder、BuildKit v0.30.0，无 build/buildx/Compose build、测试容器或 migration 运行后，执行 `docker buildx prune --all --force`；命令退出 0、输出 `Total: 25.11GB`，Build Cache 25.11 GB（24.3 GB private reclaimable）→0B。
- Image：唯一 dangling image `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612` 无 tag/digest/容器引用，逐 ID 删除；Images 13/27.45 GB→12/6.511 GB，未执行 `image prune -a`，所有 tagged image 保留。
- 保护：PostgreSQL/Web/Worker 容器 ID 与镜像不变，RestartCount 0、OOM false；Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口。四个 ERP 卷、Trae/MySQL、六个匿名卷、resource-guard 备份均保留。
- 数据与资源：31 migrations、唯一启用 admin 1、其余 public 业务/Audit/Idempotency 0、uploads/attachments 0；Python PID `13737` 和 SQLite metadata 不变。根分区可用 14→37 GiB；60 秒 Swap 固定 151,064 KiB、Load1 0.79→0.37，PostgreSQL/Web 全程 healthy、Worker running。
- 验证：`git diff --check`、`npm test` 3/3、lint 0 error/9 warning、credentials 980 files 全部通过；Node 命令在一次一个的受限 `--rm` 容器中串行执行，未创建 Volume，容器均已清理，Build Cache 保持 0B。
- 结论：`DOCKER BUILD CACHE SAFELY CLEANED`；未停止或重建 Compose，未删除 Volume、匿名 Volume、tagged image 或业务数据，未启动 TASK08。

### SELFHOST-PHASE5-TASK07 - `ops: accept manufacturing batch workflow in parallel environment`

- 提交：功能提交 `3162edf5559512dd82ec363cf859d39bae2d5a0d` 严格 Parent `93902d9c3f7be94044cf9903af6e6fbebc685cc3`；聚焦修正 `dfd1581bc2e3cb072cd7f238e6a1b0097f8912f4`、`cd9f016570cf94eb2990362b56e8f51ef5d43db1`；独立 ops 提交实际哈希以 Git log 为准。
- 实际 HTTP：Work Order 10 建立 RELEASED Batch Set 和 digest；Batch A 4 完成四工序/IPQC，Batch B 6 的原检为 `6/4/2/4`、NCR v1 RETURNED/v2 ACCEPTED、同批 REWORK `2/2/0`、复检 `2/2/0/2`、AOI `4/2`。B REFLOW 加工次数 8、净量仍为 6。
- Report/Completion/Inventory：Final Output、Production Report、Completion 和 Ledger 分别为 `4/6`；Report/Completion 混批与跨 Batch Input Allocation 实际拒绝。Ledger `lot_code=''`、MAIN Balance 10；FQC/Shipment/Sales Source/AR/Settlement 0。生产批次谱系已建立，但仓库批次库存尚未启用。
- 保护与查询：发布数量不等、发布后修改、越权 403、CAS、幂等重放、同 Batch 返工继承、ORDER 模式、并发/故障/直接 SQL guard 和稳定 genealogy 查询通过。Batch 列表、详情、code 精确查询、WIP、Work Order 汇总和七项 Dashboard 指标按权限返回。
- 验证：208 项不重复 Node 自动测试通过（unit/UI 82、PostgreSQL/API 67、migration 40、npm/environment/manifest/coverage 19）；9 组 typecheck、Schema consistency、lint、双镜像 build、credentials、`git diff --check` 和 Python 三项通过。
- 重启与恢复：Compose 串行重启后 Batch/digest/Run/Inspection/NCR/Rework/Report/Completion/Ledger 全部保持；接受态 dump 1,638,643 bytes、SHA-256 `6a19e3a850dbb0014c00497f1916ba6f0c103f3035b631f348a4fe0e76f0f936` 恢复至固定第二新空库并核对完整 4/6 链。最终任务备份按清理计划删除，resource-guard 保留。
- 清理与资源：主库 31 migrations、唯一启用 admin，其余公共业务/Audit/Idempotency/临时账号/uploads/attachments 0；仅三容器四卷。起点/最终 available 约 2.4 GiB，Swap 148→148 MiB，磁盘 15→14 GiB；最终 60 秒 Swap 155,295,744→155,295,744 bytes，RestartCount 0/OOM false。
- 结论：`MANUFACTURING BATCH GENEALOGY ACCEPTED IN PARALLEL ENVIRONMENT`；未启动 TASK08。

### SELFHOST-PHASE5-TASK07 - `test: preserve rework migration journal assertion`

- 把 TASK06 的 0030 migration 回归从“journal 最后一项必须为 0030”改为精确查找并校验不可变 0030 项，使其可与新增 0031 共存；业务、回滚、Schema、snapshot 和完整 SHA-256 断言不变，重跑 5/5 通过。

### SELFHOST-PHASE5-TASK07 - `fix: satisfy manufacturing batch lint contract`

- 将 Batch 页面初始加载改为稳定 callback 与 effect 异步调度，避免同步 effect state update；移除 Batch Service 未使用 import。TASK07 unit/UI、typecheck、lint 0 error/9 warning、Vinext build 及 Web/Worker 串行镜像重建通过。

### SELFHOST-PHASE5-TASK07 - `feat: add manufacturing batch genealogy`

- 数据库：只新增 expand-only `0031_production_batch_genealogy.sql`；增加 Batch Set/Batch/Event、Operation Run nullable Batch ID、Report/Completion 单 Batch 关系、索引、服务写 guard、发布后不可变与 deferred 守恒；同步 Schema/journal/snapshot，不修改 0001—0030。
- 服务/API：新增 Batch 管理、列表/详情/code/WIP/genealogy/Work Order 汇总；NORMAL Run 强制同批、REWORK 沿稳定来源继承，跨 Batch Allocation、Report/Completion 混批与结构化 legacy 绕过 fail closed。
- UI/Dashboard：新增 `/production/batches`，扩展生产、品质、NCR、返工与完工页面显示 Batch code、NORMAL/REWORK、Hold、genealogy 和 Inventory Lot 边界；Dashboard 增加 DRAFT/待执行/WIP/Hold/Rework/Final Output/Completed Batch 指标。

### SELFHOST-PHASE5-TASK06 - `ops: accept production rework execution in parallel environment`

- 提交：功能提交 `1f6a143adbf78d7fb70fbed1ea7d7dfea62cfd4b` 严格 Parent `11bc680a91c59258c94f8ddca3d56af71981811e`；独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.30`/30 migrations；`0030` SHA-256/数据库 checksum 为 `37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：原 REFLOW IPQC inspected/passed/failed/released=`10/8/2/8`；v1 RETURNED/v2 ACCEPTED 后显式 REWORK 派工/开工/报工 `2/2/0`，未复检时 AOI available 保持 8；新 IPQC 异人关闭放行 `2/2/0/2` 后 available 变 10、Execution COMPLETED、NCR RESOLVED。AOI、Final Output、Production Report、Completion 和 Ledger 均为 `8/2`，Balance 10，工单 `10/10/10/0/10 COMPLETED`。
- 数量边界：SMT-PRINT、SMT-MOUNT、REFLOW NORMAL、AOI processed 均为 10，REFLOW REWORK processed 2；返工是重复加工次数，REFLOW 总加工次数 12 不增加净产品，正式报工/完工/成品仍为 10，原 failed 2 保持不改写。
- 保护：未复检派满 AOI、超 ACCEPTED quantity、已有复检冲销、错误状态/目标/跨工单、非 active operator、NORMAL/REWORK 伪造、权限 403、职责分离、幂等异正文、CAS、并发、故障半记录和直接 SQL 绕过均 fail closed。
- 持久与恢复：整体串行重启后完整返工闭环、Audit 56、Idempotency 46 保持；接受态备份 1,569,512 bytes、SHA-256 `f5e8011c4ef55b0393cceedfbb2ebbbf8171e44fe8cccea92012452d77f8e379` 恢复到固定第二新空库并核对 30 migrations 与完整 `8+2` 链。
- 清理与资源：最终主库 30 migrations、唯一启用管理员、其余业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；TASK06 测试/恢复库、两份任务备份、临时容器/辅助镜像/标签删除，resource-guard 备份保留。起点/最终 available 均约 2.4 GiB，Swap 141→153 MiB，磁盘 18→15 GiB，60 秒 Swap 正增长 0，RestartCount 0/OOM false。
- 结论：`PRODUCTION REWORK EXECUTION AND REINSPECTION ACCEPTED IN PARALLEL ENVIRONMENT`；未启动 TASK07。

### SELFHOST-PHASE5-TASK06 - `feat: add production rework execution`

- 数据库：只新增 expand-only `0030_production_rework_execution.sql`；既有 Run 增加 `NORMAL/REWORK` 类型与稳定 lineage，新增 Rework Run Allocation、Execution Projection/Event、唯一/队列索引、不可变和 deferred reconciliation guard；同步 Drizzle Schema/journal/snapshot，不修改 0001—0029。
- 服务/API：ACCEPTED Request 显式派工复用 TASK02 start/report/cancel/reverse；服务端派生工单、目标、来源和工作中心，返工 good 进入新 IPQC Hold，只有显式复检 `CLOSED + RELEASED` 才进入后序 WIP。取消/冲销只在无品质/下游时恢复请求余额和投影。
- UI/Dashboard：返工请求、派工、工序、WIP、生产质量与 NCR 页面区分 NORMAL/REWORK，并展示原 failed、派工/处理/good/scrap、待复检/放行和 Execution 状态；Dashboard 增加待派、在制、待复检、复检未过和完成数量，保持权限裁剪只读。
- 验证：178 项不重复自动测试通过（unit/UI 78、PostgreSQL/API 46、migration 37、npm 3、environment 6、manifest 8）；8 组 typecheck、Schema consistency、lint 0 error、build、965 文件凭证扫描、`git diff --check` 和 Python 三项通过。

### SELFHOST-PHASE5-TASK05 - `ops: accept production rework request workflow in parallel environment`

- 提交：功能提交 `1de057a6a248ca3346d7d2b0f201252a3965eced` 严格 Parent `736f14b9510ca52ce39fea7154872dffe7818986`；独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.29`/29 migrations；`0029` SHA-256/数据库 checksum 为 `6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：四 Work Center 与 `NONE/NONE/IPQC/NONE` Routing，planned/issued 10；REFLOW IPQC inspected 10/passed 8/failed 2，AOI available 8、Quality Hold 2。唯一 NCR 由 OPEN 进入 REWORK_PENDING/REWORK_ACCEPTED；v1 RETURNED 释放占用，v2 以新不可变提交快照和 digest 重提后 ACCEPTED，最终 active rework 2、scrap 0、unresolved 0。
- 保护：failed=0/缺 FAIL/Defect、超量、重复 Rework/SCRAP、后序/跨工单目标、职责分离、403、幂等重放/异正文、CAS、并发 submit/accept/SCRAP、故障零半记录、直接 SQL guard、ACCEPTED 修改/取消、Inspection reopen 和来源 Run 冲销均 fail closed；SCRAP 自动测试确认不可逆且不写 Inventory。
- 下游为零：接收申请未增加 AOI available，未创建 Rework Run、额外 Run Report、Production Report、Completion、Finished Goods Ledger/Balance、FQC、Shipment、AR 或 Settlement。
- 持久与恢复：Compose 整体串行重启后 NCR、v1/v2、2 个提交快照、6 个请求事件、digest、数量、Audit 44、Idempotency 30 保持；接受态备份 1,517,240 bytes、SHA-256 `440fae8efd3427a341d7c8d2d24ebf516de9ef9dfd9acb50b5e841ebf069afbc` 恢复到固定第二新空库并核对完整链。
- 清理与边界：最终主库 29 migrations、唯一启用管理员、其余所有业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；恢复库、两份 TASK05 备份、临时目录/容器/辅助镜像删除，resource-guard 备份保留。未操作 Python 服务、读取真实 SQLite 正文、执行返工工序、迁真实数据、启 HTTPS、切流、生产部署、push、PR 或 TASK06。
- 结论：`IPQC NONCONFORMANCE TO REWORK REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK05 - `feat: add production nonconformance handoff`

- 数据库：只新增 expand-only `0029_production_nonconformance_rework_handoff.sql` 与 NCR/Event、Rework Request/Version/Event、Allocation、Scrap Disposition 关系表；numeric、稳定外键、唯一/状态/索引、不可变 guard、服务写入口与 deferred 守恒阻止超量、跨工单和伪造目标；同步 Drizzle Schema/journal/snapshot，不修改 0001—0028。
- 服务/API：扩展既有 Quality/Production 边界，Inspection→唯一 NCR、DRAFT 编辑/提交、RETURN/ACCEPT、修订重提、SCRAP、队列/详情/数量/上下文全部执行 Session/must-change、CSRF、正文/速率限制、持久幂等、CAS、固定锁顺序、request_id、中文安全错误、Audit 与单事务回滚。
- UI/Dashboard：新增 `/quality/nonconformances`、`/quality/rework-requests`、`/production/rework-requests`；Dashboard 增加待处置 NCR、未分配数量、待接收、已接收待执行和最终工序报废五项权限裁剪只读指标。
- 验证：166 项不重复 Node 自动测试（unit/UI 72、PG/API 47、migration 38、npm 3、environment 6）通过；正式 TASK05 typecheck、Drizzle consistency、lint 0 error/8 个既有 warning、Vinext build、955 文件 credentials scan、`git diff --check` 和 Python 三项通过。

### SELFHOST-PHASE5-TASK04 - `ops: accept production quality gate workflow in parallel environment`

- 提交：功能提交 `5379550d0381818ad970518ac4fb8261c4679989` 严格 Parent `f6e5ff2e8344e79a35f56311b02b514613484f59`；Dashboard 验收路径聚焦修正 `56f63ca714ed6f359bc51f681b6a532259747f1b`，Parent 为功能提交；独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.28`/28 migrations；`0028` SHA-256/数据库 checksum 为 `a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：REFLOW Run Report good `4/6` 先形成 Hold 10、released 0、AOI available 0；两条 quality 显式稳定来源 IPQC 经异人处置/关闭后 inspected/passed/released=`4/6`、Hold `10→6→0`、AOI available `0→4→10`。随后 AOI、Final Output Allocation、Production Report、Completion 均为 `4/6`，Ledger `+4/+6`、Balance 10、Work Order `10/10/10/0/10 COMPLETED`，FQC/Shipment/Sales Source/AR/Settlement 0。
- 保护：未检派工拒绝、warehouse 越权 403、同正文幂等重放/异正文冲突、CAS、职责分离、超量、并发、直接 SQL、故障零半记录、有 IPQC 阻止 Run 冲销及下游消费阻止 reopen 均通过实际 HTTP 或专项 PostgreSQL 测试；NONE 直通和 TASK02/TASK03 冲销门禁回归通过。
- 持久与恢复：Compose 整体重启后 8 Run/Report、2 Inspection/Result、6 Quality Event、2 Report/Final Allocation/Completion、2 Ledger、Balance 10 保持；接受态停服备份 1,438,390 bytes、SHA-256 `4da56e4303afae15ac0e5e7e8f550711ec66cbcae669dcac8b4b1f4c8e360a65` 恢复到固定第二新空库并核对完整 4/6 链。
- 清理与边界：最终主库 28 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；恢复库、两份 TASK04 备份、临时目录/测试镜像/build 产物删除，resource-guard 备份保留。未操作 Python 服务、读取真实 SQLite 正文、迁真实数据、启 HTTPS、切流、生产部署、push、PR 或 TASK05。
- 结论：`PRODUCTION OPERATION IPQC GATE ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE5-TASK04 - `feat: add production operation quality gates`

- 数据库：只新增 expand-only `0028_production_operation_quality_gates.sql`；Routing/Snapshot Operation 增加 `quality_gate_mode`，Quality Inspection 增加稳定 Run Report 互斥来源，WIP 增加 required/inspected/released/hold/available/final 投影；同步 Drizzle Schema/journal/snapshot，不修改 0001—0027。
- 服务/API：Routing 发布 digest 与 Work Order Snapshot 固化门禁；既有 Quality Service 显式创建工序 IPQC并由服务端确定来源属性；下一工序和 TASK03 最终报工只消费 CLOSED/RELEASED 额度。历史 `production_report_id` IPQC 与 NONE 直通保持兼容。
- UI/Dashboard：Routing、dispatch、operations、WIP 和现有 Quality 页面展示稳定来源及 Hold/Release；Dashboard 增加待 IPQC、检验中、Hold、已放行待下工序/最终报工五项权限裁剪指标，保持只读。
- 验证：TASK04 专项 15 项，记录的 unit/UI、PostgreSQL/API、migration、manifest/coverage/environment 回归均通过；正式 typecheck、Schema consistency、lint、Vinext build、credentials scan、`git diff --check` 和 Python 三项通过。

### SELFHOST-PHASE5-TASK03 - `ops: accept structured final output workflow in parallel environment`

- 提交：功能提交 `1dae9661d07f7af7e866a1654804742372b8bc76` 严格 Parent `a6448ac42da737e31fee76085fb699e80f3c621b`；验收脚本职责分离和固定恢复目标聚焦修正为 `1a01172f14e9d4b3b51ec10430b188aa79efa96d`、`2eb5120bf98c9d45705cf96e2a25afb37cc154a3`，独立 ops 提交实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.27`/27 migrations；`0027` SHA-256/数据库 checksum 为 `b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：四 Work Center、四 Snapshot Operations 均以 `4/6` 执行，AOI final output `10→6→0`；有效 Production Report、Final Output Allocation、Completion、Report→Completion Allocation 均为 `4/6`，Ledger `+4/+6`、Balance 10、Work Order `10/10/10/0/10 COMPLETED`。正式 Report 前 Completion/成品库存/品质为 0；最终 IPQC/FQC/Shipment/Sales Source/AR 仍为 0。
- 保护：同正文幂等重放、异正文冲突、Work Order/final-output CAS、并发唯一消费、跨工单/非末序/冲销来源、直接 SQL guard、故障零半记录、403、无下游 Report 冲销恢复、Completion 下游阻止 Report 冲销及 Report 消费阻止 Run 冲销均通过专项或实际 HTTP。
- 持久与恢复：整体串行停/启后 8 Run、8 Run Report、3 Report（1 冲销）、3 Final Allocation、2 Completion、2 Completion Allocation、2 Ledger、Balance 10、Audit 51、Idempotency 41 保持；接受态备份 SHA-256 `16d63e5cbe1f85aa1a70f1414edb5a66d008faefe076b9739e92f9a71976f9f6` 恢复到固定第二新空库并核对完整事实。
- 清理与边界：最终主库 27 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0，仅三容器四卷；TASK03 测试库、恢复库、恢复目录和两份任务备份删除，既有 resource-guard 备份保留。未重启 Python、读取真实 SQLite 正文、迁真实数据、启 HTTPS、切流、部署、push 或创建 PR。
- 结论：`STRUCTURED FINAL OUTPUT TO FINISHED GOODS ACCEPTED IN PARALLEL ENVIRONMENT`；不启动 PHASE5-TASK04。

### SELFHOST-PHASE5-TASK03 - `feat: bind final operation output to production reporting`

- 数据库：只新增 expand-only `0027_production_final_output_reporting.sql` 和稳定 `production_report_operation_allocations`；同步 Drizzle Schema/journal/snapshot，不修改 0001—0026。外键、numeric、唯一/索引、不可变和 deferred reconciliation 防止超量、跨工单、非末序、伪造来源与投影失配。
- 服务/API：结构化 Report 只接受具体末工序 Run Report Allocation、Work Order/final-output CAS 和 Idempotency-Key；服务端生成数量、阶段与 operator，legacy 无 Snapshot 工单保持兼容，结构化 legacy report/complete 快捷路径 fail closed。详情、来源查询、冲销恢复、WIP/Work Order 和 Dashboard 已扩展。
- UI：`/production/reporting` 结构化模式只展示稳定来源和可用量，历史表单明确标记兼容；`/production/wip` 明示 WIP 非 MAIN 库存，warehouse 页面继续消费既有 Report。
- 验证：TASK03 专项 12 项，Phase 4 TASK06/TASK07、Phase 5 TASK01/TASK02、Production/Routing/Inventory/Dashboard/Identity 等回归 82 项，共 94 项自动测试通过；正式 typecheck、Schema consistency、lint 0 error、Vinext build、928 文件 credentials scan、`git diff --check` 与 Python 三项通过。

### SELFHOST-OPS-RESOURCE-GUARD-01 - `ops: add low-resource server safeguards`

- Git：严格 Parent `120e1524eaebd9d921cab6a036b3203bf7d39226`；保留并审阅既有 `server.py`、`compose.yml`、systemd unit 三项修改，追加根规则、专项测试和文档；不改版本、migration 或历史。
- Python：`ERPThreadingHTTPServer` 默认最多 16 个活跃请求线程，容量等待 1 秒后固定去敏 503；30 秒 socket timeout、daemon/non-blocking close 和正常/异常槽位释放通过轻量 2 项测试。通用 500 响应不再回显异常正文。
- Compose/systemd：PostgreSQL/Web/Worker/Migrate/Admin/Caddy 均配置 CPU、Memory、Memory+Swap、PID 限额；Web/Worker Node heap 384 MiB。unit 源含 CPU 75%、MemoryHigh 512M、MemoryMax 768M、Tasks 256、NOFILE 4096 并通过 verify；只读核验确认起点 installed unit 已一致且实际属性生效，本任务未复制、reload 或重启 Python。
- 运行应用：校验 PostgreSQL custom dump 后，固定 `COMPOSE_PARALLEL_LIMIT=1`、不 build，只逐个重建 Web/Worker；PostgreSQL 保持原容器。实际 inspect 与配置目标一致，26 migrations、唯一管理员、空业务基线、网络边界和四卷保持。
- 资源观察：起止 available memory 均约 2.2 GiB、Swap 约 42 MiB、磁盘可用 26 GiB，Load `0.33/0.27/0.49` → `0.05/0.14/0.32`；60 秒 Swap 增长 0，restart 0、OOM false，PostgreSQL/Web healthy、Worker running。
- 事故边界：2026-07-27 服务器重启/不可用根因 `UNKNOWN`，不得写成 OOM。Python 仍保留且只能由独立授权任务停用；结论不表示生产上线。
- 验证：Python 专项/self-test/smoke/临时 SQLite go-live、Compose config、systemd verify、受限单容器 TypeScript check、环境守卫、credentials scan 与 Git 检查串行执行；临时资源清理完成，恢复备份按计划保留。
- 结论：`LOW RESOURCE SERVER SAFEGUARDS ACTIVE`；未启动 PHASE5-TASK03，未 push、迁真实数据、切流或生产部署。

### SELFHOST-PHASE5-TASK02 - `ops: accept production wip workflow in parallel environment`

- 提交：功能提交 `77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c`，Parent 严格为 `d6554fcaea77cfe16320d98afcf9aed9c794bc3f`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.26`/26 migrations；`0026` SHA-256/数据库 checksum 为 `b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：production 账号对锡膏印刷、SMT贴片、回流焊、AOI 四个 Snapshot Operation 依次执行批次 `4/6` 的派工、开工和工序报工；每工序 processed/good/scrap=`10/10/0`，前三工序未转移 WIP 0，末工序 final output available 10。
- 业务边界：Work Order 保持 `IN_PROGRESS`；Production Report、Completion、Finished Goods Ledger/Balance、IPQC/FQC 均为 0。工序 WIP 未写入库存，也未虚构库位、批次或成品数量。
- 保护：权限 403、active operator、Work Center、前序来源、跳序、超量/并发派工、重复/并发开工、数量守恒、幂等重放/异正文冲突、CAS、scrap 隔离、取消、下游消费冲销阻断、无下游冲销恢复、故障零半记录和直接 SQL guard 通过。
- 持久与恢复：整体重启后 8 Run、8 Report、24 Event、4 Operation Projection、4 WIP 和 24 相关 Audit 保持；停服备份 `backup-20260726T235722Z-77ff520e8dbd` 校验并恢复到新空库，核对 `26|2|1|4|8|8|24|4|10|0|0|0`。
- 清理与保护：最终 26 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0，仅三容器四卷；临时数据库、备份/恢复目录、测试 SQLite、依赖卷和迁移容器均删除。任务未重启 Python；开始时 PID `277640`，外部并行变更后最终 PID 为 `13737`，SQLite metadata 最终仍为 `64769:53827608:1784999031:1544192`。
- 结论：`PRODUCTION OPERATION EXECUTION AND WIP ACCEPTED IN PARALLEL ENVIRONMENT`。未执行最终报工绑定、成品入库、返工、批次、设备、产能排程、真实数据迁移、切流、生产部署、push 或 PR。

### SELFHOST-PHASE5-TASK02 - `feat: add production operation execution`

- Git：功能提交 `77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c` 严格以 `d6554fcaea77cfe16320d98afcf9aed9c794bc3f` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0026_production_operation_execution.sql`，建立 Work Order Operation/WIP Projection、Run、Input Allocation、Run Report/Event/Reversal；完整外键、唯一、numeric、索引、不可变事实、服务写投影和延迟数量守恒 guard，同步 Drizzle Schema/journal/snapshot，不修改 0001—0025。
- 服务/API：Snapshot Operation 为工单执行权威；首工序取净领料支持量，后序按前序 Run good 的稳定 Allocation 线性消费；派工/取消、开工、追加报工和受控全额冲销在单事务内提交事实、投影、Audit 和 Idempotency。
- 权限/UI：新增 `production.dispatch`、`production.execute`、`production.operation.reverse`；production 获得 dispatch/execute，manager/admin 获管理能力，warehouse/quality 只读；新增 `/production/dispatch`、`/production/operations`、`/production/wip` 和五项 Dashboard 指标。
- 验证：TASK02 unit/UI/PostgreSQL/migration、Phase 4 TASK01—TASK10、Phase 5 TASK01、Production/Routing/Inventory/Dashboard、全部正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 临时库三项和 `git diff --check` 通过。
- 边界：WIP 不是 Inventory Ledger；最后工序 good 只形成待最终报工量，不自动创建 Production Report、Completion、库存或品质事实。

## 2026-07-26

### SELFHOST-PHASE5-TASK01 - `ops: accept production routing workflow in parallel environment`

- 提交：功能提交 `8eedfa07573c37e46d93f208162a0842c8d90a48`，Parent 严格为 `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.25`/25 migrations；`0025` SHA-256/数据库 checksum 为 `39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：operations 创建 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI`；engineering 提交 v1，异人 manager 发布；planned quantity 10 的工单释放后获得 BOM Snapshot 1、Routing Snapshot 1、10/20/30/40 四工序与 Reservation 10。
- 版本快照：v1 digest `d9756e1e1751c861953927dd299d89e57d90c5ddbcda2bde8d6600dcfa922f06`；v2 修改回流焊标准时间后发布，digest `2a3c5cda38ed6462f58b6d445a979fab58a3d6fccc255e1ee5be6bb934865962`。首张工单仍完整保持 v1，新工单使用 v2。
- 原子性与保护：路线缺失、停用、digest/产品版本不匹配和故障注入均整体回滚；职责分离、403、并发唯一 current、幂等重放/异正文冲突、CAS、Released/Snapshot 数据库不可变 guard 通过。路线本身不改变 on-hand；Material Issue、Production Report、Completion 均为 0。
- 持久与恢复：整体重启后 4 Work Center、2 Routing、2 Snapshot、8 Snapshot Operations、7 Routing Event 和 11 Audit 保持；停服备份 `backup-20260726T144314Z-8eedfa07573c` 校验并恢复到新空库，精确核对 `25|4|2|2|7|0|0|0`。
- 清理与保护：最终 25 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0，仅三容器四卷；临时数据库、备份/恢复目录和迁移容器删除。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PRODUCTION ROUTING AND WORK ORDER SNAPSHOT ACCEPTED IN PARALLEL ENVIRONMENT`。未执行工序开工/完工/报工、WIP、库存过账、真实数据迁移、切流、生产部署、push 或 PR。

### SELFHOST-PHASE5-TASK01 - `feat: add production routing snapshots`

- Git：功能提交 `8eedfa07573c37e46d93f208162a0842c8d90a48` 严格以 `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0025_production_routings.sql`，建立 Work Center、Routing Header/Version/Operation/Event 与 Work Order Routing Snapshot/Operation；补全外键、唯一、numeric、索引、不可变 guard 和服务 GUC，同步 Drizzle Schema/journal/snapshot，不修改 0001—0024。
- 服务/API：Work Center code 标准化、不可改、CAS 启停；Routing `DRAFT -> SUBMITTED -> RELEASED` 与退回、异人发布、服务端 canonical digest、并发唯一 current；Work Order RELEASE 在 TASK06 单事务中追加路线复核与不可变快照，失败零半记录。
- 权限/UI：operations 管理 Work Center，engineering 编辑/提交，manager/admin 发布/退回，production/planning 受限读取；新增 `/operations/work-centers`、`/engineering/routings`、`/production/dispatch` 及四项权限裁剪 Dashboard 指标，不提供虚假工序执行按钮。
- 验证：TASK01 unit/UI/PostgreSQL/migration、Phase 4 TASK01—TASK10 与 Production/Planning/BOM/Inventory/Dashboard 回归、正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 三项和 `git diff --check` 通过。
- 边界：旧 `process_stage` 只保留历史兼容，不自动生成路线；历史工单显示 `LEGACY_UNSTRUCTURED`；未实现派工、开工、完工、工序报工、WIP、返工、批次、设备、外协或库存过账。

### SELFHOST-PHASE4-TASK10 - `ops: accept project cashflow workflow in parallel environment`

- 提交：功能提交 `23fef6098a88466b94fcac104bba9317ba310d15`，Parent 严格为 `e63c726e0d274a8b7b654819794b4bd1044c6f82`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行验收：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.24`/24 migrations；`0024` SHA-256 `cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 实际 HTTP：AR `80/120`、AP `48/72`；收款 `30/50/120`、付款 `48/30/42`；Sales/Purchase Source `200/120`，未结 `0/0`、交易贡献/净现金 `80/80 CNY`、UNATTRIBUTED 0、Settlement Reversal 0、银行写入 0。
- 保护：类型错配、零/负/超额、并发、幂等/CAS、全额/重复/并发冲销、故障回滚、多 Project、UNATTRIBUTED、rounding、币种隔离、403 及 TASK05/TASK09 冲销门禁通过。
- 持久与恢复：整体重启后事实保持；停服备份 `backup-20260726T133340Z-23fef6098a88` 校验并恢复到新空库，精确核对 24 migrations、AR/AP、6 Settlement、4 Allocation、200/120 来源、UNATTRIBUTED/冲销 0。
- 清理与保护：最终 24 migrations、唯一启用管理员、业务/上传/附件 0，仅三容器四卷；临时恢复与备份工件删除。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PROJECT RECEIPT PAYMENT AND CASHFLOW ACCEPTED IN PARALLEL ENVIRONMENT`。未连接银行、迁真实数据、切流、生产部署、push 或 PR，也不宣称会计利润。

### SELFHOST-PHASE4-TASK10 - `feat: add project settlement traceability`

- Git：功能提交 `23fef6098a88466b94fcac104bba9317ba310d15` 严格以 `e63c726e0d274a8b7b654819794b4bd1044c6f82` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0024_finance_project_settlements.sql`，保存 Financial Source 行→Project/UNATTRIBUTED、数量/单价/金额/digest，补充外键、唯一/索引、延迟总额核对、不可变和稳定来源直接 SQL guard；同步 Drizzle Schema/journal/snapshot，不修改 0001—0023。
- 服务/API：复用唯一 Finance Document/Settlement/Reversal；AR 只收款、AP 只付款，部分/多次核销和追加式全额冲销保持单事务、并发锁、CAS、幂等、Event/Audit；项目视图按 Project/Currency 汇总来源、收付款和未结。
- 权限/UI：finance 管理收付款，manager/admin 查看项目汇总，sales/purchase 职责只读，engineering 查看本人项目去敏汇总；新增 `/finance/settlements`、`/finance/projects` 和六项 Dashboard 指标。
- 验证：TASK10 专项、TASK01—TASK09 回归、正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 隔离基线和 `git diff --check` 通过。
- 边界：`net_cash` 不是会计利润；未实现银行、总账、税票、汇率、成本会计、公司费用、正式利润、真实迁移或生产部署。

### SELFHOST-PHASE4-TASK09 - `ops: accept sales delivery receivable workflow in parallel environment`

- 提交：功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4`，Parent 严格为 `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.23`/23 migrations；`0023` checksum/SHA-256 为 `5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d`。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启 HTTPS/80/443。
- 实际 HTTP：Instruction 10 分两批 Shipment/FQC `4/6`；成品库存 `10→6→0`，SO 最终 SHIPPED，Sales Source `80/120`，finance 显式 AR `80/120`，Settlement/客户收款 0；三个原生页面 HTTP 200。
- 保护：实际验证指令零副作用、幂等重放、quality 越权 403、已有 AR 冲销门禁；隔离测试覆盖超订单/指令/库存/FQC、并发消费/执行/AR、CAS、异正文冲突、故障零半记录、无 AR 冲销恢复和 FQC Reopen 门禁。
- 持久与恢复：整体重启后 4/6 数量、库存、来源、AR、事件和审计保持；停服备份 `backup-20260726T105516Z-dfda1c5597cc` 校验并恢复到新空库为 `23|7|1|2|10|-10|200|200|0`。
- 清理与保护：最终 23 migrations、唯一启用管理员、业务/上传/附件 0，只保留三容器四卷；临时库和备份/恢复工件已删除。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT`。未收款、未迁真实数据、切流、生产部署、push 或 PR。

### SELFHOST-PHASE4-TASK09 - `feat: add fqc controlled sales delivery workflow`

- Git：功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4` 严格以 `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0023_sales_delivery_receivable.sql`，建立发货指令/行/事件、执行行和 Shipment Line→FQC Release Allocation，补充容量、来源、不可变、FQC reopen 与可信金额数据库 guard；同步 Drizzle Schema/journal/snapshot，不修改 0001—0022。
- 服务/API：复用 Sales Order/Shipment/Reversal、TASK08 Allocation/FQC、Inventory Ledger/Balance、Sales Financial Source 和 Finance AR；Instruction 创建零副作用，warehouse 分批执行原子更新全部跨域事实，finance 仍显式创建 AR。
- 权限/UI：sales、warehouse、quality、finance 和 manager/admin 最小分权；新增 `/sales/delivery`、`/warehouse/shipping`、`/finance/receivables` 与五项 Dashboard 指标。
- 验证：TASK09 unit/UI/PG/migration、TASK01—TASK08 及 Sales/Quality/Inventory/Finance/Dashboard 回归、17 个正式 typecheck、Schema consistency、lint/build、凭证扫描、Python 三项和 `git diff --check` 通过。
- 边界：未实现或执行客户收款、Settlement、银行、总账、税票、收入确认、真实数据迁移或生产部署。

### SELFHOST-PHASE4-TASK08 - `ops: accept production quality workflow in parallel environment`

- 提交：功能提交 `4a638522b7ca295b41d2f35adbc464b23762b007`，Parent 严格为 `7d9c2dbaf62664e46c4f984822bb43903999f5fd`；独立 ops 提交以功能提交为 Parent，不 amend/rebase，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.22`/22 migrations；`0022` 数据库 checksum 与源码 SHA-256 均为 `65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 HTTPS/80/443。
- 实际 HTTP：production/warehouse/sales/quality/manager 真实隔离账号完成 Report、Completion、成品订单稳定 Allocation、IPQC 和 FQC 各 `4/6`；manager RELEASE、quality Close 后 FQC inspected/passed/released=`10/10/10`，订单行 available=10，成品库存保持 10。
- 边界与保护：Shipment、Sales Financial Source、AR 均为 0；实际验证职责分离、越权 403、幂等重放和 CAS，隔离自动测试覆盖来源不一致、双侧超分配/并发、取消与 Completion 冲销门禁、超检、Defect 守恒、处置上限、HOLD、消费后重开门禁和故障零半记录。
- 持久与恢复：整体重启后 2 Allocation/2 Allocation Event、4 Inspection/Result、12 Inspection Event、放行 10、库存 10 和 14 个关键成功审计保持；停服备份 `backup-20260726T062301Z-4a638522b7ca` 校验并恢复到新空库为 `22:2:4:4:12:10:10:0:0:0`。
- 清理与保护：主库最终 22 migrations、唯一启用管理员、业务/上传/附件 0；临时数据库、备份/恢复目录、辅助容器/镜像已删除且不可从本机临时工件恢复，保留三容器和四卷。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PRODUCTION QUALITY RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`。未迁真实数据、切流、生产部署、push 或 PR；未启动 Shipment、AR、收款或其他任务。

### SELFHOST-PHASE4-TASK08 - `feat: add production quality release workflow`

- Git：功能提交 `4a638522b7ca295b41d2f35adbc464b23762b007` 严格以 `7d9c2dbaf62664e46c4f984822bb43903999f5fd` 为 Parent；不 reset/stash/rebase/amend/force push。
- 数据库：仅新增 expand-only `0022_production_quality_release.sql`，建立 Completion Line→Sales Order Line Allocation/Event、Quality Inspection 稳定 Allocation 引用、容量/来源/不可变/冲销数据库 guard；保留历史 Quality 兼容并同步 Drizzle Schema/journal/snapshot，不修改 0001—0021。
- 服务/API：复用 `quality-selfhost` 的 Inspection/Result/Defect/Event、职责分离、Disposition、Close/Reopen 与 Shipment 门禁；新增分配候选/列表/创建/取消和订单行 eligibility，IPQC 只引用未冲销 Report，FQC 只引用有效 Allocation。
- 权限/UI：sales 管理分配，quality 创建/关闭检验，manager/admin 处置/重开，production/warehouse 受限读取；新增两条原生页面和五项权限裁剪 Dashboard 指标。
- 验证：TASK08 unit/UI/PostgreSQL/migration、TASK01—TASK07 与 Production/Quality/Sales/Inventory/Dashboard 回归、16 组 typecheck、Schema consistency、lint/build、凭证扫描、Python 三项和 `git diff --check` 通过。
- 边界：功能不执行 Shipment、不扣减成品库存、不创建销售金额来源、AR 或收款，不扩展 IQC 隔离、批次/序列、返工/报废过账，不迁真实数据或生产部署。

### SELFHOST-PHASE4-TASK07 - `ops: accept production completion workflow in parallel environment`

- 提交：功能提交 `323e85d44a2a4202811944591d0a4f6b96ae6751`，Parent 严格为 `26ccb95782478645720c8284c59b0afadca68649`；独立 ops 提交以功能提交为 Parent，不 amend，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.21`/21 migrations；数据库 `0021` checksum 与源码 SHA-256 均为 `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 HTTPS/80/443。
- 实际 HTTP：复现 TASK06 完整领料 10；production 分批 Report `4/6`，warehouse 分批 Completion `4/6`，Allocation、Completion Line 和成品 Ledger 均为 `4/6`，Work Order reported/good/completed=10、scrap=0、状态 `COMPLETED` 且无 `CLOSED` 事件，成品 Balance=10。
- 下游与保护：IQC/IPQC/FQC、Shipment、销售金额来源和 AR 均为 0；隔离自动测试覆盖领料支持量、good/scrap、Report/工单余量、并发消费、幂等异正文、CAS、故障零半记录、越权、scrap 零库存以及 Report/Completion 冲销与 IPQC/FQC/Shipment 门禁。
- 持久与恢复：PostgreSQL/Web/Worker 整体重启后全部 Handoff/Reservation/Issue/Report/Allocation/Completion/Ledger/Event/Audit 持久；接受态备份 `backup-20260726T050445Z-323e85d44a2a` 恢复为 21 migrations、2 Report/Allocation/Completion、Balance 10、下游 0；干净态备份 `backup-20260726T050530Z-323e85d44a2a` 恢复为 21 migrations、唯一管理员、业务/文件 0。
- 清理与保护：两份临时备份、恢复数据库/目录、隔离测试数据库、辅助容器/镜像均已删除且不可从本机临时工件恢复；最终仅三容器和四个并行持久卷。Python PID `277640` 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PRODUCTION REPORTING AND FINISHED GOODS RECEIPT ACCEPTED IN PARALLEL ENVIRONMENT`。未创建品质/发货/财务事实，未迁真实数据、切流、生产部署、push 或 PR。

### SELFHOST-PHASE4-TASK07 - `feat: add production reporting and completion handoff`

- Git：以 `26ccb95782478645720c8284c59b0afadca68649` 为严格 Parent；不 revert/reset/amend/rebase，不 push 或创建 PR。
- 数据库：仅新增 expand-only `0021_production_reporting_completions.sql`，复用既有 Work Order/Report/Completion/Inventory 权威并增加 Report→Completion Allocation、Report/Completion reversal、不可变事件和 version/投影 guard；同步 Drizzle Schema/journal/snapshot，SHA-256 `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`，不修改 `0001`—`0020`。
- 服务/API：Report 只消费 BOM Snapshot 与净领料共同支持量；Completion 必须显式消费未占用 good quantity，并在同一事务原子写 Allocation、成品 Ledger/Balance、工单投影/状态、Event/Audit/Idempotency。Report/Completion 全额冲销均追加反向事实并执行 IPQC/FQC/Shipment/库存下游门禁。
- 权限/UI：production 报工并按授权冲销，warehouse 分批完工入库/冲销，manager/admin 管理，其他角色无写权限；新增 `/production/reporting`、`/warehouse/production-completions`，扩展工单进度和四项权限裁剪 Dashboard 指标。
- 验证：TASK07 unit/UI/PostgreSQL/migration，TASK01—TASK06、Production/Inventory/Quality/Sales/Dashboard 回归，全部正式 typecheck、Drizzle consistency、lint/build、凭证扫描、环境/API coverage、Python 三项和 `git diff --check` 已通过；并行真实 HTTP、整栈重启、备份恢复与最终清理将在独立 ops 验收提交完成。
- 边界：未创建 IQC/IPQC/FQC、Shipment、销售金额来源或 AR/AP；未迁真实数据、启用 HTTPS/80/443、切流或生产部署。

### SELFHOST-PHASE4-TASK06 - `ops: accept production material issue workflow in parallel environment`

- 提交：功能提交 `a8272b7c968e0fdcbce017aa0e41bad281702e50`，Parent 严格为保留的 `b45616e1115aab7d22d1b9a7e58f792005291524`；独立 ops 提交不 amend，实际哈希以 Git log 为准。
- 并行部署：只更新 `chenyida-erp-parallel` 至 `0.1.0-alpha.20`/20 migrations；`0020` 数据库 checksum 与源码 SHA-256 均为 `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`。Web 仍仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 HTTPS/80/443。
- 实际 HTTP：planning/production/warehouse 真实隔离账号完成 v1 提交→production 退回、planning 新建并提交 v2→production 接收→唯一 DRAFT 工单；DRAFT reserved/Issue/Ledger 为 0。释放后 requirement/on-hand/reserved/available=`10/10/10/0`；warehouse 分批领料 4/6 后余额依次 `6/6`、`0/0`，net issued 依次 4/10，两个出库 Ledger 合计 -10，工单为 IN_PROGRESS。
- 下游与保护：Production Report、Completion、Finished Goods Ledger、IQC/IPQC/FQC 均为 0；隔离测试覆盖缺料零半记录、并发预留、重复工单、超领、持久幂等、CAS、故障注入、未领取消释放、已领取消阻止、退料恢复和越权 403。
- 持久与恢复：整栈重启后 2 个 Handoff、1 个 WO、1 个 Reservation、2 个 Issue 和下游零事实保持；接受态 0020 停服备份恢复到新空库通过，最终干净 0020 再次备份并恢复到第二个新空库为 20 migrations/唯一管理员/业务 0。
- 清理与保护：并行主库最终 20 migrations、唯一启用管理员，所有业务表、uploads、attachments 为 0；临时数据库、恢复目录、备份工件、临时容器/镜像已清理，四个并行持久卷保留。Python systemd 仍 `enabled/active`、PID `277640`、SQLite metadata `64769:53827608:1784999031:1544192` 不变。
- 结论：`PLANNING TO PRODUCTION MATERIAL ISSUE ACCEPTED IN PARALLEL ENVIRONMENT`。未执行报工、完工、品质、真实数据迁移、HTTPS、切流、生产部署、push 或 PR。

### SELFHOST-PHASE4-TASK06 - `feat: add planning to production material handoff`

- Git：以必须保留的仅文档提交 `b45616e1115aab7d22d1b9a7e58f792005291524` 为严格 Parent；不 revert/reset/amend/rebase，不 push 或创建 PR。
- 数据库：仅新增 expand-only `0020_production_handoff_reservations.sql`，建立版本化 Handoff/Item/Event、交接行→既有 Work Order 唯一链接和 Production Inventory Reservation/Event；同步 Drizzle Schema/journal/snapshot，SHA-256 `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`，不修改 `0001`—`0019`。
- 服务/API：新增 `production-handoff-selfhost` 编排边界；接收后调用既有 Production 事务入口创建唯一 DRAFT 工单。RELEASE 在同一事务复制既有 BOM Snapshot/Requirement、结构化核验缺料、写 Reservation 来源事实并更新 Balance；领退料继续复用既有 Production/Inventory 权威入口。
- 权限/UI：planning 准备/提交，production 接收/退回/建单/释放，warehouse 分批领退料，manager/admin 管理；新增 `/planning/production-handoffs`、`/production/work-orders`、`/warehouse/production-issues` 和四项权限裁剪 Dashboard 指标。
- 验证：TASK06 unit/UI/typecheck、隔离 PostgreSQL 主旅程与保护、TASK01—TASK05、Planning/Inventory/Production/Dashboard、空库/0019 升级/重复/失败回滚、全部正式 typecheck、Drizzle consistency、lint/build、凭证/环境/API coverage 和 Python 三项已通过；并行 HTTP/重启/恢复/清理将在独立 ops 验收提交完成。
- 边界：未实现或执行报工、完工、成品库存、品质、发货、付款/银行/总账/税票、真实数据迁移、HTTPS、切流或生产部署。

### PHASE0-TASK03 - `docs: establish self-hosted release tracking baseline`

- Git：以 clean 的 `main` / `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4` 为起点；只读远端核验 `origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`，本地任务开始时领先 27 个提交，不再沿用“已同步”的旧描述。
- 发布：保留 2026-07-24 的 `0.1.0-alpha.1`/PostgreSQL `0001`—`0005` 原始非生产定义；当前源码与回环并行验收面记录为 `chenyida-erp-selfhosted@0.1.0-alpha.19`/`0001`—`0019`，没有降级 package 或升级依赖。
- Migration：重新核对 PostgreSQL `0001`—`0019`、D1 `0000`—`0008`、SQLite `0001`—`0004` 的仓库文件与 SHA-256；并行 PostgreSQL 19 个已应用 checksum 和本机 SQLite 四个已应用版本均通过只读核验，未访问生产 D1/数据库。
- 运行面：确认 Python/SQLite systemd 仍 `enabled/active`、PID `277640`、监听 `0.0.0.0:18888`；Node/PostgreSQL 仅为回环并行开发验收环境，未生产发布。真实账号、文件和业务数据未迁移，采购、库存、生产、销售、品质、财务仍依赖 Python/SQLite。
- 文档：更新 `RELEASES.md` 的版本矩阵、验收/回退模板和后续复核记录，同步 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`STATUS.md`，并在 TASK04 完成报告中只追加后续提交事实而不改写原始 dirty 状态。
- 验证：Node lint 0 error/5 个既有 warning、test 3/3、review typecheck、Vinext build 5/5、凭证扫描 819 文件；Python self-test、smoke、临时 SQLite go-live 与 `git diff --check` 通过。仅文档变更，未访问生产、部署、迁移真实数据、重启服务、push 或创建 PR。

### SELFHOST-PHASE4-TASK05 - `ops: accept sourcing fulfillment workflow in parallel environment`

- 部署：在既有 `chenyida-erp-parallel` 原地从 `0018` 升级到 `0019`，PostgreSQL/Web healthy、Worker running；Web 仍仅绑定 `127.0.0.1:3000`，PostgreSQL 不暴露宿主端口。
- 实际旅程：purchase 显式把供应商 A 的 Award `10 × 12` 转为 PO 并建立到货计划；创建计划时 Receipt/Ledger/AP 均为 0。warehouse 分两批收货 `4/6`，库存为 `4/10`，采购财务来源为 `48/72`；finance 分别显式生成 AP `48/72`，AP 合计 `120`。
- 安全与一致性：实际 HTTP 验证分权、同正文幂等重放、异正文冲突、CAS、超收拒绝、已有 PO 阻止 Award 撤销、已有 AP 阻止 Receipt 冲销；专项 PostgreSQL 测试覆盖并发唯一转单和故障注入零半记录。
- 持久与恢复：Compose 整体重启后 Award→PO→Plan→Receipt→Ledger/Balance→Source→AP 数量、金额、事件和审计保持；停服备份通过校验并恢复到第二个新空数据库，随后用干净 `0019` 恢复点清理当前并行库。
- 清理与保护：最终 19 migrations、唯一启用管理员、零临时账号和零合成业务；Python PID `277640`、18888 与 SQLite metadata `64769:53827608:1784999031:1544192` 不变；未 push、未切流、未迁真实数据、未部署生产，不启动 TASK06。
- 结论：`SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK05 - `feat: connect sourcing awards to receiving and payables`

- 数据库：新增且仅新增 expand-only `0019_sourcing_purchase_fulfillment.sql`，建立 Award Line→PO Line、到货计划、待入库队列、Receipt Line 分配和不可变计划事件；同步 Drizzle schema/journal/snapshot，SHA-256 为 `6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a`，不修改 `0001`—`0018`。
- 服务/API：新增 `procurement-fulfillment-selfhost` 编排边界，显式转 PO、显式建计划、分批收货/冲销；单事务复用既有 Procurement Receipt、Inventory Ledger/Balance 和 purchase financial source，Finance 仍由财务人员显式消费来源生成 AP。
- 规则：关系唯一约束、行锁、持久幂等、expected version/CAS 和数据库 guard 保证 Award Line 最多转一次、来源事实不静默变化、禁止超收和部分提交；已生成 PO 的 Award、已有 AP 的 Receipt 均 fail closed。
- 权限/UI：purchase、warehouse、finance 与 manager/admin 最小分权；新增 `/procurement/fulfillment`、`/warehouse/receiving`、`/finance/payables` 三条原生可操作页面，Dashboard 区分待生成和已生成 AP。
- 验证：TASK05 unit/UI、PostgreSQL/API、migration、TASK01—TASK04 及 Identity/Master Data/Supplier Mapping/Procurement/Inventory/Finance/Dashboard 回归、全部正式 typecheck、Schema consistency、lint/build/凭证/Python 基线通过；功能提交为 `859454c97acddbff8c5199d91c41d636a6ca24e0`。

### SELFHOST-PHASE4-TASK04 - `ops: accept procurement sourcing workflow in parallel environment`

- 部署：从功能提交 `4506db2579c07080afe27b33bb2e50623c3d1366` 重建并行 migrate/Web/Worker，只应用 `0018`；PostgreSQL/Web healthy、Worker running，Web 保持 `127.0.0.1:3000`。
- 实际旅程：临时 planning/purchase 账号通过 must-change 和分权；A 报价 `12.000000`、准时、排名 2，B 报价 `10.000000`、晚交、排名 1；采购以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”选择 A。
- 下游证据：Award=1、Sourcing Event=5、成功采购审计=6，而 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 为 `2.000000` 且未变。
- 持久与清理：Compose 整体重启后 Award/理由/API/UI 持久；随后整体恢复干净 0018 点，最终 18 migrations、唯一管理员、全部验收业务 0；临时账号、脚本和 root-only 恢复工件已删除。
- 保护：Python PID `277640`、18888 和 SQLite metadata `64769:53827608:1784999031:1544192` 不变；未迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK05。
- 结论：`PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK04 - `feat: add procurement sourcing workflow`

- 数据库：新增 expand-only `0018` 十表 RFQ/报价版本/比较版本/Sourcing Award/Event 模型、`numeric(24,6)`、有效 Round/当前报价/每行唯一 Award 索引、稳定外键、服务写守卫与不可变/来源完整性 trigger；不修改 0001—0017。
- 规则/API：新增独立 `procurement-sourcing-selfhost` 边界和 9 组路由；只接最新 ACCEPTED 采购申请与 ACTIVE/1:1 Mapping 供应商，固定 CNY/单位口径，服务端按税费/运费分组确定性排名，人工理由定标与保留历史撤销。
- 权限/UI：purchase 全部询比价能力，planning 进度只读，manager/admin 全部；新增两条原生采购询价路由与 Dashboard 三项待办，不提供创建采购订单入口。
- 安全/边界：Session/must-change、权限、CSRF、有界正文、持久幂等、CAS、并发锁、Event/Audit/Idempotency 单事务；Award 不创建 PO/Receipt/Inventory/AP，不修改 Planning Allocation 或 `reserved_qty`。
- 验证：专项 unit/UI 6/6、PostgreSQL/API 2/2、migration 3/3、Schema consistency 与目标 typecheck 通过；Identity、Supplier Mapping/Master Data、Procurement、Project、Planning、Material Requirement、Dashboard、FileStorage 与环境守卫回归通过；ESLint 0 error、Vinext build 5/5、800 文件凭证扫描、diff check 和 Python 三项通过。并行环境验收在功能提交后独立记录。

### SELFHOST-PHASE4-TASK03 - `ops: accept planning material requirement workflow in parallel environment`

- 部署：从功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969` 重建并行 migrate/Web/Worker，只应用 `0017`；PostgreSQL/Web healthy、Worker running，Web 继续只绑定 `127.0.0.1:3000`。
- 实际旅程：临时 planning/purchase 身份完成 `100.000000 - 55.000000 - 40.000000 = 5.000000` 的 v1 提交、采购退回释放、v2 重算重提和最终接收；正式 `reserved_qty` 保持 `10.000000`。
- 持久与清理：Compose 重启后 v2 Plan/PR ACCEPTED 与页面/API 保持；随后用已验证 `0016` 恢复点清理并重新应用 `0017`，最终 17 migrations、唯一管理员，全部 TASK03/Project/PO/Receipt/WO 业务为 0，临时恢复工件已删除。
- 保护：没有新增 PO、收货或工单；Python PID `277640`/18888 保持，未读/迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK04。
- 结论：`PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK03 - `feat: add planning material requirement handoff`

- 数据库：新增 expand-only `0017` 六表、`numeric(24,6)` 数量、关系约束/索引、服务写守卫、不可变与延迟完整性 trigger；Planning Allocation 独立于 Inventory `reserved_qty`。
- 规则/API：只聚合最新 ACCEPTED Package 固化 Material+Unit；SUBMIT 锁定来源并由 PostgreSQL 重算库存/有效在途/其他计划分配，来源变化稳定冲突；只为正净需求创建 PRQ，退回释放有效分配且必须新版本重算。
- 权限/UI：planning prepare/submit，purchase decide，manager/admin 全部；新增 7 组 API、计划物料需求与采购申请工作台、Dashboard 待办，不创建 RFQ/供应商/比价/PO/收货/生产事实。
- 验证：TASK03 unit/UI 6/6、PG/API 3/3、migration 3/3；TASK02、Dashboard、migration tool、FileStorage、typecheck、lint/build、780 文件凭证、diff check 与 Python 三项通过。功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969`。

## 2026-07-25

### SELFHOST-PHASE4-TASK02 - `ops: accept project planning workflow in parallel environment`

- 部署：从功能提交 `9236884f6cd96385c9c7050b29f57e7268142208` 重建并行 migrate/Web/Worker，只应用 `0016`；PostgreSQL/Web healthy、Worker running，Web 继续只绑定回环。
- 实际旅程：临时 sales/engineering/planning 身份完成项目接收、显式 Product/BOM Resolution、v1 不可变快照提交、计划退回、项目修订生成 v2、重提与最终接收；numeric 毛数量为 `34.375000`。
- 持久与清理：Compose 重启后 Project、两个包、事件、队列 API 与原生页面保持；随后整体恢复干净 0016 点，最终 16 migrations、唯一管理员，所有合成主数据/项目/交接/采购/生产记录为 0。
- 保护：Python PID `277640`、18888 和 SQLite metadata 不变；未读/迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK03。
- 结论：`PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK02 - `feat: add project planning handoff workflow`

- Identity/权限：新增正式 planning 角色及 read/accept 能力；engineering 获 read/prepare/submit，manager/admin 全能力，production 不代替计划员。
- 数据库：新增 expand-only `0016` 六表独立 Project→Planning 模型、稳定 Resolution、不可变版本包/BOM/文件快照和只追加事件；同步 schema/journal/snapshot/checksum，不修改 0001—0015 或 TASK01 事实。
- API/UI：新增独立 planning-handoff 服务边界、8 条 API、项目解析/版本工作台、计划待办/接收/退回工作台和 Dashboard 待接收指标。
- 规则：只接受 ACCEPTED 项目负责人、客户一致 RELEASED Product/BOM、ACTIVE Material/enabled Unit；PostgreSQL numeric 固化毛数量，不读库存、不创建需求/采购/生产单据。
- 验证：TASK02 unit/UI 6/6、PG/API 3/3、migration 3/3、Schema consistency、typecheck、lint、build 通过；功能提交为 `9236884f6cd96385c9c7050b29f57e7268142208`，后续并行验收由独立 ops 记录。

### SELFHOST-PHASE4-TASK01 - `ops: accept market project workflow in parallel environment`

- 部署：从功能提交重建 `chenyida-erp-parallel` migrate/Web/Worker，只应用 `0015`；管理员保留，Web/PostgreSQL healthy、Worker running。
- 实际旅程：两个独立 sales/engineering 账号完成直接接收，以及退回原因→不可变需求 v2→重新提交→最终接收；两个项目最终 ACCEPTED，四类事件和 Project Audit/request_id 完整。
- 持久与清理：Compose 重启后事实保持；随后恢复 0015 已应用的空验收点，临时账号、客户、项目和事件清零，Schema/唯一管理员保留，临时 root-only 恢复点删除。
- 保护：Python PID `277640`、18888 与 SQLite inode/size/mtime/mode 不变；未读/迁真实数据、未启 HTTPS、未切流、未 push，不启动 TASK02。
- 结论：`MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

### SELFHOST-PHASE4-TASK01 - `feat: add market project handoff workflow`

- 数据库：新增 expand-only PostgreSQL `0015` 六表关系模型、稳定项目编号、需求版本/行、受控文件引用、交接投影和不可变事件；同步 Drizzle journal/snapshot/schema 与固定 checksum，不修改 0001—0014。
- 服务端：新增独立 Project Repository/Service/Handler/Validation；sales 市场和 engineering 项目严格分权，执行 CSRF、24h 持久幂等、CAS、并发锁、职责分离、中文稳定错误、request_id 和单事务 Audit。
- UI：新增 `/business/projects` 与 `/engineering/projects`，覆盖草稿/修订/提交、退回原因/重提、待接收/已接收和安全资料元数据；Dashboard 增加“市场部门”“项目部门”入口。
- 验证：专项 unit/UI 7/7、PG/API 3/3、migration 3/3；Identity/Master/Sales unit/UI 21/21、PG/API 14/14；typecheck、lint、build、manifest、credentials、diff check 和 Python 临时 SQLite 三项通过。
- 边界：功能提交后才部署并行验收环境；当前不标记 DONE，不启动 TASK02，不迁真实数据，不创建下游 Product/BOM/计划/采购/生产对象。

### SELFHOST-PHASE3-TASK05 - `ops: deploy parallel self-hosted acceptance environment`

- 部署：创建并保持运行 Compose 项目 `chenyida-erp-parallel`，只启动 PostgreSQL 17、migrate、Web、Worker和四个持久 Volume；版本保持 `0.1.0-alpha.14`，migration 保持 `0001`—`0014`。
- 安全：配置和一次性管理员凭据位于 `/etc/chenyida-erp/`，root-only 0600；管理员密码不进长期 env。setup token 初始化后已轮换；Web 只绑定 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启动 Caddy/80/443。
- 管理员与验收：创建唯一 `admin`，重复初始化返回 `SETUP_COMPLETE`；health、根工作台、login/session/logout、Dashboard 空状态和 23/23 legacy GET 通过，完整重启后 14 migrations 与管理员持久。
- Bug 修复：处理 PostgreSQL restart 时 `pg` Pool 空闲连接 `57P01`，只记录去敏 code；Worker 轮询对短暂基础设施错误重试。新增 2 个专项测试，并通过 typecheck、目标 lint、镜像 build 与只重启数据库的 Worker 进程连续性验收。
- 资源保护：部署前后 Python PID 均为 `277640`、18888 返回 200，SQLite inode/mode/size/mtime 不变；稳态可用内存约 2.2GiB、磁盘 39GB，未触发停止条件。
- 文档：新增任务/完成报告和 `parallel-http-acceptance.md`，同步 MASTER/TASKS/PROJECT_CONTEXT/ARCHITECTURE/RELEASES/STATUS。
- 边界：结论仅为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`；未迁真实数据、未双写、未切流、未启 HTTPS、未修改 Python systemd/SQLite、未访问 D1/远程数据库、未 push/PR。

### SELFHOST-PHASE3-TASK04 - `feat: add authorized readonly migration inventory`

- 快照：新增精确本机源守卫、SQLite `mode=ro`/`query_only` online backup、manifest/SHA/Schema fingerprint 绑定、成功/失败临时资源清理和源/PID 不变核验。
- 工具：迁移 CLI 新增 `REAL_READONLY_INVENTORY`，强制显式确认、snapshot manifest/SHA、Git/tool version、`--no-materialize`、`--no-files`、任务临时输出和无 target；不创建 PostgreSQL adapter、staging/public/Opening。
- 脱敏：对获准快照执行 Schema、计数、固定枚举、质量错误和数量/金额聚合；自由文本不 DISTINCT，行级处置仅使用 task-local HMAC opaque reference。
- 真实执行：29 表、3,619 条；planned 49、archive-only 3,566、needs-review 4、blocked/model-gap/orphan 0；Inventory Opening 只读计划 4 条，Finance 0；target NONE、物化 0、文件正文读取 0，快照已删除。
- 验收：TASK04 3/3、tool 8/8、unit/UI 98/98、npm 3/3、PG/API 73、upgrade 30、backup/restore、全 HTTP journey、8 组 typecheck、lint/build/environment/credentials 和 Python 三项通过。
- 版本/数据库：`0.1.0-alpha.14`；PostgreSQL migration 保持 `0001`—`0014`，未创建 `0015`，checksum 与 `db/schema.ts` 不变。
- 边界：结论仅为 `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`；未执行真实 PostgreSQL 试迁移、D1/附件盘点、生产恢复、部署、push 或 PR。

### SELFHOST-PHASE3-TASK03 - `feat: materialize synthetic migration into business tables`

- 功能：新增仅 CLI 可达的受控 public materializer、actual public ID/provenance/target digest、聚合事务 checkpoint、合成文件原子写和 snapshot/archive-only 分类；post-cutover 采购、生产、销售、品质和财务只通过正常领域 Service/API 创建。
- 核对：30 条合成来源形成 18 个 actual public targets、12 个 archive-only；Inventory Opening `112.000000/4.000000`、Finance Opening `6.500000/7.250000`。全域旅程后 Dashboard AR/AP `56.500001/27.250000`、4 个 Quality CLOSED、23/23 legacy GET，`erp_records=0`。
- 恢复：停服 backup/verify 恢复到第二个新空目标；14 migrations、关键业务表、18 maps 和 17-byte 文件 SHA 一致。同 manifest replay 无重复，PostgreSQL/Web/Worker 整体重启后 Dashboard/API 再通过。
- 验收：tool 8/8、materializer PG 3/3、TASK01/TASK02 专项、TASK02—TASK10 unit/UI、全部 PG/API 和 migration upgrade、8 组 typecheck、Schema consistency、npm test、lint/build/environment/credentials 与 Python 三项通过。
- 版本/数据库：`0.1.0-alpha.13`；PostgreSQL migration 保持 `0001`—`0014`，未创建 `0015`，旧 checksum 与 `db/schema.ts` 不变。
- 边界：未读取真实数据库、备份、上传、附件或归档；未访问生产、重启 Python、部署、push 或建 PR。结论仅为 `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`，生产仍为 `NO-GO FOR REAL DATA / PRODUCTION`。

### SELFHOST-PHASE3-TASK02 - `feat: add controlled migration opening balances`

- 数据库：新增 expand-only PostgreSQL `0014`，建立去正文的 migration source、Inventory Opening/Line/Reversal、Finance Opening/Reversal；扩展 Inventory/Finance 约束、索引、不可变 trigger 和内部 service-write guard，不修改 `0001`—`0013`、不自动回填。
- 物化：类型化 command 绑定 manifest/source/mapping/target digest；内部 Service 在同一事务写库存 Adjustment/Ledger/Balance 或财务 `OPENING_AR/AP`/Event，并伴随 Audit、Idempotency；无 Web/legacy 写路由。
- 更正：原期初事实不可更新/删除，只允许一次全额冲销；库存被下游消费或财务存在有效收付款时 fail closed；普通 Finance 核销/冲销与期初并发锁定通过。
- 展示：Finance Service 与实时 Dashboard 读取/汇总期初应收应付，`REVERSED` 不计入余额；迁移 synthetic fixture 从 staging 正式物化 2 条库存与 2 条财务期初。
- 验收：专项 unit 3/3、PG 2/2、migration 3/3；全量 PG/API、migration、unit/UI、typecheck、schema consistency、build/lint/environment/credentials 通过；隔离 Compose 重启和停服 backup→全新空库 restore 后 14 migrations、库存 `112/4` 与 AR/AP 余额一致；Python 三项通过。
- 版本/边界：`0.1.0-alpha.12`，`0014` SHA-256 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`。MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`；未读真实数据、未迁移/部署/重启 Python/push/建 PR，生产为 `NO-GO FOR REAL DATA / PRODUCTION`。

### SELFHOST-PHASE3-TASK01 - `feat: add synthetic migration readiness tooling`

- 迁移框架：新增只能显式执行的离线 CLI，包含 SQLite/D1 export source、PostgreSQL staging target、manifest、mapping registry、稳定 ID map、digest checkpoint、dry-run、合成 commit、reconcile 与安全报告。
- 安全：所有 source read/target connect 前拒绝 production、真实/仓库路径、公开或远程目标、非 `_migration_test` 库和非空目标；不输出业务正文、个人信息、凭证、连接串或绝对业务路径。
- 合成验收：五类虚构 fixture 覆盖跨域合法/复核/阻断/恢复/重复；中断恢复、重复执行、输入变化、库存和稳定来源 AR/AP 核对、backup→新空 restore 与 PostgreSQL/Web/Worker 重启通过。
- 回归：迁移 tool 8/8、PG E2E 1/1、非数据库 87/87、PG/API 67/67、upgrade 27/27、typecheck 8/8、build/lint/652 文件凭据、Compose 与 Python 三项通过。
- 版本/边界：`0.1.0-alpha.11`；业务 migration 保持 `0001`—`0013`，未创建 `0014`。未读取真实数据库/备份/附件，未迁真实数据、重启 Python、访问生产、部署、push 或创建 PR；生产保持 NO-GO。

### SELFHOST-PHASE2-TASK10 - `feat: add self-hosted operations workbench`

- Dashboard：新增独立 Repository/Service/Handler，在 `REPEATABLE READ READ ONLY` 快照中实时聚合 TASK02—TASK09 权威关系表；固定 DTO 按服务端权限裁剪，numeric 以文本返回，库存按单位分组而不跨单位相加。
- 根工作台：`/` 改为原生 Vinext 会话与经营工作台，覆盖 setup/login/must-change/logout、指标、风险、模块入口和独立错误/重试，不再加载 iframe。
- legacy/API：`/erp/index.html` 仅作显式白名单 tab 深链和回滚证据；64 个盘点操作与 23 个 legacy 刷新 GET 有实现或稳定退役合同，浏览器 backup create/restore 返回 `OFFLINE_OPERATION_REQUIRED`。
- 备份治理：离线 backup/verify/restore 生成并核对 app/Git/tool/migration/size/SHA manifest，拒绝危险 tar/link、已有输出、生产目标和非空恢复目标；Web 只读去敏状态，不返回路径、URL、凭证或制品正文。
- 验收：Dashboard unit/UI/coverage 10/10；全量非数据库 selfhost 87/87、PostgreSQL/API 67/67、migration upgrade 27/27、environment 6/6、TASK03—TASK10 typecheck、build、lint、凭证和 Python 三项通过；隔离 PostgreSQL backup→新空目标 restore，以及 TASK02→TASK10 同库 Compose 全旅程/重启通过。
- 验收补充：64 项逐条复核为 COVERED 52/REPLACED 2/RETIRED 10；全域备份恢复到第二个新空 Compose 后，115 张表、13 个 migration、跨域计数、0 个 Material orphan、两个文件 SHA、backup `VERIFIED` 与 23 GET 在整体重启后再次通过。
- 版本/边界：`0.1.0-alpha.10`；无需新 projection，migration 保持 `0001`—`0013`。未迁真实数据、执行生产备份恢复、访问生产、部署、切流、push 或创建 PR。

### SELFHOST-PHASE2-TASK09 - `feat: add self-hosted finance management`

- 数据库：新增 PostgreSQL `0013`，关系化 AR/AP Document、Receipt/Payment/全额 Reversal 和 append-only Event；来源、往来单位、金额、币种和结算事实不可原地修改，Header 只保存受控余额/状态/version 投影。
- 服务端：新增独立 Finance Repository/Service/Handler；仅从未冲销正向 Shipment/Receipt 金额来源过账，单来源唯一，收付款不超余额，正向 Settlement 最多一次全额冲销。
- 安全/原子性：admin/manager/finance 写权限与 sales/purchase scoped read 分离；CSRF、256 KiB、24h 幂等、限流、expected version、请求编号、中文安全错误和事务审计通过；业务事实、投影、审计与幂等共同提交或回滚。
- 跨域/legacy：财务过账后上游发货/收货冲销 fail closed；legacy 页面只选择稳定来源 ID，不提交总额、币种、往来单位或操作者权威字段，所有路由委托同一 Finance Service。
- 验收：Finance unit/UI 4/4、PG/API 3/3、migration 3/3、Compose 首次/重启；Procurement 7/7、Sales 3/3、Quality 8/8、FileStorage/environment、lint/typecheck/build/credentials、Python 三项通过。
- 版本/边界：`0.1.0-alpha.9`，`0013` SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1`；非生产且未发布，未迁真实金额，未接银行/税务/发票/汇率/总账，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK08 - `feat: add self-hosted quality management`

- 数据库：新增 PostgreSQL `0012`，关系化 IQC/IPQC/FQC Inspection、Result、Defect 与 append-only Event；稳定 FK 固定 Receipt Line、Production Report、Completion Line + SO Line 来源，事实不可变且数量/来源/跨对象一致性 fail closed。
- 服务端：新增独立 Quality Repository/Service/Handler；创建、追加缺陷、异人处置、关闭、管理者重开执行权限、CSRF、256 KiB、24h 幂等、限流、expected version、请求编号和事务审计。
- 联动：Sales Shipment 在原 SO/Inventory 锁事务内消费 `CLOSED/RELEASED` FQC 额度；冲销恢复额度，仍有有效发货时禁止重开；不改写 Receipt、Report、Completion、Shipment 或金额来源历史。
- Legacy UI：使用稳定来源选项和稳定 ID；失败检验原子提交 result+defect，处置/关闭/重开为独立受保护动作，不由浏览器自动放行或计算权威数量。
- 验收：unit/UI 5/5、Quality PG/API 8/8、migration 3/3、Sales PG 3/3、Compose 首次/重启；shared unit/UI 70/70、跨域 PG、FileStorage/environment、lint/build/typecheck/credentials、Python 三项均通过。
- 版本/边界：`0.1.0-alpha.8`，`0012` SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`；非生产且未发布，未迁真实检验数据、实现批次/AQL/SPC/IQC 库存隔离或财务联动，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK07 - `feat: add self-hosted sales`

- 数据库：新增 PostgreSQL `0011`，关系化 Quote Header/Version/Line/Status Event、SO Header/Version/Line/Status Event、唯一 Quote→SO Link、Shipment/全额冲销和 append-only Sales Financial Source；已过账事实与非草稿版本不可修改/删除。
- 服务端：新增独立 Sales Repository/Service/Handler，稳定与 legacy 报价/销售订单/发货路由统一委托；固定权限、CSRF、256 KiB、24h 幂等、限流、expected version、稳定错误、请求编号和事务审计由服务端执行。
- 业务：报价 DRAFT 版本、发布/接受/拒绝/过期/取消/转换；只有 ACCEPTED 可原子转单一次；直接 SO 为 OPEN；部分/全部发货与一次全额冲销；CNY 六位金额由 PostgreSQL numeric 计算。
- 原子联动：Shipment/冲销复用 TASK04 Inventory Service 事务入口，销售事实、SO 投影、Ledger/Balance、状态、金额来源、审计和幂等共同提交或整体回滚。
- Legacy UI：客户、Product Version、成品 Material 和 Unit 使用稳定 ID；受保护报价/转单/订单/单行发货不计算客户端权威总额或提交操作者字段。
- 验收：专项 unit/UI 5/5、PG/API 3/3、migration 3/3、Schema consistency、Compose 初始/整栈重启；shared unit/UI 65/65、PG 54/54、升级 21/21、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项均通过。
- 版本/边界：`0.1.0-alpha.7`，非生产且未发布；未迁真实销售/库存/金额数据，未实现税/折扣/汇率、销售审批、退换货/部分冲销、FQC、应收/收款/总账，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK06 - `feat: add self-hosted production`

- 数据库：新增 PostgreSQL `0010`，关系化 WO、状态事件、不可变 BOM 快照/需求、领退料、报工、完工和客户专用料限制；已过账事实与快照有数据库不可变 guard，旧 `erp_records` 不回填、不双写。
- 服务端：新增独立 Production Repository/Service/Handler；RELEASE 固化 RELEASED Product/BOM Version，PostgreSQL numeric 计算六位需求；状态、客户/物料/单位、超领/超退/报工/超产、expected version、幂等和并发均由服务端执行。
- 原子联动：领料、退料和完工复用 TASK04 Inventory Service 事务入口；Production、Ledger/Balance、状态事件、audit 和 idem 共同提交或回滚，完工不重复扣已领原料。
- API/legacy：接通工单 list/detail/create/update/release/cancel/close、快照/需求/进度、领退料、报工、完工及六条 legacy 生产路径；兼容层只转换稳定 ID DTO，不直接写库或调用 Python。
- 验证：TASK06 unit/UI 4/4、PG/API 5/5、migration 3/3、Schema consistency、Compose 首次运行/整栈重启；shared unit/UI 60/60、PG 51/51、旧升级 18/18、Import 53/53、lint/build/typecheck/credentials/environment/Python 三项均通过。
- 版本/边界：`0.1.0-alpha.6`，非生产且未发布；未迁真实生产数据，未实现 MRP/排程、设备/工时/成本、WIP/批次/单位换算、品质/财务过账或销售，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK05 - `feat: add self-hosted procurement`

- 数据库：新增 PostgreSQL `0009`，关系化 PO Header/Line、来源、状态事件、Receipt/全额冲销和 append-only 财务来源；Receipt/Line/Status/Source/Financial 不可变并有跨对象完整性 guard，旧 `erp_records` 不回填、不双写。
- 服务端：新增独立 Procurement Repository/Service/Handler，提供 PO list/detail/create/update/close、可收明细、BOM 缺料建议/显式建单、Receipt list/detail/create/reversal 和财务来源读取；并发编码、numeric 精度、状态机、权限、CSRF、幂等、限流、expected version、请求编号与审计均由服务端执行。
- 原子联动：TASK04 Inventory Service 新增兼容的事务内入口；收货/冲销在同一 PostgreSQL 事务完成 Receipt、PO 投影、Ledger/Balance、状态事件、财务来源、审计和幂等。故障注入、审计失败和并发超收均整体回滚。
- legacy：采购页面只转换稳定 Material/Supplier Mapping/Unit ID 和受保护 payload，再委托同一采购 Service；不直接写库、不写 `erp_records`、不调用 Python 创建采购记录。
- 验证：TASK05 unit/UI 5/5、PG/API 7/7、migration 3/3、Schema consistency、Compose 首次运行/重启；共享 unit/UI 56/56、PG 46/46、旧升级 15/15、Import 53/53、lint/build/typecheck/credentials/environment/Python 三项均通过。
- 版本/边界：`0.1.0-alpha.5`，非生产且未发布；未迁真实 PO/在途/库存，未实现 PO 审批/取消、部分冲销、超收、单位换算、完整应付/付款/总账，未访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK04 - `feat: add immutable inventory ledger`

- 模块：新增独立 `inventory-selfhost` Repository/Service/Handler；稳定 Material/Unit ID、不可变 Ledger、事务余额投影、调整 Header/Line 和核对查询，不写 legacy `erp_records` 或文本编码库存表。
- 业务：支持通用入库、出库、盘点调整、冻结、解冻和一次全额冲销；单一 MAIN 库位、基础单位、禁止负库存/负可用量，已过账 Header/Line/Ledger 由数据库 trigger 禁止修改或删除。
- API/安全：接通 inventory、ledger、reconciliation、adjustment list/detail/post/reverse；服务端权限、CSRF、256 KiB、24h 幂等、限流、expected balance version、稳定加锁、请求编号和同事务审计。
- BOM/UI：readiness 只读新余额投影并返回 required/available/shortage；legacy 调整页提交 material_id/unit_id/version，不再以物料编码作为写引用。
- Migration：新增 PostgreSQL `0008_inventory_ledger.sql`、schema/snapshot/journal；SHA-256 `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`，`0001`—`0007` checksum 不变。
- 验证：专项 unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3、Compose 空库/重启通过；适用 Identity/Material/Mapping/Normalization/Review/Phase0/build/lint/typecheck/凭证/Python 回归通过。未改动旧导入 UI 文件上的 6 条既有源码正则断言仍失败，已记录为非 TASK04 回归债务；parser/file-inspector/adaptive-supplier 49/49 通过。
- 版本/生产：`0.1.0-alpha.4`，非生产、未发布；未回填真实库存、实现 PO/WO/SO 业务过账、访问生产、部署、push 或创建 PR。

### SELFHOST-PHASE2-TASK03 - `feat: add self-hosted master data and bom`

- 模块：新增独立 `master-data-selfhost` 与 `bom-selfhost` Repository/Service/Handler，统一入口只做身份门禁和精确分派；新写不进入 `erp_records`。
- 数据：关系化 Customer、Supplier、Product/Product Version、BOM Header/Version/Line 与原子业务编码序列；Supplier Mapping 增加稳定 Supplier/Material/Unit FK、状态/版本/有效期，价格历史只追加。
- 版本/不可变：Product/BOM 使用 DRAFT→RELEASED；数据库 trigger 禁止发布 Product Version、BOM Version 和 Lines 被 UPDATE/DELETE，修正只能新建版本。BOM 发布重查 Product、Material ACTIVE、Unit enabled 和行完整性。
- API/安全：接通 legacy `/api/items|mappings|products|customers|suppliers|boms|bom-lines|bom-readiness` 及版本/状态/价格路由；固定服务端权限、CSRF、256 KiB、每分钟 60/20 限流、24小时幂等、CAS/锁、请求编号、同事务业务/审计/幂等结果。
- readiness：TASK04 前只做结构与 required quantity，明确 `inventory_evaluated=false`、`all_ready=false`，不查询 `inventory_balances`/`inventory_transactions` 或伪造齐套。
- Migration：新增 PostgreSQL `0007_master_data_bom.sql`、schema/snapshot/journal；SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`，`0001`—`0006` checksum 不变。
- 验证：TASK03 unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration 3/3；Compose 空库 E2E 与 Web/PostgreSQL 重启通过；Identity/Material/Mapping/Normalization/Review、Phase0、lint/build/typecheck/凭证和 Python 三项回归通过，测试资源已清理。
- 版本与边界：`0.1.0-alpha.2 -> 0.1.0-alpha.3`，未升级依赖；未实现库存/采购/生产，未访问生产、迁移真实数据、部署、重启 systemd、push 或创建 PR。

## 2026-07-24

### SELFHOST-PHASE2-TASK02 - `feat: add self-hosted identity security`

- 模块：将自托管身份从 `selfhost-api.ts` 拆为 `identity-selfhost` 的 Types/Errors/Password/Permissions/Repository/Service/Handler；入口只保留精确委托、可信 actor 注入和所有后续业务模块前的统一 active/must-change 门禁。
- API：安全保留 setup/login/logout/session，补齐本人改密、用户列表/创建/启停/重置和系统审计查询；admin-only 管理、固定十角色、用户名不可变、禁止自停用/自重置和最后 active admin 并发保护。
- 密码/会话：12—128 位且四类至少三类，拒绝用户名/默认/弱口令/新旧相同；PBKDF2-SHA256 310,000 次、常量时间比较、token 只存 SHA-256。停用/重置撤销全部会话，本人改密保留当前并撤销其他会话；生产内部 HTTP 仍强制 Secure Cookie。
- 安全：登录 15 分钟 5 次失败限流，身份写每分钟 60 次/20 个新 Key；四个 POST 使用 CSRF、canonical body、持久 Idempotency、CAS、事务审计和稳定错误；系统审计默认 20/最大 100 并最小披露。
- Migration：新增 expand-only PostgreSQL `0006_identity_security.sql`、schema/snapshot/journal；SHA-256 `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`，`0001`—`0005` checksum 不变，未迁移真实用户或静默删除旧 session。
- 前端：现有 legacy 身份交互改用 temporary_password/expected_version/CSRF/页面内存幂等上下文；处理 must-change、版本/幂等冲突、限流和撤销。Dashboard/备份仍缺失时明确降级，不在本任务补业务 API。
- 验证：Identity 单元 8/8、UI 4/4、PostgreSQL/API 8/8、migration 4/4；隔离 Compose 完整生命周期及 Web/PostgreSQL 重启持久性通过；指定 Material/Mapping/Normalization/Review、Phase0、build/lint/typecheck/凭证与 Python 回归通过。
- 版本与边界：`0.1.0-alpha.1 -> 0.1.0-alpha.2`，仅非生产开发记录；未访问生产、迁移真实数据、部署、重启 systemd、升级依赖、push 或创建 PR。

### SELFHOST-PHASE2-TASK01 - `docs: plan full erp api migration`

- API 盘点：只读核验 Python `AppHandler` 共 64 个 HTTP 操作（GET 34、POST 30）；按身份系统11、基础主数据/工程/物料22、采购库存9、生产6、销售7、品质3、财务6 分类，逐项记录页面、权限、输入、读写表、事务、联动、审计、过账、自托管覆盖、PG结构、缺口、风险和依赖。
- 覆盖结论：以等价服务能力统计，自托管已覆盖4、部分覆盖9、未覆盖51；Material/Import 的新工作流不能因语义相近就冒充 legacy 路径兼容，`erp_records` 或库存占位表也不能作为业务迁移证据。
- 首页断链：根页面仍加载 `/erp/index.html`；登录后 `refreshAll()` 并发的23个 legacy业务GET在 `selfhost-api.ts` 均返回404，Operations额外的Dashboard/backups/users也缺失，因此当前自托管不能描述为完整ERP。
- 数据与事务：记录稳定内部ID、BOM版本、库存不可变流水/余额投影、采购收货、领料/完工、发货、品质处置、应收应付/收付款不变量；确认旧 quote→SO 存在双commit窗口，所有过账更正必须使用调整/冲销/反向记录。
- 迁移建议：提出待逐项授权的 TASK02—TASK10；先身份与审计、再主数据，独立建立库存账本后并行承接采购/生产/销售，再品质/财务，最后 Dashboard、备份恢复治理和 iframe 退出。候选任务均未批准实施。
- 验证：`git diff --check`；Node lint 0 error/1既有warning、`npm test` 3/3、review typecheck、Vinext build 5/5、凭证扫描458文件；项目虚拟环境 Python self-test、smoke、临时SQLite go-live 均通过。
- 边界：只修改文档；未修改 Python/TypeScript/React/Schema/migration/依赖/Compose/部署配置，未读取真实业务数据，未访问公开Site或生产数据库，未重启服务、启动Compose、部署、push或创建PR。

### PHASE0-TASK03 - `docs: establish self-hosted release tracking baseline`

- 发布追踪：新增 `docs/project/RELEASES.md`，区分历史 Sites、当前 Python/SQLite 开发常驻、自托管 Node/PostgreSQL 开发基线和不存在的自托管生产版本；统一记录 Git、version、migration、测试、部署、真实数据迁移、回退和批准状态。
- 版本：将包名从 starter 标识改为 `chenyida-erp-selfhosted`，版本改为 `0.1.0-alpha.1` 并同步 lockfile；不升级或改变任何依赖，该版本明确为非生产、尚未发布。
- Migration：建立 PostgreSQL `0001`—`0005`、历史 D1 `0000`—`0008` 和 SQLite `0001`—`0004` 的 SHA-256 基线；本地开发 SQLite 只读确认四个版本，未访问生产 D1/PostgreSQL。
- 运行面：只读确认 systemd Python/SQLite 开发服务 `enabled/active`、监听 `0.0.0.0:18888`，Node/PostgreSQL 无运行中 Compose 项目且未生产部署；明确采购、库存、生产、销售、品质和财务仍依赖旧 Python API。
- 模板：新增发布身份、快照/恢复点、空库/升级/重复/失败回滚、真实数据核对、lint/build/单元/集成/Compose/人工验收、安全/HTTPS/备份恢复/容量、批准执行与回退条件模板。
- 验证：lint 0 error/1既有warning、`npm test` 3/3、review typecheck、Vinext build 5/5、455文件凭证扫描、项目虚拟环境 Python self-test/smoke/临时SQLite go-live、`git diff --check` 均通过；宿主机无Node/npm，Node命令在一次性Node 22容器执行。
- 已知风险：`npm ci` 报告12个既有依赖审计项（1 low、4 moderate、7 high）；按本任务范围不升级依赖，留待独立安全任务。Python首轮误用系统解释器时smoke在导入依赖前停止，改用常驻服务实际项目虚拟环境后完整通过。
- 边界：未修改业务逻辑、API、Schema、migration、Compose、systemd 或生产配置；未访问公开生产 Site、生产数据库/D1，未重启服务、部署、迁移真实数据、push 或创建 PR。

### SELFHOST Phase 0 / Phase 1 后续 Git 结果说明

- 下列 SELFHOST-PHASE0-TASK01 与 SELFHOST-PHASE1-TASK01—04 条目中的“未提交”准确记录各原任务结束时状态；后续已由 `39946f6`（`feat: complete SELFHOST PHASE1 TASK04 material review workflow`）汇总提交。PHASE0-TASK03 开始时该提交已与 `origin/main` 同步且工作区 clean，不改写原任务历史。

### SELFHOST-PHASE1-TASK04 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0005_material_import_review.sql`、Drizzle schema/snapshot/journal；增加11张Review/覆盖/Issue/finalization/binding/draft link/history表、42个索引、restrict外键、互斥/大小/唯一/CAS约束和终态不可变trigger，未修改`0001`～`0004`。
- 服务端：新增独立 Material Import Review Repository/Service/API/Worker，覆盖已发布run固定引用、Session版本、三层值、SET/CLEAR/REVERT、行决定、Issue处理、ACTIVE分页精确绑定、finalization进度/失败/retry和历史。
- Material接入：通过TASK01 `MaterialWorkflowService.createDraftWithClient` 在同一行级事务创建未编码DRAFT并保存稳定link；不直接写物料表，不提交、批准、生成正式编码或修改ACTIVE。
- Worker与安全：Outbox/background_jobs、100行快照、50行处理、lease/heartbeat/CAS、行级operation key、部分失败和旧Worker租约拒绝；Session/Row expected_version、CSRF、细粒度权限、强幂等和安全审计通过。
- 前端：复用`/materials/imports/:batchId`七步工作区、现有view/row深链接和Drawer，增加Review版本/历史、三层值、覆盖、Issue确认、决定、ACTIVE选择、Draft选择、批量、进度和失败恢复；没有自动匹配/建稿/审批/编码入口。
- 验证：专项unit7/7、UI3/3、PG3/3；39个unit/UI/environment、25个PostgreSQL及2个旧migration upgrade共66个Node test通过；101行跨Worker chunk、空库/重复/0004升级、build、strict定向类型、lint 0 error/1既有warning、454文件凭证扫描和`git diff --check`通过。
- Compose：CSV→Parser→Mapping→Normalization→Review→排除/绑定/Draft→finalize通过；整栈stop/up后Normalization、Review历史、binding和DRAFT保持，一次性容器/网络/卷已清理。
- 边界：未连接生产、迁移真实数据、部署、提交、推送或创建PR；旧D1代码保留但不进入自托管依赖图。

## 2026-07-23

### SELFHOST-PHASE1-TASK03 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0004_material_import_normalization.sql`、Drizzle snapshot/journal；扩展 run/row/issue，关系化新增核心字段候选、动态属性候选和 lineage，并增加唯一索引、外键、状态/统计/发布约束及已发布数据不可变 trigger。
- 服务端：新增独立 Normalization Repository/Service/Normalizer/API/Worker，复用旧确定性规则，覆盖 create/summary/history/detail/rows/issues、同 run 重试、新版本重跑、取消、100 行分块暂存和 500 行摘要读取。
- 原子性与安全：Session/权限/行级可见性、CSRF、Idempotency-Key+正文摘要、expected version、Job lease/heartbeat/CAS、Event/Audit 和稳定错误通过；发布 pointer 与 Job success 同一 PostgreSQL 事务，失败、丢失 lease 或取消不得暴露暂存。
- 前端：现有 Normalization Review 增加运行历史选择、run-specific Rows/Issues、VALID/WARNING/ERROR/SKIPPED、raw row、核心/动态候选、关系化 lineage、重试/重跑/取消。
- 验证：专项 unit4/4、UI3/3、PG/API4/4、升级1/1；既有回归41/41，strict定向类型检查、build、lint 0 error/1既有warning、空库/重复/升级迁移、Compose v1→v2→取消及整栈重启持久性通过。
- 边界：未实现人工最终复核、ACTIVE绑定或Draft Commit；未连接生产、迁移真实数据、部署、提交、推送或创建PR。

### SELFHOST-PHASE1-TASK02 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0003_material_import_mapping.sql`、Drizzle snapshot/journal；原始行绑定 parse run，Mapping 增加源结构摘要、动态目标 metadata、确认快照、版本关系、复用来源、STALE 原因和不可变 trigger；旧不可证明确认版本升级为 `LEGACY_SNAPSHOT_INCOMPLETE`。
- 服务端：新增独立 Import Mapping Catalog/Rules/Service/API，覆盖 Sheets、Rows、动态 Targets、Mapping 保存/预览/确认、版本列表/新版本、有效性、复用候选和显式应用；D1/Miniflare/Cloudflare 不进入自托管运行依赖。
- 一致性与安全：权限、创建人行级可见性、CSRF、请求大小、稳定错误、请求编号、批次/Mapping 乐观锁、事务内强幂等、Import Event/Audit、并发锁顺序和失败整体回滚通过。
- 版本与复用：确认版本和 Items 数据库不可变；相同 digest 禁止重复确认；新版本确认后旧版本 SUPERSEDED；跨批次来源不变，复用只复制到 DRAFT，metadata 变化需重确认，已用目标类型变化为 STALE 并拒绝应用。
- Worker/UI：解析完成事务内原子发布 parse run、Sheet、Rows、Header 建议和初始 Mapping DRAFT；现有工作区增加当前版本/状态、版本历史、新草稿和复用候选/应用提示。
- 验证：Mapping 单元3/3、UI2/2、PG/API6/6、旧数据升级1/1；Material单元6/6、UI2/2、PG/API7/7、FileStorage3/3、PG/Worker5/5、环境6/6回归；strict定向类型检查、build、lint 0 error/1既有warning、空库/升级/重复迁移、Compose解析→Mapping v2→确认和Web/Worker重启持久性通过。
- 边界：未实现或连接行级Normalizer，未连接生产、迁移真实数据、部署、提交、推送或创建PR。

### SELFHOST-PHASE1-TASK01 - 未提交（用户明确禁止提交）

- 数据库：新增 PostgreSQL `0002_material_master_workflow.sql`、Drizzle snapshot/journal、分类编码序列表、审核队列/版本事件索引及草稿/ACTIVE编码一致性约束；未改 `0001`。
- 服务端：新增独立 Material Repository/Service/状态机/Validation/API，覆盖分类、草稿创建编辑、提交、审核通过/驳回、ACTIVE查询、版本、变更和审计；Session、权限、职责分离、CSRF、24小时强幂等、请求摘要、乐观锁和安全错误均由服务端执行。
- 编码与事务：批准时锁定草稿，以 PostgreSQL原子 upsert 领取分类流水并生成 `CYD-{CATEGORY_CODE}-{NNNNNN}`；主记录、属性、版本、变更、审计、幂等和编码同事务提交或回滚，并发测试无重复编码。
- 前端：复用现有Material创建/编辑/详情/审核页面契约，新增真实审计历史路由和 `material.audit.read` 能力页签，不展示敏感审计正文。
- 验证：单元6/6、UI契约2/2、PostgreSQL/API 7/7、既有Material UI 142/142、Phase0文件3/3和PG/Worker 5/5回归、build、lint 0 error/1既有warning及Compose双用户审批/整体重启持久性通过。
- 既有问题清理：只把 `xls-parser.ts` 的 `let flags` 改为 `const`，无行为变化；workbook unused warning和依赖审计风险继续记录，未强制升级。
- 边界：未移植Import Mapping/Normalizer，未连接生产、迁移真实数据、部署、提交、推送或创建PR；旧D1/Miniflare仅保留为参照，不进入新运行依赖。

## 2026-07-22

### SELFHOST-PHASE0-TASK01 - 未提交（用户明确禁止提交）

- 架构：标准 Node.js/Vinext Web、PostgreSQL、服务器本地 FileStorage、PostgreSQL Outbox/租约 Worker、Docker Compose 与 Caddy production profile 取代 OpenAI Site/Cloudflare 运行依赖。
- 数据库：新增 Drizzle PostgreSQL schema 和新的 `0001` 空库 baseline，46 表覆盖既有 45 张业务/治理结构及 `background_jobs`；migration advisory lock、checksum、transaction 和生产显式门禁。
- 文件：随机存储名、路径穿越保护、SHA-256/大小/MIME/原名元数据、同目录临时文件、fsync、原子 rename、受控读删和持久卷。
- Worker：Outbox、`FOR UPDATE SKIP LOCKED`、lease owner/token、heartbeat、CAS、重试、超时恢复、幂等、业务结果与任务状态原子发布、安全停机；CSV 解析和规范化基线 handler 已接入。
- 运维：Web/Worker/PostgreSQL/Caddy Compose、非 root 用户、健康检查、日志轮转、admin/migrate CLI、无覆盖备份恢复脚本与 Linux 文档。
- 验证：单元 3/3、PostgreSQL 5/5、Vinext build、定向 lint、凭证/差异检查、Compose 登录/分类/草稿/上传/Worker/重启持久性和隔离备份→新空库恢复通过；全量 lint 有 1 个本任务前既有 `prefer-const` error。
- 边界：未连接或修改生产、未迁移真实数据、未部署公网、未提交/推送/PR；完整旧 API、审批写 Repository 和行级 Normalizer PostgreSQL 移植留待后续任务。

## 2026-07-19

### PHASE3-MATERIAL-LIBRARY-SPEC-PRECISION-GATE-01 - `feat: enforce specification precision gates`

- 精度门禁：CATEGORY 不再作为足以区分内部编号的证据；少于两类鉴别参数返回“规格不足”、置信度 0 且不提供候选。自动匹配要求来源与候选至少三类参数、包含锚点、集合完整一致且候选唯一。
- 参数扩展：确定性支持分数功率、工程量范围、频率/阻抗组合、带宽、dB、嵌入电阻码、长度、针数、间距、铜厚和常用接口；Type-C `16P` 不再误识别为电容。
- 来源选择：未知表头可按样本规格丰富度选中；普通型号列不再拼入规格，只有型号或低信息规格保持人工审核。
- 审核 UI：摘要增加“规格不足”，清洗行明确显示证据类数、候选内部缺项和歧义，不由浏览器重新计算匹配。
- 真实回归：J587 隔离复算为 105 新物料、5 疑似、12 规格不足；旧逻辑中 4 条只凭连接器大类产生的错误候选归零。三份附件和业务正文不提交。
- 数据：无 Schema/Migration；9 Material、122 Cleaning、17 Batch 和 3176 Raw 保持不变，旧 Cleaning 不静默重算。
- 验证与部署：联合单元 58/58、self-test、smoke、go-live、编译和 diff 检查通过；部署前备份 SHA-256 为 `898b3dab3da5b3e4239773789afebca73f1c91428646c2c2c3f476e2d8efc536`，systemd active/enabled，本机和公网 HTTP 200。

## 2026-07-18

### PHASE3-MATERIAL-LIBRARY-GENERAL-SPEC-MATCH-01 - `feat: match generalized specification tokens`

- 来源识别：在明确规格、多列组合、描述和物料名称中按确定性参数丰富度选择详细规格，保存完整 raw spec、来源列、置信度和证据；型号/MPN 继续独立保存。
- Matcher：新增通用类型化 token，覆盖品类、封装、容量、阻值、电感值、电流、电压、功率、频率、百分比/绝对误差、介质/材质和尺寸；量纲归一后按集合比较，参数顺序不影响相似度。
- 边界：同类型冲突排除，缺项降低置信度；MPN/品牌只作为独立标识证据，不进入通用规格分数，也不能代替详细规格。名称仍不参与编号评分，AI 不补造参数。
- 数据库：新增本地 `0004_cleaning_general_spec_tokens`，只扩展既有 Cleaning 的来源、来源/候选 token 和匹配证据 JSON；旧行不回填、不重算。
- 审核 UI：同时显示型号/MPN、完整原始详细规格、规格来源、来源逐项参数和候选内部参数，不再用型号覆盖原始规格。
- 建档：人工确认的新内部物料在 `value_spec` 保留完整详细规格，结构化列作为附加投影，不丢弃尚无独立列的电流或绝对误差参数。
- 验证与部署：联合单元 48/48、self-test、smoke、go-live 通过；备份和迁移后完整性 `ok`，9 条物料、444 条 Cleaning、16 个 Batch 和 3037 条 Raw Rows 未改变；systemd active/enabled，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-REVIEW-SPEC-DISPLAY-01 - `feat: show structured specification comparison`

- 审核 UI：新增“来源分项规格”和“候选内部规格”，按品类、封装、容量/阻值、耐压、误差、介质/材质、型号/MPN、品牌逐项展示；内部缺项显示“未维护”。
- 字段语义：原列改为“原始型号/规格”；富结构化物料描述作为 raw spec 来源，物料型号独立保存为 raw model，不再让厂商型号冒充规格。
- 权威边界：候选内部规格从已加载的 `/api/items` 只读数据展示；匹配、候选编号、权限和确认仍由服务端决定。
- 置信度：来源介质存在但内部候选未维护时仍为疑似，并将置信度上限改为 0.95，避免显示 1.0。
- 数据：无 Schema/Migration，无旧行回填，无物料或 Cleaning 写入。
- 验证与部署：联合单元 38/38、self-test、smoke、go-live 通过；systemd active/enabled，本机和公网 HTTP 200，线上静态资源已核验两组规格字段，当前 9 条物料和 25 条 Cleaning 未改变。

### PHASE3-MATERIAL-LIBRARY-STRUCTURED-SPEC-MATCH-01 - `feat: match structured specification components`

- 机制：取消把型号/描述压成整体文字进行匹配；分别提取并比较品类、封装、容量/阻值、耐压、误差、介质和 MPN，关键属性任一冲突立即排除。
- Parser：1928C 的物料型号、物料描述和生产厂家分别保留；增加生产厂家品牌别名，支持 `NPO/NP0/COG/C0G` 与 `100P=100PF` 等确定性表达。
- 数据库：新增本地 `0003_cleaning_structured_specification`，扩展现有 Cleaning 的 raw model/category 和 parsed tolerance/material；不建第二套导入系统，不回填旧清洗。
- 建档：电子规格分别写入 value/package/voltage/tolerance/material/MPN，不再把可解析的完整长描述只塞进 `value_spec`。
- 真实回归：1928C 截图行得到 CAP/0201/5%/C0G-NP0/50V/10PF/MPN；当前内部库无该 10PF 规格，按预期保持新物料。
- 验证与部署：联合单元 37/37、self-test、smoke、go-live 通过；迁移前快照完整性通过，`0003` 已应用，9 条物料、25 条 Cleaning、12 个 Batch 保持不变，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-SPEC-MATCH-01 - `feat: match supplier rows by specification`

- 样本：审计 1928C、G20-G15G、J587 三份 XLSX；G20 的 Description-only 表头原先被名称门禁拒绝，J587 描述/备注冲突会导致规格为空。
- Parser：增加 HC_CODE、VendorCode；Description-only 作为 SUGGESTED 规格/名称候选；正式描述优先备注；全部 Canonical 字段为空的行标记 `UNMAPPED_NON_DATA`，Raw 保留。
- 规格：三文件隔离得到 221 Cleaning Rows，其中 216 条有规格；G20 5 条原始 Description 为空，不用料号冒充规格。
- Matcher：删除名称相似度评分；来源规格硬冲突立即排除，完整唯一规格才自动确认编号，部分唯一候选保持疑似，多候选同分不随机给号；支持 0.1uF=100nF、5.0V=5V、+5%=5%。
- 当前库：三文件没有完整唯一匹配编号 1～5 的行；J587 5 条缺误差，不能在 1/2/3 中唯一选码。未创建新内部物料。
- 验证：规格编号 7/7、Parser/真实样本 12/12、隔离文件导入 3 Batch/316 Raw/221 Cleaning/0 Material，联合基线 33/33、smoke/self-test/go-live 通过；systemd 已部署且未重写现有数据。

### PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01 - `feat: safely clear cleaning rows`

- 权限：清空接口要求 `system`，仅管理员页面显示按钮，普通角色服务端拒绝。
- 确认：浏览器确认之外，`POST /api/cleaning/clear` 还要求固定 `CLEAR_CLEANING_ROWS`；缺失返回稳定错误且不删除。
- 恢复：成功操作先自动创建 SQLite 备份，再清空 Cleaning Rows；响应返回删除数量和备份信息。
- 事务/审计：删除与操作日志在 `BEGIN IMMEDIATE` 事务内完成，记录操作者与行数；保留 Batch、Raw Rows、原文件归档、物料和供应商映射。
- 测试：清空专项 3/3、与排序联合 7/7、smoke 通过；systemd 公网开发服务已部署。部署过程未调用真实清空，229 条 V700 记录不变。

### PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01 - `feat: sort cleaning rows by confidence`

- API：`GET /api/cleaning` 增加 `confidence_sort=newest|desc|asc`，未知值回退 newest；SQL 排序只使用固定白名单。
- 顺序：服务端对完整 Cleaning 查询按匹配置信度排序后再应用 500 条上限；同分按 ID 降序，默认保持最新记录。
- UI：“清洗审核”增加“匹配置信度排序”，可选最新、由高到低、由低到高；切换只刷新清洗列表。
- 测试：排序单元 4/4，smoke 覆盖升降序和未知值回退，self-test/go-live 通过。
- 部署：systemd 开发服务已重启为 `enabled/active`，公网 HTML/JS 已核验新控件。
- 真实队列：部署期间用户已网页重导入 V700；229 条、21 个置信度层级（0.00～1.00）的升降序检查均通过。

### PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01 - `docs: record capacitor matching test seed`

- 用户数据：只采用项目负责人更正后的五条电容规格，按临时内部编码 1～5 建入开发服务器物料库；首次重复版本未执行。
- 结构化字段：CAP、容量、规范化误差、电压、0201 封装、PCS；名称保留用户输入的正号，未创建供应商映射。
- 清理：单一事务删除 543 条旧 Cleaning Rows；保留 2 个 Import Batch、766 条不可变 Raw Rows 和完整 SHA 原文件归档。
- 恢复：写入前备份 `erp-backup-20260718-182230.sqlite3`，SHA-256 为 `f97337052aa9fcc0258355a9a0d7655e6d51f865c28189e6f901ec673f597613`；先在备份副本执行同一事务。
- 验证：内部物料 4→9；五条输入分别自动匹配编码 1～5，置信度均为 1.00；SQLite integrity `ok`，systemd `enabled/active`，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02 - `feat: stage real BOM imports for review`

- 用户确认：项目负责人明确 A118/V700 是正确且需要入库的正式表格，不应因缺独立名称/单位或 XFD 异常声明宽度拒绝整份文件。
- A118：完整原文件按 SHA 归档；从第 44 行可信表头和 256 列安全分析窗口生成 314 条待审核行，不把异常 XFD 列映射到 Canonical 字段。
- V700：正确选择 BOM 第 1～2 行；规格描述同时生成 `SUGGESTED` 名称候选，生成 229 条待审核行，不自动确认名称。
- 数据：新增 `0002_material_import_file_archive`；实际写入 2 Batch、766 Raw Rows、543 Cleaning Rows，543 条全部 `NEEDS_REVIEW`，22 条空规格、543 条空单位，内部物料保持 4 条。
- 恢复：写入前备份 `erp-backup-20260718-174855.sqlite3`；迁移副本和写入后 `PRAGMA integrity_check` 均为 `ok`。
- 验证：环境/Spreadsheet/Migration/真实样本联合单元 15/15、self-test、含二进制 Excel 的 smoke 和公网开发服务检查通过。

### PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT - `feat: enable local spreadsheet imports`

- 运行面：修复实际常驻的 `chenyida_erp_app`，网页文件选择器和后端现已接受 `.csv/.xlsx/.xls`，不再把 Excel 当 CSV 文本读取。
- 解析：按强签名识别 CSV/OOXML/OLE，固定 `defusedxml==0.7.1`、`openpyxl==3.1.5`、`xlrd==2.0.2`；限制 10 MiB、50 Sheet、50,000 行/Sheet、256 列，并拒绝 XLSX 宏、加密、外链、路径和压缩资源异常。
- 自适应：评分全部 Sheet、前 50 行、1～3 行和合并表头；集中字段别名、样本特征、多列规格组合及非数据行分类。缺少明确名称、规格证据不足或 Mapping 冲突时 fail closed/进入复核，不由 AI 补造。
- 建档门禁：清洗行创建内部物料前，页面和服务端均要求人工确认标准名称、规格和基本单位；空规格或空单位禁止建档，不再自动补 `PCS`。
- 数据库：新增本地版本化迁移 `0001_material_import_source_lineage`，保存文件 SHA、Sheet/表头/Mapping 快照、不可变原始行，以及清洗行来源、mapped values、Mapping/规格置信度和 Review 状态。
- 测试：Spreadsheet 6/6、Migration 3/3、联合单元 13/13、self-test、含 XLSX 二进制 API 的 smoke、go-live、快照副本试迁移和完整性检查均通过。
- 部署：迁移前备份 `erp-backup-20260718-172714.sqlite3`；systemd 改用 `/opt/erp/.venv/bin/python` 后重启为 `enabled/active`，本机和公网 HTML 已验证新文件类型。
- 真实样本：V700 仍因缺少明确物料名称阻断，A118 仍因 XFD 超宽阻断；没有截断、补造或写入这两份真实附件。

### PHASE3-MATERIAL-LIBRARY-PUBLIC-VERIFY - `chore: enable port 18888 public verification`

- 运行：服务器应用改为绑定 `0.0.0.0:18888`，公网验证地址为 `http://43.135.157.211:18888`。
- 范围：只验证健康接口和网页可达性；不配置域名、TLS、反向代理或其他端口，不输出凭证。
- 前置：项目负责人提供公网 IP 及 TCP 18888 IPv4/IPv6 入站允许规则截图。
- 结果：本机与 `43.135.157.211:18888/api/health` 均返回 HTTP 200，登录页返回 HTTP 200；发现登录页预填默认密码，验证后立即停止公网进程并移除页面预填凭证。
- 常驻：项目负责人随后确认开发阶段保持常开；新增并安装 `chenyida-erp.service`，systemd `enabled/active`，开机自启且异常自动重启。

### PHASE3-MATERIAL-LIBRARY-SERVER-RUNTIME - `chore: switch local server delivery runtime`

- 运行面：根据项目负责人新要求，后续默认交付目标改为服务器本地 `chenyida_erp_app`，不再默认把新功能整合到 `chenyida_erp_site`。
- 端口：`server.py`、前台/后台启动、停止脚本和上线健康检查默认统一为 `127.0.0.1:18888`；测试脚本继续使用隔离端口，不与默认服务冲突。
- 安全：未绑定 `0.0.0.0`，未修改防火墙、反向代理、TLS、公网入口或生产数据库；本次没有启动服务器。
- 验证：`server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过；Site 中已完成的 `.xls` 代码未自动回写本地应用，服务器端 `.xlsx/.xls` 迁移另立任务。

### PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT - `feat: support legacy xls imports`

- 文件格式：网页预检和上传安全检查新增 `.xls`；旧式 OLE/BIFF 工作簿进入独立解析路径，现有 `.xlsx` 继续使用 OOXML 解析器，`.csv` 行为不变。
- 解析：新增有界 OLE Compound File/BIFF 读取器，支持可见/隐藏 Sheet、共享字符串、文本、数字、RK、布尔/错误、公式缓存、合并单元格和原始行哈希；加密/损坏/超限文件 fail-closed。
- 链路：继续复用现有 Import Batch、File、Raw Rows、Mapping、Normalization、Review、Event/Audit 和 Draft 门禁；不新增第二套导入系统或数据库表。
- UI/Inspect：文件选择器与本地 inspect 同时接受 `.xlsx/.xls/.csv`，`.xls` 保留 `XLS_LEGACY_BINARY` 安全证据；批次原有 `XLSX` 来源分类不变以保持迁移兼容。
- 生产：仅修改本地代码，未连接生产 D1/R2/Queue，未上传、迁移、创建 Draft 或部署。

### PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01 - `fix: adapt imports to real supplier BOMs`

- Git Commit：`cea940a`。
- 样本：只读检查用户提供的 A118/V700 两份附件；两者均为 XLSX 内容但使用 `.csv` 后缀。只记录文件哈希、大小、Sheet、表头、列名、行数估计和安全原因，未提交附件或业务行。
- V700：修正前误选“变更记录”；修正后以 `HIGH_CONFIDENCE` 选择 `BOM` 第 1～2 行组合表头，正确识别规格、型号和数量。标准名称、单位仍未确认，故不进入 Mapping Confirm/Normalization/Draft。
- A118：识别 `SHEET1` 第 44 行表头，正确映射名称、规格、厂商料号和用量；第 197～203 行周期性扩展到 XFD，继续以 256 列安全上限阻断，不静默截断。只读前 9 列估计不视为成功导入。
- 兼容：只允许 `.csv` 后缀但强签名为 XLSX 的单向兼容，完整 OOXML 安全检查不变，并把原后缀、检测类型和 warning code 写入既有安全事件。
- 识别：Inspect 复用自适应前 50 行摘要；增加 BOM 正向、变更/历史负向 Sheet 证据，限定“厂商物料编码”为制造商料号，增加“用量”数量别名和嵌入式 BOM 标题分类。
- 安全错误：XLSX 超宽 Promise 立即挂接拒绝处理，CLI 返回稳定中文错误，不再产生未处理拒绝堆栈。
- 验证：自适应 11/11、Parser 37/37、Inspector 4/4、Batch API 12/12；Vinext build + 全量 Node 593/593、lint 0 error/1 个既有 warning、隔离 API smoke、凭证扫描及 Python self-test/smoke/go-live 通过。
- 生产：未连接生产 D1/R2/Queue，未上传真实附件、执行 dry-run、创建 Draft、迁移、Sites 保存或部署。

### PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT - `feat: adapt supplier material imports`

- Git Commit：`41e293f`。
- 审计：复用既有 Batch、Parser、Raw Rows、Mapping、Normalization、Review、Validation、Event/Audit 和 Draft；确认旧实现默认首个可见 Sheet、前 10 行单表头、单来源映射和只跳过精确表头行，是多供应商兼容失败的主要原因。
- 结构识别：对全部可见 Sheet 的前 50 行评分，支持 1～3 行和合并父级表头、稳定父子列路径、数据起始行，以及说明/空行/重复表头/小计/合计/页脚的可解释分类。
- Mapping/规格：集中版本化别名，结合样本类型、唯一率、长度、尺寸/型号/单位特征和受控 Supplier Profile；支持 `EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT`、多来源列与确定性规格组合。名称/描述只给候选，不调用 AI；空规格产生 ERROR 并阻断 Draft。
- Canonical Row：在现有 Normalization 保存文件、Sheet、行、Supplier/Profile、raw/mapped 投影、置信度和 Review 状态；完整原始值继续只存在不可变 Raw Row。非数据行保留 lineage 并标记 `SKIPPED/REJECTED`。
- 数据库/UI：新增 `0008`、Supplier Profile 及 Mapping/Normalization 扩展，旧 `0005` 兼容；工作区展示结构范围、置信度、多来源 Mapping 和规格确认提示。Down 是受保护的兼容回退，完整结构恢复依赖迁移前快照。
- 样本：仅检查 `/opt/erp` 内受控目录，未发现真实供应商样本；治理模板未冒充真实验证，未输出完整业务数据、价格或联系方式。
- 验证：全量 Node 589/589，自适应 9/9、Migration 3/3、运行时闭环 2/2，build、lint 0 error/1 个既有 warning、隔离 API smoke、1k/10k/100k 查询计划、最终文档范围 328 文件凭证扫描、Python self-test/smoke/go-live 和 `git diff --check` 通过。
- 生产：未连接生产 D1/R2/Queue，未执行生产迁移、真实上传、Draft 创建、Sites 保存或部署。

### PHASE3-MATERIAL-LIBRARY-02 NO_REAL_DATA_MODE - `feat: harden material import governance`

- Git Commit：`b3d26c3`。
- 文件检查：只扫描 `/opt/erp`、`/home`；发现 20 个路径，按 SHA 去重为 1 个 10-Sheet XLSX 和 9 个 CSV，均为已跟踪治理模板/样例及其 Site 镜像；`/home` 无候选，未发现、上传或导入真实企业物料文件。
- Inspect：扩展 `material-library:import inspect --file`，复用既有有界 XLSX/CSV Parser，只读输出类型、大小、SHA-256、Sheet/CSV 行列、编码、分隔符、表头候选和可能标准字段；不输出业务数据行、不修改源文件。
- 治理：dry-run 显式返回分类、单位和品牌的 `EXACT/MATCHED/NEEDS_REVIEW` 及冲突/候选原因；不自动创建分类、单位或品牌。CLI 分页读取后只输出分类/单位/品牌、错误/警告/待审和重复等级安全汇总，不逐行打印物料正文。
- 重复：EXACT 候选直接阻断 Draft；HIGH_CONFIDENCE 候选保持人工确认门禁并阻断；POSSIBLE 只提示。所有等级继续禁止自动合并、删除或覆盖。
- 测试：新增本地 CSV/XLSX inspect 与类型错配测试，扩展分类名称、单位别名、品牌别名、EXACT/HIGH_CONFIDENCE、Draft/权限/幂等回归；专项 9/9、全量 Node 575/575、build、lint 0 error/1 个既有 warning、隔离 API smoke、319 文件凭证扫描和本地临时 SQLite 基线通过。
- 数据库/结果：未修改 Schema、Migration、Drizzle 或生产配置；真实 dry-run 未执行，Material DRAFT 数量为 0。任务保持 `BLOCKED / NO_REAL_DATA_MODE`，等待真实文件和隔离上传目录。
- 生产：未连接生产 D1/R2/Queue，未迁移、部署或创建生产资源。

### PHASE3-MATERIAL-LIBRARY-01 - `feat: add material master database schema`

- Git Commit：`2ff8d9c`。
- 审计：确认在线目标为 Cloudflare D1/SQLite 语义、Drizzle ORM/SQL Migration；既有 `material_master`、分类、动态属性、别名、供应商映射、Import Batch/File/Row/Event、Normalization 和 Draft/Review 服务可直接复用，因此未创建第二套物料主表或重写 Import。
- 数据库：新增 `0007`、受保护 Down、snapshot/journal；增加 units/unit aliases、brands/brand aliases、Normalization approvals、Import Draft links、duplicate candidates，并为 Material 增加品牌、单位和批次/文件/行来源外键；全部为增量表/可空列/约束/索引，无删除或破坏性重建。
- 业务/API：新增 inspect/dry-run/report、Normalization Approval 和 Draft commit；admin/manager 独立 `material.import.commit`，CSRF、版本/摘要、ERROR/WARNING 门禁、请求/行幂等、Validation、EXACT/HIGH_CONFIDENCE/POSSIBLE 候选和原子来源关联；创建结果只能是无正式编码的 `DRAFT`，后续继续复用人工提交/审核。
- 命令：新增只允许回环 URL 和 test/local/development commit 的 `material-library:import`，复用 API 提供 inspect/dry-run/commit/report，不直接连接 D1。
- 文件检查：只扫描 `/opt/erp`、`/home`；仅发现两套内容相同的治理模板/样例（XLSX 10 表和 9 个 CSV），未发现真实首批物料文件，未上传或执行真实 dry-run。
- 验证：迁移 3/3、闭环/权限/CSRF/幂等 3/3、既有 Material 生命周期 14/14、全量 Node 569/569、Vinext build、Drizzle 44 表无漂移、隔离 API smoke、314 文件凭证扫描、远程 URL 拒绝和临时 SQLite 基线通过；lint 0 error/1 个任务外既有 warning。
- 生产：未连接生产 D1/R2/Queue，未执行生产迁移、真实数据导入、Sites 保存或部署。
- 文档：新增 Material Library 落地说明和审计报告，记录模型复用、文件清单、风险、测试及下一步。

## 2026-07-17

### PHASE3-TASK04 实现 - `feat: add import normalization review ui`

- 前端：在 `/materials/imports/:batchId` 统一工作区增加七步 Stepper、`normalize/normalized/issues`、Current/Latest 双轨、启动/重试/版本重跑/取消、冻结幂等与 `RESULT_UNKNOWN`、2/5/10 复合轮询和真实行进度。
- 审阅：增加 Current Run 汇总、50/100 Rows 与 Issues opaque cursor、批次作用域 Row Drawer、Basic/200 动态属性/分类提示/供应商引用/Deferred Validation/Lineage、有界类型化值和五键 `safe_details`。
- 安全与可访问性：Capability 独立判断、401/403/404 清理、Batch/Run/Row/Lineage 归属核验、纯文本与安全 ID、Drawer 背景隔离/焦点约束/三级恢复、700px 全宽和状态文字语义。
- 测试：104/104 计划 ID、100/100 既有 Import UI 回归；本地 Playwright 50 Rows 801 ms、Drawer 398 ms、100 Issues、200 Attributes、1366/700px、无 N+1/Storage/History 正文及 0 console warning/error。
- 数据库/API/生产：未修改 Schema、Migration、后端 API、Normalization 业务逻辑、依赖或 hosting；未连接、迁移或部署生产资源。完整 Row Issues 局部门禁与七项非阻塞限制继续保留。

### PHASE3-TASK03 规格确认 - `docs: approve import normalization review ui`

- 项目负责人在正式设计提交 `c694045` 后明确回复“规格确认”；主规格中的 14 项 UI 决定从 `PROPOSED` 转为 `APPROVED`，并新增 D-023 决策记录。
- 确认范围仅为统一工作区、七步 Stepper、Current/Latest 双轨、启动/重跑/取消、Rows/Issues、Row Drawer、可访问性与性能门禁等书面规格；不自动创建或授权实施任务。
- Row Drawer 完整 Issue 查询局部门禁、`PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 和 7 项非阻塞限制继续有效，不因规格确认而视为已解决。
- 本次仍为 docs-only；未修改前端、API、Schema、Migration、业务逻辑、依赖或生产环境。

### PHASE3-TASK03 设计 - `docs: design import normalization review ui`

- 新增功能：无；本任务只形成 Material Import Normalization Review UI V1 正式规格、37 状态低保真线框、状态矩阵和 104 项未来实施测试计划。
- UI 契约：推荐继续 `/materials/imports/:batchId` 统一工作区、七步 Stepper、`normalize/normalized/issues` View、`batch/current_run/latest_attempt` 三层状态、固定 Processor Version、页面内存幂等、`RESULT_UNKNOWN`、2/5/10 轮询、真实行进度和协作式取消。
- 结果审阅：Rows 与 Issues 使用独立 URL 参数和 opaque cursor；Row Detail 使用批次作用域 Drawer，展示 Basic、动态属性、非正式分类提示、供应商引用、Deferred Validation 与 Lineage；结果全部只读，不实施分类、匹配、Draft 或正式导入。
- 门禁：记录 Row Drawer 完整 Issue 查询局部门禁、`PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 和完整历史、Batch Pointer、部分筛选、列表候选摘要、选中 Issue 刷新恢复等 7 项非阻塞限制；14 项决定全部保持 `PROPOSED`，等待提交后的“规格确认”。
- 验证：复用上一提交的可信运行时基线，只执行文档结构/链接、104 项编号与分组、37 线框、状态矩阵、14 项决定、门禁/限制、`git diff --check`、docs-only 范围和用户未跟踪文件保护检查；未重复运行无关 Node/build/API/Drizzle/Migration/SQLite/Playwright/全仓凭证扫描。
- 范围：未修改前端、API、Schema、Migration、Normalization/Mapping 业务逻辑、依赖、hosting 或 Legacy SQLite；未连接、迁移或部署生产 D1/R2/Queue；未创建 Draft 或正式物料。

### PHASE3-TASK02 实现 - `feat: add material import normalization`

- 决策与边界：批准 D-022 和正式规格的 16 项推荐决定；Normalization 只生成可追溯候选与 Deferred Validation，不调用 Draft/正式物料写服务，不执行分类、匹配或去重。
- 数据库：新增 `0006_material_import_normalization.sql`、三张关系表、批次 current pointer 与状态、events/outbox 扩展、约束/索引/绑定 trigger、Drizzle snapshot/journal，以及只在无 Normalization 业务状态时允许的受保护 Down。
- 运行与恢复：实现独立 normalization run、Mapping/Metadata 快照绑定、行级 JSON/Issue 暂存、Outbox、租约/心跳、幂等分块、资源上限、完整性摘要和单 D1 batch 原子发布；失败/取消清理未发布行，重跑在成功发布前保留旧 pointer。
- API/安全：实现异步启动、汇总、行列表、行详情和 Issue 列表五个 API；新增 `material.import.normalize`，保持 owner/read_any 可见性先于能力判断，支持 CSRF、强幂等、版本 CAS、读写限流、opaque cursor、稳定错误和安全审计。
- 测试：正式矩阵 54/54，Normalization/Migration 专项 18/18；覆盖 Up/受保护 Down/重升/失败回滚、约束/trigger、稳定发布、ERROR 行共存、幂等/块重放、分页、不同 processor 重跑、取消清理、Mapping/Metadata/parse 冻结、50,001 行与 payload 资源边界、发布竞争、五 API、权限/404、CSRF、429 和安全 500；全量 Node 458/458、build、隔离 API smoke、OpenAPI、Drizzle 无漂移、凭证扫描和临时 SQLite 基线通过，lint 0 error/1 个任务外既有 warning。
- 范围：未修改 hosting 或生产 binding，未连接、迁移或部署生产 D1/R2/Queue，未创建 Material Draft 或正式物料；根目录既有未跟踪 `.obsidian/` 保持不变。

### PHASE3-TASK01 设计 - `docs: design material import normalization`

- 新增功能：无；本任务只完成 Material Import Normalization & Staging V1 书面规格、未来数据模型和 API 契约。
- 架构与状态：推荐独立 normalization run、复用 Outbox/租约/CAS/原子发布，批次增加排队/运行/发布状态；执行失败与行级 ERROR 分离，不新增批次 `NORMALIZATION_FAILED`。
- 数据契约：推荐每行版本化 JSON 快照、独立 issue 表和 current pointer；冻结完整 lineage、空值/默认值、基础字段、动态属性、类型、公式禁用、Deferred Validation 和行状态语义。
- API/安全：设计异步启动、汇总、行列表/详情和 issue 五个路由；新增独立 `material.import.normalize` 能力，保持 owner/read_any 行级可见性、404/403、CSRF、强幂等、限流、稳定错误和纯文本安全边界。
- Migration/测试：只设计未来 `0006` 三表、batches/events/outbox 重建、索引、受保护 Down/重升和 54 项最低测试；16 项选择全部为 `PROPOSED`。
- 验证：OpenAPI 3.1 的 5 个操作/98 个本地引用、16 项决定逐项 11 字段、54 项测试/docs-only 检查通过；lint 0 error/1 个既有 warning；build 与 Node 440/440、隔离 API smoke、Drizzle 34 表无漂移、296 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 均通过并清理。
- 范围：未修改运行时代码、Schema、Migration、API、前端、依赖、R2/Queue/hosting 或本地旧版；未连接、迁移或部署生产环境。实际提交哈希以 `git log -1` 为准。

### PHASE2-TASK08 实现 - `feat: add material import workspace ui`

- 路由与工作区：新增 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`，实现权限驱动入口、opaque cursor 列表、状态 Stepper、非法 URL 规范化、错误/终态处置和服务端状态权威恢复。
- 文件与写安全：新增 10 MiB 单文件预检、`@noble/hashes@2.2.0`（MIT）增量 SHA Worker、确认后创建、受控单文件 multipart XHR、真实网络进度、独立幂等操作记录、重复文件新批次恢复及 RESULT_UNKNOWN 原 Key/原载荷恢复边界。
- 解析与 Mapping：实现 2/5/10 秒轮询、5/10/30 秒网络退避、Retry-After、可见性暂停、协作式取消、Sheets/Rows/Header、完整 256 列横滚、动态 Catalog、Mapping 保存/preview/confirm 新鲜度和 confirmed 只读；不创建 Draft 或正式物料。
- 测试与门禁：UI-001—UI-100 全部通过；Playwright Chromium 1366×768 的 50×256 + 256 Mapping 门禁通过，初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、30,285 DOM、123,423,127 bytes JS heap，sticky/键盘/语义/700 窄屏及控制台 0 error/0 warning通过。
- 全量验证：build 与 Node 440/440、lint 0 error/1 个任务外既有 warning、隔离 API smoke、5 份 OpenAPI 3.1/434 本地引用与 Batch 6 操作、Drizzle 34 表无漂移、289 文件凭证扫描和临时 SQLite self-test/smoke/go-live 通过；首次并行全量触发历史迁移用例 120 秒超时，串行复跑 440/440。
- 范围：仅修改 Site 前端、共享浏览器 Client、依赖锁、专项测试和治理文档；未修改后端 route/service、Schema、Migration、Metadata、hosting、本地旧版业务逻辑或生产环境，未部署。

## 2026-07-16

### PHASE2-TASK07 实现 - `feat: add import mapping target catalog`

- API：实现批次作用域 `GET /api/material-master/import-batches/:batchId/mapping-targets`，支持 BASIC/ATTRIBUTE/SPECIAL、`namespace/q/limit/cursor`、稳定排序、规范化搜索、摘要保护的不透明 cursor、Metadata/展示变化 409 和 `private, no-store`。
- 共享规则：新增 `MaterialImportMappingTargetRegistry`、运行时 D1 ACTIVE Metadata Repository 与 `MaterialImportMappingMetadataSnapshotService`；`material-import-mapping-metadata-v1` 规范 JSON SHA-256 覆盖 namespace/code、enabled/selectable、type、required、modes、default、unit、value constraints 等业务语义，展示文案只进入 cursor 搜索投影摘要。
- Mapping 统一：Parser Mapping 准备、PUT 保存、preview、confirm 和 Catalog 全部调用同一 Snapshot；保留现有请求、状态机、必填、唯一性、category_hint、supplier_reference、ignore 和历史失效 target 语义。
- 权限与安全：要求认证、read + map、owner/read_any 行级可见性；隐藏批次 404、可见但无 map 403。GET 无 CSRF/幂等要求，执行独立读取限流、request_id、安全错误和不记录 q/cursor/metadata 正文的 API 审计；不返回 attribute_id、表/列/SQL 或 Repository 内部信息。
- 测试：Catalog 专项 51/51；build 与全量 Node 339/339；lint 0 error/1 个既有 warning；隔离 API smoke、OpenAPI 解析/契约检查、Drizzle 无漂移、凭证扫描和临时 SQLite 环境守卫/self-test/smoke/backup-restore/go-live 通过。
- 门禁与范围：`BLOCKED_BY_MAPPING_TARGET_CATALOG` 已标记 `RESOLVED`；Import Workspace UI 尚未实施，仍受 50×256 性能与可访问性门禁。本任务未修改 Schema、Migration、Metadata 数据、前端、R2/Queue/hosting，未连接、迁移或部署生产环境。

### PHASE2-TASK06 设计 - `docs: design import mapping target catalog`

- Git Commit：Material Import Mapping Target Catalog V1 正式规格、OpenAPI 和治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `d1c6763`。
- 路由与权限：比较批次作用域、全局作用域和混入现有 Mapping 三种方案，推荐 `GET /api/material-master/import-batches/:batchId/mapping-targets`；要求 `material.import.read` + `material.import.map`、owner/`read_any` 行级可见性和隐藏 404，`read_any` 不自动等于 map。
- 数据来源：基础和特殊目标来自后续共享 Target Registry；动态属性只读运行时 D1 ACTIVE metadata，不读 seed、fixture 或历史 Mapping，不暴露 attribute id、表名、列名或 SQL。
- digest 审计：确认当前实现只摘要基础/供应商 code 与属性 code/type/status，且 Parser 准备与 Mapping Service 各自投影；规格要求实施前抽取共享 Registry + `MappingMetadataSnapshotV1`，由 Catalog、准备、保存、preview 和 confirm 共同使用，禁止第二套 digest。
- 契约：定义 BASIC/ATTRIBUTE/SPECIAL 三组、保留现有小写 namespace 与大写 target code、完整 target DTO、统一有界搜索/cursor、Metadata/展示双摘要、`private, no-store`、历史失效目标和稳定安全错误。
- 测试与决定：记录 43 项未来实施测试和 12 项 `PROPOSED` 决定；Catalog 不可用时整体阻断 TargetSelector，不允许降级到基础字段或前端硬编码。
- 验证与范围：5 份 OpenAPI YAML/本地引用、规格 43 项编号/12 项决定、lint 0 error/1 个既有 warning、build 与全量 Node 288/288、隔离 API smoke、Drizzle 34 表无漂移、272 文件凭证扫描和临时 SQLite 完整基线通过；最终 `git diff --check` 与 docs-only 范围在提交前复核。未修改运行时代码、Mapping 语义、Schema、Migration、Metadata、前端、R2/Queue/hosting 或生产环境。

### PHASE2-MAINT-01 修复 - `fix: ignore comment-only rollback statements`

- Git Commit：共享 breakpoint-aware Migration statement 过滤、隔离回归测试和治理文档在独立维护提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `f965ddb`。
- 根因：Migration 测试 helper 按既有 breakpoint 分割后仅执行 `trim().filter(Boolean)`；0005 protected Down 尾部 `-- End of protected 0005 rollback.` 非空，因此被作为没有可执行 SQL 的 D1 statement 提交。
- 修复：在共享测试/开发辅助层识别空白、`--`、`/* ... */`、单/双引号和成对引号转义，只过滤没有可执行内容的片段；提交 D1 的仍是未修改原片段。未闭合字符串或块注释 fail-closed 保留给 D1 报错；不支持 SQLite 本身不支持的嵌套块注释。
- 复用：0003、0004、0005 Down 测试和仓库内确认使用相同 breakpoint 语义的 Migration 夹具统一调用共享辅助器；未按分号切分，也未针对 0005 特判。
- 回归：新增 10 个隔离 D1 用例覆盖尾部行注释、块注释、空白、SQL 前后注释、字符串内注释标记/分号、混合注释和异常片段 fail-closed；0003、0004、0005 Down 专项均通过。
- 验证：Migration 专项 20/20；build 与全量 Node 288/288；lint 0 error/1 个既有 warning；隔离 API smoke、4 份 OpenAPI、Drizzle 34 表无漂移、凭证扫描、临时 SQLite 完整基线和范围检查通过。
- 边界：0003/0004/0005 Up/Down、Schema、Drizzle snapshot/journal、API 和生产配置均未修改；0005 尾部保护说明保留，Migration 业务语义不变；未连接、迁移或部署生产环境。

### PHASE2-TASK05 设计 - `docs: design material import workspace ui`

- Git Commit：Material Import Workspace UI V1 的三份正式设计文档与项目治理更新在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `73435a3`。
- 路由与状态：定义 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`，采用服务端状态驱动的单工作区 Stepper；`view` 仅为展示意图，非法参数 replaceState 规范化；列表使用不透明单向 cursor 的单批结果导航。
- 文件与上传：确定先预检/SHA/确认再创建批次；推荐专用 Worker 的真实增量 SHA-256；共享 API Client 内受控 multipart XHR transport；精确区分网络上传进度、服务端存储/安全检查、取消和 RESULT_UNKNOWN；重复 REJECT 后按新批次 ALLOW_DUPLICATE 流程恢复。
- 解析与查看：定义 parse 前重读、独立幂等、2/5/10 秒受控轮询、网络与 Retry-After 退避、协作式取消和粗粒度真实状态；Sheet/Rows 使用真实分页并保留稀疏 cell、日期、公式、错误、列宽与尾随空列语义。
- Mapping：采用三列编辑器、显式保存、已保存版本预览和当前页面最新 preview 门禁；confirmed 只读且不虚构确认人/时间、不显示正式导入；100 项未来实施测试逐条记录。
- 门禁：记录 `BLOCKED_BY_MAPPING_TARGET_CATALOG`，禁止从 seed、测试数据或前端硬编码绕过动态目标；记录 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`，50×256 未验收前不开放完整实施或 page_size=100。
- 决策：16 项均保持 `Status: PROPOSED`，只有完整文档审阅后收到“规格确认”才能转为 `APPROVED`。
- 验证：lint 0 error/1 个既有 warning、环境守卫 6/6、隔离 API smoke、4 份 OpenAPI 解析、268 文件凭证扫描、100 项测试编号/16 项决定/22 状态线框结构检查和临时 SQLite 基线通过。`npm test` 构建成功但基线未全绿：并发运行 275/278 通过，两个超时迁移串行复跑通过；`0005 protected Down` 单独复跑仍因 rollback SQL 尾部纯注释被测试 helper 当作 D1 statement 而失败。本任务按 docs-only 边界不修改既有迁移或测试运行时代码。
- 范围与生产：仅新增/更新文档；未修改前端运行时代码、API、Schema、Migration、R2/Queue、hosting 或生产配置，未连接、迁移或部署生产环境。

### PHASE2-TASK04 实施 - `feat: add material import parser and mapping`

- Git Commit：Parser 与字段 Mapping V1 非生产实现、测试和治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `a16b2f3`。
- 数据库：新增不可修改的 `0005_material_import_parser_mapping.sql`、Drizzle schema/快照/journal 和数据保护 Down；扩展批次状态与 current run，新增 parse run、Sheet、Shared Strings 分块、Outbox、header suggestion、Mapping 主从表，并按 legacy run 保留既有原始行。
- Parser：固定 `@zip.js/zip.js@2.8.26`、`sax-wasm@3.1.4`、`csv-parse@7.0.1`；实现 Web Streams 有界 XLSX/CSV、UTF-8/BOM/GB18030、三种分隔符、OOXML/XML 安全、日期/公式/隐藏 Sheet、组合资源限制和稳定 raw row hash。
- 调度与恢复：实现 D1 Outbox dispatcher、可注入 scheduler、Cloudflare Queue adapter、至少一次去重、run 租约/接管/心跳、Sheet 恢复、分阶段失败、原始行原子发布和 Mapping 准备独立重试；没有创建 Queue binding 或部署配置。
- Mapping/API：实现 Sheet/行读取、header candidates、关系化 Mapping 完整替换、静态与动态 target allowlist、100 行预览、metadata 摘要确认、乐观锁、事务幂等/审计及七个精确 API；明确不创建 Material Draft 或正式物料。
- 权限：新增 `material.import.parse` 与 `material.import.map` capability；admin/manager/purchase/engineering 获显式授权，`read_any` 不隐含 parse/map；继续执行 owner/read_any 最小披露、Origin/CSRF 和隐藏 404。
- 验证：专项 Parser 36、集成 11、migration 4、兼容 3，共 54/54；全量 Node 278/278、build、隔离 Parser TypeScript 夹具、隔离 API smoke、OpenAPI YAML、Drizzle 无漂移、265 文件凭证扫描及本地临时 SQLite 基线通过，lint 0 error/1 个任务外既有 warning。全仓 `tsc --noEmit` 的 10 个既有任务外错误未在本任务修复。
- 依赖审计：`npm audit --omit=dev` 仍报告 Next 内置 PostCSS 的 2 个 moderate，建议修复会触发破坏性版本变化；本任务不执行 force fix。新增 Parser 依赖的固定版本、许可证、构建和运行时兼容测试通过。
- 生产影响：无。未连接生产 D1/R2/Queue，未创建 bucket/binding/Cron，未执行生产 migration、修改 hosting 或部署；未实施前端、清洗、分类、匹配、AI、Material Draft 或正式物料写入。

### PHASE2-TASK03 设计 - `docs: design material import parser and mapping`

- Git Commit：Parser 与字段 Mapping V1 文档在独立提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `63e0483`。
- 规格：新增 Parser 主规格、OpenAPI 草案、Mapping 规格和 Mermaid 流程图，覆盖 `FILE_READY -> MAPPING_CONFIRMED`、`PARSED` 原子发布恢复点、用户可见性和失败分类。
- 调度与恢复：明确 D1/Queue 无分布式事务，推荐持久 Outbox；Queue 至少一次、`max_batch_size=1`、低并发和租约保持 `PROPOSED`。V1 以 Sheet 为真正恢复边界，500 行检查点只用于观测、预算、心跳和幂等写入。
- 数据模型：设计 `parse_runs`、Sheet/header、Outbox、Shared Strings、Mapping 主从表、`current_parse_run_id` 及 `material_import_rows` 唯一约束重建；只提出 `0005` Up/Down/回滚方案，未创建 migration 或修改 Drizzle。
- 解析与安全：方案 A `zip.js + sax-wasm + 受限 OOXML`、CSV `csv-parse` 均为待兼容验证候选；定义 XML/OOXML、公式、外链、隐藏 Sheet、编码、稀疏 cell、行宽、日期解释、Shared Strings 和组合资源预算。
- Mapping/API：定义 Sheet/header suggestion、稳定 target catalog、`category_hint`、一源一目标、受限默认值、预览、确认、旧 Mapping 失效、七个 API、权限、CSRF、幂等、CAS 和稳定错误。
- 决策：集中记录 16 项 `Status: PROPOSED` 决策；设计方向确认不等于正式规格确认、实施批准或生产批准。
- 验证：文档完成后运行 Site lint、全量 Node、隔离 API smoke、凭证扫描、临时 SQLite 基线、OpenAPI YAML 解析、`git diff --check` 和范围核对；实际结果记录在 `STATUS.md`。
- 生产影响：无。未实施 Parser、Schema、`0005`、Queue、R2/Cron、API、前端、生产迁移或部署，未连接生产 D1/R2。

## 2026-07-15

### PHASE2-TASK02 实施 - `feat: add material import batch foundation`

- Git Commit：Material Import Batch Foundation V1 的非生产实现、测试和治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `050d134`。
- 数据库：新增 `0004_material_import_batch_foundation.sql`、Drizzle schema/快照及带数据保护的 Down 文件；创建批次、文件、冻结原始行契约、不可变事件和专用幂等五表，包含 V1 状态、外键、唯一性、终态与完整性约束。
- 对象存储：新增可注入接口、R2 适配器和内存测试替身；确定性环境前缀 key 使用条件写入且不覆盖，支持 HEAD、范围读取和受控删除；没有创建生产 bucket、binding 或密钥。
- 上传与安全：实现恰好一个 `file` part 的有界流式 multipart、10 MiB 实际计数、增量 SHA-256、声明哈希核对与文件类型探测；XLSX 检查 OOXML/ZIP 结构、加密/宏/条目/展开/压缩比/路径边界，CSV 检查 UTF-8/GB18030、NUL、二进制和完整 HTML 伪装，不解析工作表或业务行。
- API、权限与 Saga：实现创建、列表、详情、上传、事件、取消六个精确路由；复用 Session/Origin/CSRF，以 capability + owner/`read_any` 执行行级可见性和隐藏 404，并实现专用幂等、限流、乐观并发、重复 SHA 策略、D1/R2 故障协调、取消竞争及手工清理服务。
- 验证：新增迁移 3/3、导入 API/Saga/安全 12/12；全量 Node 224/224、build、隔离 API smoke 和 247 文件凭证扫描通过，lint 0 error/1 个任务外既有 warning。
- 本地基线：项目 Python 3.12 在临时 SQLite 中运行 `server.py --self-test`、`smoke_test.py` 和 `go_live_check.py --no-backup` 全部通过，临时数据已清理。
- 文档：12 项决定转为 `APPROVED`；同步正式规格、OpenAPI、数据流/状态图、MASTER、TASKS、ROADMAP、DECISIONS、STATUS 和 CHANGELOG；Excel/CSV 行解析顺延为 `PHASE2-TASK03`。
- 数据库与生产：未连接生产 URL/D1/R2，未执行生产迁移，未创建生产 R2 资源、生命周期或 Cron，未部署；没有解析 Excel/CSV 行、写入 `material_import_rows` 或创建 Material Draft。

### PHASE2-TASK01 设计评审 - `docs: design material import batch foundation`

- Git Commit：正式规格、OpenAPI 草案、数据流图和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `353c6d9`。
- 新增功能：无；本任务只完成 Material Import Batch Foundation V1 书面设计，12 项决定全部保持 `PROPOSED`。
- 存储架构：推荐私有 Cloudflare R2 保存原始文件、D1 保存批次/文件元数据/原始行契约/幂等/不可变事件；记录当前 `.openai/hosting.json` 的 `r2` 为 `null` 且仓库没有可用 binding，不把待新增基础设施表述为现有能力。
- 上传与恢复：定义创建批次后单文件 multipart Worker 代理上传；以确定性、不可覆盖 object key 和实际 SHA/字节数构成可恢复 Saga，不宣称跨 D1/R2 分布式事务或 exactly-once。
- 状态与安全：分离文件 `storage_status` 与 `security_check_status`；只有 STORED、基础检查通过、实际摘要/大小和有效检测类型同时满足才进入 `FILE_READY`；增加批次级 `RECONCILIATION_REQUIRED`、取消竞态和清理事件。
- 数据契约：定义批次、文件、0-based 工作表原始行、不可变事件和专用导入幂等技术表；冻结 `EMPTY/TEXT/NUMBER/BOOLEAN/DATE/FORMULA/ERROR` 类型化单元格契约，CSV 固定 `sheet_index=0`、`sheet_name=__CSV__`。
- API、安全与并发：OpenAPI 草案包含创建/列表/详情/上传/事件/取消 6 个操作；服务端 capability 与 owner/`read_any` 行级可见性、CSRF、限流、CAS、规范化 multipart 摘要、重复 SHA 显式动作和安全错误码均有定义，不提供下载或对象地址。
- 保留与 Migration：建议以 `terminal_at` 计算原始数据和批次记录保留期，采用两阶段可恢复清理；只描述未来 `0004` 的五表、V1 CHECK、候选索引查询依据和扩展式迁移，不创建任何迁移文件。
- 平台依据：Worker 内存/请求体、D1 行/BLOB、R2 私有访问、上传与价格事实均引用 2026-07-15 当前 Cloudflare 官方文档；10 MiB 业务上限仍为保守建议，仓库没有历史样本容量证据。
- 验证：OpenAPI YAML 与 93 个本地引用解析通过，6 个操作；12 项决定结构检查通过。build 通过；全量 Node 串行 209/209、隔离 API smoke、环境守卫 6/6、凭证扫描 236 个文件、lint 0 error/1 个既有 warning通过。首次并行全量中一个迁移用例因 120 秒资源竞争取消，单独 1/1 与串行全量均通过。
- 本地基线：项目 Python 3.12 临时 SQLite 环境守卫 4/4、`server.py --self-test`、`smoke_test.py`、备份恢复和 `go_live_check.py --no-backup` 全部通过；临时数据已清理。
- 数据库与生产：未修改运行时代码、Schema、Migration、索引、对象存储、Binding、API、前端或部署配置；未连接生产 URL/D1/R2，未创建 bucket、密钥、生产版本或部署。
- 停止条件：提交后停止，等待项目负责人逐项选择并统一回复“规格确认”；此前任何推荐方案都不得转为 `APPROVED` 或进入实施。

### PHASE1-TASK14 实施 - `feat: add material review ui`

- Git Commit：前端实现、UI 测试、规格和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `c6ddf3b`。
- 页面与入口：新增 `/materials/review` 与 `/materials/:materialId/review`；`MaterialShell` 只按 `material.review.queue` 显示审核队列入口，不按角色名推断权限。
- 审核队列：实现 URL 权威筛选、300ms 关键词、叶子分类、来源、创建人、提交日期、四种 allowlist 排序及 20/50/100 服务端分页；展示 `submitted_by` 但不伪造服务端不支持的筛选，服务端 `total` 为唯一权威。
- 工作台与复用：按方案 A 实现左侧完整只读详情、右侧约 310px sticky Validation/职责分离/审核操作；提取共享只读详情组件供既有详情与审核工作台复用，既有只读 UI 37/37 回归通过。
- 批准与驳回：最终动作前重读统一详情；ERROR 禁止批准但不自动驳回，WARNING 在单一最终对话框列出并明确确认；批准复读 ACTIVE/正式编码，驳回复读 DRAFT/`last_rejection` 后返回原队列状态。
- 权限与职责：queue/approve/reject 独立能力驱动；创建人或最后修改人禁审，提交人本身不禁审；前端提示与关闭动作，既有服务端权限、职责、状态和 Validation 校验保持最终权威。
- 幂等与并发：approve/reject 使用独立的页面内存 Key、不可变 endpoint/payload 快照和共享 Client 受保护写；覆盖重复点击、`RESULT_UNKNOWN` 原请求安全重试、`IDEMPOTENCY_IN_PROGRESS`、冲突、状态变化、422、429、401/403/404/5xx 和 request_id。
- 安全与可访问性：实现安全 `return_to`、dirty/beforeunload、离开确认、纯文本渲染、焦点定位、对话框初始焦点/Tab 循环/Escape/焦点恢复及 live region；不写 localStorage/sessionStorage，不引入第二套认证或 HTTP Client。
- 测试：新增 Review UI 51/51；全量 Node 209/209；build 通过；lint 0 error/1 个任务外既有 warning；一次性隔离 D1 API smoke 与 233 文件凭证扫描通过。
- 浏览器验收：本地 Vinext + Playwright 在 1366×768 完成队列、310px sticky 审核栏、WARNING 确认和批准后返回原队列的完整往返；验收网络夹具及截图未提交。
- 本地基线：临时 SQLite `server.py --self-test`、`smoke_test.py`、备份恢复、环境保护 4/4 和 `go_live_check.py --no-backup` 全部通过；临时数据已清理。
- 数据库与生产：未修改 API、Schema、Migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 URL/D1，未迁移真实数据、创建生产版本或部署。
- 已知限制：队列 API 仍不支持 `submitted_by` 筛选；远程 Test D1、候选索引、`PENDING_APPROVAL` 收缩及生产迁移/部署均需独立任务与授权。

### PHASE1-TASK13 设计评审 - `docs: design material review ui`

- Git Commit：正式规格、低保真线框和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `9278bea`。
- 新增功能：无；本任务只完成 Material Review Queue 与审核工作台 V1 书面设计，不修改任何运行时代码。
- 路由与布局：定义 `/materials/review` 和 `/materials/:materialId/review`；推荐方案 A，即左侧完整只读详情、右侧 sticky Validation/职责分离/审核操作，方案 B 仅作比较。
- 队列与返回：筛选、排序和分页由 URL 管理；批准或驳回成功后安全返回原队列状态，当前页清空时回到最后有效页；展示 `submitted_by`，但不提供服务端尚不支持的提交人筛选。
- 权限与职责：按 `user.permissions` 展示入口和动作，不硬编码角色；`created_by` 或 `last_modified_by` 命中当前用户时先提示并关闭审核动作，服务端 `403 SELF_REVIEW_FORBIDDEN` / `LAST_EDITOR_REVIEW_FORBIDDEN` 继续作为最终判断。
- 批准与驳回：批准前重新 GET 最新详情并使用单一最终确认；WARNING 确认绑定物料、版本和规范化 Validation 摘要，但摘要仅是前端新鲜度标记。驳回要求 1–1000 字原因；approve/reject 使用相互独立的页面内存幂等状态。
- 错误与可访问性：结构化 `error.code` 优先；覆盖 VERSION_CONFLICT、RESULT_UNKNOWN、401/403/404/422/429/500、文字状态、键盘对话框、焦点恢复、问题定位和纯文本渲染。
- 测试设计：保留并分组定义全部 51 项实施测试，附方案 A/B、主要状态、确认对话框和 1366×768 线框；写测试只能使用一次性本地隔离 D1，并拒绝 production、公共 URL 和远程 binding。
- 验证结果：lint 0 error/1 个既有 warning；构建与 Node 158/158、一次性本地 D1 API smoke、226 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查全部通过；临时数据已清理。
- 数据库与生产：未修改前端运行时代码、API、Schema、Migration、索引、业务服务或部署配置；未连接生产 URL/D1，未迁移真实数据或部署。

### PHASE1-TASK12 实施 - `feat: add material draft ui`

- Git Commit：前端实现、UI 测试、规格和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `7e6844d`。
- 页面与入口：新增 `/materials/new` 和 `/materials/:materialId/edit`；列表创建入口与 DRAFT 详情编辑入口仅依据 `/api/session -> user.permissions` 和 own/any 能力显示，不硬编码角色。
- 表单：实现布局 C、分类树和当前叶子 Schema、TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/compatible unit、严格数值、完整 attributes、0/false、未知旧属性显式删除和分类切换确认。
- 写链路：实现创建 POST、编辑 PATCH 完整替换、GET 回读、Validation ERROR/WARNING、WARNING 版本绑定确认和 submit；保存成功后同步、部分成功、结果未知和提交成功返回只读详情均有独立状态。
- 安全与并发：共享 Client 对受保护 Material 写请求强制显式 Idempotency-Key 与 CSRF；同一操作仅允许原 Key、原 method、原 endpoint、原 payload 重试；覆盖 VERSION_CONFLICT、Retry-After、重复点击、dirty/beforeunload、Schema 漂移和状态/权限变化。
- 驳回与错误：编辑页只读展示 `last_rejection`；401/403/404/409/422/429/5xx 使用安全中文提示和 request_id，不向浏览器暴露 SQL、堆栈或敏感正文。
- 验收：Draft UI 54/54、全量 Node 158/158；build、lint 0 error/1 个既有 warning、隔离 API smoke、224 文件凭证扫描和临时 SQLite 五项基线通过。
- 浏览器：一次性本地 D1 实机完成创建、编辑、PATCH/GET/submit 至 `PENDING_REVIEW`；1366/1280/1024/768 无横向溢出，三列按断点降级，离开保护和程序内成功跳转通过。
- 数据库与生产：未修改 API、Schema、migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 URL/D1，未迁移真实数据或部署。
- 已知限制：统一详情没有历史 `schema_version`；V1 使用当前 Schema、未知 code 保护和服务端 422 重载 fail-closed，不自动迁移旧属性。

### PHASE1-TASK11 实施 - `feat: add last rejection material projection`

- Git Commit：实现、隔离测试、OpenAPI 和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `402ef9b`。
- 历史来源：单一使用不可变 `material_versions` 的 `event_type='REJECT'` 行；现有原子写事务已完整保存版本、驳回原因、审核人和审核时间，不关联 change logs，不修改历史。
- Query Service：新增统一 `lastRejection()` 有界投影；`/materials/:materialId` 与 `/drafts/:materialId` 在既有行级可见性之后复用同一查询，列表不执行且无 N+1。
- 确定性与安全：固定 `version_no DESC, reviewed_at DESC, id DESC LIMIT 1`；无记录返回 null，reason 原样作为纯文本，缺少任一必需历史字段时 fail-closed 为带 request_id 的脱敏 `INTERNAL_ERROR`。
- 查询计划：隔离 D1 返回 `SEARCH material_versions USING INDEX material_versions_material_version_uq (material_id=?)`，未出现全表扫描；本任务未新增索引或 migration。
- 测试：新增 1 个顶层隔离 D1 场景，覆盖 null、单次/多次驳回、摘要窗口外驳回、重编/重提/最终 ACTIVE、两详情一致、drafts 状态限制、隐藏 404、纯文本、损坏历史、确定性 SQL、查询计划和分页/摘要回归；Node 104/104 通过。
- 全量验证：build、lint 0 error/1 个既有 warning、OpenAPI YAML、一次性 D1 API smoke、219 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复、go-live 检查和 `git diff --check` 全部通过。
- 数据库与生产：未修改 schema、migration、索引、审核写服务、前端或历史记录；未连接生产 URL/D1，未迁移或部署。
- 已知限制：现有索引按 material_id/version_no 搜索，没有专用 REJECT 索引；当前单详情计划满足有界要求，若单物料版本规模显著增长需独立复测和审批。

## 2026-07-14

### PHASE1-TASK10 设计评审 - `docs: design material draft ui`

- Git Commit：书面规格、低保真线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `9bb1756`。
- 新增功能：无；本任务只完成 Material Draft 创建、编辑与提交审核界面 V1 书面设计。
- 路由与布局：定义 `/materials/new`、`/materials/:materialId/edit`，采用顶部分类/基础信息、全宽动态属性和约 200px 右侧快速定位/Validation 的布局 C；窄宽下辅助栏移动到顶部。
- 表单与 Schema：只读取当前分类 Reference Schema，按 display_order 和中性分段渲染 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位；PATCH 使用完整可编辑聚合，未知旧属性和分类切换不得静默删除。
- 写状态：定义 POST 创建后 GET 重载、PATCH/GET/submit、WARNING 确认、页面内存 IdempotencyKeyController、RESULT_UNKNOWN 安全重试、SAVED_UNSYNCED、规范化 dirty 和 VERSION_CONFLICT 只读对照。
- 权限与安全：动作只读取 `/api/session -> user.permissions`；复用现有会话、CSRF、安全 return_to 和共享 Client；source_ref 只读，POST 省略、PATCH 不发送；不硬编码角色或复制服务端 Validation。
- API 前置：记录统一详情 `last_rejection` 最小只读投影为正式前端实施阻断前置；本任务未修改 API、Schema、Migration 或写服务。
- 测试设计：定义单元、组件、集成、原 47 项加 7 项扩展 E2E，以及 1366×768 人工视觉/键盘验收；文档阶段运行完整隔离基线。
- 验证结果：lint 0 error/1 个既有 warning；构建和 Node 103/103、一次性本地 D1 API 烟测、219 文件凭证扫描、临时 SQLite 环境守卫/自测/烟测/备份恢复/go-live 检查及 `git diff --check` 全部通过。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK09 实施 - `feat: add material master read ui`

- Git Commit：前端实现、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `7b0527c`。
- 页面路由：新增 `/materials`、`/materials/:materialId`、`/versions` 和 `/change-logs` 四条原生 Vinext 路由；刷新、深链接和浏览器历史不依赖 hash 或 iframe 内 tab。
- 列表：实现紧凑筛选、高密度横向滚动表格、固定编码/名称列、服务端分页/排序、20/50/100 page_size、300ms keyword debounce、分类树和 URL 权威状态；分类失败不阻断基础列表。
- 详情与历史：实现基本、职责、类型化属性、Validation、最近 5 条版本/变更摘要分区；完整历史独立分页、comment 折叠、快照/diff 有界行下展开和 operation_id 安全显示，不提供恢复或写操作。
- 认证与请求：抽取唯一 `public/erp/api-client.js`，legacy 与 Material 页面共同使用相对 URL、同源 Cookie、Material/legacy 错误解析和 401 事件；Material 未认证访问使用现有根页面登录遮罩并通过安全 `return_to` 返回。
- 状态与错误：INACTIVE 独立显示“停用”，OBSOLETE/REPLACED 仅作防御性展示，未知状态安全降级；400/401/403/404/500、网络失败、request_id、加载、空数据库和筛选无结果均有页面状态。
- 测试：UI 单元/契约 37/37；全量 Node 103/103；四条本地 Vinext 开发路由均返回 200；lint 0 error/1 个任务外既有 warning；build、隔离 API smoke、217 文件凭证扫描和临时 SQLite 完整基线通过。
- 数据库/API：未修改 API、Schema、Migration、索引、Material 业务服务或 legacy SQLite；前端不执行行级权限过滤并以服务端 total 为唯一总数。
- 已知限制：当前普通 Node production start 不能加载 Vinext 构建中的 `cloudflare:` 模块，本地深链接验证使用既有开发运行面和正式 build；生产 Site 仍为旧版本。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK09 设计评审 - `docs: design material master read ui`

- Git Commit：书面规格、文字线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `4d2f54b`。
- 新增功能：无；本阶段只完成 Material Master 只读管理界面 V1 书面设计。
- 页面设计：列表采用高密度紧凑筛选和企业表格，详情采用高密度分区卡片；版本历史与变更日志保留独立 URL 并作为详情工作区页签。
- URL 与交互：定义列表查询规范化、keyword debounce、前进后退、深链接、安全 `return_to`、分类 ID/path 语义、服务端分页/排序和固定关键列。
- 权限与错误：前端不复制行级权限；隐藏对象统一 404；定义 401/403/400/500、网络失败、request_id、Material 嵌套错误和 private/no-store 边界。
- 历史与属性：定义 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位/空值展示、Validation ERROR/WARNING、最近 5 条摘要、有界版本快照和变更详情。
- 架构：记录现有 iframe/tab、无通用组件和 legacy 错误包装差异；建议使用真正 Vinext 路由、唯一共享浏览器请求边界，不新增大型状态或请求依赖。
- 验证：规格占位符/路由/范围自检通过；Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、203 文件凭证扫描和临时 SQLite 完整基线通过；临时数据已清理。
- 数据库/API/代码：无变化；未修改前端、API、Schema、Migration、索引、业务服务或 legacy SQLite。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK08 实施 - `feat: add material reference and query api`

- Git Commit：实现、测试、查询计划证据和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置规格提交为 `928e08f`。
- Query Service：统一 materials/drafts 的列表、可见性、详情聚合、类型化属性、当前 metadata 校验和历史读取；drafts 只保留工作流兼容字段与分页外壳，审核队列保持独立。
- API：新增分类 tree/flat、四级叶子 Schema、`/materials` 列表/详情、版本分页和变更日志分页 6 个路由；详情历史摘要各最多 5 条，完整历史默认 20、最大 50。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 扩展；授权谓词与筛选在 SQL/count 取交集，隐藏记录不返回、不计 total，不可见详情/历史返回 404。
- Metadata 与缓存：Schema 只读当前 D1，不读 seed；description 缺失为空字符串，enum label 缺失等于 code；共享 Validation 单位策略；Reference 使用强内容摘要 ETag/304，物料及历史使用 `private, no-store`。
- 性能：列表分类路径与审核 metadata 批量加载，新增查询次数防 N+1 回归；1k/10k/100k 查询计划和采样已记录，发现候选优化方向但未创建索引或 migration。
- 测试：Site build、Node 66/66、隔离 API smoke、lint 0 error/1 个任务外既有 warning、201 文件凭证扫描、查询计划脚本和临时 SQLite 完整基线通过；全量 tsc 仍只有 `db/schema.ts` 两处既有 Drizzle TS2740，按范围未修改。
- 已知限制：继续双读 `PENDING_APPROVAL`；leading-wildcard keyword 没有专用全文索引；候选索引需再次审批；无前端、写接口、导入、AI、候选匹配、真实迁移或下游业务变化。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK08 设计评审 - `docs: design material reference and query api`

- Git Commit：书面规格、OpenAPI 和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `0edede0`。
- 新增功能：无；本阶段只完成 Material Master Reference & Query API V1 书面设计。
- API 设计：新增统一 `/materials` 列表/详情、分类树、叶子 Schema、版本分页和变更日志分页契约；`/drafts` 保留为复用统一 Query Service 的兼容层，`/review-queue` 保持独立。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 取交集；列表在 SQL/count 中过滤，不可见详情返回 `404 MATERIAL_NOT_FOUND`。
- 缓存与性能：分类 tree/flat 和叶子 Schema 使用规范化内容摘要 ETag 与私有可验证缓存；物料、历史和工作流响应统一 private/no-store；列表不逐项 Validation，详情只执行单物料当前校验，历史有界分页。
- 数据库变化：无；未创建 migration 或索引。只列出候选组合索引，要求后续先完成 1k/10k/100k 合成数据的 `EXPLAIN QUERY PLAN` 和延迟证据，并再次审批。
- 文档变化：新增 `reference-query-api-v1.md` 和 OpenAPI；D-014 记录已确认架构与读取范围；同步更新 MASTER、TASKS、STATUS。
- 待确认：规格最终字段、分页、缓存 Header，以及现有 metadata 无 description/枚举显示名时采用空 description 和 `label = code` 的 V1 表达。
- 验证：OpenAPI YAML、9 个路由/35 个 schema 引用和占位符检查通过；Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 Miniflare API smoke、196 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时数据已清理，`git diff --check` 通过。
- 生产影响：无；未修改 Schema、migration、API 代码、业务服务或前端，未连接生产 D1、迁移真实数据或部署。

### PHASE1-TASK07 实施 - `feat: add material draft lifecycle`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `3dbf2b0`。
- 状态机：实现 `DRAFT -> PENDING_REVIEW -> ACTIVE` 和 `PENDING_REVIEW -> DRAFT`；驳回后允许完整替换编辑并重新提交，批准/驳回不再接受 `DRAFT`。
- API：新增 PATCH 草稿完整可编辑聚合替换、POST 提交和 GET 审核队列；补充 OpenAPI 非 Merge Patch 契约、稳定状态错误、默认分页/排序、allowlist 筛选和当前 metadata 校验摘要。
- 权限与职责：新增 edit-own/edit-any/submit/review-queue；提交同时校验 own/edit-any；创建人永久禁审、当前提交版本最后修改人禁审，无 admin 例外，`submitted_by` 本身不构成禁审。
- 数据库：新增 `0003_material_draft_lifecycle.sql`、受保护 Down 和 Drizzle snapshot/journal；增加三个职责字段、双状态过渡约束、PATCH 幂等 method 和四个审核队列索引；可验证旧待审数据回填，无法恢复职责时预检失败，历史快照不改写。
- 并发与安全：PATCH、submit、approve、reject 继续使用严格 Origin/CSRF、24 小时幂等、60/20 限流和乐观锁；业务、属性、版本、变更日志、幂等完成与 API 成功审计在单一 D1 batch 提交。并发 PATCH/提交/审核均验证仅一个成功。
- 测试：build 和 Node 62/62 通过；lint 0 error/1 个既有 warning；`0003` 升级、失败预检、约束、索引、空库 Down/重升、完整生命周期、职责分离、N+1 边界及一次性 D1 smoke 通过；194 文件凭证扫描和本地临时 SQLite 基线通过。
- 已知限制：过渡 schema 仍接受 `PENDING_APPROVAL`，破坏性收缩必须另建任务；无页面、多级审核、break-glass、导入、AI、真实物料迁移或下游业务修改；既有 Drizzle 自引用 TypeScript 诊断未在本任务修复。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK07 设计评审 - `docs: design material draft lifecycle`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成草稿生命周期、重新提交和审核队列 V1 书面设计。
- 修改功能：无；未修改现有 Validation、Draft/Review Service、Material API、页面或 legacy 运行面。
- 数据库变化：无；规格提出后续前向 migration 增加 `last_modified_by`、`submitted_by`、`submitted_at`，分步统一 `PENDING_REVIEW`，扩展 PATCH 幂等 method 并增加审核队列索引，当前未创建或执行 migration。
- API 变化：无已实现路由；规格拟议 PATCH 草稿、POST 提交和 GET 审核队列，并收紧批准/驳回只能操作 `PENDING_REVIEW`。
- 权限与职责：拟议 edit-own/edit-any/submit/review-queue 权限；所有角色继续禁止创建人自审，并新增最后实质修改人不得审核当前版本。
- 文档变化：新增 `docs/material-master/draft-lifecycle-v1.md`；D-013 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险和下一步。
- 待确认：当前职责字段方案、物理状态更名、PATCH 完整替换、编辑 Validation 阻断、提交人审核、队列校验口径、提交说明、权限矩阵和 migration 分步方案。
- 验证：Site build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；一次性 Miniflare API smoke、189 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore 和 `go_live_check --no-backup` 通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK06 实施 - `feat: add material draft and review api`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `e55318c`。
- 新增功能：实现创建、列表、详情、批准、驳回 5 个 Material 路由；复用现有会话并增加细粒度权限、全员禁止自审、严格 Origin/双提交 CSRF、稳定错误和只读 Query Service。
- 数据库变化：新增 `0002_material_draft_review_api.sql`、空隔离库 Down、Drizzle snapshot/journal；增加 `material_api_idempotency`、`material_api_rate_limit_buckets`，扩展关系化 API 审计列及 Material 列表/审计索引；未修改 `0000`/`0001`，未执行生产 migration。
- 并发与安全：幂等作用域为用户、方法、具体路径和 Key 摘要；保存 canonical 请求摘要、120 秒租约和 24 小时结果，成功完成/审计与 Material 业务 batch 原子提交；每用户每分钟 60 次写尝试/20 个新 Key，admin 不豁免，测试可降低阈值。
- 审计：Material API 审计关系化记录物理请求、稳定操作、Key 摘要、对象和版本，在线保留目标为 1095 天；admin 完整查看、manager 只读查看，提供受控分页导出，`material_change_logs` 不随 API 或幂等清理删除。
- 业务边界：公共创建只允许 `MANUAL`，非 MANUAL 返回 `SOURCE_TYPE_NOT_ALLOWED`；V1 只提供单步最终审核，不实现页面、草稿编辑、多级会签、break-glass、导入、AI 或下游业务变更。
- 验证：build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；版本化迁移已有数据升级、约束、Down/重升通过；一次性 Miniflare 登录/CSRF/API smoke、凭证扫描、`git diff --check` 和本地临时 SQLite 基线通过。TypeScript 全量检查仍只有 `db/schema.ts` 两处既有自引用类型错误。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署、未修改生产配置。

## 2026-07-13

### PHASE1-TASK06 设计评审 - `docs: design material draft and review api`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成受认证授权 Draft/Review API V1 书面设计。
- 修改功能：无；未修改现有 Draft/Review/Validation Service、API、页面或 legacy 运行面。
- 数据库变化：无；只提出后续新增 `0002`、专用 `material_api_idempotency`、有界速率桶、关系化通用审计字段、列表/审计索引和隔离迁移测试，未创建 migration 或连接 D1。
- API 变化：无已实现路由；规格拟议创建、列表、详情、批准、驳回 5 个路由，明确现有会话认证、细粒度权限、Origin/CSRF、持久幂等、乐观锁和稳定错误映射。
- 文档变化：新增 `docs/material-master/draft-review-api-v1.md`；D-012 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险、下一步和验证状态。
- 待确认：审核角色、创建人自审、多节点审核边界、批准/驳回角色是否相同、幂等与审计保留期、写速率阈值及人工 API 来源范围。
- 验证：Site build、Node 52/52、lint（0 error/1 个既有 warning）、一次性 D1 API smoke、177 文件凭证检查通过；本地环境守卫 4/4、self-test、smoke、backup/restore、临时 SQLite go-live 检查通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK05 - `feat: add material draft and review service`

- Git Commit：规格、实现、测试和项目文档在本任务独立提交完成，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：新增 `material-master` 六模块，提供 `createDraft()`、`approveDraft()`、`rejectDraft()`、类型化属性持久化、正式编码格式和统一导出。
- 状态流转：创建固定写 `DRAFT` 且无正式编码；批准重新校验后以单一 D1 batch 原子写 `ACTIVE`、编码、批准信息、版本和审计；拒绝保持 `DRAFT`、递增版本并记录拒绝历史。
- 并发与安全：物料使用 `expected_version` 乐观锁，编码规则使用 version/sequence CAS 和唯一索引；创建/批准事务比较 metadata/属性守卫，校验后规则变化会冲突回滚；服务错误不返回 SQL 或底层 D1 异常。
- 数据库变化：无 schema 或 migration 变化；只使用现有 V2 表和约束，未写生产数据。审计业务动作映射为 `CREATE_DRAFT -> CREATE`、`APPROVE -> APPROVAL`、`REJECT -> REJECTION`、`CODE_GENERATE -> CODE_ASSIGNMENT`。
- API 变化：无；未修改路由、`erp-api.ts` 或页面。
- 文档变化：新增草稿/审核服务 V1 规格与实施结果；D-011 确认所有未来来源统一经过该服务及最终审核启用时生成正式编码；同步更新总控、任务和状态。
- 验证：新增 12 个隔离 D1 服务测试，覆盖校验阻断、提交前复核、并发审核、重复编码、防 TOCTOU 和故障回滚；完整 Node 52/52、build、lint（0 error/1 个既有 warning）、隔离 API smoke、176 文件凭证检查和差异检查通过；未连接生产 D1。

## 2026-07-12

### PHASE1-TASK04 - `feat: add material validation service`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `e239c35`。
- 新增功能：新增 Repository + Rules + Service 三层 `material-validation` 模块，提供创建前和审核前校验、D1/Memory Repository、25 个结构化 code 及稳定错误顺序。
- 修改功能：测试入口显式启用 Node TypeScript stripping，以兼容项目声明的 Node 22.13 最低版本；未修改现有业务行为。
- Bug 修复：无现有业务 Bug；实现期间补足绑定属性优先、未绑定属性随后输出的稳定排序。
- 数据库变化：无 schema、migration 或生产数据变化；D1 Repository 只读现有分类、绑定和属性定义 metadata，不缓存、不读取 seed。
- API 变化：无；未接入路由或现有 `erp-api.ts`。
- 文档变化：完成物料校验服务 V1 规格与实施结果；D-010 记录 D1 metadata 唯一运行时规则来源；同步更新项目状态。
- 验证：新增 28 个校验测试，完整 Node 40/40；lint、build、隔离 API 烟测、凭证检查和差异检查通过；未连接生产 D1。

### PHASE1-TASK03 - `feat: add material category and attribute templates`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `ebef667`。
- 新增功能：新增 `material-category-v1` TypeScript 声明数据和 test/local 专用 seed 执行器，输出分类、属性、绑定的插入/更新统计。
- 修改功能：无现有业务功能变化；不接入 AI、Excel、真实物料、BOM、采购、库存或生产。
- Bug 修复：无。
- 数据库变化：无 schema 或 migration 变化；seed 可向已迁移的隔离 D1 幂等写入 101 个分类、34 个属性定义和 228 条四级叶子显式绑定，使用本地 D1 原子 batch。
- API 变化：无。
- 文档变化：新增分类标准 V1 与设计规格；D-009 明确模板复制而非父子继承；同步更新项目状态文档。
- 验证：seed 声明、父子层级、关键必填模板、幂等、环境拒绝和原 migration 测试通过；未连接生产 D1。

### PHASE1-TASK02 - `feat: implement material master v2 schema`

- Git Commit：本任务独立提交，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无业务功能；新增 Material Master V2 数据契约与可回滚迁移框架。
- 修改功能：无；现有 API、页面、BOM、采购、库存和 legacy SQLite 不变。
- Bug 修复：无。
- 数据库变化：新增 12 张在线 D1 V2 表的 Drizzle schema、`0001` Up、Down、快照、约束与索引；正式编码仅允许审核后生命周期，供应商映射唯一身份包含 supplier/code/manufacturer/mpn/revision 与有效期。
- API 变化：无。
- 文档变化：更新设计基线和项目状态，新增 `docs/audits/phase1-task02-schema-report.md`。
- 验证：本机一次性 D1 完成空库 Up、防重、结构/约束、Down 和重建；完整基线结果见审计报告。未连接生产 D1。

## 2026-07-11

### PHASE1-TASK01 设计评审 - `docs: design material master v2 data model`

- Git Commit：设计评审独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无；当前只完成设计。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无；仅设计 11 张在线 D1 V2 关系表、约束、索引和 Up/Down 迁移顺序，未创建数据库对象。
- API 变化：无。
- 文档变化：新增 `docs/material-master/database-model-v2.md`，包含 ER 图、字段说明、`legacy_material_mapping`、来源追踪、迁移/回滚方案、测试矩阵、AI 接入边界和风险；记录在线 D1 唯一目标及动态属性决策。
- 验证：文档占位符、内部一致性、11/11 表级 `created_at` 覆盖和 `git diff --check` 通过；Site lint 0 错误/1 个既有警告、构建与 Node 测试 8/8、凭证检查通过；本地 ERP 自测、烟测和上线检查在一次性临时 SQLite 中通过且目录已清理。等待人工设计审批。

### PHASE0-TASK02 - `security: establish environment isolation baseline`

- Git Commit：本任务独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：统一 development/test/production 环境清单；本机一次性 Miniflare D1 烟测运行器；生产/公开 URL/非临时路径拒绝；凭证扫描；本地 SQLite 环境与备份恢复测试。
- 修改功能：仅修改开发与测试配置；Site 本地 Cloudflare 绑定关闭远程资源，烟测数据采用 `TEST-` 标识并自动销毁；本地数据目录支持环境覆盖以隔离测试。
- Bug 修复：本地烟测备份不再写入正式数据目录；在线写入型烟测不能再直接指向任意远程 URL。
- 数据库变化：无 schema 或迁移变化；未创建云端 D1，未连接或修改生产 D1。
- API 变化：无业务 API 新增、删除或行为修改；备份/恢复只在一次性测试数据库验证。
- 文档变化：新增测试环境说明、安全隔离审计和设计规格；更新 README、MASTER、TASKS、PROJECT_CONTEXT、ARCHITECTURE、DECISIONS、STATUS。
- 验证：Site lint、build、Node 测试、一次性 D1 API 烟测、凭证扫描及本地 ERP 自测/烟测/上线检查/备份恢复均通过。

### PHASE0-TASK01-B - `fix: convert site gitlink to tracked source`

- Git Commit：本任务独立合并提交；第一父提交为任务开始时根仓库 `a1a8d6a`，第二父提交为 Site 开发基线 `9f2c2dc`；完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：移除无 `.gitmodules`、无可用远端的 Site gitlink；把原 Site tree 的 77 个文件按普通文件纳入根仓库，使新克隆可恢复完整源码。
- 数据库变化：无；未修改 schema、迁移或生产 D1。
- API 变化：无。
- 文档变化：更新根 README、项目总控、状态、任务、架构、上下文和决策记录；新增 `docs/audits/phase0-task01-source-management-report.md`。
- 版本关系：生产 Site `2b4f178`；纳管前开发 Site `9f2c2dc`；两者运行时代码一致，且 `2b4f178` 是 `9f2c2dc` 的祖先。

### PM-000 - `docs: establish project operating system`

- Git Commit：本任务独立提交，完成后以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：新增 `docs/project/` 项目管理体系；更新 `AGENTS.md` 的文档驱动开发流程；纳入现有技术审计和物料 V2 准备文档作为上下文基线。

### `bbefb2e` - `feat: add chenyida erp site project files`

- 新增功能：根仓库记录在线 Site 项目入口。
- 修改功能：无本次重新审计的业务行为变化。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：无。
- 已知问题：该入口为无 `.gitmodules` 的 gitlink，新克隆不可恢复完整 Site 源码。

### `3e45f05` - `Document online ERP architecture`

- 新增功能：无。
- 修改功能：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：记录在线 ERP 架构。

## 历史基线

下列提交已存在于根仓库历史。本次只建立索引，不重新解释未审计的每一行变化：

| Commit | 提交消息 | 主要类别 |
| --- | --- | --- |
| `7654d45` | `Add quotation workflow` | 功能 |
| `42bdd8c` | `Add customer and supplier master data` | 功能 |
| `1255f6f` | `Add inventory count adjustments` | 功能 |
| `a58c20d` | `Add finance settlement module` | 功能 |
| `07562bc` | `Add go-live operations package` | 功能/运维 |
| `8d0138b` | `Add ERP login and operations controls` | 功能/安全 |
| `7748ade` | `Merge remote-tracking branch 'origin/main'` | Git 历史 |
| `f189de9` | `Initial ChenYida ERP system` | 初始系统 |
| `a4b63b3` | `Initial commit` | 初始化 |

## 记录模板

```text
### TASK-ID - `type: commit message`
- Git Commit：提交后以 git log 为准
- 新增功能：
- 修改功能：
- Bug 修复：
- 数据库变化：
- API 变化：
- 文档变化：
```
