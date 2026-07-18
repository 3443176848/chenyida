# 多供应商自适应物料导入 V1 完成报告

任务：`PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT`

状态：`DONE / NON-PRODUCTION`

功能提交：`41e293f`（`feat: adapt supplier material imports`）

## 1. 审计结论

现有链路已经具备 Import Batch、对象文件解析、不可变 Raw Rows、Mapping、Normalization、Review、Validation、Event/Audit 和 Material Draft，故本任务只扩展该链路，没有建立第二套导入系统。

旧实现的主要失败原因是：

- 默认使用第一个可见工作表；
- 只检查前 10 行并只支持单行表头；
- 字段判断主要依赖固定标题和单一来源列；
- Source 唯一约束不允许一个标准字段组合多个来源列；
- Normalization 只跳过精确表头行，无法稳定排除说明、重复表头、合计和页脚；
- 缺失规格可以继续形成候选，未在 Draft 前 fail closed。

## 2. 真实样本检查

本任务完成当时结果：`NO_REAL_SAMPLE_FILES`。2026-07-18 后续用户提供 A118/V700 两份真实 BOM，验证结果见 `material-import-real-sample-a118-v700.md`；本段保留为当时审计事实。

检查范围仅包括 `/opt/erp` 及其中受控的 `data`、`imports`、`uploads`、`samples`、项目配置上传目录和测试 fixture；没有扫描整个服务器。发现的 XLSX/CSV 均为仓库已跟踪的物料治理模板、输出模板或其镜像，不属于用户真实供应商文件，因此没有把它们列为真实兼容性样本，也没有输出业务行、价格或联系方式。

由于受控目录内不存在真实样本，无法如实生成逐文件的文件名、SHA-256、大小、工作表、前 30 行结构、候选表头、数据量和失败原因报告。后续用户提供真实文件后，必须先只读 inspect，再补充逐文件报告和实际召回率/误判率；不得把合成夹具结果表述为真实供应商验收。

## 3. 实施结果

### 3.1 结构识别

- 对全部可见工作表读取前 50 行评分，不再默认第一个 Sheet。
- 对 1～3 行连续表头评分，保留合并单元格传播后的父子路径。
- 保存候选工作表、表头起止行、数据起始行、置信度、评分证据和 reason codes。
- 数据区区分 `DATA`、`BLANK`、`TITLE_OR_NOTE`、`REPEATED_HEADER`、`SUBTOTAL`、`TOTAL` 和 `FOOTER`。

### 3.2 Mapping 与规格提取

- 标准字段别名集中在单一词典，覆盖中英文名称、规格、型号、尺寸、描述、料号、单位、品牌、分类、图号、数量和价格。
- 评分同时使用标题、样本类型、唯一率、长度和尺寸/型号/单位特征，以及受控 Supplier Profile 历史。
- Mapping 状态为 `EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT`；低置信度、冲突和未映射结果不能静默确认。
- 一个标准字段可使用多个来源列和受控组合策略；规格可由型号、尺寸、材质、颜色和参数确定性组合。
- 名称/描述中的规格只形成可解释候选；不调用 AI，不补造值。空规格生成 `NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED`，阻断 Draft。

### 3.3 Canonical Import Row

Canonical 行进入现有 Normalization payload 和关系化队列列，包含文件、Sheet、行号、Supplier/Profile、原始字段投影、映射值、映射/规格置信度、Mapping/Review 状态和时间。完整原始值仍只保存在不可变 `material_import_rows`，Canonical payload 只保存其 lineage/hash 引用。

被判定为说明、重复表头、合计或页脚的原始行不删除；Normalization 为其保存 `row_disposition=SKIPPED`、分类证据和置信度，并将 Review 状态置为 `REJECTED`，Draft Generation 排除这些行。

### 3.4 Migration 与恢复

`0008_supplier_adaptive_import.sql` 增加 Supplier Profile、结构分析、来源数组/组合策略、Mapping 证据，以及 Normalized Row 的映射/规格置信度和 Review 状态。旧 `0005` Mapping 保持兼容。

SQLite/D1 不支持在本迁移约束下安全删除全部新增列，故 Down 采用受保护的兼容回退：存在自适应业务数据时拒绝；无数据时移除自适应索引并恢复旧 Source 唯一索引，但保留新增可空列。完整结构回退必须恢复执行 `0008` 前的可恢复数据库快照。

## 4. 验证

| 验证项 | 结果 |
| --- | --- |
| Vinext build + 全量 Node | PASS，589/589 |
| 自适应识别专项 | PASS，9/9 |
| `0008` Migration 专项 | PASS，3/3 |
| Parse→Profile→Mapping→Normalization 运行时闭环 | PASS，2/2 |
| lint | PASS，0 error；1 个任务外既有 warning |
| 隔离 API smoke | PASS |
| Material query plan（1k/10k/100k） | PASS |
| 凭证扫描 | PASS，最终文档范围 328 个仓库文件 |
| Python `server.py --self-test` | PASS |
| Python `smoke_test.py` | PASS |
| Python `go_live_check.py` | PASS；测试生成的备份已清理 |
| `git diff --check` | PASS |

测试全部使用隔离 Miniflare D1、临时数据库或合成脱敏 fixture。没有连接生产 D1/R2/Queue，没有执行生产迁移、真实文件上传、Draft 创建、Sites 保存或部署。

## 5. 未验证范围与下一步

- 真实供应商表头召回率、误判率、工作表选择和规格提取质量尚未验证。
- Supplier Profile 尚未用真实样本初始化；Profile 创建和变更必须受控并保留审计。
- Mapping 工作区支持批次级人工确认，但更细粒度的逐行规格修订仍应作为独立任务评估，不得用自动补值绕过。
- 用户提供真实 `.xlsx/.csv` 后，下一步只能先执行只读 inspect、脱敏结构报告、人工 Mapping 和 dry-run；生产迁移、资源、数据写入和部署仍需单独明确授权。
