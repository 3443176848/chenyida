# 真实 SQLite 字段映射复核计划

## 复核单位

每个实际 source table 形成一条安全登记：source table、target domain/table、migration classification、stable source key 策略、dependency、risk、聚合 data-quality counts 和 mapping status。Mapping status 仅允许 `READY`、`READY_WITH_TRANSFORM`、`NEEDS_BUSINESS_REVIEW`、`MODEL_GAP`、`ARCHIVE_ONLY`、`BLOCKED`。

## 判定原则

- 稳定内部 code 或不可变主键可作为源键策略，但报告不输出实际值；账号按规范化 username 检查，报告不输出 username。
- 浏览器字段、自由文本或供应商/客户料号不能充当未来业务主键。
- 依赖引用以聚合 orphan 数复核，不按名称猜测或自动补关系。
- Python 的活动历史默认评估为 snapshot、archive-only 或 post-cutover；不得把已过账活动直接重放进新系统。
- Inventory 只生成聚合 opening plan；Finance 只生成 AR/AP outstanding opening plan。计划不生成 target ID、正式编码或 Opening 记录。
- 文件仅盘点数据库元数据；不访问实际路径，不校验实际文件存在或 checksum。
- 任何 PostgreSQL `0001`—`0014` 无法表达的来源关系记录为 `MODEL_GAP`，留给后续任务。

## 领域复核顺序

Identity → Material/Reference → Customer/Supplier/Product/BOM → Inventory → Procurement → Production → Sales → Quality → Finance → File metadata → Audit/archive。下游阻断计数必须显式包含上游缺失、重复、单位、状态和稳定来源问题。
