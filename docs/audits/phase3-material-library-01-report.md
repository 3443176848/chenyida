# PHASE3-MATERIAL-LIBRARY-01 审计与实施报告

## 当前物料模块状态报告

### 已完成

- 既有 `material_master`、分类、动态属性、别名、供应商映射、版本、审计和 Draft/Review/Code 服务完整存在。
- 既有 Import Batch/File/Row/Event、Parser、Mapping、Normalization Run/Row/Issue、Review UI 已到 `NORMALIZED`。
- 数据库确认：Cloudflare D1（SQLite 语义）；ORM 为 Drizzle；迁移为 `drizzle/*.sql`、snapshot/journal 和受保护 Down。
- 本任务复用以上模型，新增单位/品牌字典、Normalization Approval、Import Row→Draft 关联和重复候选；未创建第二套 `materials`。
- 已连接 `Approved Normalization -> Material Draft`，且 Draft 无正式编码、保持 `DRAFT`。

### 已实现代码

- `draft-generation-service.ts`：inspect、dry-run、approval、commit、report。
- 既有 Material Draft Service/Repository 扩展原子 Import trace 写入。
- Material Import Handler 新增 3 个批次作用域路由和 `material.import.commit`。
- Material Query Detail 返回结构化来源和重复候选。
- `material-library-import.mjs` 提供只允许回环测试/本地环境的命令入口。

### 已存在和新增数据库表

- 既有：`material_master`、`material_categories`、`material_attribute_definitions`、`material_attribute_values`、`material_aliases`、`supplier_mappings`、`material_import_batches/files/rows/events`、Normalization 三表等。
- 新增：`units`、`unit_aliases`、`brands`、`brand_aliases`、`material_import_normalization_approvals`、`material_import_draft_links`、`material_duplicate_candidates`。

### 未完成

- 未执行生产 0001—0007 迁移、部署或真实数据导入。
- 未用真实企业物料文件 dry-run；未初始化正式品牌主数据。
- 未扩展既有 Review UI 写操作；命令/API 已具备闭环能力。
- 未建立生产外部备份、试迁移报告、人工冲突处置和容量验收。

### 风险

- 生产仍是旧版本 v3，不能把非生产代码视为已上线能力。
- 品牌和分类无法唯一命中会阻断 Draft，这是预期 fail-closed 行为。
- 旧编码没有新增 Import Mapping Target；当前只通过既有供应商料号、别名和映射参与候选检测。
- 候选扫描上限 500、输出 20，尚未以真实大规模物料库验证召回率和查询容量。
- 本地基线执行时首次 `go_live_check.py --no-backup` 未显式设置临时路径，触发兼容库幂等初始化并改变文件 mtime；未生成备份，复制库复测的逻辑 dump SHA-256 前后均为 `7d2032b814c57157cebc79c406ba96d16342fcb3751a5ad74cfdebc2ff608305`。随后已按规则在 `/tmp/chenyida-erp-test-*` 重跑并清理；生产 D1 从未连接。

## 候选文件清单

仅扫描 `/opt/erp`、`/home`，未扫描整个服务器。下表每个文件同时存在于根目录治理包和 Site 内镜像目录，两个副本大小及 SHA-256 相同；`/home` 未发现候选文件。

| 名称 | 大小（字节） | SHA-256 | 表数量 |
| --- | ---: | --- | ---: |
| 物料主数据治理模板.xlsx | 22,404 | `1af7c5f41c86eb809e1b57830c1c57f7a3a3160314a09382c2467e4c83eaa359` | 10 |
| 待确认清洗结果.csv | 833 | `c96e83ae1af1ac050f598ef22f7ecfa0c4aaeafc4d705fd758763b93908b4056` | 1 |
| 供应商原始物料导入模板.csv | 620 | `9e7f10f1b607924792931f1e7cc92a32d01d656dde35adc9102eff54fefe4550` | 1 |
| 供应商物料映射表.csv | 423 | `75973ca0d668022eb1199eb90c7515e639288262b92553b7a2d740066f493dc6` | 1 |
| 内部标准物料库.csv | 741 | `5a3f652b74c4153d870808cf3065b92e7557e4efb4054f67767713eb2823fb57` | 1 |
| 客户专用料表.csv | 187 | `83d9ed1af4065db9ea5a4eaed95196ad2365a1bf04fa7374e5fa54e4b8b161ee` | 1 |
| 待清洗物料池.csv | 338 | `835071cf27c1e6e88e990302d8f6a513eb6d71c75deefee3dbdd34c5148b10a8` | 1 |
| 新物料申请审核表.csv | 337 | `937fd349d67f100f9ddb21d628e6437bd7e740bc2ad69391e2c2bc90771deef2` | 1 |
| 替代料关系表.csv | 249 | `8307f3ddbacd00938fdd1604c25e0c49a89992c2e19d442fda9162a98f43b2d2` | 1 |
| 物料属性模板.csv | 630 | `a6da22cf354e5b6be44492dd813f1c9f06ddcdc69c1f1d6dcc8aced2142353c6` | 1 |

这些文件均是已跟踪治理模板/样例，不视为真实首批物料文件，因此没有上传、导入或对真实文件执行 dry-run。

## 验证结果

- 0007 Migration：已有数据升级、约束/外键、受保护 Down/re-up、失败整批回滚 3/3。
- Import→Draft：追溯、候选、权限、CSRF、请求/行幂等 3/3。
- 既有 Material 生命周期回归：14/14。
- 全量 Node：569/569。
- Vinext build：PASS；lint：0 error，1 个任务外既有 warning。
- Drizzle：44 tables，`No schema changes`。
- 隔离 API smoke、314 文件凭证扫描、远程 URL 拒绝：PASS。
- 本地 Python：环境守卫 4/4、self-test、smoke、backup/restore、临时 go-live：PASS。

功能提交：`2ff8d9c feat: add material master database schema`。
