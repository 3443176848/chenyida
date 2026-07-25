# SELFHOST-PHASE2-TASK05 采购诊断与设计

诊断日期：2026-07-25（Asia/Shanghai）

源码基线：`41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`

数据边界：只读 Git、源码、Schema、migration、测试与文档；未读取真实业务正文，未访问公开 Site 或生产环境。

## 1. 起点与现状

- TASK04 独立提交父节点正确、工作区 clean、`origin/main +5/-0`、版本 alpha.4、PostgreSQL `0001`—`0008`；旧 checksum 全部保持基线。
- PostgreSQL 只有 legacy `erp_records` PO 占位，没有关系化 PO/Receipt 服务。TASK03 已提供稳定 Supplier/Material/Mapping/Price，TASK04 已提供不可变库存 Ledger 与余额投影。
- legacy 页面仍请求 purchase suggestions/orders/lines/receive，因此 TASK05 需要兼容 DTO，但写引用必须改用内部 ID、expected version 和服务端 actor。

## 2. Python/legacy 风险证据

- 缺料使用 float，按最低可解析文本价格选择 Supplier，并把缺映射物料归为“未指定供应商”；缺料生成以名称和 item code 建单、COUNT+1 编码，允许零价且不同请求可重复建单。
- 手工 PO 接受客户端状态、received_qty、created_by 和文本 Supplier/Material/Unit；坏 Line 发生在 Header insert 后，依赖连接生命周期回滚，缺少明确事务服务边界。
- 收货以 float 校验后直接修改文本库存余额、PO Line/Header，再写文本流水；没有幂等、行锁、expected version、不可变 Receipt 或冲销。
- legacy AP 可直接从 PO 金额创建，但 TASK05 不复制该耦合；只追加稳定财务来源，完整 AP 延后 TASK09。

## 3. 设计结论

- `0009_procurement.sql` expand-only 新增 PO、Line、Source Link、Status Event、Receipt、Receipt Line 和 Financial Source Entry；旧 SQLite/D1/`erp_records` 不回填、不双写。
- PO 直接 OPEN；仅允许尚未收货的 OPEN Header 通过 `expected_version` 修改交期和备注，Line 与供应商/币种/数量/价格等业务事实不可修改。received/status/version 是可验证投影；全部收货后可显式关闭。Receipt 与 reversal 完全 append-only，PO 投影只能由受控采购事务更新。
- 缺料建议使用 PostgreSQL numeric：required = BOM qty × order qty × (1+loss)，available = TASK04 on-hand-reserved-frozen；只选 ACTIVE、有效期覆盖当前时点、1:1 base-unit Mapping 的当前有效价格，按 price、mapping ID 确定性排序。
- 收货事务先锁 PO/Lines，再通过 Inventory Service 事务内方法按稳定 Material 顺序锁余额；创建 Receipt 后调用库存 RECEIPT，逐行保存 Ledger 稳定链接，再更新 PO 投影、状态事件、财务来源、审计与幂等。
- 全额冲销锁原 Receipt/PO/Lines，调用 TASK04 reversal 边界，追加反向 Receipt/Lines/财务来源并减少 received projection；任何库存不足、版本冲突或故障整体回滚。

## 4. 明确不实施

不实现 PO Line/业务事实编辑、取消或审批、超收容差、单位/币种换算、税、退货、供应商门户、自动 AP/付款、真实数据迁移、生产 migration 或部署。

## 5. 中断恢复清单

- 恢复时 branch 为 `main`，HEAD 为 `41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`；`0001`—`0008` 与该提交完全一致。
- 恢复时 tracked dirty：Inventory Service、PostgreSQL Schema/journal、`MASTER.md`、`TASKS.md`；untracked dirty：`procurement-selfhost/` 骨架、`0009_procurement.sql`/snapshot、TASK05 任务文档和本诊断。全部与既有 TASK05 设计一致，没有来源不明或用户中断期间新增的修改。
- 恢复时已保存并复核 `git status --short`、`git diff --stat`、`git diff --name-status` 与未跟踪清单；暂定 0009 checksum 为 `8a58cf77d3271f3ecfe530250136e617c756e414a6ed7d2a077b3e68bb285480`，仅作恢复证据，不作为最终值。
- TASK04 Inventory Service 的公开 `post`/`reverse` 接口保持不变；新增事务内入口接收既有 `PoolClient`、不自行 commit，并由跨域故障注入测试证明整体回滚。
