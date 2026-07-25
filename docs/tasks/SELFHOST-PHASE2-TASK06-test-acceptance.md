# SELFHOST-PHASE2-TASK06 测试验收

验收日期：2026-07-25（Asia/Shanghai）

状态：`PASS`（非生产隔离环境）

## 1. 专项验收

| 验收面 | 结果 | 说明 |
| --- | --- | --- |
| Unit / UI contract | PASS | Production unit 2/2、legacy UI contract 2/2；状态、权限矩阵、受保护写边界与稳定成品 Material 选择通过 |
| PostgreSQL / API | PASS | 5/5；BOM 快照、decimal 需求、并发编码/释放/领退料/完工、报工、幂等、权限、客户限制和整体回滚通过 |
| Migration | PASS | 3/3；空库、0009 存量、重复 runner、失败回滚、约束/索引/不可变 guard、旧数据不回填通过 |
| Schema consistency | PASS | Drizzle schema、journal、`0010_snapshot.json` 与 generator 一致；无待生成 schema 差异 |
| Compose E2E | PASS | 空库迁移、WO→领料→报工→完工；PostgreSQL/Web/Worker 重启后快照、业务记录、Ledger 和 Audit 持久；资源已清理 |

## 2. 关键不变量

- RELEASE 在单事务锁定 RELEASED Product/BOM Version，生成不可变快照；之后发布的新 BOM 不影响既有工单。
- PostgreSQL `numeric(24,6)` 按 `round(plan * quantity_per * (1 + loss_rate), 6)` 计算需求；不使用 JavaScript 浮点承担权威计算。
- 领料、退料和完工复用 TASK04 Inventory Service 事务入口；业务、Ledger/Balance、状态、审计和幂等共同提交或整体回滚。
- 超领、超退、错误报工、超产、客户专用料越界、陈旧版本和相同 Key 异正文均 fail closed。
- 已过账领退料、报工、完工、状态事件及 BOM 快照不可更新或删除；不写 `erp_records`，不创建品质或财务过账。
- 并发完工仅一个请求成功，另一个返回 409；故障注入与审计失败后业务、库存、审计和幂等均无部分提交。

## 3. 全量适用回归

| 套件 | 结果 |
| --- | --- |
| Shared unit/UI | PASS，60/60 |
| PostgreSQL/API | PASS，51/51 |
| 旧版本 migration upgrade | PASS，18/18 |
| Import parser/file inspector/adaptive supplier | PASS，53/53 |
| FileStorage / environment guard | PASS，3/3、6/6 |
| TypeScript typecheck | PASS：Normalization、Review、Procurement、Production |
| Lint / build | PASS：0 error、1 条起点既有 warning；Vinext 5/5 |
| Credentials scan | PASS（显式配置容器 Git safe.directory 后执行） |
| Python/SQLite | PASS：`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` |
| `git diff --check` | 提交前 PASS |

## 4. 迁移与资源

- `0010_production.sql` SHA-256：`d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`。
- `0001`—`0009` checksum 保持不变；Material/Mapping 当前迁移清单断言仅推进到合法 `0010`。
- 隔离 PostgreSQL、Compose 容器/网络/卷、临时 SQLite、上传和依赖环境均已清理。
- 未访问生产 PostgreSQL/D1/Site/SQLite，未迁移真实数据，未部署、push 或创建 PR。
