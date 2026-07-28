# SELFHOST-LANDING-TASK02 完成报告

## 结论

- 状态：`DONE / STAGING COMPLETE`。
- 固定结论：`STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`。
- 8 个获准真实表格全部通过文件数、名称和 SHA-256 强校验；只在本机离线只读解析，未上传、联网转换或写入 Python/SQLite/D1。

## 脱敏盘点

- 8 个文件、13 个 Sheet，共分类 1,113 条有效或说明记录。
- `ELIGIBLE=0`、`NEEDS_REVIEW=950`、`ARCHIVE_ONLY=163`、`BLOCKED=0`。
- 950 条结构化候选全部缺少明确单位；另识别 50 条稳定身份冲突、186 条重复来源、43 条异常数量、416 条缺数量和 499 条缺稳定身份。问题可重叠，未以原因数冒充记录数。
- A200 的 BOM、物料清单和量产注意事项分别处理；注意事项只归档，BOM 与清单之间没有可用于自动物化的精确稳定身份交集，因此未合并或重复导入。
- XLSX 公式以公式文本和缓存值交叉核验；全部 266 个公式单元格均有缓存值。旧式 XLS 由服务器既有固定 `xlrd` 离线读取，仅提供缓存值，且整份文件归为工艺资料，不解释为 BOM。

## 备份、staging 与数据库门禁

- 主库停 Web/Worker 后生成 PostgreSQL custom-format pre-import 备份；`pg_restore --list` 和新的空数据库恢复均通过，恢复库随后删除。主库迁移为 34、身份/Session/Audit=`1/1/1`、Material/Product/BOM 和全部交易事实为 0。
- 唯一 staging 数据库从空库使用正式 migration runner 升级到 `0034_supplier_receipt_lot_iqc.sql`。两次相同计划重放得到相同数据库快照摘要，新增记录为 0；孤儿引用、重复内部编码、非法 BOM 数量/单位和非目标交易副作用均为 0。
- 正式 Material Service 要求分类、单位、草稿、职责分离审核与 ACTIVE 状态；当前主库没有 Unit、Material Category 或 ACTIVE Material，真实表格也未提供可确认分类/单位，禁止绕过服务直接建正式物料。
- `0034` 的 Product/Product Version/BOM Header/Version/Line 没有文件摘要、Sheet、原始行或 Import Batch 来源字段，无法满足本任务要求的逐条来源追踪。修复需要独立 Schema/Migration 任务，本任务按门禁停止主库写入。
- 主库没有执行任何正式 Service mutation；Material、Product、BOM、Inventory、PO/Receipt、Work Order、Shipment、AR/AP/Settlement 均保持 0。因为主库未写入，不创建 post-import 备份。

## 保密、Git 与清理

- 逐行映射、待确认清单、盘点 JSON/CSV 和备份只保存在仓库外 root-only 位置；仓库只记录脱敏计数、原因类别和恢复结论。
- 原始表格未被 add、commit、移动、改名或修改；最终 inode、大小、权限、mtime 和 SHA-256 与起点一致。
- staging、pre-import 恢复库、容器内临时 dump 和 Python bytecode 缓存均已清理；pre-import 备份、既有 alpha.34 灾备包、resource-guard 备份和四个 ERP 持久卷保留。
- 未执行 build、Schema/Migration 修改、生产部署、push、PR、外部上传、Python 服务停止或旧 SQLite 删除。

后续若要继续，必须先由数据责任人确认单位、分类、稳定物料身份、A200 来源关系及版本，再单独设计 Product/BOM 行级 provenance migration；本任务不自动开始该工作。
