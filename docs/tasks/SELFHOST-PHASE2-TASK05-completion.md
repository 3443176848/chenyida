# SELFHOST-PHASE2-TASK05 完成报告

完成日期：2026-07-25（Asia/Shanghai）

状态：`DONE`（非生产；独立提交完成后以 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK05-completion.md` 解析 final HEAD/commit SHA）

## 1. Git 与版本

- Task start HEAD：`41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`；branch `main`；恢复的 dirty 工作树全部为上一轮合法 TASK05 成果，未覆盖或丢弃。
- Final HEAD / commit SHA：承载本报告的 `feat: add self-hosted procurement` 独立提交；Git commit 无法在自身受哈希保护的正文中自引用最终 SHA。
- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.4` → `0.1.0-alpha.5`；package/lock 一致，没有依赖升级。

## 2. Migration 与 Schema

- 新增 PostgreSQL `0009_procurement.sql`，SHA-256：`351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7`。
- `0001`—`0008` checksum 逐文件保持不变；Schema、journal、`0009_snapshot.json` 与 Drizzle generator consistency 对齐。
- 关系化新增 PO Header/Line、来源 Link、状态事件、Receipt Header/Line 和 append-only 财务来源；稳定引用 Supplier、Material、Unit、Supplier Mapping、BOM Version 和 TASK04 Inventory Ledger。
- 数据库 guard 限制 PO 投影写入、Receipt/Line/Status/Source/Financial 不可变、reversal 一次性及跨对象完整性；空库、0008 存量库、重复 runner、失败回滚、约束/索引和 legacy `erp_records` 不回填均通过。

## 3. 服务、API 与原子事务

- `procurement-selfhost/{types,rules,errors,repository,service,handler}.ts` 提供 PO、缺料建议、收货、全额冲销、状态投影和财务来源；所有关键数量与金额由 PostgreSQL `numeric(24,6)` 计算，不使用 JavaScript 浮点。
- 稳定 API：PO list/detail/lines/receivable/create/update/close，Receipt list/detail/create/reversal，BOM shortage suggestion/from-shortage，financial source read；legacy `/api/purchase-receive` 仅转换 DTO 并委托同一 Service。
- PO 编码使用事务内序列；写操作执行身份、must-change、权限、CSRF、持久幂等、请求摘要冲突、请求编号、限流、expected version、稳定锁顺序和事务内审计。
- 收货在一个 PostgreSQL 事务创建 Receipt/Lines、调用 TASK04 Inventory Service 事务入口、写 Ledger/Balance、更新 PO Line/Header、追加状态事件和财务来源，并保存 audit/idem；故障注入和审计失败均证明无部分提交。
- 已过账 Receipt 不可修改或删除；冲销追加稳定 reversal、反向库存流水和负财务来源并恢复可收投影。同一 Receipt 只允许一次全额冲销，关闭订单或库存已不可安全反向时 fail closed。
- 缺料建议只读 RELEASED 当前 BOM、TASK04 available balance、ACTIVE Supplier/Material/Unit/Mapping 和当前价格；BLOCKED 不自动创建 PO。TASK05 不创建 AP、付款或总账记录，也不写 `erp_records`。

## 4. 权限与兼容

- admin/manager/purchase 可采购管理；warehouse 只读、收货和冲销；engineering/production/quality/sales/operations 只读；finance 只读采购及财务来源。服务端返回 403，UI 隐藏不是权限边界。
- legacy 采购页面改为稳定 Material/Mapping/Unit ID 与受保护写边界；客户端 actor 字段被拒绝，兼容层不直接写库、不复制状态机、不调用 Python 创建采购记录。
- 固定首期状态机为 `OPEN -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED`；未收货 OPEN Header 仅可用 `expected_version` 修改交期/备注，业务 Line 和已收货历史不可原地改写。

## 5. 测试结果

- TASK05：unit/UI 5/5；PostgreSQL/API 7/7；migration 3/3；task typecheck 与 Drizzle Schema consistency PASS。
- Compose：隔离空库 migration、PO→Receipt→Inventory/Finance、PostgreSQL/Web/Worker 重启持久性 PASS；1 Receipt、1 Ledger、1 Financial Source 和 2 条采购成功审计保持一致，容器/网络/卷已清理。
- 回归：lint 0 errors/1 existing warning；FileStorage 3/3；环境守卫 6/6；Identity/Material/Mapping/Normalization/Review/Master Data/Inventory/Procurement/Phase0 PostgreSQL 46/46；旧版本升级 15/15；共享 unit/UI 56/56；Import parser/file inspector/adaptive supplier 53/53；build 5/5；credentials 527 files；三个适用 typecheck 均 PASS。
- Python：一次性依赖和 SQLite 下 `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` PASS；未修改常驻 SQLite 或重启 systemd。
- 首次全量 Material 回归发现迁移清单仍止于 0008；只把 Material/Mapping 的精确版本断言推进到合法 0009，随后全套复测通过。

## 6. 未验证范围与生产保护

- 未迁移真实 PO、在途、库存、用户或主数据；未访问生产 PostgreSQL/D1/公开 Site，未执行生产 migration、部署、push 或创建 PR。
- 未实现 PO 审批/取消、部分冲销、超收、单位/币种换算、税、退货、供应商门户、完整应付、付款或总账。
- TASK05 的隔离 PostgreSQL、Compose 资源、临时 SQLite、依赖、上传和备份均在提交前清理；不删除任务前来源不明资源。
