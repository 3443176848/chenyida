# SELFHOST-PHASE4-TASK04 完成报告

完成时间：2026-07-26 02:18 CST

## 完成结论

`PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`

该结论仅表示 `chenyida-erp-parallel` 回环非生产环境中的采购询价、供应商报价、服务端比价和人工 Sourcing Award 闭环已验收。它不表示采购订单、到货计划、收货、库存入账、应付、真实数据迁移、HTTPS、切流或生产上线完成；TASK05 未启动。

## 版本与提交

- 可信起点/功能父提交：`5cf525a1b2733954a9d658c2582565e364770b23`。
- 功能提交：`4506db2579c07080afe27b33bb2e50623c3d1366`，`feat: add procurement sourcing workflow`。
- 验收提交：`ops: accept procurement sourcing workflow in parallel environment`，由本报告和总控文档组成，不 amend 功能提交。
- 版本：`0.1.0-alpha.17 -> 0.1.0-alpha.18`。
- Migration：`0018_procurement_sourcing.sql`，SHA-256 `64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9`；`0015—0017` checksum 复核未变。

## 功能交付

- 十表关系模型保存 RFQ/Line/Supplier、不可变 Quote Version/Line、服务端 Comparison Version/Line、Sourcing Award/Line 和不可变 Event。
- 独立 `procurement-sourcing-selfhost` 服务边界提供 RFQ 队列/详情、发出、报价/修订、比较、定标、撤销 9 组路由。
- purchase 拥有全部采购询比价能力，planning 只读，manager/admin 全部；must-change、CSRF、128 KiB、持久幂等、CAS、数据库 guard、单事务 Event/Audit/Idempotency 均生效。
- 比较只在服务端使用 PostgreSQL `numeric`，按 Currency/Unit/Tax/Freight 分组，再按单价、交期和 Supplier ID 排序；浏览器只显示已保存结果，不自动审批。
- `/procurement/sourcing`、`/procurement/sourcing/:rfqId` 和 Dashboard 三项待办已交付，未提供“创建采购订单”入口。

## 自动化验证

- TASK04 unit/UI 6/6、PostgreSQL/API 2/2、migration 3/3；覆盖非 ACCEPTED、非 ACTIVE、缺 Mapping、不可变、报价修订、过期/口径/MOQ/晚交期、SOLE_SOURCE、非最低价、单行唯一、撤销历史、幂等/CAS/并发和故障回滚。
- 空库与 0017 升级、重复执行、失败回滚、约束/索引/guard 通过；Drizzle schema/journal/snapshot 一致，生成器无额外差异。
- Identity、Supplier Mapping/Master Data、Procurement、Project、Planning、Material Requirement、Dashboard 的 unit/UI/PostgreSQL/migration 回归通过；FileStorage 3/3、API coverage 2/2、environment 6/6。
- TASK04 typecheck、全仓 ESLint 0 error（5 个既有 warning）、Vinext build 5/5、800 文件凭证扫描和 `git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py` 和临时 SQLite `go_live_check.py --no-backup` 通过；没有读取真实 SQLite 业务内容。

## 并行实际旅程

1. 在 17 migrations、唯一管理员、业务空库起点停止 Web/Worker，创建并验证 root-only 0017 恢复点。
2. 从功能提交重建 migrate/Web/Worker，应用且只应用 0018；核验数据库记录 checksum 与仓库一致。
3. 在写验收数据前创建并验证干净 0018 恢复点；临时 planning/purchase 账号经 Identity API 创建并完成首次改密。
4. planning 能读取采购进度，创建 RFQ 返回 `PERMISSION_DENIED`；purchase 完成 RFQ 创建/发出、两家报价、服务端比较、人工定标和幂等重放；两条原生页面均返回 HTTP 200。
5. Supplier A：单价 `12.000000`、`ON_TIME`、价格排名 2；Supplier B：单价 `10.000000`、`LATE`、价格排名 1。采购人工选择 A，原因码 `DELIVERY_PRIORITY`，原因“交期优先，避免项目延期”。
6. Award=1、Sourcing Event=5、成功采购审计=6；同时 PO=0、Receipt=0、Inventory Ledger=0、Finance Document=0、Planning Allocation=0，`reserved_qty` 在前后均为 `2.000000`。
7. Compose 整体重启后 RFQ CLOSED、Award AWARDED、理由、API 和页面保持；无持久性丢失。

首轮脚本在业务旅程和 Award 已成功后，因 Vinext SSR 页面正文字符串断言过严而停止。该次数据先用干净 0018 恢复点整体清空；UI 实际门禁收敛为 HTTP 200/路由可用（内容合同继续由 UI 自动化测试负责），随后从零完整重跑并通过，没有复用第一次业务结果或降低业务断言。

## 恢复、清理与保护

- 验收后停止 Web/Worker，将干净 0018 dump 恢复到新建空数据库，重复 migrate 无新增变化；最终 18 migrations，0018 checksum 正确。
- 最终 app_users=1、启用管理员=1、TASK04 临时账号=0；Customer/Supplier/Material/Project/PR/RFQ/Quote/Comparison/Award 全为 0。
- 最终 PO/Receipt/Inventory Ledger/Balance/Finance/Planning Allocation 全为 0；临时账号、验收脚本及两个 root-only 恢复工件在成功恢复和复核后删除，无法恢复。
- Compose 最终 PostgreSQL/Web healthy、Worker running，Web 只绑定 `127.0.0.1:3000`；三容器约 180.4 MiB，宿主可用内存约 1812 MiB、磁盘可用 27 GiB。
- Python PID `277640`、18888 保持；真实 SQLite metadata `64769:53827608:1784999031:1544192` 前后不变。
- 未 push、未建 PR、未迁真实数据、未访问历史生产 D1、未启 HTTPS、未切流、未修改 Python/SQLite；TASK05 不启动。
