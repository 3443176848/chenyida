# SELFHOST-PHASE4-TASK01 完成报告

状态：`IMPLEMENTED / PARALLEL ACCEPTANCE PENDING`

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

## 待功能提交后执行

- 创建 root-only 恢复点，重建 `chenyida-erp-parallel` migrate/Web/Worker并只应用 0015。
- 双账号完成直接接收与退回→修订→重提→最终接收，验证 Compose 重启持久性。
- 恢复验收前空数据点以清理业务测试记录，保留 Schema/管理员；记录功能与 ops 提交、最终 Compose/Git/Python/SQLite 证据。

在上述并行验收完成前，不使用最终结论，不将 TASK01 标记 DONE。
