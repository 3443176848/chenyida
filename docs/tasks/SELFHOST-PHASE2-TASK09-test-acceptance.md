# SELFHOST-PHASE2-TASK09 测试验收

日期：2026-07-25（Asia/Shanghai）

## 验收环境

- 根提交起点：`ee3e6585d5f0366187f62ef3f6012c3abaf28150`，Branch `main`。
- 隔离 PostgreSQL 17 与 TASK09 Compose project；测试数据库名包含 `finance_test`、`finance_upgrade_test` 或对应既有业务域标识，未连接生产。
- 宿主机没有 Node/npm；Node 22 命令在一次性容器中执行。Python 使用 `/opt/erp/.venv/bin/python`，go-live 使用临时 SQLite 和 `--no-backup`。

## 专项结果

| 项目 | 结果 | 覆盖 |
| --- | --- | --- |
| Finance unit/UI | PASS 4/4 | 权限、日期/版本/decimal 校验、稳定来源选择、不可变收付款/全额冲销、冻结请求正文、CSRF 与幂等合同 |
| Finance PostgreSQL/API | PASS 3/3 | AR/AP 精确继承来源、重复来源、部分/全部核销、超额、CAS/并发、幂等重放/异正文、全额冲销、角色可见性、直接篡改、上游冲销门禁和故障回滚 |
| Finance migration | PASS 3/3 | 空库升级、0012 存量、重复执行、DDL 失败回滚、外键/状态/金额/唯一性/不可变 guard、legacy 保留、0001—0012 checksum 不变；0013 SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1` |
| Compose lifecycle | PASS | `0001`—`0013`、首次 AR/AP/核销/冲销端到端、Web/Worker 重启后 Document/Settlement/Event/Audit 持久性 |

## 回归结果

- 共享 unit/UI：Identity 12/12、Material 8/8、Mapping 5/5、Normalization 7/7、Review 10/10、Master Data 4/4、Inventory 5/5、Procurement 5/5、Production 4/4、Sales 5/5、Quality 5/5、Finance 4/4，合计 74/74。
- PostgreSQL/API：Identity 8/8、Material 7/7、Mapping 6/6、Normalization 4/4、Review 3/3、Master Data 3/3、Inventory 3/3、Procurement 7/7、Production 5/5、Sales 3/3、Quality 8/8、Finance 3/3 均通过。
- FileStorage 3/3、environment guard 6/6、Procurement/Production/Sales/Quality/Finance typecheck、Drizzle schema consistency、Vinext build 通过。
- ESLint 0 error；仅 `物料主数据治理落地包/build_material_workbook.mjs` 保留 1 条任务起点既有 warning。凭证扫描 599 个版本库文件通过。
- Python：`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 均通过。首次 go-live 误对本地开发 SQLite 执行检查并生成的单个备份已移入系统回收站；未修改业务记录、未访问生产，随后已按隔离方式重跑。
- `git diff --check`、最终 staged diff、旧 migration checksum 与资源清理在提交前复核。

## 关键证据

- Document 的往来单位、币种和金额只继承正向、未冲销 Shipment/Receipt 金额来源；浏览器提供这些权威字段会被拒绝。
- 所有金额由 PostgreSQL `numeric(24,6)` 运算；并发核销通过 Document 行锁与 expected version 串行化，累计不能超过余额。
- 正向 Receipt/Payment 不可修改或删除，每笔最多追加一次等额负 Reversal；Document 只允许 Finance Service 更新余额、状态和 version 投影。
- 已生成 Finance Document 的 Shipment/Receipt 来源不能从 Sales/Procurement 直接冲销；业务事实、Event、投影、Audit 和 24 小时 Idempotency 同事务提交或整体回滚。
- legacy `erp_records` 未迁移、未修改；Compose restart 后 2 个 Document、3 个 Settlement、5 个 Event、5 条成功 Audit 保持可核对。

## 未验证/排除

- 未执行生产 migration、真实金额迁移、容量压测、生产备份恢复演练或部署。
- 未实现银行/支付网关、税务、发票、外币/汇率、信用、会计期间关闭、总账、自动过账、多单核销或收付款审批。
