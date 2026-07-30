# SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02 完成报告

结论：`OPERATIONS MATERIAL REVIEW QUEUE FIXED — UAT APPROVAL NOT EXECUTED`

日期：2026-07-30（Asia/Shanghai）

## 1. Git 与版本边界

| 项目 | 结果 |
| --- | --- |
| 起始 Branch / HEAD | `main` / `78701d16dcea6b4ae5a2ff73d138c8ec838c8498` |
| 起始 Parent | `0959b6374ef83ab9decae403624891ac3516cc99` |
| 起始同步/工作区 | `origin/main...HEAD = behind 0 / ahead 92`；tracked/untracked clean；`shujvbiao/` 被忽略且未读取、修改或提交 |
| 功能提交 | `54f648051a8454b022a6f12c41fe3f1558875a7c`，Parent `78701d16dcea6b4ae5a2ff73d138c8ec838c8498`，`fix: authorize operations material review queue` |
| 验收提交 | 本报告所在的 `ops: accept operations material review queue fix`，Parent `54f648051a8454b022a6f12c41fe3f1558875a7c`；自身 SHA 无法稳定写入自身内容，以 `git log` 和最终交付消息为准 |
| 源码版本 | `chenyida-erp-selfhosted@0.1.0-alpha.35`，migration head `0035_bom_material_governance.sql` |
| 运行版本 | `0.1.0-alpha.34` / 34 migrations / `0034_supplier_receipt_lot_iqc.sql` |
| 0035 checksum | `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`，保持不变且未在常驻库运行 |

没有 amend、rebase、reset、stash、restore、checkout、merge、push 或 PR。开始、文档阅读后、首次编辑前及后续关键门禁均检查 Git；没有出现未知并发修改或其他 Codex 写流。

## 2. 权限差异与实现范围

`operations` 只增加：

- `material.review.queue`
- `material.review.approve`
- `material.review.reject`

明确没有新增：

- `material.draft.edit_any` 或工程物料正文代编辑能力
- admin、用户/角色管理或 `system.audit.read`
- BOM、采购、库存、生产、销售、品质或财务写权限

其他角色映射没有改动。Repository 既有行级边界只在记录为 `PENDING_REVIEW` 且 actor 具有 queue 权限时允许跨创建人读取；engineering 仍可读取自己的记录，但创建人/最后修改人不能批准或退回。无关角色继续由服务端返回 403、稳定错误码、中文提示和请求编号。

批准/退回没有新建旁路，继续复用既有：正式编码生成、退回原因必填、Idempotency-Key+canonical request digest、异正文 409、expected version/CAS、advisory identity lock/行锁、并发唯一成功、单事务 Material/Version/Change/Audit/幂等响应和故障回滚。

UI 同步完成：

- 原生队列 total、筛选、列表、详情和按钮统一用 `material.review.queue` 与 `PENDING_REVIEW`。
- 审核正文保持只读；operations 没有编辑表单或 edit-any API 能力。
- legacy“清洗审核”明确为退役导入清洗入口，链接原生 `/materials/review` 和 `/materials/imports`，没有复活 Cleaning Rows 队列。
- 兼容 Dashboard 的 `pending` 明确显示为“全局待处理（DRAFT + PENDING_REVIEW）”，不再与角色审核明细混淆。

## 3. 修改文件

运行代码与合同：

- `chenyida_erp_site/app/lib/identity-selfhost/permissions.ts`
- `chenyida_erp_site/app/lib/dashboard-selfhost/service.ts`
- `chenyida_erp_site/app/_components/erp-workbench.tsx`
- `chenyida_erp_site/public/erp/index.html`
- `chenyida_erp_site/public/erp/app.js`
- `chenyida_erp_site/public/erp/api-client.d.ts`
- `chenyida_erp_site/db/schema.ts`（只规范化既有 partial-index predicate 空白，使 Drizzle 一致性输出为 no schema changes；无 Schema/Migration 行为变化）

测试：

- `chenyida_erp_site/tests/selfhost-operations-material-review-postgres.test.mjs`
- `chenyida_erp_site/tests/selfhost-identity-unit.test.mjs`
- `chenyida_erp_site/tests/material-review-ui.test.mjs`
- `chenyida_erp_site/tests/selfhost-dashboard-ui-contract.test.mjs`
- `chenyida_erp_site/tests/selfhost-mapping-postgres.test.mjs`（测试 migration 清单从过时的 0019 对齐到当前 0035）

任务与权威文档：

- `docs/tasks/SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02.md`
- `docs/tasks/SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02-COMPLETION.md`
- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/project/CHANGELOG.md`
- `docs/project/STATUS.md`
- `docs/self-hosting/identity-security.md`
- `docs/self-hosting/dashboard-metrics.md`
- `docs/material-master/material-review-ui-v1.md`

没有修改 Python 运行面、依赖、Compose、0001—0035 migration 或正式工作簿。

## 4. 自动测试

所有写测试使用隔离 PostgreSQL 和合成记录，未对主库 533—536 执行写请求。重任务严格串行，一次只有一个临时容器。

| 测试组 | 结果 |
| --- | --- |
| Material Review UI | 52/52 PASS |
| Identity unit | 9/9 PASS |
| Dashboard UI contract | 5/5 PASS |
| Identity、Material、Import、Normalization、Review、BOM Governance、Dashboard 适用非数据库回归 | 275 PASS |
| operations 审核隔离 PostgreSQL | 4/4 PASS |
| Identity 隔离 PostgreSQL | 10/10 PASS |
| Material 隔离 PostgreSQL | 7/7 PASS |
| Normalization 隔离 PostgreSQL | 5/5 PASS |
| Import Review 隔离 PostgreSQL | 4/4 PASS |
| BOM Governance 隔离 PostgreSQL | 16/16 PASS |
| Mapping 隔离 PostgreSQL（fresh 0035） | 6/6 PASS |
| typecheck（Review/Dashboard/Governance 等适用入口） | PASS |
| Schema consistency | `No schema changes, nothing to migrate` |
| ESLint | 0 error；8 个既有 warning |
| alpha.35 Vinext build | PASS |
| credentials scan | PASS，最终 1,077 files（功能提交前 1,076；新增本完成报告后复扫） |
| `git diff --check` | PASS |
| Python `server.py --self-test` | PASS（仓库 `.venv`） |
| Python `smoke_test.py` | PASS（仓库 `.venv`） |
| 临时 SQLite `go_live_check.py --no-backup` | PASS，临时库已清理 |

专项断言实际覆盖 operations 三项精确增量/禁止权限、跨创建人列表与详情、自审拒绝、无关角色 403、正文编辑拒绝、稳定正式编码、退回原因、幂等重放和异正文冲突、expected version、并发唯一成功、故障注入零半记录，以及审计 actor/object/result/request ID/time。

测试过程发现并修正两个测试合同问题：Mapping runner 的 migration 清单停留在 0019，而当前源码实际依赖 0035 列；Dashboard typecheck 暴露共享 `api-client.d.ts` 缺少已存在 logout 函数声明。没有降低断言、跳过失败或更改业务边界。系统 Python 首次 smoke 在执行用例前因缺 `openpyxl` 停止，随后使用项目规定 `.venv` 完整通过。

## 5. 备份与隔离恢复

部署前备份：

- 路径：`/var/backups/chenyida-erp/SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02/postgresql-20260730T054141Z.dump`
- 权限：`0600 root:root`
- 大小：2,013,262 bytes
- SHA-256：`afe2cc5aa68940c1cf303317d4936d20814f2d2cfc36a55b48709d6b489dee15`
- `pg_restore --list`：3,050 entries、426 table entries、213 table-data entries

备份实际恢复到独立数据库 `ops_review_test_restore_20260730_054141`。恢复后 migration 34/head 0034、Material 536、User 14、Audit 1,074，受保护四条摘要与主库一致；alpha.34 candidate smoke 只在该恢复库创建/处理合成身份或会话，不批准、退回或编辑受保护物料。恢复库最终已删除。

## 6. alpha.34/0034 兼容 hotfix 与部署

构建基线为已部署兼容 Web 的 alpha.34 源码提交 `cda8c7eebf93d1ba3b558a700b535dbf00fd92b2`，package 为 `0.1.0-alpha.34`、migration 仅到 0034、无 0035。Hotfix 只移植：

- 当前运行面已有的 trusted Origin 修复（`424fc51`）与 UAT CSRF/logout 修复（`dfa30bf`）
- 本任务 permissions、Dashboard/Workbench、legacy 提示/cache marker 和共享 logout 类型声明

没有移植 alpha.35 Governance、0035、Schema 变化或其他业务逻辑。alpha.34 contract、build 和对隔离 0034 恢复库的 API smoke 全部通过：operations 权限精确为预期三项增量，queue total 4/IDs 533—536，详情四条一致，review route/legacy 退役/logout/旧 Session 撤销均通过，保护动作点击数 0。

| 项目 | 结果 |
| --- | --- |
| 当前 Web 镜像 | `sha256:f31199de3b8aea025c317b7d67aa26b42a60e037eca7ea7a20f7533dd2e6af38`，88,327,355 bytes |
| 回滚镜像 | `chenyida-erp-parallel-web:rollback-ops-review-20260730T055329Z` → `sha256:273aa687e74184d748bfa375826f30ccfd2252c3843d9e59fb2781e4a849fd28` |
| 部署动作 | 只以 `--no-deps --no-build --force-recreate --wait` 替换 Web |
| PostgreSQL | 容器 ID `f3a2f3cb32f4...` 未变，healthy，restart 0，OOM false |
| Web | 容器 ID `bd4b5c6ba7ac...`，healthy，restart 0，OOM false，只绑定 `127.0.0.1:3000` |
| Worker | 容器 ID `fb68d9a81b87...` 未变，running，restart 0，OOM false |
| Caddy | 容器 ID `eb76b252363b...` 未变，running，restart 0，OOM false |
| API | `/api/health` PASS；部署后 Web log 无 500/uncaught/internal error |
| 数据库 | 仍为 34 migrations/head 0034；没有运行 0035，不重建或重启 PostgreSQL |

四个受保护 Volume 均为 local driver，创建时间保持 `2026-07-25T21:05:58+08:00`：

- `chenyida-erp-parallel_erp_postgres`
- `chenyida-erp-parallel_erp_uploads`
- `chenyida-erp-parallel_erp_attachments`
- `chenyida-erp-parallel_erp_backup_status`

## 7. operations 浏览器只读验收

真实 headless Chromium 仅使用 `uat_20260729_operations` 和回环地址 `http://127.0.0.1:3000`：

| 检查 | 结果 |
| --- | --- |
| 登录 | PASS；没有修改账号或凭据文件 |
| 原生物料/导入/审核 | PASS |
| keyword `042576` | queue total 4、rows 4、visible IDs 533/534/535/536 |
| 列表/详情 | 4/4 可见、4/4 详情可打开；V2、PENDING_REVIEW、MANUAL、PCS、空正式编码一致 |
| 动作入口 | 批准按钮存在；退回按钮存在；点击次数 0 |
| 正文编辑 | 编辑控件 0；无代编辑能力 |
| legacy | 明确显示旧清洗入口已退役，不冒充人工审核 |
| Dashboard | 明确显示全局 DRAFT+PENDING_REVIEW 口径 |
| 退出 | PASS；旧 Session 返回 `SESSION_REVOKED` |

唯一非业务浏览器告警是既有 `/favicon.ico` 404。没有登录 engineering、planning 或其他角色，没有创建产品/BOM，也没有点击批准或退回。

## 8. 533—536 最终不变证据

| ID | 名称 | 状态 | 版本 | 来源 | 单位 | 正式编码 |
| ---: | --- | --- | ---: | --- | --- | --- |
| 533 | `UAT-BB-MAT-PCBA-042576 · UAT控制板组件` | PENDING_REVIEW | 2 (V2) | MANUAL | PCS | 空 |
| 534 | `UAT-BB-MAT-SENSOR-042576 · UAT温湿度传感器` | PENDING_REVIEW | 2 (V2) | MANUAL | PCS | 空 |
| 535 | `UAT-BB-MAT-HARNESS-042576 · UAT 12V测试线束` | PENDING_REVIEW | 2 (V2) | MANUAL | PCS | 空 |
| 536 | `UAT-BB-MAT-CASE-042576 · UAT测试外壳` | PENDING_REVIEW | 2 (V2) | MANUAL | PCS | 空 |

只读 SQL 最终证据：四条记录数 4；保护摘要 `4257bd3bb5a742f661ffb87179c468d6` 与部署/浏览器前一致；`material_versions` APPROVE/REJECT 0，`material_change_logs` APPROVE/REJECT 0，`audit_log` material approve/reject 0。没有正式内部编码生成。

## 9. 安全事件

本任务有两项仅限当前授权会话的意外输出：

1. 对 UAT 账号文件做脱敏展示时，脚本未识别中文全角冒号，导致文件内容显示在工具输出中。
2. 首次清理遗留浏览器 Session 时，非法 revoke reason 触发数据库约束错误，错误上下文显示了一个 Session 摘要。

两者都只显示给本次授权用户；没有写入 Git、任务文档、文件、服务日志或任何外部系统，本报告不复述具体值。凭据文件没有被修改。首次清理事务因约束完整回滚，没有半记录；随后以合法 `LOGOUT` reason 在单事务中准确撤销唯一遗留任务 Session，并写 `UAT_BROWSER_SESSION_CLEANUP/success` 审计，任务浏览器有效 Session 最终为 0。

由于凭据材料已经在会话中显露，建议在开始独立 operations 黑盒审核试用前，另立受控任务轮换该 UAT 账号凭据。此建议不影响“审核队列修复完成”的技术结论，但当前不建议继续使用已显露凭据进行下一轮试用。

## 10. 资源、清理与最终边界

- 起点约 2.3 GiB available、Swap 47 MiB、根盘可用 33 GiB，Load 低；四服务 restart 0/OOM false。
- 最终采样为 MemAvailable 2,307,512 KiB、Swap used 66,456 KiB、根盘可用 32,558,100,480 bytes（`df -h` 31 GiB）、Load `0.16/0.42/0.47`；112 秒观察窗口 Swap used 保持 66,456 KiB、增长 0。没有触发 available <768 MiB、Swap >80%、根盘 <10 GiB 或持续高 Load 门禁。
- 任务时段内核 OOM 记录 0；四服务最终 restart 0、OOM false。
- 已删除所有任务测试数据库、隔离恢复库、临时 SQLite、临时容器、浏览器/测试 runner、alpha.34 build worktree、临时候选 tag 和 alpha.35 buildcheck image；`git worktree list` 最终只有 `/opt/erp`。
- 明确保留：root-only PostgreSQL 备份、当前 Web 镜像和单一命名回滚镜像。没有执行 `docker system prune -a`、`docker volume prune`，没有删除四个 ERP 持久卷。
- 未操作 Python systemd、D1/Sites、真实数据迁移或 0035；未启动后续任务。

## 11. 是否可开始独立 operations 审核试用

权限、API、UI、alpha.34/0034 兼容性和保护记录边界均已通过，可以作为独立黑盒审核试用的功能基线。但鉴于第 9 节的会话内凭据显露，应先经单独授权轮换 `uat_20260729_operations` 凭据，再由下一轮独立试用实际批准/退回合成或明确授权的记录；本任务不执行该轮换，也不执行任何审批。

完成后立即停止。
