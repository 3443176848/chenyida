# 晨亿达 ERP 发布、迁移与回退追踪

最后核验：2026-08-08（Asia/Shanghai）
适用任务：最新功能与并行非生产部署验收为 `SELFHOST-UAT-FIX-33`；历史发布/恢复记录保留下文

## 1. 使用规则

1. 本文件同时追踪历史运行面、当前开发运行面和未来自托管发布，不能用“测试通过”替代“已部署”或“已批准”。
2. Git 提交、包版本、数据库 migration、测试、部署、数据迁移和批准状态必须分别记录；任一项未知时写 `UNKNOWN`，不得推断。
3. 生产发布必须新增一条不可改写的发布记录。更正历史记录时追加说明，不覆盖原始结论。
4. 发布提交不能在自身内容中稳定记录自身哈希；记录使用功能基线提交，并通过 `git log -1 -- docs/project/RELEASES.md` 解析发布记录提交。
5. 本文件不授权生产访问、migration、部署、数据迁移或流量切换。

状态词：`HISTORICAL`（历史记录）、`DEVELOPMENT`（开发运行）、`NOT_RELEASED`（尚未发布）、`DEPLOYED`（已部署）、`MIGRATED`（真实数据已迁移）、`APPROVED`（已批准）。

## 2. 当前运行面与版本定义

| 运行面 | 版本/标识 | Git 基线 | 数据库基线 | 测试状态 | 部署状态 | 真实数据迁移 | 回退基线 | 批准状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Node.js / PostgreSQL Award→PO Supplier Mapping资格并行UAT | `0.1.0-alpha.40` | 功能提交`1f205af0bf81379345a09353d9d32ab5c7545971`；运维/文档提交消息`ops: deploy Award to PO mapping validation fix`，SHA以Git log为准 | 39/head0039且无0040；RFQ CLOSED v7、Award/Line`1/4`、四条固定Binding/Mapping qualified、PO/Line/Plan/queue全0 | 无DB93、Unit22、Fulfillment PG5、Mapping PG10、0038/0039`5+6`、Sourcing PG9、Binding PG18、upgrade3、npm/Python/typecheck/lint/build/credentials；隔离`1/4/4/4`及主UAT桌面/390×844取消通过 | Web-only`DEPLOYED`到受控非生产UAT；Web`83c1bff3…`，PostgreSQL/Worker/Caddy未重建，Migration未运行；`NOT_RELEASED`到生产 | `NOT_MIGRATED`；主UAT只预览、核验、填本地备注并取消，`business_post=0`，未创建PO/Plan | root:root0600 dump SHA`d3cf053f…c5c2`已list/第二新库恢复；旧Web`2396c8bc…`精确tag保留 | `AWARD TO PO SUPPLIER MAPPING VALIDATION FIXED — UAT PO NOT CREATED`；正式转换须新授权并重验资格/CAS/摘要/PO0 |
| Node.js / PostgreSQL Award→PO确认合同并行UAT | `0.1.0-alpha.40` | 功能提交`a4ffb8ee022234ea25add4ce636050366ac6887a`；运维/文档提交消息`ops: deploy Award to PO confirmation fix`，SHA以Git log为准 | 39/head0039且无0040；RFQ CLOSED v7、Quote2、Comparison v1、Award/Line/Event/PO/Plan`1/4/1/0/0` | Fulfillment4/3/3、Sourcing12/24、PG27、upgrade3+3+6、安全30、npm/Python/typecheck/lint/build/credentials；隔离`1 PO/4 Line/4 Plan`及主UAT桌面/390×844取消通过 | Web-only`DEPLOYED`到受控非生产UAT；Web`2396c8bc…`，PostgreSQL/Worker/Caddy未重建，Migration未运行；`NOT_RELEASED`到生产 | `NOT_MIGRATED`；主UAT只打开、核验、填备注并取消，`business_post=0`，未创建PO/Plan | root:root0600 dump SHA`75e45758…3d97`已list/第二新库恢复；旧Web`bb544f89…`精确tag保留 | `AWARD TO PO CONFIRMATION FIXED — UAT PO NOT CREATED`；正式转换必须新授权并重验CAS/摘要/Line/PO0 |
| Node.js / PostgreSQL RFQ Award Candidate选择并行UAT | `0.1.0-alpha.40` | 功能提交`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`；运维/文档提交消息`ops: deploy RFQ award candidate selection fix`，SHA以Git log为准 | 39/head0039且无0040；RFQ ISSUED v6、Binding8、Quote2、Comparison v1/CURRENT、Line/Candidate4/8、Award/Award Line/PO0/0/0，指纹`16d70f18…cf5bc` | Unit/UI33/33、Sourcing PG9/9、既有PG18/18、upgrade6/6、安全20/20、typecheck/lint/build/npm/Python/environment/credentials；隔离Award1/Line4/PO0及主UAT桌面/390×844取消通过 | Web-only`DEPLOYED`到受控非生产UAT；Web`f239ffe3…`，PostgreSQL/Worker/Caddy未重建，Migration未运行；`NOT_RELEASED`到生产 | `NOT_MIGRATED`；主UAT只在本地表单选择并取消，business POST0，未创建Award/PO | root:root0600 dump SHA`151910bc…e712`已list/第二新库恢复；旧Web`0dfcc0a8…`精确tag保留 | `RFQ AWARD CANDIDATE SELECTION FIXED — UAT AWARD NOT CREATED`；正式定标必须新授权并重验CAS/摘要/Quote/Candidate |
| Node.js / PostgreSQL RFQ Comparison聚合读模型并行UAT | `0.1.0-alpha.40` | 功能提交`80e1ad60fa1272017545e150721c8b71f7c68828`；运维/文档提交消息`ops: deploy RFQ comparison aggregate read model`，SHA以Git log为准 | 39/head0039且无0040；RFQ ISSUED v6、Binding8、Quote2、Comparison4/8/4、Award/PO0/0，指纹`16d70f18…cf5bc` | Unit/UI`10/10+18/18`、隔离PG`3/3`、0039回归`6/6`、Chromium`1/1+4/4`、Schema/typecheck/lint/build/npm/Python/environment/credentials及主UAT桌面/390×844通过 | Web-only`DEPLOYED`到受控非生产UAT；Web`0dfcc0a8…`，PostgreSQL/Worker/Caddy未重建，Migration未运行；`NOT_RELEASED`到生产 | `NOT_MIGRATED`；只保留既有合成UAT Comparison，主UAT业务POST0且未创建Award/PO | root:root0600 dump SHA`8e858983…bffa`已list/第二新库恢复；旧Web`89e76775…`精确tag保留 | `RFQ COMPARISON AGGREGATE READ MODEL FIXED — UAT AWARD NOT CREATED`；人工定标必须新授权 |
| Node.js / PostgreSQL 八角色工作台并行 UAT | `0.1.0-alpha.40` / `20260806-enterprise-ui-refresh-01` | 功能提交`4767c3db3cf66eb0978f07d044437790c0d4b87f`；运维/文档提交消息`ops: deploy role-based ERP workbench`，SHA以Git log为准 | PostgreSQL仍为39/head0039；Session207/有效1、Audit1446及RFQ/Quote保护指纹前后一致 | UI73/73、五组typecheck、lint、production build/postbuild、npm3/3、Python三项、credentials/diff、候选合同、匿名HTTPS/八角色资产/401、60秒health7/7通过 | Web-only`DEPLOYED`到受控非生产UAT；Web`f45d734b…`，PostgreSQL/Caddy未替换，Worker仅备份窗口短停，Migration未运行；`NOT_RELEASED`到生产 | `NOT_MIGRATED`；没有登录、Session/Audit增量或业务POST | root:root0600 dump SHA`dad839ef…`已list/第二新库恢复；旧Web`f139257b…`精确tag保留 | `ROLE-BASED WORKBENCH DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`；登录式浏览器验收或生产切流须新授权 |
| Node.js / PostgreSQL RFQ Quote Traceability 并行 UAT | `0.1.0-alpha.40` | 功能提交 `1be492e68f6635bc00ea3fb8ce461eac0617d8e7`；运维/文档提交消息 `ops: deploy rfq quote traceability fix`，SHA 以 Git log 为准 | 源码与并行 PostgreSQL 均为 `0001`—`0039`；主 RFQ `ISSUED v4`、Binding 8、Supplier A/B Quote `1/0`、Quote/Award/PO `1/0/0` | Unit/UI `9/9 + 12/12`、隔离 PostgreSQL `21/21`、隔离 Chromium `3/3`、Migration `3/3 + 6/6`、npm/Python/typecheck/lint/build/credentials及主UAT purchase-only只读桌面/390×844验收通过 | Web-only `DEPLOYED` 到受控并行非生产 UAT；PostgreSQL/Worker/Caddy未重建，未运行Migration；`NOT_RELEASED` 到生产 | `NOT_MIGRATED`；只保留既有合成UAT事实，没有写入主UAT业务数据 | root:root 0600 dump SHA `4fa038e…` 已list并恢复第二新库；旧Web `sha256:c8c3fdd…`精确tag保留 | `RFQ QUOTE VERSION SEMANTICS FIXED — SUPPLIER A RETAINED`；Supplier B入口可用但不得在本任务创建Quote |
| Node.js / PostgreSQL RFQ Traceability 并行 UAT | `0.1.0-alpha.40` | 功能提交 `b339acd97f08e4cc09451173b48580015817d9f8`；运维/文档提交消息 `ops: deploy rfq issuance safeguards`，SHA 以 Git log 为准 | 源码与并行 PostgreSQL 均为 `0001`—`0039`；主 RFQ generation 1 / DRAFT v1、Binding/Event 0、Quote/Award/PO及全部下游 0 | Migration 6/6、Unit/UI/PG 26/26、Material Requirement 12/12、真实跨域 2/2、隔离 Chromium、typecheck/lint/build/credentials/Python和主 UAT purchase-only只读取消验收通过 | `DEPLOYED` 到受控并行非生产 UAT；`NOT_RELEASED` 到生产 | `NOT_MIGRATED`；未固定或发出主 RFQ，未迁真实公司数据 | root:root 0600 dump SHA `960cd6a…` 已 list、第二空库恢复0038并升级0039；alpha.39和alpha.40时区修复前Web精确tag保留 | `RFQ TRACEABILITY DEPLOYED — UAT RFQ STILL DRAFT`；必须新授权先显式固定 Mapping，不能直接发出 |
| Node.js / PostgreSQL Supplier Mapping 治理并行 UAT | `0.1.0-alpha.39` | 功能提交 `ddab02a57e0e87255c7a35d125959ac750b108e1`；legacy Unit 修复 `1e9221d90db621becc2badf40b3e0ed3017b73e6`；运维/文档提交消息 `ops: deploy supplier mapping governance`，SHA 以 Git log 为准 | 源码与并行 PostgreSQL 均为 `0001`—`0038`；主 UAT 目标 Mapping、RFQ、Quote、Award、PO 和下游均为 0 | Unit/UI 12/12、Mapping PG 8/8、Migration 5/5、适用静态/UI/PG、npm/Python、typecheck/lint/build/credentials、隔离 Chromium 通过；purchase 主 UAT 只读通过，operations 因既有强制改密未验证 | `DEPLOYED` 到受控并行非生产 UAT；`NOT_RELEASED` 到生产 | `NOT_MIGRATED`；未创建八条主 UAT Mapping或其他业务事实 | root:root 0600 dump SHA `2d1fe44f…` 已 list/第二空库 0037 恢复和 0038 升级；原 alpha.38 与首次 alpha.39 Web 精确 tag 保留 | `SUPPLIER MAPPING GOVERNANCE DEPLOYED — MAIN UAT NOT VERIFIED`；operations 身份阻断解除并获新授权前不得开始八条 Mapping |
| Node.js / PostgreSQL Project Unit Resolution 并行 UAT | `0.1.0-alpha.37` | 功能提交 `91c0fd29d534246c55ddd669e894cdde9b774e52`；运维/文档提交消息 `ops: deploy requirement unit resolution in parallel environment`，SHA 以 Git log 为准 | 源码与并行 PostgreSQL 均为 `0001`—`0036`；主 UAT Unit Resolution/Head 与 Package/Item/Event 均为 0 | Migration 6/6、Project PG 5/5、Planning PG 10/10、静态 89/89、适用 PG 25/25、npm 3/3、typecheck/lint/build、隔离和主 UAT 只读 Chromium 通过 | `DEPLOYED` 到受控并行非生产 UAT；`NOT_RELEASED` 到生产 | `NOT_MIGRATED`；未迁移真实公司数据 | 正式 0034 停服 dump 已校验并恢复第二新空库；旧 Web 精确 tag 保留；回退恢复演练通过 | `VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED`；只解除技术阻断，不代表业务 Package 已创建 |
| Node.js / PostgreSQL alpha.34 本机灾备封存 | `0.1.0-alpha.34` / `READY_FOR_OFFHOST_COPY` | 起点 `82e9f07ce1666ace2677853408c7fb4339808cfc`；docs-only 提交后创建完整 main Bundle，最终 SHA 只记录在包内 | clean-0034 custom dump；34 migrations/checksum；205 业务表 0；三个文件卷 tar | Bundle clone、固定新空库单事务恢复、三个 tar 恢复、npm test/lint/credentials、health、SHA256SUMS 通过 | 本机 `/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z` root-only；不是生产部署 | `NOT_MIGRATED`；`offhost_copy_completed=false` | Bundle + dump + 三 tar + RESTORE/MANIFEST/SHA256SUMS；异机凭据必须重建并轮换 | `ALPHA.34 RECOVERY PACKAGE VERIFIED AND READY FOR OFFHOST COPY`；异机校验前不得称备份完成 |
| 历史 OpenAI Sites / Cloudflare D1 | 历史记录 `v3` | `2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12`；后续纳管来源 `9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9` | 仓库 D1/Drizzle `0000`—`0008`；生产实际已应用版本本任务未访问、未核验 | 仅保留历史验收记录；本任务未访问公开 Site | `HISTORICAL`；文档曾记录为公开 `v3`，本任务不重新确认在线状态；不是未来生产权威方向 | 未向 PostgreSQL 迁移 | 历史提交 `2b4f178` 和 D1 migration/快照仅作迁移与行为证据；不是已验证的当前回退方案 | 历史状态；无新的部署批准 |
| 当前 Python / SQLite 开发运行面 | `legacy-development`，尚无统一 SemVer | 本次复核起点为根仓库 `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4`；Python/systemd 路径自 `39946f6` 后无差异，常驻进程未记录启动 commit，不能反推为当前 HEAD | 本地 SQLite 历史 26 表 + migration `0001`—`0004`；开发库只读核验为 29 张非系统表并记录四个版本 | 本次重新执行 Python self-test、smoke 和临时库 go-live；结果见本节后续复核记录 | `DEVELOPMENT`；systemd `enabled/active`，源码与已安装 unit SHA-256 一致，Python 监听 `0.0.0.0:18888`；不是正式生产投用 | 真实业务未迁出；采购、库存、生产、销售、品质和财务的实际业务继续依赖本运行面 | Git 源码 + 执行前 SQLite 可恢复快照；正式回退点尚未建立 | 仅开发常驻；未获生产批准 |
| Node.js / PostgreSQL PHASE5-TASK10 并行验收基线 | `0.1.0-alpha.34` | 功能提交 `a10264020738d5ff281db9a6f7b6774df8cbb61b`；Compose/回归修正 `b4f3f5f5de30259e44d5b00a5587dee29331539f`；验收提交消息 `ops: accept supplier receipt lot iqc in parallel environment` | 源码与并行 PostgreSQL 均为 `0001`—`0034`；唯一启用管理员与原合法 Audit/Session 保留，205 个业务表/幂等/files 全 0 | TASK10 专项、适用 Procurement/Quality/TASK08/TASK09 回归、typecheck/Schema/lint/build/credentials/Python、真实 HTTP 10/8/2→10/2/8、3 件同 Lot 冲销、重启和停服备份恢复通过 | `DEPLOYED` 到 `PARALLEL HTTP ACCEPTANCE ONLY`；`NOT_RELEASED` 到生产 | `NOT_MIGRATED` | clean-0034 与接受态备份均校验；接受态第二库恢复通过，主库由 clean-0034 恢复；三份 TASK10 临时备份验收后删除，Python/SQLite 不影响 | `SUPPLIER RECEIPT LOT AND IQC RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`；停止，不自动启动后续任务/生产 |
| Node.js / PostgreSQL PHASE5-TASK09 并行验收基线 | `0.1.0-alpha.33` | 功能提交 `02dfa0d3c18c16b0e8ee07af94f11de7a0ca77e7`；验收提交消息 `ops: accept finished goods lot shipment in parallel environment` | 源码与并行 PostgreSQL 均为 `0001`—`0033`；唯一启用管理员与原合法 Audit/Session 保留，合成业务/幂等/files 已清空 | TASK09 unit/UI/PG/migration、适用回归/typecheck/Schema/lint/build/credentials/Python、真实 HTTP `{4,6,4}`/Lot `{A,B,A}`、重启和停服备份恢复通过 | `DEPLOYED` 到 `PARALLEL HTTP ACCEPTANCE ONLY`；`NOT_RELEASED` 到生产 | `NOT_MIGRATED` | clean-0033 与接受态备份均校验；接受态第二库恢复通过，主库由 clean-0033 恢复，任务备份验收后删除；Python/SQLite 不影响 | `FINISHED GOODS LOT RELEASE AND SHIPMENT ACCEPTED IN PARALLEL ENVIRONMENT`；不得自动启动 TASK10/生产 |
| Node.js / PostgreSQL TASK03 并行验收基线 | `0.1.0-alpha.17` | 功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969`；验收提交消息 `ops: accept planning material requirement workflow in parallel environment` | 源码与并行 PostgreSQL 均为 `0001`—`0017`；测试业务清理后为空 | TASK03 专项/共享回归/typecheck/lint/build/credentials/Python、真实旅程、重启与恢复清理通过 | `DEPLOYED` 到 `PARALLEL HTTP ACCEPTANCE ONLY`；`NOT_RELEASED` 到生产 | `NOT_MIGRATED` | migration 前 0016 root-only 恢复点已验证、用于成功清理并删除；Python/SQLite 不影响 | `PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`；后续 TASK04 已独立验收 |
| Node.js / PostgreSQL TASK04 并行验收基线 | `0.1.0-alpha.18` | 功能提交 `4506db2579c07080afe27b33bb2e50623c3d1366`；验收提交消息 `ops: accept procurement sourcing workflow in parallel environment` | 源码与并行 PostgreSQL 均为 `0001`—`0018`；测试业务清理后为空 | TASK04 专项、共享回归、Schema/typecheck/lint/build/credentials/Python、真实旅程、重启与恢复清理通过 | `DEPLOYED` 到 `PARALLEL HTTP ACCEPTANCE ONLY`；`NOT_RELEASED` 到生产 | `NOT_MIGRATED` | 0017 与干净 0018 root-only 恢复点已校验；干净 0018 点用于成功清理后删除 | `PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`；不授权 TASK05/生产 |
| Node.js / PostgreSQL TASK05 并行验收基线 | `0.1.0-alpha.19` | 功能提交 `859454c97acddbff8c5199d91c41d636a6ca24e0`；验收提交 `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4` | 源码与并行 PostgreSQL 均为 `0001`—`0019`；测试业务清理后为空 | TASK05 专项、TASK01—TASK04/共享回归、Schema/typecheck/lint/build/credentials/Python、三角色 HTTP 旅程、重启与备份恢复通过 | `DEPLOYED` 到 `PARALLEL HTTP ACCEPTANCE ONLY`；`NOT_RELEASED` 到生产 | `NOT_MIGRATED` | 0018 前置与干净 0019 root-only 恢复点已校验；第二新空库恢复通过，干净 0019 点用于最终清理后删除 | `SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`；不授权 TASK06/生产 |
| Node.js / PostgreSQL TASK09 并行验收基线 | `0.1.0-alpha.23` | 功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4`；验收提交消息 `ops: accept sales delivery receivable workflow in parallel environment` | 源码与并行 PostgreSQL 均为 `0001`—`0023`；唯一启用管理员，合成业务和文件已清空 | TASK09 专项、TASK01—TASK08/共享回归、17 typecheck、Schema/lint/build/credentials/Python、六角色 HTTP 4/6、重启与停服备份恢复通过 | `DEPLOYED` 到 `PARALLEL HTTP ACCEPTANCE ONLY`；`NOT_RELEASED` 到生产 | `NOT_MIGRATED` | 接受态备份恢复到新空库通过，临时恢复点验收后删除；Python/SQLite 不影响 | `FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT`；不授权收款/生产 |
| Node.js / PostgreSQL 原始自托管开发基线 | `0.1.0-alpha.1` | 功能基线 `39946f6b854a985b5c19106eaa6c938bddaf9c7c`；发布追踪提交 `12d3ea30d21cce6918de0c525d81f19af289f5ac` | PostgreSQL `0001`—`0005` | PHASE0-TASK03 的隔离 lint/test/typecheck/build/credentials、Python 三项与 diff check 通过 | `NOT_RELEASED` / `NOT_DEPLOYED`；历史开发基线，不代表当前包版本 | `NOT_MIGRATED` | Git `39946f6` + 当时 migration checksum；未建立生产恢复点 | `NOT_APPROVED_FOR_PRODUCTION`；该历史定义保留且不因后续 alpha 演进而改写 |
| 自托管生产版本 | 尚不存在 | `N/A` | `N/A` | `N/A` | `NOT_RELEASED` | `NOT_MIGRATED` | `NOT_ESTABLISHED` | `NOT_APPROVED` |

`0.1.0-alpha.1` 是 PHASE0-TASK03 建立的原始非生产发布基线，不是当前包版本。当前源码和并行非生产 UAT 已演进到 `0.1.0-alpha.40`/`0039`；既有部门交接、Manufacturing Batch、Finished Goods Lot/FQC/Shipment、Supplier Receipt Lot→IQC、Project Unit Resolution、Revision Response 和 Supplier Mapping 治理事实保持，并新增 RFQ 精确 Mapping 绑定、创建/发出凭证、Quote/Award追溯、Award→PO权威预览/最终确认门禁以及沿固定Binding复用的逐行Mapping资格合同。这只证明非生产链路和升级恢复门禁成立，不表示真实公司数据已迁移或已批准生产上线。

Git 同步状态以2026-08-08 FIX33严格起点计：唯一worktree、clean`main@79ac7fae76fdb69286a16f0bbd9551d41598cd57`、Parent`a4ffb8ee022234ea25add4ce636050366ac6887a`、behind0/ahead169；功能提交`1f205af0bf81379345a09353d9d32ab5c7545971`后ahead170，独立运维/文档收口后ahead171，均未推送。最终状态以`git status --short --branch`为准。

## 3. Migration 文件与 SHA-256 基线

当前源码与并行非生产 UAT head：`0039_rfq_traceability.sql`，SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。FIX-22 已确认 `0001`—`0038` 相对严格起点无差异，0038 SHA-256 仍为 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`；完整运行库 checksum 与文件一致。下表保留历史值并追加 0039。

### PostgreSQL 自托管

| 版本 | 文件 | SHA-256 |
| --- | --- | --- |
| `0001` | `0001_selfhost_baseline.sql` | `c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702` |
| `0002` | `0002_material_master_workflow.sql` | `2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80` |
| `0003` | `0003_material_import_mapping.sql` | `8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf` |
| `0004` | `0004_material_import_normalization.sql` | `1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39` |
| `0005` | `0005_material_import_review.sql` | `e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc` |
| `0006` | `0006_identity_security.sql` | `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079` |
| `0007` | `0007_master_data_bom.sql` | `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6` |
| `0008` | `0008_inventory_ledger.sql` | `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b` |
| `0009` | `0009_procurement.sql` | `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7` |
| `0010` | `0010_production.sql` | `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35` |
| `0011` | `0011_sales.sql` | `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b` |
| `0012` | `0012_quality.sql` | `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf` |
| `0013` | `0013_finance.sql` | `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1` |
| `0014` | `0014_migration_openings.sql` | `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b` |
| `0015` | `0015_market_project_handoff.sql` | `419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f` |
| `0016` | `0016_project_planning_handoff.sql` | `26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076` |
| `0017` | `0017_planning_material_requirements.sql` | `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28` |
| `0018` | `0018_procurement_sourcing.sql` | `64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9` |
| `0019` | `0019_sourcing_purchase_fulfillment.sql` | `6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a` |
| `0020` | `0020_production_handoff_reservations.sql` | `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182` |
| `0021` | `0021_production_reporting_completions.sql` | `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec` |
| `0022` | `0022_production_quality_release.sql` | `65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155` |
| `0023` | `0023_sales_delivery_receivable.sql` | `5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d` |
| `0024` | `0024_finance_project_settlements.sql` | `cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624` |
| `0025` | `0025_production_routings.sql` | `39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9` |
| `0026` | `0026_production_operation_execution.sql` | `b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0` |
| `0027` | `0027_production_final_output_reporting.sql` | `b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76` |
| `0028` | `0028_production_operation_quality_gates.sql` | `a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912` |
| `0029` | `0029_production_nonconformance_rework_handoff.sql` | `6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c` |
| `0030` | `0030_production_rework_execution.sql` | `37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c` |
| `0031` | `0031_production_batch_genealogy.sql` | `ac0f6a63cfdb30d42edf50741afc7c8af632f74ff6fb08398d6b6e398a637fd4` |
| `0032` | `0032_finished_goods_inventory_lots.sql` | `3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa` |
| `0033` | `0033_finished_goods_lot_fqc_shipment.sql` | `ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44` |
| `0034` | `0034_supplier_receipt_lot_iqc.sql` | `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d` |
| `0035` | `0035_bom_material_governance.sql` | `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714` |
| `0036` | `0036_project_requirement_unit_resolution.sql` | `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0` |
| `0037` | `0037_project_planning_revision_response_lineage.sql` | `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f` |
| `0038` | `0038_supplier_mapping_governance.sql` | `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941` |
| `0039` | `0039_rfq_traceability.sql` | `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37` |

当前源码与并行 PostgreSQL 均为 `0001 -> 0039`；0038→0039 已通过隔离升级、重复执行、失败回滚、第二空库恢复和并行非生产 UAT 串行部署验收。没有生产 PostgreSQL 部署或真实公司数据迁移。

### 历史 Cloudflare D1 / Drizzle

| 版本 | 文件 | SHA-256 |
| --- | --- | --- |
| `0000` | `0000_far_nightmare.sql` | `450a8d0885b502d702a89fcbac4ec2e69a2c49ebeaf8ba9aa4012c92231687e9` |
| `0001` | `0001_material_master_v2.sql` | `a3e39a14a5db0b0b5c5571edb403ac6b8922b17c3e4ec3d0b36fb2ca5694adf5` |
| `0002` | `0002_material_draft_review_api.sql` | `4f791e50494cf728e57e9dbc7cdfadef0b783505d233b02c87a9a5a37cacd453` |
| `0003` | `0003_material_draft_lifecycle.sql` | `6b3f4b9a7ed96cf94a068f0eeaa6fba00e5b6898b03920353422a7a014f49f70` |
| `0004` | `0004_material_import_batch_foundation.sql` | `94c35749e5d891be97087b079214f1663c03e0c5fabf1517227e7a29235146f5` |
| `0005` | `0005_material_import_parser_mapping.sql` | `461de1f8a93e92de34f2c373d941295cdaf9819adba2de6db172021debc33608` |
| `0006` | `0006_material_import_normalization.sql` | `59c1b8af56cecd0cbae588d4391b36f8f6d92143f6ca686c3768b15d8a36a8bb` |
| `0007` | `0007_material_library.sql` | `f03f7f6d42dd0655f5f92563e116ae0fce65586d4375b46e41f46b1df2427651` |
| `0008` | `0008_supplier_adaptive_import.sql` | `48c4668465462221622c6c16790d4a1618e16a53296c798c7cd1bc38f0fc96a5` |

这些是仓库文件校验和，不代表生产 D1 已应用。生产 D1 本任务未访问。

### Python / SQLite 本地增量

| 版本 | 文件 | SHA-256 | 当前开发库只读记录 |
| --- | --- | --- | --- |
| `0001` | `0001_material_import_source_lineage.sql` | `e6d0de8ff17b84d340912900028f80b2fda1004886f2b9a09e4648cc0e632b6f` | 已记录 |
| `0002` | `0002_material_import_file_archive.sql` | `f0c326b71e339b92a0a41b07bc19e67f11c12db82fda4bf6f70ed7d5cd9999c7` | 已记录 |
| `0003` | `0003_cleaning_structured_specification.sql` | `fc4ca25ba134d0c283bc95a667295c46a03d9cb8cc151963cd883d3ab02a49ff` | 已记录 |
| `0004` | `0004_cleaning_general_spec_tokens.sql` | `1eaee7cc6142c7139ea7d63578be34880d922b9ee21fb48f19ac66e13d0bc930` | 已记录 |

SQLite 的 `local_schema_migrations` 只保存版本和应用时间，不保存 checksum；上表 SHA-256 是本任务建立的仓库文件基线，不能冒充数据库内校验记录。历史 26 表仍缺少完整版本化建库迁移。

## 4. 发布验收模板

复制本节建立新发布记录，所有项必须填写 `PASS`、`FAIL`、`N/A` 或 `NOT_RUN`，并附证据位置。

### 发布身份

| 项目 | 结果 |
| --- | --- |
| 发布版本 |  |
| Git commit / tag |  |
| 包名与 package version |  |
| 目标运行面与环境 |  |
| 变更范围 / 排除范围 |  |
| 数据库 migration 前版本 |  |
| 数据库 migration 后版本 |  |
| Migration 文件 SHA-256 已核对 |  |

### 快照、迁移与数据核对

| 验收项 | 结果 | 证据/说明 |
| --- | --- | --- |
| PostgreSQL 快照、uploads、attachments 恢复点已创建并异地保存 |  |  |
| 现运行 SQLite/D1 的只读快照或受控导出已创建 |  |  |
| 空库 migration |  |  |
| 已有数据升级 |  |  |
| Migration 重复执行 |  |  |
| Migration 失败回滚 |  |  |
| 真实数据试迁移 |  |  |
| 用户/分类/物料/版本/重复/孤儿引用核对 |  |  |
| BOM/采购/库存/生产/销售/品质/财务数量与金额核对 |  |  |
| 文件数量、大小、SHA-256 与数据库引用核对 |  |  |
| 正式迁移逐行结果、异常和人工处置已归档 |  |  |

### 应用、运维与人工验收

| 验收项 | 结果 | 证据/说明 |
| --- | --- | --- |
| lint |  |  |
| build |  |  |
| 单元测试 |  |  |
| 集成测试 |  |  |
| Compose 空卷启动 |  |  |
| Compose 重启持久性 |  |  |
| 人工业务验收 |  |  |
| 权限矩阵与职责分离 |  |  |
| CSRF、幂等、并发、限流和审计 |  |  |
| 默认/弱口令检查与凭证扫描 |  |  |
| HTTPS、Cookie、反向代理和防火墙 |  |  |
| 备份生成与异故障域复制 |  |  |
| 空目标恢复演练与 RPO/RTO |  |  |
| 容量、并发、磁盘、内存和队列积压 |  |  |
| 监控、日志轮转和告警 |  |  |

### 批准与执行

| 项目 | 记录 |
| --- | --- |
| 部署批准人 |  |
| 数据迁移批准人 |  |
| 执行人 |  |
| 计划开始/结束时间 |  |
| 实际开始/结束时间 |  |
| 维护窗口和用户通知 |  |
| 放量/流量切换方式 |  |
| 回退观察窗口 |  |
| 最终批准状态 |  |

## 5. 回退模板

| 项目 | 记录 |
| --- | --- |
| 回退目标 Git commit / 镜像摘要 |  |
| 回退前数据库 migration |  |
| 回退后数据库 migration |  |
| 数据库恢复点与 checksum |  |
| uploads/attachments 恢复点与 checksum |  |
| 旧运行面保留方式与可用性证据 |  |
| 触发条件：健康检查/错误率/数据核对/容量/安全 |  |
| 最晚决策时间 |  |
| 回退批准人 / 执行人 |  |
| 停止写入和隔离失败版本步骤 |  |
| 数据库恢复或前向修复步骤 |  |
| 文件恢复与引用核对步骤 |  |
| 恢复旧 Web/Worker/定时任务步骤 |  |
| 回退后 smoke、人工业务和数据核对 |  |
| 用户通知、审计和事故记录 |  |

数据库回退默认使用“恢复到新空目标并切换”，不得对已过账业务原地逆向改写。Migration Down 只有在明确证明无业务数据、约束允许且有批准时才可使用；否则使用快照恢复或新增前向修复 migration。

## 5.1 `0.1.0-alpha.37` Project Requirement Unit Resolution 并行 UAT 部署记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.37` |
| 状态 | `DEPLOYED TO PARALLEL NON-PRODUCTION UAT` / `NOT_RELEASED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| Git | 起点 `d06b44f5958527707f38e4c12f0d3143ce31875b`，Parent `525ad2907287d736ecd40d3df24b77c6c5be8ff4`；功能 `91c0fd29d534246c55ddd669e894cdde9b774e52`；ops 提交以 Git log 为准；未 push/PR |
| PostgreSQL | 只新增 `0036_project_requirement_unit_resolution.sql`，SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`；0035 SHA 保持 `d64ec733...9714`，0001—0035 汇总保持 `504ba2fd...11c0`；最终主库 36/head 0036 |
| 功能 | 追加式 Requirement Unit Resolution Version、每 Requirement Item 独立 CAS Head、稳定 Unit FK、受控来源类型、Package Item 精确 provenance；正式 API 执行 Session/Origin/CSRF/权限/幂等/CAS/Audit/故障回滚；UI 不预选 Unit 并分别显示 Product/BOM 与 Unit 完整性 |
| 隔离验收 | 空库 0001→0036、0035→0036、真实 0034 备份的 0035→0036、重放、失败回滚、约束、回退恢复和 390px Chromium 完整生成/退回/修订/重提/接收旅程通过；所有写入均为合成隔离数据 |
| 正式备份/恢复 | root:root 0600 custom dump，SHA-256 `75e1ffbf2ea846761ece1d4c73dea96e871eca5fcde86d28f24782b10f862df7`；`pg_restore --list` 与第二新空数据库 34/head 0034 及保护事实恢复核对通过；备份保留 |
| 部署 | 暂停 Web/Worker 写入后串行应用 0035、0036；Web `sha256:7e0a3040acd172...→sha256:6667bd2ca64e...`，旧镜像精确回退 tag 保留。Worker 因无共享代码依赖保持 `sha256:32d1ae335610...`，Caddy 不重建，PostgreSQL Volume 与 Origin/端口不变 |
| UAT 保护 | `PRJ-00000001` ACCEPTED/10；Requirement Item 1 仍 NULL/pending；Product/BOM Resolution 仍 7/7/7/7；Unit Resolution/Head `0/0`，Package/Item/Event/待接收 `0/0/0/0`；保护指纹 `fb71309bf73dce907f0bcb2e294d1b31` 前后相同 |
| 批准结论 | `VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED`；可在后续独立任务恢复 engineering 黑盒续测，不授权生产或自动创建 Package |

## 5.2 `0.1.0-alpha.34` Supplier Receipt Lot/IQC 并行验收记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE5-TASK10` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.34` |
| 状态 | `PARALLEL HTTP ACCEPTANCE ONLY` / `NOT_RELEASED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| Git | 起点 `55f8fe9693ebc0f630920e92eca1f74584d852af`；功能 `a10264020738d5ff281db9a6f7b6774df8cbb61b`；Compose/回归 `b4f3f5f5de30259e44d5b00a5587dee29331539f`；ops 提交以 Git log 为准；全部未 push |
| PostgreSQL | 只新增 `0034_supplier_receipt_lot_iqc.sql`，SHA-256 `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`；最终主库 clean-0034 |
| 功能 | Supplier Receipt RML Lot、收货即 frozen、IQC passed 范围 RELEASE、failed/HOLD 隔离、Lot genealogy、无下游整单原 Lot 冲销；生产领料 Lot 明确排除 |
| 验收 | 真实 HTTP 从 Project/Planning/Purchase Request 贯通两条业务链；主链 10/8/2→10/2/8、Source 120、AP/领料 0；3 件支线 REVERSED；已有 IQC 冲销 409；重启、第二库恢复、专项与适用回归、双 build、Python 临时 SQLite 通过 |
| 恢复 | clean-0034 SHA `44e064442eac5af0df56abf54989dd75a9fe6d39a030427439cf4996c9889c25`；最终完整 HTTP 接受态 SHA `e4548ed8b264b078a34c7856c1338d5fb6ce712158d0453dc018945b5e27b791` 在固定第二库验证后删除临时库；主库恢复原 Audit/Session 与空业务基线 |
| 批准结论 | `SUPPLIER RECEIPT LOT AND IQC RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`；不构成生产发布或后续任务授权 |

## 6. PHASE0-TASK03 验收记录

| 项目 | 结果 |
| --- | --- |
| 核验时功能基线 | `39946f6b854a985b5c19106eaa6c938bddaf9c7c`，`main` 与远端 `origin/main` 均指向该提交 |
| 初始工作区 | clean；仓库中只有根 `.git`，不存在嵌套仓库 |
| 运行面 | Python/SQLite systemd 开发服务 `enabled/active`，`0.0.0.0:18888`；无运行中 Compose 项目 |
| PostgreSQL migration | `0001`—`0005`，SHA-256 与第 3 节一致 |
| D1 migration | 历史 `0000`—`0008`，仅核验仓库文件；未访问生产 D1 |
| SQLite migration | `0001`—`0004`；本地开发库只读记录四个版本，runner 不保存 checksum |
| 测试 | PASS：lint 0 error/1 既有 warning；`npm test` 3/3；review typecheck；Vinext build 5/5；凭证扫描 455 文件；Python self-test、smoke、临时 SQLite go-live；`git diff --check` |
| 部署/生产访问 | 未部署、未重启服务、未迁移真实数据、未访问公开生产 Site 或生产数据库 |

补充说明：宿主机没有 Node/npm，Node 命令在一次性 `node:22-bookworm` 容器中执行。Python 首轮误用系统解释器时 self-test 通过、smoke 在导入 `openpyxl` 前因环境缺依赖停止；改用常驻服务实际使用的 `/opt/erp/.venv/bin/python` 后三项全部通过，没有降低断言。TASK09 Compose build 的 `npm ci` 报告 13 个既有依赖审计项（1 low、4 moderate、8 high），本任务按范围不升级依赖，留待独立安全任务。

### 6.A PHASE0-TASK03 后续发布基线复核（2026-07-26）

本节只追加当前事实，不改写上表 2026-07-24 原始验收状态。

| 项目 | 复核结果 |
| --- | --- |
| Git 起点 | `main` / `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4`；起始工作区 clean；远端 `main` 为 `39946f6`，本地领先 27 个提交 |
| 包 | `chenyida-erp-selfhosted@0.1.0-alpha.19`；package-lock 根包一致；未降级、未升级依赖；原始 `0.1.0-alpha.1` 定义保留为历史基线 |
| PostgreSQL | 仓库与回环并行 PostgreSQL 的 `schema_migrations` 均为 `0001`—`0019`，19 个 checksum 与本文件一致 |
| D1 / SQLite | D1 仓库仍为 `0000`—`0008`，未访问生产 D1；SQLite 仓库与只读 `local_schema_migrations` 仍为 `0001`—`0004` |
| 运行面 | Python systemd `enabled/active`、`0.0.0.0:18888`；并行 Compose PostgreSQL/Web/Worker 运行，Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口 |
| 业务迁移 | Node 已有完整 ERP API 的非生产实现和合成/并行验收，但真实业务数据、账号和文件未迁移；采购、库存、生产、销售、品质、财务的实际业务仍依赖 Python/SQLite |
| 验证 | PASS：Node lint 0 error/5 个既有 warning、test 3/3、review typecheck、Vinext build 5/5、凭证扫描 819 文件；Python self-test、smoke、临时 SQLite go-live；`git diff --check`。凭证扫描首次因容器只挂载子目录而无法识别 Git 工作区，改为只读挂载完整仓库后通过；未降低断言。任何隔离 PASS 均不转换为生产上线结论 |
| 生产影响 | 未访问公开生产 Site、生产 D1 或生产数据库；未部署、未执行 migration、未迁移真实数据、未重启服务、未创建云资源 |

## 6.3 `0.1.0-alpha.18` 采购询比价与人工定标并行验收记录

| 项目 | 当前记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE4-TASK04` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.18` |
| 功能提交 | `4506db2579c07080afe27b33bb2e50623c3d1366`；父提交 `5cf525a1b2733954a9d658c2582565e364770b23` |
| 数据库 | expand-only `0018_procurement_sourcing.sql`；SHA-256 `64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9`；旧 migrations 不修改 |
| 功能 | 最新 ACCEPTED PR→RFQ Round→不可变 Quote Version→服务端分组确定性 Comparison→人工 Sourcing Award/撤销；9 组 API、两条原生 UI、Dashboard 三项待办 |
| 隔离验证 | TASK04 unit/UI 6/6、PG/API 2/2、migration 3/3；共享 Identity/Supplier Mapping/Master/Procurement/Project/Planning/Material Requirement/Dashboard/FileStorage/API coverage/environment、Schema/typecheck/lint/build/credentials/Python 基线通过 |
| 部署 | `DEPLOYED` 仅限 `PARALLEL HTTP ACCEPTANCE ONLY`；只应用 0018，独立 ops 提交记录实际旅程、重启与恢复清理 |
| 排除 | PO、到货、Receipt、Inventory/AP、生产、真实迁移、HTTPS、公网、切流、TASK05、push/PR |

并行实际结果：临时 planning/purchase 账号完成 must-change、只读/写权限和真实 HTTP；A `12.000000`、准时、排名 2，B `10.000000`、晚交、排名 1，以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”选择 A。Award=1 时 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 不变。Compose 重启后事实持久，随后恢复干净 0018 点，最终 18 migrations、唯一管理员且业务为 0。结论为 `PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`。

## 6.2 `0.1.0-alpha.17` 计划物料需求到采购申请并行验收记录

| 项目 | 当前记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE4-TASK03` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.17` |
| 功能提交 | `5009b9118901a01af6a5faed194b8444d0c1e969`；父提交 `5557d2eee98dd3e1b47c57e1643f21c5ae599175` |
| 数据库 | expand-only `0017_planning_material_requirements.sql`；SHA-256 `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28`；旧 migrations 不修改 |
| 功能 | 固化 Material+Unit 聚合、SUBMIT 锁定重算、独立库存/在途分配、不可变需求计划/PRQ、planning/purchase UI、Dashboard 待办 |
| 隔离验证 | TASK03 unit/UI 6/6、PG/API 3/3、migration 3/3；TASK02、Dashboard、manifest、FileStorage、typecheck/lint/build/credentials/Python 基线通过 |
| 部署 | `DEPLOYED` 仅限 `PARALLEL HTTP ACCEPTANCE ONLY`；只应用 0017，独立 ops 提交记录实际旅程、重启与恢复清理 |
| 排除 | RFQ、供应商选择/报价/比价、PO、收货、生产、真实迁移、HTTPS、公网、切流、TASK04、push/PR |

并行实际结果：临时 planning/purchase 账号完成 `100.000000 - 55.000000 - 40.000000 = 5.000000` 的 v1 提交/采购退回释放、v2 重算重提和最终接收；正式 `reserved_qty` 保持 `10.000000`，新增 PO/Receipt/WO 均为 0。Compose 重启后 v2 Plan/PR ACCEPTED，随后恢复干净 0016 点并重新应用 0017，最终 17 migrations、唯一管理员且业务为 0。结论为 `PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。

## 6.1 `0.1.0-alpha.16` 项目到计划交接并行验收记录

| 项目 | 当前记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE4-TASK02` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.16` |
| 功能提交 | `9236884f6cd96385c9c7050b29f57e7268142208`；父提交 `0e380d0ae61655c59a27fcf0d3e70e51deb53a9b` |
| 数据库 | expand-only `0016_project_planning_handoff.sql`；SHA-256 `26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076`；旧 migrations 不修改 |
| 功能 | planning 角色、Requirement Resolution、不可变版本包/BOM/文件快照、事件、8 API、engineering/planning 原生 UI、Dashboard 待办 |
| 隔离验证 | unit/UI 6/6、PG/API 3/3、migration 3/3；共享 unit/UI 31/31、PG/API 21/21、migration 10/10、Dashboard 10/10、manifest 8/8；Schema/typecheck/lint/build/credentials/Python 基线通过 |
| 部署 | `DEPLOYED` 仅限 `PARALLEL HTTP ACCEPTANCE ONLY`；只应用 0016，独立 ops 提交记录实际旅程、重启与清理 |
| 排除 | 净需求、物料需求、采购申请/订单、生产、TASK03、真实迁移、HTTPS、公网、切流、push/PR |

并行实际结果：临时 sales/engineering/planning 账号完成项目接收、需求显式解析、v1 提交、计划退回、项目修订生成 v2、重提和最终接收；BOM 快照 numeric 毛数量为 `34.375000`，事件序列完整。Compose 重启后数据库、已接收队列 API 与两条页面保持，随后恢复干净 0016 点，最终 16 migrations、唯一管理员且全部合成业务为 0。结论为 `PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

## 6.0 `0.1.0-alpha.15` 市场到项目交接开发记录

| 项目 | 值 |
| --- | --- |
| 任务 | `SELFHOST-PHASE4-TASK01` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.15` |
| 父提交 | `0f15f271cc458343116cb6639f0d118eea37521b`；功能提交消息 `feat: add market project handoff workflow` |
| 数据库 | expand-only `0015_market_project_handoff.sql`；SHA-256 `419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f`；旧 migrations 不修改 |
| 功能 | sales 市场草稿/不可变修订/提交，engineering 队列/退回/接收，稳定 Project、受控文件引用、不可变 Handoff Event 和两条原生页面 |
| 验收 | unit/UI、隔离 PG/API、空库与 0014 upgrade、重复/回滚、并发/幂等/CAS/故障、共享 Identity/Master/Sales、typecheck/lint/build/credentials/Python 临时基线通过 |
| 发布 | `DEPLOYED` 仅限 `PARALLEL HTTP ACCEPTANCE ONLY`；未正式 release/push；双账号、重启和清理已验收 |
| 排除 | 真实数据、Product/BOM/计划/采购/生产自动创建、HTTPS、公网、切流、TASK02、push/PR |

并行实际结果：两个独立 sales/engineering 账号完成直接接收及退回→需求 v2→重提→最终接收；重启后事实与 Audit 持久。随后恢复 0015 空数据点，最终唯一管理员保留且 Project/Event/Customer/临时账号为 0。结论为 `MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

## 6.1 SELFHOST-PHASE3-TASK05 并行 HTTP 验收部署记录

| 项目 | 值 |
| --- | --- |
| 任务 | `SELFHOST-PHASE3-TASK05` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.14`，保持不变 |
| 父提交 | `7c39ff9b2c50786a225fe788ec5e3b6fb9f91dc2`；独立提交消息 `ops: deploy parallel self-hosted acceptance environment` |
| 环境 | `chenyida-erp-parallel`；`ERP_ENV=development`；`PARALLEL HTTP ACCEPTANCE ONLY` |
| 网络 | Web 仅 `127.0.0.1:3000`；PostgreSQL 无宿主端口；Caddy、80/443、DNS、防火墙均未启用或修改 |
| 数据库 | PostgreSQL 17.10；空环境 `0001`—`0014` 共 14 个 migration；未创建 `0015`、未迁真实数据 |
| 身份 | 唯一管理员 `admin`；重复初始化为 `SETUP_COMPLETE`；setup token 已轮换；临时密码只在 root-only 凭据文件 |
| 验收 | compose config、健康、login/session/logout、根工作台、空 Dashboard、23 GET、完整重启持久性、资源与 Python/SQLite 不变核对通过 |
| 缺陷修复 | PostgreSQL 重启的 Worker 空闲 Pool `57P01` 改为去敏记录并轮询重试；专项 2/2、typecheck、lint、build 和只重启 PostgreSQL 的进程连续性通过 |
| 部署状态 | `DEPLOYED` 仅指同机并行 HTTP 验收；不是 `RELEASED` 或 production |
| 排除 | 未迁真实数据、未双写、未切流、未启 HTTPS、未访问 D1/远程数据库、未修改 Python systemd/SQLite、未 push/PR |

结论严格为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`。

## 7. `0.1.0-alpha.14` 非生产开发记录

| 项目 | 值 |
| --- | --- |
| 任务 | `SELFHOST-PHASE3-TASK04` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.14` |
| 起点 | `a541360eefe12869c090b2408bbcf07485fc77cb` |
| 数据库 | PostgreSQL `0001`—`0014` checksum 不变，未创建 `0015`；真实 SQLite 仅做一致性只读快照与脱敏聚合 |
| 验收 | 29 表/3,619 条聚合、target NONE、源/PID 不变、快照删除；专项、PG/API、upgrade、backup/restore、build/lint/typecheck 和 Python 基线通过 |
| 发布 | `NOT_RELEASED`；未 push、PR、部署或切流 |
| 结论 | `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`；真实 PostgreSQL 试迁移、D1/附件盘点与生产仍 NO-GO |

## 8. `0.1.0-alpha.13` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE3-TASK03` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.13` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `8f30798464476b53f435d53022c45ed731804e95`；`main`，TASK02 最终 HEAD 且工作区 clean |
| PostgreSQL | 不新增 migration；`0001`—`0014` checksum 保持不变；`migration_tool` 临时 schema 保存 actual public ID/provenance/checkpoint，不成为业务权威 |
| 功能 | 受控 public materializer、snapshot/archive 分类、actual ID/target digest、文件原子写、正常全域 Service/API、Dashboard 和恢复核对 |
| 验收 | tool/materializer/opening 专项、TASK02—TASK10 unit/UI、全部 PG/API 与 migration upgrade、8 组 typecheck、Schema consistency、lint/build/environment/credentials、Compose 全域旅程、backup→新空目标 restore、同 manifest replay、整栈重启及 Python 三项通过 |
| 排除 | 真实 source inventory、真实账号/文件/历史活动、逐行人工处置、容量/RPO/RTO、安全、生产恢复、部署和切换 |
| 生产访问 | 未打开现运行面数据库或真实备份/附件；未访问生产、重启 Python、部署、push 或建 PR |

结论仅为 `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`；真实数据和生产为 `NO-GO FOR REAL DATA / PRODUCTION`。

## 9. `0.1.0-alpha.12` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE3-TASK02` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.12` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `2c808f7a2ba2c293ff22e5dcc3ca3647a479a91c`；`main`，TASK01 最终 HEAD 且工作区 clean |
| PostgreSQL | 新增 expand-only `0014_migration_openings.sql`；SHA-256 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`；`0001`—`0013` checksum 保持不变 |
| 功能 | digest-bound Opening command、内部事务 Service、库存期初 Ledger/Balance、Finance `OPENING_AR/AP`、一次全额冲销、审计/幂等和 Dashboard 汇总 |
| 验收 | 专项 unit 3/3、PG 2/2、migration 3/3；既有 PG/API 42/42、Material/Mapping/Normalization/Review 20/20、upgrade 30/30；typecheck/build/lint/credentials、Compose restart、停服 backup/verify/新空库 restore 与 Python 三项通过 |
| 排除 | 真实 source inventory、真实试迁移、其他业务域物化、身份/文件迁移、容量/RPO/RTO、生产恢复、部署和切换 |
| 生产访问 | 未打开现运行面数据库或真实备份/附件；未访问生产、重启 Python、部署、push 或建 PR |

MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。这不是发布公告；真实数据和生产结论为 `NO-GO FOR REAL DATA / PRODUCTION`。

## 10. `0.1.0-alpha.11` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE3-TASK01` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.11` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `14bc68791a34ece9086b889f23d473e84a761cf0`；`main`，TASK10 最终 HEAD 且工作区 clean |
| PostgreSQL | 不新增 migration；`0001`—`0013` checksum 保持不变；staging 仅存在于临时测试库 `migration_tool` schema |
| 功能 | 显式 CLI、SQLite/D1 export adapter、真实路径/生产拒绝、manifest、mapping registry、稳定 ID、checkpoint、dry-run、synthetic commit、reconcile 和去敏报告 |
| 验收 | 迁移 tool 8/8、PG E2E 1/1、非数据库 87/87、PG/API 67/67、upgrade 27/27、typecheck 8/8、build/lint/credentials、backup/restore、Compose restart 与 Python 三项通过 |
| 排除 | 真实 source inventory、业务表物化、真实 Dashboard 核对、文件迁移、容量/RPO/RTO、生产恢复、部署和切换 |
| 生产访问 | 未打开现运行面数据库或真实备份/附件；未访问生产、重启 Python、部署、push 或建 PR |

这是一条合成迁移准备度记录，不是发布公告。真实数据和生产结论保持 NO-GO。

## 11. `0.1.0-alpha.10` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK10` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.10` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `06a4413403869f4f41872c7a5cb98c434a44f095`；`main`，TASK09 已提交且工作区 clean |
| PostgreSQL | 不新增 migration；`0001`—`0013` checksum 保持不变 |
| 功能 | 实时权限裁剪 Dashboard、原生根工作台、显式 legacy 深链、离线 backup/verify/新空目标 restore 与去敏只读治理状态 |
| 验收 | 非数据库 selfhost 87/87、PostgreSQL/API 67/67、migration upgrade 27/27、environment 6/6、TASK03—TASK10 typecheck、64 项/23 GET、TASK02→TASK10 同库全域旅程、隔离 backup→第二个新空 Compose restore、PG/Web/Worker 重启、文件 SHA、build/lint/credentials 与 Python 三项通过 |
| 排除 | 真实数据试迁移、生产备份恢复、跨故障域保留、容量/RPO/RTO、安全上线、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。后续任何真实数据或生产任务必须重新取得明确授权。

## 12. `0.1.0-alpha.9` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK09` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.9` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `ee3e6585d5f0366187f62ef3f6012c3abaf28150`；`main`，TASK08 已提交且工作区 clean |
| PostgreSQL | 新增 expand-only `0013_finance.sql`；SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1`；`0001`—`0012` checksum 保持不变 |
| 功能 | 独立 Finance Repository/Service/Handler；稳定 Shipment/Receipt 来源 AR/AP、不可变 Settlement/Reversal/Event、余额投影和上游冲销门禁 |
| 验收 | unit/UI 4/4、Finance PostgreSQL/API 3/3、migration 3/3、Procurement 7/7、Sales 3/3、Quality 8/8、Compose 初始/重启及全部适用回归通过 |
| 排除 | 真实金额/用户/业务数据、银行/支付网关、税务、发票、外币/汇率、信用、关账、总账、自动过账、多单核销、付款审批、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK10 必须从本任务独立提交和 clean 工作区开始。

## 13. `0.1.0-alpha.8` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK08` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.8` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `0ad0687a7b2f2502f68babbef1455df2a983421b`；`main`，TASK07 已提交且工作区 clean |
| PostgreSQL | 新增 expand-only `0012_quality.sql`；SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`；`0001`—`0011` checksum 保持不变 |
| 功能 | 独立 Quality Repository/Service/Handler；稳定 IQC/IPQC/FQC 来源、不可变 Result/Defect/Event、异人处置/关闭/重开及 FQC 发货额度门禁 |
| 验收 | unit/UI 5/5、Quality PostgreSQL/API 8/8、migration 3/3、Sales 3/3、Compose 初始/重启及全部适用回归通过 |
| 排除 | 真实检验/库存/生产/销售数据、批次/隔离库位、AQL/SPC、实验室仪器、自动退供/报废、返工工艺、完整财务、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK09 必须从本任务独立提交和 clean 工作区开始。

## 14. `0.1.0-alpha.7` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK07` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.7` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`；`main`，恢复的 dirty 全部为合法 TASK07 成果 |
| PostgreSQL | 新增 expand-only `0011_sales.sql`；SHA-256 `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`；`0001`—`0010` checksum 保持不变 |
| 功能 | 独立 Sales Repository/Service/Handler；报价版本/状态、ACCEPTED 原子转单、SO、Shipment/全额冲销、金额来源及 TASK04 库存同事务复用 |
| 验收 | unit/UI 5/5、PostgreSQL/API 3/3、migration 3/3、Schema consistency、Compose 初始/重启及全量适用回归通过 |
| 排除 | 真实 Quote/SO/Shipment/库存/金额、税/折扣/汇率、销售审批、退货/换货/部分冲销、FQC、完整 AR/收款/GL、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK08 必须从本任务独立提交和 clean 工作区开始。

## 15. `0.1.0-alpha.6` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK06` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.6` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`；`main`，工作区 clean，本地领先 `origin/main` 6 个提交 |
| PostgreSQL | 新增 expand-only `0010_production.sql`；SHA-256 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`；`0001`—`0009` checksum 保持不变 |
| 功能 | 独立 Production Repository/Service/Handler；WO/BOM 快照/需求、领退料、报工、完工及 TASK04 库存同事务复用 |
| 验收 | unit/UI 4/4、PostgreSQL/API 5/5、migration 3/3、Schema consistency、Compose 初始/重启及全量适用回归通过 |
| 排除 | 真实生产数据、MRP/排程、设备/工时/成本、WIP/批次/单位换算、品质/财务过账、销售、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK07 必须从本任务独立提交和 clean 工作区开始。

## 16. `0.1.0-alpha.5` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK05` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.5` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`；`main`，恢复的 dirty 全部为合法 TASK05 成果 |
| PostgreSQL | 新增 expand-only `0009_procurement.sql`；SHA-256 `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7`；`0001`—`0008` checksum 保持不变 |
| 功能 | 独立 Procurement Repository/Service/Handler；PO/Receipt/状态事件/财务来源、缺料建议、部分/全部收货、全额冲销及 TASK04 库存同事务复用 |
| 验收 | unit/UI 5/5、PostgreSQL/API 7/7、migration 3/3、Schema consistency、Compose 初始/重启及全量适用回归通过 |
| 排除 | 真实 PO/在途/库存、审批/取消、部分冲销、超收、单位换算、完整 AP/付款/GL、生产、销售、品质、Dashboard、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK06 必须从本任务独立提交和 clean 工作区开始。

## 17. `0.1.0-alpha.4` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK04` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.4` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `3565d56f24ca904dd0b8d0c55960c702a8895406`；`main`，工作区 clean，本地领先 `origin/main` 4 个提交 |
| PostgreSQL | 新增 expand-only `0008_inventory_ledger.sql`；SHA-256 `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`；`0001`—`0007` checksum 保持不变 |
| 功能 | 独立 Inventory Repository/Service/Handler；稳定 ID、不可变 Ledger、余额投影、通用入/出/盘点、冻结/解冻、全额冲销与 reconciliation |
| 验收 | unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3、Compose 初始/重启及适用回归通过；旧导入 UI 未改文件 6 条起点既有源码正则断言单列为债务 |
| 排除 | PO/收货、WO/领料/完工、SO/发货、品质/财务、旧库存回填、真实数据、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK05 必须从本任务独立提交和 clean 工作区开始。

## 18. `0.1.0-alpha.3` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK03` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.3` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`；`main`，工作区 clean，本地领先 `origin/main` 3 个提交 |
| PostgreSQL | 新增 expand-only `0007_master_data_bom.sql`；SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`；`0001`—`0006` checksum 保持不变 |
| 功能 | 独立 Master Data/BOM Repository/Service/Handler；关系化 Customer/Supplier/Product/Version/BOM Header/Version/Line、Supplier Mapping/价格历史、发布不可变、结构 readiness 与 ACTIVE Material 投影 |
| 验收 | TASK03 unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration 3/3；Compose 空库 E2E 与 Web/PostgreSQL 重启通过；Identity/Material/Mapping/Normalization/Review、Phase0、build/lint/typecheck/凭证和 Python 回归通过 |
| 排除 | 库存、采购、生产、销售、品质、财务、Dashboard、备份、真实主数据迁移、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK04 必须从本任务独立提交和 clean 工作区开始。

## 19. `0.1.0-alpha.2` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK02` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.2` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `e8cb7ebc0fa9d45575aeaffc0732183d2533f577`；`main`，工作区 clean，本地领先 `origin/main` 2 个提交 |
| PostgreSQL | 新增 expand-only `0006_identity_security.sql`；SHA-256 `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`；`0001`—`0005` checksum 保持不变 |
| 功能 | 独立 Identity Repository/Service/Handler；setup/login/logout/session 安全重构；本人改密、用户列表/创建/启停/重置、会话撤销、must-change、限流、持久幂等、CAS 和系统审计 |
| 验收 | Identity 单元 8/8、UI 4/4、PostgreSQL/API 8/8、migration 4/4；Compose 初始生命周期与 Web/PostgreSQL 重启阶段通过；指定 Material/Mapping/Normalization/Review、Phase0、build/lint/typecheck/凭证和 Python 回归通过 |
| 排除 | 客户、供应商、产品、BOM、库存、采购、生产、销售、品质、财务、Dashboard、备份、真实身份迁移、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL 或其他生产数据库；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。未来任何部署、真实用户迁移或生产批准必须新增不可改写的独立记录。
