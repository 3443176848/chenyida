# SELFHOST-PHASE2-TASK09 完成报告

状态：`DONE`（非生产；未发布、未部署、未迁真实数据）

日期：2026-07-25（Asia/Shanghai）

## 交付

- PostgreSQL `0013_finance.sql` 与 Drizzle schema/snapshot/journal。
- 独立 `finance-selfhost` Repository/Service/Handler、受保护稳定 API 与 legacy 财务 UI 兼容。
- 从正向、未冲销 Shipment/Receipt 金额来源创建 AR/AP；金额、币种和 Customer/Supplier 全部由服务端继承。
- 不可变 Receipt/Payment/全额 Reversal、append-only Event，以及可核对的 Document 余额/状态/version 投影。
- 财务过账后上游发货/收货冲销 fail closed；业务事实、投影、审计和幂等同事务提交或整体回滚。

## 数据和事务结论

- 金额统一 PostgreSQL `numeric(24,6)`；浏览器不能提交单据总额、币种、往来单位、操作人或收付款类型作为权威值。
- 单来源最多一张 AR/AP；每笔 Settlement 首期只核销一张 Document，不允许超过余额，冲销只能对正向 Settlement 一次全额追加负事实。
- Document 来源、往来单位、金额、币种与原始事实不可修改；Settlement/Event 不可 UPDATE/DELETE。余额、状态和 version 仅由 Finance Service 在同一事务维护。
- admin/manager/finance 可过账、收付款和冲销；sales 只读 AR，purchase 只读 AP，operations/warehouse 只读两类；无业务需要的角色只得到空财务投影。

## 版本与恢复点

- 起点：`ee3e6585d5f0366187f62ef3f6012c3abaf28150`（TASK08）。
- 包版本：`chenyida-erp-selfhosted@0.1.0-alpha.9`。
- Migration：`0013_finance.sql`，SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1`；`0001`—`0012` checksum 保持不变。
- 功能提交通过 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK09-completion.md` 解析；提交信息 `feat: add self-hosted finance management`。

## 验收摘要

- Finance unit/UI 4/4、PostgreSQL/API 3/3、migration 3/3。
- 覆盖稳定 AR/AP 来源、六位精度、重复来源、部分/全部结清、超额、并发版本、一次性冲销、角色范围、CSRF、幂等、直接越权写、上游冲销阻断及故障/审计回滚。
- Procurement PostgreSQL 7/7、Sales 3/3、Quality 8/8；Compose 空库迁移、首次端到端及 Web/Worker 重启持久性通过。
- FileStorage 3/3、environment 6/6、typecheck、lint、build、凭证扫描、Python `server.py --self-test`、`smoke_test.py` 和临时库 `go_live_check.py --no-backup` 通过。

## 保留边界

- 不迁真实财务、采购、销售或用户数据，不访问生产，不部署，不 push，不创建 PR。
- 不实现银行/支付网关、税务、发票、外币/汇率、信用、会计期间关闭、总账、自动过账、收付款审批或多单核销。
- Dashboard、生产备份恢复治理和 legacy iframe 退出仍属于后续 `SELFHOST-PHASE2-TASK10`，须从本任务独立提交和 clean 工作区开始。
