# Project → Planning 数据模型与状态机

适用任务：`SELFHOST-PHASE4-TASK02`。权威运行面仅为 Node.js/PostgreSQL 自托管方向；不修改 TASK01 的 MARKET→PROJECT 投影与历史事件。

## 关系边界

- `project_requirement_resolutions`：把当前 Requirement Item 显式解析到稳定 Product、RELEASED Product Version、BOM Header 和 RELEASED BOM Version。禁止名称猜测；当前包未生成或上一包已退回时才允许修订。
- `project_planning_packages`：项目级版本投影。每次退回后创建新 `package_version_no`，不覆盖旧包。
- `project_planning_package_items`：冻结需求数量、单位、Product Version 和 BOM Version。
- `project_planning_package_bom_lines`：冻结 BOM 行、ACTIVE Material、enabled Unit、单耗、损耗、毛数量及安全规格快照/digest。
- `project_planning_document_links`：只关联 TASK01 已受控的 Project Document Link；不复制文件正文或路径。
- `project_planning_handoff_events`：只追加 SUBMITTED、RETURNED、RESUBMITTED、ACCEPTED。

稳定外键、唯一约束、队列/项目/版本索引和数据库写守卫共同保证引用一致性。业务、事件、Audit 和 Idempotency 结果在单一事务提交。

## Product/BOM 前置生命周期

- Product Version（例如 `A0`）与 BOM Version（例如 `V1`）是不同版本轴；Product 状态、Product Version 发布状态、产品生命周期和 BOM 发布状态也不是同一字段。
- BOM 属于稳定 `product_version_id`，不直接关联 Project；具体 Project 只在 Planning Handoff 的 Requirement Resolution/Package 中关联。
- BOM 物料候选只包含 ACTIVE、正式内部编码非空且主单位可解析的 Material；显示 `正式内部编码 · 名称 · 单位`，业务引用始终使用稳定 `material_id`/`unit_id`，不得解析展示文本。
- engineering 先为已发布 Product Version 保存 BOM DRAFT，再添加并校验行项目，最后调用既有 BOM release 服务。发布后内容不可原地修改，只能创建修订。
- Planning Handoff 只接收属于同一 Product 的 RELEASED Product Version、RELEASED BOM Version 和 ACTIVE BOM Header；名称、供应商料号或页面展示文本不能作为桥接键。

## 状态机

```text
DRAFT --engineering submit--> SUBMITTED
SUBMITTED --planning return(reason)--> RETURNED
RETURNED --engineering creates new package--> new DRAFT
new DRAFT --engineering submit--> SUBMITTED (RESUBMITTED event)
SUBMITTED --planning accept--> ACCEPTED
```

只有 TASK01 已接收的 `ACCEPTED` Project 可进入本状态机。普通 engineering 只能操作自己负责的项目；planning 只能读取、接收或退回，不能改 BOM 或提交包。接收不触发 TASK03。

## 生成前 fail-closed 校验

1. 锁定 Project 与当前 Requirement Version，验证 Project=ACCEPTED 和项目负责人。
2. 每条 Requirement Item 必须有显式 Resolution，且单位已确认并 enabled。
3. Product 必须 ACTIVE 且客户与 Project 客户相同；无法证明时拒绝。
4. Product Version/BOM Version 必须 RELEASED，BOM 必须属于对应 Product Version。
5. 每条 BOM Line 必须引用 ACTIVE Material 与 enabled Unit，客户专用料不得跨客户。
6. PostgreSQL numeric 计算 `required_quantity × quantity_per × (1 + loss_rate)`，结果固定六位小数。
7. 保存逐行来源 digest 和完整 package digest；不读取库存、供应商、采购或生产表。
