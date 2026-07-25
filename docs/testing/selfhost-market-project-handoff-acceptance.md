# SELFHOST-PHASE4-TASK01 API / UI 验收清单

## 自动化门禁

| 范围 | 验收项 |
| --- | --- |
| Migration | 空库 0001→0015、0014 管理员升级、重复执行、失败回滚、FK/唯一性/状态/索引/服务写守卫 |
| 市场 API | sales 创建、不可变修订、本人可见、提交/重提、提交后编辑拒绝、文件受控引用/删除状态 |
| 项目 API | engineering 有界队列、详情、退回原因、接收、已接收列表、非项目角色拒绝 |
| 一致性 | CSRF、持久幂等重放/异正文冲突、CAS、并发接收一次成功、职责分离、故障注入零半记录 |
| 追踪 | Handoff Event、Audit、request_id、operation/idempotency digest 完整 |
| UI | 页面加载、空状态、安全错误、角色门禁、刷新恢复、退回原因、资料安全元数据、Dashboard 入口 |

专项命令为 `typecheck:project`、`test:project:unit`、`test:project:ui`、`test:project:postgres` 和 `test:project:migration-upgrade`。数据库测试只允许名称包含 `project_test` / `project_upgrade_test` 的隔离 PostgreSQL，并在完成后删除测试数据库。

## 并行环境人工旅程

1. 在 `chenyida-erp-parallel` 的空 PostgreSQL 上确认管理员与 migration 0014 基线，建立 root-only 恢复点。
2. 部署功能提交并只新增 0015；确认 Web healthy、Worker running、管理员不变。
3. 创建两个独立临时账号：sales（市场）和 engineering（项目）。
4. 市场创建项目 A 并提交，项目账号直接接收；验证最终 ACCEPTED。
5. 市场创建项目 B 并提交，项目账号填写原因退回；市场保存新需求版本并重新提交；项目账号最终接收。
6. 重启 Compose，重新登录并确认项目、版本和事件仍存在。
7. 使用 0015 部署后、验收前的 root-only 数据库恢复点清除测试业务和临时账号；保留 0015 Schema 与唯一管理员。
8. 再次确认 health、Worker、管理员、零项目、Python PID/18888 与真实 SQLite metadata 不变。

任何步骤失败都不得切流、迁真实数据或继续 TASK02。

## 2026-07-25 结果

以上自动化门禁与八步并行旅程全部 PASS。两个项目最终 ACCEPTED；重启持久性通过；恢复清理后 15 migrations、唯一管理员保留，临时账号/Customer/Project/Event 为 0。结论仅为 `MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。
