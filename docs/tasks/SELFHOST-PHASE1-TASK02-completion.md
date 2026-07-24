# SELFHOST-PHASE1-TASK02 完成报告

## 任务结论

`SELFHOST-PHASE1-TASK02` 已在非生产、自托管隔离环境完成。

本任务把 Import Mapping、Mapping 版本、复用规则、动态目标目录和现有 Import Workspace 接入 PostgreSQL 17 自托管链路。确认版本是不可变快照；复用只复制到当前草稿，绝不静默确认。任务没有实现或连接行级 Normalizer，没有迁移真实数据，没有连接或修改生产数据库，没有部署公网，也没有创建 Git commit、push 或 PR。

## 开始时诊断

诊断记录见 `docs/audits/SELFHOST-PHASE1-TASK02-diagnosis.md`。

开始时确认：

- PostgreSQL `0001` 只有 Import Mapping 占位结构，缺少源结构摘要、确认快照、失效原因、版本关系和复用来源。
- 自托管 Worker 只直接写原始行并把批次置为 `PARSED`，没有原子发布 parse run、Sheet、表头建议和 Mapping 草稿。
- 自托管 API 只有批次、上传和任务入口，没有 Sheet、Rows、Catalog、Mapping 保存/预览/确认、版本或复用接口。
- 旧 D1 代码可作为行为参照，但没有完整实现跨批次复用和版本列表；本任务没有把 D1/Miniflare/Cloudflare 重新引入自托管运行依赖。
- 动态属性已有稳定大写 `attribute_code`，可以作为 Mapping Target 的内部稳定 code；中文名称只作显示。

## 数据库与迁移

新增 `drizzle-postgres/0003_material_import_mapping.sql`、Drizzle journal 和 snapshot。

主要变化：

- 原始行强制绑定 `parse_run_id`，历史行按 parse run 保留，不再按批次覆盖。
- parse run 增加 Mapping 准备状态和源结构摘要。
- Mapping 增加稳定 key、来源类型、Sheet 名、标准化源字段、源结构摘要、目标目录版本、完整确认快照、确认人/时间、复用来源、前后版本关系、失效原因和请求审计字段。
- Mapping Item 明确目标 namespace、源列、源表头、组合分隔符和自适应状态；目标唯一性以 `namespace + code` 为边界。
- 数据库 partial unique index 保证每批次最多一个当前草稿和一个当前确认版本。
- 数据库 trigger 禁止更新或删除 CONFIRMED、STALE、SUPERSEDED 的业务内容及其 Items；只允许受控状态关联变化。
- 旧基线中无法证明完整源结构和目标快照的 CONFIRMED Mapping 在升级时 fail closed 为 `STALE / LEGACY_SNAPSHOT_INCOMPLETE`，不伪造可复用状态。

迁移验证覆盖：

- 空库依次应用 `0001`、`0002`、`0003`。
- migration runner 重复执行无待办且 checksum 不变。
- 旧 parse row、旧 confirmed mapping 和旧 item 的已有数据升级；原始行回填 parse run，旧确认版本安全转为 STALE。
- 约束、partial unique index、外键和不可变 trigger。
- Drizzle schema、journal、snapshot 与实际目标结构同步。

## 服务端边界

新增独立 `material-import-selfhost` 模块：

- `catalog.ts`：从 PostgreSQL ACTIVE 属性定义和分类绑定生成动态目标目录；静态 BASIC/SPECIAL 目标与动态 ATTRIBUTE 使用稳定 namespace/code。
- `rules.ts`：NFKC 表头标准化、列引用、源结构摘要、Mapping 内容摘要、草稿校验、必填目标检查和复用决策。
- `service.ts`：事务、版本、确认快照、候选复用、显式应用、有效性检查、预览、审计和幂等。
- `handler.ts`：受认证 API 路由、权限、CSRF、请求大小、稳定错误、请求编号和 Idempotency-Key。

关键规则：

- Mapping 保存和确认均绑定批次 `expected_version`、当前 `parse_run_id`、`expected_mapping_version` 和当前 metadata digest。
- 同一 Idempotency-Key + 同一正文返回原结果并标记 `Idempotency-Replayed`；同 Key 异正文返回冲突。
- 新幂等记录、业务记录、版本变化、Import Event 和 Audit Log 在同一 PostgreSQL 事务提交或整体回滚。
- 并发写先锁批次，再写带批次外键的幂等记录，避免外键 key-share 与批次 row lock 的锁顺序死锁。
- 确认前要求 STANDARD_NAME 和 UNIT；目标不存在、类型/模式不兼容、重复目标、冲突或未处理字段均 fail closed。
- 同一批次相同 `mapping_digest` 不得创建无意义重复确认版本。
- 新版本从确认快照显式创建 DRAFT；新版本确认后，旧确认版本只改为 SUPERSEDED，业务快照保持不变。
- 跨批次复用不会改变来源版本。只有源类型、Sheet/表头/顺序和目标兼容性满足规则时才可应用；metadata 变化但已用目标仍兼容时为 `RECONFIRM_REQUIRED`；已用目标类型等语义变化时为 `STALE`。
- 应用复用只复制到 DRAFT，并明确返回 `confirmation_required: true`。

## API

新增或接通：

- `GET /api/material-master/import-batches/:batchId/sheets`
- `GET /api/material-master/import-batches/:batchId/rows`
- `GET /api/material-master/import-batches/:batchId/mapping-targets`
- `GET /api/material-master/import-batches/:batchId/mapping`
- `PUT /api/material-master/import-batches/:batchId/mapping`
- `POST /api/material-master/import-batches/:batchId/mapping/preview`
- `POST /api/material-master/import-batches/:batchId/mapping/confirm`
- `GET|POST /api/material-master/import-batches/:batchId/mapping/versions`
- `GET /api/material-master/import-batches/:batchId/mapping/versions/:version`
- `GET /api/material-master/import-batches/:batchId/mapping/validity`
- `GET /api/material-master/import-batches/:batchId/mapping/reuse-candidates`
- `POST /api/material-master/import-batches/:batchId/mapping/reuse`

同时补齐当前页面依赖的 Import Batch list/detail 文件安全摘要和创建人行级可见性。未新增 Normalizer API。

## Worker 与原子发布

CSV/XLS/XLSX 仍复用既有有界 Parser。Worker 完成解析后在后台任务完成事务中一次性写入：

- parse run
- parse sheets
- header suggestion
- 带 parse run 的不可变原始行
- 初始 Mapping DRAFT 和确定性表头别名建议
- parse run Mapping 准备状态
- batch 当前 parse pointer、`AWAITING_MAPPING` 状态和 Import Event

任一写入失败时，后台任务结果和以上业务发布整体回滚，不留下只有原始行或只有批次状态的半成品。

## 前端

现有 Material Import Workspace 增加：

- 当前 Mapping 版本和状态。
- 同批次版本历史及 CONFIRMED/SUPERSEDED/STALE 状态。
- 从当前确认快照创建新草稿版本。
- 跨批次复用候选、决策和原因。
- 显式“应用到当前草稿”动作。
- 明确提示“服务端未自动确认，必须重新预览并人工确认”。

原有保存、预览、确认仍绑定批次版本、Mapping 版本、parse run 和 metadata digest。未把 Mapping 确认自动连接到行级 Normalizer、Material Draft 或正式物料。

## 验证结果

专项自动测试：

- Mapping 规则单元：3/3。
- Mapping UI contract：2/2。
- Mapping PostgreSQL/API：6/6。
- 旧数据升级迁移：1/1。

Mapping PostgreSQL/API 用例覆盖：

- 当前页面读取 Sheet、Rows、Catalog、Mapping。
- 保存、预览、确认和确认后读取。
- 同 Key 同正文重放、同 Key 异正文冲突。
- 权限、创建人行级可见性、CSRF。
- 批次和 Mapping 乐观锁。
- 两连接并发保存只有一个成功。
- 审计插入失败时 Mapping、Items、审计和幂等整体回滚。
- 已确认 Mapping 和 Items 数据库不可变。
- 新草稿版本、重复内容拒绝、新内容确认和旧版本 SUPERSEDED。
- 跨批次 AUTO_RECOMMEND、显式应用且仍为 DRAFT。
- 动态属性类型变化后 validity 失败、候选 STALE、复用拒绝。

回归验证：

- Material 单元：6/6。
- Material UI contract：2/2。
- Material PostgreSQL/API：7/7。
- Phase 0 FileStorage：3/3。
- PostgreSQL/Worker：5/5。
- 环境保护：6/6。
- 定向 TypeScript strict check：通过。
- Vinext production build：通过。
- ESLint：0 error；1 个任务前已有 workbook unused warning。
- `git diff --check`：通过。

隔离 Compose：

- PostgreSQL 17 空卷应用 `0001`～`0003`。
- CLI 初始化无默认密码的隔离管理员、101 分类和 34 属性。
- 真实 Web 登录、CSV 上传、Worker 解析 3 行。
- Worker 原子发布 parse run、Sheet、Rows 和 Mapping DRAFT，批次进入 `AWAITING_MAPPING`。
- 当前页面 API 保存 Mapping v2、预览 2 行、确认快照并读取版本历史。
- Web/Worker 重启后 health 正常，数据库仍为 `MAPPING_CONFIRMED:CONFIRMED:v2`。

## 未完成与后续边界

- 行级 Normalizer、Normalization run、Review 和 Draft Commit 没有在本任务移植到 PostgreSQL。
- SQLite/D1 真实数据迁移、重复/冲突人工处置和生产切换未执行。
- 未做生产容量、远程网络、正式备份恢复演练或生产权限验收。
- 未执行生产数据库迁移、部署或公网切换。
- 未创建 Git commit、push 或 PR；工作区保留用户原有未提交改动和本任务改动。

建议下一独立任务为 `SELFHOST-PHASE1-TASK03`：只移植行级 Normalizer/Normalization Review 到 PostgreSQL，并继续禁止把真实数据迁移和生产切换混入实现任务。
