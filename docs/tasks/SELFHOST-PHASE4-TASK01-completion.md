# SELFHOST-PHASE4-TASK01 完成报告

状态：`DONE / ACCEPTED IN PARALLEL ENVIRONMENT`

可信起点：`main@0f15f271cc458343116cb6639f0d118eea37521b`，功能提交父提交必须保持该值。

## 已实现

- `0.1.0-alpha.15` 与 expand-only PostgreSQL `0015_market_project_handoff.sql`。
- 六表关系模型、数据库约束/索引/不可变与 ProjectService 写守卫。
- 独立 `project-selfhost` 边界及 10 条最小 API；复用 Identity、Customer、受控文件、Audit、Idempotency 和共享请求边界。
- sales 市场草稿/修订/提交与 engineering 队列/接收/退回；不可变需求版本和 Handoff Event。
- `/business/projects`、`/engineering/projects` 与 Dashboard 两个部门入口。

## 本地与隔离结果

- Project unit/UI：7/7；Project PostgreSQL/API：3/3；Migration upgrade：3/3。
- 空库 0001→0015、0014→0015 管理员保留、重复执行、失败回滚通过。
- 幂等重放/冲突、CSRF、CAS、并发接收一次成功、职责分离、文件安全引用、故障注入零半记录、Audit/request_id 通过。
- Identity/Master Data/Sales unit/UI 21/21，PostgreSQL/API 14/14；migration manifest 8/8。
- TASK01 typecheck、全仓 lint、Vinext 5/5 build、凭证扫描和 `git diff --check` 通过。
- Python 临时 SQLite self-test、smoke、go-live 通过；常驻 PID `277640` 与 18888 保持，真实 SQLite 只核验 metadata、未读取或修改。

## 并行环境验收

- 功能提交：`6bbec3f490033dcfef0dd00d3c8af179f5674b60`，父提交精确为 `0f15f271cc458343116cb6639f0d118eea37521b`。
- 部署前创建 root-only 0600 PostgreSQL 恢复点；随后只新增 `0015`，migrate exited 0，Web/PostgreSQL healthy、Worker running，管理员保持唯一且启用。
- 两个独立账号完成两个项目：直接提交→接收；提交→填写原因退回→需求 v2 修订→重新提交→最终接收。最终项目均 ACCEPTED，事件顺序为 SUBMITTED/RETURNED/RESUBMITTED/ACCEPTED。
- Compose 重启后 15 migrations、2 个 ACCEPTED 项目、3 个需求版本、四类事件和 9 条成功 Project Audit 持久；两个原生 UI 路由返回 200。
- 使用“0015 已应用、验收数据未创建”的恢复点完成清理；最终 app_users=1、启用管理员=1、临时账号=0、Project/Event/Customer=0，Schema 与管理员保留。临时恢复点在成功后删除。
- 最终 Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口、Worker running；Python PID `277640`/18888 与 SQLite metadata `53827608:1544192:1784963637:600` 不变。

## 完成边界

`MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`

该结论不表示六部门主线完成、真实数据迁移、生产上线、HTTPS/公网开放，或计划/采购询比价/财务成本完成。未 push、未切流，不启动 TASK02。
