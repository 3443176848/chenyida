# SELFHOST-SMALL-TEAM-GOLDEN-JOURNEY-READINESS-87 小团队黄金旅程就绪核验

> 状态：`DONE / 9 READY + ST-04 FIX_REQUIRED / SOURCE-AND-ISOLATED-POSTGRES VERIFIED / PRODUCTION NO-GO`
> 日期：2026-08-23（Asia/Shanghai）
> 依赖：TASK86、D-167、[小团队V1业务基线](../business/small-team-v1-baseline.md)、低资源服务器保护规则
> 责任：Codex执行源码映射、隔离验证和缺口归类；项目负责人后续提供真实业务样本并授权员工UAT

## 1. 目标

以alpha.47/0046现有源码为唯一输入，把ST-01—ST-10逐条映射到页面、API、服务端Service、关系表/Migration和自动测试，并在隔离PostgreSQL中运行现有黄金旅程验证。输出只允许使用`READY / FIX_REQUIRED / PARKED`：

- `READY`：现有源码和隔离动态证据足以进入后续真实样本/UAT核验；不代表已投产。
- `FIX_REQUIRED`：存在阻断V1闭环的可复现P0断点，必须另立单一实施任务。
- `PARKED`：不属于小团队V1、依赖尚未授权的真实数据/员工动作，或仅是可选增强。

## 2. 第一性原则

- 验证跨岗位事实是否守恒和可追溯，不按页面、表或历史任务数量打分。
- 优先复用现有代码和测试；只有动态证据证明P0后，才允许规划最小修复。
- 一个ST含多个环节时逐段列证据；局部单元测试、表存在或页面可见不能单独把整条ST判为`READY`。
- 本任务不把每职能2人或总人数18写入账号、权限、Seed、并发、Schema或断言。

## 3. 允许范围

- 只读盘点`chenyida_erp_site`的页面、API dispatcher、Service、Migration和测试。
- 运行不连接外部网络的Node/Python合同测试。
- 同一时刻最多运行一个串行、临时、隔离PostgreSQL实例或测试容器；测试数据、容器、网络和临时目录必须在结束后精确清理。
- 新增就绪度报告和任务治理文档；如需改测试或业务代码，必须由本任务证明确切P0后另立任务。

## 4. 禁止范围

- 不连接或修改现有UAT/生产数据库、四个受保护Volume、真实备份、凭据或业务数据。
- 不运行build、部署、Compose重启、host activation、真实Migration、账号创建或员工UAT。
- 不修改既有Migration、Schema、业务API、权限矩阵或产品页面；不恢复TASK59—TASK82、TASK70、R2—R5或AI路线。
- 不把合成测试解释成真实数据迁移、员工验收、恢复演练或生产准入。

## 5. 验收标准

- ST-01—ST-10均有精确源码证据、动态测试证据、当前状态、阻断和后续动作。
- 至少运行现有全ERP隔离PostgreSQL smoke；若脚本自身无法覆盖某段，必须如实记录缺口，不能以其他局部测试冒充。
- 输出一个按业务交接排序的最小P0清单；没有动态P0时不得创建功能任务。
- 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG和STATUS，记录资源、OOM/restart和临时资源清理结果，创建独立Git提交；不push、不部署。

## 6. 核验口径与运行边界

- 权威源码固定为当前`alpha.47`、Migration `0001`—`0046`；隔离PostgreSQL 17.10实际应用46项Migration，业务Snapshot为233张表，另加`schema_migrations`执行台账后`public`共234张表。
- 页面和Dispatcher只证明入口存在；本轮另对44个相关Unit/UI合同文件串行运行，结果`194/194 PASS`。
- 现代业务Service在全新隔离库中逐套串行运行，`TZ=UTC`共`99/99 PASS`；每套测试使用独立克隆，不能解释为同一数据库中的一条连续现代黄金旅程。
- ST-01又在全新隔离库运行当前主数据PostgreSQL套件`6/6 PASS`。首次准备继续运行Supplier Mapping PostgreSQL `10`项时，根盘只比10 GiB硬线高约3.5 MiB，按规则停止并清理；清理后空间自然恢复，重新执行完整资源门通过，随后在另一全新隔离库补跑`10/10 PASS`。没有清理Docker cache、镜像、容器、Volume或其他非任务对象。
- 未连接UAT/生产数据库，未读取四个受保护Volume、真实备份、凭据或业务数据；未build、pull、Migration UAT、Compose重启、部署、账号创建或员工UAT。

## 7. ST-01—ST-10就绪矩阵

`READY`只表示可进入真实样本/UAT，不表示已经投产或完成员工签收。

| 编号 | 页面、API与Service证据 | Migration/关系边界 | 本轮动态证据 | 结论与后续动作 |
| --- | --- | --- | --- | --- |
| ST-01 | `app/materials/*`、`public/erp/index.html`兼容主数据工作区、`app/procurement/supplier-mappings`；`master-data-selfhost`、`bom-selfhost`、`material-master`、`supplier-mapping-selfhost`及`selfhost-api.ts`服务端分发 | `0002`、`0007`、`0025`、`0035`、`0038`；物料、单位、客户、供应商、Product/BOM/Routing版本及Mapping版本/审核/Event | 主数据PG `6/6`、Supplier Mapping PG `10/10`、Routing `2/2`、相关Unit/UI计入`194/194`；全链动态确认旧`POST /api/mappings`被`409 SUPPLIER_MAPPING_GOVERNANCE_REQUIRED`正确退役 | `READY`。真实样本/UAT仍须以实名岗位完成现代Mapping草稿→提交→异人审核；现有整链脚本不得再调用旧直写接口 |
| ST-02 | `app/business/projects`、`app/engineering/projects`；`project-selfhost`项目需求版本、资料引用、工程接收/退回API | `0015_market_project_handoff.sql`；Project、Requirement Version/Item、Attachment Reference与Event | Project PG `5/5` | `READY`。进入市场→工程真实样本验收 |
| ST-03 | `app/engineering/projects`、`app/planning/handoffs`；`project-selfhost`、`planning-handoff-selfhost`、Routing Service | `0007`、`0016`、`0025`、`0036`、`0037`；Released Product/BOM/Routing、不可变Package、单位解析与修订谱系 | Planning Handoff PG `12/12`，Routing PG `2/2` | `READY`。进入工程→计划真实样本验收 |
| ST-04 | `app/planning/material-requirements`、`purchase-requests`、`production-handoffs`；`material-requirement-selfhost`与`production-handoff-selfhost` | `0017`、`0020`；需求计划/行、库存与在途Allocation、采购申请、生产交接及Event | UTC下Material Requirement `8/8`、Production Handoff `2/2`；Asia/Shanghai下Material Requirement仅`1/8` | `FIX_REQUIRED`。先执行TASK88日期型修复，再允许真实样本/UAT |
| ST-05 | `app/procurement/supplier-mappings`、`sourcing`、`fulfillment`；Supplier Mapping、Sourcing、Fulfillment Service | `0018`、`0019`、`0038`、`0039`；Mapping绑定、RFQ/Quote/Comparison/Award、PO/Line/Delivery Plan与Event | Sourcing PG `9/9`、Fulfillment PG `10/10`；旧Mapping直写动态拒绝符合治理规则 | `READY`。整链测试需改用现代Mapping生命周期后再串成同库旅程 |
| ST-06 | `app/warehouse/receiving`、`quality/incoming`、`finance/payables`；Fulfillment、Inventory、Quality、Finance Service | `0008`、`0013`、`0019`、`0034`、`0040`；Receipt、原料Lot、IQC、Ledger/Balance、AP来源 | Fulfillment PG `10/10`、Supplier Receipt Lot/IQC `3/3`，Quality PG相关门禁通过 | `READY`。进入到货→仓库→品质→财务真实样本验收 |
| ST-07 | `app/planning/production-handoffs`、`app/production/*`、`app/warehouse/production-*`；Handoff、Routing、Operation、Production、Batch、Inventory Lot Service | `0020`、`0021`、`0025`—`0027`、`0031`、`0032`；工单快照、预留/领退、派工/报工、WIP、完工与Lot | Handoff/ Routing/Operation/Completion/Batch/Final Output/FG Lot合计`18/18` | `READY`。进入计划→生产→仓库真实样本验收 |
| ST-08 | `app/quality/production`、`nonconformances`、`rework-requests`及生产返工页；Quality Gate、NCR、Rework、Quality Service | `0012`、`0022`、`0028`—`0030`；Inspection/Disposition、Operation Gate、NCR、返工申请/执行/Event | Operation Quality Gate `4/4`、NCR `3/3`、Rework `4/4`、Quality `12/12` | `READY`。进入品质↔生产/工程真实样本验收 |
| ST-09 | `app/sales/delivery`、`finished-goods-allocation`、`warehouse/shipping`、品质FQC与财务应收页；Sales、Quality、Inventory Lot、Finance Service | `0011`—`0013`、`0023`、`0032`、`0033`；Sales Order/Shipment、成品Lot分配、FQC放行额度、AR来源 | FG Inventory Lot `2/2`、FG Lot Shipment `2/2`、Sales Delivery/Receivable `3/3`及Quality `12/12` | `READY`。进入销售→品质→仓库→财务真实样本验收 |
| ST-10 | `app/finance/*`、经营/管理看板；`finance-selfhost`、`dashboard-selfhost` | `0013`、`0024`；AR/AP、Settlement/Reversal、Project Allocation与Dashboard来源投影 | Finance/Project `4/4`、Dashboard PG `2/2` | `READY`。看板是来源投影，不把项目净现金流误称完整会计利润 |

最终分类为`9 READY / 1 FIX_REQUIRED / 0 PARKED`。`PARKED`仍适用于AI、高级控制面和历史运行面，不用于掩盖十条V1闭环中的产品断点。

## 8. 唯一P0与最小实施任务

### P0-01：ST-04日期型受Node本地时区影响

- 复现：同一`tests/selfhost-material-requirement-postgres.test.mjs`在`TZ=UTC`为`8/8 PASS`，在宿主`TZ=Asia/Shanghai`为`1/8 PASS`；即时生成后提交返回`MATERIAL_REQUIREMENT_RECALC_REQUIRED`。
- 根因：`planning_material_requirement_plans.required_date`由`pg`返回JavaScript `Date`，`app/lib/material-requirement-selfhost/service.ts`第148行和第273行使用`toISOString().slice(0, 10)`；上海本地零点转换UTC后退到前一天，导致需求日和计算摘要改变。
- 当前UAT Web容器运行UTC，因此暂时掩盖该问题；运行环境偶然为UTC不能成为业务规则。`date`是日历日，不是时间点，必须与服务器时区无关。
- 最小修复固定为`SELFHOST-MATERIAL-REQUIREMENT-DATE-ONLY-FIX-88`：只引入确定性的date-only读取/规范化并覆盖上述两个调用点，补UTC和Asia/Shanghai回归；不新增页面、角色、表、Migration或审批层，不顺带重构其他模块。

## 9. 现有全ERP smoke结果与证据缺口

仓库现有`scripts/selfhost-full-erp-compose-smoke.mjs`已按要求在隔离PG17、当前46项Migration和本机既有镜像上实际运行：

1. 先以运行UAT同标签alpha.42执行，Identity初始链通过，Master Data在`POST /api/mappings`收到`409 SUPPLIER_MAPPING_GOVERNANCE_REQUIRED`后停止。
2. 隔离库重建后，以源码修订`78d96c61…`对应的历史本机alpha.47候选镜像再次执行，得到完全相同结果；这排除“只是alpha.42运行镜像”的解释，但不把该历史候选冒充当前HEAD制品。
3. 该脚本仍调用已经退役的Supplier Mapping直写入口，而当前受治理流程要求`/api/supplier-mappings`草稿→提交→异人审核。失败是测试脚本过期，不是放宽治理门禁的理由；初始阶段未完成，所以restart阶段未运行。
4. 脚本后续仍只串联旧基础Master/Inventory/Procurement/Production/Sales/Quality/Finance路径，不覆盖现代Project→Planning、需求重算、RFQ/Quote/Award、现代收货Lot/IQC、Routing/Operation/NCR/Rework、成品Lot/FQC/AR和项目资金的同库连续状态。

因此本轮不能声称“现代ST-01—ST-10单一数据库黄金旅程已经通过”。各模块PG套件足以支持9条`READY`进入真实样本验收，但在TASK88之后仍需独立更新整链测试入口，并用同一隔离库重跑；这属于验证工具缺口，不与ST-04产品P0混在同一实施任务。

## 10. 自动验证汇总

| 验证 | 结果 | 解释 |
| --- | --- | --- |
| 相关Unit/UI合同 | `194/194 PASS` | 44个文件，串行、Node 22、512 MiB heap |
| 现代模块隔离PG（UTC） | `99/99 PASS` | 21组Service测试，46项Migration；每组独立库，不冒充统一整链 |
| 主数据隔离PG（UTC） | `6/6 PASS` | 客户/供应商/Product/BOM、稳定ID、发布不可变、权限/CSRF/幂等/CAS/回滚/限速 |
| Material Requirement（Asia/Shanghai） | `1/8 PASS` | 7项稳定复现P0-01；不是环境噪声 |
| Material Requirement（UTC） | `8/8 PASS` | 证明当前UTC容器掩盖P0-01并定位时区因果 |
| 全ERP Compose smoke initial | `IDENTITY PASS / STOPPED AT LEGACY MAPPING 409` | alpha.42与alpha.47均复现；restart未到达，脚本缺口已登记 |
| Supplier Mapping PG | `10/10 PASS` | 首次触及约3.5 MiB磁盘余量时先停止并清理；空间自然恢复且新鲜门通过后，以另一全新隔离库串行完成 |

## 11. 资源、运行面与清理

- 可引用的补验窗口起点：available约2.3 GiB，Swap 160 MiB/1 GiB，根盘可用`10,776,580,096` bytes，Load `0.02/0.13/0.17`，宿主`oom_kill=0`，常驻Web/PostgreSQL restart0、OOM false且healthy。
- 全ERP smoke后清理：available约2.4 GiB，Swap 167 MiB，根盘`10,770,063,360` bytes，Load `0.08/0.14/0.17`；临时Web容器、PG集群、端口和内存盘目录均为0。
- ST-01补验在主数据`6/6`后发现根盘`10,740,936,704` bytes，仅比10 GiB硬线高约3.5 MiB，立即停止并清理。清理完成后根盘自然回升到`10,767,990,784` bytes；新鲜内存、Swap、磁盘、Load、OOM/restart/health门全部通过后，才启动另一隔离PG并完成Supplier Mapping `10/10`。
- 全部动态补验最终清理后为available约2.4 GiB、Swap 172 MiB、根盘`10,750,689,280` bytes、Load `0.13/0.13/0.14`；根盘仍只比10 GiB硬线高`13,271,040` bytes（约12.7 MiB），TASK88必须重新做门，不能沿用本轮通过结果。
- 全过程宿主`oom_kill=0`；常驻Web/PostgreSQL restart0、OOM false、healthy。临时Web容器自身restart0/OOM false；因应用未在3—10秒内处理终止信号，Docker stop最终返回137，但不是OOM，且容器按`--rm`清零。
- 所有临时PostgreSQL均从运行容器文件系统只读复制运行时到`/dev/shm`，只监听独立loopback端口；没有连接UAT数据库或挂载UAT Volume。全部临时库、进程、监听端口、容器和`/dev/shm/cyd-task87-*`已精确清理。
- Compose状态命令因本机缺必填部署环境变量不能安全渲染，使用只读`docker ps/stats/inspect`核验现有四服务，未修改配置或服务。

## 12. 收口结论

- TASK87完成：ST-01、02、03、05、06、07、08、09、10为`READY`，ST-04为`FIX_REQUIRED`。
- 只有一个产品P0：date-only时区漂移。下一任务TASK88必须保持最小范围；没有证据支持新增模块、角色、表、Migration、微服务或人数限制。
- 系统继续`PRODUCTION NO-GO`。TASK88通过后，还需现代同库整链回归、获授权的真实样本/试迁移、九职能员工UAT、可恢复备份/恢复演练和明确上线授权。
