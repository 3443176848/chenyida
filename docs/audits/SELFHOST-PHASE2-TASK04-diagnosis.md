# SELFHOST-PHASE2-TASK04 库存账本诊断与设计

诊断日期：2026-07-25（Asia/Shanghai）

源码基线：`3565d56f24ca904dd0b8d0c55960c702a8895406`

数据边界：只读源码、Schema、migration、测试与 Git；未查询 SQLite/PostgreSQL 业务正文，未访问公开 Site 或生产环境。

## 1. 起点与文档核验

- `main`、clean、`origin/main +4/-0`、版本 `0.1.0-alpha.3` 和 PostgreSQL `0001`—`0007` 与 TASK03 完成报告一致。
- 仓库根 `drizzle/0008_supplier_adaptive_import.sql` 属于历史 D1 序列；自托管 PostgreSQL 使用独立 `drizzle-postgres/`，TASK04 的下一合法版本仍是 `0008`。
- 用户提示中的短路径 `docs/project/API-INVENTORY.md`、`docs/project/MIGRATION-PLAN.md` 不存在；实际权威文件仍为 TASK01 API 盘点与 `full-erp-api-migration-plan.md`。

## 2. 现有行为与风险

- PostgreSQL `0001` 只有以 `item_code` 为主键的 `inventory_balances` 和文本来源 `inventory_transactions`；没有 Material FK、单位、冻结、冲销、actor/request/source 稳定关系或业务服务，不能成为未来权威。
- Python/SQLite 的盘点直接把余额改到实盘数，再追加文本流水；`change_inventory()` 拒绝负 on-hand，但没有 CSRF、幂等、行锁、expected version、冻结、冲销和数据库不可变保护。
- 历史 D1 路径同样直接 upsert 文本余额，并让采购、生产、销售各自复制库存 SQL。TASK05—TASK07 必须改为调用 TASK04 边界，不能继续复制。
- 旧 legacy 页面按物料编码提交调整。新服务必须由页面从已加载库存行解析 `material_id`，编码只能展示，不能成为写引用。

## 3. 设计结论

- 采用 expand-only `0008_inventory_ledger.sql` 新增 `inventory_stock_balances`、`inventory_adjustments`、`inventory_ledger_entries` 和 `inventory_adjustment_lines`。旧占位表原样保留且不回填，以免未经授权把未知历史余额变为新权威。
- `inventory_stock_balances` 是可验证投影；`inventory_ledger_entries` 是唯一库存数量权威。余额写 trigger 要求事务内库存服务标记，Ledger/Header/Line trigger 禁止已过账记录 UPDATE/DELETE。
- 通用操作固定为 `RECEIPT`、`ISSUE`、`ADJUSTMENT`、`FREEZE`、`UNFREEZE`；冲销 Header/流水类型为 `REVERSAL`，通过唯一 self/source link 保证原操作最多冲销一次。
- 单一 `MAIN` 逻辑库位和空 lot 是 V1 显式限制。冻结数量是 on-hand 的受限子集：冻结/解冻不改变 on-hand，只改变 frozen；available 固定为 on-hand-reserved-frozen。
- 盘点调整以锁定后的 on-hand 计算差异；不接受客户端 delta。冲销使用原账本精确反数，并在当前余额上重新执行负库存/冻结边界，因此不会为恢复历史而破坏当前库存。
- 业务编码复用并发安全 `business_code_sequences`；Repository 复用 TASK02/TASK03 的持久幂等和写限流模式，但为库存提供独立稳定错误与审计 route code。

## 4. 明确不实施

不把 legacy 余额/流水自动映射为 Material，不支持采购/生产/销售来源单据，不建立 reservation API，不实现单位换算、批次、序列号、多库位、审批引擎或部分冲销，不访问生产或真实库存。
