# 晨亿达ERP路线图

状态枚举：`PLANNED`、`DOING`、`DONE`、`BLOCKED`。任务数量为当前规划估算，业务确认后可调整，但必须记录在 `DECISIONS.md`。

## 总览

| 阶段 | 名称 | 预计任务数 | 当前状态 |
| --- | --- | ---: | --- |
| Phase 0 | 基础架构 | 4 | DONE |
| Phase 1 | 物料主数据 | 6 | PLANNED |
| Phase 2 | 导入采集与 Mapping | 8 | DONE（非生产） |
| Phase 3 | 导入规范化、暂存与审阅 | 4 | DONE（非生产实现完成） |
| Phase 4 | AI治理 | 5 | PAUSED（TASK01 DONE；TASK02 DONE / DETERMINISTIC THRESHOLDS APPROVED / RELEASE NOT AUTHORIZED；TASK03 BLOCKED / OWNER PRIORITY HOLD / SOURCE READY / HOLDOUT REVALIDATION REQUIRED / RELEASE NOT AUTHORIZED；TASK04—TASK05 TODO） |
| Phase 5 | ERP融合 | 10 个已授权任务 | DONE（非生产并行验收） |
| Phase 6 | 行业物料库 | 4 | PLANNED |

## 投产准入主线（2026-08-12 基线）

`SELFHOST-PRODUCTION-READINESS-40`已按实际 Git、运行版本、Migration、备份恢复、应用测试和运维安全证据建立[投产准入基线](PRODUCTION_READINESS.md)。当前判定为`PRODUCTION NO-GO`；既有 Phase 完成只表示非生产实现或历史验收，不代表真实数据、真实员工或正式切换已经具备。

依赖顺序固定为：备份/恢复契约 V2 → 异机备份与隔离恢复 → 同一发布身份与强制测试门 → 应用 P0 安全修复 → 真实源只读分析 → 真实迁移/回滚演练 → 同候选端到端和运维演练 → 少量员工试运行 → 专项授权正式切换 → 上线观察。`SELFHOST-OPS-BACKUP-RECOVERY-V2-41`已完成第一项的合成/隔离实现；异机目标、RPO/RTO和真实数据专项授权仍阻塞第二项。`SELFHOST-OPS-RELEASE-GATE-42`已完成G3仓库工具，但Browser/typecheck/候选镜像及镜像安全证据仍阻止候选PASS；TASK43—TASK45已在仓库与隔离环境关闭导入fallback、会话absolute deadline/DB时钟/竞态/Cookie及health/Worker/storage/Migration误报，运行UAT仍未部署。当前TASK46唯一DOING，先在固定离线沙箱关闭全部38份TypeScript配置；随后再处理固定Browser运行时。权限矩阵等待业务负责人批准；没有专项授权时不执行真实数据、外传、部署或切流。

## Landing 灾备封存

- `SELFHOST-LANDING-TASK01`：DONE / READY_FOR_OFFHOST_COPY。alpha.34 完整 Git 历史、clean-0034 PostgreSQL、uploads/attachments/backup-status 已形成 root-only 包并通过 Git clone、固定新空库和文件恢复验证。
- 当前只完成本机封存，`offhost_copy_completed=false`；下一步仅由项目负责人通过受控 scp/SFTP/VPN 下载，并在异机运行 `sha256sum -c SHA256SUMS`。校验返回前不删除服务器包，不启动真实迁移、生产部署或其他业务任务。
- `SELFHOST-OPS-RECOVERY-FOUNDATION-39`：`DONE / OWNER-CLOSED AFTER GIT AND IMAGE ANCHORS / DATA ANCHOR DEFERRED`。private Git与private GHCR镜像锚点已建立并验证；PostgreSQL dump和uploads、attachments、backup-status异机锚点未建立，由项目负责人主动延期，单机数据恢复风险继续`OPEN`。该行政收口不是三锚点完成或production ready。

## 部门业务主线（SELFHOST-PHASE4）

已确认第一阶段顺序为：客户 → 市场部门 → 项目部门 → 计划部门 → 采购部门 → 仓库部门 → 财务部门。生产、品质、完工和发货在后续阶段接入。每一段独立授权、独立状态机和独立验收，前段不得自动创建后段单据。

- `SELFHOST-PHASE4-TASK01`：市场部门 → 项目部门需求交接（DONE；`0.1.0-alpha.15` / PostgreSQL `0015` 已通过并行双账号、重启持久与清理验收）。
- `SELFHOST-PHASE4-TASK02`：项目部 → 计划部，产品/BOM/规格交接（DONE；`0.1.0-alpha.16` / PostgreSQL `0016` 已通过并行退回→v2→重提→接收、重启持久与清理验收）。
- `SELFHOST-PHASE4-TASK03`：计划部 → 采购部，固化需求聚合、独立库存/在途分配与采购申请交接（DONE；`0.1.0-alpha.17` / PostgreSQL `0017` 已通过并行 v1 退回释放→v2 重算重提→接收、重启与恢复清理；不自动启动询价/供应商/比价）。
- `SELFHOST-PHASE4-TASK04`：采购询价、报价、服务端比较与人工定标（DONE；`0.1.0-alpha.18` / PostgreSQL `0018`，不自动创建 PO）。
- `SELFHOST-PHASE4-TASK05`：采购定标 → PO → 到货 → 仓库分批收货 → 库存 → 采购来源 → 财务显式 AP（DONE；`0.1.0-alpha.19` / PostgreSQL `0019`，重启与清理验收通过）。
- `SELFHOST-PHASE4-TASK06`：最新已接收计划包 → 生产交接版本 → 唯一 DRAFT 工单 → 显式释放/BOM 快照/需求 → 齐套预留 → 仓库分批领料（DONE；`0.1.0-alpha.20`/`0020` 已通过并行 HTTP、重启、恢复与清理验收；报工、完工和品质排除）。
- `SELFHOST-PHASE4-TASK07`：已领料工单 → 分批 Report → good Allocation → warehouse 分批 Completion → 成品 Ledger/Balance → COMPLETED（DONE；`0.1.0-alpha.21`/`0021`、真实 4/6 HTTP、重启、双恢复与清理通过；品质、发货和财务排除）。
- `SELFHOST-PHASE4-TASK08`：Report→IPQC、Completion→SO Allocation→FQC 处置关闭→订单级可消费放行额度（DONE；`0.1.0-alpha.22`/`0022`、真实 4/6 HTTP、重启、恢复与清理通过；不发货或创建 AR）。
- `SELFHOST-PHASE4-TASK09`：FQC 放行→Sales Delivery Instruction→warehouse 分批 Shipment/FQC 消费→成品出库→Sales Source→finance 显式 AR（DONE；`0.1.0-alpha.23`/`0023`、Shipment/FQC `4/6`、库存 `10→6→0`、Source/AR `80/120`、Settlement 0，重启、恢复与清理通过）。
- `SELFHOST-PHASE4-TASK10`：既有 AR/AP→客户收款/供应商付款→稳定来源 Project/Currency 归属→来源、未结与净现金视图（DONE；`0.1.0-alpha.24`/`0024`、AR `80/120`、AP `48/72`、收款 `30/50/120`、付款 `48/30/42`、净现金 80、UNATTRIBUTED 0，重启、恢复与清理通过；不是会计利润）。
- 后续阶段：真实银行、总账、税票、汇率、成本会计、公司费用、正式利润、真实迁移和生产切换均为 PLANNED/待单独授权；TASK10 完成后停止。

## Phase 0 基础架构

**目标**：让源码、项目文档、测试、环境和生产基线可以被新对话与新机器可靠恢复。

**完成标准**：

- 根仓库新克隆可获得完整 Backend、Site、配置、文档和测试源码。
- 历史 Site、当前 Python 开发运行面和未来自托管版本的源码提交、数据库迁移版本和恢复责任可追踪。
- 测试环境与生产完全隔离，写测试拒绝生产 URL。
- 默认凭证、备份和恢复的高风险项有明确处置结果。
- 项目文档在每个任务结束时同步更新。

**计划任务**：`PM-000`、`PHASE0-TASK01`、`PHASE0-TASK02`、`PHASE0-TASK03`。

## Phase 1 物料主数据

**目标**：建立一物一码、品类属性、生命周期、供应商映射和审核的关系化权威数据源。

**完成标准**：

- 业务负责人确认权威系统、编码、状态、责任人和首期品类。
- 关系化 schema、版本化迁移、约束、索引和迁移测试通过。
- 正式物料只能经审核启用，AI 或导入结果不能直接写正式数据。
- 物料、属性、别名、映射和历史变更可审计。

**建议任务数**：9（由 `SELFHOST-PHASE2-TASK01` 源码盘点提出，逐项独立验收）。**当前状态**：DONE（仅非生产实施）；TASK02—TASK10 已完成，真实数据与生产门禁不在本阶段授权内。

**覆盖演进**：`SELFHOST-PHASE2-TASK01` 起点为等价覆盖 4、部分 9、未覆盖 51，且 23 个业务 GET 全部 404；TASK10 最终为 COVERED 52、REPLACED 2、RETIRED 10、未知/404 0，根页已退出 iframe。

**执行顺序（TASK02—TASK10 已完成非生产实施与独立验收）**：

- `SELFHOST-PHASE2-TASK02`：身份、用户管理、密码、会话撤销与系统审计（DONE，非生产 `0.1.0-alpha.2`；未部署或迁移真实用户）。
- `SELFHOST-PHASE2-TASK03`：客户、供应商、产品、BOM 与供应商物料映射（DONE，非生产 `0.1.0-alpha.3`；PostgreSQL `0007`，未迁真实数据或部署）。
- `SELFHOST-PHASE2-TASK04`：库存不可变账本、余额投影与受控调整（DONE，非生产 `0.1.0-alpha.4`；PostgreSQL `0008`，未回填真实库存或部署）。
- `SELFHOST-PHASE2-TASK05`：采购、缺料建议、收货与库存联动（DONE，非生产 `0.1.0-alpha.5`；PostgreSQL `0009`，未迁真实 PO/在途或创建 AP）。
- `SELFHOST-PHASE2-TASK06`：工单、BOM 快照、领退料、报工、完工与库存联动（DONE，非生产 `0.1.0-alpha.6`；PostgreSQL `0010`，未迁真实生产数据或创建品质/财务过账）。
- `SELFHOST-PHASE2-TASK07`：询报价、销售订单、发货与库存联动（DONE，非生产 `0.1.0-alpha.7`；PostgreSQL `0011`，未迁真实销售数据或创建 AR/收款/品质过账）。
- `SELFHOST-PHASE2-TASK08`：IQC/IPQC/FQC、缺陷、处置与关闭（DONE，非生产 `0.1.0-alpha.8`；PostgreSQL `0012`，FQC 门禁已接入发货，未迁真实检验或伪造 IQC 库存隔离）。
- `SELFHOST-PHASE2-TASK09`：应收应付、收付款、余额与冲销（DONE，非生产 `0.1.0-alpha.9`；PostgreSQL `0013`，稳定 Shipment/Receipt 金额来源、不可变 Settlement/Reversal/Event 与上游冲销门禁通过，未迁真实金额或接入外部财务系统）。
- `SELFHOST-PHASE2-TASK10`：经营看板、备份恢复治理与 legacy iframe 退出（DONE，非生产 `0.1.0-alpha.10`；实时权限裁剪 Dashboard、原生根、离线 backup/verify/新空目标 restore 与 Compose 重启通过，未新增 `0014`、未迁真实数据或部署）。
- `SELFHOST-PHASE3-TASK01`：生产前数据迁移框架与合成试迁移基线（DONE，非生产 `0.1.0-alpha.11`；显式 CLI、双 source adapter、staging、checkpoint、合成 backup/restore 与全回归通过，真实数据和生产 NO-GO）。
- `SELFHOST-PHASE3-TASK02`：库存与财务期初来源及迁移物化安全边界（DONE，非生产 `0.1.0-alpha.12`；PostgreSQL `0014`、受控 Inventory/Finance Opening、冲销、Compose/恢复与全回归通过；MG-001/MG-002 仅在合成模型解决，真实数据和生产 NO-GO）。
- `SELFHOST-PHASE3-TASK03`：合成全域业务表物化与 Dashboard 核对（DONE，非生产 `0.1.0-alpha.13`；18 个 actual public targets、12 个 archive-only、正常全域 API/Dashboard、backup→新空目标 restore、同 manifest replay 与整栈重启通过；migration 保持 0001—0014，真实数据和生产 NO-GO）。
- `SELFHOST-PHASE3-TASK04`：本机真实 SQLite 只读盘点与脱敏 Dry-run（DONE，非生产 `0.1.0-alpha.14`；29 表/3,619 条聚合，planned 49、archive-only 3,566、review 4、blocked/model-gap 0；快照已删除，源/PID 不变，无 target/materialization/file body read；migration 保持 0001—0014，真实 PostgreSQL 与生产 NO-GO）。

库存从采购中拆成独立 TASK04，因为收货、领料、完工和发货都必须复用同一不可变账本、余额投影、锁顺序、幂等和冲销规则。迁移阶段 TASK01 补充合成准备度，TASK02 补充 MG-001/MG-002 合成期初，TASK03 完成合成 public materialization，TASK04 完成一次本机 SQLite 只读脱敏盘点。真实 PostgreSQL 试迁移、逐行人工处置、D1/附件盘点、生产恢复、部署和切换仍需另建任务并明确授权。

## Phase 2 导入中心

**目标**：建立可批量、可重试、可解释、可人工确认的导入、标准化和匹配中心。

**完成标准**：

- 导入批次、原始行、错误、候选、证据和决策全部可追踪。
- 精确匹配、自动建议、疑似匹配、冲突和新物料分流可重复。
- 重复上传与重试幂等，失败不留下半批数据。
- 冲突和新物料不能绕过审核进入正式业务。

**当前任务数**：8。**当前状态**：DONE（非生产；生产资源、迁移和部署未授权）。

**任务顺序**：

- `PHASE2-TASK01`：设计 Material Import Batch Foundation V1（DONE）。
- `PHASE2-TASK02`：实现 Import Batch Foundation（DONE，非生产；无 R2 资源、生产迁移或部署）。
- `PHASE2-TASK03`：设计 Excel/CSV Parser 与字段 Mapping V1（DONE；16 项决定已确认）。
- `PHASE2-TASK04`：实施 Parser、`0005`、Outbox 和 Mapping API（DONE；54 项专项与全量 Node 278/278 通过，仅非生产，不含生产资源、迁移或部署）。
- `PHASE2-TASK05`：设计 Material Import Workspace UI V1（DONE；该任务仅文档，完整 UI 后由 TASK08 实施）。
- `PHASE2-TASK06`：设计 Material Import Mapping Target Catalog V1（DONE；12 项决定已由 TASK07 批准）。
- `PHASE2-TASK07`：实现批次作用域 Catalog 与共享 Registry/Snapshot/digest（DONE；51 项专项、Node 339/339；Catalog 门禁已解除，未改 Schema/Migration/前端或生产环境）。
- `PHASE2-TASK08`：实现 Material Import Workspace UI V1（DONE；100 项专项、50×256 Playwright 门禁和全量 Node 440/440 通过，仅非生产前端，不含部署）。

Import Workspace UI 已由 `PHASE2-TASK08` 独立实施；Catalog 与 50×256 性能/可访问性两项门禁均已通过。Normalization 进入 Phase 3；分类、匹配、Material Draft、生产资源、迁移和部署仍需独立任务与授权。

## Phase 3 导入规范化与暂存

**目标**：把确认后的 Mapping 确定性应用到已发布原始行，形成可追溯、可分页、可审计且可原子发布的标准物料候选快照。

**完成标准**：

- 独立 normalization run、行快照、issue、租约、重放和 current pointer 契约通过审阅。
- 空值、默认值、基础字段、动态属性、类型、Validation 延迟边界和资源限制获业务负责人确认。
- `0006`、API、隔离 D1/调度器及 54 项最低测试在非生产实施通过。
- ERROR 行不会被误当成执行失败；未分类候选不得创建 Draft 或写正式物料。

**任务顺序**：

- `PHASE3-TASK01`：设计 Material Import Normalization & Staging V1（DONE；16 项决定由 TASK02 全部批准）。
- `PHASE3-TASK02`：实施 Normalization、`0006`、API 和隔离测试（DONE；不含生产迁移/部署、分类、匹配或 Draft）。
- `PHASE3-TASK03`：设计 Material Import Normalization Review UI V1（DONE；四份 docs-only 交付、37 线框、104 项测试和 14 项 `APPROVED` 决定）。
- `PHASE3-TASK04`：实现 Material Import Normalization Review UI V1（DONE；统一工作区、七步 Stepper、Current/Latest、Rows/Issues/Drawer、104 项测试与本地性能/可访问性门禁）。

**当前状态**：Normalization 后端与 Review UI 非生产实现完成；行完整 Issue 查询局部门禁及七项非阻塞限制继续有效。生产迁移、远程容量和部署仍需独立任务与授权。

## Phase 4 AI治理

**目标**：在确定性规则和人工审核之上增加受控 AI 辅助能力。

**完成标准**：

- AI 输出带来源、置信度、规则证据和模型版本。
- AI 只生成建议，不直接创建、合并、启用或覆盖正式物料。
- 评估集覆盖正例、反例、冲突和行业特殊场景。
- 人工确认结果可形成质量指标，但不自动改变生产阈值。

**预计任务数**：5。**当前状态**：PAUSED（TASK01治理基线DONE；TASK02为`DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`；TASK03为`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`；TASK04—TASK05未开始）。

**执行顺序**：

- `PHASE4-TASK01`：建立AI治理评估与审批边界（DONE；D-110及V1合同已批准，AI仅建议、确定性门禁优先、关键安全违规允许值0；`IMPLEMENTATION NOT STARTED`）。
- `PHASE4-TASK02`：建立版本化去敏评估集、固定holdout、确定性基线和离线Evaluator（DONE；`material-v1@1.0.0`共64条，固定holdout已从冻结提交`d69f6dff…194ec`测量且未重跑，关键安全违规0；D-111批准只绑定当前确定性身份的100%正确性/证据/复现、错误候选0和安全放弃coverage档案，治理层PASS但release仍未授权）。
- `PHASE4-TASK03`：建立关系化AI Suggestion/Evidence候选层和完整追溯/过期合同（BLOCKED / OWNER_PRIORITY_HOLD；D-112五表、alpha.44/0041、确定性四能力Service及受保护生成/读取API源码已完成隔离验证；正式holdout须重验，未build/deploy或应用UAT Migration，不得写正式业务事实；只允许负责人明确恢复）。
- `PHASE4-TASK04`：建立人工审核API/UI及与既有受控正式提交的衔接（TODO；人工决定与AI建议分离，不新增隐式权限）。
- `PHASE4-TASK05`：验收非生产试点发布门禁、漂移监控、停用开关和回退（TODO；必须另获具体数据、模型、环境及时限授权）。

D-110不授权模型调用、外部供应商、真实数据外发、生产试点或部署；D-111只批准当前冻结本地确定性阈值，不授权外部模型或发布；D-112现已单独获准并完成TASK03源码实施，但不授权正式holdout结论、构建、UAT Migration、部署、TASK04/TASK05或其他运行环境动作。

## 多智能体研发控制面

**目标**：用单任务、最小能力、独立验证和可恢复有界循环保护ERP研发，而不把Agent共识当作业务、发布或生产授权。

**当前状态**：PM-001/D-113、AGENT-R1、PM-002及D-114限定的`AGENT-R1-5`均已完成；当前零DOING/`IDLE`。R2—R5均未授权。

- `R1`：无状态只读控制器（DONE；只读巡检、READY/IDLE，不具备调度或强制权限）。
- `R1.5`：Codex原生临时编排MVP（DONE / AGENT-R1-5；Task Packet v2、Message/Context合同、单写者、独立门禁和合成黑盒已验证；仍不含daemon、Control Store、OS级身份、数据库、UAT或部署能力）。
- `R2`：独立身份、worktree、路径租约、Control Store、命令/秘密代理和重任务锁（NOT AUTHORIZED）。
- `R3`：有界开发循环、检查点、fencing、retry/deadlock和恢复负测（NOT AUTHORIZED）。
- `R4`：逐动作授权的受控非生产UAT（NOT AUTHORIZED）。
- `R5`：具备异机恢复、完整UAT、Runbook和人工双门的生产候选（NOT AUTHORIZED）。

任何阶段必须另立任务，不得由路线表自动开始；研发控制状态不得使用D-112产品五表。

## Phase 5 ERP融合

**目标**：让 BOM、采购、库存、生产、销售、品质和财务统一引用受控物料主数据。

**完成标准**：

- 新业务只引用有效内部物料 ID/编码。
- 单位、替代、客户专用、冻结和停用规则在服务端拦截。
- 旧数据通过交叉映射分模块切换，历史单据不丢失。
- 库存、在途采购、未完工工单和关键金额核对通过。

**预计任务数**：6。**当前状态**：IN PROGRESS。自托管全域 API、合成迁移框架、受控 Inventory/Finance Opening 及完全合成 public materialization/Dashboard/恢复已完成非生产验收；真实 source inventory、逐行人工处置、容量、安全、生产恢复、部署和切换尚未开始。

生产线已推进到 `SELFHOST-PHASE5-TASK10`：在既有采购履约、库存和品质权威上建立 Supplier Receipt Inventory Lot 与 IQC 隔离放行。真实主链 `10×12 CNY` 收货形成 RML Lot 和 Source 120，余额先为 `10/10/0`，IQC `10/8/2` 后 RELEASE 8/Close 为 `10/2/8`，AP/Production Issue 0；独立 3 件支线沿原 Lot 全额冲销为 REVERSED，主链已有 IQC 的冲销返回 409。`0.1.0-alpha.34`/`0034`、权限/幂等/CAS/并发/故障/SQL guard、Compose 重启、接受态固定第二库恢复、Build Cache 归零和最终 clean-0034 清理已通过。停止，不自动启动后续任务；生产领料 Lot、FIFO/FEFO、序列号、设备/OEE、产能、真实迁移和生产切换未授权。

## Phase 6 行业物料库

**目标**：在权限、来源和质量可控的前提下沉淀 PCB/FPC/SMT 行业物料知识库。

**完成标准**：

- 知识条目有来源、版本、适用范围、质量等级和版权边界。
- 公司私有主数据与行业公共知识严格隔离。
- 搜索、推荐和复用不泄露客户、供应商、价格或生产信息。
- AI 采购、报价和生产辅助只能消费已授权、可追踪的数据。

**预计任务数**：4。**当前状态**：PLANNED。
