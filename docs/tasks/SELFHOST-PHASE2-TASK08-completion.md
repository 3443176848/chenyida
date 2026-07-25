# SELFHOST-PHASE2-TASK08 完成报告

状态：`DONE`（非生产；未发布、未部署、未迁真实数据）

日期：2026-07-25（Asia/Shanghai）

## 交付

- PostgreSQL `0012_quality.sql` 与 Drizzle schema/snapshot/journal。
- 独立 `quality-selfhost` Repository/Service/Handler、稳定 API、权限、审计、幂等、限流和 expected version。
- IQC/Receipt Line、IPQC/Production Report、FQC/Completion Line + SO Line 的稳定关系。
- 不可变 inspection result/defect/event，受控 Header 投影，异人处置、关闭与 manager/admin 重开。
- Sales Shipment FQC 额度门禁、冲销额度恢复及已消费放行保护。
- legacy 品质 UI/API 兼容、专项测试、迁移测试与 Compose 重启验收。

## 数据和事务结论

- Quantity 使用 PostgreSQL `numeric(24,6)`；来源、Material、Unit、检验数量、缺陷数量和放行数量由数据库约束与服务端共同校验。
- 质量写事务同时保存业务事实/事件、投影、审计和幂等结果；错误或审计失败整体回滚。
- 发货继续以 TASK07 Sales + TASK04 Inventory 的原事务为边界，仅增加 FQC eligibility 锁与额度检查，不复制库存或订单算法。
- 已过账 Receipt、Production Report/Completion、Shipment 和 Sales Financial Source 不被品质流程原地修改。

## 版本与恢复点

- 起点：`0ad0687a7b2f2502f68babbef1455df2a983421b`（TASK07）。
- 包版本：`chenyida-erp-selfhosted@0.1.0-alpha.8`。
- Migration：`0012_quality.sql`，SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`；`0001`—`0011` 保持不变。
- 功能提交通过 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK08-completion.md` 解析；提交信息 `feat: add self-hosted quality management`。

## 验收摘要

- Quality unit/UI 5/5、PostgreSQL/API 8/8、migration 3/3；Sales PostgreSQL/API 3/3。
- 共享 unit/UI 70/70，Identity/Master Data/Inventory/Procurement/Production PostgreSQL 回归通过。
- Compose 空库迁移、首次端到端及 Web/Worker 重启持久性通过。
- FileStorage/environment、lint/typecheck/build、凭证扫描、Python 三项和 `git diff --check` 通过。

## 保留边界

- 不迁真实检验、库存、生产或销售数据，不访问生产，不部署，不 push，不创建 PR。
- 不声称 IQC 已做库存批次隔离；当前只提供 Receipt Line 品质权威记录。
- 财务、Dashboard、备份恢复治理和 legacy iframe 退出仍属于后续独立任务。
