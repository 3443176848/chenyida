# SELFHOST-PHASE2-TASK07 完成报告

日期：2026-07-25（Asia/Shanghai）

状态：`DONE`（非生产；独立提交完成后以 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK07-completion.md` 解析 final HEAD/commit SHA）

## 1. 交付

- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.6` → `0.1.0-alpha.7`；package/lock 一致，没有依赖升级。
- Migration：新增 PostgreSQL `0011_sales.sql` 与 Drizzle snapshot/journal；关系化 Quote Header/Version/Line/Status Event、SO Header/Version/Line/Status Event、Quote→SO Link、Shipment/Line 和 append-only Sales Financial Source。
- 服务端：新增 `sales-selfhost` Repository/Service/Handler；稳定 API 与 legacy 报价/销售订单/发货路由统一委托，可信 actor、固定权限、CSRF、幂等、限流、expected version、稳定错误和审计由服务端执行。
- 业务：报价版本和显式状态流；ACCEPTED 原子转单；直接 OPEN SO；部分/全部发货；一次全额冲销；CNY 六位服务端金额；成品只引用既有 ACTIVE/STOCKED Material。
- 跨域原子性：发货/冲销复用 TASK04 Inventory Service 事务入口，业务事实、SO 投影、Ledger/Balance、状态事件、金额来源、审计和幂等共同提交或整体回滚。
- Legacy UI：客户、产品版本、成品 Material 与 Unit 均提交稳定内部 ID；报价、转单、直建订单和单行兼容发货使用统一受保护写边界，不在浏览器计算权威总额或伪造操作者。

## 2. 验收结果

- TASK07：unit/UI 5/5；PostgreSQL/API 3/3；migration 3/3；typecheck、Schema consistency、Compose 初始/整栈重启 PASS。
- 回归：shared unit/UI 65/65；PostgreSQL/API 54/54；历代升级 21/21；Import 53/53；FileStorage 3/3；environment 6/6；lint 0 error/1 既有 warning；build 5/5；五项 typecheck、credentials 和 Python 三项 PASS。
- 完整证据见 `SELFHOST-PHASE2-TASK07-test-acceptance.md`；`0011` SHA-256 为 `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`，`0001`—`0010` 未修改。

## 3. 明确保留边界

- 未实现 AI 报价、税/折扣/汇率、信用额度、销售审批、库存预留、退货/换货、部分冲销、自动应收/收款/总账或品质判定。
- `sales_financial_source_entries` 只是 TASK09 可消费的稳定来源；本任务没有自动过账应收、付款或总账。
- TASK08 前没有 FQC hold/release 或检验记录；生产部署前必须由后续品质任务明确发货阻断规则。
- 未迁移真实 Quote/SO/Shipment/库存/金额数据，未访问生产、部署、重启 Python 服务、push 或创建 PR。

## 4. 清理与下一步

- TASK07 隔离 PostgreSQL、Compose 容器/网络/卷、临时 SQLite/文件均清理；生成的构建产物不提交。
- TASK07 独立提交并确认 clean 后，依连续任务指令进入 `SELFHOST-PHASE2-TASK08`；TASK08 仍需先诊断和固定 IQC/IPQC/FQC、处置及跨域 hold/release 决策，禁止提前创建 migration 或业务代码。
