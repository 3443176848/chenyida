# 晨亿达ERP项目总控

> 最高优先级：任何新的 Codex 对话必须先阅读本文件，再继续当前任务。

## 项目名称

晨亿达ERP（Chenyida ERP）

## 项目目标

打造适用于 PCB、FPC、SMT 行业的 ERP，以统一内部编码连接物料、产品、BOM、采购、库存、生产、销售、财务和品质。

长期目标是建立 AI 物料主数据中心（Material Master），最终实现：

- AI 物料治理
- AI 采购
- AI 报价
- AI 生产辅助
- 行业物料知识库

AI 只提供建议、证据和辅助决策，不得未经审核直接创建、合并或覆盖正式物料数据。

## 文档权威顺序

1. `AGENTS.md`：全仓库不可放宽的工程、安全和生产保护规则。
2. 本文件：项目目标、当前结论、当前任务和下一任务。
3. `TASKS.md`：任务状态、依赖和责任人。
4. `PROJECT_CONTEXT.md`：新对话恢复上下文的事实基线。
5. `DECISIONS.md`：已确认决策及仍待确认事项。
6. 当前任务文档：本次工作范围和验收标准。

实际代码和生产状态与文档冲突时，必须先核验并更新文档，不得凭聊天记忆继续开发。

## 当前状态

快照时间：2026-07-27（Asia/Shanghai）

| 项目 | 当前值 |
| --- | --- |
| 当前版本 | 源码与并行环境均为 `0.1.0-alpha.32`；PostgreSQL migration head 为 `0032_finished_goods_inventory_lots.sql`；始终仅限回环非生产环境 |
| 当前 Branch | 根仓库 `main` |
| 当前根仓库功能基线提交 | TASK08 功能提交 `43808f85bc3a662825cc2421d97e9eb631e0c469` 严格以 `809efadd2cafd1a7b55a0824b87c67c70ad2814b` 为 Parent；其后仅追加九个聚焦修正提交，最终验收提交以 Git log 为准 |
| 当前根仓库运维基线 | `SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02` 严格以 `dfece35cda381ff31c376aad9ed78242861ada73` 为 Parent；独立提交消息为 `ops: clean docker build cache safely`，实际提交 SHA 以 Git log 为准 |
| Git 同步与工作区 | TASK08 起点 behind 0/ahead 59、工作区 clean；独立验收提交后预期 behind 0/ahead 70，仍不 push、不创建 PR、不改写历史 |
| PM-000 基线父提交 | `bbefb2e`，`feat: add chenyida erp site project files` |
| 历史 Sites 版本 | 历史记录为 `v3` / `2b4f178`；本任务未访问公开 Site，未重新确认在线状态；Sites/D1 不是未来生产权威方向 |
| 历史 Site 源码版本 | 历史发布对应提交 `2b4f178`；纳入根仓库前的开发提交为 `9f2c2dc`；根仓库直接跟踪其完整源码 |
| 历史 Site 地址 | 文档保留原地址仅作历史追踪；本任务禁止且未访问 |
| 当前数据库 | 源码和并行 PostgreSQL 均为 `0001`—`0032`；最终唯一启用管理员、所有合成业务/审计/幂等表 0、uploads/attachments 0。SQLite/D1 未向 PostgreSQL 迁移真实数据 |
| 当前运行状态 | 本机固定按 2 核/约 4 GiB/1 GiB Swap 保护；Python/SQLite 开发服务 PID `13737` 未重启；非生产 Compose 的 PostgreSQL/Web/Worker 运行，RestartCount 0、OOM false，Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口。TASK08 Build Cache 0B→峰值 2.627 GB→0B，根分区最终可用 37 GiB；不是生产部署 |
| 当前开发环境 | Node.js/PostgreSQL/本地文件/后台 Worker 已实现 Identity、主数据/BOM、库存、采购、生产、销售、品质、财务、Dashboard，以及 Manufacturing Batch→Production Report→Completion→Finished Goods Inventory Lot→Lot Ledger/Balance/genealogy 的非生产链路 |
| 当前阶段 | Phase 4 TASK01—TASK10 与 Phase 5 TASK01—TASK08 已完成并行验收；TASK08 已停止于干净 `0032` 点 |
| 当前任务 | 当前无 `DOING`；`SELFHOST-PHASE5-TASK08` 已 `DONE / PARALLEL ACCEPTED`，2026-07-27 服务器重启/不可用根因仍为 `UNKNOWN` |
| 下一任务 | 停止；不得自动启动 PHASE5-TASK09。原材料/供应商/采购 Receipt/生产领料/Shipment Lot、FQC Lot 放行、序列号、设备/OEE、产能排程、成本会计、真实迁移、HTTPS、生产恢复和切换均未授权 |

## 当前完成模块

以下模块已有可运行代码或已完成治理交付，但“已实现/已完成”不代表已达到 V2、审计或生产成熟度标准：

- SELFHOST-PHASE5-TASK08 已在同一并行环境交付 `0.1.0-alpha.32`/`0032`、唯一 Finished Goods Inventory Lot、稳定 Batch 一对一映射、Lot Ledger/Balance/Material Aggregate、freeze/unfreeze 和 Completion 原 Lot 冲销恢复；实际 Batch A 4 / Batch B 6、Material 10、ORDER 空 Lot 兼容、重启、停服备份/固定第二库恢复、Build Cache 回到 0B 和最终清理通过。原材料、供应商、采购 Receipt、生产领料、Shipment/FQC Lot 与序列号未实现，不启动 TASK09
- SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 在默认 `default*` builder 无构建任务时执行受控 `docker buildx prune --all --force`，清理 25.11 GB BuildKit cache，并逐个核验后删除唯一无引用 dangling image `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612`；镜像空间 27.45→6.511 GB、根分区可用 14→37 GiB。三 ERP 容器、四卷、Trae/MySQL、匿名卷、tagged image、备份、Python/SQLite 与数据库均保持，未启动 TASK08
- SELFHOST-OPS-RESOURCE-GUARD-01 完成低资源永久规则、Python 16 活跃请求线程上限/有界 503、Compose 六服务 CPU/Memory/Swap/PID 限额、Web/Worker 384 MiB Node heap 和 systemd 源限额；PostgreSQL 备份校验、串行原镜像更新、60 秒 OOM/restart/Swap 观察和四卷保持通过。Python 当前 PID 未重启，资源保护不等于生产上线
- SELFHOST-PHASE2-TASK01 完成 docs-only 盘点：Python 共 64 个 HTTP 操作（GET 34、POST 30），自托管等价覆盖 4、部分覆盖 9、未覆盖 51；根 legacy iframe 登录后并发的 23 个业务 GET 在 Node/PostgreSQL 均返回 404。已提出 TASK02—TASK10 依赖顺序，全部仍待逐项授权；没有业务域因此完成迁移
- SELFHOST-PHASE2-TASK02 完成自托管身份安全边界：独立 Identity Repository/Service/Handler，用户创建/列表/启停/重置、本人改密、会话撤销、must-change 全局门禁、登录与身份写限流、持久幂等、CAS/最后管理员保护、有界系统审计和生产强制 Secure Cookie；`0006`、隔离 PostgreSQL 17、Compose 生命周期/重启与指定回归通过，未发布或部署
- SELFHOST-PHASE2-TASK03 完成自托管主数据与 BOM：`0007`、关系化 Customer/Supplier/Product/Product Version/BOM Header/Version/Line、稳定 Supplier Mapping/价格历史、发布不可变、结构 readiness、服务端能力/CSRF/幂等/CAS/限流/审计；隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.3`，未迁真实数据、部署或访问生产
- SELFHOST-PHASE2-TASK04 完成自托管通用库存账本：`0008`、稳定 Material/Unit ID、不可变 Ledger、事务余额投影、入/出/盘点、冻结/解冻、全额冲销、负库存/CAS/行锁/幂等/审计；隔离 migration、PostgreSQL/API、Compose 重启和适用回归通过，版本 `0.1.0-alpha.4`，未回填真实库存或实现下游业务单据
- SELFHOST-PHASE2-TASK05 完成自托管采购链路：`0009`、关系化 PO/Receipt/状态事件/财务来源、BOM 缺料建议、部分/全部收货和全额冲销；收货原子复用 TASK04 Ledger/Balance，隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.5`，未迁真实 PO/在途或创建应付/付款
- SELFHOST-PHASE2-TASK06 完成自托管生产链路：`0010`、关系化 WO/BOM 快照/需求/领退料/报工/完工；领退料和完工原子复用 TASK04 Ledger/Balance，隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.6`，未迁真实生产数据或创建品质/财务过账
- SELFHOST-PHASE2-TASK07 完成自托管销售链路：`0011`、关系化 Quote Version/Line/状态事件、ACCEPTED 原子转 SO、Shipment/全额冲销和稳定金额来源；发货/冲销原子复用 TASK04 Ledger/Balance，隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.7`，未迁真实销售数据或创建应收/收款/品质过账
- SELFHOST-PHASE2-TASK08 完成自托管品质闭环：`0012`、关系化 IQC/IPQC/FQC、Result/Defect/Event、异人处置/关闭/重开及 FQC 发货门禁；隔离 migration、PostgreSQL/API、Compose 重启和适用回归通过，版本 `0.1.0-alpha.8`，未迁真实检验数据或伪造 IQC 库存隔离
- SELFHOST-PHASE2-TASK09 完成自托管财务闭环：`0013`、稳定 Shipment/Receipt 金额来源 AR/AP、不可变 Receipt/Payment/Reversal/Event、余额/状态/version 投影及上游冲销门禁；隔离 migration、PostgreSQL/API、Compose 重启和适用回归通过，版本 `0.1.0-alpha.9`，未迁真实金额或实现银行/税务/发票/汇率/总账
- SELFHOST-PHASE2-TASK10 完成自托管经营与运维工作台：实时只读 Dashboard 按权限聚合 TASK02—TASK09 权威关系表，原生根退出 iframe，legacy 工作区改为显式白名单深链；离线 backup/verify/新空目标 restore、去敏只读状态、隔离恢复与 Compose 重启通过，版本 `0.1.0-alpha.10`，未新增 `0014`、未执行生产动作
- SELFHOST-PHASE3-TASK01 完成显式迁移 CLI、SQLite/D1 export adapter、PostgreSQL 隔离 staging、manifest、稳定 ID map、checkpoint、合成 dry-run/commit/reconcile、拒绝守卫和跨域恢复证据；版本 `0.1.0-alpha.11`，0001—0013 不变，真实数据与生产保持 NO-GO
- SELFHOST-PHASE3-TASK02 完成 `0014` 关系化 Migration Opening Source、库存期初 Ledger/Balance、财务 `OPENING_AR/AP`、一次全额冲销、内部事务入口及 Dashboard 汇总；MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`，版本 `0.1.0-alpha.12`，真实数据与生产保持 NO-GO
- SELFHOST-PHASE3-TASK03 完成受控 public materializer、actual target ID/provenance、合成文件、snapshot/archive 分类、正常全域 API/Dashboard、backup→新空目标 restore、同 manifest 重放与整栈重启；版本 `0.1.0-alpha.13`，migration 保持 `0001`—`0014`，结论仅为 `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`，真实数据与生产保持 NO-GO
- SELFHOST-PHASE3-TASK04 完成获准本机 SQLite online backup、integrity/Schema fingerprint、29 表 3,619 条脱敏聚合、无 PostgreSQL 目标 planner 和人工处置模板；源与 Python PID 不变，临时快照已删除，版本 `0.1.0-alpha.14`，migration 保持 `0001`—`0014`，结论仅为 `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`
- SELFHOST-PHASE3-TASK05 以 `chenyida-erp-parallel` 在同机启动 PostgreSQL 17/Web/Worker，Web 仅 `127.0.0.1:3000`、数据库无宿主端口；14 个 migration、管理员、空 Dashboard、23 GET、重启持久性和资源门禁通过，并修复 Worker 在 PostgreSQL 重启时的空闲连接未捕获错误。Python PID/18888/SQLite 元数据不变；仅为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`
- SELFHOST-PHASE4-TASK01 已在 `chenyida-erp-parallel` 交付 `0015`、独立 Project Service/API、市场/项目原生页面、不可变需求修订与交接事件；双账号直接接收和退回修订重提、重启持久、清理恢复及全回归通过。测试业务已清空，Schema/唯一管理员保留；不启动 TASK02
- SELFHOST-PHASE4-TASK02 已在 `chenyida-erp-parallel` 交付 `0.1.0-alpha.16`/`0016`、正式 planning 角色、显式 Requirement Resolution、不可变版本交接包/BOM/文件快照、独立 API 和 engineering/planning 原生页面；实际 v1 退回→修订 v2→重提→接收、重启持久与恢复清理通过，最终仅保留 Schema/唯一管理员，不启动 TASK03
- SELFHOST-PHASE4-TASK03 已在 `chenyida-erp-parallel` 交付 `0.1.0-alpha.17`/`0017`、固化包 Material+Unit 聚合、提交时 PostgreSQL numeric 锁定重算、独立库存/在途 Planning Allocation、不可变需求计划/采购申请、planning/purchase 原生页面与 Dashboard 待办；实际 v1 退回释放→v2 重算重提→采购接收、重启持久和恢复清理通过，正式 `reserved_qty` 不变且未创建新 PO/收货/工单，最终仅保留 Schema/唯一管理员
- SELFHOST-PHASE4-TASK04 已在 `chenyida-erp-parallel` 交付 `0.1.0-alpha.18`/`0018`、RFQ Round、不可变报价版本、服务端确定性比较、人工 Sourcing Award/撤销、独立 API/原生页面和 Dashboard 三项待办；A 高价准时、B 低价晚交的人工交期优先定标、重启持久和恢复清理通过，最终仅保留 18 migrations/唯一管理员，不创建 PO/收货/库存/应付，不启动 TASK05
- SELFHOST-PHASE4-TASK05 已在同一并行环境交付 `0.1.0-alpha.19`/`0019`、Award Line→PO Line、到货计划/待入库、Receipt 分配关系、分批收货、库存与财务来源、显式 AP 和三条原生页面；实际 `10×12` 分两批 `4/6`，来源/AP 为 `48/72`，重启与新空库恢复通过，最终仅保留 19 migrations/唯一管理员，未启动生产或品质
- SELFHOST-PHASE4-TASK06 已在同一并行环境交付 `0.1.0-alpha.20`/`0020`、版本化 Production Handoff、唯一工单链接和生产库存 Reservation/Event；实际 v1 退回→v2 接收、释放预留 10、分批领料 4/6、整栈重启、停服备份/新空库恢复和最终清理通过，报工/完工/成品/品质事实均为 0
- SELFHOST-PHASE4-TASK07 已在同一并行环境交付 `0.1.0-alpha.21`/`0021`、Report→Completion Allocation、基于净领料的报工支持量、分批成品入库和 Report/Completion 追加式全额冲销；实际 Report `4/6`、Completion/Allocation/Ledger `4/6`、成品 10、工单 COMPLETED，下游 0，整栈重启、双备份/新空库恢复和最终清理通过
- SELFHOST-PHASE4-TASK08 已在同一并行环境交付 `0.1.0-alpha.22`/`0022`，复用既有 Quality 权威建立 Completion Line→Sales Order Line 稳定 Allocation、IPQC/FQC 稳定来源、处置关闭和订单行放行额度；实际 Report/Completion/Allocation/IPQC/FQC 均为 `4/6`，FQC inspected/passed/released=10、available=10、成品库存保持 10，Shipment/销售金额来源/AR=0；整栈重启、停服备份/新空恢复和最终清理通过
- SELFHOST-PHASE4-TASK09 已在同一并行环境交付 `0.1.0-alpha.23`/`0023`，复用 Sales/Quality/Inventory/Finance 权威建立发货指令、Shipment Line→FQC Release 精确分配和显式 AR 交接；实际 Shipment/FQC `4/6`、成品库存 `10→6→0`、Sales Source/AR `80/120`、Settlement 0，整栈重启、停服备份/新空恢复和最终清理通过
- SELFHOST-PHASE4-TASK10 已在同一并行环境交付 `0.1.0-alpha.24`/`0024`，复用 Finance Settlement/Reversal 并沿稳定 Sales/Purchase Source 归属 Project/Currency；实际 AR `80/120`、AP `48/72`、收款 `30/50/120`、付款 `48/30/42`、来源 `200/120`、未结 0、净现金 80、UNATTRIBUTED 0，整栈重启、停服备份/新空恢复和最终清理通过，不宣称会计利润
- SELFHOST-PHASE5-TASK01 已在同一并行环境交付 `0.1.0-alpha.25`/`0025`、稳定 Work Center、Product Version Routing 审核发布与 Work Order Release 不可变 Routing Snapshot；实际四工作中心、v1→v2、两张工单分别固化 v1/v2、BOM/Reservation/Route Snapshot 原子，整栈重启、停服备份/新空恢复与清理通过，未执行工序或库存过账
- SELFHOST-PHASE5-TASK02 已在同一并行环境交付 `0.1.0-alpha.26`/`0026`、Snapshot Operation 权威派工、Run/Event/Report/Reversal 不可变事实和线性 WIP 投影；实际四工序以 `4/6` 两批贯穿，每工序 processed/good/scrap=`10/10/0`，工序间剩余 WIP 0、末工序待最终报工 10，Work Order 仍 IN_PROGRESS，Production Report/Completion/成品库存/IPQC/FQC 均为 0；重启、停服备份/新空恢复和最终清理通过
- SELFHOST-PHASE5-TASK03 已在同一并行环境交付 `0.1.0-alpha.27`/`0027`，以稳定 `production_report_operation_allocations` 消费末工序 Run Report good，复用既有 Production Report、Report Receipt Projection、warehouse Completion、Report→Completion Allocation 和 Inventory Ledger/Balance；实际 `4/6` 正式报工与 `4/6` 成品入库使 Work Order 达到 `10/10/10/0/10 COMPLETED`，IPQC/FQC/Shipment/Sales Source/AR 均为 0，冲销/并发/幂等/CAS/权限/故障门禁、重启、停服备份/新空恢复与最终清理通过
- SELFHOST-PHASE5-TASK04 已在同一并行环境交付 `0.1.0-alpha.28`/`0028`，Routing Operation 的 `NONE/IPQC` 随发布 digest 和 Work Order Snapshot 固化；显式稳定 Run Report 来源 IPQC 经 Result/Disposition/Close 后形成下游额度。实际 REFLOW good `4/6` 先 Hold 10、AOI available 0，再按 `4/6` 检验放行为 Hold `10→6→0`、AOI available `0→4→10`，最后复用 TASK03 Report/Completion/Ledger `4/6`、Balance 10、Work Order `COMPLETED`；重启、恢复和最终清理通过
- SELFHOST-PHASE5-TASK05 已在同一并行环境交付 `0.1.0-alpha.29`/`0029`，稳定 IPQC failed 形成唯一 NCR，quality 以不可变提交快照准备返工申请，production 接收/退回，manager/admin 可追加不写库存的最终工序 SCRAP。实际 inspected 10/passed 8/failed 2、AOI available 8、Hold 2、v1 RETURNED、v2 ACCEPTED、accepted rework 2、unresolved 0；未创建返工 Run、额外报工、成品库存或下游销售/财务事实，重启、恢复和最终清理通过
- SELFHOST-PHASE5-TASK06 已在同一并行环境交付 `0.1.0-alpha.30`/`0030`，复用既有 Operation Run/Report、Quality、WIP、Production Report、Completion 和 Inventory 权威执行显式返工。实际原检 `10/8/2/8`、REFLOW REWORK `2/2/0`、复检 `2/2/0/2`、AOI `8/2`、Ledger `+8/+2`、Balance 10，Execution COMPLETED、NCR RESOLVED；正常 REFLOW 加工次数 10+2 而净产品仍为 10，重启、固定第二库恢复和最终清理通过
- SELFHOST-PHASE5-TASK07 已在同一并行环境交付 `0.1.0-alpha.31`/`0031`，建立 Manufacturing Batch Set/Batch 身份、发布 digest、按 Batch 的 NORMAL/REWORK、WIP/Quality/NCR/Rework/Report/Completion/Inventory 关联和稳定 genealogy。实际 Batch A 4、Batch B 6；B 原检 `6/4/2/4`、同批返工 `2/2/0`、复检 `2/2/0/2`，REFLOW 加工次数 8 而净 Batch 量 6；两笔 Ledger `+4/+6` 的 `lot_code` 仍为空、MAIN Balance 10。生产批次谱系已建立，但仓库批次库存尚未启用；重启、固定第二库恢复和最终清理通过
- 多用户登录、会话、角色权限、密码修改、账号管理和操作审计
- 物料、供应商映射、CSV 导入、清洗队列和新物料建档基础流程
- 客户、供应商、产品、BOM 和 BOM 齐套分析
- 采购建议、采购订单、收货、库存余额和库存调整
- 工单、领料、完工和生产报工
- 询价、报价、销售订单和发货
- 品质检验、缺陷记录、财务单据、收付款和经营看板
- 本地备份/恢复入口及在线同库快照入口
- 根仓库可直接恢复 `chenyida_erp_site/` 完整源码；生产 `2b4f178` 与开发基线 `9f2c2dc` 的提交关系已保留
- development/test/production 统一环境清单、本机一次性 Miniflare D1、生产 URL 拒绝、测试数据销毁和凭证扫描基线
- Material Master V2 数据契约与迁移框架：12 张关系表、Drizzle schema、`0001` Up/Down、快照和隔离迁移测试；未接入业务或生产
- Material Master V2 行业基础：`material-category-v1` 提供 101 个四级分类节点、34 个属性定义、39 个叶子模板和 228 条显式绑定；只允许 test/local 初始化
- Material Master V2 独立物料校验：Repository + Rules + Service 三层按 D1 metadata 校验基础字段、四级叶子、必填、类型、单位和枚举；25 个结构化 code、28 个校验测试；已由草稿/审核写服务调用并通过 Draft/Review API 间接开放
- Material Master V2 草稿/审核写服务：六模块封装类型化属性、`DRAFT -> ACTIVE`、拒绝历史、版本/审计、编码序列 CAS、乐观锁及 metadata/属性守卫；12 个隔离 D1 服务测试通过，已由 Draft/Review API 调用，尚未接生产
- Material Master V2 Draft/Review/Lifecycle API：八个精确路由复用现有会话，支持完整替换编辑、提交/重新提交、审核队列、批准和驳回；实施细粒度权限、创建人/最后修改人职责分离、Origin/CSRF、24 小时持久幂等、60/20 限流、乐观锁、1095 天 API 审计及 `0002`/`0003` 隔离迁移；未接生产
- Material Master V2 Reference & Query API：方案 A 已实现统一 `/materials`、收紧 `/drafts` 行级可见性并保留独立 `/review-queue`；完整启用分类 tree/flat、四级叶子 Schema、内容摘要 ETag、有界详情摘要、独立历史分页、批量 metadata 与稳定错误均通过隔离测试；未接生产
- Material Detail 最近驳回投影：`/materials/:materialId` 与 `/drafts/:materialId` 复用统一 Query Service，从完整不可变 `material_versions` REJECT 历史按版本、审核时间和事件 ID 确定性 `LIMIT 1` 投影；无记录为 null，损坏历史 fail-closed；未改 Schema、migration、索引或写服务
- Material Master 只读管理界面 V1：四条原生 Vinext 路由实现高密度列表、分区详情、独立历史页签、URL 状态、安全返回、状态/属性/Validation 展示和完整加载/空/错误状态；legacy 与新页面共用浏览器请求边界和现有登录流程；未接生产
- Material Draft 创建、编辑与提交审核界面 V1：实现 `/materials/new`、`/materials/:materialId/edit`、布局 C、Schema 驱动五类属性与完整 PATCH、PATCH/GET/submit、权限入口、页面内存幂等安全重试、VERSION_CONFLICT 对照、Schema 漂移/未知属性/dirty/驳回信息保护；54 项 UI 验收与隔离浏览器链路通过，未改 API、Schema、Migration 或业务服务，未接生产
- Material Review Queue 与审核工作台 V1：实现 `/materials/review`、`/materials/:materialId/review`、服务端分页 URL 队列、方案 A 完整只读工作台、共享详情展示、批准/驳回、Validation 新鲜度确认、职责分离、页面内存幂等/结果未知/并发/离开保护及 51 项 UI 验收；未改 API、Schema、Migration、索引或业务服务，未接生产
- 自托管 Material Draft/Review/Active PostgreSQL 全链路：新增 `0002` 编码序列、状态/编码约束和历史/队列索引，独立 Repository/Service/API，固定审批状态机、类型化属性、职责分离、CSRF、24小时持久幂等、乐观锁、原子编码、版本/变更/审计及真实页面审计入口；隔离单元 6/6、UI契约 2/2、PostgreSQL/API 7/7、既有Material UI 142/142、Compose双用户审批和重启持久性通过；已随 `39946f6` 提交，未接生产
- 自托管 Import Mapping/版本/复用 PostgreSQL 全链路：新增 `0003`、parse run绑定、动态Catalog、源结构/metadata/mapping摘要、不可变确认快照、同批次版本/SUPERSEDED、跨批次复用/STALE、事务幂等与Event/Audit；Worker原子发布初始DRAFT，现有工作区显示版本历史和显式复用。专项规则3/3、UI2/2、PG/API6/6、旧数据升级1/1、Compose解析→v2确认与重启持久性通过；已随 `39946f6` 提交，未接生产
- 自托管行级 Normalizer 与 Normalization Review PostgreSQL 全链路：新增 `0004`，关系化保存核心字段候选、动态属性候选、lineage 和稳定 issue；独立 Repository/Service/API/Worker 支持 run history、同 run 重试、新版本重跑、取消、100 行分块暂存和 Job/业务结果同事务原子发布，现有 Review UI 支持历史切换和证据查看。专项 12/12、既有回归 41/41、空库/升级迁移、Compose v1→v2→取消及整栈重启持久性通过；已随 `39946f6` 提交，未创建 Draft、迁移真实数据或接生产
- 自托管 Material Import 人工复核 PostgreSQL 闭环：新增 `0005` 十一张关系表，分离 raw/candidate/manual effective，支持 Session/version、字段和动态属性 SET/CLEAR/REVERT 历史、Issue resolution、保留/排除、ACTIVE 精确绑定、Material Draft 人工选择、sealed finalization、100/50 行 Worker 分块、CAS/幂等/租约和失败恢复；调用 TASK01 Material Service 创建未编码 DRAFT，ACTIVE 不被修改。专项 13/13、101 行跨 chunk、既有回归、Compose 端到端及整栈重启持久性通过；已随 `39946f6` 提交，未迁移真实数据、接生产或部署
- Material Import Batch Foundation V1：12 项决定已批准；新增 `0004` 五表数据契约、Drizzle schema/快照/Down、可注入对象存储与 R2/内存适配器、10 MiB 流式 multipart、XLSX/CSV 文件级安全检查、六个 API、专用幂等、可恢复 Saga、权限/行级可见性、重复策略、取消和手工清理服务；未创建生产资源、Cron、迁移或部署
- Material Import Parser 与 Mapping V1：16 项决定已批准并完成非生产实现；新增 `0005` Up/受保护 Down、parse run/Sheet/Shared Strings/Outbox/Mapping 关系模型、有界 XLSX/CSV Parser、可注入调度与租约恢复、原子发布、Mapping 准备及七个 API；54 项专项与全量 Node 278/278 通过，未创建生产资源、执行生产迁移或部署
- Material Import Workspace UI V1：完成三条路由、状态驱动 Stepper、opaque cursor、文件预检、增量 SHA Worker、受控 multipart XHR、解析轮询/取消、Sheet/Rows/Header、三列 Mapping 保存/预览/确认和 confirmed 只读；UI-001—UI-100、50×256 Playwright 门禁与 Node 440/440 通过，未接生产
- Material Import Mapping Target Catalog V1：12 项决定已批准；实现批次作用域 `GET .../:batchId/mapping-targets`、BASIC/ATTRIBUTE/SPECIAL DTO、运行时 D1 ACTIVE 属性、共享 Target Registry 与 Metadata Snapshot/digest、有界搜索/cursor、read+map/行级可见性、no-store、读取限流和安全审计；51 项专项与全量 Node 339/339 通过，未改 Schema/Migration/前端或生产环境
- Material Import Normalization & Staging V1：16 项决定已批准；实现独立 normalization run、版本化 JSON 行快照、独立 issue、Mapping/Metadata 绑定、确定性类型与空值语义、Outbox/租约/心跳、原子 pointer 发布、不同 processor 版本重跑、取消清理、五个 API、权限/限流、`0006` Up/受保护 Down/Drizzle 快照及隔离测试；未创建 Draft/正式物料，未接生产
- Material Import Normalization Review UI V1：统一 Batch 工作区、七步 Stepper、`current_run/latest_attempt` 双轨状态、启动/重试/重跑/取消、Rows/Issues opaque cursor、批次作用域 Row Drawer、安全有界值、权限清理和 104 项测试已完成；50 Rows、100 Issues、200 Attributes、1366/700px 本地门禁通过，未改变 API/Schema/Migration/生产环境
- Internal Material Library V1：复用既有 `material_master` 而非创建第二套；`0007` 新增标准单位/别名、品牌/别名、Normalization Approval、Import Row→Draft 关联和重复候选，并为 Material 增加结构化单位、品牌及批次/文件/行来源外键；Approved Normalization 可经既有 Validation/Draft Service 创建无正式编码的 `DRAFT`，后续仍由既有人工提交/审核生成 `ACTIVE` 和正式编码；inspect/dry-run/commit/report、权限、CSRF、幂等、EXACT/HIGH_CONFIDENCE/POSSIBLE 候选及隔离测试已完成，未导入真实文件或接生产
- Material Import 真实数据治理增强：新增本地只读 `.xlsx/.csv` inspect，输出文件 SHA/大小、Sheet/CSV 行列、编码/分隔符、表头候选和可能标准字段且不回显业务行；Draft dry-run 显式返回分类/单位/品牌 `EXACT/MATCHED/NEEDS_REVIEW`，EXACT 重复直接阻断、HIGH_CONFIDENCE 保持待人工确认阻断，CLI 只输出整批安全计数汇总；未改 Schema/Migration 或导入任何真实/模板数据
- Material Import 多供应商自适应识别 V1：`0008` 在既有 Parser/Mapping/Normalization 上增加全部可见 Sheet、前 50 行、1～3 行及合并表头评分、集中别名、样本/Profile 加权、多来源规格、Canonical Row、可解释非数据行分类和空规格 Draft 阻断；后续 A118/V700 真实 BOM 促成错后缀告警兼容、BOM/变更记录分流和字段限定修正，全量 Node 593/593，未接生产
- A118/V700 真实 BOM 验证：V700 已高置信度选择 BOM 并识别规格/型号/数量；A118 已找到第 44 行表头和名称/规格/厂商料号/用量，但第 197～203 行延伸到 XFD，继续按 256 列门禁阻断且不静默截断；未提交样本、上传、dry-run 或创建 Draft
- 服务器本地 Excel/CSV 自适应导入：公网 Python 运行面接受 `.csv/.xlsx/.xls` 原始二进制，按内容签名解析全部 Sheet、前 50 行和 1～3 行合并表头，集中 Mapping 并确定性组合规格；本地 `0001` 保存批次、不可变原始行和 Canonical 来源/置信度，systemd 已使用项目虚拟环境部署
- A118/V700 正式 BOM 待审核入库：用户确认两份为正确表格后，`0002` 保存完整原文件归档和 warning；A118 314 行、V700 229 行进入清洗审核，543 行全部 `NEEDS_REVIEW`，内部物料数未变化
- 电容匹配测试基线：按项目负责人最终规格建立临时内部编码 1～5，结构化保存容量、误差、电压、封装和 PCS；清空旧 Cleaning Rows 后五条本地匹配均为对应编码、自动匹配 1.00
- 清洗审核匹配置信度排序：`/api/cleaning` 以白名单执行 newest/desc/asc 服务端排序，页面可切换高到低或低到高，同分按新记录优先
- 清洗审核安全清空：仅管理员可见和调用；双重确认后自动备份，在同一事务删除 Cleaning Rows 并写审计，保留 Batch/Raw/归档/物料/映射
- 规格唯一编号匹配：Description/物料型号进入 raw spec；名称不再参与编号评分，容量/阻值、误差、电压、封装等硬匹配，完整唯一才自动确认编号，部分唯一候选保持疑似，歧义不随机选码
- 1928C 分项规格匹配：原始规格、型号、描述、MPN 不先压成整体相似度文本；分别提取品类、封装、容量/阻值、耐压、误差、介质和 MPN，逐项硬比较并保存结构化 Cleaning 字段
- 清洗审核分项规格对照：来源与候选内部物料按同一组八项属性并排展示，未维护字段明确标识；厂商型号不再冒充规格，页面不承担匹配或确认规则
- 通用规格参数匹配：从规格/组合列/描述/名称中选择详细规格来源，保存完整 raw spec 和来源列；品类、封装、电气量、误差、材质和尺寸按类型化集合无序比较，MPN/品牌独立取证
- 规格精度门禁：大类不再构成编号证据；少于两类鉴别参数明确为“规格不足”，自动匹配要求双方至少三类参数、锚点、完整一致且候选唯一；扩展分数功率、范围、频率/阻抗、针数、间距、铜厚和接口等确定性参数

## 当前未完成模块

- `PENDING_APPROVAL` 兼容值的破坏性收缩尚未实施；必须在旧值计数为零、旧实例全部退出且取得生产授权后另建任务
- break-glass 紧急审批、多节点会签和自动生产审计归档/清理调度尚未设计或实现
- 在线导入中心的真实样本 Sheet/表头/字段召回率、规格提取误判率、逐行冲突人工处置和大规模查询容量验收
- 新物料多角色审核节点、冻结/停用状态机和其他待确认职责分离规则
- 动态属性、单位换算、替代料及客户专用料的下游拦截
- SQLite、在线 D1 和治理模板之间的受控迁移与核对
- 独立生产备份、生产恢复演练、远程 Test D1 和完整应用安全测试
- AI 治理、AI 采购、AI 报价、AI 生产辅助及行业知识库
- Material Master 只读页面尚未在生产 Site 发布；当前公开版本仍不具备本任务的新路由和查询 API
- Material Draft 页面尚未在生产 Site 发布；当前公开版本不具备创建、编辑或提交审核界面
- Material Review Queue 与审核工作台尚未在生产 Site 发布；当前公开版本不具备审核队列、批准或驳回工作台
- Material Import 已完成非生产 Normalization→Approval→Draft 闭环和本地文件 inspect；不自动分类、不自动建品牌、不自动合并。当前没有真实文件，HIGH_CONFIDENCE 候选只有阻断、尚无已审计的逐行解除流程；真实 dry-run、人工冲突处置、生产 Queue/binding、生产迁移和部署仍需独立授权
- 自托管人工复核、ACTIVE 绑定和 Material Draft Commit 已迁入 PostgreSQL；尚未进行脱敏真实供应商文件容量/冲突验收、旧数据试迁移、生产备份恢复或部署，Mapping 确认仍不会自动启动后续阶段
- Material Import Workspace 尚未在生产 Site 部署；生产公开版本不具备本任务三条路由。真实远程 R2/Queue、生产配额/冷启动、page_size=100 和低端终端容量仍未验收

## 当前风险

1. 历史 Site 记录为 `v3` / `2b4f178`，但本任务未访问公开 Site，不能据旧文档声称当前在线状态；该运行面只保留为迁移与行为证据。
2. 本地 SQLite 与在线 D1 存在两套数据模型和两套物料编号行为，尚未确认唯一权威源。
3. 在线业务数据大量保存在 `erp_records.data_json`，关系约束、查询能力和迁移能力有限。
4. 本地数据库已从 Excel 导入任务开始建立版本化迁移历史，但既有 26 张表仍是历史运行时建表基线；默认账号、弱口令和公网 HTTP 仍是开发服务器高风险项。
5. 历史在线导入实现把导入行直接归为新物料，没有执行供应商映射或候选匹配；该行为只作迁移风险证据。
6. 历史在线备份位于同一 D1 故障域，不能替代外部灾备。
7. 历史 D1 测试基线只覆盖本机一次性 D1；没有远程 Test D1 权限、配额和网络验收，自托管测试已转向隔离 PostgreSQL。
8. 历史 D1 V2 草稿/审核写服务具备认证授权、持久幂等和隔离测试，但从未据此取得生产迁移或部署结论；供应商历史有效期重叠和其他生命周期仍需应用层保证。
9. V1 分类模板已覆盖首批行业范围，但尚未经过真实物料样本试配；扩展必须新增 seed 版本，不得直接改写已发布版本或引入隐式继承。
10. 历史 D1 Material API 开发代码使用专用强幂等、CSRF、细粒度权限、职责分离和审计边界，但历史 Site 未部署对应 `0002`/`0003`；本任务未访问公开网址确认状态。V1 仍无多节点会签、break-glass 或自动审计归档调度。
11. `0003` 过渡约束仍接受 `PENDING_APPROVAL`，应用只写/只返回 `PENDING_REVIEW`，通用查询双读旧/新值；移除旧值必须另建收缩 migration，不能修改 `0003`。
12. TASK08 行级最小披露已在历史 D1 开发代码和隔离测试实现，但未部署到历史 Site；公开站点不能视为具备新查询 API 或收紧后的 `/drafts`。
13. 开发代码已增加真正的 `/materials/...` 页面路由，但未部署到历史 Site；公开网址不能视为具备这些页面。
14. legacy 与 Material 页面共用 `public/erp/api-client.js`；TASK10 后根页面已退出 iframe，`public/erp/` 仍是显式 legacy 工作区而不是全部业务已重写为原生 React 的证据。
15. `last_rejection` 与 Draft UI 已在非生产开发代码中完成，但未部署到历史 Site；不得把隔离实现与本地验收表述为公开站点能力。
16. 当前查询计划使用 `(material_id, version_no)` 唯一索引搜索单物料历史，没有专用 `event_type=REJECT` 索引；现阶段有界详情查询无需 migration，若单物料版本规模显著增长，需另建任务复测并审批索引。
17. 当前审核队列 API 可展示 `submitted_by`，但只支持 `creator` 筛选，不支持 `submitted_by` 筛选；V1 不提供该控件、不在前端全量筛选，后续可另立只读 API 候选任务。
18. Review UI 已在非生产开发代码完成并通过本机浏览器与隔离 D1 API 验证，但未部署到历史 Site；公开网址不能视为具备审核页面。
19. Material Import Batch Foundation 已在本地/隔离环境实现，但历史 `.openai/hosting.json` 的 `r2` 为 `null`，没有生产 R2 binding、bucket、生命周期或 Cron；历史 Site 未执行 `0004` 或部署本代码。10 MiB 是获批应用上限，不是容量结论。
20. Parser 栈 `@zip.js/zip.js@2.8.26 + sax-wasm@3.1.4 + 受限 OOXML` 与 `csv-parse@7.0.1` 已通过本机 Vinext、Miniflare、WASM、Web Streams、R2 Range 替身、Bundle 和内存门禁；这些是隔离验证，不等于真实生产 Queue/R2、远程配额、并发容量或冷启动已经验收。
21. 独立只读 Catalog 与 Import Workspace 已在非生产代码实现；50×256 本地 Chromium 门禁已通过，但这不是远程网络、并发、低端设备或冷启动容量结论，历史 Site 未部署。
22. Normalization 的 50,000 行、256 KiB/行、256 MiB/批、20 issue/行和 200,000 issue/批是 V1 应用保护上限，不是生产容量结论；自托管 PostgreSQL 的真实容量仍需独立压测和授权。
23. Normalization Review UI 已完成非生产前端与本地门禁，但 Issue API 仍无 `normalized_row_id`/Sheet 精确筛选，Drawer 内完整行 Issue 集合继续属于局部门禁；完整 Run 历史、Batch Current Pointer、部分筛选和列表候选摘要也未暴露。前端已明确降级且未推断；本地 1366×768、700px、50 Rows、100 Issues、200 Attributes 与有界 Payload 结果不等于远程生产容量结论。
24. 历史 D1 `0007` 和 Import→Draft 只在一次性 Miniflare 验证；品牌正式数据尚未初始化，仓库内只发现治理模板/样例。候选扫描上限 500、输出 20；HIGH_CONFIDENCE 逐行人工确认解除、真实召回率和规模容量尚未验收。
25. A118/V700 的 543 条旧 Cleaning Rows 已按项目负责人指令清空；2 个 Batch、766 条 Raw Rows 和完整原文件仍保留。重新导入会建立新清洗结果，且缺单位/空规格门禁仍然有效。
26. 内部编码 1～5 是开发匹配测试编号，不是正式编码规则；正式投用前必须迁移到批准的 `CYD-*` 编码或记录保留决定。
27. 三份新 BOM 共 221 条清洗候选，216 条有规格；当前 1～5 内部库未覆盖这些完整规格。J587 有 5 条缺误差，只能定位到编号 1/2/3 候选集合，不能唯一给号。
28. 1928C 当前网页导入的 25 条 Cleaning 产生于旧进程，不会由 Migration 静默重算；必须清空后重导才使用分项规格机制。截图中的 10PF 完整规格不在当前内部测试库，仍需人工建档生成编号。
29. 当前 25 条 1928C Cleaning 的分项字段可直接展示，但旧行保存的 raw spec/匹配置信度不会静默重算；重新导入后才使用“型号与规格分离”和缺失介质时最高 0.95 的新结果。
30. 任意未来供应商可能使用当前词法尚未定义的规格语法，不能承诺未知输入 100% 自动识别；系统通过证据门禁保证不确定时不返回候选编号，新增真实反例必须进入回归夹具后再扩展确定性解析。
31. 自托管 Material Draft/Review/Active 已通过一次性 PostgreSQL 17 和 Compose 隔离验证，但尚未迁移真实 D1/SQLite 数据、执行生产容量测试或生产恢复演练；旧 D1/Miniflare 代码只作历史参照，不能重新接入运行依赖。
32. TASK02—TASK10 已完成 Node/PostgreSQL 自托管非生产链路、实时 Dashboard 与离线备份恢复治理；真实数据仍在 Python/SQLite 开发运行面，尚未试迁移、容量验收或生产恢复演练，因此不能描述为业务已切换或已投产。
33. 根自托管页面已退出 legacy iframe；`public/erp/` 仍保留为显式业务工作区和回滚证据。64 个盘点操作及 23 个 legacy 刷新 GET 已有自托管覆盖或明确退役合同，但这不等于全部 UI 已重写为原生 React。
34. TASK01 staging、TASK02 Opening 与 TASK03 public materialization 仍只在合成 `_migration_test` 验证；TASK04 已完成获准真实快照的 Schema/聚合质量与无目标 planner，但没有连接目标、物化、逐行业务处置、附件核对或容量验收，不能据此宣布真实迁移或生产 Go-Live。
35. TASK05 环境使用 development Cookie 和明文 HTTP，因此严格只绑定回环并通过 SSH 隧道验收；它没有 HTTPS、域名、真实数据、生产恢复或流量切换批准。管理员首次登录后必须改密并删除 root-only 临时凭据文件。

## 当前任务与下一任务

- 当前无 `DOING`；`SELFHOST-PHASE5-TASK06` 已完成 ACCEPTED Request→显式 REWORK Run→复检放行→AOI 8/2→成品 10 的并行验收并恢复干净 `0030`。
- 2026-07-27 服务器重启/不可用的根因保持 `UNKNOWN`，不得无证据归因 OOM；资源保护不等于生产上线。
- `SELFHOST-PHASE5-TASK06` 已完成原检 10/8/2/8、返工 2、复检 2/2/0/2、AOI 8/2、正式报工/完工/成品 8/2；Execution COMPLETED、NCR RESOLVED，FQC/Shipment/AR/Settlement 保持 0。
- `PHASE0-TASK03`、`SELFHOST-PHASE4-TASK05`—`TASK09` 保持历史 `DONE`；TASK10 功能提交严格基于授权起点 `e63c726e`。
- 本轮完成后停止，不启动 PHASE5-TASK07。返工补料、SCRAP 库存、自动补产、批次/序列、设备/OEE、外协、产能排程、工时/成本、真实数据迁移和生产部署均未授权。
- 已完成：`SELFHOST-PHASE4-TASK05`，并行环境 `0.1.0-alpha.19`/`0019` 完成 Award→PO→到货计划→两批 Receipt `4/6`→库存 `10`→采购来源 `48/72`→显式 AP `48/72`，权限、幂等、CAS、超收、冲销阻断、重启、备份恢复与清理通过；结论 `SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。
- 已完成：`SELFHOST-PHASE4-TASK04`，并行环境 `0.1.0-alpha.18`/`0018` 完成两供应商 RFQ、报价、服务端比较和人工非最低价定标；A `12.000000`/准时/排名 2，B `10.000000`/晚交/排名 1，以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”选择 A。Award=1 时全部下游写入为 0，重启持久和清理恢复通过；结论 `PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`。
- 已完成：`SELFHOST-PHASE4-TASK03`，并行环境 `0.1.0-alpha.17`/`0017` 的固化包聚合、库存/在途独立分配、不可变需求计划与采购申请、v1 退回释放→v2 重算重提→最终接收、重启持久和清理恢复通过；结论 `PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。现在停止，不自动启动 TASK04。
- 已完成：`SELFHOST-PHASE4-TASK02`，并行环境 `0.1.0-alpha.16`/`0016` 的 planning 角色、显式 Requirement Resolution、不可变计划交接包、v1 退回→修订 v2→重提→接收、重启持久和清理恢复通过；结论 `PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。TASK03 后续已由独立授权和模型完成，不改写 TASK02 事实。
- 已完成：`SELFHOST-PHASE4-TASK01`，并行环境 `0.1.0-alpha.15`/`0015` 的市场→项目闭环、重启持久和清理恢复通过；结论 `MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`，既有事实不由 TASK02 改写。
- 已完成：`SELFHOST-PHASE3-TASK05`，在保留 Python/SQLite 的同时以 `chenyida-erp-parallel` 运行 PostgreSQL 17、Web 和 Worker；`127.0.0.1:3000`、14 migrations、空环境管理员、23 GET、重启与资源验收通过。版本保持 `0.1.0-alpha.14`，未创建 `0015`；结论仅为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`，不自动开始真实数据迁移、HTTPS 或切流。
- 已完成：`SELFHOST-PHASE3-TASK04`，对唯一获准的本机 SQLite 执行一次一致性只读快照、脱敏聚合盘点和无目标 Dry-run；快照已删除，源与 Python PID 不变，未读文件正文或写 PostgreSQL。版本 `0.1.0-alpha.14`，migration 保持 `0001`—`0014`；不自动开始真实试迁移或生产任务。
- 已完成：`SELFHOST-PHASE3-TASK02`，新增 PostgreSQL `0014` 与受控 Inventory/Finance Opening，合成物化、冲销、幂等、并发、Dashboard、Compose 重启和备份恢复通过。MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`，版本 `0.1.0-alpha.12`；不自动开始下一任务，真实数据与生产仍为 `NO-GO FOR REAL DATA / PRODUCTION`。
- 已完成：`SELFHOST-PHASE3-TASK01`，建立只允许临时合成源和回环 `_migration_test` PostgreSQL 的迁移准备工具；中断恢复、重复执行、摘要失效、backup/restore、整栈重启及全回归通过。版本为非生产 `0.1.0-alpha.11`，业务 migration 仍为 `0001`—`0013`。不自动开始真实数据或生产任务。
- 已完成：`SELFHOST-PHASE2-TASK10`，新增实时权限裁剪 Dashboard、原生根工作台、显式 legacy 深链和离线 backup/verify/新空目标 restore；隔离 PostgreSQL 恢复、Compose 重启及适用全回归通过，版本为非生产 `0.1.0-alpha.10`，migration 仍为 `0001`—`0013`。不自动开始下一任务；真实数据与生产动作须另立任务授权。
- 已完成：`SELFHOST-PHASE2-TASK09`，新增 PostgreSQL `0013`、稳定 Shipment/Receipt 来源 AR/AP、不可变 Settlement/Reversal/Event 和受控余额投影；财务过账后上游来源冲销 fail closed，版本为非生产 `0.1.0-alpha.9`，未迁真实金额、实现银行/税务/发票/汇率/总账、部署或访问生产。下一任务从 clean 工作区进入 TASK10。
- 已完成：`SELFHOST-PHASE2-TASK08`，新增 PostgreSQL `0012`、关系化 IQC/IPQC/FQC、Result/Defect/Event；异人处置/关闭/重开与 FQC 发货额度门禁由服务端和数据库共同约束，版本为非生产 `0.1.0-alpha.8`，未迁真实检验数据、实现 IQC 库存批次隔离、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK07`，新增 PostgreSQL `0011`、关系化 Quote/SO/Shipment/Financial Source；ACCEPTED 转单及发货/冲销与 TASK04 Ledger/Balance、状态、审计、幂等同事务，版本为非生产 `0.1.0-alpha.7`，未迁真实销售数据、创建应收/收款/品质过账、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK05`，新增 PostgreSQL `0009`、关系化 PO/Receipt/状态事件/财务来源、缺料建议、部分/全部收货和全额冲销；收货与 TASK04 Ledger/Balance、审计、幂等同事务，版本为非生产 `0.1.0-alpha.5`，未迁真实 PO/在途、创建 AP、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK04`，新增 PostgreSQL `0008`、不可变库存 Ledger、事务余额投影、通用调整/冻结/冲销和真实 BOM shortage 投影；版本更新为非生产 `0.1.0-alpha.4`，专项、migration、Compose 重启和适用回归通过，未回填真实库存、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK03`，新增 PostgreSQL `0007`、关系化 Customer/Supplier/Product/BOM 与 Supplier Mapping/价格历史，发布版本不可变，readiness 在 TASK04 前只做结构检查；版本更新为非生产 `0.1.0-alpha.3`，专项、migration、Compose 重启和回归通过，未迁移真实数据、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK02`，补齐自托管身份、用户、密码、会话撤销、限流、持久幂等和系统审计；版本更新为非生产 `0.1.0-alpha.2`，未迁移真实用户、未部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK01`，只读盘点 Python 64 个 HTTP 操作、页面调用、权限、表、事务、审计、过账风险与自托管覆盖，确认 legacy iframe 登录后 23 个业务 GET 全部 404，并提出 TASK02—TASK10 建议顺序；仅文档，未实施 API、Schema、migration、依赖、部署或生产动作。
- 已完成：`PHASE0-TASK03`，2026-07-24 建立 `RELEASES.md`、三套 migration SHA-256、`0.1.0-alpha.1` 原始非生产版本、发布验收和回退模板；2026-07-26 追加复核当前 `0.1.0-alpha.19`/PostgreSQL `0001`—`0019`、本地 Git 领先远端 27 个提交、双开发运行面和真实业务仍依赖 Python/SQLite，未访问或修改生产。
- 已完成：`SELFHOST-PHASE1-TASK04`，把独立人工覆盖、Issue 处置、ACTIVE 精确绑定、Material Service 建 DRAFT 和可恢复 finalization 移植到 PostgreSQL；专项、回归、migration 与 Compose 验收通过，后续已随 `39946f6` 提交，未连接生产、迁移真实数据或部署。
- 已完成：`SELFHOST-PHASE1-TASK01`，把 Material Draft/Review/Active 完整移植到 PostgreSQL Repository、自托管 API 和现有页面；编码并发、职责分离、幂等/乐观锁/CSRF、版本/变更/审计及 Compose 重启持久性通过，后续已随 `39946f6` 提交，未连接生产或部署。
- 已完成：`SELFHOST-PHASE1-TASK02`，把 Import Mapping、动态目标目录、确认快照、版本/SUPERSEDED、跨批次复用/STALE、Worker准备和现有页面移植到 PostgreSQL 自托管链路；专项、回归、迁移和 Compose 重启持久性通过，后续已随 `39946f6` 提交，未连接生产或部署。
- 已完成：`SELFHOST-PHASE1-TASK03`，把行级 Normalizer、核心/动态属性候选、lineage、稳定 issues、重试/重跑/取消、原子发布和 Review UI 移植到 PostgreSQL 自托管链路；专项 12/12、回归 41/41、迁移和 Compose 重启持久性通过，后续已随 `39946f6` 提交，未创建 Draft、迁移真实数据、连接生产或部署。
- 已完成：`PHASE0-TASK01-B`，把 Site gitlink 转为根仓库直接跟踪的普通目录，保留生产版本、开发基线和提交历史关系；未修改业务代码或生产环境。
- 已完成：`PHASE0-TASK02`，以本机一次性 Miniflare D1 建立生产地址拒绝、测试数据销毁、去敏失败日志、凭证扫描和临时 SQLite 备份恢复验证；未创建云端资源、未连接或修改生产 D1。
- 已完成：`PHASE1-TASK01`，数据模型及正式编码、生命周期、变更日志、供应商映射时效唯一性调整已获批准。
- 已完成：`PHASE1-TASK02`，新增关系化 schema、版本化 Up/Down、Drizzle 快照和隔离迁移测试；未改 API、未迁移数据、未连接生产 D1。
- 已完成：`PHASE1-TASK03`，新增版本化行业分类、属性定义、显式叶子绑定、本地事务 seed 与幂等测试；未改 migration、API 或下游业务，未连接生产 D1。
- 已完成：`PHASE1-TASK04`，新增 Repository + Rules + Service 三层物料校验模块、Memory Repository、隔离 D1 metadata 变化测试和 25 个结构化 code；未接 API、未写真实物料、未连接生产 D1。
- 已完成：`PHASE1-TASK05`，新增 Material Master Draft/Review/Code 服务，以 D1 batch 原子创建草稿、批准启用、拒绝、生成编码、保存类型化属性、版本和审计，并用乐观锁、规则 CAS 及 metadata/属性守卫处理并发；未接 API、未改 migration、未连接生产 D1。
- 已完成：`PHASE1-TASK06`，项目负责人确认审核角色、自审、单步审核、24 小时幂等、60/20 限流、1095 天审计和 MANUAL 来源边界；五个 API、`0002`、只读 Query、事务伴随幂等/审计及隔离测试已完成，全量 Node 58/58 和本机 API smoke 通过，未接生产。
- 已完成：`PHASE1-TASK07`，九项方案 A 已记录并实现；草稿完整替换、提交/驳回/再编辑/重新提交、`PENDING_REVIEW`、审核队列、职责分离、并发/幂等、版本审计和 `0003` 隔离迁移测试通过。
- 已完成：`PHASE1-TASK08` 规格确认及非生产实施；统一查询、Reference、drafts 兼容、行级可见性、缓存、历史分页、稳定错误和批量 metadata 通过测试，1k/10k/100k 查询计划报告完成，未创建索引 migration。
- 已完成：`PHASE1-TASK09` 规格确认及非生产实施；四条原生页面路由、高密度列表、分区详情、独立历史页签、URL 状态、安全 return_to、共享请求边界和现有登录回跳通过测试；未修改 API、schema、migration、索引或业务服务。
- 已完成：`PHASE1-TASK10` 书面规格与低保真线框设计；确认布局 C、动态 Schema、完整替换、PATCH/GET/submit、权限、Validation、Schema 漂移、幂等、并发、dirty 和测试边界；未实施前端、API、schema、migration 或业务服务。
- 已完成：`PHASE1-TASK11` 非生产实现；统一详情从完整 REJECT 版本历史确定性返回 `last_rejection`，materials/drafts 共享查询，隔离测试和查询计划通过；未改 schema/migration/索引/写服务，未接生产。
- 已完成：`PHASE1-TASK12` 非生产实现；Material Draft 创建、编辑和提交审核页面、动态 Schema、权限入口、完整替换、写状态机、Validation、冲突/dirty/未知属性保护与 54 项 UI 验收通过；未改 API/schema/migration/业务服务，未接生产。
- 已完成：`PHASE1-TASK13` 书面规格与低保真线框设计；确认布局 A、队列恢复、能力权限、职责分离、批准/驳回、Validation 确认新鲜度、错误和 51 项实施测试边界；未实施前端、API、schema、migration、索引或部署配置。
- 已完成：`PHASE1-TASK14` 非生产实现；审核队列、方案 A 单条工作台、共享只读详情、批准/驳回、Validation 确认、职责分离、页面内存幂等/并发/离开保护和 51 项 UI 验收通过；未改 API/schema/migration/索引/业务服务，未接生产。
- 已完成：`PHASE3-MATERIAL-LIBRARY-01` 审计与非生产实现；复用既有 Material Master/Import/Normalization/Review，新增 `0007` 标准单位、品牌、来源关联和重复候选，接通 Approval→Draft；全量 Node 569/569、build、隔离 API smoke、Drizzle、凭证和临时 SQLite 基线通过；真实文件 dry-run、生产迁移和部署未执行。
- 已完成：`PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT` 非生产实现；功能提交 `41e293f` 复用既有导入链路，新增 `0008`、Sheet/多行合并表头评分、集中 Mapping、Supplier Profile、多列规格、Canonical Row、非数据行排除和空规格阻断；Node 589/589 及完整隔离基线通过，未连接生产。
- 已完成：`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01`；功能提交 `cea940a` 只读验证 A118/V700，修正错后缀 XLSX、BOM/变更记录 Sheet 评分、厂商料号限定、“用量”和安全错误；Node 593/593，未提交真实附件或连接生产。
- 已完成并部署开发服务器：`PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT`；实际 Python 网页支持 CSV/XLSX/XLS，保存批次、不可变 Raw Rows、Mapping/规格置信度和 Review 状态；专项 9/9、联合单元 13/13、self-test、smoke、go-live 和公网静态资源检查通过。
- 已完成并受控入库：`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02`；A118/V700 完整原文件归档，543 条清洗行全部待审核，内部物料未自动增加。
- 已完成开发匹配基线：`PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01`；备份后清空 543 条旧 Cleaning Rows，建立内部编码 1～5 的五条电容，匹配均为 1.00；原始归档未删除。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01`；清洗列表支持匹配置信度升降序，服务端先排序后限制，页面切换只刷新清洗数据。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01`；管理员可在自动备份和双重确认后清空 Cleaning Rows，真实 229 条在部署时未被自动删除。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-SPEC-MATCH-01`；三份新 BOM 可进入规格清洗，名称与编号匹配解耦，完整唯一规格才自动确认内部编号，部分唯一候选保持疑似。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-STRUCTURED-SPEC-MATCH-01`；1928C 从型号、描述等独立来源逐项提取规格，单项冲突淘汰候选，缺少内部规格时不假装匹配。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-REVIEW-SPEC-DISPLAY-01`；清洗审核写出来源与候选两侧分项规格，型号/MPN 与规格分离，人工可直接核对缺项。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-GENERAL-SPEC-MATCH-01`；通用参数提取覆盖电容/电阻/电感及常见工程量，参数顺序不影响相似度，规格来源和逐项证据保存于既有 Cleaning。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-SPEC-PRECISION-GATE-01`；规格大类不再单独产生候选，证据不足明确拦截，自动匹配要求完整唯一规格；J587 隔离回归中的 4 条连接器大类误候选已消除。
- 已完成：旧式 Excel 兼容增强；网页预检、上传安全、inspect 和现有 Parser Worker 支持 `.xls`，通过有界 OLE/BIFF 读取器转换为现有 Raw Row 契约；`.xlsx` 仍走 OOXML，未新增导入系统、表或生产部署。
- 方向变更：根据 D-028，后续默认交付运行面改为服务器本地 `chenyida_erp_app`；根据 D-029，本次公网验证绑定 `0.0.0.0:18888`，目标地址为 `http://43.135.157.211:18888`。`chenyida_erp_site` 不再作为后续新功能的默认整合和部署目标。
- 常驻状态：根据 D-030，开发服务器由 systemd `chenyida-erp.service` 托管，当前 `enabled/active`，支持开机自启和失败重启；正式投用时再迁移到公司服务器。
- 当前受阻：`PHASE3-MATERIAL-LIBRARY-02` 已从无数据模式进入真实样本审阅；A118 需重新导出以移除 XFD 异常块，V700 需人工确认标准名称和单位来源，故仍未执行真实 dry-run 或创建 DRAFT。
- 已完成：`PHASE2-TASK01` 正式书面规格、OpenAPI 草案、数据流图与 12 项 `PROPOSED` 决策表；定义存储/安全分离、批次级协调、原始行契约、权限、幂等、保留、清理和 Migration 设计；仅文档，停止等待“规格确认”。
- 已完成：`PHASE2-TASK02` 非生产实现；`0004`、对象存储抽象、R2/内存适配器、流式上传、安全检查、六个 API、专用幂等、Saga、取消和清理服务通过 Node 224/224 与隔离 D1/R2 替身测试；未创建或访问生产资源。
- 已完成：`PHASE2-TASK03` 正式书面规格、OpenAPI 草案、流程图、Mapping 规格和 16 项决定；定义 Outbox、Sheet 级恢复、原子发布、Shared Strings/总字节预算、Mapping 准备恢复与 `0005` 设计。
- 已完成：`PHASE2-TASK04` 非生产实现；`0005`、Parser、Outbox/调度抽象、租约恢复、Shared Strings 分块、原始行发布、Mapping 准备与七个 API 已通过 54 项专项和全量 Node 278/278；未创建或连接生产 Queue/R2/D1，未部署，也未创建 Material Draft 或正式物料。
- 已完成：`PHASE2-TASK05` Material Import Workspace UI V1 正式规格、22 状态线框、状态矩阵、100 项未来实施测试和 16 项决定；完整规格与决定已确认，仅文档，未修改运行时、API、Schema、Migration 或生产配置。
- 已完成：`PHASE2-MAINT-01` 在共享 breakpoint-aware 测试辅助层忽略空白及纯注释 SQL 片段，同时原样保留可执行片段；`0003`、`0004`、`0005` Down 和全量 Node 288/288 通过，未改变 Migration 业务语义。
- 已完成：`PHASE2-TASK06` Mapping Target Catalog V1 正式规格与 OpenAPI；比较批次/全局/混入 Mapping 三种路由，推荐批次作用域，定义共享 Registry/digest、BASIC/ATTRIBUTE/SPECIAL DTO、统一 cursor、权限/缓存/失效目标边界和 43 项未来测试；设计提交时 12 项决定为 `PROPOSED`，现已由 TASK07 批准。
- 已完成：`PHASE2-TASK07` 批准 12 项 Catalog 决定并完成非生产实现；共享 Registry/Snapshot/digest 被 Mapping 准备、保存、preview、confirm 与 Catalog 共用，51 项专项和全量 Node 339/339 通过，Catalog UI 门禁标记 `RESOLVED`；未改 Schema/Migration/前端或生产环境。
- 已完成：`PHASE2-TASK08` 非生产 Import Workspace UI；三条路由、SHA Worker、共享 XHR、轮询/取消、Rows/Header、Catalog/Mapping、UI-001—UI-100 与 50×256 Playwright 门禁通过；全量 Node 440/440，未改后端 API、Schema/Migration、Metadata 或生产环境。
- 已完成：`PHASE3-TASK01` Material Import Normalization & Staging V1 正式规格、OpenAPI 草案和数据流/状态图；16 项决定保持 `PROPOSED`，仅文档，未实施代码、Schema、Migration、API、前端或生产资源。
- 已完成：`PHASE3-TASK02` 批准全部 16 项决定并完成非生产 Normalization 服务、`0006`、五个 API、权限/限流/取消、隔离迁移与集成测试；未创建 Draft/正式物料，未迁移或部署生产。
- 已完成：`PHASE3-TASK03` Material Import Normalization Review UI V1 docs-only 设计与正式规格确认；四份正式文档覆盖统一路由、七步 Stepper、启动/轮询/取消、Current/Latest、Rows/Drawer/Issues、37 个线框、104 项测试、局部门禁和性能门禁，14 项决定均为 `APPROVED`；未实施运行时代码或改变生产环境。
- 已完成：`PHASE3-TASK04` Material Import Normalization Review UI V1 非生产实施；统一工作区、七步 Stepper、Current/Latest、冻结幂等与 `RESULT_UNKNOWN`、2/5/10 轮询、取消、汇总、Rows/Issues cursor、Row Drawer、安全有界渲染和权限清理均已落地；104/104 计划测试、100/100 Import UI 回归及本地 Playwright 性能/可访问性门禁通过，未改 API/Schema/Migration/业务服务或生产环境。
- 下一：停止。品质创建、销售发货、财务、真实数据迁移、生产备份恢复、部署/切换均须后续独立任务和明确授权。

## 更新规则

每个任务完成前必须更新本文件中的当前提交、阶段、任务、下一任务、完成模块、未完成模块和风险。只写已从代码、Git、数据库只读检查或平台状态确认的事实；计划和建议必须明确标注为计划或待确认。
