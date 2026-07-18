# 晨亿达ERP变更日志

本文件记录可审计的项目变化。每个任务提交前必须增加一条记录，包含 Git Commit、功能、数据库、API 和文档影响。当前提交无法在自身内容中稳定写入自身哈希，因此使用“任务编号 + 提交消息”作为本条标识，实际哈希以 `git log` 为准。

## 2026-07-18

### PHASE3-MATERIAL-LIBRARY-SPEC-MATCH-01 - `feat: match supplier rows by specification`

- 样本：审计 1928C、G20-G15G、J587 三份 XLSX；G20 的 Description-only 表头原先被名称门禁拒绝，J587 描述/备注冲突会导致规格为空。
- Parser：增加 HC_CODE、VendorCode；Description-only 作为 SUGGESTED 规格/名称候选；正式描述优先备注；全部 Canonical 字段为空的行标记 `UNMAPPED_NON_DATA`，Raw 保留。
- 规格：三文件隔离得到 221 Cleaning Rows，其中 216 条有规格；G20 5 条原始 Description 为空，不用料号冒充规格。
- Matcher：删除名称相似度评分；来源规格硬冲突立即排除，完整唯一规格才自动确认编号，部分唯一候选保持疑似，多候选同分不随机给号；支持 0.1uF=100nF、5.0V=5V、+5%=5%。
- 当前库：三文件没有完整唯一匹配编号 1～5 的行；J587 5 条缺误差，不能在 1/2/3 中唯一选码。未创建新内部物料。
- 验证：规格编号 7/7、Parser/真实样本 12/12、隔离文件导入 3 Batch/316 Raw/221 Cleaning/0 Material，联合基线 33/33、smoke/self-test/go-live 通过；systemd 已部署且未重写现有数据。

### PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01 - `feat: safely clear cleaning rows`

- 权限：清空接口要求 `system`，仅管理员页面显示按钮，普通角色服务端拒绝。
- 确认：浏览器确认之外，`POST /api/cleaning/clear` 还要求固定 `CLEAR_CLEANING_ROWS`；缺失返回稳定错误且不删除。
- 恢复：成功操作先自动创建 SQLite 备份，再清空 Cleaning Rows；响应返回删除数量和备份信息。
- 事务/审计：删除与操作日志在 `BEGIN IMMEDIATE` 事务内完成，记录操作者与行数；保留 Batch、Raw Rows、原文件归档、物料和供应商映射。
- 测试：清空专项 3/3、与排序联合 7/7、smoke 通过；systemd 公网开发服务已部署。部署过程未调用真实清空，229 条 V700 记录不变。

### PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01 - `feat: sort cleaning rows by confidence`

- API：`GET /api/cleaning` 增加 `confidence_sort=newest|desc|asc`，未知值回退 newest；SQL 排序只使用固定白名单。
- 顺序：服务端对完整 Cleaning 查询按匹配置信度排序后再应用 500 条上限；同分按 ID 降序，默认保持最新记录。
- UI：“清洗审核”增加“匹配置信度排序”，可选最新、由高到低、由低到高；切换只刷新清洗列表。
- 测试：排序单元 4/4，smoke 覆盖升降序和未知值回退，self-test/go-live 通过。
- 部署：systemd 开发服务已重启为 `enabled/active`，公网 HTML/JS 已核验新控件。
- 真实队列：部署期间用户已网页重导入 V700；229 条、21 个置信度层级（0.00～1.00）的升降序检查均通过。

### PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01 - `docs: record capacitor matching test seed`

- 用户数据：只采用项目负责人更正后的五条电容规格，按临时内部编码 1～5 建入开发服务器物料库；首次重复版本未执行。
- 结构化字段：CAP、容量、规范化误差、电压、0201 封装、PCS；名称保留用户输入的正号，未创建供应商映射。
- 清理：单一事务删除 543 条旧 Cleaning Rows；保留 2 个 Import Batch、766 条不可变 Raw Rows 和完整 SHA 原文件归档。
- 恢复：写入前备份 `erp-backup-20260718-182230.sqlite3`，SHA-256 为 `f97337052aa9fcc0258355a9a0d7655e6d51f865c28189e6f901ec673f597613`；先在备份副本执行同一事务。
- 验证：内部物料 4→9；五条输入分别自动匹配编码 1～5，置信度均为 1.00；SQLite integrity `ok`，systemd `enabled/active`，公网 HTTP 200。

### PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02 - `feat: stage real BOM imports for review`

- 用户确认：项目负责人明确 A118/V700 是正确且需要入库的正式表格，不应因缺独立名称/单位或 XFD 异常声明宽度拒绝整份文件。
- A118：完整原文件按 SHA 归档；从第 44 行可信表头和 256 列安全分析窗口生成 314 条待审核行，不把异常 XFD 列映射到 Canonical 字段。
- V700：正确选择 BOM 第 1～2 行；规格描述同时生成 `SUGGESTED` 名称候选，生成 229 条待审核行，不自动确认名称。
- 数据：新增 `0002_material_import_file_archive`；实际写入 2 Batch、766 Raw Rows、543 Cleaning Rows，543 条全部 `NEEDS_REVIEW`，22 条空规格、543 条空单位，内部物料保持 4 条。
- 恢复：写入前备份 `erp-backup-20260718-174855.sqlite3`；迁移副本和写入后 `PRAGMA integrity_check` 均为 `ok`。
- 验证：环境/Spreadsheet/Migration/真实样本联合单元 15/15、self-test、含二进制 Excel 的 smoke 和公网开发服务检查通过。

### PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT - `feat: enable local spreadsheet imports`

- 运行面：修复实际常驻的 `chenyida_erp_app`，网页文件选择器和后端现已接受 `.csv/.xlsx/.xls`，不再把 Excel 当 CSV 文本读取。
- 解析：按强签名识别 CSV/OOXML/OLE，固定 `defusedxml==0.7.1`、`openpyxl==3.1.5`、`xlrd==2.0.2`；限制 10 MiB、50 Sheet、50,000 行/Sheet、256 列，并拒绝 XLSX 宏、加密、外链、路径和压缩资源异常。
- 自适应：评分全部 Sheet、前 50 行、1～3 行和合并表头；集中字段别名、样本特征、多列规格组合及非数据行分类。缺少明确名称、规格证据不足或 Mapping 冲突时 fail closed/进入复核，不由 AI 补造。
- 建档门禁：清洗行创建内部物料前，页面和服务端均要求人工确认标准名称、规格和基本单位；空规格或空单位禁止建档，不再自动补 `PCS`。
- 数据库：新增本地版本化迁移 `0001_material_import_source_lineage`，保存文件 SHA、Sheet/表头/Mapping 快照、不可变原始行，以及清洗行来源、mapped values、Mapping/规格置信度和 Review 状态。
- 测试：Spreadsheet 6/6、Migration 3/3、联合单元 13/13、self-test、含 XLSX 二进制 API 的 smoke、go-live、快照副本试迁移和完整性检查均通过。
- 部署：迁移前备份 `erp-backup-20260718-172714.sqlite3`；systemd 改用 `/opt/erp/.venv/bin/python` 后重启为 `enabled/active`，本机和公网 HTML 已验证新文件类型。
- 真实样本：V700 仍因缺少明确物料名称阻断，A118 仍因 XFD 超宽阻断；没有截断、补造或写入这两份真实附件。

### PHASE3-MATERIAL-LIBRARY-PUBLIC-VERIFY - `chore: enable port 18888 public verification`

- 运行：服务器应用改为绑定 `0.0.0.0:18888`，公网验证地址为 `http://43.135.157.211:18888`。
- 范围：只验证健康接口和网页可达性；不配置域名、TLS、反向代理或其他端口，不输出凭证。
- 前置：项目负责人提供公网 IP 及 TCP 18888 IPv4/IPv6 入站允许规则截图。
- 结果：本机与 `43.135.157.211:18888/api/health` 均返回 HTTP 200，登录页返回 HTTP 200；发现登录页预填默认密码，验证后立即停止公网进程并移除页面预填凭证。
- 常驻：项目负责人随后确认开发阶段保持常开；新增并安装 `chenyida-erp.service`，systemd `enabled/active`，开机自启且异常自动重启。

### PHASE3-MATERIAL-LIBRARY-SERVER-RUNTIME - `chore: switch local server delivery runtime`

- 运行面：根据项目负责人新要求，后续默认交付目标改为服务器本地 `chenyida_erp_app`，不再默认把新功能整合到 `chenyida_erp_site`。
- 端口：`server.py`、前台/后台启动、停止脚本和上线健康检查默认统一为 `127.0.0.1:18888`；测试脚本继续使用隔离端口，不与默认服务冲突。
- 安全：未绑定 `0.0.0.0`，未修改防火墙、反向代理、TLS、公网入口或生产数据库；本次没有启动服务器。
- 验证：`server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过；Site 中已完成的 `.xls` 代码未自动回写本地应用，服务器端 `.xlsx/.xls` 迁移另立任务。

### PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT - `feat: support legacy xls imports`

- 文件格式：网页预检和上传安全检查新增 `.xls`；旧式 OLE/BIFF 工作簿进入独立解析路径，现有 `.xlsx` 继续使用 OOXML 解析器，`.csv` 行为不变。
- 解析：新增有界 OLE Compound File/BIFF 读取器，支持可见/隐藏 Sheet、共享字符串、文本、数字、RK、布尔/错误、公式缓存、合并单元格和原始行哈希；加密/损坏/超限文件 fail-closed。
- 链路：继续复用现有 Import Batch、File、Raw Rows、Mapping、Normalization、Review、Event/Audit 和 Draft 门禁；不新增第二套导入系统或数据库表。
- UI/Inspect：文件选择器与本地 inspect 同时接受 `.xlsx/.xls/.csv`，`.xls` 保留 `XLS_LEGACY_BINARY` 安全证据；批次原有 `XLSX` 来源分类不变以保持迁移兼容。
- 生产：仅修改本地代码，未连接生产 D1/R2/Queue，未上传、迁移、创建 Draft 或部署。

### PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01 - `fix: adapt imports to real supplier BOMs`

- Git Commit：`cea940a`。
- 样本：只读检查用户提供的 A118/V700 两份附件；两者均为 XLSX 内容但使用 `.csv` 后缀。只记录文件哈希、大小、Sheet、表头、列名、行数估计和安全原因，未提交附件或业务行。
- V700：修正前误选“变更记录”；修正后以 `HIGH_CONFIDENCE` 选择 `BOM` 第 1～2 行组合表头，正确识别规格、型号和数量。标准名称、单位仍未确认，故不进入 Mapping Confirm/Normalization/Draft。
- A118：识别 `SHEET1` 第 44 行表头，正确映射名称、规格、厂商料号和用量；第 197～203 行周期性扩展到 XFD，继续以 256 列安全上限阻断，不静默截断。只读前 9 列估计不视为成功导入。
- 兼容：只允许 `.csv` 后缀但强签名为 XLSX 的单向兼容，完整 OOXML 安全检查不变，并把原后缀、检测类型和 warning code 写入既有安全事件。
- 识别：Inspect 复用自适应前 50 行摘要；增加 BOM 正向、变更/历史负向 Sheet 证据，限定“厂商物料编码”为制造商料号，增加“用量”数量别名和嵌入式 BOM 标题分类。
- 安全错误：XLSX 超宽 Promise 立即挂接拒绝处理，CLI 返回稳定中文错误，不再产生未处理拒绝堆栈。
- 验证：自适应 11/11、Parser 37/37、Inspector 4/4、Batch API 12/12；Vinext build + 全量 Node 593/593、lint 0 error/1 个既有 warning、隔离 API smoke、凭证扫描及 Python self-test/smoke/go-live 通过。
- 生产：未连接生产 D1/R2/Queue，未上传真实附件、执行 dry-run、创建 Draft、迁移、Sites 保存或部署。

### PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT - `feat: adapt supplier material imports`

- Git Commit：`41e293f`。
- 审计：复用既有 Batch、Parser、Raw Rows、Mapping、Normalization、Review、Validation、Event/Audit 和 Draft；确认旧实现默认首个可见 Sheet、前 10 行单表头、单来源映射和只跳过精确表头行，是多供应商兼容失败的主要原因。
- 结构识别：对全部可见 Sheet 的前 50 行评分，支持 1～3 行和合并父级表头、稳定父子列路径、数据起始行，以及说明/空行/重复表头/小计/合计/页脚的可解释分类。
- Mapping/规格：集中版本化别名，结合样本类型、唯一率、长度、尺寸/型号/单位特征和受控 Supplier Profile；支持 `EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT`、多来源列与确定性规格组合。名称/描述只给候选，不调用 AI；空规格产生 ERROR 并阻断 Draft。
- Canonical Row：在现有 Normalization 保存文件、Sheet、行、Supplier/Profile、raw/mapped 投影、置信度和 Review 状态；完整原始值继续只存在不可变 Raw Row。非数据行保留 lineage 并标记 `SKIPPED/REJECTED`。
- 数据库/UI：新增 `0008`、Supplier Profile 及 Mapping/Normalization 扩展，旧 `0005` 兼容；工作区展示结构范围、置信度、多来源 Mapping 和规格确认提示。Down 是受保护的兼容回退，完整结构恢复依赖迁移前快照。
- 样本：仅检查 `/opt/erp` 内受控目录，未发现真实供应商样本；治理模板未冒充真实验证，未输出完整业务数据、价格或联系方式。
- 验证：全量 Node 589/589，自适应 9/9、Migration 3/3、运行时闭环 2/2，build、lint 0 error/1 个既有 warning、隔离 API smoke、1k/10k/100k 查询计划、最终文档范围 328 文件凭证扫描、Python self-test/smoke/go-live 和 `git diff --check` 通过。
- 生产：未连接生产 D1/R2/Queue，未执行生产迁移、真实上传、Draft 创建、Sites 保存或部署。

### PHASE3-MATERIAL-LIBRARY-02 NO_REAL_DATA_MODE - `feat: harden material import governance`

- Git Commit：`b3d26c3`。
- 文件检查：只扫描 `/opt/erp`、`/home`；发现 20 个路径，按 SHA 去重为 1 个 10-Sheet XLSX 和 9 个 CSV，均为已跟踪治理模板/样例及其 Site 镜像；`/home` 无候选，未发现、上传或导入真实企业物料文件。
- Inspect：扩展 `material-library:import inspect --file`，复用既有有界 XLSX/CSV Parser，只读输出类型、大小、SHA-256、Sheet/CSV 行列、编码、分隔符、表头候选和可能标准字段；不输出业务数据行、不修改源文件。
- 治理：dry-run 显式返回分类、单位和品牌的 `EXACT/MATCHED/NEEDS_REVIEW` 及冲突/候选原因；不自动创建分类、单位或品牌。CLI 分页读取后只输出分类/单位/品牌、错误/警告/待审和重复等级安全汇总，不逐行打印物料正文。
- 重复：EXACT 候选直接阻断 Draft；HIGH_CONFIDENCE 候选保持人工确认门禁并阻断；POSSIBLE 只提示。所有等级继续禁止自动合并、删除或覆盖。
- 测试：新增本地 CSV/XLSX inspect 与类型错配测试，扩展分类名称、单位别名、品牌别名、EXACT/HIGH_CONFIDENCE、Draft/权限/幂等回归；专项 9/9、全量 Node 575/575、build、lint 0 error/1 个既有 warning、隔离 API smoke、319 文件凭证扫描和本地临时 SQLite 基线通过。
- 数据库/结果：未修改 Schema、Migration、Drizzle 或生产配置；真实 dry-run 未执行，Material DRAFT 数量为 0。任务保持 `BLOCKED / NO_REAL_DATA_MODE`，等待真实文件和隔离上传目录。
- 生产：未连接生产 D1/R2/Queue，未迁移、部署或创建生产资源。

### PHASE3-MATERIAL-LIBRARY-01 - `feat: add material master database schema`

- Git Commit：`2ff8d9c`。
- 审计：确认在线目标为 Cloudflare D1/SQLite 语义、Drizzle ORM/SQL Migration；既有 `material_master`、分类、动态属性、别名、供应商映射、Import Batch/File/Row/Event、Normalization 和 Draft/Review 服务可直接复用，因此未创建第二套物料主表或重写 Import。
- 数据库：新增 `0007`、受保护 Down、snapshot/journal；增加 units/unit aliases、brands/brand aliases、Normalization approvals、Import Draft links、duplicate candidates，并为 Material 增加品牌、单位和批次/文件/行来源外键；全部为增量表/可空列/约束/索引，无删除或破坏性重建。
- 业务/API：新增 inspect/dry-run/report、Normalization Approval 和 Draft commit；admin/manager 独立 `material.import.commit`，CSRF、版本/摘要、ERROR/WARNING 门禁、请求/行幂等、Validation、EXACT/HIGH_CONFIDENCE/POSSIBLE 候选和原子来源关联；创建结果只能是无正式编码的 `DRAFT`，后续继续复用人工提交/审核。
- 命令：新增只允许回环 URL 和 test/local/development commit 的 `material-library:import`，复用 API 提供 inspect/dry-run/commit/report，不直接连接 D1。
- 文件检查：只扫描 `/opt/erp`、`/home`；仅发现两套内容相同的治理模板/样例（XLSX 10 表和 9 个 CSV），未发现真实首批物料文件，未上传或执行真实 dry-run。
- 验证：迁移 3/3、闭环/权限/CSRF/幂等 3/3、既有 Material 生命周期 14/14、全量 Node 569/569、Vinext build、Drizzle 44 表无漂移、隔离 API smoke、314 文件凭证扫描、远程 URL 拒绝和临时 SQLite 基线通过；lint 0 error/1 个任务外既有 warning。
- 生产：未连接生产 D1/R2/Queue，未执行生产迁移、真实数据导入、Sites 保存或部署。
- 文档：新增 Material Library 落地说明和审计报告，记录模型复用、文件清单、风险、测试及下一步。

## 2026-07-17

### PHASE3-TASK04 实现 - `feat: add import normalization review ui`

- 前端：在 `/materials/imports/:batchId` 统一工作区增加七步 Stepper、`normalize/normalized/issues`、Current/Latest 双轨、启动/重试/版本重跑/取消、冻结幂等与 `RESULT_UNKNOWN`、2/5/10 复合轮询和真实行进度。
- 审阅：增加 Current Run 汇总、50/100 Rows 与 Issues opaque cursor、批次作用域 Row Drawer、Basic/200 动态属性/分类提示/供应商引用/Deferred Validation/Lineage、有界类型化值和五键 `safe_details`。
- 安全与可访问性：Capability 独立判断、401/403/404 清理、Batch/Run/Row/Lineage 归属核验、纯文本与安全 ID、Drawer 背景隔离/焦点约束/三级恢复、700px 全宽和状态文字语义。
- 测试：104/104 计划 ID、100/100 既有 Import UI 回归；本地 Playwright 50 Rows 801 ms、Drawer 398 ms、100 Issues、200 Attributes、1366/700px、无 N+1/Storage/History 正文及 0 console warning/error。
- 数据库/API/生产：未修改 Schema、Migration、后端 API、Normalization 业务逻辑、依赖或 hosting；未连接、迁移或部署生产资源。完整 Row Issues 局部门禁与七项非阻塞限制继续保留。

### PHASE3-TASK03 规格确认 - `docs: approve import normalization review ui`

- 项目负责人在正式设计提交 `c694045` 后明确回复“规格确认”；主规格中的 14 项 UI 决定从 `PROPOSED` 转为 `APPROVED`，并新增 D-023 决策记录。
- 确认范围仅为统一工作区、七步 Stepper、Current/Latest 双轨、启动/重跑/取消、Rows/Issues、Row Drawer、可访问性与性能门禁等书面规格；不自动创建或授权实施任务。
- Row Drawer 完整 Issue 查询局部门禁、`PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 和 7 项非阻塞限制继续有效，不因规格确认而视为已解决。
- 本次仍为 docs-only；未修改前端、API、Schema、Migration、业务逻辑、依赖或生产环境。

### PHASE3-TASK03 设计 - `docs: design import normalization review ui`

- 新增功能：无；本任务只形成 Material Import Normalization Review UI V1 正式规格、37 状态低保真线框、状态矩阵和 104 项未来实施测试计划。
- UI 契约：推荐继续 `/materials/imports/:batchId` 统一工作区、七步 Stepper、`normalize/normalized/issues` View、`batch/current_run/latest_attempt` 三层状态、固定 Processor Version、页面内存幂等、`RESULT_UNKNOWN`、2/5/10 轮询、真实行进度和协作式取消。
- 结果审阅：Rows 与 Issues 使用独立 URL 参数和 opaque cursor；Row Detail 使用批次作用域 Drawer，展示 Basic、动态属性、非正式分类提示、供应商引用、Deferred Validation 与 Lineage；结果全部只读，不实施分类、匹配、Draft 或正式导入。
- 门禁：记录 Row Drawer 完整 Issue 查询局部门禁、`PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 和完整历史、Batch Pointer、部分筛选、列表候选摘要、选中 Issue 刷新恢复等 7 项非阻塞限制；14 项决定全部保持 `PROPOSED`，等待提交后的“规格确认”。
- 验证：复用上一提交的可信运行时基线，只执行文档结构/链接、104 项编号与分组、37 线框、状态矩阵、14 项决定、门禁/限制、`git diff --check`、docs-only 范围和用户未跟踪文件保护检查；未重复运行无关 Node/build/API/Drizzle/Migration/SQLite/Playwright/全仓凭证扫描。
- 范围：未修改前端、API、Schema、Migration、Normalization/Mapping 业务逻辑、依赖、hosting 或 Legacy SQLite；未连接、迁移或部署生产 D1/R2/Queue；未创建 Draft 或正式物料。

### PHASE3-TASK02 实现 - `feat: add material import normalization`

- 决策与边界：批准 D-022 和正式规格的 16 项推荐决定；Normalization 只生成可追溯候选与 Deferred Validation，不调用 Draft/正式物料写服务，不执行分类、匹配或去重。
- 数据库：新增 `0006_material_import_normalization.sql`、三张关系表、批次 current pointer 与状态、events/outbox 扩展、约束/索引/绑定 trigger、Drizzle snapshot/journal，以及只在无 Normalization 业务状态时允许的受保护 Down。
- 运行与恢复：实现独立 normalization run、Mapping/Metadata 快照绑定、行级 JSON/Issue 暂存、Outbox、租约/心跳、幂等分块、资源上限、完整性摘要和单 D1 batch 原子发布；失败/取消清理未发布行，重跑在成功发布前保留旧 pointer。
- API/安全：实现异步启动、汇总、行列表、行详情和 Issue 列表五个 API；新增 `material.import.normalize`，保持 owner/read_any 可见性先于能力判断，支持 CSRF、强幂等、版本 CAS、读写限流、opaque cursor、稳定错误和安全审计。
- 测试：正式矩阵 54/54，Normalization/Migration 专项 18/18；覆盖 Up/受保护 Down/重升/失败回滚、约束/trigger、稳定发布、ERROR 行共存、幂等/块重放、分页、不同 processor 重跑、取消清理、Mapping/Metadata/parse 冻结、50,001 行与 payload 资源边界、发布竞争、五 API、权限/404、CSRF、429 和安全 500；全量 Node 458/458、build、隔离 API smoke、OpenAPI、Drizzle 无漂移、凭证扫描和临时 SQLite 基线通过，lint 0 error/1 个任务外既有 warning。
- 范围：未修改 hosting 或生产 binding，未连接、迁移或部署生产 D1/R2/Queue，未创建 Material Draft 或正式物料；根目录既有未跟踪 `.obsidian/` 保持不变。

### PHASE3-TASK01 设计 - `docs: design material import normalization`

- 新增功能：无；本任务只完成 Material Import Normalization & Staging V1 书面规格、未来数据模型和 API 契约。
- 架构与状态：推荐独立 normalization run、复用 Outbox/租约/CAS/原子发布，批次增加排队/运行/发布状态；执行失败与行级 ERROR 分离，不新增批次 `NORMALIZATION_FAILED`。
- 数据契约：推荐每行版本化 JSON 快照、独立 issue 表和 current pointer；冻结完整 lineage、空值/默认值、基础字段、动态属性、类型、公式禁用、Deferred Validation 和行状态语义。
- API/安全：设计异步启动、汇总、行列表/详情和 issue 五个路由；新增独立 `material.import.normalize` 能力，保持 owner/read_any 行级可见性、404/403、CSRF、强幂等、限流、稳定错误和纯文本安全边界。
- Migration/测试：只设计未来 `0006` 三表、batches/events/outbox 重建、索引、受保护 Down/重升和 54 项最低测试；16 项选择全部为 `PROPOSED`。
- 验证：OpenAPI 3.1 的 5 个操作/98 个本地引用、16 项决定逐项 11 字段、54 项测试/docs-only 检查通过；lint 0 error/1 个既有 warning；build 与 Node 440/440、隔离 API smoke、Drizzle 34 表无漂移、296 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 均通过并清理。
- 范围：未修改运行时代码、Schema、Migration、API、前端、依赖、R2/Queue/hosting 或本地旧版；未连接、迁移或部署生产环境。实际提交哈希以 `git log -1` 为准。

### PHASE2-TASK08 实现 - `feat: add material import workspace ui`

- 路由与工作区：新增 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`，实现权限驱动入口、opaque cursor 列表、状态 Stepper、非法 URL 规范化、错误/终态处置和服务端状态权威恢复。
- 文件与写安全：新增 10 MiB 单文件预检、`@noble/hashes@2.2.0`（MIT）增量 SHA Worker、确认后创建、受控单文件 multipart XHR、真实网络进度、独立幂等操作记录、重复文件新批次恢复及 RESULT_UNKNOWN 原 Key/原载荷恢复边界。
- 解析与 Mapping：实现 2/5/10 秒轮询、5/10/30 秒网络退避、Retry-After、可见性暂停、协作式取消、Sheets/Rows/Header、完整 256 列横滚、动态 Catalog、Mapping 保存/preview/confirm 新鲜度和 confirmed 只读；不创建 Draft 或正式物料。
- 测试与门禁：UI-001—UI-100 全部通过；Playwright Chromium 1366×768 的 50×256 + 256 Mapping 门禁通过，初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、30,285 DOM、123,423,127 bytes JS heap，sticky/键盘/语义/700 窄屏及控制台 0 error/0 warning通过。
- 全量验证：build 与 Node 440/440、lint 0 error/1 个任务外既有 warning、隔离 API smoke、5 份 OpenAPI 3.1/434 本地引用与 Batch 6 操作、Drizzle 34 表无漂移、289 文件凭证扫描和临时 SQLite self-test/smoke/go-live 通过；首次并行全量触发历史迁移用例 120 秒超时，串行复跑 440/440。
- 范围：仅修改 Site 前端、共享浏览器 Client、依赖锁、专项测试和治理文档；未修改后端 route/service、Schema、Migration、Metadata、hosting、本地旧版业务逻辑或生产环境，未部署。

## 2026-07-16

### PHASE2-TASK07 实现 - `feat: add import mapping target catalog`

- API：实现批次作用域 `GET /api/material-master/import-batches/:batchId/mapping-targets`，支持 BASIC/ATTRIBUTE/SPECIAL、`namespace/q/limit/cursor`、稳定排序、规范化搜索、摘要保护的不透明 cursor、Metadata/展示变化 409 和 `private, no-store`。
- 共享规则：新增 `MaterialImportMappingTargetRegistry`、运行时 D1 ACTIVE Metadata Repository 与 `MaterialImportMappingMetadataSnapshotService`；`material-import-mapping-metadata-v1` 规范 JSON SHA-256 覆盖 namespace/code、enabled/selectable、type、required、modes、default、unit、value constraints 等业务语义，展示文案只进入 cursor 搜索投影摘要。
- Mapping 统一：Parser Mapping 准备、PUT 保存、preview、confirm 和 Catalog 全部调用同一 Snapshot；保留现有请求、状态机、必填、唯一性、category_hint、supplier_reference、ignore 和历史失效 target 语义。
- 权限与安全：要求认证、read + map、owner/read_any 行级可见性；隐藏批次 404、可见但无 map 403。GET 无 CSRF/幂等要求，执行独立读取限流、request_id、安全错误和不记录 q/cursor/metadata 正文的 API 审计；不返回 attribute_id、表/列/SQL 或 Repository 内部信息。
- 测试：Catalog 专项 51/51；build 与全量 Node 339/339；lint 0 error/1 个既有 warning；隔离 API smoke、OpenAPI 解析/契约检查、Drizzle 无漂移、凭证扫描和临时 SQLite 环境守卫/self-test/smoke/backup-restore/go-live 通过。
- 门禁与范围：`BLOCKED_BY_MAPPING_TARGET_CATALOG` 已标记 `RESOLVED`；Import Workspace UI 尚未实施，仍受 50×256 性能与可访问性门禁。本任务未修改 Schema、Migration、Metadata 数据、前端、R2/Queue/hosting，未连接、迁移或部署生产环境。

### PHASE2-TASK06 设计 - `docs: design import mapping target catalog`

- Git Commit：Material Import Mapping Target Catalog V1 正式规格、OpenAPI 和治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `d1c6763`。
- 路由与权限：比较批次作用域、全局作用域和混入现有 Mapping 三种方案，推荐 `GET /api/material-master/import-batches/:batchId/mapping-targets`；要求 `material.import.read` + `material.import.map`、owner/`read_any` 行级可见性和隐藏 404，`read_any` 不自动等于 map。
- 数据来源：基础和特殊目标来自后续共享 Target Registry；动态属性只读运行时 D1 ACTIVE metadata，不读 seed、fixture 或历史 Mapping，不暴露 attribute id、表名、列名或 SQL。
- digest 审计：确认当前实现只摘要基础/供应商 code 与属性 code/type/status，且 Parser 准备与 Mapping Service 各自投影；规格要求实施前抽取共享 Registry + `MappingMetadataSnapshotV1`，由 Catalog、准备、保存、preview 和 confirm 共同使用，禁止第二套 digest。
- 契约：定义 BASIC/ATTRIBUTE/SPECIAL 三组、保留现有小写 namespace 与大写 target code、完整 target DTO、统一有界搜索/cursor、Metadata/展示双摘要、`private, no-store`、历史失效目标和稳定安全错误。
- 测试与决定：记录 43 项未来实施测试和 12 项 `PROPOSED` 决定；Catalog 不可用时整体阻断 TargetSelector，不允许降级到基础字段或前端硬编码。
- 验证与范围：5 份 OpenAPI YAML/本地引用、规格 43 项编号/12 项决定、lint 0 error/1 个既有 warning、build 与全量 Node 288/288、隔离 API smoke、Drizzle 34 表无漂移、272 文件凭证扫描和临时 SQLite 完整基线通过；最终 `git diff --check` 与 docs-only 范围在提交前复核。未修改运行时代码、Mapping 语义、Schema、Migration、Metadata、前端、R2/Queue/hosting 或生产环境。

### PHASE2-MAINT-01 修复 - `fix: ignore comment-only rollback statements`

- Git Commit：共享 breakpoint-aware Migration statement 过滤、隔离回归测试和治理文档在独立维护提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `f965ddb`。
- 根因：Migration 测试 helper 按既有 breakpoint 分割后仅执行 `trim().filter(Boolean)`；0005 protected Down 尾部 `-- End of protected 0005 rollback.` 非空，因此被作为没有可执行 SQL 的 D1 statement 提交。
- 修复：在共享测试/开发辅助层识别空白、`--`、`/* ... */`、单/双引号和成对引号转义，只过滤没有可执行内容的片段；提交 D1 的仍是未修改原片段。未闭合字符串或块注释 fail-closed 保留给 D1 报错；不支持 SQLite 本身不支持的嵌套块注释。
- 复用：0003、0004、0005 Down 测试和仓库内确认使用相同 breakpoint 语义的 Migration 夹具统一调用共享辅助器；未按分号切分，也未针对 0005 特判。
- 回归：新增 10 个隔离 D1 用例覆盖尾部行注释、块注释、空白、SQL 前后注释、字符串内注释标记/分号、混合注释和异常片段 fail-closed；0003、0004、0005 Down 专项均通过。
- 验证：Migration 专项 20/20；build 与全量 Node 288/288；lint 0 error/1 个既有 warning；隔离 API smoke、4 份 OpenAPI、Drizzle 34 表无漂移、凭证扫描、临时 SQLite 完整基线和范围检查通过。
- 边界：0003/0004/0005 Up/Down、Schema、Drizzle snapshot/journal、API 和生产配置均未修改；0005 尾部保护说明保留，Migration 业务语义不变；未连接、迁移或部署生产环境。

### PHASE2-TASK05 设计 - `docs: design material import workspace ui`

- Git Commit：Material Import Workspace UI V1 的三份正式设计文档与项目治理更新在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `73435a3`。
- 路由与状态：定义 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`，采用服务端状态驱动的单工作区 Stepper；`view` 仅为展示意图，非法参数 replaceState 规范化；列表使用不透明单向 cursor 的单批结果导航。
- 文件与上传：确定先预检/SHA/确认再创建批次；推荐专用 Worker 的真实增量 SHA-256；共享 API Client 内受控 multipart XHR transport；精确区分网络上传进度、服务端存储/安全检查、取消和 RESULT_UNKNOWN；重复 REJECT 后按新批次 ALLOW_DUPLICATE 流程恢复。
- 解析与查看：定义 parse 前重读、独立幂等、2/5/10 秒受控轮询、网络与 Retry-After 退避、协作式取消和粗粒度真实状态；Sheet/Rows 使用真实分页并保留稀疏 cell、日期、公式、错误、列宽与尾随空列语义。
- Mapping：采用三列编辑器、显式保存、已保存版本预览和当前页面最新 preview 门禁；confirmed 只读且不虚构确认人/时间、不显示正式导入；100 项未来实施测试逐条记录。
- 门禁：记录 `BLOCKED_BY_MAPPING_TARGET_CATALOG`，禁止从 seed、测试数据或前端硬编码绕过动态目标；记录 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`，50×256 未验收前不开放完整实施或 page_size=100。
- 决策：16 项均保持 `Status: PROPOSED`，只有完整文档审阅后收到“规格确认”才能转为 `APPROVED`。
- 验证：lint 0 error/1 个既有 warning、环境守卫 6/6、隔离 API smoke、4 份 OpenAPI 解析、268 文件凭证扫描、100 项测试编号/16 项决定/22 状态线框结构检查和临时 SQLite 基线通过。`npm test` 构建成功但基线未全绿：并发运行 275/278 通过，两个超时迁移串行复跑通过；`0005 protected Down` 单独复跑仍因 rollback SQL 尾部纯注释被测试 helper 当作 D1 statement 而失败。本任务按 docs-only 边界不修改既有迁移或测试运行时代码。
- 范围与生产：仅新增/更新文档；未修改前端运行时代码、API、Schema、Migration、R2/Queue、hosting 或生产配置，未连接、迁移或部署生产环境。

### PHASE2-TASK04 实施 - `feat: add material import parser and mapping`

- Git Commit：Parser 与字段 Mapping V1 非生产实现、测试和治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `a16b2f3`。
- 数据库：新增不可修改的 `0005_material_import_parser_mapping.sql`、Drizzle schema/快照/journal 和数据保护 Down；扩展批次状态与 current run，新增 parse run、Sheet、Shared Strings 分块、Outbox、header suggestion、Mapping 主从表，并按 legacy run 保留既有原始行。
- Parser：固定 `@zip.js/zip.js@2.8.26`、`sax-wasm@3.1.4`、`csv-parse@7.0.1`；实现 Web Streams 有界 XLSX/CSV、UTF-8/BOM/GB18030、三种分隔符、OOXML/XML 安全、日期/公式/隐藏 Sheet、组合资源限制和稳定 raw row hash。
- 调度与恢复：实现 D1 Outbox dispatcher、可注入 scheduler、Cloudflare Queue adapter、至少一次去重、run 租约/接管/心跳、Sheet 恢复、分阶段失败、原始行原子发布和 Mapping 准备独立重试；没有创建 Queue binding 或部署配置。
- Mapping/API：实现 Sheet/行读取、header candidates、关系化 Mapping 完整替换、静态与动态 target allowlist、100 行预览、metadata 摘要确认、乐观锁、事务幂等/审计及七个精确 API；明确不创建 Material Draft 或正式物料。
- 权限：新增 `material.import.parse` 与 `material.import.map` capability；admin/manager/purchase/engineering 获显式授权，`read_any` 不隐含 parse/map；继续执行 owner/read_any 最小披露、Origin/CSRF 和隐藏 404。
- 验证：专项 Parser 36、集成 11、migration 4、兼容 3，共 54/54；全量 Node 278/278、build、隔离 Parser TypeScript 夹具、隔离 API smoke、OpenAPI YAML、Drizzle 无漂移、265 文件凭证扫描及本地临时 SQLite 基线通过，lint 0 error/1 个任务外既有 warning。全仓 `tsc --noEmit` 的 10 个既有任务外错误未在本任务修复。
- 依赖审计：`npm audit --omit=dev` 仍报告 Next 内置 PostCSS 的 2 个 moderate，建议修复会触发破坏性版本变化；本任务不执行 force fix。新增 Parser 依赖的固定版本、许可证、构建和运行时兼容测试通过。
- 生产影响：无。未连接生产 D1/R2/Queue，未创建 bucket/binding/Cron，未执行生产 migration、修改 hosting 或部署；未实施前端、清洗、分类、匹配、AI、Material Draft 或正式物料写入。

### PHASE2-TASK03 设计 - `docs: design material import parser and mapping`

- Git Commit：Parser 与字段 Mapping V1 文档在独立提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `63e0483`。
- 规格：新增 Parser 主规格、OpenAPI 草案、Mapping 规格和 Mermaid 流程图，覆盖 `FILE_READY -> MAPPING_CONFIRMED`、`PARSED` 原子发布恢复点、用户可见性和失败分类。
- 调度与恢复：明确 D1/Queue 无分布式事务，推荐持久 Outbox；Queue 至少一次、`max_batch_size=1`、低并发和租约保持 `PROPOSED`。V1 以 Sheet 为真正恢复边界，500 行检查点只用于观测、预算、心跳和幂等写入。
- 数据模型：设计 `parse_runs`、Sheet/header、Outbox、Shared Strings、Mapping 主从表、`current_parse_run_id` 及 `material_import_rows` 唯一约束重建；只提出 `0005` Up/Down/回滚方案，未创建 migration 或修改 Drizzle。
- 解析与安全：方案 A `zip.js + sax-wasm + 受限 OOXML`、CSV `csv-parse` 均为待兼容验证候选；定义 XML/OOXML、公式、外链、隐藏 Sheet、编码、稀疏 cell、行宽、日期解释、Shared Strings 和组合资源预算。
- Mapping/API：定义 Sheet/header suggestion、稳定 target catalog、`category_hint`、一源一目标、受限默认值、预览、确认、旧 Mapping 失效、七个 API、权限、CSRF、幂等、CAS 和稳定错误。
- 决策：集中记录 16 项 `Status: PROPOSED` 决策；设计方向确认不等于正式规格确认、实施批准或生产批准。
- 验证：文档完成后运行 Site lint、全量 Node、隔离 API smoke、凭证扫描、临时 SQLite 基线、OpenAPI YAML 解析、`git diff --check` 和范围核对；实际结果记录在 `STATUS.md`。
- 生产影响：无。未实施 Parser、Schema、`0005`、Queue、R2/Cron、API、前端、生产迁移或部署，未连接生产 D1/R2。

## 2026-07-15

### PHASE2-TASK02 实施 - `feat: add material import batch foundation`

- Git Commit：Material Import Batch Foundation V1 的非生产实现、测试和治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `050d134`。
- 数据库：新增 `0004_material_import_batch_foundation.sql`、Drizzle schema/快照及带数据保护的 Down 文件；创建批次、文件、冻结原始行契约、不可变事件和专用幂等五表，包含 V1 状态、外键、唯一性、终态与完整性约束。
- 对象存储：新增可注入接口、R2 适配器和内存测试替身；确定性环境前缀 key 使用条件写入且不覆盖，支持 HEAD、范围读取和受控删除；没有创建生产 bucket、binding 或密钥。
- 上传与安全：实现恰好一个 `file` part 的有界流式 multipart、10 MiB 实际计数、增量 SHA-256、声明哈希核对与文件类型探测；XLSX 检查 OOXML/ZIP 结构、加密/宏/条目/展开/压缩比/路径边界，CSV 检查 UTF-8/GB18030、NUL、二进制和完整 HTML 伪装，不解析工作表或业务行。
- API、权限与 Saga：实现创建、列表、详情、上传、事件、取消六个精确路由；复用 Session/Origin/CSRF，以 capability + owner/`read_any` 执行行级可见性和隐藏 404，并实现专用幂等、限流、乐观并发、重复 SHA 策略、D1/R2 故障协调、取消竞争及手工清理服务。
- 验证：新增迁移 3/3、导入 API/Saga/安全 12/12；全量 Node 224/224、build、隔离 API smoke 和 247 文件凭证扫描通过，lint 0 error/1 个任务外既有 warning。
- 本地基线：项目 Python 3.12 在临时 SQLite 中运行 `server.py --self-test`、`smoke_test.py` 和 `go_live_check.py --no-backup` 全部通过，临时数据已清理。
- 文档：12 项决定转为 `APPROVED`；同步正式规格、OpenAPI、数据流/状态图、MASTER、TASKS、ROADMAP、DECISIONS、STATUS 和 CHANGELOG；Excel/CSV 行解析顺延为 `PHASE2-TASK03`。
- 数据库与生产：未连接生产 URL/D1/R2，未执行生产迁移，未创建生产 R2 资源、生命周期或 Cron，未部署；没有解析 Excel/CSV 行、写入 `material_import_rows` 或创建 Material Draft。

### PHASE2-TASK01 设计评审 - `docs: design material import batch foundation`

- Git Commit：正式规格、OpenAPI 草案、数据流图和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `353c6d9`。
- 新增功能：无；本任务只完成 Material Import Batch Foundation V1 书面设计，12 项决定全部保持 `PROPOSED`。
- 存储架构：推荐私有 Cloudflare R2 保存原始文件、D1 保存批次/文件元数据/原始行契约/幂等/不可变事件；记录当前 `.openai/hosting.json` 的 `r2` 为 `null` 且仓库没有可用 binding，不把待新增基础设施表述为现有能力。
- 上传与恢复：定义创建批次后单文件 multipart Worker 代理上传；以确定性、不可覆盖 object key 和实际 SHA/字节数构成可恢复 Saga，不宣称跨 D1/R2 分布式事务或 exactly-once。
- 状态与安全：分离文件 `storage_status` 与 `security_check_status`；只有 STORED、基础检查通过、实际摘要/大小和有效检测类型同时满足才进入 `FILE_READY`；增加批次级 `RECONCILIATION_REQUIRED`、取消竞态和清理事件。
- 数据契约：定义批次、文件、0-based 工作表原始行、不可变事件和专用导入幂等技术表；冻结 `EMPTY/TEXT/NUMBER/BOOLEAN/DATE/FORMULA/ERROR` 类型化单元格契约，CSV 固定 `sheet_index=0`、`sheet_name=__CSV__`。
- API、安全与并发：OpenAPI 草案包含创建/列表/详情/上传/事件/取消 6 个操作；服务端 capability 与 owner/`read_any` 行级可见性、CSRF、限流、CAS、规范化 multipart 摘要、重复 SHA 显式动作和安全错误码均有定义，不提供下载或对象地址。
- 保留与 Migration：建议以 `terminal_at` 计算原始数据和批次记录保留期，采用两阶段可恢复清理；只描述未来 `0004` 的五表、V1 CHECK、候选索引查询依据和扩展式迁移，不创建任何迁移文件。
- 平台依据：Worker 内存/请求体、D1 行/BLOB、R2 私有访问、上传与价格事实均引用 2026-07-15 当前 Cloudflare 官方文档；10 MiB 业务上限仍为保守建议，仓库没有历史样本容量证据。
- 验证：OpenAPI YAML 与 93 个本地引用解析通过，6 个操作；12 项决定结构检查通过。build 通过；全量 Node 串行 209/209、隔离 API smoke、环境守卫 6/6、凭证扫描 236 个文件、lint 0 error/1 个既有 warning通过。首次并行全量中一个迁移用例因 120 秒资源竞争取消，单独 1/1 与串行全量均通过。
- 本地基线：项目 Python 3.12 临时 SQLite 环境守卫 4/4、`server.py --self-test`、`smoke_test.py`、备份恢复和 `go_live_check.py --no-backup` 全部通过；临时数据已清理。
- 数据库与生产：未修改运行时代码、Schema、Migration、索引、对象存储、Binding、API、前端或部署配置；未连接生产 URL/D1/R2，未创建 bucket、密钥、生产版本或部署。
- 停止条件：提交后停止，等待项目负责人逐项选择并统一回复“规格确认”；此前任何推荐方案都不得转为 `APPROVED` 或进入实施。

### PHASE1-TASK14 实施 - `feat: add material review ui`

- Git Commit：前端实现、UI 测试、规格和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `c6ddf3b`。
- 页面与入口：新增 `/materials/review` 与 `/materials/:materialId/review`；`MaterialShell` 只按 `material.review.queue` 显示审核队列入口，不按角色名推断权限。
- 审核队列：实现 URL 权威筛选、300ms 关键词、叶子分类、来源、创建人、提交日期、四种 allowlist 排序及 20/50/100 服务端分页；展示 `submitted_by` 但不伪造服务端不支持的筛选，服务端 `total` 为唯一权威。
- 工作台与复用：按方案 A 实现左侧完整只读详情、右侧约 310px sticky Validation/职责分离/审核操作；提取共享只读详情组件供既有详情与审核工作台复用，既有只读 UI 37/37 回归通过。
- 批准与驳回：最终动作前重读统一详情；ERROR 禁止批准但不自动驳回，WARNING 在单一最终对话框列出并明确确认；批准复读 ACTIVE/正式编码，驳回复读 DRAFT/`last_rejection` 后返回原队列状态。
- 权限与职责：queue/approve/reject 独立能力驱动；创建人或最后修改人禁审，提交人本身不禁审；前端提示与关闭动作，既有服务端权限、职责、状态和 Validation 校验保持最终权威。
- 幂等与并发：approve/reject 使用独立的页面内存 Key、不可变 endpoint/payload 快照和共享 Client 受保护写；覆盖重复点击、`RESULT_UNKNOWN` 原请求安全重试、`IDEMPOTENCY_IN_PROGRESS`、冲突、状态变化、422、429、401/403/404/5xx 和 request_id。
- 安全与可访问性：实现安全 `return_to`、dirty/beforeunload、离开确认、纯文本渲染、焦点定位、对话框初始焦点/Tab 循环/Escape/焦点恢复及 live region；不写 localStorage/sessionStorage，不引入第二套认证或 HTTP Client。
- 测试：新增 Review UI 51/51；全量 Node 209/209；build 通过；lint 0 error/1 个任务外既有 warning；一次性隔离 D1 API smoke 与 233 文件凭证扫描通过。
- 浏览器验收：本地 Vinext + Playwright 在 1366×768 完成队列、310px sticky 审核栏、WARNING 确认和批准后返回原队列的完整往返；验收网络夹具及截图未提交。
- 本地基线：临时 SQLite `server.py --self-test`、`smoke_test.py`、备份恢复、环境保护 4/4 和 `go_live_check.py --no-backup` 全部通过；临时数据已清理。
- 数据库与生产：未修改 API、Schema、Migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 URL/D1，未迁移真实数据、创建生产版本或部署。
- 已知限制：队列 API 仍不支持 `submitted_by` 筛选；远程 Test D1、候选索引、`PENDING_APPROVAL` 收缩及生产迁移/部署均需独立任务与授权。

### PHASE1-TASK13 设计评审 - `docs: design material review ui`

- Git Commit：正式规格、低保真线框和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `9278bea`。
- 新增功能：无；本任务只完成 Material Review Queue 与审核工作台 V1 书面设计，不修改任何运行时代码。
- 路由与布局：定义 `/materials/review` 和 `/materials/:materialId/review`；推荐方案 A，即左侧完整只读详情、右侧 sticky Validation/职责分离/审核操作，方案 B 仅作比较。
- 队列与返回：筛选、排序和分页由 URL 管理；批准或驳回成功后安全返回原队列状态，当前页清空时回到最后有效页；展示 `submitted_by`，但不提供服务端尚不支持的提交人筛选。
- 权限与职责：按 `user.permissions` 展示入口和动作，不硬编码角色；`created_by` 或 `last_modified_by` 命中当前用户时先提示并关闭审核动作，服务端 `403 SELF_REVIEW_FORBIDDEN` / `LAST_EDITOR_REVIEW_FORBIDDEN` 继续作为最终判断。
- 批准与驳回：批准前重新 GET 最新详情并使用单一最终确认；WARNING 确认绑定物料、版本和规范化 Validation 摘要，但摘要仅是前端新鲜度标记。驳回要求 1–1000 字原因；approve/reject 使用相互独立的页面内存幂等状态。
- 错误与可访问性：结构化 `error.code` 优先；覆盖 VERSION_CONFLICT、RESULT_UNKNOWN、401/403/404/422/429/500、文字状态、键盘对话框、焦点恢复、问题定位和纯文本渲染。
- 测试设计：保留并分组定义全部 51 项实施测试，附方案 A/B、主要状态、确认对话框和 1366×768 线框；写测试只能使用一次性本地隔离 D1，并拒绝 production、公共 URL 和远程 binding。
- 验证结果：lint 0 error/1 个既有 warning；构建与 Node 158/158、一次性本地 D1 API smoke、226 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查全部通过；临时数据已清理。
- 数据库与生产：未修改前端运行时代码、API、Schema、Migration、索引、业务服务或部署配置；未连接生产 URL/D1，未迁移真实数据或部署。

### PHASE1-TASK12 实施 - `feat: add material draft ui`

- Git Commit：前端实现、UI 测试、规格和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `7e6844d`。
- 页面与入口：新增 `/materials/new` 和 `/materials/:materialId/edit`；列表创建入口与 DRAFT 详情编辑入口仅依据 `/api/session -> user.permissions` 和 own/any 能力显示，不硬编码角色。
- 表单：实现布局 C、分类树和当前叶子 Schema、TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/compatible unit、严格数值、完整 attributes、0/false、未知旧属性显式删除和分类切换确认。
- 写链路：实现创建 POST、编辑 PATCH 完整替换、GET 回读、Validation ERROR/WARNING、WARNING 版本绑定确认和 submit；保存成功后同步、部分成功、结果未知和提交成功返回只读详情均有独立状态。
- 安全与并发：共享 Client 对受保护 Material 写请求强制显式 Idempotency-Key 与 CSRF；同一操作仅允许原 Key、原 method、原 endpoint、原 payload 重试；覆盖 VERSION_CONFLICT、Retry-After、重复点击、dirty/beforeunload、Schema 漂移和状态/权限变化。
- 驳回与错误：编辑页只读展示 `last_rejection`；401/403/404/409/422/429/5xx 使用安全中文提示和 request_id，不向浏览器暴露 SQL、堆栈或敏感正文。
- 验收：Draft UI 54/54、全量 Node 158/158；build、lint 0 error/1 个既有 warning、隔离 API smoke、224 文件凭证扫描和临时 SQLite 五项基线通过。
- 浏览器：一次性本地 D1 实机完成创建、编辑、PATCH/GET/submit 至 `PENDING_REVIEW`；1366/1280/1024/768 无横向溢出，三列按断点降级，离开保护和程序内成功跳转通过。
- 数据库与生产：未修改 API、Schema、migration、索引、Material 业务服务、Legacy SQLite 或部署配置；未连接生产 URL/D1，未迁移真实数据或部署。
- 已知限制：统一详情没有历史 `schema_version`；V1 使用当前 Schema、未知 code 保护和服务端 422 重载 fail-closed，不自动迁移旧属性。

### PHASE1-TASK11 实施 - `feat: add last rejection material projection`

- Git Commit：实现、隔离测试、OpenAPI 和项目治理文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `402ef9b`。
- 历史来源：单一使用不可变 `material_versions` 的 `event_type='REJECT'` 行；现有原子写事务已完整保存版本、驳回原因、审核人和审核时间，不关联 change logs，不修改历史。
- Query Service：新增统一 `lastRejection()` 有界投影；`/materials/:materialId` 与 `/drafts/:materialId` 在既有行级可见性之后复用同一查询，列表不执行且无 N+1。
- 确定性与安全：固定 `version_no DESC, reviewed_at DESC, id DESC LIMIT 1`；无记录返回 null，reason 原样作为纯文本，缺少任一必需历史字段时 fail-closed 为带 request_id 的脱敏 `INTERNAL_ERROR`。
- 查询计划：隔离 D1 返回 `SEARCH material_versions USING INDEX material_versions_material_version_uq (material_id=?)`，未出现全表扫描；本任务未新增索引或 migration。
- 测试：新增 1 个顶层隔离 D1 场景，覆盖 null、单次/多次驳回、摘要窗口外驳回、重编/重提/最终 ACTIVE、两详情一致、drafts 状态限制、隐藏 404、纯文本、损坏历史、确定性 SQL、查询计划和分页/摘要回归；Node 104/104 通过。
- 全量验证：build、lint 0 error/1 个既有 warning、OpenAPI YAML、一次性 D1 API smoke、219 文件凭证扫描、临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复、go-live 检查和 `git diff --check` 全部通过。
- 数据库与生产：未修改 schema、migration、索引、审核写服务、前端或历史记录；未连接生产 URL/D1，未迁移或部署。
- 已知限制：现有索引按 material_id/version_no 搜索，没有专用 REJECT 索引；当前单详情计划满足有界要求，若单物料版本规模显著增长需独立复测和审批。

## 2026-07-14

### PHASE1-TASK10 设计评审 - `docs: design material draft ui`

- Git Commit：书面规格、低保真线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `9bb1756`。
- 新增功能：无；本任务只完成 Material Draft 创建、编辑与提交审核界面 V1 书面设计。
- 路由与布局：定义 `/materials/new`、`/materials/:materialId/edit`，采用顶部分类/基础信息、全宽动态属性和约 200px 右侧快速定位/Validation 的布局 C；窄宽下辅助栏移动到顶部。
- 表单与 Schema：只读取当前分类 Reference Schema，按 display_order 和中性分段渲染 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位；PATCH 使用完整可编辑聚合，未知旧属性和分类切换不得静默删除。
- 写状态：定义 POST 创建后 GET 重载、PATCH/GET/submit、WARNING 确认、页面内存 IdempotencyKeyController、RESULT_UNKNOWN 安全重试、SAVED_UNSYNCED、规范化 dirty 和 VERSION_CONFLICT 只读对照。
- 权限与安全：动作只读取 `/api/session -> user.permissions`；复用现有会话、CSRF、安全 return_to 和共享 Client；source_ref 只读，POST 省略、PATCH 不发送；不硬编码角色或复制服务端 Validation。
- API 前置：记录统一详情 `last_rejection` 最小只读投影为正式前端实施阻断前置；本任务未修改 API、Schema、Migration 或写服务。
- 测试设计：定义单元、组件、集成、原 47 项加 7 项扩展 E2E，以及 1366×768 人工视觉/键盘验收；文档阶段运行完整隔离基线。
- 验证结果：lint 0 error/1 个既有 warning；构建和 Node 103/103、一次性本地 D1 API 烟测、219 文件凭证扫描、临时 SQLite 环境守卫/自测/烟测/备份恢复/go-live 检查及 `git diff --check` 全部通过。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK09 实施 - `feat: add material master read ui`

- Git Commit：前端实现、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `7b0527c`。
- 页面路由：新增 `/materials`、`/materials/:materialId`、`/versions` 和 `/change-logs` 四条原生 Vinext 路由；刷新、深链接和浏览器历史不依赖 hash 或 iframe 内 tab。
- 列表：实现紧凑筛选、高密度横向滚动表格、固定编码/名称列、服务端分页/排序、20/50/100 page_size、300ms keyword debounce、分类树和 URL 权威状态；分类失败不阻断基础列表。
- 详情与历史：实现基本、职责、类型化属性、Validation、最近 5 条版本/变更摘要分区；完整历史独立分页、comment 折叠、快照/diff 有界行下展开和 operation_id 安全显示，不提供恢复或写操作。
- 认证与请求：抽取唯一 `public/erp/api-client.js`，legacy 与 Material 页面共同使用相对 URL、同源 Cookie、Material/legacy 错误解析和 401 事件；Material 未认证访问使用现有根页面登录遮罩并通过安全 `return_to` 返回。
- 状态与错误：INACTIVE 独立显示“停用”，OBSOLETE/REPLACED 仅作防御性展示，未知状态安全降级；400/401/403/404/500、网络失败、request_id、加载、空数据库和筛选无结果均有页面状态。
- 测试：UI 单元/契约 37/37；全量 Node 103/103；四条本地 Vinext 开发路由均返回 200；lint 0 error/1 个任务外既有 warning；build、隔离 API smoke、217 文件凭证扫描和临时 SQLite 完整基线通过。
- 数据库/API：未修改 API、Schema、Migration、索引、Material 业务服务或 legacy SQLite；前端不执行行级权限过滤并以服务端 total 为唯一总数。
- 已知限制：当前普通 Node production start 不能加载 Vinext 构建中的 `cloudflare:` 模块，本地深链接验证使用既有开发运行面和正式 build；生产 Site 仍为旧版本。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK09 设计评审 - `docs: design material master read ui`

- Git Commit：书面规格、文字线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `4d2f54b`。
- 新增功能：无；本阶段只完成 Material Master 只读管理界面 V1 书面设计。
- 页面设计：列表采用高密度紧凑筛选和企业表格，详情采用高密度分区卡片；版本历史与变更日志保留独立 URL 并作为详情工作区页签。
- URL 与交互：定义列表查询规范化、keyword debounce、前进后退、深链接、安全 `return_to`、分类 ID/path 语义、服务端分页/排序和固定关键列。
- 权限与错误：前端不复制行级权限；隐藏对象统一 404；定义 401/403/400/500、网络失败、request_id、Material 嵌套错误和 private/no-store 边界。
- 历史与属性：定义 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位/空值展示、Validation ERROR/WARNING、最近 5 条摘要、有界版本快照和变更详情。
- 架构：记录现有 iframe/tab、无通用组件和 legacy 错误包装差异；建议使用真正 Vinext 路由、唯一共享浏览器请求边界，不新增大型状态或请求依赖。
- 验证：规格占位符/路由/范围自检通过；Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、203 文件凭证扫描和临时 SQLite 完整基线通过；临时数据已清理。
- 数据库/API/代码：无变化；未修改前端、API、Schema、Migration、索引、业务服务或 legacy SQLite。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK08 实施 - `feat: add material reference and query api`

- Git Commit：实现、测试、查询计划证据和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置规格提交为 `928e08f`。
- Query Service：统一 materials/drafts 的列表、可见性、详情聚合、类型化属性、当前 metadata 校验和历史读取；drafts 只保留工作流兼容字段与分页外壳，审核队列保持独立。
- API：新增分类 tree/flat、四级叶子 Schema、`/materials` 列表/详情、版本分页和变更日志分页 6 个路由；详情历史摘要各最多 5 条，完整历史默认 20、最大 50。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 扩展；授权谓词与筛选在 SQL/count 取交集，隐藏记录不返回、不计 total，不可见详情/历史返回 404。
- Metadata 与缓存：Schema 只读当前 D1，不读 seed；description 缺失为空字符串，enum label 缺失等于 code；共享 Validation 单位策略；Reference 使用强内容摘要 ETag/304，物料及历史使用 `private, no-store`。
- 性能：列表分类路径与审核 metadata 批量加载，新增查询次数防 N+1 回归；1k/10k/100k 查询计划和采样已记录，发现候选优化方向但未创建索引或 migration。
- 测试：Site build、Node 66/66、隔离 API smoke、lint 0 error/1 个任务外既有 warning、201 文件凭证扫描、查询计划脚本和临时 SQLite 完整基线通过；全量 tsc 仍只有 `db/schema.ts` 两处既有 Drizzle TS2740，按范围未修改。
- 已知限制：继续双读 `PENDING_APPROVAL`；leading-wildcard keyword 没有专用全文索引；候选索引需再次审批；无前端、写接口、导入、AI、候选匹配、真实迁移或下游业务变化。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK08 设计评审 - `docs: design material reference and query api`

- Git Commit：书面规格、OpenAPI 和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `0edede0`。
- 新增功能：无；本阶段只完成 Material Master Reference & Query API V1 书面设计。
- API 设计：新增统一 `/materials` 列表/详情、分类树、叶子 Schema、版本分页和变更日志分页契约；`/drafts` 保留为复用统一 Query Service 的兼容层，`/review-queue` 保持独立。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 取交集；列表在 SQL/count 中过滤，不可见详情返回 `404 MATERIAL_NOT_FOUND`。
- 缓存与性能：分类 tree/flat 和叶子 Schema 使用规范化内容摘要 ETag 与私有可验证缓存；物料、历史和工作流响应统一 private/no-store；列表不逐项 Validation，详情只执行单物料当前校验，历史有界分页。
- 数据库变化：无；未创建 migration 或索引。只列出候选组合索引，要求后续先完成 1k/10k/100k 合成数据的 `EXPLAIN QUERY PLAN` 和延迟证据，并再次审批。
- 文档变化：新增 `reference-query-api-v1.md` 和 OpenAPI；D-014 记录已确认架构与读取范围；同步更新 MASTER、TASKS、STATUS。
- 待确认：规格最终字段、分页、缓存 Header，以及现有 metadata 无 description/枚举显示名时采用空 description 和 `label = code` 的 V1 表达。
- 验证：OpenAPI YAML、9 个路由/35 个 schema 引用和占位符检查通过；Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 Miniflare API smoke、196 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时数据已清理，`git diff --check` 通过。
- 生产影响：无；未修改 Schema、migration、API 代码、业务服务或前端，未连接生产 D1、迁移真实数据或部署。

### PHASE1-TASK07 实施 - `feat: add material draft lifecycle`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `3dbf2b0`。
- 状态机：实现 `DRAFT -> PENDING_REVIEW -> ACTIVE` 和 `PENDING_REVIEW -> DRAFT`；驳回后允许完整替换编辑并重新提交，批准/驳回不再接受 `DRAFT`。
- API：新增 PATCH 草稿完整可编辑聚合替换、POST 提交和 GET 审核队列；补充 OpenAPI 非 Merge Patch 契约、稳定状态错误、默认分页/排序、allowlist 筛选和当前 metadata 校验摘要。
- 权限与职责：新增 edit-own/edit-any/submit/review-queue；提交同时校验 own/edit-any；创建人永久禁审、当前提交版本最后修改人禁审，无 admin 例外，`submitted_by` 本身不构成禁审。
- 数据库：新增 `0003_material_draft_lifecycle.sql`、受保护 Down 和 Drizzle snapshot/journal；增加三个职责字段、双状态过渡约束、PATCH 幂等 method 和四个审核队列索引；可验证旧待审数据回填，无法恢复职责时预检失败，历史快照不改写。
- 并发与安全：PATCH、submit、approve、reject 继续使用严格 Origin/CSRF、24 小时幂等、60/20 限流和乐观锁；业务、属性、版本、变更日志、幂等完成与 API 成功审计在单一 D1 batch 提交。并发 PATCH/提交/审核均验证仅一个成功。
- 测试：build 和 Node 62/62 通过；lint 0 error/1 个既有 warning；`0003` 升级、失败预检、约束、索引、空库 Down/重升、完整生命周期、职责分离、N+1 边界及一次性 D1 smoke 通过；194 文件凭证扫描和本地临时 SQLite 基线通过。
- 已知限制：过渡 schema 仍接受 `PENDING_APPROVAL`，破坏性收缩必须另建任务；无页面、多级审核、break-glass、导入、AI、真实物料迁移或下游业务修改；既有 Drizzle 自引用 TypeScript 诊断未在本任务修复。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK07 设计评审 - `docs: design material draft lifecycle`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成草稿生命周期、重新提交和审核队列 V1 书面设计。
- 修改功能：无；未修改现有 Validation、Draft/Review Service、Material API、页面或 legacy 运行面。
- 数据库变化：无；规格提出后续前向 migration 增加 `last_modified_by`、`submitted_by`、`submitted_at`，分步统一 `PENDING_REVIEW`，扩展 PATCH 幂等 method 并增加审核队列索引，当前未创建或执行 migration。
- API 变化：无已实现路由；规格拟议 PATCH 草稿、POST 提交和 GET 审核队列，并收紧批准/驳回只能操作 `PENDING_REVIEW`。
- 权限与职责：拟议 edit-own/edit-any/submit/review-queue 权限；所有角色继续禁止创建人自审，并新增最后实质修改人不得审核当前版本。
- 文档变化：新增 `docs/material-master/draft-lifecycle-v1.md`；D-013 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险和下一步。
- 待确认：当前职责字段方案、物理状态更名、PATCH 完整替换、编辑 Validation 阻断、提交人审核、队列校验口径、提交说明、权限矩阵和 migration 分步方案。
- 验证：Site build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；一次性 Miniflare API smoke、189 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore 和 `go_live_check --no-backup` 通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK06 实施 - `feat: add material draft and review api`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `e55318c`。
- 新增功能：实现创建、列表、详情、批准、驳回 5 个 Material 路由；复用现有会话并增加细粒度权限、全员禁止自审、严格 Origin/双提交 CSRF、稳定错误和只读 Query Service。
- 数据库变化：新增 `0002_material_draft_review_api.sql`、空隔离库 Down、Drizzle snapshot/journal；增加 `material_api_idempotency`、`material_api_rate_limit_buckets`，扩展关系化 API 审计列及 Material 列表/审计索引；未修改 `0000`/`0001`，未执行生产 migration。
- 并发与安全：幂等作用域为用户、方法、具体路径和 Key 摘要；保存 canonical 请求摘要、120 秒租约和 24 小时结果，成功完成/审计与 Material 业务 batch 原子提交；每用户每分钟 60 次写尝试/20 个新 Key，admin 不豁免，测试可降低阈值。
- 审计：Material API 审计关系化记录物理请求、稳定操作、Key 摘要、对象和版本，在线保留目标为 1095 天；admin 完整查看、manager 只读查看，提供受控分页导出，`material_change_logs` 不随 API 或幂等清理删除。
- 业务边界：公共创建只允许 `MANUAL`，非 MANUAL 返回 `SOURCE_TYPE_NOT_ALLOWED`；V1 只提供单步最终审核，不实现页面、草稿编辑、多级会签、break-glass、导入、AI 或下游业务变更。
- 验证：build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；版本化迁移已有数据升级、约束、Down/重升通过；一次性 Miniflare 登录/CSRF/API smoke、凭证扫描、`git diff --check` 和本地临时 SQLite 基线通过。TypeScript 全量检查仍只有 `db/schema.ts` 两处既有自引用类型错误。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署、未修改生产配置。

## 2026-07-13

### PHASE1-TASK06 设计评审 - `docs: design material draft and review api`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成受认证授权 Draft/Review API V1 书面设计。
- 修改功能：无；未修改现有 Draft/Review/Validation Service、API、页面或 legacy 运行面。
- 数据库变化：无；只提出后续新增 `0002`、专用 `material_api_idempotency`、有界速率桶、关系化通用审计字段、列表/审计索引和隔离迁移测试，未创建 migration 或连接 D1。
- API 变化：无已实现路由；规格拟议创建、列表、详情、批准、驳回 5 个路由，明确现有会话认证、细粒度权限、Origin/CSRF、持久幂等、乐观锁和稳定错误映射。
- 文档变化：新增 `docs/material-master/draft-review-api-v1.md`；D-012 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险、下一步和验证状态。
- 待确认：审核角色、创建人自审、多节点审核边界、批准/驳回角色是否相同、幂等与审计保留期、写速率阈值及人工 API 来源范围。
- 验证：Site build、Node 52/52、lint（0 error/1 个既有 warning）、一次性 D1 API smoke、177 文件凭证检查通过；本地环境守卫 4/4、self-test、smoke、backup/restore、临时 SQLite go-live 检查通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK05 - `feat: add material draft and review service`

- Git Commit：规格、实现、测试和项目文档在本任务独立提交完成，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：新增 `material-master` 六模块，提供 `createDraft()`、`approveDraft()`、`rejectDraft()`、类型化属性持久化、正式编码格式和统一导出。
- 状态流转：创建固定写 `DRAFT` 且无正式编码；批准重新校验后以单一 D1 batch 原子写 `ACTIVE`、编码、批准信息、版本和审计；拒绝保持 `DRAFT`、递增版本并记录拒绝历史。
- 并发与安全：物料使用 `expected_version` 乐观锁，编码规则使用 version/sequence CAS 和唯一索引；创建/批准事务比较 metadata/属性守卫，校验后规则变化会冲突回滚；服务错误不返回 SQL 或底层 D1 异常。
- 数据库变化：无 schema 或 migration 变化；只使用现有 V2 表和约束，未写生产数据。审计业务动作映射为 `CREATE_DRAFT -> CREATE`、`APPROVE -> APPROVAL`、`REJECT -> REJECTION`、`CODE_GENERATE -> CODE_ASSIGNMENT`。
- API 变化：无；未修改路由、`erp-api.ts` 或页面。
- 文档变化：新增草稿/审核服务 V1 规格与实施结果；D-011 确认所有未来来源统一经过该服务及最终审核启用时生成正式编码；同步更新总控、任务和状态。
- 验证：新增 12 个隔离 D1 服务测试，覆盖校验阻断、提交前复核、并发审核、重复编码、防 TOCTOU 和故障回滚；完整 Node 52/52、build、lint（0 error/1 个既有 warning）、隔离 API smoke、176 文件凭证检查和差异检查通过；未连接生产 D1。

## 2026-07-12

### PHASE1-TASK04 - `feat: add material validation service`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `e239c35`。
- 新增功能：新增 Repository + Rules + Service 三层 `material-validation` 模块，提供创建前和审核前校验、D1/Memory Repository、25 个结构化 code 及稳定错误顺序。
- 修改功能：测试入口显式启用 Node TypeScript stripping，以兼容项目声明的 Node 22.13 最低版本；未修改现有业务行为。
- Bug 修复：无现有业务 Bug；实现期间补足绑定属性优先、未绑定属性随后输出的稳定排序。
- 数据库变化：无 schema、migration 或生产数据变化；D1 Repository 只读现有分类、绑定和属性定义 metadata，不缓存、不读取 seed。
- API 变化：无；未接入路由或现有 `erp-api.ts`。
- 文档变化：完成物料校验服务 V1 规格与实施结果；D-010 记录 D1 metadata 唯一运行时规则来源；同步更新项目状态。
- 验证：新增 28 个校验测试，完整 Node 40/40；lint、build、隔离 API 烟测、凭证检查和差异检查通过；未连接生产 D1。

### PHASE1-TASK03 - `feat: add material category and attribute templates`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `ebef667`。
- 新增功能：新增 `material-category-v1` TypeScript 声明数据和 test/local 专用 seed 执行器，输出分类、属性、绑定的插入/更新统计。
- 修改功能：无现有业务功能变化；不接入 AI、Excel、真实物料、BOM、采购、库存或生产。
- Bug 修复：无。
- 数据库变化：无 schema 或 migration 变化；seed 可向已迁移的隔离 D1 幂等写入 101 个分类、34 个属性定义和 228 条四级叶子显式绑定，使用本地 D1 原子 batch。
- API 变化：无。
- 文档变化：新增分类标准 V1 与设计规格；D-009 明确模板复制而非父子继承；同步更新项目状态文档。
- 验证：seed 声明、父子层级、关键必填模板、幂等、环境拒绝和原 migration 测试通过；未连接生产 D1。

### PHASE1-TASK02 - `feat: implement material master v2 schema`

- Git Commit：本任务独立提交，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无业务功能；新增 Material Master V2 数据契约与可回滚迁移框架。
- 修改功能：无；现有 API、页面、BOM、采购、库存和 legacy SQLite 不变。
- Bug 修复：无。
- 数据库变化：新增 12 张在线 D1 V2 表的 Drizzle schema、`0001` Up、Down、快照、约束与索引；正式编码仅允许审核后生命周期，供应商映射唯一身份包含 supplier/code/manufacturer/mpn/revision 与有效期。
- API 变化：无。
- 文档变化：更新设计基线和项目状态，新增 `docs/audits/phase1-task02-schema-report.md`。
- 验证：本机一次性 D1 完成空库 Up、防重、结构/约束、Down 和重建；完整基线结果见审计报告。未连接生产 D1。

## 2026-07-11

### PHASE1-TASK01 设计评审 - `docs: design material master v2 data model`

- Git Commit：设计评审独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无；当前只完成设计。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无；仅设计 11 张在线 D1 V2 关系表、约束、索引和 Up/Down 迁移顺序，未创建数据库对象。
- API 变化：无。
- 文档变化：新增 `docs/material-master/database-model-v2.md`，包含 ER 图、字段说明、`legacy_material_mapping`、来源追踪、迁移/回滚方案、测试矩阵、AI 接入边界和风险；记录在线 D1 唯一目标及动态属性决策。
- 验证：文档占位符、内部一致性、11/11 表级 `created_at` 覆盖和 `git diff --check` 通过；Site lint 0 错误/1 个既有警告、构建与 Node 测试 8/8、凭证检查通过；本地 ERP 自测、烟测和上线检查在一次性临时 SQLite 中通过且目录已清理。等待人工设计审批。

### PHASE0-TASK02 - `security: establish environment isolation baseline`

- Git Commit：本任务独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：统一 development/test/production 环境清单；本机一次性 Miniflare D1 烟测运行器；生产/公开 URL/非临时路径拒绝；凭证扫描；本地 SQLite 环境与备份恢复测试。
- 修改功能：仅修改开发与测试配置；Site 本地 Cloudflare 绑定关闭远程资源，烟测数据采用 `TEST-` 标识并自动销毁；本地数据目录支持环境覆盖以隔离测试。
- Bug 修复：本地烟测备份不再写入正式数据目录；在线写入型烟测不能再直接指向任意远程 URL。
- 数据库变化：无 schema 或迁移变化；未创建云端 D1，未连接或修改生产 D1。
- API 变化：无业务 API 新增、删除或行为修改；备份/恢复只在一次性测试数据库验证。
- 文档变化：新增测试环境说明、安全隔离审计和设计规格；更新 README、MASTER、TASKS、PROJECT_CONTEXT、ARCHITECTURE、DECISIONS、STATUS。
- 验证：Site lint、build、Node 测试、一次性 D1 API 烟测、凭证扫描及本地 ERP 自测/烟测/上线检查/备份恢复均通过。

### PHASE0-TASK01-B - `fix: convert site gitlink to tracked source`

- Git Commit：本任务独立合并提交；第一父提交为任务开始时根仓库 `a1a8d6a`，第二父提交为 Site 开发基线 `9f2c2dc`；完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：移除无 `.gitmodules`、无可用远端的 Site gitlink；把原 Site tree 的 77 个文件按普通文件纳入根仓库，使新克隆可恢复完整源码。
- 数据库变化：无；未修改 schema、迁移或生产 D1。
- API 变化：无。
- 文档变化：更新根 README、项目总控、状态、任务、架构、上下文和决策记录；新增 `docs/audits/phase0-task01-source-management-report.md`。
- 版本关系：生产 Site `2b4f178`；纳管前开发 Site `9f2c2dc`；两者运行时代码一致，且 `2b4f178` 是 `9f2c2dc` 的祖先。

### PM-000 - `docs: establish project operating system`

- Git Commit：本任务独立提交，完成后以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：新增 `docs/project/` 项目管理体系；更新 `AGENTS.md` 的文档驱动开发流程；纳入现有技术审计和物料 V2 准备文档作为上下文基线。

### `bbefb2e` - `feat: add chenyida erp site project files`

- 新增功能：根仓库记录在线 Site 项目入口。
- 修改功能：无本次重新审计的业务行为变化。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：无。
- 已知问题：该入口为无 `.gitmodules` 的 gitlink，新克隆不可恢复完整 Site 源码。

### `3e45f05` - `Document online ERP architecture`

- 新增功能：无。
- 修改功能：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：记录在线 ERP 架构。

## 历史基线

下列提交已存在于根仓库历史。本次只建立索引，不重新解释未审计的每一行变化：

| Commit | 提交消息 | 主要类别 |
| --- | --- | --- |
| `7654d45` | `Add quotation workflow` | 功能 |
| `42bdd8c` | `Add customer and supplier master data` | 功能 |
| `1255f6f` | `Add inventory count adjustments` | 功能 |
| `a58c20d` | `Add finance settlement module` | 功能 |
| `07562bc` | `Add go-live operations package` | 功能/运维 |
| `8d0138b` | `Add ERP login and operations controls` | 功能/安全 |
| `7748ade` | `Merge remote-tracking branch 'origin/main'` | Git 历史 |
| `f189de9` | `Initial ChenYida ERP system` | 初始系统 |
| `a4b63b3` | `Initial commit` | 初始化 |

## 记录模板

```text
### TASK-ID - `type: commit message`
- Git Commit：提交后以 git log 为准
- 新增功能：
- 修改功能：
- Bug 修复：
- 数据库变化：
- API 变化：
- 文档变化：
```
