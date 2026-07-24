# SELFHOST-PHASE2-TASK03 主数据与 BOM 诊断

诊断日期：2026-07-25（Asia/Shanghai）

源码基线：`2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`

数据边界：只读源码、Schema、migration、测试与 Git；未查询 SQLite/PostgreSQL 业务正文，未访问公开 Site 或生产环境。

## 1. 路径与起点核验

- 用户提示中的 `docs/project/API-INVENTORY.md` 和 `docs/project/MIGRATION-PLAN.md` 不存在；实际权威文件分别为 `docs/audits/SELFHOST-PHASE2-TASK01-api-inventory.md` 和 `docs/self-hosting/full-erp-api-migration-plan.md`。
- `main`、HEAD、clean、`origin/main +3/-0`、版本 `0.1.0-alpha.2`、PostgreSQL `0001`—`0006` 均与可信起点一致。
- `0001`—`0006` SHA-256 与 `RELEASES.md` 一致；仓库无 gitlink/submodule/嵌套仓库，起始时无运行中 Compose 容器。

## 2. 现有能力与缺口

- `material_master` 已有稳定 bigint ID、ACTIVE 状态和单位关系；现有 Material Service 是物料状态权威。
- `supplier_mappings` 和 `supplier_mapping_price_history` 已存在，但 mapping 只保存 supplier name/key，没有 Supplier 主体 FK、独立服务、有效期并发重叠保护或 API。
- Customer、Supplier、Product、Product Version、BOM Header/Version/Line 没有 PostgreSQL 关系表或自托管业务服务；`erp_records` 只是历史兼容占位。
- Python 以名称 upsert 客户/供应商、COUNT+1 生成编码、文本 code 连接产品/BOM/物料，并以 `INSERT OR REPLACE` 原地覆盖 BOM 行；这些行为违反稳定 ID、并发编码与发布不可变要求，不能机械复制。
- legacy `bom-readiness` 混合读取库存。TASK04 尚未实施，TASK03 只能给出结构检查与 required quantity，必须显式标记库存未评估。

## 3. 设计结论

- `0007_master_data_bom.sql` 只追加关系表、索引、约束、不可变 trigger，并为现有 supplier mapping 扩展可空 supplier FK；旧未关联 mapping 保留作迁移来源，新服务只创建/返回已关联记录。
- `business_code_sequences` 以 `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` 原子生成 `CUS-`、`SUP-`、`PRD-` 和 `BOM-` code。
- Customer/Supplier 为稳定聚合；Product/BOM 使用 Header + Version，发布版本由数据库 trigger 禁止 UPDATE/DELETE，修订只能新建 DRAFT version。
- BOM Line 以 `material_id`/`unit_id` 外键引用；发布事务重查产品版本、所有 Material ACTIVE、单位启用和行完整性。
- 通用 `idempotency_keys` 复用 TASK02 的 24 小时完成态语义；业务、审计和结果同一 PostgreSQL 事务提交。
- 权限固定为 sales 管客户、purchase 管供应商/映射、engineering 管产品/BOM；admin/manager 继承相应能力，所有角色只按服务端 capability 判断。

## 4. 明确不实施

不迁真实数据，不建立 legacy `erp_records` 双写，不自动激活 Material，不实现库存齐套、采购建议/PO、生产工单、替代料推断、客户专用料推断、物理删除、生产 migration、部署或切换。
