# SELFHOST-PHASE3-TASK03 模型缺口记录

日期：2026-07-25（Asia/Shanghai）

## 任务内结论

本任务没有发现需要新增 `0015` 才能安全表达的合成模型缺口。MG-001（无 Shipment/Receipt 的 AR/AP 期初）和 MG-002（库存数量/冻结期初）继续由 `0014` 的受控关系模型表达，并已通过 public materialization、Dashboard 和恢复核对。

来源采购、生产、销售、品质及稳定来源财务活动被明确分类为 `ARCHIVE_ONLY`，不是模型缺失：在没有逐单历史回放、余额切点和人工处置规则前，将其与 Opening 同时过账会重复库存或金额，因此本任务按 fail-closed 保留证据，不伪造业务事实。

## 仍未解除的生产门禁

- 真实 SQLite/D1 source inventory、字段映射、重复/孤儿/冲突和逐行人工处置未执行。
- 真实账号启停、初始改密责任、Session 撤销与组织权限映射未确认。
- 真实历史活动的 snapshot/archive/replay 分类、截止时点和业务签字未确认。
- 真实文件数量/大小/MIME、容量、性能、备份故障域和恢复 RTO/RPO 未验证。
- 生产 PostgreSQL、文件目录、密钥、HTTPS、监控、部署与切换恢复点未建立。

这些是后续真实盘点和生产准入事项，不授权在 TASK03 中读取真实数据、创建 `0015`、部署或切换。结论保持 `NO-GO FOR REAL DATA / PRODUCTION`。
