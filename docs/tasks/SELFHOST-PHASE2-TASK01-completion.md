# SELFHOST-PHASE2-TASK01 完成报告

日期：2026-07-24（Asia/Shanghai）

状态：`DONE`（仅 API 盘点与迁移规划）

结论：已从源码完成 Python/SQLite 完整 ERP 的 64 个 HTTP 操作盘点，逐项对照页面调用、权限、校验、表、事务、联动、审计、过账影响、自托管覆盖和 PostgreSQL 结构，并形成九个待逐项授权的迁移候选任务。本任务没有实现任何业务 API，也不表示任一新增业务域已经迁移。

## 1. Git 基线与提交

- Branch：`main`。
- 起始 HEAD：`12d3ea30d21cce6918de0c525d81f19af289f5ac`。
- 起始工作区：clean。
- 起始分支关系：本地 `main` 领先 `origin/main` 1 个提交。
- 任务提交信息：`docs: plan full erp api migration`。
- 任务提交哈希：本文件不能自引用写入自身提交哈希；以 `git log -1 --format=%H -- docs/tasks/SELFHOST-PHASE2-TASK01-completion.md` 的结果为准。
- 未 push、未创建 PR、未 reset、clean、rebase 或强制推送。

## 2. 修改文件

新增：

- `docs/tasks/SELFHOST-PHASE2-TASK01.md`
- `docs/audits/SELFHOST-PHASE2-TASK01-api-inventory.md`
- `docs/self-hosting/full-erp-api-migration-plan.md`
- `docs/tasks/SELFHOST-PHASE2-TASK01-completion.md`

更新：

- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/project/ARCHITECTURE.md`
- `docs/project/ROADMAP.md`
- `docs/project/CHANGELOG.md`
- `docs/project/STATUS.md`

最终差异只允许以上 11 个 `docs/` 文件。没有修改 Python、TypeScript、React、浏览器业务代码、`db/schema.ts`、migration、依赖、Compose、Dockerfile、systemd 或 Sites 配置。

## 3. API 统计

Python `AppHandler` 共 64 个 HTTP 操作：GET 34、POST 30。

| 业务域 | 接口数 |
| --- | ---: |
| 身份与系统管理 | 11 |
| 基础主数据、工程与物料治理 | 22 |
| 采购与库存 | 9 |
| 生产 | 6 |
| 销售 | 7 |
| 品质 | 3 |
| 财务 | 6 |
| 合计 | 64 |

按“当前自托管是否具有等价能力”统计：

| 覆盖状态 | 接口数 | 说明 |
| --- | ---: | --- |
| 已覆盖 | 4 | health、session、login、logout |
| 部分覆盖 | 9 | 3 个备份操作仅有自托管 CLI/运维能力；6 个物料、导入、复核操作有新语义能力，但 legacy method/path 不兼容 |
| 未覆盖 | 51 | 当前没有等价服务层与 API |
| 合计 | 64 | “部分覆盖”不能描述为 legacy API 可用 |

逐接口证据见 `docs/audits/SELFHOST-PHASE2-TASK01-api-inventory.md`。表结构存在只说明未来迁移落点或占位结构，不构成 API、权限、事务或测试已经完成的证据。

## 4. 首页断链结论

- 根页面仍通过 iframe 加载 `/erp/index.html`。
- legacy 页面登录后执行 `refreshAll()`，以一个 `Promise.all` 并发请求 23 个业务 GET。
- 这 23 个 path 全部没有进入 `selfhost-api.ts` 的现有路由，因此在 Node/PostgreSQL 环境返回 404；任一失败会使整批刷新 reject。
- 用户管理页面另外调用的 `management-dashboard`、`backups`、`users` 也没有等价路由。
- 当前系统只能描述为“自托管 Material/Import/Normalization/Review 开发基线”，不能描述为“完整 ERP”。

本任务只记录事实和影响，没有修改 iframe、页面或 API。

## 5. 数据关系与业务不变量

已记录的关键不变量包括：

1. 所有下游引用必须迁移到稳定内部 ID；业务编码用于展示和唯一业务约束，名称、供应商料号、客户料号只能作为映射或别名。
2. Product、BOM、BOM Line、Material 必须形成显式外键关系；BOM 行不得继续以自由名称或松散 JSON 作为权威引用。
3. 采购订单明细、收货、库存流水、库存余额、应付联动必须可追溯且在一致事务边界内完成。
4. 工单由 BOM 固化用料需求；领料扣减原料库存，完工增加成品库存并更新工单，不得产生部分过账。
5. 发货扣减成品库存并更新销售订单履行状态；报价、销售订单、应收必须保持来源链。
6. 品质记录必须引用明确的采购收货、工单/报工或发货对象，缺陷、处置和关闭应有受控状态机。
7. 收款/付款只能追加并分配到应收/应付；未结余额由原额、已分配额和冲销/调整推导。
8. 已过账的收货、领料、完工、发货、库存调整、收付款和财务单据不得原地改写；更正必须使用调整、冲销或反向记录。
9. 关键写接口需要稳定 request id、持久幂等键、正文摘要、乐观锁或行锁，以及与业务变化同事务的审计记录。

## 6. 高风险事务

| 操作 | 必须原子完成的联动 | 当前重点风险 |
| --- | --- | --- |
| 采购收货 | 收货记录、PO 行累计/状态、库存流水、库存余额、应付/来源、审计 | 重复提交会重复入库和挂账 |
| 库存调整 | 调整单、正反库存流水、余额、原因和审计 | 已过账记录不可覆盖；需 reversal |
| 工单领料 | 领料记录、用料累计、原料库存流水/余额、工单版本、审计 | 超领、负库存、并发余额冲突 |
| 工单完工 | 完工/报工、成品库存流水/余额、工单完成量/状态、审计 | 重复完工和部分写入 |
| 销售发货 | 发货记录、SO 行履行/状态、成品库存流水/余额、应收来源、审计 | 重复发货、超发、库存与应收分裂 |
| 报价转销售订单 | 新 SO 与行、报价转换状态/来源、版本和审计 | Python 当前分两次提交，可能只生成 SO 未更新报价 |
| 收款/付款 | Payment、分配、应收/应付未结状态、审计 | 超额分配、重复支付、余额漂移 |
| 用户重置/停用 | 凭证或状态、全部会话撤销、安全审计 | 当前 Python API 缺失，legacy 页面调用断链 |

## 7. 推荐迁移顺序

下列均为建议，不是已批准实施任务：

1. `SELFHOST-PHASE2-TASK02`：身份、用户管理、密码、会话撤销和系统审计。
2. `SELFHOST-PHASE2-TASK03`：客户、供应商、产品、BOM 和供应商物料映射。
3. `SELFHOST-PHASE2-TASK04`：不可变库存流水、余额和调整基础。
4. `SELFHOST-PHASE2-TASK05`：采购订单、明细、收货及库存联动。
5. `SELFHOST-PHASE2-TASK06`：工单、BOM 转工单、领料、完工和生产报工。
6. `SELFHOST-PHASE2-TASK07`：询价/报价、销售订单、报价转换、发货及库存联动。
7. `SELFHOST-PHASE2-TASK08`：IQC、IPQC、FQC、检验、缺陷、处置和关闭。
8. `SELFHOST-PHASE2-TASK09`：应收、应付、收款、付款、分配和未结汇总。
9. `SELFHOST-PHASE2-TASK10`：经营看板、备份恢复治理和 legacy iframe 退出。

先独立建立库存账本，再接入采购、生产、销售三个库存写入域，可以让每个后续阶段复用同一不可变过账边界，并独立验收与回滚。完整任务边界、依赖、Schema/API、职责分离、事务、测试、禁止事项、验收和生产授权要求见 `docs/self-hosting/full-erp-api-migration-plan.md`。

下一条最小实施任务建议为 `SELFHOST-PHASE2-TASK02`。它只应补齐身份、用户生命周期、密码、会话撤销和系统审计；不得顺带实施主数据或业务单据。

## 8. 验证结果

Node 命令因宿主机没有 Node/npm，在一次性 `node:22-bookworm` 容器内运行；没有启动长期 Compose 项目。

| 验证 | 结果 |
| --- | --- |
| `npm run lint` | PASS；0 error，1 个任务前既有 `build_material_workbook.mjs` unused warning |
| `npm test` | PASS；selfhost file storage 3/3 |
| `npm run typecheck:review` | PASS |
| `npm run build` | PASS；Vinext 5/5，standalone 完成 |
| `npm run security:credentials` | PASS |
| `server.py --self-test` | PASS；`SELF_TEST_OK` |
| `smoke_test.py` | PASS；`SMOKE_TEST_OK` |
| 临时 SQLite `go_live_check.py --no-backup` | PASS；`GO_LIVE_CHECK_OK` |
| `git diff --check` | PASS |
| 最终变更范围检查 | PASS；只包含文档 |

Python 验证使用项目虚拟环境和独立临时 SQLite/数据目录；临时记录不是业务数据并已清理。go-live 只检查现有本地开发服务健康状态，没有重启服务。

## 9. 未验证范围

- 没有在运行中的 Node Web 上逐个请求 23 个 legacy API；404 结论来自根页面、legacy 调用代码和 `selfhost-api.ts` 路由的静态逐项对照。
- 没有启动 Compose、PostgreSQL 或 Worker，也没有运行 migration/业务域集成测试；本任务禁止实现或执行 migration。
- 没有运行或修复完整 legacy npm 测试，也没有处理依赖审计项、弱口令、公网绑定或 HTTPS。
- 没有查询 SQLite、D1 或 PostgreSQL 的业务记录正文，没有使用真实客户、供应商、物料、库存、订单或金额样本。
- 没有执行容量、并发、恢复演练、渗透测试、生产部署或真实数据试迁移。

这些范围必须在对应候选任务获项目负责人单独授权后验证，不能由本报告推断为通过。

## 10. 生产与外部动作

- 公开生产 Site：未访问。
- 生产 D1：未访问。
- 生产 PostgreSQL/其他生产数据库：未访问。
- 真实业务数据：未读取、迁移或输出。
- migration：未新增、修改或执行。
- Python 服务：未重启。
- Compose：未启动长期项目。
- 部署、push、PR：均未执行。

## 11. 最终状态判定

`SELFHOST-PHASE2-TASK01` 可标记为 `DONE`，含义仅为 API 清单、关系/不变量、断链诊断和分阶段计划已经完成。`TASK02`—`TASK10` 均保持“建议、待授权”，任何业务域都没有因本任务转为已迁移或已批准。
