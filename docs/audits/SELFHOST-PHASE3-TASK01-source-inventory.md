# SELFHOST-PHASE3-TASK01 迁移来源模型诊断

日期：2026-07-25（Asia/Shanghai）

## 安全口径

本诊断只阅读仓库内 Schema、migration 和业务源码；未打开任何现有数据库、备份、上传、附件或归档内容，未连接 D1/PostgreSQL。表数是既有文档与建表源码口径，不依赖真实库内容。

## SQLite 来源

- `chenyida_erp_app/server.py:create_schema()` 定义历史 26 表；`migrations/0001`—`0004` 扩展导入批次、不可变原始行、归档元数据和规格证据，文档基线共 29 表。
- 主体以自增整数或文本 code 关联；历史建表没有外键，库存以 `internal_item_code`，采购/生产/销售/品质/财务存在服务端维护的弱引用。
- 密码和 Session 表存在，但迁移框架不迁 Session，不输出哈希；旧账号只生成 disabled/must-change 计划。
- 来源 adapter 只能读取本任务即时生成、带固定合成契约的临时 SQLite；真实 legacy schema 的字段解释仅用于 mapping 规格，不作为本任务运行输入。

## 历史 D1 来源

- `drizzle/0000`—`0008` 共 45 表开发 schema；Material/Import/Normalization 已关系化，大多数 legacy ERP 主体仍位于 `erp_records(kind, code, data_json)`。
- D1 export adapter 只接受离线、临时目录内、manifest 声明为 synthetic 的结构化 JSON export，不接受 binding、账号、远程 URL 或仓库内现有数据库。
- JSON 内部引用必须使用显式 stable key；缺失、歧义或仅名称引用均阻断，不推断候选。

## PostgreSQL 目标

- `drizzle-postgres/0001`—`0013` 构成 115 表的非生产关系化基线；Material、主数据/BOM、库存、采购、生产、销售、品质和财务均使用稳定外键。
- 库存权威为不可变 `inventory_ledger_entries`，余额为同事务投影；只有旧余额的来源只能生成 `MIGRATION_OPENING` 计划，不伪造采购/生产/销售历史。
- Finance 只接受稳定 Shipment/Receipt 金额来源。无业务来源的 AR/AP 期初在当前模型无法合法表达，必须报告 `MODEL_GAP`，不伪造来源且本任务不新增 `0014`。
- staging/checkpoint/ID map 位于迁移工作目录或独立 `migration_tool` 临时 schema，不进入 `db/schema.ts`，不成为业务权威表。

## 主要差距

| 领域 | 来源风险 | 目标约束 | 处理 |
| --- | --- | --- | --- |
| Identity | 重复用户名、未知角色、弱/未知哈希、旧 Session | 固定十角色、强哈希、可撤销 Session | Session 丢弃；重复/未知阻断；账号默认 disabled + must-change |
| Material | 文本 code、同名不同料、重复 code、单位缺失 | ACTIVE Material、稳定 ID、enabled Unit、分类 | code 只作 source stable key；重复/单位缺失阻断；名称不匹配 |
| BOM | 文本料号、orphan line | Released version + Material/Unit FK | 上游 ID map 缺失即 BLOCKED |
| Inventory | 余额与历史可信度不一、负数 | 非负六位 Ledger/Balance | 余额生成期初计划；负数/超精度默认阻断 |
| Procurement/Production/Sales | 旧状态和数量链弱约束 | 关系状态机、稳定来源、不可变事实 | 只迁明确受支持状态；链不平即阻断 |
| Quality | `ref_type/ref_id` 或弱文本来源 | Receipt/Report/Completion+SO 稳定 FK | 无稳定来源即 orphan/BLOCKED |
| Finance | 可能只有余额、币种/精度异常 | Shipment/Receipt 稳定来源、CNY 六位 | 有稳定来源才计划；孤立期初记 `MODEL_GAP` |
| Files | 缺失、checksum 错、路径穿越 | 受控相对路径 + SHA | 只核对合成文件；缺失/错 SHA 阻断 |
