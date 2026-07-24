# SELFHOST-PHASE2-TASK01：完整 ERP 业务 API 盘点与分阶段自托管迁移计划

状态：`DONE`（仅诊断与设计）

日期：2026-07-24（Asia/Shanghai）

负责人：Codex（源码审计、迁移设计、文档与验证），项目负责人（任务范围与禁止事项确认）

## 1. 任务目的

以当前 Python/SQLite 完整 ERP 为行为基线，逐项盘点 HTTP API、legacy 页面调用、权限、输入校验、数据关系、事务、联动、审计和过账影响，并与 Node/PostgreSQL 自托管实现逐项对照，形成后续“一次只迁移一个业务域”的可执行顺序。

本任务的 `DONE` 只表示盘点和迁移规划完成，不表示客户、供应商、产品、BOM、采购、库存、生产、销售、品质、财务、系统管理或 legacy 页面已经迁移。

## 2. 起始基线

- Branch：`main`。
- 起始 HEAD：`12d3ea30d21cce6918de0c525d81f19af289f5ac`。
- 起始工作区：clean；本地 `main` 领先 `origin/main` 1 个提交。
- 自托管包：`chenyida-erp-selfhosted@0.1.0-alpha.1`，非生产、尚未发布。
- PostgreSQL migration：`0001`—`0005`，没有新增或执行 migration。
- Python/SQLite：仍是完整 ERP 的实际常驻开发运行面和行为参照。
- Node/PostgreSQL：只完成 Material、Import Mapping、Normalization 与人工 Review；存在表结构不代表业务 API 已迁移。

## 3. 范围

只读检查：

- `chenyida_erp_app/server.py`、`chenyida_erp_app/static/app.js`；
- `chenyida_erp_site/public/erp/app.js`、根 iframe、`selfhost-api.ts`；
- `app/lib/*-selfhost/`、Worker、权限、测试和 Compose；
- `db/schema.ts` 与 PostgreSQL `0001`—`0005`；
- 项目权威文档与 SELFHOST Phase 1 Task01—04 完成报告。

交付：

- 64 个 Python HTTP 操作的逐项清单和领域统计；
- 数据关系、业务不变量与高风险事务清单；
- 自托管首页 legacy iframe 断链结论；
- `SELFHOST-PHASE2-TASK02`—`TASK10` 的建议迁移顺序和独立验收边界。

## 4. 明确排除

- 不实现、修改或兼容任何业务 API、页面或 Worker 业务逻辑。
- 不修改 Schema、migration、依赖、Compose、Dockerfile、systemd 或 Sites 配置。
- 不读取业务数据库正文，不接触真实客户、供应商、物料、库存、订单或金额记录。
- 不访问公开 Site、生产 D1、生产 PostgreSQL 或任何生产 URL。
- 不启动长期 Compose，不重启 Python 服务，不部署，不迁移真实数据。
- 不修复 legacy 测试、弱口令、公网绑定、HTTPS 或依赖漏洞。
- 不 push、不创建 PR、不重写 Git 历史。

## 5. 验收标准

1. Python API 总数、HTTP method/path 和领域统计可从源码复核。
2. 每个接口记录页面调用、权限、输入/校验、读写表、事务、联动、审计、库存/金额/过账影响、自托管覆盖、PostgreSQL 结构、缺口、风险和依赖。
3. 稳定 ID、业务编码、BOM、库存、生产、销售、品质和财务不变量有明确清单。
4. 根 iframe、登录后 23 个并发请求、自托管实际路由和 404 影响有明确结论。
5. 后续候选任务均标为建议、待单独授权，并具有依赖、范围、migration、API、权限、事务、测试、禁止事项和验收标准。
6. 最终 diff 只包含文档；规定的 Node、Python 和 Git 检查通过或如实记录未验证范围。
7. `TASKS.md` 将本任务标记为 `DONE`，并创建一个独立本地提交；不推送。

## 6. 权威输出

- API 审计：`docs/audits/SELFHOST-PHASE2-TASK01-api-inventory.md`
- 分阶段计划：`docs/self-hosting/full-erp-api-migration-plan.md`
- 完成报告：`docs/tasks/SELFHOST-PHASE2-TASK01-completion.md`
