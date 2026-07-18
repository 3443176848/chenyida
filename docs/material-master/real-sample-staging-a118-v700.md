# A118 / V700 正式 BOM 待审核入库报告

任务：`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02`

状态：`DONE / DEVELOPMENT SERVER STAGED`

日期：2026-07-18（Asia/Shanghai）

## 1. 用户确认与处理原则

项目负责人明确确认 A118、V700 是正确且需要导入物料库的正式表格。本任务因此不再把“缺独立名称/单位”或“来源工作表超宽”视为整份文件拒绝条件，而是区分：

- 可以保存到 Import Batch、原文件归档、Raw Rows 和清洗审核队列的待审核数据。
- 只有名称、规格、单位均经人工确认后才允许生成内部物料的数据。

仍禁止把低置信度名称、空规格或空单位直接写入内部物料。

## 2. 适配结果

### A118

- 原文件 SHA-256：`43a9327621ef72ebd8110804d0a8165fe6785f8698c82a21aa82a161916d5125`。
- 强签名：XLSX，原文件名后缀为 `.csv`。
- Sheet：`SHEET1`；表头：第 44 行。
- 工作表声明宽度为 XFD；完整 709,381-byte 原文件按 SHA 归档。
- 结构分析只从 256 列安全窗口内识别可信表头，实际 Mapping 只使用表头命中的有效列；没有把 XFD 异常列写入 Canonical 字段。
- 生成 314 条待审核清洗行。
- 批次：`REAL-A118-20260718`。

### V700

- 原文件 SHA-256：`2a282fccabbf12a87908cdeb92ef962397f88cd7888cddf509c7556af845d5e5`。
- 强签名：XLSX，原文件名后缀为 `.csv`。
- 正确选择 `BOM` Sheet；表头为第 1～2 行。
- 当缺少独立名称时，“物料规格描述”只作为 `SUGGESTED` 名称候选，同时继续作为规格来源；必须人工确认。
- 生成 229 条待审核清洗行。
- 批次：`REAL-V700-20260718`。

## 3. 数据核对

| 核对项 | 结果 |
| --- | ---: |
| Import Batch | 2 |
| 原始工作表行 | 766 |
| 清洗审核行 | 543 |
| `NEEDS_REVIEW` | 543 |
| 空规格待处理 | 22 |
| 空单位待处理 | 543 |
| 导入前内部物料 | 4 |
| 导入后内部物料 | 4 |
| SQLite integrity | `ok` |

没有自动创建内部物料、供应商映射或正式编码。

## 4. 原文件与恢复

- 新增本地迁移 `0002_material_import_file_archive.sql`，在批次记录归档 key、文件大小和解析 warning。
- 原文件保存于 Git 忽略的 `chenyida_erp_app/data/import_files/`，文件名使用 SHA-256 和检测类型后缀。
- A118 的完整原文件是超过 256 列部分的原始权威来源；`material_import_raw_rows` 保存结构分析窗口内的行投影及 disposition，不冒充完整 XFD 展开。
- 写入前备份：`erp-backup-20260718-174855.sqlite3`。

## 5. 验证

- Spreadsheet/Migration/真实样本/环境联合单元：15/15。
- 真实两文件隔离闭环：2 Batch、766 Raw Rows、543 Cleaning Rows、0 Material。
- `server.py --self-test`：PASS。
- `smoke_test.py`：PASS。
- 迁移副本：`0001`→`0002`，记录数不变，`PRAGMA integrity_check=ok`。
- 公网开发服务：systemd `enabled/active`，网页展示来源行、Mapping/规格置信度和 Review 状态。

## 6. 后续人工工作

两批次目前都缺单位，不能批量生成内部物料。下一步应增加批次级 Mapping/默认单位确认和逐行异常处理；单位不得由系统默认补造。22 条空规格必须逐行填写或拒绝，其余名称候选也需按 Review 状态确认。
