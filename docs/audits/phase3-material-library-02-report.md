# PHASE3-MATERIAL-LIBRARY-02 当前导入能力确认报告

- 开始时间：2026-07-18 14:41 CST
- 报告时间：2026-07-18 CST
- 基线提交：`c660cc3`
- 功能提交：`b3d26c3`（`feat: harden material import governance`）

## 1. 当前阶段状态

`BLOCKED / NO_REAL_DATA_MODE`。限定扫描未发现真实企业物料文件；未扩大 ERP 模块、未修改 Material Master 架构、Schema 或 Migration，未连接生产。

当前 D1/Drizzle 开发 Schema 为 44 表，Migration journal 为 `0000`—`0007`；`0007` 仅通过隔离 D1 验证。既有流程为 current successful Normalization → 绑定 digest 的人工 Approval → 既有 Draft Service → `DRAFT`；后续仍须既有 submit/review 才能生成正式编码并进入 `ACTIVE`。

## 2. 使用的数据文件

未使用或导入任何真实数据文件。只读检查 `/opt/erp`、`/home`；20 个候选路径按 SHA 去重为以下 10 个已跟踪治理模板/样例（含 Site 镜像），`/home` 无候选。用户未指定其他上传目录。

## 3. 文件统计

| 文件 | 大小 | SHA-256 | 结构 | 判断 |
| --- | ---: | --- | --- | --- |
| 物料主数据治理模板.xlsx | 22,404 B | `1af7c5f41c86eb809e1b57830c1c57f7a3a3160314a09382c2467e4c83eaa359` | 10 Sheets | 治理模板，非真实主数据 |
| 待确认清洗结果.csv | 833 B | `c96e83ae1af1ac050f598ef22f7ecfa0c4aaeafc4d705fd758763b93908b4056` | 1 CSV | 样例/治理输出 |
| 供应商原始物料导入模板.csv | 620 B | `9e7f10f1b607924792931f1e7cc92a32d01d656dde35adc9102eff54fefe4550` | 1 CSV | 导入模板 |
| 供应商物料映射表.csv | 423 B | `75973ca0d668022eb1199eb90c7515e639288262b92553b7a2d740066f493dc6` | 1 CSV | 映射模板 |
| 内部标准物料库.csv | 741 B | `5a3f652b74c4153d870808cf3065b92e7557e4efb4054f67767713eb2823fb57` | 1 CSV | 示例库 |
| 客户专用料表.csv | 187 B | `83d9ed1af4065db9ea5a4eaed95196ad2365a1bf04fa7374e5fa54e4b8b161ee` | 1 CSV | 治理模板 |
| 待清洗物料池.csv | 338 B | `835071cf27c1e6e88e990302d8f6a513eb6d71c75deefee3dbdd34c5148b10a8` | 1 CSV | 样例/治理输入 |
| 新物料申请审核表.csv | 337 B | `937fd349d67f100f9ddb21d628e6437bd7e740bc2ad69391e2c2bc90771deef2` | 1 CSV | 审核模板 |
| 替代料关系表.csv | 249 B | `8307f3ddbacd00938fdd1604c25e0c49a89992c2e19d442fda9162a98f43b2d2` | 1 CSV | 治理模板 |
| 物料属性模板.csv | 630 B | `a6da22cf354e5b6be44492dd813f1c9f06ddcdc69c1f1d6dcc8aced2142353c6` | 1 CSV | 属性模板 |

## 4. 字段映射结果

既有关系化 Mapping 可保存、版本 CAS、绑定 metadata digest、确认并留存事件/审计；未硬编码真实字段映射。新增本地只读 inspect 可识别物料编码、名称、分类、规格、型号、品牌、单位、图号、制造商料号和供应商料号的表头候选。真实 Mapping：`N/A`。

## 5. 分类匹配结果

合成隔离测试通过：分类 code=`EXACT`，唯一名称=`MATCHED`，未命中或冲突=`NEEDS_REVIEW` 并给出有界疑似候选；不自动创建分类。真实结果：`N/A`。

## 6. 单位匹配结果

合成隔离测试通过：标准 code=`EXACT`，alias（含 `个/件/pcs → PCS`）=`MATCHED`，未命中或冲突=`NEEDS_REVIEW`；不自动创建单位。真实计数：`N/A`。

## 7. 品牌匹配结果

合成隔离测试通过：code/name/alias 分级匹配，空品牌单独标识，未命中作为新品牌候选待审；不自动创建品牌。正式品牌主数据尚未初始化；真实计数：`N/A`。

## 8. 重复检测结果

合成隔离测试通过：`EXACT` 阻断，`HIGH_CONFIDENCE` 阻断并要求人工确认，`POSSIBLE` 只提示；禁止自动合并。真实计数：`N/A`。

## 9. dry-run 结果

真实 dry-run：`NOT RUN`。安全汇总能力已验证，可输出总数、成功/错误/警告/重复/待审及分类、单位、品牌、重复等级计数，不输出完整物料行。专项 9/9、全量 Node 575/575、build、lint（0 error/1 个既有 warning）、隔离 API smoke、本地临时 SQLite 基线和 319 文件凭证扫描通过。

## 10. DRAFT 数量

`0`。没有上传、批准、commit 或创建模板/合成/真实 Material Draft；没有创建 `ACTIVE`。

## 11. 错误与问题列表

- `NO_REAL_DATA`：缺少真实 `.xlsx/.csv` 和隔离上传目录。
- 品牌正式主数据尚未初始化，真实品牌召回率未知。
- `HIGH_CONFIDENCE` 已 fail-closed，但逐行人工确认、审计与解除流程尚未实现。
- 候选扫描上限 500、输出 20；真实召回率和容量未验收。
- 生产迁移、备份、资源和部署均未授权。

## 12. 修改文件

新增本地 Inspector 与测试；修改导入 CLI、Draft Generation Service、package script、专项测试及项目治理文档。未修改 Schema、Migration、hosting、本地 Python 业务代码或真实数据文件。

## 13. Git Commit

- `b3d26c3 feat: harden material import governance`
- 文档提交：`docs: record material import governance progress`（本报告提交）
- 未创建 `feat: import first material draft batch`，因为没有真实批次可导入。

## 14. 下一阶段建议

用户提供真实文件和隔离上传目录后，先核对 SHA 并执行只读 inspect；再人工确认 Mapping、分类/单位/品牌和重复候选，完成隔离 dry-run。只有 dry-run 通过且 HIGH_CONFIDENCE 逐行解除流程可审计时，才批准并创建来源可追溯的 `DRAFT`；生产迁移或部署另行授权。
