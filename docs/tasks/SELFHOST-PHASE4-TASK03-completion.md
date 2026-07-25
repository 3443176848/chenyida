# SELFHOST-PHASE4-TASK03 完成报告

状态：`DONE / ACCEPTED IN PARALLEL ENVIRONMENT`

可信起点：`main@5557d2eee98dd3e1b47c57e1643f21c5ae599175`。功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969` 的父提交严格保持该值；验收记录由独立 `ops: accept planning material requirement workflow in parallel environment` 提交承载。

## 已实现

- `0.1.0-alpha.17` 与 expand-only PostgreSQL `0017_planning_material_requirements.sql`，SHA-256 `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28`；`0001`—`0016` 未修改。
- 六表关系模型保存不可变物料需求计划/行、独立库存与在途 Planning Allocation、采购申请/行和只追加事件；数据库 GUC、约束、索引、不可变 trigger 与延迟完整性 trigger 共同 fail closed。
- `material-requirement-selfhost` Repository/Calculation/Service/Handler/Validation/Error/Types 独立边界及 7 组路由；planning 生成/修订/提交，purchase 接收/退回，manager/admin 全能力。
- 只读取最新 `ACCEPTED` Planning Package 的固化 Material/Unit/BOM gross 快照并按 `Material + Unit` 聚合；PostgreSQL `numeric(24,6)` 计算库存、需求日前在途、分配与净采购，Node/浏览器只传 decimal 文本。
- DRAFT 只预览；SUBMIT 在事务内锁定 Package、计划、物料分配键、Inventory 同源键和采购在途来源，重新核算并比较 digest。来源变化返回稳定 `MATERIAL_REQUIREMENT_RECALC_REQUIRED`，不静默沿用。
- 只有净采购大于 0 的行形成不可变 `PRQ-########`；零净需求保留已提交计划但不伪造空申请。采购接收不创建 RFQ、报价、供应商选择、PO、收货或生产事实。
- `/planning/material-requirements`、`/planning/purchase-requests` 与 Dashboard 部门待办已接通；正式 Inventory `reserved_qty` 不被 TASK03 修改。

## 本地与隔离结果

- TASK03 unit/UI 6/6、PostgreSQL/API 3/3、migration upgrade 3/3；TASK02 unit/UI 6/6、PostgreSQL/API 3/3、migration 3/3 在 `0017` 基线上保持通过。
- 并发两个 DRAFT 提交只有一个可分配，另一方稳定重算冲突；覆盖聚合、六位精度、权限/CSRF/幂等、来源版本变化、退回释放、新版本重算、零净需求、不可变和故障零半记录。
- Dashboard PostgreSQL 2/2、migration tool 8/8、FileStorage 3/3；相关非数据库单元 34/34，仓库文档覆盖检查在正确根挂载后 2/2。
- TASK03 typecheck、全仓 ESLint、Vinext 5/5 build、780 文件凭证扫描与 `git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py`、`go_live_check.py` 通过；常驻 PID `277640` 和 18888 保持，不读取或修改真实 SQLite 业务内容。

## 并行环境实际验收

- 部署前只读核验并行库为 `0016`、唯一管理员、Project/Planning/PO/WO 全为 0；停 Web/Worker 后创建 root-only `0700/0600`、manifest/checksum 已验证的恢复点，再从功能提交重建 migrate/Web/Worker。
- PostgreSQL 只新增 `0017`；最终 `schema_migrations` 为 17 条，数据库 checksum 精确为 `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28`。
- 管理员经 Identity API 创建临时 planning/purchase 账号，首次改密和正式角色权限生效。只在空并行库构造合成 ACCEPTED Package、两条相同 Material+Unit 固化需求、库存余额与一条需求日前部分收货在途。
- 真实 HTTP 核算结果为：`gross 100.000000`、`stock available/allocated 55.000000`、`eligible inbound/allocated 40.000000`、`net purchase 5.000000`。正式 `reserved_qty` 前后均为 `10.000000`。
- v1 提交生成一行净需求采购申请；planning 无采购决定权限，purchase 无计划生成权限。purchase 填原因退回后该版本有效分配为 0；planning 创建 v2 重新核算、重提，purchase 最终接收。
- 事件顺序为 `GENERATED, SUBMITTED, PURCHASE_RETURNED, REGENERATED, SUBMITTED, PURCHASE_ACCEPTED`；直接修改已提交需求行被数据库拒绝。接收前后既有合成在途 PO 数保持 1，新增 PO 为 0，Receipt 和 Work Order 均为 0。
- Compose 重启后 v2 Plan 与 PR 均为 `ACCEPTED`，原生两条页面和 API 保持；证明数据持久而不越界进入 TASK04。

## 恢复清理与运行面保护

- 重启验收后停止 Web/Worker，精确恢复已验证的干净 `0016` PostgreSQL dump，再重新应用 `0017` 并启动当前镜像。最终 17 migrations、唯一启用管理员；Project、Planning Package、需求计划、Allocation、采购申请、PO、Receipt、WO 均为 0。
- 临时账号、业务数据、验收脚本、健康响应、迁移清单和 root-only 恢复点均已删除；恢复点已用于成功恢复，因此这些临时工件不再可恢复。
- 最终 Compose：PostgreSQL healthy、Web healthy、Worker running；Web 仍只绑定 `127.0.0.1:3000`，PostgreSQL 无宿主端口。三容器检查时约 `162.9 + 68.2 + 62.4 MiB`，宿主可用内存约 1749 MiB、磁盘可用 29 GiB。
- Python PID `277640` alive、18888 HTTP 200；未访问 D1/公网生产、未迁真实数据、未启 HTTPS、未切流、未 push/PR。

唯一最终结论：`PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。该结论不表示询价、供应商选择、比价、采购订单、收货、生产、真实迁移、HTTPS 或生产上线完成；TASK04 不自动启动。
