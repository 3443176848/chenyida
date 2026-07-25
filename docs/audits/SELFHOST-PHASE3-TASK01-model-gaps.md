# SELFHOST-PHASE3-TASK01 目标模型差距报告

日期：2026-07-25（Asia/Shanghai）

## MG-001 无业务来源的 AR/AP 期初

当前 `0013_finance.sql` 规定 AR 只能绑定未冲销正向 Shipment source，AP 只能绑定未冲销正向 Purchase Receipt source。来源只有历史往来余额时，模型没有合法的 opening source 类型。

TASK02 更新：`RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。`0014` 新增去正文的关系化 Finance Opening Source，`OPENING_AR`/`OPENING_AP` 与 Customer/Supplier 严格互斥，固定 CNY、正数六位金额、会计日、不可变 Event/审计和一次全额冲销；不伪造 Shipment/Receipt，也不修改 `0013`。真实来源字段、金额、主体和截止日尚未获授权核验，因此生产仍为 `NO-GO`。

## MG-002 余额型库存的业务 materialization

当前 `0008_inventory_ledger.sql` 要求 Ledger、Adjustment 和 Balance 同事务且带不可变事实。旧来源只有当前余额时不能伪造成采购收货、生产完工或销售退货历史。

TASK02 更新：`RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`。`0014` 与内部事务服务把合成 `OPENING_PLAN` 物化为 `MIGRATION_OPENING` Adjustment、不可变 Ledger 和同事务 Balance；只接受 ACTIVE/STOCKED Material、enabled Base Unit、MAIN/空 lot、六位正数 on-hand 与 `0 <= frozen <= on-hand`。更正追加一次全额反向事实，存在下游消耗时拒绝。真实余额、冻结、单位和库位仍未核验，因此生产仍为 `NO-GO`。

## MG-003 旧身份哈希可信度与管理员建立

旧密码哈希算法/强度无法仅凭 schema 证明，Session 不可迁。至少一个管理员必须由受控初始化建立；未知哈希账号默认 disabled 且 must-change。

结论：本任务只生成身份计划，不写真实账号。后续需要账号 owner、通知、临时凭证交付、首次改密截止和禁用处置批准。

## MG-004 真实字段/状态和弱引用映射

SQLite 历史表缺少外键，D1 legacy 主体大量位于 JSON；真实值域、重复、孤儿和引用稳定性未经本任务读取或统计。

结论：合成 registry 不能自动升级为真实映射。真实试迁移前需独立授权只读 snapshot/inventory，逐字段签字并形成冲突人工处置结果。

## MG-005 生产容量、文件和灾备

合成 28 条跨域记录、空文件目录和本机回环 PostgreSQL 不能证明真实数据规模、附件恶意内容、异故障域、RPO/RTO、网络带宽或维护窗口。

结论：保持生产 `NO-GO`；不得从合成耗时或容量推导生产结论。
