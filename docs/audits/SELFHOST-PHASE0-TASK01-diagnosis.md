# SELFHOST-PHASE0-TASK01 仓库诊断与迁移影响清单

## 诊断范围

已检查根目录与 Site README、项目状态和决策、`.openai/hosting.json`、npm 配置、45 表 Drizzle SQLite schema、`0000`～`0008` D1 migration、D1 数据访问层、R2 上传实现、Parser、Normalizer、Outbox、租约和 Queue Worker、登录/权限/CSRF/审计实现，以及测试启动方式。检查时根仓库 `main` 相对远端 ahead 23，没有用户未提交文件改动；没有修改或访问生产环境。

## 可以直接保留

- React/TypeScript/Vinext 页面、浏览器 API client 和 Material Import Workspace。
- CSV/XLS/XLSX 有界解析、表头识别、字段映射、Normalizer 纯规则和行业 seed。
- Material Validation、Draft、Review、Code、Query 的业务契约、状态机、错误码、职责分离和乐观锁语义。
- 角色/权限矩阵、会话摘要、PBKDF2 密码、CSRF、幂等和审计业务要求。
- `MaterialImportObjectStore`、任务调度器和业务 handler 的接口思路。

这些代码只有在不再导入 D1/R2/Queue 类型且通过 PostgreSQL 集成测试后，才可视为自托管可运行。

## 需要增加适配器

| 边界 | 当前实现 | 自托管适配 |
| --- | --- | --- |
| Database/Repository | D1 `prepare/batch` 与 SQLite SQL | PostgreSQL 连接池、Drizzle/参数化 SQL、显式事务 Repository |
| FileStorage | R2 与内存替身 | 挂载目录、本地原子文件、受控相对路径和元数据 |
| BackgroundJob | Cloudflare Queue + D1 Outbox | PostgreSQL Outbox、任务表、`SKIP LOCKED` claim、租约/心跳 Worker |
| Clock/ID | 分散的 `Date.now()`/UUID | 可注入 UTC Clock 与 UUID ID 生成器 |
| 运行配置 | Worker binding/env | Node `process.env` 的集中解析和 fail-fast 校验 |
| 组合入口 | 单一 Worker fetch/queue 入口 | 独立 Web、Worker、migration 和 admin CLI 入口 |

## 必须重写的 Cloudflare 耦合

- `cloudflare:workers` 的 `env`/`WorkerEntrypoint`/ASSETS binding。
- `drizzle-orm/d1`、`D1Database` 和 D1 `batch()` 原子写调用。
- R2 bucket/object/range adapter 和 Cloudflare Queue producer/consumer。
- `@cloudflare/vite-plugin`、Wrangler、Miniflare state、OpenAI Sites packaging 和 `.openai/hosting.json` 运行路径。
- SQLite/D1 专用 SQL：`json_object/json_extract`、`pragma_table_info`、`sqlite_master`、`INSERT OR IGNORE`、整数布尔值和毫秒整数时间。
- `erp-api.ts` 中启动时 `CREATE TABLE IF NOT EXISTS` 的隐式 schema 管理；自托管环境必须只由版本化 migration 管理。

## 当前测试耦合

- 18 个测试文件直接导入 Miniflare。
- migration/API smoke 使用 Wrangler 启动隔离 D1；3 条基线脚本直接依赖 Wrangler/Miniflare。
- 纯 UI、Parser、Normalizer 和部分服务测试不依赖 Cloudflare，可继续保留。
- 现有测试不能证明 PostgreSQL transaction、唯一约束、`SKIP LOCKED` 并发领取、容器重启持久性或本地文件原子性；本任务必须补充对应测试，不能通过跳过旧断言伪造通过。

## Schema 与迁移影响

- 当前 Drizzle schema 有 45 张表，覆盖用户/会话/审计、遗留业务记录、Material Master、Import/Parser/Mapping/Normalization/Approval/Draft/Version/Alias 等。
- D1 migration 累计约 1,600 行，包含 SQLite 约束与演进历史；不能逐行翻译成 PostgreSQL 后冒充同一历史。
- 自托管采用新的 PostgreSQL `0001` baseline：使用 `uuid`、`timestamptz`、`boolean`、`jsonb`、外键、唯一约束、索引、`version` 和审计字段，并额外建立后台任务表。
- 旧迁移保留在 Cloudflare legacy 区作为后续数据迁移映射来源；真实 SQLite/D1 数据迁移另立任务。

## 主要风险

1. 原 D1 Repository SQL 深度使用 SQLite JSON 和 `batch`，适配层不能只替换驱动；关键写服务需要逐项迁移到显式 PostgreSQL transaction。
2. 历史 legacy API 仍有部分写接口缺少与 Material API 同等级的 CSRF/授权边界，不能因运行时迁移而宣称已消除。
3. Excel Parser 的生产容量此前只在本机 Miniflare/内存替身验证；自托管 Worker 需要新的内存、超时和大文件验收。
4. 本任务建立新空库运行基线，不包含旧 SQLite/D1 数据回填；上线前仍需快照、试迁移、重复/孤儿/金额/库存核对和回退演练。
5. 本地文件与数据库是两个持久化介质；备份必须冻结或协调写入边界，否则可能出现元数据与文件时间点不一致。
