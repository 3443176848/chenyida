# SELFHOST-PHASE1-TASK01 完成报告

任务：完成 Material Draft / Review / Active 物料主数据 PostgreSQL 全链路移植
完成日期：2026-07-23（Asia/Shanghai）
状态：`DONE`（非生产实现与隔离验收完成；按任务明确要求未提交）

## 1. 交付结论

Material Draft / Review / Active 已从自托管入口到 PostgreSQL 形成唯一运行链路。现有页面可创建、编辑、提交草稿，由另一名授权用户通过或驳回；通过时服务端按分类原子生成 `CYD-{CATEGORY_CODE}-{NNNNNN}`，并可查询 ACTIVE 物料、版本、变更及审计历史。

验收确认：Session、细粒度权限、CSRF、强幂等、请求摘要、乐观锁、职责分离、类型化属性校验、事务回滚、并发编码唯一性和 Compose 重启持久性均在隔离环境通过。未连接生产、迁移真实数据、部署、提交、推送或创建 PR。

## 2. 修改文件清单

本任务主要新增/修改：

- `db/schema.ts`：编码序列表、状态/编码约束及历史/队列索引定义。
- `drizzle-postgres/0002_material_master_workflow.sql`、`drizzle-postgres/meta/0002_snapshot.json`、`drizzle-postgres/meta/_journal.json`：增量 PostgreSQL migration。
- `app/lib/material-selfhost/errors.ts`、`types.ts`、`state-machine.ts`、`validation.ts`、`repository.ts`、`service.ts`、`handler.ts`：Material PostgreSQL 独立业务模块。
- `app/lib/selfhost-api.ts`：将 Material 精确路由委托到新模块，并规范请求 UUID；保留 Phase 0 Import 基线。
- `app/materials/[materialId]/audit-logs/page.tsx`、`app/materials/_components/material-detail-workspace.tsx`、`material-detail-sections.tsx`：接通审计历史页面、能力控制和详情计数。
- `tests/selfhost-material-unit.test.mjs`、`selfhost-material-postgres.test.mjs`、`selfhost-material-ui-contract.test.mjs`：无 D1/Miniflare 的单元、PostgreSQL/API和页面契约测试。
- `scripts/selfhost-material-compose-smoke.mjs`：真实 Web/Session/CSRF/两用户审批 Compose 烟测。
- `scripts/selfhost-compose-smoke.mjs`：按严格 Schema 生成 Phase 0 草稿烟测属性，保持基线兼容。
- `package.json`、`package-lock.json`：增加 Material 测试脚本并保留 Phase 0 依赖基线。
- `app/lib/material-import/xls-parser.ts`：仅把既有 `let flags` 改为 `const`，属于阻断全量 lint 的既有问题清理，无行为变化。
- `docs/self-hosting/material-master-postgresql.md`：Repository/Service、状态机、API、权限、事务、测试与风险说明。
- `docs/project/MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`DECISIONS.md`、`CHANGELOG.md`、`STATUS.md`：项目权威上下文同步。

工作区同时保留 `SELFHOST-PHASE0-TASK01` 的未提交基础设施文件和修改；本任务没有覆盖或回退它们。

## 3. Migration 说明

新增 `0002_material_master_workflow.sql`，没有修改已作为基线的 `0001_selfhost_baseline.sql`。`0002` 新增按分类的编码序列表、审核队列/事件历史索引，以及“草稿不得有正式编码、ACTIVE必须有正式编码”的数据库约束。Schema、snapshot 和 journal 已同步。

迁移在一次性 PostgreSQL 17 空库执行，`0001`/`0002` 均成功；重复执行不重复应用。没有执行 D1、SQLite 或生产 migration。

## 4. Repository 和 Service 边界

- `PostgresMaterialRepository` 负责 PostgreSQL 事务、行锁、原子编码序列、分页、行级可见性、类型化属性、版本、变更和审计持久化。
- `MaterialWorkflowService` 负责固定状态机、权限、创建人/最后修改人隔离、动态 Schema 校验、`expected_version`、幂等、编码协调和事务内事件组织。
- `handler.ts` 负责认证后的 HTTP 契约、CSRF、JSON/查询参数、请求摘要、状态码和安全错误。
- `selfhost-api.ts` 只保留共享 Session/权限入口及精确委托，不堆放 Material SQL 或审批规则。

详细事务边界见 `docs/self-hosting/material-master-postgresql.md`。

## 5. API 迁移情况

现有前端路径保持不变，已迁移分类/Schema、草稿列表/详情/创建/编辑/提交、审核队列/通过/驳回、统一物料列表/详情、版本、变更和审计历史。写接口要求 Session、能力权限、CSRF、`Idempotency-Key`、规范请求摘要和 `expected_version`；相同键同正文安全重放，相同键不同正文返回 409。

错误响应区分 400、401、403、404、409、422 和 500，包含稳定 code、中文消息及 request ID，不返回 SQL、连接串、Token 或堆栈。

## 6. 前端接入情况

复用现有 React/TypeScript Material 列表、创建、编辑、详情、审核队列和审核工作台，没有重新设计 UI。它们通过 catch-all 自托管 API 访问 PostgreSQL，不访问 D1。新增真实审计历史页签/路由，按 `material.audit.read` 能力显示，且不渲染敏感审计正文。

现有页面的字段错误定位、409 刷新提示、提交中禁用、页面内存幂等键和审核关系提示继续生效；服务端独立执行所有最终规则。

## 7. 权限和审批规则

固定状态机为 `DRAFT -> PENDING_REVIEW -> ACTIVE`，驳回为 `PENDING_REVIEW -> DRAFT`。创建人和最后修改人均不得审核，即使账号持有管理员通配权限；只有对应 review 能力的其他用户可以通过或驳回，驳回原因必填。ACTIVE 不允许草稿接口覆盖，历史不通过删除回退。

Compose 使用三个隔离测试账号角色验证：创建者、具备审核权限的第二用户、无审核权限只读用户；口令仅由测试环境变量提供，没有固定默认密码进入仓库。

## 8. 编码并发安全方案

批准事务先 `FOR UPDATE` 锁定草稿，再通过 `material_code_sequences` 的单条 upsert/递增/returning 原子领取分类流水，不使用 `MAX()+1`。分类主键、分类代码唯一、正式编码唯一和状态/编码 check constraint 共同兜底。编码领取、ACTIVE 更新、正式版本、变更及审计同事务提交或回滚。

不同数据库连接并发批准同品类不同草稿的测试生成两个不同编码；故意触发数据库约束失败时，状态、编码、版本和审计全部保持原状。

## 9. 测试命令与真实结果

宿主机无 Node.js，Node 测试、lint 和 build 在 Node 22 容器/Compose 镜像中运行；数据库均为一次性 PostgreSQL 17 测试实例。

| 验证 | 真实结果 |
| --- | --- |
| `npm run test:material:unit` | PASS 6/6 |
| `npm run test:material:ui` | PASS 2/2 |
| `npm run test:material:postgres` | PASS 7/7 |
| `node --experimental-strip-types --test tests/material-read-ui.test.mjs tests/material-draft-ui.test.mjs tests/material-review-ui.test.mjs` | PASS 142/142 |
| `npm test` | PASS 3/3（Phase 0 FileStorage 回归） |
| `npm run test:postgres` | PASS 5/5（Phase 0 PostgreSQL/Worker 回归） |
| `npm run build` | PASS；standalone 构建包含新增审计页面 |
| `npm run lint` | PASS，0 error；保留 workbook 脚本 1 个任务前既有 unused warning |
| `npm run security:credentials` | PASS；402个跟踪/未跟踪交付文件完成凭证规则扫描 |
| `git diff --check` | PASS |
| 新自托管模块运行依赖扫描 | PASS；无 `cloudflare:workers`、D1、R2、Queue 或 Miniflare 引用 |
| 隔离 PostgreSQL migration | PASS；`0001`、`0002` 和约束存在，重复迁移无重复应用 |
| Compose 全链路 | PASS；创建/编辑/提交、自审403、无权限403、第二用户批准、ACTIVE/版本/变更/审计查询全部成功 |
| Compose 重启持久性 | PASS；重启 PostgreSQL/Web/Worker 后物料、编码、4版本和6条审计仍可查询 |

Compose 真实业务结果：`material_id=1`，正式编码 `CYD-FR4_STANDARD-000001`，4 个版本、8 条变更、6 条审计。分类代码来自服务端 Seed，并非客户端指定。

## 10. 未完成项

- Import Mapping、Mapping版本/复用规则、行级 Normalizer PostgreSQL 持久化未实施。
- 未实施自动 Import→Draft、供应商/客户/BOM/采购/库存等其他领域修改。
- 未执行 SQLite/D1 真实数据迁移、生产 migration、生产容量测试、生产恢复演练或公网部署。
- 未设计自由审批引擎、多节点会签、break-glass、Redis/Kafka/MinIO。
- workbook 构建脚本仍有一个既有 unused warning；依赖审计风险未通过强制升级处理。

## 11. 旧 D1 代码剩余依赖

旧 `erp-api.ts`、D1 Material Service/Repository、D1 migration 与 Miniflare 测试仍在仓库中，供行为比较和未来数据映射使用。新的 `app/lib/material-selfhost/`、自托管 Material API及新增测试均不导入或启动这些组件；自托管运行流的数据库只有 PostgreSQL。

Import 领域仍有尚未 PostgreSQL 化的 D1/R2/Queue 旧实现，但它不属于本任务 Material Draft/Review/Active 运行链路；Phase 0 仅保留基础上传/Parser Worker 的 PostgreSQL与本地文件能力。

## 12. 安全、Git 与生产影响

- 测试仅连接显式隔离数据库和本机测试端口；测试脚本拒绝 production。
- 没有真实密码、Token、Cookie、连接串、数据库、备份或业务附件进入交付文件。
- 未执行 `npm audit fix --force`，未升级无关依赖树。
- 未连接/修改生产、未部署、未迁移真实数据。
- 按本任务明确指令，未提交、未推送、未创建 PR；Phase 0 和本任务改动继续保留在工作区供用户审阅。
- 最终验证后已删除专用 `cyd-erp-material-test-pg`、`cyd-erp-material-final-pg` 容器，并通过 `docker compose -p cyd-material-phase1-test down -v` 删除专用 Compose 容器、网络和测试卷；其中测试数据不可恢复，不影响任何生产或非本任务资源。

## 13. 下一任务建议

`SELFHOST-PHASE1-TASK02`：完成 Import Mapping、Mapping版本及复用规则的 PostgreSQL 持久化和自托管 API 移植。

本任务未提前实施 TASK02。
