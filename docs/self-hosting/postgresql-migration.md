# PostgreSQL Migration 受控执行说明

> 当前结论：`PRODUCTION NO-GO`。本页定义 UAT/生产迁移的失败关闭合同，不授权连接 UAT/生产、创建快照、执行 Migration、部署或回滚。任何真实执行都必须有独立任务、维护窗口和项目负责人专项授权。

## 数据库基线

`drizzle-postgres/0001_selfhost_baseline.sql`是自托管 PostgreSQL 空库 baseline，共46张表：45张业务/治理表加`background_jobs`。它不是历史 D1 `0000`—`0008`的机械翻译。当前源码 Migration 为`0001`—`0041`，head 是`0041_ai_governance_suggestion_evidence.sql`；运行中的非生产 UAT 仍停留在`0040`。

主业务行使用`bigserial/bigint`保持既有数值 ID API；任务、请求、操作和租约使用 UUID；时间使用`timestamptz`；结构化快照使用 JSONB；数量和金额使用明确精度 numeric；状态、version、唯一性、外键和高频队列查询均有关系约束或索引。

## 禁止旧入口

不得再直接执行以下旧命令：

```text
docker compose -f compose.yml run --rm migrate
```

它可能使用本地 build 定义或非精确镜像，且不能单独证明 release manifest、执行镜像、数据库稳定身份、预期 current head 和可恢复快照一致。

## 执行前必须具备的证据

1. clean、已提交的精确 Git commit/tree，以及与之对应且尚未过期的`ELIGIBLE` release manifest 和 SHA-256；
2. Web/Worker registry digest 引用和各自 Docker image config digest；Migration 必须使用 manifest 中同一个 Worker 镜像；
3. 由该候选完整 release gate 生成的`PASS`报告、镜像级 SBOM 和新鲜漏洞库`PASS`证据；
4. 目标 deployment class/ID、数据库名、`pg_control_system().system_identifier`、database OID、database comment marker 和专用 Migration 登录角色的只读核验；
5. 数据库现有完整 Migration history/checksum，以及人工批准的 expected current head 和 manifest target head；
6. 本次维护窗口前创建、已送达异故障域并完成隔离恢复验证的可恢复快照；
7. 明确的执行人、观察人、停止条件、验证清单和回滚/前向修复路径。

任何一项缺失都不得启动 Migration。应用连接与 Migration 连接必须使用两个独立的 root-only 配置项；凭证只允许来自 root-only env/service 文件，不得写入命令行、聊天、Git、manifest 或日志。

## 专用 Migration 角色合同

`migrate`服务只读取`ERP_MIGRATION_DATABASE_URL`，Web/Worker仍读取`DATABASE_URL`。`ERP_MIGRATION_EXPECTED_ROLE`必须与 Migration URL 的`current_user`和`session_user`完全一致，且该角色必须是目标数据库 owner、可登录，但不得是 superuser，不得有`CREATEROLE`、`CREATEDB`、`REPLICATION`、`BYPASSRLS`或`pg_monitor`，不得继承/可切换到任何其他角色，也不得带 role/database 级 GUC 设置。`public.schema_migrations`也必须由该角色独占所有。

这不等于已经完成真实账号权限改造。现有 UAT 数据库尚未获准变更 owner/对象所有权；真实执行前必须在独立授权任务中设计并核对 Migration owner 与低权限应用角色的`CONNECT`、schema、表、sequence、function 和 default privileges，验证 Web/Worker 无 DDL/提权能力且能完成业务读写。不得临时把应用角色加入 Migration owner 角色来绕过授权，也不得把 superuser URL 填入`ERP_MIGRATION_DATABASE_URL`。

## 受控 Compose 形态

真实执行必须同时加载`compose.yml`和`compose.release.yml`。release overlay 会移除 migrate/web/worker/admin 的 build 定义，只接受精确的`${ERP_WEB_IMAGE}`、`${ERP_WORKER_IMAGE}` registry digest 引用，并把同一 Worker reference 与`${ERP_WORKER_IMAGE_CONFIG_DIGEST}`注入 Migration 进程。执行前必须先用`docker compose config`确认没有`build:`、浮动 tag 或缺失变量。

在专项授权任务中，完成全部前置核验后，受控命令形态为：

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose \
  --env-file <root-only-release-env> \
  -p <exact-project-name> \
  -f compose.yml -f compose.release.yml \
  run --rm --no-deps --pull never migrate
```

尖括号内容必须由当次授权证据生成，不能直接照抄。`--no-deps`防止 Migration 命令顺带创建或替换数据库；`--pull never`防止检查后隐式拉取不同对象。目标 PostgreSQL、Compose 网络和精确 Worker 镜像必须已由同一授权任务预先核验。

受控环境至少包含以下非秘密身份字段：

- `ERP_ENV=production`与`ERP_DEPLOYMENT_CLASS=uat|production`；
- 独立的`DATABASE_URL`、`ERP_MIGRATION_DATABASE_URL`和精确小写`ERP_MIGRATION_EXPECTED_ROLE`；
- `ERP_ALLOW_PRODUCTION_MIGRATION=YES`和`ERP_MIGRATION_CONFIRM=MIGRATE_EXACT_RELEASE_MANIFEST`；
- manifest绝对只读路径及`ERP_RELEASE_MANIFEST_SHA256`；
- 精确 deployment/database/system identifier/OID/comment marker；
- `ERP_MIGRATION_EXPECTED_CURRENT_HEAD`与 manifest target head；
- manifest version/full Git SHA；
- Worker registry digest reference和 image config digest。

## 失败关闭与事务语义

- UAT/PRODUCTION 只接受 manifest 的完整有序 allowlist；目录新增、缺失、重排或逐文件 checksum 漂移会在业务 SQL 前拒绝。
- `EMPTY`只允许完全不存在`public.schema_migrations`且 public schema 没有未跟踪 relation、function、用户 type/domain/enum/range、collation、operator/opclass/opfamily、conversion、text-search 对象或 extension；预建空 history 表不能冒充空库。
- 已有 history 必须是专用角色所有、永久且非分区的固定三列表，列/表无 ACL，`version`为唯一有效主键，`applied_at`只能使用无副作用的`now()`默认值，并且无用户 rule/trigger、无 RLS；任一结构或权限漂移都会拒绝。
- 工具在 advisory lock 前后复核目标身份和 history。每个 migration 与 history 写入使用同一事务；第一条失败时连 history 表创建一起回滚，已执行文件 checksum 不符时拒绝。
- 已过账业务数据不得通过 Migration 原地改写；需要更正时使用扩展、回填、切换、收缩和业务调整/冲销流程。

## 执行后与失败处置

成功后必须核对目标 head、全部 checksum、表/记录数、孤儿引用、库存和关键金额，再核对 Web/Worker实际容器、镜像、健康、restart/OOM和 runtime identity。任何不一致都停止晋升，不继续启动 Web/Worker。

失败时保留 manifest、门禁报告、快照和安全错误码；不要修改既有 Migration、手工补 history 行、删除持久卷或把失败断言改成通过。DDL已提交的历史升级通常不能依赖数据库原地“降级”；按批准的快照恢复或新建前向修复 Migration 执行。旧 SQLite/D1 数据迁移仍须独立按扩展、回填、切换、收缩和逐行核对实施。
