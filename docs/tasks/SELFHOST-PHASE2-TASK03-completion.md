# SELFHOST-PHASE2-TASK03 完成报告

完成日期：2026-07-25（Asia/Shanghai）

状态：`DONE`（非生产；提交 SHA 由 `git log -1 --format=%H -- docs/tasks/SELFHOST-PHASE2-TASK03-completion.md` 解析）

## 1. Git 与版本

- Task start HEAD：`2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`。
- Final HEAD / commit SHA：本报告与功能处于同一聚焦提交，使用上方 `git log` 命令解析；该提交父节点必须为 task start HEAD。
- Commit message：`feat: add self-hosted master data and bom`。
- Branch：`main`；起始工作区 clean，根仓库无 submodule、gitlink 或嵌套仓库。
- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.2 -> 0.1.0-alpha.3`；package 与 lockfile 一致，未升级依赖。
- 未 push，未创建 PR，未 rebase/amend/squash/重写历史。

## 2. Migration 与 Schema

- 新增 `drizzle-postgres/0007_master_data_bom.sql`，SHA-256：`0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`。
- `0001`—`0006` 的 SHA-256 分别保持为 `c1cd7180...1702`、`2d8d4fac...eb80`、`8ce85955...dbf`、`1bb0eb9b...aa39`、`e4f2dc62...cdcc`、`6e185d01...7079`；完整值见 `RELEASES.md`。
- 新增 `business_code_sequences`、`customers`、`suppliers`、`products`、`product_versions`、`bom_headers`、`bom_versions`、`bom_lines`，扩展 `supplier_mappings` 并增加价格历史约束。
- 旧 supplier mapping 行以 nullable supplier FK 保留作迁移来源；新服务只接受并返回稳定 Supplier/Material/Unit 关联，不静默伪造供应商主体。
- Schema、journal、snapshot 同步；`drizzle-kit generate --name task03_consistency_check` 返回 `No schema changes, nothing to migrate`。
- 空库、0006 存量库、重复执行、失败事务回滚、约束/索引、旧用户/session 与旧 mapping 保留均通过；恢复策略是执行前快照并依赖 migration 事务回滚，未提供破坏性自动 Down。

## 3. 服务、API 与事务边界

- 模块：`master-data-selfhost/{errors,types,repository,service,handler}.ts` 与 `bom-selfhost/{service,handler}.ts`；`selfhost-api.ts` 只负责统一身份门禁与精确分派。
- API：`/api/items`、`/api/customers`、`/api/suppliers`、`/api/products`、`/api/products/:id/status`、产品版本创建/发布、`/api/mappings`、映射状态/价格历史、`/api/boms`、BOM line/readiness、BOM 修订/发布。
- 权限：所有业务角色可按 capability 只读；sales 管 Customer，purchase 管 Supplier/Mapping，engineering 管 Product/BOM，admin/manager 由服务端固定权限表授权。
- 写边界：Session、must-change、权限、Origin/CSRF、256 KiB 正文、每 actor 60 次尝试/20 个新幂等 Key、24 小时幂等、expected version/CAS、行锁/advisory lock、业务/审计/幂等结果同事务。
- Product/BOM 发布后由 PostgreSQL trigger 禁止内容 UPDATE/DELETE；修正通过新版本。映射有效期使用排斥约束禁止同供应商料号身份的 ACTIVE 区间重叠，价格历史只追加。
- `/api/items` 只投影 ACTIVE Material；BOM readiness 不读取库存表、不伪造齐套，固定返回 `inventory_evaluated=false` 与 `all_ready=false`。

## 4. 测试结果

- TASK03 专项：unit 2/2、legacy UI contract 2/2、PostgreSQL/API 3/3、migration upgrade 3/3；typecheck 通过。
- Compose：隔离空库执行 `0001`—`0007`，Customer→Product→Product Release→BOM→Line→结构 readiness→BOM Release→Supplier Mapping→Price HTTP E2E 通过；重启 PostgreSQL/Web 后 Product/BOM/Mapping/Price/Audit 持久，随后清理项目容器、网络与三个卷。
- Node：`npm run lint` 为 0 error/1 个既有 warning；`npm test` 3/3；`npm run typecheck:review`、`npm run build`、`npm run security:credentials`、`npm run test:environment` 通过。
- 既有 unit/UI：Identity、Material、Mapping、Normalization、Review 全部通过。
- 既有 PostgreSQL：Phase 0 5/5、Material 7/7、Mapping 6/6、Normalization 4/4、Review 3/3、Identity 8/8；Mapping/Normalization/Identity 旧 migration upgrade 全部通过。
- Python：项目源码与治理模板共同挂载的一次性 Python 3.11 容器中，`server.py --self-test` 输出 `SELF_TEST_OK`，`smoke_test.py` 输出 `SMOKE_TEST_OK`，临时 SQLite `go_live_check.py --no-backup` 输出 `GO_LIVE_CHECK_OK`。
- `git diff --check`、migration checksum、Schema consistency、package/lock 一致性和凭证扫描均通过。未验证生产容量、真实数据试迁移、生产 HTTPS、生产备份恢复或真实权限配置。

## 5. 生产保护与清理

- 未访问公开 Site、生产 PostgreSQL/D1/SQLite、真实主数据或生产文件；未迁移、备份、恢复、部署、切流或重启生产服务。
- TASK03 创建的 Compose 容器、网络、卷和一次性 Python 容器已清理；最终独立 PostgreSQL 测试容器/网络在提交前清理。
- 未 push、未创建 PR。TASK04 只能在本提交完成、父节点核验正确且工作区 clean 后开始。
