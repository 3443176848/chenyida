# Project → Planning 数据模型与状态机

适用任务：`SELFHOST-PHASE4-TASK02`；2026-07-31 由 `SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05` 补充共享 CSRF 客户端、RELEASED BOM 不可变表现和默认最小披露合同。权威运行面仅为 Node.js/PostgreSQL 自托管方向；不修改 TASK01 的 MARKET→PROJECT 投影与历史事件。

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

RELEASED BOM 在兼容管理页只显示已发布行事实和“已发布，只读；如需修改请创建新版本”。Material 搜索/选择、行号、数量、损耗率和工序输入及新增/编辑/删除/保存/发布动作均不对 RELEASED 详情渲染；从 DRAFT 切换时必须清空未保存输入。这是用户界面合同，不取代服务端不可变：RELEASED BOM Line 的 POST/PATCH/DELETE 均返回 `409 BOM_RELEASED_IMMUTABLE`，且不产生 Line、Version、Event 或成功 Audit 半记录。既有 PostgreSQL trigger 继续作为数据库层最后防线。

BOM 管理页初始状态为“请选择或搜索 BOM”，不自动选中第一条历史 BOM，不请求任何 BOM Line。用户明确搜索后，服务端只返回有界 BOM Header/Product 摘要，支持 BOM 编码、Product 编码或名称；只在明确选择某条后才单独读取明细。这不改变有权用户主动查询范围。

## 状态机

```text
DRAFT --engineering submit--> SUBMITTED
SUBMITTED --planning return(reason)--> RETURNED
RETURNED --engineering creates new package--> new DRAFT
new DRAFT --engineering submit--> SUBMITTED (RESUBMITTED event)
SUBMITTED --planning accept--> ACCEPTED
```

只有 TASK01 已接收的 `ACCEPTED` Project 可进入本状态机。普通 engineering 只能操作自己负责的项目；planning 只能读取、接收或退回，不能改 BOM 或提交包。接收不触发 TASK03。

## 写请求安全客户端

Planning 页面的保存 Resolution、生成 Package、submit、return 后创建修订、resubmit 以及同模块后续写路由统一调用 `public/erp/api-client.js` 的 `sessionPost`，不直接拼装 fetch。每次请求固定为 POST、`credentials: same-origin`，并在发送时读当前 `CYD_ERP_CSRF` Cookie 并发送 `X-CSRF-Token`；浏览器只认发送时的当前 Cookie，Cookie 缺失即 fail closed，页面初始 `/api/session` 快照不得作为回退。无 `document` 时的显式 Token 后备仅用于非浏览器单元测试。

页内 Idempotency-Key 以当前 CSRF Session 标识+method/path+canonical JSON 正文绑定，仅在网络结果未知且正文和会话未变时重用。正文变更、Cookie/Session 变更、logout、撤销、重新登录、pagehide 或认证失效均使旧上下文失效。服务端仍在读取正文和进入业务事务前校验 Origin 及 Cookie/Header 双提交；缺失、错误或旧 Session Token、旧公网 Origin、未知 Origin 与伪造 `Forwarded`/`X-Forwarded-*` 不能放行。错误保持稳定中文代码和 request_id，日志/审计不记录 Token、Cookie 或完整请求正文。

## 生成前 fail-closed 校验

1. 锁定 Project 与当前 Requirement Version，验证 Project=ACCEPTED 和项目负责人。
2. 每条 Requirement Item 必须有显式 Resolution，且单位已确认并 enabled。
3. Product 必须 ACTIVE 且客户与 Project 客户相同；无法证明时拒绝。
4. Product Version/BOM Version 必须 RELEASED，BOM 必须属于对应 Product Version。
5. 每条 BOM Line 必须引用 ACTIVE Material 与 enabled Unit，客户专用料不得跨客户。
6. PostgreSQL numeric 计算 `required_quantity × quantity_per × (1 + loss_rate)`，结果固定六位小数。
7. 保存逐行来源 digest 和完整 package digest；不读取库存、供应商、采购或生产表。
