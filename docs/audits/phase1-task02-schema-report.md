# PHASE1-TASK02 Material Master V2 Schema 实施报告

日期：2026-07-12

范围：在线 Site / Cloudflare D1（SQLite 方言）

生产影响：无；未连接生产 D1、未导入真实数据、未修改 legacy SQLite 或现有业务 API。

## 创建表

`0001_material_master_v2.sql` 在现有 8 张表之外新增 12 张空表：

1. `material_categories`
2. `material_attribute_definitions`
3. `material_master`
4. `material_category_attributes`
5. `material_attribute_values`
6. `supplier_mappings`
7. `supplier_mapping_price_history`
8. `material_versions`
9. `material_change_logs`
10. `material_aliases`
11. `material_code_rules`
12. `legacy_material_mapping`

迁移产物包括 Drizzle schema、`0001` Up SQL、对应 snapshot/journal，以及仅限空 V2/隔离环境使用的 Down SQL。既有 `0000_far_nightmare.sql` 未修改。

## 字段变化

- `material_master.material_status` 明确承载 `DRAFT`、`PENDING_APPROVAL`、`ACTIVE`、`FROZEN`、`INACTIVE` 生命周期。
- 数据库 `CHECK` 要求草稿/待审核物料编码为空；只有带批准人与批准时间的已审核生命周期才能持有正式编码。
- 新增 `material_change_logs`，保存字段级变更类型、字段名、变更前后 JSON、原因、操作者、请求编号和时间。
- `supplier_mappings` 使用 `supplier_key`、`supplier_item_code`、`manufacturer`、`mpn`、`revision`、`valid_from`/`valid_to` 描述可追溯映射身份和有效期。
- 数量、价格和小数统一使用缩放整数及精度字段；属性值使用互斥类型列。

## 索引

- 物料正式编码部分唯一索引；生命周期队列、分类状态、标准名称和候选制造商料号索引。
- 供应商映射当前身份部分唯一索引：`(supplier_key, supplier_item_code, manufacturer, mpn, revision) WHERE valid_to IS NULL`。
- 供应商映射历史期唯一索引：上述五要素加 `valid_from`；另有 material、supersedes、MPN/制造商和状态队列索引。
- 分类、属性分配、属性规范值、版本、变更日志、别名、编码规则、legacy 映射和价格历史均配置用途明确的唯一或查询索引。

## 约束

- 状态、类型、布尔值、精度、非负数和有效期顺序使用数据库 `CHECK`。
- 稳定关系使用基础外键；D1 不依赖触发器、递归关系或复杂外键完成业务判断。
- 分类无循环、父子级差、属性与分类适配、必填属性完整、供应商历史有效期不重叠等跨行/跨表规则保留给后续应用层事务校验。
- Up 只新增对象，不包含真实数据导入或默认编码规则。

## 测试结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 空库初始化 | PASS | 本机一次性 Miniflare D1 依次应用 `0000`、`0001`，12 张 V2 表齐全 |
| Down rollback | PASS | 12 张 V2 表全部移除，V1 `erp_records` 保留 |
| 二次执行 | PASS | Drizzle/D1 migration journal 返回无待执行迁移，结构未变化 |
| rollback 后重建 | PASS | 清理测试 journal 后重新 Up，12 张表全部恢复 |
| 表结构 | PASS | 验证 `material_status`、`material_change_logs` 和供应商当前身份唯一索引 |
| 编码时点约束 | PASS | 带正式编码的 `DRAFT` 插入被数据库拒绝 |
| 测试隔离 | PASS | 数据库位于随机临时目录，结束后自动清理；未使用远程绑定或生产 URL |

完整基线结果：`npm run lint` 0 错误/1 个既有警告；`npm test` 构建成功且 Node 9/9；隔离 `test:api` 通过；凭证扫描 155 个仓库文件通过；本地 `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过，正式 legacy 数据库保持 233,472 字节且时间戳未变化；`git diff --check` 通过。

## 风险

1. SQLite/D1 无排斥约束，历史供应商映射有效期重叠必须由后续服务在同一事务中检测。
2. 基础外键仅提供引用存在性；部署配置若关闭外键，应用层仍必须执行等价校验。
3. Down 会删除 V2 数据，只允许空 V2 的开发/隔离测试；生产恢复必须使用快照或前向修复并另行授权。
4. 当前只有 schema，没有编码服务、审核事务、幂等写入或业务切换；不得将表存在误认为 V2 已可投产。
5. 现有 V1 与 V2 暂时并存，后续回填和切换必须核对 BOM、采购、库存及金额汇总，但本任务未触碰这些数据。
