# 服务器本地 Excel/CSV 自适应导入 V1

任务：`PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT`

状态：`DONE / DEVELOPMENT SERVER DEPLOYED`

## 1. 目标与运行面

根据 D-028，本任务只修改服务器实际运行的 `chenyida_erp_app`，不再把功能追加到 Site。网页继续复用既有 `/api/import` 权限、供应商匹配、`cleaning_rows` 审核分流和活动审计；新增二进制文件入口处理 `.csv`、`.xlsx`、`.xls`。

## 2. 文件与结构识别

- 文件上限 10 MiB；按强签名区分 CSV、OOXML XLSX 和 OLE/BIFF XLS。
- XLSX 使用 `defusedxml` + `openpyxl`，并检查 ZIP 路径、加密、宏、外部链接、解压大小、压缩比、Sheet/行/列上限；不执行公式。
- XLS 使用 `xlrd` 只读 BIFF；损坏、加密或超限文件 fail closed。
- CSV 支持 UTF-8/GB18030 和逗号、Tab、分号。
- 对全部 Sheet 评分，检查前 50 行、1～3 行及合并表头，保留父子列路径。
- 非数据行区分空行、标题/说明、重复表头、小计、合计和页脚。

## 3. Mapping 与规格

集中别名覆盖物料编码、名称、规格、型号、品牌、单位、分类、描述、制造商/供应商料号、图号、数量和价格。规格优先使用独立规格列；无独立列时确定性组合型号、尺寸等来源；名称/描述提取只能形成待复核候选。缺少独立名称但存在明确规格列时，规格可以生成 `SUGGESTED` 名称候选并进入清洗审核；名称和规格语义都缺失时仍返回 `IMPORT_MAPPING_REVIEW_REQUIRED`。

清洗队列创建内部物料前必须由用户在对话框明确确认标准名称、规格和基本单位；服务端再次拒绝空规格和空单位，避免识别失败后沿用空值或默认值。

## 4. 数据与迁移

`0001_material_import_source_lineage.sql` 增加：

- `material_import_batches`：文件 SHA-256、类型、Sheet、表头范围、结构置信度和 Mapping 快照。
- `material_import_raw_rows`：不可变 Sheet、行号、完整原始值和行分类。
- `cleaning_rows` 来源、mapped values、Mapping/规格置信度和 Review 状态列。

`0002_material_import_file_archive.sql` 为批次增加完整原文件归档 key、文件大小和解析 warning。超出 256 列分析窗口的工作簿不再直接丢弃：完整文件按 SHA 保存，Raw Rows 明确只保存安全分析窗口投影，Canonical Mapping 只读取可信表头命中的列。

文件导入在同一事务保存批次、原始行、映射结果、清洗队列和活动审计。旧文本 CSV 入口保持兼容。迁移前已创建 SQLite 可恢复快照，并在快照副本完成只读试迁移和 `PRAGMA integrity_check`。

## 5. 验证结果

- Spreadsheet 专项：6/6。
- Migration 专项：3/3，覆盖空库、已有数据、重复执行、失败回滚和约束。
- Python 联合单元：13/13。
- `server.py --self-test`：PASS。
- `smoke_test.py`：PASS，包含经认证的 XLSX 二进制上传。
- `go_live_check.py --require-running --no-backup`：PASS。
- 真实 V700：识别为 XLSX，规格描述作为待审核名称候选，229 行进入清洗审核。
- 真实 A118：识别为 XLSX，完整文件归档后从第 44 行可信表头生成 314 行清洗审核数据。
- 公网 HTML 已返回 `.csv,.xlsx,.xls` 文件选择器；systemd 使用项目虚拟环境并保持 `enabled/active`。

## 6. 当前边界

这是开发服务器部署，不是正式公司服务器投产。V700 的名称/单位语义和 A118 的 XFD 异常仍需数据所有人处置；系统不截断原始列、不补造名称/规格、不自动创建正式物料。正式投用仍需密码轮换、HTTPS、反向代理、访问控制和恢复演练。
