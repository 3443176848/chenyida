# A118 / V700 真实 BOM 自适应导入验证报告

任务：`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01`

状态：`DONE / READ-ONLY / NON-PRODUCTION`

功能提交：`cea940a`（`fix: adapt imports to real supplier BOMs`）

## 1. 安全边界

- 样本来自用户明确提供的附件路径，只读检查原文件。
- 没有把附件、业务行、价格、联系方式或单元格正文复制到仓库、日志或测试夹具。
- 结构诊断只输出文件元数据、Sheet、表头、列名、行数估计、Mapping 状态和安全失败原因。
- 没有连接生产 D1/R2/Queue，没有上传、Normalization、Approval、Draft、迁移或部署。

## 2. 文件结果

### 2.1 A118量产BOM.csv

| 项目 | 结果 |
| --- | --- |
| SHA-256 | `43a9327621ef72ebd8110804d0a8165fe6785f8698c82a21aa82a161916d5125` |
| 文件大小 | 709,381 bytes |
| 实际类型 | XLSX OOXML；扩展名误标为 `.csv` |
| 工作表 | 1 个可见 Sheet：`SHEET1` |
| 工作表维度 | `A1:XFD457` |
| 前 30 行摘要 | 单 Sheet、主要活动区为 A:I，含标题/说明和合并区域；前 30 行不是可信字段表头 |
| 候选表头 | 第 44 行，单行表头；数据候选从第 45 行开始 |
| 列名称 | 序号、名称、物料规格描述、厂商物料编码、生产厂商、用量、位号、备注、空列 |
| 估计数据区 | 只读前 9 列诊断得到 310 个 DATA 候选、36 个空行、10 个标题/说明、12 个页脚和 7 个超宽阻断行 |
| 规格覆盖估计 | DATA 候选中 266 行有规格、44 行规格为空；空规格继续进入人工复核，不可创建 Draft |
| Mapping | 名称→`material_name`、物料规格描述→`specification`、厂商物料编码→`manufacturer_part_no`、用量→`quantity` 均为 EXACT |
| 当前失败原因 | 第 197～203 行包含横向周期性重复引用，延伸到 Excel 最大列 XFD（16,384 列），超过 256 列安全上限 |

A118 的行数与覆盖率来自只读“仅前 9 列”结构诊断，不是成功 Parse/Normalization 结果，不能用于导入。系统保留 fail-closed：不静默截断、不丢弃原始列，也不把重复块自动修成正式数据。建议由数据所有人重新导出只含真实使用区域的 `.xlsx`，或在原系统人工删除第 197～203 行的 XFD 扩展区域后另存并重新提供文件。

### 2.2 V700量产BOM.csv

| 项目 | 结果 |
| --- | --- |
| SHA-256 | `2a282fccabbf12a87908cdeb92ef962397f88cd7888cddf509c7556af845d5e5` |
| 文件大小 | 48,712 bytes |
| 实际类型 | XLSX OOXML；扩展名误标为 `.csv` |
| 工作表 | 2 个可见 Sheet：`BOM`、`变更记录` |
| 前 30 行摘要 | `BOM` 第 1 行为合并标题，第 2 行为字段表头，第 3 行起为连续数据；未回显业务值 |
| 候选表头 | `BOM` 第 1～2 行组合表头；数据从第 3 行开始 |
| 列名称 | 序号、物料规格描述、物料型号、数量、位号、备注、替代料、空列 |
| 解析行数 | `BOM` 245 行、8 列；`变更记录` 15 行、8 列 |
| 数据行估计 | `BOM` 229 个 DATA 候选、3 个空行、2 个嵌入标题、9 个页脚 |
| 规格覆盖估计 | DATA 候选中 219 行有规格、10 行规格为空；222 行有型号 |
| Mapping | 物料规格描述→`specification`、物料型号→`model`、数量→`quantity` 均为 EXACT |
| 当前失败原因 | 自适应结构已通过，但文件没有可安全自动确认的标准名称和单位列；现有 Mapping 确认和 Draft Validation 会 fail closed |

V700 在修正前因“变更记录”Sheet 的字段别名密度较高而被误选。修正后 `BOM` 得分约 0.910，`变更记录` 因变更/历史语义降为约 0.591，最终以 `HIGH_CONFIDENCE` 选择 `BOM`。系统没有把规格描述自动当作标准物料名称，也没有补造单位；这两个业务语义需要项目负责人或数据所有人确认。

## 3. 基于真实样本的修正

- 文件内容签名优先：只允许“`.csv` 后缀但强签名为 XLSX”的单向兼容；仍执行完整 ZIP/OOXML、宏、加密、路径、压缩比和大小校验。
- 原后缀、检测类型和 `XLSX_CONTENT_WITH_CSV_EXTENSION` 写入既有安全事件证据；不把错标静默隐藏。
- Inspect 复用自适应前 50 行结构分析，输出 Sheet 候选、组合表头、列名和 Mapping 建议，不输出样本值。
- 增加 BOM/物料 Sheet 名称正向证据和变更/修改/修订/历史 Sheet 负向证据。
- “厂商物料编码”只映射制造商料号，不再被泛化为内部/供应商物料编码；“用量”映射数量。
- 嵌入式 BOM 标题按非数据行处理。
- 超过 256 列继续返回稳定 `IMPORT_PARSE_LIMIT_EXCEEDED`，CLI 只显示安全中文错误，不输出堆栈或业务正文。

## 4. 验证

| 验证项 | 结果 |
| --- | --- |
| 真实 V700 只读 Inspect | PASS；正确选择 `BOM` |
| 真实 A118 只读 Inspect | EXPECTED BLOCK；稳定返回“XLSX 列数超过限制” |
| 自适应专项 | PASS，11/11 |
| Parser 专项 | PASS，37/37 |
| 文件 Inspector 专项 | PASS，4/4 |
| Batch API 专项 | PASS，12/12 |
| Vinext build + 全量 Node | PASS，593/593 |
| lint | PASS，0 error；1 个任务外既有 warning |
| 隔离 API smoke | PASS |
| 凭证扫描 | PASS |
| Python self-test / smoke / go-live | PASS；测试备份已清理 |
| `git diff --check` | PASS |

## 5. 下一步门禁

1. V700：确认“标准物料名称”和“单位”的真实来源或提供补充主数据/Profile 规则；10 个空规格候选必须人工处置。
2. A118：重新导出只包含真实 A:I 使用区的 XLSX，或由文件所有人清除 XFD 异常块后提供新的文件及 SHA-256。
3. 两份文件在 Mapping 人工确认前都不得进入 Normalization Approval 或 Draft。
4. 生产上传、Profile 初始化、生产迁移和部署仍需单独明确授权。
