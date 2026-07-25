# SELFHOST-PHASE4-TASK03：建立计划物料需求与采购申请交接闭环

状态：`DOING`

开始日期：2026-07-26（Asia/Shanghai）

负责人：Codex（关系模型、服务端重算与分配、采购申请状态机、原生界面、隔离测试、并行环境验收、文档与独立提交）；项目负责人（固定业务决定与部署验收边界授权）

## 可信起点

- Branch `main`，HEAD `5557d2eee98dd3e1b47c57e1643f21c5ae599175`，工作区 clean，相对 `origin/main` ahead 21 / behind 0。
- 自托管版本 `0.1.0-alpha.16`；PostgreSQL migration `0001`—`0016`。
- Compose 项目 `chenyida-erp-parallel`，Web 仅 `127.0.0.1:3000`；旧 Python PID `277640` 继续监听 `18888`。
- 真实 SQLite 不读取、不修改；不迁移真实数据、不双写、不切流。

## 唯一范围

只在 Node.js/PostgreSQL 自托管运行面建立已接收 Project Planning Package 的物料需求汇总、库存与需求日前有效采购在途独立分配、不可变物料需求计划、采购申请提交、采购接收或退回、计划修订重提闭环。planning 生成/修订/提交，purchase 接收/退回，manager/admin 全能力。

## 固定业务规则

1. 只有状态为 `ACCEPTED` 的最新 Project Planning Package 可以创建计划；物料与单位只读取该包固化的 BOM 快照，不重新展开当前 BOM。
2. 同一 `Material + Unit` 聚合，全部数量由 PostgreSQL `numeric(24,6)` 计算、比较和保存，JavaScript 不承担最终数量判断。
3. 可用库存为 `on_hand - reserved - frozen - 其他有效计划库存分配`；有效在途为需求日前 `OPEN/PARTIALLY_RECEIVED` PO 未收量减其他有效计划在途分配。
4. Planning Allocation 独立于 Inventory `reserved_qty`；同一库存或在途数量不得被多个有效计划重复使用。
5. DRAFT 只作预览；SUBMIT 必须锁定相关计划、余额和在途来源并重新核算。Package、来源库存、在途或版本变化必须返回稳定冲突，不能静默沿用。
6. 已提交计划、采购申请、分配与事件不可原地修改。采购退回释放该版本全部 Planning Allocation，计划部必须创建新版本重新核算。
7. 只把净采购数量大于零的行写入采购申请；零净采购仍保存完整物料需求计划，不创建伪造申请行或空采购申请。
8. 采购接收只形成部门交接事实，不创建 RFQ、供应商报价、比价结果、采购订单、收货、生产或财务事实。

## 交付内容

1. 新增 expand-only `0017_planning_material_requirements.sql`、Drizzle schema/journal/snapshot/checksum，保持 `0001`—`0016` 不变。
2. 新增独立 `material-requirement-selfhost` Repository/Service/Handler/Validation/Error/Types/Calculation 边界，覆盖预览/生成、详情/历史、提交、采购接收/退回和队列 API。
3. 关系化保存版本化需求计划、聚合需求行、库存/在途 Planning Allocation、采购申请/行和只追加事件，并使用数据库约束与 trigger 保护不可变事实和来源一致性。
4. SUBMIT 在单一事务中按稳定顺序加锁、重算、生成不可变计划与采购申请、写 Allocation/Event/Audit/Idempotency；失败不留下部分事实。
5. 新增 planning 与 purchase 原生工作台，并在 Dashboard 显示待提交计划、待采购接收申请及稳定风险提示。
6. 覆盖 migration、权限/职责分离、CSRF、持久幂等、numeric 精度、聚合、并发防重复分配、来源变化冲突、零净采购、退回释放、历史不可变、故障回滚和越界禁止测试。
7. 版本目标为 `0.1.0-alpha.17`；完成本地/隔离回归后创建功能提交，再仅在 `chenyida-erp-parallel` 执行 `0017` 和实际退回→修订重提→最终接收验收，清理验收数据并追加独立 ops 提交。

## 明确排除

- 不询价、不选择供应商、不比价、不创建 RFQ、供应商报价、采购订单或收货。
- 不修改 Inventory 正式 `reserved_qty`，不进入工单、生产、品质、完工、发货或财务。
- 不重读或重新展开最新 BOM，不改写 TASK01/TASK02 的 Project、Requirement、Planning Package 或历史事件。
- 不读取或迁移真实 SQLite/D1/附件正文，不执行生产 migration、生产部署、HTTPS、公网开放、切流、push 或 PR。

## 完成判定

唯一允许结论：`PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。

完成报告计划：`docs/tasks/SELFHOST-PHASE4-TASK03-completion.md`。
