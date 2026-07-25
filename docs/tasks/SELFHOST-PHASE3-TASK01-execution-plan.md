# SELFHOST-PHASE3-TASK01 执行计划与完成状态

1. `DONE`：完整阅读项目治理、TASK10 验收、三套 Schema/migration、PostgreSQL 领域服务与现有 guard/backup/Compose 工具；记录 Git、migration、容器与 systemd 基线。
2. `DONE`：建立任务、source inventory、mapping、状态机、fixture/验收和 Go/No-Go 文档。
3. `DONE`：实现环境/路径/URL/目标空库拒绝守卫，并以单元测试证明守卫发生在 adapter 打开或连接前。
4. `DONE`：实现 manifest、canonical digest、mapping registry、ID map、checkpoint、SQLite/D1 export/PostgreSQL adapters、validator/planner/executor/reconciliation/report/CLI。
5. `DONE`：即时生成 valid/reviewable/blocked/resume/repeat 合成 fixture；完成 dry-run、合成 commit、重复执行、中断恢复、摘要失效和跨域 staging 核对。
6. `DONE / LIMITED`：隔离 PostgreSQL 17/Compose 验证 `0001`—`0013`、public schema FK 基线、backup→新空目标 restore、Web/Worker 健康和重启持久性；合成行未物化到 public 业务表，因此真实 Dashboard 明细核对保留为生产 NO-GO，而不是伪报通过。
7. `DONE`：运行适用全回归和安全/差异检查，更新项目治理与完成报告，清理全部临时资源；最后显式暂存并创建唯一独立提交。
