# 晨亿达ERP项目上下文

> 新的 Codex 对话必须先阅读 `MASTER.md`，然后阅读本文件、`TASKS.md` 和当前任务文档。

## 项目介绍

晨亿达ERP面向 PCB、FPC、SMT 行业，目标是用统一内部编码贯通物料、产品、BOM、采购、库存、生产、销售、品质和财务。未来唯一生产方向是用户自有 Linux 服务器上的 Node.js/PostgreSQL/本地持久化文件/独立 Worker；AI 必须受审核、审计和数据权限约束。

## 系统组成

### 本地 ERP

- 路径：`chenyida_erp_app/`
- 技术：Python 3.11、标准库 HTTP Server、SQLite、原生 HTML/CSS/JavaScript；项目虚拟环境固定 `openpyxl`/`xlrd` 解析 XLSX/XLS。
- 入口：`server.py`；静态页面位于 `static/`。
- 用途：当前实际常驻的开发运行面、历史业务行为参考和旧数据迁移来源；不再作为未来生产底座。
- 数据：`chenyida_erp_app/data/erp.sqlite3`，运行数据被 Git 忽略。
- 实际状态：2026-07-27 systemd `chenyida-erp.service` 保持 active、PID `13737`、restart 0，继续监听 `0.0.0.0:18888`。起点已存在的 installed unit 与仓库源一致，当前 CPU/Memory/Task/NOFILE cgroup 限额实际生效；本任务未复制 unit、daemon-reload 或重启。仓库 Python 新源码默认限制 16 个活跃请求线程，但当前进程保持原运行代码，须未来获准重启后生效。这仍是开发服务，不代表正式生产投用，停用必须另立任务。

### 自托管 Node 应用

- 路径：`chenyida_erp_site/`
- 技术：Vinext、React、TypeScript、标准 Node.js、PostgreSQL/Drizzle、本地持久化文件和 PostgreSQL 后台任务 Worker。
- 页面：TASK10 已把根 `app/page.tsx` 改为原生经营工作台；legacy `public/erp/index.html` 保留为显式业务工作区和回滚入口，不再作为根 iframe 默认依赖。Material Master 和 Import Workspace 使用 `app/materials/` 原生 Vinext 路由。
- API：`app/api/[...path]/route.ts` 转交给不依赖平台 binding 的 `app/lib/selfhost-api.ts`；旧 `erp-api.ts` 仅作迁移参考。
- 根页迁移：TASK03—TASK10 已接通主数据/BOM/库存/采购/生产/销售/品质/财务、实时 Dashboard 与离线 backup 治理，根页已退出 iframe。完整 ERP API 的非生产实现不等于实际业务迁移：真实数据、账号和文件未迁移，采购、库存、生产、销售、品质、财务的实际业务仍依赖 Python/SQLite；生产恢复演练未做，不能描述为已投产。
- 部署能力：`compose.yml` 可启动 Web、Worker、PostgreSQL，Caddy production profile 提供 HTTPS。`chenyida-erp-parallel` 的 PostgreSQL/Web/Worker/Caddy 已实际应用 CPU/Memory/Swap/PID 限额；Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口，Caddy 在公网 18888 终止可信 TLS。当前入口为 `https://43.135.148.43.nip.io:18888`；运行面是受控非生产 alpha.38/0037，不代表正式投产、真实公司数据迁移或生产批准。历史 Sites `v3` 不作为后续交付目标。

- 历史公网验证地址仅作记录；PHASE0-TASK03 未访问公网地址，长期公网运行仍需 HTTPS 和访问控制。
- 开发常驻服务：systemd `chenyida-erp.service`，服务定义源码位于 `deployment/chenyida-erp.service`。
- 源码管理：`PHASE0-TASK01-B` 已将原 gitlink 转为根仓库直接跟踪的普通目录；新克隆可恢复完整源码。生产提交为 `2b4f178`，纳管前开发提交为 `9f2c2dc`。
- 发布标识：包名为 `chenyida-erp-selfhosted`；源码与受控公网并行 UAT Web 均为 `0.1.0-alpha.38`，PostgreSQL 为 37/head `0037_project_planning_revision_response_lineage.sql`。alpha.38 是并行非生产 UAT 部署记录，不是生产 release。
- 原始发布基线：PHASE0-TASK03 于 `39946f6` 上定义 `0.1.0-alpha.1` / PostgreSQL `0001`—`0005`，并由 `12d3ea3` 提交。该历史定义不改写；当前源码包已演进到 `alpha.38`。
- Git 复核：FIX-08 从 clean `main@a254bca5d59dd3f17047c9d6495dfdf2df1a798e`、Parent `91c0fd29d534246c55ddd669e894cdde9b774e52`、behind 0/ahead 109 起步；功能提交为 `682e79378660ef7859617655836f02e2112df244`，安全停止/运维文档由独立 `ops: record blocked planning traceability rollout` 提交收口。未 push/PR/amend/rebase/reset/stash/restore，既有提交未改写；未读取、修改或提交 `shujvbiao/`。
- 身份收口 Git 复核：CREDENTIAL-RECONCILIATION-10 从 clean `main@a4eff293668e24f4f780eb5df840bfc7e510365e`、Parent `615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、behind 0/ahead 112 起步；结构预检 fail closed 后只允许无秘密报告提交。未 push/PR/amend/rebase/reset/stash/restore，未读取、修改或提交 `shujvbiao/`。
- 离线身份恢复 Git 复核：OFFLINE-IDENTITY-RECOVERY-11 从 clean `main@753c68c84427de93536a1f282b6e80987f7c9466`、behind 0/ahead 113 起步；工具/测试提交为 `a48dcc8a290b96da1ea6e426aaa2c6d73416c2fc`，完成记录由独立 `ops: complete canonical credential recovery` 提交收口。未 push/PR 或改写历史，未读取/修改 `shujvbiao/`，秘密和数据库/备份正文未进入 Git。
- Revision Response Git 复核：REVISION-RESPONSE-13 从 clean `main@174181991c0bf51ee397627ea8fce546d1b64e68`、Parent `180f6b58b583bd2dba350f017504be916db9673d`、behind 0/ahead 117 起步；功能提交为 `58e011db0c8d9045c3919c36c2c64f1655f050b6`，部署证据和文档由独立 `ops: deploy planning revision workflow` 提交收口。未 push/PR/amend/rebase/reset/stash/restore，未读取/修改 `shujvbiao/`，秘密、数据库和备份正文未进入 Git。
- Purchase Confirmation FIX-17 Git 复核：从 clean `main@af7496babe8b704d04b22ad33bbb98a270519529`、Parent `ce3f14a0c989875e7527e42136967f9efe6ee548`、behind 0/ahead 125 起步；功能提交为 `13da8a14d037d279278ef8c8ea86e52d79552512`，保护 runner、部署/UAT 事实和完成报告由独立 `ops: accept purchase confirmation fix` 收口。未 push/PR/amend/rebase/reset/stash/restore，未读取/修改 `shujvbiao/`，秘密、数据库和备份正文未进入 Git。
- Purchase History FIX-18 Git 复核：从 clean `main@eff3df28e1781f13dc5a529f13e83e621bda5a28`、Parent `13da8a14d037d279278ef8c8ea86e52d79552512`、behind 0/ahead 127 起步；功能提交为 `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`，保护/UAT runner、D-090、部署事实和完成报告由独立 `ops: accept purchase history traceability` 收口。未 push/PR/amend/rebase/reset/stash/restore，未读取/修改 `shujvbiao/`，秘密、数据库和备份正文未进入 Git。
- RFQ Binding FIX-19 Git 复核：从 clean `main@5a7cb547a07b1e113d89c51366fc099d851fe1cb`、Parent `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`、behind 0/ahead 129 起步；功能提交为 `23d654c383015864be9a2ade71e78d94eb77adaf`，保护/UAT runner、部署事实和完成报告由独立 `ops: accept rfq draft binding fix` 收口。未 push/PR/amend/rebase/reset/stash/restore，未读取/修改 `shujvbiao/`，秘密、数据库和备份正文未进入 Git。
- alpha.34 灾备：LANDING-TASK01 从 `82e9f07ce1666ace2677853408c7fb4339808cfc`/ahead 76 的 clean main 出发，在 `/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z` 建立 root-only 完整包；Git Bundle、clean-0034 custom dump、三个文件卷及恢复清单均实际恢复验证。包内 PostgreSQL dump 含身份哈希和 Session 数据，必须按秘密材料处理；尚未异机复制，Git origin 仍未 push。
- 真实 BOM 入库：LANDING-TASK02 对用户指定的 8 个本机只读表格完成强校验、离线确定性分类、clean-0034 staging、主库幂等写入和 post-import 恢复；13 Sheet/1,113 条中 ELIGIBLE 515、NEEDS_REVIEW 438、ARCHIVE_ONLY 160，形成 532 Material、6 Product/Version、6 DRAFT BOM/Version、316 行和 1,318 来源链接。交易事实保持 0，详细正文只存仓库外 root-only 目录。
- 离线内部物料库：LANDING-TASK06 以 `moban.xlsx` 第一张 `原BOM` 只作对照、第二张 `Sheet1` 作为唯一 13 列标准；复用 LANDING-TASK02 root-only 证据生成 724 行内部物料库、997 行标准明细、484 行待确认和 1,006 行来源映射。532 个正式编码只沿用既有结果；147 个来源候选、45 个模板候选不配码，另保留 1 个来源版本冲突。结果为 root-only 工作簿，未导入任何数据库。
- 逐表标准化交付：LANDING-TASK07 进一步按项目负责人澄清，把 `moban.xlsx` 第一张作为真实原始数据、第二张作为整理目标，验证 53/53 行组规格证据和用量后逐来源整理。结果含 591 行总表、8 张来源标准页、591 行追溯和 94 条异常；57 行未知用量、21 行未知板型留空，A118 精确重复区段只计一次，A200 同逻辑旧版按模板优先。未导入任何数据库。
- 大批量跨对话流程：LANDING-TASK08 固定 `CYD-MATERIAL-13C-v1`、`CYD-MATERIAL-NORMALIZATION-v1`、`CYD-MAT-YYYYMMDD-NNN/Rxxx` 和默认 10 文件/5,000 行/100 MiB 上限；私有总索引、批次卡、来源 manifest 与 `checkpoint.next_action` 是恢复权威。已知结构按版本化来源档案复用，未知结构先确认；Codex 不能自行批准批次，临时汇总不得入库。通用执行器和代表性试点尚未实现。
- V9 重导入 staging：LANDING-TASK05 对单个 SHA 绑定 XLSX 解析 197 行；编码唯一连续、来源完整，但显式单位 0，产品/BOM 结构字段 0。恢复库首次 staged 197、重放新增 0，全部 review；5,556 条拟删除计划未执行，主库 213 表计数完全不变。
- 第二管理员与 UAT 账号：`admin2` 的既有 active/version/must-change 历史事实不变。ROLE-CREDENTIAL-ROTATION-09 和 CREDENTIAL-RECONCILIATION-10 的历史 PARTIAL/BLOCKED 事实保留；后续 OFFLINE-IDENTITY-RECOVERY-11 已按方案 B 对 admin 与固定十个 UAT 账号完成单事务恢复、目标既有 Session 撤销、11 条恢复审计、Canonical 激活和 1+10 身份页验证。目标账号角色/active 保持，最终有效且未撤销 Session 均为 0；旧 candidate 与 Stage 已按成功规则删除。仓库不记录凭据值、摘要、Token、Cookie 或 Session 信息。
- 单账号豁免：SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 采用 serializable 事务、任务 advisory lock、行锁和 version 2 CAS，把账号更新与唯一 `USER_FIRST_PASSWORD_CHANGE_WAIVED/success` 审计同事务提交；同任务重放 no-op。现有有效 Session 保留，D-045 全局新建/重置用户强制首次改密策略与 API 不变。
- 公网与 UAT 来源校验：公网继续由显式、规范化、单值 `ERP_PUBLIC_ORIGIN` 精确限制，不读取任意转发头；当前唯一公网值为 `https://43.135.148.43.nip.io:18888`。只有 `ERP_DEPLOYMENT_CLASS=uat` 与 `ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true` 同时启用时才额外允许浏览器 Origin 与 Request URL origin 均为严格字面量 loopback；生产类别不能启用。身份和全部业务写均要求 Origin 和 Cookie/Header CSRF 双提交。当前 alpha.38 Web 为 `sha256:6622029fb3c401d1b71f10047e53021147bb386cf3dedb3208d1dfba6c7636d0`；FIX-19 部署前 `sha256:6eeba6409f51605fe422c39d674ddfa03d5f5079bb546566288336f15296df64` 保留精确回退 tag `chenyida-erp-parallel-web:rollback-rfq-binding-fix19-predeploy-20260804T042812Z`。PostgreSQL/Worker/Caddy 未因 FIX-19 替换或重建。
- 公网 IP 切换：PUBLIC-IP-CUTOVER-07 同步更新 Caddy `ERP_DOMAIN` 和 Web `ERP_PUBLIC_ORIGIN`，以原镜像串行重建 Web/Caddy并取得 `43.135.148.43.nip.io` 的 Let's Encrypt 证书；外部 18888 登录页、200/308/401、安全头和旧 SNI 退役通过。PostgreSQL/Worker 容器未更换，root-only 原 env 回退副本保留。
- 安全退出：经营工作台与兼容工作台统一调用共享 `POST /api/logout`，发送 same-origin credentials 和 CSRF Header；服务端撤销 Session、写成功审计并对称清 Cookie 后才跳转，失败显示稳定错误码/中文提示。受保护页面在 `pagehide` 先隐藏，`pageshow.persisted` 或 `back_forward` 必须重新校验 Session；根页、Material 和 legacy 响应均为 `private, no-store`。真实 Chromium 已证明两个入口 logout 后 back/forward/refresh 均保持登录页和受保护内容不可见。
- operations 人工物料审核：角色静态映射只新增 `material.review.queue/approve/reject`；没有 `material.draft.edit_any`、身份/admin、`system.audit.read` 或其他业务写增量。Repository 的跨创建人可见性只对 PENDING_REVIEW+queue 开放，批准/退回继续由既有职责分离、幂等、CAS、事务和审计保护。详情原样显示待审名称、分类/单位/来源、创建/提交事实、版本/状态、现有 SUBMIT 工程说明、编码状态、审核范围、后果与工程 BOM 下一步；说明为空时明确“未保存”，不伪造外部编号、供应商或价格。Dashboard 可处理数精确取 PENDING_REVIEW，legacy 全局统计仍标注 DRAFT+PENDING_REVIEW。
- operations UAT 只读证据：真实 Chromium 只登录 `uat_20260729_operations`，Dashboard 与搜索 `042576` 队列均为 4，打开 533—536 四条详情，决策上下文可见且正文编辑控件 0；批准/退回 POST 为 0。两套工作台退出和历史恢复通过，最终 operations 有效 Session 0。该任务验收时四条仍为 PENDING_REVIEW/version 2/MANUAL/PCS/空编码；PUBLIC-IP-CUTOVER-07 预检确认它们后来已在本任务前成为 ACTIVE/version 3/有编码，此后事实不得反向改写旧 UAT 记录。
- BOM code-first 与发布合同：`GET /api/bom-material-candidates` 只返回 ACTIVE、正式编码非空、enabled 主单位可解析的 Material，DTO 为 material_id/internal_code/name/unit_id/unit/status/version，最多 20 条；精确编码只返回对应物料，否则支持编码前缀与名称。UI 只以 material_id/unit_id 作为提交引用。保存和发布事务均重新锁定并验证正式编码、ACTIVE、Unit enabled 和主单位，同一 BOM Version 不得重复物料。Product Version、BOM Version 与 Planning 使用同一关系模型；BOM 属于 Product Version，Project 在 Planning Handoff 才关联，Planning 只接收 RELEASED 组合。
- Planning CSRF 共享客户端：此前 Planning 页面虽传入 `protectedWrite`，但共享路由分类未匹配 requirement resolution、planning package 及 submit/accept/return 等端点，请求落入普通 POST 分支并丢失 `X-CSRF-Token` 和调用方幂等键。现由共享 `sessionPost` 在发送时读当前 `CYD_ERP_CSRF` Cookie，以当前 Token+method/path+canonical 正文绑定页内幂等键；Session/页历史/认证变化清空上下文。服务端 Origin/CSRF/Session/权限/审计未放宽，错误仍显示稳定中文代码和 request_id。
- RELEASED BOM 与最小披露：BOM 管理页首次进入固定为“请选择或搜索 BOM”，只有明确搜索并选择后才请求 `/api/bom-lines`；有界搜索支持 BOM 编码、产品编码和产品名称。RELEASED 详情只显示已发布事实和“已发布，只读；如需修改请创建新版本”，不渲染 Material/数量/损耗/行号编辑器及新增/删除/保存/发布动作。服务端对 RELEASED 行 POST/PATCH/DELETE 统一返回 `409 BOM_RELEASED_IMMUTABLE`，与既有 DB trigger 共同 fail closed。
- FIX-05 主库只读证据：真实 Chromium 路由层阻断除 login/logout 外全部 POST；首次 BOM 明细请求 0，选择 `BOM-UAT-BB-PROD-042576-V1` 的 UI 动作只加载该明细 1 次，验收脚本另用一次只读 GET 核对精确四行；RELEASED 可变控件 0，四行为 533—536/1 PCS/0，390px 无溢出。engineering Planning 页只读识别 A0/V1，未登录 planning、未点击保存/生成/提交；退出后 back/forward/refresh 均为匿名。
- 当前数据库只读基线：37/head 0037。`PRJ-00000001` 的 Package ID 1/v1 为 `RETURNED`、row version 3、完整摘要 `9d7a6a7ec9aefbaf21be5dcb5eb3a556a47c6ef00c96f111f3be0476ade3a241`；CREATE/SUBMIT/RETURN/ACCEPT 为 `1/1/1/0`，Revision Response/Head/v2 为 `0/0/0`。唯一 RETURN Event ID 2 属于 v1；Package 原因与 Event 原因逐字一致且历史不可改写。Package Item 固定 Product/Version 7/7 A0/RELEASED、BOM Header/Version 7/7 V1/RELEASED、Unit Resolution ID 1/v1，Material 533—536 毛需求各 10 PCS。跨 0037 业务保护指纹前后均为 `a25be9c924bb2e7af54acd36c1c5f758e0caf0b2f4d8ccf426bf428aee41d739`。
- 当前采购接收只读基线：Package ID 2/v2、Material Requirement Plan ID 1/v1 和 PRQ ID 1 / `PRQ-00000001` 均为 `ACCEPTED`；Plan 属于 D-090 分支 A 的采购交接状态，v1 计算快照、行、分配和来源摘要没有改写。Purchase ACCEPT/RETURN `1/0`、待接收/已处理 `0/1`；权威 `PURCHASE_ACCEPTED` actor `uat_20260729_purchase`、时间 `2026/08/04 06:06:15 Asia/Shanghai`、request_id `80568b28-47f5-4f58-8901-afc053871998`，已提交 Event 精确投影为 SUCCESS。Material 533—536 各为毛需求/净采购/PRQ `10/10/10 PCS`、四项快照供应 0，九项当前供应也全部 0；Inventory Balance/Planning Allocation 与 RFQ/Quote/Award/PO/Delivery Plan/Receipt/Ledger/AP/Work Order 为 0。FIX-18 正式保护指纹在部署前、第二空库、UAT 前后均为 `814811509c476e270f9cd82badb85aa8bb1bf8e1f01e8bb72b4cd9fec9c9a4ff`；主 UAT 只读验收 business POST 0、非目标 GET 0、最终 Session 0。
- 当前 RFQ 稳定 ID 基线：PostgreSQL `bigint` ID 在页面 DTO 中可能为十进制字符串；RFQ 页面不得以 `row.id === Number(formValue)` 反查对象。Purchase Request 与 Supplier option value 只使用稳定数据库 ID，UI 请求边界一次规范为 safe positive integer；Supplier 去重排序。Handler/Service 对同一四字段 DTO 再规范，并只以规范后的 PR ID、Supplier IDs、日期和 expected_version 计算幂等摘要；不按 PRQ/项目/供应商标签反查。主 PR ID 1 当前 version 2，Supplier ID 1/2 为 ACTIVE；主 UAT 只核验未提交 DTO 候选 `[1,[1,2],"2026-08-31",2]`，业务 POST 0。FIX-19 正式保护指纹在主库、恢复库、部署/UAT 前后均为 `fc48f001fe3b0afaff69ac245a1fefc8bf6731d38358004314cc12daa308cff4`，RFQ/Quote/Award 及全部下游仍为 0。
- Planning Revision Response 边界：0037 已部署关系化 append-only Response Version、每 RETURN Event 独立 CAS Head 和 Package previous/RETURN/Response 固定外键；新 v2 只能复制源 Package 的 Product/BOM/Unit Resolution/Material/Document Snapshot，并把精确 Response Version/正文摘要纳入 Package 摘要。既有 v1 和 RETURN 原因未回填或改写；本任务主 UAT 只读核验未填写回复、生成/提交 v2或登录 planning。
- Planning Unit Resolution 边界：0036 已新增追加式 `project_requirement_unit_resolution_versions` 和每 Requirement Item 独立 CAS `project_requirement_unit_resolution_heads`；源 Requirement Item 仍由 0015 trigger 保持不可变。新 Package Item 必须引用生成时精确 Unit Resolution Version，不从源 NULL 或 BOM Line 猜单位；`REQUIREMENT_DECLARED` 只表示迁移可直接证明的原始单位，`ENGINEERING_CONFIRMED` 只表示正式获权 API 确认。
- Planning 审核追溯边界：FIX-08 详情读取在同一 `REPEATABLE READ READ ONLY` 事务中先执行 `planning.read` 与 Package 对象范围授权，再从 Package Snapshot、该 Package 的 Event、精确匹配的创建审计和 Package Item 固定 Resolution Version 投影。Product/BOM 的创建服务门禁证据与当前状态分栏；不得称为生成时状态快照。planning 未获得 `system.audit.read`，不能查看其他 Package 或系统审计。
- 兼容供应商导入：LANDING-TASK04 功能提交 `cda8c7e` 已在单独授权下部署到当前 18888 Web；`public/erp/` 的 CSV-only/退役入口已改为直达 `/materials/imports/new`，入口 URL 已版本化。公网 HTML/JS SHA 与源码一致；MATERIAL-REVIEW-BLOCKERS-03-RETRY 已把 legacy 壳改为动态只读路由，使响应只保留 `private, no-store` 和 `Pragma: no-cache`，不再并列 `public, max-age=3600`。未做 Excel→PG E2E。
- BOM 物料治理：PHASE6-TASK01 在既有 Import/Mapping/Normalization/Review 后新增确定性规格治理层，用品类+关键规格+性能等级的完整身份进行严格归组，保留原始行/BOM/料号透明度，替代项只是候选。受控决策可精确绑定 ACTIVE 或调用既有 Workflow 建 DRAFT；不自动编码、审批或建正式替代关系。

### 低资源主机事实

- 本机永久按 2 核、约 4 GiB 内存、1 GiB Swap 管理。2026-07-27 曾发生服务器重启或不可用，证据不足，根因记录为 `UNKNOWN`，不得无证据归因 OOM。
- 所有 build、全量测试、Migration、备份恢复和 Compose 重启必须串行，固定 `COMPOSE_PARALLEL_LIMIT=1`；停止阈值、禁用清理命令和验证记录见 `docs/self-hosting/low-resource-server.md`。
- FIX-18 的 Node/PG/Chromium、Docker build、备份恢复和 Web 替换全部串行，一次一个临时重任务。起点约 2.2 GiB available/309 MiB Swap/21 GiB/Load `0.15/0.14/0.08`，最终约 2.1 GiB/257 MiB/21 GiB/`0.16/0.33/0.34`；内核 OOM 0、四服务 RestartCount 0/OOM false。隔离/恢复数据库、临时容器/网络、Playwright/Python/SQLite 与忽略构建目录均清零，未 prune，正式备份、当前/候选/回退镜像和四卷保留。
- FIX-17 的 Node/PG/Chromium、Docker build、备份恢复与 Web 替换全部串行，一次一个临时重任务资源。起点约 2.1 GiB available/302 MiB Swap/21 GiB/Load `0.18/0.48/0.42`，最终约 2.2 GiB/304 MiB/21 GiB/`0.24/0.32/0.27`；内核 OOM 0、四服务 restart 0/OOM false。临时数据库、容器、网络、Playwright/Python/SQLite 路径清零，未 prune，正式备份、镜像和四卷保留。
- PUBLIC-IP-CUTOVER-07 不 build/pull/Migration，只串行重建 Web/Caddy并运行断网只读测试容器。起点约 2.1 GiB available/193 MiB Swap/29 GiB/Load `0.24/0.28/0.17`，最终 `2,474,940 KiB`/`204,964 KiB`/30 GiB/`0.02/0.29/0.28`；60 秒 Swap `192,596→192,592 KiB`，内核 OOM 0、四服务 restart 0/OOM false，1103 仓库文件凭据扫描通过，任务容器已自动删除，四卷保持。
- TASK10 起点 available memory 约 2.4 GiB、Swap 135 MiB、根分区可用 36 GiB、Build Cache 0B；构建峰值 2.569 GB 后一次授权 prune 回到 0B。最终 available 2.3 GiB、Swap 139 MiB、根分区可用 36 GiB、Load `0.03/0.11/0.21`；60 秒窗口 Swap `142452→142372 KiB`、增长 -80 KiB，三个容器 restart 0/OOM false，四个持久卷未更换或删除。
- LANDING-TASK01 不执行 build；所有 Git、dump、恢复和测试串行。起点 65 秒 Swap `137476→137476 KiB`、增长 0，Build Cache 全程 0B；三容器 restart 0/OOM false，四卷、resource-guard、Python PID 和 SQLite metadata 保持。
- LANDING-TASK04 部署严格串行 build/recreate Web；起点 available 2.1 GiB、Swap 114 MiB、根盘 36 GiB，最终 available 2.2 GiB、Swap 123 MiB、根盘 35 GiB。build 后 60 秒 Swap +100 KiB，部署后 60 秒 -24 KiB；容器 restart 0/OOM false、内核 OOM 记录 0。Build Cache 1.401 GB 保留，未执行未授权 prune。
- PHASE6-TASK01 的 PostgreSQL 测试、迁移和 Node 重任务串行，任一时刻只有一个临时容器，Node heap 512 MiB/容器 768 MiB。起点 available 约 2.1 GiB、Swap 131—132 MiB、根盘 35 GiB；最终 available 2.2 GiB、Swap 135 MiB、根盘 35 GiB、Load `0.21/0.76/0.69`，四服务 restart 0/OOM false。两个任务测试库和临时容器已删除，四个受保护卷保留。
- IMPLEMENT-07 的 build、Migration、隔离 PostgreSQL、dump/restore、Web 更新和两个 Chromium 验收均严格串行，一次最多一个临时重任务容器。起点约 2.2 GiB available/233 MiB Swap/26 GiB/Load `0.24/1.05/0.88`；最终精确清理后为 2.3 GiB/210 MiB/26 GiB/`0.30/0.30/0.40`。四服务 restart 0/OOM false、任务 OOM 0；临时库/容器/build worktree/runner/在线隔离 dump/Playwright 镜像已清理，正式备份、当前/回退 Web 镜像和四个受保护卷保留。
- FIX-08 的测试、build、备份恢复、Web 更新和隔离 Chromium 严格串行，一次最多一个临时重任务容器。检查范围约为 2.1—2.3 GiB available、196—224 MiB Swap、根盘最低 21 GiB、Load 低于停止阈值；最终为 2.2 GiB/214 MiB/22 GiB/`0.17/0.54/0.74`。四服务 restart 0/OOM false；隔离库、恢复库、runner/builder/Playwright 基础镜像和精确临时目录已清理，正式备份、当前/回退 Web 和四卷保留。
- ROLE-CREDENTIAL-ROTATION-09 只运行一个受限 Chromium 实例和顺序 Context，不执行 build、Migration、PostgreSQL 测试或 Compose 重建。起点约 2.3 GiB available/218 MiB Swap/22 GiB/Load `0.44/0.31/0.21`，最终约 2.3 GiB/218 MiB/22 GiB/`0.13/0.18/0.20`；内核 OOM 0、四服务 restart 0/OOM false。临时容器/profile/cache/依赖/控制目录已清理，四卷保持；root-only 恢复候选因 PARTIAL 规则保留。
- CREDENTIAL-RECONCILIATION-10 没有启动 Chromium 或发送 API。起点约 2.2 GiB available/218 MiB Swap/22 GiB/Load `0.19/0.14/0.10`，最终约 2.2 GiB/217 MiB/22 GiB/`0.40/0.23/0.20`；内核 OOM 0、四服务 restart 0/OOM false。临时容器自动删除；控制脚本、临时依赖/cache 和精确 `/run` 目录清理，既有 UAT 恢复候选和四卷保持；按保护规则未删除镜像。
- OFFLINE-IDENTITY-RECOVERY-11 的测试、备份/恢复、停服事务、隔离/正式 Chromium 和最终化全部串行，一次最多一个临时重型资源。正式前约 2.1 GiB available/227 MiB Swap/21 GiB/Load `0.06/0.26/0.34`，最终约 2.2 GiB/218 MiB/20 GiB/`0.11/0.41/0.41`；未触发停止阈值，内核 OOM 0、四服务 restart 0/OOM false。隔离库、容器/网络、Playwright 运行材料、测试 Stage 和临时 SQLite 已清理；正式备份、Canonical、完成标记、无秘密浏览器证据和四个受保护 Volume 保留，未 prune。
- REVISION-RESPONSE-13 的 Migration、PostgreSQL/Chromium、build、备份恢复、Web 更新和主 UAT 只读核验全部串行，一次最多一个临时容器。起点约 2.1 GiB available/227 MiB Swap/22 GiB/低 Load，最终 2.1 GiB/240 MiB/22 GiB/Load `0.04/0.16/0.27`；内核 OOM 0、四服务 restart 0/OOM false。任务临时数据库、容器、app 提取、Playwright 和 Python 目录均清零，正式备份、当前/候选/回滚 Web 和四卷保留，未 prune。
- LANDING-TASK05 的 dump、恢复、staging 和测试严格串行；起点 available `2,351,184 KiB`、Swap `130,592 KiB`、Load `0.06/0.09/0.11`、根盘 35 GiB，提交后约 2.2 GiB/126 MiB/`0.08/0.14/0.14`/35 GiB；独立 60 秒 Swap 增长 0。四服务 restart 0/OOM false，临时库/runner/cache 删除，四个受保护卷保留。
- MATERIAL-REVIEW-BLOCKERS-03-RETRY 的隔离 PostgreSQL、build、备份恢复、Web 替换和真实 Chromium 严格串行；起点约 2.4 GiB available/163 MiB Swap/31 GiB 根盘，最终约 2.3 GiB/187 MiB/30 GiB/Load `0.21/0.45/0.68`。内核 OOM 0，四服务 restart 0/OOM false；只重建 Web，测试/恢复库、容器、浏览器和 worktree 已清理，四卷保持。
- BOM-SELECTOR-FIX-04 的隔离 PostgreSQL、alpha.34 build、备份恢复、Web 替换和 Chromium 严格串行；首次门禁约 2.3 GiB available/198 MiB Swap/29 GiB，部署前 2.3 GiB/180 MiB/29 GiB/Load `0.09/0.44/0.48`，浏览器后 2.3 GiB/204 MiB，最终根盘恢复 29 GiB。内核/容器 OOM 0、四服务 restart 0；测试/恢复库、临时容器、浏览器、Playwright 镜像、task worktree 和可归属 BuildKit cache 已清理，备份/当前镜像/回退 tag 和四卷保留。
- PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 的 Node/PostgreSQL 测试、alpha.34 build、备份恢复、隔离真实 Chromium、Web 替换与主库只读 Chromium 严格串行，任一时刻最多一个临时重型容器。起点约 2.2 GiB available/196—197 MiB Swap/29 GiB；最终扫描及清理后 2.3 GiB/223 MiB/28 GiB/Load `0.12/0.14/0.17`，Swap 未在 60 秒增长 256 MiB，内核 OOM 0，四服务 restart 0/OOM false。测试/恢复库、临时容器、浏览器、Playwright 镜像、兼容 worktree/candidate tag 已清理；当前/回退 Web 镜像、备份和四卷保留，未 prune。
- ADMIN-ACCOUNT-04 不执行 build/restart/deploy；身份写入和测试串行。起点 available 2.3 GiB、Swap 126 MiB、根盘 35 GiB、Load `0.05/0.12/0.14`，最终 2.3 GiB/126 MiB/35 GiB/`0.10/0.14/0.13`；四服务 restart 0/OOM false、内核 OOM 0。所有账号、语法与测试 runner 及 root-only 临时目录均已删除，四个受保护卷保留。
- TRUSTED-ORIGIN-05 的单元、隔离 PostgreSQL、两次镜像 build 和 Web 更新全部串行；起点 available 约 2.3 GiB、Swap 126—127 MiB、根盘 35 GiB、Load 低于 0.3，最终约 2.2 GiB/142 MiB/34 GiB/Load `1.08/0.48/0.29`。四服务 restart 0/OOM false，内核无 OOM；只重建 Web，PostgreSQL/Worker/Caddy 容器 ID 不变。临时数据库、runner、候选镜像和 worktree 已清理，四个受保护卷保留；2.789 GB Build Cache 未执行未授权 prune。
- ADMIN2-FIRST-CHANGE-WAIVER-06 只有一次轻量 PostgreSQL 事务和一个断网 Identity unit runner；起点/最终 available 均约 2.3 GiB、Swap 142 MiB、根盘 34 GiB，最终 Load `0.08/0.16/0.12`。四服务未重建、restart 0/OOM false、内核 OOM 0；task SQL/runner 已清理，四个受保护卷保留。
- UAT-BLOCKER-FIX 的 unit/UI、隔离 PostgreSQL、两次 alpha.34 API smoke、build、备份恢复、Web 更新和 Chromium 验收全部串行；起点 available 约 2.4 GiB、Swap 124 KiB、根盘 34 GiB，最终约 2.3 GiB/3.2 MiB/34 GiB、Load `0.01/0.21/0.30`，60 秒 Swap 增长 0。四服务 restart 0/OOM false、内核 OOM 0；只重建 Web，PostgreSQL/Worker/Caddy 和四卷保持，临时数据库、容器、runner 与 build worktree 已清理。
- LANDING-TASK06 只执行轻量离线 Excel/CSV/JSON 处理及串行测试；Node 检查使用一次一个、断网、只读、1 CPU/1 GiB 的自动删除容器。起点/最终 available 均约 2.4 GiB、Swap 47 MiB、根盘 33 GiB，最终 Load `0.79/0.67/0.50`；四服务 restart 0/OOM false、内核 OOM 0。探查进程、测试容器和临时 SQLite 目录均已清理，四卷保持。
- LANDING-TASK07 只执行轻量离线 XLS/XLSX 解析、工作簿生成和串行测试；Node 检查同样限制为一次一个、断网、只读、1 CPU/1 GiB 的自动删除容器。起点约 2.4 GiB available、Swap 47 MiB、根盘 33 GiB、Load `0.36/0.24/0.17`；最终约 2.3 GiB/47 MiB/33 GiB/`0.34/0.69/0.56`。四服务未重建且 restart 0/OOM false，任务时段内核 OOM 0，四卷保持。
- OPS-UAT-MATERIAL-REVIEW-FIX-02 的 PostgreSQL 测试、build、备份恢复、candidate smoke、Web 替换和 Chromium 验收严格串行，一次仅一个临时容器。起点约 2.3 GiB available、Swap 47 MiB、根盘 33 GiB；最终 2,307,512 KiB available、66,456 KiB Swap used、根盘 31 GiB、Load `0.16/0.42/0.47`，112 秒 Swap 增长 0，未触发门禁。四服务 restart 0/OOM false、任务时段内核 OOM 0；只替换 Web，临时数据库/容器/worktree/runner 清理，备份和明确回滚镜像保留，四卷 metadata 不变。
- LANDING-TASK08 只编写大批量物料分批 SOP、三份无业务数据 JSON 示例和治理文档；不读取 `shujvbiao/`，不运行 build、数据库测试、Migration 或部署。检查时约 2.1 GiB available、Swap 98 MiB、根盘 31 GiB、Load `0.06/0.11/0.15`；最终约 2.0 GiB/98 MiB/31 GiB/`0.04/0.11/0.15`。Python 临时 SQLite 和 Node 只读测试容器已清理，四服务 restart 0/OOM false，四卷保持。

### 治理资料

- `物料主数据治理落地包/`：编码、字段、导入、审核 SOP、模板和清洗辅助工具。
- `docs/audits/current-system-audit.md`：当前系统技术审计。
- `docs/material-master/`：物料主数据中心 V2 计划和待确认决策。
- `docs/project/`：本项目长期运行的权威上下文和任务台账。

## 数据库

### 本地 SQLite

- 29 张业务/迁移表；历史 26 张表仍由 `server.py` 建立，Excel 导入新增表从 `0001_material_import_source_lineage.sql` 起使用版本化迁移，当前已应用到 `0004_cleaning_general_spec_tokens.sql`。
- 覆盖用户、会话、物料、映射、清洗、客户、供应商、产品、BOM、采购、库存、生产、销售、品质、财务和活动日志。
- 已增加 `local_schema_migrations`、`material_import_batches`、`material_import_raw_rows` 及来源外键/索引；`0002` 为批次增加完整原文件归档 key、大小和 warning。历史表的迁移基线与外键治理仍待逐步补齐。

### PostgreSQL 自托管基线

- `drizzle-postgres/0001_selfhost_baseline.sql` 新建 46 表：现有 45 张业务/治理结构和 `background_jobs`；使用 bigint/UUID/timestamptz/boolean/JSONB/numeric、外键、唯一约束和索引。
- `drizzle-postgres/0002_material_master_workflow.sql` 增加按分类编码序列、审核队列/事件历史索引及草稿/ACTIVE编码一致性约束；Material Draft/Review/Active 已通过独立 Repository/Service/API 使用 PostgreSQL，Schema/snapshot/journal 对齐。
- `drizzle-postgres/0003_material_import_mapping.sql` 增加 parse run 行绑定、动态 Mapping 目标、源结构/metadata/mapping摘要、不可变确认快照、版本/SUPERSEDED、复用来源和STALE语义；Worker、API和现有Import Workspace已完成非生产自托管闭环。
- `drizzle-postgres/0004_material_import_normalization.sql` 增加版本化 Normalization run、关系化核心/动态属性候选、lineage、稳定 issue、重试/重跑/取消、发布一致性约束和已发布数据不可变 trigger；Worker、API和现有 Review UI 已完成非生产闭环。
- `drizzle-postgres/0005_material_import_review.sql` 增加 Review Session/Row、核心和动态属性覆盖历史、Issue resolution、Review validation issue、sealed finalization、行级 operation、ACTIVE binding、Draft link 和审计历史；TASK01 Material Service、API、Worker 与现有 Import Workspace 已完成非生产闭环。LANDING-TASK09 在页面中增加“标准整理”后，工作区为八个可见步骤。
- `drizzle-postgres/0006_identity_security.sql` 和 `0007_master_data_bom.sql` 分别补齐身份安全与关系化主数据/BOM；`0008_inventory_ledger.sql` 新增稳定 Material/Unit ID 的库存余额投影与不可变账本；`0009_procurement.sql`、`0010_production.sql`、`0011_sales.sql`、`0012_quality.sql` 和 `0013_finance.sql` 分别关系化采购、生产、销售、品质与财务结算事实，旧文本编码/JSON 表仅保留为迁移来源。
- `drizzle-postgres/0014_migration_openings.sql` 新增不可变 Migration Opening Source、库存期初/冲销和 Finance Opening/冲销；只通过测试迁移 CLI 的内部 Service 物化，复用 Ledger/Balance 与 Finance Document/Event/Settlement，不回填旧数据或暴露 HTTP 写路由。
- `drizzle-postgres/0015_market_project_handoff.sql` expand-only 新增稳定 Project、不可变 Requirement Version/Item、受控 Document Link、Handoff 投影和不可变 Event；服务端只允许 sales 市场与 engineering 项目角色按状态机操作，不回填旧数据或启动下游流程。
- `drizzle-postgres/0016_project_planning_handoff.sql` expand-only 新增正式 planning 角色约束、Requirement Resolution、版本化 Planning Package、Item/BOM/Document 快照和不可变 Event；不修改 0015 事实，不读取库存或创建需求/采购/生产单据。
- `drizzle-postgres/0017_planning_material_requirements.sql` expand-only 新增不可变物料需求计划/行、独立库存/在途 Planning Allocation、采购申请/行和事件；只消费固化 Package 快照，提交时锁定重算，不修改正式 `reserved_qty` 或创建 PO/收货/生产事实。
- FIX-17 不新增 Migration：采购接收详情继续在 0016/0017/既有 Inventory/Procurement 关系模型内读取。Package ACCEPT、Plan GENERATE、PRQ SUBMIT 与 Purchase 决策计数必须精确来自不可变 Event；九项当前供应必须复用 MAIN Inventory、有效 Plan Allocation 和有效 PO/Delivery Plan 投影。关键字段缺失时服务端 409、客户端禁用确认，读取保持对象范围、repeatable-read/read-only 和零业务/Audit 写。
- `drizzle-postgres/0018_procurement_sourcing.sql` 保存 RFQ、报价版本、比较版本、人工 Award 和事件；`0019_sourcing_purchase_fulfillment.sql` 新增 Award/PO 来源、到货计划、待入库、Receipt 分配和不可变事件，并复用既有 Procurement/Inventory/Finance 事务权威。
- `drizzle-postgres/0020_production_handoff_reservations.sql`—`0023_sales_delivery_receivable.sql` 依次增加计划→生产、报工/完工、FQC 放行和精确发货/AR；`0024_finance_project_settlements.sql` 增加不可变 Financial Source→Project/UNATTRIBUTED 归属，继续复用唯一 Finance Document/Settlement/Reversal 权威。
- `drizzle-postgres/0025_production_routing_snapshot.sql`—`0029_production_nonconformance_rework_handoff.sql` 依次增加路线快照、工序执行、末序正式报工绑定、工序 IPQC 门禁和 NCR→返工申请交接；`0030_production_rework_execution.sql` 复用既有 Operation Run/Report 与 Quality 权威，把 ACCEPTED 申请经显式 REWORK 派工、返工复检和放行重新接入后序生产流。
- `drizzle-postgres/0031_production_batch_genealogy.sql` expand-only 增加 Manufacturing Batch Set/Batch/Event、Run nullable Batch 稳定身份，以及 Report/Completion 单 Batch 关系和数据库 guard；发布后快照/digest 不可变，NORMAL/REWORK、Input Allocation、Quality/NCR/Rework、Final Output/Report/Completion 沿稳定 ID 保持同批。
- `drizzle-postgres/0032_finished_goods_inventory_lots.sql` expand-only 增加唯一 Finished Goods Inventory Lot、Ledger/Balance nullable 稳定 Lot 外键、一致性/不可变/服务写/deferred 守恒 guard；Batch Completion 创建或复用同一 Lot，冲销回写原 Lot，ORDER 历史继续 null/空 Lot。Lot Balance 与 Material Aggregate、freeze/unfreeze、API/UI/genealogy 已在回环环境验证；原材料、供应商和 Shipment Lot 未实现。
- `drizzle-postgres/0033_finished_goods_lot_fqc_shipment.sql` expand-only 为 Allocation、FQC、Shipment Line 与 FQC Consumption Fact 增加 nullable 稳定 Lot 外键；BATCH 必须同 Lot，ORDER 保持 null。warehouse 显式选择 Lot，Shipment 原子消费同 Lot Balance/FQC 并写 Ledger/Source/Event；冲销只恢复原 Lot。实际 `4/6`、冻结拒发、冲销同 Lot 再发、ORDER、恢复与清理已通过；原材料/供应商/Receipt/领料 Lot 仍未实现。
- `drizzle-postgres/0034_supplier_receipt_lot_iqc.sql` expand-only 将 `inventory_lots` 扩展为制造成品/供应商来料严格 XOR 来源；ACTIVE/STOCKED/IQC Receipt 原子生成 RML Lot 并同时增加 on-hand/frozen。IQC 沿 Receipt Line→Lot 创建，RELEASE 通过追加式 UNFREEZE 只解冻 passed 范围，失败量继续冻结；无 IQC/AP/领用等下游时整单冲销沿原 Lot 反向过账。真实主链 10/8/2→10/2/8 与 3 件 REVERSED 支线、重启和恢复已通过；生产领料 Lot 未实现。
- `drizzle-postgres/0035_bom_material_governance.sql` expand-only 新增 Governance Run/Group/Row/Spec、Material/Alternative Candidate、Decision/Link/Event 九张关系表，并扩展导入透明度和 v2 规格 metadata。严格身份、来源不可变、外键/CHECK/索引、服务事务入口和全局正式物料冲突门禁已在空库与 0034 升级隔离库验证；该 migration 后由 IMPLEMENT-07 作为 0034→0035→0036 的前置步骤受控应用到并行非生产 UAT，仍未处理真实治理数据。
- LANDING-TASK09 不新增表或 Migration。`material-standardization-selfhost` 只在 repeatable-read 只读快照中消费当前已发布 Parse、选中 Sheet、当前 Mapping 与原始行，生成 `CYD-MATERIAL-13C-v1` 投影；5,000 候选行/32 MiB 门禁、owner/`read_any`、受保护分页预览、CSV 下载审计和公式注入保护均在服务端。
- 本地文件卷保存二进制，数据库只保存受控相对路径和摘要元数据。
- Worker 使用 PostgreSQL Outbox、`FOR UPDATE SKIP LOCKED`、租约、心跳、重试和 CAS；Web/Worker 是独立入口。

### 历史在线 D1

- `drizzle/0000`—`0008` 形成 45 张表的开发 schema；Material V2、Draft/Review、Import Batch、Parser/Mapping、Normalization、Material Library 和 Supplier Profile 全部使用版本化 Up、snapshot/journal、受保护恢复边界与隔离迁移测试，尚未执行生产 migration。
- 大多数业务对象按 `kind` 存入 `erp_records.data_json`。
- API 运行时仍只为 legacy 8 表包含兼容建表语句；V2 与 Material API 对象必须显式应用版本化 migration，不在生产启动时自动创建。
- PHASE0-TASK03 只核验仓库内 `0000`—`0008` 文件与 SHA-256，没有访问生产 D1，也没有确认生产实际 migration 版本。

## 主要模块

- 身份与权限：初始化、登录、会话、角色、用户状态、密码重置、审计。
- 物料治理：物料、供应商映射、CSV/XLSX/XLS 自适应导入、不可变原始行、固定 13 列供应商标准整理、Normalization/Review、品类+关键规格+性能等级的严格身份治理、候选报告和受控新物料建档。
- 工程：Product Version 与 BOM Version 独立版本轴、code-first ACTIVE 正式物料选择、稳定 Material/Unit ID、草稿校验、既有发布/修订及齐套分析。
- 供应链：供应商、采购建议、采购订单、收货、库存调整和库存流水。
- 制造：工单、BOM 转工单、领料、完工和报工。
- 销售：客户、询价/报价、销售订单和发货。
- 部门交接：市场项目草稿/修订/提交与项目接收/退回；项目负责人显式解析 Product/BOM、生成不可变规格包并提交；计划员接收包后生成/修订/提交锁定重算的物料需求计划，采购只接收或退回净需求申请。
- 品质与财务：检验、缺陷、应收应付单据、收付款和汇总。
- 运维：健康检查、管理看板、备份、恢复和导出。

## 当前架构结论

1. D-040 已确认自托管 PostgreSQL 是未来唯一生产权威方向；Python/SQLite 和 Cloudflare/D1 都只作迁移来源。
2. 服务端 Node API/PostgreSQL 是权限、数据规则和任务状态的权威边界。
3. legacy 在线 API 主要集中在 `erp-api.ts`；Material namespace 已由 catch-all 精确分发到独立 Material API、安全、查询和审计导出模块，并调用现有 Validation/Draft/Review Service。
4. Material Master V2 应先建立关系化数据底座和迁移测试，再接入页面或 AI。
5. 历史文档记录的 Sites 生产 `v3` / `2b4f178` 与纳管开发基线 `9f2c2dc` 的运行时代码一致；本次未访问公开 Site 重新确认当前在线状态，任何后续业务修改与部署仍须单独批准。
6. 自托管测试使用明确的隔离 PostgreSQL 数据库和临时/测试文件卷；Miniflare 只保留为历史实现回归。
7. D-041 已确认自托管 Material 使用固定 `DRAFT -> PENDING_REVIEW -> ACTIVE` 单步状态机；驳回回到 `DRAFT`，创建人和最后修改人不得审核，正式编码仅在批准事务中原子生成。
8. D-042 已确认自托管 Mapping 使用不可变确认快照、显式新版本和结构相容复用；复用只复制到 DRAFT 并必须重新确认，Mapping 确认不自动启动 Normalizer。
9. D-043 已确认自托管 Normalization 使用 run 隔离暂存、关系化候选/lineage 和 Job/业务结果同事务原子发布；重试复用同 run，重跑创建新版本，取消结果不得成为 current。
10. D-044 已确认自托管人工复核采用独立覆盖层、版本历史和行级可恢复 finalization；ACTIVE 只允许人工精确绑定，Material Draft 必须经 TASK01 Service 创建且保持未编码 DRAFT。
11. TASK02—TASK10 已完成自托管 API、实时 Dashboard、离线 backup/restore 治理和原生根工作台的非生产链路；PostgreSQL 中存在实现与隔离验收仍不等于真实数据已迁移或业务已切换。
12. SELFHOST-PHASE2-TASK01 已从源码确认 Python 共有 64 个 HTTP 操作（GET 34、POST 30）；以当时基线统计，自托管已覆盖 4、部分覆盖 9、未覆盖 51。
13. SELFHOST-PHASE2-TASK02 已补齐自托管身份公共边界：PostgreSQL `0006`、独立 Identity Repository/Service/Handler、用户管理、密码策略、会话撤销、must-change 全局门禁、限流、持久幂等、CAS 和系统审计；不包含其他业务域或生产动作。
14. SELFHOST-PHASE2-TASK03 已新增 PostgreSQL `0007` 和独立 Master Data/BOM 服务，关系化 Customer、Supplier、Product/Version、BOM Header/Version/Line、Supplier Mapping/价格历史；发布后不可变，readiness 只检查结构且不读取库存。版本为 `0.1.0-alpha.3`，未迁真实数据或部署。
15. SELFHOST-PHASE2-TASK04 已新增 PostgreSQL `0008` 和独立 Inventory 服务；Ledger 是唯一数量权威，余额是同事务可核对投影，支持通用入/出/盘点、冻结/解冻及全额冲销。readiness 只读该新投影；未回填旧库存或实现采购/生产/销售过账。版本为 `0.1.0-alpha.4`，未迁真实数据或部署。
16. SELFHOST-PHASE2-TASK05 已新增 PostgreSQL `0009` 和独立 Procurement 服务；关系化 PO/Receipt/状态事件/财务来源以稳定内部 ID 关联，收货/全额冲销与 TASK04 Ledger/Balance、audit、idem 在一个事务提交。缺料建议不自动建单，不创建 AP/付款，不迁真实 PO/在途。版本为 `0.1.0-alpha.5`，未发布或部署。
17. SELFHOST-PHASE2-TASK06 已新增 PostgreSQL `0010` 和独立 Production 服务；WO RELEASE 固化不可变 BOM 快照与 numeric 需求，领退料/完工与 TASK04 Ledger/Balance、状态、audit、idem 单事务提交，报工只追加。成品必须显式引用 ACTIVE/STOCKED Material，不创建品质/财务过账，不迁真实生产数据。版本为 `0.1.0-alpha.6`，未发布或部署。
18. SELFHOST-PHASE2-TASK07 已新增 PostgreSQL `0011` 和独立 Sales 服务；Quote Version/状态事件、ACCEPTED 原子转 SO、Shipment/全额冲销与 TASK04 Ledger/Balance、状态、销售金额来源、audit、idem 单事务提交。金额固定 CNY 六位 numeric，不创建应收/收款/品质过账，不迁真实销售数据。版本为 `0.1.0-alpha.7`，未发布或部署。
19. SELFHOST-PHASE2-TASK08 已新增 PostgreSQL `0012` 和独立 Quality 服务；IQC/Receipt Line、IPQC/Report、FQC/Completion Line+SO Line 使用稳定关系，Result/Defect/Event 不可变，异人处置/关闭/管理者重开受控。Shipment 在原事务消费 CLOSED/RELEASED FQC 额度；不伪造无批次 IQC 库存隔离，不迁真实检验数据。版本为 `0.1.0-alpha.8`，未发布或部署。
20. SELFHOST-PHASE2-TASK09 已新增 PostgreSQL `0013` 和独立 Finance 服务；AR/AP 只消费未冲销正向 Shipment/Receipt 金额来源，Settlement/Reversal/Event 不可变，Document 余额/状态/version 是受控投影。财务过账后上游来源冲销 fail closed；不接银行/税务/发票/汇率/总账，不迁真实金额。版本为 `0.1.0-alpha.9`，未发布或部署。
21. SELFHOST-PHASE2-TASK10 已新增独立 Dashboard Query Service、原生根工作台和离线 backup/verify/新空目标 restore；权限裁剪、numeric 文本、不同单位不合计、64 操作/23 legacy GET 覆盖、隔离恢复与 Compose 重启通过。版本为 `0.1.0-alpha.10`，未新增 `0014`、未迁真实数据、发布或部署。
22. SELFHOST-PHASE3-TASK01 已新增显式离线迁移 CLI、SQLite/D1 export adapter、PostgreSQL `migration_tool` staging、manifest、稳定 ID map、checkpoint、合成 commit/reconcile 和生产拒绝守卫；版本为 `0.1.0-alpha.11`，0001—0013 保持不变。它只证明合成准备度，不读取或物化真实业务数据。
23. SELFHOST-PHASE3-TASK02 已新增 PostgreSQL `0014`、digest-bound command 和内部 Migration Opening Service；合成库存期初进入不可变 Ledger/Balance，合成无来源应收应付进入 `OPENING_AR/AP`，全额冲销、并发、幂等、Dashboard 和恢复通过。MG-001/MG-002 只在合成非生产模型中解决，真实数据与生产仍 NO-GO。
24. SELFHOST-PHASE3-TASK03 已新增仅 CLI 可达的受控 public materializer；18 个 cutover snapshot 来源指向 actual public ID/digest，12 个历史活动为 archive-only，正常全域 Service/API、Dashboard、文件、backup→新空目标 restore、同 manifest 重跑和整栈重启通过。版本为 `0.1.0-alpha.13`，migration 保持 0001—0014；只证明完全合成业务表物化，真实数据与生产仍 NO-GO。
25. SELFHOST-PHASE3-TASK04 已在明确授权下对本机唯一 SQLite 源执行 online backup，仅在临时快照上完成 29 表/3,619 条的 Schema fingerprint、脱敏聚合质量盘点与无目标 Dry-run。快照已删除，源 inode/权限与 Python PID 不变，未读文件正文或连接 PostgreSQL。版本 `0.1.0-alpha.14`，migration 保持 0001—0014；真实迁移与生产仍 NO-GO。
26. SELFHOST-PHASE3-TASK05 已在同机启动 `chenyida-erp-parallel`：PostgreSQL 17、14 migrations、Web/Worker、唯一管理员和四个持久卷。Web 仅 `127.0.0.1:3000` 并通过 SSH 隧道访问；管理员流程、空 Dashboard、23 GET、数据库/服务重启和资源门禁通过。Worker 对 PostgreSQL 短暂断连增加去敏 Pool error handler 与轮询重试。版本仍为 `0.1.0-alpha.14`，真实数据、HTTPS、切流和生产批准均未发生。
27. SELFHOST-PHASE4-TASK01 采用 D-058：sales=市场、engineering=项目；稳定 `PRJ-########` 与六表关系模型保存当前投影和不可变需求/事件，写操作由 Project Service 统一执行 CSRF、持久幂等、CAS、事务 Audit 和职责分离。`0.1.0-alpha.15`/`0015` 已通过并行双账号闭环、重启和清理验收，不创建 Product/BOM/订单/计划/采购/工单。
28. SELFHOST-PHASE4-TASK02 采用 D-059：新增 planning 正式角色；engineering 项目负责人显式关联客户一致的 RELEASED Product/BOM，生成 numeric 计算的不可变规格快照包；planning 只能接收或退回，退回后创建新包版本，接收不触发 TASK03。`0.1.0-alpha.16`/`0016` 已通过并行真实旅程、重启与清理，验收业务最终为 0。
29. SELFHOST-PHASE4-TASK03 采用 D-060：只聚合最新 ACCEPTED Package 固化 Material+Unit，PostgreSQL numeric 在提交锁内重算库存、需求日前在途及其他有效计划分配；独立 Planning Allocation 不改正式 `reserved_qty`，退回后旧分配失效且必须新版本重算。`0.1.0-alpha.17`/`0017` 已通过并行真实退回→v2 重提→接收、重启与恢复清理，最终业务为 0；未创建新 PO/收货/工单。
30. SELFHOST-PHASE4-TASK07 采用 D-064：Report 受净领料支持量约束且不写库存；Completion 必须通过 Allocation 消费未占用 good，并与成品 Ledger/Balance、Work Order 投影、Event/Audit/Idempotency 同事务。Report/Completion 只能追加式全额冲销并执行 IPQC/FQC/Shipment/库存门禁。`0.1.0-alpha.21`/`0021`、真实 4/6 链、重启、双恢复与清理已通过。
31. SELFHOST-PHASE5-TASK03 采用 D-070：结构化 Production Report 只消费同一工单末 Snapshot Operation 的稳定 Run Report good，Allocation 与既有 Report 保持不可变；warehouse 继续显式消费既有 Report 创建 Completion 和成品库存。`0.1.0-alpha.27`/`0027`、实际 Report/Completion/Ledger `4/6`、Balance 10、COMPLETED、重启、恢复与清理已通过；品质、销售和财务事实保持 0。
32. SELFHOST-PHASE5-TASK04 采用 D-071：Routing Operation 的 `NONE/IPQC` 随发布 digest 和 Work Order Snapshot 固化；工序 good 不自动创建 IPQC，quality 显式引用稳定 Run Report，经异人处置/关闭后才形成下游额度。`0.1.0-alpha.28`/`0028`、REFLOW Hold `10→6→0`、AOI available `0→4→10`、Report/Completion/Ledger `4/6`、Balance 10、重启、恢复与清理已通过。
33. SELFHOST-PHASE5-TASK05 采用 D-072：只有结构化 Operation Run Report IPQC failed 才能建立唯一 NCR；failed 数量由 active rework、final scrap 与 unresolved 守恒。quality 的 DRAFT 在 submit 时生成不可变 digest/snapshot，production 只接收或退回，ACCEPTED 仅占用额度等待后续任务。`0.1.0-alpha.29`/`0029`、passed 8/failed 2、v1 退回/v2 接收、重启、第二新空库恢复与最终清理已通过；未执行返工工序或库存报废。
34. SELFHOST-PHASE5-TASK06 采用 D-073：ACCEPTED Request 由 production 显式派工为既有 `production_operation_runs` 的 REWORK 类型；processed 只表示重复加工次数，返工 good 必须经新的稳定 Run Report IPQC 复检并 `CLOSED + RELEASED` 后才恢复后序额度。`0.1.0-alpha.30`/`0030`、原检 10/8/2/8、返工 2、复检 2/2/0/2、AOI 8/2、成品 8+2=10、重启、第二新空库恢复和清理已通过；原 failed 2 保持，Execution COMPLETED、NCR RESOLVED。
35. SELFHOST-OPS-PARALLEL-DB-CREDENTIAL-ROTATION-03 已安全轮换并行非生产 PostgreSQL 角色密码与 root-only env；PostgreSQL 容器没有重启，Web/Worker 串行重建。新密码经 Compose 网络执行 `SELECT 1` 成功，旧密码经 SCRAM 返回 `28P01`；凭据值和连接字符串未写入仓库、日志或报告。
36. TASK09 前确认数据库合法基线不再是 Audit/Session 0：当时的 `IDENTITY/LOGIN/success` 审计与 ACTIVE session 属于合法管理员登录，必须保留。后续任务仍须使用 baseline-delta，不得删除不可变审计；当前精确身份基线由第 38 项取代。
37. SELFHOST-PHASE6-TASK01 采用 D-079：治理只消费已发布 Normalization，以版本化规则/配置快照和精确十进制形成“类别+关键规格+性能等级”身份。只有完整 READY 才精确归组，缺项/冲突 fail closed；标准候选 key 不是 ERP 编码。人工可精确绑定 ACTIVE 或经既有 Material Workflow 建 DRAFT，治理与普通审批共享 advisory identity lock 且绑定时 live revalidation；替代项只是候选。`0.1.0-alpha.35`/`0035` 只通过源码与隔离 PostgreSQL 验收，未进入常驻运行面。
38. SELFHOST-OPS-ADMIN-ACCOUNT-04 后当前身份基线为用户/active admin `2/2`、Session/有效 Session `2/0`、Audit/Identity Audit `881/9`、持久幂等 3；`admin2` 为 active admin、version 2、`must_change_password=true` 且尚未登录。弱密码拒绝、成功创建、匿名认证门禁和安全重置审计均为合法安全记录，必须保留；曾被误输出的旧摘要已失效。
39. SELFHOST-OPS-TRUSTED-ORIGIN-05 后当前身份基线为用户/active admin `2/2`、Session/有效 `3/1`、Audit/Identity `887/15`、持久幂等 3；`admin2` 已登录但仍为 version 2、`must_change_password=true`。任务起点 `885/13` 后新增两条无凭据公网验收的 `SELF_PASSWORD_CHANGED/failed/AUTH_REQUIRED` 合法审计；没有治理或业务写入。Migration manifest 仍为 `b2ff69f7...13b8b`，Material/Product/BOM/Line 仍为 `532/6/6/316`。
40. SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 后当前身份基线为用户/active admin `2/2`、Session/有效 `3/1`、Audit/Identity `888/16`、持久幂等 3；`admin2` 为 active admin、version 3、`must_change_password=false`。唯一 delta 是账号 version/flag 和一条专用成功 Identity Audit；密码二次指纹、Session、Migration manifest 与业务计数不变。
41. SELFHOST-OPS-UAT-BLOCKER-FIX 后当前身份基线为用户/active admin `3/2`、Session/有效 `14/5`、Audit `920`；唯一 UAT 临时 manager 已通过页面停用。审计 897—907 保留复现失败和公网对照证据，部署后 908—920 全部成功；两个目标 logout 与完整复验的旧 Session 均已撤销。首次验收脚本提前结束遗留一个丢失令牌的有效会话，等待正常 8 小时 TTL，不直接 SQL 删除或改写审计。
42. SELFHOST-LANDING-TASK09 采用 D-084：供应商标准整理不是第二套 Parser/数据库，精确模板直通，其他来源只使用明确结构证据；`PROFILE_PENDING` 仍留空并提示人工确认。数量按字符串十进制计算，显式替代行才折叠；预览/CSV 不创建 Draft、正式料号或业务事实。`0.1.0-alpha.36`/`0035` 仅完成源码验收，未进入常驻运行面。
43. SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY 复用 0034 已有 SUBMIT version/change_reason 作为提交事实，不新增 Schema；空说明诚实显示未保存。审核可处理数固定为 PENDING_REVIEW，退出历史恢复采用隐藏后重新认证并配合 private/no-store，而不是删除浏览器历史。兼容 Web 已部署，533—536 和 operations 权限集未改变。
44. SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 采用 D-085：公网 IP 变化时，Caddy `ERP_DOMAIN` 与 Web 单值 `ERP_PUBLIC_ORIGIN` 必须同一受控任务切换，不能临时双允许旧/新公网 Origin。当前唯一入口为 `https://43.135.148.43.nip.io:18888`；旧主机名从当前 Caddy 退役，root-only env 副本是回退权威。
45. SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 不新增决策或状态机：`products/product_versions/bom_headers/bom_versions/bom_lines` 与 Planning 表继续是唯一权威，全部引用稳定 ID。Product Version 与 BOM Version 分轴；BOM 属于 Product Version，Project 只在 Planning Handoff 关联。正式编码/名称/单位组合只用于展示，保存和发布均由服务端事务重验 ACTIVE 正式 Material 与主单位。
46. SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 不改变状态机或服务端安全决策：Planning 写统一由共享客户端发送当前 Cookie/Header CSRF，RELEASED BOM 前端只读与服务端/DB 不可变必须同时成立，BOM 首页默认不加载历史明细。
47. SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07 已实施 D-086：alpha.37/0036 用追加式 Unit Resolution Version、每需求行独立 CAS Head 和 Package Item 精确 `unit_resolution_id` provenance 解除 Schema 阻断；Unit 保存和新 Package 都重验 enabled，权限/Origin/CSRF/幂等/审计/故障回滚保持事务边界。并行非生产 UAT 已迁移部署；该任务完成时主 UAT 尚未产生 Resolution 或 Package，后续 FIX-08 当前基线见上文。

## 当前风险

- V9 主数据表缺少逐行显式单位，且不包含产品/版本/BOM 行号/数量/位号/单位结构；197 行只能保留在 review。未经补充明确字段不得把 PCS、使用次数或原始描述猜成主库单位/BOM 数量，也不得先清空现有 532 Material/316 BOM Line。
- 当前受保护 Product Version 7/A0、BOM Version 7/V1 和 Planning Package ID 1/v1/SUBMITTED 都是 FIX-08 最后已验证业务基线；OFFLINE-IDENTITY-RECOVERY-11 只有受控备份/恢复与整体指纹核对覆盖读取相关表，未做这些对象的业务级核验、修改或操作。身份风险虽已解除，仍不得把该任务当作 Planning 授权，接收、退回或创建 v2 必须另立任务。
- `PRJ-00000001` 的源 Requirement Item 仍为 `unit_id=NULL/unit_pending=true`；Unit Resolution Head 已固定指向 ID 1/v1/Unit ID 1/PCS，Package Item 也固定引用该 Resolution Version。不得写回源需求、读取后来变化的 Head 冒充快照、从 BOM 推断单位或绕过完整性门禁。
- 历史 BOM-SELECTOR-FIX-04 和 FIX-08 的凭据事件及 TASK09/TASK10 的 PARTIAL/BLOCKED 记录继续保留；OFFLINE-IDENTITY-RECOVERY-11 已通过全新 Canonical、目标 Session 撤销和完整退出验证解除当前暴露/遗留 Session 风险。凭据值和身份信息仍不得进入仓库；后续登录和业务操作必须使用各自任务授权。

- Material Draft/Review/Active、Import Mapping/版本/复用、行级 Normalizer 及人工复核/ACTIVE绑定/Draft Commit 已完成 PostgreSQL 非生产移植；后续真实数据演练和迁移不得重新接入 D1 运行依赖。
- `0002`/`0003`/`0004`/`0005`、双用户审批、Mapping确认、Normalization原子发布/取消、人工复核 finalization 和重启持久性只在一次性 PostgreSQL 17/Compose 测试环境验证；未迁移真实数据、执行生产容量测试、生产恢复演练或部署。
- TASK01 staging、TASK02 Opening 和 TASK03 public materialization 只在隔离 `_migration_test` 合成环境验证；TASK04 已补充真实 source fingerprint、领域聚合质量和无目标 opening plan，但逐行业务确认、真实目标物化、文件存在性/摘要、容量和生产恢复仍是生产 NO-GO 项。
- Site 源码已可从根仓库恢复；生产提交与开发提交仍需在后续发布基线中持续追踪。
- 本地和在线数据模型、编码和治理行为分叉。
- 在线 JSON 模型缺少关键关系约束；本地 SQLite 缺少外键和迁移历史。
- A118/V700 的 2 Batch、766 Raw Rows 和完整 SHA 原文件归档仍保留；项目负责人已授权清空原 543 条 Cleaning Rows，用五条电容作为重新导入匹配基线。
- 开发库新增内部编码 1～5 的五条电容，内部物料共 9 条；这些是临时测试编号，五条本地匹配均为对应编码、自动匹配 1.00。
- 清洗审核列表支持服务端匹配置信度 `newest/desc/asc` 排序；页面可选高到低或低到高，同分按 ID 降序。项目负责人已在网页重导入 V700，当前有 229 条 Cleaning Rows、21 个置信度层级。
- 管理员可通过双重确认的清空接口删除全部 Cleaning Rows；系统先自动备份并在事务中写审计，Batch/Raw Rows/归档/物料/映射不删除。部署没有自动清空当前 229 条。
- 1928C/G20/J587 已完成规格兼容：三文件隔离产生 221 条 Cleaning、216 条有规格；名称不参与编号评分，结构化规格完整且唯一才自动确认内部编号，部分唯一候选保持疑似，歧义不随机给号。
- 1928C 进一步改为逐属性规格匹配：型号、描述、MPN 分开作为证据，提取品类/封装/值/耐压/误差/介质后逐项比较；当前 25 条旧 Cleaning 不回填，重导后生效。
- 清洗审核现同时展示来源与候选内部物料的八项规格，空字段标为未维护；富规格描述进入 raw spec、厂商型号进入 raw model，介质未覆盖的疑似候选置信度不再为 1.0。
- 通用规格匹配已部署：Parser 从明确规格、多列组合、描述或名称中选择参数更完整的来源并保存列名；Matcher 把品类、封装、容量/阻值/电感值、电流、电压、功率、频率、误差、材质和尺寸归一为无序参数集合。MPN/品牌独立展示，不进入通用规格分数。
- 规格精度门禁已部署：CATEGORY 不作为足够的编号证据，少于两类鉴别参数返回“规格不足”且不提供候选；自动匹配要求双方至少三类参数、锚点、完整一致和候选唯一。J587 隔离复算中的 4 条连接器大类误候选已消除。
- 当前 122 条既有 Cleaning 保留且不回填、不重算；项目负责人清空并重导后，新行才使用证据强度校准并显示“规格不足”或内部候选缺项。
- Material Draft/Review POST 已具备同源/CSRF、持久幂等和限速；其他 legacy POST 的 CSRF 与限速仍需专项治理。测试环境已有本机一次性 D1，尚无远程 Test D1。
- Material Draft、Review Queue、Import Workspace 和 Normalization Review UI 已完成非生产实现；历史 Site 未部署这些代码，本任务也未访问公网重新确认其状态。
- Node/PostgreSQL 已完成真实 BOM 部分导入并在用户授权下开放受控公网 HTTPS 入口；这不代表 438 条隔离来源已解决，也不代表全部业务域完成正式投产验收。
- `chenyida-erp-parallel` 继续以 `ERP_ENV=production` 保持 Secure Cookie，同时用独立 `ERP_DEPLOYMENT_CLASS=uat` 明确非生产验收类别；只有显式 flag 才允许双端严格 loopback。Caddy 公网监听 80/18888，Web 仅回环 3000、PostgreSQL 无宿主端口。入口临时依赖 DNS-only 名称，后续应替换为公司自有域名。
- `admin2` 当前凭据已按项目负责人明确决定继续有效，不再受首次改密门禁；这是单账号审计例外，不得扩展为其他账号或全局策略。曾误输出的旧密码摘要已经正式重置失效，不得尝试恢复、复用或删除相应审计证据。
- 在线同库备份和本地零字节历史备份不能视为可靠灾备。
- 业务决策 `B01-B24` 尚未全部确认。
- 根自托管页面已退出 legacy iframe；显式 `/erp/index.html` 仍承载尚未重写的业务 UI。Dashboard/backup 治理已接通，但真实数据、生产备份恢复演练和切换仍未完成，不能描述为已投产。
- PostgreSQL Customer/Supplier/Product/BOM、通用库存、采购、生产、销售、品质和 AR/AP/收付款已有关系服务；`erp_records` JSON 占位与旧库存表不属于这些权威链路。表存在不等于 API、权限、事务、幂等、审计或真实数据迁移已完成。
- alpha.35 对旧 ACTIVE/FROZEN/INACTIVE 的不完整或冲突身份只能检测并阻断同类新建稿/批准，尚无 ACTIVE 属性修订流程；`MECH/OTHER` 仍为 `UNSUPPORTED`。治理 UI、真实样本试治理/试迁移、生产容量与部署、正式替代料审批都属独立风险与后续任务。

## 开发规范

- 每次只执行 `TASKS.md` 中一个任务编号。
- 不扩大范围，不修改无关代码，不直接操作生产数据或生产环境。
- 数据库变化必须使用版本化迁移并提供隔离迁移测试。
- 新功能必须有测试；关键写操作必须有权限、事务、幂等、并发和审计。
- AI 不得直接覆盖正式数据，物料合并不得绕过人工审核。
- 完成任务必须更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 并创建独立提交。

## 当前路线

`SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13` 已完成：alpha.38/0037 的关系化 Engineering Revision Response、RETURN 独立 CAS Head 和固定 v1→RETURN→Response→v2 谱系已经实现、恢复验证并部署到并行非生产 UAT。主 UAT engineering-only 只读验收后 v1/RETURN/Response/v2 仍 `1/1/0/0`，未登录 planning。现在没有自动执行任务；可在下一次明确授权后重新开始 engineering v2 黑盒试用。此前身份恢复和历史 PARTIAL/BLOCKED 记录均保持。

## 恢复上下文检查清单

1. 阅读 `AGENTS.md` 和 `docs/project/MASTER.md`。
2. 阅读 `TASKS.md`，确认唯一当前任务和依赖。
3. 阅读本文件及 `DECISIONS.md`，区分已确认与待确认事项。
4. 阅读当前任务文档，检查禁止事项和验收标准。
5. 运行 `git status`，不得覆盖用户未提交变更。
6. 只读核验可能变化的 Git、Site 和数据库状态后再开发。
