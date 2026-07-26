# SELFHOST-PHASE4-TASK10 完成报告

## 结论

`PROJECT RECEIPT PAYMENT AND CASHFLOW ACCEPTED IN PARALLEL ENVIRONMENT`

- 日期：2026-07-26（Asia/Shanghai）
- 状态：`DONE / PARALLEL ACCEPTED`
- 功能提交：`23fef6098a88466b94fcac104bba9317ba310d15`
- 严格 Parent：`e63c726e0d274a8b7b654819794b4bd1044c6f82`
- 验收提交：`ops: accept project cashflow workflow in parallel environment`，实际哈希以 Git log 为准。
- 版本：`0.1.0-alpha.24`
- Migration：`0024_finance_project_settlements.sql`
- SHA-256：`cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624`

## 业务与数据边界

没有创建第二套应收、应付或收付款模块。AR/AP 继续使用 `finance_documents`，收付款继续使用不可变 `finance_settlements`，冲销继续使用追加式等额负数记录；Document、Settlement、Event、Audit、幂等结果和余额/version 投影在同一事务内提交。AR 只接受 RECEIPT，AP 只接受 PAYMENT；部分、多次核销、Document 行锁、CAS、累计未结上限和同正文重放/异正文冲突均生效。

`0024` 只增加 Financial Source→Project Allocation。销售沿 Shipment Line→FQC Consumption→Completion/Work Order→Production Handoff→Planning Package→Business Project；采购沿 Receipt Line→Delivery/PO Line→Award/RFQ/Purchase Request→Material Requirement Plan→Planning Package→Business Project。来源不完整保存 `UNATTRIBUTED`，不按名称、单号或浏览器选择猜测，也不改写历史 Shipment、Receipt、AR 或 AP。直接 SQL guard、外键、唯一约束、digest 和延迟总额核对保护不可变与守恒。

项目视图只按 Project 和 Currency 聚合。`net_cash = customer_receipts - supplier_payments`；`transaction_contribution = sales_source_amount - purchase_source_amount`，明确不是毛利、净利润或会计利润，也不包含人工、制造/公司费用、税、折旧、汇率或库存成本。

## 实际 HTTP 验收

同一 Project/CNY 的合成完整来源和 Finance 操作结果如下：

| 单据 | 来源金额 | 收/付款 | 最终状态 | 未结 |
| --- | ---: | --- | --- | ---: |
| AR 80 | 80 | RECEIPT 30 + 50 | OPEN→PARTIALLY_SETTLED→SETTLED | 0 |
| AR 120 | 120 | RECEIPT 120 | SETTLED | 0 |
| AP 48 | 48 | PAYMENT 48 | SETTLED | 0 |
| AP 72 | 72 | PAYMENT 30 + 42 | PARTIALLY_SETTLED→SETTLED | 0 |

最终 Customer Receipt=`200 CNY`、Supplier Payment=`120 CNY`、Sales Source=`200 CNY`、Purchase Source=`120 CNY`、AR/AP outstanding=`0/0`、transaction contribution=`80 CNY`、net cash=`80 CNY`、UNATTRIBUTED=`0`、Settlement Reversal=`0`、真实银行写入=`0`。相同 Idempotency-Key 重放原结果，异正文冲突；sales/purchase 越权收付款返回 403。`/finance/settlements`、`/finance/projects` 及相关销售/仓库/应收页面均实际返回 200。

Compose 整体重启后 24 migrations、Shipment/FQC `4/6`、Sales Source `80/120`、AR `80/120`、AP `48/72`、6 条 Settlement、4 条 Allocation、10 条 Finance Event、10 条 Finance Audit 与 5 条 Delivery Event 全部保持。

## 自动验证

- TASK10 unit/UI、PostgreSQL/API 4/4、migration 4/4 通过；覆盖空库、0023→0024、重复执行、DDL 失败回滚、约束和直接 SQL guard。
- AR 创建 PAYMENT、AP 创建 RECEIPT、零/负/超额、并发超余额、幂等重放/冲突、CAS、全额冲销、重复/并发冲销和故障注入零半记录通过。
- 多 Project 精确行归属、无来源 UNATTRIBUTED、六位小数尾差守恒、跨币种不聚合、角色 403、TASK05 Receipt/TASK09 Shipment 上游冲销门禁通过。
- TASK01—TASK09 PostgreSQL/API 与 migration upgrade、Finance/Procurement/Sales/Project/Dashboard 回归、Phase 4 十组正式 TypeScript、Schema consistency 和 Vinext build 通过。
- ESLint 0 error/6 个既有 warning；credentials scan 884 files、`git diff --check` 通过。
- Python `server.py --self-test`、隔离 `smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；临时库已删除。

## Compose、备份恢复与清理

- 只更新 `chenyida-erp-parallel`；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 Caddy/HTTPS/80/443。
- 接受态停服备份 `backup-20260726T133340Z-23fef6098a88` 通过 artifact SHA/size、归档路径和 24 migration 清单校验；PostgreSQL dump SHA-256 为 `1a0610608a90fb5f8d1c03f597818bf7d6246755f7993a098b71b998c551e25e`。
- 新空 `task10_restore_test` 恢复精确为 `24|2|200|200|2|120|120|200|120|6|4|200|120|0|1|0|10|10`，恢复 uploads/attachments 均为 0。首次恢复曾准确暴露合成采购夹具缺失 Quote Comparison 父记录；补齐完整稳定采购来源链、重跑 HTTP/重启后，第二次备份恢复通过，未降低约束或跳过验证。
- 最终主库为 24 migrations、唯一启用管理员、所有合成业务表 0、uploads/attachments 0；恢复库、隔离测试库、临时备份/恢复目录及检查镜像/容器均删除。只保留 PostgreSQL/Web/Worker 三容器和四个持久卷。

## 权限、生产保护与 Git

finance 可查看/登记/受控冲销；manager/admin 查看项目管理汇总；sales 只读本职责 AR/收款，purchase 只读 AP/付款；engineering 只读本人负责项目的去敏汇总且看不到内部账户标签；其他越权写 403。`account_name` 只作内部标签，本任务没有银行或支付接口。

Python 常驻 PID `277640` 未重启；真实 SQLite 只核验 metadata `64769:53827608:1784999031:1544192`，未读取或修改业务正文。未 push、未创建 PR、未迁真实数据、未连接银行、未切流、未生产部署；未启动公司费用、总账、税票、汇率、成本会计或正式利润任务。
