# Material Master PostgreSQL 工作流

最后更新：2026-07-23（Asia/Shanghai）
适用任务：`SELFHOST-PHASE1-TASK01`

## 运行边界

Material Draft / Review / Active 的自托管权威链路为：

```text
React/Vinext 页面
  -> app/api/[...path]/route.ts
  -> app/lib/selfhost-api.ts（Session、用户能力、CSRF入口）
  -> app/lib/material-selfhost/handler.ts（HTTP契约）
  -> app/lib/material-selfhost/service.ts（业务规则）
  -> app/lib/material-selfhost/repository.ts（PostgreSQL事务与查询）
  -> PostgreSQL
```

该链路不导入 `cloudflare:workers`，不访问 D1、R2、Queue 或 Miniflare。旧 `erp-api.ts`、旧 Material D1 Service/Repository、`drizzle/0000`—`0008` 和 Miniflare 测试继续保留为行为与迁移参照，不属于自托管运行依赖。本任务没有双写，也没有迁移 SQLite/D1 真实数据。

## 分层职责

- Repository：执行 PostgreSQL 查询、分页、事务、`FOR UPDATE` 行锁、分类编码序列原子递增、版本/变更/审计持久化和约束错误转换。
- Service：执行权限和行级可见性、固定状态机、动态属性校验、创建人与最后修改人职责分离、`expected_version`、编码协调以及强幂等。
- API：执行 Session 认证、请求/查询参数解析、CSRF、正文大小与摘要、`Idempotency-Key`、统一状态码、请求编号和安全错误响应。
- 浏览器：只负责页面交互、重复点击保护和冲突提示；权限、编码、状态转换及属性合法性的最终判断均在服务端。

`selfhost-api.ts` 只做统一入口，不包含 Material SQL 或审批状态机。

## 数据库迁移

`drizzle-postgres/0002_material_master_workflow.sql` 是 `0001_selfhost_baseline.sql` 之后的增量迁移；已执行的 `0001` 未被修改。

迁移新增：

- `material_code_sequences`：以 `category_id` 为主键、`category_code` 唯一，`next_value` 受范围约束；外键限制删除分类。
- `material_master_review_queue_idx`：审核队列状态/提交时间查询索引。
- `material_versions_material_event_idx`：单物料事件历史查询索引。
- `material_master_draft_code_ck`：`DRAFT`/`PENDING_REVIEW` 必须没有正式编码。
- `material_master_active_code_ck`：`ACTIVE` 必须已有正式编码。

`db/schema.ts`、迁移、Drizzle journal 和 `0002_snapshot.json` 保持一致。迁移在隔离 PostgreSQL 17 空库执行，并验证重复运行不会重复应用。

## 固定状态机和事务

```text
DRAFT --submit--> PENDING_REVIEW --approve--> ACTIVE
   ^                     |
   +--------reject-------+
```

- 新建只能得到 `DRAFT`，正式编码必须为空。
- `DRAFT` 可编辑；`ACTIVE` 不能经草稿接口覆盖。
- 提交前重新执行基础字段、四级启用分类及动态属性完整校验。
- 只有审核能力用户可批准或驳回；创建人和最后修改人均不能审核。
- 驳回理由必填，驳回回到 `DRAFT`，历史不删除，可修正后重新提交。
- 每次写操作都校验 `expected_version`（创建除外），旧版本返回 409，不覆盖并发修改。

每个写操作都在一个 PostgreSQL 事务中完成主记录、类型化属性、版本、字段变更、审计及幂等结果。批准和驳回先锁定物料行；任何一步失败均整体回滚。测试通过数据库约束故意制造批准失败，确认未出现 ACTIVE、编码、版本或审计半记录。

## 正式编码并发安全

格式为 `CYD-{服务端分类代码}-{六位流水号}`。批准事务锁定草稿后，用 `INSERT ... ON CONFLICT ... DO UPDATE SET next_value = next_value + 1 RETURNING` 原子领取该分类序号；不使用 `MAX()+1`。`material_code_sequences` 的分类主键/代码唯一约束、`material_master.internal_material_code` 既有唯一约束和同一批准事务形成三层保护。

事务回滚时序号领取、ACTIVE 状态、正式版本和审计一起回滚；已成功生成的编码不可由客户端提交、修改或重新分配。并发集成测试从不同连接批准同品类不同草稿，生成两个不同编码。

## 字段和动态属性校验

复用现有物料模型：标准名称、分类、单位、品牌、制造商、制造商料号、采购/库存/批次/保质期/检验/环保字段、来源、类型化动态属性及生命周期字段。客户端提交 `internal_material_code`、状态、版本或创建/审核身份等权威字段会被拒绝。

分类必须是启用的四级叶子；动态属性必须来自该叶子显式绑定。服务端按 `TEXT`、`INTEGER`、`DECIMAL`、`BOOLEAN`、`ENUM` 分别校验必填、格式、枚举和规范单位；未知属性及分类切换后残留属性均 fail closed。属性采用完整替换语义，避免隐藏脏数据。

## API 契约

所有响应携带 `X-Request-ID`，业务错误返回稳定 `error.code`、中文消息和 `request_id`；不返回 SQL、连接串、Token 或堆栈。历史列表 `page_size` 最大 50，其余列表最大 100，均为 `no-store`。

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/material-master/categories?view=tree|flat` | 分类目录 | `material.read` |
| `GET /api/material-master/categories/:id/schema` | 分类属性 Schema | `material.read` |
| `GET /api/material-master/drafts` | 可见草稿列表/筛选 | `material.read` + 行级可见性 |
| `POST /api/material-master/drafts` | 创建草稿 | `material.draft.create` |
| `GET /api/material-master/drafts/:id` | 草稿详情 | `material.read` + 行级可见性 |
| `PATCH /api/material-master/drafts/:id` | 完整替换编辑 | `material.draft.edit_own` 或 `material.draft.edit_any` |
| `POST /api/material-master/drafts/:id/submit` | 提交审核 | `material.draft.submit` |
| `GET /api/material-master/review-queue` | 待审核队列 | `material.review.queue` |
| `POST /api/material-master/drafts/:id/approve` | 审核通过 | `material.review.approve` |
| `POST /api/material-master/drafts/:id/reject` | 审核驳回 | `material.review.reject` |
| `GET /api/material-master/materials` | 统一物料/ACTIVE列表及筛选 | `material.read` |
| `GET /api/material-master/materials/:id` | 物料详情 | `material.read` + 行级可见性 |
| `GET /api/material-master/materials/:id/versions` | 版本历史 | `material.read` + 行级可见性 |
| `GET /api/material-master/materials/:id/change-logs` | 变更历史 | `material.read` + 行级可见性 |
| `GET /api/material-master/materials/:id/audit-logs` | 审计历史 | `material.audit.read` + 行级可见性 |

所有写接口要求有效 Session、非强制改密状态、同源 CSRF、`Idempotency-Key` 和受控 JSON 正文。幂等表保存 route/key/user/request digest 和完成响应；事务级 advisory lock 串行化相同作用域。相同键/相同正文返回原结果并标记 `Idempotency-Replayed: true`，相同键/不同正文返回 409。

状态码约定：400 请求或业务参数、401 未认证、403 权限/职责分离/CSRF、404 不存在或无行级可见性、409 状态/版本/幂等冲突、422 字段或属性校验、500 安全兜底。

## 权限矩阵

| 能力 | 普通只读 | 草稿创建/编辑者 | 审核者 | 管理员 `*` |
| --- | :---: | :---: | :---: | :---: |
| 查看分类/授权物料 | ✓ | ✓ | ✓ | ✓ |
| 创建草稿 |  | `material.draft.create` | 按实际能力 | ✓ |
| 编辑本人草稿 |  | `material.draft.edit_own` | 按实际能力 | ✓ |
| 编辑任意草稿 |  | `material.draft.edit_any` | 按实际能力 | ✓ |
| 提交审核 |  | `material.draft.submit` | 按实际能力 | ✓ |
| 查看审核队列 |  |  | `material.review.queue` | ✓ |
| 批准/驳回 |  |  | `material.review.approve` / `material.review.reject` | ✓，但仍受职责分离限制 |
| 查看审计历史 |  | 按授权 | `material.audit.read` | ✓ |

管理员通配权限也不能绕过创建人/最后修改人隔离。页面根据 capabilities 显示入口和禁用操作，但服务端独立强制执行全部规则。

## 页面接入

现有 `/materials`、`/materials/new`、`/materials/:id`、`/materials/:id/edit`、`/materials/review`、`/materials/:id/review` 页面继续使用原前端契约，catch-all API 已切换到上述 PostgreSQL链路。详情工作区新增真实 `/materials/:id/audit-logs` 页面；只有 `material.audit.read` 或 `*` 用户显示页签，页面只展示安全审计元数据，不渲染请求正文或敏感 detail。

现有 UI 已包含字段级 Validation、409 刷新提示、提交中禁用、页面内存幂等键和审核职责提示；服务端规则是最终权威。

## 隔离验证与运行步骤

以下命令必须使用 `ERP_ENV=test` 和独立 PostgreSQL；脚本会拒绝 production。宿主机没有 Node.js 时可在 Node 22 容器中运行。

```bash
npm run test:material:unit
npm run test:material:ui
DATABASE_URL=postgresql://.../cyd_material_test ERP_ENV=test npm run test:material:postgres
npm run lint
npm run build
```

Compose 使用独立 project、测试端口和测试数据卷：

```bash
docker compose -p cyd-material-phase1-test up -d postgres migrate web worker
ERP_ENV=test ERP_TEST_BASE_URL=http://127.0.0.1:18889 \
  DATABASE_URL=postgresql://.../cyd_material_compose_test \
  npm run test:material:compose
docker compose -p cyd-material-phase1-test restart postgres web worker
```

实际结果、完整环境变量处理和清理结果记录在任务完成报告中。不得把示例连接串、测试口令或测试 Cookie 提交到仓库。

## 已知限制与后续迁移

- Import Mapping、Mapping版本/复用、行级 Normalizer、Normalization→Draft 尚未移植到 PostgreSQL；下一任务是 `SELFHOST-PHASE1-TASK02`。
- 旧 D1/Miniflare 实现和测试仍存在于仓库，但新 Material 自托管模块没有运行时引用；删除历史代码需另立任务并证明无引用。
- 尚未迁移任何 SQLite/D1 真实数据，未执行生产迁移、生产容量测试、生产备份恢复演练或公网部署。
- 当前审核是固定单步流程；不包含自由审批引擎、多节点会签或 break-glass。
- 审核队列的实时 Validation 为有界查询；大规模真实数据的容量和索引复核留待生产迁移前验收。
- 本任务没有改动 BOM、采购或仓库；这些模块只引用 ACTIVE 物料的服务端约束仍需后续逐域确认。
