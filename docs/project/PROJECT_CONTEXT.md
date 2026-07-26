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
- 实际状态：2026-07-26 只读复核 systemd `chenyida-erp.service` 为 `enabled/active`，源码与已安装 unit SHA-256 一致，PID `277640` 的命令行继续监听 `0.0.0.0:18888`。这仍是开发服务，不代表正式生产投用。

### 自托管 Node 应用

- 路径：`chenyida_erp_site/`
- 技术：Vinext、React、TypeScript、标准 Node.js、PostgreSQL/Drizzle、本地持久化文件和 PostgreSQL 后台任务 Worker。
- 页面：TASK10 已把根 `app/page.tsx` 改为原生经营工作台；legacy `public/erp/index.html` 保留为显式业务工作区和回滚入口，不再作为根 iframe 默认依赖。Material Master 和 Import Workspace 使用 `app/materials/` 原生 Vinext 路由。
- API：`app/api/[...path]/route.ts` 转交给不依赖平台 binding 的 `app/lib/selfhost-api.ts`；旧 `erp-api.ts` 仅作迁移参考。
- 根页迁移：TASK03—TASK10 已接通主数据/BOM/库存/采购/生产/销售/品质/财务、实时 Dashboard 与离线 backup 治理，根页已退出 iframe。完整 ERP API 的非生产实现不等于实际业务迁移：真实数据、账号和文件未迁移，采购、库存、生产、销售、品质、财务的实际业务仍依赖 Python/SQLite；生产恢复演练未做，不能描述为已投产。
- 部署能力：`compose.yml` 可启动 Web、Worker、PostgreSQL；Caddy production profile 可提供 HTTPS。TASK05 已运行非生产 Compose 项目 `chenyida-erp-parallel`，Web 仅绑定 `127.0.0.1:3000`、PostgreSQL 无宿主端口，Caddy 未启动；它只用于同机 HTTP 空环境验收，不是生产部署。历史 Sites `v3` 不作为后续交付目标。

- 历史公网验证地址仅作记录；PHASE0-TASK03 未访问公网地址，长期公网运行仍需 HTTPS 和访问控制。
- 开发常驻服务：systemd `chenyida-erp.service`，服务定义源码位于 `deployment/chenyida-erp.service`。
- 源码管理：`PHASE0-TASK01-B` 已将原 gitlink 转为根仓库直接跟踪的普通目录；新克隆可恢复完整源码。生产提交为 `2b4f178`，纳管前开发提交为 `9f2c2dc`。
- 发布标识：包名为 `chenyida-erp-selfhosted`；TASK07 源码为 `0.1.0-alpha.21`/`0021`，并行环境在 ops 验收前仍为 TASK06 的 `0.1.0-alpha.20`/`0020`；只属于回环并行验收，明确为非生产且尚未正式发布。
- 原始发布基线：PHASE0-TASK03 于 `39946f6` 上定义 `0.1.0-alpha.1` / PostgreSQL `0001`—`0005`，并由 `12d3ea3` 提交。该历史定义不改写；当前包已演进到 `alpha.19`。
- Git 复核：2026-07-26 本次任务起点为本地 `main`/HEAD `3ae79f1`、工作区 clean；本地 `origin/main` 与远端 `main` 均停留 `39946f6`，本地领先 27 个提交，不得描述为已同步。

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
- `drizzle-postgres/0005_material_import_review.sql` 增加 Review Session/Row、核心和动态属性覆盖历史、Issue resolution、Review validation issue、sealed finalization、行级 operation、ACTIVE binding、Draft link 和审计历史；TASK01 Material Service、API、Worker 与七步 Import Workspace 已完成非生产闭环。
- `drizzle-postgres/0006_identity_security.sql` 和 `0007_master_data_bom.sql` 分别补齐身份安全与关系化主数据/BOM；`0008_inventory_ledger.sql` 新增稳定 Material/Unit ID 的库存余额投影与不可变账本；`0009_procurement.sql`、`0010_production.sql`、`0011_sales.sql`、`0012_quality.sql` 和 `0013_finance.sql` 分别关系化采购、生产、销售、品质与财务结算事实，旧文本编码/JSON 表仅保留为迁移来源。
- `drizzle-postgres/0014_migration_openings.sql` 新增不可变 Migration Opening Source、库存期初/冲销和 Finance Opening/冲销；只通过测试迁移 CLI 的内部 Service 物化，复用 Ledger/Balance 与 Finance Document/Event/Settlement，不回填旧数据或暴露 HTTP 写路由。
- `drizzle-postgres/0015_market_project_handoff.sql` expand-only 新增稳定 Project、不可变 Requirement Version/Item、受控 Document Link、Handoff 投影和不可变 Event；服务端只允许 sales 市场与 engineering 项目角色按状态机操作，不回填旧数据或启动下游流程。
- `drizzle-postgres/0016_project_planning_handoff.sql` expand-only 新增正式 planning 角色约束、Requirement Resolution、版本化 Planning Package、Item/BOM/Document 快照和不可变 Event；不修改 0015 事实，不读取库存或创建需求/采购/生产单据。
- `drizzle-postgres/0017_planning_material_requirements.sql` expand-only 新增不可变物料需求计划/行、独立库存/在途 Planning Allocation、采购申请/行和事件；只消费固化 Package 快照，提交时锁定重算，不修改正式 `reserved_qty` 或创建 PO/收货/生产事实。
- `drizzle-postgres/0018_procurement_sourcing.sql` 保存 RFQ、报价版本、比较版本、人工 Award 和事件；`0019_sourcing_purchase_fulfillment.sql` 新增 Award/PO 来源、到货计划、待入库、Receipt 分配和不可变事件，并复用既有 Procurement/Inventory/Finance 事务权威。
- 本地文件卷保存二进制，数据库只保存受控相对路径和摘要元数据。
- Worker 使用 PostgreSQL Outbox、`FOR UPDATE SKIP LOCKED`、租约、心跳、重试和 CAS；Web/Worker 是独立入口。

### 历史在线 D1

- `drizzle/0000`—`0008` 形成 45 张表的开发 schema；Material V2、Draft/Review、Import Batch、Parser/Mapping、Normalization、Material Library 和 Supplier Profile 全部使用版本化 Up、snapshot/journal、受保护恢复边界与隔离迁移测试，尚未执行生产 migration。
- 大多数业务对象按 `kind` 存入 `erp_records.data_json`。
- API 运行时仍只为 legacy 8 表包含兼容建表语句；V2 与 Material API 对象必须显式应用版本化 migration，不在生产启动时自动创建。
- PHASE0-TASK03 只核验仓库内 `0000`—`0008` 文件与 SHA-256，没有访问生产 D1，也没有确认生产实际 migration 版本。

## 主要模块

- 身份与权限：初始化、登录、会话、角色、用户状态、密码重置、审计。
- 物料治理：物料、供应商映射、CSV/XLSX/XLS 自适应导入、不可变原始行、清洗确认、新物料建档。
- 工程：产品、BOM、BOM 行、齐套分析。
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
30. SELFHOST-PHASE4-TASK07 采用 D-064：Report 受净领料支持量约束且不写库存；Completion 必须通过 Allocation 消费未占用 good，并与成品 Ledger/Balance、Work Order 投影、Event/Audit/Idempotency 同事务。Report/Completion 只能追加式全额冲销并执行 IPQC/FQC/Shipment/库存门禁。源码 `0.1.0-alpha.21`/`0021` 与隔离回归完成，并行验收待执行。

## 当前风险

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
- Node/PostgreSQL 没有生产部署、真实数据 migration 或发布批准；隔离测试通过不能写成已上线。
- `chenyida-erp-parallel` 是正在运行的 HTTP 验收部署，但只绑定回环、使用 development 模式且数据库为空；它不能被描述为生产部署。访问必须经 SSH 隧道，首次登录后需改密并删除 `/etc/chenyida-erp/parallel-admin.txt`。
- 在线同库备份和本地零字节历史备份不能视为可靠灾备。
- 业务决策 `B01-B24` 尚未全部确认。
- 根自托管页面已退出 legacy iframe；显式 `/erp/index.html` 仍承载尚未重写的业务 UI。Dashboard/backup 治理已接通，但真实数据、生产备份恢复演练和切换仍未完成，不能描述为已投产。
- PostgreSQL Customer/Supplier/Product/BOM、通用库存、采购、生产、销售、品质和 AR/AP/收付款已有关系服务；`erp_records` JSON 占位与旧库存表不属于这些权威链路。表存在不等于 API、权限、事务、幂等、审计或真实数据迁移已完成。

## 开发规范

- 每次只执行 `TASKS.md` 中一个任务编号。
- 不扩大范围，不修改无关代码，不直接操作生产数据或生产环境。
- 数据库变化必须使用版本化迁移并提供隔离迁移测试。
- 新功能必须有测试；关键写操作必须有权限、事务、幂等、并发和审计。
- AI 不得直接覆盖正式数据，物料合并不得绕过人工审核。
- 完成任务必须更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 并创建独立提交。

## 当前路线

`SELFHOST-PHASE4-TASK05` 已完成：源码历史与并行环境基线为 `0.1.0-alpha.19` / PostgreSQL `0019`，`10×12` Award 经显式 PO/到货计划、两批 `4/6` 收货形成库存 `10`、来源和 AP `48/72`；Compose 重启、新空库恢复和清理通过。

`SELFHOST-PHASE4-TASK06` 已 DONE。`SELFHOST-PHASE4-TASK07` 是唯一 DOING：源码 `0.1.0-alpha.21`/`0021` 已基于严格起点 `26ccb95782478645720c8284c59b0afadca68649` 完成 Report→Completion Allocation、净领料支持量、分批成品入库和追加式安全冲销，隔离专项与既有生产/库存/品质/销售/Dashboard 回归通过；并行真实 4/6 HTTP、整栈重启、停服恢复和最终清理仍待独立 ops 验收。品质检验创建、发货、财务、真实迁移、HTTPS 和生产切换不属于 TASK07。

## 恢复上下文检查清单

1. 阅读 `AGENTS.md` 和 `docs/project/MASTER.md`。
2. 阅读 `TASKS.md`，确认唯一当前任务和依赖。
3. 阅读本文件及 `DECISIONS.md`，区分已确认与待确认事项。
4. 阅读当前任务文档，检查禁止事项和验收标准。
5. 运行 `git status`，不得覆盖用户未提交变更。
6. 只读核验可能变化的 Git、Site 和数据库状态后再开发。
