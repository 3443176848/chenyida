# SELFHOST-PHASE0-TASK01 自托管运行基线

## 任务目标

在不新增采购、仓库、财务、生产等业务模块的前提下，把 `chenyida_erp_site` 的未来生产运行面改为可在用户自有 Linux 服务器恢复的标准 Node.js、PostgreSQL、本地文件和独立 Worker 架构。完成物包括 PostgreSQL `0001` 基线、基础设施边界、Docker Compose、Caddy production profile、备份恢复和隔离验收。

## 已确认范围

- Web：标准 Node.js 服务，继续使用现有 React/TypeScript/Vinext 页面。
- 数据库：PostgreSQL；ORM 继续使用 Drizzle PostgreSQL dialect。
- 文件：挂载到容器外的本地持久化目录，数据库只保存元数据和相对路径。
- 后台任务：PostgreSQL Outbox 和任务表，独立 Worker 使用租约、心跳、重试、CAS 和 `FOR UPDATE SKIP LOCKED`。
- 部署：Docker Compose；生产 HTTPS 入口优先 Caddy。
- 兼容：保留现有物料分类、草稿、审批、版本、审计、导入、解析和规范化的业务语义与前端路径；旧 D1/Cloudflare 与 Python/SQLite 代码只作历史和迁移参考。

## 明确排除

- 不新增市场订单、项目、BOM、计划/MRP、采购、仓库、财务、生产或品质功能。
- 不连接或修改正式数据库，不执行真实数据迁移。
- 不部署公网，不修改真实服务器。
- 不引入 Redis，不预置管理员密码。
- 不提交、不推送、不创建 PR。

## 实施顺序

1. 记录仓库诊断、迁移影响清单和架构决定。
2. 建立 Database/Repository、FileStorage、BackgroundJob、Clock/ID 边界以及 Web/Worker 独立组合入口。
3. 建立 PostgreSQL Drizzle schema 与新的 `0001` 基线迁移，覆盖现有 45 张业务表和自托管任务表。
4. 实现安全本地文件适配器：随机存储名、路径约束、SHA-256、MIME、大小、原子写、受控读取和删除。
5. 实现 PostgreSQL Outbox/任务领取、租约、心跳、重试、超时恢复、幂等和安全停机。
6. 接通管理员初始化/登录、权限/审计、分类读取、草稿创建/查询、上传和后台任务最小验收链路。
7. 建立 Web/Worker/PostgreSQL/Caddy Compose、迁移/管理员 CLI、健康检查、数据卷和重启策略。
8. 增加单元、PostgreSQL 集成和 Compose 冒烟测试；更新开发、部署、环境变量、迁移、备份恢复和完成报告文档。

## 验收标准

- 一组文档化命令可在安装 Docker/Compose 的 Linux 主机启动 Web、Worker 和 PostgreSQL。
- 运行时不依赖 OpenAI Site 或 Cloudflare Worker/D1/R2/Queue。
- 管理员初始化和登录可用，权限与审计可核验。
- 分类可读，物料草稿可创建和查询。
- 文件上传后存在持久卷，重启不丢失，且没有二进制写入 PostgreSQL。
- Web 可提交解析/规范化后台任务，多个 Worker 不重复领取，完成/失败/重试状态可追踪。
- PostgreSQL 数据、文件和未完成/已完成任务在服务重启后仍然存在。
- 测试只使用隔离数据库，任何脚本都拒绝生产标识或非显式恢复目标。

## 当前状态

`DONE（未提交）`。自托管基线、隔离测试和 Compose 重启持久性验收已完成；根据项目负责人明确要求没有创建 Git commit。未执行生产访问、部署或真实数据迁移。完整旧 API、审批写 Repository 和行级 Normalizer 的 PostgreSQL 移植范围记录在完成报告，需后续独立任务。
