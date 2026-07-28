# SELFHOST-PHASE6-TASK01 — BOM 物料规格标准化与主数据治理

## 状态与起点

- 状态：`DONE / NON-PRODUCTION ACCEPTED`。
- 开始时间：2026-07-29（Asia/Shanghai）。
- 完成时间：2026-07-29（Asia/Shanghai）。
- 任务起点：根仓库 `main` / `cda8c7e`，版本 `0.1.0-alpha.34`，PostgreSQL migration `0001—0034`。任务执行期间已有独立 LANDING-TASK04 部署记录 `3025443` 进入 `main`，本任务完成提交以其为直接 Parent，不改写该既有提交。
- 目标版本：`0.1.0-alpha.35`；唯一新增 expand-only migration 为 `0035_bom_material_governance.sql`。
- 唯一未来权威运行面：`chenyida_erp_site/` 的 Node.js/PostgreSQL 自托管链路。

## 目标

在既有 Material Import `CSV/XLSX -> Parser -> Mapping -> Normalization -> Review` 与 Material Draft/Review、Master Data/BOM 服务之间增加可配置、确定性和可解释的规格治理层：

1. 复用既有字段识别和非数据行排除，不创建第二套文件解析器。
2. 按品类、关键规格参数和性能等级分类并解析 `RES/CAP/IND/DIODE/TRANS/IC/OSC/CON/MECH/OTHER`。
3. 生成规范化参数、标准规格文本、严格身份签名和稳定候选组；名称、供应商料号和原始料号不作为通用物料唯一键。
4. 精确相同身份归为同一候选组；任一必需规格冲突或缺失时 fail closed，不自动归并。
5. 保存不可变来源行、原始料号、制造商、描述、BOM 批次、数量/单位与解析证据，提供 ERP 物料候选、BOM 映射、归并解释和异常四类报告。
6. 对同兼容规格但身份不同的已解析物料生成替代候选；不自动启用正式替代关系。
7. 人工可把候选组精确绑定到既有 ACTIVE Material，或以完整显式字段调用既有 Material Workflow 创建一个 DRAFT；同组全部来源因此追溯到同一稳定 `material_id`。

## 固定业务边界

- `RES` 唯一键至少包含封装、阻值、精度、功率；`CAP` 至少包含封装、容量、耐压、介质、精度；`IND` 至少包含封装、感值、额定电流、精度。
- `IC` 身份至少为完整型号/MPN + 封装，缺任一项不得自动归并；`TPS7A2033PDBVR` 与 `TPS7A2033` 不自动合并。
- `CON` 身份至少为品牌、型号、Pin 数、间距、结构；缺项进入异常/人工复核。
- 电气量使用精确十进制量纲归一，不使用浮点近似判等；`1uF`、`100nF`、`100pF` 必须分开，确定性等值表达才允许相同。
- 用户给定的 `0201WMJ0000TCE` 规则及 0201 默认功率作为版本化配置和显式证据处理；不得把未知厂商编码静默猜解。
- 对通用电阻/电容/电感，同一完整规格的不同供应商来源进入一个标准候选组并保留多条来源映射；对型号敏感类别，只生成替代候选，不跨型号自动归并。
- 标准规格键（如 `RES_0201_0R_5_1-20W`）是治理候选键，不是正式 ERP 编码。正式编码继续只由既有批准事务生成 `CYD-{CATEGORY}-{SEQUENCE}`。
- 自动化不得创建、批准或覆盖 ACTIVE Material，不得写正式 Supplier Mapping，不得让替代候选直接生效；这些操作继续受现有权限、职责分离、幂等、CAS 和审计控制。

## 实施范围

- 集中版本化规则配置、纯函数分类/解析/归一/签名/分组模块。
- PostgreSQL 0035：治理运行、候选组、行结果、结构化规格、来源追溯、现有物料候选、替代候选、决定/历史及必要索引/约束/不可变保护。
- 服务端 Repository/Service/Handler；所有响应使用稳定错误码、中文提示、`X-Request-ID` 和 `no-store`。
- 写接口执行 Session capability、CSRF、`Idempotency-Key`、请求摘要、CAS、单事务审计；读取执行批次 owner/`read_any` 行级可见性。
- API 提供启动治理、运行摘要、候选组/行分页、组决定以及四类报告查询。
- Schema、migration journal/snapshot、package scripts、单元/迁移/隔离 PostgreSQL 集成测试和使用文档。

## 明确不做

- 不修改 Python/SQLite 或历史 D1 业务规则。
- 不读取、修改或提交未跟踪 `shujvbiao/` 及其中真实业务文件。
- 不回填或重算现有 532 Material、6 BOM、316 BOM Line 或 438 条隔离来源。
- 不直接把治理结果写入 BOM Line；BOM 仍只能引用 ACTIVE Material。
- 不新增 UI，不实现多角色替代料批准、客户专用料下游门禁、单位换算过账、物料合并或历史单据改写。
- 不连接或迁移生产数据，不 build/restart/deploy 当前公网/并行运行面，不 push、不创建 PR。

## 验收标准（全部 PASS）

1. `0201WMJ0000TCE` 与 `0201,0R,±5%` 得到相同完整 RES 身份签名和同一治理候选组；证据明确说明厂商编码规则与 0201 默认功率。
2. `0201 1uF` 与 `0201 100pF` 不得同组；完整 CAP 测试同时验证耐压、介质、精度的任一差异都分组。
3. 型号敏感类别的同兼容规格、不同制造商/MPN 形成不同候选组和待审核替代候选；不会自动写正式替代关系。
4. 组绑定或建稿后可沿 `material_id <- governance group <- original row <- import batch/BOM` 查询完整追溯；同组多来源只创建一个 DRAFT。
5. 无法分类、缺少关键规格、IC 型号/封装缺失、参数冲突和疑似重复进入稳定异常码，不产生高置信自动归并。
6. migration 覆盖空库升级、0034 已有数据升级、重复执行、失败回滚、约束与汇总核对；单元和隔离 PostgreSQL 测试通过。
7. 适用轻量回归、typecheck、lint、`npm test`、`git diff --check` 和凭据扫描通过；未改 0001—0034、未写在线数据库或部署。

## 完成记录

- 实现：新增版本化规则配置、精确十进制量纲、品类解析器、严格身份签名/分组、来源透明度、候选/异常/替代报告，以及 Repository/Service/Handler/API 边界。
- 数据库：新增唯一 expand-only `0035_bom_material_governance.sql`和 9 张治理关系表，Schema/snapshot/journal 同步；旧 migration `0001—0034` 未改。空库、0034 已有数据升级、重复执行、失败回滚、约束与汇总核对已在两个隔离测试库验证。
- 全局门禁：治理建稿、普通 Draft 审批和治理 Draft 审批共享严格身份锁与预留；无法可靠重建的历史正式物料 fail closed。运行快照后新建且精确相同的 ACTIVE 可在决策时实时复核绑定。
- 自动验证：治理 unit `61/61`、PostgreSQL `16/16`、migration contract/upgrade `5/5 + 5/5`；Material/Normalization/Import Worker/Review PostgreSQL `7/7 + 5/5 + 1/1 + 4/4`；相关 Material unit/UI `63/63`；`npm test` `3/3`，typecheck 通过，lint `0 error / 8 既有 warning`。
- 验收边界：只是源码和隔离 PostgreSQL 验收。治理实现/测试未打开、解析或回填真实 BOM，未对常驻 PostgreSQL 执行 0035，未 build/restart/deploy，`shujvbiao/` 未修改、暂存或提交。但提交前凭据扫描器默认使用 `git ls-files --others`，曾在断网只读容器中对未跟踪路径发起读取；未输出或传输内容。这是已记录的边界偏差；扫描器已改为仍检查所有跟踪文件，但在打开内容前排除该受保护的未跟踪目录，最终断网只读复扫 1,050 文件通过。
- 已知限制：历史异常正式物料当前只安全阻断，无 ACTIVE 属性修订流程；`MECH/OTHER` 只会稳定进入 `UNSUPPORTED`；治理草稿不支持跨规则版本延续；正式替代关系、UI、真实数据迁移与部署需另立任务和授权。
- 完成提交：`feat: add BOM material governance pipeline`，实际 SHA 以 `git log` 为准。
