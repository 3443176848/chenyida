# SELFHOST-PHASE1-TASK02 修改前诊断

诊断日期：2026-07-23（Asia/Shanghai）
工作目录：`/opt/erp/chenyida_erp_site`
范围：Import Mapping、Mapping 版本、复用/失效与自托管 API；不包含行级 Normalization、查重、人工复核或 Material Draft。

## Git 与基线

- 根仓库分支：`main`
- 修改前 HEAD：`2c1003f2547b934424c03f216936c43b0f1efd40`
- 相对 `origin/main`：ahead 23
- 工作区：保留 `SELFHOST-PHASE0-TASK01` 与 `SELFHOST-PHASE1-TASK01` 的未提交基础设施、Material 工作流、测试和文档；本任务不得覆盖、reset、checkout 或 clean。
- PostgreSQL migration：`0001_selfhost_baseline.sql` 建立 46 表，`0002_material_master_workflow.sql` 只增加 Material 编码序列、审批索引和状态/编码约束。两者均视为已执行基线，不修改。

## PostgreSQL 当前实现

- `db/schema.ts` 与 `0001` 已包含 Import Batch、File、Raw Row、Parse Run、Sheet、Header Suggestion、Mapping、Mapping Item、Outbox 和 Idempotency 表。
- 当前 `material_import_mappings` 只是基线占位结构：缺少稳定 target namespace、源字段/源结构摘要、目标目录摘要、确认/修改身份、失效原因、取代关系、复用来源和不可变快照。
- 当前 `material_import_mapping_items` 只按 `target_code` 唯一，不能可靠区分 namespace，也没有完整保存旧 D1 的多源列、表头、组合分隔符和状态字段。
- `material_import_rows` 保存 Parser 原始稀疏 cell JSON 与行 hash；不得写入清洗或标准化结果。

## 自托管上传、Parser 与 Worker

- 自托管 API 已提供批次创建、文件上传、parse/normalize Job 排队和 Job 查询。
- Worker 已复用有界 CSV/XLS/XLSX Parser，但只直接替换批次 Raw Rows 并把批次标记为 `PARSED`。
- Worker 尚未发布 current parse run、Sheet 汇总、表头建议或 Mapping 草稿；现有 Material Import 页面所需的 sheets/rows/mapping 路由无法在自托管运行面完成。
- Phase 0 的 `material.import.normalize` 只是批次状态占位 handler；本任务不得扩展为行级 Normalizer。

## 旧 D1 Mapping 行为基线

- Migration `drizzle/0005_material_import_parser_mapping.sql` 定义 `DRAFT`、`CONFIRMED`、`STALE`、`SUPERSEDED`，Mapping 与 parse run 永久绑定，并使用批次版本和 Mapping 版本双 CAS。
- 旧 Service 支持 Sheet/Rows、Mapping 获取、完整替换保存、100 行内预览、确认、动态 Catalog、CSRF、Idempotency-Key、正文摘要、事件和审计。
- 确认只允许 `DRAFT`，确认后 PUT 不能原地覆盖；`STANDARD_NAME` 与 `UNIT` 是确认必填目标；非 ignore 目标不得重复。
- 旧 schema 定义 STALE/SUPERSEDED，但旧 Service 没有完整跨批次复用候选、复制、主动失效或版本列表 API。本任务在保持旧字段名和状态名的前提下补齐这些能力。
- 旧幂等以用户、方法、批次路由和 key digest 唯一；同 key 异正文返回 409，相同完成请求返回保存结果。旧请求摘要直接使用 JSON 序列化，本任务改为服务端确定性序列化。

## 动态目标目录与稳定代码

- 旧 Registry 的 BASIC/SPECIAL 为服务端静态定义，ATTRIBUTE 来自运行时 ACTIVE metadata；Catalog、保存、预览和确认共享同一语义摘要。
- 属性长期标识是稳定大写 `attribute_code`，不是 `attribute_id`。PostgreSQL seed 使用同一 code，并通过 `material_category_attributes` 显式绑定四级分类。
- 旧 Catalog 不返回 attribute ID；显示名称变化不进入 Mapping 语义摘要，类型、枚举、单位、启用状态等变化会改变摘要。
- 新 PostgreSQL Catalog 需继续保留 namespace/code 契约，并补充分类归属、分类级必填信息、格式/单位/枚举；前端不得硬编码完整目录。

## 前端与测试

- 现有 `/materials/imports/:batchId` 已具备 Sheet、Rows、表头、动态 Catalog、Mapping 保存/预览/确认、409 提示、页面内幂等重试和提交禁用。
- 页面当前没有版本列表、复用候选、STALE/SUPERSEDED 说明，需要最小增量接入；Normalization Review 的七步布局、view 和 Drawer 不修改。
- 旧 Mapping/Parser/Catalog/UI 测试依赖 Miniflare D1，仅作行为参照；本任务新增测试必须直接使用纯单元或隔离 PostgreSQL。

## 实施结论

1. 新增 `0003_material_import_mapping.sql`，不得修改 `0001`/`0002`。
2. 建立独立 PostgreSQL Mapping Repository、Service 和 Handler，`selfhost-api.ts` 只做统一会话入口和路由委托。
3. Parser 发布补齐 parse run、Sheet 和初始 Mapping 草稿，但继续只保存不可变原始行。
4. 确认版本以不可变快照和确定性摘要保存；新版本确认后旧确认版本进入 `SUPERSEDED`，结构/目标不兼容时进入 `STALE`，历史不删除。
5. 复用按导入类型、Sheet/表头、规范化源字段顺序、源结构摘要和当前目标目录验证分为自动推荐、需重新确认、不可复用和失效；文件名不参与决定。
6. 不实现行级 Normalization、匹配、Draft 或正式编码。
