# SELFHOST-PHASE2-TASK04 完成报告

完成日期：2026-07-25（Asia/Shanghai）

状态：`DONE`（非生产；独立提交完成后以 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK04-completion.md` 解析 final HEAD/commit SHA）

## 1. Git 与版本

- Task start HEAD：`3565d56f24ca904dd0b8d0c55960c702a8895406`；branch `main`；起始 clean；`origin/main +4/-0`。
- Final HEAD / commit SHA：承载本报告的 `feat: add immutable inventory ledger` 独立提交；提交后用上述 `git log` 命令解析。Git commit 无法在自身受哈希保护的内容中自引用其最终 SHA。
- 提交父节点必须等于 task start HEAD；提交后验证分支仍为 main、工作区 clean、未 push、未创建 PR。
- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.3` → `0.1.0-alpha.4`；package/lock 一致。

## 2. Migration 与 Schema

- 新增：`drizzle-postgres/0008_inventory_ledger.sql`。
- SHA-256：`49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`。
- `0001`—`0007` 完整 checksum 逐文件核对不变；末尾版本为 PostgreSQL `0008`。历史 D1 `drizzle/0008` 属于独立 namespace，未修改。
- `db/schema.ts`、journal、`0008_snapshot.json` 与 Drizzle generator consistency 对齐；migration 额外包含余额 service-write guard、余额 last-ledger FK 和已过账不可变 trigger。
- 空库、0007 存量库、重复 runner、强制 DDL 失败回滚、约束/索引和旧用户/session/legacy item-code 库存保留均通过；新权威表不会静默回填旧库存。

## 3. 模块、API 与事务边界

- 模块：`inventory-selfhost/{types,rules,errors,repository,service,handler}.ts`；Ledger 是权威，Balance 是同事务可核对投影。
- API：`GET /api/inventory`、`/api/inventory-transactions`（legacy alias）、`/api/inventory/ledger`、`/api/inventory/reconciliation`、`/api/inventory-adjustments`、`/api/inventory-adjustments/:id`；`POST /api/inventory-adjustments`、`/api/inventory-adjustments/:id/reversal`。
- legacy UI 兼容：调整选择 stable `material_id`，提交 `unit_id` 与 `expected_balance_version`；BOM readiness 只读新投影并返回 required/available/shortage。
- 权限：`inventory.read`、`inventory.adjust`、`inventory.reverse` 服务端分离；warehouse/manager/admin 可调整/冲销，其他业务角色只读。
- 写事务：稳定顺序锁余额，重验 ACTIVE/STOCKED Material 与基础单位，写 Header/Lines/Ledger、更新 Balance/version、Audit、Idempotency 结果后一次提交；任一点失败整体回滚。
- 不可变：已过账 Header/Line/Ledger 禁止 UPDATE/DELETE；原调整最多一次全额冲销，冲销本身不可再冲销。V1 禁止负库存/负可用量、单位换算、批次/序列号、多库位和 reservation 写入。

## 4. 测试结果

- TASK04：unit 3/3；legacy UI contract 2/2；PostgreSQL/API 3/3；migration 3/3；Schema consistency 与 task typecheck PASS。
- Compose smoke/E2E：空库启动、调整/冻结/解冻/账本/审计、PostgreSQL/Web/Worker 重启持久性 PASS；项目容器、网络、卷已清理。
- 回归：lint 0 errors/1 existing warning；`npm test` FileStorage 3/3；review typecheck；build 5/5；credentials 最终 510 files；环境守卫 6/6；Identity unit/UI/PG/migration、Phase0 PG/Worker、Material、Master Data、Mapping、Normalization、Review 及旧升级均 PASS。
- Python 临时 SQLite：`server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` PASS；依赖安装和数据均位于一次性环境，未写常驻开发库。
- Import 适用核心回归：parser/file-inspector/adaptive-supplier 49/49 PASS。两组旧 UI 源码正则套件为 100/102 与 101/105，6 条失败；失败组件和测试文件相对 task start HEAD 完全未变，是起点既有断言漂移，不由 TASK04 引入，且未跨任务修改。历史 D1/Cloudflare 全量因移除 miniflare/wrangler 后不再是 D-040 自托管运行依赖，未恢复该依赖。
- 暂存后 `git diff --cached --check`、完整 staged diff、migration/schema/package 范围、凭证与临时产物检查均 PASS；staged 清单无 TASK05 代码。

## 5. 未验证范围与生产保护

- 未使用真实库存、客户/供应商个人信息或生产 URL；未访问公开 Site、生产 D1、生产 PostgreSQL/SQLite，未执行部署或重启 Python systemd。
- 未验证真实旧库存映射、单位换算、批次/序列、多库位、reservation、生产容量和人工生产验收；这些不在 TASK04 授权范围。
- 未实现 PO/采购收货、WO/领退料/完工、SO/发货、品质处置或财务来源；TASK05 起必须调用本任务服务边界而非复制余额 SQL。
- 未 push、未创建 PR。TASK04 创建的测试容器、网络、卷、临时 PostgreSQL/SQLite/文件在提交前清理；不删除任务前来源不明资源。
