# SELFHOST-PHASE4-TASK02 完成报告

状态：`DONE / ACCEPTED IN PARALLEL ENVIRONMENT`

可信起点：`main@0e380d0ae61655c59a27fcf0d3e70e51deb53a9b`。功能提交 `9236884f6cd96385c9c7050b29f57e7268142208` 的父提交严格保持该值；验收记录由独立 `ops: accept project planning workflow in parallel environment` 提交承载。

## 已实现

- `0.1.0-alpha.16` 与 expand-only PostgreSQL `0016_project_planning_handoff.sql`。
- 正式 `planning` 角色及四项最小能力；engineering 准备/提交与 planning 接收/退回职责分离。
- 六表独立关系模型、Resolution、不可变包/BOM/文件快照、版本化退回重提和只追加事件。
- 独立 `planning-handoff-selfhost` Repository/Service/Handler/Validation/Error/Types 边界及 8 条 API。
- `/engineering/projects/:projectId/planning`、`/planning/handoffs` 和 Dashboard 计划部门/待接收计数。

## 本地与隔离结果

- TASK02 unit/UI 6/6、PostgreSQL/API 3/3、migration upgrade 3/3。
- 空库 0001→0016、0015→0016 管理员/十旧角色/TASK01 事实保留、重复执行与失败回滚通过。
- 客户/Product/BOM/Material/Unit fail-closed、numeric 快照、幂等/CAS、并发唯一接收、职责分离、文件脱敏、故障零半记录通过。
- Identity/Master Data/Material/Project unit/UI 31/31、PostgreSQL/API 21/21、migration 10/10，Dashboard 10/10、migration manifest 8/8 通过。
- Schema consistency、TASK02 typecheck、全仓 lint、Vinext 5/5 build、FileStorage 3/3、environment 6/6、761 文件凭证扫描和 `git diff --check` 通过。
- Python 临时 SQLite self-test、smoke、go-live 通过；常驻 PID `277640`/18888 与真实 SQLite metadata `53827608:1544192:1784963637:600` 不变，未读业务内容。

## 并行环境实际验收

- 在 root-only、0600 且已校验的迁移前和干净 `0016` 恢复点保护下，从功能提交重建 migrate/Web/Worker，并行 PostgreSQL 只新增 `0016`；数据库最终记录 16 个 migration，checksum 为 `26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076`。
- 管理员通过现有 Identity API 创建临时 sales、engineering 和 planning 账号；首次改密、Session 和正式角色权限生效。合成 Customer、ACTIVE Material、RELEASED Product Version 与所属 RELEASED BOM Version 只存在于隔离并行库。
- 真实 HTTP 旅程完成：市场提交项目 → engineering 接收 → 逐项 Resolution → 生成 v1 快照 → 提交 → planning 填写原因退回 → engineering 修订解析并生成 v2 → RESUBMITTED → planning 最终 ACCEPTED。
- v1/v2 BOM 快照均保存一行，`12.500000 × 2.500000 × (1 + 0.10000000) = 34.375000`；计划事件严格为 `SUBMITTED, RETURNED, RESUBMITTED, ACCEPTED`，TASK01 项目事件保持 `SUBMITTED, ACCEPTED`。文件 API 只返回安全元数据，直接 SQL 修改提交后快照被数据库拒绝。
- Compose 重启后 Project 状态、v1 RETURNED/v2 ACCEPTED、事件、已接收队列 API 和两条原生页面保持；采购订单和生产工单均为 0，未触发 TASK03。

## 清理与运行面保护

- 验收后整体恢复干净 `0016` 快照，最终只保留 16 个 migration 和 1 个启用管理员；临时账号、Customer、Product、Material、BOM、Project、Project Event、Planning Package/Event、采购和生产业务记录全部为 0。临时验收脚本、cookie 和 root-only 恢复点已删除。
- 最终 Compose：PostgreSQL healthy、Web healthy、Worker running；Web 仍只绑定 `127.0.0.1:3000`。稳态三容器约 `48.5 + 29.0 + 55.8 MiB`，宿主可用内存约 1971 MiB、磁盘可用 31 GiB。
- Python PID `277640` alive、18888 HTTP 200；真实 SQLite 仅做 metadata stat，仍为 inode `53827608`、size `1544192`、mtime `1784963637`、mode `0600`，未读取业务内容。
- 未 push、未迁移真实数据、未启 HTTPS、未切流、未生产上线；TASK03 未启动。

唯一最终结论：`PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。该结论不表示净需求、采购、生产、真实迁移、HTTPS 或生产上线完成；TASK03 不自动启动。
